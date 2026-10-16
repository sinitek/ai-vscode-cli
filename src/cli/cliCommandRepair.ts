import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CLI_LIST, CliName } from "./types";
import { getConfiguredCliCommandParts, resolveCliCommand, type ResolvedCliCommand } from "./commandResolution";
import { expandHomePath } from "../shared/userHomePaths";

const REGISTRY_PATH_SEPARATOR = "---SINITEK-PATH---";

export type CliCommandRepairIssue = {
  cli: CliName;
  command: string;
  summary: string;
};

export type CliCommandRepairDependencies = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  readRegistryPath?: () => Promise<string>;
};

export function inspectUnresolvedCliCommands(
  commands: Partial<Record<CliName, string>>,
  platform: NodeJS.Platform = process.platform,
): CliCommandRepairIssue[] {
  return CLI_LIST.flatMap((cli) => {
    const configured = String(commands[cli] ?? cli).trim() || cli;
    const executable = getConfiguredCliCommandParts(configured, cli)[0] ?? cli;
    const resolved = resolveCliCommand(executable);
    if (resolved && isUsableCommandFile(resolved.command, platform)) {
      return [];
    }
    const leaf = path.basename(executable).trim() || cli;
    return [{
      cli,
      command: executable,
      summary: `spawn ${leaf} ENOENT`,
    }];
  });
}

export function buildRepairedCliCommand(
  configuredCommand: string,
  fallbackCommand: string,
  executablePath: string,
): string {
  const parts = getConfiguredCliCommandParts(configuredCommand, fallbackCommand);
  return [quoteCliCommandToken(executablePath), ...parts.slice(1)].join(" ");
}

export type PlannedCliCommandRepair = {
  cli: CliName;
  previousCommand: string;
  nextCommand: string | null;
  status: "repaired" | "not-found";
};

export function shouldAwaitCliCommandAutoRepair(
  cli: CliName,
  commands: Partial<Record<CliName, string>>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return inspectUnresolvedCliCommands(commands, platform).some((issue) => (
    issue.cli === cli && isBareCommandToken(issue.command)
  ));
}

export async function planUnresolvedCliCommandRepairs(
  commands: Partial<Record<CliName, string>>,
  deps: CliCommandRepairDependencies & { onlyBareCommands?: boolean } = {},
): Promise<PlannedCliCommandRepair[]> {
  const platform = deps.platform ?? process.platform;
  const onlyBareCommands = deps.onlyBareCommands === true;
  const issues = inspectUnresolvedCliCommands(commands, platform).filter((issue) => (
    !onlyBareCommands || isBareCommandToken(issue.command)
  ));
  if (issues.length === 0) {
    return [];
  }

  let registryPath = "";
  if (platform === "win32") {
    try {
      registryPath = await (deps.readRegistryPath ?? readWindowsRegistryPathValue)();
    } catch {
      registryPath = "";
    }
  }
  const repairDeps: CliCommandRepairDependencies = {
    platform,
    env: deps.env,
    homeDir: deps.homeDir,
    readRegistryPath: async () => registryPath,
  };
  const plans: PlannedCliCommandRepair[] = [];
  for (const issue of issues) {
    const previousCommand = String(commands[issue.cli] ?? issue.cli).trim() || issue.cli;
    try {
      const executablePath = await locateCliExecutableForRepair(previousCommand, issue.cli, repairDeps);
      if (!executablePath) {
        plans.push({ cli: issue.cli, previousCommand, nextCommand: null, status: "not-found" });
        continue;
      }
      const nextCommand = buildRepairedCliCommand(previousCommand, issue.cli, executablePath);
      if (nextCommand === previousCommand) {
        continue;
      }
      plans.push({ cli: issue.cli, previousCommand, nextCommand, status: "repaired" });
    } catch {
      plans.push({ cli: issue.cli, previousCommand, nextCommand: null, status: "not-found" });
    }
  }
  return plans;
}

let cliCommandAutoRepairTask: Promise<void> = Promise.resolve();

export function beginCliCommandAutoRepair(task: Promise<void>): void {
  cliCommandAutoRepairTask = task.then(() => undefined, () => undefined);
}

export function waitForCliCommandAutoRepair(): Promise<void> {
  return cliCommandAutoRepairTask;
}

export function resetCliCommandAutoRepairForTests(): void {
  cliCommandAutoRepairTask = Promise.resolve();
}

export async function locateCliExecutableForRepair(
  configuredCommand: string,
  fallbackCommand: string,
  deps: CliCommandRepairDependencies = {},
): Promise<string | null> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const homeDir = deps.homeDir ?? os.homedir();
  const registryPath = platform === "win32"
    ? await (deps.readRegistryPath ?? readWindowsRegistryPathValue)()
    : "";
  const directories = uniqueDirectories([
    ...splitPathList(registryPath, platform, env, homeDir),
    ...extendedRepairDirectories(platform, env, homeDir),
  ], platform).filter((directory) => !isSkippedRepairDirectory(directory));
  const names = cliRepairSearchNames(configuredCommand, fallbackCommand);
  return findFirstExecutable(names, directories, platform, env);
}

