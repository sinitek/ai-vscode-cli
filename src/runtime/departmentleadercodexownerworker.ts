import * as fs from "fs";
import { createLoopSubtaskExecutionRoot } from "../loopSubtaskExecutionRoot";
import { DepartmentExecutionOwnerServer } from "./departmentexecutionowner";
import { DepartmentExecutionOwnerClient } from "./departmentexecutionownerclient";
import { exactKeys, isDepartmentExecutionIdentity, record, sameExecution, type CleanupResult } from "./departmentexecutionidentity";
import { boundedCodexMessage, isCodexResourceResult } from "./departmentcodexpreparationcontract";
import { DepartmentLeaderCodexOwner } from "./departmentleadercodexowner";
import { isDepartmentLeaderPrivateCommand } from "./departmentleaderinvocation";
import { isLeaderCodexPreparation, isLeaderInvocation, LEADER_CALLBACK_LIMIT, LEADER_CALLBACKS, LEADER_REQUIREMENTS,
  LEADER_WORKER_FAILURES, type LeaderCodexPreparation } from "./departmentleadercodexcontract";
import { leaderCallbackFrames, LEADER_CALLBACK_PENDING_BYTES } from "./departmentleadercodexcontract";
import type { CodexOwnedStreamHandlers } from "../interactive/codexOwnedExecution";

/** Fixed ordinary Node process. Executables/configuration arrive once from the
 * inherited host capability; the public Owner socket remains identity-only. */
