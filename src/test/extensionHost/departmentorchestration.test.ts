import test = require("node:test");
import assert = require("node:assert/strict");
import { isDepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import { DepartmentCapacityPool } from "../../departmentcapacity";

test("runtime recovery rejects duplicate task/module/message identities and foreign collaboration roots", () => {
  const member = { taskId: "leader", leaderSubtaskId: "module", status: "running" };
  const message = { id: "message", rootTaskId: "root", sourceLeaderTaskId: "leader", targetLeaderTaskId: "leader", body: "help", status: "pending" };
  const saved = { version: 1, rootTaskId: "root", stopping: false, leaders: [member], collaborations: [message] };
  assert.equal(isDepartmentRuntimeSnapshot(saved, "root"), true);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, leaders: [member, member] }, "root"), false);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, leaders: [member, { ...member, taskId: "other" }] }, "root"), false);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, collaborations: [message, message] }, "root"), false);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, collaborations: [{ ...message, rootTaskId: "foreign" }] }, "root"), false);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, startingModules: ["module"] }, "root"), false);
});

test("per-root restore validates atomically, preserves other roots and old release handles cannot release successors", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const other = await pool.acquireLeader("other", "active");
  const old = await pool.acquireEmployee("root", "leader", "attempt"); old!.release();
  const identity = JSON.stringify(["leader", "attempt"]);
  const snapshot = { rootTaskId: "root", maxLeaders: 1, maxEmployees: 0, leaders: ["module"], employees: [identity], employeeOverflow: [identity] };
  const before = pool.snapshot();
  assert.throws(() => pool.restoreRoot({ ...snapshot, employeeOverflow: [identity, identity] }));
  assert.deepEqual(pool.snapshot(), before);
  const leases = pool.restoreRoot(snapshot);
  assert.equal(pool.snapshot("other")[0].leaders.length, 1);
  old!.release();
  assert.equal(pool.snapshot("root")[0].employees.length, 1);
  assert.equal(pool.getEmployeeCapacity("root", "leader")!.leaderOverflowActive, true);
  assert.throws(() => pool.restoreRoot(snapshot));
  leases.forEach((lease) => lease.release()); other!.release();
  assert.equal(pool.clearRoot("root"), true);
});

