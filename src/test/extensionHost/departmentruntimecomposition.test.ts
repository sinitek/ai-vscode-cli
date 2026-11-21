import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import { installVscodeMock } from "../vscodeMock";
installVscodeMock();
import type { LoopMainDecision, LoopTaskRecord } from "../../loopTaskStore";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";
import type { DepartmentConfigurationState } from "../../departmentConfiguration";
import type { DepartmentRuntimeCompositionDeps } from "../../extensionHost/departmentruntimecomposition";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import { LOOP_BLOCKER_EXAMPLE } from "../../loopBlocker";
import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
const { createDepartmentRuntimeComposition } = require("../../extensionHost/departmentruntimecomposition") as typeof import("../../extensionHost/departmentruntimecomposition");
const { freezeDepartmentThinkingDefaults } = require("../../extensionHost/departmentruntimecomposition") as typeof import("../../extensionHost/departmentruntimecomposition");
const { DepartmentRuntimeStore } = require("../../extensionHost/departmentruntimestore") as typeof import("../../extensionHost/departmentruntimestore");
const { createLoopOrchestrationHost } = require("../../extensionHost/loopOrchestration") as typeof import("../../extensionHost/loopOrchestration");
const { createPromptRunRuntimeHost } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
const { transitionLoopMainDecision } = require("../../extensionHost/loopTaskStateMachine") as typeof import("../../extensionHost/loopTaskStateMachine");
const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
import { createLoopOrchestrationOwnershipTracker } from "../../loopOrchestrationOwnership";
import { isLoopTaskRunOrphaned } from "../../loopGroupChat";
function harness(overrides: Partial<DepartmentRuntimeCompositionDeps> = {}, onLeaderOwnership?: (taskId: string) => void) {
  const tasks = new Map<string, LoopTaskRecord>();
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile", taskPersistence: {
    create: (task) => { tasks.set(task.id, structuredClone(task)); return structuredClone(task); },
    read: (id) => structuredClone(tasks.get(id) ?? null),
    save: (task) => { tasks.set(task.id, structuredClone(task)); },
    remove: (id) => { tasks.delete(id); },
  } });
  const runtime: DepartmentRuntimeCompositionDeps["runtime"] = {
    ...fixture.adapter,
    runEventDriven: (input, options, target, onOwned) => fixture.adapter.runEventDriven(input, options, target, (taskId, ownedTarget) => {
      onOwned?.(taskId, ownedTarget);
      if (options?.departmentMetadata) onLeaderOwnership?.(taskId);
    }),
  };
  const directory = path.join(fixture.rootDir, "department");
  const store = new DepartmentRuntimeStore(directory);
  const targets = new Map<string, PromptRunTarget>([["director", { tabId: "director", cli: "codex", sessionId: "director-session" }]]);
  const notices: string[] = [], directorPrompts: PromptRunInput[] = [];
  const configuration: DepartmentConfigurationState = { routes: { director: { cli: "codex", configId: "profile", model: "director" },
    leader: { cli: "codex", configId: "profile", model: "leader" }, employee: { cli: "codex", configId: "profile", model: "employee" } },
    limits: { maxLeaders: 4, maxEmployees: 1 }, loopPlusAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot() };
  const update = (id: string, patch: Partial<LoopTaskRecord>) => { const task = tasks.get(id); if (!task) return null; fixture.saveTask({ ...task, ...patch }); return fixture.readTask(id); };
  let sequence = 0, workspace = "workspace", prepares: (() => void) | null = null;
  let decision: LoopMainDecision & { directorCollaborations?: Array<{ id: string; action: string }> } = { status: "blocked", finalSummary: "等待汇报" };
  let composition: ReturnType<typeof createDepartmentRuntimeComposition>;
  const parser = createPromptRunRuntimeHost({ getActiveWorkspaceKey: () => workspace } as Parameters<typeof createPromptRunRuntimeHost>[0]);
  let lastDirectorOutput = "";
  const classic = createLoopOrchestrationHost({
    handleDepartmentDecision: (request) => composition.handleDirectorDecision(request),
    normalizeLoopContinuePromptForPrompt: () => null,
    buildLoopSupplementalRequirementsLines: (task) => task.supplementalRequirements ?? [],
    isLoopTaskExecutionInterrupted: (id) => fixture.readTask(id)?.status !== "running",
    readLoopTaskRecord: fixture.readTask, updateLoopTaskRecord: update,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolvePromptRunModelForRole: (input) => input.loopMainModel,
    resolvePromptRunThinkingModeForRole: () => undefined,
    runPrompt: async (input) => { directorPrompts.push(input); lastDirectorOutput = JSON.stringify(decision); decision = { status: "blocked", finalSummary: "等待汇报" }; },
    resolveLoopTaskSessionId: (target) => target.sessionId,
    bindLoopTaskToSession: (id, sessionId) => update(id, { sessionId }),
    getLoopRoundRunStatus: () => "end",
    appendLoopRound: (id, round) => { const task = fixture.readTask(id)!; update(id, { rounds: [...task.rounds, round] }); },
    buildLoopRoundSummary: () => "根据汇报协调",
    getLastLoopAssistantContent: () => lastDirectorOutput,
    parseLoopMainDecision: parser.parseLoopMainDecision,
    logError: () => undefined,
  });
  const deps: DepartmentRuntimeCompositionDeps = {
    runtime, store, workspaceKey: () => workspace, readTask: fixture.readTask, updateTask: update,
    prepareRoutes: async () => { prepares?.(); }, validateRoutes: () => true,
    resolveTarget: (id) => targets.get(id ?? "director") ?? null,
    taskForTarget: (id) => { const target = targets.get(id ?? "director"); return target ? [...tasks.values()].find((task) => task.sessionId === target.sessionId) ?? null : null; },
    resolveTargetForRoot: (root) => [...targets.values()].find((target) => target.sessionId === root.sessionId) ?? null,
    createRoot: (input, target, config) => {
      const id = `root-${++sequence}`;
      const task: LoopTaskRecord = { id, cli: target.cli, sessionId: target.sessionId, workspaceKey: workspace, taskStoreFile: fixture.storeFile,
        rootPrompt: input.displayPrompt, schedulingMode: "classic", status: "running", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20,
        currentRound: 0, communicationDir: fixture.rootDir, mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
        subTasks: [], rounds: [], supplementalRequirements: [], completionRoundSummaries: [], completionRequirementCoverage: [],
        department: { version: 1, rootTaskId: id, parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "部门", routes: config.routes, limits: config.limits },
        loopPlusAcceptancePlan: config.loopPlusAcceptancePlan, modelRouting: { main: config.routes.director, subtask: config.routes.employee } };
      fixture.saveTask(task); return fixture.readTask(id)!;
    },
    createLeaderTarget: () => { const id = `leader-${++sequence}`, target = { tabId: id, cli: "codex" as const, sessionId: `${id}-session` }; targets.set(id, target); return target; },
    inspectLeaderSession: (task, metadata) => {
      const target = [...targets.values()].find((t) => t.sessionId === task.sessionId && t.cli === metadata.routes.leader.cli);
      return target && task.originProfile?.configId === metadata.routes.leader.configId ? { target, live: fixture.adapter.observeTask?.(task.id) ?? null } : null;
    },
    observeRestoredExecution: (task, attempt) => fixture.adapter.observeAttempt?.(task.id, attempt.subtaskId, attempt.attemptId) ?? null,
    stopLeader: async (id) => { fixture.adapter.host().stopParent(id); await fixture.adapter.waitForTaskIdle(id); },
    stopDirector: () => undefined,
    runDirectorDecision: classic.runClassicLoopMainDecision,
    applyClassicDecision: (id, next) => {
      const result = transitionLoopMainDecision({ task: fixture.readTask(id)!, decision: next, now: Date.now() });
      const task = update(id, result.patch); if (!task) throw new Error("task write failed");
      return { status: result.status, task, subtasks: result.subtasks };
    },
    report: (_root, message) => { notices.push(message); },
    createMessageId: () => `message-${++sequence}`,
    ...overrides,
  };
  composition = createDepartmentRuntimeComposition(deps);
  const start = () => composition.startDepartmentPrompt({ targetTabId: "director", cli: "codex", displayPrompt: "实现账号和报表模块", modelPrompt: "实现目标", contextTags: [], departmentConfiguration: configuration });
  const dispatch = (prefix: string, count = 1) => fixture.queueMain((input, tab) => fixture.publish(input, tab, { status: "end", content: JSON.stringify({ status: "dispatch",
    subtasks: Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, title: `${prefix}-${i}`, prompt: `Implement ${prefix}-${i}, report all changes and relevant verification evidence to the real department leader.`, taskType: "general", writeFiles: [] })) }) }));
  const finish = () => fixture.queueMain((input, tab) => {
    const event = input.displayPrompt.match(/Current review eventId: (\S+)/)?.[1];
    fixture.publish(input, tab, { status: "end", content: JSON.stringify(withLoopPlusAcceptReviews({ status: "completed", progressPercent: 100,
      ...(event && event !== "(none)" ? { reviewEventId: event } : {}), finalSummary: "模块已完成", answerConclusion: "完成",
      acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "module", passed: true }] })) });
  });
  return { fixture, composition, deps, store, directory, targets, notices, directorPrompts, configuration, start, dispatch, finish, update,
    decide: (next: typeof decision) => { decision = next; }, prepare: (next: () => void) => { prepares = next; }, workspace: (value: string) => { workspace = value; },
    dispose: () => { composition.dispose(); fixture.dispose(); } };
}

