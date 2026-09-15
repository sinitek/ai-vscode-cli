import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { CliName, InteractiveMode, LoopExecutionMode, ThinkingMode } from "./cli/types";
import type { PromptContextOptions, ScheduledTaskAttachment, ScheduledTaskRecord, ScheduledTaskStatus, ScheduledTaskSummary } from "./webview/types";

export const SCHEDULED_TASK_STORE_FILE = path.join(os.homedir(), ".sinitek_cli", "scheduled-tasks.json");
export const SCHEDULED_TASK_ATTACHMENT_DIR = path.join(os.homedir(), ".sinitek_cli", "scheduled-attachments");
export const SCHEDULED_TASK_MAX_PROMPT_LENGTH = 100_000;
export const SCHEDULED_TASK_MAX_COUNT = 500;
const MAX_TIMER_DELAY_MS = 60 * 1000;
const SCHEDULED_TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type ScheduledTaskStore = {
  tasks: ScheduledTaskRecord[];
};

export type ScheduledTaskInput = {
  id?: string;
  prompt: string;
  scheduledAt: number;
  cli: CliName;
  tabId?: string | null;
  workspaceKey: string;
  interactiveMode?: InteractiveMode;
  contextOptions?: PromptContextOptions;
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
  loopExecutionMode?: LoopExecutionMode;
  attachments?: ScheduledTaskAttachment[];
};

export type ScheduledTaskExecutionConfig = {
  interactiveMode: InteractiveMode;
  loopExecutionMode?: LoopExecutionMode;
};

export function resolveScheduledTaskExecutionConfig(
  interactiveMode: InteractiveMode,
  loopExecutionMode: LoopExecutionMode,
): ScheduledTaskExecutionConfig {
  return interactiveMode === "loop"
    ? { interactiveMode, loopExecutionMode }
    : { interactiveMode };
}

export function createScheduledTaskRecord(
  input: ScheduledTaskInput,
  now = Date.now(),
): ScheduledTaskRecord {
  const prompt = normalizeString(input.prompt);
  if (!prompt) {
    throw new Error("Scheduled task prompt cannot be empty.");
  }
  if (!isFiniteTimestamp(input.scheduledAt)) {
    throw new Error("Scheduled task time is invalid.");
  }
  const id = normalizeOptionalString(input.id, 200) ?? `scheduled_${now}_${Math.random().toString(16).slice(2)}`;
  const createdAt = now;
  return {
    id,
    prompt,
    scheduledAt: input.scheduledAt,
    createdAt,
    updatedAt: now,
    cli: input.cli,
    tabId: typeof input.tabId === "string" && input.tabId.trim() ? input.tabId.trim() : null,
    workspaceKey: normalizeOptionalString(input.workspaceKey, 500) ?? "no-workspace",
    status: "pending",
    ...(input.interactiveMode ? { interactiveMode: input.interactiveMode } : {}),
    ...(input.contextOptions ? {
      contextOptions: {
        includeCurrentFile: input.contextOptions.includeCurrentFile === true,
        includeSelection: input.contextOptions.includeSelection === true,
      },
    } : {}),
    ...(normalizeOptionalString(input.model) ? { model: normalizeOptionalString(input.model) } : {}),
    ...(normalizeOptionalString(input.loopMainModel) ? { loopMainModel: normalizeOptionalString(input.loopMainModel) } : {}),
    ...(normalizeOptionalString(input.loopSubtaskModel) ? { loopSubtaskModel: normalizeOptionalString(input.loopSubtaskModel) } : {}),
    ...(input.loopMainThinkingMode ? { loopMainThinkingMode: input.loopMainThinkingMode } : {}),
    ...(input.loopSubtaskThinkingMode ? { loopSubtaskThinkingMode: input.loopSubtaskThinkingMode } : {}),
    ...(input.loopExecutionMode ? { loopExecutionMode: input.loopExecutionMode } : {}),
    attachments: Array.isArray(input.attachments) ? input.attachments.map((attachment) => ({
      name: attachment.name,
      path: attachment.path,
    })) : [],
  };
}

export function upsertScheduledTask(
  store: ScheduledTaskStore,
  input: ScheduledTaskInput,
  now = Date.now(),
): ScheduledTaskRecord {
  const task = createScheduledTaskRecord(input, now);
  const existingIndex = store.tasks.findIndex((candidate) => candidate.id === task.id);
  if (existingIndex >= 0) {
    store.tasks[existingIndex] = task;
  } else {
    store.tasks.push(task);
  }
  return task;
}

export function removeScheduledTask(store: ScheduledTaskStore, taskId: string): ScheduledTaskRecord | null {
  const index = store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    return null;
  }
  const [removed] = store.tasks.splice(index, 1);
  return removed ?? null;
}

export type ScheduledTaskStoreDeps = {
  storeFile: string;
  isCliName: (value: string) => value is CliName;
  isInteractiveMode?: (value: unknown) => value is InteractiveMode;
  isThinkingMode?: (value: unknown) => value is ThinkingMode;
  isTimestampWithinHistoryRetention?: (timestamp: number, now?: number) => boolean;
  logError: (event: string, payload?: unknown) => void;
};

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeString(value: unknown, maxLength = SCHEDULED_TASK_MAX_PROMPT_LENGTH): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeOptionalString(value: unknown, maxLength = 500): string | undefined {
  return normalizeString(value, maxLength);
}

