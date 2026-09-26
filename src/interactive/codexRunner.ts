import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { t } from "../i18n";
import { logError, logInfo } from "../logger";
import {
  extractCodexRawResponseToolCall,
  extractCodexSubagentLifecycleUpdates,
  extractCodexWaitTimeoutPayload,
  isCodexFinalAnswerPhase,
  isCodexContextCompactionCompletedNotification,
  isCodexSubagentThreadEvent,
  shouldSettleCodexPrimaryTurn,
  type CodexSubagentUpdate,
} from "./codexAppServerEvents";
import {
  buildAppServerRequestResolution,
  buildForwardedRawEvent,
  buildTurnFailureMessage,
  type JsonRpcResolution,
} from "./codexAppServerProtocol";
import {
  extractCodexThreadTokenUsage,
  type CodexTokenUsageUpdate,
} from "./codexTokenUsage";
import { detectCodexRateLimitErrorMessage } from "./codexErrorClassifier";
import {
  buildCodexChildEnv,
  buildCodexWorkspaceTrustConfigOverride,
  ensureCodexProjectTrusted,
  resolveCodexModelProvider,
  resolveCodexProjectPath,
} from "./codexRuntimeConfig";
import {
  buildCodexAppServerArgs,
  buildCodexAppServerInitializeParams,
  buildCodexThreadOptions,
  buildCodexThreadParams,
  buildCodexTurnStartParams,
  collectArgValues,
  createCodexTurnAssistantObserver,
  createCodexAbortError,
  createCodexRunnerDisposedError,
  emitCodexVisibleErrorTrace,
  emitCodexTodoListUpdate,
  handleCodexItemEvent,
  handleCodexReasoningNotification,
  type CodexAssistantDeltaMeta as CodexRuntimeAssistantDeltaMeta,
  type CodexReasoningBufferState,
  type CodexRuntimeTraceKind,
  type CodexRuntimeTraceMeta,
} from "./codexRunnerRuntime";
import { resolveSpawnCommand } from "./codexRunnerProcess";
import {
  acquireCodexAppServer,
  buildCodexAppServerConnectionKey,
  type CodexAppServerCloseInfo,
  type CodexAppServerConnection,
  type CodexAppServerListener,
} from "./codexAppServerPool";

export type CodexTraceKind = CodexRuntimeTraceKind;

export type CodexTraceMeta = CodexRuntimeTraceMeta;

export type CodexAssistantDeltaMeta = CodexRuntimeAssistantDeltaMeta;

export type CodexAppServerRequest = {
  method: string;
  params?: unknown;
};

export type CodexPrimaryTurnCompleted = {
  threadId: string;
  turnId: string;
  status: "completed";
};

export type CodexStreamHandlers = {
  onAssistantDelta: (chunk: string, meta?: CodexAssistantDeltaMeta) => void;
  onSubagentUpdate?: (update: CodexSubagentUpdate) => void;
  onTrace: (content: string, kind?: CodexTraceKind, meta?: CodexTraceMeta) => void;
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
  onThreadId: (threadId: string) => void;
  onTurnCompleted?: (completion: CodexPrimaryTurnCompleted) => void;
  onTokenUsageUpdate?: (update: CodexTokenUsageUpdate) => void;
  onEvent?: (event: unknown) => void;
  onRequest?: (request: CodexAppServerRequest) => Promise<JsonRpcResolution | null | undefined> | JsonRpcResolution | null | undefined;
  requestUserInputEnabled?: boolean;
};

type CodexCompactionResult = {
  compacted: boolean;
  threadId: string;
};

const createAbortError = createCodexAbortError;
const createRunnerDisposedError = (): Error => createCodexRunnerDisposedError(t("run.disposedExternally"));
let nextRunnerListenerId = 1;

