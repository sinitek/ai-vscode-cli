import type { ConfigItem, CurrentConfigPlatform } from "./types";
import { getCanonicalConfigContent } from "./configprofilenormalization";
import { isPlainObject, parseJsonObjectText, type JsonObjectParseMode } from "../shared/jsonObject";
import { createKimiCodeDefaultConfigText } from "./kimiCodeConfig";
import { createZcodeExampleText } from "./zcodeConfig";

export type ConfigCopyMetadata = Pick<ConfigItem, "id" | "name" | "createdAt" | "updatedAt">;
type ConfigCopyStrategy = (source: ConfigItem) => Partial<ConfigItem>;

export function createConfigCopyName(baseName: string, existingNames: string[]): string {
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

export function assertConfigCopyAllowed(
  sourcePlatform: CurrentConfigPlatform,
  targetPlatform: CurrentConfigPlatform,
): void {
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
}

function readJsonObjectText(
  value: string | undefined,
  fallback = "{}",
  mode: JsonObjectParseMode = "strict",
): Record<string, unknown> {
  const text = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  try {
    return parseJsonObjectText(text, { mode });
  } catch {
    return {};
  }
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
      }
    }
    target[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return Object.keys(servers).length > 0 ? { mcp: servers } : {};
}

function extractMcpConfig(source: ConfigItem): Record<string, unknown> {
  if (source.platform === "codex") {
    return extractCodexMcpConfig(getCanonicalConfigContent(source));
  }
  const config =
    source.platform === "claude"
      ? readJsonObjectText(source.mcpContent, "{}")
      : readJsonObjectText(source.content, "{}", source.platform === "opencode" ? "jsonc" : "strict");
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

function buildOpenCodeConfigCopy(source: ConfigItem): Partial<ConfigItem> {
  const content = readJsonObjectText(source.content, "{}", source.platform === "opencode" ? "jsonc" : "strict");
  if (isPlainObject(content.mcpServers) && !isPlainObject(content.mcp)) {
    content.mcp = content.mcpServers;
    delete content.mcpServers;
  }
  return {
    content: `${JSON.stringify(content, null, 2)}\n`,
    openCodeSkills: cloneOpenCodeSkillsFromSource(source),
  };
}

function buildClaudeConfigCopy(source: ConfigItem): Partial<ConfigItem> {
  return {
    content: source.platform === "claude" ? source.content ?? "{}" : "{}",
    mcpContent: source.platform === "claude" ? source.mcpContent ?? "{}" : JSON.stringify(extractMcpConfig(source), null, 2),
    claudeSkills: source.platform === "claude" ? [...(source.claudeSkills ?? [])] : [],
  };
}

function buildCodexConfigCopy(source: ConfigItem): Partial<ConfigItem> {
  return {
    content: source.platform === "codex" ? getCanonicalConfigContent(source) : "",
    configContent: source.platform === "codex" ? getCanonicalConfigContent(source) : "",
    authContent: source.platform === "codex" ? source.authContent ?? "{}" : "{}",
    codexSkills: source.platform === "codex" ? [...(source.codexSkills ?? [])] : [],
  };
}

function buildGrokConfigCopy(source: ConfigItem): Partial<ConfigItem> {
  const content = source.platform === "grok" ? getCanonicalConfigContent(source) : "";
  return {
    content,
    configContent: content,
    grokSkills: source.platform === "grok" ? [...(source.grokSkills ?? [])] : [],
  };
}

function buildDshConfigCopy(source: ConfigItem): Partial<ConfigItem> {
  const content = source.platform === "dsh" ? getCanonicalConfigContent(source) : "";
  return { content, configContent: content };
}

function buildKimiCodeConfigCopy(source: ConfigItem): Partial<ConfigItem> {
  const content = source.platform === "kimi-code" ? getCanonicalConfigContent(source) : createKimiCodeDefaultConfigText();
  return { content, configContent: content };
}

function buildZcodeConfigCopy(source: ConfigItem): Partial<ConfigItem> {
  const content = source.platform === "zcode" ? getCanonicalConfigContent(source) : createZcodeExampleText();
  return { content, configContent: content };
}

const strategies: Record<CurrentConfigPlatform, ConfigCopyStrategy> = {
  claude: buildClaudeConfigCopy,
  codex: buildCodexConfigCopy,
  opencode: buildOpenCodeConfigCopy,
  grok: buildGrokConfigCopy,
  dsh: buildDshConfigCopy,
  "kimi-code": buildKimiCodeConfigCopy,
  zcode: buildZcodeConfigCopy,
};

export function buildConfigCopy(
  source: ConfigItem,
  targetPlatform: CurrentConfigPlatform,
  metadata: ConfigCopyMetadata,
): ConfigItem {
  return {
    id: metadata.id,
    name: metadata.name,
    platform: targetPlatform,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ...strategies[targetPlatform](source),
  };
}
