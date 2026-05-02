import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type ResolvedCliCommand = {
  command: string;
  resolvedFrom: "config" | "path" | "windows-npm-bin" | "unix-user-bin";
};

function isPathLikeCommand(command: string): boolean {
  return command.includes(path.sep) || (process.platform === "win32" && command.includes("/"));
}

function fileExists(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExistingCommandPath(command: string): string | null {
  if (process.platform === "win32" && !path.extname(command)) {
    const exts = getWindowsPathExts();
    for (const ext of exts) {
      const candidate = `${command}${ext}`;
      if (fileExists(candidate)) {
        return candidate;
      }
    }
    return fileExists(command) ? command : null;
  }
  return fileExists(command) ? command : null;
}

function getWindowsPathExts(): string[] {
  const pathext = process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
  return pathext
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

function resolveCommandInDirs(command: string, dirs: string[]): string | null {
  const filteredDirs = dirs
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (process.platform === "win32") {
    const hasExt = Boolean(path.extname(command));
    const exts = hasExt ? [""] : getWindowsPathExts();
    for (const dir of filteredDirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, hasExt ? command : `${command}${ext}`);
        if (fileExists(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  for (const dir of filteredDirs) {
    const candidate = path.join(dir, command);
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveCommandOnPath(command: string, extraDirs: string[] = []): string | null {
  const envPath = process.env.PATH ?? process.env.Path ?? "";
  const pathDirs = envPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return resolveCommandInDirs(command, [...extraDirs, ...pathDirs]);
}

function getWindowsNpmBinDirs(): string[] {
  const dirs = new Set<string>();
  if (process.env.APPDATA) {
    dirs.add(path.join(process.env.APPDATA, "npm"));
  }
  if (process.env.USERPROFILE) {
    dirs.add(path.join(process.env.USERPROFILE, "AppData", "Roaming", "npm"));
  }
  if (process.env.PNPM_HOME) {
    dirs.add(process.env.PNPM_HOME);
  }
  return Array.from(dirs);
}

function getUnixUserBinDirs(): string[] {
  const dirs = new Set<string>();
  const homeDir = os.homedir();

  if (process.env.npm_config_prefix) {
    dirs.add(path.join(process.env.npm_config_prefix, "bin"));
  }
  if (process.env.NPM_CONFIG_PREFIX) {
    dirs.add(path.join(process.env.NPM_CONFIG_PREFIX, "bin"));
  }
  if (process.env.PNPM_HOME) {
    dirs.add(process.env.PNPM_HOME);
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

export function resolveCliCommand(command: string): ResolvedCliCommand | null {
  const normalized = normalizeCommandInput(command);
  const looksLikePath = isPathLikeCommand(normalized);
  if (path.isAbsolute(normalized) || looksLikePath) {
    const resolved = resolveExistingCommandPath(normalized);
    return resolved ? { command: resolved, resolvedFrom: "config" } : null;
  }

  if (process.platform === "win32") {
    const resolvedFromNpmBin = resolveCommandInDirs(normalized, getWindowsNpmBinDirs());
    if (resolvedFromNpmBin) {
      return { command: resolvedFromNpmBin, resolvedFrom: "windows-npm-bin" };
    }
  } else {
    const resolvedFromUserBin = resolveCommandInDirs(normalized, getUnixUserBinDirs());
    if (resolvedFromUserBin) {
      return { command: resolvedFromUserBin, resolvedFrom: "unix-user-bin" };
    }
  }

  const resolvedFromPath = resolveCommandOnPath(normalized);
  if (resolvedFromPath) {
    return { command: resolvedFromPath, resolvedFrom: "path" };
  }

  return null;
}
