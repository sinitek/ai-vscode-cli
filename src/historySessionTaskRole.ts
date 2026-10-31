import type { ChatMessage } from "./webview/types";

export type HistorySessionTaskRole = "main" | "subtask";

export function isLoopAskChatMessage(message: { loopAsk?: boolean } | null | undefined): boolean {
  return message?.loopAsk === true;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

type HistorySessionTaskRoleInput = {
  isLoopMainSession?: boolean;
  messages?: readonly ChatMessage[] | null;
};

type HistorySessionTaskRoleCacheEntry = {
  isLoopMainSession: boolean;
  role: HistorySessionTaskRole | null;
};

const historySessionTaskRoleCache = new WeakMap<readonly ChatMessage[], HistorySessionTaskRoleCacheEntry>();

function resolveHistorySessionTaskRoleUncached(
  input: HistorySessionTaskRoleInput,
): HistorySessionTaskRole | null {
  const messages = input.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || isLoopAskChatMessage(message)) {
      continue;
    }
    const loopTaskId = normalizeId(message.loopTaskId);
    const taskRole = message.taskRole === "main" || message.taskRole === "subtask"
      ? message.taskRole
      : null;
    if (loopTaskId && taskRole) {
      return taskRole;
    }
    if (
      taskRole
      && !loopTaskId
      && (message.role === "user" || message.role === "assistant" || message.role === "system")
    ) {
      return "subtask";
    }
    if (message.role === "user" && String(message.content || "").trim()) {
      return null;
    }
  }
  if (input.isLoopMainSession) {
    return "main";
  }
  return null;
}

export function resolveHistorySessionTaskRole(
  input: HistorySessionTaskRoleInput,
): HistorySessionTaskRole | null {
  const messages = input.messages ?? [];
  const isLoopMainSession = Boolean(input.isLoopMainSession);
  if (messages.length > 0) {
    const cached = historySessionTaskRoleCache.get(messages);
    if (
      cached
      && cached.isLoopMainSession === isLoopMainSession
    ) {
      return cached.role;
    }
  }
  const role = resolveHistorySessionTaskRoleUncached({
    isLoopMainSession,
    messages,
  });
  if (messages.length > 0) {
    historySessionTaskRoleCache.set(messages, {
      isLoopMainSession,
      role,
    });
  }
  return role;
}
