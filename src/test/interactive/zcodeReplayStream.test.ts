import assert = require("node:assert/strict");
import test = require("node:test");
import { readZcodeRecord, readZcodeSessionEvent, type ZcodeWireMessage } from "../../interactive/zcodeAppServerProtocol";
import { ZcodeReplayStream } from "../../interactive/zcodeReplayStream";

function sessionEvent(type: string, payload: Record<string, unknown>, metadata: Record<string, unknown> = {}): ZcodeWireMessage {
  return { method: "session/event", params: { sessionId: "sess_test", turnId: "turn_test", ...metadata, type, payload } };
}

function textEvent(delta: string, metadata: Record<string, unknown> = {}, payload: Record<string, unknown> = {}): ZcodeWireMessage {
  return sessionEvent("model.streaming", { kind: "text_delta", assistantMessageId: "message_test", delta, ...payload }, metadata);
}

function createReplay() {
  const events: ZcodeWireMessage[] = [];
  return { events, replay: new ZcodeReplayStream((message) => events.push(message)) };
}

function payloadOf(message: ZcodeWireMessage): Record<string, unknown> {
  return readZcodeSessionEvent(message)?.payload ?? {};
}

test("filters only known title and counter snapshots, removes input echo, and keeps diagnostics and unknown fields", () => {
  const { events, replay } = createReplay();
  replay.append(sessionEvent("session.titleUpdated", { title: "合成测试", source: "generated", previousTitle: "" }));
  replay.append(sessionEvent("session.updated", { messageCount: 2, providerId: "test", modelId: "test", toolCount: 1, iteration: 1 }));
  const retained = [
    sessionEvent("session.updated", { error: { message: "failed" } }),
    sessionEvent("session.updated", { messageCount: 2, futureField: { important: true } }),
    sessionEvent("model.request.finished", { status: "completed" }),
    sessionEvent("future.lifecycle", { state: "important" }),
  ];
  retained.forEach((event) => replay.append(event));
  replay.append(sessionEvent("turn.started", { input: "重复的提示词", turnNumber: 1 }));
  assert.deepEqual(events, [...retained, sessionEvent("turn.started", { turnNumber: 1 })]);
  replay.finish();
});

test("merges text across transport sequence metadata without mutating input or deleting whitespace and repeats", () => {
  const { events, replay } = createReplay();
  const first = textEvent("哈\n ", { seq: 1, eventId: "first", timestamp: "first" }, { done: false });
  const second = textEvent("哈哈", { seq: 2, eventId: "second", timestamp: "second" }, { done: false });
  const done = textEvent("", { seq: 3, eventId: "third", timestamp: "third" }, { done: true });
  const source = JSON.stringify([first, second, done]);
  [first, second, done].forEach((event) => replay.append(event));
  assert.deepEqual(events, [textEvent("哈\n 哈哈", { seq: 3, eventId: "third", timestamp: "third" }, { done: true })]);
  assert.equal(JSON.stringify([first, second, done]), source);
  replay.finish();
});

test("filters successful request telemetry and duplicate model summaries but preserves retries, stalls and unstreamed content", () => {
  const { events, replay } = createReplay();
  const request = { type: "model_request_started", attempt: 1, modelCall: { actorKind: "main" }, requestHeaders: { "user-agent": "synthetic" } };
  replay.append(sessionEvent("session.updated", request));
  replay.append(textEvent("answer", {}, { done: true }));
  replay.append(sessionEvent("session.updated", { ...request, type: "model_request_completed", finishReason: "stop", usage: { totalTokens: 10 } }));
  replay.append(sessionEvent("session.updated", { content: "answer", stopReason: "stop", usage: { totalTokens: 10 } }));
  replay.append(sessionEvent("session.updated", { content: "", stopReason: "tool-calls", toolCallCount: 1 }));
  const retained = [
    sessionEvent("session.updated", { ...request, attempt: 2 }),
    sessionEvent("session.updated", { ...request, error: "request failed" }),
    sessionEvent("session.updated", { ...request, modelCall: { actorKind: "subagent" } }),
    sessionEvent("session.updated", { ...request, type: "model_request_completed", finishReason: "stop", streamStallCount: 1 }),
    sessionEvent("session.updated", { ...request, type: "model_request_completed", finishReason: "length" }),
    sessionEvent("session.updated", { ...request, futureField: "important" }),
    sessionEvent("session.updated", { content: "not previously streamed", stopReason: "stop" }),
    sessionEvent("session.updated", { content: "", stopReason: "error" }),
  ];
  retained.forEach((event) => replay.append(event));
  replay.finish();
  assert.deepEqual(events, [textEvent("answer", {}, { done: true }), ...retained]);
});

