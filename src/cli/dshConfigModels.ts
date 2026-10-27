/**
 * DeepSeek Harness custom-provider contract.
 *
 * This module does not start dsh, read environment credentials, or copy Grok TOML.
 * The default example model id is `deepseek-v4.1-flash`. Model ids are
 * endpoint-specific and remain unchanged in the ACP provider wire; a slash,
 * if present, is part of the model id rather than a provider/model split.
 * initialize accepting a string does not make an unconfigured id executable.
 * The installed pi-ai schema types `models` as an ordered array, so a profile
 * may list more than one configured model. Selection stays inside that list.
 * Runtime baseURL may be https, or http only for a loopback host. The
 * repository example stays on the placeholder https gateway.
 * Accepted extension fields on the profile and on model objects stay in the
 * profile JSON. The optional root apiKey is stored in the local profile and
 * later injected into the DSH child environment; it is never serialized into
 * the runtime patch. Closed objects such as retryPolicy reject unknown keys.
 * The runtime patch still emits only the verified provider fields.
 */

export const DSH_PROVIDER_ROUTE = "sinitek-custom";
export const DSH_API = "openai-completions";
export const DSH_SUPPORTED_APIS = [DSH_API, "openai-responses", "anthropic-messages"] as const;
export const DSH_API_KEY_ENV = "SINITEK_DSH_API_KEY";
export const DSH_VERIFIED_MODEL_ID = "deepseek-v4.1-flash";
/** Installed `PiAiProviderProfile.models` is an ordered array, not a single slot. */
export const DSH_SUPPORTS_CONFIGURED_MODEL_LIST = true;
export const DSH_EXAMPLE_BASE_URL = "https://gateway.example/v1";
export const DSH_DISPLAY_NAME = "Sinitek custom";
export const DSH_SCHEMA_VERSION = 1;
export const DSH_REASONING_EFFORTS = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
} as const;
export const DSH_REASONING_OPTIONS = ["low", "medium", "high", "xhigh", "max"] as const;

const LEGACY_DSH_REASONING_EFFORTS = {
  off: null,
  low: "low",
  high: "high",
  max: "max",
} as const;

const LEGACY_DSH_REASONING_EFFORTS_WITH_MEDIUM = {
  off: null,
  low: "low",
  medium: "medium",
  high: "high",
  max: "max",
} as const;

const LEGACY_DSH_REASONING_EFFORTS_WITHOUT_MEDIUM = {
  low: "low",
  high: "high",
  xhigh: "xhigh",
  max: "max",
} as const;

export type DshReasoningEfforts = typeof DSH_REASONING_EFFORTS;
export type DshReasoningOption = (typeof DSH_REASONING_OPTIONS)[number];
export type DshApi = (typeof DSH_SUPPORTED_APIS)[number];
export type DshModelCompat = {
  thinkingFormat: "deepseek";
  supportsReasoningEffort: true;
};

export const DSH_UNVERIFIED_FIELDS = [
  "headers",
  "thinkingBudgets",
  "cacheRetention",
  "transport",
  "defaultContextWindow",
  "defaultInput",
  "contextWindow",
  "modelOverrides",
  "apiKey",
  "api_key",
  "token",
  "password",
] as const;

const DSH_PROFILE_KEYS = [
  "schemaVersion",
  "provider",
  "api",
  "apiKey",
  "apiKeyEnv",
  "baseURL",
  "displayName",
  "timeoutMs",
  "streamIdleTimeoutMs",
  "retryPolicy",
  "models",
  "acpModel",
] as const;

