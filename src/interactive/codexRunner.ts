import type { ChildProcess } from "child_process";
import { spawn } from "cross-spawn";
import * as readline from "readline";
import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { t } from "../i18n";
import { logError, logInfo } from "../logger";
import {
  extractCodexRawResponseToolCall,
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
  type CodexRuntimeTraceKind,
  type CodexRuntimeTraceMeta,
} from "./codexRunnerRuntime";
import {
  requestChildShutdown,
  resolveSpawnCommand,
} from "./codexRunnerProcess";

export type CodexTraceKind = CodexRuntimeTraceKind;

export type CodexTraceMeta = CodexRuntimeTraceMeta;

export type CodexAssistantDeltaMeta = {
  codexFinalAnswer?: boolean;
};

export type CodexAppServerRequest = {
  method: string;
  params?: unknown;
};

export type CodexStreamHandlers = {
  onAssistantDelta: (chunk: string, meta?: CodexAssistantDeltaMeta) => void;
  onSubagentUpdate?: (update: CodexSubagentUpdate) => void;
  onTrace: (content: string, kind?: CodexTraceKind, meta?: CodexTraceMeta) => void;
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
  onThreadId: (threadId: string) => void;
  onEvent?: (event: unknown) => void;
  onRequest?: (request: CodexAppServerRequest) => Promise<JsonRpcResolution | null | undefined> | JsonRpcResolution | null | undefined;
};

type JsonRpcPendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type AppServerResponse = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type CodexCompactionResult = {
  compacted: boolean;
  threadId: string;
};

const createAbortError = createCodexAbortError;
const createRunnerDisposedError = (): Error => createCodexRunnerDisposedError(t("run.disposedExternally"));
const CODEX_APP_SERVER_PROCESS_LABEL = "sinitek-ai-vscode-cli-codex-app-server";

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

export class CodexInteractiveRunner {
  public readonly cli: CliName = "codex";
  private readonly activeChildren = new Set<ChildProcess>();
  private abortGeneration = 0;
  private disposeGeneration = 0;
  private disposed = false;

  public constructor(
    private readonly options: {
      command: string;
      args: string[];
      cwd?: string;
      thinkingMode: ThinkingMode;
      interactiveMode: InteractiveMode;
      model?: string | null;
      threadId: string | null;
      multiAgentEnabled: boolean;
    }
  ) {}

  public getThreadId(): string | null {
    return this.options.threadId ?? null;
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
    for (const child of Array.from(this.activeChildren)) {
      requestChildShutdown(child, "terminate");
    }
    this.rebuild();
  }

  private trackActiveChild(child: ChildProcess): void {
    this.activeChildren.add(child);
  }

  private releaseActiveChild(child: ChildProcess): void {
    this.activeChildren.delete(child);
  }

