import childProcess = require("child_process");
import * as fs from "fs";
import * as path from "path";
import type test = require("node:test");

/** OS-visible instance identity. PID reuse fails this comparison. */
export type DepartmentWorkerInstanceIdentity = {
  pid: number;
  startedAt: string;
  command: string;
};

export type DepartmentWorkerSignal = "SIGTERM" | "SIGKILL";

export type DepartmentWorkerCleanupOutcome =
  | "exited-before-signal"
  | "identity-mismatch"
  | "exited-after-term"
  | "identity-changed-after-term"
  | "exited-after-identity-change"
  | "exited-after-kill";

export type DepartmentWorkerCleanupResult = {
  outcome: DepartmentWorkerCleanupOutcome;
  signals: DepartmentWorkerSignal[];
};

export type DepartmentWorkerSignalLimits = {
  termMs: number;
  killMs: number;
  pollMs: number;
};

/** Each phase confirms the process is gone. Neither signal is exit evidence by itself. */
export const DEPARTMENT_WORKER_SIGNAL_LIMITS: DepartmentWorkerSignalLimits = {
  termMs: 1000,
  killMs: 1000,
  pollMs: 20,
};

export interface DepartmentWorkerCleanupPorts {
  now(): number;
  wait(ms: number): Promise<void>;
  /** Null means the pid is gone. Throw when the observation itself fails. */
  observe(pid: number): DepartmentWorkerInstanceIdentity | null;
  signalHandle(handle: childProcess.ChildProcess, signal: DepartmentWorkerSignal): void;
  signalInstance(pid: number, signal: DepartmentWorkerSignal): void;
}

export class DepartmentWorkerCleanupError extends Error {
  readonly cause?: unknown;
  constructor(message: "department-worker-exit-timeout" | "department-worker-observation-failed" | "department-worker-ps-timeout", cause?: unknown) {
    super(message);
    this.name = "DepartmentWorkerCleanupError";
    this.cause = cause;
  }
}

