import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import type { ModelSettingsHostDeps } from "../../extensionHost/modelSettings";

installVscodeMock();

const configService = require("../../config/configService") as typeof import("../../config/configService");
const { createModelSettingsHost } = require("../../extensionHost/modelSettings") as typeof import("../../extensionHost/modelSettings");
const modelSelectionStore = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
const { ensureCliModelStore } = modelSelectionStore;

test("Grok host refreshes actual config models and resolves normal and role selections per config", async (context) => {
  let content = '[models]\ndefault = "grok"\n[model.grok]\nmodel = "grok-4.7-kedaya"\n[model."gpt-6.1-sol"]\nmodel = "gpt-6.1-sol"';
  const readConfig = context.mock.method(configService, "readGrokConfigText", async () => content);
  let store = ensureCliModelStore();
  context.mock.method(modelSelectionStore, "writeModelStore", () => undefined);
  store.optionsByConfigId.profile = ["manual-stale"];
  store.selectedByConfigId.profile = "gpt-6.1-sol";
  store.selectedLoopByConfigId.profile = { main: "gpt-6.1-sol", subtask: "removed" };
  const thinking: ReturnType<ModelSettingsHostDeps["getOpenCodeThinkingState"]> = {
    providerId: null, modelId: null, reasoning: "unknown", options: [], configuredDefaultVariant: null,
    selectedVariant: null, status: "unknown", source: "fallback", disabled: true,
  };
  const host = createModelSettingsHost({
    getCurrentCli: () => "grok", setCurrentCli: () => undefined,
    getModelStore: () => store, setModelStore: (value) => { store = value; },
    getWorkspaceSettings: () => ({}), setWorkspaceSettings: () => undefined,
    getPromptHistoryStore: () => ({ items: [] }), setPromptHistoryStore: () => undefined,
    getModelSelectionStoreState: () => ({ store, lastReadError: null, lastWriteError: null }),
    getActiveWorkspaceKey: () => "workspace", getConfigHeartbeatSnapshot: () => null,
    getOpenCodeThinkingState: () => thinking, setOpenCodeThinkingState: () => undefined,
    getOpenCodeSmallThinkingState: () => thinking, setOpenCodeSmallThinkingState: () => undefined,
    getOpenCodeModelsState: () => undefined, setOpenCodeModelsState: () => undefined,
    getOpenCodeThinkingContextKey: () => "", setOpenCodeThinkingContextKey: () => undefined,
    getOpenCodeThinkingConfigId: () => null, setOpenCodeThinkingConfigId: () => undefined,
    getOpenCodeThinkingExactModels: () => ({ main: null, subtask: null }), setOpenCodeThinkingExactModels: () => undefined,
    getOpenCodeThinkingRequestId: () => 0, setOpenCodeThinkingRequestId: () => undefined,
    getWorkspacePreferredConfigIdForCli: () => "profile", resolveModelConfigIdForCli: (_cli, state) => state.activeConfigId,
    postPanelState: async () => undefined, resolveWorkspaceCwd: () => undefined,
    getExtensionUri: () => ({}) as ReturnType<ModelSettingsHostDeps["getExtensionUri"]>,
    updateStatusBar: () => undefined, getActiveConversationTab: () => null, getActiveConversationTabId: () => null,
    getConversationTabById: () => null, isTabRunActive: () => false,
    preloadUserMessageForPrompt: (input) => input, resolvePromptRunTarget: () => null,
    runPrompt: async () => undefined, sanitizeConversationTabRecord: () => null, logError: () => undefined,
  });
  const configState = { configs: [], activeConfigId: "profile" };
  await host.refreshGrokConfigModels(configState);
  assert.equal(host.getSelectedCliModel("grok", "profile"), "gpt-6.1-sol");
  assert.equal(host.getSelectedLoopCliModel("grok", "main", "profile"), "gpt-6.1-sol");
  assert.equal(host.getSelectedLoopCliModel("grok", "subtask", "profile"), "grok");
  const state = host.buildModelState({ grok: "profile" });
  assert.deepEqual(state.optionsByCli.grok, ["grok", "gpt-6.1-sol"]);
  assert.deepEqual(state.labelsByCli?.grok, { grok: "grok-4.7-kedaya", "gpt-6.1-sol": "gpt-6.1-sol" });
  assert.deepEqual(state.managedByCli.grok, []);
  assert.deepEqual(state.loopOptionsByCli?.grok, { main: ["grok", "gpt-6.1-sol"], subtask: ["grok", "gpt-6.1-sol"] });
  host.selectCliLoopModel("grok", "subtask", "gpt-6.1-sol", "profile");
  assert.equal(host.getSelectedLoopCliModel("grok", "subtask", "profile"), "gpt-6.1-sol");
  assert.deepEqual(store.optionsByConfigId.profile, ["manual-stale"]);
  host.selectCliModel("grok", "grok", "profile");
  assert.equal(host.getSelectedCliModel("grok", "profile"), "grok");
  content = '[model.updated]\nmodel = "gpt-6.1-sol"';
  await host.refreshGrokConfigModels(configState);
  assert.equal(host.getSelectedCliModel("grok", "profile"), "updated");
  assert.deepEqual(host.buildModelState({ grok: "profile" }).labelsByCli?.grok, { updated: "gpt-6.1-sol" });
  assert.deepEqual(host.buildModelState({ grok: "other-profile" }).labelsByCli?.grok, {});
  assert.equal(await host.resolveGrokModelForRun("gpt-6.1-sol"), "updated");
  assert.equal(host.getSelectedLoopCliModel("grok", "main", "profile"), "updated");
  assert.equal(host.getSelectedCliModel("grok", "other-profile"), null);
  await host.refreshGrokConfigModels({ configs: [], activeConfigId: null });
  host.selectCliModel("grok", "updated", null);
  assert.equal(host.getSelectedCliModel("grok", null), "updated");
  host.selectCliLoopModel("grok", "main", "updated", null);
  assert.equal(host.getSelectedLoopCliModel("grok", "main", null), "updated");
  content = "[[[";
  await host.refreshGrokConfigModels(configState);
  assert.deepEqual(host.getModelOptionsForCli("grok", "profile"), []);
  assert.deepEqual(host.buildModelState({ grok: "profile" }).labelsByCli?.grok, {});
  assert.equal(host.getSelectedCliModel("grok", "profile"), null);
  await assert.rejects(() => host.resolveGrokModelForRun("updated"), /Grok/);
  content = "";
  await host.refreshGrokConfigModels(configState);
  assert.equal(host.buildModelState({ grok: "profile" }).selectedLoopByCli?.grok?.main, null);
  await assert.rejects(() => host.resolveGrokModelForRun(null), /Grok/);
  assert.equal(readConfig.mock.callCount(), 8);
});
