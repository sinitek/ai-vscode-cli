import * as os from "os";
import * as path from "path";

export const CODEX_HOME_DIRECTORY_NAME = ".codex";
export const CLAUDE_HOME_DIRECTORY_NAME = ".claude";
export const OPENCODE_HOME_DIRECTORY_NAME = ".opencode";
export const SINITEK_RUNTIME_DIR_NAME = ".sinitek_cli";
export const AGENTS_HOME_DIRECTORY_NAME = ".agents";
export const CODEX_HOME_DIR_ENV_KEY = "CODEX_HOME_DIR";

const WINDOWS_ENV_VAR_PATTERN = /%([^%]+)%/g;

export type ExpandHomePathOptions = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

function resolveEnvValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(env, name) && env[name]) {
    return env[name];
  }
  const upper = name.toUpperCase();
  if (upper !== name && Object.prototype.hasOwnProperty.call(env, upper) && env[upper]) {
    return env[upper];
  }
  const lower = name.toLowerCase();
  if (lower !== name && Object.prototype.hasOwnProperty.call(env, lower) && env[lower]) {
    return env[lower];
  }
  return undefined;
}

function expandWindowsEnvVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(WINDOWS_ENV_VAR_PATTERN, (matched, name: string) => {
    return resolveEnvValue(env, name) ?? matched;
  });
}

export function expandHomePath(
  value: string | undefined,
  options: ExpandHomePathOptions = {},
): string {
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  let expanded = trimmed;
  if (platform === "win32") {
    expanded = expandWindowsEnvVars(expanded, env);
  }

  if (expanded === "~") {
    return path.normalize(homeDir);
  }
  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    const restSegments = expanded.slice(2).split(/[\\/]+/).filter(Boolean);
    return path.normalize(path.join(homeDir, ...restSegments));
  }
  return path.normalize(expanded);
}

export function resolveCodexHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const configured =
    expandHomePath(env[CODEX_HOME_DIR_ENV_KEY], { homeDir, env })
    || expandHomePath(env.CODEX_HOME, { homeDir, env });
  return configured || path.join(homeDir, CODEX_HOME_DIRECTORY_NAME);
}

export function resolveClaudeHomeDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, CLAUDE_HOME_DIRECTORY_NAME);
}

export function resolveOpenCodeHomeDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, OPENCODE_HOME_DIRECTORY_NAME);
}

export function resolveSinitekRuntimeDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, SINITEK_RUNTIME_DIR_NAME);
}

export function resolveAgentsHomeDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, AGENTS_HOME_DIRECTORY_NAME);
}

export function resolveXdgConfigHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const configured = String(env.XDG_CONFIG_HOME ?? "").trim();
  return configured
    ? expandHomePath(configured, { homeDir, env })
    : path.join(homeDir, ".config");
}

export function formatHomeDisplayPath(
  ...posixSegments: string[]
): string {
  if (process.platform === "win32") {
    return path.join(os.homedir(), ...posixSegments);
  }
  return posixSegments.length === 0 ? "~" : `~/${posixSegments.join("/")}`;
}
