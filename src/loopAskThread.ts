import * as fs from "fs";
import * as path from "path";
import type { ChatMessage } from "./webview/types";

export const LOOP_ASK_THREAD_FILENAME = "ask-thread.json";
export const LOOP_ASK_THREAD_VERSION = 1;
const MAX_ASK_MESSAGES = 200;

export type LoopAskBubbleRole = "user" | "thinking" | "assistant" | "system";

export type LoopAskBubble = {
  id: string;
  role: LoopAskBubbleRole;
  content: string;
  createdAt: number;
  streaming?: boolean;
};

export type LoopAskThread = {
  version: 1;
  messages: LoopAskBubble[];
  running: boolean;
  dialogOpen: boolean;
  updatedAt: number;
};

const ROLES = new Set<LoopAskBubbleRole>(["user", "thinking", "assistant", "system"]);

export function createEmptyLoopAskThread(now = 0): LoopAskThread {
  return {
    version: LOOP_ASK_THREAD_VERSION,
    messages: [],
    running: false,
    dialogOpen: false,
    updatedAt: now,
  };
}

export function loopAskThreadPath(communicationDir: string): string {
  return path.join(communicationDir, LOOP_ASK_THREAD_FILENAME);
}

export function parseLoopAskThread(raw: string): LoopAskThread | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Partial<LoopAskThread>;
  if (record.version !== LOOP_ASK_THREAD_VERSION || !Array.isArray(record.messages)) {
    return null;
  }
  const messages: LoopAskBubble[] = [];
  for (const item of record.messages) {
    const bubble = parseBubble(item);
    if (!bubble) {
      return null;
    }
    messages.push(bubble);
  }
  return normalizeThread({
    version: LOOP_ASK_THREAD_VERSION,
    messages,
    running: record.running === true,
    dialogOpen: record.dialogOpen === true,
    updatedAt: finiteTime(record.updatedAt),
  });
}

export function serializeLoopAskThread(thread: LoopAskThread): string {
  return JSON.stringify(normalizeThread(thread), null, 2);
}

export function readLoopAskThreadFile(filePath: string): LoopAskThread {
  try {
    if (!filePath.trim() || !fs.existsSync(filePath)) {
      return createEmptyLoopAskThread();
    }
    return parseLoopAskThread(fs.readFileSync(filePath, "utf8")) ?? createEmptyLoopAskThread();
  } catch {
    return createEmptyLoopAskThread();
  }
}

export function writeLoopAskThreadFile(filePath: string, thread: LoopAskThread): void {
  if (!filePath.trim()) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeLoopAskThread(thread), "utf8");
}

export function beginLoopAskTurn(
  thread: LoopAskThread,
  question: string,
  now: number,
  id: string,
): LoopAskThread {
  const content = question.trim();
  return normalizeThread({
    ...thread,
    running: true,
    dialogOpen: true,
    updatedAt: now,
    messages: [
      ...thread.messages.filter((message) => !message.streaming),
      { id, role: "user", content, createdAt: now },
      { id: `${id}:thinking`, role: "thinking", content: "", createdAt: now, streaming: true },
    ],
  });
}

export function setLoopAskDialogOpen(thread: LoopAskThread, dialogOpen: boolean, now: number): LoopAskThread {
  return normalizeThread({
    ...thread,
    dialogOpen,
    updatedAt: now,
  });
}

export function applyLoopAskThinking(
  thread: LoopAskThread,
  before: readonly ChatMessage[],
  current: readonly ChatMessage[],
  now: number,
): LoopAskThread {
  if (!thread.running) {
    return thread;
  }
  const history = historyBeforeActiveTurn(thread.messages);
  const thinking = projectLoopAskThinking(before, current).map((bubble) => ({
    id: bubble.id,
    role: "thinking" as const,
    content: bubble.content,
    createdAt: now,
    streaming: true,
  }));
  const messages = thinking.length > 0
    ? [...history, ...thinking]
    : [
      ...history,
      {
        id: `${history[history.length - 1]?.id || "ask"}:thinking`,
        role: "thinking" as const,
        content: "",
        createdAt: now,
        streaming: true,
      },
    ];
  return normalizeThread({
    ...thread,
    messages,
    running: true,
    updatedAt: now,
  });
}

