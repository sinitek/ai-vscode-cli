import * as vscode from "vscode";
import { type ChildProcess } from "child_process";
import { spawn } from "cross-spawn";
import { CliName, MacTaskShell, ThinkingMode } from "./types";
import { getCliCommand, getMacTaskShell } from "./config";
import { normalizeCommandInput, resolveCliCommand, splitConfiguredCliCommand } from "./commandResolution";
import { applyOpenCodeVariantArg, buildCliArgs } from "./cliRunArgStrategies";
import { createOpenCodeRuntimeConfigOverlay } from "./opencoderuntimeconfig";
import {
  extractOpenCodeRuntimeMessageIds,
  extractOpenCodeRuntimeSessionId,
  parseOpenCodeExportStdout,
  parseOpenCodeRunOutput,
  type OpenCodeRunOutput,
} from "./openCodeRunOutput";

export { resolveCliCommand } from "./commandResolution";
export type { ResolvedCliCommand } from "./commandResolution";
export { applyOpenCodeVariantArg, buildCliArgs };
export {
  OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES,
  buildOpenCodeRunFailureMessage,
  createOpenCodeStreamActivityTracker,
  detectOpenCodeStreamActivity,
  extractOpenCodePrintLogErrorText,
  extractOpenCodeRuntimeMessageIds,
  extractOpenCodeRuntimeSessionId,
  isOpenCodePlaceholderText,
  parseOpenCodeExportStdout,
  parseOpenCodeRunOutput,
  parseOpenCodeSessionId,
  parseOpenCodeVisibleStreamEvents,
} from "./openCodeRunOutput";
export type {
  OpenCodeFailureMessageOptions,
  OpenCodeRunOutput,
  OpenCodeStreamActivity,
  OpenCodeStreamActivityTracker,
  OpenCodeVisibleStreamEvent,
} from "./openCodeRunOutput";

type RunCliOptions = {
  thinkingMode?: ThinkingMode;
  isolateProjectInstructions?: boolean;
  openCodeVariant?: string | null;
  model?: string | null;
  openCodeSmallModel?: string | null;
  openCodeSmallVariant?: string | null;
  openCodeConfigContent?: string | null;
  imagePaths?: string[];
  envOverrides?: Record<string, string>;
  openCodeServerUrl?: string;
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
  const commandParts = splitConfiguredCliCommand(command);
  const normalized = commandParts[0] ?? normalizeCommandInput(command);
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
  const commandParts = splitConfiguredCliCommand(command);
  const commandExecutable = commandParts[0] ?? command;
  const configuredArgs = commandParts.slice(1);
  const fullArgs = buildCliArgs(cli, options);
  const terminalEnv = options.envOverrides ? { ...process.env, ...options.envOverrides } : process.env;
  const resolved = resolveCliCommand(commandExecutable);

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
    env: terminalEnv,
  });

  const joinedArgs = [...configuredArgs, ...fullArgs].map((arg) => escapeShellArg(arg)).join(" ");
  const commandLine = `${resolved?.command ?? commandExecutable} ${joinedArgs}`.trim();

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

export const OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS = 15 * 1000;

export async function recoverOpenCodeMissingAssistantOutput(options: {
  stdout: string;
  stderr: string;
  cwd?: string;
  exportSession?: (sessionId: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
}): Promise<OpenCodeRunOutput> {
  const parsed = parseOpenCodeRunOutput(options.stdout, options.stderr);
  if (parsed.hasStructuredFinalAnswer && parsed.finalText?.trim()) {
    return parsed;
  }
  const sessionId = extractOpenCodeRuntimeSessionId(`${options.stdout}\n${options.stderr}`);
  if (!sessionId || !/^ses_[A-Za-z0-9]+$/u.test(sessionId)) {
    return parsed;
  }
  try {
    const exported = options.exportSession
      ? await options.exportSession(sessionId)
      : await captureCliOutput(getCliCommand("opencode"), ["export", sessionId], {
          cwd: options.cwd,
          timeoutMs: OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS,
        });
    if (exported.exitCode !== 0) {
      return parsed;
    }
    const recovered = parseOpenCodeExportStdout(
      exported.stdout,
      extractOpenCodeRuntimeMessageIds(`${options.stdout}\n${options.stderr}`),
    );
    if (!recovered?.hasStructuredFinalAnswer || !recovered.finalText?.trim()) {
      return parsed;
    }
    return {
      finalText: recovered.finalText,
      errorText: null,
      statusText: parsed.statusText,
      hasStructuredFinalAnswer: true,
    };
  } catch {
    return parsed;
  }
}

export function buildProcessLabel(cli: CliName, sessionId?: string | null): string {
  const suffix = sessionId ? sessionId : "new";
  return `${PROCESS_LABEL_PREFIX}-${cli}/${suffix}`;
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
  const commandParts = splitConfiguredCliCommand(command);
  const commandExecutable = commandParts[0] ?? command;
  const configuredArgs = commandParts.slice(1);
  const fullArgs = [...configuredArgs, ...args];
  const resolved = resolveCliCommand(commandExecutable);
  if (resolved) {
    return {
      commandToSpawn: resolved.command,
      argsToSpawn: fullArgs,
      resolvedCommand: resolved.command,
    };
  }

  if (process.platform !== "darwin") {
    return null;
  }

  const macTaskShell = getMacTaskShell();
  return {
    commandToSpawn: resolveMacTaskShellExecutable(macTaskShell),
    argsToSpawn: ["-lc", buildShellCommandLine(commandExecutable, fullArgs)],
    resolvedCommand: commandExecutable,
  };
}

function buildSpawnEnvironment(
  cwd: string | undefined,
  envOverrides?: Record<string, string>,
  runtimeEnvOverrides?: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(envOverrides ?? {}),
    ...(runtimeEnvOverrides ?? {}),
  };
  if (cwd) {
    env.PWD = cwd;
  }
  return env;
}

