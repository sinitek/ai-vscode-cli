import * as vscode from "vscode";
import { type ChildProcess } from "child_process";
import { spawn } from "cross-spawn";
import { CliName, MacTaskShell, ThinkingMode } from "./types";
import { getCliArgs, getCliCommand, getMacTaskShell, getThinkingArgs } from "./config";
import { applyModelArg } from "./modelArgs";
import { normalizeCommandInput, resolveCliCommand, splitConfiguredCliCommand } from "./commandResolution";
import { createOpenCodeRuntimeConfigOverlay } from "./opencoderuntimeconfig";
import {
  extractAssistantTextWithoutThinkingBlocks,
  splitThinkingTaggedContent,
  stripThinkingWrapperTags,
} from "../thinkingMarkup";
import {
  getUtf8ByteLength,
  trimUtf8TextStartToMaxBytes,
} from "../boundedText";
import {
  extractOpenCodeTaskListItems,
  isOpenCodeTaskListTool,
  type OpenCodeTaskListItem,
} from "./openCodeTaskList";

export { resolveCliCommand } from "./commandResolution";
export type { ResolvedCliCommand } from "./commandResolution";

type RunCliOptions = {
  thinkingMode?: ThinkingMode;
  isolateProjectInstructions?: boolean;
  openCodeVariant?: string | null;
  model?: string | null;
  openCodeSmallModel?: string | null;
  openCodeSmallVariant?: string | null;
  openCodeConfigContent?: string | null;
  imagePaths?: string[];
  envOverrides?: Record<string, string>;
  openCodeServerUrl?: string;
};

const PROCESS_LABEL_PREFIX = "sinitek-ai-vscode-cli";
const LOCAL_SESSION_PREFIX = "local_";
const KILL_GRACE_MS = 2000;

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }

  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function checkCommandAvailableOnMacShell(command: string, shell: MacTaskShell): Promise<boolean> {
  return new Promise((resolve) => {
    const shellPath = resolveMacTaskShellExecutable(shell);
    const commandLine = `command -v ${escapeShellArg(command)} >/dev/null 2>&1`;
    const child = spawn(shellPath, ["-lc", commandLine], {
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {
      resolve(false);
    });
    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

export async function isCliCommandAvailable(command: string): Promise<boolean> {
  const commandParts = splitConfiguredCliCommand(command);
  const normalized = commandParts[0] ?? normalizeCommandInput(command);
  if (!normalized) {
    return false;
  }

  if (resolveCliCommand(normalized)) {
    return true;
  }

  if (process.platform !== "darwin") {
    return false;
  }

  return checkCommandAvailableOnMacShell(normalized, getMacTaskShell());
}

export async function runCli(cli: CliName, options: RunCliOptions = {}): Promise<void> {
  const command = getCliCommand(cli);
  const commandParts = splitConfiguredCliCommand(command);
  const commandExecutable = commandParts[0] ?? command;
  const configuredArgs = commandParts.slice(1);
  const fullArgs = buildCliArgs(cli, options);
  const terminalEnv = options.envOverrides ? { ...process.env, ...options.envOverrides } : process.env;
  const resolved = resolveCliCommand(commandExecutable);

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
    env: terminalEnv,
  });

  const joinedArgs = [...configuredArgs, ...fullArgs].map((arg) => escapeShellArg(arg)).join(" ");
  const commandLine = `${resolved?.command ?? commandExecutable} ${joinedArgs}`.trim();

  terminal.sendText(commandLine);
}

type StreamHandlers = {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onExit: (code: number | null) => void;
  onError: (error: Error) => void;
};

type RunStreamOptions = RunCliOptions & {
  cwd?: string;
  sessionId?: string | null;
  processLabel?: string;
};

export type CapturedCliOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  resolvedCommand?: string;
};

export type RunProcess = {
  pid?: number;
  resolvedCommand?: string;
  kill: (signal?: NodeJS.Signals | number) => boolean | void;
};

export type OpenCodeRunOutput = {
  finalText: string | null;
  errorText: string | null;
  statusText: string | null;
  hasStructuredFinalAnswer: boolean;
};

export type OpenCodeStreamActivity = {
  hasAssistantAnswer: boolean;
  hasError: boolean;
  hasStatus: boolean;
  hasProgress: boolean;
};

export type OpenCodeStreamActivityTracker = {
  updateStdout: (chunk: string) => OpenCodeStreamActivity;
  updateStderr: (chunk: string) => OpenCodeStreamActivity;
  flush: () => OpenCodeStreamActivity;
  snapshot: () => OpenCodeStreamActivity;
  getPendingByteLengths: () => { stdout: number; stderr: number };
};

export type OpenCodeVisibleStreamEvent = {
  kind: "assistant" | "thinking" | "tool-use";
  content: string;
  taskListItems?: OpenCodeTaskListItem[];
};

export type OpenCodeFailureMessageOptions = {
  missingFinalOutputMessage?: string;
  missingFinalOutputWithStatusMessage?: (statusText: string) => string;
};

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OPENCODE_STATUS_LINE_PATTERN = /^>\s*[^·\n]+(?:\s*·\s*.+)?$/u;
export const OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES = 64 * 1024;
const OPENCODE_JSON_TEXT_PART_TYPES = new Set([
  "text",
  "text-delta",
  "text_delta",
  "message",
  "message-part",
  "message_part",
  "part",
  "part-delta",
  "part_delta",
  "assistant",
  "assistant-message",
  "assistant_message",
  "output",
  "result",
]);

const OPENCODE_JSON_PROGRESS_TYPES = new Set([
  "step_start",
  "step-start",
  "step_finish",
  "step-finish",
  "tool_use",
  "tool-use",
  "tool",
  "reasoning",
  "reasoning-delta",
  "reasoning_delta",
]);

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function cleanOpenCodeStatusOutput(value: string): string {
  return stripAnsi(value)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !OPENCODE_STATUS_LINE_PATTERN.test(line))
    .join("\n")
    .trim();
}

