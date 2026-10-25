import * as fs from "fs/promises";
import * as path from "path";
import { GROK_REASONING_EFFORTS } from "../cli/types";
import { writeFileAtomically } from "../shared/atomicWrite";
import { resolveGrokConfigPath, resolveGrokHomeDir } from "../shared/userHomePaths";
import {
  cloneGrokToml,
  isGrokTomlTable,
  parseGrokToml,
  serializeGrokToml,
  type GrokTomlTable,
  type GrokTomlValue,
} from "./grokToml";

export const GROK_API_BACKENDS = ["chat_completions", "responses", "messages"] as const;
export const GROK_REASONING_SUMMARIES = ["none", "auto", "concise", "detailed"] as const;
export const GROK_VISUAL_BLOCKED_KEYS = [
  "service_tier",
  "disable_response_storage",
  "wire_api",
  "requires_openai_auth",
] as const;

export const GROK_KEDAYA_PROFILE = {
  id: "config_grok_4_7_kedaya",
  name: "grok-4.7",
  sourceConfigId: "config_1774255517037_j3noqy1rp",
  modelId: "grok-4.7",
  reasoningEffort: "xhigh",
  baseUrl: "http://127.0.0.1:33391/v1",
  apiBackend: "responses",
  contextWindow: 500000,
  compactionAtTokens: 450000,
} as const;

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type GrokEditorStatus = "empty" | "loading" | "parse-error" | "ready";

export type GrokVisualFieldSpec = {
  id: string;
  section: "models" | "model";
  label: { zh: string; en: string };
  tooltip: { zh: string; en: string };
};

export type GrokVisualModelPatch = {
  id: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiBackend?: string;
  envKey?: string;
  contextWindow?: string;
  reasoningSummary?: string;
  compactionAtTokens?: string;
};

export type GrokVisualPatch = {
  defaultModel?: string;
  defaultReasoningEffort?: string;
  model?: GrokVisualModelPatch;
};

export type GrokTextCommit =
  | { ok: true; reason: "empty" | "updated"; content: string; document: GrokTomlTable }
  | { ok: false; reason: "invalid"; content: string; error: string };

export const GROK_VISUAL_FIELDS: readonly GrokVisualFieldSpec[] = [
  {
    id: "models.default",
    section: "models",
    label: { zh: "默认模型", en: "Default model" },
    tooltip: { zh: "写入 [models].default。", en: "Writes [models].default." },
  },
  {
    id: "models.default_reasoning_effort",
    section: "models",
    label: { zh: "默认思考档", en: "Default reasoning effort" },
    tooltip: {
      zh: "只允许 none、minimal、low、medium、high、xhigh、max。",
      en: "Only none, minimal, low, medium, high, xhigh, or max.",
    },
  },
  {
    id: "model.model",
    section: "model",
    label: { zh: "模型 ID", en: "Model ID" },
    tooltip: { zh: "写入 [model.<id>].model。", en: "Writes [model.<id>].model." },
  },
  {
    id: "model.base_url",
    section: "model",
    label: { zh: "接口地址", en: "Base URL" },
    tooltip: { zh: "写入 [model.<id>].base_url。", en: "Writes [model.<id>].base_url." },
  },
  {
    id: "model.api_key",
    section: "model",
    label: { zh: "API Key", en: "API Key" },
    tooltip: {
      zh: "写入 [model.<id>].api_key。这是密钥本身；不知道时留空，不从 Codex auth.json 复制。",
      en: "Writes [model.<id>].api_key. This is the key itself; leave it empty when unknown and do not copy Codex auth.json.",
    },
  },
  {
    id: "model.api_backend",
    section: "model",
    label: { zh: "接口协议", en: "API backend" },
    tooltip: {
      zh: "只允许 chat_completions、responses、messages。",
      en: "Only chat_completions, responses, or messages.",
    },
  },
  {
    id: "model.env_key",
    section: "model",
    label: { zh: "环境变量名", en: "Environment variable" },
    tooltip: {
      zh: "只写环境变量名，不写密钥值。",
      en: "Environment variable name only, never the secret value.",
    },
  },
  {
    id: "model.context_window",
    section: "model",
    label: { zh: "上下文窗口", en: "Context window" },
    tooltip: { zh: "非负整数 token 上限。", en: "Non-negative integer token limit." },
  },
  {
    id: "model.reasoning_summary",
    section: "model",
    label: { zh: "思考摘要", en: "Reasoning summary" },
    tooltip: {
      zh: "只允许 none、auto、concise、detailed。",
      en: "Only none, auto, concise, or detailed.",
    },
  },
  {
    id: "model.compaction_at_tokens",
    section: "model",
    label: { zh: "压缩阈值", en: "Compaction threshold" },
    tooltip: { zh: "非负整数 token 阈值。", en: "Non-negative integer token threshold." },
  },
];

