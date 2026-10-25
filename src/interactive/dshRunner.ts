import type { ChildProcess } from "child_process";
import type { Readable } from "stream";
import { spawn } from "cross-spawn";
import {
  createCodexAppServerNdjsonReader,
  serializeCodexAppServerMessage,
  type CodexAppServerNdjsonReader,
} from "./codexAppServerNdjson";
import { killProcessTree } from "./codexRunnerProcess";
import { resolveSpawnCommand } from "./codexRunnerProcess";
import {
  acceptDshIncrementalText,
  assertAdvertisedDshModel,
  assertAdvertisedDshReasoning,
  boundDshDiagnostic,
  buildDshChildEnv,
  buildDshInitializeParams,
  buildDshLaunchArgs,
  buildDshMethodNotFoundError,
  buildDshPermissionResult,
  buildDshSessionCancelParams,
  buildDshSessionCloseParams,
  buildDshSessionNewParams,
  buildDshSessionPromptParams,
  buildDshSessionResumeParams,
  buildDshSetConfigOptionParams,
  classifyDshSessionUpdate,
  DshCompactionUnsupportedError,
  DshProtocolError,
  DSH_ACP_PROTOCOL_VERSION,
  DSH_DEFAULT_COMMAND,
  DSH_MODEL_CONFIG_ID,
  DSH_REASONING_CONFIG_ID,
  DSH_SHUTDOWN_GRACE_MS,
  DSH_STDERR_REPORT_LIMIT,
  findDshForbiddenWire,
  formatDshRpcError,
  isDshResumableSessionId,
  parseDshJsonRpcLine,
  planDshProcessTreeStop,
  projectDshToolUpdate,
  readDshConfigOption,
  readDshConfigOptions,
  readDshPermissionOffer,
  readDshPromptStopReason,
  readDshSessionId,
  readDshSessionUpdateBody,
  readDshTokenUsageUpdate,
  readDshUpdateSessionId,
  redactDshDiagnostic,
  resolveDshPermissionDecision,
  type DshConfigOption,
  type DshJsonRpcMessage,
  type DshTokenUsageUpdate,
  type DshToolProjection,
} from "./dshAppServerProtocol";

export {
  DshCompactionUnsupportedError,
  DshProtocolError,
  type DshConfigOption,
  type DshTokenUsageUpdate,
};

export type DshChild = {
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

export type DshSpawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    windowsHide?: boolean;
  },
) => DshChild;

export type DshKillTree = (child: DshChild, signal: NodeJS.Signals | number) => boolean;

export type DshTraceKind = "thinking" | "normal" | "tool-use" | "error";

export type DshStreamHandlers = {
  onRequest?: (request: { method: string; params?: unknown }) =>
    | Promise<{ result?: unknown; error?: unknown } | null | undefined>
    | { result?: unknown; error?: unknown }
    | null
    | undefined;
  onAssistantDelta?: (text: string) => void;
  onTrace?: (content: string, kind?: DshTraceKind, meta?: { toolCallId?: string }) => void;
  onEvent?: (message: DshJsonRpcMessage) => void;
  onActivity?: () => void;
  onComplete?: (meta: { stopReason: string }) => void;
  onTokenUsageUpdate?: (update: DshTokenUsageUpdate) => void;
};

export type DshRunnerOptions = {
  cwd: string;
  command?: string;
  agentArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  model?: string | null;
  thinkingMode?: string | null;
  localSessionId?: string | null;
  spawnImpl?: DshSpawn;
  killTreeImpl?: DshKillTree;
  platform?: NodeJS.Platform;
  shutdownGraceMs?: number;
};

export type DshStartOptions = {
  requireResume?: boolean;
};

export type DshSessionInfo = {
  acpSessionId: string;
  resumed: boolean;
  retainedLocalSessionId: string | null;
};

export type DshPromptResult = {
  stopReason: string;
};

