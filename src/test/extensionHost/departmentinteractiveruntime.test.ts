import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";
installVscodeMock();
import { CLI_LIST, type CliName } from "../../cli/types";
import { type LoopTaskRecord, mergeLoopTaskRecordPatch } from "../../loopTaskStore";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { DepartmentRuntimeStore } from "../../extensionHost/departmentruntimestore";
import { createDepartmentExecutionProducer } from "../../extensionHost/departmentexecutionproducer";
import { createDepartmentInteractiveRuntime, usesDepartmentInteractiveRuntime } from "../../extensionHost/departmentinteractiveruntime";
import { createDepartmentProductionCleanup } from "../../extensionHost/departmentproductioncleanup";
import { GrokInteractiveRunner } from "../../interactive/grokRunner";
import { captureDepartmentTestWorkers } from "./fixtures/departmentownedtestworkers";

function gate() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function harness(t: test.TestContext, leader: CliName, employee: CliName = leader, authority = false,
  logError?: (message: string, data?: unknown) => void | Promise<void>) {
  // openNewLeader detaches the generation authority. producer.close fences the
  // generation and does not reap that process; this hook does, on pass and failure.
  captureDepartmentTestWorkers(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-cli-"));
  const routes = { director: { cli: "codex" as const, configId: "profile" }, leader: { cli: leader, configId: "profile" }, employee: { cli: employee, configId: "profile" } };
  const metadata = { version: 1 as const, rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", role: "leader" as const,
    moduleTitle: "模块", routes, limits: { maxLeaders: 4, maxEmployees: 20 } };
  const tasks = new Map<string, LoopTaskRecord>();
  const task: LoopTaskRecord = { taskStoreFile: "", completionRoundSummaries: [], completionRequirementCoverage: [], id: "leader", cli: leader, workspaceKey: "workspace", rootPrompt: "执行", sessionId: "local_leader",
    schedulingMode: "event_driven", status: "running", createdAt: 1, updatedAt: 1, maxRounds: 20, currentRound: 0,
    communicationDir: directory, mainCommunicationFile: path.join(directory, "main.md"), subTasks: [], rounds: [], department: metadata };
  tasks.set(task.id, task);
  tasks.set("root", { ...task, id: "root", cli: "codex", sessionId: "local_root", subTasks: [{ id: "module", title: "模块", status: "running" }],
    department: { ...metadata, role: "director", parentTaskId: null, leaderSubtaskId: null } });
  const read = (id: string) => structuredClone(tasks.get(id) ?? null);
  const update = (id: string, patch: Partial<LoopTaskRecord>) => { const old = tasks.get(id); if (!old) return null;
    const next = mergeLoopTaskRecordPatch(old, patch); tasks.set(id, next); return structuredClone(next); };
  const store = new DepartmentRuntimeStore(path.join(directory, "runtime"));
  assert.equal(store.write({ version: 1, rootTaskId: "root", workspaceKey: "workspace",
    runtime: { version: 1, rootTaskId: "root", stopping: false, collaborations: [], leaders: [{ taskId: "leader", leaderSubtaskId: "module", status: "running", generation: 1 }] },
    capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: ["module"], employees: [] } }).ok, true);
  const producer = createDepartmentExecutionProducer({ store, readTask: read, workspaceKey: () => "workspace", validateRoutes: () => true,
    processOverlay: "absent", ownerDirectory: path.join(directory, "owners"), logError,
    ...(authority ? { authorityDirectory: path.join(directory, "authority") } : {}) });
  producer.recordNewLeader(task);
  await producer.openNewLeader("leader", 1);
  const runtime = createDepartmentInteractiveRuntime({ producer, store, ownerDirectory: path.join(directory, "owners"), readTask: read, updateTask: update });
  const cleanup = createDepartmentProductionCleanup({ store, producer, ownerDirectory: path.join(directory, "owners"), workspaceKey: () => "workspace", readTask: read,
  });
  const run = (round = "round-1", execute?: Parameters<typeof runtime.run>[0]["execute"], role: "leader" | "employee" = "leader", cancel = () => {}, grokExecutionRootId?: string, grokLegacySessionFallbackFromSessionId?: string, grokExecutionCwd?: string, grokRecoveredLegacySessionId?: string) => producer.track("leader", () => runtime.run({
    taskId: "leader", role, invocationId: round, sessionId: role === "leader" ? "local_leader" : null,
    ...(role === "employee" ? { initializeLocalSession: () => "local_employee" } : {}),
    ...(role === "employee" ? { subtaskId: "employee", attemptId: "attempt" } : {}), expected: { configId: "profile", revision: "revision" }, cancel,
    ...(grokExecutionRootId ? { grokExecutionRootId } : {}),
    ...(grokExecutionCwd ? { grokExecutionCwd } : {}),
    ...(grokRecoveredLegacySessionId ? { grokRecoveredLegacySessionId } : {}),
    ...(grokLegacySessionFallbackFromSessionId ? { grokLegacySessionFallbackFromSessionId } : {}),
    execute: execute ?? (async capture => { await capture({}, async () => {})(`native-${role}`); }),
  }));
  t.after(async () => { await producer.close("leader").catch(() => undefined); producer.closeAll();
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
  return { directory, tasks, read, update, store, producer, runtime, cleanup, run };
}

test("department transport selection covers every existing Loop CLI", () => {
  assert.equal(CLI_LIST.length, 7);
  for (const cli of CLI_LIST) assert.equal(usesDepartmentInteractiveRuntime(cli), cli !== "codex" && cli !== "opencode");
  assert.equal(usesDepartmentInteractiveRuntime("unknown"), false);
});

test("department Grok Owner only replaces an unversioned legacy session with an explicit fallback capability", async t => {
  const h = await harness(t, "claude", "grok", true); await h.run();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "employee", attemptId: "attempt" }]);
  const legacySession = { cli: "grok" as const, sessionId: "legacy-session", configId: "profile" };
  h.update("leader", { subTasks: [{ id: "employee", title: "员工", status: "running", executionSession: legacySession }], loopPlus: scheduler.snapshot() });
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  saved.value.capacity.employees.push(JSON.stringify(["leader", "attempt"])); assert.equal(h.store.write(saved.value).ok, true);
  h.runtime.authorizeAttempt("leader", "employee", "attempt");
  const rootId = "0e9f04ab-3ca8-4e41-8f10-876fb954d378";
  await h.run("attempt", async capture => { await capture({}, async () => {})("replacement-session"); }, "employee", () => {}, rootId, legacySession.sessionId);
  assert.deepEqual(h.read("leader")?.subTasks[0].executionSession, {
    cli: "grok", sessionId: "replacement-session", configId: "profile", grokExecutionRootId: rootId,
  });
  h.update("leader", { status: "completed" }); await h.producer.retire("leader", 1);
});

