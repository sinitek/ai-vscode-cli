import { fixtureEmployeeAdmission } from "./fixtures/departmentemployeeadmission";
import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fork } from "child_process";
import { once } from "events";
import { SharedRuntimeConfig } from "../../config/sharedRuntimeConfig";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { createDepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import { DepartmentRuntimeStore } from "../../extensionHost/departmentruntimestore";
import { createDepartmentCodexPreparation, type DepartmentCodexPreparationHost } from "../../extensionHost/departmentcodexpreparation";
import { startDepartmentCodexOwner } from "../../extensionHost/departmentcodexbootstrap";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection, type DepartmentExecutionIdentity } from "../../runtime/departmentexecutionidentity";
import { isDepartmentCodexPreparation } from "../../runtime/departmentcodexpreparationcontract";
import { fixturePreparation } from "./fixtures/departmentcodexownerworker";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { CodexOwnedStreamHandlers } from "../../interactive/codexOwnedExecution";
assert.throws(() => require.resolve("vscode"), { code: "MODULE_NOT_FOUND" });
export async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error("fixture-gate-not-reached"); await new Promise((resolve) => setTimeout(resolve, 5)); }
}
const waitFile = (file: string) => until(() => fs.existsSync(file));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
async function setup(t: test.TestContext, bound = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-codex-production-"));
  const file = (name: string) => path.join(directory, name);
  fs.mkdirSync(file("workspace")); fs.writeFileSync(path.join(file("workspace"), "source.txt"), "controlled source");
  const config = new SharedRuntimeConfig(file("configuration")), current = await config.change(async () => ({ configId: "profile", profileDigest: null }));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "codex", role: "employee", configId: "profile", revision: current.revision, model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module", generation: 1,
    role: "employee", cli: "codex", subtaskId: "subtask", attemptId: "attempt", ownerId: "owner", executionId: "execution",
    session: bound ? { state: "bound", id: "native" } : { state: "unbound" }, ...fingerprintDepartmentExecutionSelection(selection) };
  const { prepared } = fixturePreparation(directory, identity, selection);
  prepared.runner.configFingerprint = identity.configFingerprint;
  prepared.runner.model = null;
  const protocol = fs.readFileSync(prepared.runner.command, "utf8").replace("const file=n=>", "fs.writeFileSync(path.join(ROOT,'native-pid'),String(process.pid));fs.writeFileSync(path.join(ROOT,'owner-pid'),String(process.ppid));const file=n=>");
  fs.writeFileSync(prepared.runner.command, protocol);
  const route = { cli: "codex" as const, configId: "profile", thinkingMode: "medium" as const };
  const metadata = { version: 1 as const, rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", role: "leader" as const,
    moduleTitle: "module", routes: { director: route, leader: route, employee: route }, limits: { maxLeaders: 4, maxEmployees: 20 } };
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "subtask", attemptId: "attempt" }]);
  const leader = { id: "leader", workspaceKey: "workspace", status: "running", cli: "codex", department: metadata,
    subTasks: [{ id: "subtask", title: "subtask", status: "running", ...(bound ? { executionSession: { cli: "codex", sessionId: "native", configId: "profile" } } : {}) }],
    loopPlus: scheduler.snapshot() } as LoopTaskRecord;
  const root = { ...leader, id: "root", subTasks: [{ id: "module", title: "module", status: "running" }], department: { ...metadata, role: "director", parentTaskId: null, leaderSubtaskId: null } } as LoopTaskRecord;
  const tasks = new Map([[root.id, root], [leader.id, leader]]), store = new DepartmentRuntimeStore(file("runtime"));
  const runtime = createDepartmentRuntimeSnapshot("root"); runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", status: "running", generation: 1 });
  assert.equal(store.write({ version: 1, rootTaskId: "root", workspaceKey: "workspace", runtime,
    capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: ["module"], employees: [JSON.stringify(["leader", "attempt"])] } }).ok, true);
  const admission = fixtureEmployeeAdmission(store);
  const host: DepartmentCodexPreparationHost = { store, employeeAdmission: admission.port, ownerDirectory: file("owners"), workspaceKey: () => "workspace", readTask: (id) => tasks.get(id) ?? null,
    updateTask(id, patch) { const task = tasks.get(id); if (!task) return null; const next = { ...task, ...patch }; tasks.set(id, next); return next; } };
  const description = { runner: { ...prepared.runner, env: { ...prepared.runner.env } }, prompt: prepared.prompt, macTaskShell: "bash" as const,
    configurationDirectory: file("configuration"), workspaceDirectory: file("workspace"), requestUserInputEnabled: false };
  delete description.runner.cwd;
  const wire = () => fs.existsSync(file("wire.jsonl")) ? fs.readFileSync(file("wire.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  let serial = 0;
  const control = async (value: unknown) => { const name = `control-${++serial}.json`; fs.writeFileSync(file(name + ".tmp"), JSON.stringify(value)); fs.renameSync(file(name + ".tmp"), file(name)); await waitFile(file(name + ".ack")); };
  const handlers: CodexOwnedStreamHandlers = { onAssistantDelta() {}, onTrace() {}, onTaskListUpdate() {}, onThreadId() {} };
  t.after(async () => {
    // Fixture teardown only, never counted as cleanup proof. Workers may retain unknown resources.
    const pids = new Set<number>();
    try { pids.add(Number(fs.readFileSync(file("owner-pid"), "utf8"))); } catch {}
    try { const pid = Number(fs.readFileSync(file("native-pid"), "utf8")); if (pid > 0) { try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} } } } catch {}
    for (const pid of pids) if (pid > 1 && pid !== process.pid) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await new Promise((resolve) => setTimeout(resolve, 30));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { admission, directory, file, config, current, selection, identity, description, host, tasks, store, handlers, wire, control,
    count: (method: string) => wire().filter((v) => v.method === method).length,
    input: () => ({ ...description, identity, selection, ownerDirectory: file("owners/owner") }) };
}
const terminal = { method: "turn/completed", params: { threadId: "native", turn: { id: "turn", status: "completed" } } };
async function finish(h: Awaited<ReturnType<typeof setup>>) {
  await h.control({ response: "turn", messages: [terminal] }); await waitFile(h.file("stdin-eof")); await h.control({ close: true });
}

for (const forged of [false, true]) test(`employee admission ${forged ? "forged" : "missing"} capability rejects before codex builder`, async (t) => {
  const h = await setup(t);
  h.host.employeeAdmission = forged ? {} as NonNullable<typeof h.host.employeeAdmission> : null;
  const service = createDepartmentCodexPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", h.handlers, h.current, async () => { assert.fail("builder must not run"); }), /admission-unavailable/);
  assert.equal(h.admission.entries().length, 0); assert.equal(h.wire().length, 0);
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value); assert.equal(read.value.capacity.employees.length, 1);
});

