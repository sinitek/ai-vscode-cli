import {
  parseOpenCodeVisibleStreamEvents,
  isOpenCodePlaceholderText,
  type OpenCodeVisibleStreamEvent,
} from "./cli/commandRunner";
import { appendBoundedUtf8Text } from "./boundedText";
import type { OpenCodeTaskListItem } from "./cli/openCodeTaskList";
import type { ChatMessage } from "./webview/types";

type OpenCodeAssistantKind = "normal" | "thinking";

export const OPENCODE_TAB_STREAM_JSONL_BUFFER_MAX_BYTES = 64 * 1024;

export type OpenCodeTabStreamMetadata = Pick<
  ChatMessage,
  "taskRole" | "loopTaskId" | "loopRound" | "loopSubtaskId" | "graphRunId" | "graphNodeId"
>;

export type OpenCodeTabStreamState = {
  jsonlBuffer: string;
  activeAssistantMessageId: string | null;
  activeAssistantKind: OpenCodeAssistantKind | null;
  displayedAssistantText: string;
};

export type OpenCodeTabStreamAction =
  | {
      type: "append-assistant-message";
      message: ChatMessage;
    }
  | {
      type: "append-assistant-delta";
      id: string;
      content: string;
      kind?: ChatMessage["kind"];
    }
  | {
      type: "append-trace";
      content: string;
      taskListItems?: OpenCodeTaskListItem[];
    }
  | {
      type: "task-list-update";
      items: OpenCodeTaskListItem[];
    };

export type OpenCodeTabStreamContext = {
  createMessageId: () => string;
  now?: () => number;
  metadata?: OpenCodeTabStreamMetadata;
};

export type OpenCodeTabStreamResult = {
  state: OpenCodeTabStreamState;
  actions: OpenCodeTabStreamAction[];
};

export function createOpenCodeTabStreamState(): OpenCodeTabStreamState {
  return {
    jsonlBuffer: "",
    activeAssistantMessageId: null,
    activeAssistantKind: null,
    displayedAssistantText: "",
  };
}

function appendAssistantContent(
  state: OpenCodeTabStreamState,
  content: string,
  kind: OpenCodeAssistantKind,
  context: OpenCodeTabStreamContext,
): OpenCodeTabStreamAction[] {
  if (!content || isOpenCodePlaceholderText(content)) {
    return [];
  }

  const actions: OpenCodeTabStreamAction[] = [];
  let messageId = state.activeAssistantMessageId;
  if (!messageId || state.activeAssistantKind !== kind) {
    messageId = context.createMessageId();
    const metadata = context.metadata ?? {};
    actions.push({
      type: "append-assistant-message",
      message: {
        id: messageId,
        role: "assistant",
        content: "",
        createdAt: (context.now ?? Date.now)(),
        ...(kind === "thinking" ? { kind: "thinking" as const } : {}),
        ...metadata,
      },
    });
    state.activeAssistantMessageId = messageId;
    state.activeAssistantKind = kind;
  }

  actions.push({
    type: "append-assistant-delta",
    id: messageId,
    content,
    ...(kind === "thinking" ? { kind: "thinking" as const } : {}),
  });
  if (kind === "normal") {
    state.displayedAssistantText += content;
  }
  return actions;
}

function applyOpenCodeVisibleEvent(
  state: OpenCodeTabStreamState,
  event: OpenCodeVisibleStreamEvent,
  context: OpenCodeTabStreamContext,
): OpenCodeTabStreamAction[] {
  const actions: OpenCodeTabStreamAction[] = [];
  if (Array.isArray(event.taskListItems)) {
    actions.push({
      type: "task-list-update",
      items: event.taskListItems,
    });
  }

  if (event.kind === "assistant") {
    actions.push(...appendAssistantContent(state, event.content, "normal", context));
    return actions;
  }
  if (event.kind === "thinking") {
    actions.push(...appendAssistantContent(state, `${event.content}\n`, "thinking", context));
    return actions;
  }

  state.activeAssistantMessageId = null;
  state.activeAssistantKind = null;
  actions.push({
    type: "append-trace",
    content: event.content,
    ...(Array.isArray(event.taskListItems) ? { taskListItems: event.taskListItems } : {}),
  });
  return actions;
}

export function consumeOpenCodeTabStreamChunk(
  currentState: OpenCodeTabStreamState,
  chunk: string,
  flush: boolean,
  context: OpenCodeTabStreamContext,
): OpenCodeTabStreamResult {
  const state: OpenCodeTabStreamState = { ...currentState };
  const combined = state.jsonlBuffer + chunk.replace(/\r\n/g, "\n");
  const lines = combined.split("\n");
  const pendingLine = flush ? "" : (lines.pop() ?? "");
  state.jsonlBuffer = appendBoundedUtf8Text("", pendingLine, OPENCODE_TAB_STREAM_JSONL_BUFFER_MAX_BYTES).text;
  const actions: OpenCodeTabStreamAction[] = [];

  lines.forEach((line) => {
    parseOpenCodeVisibleStreamEvents(line).forEach((event) => {
      actions.push(...applyOpenCodeVisibleEvent(state, event, context));
    });
  });

  return { state, actions };
}

export function appendOpenCodeFinalTextToTabStream(
  currentState: OpenCodeTabStreamState,
  finalText: string,
  context: OpenCodeTabStreamContext,
): OpenCodeTabStreamResult {
  const state: OpenCodeTabStreamState = { ...currentState };
  const normalizedFinalText = finalText.trim();
  if (!normalizedFinalText || isOpenCodePlaceholderText(normalizedFinalText)) {
    return { state, actions: [] };
  }

  const displayedText = state.displayedAssistantText.trim();
  if (displayedText === normalizedFinalText) {
    state.displayedAssistantText = normalizedFinalText;
    return { state, actions: [] };
  }

  const remainingText = displayedText && normalizedFinalText.startsWith(displayedText)
    ? normalizedFinalText.slice(displayedText.length).trimEnd()
    : normalizedFinalText;
  if (!remainingText.trim()) {
    state.displayedAssistantText = normalizedFinalText;
    return { state, actions: [] };
  }

  const finalChunk = remainingText.endsWith("\n") ? remainingText : `${remainingText}\n`;
  const actions = appendAssistantContent(state, finalChunk, "normal", context);
  state.displayedAssistantText = normalizedFinalText;
  return { state, actions };
}
