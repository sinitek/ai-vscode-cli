import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { installVscodeMock } from "../vscodeMock";
installVscodeMock();
const previousHome = process.env.HOME;
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "department-production-composition-home-"));
process.env.HOME = isolatedHome;
import type { LoopMainDecision, LoopTaskRecord } from "../../loopTaskStore";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";
import type { DepartmentConfigurationState } from "../../departmentConfiguration";
import type { DepartmentRuntimeCompositionDeps } from "../../extensionHost/departmentruntimecomposition";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import { resolveLoopPanelProgressPercent } from "../../loopGroupChatPanelState";
import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
const { createDepartmentRuntimeComposition } = require("../../extensionHost/departmentruntimecomposition") as typeof import("../../extensionHost/departmentruntimecomposition");
const { freezeDepartmentThinkingDefaults } = require("../../extensionHost/departmentruntimecomposition") as typeof import("../../extensionHost/departmentruntimecomposition");
const { DepartmentRuntimeStore } = require("../../extensionHost/departmentruntimestore") as typeof import("../../extensionHost/departmentruntimestore");
const { createLoopOrchestrationHost } = require("../../extensionHost/loopOrchestration") as typeof import("../../extensionHost/loopOrchestration");
const { createPromptRunRuntimeHost } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
const { transitionLoopMainDecision } = require("../../extensionHost/loopTaskStateMachine") as typeof import("../../extensionHost/loopTaskStateMachine");
const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const loopTaskStore = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
const { createDepartmentProductionTaskStore } = require("../../extensionHost/departmentProductionTaskStore") as typeof import("../../extensionHost/departmentProductionTaskStore");
const { prepareDepartmentTaskRecord } = require("../../extensionHost/departmentOwnedTaskRepository") as typeof import("../../extensionHost/departmentOwnedTaskRepository");
const { updateLoopTaskRecord } = loopTaskStore;
if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
const taskSource = createDepartmentProductionTaskStore(path.join(isolatedHome, ".sinitek_cli", "department-tasks-v1"));
test.after(async () => { await taskSource.close(); fs.rmSync(isolatedHome, { recursive: true, force: true }); });
let rootTaskSequence = 0;
function harness(overrides: Partial<DepartmentRuntimeCompositionDeps> = {}) {
  const rootTaskId = `root-${++rootTaskSequence}`;
  const initialTaskFileCount = taskSource.listTaskStoreFiles().length;
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile", taskPersistenceFactory: (rootDir) => {
    return {
      create: (task) => taskSource.create(task),
      read: loopTaskStore.readLoopTaskRecord,
      save: (task) => { assert.ok(updateLoopTaskRecord(task.id, task), "production owner update must persist"); },
      remove: (taskId) => { assert.equal(taskSource.deleteTaskRecord(taskId), true, "production owner delete must persist"); },
    };
  } });
  const directory = path.join(fixture.rootDir, "department");
  const store = new DepartmentRuntimeStore(directory);
  const targets = new Map<string, PromptRunTarget>([["director", { tabId: "director", cli: "codex", sessionId: `director-${rootTaskId}` }]]);
  const notices: string[] = [], directorPrompts: PromptRunInput[] = [];
  const directorProgressRefreshes: number[] = [];
  const configuration: DepartmentConfigurationState = { routes: { director: { cli: "codex", configId: "profile", model: "director" },
    leader: { cli: "codex", configId: "profile", model: "leader" }, employee: { cli: "codex", configId: "profile", model: "employee" } },
    limits: { maxLeaders: 4, maxEmployees: 1 }, loopPlusAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot() };
  const update = (id: string, patch: Partial<LoopTaskRecord>) => updateLoopTaskRecord(id, patch);
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
    refreshOpenLoopGroupChatPanelForTask: (id) => {
      if (id === rootTaskId) directorProgressRefreshes.push(resolveLoopPanelProgressPercent(fixture.readTask(id)!));
    },
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
    runtime: fixture.adapter, store, workspaceKey: () => workspace, readTask: fixture.readTask, updateTask: update,
    prepareRoutes: async () => { prepares?.(); }, validateRoutes: () => true,
    resolveTarget: (id) => targets.get(id ?? "director") ?? null,
    taskForTarget: (id) => {
      const target = targets.get(id ?? "director");
      if (!target) return null;
      for (const file of taskSource.listTaskStoreFiles()) {
        const match = loopTaskStore.readLoopTaskStore(file).tasks.find((task) => task.sessionId === target.sessionId);
        if (match) return match;
      }
      return null;
    },
    resolveTargetForRoot: (root) => [...targets.values()].find((target) => target.sessionId === root.sessionId) ?? null,
    createRoot: (input, target, config) => {
      const id = rootTaskId;
      const task: LoopTaskRecord = { id, cli: target.cli, sessionId: target.sessionId, workspaceKey: workspace, taskStoreFile: fixture.storeFile,
        rootPrompt: input.displayPrompt, schedulingMode: "classic", status: "running", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20,
        currentRound: 0, communicationDir: fixture.rootDir, mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
        subTasks: [], rounds: [], supplementalRequirements: [], completionRoundSummaries: [], completionRequirementCoverage: [],
        department: { version: 1, rootTaskId: id, parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "部门", routes: config.routes, limits: config.limits },
        loopPlusAcceptancePlan: config.loopPlusAcceptancePlan, modelRouting: { main: config.routes.director, subtask: config.routes.employee } };
      return taskSource.create(prepareDepartmentTaskRecord(task, task.department!, config.loopPlusAcceptancePlan));
    },
    createLeaderTarget: () => { const id = `${rootTaskId}-leader-${++sequence}`, target = { tabId: id, cli: "codex" as const, sessionId: `${id}-session` }; targets.set(id, target); return target; },
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
  const start = (displayPrompt = "实现账号和报表模块") => composition.startDepartmentPrompt({ targetTabId: "director", cli: "codex", displayPrompt, modelPrompt: "实现目标", contextTags: [], departmentConfiguration: configuration });
  const dispatch = (prefix: string, count = 1) => fixture.queueMain((input, tab) => fixture.publish(input, tab, { status: "end", content: JSON.stringify({ status: "dispatch",
    subtasks: Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, title: `${prefix}-${i}`, prompt: `Implement ${prefix}-${i}, report all changes and relevant verification evidence to the real department leader.`, taskType: "general", writeFiles: [] })) }) }));
  const finish = () => fixture.queueMain((input, tab) => {
    const event = input.displayPrompt.match(/Current review eventId: (\S+)/)?.[1];
    fixture.publish(input, tab, { status: "end", content: JSON.stringify(withLoopPlusAcceptReviews({ status: "completed", progressPercent: 100,
      ...(event && event !== "(none)" ? { reviewEventId: event } : {}), finalSummary: "模块已完成", answerConclusion: "完成",
      acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "module", passed: true }] })) });
  });
  return { fixture, composition, deps, store, directory, targets, notices, directorPrompts, directorProgressRefreshes, configuration, start, dispatch, finish,
    decide: (next: typeof decision) => { decision = next; }, prepare: (next: () => void) => { prepares = next; }, workspace: (value: string) => { workspace = value; },
    taskSource,
    rootTaskId,
    initialTaskFileCount,
    taskFile: (taskId: string) => {
      const task = fixture.readTask(taskId);
      assert.ok(task, `task ${taskId} must be present before resolving its persisted file`);
      return task.taskStoreFile;
    },
    dispose: () => { composition.dispose(); fixture.dispose(); } };
}
const modulePrompt = (id: string) => ({ id, title: id, prompt: `负责完整${id}模块，向总监反馈依赖；复用真实Loop+完成实现和统一验收。保持独立任务及会话，在执行期间报告跨组依赖，不要等待所有组长结束才反馈。实现接口、界面和必要验证，并报告实际修改路径、结果以及未完成边界。` });

