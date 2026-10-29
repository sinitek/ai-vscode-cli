import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ZCODE_API_TYPES,
  ZCODE_GLM_DEFAULT_REASONING_LEVEL,
  ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID,
  ZCODE_GLM_OFFICIAL_API_TYPE,
  type ZcodeApiType,
} from "../interactive/zcodeAppServerProtocol";

export const ZCODE_PROVIDER_CONFIG_FILE = "provider_config.json";
export const ZCODE_EXAMPLE_BASE_URL = "http://127.0.0.1:33391/v1";
export const ZCODE_EXAMPLE_MODEL_ID = "glm-5.3-flash";
export const ZCODE_EXAMPLE_PROVIDER_ID = "local-glm";
export const ZCODE_EXAMPLE_API_KEY_PLACEHOLDER = "your_apikey";
export const ZCODE_EXAMPLE_API_TYPE: ZcodeApiType = "openai-responses";
export const ZCODE_EXAMPLE_REASONING_LEVEL = "high";
export { ZCODE_GLM_DEFAULT_REASONING_LEVEL, ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID };

export type ZcodeConfigModel = {
  id: string;
  contextWindow: number | null;
  reasoningLevels: string[];
};

export type ZcodeProviderConfigView = {
  providerId: string;
  providerName: string;
  enabled: boolean;
  apiType: ZcodeApiType;
  baseUrl: string;
  apiKey: string;
  models: ZcodeConfigModel[];
  defaultModel: string | null;
  defaultReasoningLevel: string | null;
};

export type ZcodeConfigMergeResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveZcodeProviderConfigPath(
  homeDir = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dataBase = readString(env.ZCODE_DATA_BASE_DIR) || homeDir;
  const override = readString(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE);
  if (override) {
    return override;
  }
  return path.join(dataBase, ".zcode", "v2", ZCODE_PROVIDER_CONFIG_FILE);
}

export function createZcodeExampleDocument(): JsonRecord {
  return {
    schemaVersion: 1,
    config: {
      defaultModelSelection: {
        providerId: ZCODE_EXAMPLE_PROVIDER_ID,
        modelId: ZCODE_EXAMPLE_MODEL_ID,
        options: { reasoningLevel: ZCODE_EXAMPLE_REASONING_LEVEL },
      },
      providerConfigRules: {
        providerRules: [
          {
            providerId: ZCODE_EXAMPLE_PROVIDER_ID,
            config: {
              group: "standard-personal",
              access: {
                type: "api-key",
                apiKey: ZCODE_EXAMPLE_API_KEY_PLACEHOLDER,
              },
              api: {
                type: ZCODE_EXAMPLE_API_TYPE,
                baseUrl: ZCODE_EXAMPLE_BASE_URL,
              },
              personalModelIds: [ZCODE_EXAMPLE_MODEL_ID],
            },
          },
        ],
      },
      modelConfigRules: {
        providerModelRules: [],
        manualProviderModelRules: [],
      },
    },
  };
}

export function createZcodeExampleText(): string {
  return `${JSON.stringify(createZcodeExampleDocument(), null, 2)}\n`;
}

function assertSafeDocument(value: unknown, label: string): JsonRecord {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.config)) {
    throw new Error(`${label} is not a ZCode provider_config.json schemaVersion 1 document.`);
  }
  const rules = isRecord(value.config.providerConfigRules)
    ? value.config.providerConfigRules.providerRules : undefined;
  if (!Array.isArray(rules)) {
    throw new Error(`${label} providerRules must be an array.`);
  }
  const models = isRecord(value.config.modelConfigRules) ? value.config.modelConfigRules : {};
  if (!Array.isArray(models.providerModelRules) || !Array.isArray(models.manualProviderModelRules)) {
    throw new Error(`${label} modelConfigRules requires providerModelRules and manualProviderModelRules arrays.`);
  }
  return value;
}

