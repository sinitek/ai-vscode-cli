import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installVscodeMock } from "../vscodeMock";
import {
  loadPromptHistoryStore,
  recordPromptHistoryInStore,
  type PromptHistoryStore,
  type PromptHistoryStoreOptions,
} from "../../promptHistoryStore";

installVscodeMock();

const { buildLoopGroupChatPanelState, createLoopGroupChatPanelCoordinator } = require("../../panelDiagnostics") as typeof import("../../panelDiagnostics");
import type { LoopTaskRecord } from "../../loopTaskStore";
import { createLoopMainQuestionQueue } from "../../loopMainQuestionQueue";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { setTimeout as delay } from "node:timers/promises";

function createStoppedTask(): LoopTaskRecord {
  return {
    id: "task-1",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/task-1/loop-tasks.json",
    rootPrompt: "Resume with the latest runtime selection.",
    status: "stopped",
    createdAt: 1,
    updatedAt: 2,
    maxRounds: 20,
    currentRound: 2,
    communicationDir: "/tmp/task-1",
    mainCommunicationFile: "/tmp/task-1/main-task.md",
    sessionId: "codex-session",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

function createContinuationRecoveryHarness() {
  const task = createStoppedTask();
  task.schedulingMode = "event_driven";
  task.originProfile = { configId: "original-config" };
  task.modelRouting = { main: { model: "main-model" }, subtask: { model: "subtask-model" } };
  const messages: Array<{ type: string; canContinue?: boolean }> = [];
  const warnings: string[] = [];
  let runs = 0;
  let refreshes = 0;
  const panel = {
    getState: () => undefined,
    setAskThread: () => undefined,
    update: () => { refreshes += 1; },
    post: (message: { type: string; canContinue?: boolean }) => messages.push(message),
  };
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map([[task.id, panel as never]]),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: () => task,
    updateTaskRecord: () => task,
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "codex" }),
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => "original-config",
    getSelectedCliModel: () => "main-model",
    restoreOriginalLoopRuntime: async () => ({ ok: true, target: { tabId: "main-tab", cli: "codex" } }),
    runLoopPrompt: async () => { runs += 1; },
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: (message) => { warnings.push(message); },
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };
  return { task, deps, messages, warnings, coordinator: createLoopGroupChatPanelCoordinator(deps),
    get runs() { return runs; }, get refreshes() { return refreshes; } };
}

for (const running of [true, false]) {
  test(`switching task models ${running ? "does not interrupt running calls" : "automatically continues paused work"}`, async () => {
    const env = createContinuationRecoveryHarness();
    env.task.status = running ? "running" : "stopped";
    let resumed = 0;
    env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
    env.deps.collectRunningTaskIds = () => new Set(running ? [env.task.id] : []);
    env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
    env.deps.resumeLoopSubtasks = () => { resumed += 1; };
    const prompts: Array<Parameters<typeof env.deps.runLoopPrompt>[0]> = [];
    const runLoopPrompt = env.deps.runLoopPrompt;
    env.deps.runLoopPrompt = async (...args) => { prompts.push(args[0]); await runLoopPrompt(...args); };
    await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" }, { main: "xhigh", fullstack: "max" });
    await delay(0);
    assert.equal(env.task.modelRouting?.main.model, "new-model");
    assert.equal(env.task.modelRouting?.subtaskFullstack?.model, "new-model");
    assert.equal(env.task.originProfile?.mainThinkingMode, "xhigh");
    assert.equal(env.task.originProfile?.subtaskFullstackThinkingMode, "max");
    assert.equal(env.runs, running ? 0 : 1);
    if (!running) {
      assert.equal(prompts[0].loopMainThinkingMode, "xhigh");
      assert.equal(prompts[0].loopSubtaskFullstackThinkingMode, "max");
    }
    assert.equal(resumed, 1);
    assert.deepEqual(env.warnings, []);
    assert.ok(env.messages.some((message) => message.type === "loopGroupChatChat:switchModelsSettled"));
  });
}

for (const savedProfile of [true, false]) {
  test(`经典 Loop 继续先恢复子任务并在完成后保留继续说明，原档案=${savedProfile}`, async () => {
    const env = createContinuationRecoveryHarness();
    env.task.schedulingMode = "classic";
    if (!savedProfile) env.task.originProfile = undefined;
    const originalRouting = JSON.stringify(env.task.modelRouting);
    let resumed = 0;
    let resumeMain = () => undefined as void;
    const inputs: Array<Parameters<typeof env.deps.runLoopPrompt>[0]> = [];
    env.deps.resumeLoopSubtasks = (taskId, resume) => {
      assert.equal(taskId, env.task.id);
      resumed += 1;
      resumeMain = resume;
      return true;
    };
    env.deps.runLoopPrompt = async (prompt) => { inputs.push(prompt); };

    await env.coordinator.handleMessage(env.task.id, {
      type: "loopGroupChatChat:continueTask", prompt: "继续完成剩余子任务",
    } as never);
    assert.equal(resumed, 1);
    assert.equal(inputs.length, 0);
    env.task.status = "running";
    resumeMain();
    await delay(0);
    assert.equal(resumed, 1);
    assert.equal(inputs[0]?.loopContinuePrompt, "继续完成剩余子任务");
    assert.equal(JSON.stringify(env.task.modelRouting), originalRouting);
    assert.deepEqual(env.warnings, []);
  });
}

test("Loop+ 继续恢复中断子任务并保留继续消息，不直接重启主任务", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  const messages: string[] = [];
  let resumed = 0;
  env.deps.resumeLoopSubtasks = () => { resumed += 1; return true; };
  env.deps.notifyLoopPlusUserMessage = (_taskId, text) => { messages.push(text); };
  const before = JSON.stringify(env.task);
  await env.coordinator.continueTask(env.task.id, "继续完成剩余子任务");
  assert.equal(resumed, 1);
  assert.equal(env.runs, 0);
  assert.deepEqual(messages, ["继续完成剩余子任务"]);
  assert.equal(JSON.stringify(env.task), before);
  assert.ok(env.messages.some((message) => message.type === "loopGroupChatChat:continueTaskSettled"));
});

