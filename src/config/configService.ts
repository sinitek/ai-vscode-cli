import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { CliName } from "../cli/types";
import {
  ApplyPayload,
  ConfigItem,
  ConfigOrder,
  ConfigPlatform,
  CopyConfigPayload,
  CurrentConfig,
  ClaudeSkillItem,
  CodexSkillItem,
  OpenCodeSkillItem,
} from "./types";
import { listCodexSkills, mergeCodexSkillsConfig } from "./codexSkills";
import { listClaudeSkills, mergeClaudeSkillsConfig } from "./claudeSkills";
import { listOpenCodeSkills, mergeOpenCodeSkillsConfig } from "./geminiSkills";
import { t } from "../i18n";
export {
  getOfficialSkillsCatalog,
  installOfficialSkill,
  updateOfficialSkill,
  uninstallOfficialSkill,
} from "./officialSkillService";

const CONFIG_DIR_NAME = "__config";
const CONFIG_ORDER_FILE = "config-order.json";
const BACKUP_DIR = path.join(os.homedir(), ".ai_cli_tools_backups");
type ConfigPlatformInput = ConfigPlatform | CliName;
type LegacyConfigPlatformInput = ConfigPlatformInput;
type ConfigPathPlatform = "claude" | "codex" | "opencode";
const LEGACY_GEMINI_PLATFORM = "gemini";
const OPENCODE_PLACEHOLDER_PROVIDER_IDS = new Set(["myprovider"]);
const OPENCODE_PLACEHOLDER_MODEL_IDS = new Set([
  "my-model-name",
  "my-small-model-name",
  "gateway-chat-model",
  "gateway-small-model",
]);
const OPENCODE_PLACEHOLDER_BASE_URLS = new Set([
  "https://api.example.com",
  "https://api.example.com/v1",
  "https://api.myapi.example/v1",
  "https://www.packyapi.com",
]);
export const OPENCODE_PROVIDER_ADAPTER_NPM_BY_PROTOCOL = Object.freeze({
  anthropic: "@ai-sdk/anthropic",
  google: "@ai-sdk/google",
  openai: "@ai-sdk/openai",
  openaiCompatible: "@ai-sdk/openai-compatible",
});
const OPENCODE_RUNTIME_DIR = path.join(os.homedir(), ".opencode");
const OPENCODE_PROFILE_DIR = path.join(OPENCODE_RUNTIME_DIR, CONFIG_DIR_NAME);
const OPENCODE_CONFIG_PATH = path.join(OPENCODE_RUNTIME_DIR, "config.json");
const OPENCODE_LEGACY_CONFIG_PATH = path.join(os.homedir(), ".config", "opencode", "opencode.json");

const CONFIG_PATHS = {
  claude: {
    settings: path.join(os.homedir(), ".claude", "settings.json"),
    mcp: path.join(os.homedir(), ".claude.json"),
    configDir: path.join(os.homedir(), ".claude", CONFIG_DIR_NAME),
  },
  codex: {
    config: path.join(os.homedir(), ".codex", "config.toml"),
    auth: path.join(os.homedir(), ".codex", "auth.json"),
    configDir: path.join(os.homedir(), ".codex", CONFIG_DIR_NAME),
  },
  opencode: {
    config: OPENCODE_CONFIG_PATH,
    configDir: OPENCODE_PROFILE_DIR,
    legacyConfig: OPENCODE_LEGACY_CONFIG_PATH,
  },
} as const;