import { installVscodeMock } from "../vscodeMock";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { DepartmentMetadata } from "../../department";
import type { DepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import type { DepartmentExecutionObservation, DepartmentOrchestrationDeps } from "../../extensionHost/departmentorchestration";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
installVscodeMock();
const logger = require("../../logger") as typeof import("../../logger");
const { createDepartmentOrchestrationHost } = require("../../extensionHost/departmentorchestration") as typeof import("../../extensionHost/departmentorchestration");
const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");

const leaderRequest = (id: string) => ({ leaderSubtaskId: id, moduleTitle: id, prompt: `Implement the complete ${id} module, report progress and coordinate dependencies through the director.` });
function departmentMetadata(rootTaskId: string): DepartmentMetadata {
  return { version: 1, rootTaskId, parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "部门",
    routes: { director: { cli: "codex", configId: "profile" }, leader: { cli: "codex", configId: "profile", model: "leader" },
      employee: { cli: "codex", configId: "profile", model: "employee" } }, limits: { maxLeaders: 4, maxEmployees: 1 } };
}
function departmentRoot(id: string, modules: string[]): LoopTaskRecord {
  return { id, cli: "codex", workspaceKey: "workspace", taskStoreFile: "fixture", rootPrompt: "部门目标", department: departmentMetadata(id),
    loopPlusAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot(), schedulingMode: "classic", status: "running", createdAt: Date.now(), updatedAt: Date.now(),
    maxRounds: 20, currentRound: 0, communicationDir: "/fixture", mainCommunicationFile: "/fixture/main", sessionId: `SYNTHETIC_SESSION_${id}`,
    subTasks: modules.map((moduleId) => ({ id: moduleId, title: moduleId, prompt: leaderRequest(moduleId).prompt, status: "pending" as const })),
    rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [] };
}
function admissionHarness() {
  const tasks = new Map<string, LoopTaskRecord>();
  const persistence = {
    create: (task: LoopTaskRecord) => { tasks.set(task.id, structuredClone(task)); return structuredClone(task); },
    read: (id: string) => { const task = tasks.get(id); return task ? structuredClone(task) : null; },
    save: (task: LoopTaskRecord) => { tasks.set(task.id, structuredClone(task)); },
    remove: (id: string) => { tasks.delete(id); },
  };
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile", taskPersistence: persistence });
  const capacity = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const snapshots = new Map<string, DepartmentRuntimeSnapshot>();
  const sessions = new Map<string, { tabId: string; cli: "codex"; sessionId: string }>();
  const liveLeaders = new Map<string, DepartmentExecutionObservation>();
  const liveEmployees = new Map<string, DepartmentExecutionObservation>();
  let persistenceFails = false;
  let next = 0;
  const read = fixture.readTask;
  const update = (id: string, patch: Partial<LoopTaskRecord>) => { const task = read(id); if (!task) return null; fixture.saveTask({ ...task, ...patch }); return read(id); };
  const deps: DepartmentOrchestrationDeps = {
    capacity, readTask: read, updateTask: update, runtime: fixture.adapter,
    createLeaderTarget: () => { const target = { tabId: `leader-tab-${++next}`, cli: "codex" as const, sessionId: `leader-session-${next}` }; sessions.set(target.sessionId, target); return target; },
    buildLeaderInput: (_route: unknown, req: ReturnType<typeof leaderRequest>) => ({ displayPrompt: req.prompt, modelPrompt: req.prompt, contextTags: [], loopSubtaskMode: "fullstack" as const }),
    validateRoutes: () => true,
    inspectLeaderSession: (task: LoopTaskRecord) => { const target = sessions.get(task.sessionId ?? ""); return target ? { target, live: liveLeaders.get(task.id) ?? null } : null; },
    observeRestoredExecution: (task: LoopTaskRecord, request: { attemptId: string }) => liveEmployees.get(JSON.stringify([task.id, request.attemptId])) ?? null,
    stopLeader: () => undefined,
    persistRuntime: (snapshot: DepartmentRuntimeSnapshot) => { if (persistenceFails) throw new Error("SYNTHETIC_PERSIST_EXCEPTION /tmp/secret"); snapshots.set(snapshot.rootTaskId, structuredClone(snapshot)); },
    notifyDirector: () => undefined, createMessageId: () => `message-${++next}`,
  };
  const host = createDepartmentOrchestrationHost(deps);
  function register(id = "root", modules = ["accounts"]) {
    const root = departmentRoot(id, modules);
    fixture.saveTask({ ...root, taskStoreFile: fixture.storeFile });
    assert.deepEqual(host.registerRoot(read(id)!, root.department, root.loopPlusAcceptancePlan!), { ok: true });
    return read(id)!;
  }
  function dispatch(prefix: string) {
    fixture.queueMain((input, tab) => fixture.publish(input, tab, { status: "end", content: JSON.stringify({ status: "dispatch", subtasks: [{
      id: `${prefix}-0`, title: `${prefix}-0`, prompt: `Implement ${prefix}-0 and report SYNTHETIC_PROMPT_SECRET to the leader.`, writeFiles: [], taskType: "general",
    }] }) }));
  }
  return { fixture, capacity, deps, host, liveLeaders, liveEmployees, register, dispatch, read, update, failPersistence: (value: boolean) => { persistenceFails = value; } };
}
function attemptRequest(taskId: string, attemptId: string, subtaskId: string) {
  return { taskId, subtaskId, attemptId, title: subtaskId, prompt: "SYNTHETIC_PROMPT_SECRET", modelPrompt: "SYNTHETIC_PROMPT_SECRET", writeFiles: [] as string[], round: 1, targetCli: "codex" as const };
}
type AdmissionEvent = { event: string; data: Record<string, unknown> };
function admissionRefusals(events: AdmissionEvent[]) {
  return events.filter((event) => event.event === "department-employee-admission");
}
function assertRefusal(data: Record<string, unknown>, reason: string, taskId: string, attemptId: string) {
  assert.equal(data.reason, reason);
  assert.equal(data.result, "refused");
  assert.equal(data.stage, "admission");
  assert.equal(data.leaderTaskId, taskId);
  assert.equal(data.attemptId, attemptId);
  assert.deepEqual(Object.keys(data).filter((key) => !["rootTaskId", "leaderTaskId", "attemptId", "generation", "stage", "result", "reason"].includes(key)), []);
  const text = JSON.stringify(data);
  assert.equal(text.includes("SYNTHETIC"), false);
  assert.equal(text.includes("identity-lock"), false);
  assert.equal(text.includes("session"), false);
  assert.equal(text.includes("prompt"), false);
  assert.equal(text.includes("/"), false);
  assert.equal(text.includes("Error"), false);
}

test("admission refusals record one distinguishable reason and do not start a CLI", async (t) => {
  const events: AdmissionEvent[] = [];
  t.mock.method(logger, "logEssential", (event: string, data: unknown) => { events.push({ event, data: data as Record<string, unknown> }); return Promise.resolve(); });
  const h = admissionHarness();
  t.after(() => h.fixture.dispose());
  const missing = await h.fixture.adapter.startAttempt(attemptRequest("missing-leader", "lp275", "accounts-0")).promise;
  assert.equal(missing.outcome, "failed");
  assert.equal(missing.detail, "部门执行准入被拒绝，子任务未启动");
  h.fixture.saveTask({ ...departmentRoot("unowned-root", ["accounts"]), taskStoreFile: h.fixture.storeFile });
  const unowned = await h.fixture.adapter.startAttempt(attemptRequest("unowned-root", "lp420", "accounts")).promise;
  assert.equal(unowned.outcome, "failed");
  assert.equal(unowned.detail, "部门执行准入被拒绝，子任务未启动");
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
  assert.equal(h.fixture.rootsCreated.length, 0);
  const refusals = admissionRefusals(events);
  assert.equal(refusals.length, 2);
  assertRefusal(refusals[0].data, "task-record-unavailable", "missing-leader", "lp275");
  assert.equal(refusals[0].data.rootTaskId, undefined);
  assertRefusal(refusals[1].data, "owner-or-member-missing", "unowned-root", "lp420");
  assert.notEqual(refusals[0].data.reason, refusals[1].data.reason);

  h.fixture.setAttemptAction((input, tab) => h.fixture.publish(input, tab, { status: "end", content: "ordinary execution completed" }));
  h.fixture.saveTask({ ...departmentRoot("ordinary", []), schedulingMode: "event_driven", department: undefined, sessionId: "SYNTHETIC_SESSION_ORDINARY" });
  const handed = await h.fixture.adapter.startAttempt(attemptRequest("ordinary", "lp-ordinary", "A")).promise;
  assert.equal(handed.outcome, "completed");
  assert.equal(h.fixture.attemptCalls.length, 1);
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "ordinary", attemptId: "lp-ordinary", subtaskId: "A" }, new AbortController().signal), undefined);
  assert.equal(admissionRefusals(events).length, 2);

  h.fixture.setAttemptAction(null);
  h.register();
  h.dispatch("accounts");
  const leader = await h.host.startLeader("root", leaderRequest("accounts"));
  assert.equal(leader.ok, true); if (!leader.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "successful employee admission");
  const running = createLoopPlusScheduler({ snapshot: h.read(leader.taskId)!.loopPlus }).snapshot().running[0];
  const before = admissionRefusals(events).length;
  const lease = await h.host.acquireAttemptExecution({ taskId: leader.taskId, attemptId: running.attemptId, subtaskId: running.subtaskId }, new AbortController().signal);
  assert.ok(lease);
  assert.equal(admissionRefusals(events).length, before);
  const calls = h.fixture.attemptCalls.length;
  const targets = h.fixture.createdSubtaskTargets.length;
  assert.equal(await h.host.acquireAttemptExecution({ taskId: leader.taskId, attemptId: running.attemptId, subtaskId: "foreign" }, new AbortController().signal), null);
  assert.equal(h.fixture.attemptCalls.length, calls);
  assert.equal(h.fixture.createdSubtaskTargets.length, targets);
  const validation = admissionRefusals(events).filter((event) => event.data.reason === "attempt-validation-failed");
  assert.equal(validation.length, 1);
  assertRefusal(validation[0].data, "attempt-validation-failed", leader.taskId, running.attemptId);
  await h.host.stopRoot("root");
  await leader.done;
});