test("a settled leader frees the next batch and director JSON refreshes group chat progress", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.configuration.limits.maxLeaders = 1;
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts")] });
  h.dispatch("accounts");
  await h.start();
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().includes("accounts-0"), "first leader started");
  await waitForLoopPlus(() => h.directorPrompts.some((input) => input.modelPrompt.includes("组长可用名额：0 / 1")), "held leader slot in director prompt");
  assert.match(h.directorPrompts[0].modelPrompt, /subtasks 只列本轮要启动的模块/u);
  assert.match(h.directorPrompts[0].modelPrompt, /组长可用名额：1 \/ 1/u);
  assert.deepEqual(h.fixture.readTask(h.rootTaskId)?.subTasks.map((module) => module.id), ["accounts"]);

  h.decide({ status: "continue", progressPercent: 55, subtasks: [modulePrompt("reports")] });
  h.finish(); h.dispatch("reports");
  h.fixture.finishParked("accounts-0", { status: "end", content: "账号实现和验证已完成" });
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().includes("reports-0"), "settlement woke the second batch");
  assert.ok(h.directorPrompts.some(({ modelPrompt }) => modelPrompt.includes("组长可用名额：1 / 1")
    && modelPrompt.includes('"moduleId": "accounts"') && modelPrompt.includes('"organizationStatus": "completed"')));
  assert.equal(h.fixture.readTask(h.rootTaskId)?.loopProgressPercent, 55);
  assert.ok(h.directorProgressRefreshes.includes(55));
  assert.deepEqual(h.fixture.readTask(h.rootTaskId)?.subTasks.map((module) => module.id), ["accounts", "reports"]);
  assert.equal(h.composition.host.canCompleteRoot(h.rootTaskId), false);

  await waitForLoopPlus(() => h.directorPrompts.some(({ modelPrompt }) => modelPrompt.includes("组长可用名额：0 / 1")
    && modelPrompt.includes('"moduleId": "reports"')), "second occupied slot in director prompt");
  h.decide({ status: "waiting", progressPercent: 62, finalSummary: "等待报表组长汇报" });
  h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.directorProgressRefreshes.includes(62), "waiting decision repaints director progress");
  assert.equal(h.fixture.readTask(h.rootTaskId)?.loopProgressPercent, 62);
  assert.equal(h.fixture.readTask(h.rootTaskId)?.status, "running");
  assert.ok(h.directorPrompts.some(({ modelPrompt }) => modelPrompt.includes("当前总体进度：55%")));

  h.decide({ status: "completed", answerConclusion: "账号和报表均已交付", finalSummary: "根据两轮汇报确认完成" });
  h.finish();
  h.fixture.finishParked("reports-0", { status: "end", content: "报表实现和验证已完成" });
  await waitForLoopPlus(() => h.fixture.readTask(h.rootTaskId)?.status === "completed", "director completed after both batches");
  assert.equal(h.fixture.readTask(h.rootTaskId)?.loopProgressPercent, 100);
  assert.ok(h.directorProgressRefreshes.includes(100));
});

