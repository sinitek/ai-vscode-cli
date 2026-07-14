export type OpenCodeSuccessfulExitOutcome = "complete" | "retry" | "fail";

export type OpenCodeLoopFreshSessionRecoveryContext = {
  isLoopMainRun: boolean;
  hasResumableSession: boolean;
  hasProviderError: boolean;
  freshSessionRecoveryAttempted: boolean;
};

export type OpenCodeSuccessfulExitContext = {
  isLoopRun: boolean;
  currentAttemptHasAssistantAnswer: boolean;
  conversationHasFinalConclusion: boolean;
  hiddenRetryCount: number;
  maxHiddenRetries: number;
};

/**
 * Loop rounds reuse the original user-message anchor, so historical assistant
 * replies cannot prove that the current OpenCode process produced an answer.
 */
export function resolveOpenCodeSuccessfulExitOutcome(
  context: OpenCodeSuccessfulExitContext,
): OpenCodeSuccessfulExitOutcome {
  const hasRequiredConclusion = context.isLoopRun
    ? context.currentAttemptHasAssistantAnswer
    : context.conversationHasFinalConclusion;
  if (hasRequiredConclusion) {
    return "complete";
  }

  const hiddenRetryCount = normalizeNonNegativeInteger(context.hiddenRetryCount);
  const maxHiddenRetries = normalizeNonNegativeInteger(context.maxHiddenRetries);
  return hiddenRetryCount < maxHiddenRetries ? "retry" : "fail";
}

/**
 * A Loop main prompt is self-contained and references its durable communication
 * files, so it can recover from an OpenCode session that repeatedly exits with
 * no model tokens. Limit the rollover to one fresh-session attempt per run.
 */
export function shouldRecoverOpenCodeLoopMainSessionInFreshSession(
  context: OpenCodeLoopFreshSessionRecoveryContext,
): boolean {
  return context.isLoopMainRun
    && context.hasResumableSession
    && !context.hasProviderError
    && !context.freshSessionRecoveryAttempted;
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
