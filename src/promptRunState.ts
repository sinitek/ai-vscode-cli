import * as fs from "fs";
import * as path from "path";
import { CliName, InteractiveMode, MacTaskShell, ThinkingMode } from "./cli/types";
import { ChatMessage } from "./webview/types";

export type TaskRunStatus = "end" | "error" | "stopped";
export type RunActivity = "contextCompaction";
export type LobsterTaskRole = "main" | "subtask";
export type LobsterTaskStatus = "running" | "completed" | "needs-review" | "error" | "stopped";

export type PromptRunTargetLike = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

export type LobsterTaskCompletionStateLike = {
  status: string;
  mainAiFailureCount?: number;
  mainAiFailureLimitReached?: boolean;
};

export type TaskRunDraft = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  prompt: string;
  startedAt: number;
  taskRole?: LobsterTaskRole;
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
};

export type TaskRunRecord = TaskRunDraft & {
  endedAt: number;
  durationMs: number;
  status: TaskRunStatus;
};

export type TaskStore = {
  runs: TaskRunRecord[];
};

type TaskStoreDeps = {
  taskStoreFile: string;
  isCliName: (value: string) => value is CliName;
  isLobsterTaskRole: (value: unknown) => value is LobsterTaskRole;
  isTimestampWithinHistoryRetention: (timestamp: number, now?: number) => boolean;
  logError: (event: string, payload?: unknown) => void;
};

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function buildTaskRunCompletionText(
  status: TaskRunStatus,
  durationMs: number | null | undefined,
  labels: { failed: string; stopped: string; completed: string; failedWithDuration: (duration: string) => string; stoppedWithDuration: (duration: string) => string; completedWithDuration: (duration: string) => string }
): string {
  const hasDuration = typeof durationMs === "number" && Number.isFinite(durationMs);
  const durationText = hasDuration ? formatDuration(Math.max(0, durationMs)) : null;
  if (status === "error") {
    return durationText ? labels.failedWithDuration(durationText) : labels.failed;
  }
  if (status === "stopped") {
    return durationText ? labels.stoppedWithDuration(durationText) : labels.stopped;
  }
  return durationText ? labels.completedWithDuration(durationText) : labels.completed;
}

export function normalizeRawStreamContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function sendPanelMessageWithActiveTab(
  payload: Record<string, unknown>,
  activeTabId: string | null,
  postMessage: (payload: Record<string, unknown>) => void
): void {
  const type = typeof payload.type === "string" ? payload.type : "";
  const shouldAttachTabId = Boolean(
    activeTabId
    && (
      type === "appendMessage"
      || type === "assistantDelta"
      || type === "traceSegment"
      || type === "rawStreamDelta"
      || type === "removeMessage"
      || type === "replaceMessage"
      || type === "runStatus"
      || type === "taskListUpdate"
    )
    && !Object.prototype.hasOwnProperty.call(payload, "tabId")
  );
  if (shouldAttachTabId) {
    postMessage({
      ...payload,
      tabId: activeTabId,
    });
    return;
  }
  postMessage(payload);
}

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return value === "off"
    || value === "on"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    || value === "ultra"
    || value === "max";
}

export function isInteractiveMode(value: unknown): value is InteractiveMode {
  return value === "coding" || value === "plan" || value === "lobster";
}

export function normalizeVisibleInteractiveMode(value: unknown): InteractiveMode {
  return value === "lobster" ? "lobster" : "coding";
}

export function isLobsterTaskRole(value: unknown): value is LobsterTaskRole {
  return value === "main" || value === "subtask";
}

export function isMacTaskShell(value: unknown): value is MacTaskShell {
  return value === "zsh" || value === "bash";
}

export function resolvePromptRunTargetSessionId(
  target: PromptRunTargetLike,
  getConversationTabSessionId: (target: PromptRunTargetLike) => string | null
): string | null {
  return getConversationTabSessionId(target) ?? target.sessionId;
}

export function resolveLobsterTaskSessionId(
  target: PromptRunTargetLike,
  getConversationTabSessionId: (target: PromptRunTargetLike) => string | null
): string | null {
  return resolvePromptRunTargetSessionId(target, getConversationTabSessionId);
}

export function isLobsterTaskCompleted(task: { status: string }): boolean {
  return task.status === "completed";
}

export function isLobsterTaskBlockedByMainAiFailureLimit(
  task: Pick<LobsterTaskCompletionStateLike, "mainAiFailureCount" | "mainAiFailureLimitReached">,
  limit: number
): boolean {
  const count = typeof task.mainAiFailureCount === "number" && Number.isFinite(task.mainAiFailureCount)
    ? Math.max(0, Math.floor(task.mainAiFailureCount))
    : 0;
  return task.mainAiFailureLimitReached === true || count >= limit;
}

