import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { CliName, ThinkingMode } from "../cli/types";
import { dynamicImport } from "./dynamicImport";
import { logInfo } from "../logger";
import { formatClaudeToolResultMessage, formatClaudeToolUseMessage } from "../trace/claudeToolFormat";

export type ClaudeStreamHandlers = {
  onAssistantDelta: (chunk: string) => void;
  onTrace: (content: string) => void;
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
  onSessionId: (sessionId: string) => void;
  onEvent?: (event: unknown) => void;
};

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

function extractTextFromMessage(message: any): string {
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
      // 兼容处理：如果有 ANTHROPIC_AUTH_TOKEN 但没有 ANTHROPIC_API_KEY，则自动映射
      if (envVars.ANTHROPIC_AUTH_TOKEN && !envVars.ANTHROPIC_API_KEY) {
        envVars.ANTHROPIC_API_KEY = envVars.ANTHROPIC_AUTH_TOKEN;
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
  private disposed = false;
  private abortController: AbortController | null = null;

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

  public updateSessionId(sessionId: string): void {
    (this.options as { sessionId: string | null }).sessionId = sessionId;
  }

  public dispose(): void {
    this.disposed = true;
    this.abortController?.abort();
    this.abortController = null;
  }

  public stopAndRebuild(): void {
    this.abortController?.abort();
    this.abortController = null;
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
    if (this.disposed) {
      throw new Error("runner-disposed");
    }

    const mod = await dynamicImport<any>("@anthropic-ai/claude-agent-sdk");
    const queryFn = mod?.query;
    if (!queryFn) {
      throw new Error("claude-agent-sdk-missing-export");
    }

    // 创建新的 AbortController
    this.abortController = new AbortController();

    const maxThinkingTokens = clampThinkingTokens(this.options.thinkingMode);
    const model = defaultModelFromArgs(this.options.args);
    const cwd = this.options.cwd ?? os.homedir();

    // 从 ~/.claude/settings.json 加载环境变量
    const claudeSettings = await loadClaudeSettings();

    void logInfo("claude-v1-query-start", {
      model,
      cwd,
      maxThinkingTokens,
      sessionId: this.options.sessionId,
      claudeSettingsKeys: Object.keys(claudeSettings),
    });

    const queryOptions: any = {
      cwd,
      model,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // 设置较大的 maxTurns 限制，避免复杂任务被过早中断
      // SDK 默认值为 10，对于交互模式来说太小了
      maxTurns: 200,
      // 传递环境变量给 SDK
      env: {
        ...process.env,
        ...claudeSettings,
      },
    };

    if (typeof maxThinkingTokens === "number") {
      queryOptions.maxThinkingTokens = maxThinkingTokens;
    }

    if (this.options.sessionId) {
      queryOptions.resume = this.options.sessionId;
    }

    let lastAssistantText = "";

    try {
      const queryResult = queryFn({ prompt, options: queryOptions });

      for await (const msg of queryResult as AsyncGenerator<any>) {
        if (this.disposed) {
          break;
        }
        handlers.onEvent?.(msg);

        // 更新 session_id
        if (msg?.session_id && typeof msg.session_id === "string" && msg.session_id !== this.options.sessionId) {
          this.options.sessionId = msg.session_id;
          handlers.onSessionId(msg.session_id);
        }

        // 流式事件
        if (msg?.type === "stream_event" && msg.event) {
          const event = msg.event as any;
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

        // 助手消息
        if (msg?.type === "assistant" && msg.message) {
          const fullText = extractTextFromMessage(msg.message);
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
              handlers.onTrace(formatClaudeToolUseMessage(name || undefined, input));
            }
            if (block.type === "tool_result") {
              const toolName =
                typeof block.name === "string"
                  ? block.name
                  : typeof block.tool_name === "string"
                    ? block.tool_name
                    : undefined;
              handlers.onTrace(formatClaudeToolResultMessage(block.content ?? block, toolName));
            }
          }
          continue;
        }

        // 工具进度
        if (msg?.type === "tool_progress") {
          continue;
        }

        // 系统消息 - Hook 响应
        if (msg?.type === "system" && msg.subtype === "hook_response") {
          const stdout = typeof msg.stdout === "string" ? msg.stdout : "";
          const stderr = typeof msg.stderr === "string" ? msg.stderr : "";
          const content = [
            msg.hook_name ? `hook ${msg.hook_name}` : "hook",
            stdout && `stdout:\n${stdout}`,
            stderr && `stderr:\n${stderr}`,
          ]
            .filter(Boolean)
            .join("\n");
          if (content.trim()) {
            handlers.onTrace(content);
          }
          continue;
        }

        // 系统消息 - 状态
        if (msg?.type === "system" && msg.subtype === "status") {
          if (msg.status) {
            handlers.onTrace(`status: ${String(msg.status)}`);
          }
          continue;
        }

        // 结果消息
        if (msg?.type === "result") {
          const resultText = typeof msg.result === "string" ? msg.result : "";
          if (resultText && !lastAssistantText) {
            handlers.onAssistantDelta(resultText);
          }
          break;
        }
      }
    } finally {
      this.abortController = null;
    }
  }
}
