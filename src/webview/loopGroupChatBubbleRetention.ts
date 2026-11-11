import { LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT, normalizeChatMessageLimit } from "../chatMessageLimit";

export type LoopGroupChatBubbleWindow = {
  limit?: number;
  start: number;
};

export function selectLoopGroupChatBubbles<Entry>(
  entries: readonly Entry[],
  limitValue: unknown,
  window: LoopGroupChatBubbleWindow = { start: 0 },
): Entry[] {
  const limit = normalizeChatMessageLimit(limitValue, LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT);
  if (window.limit !== limit) {
    window.limit = limit;
    window.start = 0;
  }
  window.start = Math.min(window.start, Math.max(0, entries.length - 1));
  const overflow = entries.length - window.start - limit;
  if (overflow >= 0) {
    const batchSize = Math.max(1, Math.ceil(limit / 4));
    window.start += Math.min(
      entries.length - window.start - 1,
      batchSize * (Math.floor(overflow / batchSize) + 1),
    );
  }
  return entries.slice(window.start);
}
