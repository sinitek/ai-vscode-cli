function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isClaudeCompactingStatusMessage(message: unknown): boolean {
  if (!isObjectRecord(message)) {
    return false;
  }
  return message.type === "system" && message.subtype === "status" && message.status === "compacting";
}

export function isClaudeCompactBoundaryMessage(message: unknown): boolean {
  if (!isObjectRecord(message)) {
    return false;
  }
  return message.type === "system" && message.subtype === "compact_boundary";
}

export function isClaudeNativeCompactUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /(?:\/compact|slash command[^a-z0-9]*\/?compact|command[^a-z0-9]*\/?compact)/i.test(message)
    && /(?:unknown|unsupported|invalid|disabled|unavailable|not available|not supported)/i.test(message)
  );
}
