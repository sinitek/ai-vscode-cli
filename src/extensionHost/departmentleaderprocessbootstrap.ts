import { fork, type ChildProcess } from "child_process";
import { createHash, randomBytes } from "crypto";
import * as path from "path";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import { cleanupComplete, isDepartmentExecutionIdentity, isExecutionCleanup, record, sameExecution,
  type CleanupResult, type DepartmentExecutionIdentity } from "../runtime/departmentexecutionidentity";
import type { ExecutionObservation, ExecutionTerminalEvidence } from "../runtime/departmentexecutionowner";
import { departmentLeaderProcessRequirements, isDepartmentLeaderProcessInvocation, isDepartmentLeaderProcessPreparation,
  DEPARTMENT_LEADER_PROCESS_INVOCATION_LIMIT, type DepartmentLeaderProcessInvocation, type DepartmentLeaderProcessPreparation } from "../runtime/departmentleaderprocesscontract";
import type { ExecutionCleanupEvidence } from "../runtime/departmentexecutionowner";

const MAX_PRIVATE_MESSAGE_BYTES = 64 * 1024;
const MAX_OUTPUT_CHUNK_BYTES = 16 * 1024;
export type DepartmentLeaderProcessBootstrapHost = {
  /** Synchronous check of authority and the exact durable Store binding. */
  assertCurrent(identity: DepartmentExecutionIdentity): void;
  /** Real consumer completion, not merely successful event enqueue. */
  onOutput(identity: DepartmentExecutionIdentity, invocationId: string, stream: "stdout" | "stderr", chunk: string): void | Promise<void>;
  drainConsumers(identity: DepartmentExecutionIdentity, invocationId: string): boolean | Promise<boolean>;
  releaseExecutionRoot?(identity: DepartmentExecutionIdentity): Promise<CleanupResult>;
  releaseTab(identity: DepartmentExecutionIdentity): Promise<CleanupResult>;
};
export type DepartmentLeaderProcessBootstrapPort = {
  invoke(invocation: DepartmentLeaderProcessInvocation, signal?: AbortSignal): Promise<ExecutionTerminalEvidence>;
  closeAdmissionsAndDrain(): Promise<ExecutionCleanupEvidence>;
  disconnect(): void;
  observe(): Promise<ExecutionObservation>;
};
type InvocationEntry = { digest: string; promise: Promise<ExecutionTerminalEvidence>; granted: boolean; cancelled: boolean;
  cancel?: () => void; resolve?: (terminal: ExecutionTerminalEvidence) => void; reject?: (error: Error) => void };
function bounded(value: unknown): boolean {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_PRIVATE_MESSAGE_BYTES; } catch { return false; }
}

/** Trusted Extension Host port for one bound OpenCode leader generation. The
 * public Owner socket stays restricted to execution identity operations. */
