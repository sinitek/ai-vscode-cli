/** Actual logical tab host/controller with isolated in-memory settings and panel ports.
 * Also executed inside installed VS Code EH; no native/model work here. */
import { CLI_LIST, type CliName, type InteractiveMode } from "../../../cli/types";
import { createCliRecord } from "../../../cli/types";
import { createExtensionSessionTabsHost } from "../../../extensionHost/sessionTabs";
import { createSessionTabsController, type ConversationTabRecord, type ConversationTabsState, type PendingSessionDraft } from "../../../sessionTabs";
import type { SessionStore } from "../../../sessionStore";
export function createResourceTabHost(initial: {
  state: ConversationTabsState;
  currentCli: CliName;
  modes: Partial<Record<CliName, InteractiveMode>>;
  onRestore?: (tabId: string) => Promise<void>;
  runningTabIds?: ReadonlySet<string>;
  lockedTabIds?: ReadonlySet<string>;
  onPostPanelState?: () => Promise<void>;
}) {
  let currentCli = initial.currentCli;
  const modes = { ...initial.modes };
  const settings: { currentCli?: CliName } = {};
  const pendingDrafts: Record<string, PendingSessionDraft> = {};
  const restoredTabIds: string[] = [];
  const postedTabIds: Array<string | null> = [];
  const postedClis: CliName[] = [];
  const sentTabIds: Array<string | null> = [];
  const closedTabs: Array<{ tabId: string; activeTabId: string | null }> = [];
  const selectedSessions: Array<string | null> = [];
  const disposedTabIds: string[] = [];
  const contextFor = (tab: ConversationTabRecord | null) => {
    const role = tab?.id.includes("main") ? "main" as const : tab?.id.includes("sub") ? "subtask" as const : undefined;
    return { taskRole: role, loopTaskId: role ? "task-1" : null };
  };
  const controller = createSessionTabsController({
    state: initial.state,
    pendingDrafts,
    conversationTabPrefix: "tab_",
    getCurrentCli: () => currentCli,
    setCurrentCli: (cli) => { currentCli = cli; },
    getDefaultCli: () => "codex",
    isCliName: (value): value is CliName => CLI_LIST.includes(value as CliName),
    getLatestSessionId: () => null,
    getSessionStore: () => undefined,
    getWorkspaceSettings: () => settings,
    saveWorkspaceSettings: () => undefined,
    setCurrentSession: (_cli, sessionId) => { selectedSessions.push(sessionId); },
    setWorkspaceInteractiveModeForCli: (cli, mode) => { modes[cli] = mode; return true; },
    resolveAutoInteractiveModeForConversationTab: (tab) => contextFor(tab).taskRole === "main" ? "loop_plus" : "coding",
    collectRunningLoopTaskIds: () => new Set(),
    readLoopTaskRunState: () => ({ isRunning: false, status: "running" }),
    getLoopTaskSchedulingMode: () => "event_driven",
    resolveConversationTabLoopContext: contextFor,
    buildSessionLabelFromPrompt: () => null,
  });
  const sessionStore = createCliRecord((): SessionStore[CliName] => ({ currentId: null, sessions: [] }));
  const host = createExtensionSessionTabsHost({
    readOrdinaryConversationTabTaskRecord: () => null,
    readDepartmentTaskRecord: () => null,
    readDepartmentLeaderTaskIds: () => null,
    getSessionTabsController: () => controller,
    getSessionLifecycleController: () => ({
      loadSessionStore: () => sessionStore,
      cleanupSessionRetentionAcrossWorkspaces: async () => undefined,
      ensureLocalSession: () => undefined,
      assignPendingLabel: () => undefined,
      persistActiveMessages: () => undefined,
      attachPendingMessages: () => undefined,
    }),
    getSessionStore: () => sessionStore,
    setSessionStore: () => undefined,
    getCurrentCli: () => currentCli,
    setCurrentCli: (cli) => { currentCli = cli; },
    getActiveWorkspaceKey: () => "workspace",
    getWorkspaceSettings: () => settings,
    saveWorkspaceSettings: () => undefined,
    getLoopGroupChatTasks: () => [],
    getPrimaryRunTabId: () => null,
    getActiveTaskRun: () => null,
    getLiveMessagesForTab: () => null,
    getPendingSessionDraft: (tabId, cli = currentCli) => pendingDrafts[`${tabId}::${cli}`] ??= { messages: [], label: null, firstPrompt: null },
    getActiveTabIdForRun: () => null,
    getActiveSessionId: () => null,
    persistSessionStore: async () => undefined,
    getSessionStoreKey: () => "workspace",
    loadSessionMessages: () => [],
    saveSessionMessages: () => undefined,
    buildSessionLabelFromPrompt: () => null,
    shouldUseFallbackSessionLabel: () => false,
    isTabRunActive: (tabId) => Boolean(tabId && initial.runningTabIds?.has(tabId)),
    isLoopMainTabCloseLocked: (tabId) => Boolean(tabId && initial.lockedTabIds?.has(tabId)),
    postPanelState: async () => {
      postedClis.push(currentCli);
      postedTabIds.push(controller.getActiveConversationTabId());
      await initial.onPostPanelState?.();
    },
    postConversationTabClosed: (tabId, activeTabId) => { closedTabs.push({ tabId, activeTabId }); },
    restoreConversationTabConfiguration: async (tabId) => {
      restoredTabIds.push(tabId);
      await initial.onRestore?.(tabId);
    },
    updateStatusBar: () => undefined,
    maybePromptInstallOnCliGroupSwitch: async () => undefined,
    sendSessionMessagesToPanel: (_cli, _sessionId, tabId) => { sentTabIds.push(tabId ?? null); },
    getInteractiveSessionBindingsForTab: (tab) => [tab.id],
    disposeInteractiveRunnerIfUnused: (binding) => { disposedTabIds.push(String(binding)); },
    setWorkspaceInteractiveModeForCli: (cli, mode) => { modes[cli] = mode; return true; },
    resolveAutoInteractiveModeForConversationTab: (tab) => contextFor(tab).taskRole === "main" ? "loop_plus" : "coding",
    extractSessionId: () => null,
    isLocalSessionId: () => false,
    migrateLocalSessionToTargetSession: () => undefined,
    adoptSessionId: () => undefined,
    getActiveTaskRunMutable: () => null,
    logInfo: () => undefined,
    activeData: { WORKSPACE_KEY_FALLBACK: "fallback", LEGACY_SESSION_FILE: "legacy", SESSION_DIR: "sessions", SESSION_BUFFER_LIMIT: 1 },
  });
  return { host, modes, postedClis, postedTabIds, restoredTabIds, sentTabIds, closedTabs, selectedSessions, disposedTabIds, currentCli: () => currentCli };
}
