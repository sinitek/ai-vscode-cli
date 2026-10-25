/**
 * Pure DeepSeek Harness ACP v1 helpers.
 *
 * This module does not start a process, read user credentials, or import Grok
 * protocol types. Official measured reasoning values are off|low|high|max, but
 * they are not an allowlist: only values advertised for the current model are
 * legal. `ultra` is never rewritten.
 */

export const DSH_ACP_PROTOCOL_VERSION = 1;
export const DSH_ACP_PROFILE = "acp";
export const DSH_DEFAULT_COMMAND = "dsh";
export const DSH_ACP_CLIENT_NAME = "sinitek-dsh-runner";
export const DSH_ACP_CLIENT_VERSION = "0";
export const DSH_MODEL_CONFIG_ID = "model";
export const DSH_REASONING_CONFIG_ID = "reasoning_effort";
export const DSH_PERMISSION_ALLOW_ONCE = "allow-once";
export const DSH_PERMISSION_REJECT_ONCE = "reject-once";
export const DSH_JSONRPC_METHOD_NOT_FOUND = -32601;
export const DSH_STDERR_REPORT_LIMIT = 8192;
export const DSH_SHUTDOWN_GRACE_MS = 300;
export const DSH_LOCAL_SESSION_PREFIX = "local_";

export const DSH_FORBIDDEN_METHODS = ["session/load", "initialized", "session/delete", "session/fork"] as const;