const DSH_MODEL_KEYS = ["id", "name", "input", "maxTokens", "contextWindow", "reasoningEfforts", "compat"] as const;
const DSH_RETRY_KEYS = ["mode", "maxRetries", "backoff"] as const;
const DSH_BACKOFF_KEYS = ["initialDelayMs", "maxDelayMs"] as const;
const DSH_BLOCKED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const SECRET_ASSIGNMENT = /(?:^|[\s,{])(?:SINITEK_DSH_API_KEY|DEEPSEEK_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*\S+/i;
const SECRET_TOKEN = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/;

export type DshConfiguredModel = {
  id: string;
  name: string;
  input: ["text"];
  maxTokens?: number;
  contextWindow?: number;
  reasoningEfforts?: false | DshReasoningEfforts;
  compat?: DshModelCompat;
};

type DshRetryPolicy = {
  mode: "normal";
  maxRetries: 1;
  backoff: {
    initialDelayMs: 200;
    maxDelayMs: 1000;
  };
};

export type DshProfileDocument = {
  schemaVersion: typeof DSH_SCHEMA_VERSION;
  provider: typeof DSH_PROVIDER_ROUTE;
  api: DshApi;
  apiKey?: string;
  apiKeyEnv: typeof DSH_API_KEY_ENV;
  baseURL: string;
  displayName?: string;
  timeoutMs?: 45000;
  streamIdleTimeoutMs?: 60000;
  retryPolicy?: DshRetryPolicy;
  models: DshConfiguredModel[];
  acpModel: string;
};

export type DshConfigModels = {
  models: string[];
  labels: Record<string, string>;
  defaultModel: string | null;
  wireByModelId: Record<string, string>;
  reasoningOptionsByModelId: Record<string, DshReasoningOption[]>;
  error: string | null;
};

export type DshDocumentCommit =
  | { ok: true; document: DshProfileDocument; content: string }
  | { ok: false; error: string };

export function createDshExampleDocument(
  baseURL: string = DSH_EXAMPLE_BASE_URL,
): DshProfileDocument {
  return {
    schemaVersion: DSH_SCHEMA_VERSION,
    provider: DSH_PROVIDER_ROUTE,
    api: DSH_API,
    apiKey: "",
    apiKeyEnv: DSH_API_KEY_ENV,
    baseURL,
    models: [defaultModel()],
    acpModel: DSH_VERIFIED_MODEL_ID,
  };
}

export function serializeDshProfile(document: DshProfileDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function createDshExampleProfileText(): string {
  return serializeDshProfile(createDshExampleDocument());
}

export function toDshModelWireValue(modelId: string): string {
  return JSON.stringify([DSH_PROVIDER_ROUTE, modelId]);
}

export function containsDshSecret(value: string): boolean {
  return SECRET_ASSIGNMENT.test(value) || SECRET_TOKEN.test(value);
}

export function commitDshDocument(content: string): DshDocumentCommit {
  const parsed = parseDshProfileDocument(content);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    document: parsed.document,
    content: serializeDshProfile(parsed.document),
  };
}

export function parseDshConfigModels(content: string): DshConfigModels {
  const committed = commitDshDocument(content);
  if (!committed.ok) {
    return emptyModels(committed.error);
  }
  const modelIds = committed.document.models.map((model) => model.id);
  const labels: Record<string, string> = {};
  const wireByModelId: Record<string, string> = {};
  const reasoningOptionsByModelId: Record<string, DshReasoningOption[]> = {};
  for (const modelId of modelIds) {
    labels[modelId] = committed.document.models.find((model) => model.id === modelId)?.name || modelId;
    wireByModelId[modelId] = toDshModelWireValue(modelId);
  }
  for (const model of committed.document.models) {
    reasoningOptionsByModelId[model.id] = reasoningOptionsForModel(model);
  }
  return {
    models: modelIds,
    labels,
    defaultModel: committed.document.acpModel,
    wireByModelId,
    reasoningOptionsByModelId,
    error: null,
  };
}

export function readDshModelWireForRun(
  config: DshConfigModels | undefined,
  selectedModel: string | null | undefined,
): string {
  if (!config || config.error) {
    throw new Error(config?.error || "DSH profile is not configured.");
  }
  const selected = typeof selectedModel === "string" ? selectedModel.trim() : "";
  const modelId = selected
    ? interpretExplicitDshRunModel(selected, config)
    : (config.defaultModel && config.models.includes(config.defaultModel) ? config.defaultModel : null);
  if (!modelId) {
    throw new Error(selected
      ? "DSH model selection is not the configured wire value."
      : "DSH has no configured executable model.");
  }
  const wire = config.wireByModelId[modelId];
  const expected = toDshModelWireValue(modelId);
  if (wire !== expected) {
    throw new Error("DSH model wire value is not the configured provider tuple.");
  }
  return wire;
}

function interpretExplicitDshRunModel(selected: string, config: DshConfigModels): string | null {
  const modelId = interpretDshSelection(selected, config.models);
  if (!modelId) {
    return null;
  }
  if (config.models.includes(selected)) {
    return modelId;
  }
  return config.wireByModelId[modelId] === selected ? modelId : null;
}

export function resolveDshConfigModel(
  config: DshConfigModels | undefined,
  selectedModel: string | null | undefined,
): string | null {
  if (!config || config.error || config.models.length === 0) {
    return null;
  }
  const raw = typeof selectedModel === "string" ? selectedModel.trim() : "";
  if (!raw) {
    return fallbackDshModel(config);
  }
  const selected = interpretDshSelection(raw, config.models);
  return selected && config.models.includes(selected) ? selected : null;
}

export function isDshExecutableModel(
  value: string | null | undefined,
  configured: readonly string[],
): boolean {
  const selected = interpretDshSelection(value, configured);
  return Boolean(selected && configured.includes(selected));
}

export function serializeDshPatchYaml(document: DshProfileDocument): string {
  const modelLines = document.models.flatMap((model) => {
    const lines = [
      `          - id: ${quoteYaml(model.id)}`,
      `            name: ${quoteYaml(model.name)}`,
      "            input:",
      "              - text",
    ];
    if (model.maxTokens !== undefined) {
      lines.push(`            maxTokens: ${model.maxTokens}`);
    }
    if (model.contextWindow !== undefined) {
      lines.push(`            contextWindow: ${model.contextWindow}`);
    }
    if (model.reasoningEfforts === false) {
      lines.push("            reasoningEfforts: false");
    } else if (model.reasoningEfforts) {
      lines.push("            reasoningEfforts:");
      for (const [effort, mappedEffort] of Object.entries(model.reasoningEfforts)) {
        lines.push(`              ${effort}: ${mappedEffort}`);
      }
    }
    if (model.compat) {
      lines.push(
        "            compat:",
        "              thinkingFormat: deepseek",
        "              supportsReasoningEffort: true",
      );
    }
    return lines;
  });
  const providerLines = [
    "- id: llm-pi-ai",
    "  config:",
    "    providers:",
    `      ${DSH_PROVIDER_ROUTE}:`,
  ];
  if (document.displayName !== undefined) {
    providerLines.push(`        displayName: ${quoteYaml(document.displayName)}`);
  }
  providerLines.push(
    `        apiKeyEnv: ${DSH_API_KEY_ENV}`,
    `        api: ${document.api}`,
    `        baseURL: ${quoteYaml(document.baseURL)}`,
  );
  if (document.timeoutMs !== undefined) {
    providerLines.push(`        timeoutMs: ${document.timeoutMs}`);
  }
  if (document.streamIdleTimeoutMs !== undefined) {
    providerLines.push(`        streamIdleTimeoutMs: ${document.streamIdleTimeoutMs}`);
  }
  if (document.retryPolicy !== undefined) {
    providerLines.push(
      "        retryPolicy:",
      "          mode: normal",
      "          maxRetries: 1",
      "          backoff:",
      "            initialDelayMs: 200",
      "            maxDelayMs: 1000",
    );
  }
  providerLines.push(
    "        models:",
    ...modelLines,
    "- id: acp",
    "  config:",
    `    provider: ${DSH_PROVIDER_ROUTE}`,
    `    model: ${quoteYaml(document.acpModel)}`,
    "",
  );
  return providerLines.join("\n");
}

function defaultModel(): DshConfiguredModel {
  return {
    id: DSH_VERIFIED_MODEL_ID,
    name: DSH_VERIFIED_MODEL_ID,
    input: ["text"],
    reasoningEfforts: { ...DSH_REASONING_EFFORTS },
    compat: {
      thinkingFormat: "deepseek",
      supportsReasoningEffort: true,
    },
  };
}

function reasoningOptionsForModel(model: DshConfiguredModel): DshReasoningOption[] {
  if (model.reasoningEfforts === false) {
    return [];
  }
  if (!model.reasoningEfforts) {
    return [];
  }
  return DSH_REASONING_OPTIONS.filter((option) => Object.prototype.hasOwnProperty.call(model.reasoningEfforts, option));
}

function emptyModels(error: string): DshConfigModels {
  return {
    models: [],
    labels: {},
    defaultModel: null,
    wireByModelId: {},
    reasoningOptionsByModelId: {},
    error,
  };
}

function parseDshProfileDocument(content: string): { ok: true; document: DshProfileDocument } | { ok: false; error: string } {
  const text = content.trim();
  if (!text) {
    return { ok: false, error: "DSH profile is empty." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "DSH profile must be the verified JSON document, not TOML or an arbitrary string." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "DSH profile must be an object." };
  }
  const record = parsed as Record<string, unknown>;
  const rawApiKey = record.apiKey;
  if (rawApiKey !== undefined && (typeof rawApiKey !== "string" || /[\r\n\0]/.test(rawApiKey))) {
    return { ok: false, error: "DSH apiKey must be a single-line string." };
  }
  const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : undefined;
  const publicFields = { ...record };
  delete publicFields.apiKey;
  if (containsDshSecret(JSON.stringify(publicFields))) {
    return { ok: false, error: "DSH profile contains a credential outside apiKey." };
  }
  const unverified = findUnverifiedField(publicFields);
  if (unverified) {
    return { ok: false, error: `DSH profile field ${unverified} is not part of the verified contract.` };
  }
  if (hasModelsAndOverrides(record)) {
    return { ok: false, error: "DSH providers.models and modelOverrides cannot be used together." };
  }
  if (record.schemaVersion !== DSH_SCHEMA_VERSION) {
    return { ok: false, error: "DSH profile schemaVersion must be 1." };
  }
  if (record.provider !== DSH_PROVIDER_ROUTE) {
    return { ok: false, error: "DSH provider route must be sinitek-custom. Do not split the model id on '/'." };
  }
  if (typeof record.api !== "string" || !(DSH_SUPPORTED_APIS as readonly string[]).includes(record.api)) {
    return { ok: false, error: `DSH api must be one of: ${DSH_SUPPORTED_APIS.join(", ")}.` };
  }
  if (record.apiKeyEnv !== undefined && record.apiKeyEnv !== DSH_API_KEY_ENV) {
    return { ok: false, error: "DSH credentials must reference SINITEK_DSH_API_KEY." };
  }
  const baseURL = canonicalDshBaseUrl(record.baseURL);
  if (!baseURL) {
    return { ok: false, error: "DSH baseURL must be https, or http on a loopback host, without embedded credentials." };
  }
  if (record.displayName !== undefined && record.displayName !== DSH_DISPLAY_NAME) {
    return { ok: false, error: "DSH displayName must stay Sinitek custom." };
  }
  if (record.timeoutMs !== undefined && record.timeoutMs !== 45000) {
    return { ok: false, error: "DSH timeoutMs must stay at the verified value 45000." };
  }
  if (record.streamIdleTimeoutMs !== undefined && record.streamIdleTimeoutMs !== 60000) {
    return { ok: false, error: "DSH streamIdleTimeoutMs must stay at the verified value 60000." };
  }
  const retryError = record.retryPolicy === undefined ? null : retryPolicyError(record.retryPolicy);
  if (retryError) {
    return { ok: false, error: retryError };
  }
  const preserved = preservedFields(record, DSH_PROFILE_KEYS);
  if (!preserved.ok) {
    return preserved;
  }
  const models = readConfiguredModels(record.models);
  if (!models.ok) {
    return models;
  }
  if (typeof record.acpModel !== "string" || !models.ids.includes(record.acpModel)) {
    return { ok: false, error: "DSH acpModel must be one of the configured model ids." };
  }
  if ("initialize" in record) {
    return { ok: false, error: "DSH initialize acceptance is not an executable model list." };
  }
  const document: DshProfileDocument = {
    schemaVersion: DSH_SCHEMA_VERSION,
    provider: DSH_PROVIDER_ROUTE,
    api: record.api as DshApi,
    ...(typeof apiKey === "string" && apiKey.length > 0 ? { apiKey } : {}),
    apiKeyEnv: DSH_API_KEY_ENV,
    baseURL,
    ...(record.displayName !== undefined ? { displayName: DSH_DISPLAY_NAME } : {}),
    ...(record.timeoutMs !== undefined ? { timeoutMs: 45000 } : {}),
    ...(record.streamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs: 60000 } : {}),
    ...(record.retryPolicy !== undefined
      ? {
        retryPolicy: {
          mode: "normal",
          maxRetries: 1,
          backoff: {
            initialDelayMs: 200,
            maxDelayMs: 1000,
          },
        },
      }
      : {}),
    models: models.models,
    acpModel: record.acpModel,
  };
  Object.assign(document, preserved.fields);
  return { ok: true, document };
}

function readConfiguredModels(
  value: unknown,
): { ok: true; models: DshConfiguredModel[]; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "DSH models must list at least one complete model id." };
  }
  const models: DshConfiguredModel[] = [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const modelError = validateConfiguredModel(entry, seen);
    if (modelError) {
      return { ok: false, error: modelError };
    }
    const preserved = preservedFields(entry as Record<string, unknown>, DSH_MODEL_KEYS, `models[${index}]`);
    if (!preserved.ok) {
      return preserved;
    }
    const id = (entry as { id: string }).id;
    seen.add(id);
    ids.push(id);
    const configured = entry as Record<string, unknown>;
    const rawReasoningEfforts = configured.reasoningEfforts === undefined
      ? id === DSH_VERIFIED_MODEL_ID ? { ...DSH_REASONING_EFFORTS } : undefined
      : configured.reasoningEfforts;
    const reasoningEfforts = rawReasoningEfforts === false
      ? false
      : normalizeDshReasoningEfforts(rawReasoningEfforts);
    const compat = configured.compat === undefined
      ? id === DSH_VERIFIED_MODEL_ID && reasoningEfforts !== false
        ? { thinkingFormat: "deepseek", supportsReasoningEffort: true }
        : undefined
      : configured.compat;
    const model: DshConfiguredModel = {
      id,
      name: typeof configured.name === "string" && configured.name.trim() ? configured.name.trim() : id,
      input: ["text"],
    };
    if (typeof configured.maxTokens === "number") {
      model.maxTokens = configured.maxTokens;
    }
    if (typeof configured.contextWindow === "number") {
      model.contextWindow = configured.contextWindow;
    }
    if (reasoningEfforts === false || reasoningEfforts) {
      model.reasoningEfforts = reasoningEfforts;
    }
    if (isDshModelCompat(compat)) {
      model.compat = compat;
    }
    Object.assign(model, preserved.fields);
    models.push(model);
  }
  return { ok: true, models, ids };
}

