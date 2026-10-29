/**
 * Pure helpers for ZCode Protocol 1 (`zcode app-server --stdio`).
 *
 * Measured against ZCode 0.17.0. This is not ACP and not JSON-RPC 2.0:
 * the wire rejects a `jsonrpc` field. Requests are `{id, method, params}`.
 * This module never spawns a process and never reads credentials.
 */

export const ZCODE_PROTOCOL_NAME = "ZCode Protocol";
export const ZCODE_PROTOCOL_VERSION = 1;
export const ZCODE_DEFAULT_COMMAND = "zcode";
export const ZCODE_APP_SERVER_SUBCOMMAND = "app-server";
export const ZCODE_APPROVAL_MODE = "yolo";
export const ZCODE_PLAN_MODE = "plan";
export const ZCODE_DELIVERY_KIND = "desktop-continuous";
export const ZCODE_SESSION_PREFIX = "sess_";
export const ZCODE_STDERR_REPORT_LIMIT = 8192;
export const ZCODE_SHUTDOWN_GRACE_MS = 300;
export const ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID = "glm-5.3-flash_sub-coco";
export const ZCODE_GLM_FLASH_MODEL_ID = "glm-5.3-flash";
export const ZCODE_GLM_DEFAULT_REASONING_LEVEL = "max";

export const ZCODE_API_TYPES = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
] as const;

export type ZcodeApiType = (typeof ZCODE_API_TYPES)[number];

/** GLM Coding Plan's official OpenAI-compatible API inside ZCode. */
export const ZCODE_GLM_OFFICIAL_API_TYPE: ZcodeApiType = "openai-chat-completions";

export const ZCODE_LAUNCH_ARGS = [
  ZCODE_APP_SERVER_SUBCOMMAND,
  "--stdio",
  "--mode",
  ZCODE_APPROVAL_MODE,
] as const;

const REJECTED_LAUNCH_FLAGS = new Set([
  "-p",
  "--prompt",
  "--resume",
  "-c",
  "--continue",
  "--json",
  "acp",
  "--profile",
  "--always-approve",
  "--yolo",
  "--auto",
]);

export class ZcodeProtocolError extends Error {
  readonly code: string;
  readonly rpcCode?: number;

  public constructor(message: string, code: string, rpcCode?: number) {
    super(message);
    this.name = "ZcodeProtocolError";
    this.code = code;
    if (rpcCode !== undefined) {
      this.rpcCode = rpcCode;
    }
  }
}

export type ZcodeWireMessage = {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type ZcodeModelRef = {
  providerId: string;
  modelId: string;
  reasoningLevel?: string;
};

export type ZcodeContextUsage = {
  tokensInContextWindow: number;
  modelContextWindow: number;
};

export type ZcodeSettingsView = {
  model: string | null;
  modelOptions: string[];
  thinking: string | null;
  thinkingOptions: string[];
  thinkingEnabled: boolean;
  modeId: string | null;
};

export type ZcodeSessionEvent = {
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
  seq: number | null;
};

export function parseZcodeWireLine(line: string): ZcodeWireMessage | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new ZcodeProtocolError("ZCode Protocol line was not JSON.", "parse");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ZcodeProtocolError("ZCode Protocol line was not an object.", "parse");
  }
  const record = value as Record<string, unknown>;
  if ("jsonrpc" in record) {
    throw new ZcodeProtocolError("ZCode Protocol rejects JSON-RPC envelopes.", "wire");
  }
  return record as ZcodeWireMessage;
}

export function serializeZcodeWireMessage(message: ZcodeWireMessage): string {
  if ("jsonrpc" in (message as Record<string, unknown>)) {
    throw new ZcodeProtocolError("ZCode Protocol rejects JSON-RPC envelopes.", "wire");
  }
  return `${JSON.stringify(message)}\n`;
}

export function buildZcodeLaunchArgs(extra: readonly string[] = []): string[] {
  const kept: string[] = [];
  for (const arg of extra) {
    const normalized = arg.trim();
    if (!normalized) {
      continue;
    }
    if (REJECTED_LAUNCH_FLAGS.has(normalized) || normalized === "--mode" || normalized.startsWith("--mode=")) {
      throw new ZcodeProtocolError(
        `ZCode launch cannot include ${normalized}. Approval bypass is --mode yolo on app-server.`,
        "launch-arg",
      );
    }
    if (normalized === "app-server" || normalized === "--stdio") {
      continue;
    }
    kept.push(normalized);
  }
  return [...ZCODE_LAUNCH_ARGS, ...kept];
}

