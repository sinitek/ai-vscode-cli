import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const {
  handleSendPromptMessage,
  handleUpdateOpenCodeVariantMessage,
  handleUpdateSettingMessage,
} = require("../sessionMessageActions") as typeof import("../sessionMessageActions");

import type {
  ConversationTabRecordForPanel,
  LoopSubtaskConversationContextForPanel,
  PanelMessageHandlerDeps,
  PromptRunInputForPanel,
} from "../sessionMessageHandlers";
import type { CliName, InteractiveMode, LoopExecutionMode, ThinkingMode } from "../cli/types";
import type { ToolSettingsState } from "../toolSettings";
import type { WorkspaceSettings } from "../workspaceSettingsStore";
import type { PanelMessage } from "../webview/types";

type SettingCalls = {
  postPanelState: number;
  savedSettings: WorkspaceSettings[];
  thinkingModes: Array<{ cli: CliName; model: string; mode: ThinkingMode }>;
  interactiveModes: Array<{ cli: CliName; mode: InteractiveMode }>;
  loopModes: Array<{ cli: CliName; mode: LoopExecutionMode }>;
  selectedModels: Array<{ cli: CliName; model: string | null; configId: string | null }>;
  loadedModelStores: number;
  toolSettings: Array<Partial<ToolSettingsState>>;
  statusUpdates: number;
  webviewMessages: Record<string, unknown>[];
  configReloads: number;
};

type SettingHarness = {
  deps: PanelMessageHandlerDeps;
  calls: SettingCalls;
  state: { workspaceSettings: WorkspaceSettings };
};

function createSettingHarness(currentCli: CliName = "codex"): SettingHarness {
  const calls: SettingCalls = {
    postPanelState: 0,
    savedSettings: [],
    thinkingModes: [],
    interactiveModes: [],
    loopModes: [],
    selectedModels: [],
    loadedModelStores: 0,
    toolSettings: [],
    statusUpdates: 0,
    webviewMessages: [],
    configReloads: 0,
  };
  const state = { workspaceSettings: {} as WorkspaceSettings };
  const persistWorkspaceSettings = (settings: WorkspaceSettings): void => {
    calls.savedSettings.push({ ...settings });
    state.workspaceSettings = settings;
  };
  const isCliName = (value: string): value is CliName => (
    value === "codex" || value === "claude" || value === "opencode"
  );
  const isInteractiveMode = (value: unknown): value is InteractiveMode => (
    value === "coding" || value === "plan" || value === "loop"
  );
  const isThinkingMode = (value: unknown): value is ThinkingMode => (
    value === "off" || value === "on" || value === "low" || value === "medium"
      || value === "high" || value === "xhigh" || value === "max" || value === "ultra"
  );

  const deps = {
    getCurrentCli: () => currentCli,
    getWorkspaceSettings: () => state.workspaceSettings,
    isThinkingMode,
    normalizeThinkingModeForCli: (_cli: CliName, mode: ThinkingMode) => mode === "ultra" ? "xhigh" : mode,
    saveWorkspaceSettings: persistWorkspaceSettings,
    setCliModelThinkingMode: (cli: CliName, model: string, mode: ThinkingMode) => {
      calls.thinkingModes.push({ cli, model, mode });
    },
    getSelectedCliModel: () => "selected-model",
    postPanelState: async () => { calls.postPanelState += 1; },
    isCliName,
    isInteractiveMode,
    setWorkspaceInteractiveModeForCli: (cli: CliName, mode: InteractiveMode) => {
      calls.interactiveModes.push({ cli, mode });
    },
    setWorkspaceLoopExecutionModeForCli: (cli: CliName, mode: LoopExecutionMode) => {
      calls.loopModes.push({ cli, mode });
    },
    selectCliModel: (cli: CliName, model: string | null, configId?: string | null) => {
      calls.selectedModels.push({ cli, model, configId: configId ?? null });
    },
    getActiveConfigIdForCli: (cli: CliName) => `config-${cli}`,
    loadModelStore: () => { calls.loadedModelStores += 1; },
    updateStoredToolSettings: (patch: Partial<ToolSettingsState>) => {
      calls.toolSettings.push(patch);
      return true;
    },
    normalizeLoopMaxRounds: (value: unknown) => typeof value === "number" ? Math.max(1, Math.floor(value)) : 3,
    normalizeToolSettingsLocale: (value: unknown) => value === "en" || value === "zh-CN" || value === "auto" ? value : null,
    updateStatusBar: () => { calls.statusUpdates += 1; },
    postWebviewMessage: (message: Record<string, unknown>) => { calls.webviewMessages.push(message); },
    getConfigManagerPanel: () => ({ reload: () => { calls.configReloads += 1; } }),
    isMacTaskShell: (value: unknown): value is "zsh" | "bash" => value === "zsh" || value === "bash",
  } as unknown as PanelMessageHandlerDeps;

  return { deps, calls, state };
}

