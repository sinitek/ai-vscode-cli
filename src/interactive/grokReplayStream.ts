import type { GrokJsonRpcMessage } from "./grokAppServerProtocol";
import { GrokToolCallStream, normalizeGrokPlanEntries, type GrokPlanEntry, type GrokToolTrace } from "./grokToolCallStream";

const GROK_REPLAY_FLUSH_INTERVAL_MS = 1000;
const GROK_REPLAY_MAX_TEXT_BYTES = 32 * 1024;
const IGNORED_SESSION_UPDATES = new Set([
  "available_commands_update", "session_info_update", "user_message_chunk", "background_tasks",
  "usage_update", "session_status", "response_started", "response_completed", "turn_usage",
]);
const SNAPSHOT_SESSION_UPDATES = new Set(["tool_call", "tool_call_update", "plan"]);
const TEXT_SESSION_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk"]);
const TRANSPORT_META_FIELDS = new Set(["eventId", "chunkId", "agentTimestampMs"]);

type ReplayText = {
  message: GrokJsonRpcMessage;
  params: Record<string, unknown>;
  content: Record<string, unknown> & { text: string };
  signature: string;
  bytes: number;
};

export class GrokReplayStream {
  private pendingText: ReplayText | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshot: string | null = null;
  private lastPlan: string | null = null;
  private finished = false;
  private readonly tools: GrokToolCallStream;

  public constructor(
    private readonly emit: (message: GrokJsonRpcMessage) => void,
    private readonly handlers: {
      onToolTrace?: (trace: GrokToolTrace) => void;
      onTaskListUpdate?: (entries: GrokPlanEntry[]) => void;
    } = {},
  ) {
    this.tools = new GrokToolCallStream((message) => {
      const params = asRecord(message.params);
      const update = asRecord(params?.update) ?? params;
      if (update?.sessionUpdate === "plan") {
        this.append(message);
      } else {
        this.flush();
        this.emit(message);
      }
    }, handlers.onToolTrace);
  }

  public append(message: GrokJsonRpcMessage): void {
    if (this.finished) {
      return;
    }
    const params = asRecord(message.params);
    const update = asRecord(params?.update) ?? params;
    const updateType = message.method === "session/update" && typeof update?.sessionUpdate === "string"
      ? update.sessionUpdate
      : "";
    if (IGNORED_SESSION_UPDATES.has(updateType)) {
      return;
    }
    if (this.tools.append(message)) {
      return;
    }
    if (updateType === "plan") {
      const entries = normalizeGrokPlanEntries(update?.entries);
      if (entries) {
        const signature = JSON.stringify([params?.sessionId ?? "", entries]);
        if (signature === this.lastPlan) {
          return;
        }
        this.lastPlan = signature;
        this.handlers.onTaskListUpdate?.(entries);
      }
    }
    const text = readReplayText(message, updateType);
    if (text) {
      if (!text.content.text) {
        return;
      }
      if (this.pendingText && (
        this.pendingText.signature !== text.signature
        || this.pendingText.bytes + text.bytes > GROK_REPLAY_MAX_TEXT_BYTES
      )) {
        this.flush();
      }
      this.lastSnapshot = null;
      if (this.pendingText) {
        this.pendingText.content.text += text.content.text;
        this.pendingText.bytes += text.bytes;
        if ("_meta" in text.params) {
          this.pendingText.params._meta = text.params._meta;
        }
      } else {
        this.pendingText = text;
      }
      if (this.pendingText.bytes >= GROK_REPLAY_MAX_TEXT_BYTES) {
        this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), GROK_REPLAY_FLUSH_INTERVAL_MS);
        this.flushTimer.unref();
      }
      return;
    }
    this.flush();
    const canDeduplicate = SNAPSHOT_SESSION_UPDATES.has(updateType) && (
      updateType === "plan" || typeof update?.toolCallId === "string" && update.toolCallId.length > 0
    );
    const snapshot = canDeduplicate ? buildReplaySignature(message) : null;
    if (snapshot !== null && snapshot === this.lastSnapshot) {
      return;
    }
    this.lastSnapshot = snapshot;
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
  }

  public finish(status: "failed" | "cancelled" | "interrupted" = "interrupted"): void {
    if (this.finished) {
      return;
    }
    this.flush();
    this.tools.finish(status);
    this.finished = true;
  }
}

function readReplayText(message: GrokJsonRpcMessage, updateType: string): ReplayText | null {
  if (!TEXT_SESSION_UPDATES.has(updateType)) {
    return null;
  }
  const params = asRecord(message.params);
  const nestedUpdate = asRecord(params?.update);
  const update = nestedUpdate ?? params;
  const sourceContent = asRecord(update?.content);
  if (!sourceContent || sourceContent.type !== "text" || typeof sourceContent.text !== "string") {
    return null;
  }
  if (!sourceContent.text && (
    Object.keys(sourceContent).some((key) => key !== "type" && key !== "text")
    || Object.keys(update ?? {}).some((key) => key !== "sessionUpdate" && key !== "content" && (nestedUpdate !== null || key !== "sessionId"))
    || nestedUpdate !== null && Object.keys(params ?? {}).some((key) => key !== "sessionId" && key !== "update")
    || Object.keys(message).some((key) => key !== "jsonrpc" && key !== "method" && key !== "params")
  )) {
    return null;
  }
  const content = { ...sourceContent, text: "" };
  const replayUpdate = { ...update, content };
  const replayParams = nestedUpdate ? { ...params, update: replayUpdate } : replayUpdate;
  const replayMessage = {
    ...message,
    params: replayParams,
  };
  const signature = buildReplaySignature(replayMessage);
  content.text = sourceContent.text;
  return {
    message: replayMessage,
    params: replayParams,
    content,
    signature,
    bytes: Buffer.byteLength(content.text, "utf8"),
  };
}

function buildReplaySignature(message: GrokJsonRpcMessage): string {
  const params = asRecord(message.params);
  const metadata = asRecord(params?._meta);
  if (!metadata) {
    return JSON.stringify(message);
  }
  return JSON.stringify({
    ...message,
    params: {
      ...params,
      _meta: Object.fromEntries(Object.entries(metadata).filter(([key]) => !TRANSPORT_META_FIELDS.has(key))),
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
