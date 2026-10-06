import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("fs");
import path = require("path");

import {
  CONVERSATION_TAB_RUNNING_FLOW_CHECK_INTERVAL_MS,
  isLoopTaskFinishedForRunningFlow,
  readConversationTabRunningFlowLoopPlus,
  selectActiveConversationTabRunningFlowIds,
  selectStaleConversationTabRunningFlowIds,
  shouldStartConversationTabRunningFlow,
  shouldClearConversationTabRunningFlow,
  type ConversationTabRunningFlowTask,
} from "../../conversationTabRunningFlow";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";

const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
const diagnosticsHandlerSource = fs.readFileSync(
  path.join(process.cwd(), "src", "panelMessageHandlers", "diagnostics.ts"),
  "utf8",
);

function finishedLoopPlusTask(status = "completed"): ConversationTabRunningFlowTask {
  return {
    id: "loop-task",
    status,
    loopPlus: {
      completed: status === "completed",
      wakePending: false,
      currentReview: null,
      running: [],
      pending: [],
      reviewQueue: [],
      userMessageQueue: [],
    },
  };
}

test("clears a finished Loop+ tab flow when no newer unrelated run is active", () => {
  assert.equal(CONVERSATION_TAB_RUNNING_FLOW_CHECK_INTERVAL_MS, 60_000);
  assert.equal(isLoopTaskFinishedForRunningFlow(finishedLoopPlusTask()), true);
  assert.equal(shouldClearConversationTabRunningFlow({
    tabId: "main-tab",
    task: finishedLoopPlusTask(),
    activeRun: null,
  }), true);
  assert.equal(shouldClearConversationTabRunningFlow({
    tabId: "main-tab",
    task: finishedLoopPlusTask(),
    activeRun: { loopTaskId: "loop-task" },
  }), true);
  assert.equal(shouldClearConversationTabRunningFlow({
    tabId: "main-tab",
    task: finishedLoopPlusTask("needs-review"),
    activeRun: null,
  }), true);
});

test("keeps the tab flow while Loop+ work or a new run is still active", () => {
  const reviewing = finishedLoopPlusTask();
  reviewing.loopPlus = {
    ...reviewing.loopPlus,
    reviewQueue: [{ eventId: "review-1" }],
  };
  assert.equal(isLoopTaskFinishedForRunningFlow(reviewing), false);
  assert.equal(shouldClearConversationTabRunningFlow({
    tabId: "main-tab",
    task: { id: "loop-task", status: "running" },
    activeRun: null,
  }), false);
  assert.equal(shouldClearConversationTabRunningFlow({
    tabId: "main-tab",
    task: finishedLoopPlusTask(),
    activeRun: { loopTaskId: null },
  }), false);
  assert.equal(shouldClearConversationTabRunningFlow({
    tabId: "main-tab",
    task: finishedLoopPlusTask("stopped"),
    activeRun: { loopTaskId: "loop-task" },
  }), false);
  assert.equal(shouldClearConversationTabRunningFlow({
    tabId: " ",
    task: null,
    activeRun: null,
  }), false);
});

test("selects only active Loop runs for flow recovery", () => {
  const completed = finishedLoopPlusTask();
  assert.equal(shouldStartConversationTabRunningFlow({
    tabId: "missing-flow",
    task: { id: "loop-task", status: "running" },
    activeRun: { loopTaskId: "loop-task" },
  }), true);
  assert.equal(shouldStartConversationTabRunningFlow({
    tabId: "completed",
    task: completed,
    activeRun: { loopTaskId: "loop-task" },
  }), false);
  assert.equal(shouldStartConversationTabRunningFlow({
    tabId: "ordinary-run",
    task: null,
    activeRun: { loopTaskId: null },
  }), false);
  assert.deepEqual(selectActiveConversationTabRunningFlowIds([
    {
      tabId: "missing-flow",
      task: { id: "loop-task", status: "running" },
      activeRun: { loopTaskId: "loop-task" },
    },
    {
      tabId: "completed",
      task: completed,
      activeRun: { loopTaskId: "loop-task" },
    },
    {
      tabId: "new-loop-run",
      task: completed,
      activeRun: { loopTaskId: "new-loop-task" },
    },
    {
      tabId: "ordinary-run",
      task: null,
      activeRun: { loopTaskId: null },
    },
  ]), ["missing-flow", "new-loop-run"]);
});

test("selects only stale tabs and ignores malformed Loop+ snapshots", () => {
  assert.deepEqual(readConversationTabRunningFlowLoopPlus(null), null);
  assert.deepEqual(readConversationTabRunningFlowLoopPlus({
    completed: true,
    running: [{ subtaskId: "still-running" }],
    pending: "bad",
  }), {
    completed: true,
    wakePending: false,
    currentReview: null,
    running: [{ subtaskId: "still-running" }],
    pending: [],
    reviewQueue: [],
    userMessageQueue: [],
  });
  assert.deepEqual(selectStaleConversationTabRunningFlowIds([
    { tabId: "done", task: finishedLoopPlusTask(), activeRun: null },
    { tabId: "busy", task: { id: "busy-task", status: "running" }, activeRun: null },
    { tabId: "fresh-prompt", task: null, activeRun: { loopTaskId: null } },
    { tabId: "idle", task: null, activeRun: null },
  ]), ["done", "idle"]);
});

test("webview starts a one-minute flow check and stops it after the task is finished", () => {
  assert.match(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, /const CONVERSATION_TAB_RUNNING_FLOW_CHECK_MS = 60000;/);
  assert.match(
    VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING,
    /conversationTabRunningFlowTimer = setInterval\([\s\S]*type: "reconcileRunningConversationTabs"[\s\S]*CONVERSATION_TAB_RUNNING_FLOW_CHECK_MS/,
  );
  assert.match(
    VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING,
    /if \(conversationTabRunningFlowTimer\) \{\s*clearInterval\(conversationTabRunningFlowTimer\);\s*conversationTabRunningFlowTimer = null;/,
  );
  assert.match(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, /function hasConversationTabRunningFlowWatchTarget\(\)/);
  assert.match(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, /function startConversationTabRunningFlow\(tabIds\)/);
  assert.match(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, /function renderConversationTabs\(\) \{\s*syncConversationTabRunningFlowWatch\(\);/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, /releaseRunningFlowStopForActiveTasks\(\)/);
  assert.match(VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH, /data\.type === "runningConversationTabsReconciled"/);
  assert.match(VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH, /startConversationTabRunningFlow\(data\.startTabIds\)/);
  assert.match(VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH, /runningFlowStoppedTabIds\.delete\(targetTabId\)/);
  assert.match(extensionSource, /reconcileRunningConversationTabs,/);
  assert.match(extensionSource, /type: "runningConversationTabsReconciled"/);
  assert.match(extensionSource, /startTabIds: selectActiveConversationTabRunningFlowIds\(checks\)/);
  assert.match(diagnosticsHandlerSource, /reconcileRunningConversationTabs/);
  assert.match(diagnosticsHandlerSource, /deps\.reconcileRunningConversationTabs\?\.\(\)/);
});
