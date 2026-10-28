import * as fs from "fs/promises";
import * as path from "path";
import { writeFileAtomically } from "../shared/atomicWrite";
import { resolveKimiCodeConfigPath, resolveKimiCodeHomeDir } from "../shared/userHomePaths";
import {
  cloneGrokToml,
  isGrokTomlTable,
  parseGrokToml,
  serializeGrokToml,
  type GrokTomlTable,
  type GrokTomlValue,
} from "./grokToml";

/**
 * Kimi Code 官方 CLI（@moonshot-ai/kimi-code）的配置文件是 TOML：
 * `~/.kimi-code/config.toml`，可用 `KIMI_CODE_HOME` 改目录，所有键为 snake_case。
 * 这里复用 Codex / Grok 的 TOML 读写实现，只承载 kimi-code 的字段语义。
 */

export const KIMI_CODE_DEFAULT_MODEL = "kimi-k3.1-pro";
export const KIMI_CODE_PROVIDER_TYPES = [
  "kimi",
  "anthropic",
  "openai",
  "openai_responses",
  "google-genai",
  "vertexai",
] as const;
export const KIMI_CODE_PERMISSION_MODES = ["manual", "yolo", "auto"] as const;
export const KIMI_CODE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/**
 * 官方 ACP 只在模型声明了 capabilities 时才下发 thinking 选项：
 * 实测 `capabilities = ["thinking"]` 会公布 off/low/medium/high/xhigh/max，
 * 不带 thinking 则完全不公布，配置页里的思考档位就会失效。
 * 具体档位仍由 support_efforts 限制。
 */
export const KIMI_CODE_CAPABILITIES = [
  "thinking",
  "always_thinking",
  "image_in",
  "video_in",
  "tool_use",
] as const;

export type KimiCodePermissionMode = (typeof KIMI_CODE_PERMISSION_MODES)[number];
export type KimiCodeProviderType = (typeof KIMI_CODE_PROVIDER_TYPES)[number];
export type KimiCodeEffort = (typeof KIMI_CODE_EFFORTS)[number];
export type KimiCodeCapability = (typeof KIMI_CODE_CAPABILITIES)[number];

export type KimiCodeConfigModels = {
  models: string[];
  labels: Record<string, string>;
  defaultModel: string | null;
  thinkingEffort: string | null;
  permissionMode: string | null;
  error: string | null;
};

const kimiCodeConfigRevisions = new Map<string, number>();

export function getKimiCodeConfigRevision(env: NodeJS.ProcessEnv = process.env): number {
  return kimiCodeConfigRevisions.get(path.resolve(resolveKimiCodeConfigPath(env))) ?? 0;
}

export function parseKimiCodeConfigModels(content: string): KimiCodeConfigModels {
  const parsed = parseGrokToml(content);
  if (!parsed.ok) {
    return {
      models: [],
      labels: {},
      defaultModel: null,
      thinkingEffort: null,
      permissionMode: null,
      error: parsed.error,
    };
  }
  const root = parsed.value;
  const modelTable = root.models;
  if (modelTable !== undefined && !isGrokTomlTable(modelTable)) {
    return {
      models: [],
      labels: {},
      defaultModel: null,
      thinkingEffort: null,
      permissionMode: null,
      error: "models 必须是 TOML 表。",
    };
  }
  const modelEntries = Object.entries(modelTable ?? {})
    .filter(([alias, value]) => alias.trim().length > 0 && isGrokTomlTable(value));
  const models = modelEntries.map(([alias]) => alias);
  const labels = Object.fromEntries(modelEntries.map(([alias, value]) => [
    alias,
    isGrokTomlTable(value) && typeof value.display_name === "string" && value.display_name.trim()
      ? value.display_name.trim()
      : alias,
  ]));
  const configuredDefault = typeof root.default_model === "string" ? root.default_model.trim() : "";
  const thinking = isGrokTomlTable(root.thinking) ? root.thinking : null;
  const permissionMode = typeof root.default_permission_mode === "string"
    ? root.default_permission_mode.trim()
    : null;
  return {
    models,
    labels,
    defaultModel: configuredDefault && models.includes(configuredDefault)
      ? configuredDefault
      : models[0] ?? null,
    thinkingEffort: thinking && typeof thinking.effort === "string" ? thinking.effort.trim() : null,
    permissionMode,
    error: null,
  };
}

