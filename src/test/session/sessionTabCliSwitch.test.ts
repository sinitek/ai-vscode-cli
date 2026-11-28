import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";

import { CLI_LIST, type CliName, type InteractiveMode } from "../../cli/types";
import { createCliRecord } from "../../cli/types";
import { createExtensionSessionTabsHost } from "../../extensionHost/sessionTabs";
import { createSessionTabsController, type ConversationTabRecord, type ConversationTabsState, type PendingSessionDraft } from "../../sessionTabs";
import type { SessionStore } from "../../sessionStore";
import { closeLoopSubtaskConversationTabs, createCompletedLoopSubtaskTabCleanup, prepareLoopSubtaskConversationTabClose, resolveCompletedLoopSubtaskTabBinding, retryLoopSubtaskTabClose } from "../../extensionHost/loopSubtaskTabs";
import { finalizeLoopSubtaskRun } from "../../loopSubtaskLifecycle";
import { createLoopPlusScheduler, type LoopPlusExecutionRecord, type LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import type { LoopSubtaskRecord, LoopTaskRecord } from "../../loopTaskStore";
import type { TaskRunRecord } from "../../promptRunState";
import type { DepartmentMetadata } from "../../department";
import { takeOverSessionTab } from "../../extensionHost/sessionTabOwnership";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
import { createRunStatusHarness } from "../webview/tabRunStatusHarness";

function createHost(initial: {
  state: ConversationTabsState;
  currentCli: CliName;
  modes: Partial<Record<CliName, InteractiveMode>>;
  onRestore?: (tabId: string) => Promise<void>;
  runningTabIds?: ReadonlySet<string>;
  lockedTabIds?: ReadonlySet<string>;
  departmentTask?: LoopTaskRecord;
  onPostPanelState?: () => Promise<void>;
  onSubtaskTabCreated?: (tabId: string) => void;
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
  const essentialLogs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const contextFor = (tab: ConversationTabRecord | null) => {
    const role = tab?.id.includes("main") ? "main" as const : tab?.id.includes("sub") ? "subtask" as const : undefined;
    return { taskRole: role ?? null, loopTaskId: role ? "task-1" : null };
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
    readLoopTaskRunState: () => ({ isRunning: false, status: initial.departmentTask?.status ?? "running" }),
    getLoopTaskSchedulingMode: () => "event_driven",
    resolveConversationTabLoopContext: contextFor,
    buildSessionLabelFromPrompt: () => null,
  });
  const sessionStore = createCliRecord((): SessionStore[CliName] => ({ currentId: null, sessions: [] }));
  const host = createExtensionSessionTabsHost({
    readOrdinaryConversationTabTaskRecord: () => null,
    readDepartmentTaskRecord: (taskId) => initial.departmentTask?.id === taskId ? initial.departmentTask : null,
    readDepartmentLeaderTaskIds: () => null,
    onSubtaskTabCreated: initial.onSubtaskTabCreated,

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
    resolveConversationTabLoopContext: contextFor,
    logEssential: (event, payload) => { essentialLogs.push({ event, payload: payload as Record<string, unknown> }); },
    logInfo: () => undefined,
    activeData: { WORKSPACE_KEY_FALLBACK: "fallback", LEGACY_SESSION_FILE: "legacy", SESSION_DIR: "sessions", SESSION_BUFFER_LIMIT: 1 },
  });
  return { host, modes, postedClis, postedTabIds, restoredTabIds, sentTabIds, closedTabs, selectedSessions, disposedTabIds, essentialLogs, currentCli: () => currentCli };
}

test("Loop/Loop+ 派发新会话或续接会话时，首次刷新前子任务标签已显示运行中", async () => {
  for (const cli of ["codex", "claude"] as const) {
    for (const sessionId of [null, "existing-session"]) {
      const view = createRunStatusHarness();
      let createdId: string | undefined;
      let checkedRefresh = false;
      const env = createHost({
        state: { activeTabId: "main-tab", tabs: [{ id: "main-tab", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 1 }] },
        currentCli: "codex", modes: {},
        onSubtaskTabCreated: (tabId) => {
          createdId = tabId;
          view.send({ type: "runStatus", status: "start", tabId });
        },
        onPostPanelState: async () => {
          assert.ok(createdId);
          assert.equal(view.tabState(createdId).running, true);
          checkedRefresh = true;
        },
      });
      const target = env.host.createLoopSubtaskRunTarget(cli, { sessionId });
      assert.equal(target.tabId, createdId);
      assert.equal(target.sessionId, sessionId);
      assert.equal(view.tabState(target.tabId).running, true);
      assert.equal(view.tabState("active").running, false);
      await Promise.resolve();
      assert.equal(checkedRefresh, true);
      view.send({ type: "runStatus", status: "error", tabId: target.tabId });
      assert.equal(view.tabState(target.tabId).running, false);
    }
  }
});

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

test("completed cleanup replaces the final tab with a same-CLI blank tab before restoring configuration", async () => {
  const oldTab: ConversationTabRecord = {
    id: "completed-sub", cli: "claude", sessionId: "finished-session",
    sessionIdByCli: { claude: "finished-session" }, createdAt: 1,
  };
  const state: ConversationTabsState = { activeTabId: oldTab.id, tabs: [oldTab] };
  let stateWasPublishedBeforeRestore = false;
  let panelStatePublished = false;
  const env = createHost({
    state, currentCli: "claude", modes: { claude: "coding" },
    onPostPanelState: async () => { panelStatePublished = true; },
    onRestore: async (tabId) => {
      const replacement = state.tabs.find((tab) => tab.id === tabId);
      stateWasPublishedBeforeRestore = panelStatePublished;
      assert.ok(replacement);
      assert.notEqual(replacement, oldTab);
      assert.equal(replacement.cli, "claude");
      assert.equal(replacement.sessionId, null);
      assert.equal(replacement.sessionIdByCli.claude, undefined);
    },
  });

  await env.host.closeCompletedSubtaskTabAndRefreshPanel(oldTab);

  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].id, state.activeTabId);
  assert.notEqual(state.tabs[0].id, oldTab.id);
  assert.equal(env.currentCli(), "claude");
  assert.equal(stateWasPublishedBeforeRestore, true);
  assert.deepEqual(env.closedTabs, []);
  assert.deepEqual(env.disposedTabIds, [oldTab.id]);
});

