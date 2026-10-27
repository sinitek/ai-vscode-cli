import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { HumanInteractionRequest, HumanInteractionSubmission } from "./humanInteraction";
import { isTimestampWithinHistoryRetention } from "./historyRetention";

export const HUMAN_INTERACTION_HISTORY_LIMIT = 500;

export type HumanInteractionHistorySource = "vibe" | "orchestrator";

export type HumanInteractionHistoryRecord = {
  id: string;
  interactionId: string;
  tabId?: string;
  source: HumanInteractionHistorySource;
  title: string;
  instruction: string;
  formFields: HumanInteractionRequest["formFields"];
  status: "completed" | "aborted";
  timedOut: boolean;
  values: Record<string, unknown>;
  createdAt: number;
};

type HumanInteractionHistoryStore = { items: HumanInteractionHistoryRecord[] };

export type HumanInteractionHistoryOptions = {
  filePath: string;
  limit?: number;
  isTimestampWithinRetention?: (timestamp: number) => boolean;
  logError?: (event: string, payload?: unknown) => void;
};

export function cleanupHumanInteractionHistory(options: HumanInteractionHistoryOptions): void {
  const items = readHumanInteractionHistory(options);
  try {
    if (!items.length) {
      if (fs.existsSync(options.filePath)) {
        fs.unlinkSync(options.filePath);
      }
      return;
    }
    fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
    fs.writeFileSync(options.filePath, JSON.stringify({ items }, null, 2), "utf8");
  } catch (error) {
    options.logError?.("human-interaction-history-cleanup-error", { error: String(error) });
  }
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
    ? value
    : String(value ?? "");
}

export function buildHumanInteractionHistoryRecord(
  request: HumanInteractionRequest,
  submission: HumanInteractionSubmission,
  source: HumanInteractionHistorySource = "vibe",
  createdAt = Date.now(),
): HumanInteractionHistoryRecord {
  const values = Object.fromEntries(request.formFields.map((field) => [
    field.id,
    field.type === "password" ? "已隐藏" : sanitizeValue(submission.values?.[field.id]),
  ]));
  return {
    id: randomUUID(),
    interactionId: request.interactionId,
    ...(request.tabId ? { tabId: request.tabId } : {}),
    source,
    title: request.title,
    instruction: request.instruction,
    formFields: request.formFields.map((field) => field.type === "password"
      ? { ...field, defaultValue: undefined }
      : field),
    status: submission.status === "completed" ? "completed" : "aborted",
    timedOut: submission.timedOut === true,
    values,
    createdAt,
  };
}

export function readHumanInteractionHistory(
  options: HumanInteractionHistoryOptions,
): HumanInteractionHistoryRecord[] {
  try {
    if (!fs.existsSync(options.filePath)) {
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(options.filePath, "utf8")) as HumanInteractionHistoryStore;
    const withinRetention = options.isTimestampWithinRetention ?? isTimestampWithinHistoryRetention;
    return (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((item) => item && typeof item.id === "string" && withinRetention(item.createdAt))
      .slice(0, options.limit ?? HUMAN_INTERACTION_HISTORY_LIMIT);
  } catch (error) {
    options.logError?.("human-interaction-history-read-error", { error: String(error) });
    return [];
  }
}

export function recordHumanInteractionHistory(
  request: HumanInteractionRequest,
  submission: HumanInteractionSubmission,
  options: HumanInteractionHistoryOptions,
  source: HumanInteractionHistorySource = "vibe",
): HumanInteractionHistoryRecord {
  const record = buildHumanInteractionHistoryRecord(request, submission, source);
  const items = [record, ...readHumanInteractionHistory(options)]
    .slice(0, options.limit ?? HUMAN_INTERACTION_HISTORY_LIMIT);
  try {
    fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
    fs.writeFileSync(options.filePath, JSON.stringify({ items }, null, 2), "utf8");
  } catch (error) {
    options.logError?.("human-interaction-history-write-error", { error: String(error) });
  }
  return record;
}
