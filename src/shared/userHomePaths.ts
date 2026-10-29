import * as os from "os";
import * as path from "path";

export const CODEX_HOME_DIRECTORY_NAME = ".codex";
export const CLAUDE_HOME_DIRECTORY_NAME = ".claude";
export const OPENCODE_HOME_DIRECTORY_NAME = ".opencode";
export const SINITEK_RUNTIME_DIR_NAME = ".sinitek_cli";
export const AGENTS_HOME_DIRECTORY_NAME = ".agents";
export const CODEX_HOME_DIR_ENV_KEY = "CODEX_HOME_DIR";
export const GROK_HOME_DIRECTORY_NAME = ".grok";
export const GROK_HOME_ENV_KEY = "GROK_HOME";
export const DSH_HOME_DIRECTORY_NAME = ".dsh";
export const DSH_HOME_ENV_KEY = "DSH_HOME";
export const KIMI_CODE_HOME_DIRECTORY_NAME = ".kimi-code";
export const ZCODE_HOME_DIRECTORY_NAME = ".zcode";
export const ZCODE_DATA_BASE_ENV_KEY = "ZCODE_DATA_BASE_DIR";
export const KIMI_CODE_HOME_ENV_KEY = "KIMI_CODE_HOME";
export const KIMI_CODE_GLOBAL_SKILLS_DIRECTORY_NAME = "skills";
export const KIMI_CODE_GLOBAL_RULES_FILE_NAME = "AGENTS.md";
export const KIMI_CODE_WORKSPACE_RULES_FILE_NAME = "AGENTS.md";
export const DSH_GLOBAL_SKILLS_DIRECTORY_NAME = "skills";
export const DSH_GLOBAL_RULES_FILE_NAME = "AGENTS.md";
export const DSH_WORKSPACE_RULES_FILE_NAME = "AGENTS.md";

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

export function resolveGrokHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = expandHomePath(env[GROK_HOME_ENV_KEY], { homeDir, env, platform });
  return configured || path.join(homeDir, GROK_HOME_DIRECTORY_NAME);
}

export function resolveDshHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = expandHomePath(env[DSH_HOME_ENV_KEY], { homeDir, env, platform });
  return configured || path.join(homeDir, DSH_HOME_DIRECTORY_NAME);
}

export function resolveDshGlobalSkillsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveDshHomeDir(env, homeDir, platform), DSH_GLOBAL_SKILLS_DIRECTORY_NAME);
}

export function resolveDshGlobalRulesPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveDshHomeDir(env, homeDir, platform), DSH_GLOBAL_RULES_FILE_NAME);
}

export function resolveDshActivePatchPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveDshHomeDir(env, homeDir, platform), "__config", "active-patch.yaml");
}

export function resolveGrokConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveGrokHomeDir(env, homeDir, platform), "config.toml");
}

export function resolveZcodeHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = expandHomePath(env[ZCODE_DATA_BASE_ENV_KEY], { homeDir, env, platform });
  return path.join(configured || homeDir, ZCODE_HOME_DIRECTORY_NAME);
}

export function resolveKimiCodeHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = expandHomePath(env[KIMI_CODE_HOME_ENV_KEY], { homeDir, env, platform });
  return configured || path.join(homeDir, KIMI_CODE_HOME_DIRECTORY_NAME);
}

export function resolveKimiCodeConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveKimiCodeHomeDir(env, homeDir, platform), "config.toml");
}

export function resolveKimiCodeGlobalSkillsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveKimiCodeHomeDir(env, homeDir, platform), KIMI_CODE_GLOBAL_SKILLS_DIRECTORY_NAME);
}

export function resolveZcodeGlobalRulesPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveZcodeHomeDir(env, homeDir, platform), "AGENTS.md");
}

export function resolveKimiCodeGlobalRulesPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(resolveKimiCodeHomeDir(env, homeDir, platform), KIMI_CODE_GLOBAL_RULES_FILE_NAME);
}
