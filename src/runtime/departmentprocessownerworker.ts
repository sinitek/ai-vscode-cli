import * as fs from "fs";
import { createDepartmentOpenCodeSession } from "./departmentopencodesessionpreparation";
import { createLoopSubtaskExecutionRoot, isLoopSubtaskLinkFailedError } from "../loopSubtaskExecutionRoot";
import { runCliProcess, type CliProcessRuntimeHandle } from "../cli/cliProcessRuntime";
import { createOpenCodeRuntimeConfigOverlay } from "../cli/opencoderuntimeconfig";
import { createDepartmentProcessExecutionLauncher, type DepartmentProcessResources } from "./departmentprocessexecutionlauncher";
import { DepartmentExecutionOwnerClient } from "./departmentexecutionownerclient";
import { DepartmentExecutionOwnerServer } from "./departmentexecutionowner";
import { CLEANUP_PARTS, exactKeys, isDepartmentExecutionIdentity, isExecutionCleanup, record, sameExecution, type CleanupResult } from "./departmentexecutionidentity";
import { isDepartmentProcessPreparation, type DepartmentProcessPreparation } from "./departmentprocesspreparationcontract";

/** Fixed repository worker. Inherited IPC is the only preparation capability. */
export async function runDepartmentProcessOwnerWorker(): Promise<void> {
  let phase: "empty" | "preparing" | "prepared" | "committing" | "committed" | "failed" = "empty";
  let input: DepartmentProcessPreparation;
  const preparing = new AbortController();
  let finalize: ((launch: DepartmentProcessPreparation["launch"]) => void) | undefined;
  let rejectFinalize: ((error: Error) => void) | undefined;
  let server: DepartmentExecutionOwnerServer | undefined;
  let required: import("./departmentexecutionidentity").CleanupRequirements;
  let disposeRoot: (() => CleanupResult) | undefined;
  let rootCleanup: CleanupResult | undefined;
  let assertRoot: (() => void) | undefined;
  let preparationCleanupUnknown = false;
  let checked: (() => void) | undefined;
  const checkHost = async () => {
    assertRoot?.();
    if (phase !== "preparing" || preparing.signal.aborted || !process.connected) throw new Error("preparation-host-lost");
    await new Promise<void>((resolve, reject) => {
      if (checked) { reject(new Error("preparation-check-conflict")); return; }
      const timer = setTimeout(() => { checked = undefined; reject(new Error("preparation-check-timeout")); }, 10000);
      const abort = () => { clearTimeout(timer); checked = undefined; reject(new Error("preparation-host-lost")); };
      preparing.signal.addEventListener("abort", abort, { once: true });
      checked = () => { clearTimeout(timer); preparing.signal.removeEventListener("abort", abort); resolve(); };
      send({ type: "preparation-check" });
    });
    assertRoot?.();
    if (phase !== "preparing" || preparing.signal.aborted || !process.connected) throw new Error("preparation-host-lost");
  };
  let operationSequence = 0;
  let sequence = 0, sending = false, transportLost = false, launched = false;
  let abandonOverlay: (() => CleanupResult) | undefined;
  let abandonPromise: Promise<void> | undefined;
  const pending: unknown[] = [];
  let requestLaunch: (() => void) | undefined;
  let rejectLaunch: ((error: Error) => void) | undefined;
  let resolveTabRelease: ((result: CleanupResult) => void) | undefined;
  // One in-flight message, no output backlog. Drop with a sequence gap when receiver is slow.
  const send = (event: Record<string, unknown>, output = false): void => {
    if (!process.connected || transportLost) return;
    if (output && sending && pending.length >= 32) { sequence++; return; }
    const message = { version: 1, token: input.token, identity: input.identity, sequence: ++sequence, ...event };
    if (sending) { if (pending.length < 40) pending.push(message); else transportLost = true; return; }
    const flush = (value: unknown): void => {
      sending = true;
      try { process.send!(value as object, (error: Error | null) => {
        sending = false;
        if (error) { transportLost = true; pending.length = 0; return; }
        const next = pending.shift(); if (next) flush(next);
      }); } catch { sending = false; transportLost = true; pending.length = 0; }
    };
    flush(message);
  };
  const disposePreparation = (): Promise<void> => abandonPromise ??= (async () => {
    // Unknown native drain or retained owned resources remain owned.
    if (preparationCleanupUnknown) throw new Error("native-preparation-drain-unknown");
    const overlay = abandonOverlay?.();
    const root = disposeRoot?.();
    if (overlay && overlay.status !== "confirmed" || root && root.status !== "confirmed") {
      throw new Error("preparation-resources-retained");
    }
    if (server) await server.close();
  })();
  process.on("disconnect", () => {
    transportLost = true; pending.length = 0;
    const resolveTab = resolveTabRelease; resolveTabRelease = undefined;
    resolveTab?.({ status: "unobservable", reason: "eh-tab-channel-unavailable" });
    if (!launched) {
      phase = "failed"; preparing.abort(); rejectFinalize?.(new Error("preparation-host-lost"));
      rejectLaunch?.(new Error("preparation-host-lost"));
      // Preparing code rechecks connectivity after each awaited capability.
      if (server) void disposePreparation().then(() => process.exit(0), () => process.exit(1));
    }
    // A committed execution belongs to this Owner, independent of the EH channel.
  });
  process.on("message", (message: unknown) => {
    if (phase === "empty") {
      if (!isDepartmentProcessPreparation(message)) { phase = "failed"; process.disconnect?.(); return; }
      input = structuredClone(message); phase = "preparing";
      void prepare().catch(async () => {
        phase = "failed";
        try { await disposePreparation(); } catch { /* retain unknown ownership */ }
        send({ type: "rejected", reason: "department-process-preparation-rejected" });
        if (process.connected) process.disconnect?.();
      });
      return;
    }
    if (!record(message) || message.sequence !== operationSequence + 1) {
      if (!launched) { phase = "failed"; preparing.abort(); rejectFinalize?.(new Error("preparation-sequence-invalid")); }
      if (process.connected) process.disconnect?.(); return;
    }
    operationSequence++;
    if (phase === "preparing" && finalize && record(message) && exactKeys(message, ["version", "token", "sequence", "operation", "identity", "launch"])
      && message.version === 1 && message.token === input.token && message.operation === "finalize"
      && isDepartmentExecutionIdentity(message.identity) && sameExecution(message.identity, input.identity)
      && process.connected && isDepartmentProcessPreparation({ ...input, launch: message.launch })) {
      const accept = finalize; finalize = undefined;
      accept(structuredClone(message.launch) as DepartmentProcessPreparation["launch"]); return;
    }
    if (phase === "preparing" && checked && record(message) && exactKeys(message, ["version", "token", "sequence", "operation", "identity"])
      && message.version === 1 && message.token === input.token && message.operation === "preparation-checked"
      && isDepartmentExecutionIdentity(message.identity) && sameExecution(message.identity, input.identity)
      && message.sequence === operationSequence) {
      const resolve = checked; checked = undefined; resolve(); return;
    }
    if (phase === "prepared" && record(message) && exactKeys(message, ["version", "token", "sequence", "operation", "identity"])
      && message.version === 1 && message.token === input.token && message.operation === "commit"
      && isDepartmentExecutionIdentity(message.identity) && sameExecution(message.identity, input.identity) && process.connected) {
      phase = "committing";
      if (phase === "committing" && process.connected) { phase = "committed"; send({ type: "committed" }); }
      return;
    }
    if (phase === "committed" && requestLaunch && record(message)
      && exactKeys(message, ["version", "token", "sequence", "operation", "identity"]) && message.version === 1
      && message.token === input.token && message.operation === "launch" && isDepartmentExecutionIdentity(message.identity)
      && sameExecution(message.identity, input.identity) && process.connected && !launched) {
      try { assertRoot!(); } catch { phase = "failed"; preparing.abort(); process.disconnect?.(); return; }
      // Consume the private grant once. Promise continuations spawn before another IPC event can run.
      launched = true; const accept = requestLaunch; requestLaunch = undefined; accept(); return;
    }
    if (phase === "committed" && launched && resolveTabRelease && record(message)
      && exactKeys(message, ["version", "token", "sequence", "operation", "identity", "result"])
      && message.version === 1 && message.token === input.token && message.operation === "tab-release-result"
      && isDepartmentExecutionIdentity(message.identity) && sameExecution(message.identity, input.identity)
      && Number.isSafeInteger(message.sequence)) {
      const empty = Object.fromEntries(CLEANUP_PARTS.map((part) => [part, { status: "not-applicable", reason: "tab-result-validation" }])) as Record<string, unknown>;
      const result = record(message.result) && isExecutionCleanup({ ...empty, tab: message.result })
        ? message.result as CleanupResult : { status: "unobservable", reason: "tab-release-result-invalid" } as CleanupResult;
      const resolve = resolveTabRelease; resolveTabRelease = undefined; resolve(result); return;
    }
    if (phase === "committed" && launched && record(message)
      && exactKeys(message, ["version", "token", "sequence", "operation", "identity"])
      && message.version === 1 && message.token === input.token && message.operation === "shutdown"
      && isDepartmentExecutionIdentity(message.identity) && sameExecution(message.identity, input.identity)) {
      phase = "failed"; // permanently closes private admission; never replay a task
      void (async () => {
        if (rootCleanup?.status !== "confirmed") throw new Error("owned-resources-retained");
        const client = new DepartmentExecutionOwnerClient(input.ownerDirectory);
        const observed = await client.observeExecution(input.identity);
        if (observed.status !== "cleaned") throw new Error("original-receipt-not-ready");
        await client.waitForCleanup(input.identity, required);
        await server!.close();
        send({ type: "stopped" });
        // Flush the ordered stopped event before disconnecting the original channel.
        const finish = () => { if (sending || pending.length) setImmediate(finish); else process.disconnect?.(); };
        finish();
      })().catch(() => { if (process.connected) process.disconnect?.(); });
      return;
    }
    // Reject every other private message. An active execution stays owned even if its channel is invalid.
    if (!launched) { phase = "failed"; preparing.abort(); rejectFinalize?.(new Error("preparation-message-invalid")); }
    if (process.connected) process.disconnect?.();
  });

  async function prepare(): Promise<void> {
    if (phase !== "preparing" || !process.connected) throw new Error("preparation-host-lost");
    let root: ReturnType<typeof createLoopSubtaskExecutionRoot>;
    try { root = createLoopSubtaskExecutionRoot(input.workspaceDirectory); }
    catch (error) {
      preparationCleanupUnknown = isLoopSubtaskLinkFailedError(error)
        && (!error.cleanupResult?.ok || error.cleanupResult.retainedDirectory);
      throw error;
    }
    assertRoot = root.assertCurrent;
    // Capture the original cleanup capability before canonical lookup or identity
    // checks can fail. An allocated root is still owned when those checks throw.
    disposeRoot = () => {
      if (rootCleanup) return rootCleanup;
      const result = root.dispose();
      rootCleanup = result.ok && !result.retainedDirectory ? { status: "confirmed", evidence: "owned-root-and-links-removed" }
        : { status: "failed", reason: "owned-root-or-links-retained" };
      return rootCleanup;
    };
    const cwd = fs.realpathSync(root.cwd);
    assertRoot();
    // The original Owner's root defines native instance, read-only probe and task events.
    const wasUnbound = input.identity.session.state === "unbound";
    let id: string;
    try {
      id = await createDepartmentOpenCodeSession({
        workspaceDirectory: cwd, requireDirectory: true, retired: input.retired, assertCurrent: checkHost,
        sessionState: input.identity.session.state,
        sessionId: input.identity.session.state === "bound" ? input.identity.session.id : undefined,
        launch: { ...input.launch, cwd }, overlay: input.overlay,
      }, preparing.signal);
    } catch (error) {
      preparationCleanupUnknown = error instanceof Error && error.message === "native-server-close-unobservable";
      throw error;
    }
    assertRoot();
    if (wasUnbound || input.retired) {
      if (phase !== "preparing" || !process.connected) throw new Error("preparation-host-lost");
      input.identity = { ...input.identity, session: { state: "bound", id } };
      const launch = await new Promise<DepartmentProcessPreparation["launch"]>((resolve, reject) => {
        finalize = resolve; rejectFinalize = reject; send({ type: "native-session" });
      });
      rejectFinalize = undefined;
      if (phase !== "preparing" || !process.connected) throw new Error("preparation-host-lost");
      // Only final argv may change. Configuration, environment, prefix and resource paths stay fixed.
      const fixed = ({ args: _args, ...rest }: DepartmentProcessPreparation["launch"]) => JSON.stringify(rest);
      const withoutSession = (args: string[]) => {
        const result: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--session" || args[i] === "-s") { i++; continue; }
          if (!/^(--session|-s)=/.test(args[i])) result.push(args[i]);
        }
        return JSON.stringify(result);
      };
      if (fixed(launch) !== fixed(input.launch) || withoutSession(launch.args) !== withoutSession(input.launch.args)) {
        throw new Error("native-session-launch-snapshot-changed");
      }
      input.launch = launch;
    }
    // No prompt is sent by this native read-only probe. Local tab labels are never accepted as proof.
    try { await verifySession(input, cwd, preparing.signal); }
    catch (error) {
      preparationCleanupUnknown = error instanceof Error && error.message === "native-probe-close-unobservable";
      throw error;
    }
    assertRoot();
    if (phase !== "preparing" || !process.connected) throw new Error("preparation-host-lost");
    const overlayResult = input.overlay ? createOpenCodeRuntimeConfigOverlay(input.overlay) : null;
    if (overlayResult && (!overlayResult.ok || !overlayResult.overlay)) throw new Error("overlay-unavailable");
    const overlay = overlayResult?.overlay ?? null;
    if (overlay) {
      const cleanup = overlay.cleanup.bind(overlay);
      let result: CleanupResult | undefined;
      overlay.cleanup = () => result ??= cleanup();
    }
    abandonOverlay = overlay?.cleanup;
    // Native persisted session and EH tab cannot be released by pretending process close is enough.
    const resources: DepartmentProcessResources = {
      // Process launcher invokes resource release only after its captured child
      // has actually closed and every owned stdio stream has drained.
      runner: { owned: true, release: async () => {
        return { status: "confirmed", evidence: "owned-cli-process-close-drain" };
      } },
      executionRoot: { owned: true, release: disposeRoot }, links: { owned: true, release: disposeRoot },
      // The launcher accounts for its core overlay directly in the temp fact.
      // This slot is only for additional temporary resources, none are prepared here.
      temp: { owned: false },
      tab: { owned: true, release: async () => {
        if (!process.connected) return Promise.resolve({ status: "unobservable", reason: "eh-tab-channel-unavailable" });
        if (resolveTabRelease) return Promise.resolve({ status: "unobservable", reason: "duplicate-tab-release" });
        const result = await new Promise<CleanupResult>((resolve) => { resolveTabRelease = resolve; send({ type: "release-tab" }); });
        const temp = abandonOverlay?.();
        if (result.status === "confirmed" && (rootCleanup?.status !== "confirmed" || temp && temp.status !== "confirmed"))
          return { status: "unobservable", reason: "owned-resources-retained" };
        return result;
      } },
    };
    const launcher = createDepartmentProcessExecutionLauncher((identity) => sameExecution(identity, input.identity) ? {
      identity: input.identity, selection: input.selection, executionMode: "process", resources,
      launch: { ...input.launch, cwd, overlay },
      handlers: {
        onStdout: (chunk) => { for (const part of splitOutput(chunk)) send({ type: "stdout", chunk: part }, true); },
        onStderr: (chunk) => { for (const part of splitOutput(chunk)) send({ type: "stderr", chunk: part }, true); },
        onExit: (code) => send({ type: "exit", code }),
        onError: () => send({ type: "error", reason: "department-process-child-error" }),
      },
    } : null);
    const requirements = launcher.requirements(input.identity);
    required = requirements;
    // Gate BOTH ports. Public start before durable EH commit cannot create a starting record or child.
    server = new DepartmentExecutionOwnerServer({ directory: input.ownerDirectory, ownerId: input.identity.ownerId,
      launcher: {
        seal(identity) {
          if (!launched) { phase = "failed"; preparing.abort(); rejectLaunch?.(new Error("original-generation-sealed")); return; }
          launcher.seal?.(identity);
        },
        requirements(identity) { if (phase !== "committed" || !launched && !process.connected) throw new Error("binding-not-committed"); return launcher.requirements(identity); },
        async launch(identity, bind) {
          if (phase !== "committed" || !process.connected) throw new Error("binding-not-committed");
          assertRoot!();
          if (phase !== "committed" || !process.connected) throw new Error("binding-not-committed");
          await new Promise<void>((resolve, reject) => {
            requestLaunch = resolve; rejectLaunch = reject;
            send({ type: "launch-request" });
          });
          rejectLaunch = undefined;
          if (!launched || phase !== "committed") throw new Error("launch-authorization-revoked");
          assertRoot!();
          const handle = await launcher.launch(identity, bind);
          void handle.completion.then((terminal) => send({ type: "terminal", terminal }));
          return handle;
        },
      } });
    fs.mkdirSync(input.ownerDirectory, { recursive: true, mode: 0o700 });
    await server.listen();
    if (phase !== "preparing" || !process.connected) throw new Error("preparation-host-lost");
    phase = "prepared"; send({ type: "prepared", requirements, directory: cwd });
  }
}

