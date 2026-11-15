"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { createOpenCodeLocalProvider } = require("./fixtures/opencode_local_provider_server");
const TIMEOUT = 45000;
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function within(promise, label, ms = TIMEOUT) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}-timeout-${ms}ms`)), ms);
  })]).finally(() => clearTimeout(timer));
}
async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (!check()) { if (Date.now() > deadline) throw new Error(`${label}-timeout`); await new Promise(r => setTimeout(r, 10)); }
}
function isPathWithin(parent, child, api = path) {
  const relative = api.relative(api.resolve(parent), api.resolve(child));
  return relative === "" || !api.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${api.sep}`);
}
function assertEventDirectory(preparationCwd, taskCwds, nativeDirectory, workspace, api = path) {
  for (const value of [preparationCwd, nativeDirectory, workspace, ...taskCwds])
    assert.ok(typeof value === "string" && api.isAbsolute(value), "missing absolute native event directory");
  assert.ok(taskCwds.length > 0, "task directory evidence missing");
  assert.notEqual(api.relative(workspace, preparationCwd), "", "workspace bypasses isolated execution root");
  for (const value of [...taskCwds, nativeDirectory])
    assert.equal(api.relative(preparationCwd, value), "", "native preparation/task/event directory mismatch");
  return { preparationCwd, taskCwds, nativeDirectory, workspace, samePhysicalDirectory: true };
}
// Intermediate observation only: no status here proves cleanup or authorizes release.
function assertConsumerGateObservation(observed, identity) {
  assert.ok(observed && ["live", "finalizing", "unknown"].includes(observed.status), "pending cleanup must not expose a receipt");
  assert.deepEqual(observed.identity, identity, "consumer gate identity mismatch");
  const claimed = observed.status === "live" || observed.status === "finalizing";
  assert.deepEqual(Object.keys(observed).sort(), (claimed ? ["status", "identity", "claimGeneration"] : ["status", "identity", "reason"]).sort());
  if (claimed) assert.ok(Number.isSafeInteger(observed.claimGeneration) && observed.claimGeneration >= 1);
  else assert.equal(typeof observed.reason, "string");
}
function overlap(a, b) { return isPathWithin(a, b) || isPathWithin(b, a); }
function parseArgs(args) {
  const options = {};
  const fields = { "--module-root": "moduleRoot", "--product-root": "productRoot", "--report": "reportPath", "--binary": "binary" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], key = fields[arg];
    if (arg === "--live") { assert.ok(!options.live, "duplicate --live"); options.live = true; continue; }
    if (!key) throw new Error(`unknown option: ${arg}`);
    assert.ok(!options[key], `duplicate ${arg}`);
    const value = args[++i];
    assert.ok(value && !value.startsWith("--") && !value.includes("\0") && !/[\r\n]/.test(value), `${arg} requires a valid value`);
    assert.ok(path.isAbsolute(value), `${arg} requires an absolute path`);
    options[key] = value;
  }
  for (const key of ["live", "moduleRoot", "productRoot", "reportPath"]) assert.ok(options[key], `missing ${key}`);
  return options;
}
function freshPath(candidate) {
  assert.ok(!fs.existsSync(candidate) && !fs.lstatSync(candidate, { throwIfNoEntry: false }), "path must be new");
  const parent = fs.realpathSync(path.dirname(candidate));
  return path.join(parent, path.basename(candidate));
}
function validatePaths(options) {
  const repository = fs.realpathSync(path.join(__dirname, ".."));
  const moduleRoot = fs.realpathSync(options.moduleRoot);
  const buildRoot = path.dirname(moduleRoot), source = path.join(buildRoot, "src");
  assert.equal(path.basename(moduleRoot), "dist", "module-root must be an isolated dist");
  assert.ok(!overlap(repository, moduleRoot), "shared repository/dist is forbidden");
  assert.ok(!fs.lstatSync(options.moduleRoot).isSymbolicLink() && !fs.lstatSync(source).isSymbolicLink(), "src/dist must be physical copies");
  for (const name of ["extensionHost/departmentprocesspreparation.js", "extensionHost/departmentprocessbootstrap.js",
    "runtime/departmentprocessownerworker.js", "runtime/departmentopencodesessionpreparation.js"])
    assert.ok(isPathWithin(moduleRoot, fs.realpathSync(path.join(moduleRoot, name))), "module path escape");
  const productRoot = freshPath(options.productRoot), reportPath = freshPath(options.reportPath);
  for (const item of [productRoot, reportPath]) {
    assert.ok(!overlap(repository, item) && !overlap(buildRoot, item), "product/report must not overlap repository or build");
  }
  assert.ok(!overlap(productRoot, reportPath), "report must be outside product root");
  return { repository, moduleRoot, buildRoot, source, productRoot, reportPath };
}
function files(root, extension) {
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), "source/dist symlink is forbidden");
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && file.endsWith(extension)) found.push(path.relative(root, file));
    }
  }
  walk(root); return found.sort();
}
function snapshot(paths) {
  // Bound the correspondence check to this verifier's actual production module
  // closure. Unrelated concurrent UI/orchestration edits do not invalidate it.
  const roots = [...fs.readFileSync(__filename, "utf8").matchAll(/load\("([A-Za-z0-9_/.]+\.js)"\)/g)].map(m => m[1]);
  roots.push("runtime/departmentprocessownerworker.js");
  const relevant = new Set();
  const visit = relative => {
    if (relevant.has(relative)) return;
    relevant.add(relative);
    const absolute = path.join(paths.moduleRoot, relative);
    assert.ok(isPathWithin(paths.moduleRoot, fs.realpathSync(absolute)), "dependency path escape");
    const content = fs.readFileSync(absolute, "utf8");
    for (const match of content.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
      let dependency = path.resolve(path.dirname(absolute), match[1]);
      if (!dependency.endsWith(".js")) dependency += ".js";
      if (fs.existsSync(dependency)) visit(path.relative(paths.moduleRoot, dependency));
    }
  };
  roots.forEach(visit);
  const sources = {}, compiled = {}, relevantSources = {}, unrelatedDifferences = [];
  for (const file of files(paths.source, ".ts")) {
    const built = sha(fs.readFileSync(path.join(paths.source, file))), current = path.join(paths.repository, "src", file);
    const original = fs.existsSync(current) ? sha(fs.readFileSync(current)) : null;
    sources[file] = built;
    if (relevant.has(file.replace(/\.ts$/, ".js"))) {
      assert.equal(built, original, `isolated production dependency mismatch:${file}`);
      relevantSources[file] = built;
    } else if (built !== original) unrelatedDifferences.push(file);
  }
  for (const relative of relevant) assert.ok(Object.hasOwn(relevantSources, relative.replace(/\.js$/, ".ts")), `missing physical dependency source:${relative}`);
  for (const file of files(paths.moduleRoot, ".js")) compiled[file] = sha(fs.readFileSync(path.join(paths.moduleRoot, file)));
  return { sources, compiled, relevantSources, unrelatedDifferences, sourceCount: Object.keys(sources).length,
    relevantSourceCount: Object.keys(relevantSources).length, sourceDigest: sha(JSON.stringify(sources)),
    relevantSourceDigest: sha(JSON.stringify(relevantSources)), distDigest: sha(JSON.stringify(compiled)) };
}
function isolatedEnvironment(root, inherited = process.env) {
  const env = {};
  for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "SYSTEMDRIVE"])
    if (inherited[key]) env[key] = inherited[key];
  Object.assign(env, { HOME: path.join(root, "home"), USERPROFILE: path.join(root, "home"),
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"),
    APPDATA: path.join(root, "config"), LOCALAPPDATA: path.join(root, "data"),
    TMPDIR: path.join(root, "tmp"), TMP: path.join(root, "tmp"), TEMP: path.join(root, "tmp"),
    OPENCODE_CONFIG_DIR: path.join(root, "opencode-config"), OPENCODE_TEST_HOME: path.join(root, "home"),
    CODEX_HOME: path.join(root, "unused-codex-home"),
    OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOCOMPACT: "1", OPENCODE_PURE: "1",
    HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9",
    http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1", LANG: "en_US.UTF-8", NO_COLOR: "1" });
  return env;
}

/** Observation only, installed in this verifier and inherited Node Owner. It
 * delegates every spawn/send/kill unchanged and never manufactures facts. */
function installAudit(moduleRoot, root) {
  const file = path.join(root, "process-events.jsonl");
  const record = event => fs.appendFileSync(file, JSON.stringify({ at: Date.now(), observerPid: process.pid, ...event }) + "\n");
  const spawnModule = createRequire(path.join(moduleRoot, "cli/cliProcessRuntime.js"))("cross-spawn");
  const originalSpawn = spawnModule.spawn;
  spawnModule.spawn = function(command, args, options) {
    const child = originalSpawn(command, args, options);
    const kind = args.includes("serve") ? "preparation" : args.includes("run") ? "task" : "readonly";
    record({ event: "spawn", kind, pid: child.pid, command, args, cwd: options?.cwd,
      envKeys: Object.keys(options?.env ?? {}).sort() });
    child.once("exit", (code, signal) => record({ event: "exit", kind, pid: child.pid, code, signal }));
    child.once("close", (code, signal) => record({ event: "close", kind, pid: child.pid, code, signal }));
    child.once("error", error => record({ event: "process-error", kind, pid: child.pid, reason: error.message }));
    for (const [name, stream, end] of [["stdin", child.stdin, "finish"], ["stdout", child.stdout, "end"], ["stderr", child.stderr, "end"]]) {
      if (!stream) continue;
      stream.once(end, () => record({ event: "stdio-end", kind, pid: child.pid, stream: name }));
      stream.once("close", () => record({ event: "stdio-close", kind, pid: child.pid, stream: name }));
      stream.once("error", () => record({ event: "stdio-error", kind, pid: child.pid, stream: name }));
    }
    const kill = child.kill.bind(child);
    child.kill = (...values) => { record({ event: "kill", kind, pid: child.pid, signal: values[0] ?? "SIGTERM" }); return kill(...values); };
    return child;
  };
  const originalFork = cp.fork;
  cp.fork = function(...args) {
    const child = originalFork(...args), grants = new Map();
    record({ event: "owner-fork", pid: child.pid, worker: args[0] });
    child.on("message", message => {
      if (message?.type === "grant-request") grants.set(message.requestSequence, message.invocationId);
      record({ event: "private-received", pid: child.pid, type: message?.type, invocationId: message?.invocationId,
        identity: message?.identity, terminal: message?.terminal });
    });
    const send = child.send.bind(child);
    child.send = function(message, ...rest) {
      if (message?.operation === "launch") record({ event: "grant", pid: child.pid, ok: true, identity: message.identity });
      else if (["shutdown"].includes(message?.operation)) record({ event: "private-sent", pid: child.pid, operation: message.operation });
      return send(message, ...rest);
    };
    child.once("exit", (code, signal) => record({ event: "owner-exit", pid: child.pid, code, signal }));
    child.once("close", (code, signal) => record({ event: "owner-close", pid: child.pid, code, signal }));
    return child;
  };
  const kill = process.kill.bind(process);
  process.kill = function(pid, signal) { if (pid < 0) record({ event: "group-signal", pid: -pid, signal: signal ?? "SIGTERM" }); return kill(pid, signal); };
  return record;
}
if (require.main !== module && process.env.OPENCODE_DRAIN_AUDIT_ROOT) {
  installAudit(process.env.OPENCODE_DRAIN_MODULE_ROOT, process.env.OPENCODE_DRAIN_AUDIT_ROOT);
}


async function main(args = process.argv.slice(2)) {
  const paths = validatePaths(parseArgs(args)), options = parseArgs(args), before = snapshot(paths);
  const reportFd = fs.openSync(paths.reportPath, "wx", 0o600);
  fs.mkdirSync(paths.productRoot, { mode: 0o700 });
  const root = paths.productRoot, file = name => path.join(root, name), env = isolatedEnvironment(root);
  const evidence = { schemaVersion: 1, status: "running", paths, platform: process.platform, arch: process.arch, node: process.version,
    source: { sourceCount: before.sourceCount, sourceDigest: before.sourceDigest, relevantSourceCount: before.relevantSourceCount,
      relevantSourceDigest: before.relevantSourceDigest, distDigest: before.distDigest, unrelatedDifferences: before.unrelatedDifferences },
    boundaries: ["installed OpenCode and production employee facade/worker/parser/tab stream/validator", "real repository, Store, producer, Ledger and original client",
      "controlled tab/resource host; no real EH/UI, group capacity acceptance, recovery or platform generalization"], forcedCleanup: [] };
  for (const [key, value] of Object.entries(env)) if (/^(HOME|USERPROFILE|XDG_|APPDATA|LOCALAPPDATA|TMP|TEMP|OPENCODE_CONFIG_DIR|CODEX_HOME)/.test(key)) fs.mkdirSync(value, { recursive: true });
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env, { OPENCODE_DRAIN_AUDIT_ROOT: root, OPENCODE_DRAIN_MODULE_ROOT: paths.moduleRoot,
    NODE_OPTIONS: `--require ${JSON.stringify(fs.realpathSync(__filename))}` });
  fs.writeFileSync(file("process-events.jsonl"), "", { flag: "wx", mode: 0o600 });
  fs.writeFileSync(file("source-snapshot.json"), JSON.stringify(before, null, 2));
  const record = installAudit(paths.moduleRoot, root);
  const events = () => fs.readFileSync(file("process-events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(v => JSON.parse(v));
  let source, provider, failure, passed = false;
  try {
    evidence.activePhase = "binary-capability-probe";
    const binary = options.binary || cp.execFileSync(process.platform === "win32" ? "where" : "which", ["opencode"], { env, encoding: "utf8" }).trim().split(/\r?\n/)[0];
    evidence.binary = fs.realpathSync(binary); evidence.binarySha256 = sha(fs.readFileSync(evidence.binary));
    evidence.verifierSha256 = sha(fs.readFileSync(__filename));
    evidence.providerFixtureSha256 = sha(fs.readFileSync(path.join(__dirname, "fixtures/opencode_local_provider_server.js")));
    const probe = args => { const r = cp.spawnSync(evidence.binary, args, { env, encoding: "utf8", timeout: 10000, cwd: root }); assert.equal(r.status, 0, r.stderr); return r.stdout + r.stderr; };
    evidence.version = probe(["--version"]).trim(); assert.match(evidence.version, /^\d+\.\d+\.\d+(?:[-+].*)?$/);
    evidence.help = { run: probe(["run", "--help"]), export: probe(["export", "--help"]) };
    assert.match(evidence.help.run, /--session/);
    const binaryBytes = fs.readFileSync(evidence.binary);
    evidence.protocolCapabilities = ["@ai-sdk/openai-compatible", "/chat/completions", "OPENCODE_DISABLE_PROJECT_CONFIG", "OPENCODE_DISABLE_MODELS_FETCH"]
      .map(name => ({ name, supported: binaryBytes.includes(Buffer.from(name)) }));
    assert.ok(evidence.protocolCapabilities.every(item => item.supported));
    provider = createOpenCodeLocalProvider({ maxRequests: 3 });
    const baseURL = await within(provider.listen(), "provider-listen", 10000);
    evidence.provider = { baseURL, requests: provider.requests, budget: 3, freeLoopbackOnly: true };
    evidence.environment = { inheritedKeys: Object.keys(env).filter(k => ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "SYSTEMDRIVE"].includes(k)), keys: Object.keys(env).sort() };
    const configContent = JSON.stringify({ enabled_providers: ["isolated"], model: "isolated/native-drain", small_model: "isolated/native-drain",
      share: "disabled", autoupdate: false, compaction: { auto: false, prune: false }, permission: { "*": "deny" },
      provider: { isolated: { npm: "@ai-sdk/openai-compatible", name: "Free employee verifier", options: { baseURL, apiKey: "isolated-free-provider" },
        models: { "native-drain": { name: "Deterministic local text", limit: { context: 32768, output: 1024 } } } } } });
    const load = name => require(path.join(paths.moduleRoot, name));
    load("test/vscodeMock.js").installVscodeMock();
    const { createDepartmentProductionTaskStore } = load("extensionHost/departmentProductionTaskStore.js");
    const { prepareDepartmentTaskRecord } = load("extensionHost/departmentOwnedTaskRepository.js");
    const { DepartmentRuntimeStore } = load("extensionHost/departmentruntimestore.js");
    const { createDepartmentRuntimeSnapshot } = load("extensionHost/departmentruntimestate.js");
    const { createDepartmentExecutionProducer } = load("extensionHost/departmentexecutionproducer.js");
    const { createDepartmentProcessPreparation, startDepartmentProcessInvocation } = load("extensionHost/departmentprocesspreparation.js");
    const { createDepartmentExecutionResources } = load("extensionHost/departmentexecutionresources.js");
    const { createDepartmentLeaderNativeSessionValidator } = load("extensionHost/departmentleadernativesessionvalidation.js");
    const { parseOpenCodeRunOutput, extractOpenCodeRuntimeSessionId } = load("cli/openCodeRunOutput.js");
    const { createOpenCodeTabStreamState, consumeOpenCodeTabStreamChunk, appendOpenCodeFinalTextToTabStream } = load("openCodeTabStream.js");
    const { buildOpenCodeRunArgs } = load("cli/openCodeRunArgs.js");
    const { SharedRuntimeConfig } = load("config/sharedRuntimeConfig.js");
    const { updateLoopTaskRecord } = load("loopTaskStore.js");
    const { createLoopPlusScheduler } = load("loopPlusScheduler.js");
    const { buildSystemLoopPlusAcceptancePlanSnapshot } = load("loopPlusAcceptancePlan.js");
    const { sameExecution, cleanupComplete } = load("runtime/departmentexecutionidentity.js");
    const workspace = file("workspace"); fs.mkdirSync(workspace); fs.writeFileSync(path.join(workspace, "README.txt"), "Isolated employee native verification.\n");
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "Must not enter owned root.\n"); fs.mkdirSync(path.join(workspace, ".agents"));
    source = createDepartmentProductionTaskStore(file("owned-tasks"));
    const store = new DepartmentRuntimeStore(file("runtime")), readTask = id => source.readTaskRecord(id);
    const config = new SharedRuntimeConfig(file("configuration")), expected = await config.change(async () => ({ configId: "isolated-profile", profileDigest: null }));
    const routes = { director: { cli: "codex", configId: "isolated-profile", thinkingMode: "medium" },
      leader: { cli: "codex", configId: "isolated-profile", thinkingMode: "medium" }, employee: { cli: "opencode", configId: "isolated-profile", model: "isolated/native-drain" } };
    const limits = { maxLeaders: 4, maxEmployees: 20 }, plan = buildSystemLoopPlusAcceptancePlanSnapshot();
    const base = (id, sessionId) => ({ id, cli: "codex", sessionId, workspaceKey: workspace, rootPrompt: "Employee verifier", status: "running",
      createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0, communicationDir: root, mainCommunicationFile: file(id + ".md"),
      subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [] });
    source.create(prepareDepartmentTaskRecord({ ...base("root", "local_director"), subTasks: [{ id: "module", title: "module", status: "running", prompt: "module" }] },
      { version: 1, rootTaskId: "root", parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "department", routes, limits }, plan));
    const leader = source.create(prepareDepartmentTaskRecord({ ...base("leader", "local_leader"), loopPlus: createLoopPlusScheduler({ maxConcurrency: 20 }).snapshot() },
      { version: 1, rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", role: "leader", moduleTitle: "module", routes, limits }, plan));
    const runtime = createDepartmentRuntimeSnapshot("root"); runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", generation: 1, status: "running" });
    assert.ok(store.write({ version: 1, rootTaskId: "root", workspaceKey: workspace, runtime,
      capacity: { rootTaskId: "root", ...limits, leaders: ["module"], employees: [JSON.stringify(["leader", "attempt"])] } }).ok);
    const producer = createDepartmentExecutionProducer({ store, workspaceKey: () => workspace, readTask,
      validateRoutes: r => JSON.stringify(r) === JSON.stringify(routes), processOverlay: "required" });
    producer.recordNewLeader(leader); producer.openNewLeader("leader", 1);
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 20 }); scheduler.dispatch([{ subtaskId: "employee", attemptId: "attempt" }]);
    assert.ok(updateLoopTaskRecord("leader", { subTasks: [{ id: "employee", title: "employee", status: "running", prompt: "NATIVE_DRAIN_ROUND_1" }], loopPlus: scheduler.snapshot() }));
    const scope = producer.scope("leader"), rows = () => { const r = store.readLeaderExecutionSet(scope); assert.ok(r.ok && r.value); return r.value; };
    const register = store.registerLeaderExecution.bind(store), bind = store.bindLeaderExecution.bind(store), readSet = store.readLeaderExecutionSet.bind(store);
    store.registerLeaderExecution = (...values) => { const r = register(...values); if (r.ok) record({ event: "responsibility-persisted" }); return r; };
    store.bindLeaderExecution = (...values) => { const r = bind(...values); if (r.ok) record({ event: "binding-persisted" }); return r; };
    store.readLeaderExecutionSet = (...values) => { const r = readSet(...values); if (r.ok && r.value?.bindings.length) record({ event: "binding-readback", binding: r.value.bindings[0] }); return r; };
    let builderCalls = 0;
    const prepareLaunch = async (_selection, sessionId) => {
      builderCalls++; assert.ok(rows().set.entries.length, "responsibility missing before builder");
      return { configurationDirectory: file("configuration"), workspaceDirectory: workspace,
        launch: { command: evidence.binary, args: buildOpenCodeRunArgs(["run", "--pure", "--format", "json"], sessionId,
          "NATIVE_DRAIN_ROUND_1: Reply with the exact short verification marker. Do not use tools."), baseEnvironment: env },
        overlay: { configContent, primaryModel: "isolated/native-drain", smallModel: "isolated/native-drain" } };
    };
    const service = createDepartmentProcessPreparation({ store, employeeAdmission: producer.employeeAdmission, ownerDirectory: file("owners"),
      workspaceKey: () => workspace, readTask, retainOriginalClient: (b, c) => producer.retainOriginalClient(b, c), prepareLaunch,
      updateTask(id, patch) { const r = updateLoopTaskRecord(id, patch); if (r && patch.subTasks) {
        const session = readTask(id)?.subTasks[0]?.executionSession; assert.ok(session); record({ event: "session-readback", session }); } return r; } });
    const tabs = new Map([["employee-tab", { id: "employee-tab", cli: "opencode", sessionId: "local_employee" }]]);
    const resources = createDepartmentExecutionResources({ workspace: () => workspace, readTab: id => tabs.get(id) ?? null, isActive: () => false,
      owns: identity => rows().bindings.some(b => sameExecution(b.identity, identity)), close: async tab => {
        tabs.delete(tab.id); record({ event: "controlled-tab-close-readback", absent: !tabs.has(tab.id) }); } });
    resources.recordCreated("employee-tab"); const consumer = resources.beginConsumer("employee-tab");
    service.authorizeAttempt("leader", "employee", "attempt");
    let stdout = "", stderr = "", validations = 0, messageId = 0, stream = createOpenCodeTabStreamState();
    const actions = [], errors = [];
    const validate = createDepartmentLeaderNativeSessionValidator({ localSessionId: "local_employee", configId: expected.configId,
      readExecutionSession() { validations++; return readTask("leader")?.subTasks[0]?.executionSession; } });
    evidence.activePhase = "employee-natural-process-and-consumer-drain";
    const handle = startDepartmentProcessInvocation(service, "leader", "employee", {
      onStdout(chunk) {
        stdout += chunk; assert.ok(Buffer.byteLength(stdout) <= 2 * 1024 * 1024);
        fs.writeFileSync(file("employee-stdout.jsonl"), stdout);
        const native = extractOpenCodeRuntimeSessionId(stdout); if (native) validate(native);
        const result = consumeOpenCodeTabStreamChunk(stream, chunk, false, { createMessageId: () => `native-${++messageId}` }); stream = result.state; actions.push(...result.actions);
      }, onStderr(chunk) { stderr += chunk; assert.ok(Buffer.byteLength(stderr) <= 2 * 1024 * 1024); fs.writeFileSync(file("employee-stderr.log"), stderr); },
      onExit(code) { record({ event: "consumer-exit", code }); }, onError(error) { errors.push(error.message); },
    }, expected, prepareLaunch, { tabTarget: consumer.target });
    const lifecycle = await within(handle.lifecycle, "employee-natural-drain");
    assert.deepEqual(errors, []); assert.equal(lifecycle.processTerminal.status, "confirmed"); assert.equal(lifecycle.streams.status, "confirmed");
    const parsed = parseOpenCodeRunOutput(stdout, stderr), native = extractOpenCodeRuntimeSessionId(stdout); validate(native);
    assert.ok(!parsed.errorText, parsed.errorText); assert.equal(parsed.finalText.trim(), "NATIVE_DRAIN_TURN_1_OK");
    const result = appendOpenCodeFinalTextToTabStream(stream, parsed.finalText, { createMessageId: () => `native-${++messageId}` }); stream = result.state; actions.push(...result.actions);
    assert.ok(JSON.stringify(actions).includes("NATIVE_DRAIN_TURN_1_OK"));
    for (const line of stdout.split("\n").filter(Boolean)) { const row = JSON.parse(line); if (row.sessionID) validate(row.sessionID); }
    assert.equal(tabs.get("employee-tab").sessionId, "local_employee"); assert.equal(readTask("leader").sessionId, "local_leader");
    assert.equal(rows().bindings.length, 1); const binding = rows().bindings[0];
    assert.equal(binding.identity.role, "employee"); assert.equal(binding.identity.session.id, native);
    const original = producer.originalClient(binding); assert.ok(original);
    evidence.identity = binding.identity; evidence.selection = binding.selection;
    evidence.task = { sessionId: native, lifecycle, validations, parsedText: parsed.finalText, builderCalls, transcriptKey: "local_employee", outputActions: actions.length };
    // The real task is drained, but the original consumer remains a required gate.
    const pendingObservation = await original.observeExecution(binding.identity);
    assertConsumerGateObservation(pendingObservation, binding.identity);
    evidence.consumerGateObservation = pendingObservation;
    assert.equal(tabs.size, 1);
    assert.equal(JSON.parse(fs.readFileSync(file("configuration/selection.json"), "utf8")).leases.length, 1);
    consumer.finish(); record({ event: "consumer-finished" });
    evidence.activePhase = "original-receipt-and-stopped";
    await within(service.observe("leader", "attempt").done, "employee-original-receipt-stopped");
    const receipt = await within(original.waitForCleanup(binding.identity, binding.requirements), "original-receipt");
    assert.ok(cleanupComplete(receipt.cleanup, binding.requirements));
    await until(() => events().some(e => e.event === "owner-close"), "original-worker-natural-close");
    assert.equal(tabs.size, 0); const leases = JSON.parse(fs.readFileSync(file("configuration/selection.json"), "utf8")).leases; assert.equal(leases.length, 0);
    evidence.cleanup = { requirements: binding.requirements, receipt, originalClientValidated: true, controlledTabAbsent: true, configLeases: leases };
    const { runCliProcess } = load("cli/cliProcessRuntime.js"); let exported = "", exportError;
    const reader = runCliProcess({ command: evidence.binary, args: ["export", "--pure", native], cwd: workspace, baseEnvironment: env },
      { onStdout(chunk) { exported += chunk; }, onStderr() {}, onError(error) { exportError = error; } }, "ignore");
    const exportFacts = await within(reader.lifecycle, "readonly-history-export"); assert.ok(!exportError); assert.equal(exportFacts.streams.status, "confirmed");
    const document = JSON.parse(exported); fs.writeFileSync(file("native-session-export.json"), exported);
    assert.equal(document.info.id, native); assert.ok(exported.includes("NATIVE_DRAIN_TURN_1_OK"));
    const audit = events(), spawns = audit.filter(e => e.event === "spawn"), preparation = spawns.filter(e => e.kind === "preparation"), tasks = spawns.filter(e => e.kind === "task");
    assert.equal(preparation.length, 1); assert.equal(tasks.length, 1); assert.equal(audit.filter(e => e.event === "owner-fork").length, 1);
    const probes = spawns.filter(e => e.kind === "readonly" && e.args[0] === "export" && e.cwd !== workspace);
    assert.equal(probes.length, 1); assert.equal(probes[0].cwd, preparation[0].cwd);
    evidence.directoryContract = assertEventDirectory(preparation[0].cwd, tasks.map(t => t.cwd), document.info.directory, workspace);
    assert.equal(fs.existsSync(preparation[0].cwd), false, "original root not removed after receipt");
    const grantIndex = audit.findIndex(e => e.event === "grant"); assert.ok(grantIndex > 0); assert.equal(audit.filter(e => e.event === "grant").length, 1);
    assert.ok(audit.findIndex(e => e.event === "responsibility-persisted") < audit.findIndex(e => e.event === "spawn"));
    for (const stage of ["session-readback", "binding-persisted", "binding-readback"]) assert.ok(audit.findIndex(e => e.event === stage) >= 0 && audit.findIndex(e => e.event === stage) < grantIndex, stage);
    assert.ok(audit.findIndex(e => e.event === "close" && e.pid === preparation[0].pid) < grantIndex);
    evidence.processes = spawns.map(entry => {
      const related = audit.filter(e => e.pid === entry.pid), close = related.find(e => e.event === "close"); assert.ok(close);
      const streams = ["stdout", "stderr", ...(entry.kind === "task" ? ["stdin"] : [])].map(stream => ({ stream,
        ended: related.some(e => e.event === "stdio-end" && e.stream === stream), closed: related.some(e => e.event === "stdio-close" && e.stream === stream) }));
      assert.ok(streams.every(s => s.ended && s.closed)); assert.ok(!related.some(e => e.event === "stdio-error"));
      const signals = related.filter(e => ["kill", "group-signal"].includes(e.event));
      if (entry.kind === "task") { assert.equal(close.code, 0); assert.equal(close.signal, null); assert.equal(signals.length, 0); }
      return { ...entry, close, streams, signals, classification: entry.kind === "preparation" ? "expected service stop with independently observed close/drain" : "natural close and stdio drain" };
    });
    assert.equal(audit.filter(e => e.event === "private-sent" && e.operation === "shutdown").length, 1);
    assert.equal(audit.filter(e => e.event === "private-received" && e.type === "stopped").length, 1);
    assert.equal(audit.find(e => e.event === "owner-close").code, 0);
    evidence.handshake = { originalFullReceipt: true, stopped: true, naturalWorkerClose: true };
    evidence.nativeExport = { sessionId: native, directory: document.info.directory, messageCount: document.messages.length, answerPresent: true, lifecycle: exportFacts };
    provider.assertHealthy(); assert.deepEqual(provider.requests.filter(r => r.purpose === "task").map(r => r.turn), [1]);
    assert.equal(await within(source.close(), "owned-writer-close", 10000), true); source = undefined;
    const after = snapshot(paths); assert.equal(after.sourceDigest, before.sourceDigest); assert.equal(after.distDigest, before.distDigest);
    evidence.source.unchangedAfterRun = true; passed = true; evidence.status = "passed"; evidence.activePhase = "complete";
  } catch (error) { failure = error; evidence.status = "failed"; evidence.failure = { message: error.message, stack: error.stack }; }
  finally {
    const audit = events(); evidence.normalLifecyclePassedBeforeTeardown = passed;
    evidence.preTeardown = { grants: audit.filter(e => e.event === "grant"), owners: audit.filter(e => e.event === "owner-fork"),
      processes: audit.filter(e => e.event === "spawn").map(e => ({ ...e, close: audit.find(c => c.event === "close" && c.pid === e.pid) ?? null })), receiptAndStopped: !!evidence.handshake };
    if (!passed) {
      for (const entry of audit.filter(e => ["spawn", "owner-fork"].includes(e.event))) {
        if (audit.some(e => ["close", "owner-close"].includes(e.event) && e.pid === entry.pid)) continue;
        try { process.kill(entry.pid, "SIGKILL"); evidence.forcedCleanup.push({ pid: entry.pid, signal: "SIGKILL", cleanupEvidence: false }); } catch {}
      }
      try { await within(source?.close() ?? Promise.resolve(), "failed-writer-hygiene", 3000); } catch {}
    }
    if (provider) { try { await within(provider.close(), "provider-close", 3000); } catch (error) { failure ??= error; evidence.status = "failed"; evidence.providerCloseFailure = error.message; }
      evidence.provider.closed = !provider.server.listening; evidence.provider.failures = provider.failures; }
    evidence.eventsFile = file("process-events.jsonl"); evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportFd, JSON.stringify(evidence, null, 2) + "\n"); fs.closeSync(reportFd);
  }
  if (failure) throw new Error(`${failure.message}; report=${paths.reportPath}`);
  console.log(JSON.stringify({ status: evidence.status, report: paths.reportPath, version: evidence.version, session: evidence.identity.session.id,
    owner: evidence.identity.ownerId, taskInvocations: 1, requests: provider.requests.length, forcedCleanup: evidence.forcedCleanup.length }));
}
module.exports = { main, parseArgs, isPathWithin, validatePaths, isolatedEnvironment, snapshot, assertEventDirectory, assertConsumerGateObservation };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
