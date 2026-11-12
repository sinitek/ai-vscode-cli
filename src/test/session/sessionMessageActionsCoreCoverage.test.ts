import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  handleSendPromptMessage,
  handleUpdateOpenCodeVariantMessage,
  handleUpdateSettingMessage,
} = require("../../sessionMessageActions") as typeof import("../../sessionMessageActions");

import type {
  ConversationTabRecordForPanel,
  LoopSubtaskConversationContextForPanel,
  PanelMessageHandlerDeps,
  PromptRunInputForPanel,
} from "../../sessionMessageHandlers";
import type { CliName, InteractiveMode, ThinkingMode } from "../../cli/types";
import type { CliEnabledByName, ToolSettingsState } from "../../toolSettings";
import type { WorkspaceSettings } from "../../workspaceSettingsStore";

type SettingCalls = {
  postPanelState: number;
  savedSettings: WorkspaceSettings[];
  thinkingModes: Array<{ cli: CliName; model: string; mode: ThinkingMode }>;
  interactiveModes: Array<{ cli: CliName; mode: InteractiveMode }>;
  selectedModels: Array<{ cli: CliName; model: string | null; configId: string | null }>;
  selectedLoopModels: Array<{ cli: CliName; role: "main" | "subtask"; model: string | null; configId: string | null }>;
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
    selectedModels: [],
    selectedLoopModels: [],
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
    selectCliModel: (cli: CliName, model: string | null, configId?: string | null) => {
      calls.selectedModels.push({ cli, model, configId: configId ?? null });
    },
    selectCliLoopModel: (cli: CliName, role: "main" | "subtask", model: string | null, configId?: string | null) => {
      calls.selectedLoopModels.push({ cli, role, model, configId: configId ?? null });
    },
    getActiveConfigIdForCli: (cli: CliName) => `config-${cli}`,
    loadModelStore: () => { calls.loadedModelStores += 1; },
    updateStoredToolSettings: (patch: Partial<ToolSettingsState>) => {
      calls.toolSettings.push(patch);
      return true;
    },
    normalizeLoopMaxRounds: (value: unknown) => typeof value === "number" ? Math.max(1, Math.floor(value)) : 3,
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
  wakeMain: Array<{
    context: LoopSubtaskConversationContextForPanel;
    tabId: string;
    model?: string;
    loopMainModel?: string;
    loopSubtaskModel?: string;
    previousRunEndedAt: number;
  }>;
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
    getActiveConfigIdForCli: (cli: CliName) => `config-${cli}`,
    getSelectedCliModel: () => null,
    getSelectedLoopCliModel: () => null,
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
      options: {
        tabId: string;
        previousRunEndedAt: number;
        model?: string;
        loopMainModel?: string;
        loopSubtaskModel?: string;
      },
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
  await handleUpdateSettingMessage({ type: "updateSetting", key: "selectedModel.codex", value: 42 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "selectedModel.claude", value: " claude-model " }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "selectedModel.unknown", value: "ignored" }, deps);

  assert.equal(state.workspaceSettings.thinkingMode, "xhigh");
  assert.deepEqual(calls.thinkingModes, [{ cli: "codex", model: "selected-model", mode: "xhigh" }]);
  assert.deepEqual(calls.interactiveModes, [{ cli: "claude", mode: "plan" }]);
  assert.deepEqual(calls.selectedModels, [
    { cli: "codex", model: null, configId: "config-codex" },
    { cli: "claude", model: " claude-model ", configId: "config-claude" },
  ]);
  assert.equal(calls.loadedModelStores, 2);
  assert.equal(calls.postPanelState, 8);
});

test("ignores retired Loop execution mode updates without saving or refreshing", async () => {
  const { deps, calls, state } = createSettingHarness();
  for (const key of ["loopExecutionMode.opencode", "loopExecutionMode.unknown"]) {
    await handleUpdateSettingMessage({ type: "updateSetting", key, value: "debate_multi_agent" }, deps);
  }
  assert.deepEqual(state.workspaceSettings, {});
  assert.deepEqual(calls.savedSettings, []);
  assert.equal(calls.postPanelState, 0);
});