test("codex failed builder retains stable responsibility and independently records later attempt", async (t) => {
  const h = await setup(t);
  const prepare = async () => {
    const entries = h.admission.entries(); assert.equal(entries[entries.length - 1].executionId, null);
    throw new Error("controlled-builder-failed");
  };
  const first = createDepartmentCodexPreparation(h.host); first.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(first.run("leader", "subtask", h.handlers, h.current, prepare), /builder-failed/);
  const registration = h.admission.entries()[0].responsibility.registrationId;
  const duplicate = createDepartmentCodexPreparation(h.host); duplicate.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(duplicate.run("leader", "subtask", h.handlers, h.current, prepare), /builder-failed/);
  assert.equal(h.admission.entries().length, 1); assert.equal(h.admission.entries()[0].responsibility.registrationId, registration);
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "subtask", attemptId: "attempt-2" }]);
  h.tasks.get("leader")!.loopPlus = scheduler.snapshot();
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
  read.value.capacity.employees.push(JSON.stringify(["leader", "attempt-2"])); assert.equal(h.store.write(read.value).ok, true);
  const second = createDepartmentCodexPreparation(h.host); second.authorizeAttempt("leader", "subtask", "attempt-2");
  await assert.rejects(second.run("leader", "subtask", h.handlers, h.current, prepare), /builder-failed/);
  assert.deepEqual(h.admission.entries().map((e) => e.executionId), [null, null]);
  assert.notEqual(h.admission.entries()[1].responsibility.registrationId, registration);
  assert.equal(h.admission.active, 0); assert.equal(h.wire().length, 0);
});