function readStringProperty(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

export function parseOpenCodeSessionId(output: string): string | null {
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const eventSessionId = readStringProperty(event, ["sessionID", "sessionId", "session_id"]);
      if (eventSessionId) {
        return eventSessionId;
      }
      if (event.part && typeof event.part === "object") {
        const partSessionId = readStringProperty(
          event.part as Record<string, unknown>,
          ["sessionID", "sessionId", "session_id"],
        );
        if (partSessionId) {
          return partSessionId;
        }
      }
    } catch {
      // A stream buffer can end with a partial JSONL event; the next chunk will retry it.
    }
  }
  return null;
}

function readNumberProperty(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function pushUniqueText(target: string[], value: string | null | undefined): void {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return;
  }
  if (!target.includes(normalized)) {
    target.push(normalized);
  }
}

function collectOpenCodeProviderErrorDetails(error: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const details: string[] = [];
  pushUniqueText(details, readStringProperty(error, ["name"]));
  pushUniqueText(details, readStringProperty(error, ["message"]));
  pushUniqueText(details, readStringProperty(data, ["message", "error", "detail"]));
  pushUniqueText(details, readStringProperty(data, ["ref", "requestId", "requestID", "request_id"]));
  pushUniqueText(details, readStringProperty(error, ["ref", "requestId", "requestID", "request_id"]));

  const statusCode = readNumberProperty(data, ["statusCode", "status"]);
  if (statusCode !== null) {
    pushUniqueText(details, String(statusCode));
  }

  const metadata = data.metadata && typeof data.metadata === "object"
    ? data.metadata as Record<string, unknown>
    : {};
  pushUniqueText(details, readStringProperty(metadata, ["url"]));

  const responseBody = readStringProperty(data, ["responseBody", "body"]);
  if (responseBody) {
    try {
      const parsedBody = JSON.parse(responseBody) as unknown;
      if (parsedBody && typeof parsedBody === "object") {
        const bodyRecord = parsedBody as Record<string, unknown>;
        const bodyError = bodyRecord.error && typeof bodyRecord.error === "object"
          ? bodyRecord.error as Record<string, unknown>
          : bodyRecord;
        pushUniqueText(details, readStringProperty(bodyError, ["message", "type", "code", "param"]));
        pushUniqueText(details, readStringProperty(bodyError, ["type"]));
        pushUniqueText(details, readStringProperty(bodyError, ["code"]));
      }
    } catch {
      pushUniqueText(details, responseBody);
    }
  }

  return details;
}

function combineOpenCodeErrorText(...values: Array<string | null | undefined>): string | null {
  const lines: string[] = [];
  for (const value of values) {
    for (const line of (value ?? "").split(/\r?\n/u)) {
      pushUniqueText(lines, line);
    }
  }
  return lines.join("\n").trim() || null;
}