test("cleans migrated settings and preserves each global setting contract", async () => {
  const { deps, calls, state } = createSettingHarness("opencode");

  state.workspaceSettings = {
    autoCompactContextAfterRun: true,
    autoCompactContextBeforeRun: true,
    loopMaxRounds: 99,
  };
  await handleUpdateSettingMessage({ type: "updateSetting", key: "codexMultiAgentEnabled", value: 0 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "autoCompactContextBeforeRun", value: "false" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopMaxRounds", value: 4.8 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopSubtaskMaxThinkingMode", value: "high" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopSubtaskMaxThinkingMode", value: "invalid" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "debug", value: 1 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "autoAddEditorContextTags", value: "yes" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "longTermMemoryEnabled", value: false }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "macTaskShell", value: "zsh" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "macTaskShell", value: "fish" }, deps);

  assert.deepEqual(state.workspaceSettings, { workspaceMemoryEnabled: false });
  assert.deepEqual(calls.toolSettings, [
    { autoCompactContextAfterRun: true },
    { loopMaxRounds: 4 },
    { debug: true },
    { autoAddEditorContextTags: true },
    ...(process.platform === "darwin" ? [{ macTaskShell: "zsh" as const }] : []),
  ]);
  assert.equal(calls.statusUpdates, 0);
  assert.deepEqual(calls.webviewMessages, []);
  assert.equal(calls.configReloads, 0);
  assert.equal(calls.postPanelState, 7);
});

test("persists the Loop+ dispatch subtask maximum as a global setting", async () => {
  const { deps, calls } = createSettingHarness();
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopPlusDecisionSubtaskMax", value: "8.9" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopPlusDecisionSubtaskMax", value: 0 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopPlusDecisionSubtaskMax", value: "nope" }, deps);
  assert.deepEqual(calls.toolSettings, [
    { loopPlusDecisionSubtaskMax: 8 },
    { loopPlusDecisionSubtaskMax: 1 },
    { loopPlusDecisionSubtaskMax: 6 },
  ]);
  assert.equal(calls.postPanelState, 3);
});

test("persists the human interaction timeout as a global setting", async () => {
  const { deps, calls } = createSettingHarness();
  await handleUpdateSettingMessage({ type: "updateSetting", key: "humanInteractionTimeoutMinutes", value: "10.2" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "humanInteractionTimeoutMinutes", value: 0 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "humanInteractionTimeoutMinutes", value: 2000 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "humanInteractionTimeoutMinutes", value: "nope" }, deps);
  assert.deepEqual(calls.toolSettings, [
    { humanInteractionTimeoutMinutes: 10 },
    { humanInteractionTimeoutMinutes: 1 },
    { humanInteractionTimeoutMinutes: 1440 },
    { humanInteractionTimeoutMinutes: 15 },
  ]);
  assert.equal(calls.postPanelState, 4);
});

test("persists the Loop+ acceptance limit as a global setting", async () => {
  const { deps, calls } = createSettingHarness();
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopPlusMaxAcceptances", value: "100.2" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopPlusMaxAcceptances", value: 0 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopPlusMaxAcceptances", value: 5000 }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopPlusMaxAcceptances", value: "nope" }, deps);
  assert.deepEqual(calls.toolSettings, [
    { loopPlusMaxAcceptances: 100 },
    { loopPlusMaxAcceptances: 1 },
    { loopPlusMaxAcceptances: 999 },
    { loopPlusMaxAcceptances: 100 },
  ]);
  assert.equal(calls.postPanelState, 4);
});

test("persists only the normalized global chat message limit and returns panel state", async () => {
  const { deps, calls, state } = createSettingHarness();
  const originalSettings = { ...state.workspaceSettings };
  for (const value of ["734.9", 0, -8, 20000, "", "nope", null, true]) {
    await handleUpdateSettingMessage({ type: "updateSetting", key: "chatMessageLimit", value }, deps);
  }
  assert.deepEqual(calls.toolSettings, [734, 1, 1, 10000, 500, 500, 500, 500].map((chatMessageLimit) => ({ chatMessageLimit })));
  assert.equal(calls.postPanelState, 8);
  assert.deepEqual(state.workspaceSettings, originalSettings);
  assert.deepEqual(calls.savedSettings, []);
  assert.deepEqual(calls.webviewMessages, []);
});

