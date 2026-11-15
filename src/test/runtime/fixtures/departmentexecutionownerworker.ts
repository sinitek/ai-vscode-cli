import { appendFileSync } from "fs";
import { fork } from "child_process";
import * as path from "path";
import { DepartmentExecutionOwnerClient } from "../../../runtime/departmentexecutionownerclient";
import { DepartmentExecutionOwnerServer, type ExecutionCleanupEvidence, type ExecutionTerminalEvidence,
  type TrustedExecutionHandle } from "../../../runtime/departmentexecutionowner";
import type { CleanupRequirements, DepartmentExecutionIdentity } from "../../../runtime/departmentexecutionidentity";

const [, , mode, directory, ownerId, cleanupMode] = process.argv;
const worker = path.resolve(__filename);
const requirements: CleanupRequirements = {
  processTerminal: true, turnTerminal: false, streams: true, runner: true,
  executionRoot: true, links: true, temp: true, tab: true,
};

async function runOwner(): Promise<void> {
  const payloads = new Map<string, ReturnType<typeof fork>>();
  const payloadsClosed = new Set<string>();
  const cleanupGates = new Map<string, () => void>();
  let forcedFixtureRecovery = false;
  let recovery: Promise<void> | undefined;
  let server: DepartmentExecutionOwnerServer | undefined;
  const recordFixtureEvent = (event: string, details: Record<string, unknown> = {}): void => {
    appendFileSync(path.join(directory, "fixture-payload-lifecycle.jsonl"), JSON.stringify({
      event, ownerId, at: Date.now(), ...details,
    }) + "\n");
  };
  const reportDiagnosticFallback = (event: string, details: Record<string, unknown>, recordError: unknown): void => {
    const describe = (value: unknown): string => value instanceof Error ? value.message : String(value);
    const diagnostic = JSON.stringify({ event, ownerId, ...details, recordError: describe(recordError) });
    try {
      process.stderr.write(`fixture-diagnostic-fallback:${diagnostic}\n`);
    } catch (stderrError) {
      process.exitCode = process.exitCode ?? 2;
      try {
        process.emitWarning(`fixture-diagnostic-unavailable:${diagnostic};stderrError=${describe(stderrError)}`);
      } catch (warningError) {
        process.exitCode = 2;
        process.emitWarning(`fixture-diagnostic-emission-failed:${describe(warningError)}`);
      }
    }
  };
  const recordFixtureDiagnostic = (event: string, details: Record<string, unknown> = {}): void => {
    try {
      recordFixtureEvent(event, details);
    } catch (recordError) {
      reportDiagnosticFallback(event, details, recordError);
    }
  };
  const sendIpc = (message: Record<string, unknown>): Promise<void> => new Promise((resolve, reject) => {
    if (!process.send) { reject(new Error("fixture-ipc-send-unavailable")); return; }
    try {
      process.send(message, (error: Error | null) => error ? reject(error) : resolve());
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const notify = (message: Record<string, unknown>, operation: string): void => {
    void sendIpc(message).catch((error: unknown) => {
      recordFixtureDiagnostic("ipcSendFailed", { operation, message, error: error instanceof Error ? error.message : String(error) });
    });
  };
  const recordPayloadClosed = (executionId: string): void => {
    if (payloadsClosed.has(executionId)) return;
    payloadsClosed.add(executionId);
    recordFixtureEvent("closed", { executionId });
    notify({ payloadClosed: executionId }, "payloadClosed");
  };
  const terminatePayloads = async (): Promise<void> => {
    const entries = [...payloads.entries()];
    await Promise.all(entries.map(([executionId, payload]) => new Promise<void>((resolve) => {
      if (payloadsClosed.has(executionId)) { resolve(); return; }
      const onError = (error: Error): void => {
        recordFixtureEvent("payloadProcessError", { executionId, error: error.message });
      };
      const onClose = (): void => { cleanup(); resolve(); };
      const cleanup = (): void => { payload.removeListener("error", onError); payload.removeListener("close", onClose); };
      payload.once("error", onError);
      payload.once("close", onClose);
      if (payload.exitCode === null && payload.signalCode === null) {
        try { payload.kill(); }
        catch (error) { recordFixtureEvent("payloadKillFailed", { executionId, error: error instanceof Error ? error.message : String(error) }); }
      }
    })));
  };
  const finishForcedRecovery = (exitCode: number): Promise<void> => {
    forcedFixtureRecovery = true;
    if (recovery) return recovery;
    recovery = (async () => {
      await terminatePayloads();
      notify({ forcedPayloadsClosed: true }, "forcedPayloadsClosed");
      if (cleanupMode === "recovery-reject") throw new Error("fixture-injected-recovery-rejection");
      await server?.close();
      process.exitCode = exitCode;
    })();
    return recovery;
  };
  const observeRecovery = (promise: Promise<void>, operation: string, exitCode = 1): void => {
    void promise.then(() => {
      process.exit(exitCode);
    }, async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      recordFixtureDiagnostic("recoveryFailed", { operation, error: message });
      notify({ recoveryRejected: message }, "recoveryRejected");
      try { await server?.close(); }
      catch (closeError) {
        recordFixtureDiagnostic("ownerCloseFailed", { error: closeError instanceof Error ? closeError.message : String(closeError) });
      }
      process.exit(2);
    }).catch((observerError: unknown) => {
      recordFixtureDiagnostic("recoveryObserverFailed", {
        operation,
        error: observerError instanceof Error ? observerError.message : String(observerError),
      });
      process.exit(2);
    });
  };
  const closePayloadsOnSignal = (): void => { observeRecovery(finishForcedRecovery(1), "signal"); };
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, closePayloadsOnSignal);
  if (cleanupMode === "startup-error-ipc-unavailable") {
    process.disconnect();
    notify({ startupError: "fixture-startup-failure" }, "startupError");
    process.exitCode = 2;
    return;
  }
  if (cleanupMode === "startup-error") {
    notify({ startupError: "fixture-startup-failure" }, "startupError");
    process.exitCode = 2;
    return;
  }
  server = new DepartmentExecutionOwnerServer({
    directory,
    ownerId,
    launcher: {
      requirements: () => requirements,
      async launch(identity: DepartmentExecutionIdentity, bindSession): Promise<TrustedExecutionHandle> {
        if (cleanupMode === "delay-launch") {
          notify({ launching: true }, "launching");
          await new Promise((resolve) => setTimeout(resolve, 1_200));
        }
        appendFileSync(path.join(directory, "spawn-count.txt"), identity.executionId + "\n");
        await bindSession("fixture-session-" + identity.executionId);
        const child = fork(worker, ["payload", cleanupMode], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
        payloads.set(identity.executionId, child);
        child.once("close", () => {
          payloads.delete(identity.executionId);
          recordPayloadClosed(identity.executionId);
        });
        child.once("message", (message: unknown) => {
          if (message && typeof message === "object" && (message as { ready?: unknown }).ready === true) {
            notify({ payloadStarted: identity.executionId }, "payloadStarted");
          }
        });
        const completion = new Promise<ExecutionTerminalEvidence>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({
            processTerminal: cleanupMode === "gate-terminal-unknown" ? { status: "unobservable", reason: "fixture-terminal-proof-unavailable" }
              : { status: "confirmed", evidence: "fixture-child-close:" + String(code ?? signal) },
            turnTerminal: { status: "not-applicable", reason: "fixture-is-a-process" },
            streams: { status: "confirmed", evidence: "child-close-after-stream-drain" },
          }));
        });
        const cleanup = async (): Promise<ExecutionCleanupEvidence> => {
          if (["gate-cleanup", "gate-cleanup-fail", "gate-terminal-unknown"].includes(cleanupMode)) {
            await new Promise<void>((resolve) => {
              cleanupGates.set(identity.executionId, resolve);
              notify({ cleanupPending: identity.executionId }, "cleanupPending");
            });
          }
          return {
            runner: { status: "confirmed", evidence: "fixture-runner-released" },
            executionRoot: cleanupMode === "fail-root" || cleanupMode === "gate-cleanup-fail" || forcedFixtureRecovery
              ? { status: "failed", reason: forcedFixtureRecovery ? "fixture-forced-recovery" : "fixture-cleanup-failure" }
              : { status: "confirmed", evidence: "fixture-root-cleaned" },
            links: { status: "confirmed", evidence: "fixture-links-cleaned" },
            temp: { status: "confirmed", evidence: "fixture-temp-removed" },
            tab: { status: "confirmed", evidence: "fixture-tab-closed" },
          };
        };
        return { kind: "process", completion, cleanup };
      },
    },
  });
  await server.listen();
  process.once("disconnect", () => { observeRecovery(finishForcedRecovery(1), "disconnect"); });
  if (cleanupMode === "no-ready") {
    notify({ startupBlocked: true }, "startupBlocked");
  } else if (cleanupMode === "disconnect-ipc") {
    void sendIpc({ ready: true }).then(() => sendIpc({ ipcDisconnecting: true })).then(() => process.disconnect())
      .catch((error: unknown) => recordFixtureEvent("ipcSendFailed", { operation: "disconnect-handshake", error: error instanceof Error ? error.message : String(error) }));
  } else notify({ ready: true }, "ready");
  process.on("message", (message: unknown) => {
    if (message && typeof message === "object" && (message as { releaseExecution?: unknown }).releaseExecution && typeof (message as { executionId?: unknown }).executionId === "string") {
      const executionId = (message as { executionId: string }).executionId;
      const payload = payloads.get(executionId);
      if (payload && cleanupMode !== "ignore-release") {
        try {
          payload.send({ release: true }, (error) => {
            if (error) recordFixtureEvent("payloadSendFailed", { executionId, operation: "release", error: error.message });
          });
        } catch (error) {
          recordFixtureEvent("payloadSendFailed", { executionId, operation: "release", error: error instanceof Error ? error.message : String(error) });
        }
      }
    } else if (message && typeof message === "object" && typeof (message as { releaseCleanup?: unknown }).releaseCleanup === "string") {
      const id = (message as { releaseCleanup: string }).releaseCleanup;
      cleanupGates.get(id)?.(); cleanupGates.delete(id);
    } else if (message && typeof message === "object" && (message as { shutdown?: unknown }).shutdown === true) {
      void server?.close().then(() => process.exit(0), (error: unknown) => {
        notify({ shutdownRejected: error instanceof Error ? error.message : String(error) }, "shutdownRejected");
      });
    } else if (message && typeof message === "object" && (message as { forceFixtureRecovery?: unknown }).forceFixtureRecovery === true) {
      observeRecovery(finishForcedRecovery(0), "explicit", 0);
    } else if (message && typeof message === "object" && (message as { disconnectIpc?: unknown }).disconnectIpc === true) {
      if (process.connected) process.disconnect();
    }
  });
}

async function runClientStart(): Promise<void> {
  const identity = JSON.parse(ownerId) as DepartmentExecutionIdentity;
  const result = await new DepartmentExecutionOwnerClient(directory).startExecution(identity);
  process.stdout.write(JSON.stringify(result) + "\n");
}

function sendPayloadReady(): void {
  if (!process.send) return;
  try {
    process.send({ ready: true }, (error: Error | null) => {
      if (error) process.stderr.write("fixture-payload-ready-send-failed:" + error.message);
    });
  } catch (error) {
    process.stderr.write("fixture-payload-ready-send-failed:" + (error instanceof Error ? error.message : String(error)));
  }
}

if (mode === "owner") {
  void runOwner().catch((error: unknown) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
} else if (mode === "client-start") {
  void runClientStart().catch((error: unknown) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
} else if (mode === "payload") {
  if (["hold", "ignore-release", "recovery-reject", "gate-cleanup", "gate-cleanup-fail", "gate-terminal-unknown"].includes(process.argv[3])) {
    sendPayloadReady();
    process.on("message", (message: unknown) => {
      if (message && typeof message === "object" && (message as { release?: unknown }).release === true) process.exit(0);
    });
  } else setTimeout(() => process.exit(0), 1_500);
}
