import type { CliName } from "../cli/types";
import { CLI_LIST, type InteractiveMode } from "../cli/types";
import type { ChatMessage, ConversationTabSummary, SessionSummary } from "../webview/types";
import { isLoopAskChatMessage, resolveHistorySessionTaskRole } from "../historySessionTaskRole";
import { isHiddenLoopPlusProtocolPrompt } from "../loopPlusProtocolPrompt";
import { t } from "../i18n";
import { getLatestSessionIdFromRecords, type SessionStore } from "../sessionStore";
import { bindLoopTaskToSession, buildLoopSessionIdsByCli, type LoopTaskRecord } from "../loopTaskStore";
import { getLoopSubtaskDisplayTitle, resolveLoopSubtaskConversationContextFromMessages } from "../loopConversationPresentation";
import { projectDepartmentConversationTab } from "./departmentConversationTabs";
import { attachConversationTabLoopSchedulingMode, buildConversationTabSessionLookupKey, getConversationTabSessionIdForCli, sanitizeConversationTabSessionIdMap, type ConversationTabRecord, type ConversationTabsState, type PendingSessionDraft, type SessionTabsController } from "../sessionTabs";
import type { PromptRunTarget } from "../promptRunTypes";

export function attachConversationTabLoopMemberTitle(
  summary: ConversationTabSummary,
  task: Pick<LoopTaskRecord, "id" | "subTasks"> | null,
  messages: readonly ChatMessage[],
): ConversationTabSummary {
  if (summary.loopTaskRole !== "subtask") {
    return summary;
  }
  const context = resolveLoopSubtaskConversationContextFromMessages(messages);
  const matchingIndices = task && task.id === summary.loopTaskId ? task.subTasks.map((subtask, index) => (
    summary.loopSubtaskId
      ? summary.loopSubtaskId === subtask.id
      : context
      ? context.taskId === task.id && context.subtaskId === subtask.id
      : Boolean(summary.sessionId && subtask.executionSession?.cli === summary.cli && subtask.executionSession.sessionId === summary.sessionId)
  ) ? index : -1).filter((index) => index >= 0) : [];
  const index = matchingIndices.length === 1 ? matchingIndices[0] : -1;
  return {
    ...summary,
    taskSummary: task && index >= 0 ? getLoopSubtaskDisplayTitle(index, task.subTasks[index]) : undefined,
  };
}