type PromptCalls = {
  activeTabSwitches: string[];
  statusUpdates: number;
  savedSettings: WorkspaceSettings[];
  interactiveModes: Array<{ cli: CliName; mode: InteractiveMode }>;
  promptHistory: Array<{ prompt: string; cli: CliName }>;
  postPanelState: number;
  resolveImagePrompts: string[];
  promptTargets: Array<string | null>;
  preloaded: PromptRunInputForPanel[];
  runPrompt: Array<{ input: PromptRunInputForPanel; targetTabId: string | null | undefined }>;
  runLoopPrompt: Array<{
    input: PromptRunInputForPanel;
    options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean };
  }>;
  wakeMain: Array<{ context: LoopSubtaskConversationContextForPanel; model?: string; previousRunEndedAt: number }>;
};

type PromptHarness = {
  deps: PanelMessageHandlerDeps;
  calls: PromptCalls;
  state: { currentCli: CliName; workspaceSettings: WorkspaceSettings };
  tabs: Map<string, ConversationTabRecordForPanel>;
};

function createPromptHarness(initialCli: CliName = "claude"): PromptHarness {
  const calls: PromptCalls = {
    activeTabSwitches: [],
    statusUpdates: 0,
    savedSettings: [],
    interactiveModes: [],
    promptHistory: [],
    postPanelState: 0,
    resolveImagePrompts: [],
    promptTargets: [],
    preloaded: [],
    runPrompt: [],
    runLoopPrompt: [],
    wakeMain: [],
  };
  const state = { currentCli: initialCli, workspaceSettings: {} as WorkspaceSettings };
  const tabs = new Map<string, ConversationTabRecordForPanel>();
  const activeTab: ConversationTabRecordForPanel = {
    id: "active-tab",
    cli: initialCli,
    sessionId: "active-session",
    sessionIdByCli: { [initialCli]: "active-session" },
    createdAt: 1,
  };
  const isCliName = (value: string): value is CliName => (
    value === "codex" || value === "claude" || value === "opencode"
  );
  const isInteractiveMode = (value: unknown): value is InteractiveMode => (
    value === "coding" || value === "plan" || value === "loop"
  );

  const deps = {
    getConversationTabById: (tabId: string) => tabs.get(tabId) ?? null,
    setActiveConversationTab: (tabId: string) => {
      calls.activeTabSwitches.push(tabId);
      const tab = tabs.get(tabId);
      return tab ? { cli: tab.cli, sessionId: tab.sessionId } : null;
    },
    getActiveConversationTab: () => activeTab,
    getActiveConversationTabId: () => activeTab.id,
    getCurrentCli: () => state.currentCli,
    setCurrentCliValue: (cli: CliName) => { state.currentCli = cli; },
    updateStatusBar: () => { calls.statusUpdates += 1; },
    getWorkspaceSettings: () => state.workspaceSettings,
    saveWorkspaceSettings: (settings: WorkspaceSettings) => {
      calls.savedSettings.push({ ...settings });
      state.workspaceSettings = settings;
    },
    resolveLoopSubtaskConversationContext: () => null,
    isInteractiveMode,
    normalizeVisibleInteractiveMode: (mode: InteractiveMode) => mode,
    setWorkspaceInteractiveModeForCli: (cli: CliName, mode: InteractiveMode) => {
      calls.interactiveModes.push({ cli, mode });
    },
    getWorkspaceLoopExecutionMode: (): LoopExecutionMode => "debate_multi_agent",
    buildPromptWithAutoContext: (prompt: string) => ({
      modelPrompt: `context:${prompt}`,
      contextTags: ["#file"],
    }),
    maybeInjectLongTermMemoryForPrompt: (_displayPrompt: string, modelPrompt: string) => `${modelPrompt}:memory`,
    resolveCodexImagePathsForPrompt: async (prompt: string) => {
      calls.resolveImagePrompts.push(prompt);
      return ["/tmp/diagram.png"];
    },
    getLatestLoopRoundRunRecord: () => null,
    recordPromptHistory: (prompt: string, cli: CliName) => { calls.promptHistory.push({ prompt, cli }); },
    postPanelState: async () => { calls.postPanelState += 1; },
    resolvePromptRunTarget: (tabId: string | null) => {
      calls.promptTargets.push(tabId);
      const tab = tabId ? tabs.get(tabId) : null;
      return tab ? { tabId: tab.id, cli: tab.cli, sessionId: tab.sessionId } : null;
    },
    preloadUserMessageForPrompt: (input: PromptRunInputForPanel) => {
      const preloaded = { ...input, preloadedUserMessageId: "user-message" };
      calls.preloaded.push(preloaded);
      return preloaded;
    },
    runLoopPrompt: async (input: PromptRunInputForPanel, options: {
      targetTabId?: string | null;
      resumeTaskId?: string | null;
      resumeRequested?: boolean;
    }) => { calls.runLoopPrompt.push({ input, options }); },
    runPrompt: async (input: PromptRunInputForPanel, options?: { targetTabId?: string | null }) => {
      calls.runPrompt.push({ input, targetTabId: options?.targetTabId });
    },
    maybeWakeLoopMainAfterSubtaskContinuation: async (
      context: LoopSubtaskConversationContextForPanel,
      options: { previousRunEndedAt: number; model?: string },
    ) => { calls.wakeMain.push({ context, ...options }); },
    resolveLoopResumeTaskFromPrompt: () => null,
    isLoopResumePrompt: () => false,
    isCliName,
  } as unknown as PanelMessageHandlerDeps;

  return { deps, calls, state, tabs };
}

