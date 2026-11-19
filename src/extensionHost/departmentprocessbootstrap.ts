import { fork, type ChildProcess } from "child_process";
import * as path from "path";
import { randomBytes } from "crypto";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import { CLEANUP_PARTS, exactKeys, isCleanupRequirements, isDepartmentExecutionIdentity, isExecutionCleanup, record, sameExecution,
  type CleanupRequirements } from "../runtime/departmentexecutionidentity";
import { isDepartmentProcessPreparation, type DepartmentProcessPreparation } from "../runtime/departmentprocesspreparationcontract";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import type { CliProcessRuntimeHandle, CliProcessRuntimeHandlers } from "../cli/cliProcessRuntime";

export type PreparedDepartmentProcessOwner = {
  binding: DepartmentExecutionBinding;
  nativeDirectory: string;
  /** Call only after the single EH writer has confirmed both durable records. */
  commit(): Promise<void>;
  start(handlers: CliProcessRuntimeHandlers, assertAuthorized?: () => void, authorizeStart?: () => Promise<void>): Promise<CliProcessRuntimeHandle>;
  abandon(): void;
  /** Retire only after the original validated complete receipt, never as cleanup evidence itself. */
  close(): Promise<void>;
};

/** No public command or arbitrary worker/module entry. Private inherited IPC is never rediscovered on reconnect. */
export async function prepareDepartmentProcessOwner(
  prepared: Omit<DepartmentProcessPreparation, "version" | "token">, signal?: AbortSignal,
  finalizeNative?: (sessionId: string) => Promise<DepartmentProcessPreparation["launch"]>,
  releaseTab?: (identity: DepartmentProcessPreparation["identity"]) => Promise<unknown>,
  assertPreparing?: () => void,
): Promise<PreparedDepartmentProcessOwner> {
  if (signal?.aborted) throw new Error("department-process-caller-cancelled");
  const input: DepartmentProcessPreparation = structuredClone({ ...prepared, version: 1, token: randomBytes(32).toString("hex") });
  if (!isDepartmentProcessPreparation(input)) throw new Error("department-process-private-preparation-invalid");
  if ((input.identity.session.state === "unbound" || input.retired) && !finalizeNative) throw new Error("department-process-native-finalizer-required");
  const child: ChildProcess = fork(path.join(__dirname, "..", "runtime", "departmentprocessownerworker.js"), [], {
    detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [],
    // Extension Host's execPath is Electron. The fixed worker must run as ordinary Node.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.unref();
  let nativePhase: "waiting" | "building" | "finalized" = (input.identity.session.state === "unbound" || input.retired) ? "waiting" : "finalized";
  let revoked = false, granted = false, grantPending = false, authorize: (() => void) | undefined, authorizeStart: (() => Promise<void>) | undefined;
  let operationSequence = 0;
  let sequence = 0, committed = false, handlers: CliProcessRuntimeHandlers = {}, businessSettled = false;
  let closePromise: Promise<void> | undefined;
  let stopped = false, resolveStopped!: () => void, rejectStopped!: (error: Error) => void;
  const stoppedReady = new Promise<void>((yes, no) => { resolveStopped = yes; rejectStopped = no; });
  void stoppedReady.catch(() => undefined);
  let nativeDirectory = "";
  let resolvePrepared!: (requirements: CleanupRequirements) => void, rejectPrepared!: (error: Error) => void;
  let resolveCommit!: () => void, rejectCommit!: (error: Error) => void;
  let resolveTerminal!: (value: Awaited<NonNullable<CliProcessRuntimeHandle["lifecycle"]>>) => void;
  const ready = new Promise<CleanupRequirements>((resolve, reject) => { resolvePrepared = resolve; rejectPrepared = reject; });
  const commitReady = new Promise<void>((resolve, reject) => { resolveCommit = resolve; rejectCommit = reject; });
  void commitReady.catch(() => undefined);
  const lifecycle: NonNullable<CliProcessRuntimeHandle["lifecycle"]> = new Promise((resolve) => { resolveTerminal = resolve; });
  const disconnect = (): void => { if (child.connected) child.disconnect(); };
  const cancel = (): void => {
    // Grant issuance is the launch/cancel linearization point. Afterwards Owner execution is independent.
    if (granted || revoked) return;
    revoked = true; disconnect(); fail();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const fail = (): void => {
    if (!granted) { revoked = true; disconnect(); }
    const error = new Error("department-process-owner-channel-unobservable");
    if (!stopped) rejectStopped(error);
    signal?.removeEventListener("abort", cancel);
    rejectPrepared(error); rejectCommit(error);
    resolveTerminal({ processTerminal: { status: "unobservable", reason: "owner-channel-lost" },
      streams: { status: "unobservable", reason: "owner-channel-lost" }, temp: { status: "unobservable", reason: "owner-temp-unobserved" } });
    if (!businessSettled) { businessSettled = true; handlers.onError?.(error); }
  };
  child.on("error", fail);
  child.on("exit", fail);
  child.on("disconnect", fail);
  child.on("message", (value: unknown) => {
    if (!record(value) || value.version !== 1 || value.token !== input.token || !isDepartmentExecutionIdentity(value.identity)
      || !(sameExecution(value.identity, input.identity) || nativePhase === "waiting" && value.type === "native-session"
        && value.identity.session.state === "bound" && /^ses_[A-Za-z0-9]+$/.test(value.identity.session.id)
        && sameExecution(value.identity, { ...input.identity, session: value.identity.session })) || !Number.isSafeInteger(value.sequence) || value.sequence !== sequence + 1) { fail(); return; }
    if (revoked) return; // A delayed ACK cannot reopen a revoked preparation.
    sequence = value.sequence as number;
    const base = ["version", "token", "identity", "sequence", "type"];
    if (value.type === "preparation-check" && exactKeys(value, base) && !committed && !granted) {
      try {
        assertPreparing?.();
        if (signal?.aborted || revoked) throw new Error("department-process-caller-cancelled");
        child.send({ version: 1, token: input.token, operation: "preparation-checked", sequence: ++operationSequence, identity: input.identity }, error => { if (error) fail(); });
      } catch { cancel(); }
    } else if (value.type === "native-session" && nativePhase === "waiting" && finalizeNative && exactKeys(value, base)
      && value.identity.session.state === "bound") {
      nativePhase = "building";
      input.identity = structuredClone(value.identity);
      const sessionId = value.identity.session.id;
      void (async () => {
        const launch = await finalizeNative(sessionId);
        if (revoked || signal?.aborted || !child.connected) throw new Error("department-process-caller-cancelled");
        const finalized = { ...input, launch: structuredClone(launch) };
        if (!isDepartmentProcessPreparation(finalized)) throw new Error("department-process-final-launch-invalid");
        input.launch = finalized.launch; nativePhase = "finalized";
        child.send({ version: 1, token: input.token, operation: "finalize", sequence: ++operationSequence, identity: input.identity, launch: input.launch }, (error) => { if (error) fail(); });
      })().catch(fail);
    } else if (value.type === "prepared" && nativePhase === "finalized" && exactKeys(value, [...base, "requirements", "directory"]) && typeof value.directory === "string" && path.isAbsolute(value.directory) && isCleanupRequirements(value.requirements)) {
      nativeDirectory = value.directory as string;
      resolvePrepared(structuredClone(value.requirements));
    } else if (value.type === "committed" && exactKeys(value, base)) { committed = true; resolveCommit(); }
    else if (value.type === "launch-request" && committed && authorize && authorizeStart && !granted && !grantPending && exactKeys(value, base)) {
      grantPending = true;
      void (async () => {
        if (signal?.aborted || !child.connected) throw new Error("department-process-caller-cancelled");
        authorize();
        await authorizeStart();
        if (signal?.aborted || revoked || !child.connected) throw new Error("department-process-caller-cancelled");
        authorize();
        granted = true;
        signal?.removeEventListener("abort", cancel);
        child.send({ version: 1, token: input.token, operation: "launch", sequence: ++operationSequence, identity: input.identity }, (error) => { if (error) fail(); });
      })().catch(cancel);
    }
    else if ((value.type === "stdout" || value.type === "stderr") && committed && exactKeys(value, [...base, "chunk"])
      && typeof value.chunk === "string" && value.chunk.length <= 8192) {
      if (!businessSettled) (value.type === "stdout" ? handlers.onStdout : handlers.onStderr)?.(value.chunk);
    } else if (value.type === "exit" && committed && exactKeys(value, [...base, "code"]) && (value.code === null || Number.isInteger(value.code))) {
      if (!businessSettled) { businessSettled = true; handlers.onExit?.(value.code as number | null); }
    } else if (value.type === "terminal" && committed && exactKeys(value, [...base, "terminal"]) && record(value.terminal)) {
      const terminal = value.terminal;
      // Reuse the strict evidence validator, filling only non-terminal slots with explicit n/a.
      const full = Object.fromEntries(CLEANUP_PARTS.map((part) => [part, { status: "not-applicable", reason: "transport-validation" }]));
      if (!exactKeys(terminal, ["processTerminal", "turnTerminal", "streams"]) || !isExecutionCleanup({ ...full, ...terminal })) { fail(); return; }
      resolveTerminal({ processTerminal: terminal.processTerminal, streams: terminal.streams,
        temp: { status: "unobservable", reason: "use-owner-full-receipt" } } as Awaited<NonNullable<CliProcessRuntimeHandle["lifecycle"]>>);
    } else if (value.type === "release-tab" && committed && granted && exactKeys(value, base)) {
      const identity = structuredClone(input.identity);
      const release = releaseTab ? releaseTab(identity) : Promise.resolve({ status: "unobservable", reason: "eh-tab-release-capability-missing" });
      void release.then((result) => {
        const empty = Object.fromEntries(CLEANUP_PARTS.map((part) => [part, { status: "not-applicable", reason: "tab-result-validation" }])) as Record<string, unknown>;
        const valid = record(result) && isExecutionCleanup({ ...empty, tab: result });
        child.send({ version: 1, token: input.token, operation: "tab-release-result", sequence: ++operationSequence,
          identity, result: valid ? result : { status: "unobservable", reason: "tab-release-result-invalid" } }, (error) => { if (error) fail(); });
      }, () => child.send({ version: 1, token: input.token, operation: "tab-release-result", sequence: ++operationSequence,
        identity, result: { status: "failed", reason: "tab-release-failed" } }, (error) => { if (error) fail(); }));
    } else if (value.type === "stopped" && closePromise && exactKeys(value, base)) {
      stopped = true; resolveStopped();
    } else { fail(); }
  });
  if (signal?.aborted) cancel();
  if (!revoked) child.send(input, (error) => { if (error) fail(); });
  let requirements: CleanupRequirements;
  try { requirements = await ready; }
  catch (error) { if (child.connected) child.disconnect(); throw error; }
  const binding: DepartmentExecutionBinding = { identity: structuredClone(input.identity), selection: structuredClone(input.selection), requirements };
  let commitPromise: Promise<void> | undefined, startPromise: Promise<CliProcessRuntimeHandle> | undefined;
  return {
    binding: structuredClone(binding), nativeDirectory,
    commit() {
      commitPromise ??= (async () => {
        if (revoked || !child.connected) throw new Error("department-process-owner-disconnected-before-bind");
        child.send({ version: 1, token: input.token, operation: "commit", sequence: ++operationSequence, identity: input.identity }, (error) => { if (error) fail(); });
        await commitReady;
      })();
      return commitPromise;
    },
    start(callbacks, assertAuthorized = () => undefined, authorizeGrant = async () => undefined) {
      startPromise ??= (async () => {
        if (revoked || signal?.aborted || !committed) throw new Error("department-process-binding-not-committed");
        assertAuthorized();
        authorize = assertAuthorized;
        authorizeStart = authorizeGrant;
        handlers = { ...callbacks };
        const result = await new DepartmentExecutionOwnerClient(input.ownerDirectory).startExecution(input.identity);
        if (result.status !== "live" && result.status !== "cleaned") throw new Error("department-process-owner-start-unknown");
        child.channel?.unref();
        // This is a process terminal port, never a full receipt or a cancellation capability.
        return { kill: () => false, lifecycle };
      })();
      return startPromise;
    },
    close() {
      closePromise ??= (async () => {
        await new DepartmentExecutionOwnerClient(input.ownerDirectory).waitForCleanup(binding.identity, binding.requirements);
        if (!child.connected) throw new Error("department-process-owner-channel-unobservable");
        child.send({ version: 1, token: input.token, operation: "shutdown", sequence: ++operationSequence, identity: input.identity }, error => { if (error) fail(); });
        await stoppedReady;
      })();
      return closePromise;
    },
    abandon() { if (!granted) cancel(); else disconnect(); },
  };
}