test("codex producer revocation during builder retains null and forbids native preparation", async (t) => {
  const h = await setup(t), service = createDepartmentCodexPreparation(h.host);
  service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", h.handlers, h.current, async () => {
    assert.equal(h.admission.entries()[0].executionId, null); h.admission.revoke(); return h.description;
  }), /admission-revoked/);
  assert.equal(h.admission.entries()[0].executionId, null); assert.equal(h.wire().length, 0);
});

for (const mode of ["requirements", "producer-revoked"] as const) test(`codex ${mode} refuses grant and retains original responsibility`, { timeout: 20000 }, async (t) => {
  const h = await setup(t), cp = require("child_process") as typeof import("child_process"), original = cp.fork;
  let release: (() => void) | undefined;
  t.mock.method(cp, "fork", (...args: Parameters<typeof cp.fork>) => {
    assert.equal(h.admission.entries()[0].executionId, null);
    const child = original(...args), emit = child.emit.bind(child);
    child.emit = ((event: string, ...values: any[]) => {
      if (event === "message" && values[0]?.type === "prepared" && mode === "requirements") values[0].requirements.tab = false;
      if (event === "message" && values[0]?.type === "owner-bound" && mode === "producer-revoked") {
        release = () => { emit(event, ...values); }; return true;
      }
      return emit(event, ...values);
    }) as typeof child.emit; return child;
  });
  const service = createDepartmentCodexPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  const run = service.run("leader", "subtask", h.handlers, h.current, async () => h.description), rejected = assert.rejects(run);
  if (mode === "producer-revoked") {
    await until(() => !!release); assert.equal(h.admission.active, 1);
    assert.notEqual(h.admission.entries()[0].executionId, null);
    h.admission.revoke(); release!();
  }
  await waitFile(h.file("stdin-eof")); await h.control({ close: true }); await rejected;
  if (release) release();
  assert.equal(h.admission.entries()[0].executionId === null, mode === "requirements");
  assert.equal(h.admission.active, 0); assert.equal(h.count("turn/start"), 0);
});

for (const bound of [false, true]) test(`production coordinator ${bound ? "resume" : "new"} persists exact native identity before one task`, { timeout: 20000 }, async (t) => {
  const h = await setup(t, bound), service = createDepartmentCodexPreparation(h.host);
  service.authorizeAttempt("leader", "subtask", "attempt");
  const prepareGate = deferred();
  const prepare = async () => {
    assert.equal(h.admission.active, 1);
    assert.equal(h.admission.entries()[0].executionId, null);
    assert.equal(h.wire().length, 0);
    await prepareGate.promise; return h.description;
  };
  const bind = h.store.bindLeaderExecution.bind(h.store);
  t.mock.method(h.store, "bindLeaderExecution", (...args: Parameters<typeof bind>) => {
    assert.equal(h.admission.active, 1); assert.equal(h.count("turn/start"), 0);
    const result = bind(...args);
    assert.equal(h.admission.entries()[0].executionId, args[3].identity.executionId);
    return result;
  });
  const run = service.run("leader", "subtask", h.handlers, h.current, prepare);
  assert.equal(service.run("leader", "subtask", h.handlers, h.current, prepare), run);
  assert.equal(h.count("turn/start"), 0); prepareGate.resolve(); await waitFile(h.file("task-started"));
  assert.equal(h.count(bound ? "thread/resume" : "thread/start"), 1); assert.equal(h.count("turn/start"), 1);
  assert.equal(h.admission.active, 0);
  assert.deepEqual(h.host.readTask("leader")!.subTasks[0].executionSession, { cli: "codex", configId: "profile", sessionId: "native" });
  const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
  const binding = state.value.executionBindings![0]; assert.equal(binding.identity.session.state, "bound");
  assert.notEqual(Number(fs.readFileSync(h.file("owner-pid"), "utf8")), process.pid);
  assert.equal((await h.config.change(async () => ({ configId: "other", profileDigest: null }))).configId, "other");
  await finish(h); await run;
  assert.equal(h.count("turn/start"), 1);
  await until(async () => (await new DepartmentExecutionOwnerClient(path.join(h.directory, "owners", binding.identity.ownerId)).observeExecution(binding.identity)).status === "unknown");
  assert.equal(h.store.read("root", "workspace").ok, true);
});

