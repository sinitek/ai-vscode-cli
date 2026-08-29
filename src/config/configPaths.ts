import * as os from "os";
import * as path from "path";
import type { CliName } from "../cli/types";
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
  throw new Error(`Unsupported config platform: ${String(platform)}`);
}

export function createConfigPaths(homeDir = os.homedir()): ConfigPathMap {
  const openCodeRuntimeDir = path.join(homeDir, ".opencode");
  return {
    claude: {
      settings: path.join(homeDir, ".claude", "settings.json"),
      mcp: path.join(homeDir, ".claude.json"),
      configDir: path.join(homeDir, ".claude", CONFIG_DIR_NAME),
    },
    codex: {
      config: path.join(homeDir, ".codex", "config.toml"),
      auth: path.join(homeDir, ".codex", "auth.json"),
      configDir: path.join(homeDir, ".codex", CONFIG_DIR_NAME),
    },
    opencode: {
      config: path.join(openCodeRuntimeDir, "config.json"),
      configDir: path.join(openCodeRuntimeDir, CONFIG_DIR_NAME),
    },
  };
}

export const CONFIG_PATHS = createConfigPaths();

export function getConfigDir(
  platform: LegacyConfigPlatformInput,
  paths: ConfigPathMap = CONFIG_PATHS,
): string {
  return paths[normalizeConfigPlatform(platform)].configDir;
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
