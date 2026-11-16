import { createHash } from "crypto";
import { CodexOwnedExecution, type CodexOwnedSession, type CodexOwnedStreamHandlers, type CodexOwnedExecutionResult } from "../interactive/codexOwnedExecution";
import type { CodexRuntimePorts } from "../interactive/codexRuntimePorts";
import { canonicalIdentity, sameExecution, type CleanupResult, type DepartmentExecutionIdentity } from "./departmentexecutionidentity";
import type { ExecutionCleanupEvidence, ExecutionTerminalEvidence, TrustedExecutionHandle, TrustedExecutionLauncher } from "./departmentexecutionowner";
import { isLeaderCodexPreparation, isLeaderInvocation, LEADER_INVOCATION_LIMIT, LEADER_REQUIREMENTS,
  type LeaderCodexPreparation, type LeaderInvocation } from "./departmentleadercodexcontract";

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined); return { promise, resolve, reject };
}
const unknown = (reason: string): CleanupResult => ({ status: "unobservable", reason });
const confirmed = (evidence: string): CleanupResult => ({ status: "confirmed", evidence });
type Entry = { digest: string; abort: AbortController; granted: boolean; done: boolean;
  result: ReturnType<typeof deferred<ExecutionTerminalEvidence>>; facts?: CodexOwnedExecutionResult };
export type LeaderInvocationGates = {
  persist(session: CodexOwnedSession): Promise<void>;
  /** Private one-use host grant; only resolved after final synchronous authority check. */
  authorize(session: CodexOwnedSession): Promise<void>;
  drainConsumers(): Promise<boolean>;
};

/** A generation owner, NOT a mutable CodexOwnedExecution. Each round owns a new
 * immutable execution/transport and must physically drain before the next round. */
