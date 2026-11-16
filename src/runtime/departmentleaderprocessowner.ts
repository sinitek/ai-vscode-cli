import { createHash } from "crypto";
import { buildOpenCodeRunArgs } from "../cli/openCodeRunArgs";
import { runCliProcess, type CliProcessRuntimeHandle, type CliProcessRuntimeHandlers } from "../cli/cliProcessRuntime";
import { createOpenCodeRuntimeConfigOverlay } from "../cli/opencoderuntimeconfig";
import { cleanupComplete, canonicalIdentity, isDepartmentExecutionIdentity, isExecutionCleanup, sameExecution,
  type CleanupRequirements, type CleanupResult, type DepartmentExecutionIdentity, type DepartmentExecutionCleanup } from "./departmentexecutionidentity";
import { DEPARTMENT_LEADER_PROCESS_INVOCATION_LIMIT,
  departmentLeaderProcessRequirements, isDepartmentLeaderProcessInvocation, isDepartmentLeaderProcessPreparation, type DepartmentLeaderProcessInvocation,
  type DepartmentLeaderProcessPreparation } from "./departmentleaderprocesscontract";
import type { ExecutionCleanupEvidence, ExecutionTerminalEvidence, TrustedExecutionHandle, TrustedExecutionLauncher } from "./departmentexecutionowner";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
const confirmed = (evidence: string): CleanupResult => ({ status: "confirmed", evidence });
const unknown = (reason: string): CleanupResult => ({ status: "unobservable", reason });
function splitOutput(chunk: string): string[] {
  const parts: string[] = [];
  let current = "", bytes = 0;
  for (const char of chunk) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > 12 * 1024 && current) { parts.push(current); current = ""; bytes = 0; }
    current += char; bytes += size;
  }
  if (current) parts.push(current);
  return parts;
}

export type DepartmentLeaderProcessHandlers = {
  onStdout(chunk: string): void | Promise<void>;
  onStderr(chunk: string): void | Promise<void>;
};
export type DepartmentLeaderProcessGates = {
  authorize(invocation: DepartmentLeaderProcessInvocation): Promise<void>;
  drainConsumers(): Promise<boolean>;
};
export type DepartmentLeaderProcessRelease = Pick<ExecutionCleanupEvidence, "runner" | "executionRoot" | "links" | "temp" | "tab">;

type Entry = { digest: string; promise: ReturnType<typeof deferred<ExecutionTerminalEvidence>>; granted: boolean; done: boolean };

/** A fixed generation Owner. Each accepted invocation gets one process, but all
 * invocations share the same bound native OpenCode session and config snapshot. */
export class DepartmentLeaderProcessOwner {
  private readonly preparation: DepartmentLeaderProcessPreparation;
  private readonly entries = new Map<string, Entry>();
  private readonly generationTerminal = deferred<ExecutionTerminalEvidence>();
  private readonly generationCleanup = deferred<ExecutionCleanupEvidence>();
  private readonly entriesDone = new Set<Promise<ExecutionTerminalEvidence>>();
  private active: Entry | undefined;
  private sealed = false;
  private failed = false;
  private finalizing = false;
  public readonly launcher: TrustedExecutionLauncher;

  public constructor(preparation: DepartmentLeaderProcessPreparation,
    private readonly release: () => Promise<DepartmentLeaderProcessRelease>,
    private readonly handlers: DepartmentLeaderProcessHandlers) {
    if (!isDepartmentLeaderProcessPreparation(preparation)) throw new Error("department-leader-process-preparation-invalid");
    this.preparation = structuredClone(preparation);
    const check = (identity: DepartmentExecutionIdentity) => {
      if (!isDepartmentExecutionIdentity(identity) || !sameExecution(identity, this.preparation.identity)) throw new Error("department-leader-process-identity-conflict");
    };
    const handle: TrustedExecutionHandle = { kind: "process", completion: this.generationTerminal.promise, cleanup: () => this.generationCleanup.promise };
    this.launcher = {
      requirements: (identity) => { check(identity); return departmentLeaderProcessRequirements(this.preparation); },
      launch: async (identity) => { check(identity); return handle; },
    };
  }

