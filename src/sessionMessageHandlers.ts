import * as vscode from "vscode";
import { CLI_LIST, CliName, InteractiveMode, LobsterExecutionMode, MacTaskShell, ThinkingMode, normalizeLobsterExecutionMode } from "./cli/types";
import { t } from "./i18n";
import { logDebug, logError } from "./logger";
import { buildErrorDetail, showErrorWithActions } from "./errorDisplay";
import { isLobsterTaskRoleValue } from "./modelSelectionStore";
import { exportRunStreamRecordsToTxt, exportSessionHistoryMessagesToTxt, buildWorkspacePathItems, saveUploadedFiles } from "./webview/panelFileActions";
import { ChatMessage, PanelMessage, PromptContextOptions } from "./webview/types";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import { type InteractiveSessionBinding } from "./interactive/runnerRetention";
import { type ToolSettingsLocale } from "./toolSettings";
import { type LobsterTaskRecord } from "./lobsterTaskStore";
import { type ConfigManagerPanel } from "./webview/configPanel";
import { handleSendPromptMessage, handleUpdateSettingMessage } from "./sessionMessageActions";
import { isPanelMessageType } from "./sessionMessageRouter";

export type PromptRunInputForPanel = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  model?: string;
  lobsterExecutionMode?: LobsterExecutionMode;
  lobsterMainModel?: string;
  lobsterSubtaskModel?: string;
  lobsterContinuePrompt?: string;
  imagePaths?: string[];
  taskRole?: "main" | "subtask";
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
};

export type PromptRunTargetForPanel = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

export type LobsterSubtaskConversationContextForPanel = {
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
  selectCliLobsterModel: (cli: CliName, role: "main" | "subtask", model: string | null, configId?: string | null) => void;
  setCliModelLobsterRole: (cli: CliName, model: string, role: "main" | "subtask", enabled: boolean, configId?: string | null) => boolean;
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
  setWorkspaceInteractiveModeForCli: (cli: CliName, mode: InteractiveMode) => void;
  resetConversationTabSession: () => Promise<void>;
  getConfigManagerPanel: () => ConfigManagerPanel | undefined;
  applyConfigById: (cli: CliName, configId: string) => Promise<void>;
  readCliRules: (cli: CliName, scope: "global" | "project") => Promise<string>;
  writeCliRules: (cli: CliName, scope: "global" | "project", content: string) => Promise<void>;
  normalizeRuleTargets: (targets: CliName[] | undefined) => CliName[];
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  normalizeThinkingModeForCli: (cli: CliName, mode: ThinkingMode) => ThinkingMode;
  setCliModelThinkingMode: (cli: CliName, model: string, thinkingMode: ThinkingMode) => void;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  isInteractiveMode: (value: unknown) => value is InteractiveMode;
  normalizeVisibleInteractiveMode: (mode: InteractiveMode) => InteractiveMode;
  setWorkspaceLobsterExecutionModeForCli: (cli: CliName, mode: ReturnType<typeof normalizeLobsterExecutionMode>) => void;
  loadModelStore: () => void;
  normalizeLobsterMaxRounds: (value: unknown) => number;
  normalizeToolSettingsLocale: (value: unknown) => ToolSettingsLocale | null;
  isCliName: (value: string) => value is CliName;
  updateStoredToolSettings: (patch: Partial<{ debug: boolean; autoAddEditorContextTags: boolean; locale: ToolSettingsLocale; macTaskShell: MacTaskShell }>) => void;
  isMacTaskShell: (value: unknown) => value is MacTaskShell;
  confirmAndInitializeWorkspaceHarness: () => Promise<boolean>;
  appendUserMessageForCli: (cli: CliName, sessionId: string | null, content: string, options?: { merge?: boolean }) => void;
  runContextCompactionCommand: () => Promise<void>;
  openLobsterDebateChatPanel: (arg?: unknown) => Promise<void>;
  getActiveConversationTabId: () => string | null;
  getActiveConversationTab: () => ConversationTabRecordForPanel | null;
  resolveLobsterSubtaskConversationContext: (cli: CliName, tabId: string | null) => LobsterSubtaskConversationContextForPanel | null;
  getWorkspaceLobsterExecutionMode: (cli: CliName) => ReturnType<typeof normalizeLobsterExecutionMode>;
  buildPromptWithAutoContext: (prompt: string, options?: PromptContextOptions) => { modelPrompt: string; contextTags: string[] };
  maybeInjectLongTermMemoryForPrompt: (displayPrompt: string, modelPrompt: string, contextTags: string[]) => string;
  resolveCodexImagePathsForPrompt: (prompt: string) => Promise<string[]>;
  getSelectedLobsterCliModel: (cli: CliName, role: "main" | "subtask", configId?: string | null) => string | null;
  getLatestLobsterRoundRunRecord: (taskId: string, round: number, role: "main" | "subtask", subtaskId?: string) => { endedAt: number } | null;
  recordPromptHistory: (prompt: string, cli: CliName) => void;
  resolvePromptRunTarget: (tabId: string | null) => PromptRunTargetForPanel | null;
  preloadUserMessageForPrompt: (input: PromptRunInputForPanel, target: PromptRunTargetForPanel) => PromptRunInputForPanel;
  runLobsterPrompt: (input: PromptRunInputForPanel, options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean }) => Promise<void>;
  runPrompt: (input: PromptRunInputForPanel, options?: { targetTabId?: string | null }) => Promise<void>;
  maybeWakeLobsterMainAfterSubtaskContinuation: (context: LobsterSubtaskConversationContextForPanel, options: { tabId: string; previousRunEndedAt: number; model?: string; lobsterMainModel?: string; lobsterSubtaskModel?: string }) => Promise<void>;
  resolveLobsterResumeTaskFromPrompt: (prompt: string, tabId: string | null) => LobsterTaskRecord | null;
  isLobsterResumePrompt: (prompt: string) => boolean;
  stopRunForTab: (tabId: string | null) => void;
};