test("capacity, cancellation, and persistence refusals stay distinct and do not start the attempt CLI", async (t) => {
  const events: AdmissionEvent[] = [];
  t.mock.method(logger, "logEssential", (event: string, data: unknown) => { events.push({ event, data: data as Record<string, unknown> }); return Promise.resolve(); });
  const h = admissionHarness();
  let releaseGrant = () => undefined as void;
  const releaseGrantPromise = new Promise<void>((resolve) => { releaseGrant = resolve; });
  t.after(() => { releaseGrant(); h.fixture.dispose(); });
  const original = h.capacity.trackEmployee.bind(h.capacity);
  let mode: "delay-null" | "real" = "delay-null";
  h.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
    if (mode === "real") return original(...args);
    return releaseGrantPromise.then(() => null);
  }) as DepartmentCapacityPool["trackEmployee"];
  h.register("capacity-root");
  h.dispatch("blocked");
  const leader = await h.host.startLeader("capacity-root", leaderRequest("accounts"));
  assert.equal(leader.ok, true); if (!leader.ok) return;
  await waitForLoopPlus(() => h.fixture.mainCalls.length === 1, "leader decision reached admission");
  releaseGrant();
  await waitForLoopPlus(() => admissionRefusals(events).some((event) => event.data.reason === "capacity-unavailable"), "capacity refusal diagnostic");
  const capacity = admissionRefusals(events).filter((event) => event.data.reason === "capacity-unavailable");
  assert.equal(capacity.length, 1);
  assert.equal(capacity[0].data.result, "refused");
  assert.equal(capacity[0].data.leaderTaskId, leader.taskId);
  assert.equal(typeof capacity[0].data.attemptId, "string");
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
  await h.host.stopRoot("capacity-root");
  await leader.done;

  mode = "real";
  const persisted = admissionHarness();
  t.after(() => persisted.fixture.dispose());
  let releasePersist = () => undefined as void;
  const persistGate = new Promise<void>((resolve) => { releasePersist = resolve; });
  t.after(() => releasePersist());
  const persistTrack = persisted.capacity.trackEmployee.bind(persisted.capacity);
  persisted.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => persistTrack(...args).then(async (lease) => {
    await persistGate; persisted.failPersistence(true); return lease;
  })) as DepartmentCapacityPool["trackEmployee"];
  persisted.register("persist-root");
  persisted.dispatch("persist");
  const persistLeader = await persisted.host.startLeader("persist-root", leaderRequest("accounts"));
  assert.equal(persistLeader.ok, true); if (!persistLeader.ok) return;
  await waitForLoopPlus(() => persisted.fixture.mainCalls.length === 1, "persistence admission entered");
  releasePersist();
  await waitForLoopPlus(() => admissionRefusals(events).some((event) => event.data.reason === "persistence-failed"), "persistence refusal diagnostic");
  const persistence = admissionRefusals(events).filter((event) => event.data.reason === "persistence-failed");
  assert.equal(persistence.length, 1);
  assert.equal(JSON.stringify(persistence[0].data).includes("SYNTHETIC_PERSIST_EXCEPTION"), false);
  assert.equal(persisted.fixture.attemptCalls.length, 0);
  assert.equal(persisted.fixture.createdSubtaskTargets.length, 0);
  const generic = events.filter((event) => event.event === "department-lifecycle-persistence-failed" && event.data.rootTaskId === "persist-root");
  assert.equal(generic.length, 0);
  await persisted.host.stopRoot("persist-root");
  await persistLeader.done;

  const cancelled = admissionHarness();
  t.after(() => cancelled.fixture.dispose());
  let releaseCancel = () => undefined as void;
  const cancelGate = new Promise<void>((resolve) => { releaseCancel = resolve; });
  t.after(() => releaseCancel());
  const cancelTrack = cancelled.capacity.trackEmployee.bind(cancelled.capacity);
  cancelled.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => cancelGate.then(() => cancelTrack(...args))) as DepartmentCapacityPool["trackEmployee"];
  cancelled.register("cancel-root");
  cancelled.dispatch("cancel");
  const cancelLeader = await cancelled.host.startLeader("cancel-root", leaderRequest("accounts"));
  assert.equal(cancelLeader.ok, true); if (!cancelLeader.ok) return;
  await waitForLoopPlus(() => cancelled.fixture.mainCalls.length === 1, "cancellation admission entered");
  const stopping = cancelled.host.stopRoot("cancel-root");
  releaseCancel();
  await waitForLoopPlus(() => admissionRefusals(events).some((event) => event.data.reason === "admission-cancelled"), "cancellation refusal diagnostic");
  const cancellation = admissionRefusals(events).filter((event) => event.data.reason === "admission-cancelled");
  assert.equal(cancellation.length, 1);
  assert.equal(cancellation[0].data.leaderTaskId, cancelLeader.taskId);
  assert.equal(typeof cancellation[0].data.attemptId, "string");
  assert.equal(JSON.stringify(cancellation[0].data).includes("identity-lock"), false);
  assert.equal(cancelled.fixture.attemptCalls.length, 0);
  assert.equal(cancelled.fixture.createdSubtaskTargets.length, 0);
  assert.equal(await stopping, true);
  await cancelLeader.done;
});

