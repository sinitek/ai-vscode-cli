export type ChatBubbleRetentionEntry<Message = unknown> = {
  message: Message;
  index: number;
  protected: boolean;
};

export function selectRetainedChatBubbleEntries<Entry extends ChatBubbleRetentionEntry>(
  entries: readonly Entry[],
  limit = 500,
): Entry[] {
  const threshold = Math.floor(limit * 1.1);
  const batchSize = Math.max(1, Math.ceil(limit * 0.2));
  const oldestWindowSize = entries.length > threshold
    ? batchSize * Math.ceil((entries.length - threshold) / batchSize)
    : 0;
  return entries.filter((entry, position) => position >= oldestWindowSize || entry.protected);
}

export function buildChatBubbleRetentionRuntimeSource(): string {
  return selectRetainedChatBubbleEntries.toString();
}
