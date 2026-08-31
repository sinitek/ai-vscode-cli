import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  appendOpenCodeFinalTextToTabStream,
  consumeOpenCodeTabStreamChunk,
  createOpenCodeTabStreamState,
  OPENCODE_TAB_STREAM_JSONL_BUFFER_MAX_BYTES,
} = require("../../openCodeTabStream") as typeof import("../../openCodeTabStream");

function createContext() {
  let nextId = 0;
  return {
    createMessageId: () => `message-${++nextId}`,
    now: () => 123,
    metadata: {
      taskRole: "subtask" as const,
      loopTaskId: "loop-1",
      loopRound: 2,
      loopSubtaskId: "subtask-1",
      graphRunId: "graph-1",
      graphNodeId: "node-1",
    },
  };
}

test("turns parallel OpenCode JSONL text into tab-scoped assistant bubble actions", () => {
  const context = createContext();
  const textEvent = JSON.stringify({
    type: "text",
    sessionID: "ses_parallel",
    part: { type: "text", text: "开始检查日志。" },
  });

  const first = consumeOpenCodeTabStreamChunk(
    createOpenCodeTabStreamState(),
    textEvent.slice(0, 24),
    false,
    context,
  );
  assert.deepEqual(first.actions, []);

  const second = consumeOpenCodeTabStreamChunk(
    first.state,
    `${textEvent.slice(24)}\n`,
    false,
    context,
  );
  assert.deepEqual(second.actions, [
    {
      type: "append-assistant-message",
      message: {
        id: "message-1",
        role: "assistant",
        content: "",
        createdAt: 123,
        taskRole: "subtask",
        loopTaskId: "loop-1",
        loopRound: 2,
        loopSubtaskId: "subtask-1",
        graphRunId: "graph-1",
        graphNodeId: "node-1",
      },
    },
    {
      type: "append-assistant-delta",
      id: "message-1",
      content: "开始检查日志。",
    },
  ]);
  assert.equal(second.state.displayedAssistantText, "开始检查日志。");
});

test("filters OpenCode step-start placeholders while preserving tool traces and task lists", () => {
  const context = createContext();
  const stdout = [
    JSON.stringify({
      type: "step_start",
      part: { type: "step-start" },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { content: "检查日志", status: "completed" },
              { content: "修复气泡", status: "in_progress" },
            ],
          },
        },
      },
    }),
    JSON.stringify({
      type: "text",
      part: { type: "text", text: "继续处理。" },
    }),
    "",
  ].join("\n");

  const result = consumeOpenCodeTabStreamChunk(
    createOpenCodeTabStreamState(),
    stdout,
    false,
    context,
  );

  assert.deepEqual(result.actions, [
    {
      type: "task-list-update",
      items: [
        { text: "检查日志", done: true },
        { text: "修复气泡", done: false },
      ],
    },
    {
      type: "append-trace",
      content: "tool todowrite\nstatus: completed",
      taskListItems: [
        { text: "检查日志", done: true },
        { text: "修复气泡", done: false },
      ],
    },
    {
      type: "append-assistant-message",
      message: {
        id: "message-1",
        role: "assistant",
        content: "",
        createdAt: 123,
        taskRole: "subtask",
        loopTaskId: "loop-1",
        loopRound: 2,
        loopSubtaskId: "subtask-1",
        graphRunId: "graph-1",
        graphNodeId: "node-1",
      },
    },
    {
      type: "append-assistant-delta",
      id: "message-1",
      content: "继续处理。",
    },
  ]);
});

test("deduplicates final OpenCode output after streamed assistant text", () => {
  const context = createContext();
  const streamed = consumeOpenCodeTabStreamChunk(
    createOpenCodeTabStreamState(),
    `${JSON.stringify({ type: "text", part: { type: "text", text: "完成检查。" } })}\n`,
    false,
    context,
  );

  const duplicateFinal = appendOpenCodeFinalTextToTabStream(
    streamed.state,
    "完成检查。",
    context,
  );
  assert.deepEqual(duplicateFinal.actions, []);

  const finalWithTail = appendOpenCodeFinalTextToTabStream(
    streamed.state,
    "完成检查。\n补充结论。",
    context,
  );
  assert.deepEqual(finalWithTail.actions, [
    {
      type: "append-assistant-delta",
      id: "message-1",
      content: "\n补充结论。\n",
    },
  ]);
  assert.equal(finalWithTail.state.displayedAssistantText, "完成检查。\n补充结论。");
});

test("flushes the last JSONL record without requiring a trailing newline", () => {
  const context = createContext();
  const event = JSON.stringify({
    type: "text",
    part: { type: "text", text: "最终片段" },
  });
  const buffered = consumeOpenCodeTabStreamChunk(
    createOpenCodeTabStreamState(),
    event,
    false,
    context,
  );
  assert.deepEqual(buffered.actions, []);

  const flushed = consumeOpenCodeTabStreamChunk(buffered.state, "", true, context);
  assert.equal(flushed.actions[0]?.type, "append-assistant-message");
  assert.deepEqual(flushed.actions[1], {
    type: "append-assistant-delta",
    id: "message-1",
    content: "最终片段",
  });
  assert.equal(flushed.state.jsonlBuffer, "");
});

test("bounds pending parallel OpenCode JSONL buffer", () => {
  const context = createContext();
  const result = consumeOpenCodeTabStreamChunk(
    createOpenCodeTabStreamState(),
    `{"type":"text","part":{"text":"${"x".repeat(OPENCODE_TAB_STREAM_JSONL_BUFFER_MAX_BYTES * 2)}`,
    false,
    context,
  );

  assert.equal(result.actions.length, 0);
  assert.ok(Buffer.byteLength(result.state.jsonlBuffer, "utf8") <= OPENCODE_TAB_STREAM_JSONL_BUFFER_MAX_BYTES);
});
