import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "cross-spawn";
import {
  ApplyPayload,
  ConfigItem,
  ConfigOrder,
  ConfigPlatform,
  CurrentConfig,
  McpMarketplaceItem,
  ClaudeSkillItem,
  CodexSkillItem,
  GeminiSkillItem,
  CodexMcpInstallResult,
} from "./types";
import { listCodexSkills, mergeCodexSkillsConfig } from "./codexSkills";
import { listClaudeSkills, mergeClaudeSkillsConfig } from "./claudeSkills";
import { listGeminiSkills, mergeGeminiSkillsConfig } from "./geminiSkills";
import { getCliCommand } from "../cli/config";
import { t } from "../i18n";

const CONFIG_DIR_NAME = "__config";
const CONFIG_ORDER_FILE = "config-order.json";
const BACKUP_DIR = path.join(os.homedir(), ".ai_cli_tools_backups");

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
  gemini: {
    settings: path.join(os.homedir(), ".gemini", "settings.json"),
    env: path.join(os.homedir(), ".gemini", ".env"),
    configDir: path.join(os.homedir(), ".gemini", CONFIG_DIR_NAME),
  },
} as const;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
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

export async function readGeminiConfig(): Promise<{ settings: string; env: string }> {
  await ensureFile(CONFIG_PATHS.gemini.settings, "{}");
  await ensureFile(CONFIG_PATHS.gemini.env, "");
  const [settings, env] = await Promise.all([
    fs.readFile(CONFIG_PATHS.gemini.settings, "utf-8"),
    fs.readFile(CONFIG_PATHS.gemini.env, "utf-8").catch(() => ""),
  ]);
  return { settings, env };
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

export async function writeGeminiConfig(settings: string, env: string): Promise<void> {
  await ensureDir(path.dirname(CONFIG_PATHS.gemini.settings));
  await Promise.all([
    fs.writeFile(CONFIG_PATHS.gemini.settings, settings, "utf-8"),
    fs.writeFile(CONFIG_PATHS.gemini.env, env ?? "", "utf-8"),
  ]);
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

export async function backupGeminiConfig(): Promise<string[]> {
  await ensureDir(BACKUP_DIR);
  const { settings, env } = await readGeminiConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const settingsBackupPath = path.join(BACKUP_DIR, `gemini_settings_${timestamp}.json`);
  const envBackupPath = path.join(BACKUP_DIR, `gemini_env_${timestamp}.env`);
  await Promise.all([
    fs.writeFile(settingsBackupPath, settings, "utf-8"),
    fs.writeFile(envBackupPath, env, "utf-8"),
  ]);
  return [settingsBackupPath, envBackupPath];
}

export async function getBackupList(platform: ConfigPlatform): Promise<string[]> {
  await ensureDir(BACKUP_DIR);
  const files = await fs.readdir(BACKUP_DIR);
  const prefix = platform === "claude" ? "claude_" : platform === "codex" ? "codex_" : "gemini_";
  return files.filter((file) => file.startsWith(prefix)).sort().reverse();
}

function getConfigDir(platform: ConfigPlatform): string {
  return CONFIG_PATHS[platform].configDir;
}

function getConfigOrderPath(platform: ConfigPlatform): string {
  return path.join(getConfigDir(platform), CONFIG_ORDER_FILE);
}

function getConfigFilePath(platform: ConfigPlatform, configId: string): string {
  return path.join(getConfigDir(platform), `${configId}.json`);
}

export async function getConfigList(platform: ConfigPlatform): Promise<ConfigItem[]> {
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
        config.platform !== platform
      ) {
        continue;
      }

      const normalizedConfig: ConfigItem = {
        ...config,
        id: config.id,
        name: config.name,
        platform: config.platform,
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
      if (normalizedConfig.platform === "gemini" && normalizedConfig.envContent === undefined) {
        normalizedConfig.envContent = "";
      }
      if (normalizedConfig.platform === "gemini" && normalizedConfig.geminiSkills === undefined) {
        normalizedConfig.geminiSkills = [];
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

const DEFAULT_CONFIG_ORDER: ConfigOrder = { claude: [], codex: [], gemini: [] };

function normalizeConfigOrder(order: ConfigOrder): ConfigOrder {
  return {
    claude: Array.isArray(order.claude) ? [...order.claude] : [],
    codex: Array.isArray(order.codex) ? [...order.codex] : [],
    gemini: Array.isArray(order.gemini) ? [...order.gemini] : [],
  };
}

export async function getConfigOrder(platform: ConfigPlatform): Promise<ConfigOrder> {
  const orderPath = getConfigOrderPath(platform);
  try {
    const content = await fs.readFile(orderPath, "utf-8");
    const parsed = JSON.parse(content) as ConfigOrder;
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
  platform: ConfigPlatform,
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

export async function saveConfig(config: ConfigItem): Promise<void> {
  const configDir = getConfigDir(config.platform);
  await ensureDir(configDir);
  const configToSave: ConfigItem = { ...config };

  if (configToSave.content) {
    configToSave.content = formatJSONString(configToSave.content);
  }
  if (configToSave.mcpContent) {
    configToSave.mcpContent = formatJSONString(configToSave.mcpContent);
  }
  if (configToSave.authContent) {
    configToSave.authContent = formatJSONString(configToSave.authContent);
  }
  if (configToSave.platform === "gemini" && configToSave.envContent === undefined) {
    configToSave.envContent = "";
  }
  if (configToSave.platform === "gemini" && configToSave.geminiSkills === undefined) {
    configToSave.geminiSkills = [];
  }

  const filePath = getConfigFilePath(config.platform, config.id);
  await fs.writeFile(filePath, JSON.stringify(configToSave, null, 2), "utf-8");
}

export async function deleteConfig(platform: ConfigPlatform, configId: string): Promise<void> {
  const filePath = getConfigFilePath(platform, configId);
  await fs.unlink(filePath);
}

export async function getConfigById(
  platform: ConfigPlatform,
  configId: string
): Promise<ConfigItem | null> {
  try {
    const filePath = getConfigFilePath(platform, configId);
    const content = await fs.readFile(filePath, "utf-8");
    const config = JSON.parse(content) as ConfigItem;
    if (config.platform === "claude") {
      if (config.mcpContent === undefined) {
        config.mcpContent = "{}";
      }
      if (config.claudeSkills === undefined) {
        config.claudeSkills = [];
      }
    }
    if (config.platform === "gemini" && config.envContent === undefined) {
      config.envContent = "";
    }
    if (config.platform === "gemini" && config.geminiSkills === undefined) {
      config.geminiSkills = [];
    }
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

export async function initDefaultConfig(platform: ConfigPlatform): Promise<ConfigItem | null> {
  const existingConfigs = await getConfigList(platform);
  if (existingConfigs.length > 0) {
    return null;
  }

  const defaultConfig: ConfigItem = {
    id: generateId(),
    name: t("config.defaultName"),
    platform,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    if (platform === "claude") {
      const [content, mcpContent] = await Promise.all([readClaudeConfig(), readClaudeMcpConfig()]);
      defaultConfig.content = content;
      defaultConfig.mcpContent = mcpContent;
      defaultConfig.claudeSkills = [];
    } else if (platform === "codex") {
      const { config, auth } = await readCodexConfig();
      defaultConfig.configContent = config;
      defaultConfig.authContent = auth;
    } else {
      const { settings, env } = await readGeminiConfig();
      defaultConfig.content = settings;
      defaultConfig.envContent = env;
      defaultConfig.geminiSkills = [];
    }
  } catch {
    if (platform === "claude") {
      defaultConfig.content = "{}";
      defaultConfig.mcpContent = "{}";
      defaultConfig.claudeSkills = [];
    } else if (platform === "gemini") {
      defaultConfig.content = "{}";
      defaultConfig.envContent = "";
      defaultConfig.geminiSkills = [];
    } else {
      defaultConfig.configContent = "";
      defaultConfig.authContent = "{}";
      defaultConfig.codexSkills = [];
    }
  }

  await saveConfig(defaultConfig);
  return defaultConfig;
}

export async function getCurrentConfig(platform: ConfigPlatform): Promise<CurrentConfig> {
  if (platform === "claude") {
    const [content, mcpContent] = await Promise.all([readClaudeConfig(), readClaudeMcpConfig()]);
    return { content, mcpContent };
  }
  if (platform === "codex") {
    const { config, auth } = await readCodexConfig();
    return { configContent: config, authContent: auth };
  }
  const { settings, env } = await readGeminiConfig();
  return { content: settings, envContent: env };
}

export async function applyConfig(platform: ConfigPlatform, payload: ApplyPayload): Promise<void> {
  if (platform === "claude") {
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
  if (platform === "codex") {
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
  const nextSettings =
    payload.geminiSkills === undefined
      ? payload.content ?? "{}"
      : mergeGeminiSkillsConfig(payload.content ?? "{}", payload.geminiSkills);
  await writeGeminiConfig(nextSettings, payload.envContent ?? "");
}

export async function backupConfig(platform: ConfigPlatform): Promise<string[]> {
  if (platform === "claude") {
    return backupClaudeConfig();
  }
  if (platform === "codex") {
    return backupCodexConfig();
  }
  return backupGeminiConfig();
}

const CODEX_MCP_COMMAND_TIMEOUT_MS = 120000;

type CodexRunResult = {
  stdout: string;
  stderr: string;
};

function parseCommandParts(command: string): string[] {
  const parts = command.match(/(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+)/g) ?? [];
  return parts.map((part) => {
    if (
      (part.startsWith("\"") && part.endsWith("\""))
      || (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
}

function getCodexCommandParts(): string[] {
  const command = getCliCommand("codex").trim();
  return parseCommandParts(command || "codex");
}

async function runCodexCommand(args: string[], timeoutMs = CODEX_MCP_COMMAND_TIMEOUT_MS): Promise<CodexRunResult> {
  const commandParts = getCodexCommandParts();
  if (commandParts.length === 0 || !commandParts[0]) {
    throw new Error("Codex command is empty.");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(commandParts[0], [...commandParts.slice(1), ...args], {
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error(`codex ${args.join(" ")} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const message = stderr.trim() || stdout.trim() || `exit code ${code}`;
      reject(new Error(`codex ${args.join(" ")} failed: ${message}`));
    });
  });
}

function isPlaceholderEnvValue(value: string): boolean {
  const trimmed = value.trim();
  return /^<[^>]+>$/.test(trimmed) || /^\$\{?YOUR_/i.test(trimmed) || /^YOUR_/i.test(trimmed);
}

function extractBearerTokenEnvVar(value: string): string | null {
  const trimmed = value.trim();
  const plainMatch = /^Bearer\s+\$([A-Za-z_][A-Za-z0-9_]*)$/i.exec(trimmed);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }
  const wrappedMatch = /^Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/i.exec(trimmed);
  if (wrappedMatch?.[1]) {
    return wrappedMatch[1];
  }
  return null;
}

function uniqueWarnings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function buildCodexMcpInstallArgs(item: McpMarketplaceItem): { commandArgs: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const config = item.config ?? {};
  const isHttp = config.type === "http" || typeof config.url === "string";

  if (isHttp) {
    const url = config.url?.trim();
    if (!url) {
      throw new Error(`MCP ${item.id} is missing http url.`);
    }

    const commandArgs = ["mcp", "add", item.id, "--url", url];
    const headers = config.headers ?? {};
    const authHeader = headers.Authorization ?? headers.authorization;

    if (typeof authHeader === "string" && authHeader.trim()) {
      const bearerTokenEnvVar = extractBearerTokenEnvVar(authHeader);
      if (bearerTokenEnvVar) {
        commandArgs.push("--bearer-token-env-var", bearerTokenEnvVar);
      } else {
        warnings.push(
          `MCP ${item.id}: authorization header cannot be converted, please set bearer token env var manually.`,
        );
      }
    }

    const unsupportedHeaderKeys = Object.keys(headers).filter(
      (key) => key.toLowerCase() !== "authorization",
    );
    if (unsupportedHeaderKeys.length > 0) {
      warnings.push(
        `MCP ${item.id}: custom headers are not supported by codex mcp add (${unsupportedHeaderKeys.join(", ")}).`,
      );
    }

    return { commandArgs, warnings: uniqueWarnings(warnings) };
  }

  const command = config.command?.trim();
  if (!command) {
    throw new Error(`MCP ${item.id} is missing command.`);
  }

  const commandArgs = ["mcp", "add", item.id];
  if (config.env && typeof config.env === "object") {
    for (const [envName, envValue] of Object.entries(config.env)) {
      if (!envName || typeof envValue !== "string") {
        continue;
      }
      const trimmedValue = envValue.trim();
      if (!trimmedValue || isPlaceholderEnvValue(trimmedValue)) {
        warnings.push(`MCP ${item.id}: skipped template env ${envName}.`);
        continue;
      }
      commandArgs.push("--env", `${envName}=${trimmedValue}`);
    }
  }

  const mcpArgs = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  commandArgs.push("--", command, ...mcpArgs);

  return { commandArgs, warnings: uniqueWarnings(warnings) };
}

function parseCodexMcpServerIds(rawContent: string): string[] {
  const parsed = JSON.parse(rawContent) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid codex mcp list output.");
  }

  return parsed
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }
      const record = item as Record<string, unknown>;
      return typeof record.name === "string" ? record.name.trim() : "";
    })
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

export async function getCodexMcpServerIds(): Promise<string[]> {
  const { stdout } = await runCodexCommand(["mcp", "list", "--json"]);
  return parseCodexMcpServerIds(stdout);
}

export async function installCodexMcpServer(mcpId: string): Promise<CodexMcpInstallResult> {
  const marketplace = await getMcpMarketplaceList();
  const item = marketplace.find((entry) => entry.id === mcpId);
  if (!item) {
    throw new Error(`MCP ${mcpId} not found in marketplace.`);
  }

  const { commandArgs, warnings } = buildCodexMcpInstallArgs(item);
  await runCodexCommand(commandArgs);
  return {
    serverId: item.id,
    commandArgs,
    warnings,
  };
}

export async function getMcpMarketplaceList(): Promise<McpMarketplaceItem[]> {
  const candidates = [
    path.join(__dirname, "..", "..", "media", "mcp_marketplace.json"),
  ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, "utf-8");
      return JSON.parse(content) as McpMarketplaceItem[];
    } catch {
      // try next
    }
  }

  return [];
}

export async function getClaudeSkillsList(): Promise<ClaudeSkillItem[]> {
  return listClaudeSkills();
}

export async function getCodexSkillsList(workspaceRoots?: string[]): Promise<CodexSkillItem[]> {
  return listCodexSkills(workspaceRoots);
}

export async function getGeminiSkillsList(workspaceRoots?: string[]): Promise<GeminiSkillItem[]> {
  return listGeminiSkills(workspaceRoots);
}
