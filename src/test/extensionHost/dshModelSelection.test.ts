import test = require("node:test");
import assert = require("node:assert/strict");
import {
  DSH_VERIFIED_MODEL_ID,
  createDshExampleProfileText,
  parseDshConfigModels,
  toDshModelWireValue,
  type DshConfigModels,
} from "../../cli/dshConfigModels";
import { CLI_LIST } from "../../cli/types";
import type { ModelSettingsHostDeps } from "../../extensionHost/modelSettings";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createCliModelSelectionStrategies } = require("../../extensionHost/cliModelSelectionStrategies") as typeof import("../../extensionHost/cliModelSelectionStrategies");
const { ensureCliModelStore } = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
const configService = require("../../config/configService") as typeof import("../../config/configService");
const { createModelSettingsHost } = require("../../extensionHost/modelSettings") as typeof import("../../extensionHost/modelSettings");

function configured(modelIds: string[] = [DSH_VERIFIED_MODEL_ID]): DshConfigModels {
  const profile = JSON.parse(createDshExampleProfileText()) as {
    models: Array<{ id: string; name: string; input: ["text"]; maxTokens: 256 }>;
    acpModel: string;
  };
  profile.models = modelIds.map((id) => ({
    id,
    name: id,
    input: ["text"],
    maxTokens: 256,
  }));
  profile.acpModel = modelIds[0] ?? "";
  return parseDshConfigModels(JSON.stringify(profile));
}

function configuredWithRoleReasoning(): DshConfigModels {
  const profile = JSON.parse(createDshExampleProfileText()) as Record<string, unknown> & {
    models: Array<Record<string, unknown>>;
    acpModel: string;
  };
  const mainModel = "vendor/main-model";
  const subtaskModel = "vendor/subtask-model";
  const compat = { thinkingFormat: "deepseek", supportsReasoningEffort: true };
  profile.models = [
    {
      id: mainModel,
      name: mainModel,
      input: ["text"],
      maxTokens: 256,
      reasoningEfforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
      compat,
    },
    {
      id: subtaskModel,
      name: subtaskModel,
      input: ["text"],
      maxTokens: 256,
      reasoningEfforts: false,
    },
  ];
  profile.acpModel = mainModel;
  return parseDshConfigModels(JSON.stringify(profile));
}

test("DSH model selection is isolated by configId and ignores aliases", () => {
  const cache = new Map<string | null, DshConfigModels>();
  cache.set("profile-a", configured());
  cache.set("profile-b", { models: [], labels: {}, defaultModel: null, wireByModelId: {}, reasoningOptionsByModelId: {}, error: null });
  const strategies = createCliModelSelectionStrategies({
    getGrokConfigModels: () => undefined,
    resolveDefaultGrokStoreKey: () => "grok:unused",
    getDshConfigModels: (configId) => cache.get(configId ?? null),
    resolveDefaultDshStoreKey: () => "dsh:/tmp/a/active-patch.yaml",
  });
  assert.deepEqual(Object.keys(strategies), [...CLI_LIST]);
  const store = ensureCliModelStore();
  const selected = strategies.dsh.selectModel(store, toDshModelWireValue(DSH_VERIFIED_MODEL_ID), "profile-a");
  assert.equal(selected.selectedByConfigId["profile-a"], DSH_VERIFIED_MODEL_ID);
  assert.equal(selected.selectedByConfigId["profile-a"], DSH_VERIFIED_MODEL_ID);
  assert.equal(strategies.dsh.getSelectedModel(selected, "profile-a"), DSH_VERIFIED_MODEL_ID);
  assert.deepEqual(strategies.dsh.getModelOptions(selected, "profile-a"), [DSH_VERIFIED_MODEL_ID]);
  assert.deepEqual(strategies.dsh.getModelOptions(selected, "profile-b"), []);
  assert.equal(strategies.dsh.getSelectedModel(selected, "profile-b"), null);
  const loop = strategies.dsh.selectLoopModel(selected, "subtask", "not-configured-model", "profile-a");
  assert.equal(loop.selectedLoopByConfigId["profile-a"]?.subtask, undefined);
  const slashSplit = strategies.dsh.selectModel(selected, JSON.stringify(["subcoco", DSH_VERIFIED_MODEL_ID]), "profile-a");
  assert.equal(slashSplit.selectedByConfigId["profile-a"], "");
  assert.equal(strategies.dsh.resolveStoreConfigKey("profile-a"), "profile-a");
  assert.equal(strategies.dsh.resolveStoreConfigKey(null), "dsh:/tmp/a/active-patch.yaml");
  assert.equal(strategies.dsh.getModelDisplayName("not-configured-model", "profile-a"), null);
  assert.equal(strategies.dsh.getModelDisplayName(DSH_VERIFIED_MODEL_ID, "profile-a"), DSH_VERIFIED_MODEL_ID);
});

