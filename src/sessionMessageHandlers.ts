import { CliName, InteractiveMode, MacTaskShell, ThinkingMode } from "./cli/types";
import { logDebug } from "./logger";
import { ChatMessage, PanelMessage, PromptContextOptions } from "./webview/types";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import { type InteractiveSessionBinding } from "./interactive/runnerRetention";
import { type CliEnabledByName, type ToolSettingsState } from "./toolSettings";
import { type LoopTaskRecord } from "./loopTaskStore";
import { createPanelMessageRouter } from "./sessionMessageRouter";
import { createPanelMessageHandlerRegistry } from "./panelMessageHandlers";
import { routeSettingMessage } from "./settingMessageRouter";
import { type ConfigApplyResult } from "./config/configApplyQueue";
import { type ConfigManagerPanel } from "./webview/configPanel";
import type { KimiCodeConfigModels, KimiCodeModelListChange } from "./config/kimiCodeConfig";
import { assertDepartmentConfigBindingsCurrent, captureDepartmentConfigBindings } from "./departmentConfiguration";

export type PromptRunInputForPanel = {
  departmentConfiguration?: import("./departmentConfiguration").DepartmentConfigurationState;
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopSubtaskCli?: CliName;
  loopSubtaskConfigId?: string;
  loopSubtaskFrontendCli?: CliName;
  loopSubtaskFrontendConfigId?: string;
  loopSubtaskFrontendModel?: string;
  loopSubtaskFullstackCli?: CliName;
  loopSubtaskFullstackConfigId?: string;
  loopSubtaskFullstackModel?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
  loopSubtaskFrontendThinkingMode?: ThinkingMode;
  loopSubtaskFullstackThinkingMode?: ThinkingMode;
  loopSubtaskMode?: import("./loopPlusSubtaskMode").LoopSubtaskMode;
  loopContinuePrompt?: string;
  loopPlusAcceptancePlan?: import("./loopPlusAcceptancePlan").LoopPlusAcceptancePlanSnapshot;
  imagePaths?: string[];
  taskRole?: "main" | "subtask";
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  loopAttemptId?: string;
  skipLongTermMemoryPersist?: boolean;
};

/** Contains only user intent; the department host must reload and validate all routes and limits. */
export type DepartmentPromptStartRequest = {
  /** Trusted action closure, never deserialized from a browser message. */
  assertCurrent?: () => void;
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  targetTabId: string | null;
  cli: CliName;
  acceptancePlanSelectionId?: string;
  /** Safe continuation correlation only. Never a prompt or session identifier. */
  continueRequestId?: string;
};

export type PromptRunTargetForPanel = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

export type LoopSubtaskConversationContextForPanel = {
  taskId: string;
  subtaskId: string;
  round: number;
  attemptId?: string;
};

export type ConversationTabRecordForPanel = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  sessionIdByCli: Partial<Record<CliName, string>>;
  createdAt: number;
  executionLocked?: boolean;
  lockedPrimaryModel?: string | null;
};

