import * as vscode from "vscode";
import { type ChildProcess } from "child_process";
import { spawn } from "cross-spawn";
import { CliName, MacTaskShell, ThinkingMode } from "./types";
import { getCliArgs, getCliCommand, getMacTaskShell, getThinkingArgs } from "./config";
import { applyModelArg } from "./modelArgs";
import { ensureGeminiHeadlessArgs } from "./geminiStreamJson";
import { normalizeCommandInput, resolveCliCommand } from "./commandResolution";

export { resolveCliCommand } from "./commandResolution";
export type { ResolvedCliCommand } from "./commandResolution";

type RunCliOptions = {
  thinkingMode?: ThinkingMode;
  model?: string | null;
  imagePaths?: string[];
  envOverrides?: Record<string, string>;
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

function checkCommandAvailableOnMacShell(command: string, shell: MacTaskShell): Promise<boolean> {
  return new Promise((resolve) => {
    const shellPath = resolveMacTaskShellExecutable(shell);
    const commandLine = `command -v ${escapeShellArg(command)} >/dev/null 2>&1`;
    const child = spawn(shellPath, ["-lc", commandLine], {
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {
      resolve(false);
    });
    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

export async function isCliCommandAvailable(command: string): Promise<boolean> {
  const normalized = normalizeCommandInput(command);
  if (!normalized) {
    return false;
  }

  if (resolveCliCommand(normalized)) {
    return true;
  }

  if (process.platform !== "darwin") {
    return false;
  }

  return checkCommandAvailableOnMacShell(normalized, getMacTaskShell());
}

export async function runCli(cli: CliName, options: RunCliOptions = {}): Promise<void> {
  const command = getCliCommand(cli);
  const fullArgs = buildCliArgs(cli, options);
  const terminalEnv = options.envOverrides ? { ...process.env, ...options.envOverrides } : process.env;
  const resolved = resolveCliCommand(command);

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
    env: terminalEnv,
  });

  const joinedArgs = fullArgs.map((arg) => escapeShellArg(arg)).join(" ");
  const commandLine = `${resolved?.command ?? command} ${joinedArgs}`.trim();

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

export type CapturedCliOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  resolvedCommand?: string;
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
  let sharedArgs = applyModelArg(cli, [...baseArgs, ...thinkingArgs], options.model);
  if (cli === "codex" && !sharedArgs.includes("--skip-git-repo-check")) {
    sharedArgs = [...sharedArgs, "--skip-git-repo-check"];
  }
  if (cli === "codex" && Array.isArray(options.imagePaths) && options.imagePaths.length) {
    const normalizedImagePaths = options.imagePaths
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (normalizedImagePaths.length) {
      sharedArgs = [
        ...sharedArgs,
        ...normalizedImagePaths.flatMap((imagePath) => ["--image", imagePath]),
      ];
    }
  }

  if (cli === "gemini") {
    const sessionArgs = sessionId && !sessionId.startsWith(LOCAL_SESSION_PREFIX)
      ? [...sharedArgs, "--resume", sessionId]
      : sharedArgs;
    return ensureGeminiHeadlessArgs(sessionArgs, prompt);
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
  if (cli === "gemini" && !sessionId.startsWith(LOCAL_SESSION_PREFIX)) {
    return [...sharedArgs, "--resume", sessionId, prompt];
  }
  return [...sharedArgs, prompt];
}

function buildPromptArgs(_cli: CliName, sharedArgs: string[], prompt: string): string[] {
  return [...sharedArgs, prompt];
}

function buildShellCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((segment) => escapeShellArg(segment)).join(" ");
}

function resolveMacTaskShellExecutable(shell: MacTaskShell): string {
  return shell === "bash" ? "/bin/bash" : "/bin/zsh";
}

function resolveSpawnCommand(command: string, args: string[]): {
  commandToSpawn: string;
  argsToSpawn: string[];
  resolvedCommand: string;
} | null {
  const resolved = resolveCliCommand(command);
  if (resolved) {
    return {
      commandToSpawn: resolved.command,
      argsToSpawn: args,
      resolvedCommand: resolved.command,
    };
  }

  if (process.platform !== "darwin") {
    return null;
  }

  const macTaskShell = getMacTaskShell();
  return {
    commandToSpawn: resolveMacTaskShellExecutable(macTaskShell),
    argsToSpawn: ["-lc", buildShellCommandLine(command, args)],
    resolvedCommand: command,
  };
}

export function runCliStream(
  cli: CliName,
  prompt: string,
  handlers: StreamHandlers,
  options: RunStreamOptions = {}
): RunProcess {
  const configuredCommand = getCliCommand(cli);
  const fullArgs = buildCliArgs(cli, options, prompt);
  const processLabel = options.processLabel;
  const spawnCommand = resolveSpawnCommand(configuredCommand, fullArgs);
  if (!spawnCommand) {
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

  const child = spawn(spawnCommand.commandToSpawn, spawnCommand.argsToSpawn, {
    cwd: options.cwd,
    env: options.envOverrides ? { ...process.env, ...options.envOverrides } : process.env,
    argv0: processLabel,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end();

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
    resolvedCommand: spawnCommand.resolvedCommand,
    kill: (signal) => killProcessTree(child, signal),
  };
}

export function captureCliOutput(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<CapturedCliOutput> {
  return new Promise((resolve, reject) => {
    const spawnCommand = resolveSpawnCommand(command, args);
    if (!spawnCommand) {
      const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      reject(error);
      return;
    }

    const child = spawn(spawnCommand.commandToSpawn, spawnCommand.argsToSpawn, {
      cwd: options.cwd,
      env: process.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const finishResolve = (payload: CapturedCliOutput): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve(payload);
    };

    const finishReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finishReject(error);
    });

    child.on("close", (code) => {
      finishResolve({
          stdout,
          stderr,
          exitCode: code,
          resolvedCommand: spawnCommand.resolvedCommand,
        });
      });

    const timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 0;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        killProcessTree(child, "SIGTERM");
        finishReject(new Error(`capture-cli-output-timeout:${timeoutMs}`));
      }, timeoutMs);
    }
  });
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
