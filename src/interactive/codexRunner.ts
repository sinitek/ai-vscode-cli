import type { ChildProcess } from "child_process";
import { spawn } from "cross-spawn";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { getMacTaskShell } from "../cli/config";
import { resolveCliCommand } from "../cli/commandRunner";
import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { t } from "../i18n";

export type CodexTraceKind = "thinking" | "normal";

export type CodexTraceMeta = {
  merge?: boolean;
};

export type CodexStreamHandlers = {
  onAssistantDelta: (chunk: string) => void;
  onTrace: (content: string, kind?: CodexTraceKind, meta?: CodexTraceMeta) => void;
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
  onThreadId: (threadId: string) => void;
  onEvent?: (event: unknown) => void;
};

type CodexThreadOptions = {
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: string;
  model?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  additionalDirectories?: string[];
  webSearchEnabled?: boolean;
  webSearchMode?: string;
  networkAccessEnabled?: boolean;
};

type JsonRpcPendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type JsonRpcError = {
  code: number;
  message: string;
};

type JsonRpcResolution = {
  result?: unknown;
  error?: JsonRpcError;
};

type AppServerResponse = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

const CODEX_APP_SERVER_CLIENT_NAME = "codex";
const CODEX_APP_SERVER_CLIENT_TITLE = "Codex";
const CODEX_APP_SERVER_CLIENT_VERSION_FALLBACK = "0.0.0";
const CODEX_PACKAGE_NAME_PREFIX = "@openai/codex";
const CODEX_PACKAGE_VERSION_SEARCH_DEPTH = 8;
const CODEX_AGENT_JOB_MAX_RUNTIME_SECONDS = 24 * 60 * 60;

function pickArgValue(args: string[], keys: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (keys.includes(arg) && index + 1 < args.length) {
      return args[index + 1] ?? null;
    }
  }
  return null;
}

function hasFlag(args: string[], keys: string[]): boolean {
  return args.some((arg) => keys.includes(arg));
}