function normalizeAttachment(value: unknown): ScheduledTaskAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<ScheduledTaskAttachment>;
  const filePath = normalizeOptionalString(raw.path, 4_000);
  const name = normalizeOptionalString(raw.name, 500);
  if (!filePath || !name) {
    return null;
  }
  return { path: filePath, name };
}

function normalizeStatus(value: unknown): ScheduledTaskStatus {
  if (value === "completed" || value === "failed" || value === "cancelled") {
    return value;
  }
  // A process can be terminated while a task is running. It is safe to retry it
  // after restart because no completion marker has been written yet.
  return "pending";
}

export function normalizeScheduledTaskRecord(
  value: unknown,
  deps: Pick<ScheduledTaskStoreDeps, "isCliName" | "isInteractiveMode" | "isThinkingMode">,
): ScheduledTaskRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<ScheduledTaskRecord> & { attachments?: unknown };
  const id = normalizeOptionalString(raw.id, 200);
  const prompt = normalizeString(raw.prompt);
  const cli = typeof raw.cli === "string" && deps.isCliName(raw.cli) ? raw.cli : null;
  if (!id || !prompt || !cli || !isFiniteTimestamp(raw.scheduledAt) || !isFiniteTimestamp(raw.createdAt)) {
    return null;
  }
  const createdAt = raw.createdAt;
  const updatedAt = isFiniteTimestamp(raw.updatedAt) ? raw.updatedAt : createdAt;
  const executedAt = isFiniteTimestamp(raw.executedAt) ? raw.executedAt : undefined;
  const contextOptions = raw.contextOptions && typeof raw.contextOptions === "object"
    ? {
        includeCurrentFile: (raw.contextOptions as PromptContextOptions).includeCurrentFile === true,
        includeSelection: (raw.contextOptions as PromptContextOptions).includeSelection === true,
      }
    : undefined;
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.map(normalizeAttachment).filter((item): item is ScheduledTaskAttachment => Boolean(item))
    : [];
  return {
    id,
    prompt,
    scheduledAt: raw.scheduledAt,
    createdAt,
    updatedAt,
    cli,
    tabId: typeof raw.tabId === "string" && raw.tabId.trim() ? raw.tabId.trim() : null,
    workspaceKey: normalizeOptionalString(raw.workspaceKey, 500) ?? "no-workspace",
    status: normalizeStatus(raw.status),
    ...(typeof raw.interactiveMode === "string" && (!deps.isInteractiveMode || deps.isInteractiveMode(raw.interactiveMode))
      ? { interactiveMode: raw.interactiveMode }
      : {}),
    ...(contextOptions ? { contextOptions } : {}),
    ...(normalizeOptionalString(raw.model) ? { model: normalizeOptionalString(raw.model) } : {}),
    ...(normalizeOptionalString(raw.loopMainModel) ? { loopMainModel: normalizeOptionalString(raw.loopMainModel) } : {}),
    ...(normalizeOptionalString(raw.loopSubtaskModel) ? { loopSubtaskModel: normalizeOptionalString(raw.loopSubtaskModel) } : {}),
    ...(typeof raw.loopMainThinkingMode === "string" && (!deps.isThinkingMode || deps.isThinkingMode(raw.loopMainThinkingMode))
      ? { loopMainThinkingMode: raw.loopMainThinkingMode }
      : {}),
    ...(typeof raw.loopSubtaskThinkingMode === "string" && (!deps.isThinkingMode || deps.isThinkingMode(raw.loopSubtaskThinkingMode))
      ? { loopSubtaskThinkingMode: raw.loopSubtaskThinkingMode }
      : {}),
    ...(typeof raw.loopExecutionMode === "string" ? { loopExecutionMode: raw.loopExecutionMode } : {}),
    attachments,
    ...(executedAt ? { executedAt } : {}),
    ...(normalizeOptionalString(raw.lastError, 4_000) ? { lastError: normalizeOptionalString(raw.lastError, 4_000) } : {}),
  };
}

export function ensureScheduledTaskStore(
  store: ScheduledTaskStore | undefined,
  deps: Pick<ScheduledTaskStoreDeps, "isCliName" | "isInteractiveMode" | "isThinkingMode" | "isTimestampWithinHistoryRetention">,
  now = Date.now(),
): ScheduledTaskStore {
  const normalized = Array.isArray(store?.tasks)
    ? store.tasks
        .map((task) => normalizeScheduledTaskRecord(task, deps))
        .filter((task): task is ScheduledTaskRecord => Boolean(task))
    : [];
  const isWithinRetention = deps.isTimestampWithinHistoryRetention
    ?? ((timestamp: number, currentNow = Date.now()) => timestamp >= currentNow - SCHEDULED_TASK_RETENTION_MS);
  const retained = normalized.filter((task) => (
    task.status === "pending" || task.status === "running"
      || isWithinRetention(task.updatedAt, now)
  ));
  retained.sort((left, right) => left.scheduledAt - right.scheduledAt || left.createdAt - right.createdAt);
  return { tasks: retained.slice(0, SCHEDULED_TASK_MAX_COUNT) };
}

