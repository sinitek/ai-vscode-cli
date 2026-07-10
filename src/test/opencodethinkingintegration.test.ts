import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const {
  ensureCliModelStore,
  getOpenCodeVariantFromStore,
  setOpenCodeVariantInStore,
} = require("../modelSelectionStore") as typeof import("../modelSelectionStore");
const {
  buildPanelStateWithDeps,
  isOpenCodeThinkingRequestCurrent,
} = require("../panelStateBuilder") as typeof import("../panelStateBuilder");
const {
  handleUpdateOpenCodeVariantMessage,
} = require("../sessionMessageActions") as typeof import("../sessionMessageActions");
const {
  createConfigHeartbeatCoordinator,
} = require("../webviewCommandCoordinator") as typeof import("../webviewCommandCoordinator");

import type { OpenCodeThinkingState } from "../cli/types";
import type { PanelStateBuilderDeps } from "../panelStateBuilder";
import type { PanelState } from "../webview/types";

test("persists OpenCode variants by active config and exact model", () => {
  const empty = ensureCliModelStore();
  const configA = setOpenCodeVariantInStore(empty, "config-a", "gateway/model-a", "high");
  const configB = setOpenCodeVariantInStore(configA, "config-b", "gateway/model-a", "low");
  const twoModels = setOpenCodeVariantInStore(configB, "config-a", "gateway/model-b", "max");

  assert.equal(getOpenCodeVariantFromStore(twoModels, "config-a", "gateway/model-a"), "high");
  assert.equal(getOpenCodeVariantFromStore(twoModels, "config-b", "gateway/model-a"), "low");
  assert.equal(getOpenCodeVariantFromStore(twoModels, "config-a", "gateway/model-b"), "max");

  const cleared = setOpenCodeVariantInStore(twoModels, "config-a", "gateway/model-a", null);
  assert.equal(getOpenCodeVariantFromStore(cleared, "config-a", "gateway/model-a"), null);
  assert.equal(getOpenCodeVariantFromStore(cleared, "config-b", "gateway/model-a"), "low");
});

test("does not migrate legacy ThinkingMode values into OpenCode variants", () => {
  const normalized = ensureCliModelStore({
    selectedByConfigId: {},
    optionsByConfigId: {},
    thinkingByCliAndModel: { opencode: { "gateway/model": "high" } },
    selectedLobsterByConfigId: {},
    lobsterRolesByConfigId: {},
  } as unknown as ReturnType<typeof ensureCliModelStore>);

  assert.deepEqual(normalized.openCodeVariantByConfigAndModel, {});
});

test("serializes dynamic OpenCode thinking state into PanelState", () => {
  const openCodeThinking: OpenCodeThinkingState & { configuredDefaultVariant: string | null } = {
    providerId: "gateway",
    modelId: "model",
    reasoning: true,
    options: [{ value: "custom", label: "Custom", source: "config" }],
    configuredDefaultVariant: "custom",
    selectedVariant: "custom",
    status: "ready",
    source: "config",
    disabled: false,
    messageKey: "config-variants",
  };
  const deps: PanelStateBuilderDeps = {
    currentCli: "opencode",
    configState: { configs: [], activeConfigId: "config-a" },
    workspaceSettings: {},
    processPlatform: "linux",
    cliRulePathsGlobal: { codex: "", claude: "", opencode: "" },
    getWorkspaceConfiguration: () => ({ get: <T>(_key: string, fallback?: T) => fallback }),
    getAutoAddEditorContextTags: () => false,
    getEffectiveLongTermMemoryEnabled: () => false,
    getWorkspaceAutoCompactContextAfterRun: () => false,
    getWorkspaceCodexMultiAgentEnabled: () => false,
    getGlobalFinalAnswerPolicy: () => "successful_reply_fallback",
    getGlobalLobsterMaxRounds: () => 1,
    getGlobalLobsterAutoCloseSubtaskTabs: () => false,
    buildWorkspaceLobsterExecutionModeByCli: () => ({ codex: "main_sub_multi_agent", claude: "main_sub_multi_agent", opencode: "main_sub_multi_agent" }),
    getDebugLogging: () => false,
    getLocaleSetting: () => "en",
    getMacTaskShell: () => "zsh",
    getEffectiveThinkingMode: () => "off",
    openCodeThinking,
    openCodeModels: {
      models: [{ ref: "gateway/model", label: "Model", providerId: "gateway", modelId: "model" }],
      configPrimaryRef: "gateway/default",
      configSmallRef: "gateway/small",
      selectedPrimaryRef: "gateway/model",
      selectedSmallRef: "gateway/small",
      issues: [],
    },
    getWorkspaceInteractiveMode: () => "coding",
    isInteractiveSupported: () => false,
    getProjectRulePaths: () => ({ codex: null, claude: null, opencode: null }),
    buildSessionState: () => ({ currentSessionId: null, sessions: [] }),
    buildConversationTabsState: () => ({ activeTabId: null, tabs: [] }),
    buildPromptHistoryState: () => [],
    buildLobsterGroupChatHistoryState: () => [],
    buildModelState: () => ({
      selectedByCli: { codex: null, claude: null, opencode: "gateway/model" },
      optionsByCli: { codex: [], claude: [], opencode: [] },
      managedByCli: { codex: [], claude: [], opencode: [] },
    }),
    buildEditorContextState: () => ({ filePath: null, fileLabel: null, hasSelection: false, selectionLabel: null }),
    resolveModelConfigIdForCli: () => "config-a",
    getSelectedCliModel: () => "gateway/model",
  };

  const state = buildPanelStateWithDeps(deps);
  assert.deepEqual(state.openCodeThinking, openCodeThinking);
  assert.equal(state.openCodeModels?.selectedPrimaryRef, "gateway/model");
  assert.equal(state.openCodeModels?.selectedSmallRef, "gateway/small");
  assert.equal(state.finalAnswerPolicy, "successful_reply_fallback");
});

