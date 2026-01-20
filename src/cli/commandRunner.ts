import * as vscode from "vscode";
import { type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "cross-spawn";
import { CliName, ThinkingMode } from "./types";
import { getCliArgs, getCliCommand, getThinkingArgs } from "./config";

type RunCliOptions = {
  thinkingMode?: ThinkingMode;
};

const PROCESS_LABEL_PREFIX = "sinitek-ai-vscode-cli";
const LOCAL_SESSION_PREFIX = "local_";
const KILL_GRACE_MS = 2000;

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }

  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

type ResolvedCliCommand = {
  command: string;
  resolvedFrom: "config" | "path" | "windows-npm-bin";
};

function fileExists(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExistingCommandPath(command: string): string | null {
  if (fileExists(command)) {
    return command;
  }
  if (process.platform !== "win32") {
    return null;
  }
  if (path.extname(command)) {
    return null;
  }
  const exts = getWindowsPathExts();
  for (const ext of exts) {
    const candidate = `${command}${ext}`;
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getWindowsPathExts(): string[] {
  const pathext = process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
  return pathext
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

function resolveCommandOnPath(command: string, extraDirs: string[] = []): string | null {
  const envPath = process.env.PATH ?? process.env.Path ?? "";
  const pathDirs = envPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const dirs = [...extraDirs, ...pathDirs];

  if (process.platform === "win32") {
    const hasExt = Boolean(path.extname(command));
    const exts = hasExt ? [""] : getWindowsPathExts();
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, hasExt ? command : `${command}${ext}`);
        if (fileExists(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
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

function resolveCliCommand(command: string): ResolvedCliCommand | null {
  const looksLikePath = command.includes(path.sep) || (process.platform === "win32" && command.includes("/"));
  if (path.isAbsolute(command) || looksLikePath) {
    const resolved = resolveExistingCommandPath(command);
    return resolved ? { command: resolved, resolvedFrom: "config" } : null;
  }

  if (process.platform === "win32") {
    const resolvedFromNpmBin = resolveCommandOnPath(command, getWindowsNpmBinDirs());
    if (resolvedFromNpmBin) {
      return { command: resolvedFromNpmBin, resolvedFrom: "windows-npm-bin" };
    }
  }

  const resolvedFromPath = resolveCommandOnPath(command);
  if (resolvedFromPath) {
    return { command: resolvedFromPath, resolvedFrom: "path" };
  }

  return null;
}

export async function runCli(cli: CliName, options: RunCliOptions = {}): Promise<void> {
  const command = getCliCommand(cli);
  const baseArgs = getCliArgs(cli);
  const thinkingArgs = options.thinkingMode
    ? getThinkingArgs(cli, options.thinkingMode)
    : [];

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
  });

  const fullArgs = [...baseArgs, ...thinkingArgs];
  const joinedArgs = fullArgs.map((arg) => escapeShellArg(arg)).join(" ");
  const commandLine = `${command} ${joinedArgs}`.trim();

  terminal.sendText(commandLine);
}

type StreamHandlers = {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onExit: (code: number | null) => void;
  onError: (error: Error) => void;
};

type RunStreamOptions = RunCliOptions & {
  cwd?: string;
  sessionId?: string | null;
  processLabel?: string;
};

export type RunProcess = {
  pid?: number;
  resolvedCommand?: string;
  kill: (signal?: NodeJS.Signals | number) => boolean | void;
};

export function buildCliArgs(
  cli: CliName,
  options: RunStreamOptions = {},
  prompt?: string
): string[] {
  const baseArgs = getCliArgs(cli);
  const thinkingArgs = options.thinkingMode
    ? getThinkingArgs(cli, options.thinkingMode)
    : [];
  const sessionId = options.sessionId ?? null;
  let sharedArgs = [...baseArgs, ...thinkingArgs];
  if (cli === "codex" && !sharedArgs.includes("--skip-git-repo-check")) {
    sharedArgs = [...sharedArgs, "--skip-git-repo-check"];
  }

  if (prompt === undefined || prompt === "") {
    return sharedArgs;
  }

  if (sessionId) {
    return buildSessionArgs(cli, sharedArgs, sessionId, prompt);
  }

  return buildPromptArgs(cli, sharedArgs, prompt);
}

export function buildProcessLabel(cli: CliName, sessionId?: string | null): string {
  const suffix = sessionId ? sessionId : "new";
  return `${PROCESS_LABEL_PREFIX}-${cli}/${suffix}`;
}

function buildSessionArgs(
  cli: CliName,
  sharedArgs: string[],
  sessionId: string,
  prompt: string
): string[] {
  switch (cli) {
    case "codex":
      return ["exec", ...sharedArgs, "resume", sessionId, prompt];
    case "gemini":
      if (sessionId.startsWith(LOCAL_SESSION_PREFIX)) {
        return [...sharedArgs, prompt];
      }
      return [...sharedArgs, "--resume", sessionId, prompt];
    case "claude":
      return [...ensureClaudePrintArgs(sharedArgs), "--resume", sessionId, prompt];
    default:
      return [...sharedArgs, prompt];
  }
}

function buildPromptArgs(cli: CliName, sharedArgs: string[], prompt: string): string[] {
  if (cli === "codex") {
    return ["exec", ...sharedArgs, prompt];
  }
  if (cli === "claude") {
    return [...ensureClaudePrintArgs(sharedArgs), prompt];
  }
  return [...sharedArgs, prompt];
}

function ensureClaudePrintArgs(sharedArgs: string[]): string[] {
  const args = [...sharedArgs];
  const hasPrint = args.includes("--print") || args.includes("-p");
  if (!hasPrint) {
    args.push("--print");
  }
  const outputFormatIndex = args.findIndex((arg) => arg === "--output-format" || arg === "-o");
  const defaultOutputFormat = "stream-json";
  if (outputFormatIndex === -1) {
    args.push("--output-format", defaultOutputFormat);
  } else if (args.length > outputFormatIndex + 1) {
    args[outputFormatIndex + 1] = defaultOutputFormat;
  } else {
    args.push(defaultOutputFormat);
  }
  const outputFormat = args[outputFormatIndex === -1 ? args.length - 1 : outputFormatIndex + 1];
  const hasIncludePartial = args.includes("--include-partial-messages");
  if (outputFormat === "stream-json" && !hasIncludePartial) {
    args.push("--include-partial-messages");
  }
  if (outputFormat === "stream-json" && !args.includes("--verbose")) {
    args.push("--verbose");
  }
  return args;
}

export function runCliStream(
  cli: CliName,
  prompt: string,
  handlers: StreamHandlers,
  options: RunStreamOptions = {}
): RunProcess {
  const configuredCommand = getCliCommand(cli);
  const resolved = resolveCliCommand(configuredCommand);
  if (!resolved) {
    const error = new Error(`spawn ${configuredCommand} ENOENT`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    handlers.onError(error);
    handlers.onExit(127);
    return {
      pid: undefined,
      resolvedCommand: undefined,
      kill: () => false,
    };
  }
  const fullArgs = buildCliArgs(cli, options, prompt);
  const processLabel = options.processLabel;
  const child = spawn(resolved.command, fullArgs, {
    cwd: options.cwd,
    env: process.env,
    argv0: processLabel,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (cli === "codex") {
    try {
      child.stdin?.write("\n");
    } finally {
      child.stdin?.end();
    }
  } else {
    child.stdin?.end();
  }

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (data) => {
    handlers.onStdout(data);
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (data) => {
    handlers.onStderr(data);
  });

  child.on("error", (error) => {
    handlers.onError(error);
  });

  child.on("close", (code) => {
    handlers.onExit(code);
  });

  return {
    pid: child.pid,
    resolvedCommand: resolved.command,
    kill: (signal) => killProcessTree(child, signal),
  };
}

function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals | number = "SIGTERM"
): boolean {
  if (!child.pid) {
    return false;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return true;
  }
  const pid = child.pid;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    try {
      child.kill(signal);
    } catch (innerError) {
      return false;
    }
  }
  if (signal === "SIGTERM") {
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        try {
          child.kill("SIGKILL");
        } catch (innerError) {
          return;
        }
      }
    }, KILL_GRACE_MS);
  }
  return true;
}
