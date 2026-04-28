export type HiddenRetryFailureMessageOptions = {
  hiddenRetryCount: number;
  maxRetries: number;
  retryLimitMessage: string;
  fallbackMessage: string;
  lastFailureMessage?: string | null;
  lastFailurePrefix?: string;
};

export type HiddenRetryProgressInfo = {
  retryNumber: number;
  maxRetries: number;
  retryDelaySeconds: number;
};

function normalizeMessage(message?: string | null): string | null {
  if (typeof message !== "string") {
    return null;
  }
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildHiddenRetryFailureMessage(options: HiddenRetryFailureMessageOptions): string {
  const lastFailureMessage = normalizeMessage(options.lastFailureMessage);
  if (options.hiddenRetryCount < options.maxRetries) {
    return lastFailureMessage ?? options.fallbackMessage;
  }
  if (!lastFailureMessage) {
    return options.retryLimitMessage || options.fallbackMessage;
  }
  if (!options.retryLimitMessage) {
    return lastFailureMessage;
  }
  return `${options.retryLimitMessage}\n${options.lastFailurePrefix ?? ""}${lastFailureMessage}`;
}

export function buildHiddenRetryProgressInfo(
  hiddenRetryCount: number,
  maxRetries: number,
  retryDelayMs: number,
): HiddenRetryProgressInfo {
  return {
    retryNumber: Math.max(1, Math.min(maxRetries, hiddenRetryCount + 1)),
    maxRetries,
    retryDelaySeconds: Math.max(0, Math.ceil(retryDelayMs / 1000)),
  };
}

export function resetHiddenRetryCountOnRecoveredReply(
  hiddenRetryCount: number,
  hasRecoveredReply: boolean,
): number {
  if (!hasRecoveredReply || hiddenRetryCount <= 0) {
    return hiddenRetryCount;
  }
  return 0;
}
