import type { LoopPlusSchedulerPhase } from "./loopPlusScheduler";

export const LOOP_PLUS_INTERRUPTION_PHASES = [
  "idle",
  "waiting",
  "review_ready",
  "reviewing",
  "stopped",
  "completed",
] as const satisfies readonly LoopPlusSchedulerPhase[];

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