function collectOpenCodeJsonText(value: unknown, parentType?: string): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : parentType;
  const normalizedType = typeof type === "string" ? type.toLowerCase() : "";
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
  const shouldReadText = OPENCODE_JSON_TEXT_PART_TYPES.has(normalizedType)
    || role === "assistant"
    || parentType === "assistant";
  const nestedParentType = role === "assistant" ? "assistant" : normalizedType || parentType;
  const chunks: string[] = [];

  if (shouldReadText) {
    const directText = readStringProperty(record, ["text", "content", "delta", "message", "output", "result"]);
    if (directText) {
      chunks.push(directText);
    }
  }

  const part = record.part;
  if (part && typeof part === "object") {
    chunks.push(...collectOpenCodeJsonText(part, nestedParentType));
  }

  for (const key of ["parts", "content", "message", "messages", "output"]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      nested.forEach((item) => chunks.push(...collectOpenCodeJsonText(item, nestedParentType)));
    } else if (nested && typeof nested === "object") {
      chunks.push(...collectOpenCodeJsonText(nested, nestedParentType));
    }
  }

  return chunks;
}

function readObjectProperty(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeOpenCodeJsonType(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function getOpenCodeJsonPart(record: Record<string, unknown>): Record<string, unknown> | null {
  return readObjectProperty(record, "part");
}

function readOpenCodeMessageId(record: Record<string, unknown>): string | null {
  const part = getOpenCodeJsonPart(record);
  return (part ? readStringProperty(part, ["messageID", "messageId", "message_id"]) : null)
    ?? readStringProperty(record, ["messageID", "messageId", "message_id"]);
}

function isOpenCodeStructuredFinalEvent(record: Record<string, unknown>): boolean {
  const part = getOpenCodeJsonPart(record);
  const source = part ?? record;
  const eventType = normalizeOpenCodeJsonType(record.type);
  const partType = normalizeOpenCodeJsonType(source.type);
  if (
    eventType !== "step_finish"
    && eventType !== "step-finish"
    && partType !== "step_finish"
    && partType !== "step-finish"
  ) {
    return false;
  }

  const reason = readStringProperty(source, ["reason"])
    ?? readStringProperty(record, ["reason"]);
  return reason?.trim().toLowerCase() === "stop";
}

function formatOpenCodeToolUseEvent(record: Record<string, unknown>): OpenCodeVisibleStreamEvent | null {
  const part = getOpenCodeJsonPart(record);
  const source = part ?? record;
  const type = normalizeOpenCodeJsonType(record.type);
  const partType = normalizeOpenCodeJsonType(source.type);
  if (type !== "tool_use" && type !== "tool-use" && type !== "tool" && partType !== "tool") {
    return null;
  }

  const state = readObjectProperty(source, "state") ?? readObjectProperty(record, "state") ?? {};
  const toolName = readStringProperty(source, ["tool", "name"])
    ?? readStringProperty(record, ["tool", "name"])
    ?? "tool";
  const status = readStringProperty(state, ["status"])
    ?? readStringProperty(source, ["status"]);
  const title = readStringProperty(state, ["title"])
    ?? readStringProperty(source, ["title"]);
  const lines = [`tool ${toolName}`];
  if (status) {
    lines.push(`status: ${status}`);
  }
  if (title && title !== status) {
    lines.push(title);
  }
  const taskListItems = isOpenCodeTaskListTool(toolName)
    ? extractOpenCodeTaskListItems(state)
      ?? extractOpenCodeTaskListItems(source)
      ?? extractOpenCodeTaskListItems(record)
    : null;

  return {
    kind: "tool-use",
    content: lines.join("\n"),
    ...(taskListItems === null ? {} : { taskListItems }),
  };
}

function collectOpenCodeReasoningText(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const type = normalizeOpenCodeJsonType(record.type);
  const chunks: string[] = [];
  if (type === "reasoning" || type === "reasoning-delta" || type === "reasoning_delta") {
    const text = readStringProperty(record, ["text", "content", "delta", "summary"]);
    if (text) {
      chunks.push(text);
    }
  }

  const part = getOpenCodeJsonPart(record);
  if (part) {
    chunks.push(...collectOpenCodeReasoningText(part));
  }

  for (const key of ["parts", "content", "message", "messages", "output"]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      nested.forEach((item) => chunks.push(...collectOpenCodeReasoningText(item)));
    } else if (nested && typeof nested === "object") {
      chunks.push(...collectOpenCodeReasoningText(nested));
    }
  }

  return chunks;
}

export function parseOpenCodeVisibleStreamEvents(line: string): OpenCodeVisibleStreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return [];
  }

  let record: Record<string, unknown>;
  try {
    record = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }

  const assistantText = collectOpenCodeJsonText(record).join("");
  if (assistantText.trim()) {
    return splitThinkingTaggedContent(assistantText).map((segment) => (
      segment.kind === "thinking"
        ? { kind: "thinking", content: `thinking\n${segment.content}` }
        : { kind: "assistant", content: segment.content }
    ));
  }

  const toolEvent = formatOpenCodeToolUseEvent(record);
  if (toolEvent) {
    return [toolEvent];
  }

  const reasoningText = stripThinkingWrapperTags(collectOpenCodeReasoningText(record).join("")).trim();
  if (reasoningText) {
    return [{ kind: "thinking", content: `thinking\n${reasoningText}` }];
  }

  const type = normalizeOpenCodeJsonType(record.type);
  if (type === "step_start" || type === "step-start") {
    return [{ kind: "thinking", content: "thinking\nOpenCode is planning the next step…" }];
  }

  return [];
}

