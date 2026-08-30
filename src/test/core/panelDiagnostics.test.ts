import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  isHiddenRetryEligibleAttempt,
  isHiddenRetryEligibleErrorInfo,
  isLoopTaskResumable,
  isNonRetryableBillingErrorInfo,
} = require("../../panelDiagnostics") as typeof import("../../panelDiagnostics");

test("rejects HTTP 402 and exhausted billing errors from hidden retry", () => {
  const terminalErrors = [
    { message: "unexpected status 402 Payment Required" },
    { message: "llm proxy error: model pool requires 1 points, remaining 0" },
    { message: "insufficient credits for this request" },
    { message: "provider balance exhausted" },
    { code: "PAYMENT_REQUIRED", message: "provider rejected request" },
  ];

  for (const info of terminalErrors) {
    assert.equal(isNonRetryableBillingErrorInfo(info), true);
    assert.equal(isHiddenRetryEligibleErrorInfo(info), false);
  }
});

test("keeps temporary provider and network errors eligible for hidden retry", () => {
  const retryableErrors = [
    { message: "HTTP 429 Too Many Requests, retry later" },
    { code: "ECONNRESET", message: "socket hang up" },
    { message: "remaining 0 requests in the current concurrency slot" },
    { message: "model pool requires 1 points, remaining 0.5" },
  ];

  for (const info of retryableErrors) {
    assert.equal(isNonRetryableBillingErrorInfo(info), false);
    assert.equal(isHiddenRetryEligibleErrorInfo(info), true);
  }
});

test("preserves existing non-retryable abort and executable-not-found guards", () => {
  assert.equal(isHiddenRetryEligibleErrorInfo({ name: "AbortError", message: "aborted" }), false);
  assert.equal(isHiddenRetryEligibleErrorInfo({ code: "ENOENT", message: "spawn codex ENOENT" }), false);
});

test("rejects a billing failure reported through a nonzero CLI exit", () => {
  assert.equal(isHiddenRetryEligibleAttempt(
    { type: "exit", code: 1 },
    "unexpected status 402 Payment Required: requires 1 points, remaining 0",
  ), false);
  assert.equal(isHiddenRetryEligibleAttempt(
    { type: "exit", code: 1 },
    "temporary upstream disconnect",
  ), true);
});

test("keeps interrupted Loop task states resumable from the main tab", () => {
  const baseTask = { id: "task-1", mainAiFailureLimitReached: false } as Parameters<typeof isLoopTaskResumable>[0];

  assert.equal(isLoopTaskResumable({ ...baseTask, status: "needs-review" }), true);
  assert.equal(isLoopTaskResumable({ ...baseTask, status: "error" }), true);
  assert.equal(isLoopTaskResumable({ ...baseTask, status: "stopped" }), true);
  assert.equal(isLoopTaskResumable({ ...baseTask, status: "running" }), true);
  assert.equal(isLoopTaskResumable({ ...baseTask, status: "completed" }), false);
  assert.equal(isLoopTaskResumable({ ...baseTask, status: "error", mainAiFailureLimitReached: true }), false);
});