// This fixture exercises the real composition/classic parser with in-memory task
// persistence. It does not claim production owned-storage or native CLI evidence.
function latch() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }

async function startHeldLeader(h: ReturnType<typeof harness>, moduleId: string) {
  const leaderStarted = latch(), releaseLeader = latch();
  await h.start();
  const root = h.fixture.readTask("root-1")!;
  h.fixture.queueMain(async (input, tabId) => {
    leaderStarted.resolve();
    await releaseLeader.promise;
    h.fixture.publish(input, tabId, { status: "stopped", content: "stopped by deterministic test" });
  });
  await h.composition.handleDirectorDecision({ task: root, decision: { status: "continue", estimatedRemainingRounds: 1,
    subtasks: [{ id: moduleId, title: "模块", prompt: "Implement the module and report its result.", taskType: "general", writeFiles: [] }] },
  requirements: [] });
  await leaderStarted.promise;
  const leaderId = [...h.fixture.createdTaskIds].find((id) => h.fixture.readTask(id)?.department?.leaderSubtaskId === moduleId);
  assert.ok(leaderId);
  return { root, leaderId, releaseLeader };
}

test("director waiting does not block or redispatch while a leader is running", async (t) => {
  const h = harness();
  let held: Awaited<ReturnType<typeof startHeldLeader>> | undefined;
  t.after(() => { held?.releaseLeader.resolve(); h.dispose(); });
  held = await startHeldLeader(h, "module-wait");
  const leaderIds = [...h.fixture.createdTaskIds].filter((id) => h.fixture.readTask(id)?.department?.role === "leader");
  const result = await h.composition.handleDirectorDecision({ task: h.fixture.readTask(held.root.id)!,
    decision: { status: "waiting", finalSummary: "等待组长汇报" }, requirements: [] });
  assert.equal(result.status, "pending-requirements");
  assert.equal(h.fixture.readTask(held.root.id)?.status, "running");
  assert.deepEqual([...h.fixture.createdTaskIds].filter((id) => h.fixture.readTask(id)?.department?.role === "leader"), leaderIds);
  assert.ok(h.directorPrompts.some((input) => input.modelPrompt.includes('"status":"waiting"')));
  held.releaseLeader.resolve();
  await h.fixture.adapter.waitForTaskIdle(held.leaderId);
});

test("cancels one confirmed leader cleanup and preserves the root for a new module", async (t) => {
  let held: Awaited<ReturnType<typeof startHeldLeader>> | undefined;
  const h = harness({ stopLeader: async () => { held?.releaseLeader.resolve(); } });
  t.after(() => { held?.releaseLeader.resolve(); h.dispose(); });
  held = await startHeldLeader(h, "module-cancel");
  assert.equal(h.composition.readCapacity(held.root.id)?.leaders.length, 1);
  assert.equal(await h.composition.host.cancelLeader(held.root.id, held.leaderId), true);
  assert.equal(h.fixture.readTask(held.root.id)?.subTasks.find((module) => module.id === "module-cancel")?.status, "skipped");
  assert.deepEqual(h.composition.readCapacity(held.root.id)?.leaders, []);
  assert.equal(h.composition.host.runtimeSnapshot(held.root.id)?.leaders.some((member) => member.taskId === held!.leaderId), false);
  assert.equal(h.fixture.readTask(held.root.id)?.status, "running");
});

test("director blocked with a valid diagnosis pauses review without releasing live ownership", async (t) => {
  const h = harness();
  let held: Awaited<ReturnType<typeof startHeldLeader>> | undefined;
  t.after(() => { held?.releaseLeader.resolve(); h.dispose(); });
  held = await startHeldLeader(h, "module-blocked");
  const decision: LoopMainDecision = { status: "blocked", blocker: LOOP_BLOCKER_EXAMPLE,
    finalSummary: "已核实的执行阻塞" };
  const result = await h.composition.handleDirectorDecision({ task: held.root, decision,
    requirements: [] });
  assert.equal(result.status, "needs-review");
  assert.equal(h.fixture.readTask(held.root.id)?.status, "needs-review");
  assert.equal(h.composition.host.runtimeSnapshot(held.root.id)?.leaders[0]?.status, "running");
  assert.ok(h.composition.readCapacity(held.root.id)?.leaders.includes("module-blocked"));
  assert.equal(h.fixture.readTask(held.root.id)?.finalSummary, decision.finalSummary);
});

test("director waiting without a live leader pauses review instead of sleeping indefinitely", async (t) => {
  const h = harness(); t.after(h.dispose);
  await h.start();
  const root = h.fixture.readTask("root-1")!;
  const decision: LoopMainDecision = { status: "waiting", finalSummary: "等待组长汇报" };
  const result = await h.composition.handleDirectorDecision({ task: root, decision,
    requirements: [] });
  assert.equal(result.status, "needs-review");
  assert.equal(h.fixture.readTask(root.id)?.status, "needs-review");
  assert.match(h.fixture.readTask(root.id)?.finalSummary ?? "", /没有正在运行的组长/);
});

test("runtime capacity uses current defaults without rewriting a frozen employee limit", async (t) => {
  const h = harness(); t.after(h.dispose);
  const capacity = h.composition.capacity;
  const lease = await capacity.acquireLeader("default-root", "leader");
  assert.ok(lease);
  assert.deepEqual(h.composition.readCapacity("default-root"), {
    rootTaskId: "default-root", maxLeaders: 4, maxEmployees: 16, leaders: ["leader"], employees: [],
  });
  lease.release();
  const frozen = { rootTaskId: "frozen-root", maxLeaders: 4, maxEmployees: 20, leaders: [], employees: [] };
  capacity.restoreRoot(frozen);
  assert.deepEqual(h.composition.readCapacity("frozen-root"), frozen);
});

test("new department accepts a Grok employee route and prepares it before startup", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.configuration.routes.employee.cli = "grok";
  let prepared = 0; h.prepare(() => { prepared++; });
  await h.start();
  assert.equal(prepared, 1);
  assert.equal(h.fixture.readTask("root-1")?.department?.routes.employee.cli, "grok");
});

test("new department opens its registered director group chat without waiting for the panel", async (t) => {
  const ownership = createLoopOrchestrationOwnershipTracker(), panel = latch(), entered = latch();
  const opened: string[] = []; let calls = 0;
  const captured: string[] = [];
  const h = harness({ acquireDirectorOwnership: ownership.acquire,
    captureDirectorTaskSummary: (input, target) => {
      assert.equal(h.composition.host.runtimeSnapshot("root-1")?.rootTaskId, "root-1");
      assert.deepEqual(target, h.targets.get("director"));
      captured.push(input.displayPrompt);
    },
    openGroupChat: async (taskId) => {
      const task = h.fixture.readTask(taskId)!;
      assert.equal(task.department?.role, "director");
      assert.equal(h.composition.host.runtimeSnapshot(taskId)?.rootTaskId, taskId);
      assert.equal(h.targets.get("director")?.sessionId, task.sessionId);
      assert.equal(ownership.getCount(taskId), 1);
      opened.push(taskId);
      await panel.promise;
    },
    runDirectorDecision: async ({ task }) => {
      assert.deepEqual(captured, ["实现账号和报表模块"]);
      calls++;
      entered.resolve();
      return { status: "pending-requirements", task };
    },
  });
  t.after(() => { panel.resolve(); h.dispose(); });
  await h.start();
  await entered.promise;
  assert.deepEqual(opened, ["root-1"]);
  h.composition.wakeDirector("root-1");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.deepEqual(opened, ["root-1"], "director wakes do not reopen the group chat");
  assert.deepEqual(captured, ["实现账号和报表模块"], "director wakes do not capture another submission");
  await h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
});

test("group chat opening failure is logged without stopping the new director", async (t) => {
  const failure = new Error("panel-unavailable"), events: Array<[string, unknown]> = [], entered = latch(); let decisions = 0;
  const h = harness({ openGroupChat: async () => { throw failure; }, runDirectorDecision: async ({ task }) => {
    decisions++; entered.resolve(); return { status: "pending-requirements", task };
  },
    log: (event, error) => { events.push([event, error]); } });
  t.after(h.dispose);
  await h.start();
  await entered.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.fixture.readTask("root-1")?.status, "running");
  assert.equal(decisions, 1);
  assert.deepEqual(events, [["department-group-chat-open-failed", failure]]);
  await h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
});

