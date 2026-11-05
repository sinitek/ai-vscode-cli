import * as TOML from "@iarna/toml";
import { createHash } from "crypto";
import { parseGrokToml, type GrokTomlTable } from "./grokToml";
import { parseJsonObjectText, isPlainObject } from "../shared/jsonObject";
import type {
  InternalProvider,
  ModelImportDraft,
  ModelImportPlatform,
  WireProtocol,
} from "./modelimporttypes";

export const MAX_URL_LENGTH = 4096;
export const MODEL_ID_MAX_LENGTH = 256;
export const CLAUDE_FIELD_KEYS = [
  "model",
  "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
  "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
  "env.CLAUDE_CODE_SUBAGENT_MODEL",
] as const;
export const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
export const CLOSED_DRAFT_KEYS: readonly string[] = ["content", "configContent", "authContent"];

export function record(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function cloneDraft(draft: ModelImportDraft): ModelImportDraft {
  return {
    ...(draft.content !== undefined ? { content: draft.content } : {}),
    ...(draft.configContent !== undefined ? { configContent: draft.configContent } : {}),
    ...(draft.authContent !== undefined ? { authContent: draft.authContent } : {}),
  };
}

export function safeIdentifier(value: string): boolean {
  return value.length <= 128 && value.length > 0 && !BLOCKED_KEYS.has(value)
    && !/[\u0000-\u001f\u007f/\\]/.test(value);
}

export function safeModelId(value: string): boolean {
  return value.length > 0 && value.length <= MODEL_ID_MAX_LENGTH
    && value === value.trim() && value !== "." && value !== ".."
    && !BLOCKED_KEYS.has(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isDshModelId(value: string): boolean {
  return safeModelId(value) && !/\s|\\/.test(value)
    && !/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/i.test(value);
}

export function safeFieldKey(value: string): boolean {
  return value.length <= 128 && !BLOCKED_KEYS.has(value) && /^[A-Za-z0-9_.-]+$/.test(value);
}

export function parseStrictJson(text: string, label: string): Record<string, unknown> {
  try {
    const parsed = parseJsonObjectText(text, { mode: "strict", rootErrorMessage: `${label} must be a JSON object.` });
    assertSafeJsonTree(parsed);
    return parsed;
  } catch {
    throw new Error(`${label} is invalid; correct it before importing models.`);
  }
}

export function parseJsoncObject(text: string, label: string): Record<string, unknown> {
  try {
    const parsed = parseJsonObjectText(text, { mode: "jsonc", rootErrorMessage: `${label} must be a JSON object.` });
    assertSafeJsonTree(parsed);
    return parsed;
  } catch {
    throw new Error(`${label} is invalid; correct it before importing models.`);
  }
}

export function assertSafeJsonTree(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error("Config nesting is too deep.");
  if (Array.isArray(value)) {
    for (const item of value) assertSafeJsonTree(item, depth + 1);
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    if (BLOCKED_KEYS.has(key)) throw new Error("Config contains an unsafe property name.");
    assertSafeJsonTree(child, depth + 1);
  }
}

export function parseToml(text: string, label: string): GrokTomlTable {
  try {
    TOML.parse(text);
  } catch {
    throw new Error(`${label} is invalid; correct it before importing models.`);
  }
  const parsed = parseGrokToml(text);
  if (!parsed.ok) throw new Error(`${label} is invalid; correct it before importing models.`);
  return parsed.value;
}

export function protocolFor(value: unknown): { kind: WireProtocol | null; label: string } {
  const normalized = stringValue(value).toLowerCase().replace(/[_ ]/g, "-");
  if (["responses", "openai-responses", "response"].includes(normalized)) {
    return { kind: "openai-responses", label: "openai-responses" };
  }
  if (["chat", "completions", "openai-completions", "chat-completions", "openai-chat-completions"].includes(normalized)) {
    return { kind: "openai-chat-completions", label: "openai-chat-completions" };
  }
  if (["messages", "anthropic-messages", "anthropic"].includes(normalized)) {
    return { kind: "anthropic-messages", label: "anthropic-messages" };
  }
  if (["google", "google-genai", "google-generative-ai"].includes(normalized)) {
    return { kind: "google-genai", label: "google-genai" };
  }
  if (normalized === "ollama-native") return { kind: "ollama-native", label: "ollama-native" };
  return { kind: null, label: "unsupported" };
}

export function sameOrigin(left: URL, right: URL): boolean {
  return left.protocol === right.protocol && left.hostname === right.hostname && left.port === right.port;
}

export function provider(
  id: string,
  label: string,
  baseUrl: unknown,
  protocol: unknown,
  mode: InternalProvider["mode"],
  config: Record<string, unknown>,
  credentials: { apiKey?: unknown; apiKeyEnv?: unknown } = {},
  allowUnauthenticated = false,
): InternalProvider {
  const parsedProtocol = protocolFor(protocol);
  const rawBaseUrl = stringValue(baseUrl);
  const rawKey = stringValue(credentials.apiKey);
  const rawId = stringValue(id) || "provider";
  const publicId = `provider-${createHash("sha256").update(rawId).digest("hex").slice(0, 20)}`;
  let urlError = "";
  if (rawBaseUrl) {
    try {
      const url = urlForRequest(rawBaseUrl);
      if (rawKey && urlContainsCredential(url, rawKey)) {
        urlError = "Provider URL contains credential material; configure the key in provider credentials instead.";
      }
    } catch (error) {
      urlError = error instanceof Error ? error.message : "Provider URL is invalid.";
    }
  }
  return {
    id: publicId,
    label: redactText(label || rawId, rawKey),
    baseUrl: rawBaseUrl ? redactText(displayUrl(rawBaseUrl, rawKey), rawKey) : "",
    requestBaseUrl: rawBaseUrl,
    protocol: parsedProtocol.label,
    protocolKind: parsedProtocol.kind,
    mode,
    sourceId: rawId,
    ...(urlError ? { disabledReason: urlError } : {}),
    ...(!urlError && !allowUnauthenticated && parsedProtocol.kind !== "ollama-native" && !rawKey
      ? { disabledReason: "此 provider 当前没有可用的 API key；检查草稿凭据或宿主环境变量。" }
      : {}),
    ...(typeof credentials.apiKey === "string" && credentials.apiKey.trim() ? { apiKey: credentials.apiKey.trim() } : {}),
    ...(typeof credentials.apiKeyEnv === "string" && credentials.apiKeyEnv.trim() ? { apiKeyEnv: credentials.apiKeyEnv.trim() } : {}),
    existingModelIds: [],
    config,
  };
}

export function disabled(providerValue: InternalProvider, reason: string): InternalProvider {
  return { ...providerValue, disabledReason: reason };
}

export function safeLabel(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160);
  return normalized.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]") || "Unnamed provider";
}

export function redactText(value: string, secret: string): string {
  const safe = safeLabel(value);
  return secret ? safe.split(secret).join("[redacted]") : safe;
}

export function urlForRequest(value: string): URL {
  if (!value || value.length > MAX_URL_LENGTH || /[\u0000-\u0020\u007f\\]/.test(value)) {
    throw new Error("Provider URL is invalid.");
  }
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) throw new Error("Provider URL contains encoded control characters.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provider URL is invalid.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("Provider URL must be an HTTP(S) URL without credentials or fragment.");
  }
  for (const key of url.searchParams.keys()) {
    if (/(?:api[_-]?key|access[_-]?key|token|secret|password|authorization|credential|^key$|^auth$|^sig(?:nature)?$)/i.test(key)) {
      throw new Error("Provider URL query contains credential material; configure the key in the provider credentials instead.");
    }
  }
  return url;
}