for (const mode of ["session-write", "store-bind", "session-conflict", "cancel-prepare", "cancel-persist", "final-revoke", "resume-conflict"] as const) {
  test(`${mode}: failure or revocation sends no task and never retries`, { timeout: 20000 }, async (t) => {
    const h = await setup(t, mode === "resume-conflict"), service = createDepartmentCodexPreparation(h.host), abort = new AbortController();
    service.authorizeAttempt("leader", "subtask", "attempt");
    if (mode === "session-write") h.host.updateTask = () => null;
    if (mode === "store-bind") t.mock.method(h.store, "bindLeaderExecution", () => ({ ok: false, error: "controlled-failure" }));
    if (mode === "session-conflict") { const update = h.host.updateTask; h.host.updateTask = (id, patch) => { const result = update(id, patch); h.tasks.get(id)!.subTasks[0].executionSession!.sessionId = "wrong"; return result; }; }
    if (mode === "cancel-persist") { const update = h.host.updateTask; h.host.updateTask = (id, patch) => { const result = update(id, patch); abort.abort(); return result; }; }
    if (mode === "final-revoke") { const bind = h.store.bindLeaderExecution.bind(h.store); t.mock.method(h.store, "bindLeaderExecution", (...args: Parameters<typeof bind>) => { const result = bind(...args); h.tasks.get("root")!.status = "stopped"; return result; }); }
    if (mode === "resume-conflict") {
      const source = fs.readFileSync(h.description.runner.command, "utf8").replace("BAD=false", "BAD=true"); fs.writeFileSync(h.description.runner.command, source);
    }
    const gate = deferred();
    const prepare = async () => { if (mode === "cancel-prepare") { abort.abort(); await gate.promise; } return h.description; };
    const run = service.run("leader", "subtask", h.handlers, h.current, prepare, { signal: abort.signal }); gate.resolve();
    if (mode !== "cancel-prepare") { await waitFile(h.file("stdin-eof")); await h.control({ close: true }); }
    await assert.rejects(run); assert.equal(h.count("turn/start"), 0);
    assert.equal(h.admission.entries().length, 1);
    assert.equal(h.admission.entries()[0].executionId === null, mode !== "final-revoke");
    assert.equal(service.run("leader", "subtask", h.handlers, h.current, prepare, { signal: abort.signal }).catch(() => undefined) instanceof Promise, true);
    assert.equal(h.count("turn/start"), 0);
  });
}

test("private dual persistence and final Owner-binding gates; late grant ACK cannot revive cancellation", { timeout: 20000 }, async (t) => {
  const h = await setup(t), gate = deferred(), abort = new AbortController(); let entered = false;
  const launch = startDepartmentCodexOwner(h.input(), { handlers: h.handlers, signal: abort.signal, assertAuthorized() {},
    async persist() { entered = true; await gate.promise; } });
  await until(() => entered); assert.equal(h.count("turn/start"), 0); abort.abort(); await assert.rejects(launch);
  gate.resolve(); await waitFile(h.file("stdin-eof")); await h.control({ close: true });
  await until(() => !fs.existsSync(h.file("owners/owner/owner.lock")));
  assert.equal(h.count("turn/start"), 0);
});

test("grant authorization follows persistence and original Owner binding; final revocation is zero task", { timeout: 20000 }, async (t) => {
  const h = await setup(t); let persisted = false, boundSeen = false;
  const { DepartmentExecutionReceiptStore } = await import("../../runtime/departmentexecutionreceiptstore");
  await assert.rejects(startDepartmentCodexOwner(h.input(), { handlers: h.handlers, async persist() { persisted = true; },
    assertAuthorized() {
      if (!persisted) return;
      const record = new DepartmentExecutionReceiptStore(h.file("owners/owner")).read("execution", h.identity);
      if (record.kind === "ok" && record.value.identity.session.state === "bound") { boundSeen = true; throw new Error("final-authority-revoked"); }
    } }));
  assert.equal(persisted, true); assert.equal(boundSeen, true); assert.equal(h.count("turn/start"), 0);
});

for (const extra of ["worker", "module", "auth", "requirements"]) test(`private contract rejects ${extra}`, async (t) => {
  const h = await setup(t), wire = { ...h.input(), version: 1, token: "a".repeat(64) };
  assert.equal(isDepartmentCodexPreparation(wire), true);
  assert.equal(isDepartmentCodexPreparation({ ...wire, [extra]: "forbidden" }), false);
});