function cloneDocument(value: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

function providerRulesOf(document: JsonRecord): JsonRecord[] {
  const config = document.config as JsonRecord;
  const rules = isRecord(config.providerConfigRules) ? config.providerConfigRules : {};
  config.providerConfigRules = rules;
  if (!Array.isArray(rules.providerRules)) {
    rules.providerRules = [];
  }
  return (rules.providerRules as unknown[]).filter(isRecord);
}

function manualRulesOf(document: JsonRecord): JsonRecord[] {
  const config = document.config as JsonRecord;
  const rules = isRecord(config.modelConfigRules) ? config.modelConfigRules : {};
  config.modelConfigRules = rules;
  if (!Array.isArray(rules.providerModelRules)) {
    rules.providerModelRules = [];
  }
  if (!Array.isArray(rules.manualProviderModelRules)) {
    rules.manualProviderModelRules = [];
  }
  return (rules.manualProviderModelRules as unknown[]).filter(isRecord);
}

function providerModelRulesOf(document: JsonRecord): JsonRecord[] {
  const config = document.config as JsonRecord;
  const rules = isRecord(config.modelConfigRules) ? config.modelConfigRules : {};
  config.modelConfigRules = rules;
  if (!Array.isArray(rules.providerModelRules)) {
    rules.providerModelRules = [];
  }
  return (rules.providerModelRules as unknown[]).filter(isRecord);
}

function replaceOrAppend(list: JsonRecord[], next: JsonRecord, same: (item: JsonRecord) => boolean): JsonRecord[] {
  const index = list.findIndex(same);
  if (index >= 0) {
    const copy = list.slice();
    copy[index] = next;
    return copy;
  }
  return [...list, next];
}

export function mergeZcodeProviderConfigText(currentText: string, incomingText: string): ZcodeConfigMergeResult {
  let incoming: JsonRecord;
  try {
    incoming = assertSafeDocument(JSON.parse(incomingText), "Incoming ZCode config");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Incoming ZCode config is invalid." };
  }
  const trimmed = currentText.trim();
  if (!trimmed) {
    return { ok: true, content: `${JSON.stringify(incoming, null, 2)}\n` };
  }
  let current: JsonRecord;
  try {
    current = assertSafeDocument(JSON.parse(trimmed), "Existing ZCode config");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? `${error.message} Existing provider settings were left unchanged.`
        : "Existing ZCode config cannot be merged safely.",
    };
  }
  const merged = cloneDocument(current);
  const config = merged.config as JsonRecord;
  const modelConfig = isRecord(config.modelConfigRules) ? config.modelConfigRules : {};
  config.modelConfigRules = modelConfig;
  const incomingProviderIds = new Set(providerRulesOf(incoming).map((rule) => readString(rule.providerId)));
  let modelRules = providerModelRulesOf(merged).filter((rule) => !incomingProviderIds.has(readString(rule.providerId)));
  for (const rule of providerModelRulesOf(incoming)) {
    const providerId = readString(rule.providerId);
    const modelId = readString(rule.modelId);
    if (!providerId || !modelId) {
      return { ok: false, error: "Incoming ZCode model rule is missing providerId or modelId." };
    }
    modelRules = replaceOrAppend(
      modelRules,
      rule,
      (item) => readString(item.providerId) === providerId && readString(item.modelId) === modelId,
    );
  }
  modelConfig.providerModelRules = modelRules;
  let providers = providerRulesOf(merged);
  for (const rule of providerRulesOf(incoming)) {
    const providerId = readString(rule.providerId);
    if (!providerId) {
      return { ok: false, error: "Incoming ZCode provider is missing providerId." };
    }
    providers = replaceOrAppend(providers, rule, (item) => readString(item.providerId) === providerId);
  }
  (config.providerConfigRules as JsonRecord).providerRules = providers;
  let manuals = manualRulesOf(merged).filter((rule) => !incomingProviderIds.has(readString(rule.providerId)));
  const incomingProviderModelKeys = new Set(providerModelRulesOf(incoming).map((rule) => (
    `${readString(rule.providerId)}\u0000${readString(rule.modelId)}`
  )));
  manuals = manuals.filter((rule) => !incomingProviderModelKeys.has(
    `${readString(rule.providerId)}\u0000${readString(rule.modelId)}`,
  ));
  for (const rule of manualRulesOf(incoming)) {
    const providerId = readString(rule.providerId);
    const modelId = readString(rule.modelId);
    if (!providerId || !modelId) {
      return { ok: false, error: "Incoming ZCode model rule is missing providerId or modelId." };
    }
    manuals = replaceOrAppend(
      manuals,
      rule,
      (item) => readString(item.providerId) === providerId && readString(item.modelId) === modelId,
    );
  }
  modelConfig.manualProviderModelRules = manuals;
  const order = Array.isArray(config.providerOrder)
    ? config.providerOrder.filter((item): item is string => typeof item === "string")
    : [];
  const incomingOrder = Array.isArray((incoming.config as JsonRecord).providerOrder)
    ? ((incoming.config as JsonRecord).providerOrder as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  for (const providerId of incomingOrder) {
    if (!order.includes(providerId)) {
      order.push(providerId);
    }
  }
  if (Array.isArray(config.providerOrder) || Array.isArray((incoming.config as JsonRecord).providerOrder)) {
    config.providerOrder = order;
  }
  if (isRecord((incoming.config as JsonRecord).defaultModelSelection)) {
    config.defaultModelSelection = (incoming.config as JsonRecord).defaultModelSelection;
  }
  return { ok: true, content: `${JSON.stringify(merged, null, 2)}\n` };
}

function readModelRule(document: JsonRecord, providerId: string, modelId: string): ZcodeConfigModel {
  const modelRule = providerModelRulesOf(document).find((item) => (
    readString(item.providerId) === providerId && readString(item.modelId) === modelId
  )) ?? manualRulesOf(document).find((item) => (
    readString(item.providerId) === providerId && readString(item.modelId) === modelId
  ));
  const config = isRecord(modelRule?.config) ? modelRule.config : {};
  const properties = isRecord(config.properties) ? config.properties : {};
  const optionSpecs = isRecord(config.optionSpecs) ? config.optionSpecs : {};
  const reasoning = isRecord(optionSpecs.reasoningLevel) ? optionSpecs.reasoningLevel : {};
  const contextWindow = typeof properties.contextWindow === "number" && Number.isFinite(properties.contextWindow)
    ? properties.contextWindow
    : null;
  const reasoningLevels = Array.isArray(reasoning.values)
    ? reasoning.values.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const effectiveReasoningLevels = reasoningLevels.length > 0
    ? reasoningLevels
    : modelId === ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID || modelId === ZCODE_EXAMPLE_MODEL_ID
      ? [ZCODE_GLM_DEFAULT_REASONING_LEVEL]
      : [];
  return { id: modelId, contextWindow, reasoningLevels: effectiveReasoningLevels };
}

export function parseZcodeProviderConfig(text: string): ZcodeProviderConfigView | null {
  if (!text.trim()) {
    return null;
  }
  let document: JsonRecord;
  try {
    document = assertSafeDocument(JSON.parse(text), "ZCode config");
  } catch {
    return null;
  }
  const rules = providerRulesOf(document);
  const rule = rules.find((item) => readString(item.providerId) === ZCODE_EXAMPLE_PROVIDER_ID) ?? rules[0];
  if (!rule) {
    return {
      providerId: "",
      providerName: "",
      enabled: false,
      apiType: ZCODE_GLM_OFFICIAL_API_TYPE,
      baseUrl: "",
      apiKey: "",
      models: [],
      defaultModel: null,
      defaultReasoningLevel: null,
    };
  }
  const config = isRecord(rule.config) ? rule.config : {};
  const api = isRecord(config.api) ? config.api : {};
  const access = isRecord(config.access) ? config.access : {};
  const apiType = readString(api.type);
  const providerId = readString(rule.providerId);
  const modelIds = Array.isArray(config.personalModelIds)
    ? config.personalModelIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const selection = isRecord((document.config as JsonRecord).defaultModelSelection)
    ? (document.config as JsonRecord).defaultModelSelection as JsonRecord
    : {};
  const defaultModel = readString(selection.providerId) && readString(selection.modelId)
    ? `${readString(selection.providerId)}/${readString(selection.modelId)}`
    : modelIds[0]
      ? `${providerId}/${modelIds[0]}`
      : null;
  const selectionOptions = isRecord(selection.options) ? selection.options : {};
  return {
    providerId,
    providerName: readString(rule.providerName),
    enabled: rule.enabled !== false,
    apiType: (ZCODE_API_TYPES as readonly string[]).includes(apiType)
      ? apiType as ZcodeApiType
      : ZCODE_GLM_OFFICIAL_API_TYPE,
    baseUrl: readString(api.baseUrl),
    apiKey: readString(access.apiKey),
    models: modelIds.map((modelId) => readModelRule(document, providerId, modelId)),
    defaultModel,
    defaultReasoningLevel: readString(selectionOptions.reasoningLevel) || null,
  };
}

export type ZcodeConfigModels = {
  models: string[];
  labels: Record<string, string>;
  defaultModel: string | null;
  error: string | null;
};

export function readZcodeConfigModels(text: string): ZcodeConfigModels {
  if (!text.trim()) {
    return { models: [], labels: {}, defaultModel: null, error: null };
  }
  const view = parseZcodeProviderConfig(text);
  if (!view) {
    return { models: [], labels: {}, defaultModel: null, error: "ZCode provider config could not be parsed." };
  }
  const modelEntries = view.providerId
    ? view.models.map((model) => [`${view.providerId}/${model.id}`, model.id] as const)
    : [];
  const models: string[] = modelEntries.map(([model]) => model);
  return {
    models,
    labels: Object.fromEntries(modelEntries),
    defaultModel: view.defaultModel && models.includes(view.defaultModel) ? view.defaultModel : models[0] ?? null,
    error: null,
  };
}

export function resolveZcodeConfigModel(
  config: ZcodeConfigModels | undefined,
  model: string | null,
): string | null {
  if (!config || config.error) {
    return null;
  }
  if (model && config.models.includes(model)) {
    return model;
  }
  return config.defaultModel;
}

export function resolveZcodeModelWireForRun(text: string, selectedModel: string | null): string {
  const config = readZcodeConfigModels(text);
  if (config.error) {
    throw new Error(config.error);
  }
  const model = resolveZcodeConfigModel(config, selectedModel);
  if (!model) {
    throw new Error("请先在 ZCode provider_config.json 中添加模型。");
  }
  const view = parseZcodeProviderConfig(text);
  const selected = view?.models.find((item) => `${view.providerId}/${item.id}` === model);
  const reasoningLevel = (view?.defaultModel === model ? view.defaultReasoningLevel : null)
    || selected?.reasoningLevels[0];
  return reasoningLevel ? `${model}$${reasoningLevel}` : model;
}

export function listZcodeModelRefs(text: string): string[] {
  const view = parseZcodeProviderConfig(text);
  if (!view || !view.providerId) {
    return [];
  }
  return view.models.map((model) => `${view.providerId}/${model.id}`);
}

export async function readZcodeProviderConfigText(
  homeDir = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  try {
    return await fs.promises.readFile(resolveZcodeProviderConfigPath(homeDir, env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function writeZcodeProviderConfigText(
  content: string,
  homeDir = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const target = resolveZcodeProviderConfigPath(homeDir, env);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, content, { mode: 0o600 });
  await fs.promises.chmod(temp, 0o600);
  await fs.promises.rename(temp, target);
  await fs.promises.chmod(target, 0o600);
}

export async function backupZcodeProviderConfig(
  homeDir = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const target = resolveZcodeProviderConfigPath(homeDir, env);
  try {
    await fs.promises.access(target);
  } catch {
    return null;
  }
  const backup = `${target}.bak-${Date.now()}`;
  await fs.promises.copyFile(target, backup);
  await fs.promises.chmod(backup, 0o600);
  return backup;
}