function normalizeCodexSpawnError(error: Error, command: string): Error {
  const errnoError = error as NodeJS.ErrnoException;
  if (errnoError.code !== "EAGAIN") {
    return error;
  }
  const wrapped = new Error(t("codex.appServerSpawnResourceUnavailable", {
    command,
    error: error.message,
  })) as NodeJS.ErrnoException;
  wrapped.code = errnoError.code;
  wrapped.errno = errnoError.errno;
  wrapped.path = errnoError.path;
  wrapped.syscall = errnoError.syscall;
  return wrapped;
}

function emitPrimaryTokenUsageUpdate(
  params: Record<string, unknown>,
  handlers: CodexStreamHandlers,
  primaryThreadId?: string | null,
): void {
  const eventThreadId = String(params.threadId || params.thread_id || "").trim();
  if (isCodexSubagentThreadEvent(eventThreadId, primaryThreadId)) {
    return;
  }
  const usage = extractCodexThreadTokenUsage(params);
  if (!usage) {
    return;
  }
  handlers.onTokenUsageUpdate?.({
    tokensInContextWindow: usage.tokensInContextWindow,
    modelContextWindow: usage.modelContextWindow,
    threadId: usage.threadId || eventThreadId,
  });
}


type CodexRunnerMutableOptions = {
  command: string;
  args: string[];
  cwd?: string;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model?: string | null;
  threadId: string | null;
  multiAgentEnabled: boolean;
};

type CodexRunnerOperation = {
  kind: "turn" | "compact";
  handlers: CodexStreamHandlers;
  abortGeneration: number;
  disposeGeneration: number;
  assistantBuffers: Map<string, string>;
  reasoningBuffers: Map<string, CodexReasoningBufferState>;
  emittedTraceContents: Map<string, string>;
  rawResponseToolNames: Map<string, string>;
  observer: ReturnType<typeof createCodexTurnAssistantObserver> | null;
  activeTurnId: string;
  settled: boolean;
  threadCompacted: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  done: Promise<void>;
};

export class CodexInteractiveRunner {
  public readonly cli: CliName = "codex";
  private readonly listenerId = `codex-runner-${nextRunnerListenerId++}`;
  private readonly listener: CodexAppServerListener;
  private options: CodexRunnerMutableOptions;
  private connection: CodexAppServerConnection | null = null;
  private activeConnectionId: number | null = null;
  private operationTail: Promise<unknown> = Promise.resolve();
  private activeOperation: CodexRunnerOperation | null = null;
  private abortGeneration = 0;
  private disposeGeneration = 0;
  private disposed = false;

  public constructor(options: CodexRunnerMutableOptions) {
    this.options = { ...options, args: [...options.args] };
    this.listener = {
      id: this.listenerId,
      isActive: () => this.activeOperation !== null,
      handleNotification: (message) => this.handleNotification(message),
      handleServerRequest: (method, params) => this.handleServerRequest(method, params),
      onClosed: (info) => this.handleConnectionClosed(info),
    };
  }

  public getThreadId(): string | null {
    return this.options.threadId ?? null;
  }

  public updateOptions(options: CodexRunnerMutableOptions): void {
    this.options = {
      ...this.options,
      ...options,
      args: [...options.args],
      threadId: options.threadId || this.options.threadId,
    };
  }

  public async ensureReady(): Promise<void> {
    if (this.disposed) {
      throw createRunnerDisposedError();
    }
  }

  public rebuild(): void {
  }

