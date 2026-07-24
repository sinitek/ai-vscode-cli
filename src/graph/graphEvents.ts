import * as fs from "fs";
import * as path from "path";

import { getGraphCommunicationPaths } from "./graphCommunications";
import {
  isGraphEventType,
  type GraphEventRecord,
  type GraphEventType,
} from "./types";

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(?:^|[_\-\s.])(token|secret|password|key|apiKey|api_key|accessKey|access_key|privateKey|private_key|authKey|auth_key)(?:$|[_\-\s.])/i;
const SENSITIVE_INLINE_PATTERN = /\b(token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|key)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;

export type GraphEventAppendInput = {
  eventId?: string;
  runId: string;
  type: GraphEventType;
  timestamp?: number;
  nodeId?: string;
  attempt?: number;
  summary?: string;
  error?: string;
  data?: unknown;
};

export type GraphEventAppendOptions = {
  baseDir?: string;
  now?: () => number;
  eventId?: string;
};

export function buildGraphEventsFile(
  graphRunId: string,
  options: { baseDir?: string } = {},
): string {
  return getGraphCommunicationPaths(graphRunId, options).eventsFile;
}

export function appendGraphEvent(
  eventsFile: string,
  input: GraphEventAppendInput,
  options: GraphEventAppendOptions = {},
): GraphEventRecord {
  const event = createGraphEventRecord(input, options);
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function appendGraphEventForRun(
  graphRunId: string,
  input: GraphEventAppendInput,
  options: GraphEventAppendOptions = {},
): GraphEventRecord {
  return appendGraphEvent(buildGraphEventsFile(graphRunId, options), input, options);
}

export function readGraphEvents(eventsFile: string): GraphEventRecord[] {
  if (!fs.existsSync(eventsFile)) {
    return [];
  }
  const lines = fs.readFileSync(eventsFile, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Graph event JSON at ${eventsFile}:${index + 1}: ${String(error)}`);
    }
    const normalized = normalizeGraphEventRecord(parsed);
    if (!normalized) {
      throw new Error(`Invalid Graph event record at ${eventsFile}:${index + 1}`);
    }
    return normalized;
  });
}

export function readGraphEventsForRun(
  graphRunId: string,
  options: { baseDir?: string } = {},
): GraphEventRecord[] {
  return readGraphEvents(buildGraphEventsFile(graphRunId, options));
}

export function createGraphEventRecord(
  input: GraphEventAppendInput,
  options: GraphEventAppendOptions = {},
): GraphEventRecord {
  if (!isGraphEventType(input.type)) {
    throw new Error(`Unsupported Graph event type: ${String(input.type)}`);
  }
  if (typeof input.runId !== "string" || !input.runId.trim()) {
    throw new Error("Graph event runId is required");
  }
  const timestamp = typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
    ? input.timestamp
    : (options.now?.() ?? Date.now());
  return {
    eventId: input.eventId ?? options.eventId ?? createGraphEventId(input.runId, timestamp),
    runId: input.runId,
    type: input.type,
    timestamp,
    ...(typeof input.nodeId === "string" && input.nodeId.trim() ? { nodeId: input.nodeId.trim() } : {}),
    ...(typeof input.attempt === "number" && Number.isInteger(input.attempt) && input.attempt >= 0 ? { attempt: input.attempt } : {}),
    ...(typeof input.summary === "string" ? { summary: redactInlineSecrets(input.summary) } : {}),
    ...(typeof input.error === "string" ? { error: redactInlineSecrets(input.error) } : {}),
    ...(input.data !== undefined ? { data: redactGraphEventValue(input.data) } : {}),
  };
}

export function normalizeGraphEventRecord(record: unknown): GraphEventRecord | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const raw = record as Partial<GraphEventRecord>;
  if (
    typeof raw.eventId !== "string"
    || !raw.eventId.trim()
    || typeof raw.runId !== "string"
    || !raw.runId.trim()
    || !isGraphEventType(raw.type)
    || typeof raw.timestamp !== "number"
    || !Number.isFinite(raw.timestamp)
  ) {
    return null;
  }
  return {
    eventId: raw.eventId,
    runId: raw.runId,
    type: raw.type,
    timestamp: raw.timestamp,
    ...(typeof raw.nodeId === "string" && raw.nodeId.trim() ? { nodeId: raw.nodeId.trim() } : {}),
    ...(typeof raw.attempt === "number" && Number.isInteger(raw.attempt) && raw.attempt >= 0 ? { attempt: raw.attempt } : {}),
    ...(typeof raw.summary === "string" ? { summary: redactInlineSecrets(raw.summary) } : {}),
    ...(typeof raw.error === "string" ? { error: redactInlineSecrets(raw.error) } : {}),
    ...(raw.data !== undefined ? { data: redactGraphEventValue(raw.data) } : {}),
  };
}

export function redactGraphEventValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }
  if (typeof value === "string") {
    return redactInlineSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactGraphEventValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
    redacted[entryKey] = redactGraphEventValue(entryValue, entryKey);
  });
  return redacted;
}

function createGraphEventId(runId: string, timestamp: number): string {
  return `${runId}-${timestamp}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSensitiveKey(key: string): boolean {
  const compact = key.replace(/[\s_.-]/g, "");
  return SENSITIVE_KEY_PATTERN.test(key) || /(?:token|secret|password|apikey|accesskey|privatekey|authkey)$/i.test(compact) || /^key$/i.test(compact);
}

function redactInlineSecrets(value: string): string {
  return value.replace(SENSITIVE_INLINE_PATTERN, (_match, key: string, separator: string) => {
    return `${key}${separator}${REDACTED_VALUE}`;
  });
}
