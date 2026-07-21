import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const {
  handlePanelMessageWithDeps,
} = require("../sessionMessageHandlers") as typeof import("../sessionMessageHandlers");
const {
  buildOpenCodeRunFailureMessage,
  parseOpenCodeRunOutput,
} = require("../cli/commandRunner") as typeof import("../cli/commandRunner");
const {
  buildHiddenRetryFailureMessage,
} = require("../hiddenRetry") as typeof import("../hiddenRetry");
const {
  hasAssistantFinalConclusionAfterMessage,
} = require("../finalConclusion") as typeof import("../finalConclusion");

import type {
  ConversationTabRecordForPanel,
  PanelMessageHandlerDeps,
  PromptRunInputForPanel,
} from "../sessionMessageHandlers";
import type { CliName, InteractiveMode, LoopExecutionMode, MacTaskShell, ThinkingMode } from "../cli/types";
import type { ToolSettingsState } from "../toolSettings";
import type { ChatMessage, PanelMessage } from "../webview/types";
import type { WorkspaceSettings } from "../workspaceSettingsStore";

type SentPromptRun = {
  input: PromptRunInputForPanel;
  options?: { targetTabId?: string | null };
};

type SentLoopPromptRun = {
  input: PromptRunInputForPanel;
  options: Parameters<PanelMessageHandlerDeps["runLoopPrompt"]>[1];
};

type WakeLoopMainCall = {
  context: Parameters<PanelMessageHandlerDeps["maybeWakeLoopMainAfterSubtaskContinuation"]>[0];
  options: Parameters<PanelMessageHandlerDeps["maybeWakeLoopMainAfterSubtaskContinuation"]>[1];
};

type SendPromptHarness = {
  deps: PanelMessageHandlerDeps;
  calls: {
    ensured: number;
    postPanelState: number;
    savedSettings: WorkspaceSettings[];
    statusUpdates: number;
    activeTabSwitches: string[];
    interactiveModes: Array<{ cli: CliName; mode: InteractiveMode }>;
    loopExecutionModes: Array<{ cli: CliName; mode: LoopExecutionMode }>;
    promptHistory: Array<{ prompt: string; cli: CliName }>;
    promptTargets: Array<string | null>;
    preloaded: Array<{ input: PromptRunInputForPanel; target: { tabId: string; cli: CliName; sessionId: string | null } }>;
    runPrompt: SentPromptRun[];
    runLoopPrompt: SentLoopPromptRun[];
    wakeMain: WakeLoopMainCall[];
    stoppedTabs: Array<string | null>;
    toolSettingsPatches: Array<Partial<ToolSettingsState>>;
  };
  state: {
    currentCli: CliName;
    workspaceSettings: WorkspaceSettings;
  };
};

function buildOpenCodeSmokeError(output: ReturnType<typeof parseOpenCodeRunOutput>): string {
  return buildOpenCodeRunFailureMessage(
    output,
    "OpenCode exited successfully, but did not return an assistant answer. Check the OpenCode provider/model config or run `opencode run --format json` to verify it.",
  );
}

function appendOpenCodeSmokeResult(
  messages: ChatMessage[],
  stdout: string,
  stderr: string,
): void {
  const userMessageId = "user-preloaded";
  const output = parseOpenCodeRunOutput(stdout, stderr);
  if (output.finalText) {
    messages.push({
      id: "assistant-final",
      role: "assistant",
      content: output.finalText,
      createdAt: 200,
    });
  }
  if (!hasAssistantFinalConclusionAfterMessage(messages, userMessageId, { fallbackCreatedAt: 100 })) {
    messages.push({
      id: "system-opencode-empty-output",
      role: "system",
      content: buildOpenCodeSmokeError(output),
      createdAt: 200,
    });
  }
}

