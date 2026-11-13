import type { ChildProcess } from "child_process";
import * as path from "path";
import { spawn } from "cross-spawn";
import { t } from "../i18n";
import { logError, logInfo } from "../logger";
import {
  createCodexAppServerNdjsonReader,
  serializeCodexAppServerMessage,
  type CodexAppServerNdjsonReader,
} from "./codexAppServerNdjson";
import {
  buildAppServerRequestResolution,
  type JsonRpcResolution,
} from "./codexAppServerProtocol";
import { resolveChildArgv0 } from "../cli/processArgv";
import { requestChildShutdown } from "./codexRunnerProcess";
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
  handleNotification: (message: Record<string, unknown>) => void;
  handleServerRequest: (
    method: string,
    params: unknown,
  ) => Promise<JsonRpcResolution | null | undefined> | JsonRpcResolution | null | undefined;
  onClosed: (info: CodexAppServerCloseInfo) => void;
};

export type CodexAppServerCloseInfo = {
  connectionId: number;
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
): CodexAppServerConnection {
  const existing = connections.get(spec.key);
  if (existing && existing.isAlive()) {
    existing.retain(listener);
    return existing;
  }
  if (existing) {
    existing.shutdown("terminate");
    connections.delete(spec.key);
  }
  const connection = new CodexAppServerConnection(spec);
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
  public readonly id = nextConnectionId++;
  public readonly key: string;
  private readonly listeners = new Map<string, CodexAppServerListener>();
  private readonly threadOwners = new Map<string, string>();
  private readonly loadedThreads = new Set<string>();
  private readonly threadLoadGenerations = new Map<string, number>();
  private nextThreadLoadGeneration = 1;
  private readonly inbound = new Map<string | number, InboundRequest>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly buffered = new Map<string, Record<string, unknown>[]>();
  private readonly activeOwners = new Set<string>();
  private readonly homeScope: string;
  private processExited = false;
  private child: ChildProcess | null = null;
  private reader: CodexAppServerNdjsonReader | null = null;
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

  public constructor(private readonly spec: CodexAppServerConnectionSpec) {
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
    return !this.closed && this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  public hasLoadedThread(threadId: string | null | undefined): boolean {
    const normalized = String(threadId || "").trim();
    return Boolean(normalized) && this.loadedThreads.has(normalized);
  }

  public retainerCount(): number {
    return this.listeners.size;
  }

  public retain(listener: CodexAppServerListener): void {
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
    this.detachListener(listenerId);
    if (this.listeners.size === 0) {
      this.shutdown("terminate");
    }
  }

  public async withThread<T>(
    ownerId: string,
    threadId: string | null,
    operation: () => Promise<T>,
    options: CodexThreadHandoffOptions = {},
  ): Promise<T> {
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
            void logInfo("codex-thread-handoff-start", { fromConnectionId: previous.id, toConnectionId: this.id, threadId });
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
    const deadline = Date.now() + (options.timeoutMs ?? CODEX_THREAD_HANDOFF_TIMEOUT_MS);
    const ownerId = `handoff-${this.id}-${threadId}`;
    let requestError: Error | null = null;
    let invalidResponse = false;
    let requestInFlight = false;
    let nextQueryAt = 0;
    let finished = false;
    void logInfo("codex-thread-handoff-wait", {
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
      void logInfo("codex-thread-handoff-released", { connectionId: this.id, pid: this.child?.pid ?? null, threadId });
    } catch (error) {
      void logError("codex-thread-handoff-failed", {
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
    void logInfo("codex-app-server-process-exited", {
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
      listener.handleNotification(message);
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
  ): Promise<T> {
    await this.whenReady();
    return this.requestInternal<T>(ownerId, method, params, method === "thread/start" || method === "thread/resume");
  }

  public notify(method: string, params?: Record<string, unknown>): void {
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
      requestChildShutdown(this.child, mode);
    } else if (!this.child) {
      this.markProcessExited();
    }
    this.reader?.close();
    const info: CodexAppServerCloseInfo = {
      connectionId: this.id,
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
    void logInfo("codex-app-server-spawn", { connectionId: this.id });
    let child: ChildProcess;
    try {
      child = spawn(this.spec.command, this.spec.args, {
        cwd: this.spec.cwd,
        env: this.spec.env,
        argv0: resolveChildArgv0(this.spec.command, CODEX_APP_SERVER_PROCESS_LABEL),
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      const spawnError = error instanceof Error ? error : new Error(String(error));
      this.spawnError = spawnError;
      this.failStart(spawnError);
      return;
    }
    this.child = child;
    void logInfo("codex-app-server-started", { connectionId: this.id, pid: child.pid ?? null });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      this.spawnError = error;
      if (!child.pid) {
        this.markProcessExited();
      }
      void logError("codex-app-server-spawn-error", {
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
        this.shutdown("terminate");
      }
    });
    if (!child.stdout) {
      this.failStart(new Error(t("codex.appServerNoStdout")));
      return;
    }
    this.reader = createCodexAppServerNdjsonReader(child.stdout);
    void this.readLoop();
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
      this.routeTarget(message)?.handleNotification(message);
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
      void logError("codex-app-server-request-failed", {
        connectionId: this.id, pid: this.child?.pid ?? null, method: pending.method,
        requestId: id, code: error.code ?? null, rpcCode: errorRecord.code ?? null,
      });
      pending.reject(error);
      return;
    }
    if (pending.claimThreadFromResult) {
      const threadId = threadIdFromResult(message.result);
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
    if (this.closed || this.processExited) return;
    try {
      this.send(resolution.error
        ? { jsonrpc: "2.0", id, error: resolution.error }
        : { jsonrpc: "2.0", id, result: resolution.result ?? {} });
    } catch {
      // A failed user request must not terminate the shared connection. Transport
      // exit/close handlers own connection shutdown; never log user answers.
      void logError("codex-server-request-reply-failed", { connectionId: this.id, requestId: id });
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
      return listener.handleServerRequest(method, message.params);
    });
    // Cancellation releases the completion closure even if a UI handler never
    // settles. The losing handler promise has rejection handlers via race.
    void Promise.race([handling, cancelled]).then((resolution) => {
      this.finishServerRequest(request, resolution);
    }, () => {
      void logError("codex-server-request-handler-failed", {
        connectionId: this.id, requestId: id, threadId: request.threadId, method,
      });
      this.finishServerRequest(request, this.cancelResolution(method));
    }).catch(() => {
      // Guard even unexpected errors in completion/logging from becoming an
      // unhandled rejection; remove only this request, never another session.
      if (this.inbound.get(id) === request) this.inbound.delete(id);
    });
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
        this.listeners.get(parentOwner)?.handleNotification(message);
        return;
      }
    }
    if (routing.threadId) {
      const ownerId = this.threadOwners.get(routing.threadId);
      if (ownerId) {
        this.listeners.get(ownerId)?.handleNotification(message);
        return;
      }
    }
    const active = this.singleActiveListener();
    if (active) {
      if (routing.threadId) {
        this.claimThread(routing.threadId, active.id);
      }
      active.handleNotification(message);
      return;
    }
    if (!routing.threadId) {
      for (const listener of this.listeners.values()) {
        if (listener.isActive()) {
          listener.handleNotification(message);
        }
      }
      return;
    }
    const queued = this.buffered.get(routing.threadId) ?? [];
    queued.push(message);
    this.buffered.set(routing.threadId, queued.slice(-40));
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
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed || !this.child) {
        reject(this.spawnError ?? new Error(t("codex.appServerStdinUnavailable")));
        return;
      }
      const id = this.nextRequestId;
      this.nextRequestId += 1;
      if (method === "thread/resume") {
        this.threadLoadGenerations.set(String(params.threadId || "").trim(), this.nextThreadLoadGeneration++);
      }
      this.pending.set(id, {
        ownerId,
        method,
        loadingThreadId: method === "thread/resume" ? String(params.threadId || "").trim() : undefined,
        claimThreadFromResult,
        resolve: (value) => resolve(value as T),
        reject,
      });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.child?.stdin || !this.child.stdin.writable || this.closed) {
      throw new Error(t("codex.appServerStdinUnavailable"));
    }
    this.child.stdin.write(serializeCodexAppServerMessage(message));
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function threadIdFromResult(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const thread = (result as Record<string, unknown>).thread;
  if (!thread || typeof thread !== "object") {
    return null;
  }
  const threadId = String((thread as Record<string, unknown>).id || "").trim();
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