test("explicit Loop+ continuation closes its captured only tab after attempt commit and run release, before acceptance", async () => {
  const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("../extensionHost/fixtures/loopPlusRuntimeFixture") as typeof import("../extensionHost/fixtures/loopPlusRuntimeFixture");
  const oldTab: ConversationTabRecord = {
    id: "continued-subtask", cli: "codex", sessionId: "continued-session",
    sessionIdByCli: { codex: "continued-session" }, createdAt: 1,
  };
  const state: ConversationTabsState = { activeTabId: oldTab.id, tabs: [oldTab] };
  const context = { taskId: "continued-task", subtaskId: "A", round: 2, attemptId: "resume-attempt" };
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
    scheduler.dispatch([{ subtaskId: context.subtaskId, attemptId: context.attemptId, writeFiles: ["src/a.ts"] }]);
    const report = path.join(fixture.rootDir, "attempt-report.md");
    fixture.saveTask({
      id: context.taskId, workspaceKey: "workspace", taskStoreFile: fixture.storeFile, cli: "codex",
      rootPrompt: "resume", status: "stopped", runtimeInterrupted: true, schedulingMode: "event_driven", loopPlus: scheduler.snapshot(),
      createdAt: 1, updatedAt: 1, maxRounds: 20, currentRound: context.round, sessionId: fixture.target.sessionId,
      communicationDir: fixture.rootDir, mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
      activeSubtaskId: context.subtaskId, activeSubtaskIds: [context.subtaskId],
      subTasks: [{ id: context.subtaskId, title: "A", status: "blocked", communicationFile: report }],
      rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
    });
    let persistedAtClose: { report: string; outcome: string | undefined } | undefined;
    const runningTabIds = new Set([oldTab.id]);
    const env = createHost({ state, currentCli: "codex", modes: {}, runningTabIds, onPostPanelState: async () => {
      persistedAtClose ??= {
        report: fs.readFileSync(report, "utf8"),
        outcome: createLoopPlusScheduler({ snapshot: fixture.readTask(context.taskId)?.loopPlus }).snapshot().currentReview?.outcome,
      };
    } });
    const cleanup = createCompletedLoopSubtaskTabCleanup({
      getWorkspaceKey: () => "workspace", getTabs: () => state.tabs, isTabRunActive: (id) => runningTabIds.has(id),
      closeTab: env.host.closeCompletedSubtaskTabAndRefreshPanel,
    });
    cleanup.bindPrompt(oldTab, context)?.(oldTab.sessionId);
    runningTabIds.add(oldTab.id);
    const prepared = cleanup.prepareClose(oldTab.id, context);
    let closeCalls = 0;
    const closeRetries: boolean[] = [];
    const close = async () => {
      closeCalls += 1;
      await retryLoopSubtaskTabClose(prepared, (error, _attempt, retrying) => {
        closeRetries.push(retrying);
        assert.match(error instanceof Error ? error.message : String(error), /执行身份/);
        assert.equal(fs.existsSync(report), true);
        assert.equal(createLoopPlusScheduler({ snapshot: fixture.readTask(context.taskId)?.loopPlus }).snapshot().currentReview?.attemptId, context.attemptId);
        runningTabIds.delete(oldTab.id);
      }, 0);
    };
    const orchestration = fixture.adapter.host();
    const recovery = { target: fixture.target, input: { displayPrompt: "resume" } };
    assert.equal(orchestration.notifySubtaskContinuation(context.taskId, "A", "completed", "stale", recovery, close, "obsolete"), false);
    assert.deepEqual(state.tabs, [oldTab]);
    fixture.queueMain(() => fixture.holdMain());
    assert.equal(orchestration.notifySubtaskContinuation(context.taskId, "A", "completed", "resumed", recovery, close, context.attemptId), true);
    await waitForLoopPlus(() => persistedAtClose !== undefined && env.restoredTabIds.length > 0, "唯一子任务标签完成清理");
    assert.equal(persistedAtClose?.outcome, "completed");
    assert.match(persistedAtClose?.report ?? "", /attempt: resume-attempt[\s\S]*resumed/);
    assert.equal(state.tabs.length, 1);
    assert.notEqual(state.tabs[0], oldTab);
    assert.equal(state.tabs[0].cli, "codex");
    assert.equal(state.tabs[0].sessionId, null);
    assert.equal(orchestration.notifySubtaskContinuation(context.taskId, "A", "completed", "duplicate", recovery, close, context.attemptId), false);
    assert.equal(closeCalls, 1);
    assert.deepEqual(closeRetries, [true]);
    assert.deepEqual(env.disposedTabIds, [oldTab.id]);
  } finally {
    fixture.adapter.host().stopParent(context.taskId);
    fixture.releaseHeldMain();
    fixture.dispose();
  }
});

