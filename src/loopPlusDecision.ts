import { createHash } from "crypto";
import { normalizeLoopWriteFiles } from "./loopParallel";
import { extractJsonObjectTexts } from "./shared/jsonObjectText";
import type {
  LoopAcceptance,
  LoopAcceptanceCheck,
  LoopSubtaskDecision,
} from "./loopTaskStore";

export const LOOP_PLUS_DECISION_SUBTASK_MAX = 6;
export const LOOP_PLUS_DECISION_SUBTASK_MIN = 1;
export const LOOP_PLUS_DECISION_SUBTASK_LIMIT = 20;
export const LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH = 80;
export const LOOP_PLUS_DECISION_STATUSES = [
  "dispatch",
  "accept",
  "wait",
  "blocked",
  "completed",
] as const;

const ESTIMATED_REMAINING_ROUNDS_MAX = 100;
const IMPLICIT_QUEUE_CONFIRMATION_KEYS = [
  "confirmedEventIds",
  "acceptedEventIds",
] as const;

export type LoopPlusDecisionStatus = (typeof LOOP_PLUS_DECISION_STATUSES)[number];

export type LoopPlusDecision = {
  status: LoopPlusDecisionStatus;
  reviewEventId?: string;
  reviewEventIds?: string[];
  subtasks?: LoopSubtaskDecision[];
  answerConclusion?: string;
  finalSummary?: string;
  acceptance?: LoopAcceptance;
  requirementCoverage?: LoopAcceptanceCheck[];
  estimatedRemainingRounds?: number;
};

export type LoopPlusDecisionOptions = {
  subtaskMax?: number;
};

export function resolveLoopPlusDecisionSubtaskMax(value?: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return LOOP_PLUS_DECISION_SUBTASK_MAX;
  }
  return Math.min(
    Math.max(Math.floor(numeric), LOOP_PLUS_DECISION_SUBTASK_MIN),
    LOOP_PLUS_DECISION_SUBTASK_LIMIT,
  );
}

export function parseLoopPlusDecision(
  content: string | null | undefined,
  options?: LoopPlusDecisionOptions,
): LoopPlusDecision | null {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }
  for (const jsonText of extractJsonObjectTexts(content)) {
    try {
      const decision = normalizeLoopPlusDecision(JSON.parse(jsonText), options);
      if (decision) {
        return decision;
      }
    } catch {
      // A prompt may contain malformed or illustrative JSON before the decision.
    }
  }
  return null;
}

export function normalizeLoopPlusDecision(
  value: unknown,
  options?: LoopPlusDecisionOptions,
): LoopPlusDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  if (hasImplicitQueueConfirmation(value)) {
    return null;
  }
  const estimatedRemainingRounds = normalizeEstimatedRemainingRounds(value.estimatedRemainingRounds);
  const subtaskMax = resolveLoopPlusDecisionSubtaskMax(options?.subtaskMax);
  switch (value.status) {
    case "dispatch":
      return normalizeDispatchDecision(value, estimatedRemainingRounds, subtaskMax);
    case "accept":
      return normalizeAcceptDecision(value, estimatedRemainingRounds, subtaskMax);
    case "wait":
      return normalizeWaitDecision(value, estimatedRemainingRounds, subtaskMax);
    case "blocked":
      return normalizeBlockedDecision(value, estimatedRemainingRounds, subtaskMax);
    case "completed":
      return normalizeCompletedDecision(value, estimatedRemainingRounds, subtaskMax);
    default:
      return null;
  }
}

function normalizeDispatchDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
): LoopPlusDecision | null {
  if (hasReviewEventConfirmation(raw)) {
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks || subtasks.length < 1) {
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "dispatch",
    subtasks,
  }, estimatedRemainingRounds);
}

function normalizeAcceptDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
): LoopPlusDecision | null {
  const reviewEvents = readReviewConfirmation(raw, true);
  if (!reviewEvents) {
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks) {
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "accept",
    ...reviewEvents,
    ...(subtasks.length > 0 ? { subtasks } : {}),
  }, estimatedRemainingRounds);
}

function normalizeWaitDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
): LoopPlusDecision | null {
  if (hasReviewEventConfirmation(raw)) {
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks || subtasks.length > 0) {
    return null;
  }
  return withEstimatedRemainingRounds({ status: "wait" }, estimatedRemainingRounds);
}

function normalizeBlockedDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
): LoopPlusDecision | null {
  if (hasReviewEventConfirmation(raw)) {
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks || subtasks.length > 0) {
    return null;
  }
  const finalSummary = readOptionalText(raw.finalSummary);
  return withEstimatedRemainingRounds({
    status: "blocked",
    ...(finalSummary ? { finalSummary } : {}),
  }, estimatedRemainingRounds);
}

function normalizeCompletedDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
): LoopPlusDecision | null {
  const reviewEvents = readReviewConfirmation(raw, false);
  if (!reviewEvents) {
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks || subtasks.length > 0) {
    return null;
  }
  const answerConclusion = readOptionalText(raw.answerConclusion);
  const finalSummary = readOptionalText(raw.finalSummary);
  const acceptance = normalizeAcceptance(raw.acceptance);
  const requirementCoverage = normalizeAcceptanceChecks(raw.requirementCoverage);
  if (
    !answerConclusion
    || !finalSummary
    || !acceptance
    || acceptance.passed !== true
    || acceptance.checks.length === 0
    || acceptance.checks.some((check) => check.passed !== true)
    || !requirementCoverage
    || requirementCoverage.length === 0
    || requirementCoverage.some((item) => item.passed !== true)
  ) {
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "completed",
    ...reviewEvents,
    answerConclusion,
    finalSummary,
    acceptance,
    requirementCoverage,
  }, estimatedRemainingRounds);
}

function withEstimatedRemainingRounds(
  decision: LoopPlusDecision,
  estimatedRemainingRounds: number | undefined,
): LoopPlusDecision {
  if (estimatedRemainingRounds === undefined) {
    return decision;
  }
  return {
    ...decision,
    estimatedRemainingRounds,
  };
}

function readSubtasks(raw: Record<string, unknown>, subtaskMax: number): LoopSubtaskDecision[] | null {
  const items = readRawSubtasks(raw);
  if (!items || items.length > subtaskMax) {
    return null;
  }
  const subtasks: LoopSubtaskDecision[] = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    const subtask = normalizeSubtask(item);
    if (!subtask?.id || seenIds.has(subtask.id)) {
      return null;
    }
    seenIds.add(subtask.id);
    subtasks.push(subtask);
  }
  return subtasks;
}

function readRawSubtasks(raw: Record<string, unknown>): unknown[] | null {
  if (hasOwn(raw, "subtasks")) {
    return Array.isArray(raw.subtasks) ? raw.subtasks : null;
  }
  if (hasOwn(raw, "subtask")) {
    if (!isRecord(raw.subtask)) {
      return null;
    }
    return [raw.subtask];
  }
  return [];
}

function normalizeSubtask(value: unknown): LoopSubtaskDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  const title = readOptionalText(value.title);
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  if (!title || prompt.length < LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH) {
    return null;
  }
  const id = readOptionalText(value.id) ?? buildLoopPlusSubtaskId(title);
  const conflictGroup = readOptionalText(value.conflictGroup);
  const writeFiles = normalizeLoopWriteFiles(value.writeFiles);
  const skillIds = normalizeSkillIds(value.skillIds);
  return {
    id,
    title,
    prompt,
    ...(conflictGroup ? { conflictGroup } : {}),
    ...(writeFiles.length > 0 ? { writeFiles } : {}),
    ...(skillIds.length > 0 ? { skillIds } : {}),
  };
}

function normalizeSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAcceptance(value: unknown): LoopAcceptance | null {
  if (!isRecord(value)) {
    return null;
  }
  const checks = normalizeAcceptanceChecks(value.checks);
  if (!checks) {
    return null;
  }
  const summary = readOptionalText(value.summary);
  return {
    passed: value.passed === true,
    ...(summary ? { summary } : {}),
    checks,
  };
}

function normalizeAcceptanceChecks(value: unknown): LoopAcceptanceCheck[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const checks: LoopAcceptanceCheck[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.passed !== "boolean") {
      return null;
    }
    const name = readOptionalText(item.name);
    if (!name) {
      return null;
    }
    const detail = readOptionalText(item.detail);
    checks.push({
      name,
      passed: item.passed,
      ...(detail ? { detail } : {}),
    });
  }
  return checks;
}

function readRequiredReviewEventId(value: unknown): string | null {
  const reviewEventId = readOptionalText(value);
  return reviewEventId ?? null;
}

function hasReviewEventConfirmation(raw: Record<string, unknown>): boolean {
  return hasOwn(raw, "reviewEventId") || hasOwn(raw, "reviewEventIds");
}

function readReviewConfirmation(
  raw: Record<string, unknown>,
  required: boolean,
): Pick<LoopPlusDecision, "reviewEventId" | "reviewEventIds"> | null {
  const hasSingle = hasOwn(raw, "reviewEventId");
  const hasMany = hasOwn(raw, "reviewEventIds");
  if (hasSingle && hasMany) {
    return null;
  }
  if (hasMany) {
    const reviewEventIds = readReviewEventIds(raw.reviewEventIds);
    return reviewEventIds ? { reviewEventIds } : null;
  }
  if (!hasSingle) {
    return required ? null : {};
  }
  const reviewEventId = readRequiredReviewEventId(raw.reviewEventId);
  return reviewEventId ? { reviewEventId } : null;
}

function readReviewEventIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = readOptionalText(item);
    if (!id || seen.has(id)) {
      return null;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function readOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeEstimatedRemainingRounds(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(numeric), 0), ESTIMATED_REMAINING_ROUNDS_MAX);
}

function hasImplicitQueueConfirmation(raw: Record<string, unknown>): boolean {
  return IMPLICIT_QUEUE_CONFIRMATION_KEYS.some((key) => hasOwn(raw, key));
}

function buildLoopPlusSubtaskId(title: string): string {
  return `subtask_${createHash("sha1").update(title).digest("hex").slice(0, 10)}`;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