export const DSH_FOREIGN_CREDENTIAL_ENV_KEYS = [
  "XAI_API_KEY",
  "GROK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

const REJECTED_LAUNCH_FLAGS = new Set([
  "--profile",
  "--from-default-profile",
  "--dump-config",
  "--dump-config-schema",
  "--dump-default-config",
  "-h",
  "--help",
  "-V",
  "--version",
]);

const REJECTED_PROFILE_NAMES = new Set(["headless", "sdk", "tui", "desktop", "web", "acp", "plugin"]);

const SECRET_ENV_KEY = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/i;

export class DshProtocolError extends Error {
  readonly code: string;
  readonly rpcCode?: number;

  public constructor(message: string, code: string, rpcCode?: number) {
    super(message);
    this.name = "DshProtocolError";
    this.code = code;
    if (rpcCode !== undefined) {
      this.rpcCode = rpcCode;
    }
  }
}

export class DshCompactionUnsupportedError extends DshProtocolError {
  readonly compacted = false;

  public constructor() {
    super(
      "DSH ACP compactSession is not supported. Sending /compact is not a proven native compaction trigger.",
      "compaction-unsupported",
    );
    this.name = "DshCompactionUnsupportedError";
  }
}

export type DshJsonRpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export type DshConfigOption = {
  id: string;
  currentValue?: string;
  values: string[];
  raw: Record<string, unknown>;
};

export type DshTokenUsageUpdate = {
  tokensInContextWindow: number;
  modelContextWindow: number;
};

export type DshModelWire = {
  provider: string;
  model: string;
};

export type DshPermissionDecision =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export type DshToolProjection = {
  toolCallId: string;
  status: string;
  title: string;
  contentText: string;
};

export type DshSessionUpdate =
  | { type: "assistant_text"; messageId: string; text: string }
  | { type: "thinking"; messageId: string; text: string }
  | { type: "tool"; toolCallId: string; title?: string; status?: string; contentText: string }
  | { type: "usage"; used: unknown; size: unknown }
  | { type: "config"; configOptions: DshConfigOption[] }
  | { type: "ignored" };

export type DshProcessStopStep =
  | { kind: "taskkill"; args: ["/PID", string, "/T", "/F"] }
  | { kind: "signal"; signal: "SIGTERM" | "SIGKILL" };

export function parseDshJsonRpcLine(
  line: string,
): { ok: true; message: DshJsonRpcMessage } | { ok: false; reason: "empty" | "invalid"; error: string } {
  if (line.trim() === "") {
    return { ok: false, reason: "empty", error: "empty" };
  }
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: "invalid", error: "ACP frame is not an object" };
    }
    const record = value as Record<string, unknown>;
    if (record.jsonrpc !== "2.0") {
      return { ok: false, reason: "invalid", error: "ACP frame is not JSON-RPC 2.0" };
    }
    return {
      ok: true,
      message: {
        jsonrpc: record.jsonrpc,
        id: record.id,
        method: typeof record.method === "string" ? record.method : undefined,
        params: record.params,
        result: record.result,
        error: record.error,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildDshLaunchArgs(agentArgs: readonly string[] = []): string[] {
  const patches: string[] = [];
  for (let index = 0; index < agentArgs.length; index += 1) {
    const arg = agentArgs[index];
    if (arg === "--") {
      throw new DshProtocolError("DSH ACP runner does not accept unparsed app args", "agent-args");
    }
    if (arg === "--patch" || arg.startsWith("--patch=")) {
      const pathValue = arg === "--patch" ? agentArgs[index + 1] : arg.slice("--patch=".length);
      if (arg === "--patch") {
        index += 1;
      }
      if (!pathValue || pathValue.startsWith("-") || pathValue.includes("\0")) {
        throw new DshProtocolError("--patch requires a non-empty path", "agent-args");
      }
      patches.push("--patch", pathValue);
      continue;
    }
    if (
      REJECTED_LAUNCH_FLAGS.has(arg)
      || REJECTED_PROFILE_NAMES.has(arg)
      || arg.startsWith("--profile=")
      || arg.startsWith("--from-default-profile")
    ) {
      throw new DshProtocolError(`DSH ACP runner rejects agent arg ${arg}`, "agent-args");
    }
    throw new DshProtocolError(
      `DSH ACP runner only accepts explicit --patch agent args, rejected ${arg}`,
      "agent-args",
    );
  }
  return ["--profile", DSH_ACP_PROFILE, ...patches];
}

export function buildDshChildEnv(
  explicit: NodeJS.ProcessEnv | undefined,
  fallback: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (explicit) {
    return { ...explicit };
  }
  const child: NodeJS.ProcessEnv = { ...fallback };
  for (const key of DSH_FOREIGN_CREDENTIAL_ENV_KEYS) {
    delete child[key];
  }
  return child;
}

export function isDshResumableSessionId(value: string | null | undefined): boolean {
  const id = String(value ?? "").trim();
  return id.length > 0 && !id.startsWith(DSH_LOCAL_SESSION_PREFIX);
}

const DSH_COMPLETED_STOP_REASONS = new Set(["end", "end_turn", "stop"]);

export function isDshCompletedStopReason(stopReason: string | null | undefined): boolean {
  const normalized = String(stopReason ?? "").trim().toLowerCase();
  return DSH_COMPLETED_STOP_REASONS.has(normalized);
}

export function resolveDshHostResumeId(
  sessionId: string | null | undefined,
  mappedSessionId: string | null | undefined,
): string | null {
  for (const candidate of [mappedSessionId, sessionId]) {
    if (isDshResumableSessionId(candidate)) {
      return String(candidate).trim();
    }
  }
  return null;
}

export function buildDshInitializeParams(): Record<string, unknown> {
  return {
    protocolVersion: DSH_ACP_PROTOCOL_VERSION,
    clientInfo: {
      name: DSH_ACP_CLIENT_NAME,
      version: DSH_ACP_CLIENT_VERSION,
    },
  };
}

export function buildDshSessionNewParams(cwd: string): Record<string, unknown> {
  return {
    cwd,
    mcpServers: [],
  };
}

export function buildDshSessionResumeParams(sessionId: string, cwd: string): Record<string, unknown> {
  return {
    sessionId,
    cwd,
    mcpServers: [],
  };
}

export function buildDshSessionCloseParams(sessionId: string): Record<string, unknown> {
  return { sessionId };
}

export function buildDshSessionCancelParams(sessionId: string): Record<string, unknown> {
  return { sessionId };
}

export function buildDshSessionPromptParams(sessionId: string, text: string): Record<string, unknown> {
  return {
    sessionId,
    prompt: [{ type: "text", text }],
  };
}

export function buildDshSetConfigOptionParams(
  sessionId: string,
  configId: typeof DSH_MODEL_CONFIG_ID | typeof DSH_REASONING_CONFIG_ID,
  value: string,
): Record<string, unknown> {
  return {
    sessionId,
    configId,
    value,
  };
}

export function readDshSessionId(result: unknown): string | null {
  const record = asRecord(result);
  const sessionId = record?.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
}

export function readDshPromptStopReason(result: unknown): string | null {
  const record = asRecord(result);
  const stopReason = record?.stopReason;
  return typeof stopReason === "string" && stopReason.trim() ? stopReason : null;
}

export function formatDshRpcError(error: unknown): DshProtocolError {
  const record = asRecord(error);
  const message = typeof record?.message === "string" && record.message.trim()
    ? record.message
    : "ACP request failed";
  const rpcCode = typeof record?.code === "number" ? record.code : -32603;
  const turnFailed = /turn failed/i.test(message);
  return new DshProtocolError(message, turnFailed ? "turn-failed" : "rpc-error", rpcCode);
}

export function isDshTurnFailedError(error: unknown): boolean {
  if (error instanceof DshProtocolError && error.code === "turn-failed") {
    return true;
  }
  return error instanceof Error && /turn failed/i.test(error.message);
}

export function buildDshMethodNotFoundError(method: string): { code: number; message: string; data: { method: string } } {
  return {
    code: DSH_JSONRPC_METHOD_NOT_FOUND,
    message: `"Method not found": ${method}`,
    data: { method },
  };
}

export function parseDshModelWireValue(value: string): DshModelWire | null {
  if (typeof value !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return null;
  }
  const [provider, model] = parsed;
  if (typeof provider !== "string" || typeof model !== "string") {
    return null;
  }
  if (provider.length === 0 || model.length === 0) {
    return null;
  }
  if (JSON.stringify([provider, model]) !== value) {
    return null;
  }
  return { provider, model };
}

export function assertAdvertisedDshModel(value: string, options: readonly string[]): DshModelWire {
  const parsed = parseDshModelWireValue(value);
  if (!parsed) {
    throw new DshProtocolError(
      `model must be a canonical ACP wire value JSON.stringify([provider, model]); received ${JSON.stringify(value)}`,
      "model-wire-invalid",
    );
  }
  if (!options.includes(value)) {
    throw new DshProtocolError(
      `model ${JSON.stringify(value)} is not in the advertised ACP options`,
      "model-not-advertised",
    );
  }
  return parsed;
}

export function assertAdvertisedDshReasoning(value: string, options: readonly string[]): string {
  if (typeof value !== "string") {
    throw new DshProtocolError("reasoning_effort must be a scalar string", "reasoning-wire-invalid");
  }
  if (!options.includes(value)) {
    throw new DshProtocolError(
      `reasoning effort ${JSON.stringify(value)} is not advertised for the current model and was not applied; advertised values are ${JSON.stringify(options)}`,
      "reasoning-not-advertised",
    );
  }
  return value;
}

export function readDshConfigOptions(source: unknown): DshConfigOption[] {
  const list = findConfigOptions(source);
  if (!list) {
    return [];
  }
  const options: DshConfigOption[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || record.id.length === 0) {
      continue;
    }
    options.push({
      id: record.id,
      currentValue: typeof record.currentValue === "string" ? record.currentValue : undefined,
      values: collectSelectValues(record.options),
      raw: record,
    });
  }
  return options;
}

export function readDshConfigOption(options: readonly DshConfigOption[], id: string): DshConfigOption | null {
  return options.find((option) => option.id === id) ?? null;
}

export function acceptDshIncrementalText(tracker: Map<string, string>, key: string, text: string): string | null {
  if (!text) {
    return null;
  }
  const previous = tracker.get(key) ?? "";
  if (text === previous) {
    return null;
  }
  if (previous && text.startsWith(previous)) {
    const delta = text.slice(previous.length);
    tracker.set(key, text);
    return delta || null;
  }
  tracker.set(key, previous + text);
  return text;
}

export function extractDshText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractDshText(item)).join("");
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  if ("content" in record) {
    return extractDshText(record.content);
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  return "";
}