export async function readWindowsRegistryPathValue(): Promise<string> {
  if (process.platform !== "win32") {
    return "";
  }
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const script = [
    "$u = [Environment]::GetEnvironmentVariable('Path','User')",
    "$m = [Environment]::GetEnvironmentVariable('Path','Machine')",
    "Write-Output $u",
    `Write-Output '${REGISTRY_PATH_SEPARATOR}'`,
    "Write-Output $m",
  ].join("; ");
  return await new Promise((resolve) => {
    execFile(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      timeout: 8000,
      encoding: "utf8",
    }, (error, stdout) => {
      if (error) {
        resolve("");
        return;
      }
      const [userPath = "", machinePath = ""] = String(stdout).split(REGISTRY_PATH_SEPARATOR);
      resolve([userPath.trim(), machinePath.trim()].filter(Boolean).join(";"));
    });
  });
}

function isBareCommandToken(command: string): boolean {
  return !/[\\/]/.test(command);
}

function cliRepairSearchNames(configuredCommand: string, fallbackCommand: string): string[] {
  const executable = getConfiguredCliCommandParts(configuredCommand, fallbackCommand)[0] ?? fallbackCommand;
  const names = new Set<string>();
  const baseName = path.basename(executable).trim();
  if (baseName) {
    names.add(baseName);
    const extension = path.extname(baseName);
    if (extension) {
      const stem = path.basename(baseName, extension).trim();
      if (stem) {
        names.add(stem);
      }
    }
  }
  const fallback = fallbackCommand.trim();
  if (fallback) {
    names.add(fallback);
  }
  return Array.from(names);
}

function extendedRepairDirectories(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string[] {
  if (platform !== "win32") {
    return [
      path.join(homeDir, ".local", "bin"),
      path.join(homeDir, ".npm-global", "bin"),
      path.join(homeDir, ".bun", "bin"),
      path.join(homeDir, ".volta", "bin"),
      env.PNPM_HOME ? expandHomePath(env.PNPM_HOME, { env, platform, homeDir }) : "",
    ].filter(Boolean);
  }
  const userProfile = expandHomePath(env.USERPROFILE, { env, platform, homeDir }) || homeDir;
  const localAppData = expandHomePath(env.LOCALAPPDATA, { env, platform, homeDir })
    || path.join(userProfile, "AppData", "Local");
  const appData = expandHomePath(env.APPDATA, { env, platform, homeDir })
    || path.join(userProfile, "AppData", "Roaming");
  const programFiles = expandHomePath(env.ProgramFiles, { env, platform, homeDir })
    || path.join(path.parse(userProfile).root, "Program Files");
  return [
    path.join(localAppData, "Programs", "OpenAI", "Codex", "bin"),
    path.join(localAppData, "OpenAI", "Codex", "bin"),
    path.join(userProfile, ".codex", "bin"),
    path.join(userProfile, ".local", "bin"),
    path.join(userProfile, ".bun", "bin"),
    path.join(userProfile, ".volta", "bin"),
    path.join(userProfile, "scoop", "shims"),
    path.join(appData, "npm"),
    path.join(localAppData, "npm"),
    path.join(localAppData, "pnpm"),
    path.join(localAppData, "fnm"),
    path.join(localAppData, "Microsoft", "WinGet", "Links"),
    path.join(programFiles, "nodejs"),
    env.PNPM_HOME ? expandHomePath(env.PNPM_HOME, { env, platform, homeDir }) : "",
    env.SCOOP ? path.join(expandHomePath(env.SCOOP, { env, platform, homeDir }), "shims") : "",
  ].filter(Boolean);
}

function splitPathList(
  value: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string[] {
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  return value
    .split(delimiter)
    .map((entry) => expandHomePath(entry, { env, platform, homeDir }).trim())
    .filter(Boolean);
}

function findFirstExecutable(
  names: string[],
  directories: string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | null {
  for (const directory of directories) {
    for (const name of names) {
      for (const candidateName of commandCandidateNames(name, platform, env)) {
        const candidate = path.join(directory, candidateName);
        if (isUsableCommandFile(candidate, platform)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

function commandCandidateNames(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform !== "win32" || path.extname(command)) {
    return [command];
  }
  return [...windowsPathExtensions(env).map((extension) => `${command}${extension}`), command];
}

function windowsPathExtensions(env: NodeJS.ProcessEnv): string[] {
  const pathExt = env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
  return pathExt
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

function isUsableCommandFile(targetPath: string, platform: NodeJS.Platform): boolean {
  if (isSkippedRepairDirectory(path.dirname(targetPath))) {
    return false;
  }
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      return false;
    }
    return platform !== "win32" || stat.size > 0;
  } catch {
    return false;
  }
}

function isSkippedRepairDirectory(directory: string): boolean {
  const normalized = directory.replace(/[\\/]+/g, "/").replace(/\/+$/g, "").toLowerCase();
  return normalized.endsWith("/windowsapps");
}

function uniqueDirectories(directories: string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const directory of directories) {
    const trimmed = directory.trim();
    if (!trimmed) {
      continue;
    }
    const key = platform === "win32" ? trimmed.replace(/\//g, "\\").toLowerCase() : trimmed;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function quoteCliCommandToken(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function inspectGrokCommandResolution(
  command: string,
): { ok: true; command: string; resolvedFrom: ResolvedCliCommand["resolvedFrom"] }
  | { ok: false; reason: "empty" | "enoent"; summary: string } {
  if (!command.trim()) {
    return { ok: false, reason: "empty", summary: "spawn grok ENOENT" };
  }
  const executable = getConfiguredCliCommandParts(command, "grok")[0] ?? "grok";
  const resolved = resolveCliCommand(executable);
  if (!resolved) {
    const leaf = path.basename(executable).trim() || "grok";
    return { ok: false, reason: "enoent", summary: `spawn ${leaf} ENOENT` };
  }
  return { ok: true, command: resolved.command, resolvedFrom: resolved.resolvedFrom };
}
