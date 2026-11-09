export type ChatBubbleRetentionEntry<Message = unknown> = {
  message: Message;
  index: number;
  protected: boolean;
};

export type ChatBubbleRetentionMessage = {
  role: string;
  content?: string;
  kind?: string;
  subagentId?: string;
  loopAnswerConclusion?: boolean;
  loopFinalSummary?: boolean;
  codexFinalAnswer?: boolean;
};

export function selectRetainedChatBubbleEntries<Entry extends ChatBubbleRetentionEntry>(
  entries: readonly Entry[],
  limit = 500,
): Entry[] {
  const threshold = Math.floor(limit * 1.1);
  const batchSize = Math.max(1, Math.ceil(limit * 0.2));
  let remaining = entries.length > threshold
    ? batchSize * Math.ceil((entries.length - threshold) / batchSize)
    : 0;
  return entries.filter((entry) => {
    if (remaining > 0 && !entry.protected) {
      remaining -= 1;
      return false;
    }
    return true;
  });
}

export function isProtectedChatBubbleMessage(
  message: ChatBubbleRetentionMessage,
  finalAnswerTextMarker: string,
  processMessage = false,
): boolean {
  if (message.role === "user") {
    return true;
  }
  if (message.role !== "assistant") {
    return false;
  }
  if (message.loopAnswerConclusion === true
    || message.loopFinalSummary === true
    || message.codexFinalAnswer === true
    || Boolean(finalAnswerTextMarker && String(message.content || "").includes(finalAnswerTextMarker))) {
    return true;
  }
  return !processMessage
    && !message.subagentId
    && message.kind !== "thinking"
    && message.kind !== "tool-use"
    && message.kind !== "tool-result"
    && message.kind !== "tool";
}

export function buildChatBubbleRetentionRuntimeSource(): string {
  return [
    selectRetainedChatBubbleEntries.toString(),
    isProtectedChatBubbleMessage.toString(),
  ].join("\n\n");
}