function parseOpenCodeJsonOutput(stdout: string): {
  finalText: string | null;
  hasStructuredFinalAnswer: boolean;
} {
  const chunks: string[] = [];
  const assistantTextMessageIds = new Set<string>();
  const structuredFinalMessageIds = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      const messageId = readOpenCodeMessageId(record);
      const recordChunks = collectOpenCodeJsonText(record);
      chunks.push(...recordChunks);
      const hasAssistantText = splitThinkingTaggedContent(recordChunks.join(""))
        .some((segment) => segment.kind === "assistant" && segment.content.trim().length > 0);
      if (hasAssistantText) {
        if (messageId) {
          assistantTextMessageIds.add(messageId);
        }
      }
      if (isOpenCodeStructuredFinalEvent(record)) {
        if (messageId) {
          structuredFinalMessageIds.add(messageId);
        }
      }
    } catch {
      // Ignore non-JSON progress lines in default output.
    }
  }
  const finalText = extractAssistantTextWithoutThinkingBlocks(chunks.join("")).trim();
  const hasScopedStructuredFinalAnswer = Array.from(structuredFinalMessageIds)
    .some((messageId) => assistantTextMessageIds.has(messageId));
  return {
    finalText: finalText || null,
    hasStructuredFinalAnswer: hasScopedStructuredFinalAnswer,
  };
}

function collectOpenCodeJsonActivity(value: unknown, activity: OpenCodeStreamActivity): void {
  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";

  if (type === "error" || record.error) {
    activity.hasError = true;
  }
  const textSegments = splitThinkingTaggedContent(collectOpenCodeJsonText(record).join(""));
  if (textSegments.some((segment) => segment.kind === "assistant")) {
    activity.hasAssistantAnswer = true;
  }
  if (textSegments.some((segment) => segment.kind === "thinking")) {
    activity.hasProgress = true;
  }
  if (OPENCODE_JSON_PROGRESS_TYPES.has(type)) {
    activity.hasProgress = true;
  }

  const part = record.part;
  if (part && typeof part === "object") {
    collectOpenCodeJsonActivity(part, activity);
  }

  for (const key of ["parts", "content", "message", "messages", "output"]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      nested.forEach((item) => collectOpenCodeJsonActivity(item, activity));
    } else if (nested && typeof nested === "object") {
      collectOpenCodeJsonActivity(nested, activity);
    }
  }
}

function createEmptyOpenCodeStreamActivity(): OpenCodeStreamActivity {
  return {
    hasAssistantAnswer: false,
    hasError: false,
    hasStatus: false,
    hasProgress: false,
  };
}

function copyOpenCodeStreamActivity(activity: OpenCodeStreamActivity): OpenCodeStreamActivity {
  return {
    hasAssistantAnswer: activity.hasAssistantAnswer,
    hasError: activity.hasError,
    hasStatus: activity.hasStatus,
    hasProgress: activity.hasProgress,
  };
}

function normalizeOpenCodeActivityChunk(chunk: string): string {
  return chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function trimOpenCodeActivityPendingLine(line: string): string {
  return trimUtf8TextStartToMaxBytes(line, OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES).text;
}

function collectOpenCodePlainStdoutActivity(line: string, activity: OpenCodeStreamActivity): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("{")) {
    return;
  }
  if (getUtf8ByteLength(trimmed) > OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES) {
    activity.hasProgress = true;
    return;
  }

  const cleaned = cleanOpenCodeStatusOutput(trimmed);
  if (!cleaned) {
    return;
  }
  const meaningfulLines = cleaned
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (meaningfulLines.length > 0 && meaningfulLines.every((item) => item.startsWith("{"))) {
    return;
  }

  const textSegments = splitThinkingTaggedContent(cleaned);
  if (textSegments.some((segment) => segment.kind === "assistant" && segment.content.trim().length > 0)) {
    activity.hasAssistantAnswer = true;
  }
  if (textSegments.some((segment) => segment.kind === "thinking" && segment.content.trim().length > 0)) {
    activity.hasProgress = true;
  }
  if (!activity.hasAssistantAnswer && meaningfulLines.some((item) => !item.startsWith("{"))) {
    activity.hasProgress = true;
  }
}

