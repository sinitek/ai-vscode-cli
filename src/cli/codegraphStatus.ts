import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resolveCliCommand } from "./commandResolution";
import { createConfigPaths } from "../config/configPaths";
import { resolveOpenCodeGlobalConfigPath } from "../config/openCodeMcpConfig";
import { isPlainObject, parseJsonObjectText } from "../shared/jsonObject";

export const CODEGRAPH_CLI_COMMAND = "codegraph";
export const CODEGRAPH_WORKSPACE_DIR_NAME = ".codegraph";
export const CODEGRAPH_MCP_SERVER_ID = "codegraph";

export type CodeGraphStatus = {
  cliInstalled: boolean;
  mcpConfigured: boolean;
  workspaceIndexed: boolean;
  ready: boolean;
};

export type InspectCodeGraphStatusOptions = {
  workspaceRoot?: string | null;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  resolveCommand?: (command: string) => { command: string } | null;
  readFile?: (filePath: string) => string | null;
  isDirectory?: (dirPath: string) => boolean;
};

export function inspectCodeGraphStatus(options: InspectCodeGraphStatusOptions = {}): CodeGraphStatus {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const resolveCommand = options.resolveCommand ?? resolveCliCommand;
  const readFile = options.readFile ?? readTextFileIfExists;
  const isDirectory = options.isDirectory ?? isExistingDirectory;
  const cliInstalled = Boolean(resolveCommand(CODEGRAPH_CLI_COMMAND));
  const mcpConfigured = hasCodeGraphMcpConfig({ env, homeDir, readFile });
  const workspaceIndexed = isCodeGraphWorkspaceIndexed(options.workspaceRoot, isDirectory);
  return {
    cliInstalled,
    mcpConfigured,
    workspaceIndexed,
    ready: cliInstalled && mcpConfigured && workspaceIndexed,
  };
}

export function isCodeGraphInstalledAndInteractive(
  workspaceRoot?: string | null,
  options: Omit<InspectCodeGraphStatusOptions, "workspaceRoot"> = {},
): boolean {
  return inspectCodeGraphStatus({ ...options, workspaceRoot }).ready;
}

export function isCodeGraphWorkspaceIndexed(
  workspaceRoot: string | null | undefined,
  isDirectory: (dirPath: string) => boolean = isExistingDirectory,
): boolean {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    return false;
  }
  return isDirectory(path.join(path.resolve(workspaceRoot.trim()), CODEGRAPH_WORKSPACE_DIR_NAME));
}

function hasCodeGraphMcpConfig(options: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  readFile: (filePath: string) => string | null;
}): boolean {
  const configPaths = createConfigPaths(options.homeDir, options.env);
  const openCodeConfigPath = resolveOpenCodeGlobalConfigPath({
    env: options.env,
    homeDir: options.homeDir,
  });
  return hasCodexCodeGraphMcp(options.readFile(configPaths.codex.config))
    || hasClaudeCodeGraphMcp(options.readFile(configPaths.claude.mcp))
    || hasOpenCodeCodeGraphMcp(options.readFile(openCodeConfigPath));
}

function hasCodexCodeGraphMcp(content: string | null): boolean {
  if (!content) {
    return false;
  }
  return /^\s*\[mcp_servers\.codegraph(?:\.[^\]]*)?\]\s*$/m.test(content.replace(/\r\n/g, "\n"));
}

function hasClaudeCodeGraphMcp(content: string | null): boolean {
  const servers = readJsonObject(content)?.mcpServers;
  return isEnabledMcpServer(isPlainObject(servers) ? servers[CODEGRAPH_MCP_SERVER_ID] : undefined);
}

function hasOpenCodeCodeGraphMcp(content: string | null): boolean {
  const mcp = readJsonObject(content)?.mcp;
  return isEnabledMcpServer(isPlainObject(mcp) ? mcp[CODEGRAPH_MCP_SERVER_ID] : undefined);
}

function isEnabledMcpServer(value: unknown): boolean {
  return isPlainObject(value) && value.enabled !== false;
}

function readJsonObject(content: string | null): Record<string, unknown> | null {
  if (!content || !content.trim()) {
    return null;
  }
  try {
    return parseJsonObjectText(content, {
      mode: "jsonc",
      rootErrorMessage: "CodeGraph MCP config root must be a JSON object.",
    });
  } catch {
    return null;
  }
}

function readTextFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function isExistingDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}