test("classic completion uses the production snapshot to clean current and eligible older tabs after commit", async () => {
  const context = { taskId: "task", subtaskId: "A", round: 2 };
  const makeTab = (id: string): ConversationTabRecord => ({ id, cli: "codex", sessionId: id, sessionIdByCli: { codex: id }, createdAt: 1 });
  const [older, locked, running, rebound, newerBinding, target, newer] = ["older", "locked", "running", "rebound", "newer-binding", "target", "newer"].map(makeTab);
  const state: ConversationTabsState = { activeTabId: target.id, tabs: [older, locked, running, rebound, newerBinding, target, newer] };
  const runningTabIds = new Set([running.id]);
  let committed = false;
  const env = createHost({ state, currentCli: "codex", modes: {}, runningTabIds, lockedTabIds: new Set([locked.id]),
    onPostPanelState: async () => { assert.equal(committed, true); },
  });
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace", getTabs: () => state.tabs, isTabRunActive: (id) => runningTabIds.has(id),
    closeTab: env.host.closeCompletedSubtaskTabAndRefreshPanel,
  });
  for (const tab of [older, locked, running, rebound, newer]) {
    cleanup.bindPrompt(tab, { ...context, round: 1, attemptId: `previous-${tab.id}` })?.(tab.sessionId);
  }
  cleanup.bindPrompt(target, context)?.(target.sessionId);
  cleanup.bindPrompt(newerBinding, context)?.(newerBinding.sessionId);
  await finalizeLoopSubtaskRun({ ...context, runStatus: "end", assistantContent: "done", tabId: target.id }, {
    markSubtaskRunFinished: () => {
      assert.equal(state.tabs.length, 7);
      cleanup.bindPrompt(rebound, { ...context, attemptId: "new-queued-attempt" });
      runningTabIds.clear();
      committed = true;
      return "committed";
    },
    prepareSubtaskTabClose: (tabId, options) => cleanup.prepareClose(tabId, options!.expected!),
    closeSubtaskTab: async () => assert.fail("expected completion snapshot"),
    logSubtaskTabAutoClosed: () => assert.fail("locked candidate must report cleanup failure"),
  });
  assert.deepEqual(env.disposedTabIds, [older.id, target.id]);
  assert.deepEqual(state.tabs, [locked, running, rebound, newerBinding, newer]);
});

for (const mode of ["ordinary", "department-loop-plus", "department-owner"] as const) {
test(`completed snapshot checks persisted idle tabs after reload in ${mode}`, async () => {
  const context = { taskId: "task", subtaskId: "A", round: 2, attemptId: "current" };
  const older: ConversationTabRecord = { id: "persisted-old", cli: "codex", sessionId: "old-session", sessionIdByCli: { codex: "old-session" }, createdAt: 1 };
  const target: ConversationTabRecord = { id: "current-sub", cli: "codex", sessionId: "current-session", sessionIdByCli: { codex: "current-session" }, createdAt: 1 };
  const state: ConversationTabsState = { activeTabId: target.id, tabs: [older, target] };
  const env = createHost({ state, currentCli: "codex", modes: {} });
  const department: DepartmentMetadata | undefined = mode === "ordinary" ? undefined : {
    version: 1, role: "leader", rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", moduleTitle: "模块",
    routes: { director: {}, leader: {}, employee: {} }, limits: { maxLeaders: 1, maxEmployees: 1 },
    ...(mode === "department-loop-plus" ? { executionMode: "loop-plus" } : {}),
  };
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace", getTabs: () => state.tabs, isTabRunActive: () => false,
    closeTab: env.host.closeCompletedSubtaskTabAndRefreshPanel,
    restoredEvidence: {
      readMessages: (cli, sessionId) => cli === "codex" && sessionId === "old-session" ? [{
        id: "old-prompt", role: "user", content: "persisted prompt", createdAt: 100,
        taskRole: "subtask", loopTaskId: "task", loopSubtaskId: "A", loopRound: 1, loopAttemptId: "previous",
      }] : [],
      readRuns: () => [{
        id: "old-run", cli: "codex", sessionId: "old-session", prompt: "persisted prompt", startedAt: 110,
        endedAt: 120, durationMs: 10, status: "end", taskRole: "subtask", loopTaskId: "task",
        loopSubtaskId: "A", loopRound: 1, loopAttemptId: "previous",
      }, {
        id: "current-run", cli: "codex", sessionId: "current-session", prompt: "current", startedAt: 200,
        endedAt: 220, durationMs: 20, status: "end", taskRole: "subtask", loopTaskId: "task",
        loopSubtaskId: "A", loopRound: 2, loopAttemptId: "current",
      }],
      readTask: () => ({
        workspaceKey: "workspace", department, schedulingMode: "event_driven", loopPlus: {
          version: 1, maxConcurrency: 1, phase: "idle", parentStopped: false, completed: false, seq: 0,
          wakeSeq: 0, wakePending: false, userMessageQueue: [], running: [], pending: [], reportQueue: [],
          reviewQueue: [], currentReview: null,
          seenAttempts: [
            { subtaskId: "A", attemptId: "previous", disposition: "reported", requiresAcceptance: false, outcome: "completed" },
            { subtaskId: "A", attemptId: "current", disposition: "reported", requiresAcceptance: false, outcome: "completed" },
          ],
        },
        subTasks: [],
      }),
    },
  });
  cleanup.rememberRestoredTabs([older]);
  cleanup.bindPrompt(target, context)?.(target.sessionId);
  const close = cleanup.prepareClose(target.id, context);
  await close();
  if (mode === "department-owner") {
    assert.deepEqual(env.disposedTabIds, [target.id]);
    assert.deepEqual(state.tabs, [older]);
    return;
  }
  assert.deepEqual(env.disposedTabIds, [older.id, target.id]);
  assert.equal(state.tabs.some((tab) => tab === older || tab === target), false);
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].cli, "codex");
  assert.equal(state.tabs[0].sessionId, null);
});
}

