import test = require("node:test");
import assert = require("node:assert/strict");

import { detectCodexRateLimitErrorMessage } from "../interactive/codexErrorClassifier";

test("detects upstream rate_limit_error payloads wrapped in event error objects", () => {
  const payload = {
    error: {
      type: "rate_limit_error",
      message: "Concurrency limit exceeded for user, please retry later",
    },
  };

  assert.equal(
    detectCodexRateLimitErrorMessage(payload),
    "Concurrency limit exceeded for user, please retry later"
  );
});

test("detects rate limits from stringified JSON error messages", () => {
  const payload = {
    message: "{\"error\":{\"message\":\"all 10 attempts failed: HTTP 429: {\\\"error\\\":{\\\"message\\\":\\\"Too many pending requests, please retry later\\\",\\\"type\\\":\\\"rate_limit_error\\\"}}\",\"type\":\"request_error\"}}",
  };

  assert.equal(
    detectCodexRateLimitErrorMessage(payload),
    "all 10 attempts failed: HTTP 429: {\"error\":{\"message\":\"Too many pending requests, please retry later\",\"type\":\"rate_limit_error\"}}"
  );
});

test("does not classify reconnecting warnings as rate-limit failures", () => {
  assert.equal(
    detectCodexRateLimitErrorMessage({ message: "Reconnecting to Codex app-server..." }),
    null
  );
});

test("does not classify generic runtime errors as rate-limit failures", () => {
  assert.equal(
    detectCodexRateLimitErrorMessage({ message: "network socket disconnected" }),
    null
  );
});
