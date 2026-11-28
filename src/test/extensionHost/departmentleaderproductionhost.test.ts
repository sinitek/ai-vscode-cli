import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { createLoopPlusRuntimeFixture } from "./fixtures/loopPlusRuntimeFixture";
import { installVscodeMock } from "../vscodeMock";
installVscodeMock();
import { SharedRuntimeConfig } from "../../config/sharedRuntimeConfig";
import { createDepartmentExecutionResources } from "../../extensionHost/departmentexecutionresources";
import { createDepartmentLeaderProductionHost } from "../../extensionHost/departmentleaderproductionhost";
import { createDepartmentExecutionProducer } from "../../extensionHost/departmentexecutionproducer";
import { createDepartmentProductionCleanup } from "../../extensionHost/departmentproductioncleanup";
import { createDepartmentProductionTaskStore } from "../../extensionHost/departmentProductionTaskStore";
import { prepareDepartmentTaskRecord } from "../../extensionHost/departmentOwnedTaskRepository";
import { DepartmentRuntimeStore } from "../../extensionHost/departmentruntimestore";
import { createDepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import { updateLoopTaskRecord, type LoopTaskRecord } from "../../loopTaskStore";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { departmentGenerationAuthorityDirectory, departmentGenerationAuthorityEndpoint, readDepartmentGenerationAuthority } from "../../runtime/departmentgenerationauthority";
import { captureDepartmentTestWorkers } from "./fixtures/departmentownedtestworkers";
import { DepartmentGenerationAuthorityClient } from "../../runtime/departmentgenerationauthorityclient";
import { sameExecution } from "../../runtime/departmentexecutionidentity";
import { resolveDepartmentConfigurationWithHost } from "../../departmentConfiguration";
import { readDepartmentRoleCandidates } from "../../extensionHost/departmentConfigurationHost";

function gate() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (!await check()) { if (Date.now() > deadline) throw new Error("leader-production-fixture-timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function scenario(name: string, run: (t: test.TestContext) => Promise<void>) {
  if (process.env.R348_SCENARIO) { if (process.env.R348_SCENARIO === name) test(name, { timeout: 25000 }, run); return; }
  test(name, { timeout: 35000 }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "r348-user-"));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), R348_SCENARIO: name };
      delete env.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, ["--test", __filename], { env }); let output = "";
      child.stdout.on("data", (v) => output += v); child.stderr.on("data", (v) => output += v);
      assert.equal(await new Promise((r, j) => { child.once("error", j); child.once("close", r); }), 0, output);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

/** Real producer, sole owned task writer, atomic runtime Store, config leases,
 * detached fixed Owner worker and runCliProcess. The free CLI protocol and tab
 * host are controlled substitutes, not real OpenCode or VS Code evidence. */
