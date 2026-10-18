import { FINAL_ANSWER_TEXT_MARKER } from "./finalAnswerProtocol";
import {
  isCommandExecutionTrace,
  isFileUpdateTrace,
  isThinkingTrace,
  isToolResultTrace,
  isToolUseTrace,
  isWarningOrErrorTrace,
  isWebSearchTrace,
} from "./traceDisplay";
import type { ChatMessage } from "./webview/types";

export type SessionHealth = "normal" | "abnormal";

export function resolveSessionHealth(
  previousHealth: SessionHealth | undefined,
  messages: readonly ChatMessage[],
): SessionHealth {
  if (previousHealth === "normal") {
    return "normal";
  }
  const hasNormalBubble = messages.some((message) => {
    const content = String(message.content ?? "").split(FINAL_ANSWER_TEXT_MARKER).join("").trim();
    if (!content) {
      return false;
    }
    if (message.role === "assistant") {
      return true;
    }
    if (message.role !== "trace" || isWarningOrErrorTrace(content)) {
      return false;
    }
    return message.kind === "thinking"
      || message.kind === "tool-use"
      || isThinkingTrace(content)
      || isCommandExecutionTrace(content)
      || isFileUpdateTrace(content)
      || isToolUseTrace(content)
      || isToolResultTrace(content)
      || isWebSearchTrace(content);
  });
  return hasNormalBubble ? "normal" : "abnormal";
}