export function resolveKimiCodeConfigModel(
  config: KimiCodeConfigModels | undefined,
  selectedModel: string | null | undefined,
): string | null {
  const selected = selectedModel?.trim();
  if (selected && config?.models.includes(selected)) {
    return selected;
  }
  return config?.defaultModel ?? null;
}

export type KimiCodeModelListChange =
  | { type: "add"; model: string }
  | { type: "rename"; model: string; nextModel: string }
  | { type: "delete"; model: string }
  | { type: "move"; model: string; direction: "up" | "down" };

export type KimiCodeModelListChangeResult =
  | { ok: true; content: string; model: string | null }
  | { ok: false; error: string };

export function changeKimiCodeConfigModelList(
  content: string,
  change: KimiCodeModelListChange,
): KimiCodeModelListChangeResult {
  const parsed = parseGrokToml(content);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const root = cloneGrokToml(parsed.value);
  const models = root.models === undefined ? {} : root.models;
  if (!isGrokTomlTable(models)) return { ok: false, error: "models 必须是 TOML 表。" };
  const aliases = Object.keys(models).filter((alias) => isGrokTomlTable(models[alias]));
  const model = change.model.trim();
  const aliasIndex = aliases.indexOf(model);
  if (change.type !== "add" && aliasIndex < 0) return { ok: false, error: "模型不存在，请刷新后重试。" };
  if (change.type === "add" || change.type === "rename") {
    const nextModel = change.type === "add" ? model : change.nextModel.trim();
    if (!nextModel || /[\r\n]/.test(nextModel)) return { ok: false, error: "模型别名不能为空，且不能换行。" };
    if (aliases.some((alias) => (change.type === "add" || alias !== model) && alias.toLowerCase() === nextModel.toLowerCase())) {
      return { ok: false, error: "模型别名已存在。" };
    }
    if (change.type === "add") {
      const templateAlias = typeof root.default_model === "string" && aliases.includes(root.default_model)
        ? root.default_model
        : aliases[0];
      const template = templateAlias ? models[templateAlias] : {};
      models[nextModel] = {
        ...(isGrokTomlTable(template) ? cloneGrokToml(template) : {}),
        model: nextModel,
      };
      if (!aliases.length) root.default_model = nextModel;
    } else {
      const nextModels: GrokTomlTable = {};
      for (const alias of Object.keys(models)) {
        nextModels[alias === model ? nextModel : alias] = models[alias];
      }
      root.models = nextModels;
      if (root.default_model === model) root.default_model = nextModel;
    }
  } else if (change.type === "delete") {
    delete models[model];
    if (root.default_model === model) {
      const nextDefault = Object.keys(models).find((alias) => isGrokTomlTable(models[alias]));
      if (nextDefault) root.default_model = nextDefault;
      else delete root.default_model;
    }
  } else {
    const nextIndex = change.direction === "up" ? aliasIndex - 1 : aliasIndex + 1;
    if (nextIndex < 0 || nextIndex >= aliases.length) return { ok: false, error: "模型已经位于边界。" };
    [aliases[aliasIndex], aliases[nextIndex]] = [aliases[nextIndex], aliases[aliasIndex]];
    root.models = Object.fromEntries(aliases.map((alias) => [alias, models[alias]]));
  }
  const serialized = serializeGrokToml(root);
  if (!serialized.ok) return { ok: false, error: serialized.error };
  const nextDefault = parseKimiCodeConfigModels(serialized.content).defaultModel;
  const committed = commitKimiCodeText(content, serialized.content);
  if (!committed.ok) return { ok: false, error: committed.error };
  return { ok: true, content: committed.content, model: change.type === "delete" ? nextDefault : change.type === "rename" ? change.nextModel.trim() : model };
}

export function isKimiCodeBypassPermissionMode(mode: string | null | undefined): boolean {
  return mode === "auto" || mode === "yolo";
}

export type KimiCodeTextCommit =
  | { ok: true; reason: "empty" | "updated"; content: string; document: GrokTomlTable }
  | { ok: false; reason: "invalid"; content: string; error: string };

export function commitKimiCodeText(previousContent: string, nextContent: string): KimiCodeTextCommit {
  if (nextContent.trim() === "") {
    return { ok: true, reason: "empty", content: "", document: {} };
  }
  const parsed = parseGrokToml(nextContent);
  if (!parsed.ok) {
    return { ok: false, reason: "invalid", content: previousContent, error: parsed.error };
  }
  const fieldError = validateKimiCodeDocument(parsed.value);
  if (fieldError) {
    return { ok: false, reason: "invalid", content: previousContent, error: fieldError };
  }
  const document = completeKimiCodeThinkingDeclarations(parsed.value);
  const serialized = serializeGrokToml(document);
  if (!serialized.ok) {
    return { ok: false, reason: "invalid", content: previousContent, error: serialized.error };
  }
  return { ok: true, reason: "updated", content: serialized.content, document };
}