async function setup(t: test.TestContext, beforeSessionSave?: () => void, tabFails = false, withoutThinking = false, defaultModelSnapshot = false, employeeOpenCode = false, authorityEnabled = false, recoveryEnabled = false) {
  const workers = captureDepartmentTestWorkers(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "r348-production-"));
  const file = (name: string) => path.join(directory, name), workspace = file("workspace"), sessionId = "ses_productionFixture01";
  fs.mkdirSync(workspace); fs.writeFileSync(path.join(workspace, "AGENTS.md"), "hidden rule"); fs.mkdirSync(path.join(workspace, ".agents")); fs.writeFileSync(path.join(workspace, "source.txt"), "fixture");
  const eventsFile = file("events"); fs.writeFileSync(eventsFile, "");
  const events = () => fs.readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean);
  const record = (event: string) => fs.appendFileSync(eventsFile, event + "\n");
  const source = createDepartmentProductionTaskStore(file("owned")), store = new DepartmentRuntimeStore(file("runtime"));
  const readTask = (id: string) => source.readTaskRecord(id);
  const config = new SharedRuntimeConfig(file("configuration"));
  const expected = await config.change(async () => ({ configId: "profile", profileDigest: null }));
  const routes = { director: { cli: "codex" as const, configId: "profile", thinkingMode: "medium" as const },
    leader: { cli: "opencode" as const, configId: "profile", model: "fixture/model", ...(withoutThinking ? {} : { thinkingMode: "medium" as const }) },
    employee: { cli: employeeOpenCode ? "opencode" as const : "codex" as const, configId: "profile", ...(employeeOpenCode ? { model: "fixture/model" } : {}), thinkingMode: "medium" as const } };
  if (defaultModelSnapshot) {
    const profile = { id: "profile", name: "profile", platform: "opencode" as const, createdAt: 1, updatedAt: 1,
      content: JSON.stringify({ model: "fixture/model", provider: { fixture: { models: { model: {} } } } }) };
    const preference = { cli: "opencode" as const, configId: profile.id, model: null, thinkingMode: null, openCodeVariant: null };
    const snapshot = await resolveDepartmentConfigurationWithHost({ getDirector: () => preference,
      getPreferences: () => ({ leader: preference, employee: preference }),
      getCandidates: (cli, id) => readDepartmentRoleCandidates(cli, id, { getConfigs: async () => [profile],
        getConfig: async () => profile, getStoredModels: () => [], normalizeThinkingMode: (_cli, mode) => mode }),
      getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }), getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot });
    assert.equal(preference.model, null);
    routes.leader.model = snapshot.routes.leader.model!;
  }
  const limits = { maxLeaders: 4, maxEmployees: 20 }, plan = buildSystemLoopPlusAcceptancePlanSnapshot();
  const base = (id: string, cli: "codex" | "opencode", sessionId: string): LoopTaskRecord => ({ id, cli, sessionId,
    workspaceKey: workspace, taskStoreFile: "", rootPrompt: "controlled department", status: "running", createdAt: Date.now(), updatedAt: Date.now(),
    maxRounds: 20, currentRound: 0, communicationDir: directory, mainCommunicationFile: file(id + ".md"), subTasks: [], rounds: [],
    completionRoundSummaries: [], completionRequirementCoverage: [] });
  source.create(prepareDepartmentTaskRecord({ ...base("root", "codex", "local_director"),
    subTasks: [{ id: "module", title: "module", status: "running", prompt: "controlled module" }] },
  { version: 1, rootTaskId: "root", parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "department", routes, limits }, plan));
  const task = source.create(prepareDepartmentTaskRecord({ ...base("leader", "opencode", "local_leader"), loopPlus: createLoopPlusScheduler({ maxConcurrency: 20 }).snapshot() },
    { version: 1, rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", role: "leader", moduleTitle: "module", routes, limits }, plan));
  const runtime = createDepartmentRuntimeSnapshot("root");
  runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", generation: 1, status: "running" });
  assert.deepEqual(store.write({ version: 1, rootTaskId: "root", workspaceKey: workspace, runtime,
    capacity: { rootTaskId: "root", ...limits, leaders: ["module"], employees: [] } }), { ok: true });
  const producer = createDepartmentExecutionProducer({ store, workspaceKey: () => workspace, readTask,
    validateRoutes: (r) => JSON.stringify(r) === JSON.stringify(readTask("root")!.department!.routes), processOverlay: "required",
    ...(authorityEnabled ? { authorityDirectory: file("authorities"), ...(recoveryEnabled ? { ownerDirectory: file("owners") } : {}) } : {}) });
  producer.recordNewLeader(task); await producer.openNewLeader(task.id, 1);
  const scope = producer.scope(task.id);
  const rows = () => { const value = store.readLeaderExecutionSet(scope); assert.ok(value.ok && value.value); return value.value; };
  const originalRegister = store.registerLeaderExecution.bind(store), originalBind = store.bindLeaderExecution.bind(store);
  store.registerLeaderExecution = (...args) => { const result = originalRegister(...args); if (result.ok) record("responsibility-saved"); return result; };
  store.bindLeaderExecution = (...args) => { const result = originalBind(...args); if (result.ok) record("binding-saved"); return result; };
  const updateTask = (id: string, patch: Partial<LoopTaskRecord>) => {
    if (patch.executionSession) beforeSessionSave?.();
    const result = updateLoopTaskRecord(id, patch);
    if (result && patch.executionSession) record("task-session-saved");
    return result;
  };
  const cli = file("opencode-fixture");
  fs.writeFileSync(cli, `#!/usr/bin/env node
const http=require('http'),fs=require('fs'),args=process.argv.slice(2),events=${JSON.stringify(eventsFile)},root=${JSON.stringify(directory)};
const record=v=>fs.appendFileSync(events,v+'\\n');
const nativeDirectory=()=>fs.existsSync(root+'/wrong-directory')?root:fs.existsSync(root+'/native-directory')?fs.readFileSync(root+'/native-directory','utf8'):process.cwd();
if(args.includes('serve')){const server=http.createServer((req,res)=>{if(req.method==='POST'&&req.url.startsWith('/experimental/control-plane/move-session')){let b='';req.on('data',v=>b+=v);req.on('end',()=>{const v=JSON.parse(b);if(v.sessionID!==${JSON.stringify(sessionId)}||v.moveChanges!==false||v.destination.directory!==process.cwd()){res.statusCode=409;res.end('{}');return;}record('session-moved');fs.writeFileSync(root+'/native-directory',process.cwd());res.writeHead(204).end();});return;}if(req.method==='POST'&&req.url.startsWith('/session')){record('session-created');fs.writeFileSync(root+'/native-directory',process.cwd());const timer=setInterval(()=>{if(fs.existsSync(root+'/hold-create'))return;clearInterval(timer);res.setHeader('content-type','application/json');res.end(JSON.stringify({id:${JSON.stringify(sessionId)},directory:nativeDirectory()}));},5);return;}if(req.method==='GET'&&req.url.includes(${JSON.stringify(sessionId)})){res.setHeader('content-type','application/json');res.end(JSON.stringify({id:${JSON.stringify(sessionId)},directory:nativeDirectory()}));return;}res.statusCode=404;res.end('{}');});server.listen(0,'127.0.0.1',()=>process.stdout.write('http://127.0.0.1:'+server.address().port+'\\n'));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));}
else if(args[0]==='export'){if(args[1]!==${JSON.stringify(sessionId)})process.exit(34);process.stdout.write(JSON.stringify({info:{id:${JSON.stringify(sessionId)},directory:nativeDirectory()}}));}
else{if(fs.readFileSync(root+'/native-directory','utf8')!==process.cwd())process.exit(32);if(fs.existsSync(process.cwd()+'/AGENTS.md')||fs.existsSync(process.cwd()+'/.agents'))process.exit(33);const i=args.indexOf('--session');if(i<0||args[i+1]!==${JSON.stringify(sessionId)}||args.filter(v=>v==='--session').length!==1)process.exit(31);fs.appendFileSync(root+'/task-prompts.jsonl',JSON.stringify(args.at(-1))+'\\n');fs.writeFileSync(root+'/worker-pid',String(process.ppid));fs.writeFileSync(root+'/task-pid',String(process.pid));record('task-run');if(fs.existsSync(root+'/no-idle'))setInterval(()=>{},1000);process.stdout.write(JSON.stringify({type:'text',sessionID:${JSON.stringify(sessionId)},part:{type:'text',text:'answer'}})+'\\n');}
`); fs.chmodSync(cli, 0o755);
  const tabs = new Map([["leader-tab", { id: "leader-tab", cli: "opencode", sessionId: "local_leader" }]]);
  const resources = createDepartmentExecutionResources({ workspace: () => workspace, readTab: (id) => tabs.get(id) ?? null,
    isActive: () => false, owns: (identity) => { const saved = store.read("root", workspace); return !!(saved.ok && saved.value?.executionBindings?.some(b => sameExecution(b.identity, identity))); },
    async close(tab) { record("tab-close-attempt"); if (tabFails) throw new Error("controlled-tab-failure"); tabs.delete(tab.id); record("tab-closed"); } });
  resources.recordCreated("leader-tab");
  const host = createDepartmentLeaderProductionHost({ producer, store, ownerDirectory: file("owners"), readTask, updateTask });
  const groupCleanup = createDepartmentProductionCleanup({ store, producer, ownerDirectory: file("owners"), workspaceKey: () => workspace, readTask });
  const launch = { command: cli, baseArgs: ["run", "--format", "json"], cwd: workspace, baseEnvironment: { PATH: process.env.PATH } as NodeJS.ProcessEnv,
    overlay: { configContent: JSON.stringify({ provider: { fixture: { models: { model: {} } } } }), primaryModel: "fixture/model", smallModel: null } };
  const run = async (id: string, signal?: AbortSignal, output?: () => void | Promise<void>, withTab = true, taskPrompt = "controlled prompt") => {
    const consumer = withTab ? resources.beginConsumer("leader-tab") : undefined, chunks: string[] = [], errors: Error[] = [];
    const handle = host.runOpenCode("leader", id, taskPrompt, {
      onStdout: async (chunk) => { await output?.(); chunks.push(chunk); }, onStderr() {}, onExit() {}, onError: (e) => { errors.push(e); },
    }, expected, file("configuration"), launch, signal, consumer?.target);
    const terminal = await handle.lifecycle; consumer?.finish(errors.length === 0);
    return { terminal, chunks, errors };
  };
  t.after(async () => {
    // Test teardown never serves as evidence. Fault cases deliberately retain
    // durable leases/records until this isolated test directory is discarded.
    await source.close(); await fs.promises.rm(directory, { recursive: true, force: true });
  });
  return { workers, file, workspace, sessionId, events, record, config, expected, source, store, producer, rows, readTask, host, groupCleanup, tabs, resources, launch, run };
}

scenario("OpenCode production forwards long Loop+ prompts intact through the original private worker", async (t) => {
  const h = await setup(t);
  const prompt = '🌛\n"路径\\"\n' + '完整传递组长验收上下文'.repeat(2200);
  assert.ok(Buffer.byteLength(JSON.stringify(prompt), "utf8") > 64 * 1024);
  for (const id of ["long-first", "long-resume"]) {
    const result = await h.run(id, undefined, undefined, true, `${prompt}${id}`);
    assert.deepEqual(result.errors, []);
    assert.equal(result.terminal?.processTerminal.status, "confirmed");
  }
  assert.deepEqual(fs.readFileSync(h.file("task-prompts.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)),
    ["long-first", "long-resume"].map(id => `${prompt}${id}`));
  assert.equal(h.events().filter(event => event === "session-created").length, 1);
  const cleanup = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(cleanup); await cleanup.done;
  assert.equal(h.rows().set.state, "closed");
  h.host.release("leader");
});

for (const recoveryEnabled of [false, true]) scenario(`production OpenCode owner consumes its real generation ticket and retires authority after required receipts${recoveryEnabled ? " with original receipt escrow" : ""}`, async (t) => {
  const h = await setup(t, undefined, false, false, false, false, true, recoveryEnabled);
  const scope = h.producer.scope("leader"), authorityDirectory = departmentGenerationAuthorityDirectory(h.file("authorities"), scope);
  const endpoint = departmentGenerationAuthorityEndpoint(authorityDirectory);
  assert.deepEqual(readDepartmentGenerationAuthority(authorityDirectory)?.snapshot.tickets, []);

  for (const id of ["authority-backed-round-1", "authority-backed-round-2"]) {
    const run = await h.run(id);
    assert.equal(run.errors.length, 0, JSON.stringify({ errors: run.errors.map(error => error.message), events: h.events(),
      authority: readDepartmentGenerationAuthority(authorityDirectory)?.snapshot }));
  }
  assert.equal(h.events().filter(event => event === "task-run").length, 2);
  assert.equal(h.rows().bindings.length, 1);
  assert.ok(h.events().indexOf("responsibility-saved") < h.events().indexOf("session-created"));
  let authority = readDepartmentGenerationAuthority(authorityDirectory);
  assert.ok(authority);
  assert.equal(authority.snapshot.tickets.length, 1);
  assert.equal(authority.snapshot.tickets[0].state, "started");
  assert.equal(authority.snapshot.tickets[0].target.role, "leader");
  assert.equal(authority.snapshot.tickets[0].registrationId, h.rows().set.entries[0].responsibility.registrationId);
  assert.equal(authority.snapshot.tickets[0].localSessionId, h.readTask("leader")!.sessionId);
  const boundSession = h.rows().bindings[0].identity.session;
  assert.equal(authority.snapshot.tickets[0].nativeSessionId, boundSession.state === "bound" ? boundSession.id : null);
  assert.equal(authority.snapshot.tickets[0].identity?.executionId, h.rows().bindings[0].identity.executionId);

  const cleanup = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(cleanup); await cleanup.done;
  authority = readDepartmentGenerationAuthority(authorityDirectory);
  assert.ok(authority);
  assert.equal(authority.snapshot.state, "sealed");
  assert.equal(authority.snapshot.tickets[0].state, "released");
  assert.equal(h.rows().set.state, "closed");

  const stored = h.store.read("root", h.workspace); assert.ok(stored.ok && stored.value);
  stored.value.capacity.leaders = [];
  assert.equal(h.store.write(stored.value).ok, true, "durable capacity removal precedes authority worker retirement");
  await h.producer.retire("leader", 1);
  if (process.platform !== "win32") assert.equal(fs.existsSync(endpoint), false);
  assert.equal(fs.existsSync(path.join(authorityDirectory, "authority.lock")), false);
  const authorityWorker = h.workers.find(value => value.module.endsWith("departmentgenerationauthorityworker.js"));
  assert.ok(authorityWorker);
  assert.equal(authorityWorker.child.exitCode, 0);
  assert.equal(authorityWorker.child.signalCode, null, "retirement confirms natural worker exit");
  h.host.release("leader");
});

scenario("OpenCode default snapshot reaches production launch overlay, original binding and exact cleanup selection", async (t) => {
  const h = await setup(t, undefined, false, true, true);
  const result = await h.run("default-model-round");
  assert.equal(result.errors.length, 0); assert.equal(result.terminal?.processTerminal.status, "confirmed");
  const binding = h.rows().bindings[0];
  assert.equal(binding.selection.model, h.readTask("root")!.department!.routes.leader.model);
  assert.equal(binding.selection.model, h.launch.overlay.primaryModel);
  assert.equal(binding.selection.model, "fixture/model");
  const cleanup = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(cleanup); await cleanup.done;
  const original = h.producer.originalClient(binding); assert.ok(original);
  const receipt = await original.waitForCleanup(binding.identity, binding.requirements);
  assert.equal(receipt.cleanup.executionRoot.status, "confirmed"); assert.equal(h.rows().set.state, "closed");
  h.host.release("leader");
});

scenario("OpenCode production leader first binding and same-session rounds aggregate the original stopped Owner", async (t) => {
  const h = await setup(t), firstAbort = new AbortController();
  assert.equal(updateLoopTaskRecord("leader", { executionSession: { cli: "opencode", configId: "profile", sessionId: "local_fake" } }), null);
  assert.equal(updateLoopTaskRecord("leader", { executionSession: { cli: "codex", configId: "profile", sessionId: "foreign" } }), null);
  for (const id of ["round-1", "round-2"]) {
    Object.assign(h.launch, { processLabel: "diagnostic-" + id });
    const result = await h.run(id, id === "round-1" ? firstAbort.signal : undefined);
    assert.equal(result.terminal?.processTerminal.status, "confirmed", result.errors.map(e => e.message).join(","));
    assert.equal(result.errors.length, 0); assert.ok(result.chunks.join("").includes("answer"));
    firstAbort.abort(); // A completed caller cannot poison the next invocation.
    assert.deepEqual(h.readTask("leader")!.executionSession, { cli: "opencode", sessionId: h.sessionId, configId: "profile" });
  }
  assert.deepEqual(h.events().slice(0, 8), ["responsibility-saved", "session-created", "task-session-saved", "binding-saved", "task-run",
    "responsibility-saved", "binding-saved", "task-run"]);
  const nativeDirectory = fs.readFileSync(h.file("native-directory"), "utf8");
  assert.notEqual(nativeDirectory, fs.realpathSync(h.workspace));
  assert.equal(fs.existsSync(nativeDirectory), true);
  assert.equal(h.rows().bindings.length, 1);
  assert.equal(updateLoopTaskRecord("leader", { executionSession: { cli: "opencode", configId: "profile", sessionId: "ses_replacement" } }), null);
  const binding = h.rows().bindings[0], client = h.producer.originalClient(binding); assert.ok(client);
  const heldConsumer = h.resources.beginConsumer("leader-tab");
  const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation);
  await until(() => !fs.existsSync(nativeDirectory));
  assert.equal((await client.observeExecution(binding.identity)).status, "unknown", "receipt alone does not bypass original stopped confirmation");
  assert.equal(h.tabs.size, 1); assert.deepEqual(h.rows().set.state, "open");
  heldConsumer.finish(); await observation.done;
  assert.equal(h.tabs.size, 0); assert.equal(h.rows().set.state, "closed");
  assert.equal(fs.existsSync(nativeDirectory), false, "original host root is physically removed before receipt");
  const receipt = await client.waitForCleanup(binding.identity, binding.requirements);
  for (const part of ["processTerminal", "streams", "runner", "executionRoot", "links", "temp", "tab"] as const) assert.equal(receipt.cleanup[part].status, "confirmed");
  assert.equal((await new DepartmentExecutionOwnerClient(h.file("owners/" + binding.identity.ownerId)).observeExecution(binding.identity)).status, "unknown");
  assert.equal((await client.observeExecution(binding.identity)).status, "cleaned");
  assert.equal(h.readTask("leader")!.executionSession!.sessionId, h.sessionId, "native history and binding survive cleanup");
  const duplicated = await h.run("round-2", undefined, undefined, false); assert.equal(duplicated.errors.length, 1);
  assert.equal(h.events().filter(v => v === "task-run").length, 2);
  h.host.release("leader");
});

for (const mode of ["cancel", "revoke"] as const) scenario(`OpenCode production first preparation ${mode} cannot launch or retry`, async (t) => {
  const h = await setup(t), abort = new AbortController(); fs.writeFileSync(h.file("hold-create"), "gate");
  const running = h.run("round-1", abort.signal);
  await until(() => h.events().includes("session-created"));
  assert.equal(h.rows().set.entries[0].executionId, null); assert.ok(!h.events().includes("task-run"));
  if (mode === "cancel") abort.abort();
  if (mode === "revoke") assert.ok(updateLoopTaskRecord("root", { status: "stopped" }));
  fs.unlinkSync(h.file("hold-create"));
  const result = await running;
  assert.equal(result.errors.length, 1);
  assert.ok(!h.events().includes("task-run"));
  const retry = await h.run("round-2", undefined, undefined, false); assert.equal(retry.errors.length, 1);
  assert.equal(h.events().filter(v => v === "session-created").length, 1);
  const state = h.store.read("root", h.workspace); assert.ok(state.ok && state.value);
  assert.deepEqual(state.value.capacity.leaders, ["module"]);
});

scenario("OpenCode production persistence withdrawal fences launch and preserves responsibility", async (t) => {
  const h = await setup(t, () => { assert.ok(updateLoopTaskRecord("root", { status: "stopped" })); });
  const result = await h.run("round-1"); assert.equal(result.errors.length, 1);
  assert.ok(!h.events().includes("task-run")); assert.equal(h.rows().set.entries.length, 1);
  assert.equal(h.rows().bindings.length, 0); assert.equal(h.readTask("leader")!.executionSession!.sessionId, h.sessionId);
});

scenario("OpenCode production Owner disconnect stays unknown and never replaces execution", async (t) => {
  const h = await setup(t); assert.equal((await h.run("round-1")).errors.length, 0);
  const binding = h.rows().bindings[0], client = h.producer.originalClient(binding); assert.ok(client);
  process.kill(Number(fs.readFileSync(h.file("worker-pid"), "utf8")), "SIGKILL");
  await until(async () => (await client.observeExecution(binding.identity)).status === "unknown");
  assert.equal((await h.run("round-2")).errors.length, 1);
  const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation); await assert.rejects(observation.done);
  assert.equal(h.events().filter(v => v === "session-created").length, 1); assert.equal(h.events().filter(v => v === "task-run").length, 1);
  const state = h.store.read("root", h.workspace); assert.ok(state.ok && state.value); assert.deepEqual(state.value.capacity.leaders, ["module"]);
});

scenario("OpenCode production tab failure cannot expose cleaned or close the group", async (t) => {
  const h = await setup(t, undefined, true); assert.equal((await h.run("round-1")).errors.length, 0);
  const binding = h.rows().bindings[0], client = h.producer.originalClient(binding); assert.ok(client);
  const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation); await assert.rejects(observation.done);
  assert.equal((await client.observeExecution(binding.identity)).status, "unknown");
  assert.equal(h.tabs.size, 1); assert.equal(h.rows().set.state, "open");
  const state = h.store.read("root", h.workspace); assert.ok(state.ok && state.value); assert.deepEqual(state.value.capacity.leaders, ["module"]);
});


scenario("OpenCode production granted output drains after stop while all later grants remain fenced", async (t) => {
  const h = await setup(t), entered = gate(), released = gate();
  const running = h.run("round-1", undefined, async () => { entered.resolve(); await released.promise; });
  await entered.promise;
  assert.ok(updateLoopTaskRecord("root", { status: "stopped" }));
  const denied = await h.run("round-2", undefined, undefined, false); assert.equal(denied.errors.length, 1);
  let finished = false;
  const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation);
  const done = observation.done.then(() => { finished = true; });
  await new Promise((r) => setImmediate(r)); assert.equal(finished, false);
  assert.equal(h.events().filter(v => v === "task-run").length, 1);
  released.resolve(); assert.equal((await running).errors.length, 0); await done;
  assert.equal(h.rows().set.state, "closed"); assert.equal(h.tabs.size, 0);
});

