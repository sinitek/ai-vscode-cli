import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../webview/viewContentScript/messageRendering";

type TabSummary = {
  id: string;
  lobsterTaskRole?: string;
  lobsterTaskId?: string;
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
