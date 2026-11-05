import * as TOML from "@iarna/toml";
import { isPlainObject } from "../shared/jsonObject";
import { commitDshDocument } from "../cli/dshConfigModels";
import { validateGrokDocument } from "./grokConfig";
import { validateKimiCodeDocument } from "./kimiCodeConfig";
import { appendJsoncObjectProperties, appendTomlTable, jsoncEdit, replaceTomlRootString } from "./modelimportedits";
import {
  addModels,
  authFromJson,
  CLAUDE_FIELD_KEYS,
  cloneDraft,
  configText,
  disabled,
  envReference,
  isDshModelId,
  modelImportAlias,
  parseJsoncObject,
  parseStrictJson,
  parseToml,
  provider,
  protocolFor,
  record,
  resolveConfigString,
  resolveCredential,
  safeIdentifier,
  safeModelId,
  stringValue,
  visibleModelId,
} from "./modelimportshared";
import type {
  ApplyModelImportPayload,
  ModelImportDraft,
  ModelImportField,
  ModelImportModel,
  ModelImportPlatform,
  ModelImportPlatformStrategy,
  InternalProvider,
} from "./modelimporttypes";

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

function fieldsForClaude(document: Record<string, unknown>, _models: ModelImportModel[]): ModelImportField[] {
  const env = record(document.env) ?? {};
  return CLAUDE_FIELD_KEYS.map((key) => {
    const value = key === "model" ? document.model : env[key.slice(4)];
    return { key, label: key, value: typeof value === "string" ? value : "" };
  });
}

function writeOpenCodeDraft(payload: ApplyModelImportPayload, item: InternalProvider): ModelImportDraft {
  const selected = payload.selectedModelIds.filter((id) => !item.existingModelIds.includes(id));
  if (selected.length === 0) return cloneDraft(payload.draft);
  const content = appendJsoncObjectProperties(
    configText(payload.draft, payload.platform),
    ["provider", item.sourceId, "models"],
    selected.map((modelId) => [modelId, { name: modelId }]),
    "OpenCode config",
  );
  return { ...cloneDraft(payload.draft), configContent: content };
}

function writeZcodeDraft(payload: ApplyModelImportPayload, item: InternalProvider): ModelImportDraft {
  const selected = payload.selectedModelIds.filter((id) => !item.existingModelIds.includes(id));
  if (selected.length === 0) return cloneDraft(payload.draft);
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

function writeDshDraft(payload: ApplyModelImportPayload, item: InternalProvider): ModelImportDraft {
  const selected = payload.selectedModelIds.filter((id) => !item.existingModelIds.includes(id));
  if (selected.length === 0) return cloneDraft(payload.draft);
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

function writeGrokDraft(payload: ApplyModelImportPayload, item: InternalProvider): ModelImportDraft {
  const selected = payload.selectedModelIds.filter((id) => !item.existingModelIds.includes(id));
  if (selected.length === 0) return cloneDraft(payload.draft);
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

function writeKimiDraft(payload: ApplyModelImportPayload, item: InternalProvider): ModelImportDraft {
  const selected = payload.selectedModelIds.filter((id) => !item.existingModelIds.includes(id));
  if (selected.length === 0) return cloneDraft(payload.draft);
  const document = parseToml(configText(payload.draft, payload.platform), "Kimi Code config");
  const originalError = validateKimiCodeDocument(document);
  if (originalError) throw new Error(`Kimi Code config cannot be modified safely: ${originalError}`);
  const models = record(document.models) ?? {};
  const template = Object.values(models).map(record).find((value): value is Record<string, unknown> => Boolean(value)
    && value?.provider === item.sourceId
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

function writeClaudeDraft(payload: ApplyModelImportPayload, item: InternalProvider): ModelImportDraft {
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

function writeCodexDraft(payload: ApplyModelImportPayload): ModelImportDraft {
  if (payload.selectedModelIds.length !== 1) throw new Error("Single-model providers require exactly one selected model.");
  const content = replaceTomlRootString(configText(payload.draft, "codex"), "model", payload.selectedModelIds[0]);
  return { ...cloneDraft(payload.draft), configContent: content };
}

const MODEL_IMPORT_PLATFORM_TABLE = {
  claude: {
    providers: claudeProviders,
    writeDraft: writeClaudeDraft,
    discoveryFields: (draft: ModelImportDraft, models: ModelImportModel[]): ModelImportField[] => (
      fieldsForClaude(parseJsoncObject(configText(draft, "claude"), "Claude settings"), models)
    ),
  },
  codex: { providers: codexProviders, writeDraft: writeCodexDraft },
  opencode: { providers: openCodeProviders, writeDraft: writeOpenCodeDraft },
  grok: { providers: grokProviders, writeDraft: writeGrokDraft },
  dsh: { providers: dshProviders, writeDraft: writeDshDraft },
  "kimi-code": { providers: kimiProviders, writeDraft: writeKimiDraft },
  zcode: { providers: zcodeProviders, writeDraft: writeZcodeDraft },
} as const satisfies Record<ModelImportPlatform, ModelImportPlatformStrategy>;

export const MODEL_IMPORT_PLATFORM_STRATEGIES: Record<ModelImportPlatform, ModelImportPlatformStrategy> = MODEL_IMPORT_PLATFORM_TABLE;
