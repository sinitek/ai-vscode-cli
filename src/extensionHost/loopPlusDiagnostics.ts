import { logError, logEssential, logInfo } from "../logger";
import {
  isLoopPlusRequestPhase,
  isLoopPlusResponseShape,
  readLoopPlusBatchEvidence,
  readLoopPlusBatchKey,
  readLoopPlusInvocationKey,
  readLoopPlusProtocolDiagnostic,
  readLoopPlusTerminalReasonCode,
  type LoopPlusRequestPhase,
  type LoopPlusResponseShape,
  type LoopPlusTerminalReasonCode,
} from "../loopPlusProtocolDiagnostics";
import { readLoopPlusInterruptionSource } from "../loopPlusInterruptionSource";

export {
  LOOP_PLUS_INTERRUPTION_PHASES,
  LOOP_PLUS_INTERRUPTION_REASONS,
  classifyLoopPlusInterruption,
  readLoopPlusInterruptionPhase,
  readLoopPlusInterruptionSource,
} from "../loopPlusInterruptionSource";
export type {
  LoopPlusInterruptionReason,
  LoopPlusInterruptionSource,
} from "../loopPlusInterruptionSource";

const ESSENTIAL_LOOP_PLUS_RUNTIME_EVENTS = new Set([
  "loop-plus-finish-ignored",
  "loop-plus-finish-failed",
  "loop-plus-report-failed",
  "loop-plus-subtask-interrupted",
  "loop-plus-subtask-tab-auto-close-error",
  "loop-plus-subtask-tab-auto-closed",
]);

const LOOP_PLUS_DISPATCH_REJECTION_REASONS = [
  "invalid_spec",
  "duplicate_attempt",
  "active_subtask",
  "duplicate_subtask",
  "parent_stopped",
  "completed",
  "invalid_dependencies",
] as const;

const LOOP_PLUS_DISPATCH_COLLISION_REASONS = ["active_subtask", "duplicate_subtask"] as const;

type LoopPlusDispatchCollisionReason = typeof LOOP_PLUS_DISPATCH_COLLISION_REASONS[number];

const LOOP_PLUS_DISPATCH_REJECTION_COUNT_KEYS = [
  ...LOOP_PLUS_DISPATCH_REJECTION_REASONS,
  "other",
] as const;

type LoopPlusDispatchRejectionCountKey = typeof LOOP_PLUS_DISPATCH_REJECTION_COUNT_KEYS[number];

const LOOP_PLUS_DISPATCH_REJECTION_REASON_SET = new Set<string>(LOOP_PLUS_DISPATCH_REJECTION_REASONS);

export type LoopPlusDispatchRejectionSummary = {
  rejectedCount: number;
  reasonCounts: Partial<Record<LoopPlusDispatchRejectionCountKey, number>>;
};

export class LoopPlusUpdateUnconfirmedError extends Error {
  constructor(taskId: string) {
    super(`Loop+ task update did not commit: ${taskId}`);
  }
}

export function summarizeLoopPlusDispatchRejections(
  rejected: readonly { reason?: unknown }[] | null | undefined,
): LoopPlusDispatchRejectionSummary | null {
  if (!rejected || rejected.length === 0) return null;
  const tally: Partial<Record<LoopPlusDispatchRejectionCountKey, number>> = {};
  for (const item of rejected) {
    const raw = item && typeof item.reason === "string" ? item.reason : "";
    const key: LoopPlusDispatchRejectionCountKey = LOOP_PLUS_DISPATCH_REJECTION_REASON_SET.has(raw)
      ? raw as typeof LOOP_PLUS_DISPATCH_REJECTION_REASONS[number]
      : "other";
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return copyLoopPlusDispatchRejectionCounts(tally);
}

function copyLoopPlusDispatchRejectionCounts(counts: unknown): LoopPlusDispatchRejectionSummary | null {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
  const source = counts as Record<string, unknown>;
  const reasonCounts: LoopPlusDispatchRejectionSummary["reasonCounts"] = {};
  let rejectedCount = 0;
  for (const reason of LOOP_PLUS_DISPATCH_REJECTION_COUNT_KEYS) {
    const value = source[reason];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) continue;
    reasonCounts[reason] = value;
    rejectedCount += value;
  }
  return rejectedCount > 0 ? { rejectedCount, reasonCounts } : null;
}

