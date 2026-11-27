import { logError, logEssential, logInfo } from "../logger";
import { readLoopPlusProtocolDiagnostic } from "../loopPlusProtocolDiagnostics";
import type { LoopPlusSchedulerPhase } from "../loopPlusScheduler";

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
  "parent_stopped",
  "completed",
  "invalid_dependencies",
] as const;

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

/** Scheduler phases already used by Loop+. A new phase must be listed here before it can be stored. */
export const LOOP_PLUS_INTERRUPTION_PHASES = [
  "idle",
  "waiting",
  "review_ready",
  "reviewing",
  "stopped",
  "completed",
] as const satisfies readonly LoopPlusSchedulerPhase[];

/** Closed classification of the four parent-status write sources. */
export const LOOP_PLUS_INTERRUPTION_REASONS = [
  "user-stop",
  "execution-error",
  "persistence-failure",
  "background-subtask-failure",
] as const;

export type LoopPlusInterruptionReason = typeof LOOP_PLUS_INTERRUPTION_REASONS[number];

export type LoopPlusInterruptionSource = {
  phase: LoopPlusSchedulerPhase;
  reason: LoopPlusInterruptionReason;
};

const LOOP_PLUS_INTERRUPTION_PHASE_SET = new Set<string>(LOOP_PLUS_INTERRUPTION_PHASES);
const LOOP_PLUS_INTERRUPTION_REASON_SET = new Set<string>(LOOP_PLUS_INTERRUPTION_REASONS);

export function readLoopPlusInterruptionPhase(value: unknown): LoopPlusSchedulerPhase | undefined {
  return typeof value === "string" && LOOP_PLUS_INTERRUPTION_PHASE_SET.has(value)
    ? value as LoopPlusSchedulerPhase
    : undefined;
}

/** Keeps only phase and reason. Any other field, including identifiers and error text, is dropped. */
export function readLoopPlusInterruptionSource(value: unknown): LoopPlusInterruptionSource | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as { phase?: unknown; reason?: unknown };
  const phase = readLoopPlusInterruptionPhase(record.phase);
  const reason = typeof record.reason === "string" && LOOP_PLUS_INTERRUPTION_REASON_SET.has(record.reason)
    ? record.reason as LoopPlusInterruptionReason
    : undefined;
  return phase && reason ? { phase, reason } : undefined;
}

export function classifyLoopPlusInterruption(input: {
  status: "error" | "stopped";
  userStopSource?: "ai-panel" | "group-chat";
  persistenceFailure?: boolean;
  backgroundSubtaskFailure?: boolean;
}): LoopPlusInterruptionReason {
  if (input.persistenceFailure) return "persistence-failure";
  if (input.status === "stopped" || input.userStopSource) return "user-stop";
  if (input.backgroundSubtaskFailure) return "background-subtask-failure";
  return "execution-error";
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
};

function readProtocolFailureCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 99 ? value : 0;
}

function readProtocolRecoveryStage(value: unknown): LoopPlusProtocolRecoveryStage {
  return value === "continuation_requested" || value === "paused" || value === "stopped"
    ? value : LOOP_PLUS_PROTOCOL_RECOVERY_STAGE_FALLBACK;
}

function readProtocolDispatchWindow(value: unknown): "open" | "closed" {
  return value === "open" || value === "closed" ? value : "closed";
}

/** Rebuilds one disk summary from the diagnostic contract. Identifiers, prompts, and raw errors are not copied. */
export function summarizeLoopPlusProtocolRejection(payload: unknown): LoopPlusProtocolRejectionSummary {
  const detail = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const diagnostic = readLoopPlusProtocolDiagnostic(
    typeof detail.reasonCode === "string" ? detail.reasonCode : "",
    typeof detail.fieldPath === "string" ? detail.fieldPath : undefined,
  );
  return {
    rejectionKind: diagnostic.rejectionKind,
    reasonCode: diagnostic.reasonCode,
    ...(diagnostic.fieldPath ? { fieldPath: diagnostic.fieldPath } : {}),
    protocolFailureCount: readProtocolFailureCount(detail.protocolFailureCount),
    recoveryStage: readProtocolRecoveryStage(detail.recoveryStage),
    dispatchWindow: readProtocolDispatchWindow(detail.dispatchWindow),
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
    if (diagnostic) void logEssential(event, diagnostic).catch(() => undefined);
  } else if (event === "loop-plus-protocol-rejection") {
    void logEssential(event, summarizeLoopPlusProtocolRejection(payload)).catch(() => undefined);
  } else if (event === "loop-plus-report-failed" || event === "loop-plus-finish-failed") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const { error: _error, ...diagnostic } = detail;
    void logEssential(event, { ...diagnostic, pid: process.pid }).catch(() => undefined);
  } else if (ESSENTIAL_LOOP_PLUS_RUNTIME_EVENTS.has(event)) {
    void logEssential(event, payload).catch(() => undefined);
  } else if (event === "loop-plus-persist-failed") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const { taskId: _taskId, attemptId: _attemptId, error: _error, ...diagnostic } = detail;
    void logError(event, { ...diagnostic, pid: process.pid }).catch(() => undefined);
  } else if (event === "loop-plus-interruption-source") {
    const detail = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const source = readLoopPlusInterruptionSource({ phase: detail.phase, reason: detail.reason });
    if (source) {
      void logEssential(event, { phase: source.phase, reason: source.reason, carried: detail.carried === true }).catch(() => undefined);
    }
  } else {
    void logInfo(event, payload).catch(() => undefined);
  }
}