function createSendPromptHarness(cli: CliName = "opencode"): SendPromptHarness {
  const tab: ConversationTabRecordForPanel = {
    id: "tab-opencode-smoke",
    cli,
    sessionId: null,
    sessionIdByCli: {},
    createdAt: 100,
  };
  const calls: SendPromptHarness["calls"] = {
    ensured: 0,
    postPanelState: 0,
    savedSettings: [],
    statusUpdates: 0,
    activeTabSwitches: [],
    interactiveModes: [],
    loopExecutionModes: [],
    promptHistory: [],
    promptTargets: [],
    preloaded: [],
    runPrompt: [],
    runLoopPrompt: [],
    wakeMain: [],
    stoppedTabs: [],
    toolSettingsPatches: [],
  };
  const state: SendPromptHarness["state"] = {
    currentCli: "codex",
    workspaceSettings: {},
  };
  const persistWorkspaceSettings = (settings: WorkspaceSettings): void => {
    const snapshot: WorkspaceSettings = { ...settings };
    if (settings.interactiveModeByCli) {
      snapshot.interactiveModeByCli = { ...settings.interactiveModeByCli };
    }
    if (settings.loopExecutionModeByCli) {
      snapshot.loopExecutionModeByCli = { ...settings.loopExecutionModeByCli };
    }
    calls.savedSettings.push(snapshot);
    state.workspaceSettings = settings;
  };

  const deps: PanelMessageHandlerDeps = {
    ensureWorkspaceSessionStore: () => {
      calls.ensured += 1;
    },
    postPanelState: async () => {
      calls.postPanelState += 1;
    },
    sendSessionMessagesToPanel: () => undefined,
    getCurrentCli: () => state.currentCli,
    setCurrentCliValue: (cli) => {
      state.currentCli = cli;
    },
    getCurrentSessionId: () => null,
    showWebviewError: () => undefined,
    inspectModelManagerState: async () => undefined,
    getActiveConversationTabBinding: () => null,
    setCurrentCli: async (cli) => {
      state.currentCli = cli;
    },
    disposeInteractiveRunnerIfUnused: () => undefined,
    syncCurrentSessionWithActiveTab: () => null,
    getActiveConfigIdForCli: () => "config-opencode",
    selectCliModel: () => undefined,
    addCliModel: () => null,
    renameCliModel: () => null,
    deleteCliModel: () => undefined,
    moveCliModel: () => null,
    repairSupersededLocalSession: (_cli, sessionId) => sessionId,
    findConversationTabIdBySession: () => null,
    setActiveConversationTab: (tabId) => {
      calls.activeTabSwitches.push(tabId);
      return tabId === tab.id ? { cli: tab.cli, sessionId: tab.sessionId } : null;
    },
    updateStatusBar: () => {
      calls.statusUpdates += 1;
    },
    getWorkspaceSettings: () => state.workspaceSettings,
    saveWorkspaceSettings: persistWorkspaceSettings,
    addConversationTab: () => null,
    startNewSession: () => undefined,
    getConversationTabById: (tabId) => (tabId === tab.id ? tab : null),
    hasAnyTaskRunning: () => false,
    disposeAllInteractiveRunners: () => undefined,
    maybePromptInstallOnCliGroupSwitch: async () => undefined,
    closeConversationTabAndRefreshPanel: async () => undefined,
    confirm: async () => true,
    disposeInteractiveRunnerSession: () => undefined,
    deleteSession: () => undefined,
    detachConversationTabsFromSession: () => undefined,
    loadSessionMessages: () => [],
    getSessionLoadError: () => undefined,
    postWebviewMessage: () => undefined,
    clearAllSessions: () => undefined,
    clearPromptHistory: () => undefined,
    setWorkspaceInteractiveModeForCli: (cli, mode) => {
      calls.interactiveModes.push({ cli, mode });
      state.workspaceSettings.interactiveModeByCli = {
        ...(state.workspaceSettings.interactiveModeByCli ?? {}),
        [cli]: mode,
      };
      persistWorkspaceSettings(state.workspaceSettings);
    },
    resetConversationTabSession: async () => undefined,
    getConfigManagerPanel: () => undefined,
    applyConfigById: async () => undefined,
    readCliRules: async () => "",
    writeCliRules: async () => undefined,
    normalizeRuleTargets: (targets) => targets ?? [],
    isThinkingMode: (value: unknown): value is ThinkingMode => (
      value === "off" || value === "on" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "ultra" || value === "max"
    ),
    normalizeThinkingModeForCli: (_cli, mode) => mode,
    setCliModelThinkingMode: () => undefined,
    getSelectedCliModel: () => null,
    isInteractiveMode: (value: unknown): value is InteractiveMode => (
      value === "coding" || value === "plan" || value === "loop"
    ),
    normalizeVisibleInteractiveMode: (mode) => mode,
    setWorkspaceLoopExecutionModeForCli: (cli, mode) => {
      calls.loopExecutionModes.push({ cli, mode });
      state.workspaceSettings.loopExecutionModeByCli = {
        ...(state.workspaceSettings.loopExecutionModeByCli ?? {}),
        [cli]: mode,
      };
      persistWorkspaceSettings(state.workspaceSettings);
    },
    loadModelStore: () => undefined,
    normalizeLoopMaxRounds: () => 20,
    normalizeToolSettingsLocale: () => null,
    isCliName: (value: string): value is CliName => (
      value === "codex" || value === "claude" || value === "opencode"
    ),
    updateStoredToolSettings: (patch) => {
      calls.toolSettingsPatches.push(patch);
      return true;
    },
    isMacTaskShell: (value: unknown): value is MacTaskShell => value === "zsh" || value === "bash",
    confirmAndInitializeWorkspaceHarness: async () => true,
    installCodeGraphForWorkspace: async () => undefined,
    appendUserMessageForCli: () => undefined,
    runContextCompactionCommand: async () => undefined,
    openLoopGroupChatPanel: async () => undefined,
    getActiveConversationTabId: () => tab.id,
    getActiveConversationTab: () => tab,
    resolveLoopSubtaskConversationContext: () => null,
    getWorkspaceLoopExecutionMode: (): LoopExecutionMode => "main_sub_multi_agent",
    buildPromptWithAutoContext: (prompt) => ({ modelPrompt: prompt, contextTags: [] }),
    maybeInjectLongTermMemoryForPrompt: (_displayPrompt, modelPrompt) => modelPrompt,
    resolveCodexImagePathsForPrompt: async () => [],
    getLatestLoopRoundRunRecord: () => null,
    recordPromptHistory: (prompt, cli) => {
      calls.promptHistory.push({ prompt, cli });
    },
    resolvePromptRunTarget: (tabId) => {
      calls.promptTargets.push(tabId);
      return tabId === tab.id ? { tabId: tab.id, cli: tab.cli, sessionId: tab.sessionId } : null;
    },
    preloadUserMessageForPrompt: (input, target) => {
      calls.preloaded.push({ input, target });
      return { ...input, preloadedUserMessageId: "user-preloaded" };
    },
    runLoopPrompt: async (input, options) => {
      calls.runLoopPrompt.push({ input, options });
    },
    runPrompt: async (input, options) => {
      calls.runPrompt.push({ input, options });
    },
    maybeWakeLoopMainAfterSubtaskContinuation: async (context, options) => {
      calls.wakeMain.push({ context, options });
    },
    resolveLoopResumeTaskFromPrompt: () => null,
    isLoopResumePrompt: () => false,
    stopRunForTab: (tabId) => {
      calls.stoppedTabs.push(tabId);
    },
  };

  return { deps, calls, state };
}

