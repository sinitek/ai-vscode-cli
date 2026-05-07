const RATE_LIMIT_SIGNAL_TOKENS = [
  "rate_limit_error",
  "concurrency limit exceeded",
  "too many pending requests",
  "http 429",
];

const MAX_WALK_DEPTH = 5;

function parseJsonLikePayload(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function collectErrorTextFragments(payload: unknown, fragments: Set<string>, depth = 0): void {
  if (depth > MAX_WALK_DEPTH || payload === null || typeof payload === "undefined") {
    return;
  }

  if (typeof payload === "string") {
    const normalized = payload.trim();
    if (!normalized) {
      return;
    }
    fragments.add(normalized);
    const parsed = parseJsonLikePayload(normalized);
    if (parsed) {
      collectErrorTextFragments(parsed, fragments, depth + 1);
    }
    return;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectErrorTextFragments(item, fragments, depth + 1);
    }
    return;
  }

  if (typeof payload !== "object") {
    fragments.add(String(payload));
    return;
  }

  const record = payload as Record<string, unknown>;
  for (const key of ["message", "error", "type", "code", "detail", "details", "reason", "additionalDetails", "status"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      collectErrorTextFragments(record[key], fragments, depth + 1);
    }
  }
}

function extractPreferredErrorMessage(payload: unknown, depth = 0): string {
  if (depth > MAX_WALK_DEPTH || payload === null || typeof payload === "undefined") {
    return "";
  }

  if (typeof payload === "string") {
    const normalized = payload.trim();
    if (!normalized) {
      return "";
    }
    const parsed = parseJsonLikePayload(normalized);
    if (parsed) {
      const parsedMessage = extractPreferredErrorMessage(parsed, depth + 1);
      return parsedMessage || normalized;
    }
    return normalized;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const candidate = extractPreferredErrorMessage(item, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }

  if (typeof payload !== "object") {
    return String(payload);
  }

  const record = payload as Record<string, unknown>;
  for (const key of ["message", "detail", "reason", "additionalDetails", "error"]) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const candidate = extractPreferredErrorMessage(record[key], depth + 1);
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function isRateLimitErrorText(normalizedText: string): boolean {
  if (!normalizedText) {
    return false;
  }
  if (RATE_LIMIT_SIGNAL_TOKENS.some((token) => normalizedText.includes(token))) {
    return true;
  }
  return (
    (normalizedText.includes("rate limit") || normalizedText.includes("too many requests"))
    && normalizedText.includes("retry")
  );
}

export function detectCodexRateLimitErrorMessage(payload: unknown): string | null {
  const fragments = new Set<string>();
  collectErrorTextFragments(payload, fragments);
  if (fragments.size === 0) {
    return null;
  }
  const combinedText = Array.from(fragments).join(" ").toLowerCase();
  if (!isRateLimitErrorText(combinedText)) {
    return null;
  }

  const preferredMessage = extractPreferredErrorMessage(payload);
  if (preferredMessage) {
    return preferredMessage;
  }
  return Array.from(fragments)[0] ?? null;
}
