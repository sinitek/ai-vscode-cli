export type ClaudeContextUsageUpdate = {
  sessionId: string;
  tokensInContextWindow: number;
  modelContextWindow: number | null;
  contextWindowSource?: "claude-model-window";
};

type RecordValue = Record<string, unknown>;

type RequestUsage = {
  id: string;
  model: string | null;
  usage: RecordValue | null;
  tokens: number | null;
};

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function contextTokens(usage: RecordValue | null): number | null {
  if (!usage) {
    return null;
  }
  const counts = [
    usage.input_tokens,
    usage.cache_read_input_tokens === undefined ? 0 : usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens === undefined ? 0 : usage.cache_creation_input_tokens,
    usage.output_tokens,
  ];
  if (!counts.every(tokenCount)) {
    return null;
  }
  const total = counts.reduce((sum, count) => sum + count, 0);
  return tokenCount(total) && total > 0 ? total : null;
}

export class ClaudeContextUsageTracker {
  private request: RequestUsage | null = null;
  private finished = false;
  private lastUpdate: ClaudeContextUsageUpdate | null = null;

  public constructor(private sessionId: string | null) {}

  public handle(value: unknown): ClaudeContextUsageUpdate | null {
    const message = record(value);
    if (!message || this.finished
      || (message.parent_tool_use_id !== undefined && message.parent_tool_use_id !== null)) {
      return null;
    }
    if (message.type !== "system" && message.type !== "stream_event"
      && message.type !== "assistant" && message.type !== "result") {
      return null;
    }
    if ((message.type === "stream_event" || message.type === "assistant") && message.parent_tool_use_id !== null) {
      return null;
    }
    const sessionId = nonemptyString(message.session_id);
    if (!sessionId || (this.sessionId !== null && sessionId !== this.sessionId)) {
      return null;
    }
    this.sessionId = sessionId;
    if (message.type === "stream_event") {
      return this.handleStreamEvent(record(message.event), message.api_message_id);
    }
    if (message.type === "assistant" && message.parent_tool_use_id === null) {
      const assistant = record(message.message);
      if (message.error || !assistant) {
        this.request = null;
        return null;
      }
      const id = nonemptyString(assistant.id);
      if (!id) {
        this.request = null;
        return null;
      }
      if (this.request && this.request.tokens === null && this.request.id !== id) {
        return null;
      }
      if (!nonemptyString(assistant.stop_reason)) {
        if (this.request?.id !== id) {
          this.request = { id, model: nonemptyString(assistant.model), usage: record(assistant.usage), tokens: null };
        }
        return null;
      }
      if (this.request?.id === id && this.request.tokens !== null) {
        return null;
      }
      this.request = {
        id,
        model: nonemptyString(assistant.model),
        usage: record(assistant.usage),
        tokens: contextTokens(record(assistant.usage)),
      };
      return this.emit(null);
    }
    if (message.type === "result") {
      this.finished = true;
      const model = this.request?.model;
      const modelUsage = record(message.modelUsage);
      const usage = model && modelUsage && Object.prototype.hasOwnProperty.call(modelUsage, model)
        ? record(modelUsage[model]) : null;
      const window = usage?.contextWindow;
      return this.emit(tokenCount(window) && window > 0 ? window : null);
    }
    return null;
  }

  private handleStreamEvent(event: RecordValue | null, apiMessageId: unknown): ClaudeContextUsageUpdate | null {
    if (event?.type === "message_start") {
      const message = record(event.message);
      const id = nonemptyString(message?.id);
      this.request = id ? {
        id,
        model: nonemptyString(message?.model),
        usage: record(message?.usage),
        tokens: null,
      } : null;
      return null;
    }
    if (event?.type !== "message_delta" || !this.request
      || (apiMessageId !== undefined && apiMessageId !== this.request.id)) {
      return null;
    }
    const usage = record(event.usage);
    if (!usage || !Object.prototype.hasOwnProperty.call(usage, "output_tokens")) {
      return null;
    }
    const mergedUsage = { ...this.request.usage, ...usage };
    for (const field of ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) {
      if (usage[field] === 0 && this.request.usage?.[field] !== undefined) {
        mergedUsage[field] = this.request.usage[field];
      }
    }
    this.request.usage = mergedUsage;
    this.request.tokens = contextTokens(this.request.usage);
    return this.emit(null);
  }

  private emit(modelContextWindow: number | null): ClaudeContextUsageUpdate | null {
    if (!this.sessionId || this.request?.tokens === null || !this.request) {
      return null;
    }
    const update: ClaudeContextUsageUpdate = {
      sessionId: this.sessionId,
      tokensInContextWindow: this.request.tokens,
      modelContextWindow,
      ...(modelContextWindow !== null ? { contextWindowSource: "claude-model-window" as const } : {}),
    };
    if (this.lastUpdate?.tokensInContextWindow === update.tokensInContextWindow
      && this.lastUpdate.modelContextWindow === update.modelContextWindow) {
      return null;
    }
    this.lastUpdate = update;
    return update;
  }
}