function completeKimiCodeThinkingDeclarations(document: GrokTomlTable): GrokTomlTable {
  const next = cloneGrokToml(document);
  if (!isGrokTomlTable(next.models)) {
    return next;
  }
  for (const value of Object.values(next.models)) {
    if (!isGrokTomlTable(value)) {
      continue;
    }
    const capabilities = Array.isArray(value.capabilities) ? [...value.capabilities] : [];
    if (!capabilities.includes("thinking")) {
      capabilities.unshift("thinking");
    }
    value.capabilities = capabilities;
    if (value.support_efforts === undefined) {
      value.support_efforts = [...KIMI_CODE_EFFORTS];
    }
  }
  return next;
}

export function validateKimiCodeDocument(document: GrokTomlTable): string | null {
  const providers = document.providers;
  if (providers !== undefined && !isGrokTomlTable(providers)) {
    return "providers 必须是 TOML 表。";
  }
  if (isGrokTomlTable(providers)) {
    for (const [providerId, value] of Object.entries(providers)) {
      if (!providerId.trim()) {
        return "provider 名称不能为空。";
      }
      if (!isGrokTomlTable(value)) {
        return `providers.${providerId} 必须是 TOML 表。`;
      }
      const type = value.type;
      if (type !== undefined && !isAllowedString(type, KIMI_CODE_PROVIDER_TYPES)) {
        return `providers.${providerId}.type 无效，只允许 ${KIMI_CODE_PROVIDER_TYPES.join("、")}。`;
      }
      if (value.base_url !== undefined && typeof value.base_url !== "string") {
        return `providers.${providerId}.base_url 必须是字符串。`;
      }
      if (value.api_key !== undefined && typeof value.api_key !== "string") {
        return `providers.${providerId}.api_key 必须是字符串。`;
      }
      if (value.api_key_env !== undefined && !isEnvKey(value.api_key_env)) {
        return `providers.${providerId}.api_key_env 只能是环境变量名。`;
      }
    }
  }
  const models = document.models;
  if (models !== undefined && !isGrokTomlTable(models)) {
    return "models 必须是 TOML 表。";
  }
  if (isGrokTomlTable(models)) {
    for (const [alias, value] of Object.entries(models)) {
      if (!alias.trim()) {
        return "模型别名不能为空。";
      }
      if (!isGrokTomlTable(value)) {
        return `models.${alias} 必须是 TOML 表。`;
      }
      if (value.provider !== undefined && typeof value.provider !== "string") {
        return `models.${alias}.provider 必须是字符串。`;
      }
      if (value.model !== undefined && typeof value.model !== "string") {
        return `models.${alias}.model 必须是字符串。`;
      }
      if (value.max_context_size !== undefined && !isNonNegativeInteger(value.max_context_size)) {
        return `models.${alias}.max_context_size 必须是非负整数。`;
      }
      if (value.max_input_size !== undefined && !isNonNegativeInteger(value.max_input_size)) {
        return `models.${alias}.max_input_size 必须是非负整数。`;
      }
      if (value.max_output_size !== undefined && !isNonNegativeInteger(value.max_output_size)) {
        return `models.${alias}.max_output_size 必须是非负整数。`;
      }
      if (value.default_effort !== undefined && !isAllowedString(value.default_effort, KIMI_CODE_EFFORTS)) {
        return `models.${alias}.default_effort 无效，只允许 ${KIMI_CODE_EFFORTS.join("、")}。`;
      }
      if (value.support_efforts !== undefined) {
        if (!Array.isArray(value.support_efforts)) {
          return `models.${alias}.support_efforts 必须是字符串数组。`;
        }
        for (const effort of value.support_efforts) {
          if (!isAllowedString(effort, KIMI_CODE_EFFORTS)) {
            return `models.${alias}.support_efforts 含无效档位，只允许 ${KIMI_CODE_EFFORTS.join("、")}。`;
          }
        }
      }
      if (value.capabilities !== undefined) {
        if (!Array.isArray(value.capabilities)) {
          return `models.${alias}.capabilities 必须是字符串数组。`;
        }
        for (const capability of value.capabilities) {
          if (!isAllowedString(capability, KIMI_CODE_CAPABILITIES)) {
            return `models.${alias}.capabilities 含未知能力，只允许 ${KIMI_CODE_CAPABILITIES.join("、")}。`;
          }
        }
      }
    }
  }
  const thinking = document.thinking;
  if (thinking !== undefined && !isGrokTomlTable(thinking)) {
    return "thinking 必须是 TOML 表。";
  }
  if (isGrokTomlTable(thinking) && thinking.effort !== undefined && !isAllowedString(thinking.effort, KIMI_CODE_EFFORTS)) {
    return `thinking.effort 无效，只允许 ${KIMI_CODE_EFFORTS.join("、")}。`;
  }
  if (document.default_permission_mode !== undefined
    && !isAllowedString(document.default_permission_mode, KIMI_CODE_PERMISSION_MODES)) {
    return `default_permission_mode 无效，只允许 ${KIMI_CODE_PERMISSION_MODES.join("、")}。`;
  }
  if (document.default_model !== undefined && typeof document.default_model !== "string") {
    return "default_model 必须是字符串。";
  }
  const loopControl = document.loop_control;
  if (loopControl !== undefined && !isGrokTomlTable(loopControl)) {
    return "loop_control 必须是 TOML 表。";
  }
  if (isGrokTomlTable(loopControl) && loopControl.reserved_context_size !== undefined
    && !isNonNegativeInteger(loopControl.reserved_context_size)) {
    return "loop_control.reserved_context_size 必须是非负整数。";
  }
  const secondary = document.secondary_model;
  if (secondary !== undefined && !isGrokTomlTable(secondary)) {
    return "secondary_model 必须是 TOML 表。";
  }
  return null;
}