  public stopAndRebuild(): void {
    this.abortGeneration += 1;
    const threadId = String(this.options.threadId || "").trim();
    const hot = Boolean(
      threadId
      && this.connection?.isAlive()
      && this.connection.hasLoadedThread(threadId),
    );
    if (hot && this.connection) {
      void this.connection.request(this.listenerId, "turn/interrupt", {
        threadId,
        turnId: this.activeOperation?.activeTurnId || "",
      }).catch(() => undefined);
      this.settleActive(createAbortError());
      return;
    }
    this.settleActive(createAbortError());
    this.connection?.rejectOwner(this.listenerId, createAbortError());
    if (this.connection && this.connection.retainerCount() <= 1) {
      const connection = this.connection;
      this.connection = null;
      this.activeConnectionId = null;
      connection.shutdown("terminate");
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.disposeGeneration += 1;
    this.settleActive(createRunnerDisposedError());
    const connection = this.connection;
    this.connection = null;
    this.activeConnectionId = null;
    connection?.release(this.listenerId);
  }

  public async runForText(prompt: string): Promise<{ threadId: string | null; text: string }> {
    const chunks: string[] = [];
    const handlers: CodexStreamHandlers = {
      onAssistantDelta: (chunk) => chunks.push(chunk),
      onTrace: () => {},
      onTaskListUpdate: () => {},
      onThreadId: () => {},
    };
    await this.runStreamed(prompt, handlers);
    return { threadId: this.getThreadId(), text: chunks.join("") };
  }

  public async compactThread(): Promise<CodexCompactionResult> {
    const abortGeneration = this.abortGeneration;
    const disposeGeneration = this.disposeGeneration;
    return this.enqueue(async () => {
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      return this.compactThreadOnce(abortGeneration, disposeGeneration);
    });
  }

  public async runStreamed(prompt: string, handlers: CodexStreamHandlers): Promise<void> {
    await this.ensureReady();
    const abortGeneration = this.abortGeneration;
    const disposeGeneration = this.disposeGeneration;
    await this.enqueue(async () => {
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      await this.runStreamedOnce(prompt, handlers, abortGeneration, disposeGeneration);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation);
    this.operationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async compactThreadOnce(
    abortGeneration: number,
    disposeGeneration: number,
  ): Promise<CodexCompactionResult> {
    const existingThreadId = String(this.options.threadId || "").trim();
    if (!existingThreadId) {
      throw new Error("Codex thread not established");
    }
    const handlers: CodexStreamHandlers = {
      onAssistantDelta: () => {},
      onTrace: () => {},
      onTaskListUpdate: () => {},
      onThreadId: () => {},
    };
    const operation = this.beginOperation("compact", handlers, abortGeneration, disposeGeneration);
    try {
      const opened = await this.openConnection(handlers, false, true);
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      await this.ensureThreadLoaded(opened.connection, opened.threadOptions);
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      await opened.connection.request(this.listenerId, "thread/compact/start", {
        threadId: this.options.threadId,
      });
      await operation.done;
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      return {
        compacted: operation.threadCompacted,
        threadId: String(this.options.threadId || existingThreadId),
      };
    } catch (error) {
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      throw error;
    } finally {
      if (this.activeOperation === operation) {
        this.activeOperation = null;
      }
    }
  }

  private async runStreamedOnce(
    prompt: string,
    handlers: CodexStreamHandlers,
    abortGeneration: number,
    disposeGeneration: number,
  ): Promise<void> {
    const operation = this.beginOperation("turn", handlers, abortGeneration, disposeGeneration);
    try {
      const opened = await this.openConnection(handlers, handlers.requestUserInputEnabled === true, false);
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      await this.ensureThreadLoaded(opened.connection, opened.threadOptions);
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      const turnResult = await opened.connection.request<Record<string, unknown>>(
        this.listenerId,
        "turn/start",
        buildCodexTurnStartParams(
          this.options.threadId,
          prompt,
          opened.imagePaths,
          opened.threadOptions,
        ),
      );
      const startedTurn = turnResult?.turn && typeof turnResult.turn === "object"
        ? turnResult.turn as Record<string, unknown>
        : {};
      operation.activeTurnId = String(startedTurn.id || "").trim();
      handlers.onEvent?.({ type: "turn.started" });
      await operation.done;
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
    } catch (error) {
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      throw error;
    } finally {
      if (this.activeOperation === operation) {
        this.activeOperation = null;
      }
    }
  }

  private async openConnection(
    handlers: CodexStreamHandlers | undefined,
    requestUserInputEnabled: boolean,
    reuseLoadedThread: boolean,
  ): Promise<{
    connection: CodexAppServerConnection;
    threadOptions: ReturnType<typeof buildCodexThreadOptions>;
    imagePaths: string[];
  }> {
    const threadOptions = buildCodexThreadOptions(
      this.options.args,
      this.options.cwd,
      this.options.thinkingMode,
      this.options.interactiveMode,
      this.options.model,
      this.options.multiAgentEnabled,
    );
    const imagePaths = collectArgValues(this.options.args, ["--image", "-i"])
      .map((item) => item.trim())
      .filter(Boolean);
    let resolvedWorkspaceDir = threadOptions.workingDirectory;
    const configOverrides: string[] = [];
    const childEnvResult = buildCodexChildEnv(process.env);
    threadOptions.modelProvider = (await resolveCodexModelProvider(childEnvResult.codexHomeDir)) ?? undefined;
    const loadedThreadId = String(this.options.threadId || "").trim();
    if (
      reuseLoadedThread
      && loadedThreadId
      && this.connection?.isAlive()
      && this.connection.hasLoadedThread(loadedThreadId)
    ) {
      return { connection: this.connection, threadOptions, imagePaths };
    }
    if (resolvedWorkspaceDir) {
      resolvedWorkspaceDir = await resolveCodexProjectPath(resolvedWorkspaceDir);
      threadOptions.workingDirectory = resolvedWorkspaceDir;
      configOverrides.push(buildCodexWorkspaceTrustConfigOverride(resolvedWorkspaceDir));
      try {
        const trustResult = await ensureCodexProjectTrusted({
          projectRoot: resolvedWorkspaceDir,
          codexHomeDir: childEnvResult.codexHomeDir,
        });
        handlers?.onEvent?.({
          type: "codex.lifecycle",
          event: "project_trust_ready",
          status: trustResult.status,
          projectRoot: trustResult.projectRoot,
          configPath: trustResult.configPath,
        });
      } catch (error) {
        handlers?.onEvent?.({
          type: "codex.lifecycle",
          event: "project_trust_failed",
          projectRoot: resolvedWorkspaceDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const spawnCommand = resolveSpawnCommand(
      this.options.command,
      buildCodexAppServerArgs(threadOptions.multiAgentEnabled !== false, configOverrides, {
        requestUserInputEnabled,
      }),
    );
    const cwd = resolvedWorkspaceDir ?? this.options.cwd;
    const key = buildCodexAppServerConnectionKey({
      command: spawnCommand.command,
      args: spawnCommand.args,
      cwd,
      codexHomeDir: childEnvResult.codexHomeDir,
      modelProvider: threadOptions.modelProvider ?? null,
    });
    if (this.connection && (!this.connection.isAlive() || this.connection.key !== key)) {
      const previous = this.connection;
      this.connection = null;
      this.activeConnectionId = null;
      previous.release(this.listenerId);
    }
    if (!this.connection) {
      this.connection = acquireCodexAppServer({
        key,
        command: spawnCommand.command,
        args: spawnCommand.args,
        cwd,
        env: childEnvResult.env,
        codexHomeDir: childEnvResult.codexHomeDir,
        initializeParams: buildCodexAppServerInitializeParams(spawnCommand.command, {
          requestUserInputEnabled,
        }),
      }, this.listener);
      this.activeConnectionId = this.connection.id;
    }
    const connection = this.connection;
    if (connection.takeFresh()) {
      void logInfo("codex-app-server-spawn-runner", {
        command: spawnCommand.command,
        args: spawnCommand.args,
        cwd: cwd ?? null,
        usesShell: spawnCommand.usesShell,
        resolvedFrom: spawnCommand.resolvedFrom,
        codexHomeDir: childEnvResult.codexHomeDir,
        removedEnvKeys: childEnvResult.removedEnvKeys,
        threadId: this.options.threadId,
      });
      handlers?.onEvent?.({
        type: "codex.lifecycle",
        event: "spawn_prepare",
        command: spawnCommand.command,
        args: spawnCommand.args,
        cwd: cwd ?? null,
        usesShell: spawnCommand.usesShell,
        resolvedFrom: spawnCommand.resolvedFrom,
        codexHomeDir: childEnvResult.codexHomeDir,
        removedEnvKeys: childEnvResult.removedEnvKeys,
      });
    }
    try {
      await connection.whenReady();
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      const normalized = normalizeCodexSpawnError(cause, spawnCommand.command);
      void logError("codex-app-server-ready-error", {
        command: spawnCommand.command,
        code: (cause as NodeJS.ErrnoException).code ?? null,
        error: normalized.message,
      });
      handlers?.onEvent?.({
        type: "codex.lifecycle",
        event: "spawn_error",
        command: spawnCommand.command,
        code: (cause as NodeJS.ErrnoException).code ?? null,
        error: normalized.message,
      });
      throw normalized;
    }
    return { connection, threadOptions, imagePaths };
  }

  private async ensureThreadLoaded(
    connection: CodexAppServerConnection,
    threadOptions: ReturnType<typeof buildCodexThreadOptions>,
  ): Promise<void> {
    const threadId = String(this.options.threadId || "").trim();
    if (threadId && connection.hasLoadedThread(threadId)) {
      connection.claimThread(threadId, this.listenerId);
      void logInfo("codex-app-server-thread-reused", { threadId });
      return;
    }
    const threadParams = buildCodexThreadParams(threadOptions);
    const threadResult = threadId
      ? await connection.request<Record<string, unknown>>(this.listenerId, "thread/resume", {
        threadId,
        ...threadParams,
      })
      : await connection.request<Record<string, unknown>>(this.listenerId, "thread/start", threadParams);
    const thread = threadResult?.thread && typeof threadResult.thread === "object"
      ? threadResult.thread as Record<string, unknown>
      : null;
    this.updateThreadId(thread?.id, true);
    const loadedThreadId = String(this.options.threadId || threadId).trim();
    if (loadedThreadId) {
      connection.claimThread(loadedThreadId, this.listenerId);
    }
  }

  private beginOperation(
    kind: CodexRunnerOperation["kind"],
    handlers: CodexStreamHandlers,
    abortGeneration: number,
    disposeGeneration: number,
  ): CodexRunnerOperation {
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const done = new Promise<void>((resolveDone, rejectDone) => {
      resolve = resolveDone;
      reject = rejectDone;
    });
    void done.catch(() => undefined);
    const operation: CodexRunnerOperation = {
      kind,
      handlers,
      abortGeneration,
      disposeGeneration,
      assistantBuffers: new Map<string, string>(),
      reasoningBuffers: new Map<string, CodexReasoningBufferState>(),
      emittedTraceContents: new Map<string, string>(),
      rawResponseToolNames: new Map<string, string>(),
      observer: kind === "turn" ? createCodexTurnAssistantObserver(handlers.onAssistantDelta) : null,
      activeTurnId: "",
      settled: false,
      threadCompacted: false,
      resolve,
      reject,
      done,
    };
    this.activeOperation = operation;
    return operation;
  }

  private settleActive(error?: Error): void {
    const operation = this.activeOperation;
    if (!operation || operation.settled) {
      return;
    }
    operation.settled = true;
    if (error) {
      operation.reject(error);
      return;
    }
    operation.resolve();
  }

  private throwIfSuperseded(abortGeneration: number, disposeGeneration: number): void {
    if (this.disposeGeneration !== disposeGeneration || this.disposed) {
      throw createRunnerDisposedError();
    }
    if (this.abortGeneration !== abortGeneration) {
      throw createAbortError();
    }
  }

  private updateThreadId(threadId: unknown, allowReplace = false): void {
    const normalized = String(threadId || "").trim();
    if (!normalized || this.options.threadId === normalized) {
      return;
    }
    if (this.options.threadId && !allowReplace) {
      return;
    }
    this.options.threadId = normalized;
    this.activeOperation?.handlers.onThreadId(normalized);
  }

  private handleConnectionClosed(info: CodexAppServerCloseInfo): void {
    if (info.connectionId !== this.activeConnectionId) {
      return;
    }
    this.connection = null;
    this.activeConnectionId = null;
    if (!this.activeOperation || this.activeOperation.settled) {
      return;
    }
    if (this.disposeGeneration !== this.activeOperation.disposeGeneration || this.disposed) {
      this.settleActive(createRunnerDisposedError());
      return;
    }
    if (this.abortGeneration !== this.activeOperation.abortGeneration) {
      this.settleActive(createAbortError());
      return;
    }
    const spawnError = info.spawnError ? normalizeCodexSpawnError(info.spawnError, this.options.command) : null;
    this.settleActive(spawnError ?? new Error(t("codex.appServerExited", {
      detail: info.signal ? `signal ${info.signal}` : `code ${info.code ?? 1}`,
      stderr: info.stderr || "-",
    })));
  }

  private handleServerRequest(
    method: string,
    params: unknown,
  ): Promise<JsonRpcResolution | null | undefined> | JsonRpcResolution | null | undefined {
    const operation = this.activeOperation;
    this.forwardEvent({ method, params });
    if (!operation || operation.kind !== "turn") {
      return buildAppServerRequestResolution(
        method,
        t("codex.appServerUnsupportedRequest", { method: method || "unknown" }),
      );
    }
    return operation.handlers.onRequest?.({ method, params })
      ?? buildAppServerRequestResolution(
        method,
        t("codex.appServerUnsupportedRequest", { method: method || "unknown" }),
      );
  }

  private forwardEvent(message: Record<string, unknown>): void {
    const operation = this.activeOperation;
    if (!operation) {
      return;
    }
    const forwarded = buildForwardedRawEvent(message);
    if (forwarded) {
      operation.handlers.onEvent?.(forwarded);
    }
  }

  private failVisible(message: string): void {
    const normalized = message.trim();
    if (!normalized) {
      return;
    }
    const operation = this.activeOperation;
    if (operation) {
      emitCodexVisibleErrorTrace(operation.handlers.onTrace, normalized);
    }
    this.settleActive(new Error(normalized));
  }

  private claimItemThreads(rawItem: unknown): void {
    if (!this.connection) {
      return;
    }
    for (const update of extractCodexSubagentLifecycleUpdates(rawItem)) {
      if (update.threadId) {
        this.connection.claimThread(update.threadId, this.listenerId);
      }
    }
    const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : null;
    const receivers = item?.receiverThreadIds ?? item?.receiver_thread_ids;
    if (!Array.isArray(receivers)) {
      return;
    }
    for (const value of receivers) {
      const threadId = String(value || "").trim();
      if (threadId) {
        this.connection.claimThread(threadId, this.listenerId);
      }
    }
  }

  private handleNotification(message: Record<string, unknown>): void {
    const operation = this.activeOperation;
    if (!operation) {
      return;
    }
    this.forwardEvent(message);
    const method = String(message.method || "").trim();
    if (operation.kind === "compact" && isCodexContextCompactionCompletedNotification(message, this.options.threadId ?? undefined)) {
      operation.threadCompacted = true;
      this.settleActive();
      return;
    }
    if (!method) {
      return;
    }
    if (method === "thread/started") {
      const thread = message.params && typeof message.params === "object"
        ? (message.params as Record<string, unknown>).thread
        : null;
      const startedThreadId = thread && typeof thread === "object"
        ? (thread as Record<string, unknown>).id
        : undefined;
      const normalizedStartedThreadId = String(startedThreadId || "").trim();
      if (
        normalizedStartedThreadId
        && this.options.threadId
        && normalizedStartedThreadId !== this.options.threadId
      ) {
        operation.handlers.onSubagentUpdate?.({
          threadId: normalizedStartedThreadId,
          status: "running",
        });
      } else {
        this.updateThreadId(normalizedStartedThreadId);
      }
      return;
    }
    if (
      method === "item/reasoning/summaryTextDelta"
      || method === "item/reasoning/textDelta"
      || method === "item/reasoning/summaryPartAdded"
    ) {
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      if (!operation.observer) {
        return;
      }
      handleCodexReasoningNotification({
        method,
        params,
        primaryThreadId: this.options.threadId ?? undefined,
        reasoningBuffers: operation.reasoningBuffers,
        handlers: {
          onAssistantDelta: operation.observer.emit,
          onSubagentUpdate: operation.handlers.onSubagentUpdate,
          onTrace: operation.handlers.onTrace,
          onTaskListUpdate: operation.handlers.onTaskListUpdate,
        },
      });
      return;
    }
    if (method === "item/agentMessage/delta") {
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      const eventThreadId = String(params.threadId || "").trim();
      const itemId = String(params.itemId || "").trim();
      const delta = String(params.delta || "");
      const isSubagentDelta = isCodexSubagentThreadEvent(eventThreadId, this.options.threadId);
      const bufferKey = isSubagentDelta && itemId ? `${eventThreadId}:${itemId}` : itemId;
      if (bufferKey) {
        operation.assistantBuffers.set(bufferKey, `${operation.assistantBuffers.get(bufferKey) ?? ""}${delta}`);
      }
      if (delta && operation.observer) {
        if (isSubagentDelta) {
          operation.handlers.onSubagentUpdate?.({
            threadId: eventThreadId,
            status: "running",
            delta,
          });
        } else {
          operation.observer.emit(
            delta,
            isCodexFinalAnswerPhase(params.phase) ? { codexFinalAnswer: true } : undefined,
          );
          if (Object.prototype.hasOwnProperty.call(params, "phase")) {
            operation.observer.observeAgentMessagePhase(params.phase);
          }
        }
      }
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      emitPrimaryTokenUsageUpdate(params, operation.handlers, this.options.threadId);
      return;
    }
    if (method === "turn/plan/updated") {
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      const eventThreadId = String(params.threadId || "").trim();
      if (!eventThreadId || !this.options.threadId || eventThreadId === this.options.threadId) {
        emitCodexTodoListUpdate(Array.isArray(params.plan) ? params.plan : [], operation.handlers.onTaskListUpdate);
      } else {
        operation.handlers.onSubagentUpdate?.({ threadId: eventThreadId, status: "running" });
      }
      return;
    }
    if (method === "rawResponseItem/completed") {
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      const eventThreadId = String(params.threadId || "").trim();
      if (isCodexSubagentThreadEvent(eventThreadId, this.options.threadId)) {
        operation.handlers.onSubagentUpdate?.({ threadId: eventThreadId, status: "running" });
        return;
      }
      const rawItem = params.item;
      const toolCall = extractCodexRawResponseToolCall(rawItem);
      if (toolCall) {
        operation.rawResponseToolNames.set(toolCall.callId, toolCall.toolName);
        return;
      }
      const outputRecord = rawItem && typeof rawItem === "object"
        ? rawItem as Record<string, unknown>
        : {};
      const callId = String(outputRecord.call_id || "").trim();
      const toolName = callId ? (operation.rawResponseToolNames.get(callId) ?? "") : "";
      const waitTimeout = extractCodexWaitTimeoutPayload(rawItem, toolName);
      if (waitTimeout) {
        if (callId) {
          operation.rawResponseToolNames.delete(callId);
        }
        this.failVisible(t("codex.collabWaitTimedOut", { detail: waitTimeout.detail }));
        return;
      }
      if (callId) {
        operation.rawResponseToolNames.delete(callId);
      }
      return;
    }
    if (method === "turn/completed") {
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      const eventThreadId = String(params.threadId || "").trim();
      const turn = params.turn && typeof params.turn === "object"
        ? params.turn as Record<string, unknown>
        : {};
      const completedTurnId = String(turn.id || "").trim();
      const turnStatus = String(turn.status || "").trim();
      const isSubagentTurn = isCodexSubagentThreadEvent(eventThreadId, this.options.threadId);
      if (!isSubagentTurn) {
        emitPrimaryTokenUsageUpdate(params, operation.handlers, this.options.threadId);
      }
      if (isSubagentTurn) {
        const error = turnStatus === "failed"
          ? buildTurnFailureMessage(params, t("codex.appServerTaskFailed"))
          : "";
        operation.handlers.onSubagentUpdate?.({
          threadId: eventThreadId,
          status: turnStatus === "failed"
            ? "failed"
            : turnStatus === "interrupted"
              ? "interrupted"
              : "completed",
          ...(error ? { error } : {}),
        });
        return;
      }
      if (!shouldSettleCodexPrimaryTurn({
        eventThreadId,
        eventTurnId: completedTurnId,
        primaryThreadId: this.options.threadId,
        activeTurnId: operation.activeTurnId,
      })) {
        return;
      }
      if (turnStatus === "failed") {
        this.settleActive(new Error(buildTurnFailureMessage(params, t("codex.appServerTaskFailed"))));
        return;
      }
      if (turnStatus === "completed") {
        operation.observer?.promoteUnspecifiedFinalOnCompletedTurn();
        operation.handlers.onTurnCompleted?.({
          threadId: eventThreadId || this.options.threadId || "",
          turnId: completedTurnId,
          status: "completed",
        });
      }
      this.settleActive();
      return;
    }
    if (method === "error") {
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      const eventThreadId = String(params.threadId || "").trim();
      const structuredError = params.error && typeof params.error === "object"
        ? params.error as Record<string, unknown>
        : {};
      const warning = String(
        params.message
        || structuredError.message
        || structuredError.additionalDetails
        || "",
      ).trim();
      if (isCodexSubagentThreadEvent(eventThreadId, this.options.threadId)) {
        operation.handlers.onSubagentUpdate?.({
          threadId: eventThreadId,
          status: params.willRetry === true ? "running" : "failed",
          ...(warning ? { error: warning } : {}),
        });
        return;
      }
      if (operation.kind === "compact") {
        const rateLimitMessage = detectCodexRateLimitErrorMessage(params);
        if (rateLimitMessage) {
          this.settleActive(new Error(rateLimitMessage));
          return;
        }
        if (warning) {
          this.settleActive(new Error(warning));
        }
        return;
      }
      const rateLimitMessage = detectCodexRateLimitErrorMessage(params);
      if (rateLimitMessage) {
        this.failVisible(rateLimitMessage);
        return;
      }
      if (warning) {
        const lower = warning.toLowerCase();
        if (lower.startsWith("reconnecting") || lower.startsWith("retrying")) {
          operation.handlers.onTrace(`warning ${warning}`);
        } else {
          emitCodexVisibleErrorTrace(operation.handlers.onTrace, warning);
        }
      }
      return;
    }
    if (method === "account/rateLimits/updated" || method === "account/updated") {
      return;
    }
    if (method === "item/started" || method === "item/completed") {
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      this.claimItemThreads(params.item);
      if (!operation.observer && operation.kind === "turn") {
        return;
      }
      handleCodexItemEvent({
        eventType: method === "item/started" ? "item.started" : "item.completed",
        rawItem: params.item,
        threadId: String(params.threadId || "").trim(),
        primaryThreadId: this.options.threadId ?? undefined,
        assistantBuffers: operation.assistantBuffers,
        reasoningBuffers: operation.reasoningBuffers,
        emittedTraceContents: operation.emittedTraceContents,
        handlers: {
          onAssistantDelta: operation.observer
            ? operation.observer.emit
            : () => undefined,
          onSubagentUpdate: operation.handlers.onSubagentUpdate,
          onTrace: operation.handlers.onTrace,
          onTaskListUpdate: operation.handlers.onTaskListUpdate,
          onPrimaryAgentMessageCompleted: operation.observer
            ? operation.observer.observeAgentMessagePhase
            : undefined,
          onPrimaryToolActivity: operation.observer
            ? operation.observer.observeToolActivity
            : undefined,
        },
        onVisibleError: (messageText) => this.failVisible(messageText),
        formatCollabToolFailure: (failure) => t("codex.collabToolFailed", {
          tool: failure.tool,
          detail: failure.detail,
        }),
      });
    }
  }
}