export class DepartmentLeaderCodexOwner {
  private readonly input: LeaderCodexPreparation;
  private readonly entries = new Map<string, Entry>();
  private readonly terminal = deferred<ExecutionTerminalEvidence>();
  private readonly drained = deferred<ExecutionCleanupEvidence>();
  private bindOwner?: (sessionId: string) => Promise<void>;
  private nativeThread?: string;
  private active = false;
  private sealed = false;
  private poisoned = false;
  private finalized = false;
  public readonly launcher: TrustedExecutionLauncher;
  constructor(input: LeaderCodexPreparation, private readonly cwd: string,
    private readonly release: () => Promise<Pick<ExecutionCleanupEvidence, "executionRoot" | "links" | "temp">>,
    private readonly releaseTab?: (identity: DepartmentExecutionIdentity) => Promise<CleanupResult>) {
    if (!isLeaderCodexPreparation(input)) throw new Error("leader-preparation-invalid");
    this.input = structuredClone(input);
    this.nativeThread = input.identity.session.state === "bound" ? input.identity.session.id : undefined;
    const handle: TrustedExecutionHandle = { kind: "both", completion: this.terminal.promise, cleanup: () => this.drained.promise };
    const check = (i: DepartmentExecutionIdentity) => {
      if (!sameExecution(i, this.input.identity)) throw new Error("leader-owner-identity-conflict");
    };
    this.launcher = {
      requirements: (i) => { check(i); return { ...LEADER_REQUIREMENTS }; },
      launch: async (i, bind) => { check(i); if (!this.bindOwner) this.bindOwner = bind; return handle; },
    };
  }
  public get identity(): DepartmentExecutionIdentity {
    return { ...this.input.identity, session: this.nativeThread ? { state: "bound", id: this.nativeThread } : { state: "unbound" } };
  }
  public invoke(invocation: LeaderInvocation, handlers: CodexOwnedStreamHandlers, runtime: CodexRuntimePorts, gates: LeaderInvocationGates): Promise<ExecutionTerminalEvidence> {
    if (!isLeaderInvocation(invocation)) return Promise.reject(new Error("leader-invocation-invalid"));
    invocation = Object.freeze({ ...invocation });
    const digest = createHash("sha256").update(JSON.stringify([canonicalIdentity(this.input.identity), invocation.invocationId, invocation.prompt])).digest("hex");
    const old = this.entries.get(invocation.invocationId);
    if (old) return old.digest === digest ? old.result.promise : Promise.reject(new Error("leader-invocation-conflict"));
    if (this.sealed || this.poisoned || !this.bindOwner) return Promise.reject(new Error("leader-admission-closed-or-unknown"));
    if (this.active) return Promise.reject(new Error("leader-invocation-busy"));
    if (this.entries.size >= LEADER_INVOCATION_LIMIT) return Promise.reject(new Error("leader-invocation-capacity"));
    const entry: Entry = { digest, abort: new AbortController(), granted: false, done: false, result: deferred() };
    this.entries.set(invocation.invocationId, entry); this.active = true;
    void this.run(entry, invocation, { ...handlers }, runtime, gates);
    return entry.result.promise;
  }
  private async run(entry: Entry, invocation: LeaderInvocation, handlers: CodexOwnedStreamHandlers, runtime: CodexRuntimePorts, gates: LeaderInvocationGates): Promise<void> {
    let owned: CodexOwnedExecution | undefined;
    try {
      owned = new CodexOwnedExecution({ runner: { ...this.input.runner, cwd: this.cwd, threadId: this.nativeThread ?? null },
        runtime, handlers, prompt: invocation.prompt, signal: entry.abort.signal,
        bindSession: async (session) => {
          if (this.nativeThread && session.threadId !== this.nativeThread) throw new Error("leader-native-thread-conflict");
          this.nativeThread ??= session.threadId; // Never replace after persistence failure or unknown delivery.
          await gates.persist(session);
          if (this.sealed || entry.abort.signal.aborted) throw new Error("leader-grant-revoked");
          await this.bindOwner!(session.threadId);
          if (this.sealed || entry.abort.signal.aborted) throw new Error("leader-grant-revoked");
          await gates.authorize(session);
          if (!entry.granted) throw new Error("leader-grant-not-consumed");
          return session;
        } });
      try { await owned.execute(); } catch { this.poisoned = true; }
      entry.facts = await owned.cleanup();
      if (!await gates.drainConsumers()) entry.facts = { ...entry.facts, executionDrain: unknown("leader-private-consumers-unconfirmed") };
      const f = entry.facts;
      const streams = f.executionDrain.status === "confirmed" && f.streams.status === "confirmed"
        ? confirmed("leader-invocation-physical-and-consumer-drain") : unknown("leader-invocation-consumption-unconfirmed");
      const terminal: ExecutionTerminalEvidence = { processTerminal: f.processTerminal, turnTerminal: f.turnTerminal, streams };
      if (!entry.granted || f.runner.status !== "confirmed" || Object.values(terminal).some((v) => v.status !== "confirmed")) this.poisoned = true;
      entry.result.resolve(terminal);
    } catch { this.poisoned = true; entry.result.reject(new Error("leader-invocation-unobservable")); }
    finally { entry.done = true; this.active = false; void this.finalize(); }
  }
  /** Called synchronously only by the fixed private worker after validating a one-use grant. */
  public grant(invocationId: string): void {
    const entry = this.entries.get(invocationId);
    if (this.sealed || this.poisoned || !entry || entry.granted || entry.done || entry.abort.signal.aborted) throw new Error("leader-grant-revoked");
    entry.granted = true;
  }
  /** Seal is synchronous. An authorized round survives; pre-grant rounds abort.
   * The returned promise is real drain, never a timeout/idle/empty-map closure. */
  public seal(): Promise<ExecutionCleanupEvidence> {
    this.sealed = true;
    for (const entry of this.entries.values()) if (!entry.granted && !entry.done) entry.abort.abort();
    void this.finalize(); return this.drained.promise;
  }
  private async finalize(): Promise<void> {
    if (!this.sealed || this.active || this.finalized) return;
    this.finalized = true;
    const entries = [...this.entries.values()];
    const safe = entries.length > 0 && !this.poisoned && entries.every((e) => e.done && e.granted && e.facts
      && [e.facts.processTerminal, e.facts.turnTerminal, e.facts.streams, e.facts.executionDrain, e.facts.runner].every((v) => v.status === "confirmed"));
    const terminal: ExecutionTerminalEvidence = Object.fromEntries(["processTerminal", "turnTerminal", "streams"].map((p) => [p,
      safe ? confirmed("leader-sealed-all-native-invocations-drained") : unknown("leader-native-invocations-unconfirmed")])) as ExecutionTerminalEvidence;
    let resources: Pick<ExecutionCleanupEvidence, "executionRoot" | "links" | "temp"> = {
      executionRoot: unknown("leader-source-drain-unconfirmed"), links: unknown("leader-source-drain-unconfirmed"), temp: unknown("leader-source-drain-unconfirmed") };
    if (safe) { try { resources = await this.release(); } catch { /* required resources remain unknown */ } }
    let tab = unknown("eh-tab-release-unavailable");
    if (safe && this.releaseTab) {
      try { tab = await this.releaseTab(this.identity); } catch { tab = { status: "failed", reason: "leader-tab-release-failed" }; }
    }
    this.terminal.resolve(terminal);
    this.drained.resolve({ ...resources, runner: safe ? confirmed("leader-all-exclusive-native-attachments-closed-and-leases-drained") : unknown("leader-native-session-drain-unconfirmed"), tab });
  }
}
