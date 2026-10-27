import type { ChildProcess } from "child_process";
import type { Readable } from "stream";
import { spawn } from "cross-spawn";
import {
  createCodexAppServerNdjsonReader,
  serializeCodexAppServerMessage,
  type CodexAppServerNdjsonReader,
} from "./codexAppServerNdjson";
import { killProcessTree, resolveSpawnCommand } from "./codexRunnerProcess";
import { KimiReplayStream } from "./kimiReplayStream";
import { getKimiCodeConfigRevision } from "../config/kimiCodeConfig";
import {
  acceptKimiIncrementalText,
  assertAdvertisedKimiModel,
  assertAdvertisedKimiThinking,
  boundKimiDiagnostic,
  buildKimiChildEnv,
  buildKimiInitializeParams,
  buildKimiLaunchArgs,
  buildKimiMethodNotFoundError,
  buildKimiPermissionResult,
  buildKimiSessionCancelParams,
  buildKimiSessionCloseParams,
  buildKimiSessionNewParams,
  buildKimiSessionPromptParams,
  buildKimiSessionResumeParams,
  buildKimiSetConfigOptionParams,
  classifyKimiSessionUpdate,
  KimiCompactionUnsupportedError,
  KimiProtocolError,
  KIMI_ACP_PROTOCOL_VERSION,
  KIMI_DEFAULT_COMMAND,
  KIMI_MODE_CONFIG_ID,
  KIMI_MODEL_CONFIG_ID,
  KIMI_SHUTDOWN_GRACE_MS,
  KIMI_STDERR_REPORT_LIMIT,
  KIMI_THINKING_CONFIG_ID,
  findKimiForbiddenWire,
  formatKimiRpcError,
  isKimiResumableSessionId,
  parseKimiJsonRpcLine,
  planKimiProcessTreeStop,
  projectKimiToolUpdate,
  readKimiConfigOption,
  readKimiConfigOptions,
  readKimiCompactionUpdate,
  readKimiModeState,
  readKimiPermissionOffer,
  readKimiPromptStopReason,
  readKimiSessionId,
  readKimiSessionUpdateBody,
  readKimiTokenUsageUpdate,
  readKimiUpdateSessionId,
  redactKimiDiagnostic,
  resolveKimiPermissionDecision,
  type KimiConfigOption,
  type KimiCompactionUpdate,
  type KimiJsonRpcMessage,
  type KimiTaskListItem,
  type KimiTokenUsageUpdate,
  type KimiToolProjection,
} from "./kimiAppServerProtocol";

export {
  KimiCompactionUnsupportedError,
  KimiProtocolError,
  type KimiConfigOption,
  type KimiTokenUsageUpdate,
};

export type KimiChild = {
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
  on?: (event: "error" | "close", listener: (...args: unknown[]) => void) => unknown;
};

export type KimiSpawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    windowsHide?: boolean;
  },
) => KimiChild;

export type KimiKillTree = (child: KimiChild, signal: NodeJS.Signals | number) => boolean;

export type KimiTraceKind = "thinking" | "normal" | "tool-use" | "error";

export type KimiStreamHandlers = {
  onRequest?: (request: { method: string; params?: unknown }) =>
    | Promise<{ result?: unknown; error?: unknown } | null | undefined>
    | { result?: unknown; error?: unknown }
    | null
    | undefined;
  onAssistantDelta?: (text: string) => void;
  onTrace?: (content: string, kind?: KimiTraceKind, meta?: { toolCallId?: string }) => void;
  onTaskListUpdate?: (items: KimiTaskListItem[]) => void;
  onEvent?: (message: KimiJsonRpcMessage) => void;
  onActivity?: () => void;
  onComplete?: (meta: { stopReason: string }) => void;
  onTokenUsageUpdate?: (update: KimiTokenUsageUpdate) => void;
  onCompactionUpdate?: (update: KimiCompactionUpdate) => void;
  onModeUpdate?: (modeId: string) => void;
};

export type KimiRunnerOptions = {
  cwd: string;
  command?: string;
  agentArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  model?: string | null;
  thinkingMode?: string | null;
  modeId?: string | null;
  localSessionId?: string | null;
  spawnImpl?: KimiSpawn;
  killTreeImpl?: KimiKillTree;
  platform?: NodeJS.Platform;
  shutdownGraceMs?: number;
};

