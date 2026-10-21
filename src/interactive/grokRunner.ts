import type { ChildProcess } from "child_process";
import type { Readable } from "stream";
import { spawn } from "cross-spawn";
import { buildGrokAgentStdioArgs, getGrokAgentArgs, getGrokCommand } from "../cli/config";
import { mapThinkingModeToGrokEffort } from "../cli/types";
import { readGrokActiveModelHasOwnCredential } from "../config/grokConfig";
import { ensureGrokReasoningConfig } from "../config/grokReasoningConfig";
import { t } from "../i18n";
import {
  createCodexAppServerNdjsonReader,
  serializeCodexAppServerMessage,
  type CodexAppServerNdjsonReader,
} from "./codexAppServerNdjson";
import { requestChildShutdown } from "./codexRunnerProcess";
import { resolveSpawnCommand } from "./codexRunnerProcess";
import { GrokAcpClient, GrokAcpClientError } from "./grokAcpClient";
import { isHumanInteractionRejectedErrorInfo } from "../humanInteraction";
import { GROK_USER_QUESTION_METHOD, isGrokUserQuestionMethod, readGrokUserQuestionResponse } from "./grokUserQuestion";
import { GrokReplayStream } from "./grokReplayStream";
import {
  buildGrokAuthenticateParams,
  buildGrokRequestError,
  buildGrokInitializeParams,
  buildGrokReasoningConfigParams,
  buildGrokSessionCancelParams,
  buildGrokSessionLoadParams,
  buildGrokSessionNewParams,
  buildGrokSessionPromptParams,
  buildGrokSessionSetModelParams,
  GROK_RESPONSES_STREAM_INCOMPATIBLE,
  classifyGrokSessionMessage,
  findGrokReasoningOption,
  parseGrokJsonRpcLine,
  readGrokAuthMethodIds,
  readGrokCompactionEvent,
  readGrokLoadSessionCapability,
  readGrokPromptStopReason,
  readGrokSessionId,
  readGrokStreamFailure,
  readGrokTokenUsageUpdate,
  readGrokResponseContextTokens,
  resolveGrokReasoningEffort,
  isGrokCompletedStopReason,
  selectGrokAuthMethod,
  type GrokJsonRpcMessage,
  type GrokCompactionEvent,
  type GrokTokenUsageUpdate,
} from "./grokAppServerProtocol";

export type GrokChild = {
  stdin: {
    write: (chunk: string) => unknown;
    end: () => unknown;
    destroyed?: boolean;
    writableEnded?: boolean;
  } | null;
  stdout: Readable | null;
  stderr: Readable | null;
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  once: (event: "error" | "close", listener: (...args: unknown[]) => void) => unknown;
};

export type GrokSpawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    windowsHide?: boolean;
  },
) => GrokChild;

export type GrokTraceKind = "thinking" | "normal" | "tool-use" | "error";

export type GrokStreamHandlers = {
  onRequest?: (request: { method: string; params?: unknown }) =>
    Promise<{ result?: unknown; error?: unknown } | null | undefined> | { result?: unknown; error?: unknown } | null | undefined;
  onAssistantDelta?: (text: string) => void;
  onTrace?: (content: string, kind?: GrokTraceKind, meta?: { toolCallId?: string }) => void;
  onEvent?: (message: GrokJsonRpcMessage) => void;
  onActivity?: () => void;
  onTaskListUpdate?: (items: { text: string; done: boolean }[]) => void;
  onComplete?: (meta: { stopReason: string | null }) => void;
  onTokenUsageUpdate?: (update: GrokTokenUsageUpdate) => void;
};

export type GrokRunnerOptions = {
  cwd: string;
  command?: string;
  agentArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  thinkingMode?: unknown;
  model?: string | null;
  localSessionId?: string | null;
  spawnImpl?: GrokSpawn;
};

export type GrokSessionInfo = {
  acpSessionId: string;
  resumed: boolean;
  retainedLocalSessionId: string | null;
};

export type GrokCompactionResult = {
  compacted: boolean;
  sessionId: string;
  tokensBefore: number | null;
  tokensAfter: number | null;
};