for (const reason of ["completed", "busy", "failure-limit", "restore-failed"] as const) {
  test(`继续执行在 ${reason} 时不启动子任务`, async () => {
    const env = createContinuationRecoveryHarness();
    let resumed = 0;
    env.deps.resumeLoopSubtasks = () => { resumed += 1; return true; };
    if (reason === "completed") env.task.status = "completed";
    if (reason === "busy") {
      env.task.status = "running";
      env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
      env.deps.isTabRunActive = () => true;
    }
    if (reason === "failure-limit") env.task.mainAiFailureLimitReached = true;
    if (reason === "restore-failed") {
      env.deps.restoreOriginalLoopRuntime = async () => ({ ok: false, message: "配置已失效" });
    }
    await env.coordinator.continueTask(env.task.id, "继续执行");
    assert.equal(resumed, 0);
    assert.equal(env.runs, 0);
    assert.ok(env.messages.some((message) => message.type === "loopGroupChatChat:continueTaskSettled"));
  });
}

test("子任务恢复异常后继续按钮收尾并允许重试", async () => {
  const env = createContinuationRecoveryHarness();
  env.deps.resumeLoopSubtasks = () => { throw new Error("子任务恢复失败"); };
  await env.coordinator.continueTask(env.task.id, "继续执行");
  assert.deepEqual(env.warnings, ["子任务恢复失败"]);
  assert.equal(env.runs, 0);
  env.deps.resumeLoopSubtasks = () => false;
  await env.coordinator.continueTask(env.task.id, "重试继续");
  assert.equal(env.runs, 1);
});

test("opening reveals before model preparation, coalesces clicks and reads the latest task", async () => {
  const env = createContinuationRecoveryHarness();
  const events: string[] = [];
  let releasePaint!: (ready: boolean) => void;
  const paint = new Promise<boolean>((resolve) => { releasePaint = resolve; });
  let releaseModels!: () => void;
  const models = new Promise<void>((resolve) => { releaseModels = resolve; });
  let shownPrompt = "";
  const panel = {
    showLoading: () => { events.push("reveal"); return paint; },
    setAskThread: () => undefined,
    show: (state: import("../../webview/loopGroupChatPanel").LoopGroupChatPanelState) => {
      events.push("show"); shownPrompt = state.task.rootPrompt;
    },
  };
  env.deps.panelsByTaskId.set(env.task.id, panel as never);
  env.deps.prepareModelSwitchOptions = async () => { events.push("models"); await models; };
  const first = env.coordinator.open(env.task.id);
  const second = env.coordinator.open(env.task.id);
  await delay(0);
  assert.deepEqual(events, ["reveal", "reveal"]);
  releasePaint(true);
  await delay(0);
  assert.equal(events.filter((event) => event === "models").length, 1);
  await env.coordinator.refresh(env.task.id);
  env.task.rootPrompt = "加载期间更新后的任务";
  releaseModels();
  await Promise.all([first, second]);
  assert.equal(shownPrompt, "加载期间更新后的任务");
  assert.equal(events.filter((event) => event === "show").length, 1);
});

for (const outcome of ["closed-before-paint", "closed-during-models", "failed"] as const) {
  test(`opening handles ${outcome} without reviving a disposed page`, async () => {
    const env = createContinuationRecoveryHarness();
    let shown = 0;
    let failed = 0;
    const panel = {
      showLoading: async () => outcome !== "closed-before-paint",
      getState: () => undefined,
      setAskThread: () => undefined,
      show: () => { shown += 1; },
      showLoadingError: () => { failed += 1; },
    };
    env.deps.panelsByTaskId.set(env.task.id, panel as never);
    env.deps.prepareModelSwitchOptions = async () => {
      if (outcome === "failed") throw new Error("读取模型失败");
      env.deps.panelsByTaskId.delete(env.task.id);
    };
    await env.coordinator.open(env.task.id);
    assert.equal(shown, 0);
    assert.equal(failed, outcome === "failed" ? 1 : 0);
  });
}

test("invalid thinking switch does not persist or resume any role", async () => {
  const env = createContinuationRecoveryHarness();
  let writes = 0;
  let resumed = 0;
  env.deps.updateTaskRecord = () => { writes += 1; return env.task; };
  env.deps.resumeLoopSubtasks = () => { resumed += 1; };
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  const before = JSON.stringify(env.task);
  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" }, { main: "foreign", fullstack: "max" });
  assert.equal(writes, 0);
  assert.equal(resumed, 0);
  assert.equal(env.runs, 0);
  assert.equal(JSON.stringify(env.task), before);
  assert.match(env.warnings[0], /思考力度已不可用/u);
});

test("invalid model switch does not write or resume a task", async () => {
  const env = createContinuationRecoveryHarness();
  let writes = 0;
  env.deps.updateTaskRecord = () => { writes += 1; return env.task; };
  env.deps.getLoopModelSwitchOptions = () => [{ value: "available", label: "可用模型" }];
  await env.coordinator.switchModels(env.task.id, { main: "foreign", fullstack: "available" });
  assert.equal(writes, 0);
  assert.equal(env.runs, 0);
  assert.equal(env.warnings.length, 1);
});

test("duplicate model submissions save and resume only once while options load", async () => {
  const env = createContinuationRecoveryHarness();
  let writes = 0;
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  env.deps.prepareModelSwitchOptions = () => gate;
  env.deps.updateTaskRecord = (_taskId, patch) => { writes += 1; return Object.assign(env.task, patch); };
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  const models = { main: "new-model", fullstack: "new-model" };
  const first = env.coordinator.switchModels(env.task.id, models);
  const second = env.coordinator.switchModels(env.task.id, models);
  release();
  await Promise.all([first, second]);
  await delay(0);
  assert.equal(writes, 1);
  assert.equal(env.runs, 1);
});

