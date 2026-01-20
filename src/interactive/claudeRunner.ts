import { spawn } from "child_process";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { CliName, ThinkingMode } from "../cli/types";
import { dynamicImport } from "./dynamicImport";
import { logInfo } from "../logger";

export type ClaudeStreamHandlers = {
  onAssistantDelta: (chunk: string) => void;
  onTrace: (content: string) => void;
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
  onSessionId: (sessionId: string) => void;
};

type SpawnOptions = {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
};

function isWindowsCmd(command: string | undefined): boolean {
  if (!command || process.platform !== "win32") {
    return false;
  }
  const lower = command.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

function cmdQuoteArg(value: string): string {
  if (value === "") {
    return "\"\"";
  }
  const needsQuotes = /[ \t"&|<>()^]/.test(value) || value.includes("\"");
  if (!needsQuotes) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function spawnCmdProcess(options: SpawnOptions) {
  const env = options.env ?? process.env;
  const comspec = env.COMSPEC ?? process.env.COMSPEC ?? "cmd.exe";
  const inner = [options.command, ...options.args].map(cmdQuoteArg).join(" ");
  return spawn(comspec, ["/d", "/s", "/c", inner], {
    cwd: options.cwd,
    env,
    signal: options.signal,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function spawnDirectProcess(options: SpawnOptions) {
  return spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function spawnClaudeProcess(options: SpawnOptions) {
  const isCmd = isWindowsCmd(options.command);
  void logInfo("claude-interactive-spawn-options", {
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    isCmd,
  });
  return isCmd ? spawnCmdProcess(options) : spawnDirectProcess(options);
}

function pickArgValue(args: string[], key: string): string | null {
  const index = args.findIndex((arg) => arg === key);
  if (index === -1) {
    return null;
  }
  return index + 1 < args.length ? args[index + 1] ?? null : null;
}

function defaultModelFromArgs(args: string[]): string {
  const fromArg = pickArgValue(args, "--model");
  return fromArg ? fromArg : "sonnet";
}

function resolveBundledClaudeCliPath(): string | null {
  try {
    return require.resolve("@anthropic-ai/claude-agent-sdk/cli.js");
  } catch {
    return null;
  }
}

function formatToolLine(prefix: string, payload: unknown): string {
  if (payload === null || payload === undefined) {
    return prefix;
  }
  if (typeof payload === "string") {
    return `${prefix} ${payload}`;
  }
  try {
    return `${prefix}\n${JSON.stringify(payload, null, 2)}`;
  } catch {
    return `${prefix} ${String(payload)}`;
  }
}

function extractTextFromBetaMessage(message: any): string {
  const content = message?.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block: any) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .join("");
}

function extractTodoWriteItems(input: unknown): { text: string; done: boolean }[] {
  if (typeof input === "string") {
    try {
      return extractTodoWriteItems(JSON.parse(input));
    } catch {
      return [];
    }
  }
  if (!input || typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  const todos = record.todos;
  if (!Array.isArray(todos)) {
    return [];
  }
  return todos
    .map((todo) => {
      if (!todo || typeof todo !== "object") {
        return null;
      }
      const todoRecord = todo as Record<string, unknown>;
      const text =
        typeof todoRecord.content === "string"
          ? todoRecord.content
          : typeof todoRecord.text === "string"
            ? todoRecord.text
            : "";
      if (!text.trim()) {
        return null;
      }
      const status = typeof todoRecord.status === "string" ? todoRecord.status.toLowerCase() : "";
      const done =
        typeof todoRecord.done === "boolean"
          ? todoRecord.done
          : typeof todoRecord.completed === "boolean"
            ? todoRecord.completed
            : status === "completed";
      return { text: text.trim(), done: Boolean(done) };
    })
    .filter((item): item is { text: string; done: boolean } => Boolean(item));
}

function clampThinkingTokens(mode: ThinkingMode): number | null {
  if (mode === "off") {
    return 0;
  }
  if (mode === "low") {
    return 512;
  }
  if (mode === "medium") {
    return 2048;
  }
  if (mode === "high" || mode === "xhigh" || mode === "on") {
    return 8192;
  }
  return null;
}

async function loadClaudeSettings(): Promise<Record<string, string>> {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(content);
    if (settings?.env && typeof settings.env === "object") {
      const envVars: Record<string, string> = {};
      for (const [key, value] of Object.entries(settings.env)) {
        if (typeof value === "string") {
          envVars[key] = value;
        } else if (value !== null && value !== undefined) {
          envVars[key] = String(value);
        }
      }
      return envVars;
    }
  } catch (error) {
    // 配置文件不存在或读取失败，忽略
  }
  return {};
}

export class ClaudeInteractiveRunner {
  public readonly cli: CliName = "claude";
  private session: any | null = null;
  private disposed = false;

  public constructor(
    private readonly options: {
      command: string;
      args: string[];
      cwd?: string;
      thinkingMode: ThinkingMode;
      sessionId: string | null;
    }
  ) {}

  public getSessionId(): string | null {
    return this.options.sessionId ?? null;
  }

  public dispose(): void {
    this.disposed = true;
    try {
      this.session?.close?.();
    } catch {
      // ignore
    }
    this.session = null;
  }

  public stopAndRebuild(): void {
    // Claude Agent SDK doesn't expose an AbortSignal per turn on v2 session.
    // Close the process and rebuild on next run.
    try {
      this.session?.close?.();
    } catch {
      // ignore
    }
    this.session = null;
  }

  private async ensureSession(): Promise<void> {
    if (this.disposed) {
      throw new Error("runner-disposed");
    }
    if (this.session) {
      return;
    }
    const mod = await dynamicImport<any>("@anthropic-ai/claude-agent-sdk");
    const resumeFn = mod?.unstable_v2_resumeSession;
    const createFn = mod?.unstable_v2_createSession;
    if (!resumeFn || !createFn) {
      throw new Error("claude-agent-sdk-missing-export");
    }

    const maxThinkingTokens = clampThinkingTokens(this.options.thinkingMode);
    const model = defaultModelFromArgs(this.options.args);

    const rawCommandOverride =
      this.options.command && this.options.command !== "claude" ? this.options.command : undefined;
    const commandOverride =
      rawCommandOverride && !isWindowsCmd(rawCommandOverride) ? rawCommandOverride : undefined;
    const bundledCliPath = resolveBundledClaudeCliPath();
    const effectiveCliPath = commandOverride ?? bundledCliPath;

    // 从 ~/.claude/settings.json 加载环境变量
    const claudeSettings = await loadClaudeSettings();
    // 将 ANTHROPIC_AUTH_TOKEN 映射为 ANTHROPIC_API_KEY（SDK 可能使用这个名字）
    if (claudeSettings.ANTHROPIC_AUTH_TOKEN && !claudeSettings.ANTHROPIC_API_KEY) {
      claudeSettings.ANTHROPIC_API_KEY = claudeSettings.ANTHROPIC_AUTH_TOKEN;
    }

    void logInfo("claude-interactive-spawn-path", {
      command: this.options.command,
      commandOverride,
      commandOverrideIsCmd: rawCommandOverride ? isWindowsCmd(rawCommandOverride) : false,
      ignoredCommandOverride: commandOverride ? undefined : rawCommandOverride,
      bundledCliPath,
      effectiveCliPath,
      execPath: process.execPath,
      cwd: this.options.cwd,
      claudeSettingsKeys: Object.keys(claudeSettings),
    });

    const sessionOptions: any = {
      model,
      cwd: this.options.cwd ?? os.homedir(),
      env: {
        ...process.env,
        HOME: os.homedir(),
        USERPROFILE: os.homedir(),
        ...claudeSettings,
      },
      pathToClaudeCodeExecutable: commandOverride,
      permissionMode: "bypassPermissions",
      // auto-allow everything (matches `--dangerously-skip-permissions` intent)
      canUseTool: async (_toolName: string, _input: Record<string, unknown>, extra: any) => ({
        behavior: "allow",
        toolUseID: extra?.toolUseID,
      }),
    };
    if (typeof maxThinkingTokens === "number") {
      sessionOptions.maxThinkingTokens = maxThinkingTokens;
    }
    sessionOptions.spawnClaudeCodeProcess = (spawnOptions: SpawnOptions) =>
      spawnClaudeProcess(spawnOptions);

    this.session = this.options.sessionId
      ? resumeFn(this.options.sessionId, sessionOptions)
      : createFn(sessionOptions);
  }

  public async runForText(prompt: string): Promise<{ sessionId: string | null; text: string }> {
    const chunks: string[] = [];
    const handlers: ClaudeStreamHandlers = {
      onAssistantDelta: (chunk) => chunks.push(chunk),
      onTrace: () => {},
      onTaskListUpdate: () => {},
      onSessionId: () => {},
    };
    await this.runStreamed(prompt, handlers);
    return { sessionId: this.getSessionId(), text: chunks.join("") };
  }

  public async runStreamed(prompt: string, handlers: ClaudeStreamHandlers): Promise<void> {
    await this.ensureSession();
    if (!this.session) {
      throw new Error("claude-session-missing");
    }

    await this.session.send(prompt);

    let lastAssistantText = "";

    for await (const msg of this.session.stream() as AsyncGenerator<any>) {
      if (msg?.session_id && typeof msg.session_id === "string" && msg.session_id !== this.options.sessionId) {
        this.options.sessionId = msg.session_id;
        handlers.onSessionId(msg.session_id);
      }

      if (msg?.type === "stream_event" && msg.event) {
        const event = msg.event as any;
        // Anthropic raw stream event shape: content_block_delta.delta.text
        const deltaText =
          typeof event?.delta?.text === "string"
            ? event.delta.text
            : typeof event?.delta?.type === "string" && event.delta.type === "text_delta" && typeof event.delta.text === "string"
              ? event.delta.text
              : "";
        if (deltaText) {
          handlers.onAssistantDelta(deltaText);
        }
        continue;
      }

      if (msg?.type === "assistant" && msg.message) {
        const fullText = extractTextFromBetaMessage(msg.message);
        if (fullText) {
          const delta = fullText.startsWith(lastAssistantText)
            ? fullText.slice(lastAssistantText.length)
            : fullText;
          if (delta) {
            handlers.onAssistantDelta(delta);
          }
          lastAssistantText = fullText;
        }

        const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
        for (const block of blocks as any[]) {
          if (!block || typeof block !== "object") {
            continue;
          }
          if (block.type === "tool_use") {
            const name = typeof block.name === "string" ? block.name : "";
            const input = block.input;
            if (name === "TodoWrite") {
              const items = extractTodoWriteItems(input);
              if (items.length) {
                handlers.onTaskListUpdate(items);
              }
            }
            handlers.onTrace(formatToolLine(`【工具调用】${name}`.trim(), input));
          }
          if (block.type === "tool_result") {
            handlers.onTrace(formatToolLine("【工具结果】", block.content ?? block));
          }
        }
        continue;
      }

      if (msg?.type === "tool_progress") {
        handlers.onTrace(`【工具执行中】${msg.tool_name ?? ""}`.trim());
        continue;
      }

      if (msg?.type === "system" && msg.subtype === "hook_response") {
        const stdout = typeof msg.stdout === "string" ? msg.stdout : "";
        const stderr = typeof msg.stderr === "string" ? msg.stderr : "";
        const content = [msg.hook_name ? `【Hook】${msg.hook_name}` : "【Hook】", stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`]
          .filter(Boolean)
          .join("\n");
        if (content.trim()) {
          handlers.onTrace(content);
        }
        continue;
      }

      if (msg?.type === "system" && msg.subtype === "status") {
        if (msg.status) {
          handlers.onTrace(`【状态】${String(msg.status)}`);
        }
        continue;
      }

      if (msg?.type === "result") {
        // End of this turn.
        const resultText = typeof msg.result === "string" ? msg.result : "";
        if (resultText && !lastAssistantText) {
          handlers.onAssistantDelta(resultText);
        }
        break;
      }
    }
  }
}
