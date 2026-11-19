import {
  CodexInteractiveRunner,
  type CodexRunnerOptions,
  type CodexStreamHandlers,
  type CodexExecutionObservationHandle,
  type CodexExecutionCleanupResult,
} from "./codexRunnerCore";
import type { CodexAppServerNotificationSource } from "./codexAppServerPoolCore";
import type { CodexRuntimePorts } from "./codexRuntimePorts";
import type { CleanupResult } from "../runtime/departmentexecutionidentity";
import { createCodexAbortError } from "./codexRunnerRuntime";

/** Unlike shared runner void callbacks, every returned promise is a responsibility. */
export type CodexOwnedStreamHandlers = {
  [K in keyof CodexStreamHandlers]: NonNullable<CodexStreamHandlers[K]> extends ((...args: infer A) => infer R)
    ? (...args: A) => R | Promise<Awaited<R>> : CodexStreamHandlers[K];
} & {
  onNotification?: (message: Readonly<Record<string, unknown>>, source: CodexAppServerNotificationSource) => void | Promise<void>;
};

export type CodexOwnedSession = Readonly<{
  threadId: string;
  connectionId: number;
  token: CodexExecutionObservationHandle["token"];
}>;
export type CodexOwnedExecutionResult = CodexExecutionCleanupResult & { processTerminal: CleanupResult };
export type CodexOwnedExecutionOptions = Readonly<{
  runner: CodexRunnerOptions;
  runtime: CodexRuntimePorts;
  prompt: string;
  handlers: CodexOwnedStreamHandlers;
  /** Required caller lifetime. A vanished/cancelled caller must not dispatch a task. */
  signal: AbortSignal;
  /** Persist this precise identity, then return that same frozen session object.
   * This is a trusted in-process latch, not a production persistence implementation. */
  bindSession: (session: CodexOwnedSession) => Promise<CodexOwnedSession>;
}>;

/** One immutable task, one native session, one transport. No update/retry API. */
export class CodexOwnedExecution {
  public readonly observation: Pick<CodexExecutionObservationHandle, "token" | "turnTerminal">;
  private readonly runner: CodexInteractiveRunner;
  private readonly handle: CodexExecutionObservationHandle;
  private readonly callbacks = new Set<Promise<unknown>>();
  private callbackFailed = false;
  private readonly handlers: CodexStreamHandlers;
  private readonly prompt: string;
  private readonly signal: AbortSignal;
  private readonly bindSession: CodexOwnedExecutionOptions["bindSession"];
  private preparePromise?: Promise<CodexOwnedSession>;
  private executePromise?: Promise<void>;
  private cleanupPromise?: Promise<CodexOwnedExecutionResult>;
  private sealed = false;
  private executionEntered = false;
  private finished = false;
  private cancelled = false;
  private readonly cancellation = new AbortController();
  private readonly onAbort = (): void => { this.cancel(); };

  public constructor(input: CodexOwnedExecutionOptions) {
    if (!input.signal || typeof input.bindSession !== "function") throw new TypeError("Owned caller signal and binding latch required");
    this.prompt = input.prompt;
    this.signal = input.signal;
    this.bindSession = input.bindSession;
    const callbacks = { ...input.handlers };
    // Snapshot functions once and consume rejections immediately, including late
    // promises from cancelled server handlers. Shared callbacks stay untouched.
    const wrapped: Record<string, unknown> = { ...callbacks };
    for (const [name, callback] of Object.entries(callbacks)) {
      if (typeof callback !== "function") continue;
      wrapped[name] = (...args: unknown[]) => {
        if (this.callbacks.size >= 64) {
          // Never evict a live responsibility and later call the drain cleaned.
          this.callbackFailed = true;
          return Promise.resolve(undefined);
        }
        try { return this.track(Promise.resolve(Reflect.apply(callback, callbacks, args))); }
        catch { this.callbackFailed = true; return Promise.resolve(undefined); }
      };
    }
    this.handlers = wrapped as CodexStreamHandlers;
    this.runner = new CodexInteractiveRunner(input.runner, input.runtime, {
      requestUserInputEnabled: callbacks.requestUserInputEnabled === true,
      onNotification: (message, source) => {
        const notify = wrapped.onNotification as CodexOwnedStreamHandlers["onNotification"];
        notify?.(message, source);
      },
    });
    this.handle = this.runner.createExecutionObservation();
    this.observation = Object.freeze({ token: this.handle.token, turnTerminal: this.handle.turnTerminal });
    this.signal.addEventListener("abort", this.onAbort, { once: true });
    if (this.signal.aborted) this.cancel();
  }