function validateConfiguredModel(value: unknown, seen: ReadonlySet<string>): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "DSH model entry must be an object.";
  }
  const model = value as Record<string, unknown>;
  const idError = validateModelId(model.id, seen);
  if (idError) {
    return idError;
  }
  if (model.name !== undefined && typeof model.name !== "string") {
    return "DSH model name must be a string.";
  }
  if (!Array.isArray(model.input) || model.input.length !== 1 || model.input[0] !== "text") {
    return "DSH model input must be [text].";
  }
  if (model.maxTokens !== undefined && (!Number.isSafeInteger(model.maxTokens) || (model.maxTokens as number) <= 0)) {
    return "DSH model maxTokens must be a positive safe integer.";
  }
  if (model.contextWindow !== undefined && (!Number.isSafeInteger(model.contextWindow) || (model.contextWindow as number) <= 0)) {
    return "DSH model contextWindow must be a positive safe integer.";
  }
  const isDefaultModel = model.id === DSH_VERIFIED_MODEL_ID;
  const reasoningEfforts = model.reasoningEfforts === undefined
    ? isDefaultModel ? DSH_REASONING_EFFORTS : undefined
    : model.reasoningEfforts;
  const compat = model.compat === undefined
    ? isDefaultModel && reasoningEfforts !== false
      ? { thinkingFormat: "deepseek", supportsReasoningEffort: true }
      : undefined
    : model.compat;
  if (reasoningEfforts === false) {
    if (compat !== undefined) {
      return "DSH compat requires configured DeepSeek reasoning efforts.";
    }
  } else if (reasoningEfforts !== undefined || compat !== undefined) {
    if (
      !isDshReasoningEfforts(reasoningEfforts)
      && !isLegacyDshReasoningEfforts(reasoningEfforts)
      && !isLegacyCurrentDshReasoningEfforts(reasoningEfforts)
    ) {
      return "DSH model reasoningEfforts must map low/medium/high/xhigh/max.";
    }
    if (!isDshModelCompat(compat)) {
      return "DSH model compat must declare DeepSeek thinkingFormat and reasoning effort support.";
    }
  }
  return null;
}

