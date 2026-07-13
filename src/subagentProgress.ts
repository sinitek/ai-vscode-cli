import type { ChatMessage } from "./webview/types";

export type SubagentProvider = "opencode" | "codex";
export type SubagentProgressStatus = "running" | "completed" | "failed" | "interrupted";

export type SubagentProgressUpdate = {
  provider: SubagentProvider;
  id: string;
  agentName?: string | null;
  status?: SubagentProgressStatus;
  delta?: string;
  text?: string;
  error?: string | null;
};

export type SubagentProgressLabels = {
  provider: Record<SubagentProvider, string>;
  subagent: string;
  status: Record<SubagentProgressStatus, string>;
  errorPrefix: string;
};

type SubagentBubble = {
  provider: SubagentProvider;
  id: string;
  agentName: string;
  status: SubagentProgressStatus;
  text: string;
  error: string;
  message: ChatMessage;
};

export type SubagentProgressController = {
  update: (update: SubagentProgressUpdate) => void;
  finishRunning: (status: Exclude<SubagentProgressStatus, "running">) => void;
  getMessage: (provider: SubagentProvider, id: string) => ChatMessage | null;
};

function normalizeIdentity(value: unknown): string {
  return String(value || "").trim();
}

function normalizeAgentName(value: unknown): string {
  return normalizeIdentity(value).replace(/\s+/gu, " ").slice(0, 120);
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!>|-])/gu, "\\$1");
}

function renderSubagentBubble(bubble: SubagentBubble, labels: SubagentProgressLabels): string {
  const headerParts = [
    `${labels.provider[bubble.provider]} ${labels.subagent}`,
    bubble.agentName ? escapeMarkdownLabel(bubble.agentName) : "",
    labels.status[bubble.status],
  ].filter(Boolean);
  const bodyParts = [
    bubble.text,
    bubble.error ? `${labels.errorPrefix}${bubble.error}` : "",
  ].filter((part) => part.length > 0);
  const header = `**${headerParts.join(" · ")}**`;
  return bodyParts.length > 0 ? `${header}\n\n${bodyParts.join("\n\n")}` : header;
}

function bubbleKey(provider: SubagentProvider, id: string): string {
  return `${provider}:${id}`;
}

export function createSubagentProgressController(options: {
  labels: SubagentProgressLabels;
  createMessageId: () => string;
  appendMessage: (message: ChatMessage) => void;
  replaceMessage: (message: ChatMessage) => void;
  appendDelta: (messageId: string, content: string) => void;
  messageMetadata?: Partial<ChatMessage>;
  now?: () => number;
}): SubagentProgressController {
  const bubbles = new Map<string, SubagentBubble>();
  const now = options.now ?? Date.now;

  const applyUpdate = (update: SubagentProgressUpdate): void => {
    const id = normalizeIdentity(update.id);
    if (!id) {
      return;
    }
    const key = bubbleKey(update.provider, id);
    const existing = bubbles.get(key);
    const nextAgentName = typeof update.agentName === "undefined"
      ? (existing?.agentName ?? "")
      : normalizeAgentName(update.agentName);
    const nextStatus = update.status ?? existing?.status ?? "running";
    const nextError = typeof update.error === "undefined"
      ? (existing?.error ?? "")
      : normalizeIdentity(update.error);
    const hasSnapshot = typeof update.text === "string";
    const delta = typeof update.delta === "string" ? update.delta : "";
    const nextText = hasSnapshot
      ? update.text ?? ""
      : `${existing?.text ?? ""}${delta}`;

    if (!existing) {
      const message: ChatMessage = {
        ...options.messageMetadata,
        id: options.createMessageId(),
        role: "assistant",
        content: "",
        createdAt: now(),
        merge: false,
        subagentProvider: update.provider,
        subagentId: id,
        subagentStatus: nextStatus,
        ...(nextAgentName ? { subagentName: nextAgentName } : {}),
      };
      const bubble: SubagentBubble = {
        provider: update.provider,
        id,
        agentName: nextAgentName,
        status: nextStatus,
        text: nextText,
        error: nextError,
        message,
      };
      message.content = renderSubagentBubble(bubble, options.labels);
      bubbles.set(key, bubble);
      options.appendMessage(message);
      return;
    }

    const headerChanged = existing.agentName !== nextAgentName || existing.status !== nextStatus;
    const errorChanged = existing.error !== nextError;
    const appendedText = nextText.startsWith(existing.text)
      ? nextText.slice(existing.text.length)
      : "";
    const canAppendDelta = !headerChanged
      && !errorChanged
      && !nextError
      && nextText !== existing.text
      && appendedText.length > 0;

    existing.agentName = nextAgentName;
    existing.status = nextStatus;
    existing.text = nextText;
    existing.error = nextError;
    existing.message.subagentStatus = nextStatus;
    if (nextAgentName) {
      existing.message.subagentName = nextAgentName;
    } else {
      delete existing.message.subagentName;
    }

    if (canAppendDelta) {
      const contentDelta = existing.message.content.endsWith("**") && !nextText.slice(0, -appendedText.length)
        ? `\n\n${appendedText}`
        : appendedText;
      existing.message.content += contentDelta;
      options.appendDelta(existing.message.id, contentDelta);
      return;
    }

    const nextContent = renderSubagentBubble(existing, options.labels);
    if (nextContent === existing.message.content) {
      return;
    }
    existing.message.content = nextContent;
    options.replaceMessage(existing.message);
  };

  return {
    update: applyUpdate,
    finishRunning: (status) => {
      for (const bubble of bubbles.values()) {
        if (bubble.status === "running") {
          applyUpdate({ provider: bubble.provider, id: bubble.id, status });
        }
      }
    },
    getMessage: (provider, id) => bubbles.get(bubbleKey(provider, normalizeIdentity(id)))?.message ?? null,
  };
}