const PS_IDENTITY = /^\s*([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S[\s\S]*?)\s*$/;

/** Bound every real ps child. A timeout is not a missing pid and not a handle-exit timeout. */
export const DEPARTMENT_WORKER_PS_TIMEOUT_MS = 1000;

export function departmentWorkerPsCommand(pid: number): { file: string; args: string[]; options: childProcess.ExecFileSyncOptionsWithStringEncoding } {
  return {
    file: "ps",
    args: ["-p", String(pid), "-ww", "-o", "lstart=,command="],
    options: {
      encoding: "utf8",
      timeout: DEPARTMENT_WORKER_PS_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    },
  };
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function parseDepartmentWorkerPsIdentity(pid: number, psText: string): DepartmentWorkerInstanceIdentity {
  if (!Number.isInteger(pid) || pid <= 1) throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
  const match = psText.match(PS_IDENTITY);
  const command = match?.[2].trim() ?? "";
  if (!match || !command) throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
  return { pid, startedAt: match[1].replace(/\s+/g, " "), command };
}

/** Read pid, start time and full command. A missing pid is null; ps failures throw. */
export function observeDepartmentWorkerInstance(pid: number): DepartmentWorkerInstanceIdentity | null {
  if (!Number.isInteger(pid) || pid <= 1) throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
  try {
    const command = departmentWorkerPsCommand(pid);
    const stdout = childProcess.execFileSync(command.file, command.args, command.options);
    if (!stdout.trim()) throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
    return parseDepartmentWorkerPsIdentity(pid, stdout);
  } catch (error) {
    if (error instanceof DepartmentWorkerCleanupError) throw error;
    const failed = error as { status?: number; code?: string; stdout?: string | Buffer; stderr?: string | Buffer };
    if (failed.code === "ETIMEDOUT") throw new DepartmentWorkerCleanupError("department-worker-ps-timeout", error);
    const stdout = String(failed.stdout ?? "");
    const stderr = String(failed.stderr ?? "");
    if (failed.status === 1 && !stdout.trim() && !stderr.trim()) return null;
    throw new DepartmentWorkerCleanupError("department-worker-observation-failed", error);
  }
}

function sameInstance(left: DepartmentWorkerInstanceIdentity, right: DepartmentWorkerInstanceIdentity): boolean {
  return left.pid === right.pid && left.startedAt === right.startedAt && left.command === right.command;
}

function inspectInstance(
  target: { identity: DepartmentWorkerInstanceIdentity; handle?: childProcess.ChildProcess },
  ports: DepartmentWorkerCleanupPorts,
): "match" | "gone" | "changed" {
  const handle = target.handle;
  if (handle && handle.pid !== target.identity.pid) return "changed";
  if (handle && (handle.exitCode !== null || handle.signalCode !== null)) return "gone";
  let observed: DepartmentWorkerInstanceIdentity | null;
  try {
    observed = ports.observe(target.identity.pid);
  } catch (error) {
    if (error instanceof DepartmentWorkerCleanupError) throw error;
    throw new DepartmentWorkerCleanupError("department-worker-observation-failed", error);
  }
  if (!observed) return "gone";
  return sameInstance(observed, target.identity) ? "match" : "changed";
}

async function deliverSignal(
  target: { identity: DepartmentWorkerInstanceIdentity; handle?: childProcess.ChildProcess },
  ports: DepartmentWorkerCleanupPorts,
  signal: DepartmentWorkerSignal,
  signals: DepartmentWorkerSignal[],
): Promise<"sent" | "gone" | "changed"> {
  const state = inspectInstance(target, ports);
  if (state !== "match") return state;
  try {
    if (target.handle) ports.signalHandle(target.handle, signal);
    else ports.signalInstance(target.identity.pid, signal);
  } catch (error) {
    const code = typeof error === "object" && error ? (error as { code?: string }).code : undefined;
    if (code === "ESRCH") return "gone";
    throw new DepartmentWorkerCleanupError("department-worker-observation-failed", error);
  }
  signals.push(signal);
  return "sent";
}

async function waitForDeparture(
  target: { identity: DepartmentWorkerInstanceIdentity; handle?: childProcess.ChildProcess },
  ports: DepartmentWorkerCleanupPorts,
  limits: DepartmentWorkerSignalLimits,
  deadline: number,
): Promise<"gone" | "changed" | "deadline"> {
  while (true) {
    const state = inspectInstance(target, ports);
    if (state === "gone" || state === "changed") return state;
    if (ports.now() >= deadline) return "deadline";
    const before = ports.now();
    await ports.wait(Math.max(1, Math.min(limits.pollMs, deadline - before)));
    if (ports.now() <= before) return "deadline";
  }
}

/**
 * Confirm the same instance before SIGTERM and again before SIGKILL.
 * Direct children are signaled through the held handle. Cross-host cleanup
 * signals only the recorded instance. An identity change sends nothing further.
 */
export async function cleanupDepartmentWorkerInstance(
  target: { identity: DepartmentWorkerInstanceIdentity; handle?: childProcess.ChildProcess },
  ports: DepartmentWorkerCleanupPorts,
  limits: DepartmentWorkerSignalLimits = DEPARTMENT_WORKER_SIGNAL_LIMITS,
): Promise<DepartmentWorkerCleanupResult> {
  const signals: DepartmentWorkerSignal[] = [];
  const opened = await deliverSignal(target, ports, "SIGTERM", signals);
  if (opened === "gone") return { outcome: "exited-before-signal", signals };
  if (opened === "changed") return finishCommandChange(target, ports, limits, signals, "identity-mismatch");
  const afterTerm = await waitForDeparture(target, ports, limits, ports.now() + limits.termMs);
  if (afterTerm === "gone") return { outcome: "exited-after-term", signals };
  if (afterTerm === "changed") return finishCommandChange(target, ports, limits, signals, "identity-changed-after-term");
  const forced = await deliverSignal(target, ports, "SIGKILL", signals);
  if (forced === "gone") return { outcome: "exited-after-term", signals };
  if (forced === "changed") return finishCommandChange(target, ports, limits, signals, "identity-changed-after-term");
  const afterKill = await waitForDeparture(target, ports, limits, ports.now() + limits.killMs);
  if (afterKill === "gone") return { outcome: "exited-after-kill", signals };
  if (afterKill === "changed") return finishCommandChange(target, ports, limits, signals, "exited-after-kill");
  throw new DepartmentWorkerCleanupError("department-worker-exit-timeout");
}

/** A command change stops signals. A held handle still has to exit within the probe budget. */
async function finishCommandChange(
  target: { identity: DepartmentWorkerInstanceIdentity; handle?: childProcess.ChildProcess },
  ports: DepartmentWorkerCleanupPorts,
  limits: DepartmentWorkerSignalLimits,
  signals: DepartmentWorkerSignal[],
  withoutHandle: DepartmentWorkerCleanupOutcome,
): Promise<DepartmentWorkerCleanupResult> {
  const handle = target.handle;
  if (!handle) return { outcome: withoutHandle, signals };
  const deadline = ports.now() + limits.killMs;
  while (true) {
    if (handle.exitCode !== null || handle.signalCode !== null) return { outcome: "exited-after-identity-change", signals };
    if (ports.now() >= deadline) throw new DepartmentWorkerCleanupError("department-worker-exit-timeout");
    try {
      ports.observe(target.identity.pid);
    } catch (error) {
      if (error instanceof DepartmentWorkerCleanupError) throw error;
      throw new DepartmentWorkerCleanupError("department-worker-observation-failed", error);
    }
    if (handle.exitCode !== null || handle.signalCode !== null) return { outcome: "exited-after-identity-change", signals };
    if (ports.now() >= deadline) throw new DepartmentWorkerCleanupError("department-worker-exit-timeout");
    const before = ports.now();
    await ports.wait(Math.max(1, Math.min(limits.pollMs, deadline - before)));
    if (ports.now() <= before) throw new DepartmentWorkerCleanupError("department-worker-exit-timeout");
  }
}

export function createDepartmentWorkerCleanupPorts(): DepartmentWorkerCleanupPorts {
  return {
    now: () => Date.now(),
    wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    observe: observeDepartmentWorkerInstance,
    signalHandle(handle, signal) {
      if (!handle.pid || handle.pid <= 1) throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
      handle.kill(signal);
    },
    signalInstance(pid, signal) {
      if (!Number.isInteger(pid) || pid <= 1) throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
      process.kill(pid, signal);
    },
  };
}

function captureLiveDepartmentWorkerInstance(child: childProcess.ChildProcess): DepartmentWorkerInstanceIdentity | null {
  const pid = child.pid;
  if (!pid || pid <= 1) return null;
  const deadline = Date.now() + 300;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return null;
    try {
      const observed = observeDepartmentWorkerInstance(pid);
      if (observed) return observed;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    pause(20);
  }
  if (child.exitCode !== null || child.signalCode !== null) return null;
  if (lastError instanceof DepartmentWorkerCleanupError) throw lastError;
  if (lastError) throw new DepartmentWorkerCleanupError("department-worker-observation-failed", lastError);
  return null;
}

/** Append an instance record a later process can recheck with ps. A bare pid is not enough. */
export function recordDepartmentWorkerInstance(pidFile: string, pid: number): DepartmentWorkerInstanceIdentity {
  const deadline = Date.now() + 300;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      const observed = observeDepartmentWorkerInstance(pid);
      if (observed) {
        fs.appendFileSync(pidFile, JSON.stringify(observed) + "\n");
        return observed;
      }
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    pause(20);
  }
  if (lastError instanceof DepartmentWorkerCleanupError) throw lastError;
  throw new DepartmentWorkerCleanupError("department-worker-observation-failed", lastError);
}

function identityFromRecord(value: unknown): DepartmentWorkerInstanceIdentity {
  if (!value || typeof value !== "object") throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
  const record = value as { pid?: unknown; startedAt?: unknown; command?: unknown; ps?: unknown; observationFailed?: unknown };
  if (record.observationFailed === "department-worker-ps-timeout" || record.observationFailed === "department-worker-observation-failed") {
    throw new DepartmentWorkerCleanupError(record.observationFailed);
  }
  if (typeof record.ps === "string" && typeof record.pid === "number") return parseDepartmentWorkerPsIdentity(record.pid, record.ps);
  if (typeof record.pid === "number" && typeof record.startedAt === "string" && typeof record.command === "string") {
    const startedAt = record.startedAt.trim().replace(/\s+/g, " ");
    const command = record.command.trim();
    if (!Number.isInteger(record.pid) || record.pid <= 1 || !startedAt || !command) {
      throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
    }
    return { pid: record.pid, startedAt, command };
  }
  throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
}

type DepartmentWorkerInstanceLine =
  | { ok: true; identity: DepartmentWorkerInstanceIdentity }
  | { ok: false; failure: unknown };

function readDepartmentWorkerInstanceLines(pidFile: string): DepartmentWorkerInstanceLine[] {
  let text = "";
  try {
    text = fs.readFileSync(pidFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [{ ok: false, failure: new DepartmentWorkerCleanupError("department-worker-observation-failed", error) }];
  }
  const lines: DepartmentWorkerInstanceLine[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      lines.push({ ok: true, identity: identityFromRecord(JSON.parse(line)) });
    } catch (error) {
      lines.push({
        ok: false,
        failure: error instanceof DepartmentWorkerCleanupError
          ? error
          : new DepartmentWorkerCleanupError("department-worker-observation-failed", error),
      });
    }
  }
  return lines;
}

export function readRecordedDepartmentWorkerInstances(pidFile: string): DepartmentWorkerInstanceIdentity[] {
  const lines = readDepartmentWorkerInstanceLines(pidFile);
  const failure = lines.find((line) => !line.ok);
  if (failure && !failure.ok) throw failure.failure;
  return lines.flatMap((line) => line.ok ? [line.identity] : []);
}

/** Stop recorded instances and held handles. One target's failure does not skip the rest. */
export async function stopDepartmentFixtureWorkers(
  targets: {
    pidFiles?: readonly string[];
    handles?: readonly { handle: childProcess.ChildProcess; identity: DepartmentWorkerInstanceIdentity | null }[];
  },
  ports: DepartmentWorkerCleanupPorts = createDepartmentWorkerCleanupPorts(),
  limits: DepartmentWorkerSignalLimits = DEPARTMENT_WORKER_SIGNAL_LIMITS,
): Promise<void> {
  const failures: unknown[] = [];
  for (const pidFile of targets.pidFiles ?? []) {
    for (const line of readDepartmentWorkerInstanceLines(pidFile)) {
      if (!line.ok) {
        failures.push(line.failure);
        continue;
      }
      try {
        await cleanupDepartmentWorkerInstance({ identity: line.identity }, ports, limits);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  for (const item of targets.handles ?? []) {
    try {
      if (!item.identity) {
        if (item.handle.exitCode === null && item.handle.signalCode === null && item.handle.pid) {
          throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
        }
        continue;
      }
      await cleanupDepartmentWorkerInstance({ identity: item.identity, handle: item.handle }, ports, limits);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 0) return;
  const first = failures[0];
  if (first instanceof Error) throw first;
  throw new DepartmentWorkerCleanupError("department-worker-observation-failed", first);
}

export function stopLeaderFixtureWorkers(
  directory: string,
  ports: DepartmentWorkerCleanupPorts = createDepartmentWorkerCleanupPorts(),
  limits: DepartmentWorkerSignalLimits = DEPARTMENT_WORKER_SIGNAL_LIMITS,
): Promise<void> {
  return stopDepartmentFixtureWorkers({
    pidFiles: [path.join(directory, "owned-worker-pids"), path.join(directory, "native-instances")],
  }, ports, limits);
}

export function stopPreparedFixtureWorkers(
  directory: string,
  handles: readonly { handle: childProcess.ChildProcess; identity: DepartmentWorkerInstanceIdentity | null }[],
  ports: DepartmentWorkerCleanupPorts = createDepartmentWorkerCleanupPorts(),
  limits: DepartmentWorkerSignalLimits = DEPARTMENT_WORKER_SIGNAL_LIMITS,
): Promise<void> {
  return stopDepartmentFixtureWorkers({
    pidFiles: [path.join(directory, "owned-worker-pids")],
    handles,
  }, ports, limits);
}

/** Stop instances recorded by another host. This is test hygiene, not an Owner receipt or capacity release. */
export async function stopRecordedDepartmentTestWorkers(
  pidFile: string,
  ports: DepartmentWorkerCleanupPorts = createDepartmentWorkerCleanupPorts(),
  limits: DepartmentWorkerSignalLimits = DEPARTMENT_WORKER_SIGNAL_LIMITS,
): Promise<void> {
  await stopDepartmentFixtureWorkers({ pidFiles: [pidFile] }, ports, limits);
}

/** Capture real forked children so failed isolated tests cannot leak workers.
 * Termination here is test hygiene, never an Owner receipt or worker-retire proof. */
export function captureDepartmentTestWorkers(t: test.TestContext) {
  const children: Array<{ module: string; child: childProcess.ChildProcess; identity: DepartmentWorkerInstanceIdentity | null }> = [];
  const fork = childProcess.fork;
  t.mock.method(childProcess, "fork", (...args: Parameters<typeof childProcess.fork>) => {
    const child = Reflect.apply(fork, childProcess, args) as childProcess.ChildProcess;
    children.push({ module: String(args[0]), child, identity: captureLiveDepartmentWorkerInstance(child) });
    return child;
  });
  t.after(async () => {
    const ports = createDepartmentWorkerCleanupPorts();
    const failures: unknown[] = [];
    for (const { module, child, identity } of children) {
      // A detached Owner stays up after the host loses IPC. Drop the test's
      // exit listeners so this signal is not observed as production failure.
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      child.removeAllListeners("disconnect");
      try {
        if (!identity) {
          if (child.exitCode === null && child.signalCode === null && child.pid) {
            throw new DepartmentWorkerCleanupError("department-worker-observation-failed");
          }
          continue;
        }
        const result = await cleanupDepartmentWorkerInstance({ identity, handle: child }, ports);
        if (result.signals.length > 0) {
          console.error(`[department-test-hygiene] terminating unresolved owned worker ${module} ${result.outcome}`);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 0) return;
    const timeout = failures.find((error) => error instanceof DepartmentWorkerCleanupError && error.message === "department-worker-exit-timeout");
    throw timeout instanceof DepartmentWorkerCleanupError
      ? timeout
      : new DepartmentWorkerCleanupError("department-worker-observation-failed", failures[0]);
  });
  return children;
}