function isDshReasoningEfforts(value: unknown): value is DshReasoningEfforts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const efforts = value as Record<string, unknown>;
  const keys = Object.keys(efforts).sort();
  const expectedKeys = Object.keys(DSH_REASONING_EFFORTS).sort();
  return keys.join(",") === expectedKeys.join(",")
    && efforts.low === "low"
    && efforts.medium === "medium"
    && efforts.high === "high"
    && efforts.xhigh === "xhigh"
    && efforts.max === "max";
}

function isLegacyDshReasoningEfforts(
  value: unknown,
): value is typeof LEGACY_DSH_REASONING_EFFORTS | typeof LEGACY_DSH_REASONING_EFFORTS_WITH_MEDIUM {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const efforts = value as Record<string, unknown>;
  const keys = Object.keys(efforts).sort();
  const legacyKeys = Object.keys(LEGACY_DSH_REASONING_EFFORTS).sort();
  const legacyWithMediumKeys = Object.keys(LEGACY_DSH_REASONING_EFFORTS_WITH_MEDIUM).sort();
  const hasLegacyValues = efforts.off === null
    && efforts.low === "low"
    && efforts.high === "high"
    && efforts.max === "max";
  if (keys.join(",") === legacyKeys.join(",")) {
    return hasLegacyValues;
  }
  return keys.join(",") === legacyWithMediumKeys.join(",")
    && hasLegacyValues
    && efforts.medium === "medium";
}