test("routes AI-dialogue OpenCode sendPrompt payload through coding runPrompt", async () => {
  const { deps, calls, state } = createSendPromptHarness();
  const message: Extract<PanelMessage, { type: "sendPrompt" }> = {
    type: "sendPrompt",
    prompt: "hi",
    interactiveMode: "coding",
    contextOptions: {
      includeCurrentFile: false,
      includeSelection: false,
    },
    tabId: "tab-opencode-smoke",
    cli: "opencode",
    model: undefined,
    preserveActiveTab: false,
  };

  await handlePanelMessageWithDeps(message, deps);

  assert.equal(calls.ensured, 1);
  assert.deepEqual(calls.activeTabSwitches, ["tab-opencode-smoke"]);
  assert.equal(state.currentCli, "opencode");
  assert.deepEqual(calls.savedSettings, [
    { currentCli: "opencode" },
    {
      currentCli: "opencode",
      interactiveModeByCli: { opencode: "coding" },
    },
  ]);
  assert.deepEqual(calls.interactiveModes, [{ cli: "opencode", mode: "coding" }]);
  assert.deepEqual(calls.promptHistory, [{ prompt: "hi", cli: "opencode" }]);
  assert.deepEqual(calls.promptTargets, ["tab-opencode-smoke"]);
  assert.equal(calls.postPanelState, 1);
  assert.equal(calls.runLoopPrompt.length, 0);
  assert.equal(calls.wakeMain.length, 0);
  assert.equal(calls.runPrompt.length, 1);
  assert.deepEqual(calls.runPrompt[0].options, { targetTabId: "tab-opencode-smoke" });
  assert.deepEqual(calls.runPrompt[0].input, {
    displayPrompt: "hi",
    modelPrompt: "hi",
    contextTags: [],
    model: undefined,
    imagePaths: undefined,
    preloadedUserMessageId: "user-preloaded",
  });
  assert.equal(calls.preloaded.length, 1);
  assert.equal(calls.preloaded[0].target.cli, "opencode");
});

