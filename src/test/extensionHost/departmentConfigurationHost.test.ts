import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import type { CliName } from "../../cli/types";
import type { CliModelStore } from "../../modelSelectionStore";
import type { ModelSettingsHostDeps } from "../../extensionHost/modelSettings";
import type { ConfigHeartbeatSnapshot } from "../../webviewCommandCoordinator";
installVscodeMock();
const { createModelSettingsHost } = require("../../extensionHost/modelSettings") as typeof import("../../extensionHost/modelSettings");
const configService = require("../../config/configService") as typeof import("../../config/configService");
const { ensureCliModelStore, setOpenCodeRoleModelInStore, setOpenCodeRoleVariantInStore } = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
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
  settings: import("../../workspaceSettingsStore").WorkspaceSettings;
  scope?: () => string;
  issue?: () => string | null;
  tabId?: () => string | null;
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
    getWorkspaceSettings: () => options.settings,
    getDepartmentConfigurationScope: options.scope,
    getDepartmentConfigurationIssue: options.issue,
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
    getActiveConversationTabId: options.tabId ?? (() => null),
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


test("real host OpenCode director snapshots freeze effective defaults while preserving explicit role model/variant", async () => {
  const originalList = configService.getConfigList, originalGet = configService.getConfigById;
  const config = { id: "profile", name: "OpenCode", platform: "opencode" as const, createdAt: 1, updatedAt: 1,
    content: JSON.stringify({ model: "p/default", provider: { p: { npm: "@ai-sdk/openai-compatible", models: {
      default: { name: "default", variants: { high: {} } }, chosen: { name: "chosen", variants: { custom: {} } },
    } } } }) };
  configService.getConfigList = async () => [config];
  configService.getConfigById = async (cli, id) => cli === "opencode" && id === "profile" ? config : null;
  try {
    const role = { cli: "opencode" as const, configId: "profile", model: null, thinkingMode: null, openCodeVariant: null };
    const settings = { departmentRoleRoutesByDirectorConfig: { profile: { leader: role, employee: role } } };
    let store = setOpenCodeRoleModelInStore(ensureCliModelStore(null), "profile", "main", "p/chosen");
    store = setOpenCodeRoleVariantInStore(store, "profile", "p/chosen", "main", "custom");
    // A different profile cache cannot become director authority.
    store = setOpenCodeRoleModelInStore(store, "other", "main", "p/unavailable");
    const explicit = createHost({ store, settings, currentCli: "opencode" }).host;
    assert.equal(explicit.getSelectedCliModel("opencode", "profile"), null, "legacy generic path is deliberately not OpenCode authority");
    const snapshot = await explicit.resolveDepartmentPromptConfiguration("opencode");
    assert.deepEqual(snapshot.routes.director, { cli: "opencode", configId: "profile", model: "p/chosen", openCodeVariant: "custom" });
    assert.equal(explicit.getDepartmentDirectorForPanel()?.model, "p/chosen");
    assert.equal(explicit.getDepartmentDirectorForPanel()?.openCodeVariant, "custom");
    store = setOpenCodeRoleModelInStore(store, "profile", "main", null);
    const defaults = createHost({ store, settings, currentCli: "opencode" }).host;
    const defaultSnapshot = await defaults.resolveDepartmentPromptConfiguration("opencode");
    assert.equal(defaultSnapshot.routes.director.model, "p/default");
    assert.equal(defaultSnapshot.routes.leader.model, "p/default");
    assert.equal(defaultSnapshot.routes.employee.model, "p/default");
    assert.equal(defaults.getDepartmentDirectorForPanel()?.model, null);
    assert.equal(settings.departmentRoleRoutesByDirectorConfig.profile.leader.model, null);
    assert.equal(defaultSnapshot.routes.director.openCodeVariant, undefined);
    store = setOpenCodeRoleVariantInStore(store, "profile", "p/default", "main", "high");
    const variant = await createHost({ store, settings, currentCli: "opencode" }).host.resolveDepartmentPromptConfiguration("opencode");
    assert.equal(variant.routes.director.model, "p/default"); assert.equal(variant.routes.director.openCodeVariant, "high");
    let scope = "workspace-a:1";
    configService.getConfigById = async () => { scope = "workspace-a:3"; return config; };
    await assert.rejects(createHost({ store, settings, currentCli: "opencode", scope: () => scope }).host.resolveDepartmentPromptConfiguration("opencode"), /作用域已变化/);
    configService.getConfigById = async () => config;
    store = setOpenCodeRoleModelInStore(store, "profile", "main", "p/unavailable");
    await assert.rejects(createHost({ store, settings, currentCli: "opencode" }).host.resolveDepartmentPromptConfiguration("opencode"), /模型不可用/);
  } finally { configService.getConfigList = originalList; configService.getConfigById = originalGet; }
});

