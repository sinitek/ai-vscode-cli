export type CodexThreadTokenUsage = {
  tokensInContextWindow: number;
  modelContextWindow: number | null;
  threadId: string;
  turnId: string;
};

export type CodexTokenUsageUpdate = {
  tokensInContextWindow: number;
  modelContextWindow: number | null;
  threadId: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFiniteNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function hasLifetimeTotal(tokenUsage: Record<string, unknown>): boolean {
  return Boolean(
    asRecord(tokenUsage.total)
    || asRecord(tokenUsage.totalTokenUsage)
    || asRecord(tokenUsage.total_token_usage)
  );
}

function readLastUsageBreakdown(tokenUsage: Record<string, unknown>): Record<string, unknown> | null {
  const last = asRecord(tokenUsage.last)
    ?? asRecord(tokenUsage.lastTokenUsage)
    ?? asRecord(tokenUsage.last_token_usage);
  if (last) {
    return last;
  }
  if (hasLifetimeTotal(tokenUsage)) {
    return null;
  }
  if (readFiniteNumber(tokenUsage, [
    "tokensInContextWindow",
    "tokens_in_context_window",
    "totalTokens",
    "total_tokens",
  ]) !== null) {
    return tokenUsage;
  }
  return null;
}

export function computeTokensInContextWindow(source: Record<string, unknown>): number | null {
  const explicit = readFiniteNumber(source, ["tokensInContextWindow", "tokens_in_context_window"]);
  if (explicit !== null && explicit >= 0) {
    return Math.round(explicit);
  }
  const totalTokens = readFiniteNumber(source, ["totalTokens", "total_tokens"]);
  if (totalTokens === null || totalTokens < 0) {
    return null;
  }
  const reasoningTokens = readFiniteNumber(source, ["reasoningOutputTokens", "reasoning_output_tokens"]) ?? 0;
  if (!Number.isFinite(reasoningTokens) || reasoningTokens <= 0) {
    return Math.round(totalTokens);
  }
  return Math.max(0, Math.round(totalTokens - reasoningTokens));
}

export function extractCodexThreadTokenUsage(params: unknown): CodexThreadTokenUsage | null {
  const record = asRecord(params);
  if (!record) {
    return null;
  }

  const turn = asRecord(record.turn);
  const tokenUsage = asRecord(record.tokenUsage)
    ?? asRecord(record.token_usage)
    ?? asRecord(turn?.tokenUsage)
    ?? asRecord(turn?.token_usage)
    ?? record;
  const source = readLastUsageBreakdown(tokenUsage);
  if (!source) {
    return null;
  }

  const tokens = computeTokensInContextWindow(source);
  if (tokens === null) {
    return null;
  }

  const modelContextWindow = readFiniteNumber(tokenUsage, ["modelContextWindow", "model_context_window"])
    ?? readFiniteNumber(record, ["modelContextWindow", "model_context_window"]);
  return {
    tokensInContextWindow: tokens,
    modelContextWindow: modelContextWindow !== null && modelContextWindow > 0
      ? Math.round(modelContextWindow)
      : null,
    threadId: String(record.threadId || record.thread_id || "").trim(),
    turnId: String(record.turnId || record.turn_id || turn?.id || "").trim(),
  };
}

export function formatTokensInContextWindowK(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) {
    return "";
  }
  const k = tokens / 1000;
  if (k < 10) {
    const scaled = Math.round(k * 10);
    if (scaled % 10 === 0) {
      return `${scaled / 10}k`;
    }
    return `${(scaled / 10).toFixed(1)}k`;
  }
  return `${Math.round(k)}k`;
}
