export type ClaudeTaskListItem = { text: string; done: boolean };

type NormalizedClaudeTask = {
  id?: string;
  text?: string;
  status?: string;
  done?: boolean;
};

type TrackedClaudeTask = {
  id: string;
  text: string;
  done: boolean;
  order: number;
};

const CLAUDE_TASK_TOOL_NAMES = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "TaskStop",
]);

const COMPLETED_STATUSES = new Set([
  "completed",
  "complete",
  "done",
  "success",
  "succeeded",
  "closed",
]);

const INCOMPLETE_STATUSES = new Set([
  "pending",
  "todo",
  "in_progress",
  "in-progress",
  "running",
  "active",
  "queued",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "stopped",
]);

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readStatus(record: Record<string, unknown>): string | undefined {
  const status = readString(record, ["status", "state"]);
  return status ? status.toLowerCase() : undefined;
}

function statusToDone(status: string | undefined): boolean | undefined {
  if (!status) {
    return undefined;
  }
  if (COMPLETED_STATUSES.has(status)) {
    return true;
  }
  if (INCOMPLETE_STATUSES.has(status)) {
    return false;
  }
  return undefined;
}

function readDone(record: Record<string, unknown>): boolean | undefined {
  if (typeof record.done === "boolean") {
    return record.done;
  }
  if (typeof record.completed === "boolean") {
    return record.completed;
  }
  return statusToDone(readStatus(record));
}

function parseJsonIfPossible(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizePayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return parseJsonIfPossible(value) ?? value;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyContent(item))
      .filter((item) => item.trim().length > 0)
      .join("\n");
  }
  const record = toRecord(value);
  if (record) {
    const text = readString(record, ["text", "content", "subject", "title", "name", "description", "activeForm"]);
    if (text) {
      return text;
    }
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeClaudeTodoItems(todos: unknown[]): ClaudeTaskListItem[] {
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
            : status === "completed" || status === "done";
      return { text: text.trim(), done: Boolean(done) };
    })
    .filter((item): item is ClaudeTaskListItem => Boolean(item));
}

export function extractClaudeTodoWriteItems(input: unknown): ClaudeTaskListItem[] {
  if (typeof input === "string") {
    try {
      return extractClaudeTodoWriteItems(JSON.parse(input));
    } catch {
      return [];
    }
  }
  if (!input || typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  const todos =
    Array.isArray(record.newTodos)
      ? record.newTodos
      : Array.isArray(record.todos)
        ? record.todos
        : Array.isArray(record.items)
          ? record.items
          : Array.isArray(record.oldTodos)
            ? record.oldTodos
            : null;
  if (!todos) {
    return [];
  }
  return normalizeClaudeTodoItems(todos);
}

export function hasClaudeTodoWriteResultShape(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return false;
  }
  const record = input as Record<string, unknown>;
  return Array.isArray(record.newTodos) || Array.isArray(record.todos) || Array.isArray(record.oldTodos);
}

function normalizeTaskRecord(input: unknown): NormalizedClaudeTask | null {
  const record = toRecord(normalizePayload(input));
  if (!record) {
    return null;
  }

  const nestedTask = toRecord(record.task);
  if (nestedTask) {
    const nested = normalizeTaskRecord(nestedTask);
    if (nested) {
      return {
        id: nested.id ?? readString(record, ["taskId", "task_id", "id"]),
        text: nested.text,
        status: nested.status ?? readStatus(record),
        done: nested.done ?? readDone(record),
      };
    }
  }

  const statusChange = toRecord(record.statusChange);
  const statusFromChange = statusChange ? readString(statusChange, ["to", "next", "status"])?.toLowerCase() : undefined;
  const status = statusFromChange ?? readStatus(record);
  const task: NormalizedClaudeTask = {
    id: readString(record, ["taskId", "task_id", "id"]),
    text: readString(record, ["subject", "title", "name", "content", "text", "description", "activeForm"]),
    status,
    done: readDone(record) ?? statusToDone(status),
  };
  return task.id || task.text || task.status || task.done !== undefined ? task : null;
}

