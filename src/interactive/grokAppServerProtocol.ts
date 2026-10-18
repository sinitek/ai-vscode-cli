import { mapThinkingModeToGrokEffort, type GrokReasoningEffort } from "../cli/types";
import { isLocalSessionId } from "./sessionHistoryRepair";
import { t } from "../i18n";

export const GROK_PROTOCOL_VERSION = 1;
export const GROK_CLIENT_INFO_VERSION = "0.24.5";
export const GROK_API_KEY_AUTH_METHOD = "xai.api_key";
export const GROK_CACHED_TOKEN_AUTH_METHOD = "cached_token";
export const GROK_ACCOUNT_AUTH_METHOD = "grok.com";
export const GROK_RESPONSES_STREAM_INCOMPATIBLE = "GROK_RESPONSES_STREAM_INCOMPATIBLE";

export type GrokJsonRpcMessage = {
  jsonrpc?: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type GrokLineParseResult =
  | { ok: true; message: GrokJsonRpcMessage }
  | { ok: false; reason: "empty" | "invalid"; error: string };

export type GrokTokenUsageUpdate = {
  tokensInContextWindow: number;
  modelContextWindow: number | null;
};

export function readGrokTokenUsageUpdate(message: GrokJsonRpcMessage, sessionId: string): GrokTokenUsageUpdate | null {
  if (!sessionId || !["session/update", "_x.ai/session_notification", "_x.ai/session/update"].includes(message.method ?? "")) {
    return null;
  }
  const params = asRecord(message.params);
  if (params?.sessionId !== sessionId) {
    return null;
  }
  const update = asRecord(params.update);
  let used: unknown;
  let size: unknown;
  if (update?.sessionUpdate === "usage_update") {
    used = update.used;
    size = update.size;
  } else if (update?.sessionUpdate === "session_status" && update.schema_version === 1 && update.session_id === sessionId) {
    const context = asRecord(update.context_window);
    used = context?.context_tokens;
    size = context?.context_window_size;
  } else {
    return null;
  }
  if (typeof used !== "number" || !Number.isSafeInteger(used) || used < 0) {
    return null;
  }
  if (size !== undefined && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)) {
    return null;
  }
  return {
    tokensInContextWindow: used,
    modelContextWindow: typeof size === "number" && size > 0 ? size : null,
  };
}

