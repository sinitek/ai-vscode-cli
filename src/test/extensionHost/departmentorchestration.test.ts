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
import { loopPlusIdentityRetryDelaysMs } from "../../extensionHost/loopPlusMainAdmission";
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
function assertRefusal(data: Record<string, unknown>, reason: string, taskId: string, attemptId: string, readFailure?: string) {
  assert.equal(data.reason, reason);
  assert.equal(data.result, "refused");
  assert.equal(data.stage, "admission");
  assert.equal(data.leaderTaskId, taskId);
  assert.equal(data.attemptId, attemptId);
  const allowed = ["rootTaskId", "leaderTaskId", "attemptId", "generation", "stage", "result", "reason", "rereadCount", "elapsedMs"];
  if (reason === "task-record-unavailable") allowed.push("readFailure");
  assert.deepEqual(Object.keys(data).filter((key) => !allowed.includes(key)), []);
  if ("rereadCount" in data || "elapsedMs" in data) {
    assert.equal(typeof data.rereadCount, "number");
    assert.equal(typeof data.elapsedMs, "number");
    assert.equal(Number.isInteger(data.rereadCount), true);
    assert.equal(Number.isInteger(data.elapsedMs), true);
    assert.equal((data.rereadCount as number) >= 0, true);
    assert.equal((data.elapsedMs as number) >= 0, true);
  }
  if (reason === "task-record-unavailable") assert.equal(data.readFailure, readFailure ?? "unknown");
  else assert.equal(Object.prototype.hasOwnProperty.call(data, "readFailure"), false);
  const text = JSON.stringify(data);
  assert.equal(text.includes("SYNTHETIC"), false);
  if (data.readFailure !== "identity-lock-present") assert.equal(text.includes("identity-lock"), false);
  assert.equal(text.includes("session"), false);
  assert.equal(text.includes("prompt"), false);
  assert.equal(text.includes("/"), false);
  assert.equal(text.includes("Error"), false);
}
function recordLifecycle(t: test.TestContext, events: AdmissionEvent[]) {
  const push = (event: string, data: unknown) => {
    events.push({ event, data: data as Record<string, unknown> });
    return Promise.resolve();
  };
  t.mock.method(logger, "logError", push);
  t.mock.method(logger, "logEssential", push);
}

test("admission refusals record one distinguishable reason and do not start a CLI", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
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
  recordLifecycle(t, events);
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
  recordLifecycle(t, events);
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
  t.mock.method(logger, "logError", () => { throw new Error("SYNTHETIC_SENSITIVE_PATH session prompt"); });
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "missing", attemptId: "lp494", subtaskId: "accounts" }, new AbortController().signal), null);
  t.mock.method(logger, "logError", () => Promise.reject(new Error("SYNTHETIC_SENSITIVE_PATH session prompt")));
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "missing-again", attemptId: "lp494b", subtaskId: "accounts" }, new AbortController().signal), null);
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
});

test("admission readFailure stays with the same read, degrades unknown reasons, and does not start", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
  const h = admissionHarness();
  t.after(() => h.fixture.dispose());
  let host!: ReturnType<typeof createDepartmentOrchestrationHost>;
  let nested = false;
  const reads = new Map<string, number>();
  const readTask: DepartmentOrchestrationDeps["readTask"] = (id, options) => {
    if (options?.onUnavailable) reads.set(id, (reads.get(id) ?? 0) + 1);
    if (id === "present") return { id, department: undefined } as LoopTaskRecord;
    if (id === "lock-leader" && !nested) {
      nested = true;
      void host.acquireAttemptExecution({ taskId: "missing-file", attemptId: "lp614", subtaskId: "accounts" }, new AbortController().signal);
    }
    const reason = id === "lock-leader" && reads.get(id)! <= loopPlusIdentityRetryDelaysMs.length + 1 ? "identity-lock-present"
      : id === "lock-leader" || id === "missing-file" ? "task-not-found" : "SYNTHETIC_SECRET /tmp/private prompt";
    options?.onUnavailable?.(reason as never);
    return null;
  };
  host = createDepartmentOrchestrationHost({ ...h.deps, readTask });
  const refused = await h.fixture.adapter.startAttempt(attemptRequest("lock-leader", "lp601", "accounts")).promise;
  assert.equal(refused.outcome, "failed");
  assert.equal(refused.detail, "部门执行准入被拒绝，子任务未启动");
  assert.equal(await host.acquireAttemptExecution({ taskId: "secret-leader", attemptId: "lp-unknown", subtaskId: "accounts" }, new AbortController().signal), null);
  const before = admissionRefusals(events).length;
  assert.equal(await host.acquireAttemptExecution({ taskId: "present", attemptId: "lp-ok", subtaskId: "accounts" }, new AbortController().signal), undefined);
  assert.equal(admissionRefusals(events).length, before);
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
  assert.equal(h.fixture.rootsCreated.length, 0);
  const byAttempt = new Map(admissionRefusals(events).map((event) => [event.data.attemptId, event.data]));
  assertRefusal(byAttempt.get("lp614")!, "task-record-unavailable", "missing-file", "lp614", "task-not-found");
  assert.equal("rereadCount" in byAttempt.get("lp614")!, false);
  assert.equal(events.filter(event => event.data.attemptId === "lp601" && event.data.result === "retained" && event.data.readFailure === "identity-lock-present").length, 1);
  assertRefusal(byAttempt.get("lp601")!, "task-record-unavailable", "lock-leader", "lp601", "task-not-found");
  assert.equal(byAttempt.get("lp601")!.rereadCount, loopPlusIdentityRetryDelaysMs.length + 1);
  assert.equal(Number(byAttempt.get("lp601")!.elapsedMs) >= loopPlusIdentityRetryDelaysMs.reduce((sum, item) => sum + item, 0) - 20, true);
  assert.equal(reads.get("lock-leader"), loopPlusIdentityRetryDelaysMs.length + 2);
  assert.equal(reads.get("missing-file"), 1);
  assert.equal(reads.get("secret-leader"), 1);
  assert.equal(reads.get("present"), 1);
  assertRefusal(byAttempt.get("lp-unknown")!, "task-record-unavailable", "secret-leader", "lp-unknown", "unknown");
  const text = JSON.stringify(admissionRefusals(events).map((event) => event.data));
  assert.equal(text.includes("SYNTHETIC"), false);
  assert.equal(text.includes("/tmp"), false);
  assert.equal(text.includes("private"), false);
  assert.equal(text.includes("prompt"), false);
  assert.equal(text.includes("Error"), false);
});