for (const failure of ["preparation", "registration", "binding"] as const) {
  test(`department ${failure} failure does not open a group chat`, async (t) => {
    const opened: string[] = [];
    const captured: string[] = [];
    const h = harness({ openGroupChat: async (taskId) => { opened.push(taskId); },
      captureDirectorTaskSummary: (input) => { captured.push(input.displayPrompt); } });
    t.after(h.dispose);
    if (failure === "preparation") h.prepare(() => { throw new Error("preparation-failed"); });
    if (failure === "registration") t.mock.method(h.store, "write", () => ({ ok: false as const, error: "registration-failed" }));
    if (failure === "binding") {
      const createRoot = h.deps.createRoot;
      t.mock.method(h.deps, "createRoot", (...args: Parameters<typeof createRoot>) => {
        const task = createRoot(...args);
        h.targets.set("director", { ...h.targets.get("director")!, sessionId: "changed-session" });
        return task;
      });
    }
    await assert.rejects(h.start());
    assert.deepEqual(opened, []);
    assert.deepEqual(captured, []);
    assert.equal(h.directorPrompts.length, 0);
  });
}

for (const { label, maxRounds, limit } of [
  { label: "valid", maxRounds: 3, limit: 3 },
  { label: "missing", maxRounds: undefined, limit: 20 },
  { label: "corrupt", maxRounds: Number.POSITIVE_INFINITY, limit: 20 },
]) {
  test(`director pauses at the classic round limit with a ${label} legacy maxRounds`, async (t) => {
    const ownership = createLoopOrchestrationOwnershipTracker();
    const rounds: number[] = [];
    const h = harness({ acquireDirectorOwnership: ownership.acquire, runDirectorDecision: async ({ task, round }) => {
      rounds.push(round);
      const updated = h.deps.updateTask(task.id, { currentRound: round })!;
      if (round === limit) h.composition.wakeDirector(task.id);
      return { status: "pending-requirements", task: updated };
    } });
    t.after(h.dispose);
    const createRoot = h.deps.createRoot;
    t.mock.method(h.deps, "createRoot", (...args: Parameters<typeof createRoot>) => {
      const task = createRoot(...args);
      task.currentRound = limit - 1;
      if (maxRounds === undefined) delete task.maxRounds;
      else task.maxRounds = maxRounds;
      h.fixture.saveTask(task);
      return task;
    });

    await h.start();
    await waitForLoopPlus(() => h.fixture.readTask("root-1")?.status === "needs-review"
      && ownership.getCount("root-1") === 0, "director round limit and ownership release");
    const paused = h.fixture.readTask("root-1")!;
    assert.deepEqual(rounds, [limit]);
    assert.equal(paused.currentRound, limit);
    assert.match(paused.finalSummary ?? "", /经典 Loop 轮次上限/);
    assert.equal(ownership.getCount(paused.id), 0);
  });
}

test("director ownership covers asynchronous preparation and coordination wait, then releases on stop", async (t) => {
  const ownership = createLoopOrchestrationOwnershipTracker(), entered = latch(), finish = latch();
  const h = harness({ acquireDirectorOwnership: ownership.acquire, runDirectorDecision: async ({ task }) => {
    entered.resolve(); await finish.promise; return { status: "pending-requirements", task };
  } });
  t.after(() => { finish.resolve(); h.dispose(); });
  await h.start(); await entered.promise;
  const task = h.fixture.readTask("root-1")!;
  assert.equal(task.status, "running");
  assert.equal(ownership.getCount(task.id), 1);
  assert.equal(isLoopTaskRunOrphaned(task, ownership.collectTaskIds()), false);
  finish.resolve(); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ownership.getCount(task.id), 1, "coordination wait still owns the director");
  await h.composition.organizationControl.stop(task); await ownership.waitForIdle(task.id);
  assert.equal(ownership.getCount(task.id), 0);
  assert.equal(h.fixture.readTask(task.id)?.status, "stopped");
  h.composition.wakeDirector(task.id); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ownership.getCount(task.id), 0, "a wake cannot restart a stopped director");
});

test("leader ownership is acquired before its first orphan projection and released after stopped execution settles", async (t) => {
  const ownership = createLoopOrchestrationOwnershipTracker(), leaderStarted = latch(), releaseLeader = latch();
  const firstProjection: Array<{ taskId: string; orphaned: boolean }> = [];
  const h = harness({ acquireLeaderOwnership: ownership.acquire }, (taskId) => {
    const task = h.fixture.readTask(taskId)!;
    firstProjection.push({ taskId, orphaned: isLoopTaskRunOrphaned(task, ownership.collectTaskIds()) });
  });
  t.after(() => { releaseLeader.resolve(); h.dispose(); });
  await h.start();
  const root = h.fixture.readTask("root-1")!;
  h.fixture.queueMain(async (input, tabId) => {
    leaderStarted.resolve();
    await releaseLeader.promise;
    h.fixture.publish(input, tabId, { status: "stopped", content: "stopped by deterministic test" });
  });
  await h.composition.handleDirectorDecision({ task: root, decision: { status: "continue", estimatedRemainingRounds: 1,
    subtasks: [{ id: "module-1", title: "模块", prompt: "Implement the isolated module and report its result.", taskType: "general", writeFiles: [] }] },
    requirements: [] });
  await leaderStarted.promise;
  const leader = [...h.fixture.createdTaskIds].map((id) => h.fixture.readTask(id)).find((task) => task?.department?.role === "leader");
  assert.ok(leader);
  assert.ok(firstProjection.length >= 1);
  assert.ok(firstProjection.every((projection) => projection.taskId === leader.id && !projection.orphaned));
  assert.equal(ownership.getCount(leader.id), 1);
  h.fixture.adapter.host().stopParent(leader.id);
  releaseLeader.resolve();
  await h.fixture.adapter.waitForTaskIdle(leader.id);
  await waitForLoopPlus(() => ownership.getCount(leader.id) === 0, "leader ownership release");
  assert.equal(h.fixture.readTask(leader.id)?.status, "stopped");
});

for (const outcome of ["resume", "stop", "revoke", "reject", "throw"] as const) {
  test(`director continuation owns the running projection before continueRoot settles: ${outcome}`, async (t) => {
    const ownership = createLoopOrchestrationOwnershipTracker(), entered = latch(), release = latch();
    const summarySubmissions: string[] = [];
    let decisions = 0;
    const h = harness({ acquireDirectorOwnership: ownership.acquire,
      captureDirectorTaskSummary: (input) => { summarySubmissions.push(input.displayPrompt); }, runDirectorDecision: async ({ task }) => {
      decisions++; return { status: "pending-requirements", task };
    } });
    t.after(() => { release.resolve(); h.dispose(); });
    await h.start();
    const root = h.fixture.readTask("root-1")!;
    await h.composition.organizationControl.stop(root);
    await ownership.waitForIdle(root.id);
    const original = h.composition.host.continueRoot;
    h.composition.host.continueRoot = async (id, continuation) => {
      if (outcome === "reject") return { ok: false, reason: "deterministic-refusal" };
      if (outcome === "throw") throw new Error("deterministic-startup-error");
      const result = await original(id, continuation);
      assert.ok(result.ok);
      assert.equal(ownership.getCount(id), 1);
      assert.equal(isLoopTaskRunOrphaned(h.fixture.readTask(id)!, ownership.collectTaskIds()), false);
      entered.resolve(); await release.promise; return result;
    };
    let revoked = false;
    const continuation = h.composition.continueDepartmentPrompt({ targetTabId: "director", cli: "codex", displayPrompt: "继续", modelPrompt: "继续", contextTags: [],
      assertCurrent: () => { if (revoked) throw new Error("continuation-revoked"); } });
    if (outcome === "reject" || outcome === "throw") {
      await assert.rejects(continuation, /deterministic/);
      assert.equal(ownership.getCount(root.id), 0);
      assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
      assert.deepEqual(summarySubmissions, ["实现账号和报表模块"]);
      return;
    }
    await entered.promise;
    assert.equal(ownership.getCount(root.id), 1, "awaiting continuation owns exactly one responsibility");
    await assert.rejects(h.composition.continueDepartmentPrompt({ targetTabId: "director", cli: "codex", displayPrompt: "重复", modelPrompt: "重复", contextTags: [] }), /正在继续/);
    const before = decisions;
    if (outcome === "stop") await h.composition.organizationControl.stop(h.fixture.readTask(root.id)!);
    if (outcome === "revoke") revoked = true;
    release.resolve();
    if (outcome === "stop" || outcome === "revoke") {
      await assert.rejects(continuation, /已停止|continuation-revoked/);
      assert.equal(decisions, before, "late continuation cannot resurrect a stopped director");
      assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
      assert.deepEqual(summarySubmissions, ["实现账号和报表模块"]);
    } else {
      await continuation;
      assert.deepEqual(summarySubmissions, ["实现账号和报表模块", "继续"]);
      await waitForLoopPlus(() => decisions === before + 1, "resumed director decision");
      assert.equal(ownership.getCount(root.id), 1, "the same ownership transfers to coordination wait");
      assert.equal(isLoopTaskRunOrphaned(h.fixture.readTask(root.id)!, ownership.collectTaskIds()), false);
      await h.composition.organizationControl.stop(h.fixture.readTask(root.id)!);
    }
    await ownership.waitForIdle(root.id);
    assert.equal(ownership.getCount(root.id), 0);
  });
}