export type ExtensionSessionTabsHostDeps = {
  readOrdinaryConversationTabTaskRecord: (taskId: string) => LoopTaskRecord | null;
  readDepartmentTaskRecord: (taskId: string) => LoopTaskRecord | null;
  readDepartmentLeaderTaskIds: (rootTaskId: string, leaderSubtaskId: string) => readonly string[] | null;
  getSessionTabsController: () => SessionTabsController;
  getSessionLifecycleController: () => { loadSessionStore: () => SessionStore; cleanupSessionRetentionAcrossWorkspaces: () => Promise<void>; ensureLocalSession: (cli: CliName, tabId: string, createForEmptyDraft?: boolean) => void; assignPendingLabel: (cli: CliName, tabId: string, sessionId: string) => void; persistActiveMessages: () => void; attachPendingMessages: (cli: CliName, tabId: string, sessionId: string) => void; };
  getSessionStore: () => SessionStore; setSessionStore: (store: SessionStore) => void;
  getCurrentCli: () => CliName; setCurrentCli: (cli: CliName) => void; getActiveWorkspaceKey: () => string;
  getWorkspaceSettings: () => { currentCli?: CliName }; saveWorkspaceSettings: (settings: any) => void;
  getLoopGroupChatTasks: () => any[];
  getPrimaryRunTabId: () => string | null; getActiveTaskRun: () => { cli?: CliName; loopTaskId?: string; sessionId?: string | null } | null;
  getLiveMessagesForTab: (tabId: string) => ChatMessage[] | null; getPendingSessionDraft: (tabId: string, cli?: CliName) => PendingSessionDraft; getActiveTabIdForRun: () => string | null; getActiveSessionId: () => string | null; persistSessionStore: (store: SessionStore) => Promise<void>; getSessionStoreKey: (workspaceKey?: string) => string; loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[]; saveSessionMessages: (cli: CliName, sessionId: string, messages: ChatMessage[]) => void;
  buildSessionLabelFromPrompt: (prompt: string | null | undefined) => string | null; shouldUseFallbackSessionLabel: (label: string | null | undefined) => boolean;
  isTabRunActive: (tabId: string | null) => boolean; isLoopMainTabCloseLocked: (tabId: string | null) => boolean; postPanelState: () => Promise<void>; updateStatusBar: () => void; maybePromptInstallOnCliGroupSwitch: (cli: CliName) => Promise<void>; sendSessionMessagesToPanel: (cli: CliName, sessionId: string | null, tabId?: string | null) => void;
  restoreConversationTabConfiguration?: (tabId: string) => Promise<void>;
  onSubtaskTabCreated?: (tabId: string) => void;
  postConversationTabClosed: (tabId: string, activeTabId: string | null) => void;
  getInteractiveSessionBindingsForTab: (tab: ConversationTabRecord) => unknown[]; disposeInteractiveRunnerIfUnused: (binding: unknown) => void; setWorkspaceInteractiveModeForCli: (cli: CliName, mode: InteractiveMode) => boolean;
  resolveAutoInteractiveModeForConversationTab: (tab: ConversationTabRecord | null) => InteractiveMode;
  extractSessionId: (cli: CliName, buffer: string) => string | null; isLocalSessionId: (sessionId: string) => boolean; migrateLocalSessionToTargetSession: (cli: CliName, from: string, to: string, options?: { notifyPanel?: boolean }) => void; adoptSessionId: (cli: CliName, sessionId: string, tabId?: string | null) => void;
  getActiveTaskRunMutable: () => { cli?: CliName; loopTaskId?: string; sessionId?: string | null } | null; logInfo: (event: string, payload?: unknown) => void; activeData: { WORKSPACE_KEY_FALLBACK: string; LEGACY_SESSION_FILE: string; SESSION_DIR: string; SESSION_BUFFER_LIMIT: number };
};

