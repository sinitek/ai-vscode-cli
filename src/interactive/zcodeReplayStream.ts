import { readZcodeRecord, readZcodeSessionEvent, readZcodeTextDelta, type ZcodeSessionEvent, type ZcodeWireMessage } from "./zcodeAppServerProtocol";

const REPLAY_FLUSH_INTERVAL_MS = 1000;
const REPLAY_MAX_TEXT_BYTES = 32 * 1024;
const TRANSPORT_FIELDS = new Set(["seq", "eventId", "timestamp"]);
const TEXT_FIELDS = new Set(["assistantMessageId", "kind", "field", "delta", "done"]);
const TOOL_STREAM_FIELDS = new Set(["assistantMessageId", "kind", "toolCallId", "toolName", "delta", "done", "input"]);
const TOOL_PROGRESS_FIELDS = new Set([
  "kind", "toolCallId", "assistantMessageId", "toolName", "input", "dependencies", "parallelGroupIndex",
  "canRunParallel", "schedule", "inputByteLength", "inputOmitted", "inputRef", "startedAt", "readOnly", "sideEffectScope",
]);
const MODEL_REQUEST_FIELDS = new Set([
  "type", "baseURL", "maxAttempts", "providerId", "modelId", "modelRequestSessionType", "requestId", "sessionId", "spanId",
  "parentSpanId", "querySource", "queryId", "traceId", "providerKind", "transport", "turnId", "modelCall", "attempt",
  "requestHeaderCount", "requestHeaders", "timestamp", "_meta", "durationMs", "responseHeaderCount", "responseHeaders",
  "providerRequestId", "finishReason", "usage", "timeToFirstProviderEventMs", "timeToFirstContentMs", "timeToFirstTextMs",
  "streamStallCount", "streamOutputCommitted",
]);
const MODEL_SUMMARY_FIELDS = new Set(["content", "contextWindow", "querySource", "stopReason", "usage", "cacheHit", "contextUsageBreakdown", "toolCallCount"]);
const COMPLETED_MODEL_REASONS = new Set(["stop", "tool-calls"]);
const SNAPSHOT_FIELDS = new Map([
  ["session.titleUpdated", new Set(["previousTitle", "source", "title"])],
  ["session.updated", new Set(["messageCount", "providerId", "modelId", "toolCount", "iteration"])],
]);

type ReplayText = {
  message: ZcodeWireMessage;
  payload: Record<string, unknown> & { delta: string };
  signature: string;
  bytes: number;
};

type ReplayTool = {
  name: string;
  inputText: string;
  input: unknown;
  hasInput: boolean;
  pendingInput: ZcodeWireMessage | null;
  lastStart: string | null;
  lastResult: string | null;
  terminal: boolean;
};

export class ZcodeReplayStream {
  private pendingText: ReplayText | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly tools = new Map<string, ReplayTool>();
  private readonly assistantText = new Map<string, { messageId: unknown; text: string }>();
  private finished = false;

  public constructor(private readonly emit: (message: ZcodeWireMessage) => void) {}

