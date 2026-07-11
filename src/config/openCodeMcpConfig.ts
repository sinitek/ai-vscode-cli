import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { buildOpenCodeMcpConfig, OpenCodeMcpConfig } from "./mcpInstallArgs";
import { McpMarketplaceItem } from "./types";

type OpenCodeConfigDocument = Record<string, unknown>;

export type OpenCodeMcpConfigPathOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export type OpenCodeMcpConfigMutationResult = {
  configPath: string;
  changed: boolean;
  warnings: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function expandHomePath(value: string, homeDir: string): string {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

function stripJsonComments(content: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    const next = content[index + 1];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === "/" && next === "/") {
      index += 2;
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") {
        result += " ";
        index += 1;
      }
      if (index < content.length) {
        result += content[index];
      }
      continue;
    }

    if (current === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < content.length) {
        if (content[index] === "*" && content[index + 1] === "/") {
          result += "  ";
          index += 1;
          break;
        }
        result += content[index] === "\n" || content[index] === "\r" ? content[index] : " ";
        index += 1;
      }
      continue;
    }

    result += current;
  }

  return result;
}

function stripTrailingCommas(content: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === ",") {
      let nextIndex = index + 1;
      while (nextIndex < content.length && /\s/.test(content[nextIndex])) {
        nextIndex += 1;
      }
      if (content[nextIndex] === "}" || content[nextIndex] === "]") {
        continue;
      }
    }

    result += current;
  }

  return result;
}

function parseOpenCodeConfig(content: string): OpenCodeConfigDocument {
  const normalized = content.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    return {};
  }
  const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(normalized))) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("OpenCode config root must be a JSON object.");
  }
  return parsed;
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
