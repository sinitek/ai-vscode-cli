import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { buildOpenCodeMcpConfig, OpenCodeMcpConfig } from "./mcpInstallArgs";
import { McpMarketplaceItem } from "./types";
import { JsonObject, isPlainObject, parseJsonObjectText } from "../shared/jsonObject";

type OpenCodeConfigDocument = JsonObject;

export type OpenCodeMcpConfigPathOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export type OpenCodeMcpConfigMutationResult = {
  configPath: string;
  changed: boolean;
  warnings: string[];
};

function expandHomePath(value: string, homeDir: string): string {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

function parseOpenCodeConfig(content: string): OpenCodeConfigDocument {
  return parseJsonObjectText(content, {
    mode: "jsonc",
    rootErrorMessage: "OpenCode config root must be a JSON object.",
  });
}

async function readOpenCodeConfig(configPath: string): Promise<OpenCodeConfigDocument> {
  try {
    return parseOpenCodeConfig(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {};
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse OpenCode config ${configPath}: ${message}`);
  }
}

export async function listInstalledOpenCodeMcpServerIds(
  options: OpenCodeMcpConfigPathOptions = {},
): Promise<string[]> {
  const configPath = resolveOpenCodeGlobalConfigPath(options);
  const document = await readOpenCodeConfig(configPath);
  return Object.keys(getMcpSection(document)).sort((left, right) => left.localeCompare(right));
}

async function writeOpenCodeConfigAtomically(
  configPath: string,
  config: OpenCodeConfigDocument,
): Promise<void> {
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true });

  let mode = 0o600;
  try {
    mode = (await fs.stat(configPath)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  const tempPath = path.join(
    configDir,
    `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode });
    await fs.rename(tempPath, configPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function getMcpSection(config: OpenCodeConfigDocument): Record<string, unknown> {
  const current = config.mcp;
  if (typeof current === "undefined") {
    return {};
  }
  if (!isPlainObject(current)) {
    throw new Error("OpenCode config field \"mcp\" must be a JSON object.");
  }
  return current;
}

export function resolveOpenCodeGlobalConfigPath(
  options: OpenCodeMcpConfigPathOptions = {},
): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const configuredRoot = String(env.XDG_CONFIG_HOME ?? "").trim();
  const configRoot = configuredRoot
    ? expandHomePath(configuredRoot, homeDir)
    : path.join(homeDir, ".config");
  return path.join(configRoot, "opencode", "opencode.json");
}

export async function installOpenCodeMcpConfig(
  item: McpMarketplaceItem,
  envOverrides?: Record<string, string>,
  options: OpenCodeMcpConfigPathOptions = {},
): Promise<OpenCodeMcpConfigMutationResult> {
  const configPath = resolveOpenCodeGlobalConfigPath(options);
  const document = await readOpenCodeConfig(configPath);
  const currentMcp = getMcpSection(document);
  const built = buildOpenCodeMcpConfig(item, envOverrides);
  const nextDocument: OpenCodeConfigDocument = {
    ...document,
    mcp: {
      ...currentMcp,
      [item.id]: built.config,
    },
  };
  await writeOpenCodeConfigAtomically(configPath, nextDocument);
  return {
    configPath,
    changed: true,
    warnings: built.warnings,
  };
}

export async function uninstallOpenCodeMcpConfig(
  serverId: string,
  options: OpenCodeMcpConfigPathOptions = {},
): Promise<OpenCodeMcpConfigMutationResult> {
  const configPath = resolveOpenCodeGlobalConfigPath(options);
  const document = await readOpenCodeConfig(configPath);
  const currentMcp = getMcpSection(document);
  if (!(serverId in currentMcp)) {
    return {
      configPath,
      changed: false,
      warnings: [],
    };
  }

  const nextMcp = { ...currentMcp };
  delete nextMcp[serverId];
  await writeOpenCodeConfigAtomically(configPath, {
    ...document,
    mcp: nextMcp,
  });
  return {
    configPath,
    changed: true,
    warnings: [],
  };
}

export function isOpenCodeMcpConfig(value: unknown): value is OpenCodeMcpConfig {
  return isPlainObject(value)
    && (value.type === "local" || value.type === "remote")
    && value.enabled === true;
}
