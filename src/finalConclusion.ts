import type { ChatMessage } from "./webview/types";

export type FinalConclusionCheckOptions = {
  observedCodexFinalAnswer?: boolean;
  fallbackCreatedAt?: number | null;
  requireExplicitCodexFinalAnswer?: boolean;
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

function isCodexFinalConclusionMessage(message: ChatMessage | undefined): boolean {
  return isAssistantFinalConclusionMessage(message) && message?.codexFinalAnswer === true;
}

export function hasAssistantFinalConclusionAfterMessage(
  messages: ChatMessage[],
  messageId: string,
  options: FinalConclusionCheckOptions = {},
): boolean {
  if (options.observedCodexFinalAnswer === true) {
    return true;
  }

  const isConclusionMessage = options.requireExplicitCodexFinalAnswer === true
    ? isCodexFinalConclusionMessage
    : isAssistantFinalConclusionMessage;

  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex >= 0) {
    return messages.slice(messageIndex + 1).some(isConclusionMessage);
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
    && isConclusionMessage(message)
  ));
}
