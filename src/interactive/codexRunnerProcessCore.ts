import type { ChildProcess } from "child_process";
import { createCliProcessPolicy, type ResolvedProcessCommand } from "../cli/cliProcessPolicy";
import { requestProcessTreeStop } from "../cli/processTermination";
import type { CodexRuntimePorts } from "./codexRuntimePorts";

const CODEX_CHILD_SHUTDOWN_GRACE_MS = 300;

function scheduleShutdownStep(callback: () => void, delayMs: number): void {
  const timeout = setTimeout(callback, delayMs);
  timeout.unref?.();
}

export { buildShellCommandLine } from "../cli/processArgv";
export type ResolvedSpawnCommand = ResolvedProcessCommand;

export function resolveSpawnCommand(command: string, args: string[], runtime: CodexRuntimePorts, platform?: NodeJS.Platform): ResolvedSpawnCommand {
  const resolved = createCliProcessPolicy(platform).resolve(command, args, { macTaskShell: runtime.macTaskShell });
  if (resolved) return resolved;
  const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  throw error;
}

export function killProcessTree(
  child: ChildProcess,
  runtime: CodexRuntimePorts,
  signal: NodeJS.Signals | number = "SIGTERM",
  options: { platform?: NodeJS.Platform; processGroup?: boolean } = {},
): boolean {
  return requestProcessTreeStop(child, signal, {
    ...options,
    onTaskkillFailure: () => { void runtime.logError("codex-taskkill-failed", { pid: child.pid ?? null }); },
  });
}

export function requestChildShutdown(child: ChildProcess, mode: "graceful" | "terminate", runtime: CodexRuntimePorts): void {
  const isSettled = (): boolean => child.exitCode !== null || child.signalCode !== null;
  const requestSignal = (signal: NodeJS.Signals | number): void => {
    if (killProcessTree(child, runtime, signal)) {
      return;
    }
    try {
      child.kill(signal);
    } catch {
      // ignore shutdown escalation errors
    }
  };

  const sendTerminate = (): void => {
    if (isSettled()) {
      return;
    }
    requestSignal("SIGTERM");
  };

  const sendForceKill = (): void => {
    if (isSettled()) {
      return;
    }
    requestSignal("SIGKILL");
  };

  if (mode === "graceful") {
    try {
      if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.end();
      }
    } catch {
      // ignore stdin shutdown errors and continue with signal escalation
    }
    scheduleShutdownStep(() => {
      sendTerminate();
      scheduleShutdownStep(() => {
        sendForceKill();
      }, CODEX_CHILD_SHUTDOWN_GRACE_MS);
    }, CODEX_CHILD_SHUTDOWN_GRACE_MS);
    return;
  }

  sendTerminate();
  scheduleShutdownStep(() => {
    sendForceKill();
  }, CODEX_CHILD_SHUTDOWN_GRACE_MS);
}
