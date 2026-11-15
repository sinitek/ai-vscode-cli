import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import { fork, type ChildProcess } from "child_process";
import * as path from "path";
import { createHash, randomBytes } from "crypto";
import { canonicalIdentity, exactKeys, fingerprintDepartmentExecutionSelection, isDepartmentExecutionIdentity, isExecutionCleanup, record, sameExecution,
  type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
import { boundedCodexMessage, isCodexOwnedSession } from "../runtime/departmentcodexpreparationcontract";
import { isLeaderCodexPreparation, isLeaderInvocation, isLeaderTerminal, LEADER_CALLBACK_LIMIT, LEADER_CALLBACKS,
  LEADER_INVOCATION_LIMIT, LEADER_REQUIREMENTS, type LeaderCodexDescription, type LeaderCodexPreparation, type LeaderInvocation } from "../runtime/departmentleadercodexcontract";
import { DepartmentLeaderExecutionLedger, leaderExecutionCanLaunch, responsibilityKey, type DepartmentLeaderExecutionProducer, type DepartmentLeaderExecutionScope } from "./departmentleaderexecutionledger";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import type { CodexOwnedSession, CodexOwnedStreamHandlers } from "../interactive/codexOwnedExecution";
import type { ExecutionObservation, ExecutionCleanupEvidence, ExecutionTerminalEvidence } from "../runtime/departmentexecutionowner";
import { releaseDepartmentExecutionTab, type DepartmentExecutionTabCapability } from "./departmentexecutionresources";

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined); return { promise, resolve, reject };
}
export type LeaderInvocationLaunch = { identity: DepartmentExecutionIdentity; completion: Promise<ExecutionTerminalEvidence> };
export type DepartmentLeaderCodexHost = {
  store: DepartmentRuntimeStore; producer: DepartmentLeaderExecutionProducer | null;
  /** Trusted authoritative task/organization/route/capacity lease read, synchronous. */
  assertCurrent(): void;
  build(): Promise<LeaderCodexDescription>;
  persistSession(session: CodexOwnedSession): Promise<void>;
  readSession(): { cli: string; sessionId: string; configId: string | null } | null;
  handlers: CodexOwnedStreamHandlers;
  logInfo?: (message: string, data?: unknown) => void | Promise<void>;
  logError?: (message: string, data?: unknown) => void | Promise<void>;
  tab?: DepartmentExecutionTabCapability;
  retainOriginalClient?(binding: DepartmentExecutionBinding, client: DepartmentExecutionOwnerClient): void;
};
export type DepartmentLeaderCodexPort = {
  invoke(invocation: LeaderInvocation, signal?: AbortSignal): Promise<LeaderInvocationLaunch>;
  /** Fences grants synchronously. Real native/consumer drain may remain pending. */
  closeAdmissionsAndDrain(): Promise<ExecutionCleanupEvidence>;
  /** Host disappearance seals admission, without cancelling authorized work. */
  disconnect(): void;
  /** Exact persisted original binding only; never starts a replacement Owner. */
  observe(): Promise<ExecutionObservation>;
};

function callbackAckResult(name: string, result: unknown): unknown {
  // Only JSON-RPC requests consume a callback result. Notification handlers may
  // return arbitrary host values that are irrelevant to the native protocol.
  return name === "onRequest" ? result ?? null : null;
}

/** Host-only factory; never constructed from task/UI/model input. Does not open
 * a generation or implement producer closure. Future composition root supplies
 * the actual producer and authoritative task/session writers. */
