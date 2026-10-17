import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import type { CliName, ThinkingMode } from "../../cli/types";
import type { GraphRunRecord } from "../../graph/types";
import type { PanelMessageHandlerDeps } from "../../sessionMessageHandlers";
import type { PanelMessage } from "../../webview/types";

installVscodeMock();

const { supportsCliManagedModelSelection } = require("../../cli/modelArgs") as typeof import("../../cli/modelArgs");
const { isThinkingMode } = require("../../promptRunState") as typeof import("../../promptRunState");
const {
  buildModelState,
  deleteCliModelFromStore,
  ensureCliModelStore,
  getCliModelLoopRoleFlagsFromStore,
  getManagedModelOptionsForCliFromStore,
  getModelOptionsForCliFromStore,
  getOpenCodeRoleModelFromStore,
  getSelectedCliModelFromStore,
  getSelectedLoopCliModelFromStore,
  getSelectedLoopThinkingModeFromStore,
  moveCliModelInStore,
  renameCliModelInStore,
  selectCliLoopModelInStore,
  selectCliModelInStore,
  setCliModelLoopRoleInStore,
  setOpenCodeRoleModelInStore,
  setSelectedLoopThinkingModeInStore,
} = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
const {
  handleSendPromptMessage,
  handleUpdateSettingMessage,
} = require("../../sessionMessageActions") as typeof import("../../sessionMessageActions");
const { createGraphRuntimeHost } = require("../../extensionHost/graphRuntime") as typeof import("../../extensionHost/graphRuntime");

function normalizeThinkingModeForCli(cli: CliName, mode: ThinkingMode): ThinkingMode {
  if (cli === "grok") {
    return mode;
  }
  if (cli === "codex" && mode === "off") {
    return "low";
  }
  return mode;
}