test("synchronous resumed leader rejection keeps ownership through cleanup and then releases once", async (t) => {
  const ownership = createLoopOrchestrationOwnershipTracker(), cleanupEntered = latch(), cleanup = latch(), firstTurn = latch();
  let holdCleanup = false;
  const h = harness({ acquireLeaderOwnership: ownership.acquire, resumeLeaderExecution: async () => undefined,
    observeLeaderCleanup: () => {
      if (!holdCleanup) return { done: Promise.resolve() };
      cleanupEntered.resolve(); return { done: cleanup.promise };
    } });
  t.after(() => { cleanup.resolve(); h.dispose(); });
  await h.start();
  h.deps.updateTask("root-1", { subTasks: [{ id: "module", title: "module", status: "running", prompt: "Implement this isolated module and report the verification result." }] });
  h.fixture.queueMain((input, tab) => {
    h.fixture.publish(input, tab, { status: "end", content: '{"status":"wait","finalSummary":"等待停止"}' }); firstTurn.resolve();
  });
  const first = await h.composition.host.startLeader("root-1", { leaderSubtaskId: "module", moduleTitle: "module", prompt: "Implement the isolated module." });
  assert.ok(first.ok); await firstTurn.promise;
  await h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
  assert.equal(ownership.getCount(first.taskId), 0);
  holdCleanup = true;
  h.deps.runtime.runEventDriven = () => { throw new Error("synchronous-resume-rejection"); };
  const continuing = h.composition.host.continueRoot("root-1");
  await cleanupEntered.promise;
  assert.equal(ownership.getCount(first.taskId), 1, "startup rejection still owns its pending cleanup");
  cleanup.resolve();
  const result = await continuing;
  assert.deepEqual(result, { ok: false, reason: "synchronous-resume-rejection" });
  assert.equal(ownership.getCount(first.taskId), 0);
  assert.deepEqual(h.composition.readCapacity("root-1")?.leaders, []);
});

test("workspace revocation during route preparation creates no root and acquires no ownership", async (t) => {
  let acquired = 0;
  const h = harness({ acquireDirectorOwnership: () => { acquired++; return () => undefined; } }); t.after(h.dispose);
  h.prepare(() => h.workspace("foreign"));
  await assert.rejects(h.start(), /工作区、目标会话或角色配置已变化/);
  assert.equal(h.fixture.readTask("root-1"), null); assert.equal(acquired, 0);
});

for (const invalid of ["stopped", "foreign-workspace", "invalid-metadata"] as const) {
  test(`director decision still rejects ${invalid}`, async (t) => {
    const h = harness(); t.after(h.dispose); await h.start();
    const task = h.fixture.readTask("root-1")!;
    h.deps.updateTask(task.id, invalid === "stopped" ? { status: "stopped" } : invalid === "foreign-workspace" ? { workspaceKey: "foreign" } : { departmentInvalid: true });
    await assert.rejects(h.composition.handleDirectorDecision({ task, decision: { status: "blocked" }, requirements: [] }), /部门/);
  });
}

// These latches precede ensure/recovery and continueRoot, unlike the original
// director tests whose latch lives inside continueRoot after running is written.
test("route preparation stop revokes the old request without clearing its legal successor", async (t) => {
  const firstEntered = latch(), firstRelease = latch(), nextEntered = latch(), nextRelease = latch();
  const ownership = createLoopOrchestrationOwnershipTracker();
  let prepares = 0, decisions = 0, resumes = 0;
  const h = harness({ acquireDirectorOwnership: ownership.acquire, runDirectorDecision: async ({ task }) => {
    decisions++; return { status: "pending-requirements", task };
  } });
  t.after(() => { firstRelease.resolve(); nextRelease.resolve(); h.dispose(); });
  await h.start();
  const root = h.fixture.readTask("root-1")!;
  await h.composition.organizationControl.stop(root);
  await ownership.waitForIdle(root.id);
  const snapshot = h.composition.host.runtimeSnapshot(root.id), capacity = h.composition.readCapacity(root.id);
  const resume = h.composition.host.continueRoot;
  h.composition.host.continueRoot = (...args) => { resumes++; return resume(...args); };
  h.deps.prepareRoutes = async () => {
    const ordinal = ++prepares;
    if (ordinal === 1) { firstEntered.resolve(); await firstRelease.promise; }
    if (ordinal === 2) { nextEntered.resolve(); await nextRelease.promise; }
  };
  // Exercise organizationControl's real request, which has no assertCurrent.
  const old = h.composition.organizationControl.continue(root, "旧请求");
  const oldRejected = assert.rejects(old, /已停止|已失效/);
  await firstEntered.promise;
  await assert.rejects(h.composition.organizationControl.continue(root), /正在继续/);
  assert.equal(prepares, 1, "duplicates are refused before route preparation");
  await h.composition.organizationControl.stop(h.fixture.readTask(root.id)!);
  const next = h.composition.organizationControl.continue(h.fixture.readTask(root.id)!, "合法继续");
  await nextEntered.promise;
  firstRelease.resolve(); await oldRejected;
  await assert.rejects(h.composition.organizationControl.continue(root), /正在继续/);
  assert.equal(prepares, 2, "old finally cannot clear the successor request");
  assert.equal(resumes, 0);
  assert.equal(decisions, 1, "no new director model invocation before authorization");
  assert.equal(ownership.getCount(root.id), 0, "preflight request is not execution ownership");
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  assert.deepEqual(h.fixture.readTask(root.id)?.supplementalRequirements, []);
  assert.deepEqual(h.composition.host.runtimeSnapshot(root.id), snapshot, "no producer generation or runtime reopened");
  assert.deepEqual(h.composition.readCapacity(root.id), capacity);
  nextRelease.resolve(); await next;
  assert.equal(resumes, 1); assert.equal(decisions, 2);
  assert.deepEqual(h.fixture.readTask(root.id)?.supplementalRequirements, ["合法继续"]);
  assert.equal(ownership.getCount(root.id), 1, "same ownership transfers through actual coordination wait");
  await h.composition.organizationControl.stop(h.fixture.readTask(root.id)!);
  await ownership.waitForIdle(root.id);
  assert.equal(ownership.getCount(root.id), 0);
});

test("route preparation rejection releases only its request and allows explicit retry", async (t) => {
  const entered = latch(), release = latch();
  let prepares = 0, resumes = 0;
  const h = harness({ runDirectorDecision: async ({ task }) => ({ status: "pending-requirements", task }) }); t.after(() => { release.resolve(); h.dispose(); });
  await h.start(); const root = h.fixture.readTask("root-1")!;
  await h.composition.organizationControl.stop(root);
  const resume = h.composition.host.continueRoot;
  h.composition.host.continueRoot = (...args) => { resumes++; return resume(...args); };
  h.deps.prepareRoutes = async () => { if (++prepares === 1) { entered.resolve(); await release.promise; throw new Error("route-preparation-rejected"); } };
  const failed = h.composition.organizationControl.continue(root);
  const rejected = assert.rejects(failed, /route-preparation-rejected/);
  await entered.promise;
  await assert.rejects(h.composition.organizationControl.continue(root), /正在继续/);
  release.resolve(); await rejected;
  assert.equal(resumes, 0); assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  await h.composition.organizationControl.continue(h.fixture.readTask(root.id)!);
  assert.equal(prepares, 2); assert.equal(resumes, 1);
  assert.equal(h.fixture.readTask(root.id)?.status, "running");
  await h.composition.organizationControl.stop(h.fixture.readTask(root.id)!);
});

test("route preparation stop stays revoked when controller-free recovery fails", async (t) => {
  const entered = latch(), release = latch();
  const h = harness({ runDirectorDecision: async ({ task }) => ({ status: "pending-requirements", task }) }); t.after(() => { release.resolve(); h.dispose(); });
  await h.start(); const root = h.fixture.readTask("root-1")!;
  h.composition.dispose();
  const cold = createDepartmentRuntimeComposition(h.deps); t.after(cold.dispose);
  let reads = 0, resumes = 0, refuseRecovery = false;
  const read = h.store.read.bind(h.store);
  h.store.read = (...args) => { reads++; return refuseRecovery ? { ok: false, error: "deterministic-recovery-refusal" } : read(...args); };
  const resume = cold.host.continueRoot;
  cold.host.continueRoot = (...args) => { resumes++; return resume(...args); };
  let prepares = 0;
  h.deps.prepareRoutes = async () => { if (++prepares === 1) { entered.resolve(); await release.promise; } };
  const pending = cold.organizationControl.continue(root);
  const rejected = assert.rejects(pending, /已停止|已失效/);
  await entered.promise;
  const readsBeforeStop = reads;
  refuseRecovery = true;
  await assert.rejects(cold.organizationControl.stop(h.fixture.readTask(root.id)!), /deterministic-recovery-refusal/);
  assert.equal(reads, readsBeforeStop + 1);
  release.resolve(); await rejected;
  assert.equal(reads, readsBeforeStop + 1, "invalidated request must not even enter ensure/recovery");
  assert.equal(resumes, 0); assert.equal(cold.host.runtimeSnapshot(root.id), null);
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped", "cold stop intent survives failed cleanup");
});

