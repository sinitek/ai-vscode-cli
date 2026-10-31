import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import { installVscodeMock } from "../vscodeMock";
import type { GrokConfigModels } from "../../cli/grokConfigModels";
import { CLI_LIST, type CliName } from "../../cli/types";
import type { CliModelSelectionStrategyDeps } from "../../extensionHost/cliModelSelectionStrategies";
import type { ModelSettingsHostDeps } from "../../extensionHost/modelSettings";
import type { CliModelStore } from "../../modelSelectionStore";
import type { ConfigHeartbeatSnapshot } from "../../webviewCommandCoordinator";
import type { PanelState } from "../../webview/types";
import { createDshExampleProfileText } from "../../cli/dshConfigModels";
import { createKimiCodeDefaultConfigText } from "../../config/kimiCodeConfig";
import { createZcodeExampleText } from "../../config/zcodeConfig";

installVscodeMock();

const {
  createCliModelSelectionStrategies,
} = require("../../extensionHost/cliModelSelectionStrategies") as typeof import("../../extensionHost/cliModelSelectionStrategies");
const { createModelSettingsHost } = require("../../extensionHost/modelSettings") as typeof import("../../extensionHost/modelSettings");
const { resolveGrokConfigPath } = require("../../shared/userHomePaths") as typeof import("../../shared/userHomePaths");
const modelSelectionStore = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
const configService = require("../../config/configService") as typeof import("../../config/configService");
const {
  ensureCliModelStore,
  getManagedModelOptionsForCliFromStore,
  getModelOptionsForCliFromStore,
  getOpenCodeRoleModelFromStore,
  getSelectedCliModelFromStore,
  getSelectedLoopCliModelFromStore,
  selectCliLoopModelInStore,
  selectCliModelInStore,
  setOpenCodeRoleModelInStore,
} = modelSelectionStore;

const PATH_STORE_KEY = "grok:/custom/not-home/config.toml";

function grokModels(
  models: string[],
  labels: Record<string, string>,
  defaultModel: string | null,
  error: string | null = null,
): GrokConfigModels {
  return { models, labels, defaultModel, error };
}

function createStrategies(
  cache: Map<string | null, GrokConfigModels>,
  resolveDefaultGrokStoreKey: () => string = () => PATH_STORE_KEY,
  seen: Array<string | null | undefined> = [],
) {
  const deps: CliModelSelectionStrategyDeps = {
    getGrokConfigModels(configId) {
      seen.push(configId);
      if (configId === undefined) {
        return undefined;
      }
      return cache.get(configId);
    },
    resolveDefaultGrokStoreKey,
  };
  return createCliModelSelectionStrategies(deps);
}

test("registry covers CLI_LIST and does not read injected ports while it is created", () => {
  const seen: Array<string | null | undefined> = [];
  let resolverCalls = 0;
  const strategies = createStrategies(new Map(), () => {
    resolverCalls += 1;
    return PATH_STORE_KEY;
  }, seen);
  assert.deepEqual(Object.keys(strategies), [...CLI_LIST]);
  assert.equal(seen.length, 0);
  assert.equal(resolverCalls, 0);
  assert.equal(strategies.grok.resolveStoreConfigKey("profile"), "profile");
  assert.equal(strategies.grok.resolveStoreConfigKey(""), "");
  assert.equal(resolverCalls, 0);
  assert.equal(strategies.grok.resolveStoreConfigKey(null), PATH_STORE_KEY);
  assert.equal(strategies.grok.resolveStoreConfigKey(undefined), PATH_STORE_KEY);
  assert.equal(resolverCalls, 2);
  assert.equal(strategies.codex.resolveStoreConfigKey(null), null);
  assert.equal(strategies.claude.resolveStoreConfigKey("claude-config"), "claude-config");
  assert.equal(strategies.opencode.resolveStoreConfigKey(undefined), null);
});

