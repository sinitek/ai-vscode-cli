import type { ChildProcess } from "child_process";
import { spawn } from "cross-spawn";
import * as readline from "readline";
import { getMacTaskShell } from "../cli/config";
import { resolveCliCommand } from "../cli/commandRunner";
import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";

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

type CodexThreadOptions = Record<string, unknown>;

function pickArgValue(args: string[], keys: string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (keys.includes(arg) && i + 1 < args.length) {
      return args[i + 1] ?? null;
    }
  }
  return null;
}

function hasFlag(args: string[], keys: string[]): boolean {
  return args.some((arg) => keys.includes(arg));
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

  const addDirs: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--add-dir" && i + 1 < args.length) {
      addDirs.push(args[i + 1]);
      i += 1;
    }
  }
  if (addDirs.length) {
    options.additionalDirectories = addDirs;
  }

  const enableWebSearch = args.some(
    (arg, index) =>
      arg === "--search"
      || (arg === "--enable" && args[index + 1] === "web_search_request")
  );
  if (enableWebSearch) {
    options.webSearchEnabled = true;
    options.webSearchMode = "live";
    options.networkAccessEnabled = true;
  }

  if (interactiveMode === "plan") {
    // Plan mode keeps the session interactive but enforces a read-only stance.
    options.sandboxMode = "read-only";
    options.approvalPolicy = "untrusted";
  }

  return options;
}

