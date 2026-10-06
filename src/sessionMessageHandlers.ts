import { CliName, InteractiveMode, LoopExecutionMode, MacTaskShell, ThinkingMode, normalizeLoopExecutionMode } from "./cli/types";
import { logDebug } from "./logger";
import { ChatMessage, PanelMessage, PromptContextOptions } from "./webview/types";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import { type InteractiveSessionBinding } from "./interactive/runnerRetention";
import { type ToolSettingsState } from "./toolSettings";
import { type LoopTaskRecord } from "./loopTaskStore";
import { createPanelMessageRouter } from "./sessionMessageRouter";
import { createPanelMessageHandlerRegistry } from "./panelMessageHandlers";
import { type ConfigApplyResult } from "./config/configApplyQueue";
import { type ConfigManagerPanel } from "./webview/configPanel";

export type PromptRunInputForPanel = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
  loopExecutionMode?: LoopExecutionMode;
  loopContinuePrompt?: string;
  imagePaths?: string[];
  taskRole?: "main" | "subtask";
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  graphRunId?: string;
  graphNodeId?: string;
  skipLongTermMemoryPersist?: boolean;
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
};

export type ConversationTabRecordForPanel = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  sessionIdByCli: Partial<Record<CliName, string>>;
  createdAt: number;
};

