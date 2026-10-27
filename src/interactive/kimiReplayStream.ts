import { acceptKimiIncrementalText, type KimiJsonRpcMessage } from "./kimiAppServerProtocol";

const KIMI_REPLAY_FLUSH_INTERVAL_MS = 1000;
const KIMI_REPLAY_MAX_TEXT_BYTES = 32 * 1024;
const KIMI_REPLAY_MAX_TOOL_OUTPUT_BYTES = 32 * 1024;
const TRANSPORT_META_FIELDS = new Set(["eventId", "chunkId", "agentTimestampMs"]);
const IGNORED_SESSION_UPDATES = new Set([
  "agent_thought_chunk",
  "available_commands_update",
  "session_info_update",
  "usage_update",
]);

type ReplayText = {
  message: KimiJsonRpcMessage;
  content: Record<string, unknown> & { text: string };
  sourceText: string;
  signature: string;
  bytes: number;
};

type ReplayTool = {
  message: KimiJsonRpcMessage;
  content: Record<string, unknown>;
  sourceText: string;
  text: string;
  bytes: number;
};

export class KimiReplayStream {
  private pendingText: ReplayText | null = null;
  private readonly pendingTools = new Map<string, ReplayTool>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly textTracker = new Map<string, string>();
  private readonly toolSnapshots = new Map<string, string>();
  private readonly toolStates = new Map<string, Record<string, unknown>>();
  private readonly planSnapshots = new Map<string, string>();
  private finished = false;

  public constructor(private readonly emit: (message: KimiJsonRpcMessage) => void) {}

  public append(message: KimiJsonRpcMessage): void {
    if (this.finished) {
      return;
    }
    const params = asRecord(message.params);
    const update = asRecord(params?.update);
    const updateType = message.method === "session/update" && typeof update?.sessionUpdate === "string"
      ? update.sessionUpdate
      : "";
    if (IGNORED_SESSION_UPDATES.has(updateType)) {
      return;
    }
    if (updateType === "tool_call" || updateType === "tool_call_update") {
      const toolCallId = typeof update?.toolCallId === "string" ? update.toolCallId : "";
      if (!toolCallId) {
        return;
      }
      const snapshot = stableSerialize(message);
      if (this.toolSnapshots.get(toolCallId) === snapshot) {
        return;
      }
      if (this.appendToolUpdate(toolCallId, message, params, update ?? {}, updateType)) {
        return;
      }
      const previousState = this.toolStates.get(toolCallId);
      const nextState = mergeToolState(previousState, update ?? {});
      if (
        updateType === "tool_call_update"
        && isRedundantIntermediateToolUpdate(update, previousState, nextState)
      ) {
        return;
      }
      this.toolSnapshots.set(toolCallId, snapshot);
      this.toolStates.set(toolCallId, nextState);
    }
    if (updateType === "plan" || updateType === "plan_update") {
      const plan = asRecord(update?.plan) ?? update;
      const sessionId = typeof params?.sessionId === "string" ? params.sessionId : "";
      const planId = typeof plan?.planId === "string" ? plan.planId : "";
      const key = JSON.stringify([sessionId, planId]);
      const snapshot = stableSerialize(message);
      if (this.planSnapshots.get(key) === snapshot) {
        return;
      }
      this.planSnapshots.set(key, snapshot);
    }
    const text = updateType === "agent_message_chunk" ? readReplayText(message, params, update) : null;
    if (text) {
      const messageId = readReplayMessageId(params, update) ?? "assistant";
      const delta = acceptKimiIncrementalText(this.textTracker, messageId, text.sourceText);
      if (!delta) {
        return;
      }
      const deltaBytes = Buffer.byteLength(delta, "utf8");
      if (this.pendingText && (
        this.pendingText.signature !== text.signature
        || this.pendingText.bytes + deltaBytes > KIMI_REPLAY_MAX_TEXT_BYTES
      )) {
        this.flush();
      }
      if (this.pendingText) {
        text.content.text = this.pendingText.content.text + delta;
        text.bytes = this.pendingText.bytes + deltaBytes;
        this.pendingText = text;
      } else {
        text.content.text = delta;
        text.bytes = deltaBytes;
        this.pendingText = text;
      }
      if (this.pendingText.bytes >= KIMI_REPLAY_MAX_TEXT_BYTES) {
        this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), KIMI_REPLAY_FLUSH_INTERVAL_MS);
        this.flushTimer.unref();
      }
      return;
    }
    this.flush();
    this.emit(message);
  }

  public flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const pending = this.pendingText;
    this.pendingText = null;
    if (pending) {
      this.emit(pending.message);
    }
    const tools = [...this.pendingTools.values()];
    this.pendingTools.clear();
    for (const tool of tools) {
      tool.content.text = tool.text;
      this.emit(tool.message);
    }
  }

  public finish(): void {
    if (this.finished) {
      return;
    }
    this.flush();
    this.finished = true;
  }

  private appendToolUpdate(
    toolCallId: string,
    message: KimiJsonRpcMessage,
    params: Record<string, unknown> | null,
    update: Record<string, unknown>,
    updateType: string,
  ): boolean {
    if (!params || updateType !== "tool_call_update" || update.status !== "in_progress") {
      return false;
    }
    const text = readToolText(update.content);
    if (text === null) {
      return false;
    }
    if (update.title !== undefined || update.kind !== undefined || update.rawInput !== undefined) {
      return false;
    }
    const previous = this.pendingTools.get(toolCallId);
    if (previous) {
      const delta = readIncrementalToolText(previous.sourceText, text);
      if (delta === null) {
        return false;
      }
      previous.sourceText = text;
      previous.text += delta;
      previous.bytes += Buffer.byteLength(delta, "utf8");
      if (previous.bytes >= KIMI_REPLAY_MAX_TOOL_OUTPUT_BYTES) {
        this.flushTool(toolCallId);
      }
      return true;
    }
    const content = { type: "content", content: { type: "text", text: "" } };
    this.pendingTools.set(toolCallId, {
      message: {
        ...message,
        params: { ...params, update: { ...update, content: [content] } },
      },
      content: content.content,
      sourceText: text,
      text,
      bytes: Buffer.byteLength(text, "utf8"),
    });
    return true;
  }

  private flushTool(toolCallId: string): void {
    const pending = this.pendingTools.get(toolCallId);
    if (!pending) {
      return;
    }
    this.pendingTools.delete(toolCallId);
    pending.content.text = pending.text;
    this.emit(pending.message);
  }
}