test("DSH model options preserve profile order and persist a non-default selection", () => {
  const firstModel = "vendor/first-model";
  const secondModel = "vendor/second-model";
  const config = configured([firstModel, secondModel]);
  const strategies = createCliModelSelectionStrategies({
    getGrokConfigModels: () => undefined,
    resolveDefaultGrokStoreKey: () => "grok:unused",
    getDshConfigModels: () => config,
  });
  const store = ensureCliModelStore();

  assert.deepEqual(strategies.dsh.getModelOptions(store, "profile-a"), [firstModel, secondModel]);
  assert.equal(strategies.dsh.getSelectedModel(store, "profile-a"), firstModel);

  const selected = strategies.dsh.selectModel(store, secondModel, "profile-a");

  assert.equal(selected.selectedByConfigId["profile-a"], secondModel);
  assert.equal(strategies.dsh.getSelectedModel(selected, "profile-a"), secondModel);
});

test("DSH Loop role selections keep model-specific reasoning options", () => {
  const config = configuredWithRoleReasoning();
  const strategies = createCliModelSelectionStrategies({
    getGrokConfigModels: () => undefined,
    resolveDefaultGrokStoreKey: () => "grok:unused",
    getDshConfigModels: () => config,
  });
  let store = ensureCliModelStore();
  store = strategies.dsh.selectLoopModel(store, "main", "vendor/main-model", "profile-a");
  store = strategies.dsh.selectLoopModel(store, "subtask", "vendor/subtask-model", "profile-a");

  assert.deepEqual(strategies.dsh.getModelOptions(store, "profile-a"), [
    "vendor/main-model",
    "vendor/subtask-model",
  ]);
  assert.equal(strategies.dsh.getSelectedLoopModel(store, "main", "profile-a"), "vendor/main-model");
  assert.equal(strategies.dsh.getSelectedLoopModel(store, "subtask", "profile-a"), "vendor/subtask-model");
  assert.deepEqual(config.reasoningOptionsByModelId, {
    "vendor/main-model": ["low", "medium", "high", "xhigh", "max"],
    "vendor/subtask-model": [],
  });
});

