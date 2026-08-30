import test = require("node:test");
import assert = require("node:assert/strict");

import {
  resolveOpenCodeSuccessfulExitOutcome,
  shouldRecoverOpenCodeLoopMainSessionInFreshSession,
} from "../../openCodeRunCompletion";

test("retries a Loop successful exit when only a historical conversation conclusion exists", () => {
  assert.equal(resolveOpenCodeSuccessfulExitOutcome({
    isLoopRun: true,
    currentAttemptHasAssistantAnswer: false,
    conversationHasFinalConclusion: true,
    hiddenRetryCount: 0,
    maxHiddenRetries: 5,
  }), "retry");
});

test("completes a Loop successful exit after the current attempt returns assistant text", () => {
  assert.equal(resolveOpenCodeSuccessfulExitOutcome({
    isLoopRun: true,
    currentAttemptHasAssistantAnswer: true,
    conversationHasFinalConclusion: false,
    hiddenRetryCount: 2,
    maxHiddenRetries: 5,
  }), "complete");
});

test("preserves conversation-anchored completion for ordinary OpenCode runs", () => {
  assert.equal(resolveOpenCodeSuccessfulExitOutcome({
    isLoopRun: false,
    currentAttemptHasAssistantAnswer: false,
    conversationHasFinalConclusion: true,
    hiddenRetryCount: 0,
    maxHiddenRetries: 5,
  }), "complete");
});

test("fails an empty successful exit after hidden retries are exhausted", () => {
  assert.equal(resolveOpenCodeSuccessfulExitOutcome({
    isLoopRun: true,
    currentAttemptHasAssistantAnswer: false,
    conversationHasFinalConclusion: true,
    hiddenRetryCount: 5,
    maxHiddenRetries: 5,
  }), "fail");
});

test("uses one fresh session recovery only for a provider-clean Loop main response", () => {
  assert.equal(shouldRecoverOpenCodeLoopMainSessionInFreshSession({
    isLoopMainRun: true,
    hasResumableSession: true,
    hasProviderError: false,
    freshSessionRecoveryAttempted: false,
  }), true);

  assert.equal(shouldRecoverOpenCodeLoopMainSessionInFreshSession({
    isLoopMainRun: false,
    hasResumableSession: true,
    hasProviderError: false,
    freshSessionRecoveryAttempted: false,
  }), false);
  assert.equal(shouldRecoverOpenCodeLoopMainSessionInFreshSession({
    isLoopMainRun: true,
    hasResumableSession: false,
    hasProviderError: false,
    freshSessionRecoveryAttempted: false,
  }), false);
  assert.equal(shouldRecoverOpenCodeLoopMainSessionInFreshSession({
    isLoopMainRun: true,
    hasResumableSession: true,
    hasProviderError: true,
    freshSessionRecoveryAttempted: false,
  }), false);
  assert.equal(shouldRecoverOpenCodeLoopMainSessionInFreshSession({
    isLoopMainRun: true,
    hasResumableSession: true,
    hasProviderError: false,
    freshSessionRecoveryAttempted: true,
  }), false);
});
