import type { ChildProcess } from "child_process";
import * as path from "path";
import { spawn } from "cross-spawn";
import { t } from "../i18n";
import { freezeCodexRuntimePorts, type CodexRuntimePorts } from "./codexRuntimePorts";
import {
  createCodexAppServerNdjsonReader,
  serializeCodexAppServerMessage,
  type CodexAppServerNdjsonReader,
} from "./codexAppServerNdjson";
import {
  buildAppServerRequestResolution,
  type JsonRpcResolution,
} from "./codexAppServerProtocol";
import { createCliProcessPolicy } from "../cli/cliProcessPolicy";
import { requestChildShutdown } from "./codexRunnerProcessCore";
import { observeChildProcessLifecycle, type ProcessLifecycleEvidence } from "../cli/processLifecycle";
import type { CleanupResult } from "../runtime/departmentexecutionidentity";
import {
  CODEX_THREAD_BUSY,
  CODEX_THREAD_HANDOFF_FAILED,
  CODEX_THREAD_WRITER_CONFLICT,
  createCodexThreadError,
  createCodexHandoffError,
  isCodexActiveWriterMessage,
} from "./codexThreadErrors";

const CODEX_APP_SERVER_PROCESS_LABEL = "sinitek-ai-vscode-cli-codex-app-server";

export type CodexAppServerConnectionSpec = {
  key: string;
  exclusiveOwnerId?: string;
  /** Dedicated single-execution transport; default shared shutdown is unchanged. */
  ownedExecution?: boolean;
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  codexHomeDir: string;
  initializeParams: Record<string, unknown>;
};

export type CodexAppServerListener = {
  id: string;
  isActive: () => boolean;
  getOperationToken?: () => unknown;
  handleNotification: (message: Record<string, unknown>, source: CodexAppServerNotificationSource) => void;
  handleServerRequest: (
    method: string,
    params: unknown,
  ) => Promise<JsonRpcResolution | null | undefined> | JsonRpcResolution | null | undefined;
  onClosed: (info: CodexAppServerCloseInfo) => void;
};

/** Delivery provenance, captured by the actual reader, never inferred by a runner. */
export type CodexAppServerNotificationSource = Readonly<{
  connectionId: number;
  listener: CodexAppServerListener;
  sequence: number;
  ownedThread: boolean;
  buffered: boolean;
}>;

export type CodexAppServerCloseInfo = {
  connectionId: number;
  naturalExit: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  spawnError: Error | null;
};

type PendingRequest = {
  ownerId: string;
  method: string;
  loadingThreadId?: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  claimThreadFromResult: boolean;
  expectedThreadId?: string;
};

type InboundRequest = {
  id: string | number;
  method: string;
  threadId: string | null;
  listener: CodexAppServerListener;
  operationToken: unknown;
  cancel: () => void;
};

// Only native interactive requests may wait for a user. RPC responses and
// lifecycle notifications must retain the wire order in readLoop.
const INTERACTIVE_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval", "item/fileChange/requestApproval",
  "item/permissions/requestApproval", "item/tool/requestUserInput",
  "mcpServer/elicitation/request", "applyPatchApproval", "execCommandApproval",
]);

const connections = new Map<string, CodexAppServerConnection>();
const processConnections = new Set<CodexAppServerConnection>();
const threadLeases = new Set<string>();
const CODEX_THREAD_HANDOFF_TIMEOUT_MS = 75_000;
const CODEX_THREAD_RELEASE_POLL_MS = 250;
let nextConnectionId = 1;

export type CodexThreadHandoffOptions = {
  timeoutMs?: number;
  checkActive?: () => void;
};

