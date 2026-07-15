import type { ThinkingMode } from "./cli/types";

export const LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT = "xhigh" as const;

export const LOOP_SUBTASK_MAX_THINKING_MODES = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type LoopSubtaskMaxThinkingMode = (typeof LOOP_SUBTASK_MAX_THINKING_MODES)[number];

const THINKING_MODE_RANK: Record<ThinkingMode, number> = {
  off: 0,
  on: 1,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
  ultra: 6,
};

export function normalizeLoopSubtaskMaxThinkingMode(
  value: unknown,
): LoopSubtaskMaxThinkingMode | null {
  if (value === "max" || value === "ultra") {
    return LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT;
  }
  return LOOP_SUBTASK_MAX_THINKING_MODES.includes(value as LoopSubtaskMaxThinkingMode)
    ? value as LoopSubtaskMaxThinkingMode
    : null;
}

export function getEffectiveLoopSubtaskMaxThinkingMode(
  value: unknown,
): LoopSubtaskMaxThinkingMode {
  return normalizeLoopSubtaskMaxThinkingMode(value) ?? LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT;
}

export function resolveLoopSubtaskThinkingMode(
  selectedMode: ThinkingMode,
  maxMode: unknown,
): ThinkingMode {
  const effectiveMaxMode = getEffectiveLoopSubtaskMaxThinkingMode(maxMode);
  return THINKING_MODE_RANK[selectedMode] <= THINKING_MODE_RANK[effectiveMaxMode]
    ? selectedMode
    : effectiveMaxMode;
}
