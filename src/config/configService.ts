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
  CodexMcpHealthItem,
  McpHealthItem,
} from "./types";
import { listCodexSkills, mergeCodexSkillsConfig } from "./codexSkills";
import { listClaudeSkills, mergeClaudeSkillsConfig } from "./claudeSkills";
import { listGeminiSkills, mergeGeminiSkillsConfig } from "./geminiSkills";
import { getCliCommand } from "../cli/config";
import { CliName } from "../cli/types";
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
  for (const key of ["mcpServers", "mcp_servers"] as const) {
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

async function cleanupGeminiMcpDocument(serverId: string): Promise<boolean> {
  const { settings, env } = await readGeminiConfig();
  const next = removeMcpServerFromJsonText(settings, serverId);
  if (!next.changed) {
    return false;
  }
  await writeGeminiConfig(next.content, env);
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
const CODEX_MCP_HEALTH_CONNECT_TIMEOUT_MS = 15000;
const CODEX_MCP_HEALTH_REQUEST_TIMEOUT_MS = 15000;

type CodexRunResult = {
  stdout: string;
  stderr: string;
};

type CodexMcpTransportStdioConfig = {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  envVars: string[];
  cwd?: string;
};

type CodexMcpTransportHttpConfig = {
  type: "http";
  protocol: "http" | "streamable_http";
  url: string;
  headers: Record<string, string>;
  bearerTokenEnvVar?: string;
};

type CodexMcpTransportConfig = CodexMcpTransportStdioConfig | CodexMcpTransportHttpConfig;

type CodexInstalledMcpServer = {
  serverId: string;
  enabled: boolean;
  disabledReason?: string;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  transport: CodexMcpTransportConfig | null;
};

type McpProbeResult = {
  ok: boolean;
  latencyMs: number;
  details: string;
};

type SimpleFetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

type SimpleFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

type SimpleFetch = (input: string, init?: SimpleFetchInit) => Promise<SimpleFetchResponse>;

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

function getConfiguredCliCommandParts(cli: CliName): string[] {
  const command = getCliCommand(cli).trim();
  return parseCommandParts(command || cli);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function compareNodeVersionDesc(left: string, right: string): number {
  const parse = (value: string) => value.replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

async function findNewestNvmNodeBinary(majorVersion: number): Promise<string | null> {
  const nvmVersionsDir = path.join(os.homedir(), ".nvm", "versions", "node");
  try {
    const entries = await fs.readdir(nvmVersionsDir, { withFileTypes: true });
    const versions = entries
      .filter((entry) => entry.isDirectory() && new RegExp(`^v${majorVersion}\\.`).test(entry.name))
      .map((entry) => entry.name)
      .sort(compareNodeVersionDesc);
    for (const version of versions) {
      const candidate = path.join(nvmVersionsDir, version, "bin", "node");
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function runCommandParts(
  commandParts: string[],
  args: string[],
  label: string,
  timeoutMs = CODEX_MCP_COMMAND_TIMEOUT_MS,
): Promise<CodexRunResult> {
  if (commandParts.length === 0 || !commandParts[0]) {
    throw new Error(`${label} command is empty.`);
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
      reject(new Error(`${label} ${args.join(" ")} timed out after ${timeoutMs}ms.`));
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
      reject(new Error(`${label} ${args.join(" ")} failed: ${message}`));
    });
  });
}

async function runConfiguredCliCommand(
  cli: CliName,
  args: string[],
  timeoutMs = CODEX_MCP_COMMAND_TIMEOUT_MS,
): Promise<CodexRunResult> {
  return runCommandParts(getConfiguredCliCommandParts(cli), args, cli, timeoutMs);
}

async function runClaudeCommand(
  args: string[],
  timeoutMs = CODEX_MCP_COMMAND_TIMEOUT_MS,
): Promise<CodexRunResult> {
  return runConfiguredCliCommand("claude", args, timeoutMs);
}

async function runGeminiCommand(
  args: string[],
  timeoutMs = CODEX_MCP_COMMAND_TIMEOUT_MS,
): Promise<CodexRunResult> {
  try {
    return await runConfiguredCliCommand("gemini", args, timeoutMs);
  } catch (error) {
    const geminiEntry = path.join(
      os.homedir(),
      ".npm-global",
      "lib",
      "node_modules",
      "@google",
      "gemini-cli",
      "dist",
      "index.js",
    );
    const [entryExists, node20Binary] = await Promise.all([
      pathExists(geminiEntry),
      findNewestNvmNodeBinary(20),
    ]);
    if (!entryExists || !node20Binary) {
      throw error;
    }
    return runCommandParts([node20Binary, geminiEntry], args, "gemini", timeoutMs);
  }
}

async function runCodexCommand(args: string[], timeoutMs = CODEX_MCP_COMMAND_TIMEOUT_MS): Promise<CodexRunResult> {
  return runConfiguredCliCommand("codex", args, timeoutMs);
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

function collectManagedMcpEnvEntries(
  item: McpMarketplaceItem,
  warnings: string[],
  envOverrides?: Record<string, string>,
): Array<[string, string]> {
  const envEntries: Array<[string, string]> = [];
  const envRecord = item.config?.env;
  if (!envRecord || typeof envRecord !== "object") {
    return envEntries;
  }

  for (const [envName, envValue] of Object.entries(envRecord)) {
    if (!envName || typeof envValue !== "string") {
      continue;
    }
    const overrideValue = envOverrides?.[envName];
    const trimmedValue = typeof overrideValue === "string" && overrideValue.trim().length > 0
      ? overrideValue.trim()
      : envValue.trim();
    if (!trimmedValue || isPlaceholderEnvValue(trimmedValue)) {
      warnings.push(`MCP ${item.id}: skipped template env ${envName}.`);
      continue;
    }
    envEntries.push([envName, trimmedValue]);
  }

  return envEntries;
}

function collectManagedMcpHeaders(item: McpMarketplaceItem): string[] {
  const headers = item.config?.headers;
  if (!headers || typeof headers !== "object") {
    return [];
  }

  return Object.entries(headers)
    .filter(([headerName, headerValue]) => Boolean(headerName) && typeof headerValue === "string")
    .map(([headerName, headerValue]) => `${headerName}: ${headerValue.trim()}`)
    .filter((headerValue) => headerValue.length > 2);
}

function buildCodexMcpInstallArgs(
  item: McpMarketplaceItem,
  envOverrides?: Record<string, string>,
): { commandArgs: string[]; warnings: string[] } {
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
  for (const [envName, envValue] of collectManagedMcpEnvEntries(item, warnings, envOverrides)) {
    commandArgs.push("--env", `${envName}=${envValue}`);
  }

  const mcpArgs = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  commandArgs.push("--", command, ...mcpArgs);

  return { commandArgs, warnings: uniqueWarnings(warnings) };
}

function buildClaudeMcpInstallArgs(
  item: McpMarketplaceItem,
  envOverrides?: Record<string, string>,
): { commandArgs: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const config = item.config ?? {};
  const transport = config.type === "http" || config.type === "sse" ? config.type : typeof config.url === "string" ? "http" : "stdio";

  if (transport === "http" || transport === "sse") {
    const commandArgs = ["mcp", "add", "--scope", "user", "--transport", transport, item.id];
    const url = config.url?.trim();
    if (!url) {
      throw new Error(`MCP ${item.id} is missing ${transport} url.`);
    }
    for (const header of collectManagedMcpHeaders(item)) {
      commandArgs.push("--header", header);
    }
    return { commandArgs: [...commandArgs, url], warnings: uniqueWarnings(warnings) };
  }

  const command = config.command?.trim();
  if (!command) {
    throw new Error(`MCP ${item.id} is missing command.`);
  }

  const mcpArgs = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const env = Object.fromEntries(collectManagedMcpEnvEntries(item, warnings, envOverrides));
  const payload = JSON.stringify({
    type: "stdio",
    command,
    args: mcpArgs,
    env,
  });

  return {
    commandArgs: ["mcp", "add-json", "--scope", "user", item.id, payload],
    warnings: uniqueWarnings(warnings),
  };
}

function buildGeminiMcpInstallArgs(
  item: McpMarketplaceItem,
  envOverrides?: Record<string, string>,
): { commandArgs: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const config = item.config ?? {};
  const transport = config.type === "http" || config.type === "sse" ? config.type : typeof config.url === "string" ? "http" : "stdio";

  if (transport === "http" || transport === "sse") {
    const commandArgs = ["mcp", "add", "--scope", "user", "--transport", transport, item.id];
    const url = config.url?.trim();
    if (!url) {
      throw new Error(`MCP ${item.id} is missing ${transport} url.`);
    }
    for (const header of collectManagedMcpHeaders(item)) {
      commandArgs.push("--header", header);
    }
    return { commandArgs: [...commandArgs, url], warnings: uniqueWarnings(warnings) };
  }

  const command = config.command?.trim();
  if (!command) {
    throw new Error(`MCP ${item.id} is missing command.`);
  }

  const commandArgs = ["mcp", "add", "--scope", "user", "--transport", transport];
  for (const [envName, envValue] of collectManagedMcpEnvEntries(item, warnings, envOverrides)) {
    commandArgs.push("--env", `${envName}=${envValue}`);
  }
  const mcpArgs = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  commandArgs.push(item.id, command, ...mcpArgs);
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

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item === "string")
    .map(([key, item]) => [key, item as string]);

  return Object.fromEntries(entries);
}

function resolveServerTimeoutMs(timeoutSec: number | undefined, fallbackMs: number): number {
  if (!timeoutSec || timeoutSec <= 0) {
    return fallbackMs;
  }

  return Math.floor(timeoutSec * 1000);
}

function buildRpcPacket(id: number, method: string, params: Record<string, unknown>): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params,
  })}\n`;
}

function extractToolCount(result: unknown): number {
  if (!result || typeof result !== "object") {
    return 0;
  }

  const tools = (result as { tools?: unknown }).tools;
  return Array.isArray(tools) ? tools.length : 0;
}

function parseInstalledCodexMcpTransport(raw: unknown): CodexMcpTransportConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const transportType = typeof record.type === "string" ? record.type : "";

  if (transportType === "stdio") {
    const command = typeof record.command === "string" ? record.command : "";
    if (!command) {
      return null;
    }

    return {
      type: "stdio",
      command,
      args: readStringArray(record.args),
      env: readStringMap(record.env),
      envVars: readStringArray(record.env_vars ?? record.envVars),
      cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    };
  }

  if (transportType === "http" || transportType === "streamable_http") {
    const url =
      (typeof record.url === "string" && record.url)
      || (typeof record.commandOrUrl === "string" && record.commandOrUrl)
      || "";
    if (!url) {
      return null;
    }

    const bearerTokenEnvVar =
      typeof record.bearer_token_env_var === "string"
        ? record.bearer_token_env_var
        : typeof record.bearerTokenEnvVar === "string"
          ? record.bearerTokenEnvVar
          : undefined;

    return {
      type: "http",
      protocol: transportType === "streamable_http" ? "streamable_http" : "http",
      url,
      headers: readStringMap(record.headers),
      bearerTokenEnvVar,
    };
  }

  return null;
}

function parseInstalledCodexMcpServer(raw: unknown): CodexInstalledMcpServer | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const serverId = typeof record.name === "string" ? record.name.trim() : "";
  if (!serverId) {
    return undefined;
  }

  return {
    serverId,
    enabled: record.enabled !== false,
    disabledReason:
      typeof record.disabled_reason === "string"
        ? record.disabled_reason
        : typeof record.disabledReason === "string"
          ? record.disabledReason
          : undefined,
    startupTimeoutSec: readPositiveNumber(record.startup_timeout_sec ?? record.startupTimeoutSec),
    toolTimeoutSec: readPositiveNumber(record.tool_timeout_sec ?? record.toolTimeoutSec),
    transport: parseInstalledCodexMcpTransport(record.transport),
  };
}

async function listInstalledCodexMcpServers(): Promise<CodexInstalledMcpServer[]> {
  try {
    const { stdout } = await runCodexCommand(["mcp", "list", "--json"]);
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => parseInstalledCodexMcpServer(item))
      .filter((item): item is CodexInstalledMcpServer => Boolean(item));
  } catch {
    return [];
  }
}

function buildCodexMcpProbeEnv(
  transport: CodexMcpTransportStdioConfig,
  envValues: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envValues,
    ...transport.env,
  };

  for (const envName of transport.envVars) {
    const value = transport.env[envName] ?? envValues[envName] ?? process.env[envName] ?? "";
    if (value) {
      env[envName] = value;
    }
  }

  return env;
}

async function parseRpcPayloadFromHttpResponse(
  response: SimpleFetchResponse,
): Promise<{ error?: unknown; result?: unknown } | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();
  if (!responseText.trim()) {
    return undefined;
  }

  if (contentType.includes("text/event-stream")) {
    const dataLines = responseText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter((line) => line.length > 0);

    const lastData = dataLines[dataLines.length - 1];
    if (!lastData) {
      return undefined;
    }

    return JSON.parse(lastData) as { error?: unknown; result?: unknown };
  }

  return JSON.parse(responseText) as { error?: unknown; result?: unknown };
}

async function probeHttpCodexMcpServer(
  server: CodexInstalledMcpServer,
  transport: CodexMcpTransportHttpConfig,
  envValues: Record<string, string>,
): Promise<McpProbeResult> {
  const startedAt = Date.now();
  const timeoutMs = resolveServerTimeoutMs(
    server.toolTimeoutSec,
    CODEX_MCP_HEALTH_REQUEST_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchFn = globalThis.fetch as unknown as SimpleFetch | undefined;

  if (!fetchFn) {
    clearTimeout(timer);
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      details: "当前运行环境不支持 HTTP 健康检测",
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...transport.headers,
  };

  if (transport.protocol === "streamable_http") {
    headers.Accept = headers.Accept ?? "application/json, text/event-stream";
  }

  if (transport.bearerTokenEnvVar && !headers.Authorization) {
    const token = envValues[transport.bearerTokenEnvVar] ?? process.env[transport.bearerTokenEnvVar] ?? "";
    if (!token) {
      clearTimeout(timer);
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: `缺少鉴权环境变量：${transport.bearerTokenEnvVar}`,
      };
    }
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const initializeResponse = await fetchFn(transport.url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          clientInfo: {
            name: "sinitek-cli-tools",
            version: "0.4.2",
          },
        },
      }),
    });

    if (!initializeResponse.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: `初始化请求失败：HTTP ${initializeResponse.status}`,
      };
    }

    const initializePayload = await parseRpcPayloadFromHttpResponse(initializeResponse);
    if (initializePayload?.error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "初始化 RPC 返回错误",
      };
    }

    const requestHeaders = { ...headers };
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    if (sessionId) {
      requestHeaders["mcp-session-id"] = sessionId;
    }

    const toolsResponse = await fetchFn(transport.url, {
      method: "POST",
      signal: controller.signal,
      headers: requestHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    if (!toolsResponse.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: `工具列表请求失败：HTTP ${toolsResponse.status}`,
      };
    }

    const toolsPayload = await parseRpcPayloadFromHttpResponse(toolsResponse);
    if (toolsPayload?.error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "tools/list RPC 返回错误",
      };
    }

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      details: `握手成功，tools=${extractToolCount(toolsPayload?.result)}`,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeStdioCodexMcpServer(
  server: CodexInstalledMcpServer,
  transport: CodexMcpTransportStdioConfig,
  envValues: Record<string, string>,
): Promise<McpProbeResult> {
  const startedAt = Date.now();
  const startupTimeoutMs = resolveServerTimeoutMs(
    server.startupTimeoutSec,
    CODEX_MCP_HEALTH_CONNECT_TIMEOUT_MS,
  );
  const requestTimeoutMs = resolveServerTimeoutMs(
    server.toolTimeoutSec,
    CODEX_MCP_HEALTH_REQUEST_TIMEOUT_MS,
  );
  const timeoutMs = Math.max(startupTimeoutMs, requestTimeoutMs);

  return new Promise((resolve) => {
    const child = spawn(transport.command, transport.args, {
      env: buildCodexMcpProbeEnv(transport, envValues),
      cwd: transport.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const responses = new Map<number, { result?: unknown; error?: unknown }>();
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;

    const settle = (result: McpProbeResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      settle({
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: "健康检查超时",
      });
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.stdin?.on("error", () => undefined);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) {
          continue;
        }

        try {
          const parsed = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: unknown };
          if (typeof parsed.id === "number") {
            responses.set(parsed.id, parsed);
          }
        } catch {
          // ignore non-rpc lines
        }
      }

      if (responses.has(1) && responses.has(2)) {
        const initialize = responses.get(1);
        const toolList = responses.get(2);

        if (initialize?.error || toolList?.error) {
          settle({
            ok: false,
            latencyMs: Date.now() - startedAt,
            details: "initialize/tools 返回错误",
          });
          return;
        }

        settle({
          ok: true,
          latencyMs: Date.now() - startedAt,
          details: `握手成功，tools=${extractToolCount(toolList?.result)}`,
        });
      }
    });

    child.on("error", (error) => {
      settle({
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: error.message,
      });
    });

    child.on("close", (code) => {
      if (settled || (responses.has(1) && responses.has(2))) {
        return;
      }

      const stderrText = stderr.trim();
      const stderrPreview = stderrText.length > 240 ? `${stderrText.slice(0, 240)}...` : stderrText;
      settle({
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: `握手前退出：exit_${String(code)}${stderrPreview ? `:${stderrPreview}` : ""}`,
      });
    });

    child.stdin?.write(
      buildRpcPacket(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        clientInfo: {
          name: "sinitek-cli-tools",
          version: "0.4.2",
        },
      }),
    );
    child.stdin?.write(buildRpcPacket(2, "tools/list", {}));
  });
}

async function probeInstalledCodexMcpServer(
  server: CodexInstalledMcpServer,
  envValues: Record<string, string>,
): Promise<McpProbeResult> {
  if (!server.transport) {
    return {
      ok: false,
      latencyMs: 0,
      details: "MCP transport 配置缺失",
    };
  }

  if (server.transport.type === "http") {
    return probeHttpCodexMcpServer(server, server.transport, envValues);
  }

  return probeStdioCodexMcpServer(server, server.transport, envValues);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function parseConnectedStatus(value: string): { status: McpHealthItem["status"]; details: string } {
  const normalized = value.replace(/[✓✗]/g, "").trim();
  if (/connected/i.test(normalized)) {
    return { status: "healthy", details: normalized || "Connected" };
  }
  if (/failed|disconnected|error|timeout/i.test(normalized)) {
    return { status: "unhealthy", details: normalized || "Failed to connect" };
  }
  return { status: "unknown", details: normalized || "状态未知" };
}

function parseClaudeMcpHealthOutput(rawContent: string): Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">> {
  const result = new Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">>();
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (!line.includes(":")) {
      continue;
    }
    const parts = line.split(" - ");
    const statusPart = parts[parts.length - 1]?.trim() || "";
    const namePart = parts[0] || "";
    const separatorIndex = namePart.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const serverId = namePart.slice(0, separatorIndex).trim();
    if (!serverId) {
      continue;
    }
    const parsedStatus = parseConnectedStatus(statusPart);
    result.set(serverId, {
      enabled: !/disabled/i.test(statusPart),
      status: parsedStatus.status,
      details: parsedStatus.details,
      latencyMs: undefined,
    });
  }

  return result;
}

function parseGeminiMcpHealthOutput(rawContent: string): Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">> {
  const result = new Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">>();
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (!line.includes(":") || !/^[✓✗]/.test(line)) {
      continue;
    }
    const normalizedLine = line.replace(/^[✓✗]\s*/, "");
    const separatorIndex = normalizedLine.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const serverId = normalizedLine.slice(0, separatorIndex).trim();
    const statusPart = normalizedLine.includes(" - ")
      ? normalizedLine.slice(normalizedLine.lastIndexOf(" - ") + 3).trim()
      : "";
    if (!serverId) {
      continue;
    }
    const parsedStatus = parseConnectedStatus(statusPart);
    result.set(serverId, {
      enabled: !/disabled/i.test(statusPart),
      status: parsedStatus.status,
      details: parsedStatus.details,
      latencyMs: undefined,
    });
  }

  return result;
}

async function getCliListedMcpHealth(
  platform: Extract<ConfigPlatform, "claude" | "gemini">,
): Promise<McpHealthItem[]> {
  const cli = platform === "claude" ? "claude" : "gemini";
  const checkedAt = new Date().toISOString();
  const marketplace = await getMcpMarketplaceList();

  let listedById = new Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">>();
  try {
    const { stdout, stderr } = platform === "gemini"
      ? await runGeminiCommand(["mcp", "list"])
      : await runConfiguredCliCommand(cli, ["mcp", "list"]);
    const rawOutput = [stdout, stderr].filter((item) => item.trim().length > 0).join("\n");
    listedById = platform === "claude"
      ? parseClaudeMcpHealthOutput(rawOutput)
      : parseGeminiMcpHealthOutput(rawOutput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return marketplace.map((item) => ({
      platform,
      serverId: item.id,
      installed: false,
      enabled: false,
      status: "unknown",
      checkedAt,
      details: `检测命令失败：${message}`,
    }));
  }

  return marketplace.map((item) => {
    const listed = listedById.get(item.id);
    if (!listed) {
      return {
        platform,
        serverId: item.id,
        installed: false,
        enabled: false,
        status: "unknown",
        checkedAt,
        details: "未安装",
      } satisfies McpHealthItem;
    }

    return {
      platform,
      serverId: item.id,
      installed: true,
      enabled: listed.enabled,
      status: listed.status,
      checkedAt,
      details: listed.details,
      latencyMs: listed.latencyMs,
    } satisfies McpHealthItem;
  });
}

export async function getCodexMcpServerIds(): Promise<string[]> {
  const { stdout } = await runCodexCommand(["mcp", "list", "--json"]);
  return parseCodexMcpServerIds(stdout);
}

export async function getCodexMcpHealth(): Promise<CodexMcpHealthItem[]> {
  const [marketplace, installedServers] = await Promise.all([
    getMcpMarketplaceList(),
    listInstalledCodexMcpServers(),
  ]);
  const installedById = new Map(installedServers.map((item) => [item.serverId, item]));
  const checkedAt = new Date().toISOString();

  return Promise.all(
    marketplace.map(async (item) => {
      const installedServer = installedById.get(item.id);
      if (!installedServer) {
        return {
          platform: "codex",
          serverId: item.id,
          installed: false,
          enabled: false,
          status: "unknown",
          details: "未安装",
        } satisfies CodexMcpHealthItem;
      }

      if (!installedServer.enabled) {
        return {
          platform: "codex",
          serverId: item.id,
          installed: true,
          enabled: false,
          status: "unhealthy",
          checkedAt,
          details: installedServer.disabledReason ?? "当前配置为禁用",
        } satisfies CodexMcpHealthItem;
      }

      if (!installedServer.transport) {
        return {
          platform: "codex",
          serverId: item.id,
          installed: true,
          enabled: true,
          status: "unhealthy",
          checkedAt,
          details: "MCP 配置缺少 transport",
        } satisfies CodexMcpHealthItem;
      }

      const probe = await probeInstalledCodexMcpServer(installedServer, {});
      return {
        platform: "codex",
        serverId: item.id,
        installed: true,
        enabled: true,
        status: probe.ok ? "healthy" : "unhealthy",
        checkedAt,
        latencyMs: probe.latencyMs,
        details: probe.details,
      } satisfies CodexMcpHealthItem;
    }),
  );
}

export async function getMcpHealth(platform: ConfigPlatform): Promise<McpHealthItem[]> {
  if (platform === "codex") {
    return getCodexMcpHealth();
  }
  if (platform === "claude") {
    return getCliListedMcpHealth("claude");
  }
  return getCliListedMcpHealth("gemini");
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

export async function installMcpServer(
  platform: ConfigPlatform,
  mcpId: string,
  envOverrides?: Record<string, string>,
): Promise<CodexMcpInstallResult> {
  const marketplace = await getMcpMarketplaceList();
  const item = marketplace.find((entry) => entry.id === mcpId);
  if (!item) {
    throw new Error(`MCP ${mcpId} not found in marketplace.`);
  }

  if (platform === "codex") {
    const { commandArgs, warnings } = buildCodexMcpInstallArgs(item, envOverrides);
    await runCodexCommand(commandArgs);
    return {
      serverId: item.id,
      commandArgs,
      warnings,
    };
  }

  const { commandArgs, warnings } = platform === "claude"
    ? buildClaudeMcpInstallArgs(item, envOverrides)
    : buildGeminiMcpInstallArgs(item, envOverrides);

  if (platform === "claude") {
    await runClaudeCommand(commandArgs);
  } else {
    await runGeminiCommand(commandArgs);
  }

  return {
    serverId: item.id,
    commandArgs,
    warnings,
  };
}

export async function uninstallMcpServer(
  platform: ConfigPlatform,
  mcpId: string,
): Promise<{ platform: ConfigPlatform; serverId: string }> {
  if (!mcpId.trim()) {
    throw new Error("MCP id is required.");
  }

  let commandError: Error | null = null;
  try {
    if (platform === "codex") {
      await runCodexCommand(["mcp", "remove", mcpId]);
    } else if (platform === "claude") {
      await runClaudeCommand(["mcp", "remove", "--scope", "user", mcpId]);
    } else {
      await runGeminiCommand(["mcp", "remove", "--scope", "user", mcpId]);
    }
  } catch (error) {
    commandError = error instanceof Error ? error : new Error(String(error));
  }

  const documentChanged = platform === "codex"
    ? await cleanupCodexMcpDocument(mcpId)
    : platform === "claude"
      ? await cleanupClaudeMcpDocument(mcpId)
      : await cleanupGeminiMcpDocument(mcpId);

  if (commandError && !documentChanged) {
    throw commandError;
  }

  return {
    platform,
    serverId: mcpId,
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
