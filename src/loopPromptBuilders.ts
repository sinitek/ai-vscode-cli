

export function normalizeLoopContinuePromptForPrompt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function formatLoopEstimatedRemainingRounds(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return String(Math.max(0, Math.round(value)));
}