export function createExtensionSessionTabsHost(deps: ExtensionSessionTabsHostDeps) {
let sessionTabsController = deps.getSessionTabsController();
let sessionLifecycleController = deps.getSessionLifecycleController();
let sessionStore = deps.getSessionStore();
let currentCli = deps.getCurrentCli();
let activeWorkspaceKey = deps.getActiveWorkspaceKey();
let workspaceSettings = deps.getWorkspaceSettings();
let activeTaskRun = deps.getActiveTaskRun();
const loopGroupChatChatPanelCoordinator = { listGroupChatTasks: deps.getLoopGroupChatTasks };
const { getLiveMessagesForTab, loadSessionMessages, saveSessionMessages, buildSessionLabelFromPrompt, shouldUseFallbackSessionLabel, isTabRunActive, isLoopMainTabCloseLocked, postPanelState, updateStatusBar, maybePromptInstallOnCliGroupSwitch, sendSessionMessagesToPanel, getInteractiveSessionBindingsForTab, disposeInteractiveRunnerIfUnused, setWorkspaceInteractiveModeForCli, extractSessionId, isLocalSessionId, migrateLocalSessionToTargetSession, adoptSessionId, logInfo } = deps;
const getPrimaryRunTabId = deps.getPrimaryRunTabId;
const saveWorkspaceSettings = deps.saveWorkspaceSettings;
const { WORKSPACE_KEY_FALLBACK, LEGACY_SESSION_FILE, SESSION_DIR, SESSION_BUFFER_LIMIT } = deps.activeData;
function syncFromDeps(): void { sessionTabsController = deps.getSessionTabsController(); sessionLifecycleController = deps.getSessionLifecycleController(); sessionStore = deps.getSessionStore(); currentCli = deps.getCurrentCli(); activeWorkspaceKey = deps.getActiveWorkspaceKey(); workspaceSettings = deps.getWorkspaceSettings(); activeTaskRun = deps.getActiveTaskRun(); }
function syncToDeps(): void { deps.setSessionStore(sessionStore); deps.setCurrentCli(currentCli); }
function wrap<T extends (...args: any[]) => any>(fn: T): T { return ((...args: Parameters<T>) => { syncFromDeps(); const result = fn(...args); if (result && typeof (result as Promise<unknown>).then === "function") { return (result as Promise<unknown>).finally(syncToDeps) as ReturnType<T>; } syncToDeps(); return result; }) as T; }

function loadSessionStore(): SessionStore {
  return sessionLifecycleController.loadSessionStore();
}

async function cleanupSessionRetentionAcrossWorkspaces(): Promise<void> {
  await sessionLifecycleController.cleanupSessionRetentionAcrossWorkspaces();
}

function buildSessionState(cli: CliName): { currentSessionId: string | null; sessions: SessionSummary[] } {
  const allSessions: SessionSummary[] = [];
  const openConversationTabSessionMap = buildOpenConversationTabSessionMap();
  const loopTasks: LoopTaskRecord[] = loopGroupChatChatPanelCoordinator.listGroupChatTasks();
  const loopSessionIdsByCli = buildLoopSessionIdsByCli(loopTasks);
  let shouldPersist = false;
  for (const item of CLI_LIST) {
    const records = sessionStore[item]?.sessions ?? [];
    records.forEach((record) => {
      let firstPrompt = record.firstPrompt;
      const cachedPromptIsHidden = isHiddenLoopPlusProtocolPrompt(firstPrompt);
      const cachedPromptIsMissing = !String(firstPrompt ?? "").trim();
      let messages: ChatMessage[] | null = null;
      if (cachedPromptIsMissing || cachedPromptIsHidden) {
        messages = loadSessionMessages(item, record.id);
        firstPrompt = resolveSessionFirstPromptFromMessages(messages)
          ?? (cachedPromptIsHidden || cachedPromptIsMissing ? undefined : firstPrompt);
      }
      const loopMainTask = loopTasks.find((task) => task.cli === item && task.sessionId === record.id);
      const loopSubtaskOwner = loopTasks.find((task) => task.subTasks.some((subtask) => (
        subtask.executionSession?.cli === item && subtask.executionSession.sessionId === record.id
      )));
      const loopSubtask = loopSubtaskOwner?.subTasks.find((subtask) => (
        subtask.executionSession?.cli === item && subtask.executionSession.sessionId === record.id
      ));
      const hasHiddenProtocolPrompt = cachedPromptIsHidden || Boolean(messages?.some((message) => (
        message.role === "user" && isHiddenLoopPlusProtocolPrompt(message.content)
      )));
      if (hasHiddenProtocolPrompt || (!firstPrompt && (loopMainTask || loopSubtask))) {
        const boundPrompt = [loopSubtask?.prompt, loopMainTask?.rootPrompt].find((prompt) => {
          const normalized = String(prompt ?? "").trim();
          return normalized && !isHiddenLoopPlusProtocolPrompt(normalized);
        });
        firstPrompt = boundPrompt?.trim() || firstPrompt;
      }
      if (firstPrompt && record.firstPrompt !== firstPrompt) {
        record.firstPrompt = firstPrompt;
        shouldPersist = true;
      } else if (!firstPrompt && (cachedPromptIsHidden || (cachedPromptIsMissing && record.firstPrompt))) {
        record.firstPrompt = undefined;
        shouldPersist = true;
      }
      const fallbackLabel = buildSessionLabelFromPrompt(firstPrompt);
      if (fallbackLabel && (shouldUseFallbackSessionLabel(record.label) || isHiddenLoopPlusProtocolPrompt(record.label))) {
        record.label = fallbackLabel;
        shouldPersist = true;
      }
      const openConversationTabId = openConversationTabSessionMap.get(
        buildConversationTabSessionLookupKey(item, record.id)
      ) ?? null;
      const isLoopSession = loopSessionIdsByCli[item].has(record.id);
      const taskRole = resolveHistorySessionTaskRole({
        isLoopMainSession: isLoopSession,
        isLoopSubtaskSession: Boolean(loopSubtask),
        messages: loadSessionMessages(item, record.id),
      });
      allSessions.push({
        id: record.id,
        label: hasHiddenProtocolPrompt && !firstPrompt ? t("session.unnamed") : record.label,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt,
        cli: item,
        isLoopSession,
        isOpenInConversationTabs: Boolean(openConversationTabId),
        openConversationTabId,
        firstPrompt,
        taskRole,
      });
    });
  }
  if (shouldPersist) {
    void persistSessionStore(sessionStore);
  }
  const sessions = allSessions.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return {
    currentSessionId: sessionStore[cli]?.currentId ?? null,
    sessions,
  };
}

function resolveSessionFirstPrompt(cli: CliName, sessionId: string): string | null {
  const messages = loadSessionMessages(cli, sessionId);
  return resolveSessionFirstPromptFromMessages(messages);
}

function resolveSessionFirstPromptFromMessages(messages: readonly ChatMessage[]): string | null {
  const first = messages.find((message) => (
    message.role === "user"
    && !isLoopAskChatMessage(message)
    && message.content.trim()
    && !isHiddenLoopPlusProtocolPrompt(message.content)
  ));
  return first?.content.trim() || null;
}

function ensureLatestSessionForCli(cli: CliName): void {
  const latestSessionId = getLatestSessionId(cli);
  if (!latestSessionId) {
    return;
  }
  if (getCurrentSessionId(cli) === latestSessionId) {
    return;
  }
  setCurrentSession(cli, latestSessionId, { syncConversationTab: false });
}

function getLatestSessionId(cli: CliName): string | null {
  return getLatestSessionIdFromRecords(sessionStore[cli]?.sessions ?? []);
}

function getCurrentSessionId(cli: CliName): string | null {
  return sessionStore[cli]?.currentId ?? null;
}

function buildOpenConversationTabSessionMap(): Map<string, string> {
  return sessionTabsController.buildOpenConversationTabSessionMap();
}

function buildConversationTabsState(): {
  activeTabId: string | null;
  tabs: ConversationTabSummary[];
} {
  const tabState = sessionTabsController.buildConversationTabsState();
  const taskRecords = new Map<string, LoopTaskRecord | null>();
  const readTaskRecord = (taskId: string): LoopTaskRecord | null => {
    if (!taskRecords.has(taskId)) {
      try { taskRecords.set(taskId, deps.readDepartmentTaskRecord(taskId)); }
      catch { taskRecords.set(taskId, null); }
    }
    return taskRecords.get(taskId) ?? null;
  };
  const readPort = { readTaskRecord, readDepartmentLeaderTaskIds: deps.readDepartmentLeaderTaskIds };
  return {
    ...tabState,
    tabs: tabState.tabs.map((summary) => {
      let task = summary.loopTaskId ? readTaskRecord(summary.loopTaskId) : null;
      if (!task && summary.loopTaskId) {
        try { task = deps.readOrdinaryConversationTabTaskRecord(summary.loopTaskId); } catch { task = null; }
      }
      const withSchedulingMode = summary.loopTaskId
        ? attachConversationTabLoopSchedulingMode(
          summary,
          task?.schedulingMode,
        )
        : summary;
      const messages = summary.loopTaskRole === "subtask" && !summary.loopSubtaskId
        ? getLiveMessagesForTab(summary.id) ?? (summary.sessionId
          ? loadSessionMessages(summary.cli, summary.sessionId)
          : deps.getPendingSessionDraft(summary.id, summary.cli).messages)
        : [];
      const withMemberTitle = attachConversationTabLoopMemberTitle(summary.loopTaskRole === "subtask"
        ? { ...withSchedulingMode, loopSubtaskRunning: isTabRunActive(summary.id) }
        : withSchedulingMode, task, messages);
      return summary.loopTaskRole === "subtask"
        ? withMemberTitle
        : projectDepartmentConversationTab(withMemberTitle, task, messages, readPort);
    }),
  };
}

function initializeConversationTabsFromWorkspaceSettings(): void {
  sessionTabsController.initializeConversationTabsFromWorkspaceSettings();
}

function sanitizeConversationTabRecord(value: unknown): ConversationTabRecord | null {
  return sessionTabsController.sanitizeConversationTabRecord(value);
}

function ensureConversationTabs(): ConversationTabsState {
  return sessionTabsController.ensureConversationTabs();
}

function persistConversationTabsToWorkspaceSettings(): void {
  sessionTabsController.persistConversationTabsToWorkspaceSettings();
}

function getConversationTabById(tabId: string): ConversationTabRecord | null {
  return sessionTabsController.getConversationTabById(tabId);
}

function markConversationTabExecutionLocked(tabId: string, primaryModel?: string | null): boolean {
  return sessionTabsController.markConversationTabExecutionLocked(tabId, primaryModel);
}

function getActiveConversationTabId(): string | null {
  return sessionTabsController.getActiveConversationTabId();
}

function getActiveConversationTab(): ConversationTabRecord | null {
  return sessionTabsController.getActiveConversationTab();
}

function getActiveConversationSessionId(cli: CliName): string | null {
  return sessionTabsController.getActiveConversationSessionId(cli);
}

function findConversationTabIdBySession(cli: CliName, sessionId: string): string | null {
  return sessionTabsController.findConversationTabIdBySession(cli, sessionId);
}

function updateActiveConversationTabSession(cli: CliName, sessionId: string | null): void {
  sessionTabsController.updateActiveConversationTabSession(cli, sessionId);
}

function setActiveConversationTab(tabId: string): { cli: CliName; sessionId: string | null } | null {
  return sessionTabsController.setActiveConversationTab(tabId);
}

async function switchVisibleConversationTabForLoop(
  tabId: string
): Promise<{ cli: CliName; sessionId: string | null } | null> {
  const previousCli = currentCli;
  const switched = setActiveConversationTab(tabId);
  if (!switched) {
    return null;
  }
  setWorkspaceInteractiveModeForCli(switched.cli, deps.resolveAutoInteractiveModeForConversationTab(getActiveConversationTab()));
  if (currentCli !== switched.cli) {
    currentCli = switched.cli;
    deps.setCurrentCli(currentCli);
    updateStatusBar();
    workspaceSettings.currentCli = currentCli;
    saveWorkspaceSettings(workspaceSettings);
  }
  if (previousCli !== switched.cli) {
    await maybePromptInstallOnCliGroupSwitch(switched.cli);
  }
  await deps.restoreConversationTabConfiguration?.(tabId);
  if (getActiveConversationTabId() !== tabId) {
    return null;
  }
  await postPanelState();
  if (getActiveConversationTabId() !== tabId) {
    return null;
  }
  sendSessionMessagesToPanel(switched.cli, switched.sessionId, tabId);
  return switched;
}

function createLoopSubtaskRunTarget(
  cli: CliName,
  options: { sessionId?: string | null; loopTaskId?: string; loopSubtaskId?: string } = {}
): PromptRunTarget {
  const sessionId = options.sessionId?.trim() || null;
  const state = ensureConversationTabs();
  const tab: ConversationTabRecord = {
    id: createConversationTabId(),
    ...(options.loopTaskId ? { loopTaskId: options.loopTaskId } : {}),
    ...(options.loopSubtaskId ? { loopSubtaskId: options.loopSubtaskId } : {}),
    cli,
    sessionId,
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, cli, sessionId),
    createdAt: Date.now(),
  };
  state.tabs.push(tab);
  deps.onSubtaskTabCreated?.(tab.id);
  persistConversationTabsToWorkspaceSettings();
  void logInfo("loop-subtask-session-created", { cli, tabId: tab.id });
  void postPanelState();
  return {
    tabId: tab.id,
    cli,
    sessionId,
  };
}