export type KimiStartOptions = {
  requireResume?: boolean;
};

export type KimiSessionInfo = {
  acpSessionId: string;
  resumed: boolean;
  retainedLocalSessionId: string | null;
};

export type KimiPromptResult = {
  stopReason: string;
};

export type KimiConfigSnapshot = {
  model: string | null;
  thinking: string | null;
  modeId: string | null;
  modelOptions: string[];
  thinkingOptions: string[];
  modeOptions: string[];
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class KimiInteractiveRunner {
  private child: KimiChild | null = null;
  private reader: CodexAppServerNdjsonReader | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private sessionId: string | null = null;
  private retainedLocalSessionId: string | null = null;
  private lastResumed = false;
  private closed = false;
  private failed: Error | null = null;
  private shutdownStarted = false;
  private promptInFlight = false;
  private turnCancelled = false;
  private turnEpoch = 0;
  private activeTurnEpoch = 0;
  private activeHandlers: KimiStreamHandlers | null = null;
  private replayStream: KimiReplayStream | null = null;
  private settledHandlers: KimiStreamHandlers | null = null;
  private settledReplayStream: KimiReplayStream | null = null;
  private turnOpen = false;
  private configOptions: KimiConfigOption[] = [];
  private modeOptions: string[] = [];
  private currentModeId: string | null = null;
  private requestedThinkingMode: string | null = null;
  private readonly textTracker = new Map<string, string>();
  private readonly toolStates = new Map<string, KimiToolProjection>();
  private lastTaskListSignature = "";
  private readonly retiredMessageIds = new Set<string>();
  private readonly retiredToolCallIds = new Set<string>();
  private readonly shutdownTimers: NodeJS.Timeout[] = [];
  private stderrTextBuffer = "";
  private childEnv: NodeJS.ProcessEnv = {};
  private readonly configRevision: number;

  public constructor(private readonly options: KimiRunnerOptions) {
    this.configRevision = getKimiCodeConfigRevision(options.env);
  }

  public isReusable(): boolean {
    return !this.closed && !this.failed && !this.hasConfigRevisionChanged();
  }

  public getSessionInfo(): KimiSessionInfo | null {
    if (!this.sessionId) {
      return null;
    }
    return {
      acpSessionId: this.sessionId,
      resumed: this.lastResumed,
      retainedLocalSessionId: this.retainedLocalSessionId,
    };
  }

  public getConfigSnapshot(): KimiConfigSnapshot {
    const model = readKimiConfigOption(this.configOptions, KIMI_MODEL_CONFIG_ID);
    const thinking = readKimiConfigOption(this.configOptions, KIMI_THINKING_CONFIG_ID);
    const mode = readKimiConfigOption(this.configOptions, KIMI_MODE_CONFIG_ID);
    return {
      model: model?.currentValue ?? null,
      thinking: thinking?.currentValue ?? null,
      modeId: mode?.currentValue ?? this.currentModeId,
      modelOptions: model?.values ?? [],
      thinkingOptions: thinking?.values ?? [],
      modeOptions: this.modeOptions.length > 0 ? [...this.modeOptions] : mode?.values ?? [],
    };
  }

  public async start(options: KimiStartOptions = {}): Promise<KimiSessionInfo> {
    if (this.hasConfigRevisionChanged()) {
      throw new KimiProtocolError(
        "Kimi Code configuration changed; rebuild the runner and resume the ACP session",
        "config-reload-required",
      );
    }
    if (this.sessionId && this.child && this.isReusable()) {
      return {
        acpSessionId: this.sessionId,
        resumed: true,
        retainedLocalSessionId: this.retainedLocalSessionId,
      };
    }
    if (this.closed || this.failed) {
      throw this.failed ?? new KimiProtocolError("Kimi Code runner is closed", "closed");
    }
    const requireResume = options.requireResume === true;
    const mappedSessionId = isKimiResumableSessionId(this.options.localSessionId)
      ? String(this.options.localSessionId).trim()
      : null;
    if (requireResume && !mappedSessionId) {
      throw new KimiProtocolError(
        "Kimi Code resume requires an existing ACP session id and will not create a new session",
        "resume-required",
      );
    }
    this.launch();
    try {
      const initialized = await this.request("initialize", buildKimiInitializeParams());
      this.assertProtocolVersion(initialized);
      const opened = await this.openSession(requireResume, mappedSessionId);
      const returnedSessionId = readKimiSessionId(opened);
      const acpSessionId = returnedSessionId ?? (requireResume ? mappedSessionId : null);
      if (!acpSessionId || (requireResume && returnedSessionId !== null && returnedSessionId !== mappedSessionId)) {
        throw new KimiProtocolError("Kimi Code session id was not confirmed", "session-id");
      }
      this.sessionId = acpSessionId;
      this.retainedLocalSessionId = String(this.options.localSessionId ?? "").trim() || null;
      this.lastResumed = mappedSessionId !== null && acpSessionId === mappedSessionId;
      this.replaceConfigOptions(readKimiConfigOptions(opened));
      this.applyModeState(opened);
      if (this.options.model) {
        await this.setModel(this.options.model);
      }
      if (this.options.modeId) {
        await this.setMode(this.options.modeId);
      }
      if (this.options.thinkingMode) {
        await this.setThinkingMode(this.options.thinkingMode);
      }
      return {
        acpSessionId,
        resumed: this.lastResumed,
        retainedLocalSessionId: this.retainedLocalSessionId,
      };
    } catch (error) {
      if (!this.closed) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  public async prompt(text: string, handlers: KimiStreamHandlers = {}): Promise<KimiPromptResult> {
    if (typeof text !== "string" || text.trim() === "") {
      throw new KimiProtocolError("Kimi Code prompt text is empty", "empty-prompt");
    }
    if (!this.sessionId || this.closed || this.failed) {
      throw this.failed ?? new KimiProtocolError("Kimi Code session is not ready", "session-not-ready");
    }
    if (this.promptInFlight) {
      throw new KimiProtocolError("a Kimi Code prompt is already in flight", "concurrent-prompt");
    }
    this.settledHandlers = null;
    this.settledReplayStream?.finish();
    this.settledReplayStream = null;
    this.promptInFlight = true;
    this.beginTurn(handlers);
    const epoch = this.turnEpoch;
    try {
      const result = await this.request(
        "session/prompt",
        buildKimiSessionPromptParams(this.sessionId, text),
      );
      const stopReason = readKimiPromptStopReason(result);
      if (!stopReason) {
        throw new KimiProtocolError("session/prompt completed without stopReason", "missing-stop-reason");
      }
      this.replayStream?.finish();
      this.turnOpen = false;
      if (handlers.onTokenUsageUpdate || handlers.onCompactionUpdate || handlers.onEvent) {
        this.settledHandlers = handlers;
        if (handlers.onEvent) {
          this.settledReplayStream = new KimiReplayStream((message) => handlers.onEvent?.(message));
        }
      }
      if (this.activeTurnEpoch === epoch) {
        handlers.onComplete?.({ stopReason });
      }
      return { stopReason };
    } finally {
      this.replayStream?.finish();
      this.replayStream = null;
      this.turnOpen = false;
      this.endTurn(epoch);
      this.promptInFlight = false;
    }
  }

  public cancelTurn(): void {
    this.turnCancelled = true;
    this.turnOpen = false;
    this.replayStream?.finish();
    this.replayStream = null;
    this.settledHandlers = null;
    this.settledReplayStream?.finish();
    this.settledReplayStream = null;
    if (!this.sessionId || !this.canWrite()) {
      return;
    }
    this.write({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: buildKimiSessionCancelParams(this.sessionId),
    });
  }

  public async compactSession(): Promise<never> {
    throw new KimiCompactionUnsupportedError();
  }

  public async setModel(modelValue: string): Promise<KimiConfigSnapshot> {
    this.assertReadyForConfig();
    const option = readKimiConfigOption(this.configOptions, KIMI_MODEL_CONFIG_ID);
    const advertised = assertAdvertisedKimiModel(modelValue, option);
    if (advertised === this.getConfigSnapshot().model) {
      this.recheckRequestedThinking();
      return this.getConfigSnapshot();
    }
    const sessionId = this.requireSessionId();
    let result: unknown;
    try {
      result = await this.request(
        "session/set_config_option",
        buildKimiSetConfigOptionParams(sessionId, KIMI_MODEL_CONFIG_ID, advertised),
      );
    } catch (error) {
      throw this.configApplyError(error, "model", advertised, this.getConfigSnapshot().model);
    }
    this.replaceConfigOptions(readKimiConfigOptions(result));
    const confirmed = this.getConfigSnapshot().model;
    if (confirmed !== advertised) {
      throw new KimiProtocolError(
        `model ${JSON.stringify(advertised)} was not confirmed; server currentValue remains ${JSON.stringify(confirmed)}`,
        "model-not-confirmed",
      );
    }
    await this.reapplyRequestedThinking();
    return this.getConfigSnapshot();
  }

  public async setThinkingMode(thinkingMode: string): Promise<KimiConfigSnapshot> {
    this.assertReadyForConfig();
    const option = readKimiConfigOption(this.configOptions, KIMI_THINKING_CONFIG_ID);
    const advertised = assertAdvertisedKimiThinking(thinkingMode, option);
    this.requestedThinkingMode = advertised;
    if (advertised === this.getConfigSnapshot().thinking) {
      return this.getConfigSnapshot();
    }
    const sessionId = this.requireSessionId();
    let result: unknown;
    try {
      result = await this.request(
        "session/set_config_option",
        buildKimiSetConfigOptionParams(sessionId, KIMI_THINKING_CONFIG_ID, advertised),
      );
    } catch (error) {
      throw this.configApplyError(error, "thinking", advertised, this.getConfigSnapshot().thinking);
    }
    this.replaceConfigOptions(readKimiConfigOptions(result));
    const confirmed = this.getConfigSnapshot().thinking;
    if (confirmed !== advertised) {
      throw new KimiProtocolError(
        `thinking ${JSON.stringify(advertised)} was not confirmed; server currentValue remains ${JSON.stringify(confirmed)}`,
        "thinking-not-confirmed",
      );
    }
    return this.getConfigSnapshot();
  }

  public async setMode(modeId: string): Promise<KimiConfigSnapshot> {
    this.assertReadyForConfig();
    const available = this.getConfigSnapshot().modeOptions;
    const requested = String(modeId ?? "").trim();
    if (available.length > 0 && !available.includes(requested)) {
      throw new KimiProtocolError(
        `mode ${JSON.stringify(requested)} is not advertised; available: ${available.join(", ")}`,
        "mode-not-advertised",
      );
    }
    if (requested === this.getConfigSnapshot().modeId) {
      return this.getConfigSnapshot();
    }
    const sessionId = this.requireSessionId();
    let result: unknown;
    try {
      result = await this.request(
        "session/set_config_option",
        buildKimiSetConfigOptionParams(sessionId, KIMI_MODE_CONFIG_ID, requested),
      );
    } catch (error) {
      throw this.configApplyError(error, "mode", requested, this.getConfigSnapshot().modeId);
    }
    this.replaceConfigOptions(readKimiConfigOptions(result));
    this.applyModeState(result);
    const confirmed = this.getConfigSnapshot().modeId;
    if (confirmed !== null && confirmed !== requested) {
      throw new KimiProtocolError(
        `mode ${JSON.stringify(requested)} was not confirmed; server currentValue remains ${JSON.stringify(confirmed)}`,
        "mode-not-confirmed",
      );
    }
    if (confirmed === null) {
      this.currentModeId = requested;
    }
    return this.getConfigSnapshot();
  }

  public dispose(): void {
    if (this.closed) {
      this.stopTimers();
      return;
    }
    this.writeShutdownAttempts();
    this.fail(new KimiProtocolError("Kimi Code runner disposed", "disposed"));
  }

  private hasConfigRevisionChanged(): boolean {
    return this.configRevision !== getKimiCodeConfigRevision(this.options.env);
  }

  private launch(): void {
    const command = (this.options.command ?? KIMI_DEFAULT_COMMAND).trim();
    if (!command) {
      throw new KimiProtocolError("Kimi Code command is empty", "empty-command");
    }
    const launchArgs = buildKimiLaunchArgs(this.options.agentArgs ?? []);
    const resolved = resolveSpawnCommand(command, launchArgs);
    const platform = this.options.platform ?? process.platform;
    this.childEnv = buildKimiChildEnv(this.options.env, process.env);
    const spawnImpl = this.options.spawnImpl ?? defaultKimiSpawn;
    let child: KimiChild;
    try {
      child = spawnImpl(resolved.command, resolved.args, {
        cwd: this.options.cwd,
        env: this.childEnv,
        detached: platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      const spawnError = error instanceof Error ? error : new Error(String(error));
      this.fail(spawnError);
      throw spawnError;
    }
    this.child = child;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.appendStderr(chunk);
    });
    child.once("error", (error) => {
      const processError = error instanceof Error ? error : new Error(String(error));
      this.fail(processError);
    });
    child.once("close", () => {
      this.stopTimers();
      if (!this.closed) {
        const detail = String(child.exitCode ?? child.signalCode ?? "closed");
        const stderr = this.stderrText();
        this.fail(new KimiProtocolError(
          stderr ? `Kimi Code process exited (${detail}): ${stderr}` : `Kimi Code process exited (${detail})`,
          "exited",
        ));
      }
    });
    if (!child.stdout) {
      const error = new KimiProtocolError("Kimi Code stdout is unavailable", "stdio");
      this.fail(error);
      throw error;
    }
    this.reader = createCodexAppServerNdjsonReader(child.stdout);
    void this.readLoop();
  }

  private async openSession(requireResume: boolean, mappedSessionId: string | null): Promise<unknown> {
    if (!mappedSessionId) {
      return this.request("session/new", buildKimiSessionNewParams(this.options.cwd));
    }
    try {
      return await this.request(
        "session/resume",
        buildKimiSessionResumeParams(mappedSessionId, this.options.cwd),
      );
    } catch (error) {
      if (requireResume || this.closed || this.failed) {
        throw error;
      }
      this.lastResumed = false;
      return this.request("session/new", buildKimiSessionNewParams(this.options.cwd));
    }
  }

  private assertProtocolVersion(initialized: unknown): void {
    const record = initialized && typeof initialized === "object"
      ? initialized as { protocolVersion?: unknown }
      : null;
    if (record?.protocolVersion !== KIMI_ACP_PROTOCOL_VERSION) {
      throw new KimiProtocolError(
        "Kimi Code ACP initialize did not confirm protocolVersion 1",
        "protocol-version",
      );
    }
  }

  private assertReadyForConfig(): void {
    if (!this.sessionId || this.closed || this.failed) {
      throw this.failed ?? new KimiProtocolError("Kimi Code session is not ready", "session-not-ready");
    }
  }

  private requireSessionId(): string {
    const sessionId = this.sessionId;
    if (!sessionId) {
      throw new KimiProtocolError("Kimi Code session is not ready", "session-not-ready");
    }
    return sessionId;
  }

  private recheckRequestedThinking(): void {
    if (this.requestedThinkingMode === null) {
      return;
    }
    assertAdvertisedKimiThinking(
      this.requestedThinkingMode,
      readKimiConfigOption(this.configOptions, KIMI_THINKING_CONFIG_ID),
    );
  }

  private async reapplyRequestedThinking(): Promise<void> {
    if (this.requestedThinkingMode === null) {
      return;
    }
    const requested = this.requestedThinkingMode;
    assertAdvertisedKimiThinking(
      requested,
      readKimiConfigOption(this.configOptions, KIMI_THINKING_CONFIG_ID),
    );
    if (requested === this.getConfigSnapshot().thinking) {
      return;
    }
    await this.setThinkingMode(requested);
  }

  private configApplyError(error: unknown, label: string, requested: string, confirmed: string | null): Error {
    if (error instanceof KimiProtocolError && error.code !== "rpc-error" && error.code !== "turn-failed") {
      return error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    return new KimiProtocolError(
      `${label} ${JSON.stringify(requested)} was not applied; confirmed value remains ${JSON.stringify(confirmed)}: ${reason}`,
      error instanceof KimiProtocolError ? error.code : "rpc-error",
      error instanceof KimiProtocolError ? error.rpcCode : undefined,
    );
  }

  private beginTurn(handlers: KimiStreamHandlers): void {
    this.settledHandlers = null;
    this.settledReplayStream?.finish();
    this.settledReplayStream = null;
    for (const messageId of this.textTracker.keys()) {
      this.retiredMessageIds.add(messageId);
    }
    for (const toolCallId of this.toolStates.keys()) {
      this.retiredToolCallIds.add(toolCallId);
    }
    this.textTracker.clear();
    this.toolStates.clear();
    this.lastTaskListSignature = "";
    this.turnEpoch += 1;
    this.activeTurnEpoch = this.turnEpoch;
    this.turnCancelled = false;
    this.turnOpen = true;
    this.activeHandlers = handlers;
    this.replayStream = new KimiReplayStream((message) => handlers.onEvent?.(message));
  }

  private endTurn(epoch: number): void {
    if (this.activeTurnEpoch !== epoch) {
      return;
    }
    this.activeHandlers = null;
    this.turnOpen = false;
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
        const parsed = parseKimiJsonRpcLine(line);
        if (!parsed.ok) {
          if (parsed.reason === "invalid") {
            this.fail(new KimiProtocolError(`Kimi Code protocol frame invalid: ${parsed.error}`, "protocol"));
          }
          continue;
        }
        this.handleMessage(parsed.message);
      }
      if (!this.closed) {
        this.fail(new KimiProtocolError("Kimi Code stdout ended", "exited"));
      }
    } catch (error) {
      if (!this.closed) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleMessage(message: KimiJsonRpcMessage): void {
    if (message.id !== undefined && message.id !== null && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(requestKey(message.id));
      if (!pending) {
        return;
      }
      this.pending.delete(requestKey(message.id));
      if (message.error !== undefined) {
        pending.reject(formatKimiRpcError(message.error));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.id !== null && message.method) {
      void this.answerServerRequest(message);
      return;
    }
    if (message.method === "session/update") {
      this.handleSessionUpdate(message);
    }
  }

  private handleSessionUpdate(message: KimiJsonRpcMessage): void {
    const sessionId = readKimiUpdateSessionId(message);
    if (!sessionId || sessionId !== this.sessionId) {
      return;
    }
    const body = readKimiSessionUpdateBody(message);
    if (!body) {
      return;
    }
    const update = classifyKimiSessionUpdate(body);
    if (this.settledHandlers && !this.turnOpen && !this.turnCancelled) {
      if (update.type === "usage") {
        const usage = readKimiTokenUsageUpdate(update.used, update.size);
        if (usage) {
          this.settledHandlers.onTokenUsageUpdate?.(usage);
        }
        return;
      }
      if (update.type === "assistant_text") {
        const compaction = readKimiCompactionUpdate(update.text);
        if (compaction) {
          this.settledHandlers.onCompactionUpdate?.(compaction);
        }
      }
      this.settledReplayStream?.append(message);
      return;
    }
    if (update.type === "config") {
      this.replaceConfigOptions(update.configOptions);
    }
    if (update.type === "mode") {
      this.currentModeId = update.modeId || this.currentModeId;
      this.activeHandlers?.onModeUpdate?.(update.modeId);
    }
    if (!this.turnOpen || this.turnCancelled || !this.activeHandlers) {
      return;
    }
    const handlers = this.activeHandlers;
    this.replayStream?.append(message);
    handlers.onActivity?.();
    if (update.type === "assistant_text") {
      this.emitText(handlers, "assistant", update.messageId, update.text);
      return;
    }
    if (update.type === "thinking") {
      const delta = this.acceptTurnText(update.messageId || "thinking", update.text);
      if (delta) {
        handlers.onTrace?.(delta, "thinking");
      }
      return;
    }
    if (update.type === "plan") {
      const signature = JSON.stringify(update.items);
      if (signature !== this.lastTaskListSignature) {
        this.lastTaskListSignature = signature;
        handlers.onTaskListUpdate?.(update.items);
      }
      return;
    }
    if (update.type === "tool") {
      this.emitTool(handlers, update);
      return;
    }
    if (update.type === "usage") {
      const usage = readKimiTokenUsageUpdate(update.used, update.size);
      if (usage) {
        handlers.onTokenUsageUpdate?.(usage);
      }
    }
  }

  private emitText(
    handlers: KimiStreamHandlers,
    kind: "assistant" | "thinking",
    messageId: string,
    text: string,
  ): void {
    const delta = this.acceptTurnText(messageId || `turn:${this.activeTurnEpoch}:${kind}`, text);
    if (!delta) {
      return;
    }
    if (kind === "assistant") {
      handlers.onAssistantDelta?.(delta);
    }
  }

  private acceptTurnText(messageId: string, text: string): string | null {
    const key = messageId || `turn:${this.activeTurnEpoch}`;
    if (this.retiredMessageIds.has(key)) {
      return null;
    }
    return acceptKimiIncrementalText(this.textTracker, key, text);
  }

  private emitTool(
    handlers: KimiStreamHandlers,
    update: {
      toolCallId: string;
      title?: string;
      kind?: string;
      status?: string;
      rawInput?: unknown;
      contentText: string;
    },
  ): void {
    if (this.retiredToolCallIds.has(update.toolCallId)) {
      return;
    }
    const projected = projectKimiToolUpdate(this.toolStates.get(update.toolCallId), update);
    this.toolStates.set(update.toolCallId, projected.state);
    if (!projected.trace) {
      return;
    }
    handlers.onTrace?.(this.redactTrace(projected.trace), "tool-use", { toolCallId: update.toolCallId });
  }

  private async answerServerRequest(message: KimiJsonRpcMessage): Promise<void> {
    const method = String(message.method ?? "");
    if (method !== "session/request_permission") {
      this.reply(message.id, undefined, buildKimiMethodNotFoundError(method));
      return;
    }
    const offer = readKimiPermissionOffer(message.params);
    const epoch = this.activeTurnEpoch;
    const handlers = this.activeHandlers;
    let resolution: { result?: unknown; error?: unknown } | null | undefined;
    if (
      !handlers
      || !this.turnOpen
      || this.turnCancelled
      || this.closed
      || offer.sessionId !== this.sessionId
    ) {
      resolution = null;
    } else {
      try {
        resolution = await handlers.onRequest?.({ method, params: message.params });
      } catch (error) {
        resolution = { error: { message: error instanceof Error ? error.message : String(error) } };
      }
    }
    if (
      this.closed
      || this.turnCancelled
      || this.activeTurnEpoch !== epoch
      || this.activeHandlers !== handlers
      || offer.sessionId !== this.sessionId
    ) {
      resolution = null;
    }
    // Plan mode must never be bypassed: only non-plan turns may auto-approve.
    const decision = resolveKimiPermissionDecision(resolution, offer, {
      allowTools: this.currentModeId !== "plan",
    });
    this.reply(message.id, buildKimiPermissionResult(decision));
  }

  private reply(id: unknown, result?: unknown, error?: unknown): void {
    if (!this.canWrite()) {
      return;
    }
    if (error !== undefined) {
      this.write({ jsonrpc: "2.0", id, error });
      return;
    }
    this.write({ jsonrpc: "2.0", id, result });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.failed || this.closed) {
      return Promise.reject(this.failed ?? new KimiProtocolError("Kimi Code runner is closed", "closed"));
    }
    const id = this.nextId;
    this.nextId += 1;
    const key = requestKey(id);
    return new Promise((resolve, reject) => {
      this.pending.set(key, { method, resolve, reject });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: Record<string, unknown>): void {
    const forbidden = findKimiForbiddenWire(message);
    if (forbidden) {
      throw new KimiProtocolError(`refusing forbidden ACP wire ${forbidden}`, "forbidden-method");
    }
    if (!this.canWrite() || !this.child?.stdin) {
      throw new KimiProtocolError("Kimi Code stdin is unavailable", "stdin");
    }
    this.child.stdin.write(serializeCodexAppServerMessage(message));
  }

  private writeShutdownAttempts(): void {
    if (!this.sessionId || !this.canWrite()) {
      return;
    }
    try {
      this.write({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: buildKimiSessionCancelParams(this.sessionId),
      });
    } catch {
      return;
    }
    try {
      this.write({
        jsonrpc: "2.0",
        id: this.nextId,
        method: "session/close",
        params: buildKimiSessionCloseParams(this.sessionId),
      });
      this.nextId += 1;
    } catch {
      // Closing stdin still proceeds after a failed close write.
    }
  }

  private canWrite(): boolean {
    const stdin = this.child?.stdin;
    return Boolean(stdin && !stdin.destroyed && !stdin.writableEnded && !this.closed);
  }

  private replaceConfigOptions(options: KimiConfigOption[]): void {
    if (options.length === 0) {
      return;
    }
    this.configOptions = options;
    const mode = readKimiConfigOption(options, KIMI_MODE_CONFIG_ID);
    if (mode?.currentValue) {
      this.currentModeId = mode.currentValue;
    }
  }

  private applyModeState(source: unknown): void {
    const state = readKimiModeState(source);
    if (state.available.length > 0) {
      this.modeOptions = state.available;
    }
    if (state.currentModeId) {
      this.currentModeId = state.currentModeId;
    }
  }

  private appendStderr(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.stderrTextBuffer = boundKimiDiagnostic(
      redactKimiDiagnostic(this.stderrTextBuffer + text, this.childEnv),
      KIMI_STDERR_REPORT_LIMIT,
    );
  }

  private stderrText(): string {
    return this.stderrTextBuffer.trim();
  }

  private redactTrace(text: string): string {
    return boundKimiDiagnostic(redactKimiDiagnostic(text, this.childEnv), KIMI_STDERR_REPORT_LIMIT);
  }

  private fail(error: Error): void {
    if (this.closed) {
      this.stopTimers();
      return;
    }
    this.failed = this.failed ?? error;
    this.closed = true;
    this.turnCancelled = true;
    this.turnOpen = false;
    this.activeHandlers = null;
    this.settledHandlers = null;
    this.settledReplayStream?.finish();
    this.settledReplayStream = null;
    this.promptInFlight = false;
    this.stopTimers();
    this.reader?.close();
    for (const pending of this.pending.values()) {
      pending.reject(this.failed);
    }
    this.pending.clear();
    this.shutdownChild();
  }

  private shutdownChild(): void {
    const child = this.child;
    if (!child || this.shutdownStarted) {
      return;
    }
    this.shutdownStarted = true;
    try {
      if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.end();
      }
    } catch {
      // Signal escalation still runs when stdin is already closed.
    }
    const platform = this.options.platform ?? process.platform;
    const killTree = this.options.killTreeImpl ?? ((target, signal) => killProcessTree(target as ChildProcess, signal));
    if (isChildSettled(child)) {
      return;
    }
    const initial = planKimiProcessTreeStop(platform, child.pid ?? 0, "initial");
    if (!initial) {
      return;
    }
    if (initial.kind === "taskkill") {
      killTree(child, "SIGKILL");
      return;
    }
    killTree(child, initial.signal);
    if (isChildSettled(child)) {
      return;
    }
    const timer = setTimeout(() => {
      if (!isChildSettled(child)) {
        const escalate = planKimiProcessTreeStop(platform, child.pid ?? 0, "escalate");
        if (escalate?.kind === "signal") {
          killTree(child, escalate.signal);
        }
      }
    }, this.options.shutdownGraceMs ?? KIMI_SHUTDOWN_GRACE_MS);
    timer.unref?.();
    this.shutdownTimers.push(timer);
  }

  private stopTimers(): void {
    for (const timer of this.shutdownTimers) {
      clearTimeout(timer);
    }
    this.shutdownTimers.length = 0;
  }
}

function requestKey(id: unknown): string {
  return typeof id === "number" ? `#n:${id}` : `#s:${String(id)}`;
}

function isChildSettled(child: KimiChild): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function defaultKimiSpawn(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    windowsHide?: boolean;
  },
): KimiChild {
  return spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: options.detached,
    windowsHide: options.windowsHide,
    stdio: ["pipe", "pipe", "pipe"],
  }) as KimiChild;
}