test("model switch resumes a cold task despite stale persisted running status", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  env.deps.resumeLoopSubtasks = () => false;
  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" });
  await delay(0);
  await delay(0);
  assert.equal(env.runs, 1);
  assert.deepEqual(env.warnings, []);
});

test("model switch can resume paused Loop+ control while a sibling child remains active", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "needs-review";
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  env.deps.resumeLoopSubtasks = () => false;
  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" });
  await delay(0);
  assert.equal(env.runs, 1);
  assert.deepEqual(env.warnings, []);
});

test("继续通过面板消息唤醒仍持有控制器但主模型空闲的 Loop+ 任务", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  let runOptions: Parameters<typeof env.deps.runLoopPrompt>[1] | undefined;
  env.deps.runLoopPrompt = async (_input, options) => { runOptions = options; };

  await env.coordinator.handleMessage(env.task.id, {
    type: "loopGroupChatChat:continueTask",
    prompt: "继续执行",
  } as never);

  assert.equal(env.runs, 0);
  assert.equal(runOptions?.resumeRequested, true);
  assert.equal(runOptions?.resumeUserMessage, "继续执行");
  assert.equal(env.messages.find((message) => message.type === "loopGroupChatChat:continueTaskSettled")?.canContinue, true);
  assert.deepEqual(env.warnings, []);
});

test("Loop+ 面板只在主模型空闲时显示继续入口，即使后台控制器仍存在", () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.task.loopPlus = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  const idle = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(idle.mainModelBusy, false);
  assert.equal(idle.loopPlus?.activity, "idle");
  assert.equal(idle.task.canContinue, true);

  env.deps.isTabRunActive = () => true;
  const busy = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(busy.mainModelBusy, true);
  assert.equal(busy.task.canContinue, false);
  assert.equal(busy.loopPlus?.activity, "running");
  assert.equal(busy.rounds[0]?.participants[0]?.status, "running");

  env.deps.isTabRunActive = () => false;
  env.deps.resolveMainPromptTarget = () => null;
  const inactive = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(inactive.loopPlus?.activity, "idle");
});

for (const outcome of ["ready", "error", "stopped"] as const) {
  test(`Loop+ 提问开始立即更新主任务活动，${outcome} 后恢复空闲`, async () => {
    const env = createContinuationRecoveryHarness();
    env.task.status = "running";
    env.task.loopPlus = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
    env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
    env.deps.normalizeSupplementalRequirement = (value) => typeof value === "string" ? value : null;
    let mainModelActive = false;
    env.deps.isTabRunActive = () => mainModelActive;
    type State = ReturnType<typeof buildLoopGroupChatPanelState>;
    const updates: State[] = [];
    const panel = env.deps.panelsByTaskId.get(env.task.id)!;
    panel.update = (state) => { updates.push(state); };
    panel.publishAskThread = () => undefined;
    let start: (() => void) | undefined;
    let finish: (() => void) | undefined;
    env.deps.askMainModel = async (_task, _question, hooks) => {
      start = () => hooks?.onStarted?.();
      await new Promise<void>((resolve) => { finish = resolve; });
      if (outcome === "error") throw new Error("回答失败");
      return { status: outcome, answer: "回答内容" };
    };
    const asking = env.coordinator.handleMessage(env.task.id, {
      type: "loopGroupChatChat:askMainModel", prompt: "当前进展如何？",
    } as never);
    await env.coordinator.refresh(env.task.id);
    assert.equal(updates.at(-1)?.loopPlus?.activity, "idle", "排队本身不代表模型正在回答");
    mainModelActive = true;
    start?.();
    assert.equal(updates.at(-1)?.loopPlus?.activity, "running");
    assert.equal(updates.at(-1)?.mainModelBusy, true);
    assert.equal(updates.at(-1)?.task.canContinue, false);
    await env.coordinator.refresh(env.task.id);
    assert.equal(updates.at(-1)?.rounds[0]?.participants[0]?.status, "running");
    mainModelActive = false;
    finish?.();
    await asking;
    assert.equal(updates.at(-1)?.loopPlus?.activity, "idle");
    assert.equal(updates.at(-1)?.mainModelBusy, false);
  });
}

test("切模型在没有可恢复子任务时会把继续消息交给主任务调度", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  env.deps.resumeLoopSubtasks = () => false;
  let runOptions: Parameters<typeof env.deps.runLoopPrompt>[1] | undefined;
  env.deps.runLoopPrompt = async (_input, options) => { runOptions = options; };

  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" });
  await delay(0);

  assert.equal(runOptions?.resumeRequested, true);
  assert.equal(runOptions?.resumeUserMessage, "run.hiddenContinuePrompt");
  assert.deepEqual(env.warnings, []);
});

test("model switch waits for resumed children before starting their parent", async () => {
  const env = createContinuationRecoveryHarness();
  env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  let resumeMain = () => undefined as void;
  env.deps.resumeLoopSubtasks = (_taskId, resume) => { resumeMain = resume; return true; };
  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" });
  assert.equal(env.runs, 0);
  env.task.status = "running";
  resumeMain();
  await delay(0);
  assert.equal(env.runs, 1);
});

