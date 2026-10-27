import test = require("node:test");
import assert = require("node:assert/strict");

import { CLI_LIST, type CliName, type InteractiveMode } from "../../cli/types";
import { createCliRecord } from "../../cli/types";
import { createExtensionSessionTabsHost } from "../../extensionHost/sessionTabs";
import { createSessionTabsController, type ConversationTabRecord, type ConversationTabsState, type PendingSessionDraft } from "../../sessionTabs";
import type { SessionStore } from "../../sessionStore";

function createHost(initial: {
  state: ConversationTabsState;
  currentCli: CliName;
  modes: Partial<Record<CliName, InteractiveMode>>;
  graphTabIds?: Set<string>;
}) {
  let currentCli = initial.currentCli;
  const modes = { ...initial.modes };
  const settings: { currentCli?: CliName } = {};
  const pendingDrafts: Record<string, PendingSessionDraft> = {};
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
    setCurrentSession: () => undefined,
    setWorkspaceInteractiveModeForCli: (cli, mode) => { modes[cli] = mode; return true; },
    resolveAutoInteractiveModeForConversationTab: (tab) => contextFor(tab).taskRole === "main" ? "loop_plus" : "coding",
    collectRunningLoopTaskIds: () => new Set(),
    isLoopTaskRunning: () => false,
    getLoopTaskStatus: () => "running",
    getLoopTaskSchedulingMode: () => "event_driven",
    resolveConversationTabLoopContext: contextFor,
    buildSessionLabelFromPrompt: () => null,
  });
  const sessionStore = createCliRecord((): SessionStore[CliName] => ({ currentId: null, sessions: [] }));
  const host = createExtensionSessionTabsHost({
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
    getGraphNodeRunTarget: () => undefined,
    deleteGraphNodeRunTarget: () => undefined,
    setGraphNodeRunTarget: () => undefined,
    getPrimaryRunTabId: () => null,
    getActiveTaskRun: () => null,
    getParallelGraphRunId: () => undefined,
    getInteractiveGraphRunId: () => undefined,
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
    isGraphRunBlockedForMainTab: () => false,
    isTabRunActive: () => false,
    isLoopMainTabCloseLocked: () => false,
    postPanelState: async () => undefined,
    updateStatusBar: () => undefined,
    maybePromptInstallOnCliGroupSwitch: async () => undefined,
    sendSessionMessagesToPanel: () => undefined,
    getInteractiveSessionBindingsForTab: () => [],
    disposeInteractiveRunnerIfUnused: () => undefined,
    setWorkspaceInteractiveModeForCli: (cli, mode) => { modes[cli] = mode; return true; },
    resolveAutoInteractiveModeForConversationTab: (tab) => initial.graphTabIds?.has(tab?.id ?? "")
      ? "graph"
      : contextFor(tab).taskRole === "main" ? "loop_plus" : "coding",
    extractSessionId: () => null,
    isLocalSessionId: () => false,
    migrateLocalSessionToTargetSession: () => undefined,
    adoptSessionId: () => undefined,
    getActiveTaskRunMutable: () => null,
    logInfo: () => undefined,
    activeData: { WORKSPACE_KEY_FALLBACK: "fallback", LEGACY_SESSION_FILE: "legacy", SESSION_DIR: "sessions", SESSION_BUFFER_LIMIT: 1 },
  });
  return { host, modes, currentCli: () => currentCli };
}

test("returning from a cross-CLI Loop+ subtask restores the main CLI and Loop+ mode", async () => {
  const state: ConversationTabsState = {
    activeTabId: "sub-tab",
    tabs: [
      { id: "main-tab", cli: "codex", sessionId: "main", sessionIdByCli: { codex: "main" }, createdAt: 1 },
      { id: "sub-tab", cli: "claude", sessionId: "sub", sessionIdByCli: { claude: "sub" }, createdAt: 2 },
    ],
  };
  const env = createHost({ state, currentCli: "claude", modes: { codex: "loop_plus", claude: "coding" } });
  await env.host.switchVisibleConversationTabForLoop("main-tab");
  assert.equal(env.currentCli(), "codex");
  assert.equal(env.modes.codex, "loop_plus");
  assert.equal(env.modes.claude, "coding");
});

test("closing a Graph node tab restores the main tab Graph mode and preserves an unrelated mode", async () => {
  const state: ConversationTabsState = {
    activeTabId: "node-tab",
    tabs: [
      { id: "main-tab", cli: "codex", sessionId: "main", sessionIdByCli: { codex: "main" }, createdAt: 1 },
      { id: "node-tab", cli: "claude", sessionId: "node", sessionIdByCli: { claude: "node" }, createdAt: 2 },
      { id: "vibe-tab", cli: "opencode", sessionId: "vibe", sessionIdByCli: { opencode: "vibe" }, createdAt: 3 },
    ],
  };
  const env = createHost({ state, currentCli: "claude", modes: { codex: "graph", claude: "loop_plus" }, graphTabIds: new Set(["main-tab"]) });
  await env.host.closeConversationTabAndRefreshPanel("node-tab");
  assert.equal(env.currentCli(), "codex");
  assert.equal(env.modes.codex, "graph");
  assert.equal(env.modes.claude, "loop_plus");
});

test("a rejected main-tab switch does not change the current CLI or mode", async () => {
  const state: ConversationTabsState = {
    activeTabId: "sub-tab",
    tabs: [{ id: "sub-tab", cli: "claude", sessionId: "sub", sessionIdByCli: { claude: "sub" }, createdAt: 1 }],
  };
  const env = createHost({ state, currentCli: "claude", modes: { claude: "coding" } });
  assert.equal(await env.host.switchVisibleConversationTabForLoop("missing-tab"), null);
  assert.equal(env.currentCli(), "claude");
  assert.equal(env.modes.claude, "coding");
});