test("routes OpenCode Loop through runLoopPrompt while ignoring the generic Codex model field", async () => {
  const { deps, calls, state } = createSendPromptHarness();
  deps.getWorkspaceLoopExecutionMode = (cli) => {
    assert.equal(cli, "opencode");
    return "debate_multi_agent";
  };
  await handlePanelMessageWithDeps({
    type: "sendPrompt",
    prompt: "run the loop",
    interactiveMode: "loop",
    contextOptions: {
      includeCurrentFile: false,
      includeSelection: false,
    },
    tabId: "tab-opencode-smoke",
    cli: "opencode",
    model: "provider/general-model",
  }, deps);

  assert.equal(state.currentCli, "opencode");
  assert.equal(state.workspaceSettings.interactiveModeByCli?.opencode, "loop");
  assert.deepEqual(calls.interactiveModes, [{ cli: "opencode", mode: "loop" }]);
  assert.equal(calls.runPrompt.length, 0);
  assert.equal(calls.runLoopPrompt.length, 1);
  assert.deepEqual(calls.runLoopPrompt[0].options, {
    targetTabId: "tab-opencode-smoke",
    resumeTaskId: null,
    resumeRequested: false,
  });
  assert.deepEqual(calls.runLoopPrompt[0].input, {
    displayPrompt: "run the loop",
    modelPrompt: "run the loop",
    contextTags: [],
    model: undefined,
    imagePaths: undefined,
    loopExecutionMode: "debate_multi_agent",
    preloadedUserMessageId: "user-preloaded",
  });
  assert.equal(calls.wakeMain.length, 0);
  assert.equal(calls.postPanelState, 1);
});

