import type { ChatMessage } from "./webview/types";
import { containsFinalAnswerTextMarker } from "./finalAnswerProtocol";

export type FinalConclusionCheckOptions = {
  observedFinalAnswer?: boolean;
  fallbackCreatedAt?: number | null;
  requireExplicitFinalAnswer?: boolean;
  allowLatestAssistantCompletionFallback?: boolean;
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

export function isLikelyAssistantCompletionConclusionMessage(message: ChatMessage | undefined): boolean {
  if (!isAssistantFinalConclusionMessage(message)) {
    return false;
  }
  if (isExplicitAssistantFinalConclusionMessage(message)) {
    return true;
  }

  const content = String(message?.content ?? "").trim();
  const firstLine = content.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
  const normalizedFirstLine = firstLine.replace(/^[#>*\s-]+/u, "").replace(/\*\*/gu, "").trim();
  if (
    /(?:接下来|继续|下一步|后续我(?:会|将)|我(?:会|将)|正在|先)/u.test(normalizedFirstLine)
  ) {
    return false;
  }

  const startsLikeCompletion = /^(?:已完成|已修复|已确认|已提交|已更新|已实现|已处理|排查结论|执行摘要|结论[:：]|完成[:：]|Done\.|Completed\.|Fixed\.)/iu.test(normalizedFirstLine);
  if (!startsLikeCompletion) {
    return false;
  }

  return /(?:结论|验证(?:已)?通过|已执行|已校验|已确认|无需|无遗留|遗留问题|修改点|更新内容|完成摘要|执行摘要)/u.test(content);
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

function hasLatestAssistantFallbackConclusion(messages: ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (isLikelyAssistantCompletionConclusionMessage(message)) {
      return true;
    }
    if (message.role === "assistant" && message.kind === "thinking") {
      continue;
    }
    return false;
  }
  return false;
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

  const messagesAfterAnchor = getMessagesAfterAnchor(messages, messageId, options.fallbackCreatedAt);
  if (messagesAfterAnchor.some(isConclusionMessage)) {
    return true;
  }

  return options.requireExplicitFinalAnswer === true
    && options.allowLatestAssistantCompletionFallback === true
    && hasLatestAssistantFallbackConclusion(messagesAfterAnchor);
}