export function readScheduledTaskStore(deps: ScheduledTaskStoreDeps): ScheduledTaskStore {
  try {
    if (!fs.existsSync(deps.storeFile)) {
      return { tasks: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(deps.storeFile, "utf8")) as ScheduledTaskStore;
    return ensureScheduledTaskStore(parsed, deps);
  } catch (error) {
    deps.logError("scheduled-task-store-read-error", { error: String(error) });
    return { tasks: [] };
  }
}

export function writeScheduledTaskStore(
  store: ScheduledTaskStore,
  deps: Pick<ScheduledTaskStoreDeps, "storeFile" | "logError">,
): void {
  try {
    fs.mkdirSync(path.dirname(deps.storeFile), { recursive: true });
    fs.writeFileSync(deps.storeFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  } catch (error) {
    deps.logError("scheduled-task-store-write-error", { error: String(error) });
  }
}

export function buildScheduledTaskSummary(task: ScheduledTaskRecord): ScheduledTaskSummary {
  return {
    id: task.id,
    prompt: task.prompt,
    scheduledAt: task.scheduledAt,
    createdAt: task.createdAt,
    cli: task.cli,
    status: task.status,
    attachmentNames: task.attachments.map((attachment) => attachment.name),
    ...(task.executedAt ? { executedAt: task.executedAt } : {}),
    ...(task.lastError ? { lastError: task.lastError } : {}),
  };
}

export function buildScheduledTaskSummaries(store: ScheduledTaskStore): ScheduledTaskSummary[] {
  return store.tasks
    .slice()
    .sort((left, right) => right.scheduledAt - left.scheduledAt || right.createdAt - left.createdAt)
    .map(buildScheduledTaskSummary);
}

export type ScheduledTaskSchedulerDeps = {
  readStore: () => ScheduledTaskStore;
  writeStore: (store: ScheduledTaskStore) => void;
  getWorkspaceKey: () => string;
  executeTask: (task: ScheduledTaskRecord) => Promise<void>;
  onChanged?: () => void;
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
};

export class ScheduledTaskScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private processing = false;

  public constructor(private readonly deps: ScheduledTaskSchedulerDeps) {}

  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.runDueTasks();
  }

  public stop(): void {
    this.started = false;
    this.clearTimer();
  }

  public notifyChanged(): void {
    if (this.started) {
      this.scheduleNext();
    }
  }

  public async runDueTasks(now = this.getNow()): Promise<void> {
    if (!this.started || this.processing) {
      return;
    }
    this.processing = true;
    try {
      const store = this.deps.readStore();
      const dueTasks = store.tasks
        .filter((task) => task.status === "pending" && task.workspaceKey === this.deps.getWorkspaceKey() && task.scheduledAt <= now)
        .sort((left, right) => left.scheduledAt - right.scheduledAt);
      for (const task of dueTasks) {
        const currentStore = this.deps.readStore();
        const current = currentStore.tasks.find((candidate) => candidate.id === task.id);
        if (!current || current.status !== "pending" || current.workspaceKey !== this.deps.getWorkspaceKey()) {
          continue;
        }
        current.status = "running";
        current.updatedAt = this.getNow();
        current.lastError = undefined;
        this.deps.writeStore(currentStore);
        this.deps.onChanged?.();
        try {
          await this.deps.executeTask(current);
          this.updateTask(current.id, (next) => {
            next.status = "completed";
            next.executedAt = this.getNow();
            next.updatedAt = this.getNow();
            next.lastError = undefined;
          });
        } catch (error) {
          this.updateTask(current.id, (next) => {
            next.status = "failed";
            next.updatedAt = this.getNow();
            next.lastError = error instanceof Error ? error.message : String(error);
          });
        }
      }
    } finally {
      this.processing = false;
      this.scheduleNext();
    }
  }

  private updateTask(taskId: string, update: (task: ScheduledTaskRecord) => void): void {
    const store = this.deps.readStore();
    const task = store.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    update(task);
    this.deps.writeStore(store);
    this.deps.onChanged?.();
  }

  private scheduleNext(): void {
    if (!this.started) {
      return;
    }
    this.clearTimer();
    const now = this.getNow();
    const next = this.deps.readStore().tasks
      .filter((task) => task.status === "pending" && task.workspaceKey === this.deps.getWorkspaceKey())
      .sort((left, right) => left.scheduledAt - right.scheduledAt)[0];
    if (!next) {
      return;
    }
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, next.scheduledAt - now));
    const setTimeoutImpl = this.deps.setTimeout ?? setTimeout;
    this.timer = setTimeoutImpl(() => {
      void this.runDueTasks();
    }, delay);
  }

  private clearTimer(): void {
    if (!this.timer) {
      return;
    }
    const clearTimeoutImpl = this.deps.clearTimeout ?? clearTimeout;
    clearTimeoutImpl(this.timer);
    this.timer = null;
  }

  private getNow(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}
