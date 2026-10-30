import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  ApplyPayload,
  ConfigItem,
  ConfigOrder,
  LEGACY_GEMINI_CONFIG_PLATFORM,
  CopyConfigPayload,
  CurrentConfig,
  CurrentConfigPlatform,
} from "./types";
import { t } from "../i18n";
import { createCliRuntimeConfigStrategies } from "./cliRuntimeConfigStrategies";
import {
  OpenCodeConfigModelIssueCode,
  OpenCodeModelRole,
  parseOpenCodeConfigModels,
  parseOpenCodeModelReference,
} from "../cli/opencodeconfigmodels";
import {
  CONFIG_ORDER_FILE,
  CONFIG_PATHS,
  getCodexRuntimePaths as getCodexRuntimePathsFromConfigPaths,
  getConfigDir,
  getConfigFilePath,
  getConfigOrderPath,
  getOpenCodeRuntimePaths as getOpenCodeRuntimePathsFromConfigPaths,
  normalizeConfigPlatform,
  type ConfigPathPlatform,
  type LegacyConfigPlatformInput,
} from "./configPaths";
import { isPlainObject, parseJsonObjectText } from "../shared/jsonObject";
import { writeFileAtomically } from "../shared/atomicWrite";
import { resolveGrokConfigPath } from "../shared/userHomePaths";
import {
  createZcodeExampleText,
  readZcodeProviderConfigText,
  writeZcodeProviderConfigText,
  backupZcodeProviderConfig,
} from "./zcodeConfig";
import {
  commitKimiCodeText,
  createKimiCodeDefaultConfigText,
  readKimiCodeConfigText,
  resolveKimiCodeConfigDir,
  writeKimiCodeConfigText,
} from "./kimiCodeConfig";
import { commitDshDocument } from "../cli/dshConfigModels";
import {
  activateDshProfile,
  readDshActiveProfileText,
  resolveDshConfigPaths,
  writeDshAppliedProfile,
} from "./dshConfig";

const BACKUP_DIR = path.join(os.homedir(), ".ai_cli_tools_backups");
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


export function parseOpenCodeModelVariants(
  content: string | undefined,
  providerId: string,
  modelId: string
): string[] {
  if (!providerId || !modelId) {
    return [];
  }

  const parsedModels = parseOpenCodeConfigModels(content);
  const target = parseOpenCodeModelReference(`${providerId}/${modelId}`);
  if (!target || !parsedModels.candidates.some((candidate) => candidate.ref === target.ref)) {
    return [];
  }
  const parsed = parsedModels.config;
  if (!parsed || !isPlainObject(parsed.provider)) {
    return [];
  }
  const providerConfig = parsed.provider[providerId];
  if (!isPlainObject(providerConfig) || !isPlainObject(providerConfig.models)) {
    return [];
  }

  const modelConfig = providerConfig.models[modelId];
  if (!isPlainObject(modelConfig) || !isPlainObject(modelConfig.variants)) {
    return [];
  }

  return Object.entries(modelConfig.variants)
    .filter(([variantName, variantConfig]) => (
      variantName.length > 0
      && !(isPlainObject(variantConfig) && variantConfig.disabled === true)
    ))
    .map(([variantName]) => variantName);
}

export const getOpenCodeRuntimePaths = getOpenCodeRuntimePathsFromConfigPaths;
export const getCodexRuntimePaths = getCodexRuntimePathsFromConfigPaths;

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

