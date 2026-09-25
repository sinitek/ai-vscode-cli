import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { buildLoopDebateChatPanelState, createLoopDebateChatPanelCoordinator } = require("../../panelDiagnostics") as typeof import("../../panelDiagnostics");
import type { LoopTaskRecord } from "../../loopTaskStore";

function createStoppedTask(): LoopTaskRecord {
  return {
    id: "task-1",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/task-1/loop-tasks.json",
    rootPrompt: "Resume with the latest runtime selection.",
    executionMode: "main_sub_multi_agent",
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

test("does not recreate a closed main tab while rendering a terminal Loop panel", () => {
  const task = createStoppedTask();
  let createOptions: { createIfMissing?: boolean } | undefined;
  type CoordinatorDeps = Parameters<typeof createLoopDebateChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    defaultDebateRound: 1,
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

  buildLoopDebateChatPanelState(task, deps);

  assert.deepEqual(createOptions, { createIfMissing: false });
});

test("Loop group chat continuation uses the main tab current CLI config and model", async () => {
  const task = createStoppedTask();
  const configCalls: string[] = [];
  const modelCalls: Array<{ cli: string; configId: string | null }> = [];
  const runCalls: Array<{ input: Record<string, unknown>; options: Record<string, unknown> }> = [];
  let continueTargetOptions: { createIfMissing?: boolean } | undefined;
  type CoordinatorDeps = Parameters<typeof createLoopDebateChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    defaultDebateRound: 1,
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

  const coordinator = createLoopDebateChatPanelCoordinator(deps);
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
  type CoordinatorDeps = Parameters<typeof createLoopDebateChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    defaultDebateRound: 1,
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

  const coordinator = createLoopDebateChatPanelCoordinator(deps);
  await coordinator.continueTask(task.id, "继续", "original");

  assert.deepEqual(warnings, ["loopDebateChat.originalRuntimeUnavailable"]);
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

test("Loop group chat original runtime restores the recorded group, config, models, and thinking", async () => {
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
  type CoordinatorDeps = Parameters<typeof createLoopDebateChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    defaultDebateRound: 1,
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
    resolveMainPromptTarget: () => ({ tabId: "current-tab", cli: "opencode" }),
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
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
    showWarningMessage: () => undefined,
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  const coordinator = createLoopDebateChatPanelCoordinator(deps);
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
    type CoordinatorDeps = Parameters<typeof createLoopDebateChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      defaultDebateRound: 1,
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
    const coordinator = createLoopDebateChatPanelCoordinator(deps);
    await coordinator.open(task.id);
    assert.equal(typeof messageHandler, "function");
    messageHandler?.({ type: "loopDebateChat:openCommunicationFile", requestId: " ", path: filePath });
    messageHandler?.({ type: "loopDebateChat:openCommunicationFile", requestId: "x".repeat(81), path: filePath });
    messageHandler?.({ type: "loopDebateChat:openCommunicationFile", requestId: "req-1", path: filePath });
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

test("forwards Loop+ user speech to the main-task queue and leaves classic Loop unchanged", async () => {
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
    task.schedulingMode = "event_driven";
    const notices: string[] = [];
    type CoordinatorDeps = Parameters<typeof createLoopDebateChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      defaultDebateRound: 1,
      normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      appendSupplementalRequirement: (existing, nextItem) => [...(existing ?? []), nextItem],
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
      isTabRunActive: () => true,
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
      t: ((key: string) => key) as CoordinatorDeps["t"],
    };
    const coordinator = createLoopDebateChatPanelCoordinator(deps);
    await coordinator.open(task.id);
    assert.equal(typeof messageHandler, "function");
    messageHandler?.({ type: "loopDebateChat:supplementTask", prompt: "  please check the running subtask  " });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notices, ["please check the running subtask"]);

    notices.length = 0;
    task.schedulingMode = "classic";
    messageHandler?.({ type: "loopDebateChat:supplementTask", prompt: "classic only" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notices, []);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
  }
});