test("stores Grok loop role models per config and keeps Codex, OpenCode, and Claude contracts", () => {
  assert.equal(supportsCliManagedModelSelection("grok"), true);
  assert.equal(supportsCliManagedModelSelection("claude"), false);
  let store = ensureCliModelStore();
  store = selectCliModelInStore(store, "grok", "  grok-4  ", "grok-config");
  store = selectCliModelInStore(store, "grok", "grok-ultra", "grok-config");
  assert.equal(getSelectedCliModelFromStore(store, "grok", "grok-config"), "grok-ultra");
  assert.deepEqual(getModelOptionsForCliFromStore(store, "grok", "grok-config"), ["grok-4", "grok-ultra"]);
  assert.deepEqual(getManagedModelOptionsForCliFromStore(store, "grok", "grok-config"), ["grok-4", "grok-ultra"]);
  assert.equal(store.selectedByConfigId["grok-config"], "grok-ultra");
  assert.deepEqual(getCliModelLoopRoleFlagsFromStore(store, "grok", "grok-4", "grok-config"), {
    main: true,
    subtask: true,
  });

  store = selectCliModelInStore(store, "codex", "gpt-5", "codex-config");
  store = selectCliLoopModelInStore(store, "codex", "main", "gpt-5", "codex-config");
  store = selectCliLoopModelInStore(store, "codex", "subtask", "gpt-5", "codex-config");
  store = setSelectedLoopThinkingModeInStore(store, "codex", "main", "gpt-5", "low", "codex-config");
  const codexLoopSelection = store.selectedLoopByConfigId["codex-config"];

  store = selectCliLoopModelInStore(store, "grok", "main", "grok-4", "grok-config");
  store = selectCliLoopModelInStore(store, "grok", "subtask", "grok-ultra", "grok-config");
  assert.deepEqual(store.selectedLoopByConfigId["codex-config"], codexLoopSelection);
  assert.equal(getSelectedLoopCliModelFromStore(store, "grok", "main", "grok-config"), "grok-4");
  assert.equal(getSelectedLoopCliModelFromStore(store, "grok", "subtask", "grok-config"), "grok-ultra");
  assert.equal(getSelectedLoopCliModelFromStore(store, "codex", "main", "codex-config"), "gpt-5");
  assert.equal(store.selectedLoopByConfigId["grok-config"]?.main, "grok-4");
  assert.equal(store.selectedLoopByConfigId["codex-config"]?.main, "gpt-5");

  const mainOnly = setCliModelLoopRoleInStore(store, "grok", "grok-4", "subtask", false, "grok-config");
  assert.equal(mainOnly.updated, true);
  store = mainOnly.store;
  assert.deepEqual(getCliModelLoopRoleFlagsFromStore(store, "grok", "grok-4", "grok-config"), {
    main: true,
    subtask: false,
  });
  const rejected = setCliModelLoopRoleInStore(store, "grok", "grok-4", "main", false, "grok-config");
  assert.equal(rejected.updated, false);
  assert.deepEqual(getCliModelLoopRoleFlagsFromStore(rejected.store, "grok", "grok-4", "grok-config"), {
    main: true,
    subtask: false,
  });
  store = rejected.store;
  assert.equal(getSelectedLoopCliModelFromStore(store, "grok", "subtask", "grok-config"), "grok-ultra");

  store = setSelectedLoopThinkingModeInStore(store, "grok", "main", "grok-4", "off", "grok-config");
  store = setSelectedLoopThinkingModeInStore(store, "grok", "subtask", "grok-ultra", "high", "grok-config");
  assert.equal(getSelectedLoopThinkingModeFromStore(store, "grok", "main", "grok-4", "grok-config"), "off");
  assert.equal(getSelectedLoopThinkingModeFromStore(store, "grok", "subtask", "grok-ultra", "grok-config"), "high");

  const renamed = renameCliModelInStore(store, "grok", "grok-4", "grok-4.7", "grok-config");
  assert.equal(renamed.renamedModel, "grok-4.7");
  store = renamed.store;
  assert.deepEqual(store.loopRolesByConfigId["grok-config"]?.["grok-4.7"], { main: true, subtask: false });
  assert.equal(store.loopRolesByConfigId["grok-config"]?.["grok-4"], undefined);
  assert.equal(store.selectedLoopByConfigId["grok-config"]?.main, "grok-4.7");
  assert.equal(store.selectedLoopByConfigId["grok-config"]?.subtask, "grok-ultra");
  assert.equal(store.loopThinkingByConfigId["grok-config"]?.main?.["grok-4.7"], "off");
  assert.equal(store.loopThinkingByConfigId["grok-config"]?.main?.["grok-4"], undefined);
  assert.equal(store.loopThinkingByConfigId["grok-config"]?.subtask?.["grok-ultra"], "high");
  assert.deepEqual(store.selectedLoopByConfigId["codex-config"], codexLoopSelection);
  assert.equal(store.loopThinkingByConfigId["codex-config"]?.main?.["gpt-5"], "low");

  const moved = moveCliModelInStore(store, "grok", "grok-ultra", "up", "grok-config");
  assert.equal(moved.movedModel, "grok-ultra");
  store = moved.store;
  assert.deepEqual(getModelOptionsForCliFromStore(store, "grok", "grok-config"), ["grok-ultra", "grok-4.7"]);

  const beforeDeleteState = buildModelState(store, () => null, {
    grok: "grok-config",
    codex: "codex-config",
    opencode: "oc-config",
    claude: "claude-config",
  });
  assert.deepEqual(beforeDeleteState.loopOptionsByCli?.grok, {
    main: ["grok-ultra", "grok-4.7"],
    subtask: ["grok-ultra"],
  });
  assert.deepEqual(beforeDeleteState.selectedLoopByCli?.grok, {
    main: "grok-4.7",
    subtask: "grok-ultra",
  });
  assert.deepEqual(beforeDeleteState.selectedLoopThinkingByCli?.grok, {
    main: "off",
    subtask: "high",
  });
  assert.equal(beforeDeleteState.selectedLoopByCli?.codex?.main, "gpt-5");
  assert.equal(beforeDeleteState.selectedLoopThinkingByCli?.codex?.main, "low");

  store = deleteCliModelFromStore(store, "grok", "grok-4.7", "grok-config");
  assert.deepEqual(getManagedModelOptionsForCliFromStore(store, "grok", "grok-config"), ["grok-ultra"]);
  assert.equal(store.loopRolesByConfigId["grok-config"]?.["grok-4.7"], undefined);
  assert.equal(store.selectedLoopByConfigId["grok-config"]?.main, undefined);
  assert.equal(store.selectedLoopByConfigId["grok-config"]?.subtask, "grok-ultra");
  assert.equal(store.loopThinkingByConfigId["grok-config"]?.main, undefined);
  assert.equal(store.loopThinkingByConfigId["grok-config"]?.subtask?.["grok-ultra"], "high");
  assert.equal(store.selectedLoopByConfigId["codex-config"]?.main, "gpt-5");

  store = setOpenCodeRoleModelInStore(store, "oc-config", "main", "provider/main-model");
  store = setOpenCodeRoleModelInStore(store, "oc-config", "subtask", "provider/small-model");
  assert.equal(getOpenCodeRoleModelFromStore(store, "oc-config", "main"), "provider/main-model");
  assert.equal(getSelectedLoopCliModelFromStore(store, "opencode", "subtask", "oc-config"), "provider/small-model");
  assert.equal(store.selectedLoopByConfigId["oc-config"], undefined);

  const claudeStore = selectCliModelInStore(store, "claude", "claude-sonnet", "claude-config");
  assert.equal(getSelectedCliModelFromStore(claudeStore, "claude", "claude-config"), null);
  const claudeLoop = selectCliLoopModelInStore(claudeStore, "claude", "main", "claude-sonnet", "claude-config");
  assert.equal(getSelectedLoopCliModelFromStore(claudeLoop, "claude", "main", "claude-config"), null);
  assert.equal(setCliModelLoopRoleInStore(claudeLoop, "claude", "claude-sonnet", "main", true, "claude-config").updated, false);
  assert.equal(claudeLoop.selectedLoopByConfigId["claude-config"], undefined);

  const state = buildModelState(store, () => null, {
    grok: "grok-config",
    codex: "codex-config",
    opencode: "oc-config",
    claude: "claude-config",
  });
  assert.equal(state.selectedByCli.grok, "grok-ultra");
  assert.deepEqual(state.optionsByCli.grok, ["grok-ultra"]);
  assert.deepEqual(state.managedByCli.grok, ["grok-ultra"]);
  assert.deepEqual(state.loopOptionsByCli?.grok, {
    main: ["grok-ultra"],
    subtask: ["grok-ultra"],
  });
  assert.deepEqual(state.selectedLoopByCli?.grok, {
    main: "grok-ultra",
    subtask: "grok-ultra",
  });
  assert.equal(state.selectedLoopThinkingByCli?.grok?.subtask, "high");
  assert.equal(state.selectedLoopByCli?.codex?.main, "gpt-5");
  assert.equal(state.selectedLoopByCli?.opencode?.main, "provider/main-model");
  assert.equal(state.selectedLoopByCli?.opencode?.subtask, "provider/small-model");
  assert.equal(state.loopOptionsByCli?.opencode, undefined);
  assert.equal(state.selectedLoopByCli?.claude, undefined);
  assert.equal(state.loopOptionsByCli?.claude, undefined);
});