test("normalizes OpenCode variants and routes valid setting keys while rejecting invalid cli and mode values", async () => {
  const variants: Array<{ role: "primary" | "small"; value: string | null }> = [];
  let variantRefreshes = 0;
  await handleUpdateOpenCodeVariantMessage({ type: "updateOpenCodeVariant", value: "  high  " }, {
    updateOpenCodeVariant: (role, value) => { variants.push({ role, value }); },
    postPanelState: async () => { variantRefreshes += 1; },
  });
  await handleUpdateOpenCodeVariantMessage({ type: "updateOpenCodeVariant", role: "small", value: "  " }, {
    updateOpenCodeVariant: (role, value) => { variants.push({ role, value }); },
    postPanelState: async () => { variantRefreshes += 1; },
  });
  assert.deepEqual(variants, [{ role: "primary", value: "high" }, { role: "small", value: null }]);
  assert.equal(variantRefreshes, 2);

  const { deps, calls, state } = createSettingHarness();
  await handleUpdateSettingMessage({ type: "updateSetting", key: "thinkingMode", value: "ultra" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "thinkingMode", value: "not-a-mode" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "interactiveMode.claude", value: "plan" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "interactiveMode.unknown", value: "coding" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "interactiveMode.codex", value: "not-a-mode" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopExecutionMode.opencode", value: "unknown-mode" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopExecutionMode.unknown", value: "debate_multi_agent" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "selectedModel.codex", value: 42 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "selectedModel.claude", value: " claude-model " }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "selectedModel.unknown", value: "ignored" }, deps);

  assert.equal(state.workspaceSettings.thinkingMode, "xhigh");
  assert.deepEqual(calls.thinkingModes, [{ cli: "codex", model: "selected-model", mode: "xhigh" }]);
  assert.deepEqual(calls.interactiveModes, [{ cli: "claude", mode: "plan" }]);
  assert.deepEqual(calls.loopModes, [{ cli: "opencode", mode: "main_sub_multi_agent" }]);
  assert.deepEqual(calls.selectedModels, [
    { cli: "codex", model: null, configId: "config-codex" },
    { cli: "claude", model: " claude-model ", configId: "config-claude" },
  ]);
  assert.equal(calls.loadedModelStores, 2);
  assert.equal(calls.postPanelState, 10);
});