  public invoke(invocation: DepartmentLeaderProcessInvocation, signal: AbortSignal | undefined, gates: DepartmentLeaderProcessGates): Promise<ExecutionTerminalEvidence> {
    if (!isDepartmentLeaderProcessInvocation(invocation)) return Promise.reject(new Error("department-leader-process-invocation-invalid"));
    const fixed = Object.freeze({ invocationId: invocation.invocationId, prompt: invocation.prompt });
    const digest = createHash("sha256").update(JSON.stringify([canonicalIdentity(this.preparation.identity), fixed.invocationId, fixed.prompt])).digest("hex");
    const old = this.entries.get(fixed.invocationId);
    if (old) return old.digest === digest ? old.promise.promise : Promise.reject(new Error("department-leader-process-invocation-conflict"));
    if (this.sealed || this.failed) return Promise.reject(new Error("department-leader-process-admission-closed"));
    if (this.active) return Promise.reject(new Error("department-leader-process-invocation-busy"));
    if (this.entries.size >= DEPARTMENT_LEADER_PROCESS_INVOCATION_LIMIT) return Promise.reject(new Error("department-leader-process-capacity"));
    if (signal?.aborted) return Promise.reject(new Error("department-leader-process-invocation-cancelled"));
    const entry: Entry = { digest, promise: deferred(), granted: false, done: false };
    this.entries.set(fixed.invocationId, entry); this.active = entry; this.entriesDone.add(entry.promise.promise);
    void this.execute(entry, fixed, signal, gates);
    return entry.promise.promise;
  }

  private async execute(entry: Entry, invocation: DepartmentLeaderProcessInvocation, signal: AbortSignal | undefined,
    gates: DepartmentLeaderProcessGates): Promise<void> {
    let handle: CliProcessRuntimeHandle | undefined;
    let exitCode: number | null = null;
    let childError = false;
    let consumerFailed = false;
    const consumers = new Set<Promise<void>>();
    const deliver = (callback: (chunk: string) => void | Promise<void>) => (chunk: string): void => {
      for (const part of splitOutput(chunk)) {
        if (consumers.size >= 64) { consumerFailed = true; handle?.kill(); return; }
        const task = Promise.resolve().then(() => callback(part)).then(() => undefined, () => { consumerFailed = true; });
        consumers.add(task); void task.finally(() => consumers.delete(task));
      }
    };
    const abort = () => { /* Cancellation fences the pending grant; a consumed grant belongs to the Owner. */ };
    try {
      await gates.authorize(invocation);
      if (signal?.aborted || this.sealed) throw new Error("department-leader-process-grant-revoked");
      entry.granted = true;
      const args = buildOpenCodeRunArgs(this.preparation.launch.baseArgs, this.preparation.launch.sessionId, invocation.prompt);
      const launch = this.preparation.launch;
      const overlayResult = launch.overlay ? createOpenCodeRuntimeConfigOverlay(launch.overlay) : null;
      if (overlayResult && (!overlayResult.ok || !overlayResult.overlay)) throw new Error("department-leader-process-overlay-unavailable");
      handle = runCliProcess({ command: launch.command, args, cwd: launch.cwd, baseEnvironment: launch.baseEnvironment,
        envOverrides: launch.envOverrides, processLabel: launch.processLabel, macTaskShell: launch.macTaskShell,
        overlay: overlayResult?.overlay ?? null }, {
        onStdout: deliver(this.handlers.onStdout), onStderr: deliver(this.handlers.onStderr),
        onExit: (code) => { exitCode = code; }, onError: () => { childError = true; },
      } satisfies CliProcessRuntimeHandlers);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const lifecycle = await handle.lifecycle;
      await Promise.allSettled([...consumers]);
      const drained = await gates.drainConsumers();
      const processFact = lifecycle?.processTerminal?.status === "confirmed" && !childError
        ? confirmed("opencode-leader-child-close-confirmed") : unknown("opencode-leader-child-close-unconfirmed");
      const streamsFact = lifecycle?.streams?.status === "confirmed" && drained && !consumerFailed
        && (!launch.overlay || lifecycle?.temp?.status === "confirmed")
        ? confirmed("opencode-leader-stdio-and-consumer-drain-confirmed") : unknown("opencode-leader-stream-consumer-drain-unconfirmed");
      const terminal: ExecutionTerminalEvidence = { processTerminal: processFact,
        turnTerminal: exitCode === 0 && processFact.status === "confirmed" ? confirmed("opencode-leader-invocation-exit-zero") : { status: "failed", reason: "opencode-leader-invocation-not-successful" },
        streams: streamsFact };
      if (processFact.status !== "confirmed" || streamsFact.status !== "confirmed" || exitCode !== 0) this.failed = true;
      entry.promise.resolve(terminal);
    } catch {
      this.failed = true;
      const unknownTerminal: ExecutionTerminalEvidence = { processTerminal: unknown("opencode-leader-process-unobservable"),
        turnTerminal: unknown("opencode-leader-turn-unobservable"), streams: unknown("opencode-leader-streams-unobservable") };
      entry.promise.resolve(unknownTerminal);
    } finally {
      signal?.removeEventListener("abort", abort);
      entry.done = true; this.active = undefined;
      void this.finalize();
    }
  }

