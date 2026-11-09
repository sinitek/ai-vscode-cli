export const CHAT_MESSAGE_LIMIT_DEFAULT = 500;
export const CHAT_MESSAGE_LIMIT_MIN = 1;
export const CHAT_MESSAGE_LIMIT_MAX = 10000;

export function normalizeChatMessageLimit(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return CHAT_MESSAGE_LIMIT_DEFAULT;
  }
  return Math.min(Math.max(Math.floor(numeric), CHAT_MESSAGE_LIMIT_MIN), CHAT_MESSAGE_LIMIT_MAX);
}
