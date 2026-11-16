import type { ChildProcess } from "child_process";
import { spawn } from "cross-spawn";

const KILL_GRACE_MS = 2000;
type Signal = NodeJS.Signals | number;

/** Injectable effects keep regression tests away from real process identities. */
export type ProcessTerminationPorts = {
  platform: NodeJS.Platform;
  signalProcess: (pid: number, signal: Signal) => void;
  taskkill: (pid: number) => void;
  setTimer: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearTimer: (timer: NodeJS.Timeout) => void;
};

const defaultPorts: ProcessTerminationPorts = {
  platform: process.platform,
  signalProcess: (pid, signal) => { process.kill(pid, signal); },
  taskkill: (pid) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    // Dispatch is best effort, never proof of tree cleanup (including ENOENT).
    killer.on("error", () => undefined);
  },
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer),
};

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

  const send = (signal: Signal): boolean => {
    if (terminal || !child.pid) return false;
    const pid = child.pid;
    try {
      if (ports.platform === "win32") ports.taskkill(pid);
      else ports.signalProcess(-pid, signal);
      return true;
    } catch {
      if (ports.platform === "win32" || terminal) return false;
      try { return child.kill(signal); }
      catch { return false; }
    }
  };

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
