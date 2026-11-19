import * as fs from "fs";
import { createLoopSubtaskExecutionRoot } from "../loopSubtaskExecutionRoot";
import { createDepartmentCodexExecutionLauncher } from "./departmentcodexexecutionlauncher";
import { DepartmentExecutionOwnerServer, type TrustedExecutionHandle } from "./departmentexecutionowner";
import { exactKeys, isDepartmentExecutionIdentity, record, sameExecution, type CleanupResult } from "./departmentexecutionidentity";
import { boundedCodexMessage, isCodexResourceResult, isDepartmentCodexPreparation, type DepartmentCodexPreparation } from "./departmentcodexpreparationcontract";
import { leaderCallbackFrames as codexOwnerCallbackFrames, LEADER_CALLBACK_LIMIT, LEADER_CALLBACK_PENDING_BYTES } from "./departmentleadercodexcontract";
import type { CodexOwnedStreamHandlers } from "../interactive/codexOwnedExecution";

/** Fixed ordinary Node worker; no dynamic worker/module, command or prompt public IPC. */
export async function runDepartmentCodexOwnerWorker(): Promise<void> {
  let phase: "empty" | "preparing" | "ready" | "binding" | "owner-bound" | "granted" | "failed" = "empty";
  let input: DepartmentCodexPreparation, server: DepartmentExecutionOwnerServer | undefined;
  const lifetime = new AbortController();
  let disposeRoot: (() => CleanupResult) | undefined;
  let handle: TrustedExecutionHandle | undefined, finished = false, sequence = 0;
  let consumerFailed = false;
  let nativeThread: string | undefined, tabRelease: Promise<CleanupResult> | undefined;
  const consumers = new Set<Promise<unknown>>();
  const notificationConsumers = new Set<Promise<unknown>>();
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; bytes?: number }>();
  let pendingBytes = 0;
  let persist: (() => void) | undefined, grant: (() => void) | undefined;
  let rejectGate: ((error: Error) => void) | undefined;
  const lost = (): void => {
    consumerFailed = true;
    const wasPreparing = phase === "preparing";
    if (phase !== "granted") { phase = "failed"; lifetime.abort(); rejectGate?.(new Error("codex-preparation-revoked")); }
    for (const entry of pending.values()) entry.reject(new Error("codex-consumer-unobservable"));
    pending.clear(); pendingBytes = 0;
    if (process.connected) process.disconnect?.();
    if (finished || !handle && !wasPreparing) void close();
  };
  const send = (event: Record<string, unknown>): void => {
    const message = { version: 1, token: input.token, identity: input.identity, sequence: ++sequence, ...event };
    if (!process.connected || !boundedCodexMessage(message)) throw new Error("codex-private-channel-unobservable");
    process.send!(message, (error: Error | null) => { if (error) lost(); });
  };
  const consume = (name: string, args: unknown[]): Promise<unknown> => {
    if (pending.size >= LEADER_CALLBACK_LIMIT) { consumerFailed = true; return Promise.reject(new Error("codex-consumer-capacity")); }
    const task = new Promise<unknown>((resolve, reject) => {
      if (!process.connected) { reject(new Error("codex-consumer-unobservable")); return; }
      const seq = sequence + 1;
      let encoded: ReturnType<typeof codexOwnerCallbackFrames>;
      try {
        encoded = codexOwnerCallbackFrames({ version: 1, token: input.token, identity: input.identity, sequence: seq }, input.identity.executionId, name, args);
        if (pendingBytes + encoded.bytes > LEADER_CALLBACK_PENDING_BYTES) throw new Error("codex-callback-byte-limit");
      } catch { reject(new Error("codex-output-lost")); lost(); return; }
      pending.set(seq, { resolve, reject, bytes: encoded.bytes }); pendingBytes += encoded.bytes;
      try {
        for (const frame of encoded.frames) {
          if (!process.connected) throw new Error("codex-private-channel-unobservable");
          sequence++;
          process.send!(frame, (error: Error | null) => { if (error) lost(); });
        }
      } catch { lost(); }
    });
    consumers.add(task);
    if (name !== "onRequest") notificationConsumers.add(task);
    const settle = (): void => { consumers.delete(task); notificationConsumers.delete(task); };
    void task.then(settle, () => { consumerFailed = true; settle(); });
    return task;
  };
  const close = async (): Promise<void> => {
    if (server) { try { await server.close(); } catch { return; } }
    if (!handle) disposeRoot?.();
  };
  const releaseTab = (): Promise<CleanupResult> => tabRelease ??= (async () => {
    if (!nativeThread || consumerFailed || !process.connected) return { status: "unobservable", reason: "codex-tab-channel-or-consumers-unconfirmed" };
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const seq = sequence + 1; pending.set(seq, { resolve, reject });
        try { send({ type: "release-tab", resourceIdentity: { ...input.identity, session: { state: "bound", id: nativeThread } } }); }
        catch { pending.delete(seq); reject(new Error("codex-tab-channel-lost")); }
      });
      return isCodexResourceResult(result) ? result : { status: "unobservable", reason: "codex-tab-confirmation-invalid" };
    } catch { return { status: "unobservable", reason: "codex-tab-release-unconfirmed" }; }
  })();
  process.on("disconnect", lost);
  process.on("message", (message: unknown) => {
    if (phase === "empty") {
      if (!isDepartmentCodexPreparation(message)) { phase = "failed"; process.disconnect?.(); return; }
      input = structuredClone(message); phase = "preparing";
      void prepare().catch(async () => { phase = "failed"; lifetime.abort(); await close(); if (process.connected) process.disconnect?.(); });
      return;
    }
    if (!record(message) || !boundedCodexMessage(message) || message.version !== 1 || message.token !== input.token
      || !isDepartmentExecutionIdentity(message.identity) || !sameExecution(message.identity, input.identity)) { lost(); return; }
    const base = ["version", "token", "identity", "operation"];
    if (message.operation === "ack" && exactKeys(message, [...base, "sequence", "ok", "result"])
      && typeof message.ok === "boolean" && Number.isSafeInteger(message.sequence)) {
      const entry = pending.get(Number(message.sequence));
      if (!entry) { lost(); return; }
      pending.delete(Number(message.sequence));
      pendingBytes -= entry.bytes ?? 0;
      if (message.ok) entry.resolve(message.result); else entry.reject(new Error("codex-consumer-rejected"));
      return;
    }
    if (message.operation === "persisted" && phase === "binding" && persist && exactKeys(message, base)) {
      const accept = persist; persist = undefined; accept(); return;
    }
    if (message.operation === "grant" && phase === "owner-bound" && grant && exactKeys(message, base) && process.connected) {
      // One-use linearization: no await between consuming the grant and releasing the binding latch.
      phase = "granted"; const accept = grant; grant = undefined;
      send({ type: "granted" }); accept(); return;
    }
    lost();
  });
  async function prepare(): Promise<void> {
    if (phase !== "preparing" || !process.connected) throw new Error("codex-preparation-revoked");
    const root = createLoopSubtaskExecutionRoot(input.workspaceDirectory);
    let rootResult: CleanupResult | undefined;
    disposeRoot = () => rootResult ??= (() => {
      const result = root.dispose();
      return result.ok && !result.retainedDirectory ? { status: "confirmed", evidence: "owned-root-links-removed" }
        : { status: "failed", reason: "owned-root-links-retained" };
    })();
    const handlers: CodexOwnedStreamHandlers = {
      onAssistantDelta: async (...args) => { await consume("onAssistantDelta", args); },
      onTrace: async (...args) => { await consume("onTrace", args); },
      onTaskListUpdate: async (...args) => { await consume("onTaskListUpdate", args); },
      onThreadId: async (...args) => { await consume("onThreadId", args); },
      onTurnCompleted: async (...args) => { await consume("onTurnCompleted", args); },
      onEvent: async (...args) => { await consume("onEvent", args); },
      onTokenUsageUpdate: async (...args) => { await consume("onTokenUsageUpdate", args); },
      onSubagentUpdate: async (...args) => { await consume("onSubagentUpdate", args); },
      onRequest: async (...args) => await consume("onRequest", args) as Awaited<ReturnType<NonNullable<CodexOwnedStreamHandlers["onRequest"]>>>,
      requestUserInputEnabled: input.requestUserInputEnabled,
    };
    const launcher = createDepartmentCodexExecutionLauncher((identity) => sameExecution(identity, input.identity) ? {
      identity: input.identity, selection: input.selection,
      session: identity.session.state === "bound" ? { intent: "resume", threadId: identity.session.id } : { intent: "new" },
      runner: { ...input.runner, cwd: root.cwd }, prompt: input.prompt, handlers, signal: lifetime.signal,
      runtime: { macTaskShell: input.macTaskShell,
        async waitForNotificationConsumers() {
          while (notificationConsumers.size) await Promise.allSettled([...notificationConsumers]);
        },
        logInfo: async (message, data) => { await consume("logInfo", [message, data ?? null]).catch(() => undefined); },
        logError: async (message, data) => { await consume("logError", [message, data ?? null]).catch(() => undefined); } },
      confirmSession: async (session) => {
        if (phase !== "ready" || !process.connected) throw new Error("codex-preparation-revoked");
        nativeThread = session.threadId; phase = "binding";
        await new Promise<void>((resolve, reject) => { persist = resolve; rejectGate = reject; send({ type: "session", session }); });
        if (lifetime.signal.aborted || !process.connected) throw new Error("codex-preparation-revoked");
        return session;
      },
      resources: {
        // Each owned transport is exclusive to this execution. Its real process
        // close, natural pipes/read loop and original thread lease drain release
        // the native attachment; resumable session history is deliberately kept.
        runner: { owned: true, release: (native) => native.runner },
        tab: { owned: true, release: releaseTab },
        executionRoot: { owned: true, release: disposeRoot }, links: { owned: true, release: disposeRoot },
        temp: { owned: true, release: async () => ({ status: "confirmed", evidence: "no-owner-temp-resource-created" }) },
      },
    } : null);
    const requirements = launcher.requirements(input.identity);
    fs.mkdirSync(input.ownerDirectory, { recursive: true, mode: 0o700 });
    server = new DepartmentExecutionOwnerServer({ directory: input.ownerDirectory, ownerId: input.identity.ownerId, launcher: {
      seal() { lifetime.abort(); },
      requirements(identity) { if (phase !== "ready") throw new Error("codex-owner-not-ready"); return launcher.requirements(identity); },
      async launch(identity, bind) {
        if (phase !== "ready" || !process.connected) throw new Error("codex-owner-not-ready");
        handle = await launcher.launch(identity, async (id) => {
          await bind(id);
          if (phase !== "binding" || lifetime.signal.aborted || !process.connected) throw new Error("codex-owner-binding-revoked");
          phase = "owner-bound";
          await new Promise<void>((resolve, reject) => { grant = resolve; rejectGate = reject; send({ type: "owner-bound" }); });
          rejectGate = undefined;
        });
        const owned = handle;
        handle = { kind: owned.kind, cleanup: () => owned.cleanup(), completion: owned.completion.then(async (terminal) => {
          while (consumers.size) await Promise.allSettled([...consumers]);
          return consumerFailed ? { ...terminal, streams: { status: "unobservable" as const, reason: "codex-private-consumption-incomplete" } } : terminal;
        }) };
        void handle.completion.then(async (terminal) => {
          try { send({ type: "terminal", terminal }); } catch { /* disconnected consumers remain unknown */ }
          await handle!.cleanup(); finished = true;
          try { send({ type: "resources-released" }); } catch { /* not a receipt; host loss stays unknown */ }
          // Let the original Owner persist its failed/complete receipt before closing on disconnect.
          if (!process.connected) setImmediate(() => { void close(); });
        });
        return handle;
      },
    } });
    await server.listen();
    if (phase !== "preparing" || !process.connected) throw new Error("codex-host-lost");
    phase = "ready"; send({ type: "prepared", requirements });
  }
}
if (require.main === module) {
  if (!process.send) process.exitCode = 1;
  else void runDepartmentCodexOwnerWorker();
}