function addConversationTab(
  cli: CliName,
  sessionId: string | null,
  options: { skipPersist?: boolean } = {}
): string | null {
  return sessionTabsController.addConversationTab(cli, sessionId, options);
}

function closeConversationTab(tabId: string): { cli: CliName; sessionId: string | null } | null {
  return sessionTabsController.closeConversationTab(tabId);
}

async function closeConversationTabAndRefreshPanel(
  tabId: string,
  options: { notifyTabClosed?: boolean; onRejected?: () => void } = {},
  target?: { tab: ConversationTabRecord; kind: "department" | "completed-subtask" },
): Promise<void> {
  const completedSubtask = target?.kind === "completed-subtask";
  const closingTab = getConversationTabById(tabId);
  if (target && closingTab !== target.tab) {
    throw new Error(completedSubtask ? "子任务标签已被替代或移除，未执行自动关闭。" : "department-owned-tab-target-changed");
  }
  if (isTabRunActive(tabId) || (target?.kind !== "department" && isLoopMainTabCloseLocked(tabId))) {
    if (completedSubtask) throw new Error("子任务标签正在运行或关闭已锁定，未执行自动关闭。");
    await postPanelState();
    options.onRejected?.();
    return;
  }
  if (!closingTab) {
    return;
  }
  const previousActiveTabId = getActiveConversationTabId();
  const previousCli = currentCli;
  const closingBindings = getInteractiveSessionBindingsForTab(closingTab);
  const replaceLastTab = completedSubtask && ensureConversationTabs().tabs.length === 1;
  const next = sessionTabsController.closeConversationTab(tabId, { replaceLastTab });
  const nextActiveTabId = getActiveConversationTabId();
  if (getConversationTabById(tabId)) {
    if (completedSubtask) throw new Error("子任务标签关闭未生效，保留标签以便重试。");
    options.onRejected?.();
    return;
  }
  if (!replaceLastTab && options.notifyTabClosed !== false) {
    deps.postConversationTabClosed(tabId, nextActiveTabId);
  }
  closingBindings.forEach((binding) => {
    disposeInteractiveRunnerIfUnused(binding);
  });
  if (nextActiveTabId === previousActiveTabId) {
    return;
  }
  // Keep the active conversation responsive while config and panel state refresh.
  if (!replaceLastTab) {
    sendSessionMessagesToPanel(next?.cli ?? currentCli, next?.sessionId ?? null, nextActiveTabId);
  }
  if (next && currentCli !== next.cli) {
    currentCli = next.cli;
    deps.setCurrentCli(currentCli);
    updateStatusBar();
    workspaceSettings.currentCli = currentCli;
    saveWorkspaceSettings(workspaceSettings);
  }
  if (next && previousCli !== next.cli) {
    await maybePromptInstallOnCliGroupSwitch(next.cli);
  }
  if (next) {
    setWorkspaceInteractiveModeForCli(next.cli, deps.resolveAutoInteractiveModeForConversationTab(getActiveConversationTab()));
  }
  if (replaceLastTab) {
    await postPanelState();
    if (getActiveConversationTabId() !== nextActiveTabId) return;
  }
  if (next && nextActiveTabId && nextActiveTabId !== previousActiveTabId) {
    await deps.restoreConversationTabConfiguration?.(nextActiveTabId);
    if (getActiveConversationTabId() !== nextActiveTabId) {
      return;
    }
  }
  await postPanelState();
  if (nextActiveTabId && getActiveConversationTabId() !== nextActiveTabId) {
    return;
  }
}

