import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { t } from "../i18n";
import { logError, logInfo } from "../logger";
import {
  extractCodexRawResponseToolCall,
  extractCodexSubagentLifecycleUpdates,
  extractCodexWaitTimeoutPayload,
  extractCodexEventTurnId,
  isCodexFinalAnswerPhase,
  isCodexFinalAnswerAgentMessage,
  normalizeCodexExecItemType,
  isCodexContextCompactionCompletedNotification,
  isCodexSubagentThreadEvent,
  shouldSettleObservedCodexPrimaryTurn,
  type CodexSubagentUpdate,
} from "./codexAppServerEvents";
import {
  buildAppServerRequestResolution,
  buildForwardedRawEvent,
  extractCodexAgentMessageText,
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
  isCodexPrimaryToolItemType,
  type CodexAssistantDeltaMeta as CodexRuntimeAssistantDeltaMeta,
  type CodexReasoningBufferState,
  type CodexRuntimeTraceKind,
  type CodexRuntimeTraceMeta,
} from "./codexRunnerRuntime";
import { resolveSpawnCommand } from "./codexRunnerProcess";
import { resolveCodexThreadUnloadCapability } from "./codexAppServerCapabilities";
import {
  acquireCodexAppServer,
  buildCodexAppServerConnectionKey,
  type CodexAppServerCloseInfo,
  type CodexAppServerConnection,
  type CodexAppServerListener,
} from "./codexAppServerPool";
import { containsFinalAnswerTextMarker, FINAL_ANSWER_TEXT_MARKER } from "../finalAnswerProtocol";

const CODEX_FINAL_MESSAGE_COMPLETION_GRACE_MS = 1_000;

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
  env?: NodeJS.ProcessEnv;
  readOnly?: boolean;
  configFingerprint?: string;
  command: string;
  args: string[];
  cwd?: string;
  thinkingMode: ThinkingMode;
  interactiveMode: InteractiveMode;
  model?: string | null;
  threadId: string | null;
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
  observedPrimaryTurnIds: Set<string>;
  sawPrimaryAssistantOutput: boolean;
  settled: boolean;
  threadCompacted: boolean;
  finalAnswerItemId?: string;
  finalAnswerCompletionTimer?: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (error: Error) => void;
  done: Promise<void>;
};

type CodexNotificationHandler = (
  operation: CodexRunnerOperation,
  params: Record<string, unknown>,
  method: string,
) => void;

export class CodexInteractiveRunner {
  public readonly cli: CliName = "codex";
  private readonly listenerId = `codex-runner-${nextRunnerListenerId++}`;
  private readonly listener: CodexAppServerListener;
  private options: CodexRunnerMutableOptions;
  private connection: CodexAppServerConnection | null = null;
  private connectionRequestUserInputEnabled = false;
  private activeConnectionId: number | null = null;
  private operationTail: Promise<unknown> = Promise.resolve();
  private activeOperation: CodexRunnerOperation | null = null;
  private abortGeneration = 0;
  private disposeGeneration = 0;
  private disposed = false;
  private readonly supersededTurnIds = new Set<string>();
  private readonly notificationHandlers: ReadonlyMap<string, CodexNotificationHandler>;