test("does not drop model summaries from another session or turn or before corresponding text arrives", () => {
  const { events, replay } = createReplay();
  replay.append(textEvent("answer"));
  const retained = [
    sessionEvent("session.updated", { content: "answer", stopReason: "stop" }, { sessionId: "sess_other" }),
    sessionEvent("session.updated", { content: "answer", stopReason: "stop" }, { turnId: "turn_other" }),
    sessionEvent("session.updated", { content: "new answer", stopReason: "stop" }),
  ];
  retained.forEach((event) => replay.append(event));
  replay.finish();
  assert.deepEqual(events, [textEvent("answer"), ...retained]);
});

test("keeps sessions, turns, messages, reasoning and semantic annotations separate and ordered", () => {
  const { events, replay } = createReplay();
  const sources = [
    textEvent("first"),
    textEvent("other session", { sessionId: "sess_other" }),
    textEvent("other turn", { turnId: "turn_other" }),
    textEvent("other message", {}, { assistantMessageId: "message_other" }),
    textEvent("reasoning", {}, { kind: "reasoning_delta" }),
    textEvent("annotated", {}, { annotations: { priority: 1 } }),
    textEvent("different annotation", {}, { annotations: { priority: 2 } }),
  ];
  sources.forEach((event) => replay.append(event));
  const failure = sessionEvent("turn.failed", { error: { message: "failed" } });
  replay.append(failure);
  assert.deepEqual(events, [...sources, failure]);
  replay.finish();
});

test("uses a fixed one-second deadline rather than delaying indefinitely as fragments arrive", (context) => {
  Reflect.apply(context.mock.timers.enable, context.mock.timers, [{ apis: ["setTimeout"] }]);
  const { events, replay } = createReplay();
  replay.append(textEvent("one"));
  context.mock.timers.tick(600);
  replay.append(textEvent(" two"));
  context.mock.timers.tick(400);
  assert.deepEqual(events, [textEvent("one two")]);
  replay.append(textEvent("pending"));
  replay.finish();
  replay.finish();
  replay.append(textEvent("late"));
  context.mock.timers.tick(5000);
  assert.deepEqual(events, [textEvent("one two"), textEvent("pending")]);
});

test("bounds merged UTF-8 text and preserves empty annotated and malformed content", () => {
  const { events, replay } = createReplay();
  const fragment = "中".repeat(4000);
  for (let index = 0; index < 5; index += 1) replay.append(textEvent(fragment));
  replay.flush();
  assert.equal(events.length, 3);
  assert.equal(events.map((event) => payloadOf(event).delta).join(""), fragment.repeat(5));
  assert.equal(events.every((event) => Buffer.byteLength(String(payloadOf(event).delta)) <= 32 * 1024), true);
  const oversized = textEvent("😀".repeat(9000));
  replay.append(oversized);
  assert.deepEqual(events.at(-1), oversized);
  replay.append(textEvent(""));
  const retained = [textEvent("", {}, { annotations: { important: true } }), sessionEvent("model.streaming", { kind: "text_delta", delta: null })];
  retained.forEach((event) => replay.append(event));
  replay.finish();
  assert.deepEqual(events.slice(-2), retained);
});