function normalizeConfigPlatform(platform: LegacyConfigPlatformInput): ConfigPathPlatform {
  if (platform === "claude") {
    return "claude";
  }
  if (platform === "codex") {
    return "codex";
  }
  if (platform === "opencode") {
    return "opencode";
  }
  if (platform === LEGACY_GEMINI_PLATFORM) {
    return "opencode";
  }
  throw new Error(`Unsupported config platform: ${String(platform)}`);
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function ensureFile(filePath: string, defaultContent: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, defaultContent, "utf-8");
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function getOpenCodeRuntimePaths(): {
  config: string;
  legacyConfig: string;
} {
  return {
    config: CONFIG_PATHS.opencode.config,
    legacyConfig: CONFIG_PATHS.opencode.legacyConfig,
  };
}

async function resolveOpenCodeReadPath(): Promise<string> {
  if (await pathExists(CONFIG_PATHS.opencode.config)) {
    return CONFIG_PATHS.opencode.config;
  }

  if (await pathExists(CONFIG_PATHS.opencode.legacyConfig)) {
    return CONFIG_PATHS.opencode.legacyConfig;
  }

  return CONFIG_PATHS.opencode.config;
}

export async function readClaudeConfig(): Promise<string> {
  await ensureFile(CONFIG_PATHS.claude.settings, "{}");
  return fs.readFile(CONFIG_PATHS.claude.settings, "utf-8");
}

export async function readClaudeMcpConfig(): Promise<string> {
  await ensureFile(CONFIG_PATHS.claude.mcp, "{}");
  return fs.readFile(CONFIG_PATHS.claude.mcp, "utf-8");
}

export async function readCodexConfig(): Promise<{ config: string; auth: string }> {
  await ensureFile(CONFIG_PATHS.codex.config, "");
  await ensureFile(CONFIG_PATHS.codex.auth, "{}");
  const [config, auth] = await Promise.all([
    fs.readFile(CONFIG_PATHS.codex.config, "utf-8"),
    fs.readFile(CONFIG_PATHS.codex.auth, "utf-8"),
  ]);
  return { config, auth };
}

export async function readOpenCodeConfig(): Promise<{ config: string; env: string }> {
  const runtimePath = await resolveOpenCodeReadPath();
  await ensureFile(runtimePath, "{}");
  const config = await fs.readFile(runtimePath, "utf-8");
  return { config, env: "" };
}

export async function writeClaudeConfig(content: string): Promise<void> {
  await ensureDir(path.dirname(CONFIG_PATHS.claude.settings));
  await fs.writeFile(CONFIG_PATHS.claude.settings, content, "utf-8");
}

export async function writeClaudeMcpConfig(content: string): Promise<void> {
  await ensureDir(path.dirname(CONFIG_PATHS.claude.mcp));

  const incoming = JSON.parse(content);
  if (!isPlainObject(incoming)) {
    throw new Error(t("config.mcpMustBeObject"));
  }

  let existingConfig: Record<string, unknown> = {};
  try {
    const currentContent = await fs.readFile(CONFIG_PATHS.claude.mcp, "utf-8");
    const parsed = JSON.parse(currentContent);
    if (isPlainObject(parsed)) {
      existingConfig = parsed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // 忽略读取失败，直接覆盖
    }
  }

  const mergedConfig: Record<string, unknown> = { ...existingConfig };
  Object.entries(incoming).forEach(([key, value]) => {
    mergedConfig[key] = value;
  });

  await fs.writeFile(CONFIG_PATHS.claude.mcp, JSON.stringify(mergedConfig, null, 2), "utf-8");
}

export async function writeCodexConfig(config: string, auth: string): Promise<void> {
  await ensureDir(path.dirname(CONFIG_PATHS.codex.config));
  await Promise.all([
    fs.writeFile(CONFIG_PATHS.codex.config, config, "utf-8"),
    fs.writeFile(CONFIG_PATHS.codex.auth, auth, "utf-8"),
  ]);
}

export async function writeOpenCodeConfig(config: string, _env?: string): Promise<void> {
  await ensureDir(path.dirname(CONFIG_PATHS.opencode.config));
  await fs.writeFile(CONFIG_PATHS.opencode.config, config, "utf-8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeMcpServerFromJsonText(
  content: string,
  serverId: string,
): { content: string; changed: boolean } {
  const parsed = JSON.parse(content);
  if (!isPlainObject(parsed)) {
    return { content, changed: false };
  }

  let changed = false;
  for (const key of ["mcp", "mcpServers", "mcp_servers"] as const) {
    const section = parsed[key];
    if (!isPlainObject(section) || !(serverId in section)) {
      continue;
    }
    const nextSection = { ...section };
    delete nextSection[serverId];
    parsed[key] = nextSection;
    changed = true;
  }

  return {
    content: changed ? `${JSON.stringify(parsed, null, 2)}\n` : content,
    changed,
  };
}

function removeCodexMcpServerBlock(
  content: string,
  serverId: string,
): { content: string; changed: boolean } {
  const lines = content.split(/\r?\n/);
  const headerPattern = new RegExp(`^\s*\[mcp_servers\.${escapeRegExp(serverId)}\]\s*$`);
  const nextSectionPattern = /^\s*\[[^\]]+\]\s*$/;
  const result: string[] = [];
  let changed = false;
  let skipping = false;

  for (const line of lines) {
    if (!skipping && headerPattern.test(line)) {
      skipping = true;
      changed = true;
      continue;
    }
    if (skipping && nextSectionPattern.test(line)) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }

  const nextContent = result.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return {
    content: nextContent.length > 0 ? `${nextContent}\n` : "",
    changed,
  };
}

async function cleanupClaudeMcpDocument(serverId: string): Promise<boolean> {
  const currentContent = await readClaudeMcpConfig();
  const next = removeMcpServerFromJsonText(currentContent, serverId);
  if (!next.changed) {
    return false;
  }
  await ensureDir(path.dirname(CONFIG_PATHS.claude.mcp));
  await fs.writeFile(CONFIG_PATHS.claude.mcp, next.content, "utf-8");
  return true;
}

async function cleanupOpenCodeMcpDocument(serverId: string): Promise<boolean> {
  const { config } = await readOpenCodeConfig();
  const next = removeMcpServerFromJsonText(config, serverId);
  if (!next.changed) {
    return false;
  }
  await writeOpenCodeConfig(next.content);
  return true;
}

async function cleanupCodexMcpDocument(serverId: string): Promise<boolean> {
  const { config, auth } = await readCodexConfig();
  const next = removeCodexMcpServerBlock(config, serverId);
  if (!next.changed) {
    return false;
  }
  await writeCodexConfig(next.content, auth);
  return true;
}

export async function backupClaudeConfig(): Promise<string[]> {
  await ensureDir(BACKUP_DIR);
  const [content, mcpContent] = await Promise.all([readClaudeConfig(), readClaudeMcpConfig()]);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const settingsBackupPath = path.join(BACKUP_DIR, `claude_settings_${timestamp}.json`);
  const mcpBackupPath = path.join(BACKUP_DIR, `claude_mcp_${timestamp}.json`);
  await Promise.all([
    fs.writeFile(settingsBackupPath, content, "utf-8"),
    fs.writeFile(mcpBackupPath, mcpContent, "utf-8"),
  ]);
  return [settingsBackupPath, mcpBackupPath];
}

export async function backupCodexConfig(): Promise<string[]> {
  await ensureDir(BACKUP_DIR);
  const { config, auth } = await readCodexConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const configBackupPath = path.join(BACKUP_DIR, `codex_config_${timestamp}.toml`);
  const authBackupPath = path.join(BACKUP_DIR, `codex_auth_${timestamp}.json`);
  await Promise.all([
    fs.writeFile(configBackupPath, config, "utf-8"),
    fs.writeFile(authBackupPath, auth, "utf-8"),
  ]);
  return [configBackupPath, authBackupPath];
}

export async function backupOpenCodeConfig(): Promise<string[]> {
  await ensureDir(BACKUP_DIR);
  const { config } = await readOpenCodeConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const configBackupPath = path.join(BACKUP_DIR, `opencode_config_${timestamp}.json`);
  await fs.writeFile(configBackupPath, config, "utf-8");
  return [configBackupPath];
}

export async function getBackupList(platform: LegacyConfigPlatformInput): Promise<string[]> {
  await ensureDir(BACKUP_DIR);
  const files = await fs.readdir(BACKUP_DIR);
  const normalizedPlatform = normalizeConfigPlatform(platform);
  const prefix = normalizedPlatform === "claude" ? "claude_" : normalizedPlatform === "codex" ? "codex_" : "opencode_";
  return files.filter((file) => file.startsWith(prefix)).sort().reverse();
}

function getConfigDir(platform: LegacyConfigPlatformInput): string {
  return CONFIG_PATHS[normalizeConfigPlatform(platform)].configDir;
}

function getConfigOrderPath(platform: LegacyConfigPlatformInput): string {
  return path.join(getConfigDir(platform), CONFIG_ORDER_FILE);
}

function getConfigFilePath(platform: LegacyConfigPlatformInput, configId: string): string {
  return path.join(getConfigDir(platform), `${configId}.json`);
}

async function readConfigList(platform: LegacyConfigPlatformInput): Promise<ConfigItem[]> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  const configDir = getConfigDir(platform);
  await ensureDir(configDir);
  const files = await fs.readdir(configDir);
  const jsonFiles = files.filter(
    (file) => file.endsWith(".json") && file !== CONFIG_ORDER_FILE
  );
  const configs: ConfigItem[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await fs.readFile(path.join(configDir, file), "utf-8");
      const config = JSON.parse(content) as Partial<ConfigItem>;

      // 仅加载合法配置，避免把顺序文件或其他元数据误当成配置项。
      if (
        !isPlainObject(config) ||
        typeof config.id !== "string" ||
        config.id.length === 0 ||
        typeof config.name !== "string" ||
        config.name.length === 0 ||
        config.platform !== normalizedPlatform &&
        !(normalizedPlatform === "opencode" && (config as { platform?: unknown }).platform === LEGACY_GEMINI_PLATFORM)
      ) {
        continue;
      }

      const normalizedConfig: ConfigItem = {
        ...config,
        id: config.id,
        name: config.name,
        platform: normalizedPlatform,
        createdAt:
          typeof config.createdAt === "number" && Number.isFinite(config.createdAt)
            ? config.createdAt
            : Date.now(),
        updatedAt:
          typeof config.updatedAt === "number" && Number.isFinite(config.updatedAt)
            ? config.updatedAt
            : Date.now(),
      };
      if (normalizedConfig.platform === "claude") {
        if (normalizedConfig.mcpContent === undefined) {
          normalizedConfig.mcpContent = "{}";
        }
        if (normalizedConfig.claudeSkills === undefined) {
          normalizedConfig.claudeSkills = [];
        }
      }
      delete normalizedConfig.envContent;
      if (normalizedConfig.platform === "opencode" && normalizedConfig.openCodeSkills === undefined) {
        normalizedConfig.openCodeSkills = [];
      }
      if (normalizedConfig.platform === "codex" && normalizedConfig.codexSkills === undefined) {
        normalizedConfig.codexSkills = [];
      }
      configs.push(normalizedConfig);
    } catch {
      // 跳过损坏配置
    }
  }

  configs.sort((a, b) => b.createdAt - a.createdAt);
  return configs;
}

