/**
 * Pure Kimi Code ACP v1 helpers.
 *
 * Measured against the official CLI `@moonshot-ai/kimi-code` 2.3.2 (`kimi acp`).
 * This module never spawns a process, never reads user credentials and never
 * imports another CLI's protocol types.
 *
 * Thinking effort is not an allowlist: only the values advertised for the
 * current model are legal (`off|on` without `support_efforts`, otherwise
 * `off|low|medium|high|xhigh|max`). `ultra` is never rewritten to `max`.
 */

export const KIMI_ACP_PROTOCOL_VERSION = 1;
export const KIMI_ACP_SUBCOMMAND = "acp";
export const KIMI_DEFAULT_COMMAND = "kimi";
export const KIMI_ACP_CLIENT_NAME = "sinitek-kimi-code-runner";
export const KIMI_ACP_CLIENT_VERSION = "0";
export const KIMI_MODEL_CONFIG_ID = "model";
export const KIMI_THINKING_CONFIG_ID = "thinking";
export const KIMI_MODE_CONFIG_ID = "mode";
export const KIMI_PERMISSION_APPROVE_ONCE = "approve_once";
export const KIMI_PERMISSION_APPROVE_ALWAYS = "approve_always";
export const KIMI_PERMISSION_REJECT = "reject";
export const KIMI_JSONRPC_METHOD_NOT_FOUND = -32601;
export const KIMI_STDERR_REPORT_LIMIT = 8192;
export const KIMI_SHUTDOWN_GRACE_MS = 300;
export const KIMI_ACP_SESSION_PREFIX = "session_";

/** Region flag values accepted by the official `kimi acp` subcommand. */
export const KIMI_ACP_REGIONS = ["mainland-cn", "global"] as const;

/**
 * `session/load` replays history and is unnecessary: `session/resume` is the
 * documented lightweight sibling and is what this runner uses.
 */
export const KIMI_FORBIDDEN_METHODS = ["session/load", "session/fork", "session/delete"] as const;

/**
 * Kimi Code reads credentials only from `config.toml` (`api_key`, provider
 * `env` table, or `api_key_env`) plus the `KIMI_MODEL_*` family. These ambient
 * variables are never read as provider credentials, so they must not leak into
 * the child process environment.
 */
export const KIMI_FOREIGN_CREDENTIAL_ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROK_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

/** Provider credential variable names that Kimi reads from `[providers.<n>.env]`. */
export const KIMI_PROVIDER_ENV_CREDENTIAL_KEYS = ["KIMI_API_KEY", "OPENAI_API_KEY"] as const;

const REJECTED_LAUNCH_ARGS = new Set([
  "-y",
  "--yolo",
  "--auto",
  "--yes",
  "--auto-approve",
  "-p",
  "--prompt",
  "--output-format",
  "--session",
  "-S",
  "--continue",
  "-c",
  "--resume",
  "-r",
  "--plan",
  "--login",
  "-h",
  "--help",
  "-V",
  "--version",
]);

const SECRET_ENV_KEY = /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/i;

export class KimiProtocolError extends Error {
  readonly code: string;
  readonly rpcCode?: number;

  public constructor(message: string, code: string, rpcCode?: number) {
    super(message);
    this.name = "KimiProtocolError";
    this.code = code;
    if (rpcCode !== undefined) {
      this.rpcCode = rpcCode;
    }
  }
}

export class KimiCompactionUnsupportedError extends KimiProtocolError {
  readonly compacted = false;

  public constructor() {
    super(
      "Kimi Code ACP exposes no compaction method. `/compact` is a slash command, not a proven native compaction trigger.",
      "compaction-unsupported",
    );
    this.name = "KimiCompactionUnsupportedError";
  }
}

export type KimiJsonRpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export type KimiConfigOption = {
  id: string;
  name?: string;
  category?: string;
  currentValue?: string;
  values: string[];
  raw: Record<string, unknown>;
};

export type KimiTokenUsageUpdate = {
  tokensInContextWindow: number;
  modelContextWindow: number;
};

export type KimiCompactionUpdate = {
  status: "started" | "completed" | "cancelled" | "blocked";
  text: string;
};

export type KimiPermissionDecision =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export type KimiToolProjection = {
  toolCallId: string;
  status: string;
  title: string;
  kind?: string;
  rawInput?: unknown;
  contentText: string;
};