test("recovered employee occupancy refuses the same attempt and does not start another CLI", async (t) => {
  const events: AdmissionEvent[] = [];
  t.mock.method(logger, "logEssential", (event: string, data: unknown) => { events.push({ event, data: data as Record<string, unknown> }); return Promise.resolve(); });
  const h = admissionHarness();
  t.after(() => h.fixture.dispose());
  h.register("occupancy-root");
  h.dispatch("occupied");
  const leader = await h.host.startLeader("occupancy-root", leaderRequest("accounts"));
  assert.equal(leader.ok, true); if (!leader.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "employee parked before occupancy recovery");
  const running = createLoopPlusScheduler({ snapshot: h.read(leader.taskId)!.loopPlus }).snapshot().running[0];
  assert.ok(running);
  const liveRequest = { taskId: leader.taskId, attemptId: running.attemptId, subtaskId: running.subtaskId };
  const liveLease = await h.host.acquireAttemptExecution(liveRequest, new AbortController().signal);
  assert.ok(liveLease);
  assert.equal(admissionRefusals(events).length, 0);
  assert.equal(h.capacity.snapshot("occupancy-root")[0].employees.length, 1);
  const saved = h.host.runtimeSnapshot("occupancy-root");
  assert.ok(saved);
  const root = h.read("occupancy-root")!;
  h.liveLeaders.set(leader.taskId, { done: leader.done });
  h.liveEmployees.set(JSON.stringify([leader.taskId, running.attemptId]), { done: h.fixture.adapter.waitForTaskIdle(leader.taskId) });
  const restoredPool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const restored = createDepartmentOrchestrationHost({ ...h.deps, capacity: restoredPool });
  assert.deepEqual(restored.recoverRoot(root, root.department, root.loopPlusAcceptancePlan!, saved, h.capacity.snapshot("occupancy-root")), { ok: true });
  const calls = h.fixture.attemptCalls.length;
  const targets = h.fixture.createdSubtaskTargets.length;
  const roots = h.fixture.rootsCreated.length;
  assert.equal(calls > 0, true);
  assert.equal(await restored.acquireAttemptExecution(liveRequest, new AbortController().signal), null);
  const conflicts = admissionRefusals(events).filter((event) => event.data.reason === "occupancy-conflict");
  assert.equal(conflicts.length, 1);
  assertRefusal(conflicts[0].data, "occupancy-conflict", leader.taskId, running.attemptId);
  assert.equal(conflicts[0].data.rootTaskId, "occupancy-root");
  assert.equal(h.fixture.attemptCalls.length, calls);
  assert.equal(h.fixture.createdSubtaskTargets.length, targets);
  assert.equal(h.fixture.rootsCreated.length, roots);
  h.fixture.setHoldAbort(true);
  const stopping = restored.stopRoot("occupancy-root");
  await waitForLoopPlus(() => h.fixture.cancelledTabs.length > 0, "occupancy recovery stop reaches adapter");
  h.fixture.finishParked(running.subtaskId, { status: "stopped" });
  assert.equal(await stopping, true);
});

test("a failing admission diagnostic still returns the original refusal", async (t) => {
  const h = admissionHarness();
  t.after(() => h.fixture.dispose());
  t.mock.method(logger, "logEssential", () => { throw new Error("SYNTHETIC_SENSITIVE_PATH session prompt"); });
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "missing", attemptId: "lp494", subtaskId: "accounts" }, new AbortController().signal), null);
  t.mock.method(logger, "logEssential", () => Promise.reject(new Error("SYNTHETIC_SENSITIVE_PATH session prompt")));
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "missing-again", attemptId: "lp494b", subtaskId: "accounts" }, new AbortController().signal), null);
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
});
