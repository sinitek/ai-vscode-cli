import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createLoopDebateChatPanelCoordinator } = require("../../panelDiagnostics") as typeof import("../../panelDiagnostics");
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

test("Loop group chat continuation uses the main tab current CLI config and model", async () => {
  const task = createStoppedTask();
  const configCalls: string[] = [];
  const modelCalls: Array<{ cli: string; configId: string | null }> = [];
  const runCalls: Array<{ input: Record<string, unknown>; options: Record<string, unknown> }> = [];
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
    resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "opencode" }),
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
