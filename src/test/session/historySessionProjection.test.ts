import * as assert from "node:assert/strict";
import { test } from "node:test";

import { createCliRecord } from "../../cli/types";
import { createExtensionSessionTabsHost } from "../../extensionHost/sessionTabs";
import type { SessionStore } from "../../sessionStore";
import type { ChatMessage } from "../../webview/types";

function projectSession(options: { sessionId: string; loopTasks?: unknown[]; messages?: ChatMessage[] }) {
  const store = createCliRecord(() => ({ currentId: null, sessions: [] })) as SessionStore;
  store.codex.sessions.push({
    id: options.sessionId,
    label: "Codex · 2026-11-13 · You are the Loop+ main reviewer.",
    createdAt: 1,
    lastUsedAt: 2,
    firstPrompt: "You are the Loop+ main reviewer. Review the task.",
  });
  const host = createExtensionSessionTabsHost({
    getSessionTabsController: () => ({ buildOpenConversationTabSessionMap: () => new Map() }),
    getSessionLifecycleController: () => ({}),
    getSessionStore: () => store,
    getCurrentCli: () => "codex",
    getActiveWorkspaceKey: () => "workspace",
    getWorkspaceSettings: () => ({}),
    getActiveTaskRun: () => null,
    getLoopGroupChatTasks: () => options.loopTasks ?? [],
    loadSessionMessages: () => options.messages ?? [],
    buildSessionLabelFromPrompt: (prompt: string | null | undefined) => prompt?.slice(0, 30) ?? null,
    shouldUseFallbackSessionLabel: () => false,
    setSessionStore: () => undefined,
    setCurrentCli: () => undefined,
    activeData: {},
  } as any);
  return host.buildSessionState("codex").sessions[0];
}

test("projects old Loop+ protocol history using the bound user's root prompt", () => {
  const session = projectSession({
    sessionId: "main-session",
    loopTasks: [{
      id: "loop-1", cli: "codex", sessionId: "main-session", rootPrompt: "用户原始需求：完成发布准备",
      subTasks: [], updatedAt: 1,
    }],
    messages: [{
      id: "protocol", role: "user", content: "You are the Loop+ main reviewer.",
      taskRole: "main", loopTaskId: "loop-1",
    }],
  });
  assert.equal(session.firstPrompt, "用户原始需求：完成发布准备");
  assert.equal(session.taskRole, "main");
});

test("projects a main-model child execution as a subtask with the dispatched prompt", () => {
  const session = projectSession({
    sessionId: "child-session",
    loopTasks: [{
      id: "loop-1", cli: "codex", sessionId: "main-session", rootPrompt: "父任务",
      subTasks: [{
        id: "child-1", title: "整理验收", prompt: "整理验收证据并更新报告",
        executionSession: { cli: "codex", sessionId: "child-session", configId: null },
      }], updatedAt: 1,
    }],
    messages: [{
      id: "protocol", role: "user", content: "You are the Loop+ main reviewer.",
      taskRole: "main", loopTaskId: "loop-1",
    }],
  });
  assert.equal(session.firstPrompt, "整理验收证据并更新报告");
  assert.equal(session.taskRole, "subtask");
});

test("does not expose an orphaned internal reviewer prompt", () => {
  const session = projectSession({ sessionId: "orphan" });
  assert.equal(session.firstPrompt, undefined);
  assert.equal(session.label, "未命名会话");
  assert.equal(session.taskRole, null);
});
