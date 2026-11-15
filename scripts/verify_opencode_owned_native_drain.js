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
  for (const name of ["extensionHost/departmentleaderproductionhost.js", "extensionHost/departmentleaderprocessbootstrap.js",
    "runtime/departmentleaderprocessownerworker.js", "runtime/departmentopencodesessionpreparation.js"])
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
  roots.push("runtime/departmentleaderprocessownerworker.js");
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
      if (message?.operation === "ack" && grants.has(message.requestSequence)) record({ event: "grant", pid: child.pid,
        invocationId: grants.get(message.requestSequence), ok: message.ok, identity: message.identity });
      else if (["seal", "shutdown"].includes(message?.operation)) record({ event: "private-sent", pid: child.pid, operation: message.operation });
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
  const options = parseArgs(args), paths = validatePaths(options), before = snapshot(paths);
  // Reserve once before any native preparation. Neither product nor report can
  // adopt history, and a failed run never silently overwrites its evidence.
  const reportFd = fs.openSync(paths.reportPath, "wx", 0o600);
  fs.mkdirSync(paths.productRoot, { mode: 0o700 });
  const root = paths.productRoot, env = isolatedEnvironment(root), evidence = { schemaVersion: 1,
    status: "running", paths, platform: process.platform, arch: process.arch, node: process.version,
    source: { sourceCount: before.sourceCount, sourceDigest: before.sourceDigest, relevantSourceCount: before.relevantSourceCount, relevantSourceDigest: before.relevantSourceDigest, unrelatedDifferences: before.unrelatedDifferences, distDigest: before.distDigest },
    boundaries: ["real installed OpenCode, free loopback provider", "controlled VS Code API and in-memory tab host",
      "no EH/UI or tree capacity acceptance; no cold recovery or cross-platform claim"], rounds: [], forcedCleanup: [] };
  let source, host, provider, failure, cleanupPassed = false;
  evidence.verifierSha256 = sha(fs.readFileSync(__filename));
  evidence.providerFixtureSha256 = sha(fs.readFileSync(path.join(__dirname, "fixtures/opencode_local_provider_server.js")));
  const file = name => path.join(root, name);
  for (const value of Object.entries(env).filter(([key]) => /^(HOME|USERPROFILE|XDG_|APPDATA|LOCALAPPDATA|TMP|TEMP|OPENCODE_CONFIG_DIR|CODEX_HOME)/.test(key)).map(([, value]) => value))
    fs.mkdirSync(value, { recursive: true });
  // This process must set isolation before importing modules with home-based constants.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env, { OPENCODE_DRAIN_AUDIT_ROOT: root, OPENCODE_DRAIN_MODULE_ROOT: paths.moduleRoot,
    NODE_OPTIONS: `--require ${JSON.stringify(fs.realpathSync(__filename))}` });
  fs.writeFileSync(file("process-events.jsonl"), "", { flag: "wx", mode: 0o600 });
  fs.writeFileSync(file("source-snapshot.json"), JSON.stringify(before, null, 2));
  const record = installAudit(paths.moduleRoot, root);
  const events = () => fs.readFileSync(file("process-events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(v => JSON.parse(v));
  try {
    const binary = options.binary || cp.execFileSync(process.platform === "win32" ? "where" : "which", ["opencode"], { env, encoding: "utf8" }).trim().split(/\r?\n/)[0];
    evidence.binary = fs.realpathSync(binary);
    assert.ok(path.isAbsolute(evidence.binary));
    evidence.binarySha256 = sha(fs.readFileSync(evidence.binary));
    const probe = values => {
      const result = cp.spawnSync(evidence.binary, values, { env, encoding: "utf8", timeout: 10000, cwd: root });
      assert.equal(result.status, 0, result.error?.message || result.stderr);
      return result.stdout + result.stderr;
    };
    evidence.version = probe(["--version"]).trim();
    assert.match(evidence.version, /^\d+\.\d+\.\d+(?:[-+].*)?$/);
    evidence.help = { run: probe(["run", "--help"]), export: probe(["export", "--help"]) };
    assert.match(evidence.help.run, /--session/); assert.match(evidence.help.export, /export/);
    const bytes = fs.readFileSync(evidence.binary);
    evidence.protocolCapabilities = ["@ai-sdk/openai-compatible", "/chat/completions", "OPENCODE_DISABLE_MODELS_FETCH", "OPENCODE_DISABLE_PROJECT_CONFIG"]
      .map(name => ({ name, foundInInstalledBinary: bytes.includes(Buffer.from(name)) }));
    assert.ok(evidence.protocolCapabilities.every(p => p.foundInInstalledBinary), "unsupported installed provider/isolation protocol");
    provider = createOpenCodeLocalProvider(); const baseURL = await within(provider.listen(), "loopback-provider-listen", 10000);
    evidence.provider = { baseURL, protocol: "OpenAI-compatible chat completions (streaming and title queries)", requests: provider.requests };
    evidence.environment = { inheritedKeys: Object.keys(env).filter(key => ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "SYSTEMDRIVE"].includes(key)),
      keys: Object.keys(env).sort(), remoteProxy: "closed loopback port 9; NO_PROXY loopback", enabledProviders: ["isolated"] };
    const configContent = JSON.stringify({ enabled_providers: ["isolated"], model: "isolated/native-drain", small_model: "isolated/native-drain",
      share: "disabled", autoupdate: false, compaction: { auto: false, prune: false }, permission: { "*": "deny" },
      provider: { isolated: { npm: "@ai-sdk/openai-compatible", name: "Free loopback verifier", options: { baseURL, apiKey: "isolated-free-provider" },
        models: { "native-drain": { name: "Deterministic text only", limit: { context: 32768, output: 1024 } } } } } });
    const load = name => require(path.join(paths.moduleRoot, name));
    load("test/vscodeMock.js").installVscodeMock();
    const { createDepartmentProductionTaskStore } = load("extensionHost/departmentProductionTaskStore.js");
    const { prepareDepartmentTaskRecord } = load("extensionHost/departmentOwnedTaskRepository.js");
    const { DepartmentRuntimeStore } = load("extensionHost/departmentruntimestore.js");
    const { createDepartmentRuntimeSnapshot } = load("extensionHost/departmentruntimestate.js");
    const { createDepartmentExecutionProducer } = load("extensionHost/departmentexecutionproducer.js");
    const { createDepartmentLeaderProductionHost } = load("extensionHost/departmentleaderproductionhost.js");
    const { createDepartmentExecutionResources } = load("extensionHost/departmentexecutionresources.js");
    const { createDepartmentProductionCleanup } = load("extensionHost/departmentproductioncleanup.js");
    const { createDepartmentLeaderNativeSessionValidator } = load("extensionHost/departmentleadernativesessionvalidation.js");
    const { parseOpenCodeRunOutput, extractOpenCodeRuntimeSessionId } = load("cli/openCodeRunOutput.js");
    const { SharedRuntimeConfig } = load("config/sharedRuntimeConfig.js");
    const { updateLoopTaskRecord } = load("loopTaskStore.js");
    const { createLoopPlusScheduler } = load("loopPlusScheduler.js");
    const { buildSystemLoopPlusAcceptancePlanSnapshot } = load("loopPlusAcceptancePlan.js");
    const { sameExecution, cleanupComplete } = load("runtime/departmentexecutionidentity.js");
    const workspace = file("workspace"); fs.mkdirSync(workspace); fs.writeFileSync(path.join(workspace, "README.txt"), "Isolated native OpenCode verification.\n");
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "Must be omitted from the owned root.\n"); fs.mkdirSync(path.join(workspace, ".agents"));
    source = createDepartmentProductionTaskStore(file("owned-tasks"));
    const store = new DepartmentRuntimeStore(file("runtime")), readTask = id => source.readTaskRecord(id);
    const config = new SharedRuntimeConfig(file("configuration")), expected = await config.change(async () => ({ configId: "isolated-profile", profileDigest: null }));
    const routes = { director: { cli: "codex", configId: "isolated-profile", thinkingMode: "medium" },
      leader: { cli: "opencode", configId: "isolated-profile", model: "isolated/native-drain" },
      employee: { cli: "codex", configId: "isolated-profile", thinkingMode: "medium" } };
    const limits = { maxLeaders: 4, maxEmployees: 20 }, plan = buildSystemLoopPlusAcceptancePlanSnapshot();
    const base = (id, cli, sessionId) => ({ id, cli, sessionId, workspaceKey: workspace, rootPrompt: "Isolated verifier", status: "running",
      createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0, communicationDir: root,
      mainCommunicationFile: file(id + ".md"), subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [] });
    source.create(prepareDepartmentTaskRecord({ ...base("root", "codex", "local_director"),
      subTasks: [{ id: "module", title: "module", status: "running", prompt: "Isolated verifier" }] },
      { version: 1, rootTaskId: "root", parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "department", routes, limits }, plan));
    const task = source.create(prepareDepartmentTaskRecord({ ...base("leader", "opencode", "local_transcript"),
      loopPlus: createLoopPlusScheduler({ maxConcurrency: 20 }).snapshot() },
      { version: 1, rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", role: "leader", moduleTitle: "module", routes, limits }, plan));
    const runtime = createDepartmentRuntimeSnapshot("root");
    runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", generation: 1, status: "running" });
    assert.deepEqual(store.write({ version: 1, rootTaskId: "root", workspaceKey: workspace, runtime,
      capacity: { rootTaskId: "root", ...limits, leaders: ["module"], employees: [] } }), { ok: true });
    const producer = createDepartmentExecutionProducer({ store, workspaceKey: () => workspace, readTask,
      validateRoutes: r => JSON.stringify(r) === JSON.stringify(routes), processOverlay: "required" });
    producer.recordNewLeader(task); producer.openNewLeader("leader", 1);
    const scope = producer.scope("leader"), rows = () => { const r = store.readLeaderExecutionSet(scope); assert.ok(r.ok && r.value); return r.value; };
    const register = store.registerLeaderExecution.bind(store), bind = store.bindLeaderExecution.bind(store), readSet = store.readLeaderExecutionSet.bind(store);
    store.registerLeaderExecution = (...values) => { const result = register(...values); if (result.ok) record({ event: "responsibility-persisted" }); return result; };
    store.bindLeaderExecution = (...values) => { const result = bind(...values); if (result.ok) record({ event: "binding-persisted" }); return result; };
    store.readLeaderExecutionSet = (...values) => { const result = readSet(...values); if (result.ok && result.value?.bindings.length) {
      evidence.lastKnownBinding = result.value.bindings[0];
      record({ event: "binding-readback", binding: result.value.bindings[0] }); } return result; };
    host = createDepartmentLeaderProductionHost({ producer, store, ownerDirectory: file("owners"), readTask,
      updateTask(id, patch) { const result = updateLoopTaskRecord(id, patch);
        if (patch.executionSession && result) { assert.deepEqual(readTask(id).executionSession, patch.executionSession); record({ event: "session-readback", session: patch.executionSession }); }
        return result; } });
    const tabs = new Map([["leader-tab", { id: "leader-tab", cli: "opencode", sessionId: "local_transcript" }]]);
    const resources = createDepartmentExecutionResources({ workspace: () => workspace, readTab: id => tabs.get(id) ?? null,
      isActive: () => false, owns: i => rows().bindings.some(b => sameExecution(b.identity, i)),
      async close(tab) { tabs.delete(tab.id); record({ event: "controlled-tab-close-readback", absent: !tabs.has(tab.id) }); } });
    resources.recordCreated("leader-tab");
    const launch = { command: evidence.binary, baseArgs: ["run", "--pure", "--format", "json"], cwd: workspace, baseEnvironment: env,
      overlay: { configContent, primaryModel: "isolated/native-drain", smallModel: "isolated/native-drain" } };
    for (let round = 1; round <= 2; round++) {
      evidence.activePhase = `round-${round}-natural-drain`;
      const invocationId = `native-round-${round}`, consumer = resources.beginConsumer("leader-tab"), errors = [];
      let stdout = "", stderr = "", pending = 0, validations = 0;
      fs.writeFileSync(file(`round-${round}-stdout.jsonl`), "", { flag: "wx" });
      fs.writeFileSync(file(`round-${round}-stderr.log`), "", { flag: "wx" });
      const validate = createDepartmentLeaderNativeSessionValidator({ localSessionId: "local_transcript", configId: expected.configId,
        readExecutionSession() { validations++; return readTask("leader")?.executionSession; } });
      const handle = host.runOpenCode("leader", invocationId, `NATIVE_DRAIN_ROUND_${round}: Reply with the exact short verification marker. Do not use tools.`, {
        async onStdout(chunk) { pending++; try { await new Promise(r => setImmediate(r)); stdout += chunk; assert.ok(Buffer.byteLength(stdout) <= 2 * 1024 * 1024, "stdout-capture-limit"); fs.appendFileSync(file(`round-${round}-stdout.jsonl`), chunk);
          const id = extractOpenCodeRuntimeSessionId(stdout); if (id) validate(id);
          record({ event: "consumer-output", invocationId }); } finally { pending--; } },
        onStderr(chunk) { stderr += chunk; assert.ok(Buffer.byteLength(stderr) <= 2 * 1024 * 1024, "stderr-capture-limit"); fs.appendFileSync(file(`round-${round}-stderr.log`), chunk); }, onError(error) { errors.push(error.message); }, onExit(code) { record({ event: "consumer-exit", invocationId, code }); },
      }, expected, file("configuration"), launch, undefined, consumer.target);
      const lifecycle = await within(handle.lifecycle, `round-${round}-natural-drain`);
      fs.writeFileSync(file(`round-${round}-stdout.jsonl`), stdout); fs.writeFileSync(file(`round-${round}-stderr.log`), stderr);
      assert.deepEqual(errors, [], `round ${round} errors:${errors.join(",")}`);
      assert.equal(lifecycle.processTerminal.status, "confirmed"); assert.equal(lifecycle.streams.status, "confirmed"); assert.equal(pending, 0);
      const parsed = parseOpenCodeRunOutput(stdout, stderr), sessionId = extractOpenCodeRuntimeSessionId(stdout);
      assert.ok(sessionId); validate(sessionId); assert.ok(!parsed.errorText, parsed.errorText);
      assert.equal(parsed.finalText.trim(), `NATIVE_DRAIN_TURN_${round}_OK`);
      for (const line of stdout.split("\n").filter(Boolean)) { const item = JSON.parse(line); if (item.sessionID) validate(item.sessionID); }
      assert.equal(readTask("leader").sessionId, "local_transcript");
      const binding = rows().bindings[0]; assert.equal(rows().bindings.length, 1); assert.equal(binding.identity.session.id, sessionId);
      if (round === 2) assert.deepEqual(binding.identity, evidence.rounds[0].identity);
      const processEvents = events().filter(e => e.event === "spawn");
      const preparedCwd = processEvents.find(e => e.kind === "preparation")?.cwd;
      assertEventDirectory(preparedCwd, processEvents.filter(e => e.kind === "task").map(e => e.cwd), preparedCwd, workspace);
      assert.equal(fs.realpathSync(preparedCwd), preparedCwd);
      for (const name of ["AGENTS.md", ".agents"]) assert.equal(fs.existsSync(path.join(preparedCwd, name)), false);
      consumer.finish(); record({ event: "consumer-finished", invocationId });
      evidence.rounds.push({ invocationId, sessionId, identity: binding.identity, lifecycle, validations, parsedText: parsed.finalText,
        localTranscriptKey: readTask("leader").sessionId, naturalCompletion: true });
    }
    const binding = rows().bindings[0], originalClient = producer.originalClient(binding); assert.ok(originalClient);
    const cleanup = createDepartmentProductionCleanup({ store, producer, ownerDirectory: file("owners"), workspaceKey: () => workspace, readTask,
      readSelection: async () => config.read() });
    evidence.activePhase = "original-owner-receipt-stopped";
    const observation = cleanup.observe(readTask("leader"), 1); assert.ok(observation);
    await within(observation.done, "original-owner-receipt-stopped");
    const receipt = await within(originalClient.waitForCleanup(binding.identity, binding.requirements), "original-receipt");
    assert.ok(cleanupComplete(receipt.cleanup, binding.requirements));
    assert.equal((await originalClient.observeExecution(binding.identity)).status, "cleaned");
    assert.equal(tabs.size, 0); assert.equal(rows().set.state, "closed");
    evidence.cleanup = { requirements: binding.requirements, receipt, originalBootstrapObserved: "cleaned", controlledTabAbsent: true,
      closedSet: rows().set.state, configLeases: JSON.parse(fs.readFileSync(file("configuration/selection.json"), "utf8")).leases };
    assert.equal(evidence.cleanup.configLeases.length, 0);
    host.release("leader");
    await until(() => events().some(e => e.event === "owner-close"), "owner-worker-natural-close");
    const { runCliProcess } = load("cli/cliProcessRuntime.js");
    let exported = "", exportError;
    const reader = runCliProcess({ command: evidence.binary, args: ["export", "--pure", binding.identity.session.id], cwd: workspace, baseEnvironment: env },
      { onStdout(chunk) { exported += chunk; }, onStderr() {}, onError(error) { exportError = error; } }, "ignore");
    const exportLifecycle = await within(reader.lifecycle, "readonly-native-export"); assert.ok(!exportError, exportError?.message);
    assert.equal(exportLifecycle.processTerminal.status, "confirmed"); assert.equal(exportLifecycle.streams.status, "confirmed");
    const document = JSON.parse(exported); fs.writeFileSync(file("native-session-export.json"), exported);
    assert.equal(document.info.id, binding.identity.session.id);
    const serialized = JSON.stringify(document); for (let i = 1; i <= 2; i++) assert.ok(serialized.includes(`NATIVE_DRAIN_TURN_${i}_OK`));
    evidence.nativeExport = { sessionId: document.info.id, messageCount: document.messages.length, bothAnswersPresent: true, lifecycle: exportLifecycle };
    const audit = events(), spawned = audit.filter(e => e.event === "spawn"), taskSpawns = spawned.filter(e => e.kind === "task");
    evidence.directoryContract = assertEventDirectory(spawned.find(e => e.kind === "preparation")?.cwd,
      taskSpawns.map(e => e.cwd), document.info.directory, workspace);
    assert.equal(fs.existsSync(evidence.directoryContract.preparationCwd), false, "owned execution root survived complete receipt");
    assert.equal(taskSpawns.length, 2); assert.equal(spawned.filter(e => e.kind === "preparation").length, 1);
    assert.equal(audit.filter(e => e.event === "owner-fork").length, 1);
    const grantIndexes = audit.map((e, i) => e.event === "grant" && e.ok ? i : -1).filter(i => i >= 0); assert.equal(grantIndexes.length, 2);
    assert.ok(audit.findIndex(e => e.event === "responsibility-persisted") < audit.findIndex(e => e.event === "spawn" && e.kind === "preparation"));
    for (const event of ["session-readback", "binding-persisted", "binding-readback"]) assert.ok(audit.findIndex(e => e.event === event) >= 0 && audit.findIndex(e => e.event === event) < grantIndexes[0]);
    assert.ok(audit.findIndex(e => e.event === "consumer-finished" && e.invocationId === "native-round-1") < grantIndexes[1]);
    evidence.processes = spawned.map(entry => {
      const related = audit.filter(e => e.pid === entry.pid), close = related.find(e => e.event === "close"); assert.ok(close);
      const streams = ["stdout", "stderr", ...(entry.kind === "task" ? ["stdin"] : [])].map(stream => ({ stream,
        ended: related.some(e => e.event === "stdio-end" && e.stream === stream), closed: related.some(e => e.event === "stdio-close" && e.stream === stream) }));
      assert.ok(streams.every(s => s.ended && s.closed)); assert.ok(!related.some(e => e.event === "stdio-error"));
      const signals = related.filter(e => ["kill", "group-signal"].includes(e.event));
      if (entry.kind === "task") { assert.equal(close.code, 0); assert.equal(close.signal, null); assert.equal(signals.length, 0);
        assert.equal(entry.args.filter(a => a === "--session").length, 1); assert.equal(entry.args[entry.args.indexOf("--session") + 1], binding.identity.session.id); }
      return { ...entry, close, streams, signals, classification: entry.kind === "preparation" ? "expected owned preparation service stop, independently drained" : "natural close and stdio drain" };
    });
    assert.equal(audit.filter(e => e.event === "private-sent" && e.operation === "seal").length, 1);
    assert.equal(audit.filter(e => e.event === "private-received" && e.type === "stopped").length, 1);
    assert.equal(audit.find(e => e.event === "owner-close").code, 0);
    evidence.handshake = { receiptValidatedByOriginalClient: true, stoppedObserved: true, workerClosedNaturally: true, singleSeal: true };
    provider.assertHealthy(); assert.deepEqual(provider.requests.filter(r => r.purpose === "task").map(r => r.turn), [1, 2]);
    assert.equal(await within(source.close(), "owned-task-writer-close", 10000), true); source = undefined; cleanupPassed = true;
    const after = snapshot(paths); assert.equal(after.sourceDigest, before.sourceDigest); assert.equal(after.distDigest, before.distDigest);
    fs.writeFileSync(file("source-snapshot.json"), JSON.stringify(after, null, 2));
    evidence.source.unchangedAfterRun = true; evidence.activePhase = "complete"; evidence.status = "passed";
  } catch (error) { failure = error; evidence.status = "failed"; evidence.failure = { message: error.message, stack: error.stack }; }
  finally {
    evidence.normalLifecyclePassedBeforeTeardown = cleanupPassed;
    // Summarize pre-teardown facts even on failure. An absent close is unknown,
    // never inferred from a completed provider response or a session export.
    const beforeTeardown = events();
    evidence.preTeardown = {
      grants: beforeTeardown.filter(e => e.event === "grant"),
      owners: beforeTeardown.filter(e => e.event === "owner-fork"),
      processes: beforeTeardown.filter(e => e.event === "spawn").map(spawn => ({ ...spawn,
        close: beforeTeardown.find(e => e.event === "close" && e.pid === spawn.pid) ?? null,
        events: beforeTeardown.filter(e => e.pid === spawn.pid && ["stdio-end", "stdio-close", "stdio-error", "kill", "group-signal"].includes(e.event)),
        naturalCloseObserved: beforeTeardown.some(e => e.event === "close" && e.pid === spawn.pid && e.code === 0 && e.signal === null),
      })),
      receiptAndStoppedConfirmed: !!evidence.handshake,
    };
    if (!cleanupPassed) {
      // Hygiene only. Never turn failure/timeout/kill into cleanup success.
      for (const item of events().filter(e => ["spawn", "owner-fork"].includes(e.event))) {
        if (events().some(e => ["close", "owner-close"].includes(e.event) && e.pid === item.pid)) continue;
        try { process.kill(item.pid, "SIGKILL"); evidence.forcedCleanup.push({ pid: item.pid, signal: "SIGKILL", evidence: false }); } catch {}
      }
      try { await within(source?.close() ?? Promise.resolve(), "failed-source-hygiene", 3000); } catch {}
    }
    if (provider) {
      try { await within(provider.close(), "provider-server-close", 3000); }
      catch (error) { failure ??= error; evidence.status = "failed"; evidence.providerCloseFailure = error.message; }
      evidence.provider.closed = !provider.server.listening; evidence.provider.failures = provider.failures;
    }
    evidence.eventsFile = file("process-events.jsonl"); evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportFd, JSON.stringify(evidence, null, 2) + "\n"); fs.closeSync(reportFd);
  }
  if (failure) throw new Error(`${failure.message}; report=${paths.reportPath}`);
  console.log(JSON.stringify({ status: evidence.status, report: paths.reportPath, version: evidence.version, session: evidence.rounds[0].sessionId,
    owner: evidence.rounds[0].identity.ownerId, rounds: evidence.rounds.length, requests: provider.requests.length, forcedCleanup: evidence.forcedCleanup.length }));
}
module.exports = { main, parseArgs, isPathWithin, validatePaths, isolatedEnvironment, snapshot, assertEventDirectory };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
