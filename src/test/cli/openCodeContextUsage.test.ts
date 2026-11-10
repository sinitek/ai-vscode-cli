import test = require("node:test");
import assert = require("node:assert/strict");
import { createOpenCodeContextUsageTracker, parseOpenCodeContextUsage } from "../../cli/openCodeContextUsage";

function finish(sessionID = "ses_main", tokens: Record<string, unknown> = {}) {
  return {
    type: "step_finish", timestamp: 1794280000000, sessionID,
    part: {
      id: "prt_finish", sessionID, messageID: "msg_main", type: "step-finish", reason: "stop", cost: 0,
      tokens: { input: 60, output: 20, reasoning: 10, cache: { read: 40, write: 5 }, ...tokens },
    },
  };
}

function start(sessionID = "ses_main") {
  return { type: "step_start", sessionID, part: { type: "step-start", sessionID, messageID: "msg_main" } };
}

test("OpenCode normalized token categories include cached input and separate reasoning exactly once", () => {
  assert.deepEqual(parseOpenCodeContextUsage(finish()), { sessionId: "ses_main", tokensInContextWindow: 135 });
  assert.equal(parseOpenCodeContextUsage(finish("ses_main", { total: 999 }))?.tokensInContextWindow, 135);
  assert.equal(parseOpenCodeContextUsage(finish("ses_main", {
    input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 },
  }))?.tokensInContextWindow, 0);
});

test("OpenCode ignores unverified usage shapes, incomplete counts and illegal numeric values", () => {
  for (const invalid of [-1, Infinity, NaN, 0.5, "100", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ["input", "output", "reasoning"]) {
      assert.equal(parseOpenCodeContextUsage(finish("ses_main", { [field]: invalid })), null);
    }
    for (const field of ["read", "write"]) {
      assert.equal(parseOpenCodeContextUsage(finish("ses_main", { cache: { read: 1, write: 1, [field]: invalid } })), null);
    }
  }
  assert.equal(parseOpenCodeContextUsage(finish("ses_main", { input: Number.MAX_SAFE_INTEGER })), null);
  assert.equal(parseOpenCodeContextUsage(finish("ses_main", { cache: {} })), null);
  for (const record of [null, [], {}, { type: "usage", usage: { input_tokens: 100 } }, start()]) {
    assert.equal(parseOpenCodeContextUsage(record), null);
  }
});

test("OpenCode tracker replaces each main-session step rather than accumulating steps or child sessions", () => {
  const tracker = createOpenCodeContextUsageTracker({ sessionId: "ses_main", model: "probe/probe" });
  assert.equal(tracker.accept(finish())?.tokensInContextWindow, 135);
  assert.equal(tracker.accept(finish("ses_child")), null);
  const childPart = finish();
  childPart.part.sessionID = "ses_child";
  assert.equal(tracker.accept(childPart), null);
  assert.equal(tracker.accept({ ...finish(), providerID: "other", modelID: "probe" }), null);
  assert.equal(tracker.accept({ ...finish(), providerID: "probe", modelID: "other" }), null);
  assert.equal(tracker.accept(finish("ses_main", { input: 10 }))?.tokensInContextWindow, 85);
});

test("OpenCode fresh-session retries bind a new primary start and reject the retired session", () => {
  const tracker = createOpenCodeContextUsageTracker({ sessionId: null, previousSessionId: "ses_old", model: "probe/probe" });
  assert.equal(tracker.accept(finish("ses_child")), null);
  tracker.accept(start("ses_old"));
  assert.equal(tracker.accept(finish("ses_old")), null);
  tracker.accept(start("ses_new"));
  assert.equal(tracker.accept(finish("ses_new"))?.sessionId, "ses_new");
  tracker.accept(start("ses_child"));
  assert.equal(tracker.accept(finish("ses_child")), null);
  assert.equal(tracker.accept(finish("ses_old")), null);
});
