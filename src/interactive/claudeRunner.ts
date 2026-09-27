import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { t } from "../i18n";
import { dynamicImport } from "./dynamicImport";
import { isClaudeCompactBoundaryMessage, isClaudeCompactingStatusMessage } from "./claudeCompaction";
import { logInfo } from "../logger";
import { formatClaudeToolResultMessage, formatClaudeToolUseMessage } from "../trace/claudeToolFormat";
import {
  ClaudeTaskListTracker,
  extractClaudeTodoWriteItems,
  hasClaudeTodoWriteResultShape,
} from "./claudeTaskList";

const CLAUDE_SUCCESSFUL_RESULT_SUBTYPES = new Set(["", "success"]);

function normalizeClaudeStopReason(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function readClaudeAssistantStopReason(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "";
  }
  const record = event as Record<string, unknown>;
  if (record.type === "assistant") {
    const message = record.message;
    if (!message || typeof message !== "object") {
      return "";
    }
    const messageRecord = message as Record<string, unknown>;
    return normalizeClaudeStopReason(messageRecord.stop_reason ?? messageRecord.stopReason);
  }
  if (record.type !== "stream_event" || !record.event || typeof record.event !== "object") {
    return "";
  }
  const streamEvent = record.event as Record<string, unknown>;
  const eventType = typeof streamEvent.type === "string" ? streamEvent.type : "";
  if (eventType !== "message_delta" && eventType !== "message_stop") {
    return "";
  }
  const delta = streamEvent.delta;
  if (delta && typeof delta === "object") {
    const deltaRecord = delta as Record<string, unknown>;
    const deltaReason = normalizeClaudeStopReason(deltaRecord.stop_reason ?? deltaRecord.stopReason);
    if (deltaReason) {
      return deltaReason;
    }
  }
  return normalizeClaudeStopReason(streamEvent.stop_reason ?? streamEvent.stopReason);
}

export function isClaudeEndTurnStop(event: unknown): boolean {
  return readClaudeAssistantStopReason(event) === "end_turn";
}

export function isClaudeToolUseStop(event: unknown): boolean {
  return readClaudeAssistantStopReason(event) === "tool_use";
}

export function isClaudeSuccessfulFinalResult(event: unknown): boolean {
  if (!event || typeof event !== "object") {
    return false;
  }
  const record = event as Record<string, unknown>;
  if (record.type !== "result") {
    return false;
  }
  if (record.is_error === true) {
    return false;
  }
  const subtype = typeof record.subtype === "string" ? record.subtype.trim().toLowerCase() : "";
  if (subtype.startsWith("error")) {
    return false;
  }
  return CLAUDE_SUCCESSFUL_RESULT_SUBTYPES.has(subtype);
}

export function isClaudeFailedFinalResult(event: unknown): boolean {
  if (!event || typeof event !== "object") {
    return false;
  }
  const record = event as Record<string, unknown>;
  if (record.type !== "result") {
    return false;
  }
  if (record.is_error === true) {
    return true;
  }
  const subtype = typeof record.subtype === "string" ? record.subtype.trim().toLowerCase() : "";
  return subtype.startsWith("error");
}

export type ClaudeTraceKind = "thinking" | "normal" | "tool-use";

export type ClaudeTraceMeta = {
  merge?: boolean;
};

export type ClaudeStreamHandlers = {
  onAssistantDelta: (chunk: string) => void;
  onTrace: (content: string, kind?: ClaudeTraceKind, meta?: ClaudeTraceMeta) => void;
  onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
  onSessionId: (sessionId: string) => void;
  onEvent?: (event: unknown) => void;
};

export type ClaudeCompactionResult = {
  compacted: boolean;
  previousSessionId: string | null;
  sessionId: string | null;
};

type ClaudeToolUseEvent = {
  id?: string;
  name?: string;
  input?: unknown;
};

type ClaudeToolResultEvent = {
  toolUseId?: string;
  toolName?: string;
  content?: unknown;
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
  if (mode === "high" || mode === "xhigh" || mode === "ultra" || mode === "max" || mode === "on") {
    return 8192;
  }
  return null;
}

