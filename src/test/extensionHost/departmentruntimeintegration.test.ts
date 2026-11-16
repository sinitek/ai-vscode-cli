import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { installVscodeMock } from "../vscodeMock";
installVscodeMock();
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { DepartmentMetadata } from "../../department";
import type { DepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import type { DepartmentExecutionObservation } from "../../extensionHost/departmentorchestration";
import type { LoopPlusRuntimeAdapter } from "../../extensionHost/loopPlusRuntimeAdapter";
import { DepartmentCapacityPool } from "../../departmentcapacity";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
const { createDepartmentOrchestrationHost } = require("../../extensionHost/departmentorchestration") as typeof import("../../extensionHost/departmentorchestration");
const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");

function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
const request = (id: string) => ({ leaderSubtaskId: id, moduleTitle: id, prompt: `Implement the complete ${id} module, report progress and coordinate dependencies through the director.` });
function metadata(rootTaskId: string): DepartmentMetadata {
  return { version: 1, rootTaskId, parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "部门",
    routes: { director: { cli: "codex", configId: "profile" }, leader: { cli: "codex", configId: "profile", model: "leader" },
      employee: { cli: "codex", configId: "profile", model: "employee" } }, limits: { maxLeaders: 4, maxEmployees: 1 } };
}
function rootRecord(id: string, modules: string[]): LoopTaskRecord {
  return { id, cli: "codex", workspaceKey: "workspace", taskStoreFile: "fixture", rootPrompt: "部门目标", department: metadata(id),
    loopPlusAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot(), schedulingMode: "classic", status: "running", createdAt: Date.now(), updatedAt: Date.now(),
    maxRounds: 20, currentRound: 0, communicationDir: "/fixture", mainCommunicationFile: "/fixture/main", sessionId: `director-${id}`,
    subTasks: modules.map((id) => ({ id, title: id, prompt: request(id).prompt, status: "pending" })), rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [] };
}
function harness(options: Parameters<typeof createLoopPlusRuntimeFixture>[0] & { maxEmployees?: number;
  observeLeaderCleanup?: import("../../extensionHost/departmentorchestration").DepartmentOrchestrationDeps["observeLeaderCleanup"] } = {}) {
  // Auxiliary host/adapter contract cases do not claim controlled-storage provenance.
  // The isolated admission fixture below separately exercises the real production task-store router.
  const tasks = new Map<string, LoopTaskRecord>();
  const persistence = {
    create: (task: LoopTaskRecord) => { tasks.set(task.id, structuredClone(task)); return structuredClone(task); },
    read: (id: string) => { const task = tasks.get(id); return task ? structuredClone(task) : null; },
    save: (task: LoopTaskRecord) => { tasks.set(task.id, structuredClone(task)); },
    remove: (id: string) => { tasks.delete(id); },
  };
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile", taskPersistence: persistence, ...options });
  const capacity = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: options.maxEmployees ?? 20 });
  const snapshots = new Map<string, DepartmentRuntimeSnapshot>();
  const notices: string[] = [];
  const sessions = new Map<string, { tabId: string; cli: "codex"; sessionId: string }>();
  const liveLeaders = new Map<string, DepartmentExecutionObservation>();
  const liveEmployees = new Map<string, DepartmentExecutionObservation>();
  let persistenceFails = false;
  let next = 0;
  const read = fixture.readTask;
  const update = (id: string, patch: Partial<LoopTaskRecord>) => { const task = read(id); if (!task) return null; fixture.saveTask({ ...task, ...patch }); return read(id); };
  const deps = {
    capacity, readTask: read, updateTask: update, runtime: fixture.adapter,
    createLeaderTarget: () => { const target = { tabId: `leader-tab-${++next}`, cli: "codex" as const, sessionId: `leader-session-${next}` }; sessions.set(target.sessionId, target); return target; },
    buildLeaderInput: (_route: unknown, req: ReturnType<typeof request>) => ({ displayPrompt: req.prompt, modelPrompt: req.prompt, contextTags: [], loopSubtaskMode: "fullstack" as const }),
    validateRoutes: (routes: DepartmentMetadata["routes"]) => Object.values(routes).every((r) => r.cli === "codex" && r.configId === "profile"),
    inspectLeaderSession: (task: LoopTaskRecord) => { const target = sessions.get(task.sessionId!); return target ? { target, live: liveLeaders.get(task.id) ?? null } : null; },
    observeRestoredExecution: (task: LoopTaskRecord, req: { attemptId: string }) => liveEmployees.get(JSON.stringify([task.id, req.attemptId])) ?? null,
    ...(options.observeLeaderCleanup ? { observeLeaderCleanup: options.observeLeaderCleanup } : {}),
    stopLeader: () => undefined,
    persistRuntime: (snapshot: DepartmentRuntimeSnapshot) => { if (persistenceFails) throw new Error("disk unavailable"); snapshots.set(snapshot.rootTaskId, structuredClone(snapshot)); },
    notifyDirector: (rootId: string) => { notices.push(rootId); }, createMessageId: () => `message-${++next}`,
  };
  const host = createDepartmentOrchestrationHost(deps);
  function register(id = "root", modules = ["accounts", "reports"]) { const root = rootRecord(id, modules); fixture.saveTask({ ...root, taskStoreFile: fixture.storeFile });
    assert.deepEqual(host.registerRoot(read(id)!, root.department, root.loopPlusAcceptancePlan!), { ok: true }); return read(id)!; }
  function dispatch(prefix: string, count = 1) {
    fixture.queueMain((input, tab) => fixture.publish(input, tab, { status: "end", content: JSON.stringify({ status: "dispatch", subtasks: Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i}`, title: `${prefix}-${i}`, prompt: `Implement ${prefix}-${i} with all required behavior and report the actual verification evidence to the leader.`, writeFiles: [], taskType: "general",
    })) }) }));
  }
  function pause() { fixture.queueMain(() => { throw Object.assign(new Error("session occupied"), { code: "SESSION_RUN_ACTIVE" }); }); }
  function finish() { fixture.queueMain((input, tab) => { const event = input.displayPrompt.match(/Current review eventId: (\S+)/)?.[1];
    fixture.publish(input, tab, { status: "end", content: JSON.stringify(withLoopPlusAcceptReviews({ status: "completed", progressPercent: 100,
      ...(event && event !== "(none)" ? { reviewEventId: event } : {}), finalSummary: "完成，依据员工报告确认", answerConclusion: "完成",
      acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "module", passed: true }] })) }); }); }
  return { fixture, capacity, host, deps, register, dispatch, pause, finish, read, update, snapshots, sessions, notices, liveLeaders, liveEmployees,
    failPersistence: (value: boolean) => { persistenceFails = value; } };
}

for (const legacy of [false, true]) test(`installed department hook delegates ordinary Loop+ (legacy hook=${legacy})`, async (t) => {
  let grants = 0, releases = 0;
  const h = harness({ acquireAttemptExecution: legacy ? async () => { grants++; return { release: () => { releases++; } }; } : undefined });
  t.after(() => h.fixture.dispose());
  h.fixture.setAttemptAction((input, tab) => h.fixture.publish(input, tab, { status: "end", content: "ordinary execution completed" }));
  h.fixture.saveTask({ ...rootRecord("ordinary", []), schedulingMode: "event_driven", department: undefined });
  const req = { taskId: "ordinary", subtaskId: "A", attemptId: "A1", title: "A", prompt: "A", modelPrompt: "A", writeFiles: [], round: 1, targetCli: "codex" as const };
  const handle = h.fixture.adapter.startAttempt(req);
  assert.equal(h.fixture.adapter.startAttempt(req), handle);
  assert.equal((await handle.promise).outcome, "completed");
  assert.equal(h.fixture.attemptCalls.length, 1);
  assert.equal(grants, legacy ? 1 : 0); assert.equal(releases, grants);
  h.fixture.saveTask({ ...rootRecord("invalid", []), department: undefined, departmentInvalid: true });
  assert.equal((await h.fixture.adapter.startAttempt({ ...req, taskId: "invalid", attemptId: "bad" }).promise).outcome, "failed");
  assert.equal(h.fixture.attemptCalls.length, 1);
});

test("real host/adapter/pool reserves modules once, shares employees and preserves overflow until actual cleanup", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register();
  assert.equal(h.host.canCompleteRoot("root"), false);
  assert.equal((await h.host.startLeader("root", request("unknown"))).ok, false);
  const releaseReviews = deferred(); t.after(() => releaseReviews.resolve());
  h.dispatch("accounts", 3);
  h.fixture.queueMain(() => releaseReviews.promise);
  const firstPending = h.host.startLeader("root", request("accounts"));
  assert.equal((await h.host.startLeader("root", request("accounts"))).ok, false);
  const first = await firstPending; assert.equal(first.ok, true); if (!first.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 2, "one normal employee and one overflow");
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 2);
  assert.equal(h.capacity.getEmployeeCapacity("root", first.taskId)!.leaderOverflowActive, true);
  h.dispatch("reports", 2);
  h.fixture.queueMain(() => releaseReviews.promise);
  const second = await h.host.startLeader("root", request("reports")); assert.equal(second.ok, true); if (!second.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 3, "other leader has one overflow");
  assert.equal(h.capacity.snapshot("root")[0].employeeOverflow!.length, 2);
  assert.equal(h.fixture.rootsCreated.length, 3, "capacity denials create no execution root or tab");
  assert.equal(h.fixture.createdSubtaskTargets.length, 3);
  const identity = h.capacity.snapshot("root")[0].employees[0];
  const [taskId, attemptId] = JSON.parse(identity);
  const running = (h.read(taskId)!.loopPlus as ReturnType<ReturnType<typeof createLoopPlusScheduler>["snapshot"]>).running.find((a) => a.attemptId === attemptId)!;
  const sameLease = await h.host.acquireAttemptExecution({ taskId, attemptId, subtaskId: running.subtaskId }, new AbortController().signal);
  assert.ok(sameLease);
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 3, "duplicate identity does not count twice");
  h.fixture.setHoldAbort(true);
  const stopping = h.host.stopRoot("root");
  await waitForLoopPlus(() => h.fixture.cancelledTabs.length >= 3, "stop requests actual CLI cancellation");
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 2);
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 3);
  releaseReviews.resolve();
  for (const id of [...h.fixture.parkedSubtaskIds()]) h.fixture.finishParked(id, { status: "stopped" });
  assert.equal(await stopping, true);
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 0);
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 0);
  assert.equal(h.fixture.rootsDisposed.length, 3);
  assert.equal(h.host.canCompleteRoot("root"), false);
});

test("real paused/stopped leaders retain unique tasks and re-acquire slots when continued", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]);
  h.pause(); const first = await h.host.startLeader("root", request("accounts")); assert.ok(first.ok); if (!first.ok) return;
  await first.done;
  assert.equal(h.read(first.taskId)!.status, "needs-review");
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 0);
  h.dispatch("continued");
  const resume = h.host.continueRoot("root");
  assert.equal((await h.host.continueRoot("root")).ok, false);
  assert.equal((await resume).ok, true);
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().includes("continued-0"), "continued real task dispatched");
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 1);
  assert.equal(h.host.runtimeSnapshot("root")!.leaders[0].taskId, first.taskId);
  assert.equal((await h.host.startLeader("root", request("accounts"))).ok, false);
  await h.host.stopRoot("root");
  h.finish();
  assert.equal((await h.host.continueRoot("root")).ok, true);
  await waitForLoopPlus(() => h.capacity.snapshot("root")[0].leaders.length === 0, "continued stopped leader completes or pauses after cleanup");
});

for (const proof of ["missing", "rejected", "confirmed"] as const) {
  test(`production leader cleanup gate retains capacity after controller settlement (${proof})`, async (t) => {
    const cleanup = deferred(); let requested = false;
    const h = harness({ observeLeaderCleanup: () => {
      requested = true;
      if (proof === "missing") return null;
      return { done: proof === "rejected" ? Promise.reject(new Error("owner-unreachable")) : cleanup.promise };
    } });
    t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]); h.pause();
    const first = await h.host.startLeader("root", request("accounts")); assert.ok(first.ok); if (!first.ok) return;
    await waitForLoopPlus(() => requested, "whole coordinator cleanup gate invoked after idle");
    assert.equal(h.capacity.snapshot("root")[0].leaders.length, 1, "business result and idle cannot release");
    if (proof === "confirmed") cleanup.resolve();
    await first.done;
    assert.equal(h.capacity.snapshot("root")[0].leaders.length, proof === "confirmed" ? 0 : 1);
    if (proof !== "confirmed") {
      assert.equal(h.host.runtimeSnapshot("root")!.leaders[0].status, "blocked");
      assert.equal((await h.host.continueRoot("root")).ok, false);
      assert.equal(await h.host.stopRoot("root"), false);
      assert.equal(h.capacity.snapshot("root")[0].leaders.length, 1, "stop cannot bypass missing proof");
    }
  });
}

test("leader cleanup gate keeps lease if persistence fails after confirmation", async (t) => {
  const cleanup = deferred(); let requested = false;
  const h = harness({ observeLeaderCleanup: () => { requested = true; return { done: cleanup.promise }; } });
  t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]); h.pause();
  const first = await h.host.startLeader("root", request("accounts")); assert.ok(first.ok); if (!first.ok) return;
  await waitForLoopPlus(() => requested, "cleanup wait installed");
  h.failPersistence(true); cleanup.resolve(); await first.done;
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 1);
  assert.equal(h.host.runtimeSnapshot("root")!.leaders[0].status, "blocked");
});

test("director coordination is explicit, retryable and durable, without direct leader forwarding", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register();
  h.dispatch("A"); const a = await h.host.startLeader("root", request("accounts")); assert.ok(a.ok); if (!a.ok) return;
  h.dispatch("B"); const b = await h.host.startLeader("root", request("reports")); assert.ok(b.ok); if (!b.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 2, "both live leaders");
  const input = { id: "collaboration", targetLeaderTaskId: b.taskId, body: "报表需支持账号维度" };
  assert.equal(h.host.coordinateCollaboration(a.taskId, input).ok, true);
  assert.deepEqual(h.notices, ["root"]);
  assert.deepEqual((h.read(b.taskId)!.loopPlus as { userMessageQueue: string[] }).userMessageQueue, []);
  assert.equal(h.host.coordinateCollaboration(a.taskId, input).ok, true);
  assert.equal(h.notices.length, 1);
  assert.equal(h.host.coordinateCollaboration(a.taskId, { ...input, body: "conflict" }).ok, false);
  h.pause();
  assert.equal(h.host.processDirectorCollaboration("root", input.id).ok, true);
  assert.equal(h.host.processDirectorCollaboration("root", input.id).ok, true);
  assert.equal(h.read(b.taskId)!.departmentDeliveries![`department:root:${input.id}`], input.body);
  assert.equal(h.host.coordinateCollaboration(a.taskId, { ...input, id: "cross", targetLeaderTaskId: "foreign" }).ok, false);
  assert.equal(h.host.canCompleteRoot("root"), false);
  await h.host.stopRoot("root");
});

test("frozen plan is isolated, live edits rejected, root completion rechecks unstarted modules and requirements", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); const root = h.register("root", ["accounts", "reports"]);
  const original = structuredClone(root.loopPlusAcceptancePlan!);
  root.loopPlusAcceptancePlan!.name = "mutated caller";
  h.finish(); const first = await h.host.startLeader("root", request("accounts")); assert.ok(first.ok); if (!first.ok) return;
  await first.done;
  assert.deepEqual(h.read(first.taskId)!.loopPlusAcceptancePlan ?? buildSystemLoopPlusAcceptancePlanSnapshot(), original);
  assert.equal(h.fixture.adapter.host().applyAcceptancePlan(first.taskId, { ...original, checks: ["security"] }).ok, false);
  assert.equal(h.host.canCompleteRoot("root"), false, "reports was never started");
  h.finish(); const second = await h.host.startLeader("root", request("reports")); assert.ok(second.ok); if (!second.ok) return;
  await second.done;
  assert.equal(h.host.canCompleteRoot("root"), true);
  h.update("root", { supplementalRequirements: ["新增报表要求"] });
  assert.equal(h.host.confirmRootComplete("root", "done").ok, false, "old readiness is not authorization");
  assert.equal(h.host.acknowledgeRootRequirements("root", ["新增报表要求"]), true);
  assert.equal(h.host.confirmRootComplete("root", "总监依据组长汇报确认完成").ok, true);
});

test("per-root live recovery observes real adapter cleanup, preserves another root, and never restarts live attempts", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); const root = h.register("root", ["accounts"]);
  h.dispatch("restored"); const leader = await h.host.startLeader("root", request("accounts")); assert.ok(leader.ok); if (!leader.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "employee live before recovery");
  const task = h.read(leader.taskId)!;
  const running = (task.loopPlus as { running: Array<{ attemptId: string; subtaskId: string }> }).running[0];
  const capacitySaved = h.capacity.snapshot("root"); const saved = h.host.runtimeSnapshot("root")!;
  const cleanup = h.fixture.adapter.waitForTaskIdle(leader.taskId);
  h.liveLeaders.set(leader.taskId, { done: leader.done });
  h.liveEmployees.set(JSON.stringify([leader.taskId, running.attemptId]), { done: cleanup });
  const newPool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const otherLease = await newPool.acquireLeader("unrelated", "other");
  const restored = createDepartmentOrchestrationHost({ ...h.deps, capacity: newPool });
  assert.equal(restored.recoverRoot(root, root.department, root.loopPlusAcceptancePlan!, saved, capacitySaved).ok, true);
  assert.equal(newPool.snapshot("unrelated")[0].leaders.length, 1);
  assert.equal(h.fixture.attemptCalls.length, 1);
  assert.equal(await restored.acquireAttemptExecution({ taskId: leader.taskId, subtaskId: running.subtaskId, attemptId: running.attemptId }, new AbortController().signal), null);
  h.fixture.setHoldAbort(true); const stopping = restored.stopRoot("root");
  await waitForLoopPlus(() => h.fixture.cancelledTabs.length > 0, "restored task stop reaches real adapter");
  assert.equal(newPool.snapshot("root")[0].employees.length, 1);
  h.fixture.finishParked("restored-0", { status: "stopped" });
  assert.equal(await stopping, true);
  assert.equal(newPool.snapshot("root")[0].employees.length, 0);
  assert.equal(newPool.snapshot("root")[0].leaders.length, 0);
  assert.equal(newPool.snapshot("unrelated")[0].leaders.length, 1); otherLease!.release();
});

test("persistence failure during completion cannot prevent released employee and leader capacity", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]);
  h.dispatch("work"); const started = await h.host.startLeader("root", request("accounts")); assert.ok(started.ok); if (!started.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "employee started");
  h.failPersistence(true);
  await h.host.stopRoot("root");
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 0);
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 0);
  assert.equal(h.host.canCompleteRoot("root"), false);
});

for (const invalidation of ["parent-identity", "cancel"] as const) test(`employee admission rechecks ${invalidation} after a real pool grant and preserves pending identity`, async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]);
  const granted = deferred(), releaseGrant = deferred(); t.after(() => releaseGrant.resolve());
  const acquire = h.capacity.tryAcquireEmployeeWithOverflow.bind(h.capacity);
  h.capacity.tryAcquireEmployeeWithOverflow = (...args) => {
    const result = acquire(...args);
    granted.resolve();
    return result.then(async (lease) => { await releaseGrant.promise; return lease; });
  };
  h.dispatch("gated");
  const started = await h.host.startLeader("root", request("accounts")); assert.ok(started.ok); if (!started.ok) return;
  await granted.promise;
  const original = h.read(started.taskId)!;
  const running = createLoopPlusScheduler({ snapshot: original.loopPlus }).snapshot().running[0];
  const req = { taskId: started.taskId, subtaskId: running.subtaskId, attemptId: running.attemptId };
  const pending = h.host.acquireAttemptExecution(req, new AbortController().signal);
  assert.equal(h.host.acquireAttemptExecution(req, new AbortController().signal), pending);
  assert.equal(await h.host.acquireAttemptExecution({ ...req, subtaskId: "foreign" }, new AbortController().signal), null);
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 1, "real pool already granted, but execution has not started");
  let stopping: Promise<boolean> | undefined;
  if (invalidation === "parent-identity") h.update(started.taskId, { department: { ...original.department!, parentTaskId: "foreign" } });
  else stopping = h.host.stopRoot("root");
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 1, "cancellation is not evidence that the delayed grant was cleaned");
  releaseGrant.resolve();
  assert.equal(await pending, null);
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 0);
  assert.equal(h.fixture.createdSubtaskTargets.length, 0); assert.equal(h.fixture.rootsCreated.length, 0); assert.equal(h.fixture.attemptCalls.length, 0);
  if (invalidation === "parent-identity") h.update(started.taskId, { department: original.department });
  await (stopping ?? h.host.stopRoot("root"));
  await started.done;
});

test("failed target delivery can be retried by director, receipt prevents duplicate queue append", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register();
  h.dispatch("source"); const source = await h.host.startLeader("root", request("accounts")); assert.ok(source.ok); if (!source.ok) return;
  h.dispatch("target"); const target = await h.host.startLeader("root", request("reports")); assert.ok(target.ok); if (!target.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 2, "source and target active");
  const message = { id: "retry", targetLeaderTaskId: target.taskId, body: "总监协调报表补充要求" };
  assert.equal(h.host.coordinateCollaboration(source.taskId, message).ok, true);
  h.update(target.taskId, { status: "stopped" });
  assert.equal(h.host.processDirectorCollaboration("root", "retry").ok, false);
  assert.equal(h.host.runtimeSnapshot("root")!.collaborations[0].status, "rejected");
  h.update(target.taskId, { status: "running" }); h.pause();
  assert.equal(h.host.processDirectorCollaboration("root", "retry").ok, true);
  const receiptId = "department:root:retry";
  assert.equal(h.fixture.adapter.host().submitUserMessage(target.taskId, message.body, receiptId), true);
  assert.equal(h.fixture.adapter.host().submitUserMessage(target.taskId, "conflicting body", receiptId), false);
  await h.host.stopRoot("root");
});

test("startup persistence failure stops and drains before retry releases the module reservation", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]);
  let rejectCreatedMember = true;
  const originalPersist = h.deps.persistRuntime;
  // A second host installs the same actual adapter with a failing organization persistence port.
  const host = createDepartmentOrchestrationHost({ ...h.deps, persistRuntime: (saved) => {
    if (rejectCreatedMember && saved.leaders.length) throw new Error("created member write failed");
    originalPersist(saved);
  } });
  const root = h.read("root")!;
  assert.equal(host.registerRoot(root, root.department, root.loopPlusAcceptancePlan!).ok, true);
  h.pause();
  assert.equal((await host.startLeader("root", request("accounts"))).ok, false);
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 0);
  assert.equal(host.runtimeSnapshot("root")!.startingModules!.length, 0);
  rejectCreatedMember = false; h.finish();
  const retry = await host.startLeader("root", request("accounts")); assert.ok(retry.ok); if (!retry.ok) return;
  await retry.done;
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 0);
});

test("non-default root plan is deep-copied through leader prompts, and recovery rejects plan drift", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose());
  const root = rootRecord("custom", ["accounts"]);
  root.loopPlusAcceptancePlan = { id: "fixed", name: "fixed", checks: ["security"], otherText: "", systemDefault: false };
  h.fixture.saveTask(root);
  const callerPlan = structuredClone(root.loopPlusAcceptancePlan);
  assert.equal(h.host.registerRoot(h.read("custom")!, root.department, callerPlan).ok, true);
  callerPlan.checks.push("performance");
  h.pause(); const started = await h.host.startLeader("custom", request("accounts")); assert.ok(started.ok); if (!started.ok) return;
  await started.done;
  assert.deepEqual(h.read(started.taskId)!.loopPlusAcceptancePlan!.checks, ["security"]);
  assert.deepEqual(h.read("custom")!.loopPlusAcceptancePlan!.checks, ["security"]);
  const saved = h.host.runtimeSnapshot("custom")!;
  h.update(started.taskId, { loopPlusAcceptancePlan: { ...root.loopPlusAcceptancePlan, checks: ["performance"] } });
  const fresh = createDepartmentOrchestrationHost({ ...h.deps, capacity: new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 }) });
  assert.equal(fresh.recoverRoot(h.read("custom")!, root.department, root.loopPlusAcceptancePlan, saved, h.capacity.snapshot("custom")).ok, false);
});

test("expansion and ordinary completion keep an unreleased overflow owned by its original leader", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]);
  h.dispatch("balance", 2); const started = await h.host.startLeader("root", request("accounts")); assert.ok(started.ok); if (!started.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 2, "normal plus overflow started");
  const initial = h.capacity.snapshot("root")[0];
  const overflowIdentity = initial.employeeOverflow![0];
  const [leaderId, overflowAttempt] = JSON.parse(overflowIdentity);
  const task = h.read(leaderId)!;
  const running = (task.loopPlus as { running: Array<{ attemptId: string; subtaskId: string }> }).running;
  const overflowSubtask = running.find((a) => a.attemptId === overflowAttempt)!.subtaskId;
  const regularSubtask = h.fixture.parkedSubtaskIds().find((id) => id !== overflowSubtask)!;
  // Existing duplicate leader admission updates limits atomically without replacing its lease.
  await h.capacity.acquireLeader("root", "accounts", { maxLeaders: 4, maxEmployees: 4 });
  h.dispatch("expanded");
  assert.equal(h.fixture.adapter.host().submitUserMessage(started.taskId, "余额回正后开始新的常规员工"), true);
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().includes("expanded-0"), "fresh decision uses restored regular balance");
  assert.deepEqual(h.capacity.snapshot("root")[0].employeeOverflow, [overflowIdentity]);
  h.pause(); h.fixture.finishParked(regularSubtask, { status: "end", content: "regular employee completed" });
  await waitForLoopPlus(() => h.capacity.snapshot("root")[0].employees.length === 2, "regular cleanup released");
  assert.equal(h.capacity.getEmployeeCapacity("root", started.taskId)!.leaderOverflowActive, true);
  assert.deepEqual(h.capacity.snapshot("root")[0].employeeOverflow, [overflowIdentity]);
  await h.host.stopRoot("root");
});

test("recovery validation is atomic for foreign IDs, repeated members and failed execution observations", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); const root = h.register("root", ["accounts"]);
  h.dispatch("observe"); const leader = await h.host.startLeader("root", request("accounts")); assert.ok(leader.ok); if (!leader.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "live attempt");
  const task = h.read(leader.taskId)!;
  const attempt = (task.loopPlus as { running: Array<{ attemptId: string; subtaskId: string }> }).running[0];
  const saved = h.host.runtimeSnapshot("root")!, capacity = h.capacity.snapshot("root");
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const other = await pool.acquireEmployee("other", "foreign", "active");
  const fresh = createDepartmentOrchestrationHost({ ...h.deps, capacity: pool });
  const before = pool.snapshot();
  assert.equal(fresh.recoverRoot(root, root.department, root.loopPlusAcceptancePlan!, { ...saved, leaders: [...saved.leaders, saved.leaders[0]] }, capacity).ok, false);
  assert.deepEqual(pool.snapshot(), before);
  const coldLeader = fresh.recoverRoot(root, root.department, root.loopPlusAcceptancePlan!, saved, capacity);
  assert.deepEqual(coldLeader, { ok: false, reason: "live-leader-unverifiable" },
    "a new host without the original leader producer/Owner observation remains blocked");
  assert.deepEqual(pool.snapshot(), before);
  h.liveLeaders.set(leader.taskId, { done: leader.done });
  let rejectObservation!: (error: Error) => void;
  const failedObservation = new Promise<void>((_resolve, reject) => { rejectObservation = reject; });
  h.liveEmployees.set(JSON.stringify([leader.taskId, attempt.attemptId]), { done: failedObservation });
  assert.equal(fresh.recoverRoot(root, root.department, root.loopPlusAcceptancePlan!, saved, capacity).ok, true);
  rejectObservation(new Error("execution identity lost"));
  await waitForLoopPlus(() => fresh.runtimeSnapshot("root")!.leaders[0].status === "blocked", "failed observation marked blocked");
  assert.equal(pool.snapshot("root")[0].employees.length, 1);
  assert.equal(await fresh.stopRoot("root"), false);
  assert.equal(pool.snapshot("root")[0].leaders.length, 1);
  assert.equal((await fresh.continueRoot("root")).ok, false);
  other!.release();
  // Only the old real controller owns the still-live CLI; end it for fixture cleanup.
  await h.host.stopRoot("root");
});

test("leader capacity spans actual Loop+ acceptance and root completion waits for the accepted report", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]);
  const reviewStarted = deferred(), releaseReview = deferred();
  h.dispatch("accepted");
  h.fixture.queueMain(async (input, tab) => {
    reviewStarted.resolve();
    await releaseReview.promise;
    const event = input.displayPrompt.match(/Current review eventId: (\S+)/)?.[1];
    h.fixture.publish(input, tab, { status: "end", content: JSON.stringify({ status: "completed", reviewEventId: event,
      answerConclusion: "module finished", finalSummary: "employee evidence accepted by existing Loop+",
      acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "module", passed: true }] }) });
  });
  const leader = await h.host.startLeader("root", request("accounts")); assert.ok(leader.ok); if (!leader.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().includes("accepted-0"), "employee running");
  h.fixture.finishParked("accepted-0", { status: "end", content: "implementation and tests passed" });
  await reviewStarted.promise;
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 0);
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 1, "review still owns the leader slot");
  assert.equal(h.host.canCompleteRoot("root"), false);
  releaseReview.resolve(); await leader.done;
  const task = h.read(leader.taskId)!;
  assert.equal(task.status, "completed");
  assert.equal(createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot().seenAttempts[0].acceptance, "passed");
  assert.equal(h.host.canCompleteRoot("root"), true);
  assert.equal(h.host.confirmRootComplete("root", "总监依据组长汇报确认完成").ok, true);
  assert.equal((await h.host.continueRoot("root")).ok, false, "completed organization is never implicitly reopened");
});

test("leader prompts are decision snapshots and the real host rechecks an outstanding overflow lease", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-admission-isolated-home-"));
  try {
    const fixturePath = path.resolve(__dirname, "fixtures", "departmentAdmissionRegressionFixture.js");
    const child = spawnSync(process.execPath, ["-e", 'const f = require(process.argv[1]); const deadline = setTimeout(() => { console.error("admission fixture did not settle completely"); process.exitCode = 1; }, 20000); f.runDepartmentAdmissionRegression().then(() => { clearTimeout(deadline); console.log("DEPARTMENT_ADMISSION_REGRESSION_COMPLETE"); }, (error) => { clearTimeout(deadline); console.error(error); process.exitCode = 1; });', fixturePath], {
      cwd: path.resolve(__dirname, "../../.."),
      timeout: 25000,
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex") },
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, `isolated real-host admission failed\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
    assert.equal(child.stdout.trim(), "DEPARTMENT_ADMISSION_REGRESSION_COMPLETE", "exit 0 alone does not prove asynchronous fixture completion");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("failed real stop observation blocks continue without releasing live occupancy", async (t) => {
  const h = harness(); t.after(() => h.fixture.dispose()); h.register("root", ["accounts"]);
  h.dispatch("stop-failure");
  const leader = await h.host.startLeader("root", request("accounts")); assert.ok(leader.ok); if (!leader.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "employee live");
  h.fixture.setHoldAbort(true);
  h.deps.stopLeader = () => { throw new Error("external execution cleanup unverified"); };
  assert.equal(await h.host.stopRoot("root"), false);
  const held = h.capacity.snapshot("root")[0];
  assert.equal(held.employees.length, 1); assert.equal(held.leaders.length, 1);
  assert.equal((await h.host.continueRoot("root")).ok, false);
  assert.equal(h.read("root")!.status, "stopped");
  h.deps.stopLeader = () => undefined;
  h.fixture.finishParked("stop-failure-0", { status: "stopped" });
  await leader.done;
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 0);
});

for (const failure of ["employee", "leader"] as const) test(`lost ${failure} observation fences new and delayed employee admission without releasing live occupancy`, async (t) => {
  const h = harness();
  const releaseLateGrant = deferred();
  t.after(async () => { releaseLateGrant.resolve(); h.fixture.releaseHeldMain(); await h.host.stopRoot("root"); h.fixture.dispose(); });
  const root = h.register();
  h.dispatch("unverified"); const source = await h.host.startLeader("root", request("accounts")); assert.ok(source.ok); if (!source.ok) return;
  h.dispatch("healthy"); const healthy = await h.host.startLeader("root", request("reports")); assert.ok(healthy.ok); if (!healthy.ok) return;
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 2, "both real leaders executing");
  let rejectObservation!: (error: Error) => void;
  const failedObservation = new Promise<void>((_resolve, reject) => { rejectObservation = reject; });
  for (const leader of [source, healthy]) {
    h.liveLeaders.set(leader.taskId, { done: failure === "leader" && leader === source ? failedObservation : leader.done });
    const snapshot = createLoopPlusScheduler({ snapshot: h.read(leader.taskId)!.loopPlus }).snapshot();
    for (const attempt of snapshot.running) h.liveEmployees.set(JSON.stringify([leader.taskId, attempt.attemptId]), {
      done: failure === "employee" && leader === source ? failedObservation : h.fixture.adapter.waitForTaskIdle(leader.taskId),
    });
  }
  // Instrument the actual adapter ports without replacing host, adapter, scheduler or pool behavior.
  type Admission = Parameters<NonNullable<LoopPlusRuntimeAdapter["setDepartmentExecutionAdmission"]>>[0];
  type CapacityReader = Parameters<NonNullable<LoopPlusRuntimeAdapter["setDepartmentEmployeeCapacityReader"]>>[0];
  const admissions: Array<{ subtaskId: string; signal: AbortSignal; result: ReturnType<Admission> }> = [];
  const installAdmission = h.fixture.adapter.setDepartmentExecutionAdmission!;
  h.fixture.adapter.setDepartmentExecutionAdmission = (handler) => installAdmission((req, signal) => {
    const result = handler(req, signal); admissions.push({ subtaskId: req.subtaskId, signal, result }); return result;
  });
  let readCapacity!: CapacityReader;
  const installReader = h.fixture.adapter.setDepartmentEmployeeCapacityReader!;
  h.fixture.adapter.setDepartmentEmployeeCapacityReader = (reader) => { readCapacity = reader; installReader(reader); };
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const tryAcquire = pool.tryAcquireEmployeeWithOverflow.bind(pool);
  let delayedIdentity: string | undefined;
  pool.tryAcquireEmployeeWithOverflow = (...args) => {
    const result = tryAcquire(...args); // Real pool decides and grants before this test-only return gate.
    const running = createLoopPlusScheduler({ snapshot: h.read(args[1])?.loopPlus }).snapshot().running;
    if (running.some((item) => item.attemptId === args[2] && item.subtaskId === "queued-before-loss-1")) {
      delayedIdentity = JSON.stringify([args[1], args[2]]);
      return result.then(async (lease) => { await releaseLateGrant.promise; return lease; });
    }
    return result;
  };
  const host = createDepartmentOrchestrationHost({ ...h.deps, capacity: pool });
  assert.equal(host.recoverRoot(root, root.department, root.loopPlusAcceptancePlan!, h.host.runtimeSnapshot("root"), h.capacity.snapshot("root")).ok, true);
  assert.notEqual(readCapacity("root", source.taskId), null);
  // Permit two actual regular grants, then hold only the second return across the authority change.
  await pool.acquireLeader("root", "accounts", { maxLeaders: 4, maxEmployees: 4 });
  h.dispatch("queued-before-loss", 2);
  assert.equal(h.fixture.adapter.host().submitUserMessage(source.taskId, "继续派发两个真实员工"), true);
  await waitForLoopPlus(() => admissions.length === 2 && h.fixture.parkedSubtaskIds().length === 3, "one real grant executes and the next granted return is held");
  const waiting = admissions.find((item) => item.subtaskId === "queued-before-loss-1")!;
  assert.ok(waiting);
  assert.equal(pool.snapshot("root")[0].employees.length, 4);
  rejectObservation(new Error("authoritative execution observation lost"));
  await waitForLoopPlus(() => host.runtimeSnapshot("root")!.leaders.find((item) => item.taskId === source.taskId)!.status === "blocked", "member blocked after observation rejection");
  const held = pool.snapshot("root")[0];
  assert.equal(held.leaders.length, 2); assert.equal(held.employees.length, 4);
  assert.equal(readCapacity("root", source.taskId), null, "blocked occupancy must not advertise dispatch authority");
  assert.notEqual(readCapacity("root", healthy.taskId), null, "healthy sibling retains dispatch authority");
  assert.deepEqual(await host.continueRoot("root"), { ok: false, reason: "execution-cleanup-unverified" });
  assert.equal(h.read("root")!.status, "running", "blocked continue cannot mutate the root");

  const other = rootRecord("other-root", ["accounts"]); h.fixture.saveTask(other);
  assert.equal(host.registerRoot(other, other.department, other.loopPlusAcceptancePlan!).ok, true);
  h.dispatch("other-root-work"); const otherLeader = await host.startLeader(other.id, request("accounts")); assert.ok(otherLeader.ok);
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().includes("other-root-work-0"), "another root can still execute");
  assert.equal(await host.stopRoot(other.id), true);
  assert.equal(pool.snapshot("other-root")[0].employees.length, 0);
  assert.deepEqual(pool.snapshot("root")[0].employees, held.employees, "other root cleanup never releases blocked executions");

  const resources = h.fixture.rootsCreated.length, targets = h.fixture.createdSubtaskTargets.length, calls = h.fixture.attemptCalls.length;
  h.dispatch("new-after-loss");
  h.fixture.queueMain(() => h.fixture.holdMain()); // Hold the denial review so task/scheduler state remains genuinely running.
  assert.equal(h.fixture.adapter.host().submitUserMessage(source.taskId, "观察失败后尝试派发"), true);
  await waitForLoopPlus(() => admissions.some((item) => item.subtaskId === "new-after-loss-0"), "real Loop+ dispatch reaches blocked admission");
  assert.equal(await admissions.find((item) => item.subtaskId === "new-after-loss-0")!.result, null);
  assert.equal(h.read(source.taskId)!.status, "running");
  assert.equal(h.fixture.rootsCreated.length, resources); assert.equal(h.fixture.createdSubtaskTargets.length, targets);
  assert.equal(h.fixture.attemptCalls.length, calls, "new valid attempt never reaches CLI");

  // Restored balance cannot revive blocked authority; return only the delayed real grant.
  await pool.acquireLeader("root", "accounts", { maxLeaders: 4, maxEmployees: 5 });
  releaseLateGrant.resolve();
  assert.equal(await waiting.result, null);
  assert.equal(waiting.signal.aborted, false, "refused by current member authority, not cancellation");
  assert.equal(h.read(source.taskId)!.status, "running", "late grant is refused while the real task is still running");
  assert.ok(delayedIdentity);
  assert.deepEqual(pool.snapshot("root")[0].employees, held.employees.filter((identity) => identity !== delayedIdentity));
  assert.deepEqual(pool.snapshot("root")[0].employeeOverflow, held.employeeOverflow);
  assert.equal(pool.snapshot("root")[0].leaders.length, 2);
  assert.equal(h.fixture.rootsCreated.length, resources); assert.equal(h.fixture.createdSubtaskTargets.length, targets);

});

// Cleanup proof regressions: real host, adapter, scheduler, pool and persisted task fixture;
// only the bottom runner is deterministic. No task-end record is termination evidence.
for (const failure of ["unlink", "root-replaced", "unknown", "rmdir", "async-dispose", "tab", "termination", "unobservable"] as const) {
  test(`department cleanup proof quarantines ${failure} without releasing occupancy`, async (t) => {
    const fs = require("fs") as typeof import("fs");
    const os = require("os") as typeof import("os");
    const path = require("path") as typeof import("path");
    const { createLoopSubtaskExecutionRoot } = require("../../loopSubtaskExecutionRoot") as typeof import("../../loopSubtaskExecutionRoot");
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "department-cleanup-proof-"));
    fs.writeFileSync(path.join(workspace, "source.txt"), "source must survive");
    const roots: ReturnType<typeof createLoopSubtaskExecutionRoot>[] = [];
    let rejectTermination!: (error: unknown) => void;
    const termination = new Promise<void>((_yes, no) => { rejectTermination = no; });
    const h = harness({ maxEmployees: 1,
      executionRootFactory: () => {
        const root = createLoopSubtaskExecutionRoot(workspace); roots.push(root);
        return failure === "async-dispose" && roots.indexOf(root) === 1
          ? { cwd: root.cwd, dispose: async () => { throw new Error("async dispose rejected"); } } : root;
      },
      ...(failure === "unobservable" ? { observeAttemptTermination: false as const } : {}),
      ...(failure === "termination" ? { observeAttemptTermination: () => ({ done: termination }) } : {}),
    });
    t.after(() => { h.fixture.dispose(); for (const root of roots) fs.rmSync(root.cwd, { recursive: true, force: true }); fs.rmSync(workspace, { recursive: true, force: true }); });
    h.register("root", ["accounts"]); h.dispatch("cleanup", 2); h.pause();
    const starting = h.host.startLeader("root", request("accounts"));
    await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 2, "normal and overflow started");
    const started = await starting; assert.ok(started.ok); if (!started.ok) return;
    const parked = h.fixture.parkedAttempts()[1];
    const snapshot = createLoopPlusScheduler({ snapshot: h.read(started.taskId)!.loopPlus }).snapshot();
    const attemptId = snapshot.running.find((a) => a.subtaskId === parked.subtaskId)!.attemptId;
    const observation = h.fixture.adapter.observeAttempt!(started.taskId, parked.subtaskId, attemptId); assert.ok(observation);
    const rejection = assert.rejects(observation.done);
    if (failure === "unlink") {
      const unlink = fs.unlinkSync;
      t.mock.method(fs, "unlinkSync", (target: import("fs").PathLike) => {
        if (String(target) === path.join(roots[1].cwd, "source.txt")) throw new Error("unlink denied");
        unlink(target);
      });
    }
    if (failure === "root-replaced") {
      fs.renameSync(roots[1].cwd, path.join(workspace, "saved-root"));
      fs.mkdirSync(roots[1].cwd); fs.writeFileSync(path.join(roots[1].cwd, "keep"), "preserved replacement");
    }
    if (failure === "unknown") fs.writeFileSync(path.join(roots[1].cwd, "unknown"), "preserved unknown");
    if (failure === "rmdir") {
      const rmdir = fs.rmdirSync;
      t.mock.method(fs, "rmdirSync", (target: import("fs").PathLike) => {
        if (String(target) === roots[1].cwd) throw new Error("root busy");
        rmdir(target);
      });
    }
    if (failure === "tab") h.fixture.setCloseSubtaskTabError("tab close rejected");
    if (failure === "termination") rejectTermination(new Error("runner cleanup rejected"));
    h.fixture.finishParked(parked.subtaskId, { status: "end", content: "Business completed, cleanup is a separate fact" });
    await rejection;
    await waitForLoopPlus(() => h.host.runtimeSnapshot("root")!.leaders[0].status === "blocked", "cleanup failure blocks owner");
    assert.equal(h.capacity.snapshot("root")[0].employees.length, 2);
    assert.equal(h.capacity.snapshot("root")[0].employeeOverflow?.length, 1);
    assert.equal(h.capacity.getEmployeeCapacity("root", started.taskId)!.leaderOverflowActive, true);
    assert.equal(h.capacity.snapshot("root")[0].leaders.length, 1);
    assert.equal(h.capacity.getEmployeeCapacity("root", started.taskId)!.canAcquireOverflow, false);
    assert.equal(h.host.canCompleteRoot("root"), false);
    assert.equal((await h.host.continueRoot("root")).ok, false);
    assert.equal(await h.host.stopRoot("root"), false);
    assert.ok(h.fixture.adapter.observeAttempt!(started.taskId, parked.subtaskId, attemptId), "failed observation survives business settlement");
    assert.equal(fs.readFileSync(path.join(workspace, "source.txt"), "utf8"), "source must survive");
    if (failure === "unknown") assert.equal(fs.readFileSync(path.join(roots[1].cwd, "unknown"), "utf8"), "preserved unknown");
    if (failure === "root-replaced") assert.equal(fs.readFileSync(path.join(roots[1].cwd, "keep"), "utf8"), "preserved replacement");
    // A still-live sibling's eventual cleanup may return its own slot, never the quarantined overflow.
    h.fixture.setCloseSubtaskTabError(null);
    h.fixture.finishParked("cleanup-0", { status: "stopped" });
    await waitForLoopPlus(() => h.fixture.rootsDisposed.length >= (failure === "termination" || failure === "unobservable" ? 0 : 1), "remaining runner cleanup");
    await assert.rejects(h.fixture.adapter.waitForTaskIdle(started.taskId).then(() => { throw new Error("must reject cleanup fence"); }), /cleanup|清理|runner|unlink|busy|dispose|tab|身份|链接|目录|not empty|ENOTEMPTY/);
    assert.ok(h.fixture.adapter.hasTaskExecution(started.taskId), "retained cleanup is not idle");
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.ok(h.capacity.snapshot("root")[0].employees.length >= 1);
    assert.equal(h.capacity.getEmployeeCapacity("root", started.taskId)!.leaderOverflowActive, true);
    // Failure of this department cannot quarantine a different healthy root.
    h.register("healthy", ["reports"]); h.dispatch("healthy");
    const healthy = await h.host.startLeader("healthy", request("reports")); assert.ok(healthy.ok);
    await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().includes("healthy-0"), "other root remains executable");
    if (failure !== "termination" && failure !== "unobservable") assert.equal(await h.host.stopRoot("healthy"), true);
    else h.fixture.finishParked("healthy-0", { status: "stopped" });
  });
}

