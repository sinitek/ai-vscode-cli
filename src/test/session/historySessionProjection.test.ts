import * as assert from "node:assert/strict";
import { test } from "node:test";

import { createCliRecord } from "../../cli/types";
import { createExtensionSessionTabsHost } from "../../extensionHost/sessionTabs";
import type { SessionStore } from "../../sessionStore";
import type { ChatMessage } from "../../webview/types";

function createHistoryProjection(options: { sessionId: string; loopTasks?: unknown[]; messages?: ChatMessage[]; missingFirstPrompt?: boolean; label?: string }) {
  const store = createCliRecord(() => ({ currentId: null, sessions: [] })) as SessionStore;
  const record = {
    id: options.sessionId,
    label: options.label ?? "未命名会话",
    createdAt: 1,
    lastUsedAt: 2,
    firstPrompt: options.missingFirstPrompt ? undefined : "You are the Loop+ main reviewer. Review the task.",
  };
  store.codex.sessions.push(record);
  let persistCount = 0;
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
    shouldUseFallbackSessionLabel: (label: string | undefined) => (
      !label?.trim()
      || label.trim() === "未命名会话"
      || label.trim().startsWith("You are the Loop+ main reviewer.")
      || label.trim().startsWith("You are one independent Loop+ execution attempt.")
    ),
    persistSessionStore: async () => { persistCount += 1; },
    setSessionStore: () => undefined,
    setCurrentCli: () => undefined,
    activeData: {},
  } as any);
  return {
    project: () => host.buildSessionState("codex").sessions[0],
    record,
    getPersistCount: () => persistCount,
  };
}

function projectSession(options: Parameters<typeof createHistoryProjection>[0]) {
  return createHistoryProjection(options).project();
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
    }, {
      id: "follow-up", role: "user", content: "继续收集验证证据",
      taskRole: "main", loopTaskId: "loop-1",
    }],
  });
  assert.equal(session.firstPrompt, "用户原始需求：完成发布准备");
  assert.equal(session.label, "用户原始需求：完成发布准备");
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
  assert.equal(session.label, "整理验收证据并更新报告");
  assert.equal(session.taskRole, "subtask");
});

for (const missingFirstPrompt of [false, true]) {
  test(`recovers the first visible user prompt after internal messages (missing cache: ${missingFirstPrompt})`, () => {
    const messages: ChatMessage[] = [
      { id: "reviewer", role: "user", content: "You are the Loop+ main reviewer." },
      { id: "assistant", role: "assistant", content: "准备验收" },
      { id: "worker", role: "user", content: "  You are one independent Loop+ execution attempt." },
      { id: "ask", role: "user", content: "请选择验收方案", loopAsk: true },
      { id: "blank", role: "user", content: " \n " },
      { id: "request", role: "user", content: "检查 macOS 构建结果" },
      { id: "follow-up", role: "user", content: "然后检查 Windows" },
    ];
    const originalMessages = structuredClone(messages);
    const projection = createHistoryProjection({
      sessionId: "reused-session", missingFirstPrompt, messages,
      label: "未命名会话",
    });

    for (const session of [projection.project(), projection.project()]) {
      assert.equal(session.firstPrompt, "检查 macOS 构建结果");
      assert.equal(session.label, "检查 macOS 构建结果");
      assert.equal(session.taskRole, null);
    }
    assert.equal(projection.record.firstPrompt, "检查 macOS 构建结果");
    assert.equal(projection.record.label, "检查 macOS 构建结果");
    assert.equal(projection.getPersistCount(), 1);
    assert.deepEqual(messages, originalMessages);
  });
}

test("finds a visible user prompt if the bound task prompt is blank or internal", () => {
  for (const rootPrompt of ["  ", "You are the Loop+ main reviewer."]) {
    const session = projectSession({
      sessionId: "main-session",
      loopTasks: [{ id: "loop-1", cli: "codex", sessionId: "main-session", rootPrompt, subTasks: [] }],
      messages: [{ id: "request", role: "user", content: "确认测试结果" }],
    });
    assert.equal(session.firstPrompt, "确认测试结果");
    assert.equal(session.label, "确认测试结果");
  }
});

test("treats a whitespace-only cached first prompt as missing", () => {
  const projection = createHistoryProjection({
    sessionId: "blank-cache", missingFirstPrompt: true,
    messages: [{ id: "request", role: "user", content: "从消息恢复标题" }],
  });
  projection.record.firstPrompt = "  \n ";
  const session = projection.project();
  assert.equal(session.firstPrompt, "从消息恢复标题");
  assert.equal(projection.record.firstPrompt, "从消息恢复标题");
});

test("keeps an existing ordinary label when backfilling the first user prompt", () => {
  const projection = createHistoryProjection({
    sessionId: "ordinary", label: "已有普通会话标题",
    messages: [
      { id: "protocol", role: "user", content: "You are the Loop+ main reviewer." },
      { id: "request", role: "user", content: "普通会话首条需求" },
    ],
  });
  const session = projection.project();
  assert.equal(session.firstPrompt, "普通会话首条需求");
  assert.equal(session.label, "已有普通会话标题");
  assert.equal(projection.getPersistCount(), 1);
});

test("replaces an exact cached internal protocol label without replacing custom labels", () => {
  const projection = createHistoryProjection({
    sessionId: "protocol-label", missingFirstPrompt: true,
    label: "You are one independent Loop+ execution attempt.",
    messages: [{ id: "request", role: "user", content: "确认回归测试" }],
  });
  assert.equal(projection.project().label, "确认回归测试");
});

test("does not expose an orphaned internal reviewer prompt", () => {
  const session = projectSession({ sessionId: "orphan" });
  assert.equal(session.firstPrompt, undefined);
  assert.equal(session.label, "未命名会话");
  assert.equal(session.taskRole, null);
});

test("filters a protocol prompt recovered from messages on the first projection", () => {
  for (const bound of [false, true]) {
    const projection = createHistoryProjection({
      sessionId: "child", missingFirstPrompt: true,
      loopTasks: bound ? [{ id: "parent", cli: "codex", sessionId: "main", rootPrompt: "parent request",
        subTasks: [{ id: "sub", prompt: "child request", executionSession: { cli: "codex", sessionId: "child" } }] }] : [],
      messages: [{ id: "protocol", role: "user", content: "You are the Loop+ main reviewer.", taskRole: "main", loopTaskId: "parent" }],
    });
    const session = projection.project();
    assert.equal(session.firstPrompt, bound ? "child request" : undefined);
    assert.equal(session.label, bound ? "child request" : "未命名会话");
    assert.equal(projection.record.firstPrompt, bound ? "child request" : undefined);
    assert.equal(session.taskRole, bound ? "subtask" : "main");
  }
});

test("history bindings with the same session ID in another CLI do not assign a child role or prompt", () => {
  const session = projectSession({ sessionId: "shared", loopTasks: [{
    id: "parent", cli: "claude", sessionId: "shared", rootPrompt: "other main",
    subTasks: [{ id: "sub", prompt: "other child", executionSession: { cli: "claude", sessionId: "shared" } }],
  }] });
  assert.equal(session.firstPrompt, undefined);
  assert.equal(session.taskRole, null);
  assert.equal(session.isLoopSession, false);
});