test("DSH host loads subtask models before a cross-CLI route has been persisted", async (context) => {
  const profileId = "dsh-subtask-profile";
  const profileText = createDshExampleProfileText();
  context.mock.method(configService, "getConfigById", async (
    platform: Parameters<typeof configService.getConfigById>[0],
    configId: Parameters<typeof configService.getConfigById>[1],
  ) => {
    if (platform !== "dsh" || configId !== profileId) {
      return null;
    }
    return { content: profileText, configContent: profileText } as Awaited<ReturnType<typeof configService.getConfigById>>;
  });
  let store = ensureCliModelStore();
  const thinkingState: ReturnType<ModelSettingsHostDeps["getOpenCodeThinkingState"]> = {
    providerId: null, modelId: null, reasoning: "unknown", options: [], configuredDefaultVariant: null,
    selectedVariant: null, status: "unknown", source: "fallback", disabled: true,
  };
  const host = createModelSettingsHost({
    getCurrentCli: () => "codex", setCurrentCli: () => undefined,
    getModelStore: () => store, setModelStore: (next) => { store = next; },
    getWorkspaceSettings: () => ({}), setWorkspaceSettings: () => undefined,
    getPromptHistoryStore: () => ({ items: [] }), setPromptHistoryStore: () => undefined,
    getModelSelectionStoreState: () => ({ store, lastReadError: null, lastWriteError: null }),
    getActiveWorkspaceKey: () => "workspace", getConfigHeartbeatSnapshot: () => null,
    getOpenCodeThinkingState: () => thinkingState, setOpenCodeThinkingState: () => undefined,
    getOpenCodeSmallThinkingState: () => thinkingState, setOpenCodeSmallThinkingState: () => undefined,
    getOpenCodeModelsState: () => undefined, setOpenCodeModelsState: () => undefined,
    getOpenCodeThinkingContextKey: () => "", setOpenCodeThinkingContextKey: () => undefined,
    getOpenCodeThinkingConfigId: () => null, setOpenCodeThinkingConfigId: () => undefined,
    getOpenCodeThinkingExactModels: () => ({ main: null, subtask: null }), setOpenCodeThinkingExactModels: () => undefined,
    getOpenCodeThinkingRequestId: () => 0, setOpenCodeThinkingRequestId: () => undefined,
    getWorkspacePreferredConfigIdForCli: (cli) => cli === "dsh" ? profileId : "codex-profile",
    resolveModelConfigIdForCli: (_cli, configState) => configState.activeConfigId,
    postPanelState: async () => undefined, resolveWorkspaceCwd: () => undefined,
    getExtensionUri: () => ({}) as ReturnType<ModelSettingsHostDeps["getExtensionUri"]>,
    updateStatusBar: () => undefined, getActiveConversationTab: () => null, getActiveConversationTabId: () => null,
    getConversationTabById: () => null, isTabRunActive: () => false,
    preloadUserMessageForPrompt: (input) => input, resolvePromptRunTarget: () => null,
    runPrompt: async () => undefined, sanitizeConversationTabRecord: () => null, logError: () => undefined,
  });

  await host.refreshDshConfigModels({ configs: [], activeConfigId: "codex-profile" });

  assert.ok(host.buildModelState({ dsh: profileId }).loopOptionsByCli?.dsh?.subtask.includes(DSH_VERIFIED_MODEL_ID));
});