export function projectDshToolUpdate(
  previous: DshToolProjection | undefined,
  next: { toolCallId: string; title?: string; status?: string; contentText: string },
): { state: DshToolProjection; trace: string | null } {
  const state: DshToolProjection = {
    toolCallId: next.toolCallId,
    status: next.status || previous?.status || "in_progress",
    title: next.title || previous?.title || next.toolCallId,
    contentText: previous?.contentText ?? "",
  };
  const pieces: string[] = [];
  if (!previous) {
    pieces.push(`${state.title} ${state.status}`);
  } else if (next.status && next.status !== previous.status) {
    pieces.push(`${state.title} ${state.status}`);
  }
  if (next.contentText && next.contentText !== state.contentText) {
    const delta = state.contentText && next.contentText.startsWith(state.contentText)
      ? next.contentText.slice(state.contentText.length)
      : next.contentText;
    if (delta) {
      pieces.push(delta);
    }
    state.contentText = next.contentText;
  }
  const trace = pieces.join("\n");
  return { state, trace: trace || null };
}

export function readDshUpdateSessionId(message: DshJsonRpcMessage): string | null {
  const params = asRecord(message.params);
  if (!params) {
    return null;
  }
  if (typeof params.sessionId === "string" && params.sessionId) {
    return params.sessionId;
  }
  const update = asRecord(params.update);
  if (update && typeof update.sessionId === "string" && update.sessionId) {
    return update.sessionId;
  }
  return null;
}