export function buildGrokRequestError(
  error: NonNullable<GrokJsonRpcMessage["error"]>,
  streamFailure: string | null = null,
  model: string | null | undefined = null,
): Error {
  const data = typeof error.data === "string" ? error.data : "";
  const detail = [error.message, data, streamFailure].filter(Boolean).join("\n");
  const unsupportedEvent = /unknown variant [`'"](response\.[a-zA-Z0-9_.]+)[`'"]/.exec(detail)?.[1];
  if (unsupportedEvent) {
    return Object.assign(new Error(t("grok.responsesStreamIncompatible", {
      model: model || "models.default",
      event: unsupportedEvent,
    })), { code: GROK_RESPONSES_STREAM_INCOMPATIBLE });
  }
  return new Error(error.message || t("grok.requestFailed"));
}

export function readGrokStreamFailure(message: GrokJsonRpcMessage): string | null {
  if (message.method !== "_x.ai/session/update" && message.method !== "session/update") {
    return null;
  }
  const update = asRecord(asRecord(message.params)?.update);
  return update?.sessionUpdate === "retry_state" && update.type === "failed" && typeof update.message === "string"
    ? update.message
    : null;
}

export type GrokAuthSelection =
  | { ok: true; methodId: string }
  | { ok: false; reason: "empty" | "unavailable"; error: string };

export type GrokSessionEvent =
  | { type: "assistant_text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; status: string; payload: unknown }
  | { type: "tool_update"; name: string; status: string; payload: unknown }
  | { type: "ignored" };

export type GrokCompactionEvent = {
  status: "started" | "completed" | "failed" | "cancelled";
  tokensBefore: number | null;
  tokensAfter: number | null;
  error: string | null;
};

export function readGrokCompactionEvent(message: GrokJsonRpcMessage, sessionId: string): GrokCompactionEvent | null {
  if (!["_x.ai/session_notification", "_x.ai/session/update", "session/update"].includes(message.method ?? "")) {
    return null;
  }
  const params = asRecord(message.params);
  if (typeof params?.sessionId === "string" && params.sessionId !== sessionId) {
    return null;
  }
  const update = asRecord(params?.update);
  const statuses = {
    auto_compact_started: "started",
    auto_compact_completed: "completed",
    auto_compact_failed: "failed",
    auto_compact_cancelled: "cancelled",
  } as const;
  const updateType = typeof update?.sessionUpdate === "string" ? update.sessionUpdate : "";
  if (!Object.prototype.hasOwnProperty.call(statuses, updateType)) {
    return null;
  }
  const tokenCount = (value: unknown): number | null => (
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
  );
  return {
    status: statuses[updateType as keyof typeof statuses],
    tokensBefore: tokenCount(update?.tokens_before),
    tokensAfter: tokenCount(update?.tokens_after),
    error: typeof update?.error === "string" ? update.error : null,
  };
}

export type GrokReasoningOption = {
  id: "reasoning_effort";
  allowed: string[] | null;
};

const GROK_AUTH_FAILURE = "Grok 未登录。请先运行 grok login，或设置环境变量 XAI_API_KEY。";

export function parseGrokJsonRpcLine(line: string): GrokLineParseResult {
  if (typeof line !== "string" || line.trim() === "") {
    return { ok: false, reason: "empty", error: "空 Grok 消息。" };
  }
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "invalid", error: "Grok 消息必须是 JSON 对象。" };
    }
    return { ok: true, message: parsed as GrokJsonRpcMessage };
  } catch (error) {
    return {
      ok: false,
      reason: "invalid",
      error: error instanceof Error ? error.message : "非法 JSON。",
    };
  }
}


const GROK_COMPLETED_STOP_REASONS = new Set(["end", "end_turn", "stop"]);

export function isGrokCompletedStopReason(stopReason: string | null | undefined): boolean {
  const normalized = String(stopReason ?? "").trim().toLowerCase();
  return normalized.length === 0 || GROK_COMPLETED_STOP_REASONS.has(normalized);
}

export function resolveGrokResumeSessionId(
  sessionId: string | null | undefined,
  mappedSessionId: string | null | undefined,
): string | null {
  for (const candidate of [mappedSessionId, sessionId]) {
    const value = String(candidate ?? "").trim();
    if (value && !isLocalSessionId(value)) {
      return value;
    }
  }
  return null;
}

export function buildGrokInitializeParams(clientName = "sinitek-cli-tools"): Record<string, unknown> {
  return {
    protocolVersion: GROK_PROTOCOL_VERSION,
    clientCapabilities: {
      fs: {
        readTextFile: false,
        writeTextFile: false,
      },
      terminal: false,
      _meta: { "x.ai/statusLine": true },
    },
    clientInfo: {
      name: clientName,
      version: GROK_CLIENT_INFO_VERSION,
    },
  };
}

export function buildGrokAuthenticateParams(methodId: string): { methodId: string; _meta: { headless: true } } {
  return {
    methodId,
    _meta: { headless: true },
  };
}

export function buildGrokSessionNewParams(cwd: string): {
  cwd: string;
  mcpServers: [];
  _meta: { yoloMode: true };
} {
  return { cwd, mcpServers: [], _meta: { yoloMode: true } };
}

export function buildGrokSessionLoadParams(sessionId: string, cwd: string): {
  sessionId: string;
  cwd: string;
  mcpServers: [];
  _meta: { yoloMode: true };
} {
  return { sessionId, cwd, mcpServers: [], _meta: { yoloMode: true } };
}

export function buildGrokSessionPromptParams(sessionId: string, text: string): {
  sessionId: string;
  prompt: Array<{ type: "text"; text: string }>;
} {
  return {
    sessionId,
    prompt: [{ type: "text", text }],
  };
}

