import type { ChildProcess } from "child_process";
import { spawn } from "cross-spawn";
import { getMacTaskShell } from "../cli/config";
import { resolveCliCommand } from "../cli/commandRunner";
import { logError } from "../logger";

const CODEX_CHILD_SHUTDOWN_GRACE_MS = 300;

function scheduleShutdownStep(callback: () => void, delayMs: number): void {
  const timeout = setTimeout(callback, delayMs);
  timeout.unref?.();
}

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildShellCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((segment) => escapeShellArg(segment)).join(" ");
}

function resolveMacTaskShellExecutable(): string {
  return getMacTaskShell() === "bash" ? "/bin/bash" : "/bin/zsh";
}

export type ResolvedSpawnCommand = {
  command: string;
  args: string[];
  usesShell: boolean;
  resolvedFrom: string;
};

export function resolveSpawnCommand(command: string, args: string[]): ResolvedSpawnCommand {
  const resolved = resolveCliCommand(command);
  if (resolved) {
    return {
      command: resolved.command,
      args,
      usesShell: false,
      resolvedFrom: resolved.resolvedFrom,
    };
  }

  if (process.platform === "darwin") {
    return {
      command: resolveMacTaskShellExecutable(),
      args: ["-lc", buildShellCommandLine(command, args)],
      usesShell: true,
      resolvedFrom: "mac-shell-fallback",
    };
  }
  const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  throw error;
}

export function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals | number = "SIGTERM"
): boolean {
  if (!child.pid) {
    return false;
  }

  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      let failed = false;
      const onFailure = (): void => {
        if (failed || child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        failed = true;
        void logError("codex-taskkill-failed", { pid: child.pid ?? null });
        try {
          child.kill(signal);
        } catch {
          return;
        }
      };
      killer.once("error", onFailure);
      killer.once("close", (code) => {
        if (code !== 0) {
          onFailure();
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      return false;
    }
  }
  return true;
}

export function requestChildShutdown(child: ChildProcess, mode: "graceful" | "terminate"): void {
  const isSettled = (): boolean => child.exitCode !== null || child.signalCode !== null;
  const requestSignal = (signal: NodeJS.Signals | number): void => {
    if (killProcessTree(child, signal)) {
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
