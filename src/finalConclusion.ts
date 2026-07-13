import type { ChatMessage } from "./webview/types";
import { containsFinalAnswerTextMarker } from "./finalAnswerProtocol";

export type FinalConclusionCheckOptions = {
  observedFinalAnswer?: boolean;
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

export function hasAssistantFinalConclusionAfterMessage(
  messages: ChatMessage[],
  messageId: string,
  options: FinalConclusionCheckOptions = {},
): boolean {
  if (options.observedFinalAnswer === true) {
    return true;
  }

  const isConclusionMessage = options.requireExplicitFinalAnswer === true
    ? isExplicitAssistantFinalConclusionMessage
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