test("uses one Codex model for a Loop request and ignores legacy role-model fields", async () => {
  const { deps, calls } = createSendPromptHarness("codex");
  const legacyMessage = {
    type: "sendPrompt",
    prompt: "run one-model loop",
    interactiveMode: "loop",
    tabId: "tab-opencode-smoke",
    cli: "codex",
    model: "  gpt-5.3-codex  ",
    loopMainModel: "legacy-main",
    loopSubtaskModel: "legacy-subtask",
  } as unknown as PanelMessage;

  await handlePanelMessageWithDeps(legacyMessage, deps);

  assert.equal(calls.runLoopPrompt.length, 1);
  assert.deepEqual(calls.runLoopPrompt[0].input, {
    displayPrompt: "run one-model loop",
    modelPrompt: "run one-model loop",
    contextTags: [],
    model: "gpt-5.3-codex",
    imagePaths: undefined,
    loopExecutionMode: "main_sub_multi_agent",
    preloadedUserMessageId: "user-preloaded",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(calls.runLoopPrompt[0].input, "loopMainModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls.runLoopPrompt[0].input, "loopSubtaskModel"), false);
});

test("persists the OpenCode Loop execution mode by CLI", async () => {
  const { deps, calls, state } = createSendPromptHarness();

  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "loopExecutionMode.opencode",
    value: "debate_multi_agent",
  }, deps);

  assert.deepEqual(calls.loopExecutionModes, [
    { cli: "opencode", mode: "debate_multi_agent" },
  ]);
  assert.equal(state.workspaceSettings.loopExecutionModeByCli?.opencode, "debate_multi_agent");
  assert.equal(calls.postPanelState, 1);
});

test("persists the Loop subtask thinking cap globally and clamps ultra", async () => {
  const { deps, calls, state } = createSendPromptHarness();

  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "loopSubtaskMaxThinkingMode",
    value: "ultra",
  }, deps);

  assert.deepEqual(calls.toolSettingsPatches, [{ loopSubtaskMaxThinkingMode: "xhigh" }]);
  assert.deepEqual(state.workspaceSettings, {});
  assert.equal(calls.postPanelState, 1);
});

test("persists implicit subagents globally and removes legacy workspace fields", async () => {
  const { deps, calls, state } = createSendPromptHarness();
  state.workspaceSettings = {
    multiAgentEnabled: true,
    codexMultiAgentEnabled: true,
  };

  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "multiAgentEnabled",
    value: false,
  }, deps);

  assert.deepEqual(calls.toolSettingsPatches, [{ multiAgentEnabled: false }]);
  assert.deepEqual(state.workspaceSettings, {});
  assert.deepEqual(calls.savedSettings, [{}]);
  assert.equal(calls.postPanelState, 1);
});

test("keeps legacy workspace values when the global implicit-subagents save fails", async () => {
  const { deps, calls, state } = createSendPromptHarness();
  state.workspaceSettings = { multiAgentEnabled: true };
  deps.updateStoredToolSettings = () => false;

  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "multiAgentEnabled",
    value: false,
  }, deps);

  assert.deepEqual(state.workspaceSettings, { multiAgentEnabled: true });
  assert.deepEqual(calls.savedSettings, []);
  assert.equal(calls.postPanelState, 1);
});

test("persists automatic compaction globally and removes legacy workspace fields", async () => {
  const { deps, calls, state } = createSendPromptHarness();
  state.workspaceSettings = {
    autoCompactContextAfterRun: true,
    autoCompactContextBeforeRun: true,
  };

  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "autoCompactContextAfterRun",
    value: false,
  }, deps);

  assert.deepEqual(calls.toolSettingsPatches, [{ autoCompactContextAfterRun: false }]);
  assert.deepEqual(state.workspaceSettings, {});
  assert.deepEqual(calls.savedSettings, [{}]);
  assert.equal(calls.postPanelState, 1);
});

test("keeps legacy automatic-compaction values when the global save fails", async () => {
  const { deps, calls, state } = createSendPromptHarness();
  state.workspaceSettings = { autoCompactContextAfterRun: false };
  deps.updateStoredToolSettings = () => false;

  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "autoCompactContextAfterRun",
    value: true,
  }, deps);

  assert.deepEqual(state.workspaceSettings, { autoCompactContextAfterRun: false });
  assert.deepEqual(calls.savedSettings, []);
  assert.equal(calls.postPanelState, 1);
});

