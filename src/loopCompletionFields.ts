export type LoopAcceptanceCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type LoopRoundSummary = {
  round: number;
  subtaskId?: string;
  title: string;
  summary: string;
};

const LOOP_MAX_ESTIMATED_REMAINING_ROUNDS = 100;

export function normalizeLoopEstimatedRemainingRounds(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(numeric), 0), LOOP_MAX_ESTIMATED_REMAINING_ROUNDS);
}

export function normalizeLoopRoundSummaries(values: readonly unknown[]): LoopRoundSummary[] {
  return values.map(normalizeSingleLoopRoundSummary)
    .filter((item): item is LoopRoundSummary => item !== null);
}

export function normalizeSingleLoopRoundSummary(value: unknown): LoopRoundSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const summary = value as {
    round?: unknown;
    subtaskId?: unknown;
    title?: unknown;
    summary?: unknown;
  };
  const round = typeof summary.round === "number" && summary.round > 0
    ? Math.floor(summary.round)
    : null;
  const title = typeof summary.title === "string" ? summary.title.trim() : "";
  const content = typeof summary.summary === "string" ? summary.summary.trim() : "";
  if (!round || !title || !content) {
    return null;
  }
  return {
    round,
    subtaskId: typeof summary.subtaskId === "string" && summary.subtaskId.trim()
      ? summary.subtaskId.trim()
      : undefined,
    title,
    summary: content,
  };
}

export function normalizeLoopAcceptanceChecks(value: unknown): LoopAcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): LoopAcceptanceCheck | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const check = item as { name?: unknown; passed?: unknown; detail?: unknown };
      const name = typeof check.name === "string" && check.name.trim() ? check.name.trim() : "acceptance";
      return {
        name,
        passed: check.passed === true,
        detail: typeof check.detail === "string" ? check.detail : undefined,
      };
    })
    .filter((item): item is LoopAcceptanceCheck => item !== null);
}