/**
 * 生成一份可直接被 `kimi doctor config` 通过的最小配置。
 * 默认模型别名不含供应商前缀，真实模型 ID 与供应商配置分开保存。
 */
export function createKimiCodeDefaultConfigText(options: {
  baseUrl?: string;
  providerId?: string;
  model?: string;
  contextSize?: number;
  apiKey?: string;
  apiKeyEnv?: string;
  permissionMode?: KimiCodePermissionMode;
} = {}): string {
  const model = options.model?.trim() || KIMI_CODE_DEFAULT_MODEL;
  const providerId = options.providerId?.trim() || "default";
  const baseUrl = options.baseUrl?.trim() || "http://127.0.0.1:33391/v1";
  const apiKey = options.apiKey?.trim() ?? "";
  const provider: GrokTomlTable = {
    type: "openai",
    base_url: baseUrl,
  };
  if (apiKey) {
    provider.api_key = apiKey;
  } else {
    provider.api_key_env = options.apiKeyEnv?.trim() || "KIMI_CODE_API_KEY";
  }
  const document: GrokTomlTable = {
    default_model: model,
    default_permission_mode: options.permissionMode ?? "auto",
    providers: { [providerId]: provider },
    models: {
      [model]: {
        provider: providerId,
        model: model.includes("/") ? (model.split("/").pop() as string) : model,
        max_context_size: options.contextSize ?? 262144,
        capabilities: ["thinking"],
        support_efforts: [...KIMI_CODE_EFFORTS],
      },
    },
  };
  const serialized = serializeGrokToml(document);
  return serialized.ok ? serialized.content : "";
}

export function serializeKimiCodeDocument(
  document: GrokTomlTable,
): { ok: true; content: string } | { ok: false; error: string } {
  const fieldError = validateKimiCodeDocument(document);
  if (fieldError) {
    return { ok: false, error: fieldError };
  }
  return serializeGrokToml(document);
}

export type KimiCodeVisualPatch = {
  defaultModel?: string;
  defaultPermissionMode?: string;
  thinkingEffort?: string;
  reservedContextSize?: string;
  model?: {
    alias: string;
    provider?: string;
    model?: string;
    displayName?: string;
    maxContextSize?: string;
    defaultEffort?: string;
  };
};