test("strategy module does not import host side effects", () => {
  const source = fs.readFileSync(require.resolve("../../extensionHost/cliModelSelectionStrategies"), "utf8");
  assert.equal(/require\((["'])vscode\1\)/.test(source), false);
  assert.equal(/require\((["'])fs\1\)/.test(source), false);
  assert.equal(/require\((["'])path\1\)/.test(source), false);
  assert.equal(source.includes("configService"), false);
  assert.equal(source.includes("webview"), false);
  assert.equal(source.includes("logger"), false);
});

test("Codex, Claude, and OpenCode strategies delegate to modelSelectionStore", () => {
  const strategies = createStrategies(new Map());
  const store = ensureCliModelStore();
  const codexDirect = selectCliModelInStore(store, "codex", " gpt-5 ", "codex-config");
  const codexVia = strategies.codex.selectModel(store, " gpt-5 ", "codex-config");
  assert.deepEqual(codexVia, codexDirect);
  assert.equal(store.selectedByConfigId["codex-config"], undefined);
  assert.equal(
    strategies.codex.getSelectedModel(codexVia, "codex-config"),
    getSelectedCliModelFromStore(codexVia, "codex", "codex-config"),
  );
  assert.deepEqual(
    strategies.codex.getModelOptions(codexVia, "codex-config"),
    getModelOptionsForCliFromStore(codexVia, "codex", "codex-config"),
  );
  assert.deepEqual(
    strategies.codex.getManagedModelOptions(codexVia, "codex-config"),
    getManagedModelOptionsForCliFromStore(codexVia, "codex", "codex-config"),
  );
  const codexLoopDirect = selectCliLoopModelInStore(codexVia, "codex", "subtask", "gpt-5", "codex-config");
  const codexLoopVia = strategies.codex.selectLoopModel(codexVia, "subtask", "gpt-5", "codex-config");
  assert.deepEqual(codexLoopVia, codexLoopDirect);
  assert.equal(
    strategies.codex.getSelectedLoopModel(codexLoopVia, "subtask", "codex-config"),
    getSelectedLoopCliModelFromStore(codexLoopVia, "codex", "subtask", "codex-config"),
  );
  assert.equal(strategies.codex.getModelDisplayName("gpt-5", "codex-config"), "gpt-5");
  assert.equal(strategies.codex.getModelDisplayName(null, null), null);

  const claudeSelected = strategies.claude.selectModel(store, "claude-sonnet", "claude-config");
  assert.deepEqual(claudeSelected, selectCliModelInStore(store, "claude", "claude-sonnet", "claude-config"));
  assert.equal(strategies.claude.getSelectedModel(claudeSelected, "claude-config"), null);
  assert.deepEqual(strategies.claude.getModelOptions(claudeSelected, "claude-config"), []);
  assert.deepEqual(strategies.claude.getManagedModelOptions(claudeSelected, "claude-config"), []);
  const claudeLoop = strategies.claude.selectLoopModel(claudeSelected, "main", "claude-sonnet", "claude-config");
  assert.deepEqual(claudeLoop, selectCliLoopModelInStore(claudeSelected, "claude", "main", "claude-sonnet", "claude-config"));
  assert.equal(strategies.claude.getSelectedLoopModel(claudeLoop, "main", "claude-config"), null);
  assert.equal(claudeLoop.selectedLoopByConfigId["claude-config"], undefined);

  const openCodeDirect = setOpenCodeRoleModelInStore(store, "oc-config", "small", "provider/small-model");
  const openCodeVia = strategies.opencode.selectLoopModel(store, "subtask", "provider/small-model", "oc-config");
  assert.deepEqual(openCodeVia.openCodeRoleModelsByConfigId, openCodeDirect.openCodeRoleModelsByConfigId);
  assert.equal(openCodeVia.selectedLoopByConfigId["oc-config"], undefined);
  assert.equal(strategies.opencode.getSelectedLoopModel(openCodeVia, "subtask", "oc-config"), "provider/small-model");
  assert.equal(getOpenCodeRoleModelFromStore(openCodeVia, "oc-config", "small"), "provider/small-model");
  assert.equal(getOpenCodeRoleModelFromStore(openCodeVia, "oc-config", "primary"), null);
  const withVariant = ensureCliModelStore({
    openCodeVariantByConfigAndModel: { "oc-config": { "provider/main-model": "high" } },
    openCodeVariantByConfigModelAndRole: { "oc-config": { "provider/main-model": { main: "xhigh" } } },
  });
  const kept = strategies.opencode.selectLoopModel(withVariant, "main", "provider/main-model", "oc-config");
  assert.equal(kept.openCodeVariantByConfigAndModel["oc-config"]["provider/main-model"], "high");
  assert.equal(kept.openCodeVariantByConfigModelAndRole["oc-config"]["provider/main-model"]?.main, "xhigh");
  assert.equal(withVariant.openCodeVariantByConfigAndModel["oc-config"]["provider/main-model"], "high");
});

test("Grok strategy isolates profiles, keeps selection keys, and does not mutate inputs", () => {
  const cache = new Map<string | null, GrokConfigModels>();
  const seen: Array<string | null | undefined> = [];
  const strategies = createStrategies(cache, () => PATH_STORE_KEY, seen);
  const shared = grokModels(
    ["alpha", "beta"],
    { alpha: "same-api", beta: "same-api" },
    "alpha",
  );
  cache.set("profile-a", shared);
  cache.set("profile-b", grokModels(["beta"], { beta: "same-api" }, "beta"));
  cache.set(null, grokModels(["null-model"], { "null-model": "same-api" }, "null-model"));
  cache.set(PATH_STORE_KEY, grokModels(["synthetic"], { synthetic: "synthetic" }, "synthetic"));
  let store = ensureCliModelStore();
  store.optionsByConfigId["profile-a"] = ["manual-stale"];
  store.selectedByConfigId["profile-a"] = "beta";
  store.selectedByConfigId[PATH_STORE_KEY] = "synthetic";
  store.selectedLoopByConfigId["profile-a"] = { main: "alpha" };
  store.selectedLoopByConfigId.other = { main: "beta" };

  assert.equal(strategies.grok.getSelectedModel(store, null), "null-model");
  assert.deepEqual(seen, [null]);
  assert.equal(strategies.grok.getSelectedModel(store, "profile-a"), "beta");
  assert.equal(strategies.grok.getSelectedModel(store, "profile-b"), "beta");
  assert.deepEqual(strategies.grok.getModelOptions(store, "profile-a"), ["alpha", "beta"]);
  assert.deepEqual(strategies.grok.getManagedModelOptions(store, "profile-a"), []);
  const options = strategies.grok.getModelOptions(store, "profile-a");
  options.push("gamma");
  options[0] = "hacked";
  assert.deepEqual(shared.models, ["alpha", "beta"]);
  assert.deepEqual(strategies.grok.getModelOptions(store, "profile-a"), ["alpha", "beta"]);
  assert.equal(strategies.grok.getModelDisplayName("alpha", "profile-a"), "same-api");
  assert.equal(strategies.grok.getModelDisplayName("beta", "profile-a"), "same-api");
  assert.equal(strategies.grok.getModelDisplayName(null, "profile-a"), null);
  assert.equal(strategies.grok.getModelDisplayName("", "profile-a"), "");

  const selectedRef = store.selectedByConfigId;
  const selected = strategies.grok.selectModel(store, "alpha", "profile-a");
  assert.equal(selectedRef["profile-a"], "beta");
  assert.notEqual(selected.selectedByConfigId, selectedRef);
  assert.equal(selected.selectedByConfigId["profile-a"], "alpha");
  assert.equal(selected.selectedByConfigId[PATH_STORE_KEY], "synthetic");
  assert.equal(selected.optionsByConfigId, store.optionsByConfigId);
  assert.deepEqual(selected.optionsByConfigId["profile-a"], ["manual-stale"]);

  const nullSelected = strategies.grok.selectModel(store, "null-model", null);
  assert.equal(nullSelected.selectedByConfigId[PATH_STORE_KEY], "null-model");
  assert.equal(nullSelected.selectedByConfigId["profile-a"], "beta");
  assert.equal(store.selectedByConfigId[PATH_STORE_KEY], "synthetic");

  const roleRef = store.selectedLoopByConfigId["profile-a"];
  const otherRef = store.selectedLoopByConfigId.other;
  const loopSelected = strategies.grok.selectLoopModel(store, "subtask", "beta", "profile-a");
  assert.deepEqual(roleRef, { main: "alpha" });
  assert.equal(loopSelected.selectedLoopByConfigId.other, otherRef);
  assert.deepEqual(loopSelected.selectedLoopByConfigId["profile-a"], { main: "alpha", subtask: "beta" });
  const resolvedToDefault = strategies.grok.selectLoopModel(loopSelected, "subtask", "missing", "profile-a");
  assert.deepEqual(resolvedToDefault.selectedLoopByConfigId["profile-a"], { main: "alpha", subtask: "alpha" });
  assert.deepEqual(loopSelected.selectedLoopByConfigId["profile-a"], { main: "alpha", subtask: "beta" });
  assert.equal(strategies.grok.selectModel(store, "missing", "profile-a").selectedByConfigId["profile-a"], "alpha");
  cache.set("profile-a", grokModels([], {}, null));
  cache.set("empty", grokModels([], {}, null));
  const roleSource = {
    ...loopSelected,
    selectedLoopByConfigId: {
      ...loopSelected.selectedLoopByConfigId,
      "profile-a": { subtask: "beta" },
    },
  };
  const emptied = strategies.grok.selectLoopModel(roleSource, "subtask", "beta", "profile-a");
  assert.deepEqual(roleSource.selectedLoopByConfigId["profile-a"], { subtask: "beta" });
  assert.deepEqual(emptied.selectedLoopByConfigId["profile-a"], {});
  assert.equal(emptied.selectedLoopByConfigId.other, otherRef);
  assert.deepEqual(strategies.grok.getModelOptions(store, "empty"), []);
  assert.equal(strategies.grok.selectModel(store, "alpha", "empty").selectedByConfigId.empty, "");
});

test("Grok role fallback keeps invalid and missing selections on the existing resolver path", () => {
  const cache = new Map<string | null, GrokConfigModels>();
  cache.set("profile", grokModels(["alpha", "beta"], { alpha: "alpha", beta: "beta" }, "alpha"));
  const strategies = createStrategies(cache);
  const store = ensureCliModelStore();
  store.selectedByConfigId.profile = "beta";
  store.selectedLoopByConfigId.profile = { subtask: "missing" };
  assert.equal(strategies.grok.getSelectedLoopModel(store, "subtask", "profile"), "alpha");
  assert.equal(strategies.grok.getSelectedLoopModel(store, "main", "profile"), "beta");
  store.selectedLoopByConfigId.profile = { main: "", subtask: "beta" };
  assert.equal(strategies.grok.getSelectedLoopModel(store, "main", "profile"), "alpha");
  assert.equal(strategies.grok.getSelectedLoopModel(store, "subtask", "profile"), "beta");
  store.selectedByConfigId.profile = "gone";
  store.selectedLoopByConfigId.profile = {};
  assert.equal(strategies.grok.getSelectedModel(store, "profile"), "alpha");
  assert.equal(strategies.grok.getSelectedLoopModel(store, "main", "profile"), "alpha");
});

test("strategy instances see later cache and store updates without sharing them", () => {
  const cacheA = new Map<string | null, GrokConfigModels>();
  const cacheB = new Map<string | null, GrokConfigModels>();
  const strategiesA = createStrategies(cacheA, () => "grok:A");
  const strategiesB = createStrategies(cacheB, () => "grok:B");
  const storeA = ensureCliModelStore();
  const storeB = ensureCliModelStore();
  assert.equal(strategiesA.grok.getSelectedModel(storeA, "profile"), null);
  cacheA.set("profile", grokModels(["later"], { later: "Later" }, "later"));
  assert.equal(strategiesA.grok.getSelectedModel(storeA, "profile"), "later");
  assert.equal(strategiesB.grok.getSelectedModel(storeB, "profile"), null);
  storeA.selectedByConfigId.profile = "later";
  const nextA = strategiesA.grok.selectModel(storeA, "later", "profile");
  assert.equal(nextA.selectedByConfigId.profile, "later");
  assert.equal(storeB.selectedByConfigId.profile, undefined);
  assert.equal(strategiesA.grok.resolveStoreConfigKey(null), "grok:A");
  assert.equal(strategiesB.grok.resolveStoreConfigKey(null), "grok:B");
});

function thinkingState(): ReturnType<ModelSettingsHostDeps["getOpenCodeThinkingState"]> {
  return {
    providerId: null,
    modelId: null,
    reasoning: "unknown",
    options: [],
    configuredDefaultVariant: null,
    selectedVariant: null,
    status: "unknown",
    source: "fallback",
    disabled: true,
  };
}

function createHost(options: {
  store: CliModelStore;
  currentCli?: CliName;
  preferredConfigId?: (cli: CliName) => string | null;
  heartbeat?: ConfigHeartbeatSnapshot | null;
  resolveModelConfigIdForCli?: ModelSettingsHostDeps["resolveModelConfigIdForCli"];
  logError?: ModelSettingsHostDeps["logError"];
}) {
  let store = options.store;
  const thinking = thinkingState();
  const host = createModelSettingsHost({
    getCurrentCli: () => options.currentCli ?? "grok",
    setCurrentCli: () => undefined,
    getModelStore: () => store,
    setModelStore: (value) => {
      store = value;
    },
    getWorkspaceSettings: () => ({}),
    setWorkspaceSettings: () => undefined,
    getPromptHistoryStore: () => ({ items: [] }),
    setPromptHistoryStore: () => undefined,
    getModelSelectionStoreState: () => ({ store, lastReadError: null, lastWriteError: null }),
    getActiveWorkspaceKey: () => "workspace",
    getConfigHeartbeatSnapshot: () => options.heartbeat ?? null,
    getOpenCodeThinkingState: () => thinking,
    setOpenCodeThinkingState: () => undefined,
    getOpenCodeSmallThinkingState: () => thinking,
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
    getWorkspacePreferredConfigIdForCli: options.preferredConfigId ?? (() => "profile"),
    resolveModelConfigIdForCli: options.resolveModelConfigIdForCli ?? ((_cli, state) => state.activeConfigId),
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
    logError: options.logError ?? (() => undefined),
  });
  return {
    host,
    readStore: () => store,
  };
}

test("ZCode preserves native reasoning levels without generic max downgrades", () => {
  const { host } = createHost({ store: ensureCliModelStore(), currentCli: "zcode" });
  assert.equal(host.normalizeThinkingModeForCli("zcode", "max"), "max");
  assert.equal(host.normalizeThinkingModeForCli("zcode", "medium"), "medium");
  assert.equal(host.normalizeThinkingModeForCli("zcode", "off"), "off");
});

test("host delegates four CLIs, persists through the host, and isolates Grok profiles", (context) => {
  let writes = 0;
  context.mock.method(modelSelectionStore, "writeModelStore", () => {
    writes += 1;
  });
  const store = ensureCliModelStore();
  store.optionsByConfigId.profile = ["manual-stale"];
  const { host, readStore } = createHost({
    store,
    preferredConfigId: (cli) => cli === "claude" ? null : "profile",
    heartbeat: {
      cli: "codex",
      activeConfigId: "heartbeat-codex",
      configIds: ["heartbeat-codex"],
      modelSelected: null,
      managedModelOptions: [],
      openCodeMainModelSelected: null,
      openCodeSubtaskModelSelected: null,
    },
  });
  assert.equal(host.getActiveConfigIdForCli("grok"), "profile");
  assert.equal(host.getActiveConfigIdForCli("codex"), "profile");
  assert.equal(host.getActiveConfigIdForCli("claude"), null);
  const claudeOnly = createHost({
    store: ensureCliModelStore(),
    preferredConfigId: () => null,
    heartbeat: {
      cli: "codex",
      activeConfigId: "heartbeat-codex",
      configIds: ["heartbeat-codex"],
      modelSelected: null,
      managedModelOptions: [],
      openCodeMainModelSelected: null,
      openCodeSubtaskModelSelected: null,
    },
  });
  assert.equal(claudeOnly.host.getActiveConfigIdForCli("codex"), "heartbeat-codex");
  assert.equal(claudeOnly.host.getActiveConfigIdForCli("claude"), null);

  const pathKey = `grok:${resolveGrokConfigPath()}`;
  host.cacheGrokConfigModels("profile", grokModels(["alpha", "beta"], { alpha: "from-profile", beta: "same-api" }, "alpha"));
  host.cacheGrokConfigModels(null as unknown as string, grokModels(["alpha", "beta"], { alpha: "from-null", beta: "same-api" }, "alpha"));
  assert.equal(writes, 0);
  const selectedRef = readStore().selectedByConfigId;
  host.selectCliModel("grok", "beta", "profile");
  assert.equal(writes, 1);
  assert.equal(selectedRef.profile, undefined);
  assert.equal(readStore().selectedByConfigId.profile, "beta");
  assert.deepEqual(readStore().optionsByConfigId.profile, ["manual-stale"]);
  assert.equal(readStore().optionsByConfigId, store.optionsByConfigId);
  host.selectCliModel("grok", "alpha", null);
  assert.equal(writes, 2);
  assert.equal(readStore().selectedByConfigId[pathKey], "alpha");
  assert.equal(readStore().selectedByConfigId.profile, "beta");
  assert.equal(host.getSelectedCliModel("grok", "profile"), "beta");
  assert.equal(host.getSelectedCliModel("grok", null), "alpha");
  assert.equal(host.getModelDisplayName("grok", "alpha"), "from-profile");
  assert.deepEqual(host.getManagedModelOptionsForCli("grok", "profile"), []);
  const returned = host.getModelOptionsForCli("grok", "profile");
  returned.push("leak");
  assert.deepEqual(host.getModelOptionsForCli("grok", "profile"), ["alpha", "beta"]);
  assert.deepEqual(host.getModelOptionsForCli("grok", "missing"), []);

  readStore().selectedLoopByConfigId.profile = { main: "alpha", subtask: "beta" };
  readStore().selectedLoopByConfigId.other = { main: "alpha" };
  const roleRef = readStore().selectedLoopByConfigId.profile;
  const otherRef = readStore().selectedLoopByConfigId.other;
  host.selectCliLoopModel("grok", "subtask", "missing", "profile");
  assert.equal(writes, 3);
  assert.deepEqual(roleRef, { main: "alpha", subtask: "beta" });
  assert.equal(readStore().selectedLoopByConfigId.other, otherRef);
  assert.deepEqual(readStore().selectedLoopByConfigId.profile, { main: "alpha", subtask: "alpha" });
  host.cacheGrokConfigModels("profile", grokModels([], {}, null));
  readStore().selectedLoopByConfigId.profile = { main: "alpha", subtask: "beta" };
  const beforeDelete = readStore().selectedLoopByConfigId.profile;
  host.selectCliLoopModel("grok", "subtask", "beta", "profile");
  assert.deepEqual(beforeDelete, { main: "alpha", subtask: "beta" });
  assert.deepEqual(readStore().selectedLoopByConfigId.profile, { main: "alpha" });
  host.selectCliLoopModel("grok", "main", "alpha", "profile");
  assert.deepEqual(readStore().selectedLoopByConfigId.profile, {});
  host.cacheGrokConfigModels("profile", grokModels(["alpha", "beta"], { alpha: "from-profile", beta: "same-api" }, "alpha"));
  readStore().selectedByConfigId.profile = "beta";
  readStore().selectedLoopByConfigId.profile = { subtask: "missing" };
  assert.equal(host.getSelectedLoopCliModel("grok", "subtask", "profile"), "alpha");
  assert.equal(host.getSelectedLoopCliModel("grok", "main", "profile"), "beta");
  readStore().selectedLoopByConfigId.profile = { main: "" };
  assert.equal(host.getSelectedLoopCliModel("grok", "main", "profile"), "alpha");

  host.selectCliModel("codex", "gpt-5", "codex-config");
  host.selectCliLoopModel("codex", "main", "gpt-5", "codex-config");
  assert.equal(host.getSelectedCliModel("codex", "codex-config"), "gpt-5");
  assert.equal(host.getSelectedLoopCliModel("codex", "main", "codex-config"), "gpt-5");
  assert.deepEqual(host.getModelOptionsForCli("codex", "codex-config"), ["gpt-5"]);
  host.selectCliModel("claude", "claude-sonnet", "claude-config");
  host.selectCliLoopModel("claude", "main", "claude-sonnet", "claude-config");
  assert.equal(host.getSelectedCliModel("claude", "claude-config"), null);
  assert.equal(host.getSelectedLoopCliModel("claude", "main", "claude-config"), null);
  assert.deepEqual(host.getModelOptionsForCli("claude", "claude-config"), []);
  assert.deepEqual(host.getManagedModelOptionsForCli("claude", "claude-config"), []);
  host.selectCliLoopModel("opencode", "subtask", "provider/small-model", "oc-config");
  assert.equal(host.getSelectedLoopCliModel("opencode", "subtask", "oc-config"), "provider/small-model");
  assert.equal(readStore().selectedLoopByConfigId["oc-config"], undefined);
  assert.equal(readStore().openCodeRoleModelsByConfigId["oc-config"]?.subtask, "provider/small-model");

  host.setSelectedLoopThinkingMode("grok", "subtask", "beta", "high", null);
  host.setSelectedLoopThinkingMode("codex", "main", "gpt-5", "low", "codex-config");
  host.setSelectedLoopThinkingMode("claude", "main", null, "medium", "claude-config");
  assert.equal(readStore().loopThinkingByConfigId[pathKey]?.subtask?.beta, "high");
  assert.equal(readStore().loopThinkingByConfigId.profile, undefined);
  assert.equal(host.getSelectedLoopThinkingMode("grok", "subtask", "beta", null), "high");
  assert.equal(host.getSelectedLoopThinkingMode("codex", "main", "gpt-5", "codex-config"), "low");
  assert.equal(host.getSelectedLoopThinkingMode("claude", "main", null, "claude-config"), "medium");
  assert.equal(writes, 13);

  const state = host.buildModelState({ grok: "profile" });
  assert.equal(state.selectedByCli.grok, host.getSelectedCliModel("grok", "profile"));
  assert.deepEqual(state.optionsByCli.grok, ["alpha", "beta"]);
  assert.deepEqual(state.labelsByCli?.grok, { alpha: "from-profile", beta: "same-api" });
  assert.deepEqual(state.managedByCli.grok, []);
  assert.equal(state.selectedLoopByCli?.grok?.main, host.getSelectedLoopCliModel("grok", "main", "profile"));
});

test("host Grok refresh failure keeps the existing error state and does not write the model store", async (context) => {
  let writes = 0;
  const errors: unknown[] = [];
  context.mock.method(modelSelectionStore, "writeModelStore", () => {
    writes += 1;
  });
  context.mock.method(configService, "readGrokConfigText", async () => {
    throw new Error("disk down");
  });
  const { host } = createHost({
    store: ensureCliModelStore(),
    logError: (event, payload) => {
      errors.push({ event, payload });
    },
  });
  host.cacheGrokConfigModels("profile", grokModels(["cached"], { cached: "Cached" }, "cached"));
  assert.equal(host.getSelectedCliModel("grok", "profile"), "cached");
  await host.refreshGrokConfigModels({ configs: [], activeConfigId: "profile" });
  assert.equal(writes, 0);
  assert.deepEqual(host.getModelOptionsForCli("grok", "profile"), []);
  assert.equal(host.getSelectedCliModel("grok", "profile"), null);
  assert.deepEqual(host.buildModelState({ grok: "profile" }).labelsByCli?.grok, {});
  assert.equal(host.buildModelState({ grok: "profile" }).issuesByCli?.grok, "目标 CLI 配置读取失败，不能派发子任务。");
  assert.deepEqual(errors, [{
    event: "grok-config-models-read-failed",
    payload: { error: "disk down" },
  }]);
});

test("host preloads native Grok subtask models even without a saved target profile", async (context) => {
  let reads = 0;
  context.mock.method(modelSelectionStore, "writeModelStore", () => undefined);
  context.mock.method(configService, "readGrokConfigText", async () => {
    reads += 1;
    return "";
  });
  const { host } = createHost({
    store: ensureCliModelStore(),
    currentCli: "codex",
  });
  await host.refreshGrokConfigModels({ configs: [], activeConfigId: "profile" });
  await host.refreshGrokConfigModels({ configs: [], activeConfigId: null });
  assert.equal(reads, 2);

  const withoutTargetConfig = createHost({
    store: ensureCliModelStore(),
    currentCli: "codex",
    preferredConfigId: () => null,
  });
  await withoutTargetConfig.host.refreshGrokConfigModels({ configs: [], activeConfigId: "profile" });
  assert.equal(reads, 3);
});

function allCliConfigStates(active: boolean): Record<CliName, PanelState["configState"]> {
  return Object.fromEntries(CLI_LIST.map((cli) => [cli, {
    configs: active ? [{ id: `${cli}-profile`, name: cli, platform: cli }] : [],
    activeConfigId: active ? `${cli}-profile` : null,
  }])) as Record<CliName, PanelState["configState"]>;
}

function nativeConfigContent(cli: CliName): string {
  if (cli === "dsh") return createDshExampleProfileText();
  if (cli === "kimi-code") return createKimiCodeDefaultConfigText({ model: "synthetic-kimi" });
  if (cli === "zcode") return createZcodeExampleText();
  if (cli === "opencode") {
    return JSON.stringify({ model: "fixture/main", small_model: "fixture/child", provider: {
      fixture: { models: { main: { name: "主模型" }, child: { name: "子模型" } } },
    } });
  }
  return "";
}

test("all CLI snapshots preload shared child models without switching or applying any CLI", async (context) => {
  const states = allCliConfigStates(true);
  const reads: string[] = [];
  let preferredConfigId: string | null = null;
  let grokContent = '[model.initial]\nmodel = "synthetic-initial"';
  const writes = context.mock.method(modelSelectionStore, "writeModelStore", () => undefined);
  const apply = context.mock.method(configService, "applyConfig", async () => { throw new Error("must not apply"); });
  context.mock.method(configService, "readGrokConfigText", async () => grokContent);
  context.mock.method(configService, "getCurrentConfig", async (cli: CliName) => {
    reads.push(cli);
    return { content: nativeConfigContent(cli as CliName) };
  });
  context.mock.method(configService, "getConfigById", async (cli: CliName, configId: string) => {
    assert.equal(configId, `${cli}-profile`);
    reads.push(cli);
    return { id: configId, name: cli, platform: cli, content: nativeConfigContent(cli as CliName), createdAt: 1, updatedAt: 1 };
  });
  const store = ensureCliModelStore();
  store.optionsByConfigId["codex-profile"] = ["gpt-5", "gpt-5-codex"];
  store.selectedByConfigId["codex-profile"] = "gpt-5-codex";
  const { host } = createHost({ store, currentCli: "codex", preferredConfigId: () => preferredConfigId });
  await host.refreshConfigModels(states);
  await host.refreshLoopSubtaskOpenCodeModels(states.opencode);
  const state = host.buildModelState();
  for (const cli of CLI_LIST) {
    assert.equal(host.getActiveConfigIdForCli(cli), `${cli}-profile`);
    assert.equal(state.activeConfigIdByCli?.[cli], `${cli}-profile`);
  }
  for (const cli of ["grok", "dsh", "kimi-code", "zcode"] as const) {
    assert.ok(state.optionsByCli[cli].length > 0, cli);
    assert.deepEqual(state.loopOptionsByCli?.[cli]?.subtask, state.optionsByCli[cli]);
    assert.ok(state.selectedLoopByCli?.[cli]?.subtask, cli);
  }
  assert.equal(state.selectedByCli.codex, "gpt-5-codex");
  assert.deepEqual(reads.sort(), ["codex", "dsh", "kimi-code", "opencode", "zcode"]);
  assert.equal(host.getLoopSubtaskOpenCodeModels()?.selectedSubtaskRef, "fixture/child");
  assert.equal(apply.mock.callCount(), 0);
  assert.equal(writes.mock.callCount(), 0);

  grokContent = '[model.saved]\nmodel = "synthetic-saved"';
  await host.refreshConfigModels(states);
  assert.deepEqual(host.buildModelState().loopOptionsByCli?.grok?.subtask, ["saved"]);
  assert.equal(host.buildModelState().activeConfigIdByCli?.codex, "codex-profile");
  preferredConfigId = "newly-applied-profile";
  assert.equal(host.getActiveConfigIdForCli("codex"), "newly-applied-profile");
});

test("all CLI native defaults load with explicit null identities instead of stale saved preferences", async (context) => {
  const states = allCliConfigStates(false);
  const reads: string[] = [];
  context.mock.method(configService, "readGrokConfigText", async () => '[model.native]\nmodel = "synthetic-native"');
  context.mock.method(configService, "getCurrentConfig", async (cli: CliName) => {
    reads.push(cli);
    return { content: nativeConfigContent(cli as CliName) };
  });
  const getSaved = context.mock.method(configService, "getConfigById", async () => { throw new Error("must read native defaults"); });
  const { host } = createHost({ store: ensureCliModelStore(), currentCli: "codex", preferredConfigId: () => "stale-profile" });
  host.cacheGrokConfigModels("stale-profile", grokModels(["stale"], {}, "stale"));
  await host.refreshConfigModels(states);
  await host.refreshLoopSubtaskOpenCodeModels(states.opencode);
  const state = host.buildModelState(Object.fromEntries(CLI_LIST.map((cli) => [cli, null])));
  for (const cli of CLI_LIST) assert.equal(state.activeConfigIdByCli?.[cli], null);
  for (const cli of ["grok", "dsh", "kimi-code", "zcode"] as const) assert.ok(state.optionsByCli[cli].length, cli);
  assert.deepEqual(state.optionsByCli.grok, ["native"]);
  assert.deepEqual(reads.sort(), ["codex", "dsh", "kimi-code", "opencode", "zcode"]);
  assert.equal(getSaved.mock.callCount(), 0);
  assert.equal(host.getActiveConfigIdForCli("grok"), null);
  assert.equal(host.getLoopSubtaskOpenCodeModels()?.selectedSubtaskRef, "fixture/child");
});

test("all CLI model refresh isolates a broken native config from other child model lists", async (context) => {
  const states = allCliConfigStates(false);
  context.mock.method(configService, "readGrokConfigText", async () => '[model.healthy]\nmodel = "synthetic-healthy"');
  context.mock.method(configService, "getCurrentConfig", async (cli: CliName) => {
    if (cli === "kimi-code") throw new Error("synthetic read failure");
    return { content: nativeConfigContent(cli as CliName) };
  });
  const { host } = createHost({ store: ensureCliModelStore(), currentCli: "codex", preferredConfigId: () => null });
  await host.refreshConfigModels(states);
  const state = host.buildModelState();
  assert.deepEqual(state.loopOptionsByCli?.grok?.subtask, ["healthy"]);
  assert.ok(state.loopOptionsByCli?.zcode?.subtask.length);
  assert.deepEqual(state.optionsByCli["kimi-code"], []);
  assert.match(state.issuesByCli?.["kimi-code"] ?? "", /配置读取失败/);
  assert.equal(state.issuesByCli?.zcode, undefined);
});

test("explicit null model identities never fall back to a stale heartbeat profile", () => {
  const store = ensureCliModelStore();
  store.optionsByConfigId.stale = ["stale-model"];
  store.selectedByConfigId.stale = "stale-model";
  const state = modelSelectionStore.buildModelState(store, () => "stale", { codex: null, grok: null });
  assert.equal(state.activeConfigIdByCli?.codex, null);
  assert.equal(state.activeConfigIdByCli?.grok, null);
  assert.equal(state.optionsByCli.codex.includes("stale-model"), false);
  assert.equal(state.selectedByCli.codex, null);
});

test("Codex merges its configured model without changing managed entries or explicit selections", () => {
  const configured = new Map<string | null, string | null>([["profile", "configured-model"], [null, "native-model"]]);
  const strategies = createCliModelSelectionStrategies({
    getCodexConfigModel: (configId) => configured.get(configId ?? null),
    getGrokConfigModels: () => undefined,
    resolveDefaultGrokStoreKey: () => PATH_STORE_KEY,
  });
  const store = ensureCliModelStore();
  store.optionsByConfigId.profile = [" CONFIGURED-MODEL ", "manual-model"];
  const original = JSON.stringify(store);
  assert.deepEqual(strategies.codex.getModelOptions(store, "profile"), ["configured-model", "manual-model"]);
  assert.deepEqual(strategies.codex.getManagedModelOptions(store, "profile"), ["CONFIGURED-MODEL", "manual-model"]);
  assert.equal(strategies.codex.getSelectedModel(store, "profile"), "configured-model");
  assert.equal(strategies.codex.getSelectedLoopModel(store, "main", "profile"), "configured-model");
  assert.equal(strategies.codex.getSelectedLoopModel(store, "subtask", "profile"), "configured-model");
  assert.deepEqual(strategies.codex.getModelOptions(store, null), ["native-model"]);
  assert.equal(strategies.codex.getSelectedLoopModel(store, "subtask", null), "native-model");
  assert.equal(JSON.stringify(store), original);

  const selected = strategies.codex.selectModel(store, "manual-model", "profile");
  assert.equal(strategies.codex.getSelectedModel(selected, "profile"), "manual-model");
  assert.equal(strategies.codex.getSelectedLoopModel(selected, "main", "profile"), "manual-model");
  selected.selectedLoopByConfigId.profile = { main: "CONFIGURED-MODEL", subtask: "manual-model" };
  assert.equal(strategies.codex.getSelectedLoopModel(selected, "main", "profile"), "configured-model");
  assert.equal(strategies.codex.getSelectedLoopModel(selected, "subtask", "profile"), "manual-model");
  selected.selectedByConfigId.profile = "CONFIGURED-MODEL";
  assert.equal(strategies.codex.getSelectedModel(selected, "profile"), "configured-model");
  configured.set("profile", null);
  assert.equal(strategies.codex.getSelectedModel(store, "profile"), null);
  assert.deepEqual(strategies.codex.getModelOptions(store, "profile"), ["CONFIGURED-MODEL", "manual-model"]);
  assert.equal(strategies.codex.getSelectedModel(store, "other-profile"), null);
});

test("Codex native model refresh updates panel defaults without writing the managed model store", async (context) => {
  let codexContent = 'model = "configured-model"';
  let failRead = false;
  const errors: unknown[] = [];
  const writes = context.mock.method(modelSelectionStore, "writeModelStore", () => undefined);
  context.mock.method(configService, "readGrokConfigText", async () => "");
  context.mock.method(configService, "getCurrentConfig", async (cli: CliName) => {
    if (cli === "codex") {
      if (failRead) throw new Error("synthetic config read failure");
      return { configContent: codexContent, content: 'model = "legacy-content"' };
    }
    return { content: nativeConfigContent(cli) };
  });
  const states = allCliConfigStates(false);
  states.codex = { configs: [{ id: "codex-profile", name: "Codex", platform: "codex" }], activeConfigId: "codex-profile" };
  const store = ensureCliModelStore();
  store.optionsByConfigId["codex-profile"] = ["CONFIGURED-MODEL", "manual-model"];
  const { host, readStore } = createHost({
    store,
    currentCli: "grok",
    preferredConfigId: () => null,
    logError: (event, payload) => { errors.push({ event, payload }); },
  });
  const original = JSON.stringify(store);
  await host.refreshConfigModels(states);
  const state = host.buildModelState();
  assert.equal(state.configuredDefaultByCli?.codex, "configured-model");
  assert.deepEqual(state.optionsByCli.codex, ["configured-model", "manual-model"]);
  assert.deepEqual(state.managedByCli.codex, ["CONFIGURED-MODEL", "manual-model"]);
  assert.equal(state.selectedByCli.codex, "configured-model");
  assert.deepEqual(state.selectedLoopByCli?.codex, { main: "configured-model", subtask: "configured-model" });
  assert.deepEqual(state.loopOptionsByCli?.codex, {
    main: ["configured-model", "manual-model"],
    subtask: ["configured-model", "manual-model"],
  });
  assert.equal(JSON.stringify(readStore()), original);
  assert.equal(writes.mock.callCount(), 0);

  host.selectCliModel("codex", "manual-model", "codex-profile");
  codexContent = 'model = "updated-model"';
  await host.refreshConfigModels(states);
  assert.equal(host.buildModelState().selectedByCli.codex, "manual-model");
  assert.deepEqual(host.buildModelState().optionsByCli.codex, ["updated-model", "CONFIGURED-MODEL", "manual-model"]);
  assert.equal(writes.mock.callCount(), 1);

  codexContent = '[profiles.work]\nmodel = "nested-model"';
  await host.refreshConfigModels(states);
  assert.equal(host.buildModelState().configuredDefaultByCli?.codex, null);
  assert.deepEqual(host.buildModelState().optionsByCli.codex, ["CONFIGURED-MODEL", "manual-model"]);
  assert.equal(host.buildModelState().selectedByCli.codex, "manual-model");

  states.codex = { configs: [], activeConfigId: null };
  codexContent = 'model = "native-model"';
  await host.refreshConfigModels(states);
  assert.equal(host.buildModelState().selectedByCli.codex, "native-model");
  assert.deepEqual(host.buildModelState().optionsByCli.codex, ["native-model"]);
  failRead = true;
  await host.refreshConfigModels(states);
  assert.equal(host.buildModelState().configuredDefaultByCli?.codex, null);
  assert.equal(host.buildModelState().selectedByCli.codex, null);
  assert.deepEqual(host.buildModelState().optionsByCli.codex, []);
  assert.equal(writes.mock.callCount(), 1);
  assert.deepEqual(errors, [{ event: "codex-config-model-read-failed", payload: { error: "synthetic config read failure" } }]);
});

test("separate model settings hosts do not share Grok cache or store updates", (context) => {
  context.mock.method(modelSelectionStore, "writeModelStore", () => undefined);
  const first = createHost({ store: ensureCliModelStore(), preferredConfigId: () => "profile" });
  const second = createHost({ store: ensureCliModelStore(), preferredConfigId: () => "profile" });
  assert.equal(first.host.getSelectedCliModel("grok", "profile"), null);
  first.host.cacheGrokConfigModels("profile", grokModels(["from-a"], { "from-a": "A" }, "from-a"));
  assert.equal(first.host.getSelectedCliModel("grok", "profile"), "from-a");
  assert.equal(second.host.getSelectedCliModel("grok", "profile"), null);
  first.host.selectCliModel("grok", "from-a", "profile");
  assert.equal(first.readStore().selectedByConfigId.profile, "from-a");
  assert.equal(second.readStore().selectedByConfigId.profile, undefined);
  second.host.cacheGrokConfigModels("profile", grokModels(["from-b"], { "from-b": "B" }, "from-b"));
  assert.equal(first.host.getModelDisplayName("grok", "from-a"), "A");
  assert.equal(second.host.getSelectedCliModel("grok", "profile"), "from-b");
});