function collectOpenCodeStdoutActivityLine(line: string, activity: OpenCodeStreamActivity): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  if (!trimmed.startsWith("{")) {
    collectOpenCodePlainStdoutActivity(trimmed, activity);
    return;
  }
  if (getUtf8ByteLength(trimmed) > OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES) {
    return;
  }
  try {
    collectOpenCodeJsonActivity(JSON.parse(trimmed), activity);
  } catch {
    // Ignore malformed or incomplete JSONL events while the process is still streaming.
  }
}

function collectOpenCodeStderrActivityLine(line: string, activity: OpenCodeStreamActivity): void {
  const cleanedLine = stripAnsi(line).trim();
  if (!cleanedLine) {
    return;
  }
  if (getUtf8ByteLength(cleanedLine) > OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES) {
    activity.hasError = true;
    return;
  }
  if (OPENCODE_STATUS_LINE_PATTERN.test(cleanedLine)) {
    activity.hasStatus = true;
    return;
  }
  if (cleanOpenCodeStatusOutput(cleanedLine)) {
    activity.hasError = true;
  }
}

function consumeOpenCodeActivityLines(
  pendingLine: string,
  chunk: string,
  flush: boolean,
  onLine: (line: string) => void,
  onPendingLine?: (line: string) => void,
): string {
  const combined = pendingLine + normalizeOpenCodeActivityChunk(chunk);
  const lines = combined.split("\n");
  const nextPendingLine = flush ? "" : (lines.pop() ?? "");
  lines.forEach(onLine);
  if (!flush && nextPendingLine) {
    onPendingLine?.(nextPendingLine);
  }
  return trimOpenCodeActivityPendingLine(nextPendingLine);
}

export function createOpenCodeStreamActivityTracker(): OpenCodeStreamActivityTracker {
  const activity = createEmptyOpenCodeStreamActivity();
  let pendingStdoutLine = "";
  let pendingStderrLine = "";

  const snapshot = (): OpenCodeStreamActivity => copyOpenCodeStreamActivity(activity);

  return {
    updateStdout: (chunk: string) => {
      pendingStdoutLine = consumeOpenCodeActivityLines(
        pendingStdoutLine,
        chunk,
        false,
        (line) => collectOpenCodeStdoutActivityLine(line, activity),
        (line) => collectOpenCodePlainStdoutActivity(line, activity),
      );
      return snapshot();
    },
    updateStderr: (chunk: string) => {
      pendingStderrLine = consumeOpenCodeActivityLines(
        pendingStderrLine,
        chunk,
        false,
        (line) => collectOpenCodeStderrActivityLine(line, activity),
        (line) => collectOpenCodeStderrActivityLine(line, activity),
      );
      return snapshot();
    },
    flush: () => {
      pendingStdoutLine = consumeOpenCodeActivityLines(
        pendingStdoutLine,
        "",
        true,
        (line) => collectOpenCodeStdoutActivityLine(line, activity),
      );
      pendingStderrLine = consumeOpenCodeActivityLines(
        pendingStderrLine,
        "",
        true,
        (line) => collectOpenCodeStderrActivityLine(line, activity),
      );
      return snapshot();
    },
    snapshot,
    getPendingByteLengths: () => ({
      stdout: getUtf8ByteLength(pendingStdoutLine),
      stderr: getUtf8ByteLength(pendingStderrLine),
    }),
  };
}

export function detectOpenCodeStreamActivity(stdout: string, stderr: string): OpenCodeStreamActivity {
  const tracker = createOpenCodeStreamActivityTracker();
  tracker.updateStdout(stdout);
  tracker.updateStderr(stderr);
  return tracker.flush();
}

function parseOpenCodePlainOutput(stdout: string): string | null {
  const cleaned = cleanOpenCodeStatusOutput(stdout);
  if (!cleaned) {
    return null;
  }
  const meaningfulLines = cleaned
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (meaningfulLines.length > 0 && meaningfulLines.every((line) => line.startsWith("{"))) {
    return null;
  }
  const jsonText = parseOpenCodeJsonOutput(cleaned).finalText;
  const plainText = extractAssistantTextWithoutThinkingBlocks(cleaned).trim();
  return jsonText ?? (plainText || null);
}

