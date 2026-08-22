import test = require("node:test");
import assert = require("node:assert/strict");

import { type CliName } from "../cli/types";
import {
  createSessionTabsController,
  findConversationTabForLoopResume,
  resolveAutoInteractiveModeForLoopTask,
  type ConversationTabsState,
} from "../sessionTabs";
import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../webview/viewContentScript/eventBindings";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../webview/viewContentScript/messageRendering";

type TabSummary = {
  id: string;
  loopTaskRole?: string;
  loopTaskId?: string;
  loopTaskRunning?: boolean;
  loopTaskStatus?: string;
  loopMainTabCloseLocked?: boolean;
};

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in webview script`);

  const bodyStart = script.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    const char = script[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }

  throw new Error(`${name} body was not terminated`);
}

function buildIsLoopMainTabCloseLocked(
  tabs: TabSummary[],
  runningTabIds: readonly string[],
): (tab: TabSummary | null) => boolean {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isLoopMainTabCloseLocked");
  const state = { conversationTabs: { tabs } };
  const running = new Set(runningTabIds);
  const isTabRunning = (tabId: string | undefined): boolean => Boolean(tabId && running.has(tabId));
  const getLoopMetaForTabSummary = (tab: TabSummary | null): { taskRole: string; loopTaskId: string } | null => {
    if (!tab || !tab.loopTaskRole || !tab.loopTaskId) {
      return null;
    }
    return {
      taskRole: tab.loopTaskRole,
      loopTaskId: tab.loopTaskId,
    };
  };

  return new Function(
    "state",
    "isTabRunning",
    "getLoopMetaForTabSummary",
    `${functionSource}; return isLoopMainTabCloseLocked;`,
  )(state, isTabRunning, getLoopMetaForTabSummary) as (tab: TabSummary | null) => boolean;
}

function buildIsConversationTabRunning(
  runningTabIds: readonly string[],
): (tab: TabSummary | null) => boolean {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isConversationTabRunning");
  const running = new Set(runningTabIds);
  const isTabRunning = (tabId: string | undefined): boolean => Boolean(tabId && running.has(tabId));
  const isLoopMainTab = (tab: TabSummary | null): boolean => tab?.loopTaskRole === "main";

  return new Function(
    "isTabRunning",
    "isLoopMainTab",
    `${functionSource}; return isConversationTabRunning;`,
  )(isTabRunning, isLoopMainTab) as (tab: TabSummary | null) => boolean;
}

function buildSyncRunningStateForActiveTab(tab: TabSummary | null): {
  isRunning: boolean;
  startedAt: number;
} {
  const source = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING,
    "syncRunningStateForActiveTab",
  );
  const updates: Array<{ isRunning: boolean; startedAt: number }> = [];
  const activeTabId = tab?.id ?? null;
  const runtime = new Function(
    "getActiveConversationTabId",
    "getConversationTabSummary",
    "isConversationTabRunning",
    "isTabRunning",
    "getTabRunStartedAt",
    "updateRunningState",
    "syncConversationControlsForActiveTab",
    source + "; return syncRunningStateForActiveTab;",
  )(
    () => activeTabId,
    () => tab,
    (candidate: TabSummary | null) => Boolean(
      candidate
      && candidate.loopTaskRole === "main"
      && (candidate.loopTaskRunning === true || candidate.loopTaskStatus === "running"),
    ),
    () => false,
    () => 0,
    (isRunning: boolean, options: { startedAt?: number }) => {
      updates.push({ isRunning, startedAt: options.startedAt ?? 0 });
    },
    () => undefined,
  ) as () => void;
  runtime();
  return updates[0] ?? { isRunning: false, startedAt: 0 };
}

function buildFormatConversationTabLabel(): (tab: TabSummary | null, baseLabel: string) => string {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "formatConversationTabLabel");
  const getLoopMetaForTabSummary = (
    tab: TabSummary | null,
  ): { taskRole: string; loopTaskId: string } | null => {
    if (!tab || !tab.loopTaskRole || !tab.loopTaskId) {
      return null;
    }
    return {
      taskRole: tab.loopTaskRole,
      loopTaskId: tab.loopTaskId,
    };
  };

  return new Function(
    "getLoopMetaForTabSummary",
    `${functionSource}; return formatConversationTabLabel;`,
  )(getLoopMetaForTabSummary) as (tab: TabSummary | null, baseLabel: string) => string;
}

function buildWebviewAutoInteractiveModeResolver(): (tab: TabSummary | null) => string {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "resolveAutoInteractiveModeForTab");
  const getLoopMetaForTabSummary = (
    tab: TabSummary | null,
  ): { taskRole: string; loopTaskId: string } | null => {
    if (!tab || !tab.loopTaskRole || !tab.loopTaskId) {
      return null;
    }
    return {
      taskRole: tab.loopTaskRole,
      loopTaskId: tab.loopTaskId,
    };
  };

  return new Function(
    "getLoopMetaForTabSummary",
    `${functionSource}; return resolveAutoInteractiveModeForTab;`,
  )(getLoopMetaForTabSummary) as (tab: TabSummary | null) => string;
}

function buildResetConversationTabSessionRequest(
  resetLocked: boolean,
  sentMessages: Record<string, unknown>[],
  onPromptContextArmed: () => void,
): () => void {
  const functionSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_EVENT_BINDINGS,
    "requestResetConversationTabSession",
  );
  return new Function(
    "isActiveConversationTabResetLocked",
    "armPromptContextForConversationStart",
    "vscode",
    `${functionSource}; return requestResetConversationTabSession;`,
  )(
    () => resetLocked,
    onPromptContextArmed,
    { postMessage: (message: Record<string, unknown>) => sentMessages.push(message) },
  ) as () => void;
}

test("uses sun and moon icons to identify Loop task tabs", () => {
  const formatLabel = buildFormatConversationTabLabel();

  assert.equal(
    formatLabel({ id: "main-tab", loopTaskRole: "main", loopTaskId: "task-1" }, "codex"),
    "☀️ codex",
  );
  assert.equal(
    formatLabel({ id: "main-tab-2", loopTaskRole: "main", loopTaskId: "task-2" }, "codex2"),
    "☀️ codex2",
  );
  assert.equal(
    formatLabel({ id: "subtask-tab", loopTaskRole: "subtask", loopTaskId: "task-1" }, "codex2"),
    "🌛 codex2",
  );
  assert.equal(formatLabel({ id: "ordinary-tab" }, "claude"), "claude");
});

test("automatically selects Loop mode only for a Loop main task tab", () => {
  const resolveWebviewMode = buildWebviewAutoInteractiveModeResolver();
  const mainTab = { id: "main-tab", loopTaskRole: "main", loopTaskId: "task-1" };
  const subtaskTab = { id: "subtask-tab", loopTaskRole: "subtask", loopTaskId: "task-1" };
  const incompleteMainTab = { id: "incomplete-main-tab", loopTaskRole: "main" };
  const ordinaryTab = { id: "ordinary-tab" };

  assert.equal(resolveWebviewMode(mainTab), "loop");
  assert.equal(resolveAutoInteractiveModeForLoopTask("main", "task-1"), "loop");
  assert.equal(resolveWebviewMode(subtaskTab), "coding");
  assert.equal(resolveAutoInteractiveModeForLoopTask("subtask", "task-1"), "coding");
  assert.equal(resolveWebviewMode(incompleteMainTab), "coding");
  assert.equal(resolveAutoInteractiveModeForLoopTask("main", null), "coding");
  assert.equal(resolveWebviewMode(ordinaryTab), "coding");
  assert.equal(resolveAutoInteractiveModeForLoopTask(undefined, undefined), "coding");
});

test("finds the same Loop main tab after that tab switches to a new CLI group", () => {
  const tab = {
    id: "main-tab",
    cli: "opencode" as const,
    sessionId: "opencode-session",
    sessionIdByCli: {
      codex: "codex-loop-session",
      opencode: "opencode-session",
    },
    createdAt: 1,
  };
  const resolved = findConversationTabForLoopResume(
    [tab],
    { id: "loop-task-1", cli: "codex", sessionId: "codex-loop-session" },
    (_candidate, cli) => cli === "codex"
      ? { taskRole: "main", loopTaskId: "loop-task-1" }
      : {},
  );

  assert.equal(resolved, tab);
  assert.equal(resolved?.cli, "opencode");
  assert.equal(resolved?.sessionId, "opencode-session");
});

test("rebuilds a Loop tab after its running status has been reconciled", () => {
  let currentCli: CliName = "codex";
  let taskStatus: "running" | "stopped" = "running";
  const state: ConversationTabsState = {
    activeTabId: "main-tab",
    tabs: [{
      id: "main-tab",
      cli: "codex",
      sessionId: "session-1",
      sessionIdByCli: { codex: "session-1" },
      createdAt: 1,
    }],
  };
  const controller = createSessionTabsController({
    state,
    pendingDrafts: {},
    conversationTabPrefix: "tab_",
    getCurrentCli: () => currentCli,
    setCurrentCli: (cli) => { currentCli = cli; },
    getDefaultCli: () => "codex",
    isCliName: (value): value is CliName => value === "codex" || value === "claude" || value === "opencode",
    getLatestSessionId: () => null,
    getSessionStore: () => undefined,
    getWorkspaceSettings: () => ({}),
    saveWorkspaceSettings: () => undefined,
    setCurrentSession: () => undefined,
    setWorkspaceInteractiveModeForCli: () => false,
    resolveAutoInteractiveModeForConversationTab: () => "coding",
    collectRunningLoopTaskIds: () => new Set(),
    isLoopTaskRunning: () => {
      taskStatus = "stopped";
      return false;
    },
    getLoopTaskStatus: () => taskStatus,
    resolveConversationTabLoopContext: () => ({ taskRole: "main", loopTaskId: "task-1" }),
    buildSessionLabelFromPrompt: () => null,
  });

  const [tab] = controller.buildConversationTabsState().tabs;

  assert.equal(tab?.loopTaskRunning, false);
  assert.equal(tab?.loopTaskStatus, "stopped");
  assert.equal(tab?.loopMainTabCloseLocked, false);
});

test("waits for extension reset success before clearing the current Tab view", () => {
  const sentMessages: Record<string, unknown>[] = [];
  let promptContextArmCount = 0;
  buildResetConversationTabSessionRequest(false, sentMessages, () => { promptContextArmCount += 1; })();
  assert.deepEqual(sentMessages, [{ type: "resetConversationTabSession" }]);
  assert.equal(promptContextArmCount, 1);

  buildResetConversationTabSessionRequest(true, sentMessages, () => { promptContextArmCount += 1; })();
  assert.deepEqual(sentMessages, [{ type: "resetConversationTabSession" }]);
  assert.equal(promptContextArmCount, 1);
});

test("does not keep completed Loop main tab locked from stale backend state", () => {
  const mainTab = {
    id: "main-tab",
    loopTaskRole: "main",
    loopTaskId: "task-1",
    loopMainTabCloseLocked: true,
  };
  const isLocked = buildIsLoopMainTabCloseLocked([mainTab], []);

  assert.equal(isLocked(mainTab), false);
});

test("keeps Loop main tab locked while it or a same-task child tab is running", () => {
  const mainTab = {
    id: "main-tab",
    loopTaskRole: "main",
    loopTaskId: "task-1",
    loopMainTabCloseLocked: false,
  };
  const subtaskTab = {
    id: "subtask-tab",
    loopTaskRole: "subtask",
    loopTaskId: "task-1",
  };

  assert.equal(buildIsLoopMainTabCloseLocked([mainTab], ["main-tab"])(mainTab), true);
  assert.equal(buildIsLoopMainTabCloseLocked([mainTab, subtaskTab], ["subtask-tab"])(mainTab), true);
});

test("keeps Loop main tab locked while the persisted task is still running", () => {
  const mainTab = {
    id: "main-tab",
    loopTaskRole: "main",
    loopTaskId: "task-1",
    loopTaskRunning: true,
  };

  assert.equal(buildIsLoopMainTabCloseLocked([mainTab], [])(mainTab), true);
});

test("keeps only the Loop main tab visually running from persisted task state", () => {
  const isRunning = buildIsConversationTabRunning([]);

  assert.equal(isRunning({
    id: "main-tab",
    loopTaskRole: "main",
    loopTaskId: "task-1",
    loopTaskRunning: true,
  }), true);
  assert.equal(isRunning({
    id: "subtask-tab",
    loopTaskRole: "subtask",
    loopTaskId: "task-1",
    loopTaskRunning: true,
  }), false);
  assert.equal(isRunning({ id: "ordinary-running-tab" }), false);
  assert.equal(buildIsConversationTabRunning(["ordinary-running-tab"])({ id: "ordinary-running-tab" }), true);
});

test("treats explicit Loop task running status as a visual running fallback", () => {
  const isRunning = buildIsConversationTabRunning([]);

  assert.equal(isRunning({
    id: "main-tab",
    loopTaskRole: "main",
    loopTaskId: "task-1",
    loopTaskStatus: "running",
  }), true);
  assert.equal(isRunning({
    id: "main-tab",
    loopTaskRole: "main",
    loopTaskId: "task-1",
    loopTaskStatus: "completed",
  }), false);
});

test("drives the main tab stop control from persisted Loop running status", () => {
  assert.deepEqual(
    buildSyncRunningStateForActiveTab({
      id: "main-tab",
      loopTaskRole: "main",
      loopTaskId: "task-1",
      loopTaskStatus: "running",
    }),
    { isRunning: true, startedAt: 0 },
  );
  assert.deepEqual(
    buildSyncRunningStateForActiveTab({
      id: "main-tab",
      loopTaskRole: "main",
      loopTaskId: "task-1",
      loopTaskStatus: "stopped",
    }),
    { isRunning: false, startedAt: 0 },
  );
});

test("does not lock Loop main tab for unrelated running tasks", () => {
  const mainTab = {
    id: "main-tab",
    loopTaskRole: "main",
    loopTaskId: "task-1",
    loopMainTabCloseLocked: false,
  };
  const unrelatedTab = {
    id: "other-tab",
    loopTaskRole: "subtask",
    loopTaskId: "task-2",
  };
  const isLocked = buildIsLoopMainTabCloseLocked([mainTab, unrelatedTab], ["other-tab"]);

  assert.equal(isLocked(mainTab), false);
});