function createPromptDeps(cli: CliName) {
  const calls: {
    runLoop: Array<Record<string, unknown>>;
    runGraph: Array<Record<string, unknown>>;
    runPrompt: Array<Record<string, unknown>>;
    thinking: unknown[][];
  } = {
    runLoop: [],
    runGraph: [],
    runPrompt: [],
    thinking: [],
  };
  const deps = {
    getCurrentCli: () => cli,
    getWorkspaceSettings: () => ({}),
    saveWorkspaceSettings: () => undefined,
    isCliName: (value: string) => value === "codex" || value === "claude" || value === "opencode" || value === "grok" || value === "gemini",
    getActiveConversationTab: () => ({ id: "tab-1", cli, sessionId: null }),
    getActiveConversationTabId: () => "tab-1",
    getConversationTabById: () => null,
    resolveLoopSubtaskConversationContext: () => null,
    isInteractiveMode: (value: unknown) => value === "coding" || value === "loop" || value === "graph" || value === "loop_plus",
    normalizeVisibleInteractiveMode: (mode: "coding" | "loop" | "graph" | "loop_plus") => mode,
    setWorkspaceInteractiveModeForCli: () => undefined,
    getWorkspaceLoopExecutionMode: () => "main_sub_multi_agent" as const,
    buildPromptWithAutoContext: (prompt: string) => ({ modelPrompt: prompt, contextTags: [] as string[] }),
    maybeInjectLongTermMemoryForPrompt: (_displayPrompt: string, modelPrompt: string) => modelPrompt,
    resolveCodexImagePathsForPrompt: async () => [],
    waitForConfigApply: async () => true,
    getActiveConfigIdForCli: () => `${cli}-config`,
    getSelectedCliModel: () => `${cli}-selected`,
    getSelectedLoopCliModel: (_targetCli: CliName, role: "main" | "subtask") => role === "main" ? `${cli}-main` : `${cli}-sub`,
    getSelectedLoopThinkingMode: () => "off" as const,
    isThinkingMode,
    normalizeThinkingModeForCli,
    setSelectedLoopThinkingMode: (...args: unknown[]) => {
      calls.thinking.push(args);
    },
    loadModelStore: () => undefined,
    resolveLoopResumeTaskFromPrompt: () => null,
    isLoopResumePrompt: () => false,
    recordPromptHistory: () => undefined,
    postPanelState: async () => undefined,
    resolvePromptRunTarget: () => ({ tabId: "tab-1", cli, sessionId: null }),
    preloadUserMessageForPrompt: (input: Record<string, unknown>) => input,
    runLoopPrompt: async (input: Record<string, unknown>) => {
      calls.runLoop.push(input);
    },
    runGraphPrompt: async (input: Record<string, unknown>) => {
      calls.runGraph.push(input);
    },
    runPrompt: async (input: Record<string, unknown>) => {
      calls.runPrompt.push(input);
    },
    maybeWakeLoopMainAfterSubtaskContinuation: async () => undefined,
    getLatestLoopRoundRunRecord: () => null,
  };
  return { deps: deps as unknown as PanelMessageHandlerDeps, calls };
}

