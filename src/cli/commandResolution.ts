import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expandHomePath } from "../shared/userHomePaths";

export type ResolvedCliCommand = {
  command: string;
  resolvedFrom: "config" | "path" | "windows-npm-bin" | "unix-user-bin";
};

export type CommandResolutionContext = { cwd?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform };

export function splitConfiguredCliCommand(command: string): string[] {
  const parts = command.trim().match(/(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+)/g) ?? [];
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

export function getConfiguredCliCommandParts(command: string, fallbackCommand: string): string[] {
  const parts = splitConfiguredCliCommand(command);
  return parts.length > 0 ? parts : [fallbackCommand];
}

function isPathLikeCommand(command: string, platform: NodeJS.Platform): boolean {
  return command.includes(path.sep) || (platform === "win32" && command.includes("/"));
}

function fileExists(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExistingCommandPath(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const candidates = platform === "win32"
    ? getWindowsCommandCandidates(command, env, "allow-bare")
    : [command];
  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function getWindowsCommandCandidates(
  command: string,
  env: NodeJS.ProcessEnv,
  bareFallback: "allow-bare" | "omit-bare",
): string[] {
  if (path.extname(command)) {
    return [command];
  }
  const pathext = env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
  const candidates = pathext
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => `${command}${entry.startsWith(".") ? entry : `.${entry}`}`);
  if (bareFallback === "allow-bare") {
    candidates.push(command);
  }
  return candidates;
}

function resolveCommandInDirs(command: string, dirs: string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const filteredDirs = dirs
    .map((entry) => entry.trim())
    .filter(Boolean);

  const candidates = platform === "win32"
    ? getWindowsCommandCandidates(command, env, "omit-bare")
    : [command];
  for (const dir of filteredDirs) {
    for (const candidateName of candidates) {
      const candidate = path.join(dir, candidateName);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function resolveCommandOnPath(command: string, env: NodeJS.ProcessEnv, cwd: string | undefined, platform: NodeJS.Platform): string | null {
  const envPath = env.PATH ?? env.Path ?? "";
  const pathDirs = envPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return resolveCommandInDirs(command, pathDirs.map((dir) => cwd ? path.resolve(cwd, dir) : dir), env, platform);
}

function getWindowsUserBinDirs(env: NodeJS.ProcessEnv, homeDir: string): string[] {
  const dirs = new Set<string>();
  const appData = expandHomePath(env.APPDATA, { env, homeDir });
  const userProfile = expandHomePath(env.USERPROFILE, { env, homeDir });
  const localAppData = expandHomePath(
    env.LOCALAPPDATA || (userProfile ? path.join(userProfile, "AppData", "Local") : ""), { env, homeDir },
  );
  if (appData) {
    dirs.add(path.join(appData, "npm"));
  }
  if (userProfile) {
    dirs.add(path.join(userProfile, "AppData", "Roaming", "npm"));
  }
  if (localAppData) {
    dirs.add(path.join(localAppData, "Programs", "OpenAI", "Codex", "bin"));
    dirs.add(path.join(localAppData, "npm"));
    dirs.add(path.join(localAppData, "Microsoft", "WinGet", "Links"));
  }
  if (userProfile) {
    dirs.add(path.join(userProfile, ".local", "bin"));
    dirs.add(path.join(userProfile, "scoop", "shims"));
    dirs.add(path.join(userProfile, ".volta", "bin"));
  }
  if (env.PNPM_HOME) {
    dirs.add(expandHomePath(env.PNPM_HOME, { env, homeDir }));
  }
  if (env.SCOOP) {
    dirs.add(path.join(expandHomePath(env.SCOOP, { env, homeDir }), "shims"));
  }
  return Array.from(dirs).filter(Boolean);
}

function getUnixUserBinDirs(env: NodeJS.ProcessEnv, homeDir: string): string[] {
  const dirs = new Set<string>();

  if (env.npm_config_prefix) {
    dirs.add(path.join(expandHomePath(env.npm_config_prefix, { env, homeDir }), "bin"));
  }
  if (env.NPM_CONFIG_PREFIX) {
    dirs.add(path.join(expandHomePath(env.NPM_CONFIG_PREFIX, { env, homeDir }), "bin"));
  }
  if (env.PNPM_HOME) {
    dirs.add(expandHomePath(env.PNPM_HOME, { env, homeDir }));
  }
  if (homeDir) {
    dirs.add(path.join(homeDir, ".npm-global", "bin"));
    dirs.add(path.join(homeDir, ".local", "bin"));
  }

  return Array.from(dirs);
}

export function normalizeCommandInput(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function resolveCliCommand(
  command: string,
  context: CommandResolutionContext = {},
): ResolvedCliCommand | null {
  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  const contextualHome = platform === "win32" ? (env.USERPROFILE || env.HOME) : (env.HOME || env.USERPROFILE);
  const homeDir = context.env ? (contextualHome || os.homedir()) : os.homedir();
  const normalized = expandHomePath(normalizeCommandInput(command), { env, homeDir, platform });
  const looksLikePath = isPathLikeCommand(normalized, platform);
  if (path.isAbsolute(normalized) || looksLikePath) {
    const resolved = resolveExistingCommandPath(context.cwd ? path.resolve(context.cwd, normalized) : normalized, env, platform);
    return resolved ? { command: resolved, resolvedFrom: "config" } : null;
  }

  if (platform === "win32") {
    const resolvedFromNpmBin = resolveCommandInDirs(normalized, getWindowsUserBinDirs(env, homeDir), env, platform);
    if (resolvedFromNpmBin) {
      return { command: resolvedFromNpmBin, resolvedFrom: "windows-npm-bin" };
    }
  } else {
    const resolvedFromUserBin = resolveCommandInDirs(normalized, getUnixUserBinDirs(env, homeDir), env, platform);
    if (resolvedFromUserBin) {
      return { command: resolvedFromUserBin, resolvedFrom: "unix-user-bin" };
    }
  }

  const resolvedFromPath = resolveCommandOnPath(normalized, env, context.cwd, platform);
  if (resolvedFromPath) {
    return { command: resolvedFromPath, resolvedFrom: "path" };
  }

  return null;
}