test("failed original-runtime restoration settles continuation and allows a second attempt", async () => {
  const harness = createContinuationRecoveryHarness();
  const restore = harness.deps.restoreOriginalLoopRuntime;
  harness.deps.restoreOriginalLoopRuntime = async () => ({ ok: false, message: "执行中的任务尚未结束" });
  await harness.coordinator.continueTask(harness.task.id, "继续执行", "original");
  assert.deepEqual(harness.warnings, ["执行中的任务尚未结束"]);
  assert.deepEqual(harness.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: true }]);
  assert.equal(harness.runs, 0);
  assert.equal(harness.refreshes, 1);
  harness.deps.restoreOriginalLoopRuntime = restore;
  await harness.coordinator.continueTask(harness.task.id, "再次继续", "original");
  assert.equal(harness.runs, 1);
  assert.equal(harness.messages.length, 2);
});

for (const failureStage of ["restore", "run"] as const) {
  test(`unexpected ${failureStage} errors settle continuation and remain retryable`, async () => {
    const harness = createContinuationRecoveryHarness();
    const failure = async (): Promise<never> => { throw new Error("续跑启动异常"); };
    if (failureStage === "restore") harness.deps.restoreOriginalLoopRuntime = failure;
    else harness.deps.runLoopPrompt = failure;
    await harness.coordinator.continueTask(harness.task.id, "继续执行", "original");
    assert.deepEqual(harness.warnings, ["续跑启动异常"]);
    assert.deepEqual(harness.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: true }]);
    harness.deps.restoreOriginalLoopRuntime = async () => ({ ok: true, target: { tabId: "main-tab", cli: "codex" } });
    harness.deps.runLoopPrompt = async () => undefined;
    await harness.coordinator.continueTask(harness.task.id, "再次继续", "original");
    assert.equal(harness.messages.length, 2);
  });
}

test("missing and already-running tasks still acknowledge continuation requests", async () => {
  const missing = createContinuationRecoveryHarness();
  missing.deps.readTaskRecord = () => null;
  await missing.coordinator.continueTask(missing.task.id, "继续执行", "original");
  assert.deepEqual(missing.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: false }]);
  const running = createContinuationRecoveryHarness();
  running.task.status = "running";
  running.deps.collectRunningTaskIds = () => new Set([running.task.id]);
  running.deps.isTabRunActive = () => true;
  await running.coordinator.continueTask(running.task.id, "继续执行", "original");
  assert.deepEqual(running.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: false }]);
  assert.equal(running.runs, 0);
});

test("continues a persisted-running Loop+ task when its host owns an idle controller", async () => {
  const orphaned = createContinuationRecoveryHarness();
  orphaned.task.status = "running";
  orphaned.deps.collectRunningTaskIds = () => new Set();
  await orphaned.coordinator.continueTask(orphaned.task.id, "继续执行");
  assert.equal(orphaned.runs, 1);

  const active = createContinuationRecoveryHarness();
  active.task.status = "running";
  active.deps.collectRunningTaskIds = () => new Set([active.task.id]);
  active.deps.isTabRunActive = () => true;
  await active.coordinator.continueTask(active.task.id, "继续执行");
  assert.equal(active.runs, 0);
  assert.deepEqual(active.warnings, []);
});

test("duplicate continuation requests cannot start a task twice while original runtime restoration is pending", async () => {
  const harness = createContinuationRecoveryHarness();
  let releaseRestore!: () => void;
  const gate = new Promise<void>((resolve) => { releaseRestore = resolve; });
  harness.deps.restoreOriginalLoopRuntime = async () => {
    await gate;
    return { ok: true, target: { tabId: "main-tab", cli: "codex" } };
  };
  const first = harness.coordinator.continueTask(harness.task.id, "继续执行", "original");
  await harness.coordinator.continueTask(harness.task.id, "重复继续", "original");
  assert.equal(harness.runs, 0);
  assert.equal(harness.messages.length, 0);
  releaseRestore();
  await first;
  assert.equal(harness.runs, 1);
  assert.equal(harness.messages.length, 1);
});

test("does not recreate a closed main tab while rendering a terminal Loop panel", () => {
  const task = createStoppedTask();
  let createOptions: { createIfMissing?: boolean } | undefined;
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: (taskId) => taskId === task.id ? task : null,
    updateTaskRecord: () => task,
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: (_task, options) => {
      createOptions = options;
      return null;
    },
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => "current-config",
    getSelectedCliModel: () => "current-model",
    runLoopPrompt: async () => undefined,
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: () => undefined,
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  assert.equal(buildLoopGroupChatPanelState(task, deps).messageLimit, undefined);
  deps.getMessageLimit = () => 320;
  assert.equal(buildLoopGroupChatPanelState(task, deps).messageLimit, 320);
  deps.getMessageLimit = () => 100;
  assert.equal(buildLoopGroupChatPanelState(task, deps).messageLimit, 100);
  assert.deepEqual(createOptions, { createIfMissing: false });
});

for (const originalMode of ["split", "fullstack"] as const) {
  test(`Loop+ model switch preserves task ${originalMode} instead of current UI mode`, () => {
    const task = createStoppedTask();
    task.schedulingMode = "event_driven";
    task.loopSubtaskMode = originalMode;
    task.originProfile = { configId: "original-config" };
    task.modelRouting = {
      main: { model: "original-main" },
      subtask: { model: "original-backend" },
      subtaskFrontend: { cli: "claude", model: "original-frontend" },
      subtaskFullstack: { cli: "grok", model: "original-fullstack" },
    };
    const currentMode = originalMode === "split" ? "fullstack" : "split";
    const state = buildLoopGroupChatPanelState(task, {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: () => task.id,
      normalizeSupplementalRequirement: () => null,
      appendSupplementalRequirement: () => [],
      appendSupplementalRequirementToCommunication: () => undefined,
      recordPromptHistory: () => undefined,
      readTaskRecord: () => task,
      updateTaskRecord: () => task,
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set(),
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      getActiveSubtaskIds: () => [],
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      resolveMainPromptTarget: () => null,
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => false,
      getActiveConfigIdForCli: (cli) => `${cli}-config`,
      getSelectedCliModel: () => "current-main",
      getSelectedLoopCliModel: (_cli, role) => role === "main" ? "current-main" : "current-backend",
      getSelectedLoopFrontendCli: () => "claude",
      getSelectedLoopFullstackCli: () => "grok",
      getSelectedLoopSubtaskMode: () => currentMode,
      getLoopRoleExplicitModel: (_configId, role) => ({ configured: true, model: `current-${role}` }),
      runLoopPrompt: async () => undefined,
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => task,
      postPanelState: async () => undefined,
      getActiveConversationTaskId: () => task.id,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      pickTask: async () => task,
      t: ((key: string) => key) as Parameters<typeof buildLoopGroupChatPanelState>[1]["t"],
    });

    assert.deepEqual(state.modelSwitch?.fields.map((field) => field.role), originalMode === "split"
      ? ["main", "subtask", "frontend"] : ["main", "fullstack"]);
    assert.equal(state.modelSwitch?.fields[0].model, "original-main");
  });
}