function readToolText(content: unknown): string | null {
  if (!Array.isArray(content) || content.length !== 1) {
    return null;
  }
  const wrapper = asRecord(content[0]);
  const textContent = asRecord(wrapper?.content);
  return wrapper?.type === "content" && textContent?.type === "text" && typeof textContent.text === "string"
    ? textContent.text
    : null;
}

function readIncrementalToolText(previous: string, next: string): string | null {
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  return previous.startsWith(next) ? "" : null;
}

function readReplayText(
  message: KimiJsonRpcMessage,
  params: Record<string, unknown> | null,
  update: Record<string, unknown> | null,
): ReplayText | null {
  const sourceContent = asRecord(update?.content);
  if (!params || !update || !sourceContent || sourceContent.type !== "text" || typeof sourceContent.text !== "string") {
    return null;
  }
  const content = { ...sourceContent, text: "" };
  const replayMessage = {
    ...message,
    params: { ...params, update: { ...update, content } },
  };
  return {
    message: replayMessage,
    content,
    sourceText: sourceContent.text,
    signature: stableSerialize(replayMessage),
    bytes: 0,
  };
}

function readReplayMessageId(
  params: Record<string, unknown> | null,
  update: Record<string, unknown> | null,
): string | null {
  const candidates = [
    update?.messageId,
    asRecord(update?._meta)?.messageId,
    asRecord(params?._meta)?.messageId,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

function isRedundantIntermediateToolUpdate(
  update: Record<string, unknown> | null,
  previousState: Record<string, unknown> | undefined,
  nextState: Record<string, unknown>,
): boolean {
  if (update?.status !== "pending" && update?.status !== "in_progress") {
    return false;
  }
  return previousState !== undefined && stableSerialize(previousState) === stableSerialize(nextState);
}

function mergeToolState(
  previous: Record<string, unknown> | undefined,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const state = { ...previous };
  for (const [key, value] of Object.entries(update)) {
    if (key === "sessionUpdate" || key === "status" || key === "_meta") {
      continue;
    }
    if (key === "content" && isEmptyToolContent(value)) {
      continue;
    }
    state[key] = value;
  }
  return state;
}

function isEmptyToolContent(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForStableSerialization(value)) ?? "undefined";
}

function normalizeForStableSerialization(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableSerialization(item));
  }
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (key === "_meta") {
      const metadata = asRecord(value);
      if (!metadata) {
        normalized[key] = normalizeForStableSerialization(value);
        continue;
      }
      const normalizedMetadata: Record<string, unknown> = {};
      for (const metadataKey of Object.keys(metadata).sort()) {
        if (!TRANSPORT_META_FIELDS.has(metadataKey)) {
          normalizedMetadata[metadataKey] = normalizeForStableSerialization(metadata[metadataKey]);
        }
      }
      if (Object.keys(normalizedMetadata).length > 0) {
        normalized[key] = normalizedMetadata;
      }
      continue;
    }
    normalized[key] = normalizeForStableSerialization(value);
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
