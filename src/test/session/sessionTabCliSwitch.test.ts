import test = require("node:test");
import assert = require("node:assert/strict");

import { CLI_LIST, type CliName, type InteractiveMode } from "../../cli/types";
import { createCliRecord } from "../../cli/types";
import { createExtensionSessionTabsHost } from "../../extensionHost/sessionTabs";
import { createSessionTabsController, type ConversationTabRecord, type ConversationTabsState, type PendingSessionDraft } from "../../sessionTabs";
import type { SessionStore } from "../../sessionStore";
import { closeLoopSubtaskConversationTabs, prepareLoopSubtaskConversationTabClose } from "../../extensionHost/loopSubtaskTabs";
import { finalizeLoopSubtaskRun } from "../../loopSubtaskLifecycle";
import { takeOverSessionTab } from "../../extensionHost/sessionTabOwnership";

function createHost(initial: {
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

test("closing a background tab does not restore configuration for the unchanged active tab", async () => {
  const state: ConversationTabsState = {
    activeTabId: "main-tab",
    tabs: [
      { id: "main-tab", cli: "codex", sessionId: "main", sessionIdByCli: { codex: "main" }, createdAt: 1 },
      { id: "background-tab", cli: "claude", sessionId: "background", sessionIdByCli: { claude: "background" }, createdAt: 2 },
    ],
  };
  const env = createHost({
    state, currentCli: "codex", modes: { codex: "coding", claude: "coding" },
    onPostPanelState: async () => { throw new Error("Background close must not reload CLI configuration"); },
  });
  await env.host.closeConversationTabAndRefreshPanel("background-tab");
  assert.deepEqual(env.restoredTabIds, []);
  assert.deepEqual(env.closedTabs, [{ tabId: "background-tab", activeTabId: "main-tab" }]);
  assert.deepEqual(env.postedClis, []);
  assert.deepEqual(env.sentTabIds, []);
  assert.deepEqual(env.selectedSessions, []);
  assert.deepEqual(env.disposedTabIds, ["background-tab"]);
  assert.equal(state.activeTabId, "main-tab");
});

test("session takeover stops a running duplicate before the real tab host closes it", async () => {
  const runningTabIds = new Set(["old-sub"]);
  const state: ConversationTabsState = {
    activeTabId: "new-sub",
    tabs: [
      { id: "old-sub", cli: "codex", sessionId: "shared", sessionIdByCli: { codex: "shared" }, createdAt: 1 },
      { id: "new-sub", cli: "codex", sessionId: "shared", sessionIdByCli: { codex: "shared" }, createdAt: 2 },
    ],
  };
  const env = createHost({ state, currentCli: "codex", modes: { codex: "coding" }, runningTabIds });
  const stopped: string[] = [];
  assert.equal(await takeOverSessionTab({ tabId: "new-sub", cli: "codex", sessionId: "shared" }, {
    getWorkspaceKey: () => "workspace",
    getTabs: () => state.tabs,
    getActiveRuns: () => [...runningTabIds].map((tabId) => ({ tabId, cli: "codex", sessionId: "shared" })),
    isTabRunActive: (id) => runningTabIds.has(id),
    stopTab: (id) => { stopped.push(id); runningTabIds.delete(id); },
    closeTab: env.host.closeConversationTabAndRefreshPanel,
  }), true);
  assert.deepEqual(stopped, ["old-sub"]);
  assert.deepEqual(state.tabs.map((item) => item.id), ["new-sub"]);
  assert.equal(state.tabs[0].sessionId, "shared");
  assert.equal(state.activeTabId, "new-sub");
  assert.deepEqual(env.closedTabs, [{ tabId: "old-sub", activeTabId: "new-sub" }]);
  assert.deepEqual(env.restoredTabIds, []);
});

test("closing an active tab acknowledges removal before slow fallback configuration restoration", async () => {
  const state: ConversationTabsState = {
    activeTabId: "closing-tab",
    tabs: [
      { id: "fallback-tab", cli: "codex", sessionId: "fallback", sessionIdByCli: { codex: "fallback" }, createdAt: 1 },
      { id: "closing-tab", cli: "codex", sessionId: "closing", sessionIdByCli: { codex: "closing" }, createdAt: 2 },
    ],
  };
  let finishRestore!: () => void;
  const restoring = new Promise<void>((resolve) => { finishRestore = resolve; });
  const env = createHost({ state, currentCli: "codex", modes: {}, onRestore: () => restoring });
  const closing = env.host.closeConversationTabAndRefreshPanel("closing-tab");
  try {
    assert.deepEqual(env.closedTabs, [{ tabId: "closing-tab", activeTabId: "fallback-tab" }]);
    assert.deepEqual(env.restoredTabIds, ["fallback-tab"]);
    assert.deepEqual(env.postedClis, []);
    assert.deepEqual(env.sentTabIds, []);
  } finally {
    finishRestore();
    await closing;
  }
  assert.deepEqual(env.selectedSessions, ["fallback"]);
  assert.deepEqual(env.postedTabIds, ["fallback-tab"]);
  assert.equal(env.sentTabIds.length, 1);
});

test("closing protected tabs never acknowledges removal or disposes their runners", async () => {
  for (const protection of ["running", "loop-main", "last"] as const) {
    const state: ConversationTabsState = {
      activeTabId: "protected-tab",
      tabs: [{ id: "protected-tab", cli: "codex", sessionId: "protected", sessionIdByCli: { codex: "protected" }, createdAt: 1 }],
    };
    if (protection !== "last") {
      state.tabs.push({ id: "other-tab", cli: "codex", sessionId: "other", sessionIdByCli: { codex: "other" }, createdAt: 2 });
    }
    const env = createHost({
      state, currentCli: "codex", modes: {},
      runningTabIds: new Set(protection === "running" ? ["protected-tab"] : []),
      lockedTabIds: new Set(protection === "loop-main" ? ["protected-tab"] : []),
    });
    await env.host.closeConversationTabAndRefreshPanel("protected-tab");
    assert.equal(state.tabs.some((tab) => tab.id === "protected-tab"), true, protection);
    assert.deepEqual(env.closedTabs, [], protection);
    assert.deepEqual(env.disposedTabIds, [], protection);
  }
});

test("repeated and consecutive background closes do not refresh the active conversation", async () => {
  const state: ConversationTabsState = {
    activeTabId: "active-tab",
    tabs: ["active-tab", "first-tab", "second-tab"].map((id) => ({ id, cli: "codex", sessionId: id, sessionIdByCli: { codex: id }, createdAt: 1 })),
  };
  const env = createHost({ state, currentCli: "codex", modes: {} });
  await Promise.all([
    env.host.closeConversationTabAndRefreshPanel("first-tab"),
    env.host.closeConversationTabAndRefreshPanel("first-tab"),
    env.host.closeConversationTabAndRefreshPanel("second-tab"),
  ]);
  assert.deepEqual(env.closedTabs.map((tab) => tab.tabId), ["first-tab", "second-tab"]);
  assert.deepEqual(env.postedClis, []);
  assert.deepEqual(env.sentTabIds, []);
  assert.deepEqual(env.selectedSessions, []);
  assert.deepEqual(state.tabs.map((tab) => tab.id), ["active-tab"]);
});

test("a restarted subtask completion closes its old tabs but preserves unrelated and running tabs", async () => {
  const tabIds = ["main-tab", "stopped-sub", "restarted-sub", "running-sub", "other-sub", "other-parent-sub", "ordinary-tab"];
  const state: ConversationTabsState = {
    activeTabId: "main-tab",
    tabs: tabIds.map((id, index) => ({ id, cli: index === 1 ? "claude" : "codex", sessionId: id, sessionIdByCli: index === 1 ? { claude: id } : { codex: id }, createdAt: index })),
  };
  const env = createHost({ state, currentCli: "codex", modes: {}, runningTabIds: new Set(["running-sub"]) });
  const context = { taskId: "task-1", subtaskId: "A" };
  const closeSubtaskTab = (tabId: string) => closeLoopSubtaskConversationTabs({ ...context, tabId }, {
    getTabs: () => state.tabs,
    resolveContext: (tab) => {
      if (tab.id === "other-sub") return { ...context, subtaskId: "B" };
      if (tab.id === "other-parent-sub") return { ...context, taskId: "task-2" };
      return tab.id.endsWith("-sub") ? context : null;
    },
    isTabRunActive: (candidateId) => candidateId === "running-sub",
    closeTab: env.host.closeConversationTabAndRefreshPanel,
  });
  for (const runStatus of ["stopped", "error", "end"] as const) {
    await finalizeLoopSubtaskRun({
      ...context, round: 1, runStatus, assistantContent: "子任务结果", tabId: "restarted-sub",
    }, {
      markSubtaskRunFinished: () => undefined,
      closeSubtaskTab,
      logSubtaskTabAutoClosed: () => undefined,
    });
    assert.deepEqual(state.tabs.map((tab) => tab.id), runStatus === "end"
      ? ["main-tab", "running-sub", "other-sub", "other-parent-sub", "ordinary-tab"]
      : tabIds);
  }
  assert.deepEqual(env.restoredTabIds, []);
  assert.equal(state.activeTabId, "main-tab");
});

test("control cleanup without an attempt tab uses a snapshot and keeps a newly dispatched tab", async () => {
  const context = { taskId: "task-1", subtaskId: "A" };
  const state: ConversationTabsState = {
    activeTabId: "main-tab",
    tabs: ["main-tab", "stopped-sub"].map((id) => ({ id, cli: "codex", sessionId: id, sessionIdByCli: { codex: id }, createdAt: 1 })),
  };
  const env = createHost({ state, currentCli: "codex", modes: {} });
  await closeLoopSubtaskConversationTabs(context, {
    getTabs: () => state.tabs,
    resolveContext: (tab) => tab.id === "main-tab" ? null : context,
    isTabRunActive: () => false,
    closeTab: async (tabId) => {
      state.tabs.push({ id: "new-sub", cli: "codex", sessionId: "new", sessionIdByCli: { codex: "new" }, createdAt: 2 });
      await env.host.closeConversationTabAndRefreshPanel(tabId);
    },
  });
  assert.deepEqual(state.tabs.map((tab) => tab.id), ["main-tab", "new-sub"]);
});

test("subtask cleanup supports an explicit tab without metadata and propagates close errors", async () => {
  const context = { taskId: "task-1", subtaskId: "A", tabId: "sub-tab" };
  const tabs: ConversationTabRecord[] = [{ id: "sub-tab", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 1 }];
  const deps = {
    getTabs: () => tabs,
    resolveContext: () => null,
    isTabRunActive: () => false,
    closeTab: async () => { throw new Error("panel refresh failed"); },
  };
  await assert.rejects(closeLoopSubtaskConversationTabs(context, deps), /panel refresh failed/);
  await closeLoopSubtaskConversationTabs({ ...context, tabId: "missing" }, deps);
});

test("压缩后的关页仅清理完成时快照，保护新增及换绑标签", async () => {
  const context = { taskId: "task", subtaskId: "child", tabId: "completed-sub" };
  for (const change of ["new-tab", "cli", "session", "object", "task", "context"] as const) {
    const tabs: ConversationTabRecord[] = ["old-sub", "completed-sub"].map((id) => ({
      id, cli: "codex", sessionId: "session", sessionIdByCli: { codex: "session" }, createdAt: 1,
    }));
    const closed: string[] = [];
    const close = prepareLoopSubtaskConversationTabClose(context, {
      getTabs: () => tabs,
      resolveContext: (tab) => {
        if (tab.id !== "completed-sub") return context;
        if (change === "task") return { ...context, taskId: "replacement-task" };
        if (change === "context") return { ...context, subtaskId: "replacement" };
        return context;
      },
      isTabRunActive: () => false,
      closeTab: async (id) => { closed.push(id); tabs.splice(tabs.findIndex((tab) => tab.id === id), 1); },
    });
    if (change === "new-tab") tabs.push({ ...tabs[1], id: "replacement-sub" });
    if (change === "cli") tabs[1].cli = "claude";
    if (change === "session") tabs[1].sessionIdByCli.codex = "new-session";
    if (change === "object") tabs[1] = { ...tabs[1] };
    await close();
    assert.deepEqual(closed, change === "new-tab" ? ["old-sub", "completed-sub"] : ["old-sub"], change);
  }
});

test("关页被宿主拒绝时明确失败，不能伪报关闭成功", async () => {
  const tab: ConversationTabRecord = { id: "completed", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 1 };
  const context = { taskId: "task", subtaskId: "child", tabId: tab.id };
  await assert.rejects(closeLoopSubtaskConversationTabs(context, {
    getTabs: () => [tab], resolveContext: () => context, isTabRunActive: () => false, closeTab: async () => {},
  }), /关闭未生效/);
});

test("an old attempt cannot close a newer replacement tab waiting to start", async () => {
  const context = { taskId: "task-1", subtaskId: "A" };
  const state: ConversationTabsState = {
    activeTabId: "main-tab",
    tabs: ["main-tab", "stopped-sub", "queued-sub"].map((id) => ({
      id, cli: "codex", sessionId: id, sessionIdByCli: { codex: id }, createdAt: 1,
    })),
  };
  const env = createHost({ state, currentCli: "codex", modes: {} });
  await closeLoopSubtaskConversationTabs({ ...context, tabId: "stopped-sub" }, {
    getTabs: () => state.tabs,
    resolveContext: (tab) => tab.id === "main-tab" ? null : context,
    isTabRunActive: () => false,
    closeTab: env.host.closeConversationTabAndRefreshPanel,
  });
  assert.deepEqual(state.tabs.map((tab) => tab.id), ["main-tab", "queued-sub"]);
});

for (const cli of CLI_LIST) {
  test(`resetting a ${cli} conversation replaces only its tab without restoring a neighboring configuration`, async () => {
    const state: ConversationTabsState = {
      activeTabId: "old-tab",
      tabs: [
        { id: "neighbor-tab", cli: "claude", sessionId: "neighbor-session", sessionIdByCli: { claude: "neighbor-session" }, createdAt: 1 },
        { id: "old-tab", cli, sessionId: "old-session", sessionIdByCli: { [cli]: "old-session" }, createdAt: 2, executionLocked: true },
      ],
    };
    const env = createHost({ state, currentCli: cli, modes: { [cli]: "coding" } });

    await env.host.resetConversationTabSession();

    assert.equal(env.currentCli(), cli);
    assert.equal(state.tabs.length, 2);
    assert.equal(state.tabs[0].id, "neighbor-tab");
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    assert.ok(activeTab);
    assert.notEqual(activeTab.id, "old-tab");
    assert.equal(activeTab.cli, cli);
    assert.equal(activeTab.sessionId, null);
    assert.deepEqual(activeTab.sessionIdByCli, {});
    assert.equal(activeTab.executionLocked, undefined);
    assert.deepEqual(env.restoredTabIds, []);
    assert.deepEqual(env.postedClis, [cli]);
    assert.deepEqual(env.postedTabIds, [activeTab.id]);
    assert.deepEqual(env.closedTabs, []);
  });
}

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