for (const cold of [false, true]) {
  test(`route preparation dispose revokes a pending request: controller-free=${cold}`, async (t) => {
    const entered = latch(), release = latch();
    const h = harness({ runDirectorDecision: async ({ task }) => ({ status: "pending-requirements", task }) }); t.after(() => { release.resolve(); h.dispose(); });
    await h.start(); const root = h.fixture.readTask("root-1")!;
    if (!cold) await h.composition.organizationControl.stop(root);
    if (cold) h.composition.dispose();
    const composition = cold ? createDepartmentRuntimeComposition(h.deps) : h.composition;
    t.after(composition.dispose);
    let reads = 0, resumes = 0;
    const read = h.store.read.bind(h.store);
    h.store.read = (...args) => { reads++; return read(...args); };
    const resume = composition.host.continueRoot;
    composition.host.continueRoot = (...args) => { resumes++; return resume(...args); };
    h.deps.prepareRoutes = async () => { entered.resolve(); await release.promise; };
    const pending = composition.organizationControl.continue(root);
    const rejected = assert.rejects(pending, /已停止|已失效/);
    await entered.promise; const readsAtPreparation = reads; composition.dispose(); release.resolve(); await rejected;
    assert.equal(reads, readsAtPreparation); assert.equal(resumes, 0);
    assert.equal(h.fixture.readTask(root.id)?.status, cold ? "running" : "stopped");
    await assert.rejects(composition.organizationControl.continue(root), /已释放/);
  });
}

for (const change of ["workspace", "routes", "session"] as const) {
  test(`route preparation retains frozen continuation identity: ${change}`, async (t) => {
    const entered = latch(), release = latch();
    const h = harness({ runDirectorDecision: async ({ task }) => ({ status: "pending-requirements", task }) }); t.after(() => { release.resolve(); h.dispose(); });
    await h.start(); const root = h.fixture.readTask("root-1")!;
    await h.composition.organizationControl.stop(root);
    let resumes = 0;
    const resume = h.composition.host.continueRoot;
    h.composition.host.continueRoot = (...args) => { resumes++; return resume(...args); };
    h.deps.prepareRoutes = async () => { entered.resolve(); await release.promise; };
    const pending = h.composition.organizationControl.continue(root);
    const rejected = assert.rejects(pending, /归属已变化/);
    await entered.promise;
    if (change === "workspace") h.workspace("foreign");
    if (change === "routes") {
      const department = structuredClone(root.department!); department.routes.director.configId = "replacement-profile";
      h.deps.updateTask(root.id, { department });
    }
    if (change === "session") h.targets.set("director", { tabId: "director", cli: "codex", sessionId: "replacement-session" });
    release.resolve(); await rejected;
    assert.equal(resumes, 0); assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  });
}

for (const cleanup of ["confirmed", "unknown", "stopped"] as const) {
  test(`resumed leader settlement wakes the director once after cleanup: ${cleanup}`, async (t) => {
    const cleanupEntered = latch(), cleanupDone = latch(), firstTurn = latch();
    let resumed = false, decisions = 0;
    const h = harness({ runDirectorDecision: async ({ task }) => { decisions++; return { status: "pending-requirements", task }; },
      observeLeaderCleanup: () => {
        if (!resumed) return { done: Promise.resolve() };
        cleanupEntered.resolve(); return cleanup === "unknown" ? null : { done: cleanupDone.promise };
      } });
    t.after(() => { cleanupDone.resolve(); h.dispose(); });
    await h.start();
    h.deps.updateTask("root-1", { subTasks: [{ id: "module", title: "module", status: "running", prompt: "Implement isolated module and report evidence." }] });
    h.fixture.queueMain((input, tab) => { h.fixture.publish(input, tab, { status: "end", content: '{"status":"wait","finalSummary":"等待停止"}' }); firstTurn.resolve(); });
    const first = await h.composition.host.startLeader("root-1", { leaderSubtaskId: "module", moduleTitle: "module", prompt: "Implement isolated module." });
    assert.ok(first.ok); await firstTurn.promise;
    await h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
    resumed = true; h.finish();
    await h.composition.organizationControl.continue(h.fixture.readTask("root-1")!, "继续模块");
    await cleanupEntered.promise;
    const before = decisions;
    assert.equal(h.notices.filter((v) => v.startsWith("组长汇报：")).length, 0, "no old-generation or pre-cleanup report");
    if (cleanup === "stopped") {
      const stopping = h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
      cleanupDone.resolve(); await stopping;
    } else cleanupDone.resolve();
    await waitForLoopPlus(() => h.composition.host.runtimeSnapshot("root-1")!.leaders[0].status === (cleanup === "unknown" ? "blocked" : cleanup === "stopped" ? "paused" : "completed"), "resumed settlement");
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (cleanup === "stopped") assert.equal(decisions, before, "late settlement cannot revive a stopped root");
    else {
      assert.equal(decisions, before + 1, "settlement wakes the coordination wait exactly once");
      assert.equal(h.notices.filter((v) => v.startsWith("组长汇报：")).length, 1);
      if (cleanup === "unknown") {
        assert.equal(h.composition.host.canCompleteRoot("root-1"), false);
        assert.deepEqual(h.composition.readCapacity("root-1")?.leaders, ["module"]);
      }
    }
  });
}

test("continuation waits for the old director run and transfers ownership without parallel loops", async (t) => {
  const entered = latch(), oldDone = latch(), cancelling = latch(), ownership = createLoopOrchestrationOwnershipTracker();
  let calls = 0, active = 0, maximum = 0, completed = 0;
  const h = harness({ acquireDirectorOwnership: ownership.acquire, completed: () => { completed++; }, stopDirector: () => { cancelling.resolve(); },
    runDirectorDecision: async ({ task }) => {
      calls++; active++; maximum = Math.max(maximum, active);
      if (calls === 1) { entered.resolve(); await oldDone.promise; }
      active--; return calls === 1 ? { status: "completed", task, decision: { status: "completed", finalSummary: "迟到" } } : { status: "pending-requirements", task };
    } });
  t.after(() => { oldDone.resolve(); h.dispose(); });
  await h.start(); await entered.promise;
  const stopping = h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
  await cancelling.promise; await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(h.composition.organizationControl.continue(h.fixture.readTask("root-1")!, "在途继续"), /正在停止/);
  assert.equal(calls, 1);
  oldDone.resolve(); await stopping;
  await h.composition.organizationControl.continue(h.fixture.readTask("root-1")!, "显式继续");
  await waitForLoopPlus(() => calls === 2, "new director after old run finally");
  assert.equal(maximum, 1); assert.equal(completed, 0, "stopped old result cannot complete a resumed root");
  assert.equal(ownership.getCount("root-1"), 1, "old finally cannot release transferred ownership");
  await h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
  assert.equal(ownership.getCount("root-1"), 0);
});

test("wake during a director model turn is consumed without a second concurrent loop", async (t) => {
  const entered = latch(), response = latch(); let calls = 0;
  const h = harness({ runDirectorDecision: async ({ task }) => { if (++calls === 1) { entered.resolve(); await response.promise; } return { status: "pending-requirements", task }; } });
  t.after(() => { response.resolve(); h.dispose(); });
  await h.start(); await entered.promise;
  h.composition.wakeDirector("root-1"); h.composition.wakeDirector("root-1");
  response.resolve(); await waitForLoopPlus(() => calls === 2, "coalesced in-flight wake");
  await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(calls, 2);
  await h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
});


for (const binding of ["first-native", "established-conflict", "readback-conflict"] as const) {
  test(`director post-turn session check preserves only the trusted initial binding: ${binding}`, async (t) => {
    const h = harness({ runDirectorDecision: async ({ task }) => {
      h.targets.set("director", { tabId: "director", cli: "codex", sessionId: "bound-native" });
      const current = h.deps.updateTask(task.id, { sessionId: "bound-native" })!;
      return { status: "pending-requirements", task: binding === "readback-conflict" ? task : current };
    } });
    t.after(() => h.dispose());
    h.targets.set("director", { tabId: "director", cli: "codex", sessionId: binding === "established-conflict" ? "existing-native" : "local_transcript" });
    await h.start(); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(h.fixture.readTask("root-1")?.status, binding === "first-native" ? "running" : "needs-review");
    assert.equal(h.notices.some((notice) => notice.includes("等待后归属已变化")), binding !== "first-native");
    await h.composition.organizationControl.stop(h.fixture.readTask("root-1")!);
  });
}


// A fresh host starts with no validated-route cache. Only the existing trusted
// asynchronous prepareRoutes operation may make the strict validator accept it.
test("cold stop prepares fresh routes before recovery without launching a director", async (t) => {
  const h = harness(); t.after(h.dispose);
  await h.start();
  const root = h.fixture.readTask("root-1")!;
  h.composition.dispose();
  let prepared = false, preparations = 0;
  const cold = createDepartmentRuntimeComposition({ ...h.deps,
    validateRoutes: () => prepared,
    prepareRoutes: async (routes) => { assert.deepEqual(routes, root.department!.routes); preparations++; prepared = true; },
  }); t.after(cold.dispose);
  assert.equal(prepared, false);
  const turns = h.directorPrompts.length;
  await cold.organizationControl.stop(root);
  assert.equal(preparations, 1);
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  assert.equal(h.directorPrompts.length, turns);
});