test("department Grok Owner upgrades cwd metadata only when the recovered native session id is unchanged", async t => {
  const h = await harness(t, "claude", "grok", true); await h.run();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "employee", attemptId: "attempt" }]);
  const legacySession = { cli: "grok" as const, sessionId: "legacy-session", configId: "profile" };
  h.update("leader", { subTasks: [{ id: "employee", title: "员工", status: "running", executionSession: legacySession }], loopPlus: scheduler.snapshot() });
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  saved.value.capacity.employees.push(JSON.stringify(["leader", "attempt"])); assert.equal(h.store.write(saved.value).ok, true);
  h.runtime.authorizeAttempt("leader", "employee", "attempt");
  const rootId = "0e9f04ab-3ca8-4e41-8f10-876fb954d378";
  const cwd = path.join(os.tmpdir(), "sinitek-loop-subtask-Ab12Cd");
  await h.run("attempt", async capture => { await capture({}, async () => {})(legacySession.sessionId); }, "employee", () => {}, rootId, undefined, cwd, legacySession.sessionId);
  assert.deepEqual(h.read("leader")?.subTasks[0].executionSession, {
    ...legacySession, grokExecutionRootId: rootId, grokExecutionCwd: cwd,
  });
  h.update("leader", { status: "completed" }); await h.producer.retire("leader", 1);
});