export function resolveGrokEditorStatus(input: {
  loading: boolean;
  content: string;
  parseError: string | null;
}): GrokEditorStatus {
  if (input.loading) {
    return "loading";
  }
  if (input.parseError) {
    return "parse-error";
  }
  return input.content.trim() ? "ready" : "empty";
}

export function isGrokVisualSaveDisabled(input: {
  status: GrokEditorStatus;
  fieldError: string | null;
}): boolean {
  return input.status === "loading" || input.status === "parse-error" || Boolean(input.fieldError);
}

export function commitGrokText(previousContent: string, nextContent: string): GrokTextCommit {
  if (nextContent.trim() === "") {
    return { ok: true, reason: "empty", content: "", document: {} };
  }
  const parsed = parseGrokToml(nextContent);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "invalid",
      content: previousContent,
      error: parsed.error,
    };
  }
  return {
    ok: true,
    reason: "updated",
    content: nextContent,
    document: parsed.value,
  };
}

export function readGrokVisualModel(document: GrokTomlTable, modelId: string): GrokTomlTable | null {
  const models = document.model;
  if (!isGrokTomlTable(models)) {
    return null;
  }
  const model = models[modelId];
  return isGrokTomlTable(model) ? model : null;
}

export function applyGrokVisualPatch(
  document: GrokTomlTable,
  patch: GrokVisualPatch,
): { ok: true; document: GrokTomlTable } | { ok: false; error: string } {
  const next = cloneGrokToml(document);
  if (patch.defaultModel !== undefined) {
    setOptionalString(ensureTable(next, "models"), "default", patch.defaultModel);
  }
  if (patch.defaultReasoningEffort !== undefined) {
    const error = validateChoice(patch.defaultReasoningEffort, GROK_REASONING_EFFORTS, "default_reasoning_effort");
    if (error) {
      return { ok: false, error };
    }
    setOptionalString(ensureTable(next, "models"), "default_reasoning_effort", patch.defaultReasoningEffort);
  }
  if (patch.model) {
    const modelError = applyModelPatch(next, patch.model);
    if (modelError) {
      return { ok: false, error: modelError };
    }
  }
  const fieldError = validateGrokDocument(next);
  if (fieldError) {
    return { ok: false, error: fieldError };
  }
  return { ok: true, document: next };
}

export function validateGrokDocument(document: GrokTomlTable): string | null {
  const models = document.models;
  if (models !== undefined && !isGrokTomlTable(models)) {
    return "models 必须是表。";
  }
  if (isGrokTomlTable(models)) {
    const effort = models.default_reasoning_effort;
    if (effort !== undefined && !isAllowed(effort, GROK_REASONING_EFFORTS)) {
      return "default_reasoning_effort 无效。";
    }
  }
  const modelTable = document.model;
  if (modelTable !== undefined && !isGrokTomlTable(modelTable)) {
    return "model 必须是表。";
  }
  if (!isGrokTomlTable(modelTable)) {
    return null;
  }
  for (const [modelId, value] of Object.entries(modelTable)) {
    if (!modelId.trim()) {
      return "模型 ID 不能为空。";
    }
    if (!isGrokTomlTable(value)) {
      continue;
    }
    if (value.api_backend !== undefined && !isAllowed(value.api_backend, GROK_API_BACKENDS)) {
      return "api_backend 无效。";
    }
    if (value.reasoning_summary !== undefined && !isAllowed(value.reasoning_summary, GROK_REASONING_SUMMARIES)) {
      return "reasoning_summary 无效。";
    }
    if (value.api_key !== undefined && typeof value.api_key !== "string") {
      return "api_key 必须是字符串。";
    }
    if (value.env_key !== undefined && !isEnvKey(value.env_key)) {
      return "env_key 只能是环境变量名。";
    }
    if (value.context_window !== undefined && !isNonNegativeInteger(value.context_window)) {
      return "context_window 必须是非负整数。";
    }
    if (value.compaction_at_tokens !== undefined && !isNonNegativeInteger(value.compaction_at_tokens)) {
      return "compaction_at_tokens 必须是非负整数。";
    }
  }
  return null;
}