export async function runDepartmentLeaderCodexWorker(): Promise<void> {
  let input: LeaderCodexPreparation | undefined, owner: DepartmentLeaderCodexOwner | undefined, server: DepartmentExecutionOwnerServer | undefined;
  let closed = false, phase: "preparing" | "idle" | "running" | "persisting" | "persisted" | "granting" | "granted" = "preparing";
  let incoming = 0, outgoing = 0, invocationId = "";
  let persist: (() => void) | undefined, grant: (() => void) | undefined;
  const rejects = new Set<(e: Error) => void>();
  let consumerFailed = false;
  let tabRelease: Promise<CleanupResult> | undefined;
  const consumers = new Set<Promise<unknown>>();
  const notificationConsumers = new Set<Promise<unknown>>();
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; bytes?: number }>();
  let pendingBytes = 0;
  const seal = (): void => {
    if (closed) return; closed = true;
    for (const reject of rejects) reject(new Error("leader-private-gate-revoked"));
    rejects.clear(); persist = undefined; grant = undefined;
    if (owner) void owner.seal().then(async (cleanup) => {
      try { send({ type: "drained", cleanup }); } catch { /* retain unknown on host loss */ }
      // Keep the original socket alive through the host's strict receipt
      // observation. drained is only a pacing event, never cleanup evidence.
      if (!process.connected) void server?.close().catch(() => undefined);
    });
  };
  let failureReported = false;
  const lost = (stage: typeof LEADER_WORKER_FAILURES[number] = "private-channel-lost"): void => {
    if (!failureReported && input && process.connected) {
      failureReported = true;
      // Bypass callback consumers: their failure may be the reason for sealing.
      // Never include error text, payloads, prompt, token or environment in logs.
      try { process.send!({ version: 1, token: input.token, identity: input.identity,
        sequence: ++outgoing, type: "failure", stage }, () => undefined); } catch { /* host remains unknown */ }
    }
    seal();
    for (const p of pending.values()) p.reject(new Error("leader-consumer-unobservable"));
    pending.clear(); pendingBytes = 0;
    if (closed && server) void owner?.seal().then(() => server?.close()).catch(() => undefined);
    if (process.connected) process.disconnect();
  };
  const send = (event: Record<string, unknown>) => {
    const message = { version: 1, token: input!.token, identity: input!.identity, sequence: outgoing + 1, ...event };
    if (!process.connected || !boundedCodexMessage(message)) throw new Error("leader-private-channel-unobservable");
    outgoing++;
    process.send!(message, (error: Error | null) => { if (error) lost("private-send-failed"); });
  };
  const consume = (name: string, args: unknown[]): Promise<unknown> => {
    if (pending.size >= LEADER_CALLBACK_LIMIT) { lost("callback-capacity"); return Promise.reject(new Error("leader-consumer-capacity")); }
    const task = new Promise((resolve, reject) => {
      if (!process.connected) { reject(new Error("leader-consumer-unobservable")); lost("callback-channel-disconnected"); return; }
      let encoded: ReturnType<typeof leaderCallbackFrames>;
      try {
        encoded = leaderCallbackFrames({ version: 1, token: input!.token, identity: input!.identity, sequence: outgoing + 1 }, invocationId, name, args);
        if (pendingBytes + encoded.bytes > LEADER_CALLBACK_PENDING_BYTES) throw new Error("callback-size-limit");
      } catch (error) {
        const stage = error instanceof Error && (error.message === "callback-size-limit" || error.message === "callback-serialization-failed")
          ? error.message : "callback-message-rejected";
        reject(new Error("leader-consumer-unobservable")); lost(stage); return;
      }
      const seq = outgoing + 1; pending.set(seq, { resolve, reject, bytes: encoded.bytes }); pendingBytes += encoded.bytes;
      try {
        // Synchronous enqueue preserves logical callback order. One pending slot
        // and one ACK at the original first sequence, regardless of chunk count.
        for (const frame of encoded.frames) {
          if (!process.connected) throw new Error("callback-channel-disconnected");
          outgoing++;
          process.send!(frame, (error: Error | null) => { if (error) lost("private-send-failed"); });
        }
      } catch { lost("callback-channel-disconnected"); }
    });
    consumers.add(task);
    if (name !== "onRequest") notificationConsumers.add(task);
    void task.then(() => notificationConsumers.delete(task), () => notificationConsumers.delete(task));
    void task.then(() => consumers.delete(task), () => { consumerFailed = true; consumers.delete(task); });
    return task;
  };
  const gate = (type: "session" | "owner-bound", extra: Record<string, unknown>): Promise<void> => new Promise((resolve, reject) => {
    const accept = () => { rejects.delete(reject); resolve(); };
    rejects.add(reject);
    if (type === "session") { phase = "persisting"; persist = accept; } else { phase = "granting"; grant = accept; }
    try { send({ type, invocationId, ...extra }); } catch { lost(); }
  });
  process.on("disconnect", () => lost());
  process.on("message", (v: unknown) => {
    if (!input) {
      if (!isLeaderCodexPreparation(v)) { lost(); return; }
      input = structuredClone(v);
      void prepare().catch(() => lost("preparation-failed")); return;
    }
    if (!record(v) || !isDepartmentLeaderPrivateCommand(v) || v.version !== 1 || v.token !== input.token
      || !isDepartmentExecutionIdentity(v.identity) || !sameExecution(v.identity, input.identity) || v.sequence !== incoming + 1) { lost("private-command-rejected"); return; }
    incoming++;
    const base = ["version", "token", "identity", "sequence", "operation"];
    if (v.operation === "ack" && exactKeys(v, [...base, "callbackSequence", "ok", "result"]) && typeof v.ok === "boolean" && Number.isSafeInteger(v.callbackSequence)) {
      const p = pending.get(Number(v.callbackSequence));
      if (!p) { lost("callback-ack-unknown"); return; }
      pending.delete(Number(v.callbackSequence)); pendingBytes -= p.bytes ?? 0;
      if (v.ok) p.resolve(v.result); else p.reject(new Error("leader-consumer-rejected")); return;
    }
    if (v.operation === "seal" && exactKeys(v, base)) { seal(); return; }
    if (closed) { lost(); return; }
    if (v.operation === "invoke" && phase === "idle" && exactKeys(v, [...base, "invocation"]) && isLeaderInvocation(v.invocation)) {
      phase = "running"; invocationId = v.invocation.invocationId;
      const handlers = Object.fromEntries(LEADER_CALLBACKS.filter((n) => !n.startsWith("log")).map((name) => [name, (...args: unknown[]) => consume(name, args)])) as unknown as CodexOwnedStreamHandlers;
      handlers.requestUserInputEnabled = input.requestUserInputEnabled;
      const runtime = { macTaskShell: input.macTaskShell,
        async waitForNotificationConsumers() {
          while (notificationConsumers.size) await Promise.allSettled([...notificationConsumers]);
        },
        logInfo: async (...args: unknown[]) => { await consume("logInfo", args).catch(() => undefined); },
        logError: async (...args: unknown[]) => { await consume("logError", args).catch(() => undefined); } };
      void owner!.invoke(v.invocation, handlers, runtime, {
        persist: (session) => gate("session", { session }), authorize: () => gate("owner-bound", {}),
        async drainConsumers() { while (consumers.size) await Promise.allSettled([...consumers]); return !consumerFailed; },
      }).then((terminal) => {
        phase = "idle";
        try { send({ type: "settled", invocationId, terminal }); } catch { lost(); }
      }, () => lost("invocation-failed")); return;
    }
    if (v.operation === "persisted" && phase === "persisting" && v.invocationId === invocationId
      && exactKeys(v, [...base, "invocationId"]) && persist) {
      phase = "persisted"; const accept = persist; persist = undefined; accept(); return;
    }
    if (v.operation === "grant" && phase === "granting" && v.invocationId === invocationId
      && exactKeys(v, [...base, "invocationId"]) && grant) {
      // Consume synchronously before ACK: a subsequent seal cannot cancel this invocation.
      try { if (consumerFailed) throw new Error("leader-consumer-failed-before-grant"); owner!.grant(invocationId); phase = "granted"; const accept = grant; grant = undefined; send({ type: "granted", invocationId }); accept(); }
      catch { lost("grant-rejected"); } return;
    }
    lost("private-phase-rejected");
  });
  async function prepare(): Promise<void> {
    const i = input!;
    if (closed || !process.connected) throw new Error("leader-preparation-channel-closed");
    const root = createLoopSubtaskExecutionRoot(i.workspaceDirectory);
    owner = new DepartmentLeaderCodexOwner(i, root.cwd, async () => {
      const result = root.dispose();
      const fact: CleanupResult = result.ok && !result.retainedDirectory ? { status: "confirmed", evidence: "leader-owned-root-links-removed" }
        : { status: "failed", reason: "leader-owned-root-links-retained" };
      return { executionRoot: fact, links: fact, temp: { status: "confirmed", evidence: "no-owner-temp-resource-created" } };
    }, (identity) => tabRelease ??= (async () => {
      if (!closed || consumerFailed || !process.connected || pending.size || consumers.size) return { status: "unobservable", reason: "leader-tab-channel-or-consumers-unconfirmed" };
      try {
        const result = await new Promise<unknown>((resolve, reject) => {
          const seq = outgoing + 1; pending.set(seq, { resolve, reject });
          try { send({ type: "release-tab", resourceIdentity: identity }); }
          catch { pending.delete(seq); reject(new Error("leader-tab-channel-lost")); }
        });
        return isCodexResourceResult(result) ? result : { status: "unobservable", reason: "leader-tab-confirmation-invalid" };
      } catch { return { status: "unobservable", reason: "leader-tab-release-unconfirmed" }; }
    })());
    fs.mkdirSync(i.ownerDirectory, { recursive: true, mode: 0o700 });
    server = new DepartmentExecutionOwnerServer({ directory: i.ownerDirectory, ownerId: i.identity.ownerId, launcher: { ...owner.launcher, seal() { seal(); } } });
    await server.listen();
    const result = await new DepartmentExecutionOwnerClient(i.ownerDirectory).startExecution(i.identity);
    if (result.status !== "live" || closed || !process.connected) { seal(); throw new Error("leader-owner-unobservable"); }
    phase = "idle"; send({ type: "ready", requirements: LEADER_REQUIREMENTS });
  }
}
if (require.main === module) {
  if (!process.send) process.exitCode = 1; else void runDepartmentLeaderCodexWorker();
}