export async function getConfigList(platform: LegacyConfigPlatformInput): Promise<ConfigItem[]> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  const configs = await readConfigList(normalizedPlatform);
  if (normalizedPlatform === "opencode") {
    return configs.filter((config) => !isLegacyCrossMigratedOpenCodeConfig(config));
  }
  return configs;
}

type LegacyConfigOrder = ConfigOrder & { gemini?: string[] };

const DEFAULT_CONFIG_ORDER: ConfigOrder = { claude: [], codex: [], opencode: [] };

function normalizeConfigOrder(order: LegacyConfigOrder): ConfigOrder {
  return {
    claude: Array.isArray(order.claude) ? [...order.claude] : [],
    codex: Array.isArray(order.codex) ? [...order.codex] : [],
    opencode: Array.isArray(order.opencode) ? [...order.opencode] : Array.isArray(order.gemini) ? [...order.gemini] : [],
  };
}

export async function getConfigOrder(platform: LegacyConfigPlatformInput): Promise<ConfigOrder> {
  const orderPath = getConfigOrderPath(platform);
  try {
    const content = await fs.readFile(orderPath, "utf-8");
    const parsed = JSON.parse(content) as LegacyConfigOrder;
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_CONFIG_ORDER };
    }
    return normalizeConfigOrder(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG_ORDER };
    }
    throw error;
  }
}