export function serializeGrokDocument(document: GrokTomlTable): { ok: true; content: string } | { ok: false; error: string } {
  const fieldError = validateGrokDocument(document);
  if (fieldError) {
    return { ok: false, error: fieldError };
  }
  return serializeGrokToml(document);
}

export function mergeGrokKedayaProfile(existingContent: string): GrokTextCommit {
  const base = commitGrokText(existingContent, existingContent.trim() ? existingContent : "");
  if (!base.ok) {
    return base;
  }
  const existingModel = readGrokVisualModel(base.document, GROK_KEDAYA_PROFILE.modelId);
  const patched = applyGrokVisualPatch(base.document, {
    defaultModel: GROK_KEDAYA_PROFILE.modelId,
    defaultReasoningEffort: GROK_KEDAYA_PROFILE.reasoningEffort,
    model: {
      id: GROK_KEDAYA_PROFILE.modelId,
      model: GROK_KEDAYA_PROFILE.modelId,
      baseUrl: GROK_KEDAYA_PROFILE.baseUrl,
      apiKey: typeof existingModel?.api_key === "string" ? existingModel.api_key : "",
      apiBackend: GROK_KEDAYA_PROFILE.apiBackend,
      contextWindow: String(GROK_KEDAYA_PROFILE.contextWindow),
      compactionAtTokens: String(GROK_KEDAYA_PROFILE.compactionAtTokens),
    },
  });
  if (!patched.ok) {
    return { ok: false, reason: "invalid", content: existingContent, error: patched.error };
  }
  const serialized = serializeGrokDocument(patched.document);
  if (!serialized.ok) {
    return { ok: false, reason: "invalid", content: existingContent, error: serialized.error };
  }
  return { ok: true, reason: "updated", content: serialized.content, document: patched.document };
}

export async function applyGrokKedayaProfile(options: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  now?: number;
} = {}): Promise<{ configPath: string; profilePath: string; content: string }> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? undefined;
  const configPath = homeDir
    ? resolveGrokConfigPath(env, homeDir, options.platform)
    : resolveGrokConfigPath(env, undefined, options.platform);
  const existing = await readOptionalText(configPath);
  const merged = mergeGrokKedayaProfile(existing);
  if (!merged.ok) {
    throw new Error(merged.error);
  }
  await writeFileAtomically(configPath, merged.content);
  const profileDir = path.join(path.dirname(configPath), "__config");
  const profilePath = path.join(profileDir, `${GROK_KEDAYA_PROFILE.id}.json`);
  const now = options.now ?? Date.now();
  const previous = await readOptionalJson(profilePath);
  const profile = {
    id: GROK_KEDAYA_PROFILE.id,
    name: GROK_KEDAYA_PROFILE.name,
    platform: "grok",
    sourceConfigId: GROK_KEDAYA_PROFILE.sourceConfigId,
    configContent: merged.content,
    createdAt: typeof previous.createdAt === "number" ? previous.createdAt : now,
    updatedAt: now,
  };
  await writeFileAtomically(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  return { configPath, profilePath, content: merged.content };
}


export function grokActiveModelHasOwnCredential(
  document: GrokTomlTable,
  env: NodeJS.ProcessEnv = process.env,
  selectedModel?: string | null,
): boolean {
  const models = document.models;
  const modelTable = document.model;
  if (!isGrokTomlTable(modelTable)) {
    return false;
  }
  const defaultModel = selectedModel?.trim()
    || (isGrokTomlTable(models) && typeof models.default === "string" ? models.default.trim() : "");
  if (!defaultModel) {
    return false;
  }
  const model = modelTable[defaultModel];
  if (!isGrokTomlTable(model)) {
    return false;
  }
  if (typeof model.api_key === "string" && model.api_key.trim()) {
    return true;
  }
  return envKeyHasValue(model.env_key, env);
}

