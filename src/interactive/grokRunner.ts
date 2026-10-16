import type { ChildProcess } from "child_process";
import type { Readable } from "stream";
import { spawn } from "cross-spawn";
import { buildGrokAgentStdioArgs, getGrokAgentArgs, getGrokCommand } from "../cli/config";
import { readGrokActiveModelHasOwnCredential } from "../config/grokConfig";
import { t } from "../i18n";
import {
  createCodexAppServerNdjsonReader,
  serializeCodexAppServerMessage,
  type CodexAppServerNdjsonReader,
} from "./codexAppServerNdjson";
import { requestChildShutdown } from "./codexRunnerProcess";
import { resolveSpawnCommand } from "./codexRunnerProcess";
import { GrokAcpClient, GrokAcpClientError } from "./grokAcpClient";
import {
  buildGrokAuthenticateParams,
  buildGrokInitializeParams,
  buildGrokReasoningConfigParams,
  buildGrokSessionCancelParams,
  buildGrokSessionLoadParams,
  buildGrokSessionNewParams,
  buildGrokSessionPromptParams,
  classifyGrokSessionMessage,
  findGrokReasoningOption,
  formatGrokToolTrace,
  parseGrokJsonRpcLine,
  readGrokAuthMethodIds,
  readGrokLoadSessionCapability,
  readGrokPromptStopReason,
  readGrokSessionId,
  resolveGrokReasoningEffort,
  selectGrokAuthMethod,
  type GrokJsonRpcMessage,
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

export type GrokTraceKind = "thinking" | "normal" | "error";

export type GrokStreamHandlers = {
  onAssistantDelta?: (text: string) => void;
  onTrace?: (content: string, kind?: GrokTraceKind) => void;
  onEvent?: (message: GrokJsonRpcMessage) => void;
  onComplete?: (meta: { stopReason: string | null }) => void;
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

type PendingRequest = {
  method: string;
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
  private readonly stderrChunks: Buffer[] = [];
  private readonly acpClient: GrokAcpClient;

  public constructor(private readonly options: GrokRunnerOptions) {
    this.acpClient = new GrokAcpClient(options.cwd);
  }

  public isReusable(): boolean {
    return !this.closed && !this.failed;
  }

  public async start(): Promise<GrokSessionInfo> {
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
      return await this.handshake();
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
    try {
      const result = await this.request("session/prompt", buildGrokSessionPromptParams(this.sessionId, text));
      const stopReason = readGrokPromptStopReason({ result });
      handlers.onComplete?.({ stopReason });
      return { stopReason };
    } finally {
      if (this.activeHandlers === handlers) {
        this.activeHandlers = null;
      }
    }
  }

  public cancelTurn(): void {
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

  public dispose(): void {
    this.fail(new Error(t("grok.exited", { detail: "disposed", stderr: "" })));
  }

  private async handshake(): Promise<GrokSessionInfo> {
    const initialized = await this.request("initialize", buildGrokInitializeParams());
    const env = this.options.env ?? process.env;
    const modelHasOwnCredential = await readGrokActiveModelHasOwnCredential(env);
    if (!modelHasOwnCredential) {
      const selected = selectGrokAuthMethod(readGrokAuthMethodIds(initialized), env);
      if (!selected.ok) {
        throw new Error(t("grok.authRequired"));
      }
      await this.request("authenticate", buildGrokAuthenticateParams(selected.methodId));
    }
    const localSessionId = String(this.options.localSessionId ?? "").trim();
    const canLoad = readGrokLoadSessionCapability(initialized);
    let resumed = false;
    let created: unknown;
    if (localSessionId && canLoad) {
      try {
        created = await this.request("session/load", buildGrokSessionLoadParams(localSessionId, this.options.cwd));
        resumed = true;
      } catch (error) {
        if (this.closed || this.failed) {
          throw error;
        }
        created = await this.request("session/new", buildGrokSessionNewParams(this.options.cwd));
      }
    } else {
      created = await this.request("session/new", buildGrokSessionNewParams(this.options.cwd));
    }
    const acpSessionId = readGrokSessionId(created);
    if (!acpSessionId) {
      throw new Error(t("grok.requestFailed"));
    }
    this.sessionId = acpSessionId;
    const effort = resolveGrokReasoningEffort(
      this.options.thinkingMode,
      findGrokReasoningOption(created) ?? findGrokReasoningOption(initialized),
    );
    if (effort) {
      await this.request(
        "session/set_config_option",
        buildGrokReasoningConfigParams(acpSessionId, effort),
      );
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
    if (message.id !== undefined && message.id !== null && (message.result !== undefined || message.error)) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) {
        return;
      }
      this.pending.delete(Number(message.id));
      if (message.error) {
        pending.reject(new Error(String(message.error.message || t("grok.requestFailed"))));
        return;
      }
      if (pending.method === "session/prompt") {
        this.activeHandlers?.onEvent?.(message);
      }
      pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.id !== null && message.method) {
      void this.answerClientRequest(message);
      return;
    }
    if (message.method === "session/update") {
      this.activeHandlers?.onEvent?.(message);
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
    if (event.type === "tool" || event.type === "tool_update") {
      this.activeHandlers?.onTrace?.(formatGrokToolTrace(event));
    }
  }

  private async answerClientRequest(message: GrokJsonRpcMessage): Promise<void> {
    try {
      const result = await this.acpClient.handle(String(message.method), message.params, this.sessionId);
      if (this.canWrite()) {
        this.write({ jsonrpc: "2.0", id: message.id, result });
      }
    } catch (error) {
      if (!this.canWrite()) {
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
      this.pending.set(id, { method, resolve, reject });
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
