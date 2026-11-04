import { applyEdits, findNodeAtLocation, getNodeValue, modify, parse as parseJsonc, parseTree } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import * as TOML from "@iarna/toml";
import { createHash } from "crypto";
import { parseGrokToml, type GrokTomlTable, type GrokTomlValue } from "./grokToml";
import { normalizeConfigPlatform } from "./configPaths";
import { parseJsonObjectText, isPlainObject } from "../shared/jsonObject";
import type { CurrentConfigPlatform } from "./types";
import { commitDshDocument } from "../cli/dshConfigModels";
import { validateGrokDocument } from "./grokConfig";
import { validateKimiCodeDocument } from "./kimiCodeConfig";

export type ModelImportPlatform = CurrentConfigPlatform;

export type ModelImportDraft = {
  content?: string;
  configContent?: string;
  authContent?: string;
};

export type ModelImportProvider = {
  id: string;
  label: string;
  baseUrl: string;
  protocol: string;
  mode: "multi" | "single" | "claude";
  disabledReason?: string;
};

export type ModelImportModel = { id: string; label: string };

export type ModelImportField = { key: string; label: string; value: string };

export type ModelImportPayload = {
  platform: ModelImportPlatform;
  draft: ModelImportDraft;
};

export type DiscoverImportModelsPayload = ModelImportPayload & { providerId: string };

export type ApplyModelImportPayload = DiscoverImportModelsPayload & {
  selectedModelIds: string[];
  fields?: Record<string, string>;
};

export type ModelImportProvidersResult = { providers: ModelImportProvider[] };
export type DiscoverImportModelsResult = {
  models: ModelImportModel[];
  existingModelIds: string[];
  fields?: ModelImportField[];
};
export type ApplyModelImportResult = { draft: ModelImportDraft };

export type ModelImportFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ModelImportOptions = {
  fetch?: ModelImportFetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxPages?: number;
  maxModels?: number;
};

type WireProtocol = "openai-chat-completions" | "openai-responses" | "anthropic-messages" | "google-genai" | "ollama-native";
type ProviderMode = ModelImportProvider["mode"];

type InternalProvider = ModelImportProvider & {
  protocolKind: WireProtocol | null;
  requestBaseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  anthropicAuthToken?: boolean;
  sourceId: string;
  existingModelIds: string[];
  config: Record<string, unknown>;
};

const MAX_URL_LENGTH = 4096;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_MODELS = 500;
const MODEL_ID_MAX_LENGTH = 256;
const CLAUDE_FIELD_KEYS = [
  "model",
  "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
  "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
  "env.CLAUDE_CODE_SUBAGENT_MODEL",
] as const;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MODEL_IMPORT_PLATFORMS = ["claude", "codex", "opencode", "grok", "dsh", "kimi-code", "zcode"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneDraft(draft: ModelImportDraft): ModelImportDraft {
  return {
    ...(draft.content !== undefined ? { content: draft.content } : {}),
    ...(draft.configContent !== undefined ? { configContent: draft.configContent } : {}),
    ...(draft.authContent !== undefined ? { authContent: draft.authContent } : {}),
  };
}

function assertPayload(payload: unknown, action: string, allowedKeys = ["platform", "draft"]): ModelImportPayload {
  const input = record(payload);
  if (!input) throw new Error(`${action} payload must be an object.`);
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`${action} payload contains an unsupported field.`);
  }
  const platform = input.platform;
  if (typeof platform !== "string" || !MODEL_IMPORT_PLATFORMS.includes(platform as ModelImportPlatform)) {
    throw new Error(`${action} platform is unsupported.`);
  }
  let normalized: CurrentConfigPlatform;
  try {
    normalized = normalizeConfigPlatform(platform as ModelImportPlatform) as CurrentConfigPlatform;
  } catch {
    throw new Error(`${action} platform is unsupported.`);
  }
  const draft = record(input.draft);
  if (!draft) throw new Error(`${action} draft is required.`);
  for (const key of Object.keys(draft)) {
    if (!["content", "configContent", "authContent"].includes(key)) {
      throw new Error(`${action} draft contains an unsupported field.`);
    }
    if (draft[key] !== undefined && typeof draft[key] !== "string") {
      throw new Error(`${action} draft.${key} must be a string.`);
    }
    if (typeof draft[key] === "string" && (draft[key] as string).length > 2 * 1024 * 1024) {
      throw new Error(`${action} draft exceeds the maximum size.`);
    }
  }
  return {
    platform: normalized,
    draft: cloneDraft(draft as ModelImportDraft),
  };
}

function assertProviderPayload(payload: unknown, action: string, extraKeys: string[] = []): DiscoverImportModelsPayload {
  const base = assertPayload(payload, action, ["platform", "draft", "providerId", ...extraKeys]);
  const input = record(payload);
  const providerId = stringValue(input?.providerId);
  if (!providerId || !safeIdentifier(providerId)) throw new Error(`${action} providerId is invalid.`);
  return { ...base, providerId };
}

function assertApplyPayload(payload: unknown): ApplyModelImportPayload {
  const base = assertProviderPayload(payload, "applyModelImport", ["selectedModelIds", "fields"]);
  const input = record(payload);
  const selected = input?.selectedModelIds;
  if (!Array.isArray(selected) || selected.length > 1000 || selected.some((value) => typeof value !== "string")) {
    throw new Error("applyModelImport selectedModelIds must be a string array.");
  }
  const selectedModelIds = selected.map((value) => value.trim());
  if (selectedModelIds.some((value) => !safeModelId(value))) {
    throw new Error("applyModelImport contains an invalid model id.");
  }
  if (new Set(selectedModelIds).size !== selectedModelIds.length) {
    throw new Error("applyModelImport selectedModelIds contains duplicates.");
  }
  const fields = input?.fields;
  if (fields !== undefined) {
    const fieldRecord = record(fields);
    if (base.platform !== "claude" || !fieldRecord || Object.entries(fieldRecord).some(([key, value]) => (
      !safeFieldKey(key) || !(CLAUDE_FIELD_KEYS as readonly string[]).includes(key)
      || typeof value !== "string" || (value.trim() !== "" && !safeModelId(value.trim()))
    ))) {
      throw new Error("applyModelImport fields are invalid.");
    }
    return { ...base, selectedModelIds, fields: Object.fromEntries(
      Object.entries(fieldRecord).map(([key, value]) => [key, String(value).trim()]),
    ) };
  }
  return { ...base, selectedModelIds };
}