test("production director can finish a cohesive single-group task with spare leader slots", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.decide({ status: "continue", subtasks: [{ id: "account-validation", title: "账号校验", prompt: "修复账号校验中的空值处理，保持现有账号规则及有效输入的结果一致。负责修改校验和对应的测试，覆盖空值及正常账号的结果，检查其它校验分支是否受到影响，并在完成后向总监报告实际修改范围和验证结果。" }] });
  h.dispatch("account-validation");
  await h.start("修复一处账号校验并验证");
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().includes("account-validation-0"), "single group started");
  await waitForLoopPlus(() => h.directorPrompts.some(({ modelPrompt }) => modelPrompt.includes("组长可用名额：3 / 4")), "spare leader slots");
  assert.match(h.directorPrompts[0].modelPrompt, /只有一个合适模块时只填一项/u);
  assert.match(h.directorPrompts[0].modelPrompt, /prompt 至少 80 个字符/u);
  assert.deepEqual(h.composition.readCapacity(h.rootTaskId)?.leaders, ["account-validation"]);

  h.decide({ status: "completed", finalSummary: "账号校验已修复并验证" });
  h.finish();
  h.fixture.finishParked("account-validation-0", { status: "end", content: "修复及验证完成" });
  await waitForLoopPlus(() => h.fixture.readTask(h.rootTaskId)?.status === "completed", "single group settled");
  assert.deepEqual(h.fixture.readTask(h.rootTaskId)?.subTasks.map((module) => module.id), ["account-validation"]);
});

test("production composition starts classic director and two real Loop+ leaders with shared persisted employee capacity and cleanup", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts"), modulePrompt("reports")] });
  h.dispatch("accounts", 3); h.dispatch("reports", 2);
  await h.start();
  await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 3, "two real leaders sharing one regular slot and one overflow each");
  assert.match(h.directorPrompts[0].modelPrompt, /把本轮可并行的模块放进同一个 subtasks 数组/u);
  assert.match(h.directorPrompts[0].modelPrompt, /组长可用名额：4 \/ 4/u);
  const snapshot = h.composition.host.runtimeSnapshot(h.rootTaskId)!;
  assert.equal(snapshot.leaders.length, 2);
  const capacity = h.composition.readCapacity(h.rootTaskId)!;
  assert.equal(capacity.leaders.length, 2); assert.equal(capacity.employees.length, 3); assert.equal(capacity.employeeOverflow?.length, 2);
  assert.equal(h.fixture.rootsCreated.length, 3, "waiting attempts create no execution resources");
  for (const member of snapshot.leaders) {
    const task = h.fixture.readTask(member.taskId)!;
    assert.equal(task.schedulingMode, "event_driven"); assert.notEqual(task.sessionId, "director-session");
    assert.deepEqual(task.loopPlusAcceptancePlan, h.configuration.loopPlusAcceptancePlan);
    assert.equal(task.modelRouting?.main.model, "leader"); assert.equal(task.modelRouting?.subtask.model, "employee");
  }
  assert.ok(h.directorPrompts[0].modelPrompt.includes("总监不检查代码、不执行验收"));
  assert.ok(h.fixture.mainCalls.every((input) => input.modelPrompt.includes("真实、独立的 Loop+")));
  assert.ok(h.fixture.attemptCalls.every((input) => input.model === "employee" && input.modelPrompt.includes("产研部员工")));
  assert.equal(h.composition.host.canCompleteRoot(h.rootTaskId), false);
  h.decide({ status: "completed", finalSummary: "过早完成" }); h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.notices.some((n) => n.includes("完成被组织门禁拒绝")), "pre-commit organization completion gate");
  assert.equal(h.fixture.readTask(h.rootTaskId)?.status, "running");
  h.fixture.setHoldAbort(true);
  const stopped = h.composition.organizationControl.stop(h.fixture.readTask(h.rootTaskId)!);
  await waitForLoopPlus(() => h.fixture.cancelledTabs.length === 3, "real cancellation requested");
  assert.equal(h.composition.readCapacity(h.rootTaskId)?.employees.length, 3);
  for (const id of [...h.fixture.parkedSubtaskIds()]) h.fixture.finishParked(id, { status: "stopped" });
  await stopped;
  assert.equal(h.composition.readCapacity(h.rootTaskId)?.employees.length, 0);
  assert.equal(h.composition.readCapacity(h.rootTaskId)?.leaders.length, 0);
  const saved = h.store.read(h.rootTaskId, "workspace"); assert.ok(saved.ok && saved.value);
  if (saved.ok) { assert.equal(saved.value?.capacity.employees.length, 0); assert.equal(saved.value?.capacity.leaders.length, 0); }
});