test("incomplete candidate discovery stays task-record-unavailable and does not start", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
  const h = admissionHarness();
  t.after(() => h.fixture.dispose());
  const readTask: DepartmentOrchestrationDeps["readTask"] = (id, options) => {
    if (id === "present") return { id, department: undefined } as LoopTaskRecord;
    const reason = id === "scan-blocked" ? "candidate-scan-unavailable" : "EACCES SYNTHETIC_SCAN /tmp/private-candidate";
    options?.onUnavailable?.(reason as never);
    return null;
  };
  const host = createDepartmentOrchestrationHost({ ...h.deps, readTask });
  assert.equal(await host.acquireAttemptExecution({ taskId: "scan-blocked", attemptId: "lp672-scan", subtaskId: "accounts" }, new AbortController().signal), null);
  const before = admissionRefusals(events).length;
  assert.equal(await host.acquireAttemptExecution({ taskId: "present", attemptId: "lp672-ok", subtaskId: "accounts" }, new AbortController().signal), undefined);
  assert.equal(admissionRefusals(events).length, before);
  assert.equal(await host.acquireAttemptExecution({ taskId: "raw-scan", attemptId: "lp672-raw", subtaskId: "accounts" }, new AbortController().signal), null);
  const byAttempt = new Map(admissionRefusals(events).map((event) => [event.data.attemptId, event.data]));
  assertRefusal(byAttempt.get("lp672-scan")!, "task-record-unavailable", "scan-blocked", "lp672-scan", "candidate-scan-unavailable");
  assertRefusal(byAttempt.get("lp672-raw")!, "task-record-unavailable", "raw-scan", "lp672-raw", "unknown");
  const text = JSON.stringify(admissionRefusals(events).map((event) => event.data));
  assert.equal(text.includes("SYNTHETIC"), false);
  assert.equal(text.includes("/tmp"), false);
  assert.equal(text.includes("private"), false);
  assert.equal(text.includes("EACCES"), false);
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
  assert.equal(h.fixture.rootsCreated.length, 0);
});

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5000) throw new Error(`timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function assertAuditText(data: Record<string, unknown>) {
  const text = JSON.stringify(data);
  assert.equal(text.includes("SYNTHETIC"), false);
  assert.equal(text.includes("session"), false);
  assert.equal(text.includes("prompt"), false);
  assert.equal(text.includes("/"), false);
  assert.equal(text.includes("Error"), false);
  assert.equal(text.includes("identity-lock"), data.readFailure === "identity-lock-present");
}

test("identity lock release starts one valid recovery and refuses a stopped re-read", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
  const h = admissionHarness();
  t.after(() => h.fixture.dispose());
  h.fixture.setAttemptAction((input, tab) => h.fixture.publish(input, tab, { status: "end", content: "ordinary execution completed" }));
  const original = h.deps.readTask;
  const reads = new Map<string, number>();
  let handoffTracks = 0;
  const trackEmployee = h.capacity.trackEmployee.bind(h.capacity);
  h.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
    handoffTracks += 1;
    return trackEmployee(...args);
  }) as DepartmentCapacityPool["trackEmployee"];
  const stoppedOnReread = new Set(["ordinary-lock", "loop-plus-stop"]);
  h.deps.readTask = (id, options) => {
    if ((id === "ordinary-lock" || id === "ordinary-release" || id === "loop-plus-lock" || id === "loop-plus-stop") && options?.onUnavailable) {
      const seen = (reads.get(id) ?? 0) + 1;
      reads.set(id, seen);
      if (seen === 1) { options.onUnavailable("identity-lock-present"); return null; }
      if (stoppedOnReread.has(id)) {
        const task = original(id, options);
        return task ? { ...task, status: "stopped" as const } : task;
      }
    }
    return original(id, options);
  };
  h.fixture.saveTask({ ...departmentRoot("ordinary-lock", []), schedulingMode: "event_driven", department: undefined, sessionId: "SYNTHETIC_SESSION_ORDINARY" });
  const ordinary = await h.fixture.adapter.startAttempt(attemptRequest("ordinary-lock", "lp-ord-release", "A")).promise;
  assert.equal(ordinary.outcome, "failed");
  assert.equal(ordinary.detail, "部门执行准入被拒绝，子任务未启动");
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
  assert.equal(h.fixture.rootsCreated.length, 0);
  assert.equal(handoffTracks, 0);
  assert.equal(reads.get("ordinary-lock"), 2);
  const ordinaryAudit = admissionRefusals(events).filter((event) => event.data.attemptId === "lp-ord-release");
  assert.equal(ordinaryAudit.length, 1);
  assertRefusal(ordinaryAudit[0].data, "attempt-validation-failed", "ordinary-lock", "lp-ord-release");
  assert.equal(ordinaryAudit[0].data.rereadCount, 1);
  assert.equal(Number(ordinaryAudit[0].data.elapsedMs) >= 40, true);
  assertAuditText(ordinaryAudit[0].data);

  h.fixture.saveTask({ ...departmentRoot("ordinary-release", []), schedulingMode: "event_driven", department: undefined, sessionId: "SYNTHETIC_SESSION_RELEASE" });
  const released = await h.fixture.adapter.startAttempt(attemptRequest("ordinary-release", "lp-ord-once", "A")).promise;
  assert.equal(released.outcome, "completed");
  assert.equal(h.fixture.attemptCalls.length, 1);
  assert.equal(h.fixture.createdSubtaskTargets.length, 1);
  assert.equal(handoffTracks, 0);
  assert.equal(reads.get("ordinary-release"), 2);
  const releaseAudit = admissionRefusals(events).filter((event) => event.data.attemptId === "lp-ord-once");
  assert.equal(releaseAudit.length, 1);
  assert.equal(releaseAudit[0].data.result, "confirmed");
  assert.equal(releaseAudit[0].data.reason, "none");
  assert.equal(releaseAudit[0].data.rereadCount, 1);
  assert.equal(Number(releaseAudit[0].data.elapsedMs) >= 40, true);
  assertAuditText(releaseAudit[0].data);

  const stoppedDepartment = departmentMetadata("loop-plus-stop");
  h.fixture.saveTask({ ...departmentRoot("loop-plus-stop", []), schedulingMode: "event_driven", department: { ...stoppedDepartment, executionMode: "loop-plus" }, sessionId: "SYNTHETIC_SESSION_LOOP_PLUS_STOP" });
  const rootsBeforeStop = h.fixture.rootsCreated.length;
  const stoppedMode = await h.fixture.adapter.startAttempt(attemptRequest("loop-plus-stop", "lp-mode-stop", "A")).promise;
  assert.equal(stoppedMode.outcome, "failed");
  assert.equal(stoppedMode.detail, "部门执行准入被拒绝，子任务未启动");
  assert.equal(h.fixture.attemptCalls.length, 1);
  assert.equal(h.fixture.createdSubtaskTargets.length, 1);
  assert.equal(h.fixture.rootsCreated.length, rootsBeforeStop);
  assert.equal(handoffTracks, 0);
  assert.equal(reads.get("loop-plus-stop"), 2);
  const stoppedAudit = admissionRefusals(events).find((event) => event.data.attemptId === "lp-mode-stop");
  assert.ok(stoppedAudit);
  assertRefusal(stoppedAudit.data, "attempt-validation-failed", "loop-plus-stop", "lp-mode-stop");
  assert.equal(stoppedAudit.data.rereadCount, 1);
  assert.equal(Number(stoppedAudit.data.elapsedMs) >= 40, true);
  assertAuditText(stoppedAudit.data);

  const loopPlusDepartment = departmentMetadata("loop-plus-lock");
  h.fixture.saveTask({ ...departmentRoot("loop-plus-lock", []), schedulingMode: "event_driven", department: { ...loopPlusDepartment, executionMode: "loop-plus" }, sessionId: "SYNTHETIC_SESSION_LOOP_PLUS" });
  const loopPlus = await h.fixture.adapter.startAttempt(attemptRequest("loop-plus-lock", "lp-mode-release", "A")).promise;
  assert.equal(loopPlus.outcome, "completed");
  assert.equal(h.fixture.attemptCalls.length, 2);
  assert.equal(h.fixture.createdSubtaskTargets.length, 2);
  assert.equal(handoffTracks, 0);
  assert.equal(reads.get("loop-plus-lock"), 2);
  const loopAudit = admissionRefusals(events).find((event) => event.data.attemptId === "lp-mode-release");
  assert.ok(loopAudit);
  assert.equal(loopAudit.data.result, "confirmed");
  assert.equal(loopAudit.data.rereadCount, 1);
  assertAuditText(loopAudit.data);

  const department = admissionHarness();
  t.after(() => department.fixture.dispose());
  const departmentRead = department.deps.readTask;
  let admissionReads = 0;
  let tracks = 0;
  const track = department.capacity.trackEmployee.bind(department.capacity);
  department.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
    tracks += 1;
    return track(...args);
  }) as DepartmentCapacityPool["trackEmployee"];
  department.deps.readTask = (id, options) => {
    if (options?.onUnavailable) {
      admissionReads += 1;
      if (admissionReads === 1) { options.onUnavailable("identity-lock-present"); return null; }
    }
    return departmentRead(id, options);
  };
  let foreign: Promise<unknown> | undefined;
  let paired = false;
  department.deps.runtime.setDepartmentExecutionAdmission?.((request, signal) => {
    const primary = department.host.acquireAttemptExecution(request, signal);
    if (!paired) {
      paired = true;
      assert.equal(department.host.acquireAttemptExecution(request, signal), primary);
      foreign = department.host.acquireAttemptExecution({ ...request, subtaskId: "foreign" }, signal);
    }
    return primary;
  });
  department.register("department-lock");
  department.dispatch("locked");
  const leader = await department.host.startLeader("department-lock", leaderRequest("accounts"));
  assert.equal(leader.ok, true); if (!leader.ok) return;
  await waitUntil(() => department.fixture.parkedSubtaskIds().length === 1, "department employee starts once after the identity lock");
  assert.equal(tracks, 1);
  assert.equal(department.fixture.attemptCalls.length, 1);
  assert.equal(department.fixture.createdSubtaskTargets.length, 1);
  assert.equal(await foreign, null);
  const handoff = new Set(["ordinary-lock", "ordinary-release", "loop-plus-lock", "loop-plus-stop"]);
  const validation = admissionRefusals(events).filter((event) => event.data.reason === "attempt-validation-failed" && !handoff.has(String(event.data.leaderTaskId)));
  assert.equal(validation.length, 1);
  assert.equal(department.fixture.attemptCalls.length, 1);
  const confirmed = events.filter((event) => event.event === "department-employee-admission" && event.data.result === "confirmed" && event.data.rereadCount === 1 && !handoff.has(String(event.data.leaderTaskId)));
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].data.reason, "none");
  assertAuditText(confirmed[0].data);
  await department.host.stopRoot("department-lock");
  await leader.done;
});

test("owner and loop-plus employees do not start when the re-read is stopped or the generation moved", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
  const originalGet = Map.prototype.get;
  async function expectNoLaunch(id: string, executionMode: "loop-plus" | undefined, secondRead: "stopped" | "generation"): Promise<void> {
    const h = admissionHarness();
    t.after(() => h.fixture.dispose());
    const metadata = { ...departmentMetadata(id), ...(executionMode ? { executionMode } : {}) };
    const root = { ...departmentRoot(id, ["accounts"]), department: metadata, taskStoreFile: h.fixture.storeFile };
    h.fixture.saveTask(root);
    assert.deepEqual(h.host.registerRoot(h.read(id)!, metadata, root.loopPlusAcceptancePlan!), { ok: true });
    h.dispatch(id);
    let tracks = 0;
    const track = h.capacity.trackEmployee.bind(h.capacity);
    h.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
      tracks += 1;
      return track(...args);
    }) as DepartmentCapacityPool["trackEmployee"];
    const live = h.deps.readTask;
    let admissionReads = 0;
    let held: { generation: number } | undefined;
    if (secondRead === "generation") {
      Map.prototype.get = function(this: Map<unknown, unknown>, key: unknown) {
        const value = originalGet.call(this, key) as { generation?: number; taskId?: string; leaderSubtaskId?: string; lease?: unknown; status?: string } | undefined;
        if (value && typeof value.generation === "number" && typeof value.taskId === "string" && typeof value.leaderSubtaskId === "string" && value.lease && value.status === "running") held = value as { generation: number };
        return value;
      };
    }
    h.deps.readTask = (taskId, options) => {
      if (options?.onUnavailable && new Error().stack?.includes("admitAttempt")) {
        admissionReads += 1;
        if (admissionReads === 1) {
          options.onUnavailable("identity-lock-present");
          if (secondRead === "generation") {
            if (!held) throw new Error("leader generation was not snapshotted before the lock");
            held.generation += 1;
          }
          return null;
        }
        const task = live(taskId, options);
        return secondRead === "stopped" && task ? { ...task, status: "stopped" as const } : task;
      }
      return live(taskId, options);
    };
    try {
      const leader = await h.host.startLeader(id, leaderRequest("accounts"));
      assert.equal(leader.ok, true);
      if (!leader.ok) return;
      await waitUntil(() => admissionRefusals(events).some((event) => event.data.leaderTaskId === leader.taskId && event.data.rereadCount === 1), `${id} ${secondRead} admission refused`);
      assert.equal(tracks, 0);
      assert.equal(h.fixture.attemptCalls.length, 0);
      assert.equal(h.fixture.createdSubtaskTargets.length, 0);
      assert.equal(h.fixture.rootsCreated.length, 0);
      assert.equal(h.fixture.parkedSubtaskIds().length, 0);
      assert.equal(admissionReads, 2);
      const refusal = admissionRefusals(events).find((event) => event.data.leaderTaskId === leader.taskId && event.data.rereadCount === 1);
      assert.ok(refusal);
      assertRefusal(refusal.data, secondRead === "generation" ? "identity-changed" : "attempt-validation-failed", leader.taskId, String(refusal.data.attemptId));
      assert.equal(Number(refusal.data.elapsedMs) >= 40, true);
      assertAuditText(refusal.data);
      await h.host.stopRoot(id);
      await leader.done;
    } finally {
      Map.prototype.get = originalGet;
    }
  }
  await expectNoLaunch("owner-stop", undefined, "stopped");
  await expectNoLaunch("owner-gen", undefined, "generation");
  await expectNoLaunch("mode-stop", "loop-plus", "stopped");
  await expectNoLaunch("mode-gen", "loop-plus", "generation");
});

test("leader cleanup aborts the original admission before membership can become an unowned start", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
  const control = admissionHarness();
  t.after(() => control.fixture.dispose());
  control.fixture.setAttemptAction((input, tab) => control.fixture.publish(input, tab, { status: "end", content: "ordinary execution completed" }));
  const controlRead = control.deps.readTask;
  const controlReads = new Map<string, number>();
  let controlTracks = 0;
  const controlTrack = control.capacity.trackEmployee.bind(control.capacity);
  control.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
    controlTracks += 1;
    return controlTrack(...args);
  }) as DepartmentCapacityPool["trackEmployee"];
  control.deps.readTask = (id, options) => {
    if (id === "unowned-control" && options?.onUnavailable) {
      const seen = (controlReads.get(id) ?? 0) + 1;
      controlReads.set(id, seen);
      if (seen === 1) { options.onUnavailable("identity-lock-present"); return null; }
    }
    return controlRead(id, options);
  };
  const controlDepartment = departmentMetadata("unowned-control");
  control.fixture.saveTask({ ...departmentRoot("unowned-control", []), schedulingMode: "event_driven", department: { ...controlDepartment, executionMode: "loop-plus" }, sessionId: "SYNTHETIC_SESSION_CONTROL" });
  const controlAttempt = await control.fixture.adapter.startAttempt(attemptRequest("unowned-control", "lp-unowned-once", "A")).promise;
  assert.equal(controlAttempt.outcome, "completed");
  assert.equal(control.fixture.attemptCalls.length, 1);
  assert.equal(control.fixture.createdSubtaskTargets.length, 1);
  assert.equal(control.fixture.rootsCreated.length > 0, true);
  assert.equal(controlTracks, 0);
  assert.equal(controlReads.get("unowned-control"), 2);
  const controlAudit = admissionRefusals(events).find((event) => event.data.attemptId === "lp-unowned-once");
  assert.ok(controlAudit);
  assert.equal(controlAudit.data.result, "confirmed");
  assert.equal(controlAudit.data.reason, "none");
  assert.equal(controlAudit.data.rereadCount, 1);
  assertAuditText(controlAudit.data);

  const owned = admissionHarness();
  t.after(() => owned.fixture.dispose());
  const id = "owned-cleanup";
  const metadata = { ...departmentMetadata(id), executionMode: "loop-plus" as const };
  const root = { ...departmentRoot(id, ["accounts"]), department: metadata, taskStoreFile: owned.fixture.storeFile };
  owned.fixture.saveTask(root);
  assert.deepEqual(owned.host.registerRoot(owned.read(id)!, metadata, root.loopPlusAcceptancePlan!), { ok: true });
  owned.dispatch(id);
  let ownedTracks = 0;
  const ownedTrack = owned.capacity.trackEmployee.bind(owned.capacity);
  owned.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
    ownedTracks += 1;
    return ownedTrack(...args);
  }) as DepartmentCapacityPool["trackEmployee"];
  const live = owned.deps.readTask;
  let admissionReads = 0;
  let notifyLock: () => void = () => undefined;
  const lockSeen = new Promise<void>((resolve) => { notifyLock = resolve; });
  owned.deps.readTask = (taskId, options) => {
    if (options?.onUnavailable && new Error().stack?.includes("admitAttempt")) {
      admissionReads += 1;
      if (admissionReads === 1) {
        options.onUnavailable("identity-lock-present");
        notifyLock();
        return null;
      }
    }
    return live(taskId, options);
  };
  const leader = await owned.host.startLeader(id, leaderRequest("accounts"));
  assert.equal(leader.ok, true);
  if (!leader.ok) return;
  await lockSeen;
  assert.equal(owned.host.runtimeSnapshot(id)!.leaders.some((item) => item.taskId === leader.taskId), true);
  // Real cancel stops the leader, aborts this admission, then deletes the member.
  // The identity lock is not released into decideAttempt, so a missing member cannot start as unowned.
  const removed = await owned.host.cancelLeader(id, leader.taskId);
  assert.equal(removed, true);
  assert.equal(admissionReads, 1);
  assert.equal(owned.fixture.attemptCalls.length, 0);
  assert.equal(owned.fixture.createdSubtaskTargets.length, 0);
  assert.equal(owned.fixture.rootsCreated.length, 0);
  assert.equal(owned.fixture.parkedSubtaskIds().length, 0);
  assert.equal(ownedTracks, 0);
  assert.equal(owned.host.runtimeSnapshot(id)!.leaders.some((item) => item.taskId === leader.taskId), false);
  const ownedRefusal = admissionRefusals(events).find((event) => event.data.leaderTaskId === leader.taskId);
  assert.ok(ownedRefusal);
  assertRefusal(ownedRefusal.data, "admission-cancelled", leader.taskId, String(ownedRefusal.data.attemptId));
  assert.equal(ownedRefusal.data.rereadCount, 0);
  assertAuditText(ownedRefusal.data);
  await owned.host.stopRoot(id);
  await leader.done;
});

test("identity-lock reread refuses a watched leader that disappeared and still starts one unowned control", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
  const control = admissionHarness();
  t.after(() => control.fixture.dispose());
  control.fixture.setAttemptAction((input, tab) => control.fixture.publish(input, tab, { status: "end", content: "ordinary execution completed" }));
  const controlRead = control.deps.readTask;
  const controlReads = new Map<string, number>();
  let controlTracks = 0;
  const controlTrack = control.capacity.trackEmployee.bind(control.capacity);
  control.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
    controlTracks += 1;
    return controlTrack(...args);
  }) as DepartmentCapacityPool["trackEmployee"];
  control.deps.readTask = (id, options) => {
    if (id === "unowned-reread" && options?.onUnavailable) {
      const seen = (controlReads.get(id) ?? 0) + 1;
      controlReads.set(id, seen);
      if (seen === 1) { options.onUnavailable("identity-lock-present"); return null; }
    }
    return controlRead(id, options);
  };
  const controlDepartment = departmentMetadata("unowned-reread");
  control.fixture.saveTask({ ...departmentRoot("unowned-reread", []), schedulingMode: "event_driven", department: { ...controlDepartment, executionMode: "loop-plus" }, sessionId: "SYNTHETIC_SESSION_REREAD_CONTROL" });
  const controlAttempt = await control.fixture.adapter.startAttempt(attemptRequest("unowned-reread", "lp-unowned-reread", "A")).promise;
  assert.equal(controlAttempt.outcome, "completed");
  assert.equal(control.fixture.attemptCalls.length, 1);
  assert.equal(control.fixture.createdSubtaskTargets.length, 1);
  assert.equal(controlTracks, 0);
  assert.equal(controlReads.get("unowned-reread"), 2);
  const controlAudit = admissionRefusals(events).find((event) => event.data.attemptId === "lp-unowned-reread");
  assert.ok(controlAudit);
  assert.equal(controlAudit.data.result, "confirmed");
  assert.equal(controlAudit.data.reason, "none");
  assert.equal(controlAudit.data.rereadCount, 1);
  assertAuditText(controlAudit.data);

  const owned = admissionHarness();
  t.after(() => owned.fixture.dispose());
  owned.fixture.setAttemptAction((input, tab) => owned.fixture.publish(input, tab, { status: "end", content: "disappeared owner must not run" }));
  const id = "owned-disappeared";
  const metadata = { ...departmentMetadata(id), executionMode: "loop-plus" as const };
  const root = { ...departmentRoot(id, ["accounts"]), department: metadata, taskStoreFile: owned.fixture.storeFile };
  owned.fixture.saveTask(root);
  assert.deepEqual(owned.host.registerRoot(owned.read(id)!, metadata, root.loopPlusAcceptancePlan!), { ok: true });
  owned.dispatch(id);
  let ownedTracks = 0;
  const ownedTrack = owned.capacity.trackEmployee.bind(owned.capacity);
  owned.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
    ownedTracks += 1;
    return ownedTrack(...args);
  }) as DepartmentCapacityPool["trackEmployee"];
  const live = owned.deps.readTask;
  let admissionReads = 0;
  let rereadStatus: string | undefined;
  let notifyLock: () => void = () => undefined;
  const lockSeen = new Promise<void>((resolve) => { notifyLock = resolve; });
  const originalGet = Map.prototype.get;
  let members: Map<string, { taskId: string }> | undefined;
  Map.prototype.get = function(this: Map<string, { taskId?: string; generation?: number; leaderSubtaskId?: string; lease?: unknown; status?: string }>, key: string) {
    const value = originalGet.call(this, key);
    if (value && typeof value.generation === "number" && typeof value.taskId === "string" && typeof value.leaderSubtaskId === "string" && value.lease && value.status === "running") {
      members = this as Map<string, { taskId: string }>;
    }
    return value;
  };
  owned.deps.readTask = (taskId, options) => {
    if (options?.onUnavailable && new Error().stack?.includes("admitAttempt")) {
      admissionReads += 1;
      if (admissionReads === 1) {
        options.onUnavailable("identity-lock-present");
        notifyLock();
        return null;
      }
      const task = live(taskId, options);
      rereadStatus = task?.status;
      return task;
    }
    return live(taskId, options);
  };
  try {
    const leader = await owned.host.startLeader(id, leaderRequest("accounts"));
    assert.equal(leader.ok, true);
    if (!leader.ok) return;
    await lockSeen;
    assert.ok(members);
    assert.equal(owned.host.runtimeSnapshot(id)!.leaders.some((item) => item.taskId === leader.taskId), true);
    assert.equal(members.delete(leader.taskId), true);
    assert.equal(members.has(leader.taskId), false);
    await waitUntil(() => admissionReads === 2 && (ownedTracks > 0 || owned.fixture.attemptCalls.length > 0 || admissionRefusals(events).some((event) => event.data.leaderTaskId === leader.taskId && event.data.rereadCount === 1)), "disappeared leader reread settled");
    assert.equal(rereadStatus, "running");
    assert.equal(admissionReads, 2);
    assert.equal(ownedTracks, 0);
    assert.equal(owned.fixture.attemptCalls.length, 0);
    assert.equal(owned.fixture.createdSubtaskTargets.length, 0);
    assert.equal(owned.fixture.rootsCreated.length, 0);
    assert.equal(owned.fixture.parkedSubtaskIds().length, 0);
    const refusal = admissionRefusals(events).find((event) => event.data.leaderTaskId === leader.taskId && event.data.rereadCount === 1);
    assert.ok(refusal);
    assertRefusal(refusal.data, "identity-changed", leader.taskId, String(refusal.data.attemptId));
    assert.equal(Number(refusal.data.elapsedMs) >= 40, true);
    assertAuditText(refusal.data);
    owned.deps.runtime.host().stopParent(leader.taskId);
    await owned.host.stopRoot(id);
    await leader.done;
  } finally {
    Map.prototype.get = originalGet;
  }
});

test("sustained identity lock, cancellation, and invalid ownership stop with no CLI start", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
  const h = admissionHarness();
  t.after(() => h.fixture.dispose());
  const original = h.deps.readTask;
  let cancelReads = 0;
  h.deps.readTask = (id, options) => {
    if (id === "cancel-lock" && options?.onUnavailable) {
      cancelReads += 1;
      options.onUnavailable("identity-lock-present");
      return null;
    }
    return original(id, options);
  };
  const cancellation = new AbortController();
  const cancelling = h.host.acquireAttemptExecution({ taskId: "cancel-lock", attemptId: "lp-cancel", subtaskId: "accounts" }, cancellation.signal);
  await waitUntil(() => cancelReads === 1, "identity lock wait started");
  cancellation.abort();
  assert.equal(await cancelling, null);
  assert.equal(cancelReads, 1);
  const cancelled = admissionRefusals(events).find((event) => event.data.attemptId === "lp-cancel");
  assert.ok(cancelled);
  assertRefusal(cancelled.data, "admission-cancelled", "cancel-lock", "lp-cancel");
  assert.equal(cancelled.data.rereadCount, 0);
  assert.equal(Number(cancelled.data.elapsedMs) < 1000, true);
  assertAuditText(cancelled.data);

  let invalidReads = 0;
  h.deps.readTask = (id, options) => {
    if (id === "invalid-lock" && options?.onUnavailable) {
      invalidReads += 1;
      if (invalidReads === 1) { options.onUnavailable("identity-lock-present"); return null; }
    }
    return original(id, options);
  };
  h.fixture.saveTask({ ...departmentRoot("invalid-lock", ["accounts"]), taskStoreFile: h.fixture.storeFile, sessionId: "SYNTHETIC_SESSION_INVALID" });
  const invalid = await h.fixture.adapter.startAttempt(attemptRequest("invalid-lock", "lp-invalid-owner", "accounts")).promise;
  assert.equal(invalid.outcome, "failed");
  assert.equal(invalid.detail, "部门执行准入被拒绝，子任务未启动");
  assert.equal(invalidReads, 2);
  const ownership = admissionRefusals(events).find((event) => event.data.attemptId === "lp-invalid-owner");
  assert.ok(ownership);
  assertRefusal(ownership.data, "owner-or-member-missing", "invalid-lock", "lp-invalid-owner");
  assert.equal(ownership.data.rereadCount, 1);
  assert.equal(Number(ownership.data.elapsedMs) >= 40, true);
  assertAuditText(ownership.data);
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
  assert.equal(h.fixture.rootsCreated.length, 0);
});

test("missing or corrupt admission reads do not retry and the re-read uses the latest record", async (t) => {
  const events: AdmissionEvent[] = [];
  recordLifecycle(t, events);
  const h = admissionHarness();
  t.after(() => h.fixture.dispose());
  const original = h.deps.readTask;
  let reads = 0;
  h.deps.readTask = (id, options) => {
    reads += 1;
    if (id === "present-once") return { id, department: undefined } as LoopTaskRecord;
    const reason = id === "missing-record" ? "task-not-found" : id === "corrupt-record" ? "store-read-rejected" : "identity-lock-present-SYNTHETIC /tmp/private";
    options?.onUnavailable?.(reason as never);
    return null;
  };
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "present-once", attemptId: "lp-first", subtaskId: "accounts" }, new AbortController().signal), undefined);
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "missing-record", attemptId: "lp-missing", subtaskId: "accounts" }, new AbortController().signal), null);
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "corrupt-record", attemptId: "lp-corrupt", subtaskId: "accounts" }, new AbortController().signal), null);
  assert.equal(await h.host.acquireAttemptExecution({ taskId: "near-lock", attemptId: "lp-near", subtaskId: "accounts" }, new AbortController().signal), null);
  assert.equal(reads, 4);
  const byAttempt = new Map(admissionRefusals(events).map((event) => [event.data.attemptId, event.data]));
  assert.equal(byAttempt.has("lp-first"), false);
  assertRefusal(byAttempt.get("lp-missing")!, "task-record-unavailable", "missing-record", "lp-missing", "task-not-found");
  assertRefusal(byAttempt.get("lp-corrupt")!, "task-record-unavailable", "corrupt-record", "lp-corrupt", "store-read-rejected");
  assertRefusal(byAttempt.get("lp-near")!, "task-record-unavailable", "near-lock", "lp-near", "unknown");
  for (const attemptId of ["lp-missing", "lp-corrupt", "lp-near"]) assert.equal("rereadCount" in byAttempt.get(attemptId)!, false);
  assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0);
  h.deps.readTask = original;

  h.register("latest-root");
  h.dispatch("latest");
  const leader = await h.host.startLeader("latest-root", leaderRequest("accounts"));
  assert.equal(leader.ok, true); if (!leader.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "leader employee parked before stale-read check");
  const running = createLoopPlusScheduler({ snapshot: h.read(leader.taskId)!.loopPlus }).snapshot().running[0];
  const calls = h.fixture.attemptCalls.length;
  const targets = h.fixture.createdSubtaskTargets.length;
  const generation = h.host.runtimeSnapshot("latest-root")!.leaders[0].generation;
  const liveRead = h.deps.readTask;
  let latestReads = 0;
  const track = h.capacity.trackEmployee.bind(h.capacity);
  let tracks = 0;
  h.capacity.trackEmployee = ((...args: Parameters<DepartmentCapacityPool["trackEmployee"]>) => {
    tracks += 1;
    return track(...args);
  }) as DepartmentCapacityPool["trackEmployee"];
  h.deps.readTask = (id, options) => {
    if (id === leader.taskId && options?.onUnavailable) {
      latestReads += 1;
      if (latestReads === 1) {
        const current = liveRead(leader.taskId);
        if (current?.department) h.fixture.saveTask({ ...current, status: "stopped", department: { ...current.department, rootTaskId: "foreign-root" } });
        options.onUnavailable("identity-lock-present");
        return null;
      }
    }
    return liveRead(id, options);
  };
  const stale = await h.host.acquireAttemptExecution({ taskId: leader.taskId, attemptId: running.attemptId, subtaskId: running.subtaskId }, new AbortController().signal);
  assert.equal(stale, null);
  assert.equal(latestReads, 2);
  assert.equal(tracks, 0);
  assert.equal(h.fixture.attemptCalls.length, calls);
  assert.equal(h.fixture.createdSubtaskTargets.length, targets);
  const refusal = admissionRefusals(events).find((event) => event.data.attemptId === running.attemptId && event.data.reason === "attempt-validation-failed");
  assert.ok(refusal);
  assert.equal(refusal.data.generation, generation);
  assert.equal(refusal.data.rereadCount, 1);
  assert.equal(refusal.data.result, "refused");
  assertAuditText(refusal.data);
  await h.host.stopRoot("latest-root");
  await leader.done;
});
