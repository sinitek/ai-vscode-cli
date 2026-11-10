import test = require("node:test");
import assert = require("node:assert/strict");
import { ClaudeContextUsageTracker } from "../../interactive/claudeContextUsage";

const SESSION = "main-session";
const MODEL = "actual-response-model";

function stream(event: unknown, extra: Record<string, unknown> = {}) {
  return { type: "stream_event", session_id: SESSION, parent_tool_use_id: null, event, ...extra };
}

function start(model: unknown = MODEL, usage: unknown = {
  input_tokens: 11, cache_read_input_tokens: 37, cache_creation_input_tokens: 23, output_tokens: 1,
}, id = "request-1") {
  return stream({ type: "message_start", message: { id, model, usage } });
}

function delta(usage: unknown = { output_tokens: 19 }, extra: Record<string, unknown> = {}) {
  return stream({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage }, extra);
}

function result(modelUsage: unknown = { [MODEL]: { contextWindow: 123456, inputTokens: 999999, outputTokens: 888888 } }) {
  return { type: "result", session_id: SESSION, subtype: "success", modelUsage };
}

test("uses the real SDK/CLI block-before-usage sequence, not placeholder or cumulative consumption", () => {
  const tracker = new ClaudeContextUsageTracker(null);
  assert.equal(tracker.handle({ type: "system", subtype: "init", session_id: SESSION, model: "configured-alias" }), null);
  assert.equal(tracker.handle(start()), null);
  for (const type of ["thinking", "text"]) {
    assert.equal(tracker.handle({
      type: "assistant", session_id: SESSION, parent_tool_use_id: null,
      message: {
        id: "request-1", model: MODEL, stop_reason: null, content: [{ type }],
        usage: { input_tokens: 11, cache_read_input_tokens: 37, cache_creation_input_tokens: 23, output_tokens: 1 },
      },
    }), null);
  }
  assert.equal(tracker.handle({ type: "system", subtype: "thinking_tokens", session_id: SESSION, estimated_tokens: 900 }), null);
  assert.deepEqual(tracker.handle(delta({
    output_tokens: 19, output_tokens_details: { thinking_tokens: 7 }, reasoning_tokens: 7,
    cache_creation: { ephemeral_1h_input_tokens: 23 },
  })), { sessionId: SESSION, tokensInContextWindow: 90, modelContextWindow: null });
  assert.equal(tracker.handle(delta()), null);
  assert.deepEqual(tracker.handle(result()), {
    sessionId: SESSION, tokensInContextWindow: 90, modelContextWindow: 123456, contextWindowSource: "claude-model-window",
  });
  assert.equal(tracker.handle(delta({ output_tokens: 999 })), null);
  assert.equal(tracker.handle(result()), null);
});

test("replaces usage across tool requests and matches only the latest response model", () => {
  const tracker = new ClaudeContextUsageTracker(SESSION);
  tracker.handle(start());
  tracker.handle(delta());
  tracker.handle(start("second-model", { input_tokens: 100, output_tokens: 1 }, "request-2"));
  assert.deepEqual(tracker.handle(delta({ output_tokens: 20 })), {
    sessionId: SESSION, tokensInContextWindow: 120, modelContextWindow: null,
  });
  assert.deepEqual(tracker.handle(result({
    [MODEL]: { contextWindow: 123456 },
    "second-model": { contextWindow: 654321 },
    "subagent-model": { contextWindow: 9999999 },
  })), { sessionId: SESSION, tokensInContextWindow: 120, modelContextWindow: 654321, contextWindowSource: "claude-model-window" });
});

test("matches native usage merging: zero input deltas preserve proven counts, positive updates replace them", () => {
  const tracker = new ClaudeContextUsageTracker(SESSION);
  tracker.handle(start());
  assert.equal(tracker.handle(delta({
    input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 19,
  }))?.tokensInContextWindow, 90);
  assert.equal(tracker.handle(delta({
    input_tokens: 12, cache_read_input_tokens: 40, cache_creation_input_tokens: 24, output_tokens: 19,
  }))?.tokensInContextWindow, 95);
  assert.equal(tracker.handle(delta({ output_tokens: 0 }))?.tokensInContextWindow, 76);
});

test("a newer incomplete or synthetic assistant cannot reuse previous request metadata", () => {
  for (const assistant of [
    { message: { id: "request-new", model: null, stop_reason: null } },
    { error: "server_error", message: { id: "synthetic", model: "<synthetic>" } },
    { message: {} },
  ]) {
    const tracker = new ClaudeContextUsageTracker(SESSION);
    tracker.handle(start());
    tracker.handle(delta());
    assert.equal(tracker.handle({ type: "assistant", session_id: SESSION, parent_tool_use_id: null, ...assistant }), null);
    assert.equal(tracker.handle(result()), null);
  }
});