export function decodedUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function urlContainsCredential(url: URL, secret: string): boolean {
  return textContainsSecret(url.pathname, secret)
    || [...url.searchParams.values()].some((value) => textContainsSecret(value, secret));
}

export function textContainsSecret(value: string, secret: string): boolean {
  let current = value;
  for (let pass = 0; pass < 4; pass += 1) {
    if (current.includes(secret)) return true;
    const decoded = decodedUrlPart(current);
    if (decoded === current) break;
    current = decoded;
  }
  return false;
}

export function containsCredential(value: string, providerValue: InternalProvider): boolean {
  return Boolean(providerValue.apiKey && textContainsSecret(value, providerValue.apiKey))
    || /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/i.test(value);
}

export function displayUrl(value: string, secret = ""): string {
  try {
    const url = urlForRequest(value);
    url.search = "";
    url.hash = "";
    const displayed = url.toString().replace(/\/$/, "");
    if (!secret) return displayed;
    if (textContainsSecret(url.pathname, secret)) url.pathname = "/[redacted]";
    return url.toString().replace(/\/$/, "").split(secret).join("[redacted]");
  } catch {
    return "";
  }
}

export function envReference(value: unknown): string | undefined {
  const raw = stringValue(value);
  const match = /^(?:\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\{env:([^}]+)\})$/.exec(raw);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function resolveCredential(value: unknown, envName: unknown, env: NodeJS.ProcessEnv): { apiKey?: string; apiKeyEnv?: string } {
  const literal = stringValue(value);
  if (literal && !envReference(value)) {
    return { apiKey: literal, ...(stringValue(envName) ? { apiKeyEnv: stringValue(envName) } : {}) };
  }
  const ref = envReference(value) ?? (stringValue(envName) || undefined);
  if (ref && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
    const fromEnv = env[ref];
    return { ...(fromEnv ? { apiKey: fromEnv } : {}), apiKeyEnv: ref };
  }
  return {};
}

