import * as fs from "fs";
import { SharedRuntimeConfig } from "../config/sharedRuntimeConfig";
import { createLoopSubtaskExecutionRoot } from "../loopSubtaskExecutionRoot";
import { DepartmentExecutionOwnerServer } from "./departmentexecutionowner";
import { DepartmentExecutionOwnerClient } from "./departmentexecutionownerclient";
import { exactKeys, isDepartmentExecutionIdentity, isExecutionCleanup, record, sameExecution,
  type CleanupResult, type DepartmentExecutionIdentity } from "./departmentexecutionidentity";
import { DepartmentLeaderProcessOwner } from "./departmentleaderprocessowner";
import { departmentLeaderProcessRequirements, isDepartmentLeaderProcessInvocation, isDepartmentLeaderProcessPreparation,
  type DepartmentLeaderProcessPreparation } from "./departmentleaderprocesscontract";

const MAX_MESSAGE_BYTES = 64 * 1024;
function bounded(value: unknown): boolean {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_MESSAGE_BYTES; } catch { return false; }
}

/** Fixed Node worker. Executable and prompt capability arrive only through its
 * inherited, token-authenticated private channel; the public owner endpoint is identity-only. */
export async function runDepartmentLeaderProcessOwnerWorker(): Promise<void> {
  let input: DepartmentLeaderProcessPreparation | undefined;
  let owner: DepartmentLeaderProcessOwner | undefined;
  let server: DepartmentExecutionOwnerServer | undefined;
  let sequenceIn = 0, sequenceOut = 0, admissionClosed = false, failed = false, busy = false;
  let receiptReady = false, sealRequested = false, sealStarted = false, shutdownRequested = false, shutdownStarted = false, stoppedSent = false;
  let activeInvocationId: string | undefined;
  let activeAbort: AbortController | undefined;
  let outputPending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const send = (type: string, fields: Record<string, unknown> = {}) => {
    const message = { version: 1, type, token: input!.token, identity: input!.identity, sequence: ++sequenceOut, ...fields };
    if (!process.connected || !bounded(message)) throw new Error("department-leader-process-private-channel-unavailable");
    process.send!(message, (error: Error | null) => { if (error) fail(); });
  };
  const fail = () => {
    if (failed || stoppedSent) return;
    failed = true;
    admissionClosed = true;
    for (const pending of outputPending.values()) pending.reject(new Error("department-leader-process-private-channel-lost"));
    outputPending.clear();
    if (owner) void owner.seal().then(() => server?.close().catch(() => undefined));
    if (process.connected) process.disconnect();
  };
  const stopAfterReceipt = () => {
    if (!shutdownRequested || !receiptReady || busy || shutdownStarted || failed || !server) return;
    shutdownStarted = true;
    void server.close().then(() => { send("stopped"); stoppedSent = true; setImmediate(() => process.disconnect()); }, fail);
  };
  const sealOwner = () => {
    if (sealStarted || !owner) return;
    sealStarted = true;
    admissionClosed = true;
    void owner.seal().then(async (cleanup) => {
      send("drained", { cleanup });
      const receipt = await new DepartmentExecutionOwnerClient(input!.ownerDirectory).waitForCleanup(input!.identity,
        departmentLeaderProcessRequirements(input!)).catch(() => undefined);
      if (!receipt) throw new Error("department-leader-process-receipt-unobservable");
      receiptReady = true;
      stopAfterReceipt();
    }).catch(fail);
  };
  const request = (type: "grant-request" | "output" | "drain-consumers" | "release-tab" | "release-root", fields: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = sequenceOut + 1;
      outputPending.set(id, { resolve, reject });
      try { send(type, { requestSequence: id, ...fields }); }
      catch (error) { outputPending.delete(id); reject(error instanceof Error ? error : new Error("private-send-failed")); }
    });
  process.on("disconnect", fail);
  process.on("message", (message: unknown) => {
    if (!input) {
      if (!isDepartmentLeaderProcessPreparation(message)) { fail(); return; }
      input = structuredClone(message);
      void prepare().catch((error) => { try { send("failed", { reason: error instanceof Error ? error.message : "preparation-failed" }); } catch {} fail(); });
      return;
    }
    if (!record(message) || !bounded(message) || message.version !== 1 || message.token !== input.token
      || !isDepartmentExecutionIdentity(message.identity) || !sameExecution(message.identity, input.identity)
      || message.sequence !== sequenceIn + 1) { fail(); return; }
    sequenceIn++;
    const base = ["version", "token", "identity", "sequence", "operation"];
    if (message.operation === "ack" && exactKeys(message, [...base, "requestSequence", "ok", "result"])
      && Number.isSafeInteger(message.requestSequence) && typeof message.ok === "boolean") {
      const pending = outputPending.get(Number(message.requestSequence));
      if (!pending) { fail(); return; }
      outputPending.delete(Number(message.requestSequence));
      if (message.ok) pending.resolve(message.result); else pending.reject(new Error("department-leader-process-host-rejected"));
      return;
    }
    if (message.operation === "shutdown" && exactKeys(message, base) && admissionClosed) {
      shutdownRequested = true;
      stopAfterReceipt();
      return;
    }
    if (failed || admissionClosed) { fail(); return; }
    if (message.operation === "invoke" && !busy && exactKeys(message, [...base, "invocation"])
      && isDepartmentLeaderProcessInvocation(message.invocation)) {
      busy = true; activeAbort = new AbortController();
      const invocation = message.invocation;
      activeInvocationId = invocation.invocationId;
      const invocationSignal = activeAbort.signal;
      void owner!.invoke(invocation, invocationSignal, {
        async authorize() { await request("grant-request", { invocationId: invocation.invocationId }); },
        async drainConsumers() { await request("drain-consumers", { invocationId: invocation.invocationId }); return true; },
      }).then((terminal) => {
        busy = false; activeAbort = undefined; activeInvocationId = undefined;
        send("settled", { invocationId: invocation.invocationId, terminal });
        if (sealRequested) sealOwner();
      }, fail);
      return;
    }
    if (message.operation === "cancel" && busy && exactKeys(message, base)) { activeAbort?.abort(); return; }
    if (message.operation === "seal" && exactKeys(message, base)) {
      if (sealRequested) { fail(); return; }
      admissionClosed = true;
      sealRequested = true;
      if (!busy) sealOwner();
      return;
    }
    fail();
  });

  async function prepare(): Promise<void> {
    const i = input!;
    const config = new SharedRuntimeConfig(i.configurationDirectory);
    const lease = await config.acquire({ configId: i.selection.configId, revision: i.selection.revision });
    if (!process.connected || !lease.selection.ready || lease.selection.configId !== i.selection.configId
      || lease.selection.revision !== i.selection.revision || !config.isCurrentSelection({ configId: i.selection.configId, revision: i.selection.revision })) {
      await lease.release(); throw new Error("department-leader-process-configuration-conflict");
    }
    const root = i.hostExecutionRoot ? null : createLoopSubtaskExecutionRoot(i.launch.cwd);
    let disposed = false;
    owner = new DepartmentLeaderProcessOwner({ ...i, launch: { ...i.launch, cwd: root?.cwd ?? i.launch.cwd } }, async () => {
      if (disposed) return { runner: { status: "failed", reason: "leader-root-release-repeated" }, executionRoot: { status: "failed", reason: "leader-root-release-repeated" },
        links: { status: "failed", reason: "leader-root-release-repeated" }, temp: { status: "failed", reason: "leader-root-release-repeated" },
        tab: { status: "unobservable", reason: "leader-tab-pending" } };
      disposed = true;
      const result = root?.dispose();
      const released = i.hostExecutionRoot ? await request("release-root").catch(() => undefined) : undefined;
      const rootFact: CleanupResult = root
        ? result?.ok && !result.retainedDirectory
          ? { status: "confirmed", evidence: "leader-owned-root-and-links-removed" }
          : { status: "failed", reason: "leader-owned-root-or-links-retained" }
        : record(released) && (released.status === "confirmed" && typeof released.evidence === "string"
          || ["failed", "unobservable"].includes(String(released.status)) && typeof released.reason === "string")
          ? released as CleanupResult : { status: "unobservable", reason: "leader-owned-root-release-unconfirmed" };
      if (rootFact.status !== "confirmed") throw new Error("leader-owned-root-release-unconfirmed");
      await lease.release();
      const base = { processTerminal: { status: "confirmed", evidence: "owner-generation-drained" },
        turnTerminal: { status: "not-applicable", reason: "per-invocation-turn-terminal" },
        streams: { status: "confirmed", evidence: "owner-generation-drained" }, runner: { status: "confirmed", evidence: "owner-config-lease-released" },
        executionRoot: rootFact, links: rootFact,
        temp: i.launch.overlay ? { status: "confirmed", evidence: "invocation-overlays-released" } : { status: "not-applicable", reason: "no-owner-temp-overlay" },
        tab: { status: "unobservable", reason: "leader-tab-pending" } };
      const tabResult = await request("release-tab").catch(() => undefined);
      const tab = isExecutionCleanup({ ...base, tab: tabResult }) ? tabResult as CleanupResult
        : { status: "unobservable", reason: "leader-tab-release-unconfirmed" } as CleanupResult;
      return { runner: { status: "confirmed", evidence: "leader-config-lease-released-after-process-drain" },
        executionRoot: rootFact, links: rootFact,
        temp: i.launch.overlay ? { status: "confirmed", evidence: "invocation-overlays-released-by-process-lifecycle" }
          : { status: "not-applicable", reason: "no-owner-temp-overlay" },
        tab };
    }, {
      async onStdout(chunk) { await request("output", { invocationId: activeInvocationId, stream: "stdout", chunk }); },
      async onStderr(chunk) { await request("output", { invocationId: activeInvocationId, stream: "stderr", chunk }); },
    });
    fs.mkdirSync(i.ownerDirectory, { recursive: true, mode: 0o700 });
    server = new DepartmentExecutionOwnerServer({ directory: i.ownerDirectory, ownerId: i.identity.ownerId, launcher: { ...owner.launcher, seal() {
      admissionClosed = true; sealRequested = true; activeAbort?.abort(); if (!busy) sealOwner();
    } } });
    await server.listen();
    const live = await new DepartmentExecutionOwnerClient(i.ownerDirectory).startExecution(i.identity);
    if (live.status !== "live" || !process.connected) throw new Error("department-leader-process-owner-start-unobservable");
    send("ready", { requirements: departmentLeaderProcessRequirements(i) });
  }
}

if (require.main === module) {
  if (!process.send) process.exitCode = 1;
  else void runDepartmentLeaderProcessOwnerWorker();
}