export function buildGrokSessionCancelParams(sessionId: string): { sessionId: string } {
  return { sessionId };
}

export function buildGrokReasoningConfigParams(
  sessionId: string,
  effort: GrokReasoningEffort,
): { sessionId: string; configId: "reasoning_effort"; value: GrokReasoningEffort } {
  return {
    sessionId,
    configId: "reasoning_effort",
    value: effort,
  };
}

export function selectGrokAuthMethod(authMethods: readonly string[], env: NodeJS.ProcessEnv): GrokAuthSelection {
  if (authMethods.length === 0) {
    return { ok: false, reason: "empty", error: GROK_AUTH_FAILURE };
  }
  const apiKey = String(env.XAI_API_KEY ?? "").trim();
  if (apiKey && authMethods.includes(GROK_API_KEY_AUTH_METHOD)) {
    return { ok: true, methodId: GROK_API_KEY_AUTH_METHOD };
  }
  if (authMethods.includes(GROK_CACHED_TOKEN_AUTH_METHOD)) {
    return { ok: true, methodId: GROK_CACHED_TOKEN_AUTH_METHOD };
  }
  if (authMethods.includes(GROK_ACCOUNT_AUTH_METHOD)) {
    return { ok: true, methodId: GROK_ACCOUNT_AUTH_METHOD };
  }
  return { ok: false, reason: "unavailable", error: GROK_AUTH_FAILURE };
}

export function readGrokAuthMethodIds(result: unknown): string[] {
  const record = asRecord(result);
  const methods = record?.authMethods;
  if (!Array.isArray(methods)) {
    return [];
  }
  return methods.map((method) => {
    if (typeof method === "string") {
      return method.trim();
    }
    const item = asRecord(method);
    const id = item?.id ?? item?.methodId;
    return typeof id === "string" ? id.trim() : "";
  }).filter((method) => method.length > 0);
}

export function readGrokLoadSessionCapability(result: unknown): boolean {
  const capabilities = asRecord(asRecord(result)?.agentCapabilities);
  return capabilities?.loadSession === true;
}

export function readGrokSessionId(result: unknown): string {
  const record = asRecord(result);
  const direct = record?.sessionId;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nested = asRecord(record?.session);
  const nestedId = nested?.sessionId ?? nested?.id;
  if (typeof nestedId === "string" && nestedId.trim()) {
    return nestedId.trim();
  }
  const meta = asRecord(record?._meta);
  const metaId = meta?.sessionId;
  if (typeof metaId === "string" && metaId.trim()) {
    return metaId.trim();
  }
  const detail = asRecord(meta?.["x.ai/sessionDetail"]);
  const detailId = detail?.sessionId;
  return typeof detailId === "string" ? detailId.trim() : "";
}

export function findGrokReasoningOption(result: unknown): GrokReasoningOption | null {
  const options = asRecord(result)?.configOptions;
  if (!Array.isArray(options)) {
    return null;
  }
  for (const option of options) {
    const record = asRecord(option);
    const id = record?.id ?? record?.name ?? record?.configId;
    if (id !== "reasoning_effort") {
      continue;
    }
    return {
      id: "reasoning_effort",
      allowed: readAllowedValues(record),
    };
  }
  return null;
}

export function resolveGrokReasoningEffort(
  mode: unknown,
  option: GrokReasoningOption | null,
): GrokReasoningEffort | null {
  const effort = mapThinkingModeToGrokEffort(mode);
  if (!effort || !option) {
    return null;
  }
  if (option.allowed && !option.allowed.includes(effort)) {
    return null;
  }
  return effort;
}