test("Loop group chat continuation uses the main tab current CLI config and model", async () => {
  const task = createStoppedTask();
  const configCalls: string[] = [];
  const modelCalls: Array<{ cli: string; configId: string | null }> = [];
  const runCalls: Array<{ input: Record<string, unknown>; options: Record<string, unknown> }> = [];
  let continueTargetOptions: { createIfMissing?: boolean } | undefined;
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: (taskId) => taskId === task.id ? task : null,
    updateTaskRecord: () => task,
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: (_task, options) => {
      continueTargetOptions = options;
      return { tabId: "main-tab", cli: "opencode" };
    },
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: (cli) => {
      configCalls.push(cli);
      return `${cli}-active-config`;
    },
    getSelectedCliModel: (cli, configId) => {
      modelCalls.push({ cli, configId: configId ?? null });
      return `${cli}-latest-model`;
    },
    runLoopPrompt: async (input, options) => {
      runCalls.push({ input, options });
    },
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: () => undefined,
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  await coordinator.continueTask(task.id, "继续执行");

  assert.deepEqual(configCalls, ["opencode"]);
  assert.deepEqual(modelCalls, [{ cli: "opencode", configId: "opencode-active-config" }]);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0]?.input.model, "opencode-latest-model");
  assert.equal(runCalls[0]?.options.targetTabId, "main-tab");
  assert.equal(runCalls[0]?.options.resumeTaskId, task.id);
  assert.equal(runCalls[0]?.options.resumeRequested, true);
  assert.deepEqual(continueTargetOptions, { createIfMissing: true });
});

test("legacy tasks without a runtime profile continue without choosing a model source", async () => {
  const task = createStoppedTask();
  task.modelRouting = {
    main: { model: "original-main" },
    subtask: { model: "original-subtask" },
  };
  const patches: Array<Partial<LoopTaskRecord>> = [];
  const warnings: string[] = [];
  const runCalls: Array<Record<string, unknown>> = [];
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: (taskId) => taskId === task.id ? task : null,
    updateTaskRecord: (_taskId, patch) => {
      patches.push(patch);
      return task;
    },
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "codex" }),
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => "codex-active-config",
    getSelectedCliModel: () => "selected-model",
    getSelectedLoopCliModel: (_cli, role) => role === "main" ? "current-main" : "current-subtask",
    runLoopPrompt: async (input) => {
      runCalls.push(input);
    },
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: (message) => { warnings.push(message); },
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  await coordinator.continueTask(task.id, "继续", "original");

  assert.deepEqual(warnings, []);
  assert.equal(runCalls.length, 1);

  await coordinator.continueTask(task.id, "继续", "current");

  assert.equal(patches.length, 0);
  assert.equal(runCalls[0]?.model, "current-main");
  assert.equal(runCalls[0]?.loopSubtaskModel, "current-subtask");
});

test("Loop group chat original runtime restores recorded selections and rejects restoration failures", async () => {
  const task = createStoppedTask();
  task.modelRouting = {
    main: { model: "original-main" },
    subtask: { model: "original-subtask" },
  };
  task.originProfile = {
    configId: "original-config",
    mainThinkingMode: "high",
    subtaskThinkingMode: "low",
  };
  const runCalls: Array<{ input: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const restored: string[] = [];
  const warnings: string[] = [];
  const sideEffects: string[] = [];
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: (taskId) => taskId === task.id ? task : null,
    updateTaskRecord: () => { sideEffects.push("update"); return task; },
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: () => ({ tabId: "current-tab", cli: "opencode" }),
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => { sideEffects.push("switch"); },
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => "current-config",
    getSelectedCliModel: () => "current-model",
    restoreOriginalLoopRuntime: async (restoredTask) => {
      restored.push(restoredTask.id);
      return { ok: true, target: { tabId: "origin-tab", cli: "codex" } };
    },
    runLoopPrompt: async (input, options) => {
      runCalls.push({ input, options });
    },
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: (message) => { warnings.push(message); },
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  await coordinator.continueTask(task.id, "继续", "original");

  assert.deepEqual(restored, [task.id]);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0]?.input.model, "original-main");
  assert.equal(runCalls[0]?.input.loopMainModel, "original-main");
  assert.equal(runCalls[0]?.input.loopSubtaskModel, "original-subtask");
  assert.equal(runCalls[0]?.input.loopMainThinkingMode, "high");
  assert.equal(runCalls[0]?.input.loopSubtaskThinkingMode, "low");
  assert.equal(runCalls[0]?.options.targetTabId, "origin-tab");
  assert.equal(runCalls[0]?.options.preserveLoopOrigin, true);
  assert.equal(runCalls[0]?.options.resumeTaskId, task.id);

  const previousSideEffects = [...sideEffects];
  deps.restoreOriginalLoopRuntime = async () => ({ ok: false, message: "recorded config missing" });
  await coordinator.continueTask(task.id, "继续", "original");
  assert.deepEqual(warnings, ["recorded config missing"]);
  assert.equal(runCalls.length, 1);
  assert.deepEqual(sideEffects, previousSideEffects);

  deps.restoreOriginalLoopRuntime = async () => ({ ok: true, target: { tabId: null, cli: "codex" } });
  await coordinator.continueTask(task.id, "继续", "original");
  assert.deepEqual(warnings, ["recorded config missing", "loopGroupChatChat.originalRuntimeUnavailable"]);
  assert.equal(runCalls.length, 1);
  assert.deepEqual(sideEffects, previousSideEffects);
});