function isLegacyCurrentDshReasoningEfforts(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const efforts = value as Record<string, unknown>;
  const keys = Object.keys(efforts).sort();
  const expectedKeys = Object.keys(LEGACY_DSH_REASONING_EFFORTS_WITHOUT_MEDIUM).sort();
  return keys.join(",") === expectedKeys.join(",")
    && efforts.low === "low"
    && efforts.high === "high"
    && efforts.xhigh === "xhigh"
    && efforts.max === "max";
}

function normalizeDshReasoningEfforts(value: unknown): DshReasoningEfforts | undefined {
  if (
    isDshReasoningEfforts(value)
    || isLegacyDshReasoningEfforts(value)
    || isLegacyCurrentDshReasoningEfforts(value)
  ) {
    return { ...DSH_REASONING_EFFORTS };
  }
  return undefined;
}

function isDshModelCompat(value: unknown): value is DshModelCompat {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const compat = value as Record<string, unknown>;
  const keys = Object.keys(compat).sort();
  return keys.join(",") === ["supportsReasoningEffort", "thinkingFormat"].sort().join(",")
    && compat.thinkingFormat === "deepseek"
    && compat.supportsReasoningEffort === true;
}

function validateModelId(value: unknown, seen: ReadonlySet<string>): string | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || /\s/.test(value) || value.includes("\\")) {
    return "DSH model id must be a non-empty complete id without whitespace or backslashes.";
  }
  if (containsDshSecret(value)) {
    return "DSH profile contains a credential value. Reference SINITEK_DSH_API_KEY only.";
  }
  if (seen.has(value)) {
    return "DSH model ids must stay unique in configuration order.";
  }
  return null;
}