test("Grok Loop, Loop+, and Graph prompts carry role models and keep off thinking", async () => {
  for (const interactiveMode of ["loop", "loop_plus"] as const) {
    const { deps, calls } = createPromptDeps("grok");
    await handleSendPromptMessage({
      type: "sendPrompt",
      prompt: "run grok",
      interactiveMode,
    } as Extract<PanelMessage, { type: "sendPrompt" }>, deps);
    assert.equal(calls.runLoop.length, 1);
    assert.equal(calls.runPrompt.length, 0);
    assert.equal(calls.runLoop[0]?.loopMainModel, "grok-main");
    assert.equal(calls.runLoop[0]?.loopSubtaskModel, "grok-sub");
    assert.equal(calls.runLoop[0]?.model, "grok-main");
    assert.equal(calls.runLoop[0]?.loopMainThinkingMode, "off");
    assert.equal(calls.runLoop[0]?.loopSubtaskThinkingMode, "off");
  }

  const graph = createPromptDeps("grok");
  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "run graph",
    interactiveMode: "graph",
    loopMainThinkingMode: "off",
  } as Extract<PanelMessage, { type: "sendPrompt" }>, graph.deps);
  assert.equal(graph.calls.runGraph[0]?.loopMainModel, "grok-main");
  assert.equal(graph.calls.runGraph[0]?.loopSubtaskModel, "grok-sub");
  assert.equal(graph.calls.runGraph[0]?.loopMainThinkingMode, "off");

  const coding = createPromptDeps("grok");
  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "code",
    interactiveMode: "coding",
    model: "grok-selected",
  } as Extract<PanelMessage, { type: "sendPrompt" }>, coding.deps);
  assert.equal(coding.calls.runPrompt[0]?.model, "grok-selected");
  assert.equal(coding.calls.runPrompt[0]?.loopMainModel, undefined);
  assert.equal(coding.calls.runPrompt[0]?.loopSubtaskModel, undefined);

  const claude = createPromptDeps("claude");
  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "loop claude",
    interactiveMode: "loop",
  } as Extract<PanelMessage, { type: "sendPrompt" }>, claude.deps);
  assert.equal(claude.calls.runLoop[0]?.loopMainModel, undefined);
  assert.equal(claude.calls.runLoop[0]?.loopSubtaskModel, undefined);

  const openCode = createPromptDeps("opencode");
  await handleSendPromptMessage({
    type: "sendPrompt",
    prompt: "loop opencode",
    interactiveMode: "loop",
    loopMainThinkingMode: "high",
  } as Extract<PanelMessage, { type: "sendPrompt" }>, openCode.deps);
  assert.equal(openCode.calls.runLoop[0]?.loopMainModel, "opencode-main");
  assert.equal(openCode.calls.runLoop[0]?.loopSubtaskModel, "opencode-sub");
  assert.equal(openCode.calls.runLoop[0]?.loopMainThinkingMode, undefined);

  const grokThinking = createPromptDeps("grok");
  await handleUpdateSettingMessage({
    type: "updateSetting",
    key: "selectedLoopThinkingMode.grok.main",
    value: "off",
  }, grokThinking.deps);
  assert.deepEqual(grokThinking.calls.thinking[0], ["grok", "main", "grok-main", "off", "grok-config"]);

  const codexThinking = createPromptDeps("codex");
  await handleUpdateSettingMessage({
    type: "updateSetting",
    key: "selectedLoopThinkingMode.codex.subtask",
    value: "off",
  }, codexThinking.deps);
  assert.deepEqual(codexThinking.calls.thinking[0], ["codex", "subtask", "codex-sub", "low", "codex-config"]);

  const host = createGraphRuntimeHost({
    getActiveWorkspaceKey: () => "workspace",
    getActiveConversationTabId: () => "tab-1",
    resolvePromptRunTarget: () => null,
    resolveGraphRunSessionId: () => null,
    getActiveConfigIdForCli: (cli) => `${cli}-config`,
    getSelectedCliModel: (cli) => cli === "claude" ? "claude-sonnet" : `${cli}-selected`,
    getSelectedLoopCliModel: (_cli, role) => role === "main" ? "stored-main" : "stored-sub",
    getSelectedLoopThinkingMode: () => "off",
    normalizeThinkingModeForCli,
    getEffectiveThinkingMode: () => "high",
    getGlobalLoopSubtaskMaxThinkingMode: () => "xhigh",
    isThinkingMode,
    resolveOpenCodeRoleModelsForConfig: () => ({ main: "opencode-main", subtask: "opencode-sub", fallback: {} }),
    createMessageId: () => "message-1",
    resolveWorkspaceCwd: () => undefined,
    postPanelState: async () => undefined,
    persistGraphRunTickState: (run) => run,
    scheduleGraphRunAutoWake: () => undefined,
    sendRunStatusForTab: () => undefined,
    createGraphNodeRunTarget: (cli) => ({ tabId: "node-tab", cli, sessionId: null }),
    runPrompt: async () => undefined,
    closeConversationTabAndRefreshPanel: async () => undefined,
    errorToMessage: (error) => String(error),
    messages: {} as import("../../extensionHost/graphMessages").GraphMessagesHost,
  });
  const routedRun = {
    modelRouting: {
      planner: { role: "main", model: "planner-grok", fallback: "planner fallback" },
      executor: { role: "subtask", model: "executor-grok", fallback: "executor fallback" },
    },
  } as GraphRunRecord;
  assert.deepEqual(host.resolveGraphResumePromptModels(routedRun, "grok", "grok-config"), {
    model: "planner-grok",
    loopMainModel: "planner-grok",
    loopSubtaskModel: "executor-grok",
    loopMainModelFallback: "planner fallback",
    loopSubtaskModelFallback: "executor fallback",
  });
  assert.deepEqual(host.resolveGraphResumePromptModels({} as GraphRunRecord, "grok", "grok-config"), {
    model: "stored-main",
    loopMainModel: "stored-main",
    loopSubtaskModel: "stored-sub",
  });
  assert.deepEqual(host.resolveGraphResumePromptModels({} as GraphRunRecord, "claude", "claude-config"), {
    model: "claude-sonnet",
  });
  assert.equal(host.resolvePromptRunThinkingModeForRole({
    displayPrompt: "p",
    modelPrompt: "p",
    contextTags: [],
    loopMainThinkingMode: "off",
  }, "grok", "main", "stored-main"), "off");
  assert.equal(host.resolvePromptRunThinkingModeForRole({
    displayPrompt: "p",
    modelPrompt: "p",
    contextTags: [],
  }, "grok", "subtask", "stored-sub"), "off");
  assert.equal(host.resolvePromptRunThinkingModeForRole({
    displayPrompt: "p",
    modelPrompt: "p",
    contextTags: [],
    loopSubtaskThinkingMode: "off",
  }, "codex", "subtask", "stored-sub"), "low");
});