test("persists ultra and declares it in the VS Code thinking settings schema", async () => {
  const { deps, calls, state } = createSendPromptHarness("codex");

  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "thinkingMode",
    value: "ultra",
  }, deps);

  assert.equal(state.workspaceSettings.thinkingMode, "ultra");
  assert.deepEqual(calls.savedSettings, [{ thinkingMode: "ultra" }]);
  assert.equal(calls.postPanelState, 1);

  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const properties = manifest.contributes.configuration.properties as Record<string, { enum?: string[] }>;
  const expectedThinkingEnums: Record<string, string[]> = {
    "sinitek-cli-tools.thinkingMode": ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    "sinitek-cli-tools.thinkingModeCodex": ["on", "low", "medium", "high", "xhigh", "max", "ultra"],
    "sinitek-cli-tools.thinkingModeClaude": ["off", "on", "low", "medium", "high", "xhigh", "max", "ultra"],
  };
  Object.entries(expectedThinkingEnums).forEach(([key, expectedValues]) => {
    assert.deepEqual(properties[key].enum, expectedValues, `${key} should end with max then ultra`);
  });

  const englishNls = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.nls.json"), "utf8"));
  const chineseNls = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.nls.zh-cn.json"), "utf8"));
  assert.match(englishNls["config.thinkingModeClaude.description"], /xhigh, max, and ultra/);
  assert.match(chineseNls["config.thinkingModeClaude.description"], /xhigh、max、ultra/);
  assert.match(chineseNls["config.thinkingArgs.codex.ultra.description"], /ultra/);
  assert.match(chineseNls["config.thinkingArgs.claude.ultra.description"], /ultra/);
});

test("ignores retired final-answer policy setting messages", async () => {
  const { deps, calls } = createSendPromptHarness();

  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "finalAnswerPolicy",
    value: "successful_reply_fallback",
  }, deps);
  await handlePanelMessageWithDeps({
    type: "updateSetting",
    key: "codexFinalAnswerPolicy",
    value: "completed_turn_fallback",
  }, deps);

  assert.deepEqual(calls.toolSettingsPatches, []);
  assert.equal(calls.postPanelState, 0);
});

test("forces a manual OpenCode Loop subtask continuation through coding runPrompt", async () => {
  const { deps, calls } = createSendPromptHarness();
  deps.resolveLoopSubtaskConversationContext = () => ({
    taskId: "task-opencode-loop",
    subtaskId: "subtask-routing",
    round: 2,
  });

  await handlePanelMessageWithDeps({
    type: "sendPrompt",
    prompt: "continue this subtask",
    interactiveMode: "loop",
    contextOptions: {
      includeCurrentFile: false,
      includeSelection: false,
    },
    tabId: "tab-opencode-smoke",
    cli: "opencode",
  }, deps);

  assert.deepEqual(calls.interactiveModes, [{ cli: "opencode", mode: "coding" }]);
  assert.equal(calls.runLoopPrompt.length, 0);
  assert.equal(calls.runPrompt.length, 1);
  assert.deepEqual(calls.runPrompt[0].input, {
    displayPrompt: "continue this subtask",
    modelPrompt: "continue this subtask",
    contextTags: [],
    model: undefined,
    imagePaths: undefined,
    taskRole: "subtask",
    loopTaskId: "task-opencode-loop",
    loopRound: 2,
    loopSubtaskId: "subtask-routing",
    preloadedUserMessageId: "user-preloaded",
  });
  assert.deepEqual(calls.wakeMain, [{
    context: {
      taskId: "task-opencode-loop",
      subtaskId: "subtask-routing",
      round: 2,
    },
    options: {
      tabId: "tab-opencode-smoke",
      previousRunEndedAt: 0,
      model: undefined,
    },
  }]);
});

test("saves and clears OpenCode role models through the active config", async () => {
  const { deps, calls } = createSendPromptHarness();
  const updates: Array<{ role: "primary" | "small"; value: string | null; configId: string | null }> = [];
  deps.updateOpenCodeRoleModel = async (role, value, configId) => {
    updates.push({ role, value, configId });
    return null;
  };
  await handlePanelMessageWithDeps({
    type: "updateOpenCodeRoleModel",
    role: "primary",
    value: "provider/main",
  }, deps);
  await handlePanelMessageWithDeps({
    type: "updateOpenCodeRoleModel",
    role: "small",
    value: null,
  }, deps);
  assert.deepEqual(updates, [
    { role: "primary", value: "provider/main", configId: "config-opencode" },
    { role: "small", value: null, configId: "config-opencode" },
  ]);
  assert.equal(calls.postPanelState, 2);
});

