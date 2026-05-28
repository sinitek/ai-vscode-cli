import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildHiddenRetryErrorTraceContent,
  buildHiddenRetryFailureMessage,
  buildHiddenRetryProgressInfo,
  getHiddenRetryDelayMs,
  HIDDEN_RETRY_DELAY_SEQUENCE_MS,
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

test("builds error trace content for a hidden retry failure", () => {
  const result = buildHiddenRetryErrorTraceContent("socket hang up");

  assert.equal(result, "error\nsocket hang up");
});

test("builds error trace content with fallback when the failure message is blank", () => {
  const result = buildHiddenRetryErrorTraceContent("   ", "fallback error");

  assert.equal(result, "error\nfallback error");
});

test("builds hidden retry progress info for the next queued retry", () => {
  const result = buildHiddenRetryProgressInfo(0, 5, getHiddenRetryDelayMs(1));

  assert.deepEqual(result, {
    retryNumber: 1,
    maxRetries: 5,
    retryDelaySeconds: 5,
  });
});

test("uses the configured hidden retry delay sequence", () => {
  assert.deepEqual(
    HIDDEN_RETRY_DELAY_SEQUENCE_MS.map((delay) => delay / 1000),
    [5, 15, 30, 120, 300],
  );
  assert.equal(getHiddenRetryDelayMs(1), 5 * 1000);
  assert.equal(getHiddenRetryDelayMs(4), 2 * 60 * 1000);
  assert.equal(getHiddenRetryDelayMs(5), 5 * 60 * 1000);
});

test("resets hidden retry count after a recovered normal reply", () => {
  assert.equal(resetHiddenRetryCountOnRecoveredReply(4, true), 0);
});

test("keeps hidden retry count when no recovered reply was observed", () => {
  assert.equal(resetHiddenRetryCountOnRecoveredReply(4, false), 4);
});