test("production director coordinates a running leader request once, then confirms actual accepted completion", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts"), modulePrompt("reports")] }); h.dispatch("accounts"); h.dispatch("reports");
  await h.start(); await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 2, "running employees");
  const [source, target] = h.composition.host.runtimeSnapshot(h.rootTaskId)!.leaders;
  // Actual leader main decision port, with source/root bound by the adapter/organization host.
  h.fixture.queueMain((input, tab) => h.fixture.publish(input, tab, { status: "end", content: JSON.stringify({ status: "wait",
    departmentCollaborations: [{ id: "collaboration-1", targetLeaderTaskId: target.taskId, body: "报表请配合账号字段" }] }) }));
  assert.equal(h.fixture.adapter.host().submitUserMessage(source.taskId, "需要跨组配合"), true);
  await waitForLoopPlus(() => h.composition.host.runtimeSnapshot(h.rootTaskId)?.collaborations.length === 1, "leader feedback wakes director while both leaders are running");
  await waitForLoopPlus(() => h.directorPrompts.some((input) => input.modelPrompt.includes('"coordination": "awaiting-director"')), "pending collaboration reaches real director CLI input");
  assert.ok(h.directorPrompts[h.directorPrompts.length - 1]!.modelPrompt.includes("报表请配合账号字段"));
  assert.equal(h.composition.host.runtimeSnapshot(h.rootTaskId)!.collaborations[0].coordination, "awaiting-director");
  assert.equal(h.fixture.readTask(target.taskId)?.supplementalRequirements?.includes("报表请配合账号字段"), false);
  h.fixture.queueMain((input, tab) => h.fixture.publish(input, tab, { status: "end", content: JSON.stringify({ status: "wait" }) }));
  h.decide({ status: "blocked", finalSummary: "协调已完成，等待汇报", directorCollaborations: [{ id: "collaboration-1", action: "deliver" }] });
  h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.composition.host.runtimeSnapshot(h.rootTaskId)?.collaborations[0]?.status === "delivered", "trusted director delivery");
  assert.equal(h.composition.host.coordinateCollaboration(source.taskId, { id: "collaboration-1", targetLeaderTaskId: target.taskId, body: "报表请配合账号字段" }).ok, true);
  assert.deepEqual(h.composition.host.processDirectorCollaboration(h.rootTaskId, "collaboration-1"), { ok: true });
  assert.equal(Object.values(h.fixture.readTask(target.taskId)?.departmentDeliveries ?? {}).filter((v) => v === "报表请配合账号字段").length, 1);
  assert.equal(h.composition.host.coordinateCollaboration(source.taskId, { id: "other", targetLeaderTaskId: "foreign", body: "拒绝跨部门" }).ok, false);
  h.finish(); h.fixture.finishParked("accounts-0", { status: "end", content: "账户完成" });
  await waitForLoopPlus(() => h.composition.host.runtimeSnapshot(h.rootTaskId)?.leaders.find((m) => m.taskId === source.taskId)?.status === "completed", "source acceptance and real lifecycle cleanup");
  await waitForLoopPlus(() => h.directorPrompts.some((input) => input.modelPrompt.includes('"organizationStatus": "completed"')), "single finished leader wakes actual director prompt while sibling still runs");
  const reportPrompt = h.directorPrompts[h.directorPrompts.length - 1]!.modelPrompt;
  assert.ok(reportPrompt.includes(`"leaderTaskId": "${source.taskId}"`));
  assert.ok(reportPrompt.includes('"moduleId": "accounts"'));
  assert.ok(reportPrompt.includes('"title": "accounts"'));
  assert.ok(reportPrompt.includes("负责完整accounts模块"));
  assert.ok(reportPrompt.includes('"finalReport": "模块已完成"'));
  assert.ok(reportPrompt.includes('"answerConclusion": "完成"'));
  assert.ok(reportPrompt.includes(`"leaderTaskId": "${target.taskId}"`));
  assert.ok(reportPrompt.includes('"organizationStatus": "running"'));
  assert.ok(reportPrompt.includes('"taskStatus": "running"'));
  assert.equal(h.fixture.readTask(target.taskId)?.status, "running");
  h.finish(); h.fixture.finishParked("reports-0", { status: "end", content: "报表完成" });
  await waitForLoopPlus(() => h.composition.host.canCompleteRoot(h.rootTaskId), "all real Loop+ acceptance gates clear");
  updateLoopTaskRecord(h.rootTaskId, { activeSubtaskId: "accounts", activeSubtaskIds: ["accounts", "reports"], loopProgressPercent: 30, estimatedRemainingRounds: 9 });
  const roundSummaries = [{ round: 1, title: "两组汇报", summary: "模块分别完成并通过各自Loop+验收" }];
  const requirementCoverage = [{ name: "账号和报表", passed: true }];
  h.decide({ status: "completed", answerConclusion: "账号与报表均可使用", finalSummary: "根据两位组长汇报确认整体完成", roundSummaries, requirementCoverage }); h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.fixture.readTask(h.rootTaskId)?.status === "completed", "director completion commit");
  const disk = JSON.parse(fs.readFileSync(h.taskFile(h.rootTaskId), "utf8")).tasks.find((task: LoopTaskRecord) => task.id === h.rootTaskId) as LoopTaskRecord;
  assert.equal(disk.answerConclusion, "账号与报表均可使用");
  assert.equal(disk.finalSummary, "根据两位组长汇报确认整体完成");
  assert.equal(disk.loopProgressPercent, 100); assert.equal(disk.estimatedRemainingRounds, 0);
  assert.equal(disk.activeSubtaskId, null); assert.deepEqual(disk.activeSubtaskIds, []);
  assert.deepEqual(disk.completionRoundSummaries, roundSummaries);
  assert.deepEqual(disk.completionRequirementCoverage, requirementCoverage);
});