export function readDshSessionUpdateBody(message: DshJsonRpcMessage): Record<string, unknown> | null {
  const params = asRecord(message.params);
  if (!params) {
    return null;
  }
  const update = asRecord(params.update);
  if (update && typeof update.sessionUpdate === "string") {
    return update;
  }
  if (typeof params.sessionUpdate === "string") {
    return params;
  }
  return null;
}

export function classifyDshSessionUpdate(update: Record<string, unknown>): DshSessionUpdate {
  const kind = update.sessionUpdate;
  if (kind === "agent_message_chunk") {
    return {
      type: "assistant_text",
      messageId: typeof update.messageId === "string" ? update.messageId : "",
      text: extractDshText(update.content),
    };
  }
  if (kind === "agent_thought_chunk") {
    return {
      type: "thinking",
      messageId: typeof update.messageId === "string" ? update.messageId : "",
      text: extractDshText(update.content),
    };
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : "";
    if (!toolCallId) {
      return { type: "ignored" };
    }
    return {
      type: "tool",
      toolCallId,
      title: typeof update.title === "string" ? update.title : undefined,
      status: typeof update.status === "string" ? update.status : undefined,
      contentText: extractDshText(update.content),
    };
  }
  if (kind === "usage_update") {
    return { type: "usage", used: update.used, size: update.size };
  }
  if (kind === "config_option_update") {
    return { type: "config", configOptions: readDshConfigOptions(update) };
  }
  return { type: "ignored" };
}

export function readDshTokenUsageUpdate(used: unknown, size: unknown): DshTokenUsageUpdate | null {
  if (!isRealTokenCount(used) || !isRealTokenCount(size)) {
    return null;
  }
  return {
    tokensInContextWindow: used,
    modelContextWindow: size,
  };
}

export function resolveDshPermissionDecision(
  resolution: { result?: unknown; error?: unknown } | null | undefined,
  offeredOptionIds: readonly string[],
): DshPermissionDecision {
  if (!resolution || resolution.error !== undefined) {
    return { outcome: "cancelled" };
  }
  const result = asRecord(resolution.result);
  if (!result) {
    return { outcome: "cancelled" };
  }
  if (result.outcome === "cancelled") {
    return { outcome: "cancelled" };
  }
  const outcome = asRecord(result.outcome);
  if (!outcome) {
    return { outcome: "cancelled" };
  }
  if (outcome.outcome === "cancelled") {
    return { outcome: "cancelled" };
  }
  if (
    outcome.outcome === "selected"
    && typeof outcome.optionId === "string"
    && offeredOptionIds.includes(outcome.optionId)
  ) {
    return { outcome: "selected", optionId: outcome.optionId };
  }
  return { outcome: "cancelled" };
}