test("completed snapshot keeps restored tabs with newer, unknown, active, or replaced execution identity", async () => {
  for (const scenario of ["newer", "unknown", "active", "replaced"] as const) {
    const context = { taskId: "task", subtaskId: "A", round: 2, attemptId: "current" };
    const older: ConversationTabRecord = { id: "persisted-old", cli: "codex", sessionId: `old-${scenario}`, sessionIdByCli: { codex: `old-${scenario}` }, createdAt: 1 };
    const target: ConversationTabRecord = { id: "current-sub", cli: "codex", sessionId: "current-session", sessionIdByCli: { codex: "current-session" }, createdAt: 1 };
    const state: ConversationTabsState = { activeTabId: target.id, tabs: [older, target] };
    const active = scenario === "active";
    const env = createHost({ state, currentCli: "codex", modes: {}, runningTabIds: active ? new Set([older.id]) : new Set() });
    const cleanup = createCompletedLoopSubtaskTabCleanup({
      getWorkspaceKey: () => "workspace", getTabs: () => state.tabs, isTabRunActive: (id) => active && id === older.id,
      closeTab: env.host.closeCompletedSubtaskTabAndRefreshPanel,
      restoredEvidence: {
        readMessages: (cli, sessionId) => cli === "codex" && sessionId === older.sessionId ? [{
          id: "old-prompt", role: "user", content: "persisted prompt", createdAt: 100,
          ...(scenario === "unknown" ? {} : {
            taskRole: "subtask" as const, loopTaskId: "task", loopSubtaskId: "A",
            loopRound: scenario === "newer" ? 3 : 1, loopAttemptId: scenario === "newer" ? "newer" : "previous",
          }),
        }] : [],
        readRuns: () => [{
          id: "old-run", cli: "codex", sessionId: older.sessionId!, prompt: "persisted prompt", startedAt: 110,
          endedAt: 120, durationMs: 10, status: "end", taskRole: "subtask", loopTaskId: "task",
          loopSubtaskId: "A", loopRound: scenario === "newer" ? 3 : 1, loopAttemptId: scenario === "newer" ? "newer" : "previous",
        }, {
          id: "current-run", cli: "codex", sessionId: "current-session", prompt: "current", startedAt: 200,
          endedAt: 220, durationMs: 20, status: "end", taskRole: "subtask", loopTaskId: "task",
          loopSubtaskId: "A", loopRound: 2, loopAttemptId: "current",
        }],
        readTask: () => ({
          workspaceKey: "workspace", schedulingMode: "event_driven", loopPlus: {
            version: 1, maxConcurrency: 1, phase: "idle", parentStopped: false, completed: false, seq: 0,
            wakeSeq: 0, wakePending: false, userMessageQueue: [], running: [], pending: [], reportQueue: [],
            reviewQueue: [], currentReview: null,
            seenAttempts: [
              { subtaskId: "A", attemptId: "previous", disposition: "reported", requiresAcceptance: false, outcome: "completed" },
              { subtaskId: "A", attemptId: "current", disposition: "reported", requiresAcceptance: false, outcome: "completed" },
              ...(scenario === "newer" ? [{ subtaskId: "A", attemptId: "newer", disposition: "reported" as const, requiresAcceptance: false, outcome: "completed" as const }] : []),
            ],
          },
          subTasks: [],
        }),
      },
    });
    cleanup.rememberRestoredTabs([older]);
    cleanup.bindPrompt(target, context)?.(target.sessionId);
    const close = cleanup.prepareClose(target.id, context);
    if (scenario === "replaced") cleanup.bindPrompt(older, { ...context, attemptId: "queued" });
    await close();
    assert.equal(state.tabs.includes(older), true, scenario);
    assert.equal(env.disposedTabIds.includes(older.id), false, scenario);
    assert.equal(state.tabs.includes(target), false, scenario);
  }
});

