export const CHAT_MESSAGE_LIMIT_DEFAULT = 500;
export const LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT = 200;
export const CHAT_MESSAGE_LIMIT_MIN = 1;
export const CHAT_MESSAGE_LIMIT_MAX = 10000;

export function normalizeChatMessageLimit(value: unknown, defaultValue = CHAT_MESSAGE_LIMIT_DEFAULT): number {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return defaultValue;
  }
  return Math.min(Math.max(Math.floor(numeric), CHAT_MESSAGE_LIMIT_MIN), CHAT_MESSAGE_LIMIT_MAX);
}