function collectArgValues(args: string[], keys: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (keys.includes(args[index]) && index + 1 < args.length) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function resolveCodexPackageVersionFromCommand(commandPath: string): string | null {
  const normalizedCommandPath = String(commandPath || "").trim();
  if (!normalizedCommandPath) {
    return null;
  }

  const candidatePaths = new Set<string>([normalizedCommandPath]);
  try {
    candidatePaths.add(fs.realpathSync(normalizedCommandPath));
  } catch {
    // ignore realpath failures and continue with the original path
  }

  for (const candidatePath of candidatePaths) {
    let currentDir = path.dirname(candidatePath);
    for (let depth = 0; depth < CODEX_PACKAGE_VERSION_SEARCH_DEPTH; depth += 1) {
      const packageJsonPath = path.join(currentDir, "package.json");
      const packageJson = readJsonObject(packageJsonPath);
      const packageName = typeof packageJson?.name === "string" ? packageJson.name.trim() : "";
      const packageVersion = typeof packageJson?.version === "string" ? packageJson.version.trim() : "";
      if (packageName.startsWith(CODEX_PACKAGE_NAME_PREFIX) && packageVersion) {
        return packageVersion;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  return null;
}

function buildCodexAppServerClientInfo(commandPath: string): {
  name: string;
  title: string;
  version: string;
} {
  return {
    name: CODEX_APP_SERVER_CLIENT_NAME,
    title: CODEX_APP_SERVER_CLIENT_TITLE,
    version: resolveCodexPackageVersionFromCommand(commandPath) ?? CODEX_APP_SERVER_CLIENT_VERSION_FALLBACK,
  };
}

function mapCodexReasoningEffort(mode: ThinkingMode): string {
  if (mode === "xhigh") {
    return "xhigh";
  }
  if (mode === "high") {
    return "high";
  }
  if (mode === "medium") {
    return "medium";
  }
  if (mode === "low" || mode === "off" || mode === "on") {
    return "low";
  }
  return "medium";
}

function buildCodexThreadOptions(
  args: string[],
  cwd: string | undefined,
  thinkingMode: ThinkingMode,
  interactiveMode: InteractiveMode,
  modelOverride?: string | null
): CodexThreadOptions {
  const options: CodexThreadOptions = {
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    modelReasoningEffort: mapCodexReasoningEffort(thinkingMode),
  };

  const model = typeof modelOverride === "string" && modelOverride.trim()
    ? modelOverride.trim()
    : pickArgValue(args, ["--model", "-m"]);
  if (model) {
    options.model = model;
  }

  if (hasFlag(args, ["--dangerously-bypass-approvals-and-sandbox"])) {
    options.approvalPolicy = "never";
    options.sandboxMode = "danger-full-access";
  } else {
    const approval = pickArgValue(args, ["--ask-for-approval", "-a"]);
    if (approval) {
      options.approvalPolicy = approval;
    }
    const sandbox = pickArgValue(args, ["--sandbox", "-s"]);
    if (sandbox) {
      options.sandboxMode = sandbox;
    }
  }

  const additionalDirectories = collectArgValues(args, ["--add-dir"])
    .map((item) => item.trim())
    .filter(Boolean);
  if (additionalDirectories.length) {
    options.additionalDirectories = additionalDirectories;
  }

  const enableWebSearch = args.some(
    (arg, index) => arg === "--search"
      || (arg === "--enable" && args[index + 1] === "web_search_request")
  );
  if (enableWebSearch) {
    options.webSearchEnabled = true;
    options.webSearchMode = "live";
    options.networkAccessEnabled = true;
  }

  if (interactiveMode === "plan") {
    options.sandboxMode = "read-only";
    options.approvalPolicy = "untrusted";
  }

  return options;
}

function buildCodexAppServerArgs(): string[] {
  return ["app-server", "--listen", "stdio://"];
}

function buildCodexTurnInput(prompt: string, imagePaths: string[]): unknown[] {
  const inputs: unknown[] = [{ type: "text", text: prompt, text_elements: [] }];
  imagePaths.forEach((imagePath) => {
    if (imagePath.trim()) {
      inputs.push({ type: "localImage", path: imagePath.trim() });
    }
  });
  return inputs;
}

function buildCodexAppServerConfig(options: CodexThreadOptions): Record<string, unknown> {
  const config: Record<string, unknown> = {
    agents: {
      job_max_runtime_seconds: CODEX_AGENT_JOB_MAX_RUNTIME_SECONDS,
    },
  };
  if (typeof options.webSearchMode === "string" && options.webSearchMode) {
    config.web_search = options.webSearchMode;
  } else if (options.webSearchEnabled === true) {
    config.web_search = "live";
  } else if (options.webSearchEnabled === false) {
    config.web_search = "disabled";
  }
  return config;
}

function buildCodexAppServerSandboxMode(sandboxMode?: string): string {
  const normalized = String(sandboxMode || "").trim();
  if (["read-only", "workspace-write", "danger-full-access"].includes(normalized)) {
    return normalized;
  }
  return "workspace-write";
}

function buildCodexAppServerSandboxPolicy(options: CodexThreadOptions): Record<string, unknown> {
  const sandboxMode = buildCodexAppServerSandboxMode(options.sandboxMode);
  const networkAccess = options.networkAccessEnabled === true;

  if (sandboxMode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }

  if (sandboxMode === "read-only") {
    return {
      type: "readOnly",
      access: { type: "fullAccess" },
      networkAccess,
    };
  }

  const writableRoots = Array.from(
    new Set(
      [options.workingDirectory, ...(options.additionalDirectories ?? [])]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );

  return {
    type: "workspaceWrite",
    writableRoots,
    readOnlyAccess: { type: "fullAccess" },
    networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildShellCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((segment) => escapeShellArg(segment)).join(" ");
}

function resolveMacTaskShellExecutable(): string {
  return getMacTaskShell() === "bash" ? "/bin/bash" : "/bin/zsh";
}

function resolveSpawnCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === "darwin") {
    return {
      command: resolveMacTaskShellExecutable(),
      args: ["-lc", buildShellCommandLine(command, args)],
    };
  }

  const resolved = resolveCliCommand(command);
  if (!resolved) {
    const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }

  return {
    command: resolved.command,
    args,
  };
}

function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals | number = "SIGTERM"
): boolean {
  if (!child.pid) {
    return false;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return true;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      return false;
    }
  }
  return true;
}

function createAbortError(): Error {
  const error = new Error("Codex run aborted");
  error.name = "AbortError";
  return error;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractDelta(previous: string, next: string): string {
  if (!next) {
    return "";
  }
  if (!previous) {
    return next;
  }
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  const max = Math.min(previous.length, next.length);
  let index = 0;
  for (; index < max; index += 1) {
    if (previous.charCodeAt(index) !== next.charCodeAt(index)) {
      break;
    }
  }
  return next.slice(index);
}

function collectReasoningFragments(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) {
      output.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectReasoningFragments(item, output));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  ["text", "summary", "content", "title"].forEach((key) => {
    if (key in record) {
      collectReasoningFragments(record[key], output);
    }
  });
}

function extractReasoningText(item: Record<string, unknown>): string {
  const fragments: string[] = [];
  collectReasoningFragments(item.text, fragments);
  collectReasoningFragments(item.summary, fragments);
  collectReasoningFragments(item.content, fragments);
  if (!fragments.length) {
    return "";
  }
  return fragments.filter((value, index) => fragments.indexOf(value) === index).join("\n").trim();
}

function normalizeTodoListItems(items: unknown[]): { text: string; done: boolean }[] {
  return items
    .map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const text = typeof record.text === "string"
        ? record.text.trim()
        : typeof record.step === "string"
          ? record.step.trim()
          : "";
      if (!text) {
        return null;
      }
      const done = record.completed === true || String(record.status || "").trim() === "completed";
      return { text, done };
    })
    .filter((item): item is { text: string; done: boolean } => Boolean(item));
}