export function buildZcodeWorkspace(cwd: string): { workspacePath: string; workspaceKey: string } {
  const workspacePath = cwd.trim();
  if (!workspacePath) {
    throw new ZcodeProtocolError("ZCode workspace path is empty.", "workspace");
  }
  return { workspacePath, workspaceKey: workspacePath };
}

export function buildZcodeRuntimePreferences(): Record<string, unknown> {
  return {
    nativeSearchEnhancementsEnabled: false,
    toolSearchMode: "off",
    memoryEnabled: false,
    askUserQuestionAutoResolutionEnabled: false,
    modelContextBudgetStrategy: "preflight-v1",
  };
}

export function parseZcodeModelRef(value: string): ZcodeModelRef {
  const normalized = value.trim();
  const separator = normalized.indexOf("/");
  if (separator <= 0 || separator >= normalized.length - 1) {
    throw new ZcodeProtocolError("ZCode model must use providerId/modelId.", "model");
  }
  const reasoningAt = normalized.lastIndexOf("$");
  const modelPart = reasoningAt > separator ? normalized.slice(separator + 1, reasoningAt) : normalized.slice(separator + 1);
  const reasoningLevel = reasoningAt > separator ? normalized.slice(reasoningAt + 1).trim() : "";
  if (!modelPart.trim()) {
    throw new ZcodeProtocolError("ZCode model id is empty.", "model");
  }
  return {
    providerId: normalized.slice(0, separator).trim(),
    modelId: modelPart.trim(),
    ...(reasoningLevel
      ? { reasoningLevel }
      : modelPart.trim() === ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID || modelPart.trim() === ZCODE_GLM_FLASH_MODEL_ID
        ? { reasoningLevel: ZCODE_GLM_DEFAULT_REASONING_LEVEL }
        : {}),
  };
}

export function formatZcodeModelRef(ref: ZcodeModelRef): string {
  return `${ref.providerId}/${ref.modelId}`;
}

export function buildZcodeModelSelection(ref: ZcodeModelRef): Record<string, unknown> {
  const selection: Record<string, unknown> = {
    providerId: ref.providerId,
    modelId: ref.modelId,
  };
  if (ref.reasoningLevel) {
    selection.options = { reasoningLevel: ref.reasoningLevel };
  }
  return selection;
}

export function buildZcodeSessionModelSettings(
  model: ZcodeModelRef | null,
  requestedThoughtLevel?: string | null,
): Record<string, unknown> {
  const thoughtLevel = requestedThoughtLevel?.trim()
    || model?.reasoningLevel
    || (model?.modelId === ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID || model?.modelId === ZCODE_GLM_FLASH_MODEL_ID
      ? ZCODE_GLM_DEFAULT_REASONING_LEVEL
      : undefined);
  return {
    ...(model ? { model: buildZcodeModelSelection({ ...model, reasoningLevel: thoughtLevel }) } : {}),
    ...(thoughtLevel ? { thoughtLevel } : {}),
  };
}

export function isZcodeSessionId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ZCODE_SESSION_PREFIX);
}

export function readZcodeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readZcodeSnapshot(result: unknown): Record<string, unknown> {
  const record = readZcodeRecord(result);
  if (!record) {
    throw new ZcodeProtocolError("ZCode returned an invalid session snapshot.", "snapshot");
  }
  const nested = readZcodeRecord(record.snapshot);
  const snapshot = nested && readZcodeRecord(nested.protocol) ? nested : record;
  const protocol = readZcodeRecord(snapshot.protocol);
  if (protocol?.name !== ZCODE_PROTOCOL_NAME || protocol.version !== ZCODE_PROTOCOL_VERSION) {
    throw new ZcodeProtocolError("ZCode protocol version 1 was not confirmed.", "protocol-version");
  }
  return snapshot;
}

export function readZcodeSessionId(snapshot: Record<string, unknown>): string {
  const session = readZcodeRecord(snapshot.session);
  const sessionId = session?.sessionId;
  if (!isZcodeSessionId(sessionId)) {
    throw new ZcodeProtocolError("ZCode session id was not confirmed.", "session-id");
  }
  return sessionId;
}

function readFiniteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function readZcodeContextUsage(snapshot: Record<string, unknown>): ZcodeContextUsage | null {
  const projection = readZcodeRecord(snapshot.projection);
  const used = readFiniteCount(projection?.contextUsed);
  const windowSize = readFiniteCount(projection?.contextWindow);
  if (used === null || used <= 0 || windowSize === null || windowSize <= 0) {
    return null;
  }
  return { tokensInContextWindow: used, modelContextWindow: windowSize };
}