scenario("OpenCode production keeps its fixed profile through a shared selection change during preparation", async (t) => {
  const h = await setup(t);
  fs.writeFileSync(h.file("hold-create"), "gate");
  const running = h.run("round-1");
  await until(() => h.events().includes("session-created"));
  await h.config.change(async () => ({ configId: "replacement", profileDigest: null }));
  fs.unlinkSync(h.file("hold-create"));
  assert.deepEqual((await running).errors, []);
  assert.equal(h.rows().bindings[0].selection.configId, "profile");
  assert.equal(h.events().filter(v => v === "task-run").length, 1);
  const cleanup = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(cleanup); await cleanup.done;
  assert.equal(h.rows().set.state, "closed");
});


scenario("OpenCode production optional thinking projection matches the fixed cleanup policy", async (t) => {
  const h = await setup(t, undefined, false, true);
  assert.equal((await h.run("round-1")).errors.length, 0);
  assert.equal(h.rows().bindings[0].selection.thinkingMode, null);
  const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation); await observation.done;
  assert.equal(h.rows().set.state, "closed"); assert.equal(h.tabs.size, 0);
});


for (const cancel of [false, true]) scenario(`OpenCode production existing Loop+ leader injection ${cancel ? "cancels preparation" : "runs same-session rounds"}`, async (t) => {
  const h = await setup(t); let calls = 0;
  const leader = h.readTask("leader")!, root = h.readTask("root")!;
  assert.equal(leader.department?.parentTaskId, root.id);
  assert.equal(leader.workspaceKey, root.workspaceKey);
  assert.equal(leader.workspaceKey, h.workspace);
  assert.equal(leader.status, "running");
  assert.equal(leader.cli, "opencode");
  assert.equal(leader.sessionId, "local_leader");
  assert.equal(root.sessionId, "local_director");
  assert.equal(leader.executionSession, undefined);
  let activeWorkspace = leader.workspaceKey;
  const fixture = createLoopPlusRuntimeFixture({ cli: "opencode", activeWorkspaceKey: () => activeWorkspace, taskPersistence: {
    create() { throw new Error("adapter must use the existing authoritative leader"); }, read: h.readTask,
    save(task) { assert.ok(updateLoopTaskRecord(task.id, task)); }, remove() { assert.fail("adapter cannot remove history"); },
  }, runPromptOverride: async () => { assert.fail("department main must never fall back to ordinary prompt execution"); },
    runDepartmentMain: async (input, options) => h.producer.track("leader", async () => {
      calls++; options.onStarted?.(); assert.equal(input.taskRole, "main"); assert.equal(input.loopTaskId, "leader");
      const result = await h.run(options.invocationId, options.signal, undefined, true, input.modelPrompt);
      if (result.errors.length) throw result.errors[0];
      const content = result.chunks.join("").trim().split("\n").map(line => JSON.parse(line).part.text).join("");
      fixture.publish(input, options.targetTabId, { status: "end", content });
    }),
  });
  t.after(() => fixture.dispose());
  Object.assign(fixture.target, { tabId: "leader-tab", sessionId: leader.sessionId });
  const cliCalls = () => h.events().filter(v => v === "session-created" || v === "task-run").length;
  const runInjected = (kind: "initial" | "user", cli: "opencode" | "codex" = "opencode", sessionId = fixture.target.sessionId) =>
    fixture.adapter.runMain({ taskId: "leader", kind, prompt: "controlled prompt", modelPrompt: "controlled prompt",
      reviewEventId: null, target: { tabId: fixture.target.tabId, cli, sessionId } });
  let ownerId = "", executionId = "";
  if (cancel) fs.writeFileSync(h.file("hold-create"), "gate");
  for (const kind of (cancel ? ["initial"] : ["initial", "user"]) as Array<"initial" | "user">) {
    const execution = runInjected(kind);
    if (cancel) {
      await until(() => h.events().includes("session-created")); execution.abort(); fs.unlinkSync(h.file("hold-create"));
      assert.equal(await execution.promise, null);
      assert.equal(h.events().filter(v => v === "task-run").length, 0); assert.equal(h.rows().set.entries[0].executionId, null);
    } else {
      assert.equal(await execution.promise, "answer");
      const binding = h.rows().bindings[0];
      assert.equal(binding.identity.session.state, "bound");
      assert.equal(binding.identity.session.state === "bound" ? binding.identity.session.id : "", h.sessionId);
      assert.deepEqual(h.readTask("leader")!.executionSession, { cli: "opencode", sessionId: h.sessionId, configId: "profile" });
      if (!ownerId) { ownerId = binding.identity.ownerId; executionId = binding.identity.executionId; }
      else { assert.equal(binding.identity.ownerId, ownerId); assert.equal(binding.identity.executionId, executionId); }
    }
  }
  assert.equal(calls, cancel ? 1 : 2);
  if (cancel) {
    const beforeLate = cliCalls();
    assert.equal(h.events().filter(v => v === "session-created").length, 1);
    await assert.rejects(runInjected("user").promise);
    assert.equal(cliCalls(), beforeLate);
    assert.equal(h.events().filter(v => v === "task-run").length, 0);
    assert.equal(h.rows().set.entries[0].executionId, null);
  }
  if (!cancel) {
    const beforeReject = cliCalls(), callsBefore = calls;
    const rejectOwnership = async (cli: "opencode" | "codex", workspace: string) => {
      activeWorkspace = workspace;
      await assert.rejects(runInjected("user", cli).promise, (error: unknown) => {
        assert.equal((error as { code?: string }).code, "LOOP_PLUS_PARENT_UNAVAILABLE");
        return true;
      });
    };
    await rejectOwnership("opencode", h.workspace + "-foreign");
    await rejectOwnership("codex", h.workspace);
    activeWorkspace = h.workspace;
    assert.equal(calls, callsBefore);
    assert.equal(cliCalls(), beforeReject);
    assert.equal(h.rows().bindings[0].identity.ownerId, ownerId);
    assert.equal(h.rows().bindings[0].identity.executionId, executionId);
    const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation); await observation.done;
    assert.equal(h.rows().bindings.length, 1); assert.equal(h.rows().set.state, "closed");
    assert.equal(h.events().filter(v => v === "session-created").length, 1);
    assert.equal(h.readTask("leader")!.executionSession!.sessionId, h.sessionId);
  }
});