  private track<T>(promise: Promise<T>): Promise<T | undefined> {
    const consumed = promise.then((value) => value, () => { this.callbackFailed = true; return undefined; });
    this.callbacks.add(consumed);
    void consumed.then(() => { this.callbacks.delete(consumed); });
    return consumed;
  }

  private checkActive(): void {
    if (this.cancelled || this.signal.aborted) throw createCodexAbortError();
  }

  private untilCancelled<T>(promise: Promise<T>): Promise<T> {
    const signal = this.cancellation.signal;
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => { finish(); reject(createCodexAbortError()); };
      const finish = (): void => { signal.removeEventListener("abort", abort); };
      signal.addEventListener("abort", abort, { once: true });
      promise.then((value) => { finish(); resolve(value); }, (error) => { finish(); reject(error); });
      if (signal.aborted) abort();
    });
  }

  public prepare(): Promise<CodexOwnedSession> {
    if (this.preparePromise) return this.preparePromise;
    if (this.sealed) return Promise.reject(new Error("Owned execution is sealed"));
    this.preparePromise = (async () => {
      this.checkActive();
      const native = await this.untilCancelled(this.runner.prepareOwnedExecution());
      this.checkActive();
      return Object.freeze({ ...native, token: this.handle.token });
    })();
    return this.preparePromise;
  }

  public execute(): Promise<void> {
    if (this.executePromise) return this.executePromise;
    if (this.sealed) return Promise.reject(new Error("Owned execution is sealed"));
    this.executePromise = (async () => {
      const session = await this.prepare();
      this.checkActive();
      // Track the original promise even when cancellation wins the waiting race.
      const bound = await this.untilCancelled(this.track(Promise.resolve().then(() => this.bindSession(session))));
      this.checkActive();
      if (bound !== session) throw new Error("Owned native session binding identity mismatch or binding failed");
      this.executionEntered = true;
      await this.runner.runStreamed(this.prompt, this.handlers, this.handle);
    })();
    return this.executePromise;
  }

  public cancel(): void {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    this.cancellation.abort();
    this.runner.stopAndRebuild();
  }

  /** Calling while execute is pending seals admission, but does not truncate the
   * turn. Cancel explicitly to stop waiting for a missing terminal. No timeout
   * becomes evidence; a held pipe/handler can keep cleanup pending indefinitely. */
  public cleanup(): Promise<CodexOwnedExecutionResult> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.sealed = true;
    this.cleanupPromise = (async () => {
      if (this.executePromise) await this.executePromise.catch(() => undefined);
      else if (this.preparePromise) await this.preparePromise.catch(() => undefined);
      if (this.executePromise && !this.cancelled) {
        // Rejected binding/preparation never started the observation.
        // Only an actually dispatched operation needs a terminal before EOF.
        if (this.executionEntered) await this.untilCancelled(this.handle.turnTerminal).catch(() => undefined);
      }
      const result = await this.runner.drainOwnedExecution(this.handle);
      while (this.callbacks.size) await Promise.all([...this.callbacks]);
      this.signal.removeEventListener("abort", this.onAbort);
      this.finished = true;
      return this.callbackFailed ? { ...result, executionDrain: { status: "failed", reason: "owned-callback-or-binding-rejected" } } : result;
    })();
    return this.cleanupPromise;
  }
}