export function normalizeTaskRunRecord(record: unknown, deps: Pick<TaskStoreDeps, "isCliName" | "isLobsterTaskRole">): TaskRunRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<TaskRunRecord>;
  const cli = typeof raw.cli === "string" && deps.isCliName(raw.cli) ? raw.cli : null;
  if (typeof raw.id !== "string" || !raw.id.trim() || !cli) {
    return null;
  }
  if (typeof raw.prompt !== "string" || typeof raw.startedAt !== "number") {
    return null;
  }
  if (typeof raw.endedAt !== "number" || typeof raw.durationMs !== "number") {
    return null;
  }
  if (raw.status !== "end" && raw.status !== "error" && raw.status !== "stopped") {
    return null;
  }
  return {
    id: raw.id,
    cli,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    prompt: raw.prompt,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    durationMs: raw.durationMs,
    status: raw.status,
    taskRole: deps.isLobsterTaskRole(raw.taskRole) ? raw.taskRole : undefined,
    lobsterTaskId: typeof raw.lobsterTaskId === "string" ? raw.lobsterTaskId : undefined,
    lobsterRound: typeof raw.lobsterRound === "number" ? raw.lobsterRound : undefined,
    lobsterSubtaskId: typeof raw.lobsterSubtaskId === "string" ? raw.lobsterSubtaskId : undefined,
  };
}

export function ensureTaskStore(store: TaskStore | undefined, deps: Pick<TaskStoreDeps, "isCliName" | "isLobsterTaskRole" | "isTimestampWithinHistoryRetention">): TaskStore {
  const now = Date.now();
  const runs = Array.isArray(store?.runs)
    ? store.runs
        .map((record) => normalizeTaskRunRecord(record, deps))
        .filter((record): record is TaskRunRecord => Boolean(record))
        .filter((record) => deps.isTimestampWithinHistoryRetention(record.endedAt, now))
    : [];
  return { runs };
}

export function readTaskStore(deps: TaskStoreDeps): TaskStore {
  try {
    if (!fs.existsSync(deps.taskStoreFile)) {
      return { runs: [] };
    }
    const raw = fs.readFileSync(deps.taskStoreFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.runs)) {
      return { runs: [] };
    }
    return ensureTaskStore({ runs: parsed.runs as TaskRunRecord[] }, deps);
  } catch (error) {
    deps.logError("task-store-read-error", { error: String(error) });
    return { runs: [] };
  }
}

export function writeTaskStore(store: TaskStore, deps: Pick<TaskStoreDeps, "taskStoreFile" | "logError">): void {
  try {
    const dirPath = path.dirname(deps.taskStoreFile);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(deps.taskStoreFile, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    deps.logError("task-store-write-error", { error: String(error) });
  }
}

export function cleanupTaskStoreRetention(deps: TaskStoreDeps): void {
  try {
    if (!fs.existsSync(deps.taskStoreFile)) {
      return;
    }
    const normalized = readTaskStore(deps);
    if (normalized.runs.length > 0) {
      writeTaskStore(normalized, deps);
      return;
    }
    fs.unlinkSync(deps.taskStoreFile);
  } catch (error) {
    deps.logError("task-store-retention-cleanup-error", { error: String(error) });
  }
}

export function appendMessageToStore(target: ChatMessage[], message: ChatMessage): void {
  if (isNearDuplicateWarningOrErrorMessage(target, message)) {
    return;
  }
  if (typeof message.sequence !== "number") {
    message.sequence = getNextMessageSequence(target);
  }
  target.push(message);
}

function normalizeDuplicateMessageContent(content: string): string {
  return String(content || "").replace(/\r\n/g, "\n").trim();
}

function isWarningOrErrorChatMessage(message: ChatMessage | undefined): boolean {
  if (!message || (message.role !== "trace" && message.role !== "system")) {
    return false;
  }
  const content = normalizeDuplicateMessageContent(message.content);
  if (!content) {
    return false;
  }
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:warning|警告|error|错误)\b/i.test(firstLine.trim());
}

function isNearDuplicateWarningOrErrorMessage(
  target: ChatMessage[],
  message: ChatMessage,
  windowMs = 3000,
): boolean {
  const last = target[target.length - 1];
  if (!last) {
    return false;
  }
  if (message.role !== last.role || !isWarningOrErrorChatMessage(message) || !isWarningOrErrorChatMessage(last)) {
    return false;
  }
  if (message.role === "trace" && (message.kind || "normal") !== (last.kind || "normal")) {
    return false;
  }
  const content = normalizeDuplicateMessageContent(message.content);
  const lastContent = normalizeDuplicateMessageContent(last.content);
  if (!content || content !== lastContent) {
    return false;
  }
  const createdAt = typeof message.createdAt === "number" ? message.createdAt : Date.now();
  const lastCreatedAt = typeof last.createdAt === "number" ? last.createdAt : 0;
  return lastCreatedAt > 0 && Math.abs(createdAt - lastCreatedAt) <= windowMs;
}

export function getNextMessageSequence(messages: ChatMessage[]): number {
  if (!messages.length) {
    return 0;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const current = messages[i];
    if (typeof current.sequence === "number") {
      return current.sequence + 1;
    }
  }
  return messages.length;
}

export function appendAssistantChunkToStore(target: ChatMessage[] | null, index: number | null, chunk: string, kind?: ChatMessage["kind"]): void {
  if (!target || index === null) {
    return;
  }
  const message = target[index];
  if (!message || message.role !== "assistant") {
    return;
  }
  if (kind === "thinking") {
    message.kind = "thinking";
  }
  message.content += chunk;
}

export function getActiveAssistantContent(target: ChatMessage[] | null, index: number | null): string | null {
  if (!target || index === null) {
    return null;
  }
  const message = target[index];
  if (!message || message.role !== "assistant") {
    return null;
  }
  const content = message.content ?? "";
  return content.trim() ? content : null;
}