scenario("OpenCode production rejects native event directory mismatch before binding or task grant", async (t) => {
  const h = await setup(t); fs.writeFileSync(h.file("wrong-directory"), "wrong");
  const result = await h.run("round-1");
  assert.match(result.errors[0]?.message ?? "", /native-session-directory-conflict/);
  assert.equal(h.events().includes("task-run"), false);
  assert.equal(h.rows().bindings.length, 0);
  assert.equal(h.rows().set.entries.length, 1);
  const state = h.store.read("root", h.workspace); assert.ok(state.ok && state.value);
  assert.deepEqual(state.value.capacity.leaders, ["module"]);
  assert.equal((await h.run("round-2", undefined, undefined, false)).errors.length, 1);
  assert.equal(h.events().filter(v => v === "session-created").length, 1);
});

scenario("OpenCode production refuses changed owned root at the next grant and retains capacity", async (t) => {
  const h = await setup(t);
  assert.equal((await h.run("round-1")).errors.length, 0);
  const directory = fs.readFileSync(h.file("native-directory"), "utf8");
  fs.renameSync(directory, directory + "-original"); fs.mkdirSync(directory);
  const result = await h.run("round-2"); assert.equal(result.errors.length, 1);
  const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation);
  await assert.rejects(observation.done);
  assert.equal(h.events().filter(v => v === "task-run").length, 1);
  assert.equal(h.tabs.size, 1); assert.equal(h.rows().set.state, "open");
  const state = h.store.read("root", h.workspace); assert.ok(state.ok && state.value);
  assert.deepEqual(state.value.capacity.leaders, ["module"]);
  // Hygiene only, after failed cleanup and retained responsibility were established.
  process.kill(Number(fs.readFileSync(h.file("worker-pid"), "utf8")), "SIGKILL");
  fs.rmSync(directory, { recursive: true, force: true }); fs.rmSync(directory + "-original", { recursive: true, force: true });
});