test("producer observation rejection logs fixed reasons without changing the denial", async t => {
  const events: Array<{ message: string; data: Record<string, unknown> }> = [];
  const h = await harness(t, "codex", "codex", false, (message, data) => {
    events.push({ message, data: data as Record<string, unknown> });
  });
  assert.deepEqual(h.producer.observationScope("leader", 1), h.producer.scope("leader"));
  assert.deepEqual(events, []);
  const scope = h.producer.scope("leader");

  assert.throws(() => h.producer.observationScope("leader", 2), /department-producer-observation-scope-unavailable/);
  assert.deepEqual(events.at(-1), { message: "department-producer-observation-scope-rejected",
    data: { rootTaskId: "root", leaderTaskId: "leader", generation: 2, reason: "generation-mismatch" } });

  h.update("leader", { sessionId: "changed-local-session" });
  assert.throws(() => h.producer.observationScope("leader", 1), /department-producer-observation-scope-unavailable/);
  assert.deepEqual(events.at(-1), { message: "department-producer-observation-scope-rejected",
    data: { rootTaskId: "root", leaderTaskId: "leader", generation: 1, reason: "local-session-changed" } });
  assert.equal(h.producer.producer.isCurrent(scope), false);
  assert.deepEqual(events.at(-1), { message: "department-producer-validation-rejected",
    data: { rootTaskId: "root", leaderTaskId: "leader", generation: 1, phase: "current", reason: "local-session-changed" } });

  h.update("leader", { sessionId: "local_leader" });
  h.update("root", { status: "error" });
  assert.equal(h.producer.producer.canLaunch?.(scope), false);
  assert.deepEqual(events.at(-1), { message: "department-producer-validation-rejected",
    data: { rootTaskId: "root", leaderTaskId: "leader", generation: 1, phase: "launch", reason: "root-not-running" } });
  assert.equal(JSON.stringify(events).includes("changed-local-session"), false);
});

test("leader resume session comes only from the current durable native binding", async t => {
  const h = await harness(t, "claude");
  assert.equal(h.runtime.resolveLeaderResumeSession("leader", "local_leader"), null);
  await h.run("first");
  assert.equal(h.runtime.resolveLeaderResumeSession("leader", "local_leader"), "native-leader");
  assert.throws(() => h.runtime.resolveLeaderResumeSession("leader", "other-local-session"), /leader-session-invalid/);
  const task = h.read("leader")!;
  h.tasks.set("leader", { ...task, executionSession: { cli: "claude", sessionId: "untrusted-native", configId: "profile" } });
  assert.throws(() => h.runtime.resolveLeaderResumeSession("leader", "local_leader"), /binding-conflict/);
});

for (const cli of CLI_LIST.filter(usesDepartmentInteractiveRuntime)) test(`${cli} leader binds native session, runs twice and closes the original generation`, { timeout: 15000 }, async t => {
  const h = await harness(t, cli, cli, true);
  let disposed = 0; const runner = {}, drained = gate();
  const execute = async (capture: NonNullable<Parameters<typeof h.run>[1]> extends (capture: infer C) => Promise<void> ? C : never) => { await capture(runner, async () => { disposed++; await drained.promise; })("native-leader"); };
  await h.run("first", execute); await h.run("second", execute);
  assert.equal(h.read("leader")?.sessionId, "local_leader");
  assert.deepEqual(h.read("leader")?.executionSession, { cli, sessionId: "native-leader", configId: "profile" });
  assert.equal(h.read("leader")?.executionSessionInvalid, undefined);
  let cleaned = false; const observation = h.cleanup.observe(h.read("leader")!, 1); assert.ok(observation);
  const closing = observation.done.then(() => { cleaned = true; });
  await new Promise<void>(r => setImmediate(r)); assert.equal(cleaned, false);
  drained.resolve(); await closing; assert.equal(disposed, 1);
  assert.equal(h.store.readLeaderExecutionSet(h.producer.observationScope("leader", 1)).ok, true);
  h.update("leader", { status: "completed" }); await h.producer.retire("leader", 1);
});

