import { CliName, ThinkingMode } from "../cli/types";
import { dynamicImport } from "./dynamicImport";

export type CodexTraceKind = "thinking" | "normal";

export type CodexStreamHandlers = {
  onAssistantDelta: (chunk: string) => void;
  onTrace: (content: string, kind?: CodexTraceKind) => void;
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
  onThreadId: (threadId: string) => void;
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

function buildCodexThreadOptions(args: string[], cwd: string | undefined, thinkingMode: ThinkingMode): CodexThreadOptions {
  const options: CodexThreadOptions = {
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    modelReasoningEffort: mapCodexReasoningEffort(thinkingMode),
  };

  const model = pickArgValue(args, ["--model", "-m"]);
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

  return options;
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

export class CodexInteractiveRunner {
  public readonly cli: CliName = "codex";
  private codex: any | null = null;
  private thread: any | null = null;
  private abortController: AbortController | null = null;
  private disposed = false;

  public constructor(
    private readonly options: {
      command: string;
      args: string[];
      cwd?: string;
      thinkingMode: ThinkingMode;
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
    if (this.codex) {
      return;
    }
    const mod = await dynamicImport<any>("@openai/codex-sdk");
    const CodexCtor = mod?.Codex;
    if (!CodexCtor) {
      throw new Error("codex-sdk-missing-export");
    }
    const override =
      this.options.command && this.options.command !== "codex" ? this.options.command : undefined;
    this.codex = new CodexCtor(
      override ? { codexPathOverride: override } : undefined
    );
  }

  private async ensureThread(): Promise<void> {
    await this.ensureReady();
    if (this.thread) {
      return;
    }
    const threadOptions = buildCodexThreadOptions(
      this.options.args,
      this.options.cwd,
      this.options.thinkingMode
    );
    if (this.options.threadId) {
      this.thread = this.codex.resumeThread(this.options.threadId, threadOptions);
    } else {
      this.thread = this.codex.startThread(threadOptions);
    }
  }

  public rebuild(): void {
    this.thread = null;
  }

  public stopAndRebuild(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.rebuild();
  }

  public dispose(): void {
    this.disposed = true;
    this.stopAndRebuild();
    this.codex = null;
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
    await this.ensureThread();
    if (!this.thread) {
      throw new Error("codex-thread-missing");
    }
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const streamed = await this.thread.runStreamed(prompt, { signal });
    let lastAgentText = "";

    for await (const event of streamed.events as AsyncGenerator<any>) {
      if (event?.type === "thread.started" && typeof event.thread_id === "string") {
        this.options.threadId = event.thread_id;
        handlers.onThreadId(event.thread_id);
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
          const text = typeof item.text === "string" ? item.text : "";
          if (text.trim()) {
            handlers.onTrace(text, "thinking");
          }
          continue;
        }
        if (item.type === "command_execution") {
          const command = typeof item.command === "string" ? item.command : "";
          const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
          const status = typeof item.status === "string" ? item.status : "";
          const exitCode = item.exit_code !== undefined ? String(item.exit_code) : "";
          const lines = [
            `【执行命令】${command}`.trim(),
            status ? `状态：${status}${exitCode ? `（exit=${exitCode}）` : ""}` : "",
            output ? `输出：\n${output}` : "",
          ].filter(Boolean);
          handlers.onTrace(lines.join("\n"));
          continue;
        }
        if (item.type === "file_change") {
          const status = typeof item.status === "string" ? item.status : "";
          const changes = Array.isArray(item.changes) ? item.changes : [];
          const list = changes
            .map((c: any) => (c && typeof c.path === "string" ? `${c.kind ?? "update"}: ${c.path}` : ""))
            .filter(Boolean);
          handlers.onTrace(["【文件变更】", status ? `状态：${status}` : "", ...list].filter(Boolean).join("\n"));
          continue;
        }
        if (item.type === "mcp_tool_call") {
          const server = typeof item.server === "string" ? item.server : "";
          const tool = typeof item.tool === "string" ? item.tool : "";
          const status = typeof item.status === "string" ? item.status : "";
          handlers.onTrace(
            ["【MCP】", `${server} :: ${tool}`.trim(), status ? `状态：${status}` : "", `参数：${safeStringify(item.arguments)}`]
              .filter(Boolean)
              .join("\n")
          );
          continue;
        }
        if (item.type === "web_search") {
          const query = typeof item.query === "string" ? item.query : "";
          if (query) {
            handlers.onTrace(`【Web 搜索】${query}`);
          }
          continue;
        }
        if (item.type === "error") {
          const message = typeof item.message === "string" ? item.message : "";
          if (message) {
            handlers.onTrace(`【错误】${message}`);
          }
          continue;
        }
      }

      if (event?.type === "turn.failed") {
        const message = event?.error?.message ? String(event.error.message) : "turn.failed";
        handlers.onTrace(`【失败】${message}`);
        continue;
      }
    }

    this.abortController = null;
  }
}
