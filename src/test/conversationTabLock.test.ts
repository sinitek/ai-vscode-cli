import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../webview/viewContentScript/messageRendering";

type TabSummary = {
  id: string;
  lobsterTaskRole?: string;
  lobsterTaskId?: string;
  lobsterTaskRunning?: boolean;
  lobsterTaskStatus?: string;
  lobsterMainTabCloseLocked?: boolean;
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

function buildIsLobsterMainTabCloseLocked(
  tabs: TabSummary[],
  runningTabIds: readonly string[],
): (tab: TabSummary | null) => boolean {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isLobsterMainTabCloseLocked");
  const state = { conversationTabs: { tabs } };
  const running = new Set(runningTabIds);
  const isTabRunning = (tabId: string | undefined): boolean => Boolean(tabId && running.has(tabId));
  const getLobsterMetaForTabSummary = (tab: TabSummary | null): { taskRole: string; lobsterTaskId: string } | null => {
    if (!tab || !tab.lobsterTaskRole || !tab.lobsterTaskId) {
      return null;
    }
    return {
      taskRole: tab.lobsterTaskRole,
      lobsterTaskId: tab.lobsterTaskId,
    };
  };

  return new Function(
    "state",
    "isTabRunning",
    "getLobsterMetaForTabSummary",
    `${functionSource}; return isLobsterMainTabCloseLocked;`,
  )(state, isTabRunning, getLobsterMetaForTabSummary) as (tab: TabSummary | null) => boolean;
}

function buildIsConversationTabRunning(
  runningTabIds: readonly string[],
): (tab: TabSummary | null) => boolean {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "isConversationTabRunning");
  const running = new Set(runningTabIds);
  const isTabRunning = (tabId: string | undefined): boolean => Boolean(tabId && running.has(tabId));
  const isLobsterMainTab = (tab: TabSummary | null): boolean => tab?.lobsterTaskRole === "main";

  return new Function(
    "isTabRunning",
    "isLobsterMainTab",
    `${functionSource}; return isConversationTabRunning;`,
  )(isTabRunning, isLobsterMainTab) as (tab: TabSummary | null) => boolean;
}

test("does not keep completed Loop main tab locked from stale backend state", () => {
  const mainTab = {
    id: "main-tab",
    lobsterTaskRole: "main",
    lobsterTaskId: "task-1",
    lobsterMainTabCloseLocked: true,
  };
  const isLocked = buildIsLobsterMainTabCloseLocked([mainTab], []);

  assert.equal(isLocked(mainTab), false);
});

test("keeps Loop main tab locked while it or a same-task child tab is running", () => {
  const mainTab = {
    id: "main-tab",
    lobsterTaskRole: "main",
    lobsterTaskId: "task-1",
    lobsterMainTabCloseLocked: false,
  };
  const subtaskTab = {
    id: "subtask-tab",
    lobsterTaskRole: "subtask",
    lobsterTaskId: "task-1",
  };

  assert.equal(buildIsLobsterMainTabCloseLocked([mainTab], ["main-tab"])(mainTab), true);
  assert.equal(buildIsLobsterMainTabCloseLocked([mainTab, subtaskTab], ["subtask-tab"])(mainTab), true);
});

test("keeps Loop main tab locked while the persisted task is still running", () => {
  const mainTab = {
    id: "main-tab",
    lobsterTaskRole: "main",
    lobsterTaskId: "task-1",
    lobsterTaskRunning: true,
  };

  assert.equal(buildIsLobsterMainTabCloseLocked([mainTab], [])(mainTab), true);
});

test("keeps only the Loop main tab visually running from persisted task state", () => {
  const isRunning = buildIsConversationTabRunning([]);

  assert.equal(isRunning({
    id: "main-tab",
    lobsterTaskRole: "main",
    lobsterTaskId: "task-1",
    lobsterTaskRunning: true,
  }), true);
  assert.equal(isRunning({
    id: "subtask-tab",
    lobsterTaskRole: "subtask",
    lobsterTaskId: "task-1",
    lobsterTaskRunning: true,
  }), false);
  assert.equal(isRunning({ id: "ordinary-running-tab" }), false);
  assert.equal(buildIsConversationTabRunning(["ordinary-running-tab"])({ id: "ordinary-running-tab" }), true);
});

test("treats explicit Loop task running status as a visual running fallback", () => {
  const isRunning = buildIsConversationTabRunning([]);

  assert.equal(isRunning({
    id: "main-tab",
    lobsterTaskRole: "main",
    lobsterTaskId: "task-1",
    lobsterTaskStatus: "running",
  }), true);
  assert.equal(isRunning({
    id: "main-tab",
    lobsterTaskRole: "main",
    lobsterTaskId: "task-1",
    lobsterTaskStatus: "completed",
  }), false);
});

test("does not lock Loop main tab for unrelated running tasks", () => {
  const mainTab = {
    id: "main-tab",
    lobsterTaskRole: "main",
    lobsterTaskId: "task-1",
    lobsterMainTabCloseLocked: false,
  };
  const unrelatedTab = {
    id: "other-tab",
    lobsterTaskRole: "subtask",
    lobsterTaskId: "task-2",
  };
  const isLocked = buildIsLobsterMainTabCloseLocked([mainTab, unrelatedTab], ["other-tab"]);

  assert.equal(isLocked(mainTab), false);
});
