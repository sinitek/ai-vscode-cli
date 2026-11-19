import { fork } from "child_process";
import * as path from "path";
import { randomBytes } from "crypto";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import { CLEANUP_PARTS, exactKeys, isCleanupRequirements, isDepartmentExecutionIdentity, isExecutionCleanup, record, sameExecution,
  type CleanupRequirements, type DepartmentExecutionIdentity } from "../runtime/departmentexecutionidentity";
import { boundedCodexMessage, isCodexOwnedSession, isDepartmentCodexPreparation, type DepartmentCodexPreparation } from "../runtime/departmentcodexpreparationcontract";
import { LeaderCallbackAssembler as CodexOwnerCallbackAssembler, type LeaderCallback as CodexOwnerCallback } from "../runtime/departmentleadercodexcontract";
import type { CodexOwnedSession, CodexOwnedStreamHandlers } from "../interactive/codexOwnedExecution";
import type { ExecutionTerminalEvidence } from "../runtime/departmentexecutionowner";
import { releaseDepartmentExecutionTab, type DepartmentExecutionTabCapability } from "./departmentexecutionresources";

export type DepartmentCodexOwnerLaunch = {
  identity: DepartmentExecutionIdentity;
  completion: Promise<ExecutionTerminalEvidence>;
  /** Private pacing only, not cleanup evidence. Original Owner still writes receipt. */
  resourcesReleased: Promise<void>;
  /** Cancels before grant only. After grant, disconnect never stops the Owner. */
  disconnect(): void;
};
export type DepartmentCodexOwnerCallbacks = {
  handlers: CodexOwnedStreamHandlers;
  logInfo?: (message: string, data?: unknown) => void | Promise<void>;
  logError?: (message: string, data?: unknown) => void | Promise<void>;
  persist(session: CodexOwnedSession, requirements: CleanupRequirements): Promise<void>;
  assertAuthorized(): void;
  authorizeStart?(): Promise<void>;
  signal?: AbortSignal;
  tab?: DepartmentExecutionTabCapability;
};

/** Private fixed-worker bootstrap. A final synchronous authority read + grant issuance
 * is the cancellation linearization point; delivery ambiguity is never retried. */