export function buildDshPermissionResult(decision: DshPermissionDecision): Record<string, unknown> {
  if (decision.outcome === "cancelled") {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: decision.optionId } };
}

export function readDshPermissionOffer(params: unknown): { sessionId: string | null; optionIds: string[] } {
  const record = asRecord(params);
  const options = Array.isArray(record?.options) ? record.options : [];
  const optionIds = options.flatMap((option) => {
    const item = asRecord(option);
    return item && typeof item.optionId === "string" ? [item.optionId] : [];
  });
  return {
    sessionId: typeof record?.sessionId === "string" ? record.sessionId : null,
    optionIds,
  };
}

export function planDshProcessTreeStop(
  platform: NodeJS.Platform,
  pid: number | undefined,
  phase: "initial" | "escalate",
): DshProcessStopStep | null {
  if (!pid) {
    return null;
  }
  if (platform === "win32") {
    if (phase !== "initial") {
      return null;
    }
    return { kind: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
  }
  return { kind: "signal", signal: phase === "initial" ? "SIGTERM" : "SIGKILL" };
}

export function redactDshDiagnostic(text: string, env?: NodeJS.ProcessEnv): string {
  let redacted = text;
  const secrets = secretValues(env).sort((left, right) => right.length - left.length);
  for (const secret of secrets) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  redacted = redacted.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
  redacted = redacted.replace(
    /\b(DEEPSEEK_API_KEY|XAI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|OPENROUTER_API_KEY)\s*[:=]\s*([^\s,;]+)/gi,
    "$1=[redacted]",
  );
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "Bearer [redacted]");
  return redacted;
}

export function boundDshDiagnostic(text: string, limit = DSH_STDERR_REPORT_LIMIT): string {
  if (text.length <= limit) {
    return text;
  }
  return text.slice(text.length - limit);
}

export function findDshForbiddenWire(value: unknown): string | null {
  const seen = new Set<unknown>();
  const visit = (node: unknown, path: string): string | null => {
    if (!node || typeof node !== "object") {
      return null;
    }
    if (seen.has(node)) {
      return null;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        const found = visit(node[index], `${path}[${index}]`);
        if (found) {
          return found;
        }
      }
      return null;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === "yoloMode") {
        return `${path}.${key}`;
      }
      if (key === "method" && (child === "session/load" || child === "initialized")) {
        return `${path}.method=${String(child)}`;
      }
      const found = visit(child, path ? `${path}.${key}` : key);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return visit(value, "$");
}

function findConfigOptions(source: unknown): unknown[] | null {
  const record = asRecord(source);
  if (!record) {
    return null;
  }
  if (Array.isArray(record.configOptions)) {
    return record.configOptions;
  }
  const update = asRecord(record.update);
  if (update && Array.isArray(update.configOptions)) {
    return update.configOptions;
  }
  if (record.result !== undefined) {
    return findConfigOptions(record.result);
  }
  return null;
}

function collectSelectValues(options: unknown): string[] {
  if (!Array.isArray(options)) {
    return [];
  }
  const values: string[] = [];
  for (const option of options) {
    const record = asRecord(option);
    if (!record) {
      continue;
    }
    if (typeof record.value === "string") {
      values.push(record.value);
    }
    if (Array.isArray(record.options)) {
      values.push(...collectSelectValues(record.options));
    }
  }
  return values;
}

function isRealTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function secretValues(env: NodeJS.ProcessEnv | undefined): string[] {
  if (!env) {
    return [];
  }
  const values: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 8 || !SECRET_ENV_KEY.test(key)) {
      continue;
    }
    values.push(value);
  }
  return values;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