export type KimiSessionUpdate =
  | { type: "assistant_text"; messageId: string; text: string }
  | { type: "thinking"; messageId: string; text: string }
  | { type: "tool"; toolCallId: string; title?: string; kind?: string; status?: string; rawInput?: unknown; contentText: string }
  | { type: "plan"; planId: string; items: KimiTaskListItem[] }
  | { type: "plan_removed"; planId: string }
  | { type: "mode"; modeId: string }
  | { type: "usage"; used: unknown; size: unknown }
  | { type: "config"; configOptions: KimiConfigOption[] }
  | { type: "ignored" };

export type KimiTaskListItem = { text: string; done: boolean };

export type KimiProcessStopStep =
  | { kind: "taskkill"; args: ["/PID", string, "/T", "/F"] }
  | { kind: "signal"; signal: "SIGTERM" | "SIGKILL" };

export function parseKimiJsonRpcLine(
  line: string,
): { ok: true; message: KimiJsonRpcMessage } | { ok: false; reason: "empty" | "invalid"; error: string } {
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

/**
 * `kimi acp` is the only verified ACP entry point. Extra args are rejected
 * unless they are the official `--region` selector, because every other flag
 * either changes the transport or is only valid for the one-shot `-p` mode.
 */
export function buildKimiLaunchArgs(agentArgs: readonly string[] = []): string[] {
  return [KIMI_ACP_SUBCOMMAND, ...readKimiAcpAgentArgs(agentArgs)];
}

/**
 * The configurable `args.kimi-code` surface: only the optional `--region`
 * selector survives, because it is the single option the verified
 * `kimi acp --help` output accepts.
 */
export function readKimiAcpAgentArgs(agentArgs: readonly string[] = []): string[] {
  const extra: string[] = [];
  for (let index = 0; index < agentArgs.length; index += 1) {
    const arg = agentArgs[index];
    if (typeof arg !== "string" || arg === "--") {
      throw new KimiProtocolError("Kimi Code ACP runner does not accept unparsed app args", "agent-args");
    }
    if (arg === "--region") {
      const value = agentArgs[index + 1];
      index += 1;
      extra.push("--region", assertKimiRegion(value));
      continue;
    }
    if (arg.startsWith("--region=")) {
      extra.push("--region", assertKimiRegion(arg.slice("--region=".length)));
      continue;
    }
    if (REJECTED_LAUNCH_ARGS.has(arg) || arg.startsWith("-")) {
      throw new KimiProtocolError(`Kimi Code ACP runner rejects agent arg ${arg}`, "agent-args");
    }
    throw new KimiProtocolError(
      `Kimi Code ACP runner only accepts an optional --region agent arg, rejected ${arg}`,
      "agent-args",
    );
  }
  return extra;
}

function assertKimiRegion(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!(KIMI_ACP_REGIONS as readonly string[]).includes(normalized)) {
    throw new KimiProtocolError(
      `--region must be one of ${KIMI_ACP_REGIONS.join(", ")}`,
      "agent-args",
    );
  }
  return normalized;
}

/**
 * Kimi Code does not read provider credentials from the ambient environment,
 * so the foreign keys are stripped and an explicit environment (prepared by the
 * launch layer) is used verbatim.
 */
export function buildKimiChildEnv(
  explicit: NodeJS.ProcessEnv | undefined,
  fallback: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (explicit) {
    return { ...explicit };
  }
  const child: NodeJS.ProcessEnv = { ...fallback };
  for (const key of KIMI_FOREIGN_CREDENTIAL_ENV_KEYS) {
    delete child[key];
  }
  return child;
}

export function isKimiResumableSessionId(value: string | null | undefined): boolean {
  const id = String(value ?? "").trim();
  return id.startsWith(KIMI_ACP_SESSION_PREFIX) && id.length > KIMI_ACP_SESSION_PREFIX.length;
}

const KIMI_COMPLETED_STOP_REASONS = new Set(["end", "end_turn", "stop"]);

export function isKimiCompletedStopReason(stopReason: string | null | undefined): boolean {
  const normalized = String(stopReason ?? "").trim().toLowerCase();
  return KIMI_COMPLETED_STOP_REASONS.has(normalized);
}

