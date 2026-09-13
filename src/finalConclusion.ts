import type { ChatMessage } from "./webview/types";
import { containsFinalAnswerTextMarker } from "./finalAnswerProtocol";

export type FinalConclusionCheckOptions = {
  observedFinalAnswer?: boolean;
  observedCompletedTurn?: boolean;
  fallbackCreatedAt?: number | null;
  requireExplicitFinalAnswer?: boolean;
};

export function isAssistantFinalConclusionMessage(message: ChatMessage | undefined): boolean {
  return Boolean(
    message
    && message.role === "assistant"
    && message.kind !== "thinking"
    && !message.subagentId
    && typeof message.content === "string"
    && message.content.trim().length > 0
  );
}

export function isExplicitAssistantFinalConclusionMessage(message: ChatMessage | undefined): boolean {
  return isAssistantFinalConclusionMessage(message) && (
    message?.codexFinalAnswer === true
    || containsFinalAnswerTextMarker(message?.content)
  );
}

function getMessagesAfterAnchor(
  messages: ChatMessage[],
  messageId: string,
  fallbackCreatedAt?: number | null,
): ChatMessage[] {
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex >= 0) {
    return messages.slice(messageIndex + 1);
  }

  const normalizedFallbackCreatedAt = typeof fallbackCreatedAt === "number"
    && Number.isFinite(fallbackCreatedAt)
    ? fallbackCreatedAt
    : null;
  if (normalizedFallbackCreatedAt === null) {
    return [];
  }

  return messages.filter((message) => (
    typeof message.createdAt === "number"
    && message.createdAt >= normalizedFallbackCreatedAt
  ));
}

export function hasAssistantFinalConclusionAfterMessage(
  messages: ChatMessage[],
  messageId: string,
  options: FinalConclusionCheckOptions = {},
): boolean {
  if (options.observedFinalAnswer === true) {
    return true;
  }
  if (options.observedCompletedTurn === true && options.requireExplicitFinalAnswer !== true) {
    return true;
  }

  const isConclusionMessage = options.requireExplicitFinalAnswer === true
    ? isExplicitAssistantFinalConclusionMessage
    : isAssistantFinalConclusionMessage;

  const messagesAfterAnchor = getMessagesAfterAnchor(messages, messageId, options.fallbackCreatedAt);
  if (messagesAfterAnchor.some(isConclusionMessage)) {
    return true;
  }
  return false;
}