function persistentLoopPlusDispatchRejection(payload: unknown): LoopPlusDispatchRejectionSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const detail = payload as Record<string, unknown>;
  return copyLoopPlusDispatchRejectionCounts(detail.reasonCounts)
    ?? (Array.isArray(detail.rejected)
      ? summarizeLoopPlusDispatchRejections(detail.rejected as { reason?: unknown }[])
      : null);
}

const LOOP_PLUS_PROTOCOL_RECOVERY_STAGES = ["continuation_requested", "paused", "stopped"] as const;

export type LoopPlusProtocolRecoveryStage = typeof LOOP_PLUS_PROTOCOL_RECOVERY_STAGES[number];

const LOOP_PLUS_PROTOCOL_RECOVERY_STAGE_FALLBACK: LoopPlusProtocolRecoveryStage = "stopped";

export type LoopPlusProtocolRejectionSummary = {
  rejectionKind: "format" | "validation" | "state";
  reasonCode: string;
  fieldPath?: string;
  protocolFailureCount: number;
  recoveryStage: LoopPlusProtocolRecoveryStage;
  dispatchWindow: "open" | "closed";
  decisionStatus?: "dispatch" | "accept";
  collisionCounts?: Partial<Record<LoopPlusDispatchCollisionReason, number>>;
  phase?: "protocol_recovery";
  batchKey?: string;
  batchEvidence?: "frozen_id_sequence";
  invocationKey?: string;
  requestPhase?: LoopPlusRequestPhase;
  responseShape?: Exclude<LoopPlusResponseShape, "execution_failed">;
  charCount?: number;
  elapsedMs?: number;
  attempt?: number;
};

export type LoopPlusMainTerminalSummary = {
  phase: "main_terminal";
  requestPhase: LoopPlusRequestPhase;
  batchKey: string;
  batchEvidence: "frozen_id_sequence";
  invocationKey: string;
  attempt: number;
  responseShape: LoopPlusResponseShape;
  charCount: number;
  elapsedMs: number;
  reasonCode?: LoopPlusTerminalReasonCode;
};

function readProtocolFailureCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 99 ? value : 0;
}