function detachConversationTabsFromSession(cli: CliName, sessionId: string): void {
  sessionTabsController.detachConversationTabsFromSession(cli, sessionId);
}

function syncCurrentSessionWithActiveTab(preferredCli?: CliName): string | null {
  return sessionTabsController.syncCurrentSessionWithActiveTab(preferredCli);
}

function setCurrentSession(
  cli: CliName,
  sessionId: string | null,
  options: { syncConversationTab?: boolean } = {}
): void {
  if (!sessionStore[cli]) {
    sessionStore[cli] = { currentId: null, sessions: [] };
  }
  sessionStore[cli].currentId = sessionId;
  if (sessionId) {
    touchSession(cli, sessionId);
  }
  if (options.syncConversationTab !== false) {
    updateActiveConversationTabSession(cli, sessionId);
  }
  void persistSessionStore(sessionStore);
  void logInfo("session-selected", { cli, sessionId });
}

function startNewSession(cli: CliName): void {
  const activeTab = getActiveConversationTab();
  sessionTabsController.startNewSession(cli);
  void logInfo("session-new", { cli, tabId: activeTab?.id ?? null });
}

async function resetConversationTabSession(): Promise<void> {
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    return;
  }
  if (isTabRunActive(activeTab.id) || isLoopMainTabCloseLocked(activeTab.id)) {
    await postPanelState();
    return;
  }
  const previousTabId = activeTab.id;
  const targetCli = activeTab.cli;
  addConversationTab(targetCli, null);
  const nextTabId = getActiveConversationTabId();
  setWorkspaceInteractiveModeForCli(targetCli, deps.resolveAutoInteractiveModeForConversationTab(null));
  await closeConversationTabAndRefreshPanel(previousTabId, { notifyTabClosed: false });
  if (getActiveConversationTabId() !== nextTabId) {
    return;
  }
  await postPanelState();
  if (getActiveConversationTabId() !== nextTabId) {
    return;
  }
  sendSessionMessagesToPanel(targetCli, null);
  void logInfo("session-reset-to-new-tab", {
    cli: targetCli,
    previousTabId,
    activeTabId: getActiveConversationTabId(),
  });
}