test("completed snapshot protects restored sessions reserved by open Loop+ attempts", async (t) => {
  for (const scenario of ["unreserved", "own session", "same-subtask continuation", "earlier successor", "late reservation", "late run", "unknown source"] as const) {
    await t.test(scenario, async () => {
      const context = { taskId: "task", subtaskId: "A", round: 2, attemptId: "current" };
      const makeTab = (id: string): ConversationTabRecord => ({ id, cli: "codex", sessionId: id, sessionIdByCli: { codex: id }, createdAt: 1 });
      const [older, unreserved, target, first] = ["old-session", "other-old-session", "current-session", "first-close"].map(makeTab);
      const late = scenario === "late reservation" || scenario === "late run";
      const state: ConversationTabsState = { activeTabId: late ? first.id : target.id, tabs: [...(late ? [first] : []), older, unreserved, target] };
      const reservationId = scenario === "own session" || scenario === "same-subtask continuation" ? "A" : "B";
      const reservation: LoopPlusExecutionRecord = { subtaskId: reservationId, attemptId: "queued", state: "pending", title: null,
        requiresAcceptance: false, conflictGroup: null, writeFiles: [] };
      const continuedFrom = scenario === "unknown source" ? "missing" : scenario === "same-subtask continuation" ? "source" : "A";
      const oldSession = { cli: "codex" as const, sessionId: older.id, configId: null };
      const subTasks: LoopSubtaskRecord[] = [
        { id: "A", title: "A", status: reservationId === "A" ? "pending" : "completed",
          ...(scenario === "same-subtask continuation" ? { continueFromSubtaskId: continuedFrom } : { executionSession: oldSession }) },
        { id: "source", title: "Source", status: "completed", executionSession: oldSession },
        { id: "B", title: "B", status: "pending", continueFromSubtaskId: continuedFrom },
      ];
      const makeSnapshot = (reserved: boolean): LoopPlusSchedulerSnapshot => {
        const queued: LoopPlusSchedulerSnapshot["seenAttempts"] = reserved
          ? [{ subtaskId: reservationId, attemptId: "queued", disposition: "open", requiresAcceptance: false }] : [];
        const beforeCurrent = scenario === "earlier successor";
        return createLoopPlusScheduler({ snapshot: {
          version: 1, maxConcurrency: 1, phase: "idle", parentStopped: false, completed: false, seq: 0,
          wakeSeq: 0, wakePending: false, userMessageQueue: [], running: [], pending: reserved ? [reservation] : [],
          reportQueue: [], reviewQueue: [], currentReview: null,
          seenAttempts: [
            { subtaskId: "A", attemptId: "previous", disposition: "reported", requiresAcceptance: false, outcome: "completed" },
            { subtaskId: "A", attemptId: "other-old", disposition: "reported", requiresAcceptance: false, outcome: "completed" },
            ...(beforeCurrent ? queued : []),
            { subtaskId: "A", attemptId: "current", disposition: "reported", requiresAcceptance: false, outcome: "completed" },
            ...(!beforeCurrent ? queued : []),
          ],
        } }).snapshot();
      };
      let snapshot = makeSnapshot(!late && scenario !== "unreserved");
      const runs: TaskRunRecord[] = [
        { id: "old-run", cli: "codex", sessionId: older.id, prompt: "persisted prompt", startedAt: 110,
          endedAt: 120, durationMs: 10, status: "end", taskRole: "subtask", loopTaskId: "task",
          loopSubtaskId: "A", loopRound: 1, loopAttemptId: "previous" },
        { id: "other-run", cli: "codex", sessionId: unreserved.id, prompt: "persisted prompt", startedAt: 130,
          endedAt: 140, durationMs: 10, status: "end", taskRole: "subtask", loopTaskId: "task",
          loopSubtaskId: "A", loopRound: 1, loopAttemptId: "other-old" },
        { id: "current-run", cli: "codex", sessionId: target.id, prompt: "current", startedAt: 200,
          endedAt: 220, durationMs: 20, status: "end", taskRole: "subtask", loopTaskId: "task",
          loopSubtaskId: "A", loopRound: 2, loopAttemptId: "current" },
      ];
      let historyReads = 0;
      let updated = false;
      const env = createHost({ state, currentCli: "codex", modes: {}, onPostPanelState: async () => {
        if (!late || updated) return;
        assert.deepEqual(env.disposedTabIds, [first.id]);
        await Promise.resolve();
        if (scenario === "late reservation") snapshot = makeSnapshot(true);
        if (scenario === "late run") runs.push({ ...runs[0], id: "new-run", loopAttemptId: "new", startedAt: 225, endedAt: 235 });
        updated = true;
      } });
      const cleanup = createCompletedLoopSubtaskTabCleanup({
        getWorkspaceKey: () => "workspace", getTabs: () => state.tabs, isTabRunActive: () => false,
        closeTab: env.host.closeCompletedSubtaskTabAndRefreshPanel,
        restoredEvidence: {
          readMessages: (cli, sessionId) => cli === "codex" && [older.id, unreserved.id].includes(sessionId) ? [{
            id: `prompt-${sessionId}`, role: "user", content: "persisted prompt", createdAt: 100,
            taskRole: "subtask", loopTaskId: "task", loopSubtaskId: "A", loopRound: 1,
            loopAttemptId: sessionId === older.id ? "previous" : "other-old",
          }] : [],
          readRuns: () => { historyReads += 1; return runs; },
          readRunsRevision: () => String(runs.length),
          readTask: () => ({ workspaceKey: "workspace", schedulingMode: "event_driven", loopPlus: snapshot, subTasks }),
        },
      });
      cleanup.rememberRestoredTabs([older, unreserved]);
      if (late) cleanup.bindPrompt(first, { ...context, round: 1, attemptId: "first" })?.(first.sessionId);
      cleanup.bindPrompt(target, context)?.(target.sessionId);
      await cleanup.prepareClose(target.id, context)();
      assert.deepEqual(env.disposedTabIds, [
        ...(late ? [first.id] : []), ...(scenario === "unreserved" ? [older.id] : []),
        ...(scenario === "unknown source" ? [] : [unreserved.id]), target.id,
      ]);
      assert.equal(state.tabs.includes(older), scenario !== "unreserved");
      assert.equal(state.tabs.includes(target), false);
      assert.equal(historyReads, scenario === "late run" ? 2 : 1);
    });
  }
});