test("production start rechecks target/workspace after route await before creating a task", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.prepare(() => h.workspace("another-workspace"));
  await assert.rejects(h.start(), /已变化/);
  assert.equal(h.taskSource.listTaskStoreFiles().length, h.initialTaskFileCount);
  assert.equal(h.fixture.mainCalls.length, 0); assert.equal(h.fixture.rootsCreated.length, 0);
});

test("production runtime persistence failure fences new work and restart cannot invent completed execution observations", async (t) => {
  const h = harness(); t.after(h.dispose);
  await h.start(); await waitForLoopPlus(() => h.directorPrompts.length > 0, "director initial turn");
  const root = h.fixture.readTask(h.rootTaskId)!;
  h.composition.dispose();
  const saved = h.store.read(root.id, root.workspaceKey); assert.ok(saved.ok && saved.value);
  fs.renameSync(h.directory, `${h.directory}-saved`); fs.writeFileSync(h.directory, "not a directory");
  const next = createDepartmentRuntimeComposition(h.deps); t.after(next.dispose);
  assert.throws(() => next.recoverRoot(root), /ENOTDIR|快照|部门/);
  assert.equal(next.readCapacity(root.id), null);
  fs.unlinkSync(h.directory); fs.renameSync(`${h.directory}-saved`, h.directory);
  // Registering/recovering empty, verified saved state remains possible; an unknown live leader does not.
  next.recoverRoot(root);
  assert.equal(next.host.canCompleteRoot(root.id), false, "unstarted modules/empty organization cannot finish");
});

test("production restart retains stored live occupancy when a fresh adapter cannot observe cleanup", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts")] }); h.dispatch("accounts");
  await h.start(); await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "live employee before restart");
  const root = h.fixture.readTask(h.rootTaskId)!, before = h.store.read(root.id, root.workspaceKey);
  const fresh = createLoopPlusRuntimeFixture({ configId: "profile" }); t.after(fresh.dispose);
  const restarted = createDepartmentRuntimeComposition({ ...h.deps, runtime: fresh.adapter,
    inspectLeaderSession: (task) => { const target = [...h.targets.values()].find((target) => target.sessionId === task.sessionId)!; return { target, live: fresh.adapter.observeTask?.(task.id) ?? null }; },
    observeRestoredExecution: (task, attempt) => fresh.adapter.observeAttempt?.(task.id, attempt.subtaskId, attempt.attemptId) ?? null });
  t.after(restarted.dispose);
  assert.throws(() => restarted.recoverRoot(root), /live-leader-unverifiable/);
  assert.deepEqual(h.store.read(root.id, root.workspaceKey), before);
  assert.equal(restarted.readCapacity(root.id)?.employees.length, 1);
  assert.equal(restarted.host.canCompleteRoot(root.id), false);
  assert.equal((await restarted.host.startLeader(root.id, { leaderSubtaskId: "accounts", moduleTitle: "accounts", prompt: "禁止重启存活执行" })).ok, false);
  assert.equal(fresh.mainCalls.length, 0); assert.equal(fresh.rootsCreated.length, 0);
  await h.composition.organizationControl.stop(root);
});

test("production stop closes admission before an asynchronous director cancellation and still drains children on cancellation failure", async (t) => {
  let rejectStop!: (error: Error) => void;
  const directorStop = new Promise<void>((_resolve, reject) => { rejectStop = reject; });
  const h = harness({ stopDirector: () => directorStop }); t.after(h.dispose);
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts")] }); h.dispatch("accounts");
  await h.start(); await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "running employee");
  h.fixture.setHoldAbort(true);
  const stopping = h.composition.organizationControl.stop(h.fixture.readTask(h.rootTaskId)!);
  assert.equal(h.composition.host.runtimeSnapshot(h.rootTaskId)?.stopping, true);
  assert.equal(h.fixture.readTask(h.rootTaskId)?.status, "stopped");
  assert.equal((await h.composition.host.startLeader(h.rootTaskId, { leaderSubtaskId: "accounts", moduleTitle: "accounts", prompt: "不能新派发" })).ok, false);
  await waitForLoopPlus(() => h.fixture.cancelledTabs.length > 0, "child cancellation does not wait for director");
  assert.equal(h.composition.readCapacity(h.rootTaskId)?.employees.length, 1);
  h.fixture.finishParked("accounts-0", { status: "stopped" });
  rejectStop(new Error("director cancellation failure"));
  await assert.rejects(stopping, /未核验/);
  assert.equal(h.composition.readCapacity(h.rootTaskId)?.employees.length, 0);
  assert.equal(h.composition.readCapacity(h.rootTaskId)?.leaders.length, 0);
});

test("production occupancy persistence failure refuses a newly granted employee before resources exist", async (t) => {
  const h = harness(); t.after(h.dispose);
  const write = h.store.write.bind(h.store);
  let rejectedWrites = 0;
  h.store.write = (value) => {
    if (value.capacity.employees.length) { rejectedWrites++; return { ok: false, error: "injected disk failure" }; }
    return write(value);
  };
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts")] }); h.dispatch("accounts");
  await h.start();
  await waitForLoopPlus(() => rejectedWrites > 0 && h.composition.readCapacity(h.rootTaskId)?.employees.length === 0, "failed occupancy commit returned its unstarted lease");
  assert.equal(h.fixture.rootsCreated.length, 0); assert.equal(h.fixture.attemptCalls.length, 0);
  assert.equal(h.composition.host.canCompleteRoot(h.rootTaskId), false);
  h.store.write = write;
  await h.composition.organizationControl.stop(h.fixture.readTask(h.rootTaskId)!);
});