export function isKimiCancelledStopReason(stopReason: string | null | undefined): boolean {
  return String(stopReason ?? "").trim().toLowerCase() === "cancelled";
}

export function resolveKimiHostResumeId(
  sessionId: string | null | undefined,
  mappedSessionId: string | null | undefined,
): string | null {
  for (const candidate of [mappedSessionId, sessionId]) {
    if (isKimiResumableSessionId(candidate)) {
      return String(candidate).trim();
    }
  }
  return null;
}

export function buildKimiInitializeParams(): Record<string, unknown> {
  // No clientCapabilities are advertised, so the agent keeps file and terminal
  // work in-process instead of routing fs/terminal reverse-RPC at the extension.
  return {
    protocolVersion: KIMI_ACP_PROTOCOL_VERSION,
    clientInfo: {
      name: KIMI_ACP_CLIENT_NAME,
      version: KIMI_ACP_CLIENT_VERSION,
    },
  };
}

export function buildKimiSessionNewParams(cwd: string): Record<string, unknown> {
  return {
    cwd,
    mcpServers: [],
  };
}

export function buildKimiSessionResumeParams(sessionId: string, cwd: string): Record<string, unknown> {
  return {
    sessionId,
    cwd,
    mcpServers: [],
  };
}

export function buildKimiSessionCloseParams(sessionId: string): Record<string, unknown> {
  return { sessionId };
}

export function buildKimiSessionCancelParams(sessionId: string): Record<string, unknown> {
  return { sessionId };
}

export function buildKimiSessionPromptParams(sessionId: string, text: string): Record<string, unknown> {
  return {
    sessionId,
    prompt: [{ type: "text", text }],
  };
}

export function buildKimiSetConfigOptionParams(
  sessionId: string,
  configId: string,
  value: string,
): Record<string, unknown> {
  return {
    sessionId,
    configId,
    value,
  };
}

export function buildKimiSetModeParams(sessionId: string, modeId: string): Record<string, unknown> {
  return { sessionId, modeId };
}

