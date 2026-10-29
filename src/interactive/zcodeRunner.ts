import type { ChildProcess } from "child_process";
import type { Readable } from "stream";
import { spawn } from "cross-spawn";
import {
  createCodexAppServerNdjsonReader,
  serializeCodexAppServerMessage,
  type CodexAppServerNdjsonReader,
} from "./codexAppServerNdjson";
import { killProcessTree, resolveSpawnCommand } from "./codexRunnerProcess";
import {
  assertAdvertisedZcodeThought,
  buildZcodeChildEnv,
  buildZcodeLaunchArgs,
  buildZcodeModelSelection,
  buildZcodeSessionModelSettings,
  buildZcodeRuntimePreferences,
  buildZcodeWorkspace,
  isZcodeSessionId,
  parseZcodeModelRef,
  parseZcodeWireLine,
  readZcodeContextUsage,
  readZcodeRecord,
  readZcodeSessionEvent,
  readZcodeSessionId,
  readZcodeSettings,
  readZcodeSnapshot,
  readZcodeTextDelta,
  readZcodeTurnFailure,
  redactZcodeDiagnostic,
  selectZcodeAllowOption,
  ZCODE_APPROVAL_MODE,
  ZCODE_DEFAULT_COMMAND,
  ZCODE_DELIVERY_KIND,
  ZCODE_PLAN_MODE,
  ZCODE_SHUTDOWN_GRACE_MS,
  ZCODE_STDERR_REPORT_LIMIT,
  ZcodeProtocolError,
  type ZcodeContextUsage,
  type ZcodeModelRef,
  type ZcodeSessionEvent,
  type ZcodeSettingsView,
  type ZcodeWireMessage,
} from "./zcodeAppServerProtocol";
import { ZcodeToolTraceProjector } from "./zcodeTrace";

export type ZcodeChild = {
  stdin: { write: (chunk: string) => unknown; end: () => unknown } | null;
  stdout: Readable | null;
  stderr: Readable | null;
  pid?: number;
  killed?: boolean;
  exitCode: number | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  once: (event: "exit" | "error", listener: (...args: unknown[]) => void) => unknown;
};

export type ZcodeSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: "pipe" },
) => ZcodeChild;

export type ZcodeStreamHandlers = {
  onAssistantDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  onTrace?: (text: string, kind?: "tool-use" | "error" | "status", meta?: { toolCallId?: string }) => void;
  onTokenUsageUpdate?: (usage: ZcodeContextUsage) => void;
  onActivity?: () => void;
};

export type ZcodeRunnerOptions = {
  cwd: string;
  command?: string;
  agentArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  model?: string | null;
  thinkingMode?: string | null;
  modeId?: string | null;
  localSessionId?: string | null;
  spawnImpl?: ZcodeSpawn;
  killTreeImpl?: (child: ZcodeChild, signal: NodeJS.Signals) => void;
};