  public dispose(): void {
    this.disposed = true;
    this.disposeGeneration += 1;
    this.stopAndRebuild();
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
    await this.ensureReady();
    const existingThreadId = String(this.options.threadId || "").trim();
    if (!existingThreadId) {
      throw new Error("Codex thread not established");
    }

    const runGeneration = this.abortGeneration;
    const runDisposeGeneration = this.disposeGeneration;
    const threadOptions = buildCodexThreadOptions(
      this.options.args,
      this.options.cwd,
      this.options.thinkingMode,
      this.options.interactiveMode,
      this.options.model,
      this.options.multiAgentEnabled
    );
    let resolvedWorkspaceDir = threadOptions.workingDirectory;
    const configOverrides: string[] = [];
    const childEnvResult = buildCodexChildEnv(process.env);
    threadOptions.modelProvider = (await resolveCodexModelProvider(childEnvResult.codexHomeDir)) ?? undefined;

    if (resolvedWorkspaceDir) {
      resolvedWorkspaceDir = await resolveCodexProjectPath(resolvedWorkspaceDir);
      threadOptions.workingDirectory = resolvedWorkspaceDir;
      configOverrides.push(buildCodexWorkspaceTrustConfigOverride(resolvedWorkspaceDir));
      try {
        await ensureCodexProjectTrusted({
          projectRoot: resolvedWorkspaceDir,
          codexHomeDir: childEnvResult.codexHomeDir,
        });
      } catch {
        // compact should still attempt to proceed; trust failure will surface from app-server if required
      }
    }

    const spawnCommand = resolveSpawnCommand(
      this.options.command,
      buildCodexAppServerArgs(threadOptions.multiAgentEnabled !== false, configOverrides)
    );
    void logInfo("codex-app-server-compact-spawn", {
      command: spawnCommand.command,
      args: spawnCommand.args,
      cwd: resolvedWorkspaceDir ?? this.options.cwd ?? null,
      usesShell: spawnCommand.usesShell,
      resolvedFrom: spawnCommand.resolvedFrom,
      codexHomeDir: childEnvResult.codexHomeDir,
      removedEnvKeys: childEnvResult.removedEnvKeys,
      threadId: existingThreadId,
      interactiveMode: this.options.interactiveMode,
    });

    const child = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: resolvedWorkspaceDir ?? this.options.cwd,
      env: childEnvResult.env,
      argv0: CODEX_APP_SERVER_PROCESS_LABEL,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.trackActiveChild(child);

    let spawnError: Error | null = null;
    let streamError: Error | null = null;
    let stdoutParseError: Error | null = null;
    const stderrChunks: Buffer[] = [];
    let nextRequestId = 1;
    let settled = false;
    let childClosed = false;
    let exitSettled = false;
    let threadCompacted = false;
    const pendingRequests = new Map<number, JsonRpcPendingRequest>();
    let rl: readline.Interface | null = null;
    let completionResolve: ((value: CodexCompactionResult) => void) | null = null;
    let completionReject: ((error: Error) => void) | null = null;

    const completionPromise = new Promise<CodexCompactionResult>((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;
    });
    void completionPromise.catch(() => undefined);
    const exitPromise = new Promise<AppServerResponse>((resolve) => {
      const settleExit = (response: AppServerResponse): boolean => {
        if (exitSettled) {
          return false;
        }
        exitSettled = true;
        childClosed = true;
        resolve(response);
        return true;
      };
      child.once("close", (code, signal) => {
        if (!settleExit({ code, signal })) {
          return;
        }
        if (!settled) {
          const error = this.disposeGeneration !== runDisposeGeneration
            ? createRunnerDisposedError()
            : this.abortGeneration !== runGeneration
              ? createAbortError()
              : new Error(
                t("codex.appServerExited", {
                  detail: signal ? `signal ${signal}` : `code ${code ?? 1}`,
                  stderr: Buffer.concat(stderrChunks).toString("utf8") || "-",
                })
              );
          settleFailure(error);
        }
      });
      child.once("error", (error) => {
        const normalizedError = normalizeCodexSpawnError(error, spawnCommand.command);
        spawnError = normalizedError;
        void logError("codex-app-server-compact-spawn-error", {
          command: spawnCommand.command,
          code: (error as NodeJS.ErrnoException).code ?? null,
          pid: child.pid ?? null,
          activeChildren: this.activeChildren.size,
          error: error.message,
        });
        rl?.close();
        settleExit({ code: null, signal: null });
        failRun(normalizedError);
      });
    });

    const settleSuccess = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      completionResolve?.({
        compacted: threadCompacted,
        threadId: existingThreadId,
      });
    };