scenario("OpenCode production output without idle or physical close never admits a second round or cleanup", async (t) => {
  const h = await setup(t); fs.writeFileSync(h.file("no-idle"), "hold");
  let observedOutput = false, finished = false;
  const first = h.run("round-1", undefined, () => { observedOutput = true; }).then(result => { finished = true; return result; });
  await until(() => observedOutput);
  assert.equal(finished, false);
  assert.equal((await h.run("round-2", undefined, undefined, false)).errors.length, 1);
  const binding = h.rows().bindings[0], client = h.producer.originalClient(binding); assert.ok(client);
  assert.equal((await client.observeExecution(binding.identity)).status, "live");
  const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation);
  const failedClose = assert.rejects(observation.done);
  assert.equal(h.tabs.size, 1);
  const state = h.store.read("root", h.workspace); assert.ok(state.ok && state.value);
  assert.deepEqual(state.value.capacity.leaders, ["module"]);
  // Explicit failure injection and hygiene, never successful physical drain.
  process.kill(Number(fs.readFileSync(h.file("worker-pid"), "utf8")), "SIGKILL");
  process.kill(Number(fs.readFileSync(h.file("task-pid"), "utf8")), "SIGKILL");
  assert.equal((await first).errors.length, 1); await failedClose;
  assert.equal((await client.observeExecution(binding.identity)).status, "unknown");
  assert.equal(h.rows().set.state, "open");
  assert.equal(h.events().filter(v => v === "task-run").length, 1);
});