function extractItemErrorMessage(item: Record<string, unknown>): string {
  const error = item.error;
  if (typeof error === "string") {
    return error.trim();
  }
  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const preferred = String(details.message || details.detail || details.reason || "").trim();
    if (preferred) {
      return preferred;
    }
    return safeStringify(details);
  }
  return "";
}

function toExecLikeWebSearchAction(action: unknown): unknown {
  if (!action || typeof action !== "object") {
    return action;
  }
  const normalized = action as Record<string, unknown>;
  const type = String(normalized.type || "").trim();
  if (type === "openPage") {
    return { type: "open_page", url: normalized.url ?? null };
  }
  if (type === "findInPage") {
    return { type: "find_in_page", url: normalized.url ?? null, pattern: normalized.pattern ?? null };
  }
  if (!type) {
    return normalized;
  }
  return {
    ...normalized,
    type: type === "other" ? "other" : "search",
  };
}

function toExecLikeItemType(type: unknown): string {
  const normalized = String(type || "").trim();
  return ({
    agentMessage: "agent_message",
    commandExecution: "command_execution",
    fileChange: "file_change",
    mcpToolCall: "mcp_tool_call",
    todoList: "todo_list",
    webSearch: "web_search",
  } as Record<string, string>)[normalized] || normalized;
}

function toExecLikeItem(item: unknown): Record<string, unknown> {
  const normalized = item && typeof item === "object"
    ? { ...(item as Record<string, unknown>) }
    : {};
  normalized.type = toExecLikeItemType(normalized.type);
  if (normalized.action) {
    normalized.action = toExecLikeWebSearchAction(normalized.action);
  }
  if (typeof normalized.aggregated_output === "undefined" && typeof normalized.aggregatedOutput !== "undefined") {
    normalized.aggregated_output = normalized.aggregatedOutput;
  }
  if (typeof normalized.exit_code === "undefined" && typeof normalized.exitCode !== "undefined") {
    normalized.exit_code = normalized.exitCode;
  }
  if (typeof normalized.duration_ms === "undefined" && typeof normalized.durationMs !== "undefined") {
    normalized.duration_ms = normalized.durationMs;
  }
  if (!normalized.error || typeof normalized.error !== "string") {
    const extractedError = extractItemErrorMessage(normalized);
    if (extractedError) {
      normalized.error = extractedError;
    }
  }
  return normalized;
}