    const settleFailure = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      completionReject?.(error);
    };

    const rejectPendingRequests = (error: Error): void => {
      for (const pending of pendingRequests.values()) {
        pending.reject(error);
      }
      pendingRequests.clear();
    };

    const failRun = (error: Error): void => {
      if (!streamError) {
        streamError = error;
      }
      rejectPendingRequests(error);
      settleFailure(error);
    };

    const shutdownChild = (mode: "graceful" | "terminate"): void => {
      if (childClosed) {
        return;
      }
      requestChildShutdown(child, mode);
    };

    const sendJsonRpcMessage = (message: Record<string, unknown>): void => {
      if (!child.stdin || !child.stdin.writable) {
        throw new Error(t("codex.appServerStdinUnavailable"));
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const request = <T = unknown>(method: string, params: Record<string, unknown>): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const id = nextRequestId;
        nextRequestId += 1;
        pendingRequests.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
        });
        try {
          sendJsonRpcMessage({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
          pendingRequests.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };

    const notify = (method: string, params?: Record<string, unknown>): void => {
      const message: Record<string, unknown> = {
        jsonrpc: "2.0",
        method,
      };
      if (params && Object.keys(params).length > 0) {
        message.params = params;
      }
      sendJsonRpcMessage(message);
    };

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    if (!child.stdout) {
      child.kill();
      throw new Error(t("codex.appServerNoStdout"));
    }

    rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    const outputReader = rl;

    const outputLoopPromise = (async (): Promise<void> => {
      try {
        for await (const line of outputReader) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          let message: Record<string, unknown>;
          try {
            message = JSON.parse(trimmed) as Record<string, unknown>;
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            stdoutParseError = new Error(t("codex.appServerParseFailed", { error: detail }));
            failRun(stdoutParseError);
            shutdownChild("terminate");
            break;
          }

          const hasId = Object.prototype.hasOwnProperty.call(message, "id");
          const hasResult = Object.prototype.hasOwnProperty.call(message, "result");
          const hasError = Object.prototype.hasOwnProperty.call(message, "error");
          const method = String(message.method || "").trim();

          if (hasId && (hasResult || hasError) && !method) {
            const id = Number(message.id);
            const pending = pendingRequests.get(id);
            if (!pending) {
              continue;
            }
            pendingRequests.delete(id);
            if (hasError) {
              const errorRecord = message.error && typeof message.error === "object"
                ? message.error as Record<string, unknown>
                : {};
              pending.reject(new Error(String(errorRecord.message || t("codex.appServerRequestFailed"))));
            } else {
              pending.resolve(message.result);
            }
            continue;
          }

          if (hasId && method) {
            const resolution = buildAppServerRequestResolution(
              method,
              t("codex.appServerUnsupportedRequest", { method: method || "unknown" })
            );
            try {
              sendJsonRpcMessage(resolution.error
                ? { jsonrpc: "2.0", id: message.id, error: resolution.error }
                : { jsonrpc: "2.0", id: message.id, result: resolution.result ?? {} });
            } catch (error) {
              failRun(error instanceof Error ? error : new Error(String(error)));
              shutdownChild("terminate");
              break;
            }
            continue;
          }

          if (isCodexContextCompactionCompletedNotification(message, existingThreadId)) {
            threadCompacted = true;
            settleSuccess();
            setTimeout(() => shutdownChild("terminate"), 0);
            continue;
          }

          if (!method) {
            continue;
          }

          if (method === "error") {
            const params = message.params && typeof message.params === "object"
              ? message.params as Record<string, unknown>
              : {};
            const rateLimitMessage = detectCodexRateLimitErrorMessage(params);
            if (rateLimitMessage) {
              failRun(new Error(rateLimitMessage));
              setTimeout(() => shutdownChild("terminate"), 0);
              continue;
            }
            const errorMessage = String(params.message || "").trim();
            if (errorMessage) {
              failRun(new Error(errorMessage));
              setTimeout(() => shutdownChild("terminate"), 0);
            }
            continue;
          }
        }
      } catch (error) {
        const nextError = error instanceof Error ? error : new Error(String(error));
        failRun(nextError);
        throw nextError;
      }
    })();

    try {
      await request("initialize", buildCodexAppServerInitializeParams(spawnCommand.command));
      notify("initialized");

      const threadParams = buildCodexThreadParams(threadOptions);

      await request<Record<string, unknown>>("thread/resume", {
        threadId: existingThreadId,
        ...threadParams,
      });
      await request("thread/compact/start", {
        threadId: existingThreadId,
      });

      const result = await completionPromise;
      const { code, signal } = await exitPromise;
      await outputLoopPromise;

      if (spawnError) {
        throw spawnError;
      }
      if (stdoutParseError) {
        throw stdoutParseError;
      }
      if (streamError) {
        throw streamError;
      }
      if (this.disposeGeneration !== runDisposeGeneration) {
        throw createRunnerDisposedError();
      }
      if (this.abortGeneration !== runGeneration) {
        throw createAbortError();
      }
      if (code !== 0 && !signal) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        throw new Error(t("codex.appServerExited", { detail: `code ${code ?? 1}`, stderr: stderr || "-" }));
      }
      return result;
    } catch (error) {
      if (!settled && error instanceof Error) {
        failRun(error);
      }
      shutdownChild("terminate");
      await Promise.allSettled([exitPromise, outputLoopPromise]);
      if (this.disposeGeneration !== runDisposeGeneration) {
        throw createRunnerDisposedError();
      }
      if (this.abortGeneration !== runGeneration) {
        throw createAbortError();
      }
      throw error;
    } finally {
      rl?.close();
      child.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stdin?.removeAllListeners();
      this.releaseActiveChild(child);
    }
  }

  public async runStreamed(
    prompt: string,
    handlers: CodexStreamHandlers
  ): Promise<void> {
    await this.ensureReady();

    const runGeneration = this.abortGeneration;
    const runDisposeGeneration = this.disposeGeneration;
    const threadOptions = buildCodexThreadOptions(
      this.options.args,
      this.options.cwd,
      this.options.thinkingMode,
      this.options.interactiveMode,
      this.options.model,
      this.options.multiAgentEnabled
    );
    const imagePaths = collectArgValues(this.options.args, ["--image", "-i"])
      .map((item) => item.trim())
      .filter(Boolean);
    let resolvedWorkspaceDir = threadOptions.workingDirectory;
    const configOverrides: string[] = [];
    const childEnvResult = buildCodexChildEnv(process.env);
    threadOptions.modelProvider = (await resolveCodexModelProvider(childEnvResult.codexHomeDir)) ?? undefined;

    if (resolvedWorkspaceDir) {
      resolvedWorkspaceDir = await resolveCodexProjectPath(resolvedWorkspaceDir);
      threadOptions.workingDirectory = resolvedWorkspaceDir;
      configOverrides.push(buildCodexWorkspaceTrustConfigOverride(resolvedWorkspaceDir));
      try {
        const trustResult = await ensureCodexProjectTrusted({
          projectRoot: resolvedWorkspaceDir,
          codexHomeDir: childEnvResult.codexHomeDir,
        });
        handlers.onEvent?.({
          type: "codex.lifecycle",
          event: "project_trust_ready",
          status: trustResult.status,
          projectRoot: trustResult.projectRoot,
          configPath: trustResult.configPath,
        });
      } catch (error) {
        handlers.onEvent?.({
          type: "codex.lifecycle",
          event: "project_trust_failed",
          projectRoot: resolvedWorkspaceDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const spawnCommand = resolveSpawnCommand(
      this.options.command,
      buildCodexAppServerArgs(threadOptions.multiAgentEnabled !== false, configOverrides)
    );
    void logInfo("codex-app-server-spawn", {
      command: spawnCommand.command,
      args: spawnCommand.args,
      cwd: resolvedWorkspaceDir ?? this.options.cwd ?? null,
      usesShell: spawnCommand.usesShell,
      resolvedFrom: spawnCommand.resolvedFrom,
      codexHomeDir: childEnvResult.codexHomeDir,
      removedEnvKeys: childEnvResult.removedEnvKeys,
      threadId: this.options.threadId,
      interactiveMode: this.options.interactiveMode,
    });
    handlers.onEvent?.({
      type: "codex.lifecycle",
      event: "spawn_prepare",
      command: spawnCommand.command,
      args: spawnCommand.args,
      cwd: resolvedWorkspaceDir ?? this.options.cwd ?? null,
      usesShell: spawnCommand.usesShell,
      resolvedFrom: spawnCommand.resolvedFrom,
      codexHomeDir: childEnvResult.codexHomeDir,
      removedEnvKeys: childEnvResult.removedEnvKeys,
    });
    const child = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: resolvedWorkspaceDir ?? this.options.cwd,
      env: childEnvResult.env,
      argv0: CODEX_APP_SERVER_PROCESS_LABEL,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.trackActiveChild(child);

    let spawnError: Error | null = null;
    let streamError: Error | null = null;
    let stdoutParseError: Error | null = null;
    const stderrChunks: Buffer[] = [];
    let nextRequestId = 1;
    let turnSettled = false;
    let childClosed = false;
    let exitSettled = false;
    const pendingRequests = new Map<number, JsonRpcPendingRequest>();
    const assistantBuffers = new Map<string, string>();
    const emittedTraceContents = new Map<string, string>();
    let activeTurnId = "";
    let rl: readline.Interface | null = null;
    let turnCompletionResolve: (() => void) | null = null;
    let turnCompletionReject: ((error: Error) => void) | null = null;

    const turnCompletionPromise = new Promise<void>((resolve, reject) => {
      turnCompletionResolve = resolve;
      turnCompletionReject = reject;
    });
    void turnCompletionPromise.catch(() => undefined);
    const exitPromise = new Promise<AppServerResponse>((resolve) => {
      const settleExit = (response: AppServerResponse): boolean => {
        if (exitSettled) {
          return false;
        }
        exitSettled = true;
        childClosed = true;
        resolve(response);
        return true;
      };
      child.once("close", (code, signal) => {
        if (!settleExit({ code, signal })) {
          return;
        }
        if (!turnSettled) {
          const error = this.disposeGeneration !== runDisposeGeneration
            ? createRunnerDisposedError()
            : this.abortGeneration !== runGeneration
              ? createAbortError()
              : new Error(
                t("codex.appServerExited", {
                  detail: signal ? `signal ${signal}` : `code ${code ?? 1}`,
                  stderr: Buffer.concat(stderrChunks).toString("utf8") || "-",
                })
              );
          failRun(error);
        }
      });
      child.once("error", (error) => {
        const normalizedError = normalizeCodexSpawnError(error, spawnCommand.command);
        spawnError = normalizedError;
        void logError("codex-app-server-spawn-error", {
          command: spawnCommand.command,
          code: (error as NodeJS.ErrnoException).code ?? null,
          pid: child.pid ?? null,
          activeChildren: this.activeChildren.size,
          error: error.message,
        });
        handlers.onEvent?.({
          type: "codex.lifecycle",
          event: "spawn_error",
          command: spawnCommand.command,
          code: (error as NodeJS.ErrnoException).code ?? null,
          error: normalizedError.message,
        });
        rl?.close();
        settleExit({ code: null, signal: null });
        failRun(normalizedError);
      });
    });

    const settleTurnCompletion = (error?: Error): void => {
      if (turnSettled) {
        return;
      }
      turnSettled = true;
      if (error) {
        turnCompletionReject?.(error);
        return;
      }
      turnCompletionResolve?.();
    };

    const rejectPendingRequests = (error: Error): void => {
      for (const pending of pendingRequests.values()) {
        pending.reject(error);
      }
      pendingRequests.clear();
    };

    const failRun = (error: Error): void => {
      if (!streamError) {
        streamError = error;
      }
      rejectPendingRequests(error);
      settleTurnCompletion(error);
    };

    const shutdownChild = (mode: "graceful" | "terminate"): void => {
      if (childClosed) {
        return;
      }
      requestChildShutdown(child, mode);
    };

    const updateThreadId = (threadId: unknown, allowReplace = false): void => {
      const normalized = String(threadId || "").trim();
      if (!normalized || this.options.threadId === normalized) {
        return;
      }
      if (this.options.threadId && !allowReplace) {
        return;
      }
      this.options.threadId = normalized;
      handlers.onThreadId(normalized);
    };

    const sendJsonRpcMessage = (message: Record<string, unknown>): void => {
      if (!child.stdin || !child.stdin.writable) {
        throw new Error(t("codex.appServerStdinUnavailable"));
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const request = <T = unknown>(method: string, params: Record<string, unknown>): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const id = nextRequestId;
        nextRequestId += 1;
        pendingRequests.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
        });
        try {
          sendJsonRpcMessage({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
          pendingRequests.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };

    const notify = (method: string, params?: Record<string, unknown>): void => {
      const message: Record<string, unknown> = {
        jsonrpc: "2.0",
        method,
      };
      if (params && Object.keys(params).length > 0) {
        message.params = params;
      }
      sendJsonRpcMessage(message);
    };

    const failRunWithVisibleMessage = (message: string): void => {
      const normalized = message.trim();
      if (!normalized) {
        return;
      }
      emitCodexVisibleErrorTrace(handlers.onTrace, normalized);
      failRun(new Error(normalized));
      setTimeout(() => shutdownChild("terminate"), 0);
    };

    const rawResponseToolNames = new Map<string, string>();
    const turnAssistantObserver = createCodexTurnAssistantObserver(handlers.onAssistantDelta);
    const runtimeItemHandlers = {
      onAssistantDelta: turnAssistantObserver.emit,
      onSubagentUpdate: handlers.onSubagentUpdate,
      onTrace: handlers.onTrace,
      onTaskListUpdate: handlers.onTaskListUpdate,
    };

    const handleItemEvent = (
      eventType: "item.started" | "item.completed",
      rawItem: unknown,
      threadId?: string,
    ): void => {
      handleCodexItemEvent({
        eventType,
        rawItem,
        threadId,
        primaryThreadId: this.options.threadId ?? undefined,
        assistantBuffers,
        emittedTraceContents,
        handlers: runtimeItemHandlers,
        onVisibleError: failRunWithVisibleMessage,
        formatCollabToolFailure: (failure) => t("codex.collabToolFailed", {
          tool: failure.tool,
          detail: failure.detail,
        }),
      });
    };

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    if (!child.stdout) {
      child.kill();
      throw new Error(t("codex.appServerNoStdout"));
    }

    rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    const outputReader = rl;

    const outputLoopPromise = (async (): Promise<void> => {
      try {
        for await (const line of outputReader) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          let message: Record<string, unknown>;
          try {
            message = JSON.parse(trimmed) as Record<string, unknown>;
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            stdoutParseError = new Error(t("codex.appServerParseFailed", { error: detail }));
            failRun(stdoutParseError);
            shutdownChild("terminate");
            break;
          }

          const hasId = Object.prototype.hasOwnProperty.call(message, "id");
          const hasResult = Object.prototype.hasOwnProperty.call(message, "result");
          const hasError = Object.prototype.hasOwnProperty.call(message, "error");
          const method = String(message.method || "").trim();
          const forwardedEvent = buildForwardedRawEvent(message);
          if (forwardedEvent) {
            handlers.onEvent?.(forwardedEvent);
          }

          if (hasId && (hasResult || hasError) && !method) {
            const id = Number(message.id);
            const pending = pendingRequests.get(id);
            if (!pending) {
              continue;
            }
            pendingRequests.delete(id);
            if (hasError) {
              const errorRecord = message.error && typeof message.error === "object"
                ? message.error as Record<string, unknown>
                : {};
              pending.reject(new Error(String(errorRecord.message || t("codex.appServerRequestFailed"))));
            } else {
              pending.resolve(message.result);
            }
            continue;
          }

          if (hasId && method) {
            const resolution = await handlers.onRequest?.({ method, params: message.params })
              ?? buildAppServerRequestResolution(
                method,
                t("codex.appServerUnsupportedRequest", { method: method || "unknown" })
              );
            try {
              sendJsonRpcMessage(resolution.error
                ? { jsonrpc: "2.0", id: message.id, error: resolution.error }
                : { jsonrpc: "2.0", id: message.id, result: resolution.result ?? {} });
            } catch (error) {
              failRun(error instanceof Error ? error : new Error(String(error)));
              shutdownChild("terminate");
              break;
            }
            continue;
          }

          if (!method) {
            continue;
          }

          if (method === "thread/started") {
            const startedThreadId = (message.params as Record<string, unknown> | undefined)?.thread && typeof (message.params as Record<string, unknown>).thread === "object"
              ? ((message.params as Record<string, unknown>).thread as Record<string, unknown>).id
              : undefined;
            const normalizedStartedThreadId = String(startedThreadId || "").trim();
            if (
              normalizedStartedThreadId
              && this.options.threadId
              && normalizedStartedThreadId !== this.options.threadId
            ) {
              handlers.onSubagentUpdate?.({
                threadId: normalizedStartedThreadId,
                status: "running",
              });
            } else {
              updateThreadId(normalizedStartedThreadId);
            }
            continue;
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
              assistantBuffers.set(bufferKey, `${assistantBuffers.get(bufferKey) ?? ""}${delta}`);
            }
            if (delta) {
              if (isSubagentDelta) {
                handlers.onSubagentUpdate?.({
                  threadId: eventThreadId,
                  status: "running",
                  delta,
                });
              } else {
                turnAssistantObserver.emit(
                  delta,
                  isCodexFinalAnswerPhase(params.phase) ? { codexFinalAnswer: true } : undefined
                );
              }
            }
            continue;
          }

          if (method === "thread/tokenUsage/updated") {
            continue;
          }

          if (method === "turn/plan/updated") {
            const params = message.params && typeof message.params === "object"
              ? message.params as Record<string, unknown>
              : {};
            const eventThreadId = String(params.threadId || "").trim();
            if (!eventThreadId || !this.options.threadId || eventThreadId === this.options.threadId) {
              emitCodexTodoListUpdate(Array.isArray(params.plan) ? params.plan : [], handlers.onTaskListUpdate);
            } else {
              handlers.onSubagentUpdate?.({ threadId: eventThreadId, status: "running" });
            }
            continue;
          }

          if (method === "rawResponseItem/completed") {
            const params = message.params && typeof message.params === "object"
              ? message.params as Record<string, unknown>
              : {};
            const eventThreadId = String(params.threadId || "").trim();
            if (isCodexSubagentThreadEvent(eventThreadId, this.options.threadId)) {
              handlers.onSubagentUpdate?.({ threadId: eventThreadId, status: "running" });
              continue;
            }
            const rawItem = params.item;
            const toolCall = extractCodexRawResponseToolCall(rawItem);
            if (toolCall) {
              rawResponseToolNames.set(toolCall.callId, toolCall.toolName);
              continue;
            }
            const outputRecord = rawItem && typeof rawItem === "object"
              ? rawItem as Record<string, unknown>
              : {};
            const callId = String(outputRecord.call_id || "").trim();
            const toolName = callId ? (rawResponseToolNames.get(callId) ?? "") : "";
            const waitTimeout = extractCodexWaitTimeoutPayload(rawItem, toolName);
            if (waitTimeout) {
              if (callId) {
                rawResponseToolNames.delete(callId);
              }
              failRunWithVisibleMessage(t("codex.collabWaitTimedOut", { detail: waitTimeout.detail }));
              continue;
            }
            if (callId) {
              rawResponseToolNames.delete(callId);
            }
            continue;
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
            if (isSubagentTurn) {
              const error = turnStatus === "failed"
                ? buildTurnFailureMessage(params, t("codex.appServerTaskFailed"))
                : "";
              handlers.onSubagentUpdate?.({
                threadId: eventThreadId,
                status: turnStatus === "failed"
                  ? "failed"
                  : turnStatus === "interrupted"
                    ? "interrupted"
                    : "completed",
                ...(error ? { error } : {}),
              });
              continue;
            }
            if (!shouldSettleCodexPrimaryTurn({
              eventThreadId,
              eventTurnId: completedTurnId,
              primaryThreadId: this.options.threadId,
              activeTurnId,
            })) {
              continue;
            }
            if (turnStatus === "failed") {
              settleTurnCompletion(new Error(buildTurnFailureMessage(params, t("codex.appServerTaskFailed"))));
            } else {
              settleTurnCompletion();
            }
            setTimeout(() => shutdownChild("graceful"), 0);
            continue;
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
              || ""
            ).trim();
            if (isCodexSubagentThreadEvent(eventThreadId, this.options.threadId)) {
              handlers.onSubagentUpdate?.({
                threadId: eventThreadId,
                status: params.willRetry === true ? "running" : "failed",
                ...(warning ? { error: warning } : {}),
              });
              continue;
            }
            const rateLimitMessage = detectCodexRateLimitErrorMessage(params);
            if (rateLimitMessage) {
              failRunWithVisibleMessage(rateLimitMessage);
              continue;
            }
            if (warning) {
              const lower = warning.toLowerCase();
              if (lower.startsWith("reconnecting") || lower.startsWith("retrying")) {
                handlers.onTrace(`warning ${warning}`);
              } else {
                emitCodexVisibleErrorTrace(handlers.onTrace, warning);
              }
            }
            continue;
          }

          if (method === "account/rateLimits/updated" || method === "account/updated") {
            continue;
          }

          if (method === "item/started" || method === "item/completed") {
            const params = message.params && typeof message.params === "object"
              ? message.params as Record<string, unknown>
              : {};
            handleItemEvent(
              method === "item/started" ? "item.started" : "item.completed",
              params.item,
              String(params.threadId || "").trim(),
            );
            continue;
          }
        }
      } catch (error) {
        const nextError = error instanceof Error ? error : new Error(String(error));
        failRun(nextError);
        throw nextError;
      }
    })();

    try {
      await request("initialize", buildCodexAppServerInitializeParams(spawnCommand.command));
      notify("initialized");

      const threadParams = buildCodexThreadParams(threadOptions);

      const threadResult = this.options.threadId
        ? await request<Record<string, unknown>>("thread/resume", {
            threadId: this.options.threadId,
            ...threadParams,
          })
        : await request<Record<string, unknown>>("thread/start", threadParams);
      const thread = threadResult?.thread && typeof threadResult.thread === "object"
        ? threadResult.thread as Record<string, unknown>
        : null;
      updateThreadId(thread?.id, true);

      const turnResult = await request<Record<string, unknown>>("turn/start", buildCodexTurnStartParams(
        this.options.threadId,
        prompt,
        imagePaths,
        threadOptions
      ));
      const startedTurn = turnResult?.turn && typeof turnResult.turn === "object"
        ? turnResult.turn as Record<string, unknown>
        : {};
      activeTurnId = String(startedTurn.id || "").trim();
      handlers.onEvent?.({ type: "turn.started" });

      await turnCompletionPromise;
      const { code, signal } = await exitPromise;
      await outputLoopPromise;

      if (spawnError) {
        throw spawnError;
      }
      if (stdoutParseError) {
        throw stdoutParseError;
      }
      if (streamError) {
        throw streamError;
      }
      if (this.disposeGeneration !== runDisposeGeneration) {
        throw createRunnerDisposedError();
      }
      if (this.abortGeneration !== runGeneration) {
        throw createAbortError();
      }
      if (code !== 0 || signal) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
        throw new Error(t("codex.appServerExited", { detail, stderr: stderr || "-" }));
      }
    } catch (error) {
      if (!turnSettled && error instanceof Error) {
        failRun(error);
      }
      shutdownChild("terminate");
      await Promise.allSettled([exitPromise, outputLoopPromise]);
      if (this.disposeGeneration !== runDisposeGeneration) {
        throw createRunnerDisposedError();
      }
      if (this.abortGeneration !== runGeneration) {
        throw createAbortError();
      }
      throw error;
    } finally {
      rl?.close();
      child.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stdin?.removeAllListeners();
      this.releaseActiveChild(child);
    }
  }
}