for (const cli of CLI_LIST.filter(usesDepartmentInteractiveRuntime)) test(`${cli} mixed CLI employee uses the original scheduler, native session and cleanup observation`, { timeout: 15000 }, async t => {
  const h = await harness(t, cli === "grok" ? "claude" : "grok", cli, true); await h.run();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "employee", attemptId: "attempt" }]);
  h.update("leader", { subTasks: [{ id: "employee", title: "员工", status: "running" }], loopPlus: scheduler.snapshot() });
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  saved.value.capacity.employees.push(JSON.stringify(["leader", "attempt"])); assert.equal(h.store.write(saved.value).ok, true);
  h.runtime.authorizeAttempt("leader", "employee", "attempt");
  let cleaned = false; const observation = h.runtime.observe("leader", "attempt");
  void observation.done.then(() => { cleaned = true; });
  const started = gate(), drain = gate();
  const grokExecutionRootId = cli === "grok" ? "0e9f04ab-3ca8-4e41-8f10-876fb954d378" : undefined;
  const work = h.run("attempt", async capture => { await capture({}, async () => { started.resolve(); await drain.promise; })("native-employee"); }, "employee", () => {}, grokExecutionRootId);
  await started.promise; assert.equal(cleaned, false);
  assert.equal(h.read("leader")?.subTasks[0].executionSession?.cli, cli);
  assert.equal(h.read("leader")?.subTasks[0].executionSession?.sessionId, "native-employee");
  assert.equal(h.read("leader")?.subTasks[0].executionSession?.grokExecutionRootId, grokExecutionRootId);
  drain.resolve(); await work; await observation.done; assert.equal(cleaned, true);
  const group = h.cleanup.observe(h.read("leader")!, 1); assert.ok(group); await group.done;
  h.update("leader", { status: "completed" }); await h.producer.retire("leader", 1);
});

test("unstarted employee session failure is observable with a safe attempt diagnostic", async t => {
  const h = await harness(t, "grok", "grok");
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const loggedRuntime = createDepartmentInteractiveRuntime({
    producer: h.producer, store: h.store, ownerDirectory: path.join(h.directory, "diagnostic-owners"),
    readTask: h.read, updateTask: h.update,
    log: (event, payload) => events.push({ event, payload }),
  });
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  scheduler.dispatch([{ subtaskId: "employee", attemptId: "attempt" }]);
  h.update("leader", { subTasks: [{ id: "employee", title: "员工", status: "running" }], loopPlus: scheduler.snapshot() });
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  saved.value.capacity.employees.push(JSON.stringify(["leader", "attempt"])); assert.equal(h.store.write(saved.value).ok, true);
  loggedRuntime.authorizeAttempt("leader", "employee", "attempt");
  const observation = loggedRuntime.observe("leader", "attempt");
  await assert.rejects(loggedRuntime.run({ taskId: "leader", role: "employee", invocationId: "attempt", sessionId: null,
    subtaskId: "employee", attemptId: "attempt", expected: { configId: "profile", revision: "revision" },
    cancel: () => {}, execute: async () => {} }), /department-interactive-local-session-unavailable/);
  await assert.rejects(observation.done, /department-interactive-local-session-unavailable/);
  assert.deepEqual(events.map(item => [item.event, item.payload.stage, item.payload.result, item.payload.errorCode]), [
    ["department-interactive-invocation", "admission", "started", undefined],
    ["department-interactive-invocation", "local-session", "unconfirmed", "department-interactive-local-session-unavailable"],
  ]);
  assert.equal(events.some(item => JSON.stringify(item.payload).includes("native-employee")), false);
});

for (const cli of CLI_LIST.filter(usesDepartmentInteractiveRuntime)) test(`${cli} stopped leader continues in a new generation with its original native session`, { timeout: 15000 }, async t => {
  const h = await harness(t, cli, cli, true);
  let released = 0;
  const execute: Parameters<ReturnType<typeof createDepartmentInteractiveRuntime>["run"]>[0]["execute"] = async capture => {
    await capture({}, async () => { released++; })("native-leader");
  };
  await h.run("first", execute);
  const observation = h.cleanup.observe(h.read("leader")!, 1); assert.ok(observation); await observation.done;
  h.update("leader", { status: "stopped" });
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  saved.value.capacity.leaders = [];
  saved.value.runtime.leaders[0].status = "paused";
  assert.equal(h.store.write(saved.value).ok, true);
  h.runtime.releaseTask("leader");
  await h.producer.retire("leader", 1);
  assert.equal(released, 1);
  assert.equal(h.producer.canContinueLeader("leader"), true);

  h.update("leader", { status: "running" });
  const continued = h.store.read("root", "workspace"); assert.ok(continued.ok && continued.value);
  continued.value.capacity.leaders = ["module"];
  continued.value.runtime.leaders[0].generation = 2;
  continued.value.runtime.leaders[0].status = "running";
  assert.equal(h.store.write(continued.value).ok, true);
  await h.producer.openContinuedLeader("leader", 2);
  assert.equal(h.runtime.resolveLeaderResumeSession("leader", "local_leader"), "native-leader");
  await h.run("continued", execute);
  assert.equal(h.read("leader")?.sessionId, "local_leader");
  assert.deepEqual(h.read("leader")?.executionSession, { cli, sessionId: "native-leader", configId: "profile" });
  const closed = h.cleanup.observe(h.read("leader")!, 2); assert.ok(closed); await closed.done;
  assert.equal(released, 2);
  const after = h.store.read("root", "workspace"); assert.ok(after.ok && after.value);
  assert.deepEqual(after.value.leaderExecutionSets?.map(set => [set.scope.generation, set.state]), [[1, "closed"], [2, "closed"]]);
  assert.equal(after.value.executionBindings?.length, 2);
  assert.notEqual(after.value.executionBindings?.[0].identity.ownerId, after.value.executionBindings?.[1].identity.ownerId);
});