type PendingRequest = {
  method: string;
  replay: GrokReplayStream | null;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class GrokInteractiveRunner {
  private child: GrokChild | null = null;
  private reader: CodexAppServerNdjsonReader | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private sessionId: string | null = null;
  private closed = false;
  private failed: Error | null = null;
  private activeHandlers: GrokStreamHandlers | null = null;
  private turnCancelled = false;
  private tokenUsageHandler: GrokStreamHandlers["onTokenUsageUpdate"] = undefined;
  private latestTokenUsage: GrokTokenUsageUpdate | null = null;
  private streamFailure: string | null = null;
  private activeReplay: GrokReplayStream | null = null;
  private reasoningNotice: string | null = null;
  private readonly stderrChunks: Buffer[] = [];
  private readonly acpClient: GrokAcpClient;

  public constructor(private readonly options: GrokRunnerOptions) {
    this.acpClient = new GrokAcpClient(options.cwd, async (params) => {
      const handlers = this.activeHandlers;
      if (!handlers || this.turnCancelled) {
        return { outcome: "cancelled" };
      }
      const resolution = await handlers.onRequest?.({ method: GROK_USER_QUESTION_METHOD, params });
      if (handlers !== this.activeHandlers || this.turnCancelled || !resolution) {
        return { outcome: "cancelled" };
      }
      const response = readGrokUserQuestionResponse(resolution.result);
      if (!response) {
        throw new GrokAcpClientError("Invalid user question response", -32603);
      }
      return response;
    });
  }

  public isReusable(): boolean {
    return !this.closed && !this.failed;
  }

  public async start(options: { requireResume?: boolean } = {}): Promise<GrokSessionInfo> {
    if (this.sessionId && this.child && this.isReusable()) {
      return {
        acpSessionId: this.sessionId,
        resumed: true,
        retainedLocalSessionId: String(this.options.localSessionId ?? "").trim() || null,
      };
    }
    if (this.closed) {
      throw new Error(t("grok.exited", { detail: "closed", stderr: "" }));
    }
    const command = (this.options.command ?? getGrokCommand()).trim();
    if (!command) {
      throw new Error(t("grok.emptyCommand"));
    }
    const launchArgs = buildGrokAgentStdioArgs(
      this.options.agentArgs ?? getGrokAgentArgs(),
      this.options.model,
    );
    let resolved: ReturnType<typeof resolveSpawnCommand>;
    try {
      resolved = resolveSpawnCommand(command, launchArgs);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    try {
      await ensureGrokReasoningConfig({
        env: this.options.env,
        model: this.options.model,
        thinkingMode: this.options.thinkingMode,
      });
    } catch {
      throw new Error(t("grok.reasoningConfigFailed"));
    }
    if (this.closed) {
      throw new Error(t("grok.exited", { detail: "closed", stderr: "" }));
    }
    const spawnImpl = this.options.spawnImpl ?? defaultGrokSpawn;
    let child: GrokChild;
    try {
      child = spawnImpl(resolved.command, resolved.args, {
        cwd: this.options.cwd,
        env: this.options.env ?? process.env,
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      const spawnError = error instanceof Error ? error : new Error(String(error));
      this.fail(spawnError);
      throw spawnError;
    }
    this.child = child;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrChunks.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    });
    child.once("close", () => {
      if (!this.closed) {
        this.fail(new Error(t("grok.exited", {
          detail: String(child.exitCode ?? child.signalCode ?? "closed"),
          stderr: Buffer.concat(this.stderrChunks).toString("utf8").trim(),
        })));
      }
    });
    if (!child.stdout) {
      const error = new Error(t("grok.stdioUnavailable"));
      this.fail(error);
      throw error;
    }
    this.reader = createCodexAppServerNdjsonReader(child.stdout);
    void this.readLoop();
    try {
      return await this.handshake(options.requireResume === true);
    } catch (error) {
      if (!this.closed) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  public async prompt(text: string, handlers: GrokStreamHandlers = {}): Promise<{ stopReason: string | null }> {
    if (typeof text !== "string" || text.trim() === "") {
      throw Object.assign(new Error(t("grok.emptyPrompt")), { reason: "empty" });
    }
    if (!this.sessionId || this.closed) {
      throw new Error(t("grok.requestFailed"));
    }
    this.activeHandlers = handlers;
    this.turnCancelled = false;
    this.tokenUsageHandler = handlers.onTokenUsageUpdate;
    if (this.latestTokenUsage) {
      this.tokenUsageHandler?.(this.latestTokenUsage);
    }
    this.streamFailure = null;
    const replay = new GrokReplayStream((message) => handlers.onEvent?.(message), {
      onToolTrace: (trace) => handlers.onTrace?.(trace.content, "tool-use", { toolCallId: trace.toolCallId }),
      onTaskListUpdate: (entries) => handlers.onTaskListUpdate?.(entries.map((entry) => ({ text: entry.content, done: entry.status === "completed" }))),
    });
    this.activeReplay = replay;
    let replayEndStatus: "failed" | "interrupted" = "interrupted";
    try {
      if (this.reasoningNotice && handlers.onTrace) {
        handlers.onTrace(this.reasoningNotice, "normal");
        this.reasoningNotice = null;
      }
      const result = await this.request("session/prompt", buildGrokSessionPromptParams(this.sessionId, text));
      const stopReason = readGrokPromptStopReason({ result });
      handlers.onComplete?.({ stopReason });
      return { stopReason };
    } catch (error) {
      replayEndStatus = "failed";
      this.tokenUsageHandler = undefined;
      if (error instanceof Error && (error as Error & { code?: string }).code === GROK_RESPONSES_STREAM_INCOMPATIBLE) {
        this.fail(error);
      }
      throw error;
    } finally {
      replay.finish(replayEndStatus);
      if (this.activeHandlers === handlers) {
        this.activeHandlers = null;
        this.activeReplay = null;
      }
    }
  }

  public cancelTurn(): void {
    this.turnCancelled = true;
    this.tokenUsageHandler = undefined;
    this.activeReplay?.finish("cancelled");
    if (!this.sessionId || !this.canWrite()) {
      this.fail(new Error(t("grok.requestFailed")));
      return;
    }
    this.acpClient.killAll();
    this.write({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: buildGrokSessionCancelParams(this.sessionId),
    });
  }

  public async compactSession(): Promise<GrokCompactionResult> {
    if (this.activeHandlers) {
      throw new Error(t("rules.compactRunning"));
    }
    const started = await this.start({ requireResume: true });
    if (!started.resumed) {
      throw new Error(t("rules.compactNoSession"));
    }
    const compaction: { event: GrokCompactionEvent | null } = { event: null };
    const result = await this.prompt("/compact", {
      onTokenUsageUpdate: this.tokenUsageHandler,
      onEvent: (message) => {
        const event = readGrokCompactionEvent(message, started.acpSessionId);
        if (event) {
          compaction.event = event;
        }
      },
    });
    const confirmed = compaction.event;
    if (!isGrokCompletedStopReason(result.stopReason) || confirmed?.status !== "completed") {
      throw new Error(confirmed?.error || t("compact.grokNativeUnconfirmed"));
    }
    return {
      compacted: true,
      sessionId: started.acpSessionId,
      tokensBefore: confirmed.tokensBefore,
      tokensAfter: confirmed.tokensAfter,
    };
  }

  public dispose(): void {
    this.fail(new Error(t("grok.exited", { detail: "disposed", stderr: "" })));
  }

  private async handshake(requireResume = false): Promise<GrokSessionInfo> {
    const initialized = await this.request("initialize", buildGrokInitializeParams());
    const env = this.options.env ?? process.env;
    const modelHasOwnCredential = await readGrokActiveModelHasOwnCredential(env, undefined, this.options.model);
    if (!modelHasOwnCredential) {
      const selected = selectGrokAuthMethod(readGrokAuthMethodIds(initialized), env);
      if (!selected.ok) {
        throw new Error(t("grok.authRequired"));
      }
      await this.request("authenticate", buildGrokAuthenticateParams(selected.methodId));
    }
    const localSessionId = String(this.options.localSessionId ?? "").trim();
    const canLoad = readGrokLoadSessionCapability(initialized);
    if (requireResume && (!localSessionId || !canLoad)) {
      throw new Error(t("rules.compactNoSession"));
    }
    let resumed = false;
    let created: unknown;
    if (localSessionId && canLoad) {
      try {
        created = await this.request("session/load", buildGrokSessionLoadParams(localSessionId, this.options.cwd));
        resumed = true;
      } catch (error) {
        if (requireResume || this.closed || this.failed) {
          throw error;
        }
        created = await this.request("session/new", buildGrokSessionNewParams(this.options.cwd));
      }
    } else {
      created = await this.request("session/new", buildGrokSessionNewParams(this.options.cwd));
    }
    const acpSessionId = readGrokSessionId(created);
    if (!acpSessionId || (requireResume && acpSessionId !== localSessionId)) {
      throw new Error(t("grok.requestFailed"));
    }
    this.sessionId = acpSessionId;
    const modelId = String(this.options.model ?? "").trim();
    if (resumed && modelId) {
      await this.request("session/set_model", buildGrokSessionSetModelParams(acpSessionId, modelId));
    }
    const option = findGrokReasoningOption(created) ?? findGrokReasoningOption(initialized);
    const effort = resolveGrokReasoningEffort(this.options.thinkingMode, option);
    if (effort) {
      await this.request(
        "session/set_config_option",
        buildGrokReasoningConfigParams(acpSessionId, effort),
      );
    } else if (mapThinkingModeToGrokEffort(this.options.thinkingMode)) {
      this.reasoningNotice = option
        ? t("grok.reasoningNotAllowed", {
          effort: String(this.options.thinkingMode),
          allowed: option.allowed?.join(", ") ?? "",
        })
        : t("grok.reasoningUnavailable");
    }
    return {
      acpSessionId,
      resumed,
      retainedLocalSessionId: localSessionId || null,
    };
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
        const parsed = parseGrokJsonRpcLine(line);
        if (!parsed.ok) {
          if (parsed.reason === "invalid") {
            this.activeHandlers?.onTrace?.(t("grok.parseFailed", { error: parsed.error }), "error");
          }
          continue;
        }
        this.handleMessage(parsed.message);
      }
    } catch (error) {
      if (!this.closed) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleMessage(message: GrokJsonRpcMessage): void {
    const snapshot = this.sessionId ? readGrokTokenUsageUpdate(message, this.sessionId) : null;
    const responseTokens = this.sessionId && this.activeHandlers
      ? readGrokResponseContextTokens(message, this.sessionId)
      : null;
    const usage = snapshot ?? (responseTokens !== null ? {
      tokensInContextWindow: responseTokens,
      modelContextWindow: this.latestTokenUsage?.modelContextWindow ?? null,
    } : null);
    if (usage) {
      const changed = usage.tokensInContextWindow !== this.latestTokenUsage?.tokensInContextWindow
        || usage.modelContextWindow !== this.latestTokenUsage?.modelContextWindow;
      this.latestTokenUsage = usage;
      if (changed) {
        this.tokenUsageHandler?.(usage);
      }
    }
    if (message.id !== undefined && message.id !== null && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) {
        return;
      }
      this.pending.delete(Number(message.id));
      if (pending.method === "session/prompt") {
        pending.replay?.append(message);
      }
      if (message.error) {
        pending.reject(buildGrokRequestError(
          message.error,
          pending.method === "session/prompt" ? this.streamFailure : null,
          this.options.model,
        ));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.id !== null && message.method) {
      this.activeReplay?.flush();
      void this.answerClientRequest(message);
      return;
    }
    const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : null;
    if (typeof params?.sessionId === "string" && params.sessionId !== this.sessionId) {
      return;
    }
    if (message.method === "session/update" || message.method?.startsWith("_x.ai/session")) {
      this.activeHandlers?.onActivity?.();
    }
    const streamFailure = readGrokStreamFailure(message);
    if (streamFailure && this.activeHandlers) {
      this.streamFailure = streamFailure;
    }
    if (message.method === "session/update" || streamFailure || (this.sessionId && readGrokCompactionEvent(message, this.sessionId))) {
      this.activeReplay?.append(message);
    }
    const event = classifyGrokSessionMessage(message);
    if (event.type === "assistant_text") {
      this.activeHandlers?.onAssistantDelta?.(event.text);
      return;
    }
    if (event.type === "thinking") {
      this.activeHandlers?.onTrace?.(event.text, "thinking");
      return;
    }
  }

  private async answerClientRequest(message: GrokJsonRpcMessage): Promise<void> {
    const handlers = this.activeHandlers;
    try {
      const result = await this.acpClient.handle(String(message.method), message.params, this.sessionId);
      if (this.canWrite()) {
        this.write({ jsonrpc: "2.0", id: message.id, result });
      }
    } catch (error) {
      if (!this.canWrite()) {
        return;
      }
      if (isGrokUserQuestionMethod(String(message.method)) && error instanceof Error
        && isHumanInteractionRejectedErrorInfo(error)) {
        if (handlers && handlers === this.activeHandlers && !this.turnCancelled) {
          for (const [requestId, pending] of this.pending) {
            if (pending.method === "session/prompt") {
              this.pending.delete(requestId);
              pending.reject(error);
            }
          }
        }
        this.write({ jsonrpc: "2.0", id: message.id, result: { outcome: "cancelled" } });
        if (handlers && handlers === this.activeHandlers && !this.turnCancelled) {
          this.cancelTurn();
        }
        return;
      }
      const code = error instanceof GrokAcpClientError ? error.code : -32603;
      const text = error instanceof Error ? error.message : String(error);
      this.write({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.failed) {
      return Promise.reject(this.failed);
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        method,
        replay: method === "session/prompt" ? this.activeReplay : null,
        resolve,
        reject,
      });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.canWrite() || !this.child?.stdin) {
      throw new Error(t("grok.stdinUnavailable"));
    }
    this.child.stdin.write(serializeCodexAppServerMessage(message));
  }

  private canWrite(): boolean {
    const stdin = this.child?.stdin;
    return Boolean(stdin && !stdin.destroyed && !stdin.writableEnded && !this.closed);
  }

  private fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.failed = this.failed ?? error;
    this.tokenUsageHandler = undefined;
    this.closed = true;
    this.acpClient.dispose();
    this.reader?.close();
    for (const pending of this.pending.values()) {
      pending.reject(this.failed);
    }
    this.pending.clear();
    if (this.child) {
      requestChildShutdown(this.child as ChildProcess, "graceful");
    }
  }
}

function defaultGrokSpawn(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    windowsHide?: boolean;
  },
): GrokChild {
  return spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: options.detached,
    windowsHide: options.windowsHide,
    stdio: ["pipe", "pipe", "pipe"],
  }) as GrokChild;
}