test("source completion waits for asynchronous EH consumers before physical streams mapping", { timeout: 20000 }, async (t) => {
  const h = await setup(t), callback = deferred(); let entered = false, done = false;
  h.handlers.onAssistantDelta = async () => { entered = true; await callback.promise; };
  const owner = await startDepartmentCodexOwner(h.input(), { handlers: h.handlers, async persist() {}, assertAuthorized() {} });
  void owner.completion.then(() => { done = true; });
  await waitFile(h.file("task-started"));
  await h.control({ response: "turn", messages: [{ method: "item/agentMessage/delta", params: { threadId: "native", turnId: "turn", delta: "answer" } }, terminal] });
  await until(() => entered); await waitFile(h.file("stdin-eof")); await h.control({ close: true });
  assert.equal(done, false); callback.resolve();
  const facts = await owner.completion; assert.equal(facts.turnTerminal.status, "confirmed"); assert.equal(facts.streams.status, "confirmed"); owner.disconnect();
});

for (const stage of ["prepared", "session", "owner-bound"]) test(`cancel while ${stage} ACK is delayed does not revive on late delivery`, { timeout: 20000 }, async (t) => {
  const h = await setup(t), abort = new AbortController();
  const cp = require("child_process") as typeof import("child_process");
  const original = cp.fork;
  let release: (() => void) | undefined;
  t.mock.method(cp, "fork", (...args: Parameters<typeof cp.fork>) => {
    const child = original(...args), emit = child.emit.bind(child);
    child.emit = ((event: string, ...values: unknown[]) => {
      if (event === "message" && (values[0] as { type?: string })?.type === stage && !release) {
        release = () => { emit(event, ...values); }; return true;
      }
      return emit(event, ...values);
    }) as typeof child.emit;
    return child;
  });
  const launch = startDepartmentCodexOwner(h.input(), { handlers: h.handlers, async persist() {}, assertAuthorized() {}, signal: abort.signal });
  await until(() => !!release); assert.equal(h.count("turn/start"), 0); abort.abort(); await assert.rejects(launch);
  release!();
  if (stage !== "prepared") { await waitFile(h.file("stdin-eof")); await h.control({ close: true }); }
  await until(() => !fs.existsSync(h.file("owners/owner/owner.lock")));
  assert.equal(h.count("turn/start"), 0);
});

test("original granted Owner survives startup host exit; new host only observes", { timeout: 20000 }, async (t) => {
  const h = await setup(t);
  for (const task of h.tasks.values()) fs.writeFileSync(h.file(task.id + "-task"), JSON.stringify(task));
  fs.writeFileSync(h.file("expected"), JSON.stringify(h.current)); fs.writeFileSync(h.file("description"), JSON.stringify(h.description));
  const host = fork(path.join(__dirname, "fixtures", "departmentcodexproductionhost.js"), [h.directory], {
    stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, HOME: h.directory, USERPROFILE: h.directory, CODEX_HOME: h.file(".codex") },
  });
  const [code] = await once(host, "exit"); assert.equal(code, 0);
  const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
  const binding = state.value.executionBindings![0], client = new DepartmentExecutionOwnerClient(path.join(h.directory, "owners", binding.identity.ownerId));
  assert.equal((await client.observeExecution(binding.identity)).status, "live"); assert.equal((await client.startExecution(binding.identity)).status, "live");
  const ownerPid = Number(fs.readFileSync(h.file("owner-pid"), "utf8"));
  assert.notEqual(ownerPid, host.pid); assert.equal(process.kill(ownerPid, 0), true);
  h.host.employeeAdmission = null;
  const stale = createDepartmentCodexPreparation(h.host);
  await assert.rejects(stale.run("leader", "subtask", h.handlers, h.current, async () => { throw new Error("must-not-prepare"); }), /existing-binding-conflict/);
  // The startup host is the sole writer; recovery must cold-read its persisted task,
  // not use the parent fixture's pre-session Map as native identity authority.
  for (const id of h.tasks.keys()) h.tasks.set(id, JSON.parse(fs.readFileSync(h.file(id + "-task"), "utf8")));
  const recovered = createDepartmentCodexPreparation(h.host);
  await assert.rejects(recovered.run("leader", "subtask", h.handlers, h.current, async () => { throw new Error("must-not-prepare"); }), /observe-only:live/);
  assert.equal(h.count("turn/start"), 1); await finish(h);
  await until(async () => (await client.observeExecution(binding.identity)).status === "unknown");
  assert.equal(h.count("turn/start"), 1);
});