function buildCodexExecArgs(
  args: string[],
  cwd: string | undefined,
  thinkingMode: ThinkingMode,
  interactiveMode: InteractiveMode,
  threadId: string | null,
  modelOverride?: string | null
): string[] {
  const options = buildCodexThreadOptions(args, cwd, thinkingMode, interactiveMode, modelOverride);
  const commandArgs = ["exec", "--experimental-json"];

  if (typeof options.model === "string" && options.model) {
    commandArgs.push("--model", options.model);
  }
  if (typeof options.sandboxMode === "string" && options.sandboxMode) {
    commandArgs.push("--sandbox", options.sandboxMode);
  }
  if (typeof options.workingDirectory === "string" && options.workingDirectory) {
    commandArgs.push("--cd", options.workingDirectory);
  }
  if (Array.isArray(options.additionalDirectories)) {
    for (const dir of options.additionalDirectories) {
      if (typeof dir === "string" && dir) {
        commandArgs.push("--add-dir", dir);
      }
    }
  }
  if (options.skipGitRepoCheck) {
    commandArgs.push("--skip-git-repo-check");
  }
  if (typeof options.modelReasoningEffort === "string" && options.modelReasoningEffort) {
    commandArgs.push("--config", `model_reasoning_effort="${options.modelReasoningEffort}"`);
  }
  if (typeof options.networkAccessEnabled === "boolean") {
    commandArgs.push(
      "--config",
      `sandbox_workspace_write.network_access=${options.networkAccessEnabled}`
    );
  }
  if (typeof options.webSearchMode === "string" && options.webSearchMode) {
    commandArgs.push("--config", `web_search="${options.webSearchMode}"`);
  } else if (options.webSearchEnabled === true) {
    commandArgs.push("--config", 'web_search="live"');
  } else if (options.webSearchEnabled === false) {
    commandArgs.push("--config", 'web_search="disabled"');
  }
  if (typeof options.approvalPolicy === "string" && options.approvalPolicy) {
    commandArgs.push("--config", `approval_policy="${options.approvalPolicy}"`);
  }
  if (threadId) {
    commandArgs.push("resume", threadId);
  }

  return commandArgs;
}

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

  const pid = child.pid;
  try {
    process.kill(-pid, signal);
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
  let i = 0;
  for (; i < max; i += 1) {
    if (previous.charCodeAt(i) !== next.charCodeAt(i)) {
      break;
    }
  }
  return next.slice(i);
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
  const unique = fragments.filter((value, index) => fragments.indexOf(value) === index);
  return unique.join("\n").trim();
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
    // No in-memory thread state to rebuild; thread continuity is tracked by threadId.
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
    const commandArgs = buildCodexExecArgs(
      this.options.args,
      this.options.cwd,
      this.options.thinkingMode,
      this.options.interactiveMode,
      this.options.threadId,
      this.options.model
    );
    const spawnCommand = resolveSpawnCommand(this.options.command, commandArgs);
    const child = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: this.options.cwd,
      env: process.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.activeChild = child;
    let lastAgentText = "";
    const seenCommandExecutions = new Set<string>();
    let spawnError: Error | null = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    if (!child.stdout) {
      child.kill();
      throw new Error("Child process has no stdout");
    }

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        let event: any;
        try {
          event = JSON.parse(trimmed);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to parse item: ${trimmed}\n${message}`);
        }

        handlers.onEvent?.(event);
        if (event?.type === "thread.started" && typeof event.thread_id === "string") {
          this.options.threadId = event.thread_id;
          handlers.onThreadId(event.thread_id);
          continue;
        }
        if (event?.type === "error") {
          const message = typeof event.message === "string" ? event.message.trim() : "";
          if (message) {
            const lower = message.toLowerCase();
            const prefix = lower.startsWith("reconnecting") || lower.startsWith("retrying")
              ? "warning "
              : "error ";
            handlers.onTrace(`${prefix}${message}`);
          }
          continue;
        }

        if ((event?.type === "item.started" || event?.type === "item.updated" || event?.type === "item.completed") && event.item) {
          const item = event.item as any;
          if (item.type === "agent_message") {
            const nextText = typeof item.text === "string" ? item.text : "";
            const delta = extractDelta(lastAgentText, nextText);
            if (delta) {
              handlers.onAssistantDelta(delta);
            }
            lastAgentText = nextText;
            continue;
          }
          if (item.type === "todo_list") {
            const items = Array.isArray(item.items) ? item.items : [];
            const normalized = items
              .filter((it: any) => it && typeof it.text === "string")
              .map((it: any) => ({ text: it.text, done: Boolean(it.completed) }));
            if (normalized.length) {
              handlers.onTaskListUpdate(normalized);
            }
            continue;
          }
          if (item.type === "reasoning") {
            const text = extractReasoningText(item);
            if (text) {
              handlers.onTrace(text, "thinking");
            }
            continue;
          }
          if (item.type === "command_execution") {
            const command = typeof item.command === "string" ? item.command.trim() : "";
            const commandLine = command ? `exec ${command}` : "exec";
            const commandId = typeof item.id === "string" ? item.id : "";
            if (commandId) {
              if (seenCommandExecutions.has(commandId)) {
                continue;
              }
              seenCommandExecutions.add(commandId);
            } else if (event?.type !== "item.completed") {
              continue;
            }
            handlers.onTrace(commandLine, "normal", { merge: false });
            continue;
          }
          if (item.type === "file_change") {
            const status = typeof item.status === "string" ? item.status : "";
            const changes = Array.isArray(item.changes) ? item.changes : [];
            const list = changes
              .map((c: any) => (c && typeof c.path === "string" ? `${c.kind ?? "update"}: ${c.path}` : ""))
              .filter(Boolean);
            handlers.onTrace(["file update", status ? `status: ${status}` : "", ...list].filter(Boolean).join("\n"));
            continue;
          }
          if (item.type === "mcp_tool_call") {
            const server = typeof item.server === "string" ? item.server : "";
            const tool = typeof item.tool === "string" ? item.tool : "";
            const status = typeof item.status === "string" ? item.status : "";
            handlers.onTrace(
              ["mcp", `${server} :: ${tool}`.trim(), status ? `status: ${status}` : "", `params: ${safeStringify(item.arguments)}`]
                .filter(Boolean)
                .join("\n")
            );
            continue;
          }
          if (item.type === "web_search") {
            const query = typeof item.query === "string" ? item.query : "";
            if (query) {
              handlers.onTrace(`web search ${query}`);
            }
            continue;
          }
          if (item.type === "error") {
            const message = typeof item.message === "string" ? item.message : "";
            if (message) {
              handlers.onTrace(`error ${message}`);
            }
            continue;
          }
        }

        if (event?.type === "turn.failed") {
          const message = event?.error?.message ? String(event.error.message) : "turn.failed";
          handlers.onTrace(`error ${message}`);
          continue;
        }
      }

      if (spawnError) {
        throw spawnError;
      }
      const { code, signal } = await exitPromise;
      if (this.abortGeneration !== runGeneration) {
        throw createAbortError();
      }
      if (code !== 0 || signal) {
        const stderrBuffer = Buffer.concat(stderrChunks);
        const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
        throw new Error(`Codex Exec exited with ${detail}: ${stderrBuffer.toString("utf8")}`);
      }
    } finally {
      rl.close();
      child.removeAllListeners();
      if (this.activeChild === child) {
        this.activeChild = null;
      }
    }
  }
}