export async function readGrokActiveModelHasOwnCredential(
  env: NodeJS.ProcessEnv = process.env,
  homeDir?: string,
  selectedModel?: string | null,
): Promise<boolean> {
  try {
    const content = await fs.readFile(resolveGrokConfigPath(env, homeDir), "utf8");
    const parsed = parseGrokToml(content);
    return parsed.ok && grokActiveModelHasOwnCredential(parsed.value, env, selectedModel);
  } catch {
    return false;
  }
}

function envKeyHasValue(value: GrokTomlValue | undefined, env: NodeJS.ProcessEnv): boolean {
  const names = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return names.some((name) => typeof name === "string" && String(env[name.trim()] ?? "").trim().length > 0);
}

export function resolveGrokProfileDir(env: NodeJS.ProcessEnv = process.env, homeDir?: string): string {
  return path.join(resolveGrokHomeDir(env, homeDir), "__config");
}

function applyModelPatch(document: GrokTomlTable, patch: GrokVisualModelPatch): string | null {
  const modelId = patch.id.trim();
  if (!modelId) {
    return "模型 ID 不能为空。";
  }
  const models = ensureTable(document, "model");
  const existing = models[modelId];
  const model = isGrokTomlTable(existing) ? cloneGrokToml(existing) : {};
  if (patch.apiKey !== undefined) {
    model.api_key = patch.apiKey.trim();
  }
  const assignments: Array<[string, string | undefined]> = [
    ["model", patch.model],
    ["base_url", patch.baseUrl],
    ["api_backend", patch.apiBackend],
    ["env_key", patch.envKey],
    ["reasoning_summary", patch.reasoningSummary],
  ];
  for (const [key, value] of assignments) {
    if (value === undefined || GROK_VISUAL_BLOCKED_KEYS.includes(key as typeof GROK_VISUAL_BLOCKED_KEYS[number])) {
      continue;
    }
    const error = validateModelField(key, value);
    if (error) {
      return error;
    }
    setOptionalString(model, key, value);
  }
  if (patch.contextWindow !== undefined) {
    const error = setOptionalInteger(model, "context_window", patch.contextWindow);
    if (error) {
      return error;
    }
  }
  if (patch.compactionAtTokens !== undefined) {
    const error = setOptionalInteger(model, "compaction_at_tokens", patch.compactionAtTokens);
    if (error) {
      return error;
    }
  }
  models[modelId] = model;
  return null;
}

function validateModelField(key: string, value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  if (key === "api_backend" && !(GROK_API_BACKENDS as readonly string[]).includes(value.trim())) {
    return "api_backend 无效。";
  }
  if (key === "reasoning_summary" && !(GROK_REASONING_SUMMARIES as readonly string[]).includes(value.trim())) {
    return "reasoning_summary 无效。";
  }
  if (key === "env_key" && !ENV_KEY_PATTERN.test(value.trim())) {
    return "env_key 只能是环境变量名。";
  }
  return null;
}

function setOptionalInteger(target: GrokTomlTable, key: string, value: string): string | null {
  if (!value.trim()) {
    delete target[key];
    return null;
  }
  if (!/^\d+$/.test(value.trim())) {
    return `${key} 必须是非负整数。`;
  }
  target[key] = Number(value.trim());
  return null;
}

function setOptionalString(target: GrokTomlTable, key: string, value: string): void {
  if (!value.trim()) {
    delete target[key];
    return;
  }
  target[key] = value.trim();
}

function ensureTable(document: GrokTomlTable, key: string): GrokTomlTable {
  const existing = document[key];
  if (isGrokTomlTable(existing)) {
    return existing;
  }
  const created: GrokTomlTable = {};
  document[key] = created;
  return created;
}

function validateChoice(value: string, allowed: readonly string[], label: string): string | null {
  if (!value.trim()) {
    return null;
  }
  return allowed.includes(value.trim()) ? null : `${label} 无效。`;
}

function isAllowed(value: GrokTomlValue, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function isEnvKey(value: GrokTomlValue): boolean {
  return typeof value === "string" && ENV_KEY_PATTERN.test(value);
}

function isNonNegativeInteger(value: GrokTomlValue): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readOptionalJson(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