export function settleLoopAskTurn(
  thread: LoopAskThread,
  input: {
    answer?: string | null;
    notice?: string | null;
    now: number;
    noticeId: string;
  },
): LoopAskThread {
  const messages = thread.messages
    .map((message) => (
      message.role === "thinking"
        ? { ...message, streaming: false }
        : message
    ))
    .filter((message) => message.role !== "thinking" || message.content.trim().length > 0);
  const answer = input.answer?.trim() ?? "";
  const notice = input.notice?.trim() ?? "";
  if (answer) {
    messages.push({
      id: input.noticeId,
      role: "assistant",
      content: answer,
      createdAt: input.now,
    });
  } else if (notice) {
    messages.push({
      id: input.noticeId,
      role: "system",
      content: notice,
      createdAt: input.now,
    });
  }
  return normalizeThread({
    ...thread,
    messages,
    running: false,
    updatedAt: input.now,
  });
}

export function isLoopAskThinkingMessage(message: ChatMessage): boolean {
  if (!message || message.role === "user" || message.role === "system" || message.kind === "tool-use") {
    return false;
  }
  if (message.kind === "thinking") {
    return true;
  }
  const content = message.content ?? "";
  if (/^(?:thinking|思考)(?=\s|[:：]|$)/iu.test(content.trim())) {
    return true;
  }
  return message.role !== "trace" && isCodexReasoningStyleContent(content);
}

export function projectLoopAskThinking(
  before: readonly ChatMessage[],
  current: readonly ChatMessage[],
): Array<{ id: string; content: string }> {
  const beforeById = new Map(before.map((message) => [message.id, message]));
  const bubbles: Array<{ id: string; content: string }> = [];
  for (const message of current) {
    if (!message?.id || !isLoopAskThinkingMessage(message)) {
      continue;
    }
    const previous = beforeById.get(message.id);
    if (previous && previous.content === message.content && previous.kind === message.kind) {
      continue;
    }
    const content = thinkingBody(message.content || "");
    if (!content) {
      continue;
    }
    bubbles.push({ id: message.id, content });
  }
  return bubbles;
}

function historyBeforeActiveTurn(messages: readonly LoopAskBubble[]): LoopAskBubble[] {
  let lastUser = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      lastUser = index;
    }
  }
  if (lastUser < 0) {
    return [];
  }
  return messages.slice(0, lastUser + 1);
}

function thinkingBody(content: string): string {
  return content.replace(/^(?:thinking|思考)(?=\s|[:：]|$)\s*[:：]?\s*/iu, "").trim();
}

function isCodexReasoningStyleContent(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("**")) {
    return false;
  }
  const titleEnd = trimmed.indexOf("**", 2);
  if (titleEnd <= 2) {
    return false;
  }
  const title = trimmed.slice(2, titleEnd).trim();
  if (!title || !/[A-Za-z]/u.test(title)) {
    return false;
  }
  const firstWord = title.split(/\s+/u)[0] || "";
  if (!/ing$/iu.test(firstWord)) {
    return false;
  }
  return /\S/u.test(trimmed.slice(titleEnd + 2));
}

function parseBubble(value: unknown): LoopAskBubble | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<LoopAskBubble>;
  if (typeof record.id !== "string" || !record.id.trim()) {
    return null;
  }
  if (typeof record.role !== "string" || !ROLES.has(record.role as LoopAskBubbleRole)) {
    return null;
  }
  if (typeof record.content !== "string") {
    return null;
  }
  return {
    id: record.id,
    role: record.role as LoopAskBubbleRole,
    content: record.content,
    createdAt: finiteTime(record.createdAt),
    ...(record.streaming === true ? { streaming: true } : {}),
  };
}

function finiteTime(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeThread(thread: LoopAskThread): LoopAskThread {
  return {
    version: LOOP_ASK_THREAD_VERSION,
    messages: thread.messages.slice(-MAX_ASK_MESSAGES),
    running: thread.running === true,
    dialogOpen: thread.dialogOpen === true,
    updatedAt: finiteTime(thread.updatedAt),
  };
}
