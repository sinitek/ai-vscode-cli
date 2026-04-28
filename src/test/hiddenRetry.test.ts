import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildHiddenRetryFailureMessage,
  buildHiddenRetryProgressInfo,
  resetHiddenRetryCountOnRecoveredReply,
} from "../hiddenRetry";

test("returns the latest real error directly before hidden retries reach the limit", () => {
  const result = buildHiddenRetryFailureMessage({
    hiddenRetryCount: 2,
    maxRetries: 5,
    retryLimitMessage: "retried too many times",
    fallbackMessage: "fallback error",
    lastFailureMessage: "socket hang up",
    lastFailurePrefix: "Last error: ",
  });

  assert.equal(result, "socket hang up");
});

test("keeps the retry-limit context and appends the latest real error after retries are exhausted", () => {
  const result = buildHiddenRetryFailureMessage({
    hiddenRetryCount: 5,
    maxRetries: 5,
    retryLimitMessage: "retried too many times",
    fallbackMessage: "fallback error",
    lastFailureMessage: "socket hang up",
    lastFailurePrefix: "Last error: ",
  });

  assert.equal(result, "retried too many times\nLast error: socket hang up");
});

test("falls back to the retry-limit message when no concrete final error is available", () => {
  const result = buildHiddenRetryFailureMessage({
    hiddenRetryCount: 5,
    maxRetries: 5,
    retryLimitMessage: "retried too many times",
    fallbackMessage: "fallback error",
    lastFailureMessage: "   ",
    lastFailurePrefix: "Last error: ",
  });

  assert.equal(result, "retried too many times");
});

test("builds hidden retry progress info for the next queued retry", () => {
  const result = buildHiddenRetryProgressInfo(0, 5, 30000);

  assert.deepEqual(result, {
    retryNumber: 1,
    maxRetries: 5,
    retryDelaySeconds: 30,
  });
});

test("resets hidden retry count after a recovered normal reply", () => {
  assert.equal(resetHiddenRetryCountOnRecoveredReply(4, true), 0);
});

test("keeps hidden retry count when no recovered reply was observed", () => {
  assert.equal(resetHiddenRetryCountOnRecoveredReply(4, false), 4);
});