function createOpenCodeRuntimeOverlayForOptions(options: RunCliOptions) {
  return options.openCodeConfigContent && options.model
    ? createOpenCodeRuntimeConfigOverlay({
        configContent: options.openCodeConfigContent,
        primaryModel: options.model,
        smallModel: options.openCodeSmallModel ?? null,
        primaryVariant: options.openCodeVariant ?? null,
        smallVariant: options.openCodeSmallVariant ?? null,
      })
    : null;
}

export function startOpenCodeServer(
  port: number,
  handlers: Partial<StreamHandlers> = {},
  options: RunStreamOptions = {},
): RunProcess {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    const error = new Error(`invalid-opencode-server-port:${port}`);
    handlers.onError?.(error);
    handlers.onExit?.(1);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }

  const configuredCommand = getCliCommand("opencode");
  const runtimeOverlay = createOpenCodeRuntimeOverlayForOptions(options);
  if (runtimeOverlay && (!runtimeOverlay.ok || !runtimeOverlay.overlay)) {
    const error = new Error(runtimeOverlay.issues.map((issue) => issue.message).join("\n"));
    handlers.onError?.(error);
    handlers.onExit?.(1);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }
  const overlay = runtimeOverlay?.overlay ?? null;
  const args = [
    "serve",
    ...(options.isolateProjectInstructions ? ["--pure"] : []),
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ];
  const spawnCommand = resolveSpawnCommand(configuredCommand, args);
  if (!spawnCommand) {
    overlay?.cleanup();
    const error = new Error(`spawn ${configuredCommand} ENOENT`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    handlers.onError?.(error);
    handlers.onExit?.(127);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }

  const child = spawn(spawnCommand.commandToSpawn, spawnCommand.argsToSpawn, {
    cwd: options.cwd,
    env: buildSpawnEnvironment(options.cwd, options.envOverrides, overlay?.envOverrides),
    argv0: options.processLabel,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (data) => handlers.onStdout?.(data));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (data) => handlers.onStderr?.(data));
  child.on("error", (error) => {
    overlay?.cleanup();
    handlers.onError?.(error);
  });
  child.on("close", (code) => {
    overlay?.cleanup();
    handlers.onExit?.(code);
  });

  return {
    pid: child.pid,
    resolvedCommand: spawnCommand.resolvedCommand,
    kill: (signal) => killProcessTree(child, signal),
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
  const runtimeOverlay = cli === "opencode"
    ? createOpenCodeRuntimeOverlayForOptions(options)
    : null;
  if (runtimeOverlay && (!runtimeOverlay.ok || !runtimeOverlay.overlay)) {
    const error = new Error(runtimeOverlay.issues.map((issue) => issue.message).join("\n"));
    handlers.onError(error);
    handlers.onExit(1);
    return {
      pid: undefined,
      resolvedCommand: undefined,
      kill: () => false,
    };
  }
  const overlay = runtimeOverlay?.overlay ?? null;
  const spawnCommand = resolveSpawnCommand(configuredCommand, fullArgs);
  if (!spawnCommand) {
    overlay?.cleanup();
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
    env: buildSpawnEnvironment(options.cwd, options.envOverrides, overlay?.envOverrides),
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
    overlay?.cleanup();
    handlers.onError(error);
  });

  child.on("close", (code) => {
    overlay?.cleanup();
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
      env: buildSpawnEnvironment(options.cwd),
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
