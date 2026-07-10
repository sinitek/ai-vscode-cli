import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn } from "cross-spawn";
import { getCliCommand } from "../cli/config";
import { CliName } from "../cli/types";
import { ConfigPlatform, CodexMcpHealthItem, CodexMcpInstallResult, McpHealthItem, McpMarketplaceItem } from "./types";
import { buildClaudeMcpInstallArgs, buildCodexMcpInstallArgs, buildOpenCodeMcpInstallArgs, parseCodexMcpServerIds } from "./mcpInstallArgs";
import {
  mapCliListedMcpHealth,
  parseClaudeMcpHealthOutput,
  parseInstalledCodexMcpServer,
  parseOpenCodeMcpHealthOutput,
  probeInstalledCodexMcpServer,
} from "./mcpHealth";

const CODEX_MCP_COMMAND_TIMEOUT_MS = 120000;
const OPENCODE_CLI = "opencode" as CliName;

export type CodexRunResult = {
  stdout: string;
  stderr: string;
};

export type CodexMcpTransportStdioConfig = {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  envVars: string[];
  cwd?: string;
};

export type CodexMcpTransportHttpConfig = {
  type: "http";
  protocol: "http" | "streamable_http";
  url: string;
  headers: Record<string, string>;
  bearerTokenEnvVar?: string;
};

export type CodexMcpTransportConfig = CodexMcpTransportStdioConfig | CodexMcpTransportHttpConfig;

export type CodexInstalledMcpServer = {
  serverId: string;
  enabled: boolean;
  disabledReason?: string;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  transport: CodexMcpTransportConfig | null;
};

export type McpProbeResult = {
  ok: boolean;
  latencyMs: number;
  details: string;
};

export type SimpleFetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type SimpleFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type SimpleFetch = (input: string, init?: SimpleFetchInit) => Promise<SimpleFetchResponse>;

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

async function runOpenCodeCommand(
  args: string[],
  timeoutMs = CODEX_MCP_COMMAND_TIMEOUT_MS,
): Promise<CodexRunResult> {
  return runConfiguredCliCommand(OPENCODE_CLI, args, timeoutMs);
}

async function runCodexCommand(args: string[], timeoutMs = CODEX_MCP_COMMAND_TIMEOUT_MS): Promise<CodexRunResult> {
  return runConfiguredCliCommand("codex", args, timeoutMs);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
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
  const headerPattern = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegExp(serverId)}\\]\\s*$`);
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

async function readTextFileIfExists(filePath: string, defaultContent: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultContent;
    }
    throw error;
  }
}

async function cleanupClaudeMcpDocument(serverId: string): Promise<boolean> {
  const filePath = path.join(os.homedir(), ".claude.json");
  const currentContent = await readTextFileIfExists(filePath, "{}");
  const next = removeMcpServerFromJsonText(currentContent, serverId);
  if (!next.changed) {
    return false;
  }
  await fs.writeFile(filePath, next.content, "utf-8");
  return true;
}

async function cleanupOpenCodeMcpDocument(serverId: string): Promise<boolean> {
  const settingsPath = path.join(os.homedir(), ".opencode", "config.json");
  const currentContent = await readTextFileIfExists(settingsPath, "{}");
  const next = removeMcpServerFromJsonText(currentContent, serverId);
  if (!next.changed) {
    return false;
  }
  await fs.writeFile(settingsPath, next.content, "utf-8");
  return true;
}

async function cleanupCodexMcpDocument(serverId: string): Promise<boolean> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  const currentContent = await readTextFileIfExists(configPath, "");
  const next = removeCodexMcpServerBlock(currentContent, serverId);
  if (!next.changed) {
    return false;
  }
  await fs.writeFile(configPath, next.content, "utf-8");
  return true;
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

async function getCliListedMcpHealth(
  platform: Extract<ConfigPlatform, "claude" | "opencode">,
): Promise<McpHealthItem[]> {
  const cli = platform === "claude" ? "claude" : OPENCODE_CLI;
  const checkedAt = new Date().toISOString();
  const marketplace = await getMcpMarketplaceList();

  let listedById = new Map<string, Omit<McpHealthItem, "platform" | "serverId" | "installed" | "checkedAt">>();
  try {
    const { stdout, stderr } = platform === "opencode"
      ? await runOpenCodeCommand(["mcp", "list"])
      : await runConfiguredCliCommand(cli, ["mcp", "list"]);
    const rawOutput = [stdout, stderr].filter((item) => item.trim().length > 0).join("\n");
    listedById = platform === "claude"
      ? parseClaudeMcpHealthOutput(rawOutput)
      : parseOpenCodeMcpHealthOutput(rawOutput);
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

  return mapCliListedMcpHealth(platform, marketplace, listedById, checkedAt);
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
  return getCliListedMcpHealth("opencode");
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
    : buildOpenCodeMcpInstallArgs(item, envOverrides);

  if (platform === "claude") {
    await runClaudeCommand(commandArgs);
  } else {
    await runOpenCodeCommand(commandArgs);
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
      await runOpenCodeCommand(["mcp", "remove", "--scope", "user", mcpId]);
    }
  } catch (error) {
    commandError = error instanceof Error ? error : new Error(String(error));
  }

  const documentChanged = platform === "codex"
    ? await cleanupCodexMcpDocument(mcpId)
    : platform === "claude"
      ? await cleanupClaudeMcpDocument(mcpId)
      : await cleanupOpenCodeMcpDocument(mcpId);

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