function parseTaskCreateTextResult(content: unknown): NormalizedClaudeTask | null {
  const text = stringifyContent(content).trim();
  if (!text) {
    return null;
  }
  const match = text.match(/Task\s*#([^\s:]+)\s+created\s+successfully(?::\s*(.+))?/i);
  if (!match) {
    return null;
  }
  return {
    id: match[1]?.trim(),
    text: match[2]?.trim(),
    done: false,
  };
}

function extractTaskArray(input: unknown): unknown[] | null {
  const payload = normalizePayload(input);
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = toRecord(payload);
  if (!record) {
    return null;
  }

  for (const key of ["tasks", "taskList", "task_list", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  if (record.task) {
    return [record.task];
  }

  for (const key of ["data", "result"]) {
    const nested = record[key];
    const tasks = extractTaskArray(nested);
    if (tasks) {
      return tasks;
    }
  }

  return null;
}

function mergeTaskInfo(
  task: NormalizedClaudeTask | null,
  fallback: NormalizedClaudeTask | null,
): NormalizedClaudeTask | null {
  if (!task && !fallback) {
    return null;
  }
  return {
    id: task?.id ?? fallback?.id,
    text: task?.text ?? fallback?.text,
    status: task?.status ?? fallback?.status,
    done: task?.done ?? fallback?.done,
  };
}

function normalizeTaskToolName(name: string | undefined): string | null {
  if (!name || !CLAUDE_TASK_TOOL_NAMES.has(name)) {
    return null;
  }
  return name;
}

export class ClaudeTaskListTracker {
  private readonly tasks = new Map<string, TrackedClaudeTask>();
  private readonly pendingCreates = new Map<string, NormalizedClaudeTask>();
  private readonly pendingUpdates = new Map<string, NormalizedClaudeTask>();
  private nextOrder = 0;
  private lastSignature = "[]";

  public recordToolUse(toolUse: {
    id?: string;
    name?: string;
    input?: unknown;
  }): ClaudeTaskListItem[] | null {
    const toolName = normalizeTaskToolName(toolUse.name);
    if (!toolName) {
      return null;
    }

    const task = normalizeTaskRecord(toolUse.input);
    if (toolName === "TaskCreate") {
      if (toolUse.id && task) {
        this.pendingCreates.set(toolUse.id, task);
      }
      return null;
    }

    if (toolName === "TaskUpdate" || toolName === "TaskStop") {
      if (toolUse.id && task) {
        this.pendingUpdates.set(toolUse.id, task);
      }
      if (this.upsertTask(task)) {
        return this.snapshotIfChanged();
      }
      return null;
    }

    if (toolName === "TaskGet") {
      if (this.upsertTask(task)) {
        return this.snapshotIfChanged();
      }
      return null;
    }

    return null;
  }

  public recordToolResult(toolResult: {
    toolUseId?: string;
    toolName?: string;
    content?: unknown;
  }): ClaudeTaskListItem[] | null {
    const toolName = normalizeTaskToolName(toolResult.toolName);
    if (!toolName) {
      return null;
    }

    if (toolName === "TaskList") {
      const tasks = extractTaskArray(toolResult.content);
      if (!tasks) {
        return null;
      }
      this.replaceTasks(tasks);
      return this.snapshotIfChanged();
    }

    if (toolName === "TaskCreate") {
      const pending = toolResult.toolUseId ? this.pendingCreates.get(toolResult.toolUseId) ?? null : null;
      const task = mergeTaskInfo(
        normalizeTaskRecord(toolResult.content) ?? parseTaskCreateTextResult(toolResult.content),
        pending,
      );
      if (toolResult.toolUseId) {
        this.pendingCreates.delete(toolResult.toolUseId);
      }
      if (this.upsertTask(task)) {
        return this.snapshotIfChanged();
      }
      return null;
    }

    if (toolName === "TaskUpdate" || toolName === "TaskStop") {
      const pending = toolResult.toolUseId ? this.pendingUpdates.get(toolResult.toolUseId) ?? null : null;
      const task = mergeTaskInfo(normalizeTaskRecord(toolResult.content), pending);
      if (toolResult.toolUseId) {
        this.pendingUpdates.delete(toolResult.toolUseId);
      }
      if (this.upsertTask(task)) {
        return this.snapshotIfChanged();
      }
      return null;
    }

    if (toolName === "TaskGet") {
      const task = normalizeTaskRecord(toolResult.content);
      if (this.upsertTask(task)) {
        return this.snapshotIfChanged();
      }
    }

    return null;
  }

  private replaceTasks(tasks: unknown[]): void {
    this.tasks.clear();
    this.nextOrder = 0;
    tasks.forEach((task, index) => {
      const normalized = normalizeTaskRecord(task);
      this.upsertTask(normalized, `task_list_${index}`);
    });
  }

  private upsertTask(task: NormalizedClaudeTask | null, fallbackId?: string): boolean {
    if (!task) {
      return false;
    }
    const taskId = task.id ?? fallbackId;
    if (!taskId) {
      return false;
    }
    const existing = this.tasks.get(taskId);
    const text = task.text ?? existing?.text ?? `Task #${taskId}`;
    const done = task.done ?? statusToDone(task.status) ?? existing?.done ?? false;
    const order = existing?.order ?? this.nextOrder;
    if (!existing) {
      this.nextOrder += 1;
    }
    this.tasks.set(taskId, {
      id: taskId,
      text,
      done,
      order,
    });
    return true;
  }

  private snapshotIfChanged(): ClaudeTaskListItem[] | null {
    const items = Array.from(this.tasks.values())
      .sort((left, right) => left.order - right.order)
      .map((task) => ({ text: task.text, done: task.done }));
    const signature = JSON.stringify(items);
    if (signature === this.lastSignature) {
      return null;
    }
    this.lastSignature = signature;
    return items;
  }
}