test("cleans migrated settings, reloads locale, and preserves each global setting contract", async () => {
  const { deps, calls, state } = createSettingHarness("opencode");

  state.workspaceSettings = {
    multiAgentEnabled: true,
    codexMultiAgentEnabled: true,
    autoCompactContextAfterRun: true,
    autoCompactContextBeforeRun: true,
    loopMaxRounds: 99,
  };
  await handleUpdateSettingMessage({ type: "updateSetting", key: "codexMultiAgentEnabled", value: 0 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "autoCompactContextBeforeRun", value: true }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopMaxRounds", value: 4.8 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopSubtaskMaxThinkingMode", value: "high" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopSubtaskMaxThinkingMode", value: "invalid" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "debug", value: 1 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "autoAddEditorContextTags", value: "yes" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "longTermMemoryEnabled", value: false }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "locale", value: "unknown" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "macTaskShell", value: "zsh" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "macTaskShell", value: "fish" }, deps);

  assert.deepEqual(state.workspaceSettings, { workspaceMemoryEnabled: false });
  assert.deepEqual(calls.toolSettings, [
    { multiAgentEnabled: false },
    { autoCompactContextAfterRun: true },
    { loopMaxRounds: 4 },
    { loopSubtaskMaxThinkingMode: "high" },
    { debug: true },
    { autoAddEditorContextTags: true },
    { locale: "auto" },
    ...(process.platform === "darwin" ? [{ macTaskShell: "zsh" as const }] : []),
  ]);
  assert.equal(calls.statusUpdates, 1);
  assert.deepEqual(calls.webviewMessages, [{ type: "reload" }]);
  assert.equal(calls.configReloads, 1);
  assert.equal(calls.postPanelState, 10);
});

test("retains workspace setting fallbacks when global persistence rejects the update", async () => {
  const { deps, calls, state } = createSettingHarness();
  state.workspaceSettings = {
    multiAgentEnabled: true,
    autoCompactContextAfterRun: true,
  };
  deps.updateStoredToolSettings = () => false;

  await handleUpdateSettingMessage({ type: "updateSetting", key: "multiAgentEnabled", value: false }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "autoCompactContextAfterRun", value: false }, deps);

  assert.deepEqual(state.workspaceSettings, {
    multiAgentEnabled: true,
    autoCompactContextAfterRun: true,
  });
  assert.deepEqual(calls.savedSettings, []);
  assert.equal(calls.postPanelState, 2);
});

test("cleans legacy setting aliases when each alternate workspace key is present", async () => {
  const { deps, state } = createSettingHarness();
  state.workspaceSettings = { codexMultiAgentEnabled: true };
  await handleUpdateSettingMessage({ type: "updateSetting", key: "multiAgentEnabled", value: false }, deps);
  state.workspaceSettings = { autoCompactContextBeforeRun: true };
  await handleUpdateSettingMessage({ type: "updateSetting", key: "autoCompactContextAfterRun", value: false }, deps);
  assert.deepEqual(state.workspaceSettings, {});
});

test("returns before querying dependencies for an empty prompt", async () => {
  await handleSendPromptMessage({ type: "sendPrompt", prompt: " \n " }, {} as PanelMessageHandlerDeps);
});