test("aggregates streamed tool arguments and scheduler progress into one start and one complete result", () => {
  const { events, replay } = createReplay();
  const identity = { toolCallId: "call_test", toolName: "Shell", assistantMessageId: "message_test", done: true };
  replay.append(sessionEvent("model.streaming", { ...identity, kind: "tool_input_start", delta: "" }));
  replay.append(sessionEvent("model.streaming", { ...identity, kind: "tool_input_delta", delta: '{"command":' }));
  replay.append(sessionEvent("model.streaming", { ...identity, kind: "tool_input_delta", delta: '"printf test"}' }));
  replay.append(sessionEvent("model.streaming", { ...identity, kind: "tool_input_end", delta: "" }));
  replay.append(sessionEvent("model.streaming", { ...identity, kind: "tool_call", delta: "", input: { command: "printf test" } }));
  replay.append(sessionEvent("tool.updated", { kind: "scheduled", toolCallId: "call_test", toolName: "Shell", dependencies: [], inputRef: "artifact_test", inputOmitted: true, inputByteLength: 25 }));
  replay.append(sessionEvent("tool.updated", { kind: "started", toolCallId: "call_test", toolName: "Shell", startedAt: 123, readOnly: true, sideEffectScope: "none" }));
  const result = sessionEvent("tool.updated", { kind: "result", toolCallId: "call_test", result: { success: true, content: "test" }, duration: 10 }, { seq: 8 });
  replay.append(result);
  replay.append({ ...result, params: { ...readZcodeRecord(result.params), seq: 9, eventId: "duplicate" } });
  replay.append(sessionEvent("tool.updated", { kind: "batch", toolCallIds: ["call_test"], successCount: 1, errorCount: 0 }));
  replay.append(sessionEvent("streamRecovery.updated", { kind: "tool_result", toolCallId: "call_test", committedToolCallIds: ["call_test"], anchorId: "anchor_test" }));
  replay.finish();
  assert.equal(events.length, 2);
  assert.deepEqual(payloadOf(events[0]), { ...identity, kind: "tool_call", input: { command: "printf test" } });
  assert.deepEqual(events[1], result);
});

test("does not merge different tools, sessions or turns, or drop failures and unknown notification details", () => {
  const { events, replay } = createReplay();
  for (const metadata of [{}, { sessionId: "sess_other" }, { turnId: "turn_other" }]) {
    replay.append(sessionEvent("model.streaming", { kind: "tool_call", toolCallId: "call_test", input: { command: "same command" } }, metadata));
  }
  replay.append(sessionEvent("model.streaming", { kind: "tool_call", toolCallId: "call_other", input: { command: "same command" } }));
  const retained = [
    sessionEvent("tool.updated", { kind: "result", toolCallId: "call_test", result: { success: false, content: "error details" } }),
    sessionEvent("tool.updated", { kind: "batch", toolCallIds: ["call_test"], successCount: 0, errorCount: 1 }),
    sessionEvent("streamRecovery.updated", { kind: "tool_result", toolCallId: "call_test", committedToolCallIds: ["unknown"] }),
    sessionEvent("streamRecovery.updated", { kind: "tool_result", toolCallId: "call_test", committedToolCallIds: ["call_test"], error: "commit failed" }),
    sessionEvent("tool.updated", { kind: "future_kind", toolCallId: "call_test", data: "important" }),
    sessionEvent("tool.updated", { kind: "started", content: "missing call ID" }),
  ];
  retained.forEach((event) => replay.append(event));
  replay.finish();
  assert.equal(events.length, 4 + retained.length);
  assert.deepEqual(events.slice(-retained.length), retained);
});

test("retains unfinished tool input when interrupted and ignores subsequent callbacks", () => {
  const { events, replay } = createReplay();
  replay.append(sessionEvent("model.streaming", { kind: "tool_input_start", toolCallId: "call_test", toolName: "Shell" }));
  replay.append(sessionEvent("model.streaming", { kind: "tool_input_delta", toolCallId: "call_test", delta: '{"command":"incomplete' }));
  replay.finish();
  replay.append(sessionEvent("tool.updated", { kind: "result", toolCallId: "call_test", result: { success: true } }));
  assert.equal(events.length, 1);
  assert.deepEqual(payloadOf(events[0]), { kind: "tool_call", toolCallId: "call_test", toolName: "Shell", input: '{"command":"incomplete' });
});

