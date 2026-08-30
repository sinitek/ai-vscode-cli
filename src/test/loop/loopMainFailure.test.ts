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
  for (const value of [undefined, null, "3", true, {}, Number.NaN, Infinity, -Infinity]) {
    assert.equal(normalizeLoopMainAiFailureCount(value), 0);
  }
});

test("clamps negative counts and floors finite fractional failure counts", () => {
  const cases: Array<[unknown, number]> = [
    [-12, 0],
    [-0.5, 0],
    [0, 0],
    [2.99, 2],
    [LOOP_MAIN_AI_FAILURE_LIMIT, LOOP_MAIN_AI_FAILURE_LIMIT],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeLoopMainAiFailureCount(input), expected);
  }
});

test("detects failure limit from the persisted flag and normalized threshold count", () => {
  assert.equal(isLoopMainAiFailureLimitReached({}), false);
  assert.equal(isLoopMainAiFailureLimitReached({ mainAiFailureCount: LOOP_MAIN_AI_FAILURE_LIMIT - 0.01 }), false);
  assert.equal(isLoopMainAiFailureLimitReached({ mainAiFailureCount: Number.POSITIVE_INFINITY }), false);
  assert.equal(isLoopMainAiFailureLimitReached({
    mainAiFailureCount: LOOP_MAIN_AI_FAILURE_LIMIT,
    mainAiFailureLimitReached: false,
  }), true);
  assert.equal(isLoopMainAiFailureLimitReached({
    mainAiFailureCount: LOOP_MAIN_AI_FAILURE_LIMIT + 0.8,
    mainAiFailureLimitReached: false,
  }), true);
  assert.equal(isLoopMainAiFailureLimitReached({ mainAiFailureCount: 0, mainAiFailureLimitReached: true }), true);
});

test("records a normalized failure transition with observable timestamp and message", () => {
  const next = buildNextLoopMainAiFailureState({ mainAiFailureCount: 0 }, {
    failureMessage: "  provider connection failed  ",
    now: 0,
  });

  assert.deepEqual(next, {
    mainAiFailureCount: 1,
    mainAiFailureLimitReached: false,
    mainAiLastFailureAt: 0,
    mainAiLastFailureMessage: "provider connection failed",
  });
});

test("normalizes malformed prior counts and advances through and beyond the failure limit", () => {
  const cases: Array<[number, number, boolean]> = [
    [Number.NaN, 1, false],
    [Number.NEGATIVE_INFINITY, 1, false],
    [-2, 1, false],
    [2.8, 3, false],
    [LOOP_MAIN_AI_FAILURE_LIMIT - 1, LOOP_MAIN_AI_FAILURE_LIMIT, true],
    [LOOP_MAIN_AI_FAILURE_LIMIT, LOOP_MAIN_AI_FAILURE_LIMIT + 1, true],
  ];

  for (const [mainAiFailureCount, expectedCount, expectedLimitReached] of cases) {
    const next = buildNextLoopMainAiFailureState({ mainAiFailureCount }, {
      failureMessage: null,
      now: 123,
    });

    assert.equal(next.mainAiFailureCount, expectedCount);
    assert.equal(next.mainAiFailureLimitReached, expectedLimitReached);
    assert.equal(next.mainAiLastFailureAt, 123);
    assert.equal(next.mainAiLastFailureMessage, "");
  }
});

test("retains per-failure state information across consecutive failures", () => {
  let mainAiFailureCount = 0;

  for (let attempt = 1; attempt <= LOOP_MAIN_AI_FAILURE_LIMIT; attempt += 1) {
    const next = buildNextLoopMainAiFailureState({ mainAiFailureCount }, {
      failureMessage: `failure-${attempt}`,
      now: attempt * 10,
    });

    assert.equal(next.mainAiFailureCount, attempt);
    assert.equal(next.mainAiFailureLimitReached, attempt === LOOP_MAIN_AI_FAILURE_LIMIT);
    assert.equal(next.mainAiLastFailureAt, attempt * 10);
    assert.equal(next.mainAiLastFailureMessage, `failure-${attempt}`);
    mainAiFailureCount = next.mainAiFailureCount;
  }
});

test("uses the current time and clears non-string failure messages", () => {
  const before = Date.now();
  const next = buildNextLoopMainAiFailureState({}, {
    failureMessage: 42 as unknown as string,
  });
  const after = Date.now();

  assert.ok(next.mainAiLastFailureAt >= before);
  assert.ok(next.mainAiLastFailureAt <= after);
  assert.equal(next.mainAiLastFailureMessage, "");
  assert.equal(next.mainAiFailureCount, 1);
  assert.equal(next.mainAiFailureLimitReached, false);
});

test("resets loop main AI failure state after a successful main decision", () => {
  assert.deepEqual(buildResetLoopMainAiFailureState(), {
    mainAiFailureCount: 0,
    mainAiFailureLimitReached: false,
    mainAiLastFailureAt: undefined,
    mainAiLastFailureMessage: undefined,
  });
});