test("completed snapshot rejects same-tab same-session attempt replacement before or after capture", async () => {
  for (const replaceBeforeCapture of [false, true]) {
    const context = { taskId: "task", subtaskId: "A", round: 2, attemptId: "old" };
    const tab: ConversationTabRecord = { id: "sub", cli: "codex", sessionId: "shared", sessionIdByCli: { codex: "shared" }, createdAt: 1 };
    const state: ConversationTabsState = { activeTabId: tab.id, tabs: [tab] };
    const env = createHost({ state, currentCli: "codex", modes: {} });
    const cleanup = createCompletedLoopSubtaskTabCleanup({
      getWorkspaceKey: () => "workspace", getTabs: () => state.tabs, isTabRunActive: () => false,
      closeTab: env.host.closeCompletedSubtaskTabAndRefreshPanel,
    });
    const settleOld = cleanup.bindPrompt(tab, context);
    settleOld?.(tab.sessionId);
    if (replaceBeforeCapture) cleanup.bindPrompt(tab, { ...context, attemptId: "new" });
    const close = cleanup.prepareClose(tab.id, context);
    if (!replaceBeforeCapture) cleanup.bindPrompt(tab, { ...context, attemptId: "new" });
    settleOld?.(tab.sessionId);
    await assert.rejects(close(), /执行身份/);
    assert.deepEqual(state.tabs, [tab]);
    assert.deepEqual(env.disposedTabIds, []);
  }
});

test("completed host refuses to close a captured tab object replaced by a newer target", async () => {
  const oldTab: ConversationTabRecord = {
    id: "captured-subtask", cli: "claude", sessionId: "old-session",
    sessionIdByCli: { claude: "old-session" }, createdAt: 1,
  };
  const state: ConversationTabsState = { activeTabId: oldTab.id, tabs: [oldTab] };
  const env = createHost({ state, currentCli: "claude", modes: {} });
  state.tabs[0] = { ...oldTab, sessionId: "new-session", sessionIdByCli: { claude: "new-session" } };
  await assert.rejects(env.host.closeCompletedSubtaskTabAndRefreshPanel(oldTab), /已被替代/);
  assert.equal(state.tabs[0].sessionId, "new-session");
  assert.deepEqual(env.disposedTabIds, []);
});

test("manual close still retains the final tab", async () => {
  const tab: ConversationTabRecord = {
    id: "manual-last", cli: "codex", sessionId: "keep-session",
    sessionIdByCli: { codex: "keep-session" }, createdAt: 1,
  };
  const state: ConversationTabsState = { activeTabId: tab.id, tabs: [tab] };
  const env = createHost({ state, currentCli: "codex", modes: {} });

  await env.host.closeConversationTabAndRefreshPanel(tab.id);

  assert.deepEqual(state.tabs, [tab]);
  assert.equal(state.activeTabId, tab.id);
  assert.deepEqual(env.disposedTabIds, []);
  assert.deepEqual(env.closedTabs, []);
});

