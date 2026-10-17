import assert = require("node:assert/strict");
import test = require("node:test");
import type { GrokJsonRpcMessage } from "../../interactive/grokAppServerProtocol";
import { GrokReplayStream } from "../../interactive/grokReplayStream";

function sessionUpdate(update: Record<string, unknown>, sessionId = "session-1"): GrokJsonRpcMessage {
  return { jsonrpc: "2.0", method: "session/update", params: { sessionId, update } };
}

function textUpdate(text: string, sessionId = "session-1", type = "agent_message_chunk"): GrokJsonRpcMessage {
  return sessionUpdate({ sessionUpdate: type, content: { type: "text", text } }, sessionId);
}

function readText(message: GrokJsonRpcMessage): string {
  const params = message.params as { update?: { content: { text: string } }; content?: { text: string } };
  return (params.update?.content ?? params.content)?.text ?? "";
}

function createReplay() {
  const events: GrokJsonRpcMessage[] = [];
  const replay = new GrokReplayStream((message) => events.push(message));
  return { events, replay };
}

test("filters Grok command catalogs and title notifications but preserves unknown updates", () => {
  const { events, replay } = createReplay();
  replay.append(sessionUpdate({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "help" }] }));
  replay.append(sessionUpdate({ sessionUpdate: "session_info_update", title: "New title" }));
  const unknown = sessionUpdate({ sessionUpdate: "future_update", details: { important: true } });
  const usage = sessionUpdate({ sessionUpdate: "usage_update", used: 123 });
  replay.append(unknown);
  replay.append(usage);
  replay.flush();
  assert.deepEqual(events, [unknown, usage]);
});

test("coalesces thousands of text fragments without changing their content or source objects", () => {
  const { events, replay } = createReplay();
  const originals = Array.from({ length: 2000 }, () => textUpdate(" 字"));
  originals.forEach((message) => replay.append(message));
  assert.equal(events.length, 0);
  replay.flush();
  assert.equal(events.length, 1);
  assert.equal(readText(events[0]), " 字".repeat(2000));
  assert.equal(originals.every((message) => readText(message) === " 字"), true);
  const originalBytes = originals.reduce((total, message) => total + Buffer.byteLength(JSON.stringify(message)), 0);
  assert.ok(Buffer.byteLength(JSON.stringify(events)) < originalBytes / 10);
});

test("retains whitespace and repeated tokens while keeping thinking, tools and completion ordered", () => {
  const { events, replay } = createReplay();
  replay.append(textUpdate("think", "session-1", "agent_thought_chunk"));
  replay.append(textUpdate("\n\n ", "session-1", "agent_thought_chunk"));
  replay.append(textUpdate("ha"));
  replay.append(textUpdate("ha"));
  const tool = sessionUpdate({ sessionUpdate: "tool_call", toolCallId: "tool-1", rawInput: { command: "pwd" } });
  const result = { jsonrpc: "2.0" as const, id: 4, result: { stopReason: "end_turn" } };
  replay.append(tool);
  replay.append(result);
  assert.deepEqual(events, [textUpdate("think\n\n ", "session-1", "agent_thought_chunk"), textUpdate("haha"), tool, result]);
});

test("drops empty text but preserves malformed, annotated and multimodal content", () => {
  const { events, replay } = createReplay();
  replay.append(textUpdate(""));
  const updates = [
    sessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "image", data: "image-data" } }),
    sessionUpdate({ sessionUpdate: "agent_message_chunk", content: [{ type: "text", text: "array text" }] }),
    sessionUpdate({ sessionUpdate: "agent_thought_chunk", content: { text: "no content type" } }),
    sessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "", annotations: { audience: ["user"] } } }),
    { method: "session/update", params: { sessionId: "session-1", _meta: { futureField: "important" }, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } } } },
    { ...textUpdate(""), _meta: { futureField: "important" } },
    sessionUpdate({ sessionUpdate: "agent_message_chunk", content: null }),
    { method: "session/update", params: null },
  ];
  updates.forEach((message) => replay.append(message));
  replay.flush();
  assert.deepEqual(events, updates);
});

test("does not merge text across sessions or content metadata", () => {
  const { events, replay } = createReplay();
  const messages = [
    textUpdate("first"),
    textUpdate("second", "session-2"),
    sessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "third", annotations: { priority: 1 } } }, "session-2"),
    sessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fourth", annotations: { priority: 2 } } }, "session-2"),
    sessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fifth", annotations: { priority: 2 } }, _meta: { messageId: "new" } }, "session-2"),
  ];
  messages.forEach((message) => replay.append(message));
  replay.flush();
  assert.deepEqual(events, messages);
});

test("merges real Grok chunks with changing transport metadata and keeps the latest snapshot", () => {
  const { events, replay } = createReplay();
  const messages = ["1", " ", "2"].map((text, index) => {
    const message = textUpdate(text);
    const params = message.params as Record<string, unknown>;
    params._meta = {
      totalTokens: 100,
      requestTrimmedTokens: 0,
      eventId: `event-${index}`,
      agentTimestampMs: 1000 + index,
      promptId: "prompt-1",
      streamStartMs: 1000,
      turnStartMs: 900,
      updateType: "agent_output_text",
      chunkId: index,
    };
    return message;
  });
  messages.forEach((message) => replay.append(message));
  replay.flush();
  assert.equal(events.length, 1);
  assert.equal(readText(events[0]), "1 2");
  assert.deepEqual((events[0].params as Record<string, unknown>)._meta, (messages[2].params as Record<string, unknown>)._meta);
  assert.equal(readText(messages[0]), "1");
});

