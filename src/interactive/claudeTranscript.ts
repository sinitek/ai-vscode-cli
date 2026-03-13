import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { formatClaudeToolResultMessage, formatClaudeToolUseMessage } from "../trace/claudeToolFormat";
import { ChatMessage } from "../webview/types";

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const transcriptPathCache = new Map<string, string | null>();

type TranscriptBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
};

type TranscriptEntry = {
  type?: string;
  timestamp?: string;
  message?: {
    id?: string;
    role?: string;
    content?: TranscriptBlock[];
  };
};

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function normalizeThinkingContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /^(?:thinking|思考)\b/i.test(trimmed) ? trimmed : `thinking ${trimmed}`;
}

function stringifyToolResultContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyToolResultContent(item))
      .filter((item) => item.trim().length > 0)
      .join("\n");
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function findClaudeTranscriptPath(sessionId: string): string | null {
  const cached = transcriptPathCache.get(sessionId);
  if (cached !== undefined) {
    return cached;
  }
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    transcriptPathCache.set(sessionId, null);
    return null;
  }
  const fileName = `${sessionId}.jsonl`;
  try {
    for (const entry of fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(CLAUDE_PROJECTS_DIR, entry.name, fileName);
      if (fs.existsSync(candidate)) {
        transcriptPathCache.set(sessionId, candidate);
        return candidate;
      }
    }
  } catch {
    transcriptPathCache.set(sessionId, null);
    return null;
  }
  transcriptPathCache.set(sessionId, null);
  return null;
}

function buildTranscriptMessages(transcriptPath: string): ChatMessage[] {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const messages: ChatMessage[] = [];
  const toolUseNames = new Map<string, string>();
  let nextId = 0;

  const pushMessage = (message: Omit<ChatMessage, "id">): void => {
    if (!message.content.trim()) {
      return;
    }
    messages.push({
      id: `claude_transcript_${nextId += 1}`,
      ...message,
    });
  };

  for (const line of lines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }
    const createdAt = parseTimestamp(entry.timestamp);
    const blocks = Array.isArray(entry.message?.content) ? entry.message?.content : [];

    if (entry.type === "user" && entry.message?.role === "user") {
      for (const block of blocks) {
        if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
          pushMessage({
            role: "user",
            content: block.text,
            createdAt,
            merge: false,
          });
          continue;
        }
        if (block?.type === "tool_result") {
          const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
          const toolName = toolUseId ? toolUseNames.get(toolUseId) : undefined;
          const content = formatClaudeToolResultMessage(
            stringifyToolResultContent(block.content),
            toolName,
          );
          pushMessage({
            role: "trace",
            content,
            createdAt,
            kind: "normal",
            merge: false,
          });
        }
      }
      continue;
    }

    if (entry.type !== "assistant" || entry.message?.role !== "assistant") {
      continue;
    }

    const textParts: string[] = [];
    for (const block of blocks) {
      if (block?.type === "thinking" && typeof block.thinking === "string") {
        const content = normalizeThinkingContent(block.thinking);
        if (content) {
          pushMessage({
            role: "trace",
            content,
            createdAt,
            kind: "thinking",
            merge: false,
          });
        }
        continue;
      }
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        textParts.push(block.text);
        continue;
      }
      if (block?.type === "tool_use") {
        if (typeof block.id === "string" && typeof block.name === "string") {
          toolUseNames.set(block.id, block.name);
        }
        const content = formatClaudeToolUseMessage(block.name, block.input);
        pushMessage({
          role: "trace",
          content,
          createdAt,
          kind: "tool-use",
          merge: false,
        });
      }
    }

    if (textParts.length > 0) {
      pushMessage({
        role: "assistant",
        content: textParts.join("\n\n"),
        createdAt,
      });
    }
  }

  return messages;
}

function mergeSystemMessages(transcriptMessages: ChatMessage[], existingMessages: ChatMessage[]): ChatMessage[] {
  const systemMessages = existingMessages
    .filter((message) => message.role === "system" && message.content.trim())
    .map((message) => ({ ...message }));
  if (systemMessages.length === 0) {
    return transcriptMessages;
  }
  return [...transcriptMessages, ...systemMessages]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTime = left.message.createdAt ?? 0;
      const rightTime = right.message.createdAt ?? 0;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.index - right.index;
    })
    .map(({ message }) => message);
}

export function recoverClaudeMessagesFromTranscript(
  sessionId: string,
  existingMessages: ChatMessage[] = [],
): ChatMessage[] | null {
  const transcriptPath = findClaudeTranscriptPath(sessionId);
  if (!transcriptPath) {
    return null;
  }
  const transcriptMessages = buildTranscriptMessages(transcriptPath);
  if (!transcriptMessages.some((message) => message.role === "assistant" || message.role === "trace")) {
    return null;
  }
  return mergeSystemMessages(transcriptMessages, existingMessages);
}
