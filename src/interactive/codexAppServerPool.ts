import type { ChildProcess } from "child_process";
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
import { requestChildShutdown } from "./codexRunnerProcess";

const CODEX_APP_SERVER_PROCESS_LABEL = "sinitek-ai-vscode-cli-codex-app-server";

export type CodexAppServerConnectionSpec = {
  key: string;
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
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  claimThreadFromResult: boolean;
};

const connections = new Map<string, CodexAppServerConnection>();
let nextConnectionId = 1;

export function buildCodexAppServerConnectionKey(input: {
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
  private readonly pending = new Map<number, PendingRequest>();
  private readonly buffered = new Map<string, Record<string, unknown>[]>();
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
    this.listeners.set(listener.id, listener);
    this.ensureStarted();
  }

  public release(listenerId: string): void {
    this.detachListener(listenerId);
    if (this.listeners.size === 0) {
      this.shutdown("terminate");
    }
  }

  public claimThread(threadId: string, listenerId: string): void {
    const normalized = String(threadId || "").trim();
    const listener = this.listeners.get(listenerId);
    if (!normalized || !listener) {
      return;
    }
    this.threadOwners.set(normalized, listenerId);
    this.loadedThreads.add(normalized);
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
    for (const [id, pending] of this.pending.entries()) {
      if (pending.ownerId !== ownerId) {
        continue;
      }
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  public shutdown(mode: "graceful" | "terminate"): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    connections.delete(this.key);
    const error = this.spawnError ?? new Error(t("codex.appServerExited", {
      detail: this.exitSignal ? `signal ${this.exitSignal}` : `code ${this.exitCode ?? 1}`,
      stderr: Buffer.concat(this.stderrChunks).toString("utf8") || "-",
    }));
    this.rejectAll(error);
    this.readyReject?.(error);
    this.readyReject = null;
    if (this.child) {
      requestChildShutdown(this.child, mode);
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
    this.buffered.clear();
  }

  private detachListener(listenerId: string): void {
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
    void logInfo("codex-app-server-spawn", {
      command: this.spec.command,
      args: this.spec.args,
      cwd: this.spec.cwd ?? null,
      codexHomeDir: this.spec.codexHomeDir,
      key: this.key,
    });
    let child: ChildProcess;
    try {
      child = spawn(this.spec.command, this.spec.args, {
        cwd: this.spec.cwd,
        env: this.spec.env,
        argv0: CODEX_APP_SERVER_PROCESS_LABEL,
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
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      this.spawnError = error;
      void logError("codex-app-server-spawn-error", {
        command: this.spec.command,
        code: (error as NodeJS.ErrnoException).code ?? null,
        pid: child.pid ?? null,
        error: error.message,
      });
      this.failStart(error);
    });
    child.once("close", (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
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
      await this.handleServerRequest(message, method);
      return;
    }
    if (!method) {
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
      pending.reject(new Error(String(errorRecord.message || t("codex.appServerRequestFailed"))));
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

  private async handleServerRequest(message: Record<string, unknown>, method: string): Promise<void> {
    const routed = this.routeTarget(message);
    const listener = routed ?? this.singleActiveListener();
    let resolution: JsonRpcResolution | null | undefined;
    try {
      resolution = listener
        ? await listener.handleServerRequest(method, message.params)
        : null;
    } catch (error) {
      resolution = {
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    const fallback = buildAppServerRequestResolution(
      method,
      t("codex.appServerUnsupportedRequest", { method: method || "unknown" }),
    );
    const resolved = resolution ?? fallback;
    try {
      this.send(resolved.error
        ? { jsonrpc: "2.0", id: message.id, error: resolved.error }
        : { jsonrpc: "2.0", id: message.id, result: resolved.result ?? {} });
    } catch (error) {
      this.shutdown("terminate");
    }
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
    if (routing.parentThreadId) {
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
      this.pending.set(id, {
        ownerId,
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
  const direct = String(params.threadId || params.thread_id || nested?.id || "").trim();
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

