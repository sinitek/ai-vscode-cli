import * as assert from "node:assert/strict";
import { test } from "node:test";

import { resolveHistorySessionTaskRole } from "../../historySessionTaskRole";
import type { ChatMessage } from "../../webview/types";

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return partial;
}

test("marks loop main and subtask sessions and leaves vibe sessions unmarked", () => {
  assert.equal(resolveHistorySessionTaskRole({
    messages: [message({ id: "user", role: "user", content: "fix the bug" })],
  }), null);
  assert.equal(resolveHistorySessionTaskRole({
    messages: [message({
      id: "main",
      role: "user",
      content: "plan the work",
      taskRole: "main",
      loopTaskId: "loop-1",
    })],
  }), "main");
  assert.equal(resolveHistorySessionTaskRole({
    messages: [message({
      id: "sub",
      role: "user",
      content: "implement the slice",
      taskRole: "subtask",
      loopTaskId: "loop-1",
      loopSubtaskId: "sub-1",
    })],
  }), "subtask");
});

test("keeps the main marker when a later message is only a loop ask", () => {
  assert.equal(resolveHistorySessionTaskRole({
    isLoopMainSession: true,
    messages: [
      message({
        id: "main",
        role: "user",
        content: "plan the work",
        taskRole: "main",
        loopTaskId: "loop-1",
      }),
      message({ id: "ask", role: "user", content: "这个方案为什么这样拆？", loopAsk: true }),
      message({ id: "answer", role: "assistant", content: "因为文件边界不同。", loopAsk: true }),
    ],
  }), "main");
});

test("drops the marker after a later plain vibe user message", () => {
  assert.equal(resolveHistorySessionTaskRole({
    isLoopMainSession: true,
    messages: [
      message({
        id: "main",
        role: "assistant",
        content: "loop result",
        taskRole: "main",
        loopTaskId: "loop-1",
      }),
      message({ id: "vibe", role: "user", content: "just chat" }),
    ],
  }), null);
});

test("marks graph orchestrator sessions as main and node sessions as subtask", () => {
  assert.equal(resolveHistorySessionTaskRole({
    messages: [message({
      id: "graph",
      role: "system",
      content: "Graph run created",
      actions: [{ type: "openGraphRun", graphRunId: "graph-1" }],
    })],
  }), "main");
  assert.equal(resolveHistorySessionTaskRole({
    messages: [message({
      id: "summary",
      role: "assistant",
      content: "done",
      taskRole: "main",
      graphRunId: "graph-1",
      graphFinalSummary: true,
    })],
  }), "main");
  assert.equal(resolveHistorySessionTaskRole({
    messages: [message({
      id: "node",
      role: "system",
      content: "node started",
      graphRunId: "graph-1",
      graphNodeId: "node-1",
    })],
  }), "subtask");
  assert.equal(resolveHistorySessionTaskRole({
    messages: [message({
      id: "node-user",
      role: "user",
      content: "run the node",
      taskRole: "subtask",
    })],
  }), "subtask");
});

test("keeps a bound main session marked when messages do not show a newer vibe prompt", () => {
  assert.equal(resolveHistorySessionTaskRole({
    isLoopMainSession: true,
    messages: [],
  }), "main");
  assert.equal(resolveHistorySessionTaskRole({
    isGraphMainSession: true,
    messages: [message({ id: "trace", role: "trace", content: "running" })],
  }), "main");
  assert.equal(resolveHistorySessionTaskRole({ messages: [] }), null);
});