function collectOpenCodeJsonErrors(stdout: string): string | null {
  const errors: string[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      if (record.type !== "error" || !record.error || typeof record.error !== "object") {
        continue;
      }
      const error = record.error as Record<string, unknown>;
      const data = error.data && typeof error.data === "object"
        ? error.data as Record<string, unknown>
        : {};
      const details = collectOpenCodeProviderErrorDetails(error, data);
      if (details.length > 0) {
        pushUniqueText(errors, details.join("\n"));
      } else {
        pushUniqueText(errors, readStringProperty(error, ["message", "name"]));
      }
    } catch {
      // Ignore non-JSON progress lines in default output.
    }
  }

  return errors.join("\n").trim() || null;
}

export function parseOpenCodeRunOutput(stdout: string, stderr: string): OpenCodeRunOutput {
  const jsonOutput = parseOpenCodeJsonOutput(stdout);
  const finalText = jsonOutput.finalText ?? parseOpenCodePlainOutput(stdout);
  const stderrErrorText = cleanOpenCodeStatusOutput(stderr);
  const jsonErrorText = collectOpenCodeJsonErrors(stdout);
  const statusText = stripAnsi(stderr)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => OPENCODE_STATUS_LINE_PATTERN.test(line))
    .join("\n")
    .trim();

  return {
    finalText,
    errorText: combineOpenCodeErrorText(jsonErrorText, stderrErrorText),
    statusText: statusText || null,
    hasStructuredFinalAnswer: jsonOutput.hasStructuredFinalAnswer,
  };
}

export function buildOpenCodeRunFailureMessage(
  output: OpenCodeRunOutput,
  fallbackMessage: string,
  options: OpenCodeFailureMessageOptions = {},
): string {
  if (output.errorText) {
    return output.errorText;
  }
  if (output.statusText) {
    return options.missingFinalOutputWithStatusMessage?.(output.statusText)
      ?? `OpenCode exited successfully, but did not return an assistant answer. Last status: ${output.statusText}`;
  }
  return fallbackMessage || options.missingFinalOutputMessage
    || "OpenCode exited without returning an assistant answer or a provider error. Check the OpenCode provider/model config or run `opencode run --format json` to verify it.";
}

export function buildCliArgs(
  cli: CliName,
  options: RunStreamOptions = {},
  prompt?: string
): string[] {
  const baseArgs = getCliArgs(cli);
  const thinkingArgs = cli !== "opencode" && options.thinkingMode
    ? getThinkingArgs(cli, options.thinkingMode)
    : [];
  const sessionId = options.sessionId ?? null;
  let sharedArgs = applyModelArg(cli, [...baseArgs, ...thinkingArgs], options.model, {
    openCodeConfigContent: options.openCodeConfigContent,
  });
  if (options.isolateProjectInstructions) {
    sharedArgs = applyProjectInstructionIsolationArgs(cli, sharedArgs);
  }
  if (cli === "codex" && !sharedArgs.includes("--skip-git-repo-check")) {
    sharedArgs = [...sharedArgs, "--skip-git-repo-check"];
  }
  if (cli === "codex" && Array.isArray(options.imagePaths) && options.imagePaths.length) {
    const normalizedImagePaths = options.imagePaths
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (normalizedImagePaths.length) {
      sharedArgs = [
        ...sharedArgs,
        ...normalizedImagePaths.flatMap((imagePath) => ["--image", imagePath]),
      ];
    }
  }
  if (cli === "opencode") {
    sharedArgs = applyOpenCodeVariantArg(sharedArgs, options.openCodeVariant);
    sharedArgs = applyOpenCodeAutoArg(sharedArgs);
  }

  if (prompt === undefined || prompt === "") {
    return sharedArgs;
  }

  if (cli === "opencode") {
    return buildOpenCodeRunArgs(sharedArgs, sessionId, prompt, options.openCodeServerUrl);
  }

  if (sessionId) {
    return buildSessionArgs(cli, sharedArgs, sessionId, prompt);
  }

  return buildPromptArgs(cli, sharedArgs, prompt);
}

function applyProjectInstructionIsolationArgs(cli: CliName, args: readonly string[]): string[] {
  if (cli === "codex") {
    return args.includes("--ignore-rules") ? [...args] : [...args, "--ignore-rules"];
  }
  if (cli === "claude") {
    return args.includes("--safe-mode") ? [...args] : [...args, "--safe-mode"];
  }
  return args.includes("--pure") ? [...args] : [...args, "--pure"];
}

export function applyOpenCodeVariantArg(
  args: readonly string[],
  variant: string | null | undefined
): string[] {
  const normalizedVariant = typeof variant === "string" ? variant.trim() : "";
  const hasExplicitVariant = args.some((arg) => arg === "--variant" || arg.startsWith("--variant="));
  if (!normalizedVariant || hasExplicitVariant) {
    return [...args];
  }
  return [...args, "--variant", normalizedVariant];
}

