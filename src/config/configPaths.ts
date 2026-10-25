import * as os from "os";
import * as path from "path";
import type { CliName } from "../cli/types";
import {
  resolveClaudeHomeDir,
  resolveCodexHomeDir,
  resolveDshHomeDir,
  resolveGrokHomeDir,
  resolveOpenCodeHomeDir,
  resolveXdgConfigHome,
} from "../shared/userHomePaths";
import {
  LEGACY_GEMINI_CONFIG_PLATFORM,
  type ConfigPlatform,
  type CurrentConfigPlatform,
} from "./types";

export const CONFIG_DIR_NAME = "__config";
export const CONFIG_ORDER_FILE = "config-order.json";

export type ConfigPlatformInput = ConfigPlatform | CliName;
export type LegacyConfigPlatformInput = ConfigPlatformInput;
export type ConfigPathPlatform = CurrentConfigPlatform;

export type ConfigPathMap = {
  claude: {
    settings: string;
    mcp: string;
    configDir: string;
  };
  codex: {
    config: string;
    auth: string;
    configDir: string;
  };
  opencode: {
    config: string;
    configDir: string;
  };
  grok: {
    config: string;
    configDir: string;
  };
  dsh: {
    config: string;
    configDir: string;
  };
};

export function normalizeConfigPlatform(platform: LegacyConfigPlatformInput): ConfigPathPlatform {
  if (platform === "claude") {
    return "claude";
  }
  if (platform === "codex") {
    return "codex";
  }
  if (platform === "opencode" || platform === LEGACY_GEMINI_CONFIG_PLATFORM) {
    return "opencode";
  }
  if (platform === "grok") {
    return "grok";
  }
  if (platform === "dsh") {
    return "dsh";
  }
  throw new Error(`Unsupported config platform: ${String(platform)}`);
}

export function createConfigPaths(
  homeDir = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): ConfigPathMap {
  const claudeHomeDir = resolveClaudeHomeDir(homeDir);
  const codexHomeDir = resolveCodexHomeDir(env, homeDir);
  const openCodeRuntimeDir = resolveOpenCodeHomeDir(homeDir);
  return {
    claude: {
      settings: path.join(claudeHomeDir, "settings.json"),
      mcp: path.join(homeDir, ".claude.json"),
      configDir: path.join(claudeHomeDir, CONFIG_DIR_NAME),
    },
    codex: {
      config: path.join(codexHomeDir, "config.toml"),
      auth: path.join(codexHomeDir, "auth.json"),
      configDir: path.join(codexHomeDir, CONFIG_DIR_NAME),
    },
    opencode: {
      config: path.join(openCodeRuntimeDir, "config.json"),
      configDir: path.join(openCodeRuntimeDir, CONFIG_DIR_NAME),
    },
    grok: {
      config: path.join(resolveGrokHomeDir(env, homeDir), "config.toml"),
      configDir: path.join(resolveGrokHomeDir(env, homeDir), CONFIG_DIR_NAME),
    },
    dsh: {
      config: path.join(resolveDshHomeDir(env, homeDir), CONFIG_DIR_NAME, "active-patch.yaml"),
      configDir: path.join(resolveDshHomeDir(env, homeDir), CONFIG_DIR_NAME),
    },
  };
}

export const CONFIG_PATHS = createConfigPaths();

export function getConfigDir(
  platform: LegacyConfigPlatformInput,
  paths: ConfigPathMap = CONFIG_PATHS,
): string {
  const normalized = normalizeConfigPlatform(platform);
  if (normalized === "grok" && paths === CONFIG_PATHS) {
    return path.join(resolveGrokHomeDir(), CONFIG_DIR_NAME);
  }
  if (normalized === "dsh" && paths === CONFIG_PATHS) {
    return path.join(resolveDshHomeDir(), CONFIG_DIR_NAME);
  }
  return paths[normalized].configDir;
}

export function getConfigOrderPath(
  platform: LegacyConfigPlatformInput,
  paths: ConfigPathMap = CONFIG_PATHS,
): string {
  return path.join(getConfigDir(platform, paths), CONFIG_ORDER_FILE);
}

export function getConfigFilePath(
  platform: LegacyConfigPlatformInput,
  configId: string,
  paths: ConfigPathMap = CONFIG_PATHS,
): string {
  return path.join(getConfigDir(platform, paths), `${configId}.json`);
}

export function getOpenCodeRuntimePaths(paths: ConfigPathMap = CONFIG_PATHS): { config: string } {
  return {
    config: paths.opencode.config,
  };
}

export function getCodexRuntimePaths(paths: ConfigPathMap = CONFIG_PATHS): { config: string } {
  return {
    config: paths.codex.config,
  };
}

export type OpenCodeGlobalConfigPathOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export function resolveOpenCodeGlobalConfigPath(
  options: OpenCodeGlobalConfigPathOptions = {},
): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  return path.join(resolveXdgConfigHome(env, homeDir), "opencode", "opencode.json");
}