test("stopping seals the generation and waits for the active original runner", { timeout: 10000 }, async t => {
  const h = await harness(t, "grok"); const started = gate(), cancelled = gate(), drained = gate();
  t.after(() => { cancelled.resolve(); drained.resolve(); });
  let cancelledCount = 0;
  const running = h.run("first", async capture => {
    await capture({}, async () => { await drained.promise; })("native-leader"); started.resolve(); await cancelled.promise;
  }, "leader", () => { cancelledCount++; cancelled.resolve(); });
  await started.promise;
  const closing = h.producer.close("leader"); await cancelled.promise;
  await assert.rejects(h.run("late"), /sealed|unavailable|no-live-generation/);
  drained.resolve(); await running; assert.equal((await closing).ok, true); assert.equal(cancelledCount, 1);
});

test("runner disposal failures never produce successful department cleanup", { timeout: 10000 }, async t => {
  const h = await harness(t, "dsh");
  await h.run("first", async capture => { await capture({}, async () => { throw new Error("drain-failed"); })("native-leader"); });
  const closing = await h.producer.close("leader"); assert.equal(closing.ok, false);
  if (!closing.ok) assert.match(closing.error, /drain-failed/);
});

test("preparation without a native session fails promptly and does not invent a local execution binding", { timeout: 10000 }, async t => {
  const h = await harness(t, "claude");
  await assert.rejects(h.run("first", async capture => { capture({}, async () => {}); }), /session-not-prepared/);
  assert.equal(h.read("leader")?.executionSession, undefined);
  const result = await h.producer.close("leader"); assert.equal(result.ok, false);
});

// Actual child process + original runner + original Owner sockets, with a local
// deterministic ACP peer. No model service, user configuration or live task data.
test("original Grok runner executes and its real child closes before the department receipt", { timeout: 15000 }, async t => {
  const h = await harness(t, "grok", "grok", true);
  const script = path.join(h.directory, "acp.cjs");
  fs.writeFileSync(script, `const readline = require('readline');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => { const m = JSON.parse(line); if (m.id == null) return;
let result = {}; if (m.method === 'initialize') result = { protocolVersion: 1, authMethods: [{ id: "xai.api_key" }], agentCapabilities: {} };
if (m.method === 'session/new') result = { sessionId: 'native-leader' };
if (m.method === 'session/prompt') result = { stopReason: 'end_turn' };
process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n'); });
lines.on('close', () => process.exit(0));`);
  let pid: number | undefined;
  const runner = new GrokInteractiveRunner({ command: process.execPath, cwd: h.directory,
    env: { PATH: process.env.PATH, GROK_HOME: h.directory, XAI_API_KEY: "local-test" },
    spawnImpl: (_command, _args, options) => { const child = require("child_process").spawn(process.execPath, [script], { ...options, stdio: ["pipe", "pipe", "pipe"] }); pid = child.pid; return child; } });
  await h.run("first", async capture => { const bind = capture(runner, () => runner.disposeAndWait());
    const started = await runner.start(); await bind(started.acpSessionId); await runner.prompt("本机验证", {}); });
  assert.ok(pid); const observed = h.cleanup.observe(h.read("leader")!, 1); assert.ok(observed); await observed.done;
  assert.throws(() => process.kill(pid!, 0), /ESRCH/);
  h.update("leader", { status: "completed" }); await h.producer.retire("leader", 1);
});