test("AI-dialogue OpenCode sendPrompt path converts JSON assistant output into a final bubble", async () => {
  const { deps, calls } = createSendPromptHarness();
  const messages: ChatMessage[] = [{
    id: "user-preloaded",
    role: "user",
    content: "hi",
    createdAt: 100,
  }];
  deps.runPrompt = async () => {
    appendOpenCodeSmokeResult(
      messages,
      [
        JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
        JSON.stringify({ type: "part_delta", part: { type: "text", text: "Hello from OpenCode" } }),
        JSON.stringify({ type: "step_finish", part: { type: "step-finish" } }),
      ].join("\n"),
      "",
    );
  };

  await handlePanelMessageWithDeps({
    type: "sendPrompt",
    prompt: "hi",
    interactiveMode: "coding",
    contextOptions: {
      includeCurrentFile: false,
      includeSelection: false,
    },
    tabId: "tab-opencode-smoke",
    cli: "opencode",
  }, deps);

  assert.equal(calls.runLoopPrompt.length, 0);
  assert.deepEqual(messages.map((message) => ({ role: message.role, content: message.content })), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hello from OpenCode" },
  ]);
  assert.equal(hasAssistantFinalConclusionAfterMessage(messages, "user-preloaded"), true);
});

test("AI-dialogue OpenCode sendPrompt path reports empty JSON output without missing-final retry text", async () => {
  const { deps, calls } = createSendPromptHarness();
  const messages: ChatMessage[] = [{
    id: "user-preloaded",
    role: "user",
    content: "hi",
    createdAt: 100,
  }];
  deps.runPrompt = async () => {
    appendOpenCodeSmokeResult(
      messages,
      [
        JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
        JSON.stringify({ type: "step_finish", part: { type: "step-finish" } }),
      ].join("\n"),
      "> build · claude-sonnet-5\n",
    );
  };

  await handlePanelMessageWithDeps({
    type: "sendPrompt",
    prompt: "hi",
    interactiveMode: "coding",
    contextOptions: {
      includeCurrentFile: false,
      includeSelection: false,
    },
    tabId: "tab-opencode-smoke",
    cli: "opencode",
  }, deps);

  assert.equal(calls.runLoopPrompt.length, 0);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "system");
  assert.match(messages[1].content, /OpenCode exited successfully, but did not return an assistant answer/);
  assert.match(messages[1].content, /> build · claude-sonnet-5/);
  assert.doesNotMatch(messages[1].content, /final conclusion bubble|没有产生最终结论气泡|自动继续|Automatic retry|missing-final-conclusion/i);
  assert.equal(hasAssistantFinalConclusionAfterMessage(messages, "user-preloaded"), false);
});

test("AI-dialogue OpenCode sendPrompt path surfaces provider JSON error instead of exit code", async () => {
  const { deps, calls } = createSendPromptHarness();
  const messages: ChatMessage[] = [{
    id: "user-preloaded",
    role: "user",
    content: "hi",
    createdAt: 100,
  }];
  deps.runPrompt = async () => {
    appendOpenCodeSmokeResult(
      messages,
      JSON.stringify({
        type: "error",
        error: {
          name: "APIError",
          data: {
            message: "访问被拒绝 (request id: req-123)",
            statusCode: 403,
            responseBody: JSON.stringify({
              error: {
                message: "访问被拒绝 (request id: req-123)",
                type: "packy_api_error",
                code: "access_denied",
              },
            }),
            metadata: {
              url: "https://www.packyapi.com/v1/chat/completions",
            },
          },
        },
      }),
      "",
    );
  };

  await handlePanelMessageWithDeps({
    type: "sendPrompt",
    prompt: "hi",
    interactiveMode: "coding",
    contextOptions: {
      includeCurrentFile: false,
      includeSelection: false,
    },
    tabId: "tab-opencode-smoke",
    cli: "opencode",
  }, deps);

  assert.equal(calls.runLoopPrompt.length, 0);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "system");
  assert.match(messages[1].content, /APIError/);
  assert.match(messages[1].content, /403/);
  assert.match(messages[1].content, /access_denied/);
  assert.match(messages[1].content, /https:\/\/www\.packyapi\.com\/v1\/chat\/completions/);
  assert.doesNotMatch(messages[1].content, /CLI exit code|CLI 退出码/);
  assert.equal(hasAssistantFinalConclusionAfterMessage(messages, "user-preloaded"), false);
});