function captureSessionFromBuffer(cli: CliName, buffer: string): void {
  const sessionId = extractSessionId(cli, buffer);
  if (!sessionId) {
    return;
  }
  adoptDetectedSessionId(cli, sessionId, deps.getActiveTabIdForRun(), deps.getActiveSessionId());
}

function adoptDetectedSessionId(
  cli: CliName,
  sessionId: string,
  tabId: string | null,
  previousSessionId: string | null,
): void {
  if (previousSessionId === sessionId) {
    return;
  }
  if (previousSessionId && !isLocalSessionId(previousSessionId)) {
    return;
  }
  if (previousSessionId) {
    migrateLocalSessionToTargetSession(cli, previousSessionId, sessionId, { notifyPanel: false });
  }
  adoptSessionId(cli, sessionId, tabId);
}

function adoptFreshOpenCodeLoopRecoverySession(options: {
  sessionId: string;
  previousSessionId: string | null;
  tabId: string | null;
  messageTarget: ChatMessage[];
  loopTaskId: string;
}): ChatMessage[] {
  const sessionId = options.sessionId.trim();
  if (!sessionId) {
    return options.messageTarget;
  }

  // Preserve the UI transcript while the OpenCode provider starts a clean context.
  saveSessionMessages("opencode", sessionId, options.messageTarget);
  adoptSessionId("opencode", sessionId, options.tabId);
  bindLoopTaskToSession(options.loopTaskId, sessionId);
  if (activeTaskRun?.cli === "opencode" && activeTaskRun.loopTaskId === options.loopTaskId) {
    activeTaskRun.sessionId = sessionId;
  }
  void logInfo("opencode-loop-main-fresh-session-recovered", {
    taskId: options.loopTaskId,
    tabId: options.tabId,
    previousSessionId: options.previousSessionId,
    sessionId,
  });
  return loadSessionMessages("opencode", sessionId);
}