function shouldSuppressRawEvent(method: string): boolean {
  const normalized = method.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.endsWith("/delta") || normalized.endsWith("delta");
}

function normalizeRawEventItemType(type: unknown): string {
  return toExecLikeItemType(type).trim().toLowerCase();
}

function normalizeForwardedItem(rawItem: unknown): Record<string, unknown> {
  const item = toExecLikeItem(rawItem);
  const itemType = normalizeRawEventItemType(item.type);
  if (itemType === "reasoning") {
    const text = extractReasoningText(item);
    if (text) {
      item.text = text;
    }
  }
  return item;
}

function buildForwardedRawEvent(message: Record<string, unknown>): Record<string, unknown> | null {
  const method = String(message.method || "").trim();
  if (!method || shouldSuppressRawEvent(method)) {
    return null;
  }

  if (method.startsWith("codex/event/")) {
    return null;
  }

  const params = message.params && typeof message.params === "object"
    ? message.params as Record<string, unknown>
    : {};

  if (method === "thread/started") {
    const thread = params.thread && typeof params.thread === "object"
      ? params.thread as Record<string, unknown>
      : {};
    const threadId = String(thread.id || "").trim();
    return threadId ? { type: "thread.started", thread_id: threadId } : { type: "thread.started" };
  }

  if (method === "turn/plan/updated") {
    return {
      type: "turn.plan.updated",
      turnId: String(params.turnId || "").trim(),
      threadId: String(params.threadId || "").trim(),
      explanation: params.explanation ?? null,
      plan: Array.isArray(params.plan) ? params.plan : [],
    };
  }

  if (method === "turn/completed") {
    const turn = params.turn && typeof params.turn === "object"
      ? params.turn as Record<string, unknown>
      : {};
    return {
      type: "turn.completed",
      status: String(turn.status || "").trim() || "completed",
      usage: turn.tokenUsage ?? params.tokenUsage ?? null,
    };
  }

  if (method === "error") {
    const msg = String(params.message || "").trim();
    if (!msg) {
      return null;
    }
    return { type: "error", message: msg };
  }

  if (method !== "item/started" && method !== "item/completed") {
    return null;
  }

  const rawItem = params.item && typeof params.item === "object"
    ? params.item as Record<string, unknown>
    : {};
  const item = normalizeForwardedItem(rawItem);
  const itemType = normalizeRawEventItemType(item.type);

  const allowStarted = itemType === "command_execution"
    || itemType === "mcp_tool_call"
    || itemType === "web_search"
    || itemType === "file_change"
    || itemType === "todo_list";
  const allowCompleted = itemType === "reasoning"
    || itemType === "agent_message"
    || itemType === "command_execution"
    || itemType === "mcp_tool_call"
    || itemType === "web_search"
    || itemType === "file_change"
    || itemType === "todo_list"
    || itemType === "error";

  if (method === "item/started" && !allowStarted) {
    return null;
  }
  if (method === "item/completed" && !allowCompleted) {
    return null;
  }

  return {
    type: method === "item/started" ? "item.started" : "item.completed",
    item,
  };
}

function buildTurnFailureMessage(params: unknown): string {
  const turn = params && typeof params === "object"
    ? (params as Record<string, unknown>).turn as Record<string, unknown> | undefined
    : undefined;
  const error = turn?.error && typeof turn.error === "object"
    ? turn.error as Record<string, unknown>
    : undefined;
  const preferred = String(error?.message || error?.additionalDetails || "").trim();
  return preferred || t("codex.appServerTaskFailed");
}