test("cold stop reaches exact live-leader refusal after trusted preparation and retains durable responsibility", async (t) => {
  const h = harness(); t.after(h.dispose);
  await h.start();
  h.deps.updateTask("root-1", { subTasks: [{ id: "module", title: "module", status: "running", prompt: "Implement isolated module." }] });
  // Keep a real main invocation pending; a completed decision can change status
  // during route preparation and no longer models a live cold refusal.
  h.fixture.queueMain(async () => { await h.fixture.holdMain(); });
  t.after(h.fixture.releaseHeldMain);
  const first = await h.composition.host.startLeader("root-1", { leaderSubtaskId: "module", moduleTitle: "module", prompt: "Implement isolated module." });
  assert.ok(first.ok);
  await waitForLoopPlus(() => h.fixture.mainCalls.length > 0, "leader actual turn");
  assert.equal(h.fixture.readTask(first.taskId)?.status, "running");
  const root = h.fixture.readTask("root-1")!;
  const before = h.store.read(root.id, root.workspaceKey);
  h.composition.dispose();
  let prepared = false, directorStops = 0, leaderStops = 0, launches = 0;
  const cold = createDepartmentRuntimeComposition({ ...h.deps,
    prepareRoutes: async () => { prepared = true; }, validateRoutes: () => prepared,
    inspectLeaderSession: (task) => ({ target: [...h.targets.values()].find((v) => v.sessionId === task.sessionId)!, live: null }),
    stopDirector: () => { directorStops++; }, stopLeader: async () => { leaderStops++; },
    runtime: { ...h.deps.runtime, runEventDriven: (...args) => { launches++; return h.deps.runtime.runEventDriven(...args); } },
    runDirectorDecision: async () => { launches++; throw new Error("cold-stop-must-not-prompt"); },
  }); t.after(cold.dispose);
  await assert.rejects(cold.organizationControl.stop(root), /^Error: 部门恢复核验阻塞：live-leader-unverifiable。保留原占用，不能重新派发。$/);
  assert.equal(prepared, true); assert.equal(directorStops, 1); assert.equal(leaderStops, 0);
  assert.deepEqual(h.store.read(root.id, root.workspaceKey), before);
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  assert.equal(launches, 0);
  assert.equal(cold.host.runtimeSnapshot(root.id), null);
});


for (const change of ["workspace", "routes", "session", "cli", "status", "plan", "missing", "configuration", "dispose"] as const) {
  test(`cold stop rejects expired recovery before settlement: ${change}`, async (t) => {
    const entered = latch(), release = latch();
    const h = harness(); t.after(() => { release.resolve(); h.dispose(); });
    await h.start(); const root = h.fixture.readTask("root-1")!;
    h.composition.dispose();
    let valid = true, reads = 0, controls = 0;
    const cold = createDepartmentRuntimeComposition({ ...h.deps,
      prepareRoutes: async () => { entered.resolve(); await release.promise; }, validateRoutes: () => valid,
      readTask: (id) => change === "missing" && !valid ? null : h.deps.readTask(id),
      stopDirector: () => { controls++; },
    }); t.after(cold.dispose);
    const read = h.store.read.bind(h.store);
    h.store.read = (...args) => { reads++; return read(...args); };
    const pending = cold.organizationControl.stop(root);
    const rejected = assert.rejects(pending, /已失效|已变化|发生变化/);
    await entered.promise;
    if (change === "workspace") h.workspace("foreign-workspace");
    if (change === "routes") {
      const department = structuredClone(root.department!); department.routes.employee.configId = "other-profile";
      h.deps.updateTask(root.id, { department });
    }
    if (change === "session") h.deps.updateTask(root.id, { sessionId: "other-session" });
    if (change === "cli") h.deps.updateTask(root.id, { cli: "opencode" });
    if (change === "status") h.deps.updateTask(root.id, { status: "completed" });
    if (change === "plan") h.deps.updateTask(root.id, { loopPlusAcceptancePlan: undefined });
    if (change === "missing" || change === "configuration") valid = false;
    if (change === "dispose") cold.dispose();
    release.resolve(); await rejected;
    assert.equal(reads, 0, "stale request must not read recovery state or install an organization");
    assert.equal(controls, 1); assert.equal(cold.host.runtimeSnapshot(root.id), null);
  });
}

test("cold stop fences concurrent continue and duplicate stop until preparation settles", async (t) => {
  const entered = latch(), release = latch();
  const h = harness(); t.after(() => { release.resolve(); h.dispose(); });
  await h.start(); const root = h.fixture.readTask("root-1")!;
  h.composition.dispose();
  let prepares = 0;
  const cold = createDepartmentRuntimeComposition({ ...h.deps,
    prepareRoutes: async () => { prepares++; entered.resolve(); await release.promise; },
  }); t.after(cold.dispose);
  const stopping = cold.organizationControl.stop(root);
  await entered.promise;
  await assert.rejects(cold.organizationControl.continue(root), /正在停止/);
  const duplicate = cold.organizationControl.stop(root);
  assert.equal(duplicate, stopping, "the second stop joins the original request");
  assert.equal(prepares, 1);
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  release.resolve(); await stopping;
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  assert.equal(h.directorPrompts.length, 1);
});

test("cold stop failed preparation retains state and permits an explicit later stop", async (t) => {
  const h = harness(); t.after(h.dispose);
  await h.start(); const root = h.fixture.readTask("root-1")!;
  h.composition.dispose();
  const before = h.store.read(root.id, root.workspaceKey);
  let prepares = 0, directorStops = 0, memberStops = 0;
  const cold = createDepartmentRuntimeComposition({ ...h.deps, prepareRoutes: async () => {
    if (++prepares === 1) throw new Error("trusted-route-refusal");
  }, stopDirector: () => { directorStops++; }, prepareColdRecovery: async () => { memberStops++; } }); t.after(cold.dispose);
  await assert.rejects(cold.organizationControl.stop(root), /trusted-route-refusal/);
  assert.equal(cold.host.runtimeSnapshot(root.id), null);
  assert.deepEqual(h.store.read(root.id, root.workspaceKey), before);
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  assert.equal(directorStops, 1); assert.equal(memberStops, 1);
  await cold.organizationControl.stop(root);
  assert.equal(prepares, 2); assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
});

test("warm stop closes admission synchronously without route preparation or waiting for director cancellation", async (t) => {
  const entered = latch(), release = latch();
  const h = harness({ runDirectorDecision: async ({ task }) => {
    entered.resolve(); await release.promise; return { status: "pending-requirements", task };
  } }); t.after(() => { release.resolve(); h.dispose(); });
  await h.start(); await entered.promise;
  const root = h.fixture.readTask("root-1")!;
  let prepares = 0;
  h.deps.prepareRoutes = async () => { prepares++; throw new Error("warm-stop-must-not-prepare"); };
  const stopping = h.composition.organizationControl.stop(root);
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped", "first await cannot precede the admission fence");
  assert.equal(h.composition.host.runtimeSnapshot(root.id)?.stopping, true);
  assert.equal(prepares, 0);
  const denied = await h.composition.host.startLeader(root.id, { leaderSubtaskId: "late-module", moduleTitle: "late", prompt: "Must not execute." });
  assert.equal(denied.ok, false);
  assert.equal(h.fixture.mainCalls.length, 0);
  release.resolve(); await stopping;
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
});

const allocationMainReleases = new WeakMap<object, Array<() => void>>();
async function disposeAllocationHarness(h: ReturnType<typeof harness>) {
  for (const taskId of h.fixture.createdTaskIds) h.fixture.adapter.host().stopParent(taskId);
  for (const release of allocationMainReleases.get(h) ?? []) release();
  await Promise.all(h.fixture.createdTaskIds.map((taskId) => h.fixture.adapter.waitForTaskIdle(taskId)));
  h.dispose();
}
async function allocationLeader(h: ReturnType<typeof harness>, moduleId: string) {
  const root = h.fixture.readTask("root-1")!;
  h.deps.updateTask(root.id, { subTasks: [...root.subTasks, { id: moduleId, title: moduleId, status: "running", prompt: "Implement and verify the complete isolated module." }] });
  const gate = latch(), releases = allocationMainReleases.get(h) ?? [];
  releases.push(gate.resolve); allocationMainReleases.set(h, releases);
  h.fixture.queueMain(() => gate.promise);
  const started = await h.composition.host.startLeader(root.id, { leaderSubtaskId: moduleId, moduleTitle: moduleId, prompt: "Implement and verify the complete isolated module." });
  assert.ok(started.ok);
  await waitForLoopPlus(() => h.fixture.mainCalls.length > 0, "allocation leader first turn");
  return started.taskId;
}
function allocationAttempt(h: ReturnType<typeof harness>, taskId: string, id: string) {
  const task = h.fixture.readTask(taskId)!;
  const loopPlus = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
  loopPlus.running.push({ subtaskId: id, attemptId: id, title: id, conflictGroup: null, writeFiles: [], state: "running" });
  loopPlus.seenAttempts.push({ subtaskId: id, attemptId: id, disposition: "open" });
  loopPlus.maxConcurrency = Math.max(loopPlus.maxConcurrency, loopPlus.running.length);
  h.deps.updateTask(taskId, { subTasks: [...task.subTasks, { id, title: id, status: "running", prompt: "Implement the complete independent task." }], loopPlus });
  return { taskId, subtaskId: id, attemptId: id };
}