test("production director consumes the existing clarification port before another model turn", async (t) => {
  let answered = false;
  const h = harness({ waitForDirectorClarification: async (task) => {
    answered = true;
    updateLoopTaskRecord(task.id, { pendingClarification: undefined, supplementalRequirements: ["用户明确范围"] });
    return true;
  } }); t.after(h.dispose);
  h.decide({ status: "clarify", estimatedRemainingRounds: 2, finalSummary: "请确认范围", clarification: {
    interactionId: "department-scope", title: "确认范围", instruction: "选择范围", submitLabel: "提交", cancelLabel: "拒绝",
    formFields: [{ id: "scope", label: "范围", type: "text", required: true }],
  } });
  await h.start();
  await waitForLoopPlus(() => answered && h.directorPrompts.length >= 2, "clarification answered through existing host port");
  assert.equal(h.fixture.readTask(h.rootTaskId)?.pendingClarification, undefined);
  assert.equal(h.fixture.rootsCreated.length, 0);
  assert.deepEqual(h.composition.host.runtimeSnapshot(h.rootTaskId)?.acknowledgedRootRequirements, ["用户明确范围"]);
});

test("ordinary group-chat fallback reads only an already known file and refuses department or corrupt identities", async (t) => {
  const h = harness(); t.after(h.dispose);
  await h.start();
  const { readKnownOrdinaryLoopTaskRecord } = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
  assert.equal(readKnownOrdinaryLoopTaskRecord("unknown-record"), null);
  assert.equal(readKnownOrdinaryLoopTaskRecord(h.rootTaskId), null);
  const ordinary = { ...h.fixture.readTask(h.rootTaskId)!, id: "ordinary", department: undefined };
  ordinary.taskStoreFile = loopTaskStore.buildLoopTaskStoreFile("codex", ordinary.workspaceKey, null, ordinary.id);
  assert.equal(loopTaskStore.tryWriteLoopTaskStore(ordinary.taskStoreFile, { tasks: [ordinary] }), true);
  assert.equal(readKnownOrdinaryLoopTaskRecord("ordinary")?.id, "ordinary");
  fs.writeFileSync(ordinary.taskStoreFile, "{broken");
  assert.equal(readKnownOrdinaryLoopTaskRecord("ordinary"), null);
});

test("production freezes omitted thinking defaults once and preserves explicit Claude off and exact OpenCode variant", (t) => {
  const h = harness(); t.after(h.dispose);
  const configured = structuredClone(h.configuration);
  configured.routes.leader = { cli: "claude", configId: "claude-profile", thinkingMode: "off" };
  configured.routes.employee = { cli: "opencode", configId: "open-profile", model: "provider/model", openCodeVariant: "exact-variant" };
  let defaults = 0;
  const frozen = freezeDepartmentThinkingDefaults(configured, () => { defaults++; return "high"; });
  assert.equal(defaults, 1); assert.equal(frozen.routes.director.thinkingMode, "high");
  assert.equal(frozen.routes.leader.thinkingMode, "off"); assert.equal(frozen.routes.employee.thinkingMode, undefined);
  assert.equal(frozen.routes.employee.openCodeVariant, "exact-variant");
  configured.routes.director.model = "changed-visible-model";
  assert.equal(frozen.routes.director.model, "director"); assert.equal(h.configuration.routes.director.thinkingMode, undefined);
});

test("department collaboration intent keeps normal wait parsing and cannot authorize review or completion", () => {
  const { normalizeLoopPlusDecision } = require("../../loopPlusDecision") as typeof import("../../loopPlusDecision");
  const message = { id: "stable", targetLeaderTaskId: "leader-target", body: "协调需求" };
  assert.deepEqual(normalizeLoopPlusDecision({ status: "wait", departmentCollaborations: [message] })?.departmentCollaborations, [message]);
  for (const invalid of [null, {}, { ...message, body: [] }, { ...message, id: " " }, { ...message, targetLeaderTaskId: null }]) {
    assert.equal(normalizeLoopPlusDecision({ status: "wait", departmentCollaborations: [invalid] }), null);
  }
  assert.equal(normalizeLoopPlusDecision({ status: "wait", departmentCollaborations: [message, message] }), null);
  assert.equal(normalizeLoopPlusDecision({ status: "blocked", departmentCollaborations: [message] }), null);
  assert.equal(normalizeLoopPlusDecision({ status: "wait", reviewEventId: "unreviewed", departmentCollaborations: [message] }), null);
});

test("central stop and continuation preserve the real leader task and frozen routing despite changed new-root choices", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts")] }); h.dispatch("accounts");
  await h.start(); await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "employee started");
  const member = h.composition.host.runtimeSnapshot(h.rootTaskId)!.leaders[0];
  const frozen = h.fixture.readTask(member.taskId)!.department!;
  await h.composition.organizationControl.stop(h.fixture.readTask(h.rootTaskId)!);
  assert.equal(h.composition.readCapacity(h.rootTaskId)?.leaders.length, 0);
  h.configuration.routes.leader.model = "unrelated-new-root-model";
  h.configuration.routes.employee.model = "unrelated-new-root-employee";
  h.decide({ status: "blocked", finalSummary: "继续按既有模块协调" });
  await h.composition.continueDepartmentPrompt({ targetTabId: "director", cli: "codex", displayPrompt: "继续既有组织", modelPrompt: "继续", contextTags: [] });
  assert.equal(h.fixture.readTask(h.rootTaskId)?.status, "running");
  assert.equal(h.composition.host.runtimeSnapshot(h.rootTaskId)?.leaders[0].taskId, member.taskId);
  assert.deepEqual(h.fixture.readTask(member.taskId)?.department, frozen);
  assert.equal(h.composition.host.runtimeSnapshot(h.rootTaskId)?.leaders.length, 1);
  await h.composition.organizationControl.stop(h.fixture.readTask(h.rootTaskId)!);
});

