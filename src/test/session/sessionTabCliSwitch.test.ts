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
  onRestore?: (tabId: string) => Promise<void>;
}) {
  let currentCli = initial.currentCli;
  const modes = { ...initial.modes };
  const settings: { currentCli?: CliName } = {};
  const pendingDrafts: Record<string, PendingSessionDraft> = {};
  const restoredTabIds: string[] = [];
  const postedTabIds: Array<string | null> = [];
  const postedClis: CliName[] = [];
  const sentTabIds: Array<string | null> = [];
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
    postPanelState: async () => {
      postedClis.push(currentCli);
      postedTabIds.push(controller.getActiveConversationTabId());
    },
    restoreConversationTabConfiguration: async (tabId) => {
      restoredTabIds.push(tabId);
      await initial.onRestore?.(tabId);
    },
    updateStatusBar: () => undefined,
    maybePromptInstallOnCliGroupSwitch: async () => undefined,
    sendSessionMessagesToPanel: (_cli, _sessionId, tabId) => { sentTabIds.push(tabId ?? null); },
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
  return { host, modes, postedClis, postedTabIds, restoredTabIds, sentTabIds, currentCli: () => currentCli };
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
  assert.deepEqual(env.postedClis, ["codex"]);
  assert.equal(env.modes.codex, "loop_plus");
  assert.equal(env.modes.claude, "coding");
});

test("closing an active Grok tab publishes the fallback Codex configuration", async () => {
  const state: ConversationTabsState = {
    activeTabId: "grok-tab",
    tabs: [
      { id: "codex-tab", cli: "codex", sessionId: "codex-session", sessionIdByCli: { codex: "codex-session" }, createdAt: 1 },
      { id: "grok-tab", cli: "grok", sessionId: "grok-session", sessionIdByCli: { grok: "grok-session" }, createdAt: 2 },
    ],
  };
  const env = createHost({
    state,
    currentCli: "grok",
    modes: { codex: "coding", grok: "coding" },
  });

  await env.host.closeConversationTabAndRefreshPanel("grok-tab");

  assert.equal(env.currentCli(), "codex");
  assert.deepEqual(env.restoredTabIds, ["codex-tab"]);
  assert.deepEqual(env.postedClis, ["codex"]);
  assert.deepEqual(env.postedTabIds, ["codex-tab"]);
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
  assert.deepEqual(env.restoredTabIds, ["main-tab"]);
});

test("closing a background tab does not restore configuration for the unchanged active tab", async () => {
  const state: ConversationTabsState = {
    activeTabId: "main-tab",
    tabs: [
      { id: "main-tab", cli: "codex", sessionId: "main", sessionIdByCli: { codex: "main" }, createdAt: 1 },
      { id: "background-tab", cli: "claude", sessionId: "background", sessionIdByCli: { claude: "background" }, createdAt: 2 },
    ],
  };
  const env = createHost({ state, currentCli: "codex", modes: { codex: "coding", claude: "coding" } });
  await env.host.closeConversationTabAndRefreshPanel("background-tab");
  assert.deepEqual(env.restoredTabIds, []);
});

test("closing an active tab stops stale refresh when another tab becomes active during restore", async () => {
  const state: ConversationTabsState = {
    activeTabId: "closing-tab",
    tabs: [
      { id: "main-tab", cli: "codex", sessionId: "main", sessionIdByCli: { codex: "main" }, createdAt: 1 },
      { id: "closing-tab", cli: "claude", sessionId: "closing", sessionIdByCli: { claude: "closing" }, createdAt: 2 },
      { id: "other-tab", cli: "opencode", sessionId: "other", sessionIdByCli: { opencode: "other" }, createdAt: 3 },
    ],
  };
  const env = createHost({
    state,
    currentCli: "claude",
    modes: { codex: "coding", claude: "coding", opencode: "coding" },
    onRestore: async () => { state.activeTabId = "other-tab"; },
  });
  await env.host.closeConversationTabAndRefreshPanel("closing-tab");
  assert.deepEqual(env.restoredTabIds, ["main-tab"]);
  assert.deepEqual(env.postedTabIds, []);
  assert.deepEqual(env.sentTabIds, []);
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