test("refreshes heartbeat snapshots when OpenCode role overrides change", async () => {
  const configState = { configs: [{ id: "config-a", name: "A", platform: "opencode" as const }], activeConfigId: "config-a" };
  let store = ensureCliModelStore();
  let snapshot: import("../webviewCommandCoordinator").ConfigHeartbeatSnapshot | null = null;
  let running = false;
  let posted = 0;
  const coordinator = createConfigHeartbeatCoordinator({
    intervalMs: 1000,
    getCurrentCli: () => "opencode",
    getWorkspaceKey: () => "workspace",
    getSnapshot: () => snapshot,
    setSnapshot: (value) => { snapshot = value; },
    isRunning: () => running,
    setRunning: (value) => { running = value; },
    getTimer: () => null,
    setTimer: () => undefined,
    loadConfigState: async () => configState,
    getLastConfigStateLoadError: () => null,
    readNormalizedModelStoreFromDisk: () => store,
    setModelStore: () => undefined,
    resolveModelConfigIdForCli: () => "config-a",
    ensureCliModelStore,
    normalizeCliModelName: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    mergeUniqueModelNames: (...groups) => Array.from(new Set(groups.flat())),
    getSelectedLobsterCliModel: () => null,
    normalizeLobsterModelRoleFlags: () => ({ main: true, subtask: true }),
    buildPanelStateWithConfigState: async () => ({} as PanelState),
    postState: () => { posted += 1; },
    syncConfigManagerPanel: () => undefined,
    logDebug: () => undefined,
    logEssential: () => undefined,
    logError: () => undefined,
    createDisposable: (dispose) => ({ dispose }),
  });
  coordinator.updateSnapshot("opencode", configState, store);
  store = require("../modelSelectionStore").setOpenCodeRoleModelInStore(store, "config-a", "small", "gateway/small");
  await coordinator.poll();
  assert.equal(posted, 1);
  const finalSnapshot = snapshot as import("../webviewCommandCoordinator").ConfigHeartbeatSnapshot | null;
  assert.equal(finalSnapshot?.openCodeSmallModelSelected, "gateway/small");
});

test("rejects stale asynchronous OpenCode capability results", () => {
  assert.equal(isOpenCodeThinkingRequestCurrent(2, "new", 2, "new"), true);
  assert.equal(isOpenCodeThinkingRequestCurrent(1, "old", 2, "new"), false);
  assert.equal(isOpenCodeThinkingRequestCurrent(2, "old", 2, "new"), false);
});

test("handles OpenCode variant save and null clear events", async () => {
  const values: Array<string | null> = [];
  let refreshCount = 0;
  const deps = {
    updateOpenCodeVariant: (value: string | null) => values.push(value),
    postPanelState: async () => { refreshCount += 1; },
  };

  await handleUpdateOpenCodeVariantMessage({ type: "updateOpenCodeVariant", value: " high " }, deps);
  await handleUpdateOpenCodeVariantMessage({ type: "updateOpenCodeVariant", value: null }, deps);

  assert.deepEqual(values, ["high", null]);
  assert.equal(refreshCount, 2);
});

test("package no longer exposes fixed OpenCode thinking mode or thinking args", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    contributes: { configuration: { properties: Record<string, unknown> } };
  };
  const keys = Object.keys(packageJson.contributes.configuration.properties);
  assert.equal(keys.includes("sinitek-cli-tools.thinkingModeOpencode"), false);
  assert.equal(keys.some((key) => key.startsWith("sinitek-cli-tools.thinkingArgs.opencode.")), false);
});
