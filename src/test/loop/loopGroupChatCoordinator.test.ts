import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { buildLoopGroupChatPanelState, createLoopGroupChatPanelCoordinator } = require("../../panelDiagnostics") as typeof import("../../panelDiagnostics");
import type { LoopTaskRecord } from "../../loopTaskStore";

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
  await running.coordinator.continueTask(running.task.id, "继续执行", "original");
  assert.deepEqual(running.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: false }]);
  assert.equal(running.runs, 0);
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

  buildLoopGroupChatPanelState(task, deps);

  assert.deepEqual(createOptions, { createIfMissing: false });
});

for (const originalMode of ["split", "fullstack"] as const) {
  test(`Loop+ continue preview preserves ${originalMode} and reads all current role selections`, () => {
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

    assert.equal(state.continueModels?.original.loopSubtaskMode, originalMode);
    assert.equal(state.continueModels?.original.frontend, "original-frontend");
    assert.equal(state.continueModels?.original.fullstack, "original-fullstack");
    assert.deepEqual(state.continueModels?.current, {
      main: "current-main",
      subtask: "current-backend",
      frontend: "current-frontend",
      frontendCli: "claude",
      frontendConfigId: "claude-config",
      fullstack: "current-fullstack",
      fullstackCli: "grok",
      fullstackConfigId: "grok-config",
      loopSubtaskMode: currentMode,
    });
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

test("Loop group chat continuation can keep the recorded main and subtask models", async () => {
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

  assert.deepEqual(warnings, ["loopGroupChatChat.originalRuntimeUnavailable"]);
  assert.equal(runCalls.length, 0);

  await coordinator.continueTask(task.id, "继续", "current");

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0]?.modelRouting, {
    main: { model: "current-main" },
    subtask: { model: "current-subtask" },
  });
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
    await coordinator.open(task.id);
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

test("persists consecutive supplements while the main task is busy and queues only Loop+ messages", async () => {
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
    type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      appendSupplementalRequirement: (existing, nextItem) => [...(existing ?? []), nextItem],
      appendSupplementalRequirementToCommunication: (_task, requirement) => { communication.push(requirement); },
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
      postPanelState: async () => undefined,
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
    await coordinator.open(task.id);
    assert.equal(typeof messageHandler, "function");
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "  please check the running subtask  " });
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "then check another requirement" });
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "   " });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notices, ["please check the running subtask", "then check another requirement"]);
    assert.deepEqual(task.supplementalRequirements, notices);
    assert.deepEqual(communication, notices);

    notices.length = 0;
    task.schedulingMode = "classic";
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "classic only" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notices, []);
    assert.deepEqual(task.supplementalRequirements, ["please check the running subtask", "then check another requirement", "classic only"]);
    assert.deepEqual(communication, task.supplementalRequirements);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
  }
});


test("asks the current main model session and shows the answer without supplementing the task", async () => {
  const vscode = require("vscode");
  const previousCreate = vscode.window.createWebviewPanel;
  let messageHandler: ((message: unknown) => void) | undefined;
  const posted: Array<{ type?: string; thread?: { messages?: Array<{ content?: string; role?: string }>; running?: boolean } }> = [];
  const webview = {
    cspSource: "self",
    html: "",
    postMessage(message: { type?: string; thread?: { messages?: Array<{ content?: string; role?: string }>; running?: boolean } }) {
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
      askMainModel: async (_task, question, hooks) => {
        questions.push(question);
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
        return { status: "ready", answer: "可以先合并冲突文件。" };
      },
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
    await coordinator.open(task.id);
    const installedHtml = webview.html;
    assert.match(installedHtml, /上次的问题/u);
    assert.match(installedHtml, /id="askChatSend"[^>]*disabled/u);
    messageHandler?.({ type: "loopGroupChatChat:domReady", generation: 1 });
    const savedCount = savedThreads.length;
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "忙碌时不应发送" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(questions, []);
    assert.equal(savedThreads.length, savedCount);
    const panelWhileBusy = deps.panelsByTaskId.get(task.id);
    assert.equal(panelWhileBusy?.getState()?.mainModelBusy, true);
    assert.deepEqual(panelWhileBusy?.getAskThread().messages.map((message) => message.content), ["上次的问题"]);
    assert.equal(panelWhileBusy?.getAskThread().running, false);
    mainModelBusy = false;
    await coordinator.refresh(task.id);
    assert.equal(panelWhileBusy?.getState()?.mainModelBusy, false);
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "  可以合并吗  " });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(questions, ["可以合并吗"]);
    assert.equal(supplementalCount, 0);
    assert.equal(webview.html, installedHtml);
    const askThreads = posted.filter((message) => message.type === "loopGroupChatChat:askThread");
    const latestAsk = askThreads.at(-1)?.thread;
    const askText = latestAsk?.messages?.map((message) => message.content ?? "").join("\n") ?? "";
    assert.match(askText, /可以合并吗/u);
    assert.doesNotMatch(askText, /先看冲突/u);
    assert.equal(latestAsk?.running, false);
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
    assert.deepEqual(questions, ["可以合并吗"]);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
  }
});