test("previews a communication file from the open Loop group chat", async () => {
  const fs = require("fs") as typeof import("fs");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const vscode = require("vscode") as typeof import("vscode");
  const previousCreate = vscode.window.createWebviewPanel;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-chat-preview-"));
  const posted: unknown[] = [];
  let messageHandler: ((message: unknown) => void) | undefined;
  (vscode.window as { createWebviewPanel: (...args: unknown[]) => unknown }).createWebviewPanel = () => ({
    title: "",
    webview: {
      cspSource: "self",
      html: "",
      postMessage(message: unknown) {
        posted.push(message);
      },
      onDidReceiveMessage(handler: (message: unknown) => void) {
        messageHandler = handler;
        return { dispose: () => undefined };
      },
    },
    reveal() {
      return undefined;
    },
    onDidDispose() {
      return { dispose: () => undefined };
    },
  });
  try {
    const task = createStoppedTask();
    const communicationDir = path.join(root, task.id);
    const filePath = path.join(communicationDir, "subtasks", "round-1-demo.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "# 标题\n\n- 一条\n<script>alert(1)</script>\n", "utf8");
    task.communicationDir = communicationDir;
    task.mainCommunicationFile = path.join(communicationDir, "main-task.md");
    type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      normalizeSupplementalRequirement: () => null,
      appendSupplementalRequirement: (existing) => [...(existing ?? [])],
      appendSupplementalRequirementToCommunication: () => undefined,
      recordPromptHistory: () => undefined,
      readTaskRecord: (taskId) => taskId === task.id ? task : null,
      updateTaskRecord: () => task,
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set(),
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      getActiveSubtaskIds: () => [],
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      resolveMainPromptTarget: () => null,
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => false,
      getActiveConfigIdForCli: () => "current-config",
      getSelectedCliModel: () => "current-model",
      runLoopPrompt: async () => undefined,
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => task,
      postPanelState: async () => undefined,
      getActiveConversationTaskId: () => task.id,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      pickTask: async () => task,
      t: ((key: string) => key) as CoordinatorDeps["t"],
    };
    const coordinator = createLoopGroupChatPanelCoordinator(deps);
    const opening = coordinator.open(task.id);
    await delay(0);
    messageHandler?.({ type: "loopGroupChatChat:loadingReady" });
    await opening;
    assert.equal(typeof messageHandler, "function");
    messageHandler?.({ type: "loopGroupChatChat:openCommunicationFile", requestId: " ", path: filePath });
    messageHandler?.({ type: "loopGroupChatChat:openCommunicationFile", requestId: "x".repeat(81), path: filePath });
    messageHandler?.({ type: "loopGroupChatChat:openCommunicationFile", requestId: "req-1", path: filePath });
    assert.equal(posted.length, 1);
    const message = posted[0] as { ok?: boolean; html?: string; error?: string };
    assert.equal(message.ok, true);
    assert.match(message.html ?? "", /<h1>标题<\/h1>/u);
    assert.match(message.html ?? "", /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
    assert.doesNotMatch(message.html ?? "", /<script>/u);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("persists Loop and Loop+ supplements in prompt history while busy and queues only Loop+ messages", async (context) => {
  const historyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-supplement-history-"));
  context.after(() => fs.rmSync(historyRoot, { recursive: true, force: true }));
  const vscode = require("vscode") as typeof import("vscode");
  const previousCreate = vscode.window.createWebviewPanel;
  let messageHandler: ((message: unknown) => void) | undefined;
  (vscode.window as { createWebviewPanel: (...args: unknown[]) => unknown }).createWebviewPanel = () => ({
    title: "",
    webview: {
      cspSource: "self",
      html: "",
      postMessage() {
        return undefined;
      },
      onDidReceiveMessage(handler: (message: unknown) => void) {
        messageHandler = handler;
        return { dispose: () => undefined };
      },
    },
    reveal() {
      return undefined;
    },
    onDidDispose() {
      return { dispose: () => undefined };
    },
  });
  try {
    const task = createStoppedTask();
    task.status = "running";
    task.schedulingMode = "event_driven";
    const notices: string[] = [];
    const communication: string[] = [];
    const historyCalls: Array<{ prompt: string; cli: string }> = [];
    const historyOptions: PromptHistoryStoreOptions = {
      promptHistoryDir: path.join(historyRoot, "prompt-history"),
      legacyPromptHistoryFile: path.join(historyRoot, "prompt-history.json"),
      workspaceKey: task.workspaceKey,
      workspaceKeyFallback: "no-workspace",
      promptHistoryLimit: 200,
      currentCli: "codex",
      isCliName: (value): value is "codex" | "claude" => value === "codex" || value === "claude",
      isTimestampWithinHistoryRetention: () => true,
    };
    let historyStore: PromptHistoryStore = { items: [] };
    let historyRefreshes = 0;
    type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      appendSupplementalRequirement: (existing, nextItem) => [...(existing ?? []), nextItem],
      appendSupplementalRequirementToCommunication: (_task, requirement) => { communication.push(requirement); },
      recordPromptHistory: (prompt, cli) => {
        historyCalls.push({ prompt, cli });
        historyStore = recordPromptHistoryInStore(historyStore, prompt, cli, historyOptions);
      },
      readTaskRecord: (taskId) => taskId === task.id ? task : null,
      updateTaskRecord: (_taskId, patch) => Object.assign(task, patch),
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set([task.id]),
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      getActiveSubtaskIds: () => [],
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "codex" }),
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => true,
      getActiveConfigIdForCli: () => "current-config",
      getSelectedCliModel: () => "current-model",
      runLoopPrompt: async () => { assert.fail("补充需求不应启动并发主模型调用"); },
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => task,
      postPanelState: async () => { historyRefreshes += 1; },
      getActiveConversationTaskId: () => task.id,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      pickTask: async () => task,
      notifyLoopPlusUserMessage: (_taskId, text) => {
        notices.push(text);
      },
      t: ((key: string) => key) as CoordinatorDeps["t"],
    };
    const coordinator = createLoopGroupChatPanelCoordinator(deps);
    const opening = coordinator.open(task.id);
    await delay(0);
    messageHandler?.({ type: "loopGroupChatChat:loadingReady" });
    await opening;
    assert.equal(typeof messageHandler, "function");
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "  please check the running subtask  " });
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "then check another requirement" });
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "   " });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notices, ["please check the running subtask", "then check another requirement"]);
    assert.deepEqual(task.supplementalRequirements, notices);
    assert.deepEqual(communication, notices);
    assert.deepEqual(historyCalls, notices.map((prompt) => ({ prompt, cli: "codex" })));
    assert.equal(historyRefreshes, 2);
    assert.deepEqual(loadPromptHistoryStore(historyOptions).items.map((item) => item.prompt).sort(), [...notices].sort());
    const originalHistoryId = historyStore.items.find((item) => item.prompt === notices[0])?.id;

    notices.length = 0;
    task.schedulingMode = "classic";
    task.cli = "claude";
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "classic only" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notices, []);
    assert.deepEqual(task.supplementalRequirements, ["please check the running subtask", "then check another requirement", "classic only"]);
    assert.deepEqual(communication, task.supplementalRequirements);

    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "  please check the running subtask  " });
    await new Promise((resolve) => setImmediate(resolve));
    const reloadedHistory = loadPromptHistoryStore(historyOptions);
    assert.equal(reloadedHistory.items.length, 3);
    assert.deepEqual(historyCalls.slice(2), [
      { prompt: "classic only", cli: "claude" },
      { prompt: "please check the running subtask", cli: "claude" },
    ]);
    assert.equal(reloadedHistory.items.find((item) => item.prompt === "classic only")?.cli, "claude");
    assert.equal(reloadedHistory.items[0].id, originalHistoryId);
    assert.equal(reloadedHistory.items[0].cli, "claude");
    assert.equal(historyRefreshes, 4);
    assert.deepEqual(notices, []);

    deps.readTaskRecord = () => null;
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "missing task" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(historyCalls.length, 4);
    assert.equal(historyRefreshes, 4);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
  }
});