export async function readGrokConfigText(): Promise<string> {
  const configPath = resolveGrokConfigPath();
  try {
    return await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function writeGrokConfigText(content: string): Promise<void> {
  const configPath = resolveGrokConfigPath();
  await ensureDir(path.dirname(configPath));
  await writeFileAtomically(configPath, content);
}

export async function readKimiCodeConfigTextFromDisk(): Promise<string> {
  return readKimiCodeConfigText();
}

export async function writeKimiCodeConfigTextToDisk(content: string): Promise<void> {
  const committed = commitKimiCodeText("", content);
  if (!committed.ok) {
    throw new Error(committed.error);
  }
  await writeKimiCodeConfigText(committed.content);
}

export async function readDshConfigText(): Promise<string> {
  return readDshActiveProfileText(resolveDshConfigPaths());
}

export async function writeDshConfigText(content: string): Promise<void> {
  const committed = commitDshDocument(content);
  if (!committed.ok) {
    throw new Error(committed.error);
  }
  await writeDshAppliedProfile(committed.content, resolveDshConfigPaths());
}

export async function activateSavedDshConfig(profileId: string): Promise<void> {
  const profile = await getConfigById("dsh", profileId);
  if (!profile) {
    throw new Error("DSH profile was not found.");
  }
  const result = await activateDshProfile({
    profileId,
    content: profile.configContent ?? profile.content ?? "",
    paths: resolveDshConfigPaths(),
  });
  if (!result.ok || !result.activated) {
    throw new Error(result.error);
  }
}

export async function readOpenCodeConfig(): Promise<{ config: string; env: string }> {
  await ensureFile(CONFIG_PATHS.opencode.config, "{}");
  const config = await fs.readFile(CONFIG_PATHS.opencode.config, "utf-8");
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

export async function writeCodexConfig(config: string, auth?: string): Promise<void> {
  await ensureDir(path.dirname(CONFIG_PATHS.codex.config));
  const writes: Promise<void>[] = [writeFileAtomically(CONFIG_PATHS.codex.config, config)];
  if (auth !== undefined) {
    writes.push(writeFileAtomically(CONFIG_PATHS.codex.auth, auth));
  }
  await Promise.all(writes);
}

export async function writeOpenCodeConfig(config: string, _env?: string): Promise<void> {
  await ensureDir(path.dirname(CONFIG_PATHS.opencode.config));
  await fs.writeFile(CONFIG_PATHS.opencode.config, config, "utf-8");
}

type BackupFileSpec = {
  baseName: string;
  suffix: ".json" | ".toml";
  content: string;
  mode?: number;
};

type BackupPlatformSpec = {
  prefix: string;
  readFiles: () => Promise<BackupFileSpec[]>;
};

type BackupRegistryPlatform = Exclude<CurrentConfigPlatform, "zcode">;

function writeBackupFile(spec: BackupFileSpec, backupPath: string): Promise<void> {
  if (spec.mode === undefined) {
    return fs.writeFile(backupPath, spec.content, "utf-8");
  }
  return fs.writeFile(backupPath, spec.content, { encoding: "utf-8", mode: spec.mode });
}

async function runBackup(spec: BackupPlatformSpec): Promise<string[]> {
  await ensureDir(BACKUP_DIR);
  const files = await spec.readFiles();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPaths = files.map((file) => path.join(BACKUP_DIR, `${spec.prefix}${file.baseName}_${timestamp}${file.suffix}`));
  await Promise.all(files.map((file, index) => writeBackupFile(file, backupPaths[index])));
  await Promise.all(
    files
      .map((file, index) => ({ file, backupPath: backupPaths[index] }))
      .filter(({ file }) => file.mode !== undefined)
      .map(({ file, backupPath }) => fs.chmod(backupPath, file.mode as number)),
  );
  return backupPaths;
}

const BACKUP_PLATFORMS: Record<BackupRegistryPlatform, BackupPlatformSpec> = {
  claude: {
    prefix: "claude_",
    readFiles: async () => {
      const [content, mcpContent] = await Promise.all([readClaudeConfig(), readClaudeMcpConfig()]);
      return [
        { baseName: "settings", suffix: ".json", content },
        { baseName: "mcp", suffix: ".json", content: mcpContent },
      ];
    },
  },
  codex: {
    prefix: "codex_",
    readFiles: async () => {
      const { config, auth } = await readCodexConfig();
      return [
        { baseName: "config", suffix: ".toml", content: config },
        { baseName: "auth", suffix: ".json", content: auth },
      ];
    },
  },
  opencode: {
    prefix: "opencode_",
    readFiles: async () => {
      const { config } = await readOpenCodeConfig();
      return [{ baseName: "config", suffix: ".json", content: config }];
    },
  },
  grok: {
    prefix: "grok_",
    readFiles: async () => [
      { baseName: "config", suffix: ".toml", content: await readGrokConfigText() },
    ],
  },
  "kimi-code": {
    prefix: "kimi-code_",
    readFiles: async () => [
      { baseName: "config", suffix: ".toml", content: await readKimiCodeConfigTextFromDisk() },
    ],
  },
  dsh: {
    prefix: "dsh_",
    readFiles: async () => [
      { baseName: "config", suffix: ".json", content: await readDshConfigText(), mode: 0o600 },
    ],
  },
};

function getBackupPlatformSpec(platform: BackupRegistryPlatform): BackupPlatformSpec {
  return BACKUP_PLATFORMS[platform];
}

function getBackupPrefix(platform: BackupRegistryPlatform | "zcode"): string {
  if (platform === "zcode") {
    return "zcode_";
  }
  return getBackupPlatformSpec(platform).prefix;
}

export async function backupClaudeConfig(): Promise<string[]> {
  return runBackup(getBackupPlatformSpec("claude"));
}

export async function backupCodexConfig(): Promise<string[]> {
  return runBackup(getBackupPlatformSpec("codex"));
}

export async function backupOpenCodeConfig(): Promise<string[]> {
  return runBackup(getBackupPlatformSpec("opencode"));
}

export async function backupGrokConfig(): Promise<string[]> {
  return runBackup(getBackupPlatformSpec("grok"));
}

export async function backupKimiCodeConfig(): Promise<string[]> {
  return runBackup(getBackupPlatformSpec("kimi-code"));
}

export async function backupDshConfig(): Promise<string[]> {
  return runBackup(getBackupPlatformSpec("dsh"));
}

const cliRuntimeConfigStrategies = createCliRuntimeConfigStrategies({
  claude: {
    readClaudeConfig,
    readClaudeMcpConfig,
    writeClaudeConfig,
    writeClaudeMcpConfig,
    backupClaudeConfig,
  },
  codex: {
    readCodexConfig,
    writeCodexConfig,
    backupCodexConfig,
  },
  opencode: {
    readOpenCodeConfig,
    writeOpenCodeConfig,
    backupOpenCodeConfig,
  },
  grok: {
    readGrokConfigText,
    writeGrokConfigText,
    backupGrokConfig,
  },
  dsh: {
    readDshConfigText,
    writeDshConfigText,
    backupDshConfig,
  },
  "kimi-code": {
    readKimiCodeConfigText: readKimiCodeConfigTextFromDisk,
    writeKimiCodeConfigText: writeKimiCodeConfigTextToDisk,
    backupKimiCodeConfig: backupKimiCodeConfig,
    createDefaultConfigText: createKimiCodeDefaultConfigText,
  },
  zcode: {
    readZcodeConfigText: () => readZcodeProviderConfigText(),
    writeZcodeConfigText: (content) => writeZcodeProviderConfigText(content),
    backupZcodeConfig: () => backupZcodeProviderConfig(),
    createDefaultConfigText: createZcodeExampleText,
  },
});

const configApplyTails = new Map<CurrentConfigPlatform, Promise<void>>();

function enqueueConfigApply(
  platform: CurrentConfigPlatform,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = configApplyTails.get(platform) ?? Promise.resolve();
  let queued!: Promise<void>;
  queued = previous
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      if (configApplyTails.get(platform) === queued) {
        configApplyTails.delete(platform);
      }
    });
  configApplyTails.set(platform, queued);
  return queued;
}

export async function getBackupList(platform: LegacyConfigPlatformInput): Promise<string[]> {
  await ensureDir(BACKUP_DIR);
  const files = await fs.readdir(BACKUP_DIR);
  const normalizedPlatform = normalizeConfigPlatform(platform);
  const prefix = getBackupPrefix(normalizedPlatform);
  return files.filter((file) => file.startsWith(prefix)).sort().reverse();
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
        !(normalizedPlatform === "opencode" && (config as { platform?: unknown }).platform === LEGACY_GEMINI_CONFIG_PLATFORM)
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
      if (normalizedConfig.platform === "opencode") {
        delete normalizedConfig.envContent;
      }
      if (normalizedConfig.platform === "opencode" && normalizedConfig.openCodeSkills === undefined) {
        normalizedConfig.openCodeSkills = [];
      }
      if (normalizedConfig.platform === "codex") {
        normalizeCodexConfigFields(normalizedConfig);
      }
      if (normalizedConfig.platform === "grok") {
        normalizeGrokConfigFields(normalizedConfig);
      }
      if (normalizedConfig.platform === "dsh") {
        normalizeDshConfigFields(normalizedConfig);
      }
      if (normalizedConfig.platform === "kimi-code") {
        normalizeKimiCodeConfigFields(normalizedConfig);
      }
      if (normalizedConfig.platform === "zcode") {
        normalizeZcodeConfigFields(normalizedConfig);
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

const DEFAULT_CONFIG_ORDER: ConfigOrder = { claude: [], codex: [], opencode: [], grok: [], dsh: [], "kimi-code": [], zcode: [] };

function normalizeConfigOrder(order: LegacyConfigOrder): ConfigOrder {
  return {
    claude: Array.isArray(order.claude) ? [...order.claude] : [],
    codex: Array.isArray(order.codex) ? [...order.codex] : [],
    opencode: Array.isArray(order.opencode) ? [...order.opencode] : Array.isArray(order.gemini) ? [...order.gemini] : [],
    grok: Array.isArray(order.grok) ? [...order.grok] : [],
    dsh: Array.isArray(order.dsh) ? [...order.dsh] : [],
    "kimi-code": Array.isArray(order["kimi-code"]) ? [...order["kimi-code"]] : [],
    zcode: Array.isArray(order.zcode) ? [...order.zcode] : [],
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

function getCodexTomlContent(config: Pick<ConfigItem, "content" | "configContent">): string {
  // configContent is the canonical Codex profile field; content remains for legacy profiles.
  return config.configContent ?? config.content ?? "";
}

function normalizeCodexConfigFields(config: ConfigItem): void {
  const content = getCodexTomlContent(config);
  config.content = content;
  config.configContent = content;
  delete config.envContent;
  config.authContent = config.authContent ?? "{}";
  config.codexSkills = config.codexSkills ?? [];
}

function normalizeGrokConfigFields(config: ConfigItem): void {
  const content = config.configContent ?? config.content ?? "";
  config.content = content;
  config.configContent = content;
  delete config.authContent;
  delete config.mcpContent;
  delete config.envContent;
  config.grokSkills = config.grokSkills ?? [];
}

function normalizeDshConfigFields(config: ConfigItem): void {
  const content = config.configContent ?? config.content ?? "";
  config.content = content;
  config.configContent = content;
  delete config.authContent;
  delete config.mcpContent;
  delete config.envContent;
  delete config.claudeSkills;
  delete config.codexSkills;
  delete config.openCodeSkills;
  delete config.grokSkills;
}

function normalizeZcodeConfigFields(config: ConfigItem): void {
  const content = config.configContent ?? config.content ?? "";
  config.content = content;
  config.configContent = content;
  delete config.authContent;
  delete config.mcpContent;
  delete config.envContent;
  delete config.claudeSkills;
  delete config.codexSkills;
  delete config.openCodeSkills;
  delete config.grokSkills;
}

function normalizeKimiCodeConfigFields(config: ConfigItem): void {
  const content = config.configContent ?? config.content ?? "";
  config.content = content;
  config.configContent = content;
  delete config.authContent;
  delete config.mcpContent;
  delete config.envContent;
  delete config.claudeSkills;
  delete config.codexSkills;
  delete config.openCodeSkills;
  delete config.grokSkills;
}

function readJsonObjectText(value: string | undefined, fallback = "{}"): Record<string, unknown> {
  const text = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  try {
    return parseJsonObjectText(text, { mode: "strict" });
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
  | OpenCodeConfigModelIssueCode
  | "placeholder-provider"
  | "placeholder-model"
  | "placeholder-base-url"
  | "missing-env"
  | "openai-compatible-base-url-missing"
  | "openai-compatible-base-url-missing-v1";

export type OpenCodeConfigValidationIssue = {
  code: OpenCodeConfigValidationIssueCode;
  message: string;
  role?: OpenCodeModelRole;
  ref?: string;
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
  const parsedModels = parseOpenCodeConfigModels(content);
  const issues: OpenCodeConfigValidationIssue[] = parsedModels.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.role ? { role: issue.role } : {}),
      ...(issue.ref ? { ref: issue.ref } : {}),
    }));
  if (!parsedModels.config) {
    return {
      ok: false,
      issues,
    };
  }

  const config = parsedModels.config;
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
    return extractCodexMcpConfig(getCodexTomlContent(source));
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
  if (targetPlatform === "grok") {
    const content = source.platform === "grok" ? source.configContent ?? source.content ?? "" : "";
    return {
      ...base,
      content,
      configContent: content,
      grokSkills: source.platform === "grok" ? [...(source.grokSkills ?? [])] : [],
    };
  }
  if (targetPlatform === "dsh") {
    const content = source.platform === "dsh" ? source.configContent ?? source.content ?? "" : "";
    return {
      ...base,
      content,
      configContent: content,
    };
  }
  if (targetPlatform === "kimi-code") {
    const content = source.platform === "kimi-code"
      ? source.configContent ?? source.content ?? ""
      : createKimiCodeDefaultConfigText();
    return {
      ...base,
      content,
      configContent: content,
    };
  }
  if (targetPlatform === "zcode") {
    const content = source.platform === "zcode"
      ? source.configContent ?? source.content ?? ""
      : createZcodeExampleText();
    return {
      ...base,
      content,
      configContent: content,
    };
  }
  return {
    ...base,
    content: source.platform === "codex" ? getCodexTomlContent(source) : "",
    configContent: source.platform === "codex" ? getCodexTomlContent(source) : "",
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

  if (configToSave.platform === "codex") {
    normalizeCodexConfigFields(configToSave);
  }
  if (configToSave.platform === "grok") {
    normalizeGrokConfigFields(configToSave);
  }
  if (configToSave.platform === "zcode") {
    normalizeZcodeConfigFields(configToSave);
  }
  if (configToSave.platform === "kimi-code") {
    normalizeKimiCodeConfigFields(configToSave);
    const committed = commitKimiCodeText("", configToSave.content ?? "");
    if (!committed.ok) {
      throw new Error(committed.error);
    }
    configToSave.content = committed.content;
    configToSave.configContent = committed.content;
  }
  if (configToSave.platform === "dsh") {
    normalizeDshConfigFields(configToSave);
    const committed = commitDshDocument(configToSave.content ?? "");
    if (!committed.ok) {
      throw new Error(committed.error);
    }
    configToSave.content = committed.content;
    configToSave.configContent = committed.content;
  }
  if (configToSave.content && configToSave.platform !== "codex" && configToSave.platform !== "grok" && configToSave.platform !== "dsh" && configToSave.platform !== "kimi-code") {
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
    const blockingIssues = validation.issues.filter((issue) => (
      issue.code !== "role-model-missing"
      && issue.code !== "openai-compatible-base-url-missing-v1"
    ));
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
  if (configToSave.platform === "dsh") {
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    await fs.chmod(configDir, 0o700);
    await writeFileAtomically(filePath, JSON.stringify(configToSave, null, 2), { mode: 0o600 });
  } else {
    await fs.writeFile(filePath, JSON.stringify(configToSave, null, 2), "utf-8");
  }
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
  if (
    (sourcePlatform === "dsh" && targetPlatform !== "dsh")
    || (sourcePlatform !== "dsh" && targetPlatform === "dsh")
  ) {
    throw new Error("DSH configs can only be copied as DSH configs.");
  }
  if (
    (sourcePlatform === "kimi-code" && targetPlatform !== "kimi-code")
    || (sourcePlatform !== "kimi-code" && targetPlatform === "kimi-code")
  ) {
    throw new Error("Kimi Code configs can only be copied as Kimi Code configs.");
  }
  if (
    (sourcePlatform === "zcode" && targetPlatform !== "zcode")
    || (sourcePlatform !== "zcode" && targetPlatform === "zcode")
  ) {
    throw new Error("ZCode configs can only be copied as ZCode configs.");
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
    if (config.platform === "opencode") {
      delete config.envContent;
    }
    if (config.platform === "opencode" && config.openCodeSkills === undefined) {
      config.openCodeSkills = config.geminiSkills ?? [];
    }
    delete config.geminiSkills;
    if (config.platform === "codex") {
      normalizeCodexConfigFields(config);
    }
    if (config.platform === "dsh") {
      normalizeDshConfigFields(config);
    }
    if (config.platform === "kimi-code") {
      normalizeKimiCodeConfigFields(config);
    }
    if (config.platform === "zcode") {
      normalizeZcodeConfigFields(config);
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

  const strategy = cliRuntimeConfigStrategies[normalizedPlatform];
  try {
    Object.assign(defaultConfig, await strategy.readInitialFields());
  } catch {
    Object.assign(defaultConfig, strategy.fallbackInitialFields());
  }

  await saveConfig(defaultConfig);
  return defaultConfig;
}

export async function getCurrentConfig(platform: LegacyConfigPlatformInput): Promise<CurrentConfig> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  return cliRuntimeConfigStrategies[normalizedPlatform].readCurrent();
}

export async function applyConfig(platform: LegacyConfigPlatformInput, payload: ApplyPayload): Promise<void> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  return enqueueConfigApply(normalizedPlatform, async () => {
    const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
    if (normalizedPlatform === "dsh" && profileId) {
      const result = await activateDshProfile({
        profileId,
        content: payload.content ?? payload.configContent ?? "",
      });
      if (!result.ok || !result.activated) {
        throw new Error(result.error);
      }
      return;
    }
    await cliRuntimeConfigStrategies[normalizedPlatform].apply(payload);
  });
}

export async function backupConfig(platform: LegacyConfigPlatformInput): Promise<string[]> {
  const normalizedPlatform = normalizeConfigPlatform(platform);
  return cliRuntimeConfigStrategies[normalizedPlatform].backup();
}

export {
  CLI_GLOBAL_SKILL_PLATFORMS,
  getCliSkillsList,
  openCliSkillsDirectory,
  deleteCliSkill,
  copyCliSkill,
  installCliSkillDirectory,
  readDshUnsupportedCapability,
} from "./cliGlobalSkills";

export {
  searchLobehubSkills,
  installLobehubSkill,
  installLocalSkillZip,
  installLocalSkillZipFromPath,
} from "./lobehubSkillMarket";