function interpretDshSelection(
  value: string | null | undefined,
  configured: readonly string[],
): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return null;
  }
  if (configured.includes(raw)) {
    return raw;
  }
  if (!raw.startsWith("[")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return null;
  }
  const [provider, model] = parsed;
  if (provider !== DSH_PROVIDER_ROUTE || typeof model !== "string") {
    return null;
  }
  if (!configured.includes(model)) {
    return null;
  }
  return model;
}

function findUnverifiedField(value: unknown, path = ""): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findUnverifiedField(value[index], `${path}[${index}]`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const isSupportedModelCapability = /^models\[\d+\]$/.test(path)
      && (key === "reasoningEfforts" || key === "compat" || key === "contextWindow");
    if ((DSH_UNVERIFIED_FIELDS as readonly string[]).includes(key) && !isSupportedModelCapability) {
      return path ? `${path}.${key}` : key;
    }
    const found = findUnverifiedField(child, path ? `${path}.${key}` : key);
    if (found) {
      return found;
    }
  }
  return null;
}

function hasModelsAndOverrides(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasModelsAndOverrides(item));
  }
  const record = value as Record<string, unknown>;
  if ("models" in record && "modelOverrides" in record) {
    return true;
  }
  return Object.values(record).some((child) => hasModelsAndOverrides(child));
}

