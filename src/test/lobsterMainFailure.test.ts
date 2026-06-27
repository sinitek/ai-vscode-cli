import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildNextLobsterMainAiFailureState,
  buildResetLobsterMainAiFailureState,
  isLobsterMainAiFailureLimitReached,
  LOBSTER_MAIN_AI_FAILURE_LIMIT,
  normalizeLobsterMainAiFailureCount,
} from "../lobsterMainFailure";

test("normalizes invalid lobster main AI failure counts to zero", () => {
  assert.equal(normalizeLobsterMainAiFailureCount(undefined), 0);
  assert.equal(normalizeLobsterMainAiFailureCount(null), 0);
  assert.equal(normalizeLobsterMainAiFailureCount("3"), 0);
  assert.equal(normalizeLobsterMainAiFailureCount(-2), 0);
  assert.equal(normalizeLobsterMainAiFailureCount(2.8), 2);
});

test("increments lobster main AI failure count and marks limit reached on the fifth failure", () => {
  let count = 0;
  for (let index = 1; index <= LOBSTER_MAIN_AI_FAILURE_LIMIT; index += 1) {
    const next = buildNextLobsterMainAiFailureState({ mainAiFailureCount: count }, {
      failureMessage: `failed-${index}`,
      now: index,
    });
    count = next.mainAiFailureCount;
    assert.equal(next.mainAiFailureCount, index);
    assert.equal(next.mainAiLastFailureAt, index);
    assert.equal(next.mainAiLastFailureMessage, `failed-${index}`);
    assert.equal(next.mainAiFailureLimitReached, index >= LOBSTER_MAIN_AI_FAILURE_LIMIT);
  }
});

test("detects lobster main AI failure limit from explicit flag or count", () => {
  assert.equal(isLobsterMainAiFailureLimitReached({ mainAiFailureCount: 4, mainAiFailureLimitReached: false }), false);
  assert.equal(isLobsterMainAiFailureLimitReached({ mainAiFailureCount: 5, mainAiFailureLimitReached: false }), true);
  assert.equal(isLobsterMainAiFailureLimitReached({ mainAiFailureCount: 0, mainAiFailureLimitReached: true }), true);
});

test("resets lobster main AI failure state after a successful main decision", () => {
  assert.deepEqual(buildResetLobsterMainAiFailureState(), {
    mainAiFailureCount: 0,
    mainAiFailureLimitReached: false,
    mainAiLastFailureAt: undefined,
    mainAiLastFailureMessage: undefined,
  });
});