export function mapClaudeThinkingEffort(
  mode: ThinkingMode
): "low" | "medium" | "high" | "xhigh" | "ultra" | "max" | null {
  if (mode === "off") {
    return null;
  }
  if (
    mode === "low"
    || mode === "medium"
    || mode === "high"
    || mode === "xhigh"
    || mode === "ultra"
    || mode === "max"
  ) {
    return mode;
  }
  if (mode === "on") {
    return "high";
  }
  return null;
}

function isUnsupportedEffortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:unknown|unsupported|unexpected|invalid).*(?:--effort|effort)|(?:--effort|effort).*(?:unknown|unsupported|unexpected|invalid)/i.test(message);
}

function getMessageContentBlocks(message: unknown): Record<string, unknown>[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"
  );
}

function extractThinkingText(block: Record<string, unknown>): string {
  if (block.type !== "thinking") {
    return "";
  }
  if (typeof block.thinking === "string") {
    return block.thinking;
  }
  if (typeof block.text === "string") {
    return block.text;
  }
  return "";
}

function extractToolUseEvent(block: Record<string, unknown>): ClaudeToolUseEvent | null {
  if (block.type !== "tool_use") {
    return null;
  }
  const id = typeof block.id === "string" ? block.id : undefined;
  const name = typeof block.name === "string" ? block.name : undefined;
  return {
    id,
    name,
    input: block.input,
  };
}

function extractToolResultEvent(block: Record<string, unknown>): ClaudeToolResultEvent | null {
  if (block.type !== "tool_result") {
    return null;
  }
  const toolUseId =
    typeof block.tool_use_id === "string"
      ? block.tool_use_id
      : typeof block.toolUseId === "string"
        ? block.toolUseId
        : undefined;
  const toolName =
    typeof block.name === "string"
      ? block.name
      : typeof block.tool_name === "string"
        ? block.tool_name
        : undefined;
  return {
    toolUseId,
    toolName,
    content: Object.prototype.hasOwnProperty.call(block, "content") ? block.content : block,
  };
}

function extractFirstToolResultUseId(blocks: Record<string, unknown>[]): string | undefined {
  for (const block of blocks) {
    if (block.type !== "tool_result") {
      continue;
    }
    if (typeof block.tool_use_id === "string") {
      return block.tool_use_id;
    }
    if (typeof block.toolUseId === "string") {
      return block.toolUseId;
    }
  }
  return undefined;
}

function extractSessionNotFoundErrorMessage(msg: any): string | null {
  if (!msg || msg.type !== "result") {
    return null;
  }
  const subtype = typeof msg.subtype === "string" ? msg.subtype : "";
  const isError = msg.is_error === true || subtype === "error_during_execution";
  if (!isError) {
    return null;
  }
  const errors = Array.isArray(msg.errors)
    ? msg.errors.filter((item: unknown): item is string => typeof item === "string")
    : [];
  const matched = errors.find((item: string) => /No conversation found with session ID:/i.test(item));
  return matched ?? null;
}

function buildClaudeCompactPrompt(customInstructions?: string): string {
  const normalizedInstructions = typeof customInstructions === "string"
    ? customInstructions.trim()
    : "";
  return normalizedInstructions ? `/compact ${normalizedInstructions}` : "/compact";
}

function extractDeltaTextFromStreamEvent(event: any): string {
  if (typeof event?.delta?.text === "string") {
    return event.delta.text;
  }
  if (
    typeof event?.delta?.type === "string"
    && event.delta.type === "text_delta"
    && typeof event.delta.text === "string"
  ) {
    return event.delta.text;
  }
  if (typeof event?.content_block?.text === "string" && event.type === "content_block_delta") {
    return event.content_block.text;
  }
  return "";
}

function extractBlocksFromStreamEvent(event: any): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const pushBlock = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }
    blocks.push(value as Record<string, unknown>);
  };
  pushBlock(event?.content_block);
  pushBlock(event?.contentBlock);
  pushBlock(event?.block);
  pushBlock(event?.delta?.content_block);
  pushBlock(event?.delta?.contentBlock);
  const messageBlocks = getMessageContentBlocks(event?.message);
  if (messageBlocks.length) {
    blocks.push(...messageBlocks);
  }
  return blocks;
}

function createRunnerDisposedError(): Error {
  const error = new Error(t("run.disposedExternally")) as Error & { code?: string };
  error.name = "RunnerDisposedError";
  error.code = "RUNNER_DISPOSED";
  return error;
}