function buildAppServerRequestResolution(method: string): JsonRpcResolution {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return { result: { decision: "decline" } };
    case "item/fileChange/requestApproval":
      return { result: { decision: "decline" } };
    case "item/permissions/requestApproval":
      return { result: { permissions: {}, scope: "turn" } };
    case "item/tool/requestUserInput":
      return { result: { answers: {} } };
    case "mcpServer/elicitation/request":
      return { result: { action: "cancel", content: null, _meta: null } };
    case "applyPatchApproval":
      return { result: { decision: "denied" } };
    case "execCommandApproval":
      return { result: { decision: "denied" } };
    default:
      return {
        error: {
          code: -32601,
          message: t("codex.appServerUnsupportedRequest", { method: method || "unknown" }),
        },
      };
  }
}

export class CodexInteractiveRunner {
  public readonly cli: CliName = "codex";
  private activeChild: ChildProcess | null = null;
  private abortGeneration = 0;
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
    }
  ) {}

  public getThreadId(): string | null {
    return this.options.threadId ?? null;
  }

  public async ensureReady(): Promise<void> {
    if (this.disposed) {
      throw new Error("runner-disposed");
    }
  }

  public rebuild(): void {
  }

  public stopAndRebuild(): void {
    this.abortGeneration += 1;
    if (this.activeChild) {
      killProcessTree(this.activeChild);
      this.activeChild = null;
    }
    this.rebuild();
  }

  public dispose(): void {
    this.disposed = true;
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

  public async runStreamed(prompt: string, handlers: CodexStreamHandlers): Promise<void> {
    await this.ensureReady();

    const runGeneration = this.abortGeneration;
    const threadOptions = buildCodexThreadOptions(
      this.options.args,
      this.options.cwd,
      this.options.thinkingMode,
      this.options.interactiveMode,
      this.options.model
    );
    const imagePaths = collectArgValues(this.options.args, ["--image", "-i"])
      .map((item) => item.trim())
      .filter(Boolean);
    const spawnCommand = resolveSpawnCommand(this.options.command, buildCodexAppServerArgs());
    const child = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: this.options.cwd,
      env: process.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.activeChild = child;

    let spawnError: Error | null = null;
    let streamError: Error | null = null;
    let stdoutParseError: Error | null = null;
    const stderrChunks: Buffer[] = [];
    let nextRequestId = 1;
    let turnSettled = false;
    const pendingRequests = new Map<number, JsonRpcPendingRequest>();
    const assistantBuffers = new Map<string, string>();
    const seenCommandExecutions = new Set<string>();
    const seenWebSearches = new Set<string>();
    const seenMcpToolCalls = new Set<string>();
    let turnCompletionResolve: (() => void) | null = null;
    let turnCompletionReject: ((error: Error) => void) | null = null;

    const turnCompletionPromise = new Promise<void>((resolve, reject) => {
      turnCompletionResolve = resolve;
      turnCompletionReject = reject;
    });
    const exitPromise = new Promise<AppServerResponse>((resolve) => {
      child.once("close", (code, signal) => {
        resolve({ code, signal });
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

    const terminateChild = (): void => {
      if (child.killed) {
        return;
      }
      killProcessTree(child);
    };

    const updateThreadId = (threadId: unknown): void => {
      const normalized = String(threadId || "").trim();
      if (!normalized || this.options.threadId === normalized) {
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

    const handleTodoListUpdate = (items: unknown[]): void => {
      const normalizedItems = normalizeTodoListItems(items);
      if (normalizedItems.length) {
        handlers.onTaskListUpdate(normalizedItems);
      }
    };

    const handleItemEvent = (eventType: "item.started" | "item.completed", rawItem: unknown): void => {
      const item = toExecLikeItem(rawItem);
      const itemType = String(item.type || "").trim();

      if (itemType === "agent_message") {
        if (eventType === "item.completed") {
          const itemId = String(item.id || "").trim();
          const nextText = typeof item.text === "string" ? item.text : "";
          const previousText = itemId ? (assistantBuffers.get(itemId) ?? "") : "";
          const delta = extractDelta(previousText, nextText);
          if (delta) {
            handlers.onAssistantDelta(delta);
          }
          if (itemId) {
            assistantBuffers.delete(itemId);
          }
        }
        return;
      }

      if (itemType === "todo_list") {
        handleTodoListUpdate(Array.isArray(item.items) ? item.items : []);
        return;
      }

      if (itemType === "reasoning") {
        const text = extractReasoningText(item);
        if (text) {
          handlers.onTrace(text, "thinking");
        }
        return;
      }

      if (itemType === "command_execution") {
        const command = typeof item.command === "string" ? item.command.trim() : "";
        const commandLine = command ? `exec ${command}` : "exec";
        const commandId = String(item.id || "").trim();
        if (commandId) {
          if (seenCommandExecutions.has(commandId)) {
            return;
          }
          seenCommandExecutions.add(commandId);
        } else if (eventType !== "item.completed") {
          return;
        }
        handlers.onTrace(commandLine, "normal", { merge: false });
        return;
      }

      if (itemType === "file_change") {
        if (eventType !== "item.completed") {
          return;
        }
        const status = typeof item.status === "string" ? item.status : "";
        const changes = Array.isArray(item.changes) ? item.changes : [];
        const lines = changes
          .map((change) => {
            const record = change && typeof change === "object"
              ? change as Record<string, unknown>
              : {};
            const changePath = typeof record.path === "string" ? record.path : "";
            const changeKind = typeof record.kind === "string" ? record.kind : "update";
            return changePath ? `${changeKind}: ${changePath}` : "";
          })
          .filter(Boolean);
        handlers.onTrace(["file update", status ? `status: ${status}` : "", ...lines].filter(Boolean).join("\n"));
        return;
      }

      if (itemType === "mcp_tool_call") {
        const itemId = String(item.id || "").trim();
        if (itemId) {
          if (seenMcpToolCalls.has(itemId)) {
            return;
          }
          seenMcpToolCalls.add(itemId);
        } else if (eventType !== "item.completed") {
          return;
        }
        const server = typeof item.server === "string" ? item.server : "";
        const tool = typeof item.tool === "string" ? item.tool : "";
        const status = typeof item.status === "string" ? item.status : "";
        handlers.onTrace(
          ["mcp", `${server} :: ${tool}`.trim(), status ? `status: ${status}` : "", `params: ${safeStringify(item.arguments)}`]
            .filter(Boolean)
            .join("\n")
        );
        return;
      }

      if (itemType === "web_search") {
        const itemId = String(item.id || "").trim();
        if (itemId) {
          if (seenWebSearches.has(itemId)) {
            return;
          }
          seenWebSearches.add(itemId);
        } else if (eventType !== "item.completed") {
          return;
        }
        const query = typeof item.query === "string"
          ? item.query
          : typeof item.action === "object" && item.action && typeof (item.action as Record<string, unknown>).query === "string"
            ? String((item.action as Record<string, unknown>).query)
            : "";
        if (query) {
          handlers.onTrace(`web search ${query}`);
        }
        return;
      }

      if (itemType === "error") {
        const message = typeof item.message === "string"
          ? item.message.trim()
          : extractItemErrorMessage(item);
        if (message) {
          handlers.onTrace(`error ${message}`);
        }
      }
    };

    child.once("error", (error) => {
      spawnError = error;
      failRun(error);
    });

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    if (!child.stdout) {
      child.kill();
      throw new Error(t("codex.appServerNoStdout"));
    }

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const outputLoopPromise = (async (): Promise<void> => {
      try {
        for await (const line of rl) {
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
            terminateChild();
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
            const resolution = buildAppServerRequestResolution(method);
            try {
              sendJsonRpcMessage(resolution.error
                ? { jsonrpc: "2.0", id: message.id, error: resolution.error }
                : { jsonrpc: "2.0", id: message.id, result: resolution.result ?? {} });
            } catch (error) {
              failRun(error instanceof Error ? error : new Error(String(error)));
              terminateChild();
              break;
            }
            continue;
          }

          if (!method) {
            continue;
          }

          if (method === "thread/started") {
            updateThreadId((message.params as Record<string, unknown> | undefined)?.thread && typeof (message.params as Record<string, unknown>).thread === "object"
              ? ((message.params as Record<string, unknown>).thread as Record<string, unknown>).id
              : undefined);
            continue;
          }

          if (method === "item/agentMessage/delta") {
            const params = message.params && typeof message.params === "object"
              ? message.params as Record<string, unknown>
              : {};
            const itemId = String(params.itemId || "").trim();
            const delta = String(params.delta || "");
            if (itemId) {
              assistantBuffers.set(itemId, `${assistantBuffers.get(itemId) ?? ""}${delta}`);
            }
            if (delta) {
              handlers.onAssistantDelta(delta);
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
            handleTodoListUpdate(Array.isArray(params.plan) ? params.plan : []);
            continue;
          }

          if (method === "turn/completed") {
            const params = message.params && typeof message.params === "object"
              ? message.params as Record<string, unknown>
              : {};
            const turn = params.turn && typeof params.turn === "object"
              ? params.turn as Record<string, unknown>
              : {};
            if (String(turn.status || "").trim() === "failed") {
              settleTurnCompletion(new Error(buildTurnFailureMessage(params)));
            } else {
              settleTurnCompletion();
            }
            setTimeout(() => terminateChild(), 0);
            continue;
          }

          if (method === "error") {
            const params = message.params && typeof message.params === "object"
              ? message.params as Record<string, unknown>
              : {};
            const warning = String(params.message || "").trim();
            if (warning) {
              const lower = warning.toLowerCase();
              const prefix = lower.startsWith("reconnecting") || lower.startsWith("retrying")
                ? "warning "
                : "error ";
              handlers.onTrace(`${prefix}${warning}`);
            }
            continue;
          }

          if (method === "item/started" || method === "item/completed") {
            const params = message.params && typeof message.params === "object"
              ? message.params as Record<string, unknown>
              : {};
            handleItemEvent(method === "item/started" ? "item.started" : "item.completed", params.item);
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
      const initializeParams: Record<string, unknown> = {
        clientInfo: buildCodexAppServerClientInfo(this.options.command),
        capabilities: {
          experimentalApi: false,
          optOutNotificationMethods: [],
        },
      };
      await request("initialize", initializeParams);
      notify("initialized");

      const threadConfig = buildCodexAppServerConfig(threadOptions);
      const threadParams: Record<string, unknown> = {
        cwd: threadOptions.workingDirectory,
        sandbox: buildCodexAppServerSandboxMode(threadOptions.sandboxMode),
        config: threadConfig,
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      };
      if (threadOptions.model) {
        threadParams.model = threadOptions.model;
      }
      if (threadOptions.approvalPolicy) {
        threadParams.approvalPolicy = threadOptions.approvalPolicy;
      }

      const threadResult = this.options.threadId
        ? await request<Record<string, unknown>>("thread/resume", {
            threadId: this.options.threadId,
            ...threadParams,
          })
        : await request<Record<string, unknown>>("thread/start", threadParams);
      const thread = threadResult?.thread && typeof threadResult.thread === "object"
        ? threadResult.thread as Record<string, unknown>
        : null;
      updateThreadId(thread?.id);

      const turnStartParams: Record<string, unknown> = {
        threadId: this.options.threadId,
        input: buildCodexTurnInput(prompt, imagePaths),
        cwd: threadOptions.workingDirectory,
        sandboxPolicy: buildCodexAppServerSandboxPolicy(threadOptions),
      };
      if (threadOptions.model) {
        turnStartParams.model = threadOptions.model;
      }
      if (threadOptions.modelReasoningEffort) {
        turnStartParams.effort = threadOptions.modelReasoningEffort;
      }
      if (threadOptions.approvalPolicy) {
        turnStartParams.approvalPolicy = threadOptions.approvalPolicy;
      }
      await request("turn/start", turnStartParams);
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
      terminateChild();
      await Promise.allSettled([exitPromise, outputLoopPromise]);
      if (this.abortGeneration !== runGeneration) {
        throw createAbortError();
      }
      throw error;
    } finally {
      rl.close();
      child.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stdin?.removeAllListeners();
      if (this.activeChild === child) {
        this.activeChild = null;
      }
    }
  }
}
