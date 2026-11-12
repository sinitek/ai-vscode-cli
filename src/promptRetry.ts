import {
  buildHiddenRetryAttemptInfo,
  buildHiddenRetryErrorTraceContent,
  buildHiddenRetryProgressInfo,
  getHiddenRetryDelayMs,
  HIDDEN_RETRY_DELAY_SEQUENCE_MS,
  isSameHiddenRetryErrorTraceContent,
} from "./hiddenRetry";
import { t } from "./i18n";
import { GROK_RESPONSES_STREAM_INCOMPATIBLE } from "./interactive/grokAppServerProtocol";
import { isNonRetryableCodexThreadError } from "./interactive/codexThreadErrors";
import { appendMessageToStore, type LoopTaskRole } from "./promptRunState";
import type { ChatMessage } from "./webview/types";

export const HIDDEN_RETRY_MAX_RETRIES = HIDDEN_RETRY_DELAY_SEQUENCE_MS.length;

export type ErrorInfo = {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
};

export type CliAttemptResult =
  | { type: "exit"; code: number | null }
  | { type: "error"; error: Error };

export type RetryErrorTraceMessageOptions = {
  tabId?: string;
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
};

type HiddenRetryTraceDeps = {
  createMessageId: () => string;
  sendPanelMessage: (payload: { type: "appendMessage"; message: ChatMessage; tabId?: string }) => void;
};

export function getErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const code = typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: unknown }).code)
      : undefined;
    return {
      message: error.message,
      name: error.name,
      code,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; name?: unknown; code?: unknown; stack?: unknown };
    const message = typeof record.message === "string" ? record.message : String(error);
    const name = typeof record.name === "string" ? record.name : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    const stack = typeof record.stack === "string" ? record.stack : undefined;
    return { message, name, code, stack };
  }
  return { message: String(error) };
}

export function getAttemptFailureMessage(attemptResult: CliAttemptResult, resultErrorText?: string | null): string {
  if (attemptResult.type === "error") {
    const info = getErrorInfo(attemptResult.error);
    return info.message || t("common.unknownError");
  }
  const normalizedResultError = typeof resultErrorText === "string" && resultErrorText.trim()
    ? resultErrorText.trim()
    : null;
  return normalizedResultError ?? t("run.exitCode", { code: attemptResult.code ?? "unknown" });
}

export function createHiddenRetryErrorTraceMessage(
  lastFailureMessage: string,
  options: RetryErrorTraceMessageOptions,
  deps: Pick<HiddenRetryTraceDeps, "createMessageId">,
): ChatMessage {
  const content = buildHiddenRetryErrorTraceContent(lastFailureMessage, t("common.unknownError"));
  return {
    id: deps.createMessageId(),
    role: "trace",
    content,
    createdAt: Date.now(),
    kind: "normal",
    merge: false,
    taskRole: options.taskRole,
    loopTaskId: options.loopTaskId,
    loopRound: options.loopRound,
    loopSubtaskId: options.loopSubtaskId,
  };
}

export function appendHiddenRetryErrorTraceMessage(
  target: ChatMessage[] | null | undefined,
  lastFailureMessage: string,
  options: RetryErrorTraceMessageOptions,
  deps: HiddenRetryTraceDeps,
): void {
  if (!target) {
    return;
  }
  const last = target[target.length - 1];
  if (last?.role === "trace" && isSameHiddenRetryErrorTraceContent(last.content, lastFailureMessage, t("common.unknownError"))) {
    return;
  }
  const message = createHiddenRetryErrorTraceMessage(lastFailureMessage, options, deps);
  appendMessageToStore(target, message);
  deps.sendPanelMessage({
    type: "appendMessage",
    message,
    ...(options.tabId ? { tabId: options.tabId } : {}),
  });
}

