import { FINAL_ANSWER_TEXT_MARKER, isFinalAnswerMessage } from "./finalAnswerProtocol";
import { parseCompleteJsonContainer } from "./shared/jsonContainer";
import type { ChatMessage } from "./webview/types";

export type SessionMessagePruningPlanInput = {
  authoritativeSource: readonly ChatMessage[];
  sharedMessages: readonly (readonly ChatMessage[])[];
  candidateSnapshot: readonly unknown[] | undefined;
  protectedIds: ReadonlySet<string>;
};

export type SessionMessagePruningPlan = {
  readonly deletedIds: ReadonlySet<string>;
  readonly remainingMessages: ChatMessage[];
};

export function buildSessionMessagePruningPlan(
  input: SessionMessagePruningPlanInput
): SessionMessagePruningPlan {
  const candidates = new Map<string, string>();
  if (Array.isArray(input.candidateSnapshot)) {
    for (const candidate of input.candidateSnapshot) {
      if (candidate && typeof candidate.id === "string" && typeof candidate.content === "string") {
        candidates.set(candidate.id, candidate.content);
      }
    }
  }

  const deletedIds = new Set(input.authoritativeSource
    .filter((message) => candidates.get(message.id) === message.content)
    .map((message) => message.id));

  for (const messages of input.sharedMessages) {
    for (const message of messages) {
      const content = message.content.trimStart();
      const displayContent = content.startsWith(FINAL_ANSWER_TEXT_MARKER)
        ? content.slice(FINAL_ANSWER_TEXT_MARKER.length).trimStart()
        : content;
      const protectedFinalAnswer = isFinalAnswerMessage(message, FINAL_ANSWER_TEXT_MARKER)
        && !parseCompleteJsonContainer(displayContent);
      if (message.role === "user" || protectedFinalAnswer || input.protectedIds.has(message.id)
        || candidates.get(message.id) !== message.content) {
        deletedIds.delete(message.id);
      }
    }
  }

  return {
    deletedIds,
    remainingMessages: input.authoritativeSource.filter((message) => !deletedIds.has(message.id)),
  };
}
