import * as assert from "node:assert/strict";
import test = require("node:test");

import type { KimiJsonRpcMessage } from "../../interactive/kimiAppServerProtocol";
import { KimiReplayStream } from "../../interactive/kimiReplayStream";

function update(sessionUpdate: string, fields: Record<string, unknown> = {}): KimiJsonRpcMessage {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "session-1", update: { sessionUpdate, ...fields } },
  };
}

function text(value: string, messageId = "message-1"): KimiJsonRpcMessage {
  return update("agent_message_chunk", { messageId, content: { type: "text", text: value } });
}

test("Kimi replay drops thought and usage streams and coalesces incremental assistant text", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  replay.append(update("agent_thought_chunk", { content: { type: "text", text: "private reasoning" } }));
  replay.append(update("usage_update", { used: 42, size: 1000 }));
  replay.append(text("chunk-one"));
  replay.append(text("chunk-two"));
  replay.append(update("tool_call", { toolCallId: "tool-1", status: "pending" }));
  replay.finish();

  assert.equal(events.length, 2);
  const params = events[0].params as { update: { content: { text: string } } };
  assert.equal(params.update.content.text, "chunk-onechunk-two");
  assert.equal(JSON.stringify(events).includes("private reasoning"), false);
  assert.equal(JSON.stringify(events).includes("usage_update"), false);
});

test("Kimi replay reduces 1000 assistant fragments to one JSON event", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  const fragments = Array.from({ length: 1000 }, (_, index) => text(` forecast-${String(index).padStart(4, "0")};`));
  fragments.forEach((fragment) => replay.append(fragment));
  replay.flush();

  assert.equal(events.length, 1);
  const content = (events[0].params as { update: { content: { text: string } } }).update.content.text;
  assert.equal(content, Array.from({ length: 1000 }, (_, index) => ` forecast-${String(index).padStart(4, "0")};`).join(""));
  const inputBytes = fragments.reduce((total, fragment) => total + Buffer.byteLength(JSON.stringify(fragment)), 0);
  assert.ok(Buffer.byteLength(JSON.stringify(events)) < inputBytes / 5);
});

test("Kimi replay accepts cumulative text and flushes completed tools without intermediate updates", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  replay.append(text("a"));
  replay.append(text("ab"));
  replay.append(text("abc"));
  replay.append(update("tool_call", { toolCallId: "tool-1", status: "pending", title: "FetchURL" }));
  replay.append(update("tool_call_update", { toolCallId: "tool-1", status: "in_progress" }));
  replay.append(update("tool_call_update", {
    toolCallId: "tool-1",
    status: "in_progress",
    content: [{ type: "content", content: { type: "text", text: "partial result" } }],
  }));
  const completed = update("tool_call_update", { toolCallId: "tool-1", status: "completed", content: [] });
  replay.append(completed);
  replay.append(completed);
  replay.finish();

  assert.deepEqual(events.map((event) => (event.params as { update: { sessionUpdate: string } }).update.sessionUpdate), [
    "agent_message_chunk",
    "tool_call",
    "tool_call_update",
    "tool_call_update",
  ]);
  const params = events[0].params as { update: { content: { text: string } } };
  assert.equal(params.update.content.text, "abc");
});

test("Kimi replay coalesces text when ACP metadata changes between chunks", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  const first = text("The forecast is ");
  const second = text("sunny.");
  for (const [event, frame] of [[first, 1], [second, 2]] as const) {
    const params = event.params as Record<string, unknown>;
    const update = params.update as Record<string, unknown>;
    const content = update.content as Record<string, unknown>;
    params._meta = {
      eventId: `event-${frame}`,
      chunkId: frame,
      agentTimestampMs: frame,
      messageId: "message-1",
    };
    update._meta = { eventId: `event-${frame}`, chunkId: frame, agentTimestampMs: frame };
    update.content = { ...content, _meta: { eventId: `event-${frame}` } };
  }

  replay.append(first);
  replay.append(second);
  replay.finish();

  assert.equal(events.length, 1);
  const params = events[0].params as {
    _meta: { eventId: string; chunkId: number; agentTimestampMs: number; messageId: string };
    update: { _meta: { eventId: string; chunkId: number; agentTimestampMs: number }; content: { text: string; _meta: { eventId: string } } };
  };
  assert.equal(params.update.content.text, "The forecast is sunny.");
  assert.deepEqual(params._meta, { eventId: "event-2", chunkId: 2, agentTimestampMs: 2, messageId: "message-1" });
  assert.deepEqual(params.update._meta, { eventId: "event-2", chunkId: 2, agentTimestampMs: 2 });
  assert.deepEqual(params.update.content._meta, { eventId: "event-2" });
});

test("Kimi replay keeps semantic metadata changes as merge boundaries", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  const first = text("same");
  const second = text("same");
  delete ((first.params as Record<string, unknown>).update as Record<string, unknown>).messageId;
  delete ((second.params as Record<string, unknown>).update as Record<string, unknown>).messageId;
  (first.params as Record<string, unknown>)._meta = { messageId: "message-1" };
  (second.params as Record<string, unknown>)._meta = { messageId: "message-2" };
  replay.append(first);
  replay.append(second);
  replay.finish();

  assert.deepEqual(events, [first, second]);
});