export type ZcodeStartResult = {
  sessionId: string;
  resumed: boolean;
  settings: ZcodeSettingsView;
  usage: ZcodeContextUsage | null;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class ZcodeInteractiveRunner {
  private child: ZcodeChild | null = null;
  private reader: CodexAppServerNdjsonReader | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly traceProjector = new ZcodeToolTraceProjector();
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized = false;
  private closed = false;
  private failed: Error | null = null;
  private settings: ZcodeSettingsView = {
    model: null,
    modelOptions: [],
    thinking: null,
    thinkingOptions: [],
    thinkingEnabled: false,
    modeId: null,
  };
  private turnWait: {
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    handlers: ZcodeStreamHandlers;
    text: string;
  } | null = null;
  private compactWait: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private stderrText = "";
  private readonly readLoop: Promise<void> | null = null;

  public constructor(private readonly options: ZcodeRunnerOptions) {
    void this.readLoop;
  }

  public isReusable(): boolean {
    return Boolean(this.initialized && this.child && !this.closed && !this.failed && this.sessionId);
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public getSettings(): ZcodeSettingsView {
    return this.settings;
  }

  public async start(): Promise<ZcodeStartResult> {
    if (this.failed || this.closed) {
      throw this.failed ?? new ZcodeProtocolError("ZCode runner disposed.", "disposed");
    }
    if (this.sessionId && this.isReusable()) {
      return {
        sessionId: this.sessionId,
        resumed: true,
        settings: this.settings,
        usage: await this.readUsage(),
      };
    }
    if (this.child) {
      throw new ZcodeProtocolError("ZCode runner is already started.", "lifecycle");
    }
    const command = this.options.command?.trim() || ZCODE_DEFAULT_COMMAND;
    const args = buildZcodeLaunchArgs(this.options.agentArgs ?? []);
    const spawnImpl = this.options.spawnImpl ?? defaultSpawn;
    const child = spawnImpl(command, args, {
      cwd: this.options.cwd,
      env: buildZcodeChildEnv(this.options.env ?? process.env),
      stdio: "pipe",
    });
    this.child = child;
    child.once("error", (error) => {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    });
    child.once("exit", (code) => {
      if (!this.closed) {
        this.fail(new ZcodeProtocolError(`ZCode exited (${String(code ?? "signal")}).`, "exit"));
      }
    });
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer | string) => {
        this.stderrText = redactZcodeDiagnostic(`${this.stderrText}${chunk.toString()}`).slice(-ZCODE_STDERR_REPORT_LIMIT);
      });
    }
    if (!child.stdout) {
      throw new ZcodeProtocolError("ZCode stdout is unavailable.", "spawn");
    }
    this.reader = createCodexAppServerNdjsonReader(child.stdout);
    void this.consume(this.reader);
    const resumeId = isZcodeSessionId(this.options.localSessionId) ? this.options.localSessionId : null;
    const workspace = buildZcodeWorkspace(this.options.cwd);
    const model = this.options.model?.trim() ? parseZcodeModelRef(this.options.model.trim()) : null;
    const mode = this.options.modeId === ZCODE_PLAN_MODE ? ZCODE_PLAN_MODE : ZCODE_APPROVAL_MODE;
    let resumed = false;
    let result: unknown;
    if (resumeId) {
      try {
        result = await this.request("session/resume", {
          sessionId: resumeId,
          workspace,
        });
        resumed = true;
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    } else {
      result = await this.request("session/create", {
        workspace,
        mode,
        persistence: "immediate",
        titleGenerationEnabled: false,
        ...buildZcodeSessionModelSettings(model),
      });
    }
    const snapshot = readZcodeSnapshot(result);
    this.sessionId = readZcodeSessionId(snapshot);
    this.settings = readZcodeSettings(snapshot);
    await this.request("session/subscribe", {
      sessionId: this.sessionId,
      deliveryKind: ZCODE_DELIVERY_KIND,
      includeSnapshot: false,
    });
    if (this.settings.modeId !== mode) {
      await this.request("session/setMode", { sessionId: this.sessionId, mode });
      this.settings = { ...this.settings, modeId: mode };
    }
    if (model) {
      await this.applyModel(model);
    }
    this.initialized = true;
    return {
      sessionId: this.sessionId,
      resumed,
      settings: this.settings,
      usage: readZcodeContextUsage(snapshot),
    };
  }

  public async prompt(content: string, handlers: ZcodeStreamHandlers = {}): Promise<{ text: string; usage: ZcodeContextUsage | null }> {
    if (!this.sessionId) {
      throw new ZcodeProtocolError("ZCode session is not started.", "session");
    }
    if (this.turnWait || this.compactWait) {
      throw new ZcodeProtocolError("ZCode already has an active prompt.", "busy");
    }
    this.traceProjector.beginTurn();
    const turnCompleted = new Promise<string>((resolve, reject) => {
      this.turnWait = { resolve, reject, handlers, text: "" };
    });
    try {
      const [, text] = await Promise.all([
        this.request("session/send", { sessionId: this.sessionId, content }).then((result) => {
          const accepted = result && typeof result === "object" && (result as { accepted?: unknown }).accepted === true;
          if (!accepted) {
            throw new ZcodeProtocolError("ZCode did not accept the prompt.", "send");
          }
        }),
        turnCompleted,
      ]);
      const usage = await this.readUsage();
      if (usage) {
        handlers.onTokenUsageUpdate?.(usage);
      }
      return { text, usage };
    } catch (error) {
      this.turnWait = null;
      throw error;
    }
  }

  public async setThoughtLevel(value: string): Promise<void> {
    if (!this.sessionId) {
      throw new ZcodeProtocolError("ZCode session is not started.", "session");
    }
    const thought = assertAdvertisedZcodeThought(value, this.settings.thinkingOptions);
    const result = await this.request("session/setThoughtLevel", { sessionId: this.sessionId, thoughtLevel: thought, persistAsWorkspaceLastUsed: false });
    this.settings = { ...this.settings, thinking: thought, thinkingEnabled: true };
    this.updateSettingsFromResult(result);
    if (this.settings.thinking !== thought) {
      throw new ZcodeProtocolError(`ZCode did not apply reasoning level ${thought}.`, "thinking");
    }
  }

  public async setModel(value: string, thinkingMode: string | null = null): Promise<void> {
    if (!this.sessionId) {
      throw new ZcodeProtocolError("ZCode session is not started.", "session");
    }
    await this.applyModel(parseZcodeModelRef(value), thinkingMode);
  }

  public async compact(instructions?: string): Promise<{ state: "accepted" | "already_running"; usage: ZcodeContextUsage | null }> {
    if (!this.sessionId) {
      throw new ZcodeProtocolError("ZCode session is not started.", "session");
    }
    if (this.turnWait || this.compactWait) {
      throw new ZcodeProtocolError("ZCode already has an active turn.", "busy");
    }
    const completed = new Promise<void>((resolve, reject) => {
      this.compactWait = { resolve, reject };
    });
    try {
      const [state] = await Promise.all([
        this.request("session/compact", {
          sessionId: this.sessionId,
          ...(instructions?.trim() ? { instructions: instructions.trim() } : {}),
        }).then((result) => {
          const compact = readZcodeRecord(readZcodeRecord(result)?.compact);
          const state = compact?.state;
          if (state !== "accepted" && state !== "already_running") {
            throw new ZcodeProtocolError("ZCode did not accept native compaction.", "compaction");
          }
          return state;
        }),
        completed,
      ]);
      return { state, usage: await this.readUsage() };
    } finally {
      this.compactWait = null;
    }
  }

  public cancelTurn(): void {
    const error = new ZcodeProtocolError("ZCode turn was stopped.", "stopped");
    this.turnWait?.reject(error);
    this.turnWait = null;
    this.compactWait?.reject(error);
    this.compactWait = null;
    if (!this.sessionId || !this.child?.stdin) {
      return;
    }
    const id = this.nextId;
    this.nextId += 1;
    this.child.stdin.write(serializeCodexAppServerMessage({
      id,
      method: "session/stop",
      params: { sessionId: this.sessionId },
    }));
  }

  public async dispose(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const sessionId = this.sessionId;
    if (sessionId && this.child?.stdin) {
      try {
        await this.request("session/close", { sessionId });
      } catch {
        // The process is still torn down below.
      }
    }
    this.rejectAll(new ZcodeProtocolError("ZCode runner disposed.", "disposed"));
    const child = this.child;
    this.child = null;
    this.reader?.close();
    if (!child) {
      return;
    }
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    const kill = this.options.killTreeImpl ?? ((target, signal) => {
      killProcessTree(target as unknown as ChildProcess, signal);
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        kill(child, "SIGKILL");
        resolve();
      }, ZCODE_SHUTDOWN_GRACE_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      kill(child, "SIGTERM");
    });
  }

  private async applyModel(model: ZcodeModelRef, thinkingMode = this.options.thinkingMode): Promise<void> {
    const requestedThought = thinkingMode?.trim();
    const modelId = `${model.providerId}/${model.modelId}`;
    const reasoningLevel = this.settings.model === modelId
      ? [requestedThought, model.reasoningLevel, this.settings.thinking]
        .find((value): value is string => Boolean(value && this.settings.thinkingOptions.includes(value)))
        ?? this.settings.thinkingOptions[0]
      : model.reasoningLevel;
    const result = await this.request("session/setModel", {
      sessionId: this.sessionId,
      model: buildZcodeModelSelection({ ...model, reasoningLevel }),
      persistAsWorkspaceLastUsed: false,
    });
    this.settings = {
      ...this.settings,
      model: modelId,
      ...(reasoningLevel ? { thinking: reasoningLevel, thinkingEnabled: true } : {}),
    };
    this.updateSettingsFromResult(result);
    const thoughtLevel = [requestedThought, model.reasoningLevel, this.settings.thinking]
      .find((value): value is string => Boolean(value && this.settings.thinkingOptions.includes(value)));
    if (thoughtLevel) {
      await this.setThoughtLevel(thoughtLevel);
    }
  }

  private updateSettingsFromResult(result: unknown): void {
    const record = readZcodeRecord(result);
    const snapshot = readZcodeRecord(record?.snapshot) ?? record;
    if (snapshot?.protocol) {
      this.settings = readZcodeSettings(readZcodeSnapshot(result));
    }
  }

  private async readUsage(): Promise<ZcodeContextUsage | null> {
    if (!this.sessionId) {
      return null;
    }
    try {
      const result = await this.request("session/read", { sessionId: this.sessionId });
      return readZcodeContextUsage(readZcodeSnapshot(result));
    } catch {
      return null;
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child?.stdin || this.closed || this.failed) {
      return Promise.reject(this.failed ?? new ZcodeProtocolError("ZCode process is not running.", "process"));
    }
    const id = this.nextId;
    this.nextId += 1;
    const key = String(id);
    return new Promise((resolve, reject) => {
      this.pending.set(key, { resolve, reject });
      this.child?.stdin?.write(serializeCodexAppServerMessage({ id, method, params }));
    });
  }

  private async consume(reader: CodexAppServerNdjsonReader): Promise<void> {
    try {
      for await (const line of reader.lines) {
        this.onLine(line);
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private onLine(line: string): void {
    let message: ZcodeWireMessage | null;
    try {
      message = parseZcodeWireLine(line);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (!message) {
      return;
    }
    if (message.method && message.id !== undefined && !("result" in message) && !("error" in message)) {
      this.answerServerRequest(message);
      return;
    }
    if (message.id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.pending.get(String(message.id));
      if (!pending) {
        return;
      }
      this.pending.delete(String(message.id));
      if (message.error) {
        const text = typeof message.error.message === "string" ? message.error.message : "ZCode request failed.";
        pending.reject(new ZcodeProtocolError(redactZcodeDiagnostic(text), "rpc", message.error.code));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method === "state.updated" && this.compactWait) {
      const params = readZcodeRecord(message.params);
      if (params?.scope === "session" && params.sessionId === this.sessionId) {
        if (params.reason === "session_compacted") {
          this.compactWait.resolve();
        } else if (params.reason === "session_compact_failed" || params.reason === "session_compact_cancelled") {
          this.compactWait.reject(new ZcodeProtocolError(
            params.reason === "session_compact_cancelled"
              ? "ZCode context compaction was cancelled."
              : "ZCode context compaction failed.",
            "compaction",
          ));
        }
      }
      return;
    }
    const event = readZcodeSessionEvent(message);
    if (event) {
      this.onEvent(event);
    }
  }

  private answerServerRequest(message: ZcodeWireMessage): void {
    if (!this.child?.stdin || message.id === undefined) {
      return;
    }
    if (message.method === "session/requestRuntimePreferences") {
      this.child.stdin.write(serializeCodexAppServerMessage({
        id: message.id,
        result: buildZcodeRuntimePreferences(),
      }));
      return;
    }
    if (message.method === "interaction/requestPermission") {
      const option = selectZcodeAllowOption(message.params);
      if (!option) {
        this.child.stdin.write(serializeCodexAppServerMessage({
          id: message.id,
          error: { code: -32602, message: "ZCode offered no allow option for this permission request." },
        }));
        this.turnWait?.handlers.onTrace?.("ZCode permission request had no allow option.", "error");
        return;
      }
      this.child.stdin.write(serializeCodexAppServerMessage({
        id: message.id,
        result: option,
      }));
      return;
    }
    this.child.stdin.write(serializeCodexAppServerMessage({
      id: message.id,
      error: { code: -32601, message: `ZCode client does not implement ${message.method ?? "request"}.` },
    }));
  }

  private onEvent(event: ZcodeSessionEvent): void {
    if (this.sessionId && event.sessionId && event.sessionId !== this.sessionId) {
      return;
    }
    const wait = this.turnWait;
    wait?.handlers.onActivity?.();
    const delta = readZcodeTextDelta(event);
    if (delta && wait) {
      if (delta.field === "reasoning") {
        wait.handlers.onThinkingDelta?.(delta.delta);
      } else if (delta.field === "text") {
        wait.text += delta.delta;
        wait.handlers.onAssistantDelta?.(delta.delta);
      }
      return;
    }
    if (wait) {
      const trace = this.traceProjector.project(event);
      if (trace) {
        wait.handlers.onTrace?.(trace.content, "tool-use", { toolCallId: trace.toolCallId });
        return;
      }
    }
    if (event.type === "turn.completed" && wait) {
      const response = typeof event.payload.response === "string" ? event.payload.response : wait.text;
      this.turnWait = null;
      wait.resolve(response || wait.text);
      return;
    }
    if (event.type === "turn.failed" && (wait || this.compactWait)) {
      this.turnWait = null;
      const error = new ZcodeProtocolError(readZcodeTurnFailure(event), "turn-failed");
      wait?.reject(error);
      this.compactWait?.reject(error);
    }
  }

  private fail(error: Error): void {
    if (this.failed) {
      return;
    }
    const detail = this.stderrText ? `${error.message}\n${this.stderrText}` : error.message;
    this.failed = new ZcodeProtocolError(redactZcodeDiagnostic(detail), "process");
    this.rejectAll(this.failed);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.turnWait?.reject(error);
    this.turnWait = null;
    this.compactWait?.reject(error);
    this.compactWait = null;
  }
}

function defaultSpawn(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }): ZcodeChild {
  const resolved = resolveSpawnCommand(command, [...args]);
  return spawn(resolved.command, resolved.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "pipe",
    windowsHide: true,
  }) as unknown as ZcodeChild;
}