export async function handlePanelMessageWithDeps(message: PanelMessage, deps: PanelMessageHandlerDeps): Promise<void> {
  const {
    ensureWorkspaceSessionStore,
    postPanelState,
    sendSessionMessagesToPanel,
    getCurrentCli,
    setCurrentCliValue,
    getCurrentSessionId,
    showWebviewError,
    inspectModelManagerState,
    getActiveConversationTabBinding,
    setCurrentCli,
    disposeInteractiveRunnerIfUnused,
    syncCurrentSessionWithActiveTab,
    getActiveConfigIdForCli,
    selectCliModel,
    selectCliLobsterModel,
    setCliModelLobsterRole,
    addCliModel,
    renameCliModel,
    deleteCliModel,
    moveCliModel,
    repairSupersededLocalSession,
    findConversationTabIdBySession,
    setActiveConversationTab,
    updateStatusBar,
    getWorkspaceSettings,
    saveWorkspaceSettings,
    addConversationTab,
    startNewSession,
    getConversationTabById,
    hasAnyTaskRunning,
    disposeAllInteractiveRunners,
    maybePromptInstallOnCliGroupSwitch,
    closeConversationTabAndRefreshPanel,
    confirm,
    disposeInteractiveRunnerSession,
    deleteSession,
    detachConversationTabsFromSession,
    loadSessionMessages,
    getSessionLoadError,
    postWebviewMessage,
    clearAllSessions,
    clearPromptHistory,
    setWorkspaceInteractiveModeForCli,
    resetConversationTabSession,
    getConfigManagerPanel,
    applyConfigById,
    readCliRules,
    writeCliRules,
    normalizeRuleTargets,
    isThinkingMode,
    normalizeThinkingModeForCli,
    setCliModelThinkingMode,
    getSelectedCliModel,
    isInteractiveMode,
    normalizeVisibleInteractiveMode,
    setWorkspaceLobsterExecutionModeForCli,
    loadModelStore,
    normalizeLobsterMaxRounds,
    normalizeToolSettingsLocale,
    isCliName,
    updateStoredToolSettings,
    isMacTaskShell,
    confirmAndInitializeWorkspaceHarness,
    appendUserMessageForCli,
    runContextCompactionCommand,
    openLobsterDebateChatPanel,
    getActiveConversationTabId,
    getActiveConversationTab,
    resolveLobsterSubtaskConversationContext,
    getWorkspaceLobsterExecutionMode,
    buildPromptWithAutoContext,
    maybeInjectLongTermMemoryForPrompt,
    resolveCodexImagePathsForPrompt,
    getSelectedLobsterCliModel,
    getLatestLobsterRoundRunRecord,
    recordPromptHistory,
    resolvePromptRunTarget,
    preloadUserMessageForPrompt,
    runLobsterPrompt,
    runPrompt,
    maybeWakeLobsterMainAfterSubtaskContinuation,
    resolveLobsterResumeTaskFromPrompt,
    isLobsterResumePrompt,
    stopRunForTab,
  } = deps;
  const currentCliRef = { get value(): CliName { return getCurrentCli(); }, set value(cli: CliName) { setCurrentCliValue(cli); } };
  const workspaceSettingsRef = { get value(): WorkspaceSettings { return getWorkspaceSettings(); } };
  const viewProviderRef = { postMessage: postWebviewMessage };
  const configManagerPanelRef = { get value(): ConfigManagerPanel | undefined { return getConfigManagerPanel(); } };
  ensureWorkspaceSessionStore();
  void logDebug("panel-message", message);
  if (message.type === "requestState") {
    await postPanelState();
    sendSessionMessagesToPanel(currentCliRef.value, getCurrentSessionId(currentCliRef.value));
    return;
  }

  if (message.type === "webviewError") {
    void logError("webview-runtime-error", {
      message: message.message,
      source: message.source ?? null,
      line: message.lineno ?? null,
      column: message.colno ?? null,
      reason: message.reason ?? null,
      stack: message.stack ?? null,
    });
    const detail = [
      message.message,
      message.reason ? `reason: ${message.reason}` : "",
      message.source ? `source: ${message.source}` : "",
      typeof message.lineno === "number" ? `line: ${message.lineno}` : "",
      typeof message.colno === "number" ? `column: ${message.colno}` : "",
      message.stack ?? "",
    ].filter(Boolean).join("\n");
    void showWebviewError(t("panel.runtimeError"), detail || message.message);
    return;
  }

  if (message.type === "webviewDebug") {
    void logDebug("webview-debug", {
      event: message.event,
      payload: message.payload ?? null,
    });
    return;
  }

  if (message.type === "inspectModelManager") {
    await inspectModelManagerState(message);
    return;
  }

  if (message.type === "sessionLoadError") {
    void logError("webview-session-load-error", {
      title: message.title,
      detail: message.detail,
      tabId: message.tabId ?? null,
      sessionId: message.sessionId ?? null,
      cli: message.cli ?? null,
    });
    void showWebviewError(message.title, message.detail);
    return;
  }

  if (message.type === "selectCli" && message.cli) {
    const previousBinding = getActiveConversationTabBinding();
    await setCurrentCli(message.cli);
    disposeInteractiveRunnerIfUnused(previousBinding);
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCliRef.value, activeSessionId);
    return;
  }

  if (message.type === "selectCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId ? message.configId : getActiveConfigIdForCli(message.cli);
    selectCliModel(message.cli, message.model ?? null, configId);
    await postPanelState();
    return;
  }

  if (message.type === "selectCliLobsterModel" && message.cli && isLobsterTaskRoleValue(message.role)) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    selectCliLobsterModel(message.cli, message.role, message.model ?? null, configId);
    await postPanelState();
    return;
  }

  if (message.type === "setCliModelLobsterRole" && message.cli && isLobsterTaskRoleValue(message.role)) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    const updated = setCliModelLobsterRole(
      message.cli,
      message.model,
      message.role,
      message.enabled,
      configId
    );
    if (!updated) {
      return;
    }
    await postPanelState();
    return;
  }

  if (message.type === "addCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId ? message.configId : getActiveConfigIdForCli(message.cli);
    const addedModel = addCliModel(message.cli, message.model, configId);
    if (!addedModel) {
      return;
    }
    await postPanelState();
    return;
  }

  if (message.type === "renameCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    const renamedModel = renameCliModel(message.cli, message.previousModel, message.nextModel, configId);
    if (!renamedModel) {
      return;
    }
    await postPanelState();
    return;
  }

  if (message.type === "deleteCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    deleteCliModel(message.cli, message.model, configId);
    await postPanelState();
    return;
  }

  if (message.type === "moveCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    const movedModel = moveCliModel(message.cli, message.model, message.direction, configId);
    if (!movedModel) {
      return;
    }
    await postPanelState();
    return;
  }

  if (message.type === "selectSession") {
    const previousBinding = getActiveConversationTabBinding(message.cli);
    await setCurrentCli(message.cli, { syncActiveTab: false });
    const selectedSessionId = message.sessionId
      ? repairSupersededLocalSession(message.cli, message.sessionId)
      : null;
    if (selectedSessionId) {
      const existingTabId = findConversationTabIdBySession(message.cli, selectedSessionId);
      if (existingTabId) {
        const switched = setActiveConversationTab(existingTabId);
        if (switched && currentCliRef.value !== switched.cli) {
          currentCliRef.value = switched.cli;
          updateStatusBar();
          workspaceSettingsRef.value.currentCli = currentCliRef.value;
          saveWorkspaceSettings(workspaceSettingsRef.value);
        }
      } else {
        addConversationTab(message.cli, selectedSessionId);
      }
    } else {
      startNewSession(message.cli);
    }
    disposeInteractiveRunnerIfUnused(previousBinding);
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCliRef.value, activeSessionId);
    return;
  }

  if (message.type === "selectConversationTab") {
    if (!getConversationTabById(message.tabId)) {
      return;
    }
    const previousCli = currentCliRef.value;
    if (!hasAnyTaskRunning()) {
      disposeAllInteractiveRunners();
    }
    const switched = setActiveConversationTab(message.tabId);
    if (!switched) {
      return;
    }
    if (currentCliRef.value !== switched.cli) {
      currentCliRef.value = switched.cli;
      updateStatusBar();
      workspaceSettingsRef.value.currentCli = currentCliRef.value;
      saveWorkspaceSettings(workspaceSettingsRef.value);
    }
    if (previousCli !== switched.cli) {
      await maybePromptInstallOnCliGroupSwitch(switched.cli);
    }
    await postPanelState();
    sendSessionMessagesToPanel(switched.cli, switched.sessionId, message.tabId);
    return;
  }

  if (message.type === "closeConversationTab") {
    await closeConversationTabAndRefreshPanel(message.tabId);
    return;
  }

  if (message.type === "deleteSession") {
    const confirmLabel = t("common.delete");
    const confirmed = await vscode.window.showWarningMessage(
      t("session.confirmDelete"),
      { modal: true },
      confirmLabel
    );
    if (confirmed !== confirmLabel) {
      return;
    }
    disposeInteractiveRunnerSession(message.cli, message.sessionId);
    deleteSession(message.cli, message.sessionId);
    detachConversationTabsFromSession(message.cli, message.sessionId);
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCliRef.value, activeSessionId);
    return;
  }

  if (message.type === "loadHistorySessionMessages") {
    const requestedSessionId = message.sessionId;
    const resolvedSessionId = repairSupersededLocalSession(message.cli, requestedSessionId);
    try {
      const messages = loadSessionMessages(message.cli, resolvedSessionId);
      const loadError = getSessionLoadError(message.cli, resolvedSessionId);
      viewProviderRef.postMessage({
        type: "historySessionMessages",
        cli: message.cli,
        sessionId: requestedSessionId,
        resolvedSessionId,
        messages,
        error: loadError ?? undefined,
      });
      if (loadError) {
        void logError("history-session-message-load-error", {
          cli: message.cli,
          sessionId: requestedSessionId,
          resolvedSessionId,
          detail: loadError,
        });
      }
    } catch (error) {
      const detail = buildErrorDetail(error);
      viewProviderRef.postMessage({
        type: "historySessionMessages",
        cli: message.cli,
        sessionId: requestedSessionId,
        resolvedSessionId,
        messages: [],
        error: detail,
      });
      void logError("history-session-message-load-failed", {
        cli: message.cli,
        sessionId: requestedSessionId,
        resolvedSessionId,
        error: detail,
      });
    }
    return;
  }

  if (message.type === "exportHistorySessionMessages") {
    const requestedSessionId = message.sessionId;
    const resolvedSessionId = repairSupersededLocalSession(message.cli, requestedSessionId);
    try {
      const messages = loadSessionMessages(message.cli, resolvedSessionId);
      const exportResult = await exportSessionHistoryMessagesToTxt({
        cli: message.cli,
        sessionId: resolvedSessionId,
        messages,
      });
      viewProviderRef.postMessage({
        type: "historySessionExportResult",
        cli: message.cli,
        sessionId: requestedSessionId,
        resolvedSessionId,
        path: exportResult.path,
        fileName: exportResult.fileName,
      });
    } catch (error) {
      const messageText = error instanceof Error && error.message
        ? error.message
        : t("historySession.exportFailed");
      viewProviderRef.postMessage({
        type: "historySessionExportResult",
        cli: message.cli,
        sessionId: requestedSessionId,
        resolvedSessionId,
        error: messageText,
      });
      void logError("export history session messages failed", {
        cli: message.cli,
        sessionId: requestedSessionId,
        resolvedSessionId,
        error: buildErrorDetail(error),
      });
    }
    return;
  }

  if (message.type === "clearAllSessions") {
    const confirmLabel = t("common.clear");
    const confirmed = await vscode.window.showWarningMessage(
      t("session.confirmClearAll"),
      { modal: true },
      confirmLabel
    );
    if (confirmed !== confirmLabel) {
      return;
    }
    disposeAllInteractiveRunners();
    clearAllSessions();
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCliRef.value, activeSessionId);
    return;
  }

  if (message.type === "clearPromptHistory") {
    const confirmLabel = t("common.clear");
    const confirmed = await vscode.window.showWarningMessage(
      t("session.confirmClearPromptHistory"),
      { modal: true },
      confirmLabel
    );
    if (confirmed !== confirmLabel) {
      return;
    }
    clearPromptHistory();
    await postPanelState();
    return;
  }

  if (message.type === "newSession") {
    const sessionId = addConversationTab(currentCliRef.value, null);
    setWorkspaceInteractiveModeForCli(currentCliRef.value, "coding");
    await postPanelState();
    sendSessionMessagesToPanel(currentCliRef.value, sessionId);
    return;
  }

  if (message.type === "resetConversationTabSession") {
    await resetConversationTabSession();
    return;
  }

  if (message.type === "openConfig") {
    configManagerPanelRef.value?.show();
    configManagerPanelRef.value?.syncActiveConfig();
    return;
  }

  if (message.type === "applyConfig") {
    try {
      await applyConfigById(message.cli, message.configId);
      await postPanelState();
      configManagerPanelRef.value?.syncActiveConfig();
    } catch (error) {
      const detail = buildErrorDetail(error);
      viewProviderRef.postMessage({
        type: "configApplyError",
        error: detail,
        cli: message.cli,
        configId: message.configId,
      });
      void showWebviewError(
        t("config.applyFailedTitle"),
        error,
        { detailTitle: t("config.applyFailedTitle") }
      );
    }
    return;
  }

  if (message.type === "resolveDropPaths") {
    const uris = Array.isArray(message.uris) ? message.uris : [];
    if (!uris.length) {
      return;
    }
    try {
      const paths = uris
        .map((uri) => vscode.Uri.parse(uri))
        .map((uri) => vscode.workspace.asRelativePath(uri, false));
      viewProviderRef.postMessage({
        type: "dropPathsResult",
        paths,
      });
    } catch (error) {
      viewProviderRef.postMessage({
        type: "dropPathsResult",
        paths: [],
        error: t("pathPicker.dropParseError"),
      });
      logError("resolve drop paths failed", error);
    }
    return;
  }

  if (message.type === "pickWorkspacePath") {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      viewProviderRef.postMessage({
        type: "pickWorkspacePathResult",
        paths: [],
        error: t("pathPicker.noWorkspace"),
        canceled: true,
      });
      return;
    }
    try {
      const items = await buildWorkspacePathItems();
      const selections = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        matchOnDescription: true,
        ignoreFocusOut: true,
        placeHolder: t("pathPicker.placeholder"),
      });
      if (!selections || selections.length === 0) {
        viewProviderRef.postMessage({
          type: "pickWorkspacePathResult",
          paths: [],
          canceled: true,
        });
        return;
      }
      viewProviderRef.postMessage({
        type: "pickWorkspacePathResult",
        paths: selections.map((item) => item.value),
      });
    } catch (error) {
      viewProviderRef.postMessage({
        type: "pickWorkspacePathResult",
        paths: [],
        error: t("pathPicker.readError"),
        canceled: true,
      });
      logError("pick workspace path failed", error);
    }
    return;
  }

  if (message.type === "uploadFiles") {
    const result = await saveUploadedFiles(message.files);
    viewProviderRef.postMessage({
      type: "uploadResult",
      paths: result.paths,
      error: result.error,
    });
    return;
  }

  if (message.type === "exportRunStream") {
    const targetTabId = typeof message.tabId === "string" && message.tabId
      ? message.tabId
      : getActiveConversationTabId();
    const targetCli = message.cli && isCliName(message.cli) ? message.cli : currentCliRef.value;
    try {
      const exportResult = await exportRunStreamRecordsToTxt(message.records, {
        cli: targetCli,
        tabId: targetTabId,
      });
      viewProviderRef.postMessage({
        type: "runStreamExportResult",
        tabId: targetTabId,
        path: exportResult.path,
        fileName: exportResult.fileName,
      });
    } catch (error) {
      const messageText = error instanceof Error && error.message
        ? error.message
        : t("runStream.exportFailed");
      viewProviderRef.postMessage({
        type: "runStreamExportResult",
        tabId: targetTabId,
        error: messageText,
      });
      logError("export run stream failed", error);
    }
    return;
  }

  if (message.type === "loadRules") {
    try {
      const content = await readCliRules(message.cli, message.scope);
      viewProviderRef.postMessage({
        type: "rulesContent",
        cli: message.cli,
        content,
        scope: message.scope,
      });
    } catch (error) {
      const noWorkspace = error instanceof Error && error.message === "no-workspace";
      viewProviderRef.postMessage({
        type: "rulesContent",
        cli: message.cli,
        scope: message.scope,
        error: noWorkspace ? t("rules.loadNoWorkspace") : t("rules.loadFailed"),
      });
      logError("load rules failed", error);
    }
    return;
  }

  if (message.type === "saveRules") {
    const targets = normalizeRuleTargets(message.targets);
    if (!targets.length) {
      viewProviderRef.postMessage({
        type: "rulesSaved",
        error: t("rules.invalidCli"),
      });
      return;
    }
    try {
      await Promise.all(
        targets.map((cli) => writeCliRules(cli, message.scope, message.content ?? ""))
      );
      viewProviderRef.postMessage({
        type: "rulesSaved",
        targets,
        scope: message.scope,
      });
    } catch (error) {
      const noWorkspace = error instanceof Error && error.message === "no-workspace";
      viewProviderRef.postMessage({
        type: "rulesSaved",
        error: noWorkspace ? t("rules.saveNoWorkspace") : t("rules.saveFailed"),
      });
      logError("save rules failed", error);
    }
    return;
  }

  if (isPanelMessageType(message, "updateSetting") && message.key) {
    await handleUpdateSettingMessage(message, deps);
    return;
  }

  if (message.type === "initializeWorkspaceHarness") {
    if (message.enabled !== true) {
      workspaceSettingsRef.value.workspaceMemoryEnabled = false;
      saveWorkspaceSettings(workspaceSettingsRef.value);
      await postPanelState();
      return;
    }
    const initialized = await confirmAndInitializeWorkspaceHarness();
    workspaceSettingsRef.value.workspaceMemoryEnabled = initialized;
    saveWorkspaceSettings(workspaceSettingsRef.value);
    await postPanelState();
    return;
  }

  if (message.type === "runCommonCommand" && message.command === "compactContext") {
    const label = t("common.compactContext");
    appendUserMessageForCli(
      currentCliRef.value,
      getCurrentSessionId(currentCliRef.value),
      t("common.commonCommandPrefix", { label }),
      { merge: false }
    );
    await runContextCompactionCommand();
    return;
  }

  if (message.type === "openLobsterDebateChat") {
    await openLobsterDebateChatPanel({
      taskId: typeof message.taskId === "string" ? message.taskId : undefined,
      roundKey: typeof message.roundKey === "string" ? message.roundKey : undefined,
    });
    return;
  }

  if (isPanelMessageType(message, "sendPrompt") && typeof message.prompt === "string") {
    await handleSendPromptMessage(message, deps);
    return;
  }

  if (message.type === "stopRun") {
    stopRunForTab(getActiveConversationTabId());
  }
}