  public append(message: ZcodeWireMessage): void {
    if (this.finished) {
      return;
    }
    const event = readZcodeSessionEvent(message);
    if (event) {
      const delta = readZcodeTextDelta(event);
      if (delta?.field === "text") {
        const key = this.turnKey(message, event);
        const previous = this.assistantText.get(key);
        const messageId = event.payload.assistantMessageId;
        this.assistantText.set(key, { messageId, text: (previous && previous.messageId === messageId ? previous.text : "") + delta.delta });
      }
      if (this.isRedundantModelSnapshot(message, event)) {
        return;
      }
    }
    const snapshotFields = event ? SNAPSHOT_FIELDS.get(event.type) : null;
    if (event && snapshotFields && Object.keys(event.payload).every((key) => snapshotFields.has(key))) {
      return;
    }
    if (event && this.isRedundantToolNotification(message, event)) {
      return;
    }
    if (event && this.appendTool(message, event)) {
      return;
    }
    const text = event ? readReplayText(message, event) : null;
    if (text) {
      if (this.pendingText && (
        this.pendingText.signature !== text.signature
        || this.pendingText.bytes + text.bytes > REPLAY_MAX_TEXT_BYTES
      )) {
        this.flush();
      }
      if (this.pendingText) {
        text.payload.delta = this.pendingText.payload.delta + text.payload.delta;
        text.bytes += this.pendingText.bytes;
      }
      this.pendingText = text.payload.delta ? text : null;
      if (event?.payload.done === true || text.bytes >= REPLAY_MAX_TEXT_BYTES) {
        this.flush();
      } else if (this.pendingText && !this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), REPLAY_FLUSH_INTERVAL_MS);
        this.flushTimer.unref();
      }
      return;
    }
    this.flush();
    if (event?.type === "turn.completed" || event?.type === "turn.failed") {
      this.flushToolInputs();
    }
    if (event?.type === "turn.started" && "input" in event.payload) {
      this.emit(withPayload(message, event.type, withoutFields(event.payload, new Set(["input"]))));
      return;
    }
    this.emit(message);
  }

  public flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const text = this.pendingText;
    this.pendingText = null;
    if (text) {
      this.emit(text.message);
    }
  }

  public finish(): void {
    if (this.finished) {
      return;
    }
    this.flush();
    this.flushToolInputs();
    this.tools.clear();
    this.assistantText.clear();
    this.finished = true;
  }

  private flushToolInputs(): void {
    for (const tool of this.tools.values()) {
      if (tool.pendingInput) {
        this.emitToolStart(tool.pendingInput, tool);
      }
    }
  }

  private appendTool(message: ZcodeWireMessage, event: ZcodeSessionEvent): boolean {
    const payload = event.payload;
    const kind = typeof payload.kind === "string" ? payload.kind : "";
    const streaming = event.type === "model.streaming" && ["tool_input_start", "tool_input_delta", "tool_input_end", "tool_call"].includes(kind);
    const lifecycle = event.type === "tool.updated" && ["scheduled", "started", "result"].includes(kind);
    if ((!streaming && !lifecycle) || typeof payload.toolCallId !== "string" || !payload.toolCallId) {
      return false;
    }
    const key = JSON.stringify([event.sessionId, readZcodeRecord(message.params)?.turnId ?? "", payload.toolCallId]);
    let tool = this.tools.get(key);
    if (!tool) {
      tool = { name: "", inputText: "", input: undefined, hasInput: false, pendingInput: null, lastStart: null, lastResult: null, terminal: false };
      this.tools.set(key, tool);
    }
    if (tool.terminal && kind !== "result") {
      return Object.keys(payload).every((field) => (lifecycle ? TOOL_PROGRESS_FIELDS : TOOL_STREAM_FIELDS).has(field));
    }
    if (lifecycle && kind !== "result" && tool.lastStart && (
      Object.keys(payload).every((field) => TOOL_PROGRESS_FIELDS.has(field))
      && (!payload.toolName || payload.toolName === tool.name)
      && (!("input" in payload) || tool.hasInput && stableSerialize(payload.input) === stableSerialize(tool.input))
      && (payload.inputOmitted !== true || tool.hasInput)
    )) {
      return true;
    }
    if (streaming && kind !== "tool_call" && Object.keys(payload).some((field) => !TOOL_STREAM_FIELDS.has(field))) {
      return false;
    }
    if (typeof payload.toolName === "string" && payload.toolName) {
      tool.name = payload.toolName;
    }
    if (kind === "result") {
      this.flush();
      if (tool.pendingInput) {
        this.emitToolStart(tool.pendingInput, tool);
      }
      const signature = replaySignature(message);
      if (signature !== tool.lastResult) {
        this.emit(message);
        tool.lastResult = signature;
      }
      tool.terminal = true;
      return true;
    }
    if (kind === "tool_input_start") {
      this.flush();
      tool.inputText = "";
      tool.hasInput = false;
      tool.pendingInput = message;
      return true;
    }
    if (kind === "tool_input_delta") {
      if (typeof payload.delta !== "string") {
        return false;
      }
      tool.inputText += payload.delta;
      tool.pendingInput = message;
      return true;
    }
    if ("input" in payload) {
      tool.input = payload.input;
      tool.hasInput = true;
    }
    this.flush();
    this.emitToolStart(message, tool);
    return true;
  }

  private emitToolStart(message: ZcodeWireMessage, tool: ReplayTool): void {
    const event = readZcodeSessionEvent(message);
    if (!event) {
      return;
    }
    if (!tool.hasInput && tool.inputText) {
      try {
        tool.input = JSON.parse(tool.inputText);
      } catch {
        tool.input = tool.inputText;
      }
      tool.hasInput = true;
    }
    const payload = {
      ...withoutFields(event.payload, new Set(["delta"])),
      kind: "tool_call",
      ...(tool.name ? { toolName: tool.name } : {}),
      ...(tool.hasInput ? { input: tool.input } : {}),
    };
    const start = withPayload(message, "model.streaming", payload);
    const signature = replaySignature(start);
    if (signature !== tool.lastStart) {
      this.emit(start);
      tool.lastStart = signature;
    }
    tool.pendingInput = null;
  }

  private isRedundantToolNotification(message: ZcodeWireMessage, event: ZcodeSessionEvent): boolean {
    const payload = event.payload;
    let ids: unknown;
    let knownFields: string[];
    if (event.type === "tool.updated" && payload.kind === "batch" && payload.errorCount === 0) {
      ids = payload.toolCallIds;
      if (!Array.isArray(ids) || payload.successCount !== ids.length) {
        return false;
      }
      knownFields = ["kind", "toolCallIds", "successCount", "errorCount"];
    } else if (event.type === "streamRecovery.updated" && payload.kind === "tool_result") {
      ids = payload.committedToolCallIds;
      knownFields = ["kind", "anchorId", "attemptId", "assistantMessageId", "toolCallId", "toolName", "resultPartId", "committedToolCallIds", "committedAt"];
      if (!Array.isArray(ids) || !ids.includes(payload.toolCallId)) {
        return false;
      }
    } else {
      return false;
    }
    return Array.isArray(ids) && ids.length > 0
      && Object.keys(payload).every((key) => knownFields.includes(key))
      && ids.every((id) => typeof id === "string" && this.tools.get(JSON.stringify([
        event.sessionId, readZcodeRecord(message.params)?.turnId ?? "", id,
      ]))?.terminal);
  }

  private isRedundantModelSnapshot(message: ZcodeWireMessage, event: ZcodeSessionEvent): boolean {
    if (event.type !== "session.updated") {
      return false;
    }
    const payload = event.payload;
    if (payload.type === "model_request_started" || payload.type === "model_request_completed") {
      return payload.attempt === 1
        && (payload.type === "model_request_started" || COMPLETED_MODEL_REASONS.has(String(payload.finishReason)))
        && !(typeof payload.streamStallCount === "number" && payload.streamStallCount > 0)
        && readZcodeRecord(payload.modelCall)?.actorKind === "main"
        && Object.keys(payload).every((key) => MODEL_REQUEST_FIELDS.has(key));
    }
    if (typeof payload.content === "string" && COMPLETED_MODEL_REASONS.has(String(payload.stopReason))
      && Object.keys(payload).every((key) => MODEL_SUMMARY_FIELDS.has(key))) {
      const key = this.turnKey(message, event);
      const redundant = !payload.content || payload.content === this.assistantText.get(key)?.text;
      this.assistantText.delete(key);
      if (redundant) {
        this.flush();
      }
      return redundant;
    }
    return false;
  }

  private turnKey(message: ZcodeWireMessage, event: ZcodeSessionEvent): string {
    return JSON.stringify([event.sessionId, readZcodeRecord(message.params)?.turnId ?? ""]);
  }
}