  public constructor(options: CodexRunnerMutableOptions) {
    this.options = { ...options, args: [...options.args] };
    this.notificationHandlers = new Map<string, CodexNotificationHandler>([
      ["turn/started", this.handleTurnStarted.bind(this)],
      ["thread/started", this.handleThreadStarted.bind(this)],
      ["item/reasoning/summaryTextDelta", this.handleReasoningNotification.bind(this)],
      ["item/reasoning/textDelta", this.handleReasoningNotification.bind(this)],
      ["item/reasoning/summaryPartAdded", this.handleReasoningNotification.bind(this)],
      ["item/agentMessage/delta", this.handleAgentMessageDelta.bind(this)],
      ["thread/tokenUsage/updated", this.handleTokenUsageUpdate.bind(this)],
      ["turn/plan/updated", this.handlePlanUpdated.bind(this)],
      ["rawResponseItem/completed", this.handleRawResponseItemCompleted.bind(this)],
      ["turn/completed", this.handleTurnCompleted.bind(this)],
      ["error", this.handleErrorNotification.bind(this)],
      ["account/rateLimits/updated", this.ignoreNotification.bind(this)],
      ["account/updated", this.ignoreNotification.bind(this)],
      ["item/started", this.handleItemEvent.bind(this)],
      ["item/completed", this.handleItemEvent.bind(this)],
    ]);
    this.listener = {
      id: this.listenerId,
      isActive: () => this.activeOperation !== null && !this.activeOperation.settled,
      getOperationToken: () => this.activeOperation,
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
      configFingerprint: options.configFingerprint ?? this.options.configFingerprint,
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
    this.captureSupersededTurns();
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
    const abortGeneration = this.abortGeneration;
    const disposeGeneration = this.disposeGeneration;
    await this.ensureReady();
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
      const opened = await this.openConnection(handlers, false, true, operation);
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      return await opened.connection.withThread(this.listenerId, existingThreadId, async () => {
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
      }, { checkActive: () => this.throwIfSuperseded(abortGeneration, disposeGeneration) });
    } catch (error) {
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      throw error;
    } finally {
      if (this.activeOperation === operation) {
        this.connection?.cancelServerRequests(this.listenerId);
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
      const opened = await this.openConnection(handlers, handlers.requestUserInputEnabled === true, false, operation);
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      await opened.connection.withThread(this.listenerId, this.options.threadId, async () => {
        await this.ensureThreadLoaded(opened.connection, opened.threadOptions);
        this.throwIfSuperseded(abortGeneration, disposeGeneration);
        const turnStartPromise = opened.connection.request<Record<string, unknown>>(
          this.listenerId,
          "turn/start",
          buildCodexTurnStartParams(
            this.options.threadId,
            prompt,
            opened.imagePaths,
            opened.threadOptions,
          ),
        );
        const turnStartResult = await Promise.race([
          turnStartPromise.then((result) => ({ settledBeforeStart: false, result })),
          operation.done.then(() => ({ settledBeforeStart: true, result: null })),
        ]);
        if (turnStartResult.settledBeforeStart) {
          void turnStartPromise.then(() => undefined, () => undefined);
        } else {
          const startedTurn = turnStartResult.result?.turn && typeof turnStartResult.result.turn === "object"
            ? turnStartResult.result.turn as Record<string, unknown>
            : {};
          this.adoptStartedTurnId(operation, String(startedTurn.id || "").trim());
          handlers.onEvent?.({ type: "turn.started" });
          await operation.done;
        }
        this.throwIfSuperseded(abortGeneration, disposeGeneration);
      }, { checkActive: () => this.throwIfSuperseded(abortGeneration, disposeGeneration) });
    } catch (error) {
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      throw error;
    } finally {
      if (this.activeOperation === operation) {
        this.connection?.cancelServerRequests(this.listenerId);
        this.activeOperation = null;
      }
    }
  }

  private async openConnection(
    handlers: CodexStreamHandlers | undefined,
    requestUserInputEnabled: boolean,
    reuseLoadedThread: boolean,
    operation: CodexRunnerOperation,
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
    );
    if (this.options.readOnly) {
      threadOptions.approvalPolicy = "never";
      threadOptions.sandboxMode = "read-only";
      threadOptions.additionalDirectories = [];
      threadOptions.webSearchEnabled = false;
      threadOptions.webSearchMode = "disabled";
      threadOptions.networkAccessEnabled = false;
    }
    const imagePaths = collectArgValues(this.options.args, ["--image", "-i"])
      .map((item) => item.trim())
      .filter(Boolean);
    let resolvedWorkspaceDir = threadOptions.workingDirectory;
    const configOverrides: string[] = [];
    const childEnvResult = buildCodexChildEnv(this.options.env ?? process.env);
    threadOptions.modelProvider = (await resolveCodexModelProvider(childEnvResult.codexHomeDir)) ?? undefined;
    if (reuseLoadedThread && this.connection?.isAlive()) {
      requestUserInputEnabled = this.connectionRequestUserInputEnabled;
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
    const checkActive = (): void => {
      this.throwIfSuperseded(operation.abortGeneration, operation.disposeGeneration);
      if (this.activeOperation !== operation || operation.settled) { throw createAbortError(); }
    };
    checkActive();
    const cwd = resolvedWorkspaceDir ?? this.options.cwd;
    const spawnCommand = resolveSpawnCommand(
      this.options.command,
      buildCodexAppServerArgs(configOverrides, {
        requestUserInputEnabled,
      }),
    );
    // This runner only acquires plugin-owned app-servers. Probe the resolved target,
    // not a bare command that could resolve differently in the child's environment.
    // A login shell's eventual executable identity is unknown: keep compatible args.
    if (!spawnCommand.usesShell) {
      const capability = await resolveCodexThreadUnloadCapability({
        command: spawnCommand.command, cwd, env: childEnvResult.env,
      });
      // stop/dispose may settle the operation while the bounded probe is in flight.
      checkActive();
      if (capability.supported === true && capability.reason === "supported") {
        spawnCommand.args = buildCodexAppServerArgs(configOverrides, {
          requestUserInputEnabled, immediateThreadUnload: true,
        });
      }
    }
    const key = buildCodexAppServerConnectionKey({
      command: spawnCommand.command,
      args: spawnCommand.args,
      cwd,
      codexHomeDir: childEnvResult.codexHomeDir,
      modelProvider: threadOptions.modelProvider ?? null,
      configFingerprint: this.options.configFingerprint,
    });
    if (this.connection && (!this.connection.isAlive() || this.connection.key !== key)) {
      const previous = this.connection;
      const before = JSON.parse(previous.key) as Record<string, unknown>;
      const after = JSON.parse(key) as Record<string, unknown>;
      void logInfo("codex-app-server-connection-switch", {
        connectionId: previous.id,
        threadId: this.options.threadId,
        listeners: previous.retainerCount(),
        changedFields: Object.keys(after).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])),
      });
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
      this.connectionRequestUserInputEnabled = requestUserInputEnabled;
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
      void logInfo("codex-app-server-thread-reused", { connectionId: connection.id, threadId });
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
      observedPrimaryTurnIds: new Set<string>(),
      sawPrimaryAssistantOutput: false,
      settled: false,
      threadCompacted: false,
      resolve,
      reject,
      done,
    };
    this.connection?.cancelServerRequests(this.listenerId);
    this.activeOperation = operation;
    return operation;
  }

  private captureSupersededTurns(): void {
    const operation = this.activeOperation;
    if (!operation || operation.kind !== "turn") {
      return;
    }
    this.rememberSupersededTurn(operation.activeTurnId);
    for (const turnId of operation.observedPrimaryTurnIds) {
      this.rememberSupersededTurn(turnId);
    }
  }

  private rememberSupersededTurn(turnId: unknown): void {
    const normalized = String(turnId || "").trim();
    if (normalized) {
      this.supersededTurnIds.add(normalized);
    }
  }

  private isSupersededTurn(turnId: unknown): boolean {
    const normalized = String(turnId || "").trim();
    return Boolean(normalized) && this.supersededTurnIds.has(normalized);
  }

  private notePrimaryTurnId(params: Record<string, unknown>): void {
    const operation = this.activeOperation;
    if (!operation || operation.kind !== "turn") {
      return;
    }
    const eventThreadId = String(params.threadId || params.thread_id || "").trim();
    if (isCodexSubagentThreadEvent(eventThreadId, this.options.threadId)) {
      return;
    }
    const turnId = extractCodexEventTurnId(params);
    if (!turnId || this.isSupersededTurn(turnId)) {
      return;
    }
    operation.observedPrimaryTurnIds.add(turnId);
  }

  private adoptStartedTurnId(operation: CodexRunnerOperation, turnId: string): void {
    if (!turnId) {
      return;
    }
    if (!operation.activeTurnId || !operation.observedPrimaryTurnIds.has(operation.activeTurnId)) {
      if (
        operation.observedPrimaryTurnIds.size === 0
        || operation.observedPrimaryTurnIds.has(turnId)
      ) {
        operation.activeTurnId = turnId;
      }
    }
  }

  private settleActive(error?: Error): void {
    const operation = this.activeOperation;
    if (!operation || operation.settled) {
      return;
    }
    this.connection?.cancelServerRequests(this.listenerId);
    operation.settled = true;
    if (operation.finalAnswerCompletionTimer) {
      clearTimeout(operation.finalAnswerCompletionTimer);
      operation.finalAnswerCompletionTimer = undefined;
    }
    if (error) {
      operation.reject(error);
      return;
    }
    operation.resolve();
  }

  private scheduleFinalAnswerCompletion(
    operation: CodexRunnerOperation,
    threadId: string,
    turnId: string,
    completionSource = "item/completed",
  ): void {
    if (!threadId || !turnId || operation.settled) {
      return;
    }
    if (operation.finalAnswerCompletionTimer) {
      clearTimeout(operation.finalAnswerCompletionTimer);
    }
    operation.finalAnswerCompletionTimer = setTimeout(() => {
      if (this.activeOperation !== operation || operation.settled) {
        return;
      }
      logInfo("codex-final-answer-completion-fallback", { threadId, turnId, completionSource });
      this.captureSupersededTurns();
      this.settleActive();
      if (this.connection) {
        void this.connection.request(this.listenerId, "turn/interrupt", { threadId, turnId })
          .catch(() => undefined);
      }
    }, CODEX_FINAL_MESSAGE_COMPLETION_GRACE_MS);
  }

  private observeFinalAnswerBoundary(
    operation: CodexRunnerOperation,
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (operation.kind !== "turn" || operation.finalAnswerCompletionTimer || !operation.finalAnswerItemId) {
      return;
    }
    const threadId = String(params.threadId || params.thread_id || this.options.threadId || "").trim();
    if (isCodexSubagentThreadEvent(threadId, this.options.threadId)) {
      return;
    }
    const turnId = extractCodexEventTurnId(params) || operation.activeTurnId;
    if (this.isSupersededTurn(turnId)) {
      return;
    }
    const text = operation.assistantBuffers.get(operation.finalAnswerItemId) || "";
    if (!text.replace(FINAL_ANSWER_TEXT_MARKER, "").trim()) {
      return;
    }
    const item = params.item && typeof params.item === "object"
      ? params.item as Record<string, unknown>
      : {};
    const itemType = normalizeCodexExecItemType(item.type);
    const itemId = String(params.itemId || item.id || "").trim();
    const nextAgentMessage = (
      (method === "item/agentMessage/delta" && Boolean(params.delta))
      || (method === "item/started" && itemType === "agent_message")
      || (method === "item/completed" && itemType === "agent_message"
        && Boolean(extractCodexAgentMessageText(item).trim()))
    ) && Boolean(itemId) && itemId !== operation.finalAnswerItemId;
    const nextActivity = method.startsWith("item/reasoning/")
      || method.endsWith("/requestApproval")
      || method === "item/tool/call"
      || ((method === "item/started" || method === "item/completed")
        && (itemType === "reasoning" || isCodexPrimaryToolItemType(itemType)));
    const error = params.error && typeof params.error === "object"
      ? params.error as Record<string, unknown>
      : {};
    const retryMessage = String(params.message || error.message || error.additionalDetails || "").trim();
    const reconnectAfterAnswer = method === "error"
      && /^(?:reconnecting|retrying)\b/i.test(retryMessage);
    if (nextAgentMessage || nextActivity || reconnectAfterAnswer) {
      this.scheduleFinalAnswerCompletion(operation, threadId, turnId, method);
    }
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
    const requestParams = params && typeof params === "object" ? params as Record<string, unknown> : {};
    const eventThreadId = String(requestParams.threadId || requestParams.thread_id || requestParams.conversationId || "").trim();
    if (!isCodexSubagentThreadEvent(eventThreadId, this.options.threadId)
      && this.isSupersededTurn(extractCodexEventTurnId(requestParams))) {
      return buildAppServerRequestResolution(method, "该 Codex 请求所属操作已停止。");
    }
    if (operation && !operation.settled) {
      this.observeFinalAnswerBoundary(operation, method, params && typeof params === "object"
        ? params as Record<string, unknown>
        : {});
    }
    if (!operation || operation.settled || operation.finalAnswerCompletionTimer || operation.kind !== "turn") {
      return buildAppServerRequestResolution(
        method,
        t("codex.appServerUnsupportedRequest", { method: method || "unknown" }),
      );
    }
    this.forwardEvent({ method, params });
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
    if (!operation || operation.settled) {
      return;
    }
    const method = String(message.method || "").trim();
    const params = message.params && typeof message.params === "object"
      ? message.params as Record<string, unknown>
      : {};
    const eventThreadId = String(params.threadId || params.thread_id || "").trim();
    if (
      !isCodexSubagentThreadEvent(eventThreadId, this.options.threadId)
      && this.isSupersededTurn(extractCodexEventTurnId(params))
    ) {
      return;
    }
    this.observeFinalAnswerBoundary(operation, method, params);
    if (
      operation.finalAnswerCompletionTimer
      && method !== "turn/completed"
      && method !== "thread/tokenUsage/updated"
    ) {
      return;
    }
    this.forwardEvent(message);
    if (operation.kind === "compact" && isCodexContextCompactionCompletedNotification(message, this.options.threadId ?? undefined)) {
      operation.threadCompacted = true;
      this.settleActive();
      return;
    }
    if (!method) {
      return;
    }
    if (method !== "turn/completed" && message.params && typeof message.params === "object") {
      this.notePrimaryTurnId(message.params as Record<string, unknown>);
    }
    this.notificationHandlers.get(method)?.(operation, params, method);
  }

  private handleTurnStarted(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
  ): void {
    const eventThreadId = String(params.threadId || params.thread_id || "").trim();
    const startedTurnId = extractCodexEventTurnId(params);
    if (
      startedTurnId
      && !this.isSupersededTurn(startedTurnId)
      && !isCodexSubagentThreadEvent(eventThreadId, this.options.threadId)
    ) {
      this.adoptStartedTurnId(operation, startedTurnId);
    }
  }

  private handleThreadStarted(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
  ): void {
    const thread = params.thread;
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
  }

  private handleReasoningNotification(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
    method: string,
  ): void {
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
  }

  private handleAgentMessageDelta(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
  ): void {
    const eventThreadId = String(params.threadId || "").trim();
    const eventTurnId = extractCodexEventTurnId(params);
    if (!isCodexSubagentThreadEvent(eventThreadId, this.options.threadId) && this.isSupersededTurn(eventTurnId)) {
      return;
    }
    const itemId = String(params.itemId || "").trim();
    const delta = String(params.delta || "");
    const isSubagentDelta = isCodexSubagentThreadEvent(eventThreadId, this.options.threadId);
    if (!isSubagentDelta && delta.trim()) {
      operation.sawPrimaryAssistantOutput = true;
    }
    const bufferKey = isSubagentDelta && itemId ? `${eventThreadId}:${itemId}` : itemId;
    if (bufferKey) {
      operation.assistantBuffers.set(bufferKey, `${operation.assistantBuffers.get(bufferKey) ?? ""}${delta}`);
      if (!isSubagentDelta && (isCodexFinalAnswerPhase(params.phase)
        || containsFinalAnswerTextMarker(operation.assistantBuffers.get(bufferKey)))) {
        operation.finalAnswerItemId = itemId;
      }
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
          {
            ...(itemId ? { assistantItemId: itemId } : {}),
            ...(isCodexFinalAnswerPhase(params.phase) ? { codexFinalAnswer: true } : {}),
          },
        );
        if (Object.prototype.hasOwnProperty.call(params, "phase")) {
          operation.observer.observeAgentMessagePhase(params.phase);
        }
      }
    }
  }

  private handleTokenUsageUpdate(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
  ): void {
    emitPrimaryTokenUsageUpdate(params, operation.handlers, this.options.threadId);
  }

  private handlePlanUpdated(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
  ): void {
    const eventThreadId = String(params.threadId || "").trim();
    if (!eventThreadId || !this.options.threadId || eventThreadId === this.options.threadId) {
      emitCodexTodoListUpdate(Array.isArray(params.plan) ? params.plan : [], operation.handlers.onTaskListUpdate);
    } else {
      operation.handlers.onSubagentUpdate?.({ threadId: eventThreadId, status: "running" });
    }
  }

  private handleRawResponseItemCompleted(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
  ): void {
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
  }

  private handleTurnCompleted(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
  ): void {
    const eventThreadId = String(params.threadId || "").trim();
    const turn = params.turn && typeof params.turn === "object"
      ? params.turn as Record<string, unknown>
      : {};
    const completedTurnId = extractCodexEventTurnId(params);
    const turnStatus = String(turn.status || "").trim();
    const isSubagentTurn = isCodexSubagentThreadEvent(eventThreadId, this.options.threadId);
    if (!isSubagentTurn && this.isSupersededTurn(completedTurnId)) {
      return;
    }
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
    const activeTurnWasStreamed = Boolean(
      operation.activeTurnId
      && operation.observedPrimaryTurnIds.has(operation.activeTurnId),
    );
    const settleUnlabeledPrimaryCompletion = Boolean(
      completedTurnId
      && operation.sawPrimaryAssistantOutput
      && operation.observedPrimaryTurnIds.size === 0
      && operation.activeTurnId
      && operation.activeTurnId !== completedTurnId
      && !activeTurnWasStreamed
    );
    if (!settleUnlabeledPrimaryCompletion && !shouldSettleObservedCodexPrimaryTurn({
      eventThreadId,
      eventTurnId: completedTurnId,
      primaryThreadId: this.options.threadId,
      activeTurnId: operation.activeTurnId,
      observedPrimaryTurnIds: operation.observedPrimaryTurnIds,
    })) {
      return;
    }
    if (completedTurnId) {
      operation.observedPrimaryTurnIds.add(completedTurnId);
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
  }

  private handleErrorNotification(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
  ): void {
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
  }

  private ignoreNotification(): void {}

  private handleItemEvent(
    operation: CodexRunnerOperation,
    params: Record<string, unknown>,
    method: string,
  ): void {
    this.claimItemThreads(params.item);
    if (this.isSupersededTurn(extractCodexEventTurnId(params))) {
      return;
    }
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
    const item = params.item && typeof params.item === "object"
      ? params.item as Record<string, unknown>
      : null;
    const finalText = extractCodexAgentMessageText(item);
    if (
      operation.kind === "turn"
      && !operation.settled
      && method === "item/completed"
      && !isCodexSubagentThreadEvent(String(params.threadId || ""), this.options.threadId)
      && item
      && normalizeCodexExecItemType(item.type) === "agent_message"
      && finalText.replace(FINAL_ANSWER_TEXT_MARKER, "").trim()
      && (isCodexFinalAnswerAgentMessage(item) || containsFinalAnswerTextMarker(finalText))
    ) {
      this.scheduleFinalAnswerCompletion(
        operation,
        String(params.threadId || this.options.threadId || "").trim(),
        extractCodexEventTurnId(params) || operation.activeTurnId,
      );
    }
  }
}
