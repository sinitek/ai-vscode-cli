import test = require("node:test");
import assert = require("node:assert/strict");

import type { CliName } from "../../cli/types";
import {
  attachConversationTabLoopSchedulingMode,
  createSessionTabsController,
  resolveAutoInteractiveModeForLoopTask,
  resolveConversationTabAutoInteractiveMode,
  type ConversationTabsState,
} from "../../sessionTabs";
import type { ConversationTabSummary } from "../../webview/types";

test("keeps classic Loop as the default and maps only a saved event-driven main task to Loop+", () => {
  assert.equal(resolveAutoInteractiveModeForLoopTask("main", "task-1"), "loop");
  assert.equal(resolveAutoInteractiveModeForLoopTask("main", "task-1", "classic"), "loop");
  assert.equal(resolveAutoInteractiveModeForLoopTask("main", "task-1", "unknown"), "loop");
  assert.equal(resolveAutoInteractiveModeForLoopTask("main", "task-1", undefined), "loop");
  assert.equal(resolveAutoInteractiveModeForLoopTask("main", "task-1", "event_driven"), "loop_plus");
  assert.equal(resolveAutoInteractiveModeForLoopTask("subtask", "task-1", "event_driven"), "coding");
  assert.equal(resolveConversationTabAutoInteractiveMode({
    hasGraphRun: true,
    taskRole: "main",
    loopTaskId: "task-1",
    schedulingMode: "event_driven",
  }), "graph");
});

test("switches classic and Loop+ main tabs from each task record and restores without downgrade", () => {
  const persisted = {
    classic: "classic",
    plus: "event_driven",
    unknown: "not-a-mode",
  };
  const persistedCopy = { ...persisted };
  const pageMode = "loop";
  const modes: string[] = [];
  const state: ConversationTabsState = {
    activeTabId: "classic-tab",
    tabs: [
      { id: "classic-tab", cli: "codex", sessionId: "classic-session", sessionIdByCli: { codex: "classic-session" }, createdAt: 1 },
      { id: "plus-tab", cli: "codex", sessionId: "plus-session", sessionIdByCli: { codex: "plus-session" }, createdAt: 2 },
      { id: "sub-tab", cli: "codex", sessionId: "sub-session", sessionIdByCli: { codex: "sub-session" }, createdAt: 3 },
      { id: "graph-tab", cli: "codex", sessionId: "graph-session", sessionIdByCli: { codex: "graph-session" }, createdAt: 4 },
      { id: "unknown-tab", cli: "codex", sessionId: "unknown-session", sessionIdByCli: { codex: "unknown-session" }, createdAt: 5 },
    ],
  };
  const contextFor = (tabId: string): { taskRole?: "main" | "subtask"; loopTaskId?: string } => {
    if (tabId === "classic-tab") return { taskRole: "main", loopTaskId: "classic" };
    if (tabId === "plus-tab") return { taskRole: "main", loopTaskId: "plus" };
    if (tabId === "sub-tab") return { taskRole: "subtask", loopTaskId: "plus" };
    if (tabId === "graph-tab") return { taskRole: "main", loopTaskId: "plus" };
    if (tabId === "unknown-tab") return { taskRole: "main", loopTaskId: "unknown" };
    return {};
  };
  const controller = createSessionTabsController({
    state,
    pendingDrafts: {},
    conversationTabPrefix: "tab_",
    getCurrentCli: () => "codex",
    setCurrentCli: () => undefined,
    getDefaultCli: () => "codex",
    isCliName: (value): value is CliName => value === "codex" || value === "claude" || value === "opencode",
    getLatestSessionId: () => null,
    getSessionStore: () => undefined,
    getWorkspaceSettings: () => ({}),
    saveWorkspaceSettings: () => undefined,
    setCurrentSession: () => undefined,
    setWorkspaceInteractiveModeForCli: (_cli, mode) => {
      modes.push(mode);
      return true;
    },
    resolveAutoInteractiveModeForConversationTab: (tab) => {
      const context = tab ? contextFor(tab.id) : {};
      return resolveConversationTabAutoInteractiveMode({
        hasGraphRun: tab?.id === "graph-tab",
        taskRole: context.taskRole,
        loopTaskId: context.loopTaskId,
        schedulingMode: context.loopTaskId ? persisted[context.loopTaskId as keyof typeof persisted] : undefined,
      });
    },
    collectRunningLoopTaskIds: () => new Set<string>(),
    isLoopTaskRunning: () => false,
    getLoopTaskStatus: () => "running",
    getLoopTaskSchedulingMode: (taskId) => persisted[taskId as keyof typeof persisted],
    resolveConversationTabLoopContext: (tab) => contextFor(tab.id),
    buildSessionLabelFromPrompt: () => null,
  });

  assert.equal(pageMode, "loop");
  controller.setActiveConversationTab("classic-tab");
  controller.setActiveConversationTab("plus-tab");
  controller.setActiveConversationTab("classic-tab");
  controller.setActiveConversationTab("plus-tab");
  controller.setActiveConversationTab("sub-tab");
  controller.setActiveConversationTab("graph-tab");
  controller.setActiveConversationTab("unknown-tab");
  assert.deepEqual(modes, ["loop", "loop_plus", "loop", "loop_plus", "coding", "graph", "loop"]);
  assert.deepEqual(persisted, persistedCopy);

  const summaries = new Map(controller.buildConversationTabsState().tabs.map((tab) => [tab.id, tab]));
  assert.equal(summaries.get("classic-tab")?.loopSchedulingMode, "classic");
  assert.equal(summaries.get("plus-tab")?.loopSchedulingMode, "event_driven");
  assert.equal(summaries.get("sub-tab")?.loopSchedulingMode, "event_driven");
  assert.equal(summaries.get("unknown-tab")?.loopSchedulingMode, "classic");
  assert.deepEqual(persisted, persistedCopy);

  const restored = {
    id: "restored",
    cli: "codex" as const,
    sessionId: null,
    createdAt: 1,
    loopTaskId: "plus",
  };
  const typed: ConversationTabSummary = attachConversationTabLoopSchedulingMode(restored, "event_driven");
  assert.equal(typed.loopSchedulingMode, "event_driven");
  const plain = {
    id: "plain",
    cli: "codex" as const,
    sessionId: null,
    createdAt: 1,
  };
  assert.equal(attachConversationTabLoopSchedulingMode(plain, "event_driven").loopSchedulingMode, undefined);
});
