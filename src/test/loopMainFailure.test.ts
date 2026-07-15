import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildNextLoopMainAiFailureState,
  buildResetLoopMainAiFailureState,
  isLoopMainAiFailureLimitReached,
  LOOP_MAIN_AI_FAILURE_LIMIT,
  normalizeLoopMainAiFailureCount,
} from "../loopMainFailure";

test("normalizes invalid loop main AI failure counts to zero", () => {
  assert.equal(normalizeLoopMainAiFailureCount(undefined), 0);
  assert.equal(normalizeLoopMainAiFailureCount(null), 0);
  assert.equal(normalizeLoopMainAiFailureCount("3"), 0);
  assert.equal(normalizeLoopMainAiFailureCount(-2), 0);
  assert.equal(normalizeLoopMainAiFailureCount(2.8), 2);
});

test("increments loop main AI failure count and marks limit reached on the fifth failure", () => {
  let count = 0;
  for (let index = 1; index <= LOOP_MAIN_AI_FAILURE_LIMIT; index += 1) {
    const next = buildNextLoopMainAiFailureState({ mainAiFailureCount: count }, {
      failureMessage: `failed-${index}`,
      now: index,
    });
    count = next.mainAiFailureCount;
    assert.equal(next.mainAiFailureCount, index);
    assert.equal(next.mainAiLastFailureAt, index);
    assert.equal(next.mainAiLastFailureMessage, `failed-${index}`);
    assert.equal(next.mainAiFailureLimitReached, index >= LOOP_MAIN_AI_FAILURE_LIMIT);
  }
});

test("detects loop main AI failure limit from explicit flag or count", () => {
  assert.equal(isLoopMainAiFailureLimitReached({ mainAiFailureCount: 4, mainAiFailureLimitReached: false }), false);
  assert.equal(isLoopMainAiFailureLimitReached({ mainAiFailureCount: 5, mainAiFailureLimitReached: false }), true);
  assert.equal(isLoopMainAiFailureLimitReached({ mainAiFailureCount: 0, mainAiFailureLimitReached: true }), true);
});

test("resets loop main AI failure state after a successful main decision", () => {
  assert.deepEqual(buildResetLoopMainAiFailureState(), {
    mainAiFailureCount: 0,
    mainAiFailureLimitReached: false,
    mainAiLastFailureAt: undefined,
    mainAiLastFailureMessage: undefined,
  });
});