export function isAbortErrorInfo(info: ErrorInfo): boolean {
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message ?? ""}`.toLowerCase();
  return combined.includes("abort");
}

const NON_RETRYABLE_BILLING_ERROR_CODES = new Set([
  "402",
  "HTTP_402",
  "PAYMENT_REQUIRED",
  "INSUFFICIENT_CREDITS",
  "INSUFFICIENT_BALANCE",
]);

const NON_RETRYABLE_BILLING_ERROR_PATTERNS = [
  /\b(?:unexpected\s+)?status\s*:?[\s=]*402\b/i,
  /\bhttp(?:\s+status)?\s*:?[\s=]*402\b/i,
  /\b402\s+payment required\b/i,
  /\bpayment required\b/i,
  /\binsufficient\s+(?:credits?|balance|points?)\b/i,
  /\b(?:credits?|balance|points?)\s+(?:exhausted|depleted)\b/i,
  /\brequires?\s+\d+(?:\.\d+)?\s+points?\b[\s\S]*\bremaining\s+0(?![\d.])/i,
] as const;

const NON_RETRYABLE_MODEL_ERROR_CODES = new Set(["MODEL_NOT_FOUND"]);

const NON_RETRYABLE_MODEL_ERROR_PATTERNS = [
  /\bmodel_not_found\b/i,
  /\bnot supported by any configured account\b/i,
] as const;

export function isNonRetryableBillingErrorInfo(info: ErrorInfo): boolean {
  const normalizedCode = String(info.code ?? "").trim().toUpperCase();
  if (NON_RETRYABLE_BILLING_ERROR_CODES.has(normalizedCode)) {
    return true;
  }
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message ?? ""}`;
  return NON_RETRYABLE_BILLING_ERROR_PATTERNS.some((pattern) => pattern.test(combined));
}

export function isHiddenRetryEligibleErrorInfo(info: ErrorInfo): boolean {
  if (isNonRetryableCodexThreadError(info.code, info.message ?? "")) {
    return false;
  }
  if (info.code === GROK_RESPONSES_STREAM_INCOMPATIBLE) {
    return false;
  }
  if (info.name === "AbortError" || info.code === "RUNNER_DISPOSED" || !info.message || isAbortErrorInfo(info)) {
    return false;
  }
  if (isNonRetryableBillingErrorInfo(info)) {
    return false;
  }
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message}`.toLowerCase();
  if (NON_RETRYABLE_MODEL_ERROR_CODES.has(String(info.code ?? "").trim().toUpperCase())
    || NON_RETRYABLE_MODEL_ERROR_PATTERNS.some((pattern) => pattern.test(combined))) {
    return false;
  }
  if ((info.code ?? "").toUpperCase() === "ENOENT" || combined.includes("enoent")) {
    return false;
  }
  return true;
}

export function isHiddenRetryEligibleAttempt(
  attemptResult: CliAttemptResult,
  failureMessage: string,
): boolean {
  if (isNonRetryableBillingErrorInfo({ message: failureMessage })
    || isNonRetryableCodexThreadError(undefined, failureMessage)) {
    return false;
  }
  return attemptResult.type === "exit"
    || isHiddenRetryEligibleErrorInfo(getErrorInfo(attemptResult.error));
}

export async function waitForHiddenRetryDelay(
  retryNumber: number,
  isRunActive: () => boolean
): Promise<boolean> {
  const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
  const deadline = Date.now() + retryDelayMs;
  while (Date.now() < deadline) {
    if (!isRunActive()) {
      return false;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
  }
  return isRunActive();
}

export function buildHiddenRetryLimitMessage(): string {
  return t("run.hiddenRetryLimitReached", {
    attempts: HIDDEN_RETRY_MAX_RETRIES,
    delays: HIDDEN_RETRY_DELAY_SEQUENCE_MS.map(formatHiddenRetryDelay).join(" / "),
  });
}

export function buildHiddenRetryQueuedMessage(hiddenRetryCount: number): string {
  const retryNumber = hiddenRetryCount + 1;
  const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
  const progress = buildHiddenRetryProgressInfo(
    hiddenRetryCount,
    HIDDEN_RETRY_MAX_RETRIES,
    retryDelayMs,
  );
  return t("run.hiddenRetryQueued", {
    attempt: progress.retryNumber,
    attempts: progress.maxRetries,
    seconds: progress.retryDelaySeconds,
    delay: formatHiddenRetryDelay(retryDelayMs),
  });
}

export function buildHiddenRetryStartedMessage(retryNumber: number): string {
  const attemptInfo = buildHiddenRetryAttemptInfo(retryNumber, HIDDEN_RETRY_MAX_RETRIES);
  return t("run.hiddenRetryStarted", {
    attempt: attemptInfo.retryNumber,
    attempts: attemptInfo.maxRetries,
  });
}

function formatHiddenRetryDelay(retryDelayMs: number): string {
  if (retryDelayMs >= 60 * 1000 && retryDelayMs % (60 * 1000) === 0) {
    return `${retryDelayMs / (60 * 1000)} ${t("duration.minutes")}`;
  }
  return `${Math.max(0, Math.ceil(retryDelayMs / 1000))} ${t("duration.seconds")}`;
}