export function createDepartmentLeaderCodexBootstrap(identity: DepartmentExecutionIdentity, selection: DepartmentExecutionSelection,
  ownerDirectory: string, host: DepartmentLeaderCodexHost): DepartmentLeaderCodexPort {
  identity = structuredClone(identity); selection = structuredClone(selection);
  const f = fingerprintDepartmentExecutionSelection(selection);
  if (!isDepartmentExecutionIdentity(identity) || identity.role !== "leader" || identity.cli !== "codex"
    || selection.role !== "leader" || selection.cli !== "codex" || !selection.configId || selection.openCodeVariant !== null
    || f.configFingerprint !== identity.configFingerprint || f.profileFingerprint !== identity.profileFingerprint) throw new Error("leader-identity-selection-unsupported-or-conflicting");
  // Snapshot trusted ports before any asynchronous admission.
  const store = host.store, producer = host.producer, build = host.build.bind(host), persistSession = host.persistSession.bind(host),
    readSession = host.readSession.bind(host), assertAuthority = host.assertCurrent.bind(host), handlers = { ...host.handlers, logInfo: host.logInfo, logError: host.logError };
  const scope: DepartmentLeaderExecutionScope = { rootTaskId: identity.rootTaskId, workspace: identity.workspace,
    leaderTaskId: identity.leaderTaskId, moduleId: identity.moduleId, generation: identity.generation };
  const responsibility = { registrationId: "leader-" + createHash("sha256").update(JSON.stringify(scope)).digest("hex"),
    target: { role: "leader" as const }, selection, requirements: { ...LEADER_REQUIREMENTS } };
  const ledger = new DepartmentLeaderExecutionLedger(store, producer);
  const records = new Map<string, { digest: string; launch: ReturnType<typeof deferred<LeaderInvocationLaunch>>;
    completion: ReturnType<typeof deferred<ExecutionTerminalEvidence>> }>();
  let child: ChildProcess | undefined, input: LeaderCodexPreparation | undefined, sequence = 0, incoming = 0, sealed = false, failed = false;
  let drainObserved = false;
  let ready = deferred<void>(), drain = deferred<ExecutionCleanupEvidence>(), boot: Promise<void> | undefined;
  let binding: DepartmentExecutionBinding | undefined, active: {
    invocation: LeaderInvocation; phase: "preparing" | "persisting" | "persisted" | "grant-sent" | "granted";
    bind(b: DepartmentExecutionBinding): void; assert(): void;
  } | undefined;
  const client = new DepartmentExecutionOwnerClient(ownerDirectory);
  const callbacks = new Set<Promise<unknown>>();
  const preparations = new Set<Promise<void>>();
  let consumerFailed = false, tabRequested = false, failureDiagnosed = false;
  const diagnose = (stage: string): void => {
    if (failureDiagnosed) return;
    failureDiagnosed = true;
    try { console.error(`[department-leader-native] stage=${stage}`); } catch { /* diagnostics cannot affect execution */ }
  };
  const tab = host.tab;
  const authority = () => {
    if (sealed || failed || consumerFailed || !producer || !leaderExecutionCanLaunch(producer, scope)) throw new Error("leader-admission-unavailable-or-revoked");
    assertAuthority();
    const read = store.read(scope.rootTaskId, scope.workspace);
    if (sealed || failed || !leaderExecutionCanLaunch(producer, scope) || !read.ok || !read.value || read.value.runtime.stopping || !read.value.capacity.leaders.includes(scope.moduleId)
      || !read.value.runtime.leaders.some((l) => l.taskId === scope.leaderTaskId && l.leaderSubtaskId === scope.moduleId
        && l.generation === scope.generation && l.status === "running")) throw new Error("leader-organization-authority-conflict");
  };
  const exactSession = (id: string) => {
    const s = readSession();
    if (!s || s.cli !== "codex" || s.sessionId !== id || s.configId !== selection.configId) throw new Error("leader-session-readback-conflict");
  };
  const verifyBinding = () => {
    if (!binding) throw new Error("leader-binding-missing");
    exactSession(binding.identity.session.state === "bound" ? binding.identity.session.id : "");
    const read = store.readLeaderExecutionSet(scope);
    const saved = read.ok && read.value?.bindings.find((b) => b.identity.executionId === identity.executionId);
    const entry = read.ok && read.value?.set.entries.find((e) => e.responsibility.registrationId === responsibility.registrationId);
    if (!saved || !entry || entry.executionId !== identity.executionId || !sameExecution(saved.identity, binding.identity)
      || JSON.stringify(saved) !== JSON.stringify(binding) || responsibilityKey(entry.responsibility) !== responsibilityKey(responsibility)) throw new Error("leader-binding-readback-conflict");
  };
  const disconnect = () => { if (child?.connected) child.disconnect(); };
  const fail = (stage = "channel-or-delivery-unknown") => {
    if (failed) return; failed = true; sealed = true; diagnose(stage);
    const e = new Error("leader-owner-channel-or-delivery-unknown"); ready.reject(e); drain.reject(e);
    for (const r of records.values()) { r.launch.reject(e); r.completion.reject(e); }
    disconnect();
  };
  const send = (operation: string, extra: Record<string, unknown> = {}, failureStage = "channel-or-delivery-unknown") => {
    const v = { version: 1, token: input!.token, identity, sequence: ++sequence, operation, ...extra };
    if (!child?.connected || !boundedCodexMessage(v)) throw new Error("leader-owner-channel-unobservable");
    child.send(v, (e) => { if (e) fail(failureStage); });
  };
  const close = () => {
    if (!sealed) { sealed = true;
      if (active && !["grant-sent", "granted"].includes(active.phase)) records.get(active.invocation.invocationId)?.launch.reject(new Error("leader-admission-sealed"));
      try { if (child?.connected) send("seal"); else if (!boot) drain.reject(new Error("leader-native-preparation-not-observed")); } catch { fail(); } }
    return drain.promise;
  };
  const onMessage = (v: unknown) => {
    if (failed) return;
    if (!record(v) || !boundedCodexMessage(v) || v.version !== 1 || v.token !== input!.token
      || !isDepartmentExecutionIdentity(v.identity) || !sameExecution(v.identity, identity) || v.sequence !== incoming + 1) { fail("private-message-rejected"); return; }
    incoming++;
    const base = ["version", "token", "identity", "sequence", "type"];
    if (v.type === "ready" && exactKeys(v, [...base, "requirements"]) && record(v.requirements)
      && JSON.stringify(v.requirements) === JSON.stringify(LEADER_REQUIREMENTS) && incoming === 1) { ready.resolve(); return; }
    if (v.type === "drained" && sealed && exactKeys(v, [...base, "cleanup"]) && record(v.cleanup)
      && exactKeys(v.cleanup, ["runner", "executionRoot", "links", "temp", "tab"])) {
      // Validate all results using the existing receipt contract; never promote to cleaned.
      const validation = { processTerminal: { status: "unobservable", reason: "validation" }, turnTerminal: { status: "unobservable", reason: "validation" }, streams: { status: "unobservable", reason: "validation" }, ...v.cleanup };
      if (!isExecutionCleanup(validation)) { fail("drain-evidence-rejected"); return; }
      if (consumerFailed) { fail("callback-consumer-rejected"); return; }
      void (async () => {
        await Promise.allSettled([...callbacks]);
        if (consumerFailed || !binding) throw new Error("leader-original-cleanup-unobservable");
        verifyBinding();
        // drained is pacing only: observe the original socket's actual receipt
        // before disconnecting the private worker channel/server.
        await client.waitForCleanup(binding.identity, binding.requirements).catch(() => undefined);
        drain.resolve(v.cleanup as ExecutionCleanupEvidence); drainObserved = true;
        disconnect();
      })().catch(() => fail("original-receipt-observation-failed")); return;
    }
    if (v.type === "release-tab" && sealed && !active && !tabRequested && !consumerFailed && binding
      && exactKeys(v, [...base, "resourceIdentity"]) && isDepartmentExecutionIdentity(v.resourceIdentity)
      && sameExecution(v.resourceIdentity, binding.identity)) {
      tabRequested = true; const seq = incoming;
      void releaseDepartmentExecutionTab(tab, v.resourceIdentity)
        .then((result) => send("ack", { callbackSequence: seq, ok: true, result })).catch(() => fail("tab-release-ack-failed"));
      return;
    }
    if (!active || v.invocationId !== active.invocation.invocationId) { fail(); return; }
    const a = active, r = records.get(a.invocation.invocationId)!;
    if (v.type === "callback" && exactKeys(v, [...base, "invocationId", "name", "args"]) && typeof v.name === "string"
      && (LEADER_CALLBACKS as readonly string[]).includes(v.name) && Array.isArray(v.args) && v.args.length <= 3) {
      if (callbacks.size >= LEADER_CALLBACK_LIMIT) { consumerFailed = true; fail(); return; }
      const callback = handlers[v.name as keyof typeof handlers], seq = incoming;
      const task = Promise.resolve().then(() => typeof callback === "function" ? Reflect.apply(callback, handlers, v.args as unknown[]) : null)
        .then((result) => {
          try { send("ack", { callbackSequence: seq, ok: true, result: callbackAckResult(v.name as string, result) }, "callback-ack-send-failed"); }
          catch { consumerFailed = true; fail("callback-ack-serialization-or-send-failed"); }
        }, () => {
          consumerFailed = true;
          try { send("ack", { callbackSequence: seq, ok: false, result: null }, "callback-rejection-ack-send-failed"); }
          catch { fail("callback-rejection-ack-send-failed"); return; }
          fail("callback-consumer-rejected");
        }).catch(() => { consumerFailed = true; fail("callback-ack-serialization-or-send-failed"); });
      callbacks.add(task); void task.then(() => callbacks.delete(task)); return;
    }
    if (v.type === "session" && a.phase === "preparing" && exactKeys(v, [...base, "invocationId", "session"]) && isCodexOwnedSession(v.session)) {
      const session = Object.freeze({ ...v.session, token: Object.freeze({ ...v.session.token }) });
      a.phase = "persisting";
      const preparation = (async () => {
        a.assert();
        if (identity.session.state === "bound" && session.threadId !== identity.session.id) throw new Error("leader-thread-conflict");
        if (binding) { verifyBinding(); if (binding.identity.session.state !== "bound" || binding.identity.session.id !== session.threadId) throw new Error("leader-thread-conflict"); }
        else {
          await persistSession(session); a.assert(); exactSession(session.threadId);
          const candidate: DepartmentExecutionBinding = { identity: { ...identity, session: { state: "bound", id: session.threadId } }, selection,
            requirements: { ...LEADER_REQUIREMENTS } };
          a.bind(candidate); binding = candidate; verifyBinding();
          host.retainOriginalClient?.(structuredClone(binding), client);
        }
        a.assert(); a.phase = "persisted"; send("persisted", { invocationId: a.invocation.invocationId });
      })();
      preparations.add(preparation);
      void preparation.then(() => preparations.delete(preparation), () => { preparations.delete(preparation); fail("session-persistence-or-binding-failed"); }); return;
    }
    if (v.type === "owner-bound" && a.phase === "persisted" && exactKeys(v, [...base, "invocationId"])) {
      try {
        a.assert(); verifyBinding(); a.assert();
        // Original Owner.bindSession has completed. No await before one-use grant.
        a.phase = "grant-sent"; send("grant", { invocationId: a.invocation.invocationId });
      } catch { fail("owner-bind-or-grant-check-failed"); } return;
    }
    if (v.type === "granted" && a.phase === "grant-sent" && exactKeys(v, [...base, "invocationId"])) {
      a.phase = "granted"; child!.channel?.unref();
      r.launch.resolve({ identity: structuredClone(binding!.identity), completion: r.completion.promise }); return;
    }
    if (v.type === "settled" && a.phase === "granted" && exactKeys(v, [...base, "invocationId", "terminal"]) && isLeaderTerminal(v.terminal)) {
      r.completion.resolve(v.terminal); active = undefined; return;
    }
    fail();
  };
  async function prepare() {
    authority();
    const description = await build(); authority();
    input = structuredClone({ ...description, ownerDirectory, identity, selection, version: 1, token: randomBytes(32).toString("hex") });
    if (!isLeaderCodexPreparation(input)) throw new Error("leader-private-preparation-invalid");
    child = fork(path.join(__dirname, "..", "runtime", "departmentleadercodexownerworker.js"), [], {
      detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.unref(); child.on("message", onMessage); child.on("error", () => { if (!drainObserved) fail("worker-error"); });
    child.on("exit", () => { if (!drainObserved) fail("worker-exit"); });
    child.on("disconnect", () => { if (!drainObserved) fail("private-channel-disconnected"); });
    child.send(input, (e) => { if (e) fail("preparation-send-failed"); }); await ready.promise;
  }
  return {
    invoke(invocation, signal) {
      if (!isLeaderInvocation(invocation)) return Promise.reject(new Error("leader-invocation-invalid"));
      invocation = Object.freeze({ ...invocation });
      const digest = createHash("sha256").update(JSON.stringify([canonicalIdentity(identity), invocation.invocationId, invocation.prompt])).digest("hex");
      const old = records.get(invocation.invocationId);
      if (old) return old.digest === digest ? old.launch.promise : Promise.reject(new Error("leader-invocation-conflict"));
      try { authority();
        if (!boot && records.size === 0) {
          const prior = store.readLeaderExecutionSet(scope);
          if (!prior.ok || !prior.value) throw new Error("leader-execution-scope-unavailable");
          if (prior.value.set.entries.some((e) => e.responsibility.registrationId === responsibility.registrationId))
            throw new Error("leader-existing-responsibility-observation-only");
        }
        if (signal?.aborted) throw new Error("leader-invocation-cancelled");
        if (active) throw new Error("leader-invocation-busy"); if (records.size >= LEADER_INVOCATION_LIMIT) throw new Error("leader-invocation-capacity");
      } catch (e) { return Promise.reject(e); }
      const r = { digest, launch: deferred<LeaderInvocationLaunch>(), completion: deferred<ExecutionTerminalEvidence>() };
      records.set(invocation.invocationId, r);
      const cancel = () => { if (active?.phase !== "grant-sent" && active?.phase !== "granted") { void close(); r.launch.reject(new Error("leader-invocation-cancelled")); } };
      let admitting = true;
      active = { invocation, phase: "preparing", bind: () => { throw new Error("leader-admission-not-entered"); }, assert: () => {
        authority(); if (!admitting || signal?.aborted) throw new Error("leader-invocation-cancelled");
      } };
      const a = active;
      signal?.addEventListener("abort", cancel, { once: true });
      void ledger.admit(scope, responsibility, async (bind) => {
        a.bind = (b) => { a.assert(); const result = bind(b); if (!result.ok) throw new Error(result.error); };
        a.assert(); if (identity.session.state === "bound") exactSession(identity.session.id);
        boot ??= prepare(); await boot; a.assert();
        if (binding) verifyBinding();
        send("invoke", { invocation });
        try { return await r.launch.promise; } finally {
          while (preparations.size) await Promise.allSettled([...preparations]);
        }
      }).catch((e) => { r.launch.reject(e); r.completion.reject(e); fail("ledger-admission-failed"); }).finally(() => {
        admitting = false; signal?.removeEventListener("abort", cancel);
      });
      return r.launch.promise;
    },
    closeAdmissionsAndDrain: close,
    disconnect() { void close(); disconnect(); },
    async observe() {
      const read = store.readLeaderExecutionSet(scope);
      const saved = read.ok && read.value?.bindings.find((b) => b.identity.executionId === identity.executionId);
      const entry = read.ok && read.value?.set.entries.find((e) => e.responsibility.registrationId === responsibility.registrationId);
      if (!saved || !entry || entry.executionId !== identity.executionId || saved.identity.session.state !== "bound"
        || responsibilityKey(entry.responsibility) !== responsibilityKey(responsibility)
        || !sameExecution({ ...identity, session: saved.identity.session }, saved.identity))
        return { status: "unknown", identity, reason: "leader-exact-original-binding-unavailable" };
      if (identity.session.state === "bound" && identity.session.id !== saved.identity.session.id)
        return { status: "conflict", identity, reason: "leader-native-session-conflict" };
      try { exactSession(saved.identity.session.id); }
      catch { return { status: "unknown", identity, reason: "leader-task-session-readback-conflict" }; }
      return client.observeExecution(saved.identity);
    },
  };
}