export function readZcodeSettings(snapshot: Record<string, unknown>): ZcodeSettingsView {
  const settings = readZcodeRecord(snapshot.settings) ?? {};
  const model = readZcodeRecord(settings.model) ?? {};
  const current = readZcodeRecord(model.current);
  const available = Array.isArray(model.available) ? model.available : [];
  const modelOptions = available.flatMap((item) => {
    const record = readZcodeRecord(item);
    const ref = readZcodeRecord(record?.ref);
    if (typeof ref?.providerId !== "string" || typeof ref.modelId !== "string") {
      return [];
    }
    return [formatZcodeModelRef({ providerId: ref.providerId, modelId: ref.modelId })];
  });
  const thought = readZcodeRecord(settings.thoughtLevel) ?? {};
  const thinkingOptions = Array.isArray(thought.available)
    ? thought.available.flatMap((item) => {
      const record = readZcodeRecord(item);
      return typeof record?.value === "string" && record.value.trim() ? [record.value.trim()] : [];
    })
    : [];
  const mode = readZcodeRecord(settings.mode);
  return {
    model: typeof current?.providerId === "string" && typeof current.modelId === "string"
      ? formatZcodeModelRef({ providerId: current.providerId, modelId: current.modelId })
      : null,
    modelOptions,
    thinking: typeof thought.current === "string" ? thought.current : null,
    thinkingOptions,
    thinkingEnabled: thought.enabled === true,
    modeId: typeof mode?.current === "string" ? mode.current : null,
  };
}

export function assertAdvertisedZcodeThought(value: string, available: readonly string[]): string {
  const normalized = value.trim();
  if (!available.includes(normalized)) {
    throw new ZcodeProtocolError(
      `ZCode did not advertise thought level ${normalized || "(empty)"}.`,
      "thought-level",
    );
  }
  return normalized;
}

export function readZcodeSessionEvent(message: ZcodeWireMessage): ZcodeSessionEvent | null {
  if (message.method !== "session/event") {
    return null;
  }
  const params = readZcodeRecord(message.params);
  if (!params || typeof params.type !== "string") {
    return null;
  }
  const payload = readZcodeRecord(params.payload) ?? {};
  return {
    sessionId: typeof params.sessionId === "string" ? params.sessionId : "",
    type: params.type,
    payload,
    seq: typeof params.seq === "number" ? params.seq : null,
  };
}

export function readZcodeTextDelta(event: ZcodeSessionEvent): { field: string; delta: string } | null {
  if (typeof event.payload.delta !== "string" || !event.payload.delta) {
    return null;
  }
  if (event.type === "model.streaming") {
    const kind = event.payload.kind;
    if (kind === "text_delta") {
      return { field: "text", delta: event.payload.delta };
    }
    if (kind === "reasoning_delta") {
      return { field: "reasoning", delta: event.payload.delta };
    }
    return null;
  }
  if (event.type !== "part.delta") {
    return null;
  }
  const field = typeof event.payload.field === "string" ? event.payload.field : "text";
  return { field, delta: event.payload.delta };
}

export function selectZcodeAllowOption(params: unknown): { optionId: string } | null {
  const record = readZcodeRecord(params);
  const options = Array.isArray(record?.options) ? record.options : [];
  const parsed = options.flatMap((item) => {
    const option = readZcodeRecord(item);
    if (!option || typeof option.optionId !== "string" || !option.optionId) {
      return [];
    }
    const response = readZcodeRecord(option.response);
    const decision = typeof response?.decision === "string"
      ? response.decision
      : typeof option.decision === "string"
        ? option.decision
        : "";
    return [{ optionId: option.optionId, kind: typeof option.kind === "string" ? option.kind : "", decision }];
  });
  const allowAlways = parsed.find((option) => option.kind === "allow_always");
  if (allowAlways) {
    return { optionId: allowAlways.optionId };
  }
  const allow = parsed.find((option) => option.decision === "allow" || option.kind === "allow");
  return allow ? { optionId: allow.optionId } : null;
}

export function readZcodeTurnFailure(event: ZcodeSessionEvent): string {
  const error = readZcodeRecord(event.payload.error);
  const message = [event.payload.message, event.payload.error, error?.message, event.payload.reason]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return message ? redactZcodeDiagnostic(message.trim()) : "ZCode turn failed.";
}

export function redactZcodeDiagnostic(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "<redacted>")
    .replace(/(apiKey"\s*:\s*")[^"]+/gi, "$1<redacted>");
}

export function buildZcodeChildEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  for (const key of Object.keys(env)) {
    if (/(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/i.test(key)) {
      delete env[key];
    }
  }
  delete env.FORCE_COLOR;
  return env;
}