function applyOpenCodeAutoArg(args: readonly string[]): string[] {
  const normalizedArgs = args.filter((arg) => arg !== "--auto");
  const insertIndex = normalizedArgs[0] === "run" ? 1 : 0;
  return [
    ...normalizedArgs.slice(0, insertIndex),
    "--auto",
    ...normalizedArgs.slice(insertIndex),
  ];
}

export function buildProcessLabel(cli: CliName, sessionId?: string | null): string {
  const suffix = sessionId ? sessionId : "new";
  return `${PROCESS_LABEL_PREFIX}-${cli}/${suffix}`;
}

function buildSessionArgs(
  _cli: CliName,
  sharedArgs: string[],
  _sessionId: string,
  prompt: string
): string[] {
  return [...sharedArgs, prompt];
}

function buildPromptArgs(_cli: CliName, sharedArgs: string[], prompt: string): string[] {
  return [...sharedArgs, prompt];
}

function buildOpenCodeRunArgs(
  sharedArgs: string[],
  sessionId: string | null,
  prompt: string,
  serverUrl?: string,
): string[] {
  const hasRunSubcommand = sharedArgs[0] === "run";
  let runArgs = hasRunSubcommand ? [...sharedArgs] : ["run", ...sharedArgs];
  if (!runArgs.includes("--format") && !runArgs.some((arg) => arg.startsWith("--format="))) {
    runArgs.splice(2, 0, "--format", "json");
  }
  const hasAttach = runArgs.some((arg) => arg === "--attach" || arg.startsWith("--attach="));
  const normalizedServerUrl = typeof serverUrl === "string" ? serverUrl.trim().replace(/\/+$/u, "") : "";
  if (normalizedServerUrl) {
    runArgs = runArgs.filter((arg, index, args) => (
      arg !== "--port"
      && !arg.startsWith("--port=")
      && args[index - 1] !== "--port"
    ));
    if (!hasAttach) {
      runArgs.push("--attach", normalizedServerUrl);
    }
  }
  if (sessionId && !runArgs.includes("--session") && !runArgs.includes("-s")) {
    return [...runArgs, "--session", sessionId, prompt];
  }
  return [...runArgs, prompt];
}

function buildShellCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((segment) => escapeShellArg(segment)).join(" ");
}

function resolveMacTaskShellExecutable(shell: MacTaskShell): string {
  return shell === "bash" ? "/bin/bash" : "/bin/zsh";
}

function resolveSpawnCommand(command: string, args: string[]): {
  commandToSpawn: string;
  argsToSpawn: string[];
  resolvedCommand: string;
} | null {
  const commandParts = splitConfiguredCliCommand(command);
  const commandExecutable = commandParts[0] ?? command;
  const configuredArgs = commandParts.slice(1);
  const fullArgs = [...configuredArgs, ...args];
  const resolved = resolveCliCommand(commandExecutable);
  if (resolved) {
    return {
      commandToSpawn: resolved.command,
      argsToSpawn: fullArgs,
      resolvedCommand: resolved.command,
    };
  }

  if (process.platform !== "darwin") {
    return null;
  }

  const macTaskShell = getMacTaskShell();
  return {
    commandToSpawn: resolveMacTaskShellExecutable(macTaskShell),
    argsToSpawn: ["-lc", buildShellCommandLine(commandExecutable, fullArgs)],
    resolvedCommand: commandExecutable,
  };
}

function buildSpawnEnvironment(
  cwd: string | undefined,
  envOverrides?: Record<string, string>,
  runtimeEnvOverrides?: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(envOverrides ?? {}),
    ...(runtimeEnvOverrides ?? {}),
  };
  if (cwd) {
    env.PWD = cwd;
  }
  return env;
}

function createOpenCodeRuntimeOverlayForOptions(options: RunCliOptions) {
  return options.openCodeConfigContent && options.model
    ? createOpenCodeRuntimeConfigOverlay({
        configContent: options.openCodeConfigContent,
        primaryModel: options.model,
        smallModel: options.openCodeSmallModel ?? null,
        primaryVariant: options.openCodeVariant ?? null,
        smallVariant: options.openCodeSmallVariant ?? null,
      })
    : null;
}