test("updates visible state before propagating a normal prompt runner failure", async () => {
  const { deps, calls, state, tabs } = createPromptHarness("claude");
  tabs.set("codex-tab", {
    id: "codex-tab",
    cli: "codex",
    sessionId: "codex-session",
    sessionIdByCli: { codex: "codex-session" },
    createdAt: 2,
  });
  deps.runPrompt = async (input, options) => {
    calls.runPrompt.push({ input, targetTabId: options?.targetTabId });
    throw new Error("runner failed");
  };

  await assert.rejects(
    handleSendPromptMessage({
      type: "sendPrompt",
      prompt: "  inspect the image  ",
      tabId: "codex-tab",
      cli: "codex",
      interactiveMode: "coding",
      model: " gpt-5.3-codex ",
    }, deps),
    /runner failed/,
  );

  assert.equal(state.currentCli, "codex");
  assert.deepEqual(calls.activeTabSwitches, ["codex-tab"]);
  assert.equal(calls.statusUpdates, 1);
  assert.deepEqual(calls.savedSettings, [{ currentCli: "codex" }]);
  assert.deepEqual(calls.interactiveModes, [{ cli: "codex", mode: "coding" }]);
  assert.deepEqual(calls.promptHistory, [{ prompt: "inspect the image", cli: "codex" }]);
  assert.equal(calls.postPanelState, 1);
  assert.deepEqual(calls.resolveImagePrompts, ["inspect the image"]);
  assert.deepEqual(calls.runPrompt, [{
    targetTabId: "codex-tab",
    input: {
      displayPrompt: "inspect the image",
      modelPrompt: "context:inspect the image:memory",
      contextTags: ["#file"],
      model: "gpt-5.3-codex",
      imagePaths: ["/tmp/diagram.png"],
      preloadedUserMessageId: "user-message",
    },
  }]);
});

test("routes Loop prompts with explicit mode and resume metadata without replacing a preserved active tab", async () => {
  const { deps, calls, state, tabs } = createPromptHarness("claude");
  tabs.set("loop-tab", {
    id: "loop-tab",
    cli: "codex",
    sessionId: "loop-session",
    sessionIdByCli: { codex: "loop-session" },
    createdAt: 3,
  });
  deps.resolveLoopResumeTaskFromPrompt = () => ({ id: "resumed-task" } as ReturnType<PanelMessageHandlerDeps["resolveLoopResumeTaskFromPrompt"]>);
  deps.isLoopResumePrompt = () => true;

  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "resume the task",
    tabId: "loop-tab",
    preserveActiveTab: true,
    interactiveMode: "loop",
    loopExecutionMode: "unexpected" as unknown as LoopExecutionMode,
    model: "codex-model",
  }, deps);

  assert.equal(state.currentCli, "claude");
  assert.deepEqual(calls.activeTabSwitches, []);
  assert.equal(calls.statusUpdates, 0);
  assert.deepEqual(calls.interactiveModes, [{ cli: "codex", mode: "loop" }]);
  assert.equal(calls.runPrompt.length, 0);
  assert.deepEqual(calls.runLoopPrompt, [{
    input: {
      displayPrompt: "resume the task",
      modelPrompt: "context:resume the task:memory",
      contextTags: ["#file"],
      model: "codex-model",
      imagePaths: ["/tmp/diagram.png"],
      loopExecutionMode: "main_sub_multi_agent",
      preloadedUserMessageId: "user-message",
    },
    options: {
      targetTabId: "loop-tab",
      resumeTaskId: "resumed-task",
      resumeRequested: true,
    },
  }]);
});

test("continues an interrupted Loop main task from ordinary main tab input", async () => {
  const { deps, calls, tabs } = createPromptHarness("codex");
  tabs.set("loop-main-tab", {
    id: "loop-main-tab",
    cli: "codex",
    sessionId: "loop-session",
    sessionIdByCli: { codex: "loop-session" },
    createdAt: 5,
  });
  deps.resolveLoopResumeTaskFromPrompt = (prompt, tabId) => {
    assert.equal(prompt, "add regression coverage before continuing");
    assert.equal(tabId, "loop-main-tab");
    return { id: "interrupted-task" } as ReturnType<PanelMessageHandlerDeps["resolveLoopResumeTaskFromPrompt"]>;
  };
  deps.isLoopResumePrompt = () => false;

  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "add regression coverage before continuing",
    tabId: "loop-main-tab",
    interactiveMode: "loop",
  }, deps);

  assert.equal(calls.runPrompt.length, 0);
  assert.equal(calls.runLoopPrompt.length, 1);
  assert.deepEqual(calls.runLoopPrompt[0]?.options, {
    targetTabId: "loop-main-tab",
    resumeTaskId: "interrupted-task",
    resumeRequested: true,
  });
});

