import type { ChildProcess } from "child_process";
import { spawn } from "cross-spawn";

const KILL_GRACE_MS = 2000;
type Signal = NodeJS.Signals | number;

/** Injectable effects keep regression tests away from real process identities. */
export type ProcessTerminationPorts = {
  platform: NodeJS.Platform;
  signalProcess: (pid: number, signal: Signal) => void;
  taskkill: (pid: number, onFailure?: () => void) => void;
  setTimer: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearTimer: (timer: NodeJS.Timeout) => void;
};

const defaultPorts: ProcessTerminationPorts = {
  platform: process.platform,
  signalProcess: (pid, signal) => { process.kill(pid, signal); },
  taskkill: (pid, onFailure) => {
    const killer = spawn("taskkill", taskkillArguments(pid), { windowsHide: true, stdio: "ignore" });
    killer.once("error", () => onFailure?.());
    if (onFailure) killer.once("close", (code) => { if (code !== 0) onFailure(); });
  },
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer),
};

function taskkillArguments(pid: number): ["/PID", string, "/T", "/F"] {
  return ["/PID", String(pid), "/T", "/F"];
}

export function planProcessTreeStop(platform: NodeJS.Platform, pid: number, phase: "initial" | "escalate"):
  | { kind: "taskkill"; args: ["/PID", string, "/T", "/F"] }
  | { kind: "signal"; signal: "SIGTERM" | "SIGKILL" }
  | null {
  if (!pid) return null;
  if (platform === "win32") return phase === "initial" ? { kind: "taskkill", args: taskkillArguments(pid) } : null;
  return { kind: "signal", signal: phase === "initial" ? "SIGTERM" : "SIGKILL" };
}

type ProcessStopOptions = {
  processGroup?: boolean;
  onTaskkillFailure?: () => void;
};

/** Dispatch only. The return value does not attest to exit, stream drain or release. */
export function requestProcessTreeStop(child: ChildProcess, signal: Signal, options: ProcessStopOptions & {
  platform?: NodeJS.Platform;
} = {}): boolean {
  return dispatchProcessTreeStop(child, signal, { ...defaultPorts, platform: options.platform ?? process.platform }, options,
    () => child.exitCode == null && child.signalCode == null);
}

function dispatchProcessTreeStop(
  child: ChildProcess,
  signal: Signal,
  ports: ProcessTerminationPorts,
  options: ProcessStopOptions,
  canSignal: () => boolean,
): boolean {
  const pid = child.pid;
  if (!pid || !canSignal()) return false;
  const signalChild = (): boolean => {
    if (!canSignal() || child.pid !== pid) return false;
    try { return child.kill(signal); }
    catch { return false; }
  };
  if (ports.platform === "win32") {
    const logFailure = options.onTaskkillFailure;
    let handledFailure = false;
    try {
      ports.taskkill(pid, logFailure && (() => {
        if (handledFailure || !canSignal() || child.pid !== pid) return;
        handledFailure = true;
        logFailure();
        signalChild();
      }));
      return true;
    } catch { return false; }
  }
  if (options.processGroup === false) return signalChild();
  try { ports.signalProcess(-pid, signal); return true; }
  catch { return signalChild(); }
}

/** Create once, immediately after spawn. State belongs to this ChildProcess,
 * never a PID registry. This port requests stops; it supplies no drain evidence.
 */
export function createProcessTerminationController(
  child: ChildProcess,
  ports: ProcessTerminationPorts = { ...defaultPorts, platform: process.platform },
): { kill: (signal?: Signal) => boolean } {
  let terminal = false;
  let spawned = false;
  let termRequested = false;
  let forceRequested = false;
  let timer: NodeJS.Timeout | null = null;

  const cancelEscalation = (): void => {
    if (timer !== null) ports.clearTimer(timer);
    timer = null;
  };
  const stopSignalling = (): void => {
    terminal = true;
    cancelEscalation();
  };
  const onSpawn = (): void => { spawned = true; };
  const onError = (): void => {
    // Errors after spawn can concern kill/IPC; they do not prove termination.
    if (!spawned && child.pid === undefined) stopSignalling();
  };
  child.once("spawn", onSpawn);
  child.on("error", onError);
  // An exited leader can lose its PID before inherited stdio closes. Never
  // target that old group while waiting for drain; descendants remain unknown.
  child.once("exit", stopSignalling);
  child.once("close", () => {
    stopSignalling();
    child.removeListener("spawn", onSpawn);
    child.removeListener("error", onError);
    child.removeListener("exit", stopSignalling);
  });

  const send = (signal: Signal): boolean => dispatchProcessTreeStop(child, signal, ports, {}, () => !terminal);

  return {
    kill: (signal = "SIGTERM") => {
      if (terminal || !child.pid) return false;
      if (ports.platform === "win32" || signal === "SIGKILL" || signal === 9) {
        cancelEscalation();
        if (forceRequested) return true;
        forceRequested = true;
        return send(signal);
      }
      if (signal !== "SIGTERM") return send(signal);
      if (termRequested || forceRequested) return true;
      termRequested = true;
      const requested = send(signal);
      if (!terminal && !forceRequested) {
        timer = ports.setTimer(() => {
          timer = null;
          if (terminal || forceRequested) return;
          forceRequested = true;
          send("SIGKILL");
        }, KILL_GRACE_MS);
        timer.unref();
      }
      return requested;
    },
  };
}