test("does not guess windows from aliases, init, previous models or missing response model", () => {
  for (const model of [MODEL, undefined, null, "", "new-model"]) {
    const tracker = new ClaudeContextUsageTracker(SESSION);
    tracker.handle({ type: "system", subtype: "init", session_id: SESSION, model: "old-model", contextWindow: 999 });
    tracker.handle(start(model === undefined ? null : model));
    assert.equal(tracker.handle(delta())?.modelContextWindow, null);
    assert.equal(tracker.handle(result({ "old-model": { contextWindow: 123456 } })), null);
  }
});

test("requires real finalized usage, but supports non-streamed finalized assistant messages", () => {
  const tracker = new ClaudeContextUsageTracker(SESSION);
  const assistant = {
    type: "assistant", session_id: SESSION, parent_tool_use_id: null,
    message: { id: "complete", model: MODEL, stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 0 } },
  };
  assert.deepEqual(tracker.handle(assistant), { sessionId: SESSION, tokensInContextWindow: 10, modelContextWindow: null });
  assert.equal(tracker.handle(assistant), null);
  assert.equal(tracker.handle(result({})), null);
  assert.equal(new ClaudeContextUsageTracker(SESSION).handle(result()), null);
  assert.equal(new ClaudeContextUsageTracker(SESSION).handle(delta()), null);
});

test("rejects illegal counters, zero placeholders and unsafe sums", () => {
  for (const field of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) {
    for (const invalid of [-1, 1.5, NaN, Infinity, "19", null, true, Number.MAX_SAFE_INTEGER + 1]) {
      const tracker = new ClaudeContextUsageTracker(SESSION);
      tracker.handle(start(MODEL, { input_tokens: 11, output_tokens: 1, [field]: invalid }));
      const usage = field === "output_tokens" ? { output_tokens: invalid } : { output_tokens: 19 };
      assert.equal(tracker.handle(delta(usage)), null, `${field}=${String(invalid)}`);
      assert.equal(tracker.handle(result()), null);
    }
  }
  for (const usage of [{ input_tokens: 0, output_tokens: 0 }, { input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1, output_tokens: 1 }, {}, null]) {
    const tracker = new ClaudeContextUsageTracker(SESSION);
    tracker.handle(start(MODEL, usage));
    assert.equal(tracker.handle(delta({ output_tokens: 0 })), null);
  }
});

test("rejects unknown or illegal window metadata without discarding real occupancy", () => {
  for (const invalid of [undefined, null, 0, -1, 1.5, NaN, Infinity, "200000", Number.MAX_SAFE_INTEGER + 1]) {
    const tracker = new ClaudeContextUsageTracker(SESSION);
    tracker.handle(start());
    assert.equal(tracker.handle(delta())?.tokensInContextWindow, 90);
    assert.equal(tracker.handle(result({ [MODEL]: { contextWindow: invalid } })), null);
  }
});

test("filters child agents, foreign sessions and stale message IDs before touching main request state", () => {
  const tracker = new ClaudeContextUsageTracker(SESSION);
  tracker.handle(start());
  assert.equal(tracker.handle({ ...start("child", {}, "child-request"), parent_tool_use_id: "tool-agent" }), null);
  assert.equal(tracker.handle({ ...start("foreign"), session_id: "other-session" }), null);
  assert.equal(tracker.handle(delta({ output_tokens: 999 }, { api_message_id: "old-request" })), null);
  assert.equal(tracker.handle({ ...result(), parent_tool_use_id: "tool-agent" }), null);
  assert.equal(tracker.handle({ ...result(), session_id: "other-session" }), null);
  assert.equal(tracker.handle(delta({ output_tokens: 19 }, { api_message_id: "request-1" }))?.tokensInContextWindow, 90);
  assert.equal(tracker.handle(result())?.modelContextWindow, 123456);
});

test("a missing/invalid latest request cannot reuse earlier occupancy or capacity", () => {
  for (const next of [start("new-model", null, "new-request"), stream({ type: "message_start", message: {} })]) {
    const tracker = new ClaudeContextUsageTracker(SESSION);
    tracker.handle(start());
    tracker.handle(delta());
    tracker.handle(next);
    assert.equal(tracker.handle(delta({ output_tokens: -1 })), null);
    assert.equal(tracker.handle(result()), null);
  }
  const nextTurn = new ClaudeContextUsageTracker(SESSION);
  assert.equal(nextTurn.handle(delta()), null);
  assert.equal(nextTurn.handle(result()), null);
});