function touchSession(cli: CliName, sessionId: string): void {
  const now = Date.now();
  const sessions = sessionStore[cli].sessions;
  const existing = sessions.find((item) => item.id === sessionId);
  if (existing) {
    existing.lastUsedAt = now;
    return;
  }
  sessions.push({ id: sessionId, label: t("session.unnamed"), createdAt: now, lastUsedAt: now, health: "abnormal" });
}

async function persistSessionStore(nextStore: SessionStore): Promise<void> {
  await deps.persistSessionStore(nextStore);
}

function updateSessionBuffer(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  if (next.length <= SESSION_BUFFER_LIMIT) {
    return next;
  }
  return next.slice(next.length - SESSION_BUFFER_LIMIT);
}

function createConversationTabId(): string {
  return sessionTabsController.createConversationTabId();
}

function getPendingSessionDraft(tabId: string, cli?: CliName): PendingSessionDraft {
  return sessionTabsController.getPendingSessionDraft(tabId, cli);
}

function updatePendingSessionDraft(
  tabId: string,
  patch: Partial<PendingSessionDraft>,
  cli?: CliName,
): PendingSessionDraft {
  return sessionTabsController.updatePendingSessionDraft(tabId, patch, cli);
}

function clearPendingSessionDraft(tabId: string, cli?: CliName): void {
  sessionTabsController.clearPendingSessionDraft(tabId, cli);
}

function ensureLocalSession(cli: CliName, tabId: string, createForEmptyDraft = false): void {
  sessionLifecycleController.ensureLocalSession(cli, tabId, createForEmptyDraft);
}