export function startOpenCodeServer(
  port: number,
  handlers: Partial<StreamHandlers> = {},
  options: RunStreamOptions = {},
): RunProcess {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    const error = new Error(`invalid-opencode-server-port:${port}`);
    handlers.onError?.(error);
    handlers.onExit?.(1);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }

  const configuredCommand = getCliCommand("opencode");
  const runtimeOverlay = createOpenCodeRuntimeOverlayForOptions(options);
  if (runtimeOverlay && (!runtimeOverlay.ok || !runtimeOverlay.overlay)) {
    const error = new Error(runtimeOverlay.issues.map((issue) => issue.message).join("\n"));
    handlers.onError?.(error);
    handlers.onExit?.(1);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }
  const overlay = runtimeOverlay?.overlay ?? null;
  const args = [
    "serve",
    ...(options.isolateProjectInstructions ? ["--pure"] : []),
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ];
  const spawnCommand = resolveSpawnCommand(configuredCommand, args);
  if (!spawnCommand) {
    overlay?.cleanup();
    const error = new Error(`spawn ${configuredCommand} ENOENT`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    handlers.onError?.(error);
    handlers.onExit?.(127);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }

  const child = spawn(spawnCommand.commandToSpawn, spawnCommand.argsToSpawn, {
    cwd: options.cwd,
    env: buildSpawnEnvironment(options.cwd, options.envOverrides, overlay?.envOverrides),
    argv0: options.processLabel,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (data) => handlers.onStdout?.(data));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (data) => handlers.onStderr?.(data));
  child.on("error", (error) => {
    overlay?.cleanup();
    handlers.onError?.(error);
  });
  child.on("close", (code) => {
    overlay?.cleanup();
    handlers.onExit?.(code);
  });

  return {
    pid: child.pid,
    resolvedCommand: spawnCommand.resolvedCommand,
    kill: (signal) => killProcessTree(child, signal),
  };
}

export function runCliStream(
  cli: CliName,
  prompt: string,
  handlers: StreamHandlers,
  options: RunStreamOptions = {}
): RunProcess {
  const configuredCommand = getCliCommand(cli);
  const fullArgs = buildCliArgs(cli, options, prompt);
  const processLabel = options.processLabel;
  const runtimeOverlay = cli === "opencode"
    ? createOpenCodeRuntimeOverlayForOptions(options)
    : null;
  if (runtimeOverlay && (!runtimeOverlay.ok || !runtimeOverlay.overlay)) {
    const error = new Error(runtimeOverlay.issues.map((issue) => issue.message).join("\n"));
    handlers.onError(error);
    handlers.onExit(1);
    return {
      pid: undefined,
      resolvedCommand: undefined,
      kill: () => false,
    };
  }
  const overlay = runtimeOverlay?.overlay ?? null;
  const spawnCommand = resolveSpawnCommand(configuredCommand, fullArgs);
  if (!spawnCommand) {
    overlay?.cleanup();
    const error = new Error(`spawn ${configuredCommand} ENOENT`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    handlers.onError(error);
    handlers.onExit(127);
    return {
      pid: undefined,
      resolvedCommand: undefined,
      kill: () => false,
    };
  }

  const child = spawn(spawnCommand.commandToSpawn, spawnCommand.argsToSpawn, {
    cwd: options.cwd,
    env: buildSpawnEnvironment(options.cwd, options.envOverrides, overlay?.envOverrides),
    argv0: processLabel,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end();

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (data) => {
    handlers.onStdout(data);
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (data) => {
    handlers.onStderr(data);
  });

  child.on("error", (error) => {
    overlay?.cleanup();
    handlers.onError(error);
  });

  child.on("close", (code) => {
    overlay?.cleanup();
    handlers.onExit(code);
  });

  return {
    pid: child.pid,
    resolvedCommand: spawnCommand.resolvedCommand,
    kill: (signal) => killProcessTree(child, signal),
  };
}

export function captureCliOutput(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<CapturedCliOutput> {
  return new Promise((resolve, reject) => {
    const spawnCommand = resolveSpawnCommand(command, args);
    if (!spawnCommand) {
      const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      reject(error);
      return;
    }

    const child = spawn(spawnCommand.commandToSpawn, spawnCommand.argsToSpawn, {
      cwd: options.cwd,
      env: buildSpawnEnvironment(options.cwd),
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const finishResolve = (payload: CapturedCliOutput): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve(payload);
    };

    const finishReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finishReject(error);
    });

    child.on("close", (code) => {
      finishResolve({
          stdout,
          stderr,
          exitCode: code,
          resolvedCommand: spawnCommand.resolvedCommand,
        });
      });

    const timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 0;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        killProcessTree(child, "SIGTERM");
        finishReject(new Error(`capture-cli-output-timeout:${timeoutMs}`));
      }, timeoutMs);
    }
  });
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
  } catch (error) {
    try {
      child.kill(signal);
    } catch (innerError) {
      return false;
    }
  }
  if (signal === "SIGTERM") {
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        try {
          child.kill("SIGKILL");
        } catch (innerError) {
          return;
        }
      }
    }, KILL_GRACE_MS);
  }
  return true;
}
