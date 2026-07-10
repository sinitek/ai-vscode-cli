import { normalizeCodexExecItemType } from "./codexAppServerEvents";
import { sanitizeCodexReasoningContent } from "../codexReasoningContent";

export type JsonRpcError = {
  code: number;
  message: string;
};

export type JsonRpcResolution = {
  result?: unknown;
  error?: JsonRpcError;
};

export type CodexTodoListItem = {
  text: string;
  done: boolean;
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function extractDelta(previous: string, next: string): string {
  if (!next) {
    return "";
  }
  if (!previous) {
    return next;
  }
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  const max = Math.min(previous.length, next.length);
  let index = 0;
  for (; index < max; index += 1) {
    if (previous.charCodeAt(index) !== next.charCodeAt(index)) {
      break;
    }
  }
  return next.slice(index);
}

function collectReasoningFragments(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) {
      output.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectReasoningFragments(item, output));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  ["text", "summary", "content", "title"].forEach((key) => {
    if (key in record) {
      collectReasoningFragments(record[key], output);
    }
  });
}

export function extractReasoningText(item: Record<string, unknown>): string {
  const fragments: string[] = [];
  collectReasoningFragments(item.text, fragments);
  collectReasoningFragments(item.summary, fragments);
  collectReasoningFragments(item.content, fragments);
  if (!fragments.length) {
    return "";
  }
  const sanitizedFragments = fragments
    .map((value) => sanitizeCodexReasoningContent(value))
    .filter(Boolean);
  return sanitizedFragments
    .filter((value, index) => sanitizedFragments.indexOf(value) === index)
    .join("\n")
    .trim();
}

export function normalizeTodoListItems(items: unknown[]): CodexTodoListItem[] {
  return items
    .map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const text = typeof record.text === "string"
        ? record.text.trim()
        : typeof record.step === "string"
          ? record.step.trim()
          : "";
      if (!text) {
        return null;
      }
      const done = record.completed === true || String(record.status || "").trim() === "completed";
      return { text, done };
    })
    .filter((item): item is CodexTodoListItem => Boolean(item));
}

export function extractItemErrorMessage(item: Record<string, unknown>): string {
  const error = item.error;
  if (typeof error === "string") {
    return error.trim();
  }
  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const preferred = String(details.message || details.detail || details.reason || "").trim();
    if (preferred) {
      return preferred;
    }
    return safeStringify(details);
  }
  return "";
}

function toExecLikeWebSearchAction(action: unknown): unknown {
  if (!action || typeof action !== "object") {
    return action;
  }
  const normalized = action as Record<string, unknown>;
  const type = String(normalized.type || "").trim();
  if (type === "openPage") {
    return { type: "open_page", url: normalized.url ?? null };
  }
  if (type === "findInPage") {
    return { type: "find_in_page", url: normalized.url ?? null, pattern: normalized.pattern ?? null };
  }
  if (!type) {
    return normalized;
  }
  return {
    ...normalized,
    type: type === "other" ? "other" : "search",
  };
}

function toExecLikeItemType(type: unknown): string {
  return normalizeCodexExecItemType(type);
}

export function toExecLikeItem(item: unknown): Record<string, unknown> {
  const normalized = item && typeof item === "object"
    ? { ...(item as Record<string, unknown>) }
    : {};
  normalized.type = toExecLikeItemType(normalized.type);
  if (normalized.action) {
    normalized.action = toExecLikeWebSearchAction(normalized.action);
  }
  if (typeof normalized.aggregated_output === "undefined" && typeof normalized.aggregatedOutput !== "undefined") {
    normalized.aggregated_output = normalized.aggregatedOutput;
  }
  if (typeof normalized.exit_code === "undefined" && typeof normalized.exitCode !== "undefined") {
    normalized.exit_code = normalized.exitCode;
  }
  if (typeof normalized.duration_ms === "undefined" && typeof normalized.durationMs !== "undefined") {
    normalized.duration_ms = normalized.durationMs;
  }
  if (!normalized.error || typeof normalized.error !== "string") {
    const extractedError = extractItemErrorMessage(normalized);
    if (extractedError) {
      normalized.error = extractedError;
    }
  }
  return normalized;
}

export function shouldSuppressRawEvent(method: string): boolean {
  const normalized = method.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.endsWith("/delta") || normalized.endsWith("delta");
}

function normalizeRawEventItemType(type: unknown): string {
  return toExecLikeItemType(type).trim().toLowerCase();
}