export async function setConfigOrder(
  platform: LegacyConfigPlatformInput,
  order: ConfigOrder
): Promise<void> {
  const orderPath = getConfigOrderPath(platform);
  await ensureDir(path.dirname(orderPath));
  const normalized = normalizeConfigOrder(order);
  await fs.writeFile(orderPath, JSON.stringify(normalized, null, 2), "utf-8");
}

function formatJSONString(value: string): string {
  try {
    const obj = JSON.parse(value);
    return JSON.stringify(obj, null, 2);
  } catch {
    return value;
  }
}

function readJsonObjectText(value: string | undefined, fallback = "{}"): Record<string, unknown> {
  const text = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseEnvText(content: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of (content ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

export type OpenCodeConfigValidationIssueCode =
  | "invalid-json"
  | "placeholder-provider"
  | "placeholder-model"
  | "placeholder-base-url"
  | "missing-env"
  | "openai-compatible-base-url-missing"
  | "openai-compatible-base-url-missing-v1";

export type OpenCodeConfigValidationIssue = {
  code: OpenCodeConfigValidationIssueCode;
  message: string;
};

export type OpenCodeConfigValidationResult = {
  ok: boolean;
  issues: OpenCodeConfigValidationIssue[];
};

function collectEnvRefs(value: unknown, refs: Set<string>): void {
  if (typeof value === "string") {
    const envPattern = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = envPattern.exec(value)) !== null) {
      refs.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectEnvRefs(item, refs));
    return;
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach((item) => collectEnvRefs(item, refs));
  }
}

function addOpenCodeValidationIssue(
  issues: OpenCodeConfigValidationIssue[],
  code: OpenCodeConfigValidationIssueCode,
  message: string
): void {
  if (!issues.some((issue) => issue.code === code && issue.message === message)) {
    issues.push({ code, message });
  }
}

export function validateOpenCodeConfigForRun(
  content: string | undefined,
  envContent: string | undefined,
  processEnv: NodeJS.ProcessEnv = process.env
): OpenCodeConfigValidationResult {
  const issues: OpenCodeConfigValidationIssue[] = [];
  const text = typeof content === "string" && content.trim().length > 0 ? content : "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [{
        code: "invalid-json",
        message: `OpenCode config JSON is invalid: ${(error as Error).message}`,
      }],
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      issues: [{
        code: "invalid-json",
        message: "OpenCode config must be a JSON object.",
      }],
    };
  }

  const config = parsed as Record<string, unknown>;
  const provider = isPlainObject(config.provider) ? config.provider : {};
  const modelRefs = [config.model, config.small_model]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const providerId of Object.keys(provider)) {
    if (OPENCODE_PLACEHOLDER_PROVIDER_IDS.has(providerId.toLowerCase())) {
      addOpenCodeValidationIssue(
        issues,
        "placeholder-provider",
        `OpenCode config still uses placeholder provider "${providerId}". Replace it with a real provider id.`
      );
    }
  }

  for (const modelRef of modelRefs) {
    const [providerId, modelId] = modelRef.split("/", 2);
    if (OPENCODE_PLACEHOLDER_PROVIDER_IDS.has((providerId ?? "").toLowerCase())) {
      addOpenCodeValidationIssue(
        issues,
        "placeholder-provider",
        `OpenCode model "${modelRef}" still uses placeholder provider "${providerId}".`
      );
    }
    if (OPENCODE_PLACEHOLDER_MODEL_IDS.has((modelId ?? "").toLowerCase())) {
      addOpenCodeValidationIssue(
        issues,
        "placeholder-model",
        `OpenCode model "${modelRef}" still uses placeholder model id "${modelId}".`
      );
    }
  }

  for (const [providerId, rawProviderConfig] of Object.entries(provider)) {
    if (!isPlainObject(rawProviderConfig)) {
      continue;
    }
    const providerConfig = rawProviderConfig as Record<string, unknown>;
    const npmPackage = typeof providerConfig.npm === "string" ? providerConfig.npm.trim() : "";
    const options = isPlainObject(providerConfig.options) ? providerConfig.options : {};
    const baseURL = typeof options.baseURL === "string" ? options.baseURL.trim().replace(/\/+$/, "") : "";
    if (baseURL && OPENCODE_PLACEHOLDER_BASE_URLS.has(baseURL)) {
      addOpenCodeValidationIssue(
        issues,
        "placeholder-base-url",
        `OpenCode provider "${providerId}" still uses example baseURL "${baseURL}".`
      );
    }
    if (npmPackage === OPENCODE_PROVIDER_ADAPTER_NPM_BY_PROTOCOL.openaiCompatible) {
      if (!baseURL) {
        addOpenCodeValidationIssue(
          issues,
          "openai-compatible-base-url-missing",
          `OpenCode provider "${providerId}" uses @ai-sdk/openai-compatible and must configure options.baseURL for the compatible API endpoint.`
        );
      } else if (!/\/v1$/u.test(baseURL)) {
        addOpenCodeValidationIssue(
          issues,
          "openai-compatible-base-url-missing-v1",
          `OpenCode provider "${providerId}" uses @ai-sdk/openai-compatible; baseURL should usually include the OpenAI-compatible /v1 endpoint.`
        );
      }
    }
  }

  const envRefs = new Set<string>();
  collectEnvRefs(config, envRefs);
  const parsedEnv = parseEnvText(envContent);
  for (const envName of envRefs) {
    const value = parsedEnv[envName] ?? processEnv[envName];
    if (typeof value !== "string" || value.trim().length === 0) {
      addOpenCodeValidationIssue(
        issues,
        "missing-env",
        `OpenCode config references {env:${envName}}, but that variable is not set in the process environment.`
      );
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function createCopyName(baseName: string, existingNames: string[]): string {
  const baseCopyName = `${baseName}_副本`;
  if (!existingNames.includes(baseCopyName)) {
    return baseCopyName;
  }
  let index = 2;
  let nextName = `${baseCopyName}${index}`;
  while (existingNames.includes(nextName)) {
    index += 1;
    nextName = `${baseCopyName}${index}`;
  }
  return nextName;
}

function extractCodexMcpConfig(configContent: string | undefined): Record<string, unknown> {
  const servers: Record<string, unknown> = {};
  const sectionPattern = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/;
  const valuePattern = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/;
  let currentServerId: string | null = null;
  for (const line of (configContent ?? "").split(/\r?\n/)) {
    const section = line.match(sectionPattern);
    if (section) {
      currentServerId = section[1].trim().replace(/^['"]|['"]$/g, "");
      servers[currentServerId] = {};
      continue;
    }
    if (!currentServerId) {
      continue;
    }
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      currentServerId = null;
      continue;
    }
    const entry = line.match(valuePattern);
    if (!entry) {
      continue;
    }
    const target = servers[currentServerId] as Record<string, unknown>;
    const key = entry[1];
    const rawValue = entry[2].trim();
    if (rawValue.startsWith("[") || rawValue.startsWith("{")) {
      try {
        target[key] = JSON.parse(rawValue.replace(/'/g, "\""));
        continue;
      } catch {
        // Keep a plain string when the TOML value is not JSON-compatible.
      }
    }
    target[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return Object.keys(servers).length > 0 ? { mcp: servers } : {};
}

function extractMcpConfig(source: ConfigItem): Record<string, unknown> {
  if (source.platform === "codex") {
    return extractCodexMcpConfig(source.configContent);
  }
  const config =
    source.platform === "claude"
      ? readJsonObjectText(source.mcpContent, "{}")
      : readJsonObjectText(source.content, "{}");
  const servers = isPlainObject(config.mcpServers)
    ? config.mcpServers
    : isPlainObject(config.mcp)
      ? config.mcp
    : isPlainObject(config.mcp_servers)
      ? config.mcp_servers
      : {};
  return Object.keys(servers).length > 0 ? { mcp: servers } : {};
}

function cloneOpenCodeSkillsFromSource(source: ConfigItem): ConfigItem["openCodeSkills"] {
  if (source.platform === "opencode") {
    return [...(source.openCodeSkills ?? [])];
  }
  if (source.platform === "claude") {
    return (source.claudeSkills ?? []).map((skill) => ({ ...skill }));
  }
  if (source.platform === "codex") {
    return (source.codexSkills ?? []).map((skill) => ({ ...skill }));
  }
  return [];
}

function buildOpenCodeConfigFromSource(source: ConfigItem): Pick<ConfigItem, "content" | "openCodeSkills"> {
  const content = readJsonObjectText(source.content, "{}");
  if (isPlainObject(content.mcpServers) && !isPlainObject(content.mcp)) {
    content.mcp = content.mcpServers;
    delete content.mcpServers;
  }
  return {
    content: `${JSON.stringify(content, null, 2)}\n`,
    openCodeSkills: cloneOpenCodeSkillsFromSource(source),
  };
}

function buildConfigCopy(source: ConfigItem, targetPlatform: ConfigPathPlatform, name: string): ConfigItem {
  const now = Date.now();
  const base: ConfigItem = {
    id: generateId(),
    name,
    platform: targetPlatform,
    createdAt: now,
    updatedAt: now,
  };
  if (targetPlatform === "opencode") {
    return {
      ...base,
      ...buildOpenCodeConfigFromSource(source),
    };
  }
  if (targetPlatform === "claude") {
    return {
      ...base,
      content: source.platform === "claude" ? source.content ?? "{}" : "{}",
      mcpContent: source.platform === "claude" ? source.mcpContent ?? "{}" : JSON.stringify(extractMcpConfig(source), null, 2),
      claudeSkills: source.platform === "claude" ? [...(source.claudeSkills ?? [])] : [],
    };
  }
  return {
    ...base,
    configContent: source.platform === "codex" ? source.configContent ?? "" : "",
    authContent: source.platform === "codex" ? source.authContent ?? "{}" : "{}",
    codexSkills: source.platform === "codex" ? [...(source.codexSkills ?? [])] : [],
  };
}

function isLegacyCrossMigratedOpenCodeConfig(config: Partial<ConfigItem>): boolean {
  if (config.platform !== "opencode") {
    return false;
  }
  if (config.sourcePlatform === "claude" || config.sourcePlatform === "codex") {
    return true;
  }
  if (typeof config.migrationVersion === "string" && config.migrationVersion.startsWith("opencode-auto-")) {
    return true;
  }
  if (typeof config.id === "string" && config.id.startsWith("opencode_migrated_")) {
    return true;
  }
  return typeof config.name === "string" && /^\[(Claude|Codex)\]\s/.test(config.name);
}

export async function saveConfig(config: ConfigItem): Promise<void> {
  const configDir = getConfigDir(config.platform);
  await ensureDir(configDir);
  const configToSave: ConfigItem = { ...config, platform: normalizeConfigPlatform(config.platform) };

  if (configToSave.content) {
    configToSave.content = formatJSONString(configToSave.content);
  }
  if (configToSave.mcpContent) {
    configToSave.mcpContent = formatJSONString(configToSave.mcpContent);
  }
  if (configToSave.authContent) {
    configToSave.authContent = formatJSONString(configToSave.authContent);
  }
  if (configToSave.platform === "opencode") {
    delete configToSave.envContent;
    const validation = validateOpenCodeConfigForRun(configToSave.content, undefined);
    const blockingIssues = validation.issues.filter((issue) => issue.code !== "openai-compatible-base-url-missing-v1");
    if (blockingIssues.length > 0) {
      throw new Error(blockingIssues.map((issue) => issue.message).join("\n"));
    }
  }
  const legacyConfig = configToSave as ConfigItem & { geminiSkills?: ConfigItem["openCodeSkills"] };
  if (configToSave.platform === "opencode" && configToSave.openCodeSkills === undefined) {
    configToSave.openCodeSkills = legacyConfig.geminiSkills ?? [];
  }
  delete legacyConfig.geminiSkills;

  const filePath = getConfigFilePath(configToSave.platform, config.id);
  await fs.writeFile(filePath, JSON.stringify(configToSave, null, 2), "utf-8");
}

export async function copyConfig(payload: CopyConfigPayload): Promise<ConfigItem> {
  const sourcePlatform = normalizeConfigPlatform(payload.sourcePlatform);
  const targetPlatform = normalizeConfigPlatform(payload.targetPlatform);
  const source = await getConfigById(sourcePlatform, payload.sourceId);
  if (!source) {
    throw new Error(t("config.notFound"));
  }
  if (
    (sourcePlatform === "opencode" && targetPlatform !== "opencode")
    || (sourcePlatform !== "opencode" && targetPlatform === "opencode")
  ) {
    throw new Error("OpenCode configs can only be copied as OpenCode configs; Claude/Codex configs are not converted.");
  }
  const existingNames = (await getConfigList(targetPlatform)).map((config) => config.name);
  const name = payload.name?.trim() || createCopyName(source.name, existingNames);
  const copiedConfig = buildConfigCopy(source, targetPlatform, name);
  await saveConfig(copiedConfig);
  return copiedConfig;
}

export async function deleteConfig(platform: LegacyConfigPlatformInput, configId: string): Promise<void> {
  const filePath = getConfigFilePath(platform, configId);
  await fs.unlink(filePath);
}

export async function getConfigById(
  platform: LegacyConfigPlatformInput,
  configId: string
): Promise<ConfigItem | null> {
  try {
    const filePath = getConfigFilePath(platform, configId);
    const content = await fs.readFile(filePath, "utf-8");
    const config = JSON.parse(content) as ConfigItem & { geminiSkills?: ConfigItem["openCodeSkills"] };
    config.platform = normalizeConfigPlatform(platform);
    if (config.platform === "claude") {
      if (config.mcpContent === undefined) {
        config.mcpContent = "{}";
      }
      if (config.claudeSkills === undefined) {
        config.claudeSkills = [];
      }
    }
    delete config.envContent;
    if (config.platform === "opencode" && config.openCodeSkills === undefined) {
      config.openCodeSkills = config.geminiSkills ?? [];
    }
    delete config.geminiSkills;
    if (config.platform === "codex" && config.codexSkills === undefined) {
      config.codexSkills = [];
    }
    return config;
  } catch {
    return null;
  }
}

function generateId(): string {
  return `config_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export async function initDefaultConfig(platform: LegacyConfigPlatformInput): Promise<ConfigItem | null> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  const existingConfigs = await readConfigList(normalizedPlatform);
  const hasNativeOpenCodeConfig = normalizedPlatform === "opencode"
    ? existingConfigs.some((config) => !isLegacyCrossMigratedOpenCodeConfig(config))
    : existingConfigs.length > 0;
  if (hasNativeOpenCodeConfig) {
    return null;
  }

  const defaultConfig: ConfigItem = {
    id: generateId(),
    name: t("config.defaultName"),
    platform: normalizedPlatform,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    if (normalizedPlatform === "claude") {
      const [content, mcpContent] = await Promise.all([readClaudeConfig(), readClaudeMcpConfig()]);
      defaultConfig.content = content;
      defaultConfig.mcpContent = mcpContent;
      defaultConfig.claudeSkills = [];
    } else if (normalizedPlatform === "codex") {
      const { config, auth } = await readCodexConfig();
      defaultConfig.configContent = config;
      defaultConfig.authContent = auth;
    } else {
      const { config } = await readOpenCodeConfig();
      defaultConfig.content = config;
      defaultConfig.openCodeSkills = [];
    }
  } catch {
    if (normalizedPlatform === "claude") {
      defaultConfig.content = "{}";
      defaultConfig.mcpContent = "{}";
      defaultConfig.claudeSkills = [];
    } else if (normalizedPlatform === "opencode") {
      defaultConfig.content = "{}";
      defaultConfig.openCodeSkills = [];
    } else {
      defaultConfig.configContent = "";
      defaultConfig.authContent = "{}";
      defaultConfig.codexSkills = [];
    }
  }

  await saveConfig(defaultConfig);
  return defaultConfig;
}

export async function getCurrentConfig(platform: LegacyConfigPlatformInput): Promise<CurrentConfig> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  if (normalizedPlatform === "claude") {
    const [content, mcpContent] = await Promise.all([readClaudeConfig(), readClaudeMcpConfig()]);
    return { content, mcpContent };
  }
  if (normalizedPlatform === "codex") {
    const { config, auth } = await readCodexConfig();
    return { configContent: config, authContent: auth };
  }
  const { config } = await readOpenCodeConfig();
  return { content: config };
}

export async function applyConfig(platform: LegacyConfigPlatformInput, payload: ApplyPayload): Promise<void> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  if (normalizedPlatform === "claude") {
    const nextSettings =
      payload.claudeSkills === undefined
        ? payload.content ?? "{}"
        : mergeClaudeSkillsConfig(payload.content ?? "{}", payload.claudeSkills);
    await writeClaudeConfig(nextSettings);
    if (payload.mcpContent) {
      await writeClaudeMcpConfig(payload.mcpContent);
    }
    return;
  }
  if (normalizedPlatform === "codex") {
    if (payload.configContent === undefined || payload.authContent === undefined) {
      throw new Error(t("config.codexIncomplete"));
    }
    const nextConfig =
      payload.codexSkills === undefined
        ? payload.configContent
        : mergeCodexSkillsConfig(payload.configContent, payload.codexSkills);
    await writeCodexConfig(nextConfig, payload.authContent);
    return;
  }
  const legacyPayload = payload as ApplyPayload & { geminiSkills?: ApplyPayload["openCodeSkills"] };
  const openCodeSkills = payload.openCodeSkills ?? legacyPayload.geminiSkills;
  const nextSettings =
    openCodeSkills === undefined
      ? payload.content ?? "{}"
      : mergeOpenCodeSkillsConfig(payload.content ?? "{}", openCodeSkills);
  await writeOpenCodeConfig(nextSettings);
}

export async function backupConfig(platform: LegacyConfigPlatformInput): Promise<string[]> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  if (normalizedPlatform === "claude") {
    return backupClaudeConfig();
  }
  if (normalizedPlatform === "codex") {
    return backupCodexConfig();
  }
  return backupOpenCodeConfig();
}

export {
  getCodexMcpServerIds,
  getCodexMcpHealth,
  getMcpHealth,
  installCodexMcpServer,
  installMcpServer,
  uninstallMcpServer,
  getMcpMarketplaceList,
} from "./mcpService";

export async function getClaudeSkillsList(): Promise<ClaudeSkillItem[]> {
  return listClaudeSkills();
}

export async function getCodexSkillsList(workspaceRoots?: string[]): Promise<CodexSkillItem[]> {
  return listCodexSkills(workspaceRoots);
}

export async function getOpenCodeSkillsList(workspaceRoots?: string[]): Promise<OpenCodeSkillItem[]> {
  return listOpenCodeSkills(workspaceRoots);
}