function readBoundedInt(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function readProtocolAssociation(detail: Record<string, unknown>): Pick<
  LoopPlusProtocolRejectionSummary,
  "phase" | "batchKey" | "batchEvidence" | "invocationKey" | "requestPhase" | "responseShape" | "charCount" | "elapsedMs" | "attempt"
> {
  const batchKey = readLoopPlusBatchKey(detail.batchKey);
  const batchEvidence = readLoopPlusBatchEvidence(detail.batchEvidence);
  const invocationKey = readLoopPlusInvocationKey(detail.invocationKey);
  const requestPhase = isLoopPlusRequestPhase(detail.requestPhase) ? detail.requestPhase : undefined;
  const responseShape = isLoopPlusResponseShape(detail.responseShape) && detail.responseShape !== "execution_failed"
    ? detail.responseShape : undefined;
  const charCount = readBoundedInt(detail.charCount, 0, 10_000_000);
  const elapsedMs = readBoundedInt(detail.elapsedMs, 0, 604_800_000);
  const attempt = readBoundedInt(detail.attempt, 1, 1_000_000);
  return {
    ...(detail.phase === "protocol_recovery" ? { phase: "protocol_recovery" } : {}),
    ...(batchKey ? { batchKey } : {}),
    ...(batchKey && batchEvidence ? { batchEvidence } : {}),
    ...(invocationKey ? { invocationKey } : {}),
    ...(requestPhase ? { requestPhase } : {}),
    ...(responseShape ? { responseShape } : {}),
    ...(charCount !== undefined ? { charCount } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
  };
}

function readProtocolRecoveryStage(value: unknown): LoopPlusProtocolRecoveryStage {
  return value === "continuation_requested" || value === "paused" || value === "stopped"
    ? value : LOOP_PLUS_PROTOCOL_RECOVERY_STAGE_FALLBACK;
}

function readProtocolDispatchWindow(value: unknown): "open" | "closed" {
  return value === "open" || value === "closed" ? value : "closed";
}

function readDispatchDecisionStatus(value: unknown): "dispatch" | "accept" | undefined {
  return value === "dispatch" || value === "accept" ? value : undefined;
}

function readDispatchCollisionCounts(value: unknown): Partial<Record<LoopPlusDispatchCollisionReason, number>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const counts: Partial<Record<LoopPlusDispatchCollisionReason, number>> = {};
  for (const reason of LOOP_PLUS_DISPATCH_COLLISION_REASONS) {
    const item = source[reason];
    if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 99) counts[reason] = item;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

/** Rebuilds one disk summary from the diagnostic contract. Identifiers, prompts, and raw errors are not copied. */
export function summarizeLoopPlusProtocolRejection(payload: unknown): LoopPlusProtocolRejectionSummary {
  const detail = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const diagnostic = readLoopPlusProtocolDiagnostic(
    typeof detail.reasonCode === "string" ? detail.reasonCode : "",
    typeof detail.fieldPath === "string" ? detail.fieldPath : undefined,
  );
  const decisionStatus = diagnostic.reasonCode === "state.dispatch.rejected"
    ? readDispatchDecisionStatus(detail.decisionStatus) : undefined;
  const collisionCounts = diagnostic.reasonCode === "state.dispatch.rejected"
    ? readDispatchCollisionCounts(detail.collisionCounts) : undefined;
  return {
    rejectionKind: diagnostic.rejectionKind,
    reasonCode: diagnostic.reasonCode,
    ...(diagnostic.fieldPath ? { fieldPath: diagnostic.fieldPath } : {}),
    protocolFailureCount: readProtocolFailureCount(detail.protocolFailureCount),
    recoveryStage: readProtocolRecoveryStage(detail.recoveryStage),
    dispatchWindow: readProtocolDispatchWindow(detail.dispatchWindow),
    ...(decisionStatus ? { decisionStatus } : {}),
    ...(collisionCounts ? { collisionCounts } : {}),
    ...readProtocolAssociation(detail),
  };
}

/** 主模型终结观测。缺任一关联字段则整条丢弃，避免把未白名单的正文写盘。 */
export function summarizeLoopPlusMainTerminal(payload: unknown): LoopPlusMainTerminalSummary | null {
  const detail = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const requestPhase = isLoopPlusRequestPhase(detail.requestPhase) ? detail.requestPhase : undefined;
  const batchKey = readLoopPlusBatchKey(detail.batchKey);
  const batchEvidence = readLoopPlusBatchEvidence(detail.batchEvidence);
  const invocationKey = readLoopPlusInvocationKey(detail.invocationKey);
  const attempt = readBoundedInt(detail.attempt, 1, 1_000_000);
  const responseShape = isLoopPlusResponseShape(detail.responseShape) ? detail.responseShape : undefined;
  const charCount = readBoundedInt(detail.charCount, 0, 10_000_000);
  const elapsedMs = readBoundedInt(detail.elapsedMs, 0, 604_800_000);
  if (!requestPhase || !batchKey || !batchEvidence || !invocationKey || attempt === undefined
    || !responseShape || charCount === undefined || elapsedMs === undefined) {
    return null;
  }
  const reasonCode = responseShape === "execution_failed" ? readLoopPlusTerminalReasonCode(detail.reasonCode) : undefined;
  return {
    phase: "main_terminal",
    requestPhase,
    batchKey,
    batchEvidence,
    invocationKey,
    attempt,
    responseShape,
    charCount,
    elapsedMs,
    ...(reasonCode ? { reasonCode } : {}),
  };
}

export function logLoopPlusRuntimeEvent(event: string, payload?: unknown): void {
  if (event === "loop-plus-invocation-diagnostic") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const stages = new Set(["run", "execution", "handoff", "projection"]);
    const codes = new Set(["terminal-produced-run-missing", "cancelled", "early-exit", "transport-interrupted",
      "run-error-unknown", "unknown", "identity-rejected", "terminal-content-unknown", "authoritative-handoff-used"]);
    const stage = stages.has(String(detail.stage)) ? detail.stage : "unknown";
    const code = codes.has(String(detail.code)) ? detail.code : "unknown";
    void logEssential(event, { stage, code, pid: process.pid }).catch(() => undefined);
  } else if (event === "loop-plus-dispatch-rejected") {
    const diagnostic = persistentLoopPlusDispatchRejection(payload);
    if (diagnostic) void logError(event, diagnostic).catch(() => undefined);
  } else if (event === "loop-plus-protocol-rejection") {
    void logError(event, summarizeLoopPlusProtocolRejection(payload)).catch(() => undefined);
  } else if (event === "loop-plus-main-terminal") {
    const summary = summarizeLoopPlusMainTerminal(payload);
    if (summary) {
      const persistent = summary.responseShape === "absent" || summary.responseShape === "empty"
        || summary.responseShape === "whitespace" || summary.responseShape === "execution_failed";
      const write = persistent ? logError : logInfo;
      void write(event, summary).catch(() => undefined);
    }
  } else if (event === "loop-plus-report-failed" || event === "loop-plus-finish-failed") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const { error: _error, ...diagnostic } = detail;
    void logError(event, { ...diagnostic, pid: process.pid }).catch(() => undefined);
  } else if (ESSENTIAL_LOOP_PLUS_RUNTIME_EVENTS.has(event)) {
    if (event.endsWith("-error") || event.endsWith("-failed")) {
      void logError(event, payload).catch(() => undefined);
    } else {
      void logEssential(event, payload).catch(() => undefined);
    }
  } else if (event === "loop-plus-persist-failed") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const { taskId: _taskId, attemptId: _attemptId, error: _error, ...diagnostic } = detail;
    void logError(event, { ...diagnostic, pid: process.pid }).catch(() => undefined);
  } else if (event === "loop-plus-finish-contention") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const batchKey = readLoopPlusBatchKey(detail.batchKey);
    const { stage, result, reason } = detail;
    if (!batchKey || typeof stage !== "string" || !["parent-read", "receipt-write", "event-write"].includes(stage)
      || typeof result !== "string" || !["retry", "waiting-for-watchdog", "committed", "withheld"].includes(result)) return;
    const write = result === "waiting-for-watchdog" || result === "withheld" ? logError : logInfo;
    void write(event, { batchKey, stage, result,
      reason: reason === "identity-lock-present" || reason === "record-version-changed" ? reason : undefined,
      retry: readBoundedInt(detail.retry, 0, Number.MAX_SAFE_INTEGER),
      schedulerSeq: readBoundedInt(detail.schedulerSeq, 0, Number.MAX_SAFE_INTEGER),
      elapsedMs: readBoundedInt(detail.elapsedMs, 0, Number.MAX_SAFE_INTEGER), pid: process.pid }).catch(() => undefined);
  } else if (event === "loop-plus-completion-commit") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const batchKey = readLoopPlusBatchKey(detail.batchKey);
    const result = detail.result;
    const stage = detail.stage;
    if (!batchKey || typeof result !== "string" || !["retry", "waiting-for-watchdog", "replan", "superseded", "committed", "unconfirmed"].includes(result)
      || typeof stage !== "string" || !["parent-read", "snapshot-check", "final-write", "host-route", "store-resolution", "identity-check", "identity-commit"].includes(stage)) return;
    const write = result === "waiting-for-watchdog" || result === "unconfirmed" || result === "superseded" ? logError : logInfo;
    void write(event, { batchKey, stage, result, attempt: readBoundedInt(detail.attempt, 0, Number.MAX_SAFE_INTEGER),
      elapsedMs: readBoundedInt(detail.elapsedMs, 0, Number.MAX_SAFE_INTEGER), pid: process.pid }).catch(() => undefined);
  } else if (event === "loop-plus-interruption-source") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const source = readLoopPlusInterruptionSource({ phase: detail.phase, reason: detail.reason });
    if (source) {
      void logEssential(event, { phase: source.phase, reason: source.reason, carried: detail.carried === true }).catch(() => undefined);
    }
  } else {
    const writeLog = event.endsWith("-failed") || event.endsWith("-error") ? logError : logInfo;
    void writeLog(event, payload).catch(() => undefined);
  }
}
