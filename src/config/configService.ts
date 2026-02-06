import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  ApplyPayload,
  ConfigItem,
  ConfigOrder,
  ConfigPlatform,
  CurrentConfig,
  McpMarketplaceItem,
  CodexSkillItem,
} from "./types";
import { listCodexSkills, mergeCodexSkillsConfig } from "./codexSkills";
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
  const jsonFiles = files.filter((file) => file.endsWith(".json"));
  const configs: ConfigItem[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await fs.readFile(path.join(configDir, file), "utf-8");
      const config = JSON.parse(content) as ConfigItem;
      if (config.platform === "claude" && config.mcpContent === undefined) {
        config.mcpContent = "{}";
      }
      if (config.platform === "gemini" && config.envContent === undefined) {
        config.envContent = "";
      }
      if (config.platform === "codex" && config.codexSkills === undefined) {
        config.codexSkills = [];
      }
      configs.push(config);
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
    if (config.platform === "claude" && config.mcpContent === undefined) {
      config.mcpContent = "{}";
    }
    if (config.platform === "gemini" && config.envContent === undefined) {
      config.envContent = "";
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
    } else if (platform === "codex") {
      const { config, auth } = await readCodexConfig();
      defaultConfig.configContent = config;
      defaultConfig.authContent = auth;
    } else {
      const { settings, env } = await readGeminiConfig();
      defaultConfig.content = settings;
      defaultConfig.envContent = env;
    }
  } catch {
    if (platform === "claude") {
      defaultConfig.content = "{}";
      defaultConfig.mcpContent = "{}";
    } else if (platform === "gemini") {
      defaultConfig.content = "{}";
      defaultConfig.envContent = "";
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
    await writeClaudeConfig(payload.content ?? "{}");
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
  await writeGeminiConfig(payload.content ?? "{}", payload.envContent ?? "");
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

export async function getCodexSkillsList(): Promise<CodexSkillItem[]> {
  return listCodexSkills();
}