test("department cleanup proof waits for runner termination before directory/tab cleanup and release", async (t) => {
  const ended = deferred();
  const h = harness({ observeAttemptTermination: () => ({ done: ended.promise }) }); t.after(() => h.fixture.dispose());
  h.register("root", ["accounts"]); h.dispatch("proof"); h.pause();
  const starting = h.host.startLeader("root", request("accounts"));
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "employee live");
  const leader = await starting; assert.ok(leader.ok); if (!leader.ok) return;
  const attempt = createLoopPlusScheduler({ snapshot: h.read(leader.taskId)!.loopPlus }).snapshot().running[0];
  const observed = h.fixture.adapter.observeAttempt!(leader.taskId, attempt.subtaskId, attempt.attemptId)!;
  let cleaned = false; void observed.done.then(() => { cleaned = true; });
  h.fixture.finishParked(attempt.subtaskId, { status: "end", content: "business done" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleaned, false); assert.equal(h.fixture.rootsDisposed.length, 0); assert.equal(h.fixture.closedSubtaskTabs.length, 0);
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 1);
  const stopping = h.host.stopRoot("root");
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 1);
  ended.resolve(); await observed.done; await stopping;
  assert.equal(h.capacity.snapshot("root")[0].employees.length, 0);
  assert.equal(h.capacity.snapshot("root")[0].leaders.length, 0);
});