export function buildKimiPermissionResult(decision: KimiPermissionDecision): Record<string, unknown> {
  if (decision.outcome === "selected") {
    return { outcome: { outcome: "selected", optionId: decision.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

export function readKimiSessionId(result: unknown): string | null {
  const record = asRecord(result);
  const sessionId = record?.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
}

export function readKimiPromptStopReason(result: unknown): string | null {
  const record = asRecord(result);
  const stopReason = record?.stopReason;
  return typeof stopReason === "string" && stopReason.trim() ? stopReason : null;
}

export function formatKimiRpcError(error: unknown): KimiProtocolError {
  const record = asRecord(error);
  const message = typeof record?.message === "string" && record.message.trim()
    ? record.message
    : "ACP request failed";
  const rpcCode = typeof record?.code === "number" ? record.code : -32603;
  const turnFailed = /turn failed/i.test(message);
  return new KimiProtocolError(message, turnFailed ? "turn-failed" : "rpc-error", rpcCode);
}

export function buildKimiMethodNotFoundError(method: string): { code: number; message: string; data: { method: string } } {
  return {
    code: KIMI_JSONRPC_METHOD_NOT_FOUND,
    message: `"Method not found": ${method}`,
    data: { method },
  };
}

export function readKimiConfigOptions(source: unknown): KimiConfigOption[] {
  const list = findConfigOptions(source);
  if (!list) {
    return [];
  }
  const options: KimiConfigOption[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || record.id.length === 0) {
      continue;
    }
    options.push({
      id: record.id,
      name: typeof record.name === "string" ? record.name : undefined,
      category: typeof record.category === "string" ? record.category : undefined,
      currentValue: typeof record.currentValue === "string" ? record.currentValue : undefined,
      values: collectSelectValues(record.options),
      raw: record,
    });
  }
  return options;
}

export function readKimiConfigOption(
  options: readonly KimiConfigOption[],
  id: string,
): KimiConfigOption | null {
  return options.find((option) => option.id === id) ?? null;
}

/** Mode ids come from `modes.availableModes` (default|plan|auto|yolo). */
export function readKimiModeState(result: unknown): { currentModeId: string | null; available: string[] } {
  const record = asRecord(result);
  const modes = asRecord(record?.modes);
  const current = typeof modes?.currentModeId === "string" && modes.currentModeId.trim()
    ? modes.currentModeId.trim()
    : null;
  const available: string[] = [];
  if (Array.isArray(modes?.availableModes)) {
    for (const item of modes.availableModes) {
      const mode = asRecord(item);
      if (mode && typeof mode.id === "string" && mode.id.trim()) {
        available.push(mode.id.trim());
      }
    }
  }
  return { currentModeId: current, available };
}

/**
 * The ACP model config option value is the `[models.<alias>]` alias, but the
 * display name can differ (`display_name`), so both are accepted for matching.
 */
export function assertAdvertisedKimiModel(
  model: string,
  option: KimiConfigOption | null,
): string {
  const requested = String(model ?? "").trim();
  if (!requested) {
    throw new KimiProtocolError("Kimi Code model is empty", "model-empty");
  }
  if (!option) {
    throw new KimiProtocolError(
      "Kimi Code ACP did not advertise a model config option; configure [models] in config.toml",
      "model-not-advertised",
    );
  }
  const matched = option.values.find((value) => value === requested)
    ?? option.values.find((value) => value.toLowerCase() === requested.toLowerCase());
  if (matched) {
    return matched;
  }
  const matchedByLabel = option.values.find((value) => labelForValue(option, value)?.toLowerCase() === requested.toLowerCase());
  if (matchedByLabel) {
    return matchedByLabel;
  }
  throw new KimiProtocolError(
    `model ${JSON.stringify(requested)} is not advertised; available: ${option.values.join(", ") || "(none)"}`,
    "model-not-advertised",
  );
}

export function assertAdvertisedKimiThinking(
  thinking: string,
  option: KimiConfigOption | null,
): string {
  const requested = String(thinking ?? "").trim();
  if (!requested) {
    throw new KimiProtocolError("Kimi Code thinking effort is empty", "thinking-empty");
  }
  if (option && option.values.includes(requested)) {
    return requested;
  }
  throw new KimiProtocolError(
    `thinking ${JSON.stringify(requested)} is not advertised; available: ${option?.values.join(", ") || "(none)"}`,
    "thinking-not-advertised",
  );
}

export function readKimiTokenUsageUpdate(used: unknown, size: unknown): KimiTokenUsageUpdate | null {
  if (!isRealTokenCount(used) || !isRealTokenCount(size) || size <= 0) {
    return null;
  }
  return { tokensInContextWindow: used, modelContextWindow: size };
}

export function readKimiCompactionUpdate(text: string): KimiCompactionUpdate | null {
  if (/^Compacting conversation context(?:…|\.\.\.)(?:\n|$)/.test(text)
    || /^Compacting conversation context with instruction: .+(?:\n|$)/.test(text)
    || /^Context compaction started — it runs in the background and the compacted context applies once it finishes\.(?:\n|$)/.test(text)) {
    return { status: "started", text };
  }
  if (/^Compaction completed\.(?:\n|$)/.test(text)) {
    return { status: "completed", text };
  }
  if (/^Compaction cancelled\.(?:\n|$)/.test(text)) {
    return { status: "cancelled", text };
  }
  if (/^Compaction is blocked by the current turn; retry when the turn is idle\.(?:\n|$)/.test(text)) {
    return { status: "blocked", text };
  }
  return null;
}

export function acceptKimiIncrementalText(tracker: Map<string, string>, key: string, text: string): string | null {
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

export function extractKimiText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractKimiText(item)).join("");
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  if ("content" in record) {
    return extractKimiText(record.content);
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  return "";
}

export function projectKimiToolUpdate(
  previous: KimiToolProjection | undefined,
  next: {
    toolCallId: string;
    title?: string;
    kind?: string;
    status?: string;
    rawInput?: unknown;
    contentText: string;
  },
): { state: KimiToolProjection; trace: string | null } {
  const rawInput = next.rawInput ?? previous?.rawInput;
  const state: KimiToolProjection = {
    toolCallId: next.toolCallId,
    status: next.status || previous?.status || "in_progress",
    title: next.title || previous?.title || next.toolCallId,
    ...(next.kind || previous?.kind ? { kind: next.kind || previous?.kind } : {}),
    ...(rawInput === undefined ? {} : { rawInput }),
    contentText: previous?.contentText ?? "",
  };
  if (next.contentText && next.contentText !== state.contentText) {
    state.contentText = state.contentText && next.contentText.startsWith(state.contentText)
      ? next.contentText
      : `${state.contentText}${state.contentText ? "\n" : ""}${next.contentText}`;
  }
  const trace = formatKimiToolTrace(state);
  return {
    state,
    trace: trace && (!previous || trace !== formatKimiToolTrace(previous)) ? trace : null,
  };
}

function formatKimiToolTrace(state: KimiToolProjection): string {
  const input = asRecord(state.rawInput);
  const command = input ? readKimiToolText(input, ["command", "cmd", "script"]) : "";
  const failedOutput = ["failed", "error"].includes(state.status.toLowerCase())
    ? state.contentText.trim().split(/\r?\n/).filter(Boolean).slice(0, 2).join("\n").slice(0, 600)
    : "";
  if (command) {
    return [`exec ${command}`, failedOutput].filter(Boolean).join("\n");
  }
  return [`tool ${state.title}`, failedOutput].filter(Boolean).join("\n");
}

function readKimiToolText(input: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function extractKimiTaskListItems(value: unknown): KimiTaskListItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: KimiTaskListItem[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const text = typeof record?.content === "string"
      ? record.content
      : typeof record?.text === "string"
        ? record.text
        : "";
    if (!text.trim()) {
      return null;
    }
    const status = typeof record?.status === "string" ? record.status.trim().toLowerCase() : "";
    items.push({ text: text.trim(), done: ["completed", "complete", "done"].includes(status) });
  }
  return items;
}

export function readKimiUpdateSessionId(message: KimiJsonRpcMessage): string | null {
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

export function readKimiSessionUpdateBody(message: KimiJsonRpcMessage): Record<string, unknown> | null {
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

export function classifyKimiSessionUpdate(update: Record<string, unknown>): KimiSessionUpdate {
  const kind = update.sessionUpdate;
  if (kind === "agent_message_chunk") {
    return {
      type: "assistant_text",
      messageId: typeof update.messageId === "string" ? update.messageId : "",
      text: extractKimiText(update.content),
    };
  }
  if (kind === "agent_thought_chunk") {
    return {
      type: "thinking",
      messageId: typeof update.messageId === "string" ? update.messageId : "",
      text: extractKimiText(update.content),
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
      kind: typeof update.kind === "string" ? update.kind : undefined,
      status: typeof update.status === "string" ? update.status : undefined,
      rawInput: update.rawInput,
      contentText: extractKimiText(update.content),
    };
  }
  if (kind === "plan" || kind === "plan_update") {
    const plan = asRecord(update.plan) ?? update;
    const items = extractKimiTaskListItems(plan.entries);
    if (!items) {
      return { type: "ignored" };
    }
    return {
      type: "plan",
      planId: typeof plan.planId === "string" ? plan.planId : "",
      items,
    };
  }
  if (kind === "plan_removed") {
    return {
      type: "plan_removed",
      planId: typeof update.planId === "string" ? update.planId : "",
    };
  }
  if (kind === "current_mode_update") {
    return {
      type: "mode",
      modeId: typeof update.currentModeId === "string" ? update.currentModeId : "",
    };
  }
  if (kind === "config_option_update") {
    const configOptions = readKimiConfigOptions(update);
    return configOptions.length > 0 ? { type: "config", configOptions } : { type: "ignored" };
  }
  if (kind === "usage_update") {
    return { type: "usage", used: update.used, size: update.size };
  }
  return { type: "ignored" };
}

export type KimiPermissionOffer = {
  sessionId: string | null;
  optionIds: string[];
  approveOptionId: string | null;
  rejectOptionId: string | null;
  toolCallId: string | null;
  toolTitle: string | null;
};

export function readKimiPermissionOffer(params: unknown): KimiPermissionOffer {
  const record = asRecord(params);
  const sessionId = typeof record?.sessionId === "string" && record.sessionId
    ? record.sessionId
    : null;
  const optionIds: string[] = [];
  let approveOptionId: string | null = null;
  let rejectOptionId: string | null = null;
  if (Array.isArray(record?.options)) {
    for (const item of record.options) {
      const option = asRecord(item);
      if (!option || typeof option.optionId !== "string" || !option.optionId) {
        continue;
      }
      optionIds.push(option.optionId);
      const kind = typeof option.kind === "string" ? option.kind : "";
      if (!approveOptionId && (kind === "allow_once" || kind === "allow_always")) {
        approveOptionId = option.optionId;
      }
      if (!rejectOptionId && (kind === "reject_once" || kind === "reject_always")) {
        rejectOptionId = option.optionId;
      }
    }
  }
  const toolCall = asRecord(record?.toolCall);
  return {
    sessionId,
    optionIds,
    approveOptionId: approveOptionId
      ?? (optionIds.includes(KIMI_PERMISSION_APPROVE_ONCE) ? KIMI_PERMISSION_APPROVE_ONCE : null),
    rejectOptionId: rejectOptionId
      ?? (optionIds.includes(KIMI_PERMISSION_REJECT) ? KIMI_PERMISSION_REJECT : null),
    toolCallId: typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : null,
    toolTitle: typeof toolCall?.title === "string" ? toolCall.title : null,
  };
}

/**
 * The IDE has no interactive approval UI for this runner, and the repository's
 * existing CLIs already run with approvals bypassed, so tool approval requests
 * resolve to the advertised allow option. Plan mode remains a hard stop.
 */
export function resolveKimiPermissionDecision(
  resolution: { result?: unknown; error?: unknown } | null | undefined,
  offer: KimiPermissionOffer,
  options: { allowTools: boolean } = { allowTools: true },
): KimiPermissionDecision {
  const explicit = readSelectedOptionId(resolution);
  if (explicit && offer.optionIds.includes(explicit)) {
    return { outcome: "selected", optionId: explicit };
  }
  if (options.allowTools && offer.approveOptionId) {
    return { outcome: "selected", optionId: offer.approveOptionId };
  }
  return { outcome: "cancelled" };
}

function readSelectedOptionId(
  resolution: { result?: unknown; error?: unknown } | null | undefined,
): string | null {
  const outcome = asRecord(asRecord(resolution?.result)?.outcome);
  if (outcome?.outcome !== "selected") {
    return null;
  }
  return typeof outcome.optionId === "string" && outcome.optionId ? outcome.optionId : null;
}

export function planKimiProcessTreeStop(
  platform: NodeJS.Platform,
  pid: number,
  stage: "initial" | "escalate" = "initial",
): KimiProcessStopStep | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  if (platform === "win32") {
    return stage === "initial" ? { kind: "taskkill", args: ["/PID", String(pid), "/T", "/F"] } : null;
  }
  return { kind: "signal", signal: stage === "initial" ? "SIGTERM" : "SIGKILL" };
}

export function redactKimiDiagnostic(text: string, env?: NodeJS.ProcessEnv): string {
  let output = String(text ?? "");
  for (const value of secretValues(env)) {
    output = output.split(value).join("[redacted]");
  }
  return output;
}

export function boundKimiDiagnostic(text: string, limit = KIMI_STDERR_REPORT_LIMIT): string {
  const value = String(text ?? "");
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n…[truncated]`;
}

export function findKimiForbiddenWire(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method : "";
  if (method && (KIMI_FORBIDDEN_METHODS as readonly string[]).includes(method)) {
    return method;
  }
  return null;
}

function labelForValue(option: KimiConfigOption, value: string): string | null {
  const items = option.raw.options;
  if (!Array.isArray(items)) {
    return null;
  }
  for (const item of items) {
    const record = asRecord(item);
    if (record && record.value === value && typeof record.name === "string") {
      return record.name;
    }
  }
  return null;
}

function findConfigOptions(source: unknown): unknown[] | null {
  if (Array.isArray(source)) {
    return source;
  }
  const record = asRecord(source);
  if (!record) {
    return null;
  }
  if (Array.isArray(record.configOptions)) {
    return record.configOptions;
  }
  if (Array.isArray(record.config_options)) {
    return record.config_options;
  }
  return null;
}

function collectSelectValues(options: unknown): string[] {
  if (!Array.isArray(options)) {
    return [];
  }
  const values: string[] = [];
  for (const item of options) {
    const record = asRecord(item);
    const value = record && typeof record.value === "string" ? record.value : null;
    if (value && !values.includes(value)) {
      values.push(value);
    }
  }
  return values;
}

function isRealTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function secretValues(env: NodeJS.ProcessEnv | undefined): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!value || value.length < 8 || !SECRET_ENV_KEY.test(key)) {
      continue;
    }
    values.push(value);
  }
  return values;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