function createAbortError(): Error {
  const error = new Error("Claude run aborted");
  error.name = "AbortError";
  return error;
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

type ClaudeSdkUserMessage = {
  type: "user";
  session_id: string;
  message: {
    role: "user";
    content: Array<{ type: "text"; text: string }>;
  };
  parent_tool_use_id: null;
};

type ClaudeQuery = AsyncIterable<any> & {
  interrupt?: () => Promise<void> | void;
};

type ClaudePersistentSession = {
  query: ClaudeQuery;
  input: ClaudePromptInput;
  abortController: AbortController;
  closed: boolean;
};

type ClaudeActiveTurn = {
  abortGeneration: number;
  disposeGeneration: number;
  settled: boolean;
  handlers: ClaudeStreamHandlers;
  resolve: () => void;
  reject: (error: Error) => void;
  done: Promise<void>;
  handle: (message: any) => boolean;
};

class ClaudePromptInput implements AsyncIterable<ClaudeSdkUserMessage> {
  private readonly queued: ClaudeSdkUserMessage[] = [];
  private readonly waiters: Array<(result: IteratorResult<ClaudeSdkUserMessage>) => void> = [];
  private finished = false;

  public enqueue(prompt: string): void {
    if (this.finished) {
      throw new Error("Claude persistent input is closed");
    }
    const message: ClaudeSdkUserMessage = {
      type: "user",
      session_id: "",
      message: {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
      parent_tool_use_id: null,
    };
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: message, done: false });
      return;
    }
    this.queued.push(message);
  }

  public finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as unknown as ClaudeSdkUserMessage, done: true });
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<ClaudeSdkUserMessage> {
    return {
      next: (): Promise<IteratorResult<ClaudeSdkUserMessage>> => {
        const nextMessage = this.queued.shift();
        if (nextMessage) {
          return Promise.resolve({ value: nextMessage, done: false });
        }
        if (this.finished) {
          return Promise.resolve({ value: undefined as unknown as ClaudeSdkUserMessage, done: true });
        }
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

function isTerminalClaudeSessionResult(message: any): boolean {
  if (!message || message.type !== "result") {
    return false;
  }
  const subtype = typeof message.subtype === "string" ? message.subtype.trim().toLowerCase() : "";
  return subtype === "error_max_turns" || subtype === "error_max_budget_usd";
}

export class ClaudeInteractiveRunner {
  public readonly cli: CliName = "claude";
  private disposed = false;
  private abortGeneration = 0;
  private disposeGeneration = 0;
  private legacyThinking = false;
  private session: ClaudePersistentSession | null = null;
  private activeTurn: ClaudeActiveTurn | null = null;
  private operationTail: Promise<unknown> = Promise.resolve();
  private turnGate: Promise<void> | null = null;
  private releaseTurnGate: (() => void) | null = null;

  public constructor(
    private readonly options: {
      command: string;
      args: string[];
      cwd?: string;
      thinkingMode: ThinkingMode;
      interactiveMode: InteractiveMode;
      model?: string | null;
      entrypoint?: string;
      sessionId: string | null;
      isolateProjectInstructions?: boolean;
    }
  ) {}

  public getSessionId(): string | null {
    return this.options.sessionId ?? null;
  }

  public updateSessionId(sessionId: string): void {
    if (this.options.sessionId === sessionId) {
      return;
    }
    (this.options as { sessionId: string | null }).sessionId = sessionId;
    if (this.session && !this.session.closed) {
      this.closeSession();
    }
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeGeneration += 1;
    this.settleActive(createRunnerDisposedError());
    this.closeSession();
  }

  public stopAndRebuild(): void {
    this.abortGeneration += 1;
    const session = this.session;
    const hasActiveTurn = this.activeTurn !== null;
    const canInterrupt = Boolean(
      hasActiveTurn
      && session
      && !session.closed
      && typeof session.query.interrupt === "function"
    );
    if (canInterrupt && session) {
      this.armTurnGate();
      void Promise.resolve(session.query.interrupt?.()).catch(() => {
        this.closeSession();
      });
      this.settleActive(createAbortError());
      return;
    }
    this.settleActive(createAbortError());
    if (hasActiveTurn || !session || session.closed) {
      this.closeSession();
    }
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

  public async compactSession(customInstructions?: string): Promise<ClaudeCompactionResult> {
    const previousSessionId = this.getSessionId();
    if (!previousSessionId) {
      throw new Error("Claude session not established");
    }

    let sawCompactingStatus = false;
    let sawCompactBoundary = false;
    const handlers: ClaudeStreamHandlers = {
      onAssistantDelta: () => {},
      onTrace: () => {},
      onTaskListUpdate: () => {},
      onSessionId: () => {},
      onEvent: (event) => {
        if (isClaudeCompactingStatusMessage(event)) {
          sawCompactingStatus = true;
        }
        if (isClaudeCompactBoundaryMessage(event)) {
          sawCompactBoundary = true;
        }
      },
    };

    await this.runStreamed(buildClaudeCompactPrompt(customInstructions), handlers);

    const sessionId = this.getSessionId();
    return {
      compacted: sawCompactingStatus || sawCompactBoundary || sessionId !== previousSessionId,
      previousSessionId,
      sessionId,
    };
  }

  public async runStreamed(prompt: string, handlers: ClaudeStreamHandlers): Promise<void> {
    if (this.disposed) {
      throw createRunnerDisposedError();
    }
    const abortGeneration = this.abortGeneration;
    const disposeGeneration = this.disposeGeneration;
    await this.enqueue(() => this.runTurn(prompt, handlers, abortGeneration, disposeGeneration));
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.operationTail.then(operation, operation);
    this.operationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async runTurn(
    prompt: string,
    handlers: ClaudeStreamHandlers,
    abortGeneration: number,
    disposeGeneration: number,
  ): Promise<void> {
    try {
      await this.executeTurn(prompt, handlers, abortGeneration, disposeGeneration, false);
    } catch (error) {
      const thinkingEffort = mapClaudeThinkingEffort(this.options.thinkingMode);
      if (this.legacyThinking || !thinkingEffort || !isUnsupportedEffortError(error)) {
        throw error;
      }
      this.legacyThinking = true;
      this.closeSession();
      void logInfo("claude-effort-fallback-max-thinking-tokens", {
        thinkingEffort,
        maxThinkingTokens: clampThinkingTokens(this.options.thinkingMode),
        error: error instanceof Error ? error.message : String(error),
      });
      await this.executeTurn(prompt, handlers, abortGeneration, disposeGeneration, true);
    }
  }

  private async executeTurn(
    prompt: string,
    handlers: ClaudeStreamHandlers,
    abortGeneration: number,
    disposeGeneration: number,
    legacyThinking: boolean,
  ): Promise<void> {
    this.throwIfSuperseded(abortGeneration, disposeGeneration);
    await this.waitForTurnGate();
    this.throwIfSuperseded(abortGeneration, disposeGeneration);
    const turn = this.beginTurn(handlers, abortGeneration, disposeGeneration);
    try {
      await this.ensureSession(abortGeneration, disposeGeneration, legacyThinking);
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
      const session = this.session;
      if (!session || session.closed) {
        throw new Error("Claude persistent session is unavailable");
      }
      session.input.enqueue(prompt);
      await turn.done;
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
    } catch (error) {
      if (this.activeTurn === turn) {
        this.settleActive(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  private beginTurn(
    handlers: ClaudeStreamHandlers,
    abortGeneration: number,
    disposeGeneration: number,
  ): ClaudeActiveTurn {
    let resolveTurn: (() => void) | null = null;
    let rejectTurn: ((error: Error) => void) | null = null;
    const done = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });
    done.catch(() => undefined);
    let lastAssistantText = "";
    const seenToolUseTraceIds = new Set<string>();
    const seenToolResultTraceIds = new Set<string>();
    const seenTodoToolUseIds = new Set<string>();
    const seenTodoToolResultIds = new Set<string>();
    const toolUseNames = new Map<string, string>();
    const seenThinkingKeys = new Set<string>();
    const taskListTracker = new ClaudeTaskListTracker();

    const emitTaskListUpdate = (items: { text: string; done: boolean }[] | null): void => {
      if (items) {
        handlers.onTaskListUpdate(items);
      }
    };

    const emitThinkingTrace = (
      source: string,
      messageId: string | undefined,
      block: Record<string, unknown>,
      blockIndex: number
    ): void => {
      const rawText = extractThinkingText(block);
      const normalizedText = rawText.trim();
      if (!normalizedText) {
        return;
      }
      const signature = typeof block.signature === "string" ? block.signature : "";
      const key = [source, messageId ?? "", signature || normalizedText, String(blockIndex)].join("::");
      if (seenThinkingKeys.has(key)) {
        return;
      }
      seenThinkingKeys.add(key);
      const content = /^(?:thinking|思考)\b/i.test(normalizedText)
        ? normalizedText
        : `thinking ${normalizedText}`;
      handlers.onTrace(content, "thinking", { merge: false });
    };

    const emitToolUseTrace = (toolUse: ClaudeToolUseEvent): void => {
      if (toolUse.id && toolUse.name) {
        toolUseNames.set(toolUse.id, toolUse.name);
      }
      emitTaskListUpdate(taskListTracker.recordToolUse(toolUse));
      if (toolUse.name === "TodoWrite") {
        const items = extractClaudeTodoWriteItems(toolUse.input);
        if (items.length) {
          if (toolUse.id) {
            if (!seenTodoToolUseIds.has(toolUse.id)) {
              seenTodoToolUseIds.add(toolUse.id);
              handlers.onTaskListUpdate(items);
            }
          } else {
            handlers.onTaskListUpdate(items);
          }
        }
      }
      if (toolUse.id && seenToolUseTraceIds.has(toolUse.id)) {
        return;
      }
      if (toolUse.id) {
        seenToolUseTraceIds.add(toolUse.id);
      }
      handlers.onTrace(
        formatClaudeToolUseMessage(toolUse.name, toolUse.input),
        "tool-use",
        { merge: false }
      );
    };

    const emitToolResultTrace = (toolResult: ClaudeToolResultEvent): void => {
      const resolvedToolName =
        toolResult.toolName
        ?? (toolResult.toolUseId ? toolUseNames.get(toolResult.toolUseId) : undefined);
      emitTaskListUpdate(taskListTracker.recordToolResult({
        toolUseId: toolResult.toolUseId,
        toolName: resolvedToolName,
        content: toolResult.content,
      }));
      if (resolvedToolName === "TodoWrite") {
        const items = extractClaudeTodoWriteItems(toolResult.content);
        if (items.length) {
          if (toolResult.toolUseId) {
            if (!seenTodoToolResultIds.has(toolResult.toolUseId)) {
              seenTodoToolResultIds.add(toolResult.toolUseId);
              handlers.onTaskListUpdate(items);
            }
          } else {
            handlers.onTaskListUpdate(items);
          }
        }
      }
      if (toolResult.toolUseId && seenToolResultTraceIds.has(toolResult.toolUseId)) {
        return;
      }
      if (toolResult.toolUseId) {
        seenToolResultTraceIds.add(toolResult.toolUseId);
      }
      handlers.onTrace(
        formatClaudeToolResultMessage(toolResult.content, resolvedToolName),
        "normal",
        { merge: false }
      );
    };

    const processMessageBlocks = (
      blocks: Record<string, unknown>[],
      source: string,
      messageId?: string
    ): void => {
      blocks.forEach((block, blockIndex) => {
        emitThinkingTrace(source, messageId, block, blockIndex);
        const toolUse = extractToolUseEvent(block);
        if (toolUse) {
          emitToolUseTrace(toolUse);
          return;
        }
        const toolResult = extractToolResultEvent(block);
        if (toolResult) {
          emitToolResultTrace(toolResult);
        }
      });
    };

    const turn: ClaudeActiveTurn = {
      abortGeneration,
      disposeGeneration,
      settled: false,
      handlers,
      resolve: () => resolveTurn?.(),
      reject: (error) => rejectTurn?.(error),
      done,
      handle: (msg: any): boolean => {
        handlers.onEvent?.(msg);
        if (msg?.type === "stream_event" && msg.event) {
          const event = msg.event as any;
          const deltaText = extractDeltaTextFromStreamEvent(event);
          if (deltaText) {
            handlers.onAssistantDelta(deltaText);
          }
          const eventBlocks = extractBlocksFromStreamEvent(event);
          if (eventBlocks.length) {
            const streamMessageId =
              typeof event?.message?.id === "string"
                ? event.message.id
                : typeof event?.id === "string"
                  ? event.id
                  : undefined;
            processMessageBlocks(eventBlocks, "stream_event", streamMessageId);
          }
          return false;
        }

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
          const blocks = getMessageContentBlocks(msg.message);
          if (blocks.length) {
            const messageId = typeof msg.message?.id === "string" ? msg.message.id : undefined;
            processMessageBlocks(blocks, "assistant", messageId);
          }
          return false;
        }

        if (msg?.type === "user" && msg.message) {
          const blocks = getMessageContentBlocks(msg.message);
          if (blocks.length) {
            const messageId = typeof msg.message?.id === "string" ? msg.message.id : undefined;
            processMessageBlocks(blocks, "user", messageId);
          }
          if (Object.prototype.hasOwnProperty.call(msg, "tool_use_result")) {
            const toolUseResult = (msg as Record<string, unknown>).tool_use_result;
            const toolUseId = extractFirstToolResultUseId(blocks);
            const toolName = toolUseId ? toolUseNames.get(toolUseId) : undefined;
            emitTaskListUpdate(taskListTracker.recordToolResult({
              toolUseId,
              toolName,
              content: toolUseResult,
            }));
            if (hasClaudeTodoWriteResultShape(toolUseResult)) {
              const items = extractClaudeTodoWriteItems(toolUseResult);
              if (items.length) {
                handlers.onTaskListUpdate(items);
              }
            }
          }
          return false;
        }

        if (msg?.type === "tool_progress") {
          return false;
        }

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
          return false;
        }

        if (msg?.type === "system" && msg.subtype === "status") {
          if (msg.status) {
            handlers.onTrace(`status: ${String(msg.status)}`);
          }
          return false;
        }

        if (msg?.type === "result") {
          const sessionNotFound = extractSessionNotFoundErrorMessage(msg);
          if (sessionNotFound) {
            const error = new Error(sessionNotFound) as Error & { code?: string };
            error.code = "CLAUDE_SESSION_NOT_FOUND";
            throw error;
          }
          const resultText = typeof msg.result === "string" ? msg.result : "";
          if (resultText && !lastAssistantText) {
            handlers.onAssistantDelta(resultText);
          }
          return true;
        }
        return false;
      },
    };
    this.activeTurn = turn;
    return turn;
  }

  private async ensureSession(
    abortGeneration: number,
    disposeGeneration: number,
    legacyThinking: boolean,
  ): Promise<void> {
    if (this.session && !this.session.closed) {
      return;
    }
    const mod = await dynamicImport<any>("@anthropic-ai/claude-agent-sdk");
    this.throwIfSuperseded(abortGeneration, disposeGeneration);
    const queryFn = mod?.query;
    if (typeof queryFn !== "function") {
      throw new Error("claude-agent-sdk-missing-export");
    }

    const thinkingEffort = mapClaudeThinkingEffort(this.options.thinkingMode);
    const maxThinkingTokens = clampThinkingTokens(this.options.thinkingMode);
    const model = typeof this.options.model === "string" && this.options.model.trim()
      ? this.options.model.trim()
      : defaultModelFromArgs(this.options.args);
    const cwd = this.options.cwd ?? os.homedir();
    const claudeSettings = await loadClaudeSettings();
    this.throwIfSuperseded(abortGeneration, disposeGeneration);

    const abortController = new AbortController();
    const queryOptions: any = {
      cwd,
      model,
      permissionMode: this.options.interactiveMode === "plan" ? "plan" : "bypassPermissions",
      settingSources: this.options.isolateProjectInstructions ? [] : ["user", "project", "local"],
      pathToClaudeCodeExecutable: this.options.entrypoint,
      maxTurns: 200,
      env: {
        ...process.env,
        ...claudeSettings,
      },
      abortController,
    };
    if (queryOptions.permissionMode === "bypassPermissions") {
      queryOptions.allowDangerouslySkipPermissions = true;
    }
    if (!legacyThinking && thinkingEffort) {
      queryOptions.extraArgs = { effort: thinkingEffort };
    } else if (typeof maxThinkingTokens === "number") {
      queryOptions.maxThinkingTokens = maxThinkingTokens;
    }
    if (this.options.sessionId) {
      queryOptions.resume = this.options.sessionId;
    }

    const input = new ClaudePromptInput();
    void logInfo("claude-persistent-session-open", {
      model,
      cwd,
      thinkingEffort: legacyThinking ? null : thinkingEffort,
      maxThinkingTokens,
      interactiveMode: this.options.interactiveMode,
      sessionId: this.options.sessionId,
      isolateProjectInstructions: this.options.isolateProjectInstructions === true,
      resumed: Boolean(this.options.sessionId),
    });
    const query = queryFn({ prompt: input, options: queryOptions }) as ClaudeQuery;
    const session: ClaudePersistentSession = {
      query,
      input,
      abortController,
      closed: false,
    };
    this.session = session;
    void this.readLoop(session);
    if (
      this.disposed
      || this.disposeGeneration !== disposeGeneration
      || this.abortGeneration !== abortGeneration
    ) {
      this.closeSession();
      this.throwIfSuperseded(abortGeneration, disposeGeneration);
    }
  }

  private async readLoop(session: ClaudePersistentSession): Promise<void> {
    let streamError: Error | null = null;
    try {
      for await (const message of session.query) {
        if (session.closed || this.session !== session) {
          return;
        }
        this.dispatchMessage(message);
      }
    } catch (error) {
      streamError = this.normalizeStreamError(error);
    } finally {
      if (this.session === session && !session.closed) {
        this.closeSession();
        if (this.activeTurn) {
          this.settleActive(streamError ?? new Error("Claude persistent session ended"));
        }
      }
      this.openTurnGate();
    }
  }

  private dispatchMessage(message: any): void {
    this.captureSessionId(message);
    const turn = this.activeTurn;
    if (!turn || turn.settled) {
      if (message?.type === "result") {
        this.openTurnGate();
        if (isTerminalClaudeSessionResult(message)) {
          this.closeSession();
        }
      }
      return;
    }
    try {
      const completed = turn.handle(message);
      if (!completed) {
        return;
      }
      const terminal = isTerminalClaudeSessionResult(message);
      this.finishActiveTurn(turn);
      this.openTurnGate();
      if (terminal) {
        this.closeSession();
      }
    } catch (error) {
      this.closeSession();
      this.openTurnGate();
      this.settleActive(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private captureSessionId(message: any): void {
    if (!message?.session_id || typeof message.session_id !== "string") {
      return;
    }
    if (message.session_id === this.options.sessionId) {
      return;
    }
    (this.options as { sessionId: string | null }).sessionId = message.session_id;
    this.activeTurn?.handlers.onSessionId(message.session_id);
  }

  private finishActiveTurn(turn: ClaudeActiveTurn): void {
    if (this.activeTurn !== turn || turn.settled) {
      return;
    }
    turn.settled = true;
    this.activeTurn = null;
    turn.resolve();
  }

  private settleActive(error: Error): void {
    const turn = this.activeTurn;
    if (!turn || turn.settled) {
      return;
    }
    turn.settled = true;
    this.activeTurn = null;
    turn.reject(error);
  }

  private throwIfSuperseded(abortGeneration: number, disposeGeneration: number): void {
    if (this.disposed || this.disposeGeneration !== disposeGeneration) {
      throw createRunnerDisposedError();
    }
    if (this.abortGeneration !== abortGeneration) {
      throw createAbortError();
    }
  }

  private async waitForTurnGate(): Promise<void> {
    const gate = this.turnGate;
    if (gate) {
      await gate;
    }
  }

  private armTurnGate(): void {
    if (this.turnGate) {
      return;
    }
    this.turnGate = new Promise((resolve) => {
      this.releaseTurnGate = resolve;
    });
  }

  private openTurnGate(): void {
    const release = this.releaseTurnGate;
    this.releaseTurnGate = null;
    this.turnGate = null;
    release?.();
  }

  private closeSession(): void {
    const session = this.session;
    if (!session || session.closed) {
      this.openTurnGate();
      return;
    }
    session.closed = true;
    this.session = null;
    session.input.finish();
    if (!session.abortController.signal.aborted) {
      session.abortController.abort();
    }
    this.openTurnGate();
  }

  private normalizeStreamError(error: unknown): Error {
    if (this.disposed) {
      return createRunnerDisposedError();
    }
    if (error instanceof Error && (error.name === "AbortError" || error.name === "RunnerDisposedError")) {
      return error;
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
