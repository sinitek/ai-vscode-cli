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

const ERROR_TRACE_MARKER = "error";
const DEFAULT_ERROR_TRACE_FALLBACK = "Unknown error";

export const HIDDEN_RETRY_DELAY_SEQUENCE_MS = [
  5 * 1000,
  15 * 1000,
  30 * 1000,
  2 * 60 * 1000,
  5 * 60 * 1000,
] as const;

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

export function buildHiddenRetryErrorTraceContent(
  lastFailureMessage?: string | null,
  fallbackMessage = DEFAULT_ERROR_TRACE_FALLBACK,
): string {
  const message = normalizeMessage(lastFailureMessage)
    ?? normalizeMessage(fallbackMessage)
    ?? DEFAULT_ERROR_TRACE_FALLBACK;
  return `${ERROR_TRACE_MARKER}\n${message}`;
}

export function getHiddenRetryDelayMs(
  retryNumber: number,
  retryDelaysMs: readonly number[] = HIDDEN_RETRY_DELAY_SEQUENCE_MS,
): number {
  if (retryDelaysMs.length === 0) {
    return 0;
  }
  const normalizedRetryNumber = Number.isFinite(retryNumber)
    ? Math.max(1, Math.floor(retryNumber))
    : 1;
  const index = Math.min(normalizedRetryNumber - 1, retryDelaysMs.length - 1);
  return Math.max(0, Math.floor(retryDelaysMs[index] ?? 0));
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