test("real host default resolution rejects target, save barrier, director selection and shared revision drift", async () => {
  const originalList = configService.getConfigList, originalGet = configService.getConfigById,
    originalShared = configService.readSharedConfigSelection;
  try {
    for (const kind of ["target", "barrier", "director", "revision"] as const) {
      const profile = { id: "profile", name: "OpenCode", platform: "opencode" as const, createdAt: 1, updatedAt: 1,
        content: JSON.stringify({ model: "p/default", provider: { p: { models: { default: {}, chosen: {} } } } }) };
      const preference = { cli: "opencode" as const, configId: "profile", model: null, thinkingMode: null, openCodeVariant: null };
      const settings = { departmentRoleRoutesByDirectorConfig: { profile: { leader: preference, employee: preference } } };
      const store = ensureCliModelStore(null);
      let tabId = "original-tab", issue: string | null = null, revision = "initial", reads = 0;
      configService.getConfigList = async () => [profile];
      configService.readSharedConfigSelection = async () => ({ configId: "profile", revision, ready: true, profileDigest: null });
      configService.getConfigById = async () => {
        if (++reads === 2) {
          if (kind === "target") tabId = "replacement-tab";
          if (kind === "barrier") issue = "角色配置正在保存";
          if (kind === "director") store.openCodeRoleModelsByConfigId = { profile: { main: "p/chosen" } };
          if (kind === "revision") revision = "replacement";
        }
        return profile;
      };
      const { host } = createHost({ store, settings, currentCli: "opencode", tabId: () => tabId, issue: () => issue });
      await assert.rejects(host.resolveDepartmentPromptConfiguration("opencode"), /变化|正在保存|读取所选 CLI/);
    }
  } finally {
    configService.getConfigList = originalList; configService.getConfigById = originalGet;
    configService.readSharedConfigSelection = originalShared;
  }
});

test("production model settings resolves persisted workspace limits over changing global values and freezes old snapshots", async () => {
  const toolSettings = require("../../toolSettings") as typeof import("../../toolSettings");
  const originalRead = toolSettings.readToolSettings, originalList = configService.getConfigList, originalGet = configService.getConfigById;
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const { loadWorkspaceSettings, trySaveWorkspaceSettings } = require("../../workspaceSettingsStore") as typeof import("../../workspaceSettingsStore");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-production-settings-"));
  const options = { workspaceSettingsDir: directory, workspaceKey: "a", isCliName: (v: string): v is CliName => v === "opencode",
    isThinkingMode: (_v: unknown): _v is import("../../cli/types").ThinkingMode => false,
    isInteractiveMode: (_v: unknown): _v is import("../../cli/types").InteractiveMode => false,
    normalizeVisibleInteractiveMode: () => "coding" as const, normalizeLoopMaxRounds: () => 20, sanitizeConversationTabRecord: () => null };
  let global = { departmentMaxLeaders: 8, departmentMaxEmployees: 40 };
  const profile = { id: "profile", name: "OpenCode", platform: "opencode" as const, createdAt: 1, updatedAt: 1,
    content: JSON.stringify({ model: "p/default", provider: { p: { models: { default: {} } } } }) };
  try {
    toolSettings.readToolSettings = () => global;
    configService.getConfigList = async () => [profile];
    configService.getConfigById = async () => profile;
    const role = { cli: "opencode" as const, configId: "profile", model: null, thinkingMode: null, openCodeVariant: null };
    const routes = { profile: { leader: role, employee: role } };
    const saveAndResolve = async (limits: import("../../workspaceSettingsStore").WorkspaceSettings, key = "a") => {
      assert.equal(trySaveWorkspaceSettings({ departmentRoleRoutesByDirectorConfig: routes, ...limits }, { ...options, workspaceKey: key }).ok, true);
      return createHost({ store: ensureCliModelStore(null), settings: loadWorkspaceSettings({ ...options, workspaceKey: key }), currentCli: "opencode" }).host.resolveDepartmentPromptConfiguration("opencode");
    };
    assert.deepEqual((await saveAndResolve({})).limits, { maxLeaders: 8, maxEmployees: 40 });
    assert.deepEqual((await saveAndResolve({ departmentMaxLeaders: 2 })).limits, { maxLeaders: 2, maxEmployees: 40 });
    assert.deepEqual((await saveAndResolve({ departmentMaxEmployees: 13 })).limits, { maxLeaders: 8, maxEmployees: 13 });
    const frozen = await saveAndResolve({ departmentMaxLeaders: 3, departmentMaxEmployees: 12 });
    assert.deepEqual(frozen.limits, { maxLeaders: 3, maxEmployees: 12 });
    global = { departmentMaxLeaders: 9, departmentMaxEmployees: 50 };
    assert.deepEqual((await saveAndResolve({ departmentMaxEmployees: 12 })).limits, { maxLeaders: 9, maxEmployees: 12 });
    assert.deepEqual((await saveAndResolve({}, "b")).limits, { maxLeaders: 9, maxEmployees: 50 });
    assert.deepEqual(frozen.limits, { maxLeaders: 3, maxEmployees: 12 });
  } finally {
    toolSettings.readToolSettings = originalRead; configService.getConfigList = originalList; configService.getConfigById = originalGet;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