test("keeps prompt, stream, token usage and unknown metadata changes as merge boundaries", () => {
  for (const key of ["promptId", "streamStartMs", "turnStartMs", "totalTokens", "requestTrimmedTokens", "futureField"]) {
    const { events, replay } = createReplay();
    const messages = [1, 2].map((value) => {
      const message = textUpdate("text");
      (message.params as Record<string, unknown>)._meta = { [key]: value };
      return message;
    });
    messages.forEach((message) => replay.append(message));
    replay.flush();
    assert.deepEqual(events, messages);
  }
});

test("deduplicates identical identified tool snapshots despite changing transport metadata", () => {
  const { events, replay } = createReplay();
  const messages = [1, 2].map((chunkId) => {
    const message = sessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "in_progress" });
    (message.params as Record<string, unknown>)._meta = { eventId: `event-${chunkId}`, chunkId, agentTimestampMs: chunkId };
    return message;
  });
  messages.forEach((message) => replay.append(message));
  assert.deepEqual(events, [messages[0]]);
});

test("supports flattened session updates without changing their ACP shape", () => {
  const { events, replay } = createReplay();
  for (const text of ["one", " two"]) {
    replay.append({ method: "session/update", params: { sessionId: "session-1", sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
  }
  replay.flush();
  assert.deepEqual(events, [{ method: "session/update", params: { sessionId: "session-1", sessionUpdate: "agent_message_chunk", content: { type: "text", text: "one two" } } }]);
});

test("skips only consecutive identical tool or plan snapshots and retains status and output changes", () => {
  const { events, replay } = createReplay();
  const snapshots = [
    sessionUpdate({ sessionUpdate: "tool_call", toolCallId: "tool-1", status: "pending", rawInput: { command: "pwd" } }),
    sessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "in_progress" }),
    sessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "tool-2", status: "in_progress" }),
    sessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: "ok" }),
    sessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "failed", rawOutput: "error" }),
    sessionUpdate({ sessionUpdate: "plan", entries: [{ content: "Test", status: "pending" }] }),
    sessionUpdate({ sessionUpdate: "plan", entries: [{ content: "Test", status: "completed" }] }),
  ];
  snapshots.forEach((message) => {
    replay.append(message);
    replay.append(sessionUpdate({ sessionUpdate: "session_info_update", title: "Ignored" }));
    replay.append(message);
  });
  assert.deepEqual(events, snapshots);
});

test("does not deduplicate unknown events, results, or snapshots separated by text", () => {
  const { events, replay } = createReplay();
  const snapshot = sessionUpdate({ sessionUpdate: "plan", entries: [] });
  const unknown = sessionUpdate({ sessionUpdate: "future_update" });
  const result = { id: 4, result: { stopReason: "end_turn" } };
  const expected = [snapshot, textUpdate("body"), snapshot, unknown, unknown, result, result];
  expected.forEach((message) => replay.append(message));
  replay.flush();
  assert.deepEqual(events, expected);
});

test("keeps identical tool calls without a stable call id", () => {
  const { events, replay } = createReplay();
  const tool = sessionUpdate({ sessionUpdate: "tool_call", title: "bash", rawInput: { command: "pwd" } });
  const update = sessionUpdate({ sessionUpdate: "tool_call_update", status: "completed", rawOutput: "ok" });
  [tool, tool, update, update].forEach((message) => replay.append(message));
  assert.deepEqual(events, [tool, tool, update, update]);
});

test("flushes on a fixed deadline even while fragments keep arriving", (context) => {
  Reflect.apply(context.mock.timers.enable, context.mock.timers, [{ apis: ["setTimeout"] }]);
  const { events, replay } = createReplay();
  replay.append(textUpdate("one"));
  context.mock.timers.tick(600);
  replay.append(textUpdate(" two"));
  context.mock.timers.tick(400);
  assert.deepEqual(events, [textUpdate("one two")]);
  context.mock.timers.tick(5000);
  assert.equal(events.length, 1);
});

test("flush is idempotent and clears the pending deadline", (context) => {
  Reflect.apply(context.mock.timers.enable, context.mock.timers, [{ apis: ["setTimeout"] }]);
  const { events, replay } = createReplay();
  replay.append(textUpdate("one"));
  replay.flush();
  replay.flush();
  replay.append(textUpdate("two"));
  context.mock.timers.tick(1000);
  assert.deepEqual(events, [textUpdate("one"), textUpdate("two")]);
});

test("bounds merged text by UTF-8 bytes and preserves oversized source messages", () => {
  const { events, replay } = createReplay();
  const fragment = "中".repeat(4000);
  for (let index = 0; index < 5; index += 1) {
    replay.append(textUpdate(fragment));
  }
  replay.flush();
  assert.equal(events.length, 3);
  assert.equal(events.map(readText).join(""), fragment.repeat(5));
  assert.equal(events.every((message) => Buffer.byteLength(readText(message)) <= 32 * 1024), true);
  const oversized = textUpdate("😀".repeat(9000));
  replay.append(oversized);
  assert.deepEqual(events[3], oversized);
});

test("flushes buffered text before RPC errors and other notifications", () => {
  const { events, replay } = createReplay();
  const error = { id: 4, error: { code: -32603, message: "prompt failed", data: { retryable: true } } };
  const notification = { method: "future/notification", params: { value: 1 } };
  replay.append(textUpdate("partial"));
  replay.append(error);
  replay.append(notification);
  assert.deepEqual(events, [textUpdate("partial"), error, notification]);
});