export function createDepartmentLeaderProcessBootstrap(preparation: Omit<DepartmentLeaderProcessPreparation, "token">,
  host: DepartmentLeaderProcessBootstrapHost): DepartmentLeaderProcessBootstrapPort {
  const fixed = structuredClone({ ...preparation, token: randomBytes(32).toString("hex") });
  if (!isDepartmentLeaderProcessPreparation(fixed) || fixed.hostExecutionRoot && !host.releaseExecutionRoot) throw new Error("department-leader-process-preparation-invalid");
  const identity = structuredClone(fixed.identity);
  host.assertCurrent(identity);
  const child: ChildProcess = fork(path.join(__dirname, "..", "runtime", "departmentleaderprocessownerworker.js"), [], {
    detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.unref();
  let inbound = 0, outbound = 0, readyResolve!: () => void, readyReject!: (error: Error) => void;
  let drainedResolve!: (cleanup: ExecutionCleanupEvidence) => void, drainedReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const drained = new Promise<ExecutionCleanupEvidence>((resolve, reject) => { drainedResolve = resolve; drainedReject = reject; });
  let stoppedResolve!: () => void, stoppedReject!: (error: Error) => void;
  const stopped = new Promise<void>((resolve, reject) => { stoppedResolve = resolve; stoppedReject = reject; });
  void stopped.catch(() => undefined);
  void ready.catch(() => undefined); void drained.catch(() => undefined);
  const entries = new Map<string, InvocationEntry>();
  let active: InvocationEntry | undefined, activeId: string | undefined;
  let sealed = false, disconnected = false, sequenceFailed = false, stoppedObserved = false, sealSent = false;
  let closePromise: Promise<ExecutionCleanupEvidence> | undefined;
  let closeFailure: Error | undefined;
  const client = new DepartmentExecutionOwnerClient(fixed.ownerDirectory);
  let completedReceipt: Awaited<ReturnType<DepartmentExecutionOwnerClient["waitForCleanup"]>> | undefined;
  const send = (operation: string, fields: Record<string, unknown> = {}) => {
    const message = { version: 1, token: fixed.token, identity, sequence: ++outbound, operation, ...fields };
    if (!child.connected || !bounded(message)) throw new Error("department-leader-process-private-channel-unavailable");
    child.send(message, (error) => { if (error) fail(error); });
  };
  const sendSeal = () => {
    if (sealSent || disconnected || sequenceFailed) return;
    send("seal");
    sealSent = true;
  };
  const fail = (error: unknown) => {
    if (sequenceFailed) return;
    sequenceFailed = true;
    sealed = true;
    const e = error instanceof Error ? error : new Error("department-leader-process-private-channel-failed");
    readyReject(e); drainedReject(e); stoppedReject(e);
    for (const entry of entries.values()) {
      if (!entry.granted) entry.cancel?.();
      entry.reject?.(e);
      entry.resolve = undefined;
      entry.reject = undefined;
    }
    active = undefined;
    activeId = undefined;
  };
  const respond = (sequence: number, ok: boolean, result: unknown = null) => send("ack", { requestSequence: sequence, ok, result });
  const onMessage = (message: unknown) => {
    if (!record(message) || !bounded(message) || message.version !== 1 || message.token !== fixed.token
      || !isDepartmentExecutionIdentity(message.identity) || !sameExecution(message.identity, identity)
      || message.sequence !== inbound + 1 || typeof message.type !== "string") { fail(new Error("department-leader-process-private-message-invalid")); return; }
    inbound++;
    const base = ["version", "token", "identity", "sequence", "type"];
    try {
      if (message.type === "ready" && exact(message, [...base, "requirements"])) {
        if (JSON.stringify(message.requirements) !== JSON.stringify(requirementsFor(fixed))) throw new Error("department-leader-process-requirements-conflict");
        if (!sealed) host.assertCurrent(identity);
        readyResolve(); return;
      }
      if (message.type === "failed" && exact(message, [...base, "reason"]) && typeof message.reason === "string") {
        fail(new Error("department-leader-process-worker-preparation-failed")); return;
      }
      if (message.type === "grant-request" && exact(message, [...base, "requestSequence", "invocationId"])
        && Number.isSafeInteger(message.requestSequence) && typeof message.invocationId === "string"
        && message.invocationId === activeId && active && !active.granted) {
        const invocation = entries.get(message.invocationId);
        if (!invocation) throw new Error("department-leader-process-grant-without-invocation");
        if (invocation.cancelled || sealed) {
          respond(Number(message.requestSequence), false);
          return;
        }
        try { host.assertCurrent(identity); }
        catch {
          invocation.cancelled = true;
          respond(Number(message.requestSequence), false);
          return;
        }
        if (invocation.cancelled || sealed) {
          respond(Number(message.requestSequence), false);
          return;
        }
        // Linearization point: synchronous final authority check, then one-use ACK with no await.
        invocation.granted = true;
        respond(Number(message.requestSequence), true);
        return;
      }
      if (message.type === "output" && exact(message, [...base, "requestSequence", "invocationId", "stream", "chunk"])
        && Number.isSafeInteger(message.requestSequence) && message.invocationId === activeId
        && (message.stream === "stdout" || message.stream === "stderr") && typeof message.chunk === "string"
        && Buffer.byteLength(message.chunk, "utf8") <= MAX_OUTPUT_CHUNK_BYTES) {
        void Promise.resolve(host.onOutput(identity, String(message.invocationId), message.stream, message.chunk))
          .then(() => { try { respond(Number(message.requestSequence), true); } catch (error) { fail(error); } }, (error) => {
            try { respond(Number(message.requestSequence), false); } catch {}
            fail(error);
          });
        return;
      }
      if (message.type === "drain-consumers" && exact(message, [...base, "requestSequence", "invocationId"])
        && Number.isSafeInteger(message.requestSequence) && message.invocationId === activeId) {
        void Promise.resolve(host.drainConsumers(identity, String(message.invocationId)))
          .then((ok) => { try { respond(Number(message.requestSequence), ok, ok); } catch (error) { fail(error); } }, (error) => {
            try { respond(Number(message.requestSequence), false); } catch {}
            fail(error);
          });
        return;
      }
      if (message.type === "release-root" && exact(message, [...base, "requestSequence"])
        && Number.isSafeInteger(message.requestSequence) && sealed && fixed.hostExecutionRoot && host.releaseExecutionRoot) {
        void host.releaseExecutionRoot(identity).then((result) => {
          try { respond(Number(message.requestSequence), true, result); } catch (error) { fail(error); }
        }, fail);
        return;
      }
      if (message.type === "release-tab" && exact(message, [...base, "requestSequence"]) && Number.isSafeInteger(message.requestSequence) && sealed) {
        void host.releaseTab(identity).then((result) => {
          const empty = Object.fromEntries(["processTerminal", "turnTerminal", "streams", "runner", "executionRoot", "links", "temp"].map((part) =>
            [part, { status: "not-applicable", reason: "tab-result-validation" }])) as Record<string, unknown>;
          const accepted = isExecutionCleanup({ ...empty, tab: result }) ? result : { status: "unobservable", reason: "leader-tab-result-invalid" };
          try { respond(Number(message.requestSequence), true, accepted); } catch (error) { fail(error); }
        }, (error) => {
          try { respond(Number(message.requestSequence), false); } catch {}
          fail(error);
        });
        return;
      }
      if (message.type === "settled" && exact(message, [...base, "invocationId", "terminal"])
        && typeof message.invocationId === "string" && message.invocationId === activeId && record(message.terminal)) {
        const entry = entries.get(message.invocationId);
        if (!entry || (!entry.granted && !entry.cancelled)) throw new Error("department-leader-process-settled-without-grant");
        const resolve = entry.resolve;
        if (!resolve) throw new Error("department-leader-process-invocation-resolver-missing");
        if (!validTerminal(message.terminal)) throw new Error("department-leader-process-terminal-invalid");
        resolve(message.terminal); active = undefined; activeId = undefined;
        if (sealed) sendSeal();
        return;
      }
      if (message.type === "drained" && exact(message, [...base, "cleanup"]) && sealed && record(message.cleanup)) {
        const cleanup = message.cleanup as ExecutionCleanupEvidence;
        const complete = { processTerminal: { status: "confirmed", evidence: "validation" }, turnTerminal: { status: "not-applicable", reason: "validation" },
          streams: { status: "confirmed", evidence: "validation" }, ...cleanup };
        if (!isExecutionCleanup(complete) || !cleanupComplete(complete, requirementsFor(fixed))) throw new Error("department-leader-process-cleanup-invalid");
        drainedResolve(cleanup); return;
      }
      if (message.type === "stopped" && exact(message, base) && sealed) { stoppedObserved = true; stoppedResolve(); return; }
      throw new Error("department-leader-process-private-message-unexpected");
    } catch (error) { fail(error); }
  };
  child.on("message", onMessage);
  child.on("error", fail);
  child.on("exit", (code) => { disconnected = true; if (!stoppedObserved) fail(new Error(`department-leader-process-worker-exit-${code ?? "unknown"}`)); });
  child.on("disconnect", () => { disconnected = true; if (!stoppedObserved) fail(new Error("department-leader-process-worker-disconnected")); });
  child.send(fixed, (error) => { if (error) fail(error); });

  function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  }
  async function waitUntilReady() {
    await ready;
    host.assertCurrent(identity);
  }
  const port: DepartmentLeaderProcessBootstrapPort = {
    invoke(invocation, signal) {
      if (!isDepartmentLeaderProcessInvocation(invocation)) return Promise.reject(new Error("department-leader-process-invocation-invalid"));
      const immutable = Object.freeze({ invocationId: invocation.invocationId, prompt: invocation.prompt });
      const digest = createHash("sha256").update(JSON.stringify([identity.executionId, immutable.invocationId, immutable.prompt])).digest("hex");
      const previous = entries.get(immutable.invocationId);
      if (previous) return previous.digest === digest ? previous.promise : Promise.reject(new Error("department-leader-process-invocation-conflict"));
      if (sealed || sequenceFailed || active) return Promise.reject(new Error("department-leader-process-admission-closed-or-busy"));
      if (entries.size >= DEPARTMENT_LEADER_PROCESS_INVOCATION_LIMIT) return Promise.reject(new Error("department-leader-process-capacity"));
      if (signal?.aborted) return Promise.reject(new Error("department-leader-process-invocation-cancelled"));
      let resolve!: (terminal: ExecutionTerminalEvidence) => void, reject!: (error: Error) => void;
      const promise = new Promise<ExecutionTerminalEvidence>((yes, no) => { resolve = yes; reject = no; });
      void promise.catch(() => undefined);
      const entry: InvocationEntry = { digest, promise, granted: false, cancelled: false, resolve, reject };
      entries.set(immutable.invocationId, entry); active = entry; activeId = immutable.invocationId;
      let sent = false;
      const cancelBeforeGrant = () => {
        if (entry.granted) return;
        entry.cancelled = true;
        if (sent) { try { send("cancel"); } catch {} }
      };
      entry.cancel = cancelBeforeGrant;
      signal?.addEventListener("abort", cancelBeforeGrant, { once: true });
      void waitUntilReady().then(() => {
        if (signal?.aborted || sealed || entry.cancelled) {
          entry.cancelled = true;
          entry.reject?.(new Error("department-leader-process-invocation-cancelled"));
          active = undefined; activeId = undefined;
          if (sealed) sendSeal();
          return;
        }
        send("invoke", { invocation: immutable }); sent = true;
      }).catch((error) => {
        entry.reject?.(error instanceof Error ? error : new Error("leader-invoke-failed"));
        active = undefined; activeId = undefined;
        fail(error);
      });
      void promise.then(() => signal?.removeEventListener("abort", cancelBeforeGrant), () => signal?.removeEventListener("abort", cancelBeforeGrant));
      return promise;
    },
    closeAdmissionsAndDrain() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
      if (!sealed) {
        sealed = true;
        if (active && !active.granted) active.cancel?.();
      }
      if (!disconnected && !sequenceFailed) {
        // Closure consumes no launch authority. The producer already sealed
        // canLaunch, so only invocation/grant paths may demand that authority.
        await ready;
        if (!active) sendSeal();
      }
      const cleanup = await drained;
      const receipt = await client.waitForCleanup(identity, requirementsFor(fixed)).catch(() => undefined);
      if (!receipt) throw new Error("department-leader-process-cleanup-receipt-unobservable");
      send("shutdown");
      await stopped;
      completedReceipt = receipt;
      return cleanup;
      })().catch((error: unknown) => {
        closeFailure = error instanceof Error ? error : new Error("department-leader-process-close-unobservable");
        throw closeFailure;
      });
      return closePromise;
    },
    disconnect() {
      if (stoppedObserved || disconnected) return;
      if (!sealed) {
        sealed = true;
        if (active && !active.granted) active.cancel?.();
      }
      if (!active) { try { sendSeal(); } catch {} }
      if (!disconnected) child.disconnect();
    },
    observe() {
      if (closeFailure) return Promise.resolve({ status: "unknown", identity: structuredClone(identity), reason: "department-leader-process-close-unconfirmed" });
      if (completedReceipt && stoppedObserved) {
        return Promise.resolve({ status: "cleaned", identity: structuredClone(identity), receipt: structuredClone(completedReceipt) });
      }
      if (closePromise || disconnected || sequenceFailed) {
        return Promise.resolve({ status: "unknown", identity: structuredClone(identity), reason: "department-leader-process-close-unconfirmed" });
      }
      return client.observeExecution(identity).then((observation) => {
        if (closeFailure || closePromise || disconnected || sequenceFailed) {
          return { status: "unknown", identity: structuredClone(identity), reason: "department-leader-process-close-unconfirmed" };
        }
        if (observation.status === "cleaned") {
          return { status: "unknown", identity: structuredClone(identity), reason: "department-leader-process-receipt-unconfirmed" };
        }
        return observation;
      });
    },
  };
  return port;
}

const requirementsFor = departmentLeaderProcessRequirements;

function validTerminal(value: unknown): value is ExecutionTerminalEvidence {
  return record(value) && ["processTerminal", "turnTerminal", "streams"].every((key) => {
    const item = value[key];
    return record(item) && (item.status === "confirmed" && typeof item.evidence === "string"
      || ["failed", "unobservable", "not-applicable"].includes(item.status as string) && typeof item.reason === "string");
  }) && ["confirmed", "failed", "unobservable"].includes((value.processTerminal as Record<string, unknown>).status as string)
    && ["confirmed", "failed", "unobservable"].includes((value.streams as Record<string, unknown>).status as string);
}