function preparePendingLabel(cli: CliName, tabId: string, prompt: string): void {
  sessionTabsController.preparePendingLabel(cli, tabId, prompt);
}

function assignPendingLabel(cli: CliName, tabId: string, sessionId: string): void {
  sessionLifecycleController.assignPendingLabel(cli, tabId, sessionId);
}

function persistActiveMessages(): void {
  sessionLifecycleController.persistActiveMessages();
}

return {
  loadSessionStore: wrap(loadSessionStore),
  cleanupSessionRetentionAcrossWorkspaces: wrap(cleanupSessionRetentionAcrossWorkspaces),
  buildSessionState: wrap(buildSessionState),
  resolveSessionFirstPrompt: wrap(resolveSessionFirstPrompt),
  ensureLatestSessionForCli: wrap(ensureLatestSessionForCli),
  getLatestSessionId: wrap(getLatestSessionId),
  getCurrentSessionId: wrap(getCurrentSessionId),
  buildOpenConversationTabSessionMap: wrap(buildOpenConversationTabSessionMap),
  buildConversationTabsState: wrap(buildConversationTabsState),
  initializeConversationTabsFromWorkspaceSettings: wrap(initializeConversationTabsFromWorkspaceSettings),
  sanitizeConversationTabRecord: wrap(sanitizeConversationTabRecord),
  ensureConversationTabs: wrap(ensureConversationTabs),
  persistConversationTabsToWorkspaceSettings: wrap(persistConversationTabsToWorkspaceSettings),
  getConversationTabById: wrap(getConversationTabById),
  getActiveConversationTabId: wrap(getActiveConversationTabId),
  getActiveConversationTab: wrap(getActiveConversationTab),
  getActiveConversationSessionId: wrap(getActiveConversationSessionId),
  findConversationTabIdBySession: wrap(findConversationTabIdBySession),
  updateActiveConversationTabSession: wrap(updateActiveConversationTabSession),
  setActiveConversationTab: wrap(setActiveConversationTab),
  switchVisibleConversationTabForLoop: wrap(switchVisibleConversationTabForLoop),
  createLoopSubtaskRunTarget: wrap(createLoopSubtaskRunTarget),
  addConversationTab: wrap(addConversationTab),
  closeConversationTab: wrap(closeConversationTab),
  closeConversationTabAndRefreshPanel: wrap(closeConversationTabAndRefreshPanel),
  // In-process host capability only; no UI message route exposes this port.
  closeOwnedConversationTabAndRefreshPanel: wrap((tab: ConversationTabRecord) => closeConversationTabAndRefreshPanel(tab.id, {}, { tab, kind: "department" })),
  closeCompletedSubtaskTabAndRefreshPanel: wrap((tab: ConversationTabRecord) => closeConversationTabAndRefreshPanel(tab.id, {}, { tab, kind: "completed-subtask" })),
  detachConversationTabsFromSession: wrap(detachConversationTabsFromSession),
  syncCurrentSessionWithActiveTab: wrap(syncCurrentSessionWithActiveTab),
  setCurrentSession: wrap(setCurrentSession),
  startNewSession: wrap(startNewSession),
  markConversationTabExecutionLocked: wrap(markConversationTabExecutionLocked),
  resetConversationTabSession: wrap(resetConversationTabSession),
  captureSessionFromBuffer: wrap(captureSessionFromBuffer),
  adoptDetectedSessionId: wrap(adoptDetectedSessionId),
  adoptFreshOpenCodeLoopRecoverySession: wrap(adoptFreshOpenCodeLoopRecoverySession),
  touchSession: wrap(touchSession),
  persistSessionStore: wrap(persistSessionStore),
  updateSessionBuffer: wrap(updateSessionBuffer),
  createConversationTabId: wrap(createConversationTabId),
  getPendingSessionDraft: wrap(getPendingSessionDraft),
  updatePendingSessionDraft: wrap(updatePendingSessionDraft),
  clearPendingSessionDraft: wrap(clearPendingSessionDraft),
  ensureLocalSession: wrap(ensureLocalSession),
  preparePendingLabel: wrap(preparePendingLabel),
  assignPendingLabel: wrap(assignPendingLabel),
  persistActiveMessages: wrap(persistActiveMessages),
};
}