export type DshConfigSnapshot = {
  model: string | null;
  reasoningEffort: string | null;
  modelOptions: string[];
  reasoningOptions: string[];
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class DshInteractiveRunner {
  private child: DshChild | null = null;
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
  private activeHandlers: DshStreamHandlers | null = null;
  private turnOpen = false;
  private configOptions: DshConfigOption[] = [];
  private requestedThinkingMode: string | null = null;
  private readonly textTracker = new Map<string, string>();
  private readonly toolStates = new Map<string, DshToolProjection>();
  private readonly retiredMessageIds = new Set<string>();
  private readonly retiredToolCallIds = new Set<string>();
  private readonly shutdownTimers: NodeJS.Timeout[] = [];
  private stderrTextBuffer = "";
  private childEnv: NodeJS.ProcessEnv = {};

  public constructor(private readonly options: DshRunnerOptions) {}

  public isReusable(): boolean {
    return !this.closed && !this.failed;
  }

  public getSessionInfo(): DshSessionInfo | null {
    if (!this.sessionId) {
      return null;
    }
    return {
      acpSessionId: this.sessionId,
      resumed: this.lastResumed,
      retainedLocalSessionId: this.retainedLocalSessionId,
    };
  }

  public getConfigSnapshot(): DshConfigSnapshot {
    const model = readDshConfigOption(this.configOptions, DSH_MODEL_CONFIG_ID);
    const reasoning = readDshConfigOption(this.configOptions, DSH_REASONING_CONFIG_ID);
    return {
      model: model?.currentValue ?? null,
      reasoningEffort: reasoning?.currentValue ?? null,
      modelOptions: model?.values ?? [],
      reasoningOptions: reasoning?.values ?? [],
    };
  }

  public async start(options: DshStartOptions = {}): Promise<DshSessionInfo> {
    if (this.sessionId && this.child && this.isReusable()) {
      return {
        acpSessionId: this.sessionId,
        resumed: true,
        retainedLocalSessionId: this.retainedLocalSessionId,
      };
    }
    if (this.closed || this.failed) {
      throw this.failed ?? new DshProtocolError("DSH runner is closed", "closed");
    }
    const requireResume = options.requireResume === true;
    const mappedSessionId = isDshResumableSessionId(this.options.localSessionId)
      ? String(this.options.localSessionId).trim()
      : null;
    if (requireResume && !mappedSessionId) {
      throw new DshProtocolError(
        "DSH resume requires an existing ACP session id and will not create a new session",
        "resume-required",
      );
    }
    this.launch();
    try {
      const initialized = await this.request("initialize", buildDshInitializeParams());
      this.assertProtocolVersion(initialized);
      const created = await this.openSession(requireResume, mappedSessionId);
      const returnedSessionId = readDshSessionId(created);
      // session/resume on 0.2.1-rc.2 can succeed with configOptions and no
      // repeated sessionId. Keep the requested id. A different id still fails.
      const acpSessionId = returnedSessionId ?? (requireResume ? mappedSessionId : null);
      if (!acpSessionId || (requireResume && acpSessionId !== mappedSessionId)) {
        throw new DshProtocolError("DSH session id was not confirmed", "session-id");
      }
      this.sessionId = acpSessionId;
      this.retainedLocalSessionId = String(this.options.localSessionId ?? "").trim() || null;
      this.lastResumed = mappedSessionId !== null && acpSessionId === mappedSessionId;
      this.replaceConfigOptions(readDshConfigOptions(created));
      if (this.options.model) {
        await this.setModel(this.options.model);
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

  public async prompt(text: string, handlers: DshStreamHandlers = {}): Promise<DshPromptResult> {
    if (typeof text !== "string" || text.trim() === "") {
      throw new DshProtocolError("DSH prompt text is empty", "empty-prompt");
    }
    if (!this.sessionId || this.closed || this.failed) {
      throw this.failed ?? new DshProtocolError("DSH session is not ready", "session-not-ready");
    }
    if (this.promptInFlight) {
      throw new DshProtocolError("a DSH prompt is already in flight", "concurrent-prompt");
    }
    this.promptInFlight = true;
    this.beginTurn(handlers);
    const epoch = this.turnEpoch;
    try {
      const result = await this.request("session/prompt", buildDshSessionPromptParams(this.sessionId, text));
      const stopReason = readDshPromptStopReason(result);
      if (!stopReason) {
        throw new DshProtocolError("session/prompt completed without stopReason", "missing-stop-reason");
      }
      this.turnOpen = false;
      if (this.activeTurnEpoch === epoch) {
        handlers.onComplete?.({ stopReason });
      }
      return { stopReason };
    } finally {
      this.turnOpen = false;
      this.endTurn(epoch);
      this.promptInFlight = false;
    }
  }

  public cancelTurn(): void {
    this.turnCancelled = true;
    this.turnOpen = false;
    if (!this.sessionId || !this.canWrite()) {
      return;
    }
    this.write({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: buildDshSessionCancelParams(this.sessionId),
    });
  }

  public async compactSession(): Promise<never> {
    throw new DshCompactionUnsupportedError();
  }

  public async setModel(modelWireValue: string): Promise<DshConfigSnapshot> {
    this.assertReadyForConfig();
    const advertised = this.getConfigSnapshot().modelOptions;
    assertAdvertisedDshModel(modelWireValue, advertised);
    if (modelWireValue === this.getConfigSnapshot().model) {
      this.recheckRequestedThinking();
      return this.getConfigSnapshot();
    }
    const sessionId = this.sessionId;
    if (!sessionId) {
      throw new DshProtocolError("DSH session is not ready", "session-not-ready");
    }
    let result: unknown;
    try {
      result = await this.request(
        "session/set_config_option",
        buildDshSetConfigOptionParams(sessionId, DSH_MODEL_CONFIG_ID, modelWireValue),
      );
    } catch (error) {
      throw this.configApplyError(error, "model", modelWireValue, this.getConfigSnapshot().model);
    }
    this.replaceConfigOptions(readDshConfigOptions(result));
    const confirmed = this.getConfigSnapshot().model;
    if (confirmed !== modelWireValue) {
      throw new DshProtocolError(
        `model ${JSON.stringify(modelWireValue)} was not confirmed; server currentValue remains ${JSON.stringify(confirmed)}`,
        "model-not-confirmed",
      );
    }
    await this.reapplyRequestedThinking();
    return this.getConfigSnapshot();
  }

  public async setThinkingMode(thinkingMode: string): Promise<DshConfigSnapshot> {
    this.assertReadyForConfig();
    const advertised = this.getConfigSnapshot().reasoningOptions;
    assertAdvertisedDshReasoning(thinkingMode, advertised);
    this.requestedThinkingMode = thinkingMode;
    if (thinkingMode === this.getConfigSnapshot().reasoningEffort) {
      return this.getConfigSnapshot();
    }
    const sessionId = this.sessionId;
    if (!sessionId) {
      throw new DshProtocolError("DSH session is not ready", "session-not-ready");
    }
    let result: unknown;
    try {
      result = await this.request(
        "session/set_config_option",
        buildDshSetConfigOptionParams(sessionId, DSH_REASONING_CONFIG_ID, thinkingMode),
      );
    } catch (error) {
      throw this.configApplyError(
        error,
        "reasoning effort",
        thinkingMode,
        this.getConfigSnapshot().reasoningEffort,
      );
    }
    this.replaceConfigOptions(readDshConfigOptions(result));
    const confirmed = this.getConfigSnapshot().reasoningEffort;
    if (confirmed !== thinkingMode) {
      throw new DshProtocolError(
        `reasoning effort ${JSON.stringify(thinkingMode)} was not confirmed; server currentValue remains ${JSON.stringify(confirmed)}`,
        "reasoning-not-confirmed",
      );
    }
    return this.getConfigSnapshot();
  }

  public dispose(): void {
    if (this.closed) {
      this.stopTimers();
      return;
    }
    this.writeShutdownAttempts();
    this.fail(new DshProtocolError("DSH runner disposed", "disposed"));
  }

  private launch(): void {
    const command = (this.options.command ?? DSH_DEFAULT_COMMAND).trim();
    if (!command) {
      throw new DshProtocolError("DSH command is empty", "empty-command");
    }
    const launchArgs = buildDshLaunchArgs(this.options.agentArgs ?? []);
    const resolved = resolveSpawnCommand(command, launchArgs);
    const platform = this.options.platform ?? process.platform;
    this.childEnv = buildDshChildEnv(this.options.env, process.env);
    const spawnImpl = this.options.spawnImpl ?? defaultDshSpawn;
    let child: DshChild;
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
        this.fail(new DshProtocolError(
          stderr ? `DSH process exited (${detail}): ${stderr}` : `DSH process exited (${detail})`,
          "exited",
        ));
      }
    });
    if (!child.stdout) {
      const error = new DshProtocolError("DSH stdout is unavailable", "stdio");
      this.fail(error);
      throw error;
    }
    this.reader = createCodexAppServerNdjsonReader(child.stdout);
    void this.readLoop();
  }

  private async openSession(requireResume: boolean, mappedSessionId: string | null): Promise<unknown> {
    if (!mappedSessionId) {
      return this.request("session/new", buildDshSessionNewParams(this.options.cwd));
    }
    try {
      return await this.request(
        "session/resume",
        buildDshSessionResumeParams(mappedSessionId, this.options.cwd),
      );
    } catch (error) {
      if (requireResume || this.closed || this.failed) {
        throw error;
      }
      this.lastResumed = false;
      return this.request("session/new", buildDshSessionNewParams(this.options.cwd));
    }
  }

  private assertProtocolVersion(initialized: unknown): void {
    const record = initialized && typeof initialized === "object"
      ? initialized as { protocolVersion?: unknown }
      : null;
    if (record?.protocolVersion !== DSH_ACP_PROTOCOL_VERSION) {
      throw new DshProtocolError("DSH ACP initialize did not confirm protocolVersion 1", "protocol-version");
    }
  }

  private assertReadyForConfig(): void {
    if (!this.sessionId || this.closed || this.failed) {
      throw this.failed ?? new DshProtocolError("DSH session is not ready", "session-not-ready");
    }
  }

  private recheckRequestedThinking(): void {
    if (this.requestedThinkingMode === null) {
      return;
    }
    assertAdvertisedDshReasoning(this.requestedThinkingMode, this.getConfigSnapshot().reasoningOptions);
  }

  private async reapplyRequestedThinking(): Promise<void> {
    if (this.requestedThinkingMode === null) {
      return;
    }
    const requested = this.requestedThinkingMode;
    assertAdvertisedDshReasoning(requested, this.getConfigSnapshot().reasoningOptions);
    if (requested === this.getConfigSnapshot().reasoningEffort) {
      return;
    }
    await this.setThinkingMode(requested);
  }

  private configApplyError(error: unknown, label: string, requested: string, confirmed: string | null): Error {
    if (error instanceof DshProtocolError && error.code !== "rpc-error" && error.code !== "turn-failed") {
      return error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    return new DshProtocolError(
      `${label} ${JSON.stringify(requested)} was not applied; confirmed value remains ${JSON.stringify(confirmed)}: ${reason}`,
      error instanceof DshProtocolError ? error.code : "rpc-error",
      error instanceof DshProtocolError ? error.rpcCode : undefined,
    );
  }

  private beginTurn(handlers: DshStreamHandlers): void {
    for (const messageId of this.textTracker.keys()) {
      this.retiredMessageIds.add(messageId);
    }
    for (const toolCallId of this.toolStates.keys()) {
      this.retiredToolCallIds.add(toolCallId);
    }
    this.textTracker.clear();
    this.toolStates.clear();
    this.turnEpoch += 1;
    this.activeTurnEpoch = this.turnEpoch;
    this.turnCancelled = false;
    this.turnOpen = true;
    this.activeHandlers = handlers;
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
        const parsed = parseDshJsonRpcLine(line);
        if (!parsed.ok) {
          if (parsed.reason === "invalid") {
            this.fail(new DshProtocolError(`DSH protocol frame invalid: ${parsed.error}`, "protocol"));
          }
          continue;
        }
        this.handleMessage(parsed.message);
      }
      if (!this.closed) {
        this.fail(new DshProtocolError("DSH stdout ended", "exited"));
      }
    } catch (error) {
      if (!this.closed) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleMessage(message: DshJsonRpcMessage): void {
    if (message.id !== undefined && message.id !== null && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(requestKey(message.id));
      if (!pending) {
        return;
      }
      this.pending.delete(requestKey(message.id));
      if (message.error !== undefined) {
        pending.reject(formatDshRpcError(message.error));
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

  private handleSessionUpdate(message: DshJsonRpcMessage): void {
    const sessionId = readDshUpdateSessionId(message);
    if (!sessionId || sessionId !== this.sessionId) {
      return;
    }
    const body = readDshSessionUpdateBody(message);
    if (!body) {
      return;
    }
    const update = classifyDshSessionUpdate(body);
    if (update.type === "config") {
      this.replaceConfigOptions(update.configOptions);
    }
    if (!this.turnOpen || this.turnCancelled || !this.activeHandlers) {
      return;
    }
    const handlers = this.activeHandlers;
    handlers.onEvent?.(message);
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
    if (update.type === "tool") {
      this.emitTool(handlers, update);
      return;
    }
    if (update.type === "usage") {
      const usage = readDshTokenUsageUpdate(update.used, update.size);
      if (usage) {
        handlers.onTokenUsageUpdate?.(usage);
      }
    }
  }

  private emitText(
    handlers: DshStreamHandlers,
    kind: "assistant" | "thinking",
    messageId: string,
    text: string,
  ): void {
    const delta = this.acceptTurnText(messageId || kind, text);
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
    return acceptDshIncrementalText(this.textTracker, key, text);
  }

  private emitTool(
    handlers: DshStreamHandlers,
    update: { toolCallId: string; title?: string; status?: string; contentText: string },
  ): void {
    if (this.retiredToolCallIds.has(update.toolCallId)) {
      return;
    }
    const projected = projectDshToolUpdate(this.toolStates.get(update.toolCallId), update);
    this.toolStates.set(update.toolCallId, projected.state);
    if (!projected.trace) {
      return;
    }
    handlers.onTrace?.(this.redactTrace(projected.trace), "tool-use", { toolCallId: update.toolCallId });
  }

  private async answerServerRequest(message: DshJsonRpcMessage): Promise<void> {
    const method = String(message.method ?? "");
    if (method !== "session/request_permission") {
      this.reply(message.id, undefined, buildDshMethodNotFoundError(method));
      return;
    }
    const offer = readDshPermissionOffer(message.params);
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
    const decision = resolveDshPermissionDecision(resolution, offer.optionIds);
    this.reply(message.id, buildDshPermissionResult(decision));
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
      return Promise.reject(this.failed ?? new DshProtocolError("DSH runner is closed", "closed"));
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
    const forbidden = findDshForbiddenWire(message);
    if (forbidden) {
      throw new DshProtocolError(`refusing forbidden ACP wire ${forbidden}`, "forbidden-method");
    }
    if (!this.canWrite() || !this.child?.stdin) {
      throw new DshProtocolError("DSH stdin is unavailable", "stdin");
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
        params: buildDshSessionCancelParams(this.sessionId),
      });
    } catch {
      return;
    }
    try {
      this.write({
        jsonrpc: "2.0",
        id: this.nextId,
        method: "session/close",
        params: buildDshSessionCloseParams(this.sessionId),
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

  private replaceConfigOptions(options: DshConfigOption[]): void {
    if (options.length === 0) {
      return;
    }
    this.configOptions = options;
  }

  private appendStderr(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.stderrTextBuffer = boundDshDiagnostic(
      redactDshDiagnostic(this.stderrTextBuffer + text, this.childEnv),
      DSH_STDERR_REPORT_LIMIT,
    );
  }

  private stderrText(): string {
    return this.stderrTextBuffer.trim();
  }

  private redactTrace(text: string): string {
    return boundDshDiagnostic(redactDshDiagnostic(text, this.childEnv), DSH_STDERR_REPORT_LIMIT);
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
    const initial = planDshProcessTreeStop(platform, child.pid ?? 0, "initial");
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
        const escalate = planDshProcessTreeStop(platform, child.pid ?? 0, "escalate");
        if (escalate?.kind === "signal") {
          killTree(child, escalate.signal);
        }
      }
    }, this.options.shutdownGraceMs ?? DSH_SHUTDOWN_GRACE_MS);
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

function isChildSettled(child: DshChild): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function defaultDshSpawn(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    windowsHide?: boolean;
  },
): DshChild {
  return spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: options.detached,
    windowsHide: options.windowsHide,
    stdio: ["pipe", "pipe", "pipe"],
  }) as DshChild;
}