export function classifyGrokSessionMessage(message: GrokJsonRpcMessage): GrokSessionEvent {
  if (message.method !== "session/update") {
    return { type: "ignored" };
  }
  const params = asRecord(message.params);
  const update = asRecord(params?.update) ?? params;
  const sessionUpdate = typeof update?.sessionUpdate === "string" ? update.sessionUpdate : "";
  if (sessionUpdate === "agent_message_chunk") {
    const text = readContentText(update?.content);
    return text ? { type: "assistant_text", text } : { type: "ignored" };
  }
  if (sessionUpdate === "agent_thought_chunk") {
    const text = readContentText(update?.content);
    return text ? { type: "thinking", text } : { type: "ignored" };
  }
  if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
    const name = readToolName(update);
    const status = typeof update?.status === "string" ? update.status : "";
    return sessionUpdate === "tool_call"
      ? { type: "tool", name, status, payload: update?.rawInput ?? update?.content ?? null }
      : { type: "tool_update", name, status, payload: update?.rawOutput ?? update?.content ?? null };
  }
  return { type: "ignored" };
}

export function readGrokPromptStopReason(message: GrokJsonRpcMessage): string | null {
  if (message.method === "session/update") {
    return null;
  }
  const result = asRecord(message.result);
  const stopReason = result?.stopReason;
  return typeof stopReason === "string" ? stopReason : null;
}

export function extractGrokAssistantText(message: GrokJsonRpcMessage): string {
  const event = classifyGrokSessionMessage(message);
  return event.type === "assistant_text" ? event.text : "";
}

export function formatGrokToolTrace(event: Extract<GrokSessionEvent, { type: "tool" | "tool_update" }>): string {
  const header = event.type === "tool" ? `tool: ${event.name}` : `tool result: ${event.name}`;
  const lines = [header];
  if (event.status) {
    lines.push(`status: ${event.status}`);
  }
  if (event.payload !== null && event.payload !== undefined) {
    lines.push(event.type === "tool" ? "input:" : "output:");
    lines.push(safeStringify(event.payload));
  }
  return lines.join("\n");
}

function readAllowedValues(option: Record<string, unknown> | null): string[] | null {
  if (!option) {
    return null;
  }
  for (const key of ["options", "values", "enum", "allowedValues"]) {
    const candidate = option[key];
    if (!Array.isArray(candidate)) {
      continue;
    }
    const values = candidate.map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      const record = asRecord(item);
      return typeof record?.value === "string" ? record.value.trim() : "";
    }).filter((item) => item.length > 0);
    if (values.length > 0) {
      return values;
    }
  }
  return null;
}

function readContentText(content: unknown): string {
  const record = asRecord(content);
  if (typeof record?.text === "string") {
    return record.text;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((item) => {
    const entry = asRecord(item);
    if (entry?.type !== "text" || typeof entry.text !== "string") {
      return "";
    }
    return entry.text;
  }).join("");
}

const TOOL_NAME_CANDIDATE_KEYS = ["kind", "title", "rawInput", "rawOutput", "content"] as const;
const TOOL_NAME_OBJECT_FIELDS = ["type", "kind", "tool", "name"] as const;
const CONTENT_BLOCK_TYPES = new Set(["text", "image", "audio", "resource", "json"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readToolName(update: Record<string, unknown> | null): string {
  if (!update) {
    return "tool";
  }
  for (const key of TOOL_NAME_CANDIDATE_KEYS) {
    const name = readReadableToolName(update[key]);
    if (name) {
      return name;
    }
  }
  return "tool";
}

function readReadableToolName(value: unknown): string {
  if (typeof value === "string") {
    return readReadableToolNameFromString(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = readReadableToolName(item);
      if (name) {
        return name;
      }
    }
    return "";
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  for (const field of TOOL_NAME_OBJECT_FIELDS) {
    const name = readReadableToolName(record[field]);
    if (name) {
      return name;
    }
  }
  return "";
}

function readReadableToolNameFromString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return readReadableToolName(JSON.parse(trimmed) as unknown);
    } catch {
      return "";
    }
  }
  return isReadableToolName(trimmed) ? trimmed : "";
}

function isReadableToolName(value: string): boolean {
  if (!value || value.startsWith("call-") || UUID_PATTERN.test(value)) {
    return false;
  }
  return !CONTENT_BLOCK_TYPES.has(value.toLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