export type PanelMessageHandlerDeps = {
  updatePendingPromptQueueState?: (hasPendingPrompts: boolean) => void;
  ensureWorkspaceSessionStore: () => void;
  postPanelState: () => Promise<void>;
  reconcileRunningConversationTabs?: (requestedAt?: number) => void;
  sendSessionMessagesToPanel: (cli: CliName, sessionId: string | null, tabId?: string | null) => void;
  getCurrentCli: () => CliName;
  setCurrentCliValue: (cli: CliName) => void;
  getCurrentSessionId: (cli: CliName) => string | null;
  showWebviewError: (title: string, detail: unknown, options?: { detailTitle?: string }) => void;
  inspectModelManagerState: (message: Extract<PanelMessage, { type: "inspectModelManager" }>) => Promise<void>;
  getActiveConversationTabBinding: (cli?: CliName) => InteractiveSessionBinding | null;
  setCurrentCli: (cli: CliName, options?: { syncActiveTab?: boolean }) => Promise<void>;
  setCurrentCliFromPanelSelection: (cli: CliName) => Promise<void>;
  disposeInteractiveRunnerIfUnused: (binding: InteractiveSessionBinding | null) => void;
  syncCurrentSessionWithActiveTab: () => string | null;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  selectCliModel: (cli: CliName, model: string | null, configId?: string | null) => void;
  selectCliLoopModel?: (cli: CliName, role: "main" | "subtask", model: string | null, configId?: string | null) => void;
  selectLoopSubtaskCli?: (configId: string | null, cli: CliName | null) => void;
  selectLoopFrontendCli?: (configId: string | null, cli: CliName | null) => void;
  selectLoopFullstackCli?: (configId: string | null, cli: CliName | null) => boolean;
  selectLoopSubtaskMode?: (configId: string | null, mode: import("./loopPlusSubtaskMode").LoopSubtaskMode) => boolean;
  setLoopRoleExplicitModel?: (configId: string | null, role: "frontend" | "fullstack", model: string) => boolean;
  setLoopRoleThinking?: (configId: string | null, role: "frontend" | "fullstack", model: string | null, thinkingMode: ThinkingMode | null) => boolean;
  seedLoopFullstackRole?: (configId: string | null) => boolean;
  refreshOpenCodeSubtaskRouteModels?: () => Promise<void>;
  updateOpenCodeRoleModel?: (
    role: "primary" | "small",
    value: string | null,
    configId: string | null
  ) => Promise<string | null>;
  manageKimiCodeModelList?: (
    change: KimiCodeModelListChange,
    configId: string,
  ) => Promise<{ applied: boolean; model: string | null; config: KimiCodeConfigModels }>;
  cacheKimiCodeConfigModels?: (configId: string, config: KimiCodeConfigModels) => void;
  addCliModel: (cli: CliName, model: string, configId?: string | null) => string | null;
  renameCliModel: (cli: CliName, previousModel: string, nextModel: string, configId?: string | null) => string | null;
  deleteCliModel: (cli: CliName, model: string, configId?: string | null) => void;
  moveCliModel: (cli: CliName, model: string, direction: "up" | "down", configId?: string | null) => string | null;
  repairSupersededLocalSession: (cli: CliName, sessionId: string, options?: { notifyPanel?: boolean }) => string;
  findConversationTabIdBySession: (cli: CliName, sessionId: string) => string | null;
  setActiveConversationTab: (tabId: string) => { cli: CliName; sessionId: string | null } | null;
  getConversationTabSelectionRevision?: () => number;
  setConversationTabSelectionRevision?: (revision: number) => void;
  restoreConversationTabConfiguration?: (tabId: string) => Promise<void>;
  updateStatusBar: () => void;
  getWorkspaceSettings: () => WorkspaceSettings;
  saveWorkspaceSettings: (settings: WorkspaceSettings) => void;
  /** 设置写回内存缓存（保存失败时不得调用）。 */
  setWorkspaceSettings?: (settings: WorkspaceSettings) => void;
  /** 带结果的保存，用于把失败提示回界面。 */
  saveWorkspaceSettingsWithResult?: (settings: WorkspaceSettings) => { ok: boolean; error?: string };
  getDepartmentConfigurationScope?: () => string;
  getDepartmentConfigurationIssue?: () => string | null;
  getDepartmentSelectionContextRevision?: () => string | number;
  invalidateDepartmentSelectionContext?: () => void;
  readDepartmentConfigBinding?: import("./departmentConfiguration").DepartmentConfigBindingReader;
  beginDepartmentConfigurationSave?: (scope: string, role: string) => (ok: boolean) => void;
  getDepartmentRoleCandidates?: (cli: CliName, configId: string | null) => Promise<import("./departmentConfiguration").DepartmentRoleCandidates>;
  addConversationTab: (cli: CliName, sessionId: string | null, options?: { skipPersist?: boolean; tabId?: string }) => string | null;
  startNewSession: (cli: CliName) => void;
  getConversationTabById: (tabId: string) => ConversationTabRecordForPanel | null;
  hasAnyTaskRunning: () => boolean;
  disposeAllInteractiveRunners: () => void;
  maybePromptInstallOnCliGroupSwitch: (cli: CliName) => Promise<void>;
  closeConversationTabAndRefreshPanel: (tabId: string, options?: { onRejected?: () => void }) => Promise<void>;
  confirm: (message: string, confirmLabel: string) => Promise<boolean>;
  disposeInteractiveRunnerSession: (cli: CliName, sessionId: string) => void;
  deleteSession: (cli: CliName, sessionId: string) => void;
  detachConversationTabsFromSession: (cli: CliName, sessionId: string) => void;
  loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[];
  pruneChatMessages?: (message: Extract<PanelMessage, { type: "pruneChatMessages" }>) => void;
  getSessionLoadError: (cli: CliName, sessionId: string) => string | undefined;
  postWebviewMessage: (payload: Record<string, unknown>) => void;
  clearAllSessions: () => void;
  clearPromptHistory: () => void;
  setPromptHistoryFavorite: (id: string, favorite?: boolean) => void;
  setPromptHistoryGlobal: (id: string, global?: boolean) => void;
  setWorkspaceInteractiveModeForCli: (cli: CliName, mode: InteractiveMode) => void;
  resetConversationTabSession: () => Promise<void>;
  getConfigManagerPanel: () => ConfigManagerPanel | undefined;
  applyConfigById: (cli: CliName, configId: string) => Promise<ConfigApplyResult>;
  waitForConfigApply?: (cli: CliName) => Promise<boolean>;
  waitForConfigRetryDelay?: (milliseconds: number) => Promise<void>;
  readCliRules: (cli: CliName, scope: "global" | "project") => Promise<string>;
  writeCliRules: (cli: CliName, scope: "global" | "project", content: string) => Promise<void>;
  normalizeRuleTargets: (targets: CliName[] | undefined) => CliName[];
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  normalizeThinkingModeForCli: (cli: CliName, mode: ThinkingMode) => ThinkingMode;
  setCliModelThinkingMode: (cli: CliName, model: string, thinkingMode: ThinkingMode) => void;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  getSelectedLoopCliModel?: (cli: CliName, role: "main" | "subtask", configId?: string | null) => string | null;
  getSelectedLoopThinkingMode?: (
    cli: CliName,
    role: "main" | "subtask",
    model: string | null | undefined,
    configId?: string | null
  ) => ThinkingMode | null;
  setSelectedLoopThinkingMode?: (
    cli: CliName,
    role: "main" | "subtask",
    model: string | null | undefined,
    thinkingMode: ThinkingMode | null,
    configId?: string | null
  ) => void;
  isInteractiveMode: (value: unknown) => value is InteractiveMode;
  normalizeVisibleInteractiveMode: (mode: InteractiveMode) => InteractiveMode;
  loadModelStore: () => void;
  isCliName: (value: string) => value is CliName;
  reloadStoredToolSettings: () => void;
  reloadWorkspaceSettings?: () => void;
  updateWorkspaceSettings?: (update: (settings: WorkspaceSettings) => WorkspaceSettings) => boolean;
  updateStoredToolSettings: (patch: Partial<ToolSettingsState>) => boolean;
  readStoredToolSettings?: () => ToolSettingsState;
  publishCliEnabled?: (cliEnabledByName: CliEnabledByName) => void;
  retargetDisabledLoopSubtaskSelections?: (fallbackCli: CliName | null) => void;
  isMacTaskShell: (value: unknown) => value is MacTaskShell;
  confirmAndInitializeWorkspaceHarness: () => Promise<boolean>;
  installCodeGraphForWorkspace: () => Promise<void>;
  appendUserMessageForCli: (cli: CliName, sessionId: string | null, content: string, options?: { merge?: boolean }) => void;
  runContextCompactionCommand: () => Promise<void>;
  openLoopGroupChatPanel: (arg?: unknown) => Promise<void>;
  getActiveConversationTabId: () => string | null;
  getActiveConversationTab: () => ConversationTabRecordForPanel | null;
  pausePromptForTab?: (tabId: string) => Promise<void>;
  resolveLoopSubtaskConversationContext: (cli: CliName, tabId: string | null) => LoopSubtaskConversationContextForPanel | null;
  buildPromptWithAutoContext: (prompt: string, options?: PromptContextOptions) => { modelPrompt: string; contextTags: string[] };
  maybeInjectLongTermMemoryForPrompt: (displayPrompt: string, modelPrompt: string, contextTags: string[]) => string;
  resolveCodexImagePathsForPrompt: (prompt: string) => Promise<string[]>;
  getLatestLoopRoundRunRecord: (taskId: string, round: number, role: "main" | "subtask", subtaskId?: string, attemptId?: string) => { endedAt: number } | null;
  recordPromptHistory: (prompt: string, cli: CliName) => void;
  resolvePromptRunTarget: (tabId: string | null) => PromptRunTargetForPanel | null;
  preloadUserMessageForPrompt: (input: PromptRunInputForPanel, target: PromptRunTargetForPanel, options?: { messageId?: string }) => PromptRunInputForPanel;
  runLoopPrompt: (input: PromptRunInputForPanel, options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean; schedulingMode?: "classic" | "event_driven" }) => Promise<void>;
  runPrompt: (input: PromptRunInputForPanel, options?: { targetTabId?: string | null; performanceMode?: "vibe" | "loop" | "loop_plus" | "department" }) => Promise<void>;
  resolveDepartmentPromptConfiguration?: (request: DepartmentPromptStartRequest) => Promise<import("./departmentConfiguration").DepartmentConfigurationState>;
  isDepartmentContinuation?: (tabId: string | null) => boolean;
  continueDepartmentPrompt?: (request: DepartmentPromptStartRequest) => Promise<void>;
  startDepartmentPrompt?: (request: DepartmentPromptStartRequest & { departmentConfiguration: import("./departmentConfiguration").DepartmentConfigurationState }) => Promise<void>;
  maybeWakeLoopMainAfterSubtaskContinuation: (
    context: LoopSubtaskConversationContextForPanel,
    options: {
      tabId: string;
      previousRunEndedAt: number;
      model?: string;
      loopMainModel?: string;
      loopSubtaskModel?: string;
      loopSubtaskCli?: CliName;
      loopSubtaskConfigId?: string;
      loopMainThinkingMode?: ThinkingMode;
      loopSubtaskThinkingMode?: ThinkingMode;
    }
  ) => Promise<void>;
  resolveLoopResumeTaskFromPrompt: (prompt: string, tabId: string | null) => LoopTaskRecord | null;
  isLoopResumePrompt: (prompt: string) => boolean;
  stopRunForTab: (tabId: string | null) => void;
  schedulePromptTask?: (
    message: Extract<PanelMessage, { type: "scheduleTask" }>
  ) => Promise<{ task?: import("./webview/types").ScheduledTaskSummary; error?: string }>;
  deleteScheduledTask?: (id: string) => boolean;
  resolveWorkspaceDropPaths: (uris: string[]) => string[];
  hasWorkspaceFolder: () => boolean;
  pickWorkspacePaths: () => Promise<string[] | undefined>;
  persistCliCommand: (cli: CliName, command: string) => Promise<void>;
  updateOpenCodeVariant?: (role: "primary" | "small", value: string | null) => void;
  updateOpenCodeVariantForConfig?: (
    role: "primary" | "small",
    value: string | null,
    configId: string,
    model: string,
  ) => void;
  resolveHumanInteractionResponse?: (
    message: Extract<PanelMessage, { type: "humanInteractionResponse" }>
  ) => void;
};