function normalizeCodexHome(home: string): string {
  const resolved = path.resolve(home);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function buildCodexAppServerConnectionKey(input: {
  exclusiveOwnerId?: string;
  configFingerprint?: string;
  command: string;
  args: string[];
  cwd?: string;
  codexHomeDir: string;
  modelProvider: string | null;
}): string {
  return JSON.stringify({
    command: input.command,
    args: input.args,
    cwd: input.cwd ?? "",
    codexHomeDir: input.codexHomeDir,
    modelProvider: input.modelProvider ?? "",
    configFingerprint: input.configFingerprint ?? "",
    ...(input.exclusiveOwnerId ? { exclusiveOwnerId: input.exclusiveOwnerId } : {}),
  });
}

export function acquireCodexAppServer(
  spec: CodexAppServerConnectionSpec,
  listener: CodexAppServerListener,
  runtime: CodexRuntimePorts,
): CodexAppServerConnection {
  const existing = connections.get(spec.key);
  if (existing && existing.isAlive()) {
    existing.retain(listener);
    return existing;
  }
  if (existing && !existing.isDrainingAfterExit()) {
    existing.shutdown("terminate");
  }
  const connection = new CodexAppServerConnection(spec, runtime);
  connections.set(spec.key, connection);
  connection.retain(listener);
  return connection;
}

export function countAliveConnections(entries: Iterable<{ isAlive(): boolean }>): number {
  let alive = 0;
  for (const entry of entries) {
    if (entry.isAlive()) {
      alive += 1;
    }
  }
  return alive;
}

export function countAliveCodexAppServerConnections(): number {
  return countAliveConnections(connections.values());
}

export function shutdownCodexAppServerPool(): void {
  for (const connection of Array.from(connections.values())) {
    connection.shutdown("terminate");
  }
  connections.clear();
}

export class CodexAppServerConnection {
  private ownedSealed = false;
  private ownedDrainPromise?: Promise<{ runner: CleanupResult; streams: CleanupResult; processTerminal: CleanupResult; executionDrain: CleanupResult }>;
  private ownedTransportFailure: string | null = null;
  private naturalCloseFinalizing = false;
  private naturalCloseDone?: Promise<void>;
  private resolveNaturalClose?: () => void;
  private readonly handlerTasks = new Set<Promise<unknown>>();
  private notificationSequence = 0;
  public getNotificationSequence(): number { return this.notificationSequence; }
  public readonly id = nextConnectionId++;
  public readonly key: string;
  private readonly listeners = new Map<string, CodexAppServerListener>();
  private readonly threadOwners = new Map<string, string>();
  private readonly loadedThreads = new Set<string>();
  private readonly threadLoadGenerations = new Map<string, number>();
  private nextThreadLoadGeneration = 1;
  private readonly inbound = new Map<string | number, InboundRequest>();
  private readonly handlingOwners = new Map<string, number>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly buffered = new Map<string, Record<string, unknown>[]>();
  private readonly activeOwners = new Set<string>();
  private readonly homeScope: string;
  private processExited = false;
  private child: ChildProcess | null = null;
  private reader: CodexAppServerNdjsonReader | null = null;
  private processLifecycle: Promise<ProcessLifecycleEvidence> | null = null;
  private readLoopDone: Promise<void> | null = null;
  private nextRequestId = 1;
  private started = false;
  private fresh = true;
  private closed = false;
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private stderrChunks: Buffer[] = [];
  private spawnError: Error | null = null;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;

  private readonly runtime: CodexRuntimePorts;

  public constructor(private readonly spec: CodexAppServerConnectionSpec, runtime: CodexRuntimePorts) {
    this.runtime = freezeCodexRuntimePorts(runtime);
    this.key = spec.key;
    this.homeScope = normalizeCodexHome(spec.codexHomeDir);
    processConnections.add(this);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    void this.readyPromise.catch(() => undefined);
  }

  public takeFresh(): boolean {
    if (!this.fresh) {
      return false;
    }
    this.fresh = false;
    return true;
  }

  public isAlive(): boolean {
    return !this.closed && this.child !== null && !this.isDrainingAfterExit();
  }

  public isDrainingAfterExit(): boolean {
    return !this.closed && (this.processExited
      || (this.child !== null && (this.child.exitCode !== null || this.child.signalCode !== null)));
  }

  public hasLoadedThread(threadId: string | null | undefined): boolean {
    const normalized = String(threadId || "").trim();
    return Boolean(normalized) && this.loadedThreads.has(normalized);
  }

  public retainerCount(): number {
    return this.listeners.size;
  }

  public retain(listener: CodexAppServerListener): void {
    if (this.ownedSealed || (this.spec.ownedExecution && this.listeners.size > 0
      && this.listeners.get(listener.id) !== listener)) throw new Error("Owned Codex connection cannot retain new listeners");
    if (this.spec.exclusiveOwnerId && this.spec.exclusiveOwnerId !== listener.id) {
      throw createCodexThreadError(CODEX_THREAD_BUSY, "该 Codex 连接为专属连接，不能由其它会话共用。");
    }
    if (this.listeners.get(listener.id) !== listener) {
      this.cancelServerRequests(listener.id);
    }
    this.listeners.set(listener.id, listener);
    this.ensureStarted();
  }

  public release(listenerId: string): void {
    if (this.isDrainingAfterExit()) return;
    this.detachListener(listenerId);
    if (this.listeners.size === 0) {
      this.shutdown("terminate");
    }
  }

  /** Read-only facts about this actual pool process. shutdown()/exit are not
   * sufficient: all owned stdio and the NDJSON consumer must naturally drain.
   * This is not evidence that a particular turn reached its native terminal.
   */
  public async observeProcessTermination(): Promise<ProcessLifecycleEvidence> {
    if (!this.processLifecycle) return {
      processTerminal: { status: "unobservable", reason: "pool-has-no-process-observation" },
      streams: { status: "unobservable", reason: "pool-has-no-reader-observation" },
    };
    const facts = await this.processLifecycle;
    await this.readLoopDone;
    if (this.spec.ownedExecution) await this.naturalCloseDone;
    const drained = await this.reader?.drained;
    return { processTerminal: facts.processTerminal,
      streams: facts.streams.status !== "confirmed" ? facts.streams
        : drained ?? { status: "unobservable", reason: "pool-has-no-reader-observation" } };
  }

  /** Seal only a proven exclusive connection. Keep its reader/listener alive through
   * natural EOF and actual close; stdin EOF requests exit, it is never evidence.
   * Missing responses and uncancellable handlers can deliberately keep this pending.
   */
  public drainOwnedExecution(ownerId: string): Promise<{
    runner: CleanupResult; streams: CleanupResult; processTerminal: CleanupResult; executionDrain: CleanupResult;
  }> {
    if (ownerId !== this.spec.exclusiveOwnerId) {
      const unknown: CleanupResult = { status: "unobservable", reason: "exclusive-execution-owner-mismatch" };
      return Promise.resolve({ runner: unknown, streams: unknown, processTerminal: unknown, executionDrain: unknown });
    }
    if (this.ownedDrainPromise) return this.ownedDrainPromise;
    if (!this.spec.ownedExecution || this.spec.exclusiveOwnerId !== ownerId
      || (!this.closed && (this.listeners.size !== 1 || !this.listeners.has(ownerId)))
      || [...this.threadOwners.values()].some((owner) => owner !== ownerId)
      || this.activeOwners.size > 0
      || [...this.threadOwners.keys()].some((id) => threadLeases.has(JSON.stringify([this.homeScope, id])))) {
      const unknown: CleanupResult = { status: "unobservable", reason: "exclusive-execution-ownership-unverified" };
      return Promise.resolve({ runner: unknown, streams: unknown, processTerminal: unknown, executionDrain: unknown });
    }
    this.ownedSealed = true;
    this.ownedDrainPromise = (async () => {
      // A cancelled RPC must not erase the underlying caller's handler lifetime.
      await this.waitForHandlers();
      if (!this.closed && this.child?.stdin && !this.child.stdin.writableEnded) {
        try { this.child.stdin.end(); } catch { this.ownedTransportFailure = "owned-stdin-end-failed"; }
      }
      const facts = await this.observeProcessTermination();
      await this.waitForHandlers();
      const complete = !this.ownedTransportFailure && !this.buffered.size
        && !this.pending.size && !this.inbound.size && !this.handlingOwners.size;
      const executionDrain: CleanupResult = complete && facts.processTerminal.status === "confirmed"
        && facts.streams.status === "confirmed"
        ? { status: "confirmed", evidence: "exclusive-source-closed-natural-ndjson-and-request-consumers-finished" }
        : { status: "unobservable", reason: this.ownedTransportFailure ?? "exclusive-source-or-consumers-not-drained" };
      return { ...facts, executionDrain,
        runner: complete && facts.processTerminal.status === "confirmed"
          ? { status: "confirmed", evidence: "exclusive-process-closed-and-listener-detached" }
          : { status: "unobservable", reason: "exclusive-runner-release-unverified" } };
    })();
    return this.ownedDrainPromise;
  }

  private async waitForHandlers(): Promise<void> {
    while (this.handlerTasks.size) await Promise.allSettled([...this.handlerTasks]);
  }

  /** Trusted disposal port for precisely this listener's single owned thread.
   * Never unload another listener's thread or stop a shared pool to clean one
   * execution. A live shared reader does not prove full stream drain.
   */
  public async releaseOwnedThreadWithEvidence(listenerId: string, threadId: string,
    options: CodexThreadHandoffOptions = {}): Promise<{ runner: CleanupResult; streams: CleanupResult }> {
    const unknown = (reason: string): { runner: CleanupResult; streams: CleanupResult } => ({
      runner: { status: "unobservable", reason }, streams: { status: "unobservable", reason },
    });
    const leaseKey = JSON.stringify([this.homeScope, threadId]);
    if (!this.listeners.has(listenerId) || this.threadOwners.get(threadId) !== listenerId
      || [...this.threadOwners].some(([id, owner]) => owner === listenerId && id !== threadId)
      || this.activeOwners.has(listenerId) || threadLeases.has(leaseKey)
      || (this.handlingOwners.get(listenerId) ?? 0) > 0
      || [...this.pending.values()].some((pending) => pending.ownerId === listenerId)) {
      return unknown("owned-thread-release-conflict");
    }
    threadLeases.add(leaseKey);
    try {
      await this.releaseThreadForHandoff(threadId, options);
      // exit clears the bookkeeping set before ChildProcess.close/stdio drain.
      // An empty set is therefore not native notLoaded/thread/closed evidence.
      // Keep this listener until the actual process observation settles.
      if (this.processExited || this.closed) {
        const facts = await this.observeProcessTermination();
        if (facts.processTerminal.status !== "confirmed") return unknown("owned-thread-process-close-unverified");
        this.detachListener(listenerId);
        return { runner: facts.processTerminal.status === "confirmed"
          ? { status: "confirmed", evidence: "owned-thread-process-closed-and-listener-detached" }
          : { status: "unobservable", reason: "owned-thread-process-close-unverified" }, streams: facts.streams };
      }
      if (this.holdsThread(threadId)) return unknown("owned-thread-release-unverified");
      this.detachListener(listenerId);
      // Native notLoaded/closed is reusable thread-release evidence. It says
      // nothing about a read loop still serving other owners.
      return { runner: { status: "confirmed", evidence: "native-thread-unloaded-and-listener-detached" },
        streams: { status: "unobservable", reason: "shared-read-loop-still-active" } };
    } catch {
      return unknown("owned-thread-release-failed");
    } finally {
      threadLeases.delete(leaseKey);
    }
  }

  public async releaseStoppedThread(
    ownerId: string,
    threadId: string,
    options: CodexThreadHandoffOptions = {},
  ): Promise<void> {
    const leaseKey = JSON.stringify([this.homeScope, threadId]);
    const owner = this.threadOwners.get(threadId);
    if (threadLeases.has(leaseKey) || this.activeOwners.has(ownerId)
      || (owner && owner !== ownerId && this.activeOwners.has(owner))) {
      throw createCodexThreadError(CODEX_THREAD_BUSY, "该 Codex 会话尚未结束，不能确认暂停。");
    }
    threadLeases.add(leaseKey);
    try {
      await this.releaseThreadForHandoff(threadId, options);
    } finally {
      threadLeases.delete(leaseKey);
    }
  }

  public async withThread<T>(
    ownerId: string,
    threadId: string | null,
    operation: () => Promise<T>,
    options: CodexThreadHandoffOptions = {},
  ): Promise<T> {
    if (this.ownedSealed) throw new Error("Owned Codex connection is sealed");
    if (this.spec.exclusiveOwnerId && this.spec.exclusiveOwnerId !== ownerId) {
      throw createCodexThreadError(CODEX_THREAD_BUSY, "该 Codex 连接为专属连接，不能由其它会话执行操作。");
    }
    const leaseKey = threadId ? JSON.stringify([this.homeScope, threadId]) : null;
    if (leaseKey && threadLeases.has(leaseKey)) {
      throw createCodexThreadError(CODEX_THREAD_BUSY, "该 Codex 会话正在执行另一项操作，请等待完成后再继续。");
    }
    if (leaseKey) {
      threadLeases.add(leaseKey);
    }
    this.activeOwners.add(ownerId);
    const handoffDeadline = Date.now() + (options.timeoutMs ?? CODEX_THREAD_HANDOFF_TIMEOUT_MS);
    try {
      options.checkActive?.();
      if (threadId) {
        for (const previous of processConnections) {
          if (previous.homeScope !== this.homeScope || !previous.holdsThread(threadId)) {
            continue;
          }
          const previousOwner = previous.threadOwners.get(threadId);
          if (previousOwner !== ownerId && previousOwner && previous.activeOwners.has(previousOwner)) {
            throw createCodexThreadError(CODEX_THREAD_BUSY, "该 Codex 会话仍由另一项操作使用，不能强制交接。");
          }
          if (previous !== this) {
            void this.runtime.logInfo("codex-thread-handoff-start", { fromConnectionId: previous.id, toConnectionId: this.id, threadId });
            await previous.releaseThreadForHandoff(threadId, {
              ...options, timeoutMs: Math.max(0, handoffDeadline - Date.now()),
            });
          }
        }
      }
      options.checkActive?.();
      return await operation();
    } finally {
      this.cancelServerRequests(ownerId);
      this.activeOwners.delete(ownerId);
      if (leaseKey) {
        threadLeases.delete(leaseKey);
      }
    }
  }

  private async releaseThreadForHandoff(threadId: string, options: CodexThreadHandoffOptions): Promise<void> {
    if (this.spec.ownedExecution && !this.processExited) {
      throw createCodexThreadError(CODEX_THREAD_BUSY, "该 Codex 专属执行尚未完成自身收尾，不能由其它连接强制交接。");
    }
    const deadline = Date.now() + (options.timeoutMs ?? CODEX_THREAD_HANDOFF_TIMEOUT_MS);
    const ownerId = `handoff-${this.id}-${threadId}`;
    let requestError: Error | null = null;
    let invalidResponse = false;
    let requestInFlight = false;
    let nextQueryAt = 0;
    let finished = false;
    void this.runtime.logInfo("codex-thread-handoff-wait", {
      connectionId: this.id, pid: this.child?.pid ?? null, threadId,
      listeners: this.listeners.size, awaitingExit: this.closed,
    });
    const waitStep = async (): Promise<void> => {
      options.checkActive?.();
      if ((requestError && !this.closed) || Date.now() >= deadline) {
        const rawCode = (requestError as (Error & { code?: unknown }) | null)?.code;
        const rpcCode = typeof rawCode === "number" ? rawCode
          : typeof rawCode === "string" && /^[A-Z0-9_-]{1,48}$/i.test(rawCode) ? rawCode : undefined;
        const reason = !this.closed && requestError
          ? invalidResponse ? "invalid_response" : rpcCode === -32601 ? "protocol_unsupported" : "unload_failed"
          : "timeout";
        throw createCodexHandoffError({
          connectionId: this.id, threadId, rpcMethod: "thread/unsubscribe", rpcCode,
          stage: this.closed ? "waiting_exit" : this.hasPendingThreadLoad(threadId) ? "waiting_load"
            : requestInFlight || requestError ? "requesting_unload" : "waiting_close",
          reason,
          // Server messages may contain credentials, configuration or user text.
          causeSummary: requestError ? reason === "protocol_unsupported" ? "JSON-RPC method not found"
            : invalidResponse ? "Unexpected unsubscribe status" : "JSON-RPC request rejected" : undefined,
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    };
    try {
      options.checkActive?.();
      if (this.spec.exclusiveOwnerId && this.listeners.size <= 1
        && this.activeOwners.size === 0 && this.pending.size === 0 && this.inbound.size === 0
        && this.loadedThreads.size === 1 && this.loadedThreads.has(threadId)) {
        this.shutdown("terminate");
      }
      while (!this.closed && this.hasPendingThreadLoad(threadId)) {
        await waitStep();
      }
      while (!this.processExited && this.holdsThread(threadId)) {
        options.checkActive?.();
        if (!this.closed && !requestError && !requestInFlight && Date.now() < deadline
          && Date.now() >= nextQueryAt && !this.hasPendingThreadLoad(threadId)) {
          // Unsubscribe acknowledgements only detach the subscriber. Query again after
          // idle teardown: notLoaded is the native release evidence, even if closed
          // was not observed. Never overlap queries or retry a failed/unanswered RPC.
          const generation = this.threadLoadGenerations.get(threadId);
          requestInFlight = true;
          void this.request<{ status: string }>(ownerId, "thread/unsubscribe", { threadId }).then((result) => {
            if (finished) {
              return;
            }
            if (result?.status === "notLoaded") {
              if (generation === this.threadLoadGenerations.get(threadId) && !this.hasPendingThreadLoad(threadId)) {
                this.forgetThread(threadId);
              }
            } else if (result?.status !== "unsubscribed" && result?.status !== "notSubscribed") {
              invalidResponse = true;
              requestError = new Error("Codex 返回了未知的会话卸载状态。");
            }
          }, (error: Error) => { requestError = error; }).finally(() => {
            requestInFlight = false;
            nextQueryAt = Date.now() + CODEX_THREAD_RELEASE_POLL_MS;
          });
        }
        await waitStep();
      }
      void this.runtime.logInfo("codex-thread-handoff-released", { connectionId: this.id, pid: this.child?.pid ?? null, threadId });
    } catch (error) {
      void this.runtime.logError("codex-thread-handoff-failed", {
        connectionId: this.id, pid: this.child?.pid ?? null, threadId,
        reason: requestError ? "unsubscribe_failed" : Date.now() >= deadline ? "timeout" : "cancelled",
        diagnostic: (error as Error & { diagnostic?: unknown }).diagnostic,
      });
      throw error;
    } finally {
      finished = true;
      this.rejectOwner(ownerId, createCodexThreadError(CODEX_THREAD_HANDOFF_FAILED, "Codex 会话交接等待已结束。"));
    }
  }

  private hasPendingThreadLoad(threadId: string): boolean {
    return Array.from(this.pending.values()).some((pending) => pending.loadingThreadId === threadId);
  }

  private holdsThread(threadId: string): boolean {
    return this.hasLoadedThread(threadId) || this.hasPendingThreadLoad(threadId);
  }

  private forgetThread(threadId: string): void {
    if (this.spec.ownedExecution && this.buffered.get(threadId)?.length) this.ownedTransportFailure ??= "owned-unrouted-messages-forgotten";
    this.cancelInbound((request) => request.threadId === threadId);
    this.loadedThreads.delete(threadId);
    this.threadLoadGenerations.delete(threadId);
    this.threadOwners.delete(threadId);
    this.buffered.delete(threadId);
  }

  private markProcessExited(): void {
    if (this.processExited) {
      return;
    }
    this.cancelInbound(() => true, false);
    this.processExited = true;
    processConnections.delete(this);
    this.loadedThreads.clear();
    void this.runtime.logInfo("codex-app-server-process-exited", {
      connectionId: this.id, pid: this.child?.pid ?? null, code: this.exitCode, signal: this.exitSignal,
    });
  }

  public claimThread(threadId: string, listenerId: string): void {
    const normalized = String(threadId || "").trim();
    const listener = this.listeners.get(listenerId);
    if (!normalized) {
      return;
    }
    this.loadedThreads.add(normalized);
    this.threadLoadGenerations.set(normalized, this.nextThreadLoadGeneration++);
    if (!listener) {
      return;
    }
    const previousOwner = this.threadOwners.get(normalized);
    if (previousOwner && previousOwner !== listenerId) {
      this.cancelInbound((request) => request.threadId === normalized);
    }
    this.threadOwners.set(normalized, listenerId);
    const queued = this.buffered.get(normalized);
    if (!queued) {
      return;
    }
    this.buffered.delete(normalized);
    for (const message of queued) {
      this.deliverNotification(listener, message, true);
    }
  }

  public async whenReady(): Promise<void> {
    this.ensureStarted();
    await this.readyPromise;
  }

  public async request<T = unknown>(
    ownerId: string,
    method: string,
    params: Record<string, unknown>,
    expectedThreadId?: string,
  ): Promise<T> {
    if (this.ownedSealed) throw new Error("Owned Codex connection is sealed");
    await this.whenReady();
    if (this.ownedSealed) throw new Error("Owned Codex connection is sealed");
    return this.requestInternal<T>(ownerId, method, params, method === "thread/start" || method === "thread/resume", expectedThreadId);
  }

  public startPreparedTurn<T>(ownerId: string, params: Record<string, unknown>, commit: () => void, onSent?: () => void): Promise<T> {
    if (this.ownedSealed || !this.isAlive() || !this.child?.stdin?.writable) {
      throw new Error(t("codex.appServerStdinUnavailable"));
    }
    return this.requestInternal<T>(ownerId, "turn/start", params, false, undefined, commit, onSent);
  }

  public notify(method: string, params?: Record<string, unknown>): void {
    if (this.ownedSealed && method !== "initialized") throw new Error("Owned Codex connection is sealed");
    const message: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params && Object.keys(params).length > 0) {
      message.params = params;
    }
    this.send(message);
  }

  public rejectOwner(ownerId: string, error: Error): void {
    this.cancelServerRequests(ownerId);
    for (const [id, pending] of this.pending.entries()) {
      if (pending.ownerId !== ownerId) {
        continue;
      }
      pending.reject(error);
      if (pending.claimThreadFromResult) {
        pending.reject = () => undefined;
        pending.resolve = () => undefined;
      } else {
        this.pending.delete(id);
      }
    }
  }

  public shutdown(mode: "graceful" | "terminate"): void {
    if (this.closed) {
      return;
    }
    if (this.spec.ownedExecution && !this.naturalCloseFinalizing) this.ownedTransportFailure = "owned-transport-shutdown-before-natural-drain";
    if (this.spec.ownedExecution && this.pending.size) this.ownedTransportFailure ??= "owned-native-responses-missing-at-close";
    if (this.spec.ownedExecution && this.buffered.size) this.ownedTransportFailure ??= "owned-unrouted-messages-at-close";
    if (this.spec.ownedExecution && this.inbound.size) this.ownedTransportFailure ??= "owned-server-requests-unanswered-at-close";
    this.cancelInbound(() => true);
    this.closed = true;
    if (connections.get(this.key) === this) {
      connections.delete(this.key);
    }
    const error = this.spawnError ?? new Error(t("codex.appServerExited", {
      detail: this.exitSignal ? `signal ${this.exitSignal}` : `code ${this.exitCode ?? 1}`,
      stderr: Buffer.concat(this.stderrChunks).toString("utf8") || "-",
    }));
    for (const pending of this.pending.values()) {
      if (pending.loadingThreadId && !this.processExited) {
        this.loadedThreads.add(pending.loadingThreadId);
      }
    }
    this.rejectAll(error);
    this.readyReject?.(error);
    this.readyReject = null;
    if (this.child && !this.processExited) {
      requestChildShutdown(this.child, mode, this.runtime);
    } else if (!this.child) {
      this.markProcessExited();
    }
    this.reader?.close();
    const info: CodexAppServerCloseInfo = {
      connectionId: this.id,
      naturalExit: this.naturalCloseFinalizing && !this.spawnError && (this.exitCode !== null || this.exitSignal !== null),
      code: this.exitCode,
      signal: this.exitSignal,
      stderr: Buffer.concat(this.stderrChunks).toString("utf8"),
      spawnError: this.spawnError,
    };
    for (const listener of Array.from(this.listeners.values())) {
      listener.onClosed(info);
    }
    this.listeners.clear();
    this.threadOwners.clear();
    if (this.processExited) {
      this.loadedThreads.clear();
    }
    this.buffered.clear();
  }

  private detachListener(listenerId: string): void {
    this.cancelServerRequests(listenerId);
    this.listeners.delete(listenerId);
    for (const [threadId, ownerId] of this.threadOwners.entries()) {
      if (ownerId === listenerId) {
        this.threadOwners.delete(threadId);
      }
    }
  }

  private ensureStarted(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.runtime.logInfo("codex-app-server-spawn", { connectionId: this.id });
    let child: ChildProcess;
    try {
      child = spawn(this.spec.command, this.spec.args, createCliProcessPolicy().spawnOptions(this.spec.command, {
        cwd: this.spec.cwd,
        baseEnvironment: this.spec.env,
        processLabel: CODEX_APP_SERVER_PROCESS_LABEL,
      }));
    } catch (error) {
      const spawnError = error instanceof Error ? error : new Error(String(error));
      this.spawnError = spawnError;
      this.failStart(spawnError);
      return;
    }
    this.child = child;
    if (this.spec.ownedExecution) this.naturalCloseDone = new Promise((resolve) => { this.resolveNaturalClose = resolve; });
    this.processLifecycle = observeChildProcessLifecycle(child);
    void this.runtime.logInfo("codex-app-server-started", { connectionId: this.id, pid: child.pid ?? null });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      this.spawnError = error;
      if (!child.pid) {
        this.markProcessExited();
      }
      void this.runtime.logError("codex-app-server-spawn-error", {
        command: this.spec.command,
        code: (error as NodeJS.ErrnoException).code ?? null,
        pid: child.pid ?? null,
        error: error.message,
      });
      this.failStart(error);
    });
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      this.exitCode = code;
      this.exitSignal = signal;
      this.markProcessExited();
    };
    child.once("exit", onExit);
    child.once("close", (code, signal) => {
      onExit(code, signal);
      if (!this.closed) {
        void (async () => {
          await this.readLoopDone;
          if (!this.closed) {
            this.naturalCloseFinalizing = true;
            this.shutdown("terminate");
          }
          this.resolveNaturalClose?.();
        })();
      } else this.resolveNaturalClose?.();
    });
    if (!child.stdout) {
      this.failStart(new Error(t("codex.appServerNoStdout")));
      return;
    }
    this.reader = createCodexAppServerNdjsonReader(child.stdout);
    this.readLoopDone = this.readLoop();
    void this.initialize();
  }

  private failStart(error: Error): void {
    this.readyReject?.(error);
    this.readyReject = null;
    if (!this.closed) {
      this.shutdown("terminate");
    }
  }

  private async initialize(): Promise<void> {
    try {
      await this.requestInternal("connection", "initialize", this.spec.initializeParams, false);
      if (!this.isAlive()) return;
      this.notify("initialized");
      this.readyResolve?.();
      this.readyResolve = null;
    } catch (error) {
      if (!this.closed) {
        this.failStart(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) {
      return;
    }
    try {
      for await (const line of this.reader.lines) {
        if (this.closed) {
          break;
        }
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(trimmed) as Record<string, unknown>;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.shutdown("terminate");
          this.rejectAll(new Error(t("codex.appServerParseFailed", { error: detail })));
          break;
        }
        await this.dispatch(message);
        if (this.spec.ownedExecution && typeof message.method === "string" && !("id" in message)
          && this.runtime.waitForNotificationConsumers) {
          // The private owner channel has a fixed ACK window. Do not read a
          // native burst into more live callbacks than that window can hold.
          // Requests remain outside this barrier so cancellation/resolution
          // notifications can still reach an outstanding interactive request.
          this.child?.stdout?.pause();
          try { await this.runtime.waitForNotificationConsumers(); }
          finally { this.child?.stdout?.resume(); }
        }
      }
    } catch (error) {
      if (!this.closed) {
        this.shutdown("terminate");
        this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async dispatch(message: Record<string, unknown>): Promise<void> {
    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    const hasResult = Object.prototype.hasOwnProperty.call(message, "result");
    const hasError = Object.prototype.hasOwnProperty.call(message, "error");
    const method = String(message.method || "").trim();
    if (hasId && (hasResult || hasError) && !method) {
      this.settleResponse(message);
      return;
    }
    if (hasId && method) {
      this.handleServerRequest(message, method);
      return;
    }
    if (!method) {
      return;
    }
    if (method === "serverRequest/resolved") {
      const params = message.params as Record<string, unknown> | undefined;
      const request = this.inbound.get(params?.requestId as string | number);
      if (request && request.threadId === params?.threadId) {
        this.inbound.delete(request.id);
        request.cancel();
      }
      const listener = this.routeTarget(message);
      if (listener) this.deliverNotification(listener, message);
      return;
    }
    if (method === "thread/closed") {
      const threadId = extractRoutingThread(message).threadId;
      if (threadId) {
        this.forgetThread(threadId);
      }
      return;
    }
    this.routeNotification(message);
  }

  private settleResponse(message: Record<string, unknown>): void {
    const id = Number(message.id);
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    if (Object.prototype.hasOwnProperty.call(message, "error")) {
      const errorRecord = message.error && typeof message.error === "object"
        ? message.error as Record<string, unknown>
        : {};
      const detail = String(errorRecord.message || t("codex.appServerRequestFailed"));
      const error = isCodexActiveWriterMessage(detail)
        ? createCodexThreadError(CODEX_THREAD_WRITER_CONFLICT, `Codex 会话存在活动写入者，已停止自动重试。请等待原会话释放后再继续。原始错误：${detail}`)
        : Object.assign(new Error(detail), { code: errorRecord.code });
      void this.runtime.logError("codex-app-server-request-failed", {
        connectionId: this.id, pid: this.child?.pid ?? null, method: pending.method,
        requestId: id, code: error.code ?? null, rpcCode: errorRecord.code ?? null,
      });
      pending.reject(error);
      return;
    }
    if (pending.claimThreadFromResult) {
      const threadId = threadIdFromResult(message.result, Boolean(pending.expectedThreadId));
      if (pending.expectedThreadId && threadId !== pending.expectedThreadId) {
        pending.reject(new Error("Codex 恢复回执与原线程不一致，任务未启动。"));
        return;
      }
      if (threadId) {
        this.claimThread(threadId, pending.ownerId);
      }
    }
    pending.resolve(message.result);
  }

  public cancelServerRequests(ownerId: string): void {
    this.cancelInbound((request) => request.listener.id === ownerId);
  }

  private cancelInbound(matches: (request: InboundRequest) => boolean, reply = true): void {
    for (const request of this.inbound.values()) {
      if (!matches(request)) continue;
      this.inbound.delete(request.id);
      request.cancel();
      if (reply && !this.processExited) {
        this.replyServerRequest(request.id, this.cancelResolution(request.method));
      }
    }
  }

  private cancelResolution(method: string): JsonRpcResolution {
    return buildAppServerRequestResolution(method, "该 Codex 请求已取消或不受支持。");
  }

  private replyServerRequest(id: string | number, resolution: JsonRpcResolution): void {
    if (this.closed || this.processExited) {
      if (this.spec.ownedExecution) this.ownedTransportFailure ??= "owned-server-reply-after-process-exit";
      return;
    }
    try {
      this.send(resolution.error
        ? { jsonrpc: "2.0", id, error: resolution.error }
        : { jsonrpc: "2.0", id, result: resolution.result ?? {} });
    } catch {
      if (this.spec.ownedExecution) this.ownedTransportFailure ??= "owned-server-reply-failed";
      // A failed user request must not terminate the shared connection. Transport
      // exit/close handlers own connection shutdown; never log user answers.
      void this.runtime.logError("codex-server-request-reply-failed", { connectionId: this.id, requestId: id });
    }
  }

  private handleServerRequest(message: Record<string, unknown>, method: string): void {
    const id = message.id;
    if ((typeof id !== "string" && typeof id !== "number") || this.inbound.has(id)) return;
    const routing = extractRoutingThread(message);
    const listener = this.routeTarget(message)
      ?? (!routing.threadId && !routing.parentThreadId ? this.singleActiveListener() : null);
    if (!listener || !listener.isActive() || !INTERACTIVE_SERVER_REQUESTS.has(method) || this.processExited) {
      this.replyServerRequest(id, this.cancelResolution(method));
      return;
    }
    if (this.spec.ownedExecution && this.handlerTasks.size >= 64) {
      this.ownedTransportFailure ??= "owned-handler-capacity-exceeded";
      this.replyServerRequest(id, this.cancelResolution(method));
      return;
    }
    let cancel = (): void => undefined;
    const cancelled = new Promise<null>((resolve) => { cancel = () => resolve(null); });
    const request: InboundRequest = {
      id, method, threadId: routing.threadId ?? routing.parentThreadId,
      listener, operationToken: listener.getOperationToken?.(), cancel,
    };
    this.inbound.set(id, request);
    // Start only this potentially long user interaction outside the read loop.
    // Both success and rejection are consumed; a late answer is valid only for
    // this exact request, listener object, thread owner and operation identity.
    const handling = Promise.resolve().then(() => {
      if (this.inbound.get(id) !== request) return null;
      if (this.listeners.get(listener.id) !== listener || !listener.isActive()
        || listener.getOperationToken?.() !== request.operationToken
        || (request.threadId && this.threadOwners.get(request.threadId) !== listener.id)) return this.cancelResolution(method);
      this.handlingOwners.set(listener.id, (this.handlingOwners.get(listener.id) ?? 0) + 1);
      return Promise.resolve().then(() => listener.handleServerRequest(method, message.params)).finally(() => {
        const remaining = (this.handlingOwners.get(listener.id) ?? 1) - 1;
        if (remaining) this.handlingOwners.set(listener.id, remaining);
        else this.handlingOwners.delete(listener.id);
      });
    });
    if (this.spec.ownedExecution) {
      // Only exclusive drain needs strong references after cancellation. Shared
      // handlingOwners still guards release; race consumes late rejections.
      this.handlerTasks.add(handling);
      void handling.then(() => { this.handlerTasks.delete(handling); }, () => {
        this.handlerTasks.delete(handling);
        this.ownedTransportFailure ??= "owned-server-handler-rejected";
      });
    }
    // Cancellation releases the completion closure even if a UI handler never
    // settles. The losing handler promise has rejection handlers via race.
    const completion = Promise.race([handling, cancelled]).then((resolution) => {
      this.finishServerRequest(request, resolution);
    }, () => {
      void this.runtime.logError("codex-server-request-handler-failed", {
        connectionId: this.id, requestId: id, threadId: request.threadId, method,
      });
      this.finishServerRequest(request, this.cancelResolution(method));
    }).catch(() => {
      // Guard even unexpected errors in completion/logging from becoming an
      // unhandled rejection; remove only this request, never another session.
      if (this.inbound.get(id) === request) this.inbound.delete(id);
    });
    if (this.spec.ownedExecution) {
      this.handlerTasks.add(completion);
      void completion.finally(() => { this.handlerTasks.delete(completion); });
    }
  }

  private finishServerRequest(request: InboundRequest, resolution: JsonRpcResolution | null | undefined): void {
    if (this.inbound.get(request.id) !== request) return;
    this.inbound.delete(request.id);
    const { listener, threadId } = request;
    const valid = !this.closed && !this.processExited
      && this.listeners.get(listener.id) === listener && listener.isActive()
      && listener.getOperationToken?.() === request.operationToken
      && (!threadId || this.threadOwners.get(threadId) === listener.id);
    this.replyServerRequest(request.id, valid ? resolution ?? this.cancelResolution(request.method)
      : this.cancelResolution(request.method));
  }

  private routeNotification(message: Record<string, unknown>): void {
    const routing = extractRoutingThread(message);
    if (routing.parentThreadId && routing.threadId) {
      const parentOwner = this.threadOwners.get(routing.parentThreadId);
      if (parentOwner) {
        this.claimThread(routing.threadId, parentOwner);
        const listener = this.listeners.get(parentOwner);
        if (listener) this.deliverNotification(listener, message);
        return;
      }
    }
    if (routing.threadId) {
      const ownerId = this.threadOwners.get(routing.threadId);
      if (ownerId) {
        const listener = this.listeners.get(ownerId);
        if (listener) this.deliverNotification(listener, message);
        return;
      }
    }
    if (this.spec.ownedExecution && !routing.threadId && !routing.parentThreadId) {
      const owner = this.listeners.get(this.spec.exclusiveOwnerId!);
      if (owner) this.deliverNotification(owner, message);
      return;
    }
    if (!routing.threadId) {
      for (const listener of this.listeners.values()) {
        if (listener.isActive()) {
          this.deliverNotification(listener, message);
        }
      }
      return;
    }
    // Unknown explicit thread ids are not ownership evidence. Keep them
    // buffered until a load response or explicit parent/child link claims them.
    const queued = this.buffered.get(routing.threadId) ?? [];
    queued.push(message);
    if (this.spec.ownedExecution && queued.length > 40) {
      this.ownedTransportFailure ??= "owned-unrouted-messages-truncated";
    }
    this.buffered.set(routing.threadId, queued.slice(-40));
  }

  private deliverNotification(listener: CodexAppServerListener, message: Record<string, unknown>, buffered = false): void {
    const threadId = extractRoutingThread(message).threadId;
    listener.handleNotification(message, Object.freeze({
      connectionId: this.id, listener, sequence: ++this.notificationSequence, buffered,
      ownedThread: !!threadId && this.threadOwners.get(threadId) === listener.id
        && this.listeners.get(listener.id) === listener,
    }));
  }

  private routeTarget(message: Record<string, unknown>): CodexAppServerListener | null {
    const routing = extractRoutingThread(message);
    const ownerId = routing.threadId ? this.threadOwners.get(routing.threadId) : undefined;
    if (ownerId) {
      return this.listeners.get(ownerId) ?? null;
    }
    if (!routing.threadId && routing.parentThreadId) {
      const parentOwner = this.threadOwners.get(routing.parentThreadId);
      if (parentOwner) {
        return this.listeners.get(parentOwner) ?? null;
      }
    }
    return null;
  }

  private singleActiveListener(): CodexAppServerListener | null {
    const active = Array.from(this.listeners.values()).filter((listener) => listener.isActive());
    return active.length === 1 ? active[0] ?? null : null;
  }

  private requestInternal<T>(
    ownerId: string,
    method: string,
    params: Record<string, unknown>,
    claimThreadFromResult: boolean,
    expectedThreadId?: string,
    commit?: () => void,
    onSent?: () => void,
  ): Promise<T> {
    const id = this.nextRequestId++;
    const message = { jsonrpc: "2.0", id, method, params };
    const prepared = commit ? serializeCodexAppServerMessage(message) : undefined;
    commit?.();
    return new Promise<T>((resolve, reject) => {
      if (this.closed || !this.child) {
        reject(this.spawnError ?? new Error(t("codex.appServerStdinUnavailable")));
        return;
      }
      if (method === "thread/resume") {
        this.threadLoadGenerations.set(String(params.threadId || "").trim(), this.nextThreadLoadGeneration++);
      }
      this.pending.set(id, {
        ownerId,
        method,
        loadingThreadId: method === "thread/resume" ? String(params.threadId || "").trim() : undefined,
        claimThreadFromResult,
        expectedThreadId,
        resolve: (value) => resolve(value as T),
        reject,
      });
      try {
        if (prepared === undefined) this.send(message);
        else this.sendSerialized(prepared);
        onSent?.();
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(message: Record<string, unknown>): void {
    this.sendSerialized(serializeCodexAppServerMessage(message));
  }

  private sendSerialized(message: string): void {
    if (!this.child?.stdin || !this.child.stdin.writable || this.closed) {
      throw new Error(t("codex.appServerStdinUnavailable"));
    }
    this.child.stdin.write(message);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function threadIdFromResult(result: unknown, requireString = false): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const thread = (result as Record<string, unknown>).thread;
  if (!thread || typeof thread !== "object") {
    return null;
  }
  const id = (thread as Record<string, unknown>).id;
  const threadId = requireString && typeof id !== "string" ? "" : String(id || "").trim();
  return threadId || null;
}

function extractRoutingThread(message: Record<string, unknown>): { threadId: string | null; parentThreadId: string | null } {
  const params = message.params && typeof message.params === "object"
    ? message.params as Record<string, unknown>
    : {};
  const nested = params.thread && typeof params.thread === "object"
    ? params.thread as Record<string, unknown>
    : null;
  const direct = String(params.threadId || params.thread_id || params.conversationId || nested?.id || "").trim();
  const parent = String(
    params.parentThreadId
    || params.parent_thread_id
    || nested?.parentThreadId
    || nested?.parent_thread_id
    || "",
  ).trim();
  return {
    threadId: direct || null,
    parentThreadId: parent || null,
  };
}