function safeIdentifier(value: string): boolean {
  return value.length <= 128 && value.length > 0 && !BLOCKED_KEYS.has(value)
    && !/[\u0000-\u001f\u007f/\\]/.test(value);
}

function safeModelId(value: string): boolean {
  return value.length > 0 && value.length <= MODEL_ID_MAX_LENGTH
    && value === value.trim() && value !== "." && value !== ".."
    && !BLOCKED_KEYS.has(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isDshModelId(value: string): boolean {
  return safeModelId(value) && !/\s|\\/.test(value)
    && !/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/i.test(value);
}

function safeFieldKey(value: string): boolean {
  return value.length <= 128 && !BLOCKED_KEYS.has(value) && /^[A-Za-z0-9_.-]+$/.test(value);
}

function parseStrictJson(text: string, label: string): Record<string, unknown> {
  try {
    const parsed = parseJsonObjectText(text, { mode: "strict", rootErrorMessage: `${label} must be a JSON object.` });
    assertSafeJsonTree(parsed);
    return parsed;
  } catch {
    throw new Error(`${label} is invalid; correct it before importing models.`);
  }
}

function parseJsoncObject(text: string, label: string): Record<string, unknown> {
  try {
    const parsed = parseJsonObjectText(text, { mode: "jsonc", rootErrorMessage: `${label} must be a JSON object.` });
    assertSafeJsonTree(parsed);
    return parsed;
  } catch {
    throw new Error(`${label} is invalid; correct it before importing models.`);
  }
}

function assertSafeJsonTree(value: unknown, depth = 0): void {
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

function parseToml(text: string, label: string): GrokTomlTable {
  try {
    TOML.parse(text);
  } catch {
    throw new Error(`${label} is invalid; correct it before importing models.`);
  }
  const parsed = parseGrokToml(text);
  if (!parsed.ok) throw new Error(`${label} is invalid; correct it before importing models.`);
  return parsed.value;
}

function protocolFor(value: unknown): { kind: WireProtocol | null; label: string } {
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

function provider(
  id: string,
  label: string,
  baseUrl: unknown,
  protocol: unknown,
  mode: ProviderMode,
  config: Record<string, unknown>,
  credentials: { apiKey?: unknown; apiKeyEnv?: unknown } = {},
  allowUnauthenticated = false,
): InternalProvider {
  const parsedProtocol = protocolFor(protocol);
  const rawBaseUrl = stringValue(baseUrl);
  const rawKey = stringValue(credentials.apiKey);
  const rawKeyEnv = stringValue(credentials.apiKeyEnv);
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

function disabled(providerValue: InternalProvider, reason: string): InternalProvider {
  return { ...providerValue, disabledReason: reason };
}

function safeLabel(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160);
  return normalized.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]") || "Unnamed provider";
}

function redactText(value: string, secret: string): string {
  const safe = safeLabel(value);
  return secret ? safe.split(secret).join("[redacted]") : safe;
}

function urlForRequest(value: string): URL {
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

function decodedUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function urlContainsCredential(url: URL, secret: string): boolean {
  return textContainsSecret(url.pathname, secret)
    || [...url.searchParams.values()].some((value) => textContainsSecret(value, secret));
}

function textContainsSecret(value: string, secret: string): boolean {
  let current = value;
  for (let pass = 0; pass < 4; pass += 1) {
    if (current.includes(secret)) return true;
    const decoded = decodedUrlPart(current);
    if (decoded === current) break;
    current = decoded;
  }
  return false;
}

function containsCredential(value: string, providerValue: InternalProvider): boolean {
  return Boolean(providerValue.apiKey && textContainsSecret(value, providerValue.apiKey))
    || /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/i.test(value);
}

function displayUrl(value: string, secret = ""): string {
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

function baseUrl(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) return "";
  urlForRequest(raw);
  return raw.replace(/\/+$/, "");
}

function endpoint(base: string, segment: string): URL {
  const url = urlForRequest(base);
  const current = url.pathname.replace(/\/+$/, "");
  if (!current.endsWith(`/${segment}`) && current !== segment) {
    url.pathname = `${current}/${segment}`.replace(/^([^/])/, "/$1");
  }
  return url;
}

function modelListEndpoint(base: string, protocol: WireProtocol): URL {
  const url = urlForRequest(base);
  if (/%(?:2f|2e|5c)/i.test(url.pathname)) throw new Error("Provider URL contains an encoded path separator.");
  const path = decodedUrlPart(url.pathname).replace(/\/+$/, "");
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Provider URL contains an unsafe path.");
  }
  if (protocol === "ollama-native") {
    if (/(?:^|\/)api$/i.test(path)) url.pathname = `${path}/tags`;
    else if (!/(?:^|\/)api\/tags$/i.test(path)) url.pathname = `${path}/api/tags` || "/api/tags";
    return url;
  }
  if (/(?:^|\/)models$/i.test(path)) {
    url.pathname = path;
    return url;
  }
  const hasVersion = /(?:^|\/)v\d+(?:beta\d*|alpha\d*)?$/i.test(path);
  if (hasVersion) {
    url.pathname = `${path}/models`;
  } else if (!path) {
    url.pathname = protocol === "google-genai" ? "/v1beta/models" : "/v1/models";
  } else if (protocol === "anthropic-messages") {
    url.pathname = `${path}/v1/models`;
  } else if (protocol === "google-genai") {
    url.pathname = `${path}/v1beta/models`;
  } else {
    url.pathname = `${path}/models`;
  }
  return url;
}

function envReference(value: unknown): string | undefined {
  const raw = stringValue(value);
  const match = /^(?:\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\{env:([^}]+)\})$/.exec(raw);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function resolveCredential(value: unknown, envName: unknown, env: NodeJS.ProcessEnv): { apiKey?: string; apiKeyEnv?: string } {
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

function resolveConfigString(value: unknown, env: NodeJS.ProcessEnv): string {
  const reference = envReference(value);
  return reference ? stringValue(env[reference]) : stringValue(value);
}

function authFromJson(content: string | undefined, env: NodeJS.ProcessEnv): { apiKey?: string; apiKeyEnv?: string } {
  let parsed: Record<string, unknown> = {};
  if (content?.trim()) {
    parsed = parseStrictJson(content, "Codex authContent");
  }
  return Object.prototype.hasOwnProperty.call(parsed, "OPENAI_API_KEY")
    ? resolveCredential(parsed.OPENAI_API_KEY, undefined, env)
    : {};
}

function configText(draft: ModelImportDraft, platform: ModelImportPlatform): string {
  if (platform === "codex" || platform === "opencode") return draft.configContent ?? draft.content ?? "";
  return draft.content ?? draft.configContent ?? "";
}

function addModels(existing: string[], values: Iterable<string>): string[] {
  const seen = new Set(existing);
  for (const value of values) if (safeModelId(value) && !seen.has(value)) { existing.push(value); seen.add(value); }
  return existing;
}

function modelImportAlias(models: Record<string, unknown>, providerId: string, modelId: string): string {
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

function uniqueModels(values: string[]): string[] {
  return Array.from(new Set(values));
}

function openCodeProviders(draft: ModelImportDraft, env: NodeJS.ProcessEnv): InternalProvider[] {
  const document = parseJsoncObject(configText(draft, "opencode"), "OpenCode config");
  const providers = record(document.provider) ?? {};
  return Object.entries(providers).filter(([id]) => safeIdentifier(id)).map(([id, raw]) => {
    const value = record(raw) ?? {};
    const options = record(value.options) ?? {};
    const npm = stringValue(value.npm);
    const openAiPackages = new Set([
      "@ai-sdk/openai-compatible", "@ai-sdk/openai", "@ai-sdk/deepseek", "@ai-sdk/xai",
      "@ai-sdk/groq", "@ai-sdk/mistral", "@ai-sdk/togetherai", "@ai-sdk/perplexity",
      "@ai-sdk/cerebras", "@ai-sdk/fireworks", "@ai-sdk/deepinfra",
    ]);
    const kind = npm === "@ai-sdk/anthropic" ? "anthropic-messages"
      : npm === "@ai-sdk/google" ? "google-genai"
        : npm === "@ai-sdk/ollama" ? "ollama-native"
          : openAiPackages.has(npm) ? "openai-chat-completions" : "unsupported";
    const credentials = resolveCredential(options.apiKey, undefined, env);
    const item = provider(id, stringValue(value.name) || id, resolveConfigString(options.baseURL, env), kind, "multi", value, credentials);
    item.sourceId = id;
    const models = record(value.models) ?? {};
    item.existingModelIds = Object.keys(models).filter((modelId) => visibleModelId(modelId, item));
    if (!item.baseUrl) return disabled(item, "该 OpenCode provider 未配置 baseURL，无法安全发现模型。");
    if (!item.protocolKind) return disabled(item, "该 OpenCode provider 的 npm 协议未知，未套用 OpenAI 兼容接口。");
    return item;
  });
}

function codexProviders(draft: ModelImportDraft, env: NodeJS.ProcessEnv): InternalProvider[] {
  const config = parseToml(configText(draft, "codex"), "Codex config");
  const providers = record(config.model_providers) ?? {};
  const selected = stringValue(config.model_provider);
  const rootModel = stringValue(config.model);
  const names = [safeIdentifier(selected) ? selected : "codex"];
  return names.map((id) => {
    const value = record(providers[id]) ?? {};
    const effectiveWireApi = value.wire_api === undefined ? "responses" : value.wire_api;
    const protocol = protocolFor(effectiveWireApi);
    const envKey = stringValue(value.env_key);
    const bearerToken = stringValue(value.experimental_bearer_token);
    const requiresAuth = value.requires_openai_auth === true;
    const credentials = envKey ? resolveCredential(undefined, envKey, env)
      : bearerToken ? { apiKey: bearerToken }
        : requiresAuth ? authFromJson(draft.authContent, env) : {};
    const item = provider(id, stringValue(value.name) || id, value.base_url, effectiveWireApi, "single", value, credentials,
      !envKey && !bearerToken && !requiresAuth);
    item.sourceId = id;
    item.existingModelIds = selected === id && rootModel ? [rootModel] : [];
    if (!item.baseUrl) return disabled(item, "Codex provider 未配置 base_url，无法安全发现模型。");
    if (!protocol.kind || protocol.kind !== "openai-responses") return disabled(item, "当前 Codex 仅允许 Responses API；未知或非 Responses 协议不会伪装请求。");
    return item;
  });
}

function claudeProviders(draft: ModelImportDraft, env: NodeJS.ProcessEnv): InternalProvider[] {
  const document = parseJsoncObject(configText(draft, "claude"), "Claude settings");
  const values = record(document.env) ?? {};
  const runtimeEnv = { ...env };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") runtimeEnv[key] = value;
  }
  const token = resolveCredential(runtimeEnv.ANTHROPIC_AUTH_TOKEN, undefined, runtimeEnv);
  const credentials = token.apiKey ? token : resolveCredential(runtimeEnv.ANTHROPIC_API_KEY, undefined, runtimeEnv);
  const rawUrl = resolveConfigString(runtimeEnv.ANTHROPIC_BASE_URL, runtimeEnv);
  const item = provider("claude", "Claude", rawUrl, "anthropic-messages", "claude", values, credentials);
  item.anthropicAuthToken = Boolean(token.apiKey);
  item.existingModelIds = [document.model, values.ANTHROPIC_DEFAULT_HAIKU_MODEL, values.ANTHROPIC_DEFAULT_SONNET_MODEL,
    values.ANTHROPIC_DEFAULT_OPUS_MODEL, values.CLAUDE_CODE_SUBAGENT_MODEL]
    .filter((value): value is string => visibleModelId(stringValue(value), item));
  if (!item.baseUrl) return [disabled(item, "Claude 草稿未配置 ANTHROPIC_BASE_URL；为避免访问未配置地址，模型发现已禁用。")];
  return [item];
}

function grokProviders(draft: ModelImportDraft, env: NodeJS.ProcessEnv): InternalProvider[] {
  const document = parseToml(configText(draft, "grok"), "Grok config");
  const models = record(document.model) ?? {};
  const defaults = record(document.models) ?? {};
  const defaultId = stringValue(defaults.default);
  const entries = Object.entries(models).filter(([id, raw]) => safeModelId(id) && record(raw));
  entries.sort(([left], [right]) => Number(right === defaultId) - Number(left === defaultId));
  const providers = entries.map(([id, raw]) => {
    const selected = record(raw)!;
    const item = provider(id, `Grok · ${id}`, selected.base_url, selected.api_backend, "multi", selected,
      resolveCredential(selected.api_key, selected.env_key, env));
    if (!item.baseUrl) return disabled(item, "Grok 当前模型未配置有效 base_url。");
    if (!item.protocolKind) return disabled(item, "Grok 当前模型协议未知，未猜测接口。");
    return item;
  });
  const existingByProvider = new Map<string, string[]>();
  for (const item of providers) {
    const identity = JSON.stringify([item.requestBaseUrl.replace(/\/+$/, ""), item.protocolKind, item.apiKey]);
    const existing = existingByProvider.get(identity) ?? [];
    const modelId = stringValue(item.config.model) || item.sourceId;
    if (visibleModelId(modelId, item)) existing.push(modelId);
    existingByProvider.set(identity, existing);
    item.existingModelIds = existing;
  }
  return providers;
}

function dshProviders(draft: ModelImportDraft, env: NodeJS.ProcessEnv): InternalProvider[] {
  const source = configText(draft, "dsh");
  const document = parseStrictJson(source, "DSH profile");
  const api = stringValue(document.api);
  const item = provider("dsh", "DSH", document.baseURL, api, "multi", document,
    resolveCredential(document.apiKey, document.apiKeyEnv, env));
  const committed = commitDshDocument(source);
  if (!committed.ok) return [disabled(item, committed.error)];
  item.existingModelIds = committed.document.models
    .map((model) => stringValue(model.id)).filter((id) => visibleModelId(id, item));
  if (document.apiKeyEnv !== undefined && document.apiKeyEnv !== "SINITEK_DSH_API_KEY") {
    return [disabled(item, "DSH apiKeyEnv 必须保持 SINITEK_DSH_API_KEY。")];
  }
  if (!item.baseUrl) return [disabled(item, "DSH 未配置有效 baseURL。")];
  if (!item.protocolKind) return [disabled(item, "DSH API 协议不受模型列表适配器支持。")];
  return [item];
}

function kimiProviders(draft: ModelImportDraft, env: NodeJS.ProcessEnv): InternalProvider[] {
  const document = parseToml(configText(draft, "kimi-code"), "Kimi Code config");
  const rawProviders = record(document.providers) ?? {};
  const models = record(document.models) ?? {};
  const ids = Object.keys(rawProviders).filter(safeIdentifier);
  if (ids.length === 0) ids.push("kimi");
  return ids.map((id) => {
    const value = record(rawProviders[id]) ?? {};
    const providerType = stringValue(value.type);
    const providerEnv = record(value.env) ?? {};
    const endpointEnv: Record<string, [string, string][]> = {
      kimi: [["KIMI_API_KEY", "KIMI_BASE_URL"]],
      openai: [["OPENAI_API_KEY", "OPENAI_BASE_URL"]],
      openai_responses: [["OPENAI_API_KEY", "OPENAI_BASE_URL"]],
      anthropic: [["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]],
      "google-genai": [["VERTEXAI_API_KEY", "GOOGLE_VERTEX_BASE_URL"], ["GOOGLE_API_KEY", "GOOGLE_GEMINI_BASE_URL"]],
    };
    const endpoints = endpointEnv[providerType] ?? [];
    const key = endpoints.map(([keyName]) => providerEnv[keyName]).find((candidate) => stringValue(candidate));
    const url = endpoints.map(([, urlName]) => providerEnv[urlName]).find((candidate) => stringValue(candidate));
    const credentials = stringValue(value.api_key) || stringValue(value.api_key_env)
      ? resolveCredential(value.api_key, value.api_key_env, env)
      : resolveCredential(key, undefined, env);
    const protocol = providerType === "kimi" || providerType === "openai" ? "openai-chat-completions"
      : providerType === "openai_responses" ? "openai-responses"
        : providerType === "anthropic" ? "anthropic-messages"
          : providerType === "google-genai" ? "google-genai" : providerType;
    const item = provider(id, id, stringValue(value.base_url) || url, protocol, "multi", value, credentials);
    item.sourceId = id;
    item.existingModelIds = Object.entries(models).filter(([, raw]) => record(raw)?.provider === id)
      .map(([, raw]) => stringValue(record(raw)?.model)).filter((modelId) => visibleModelId(modelId, item));
    if (stringValue(value.api_key) && stringValue(value.api_key_env)) {
      return disabled(item, "Kimi Code provider 同时设置了 api_key 和 api_key_env，请只保留一种凭据来源。");
    }
    if (!item.baseUrl) return disabled(item, "Kimi Code provider 未配置 base_url。");
    if (!item.protocolKind) return disabled(item, "Kimi Code provider type 未知，未猜测接口。");
    return item;
  });
}

function zcodeProviders(draft: ModelImportDraft, env: NodeJS.ProcessEnv): InternalProvider[] {
  const document = parseStrictJson(configText(draft, "zcode"), "ZCode provider_config");
  const config = record(document.config) ?? {};
  const rules = record(config.providerConfigRules);
  const providerRules = Array.isArray(rules?.providerRules) ? rules.providerRules : [];
  return providerRules.map((raw) => record(raw)).filter((value): value is Record<string, unknown> => Boolean(value))
    .map((rule) => {
      const id = stringValue(rule.providerId);
      const value = record(rule.config) ?? {};
      const api = record(value.api) ?? {};
      const access = record(value.access) ?? {};
      const item = provider(id, stringValue(rule.providerName) || id, api.baseUrl, api.type, "multi", value,
        resolveCredential(access.apiKey, access.apiKeyEnv, env));
      item.sourceId = id;
      item.existingModelIds = (Array.isArray(value.personalModelIds) ? value.personalModelIds : [])
        .filter((modelId): modelId is string => visibleModelId(stringValue(modelId), item)).map((modelId) => modelId.trim());
      if (!id || !item.baseUrl) return disabled(item, "ZCode provider 未配置有效 baseUrl。");
      if (!item.protocolKind) return disabled(item, "ZCode api.type 未知，未猜测接口。");
      return item;
    });
}

function providersFor(payload: ModelImportPayload, options: ModelImportOptions): InternalProvider[] {
  const env = options.env ?? process.env;
  switch (payload.platform) {
    case "claude": return claudeProviders(payload.draft, env);
    case "codex": return codexProviders(payload.draft, env);
    case "opencode": return openCodeProviders(payload.draft, env);
    case "grok": return grokProviders(payload.draft, env);
    case "dsh": return dshProviders(payload.draft, env);
    case "kimi-code": return kimiProviders(payload.draft, env);
    case "zcode": return zcodeProviders(payload.draft, env);
  }
}

function publicProvider(item: InternalProvider): ModelImportProvider {
  const {
    protocolKind: _protocolKind,
    requestBaseUrl: _requestBaseUrl,
    apiKey: _apiKey,
    apiKeyEnv: _apiKeyEnv,
    sourceId: _sourceId,
    existingModelIds: _existing,
    config: _config,
    ...publicValue
  } = item;
  return publicValue;
}

function redactCredential(value: string, providerValue: InternalProvider): string {
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

function containsCredentialText(value: string, providerValue: InternalProvider): boolean {
  return Boolean(providerValue.apiKey && textContainsSecret(value, providerValue.apiKey))
    || /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/i.test(value);
}

function visibleModelId(value: string, providerValue: InternalProvider): boolean {
  return safeModelId(value) && !containsCredentialText(value, providerValue);
}

function modelFromResponse(value: unknown, providerValue: InternalProvider): ModelImportModel | null {
  const item = record(value);
  if (!item) return null;
  const rawId = stringValue(item.id) || stringValue(item.name).replace(/^models\//, "");
  if (!visibleModelId(rawId, providerValue)) return null;
  const rawLabel = stringValue(item.display_name) || stringValue(item.displayName) || stringValue(item.name) || rawId;
  return { id: rawId, label: redactCredential(rawLabel, providerValue).slice(0, 160) || rawId };
}

function assertSafeImportIds(payload: ApplyModelImportPayload, providerValue: InternalProvider): void {
  if (payload.selectedModelIds.some((modelId) => !visibleModelId(modelId, providerValue))) {
    throw new Error("Selected model id is not safe to import.");
  }
  if (payload.fields && Object.values(payload.fields).some((modelId) => containsCredentialText(modelId, providerValue))) {
    throw new Error("Claude model mapping contains credential material.");
  }
}

function authHeaders(providerValue: InternalProvider): Record<string, string> {
  const key = providerValue.apiKey;
  if (!key) return {};
  switch (providerValue.protocolKind) {
    case "anthropic-messages": return providerValue.anthropicAuthToken
      ? { authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" }
      : { "x-api-key": key, "anthropic-version": "2023-06-01" };
    case "google-genai": return { "x-goog-api-key": key };
    default: return { authorization: `Bearer ${key}` };
  }
}

async function readLimited(response: Response, limit: number): Promise<string> {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Provider response is too large.");
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > limit) throw new Error("Provider response is too large.");
  return text;
}

function sameOrigin(left: URL, right: URL): boolean {
  return left.protocol === right.protocol && left.hostname === right.hostname && left.port === right.port;
}

async function fetchJson(providerValue: InternalProvider, url: URL, options: ModelImportOptions): Promise<{ value: unknown; headers: Headers }> {
  const fetcher = options.fetch ?? ((globalThis as { fetch?: ModelImportFetch }).fetch);
  if (!fetcher) throw new Error("模型发现需要 Node fetch 支持。");
  const timeout = Math.max(100, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
  const limit = Math.max(1024, Math.min(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 8 * 1024 * 1024));
  let current = url;
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("模型发现请求超时。"));
      }, timeout);
    });
    let response: Response;
    try {
      response = await Promise.race([
        fetcher(current.toString(), {
          method: "GET",
          headers: { accept: "application/json", ...authHeaders(providerValue) },
          redirect: "manual",
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (timedOut || (error as { name?: string }).name === "AbortError") throw new Error("模型发现请求超时。");
      throw new Error("模型发现请求失败。");
    }
    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Provider redirect is missing a location.");
        let next: URL;
        try {
          next = urlForRequest(new URL(location, current).toString());
        } catch {
          throw new Error("Provider redirect target is invalid and was rejected.");
        }
        if (!sameOrigin(current, next)) throw new Error("Provider redirect crosses origins and was rejected.");
        if (providerValue.apiKey && urlContainsCredential(next, providerValue.apiKey)) {
          throw new Error("Provider redirect contains credential material and was rejected.");
        }
        current = next;
        continue;
      }
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
      const text = await Promise.race([readLimited(response, limit), timeoutPromise]);
      try {
        return { value: JSON.parse(text) as unknown, headers: response.headers };
      } catch {
        throw new Error("Provider returned invalid JSON.");
      }
    } catch (error) {
      if (timedOut || (error as { name?: string }).name === "AbortError") throw new Error("模型发现请求超时。");
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error("Provider redirect limit exceeded.");
}

function nextPage(value: Record<string, unknown>, headers: Headers): string | null {
  for (const candidate of [value.next, value.next_cursor, record(value.meta)?.next_cursor]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const link = headers.get("link");
  const match = link?.match(/<([^>]+)>;\s*rel=["']?next["']?/i);
  return match?.[1] ?? null;
}

async function discover(providerValue: InternalProvider, options: ModelImportOptions): Promise<ModelImportModel[]> {
  if (providerValue.disabledReason) throw new Error(providerValue.disabledReason);
  if (!providerValue.protocolKind) throw new Error("Provider protocol is not supported for model discovery.");
  const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, 10));
  const maxModels = Math.max(1, Math.min(options.maxModels ?? DEFAULT_MAX_MODELS, 1000));
  let cursor: string | null = null;
  const result: ModelImportModel[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const url = modelListEndpoint(providerValue.requestBaseUrl, providerValue.protocolKind);
    if (providerValue.protocolKind === "google-genai") {
      url.searchParams.set("pageSize", String(Math.min(maxModels, 100)));
    }
    if (cursor) {
      if (cursor.length > 2048 || /[\u0000-\u001f\u007f]/.test(cursor)) {
        throw new Error("Provider pagination cursor is invalid.");
      }
      if (/^(?:https?:\/\/|\/|\?|\.\.?\/)/i.test(cursor)) {
        let next: URL;
        try { next = urlForRequest(new URL(cursor, url).toString()); } catch { throw new Error("Provider pagination URL is invalid and was rejected."); }
        if (!sameOrigin(url, next)) throw new Error("Provider pagination crosses origins and was rejected.");
        if (providerValue.apiKey && urlContainsCredential(next, providerValue.apiKey)) {
          throw new Error("Provider pagination contains credential material and was rejected.");
        }
        url.href = next.href;
      } else {
        if (containsCredential(cursor, providerValue)) {
          throw new Error("Provider pagination cursor contains credential material and was rejected.");
        }
        const cursorKey = providerValue.protocolKind === "google-genai" ? "pageToken"
          : providerValue.protocolKind === "anthropic-messages" ? "after_id" : "after";
        url.searchParams.set(cursorKey, cursor);
      }
    }
    const response = await fetchJson(providerValue, url, options);
    const body = record(response.value) ?? {};
    const rawModels = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
    for (const raw of rawModels) {
      const model = modelFromResponse(raw, providerValue);
      if (model && !seen.has(model.id)) {
        seen.add(model.id);
        result.push(model);
        if (result.length >= maxModels) return result;
      }
    }
    const next = providerValue.protocolKind === "google-genai"
      ? stringValue(body.nextPageToken) || null
      : stringValue(body.next_page) || nextPage(body, response.headers)
        || (body.has_more === true && rawModels.length
          ? stringValue(body.last_id) || stringValue(record(rawModels[rawModels.length - 1])?.id) || null
          : null);
    if (!next) break;
    cursor = next;
  }
  return result;
}

function fieldsForClaude(document: Record<string, unknown>, models: ModelImportModel[]): ModelImportField[] {
  const env = record(document.env) ?? {};
  return CLAUDE_FIELD_KEYS.map((key) => {
    const value = key === "model" ? document.model : env[key.slice(4)];
    return { key, label: key, value: typeof value === "string" ? value : "" };
  });
}

function jsoncEdit(content: string, path: (string | number)[], value: unknown, label: string): string {
  if (path.some((part) => typeof part === "string" && BLOCKED_KEYS.has(part))) throw new Error(`${label} path is invalid.`);
  const source = content.trim() ? content : "{}";
  const errors: ParseError[] = [];
  parseJsonc(source, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`${label} cannot be modified safely.`);
  const edits = modify(source, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } });
  return applyEdits(source, edits);
}

function appendJsoncObjectProperties(
  content: string,
  path: (string | number)[],
  entries: Array<[string, unknown]>,
  label: string,
): string {
  const source = content.trim() ? content : "{}";
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, { allowTrailingComma: true });
  if (!tree || errors.length || path.some((part) => typeof part === "string" && BLOCKED_KEYS.has(part))) {
    throw new Error(`${label} cannot be modified safely.`);
  }
  if (entries.some(([key]) => BLOCKED_KEYS.has(key))) throw new Error(`${label} path is invalid.`);
  const target = findNodeAtLocation(tree, path);
  if (!target) return jsoncEdit(source, path, Object.fromEntries(entries), label);
  if (target.type !== "object" || source[target.offset] !== "{" || source[target.offset + target.length - 1] !== "}") {
    throw new Error(`${label} model object cannot be modified safely.`);
  }
  const properties = target.children ?? [];
  const existing = new Set<string>();
  for (const property of properties) {
    const keyNode = property.children?.[0];
    const key = keyNode ? getNodeValue(keyNode) : undefined;
    if (typeof key !== "string" || existing.has(key)) throw new Error(`${label} model object contains duplicate or invalid keys.`);
    existing.add(key);
  }
  const additions = entries.filter(([key]) => !existing.has(key));
  if (additions.length === 0) return source;
  if (properties.length === 0) {
    const close = target.offset + target.length - 1;
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const closeLineStart = source.lastIndexOf("\n", close - 1) + 1;
    const closeIndent = /^\s*$/.test(source.slice(closeLineStart, close)) ? source.slice(closeLineStart, close) : "";
    const propertyIndent = `${closeIndent}  `;
    const formatted = additions.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    const insertion = `${eol}${propertyIndent}${formatted.join(`,${eol}${propertyIndent}`)}${eol}${closeIndent}`;
    return `${source.slice(0, close)}${insertion}${source.slice(close)}`;
  }

  const lastProperty = properties[properties.length - 1];
  const valueNode = lastProperty.children?.[1];
  if (!valueNode) throw new Error(`${label} model object cannot be modified safely.`);
  const valueEnd = valueNode.offset + valueNode.length;
  const close = target.offset + target.length - 1;
  const trivia = source.slice(valueEnd, close);
  const hasTrailingComma = firstJsoncToken(trivia) === ",";
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const previousLineStart = source.lastIndexOf("\n", lastProperty.offset - 1) + 1;
  const previousIndent = source.slice(previousLineStart, lastProperty.offset);
  const closeLineStart = source.lastIndexOf("\n", close - 1) + 1;
  const closeIndent = /^\s*$/.test(source.slice(closeLineStart, close))
    ? source.slice(closeLineStart, close)
    : "";
  const multiline = /\r?\n/.test(source.slice(lastProperty.offset, close));
  const propertyIndent = /^\s*$/.test(previousIndent) && previousLineStart < lastProperty.offset
    ? previousIndent
    : `${closeIndent}  `;
  const formatted = additions.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const withComma = hasTrailingComma ? source : `${source.slice(0, valueEnd)},${source.slice(valueEnd)}`;
  const adjustedClose = close + (hasTrailingComma ? 0 : 1);
  const insertion = multiline
    ? `${formatted.join(`,${eol}${propertyIndent}`)}${eol}${closeIndent}`
    : formatted.join(", ");
  return `${withComma.slice(0, adjustedClose)}${insertion}${withComma.slice(adjustedClose)}`;
}

function firstJsoncToken(trivia: string): string | undefined {
  let offset = 0;
  while (offset < trivia.length) {
    if (/\s/.test(trivia[offset])) {
      offset += 1;
      continue;
    }
    if (trivia.startsWith("//", offset)) {
      offset += 2;
      while (offset < trivia.length && trivia[offset] !== "\n" && trivia[offset] !== "\r") offset += 1;
      continue;
    }
    if (trivia.startsWith("/*", offset)) {
      const end = trivia.indexOf("*/", offset + 2);
      if (end < 0) throw new Error("JSONC block comment is not closed.");
      offset = end + 2;
      continue;
    }
    return trivia[offset];
  }
  return undefined;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function appendTomlTable(content: string, path: string[], values: Record<string, string>): string {
  if (path.some((item) => !safeModelId(item) && !safeIdentifier(item))) throw new Error("TOML import path is invalid.");
  const lines = [`[${path.map((item) => /^[A-Za-z0-9_-]+$/.test(item) ? item : tomlString(item)).join(".")}]`];
  for (const [key, value] of Object.entries(values)) lines.push(`${key} = ${tomlString(value)}`);
  const prefix = content.trimEnd();
  return `${prefix}${prefix ? "\n\n" : ""}${lines.join("\n")}\n`;
}

function replaceTomlRootString(content: string, key: string, value: string): string {
  const lines = content.split(/(?<=\n)/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tableLine = /^\s*\[{1,2}[^\]]+\]{1,2}\s*(?:#.*)?(?:\r?\n)?$/;
  let inRoot = true;
  const matches: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (tableLine.test(lines[index])) {
      inRoot = false;
      continue;
    }
    if (inRoot && new RegExp(`^\\s*${escapedKey}\\s*=`).test(lines[index])) matches.push(index);
  }
  if (matches.length > 1) throw new Error("Codex root model setting cannot be modified safely.");
  if (matches.length === 1) {
    const index = matches[0];
    const pattern = new RegExp(`^(\\s*${escapedKey}\\s*=\\s*)(?:'(?:[^']|'')*'|"(?:\\\\.|[^"\\\\])*")(\\s*(?:#.*)?(?:\\r?\\n)?)$`);
    const match = pattern.exec(lines[index]);
    if (!match) throw new Error("Codex root model setting cannot be modified safely.");
    lines[index] = `${match[1]}${tomlString(value)}${match[2]}`;
    return lines.join("");
  }
  const firstTableIndex = lines.findIndex((line) => tableLine.test(line));
  const insertion = `${key} = ${tomlString(value)}\n`;
  if (firstTableIndex >= 0) {
    lines.splice(firstTableIndex, 0, `${insertion}\n`);
    return lines.join("");
  }
  return `${insertion}${content}`;
}

function applyMultiImport(payload: ApplyModelImportPayload, item: InternalProvider): ModelImportDraft {
  const selected = payload.selectedModelIds.filter((id) => !item.existingModelIds.includes(id));
  if (selected.length === 0) return cloneDraft(payload.draft);
  if (payload.platform === "opencode") {
    const content = appendJsoncObjectProperties(
      configText(payload.draft, payload.platform),
      ["provider", item.sourceId, "models"],
      selected.map((modelId) => [modelId, { name: modelId }]),
      "OpenCode config",
    );
    return { ...cloneDraft(payload.draft), configContent: content };
  }
  if (payload.platform === "zcode") {
    const document = parseStrictJson(configText(payload.draft, payload.platform), "ZCode provider_config");
    const config = record(document.config) ?? {};
    const rules = record(config.providerConfigRules) ?? {};
    const providers = Array.isArray(rules.providerRules) ? rules.providerRules : [];
    const rule = providers.find((raw) => record(raw)?.providerId === item.sourceId);
    if (!rule || !record(rule)?.config || !isPlainObject(record(rule)?.config)) throw new Error("ZCode provider no longer exists in the current draft.");
    const providerConfig = record(record(rule)?.config) as Record<string, unknown>;
    const ids = Array.isArray(providerConfig.personalModelIds) ? providerConfig.personalModelIds.filter((id): id is string => typeof id === "string") : [];
    providerConfig.personalModelIds = addModels(ids, selected);
    return { ...cloneDraft(payload.draft), content: `${JSON.stringify(document, null, 2)}\n` };
  }
  if (payload.platform === "dsh") {
    const committed = commitDshDocument(configText(payload.draft, payload.platform));
    if (!committed.ok) throw new Error(committed.error);
    if (selected.some((id) => !isDshModelId(id))) throw new Error("DSH model id must be a non-empty complete id without whitespace or backslashes.");
    const document = committed.document as unknown as Record<string, unknown>;
    const models = Array.isArray(document.models) ? document.models : [];
    const template = record(models[0]) ?? {};
    if (!stringValue(template.id)) throw new Error("DSH current draft has no safe model template to extend.");
    document.models = models.concat(selected.map((id) => ({ ...template, id, name: id })));
    const updated = commitDshDocument(JSON.stringify(document));
    if (!updated.ok) throw new Error(updated.error);
    return { ...cloneDraft(payload.draft), content: updated.content };
  }
  if (payload.platform === "grok") {
    const document = parseToml(configText(payload.draft, payload.platform), "Grok config");
    const models = record(document.model) ?? {};
    const template = record(models[item.sourceId]);
    if (!template) throw new Error("Grok 所选模型配置已不存在，请重新选择。");
    let content = configText(payload.draft, payload.platform);
    for (const modelId of selected) {
      const alias = modelImportAlias(models, item.sourceId, modelId);
      const values: Record<string, string> = {
        model: modelId,
        base_url: stringValue(template.base_url),
        api_backend: stringValue(template.api_backend),
      };
      const credentialReference = envReference(template.api_key);
      if (credentialReference) {
        values.env_key = credentialReference;
      } else {
        for (const key of ["api_key", "env_key"]) {
          if (typeof template[key] === "string") values[key] = template[key];
        }
      }
      content = appendTomlTable(content, ["model", alias], values);
      models[alias] = values;
    }
    const updated = parseToml(content, "Grok config");
    const error = validateGrokDocument(updated);
    if (error) throw new Error(`Grok config cannot be modified safely: ${error}`);
    return { ...cloneDraft(payload.draft), content };
  }
  if (payload.platform === "kimi-code") {
    const document = parseToml(configText(payload.draft, payload.platform), "Kimi Code config");
    const originalError = validateKimiCodeDocument(document);
    if (originalError) throw new Error(`Kimi Code config cannot be modified safely: ${originalError}`);
    const models = record(document.models) ?? {};
    const template = Object.values(models).map(record).find((value) => value?.provider === item.sourceId
      && safeModelId(stringValue(value.model))
      && typeof value.max_context_size === "number" && Number.isSafeInteger(value.max_context_size) && value.max_context_size > 0);
    if (!template) throw new Error("Kimi Code 需要同一 provider 的有效模型模板（正数 max_context_size）；请先配置模板后再导入。继承值不代表服务端发现的模型能力。");
    const templateFields = ["max_context_size", "max_input_size", "max_output_size", "default_effort", "support_efforts", "capabilities"];
    const inherited = Object.fromEntries(templateFields.filter((key) => template[key] !== undefined).map((key) => [key, template[key]]));
    let content = configText(payload.draft, payload.platform);
    for (const modelId of selected) {
      const alias = modelImportAlias(models, item.sourceId, modelId);
      const model = {
        ...inherited,
        provider: item.sourceId,
        model: modelId,
      };
      const table = TOML.stringify({ models: { [alias]: model } } as TOML.JsonMap);
      content = `${content.trimEnd()}\n\n${table}`;
      models[alias] = model;
    }
    const updated = parseToml(content, "Kimi Code config");
    const error = validateKimiCodeDocument(updated);
    if (error) throw new Error(`Kimi Code config cannot be modified safely: ${error}`);
    return { ...cloneDraft(payload.draft), content };
  }
  throw new Error(`Model import mode is not supported for ${payload.platform}.`);
}

async function applyClaudeImport(payload: ApplyModelImportPayload, item: InternalProvider): Promise<ModelImportDraft> {
  if (payload.selectedModelIds.length === 0) throw new Error("Claude import requires at least one selected model.");
  const fields = payload.fields ?? {};
  if (Object.keys(fields).some((key) => !(CLAUDE_FIELD_KEYS as readonly string[]).includes(key))) {
    throw new Error("Claude import fields contain an unsupported key.");
  }
  const source = configText(payload.draft, "claude");
  const document = parseJsoncObject(source, "Claude settings");
  const currentEnv = record(document.env) ?? {};
  const edits: Array<{ path: (string | number)[]; value: string }> = [];
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    const currentValue = key === "model" ? stringValue(document.model) : stringValue(currentEnv[key.slice(4)]);
    if (!value || value === currentValue) continue;
    if (!visibleModelId(value, item) || !payload.selectedModelIds.includes(value)) {
      throw new Error(`Claude field ${key} is invalid.`);
    }
    edits.push({
      path: key === "model" ? ["model"] : ["env", key.slice(4)],
      value,
    });
  }
  const content = edits.reduce((current, edit) => jsoncEdit(current, edit.path, edit.value, "Claude settings"), source);
  return { ...cloneDraft(payload.draft), content };
}

async function applySingleImport(payload: ApplyModelImportPayload, item: InternalProvider): Promise<ModelImportDraft> {
  if (payload.selectedModelIds.length !== 1) throw new Error("Single-model providers require exactly one selected model.");
  const selected = payload.selectedModelIds[0];
  if (payload.platform !== "codex") throw new Error(`Single-model import is not supported for ${payload.platform}.`);
  const content = replaceTomlRootString(configText(payload.draft, "codex"), "model", selected);
  return { ...cloneDraft(payload.draft), configContent: content };
}

export function getModelImportProviders(
  payload: ModelImportPayload,
  options: ModelImportOptions = {},
): ModelImportProvidersResult {
  const validated = assertPayload(payload, "getModelImportProviders");
  return { providers: providersFor(validated, options).map(publicProvider) };
}

export async function discoverImportModels(
  payload: DiscoverImportModelsPayload,
  options: ModelImportOptions = {},
): Promise<DiscoverImportModelsResult> {
  const validated = assertProviderPayload(payload, "discoverImportModels");
  const providers = providersFor(validated, options);
  const item = providers.find((candidate) => candidate.id === validated.providerId);
  if (!item) throw new Error("Provider is not present in the current draft.");
  const models = await discover(item, options);
  const result: DiscoverImportModelsResult = {
    models,
    existingModelIds: uniqueModels(item.existingModelIds),
  };
  if (validated.platform === "claude") {
    result.fields = fieldsForClaude(parseJsoncObject(configText(validated.draft, "claude"), "Claude settings"), models);
  }
  return result;
}

export async function applyModelImport(
  payload: ApplyModelImportPayload,
  options: ModelImportOptions = {},
): Promise<ApplyModelImportResult> {
  const validated = assertApplyPayload(payload);
  const providers = providersFor(validated, options);
  const item = providers.find((candidate) => candidate.id === validated.providerId);
  if (!item) throw new Error("Provider is not present in the current draft.");
  if (item.disabledReason) throw new Error(item.disabledReason);
  if (validated.selectedModelIds.length === 0) throw new Error("Select at least one model to import.");
  assertSafeImportIds(validated, item);
  if (validated.platform === "claude") return { draft: await applyClaudeImport(validated, item) };
  if (item.mode === "single") return { draft: await applySingleImport(validated, item) };
  return { draft: applyMultiImport(validated, item) };
}