for (const fault of ["none", "cold-host", "capacity-retained", "closed-set-changed", "selection-changed", "reoccupied", "duplicate"] as const) {
  scenario(`OpenCode private retired provenance continuation: ${fault}`, async t => {
    const h = await setup(t);
    assert.equal((await h.run("original")).errors.length, 0);
    const original = h.rows().bindings[0], directory = fs.readFileSync(h.file("native-directory"), "utf8");
    assert.ok(updateLoopTaskRecord("leader", { status: "stopped" }));
    const observed = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observed); await observed.done;
    assert.equal(fs.existsSync(directory), false);
    assert.equal(h.rows().set.state, "closed");
    h.host.release("leader");
    const saved = h.store.read("root", h.workspace); assert.ok(saved.ok && saved.value);
    if (fault === "capacity-retained") {
      h.producer.retire("leader", 1);
      assert.equal(h.producer.canContinueLeader("leader"), false); return;
    }
    saved.value.capacity.leaders = []; assert.equal(h.store.write(saved.value).ok, true);
    h.producer.retire("leader", 1);
    assert.equal(h.producer.canContinueLeader("leader"), true);
    if (fault === "cold-host") {
      const cold = createDepartmentExecutionProducer({ store: h.store, workspaceKey: () => h.workspace, readTask: h.readTask,
        validateRoutes: () => true, processOverlay: "required" });
      assert.equal(cold.canContinueLeader("leader"), false);
      await assert.rejects(cold.openContinuedLeader("leader", 2)); return;
    }
    saved.value.runtime.leaders[0].generation = 2; saved.value.runtime.leaders[0].status = "running";
    saved.value.capacity.leaders = ["module"]; assert.equal(h.store.write(saved.value).ok, true);
    assert.ok(updateLoopTaskRecord("leader", { status: "running" }));
    await h.producer.openContinuedLeader("leader", 2);
    const target = { ...original.identity, generation: 2, ownerId: "new-owner", executionId: "new-execution" };
    if (fault === "selection-changed") {
      await assert.rejects(h.producer.prepareNativeContinuation(target, { ...original.selection, revision: "changed" }, undefined, () => undefined)); return;
    }
    if (fault === "reoccupied") fs.mkdirSync(directory);
    if (fault === "closed-set-changed") {
      const current = h.store.read("root", h.workspace); assert.ok(current.ok && current.value);
      current.value.leaderExecutionSets![0].closure!.admissionFence = "foreign";
      assert.equal(h.store.write(current.value).ok, false, "closed history cannot be rewritten");
      const read = h.store.read.bind(h.store);
      t.mock.method(h.store, "read", (...args: Parameters<typeof read>) => {
        const result = read(...args);
        if (result.ok && result.value) result.value.leaderExecutionSets![0].closure!.admissionFence = "foreign";
        return result;
      });
    }
    if (fault === "reoccupied" || fault === "closed-set-changed") {
      await assert.rejects(h.producer.prepareNativeContinuation(target, original.selection, undefined, () => undefined)); return;
    }
    if (fault === "duplicate") {
      const work = () => h.producer.prepareNativeContinuation(target, original.selection, undefined, () => undefined);
      const values = await Promise.allSettled([work(), work()]);
      assert.equal(values.filter(v => v.status === "fulfilled").length, 1); return;
    }
    h.tabs.set("successor-tab", { id: "successor-tab", cli: "opencode", sessionId: "local_successor" });
    h.resources.recordCreated("successor-tab"); const consumer = h.resources.beginConsumer("successor-tab");
    const errors: Error[] = [];
    const handle = h.host.runOpenCode("leader", "successor", "continue original", { onStdout() {}, onError: e => errors.push(e) },
      h.expected, h.file("configuration"), h.launch, undefined, consumer.target);
    assert.equal((await handle.lifecycle)?.processTerminal.status, "confirmed", errors.map(e => e.message).join(","));
    consumer.finish(); assert.equal(errors.length, 0);
    const nextDirectory = fs.readFileSync(h.file("native-directory"), "utf8");
    assert.notEqual(nextDirectory, directory);
    const state = h.store.readLeaderExecutionSet(h.producer.scope("leader")); assert.ok(state.ok && state.value);
    const next = state.value.bindings[0];
    assert.equal(next.identity.session.state, "bound"); assert.deepEqual(next.identity.session, original.identity.session);
    assert.notEqual(next.identity.ownerId, original.identity.ownerId);
    const clean = h.groupCleanup.observe(h.readTask("leader")!, 2); assert.ok(clean); await clean.done;
    assert.equal(fs.existsSync(nextDirectory), false);
    assert.equal(h.events().filter(v => v === "session-created").length, 1);
    assert.equal(h.events().filter(v => v === "session-moved").length, 1);
    assert.equal(h.events().filter(v => v === "task-run").length, 2);
    h.host.release("leader");
  });
}