test("asks the current main model session and shows the answer without supplementing the task", async () => {
  const vscode = require("vscode");
  const previousCreate = vscode.window.createWebviewPanel;
  let messageHandler: ((message: unknown) => void) | undefined;
  const posted: Array<{ type?: string; thread?: { messages?: Array<{ content?: string; role?: string; queued?: boolean }>; running?: boolean; queued?: boolean } }> = [];
  const webview = {
    cspSource: "self",
    html: "",
    postMessage(message: { type?: string; thread?: { messages?: Array<{ content?: string; role?: string; queued?: boolean }>; running?: boolean; queued?: boolean } }) {
      posted.push(message);
      return undefined;
    },
    onDidReceiveMessage(handler: (message: unknown) => void) {
      messageHandler = handler;
      return { dispose: () => undefined };
    },
  };
  (vscode.window as { createWebviewPanel: (...args: unknown[]) => unknown }).createWebviewPanel = () => ({
    title: "",
    webview,
    reveal() {
      return undefined;
    },
    onDidDispose() {
      return { dispose: () => undefined };
    },
  });
  try {
    const task = createStoppedTask();
    task.schedulingMode = "event_driven";
    const notices: string[] = [];
    const questions: string[] = [];
    const savedThreads: string[] = [];
    let mainModelBusy = true;
    let supplementalCount = 0;
    let aborts = 0;
    let holdAnswer = false;
    let releaseAnswer: (() => void) | undefined;
    const questionQueue = createLoopMainQuestionQueue({ pollIntervalMs: 1 });
    type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      appendSupplementalRequirement: (existing, nextItem) => {
        supplementalCount += 1;
        return [...(existing ?? []), nextItem];
      },
      appendSupplementalRequirementToCommunication: () => undefined,
      recordPromptHistory: () => undefined,
      readTaskRecord: (taskId) => taskId === task.id ? task : null,
      updateTaskRecord: () => task,
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set([task.id]),
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      getActiveSubtaskIds: () => [],
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "codex" }),
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => mainModelBusy,
      getActiveConfigIdForCli: () => "current-config",
      getSelectedCliModel: () => "current-model",
      runLoopPrompt: async () => undefined,
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => task,
      postPanelState: async () => undefined,
      getActiveConversationTaskId: () => task.id,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      pickTask: async () => task,
      notifyLoopPlusUserMessage: (_taskId, text) => {
        notices.push(text);
      },
      abortMainModelRun: () => {
        aborts += 1;
        releaseAnswer?.();
      },
      askMainModel: async (_task, question, hooks) => await questionQueue.runQuestion("main-tab", {
        canRun: () => !mainModelBusy,
        isAborted: hooks?.isAborted,
      }, async () => {
        hooks?.onStarted?.();
        questions.push(question);
        if (question === "失败的问题") {
          throw new Error("answer failed");
        }
        hooks?.onProgress?.({
          before: [],
          current: [{
            id: "think",
            role: "assistant",
            content: "thinking 先看冲突",
            kind: "thinking",
            createdAt: 1,
          }],
        });
        if (holdAnswer) {
          await new Promise<void>((resolve) => { releaseAnswer = resolve; });
        }
        return { status: "ready" as const, answer: "可以先合并冲突文件。" };
      }) ?? { status: "stopped" as const },
      readAskThread: () => ({
        version: 1,
        messages: [{ id: "old", role: "user", content: "上次的问题", createdAt: 1 }],
        running: false,
        dialogOpen: false,
        updatedAt: 1,
      }),
      writeAskThread: (_task, thread) => {
        savedThreads.push(thread.messages.map((message) => message.content).join("|"));
      },
      t: ((key: string) => key) as CoordinatorDeps["t"],
    };
    const coordinator = createLoopGroupChatPanelCoordinator(deps);
    const opening = coordinator.open(task.id);
    await delay(0);
    messageHandler?.({ type: "loopGroupChatChat:loadingReady" });
    await opening;
    const installedHtml = webview.html;
    assert.match(installedHtml, /上次的问题/u);
    assert.doesNotMatch(installedHtml, /id="askChatSend"[^>]*disabled/u);
    messageHandler?.({ type: "loopGroupChatChat:domReady", generation: 1 });
    const savedCount = savedThreads.length;
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "  可以合并吗  " });
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "再确认当前进度" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(questions, []);
    assert.ok(savedThreads.length > savedCount);
    const panelWhileBusy = deps.panelsByTaskId.get(task.id);
    assert.equal(panelWhileBusy?.getState()?.mainModelBusy, true);
    assert.deepEqual(panelWhileBusy?.getAskThread().messages.map((message) => message.content), ["上次的问题", "可以合并吗", "再确认当前进度"]);
    assert.equal(panelWhileBusy?.getAskThread().running, true);
    assert.equal(panelWhileBusy?.getAskThread().queued, true);
    assert.deepEqual(panelWhileBusy?.getAskThread().messages.filter((message) => message.queued).map((message) => message.content), ["可以合并吗", "再确认当前进度"]);
    mainModelBusy = false;
    await coordinator.refresh(task.id);
    assert.equal(panelWhileBusy?.getState()?.mainModelBusy, false);
    await delay(15);
    assert.deepEqual(questions, ["可以合并吗", "再确认当前进度"]);
    assert.equal(supplementalCount, 0);
    assert.equal(webview.html, installedHtml);
    const askThreads = posted.filter((message) => message.type === "loopGroupChatChat:askThread");
    const latestAsk = askThreads.at(-1)?.thread;
    const answeringFirst = askThreads.find((message) => message.thread?.running && !message.thread.queued);
    assert.deepEqual(answeringFirst?.thread?.messages?.filter((message) => message.queued).map((message) => message.content), ["再确认当前进度"]);
    const askText = latestAsk?.messages?.map((message) => message.content ?? "").join("\n") ?? "";
    assert.match(askText, /可以合并吗/u);
    assert.doesNotMatch(askText, /先看冲突/u);
    assert.equal(latestAsk?.running, false);
    assert.equal(panelWhileBusy?.getAskThread().messages.some((message) => message.queued), false);
    assert.match(askText, /可以先合并冲突文件。/u);
    assert.doesNotMatch(installedHtml, /ask-chat-thinking/u);
    assert.ok(savedThreads.every((entry) => !entry.includes("先看冲突")));
    const panel = deps.panelsByTaskId.get(task.id);
    assert.equal(panel?.getAskThread().dialogOpen, true);
    assert.equal(panel?.getAskThread().running, false);
    assert.equal(notices.length, 0);
    assert.ok(savedThreads.some((entry) => entry.includes("可以先合并冲突文件。")));

    messageHandler?.({ type: "loopGroupChatChat:dismissMainModelAnswer" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(panel?.getAskThread().dialogOpen, false);
    assert.match(panel?.getAskThread().messages.map((message) => message.content).join("\n") ?? "", /上次的问题/u);
    assert.match(panel?.getAskThread().messages.map((message) => message.content).join("\n") ?? "", /可以先合并冲突文件。/u);
    mainModelBusy = true;
    messageHandler?.({ type: "loopGroupChatChat:openAskDialog" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(panel?.getState()?.mainModelBusy, true);
    assert.equal(panel?.getAskThread().dialogOpen, true);
    assert.deepEqual(questions, ["可以合并吗", "再确认当前进度"]);

    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "取消排队的问题" });
    messageHandler?.({ type: "loopGroupChatChat:abortMainModelQuestion" });
    await delay(5);
    assert.equal(aborts, 0);
    assert.equal(panel?.getAskThread().running, false);
    assert.doesNotMatch(questions.join("\n"), /取消排队的问题/u);
    assert.equal(panel?.getAskThread().messages.some((message) => message.queued), false);

    mainModelBusy = false;
    holdAnswer = true;
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "中止正在回答的问题" });
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "同时清空后续问题" });
    await delay(5);
    assert.deepEqual(panel?.getAskThread().messages.filter((message) => message.queued).map((message) => message.content), ["同时清空后续问题"]);
    messageHandler?.({ type: "loopGroupChatChat:abortMainModelQuestion" });
    await delay(5);
    assert.equal(aborts, 1);
    assert.equal(panel?.getAskThread().running, false);
    assert.doesNotMatch(questions.join("\n"), /同时清空后续问题/u);
    assert.equal(panel?.getAskThread().messages.some((message) => message.queued), false);

    holdAnswer = false;
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "失败的问题" });
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "失败后继续" });
    await delay(5);
    assert.deepEqual(questions.slice(-2), ["失败的问题", "失败后继续"]);
    assert.equal(panel?.getAskThread().running, false);
    assert.equal(panel?.getAskThread().messages.some((message) => message.queued), false);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
  }
});