test("two persistent stages and final grant each retain zero task until all confirmations", { timeout: 20000 }, async (t) => {
  const h = await setup(t), taskWrite = deferred(), storeWrite = deferred(); let stage = 0;
  const launch = startDepartmentCodexOwner(h.input(), { handlers: h.handlers, assertAuthorized() {}, async persist() {
    stage = 1; await taskWrite.promise; stage = 2; await storeWrite.promise; stage = 3;
  } });
  await until(() => stage === 1); assert.equal(h.count("turn/start"), 0);
  taskWrite.resolve(); await until(() => stage === 2); assert.equal(h.count("turn/start"), 0);
  storeWrite.resolve(); const owner = await launch; await waitFile(h.file("task-started"));
  assert.equal(stage, 3); assert.equal(h.count("turn/start"), 1); await finish(h); await owner.completion; owner.disconnect();
});

test("asynchronous server request remains a responsibility through transport completion", { timeout: 20000 }, async (t) => {
  const h = await setup(t), gate = deferred(); let entered = false;
  h.handlers.onRequest = async () => { entered = true; await gate.promise; return { result: {} }; };
  const owner = await startDepartmentCodexOwner(h.input(), { handlers: h.handlers, async persist() {}, assertAuthorized() {} });
  await waitFile(h.file("task-started"));
  await h.control({ response: "turn", messages: [{ id: 998, method: "item/commandExecution/requestApproval", params: { threadId: "native", turnId: "turn", command: "fixture" } }, terminal] });
  await until(() => entered); assert.equal(fs.existsSync(h.file("stdin-eof")), false);
  gate.resolve(); await waitFile(h.file("stdin-eof")); await h.control({ close: true });
  const facts = await owner.completion; assert.equal(facts.streams.status, "confirmed"); assert.ok(h.wire().some((m) => m.id === 998 && m.result)); owner.disconnect();
});

test("EH consumer rejection prevents combined streams success and full receipt", { timeout: 20000 }, async (t) => {
  const h = await setup(t);
  h.handlers.onAssistantDelta = () => { throw new Error("consumer-failure"); };
  const owner = await startDepartmentCodexOwner(h.input(), { handlers: h.handlers, async persist() {}, assertAuthorized() {} });
  await waitFile(h.file("task-started"));
  await h.control({ response: "turn", messages: [{ method: "item/agentMessage/delta", params: { threadId: "native", turnId: "turn", delta: "answer" } }, terminal] });
  await waitFile(h.file("stdin-eof")); await h.control({ close: true });
  assert.notEqual((await owner.completion).streams.status, "confirmed"); owner.disconnect();
});

test("timestamps, chat and reports do not revoke the exact execution authority", { timeout: 20000 }, async (t) => {
  const h = await setup(t), service = createDepartmentCodexPreparation(h.host);
  service.authorizeAttempt("leader", "subtask", "attempt");
  const run = service.run("leader", "subtask", h.handlers, h.current, async () => {
    h.tasks.get("leader")!.updatedAt = Date.now(); h.tasks.get("leader")!.subTasks[0].summary = "unrelated report";
    return h.description;
  });
  await waitFile(h.file("task-started")); assert.equal(h.count("turn/start"), 1); await finish(h); await run;
});

test("failed native preparation reservation prevents another Owner after host replacement without a binding", { timeout: 20000 }, async (t) => {
  const h = await setup(t), service = createDepartmentCodexPreparation(h.host);
  service.authorizeAttempt("leader", "subtask", "attempt");
  t.mock.method(h.store, "bindLeaderExecution", () => ({ ok: false, error: "controlled-persistence-failure" }));
  const run = service.run("leader", "subtask", h.handlers, h.current, async () => h.description);
  await waitFile(h.file("stdin-eof")); await h.control({ close: true }); await assert.rejects(run);
  const recovered = createDepartmentCodexPreparation(h.host);
  recovered.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(recovered.run("leader", "subtask", h.handlers, h.current, async (_selection, threadId) => ({
    ...h.description, runner: { ...h.description.runner, threadId },
  })), /reserved-or-unknown/);
  assert.equal(h.count("thread/start"), 1); assert.equal(h.count("thread/resume"), 0); assert.equal(h.count("turn/start"), 0);
});