test("DSH host publishes static reasoning options before the first prompt", async (context) => {
  const profileId = "dsh-reasoning-profile";
  const profile = JSON.parse(createDshExampleProfileText()) as {
    models: Array<Record<string, unknown>>;
    acpModel: string;
  };
  const noReasoningModel = "vendor/no-reasoning-model";
  profile.models.push({
    id: noReasoningModel,
    name: noReasoningModel,
    input: ["text"],
    maxTokens: 256,
    reasoningEfforts: false,
  });
  const profileText = JSON.stringify(profile);
  context.mock.method(configService, "getConfigById", async (
    platform: Parameters<typeof configService.getConfigById>[0],
    configId: Parameters<typeof configService.getConfigById>[1],
  ) => {
    if (platform !== "dsh" || configId !== profileId) {
      return null;
    }
    return { content: profileText, configContent: profileText } as Awaited<ReturnType<typeof configService.getConfigById>>;
  });

  let store = ensureCliModelStore();
  store.selectedByConfigId[profileId] = DSH_VERIFIED_MODEL_ID;
  store.thinkingByCliAndModel.dsh = { [DSH_VERIFIED_MODEL_ID]: "high" };
  store.selectedLoopByConfigId[profileId] = { subtask: noReasoningModel };
  store.loopThinkingByConfigId[profileId] = {
    main: { [DSH_VERIFIED_MODEL_ID]: "high" },
    subtask: { [noReasoningModel]: "xhigh" },
  };
  const thinkingState: ReturnType<ModelSettingsHostDeps["getOpenCodeThinkingState"]> = {
    providerId: null,
    modelId: null,
    reasoning: "unknown",
    options: [],
    configuredDefaultVariant: null,
    selectedVariant: null,
    status: "unknown",
    source: "fallback",
    disabled: true,
    messageKey: "follow-default",
  };
  const host = createModelSettingsHost({
    getCurrentCli: () => "dsh",
    setCurrentCli: () => undefined,
    getModelStore: () => store,
    setModelStore: (next) => { store = next; },
    getWorkspaceSettings: () => ({}),
    setWorkspaceSettings: () => undefined,
    getPromptHistoryStore: () => ({ items: [] }),
    setPromptHistoryStore: () => undefined,
    getModelSelectionStoreState: () => ({ store, lastReadError: null, lastWriteError: null }),
    getActiveWorkspaceKey: () => "workspace",
    getConfigHeartbeatSnapshot: () => null,
    getOpenCodeThinkingState: () => thinkingState,
    setOpenCodeThinkingState: () => undefined,
    getOpenCodeSmallThinkingState: () => thinkingState,
    setOpenCodeSmallThinkingState: () => undefined,
    getOpenCodeModelsState: () => undefined,
    setOpenCodeModelsState: () => undefined,
    getOpenCodeThinkingContextKey: () => "",
    setOpenCodeThinkingContextKey: () => undefined,
    getOpenCodeThinkingConfigId: () => null,
    setOpenCodeThinkingConfigId: () => undefined,
    getOpenCodeThinkingExactModels: () => ({ main: null, subtask: null }),
    setOpenCodeThinkingExactModels: () => undefined,
    getOpenCodeThinkingRequestId: () => 0,
    setOpenCodeThinkingRequestId: () => undefined,
    getWorkspacePreferredConfigIdForCli: () => profileId,
    resolveModelConfigIdForCli: (_cli, configState) => configState.activeConfigId,
    postPanelState: async () => undefined,
    resolveWorkspaceCwd: () => undefined,
    getExtensionUri: () => ({}) as ReturnType<ModelSettingsHostDeps["getExtensionUri"]>,
    updateStatusBar: () => undefined,
    getActiveConversationTab: () => null,
    getActiveConversationTabId: () => null,
    getConversationTabById: () => null,
    isTabRunActive: () => false,
    preloadUserMessageForPrompt: (input) => input,
    resolvePromptRunTarget: () => null,
    runPrompt: async () => undefined,
    sanitizeConversationTabRecord: () => null,
    logError: () => undefined,
  });

  await host.refreshDshConfigModels({ configs: [], activeConfigId: profileId });
  const state = host.buildModelState({ dsh: profileId });
  assert.deepEqual(state.optionsByCli.dsh, [DSH_VERIFIED_MODEL_ID, noReasoningModel]);
  assert.deepEqual(state.dshReasoningOptions, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(state.dshReasoningOptionsByModel, {
    [DSH_VERIFIED_MODEL_ID]: ["low", "medium", "high", "xhigh", "max"],
    [noReasoningModel]: [],
  });
  assert.deepEqual(state.loopOptionsByCli?.dsh, {
    main: [DSH_VERIFIED_MODEL_ID, noReasoningModel],
    subtask: [DSH_VERIFIED_MODEL_ID, noReasoningModel],
  });
  assert.deepEqual(state.selectedLoopByCli?.dsh, {
    main: DSH_VERIFIED_MODEL_ID,
    subtask: noReasoningModel,
  });
  assert.deepEqual(state.selectedLoopThinkingByCli?.dsh, { main: "high", subtask: null });
  assert.equal(state.thinkingModeByCli?.dsh, "high");
  assert.equal(host.getEffectiveThinkingMode("dsh", DSH_VERIFIED_MODEL_ID), "high");
});