test("central director model failure pauses observably and resumes without treating it as a corrupt runtime snapshot", async (t) => {
  const h = harness(); t.after(h.dispose);
  const run = h.deps.runDirectorDecision;
  let fail = true;
  h.deps.runDirectorDecision = async (request) => { if (fail) { fail = false; throw new Error("injected model failure"); } return run(request); };
  await h.start();
  await waitForLoopPlus(() => h.fixture.readTask(h.rootTaskId)?.status === "needs-review", "director pause recorded");
  assert.ok(h.notices.some((notice) => notice.includes("injected model failure")));
  await h.composition.continueDepartmentPrompt({ targetTabId: "director", cli: "codex", displayPrompt: "继续协调", modelPrompt: "继续协调", contextTags: [] });
  await waitForLoopPlus(() => h.directorPrompts.length > 0, "director resumed");
  assert.equal(h.fixture.readTask(h.rootTaskId)?.status, "running");
  assert.equal(h.fixture.rootsCreated.length, 0);
});

async function readyForDirectorCompletion(h: ReturnType<typeof harness>): Promise<void> {
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts")] }); h.finish();
  await h.start();
  await waitForLoopPlus(() => h.composition.host.canCompleteRoot(h.rootTaskId), "real accepted leader and cleanup permit completion");
}

test("director real prompt discloses failed, missing and invalid reports and unstarted modules without UI evidence", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts")] }); h.dispatch("accounts");
  await h.start(); await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 1, "real running leader");
  const member = h.composition.host.runtimeSnapshot(h.rootTaskId)!.leaders[0];
  const root = h.fixture.readTask(h.rootTaskId)!;
  updateLoopTaskRecord(h.rootTaskId, { subTasks: [...root.subTasks, { id: "unstarted", title: "尚未分派模块", prompt: "尚未完成的要求", status: "pending" }] });
  updateLoopTaskRecord(member.taskId, { status: "error", answerConclusion: undefined, finalSummary: "数据库依赖失败，需要协调" });
  let count = h.directorPrompts.length;
  h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.directorPrompts.length > count, "failed report in real prompt");
  let prompt = h.directorPrompts[h.directorPrompts.length - 1].modelPrompt;
  assert.ok(prompt.includes("数据库依赖失败，需要协调")); assert.ok(prompt.includes("失败或阻塞"));
  assert.ok(prompt.includes('"taskStatus": "error"')); assert.ok(prompt.includes('"moduleId": "unstarted"'));
  assert.ok(prompt.includes("模块尚未启动，不得整体完成"));
  updateLoopTaskRecord(member.taskId, { finalSummary: undefined });
  count = h.directorPrompts.length; h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.directorPrompts.length > count, "missing report in actual prompt");
  assert.ok(h.directorPrompts[h.directorPrompts.length - 1].modelPrompt.includes("实际汇报不可用，不得视为完成"));
  const memberFile = h.taskFile(member.taskId);
  const savedMemberFile = fs.readFileSync(memberFile, "utf8");
  const savedMemberStore = JSON.parse(savedMemberFile);
  fs.writeFileSync(memberFile, JSON.stringify({ ...savedMemberStore, tasks: savedMemberStore.tasks.map((task: LoopTaskRecord) => task.id === member.taskId
    ? { ...task, workspaceKey: "foreign", finalSummary: "不得泄漏的异部门汇报" } : task) }));
  count = h.directorPrompts.length; h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.directorPrompts.length > count, "invalid association not report evidence");
  prompt = h.directorPrompts[h.directorPrompts.length - 1].modelPrompt;
  assert.ok(prompt.includes("真实身份或记录不可核验")); assert.equal(prompt.includes("不得泄漏的异部门汇报"), false);
  assert.equal(h.composition.host.canCompleteRoot(h.rootTaskId), false);
  fs.writeFileSync(memberFile, savedMemberFile);
  // A genuinely missing disk record also stays unavailable, without scanning other tasks.
  const disk = JSON.parse(savedMemberFile);
  fs.writeFileSync(memberFile, JSON.stringify({ ...disk, tasks: disk.tasks.filter((task: LoopTaskRecord) => task.id !== member.taskId) }));
  count = h.directorPrompts.length; h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.directorPrompts.length > count, "missing record in actual prompt");
  assert.ok(h.directorPrompts[h.directorPrompts.length - 1].modelPrompt.includes("真实身份或记录不可核验"));
  fs.writeFileSync(memberFile, savedMemberFile);
  await h.composition.organizationControl.stop(h.fixture.readTask(h.rootTaskId)!);
});