test("private preparation rejects shell type coercion before creating any native execution", async (t) => {
  const h = await setup(t);
  for (const macTaskShell of [["bash"], ["zsh"], null, {}, 1]) {
    const input = { ...h.input(), macTaskShell };
    assert.equal(isDepartmentCodexPreparation({ ...input, version: 1, token: "a".repeat(64) }), false);
    await assert.rejects(startDepartmentCodexOwner(input as unknown as Parameters<typeof startDepartmentCodexOwner>[0], {
      handlers: h.handlers, async persist() { assert.fail("invalid preparation must not persist"); }, assertAuthorized() {},
    }), /private-preparation-invalid/);
  }
  for (const macTaskShell of ["bash", "zsh"]) {
    assert.equal(isDepartmentCodexPreparation({ ...h.input(), macTaskShell, version: 1, token: "a".repeat(64) }), true);
  }
  assert.equal(h.wire().length, 0);
  assert.equal(fs.existsSync(h.file("owners/owner/owner.lock")), false);
});

// Continuation handoff regression: preparation, native response and both records
// must select the same thread before the first task (simulated CLI only).
function continueFromSource(h: Awaited<ReturnType<typeof setup>>) {
  const task = h.tasks.get("leader")!;
  task.subTasks[0].continueFromSubtaskId = "source";
  task.subTasks.push({ id: "source", title: "source", status: "completed",
    executionSession: { cli: "codex", sessionId: "native", configId: "profile" } });
}
test("continuation handoff resumes compatible source before persistence and grant", { timeout: 20000 }, async (t) => {
  const h = await setup(t); continueFromSource(h);
  const service = createDepartmentCodexPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  const run = service.run("leader", "subtask", h.handlers, h.current, async (_, thread) => {
    assert.equal(thread, "native"); assert.equal(h.count("turn/start"), 0);
    return { ...h.description, runner: { ...h.description.runner, threadId: thread } };
  });
  void run.catch(() => undefined);
  await waitFile(h.file("task-started"));
  assert.equal(h.count("thread/start"), 0); assert.equal(h.count("thread/resume"), 1);
  assert.equal(h.wire().find((v) => v.method === "thread/resume").params.threadId, "native");
  const state = h.store.read("root", "workspace"); assert.ok(state.ok && state.value);
  assert.deepEqual(state.value.executionBindings![0].identity.session, { state: "bound", id: "native" });
  assert.equal(h.tasks.get("leader")!.subTasks[0].executionSession?.sessionId, "native");
  await finish(h); await run;
});
for (const change of ["source", "source-config", "target", "stop"] as const) test(`continuation handoff rejects ${change} changed during preparation`, async (t) => {
  const h = await setup(t); continueFromSource(h);
  const service = createDepartmentCodexPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", h.handlers, h.current, async (_, thread) => {
    assert.equal(thread, "native");
    const task = h.tasks.get("leader")!;
    if (change === "source") task.subTasks[1].executionSession!.sessionId = "replacement";
    if (change === "source-config") task.subTasks[1].executionSession!.configId = "other";
    if (change === "target") task.subTasks[0].executionSession = { cli: "codex", configId: "profile", sessionId: "replacement" };
    if (change === "stop") task.status = "stopped";
    return h.description;
  }), /authority|session-handoff-conflict/);
  assert.equal(h.wire().length, 0);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.equal(saved.value.capacity.employees.length, 1);
});
test("continuation handoff rejects conflicting persisted target before native preparation", async (t) => {
  const h = await setup(t); continueFromSource(h);
  h.tasks.get("leader")!.subTasks[0].executionSession = { cli: "codex", configId: "profile", sessionId: "other" };
  const service = createDepartmentCodexPreparation(h.host); service.authorizeAttempt("leader", "subtask", "attempt");
  await assert.rejects(service.run("leader", "subtask", h.handlers, h.current, async () => { assert.fail("no builder"); }), /session/);
  assert.equal(h.wire().length, 0);
});
