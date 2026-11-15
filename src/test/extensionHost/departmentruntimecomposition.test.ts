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
  return { fixture, composition, deps, store, directory, targets, notices, directorPrompts, configuration, start, dispatch, finish,
    decide: (next: typeof decision) => { decision = next; }, prepare: (next: () => void) => { prepares = next; }, workspace: (value: string) => { workspace = value; },
    dispose: () => { composition.dispose(); fixture.dispose(); } };
}

// This fixture exercises the real composition/classic parser with in-memory task
// persistence. It does not claim production owned-storage or native CLI evidence.
function latch() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }

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
    content: "{\"status\":\"continue\"}", requirements: [] });
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
    let decisions = 0;
    const h = harness({ acquireDirectorOwnership: ownership.acquire, runDirectorDecision: async ({ task }) => {
      decisions++; return { status: "pending-requirements", task };
    } });
    t.after(() => { release.resolve(); h.dispose(); });
    await h.start();
    const root = h.fixture.readTask("root-1")!;
    await h.composition.organizationControl.stop(root);
    await ownership.waitForIdle(root.id);
    const original = h.composition.host.continueRoot;
    h.composition.host.continueRoot = async (id) => {
      if (outcome === "reject") return { ok: false, reason: "deterministic-refusal" };
      if (outcome === "throw") throw new Error("deterministic-startup-error");
      const result = await original(id);
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
    } else {
      await continuation;
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
  const h = harness({ acquireLeaderOwnership: ownership.acquire, resumeLeaderExecution: () => undefined,
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
    await assert.rejects(h.composition.handleDirectorDecision({ task, decision: { status: "blocked" }, content: '{"status":"blocked"}', requirements: [] }), /部门/);
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
  h.composition.host.continueRoot = (id) => { resumes++; return resume(id); };
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
  h.composition.host.continueRoot = (id) => { resumes++; return resume(id); };
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
  await h.composition.organizationControl.stop(root);
  h.composition.dispose();
  const cold = createDepartmentRuntimeComposition(h.deps); t.after(cold.dispose);
  let reads = 0, resumes = 0;
  const read = h.store.read.bind(h.store);
  h.store.read = (...args) => { reads++; return reads === 1 ? { ok: false, error: "deterministic-recovery-refusal" } : read(...args); };
  const resume = cold.host.continueRoot;
  cold.host.continueRoot = (id) => { resumes++; return resume(id); };
  let prepares = 0;
  h.deps.prepareRoutes = async () => { if (++prepares === 1) { entered.resolve(); await release.promise; } };
  const pending = cold.organizationControl.continue(root);
  const rejected = assert.rejects(pending, /已停止|已失效/);
  await entered.promise;
  await assert.rejects(cold.organizationControl.stop(h.fixture.readTask(root.id)!), /deterministic-recovery-refusal/);
  assert.equal(reads, 1);
  release.resolve(); await rejected;
  assert.equal(reads, 1, "invalidated request must not even enter ensure/recovery");
  assert.equal(resumes, 0); assert.equal(cold.host.runtimeSnapshot(root.id), null);
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
});

for (const cold of [false, true]) {
  test(`route preparation dispose revokes a pending request: controller-free=${cold}`, async (t) => {
    const entered = latch(), release = latch();
    const h = harness({ runDirectorDecision: async ({ task }) => ({ status: "pending-requirements", task }) }); t.after(() => { release.resolve(); h.dispose(); });
    await h.start(); const root = h.fixture.readTask("root-1")!;
    await h.composition.organizationControl.stop(root);
    if (cold) h.composition.dispose();
    const composition = cold ? createDepartmentRuntimeComposition(h.deps) : h.composition;
    t.after(composition.dispose);
    let reads = 0, resumes = 0;
    const read = h.store.read.bind(h.store);
    h.store.read = (...args) => { reads++; return read(...args); };
    const resume = composition.host.continueRoot;
    composition.host.continueRoot = (id) => { resumes++; return resume(id); };
    h.deps.prepareRoutes = async () => { entered.resolve(); await release.promise; };
    const pending = composition.organizationControl.continue(root);
    const rejected = assert.rejects(pending, /已停止|已失效/);
    await entered.promise; composition.dispose(); release.resolve(); await rejected;
    assert.equal(reads, 0); assert.equal(resumes, 0);
    assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
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
    h.composition.host.continueRoot = (id) => { resumes++; return resume(id); };
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
  const continuing = h.composition.organizationControl.continue(h.fixture.readTask("root-1")!, "显式继续");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  oldDone.resolve(); await stopping; await continuing;
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
  h.fixture.queueMain((input, tab) => h.fixture.publish(input, tab, { status: "end", content: '{"status":"wait","finalSummary":"等待停止"}' }));
  const first = await h.composition.host.startLeader("root-1", { leaderSubtaskId: "module", moduleTitle: "module", prompt: "Implement isolated module." });
  assert.ok(first.ok);
  await waitForLoopPlus(() => h.fixture.mainCalls.length > 0, "leader actual turn");
  const root = h.fixture.readTask("root-1")!;
  const before = h.store.read(root.id, root.workspaceKey);
  h.composition.dispose();
  let prepared = false, stops = 0, launches = 0;
  const cold = createDepartmentRuntimeComposition({ ...h.deps,
    prepareRoutes: async () => { prepared = true; }, validateRoutes: () => prepared,
    inspectLeaderSession: (task) => ({ target: [...h.targets.values()].find((v) => v.sessionId === task.sessionId)!, live: null }),
    stopDirector: () => { stops++; }, stopLeader: async () => { stops++; },
    runtime: { ...h.deps.runtime, runEventDriven: (...args) => { launches++; return h.deps.runtime.runEventDriven(...args); } },
    runDirectorDecision: async () => { launches++; throw new Error("cold-stop-must-not-prompt"); },
  }); t.after(cold.dispose);
  await assert.rejects(cold.organizationControl.stop(root), /^Error: 部门恢复核验阻塞：live-leader-unverifiable。保留原占用，不能重新派发。$/);
  assert.equal(prepared, true); assert.equal(stops, 0);
  assert.deepEqual(h.store.read(root.id, root.workspaceKey), before);
  assert.equal(h.fixture.readTask(root.id)?.status, "running");
  assert.equal(launches, 0);
  assert.equal(cold.host.runtimeSnapshot(root.id), null);
});


for (const change of ["workspace", "routes", "session", "cli", "status", "plan", "missing", "configuration", "dispose"] as const) {
  test(`cold stop rejects expired preparation before recovery: ${change}`, async (t) => {
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
    assert.equal(controls, 0); assert.equal(cold.host.runtimeSnapshot(root.id), null);
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
  await assert.rejects(cold.organizationControl.stop(root), /正在停止/);
  assert.equal(prepares, 1);
  assert.equal(h.fixture.readTask(root.id)?.status, "running");
  release.resolve(); await stopping;
  assert.equal(h.fixture.readTask(root.id)?.status, "stopped");
  assert.equal(h.directorPrompts.length, 1);
});

test("cold stop failed preparation retains state and permits an explicit later stop", async (t) => {
  const h = harness(); t.after(h.dispose);
  await h.start(); const root = h.fixture.readTask("root-1")!;
  h.composition.dispose();
  const before = h.store.read(root.id, root.workspaceKey);
  let prepares = 0;
  const cold = createDepartmentRuntimeComposition({ ...h.deps, prepareRoutes: async () => {
    if (++prepares === 1) throw new Error("trusted-route-refusal");
  } }); t.after(cold.dispose);
  await assert.rejects(cold.organizationControl.stop(root), /trusted-route-refusal/);
  assert.equal(cold.host.runtimeSnapshot(root.id), null);
  assert.deepEqual(h.store.read(root.id, root.workspaceKey), before);
  assert.equal(h.fixture.readTask(root.id)?.status, "running");
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
