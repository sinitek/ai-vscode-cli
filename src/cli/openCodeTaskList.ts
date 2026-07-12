export type OpenCodeTaskListItem = {
  text: string;
  done: boolean;
};

const TODO_ARRAY_KEYS = ["todos", "newTodos", "items", "oldTodos"] as const;
const TODO_CONTAINER_KEYS = ["input", "metadata", "output", "state", "part", "data", "result"] as const;
const COMPLETED_STATUSES = new Set(["completed", "complete", "done", "finished", "success", "succeeded"]);
const MAX_TODO_SEARCH_DEPTH = 5;

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonValue(value: string): unknown | null {
  const normalized = value.trim();
  if (!normalized || (!normalized.startsWith("{") && !normalized.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

function findTodoArray(value: unknown, depth = 0): unknown[] | null {
  if (depth > MAX_TODO_SEARCH_DEPTH) {
    return null;
  }
  if (typeof value === "string") {
    const parsed = parseJsonValue(value);
    return parsed === null ? null : findTodoArray(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    return value;
  }
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  for (const key of TODO_ARRAY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = parseJsonValue(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  }

  for (const key of TODO_CONTAINER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const nested = findTodoArray(record[key], depth + 1);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function readTodoText(record: Record<string, unknown>): string {
  for (const key of ["content", "text", "title", "subject"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readTodoDone(record: Record<string, unknown>): boolean {
  if (typeof record.done === "boolean") {
    return record.done;
  }
  if (typeof record.completed === "boolean") {
    return record.completed;
  }
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  return COMPLETED_STATUSES.has(status);
}

export function isOpenCodeTaskListTool(toolName: string): boolean {
  return toolName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") === "todowrite";
}

export function extractOpenCodeTaskListItems(value: unknown): OpenCodeTaskListItem[] | null {
  const todos = findTodoArray(value);
  if (todos === null) {
    return null;
  }
  return todos
    .map((todo) => {
      const record = toRecord(todo);
      if (!record) {
        return null;
      }
      const text = readTodoText(record);
      if (!text) {
        return null;
      }
      return { text, done: readTodoDone(record) };
    })
    .filter((item): item is OpenCodeTaskListItem => item !== null);
}
