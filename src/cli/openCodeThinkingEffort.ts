export const OPENCODE_THINKING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;

export type OpenCodeThinkingEffort = (typeof OPENCODE_THINKING_EFFORTS)[number];

export const DEFAULT_OPENCODE_THINKING_EFFORT: OpenCodeThinkingEffort = "medium";

const OPENCODE_THINKING_EFFORT_SET = new Set<string>(OPENCODE_THINKING_EFFORTS);

export function isOpenCodeThinkingEffort(value: unknown): value is OpenCodeThinkingEffort {
  return typeof value === "string" && OPENCODE_THINKING_EFFORT_SET.has(value.trim());
}

export function normalizeOpenCodeThinkingEffort(value: unknown): OpenCodeThinkingEffort {
  if (typeof value !== "string") {
    return DEFAULT_OPENCODE_THINKING_EFFORT;
  }
  const normalized = value.trim();
  return OPENCODE_THINKING_EFFORT_SET.has(normalized)
    ? normalized as OpenCodeThinkingEffort
    : DEFAULT_OPENCODE_THINKING_EFFORT;
}
