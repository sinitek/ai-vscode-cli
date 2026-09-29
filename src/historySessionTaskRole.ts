import type { ChatMessage } from "./webview/types";

export type HistorySessionTaskRole = "main" | "subtask";

type HistorySessionTaskRoleInput = {
  isLoopMainSession?: boolean;
  isGraphMainSession?: boolean;
  messages?: readonly ChatMessage[] | null;
};

type HistorySessionTaskRoleCacheEntry = {
  isLoopMainSession: boolean;
  isGraphMainSession: boolean;
  role: HistorySessionTaskRole | null;
};

const historySessionTaskRoleCache = new WeakMap<readonly ChatMessage[], HistorySessionTaskRoleCacheEntry>();

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function messageGraphNodeId(message: ChatMessage | undefined): string | null {
  const directNodeId = normalizeId(message?.graphNodeId);
  if (directNodeId) {
    return directNodeId;
  }
  const actions = Array.isArray(message?.actions) ? message.actions : [];
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action?.type === "openGraphRun") {
      const nodeId = normalizeId(action.nodeId);
      if (nodeId) {
        return nodeId;
      }
    }
  }
  return null;
}

function messageHasGraphRun(message: ChatMessage | undefined): boolean {
  if (!message) {
    return false;
  }
  if (normalizeId(message.graphRunId) || message.graphFinalSummary === true) {
    return true;
  }
  const actions = Array.isArray(message.actions) ? message.actions : [];
  return actions.some((action) => action?.type === "openGraphRun" && Boolean(normalizeId(action.graphRunId)));
}

function resolveHistorySessionTaskRoleUncached(
  input: HistorySessionTaskRoleInput,
): HistorySessionTaskRole | null {
  const messages = input.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const loopTaskId = normalizeId(message.loopTaskId);
    const taskRole = message.taskRole === "main" || message.taskRole === "subtask"
      ? message.taskRole
      : null;
    if (loopTaskId && taskRole) {
      return taskRole;
    }
    if (messageGraphNodeId(message)) {
      return "subtask";
    }
    if (messageHasGraphRun(message)) {
      return "main";
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
  if (input.isLoopMainSession || input.isGraphMainSession) {
    return "main";
  }
  return null;
}

export function resolveHistorySessionTaskRole(
  input: HistorySessionTaskRoleInput,
): HistorySessionTaskRole | null {
  const messages = input.messages ?? [];
  const isLoopMainSession = Boolean(input.isLoopMainSession);
  const isGraphMainSession = Boolean(input.isGraphMainSession);
  if (messages.length > 0) {
    const cached = historySessionTaskRoleCache.get(messages);
    if (
      cached
      && cached.isLoopMainSession === isLoopMainSession
      && cached.isGraphMainSession === isGraphMainSession
    ) {
      return cached.role;
    }
  }
  const role = resolveHistorySessionTaskRoleUncached({
    isLoopMainSession,
    isGraphMainSession,
    messages,
  });
  if (messages.length > 0) {
    historySessionTaskRoleCache.set(messages, {
      isLoopMainSession,
      isGraphMainSession,
      role,
    });
  }
  return role;
}