test("department cleanup proof returns unstarted and late admission leases without creating resources", async (t) => {
  let grant!: (value: { release(): void }) => void; let released = 0;
  const fixture = createLoopPlusRuntimeFixture(); t.after(() => fixture.dispose());
  fixture.adapter.setDepartmentExecutionAdmission!(async () => new Promise((resolve) => { grant = resolve; }));
  const handle = fixture.adapter.startAttempt({ taskId: "unstarted", subtaskId: "A", attemptId: "A1", title: "A", prompt: "A", modelPrompt: "A", writeFiles: [], round: 1, targetCli: "codex" });
  const observation = fixture.adapter.observeAttempt!("unstarted", "A", "A1")!;
  handle.abort({ closeTab: true }); assert.equal((await handle.promise).outcome, "stopped");
  await observation.done;
  grant({ release() { released++; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, 1); assert.equal(fixture.rootsCreated.length, 0); assert.equal(fixture.createdSubtaskTargets.length, 0);
});

for (const proof of ["confirmed", "failed", "missing"] as const) test(`Owner resource branch avoids duplicate EH root/tab and waits full receipt (${proof})`, async (t) => {
  let resolve!: () => void, reject!: (error: Error) => void;
  const cleanup = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  let observed = false, releases = 0, failures = 0;
  const fixture = createLoopPlusRuntimeFixture({ ownsDepartmentAttemptResources: () => true,
    observeAttemptTermination: proof === "missing" ? false : () => { observed = true; return { done: cleanup }; } });
  t.after(() => fixture.dispose());
  fixture.saveTask(rootRecord("owner-resource-task", []));
  fixture.adapter.setDepartmentExecutionAdmission!(async () => ({
    release: () => { releases++; }, cleanupFailed: () => { failures++; },
  }));
  fixture.setAttemptAction((input, tab) => fixture.publish(input, tab, { status: "end", content: "business completed" }));
  const handle = fixture.adapter.startAttempt({ taskId: "owner-resource-task", subtaskId: "A", attemptId: "A1", title: "A", prompt: "A", modelPrompt: "A", writeFiles: [], round: 1, targetCli: "codex" });
  await waitForLoopPlus(() => fixture.attemptCalls.length === 1, "business invocation");
  if (proof !== "missing") {
    assert.equal(observed, true); assert.equal(releases, 0);
    if (proof === "failed") reject(new Error("missing-native-cleanup"));
    else resolve();
  }
  const result = await handle.promise;
  assert.equal(result.outcome, proof === "confirmed" ? "completed" : "failed");
  assert.equal(fixture.rootsCreated.length, 0); assert.equal(fixture.rootsDisposed.length, 0); assert.equal(fixture.closedSubtaskTabs.length, 0);
  assert.equal(releases, proof === "confirmed" ? 1 : 0); assert.equal(failures, proof === "confirmed" ? 0 : 1);
});


test("department prelaunch adapter abort delivers its signal before runner onStarted without task mutation", async (t) => {
  const entered = deferred(), cancelled = deferred(); let lifetime: AbortSignal | undefined;
  const fixture = createLoopPlusRuntimeFixture({ ownsDepartmentAttemptResources: () => true,
    runPromptOverride: async (_input, options) => {
      lifetime = options?.signal; assert.ok(lifetime); assert.equal(lifetime.aborted, false);
      lifetime.addEventListener("abort", cancelled.resolve, { once: true }); entered.resolve(); await cancelled.promise;
      assert.equal(options?.isAborted?.(), true);
    },
  });
  t.after(() => fixture.dispose()); fixture.saveTask(rootRecord("pending-owner", []));
  const before = JSON.stringify(fixture.readTask("pending-owner"));
  const handle = fixture.adapter.startAttempt({ taskId: "pending-owner", subtaskId: "subtask", attemptId: "attempt", title: "subtask",
    prompt: "controlled", modelPrompt: "controlled", writeFiles: [], round: 1, targetCli: "opencode" });
  await entered.promise; handle.abort(); await cancelled.promise; await handle.promise;
  assert.equal(lifetime!.aborted, true); assert.equal(JSON.stringify(fixture.readTask("pending-owner")), before);
  assert.equal(fixture.cancelledTabs.length, 0, "abort signal works before onStarted without relying on the active runner port");
});

// Exercise the same durable store + transcript parser used by extension.ts;
// deliberately supply no tab, target, live observation or producer capability.
async function storedLeaderHarness(t: { after(fn: () => void): void }) {
  const h = harness(); t.after(() => h.fixture.dispose());
  const root = h.register("stored-root", ["accounts"]);
  h.pause(); const started = await h.host.startLeader(root.id, request("accounts"));
  if (!started.ok) throw new Error(started.reason);
  await started.done;
  const { DepartmentRuntimeStore } = require("../../extensionHost/departmentruntimestore") as typeof import("../../extensionHost/departmentruntimestore");
  const { fingerprintDepartmentExecutionSelection } = require("../../runtime/departmentexecutionidentity") as typeof import("../../runtime/departmentexecutionidentity");
  const { createDepartmentStoredLeaderIdentityReader } = require("../../extensionHost/departmentleaderstoredidentity") as typeof import("../../extensionHost/departmentleaderstoredidentity");
  const { resolveLoopConversationTabContextFromMessages } = require("../../panelStateBuilder") as typeof import("../../panelStateBuilder");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-stored-identity-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new DepartmentRuntimeStore(directory), saved = h.host.runtimeSnapshot(root.id)!;
  const generation = saved.leaders[0].generation!;
  const selection = { version: 1 as const, cli: "codex" as const, role: "leader" as const, configId: "profile", revision: "revision-1",
    model: "leader", thinkingMode: null, openCodeVariant: null };
  const binding = { identity: { version: 1 as const, workspace: root.workspaceKey, rootTaskId: root.id,
    moduleId: "accounts", leaderTaskId: started.taskId, generation, role: "leader" as const, cli: "codex" as const,
    ownerId: "original-owner", executionId: "original-execution", session: { state: "bound" as const, id: "native-leader-session" },
    ...fingerprintDepartmentExecutionSelection(selection) }, selection,
    requirements: { processTerminal: true, turnTerminal: true, streams: true, runner: true, executionRoot: true, links: true, temp: true, tab: true } };
  h.update(started.taskId, { status: "running", executionSession: { cli: "codex", configId: "profile", sessionId: "native-leader-session" } });
  const localSession = h.read(started.taskId)!.sessionId!;
  const messages: import("../../webview/types").ChatMessage[] = [{ id: "main", role: "system", content: "组长原会话", taskRole: "main", loopTaskId: started.taskId }];
  const stored = { version: 1 as const, rootTaskId: root.id, workspaceKey: root.workspaceKey, runtime: saved,
    capacity: { rootTaskId: root.id, ...root.department!.limits, leaders: ["accounts"], employees: [] }, executionBindings: [binding] };
  assert.deepEqual(store.write(stored), { ok: true });
  const reader = createDepartmentStoredLeaderIdentityReader({ store, workspaceKey: () => root.workspaceKey,
    readSessionContext: (cli, session) => resolveLoopConversationTabContextFromMessages(cli === "codex" && session === localSession ? messages : []) });
  const pool = new DepartmentCapacityPool(root.department!.limits);
  let targetInspections = 0;
  const cold = createDepartmentOrchestrationHost({ ...h.deps, capacity: pool, verifyStoredLeaderIdentity: reader,
    inspectLeaderSession: () => { targetInspections++; return null; },
    persistRuntime: () => { throw new Error("read-only recovery must not persist"); } });
  const recover = () => cold.recoverRoot(h.read(root.id)!, h.read(root.id)!.department, h.read(root.id)!.loopPlusAcceptancePlan!, saved, [stored.capacity]);
  return { ...h, root, leaderId: started.taskId, store, stored, reader, messages, cold, pool, recover, generation,
    targetInspections: () => targetInspections, directory };
}

test("stored leader identity: cold transcript and native binding remain distinct without granting a target", async t => {
  const h = await storedLeaderHarness(t), task = h.read(h.leaderId)!;
  assert.notEqual(task.sessionId, task.executionSession!.sessionId);
  assert.equal(h.reader(task, task.department!, h.generation), true);
  const before = h.store.read(h.root.id, h.root.workspaceKey);
  assert.deepEqual(h.recover(), { ok: false, reason: "live-leader-unverifiable" });
  assert.equal(h.targetInspections(), 1);
  assert.equal(h.cold.runtimeSnapshot(h.root.id), null);
  assert.deepEqual(h.pool.snapshot(), []);
  assert.deepEqual(h.store.read(h.root.id, h.root.workspaceKey), before);
  assert.equal((await h.cold.continueRoot(h.root.id)).ok, false);
});

for (const drift of ["root", "workspace", "config", "model", "plan", "local-session", "native-session", "transcript", "generation", "binding-fingerprint", "missing-binding"]) {
  test(`stored leader identity: refuses ${drift} before cold capability inspection`, async t => {
    const h = await storedLeaderHarness(t), task = h.read(h.leaderId)!;
    if (drift === "root") h.update(task.id, { department: { ...task.department!, rootTaskId: "foreign-root" } });
    if (drift === "workspace") h.update(task.id, { workspaceKey: "foreign-workspace" });
    if (drift === "config") h.update(task.id, { originProfile: { ...task.originProfile, configId: "foreign-profile" } });
    if (drift === "model") h.update(task.id, { modelRouting: { ...task.modelRouting!, main: { cli: "codex", configId: "profile", model: "foreign-model" } } });
    if (drift === "plan") h.update(task.id, { loopPlusAcceptancePlan: { ...task.loopPlusAcceptancePlan!, checks: ["security"], systemDefault: false } });
    if (drift === "local-session") h.update(task.id, { sessionId: "wrong-local-session" });
    if (drift === "native-session") h.update(task.id, { executionSession: { ...task.executionSession!, sessionId: "wrong-native-session" } });
    if (drift === "transcript") h.messages[0].loopTaskId = "foreign-leader";
    // Corrupt/missing durable facts must be rejected by the real store/reader.
    if (["generation", "binding-fingerprint", "missing-binding"].includes(drift)) {
      const raw = structuredClone(h.stored);
      if (drift === "generation") raw.runtime.leaders[0].generation!++;
      if (drift === "binding-fingerprint") raw.executionBindings[0].identity.configFingerprint = "0".repeat(64);
      if (drift === "missing-binding") raw.executionBindings = [];
      fs.writeFileSync(path.join(h.directory, `${Buffer.from(h.root.id).toString("hex")}.json`), JSON.stringify(raw));
    }
    assert.deepEqual(h.recover(), { ok: false, reason: "unverified-leader-session-or-plan" });
    assert.equal(h.targetInspections(), 0);
    assert.equal(h.cold.runtimeSnapshot(h.root.id), null); assert.deepEqual(h.pool.snapshot(), []);
  });
}

test("stored leader identity: paused recovery and warm continuation still require the actual tab", async t => {
  const h = await storedLeaderHarness(t);
  h.update(h.leaderId, { status: "stopped" });
  assert.deepEqual(h.recover(), { ok: false, reason: "unverified-leader-session-or-plan" });
  h.sessions.clear();
  const before = h.fixture.mainCalls.length;
  assert.equal((await h.host.continueRoot(h.root.id)).ok, false);
  assert.equal(h.fixture.mainCalls.length, before);
  assert.deepEqual(h.pool.snapshot(), []);
});
