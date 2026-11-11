import { LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT, normalizeChatMessageLimit } from "../chatMessageLimit";

export type LoopGroupChatBubbleWindow = {
  limit?: number;
  start: number;
};

export function selectLoopGroupChatBubbles<Entry>(
  entries: readonly Entry[],
  limitValue: unknown,
  window: LoopGroupChatBubbleWindow = { start: 0 },
  shouldPreserve?: (entry: Entry) => boolean,
): Entry[] {
  const limit = normalizeChatMessageLimit(limitValue, LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT);
  if (window.limit !== limit) {
    window.limit = limit;
    window.start = 0;
  }
  window.start = Math.min(window.start, Math.max(0, entries.length - 1));
  const preservedEntries = shouldPreserve ? entries.slice(0, window.start).filter(shouldPreserve) : [];
  const overflow = preservedEntries.length + entries.length - window.start - limit;
  if (overflow >= 0) {
    const batchSize = Math.max(1, Math.ceil(limit / 4));
    let remaining = batchSize * (Math.floor(overflow / batchSize) + 1);
    while (remaining > 0 && window.start < entries.length - 1) {
      const entry = entries[window.start];
      if (shouldPreserve?.(entry)) {
        preservedEntries.push(entry);
      } else {
        remaining -= 1;
      }
      window.start += 1;
    }
  }
  return preservedEntries.concat(entries.slice(window.start));
}