function normalizeForwardedItem(rawItem: unknown): Record<string, unknown> {
  const item = toExecLikeItem(rawItem);
  const itemType = normalizeRawEventItemType(item.type);
  if (itemType === "reasoning") {
    const text = extractReasoningText(item);
    if (text) {
      item.text = text;
    }
  }
  return item;
}

export function buildForwardedRawEvent(message: Record<string, unknown>): Record<string, unknown> | null {
  const method = String(message.method || "").trim();
  if (!method || shouldSuppressRawEvent(method)) {
    return null;
  }

  if (method.startsWith("codex/event/")) {
    return null;
  }

  const params = message.params && typeof message.params === "object"
    ? message.params as Record<string, unknown>
    : {};

  if (method === "thread/started") {
    const thread = params.thread && typeof params.thread === "object"
      ? params.thread as Record<string, unknown>
      : {};
    const threadId = String(thread.id || "").trim();
    return threadId ? { type: "thread.started", thread_id: threadId } : { type: "thread.started" };
  }

  if (method === "turn/plan/updated") {
    return {
      type: "turn.plan.updated",
      turnId: String(params.turnId || "").trim(),
      threadId: String(params.threadId || "").trim(),
      explanation: params.explanation ?? null,
      plan: Array.isArray(params.plan) ? params.plan : [],
    };
  }

  if (method === "turn/completed") {
    const turn = params.turn && typeof params.turn === "object"
      ? params.turn as Record<string, unknown>
      : {};
    return {
      type: "turn.completed",
      status: String(turn.status || "").trim() || "completed",
      usage: turn.tokenUsage ?? params.tokenUsage ?? null,
    };
  }

  if (method === "error") {
    const msg = String(params.message || "").trim();
    if (!msg) {
      return null;
    }
    return { type: "error", message: msg };
  }

  if (method === "rawResponseItem/completed") {
    const rawItem = params.item && typeof params.item === "object"
      ? params.item as Record<string, unknown>
      : {};
    return {
      type: "raw_response_item.completed",
      item: rawItem,
    };
  }

  if (method !== "item/started" && method !== "item/completed") {
    return null;
  }

  const rawItem = params.item && typeof params.item === "object"
    ? params.item as Record<string, unknown>
    : {};
  const item = normalizeForwardedItem(rawItem);
  const itemType = normalizeRawEventItemType(item.type);

  const allowStarted = itemType === "command_execution"
    || itemType === "mcp_tool_call"
    || itemType === "web_search"
    || itemType === "file_change"
    || itemType === "todo_list"
    || itemType === "collab_agent_tool_call";
  const allowCompleted = itemType === "reasoning"
    || itemType === "agent_message"
    || itemType === "command_execution"
    || itemType === "mcp_tool_call"
    || itemType === "web_search"
    || itemType === "file_change"
    || itemType === "todo_list"
    || itemType === "error"
    || itemType === "collab_agent_tool_call"
    || itemType === "dynamic_tool_call";

  if (method === "item/started" && !allowStarted) {
    return null;
  }
  if (method === "item/completed" && !allowCompleted) {
    return null;
  }

  return {
    type: method === "item/started" ? "item.started" : "item.completed",
    item,
  };
}

export function buildTurnFailureMessage(params: unknown, fallbackMessage: string): string {
  const turn = params && typeof params === "object"
    ? (params as Record<string, unknown>).turn as Record<string, unknown> | undefined
    : undefined;
  const error = turn?.error && typeof turn.error === "object"
    ? turn.error as Record<string, unknown>
    : undefined;
  const preferred = String(error?.message || error?.additionalDetails || "").trim();
  return preferred || fallbackMessage;
}

export function buildAppServerRequestResolution(method: string, unsupportedMessage: string): JsonRpcResolution {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return { result: { decision: "decline" } };
    case "item/fileChange/requestApproval":
      return { result: { decision: "decline" } };
    case "item/permissions/requestApproval":
      return { result: { permissions: {}, scope: "turn" } };
    case "item/tool/requestUserInput":
      return { result: { answers: {} } };
    case "mcpServer/elicitation/request":
      return { result: { action: "cancel", content: null, _meta: null } };
    case "applyPatchApproval":
      return { result: { decision: "denied" } };
    case "execCommandApproval":
      return { result: { decision: "denied" } };
    default:
      return {
        error: {
          code: -32601,
          message: unsupportedMessage,
        },
      };
  }
}