export async function startDepartmentCodexOwner(
  prepared: Omit<DepartmentCodexPreparation, "version" | "token">, callbacks: DepartmentCodexOwnerCallbacks,
): Promise<DepartmentCodexOwnerLaunch> {
  callbacks.assertAuthorized();
  if (callbacks.signal?.aborted) throw new Error("department-codex-caller-cancelled");
  const input: DepartmentCodexPreparation = structuredClone({ ...prepared, version: 1, token: randomBytes(32).toString("hex") });
  if (!isDepartmentCodexPreparation(input)) throw new Error("department-codex-private-preparation-invalid");
  const handlers = { ...callbacks.handlers, logInfo: callbacks.logInfo, logError: callbacks.logError }, persist = callbacks.persist, assertAuthorized = callbacks.assertAuthorized, tab = callbacks.tab;
  const child = fork(path.join(__dirname, "..", "runtime", "departmentcodexownerworker.js"), [], {
    detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.unref();
  let phase: "preparing" | "ready" | "persisting" | "persisted" | "granting" | "granted" | "failed" = "preparing";
  const callbackAssembler = new CodexOwnerCallbackAssembler();
  let channelFailed = false;
  let acknowledged = false, terminalSeen = false, tabRequested = false, resourcesSeen = false;
  let sequence = 0, requirements: CleanupRequirements | undefined, native: CodexOwnedSession | undefined;
  let resolveLaunch!: (value: DepartmentCodexOwnerLaunch) => void, rejectLaunch!: (error: Error) => void;
  let resolveCompletion!: (value: ExecutionTerminalEvidence) => void, rejectCompletion!: (error: Error) => void;
  const completion = new Promise<ExecutionTerminalEvidence>((yes, no) => { resolveCompletion = yes; rejectCompletion = no; });
  void completion.catch(() => undefined);
  let resolveResources!: () => void, rejectResources!: (error: Error) => void;
  const resourcesReleased = new Promise<void>((yes, no) => { resolveResources = yes; rejectResources = no; });
  void resourcesReleased.catch(() => undefined);
  const launch = new Promise<DepartmentCodexOwnerLaunch>((yes, no) => { resolveLaunch = yes; rejectLaunch = no; });
  const disconnect = (): void => { if (child.connected) child.disconnect(); };
  const fail = (): void => {
    if (channelFailed) return;
    channelFailed = true; callbackAssembler.clear();
    const error = new Error("department-codex-owner-channel-unobservable");
    if (phase !== "granted") phase = "failed";
    callbacks.signal?.removeEventListener("abort", cancel);
    rejectLaunch(error); rejectCompletion(error); rejectResources(error); disconnect();
  };
  const cancel = (): void => { if (phase !== "granted") fail(); };
  const send = (operation: string, extra: Record<string, unknown> = {}): void => {
    const message = { version: 1, token: input.token, identity: input.identity, operation, ...extra };
    if (!child.connected || !boundedCodexMessage(message)) throw new Error("department-codex-channel-lost");
    child.send(message, (error) => { if (error) fail(); });
  };
  const deliverCallback = ({ name, args, sequence }: CodexOwnerCallback): void => {
    const callback = handlers[name as keyof typeof handlers];
    const ack = (ok: boolean, result: unknown): void => {
      if (channelFailed) return;
      send("ack", { sequence, ok, result });
      callbackAssembler.release(sequence);
    };
    void Promise.resolve().then(() => typeof callback === "function" ? Reflect.apply(callback, handlers, args) : null)
      .then((result) => ack(true, result ?? null), () => ack(false, null)).catch(fail);
  };
  callbacks.signal?.addEventListener("abort", cancel, { once: true });
  child.on("error", fail); child.on("exit", fail); child.on("disconnect", fail);
  child.on("message", (value: unknown) => {
    if (channelFailed) return;
    if (!record(value) || !boundedCodexMessage(value) || value.version !== 1 || value.token !== input.token
      || !isDepartmentExecutionIdentity(value.identity) || !sameExecution(value.identity, input.identity)
      || value.sequence !== sequence + 1) { fail(); return; }
    sequence++;
    const base = ["version", "token", "identity", "sequence", "type"];
    if (value.type === "callback" || value.type === "callback-chunk") {
      if (terminalSeen || !["ready", "persisting", "persisted", "granting", "granted"].includes(phase)
        || value.invocationId !== input.identity.executionId || value.name === "onNotification") { fail(); return; }
      try { for (const event of callbackAssembler.accept(value)) deliverCallback(event); }
      catch { fail(); }
      return;
    }
    if (callbackAssembler.incomplete) { fail(); return; }
    if (value.type === "prepared" && phase === "preparing" && exactKeys(value, [...base, "requirements"]) && isCleanupRequirements(value.requirements)) {
      requirements = structuredClone(value.requirements); phase = "ready";
      try { assertAuthorized(); if (callbacks.signal?.aborted) throw new Error("cancelled"); }
      catch { fail(); return; }
      void new DepartmentExecutionOwnerClient(input.ownerDirectory).startExecution(input.identity).then((result) => {
        if (result.status !== "live" && result.status !== "cleaned") fail();
      }, fail);
    } else if (value.type === "session" && phase === "ready" && exactKeys(value, [...base, "session"]) && isCodexOwnedSession(value.session)) {
      native = Object.freeze({ ...value.session, token: Object.freeze({ ...value.session.token }) });
      if (input.identity.session.state === "bound" && native.threadId !== input.identity.session.id) { fail(); return; }
      phase = "persisting";
      void (async () => {
        assertAuthorized();
        await persist(native!, requirements!);
        if (phase !== "persisting" || callbacks.signal?.aborted) throw new Error("cancelled");
        assertAuthorized(); phase = "persisted"; send("persisted");
      })().catch(fail);
    } else if (value.type === "owner-bound" && phase === "persisted" && native && exactKeys(value, base)) {
      phase = "granting";
      void (async () => {
        if (callbacks.signal?.aborted || !child.connected) throw new Error("cancelled");
        assertAuthorized();
        await callbacks.authorizeStart?.();
        if (phase !== "granting" || callbacks.signal?.aborted || !child.connected) throw new Error("cancelled");
        assertAuthorized();
        phase = "granted"; callbacks.signal?.removeEventListener("abort", cancel); send("grant");
      })().catch(fail);
    } else if (value.type === "granted" && phase === "granted" && !acknowledged && native && exactKeys(value, base)) {
      acknowledged = true; child.channel?.unref();
      resolveLaunch({ identity: { ...input.identity, session: { state: "bound", id: native.threadId } }, completion, resourcesReleased, disconnect });
    } else if (value.type === "release-tab" && phase === "granted" && terminalSeen && !tabRequested && native
      && exactKeys(value, [...base, "resourceIdentity"]) && isDepartmentExecutionIdentity(value.resourceIdentity)
      && sameExecution(value.resourceIdentity, { ...input.identity, session: { state: "bound", id: native.threadId } })) {
      tabRequested = true; const seq = sequence;
      void releaseDepartmentExecutionTab(tab, value.resourceIdentity)
        .then((result) => send("ack", { sequence: seq, ok: true, result })).catch(fail);
    } else if (value.type === "resources-released" && phase === "granted" && terminalSeen && !resourcesSeen && exactKeys(value, base)) {
      resourcesSeen = true; resolveResources();
    } else if (value.type === "terminal" && !terminalSeen && callbackAssembler.size === 0
      && exactKeys(value, [...base, "terminal"]) && record(value.terminal)) {
      const full = Object.fromEntries(CLEANUP_PARTS.map((part) => [part, { status: "not-applicable", reason: "transport-validation" }]));
      if (!exactKeys(value.terminal, ["processTerminal", "turnTerminal", "streams"]) || !isExecutionCleanup({ ...full, ...value.terminal })) { fail(); return; }
      terminalSeen = true; resolveCompletion(value.terminal as ExecutionTerminalEvidence);
      if (phase !== "granted") fail();
    } else fail();
  });
  if (callbacks.signal?.aborted) cancel();
  if (child.connected && !callbacks.signal?.aborted) child.send(input, (error) => { if (error) fail(); });
  return launch;
}
