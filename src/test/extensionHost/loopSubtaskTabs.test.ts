import assert = require("node:assert/strict");
import test = require("node:test");
import { findRunningLoopSubtaskConversationTabId } from "../../extensionHost/loopSubtaskTabs";
import type { ConversationTabRecord } from "../../sessionTabs";

test("finds the newest active tab by parent and subtask identity across CLIs", () => {
  const tabs: ConversationTabRecord[] = [
    { id: "old", cli: "codex", sessionId: "old-session", sessionIdByCli: {}, createdAt: 1 },
    { id: "current", cli: "claude", sessionId: "current-session", sessionIdByCli: {}, createdAt: 2 },
    { id: "finished", cli: "codex", sessionId: "finished-session", sessionIdByCli: {}, createdAt: 3 },
    { id: "sibling", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 4 },
    { id: "other-parent", cli: "claude", sessionId: null, sessionIdByCli: {}, createdAt: 5 },
    { id: "ordinary", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 6 },
  ];
  const target = { taskId: "parent", subtaskId: "subtask" };
  const contexts = new Map([
    ["old", { ...target, attemptId: "first" }],
    ["current", { ...target, attemptId: "second" }],
    ["finished", { ...target, attemptId: "third" }],
    ["sibling", { ...target, subtaskId: "sibling" }],
    ["other-parent", { ...target, taskId: "other-parent" }],
  ]);
  const deps = {
    getTabs: () => tabs,
    resolveContext: (tab: ConversationTabRecord) => contexts.get(tab.id) ?? null,
    isTabRunActive: (id: string) => id !== "finished",
  };
  assert.equal(findRunningLoopSubtaskConversationTabId(target, deps), "current");
  assert.equal(findRunningLoopSubtaskConversationTabId({ ...target, attemptId: "first" }, deps), "old");
  assert.equal(findRunningLoopSubtaskConversationTabId({ ...target, attemptId: "missing" }, deps), null);
  assert.equal(findRunningLoopSubtaskConversationTabId({ ...target, taskId: "missing" }, deps), null);
  assert.equal(tabs[0].id, "old");
});

test("does not resolve a finished or missing subtask tab", () => {
  const context = { taskId: "parent", subtaskId: "subtask" };
  const tab: ConversationTabRecord = { id: "finished", cli: "codex", sessionId: null, sessionIdByCli: {}, createdAt: 1 };
  const deps = {
    getTabs: () => [tab], resolveContext: () => context, isTabRunActive: () => false,
  };
  assert.equal(findRunningLoopSubtaskConversationTabId(context, deps), null);
  assert.equal(findRunningLoopSubtaskConversationTabId(context, { ...deps, getTabs: () => [] }), null);
});