// The same-generation path must require only this attempt's original stopped
// receipt and returned employee lease, not a whole-group CLOSED set.
import { createDepartmentProcessPreparation } from "../../extensionHost/departmentprocesspreparation";
for (const fault of ["none", "capacity-retained", "not-stopped", "source-changed", "successive", "self-retry", "self-source-changed", "unknown", "concurrent", "third-capacity", "third-not-stopped", "third-source-changed", "self-await-source-changed"] as const) {
  scenario(`OpenCode same-generation employee private continuation: ${fault}`, async t => {
    const h = await setup(t, undefined, false, false, false, true);
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
    scheduler.dispatch([{ subtaskId: "source", attemptId: "source-attempt" }]);
    assert.ok(updateLoopTaskRecord("leader", { subTasks: [{ id: "source", title: "source", status: "running" }], loopPlus: scheduler.snapshot() }));
    const saved = h.store.read("root", h.workspace); assert.ok(saved.ok && saved.value);
    saved.value.capacity.employees = [JSON.stringify(["leader", "source-attempt"])]; assert.equal(h.store.write(saved.value).ok, true);
    const preparing = gate(), releasePreparation = gate(); let holdPreparation = false;
    const continuations: Awaited<ReturnType<typeof h.producer.prepareNativeContinuation>>[] = [];
    const service = createDepartmentProcessPreparation({ store: h.store, employeeAdmission: h.producer.employeeAdmission,
      ownerDirectory: h.file("owners"), workspaceKey: () => h.workspace, readTask: h.readTask,
      updateTask: updateLoopTaskRecord, prepareNativeContinuation: async (...args) => {
        const proof = await h.producer.prepareNativeContinuation(...args); continuations.push(proof); return proof;
      },
      retainOriginalClient: (...args) => h.producer.retainOriginalClient(...args),
      nativeStopped: async binding => { if (fault !== "not-stopped" && !(fault === "third-not-stopped" && binding.identity.role === "employee"
        && binding.identity.attemptId === "next-attempt")) await h.producer.nativeStopped(binding); },
      prepareLaunch: async (_selection, sessionId) => {
        if (holdPreparation) { preparing.resolve(); await releasePreparation.promise; }
        return { configurationDirectory: h.file("configuration"), workspaceDirectory: h.workspace,
        overlay: h.launch.overlay, launch: { command: h.launch.command, args: ["run", "--format", "json", ...(sessionId ? ["--session", sessionId] : []), "employee"],
          baseEnvironment: h.launch.baseEnvironment } };
      },
    });
    const run = async (id: string, attempt: string) => {
      const tabId = attempt + "-tab"; h.tabs.set(tabId, { id: tabId, cli: "opencode", sessionId: "local_" + id }); h.resources.recordCreated(tabId);
      const consumer = h.resources.beginConsumer(tabId); service.authorizeAttempt("leader", id, attempt);
      try {
        const handle = await service.run("leader", id, {}, h.expected, undefined, { tabTarget: consumer.target });
        assert.equal((await handle.lifecycle)?.processTerminal.status, "confirmed"); consumer.finish();
        await service.observe("leader", attempt).done;
      } catch (error) { consumer.finish(false); throw error; }
    };
    await run("source", "source-attempt");
    const original = h.rows().bindings[0], directory = fs.readFileSync(h.file("native-directory"), "utf8");
    assert.equal(fs.existsSync(directory), false);
    scheduler.finish({ subtaskId: "source", attemptId: "source-attempt", outcome: "completed" });
    const self = fault === "self-retry" || fault === "self-source-changed" || fault === "self-await-source-changed";
    if (self) {
      const review = scheduler.claimNextReview(); assert.ok(review.ok && review.item);
      assert.equal(scheduler.submitReviewBatch([review.item.eventId], "failed").ok, true);
    }
    const successor = self ? "source" : "successor";
    scheduler.dispatch([{ subtaskId: successor, attemptId: "next-attempt" }]);
    assert.ok(updateLoopTaskRecord("leader", { subTasks: self
      ? h.readTask("leader")!.subTasks.map(v => ({ ...v, status: "running" as const }))
      : [...h.readTask("leader")!.subTasks.map(v => ({ ...v, status: "completed" as const })),
        { id: successor, title: successor, status: "running", continueFromSubtaskId: "source" }], loopPlus: scheduler.snapshot() }));
    const current = h.store.read("root", h.workspace); assert.ok(current.ok && current.value);
    current.value.capacity.employees = [JSON.stringify(["leader", "next-attempt"]), ...(fault === "capacity-retained" ? [JSON.stringify(["leader", "source-attempt"])] : [])];
    assert.equal(h.store.write(current.value).ok, true);
    if (fault === "source-changed" || fault === "self-source-changed") {
      const task = h.readTask("leader")!;
      const snapshot = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
      snapshot.seenAttempts.push({ subtaskId: "source", attemptId: "later-source", disposition: "reviewed", outcome: "failed", acceptance: "failed" });
      assert.ok(updateLoopTaskRecord("leader", { loopPlus: snapshot }));
    }
    if (fault === "self-await-source-changed") {
      holdPreparation = true;
      const pending = run(successor, "next-attempt");
      const rejected = assert.rejects(pending, /department-process-authority-changed/);
      await preparing.promise;
      const snapshot = scheduler.snapshot();
      snapshot.seenAttempts.push({ subtaskId: "source", attemptId: "unrelated-later", disposition: "reviewed", outcome: "failed", acceptance: "failed" });
      assert.ok(updateLoopTaskRecord("leader", { loopPlus: snapshot }));
      releasePreparation.resolve(); await rejected;
      assert.equal(h.events().filter(v => v === "session-moved").length, 0);
      assert.equal(h.events().filter(v => v === "task-run").length, 1);
      return;
    }
    if (fault === "unknown" || fault === "concurrent") {
      const target = { ...original.identity, subtaskId: successor, attemptId: "next-attempt", ownerId: "reserved-owner", executionId: "reserved-execution" };
      const reserve = () => h.producer.prepareNativeContinuation(target, original.selection, "source", () => undefined);
      const reserved = await Promise.allSettled(fault === "concurrent" ? [reserve(), reserve()] : [reserve()]);
      assert.equal(reserved.filter(v => v.status === "fulfilled").length, 1);
      assert.equal(reserved.filter(v => v.status === "rejected").length, fault === "concurrent" ? 1 : 0);
      // No matching original target client/binding exists: the unknown outcome
      // cannot be retried by this or a different target, even after cleanup A.
    }
    if (!["none", "successive", "self-retry", "third-capacity", "third-not-stopped", "third-source-changed"].includes(fault)) {
      await assert.rejects(run(successor, "next-attempt"));
      assert.equal(h.events().filter(v => v === "session-moved").length, 0);
      assert.equal(h.rows().set.entries.at(-1)?.executionId, null, "failed continuation retains its original responsibility");
      return;
    }
    await run(successor, "next-attempt");
    const next = h.rows().bindings.at(-1)!;
    assert.deepEqual(next.identity.session, original.identity.session); assert.notEqual(next.identity.ownerId, original.identity.ownerId);
    assert.equal(h.rows().set.state, "open", "same-generation employee continuation never needed a CLOSED group");
    assert.equal(h.events().filter(v => v === "session-created").length, 1);
    assert.equal(h.events().filter(v => v === "session-moved").length, 1);
    assert.equal(h.events().filter(v => v === "task-run").length, 2);
    if (!["successive", "self-retry", "third-capacity", "third-not-stopped", "third-source-changed"].includes(fault)) return;
    const nextDirectory = fs.readFileSync(h.file("native-directory"), "utf8");
    assert.equal(fs.existsSync(nextDirectory), false);
    assert.notEqual(nextDirectory, directory);
    scheduler.finish({ subtaskId: successor, attemptId: "next-attempt", outcome: "completed" });
    if (self) {
      const review = scheduler.claimNextReview(); assert.ok(review.ok && review.item);
      assert.equal(scheduler.submitReviewBatch([review.item.eventId], "failed").ok, true);
    }
    const third = self ? successor : "third";
    scheduler.dispatch([{ subtaskId: third, attemptId: "third-attempt" }]);
    assert.ok(updateLoopTaskRecord("leader", { subTasks: self
      ? h.readTask("leader")!.subTasks.map(v => ({ ...v, status: "running" as const }))
      : [...h.readTask("leader")!.subTasks.map(v => ({ ...v, status: "completed" as const })),
        { id: third, title: third, status: "running", continueFromSubtaskId: successor }], loopPlus: scheduler.snapshot() }));
    const beforeThird = h.store.read("root", h.workspace); assert.ok(beforeThird.ok && beforeThird.value);
    beforeThird.value.capacity.employees = [JSON.stringify(["leader", "third-attempt"]),
      ...(fault === "third-capacity" ? [JSON.stringify(["leader", "next-attempt"])] : [])];
    assert.equal(h.store.write(beforeThird.value).ok, true);
    const stale = { ...original.identity, subtaskId: third, attemptId: "third-attempt", ownerId: "stale-owner", executionId: "stale-execution" };
    if (!self) await assert.rejects(h.producer.prepareNativeContinuation(stale, original.selection, "source", () => undefined), /already-reserved/);
    if (fault === "third-source-changed") {
      const snapshot = scheduler.snapshot();
      snapshot.seenAttempts.push({ subtaskId: successor, attemptId: "later-unbound-source", disposition: "reviewed", outcome: "failed", acceptance: "failed" });
      assert.ok(updateLoopTaskRecord("leader", { loopPlus: snapshot }));
    }
    if (["third-capacity", "third-not-stopped", "third-source-changed"].includes(fault)) {
      await assert.rejects(run(third, "third-attempt"));
      assert.equal(h.events().filter(v => v === "session-moved").length, 1);
      assert.equal(h.events().filter(v => v === "task-run").length, 2);
      assert.equal(h.rows().set.entries.at(-1)?.executionId, null);
      return;
    }
    await run(third, "third-attempt");
    const last = h.rows().bindings.at(-1)!;
    assert.deepEqual(last.identity.session, original.identity.session);
    assert.equal(continuations.length, 2);
    assert.throws(() => continuations[0].assertCurrent(), /already-reserved/, "late old capability cannot validate a later move");
    assert.equal(new Set(h.rows().bindings.map(v => v.identity.ownerId)).size, 3);
    assert.equal(new Set(h.rows().bindings.map(v => v.identity.executionId)).size, 3);
    assert.notEqual(fs.readFileSync(h.file("native-directory"), "utf8"), nextDirectory);
    assert.equal(h.events().filter(v => v === "session-created").length, 1);
    assert.equal(h.events().filter(v => v === "session-moved").length, 2);
    assert.equal(h.events().filter(v => v === "task-run").length, 3);
    assert.equal(h.rows().set.state, "open");
    for (const binding of h.rows().bindings) {
      const client = h.producer.originalClient(binding); assert.ok(client);
      await client.waitForCleanup(binding.identity, binding.requirements);
    }
  });
}