export type PanelMessageHandlerDeps = {
  ensureWorkspaceSessionStore: () => void;
  postPanelState: () => Promise<void>;
  reconcileRunningConversationTabs?: () => void;
  sendSessionMessagesToPanel: (cli: CliName, sessionId: string | null, tabId?: string | null) => void;
  getCurrentCli: () => CliName;
  setCurrentCliValue: (cli: CliName) => void;
  getCurrentSessionId: (cli: CliName) => string | null;
  showWebviewError: (title: string, detail: unknown, options?: { detailTitle?: string }) => void;
  inspectModelManagerState: (message: Extract<PanelMessage, { type: "inspectModelManager" }>) => Promise<void>;
  getActiveConversationTabBinding: (cli?: CliName) => InteractiveSessionBinding | null;
  setCurrentCli: (cli: CliName, options?: { syncActiveTab?: boolean }) => Promise<void>;
  disposeInteractiveRunnerIfUnused: (binding: InteractiveSessionBinding | null) => void;
  syncCurrentSessionWithActiveTab: () => string | null;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  selectCliModel: (cli: CliName, model: string | null, configId?: string | null) => void;
  selectCliLoopModel?: (cli: CliName, role: "main" | "subtask", model: string | null, configId?: string | null) => void;
  updateOpenCodeRoleModel?: (
    role: "primary" | "small",
    value: string | null,
    configId: string | null
  ) => Promise<string | null>;
  addCliModel: (cli: CliName, model: string, configId?: string | null) => string | null;
  renameCliModel: (cli: CliName, previousModel: string, nextModel: string, configId?: string | null) => string | null;
  deleteCliModel: (cli: CliName, model: string, configId?: string | null) => void;
  moveCliModel: (cli: CliName, model: string, direction: "up" | "down", configId?: string | null) => string | null;
  repairSupersededLocalSession: (cli: CliName, sessionId: string, options?: { notifyPanel?: boolean }) => string;
  findConversationTabIdBySession: (cli: CliName, sessionId: string) => string | null;
  setActiveConversationTab: (tabId: string) => { cli: CliName; sessionId: string | null } | null;
  updateStatusBar: () => void;
  getWorkspaceSettings: () => WorkspaceSettings;
  saveWorkspaceSettings: (settings: WorkspaceSettings) => void;
  addConversationTab: (cli: CliName, sessionId: string | null, options?: { skipPersist?: boolean }) => string | null;
  startNewSession: (cli: CliName) => void;
  getConversationTabById: (tabId: string) => ConversationTabRecordForPanel | null;
  hasAnyTaskRunning: () => boolean;
  disposeAllInteractiveRunners: () => void;
  maybePromptInstallOnCliGroupSwitch: (cli: CliName) => Promise<void>;
  closeConversationTabAndRefreshPanel: (tabId: string) => Promise<void>;
  confirm: (message: string, confirmLabel: string) => Promise<boolean>;
  disposeInteractiveRunnerSession: (cli: CliName, sessionId: string) => void;
  deleteSession: (cli: CliName, sessionId: string) => void;
  detachConversationTabsFromSession: (cli: CliName, sessionId: string) => void;
  loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[];
  getSessionLoadError: (cli: CliName, sessionId: string) => string | undefined;
  postWebviewMessage: (payload: Record<string, unknown>) => void;
  clearAllSessions: () => void;
  clearPromptHistory: () => void;
  setPromptHistoryFavorite: (id: string, favorite?: boolean) => void;
  setWorkspaceInteractiveModeForCli: (cli: CliName, mode: InteractiveMode) => void;
  resetConversationTabSession: () => Promise<void>;
  getConfigManagerPanel: () => ConfigManagerPanel | undefined;
  applyConfigById: (cli: CliName, configId: string) => Promise<ConfigApplyResult>;
  waitForConfigApply?: (cli: CliName) => Promise<boolean>;
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
  setWorkspaceLoopExecutionModeForCli: (cli: CliName, mode: ReturnType<typeof normalizeLoopExecutionMode>) => void;
  loadModelStore: () => void;
  normalizeLoopMaxRounds: (value: unknown) => number;
  isCliName: (value: string) => value is CliName;
  updateStoredToolSettings: (patch: Partial<ToolSettingsState>) => boolean;
  isMacTaskShell: (value: unknown) => value is MacTaskShell;
  confirmAndInitializeWorkspaceHarness: () => Promise<boolean>;
  installCodeGraphForWorkspace: () => Promise<void>;
  appendUserMessageForCli: (cli: CliName, sessionId: string | null, content: string, options?: { merge?: boolean }) => void;
  runContextCompactionCommand: () => Promise<void>;
  openLoopGroupChatPanel: (arg?: unknown) => Promise<void>;
  openGraphRunPanel: (arg?: unknown) => Promise<void>;
  getActiveConversationTabId: () => string | null;
  getActiveConversationTab: () => ConversationTabRecordForPanel | null;
  resolveLoopSubtaskConversationContext: (cli: CliName, tabId: string | null) => LoopSubtaskConversationContextForPanel | null;
  getWorkspaceLoopExecutionMode: (cli: CliName) => ReturnType<typeof normalizeLoopExecutionMode>;
  buildPromptWithAutoContext: (prompt: string, options?: PromptContextOptions) => { modelPrompt: string; contextTags: string[] };
  maybeInjectLongTermMemoryForPrompt: (displayPrompt: string, modelPrompt: string, contextTags: string[]) => string;
  resolveCodexImagePathsForPrompt: (prompt: string) => Promise<string[]>;
  getLatestLoopRoundRunRecord: (taskId: string, round: number, role: "main" | "subtask", subtaskId?: string) => { endedAt: number } | null;
  recordPromptHistory: (prompt: string, cli: CliName) => void;
  resolvePromptRunTarget: (tabId: string | null) => PromptRunTargetForPanel | null;
  preloadUserMessageForPrompt: (input: PromptRunInputForPanel, target: PromptRunTargetForPanel) => PromptRunInputForPanel;
  runLoopPrompt: (input: PromptRunInputForPanel, options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean; schedulingMode?: "classic" | "event_driven" }) => Promise<void>;
  runGraphPrompt?: (input: PromptRunInputForPanel, options?: { targetTabId?: string | null }) => Promise<void>;
  runPrompt: (input: PromptRunInputForPanel, options?: { targetTabId?: string | null }) => Promise<void>;
  maybeWakeLoopMainAfterSubtaskContinuation: (
    context: LoopSubtaskConversationContextForPanel,
    options: {
      tabId: string;
      previousRunEndedAt: number;
      model?: string;
      loopMainModel?: string;
      loopSubtaskModel?: string;
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
  resolveHumanInteractionResponse?: (
    message: Extract<PanelMessage, { type: "humanInteractionResponse" }>
  ) => void;
};


export async function handlePanelMessageWithDeps(message: PanelMessage, deps: PanelMessageHandlerDeps): Promise<void> {
  deps.ensureWorkspaceSessionStore();
  void logDebug("panel-message", message);
  const router = createPanelMessageRouter(createPanelMessageHandlerRegistry(deps));
  if (await router.dispatch(message)) {
    return;
  }
}