test("director summaries stay bounded and explicitly count pending work beyond the context budget", async (t) => {
  const h = harness(); t.after(h.dispose);
  h.decide({ status: "continue", subtasks: [modulePrompt("accounts"), modulePrompt("reports")] }); h.dispatch("accounts"); h.dispatch("reports");
  await h.start(); await waitForLoopPlus(() => h.fixture.parkedSubtaskIds().length === 2, "two actual leaders");
  const [source, target] = h.composition.host.runtimeSnapshot(h.rootTaskId)!.leaders;
  for (let i = 0; i < 35; i++) assert.equal(h.composition.host.coordinateCollaboration(source.taskId,
    { id: `bounded-${i}`, targetLeaderTaskId: target.taskId, body: "待协调内容".repeat(500) }).ok, true);
  let count = h.directorPrompts.length; h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.directorPrompts.length > count, "bounded pending context in actual runPrompt");
  const prompt = h.directorPrompts[h.directorPrompts.length - 1].modelPrompt;
  assert.ok(prompt.length < 25000); assert.ok(prompt.includes("待处理协作=35"));
  assert.match(prompt, /长度限制未展开：模块=\d+；待处理协作=[1-9]\d*/);
  assert.ok(prompt.includes("未展开不代表已处理")); assert.equal(h.composition.host.canCompleteRoot(h.rootTaskId), false);
  await h.composition.organizationControl.stop(h.fixture.readTask(h.rootTaskId)!);
});

test("manual organization complete preserves classic fields without inventing a model answer and rechecks gates", async (t) => {
  const h = harness(); t.after(h.dispose); await readyForDirectorCompletion(h);
  const leader = h.composition.host.runtimeSnapshot(h.rootTaskId)!.leaders[0];
  const accepted = h.fixture.readTask(leader.taskId)!;
  updateLoopTaskRecord(leader.taskId, { answerConclusion: undefined, finalSummary: undefined });
  assert.equal(h.composition.host.canCompleteRoot(h.rootTaskId), false, "accepted status alone is not a readable report");
  h.fixture.saveTask(accepted);
  updateLoopTaskRecord(h.rootTaskId, { supplementalRequirements: ["尚未协调的补充"] });
  await assert.rejects(h.composition.organizationControl.complete(h.fixture.readTask(h.rootTaskId)!), /拒绝/);
  assert.equal(h.fixture.readTask(h.rootTaskId)?.status, "running");
  assert.equal(h.composition.host.acknowledgeRootRequirements(h.rootTaskId, ["尚未协调的补充"]), true);
  const summaries = [{ round: 1, title: "原汇报", summary: "保留原摘要" }];
  updateLoopTaskRecord(h.rootTaskId, { answerConclusion: undefined, finalSummary: "人工按汇报确认", activeSubtaskId: "accounts", activeSubtaskIds: ["accounts"],
    estimatedRemainingRounds: 3, completionRoundSummaries: summaries, completionRequirementCoverage: [{ name: "原覆盖", passed: true }] });
  await h.composition.organizationControl.complete(h.fixture.readTask(h.rootTaskId)!);
  const saved = JSON.parse(fs.readFileSync(h.taskFile(h.rootTaskId), "utf8")).tasks.find((task: LoopTaskRecord) => task.id === h.rootTaskId) as LoopTaskRecord;
  assert.equal(saved.status, "completed"); assert.equal(saved.answerConclusion, undefined);
  assert.equal(saved.finalSummary, "人工按汇报确认"); assert.equal(saved.loopProgressPercent, 100);
  assert.equal(saved.estimatedRemainingRounds, 0); assert.equal(saved.activeSubtaskId, null); assert.deepEqual(saved.activeSubtaskIds, []);
  assert.deepEqual(saved.completionRoundSummaries, summaries); assert.deepEqual(saved.completionRequirementCoverage, [{ name: "原覆盖", passed: true }]);
});

test("director completion disk write failure never publishes completion or clears the persistence gate", async (t) => {
  let completed = 0;
  const h = harness({ completed: () => { completed++; } });
  const rename = fs.renameSync;
  t.after(async () => { fs.renameSync = rename; await h.dispose(); });
  await readyForDirectorCompletion(h);
  const rootFile = h.taskFile(h.rootTaskId);
  // A read-only file does not refuse atomic replacement in a writable parent directory.
  // Reject the actual completion commit on every platform, retaining the original assertions.
  fs.renameSync = ((from, to) => {
    if (String(to) === rootFile
      && JSON.parse(fs.readFileSync(from, "utf8")).tasks.some((task: LoopTaskRecord) => task.id === h.rootTaskId && task.status === "completed")) {
      throw new Error("injected completion persistence failure");
    }
    rename(from, to);
  }) as typeof fs.renameSync;
  h.decide({ status: "completed", answerConclusion: "不能报告已保存", finalSummary: "故障完成写入" });
  h.composition.wakeDirector(h.rootTaskId);
  await waitForLoopPlus(() => h.notices.some((notice) => notice.includes("completion-persistence-failed")), "real production task write refused");
  const persistedAfterFailure = JSON.parse(fs.readFileSync(rootFile, "utf8")).tasks.find((task: LoopTaskRecord) => task.id === h.rootTaskId) as LoopTaskRecord;
  assert.equal(completed, 0); assert.equal(persistedAfterFailure.status, "running");
  assert.notEqual(persistedAfterFailure.answerConclusion, "不能报告已保存");
  assert.equal(h.composition.host.canCompleteRoot(h.rootTaskId), false);
  fs.renameSync = rename;
  assert.equal(h.composition.host.canCompleteRoot(h.rootTaskId), false, "repairing the writer alone is not persistence recovery");
});