  public seal(): Promise<ExecutionCleanupEvidence> {
    this.sealed = true;
    void this.finalize();
    return this.generationCleanup.promise;
  }

  private async finalize(): Promise<void> {
    if (!this.sealed || this.active || this.finalizing) return;
    this.finalizing = true;
    const terminals = await Promise.all([...this.entriesDone]);
    const safe = !this.failed && terminals.every((terminal) =>
      terminal.processTerminal.status === "confirmed" && terminal.streams.status === "confirmed");
    const terminal: ExecutionTerminalEvidence = safe
      ? { processTerminal: confirmed("department-leader-generation-all-started-processes-closed"), turnTerminal: { status: "not-applicable", reason: "per-invocation-turn-terminal" }, streams: confirmed("department-leader-generation-all-streams-drained") }
      : { processTerminal: unknown("department-leader-generation-terminal-unconfirmed"), turnTerminal: { status: "not-applicable", reason: "per-invocation-turn-terminal" }, streams: unknown("department-leader-generation-streams-unconfirmed") };
    this.generationTerminal.resolve(terminal);
    let resources: DepartmentLeaderProcessRelease = { runner: unknown("leader-runner-not-released"), executionRoot: unknown("leader-root-not-released"),
      links: unknown("leader-links-not-released"), temp: unknown("leader-temp-not-released"), tab: unknown("leader-tab-not-released") };
    if (safe) { try { resources = await this.release(); } catch { this.failed = true; } }
    const cleanup: ExecutionCleanupEvidence = safe ? resources : { runner: unknown("leader-generation-not-drained"),
      executionRoot: unknown("leader-generation-not-drained"), links: unknown("leader-generation-not-drained"),
      temp: unknown("leader-generation-not-drained"), tab: unknown("leader-generation-not-drained") };
    const complete = { ...terminal, ...cleanup };
    if (isExecutionCleanup(complete) && cleanupComplete(complete, departmentLeaderProcessRequirements(this.preparation))) {
      this.generationCleanup.resolve(cleanup);
    } else {
      this.generationCleanup.resolve({ runner: cleanup.runner, executionRoot: cleanup.executionRoot, links: cleanup.links,
        temp: cleanup.temp, tab: cleanup.tab });
    }
  }
}