test("AI-dialogue OpenCode sendPrompt path surfaces UnknownError server ref", async () => {
  const { deps, calls } = createSendPromptHarness();
  const messages: ChatMessage[] = [{
    id: "user-preloaded",
    role: "user",
    content: "hi",
    createdAt: 100,
  }];
  deps.runPrompt = async () => {
    appendOpenCodeSmokeResult(
      messages,
      JSON.stringify({
        type: "error",
        timestamp: 1783589988844,
        sessionID: "ses_0b9c09683ffezGC7hbA525qyCt",
        error: {
          name: "UnknownError",
          data: {
            message: "Unexpected server error. Check server logs for details.",
            ref: "err_8e6c658e",
          },
        },
      }),
      "",
    );
  };

  await handlePanelMessageWithDeps({
    type: "sendPrompt",
    prompt: "hi",
    interactiveMode: "coding",
    contextOptions: {
      includeCurrentFile: false,
      includeSelection: false,
    },
    tabId: "tab-opencode-smoke",
    cli: "opencode",
  }, deps);

  assert.equal(calls.runLoopPrompt.length, 0);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "system");
  assert.match(messages[1].content, /UnknownError/);
  assert.match(messages[1].content, /Unexpected server error\. Check server logs for details\./);
  assert.match(messages[1].content, /err_8e6c658e/);
  assert.doesNotMatch(messages[1].content, /CLI exit code|CLI 退出码/);
  assert.equal(hasAssistantFinalConclusionAfterMessage(messages, "user-preloaded"), false);
});

test("AI-dialogue OpenCode final hidden retry failure remains a visible system error", async () => {
  const { deps, calls } = createSendPromptHarness();
  const messages: ChatMessage[] = [{
    id: "user-preloaded",
    role: "user",
    content: "hi",
    createdAt: 100,
  }];
  deps.runPrompt = async () => {
    const output = parseOpenCodeRunOutput("", "\n> build · claude-sonnet-5\n");
    const finalFailureMessage = buildOpenCodeRunFailureMessage(output, "CLI exit code: 1");
    messages.push({
      id: "system-opencode-hidden-retry-final-error",
      role: "system",
      content: buildHiddenRetryFailureMessage({
        hiddenRetryCount: 5,
        maxRetries: 5,
        retryLimitMessage: "retried too many times",
        fallbackMessage: finalFailureMessage,
        lastFailureMessage: finalFailureMessage,
        lastFailurePrefix: "Last error: ",
      }),
      createdAt: 200,
    });
  };

  await handlePanelMessageWithDeps({
    type: "sendPrompt",
    prompt: "hi",
    interactiveMode: "coding",
    contextOptions: {
      includeCurrentFile: false,
      includeSelection: false,
    },
    tabId: "tab-opencode-smoke",
    cli: "opencode",
  }, deps);

  assert.equal(calls.runLoopPrompt.length, 0);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "system");
  assert.match(messages[1].content, /retried too many times/);
  assert.match(messages[1].content, /OpenCode exited successfully, but did not return an assistant answer/);
  assert.match(messages[1].content, /> build · claude-sonnet-5/);
  assert.doesNotMatch(messages[1].content, /CLI exit code/);
  assert.equal(hasAssistantFinalConclusionAfterMessage(messages, "user-preloaded"), false);
});

test("stopRun stops active OpenCode tab without creating a provider error", async () => {
  const { deps, calls } = createSendPromptHarness();

  await handlePanelMessageWithDeps({ type: "stopRun" }, deps);

  assert.deepEqual(calls.stoppedTabs, ["tab-opencode-smoke"]);
  assert.equal(calls.runPrompt.length, 0);
  assert.equal(calls.runLoopPrompt.length, 0);
});
