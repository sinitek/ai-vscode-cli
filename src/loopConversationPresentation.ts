import type { ChatMessage } from "./webview/types";
import type { LoopSubtaskRecord } from "./loopTaskStore";
import { isLoopAskChatMessage } from "./historySessionTaskRole";

export type LoopSubtaskConversationContext = {
  taskId: string;
  subtaskId: string;
  round: number;
};

export function getLoopMainSubChatMainTitle(): string {
  return "主任务";
}

export function getLoopSubtaskDisplayTitle(index: number, subtask: Pick<LoopSubtaskRecord, "title">): string {
  const displayIndex = Number.isFinite(index) && index >= 0 ? index + 1 : 0;
  const prefix = displayIndex > 0 ? `子任务 ${displayIndex}` : "子任务";
  return subtask.title ? `${prefix}：${subtask.title}` : prefix;
}

export function normalizeLoopTaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeLoopSubtaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeLoopRound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const round = Math.floor(value);
  return round > 0 ? round : null;
}

export function resolveLoopSubtaskConversationContextFromMessages(
  messages: readonly ChatMessage[],
): LoopSubtaskConversationContext | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isLoopAskChatMessage(message)) {
      continue;
    }
    const taskId = normalizeLoopTaskId(message?.loopTaskId);
    const subtaskId = normalizeLoopSubtaskId(message?.loopSubtaskId);
    const round = normalizeLoopRound(message?.loopRound);
    if (message?.taskRole === "subtask" && taskId && subtaskId && round) {
      return { taskId, subtaskId, round };
    }
    if (message?.role === "user" && String(message.content || "").trim()) {
      return null;
    }
  }
  return null;
}
