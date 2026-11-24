import { spawn } from "cross-spawn";
import { resolveCliCommand } from "./commandResolution";
import { isLoginShellCommand, resolveChildArgv0, stripNvmIncompatibleEnv } from "./processArgv";
import { observeChildProcessLifecycle, type ProcessLifecycleEvidence } from "./processLifecycle";
import { createProcessTerminationController } from "./processTermination";
import type { CleanupResult } from "../runtime/departmentexecutionidentity";

export type CliProcessRuntimeOverlay = {
  envOverrides: Record<string, string>;
  cleanup: () => CleanupResult;
};

export type CliProcessRuntimeLaunch = {
  command: string;
  args: string[];
  cwd?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  envOverrides?: Record<string, string>;
  processLabel?: string;
  macTaskShell?: "zsh" | "bash";
  overlay?: CliProcessRuntimeOverlay | null;
};

export type CliProcessRuntimeHandlers = {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null) => void;
  onError?: (error: Error) => void;
};

export type CliProcessRuntimeHandle = {
  pid?: number;
  resolvedCommand?: string;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  lifecycle?: Promise<ProcessLifecycleEvidence & { temp: CleanupResult }>;
};

export type CliProcessRuntimeOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  resolvedCommand?: string;
};

type ResolvedSpawnCommand = {
  commandToSpawn: string;
  argsToSpawn: string[];
  resolvedCommand: string;
};

function escapeShellArg(value: string): string {
  if (value === "") return "''";
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function buildShellCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(escapeShellArg).join(" ");
}

function resolveSpawnCommand(
  command: string,
  args: string[],
  macTaskShell?: "zsh" | "bash",
): ResolvedSpawnCommand | null {
  const resolved = resolveCliCommand(command);
  if (resolved) {
    return { commandToSpawn: resolved.command, argsToSpawn: args, resolvedCommand: resolved.command };
  }
  if (process.platform !== "darwin") return null;
  const shell = macTaskShell === "bash" ? "/bin/bash" : "/bin/zsh";
  return {
    commandToSpawn: shell,
    argsToSpawn: ["-lc", buildShellCommandLine(command, args)],
    resolvedCommand: command,
  };
}

function buildSpawnEnvironment(
  cwd: string | undefined,
  baseEnvironment?: NodeJS.ProcessEnv,
  envOverrides?: Record<string, string>,
  generatedEnvOverrides?: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(baseEnvironment ?? process.env),
    ...(envOverrides ?? {}),
    ...(generatedEnvOverrides ?? {}),
  };
  if (cwd) env.PWD = cwd;
  return env;
}

function spawnResolvedCliProcess(
  { commandToSpawn, argsToSpawn }: ResolvedSpawnCommand,
  input: Pick<CliProcessRuntimeLaunch, "cwd" | "baseEnvironment" | "envOverrides">,
  stdin: "pipe" | "ignore",
  overlayEnvOverrides?: Record<string, string>,
  processLabel?: string,
): ReturnType<typeof spawn> {
  const cwd = input.cwd;
  const env = buildSpawnEnvironment(cwd, input.baseEnvironment, input.envOverrides, overlayEnvOverrides);
  return spawn(commandToSpawn, argsToSpawn, {
    cwd,
    env: isLoginShellCommand(commandToSpawn) ? stripNvmIncompatibleEnv(env) : env,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: [stdin, "pipe", "pipe"],
    argv0: resolveChildArgv0(commandToSpawn, processLabel),
  });
}

function reportMissingCommand(command: string, handlers: CliProcessRuntimeHandlers): void {
  const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  handlers.onError?.(error);
  handlers.onExit?.(127);
}

export function isCliProcessCommandAvailable(command: string, macTaskShell?: "zsh" | "bash"): Promise<boolean> {
  if (resolveCliCommand(command)) return Promise.resolve(true);
  if (process.platform !== "darwin") return Promise.resolve(false);
  const shellPath = macTaskShell === "bash" ? "/bin/bash" : "/bin/zsh";
  const child = spawn(shellPath, ["-lc", `command -v ${escapeShellArg(command)} >/dev/null 2>&1`], {
    env: stripNvmIncompatibleEnv(process.env),
    stdio: "ignore",
    windowsHide: true,
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (available: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(available);
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

export function runCliProcess(
  input: CliProcessRuntimeLaunch,
  handlers: CliProcessRuntimeHandlers,
  stdio: "pipe" | "ignore" = "pipe",
): CliProcessRuntimeHandle {
  const spawnCommand = resolveSpawnCommand(input.command, input.args, input.macTaskShell);
  if (!spawnCommand) {
    input.overlay?.cleanup();
    reportMissingCommand(input.command, handlers);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }

  const child = spawnResolvedCliProcess(
    spawnCommand,
    input,
    stdio === "ignore" ? "ignore" : "pipe",
    input.overlay?.envOverrides,
    input.processLabel,
  );

  const termination = createProcessTerminationController(child);
  let temp: CleanupResult = input.overlay
    ? { status: "unobservable", reason: "runtime-overlay-cleanup-pending" }
    : { status: "not-applicable", reason: "no-runtime-overlay" };
  // Attach lifecycle observation immediately after spawn, before touching stdin or output.
  const lifecycle = observeChildProcessLifecycle(child).then((facts) => {
    if (input.overlay && facts.streams.status === "confirmed") {
      temp = input.overlay.cleanup();
    }
    return { ...facts, temp };
  });

  if (stdio === "pipe") child.stdin?.end();
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => handlers.onStdout?.(chunk));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => handlers.onStderr?.(chunk));
  child.on("error", (error) => handlers.onError?.(error));
  child.on("close", (code) => handlers.onExit?.(code));

  return {
    pid: child.pid,
    resolvedCommand: spawnCommand.resolvedCommand,
    kill: termination.kill,
    lifecycle,
  };
}

export function captureCliProcessOutput(
  input: Omit<CliProcessRuntimeLaunch, "overlay" | "processLabel"> & { timeoutMs?: number },
): Promise<CliProcessRuntimeOutput> {
  return new Promise((resolve, reject) => {
    const spawnCommand = resolveSpawnCommand(input.command, input.args, input.macTaskShell);
    if (!spawnCommand) {
      const error = new Error(`spawn ${input.command} ENOENT`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      reject(error);
      return;
    }
    const child = spawnResolvedCliProcess(spawnCommand, input, "ignore");
    const termination = createProcessTerminationController(child);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    const finishResolve = (payload: CliProcessRuntimeOutput): void => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(payload);
    };
    const finishReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(error);
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", finishReject);
    child.on("close", (code) => finishResolve({ stdout, stderr, exitCode: code, resolvedCommand: spawnCommand.resolvedCommand }));
    const timeoutMs = typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? input.timeoutMs : 0;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        termination.kill("SIGTERM");
        finishReject(new Error(`capture-cli-output-timeout:${timeoutMs}`));
      }, timeoutMs);
    }
  });
}