test("allocation production ports report live leases and apply advisory changes with CAS", async (t) => {
  const h = harness(); t.after(() => disposeAllocationHarness(h)); h.configuration.limits.maxEmployees = 20; await h.start();
  const leader = await allocationLeader(h, "allocation-a");
  const root = h.fixture.readTask("root-1")!;
  const first = h.composition.readDepartmentEmployeeAllocation(root.id)!;
  assert.equal(first.defaultLimit, 5); assert.equal(first.leaders[0].appliedLimit, null);
  const leases = [];
  for (let i = 0; i < 5; i++) {
    const lease = await h.composition.host.acquireAttemptExecution(allocationAttempt(h, leader, `held-${i}`), new AbortController().signal);
    assert.ok(lease, JSON.stringify({task:h.fixture.readTask(leader), runtime:h.composition.host.runtimeSnapshot(root.id), policy:h.composition.readDepartmentEmployeeAllocation(root.id), logs:h.fixture.logs})); leases.push(lease);
  }
  const extra = await h.composition.host.acquireAttemptExecution(allocationAttempt(h, leader, "group-full"), new AbortController().signal);
  assert.ok(extra); leases.push(extra);
  assert.equal(h.composition.readCapacity(root.id)!.employees.length, 6);
  const latest = h.composition.readDepartmentEmployeeAllocation(root.id)!;
  const request = { requestId: "save-a", leaderTaskId: leader, employeeLimit: 2, expectedRevision: latest.revision };
  const saved = h.composition.updateDepartmentEmployeeLimit(root, request); assert.ok(saved.ok);
  assert.equal(h.composition.updateDepartmentEmployeeLimit(root, { ...request, requestId: "competitor", employeeLimit: 3 }).ok, false);
  assert.equal(saved.allocation.leaders[0].appliedLimit, 5); assert.equal(saved.allocation.leaders[0].pending, true);
  assert.equal(saved.allocation.leaders[0].activeEmployees, 6);
  const repeated = { taskId: leader, subtaskId: "held-0", attemptId: "held-0" };
  assert.equal(await h.composition.host.acquireAttemptExecution(repeated, new AbortController().signal), leases[0]);
  assert.equal(h.composition.readDepartmentEmployeeAllocation(root.id)!.leaders[0].appliedLimit, 5, "held identity is not a new attempt");
  const lowered = await h.composition.host.acquireAttemptExecution(allocationAttempt(h, leader, "lowered"), new AbortController().signal);
  assert.ok(lowered); leases.push(lowered);
  const applied = h.composition.readDepartmentEmployeeAllocation(root.id)!;
  assert.equal(applied.leaders[0].appliedLimit, 2); assert.equal(applied.leaders[0].pending, false);
  assert.equal(applied.leaders[0].activeEmployees, 7);
  assert.equal(h.composition.readEmployeeCapacity(root.id, leader)!.leaderAllocation!.availableEmployees, 0);
  assert.equal(h.composition.updateDepartmentEmployeeLimit(h.fixture.readTask(leader)!, { ...request, expectedRevision: applied.revision }).ok, false);
  assert.equal(h.composition.updateDepartmentEmployeeLimit(root, { ...request, leaderTaskId: "foreign", expectedRevision: applied.revision }).ok, false);
  assert.equal(h.composition.readEmployeeCapacity("foreign", leader), null);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal(await h.composition.host.acquireAttemptExecution(allocationAttempt(h, leader, "cancelled"), cancelled.signal), null);
  leases.forEach((lease) => lease.release());
  assert.equal(h.composition.readCapacity(root.id)!.employees.length, 0);
});

test("allocation persistence failure blocks the next attempt without releasing earlier live occupancy", async (t) => {
  const h = harness(); t.after(() => disposeAllocationHarness(h)); h.configuration.limits.maxEmployees = 20; await h.start();
  const leader = await allocationLeader(h, "allocation-failure"), root = h.fixture.readTask("root-1")!;
  const held = await h.composition.host.acquireAttemptExecution(allocationAttempt(h, leader, "held"), new AbortController().signal); assert.ok(held);
  const view = h.composition.readDepartmentEmployeeAllocation(root.id)!;
  assert.equal(h.composition.updateDepartmentEmployeeLimit(root, { requestId: "pending", leaderTaskId: leader, employeeLimit: 3, expectedRevision: view.revision }).ok, true);
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", () => { throw new Error("allocation-fsync-rename-failure"); });
  assert.equal(await h.composition.host.acquireAttemptExecution(allocationAttempt(h, leader, "not-started"), new AbortController().signal), null);
  assert.equal(h.composition.capacity.snapshot(root.id)[0].employees.length, 1);
  assert.equal(h.fixture.attemptCalls.length, 0);
  t.mock.restoreAll(); assert.ok(rename);
  assert.equal(h.composition.readDepartmentEmployeeAllocation(root.id)!.leaders[0].appliedLimit, 5, "failed activation was never confirmed");
  held.release();
});

test("simultaneous dispatches across groups are tracked even at zero advisory balance", async (t) => {
  const h = harness(); t.after(() => disposeAllocationHarness(h)); h.configuration.limits.maxEmployees = 1; await h.start();
  const a = await allocationLeader(h, "allocation-a"), b = await allocationLeader(h, "allocation-b");
  const signal = new AbortController().signal;
  const attempts = [[a, "a-first"], [b, "b-first"], [a, "a-second"], [a, "a-third"], [b, "b-second"]]
    .map(([leader, attempt]) => allocationAttempt(h, leader, attempt));
  const leases = await Promise.all(attempts.map((attempt) => h.composition.host.acquireAttemptExecution(attempt, signal)));
  const occupancy = h.composition.readCapacity("root-1")!;
  assert.equal(occupancy.employees.length, 5); assert.equal(occupancy.employeeOverflow, undefined);
  const reference = h.composition.readEmployeeCapacity("root-1", a)!;
  assert.equal(reference.availableEmployees, 0);
  assert.equal(reference.leaderAllocation!.activeEmployees, 3);
  for (const lease of leases) { assert.ok(lease); lease.release(); }
  assert.equal(h.composition.readCapacity("root-1")!.employees.length, 0);
});

for (const fail of [false, true]) {
  test(`organization control remains unconfirmed across empty capacity until original stop settles: failure=${fail}`, async (t) => {
    const entered = latch(), release = latch();
    const h = harness({ stopDirector: async () => { entered.resolve(); await release.promise; if (fail) throw new Error("original-stop-unverified"); } });
    t.after(() => { release.resolve(); h.dispose(); });
    await h.start();
    const root = h.fixture.readTask("root-1")!;
    const pending = h.composition.organizationControl.stop(root);
    const outcome = pending.then(() => null, error => error);
    await entered.promise;
    assert.equal(h.composition.isOrganizationStopUnconfirmed(root.id), true);
    assert.equal(h.composition.readOrganizationStopState(root.id), "stopping");
    assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
    assert.equal(h.composition.readCapacity(root.id)?.leaders.length, 0);
    await assert.rejects(h.composition.organizationControl.continue(root, "停止在途"), /正在停止/);
    release.resolve();
    const error = await outcome;
    assert.equal(Boolean(error), fail);
    assert.equal(h.composition.isOrganizationStopUnconfirmed(root.id), fail, "failed stop is never a confirmed release");
    assert.equal(h.composition.readOrganizationStopState(root.id), fail ? "unconfirmed" : "confirmed");
    if (fail) await assert.rejects(h.composition.organizationControl.continue(root, "停止拒绝"), /停止未确认/);
    assert.ok(!h.fixture.readTask(root.id)?.supplementalRequirements?.length);
  });
}