function isDisabledCliSelectionMessage(message: PanelMessage, deps: PanelMessageHandlerDeps): boolean {
  if (message.type !== "selectCli" && message.type !== "selectLoopSubtaskCli") {
    return false;
  }
  const settings = deps.readStoredToolSettings?.();
  return settings?.cliEnabledByName?.[message.cli] === false;
}

export async function handlePanelMessageWithDeps(message: PanelMessage, deps: PanelMessageHandlerDeps): Promise<void> {
  deps.ensureWorkspaceSessionStore();
  if (message.type === "selectCli" || message.type === "selectCliModel" || message.type === "updateOpenCodeRoleModel" || message.type === "updateOpenCodeVariant"
    || (message.type === "updateSetting" && (message.key === "thinkingMode" || message.key === "departmentEnabled"
      || message.key.startsWith("interactiveMode.") || message.key.startsWith("cliEnabled.") || message.key.startsWith("selectedModel.")))) {
    deps.invalidateDepartmentSelectionContext?.();
  }
  if (message.type === "updateDepartmentRolePreference") {
    await routeSettingMessage({
      type: "updateSetting",
      key: "departmentRolePreference",
      value: { role: message.role, preference: message.preference, directorConfigId: message.directorConfigId, requestId: message.requestId, scope: message.scope },
    }, deps);
    return;
  }
  if (message.type === "requestDepartmentRoleCandidates") {
    const scope = deps.getDepartmentConfigurationScope?.();
    const contextRevision = deps.getDepartmentSelectionContextRevision?.();
    const currentCli = deps.getCurrentCli();
    const directorConfigId = deps.getActiveConfigIdForCli(currentCli);
    const activeConfigId = deps.getActiveConfigIdForCli(message.cli);
    try {
      if (scope !== message.scope) throw new Error("工作区或配置作用域已变化，请重新加载角色候选。");
      if (!deps.isCliName(message.cli) || !deps.getDepartmentRoleCandidates) throw new Error("产研部候选读取接口不可用，请稍后重试。");
      if (!deps.readDepartmentConfigBinding) throw new Error("角色 CLI 绑定校验接口不可用，请稍后重试。");
      if (deps.readStoredToolSettings?.().cliEnabledByName?.[message.cli] === false) throw new Error("所选 CLI 已关闭，请选择可用 CLI。");
      if (!directorConfigId) throw new Error("总监当前没有已确认的激活档案，请重新选择后重试。");
      if (!activeConfigId || message.configId !== activeConfigId) throw new Error("所选 CLI 当前没有该激活档案，请重新加载角色候选。");
      const bindings = await captureDepartmentConfigBindings([
        { cli: currentCli, configId: directorConfigId }, { cli: message.cli, configId: message.configId },
      ], deps.readDepartmentConfigBinding);
      if (scope !== deps.getDepartmentConfigurationScope?.() || contextRevision !== deps.getDepartmentSelectionContextRevision?.()) throw new Error("CLI、模式或配置作用域已变化，请重新加载角色候选。");
      const candidates = await deps.getDepartmentRoleCandidates(message.cli, message.configId);
      if (scope !== deps.getDepartmentConfigurationScope?.() || contextRevision !== deps.getDepartmentSelectionContextRevision?.()) throw new Error("工作区或 CLI、模式、模型选择已变化，请重新加载角色候选。");
      if (deps.getCurrentCli() !== currentCli || deps.getActiveConfigIdForCli(currentCli) !== directorConfigId
        || deps.getActiveConfigIdForCli(message.cli) !== activeConfigId) throw new Error("总监或所选 CLI 激活档案已变化，请重新加载角色候选。");
      if (deps.readStoredToolSettings?.().cliEnabledByName?.[message.cli] === false) throw new Error("所选 CLI 已关闭，请选择可用 CLI。");
      await assertDepartmentConfigBindingsCurrent(bindings, deps.readDepartmentConfigBinding);
      if (scope !== deps.getDepartmentConfigurationScope?.() || contextRevision !== deps.getDepartmentSelectionContextRevision?.()) throw new Error("工作区或 CLI、模式、模型选择已变化，请重新加载角色候选。");
      deps.postWebviewMessage({ scope, type: "departmentRoleCandidates", requestId: message.requestId, role: message.role, candidates });
    } catch (error) {
      deps.postWebviewMessage({ scope, type: "departmentRoleCandidates", requestId: message.requestId, role: message.role, error: error instanceof Error ? error.message : "读取角色候选失败，请重试。" });
    }
    return;
  }
  if (isDisabledCliSelectionMessage(message, deps)) {
    await deps.postPanelState();
    return;
  }
  void logDebug("panel-message", message);
  const router = createPanelMessageRouter(createPanelMessageHandlerRegistry(deps));
  if (await router.dispatch(message)) {
    return;
  }
}