test("forces a Loop subtask continuation through coding and wakes the parent after the run", async () => {
  const { deps, calls, tabs } = createPromptHarness("opencode");
  tabs.set("subtask-tab", {
    id: "subtask-tab",
    cli: "opencode",
    sessionId: "subtask-session",
    sessionIdByCli: { opencode: "subtask-session" },
    createdAt: 4,
  });
  const context: LoopSubtaskConversationContextForPanel = {
    taskId: "task-1",
    subtaskId: "subtask-1",
    round: 2,
  };
  deps.resolveLoopSubtaskConversationContext = () => context;
  deps.getLatestLoopRoundRunRecord = () => ({ endedAt: 123 });

  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "continue implementation",
    tabId: "subtask-tab",
    interactiveMode: "loop",
  }, deps);

  assert.deepEqual(calls.interactiveModes, [{ cli: "opencode", mode: "coding" }]);
  assert.equal(calls.runLoopPrompt.length, 0);
  assert.deepEqual(calls.runPrompt[0]?.input, {
    displayPrompt: "continue implementation",
    modelPrompt: "context:continue implementation:memory",
    contextTags: ["#file"],
    model: undefined,
    imagePaths: undefined,
    taskRole: "subtask",
    loopTaskId: "task-1",
    loopRound: 2,
    loopSubtaskId: "subtask-1",
    preloadedUserMessageId: "user-message",
  });
  assert.deepEqual(calls.wakeMain, [{ context, tabId: "subtask-tab", previousRunEndedAt: 123, model: undefined }]);
});

test("falls back to the current cli when a requested tab and cli are invalid", async () => {
  const { deps, calls, state } = createPromptHarness("claude");
  deps.getActiveConversationTab = () => null;
  deps.getActiveConversationTabId = () => null;
  deps.resolveCodexImagePathsForPrompt = async () => {
    throw new Error("non-Codex prompts must not resolve images");
  };

  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "fallback",
    tabId: "missing-tab",
    cli: "invalid" as unknown as CliName,
    interactiveMode: "invalid" as unknown as InteractiveMode,
  }, deps);

  assert.equal(state.currentCli, "claude");
  assert.deepEqual(calls.activeTabSwitches, []);
  assert.deepEqual(calls.interactiveModes, []);
  assert.deepEqual(calls.promptHistory, [{ prompt: "fallback", cli: "claude" }]);
  assert.deepEqual(calls.runPrompt, [{
    targetTabId: "missing-tab",
    input: {
      displayPrompt: "fallback",
      modelPrompt: "context:fallback:memory",
      contextTags: ["#file"],
      model: undefined,
      imagePaths: undefined,
    },
  }]);
});

test("switches to an explicitly requested CLI when no tab is available", async () => {
  const { deps, calls, state } = createPromptHarness("claude");
  deps.getActiveConversationTab = () => null;
  deps.getActiveConversationTabId = () => null;

  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "new codex session",
    cli: "codex",
  }, deps);

  assert.equal(state.currentCli, "codex");
  assert.equal(calls.statusUpdates, 1);
  assert.deepEqual(calls.savedSettings, [{ currentCli: "codex" }]);
  assert.deepEqual(calls.promptTargets, [null]);
  assert.equal(calls.runPrompt[0]?.targetTabId, null);
  assert.deepEqual(calls.runPrompt[0]?.input.imagePaths, ["/tmp/diagram.png"]);
});

test("uses the current CLI when prompt routing has neither a tab nor a CLI value", async () => {
  const { deps, calls } = createPromptHarness("claude");
  deps.getActiveConversationTab = () => null;
  deps.getActiveConversationTabId = () => null;
  await handleSendPromptMessage({ type: "sendPrompt", prompt: "current cli" }, deps);
  assert.deepEqual(calls.promptHistory, [{ prompt: "current cli", cli: "claude" }]);
  assert.equal(calls.runPrompt[0]?.targetTabId, null);
});

test("retains the final CLI fallback for malformed runtime dependencies", async () => {
  const { deps, calls } = createPromptHarness("claude");
  deps.getActiveConversationTab = () => null;
  deps.getActiveConversationTabId = () => null;
  deps.getCurrentCli = () => undefined as unknown as CliName;
  await handleSendPromptMessage({ type: "sendPrompt", prompt: "fallback dependency" }, deps);
  assert.deepEqual(calls.promptHistory, [{ prompt: "fallback dependency", cli: undefined }]);
});
