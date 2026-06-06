import type { ChatMessage } from "./webview/types";

export type FinalConclusionCheckOptions = {
  observedCodexFinalAnswer?: boolean;
  fallbackCreatedAt?: number | null;
};

export function isAssistantFinalConclusionMessage(message: ChatMessage | undefined): boolean {
  return Boolean(
    message
    && message.role === "assistant"
    && message.kind !== "thinking"
    && typeof message.content === "string"
    && message.content.trim().length > 0
  );
}

export function hasAssistantFinalConclusionAfterMessage(
  messages: ChatMessage[],
  messageId: string,
  options: FinalConclusionCheckOptions = {},
): boolean {
  if (options.observedCodexFinalAnswer === true) {
    return true;
  }

  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex >= 0) {
    return messages.slice(messageIndex + 1).some(isAssistantFinalConclusionMessage);
  }

  const fallbackCreatedAt = typeof options.fallbackCreatedAt === "number"
    && Number.isFinite(options.fallbackCreatedAt)
    ? options.fallbackCreatedAt
    : null;
  if (fallbackCreatedAt === null) {
    return false;
  }

  return messages.some((message) => (
    typeof message.createdAt === "number"
    && message.createdAt >= fallbackCreatedAt
    && isAssistantFinalConclusionMessage(message)
  ));
}