function splitOutput(chunk: string): string[] {
  const result: string[] = [];
  // Bound individual IPC messages, preserving UTF-16 surrogate pairs.
  for (let offset = 0; offset < chunk.length;) {
    let end = Math.min(chunk.length, offset + 8192);
    if (end < chunk.length && /[\uD800-\uDBFF]/.test(chunk[end - 1])) end--;
    result.push(chunk.slice(offset, end)); offset = end;
  }
  return result;
}

async function verifySession(input: DepartmentProcessPreparation, cwd: string, signal: AbortSignal): Promise<void> {
  if (input.identity.session.state !== "bound") throw new Error("native-session-unbound");
  const id = input.identity.session.id;
  // Preserve configured command prefix, not task arguments. Host supplies the final prefix separately via argv before `run`.
  const runIndex = input.launch.args.indexOf("run");
  if (runIndex < 0) throw new Error("unsupported-process-policy");
  let output = "", overflow = false, code: number | null = null, error = false;
  const child: CliProcessRuntimeHandle = runCliProcess({ ...input.launch, cwd,
    args: [...input.launch.args.slice(0, runIndex), "export", id] }, {
    onStdout: (chunk) => { if (Buffer.byteLength(output) + Buffer.byteLength(chunk) <= 1024 * 1024) output += chunk; else overflow = true; },
    onStderr: () => undefined, onExit: (value) => { code = value; }, onError: () => { error = true; },
  }, "ignore");
  const facts = await child.lifecycle;
  if (!facts || facts.processTerminal.status !== "confirmed" || facts.streams.status !== "confirmed") {
    throw new Error("native-probe-close-unobservable");
  }
  if (error || overflow || code !== 0) throw new Error("native-session-unobservable");
  if (signal.aborted) throw new Error("native-session-preparation-revoked");
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new Error("native-session-export-invalid"); }
  if (!record(value) || !record(value.info) || value.info.id !== id
    || typeof value.info.directory !== "string" || fs.realpathSync(value.info.directory) !== cwd) throw new Error("native-session-conflict");
}

if (require.main === module) {
  if (!process.send) process.exitCode = 1;
  else void runDepartmentProcessOwnerWorker();
}