test("persists an independent global group chat limit and rejects invalid input", async () => {
  const { deps, calls, state } = createSettingHarness();
  const originalSettings = { ...state.workspaceSettings };
  for (const value of ["234.9", 0, 20000, "", "bad", null, true]) {
    await handleUpdateSettingMessage({ type: "updateSetting", key: "loopGroupChatMessageLimit", value }, deps);
  }
  assert.deepEqual(calls.toolSettings, [234, 1, 10000, 200, 200, 200, 200].map((loopGroupChatMessageLimit) => ({ loopGroupChatMessageLimit })));
  assert.equal(calls.postPanelState, 7);
  assert.deepEqual(state.workspaceSettings, originalSettings);
  assert.deepEqual(calls.savedSettings, []);
  const errors: unknown[][] = [];
  deps.updateStoredToolSettings = () => false;
  deps.showWebviewError = (...args) => { errors.push(args); };
  await handleUpdateSettingMessage({ type: "updateSetting", key: "loopGroupChatMessageLimit", value: 300 }, deps);
  assert.match(String(errors[0][1]), /群聊气泡上限保存失败/);
  assert.equal(calls.postPanelState, 8);
});

test("chat message limit persistence failure uses the existing error path and returns actual state", async () => {
  const { deps, calls } = createSettingHarness();
  const errors: unknown[][] = [];
  deps.updateStoredToolSettings = () => false;
  deps.showWebviewError = (...args) => { errors.push(args); };
  await handleUpdateSettingMessage({ type: "updateSetting", key: "chatMessageLimit", value: 800 }, deps);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][1]), /保存失败/);
  assert.equal(calls.postPanelState, 1);
  assert.deepEqual(calls.savedSettings, []);
});

test("persists instruction bubble visibility globally and rejects non-boolean enable values", async () => {
  const { deps, calls, state } = createSettingHarness();
  const originalSettings = { ...state.workspaceSettings };
  for (const value of [true, false, "true", 1, null]) {
    await handleUpdateSettingMessage({ type: "updateSetting", key: "hideInstructionBubbles", value }, deps);
  }
  assert.deepEqual(calls.toolSettings, [true, false, false, false, false].map((hideInstructionBubbles) => ({ hideInstructionBubbles })));
  assert.equal(calls.postPanelState, 5);
  assert.deepEqual(state.workspaceSettings, originalSettings);
  assert.deepEqual(calls.savedSettings, []);
});

test("instruction bubble visibility save failure reports an error and returns actual state", async () => {
  const { deps, calls } = createSettingHarness();
  const errors: unknown[][] = [];
  deps.updateStoredToolSettings = () => false;
  deps.showWebviewError = (...args) => { errors.push(args); };
  await handleUpdateSettingMessage({ type: "updateSetting", key: "hideInstructionBubbles", value: true }, deps);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][1]), /隐藏指令气泡.*保存失败/);
  assert.equal(calls.postPanelState, 1);
  assert.deepEqual(calls.savedSettings, []);
});

test("persists automatic-cleanup retention days as a global setting", async () => {
  const { deps, calls } = createSettingHarness();
  await handleUpdateSettingMessage({ type: "updateSetting", key: "historyRetentionDays", value: "45.9" }, deps);
  assert.deepEqual(calls.toolSettings, [{ historyRetentionDays: 45 }]);
  assert.equal(calls.postPanelState, 1);
});

test("retains workspace setting fallbacks when global persistence rejects the update", async () => {
  const { deps, calls, state } = createSettingHarness();
  state.workspaceSettings = {
    autoCompactContextAfterRun: true,
  };
  deps.updateStoredToolSettings = () => false;

  await handleUpdateSettingMessage({ type: "updateSetting", key: "multiAgentEnabled", value: false }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "autoCompactContextAfterRun", value: false }, deps);

  assert.deepEqual(state.workspaceSettings, {
    autoCompactContextAfterRun: true,
  });
  assert.deepEqual(calls.savedSettings, []);
  assert.equal(calls.postPanelState, 1);
});