function readReplayText(message: ZcodeWireMessage, event: ZcodeSessionEvent): ReplayText | null {
  const payload = event.payload;
  const streaming = event.type === "model.streaming" && (payload.kind === "text_delta" || payload.kind === "reasoning_delta");
  const legacy = event.type === "part.delta" && (payload.field === undefined || payload.field === "text" || payload.field === "reasoning");
  if ((!streaming && !legacy) || typeof payload.delta !== "string") {
    return null;
  }
  if (!payload.delta && Object.keys(payload).some((key) => !TEXT_FIELDS.has(key))) {
    return null;
  }
  const content = { ...payload, delta: payload.delta };
  const replayMessage = withPayload(message, event.type, content);
  return {
    message: replayMessage,
    payload: content,
    signature: replaySignature(withPayload(message, event.type, withoutFields(payload, new Set(["delta", "done"])))),
    bytes: Buffer.byteLength(payload.delta, "utf8"),
  };
}

function withPayload(message: ZcodeWireMessage, type: string, payload: Record<string, unknown>): ZcodeWireMessage {
  return { ...message, params: { ...readZcodeRecord(message.params), type, payload } };
}

function replaySignature(message: ZcodeWireMessage): string {
  return stableSerialize({ ...message, params: withoutFields(readZcodeRecord(message.params) ?? {}, TRANSPORT_FIELDS) });
}

function withoutFields(record: Record<string, unknown>, fields: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !fields.has(key)));
}

function stableSerialize(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(normalize);
    }
    const record = readZcodeRecord(item);
    return record ? Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalize(record[key])])) : item;
  };
  return JSON.stringify(normalize(value)) ?? "undefined";
}