export function applyKimiCodeVisualPatch(
  document: GrokTomlTable,
  patch: KimiCodeVisualPatch,
): { ok: true; document: GrokTomlTable } | { ok: false; error: string } {
  const next = cloneGrokToml(document);
  if (patch.defaultModel !== undefined) {
    setOptionalString(next, "default_model", patch.defaultModel);
  }
  if (patch.defaultPermissionMode !== undefined) {
    const error = validateChoice(patch.defaultPermissionMode, KIMI_CODE_PERMISSION_MODES, "default_permission_mode");
    if (error) {
      return { ok: false, error };
    }
    setOptionalString(next, "default_permission_mode", patch.defaultPermissionMode);
  }
  if (patch.thinkingEffort !== undefined) {
    const error = validateChoice(patch.thinkingEffort, KIMI_CODE_EFFORTS, "thinking.effort");
    if (error) {
      return { ok: false, error };
    }
    const thinking = ensureTable(next, "thinking");
    setOptionalString(thinking, "effort", patch.thinkingEffort);
    if (thinking.enabled === undefined) {
      thinking.enabled = true;
    }
  }
  if (patch.reservedContextSize !== undefined) {
    const parsed = parseNonNegativeInteger(patch.reservedContextSize);
    if (parsed === null) {
      return { ok: false, error: "loop_control.reserved_context_size 必须是非负整数。" };
    }
    ensureTable(next, "loop_control").reserved_context_size = parsed;
  }
  if (patch.model) {
    const alias = patch.model.alias.trim();
    if (!alias) {
      return { ok: false, error: "模型别名不能为空。" };
    }
    const models = ensureTable(next, "models");
    const existing = isGrokTomlTable(models[alias]) ? cloneGrokToml(models[alias] as GrokTomlTable) : {};
    if (patch.model.provider !== undefined) {
      setOptionalString(existing, "provider", patch.model.provider);
    }
    if (patch.model.model !== undefined) {
      setOptionalString(existing, "model", patch.model.model);
    }
    if (patch.model.displayName !== undefined) {
      setOptionalString(existing, "display_name", patch.model.displayName);
    }
    if (patch.model.maxContextSize !== undefined) {
      const parsed = parseNonNegativeInteger(patch.model.maxContextSize);
      if (parsed === null) {
        return { ok: false, error: `models.${alias}.max_context_size 必须是非负整数。` };
      }
      existing.max_context_size = parsed;
    }
    if (patch.model.defaultEffort !== undefined) {
      const error = validateChoice(patch.model.defaultEffort, KIMI_CODE_EFFORTS, `models.${alias}.default_effort`);
      if (error) {
        return { ok: false, error };
      }
      setOptionalString(existing, "default_effort", patch.model.defaultEffort);
    }
    models[alias] = existing;
  }
  const fieldError = validateKimiCodeDocument(next);
  if (fieldError) {
    return { ok: false, error: fieldError };
  }
  return { ok: true, document: next };
}

export async function readKimiCodeConfigText(
  env: NodeJS.ProcessEnv = process.env,
  homeDir?: string,
): Promise<string> {
  const configPath = homeDir
    ? resolveKimiCodeConfigPath(env, homeDir)
    : resolveKimiCodeConfigPath(env);
  try {
    return await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function writeKimiCodeConfigText(
  content: string,
  env: NodeJS.ProcessEnv = process.env,
  homeDir?: string,
): Promise<void> {
  const committed = commitKimiCodeText("", content);
  if (!committed.ok) {
    throw new Error(committed.error);
  }
  const configPath = homeDir
    ? resolveKimiCodeConfigPath(env, homeDir)
    : resolveKimiCodeConfigPath(env);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  // config.toml 可能含 providers.*.api_key，按密钥文件处理。
  await writeFileAtomically(configPath, committed.content, { mode: 0o600 });
  const revisionKey = path.resolve(configPath);
  kimiCodeConfigRevisions.set(revisionKey, (kimiCodeConfigRevisions.get(revisionKey) ?? 0) + 1);
}

export function resolveKimiCodeConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir?: string,
): string {
  const root = homeDir ? resolveKimiCodeHomeDir(env, homeDir) : resolveKimiCodeHomeDir(env);
  return path.join(root, "__config");
}

function isAllowedString(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === "string" && allowed.includes(value);
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isEnvKey(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function validateChoice(value: unknown, allowed: readonly string[], field: string): string | null {
  if (value === "" || value === undefined) {
    return null;
  }
  if (!isAllowedString(value, allowed)) {
    return `${field} 无效，只允许 ${allowed.join("、")}。`;
  }
  return null;
}

function setOptionalString(target: GrokTomlTable, key: string, value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    delete target[key];
    return;
  }
  target[key] = trimmed;
}

function ensureTable(target: GrokTomlTable, key: string): GrokTomlTable {
  const current = target[key];
  if (isGrokTomlTable(current)) {
    return current;
  }
  const created: GrokTomlTable = {};
  target[key] = created;
  return created;
}

export type { GrokTomlTable as KimiCodeTomlTable, GrokTomlValue as KimiCodeTomlValue };