function retryPolicyError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "DSH retryPolicy must stay mode=normal with the verified backoff.";
  }
  const policy = value as Record<string, unknown>;
  const extra = unknownClosedKey(policy, DSH_RETRY_KEYS);
  if (extra) {
    return `DSH profile field retryPolicy.${extra} is not part of the verified contract.`;
  }
  if (policy.mode !== "normal" || policy.maxRetries !== 1) {
    return "DSH retryPolicy must stay mode=normal with the verified backoff.";
  }
  const backoff = policy.backoff;
  if (!backoff || typeof backoff !== "object" || Array.isArray(backoff)) {
    return "DSH retryPolicy must stay mode=normal with the verified backoff.";
  }
  const delays = backoff as Record<string, unknown>;
  const backoffExtra = unknownClosedKey(delays, DSH_BACKOFF_KEYS);
  if (backoffExtra) {
    return `DSH profile field retryPolicy.backoff.${backoffExtra} is not part of the verified contract.`;
  }
  if (delays.initialDelayMs !== 200 || delays.maxDelayMs !== 1000) {
    return "DSH retryPolicy must stay mode=normal with the verified backoff.";
  }
  return null;
}

function unknownClosedKey(record: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return key;
    }
  }
  return null;
}

function preservedFields(
  record: Record<string, unknown>,
  known: readonly string[],
  path = "",
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (known.includes(key)) {
      continue;
    }
    const fieldPath = path ? `${path}.${key}` : key;
    if (isBlockedJsonKey(key)) {
      return { ok: false, error: `DSH profile field ${fieldPath} is not part of the verified contract.` };
    }
    const cloned = cloneJsonValue(value);
    if (!cloned.ok) {
      return { ok: false, error: `DSH profile field ${fieldPath} is not part of the verified contract.` };
    }
    const blocked = blockedKeyIn(cloned.value, fieldPath);
    if (blocked) {
      return { ok: false, error: blocked };
    }
    fields[key] = cloned.value;
  }
  return { ok: true, fields };
}

function isBlockedJsonKey(key: string): boolean {
  return DSH_BLOCKED_JSON_KEYS.has(key) || (DSH_UNVERIFIED_FIELDS as readonly string[]).includes(key);
}

function blockedKeyIn(value: unknown, path: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = blockedKeyIn(value[index], `${path}[${index}]`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const fieldPath = `${path}.${key}`;
    if (isBlockedJsonKey(key)) {
      return `DSH profile field ${fieldPath} is not part of the verified contract.`;
    }
    const found = blockedKeyIn(child, fieldPath);
    if (found) {
      return found;
    }
  }
  return null;
}

function cloneJsonValue(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(JSON.stringify(value)) as unknown };
  } catch {
    return { ok: false };
  }
}

function fallbackDshModel(config: DshConfigModels): string | null {
  return config.defaultModel && config.models.includes(config.defaultModel)
    ? config.defaultModel
    : null;
}

function canonicalDshBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || /\s/.test(value) || value.includes("\\")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
    return null;
  }
  const loopbackHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    return null;
  }
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") {
    return true;
  }
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mappedDotted) {
    return isIpv4Loopback(mappedDotted[1]);
  }
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    const octets = [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255];
    return octets[0] === 127;
  }
  return isIpv4Loopback(host);
}

function isIpv4Loopback(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return false;
  }
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return octets[0] === 127;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}