test("completed final-tab cleanup rejects active or locked tabs without success notification", async () => {
  for (const blocked of ["running", "locked"] as const) {
    const tab: ConversationTabRecord = {
      id: `completed-${blocked}`, cli: "codex", sessionId: "finished",
      sessionIdByCli: { codex: "finished" }, createdAt: 1,
    };
    const state: ConversationTabsState = { activeTabId: tab.id, tabs: [tab] };
    const env = createHost({
      state, currentCli: "codex", modes: {},
      ...(blocked === "running" ? { runningTabIds: new Set([tab.id]) } : { lockedTabIds: new Set([tab.id]) }),
    });

    await assert.rejects(env.host.closeCompletedSubtaskTabAndRefreshPanel(tab), /未执行自动关闭/);
    assert.deepEqual(state.tabs, [tab]);
    assert.deepEqual(env.closedTabs, []);
    assert.deepEqual(env.disposedTabIds, []);
  }
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

test("closing an active tab switches its conversation before slow fallback configuration restoration", async () => {
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
    assert.deepEqual(env.sentTabIds, ["fallback-tab"]);
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

test("Loop 主任务 Tab 关闭日志记录任务身份、拒绝原因与实际移除结果", async () => {
  const lockedState: ConversationTabsState = {
    activeTabId: "main-tab",
    tabs: [
      { id: "main-tab", cli: "codex", sessionId: "main-session", sessionIdByCli: { codex: "main-session" }, createdAt: 1 },
      { id: "other-tab", cli: "codex", sessionId: "other-session", sessionIdByCli: { codex: "other-session" }, createdAt: 2 },
    ],
  };
  const locked = createHost({
    state: lockedState, currentCli: "codex", modes: {}, lockedTabIds: new Set(["main-tab"]),
  });
  await locked.host.closeConversationTabAndRefreshPanel("main-tab");
  assert.deepEqual(locked.essentialLogs.map(({ event, payload }) => [event, payload.phase, payload.reason]), [
    ["conversation-tab-close", "requested", undefined],
    ["conversation-tab-close", "rejected", "loop-main-running"],
  ]);
  assert.equal(locked.essentialLogs[0].payload.loopTaskId, "task-1");
  assert.equal(locked.essentialLogs[0].payload.taskRole, "main");
  assert.equal(lockedState.tabs.some((tab) => tab.id === "main-tab"), true);

  const closeState = { ...lockedState, tabs: [...lockedState.tabs] };
  const closed = createHost({ state: closeState, currentCli: "codex", modes: {} });
  await closed.host.closeConversationTabAndRefreshPanel("main-tab");
  assert.deepEqual(closed.essentialLogs.map(({ payload }) => payload.phase), ["requested", "closed"]);
  assert.equal(closed.essentialLogs[1].payload.loopTaskId, "task-1");
  assert.equal(closeState.tabs.some((tab) => tab.id === "main-tab"), false);

  const ordinaryState: ConversationTabsState = {
    activeTabId: "ordinary-tab",
    tabs: [
      { id: "ordinary-tab", cli: "codex", sessionId: "ordinary-session", sessionIdByCli: { codex: "ordinary-session" }, createdAt: 1 },
      { id: "fallback-tab", cli: "codex", sessionId: "fallback-session", sessionIdByCli: { codex: "fallback-session" }, createdAt: 2 },
    ],
  };
  const ordinary = createHost({ state: ordinaryState, currentCli: "codex", modes: {} });
  await ordinary.host.closeConversationTabAndRefreshPanel("ordinary-tab");
  assert.equal(ordinary.essentialLogs[0].event, "conversation-tab-close");
  assert.equal(ordinary.essentialLogs[0].payload.taskRole, null);
  assert.equal(ordinary.essentialLogs[0].payload.loopTaskId, null);
});

test("历史总监标签在终态和待复核时保留，迟到清理不能关闭，用户仍可手动关闭", async () => {
  for (const status of ["error", "needs-review", "stopped", "completed"] as const) {
    const root: LoopTaskRecord = {
      id: "task-1", cli: "codex", workspaceKey: "workspace", sessionId: "root", taskStoreFile: "tasks.json",
      rootPrompt: "总监任务", status, createdAt: 1, updatedAt: 1, maxRounds: 3, currentRound: 1,
      communicationDir: "group", mainCommunicationFile: "main.md", subTasks: [], rounds: [],
      completionRoundSummaries: [], completionRequirementCoverage: [], department: {
        version: 1, role: "director", rootTaskId: "task-1", parentTaskId: null, leaderSubtaskId: null, moduleTitle: "部门",
        limits: { maxLeaders: 1, maxEmployees: 1 }, routes: { director: {}, leader: {}, employee: {} },
      },
    };
    const director: ConversationTabRecord = { id: "main-tab", cli: "codex", sessionId: "root", sessionIdByCli: { codex: "root" }, createdAt: 1 };
    const employee: ConversationTabRecord = { ...director, id: "sub-tab", sessionId: "worker", sessionIdByCli: { codex: "worker" } };
    const env = createHost({ state: { activeTabId: director.id, tabs: [director, employee] }, currentCli: "codex", modes: {}, departmentTask: root });
    await assert.rejects(env.host.closeConversationTabAndRefreshPanel(director.id), /手动关闭/);
    assert.equal(env.host.buildConversationTabsState().tabs[0].departmentPresentation?.role, "director");
    assert.equal(director.manualCloseOnly, true);
    env.host.initializeConversationTabsFromWorkspaceSettings();
    const restored = env.host.getConversationTabById(director.id)!;
    assert.equal(restored.manualCloseOnly, true);
    await assert.rejects(env.host.closeOwnedConversationTabAndRefreshPanel(restored), /手动关闭/);
    await assert.rejects(env.host.closeCompletedSubtaskTabAndRefreshPanel(restored), /手动关闭/);
    assert.deepEqual(env.closedTabs, []);
    assert.deepEqual(env.disposedTabIds, []);
    await env.host.resetConversationTabSession();
    assert.ok(env.host.getConversationTabById(director.id));
    await env.host.closeCompletedSubtaskTabAndRefreshPanel(env.host.getConversationTabById(employee.id)!);
    await env.host.closeConversationTabByUser(director.id);
    assert.deepEqual(env.closedTabs.map(({tabId}) => tabId), [employee.id, director.id]);
    assert.equal(env.essentialLogs.at(-1)?.payload.closeTarget, "user");
  }
});

test("组长完成时按原标签和最终会话关页，最后一个标签替换为空会话", async () => {
  const task: LoopTaskRecord = {
    id: "task-1", cli: "codex", workspaceKey: "workspace", sessionId: "native-leader", taskStoreFile: "tasks.json",
    rootPrompt: "组长任务", status: "completed", createdAt: 1, updatedAt: 2, maxRounds: 3, currentRound: 1,
    communicationDir: "group", mainCommunicationFile: "main.md", subTasks: [], rounds: [], completionRoundSummaries: [],
    completionRequirementCoverage: [], department: { version: 1, role: "leader", rootTaskId: "director", parentTaskId: "director",
      leaderSubtaskId: "module", moduleTitle: "模块", limits: { maxLeaders: 1, maxEmployees: 1 }, routes: { director: {}, leader: {}, employee: {} } },
  };
  const tab: ConversationTabRecord = { id: "main-leader", cli: "codex", sessionId: task.sessionId!, sessionIdByCli: { codex: task.sessionId! }, createdAt: 1 };
  const sibling = { ...tab, id: "main-sibling", sessionId: "sibling", sessionIdByCli: { codex: "sibling" } };
  const reopened = { ...tab, id: "main-reopened" };
  const state = { activeTabId: sibling.id, tabs: [tab, sibling, reopened] };
  const runningTabIds = new Set([tab.id]);
  const env = createHost({ state, currentCli: "codex", modes: {}, runningTabIds });
  await assert.rejects(env.host.closeCompletedLeaderTab(tab.id, task), /正在运行/);
  runningTabIds.clear();
  for (const mismatch of [{ workspaceKey: "other" }, { id: "other-task" }, { sessionId: "another-session" }, { cli: "claude" as const }]) {
    await env.host.closeCompletedLeaderTab(tab.id, { ...task, ...mismatch });
  }
  assert.deepEqual(env.closedTabs, []);
  await env.host.closeCompletedLeaderTab(tab.id, task);
  await env.host.closeCompletedLeaderTab(tab.id, task);
  assert.deepEqual(state.tabs.map((item) => item.id), [sibling.id, reopened.id]);
  assert.equal(state.activeTabId, sibling.id);
  assert.deepEqual(env.closedTabs, [{ tabId: tab.id, activeTabId: sibling.id }]);

  const last = createHost({ state: { activeTabId: tab.id, tabs: [tab] }, currentCli: "codex", modes: {} });
  await last.host.closeCompletedLeaderTab(tab.id, task);
  assert.equal(last.host.getConversationTabById(tab.id), null);
  assert.equal(last.host.getActiveConversationTab()?.sessionId, null);
  assert.notEqual(last.host.getActiveConversationTabId(), tab.id);
});

test("重复会话接管在停止总监运行前拒绝，即使此时无法从转录读取角色", async () => {
  const director: ConversationTabRecord = { id: "director", cli: "codex", sessionId: "native", sessionIdByCli: { codex: "native" }, createdAt: 1, manualCloseOnly: true };
  const duplicate = { ...director, id: "duplicate", manualCloseOnly: undefined };
  const tabs = [director, duplicate];
  const env = createHost({ state: { activeTabId: duplicate.id, tabs }, currentCli: "codex", modes: {} });
  await assert.rejects(takeOverSessionTab({ tabId: duplicate.id, cli: duplicate.cli, sessionId: duplicate.sessionId }, {
    getTabs: () => tabs, getWorkspaceKey: () => "workspace", getActiveRuns: () => [], isTabRunActive: () => true,
    stopTab: () => assert.fail("不应停止总监"), closeTab: env.host.closeConversationTabAndRefreshPanel,
    requiresManualClose: env.host.requiresManualClose,
  }), /返回该标签继续/);
  assert.deepEqual(env.closedTabs, []);
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
      markSubtaskRunFinished: () => "committed",
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
  const context = { taskId: "task-1", subtaskId: "A", attemptId: "attempt-old" };
  const state: ConversationTabsState = {
    activeTabId: "main-tab",
    tabs: ["main-tab", "stopped-sub", "queued-sub"].map((id) => ({
      id, cli: "codex", sessionId: id, sessionIdByCli: { codex: id }, createdAt: 1,
    })),
  };
  const env = createHost({ state, currentCli: "codex", modes: {} });
  await closeLoopSubtaskConversationTabs({ ...context, tabId: "stopped-sub" }, {
    getTabs: () => state.tabs,
    resolveContext: (tab) => tab.id === "main-tab" ? null
      : tab.id === "queued-sub" ? { ...context, attemptId: "attempt-new" }
        : context,
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
  assert.deepEqual(env.sentTabIds, ["main-tab"]);
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

test("no-acceptance close uses the completed-tab host after provisional identity and run release", async () => {
  const target: ConversationTabRecord = {
    id: "no-accept-sub", cli: "codex", sessionId: "finished-session",
    sessionIdByCli: { codex: "finished-session" }, createdAt: 1,
  };
  const state: ConversationTabsState = { activeTabId: target.id, tabs: [target] };
  const runningTabIds = new Set([target.id]);
  const env = createHost({ state, currentCli: "codex", modes: {}, runningTabIds });
  let task: { workspaceKey: string; schedulingMode: "event_driven"; subTasks: [] } | null = null;
  let reads = 0;
  const cleanup = createCompletedLoopSubtaskTabCleanup({
    getWorkspaceKey: () => "workspace",
    getTabs: () => state.tabs,
    isTabRunActive: (id) => runningTabIds.has(id),
    closeTab: env.host.closeCompletedSubtaskTabAndRefreshPanel,
    restoredEvidence: {
      readMessages: () => [],
      readRuns: () => [],
      readTask: () => { reads += 1; return task; },
    },
  });
  const context = {
    taskId: "task", subtaskId: "loopplus-post-lp431-macos-full-regression", round: 1,
    attemptId: "lp487-loopplus-post-lp431-macos-full-regression",
  };
  const resolved = resolveCompletedLoopSubtaskTabBinding(null, "workspace", {
    taskRole: "subtask", loopTaskId: context.taskId, loopSubtaskId: context.subtaskId,
    loopRound: context.round, loopAttemptId: context.attemptId,
  });
  assert.equal(resolved?.provisional, true);
  const settle = cleanup.bindPrompt(target, resolved!.context, { provisional: true });
  const prepared = cleanup.prepareClose(target.id, context);
  const failures: string[] = [];
  const attempt = await retryLoopSubtaskTabClose(prepared, (error) => {
    failures.push(error instanceof Error ? error.message : String(error));
    runningTabIds.delete(target.id);
    settle?.(target.sessionId);
    task = { workspaceKey: "workspace", schedulingMode: "event_driven", subTasks: [] };
  }, 0);
  assert.equal(attempt, 2);
  assert.match(failures[0] ?? "", /reason=idle-pending phase=bind/);
  assert.equal(reads, 1);
  assert.equal(state.tabs.includes(target), false);
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].cli, "codex");
  assert.equal(state.tabs[0].sessionId, null);
  assert.deepEqual(env.disposedTabIds, [target.id]);
  await prepared();
  assert.equal(state.tabs.length, 1);
  assert.deepEqual(env.disposedTabIds, [target.id]);
});