test("missing root stop write retains the continuation fence after member cleanup and director retirement", async (t) => {
  const directorEntered = latch(), directorDone = latch(), firstLeaderTurn = latch(), leaderReleased = latch();
  const ownership = createLoopOrchestrationOwnershipTracker();
  const id = "root-1";
  let refuseRootWrite = true, checkingRetirement = true;
  let directorCalls = 0, cancellations = 0, ownerCleanups = 0, reads = 0, targets = 0, prepares = 0;
  const h = harness({
    updateTask: (taskId, patch): LoopTaskRecord | null => taskId === id && patch.status === "stopped" && refuseRootWrite ? null : h.update(taskId, patch),
    acquireDirectorOwnership: ownership.acquire,
    runDirectorDecision: async ({ task }) => {
      if (++directorCalls === 1) { directorEntered.resolve(); await directorDone.promise; }
      return { status: "pending-requirements", task };
    },
    stopDirector: () => { cancellations++; },
    observeLeaderCleanup: () => { ownerCleanups++; return { done: Promise.resolve() }; },
    leaderReleased: () => { leaderReleased.resolve(); },
  });
  t.after(() => { directorDone.resolve(); h.dispose(); });
  await h.start(); await directorEntered.promise;
  h.deps.updateTask(id, { subTasks: [{ id: "module", title: "module", status: "running", prompt: "Implement the isolated module." }] });
  h.fixture.queueMain((input, tab) => { h.fixture.publish(input, tab, { status: "end", content: '{"status":"wait","finalSummary":"等待停止"}' }); firstLeaderTurn.resolve(); });
  assert.ok((await h.composition.host.startLeader(id, { leaderSubtaskId: "module", moduleTitle: "module", prompt: "Implement the isolated module." })).ok);
  await firstLeaderTurn.promise;
  assert.deepEqual(h.composition.readCapacity(id)?.leaders, ["module"]);

  const resolveTarget = h.deps.resolveTargetForRoot!;
  h.deps.readOrganizationRoot = (taskId) => {
    reads++;
    if (checkingRetirement) assert.equal(ownership.getCount(id), 0, "confirmation must read after the director finalizer");
    return h.fixture.readTask(taskId);
  };
  h.deps.resolveTargetForRoot = (task) => { targets++; return resolveTarget(task); };
  h.deps.prepareRoutes = async () => { prepares++; };
  const stopping = h.composition.organizationControl.stop(h.fixture.readTask(id)!);
  const refused = assert.rejects(stopping, /部门停止归属或状态已变化/);
  await leaderReleased.promise;
  assert.equal(cancellations, 1);
  assert.ok(ownerCleanups > 0);
  assert.deepEqual(h.composition.readCapacity(id)?.leaders, []);
  assert.equal(h.fixture.readTask(id)?.status, "running");
  assert.equal(h.composition.readOrganizationStopState(id), "stopping");
  assert.equal(reads, 0, "member cleanup alone must not trigger the confirmation read");

  directorDone.resolve(); await refused;
  assert.equal(reads, 1);
  assert.equal(h.composition.readOrganizationStopState(id), "unconfirmed");
  assert.equal(h.composition.isOrganizationStopUnconfirmed(id), true);
  await assert.rejects(h.composition.organizationControl.continue(h.fixture.readTask(id)!, "不得继续"), /停止未确认/);
  assert.deepEqual([targets, prepares, directorCalls], [0, 0, 1]);

  refuseRootWrite = false;
  await h.composition.organizationControl.stop(h.fixture.readTask(id)!);
  assert.equal(h.fixture.readTask(id)?.status, "stopped");
  assert.equal(h.composition.readOrganizationStopState(id), "confirmed");
  checkingRetirement = false;
  h.finish();
  await h.composition.organizationControl.continue(h.fixture.readTask(id)!, "核验后继续");
  assert.deepEqual([targets, prepares], [1, 1]);
  assert.equal(h.fixture.readTask(id)?.status, "running");
  assert.deepEqual(h.fixture.readTask(id)?.supplementalRequirements, ["核验后继续"]);
  assert.equal(h.composition.readOrganizationStopState(id), undefined);
});

for (const change of ["missing", "root", "file", "workspace", "active-workspace", "session", "cli"] as const) {
  test(`organization stop refuses changed trusted root readback: ${change}`, async (t) => {
    const h = harness({ runDirectorDecision: async ({ task }) => ({ status: "pending-requirements", task }) });
    t.after(h.dispose);
    await h.start();
    const root = h.fixture.readTask("root-1")!;
    h.deps.readOrganizationRoot = (id) => {
      const current = h.fixture.readTask(id)!;
      assert.equal(current.status, "stopped");
      switch (change) {
        case "missing": return null;
        case "root": return { ...current, id: "different-root" };
        case "file": return { ...current, taskStoreFile: `${current.taskStoreFile}.replaced` };
        case "workspace": return { ...current, workspaceKey: "different-workspace" };
        case "active-workspace": h.workspace("different-workspace"); return current;
        case "session": return { ...current, sessionId: "different-session" };
        case "cli": return { ...current, cli: "opencode" };
      }
    };
    await assert.rejects(h.composition.organizationControl.stop(root), /部门停止归属或状态已变化/);
    assert.equal(h.composition.readOrganizationStopState(root.id), "unconfirmed");
    assert.equal(h.composition.isOrganizationStopUnconfirmed(root.id), true);
  });
}

test("persisted stopped director resumes from a fresh host without asking the user to stop again", async (t) => {
  const h = harness({ runDirectorDecision: async ({ task }) => ({ status: "pending-requirements", task }) });
  t.after(h.dispose);
  await h.start();
  const root = h.fixture.readTask("root-1")!;
  await h.composition.organizationControl.stop(root);
  h.composition.dispose();
  let prepares = 0, targets = 0, controls = 0;
  const cold = createDepartmentRuntimeComposition({ ...h.deps, prepareRoutes: async () => { prepares++; },
    resolveTargetForRoot: (task) => { targets++; return h.deps.resolveTargetForRoot!(task); },
    stopDirector: () => { controls++; },
  });
  t.after(cold.dispose);
  const stopped = h.fixture.readTask(root.id)!;
  assert.deepEqual(cold.readCapacity(root.id)?.leaders, []);
  assert.deepEqual(cold.readCapacity(root.id)?.employees, []);
  await cold.organizationControl.continue(stopped, "直接继续");
  assert.equal(h.fixture.readTask(root.id)?.status, "running");
  assert.deepEqual(h.fixture.readTask(root.id)?.supplementalRequirements, ["直接继续"]);
  assert.equal(cold.readOrganizationStopState(root.id), undefined);
  assert.deepEqual([prepares, targets, controls], [1, 1, 0]);
});

test("a newer stop during leader continuation preparation prevents the old handoff from starting execution", async (t) => {
  const firstTurn = latch(), preparing = latch(), prepared = latch();
  const h = harness({ runDirectorDecision: async ({ task }) => ({ status: "pending-requirements", task }),
    resumeLeaderExecution: async () => { preparing.resolve(); await prepared.promise; },
  });
  t.after(() => { prepared.resolve(); h.dispose(); });
  await h.start();
  const id = "root-1";
  h.deps.updateTask(id, { subTasks: [{ id: "module", title: "module", status: "running", prompt: "Implement the isolated module." }] });
  h.fixture.queueMain((input, tab) => { h.fixture.publish(input, tab, { status: "end", content: '{"status":"wait","finalSummary":"等待停止"}' }); firstTurn.resolve(); });
  assert.ok((await h.composition.host.startLeader(id, { leaderSubtaskId: "module", moduleTitle: "module", prompt: "Implement the isolated module." })).ok);
  await firstTurn.promise;
  await h.composition.organizationControl.stop(h.fixture.readTask(id)!);

  const before = h.fixture.mainCalls.length;
  const continuing = h.composition.organizationControl.continue(h.fixture.readTask(id)!, "迟到交接");
  const rejected = assert.rejects(continuing, /已停止|resume-cancelled/);
  await preparing.promise;
  assert.equal(h.fixture.readTask(id)?.status, "running");
  assert.equal(h.composition.readOrganizationStopState(id), undefined, "admission consumes the previous receipt before preparation settles");
  await h.composition.organizationControl.stop(h.fixture.readTask(id)!);
  prepared.resolve(); await rejected;
  assert.equal(h.fixture.mainCalls.length, before);
  assert.equal(h.fixture.readTask(id)?.status, "stopped");
  assert.equal(h.composition.readOrganizationStopState(id), "confirmed", "late handoff cannot consume the newer receipt");
});

test("duplicate organization stop shares the result and permits a later stop after failure", async (t) => {
  const firstEntered = latch(), firstRelease = latch();
  let calls = 0, reads = 0;
  const h = harness({ stopDirector: async () => {
    const call = ++calls;
    if (call === 1) { firstEntered.resolve(); await firstRelease.promise; throw new Error("stop-cleanup-failed"); }
  } });
  t.after(() => { firstRelease.resolve(); h.dispose(); });
  await h.start(); const root = h.fixture.readTask("root-1")!;
  h.deps.readOrganizationRoot = (id) => { reads++; return h.fixture.readTask(id); };
  const first = h.composition.organizationControl.stop(root); await firstEntered.promise;
  const second = h.composition.organizationControl.stop(h.fixture.readTask(root.id)!);
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.equal(h.composition.isOrganizationStopUnconfirmed(root.id), true);
  assert.equal(h.composition.readOrganizationStopState(root.id), "stopping");
  firstRelease.resolve(); await assert.rejects(first, /尚未完成全部执行清理/);
  assert.equal(reads, 0, "failed stop cannot report success");
  assert.equal(h.composition.isOrganizationStopUnconfirmed(root.id), true);
  assert.equal(h.composition.readOrganizationStopState(root.id), "unconfirmed");
  await h.composition.organizationControl.stop(h.fixture.readTask(root.id)!);
  assert.equal(calls, 2);
  assert.equal(h.composition.isOrganizationStopUnconfirmed(root.id), false);
  assert.equal(reads, 1);
});