for (const phase of ["before-consume", "after-consume"] as const) scenario(`authority second client seals ${phase} at the real OpenCode Owner grant boundary`, async t => {
  const h = await setup(t, undefined, false, false, false, false, true);
  const scope = h.producer.scope("leader"), directory = departmentGenerationAuthorityDirectory(h.file("authorities"), scope);
  const authority = readDepartmentGenerationAuthority(directory); assert.ok(authority);
  const entered = gate(), release = gate();
  const consume = h.producer.producer.consumeResponsibility!.bind(h.producer.producer);
  t.mock.method(h.producer.producer as { consumeResponsibility: typeof consume }, "consumeResponsibility", async (...args: Parameters<typeof consume>) => {
    if (phase === "after-consume") await consume(...args);
    entered.resolve(); await release.promise;
    if (phase === "before-consume") await consume(...args);
  });
  const running = h.run("late-grant");
  await entered.promise;
  assert.equal(h.rows().bindings.length, 1);
  await new DepartmentGenerationAuthorityClient(directory, scope, authority.snapshot.producerId).seal();
  let returned = false;
  const closing = phase === "after-consume" ? h.producer.close("leader").then(result => { returned = true; return result; }) : undefined;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, false, "consumed in-flight authorization remains original drain responsibility");
  release.resolve();
  const result = await running;
  assert.ok(result.errors.length > 0);
  assert.equal(h.events().includes("task-run"), false);
  const closed = await (closing ?? h.producer.close("leader"));
  assert.equal(closed.ok, false);
  assert.equal(h.rows().set.state, "open");
  const retained = readDepartmentGenerationAuthority(directory)!.snapshot;
  assert.equal(retained.state, "sealed");
  assert.equal(retained.tickets[0].state, phase === "before-consume" ? "bound" : "started");
  assert.deepEqual(retained.tickets[0].identity, h.rows().bindings[0].identity);
  const saved = h.store.read("root", h.workspace); assert.ok(saved.ok && saved.value);
  assert.deepEqual(saved.value.capacity.leaders, ["module"]);
});

for (const fault of ["unreachable", "persistence"] as const) scenario(`authority ${fault} still drains original OpenCode Owner and awaits retained work without closure`, async t => {
  const h = await setup(t, undefined, false, false, false, false, true);
  const scope = h.producer.scope("leader"), directory = departmentGenerationAuthorityDirectory(h.file("authorities"), scope);
  assert.equal((await h.run("before-authority-fault")).errors.length, 0);
  const binding = h.rows().bindings[0], original = h.producer.originalClient(binding); assert.ok(original);
  const entered = gate(), release = gate();
  const pending = h.producer.track("leader", async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  if (fault === "unreachable") {
    const authorityWorker = h.workers.find(value => value.module.endsWith("departmentgenerationauthorityworker.js")); assert.ok(authorityWorker);
    const exited = new Promise<void>(resolve => authorityWorker.child.once("exit", () => resolve()));
    authorityWorker.child.kill(); await exited; // Fault injection, never cleanup proof.
  } else {
    // The real client authenticates first, then the child's atomic rename fails.
    // No IPC response or cleanup proof is synthesized by this fault injection.
    const seal = DepartmentGenerationAuthorityClient.prototype.seal;
    t.mock.method(DepartmentGenerationAuthorityClient.prototype, "seal", async function (this: DepartmentGenerationAuthorityClient) {
      fs.renameSync(path.join(directory, "authority.json"), path.join(directory, "authority-original.json"));
      fs.mkdirSync(path.join(directory, "authority.json"));
      return seal.call(this);
    });
  }
  let returned = false;
  const closing = h.producer.close("leader").then(value => { returned = true; return value; });
  await until(() => h.events().includes("tab-closed"));
  assert.equal(returned, false, "authority failure cannot discard retained preparation");
  release.resolve(); await pending;
  const result = await closing; assert.equal(result.ok, false);
  assert.equal(h.rows().set.state, "open");
  const receipt = await original.waitForCleanup(binding.identity, binding.requirements);
  for (const [part, required] of Object.entries(binding.requirements))
    if (required) assert.equal(receipt.cleanup[part as keyof typeof binding.requirements].status, "confirmed");
  const saved = h.store.read("root", h.workspace); assert.ok(saved.ok && saved.value);
  assert.deepEqual(saved.value.capacity.leaders, ["module"]);
  h.host.release("leader");
});

scenario("OpenCode production freezes inherited EH environment per original generation without bypassing launch conflicts", async (t) => {
  const h = await setup(t, undefined, false, false, false, false, true, true);
  const firstEnvironment = { ...h.launch.baseEnvironment };
  h.launch.baseEnvironment = h.host.captureOpenCodeEnvironment("leader", firstEnvironment);
  assert.equal((await h.run("environment-first")).errors.length, 0);
  // Deterministically reproduce VS Code's late l10n mutation from the old log.
  const laterEnvironment = { ...firstEnvironment, VSCODE_L10N_BUNDLE_LOCATION: "" };
  h.launch.baseEnvironment = laterEnvironment;
  const rejected = await h.run("environment-conflict", undefined, undefined, false);
  assert.match(rejected.errors[0]?.message ?? "", /^department-leader-opencode-busy-or-conflict:launch$/);
  assert.equal(h.events().filter(e => e === "task-run").length, 1);
  // The actual extension call captures once; no grant/session/Owner is cached.
  h.launch.baseEnvironment = h.host.captureOpenCodeEnvironment("leader", laterEnvironment);
  assert.deepEqual(h.launch.baseEnvironment, firstEnvironment);
  h.host.captureOpenCodeEnvironment("leader").PATH = "caller-cannot-mutate-original";
  assert.deepEqual(h.host.captureOpenCodeEnvironment("leader"), firstEnvironment);
  assert.equal((await h.run("environment-second")).errors.length, 0);
  assert.equal(h.rows().bindings.length, 1);
  assert.equal(h.events().filter(e => e === "session-created").length, 1);
  assert.equal(h.events().filter(e => e === "task-run").length, 2);
  const duplicate = await h.run("environment-second", undefined, undefined, false);
  assert.match(duplicate.errors[0]?.message ?? "", /:duplicate-invocation$/);
  const observation = h.groupCleanup.observe(h.readTask("leader")!, 1); assert.ok(observation); await observation.done;
  const saved = h.store.read("root", h.workspace); assert.ok(saved.ok && saved.value);
  saved.value.capacity.leaders = []; assert.equal(h.store.write(saved.value).ok, true);
  await h.producer.retire("leader", 1);
  await until(() => h.workers.every(({ child }) => child.exitCode === 0 && child.signalCode === null));
  assert.equal(h.rows().set.state, "closed"); h.host.release("leader");
});