test("Kimi replay keeps meaningful tool changes and drops status-only duplicates", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  replay.append(update("tool_call", {
    toolCallId: "tool-1",
    status: "pending",
    title: "Fetch forecast",
    rawInput: { city: "Shenzhen" },
  }));
  replay.append(update("tool_call_update", { toolCallId: "tool-1", status: "in_progress", content: [] }));
  replay.append(update("tool_call_update", {
    toolCallId: "tool-1",
    status: "in_progress",
    title: "Fetch current forecast",
    rawInput: { city: "Shenzhen" },
  }));
  replay.append(update("tool_call_update", {
    toolCallId: "tool-1",
    status: "in_progress",
    rawInput: { city: "Shenzhen", units: "celsius" },
  }));
  const firstContent = update("tool_call_update", {
    toolCallId: "tool-1",
    status: "in_progress",
    content: [{ type: "content", content: { type: "text", text: "18 C" } }],
  });
  replay.append(firstContent);
  const changedContent = update("tool_call_update", {
    toolCallId: "tool-1",
    status: "in_progress",
    content: [{ type: "content", content: { type: "text", text: "23 C" } }],
  });
  replay.append(changedContent);
  replay.append(changedContent);
  replay.append(update("tool_call_update", {
    toolCallId: "tool-1",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "23 C" } }],
  }));
  replay.finish();

  assert.deepEqual(events.map((event) => (event.params as { update: { sessionUpdate: string } }).update.sessionUpdate), [
    "tool_call",
    "tool_call_update",
    "tool_call_update",
    "tool_call_update",
    "tool_call_update",
    "tool_call_update",
  ]);
  const updates = events.map((event) => (event.params as { update: Record<string, unknown> }).update);
  assert.equal(updates[1].title, "Fetch current forecast");
  assert.deepEqual(updates[2].rawInput, { city: "Shenzhen", units: "celsius" });
  assert.deepEqual((updates[4].content as Array<{ content: { text: string } }>)[0].content.text, "23 C");
  assert.equal(updates[5].status, "completed");
});

test("Kimi replay drops tool frames without an id", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  replay.append(update("tool_call", { status: "pending", title: "Fetch forecast" }));
  replay.append(update("tool_call_update", { status: "completed", content: ["result"] }));
  replay.finish();
  assert.deepEqual(events, []);
});

test("Kimi replay deduplicates identical plan snapshots but retains changed entries", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  const first = update("plan", { plan: { planId: "plan-1", entries: [{ content: "Check forecast", status: "pending" }] } });
  const duplicate = update("plan", { plan: { planId: "plan-1", entries: [{ content: "Check forecast", status: "pending" }], _meta: { eventId: "event-2" } } });
  const changed = update("plan", { plan: { planId: "plan-1", entries: [{ content: "Check forecast", status: "completed" }] } });
  replay.append(first);
  replay.append(duplicate);
  replay.append(changed);
  replay.finish();

  assert.deepEqual(events, [first, changed]);
});

test("Kimi replay flushes pending text on finish and ignores late events", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  replay.append(text("final answer"));
  replay.finish();
  replay.finish();
  replay.append(text("late"));
  assert.equal(events.length, 1);
  const params = events[0].params as { update: { content: { text: string } } };
  assert.equal(params.update.content.text, "final answer");
});

test("Kimi replay coalesces streamed tool argument snapshots until the call is complete", () => {
  const events: KimiJsonRpcMessage[] = [];
  const replay = new KimiReplayStream((event) => events.push(event));
  const id = "0:Bash_0_6a259d99";
  replay.append(update("tool_call", { toolCallId: id, title: "Bash", kind: "execute", status: "pending" }));
  for (const text of ['{"comm', '{"command":"curl', '{"command":"curl"}']) {
    replay.append(update("tool_call_update", {
      toolCallId: id,
      status: "in_progress",
      content: [{ type: "content", content: { type: "text", text } }],
    }));
  }
  replay.append(update("tool_call_update", {
    toolCallId: id,
    title: "Running: curl",
    kind: "execute",
    status: "in_progress",
    rawInput: { command: "curl" },
    content: [{ type: "content", content: { type: "text", text: '{"command":"curl"}' } }],
  }));
  replay.append(update("tool_call_update", { toolCallId: id, status: "completed", content: ["forecast"] }));
  replay.finish();

  assert.equal(events.length, 4);
  const updates = events.map((event) => (event.params as { update: Record<string, unknown> }).update);
  assert.equal(updates[1].sessionUpdate, "tool_call_update");
  assert.deepEqual(updates[1].content, [{ type: "content", content: { type: "text", text: '{"command":"curl"}' } }]);
  assert.equal(updates[2].title, "Running: curl");
  assert.equal(updates[3].status, "completed");
});