test("flushes incomplete tool input before the terminal event", () => {
  for (const type of ["turn.completed", "turn.failed"]) {
    const { events, replay } = createReplay();
    replay.append(sessionEvent("model.streaming", { kind: "tool_input_start", toolCallId: "call_test", toolName: "Shell" }));
    replay.append(sessionEvent("model.streaming", { kind: "tool_input_delta", toolCallId: "call_test", delta: '{"command":"incomplete' }));
    const terminal = sessionEvent(type, type === "turn.failed" ? { error: "interrupted" } : { response: "finished" });
    replay.append(terminal);
    replay.finish();
    assert.equal(events.length, 2);
    assert.equal(payloadOf(events[0]).input, '{"command":"incomplete');
    assert.deepEqual(events[1], terminal);
  }
});

test("legacy part.delta text and reasoning retain their native envelope while merging", () => {
  const { events, replay } = createReplay();
  replay.append(sessionEvent("part.delta", { field: "reasoning", delta: "think" }, { seq: 1 }));
  replay.append(sessionEvent("part.delta", { field: "reasoning", delta: " more" }, { seq: 2 }));
  replay.append(sessionEvent("part.delta", { field: "text", delta: "answer" }, { seq: 3 }));
  replay.finish();
  assert.deepEqual(events, [
    sessionEvent("part.delta", { field: "reasoning", delta: "think more" }, { seq: 2 }),
    sessionEvent("part.delta", { field: "text", delta: "answer" }, { seq: 3 }),
  ]);
});

test("reduces an isolated synthetic 50-event weather-query trace to six meaningful records", () => {
  const { events, replay } = createReplay();
  const source: ZcodeWireMessage[] = [sessionEvent("turn.started", { input: "合成天气查询", turnNumber: 1 }), sessionEvent("session.titleUpdated", { title: "合成测试" })];
  for (let index = 0; index < 15; index += 1) source.push(sessionEvent("session.updated", { messageCount: index }));
  for (let index = 0; index < 10; index += 1) source.push(textEvent("思考", {}, { kind: "reasoning_delta" }));
  source.push(sessionEvent("model.streaming", { kind: "tool_input_start", toolCallId: "call_weather", toolName: "WebFetch" }));
  const input = '{"url":"https://example.invalid/forecast"}';
  for (let index = 0; index < 8; index += 1) source.push(sessionEvent("model.streaming", { kind: "tool_input_delta", toolCallId: "call_weather", delta: input.slice(index * 6, (index + 1) * 6) }));
  source.push(sessionEvent("model.streaming", { kind: "tool_input_end", toolCallId: "call_weather" }));
  source.push(sessionEvent("model.streaming", { kind: "tool_call", toolCallId: "call_weather", toolName: "WebFetch", input: JSON.parse(input) }));
  source.push(sessionEvent("tool.updated", { kind: "scheduled", toolCallId: "call_weather" }));
  source.push(sessionEvent("tool.updated", { kind: "started", toolCallId: "call_weather" }));
  source.push(sessionEvent("tool.updated", { kind: "result", toolCallId: "call_weather", result: { success: true, content: "明确标记的合成结果" } }));
  for (let index = 0; index < 8; index += 1) source.push(textEvent("合成答复"));
  source.push(sessionEvent("turn.completed", { response: "合成答复".repeat(8) }));
  assert.equal(source.length, 50);
  source.forEach((event, index) => replay.append({ ...event, params: { ...readZcodeRecord(event.params), seq: index + 1, eventId: `event_${index}`, timestamp: index } }));
  replay.finish();
  assert.equal(events.length, 6);
  assert.deepEqual(events.map((event) => readZcodeSessionEvent(event)?.type), ["turn.started", "model.streaming", "model.streaming", "tool.updated", "model.streaming", "turn.completed"]);
  assert.equal(payloadOf(events[1]).delta, "思考".repeat(10));
  assert.deepEqual(payloadOf(events[2]).input, JSON.parse(input));
  assert.equal(payloadOf(events[4]).delta, "合成答复".repeat(8));
});