export function resolveConfigString(value: unknown, env: NodeJS.ProcessEnv): string {
  const reference = envReference(value);
  return reference ? stringValue(env[reference]) : stringValue(value);
}

export function authFromJson(content: string | undefined, env: NodeJS.ProcessEnv): { apiKey?: string; apiKeyEnv?: string } {
  let parsed: Record<string, unknown> = {};
  if (content?.trim()) {
    parsed = parseStrictJson(content, "Codex authContent");
  }
  return Object.prototype.hasOwnProperty.call(parsed, "OPENAI_API_KEY")
    ? resolveCredential(parsed.OPENAI_API_KEY, undefined, env)
    : {};
}

export function configText(draft: ModelImportDraft, platform: ModelImportPlatform): string {
  if (platform === "codex" || platform === "opencode") return draft.configContent ?? draft.content ?? "";
  return draft.content ?? draft.configContent ?? "";
}

export function addModels(existing: string[], values: Iterable<string>): string[] {
  const seen = new Set(existing);
  for (const value of values) if (safeModelId(value) && !seen.has(value)) { existing.push(value); seen.add(value); }
  return existing;
}

export function modelImportAlias(models: Record<string, unknown>, providerId: string, modelId: string): string {
  const current = models[modelId];
  if (current === undefined) return modelId;
  const providerAlias = `${providerId}/${modelId}`;
  if (models[providerAlias] === undefined) return providerAlias;
  const suffix = createHash("sha256").update(`${providerId}\u0000${modelId}`).digest("hex").slice(0, 10);
  let candidate = `${providerAlias}-${suffix}`;
  let index = 2;
  while (models[candidate] !== undefined) {
    candidate = `${providerAlias}-${suffix}-${index}`;
    index += 1;
  }
  return candidate;
}

export function redactCredential(value: string, providerValue: InternalProvider): string {
  let result = safeLabel(value);
  const secret = providerValue.apiKey;
  if (secret && textContainsSecret(result, secret)) {
    let decoded = result;
    for (let pass = 0; pass < 4; pass += 1) {
      const next = decodedUrlPart(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    result = decoded.includes(secret) ? "[redacted]" : result.split(secret).join("[redacted]");
  }
  return result;
}

export function visibleModelId(value: string, providerValue: InternalProvider): boolean {
  return safeModelId(value) && !containsCredential(value, providerValue);
}