test("cleans legacy setting aliases when each alternate workspace key is present", async () => {
  const { deps, state } = createSettingHarness();
  state.workspaceSettings = {};
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
      loopMainModel: "codex-model",
      loopSubtaskModel: "codex-model",
      imagePaths: ["/tmp/diagram.png"],
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
  assert.deepEqual(calls.wakeMain, [{
    context,
    tabId: "subtask-tab",
    previousRunEndedAt: 123,
    model: undefined,
    loopMainModel: undefined,
    loopSubtaskModel: undefined,
  }]);
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

test("treats prototype names, near misses, and retired setting keys as side-effect-free unknown commands", async () => {
  const { deps, calls, state } = createSettingHarness();
  const originalCalls = JSON.parse(JSON.stringify(calls)) as SettingCalls;
  const originalSettings = state.workspaceSettings;
  for (const key of [
    "constructor", "toString", "__proto__", "hasOwnProperty", "unknownSetting",
    "thinkingMode.extra", "selectedModel", "loopRoleThinking.extra",
    "multiAgentEnabled", "codexMultiAgentEnabled", "loopSubtaskMaxThinkingMode",
    "loopExecutionMode.codex",
  ]) {
    await handleUpdateSettingMessage({ type: "updateSetting", key, value: true }, deps);
    assert.deepEqual(calls, originalCalls, key);
    assert.equal(state.workspaceSettings, originalSettings, key);
    assert.deepEqual(state.workspaceSettings, {}, key);
  }
});

test("refreshes role object payloads even when invalid but ignores all non-object payloads", async () => {
  for (const key of ["loopRoleExplicitModel", "loopRoleThinking"]) {
    const { deps, calls } = createSettingHarness();
    const mutations: unknown[][] = [];
    deps.setLoopRoleExplicitModel = (...args) => { mutations.push(args); return true; };
    deps.setLoopRoleThinking = (...args) => { mutations.push(args); return true; };
    for (const value of [null, undefined, false, true, 0, 1, "model"]) {
      await handleUpdateSettingMessage({ type: "updateSetting", key, value }, deps);
      assert.equal(calls.postPanelState, 0, `${key}: ${String(value)}`);
    }
    const invalidPayloads = [
      {}, [], { configId: " ", role: "frontend", model: "model", thinkingMode: "high" },
      { configId: "profile", role: "main", model: "model", thinkingMode: "high" },
      { configId: "profile", role: "frontend", model: 42, thinkingMode: "invalid" },
    ];
    for (const [index, value] of invalidPayloads.entries()) {
      await handleUpdateSettingMessage({ type: "updateSetting", key, value }, deps);
      assert.equal(calls.postPanelState, index + 1, key);
    }
    assert.deepEqual(mutations, [], key);
    assert.equal(calls.loadedModelStores, 0, key);
  }
});

test("preserves role-specific model normalization and reports unsuccessful role saves before refreshing", async () => {
  const { deps, calls } = createSettingHarness();
  const mutations: unknown[][] = [];
  const errors: unknown[][] = [];
  deps.setLoopRoleExplicitModel = (...args) => { mutations.push(args); return false; };
  deps.setLoopRoleThinking = (...args) => { mutations.push(args); return false; };
  deps.showWebviewError = (...args) => { errors.push(args); };
  await handleUpdateSettingMessage({
    type: "updateSetting", key: "loopRoleExplicitModel",
    value: { configId: " profile.with.dots ", role: "fullstack", model: " raw model " },
  }, deps);
  for (const model of [" trimmed model ", " ", 42]) {
    await handleUpdateSettingMessage({
      type: "updateSetting", key: "loopRoleThinking",
      value: { configId: " profile.with.dots ", role: "frontend", model, thinkingMode: "ultra" },
    }, deps);
  }
  assert.deepEqual(mutations, [
    ["profile.with.dots", "fullstack", " raw model "],
    ["profile.with.dots", "frontend", "trimmed model", "ultra"],
    ["profile.with.dots", "frontend", null, "ultra"],
    ["profile.with.dots", "frontend", null, "ultra"],
  ]);
  assert.deepEqual(errors, [
    ["模型配置", "子模型保存失败，已恢复原来的选择。"],
    ...Array.from({ length: 3 }, () => ["模型配置", "思考力度保存失败，已恢复原来的选择。"]),
  ]);
  assert.equal(calls.loadedModelStores, 4);
  assert.equal(calls.postPanelState, 4);
});

test("keeps complete dotted configuration suffixes while trimming only configuration IDs", async () => {
  const { deps, calls } = createSettingHarness();
  const mutations: unknown[][] = [];
  deps.selectLoopSubtaskMode = (...args) => { mutations.push(["mode", ...args]); return true; };
  deps.seedLoopFullstackRole = (...args) => { mutations.push(["seed", ...args]); return true; };
  deps.selectLoopFullstackCli = (...args) => { mutations.push(["fullstack", ...args]); return true; };
  deps.selectLoopFrontendCli = (...args) => { mutations.push(["frontend", ...args]); };
  deps.setLoopRoleExplicitModel = (...args) => { mutations.push(["model", ...args]); return true; };
  const commands = [
    { prefix: "loopSubtaskMode.", value: "fullstack" },
    { prefix: "seedLoopFullstackRole.", value: null },
    { prefix: "selectedLoopFullstackCli.", value: " CLAUDE " },
    { prefix: "selectedLoopFrontendCli.", value: " CODEX " },
    { prefix: "selectedLoopFrontendModel.", value: " raw model " },
  ];
  for (const { prefix, value } of commands) {
    await handleUpdateSettingMessage({ type: "updateSetting", key: `${prefix} profile.with.dots `, value }, deps);
    await handleUpdateSettingMessage({ type: "updateSetting", key: `${prefix}   `, value }, deps);
  }
  assert.deepEqual(mutations, [
    ["mode", "profile.with.dots", "fullstack"],
    ["seed", "profile.with.dots"],
    ["fullstack", "profile.with.dots", "claude"],
    ["frontend", "profile.with.dots", "codex"],
    ["model", "profile.with.dots", "frontend", " raw model "],
  ]);
  assert.equal(calls.loadedModelStores, commands.length);
  assert.equal(calls.postPanelState, commands.length * 2);
});

test("keeps role split semantics and CLI validation distinct from configuration suffix parsing", async () => {
  const { deps, calls } = createSettingHarness();
  const thinking: unknown[][] = [];
  deps.getSelectedLoopCliModel = () => "role-model";
  deps.setSelectedLoopThinkingMode = (...args) => { thinking.push(args); };
  for (const [key, value] of [
    ["selectedLoopModel.codex.main.ignored.suffix", " raw model "],
    ["selectedLoopThinkingMode.claude.subtask.ignored.suffix", "ultra"],
    ["selectedLoopThinkingMode.opencode.main", "high"],
    ["selectedLoopModel.codex.frontend", "ignored"],
    ["selectedLoopModel. codex.main", "ignored"],
    ["selectedModel.codex.extra", "ignored"],
    ["interactiveMode. claude", "plan"],
    ["selectedLoopThinkingMode.codex.main", "invalid"],
  ]) {
    await handleUpdateSettingMessage({ type: "updateSetting", key, value }, deps);
  }
  assert.deepEqual(calls.selectedLoopModels, [
    { cli: "codex", role: "main", model: " raw model ", configId: "config-codex" },
  ]);
  assert.deepEqual(thinking, [
    ["claude", "subtask", "role-model", "xhigh", "config-claude"],
    ["codex", "main", "role-model", null, "config-codex"],
  ]);
  assert.deepEqual(calls.selectedModels, []);
  assert.deepEqual(calls.interactiveModes, []);
  assert.equal(calls.loadedModelStores, 3);
  assert.equal(calls.postPanelState, 8);
});

test("keeps optional callback fallbacks and their existing model-store reload boundaries", async () => {
  const { deps, calls } = createSettingHarness();
  deps.selectCliLoopModel = undefined;
  const commands = [
    { key: "loopSubtaskMode.profile", value: "split", reloads: 0 },
    { key: "seedLoopFullstackRole.profile", value: true, reloads: 0 },
    { key: "selectedLoopFullstackCli.profile", value: "codex", reloads: 0 },
    { key: "selectedLoopFrontendModel.profile", value: "model", reloads: 0 },
    { key: "loopRoleExplicitModel", value: { configId: "profile", role: "fullstack", model: "model" }, reloads: 0 },
    { key: "loopRoleThinking", value: { configId: "profile", role: "frontend", thinkingMode: "high" }, reloads: 0 },
    { key: "selectedLoopFrontendCli.profile", value: "codex", reloads: 1 },
    { key: "selectedLoopModel.codex.main", value: "model", reloads: 2 },
    { key: "selectedLoopThinkingMode.codex.main", value: "high", reloads: 3 },
    { key: "taskCompletionNotifications", value: true, reloads: 3 },
  ];
  for (const [index, { key, value, reloads }] of commands.entries()) {
    await handleUpdateSettingMessage({ type: "updateSetting", key, value }, deps);
    assert.equal(calls.postPanelState, index + 1, key);
    assert.equal(calls.loadedModelStores, reloads, key);
  }
  assert.deepEqual(calls.selectedLoopModels, []);
  assert.deepEqual(calls.savedSettings, []);
  assert.deepEqual(calls.toolSettings, []);
});

test("catches rejected notification saves with the existing Chinese errors and refreshes once", async () => {
  for (const key of [
    "humanInteractionNotifications", "taskCompletionNotifications",
    "humanInteractionWindowAttention", "taskCompletionWindowAttention",
  ]) {
    const { deps, calls } = createSettingHarness();
    const errors: unknown[][] = [];
    const updates: unknown[][] = [];
    deps.showWebviewError = (...args) => { errors.push(args); };
    for (const failure of [new Error("只读配置"), "denied"]) {
      deps.updateNotificationSetting = async (...args) => { updates.push(args); throw failure; };
      const refreshes = calls.postPanelState;
      await handleUpdateSettingMessage({ type: "updateSetting", key, value: false }, deps);
      assert.equal(calls.postPanelState, refreshes + 1, key);
    }
    await handleUpdateSettingMessage({ type: "updateSetting", key, value: "false" }, deps);
    assert.deepEqual(updates, [[key, false], [key, false]]);
    assert.deepEqual(errors, [
      ["通知设置", "保存通知设置失败：只读配置"],
      ["通知设置", "保存通知设置失败，请重试。"],
    ]);
    assert.equal(calls.postPanelState, 3);
    assert.deepEqual(calls.savedSettings, []);
    assert.deepEqual(calls.toolSettings, []);
  }
});

test("propagates non-notification dependency failures without an extra panel refresh", async () => {
  const cases: Array<{
    key: string;
    value: unknown;
    fail: (deps: PanelMessageHandlerDeps, error: Error) => void;
  }> = [
    { key: "thinkingMode", value: "high", fail: (deps, error) => {
      deps.saveWorkspaceSettings = () => { throw error; };
    } },
    { key: "selectedModel.codex", value: "model", fail: (deps, error) => {
      deps.selectCliModel = () => { throw error; };
    } },
    { key: "selectedModel.codex", value: "model", fail: (deps, error) => {
      deps.loadModelStore = () => { throw error; };
    } },
    { key: "humanInteractionEnabled", value: true, fail: (deps, error) => {
      deps.updateStoredToolSettings = () => { throw error; };
    } },
    { key: "loopRoleExplicitModel", value: { configId: "profile", role: "frontend", model: "model" }, fail: (deps, error) => {
      deps.setLoopRoleExplicitModel = () => { throw error; };
    } },
    { key: "cliEnabled.codex", value: false, fail: (deps, error) => {
      deps.setCurrentCli = async () => { throw error; };
    } },
  ];
  for (const { key, value, fail } of cases) {
    const { deps, calls } = createSettingHarness();
    const failure = new Error(`dependency failure: ${key}`);
    const sideEffects: unknown[][] = [];
    deps.showWebviewError = (...args) => { sideEffects.push(args); };
    deps.retargetDisabledLoopSubtaskSelections = (...args) => { sideEffects.push(args); };
    deps.publishCliEnabled = (...args) => { sideEffects.push(args); };
    fail(deps, failure);
    await assert.rejects(handleUpdateSettingMessage({ type: "updateSetting", key, value }, deps), (error) => error === failure);
    assert.equal(calls.postPanelState, 0, key);
    assert.deepEqual(sideEffects, [], key);
  }
});

test("does not switch, retarget, or publish CLI availability when persistence fails", async () => {
  const { deps, calls } = createSettingHarness();
  const previous = { codex: true, claude: "false", opencode: false, unknown: true };
  const sideEffects: unknown[][] = [];
  deps.readStoredToolSettings = () => ({ cliEnabledByName: previous as unknown as CliEnabledByName });
  deps.updateStoredToolSettings = (patch) => { calls.toolSettings.push(patch); return false; };
  deps.setCurrentCli = async (...args) => { sideEffects.push(args); };
  deps.retargetDisabledLoopSubtaskSelections = (...args) => { sideEffects.push(args); };
  deps.publishCliEnabled = (...args) => { sideEffects.push(args); };
  await handleUpdateSettingMessage({ type: "updateSetting", key: "cliEnabled.codex", value: false }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "cliEnabled.codex", value: "false" }, deps);
  await handleUpdateSettingMessage({ type: "updateSetting", key: "cliEnabled.codex.extra", value: false }, deps);
  assert.deepEqual(calls.toolSettings, [{ cliEnabledByName: { codex: false, opencode: false } }]);
  assert.deepEqual(previous, { codex: true, claude: "false", opencode: false, unknown: true });
  assert.deepEqual(sideEffects, []);
  assert.equal(calls.postPanelState, 3);
});

test("awaits the CLI switch before retargeting, publishing, and refreshing a saved availability map", async () => {
  const { deps } = createSettingHarness();
  const events: unknown[][] = [];
  let currentCli: CliName = "codex";
  let finishSwitch!: () => void;
  const switchGate = new Promise<void>((resolve) => { finishSwitch = resolve; });
  const previous = { codex: true, claude: "false", opencode: false, unknown: true };
  deps.getCurrentCli = () => currentCli;
  deps.readStoredToolSettings = () => ({ cliEnabledByName: previous as unknown as CliEnabledByName });
  deps.updateStoredToolSettings = (patch) => { events.push(["save", patch]); return true; };
  deps.setCurrentCli = async (cli) => {
    events.push(["switch-start", cli]);
    await switchGate;
    currentCli = cli;
    events.push(["switch-complete", cli]);
  };
  deps.retargetDisabledLoopSubtaskSelections = (cli) => { events.push(["retarget", cli, currentCli]); };
  deps.publishCliEnabled = (map) => { events.push(["publish", map, currentCli]); };
  deps.postPanelState = async () => { events.push(["refresh", currentCli]); };
  const pending = handleUpdateSettingMessage({ type: "updateSetting", key: "cliEnabled.codex", value: false }, deps);
  try {
    assert.deepEqual(events, [
      ["save", { cliEnabledByName: { codex: false, opencode: false } }],
      ["switch-start", "claude"],
    ]);
    assert.equal(currentCli, "codex");
  } finally {
    finishSwitch();
    await pending;
  }
  assert.deepEqual(events, [
    ["save", { cliEnabledByName: { codex: false, opencode: false } }],
    ["switch-start", "claude"],
    ["switch-complete", "claude"],
    ["retarget", "claude", "claude"],
    ["publish", { codex: false, opencode: false }, "claude"],
    ["refresh", "claude"],
  ]);
  assert.deepEqual(previous, { codex: true, claude: "false", opencode: false, unknown: true });
});
