import { createHash } from "crypto";
import { normalizeLoopWriteFiles } from "./loopParallel";
import { extractJsonObjectTexts } from "./shared/jsonObjectText";
import type {
  LoopAcceptance,
  LoopAcceptanceCheck,
  LoopSubtaskDecision,
} from "./loopTaskStore";

export const LOOP_PLUS_DECISION_SUBTASK_MAX = 6;
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
  "reviewEventIds",
  "confirmedEventIds",
  "acceptedEventIds",
] as const;

export type LoopPlusDecisionStatus = (typeof LOOP_PLUS_DECISION_STATUSES)[number];

export type LoopPlusDecision = {
  status: LoopPlusDecisionStatus;
  reviewEventId?: string;
  subtasks?: LoopSubtaskDecision[];
  answerConclusion?: string;
  finalSummary?: string;
  acceptance?: LoopAcceptance;
  requirementCoverage?: LoopAcceptanceCheck[];
  estimatedRemainingRounds?: number;
};

export function parseLoopPlusDecision(content: string | null | undefined): LoopPlusDecision | null {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }
  for (const jsonText of extractJsonObjectTexts(content)) {
    try {
      const decision = normalizeLoopPlusDecision(JSON.parse(jsonText));
      if (decision) {
        return decision;
      }
    } catch {
      // A prompt may contain malformed or illustrative JSON before the decision.
    }
  }
  return null;
}

export function normalizeLoopPlusDecision(value: unknown): LoopPlusDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  if (hasImplicitQueueConfirmation(value)) {
    return null;
  }
  const estimatedRemainingRounds = normalizeEstimatedRemainingRounds(value.estimatedRemainingRounds);
  switch (value.status) {
    case "dispatch":
      return normalizeDispatchDecision(value, estimatedRemainingRounds);
    case "accept":
      return normalizeAcceptDecision(value, estimatedRemainingRounds);
    case "wait":
      return normalizeWaitDecision(value, estimatedRemainingRounds);
    case "blocked":
      return normalizeBlockedDecision(value, estimatedRemainingRounds);
    case "completed":
      return normalizeCompletedDecision(value, estimatedRemainingRounds);
    default:
      return null;
  }
}

function normalizeDispatchDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
): LoopPlusDecision | null {
  if (hasOwn(raw, "reviewEventId")) {
    return null;
  }
  const subtasks = readSubtasks(raw);
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
): LoopPlusDecision | null {
  const reviewEventId = readRequiredReviewEventId(raw.reviewEventId);
  if (!reviewEventId) {
    return null;
  }
  const subtasks = readSubtasks(raw);
  if (!subtasks) {
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "accept",
    reviewEventId,
    ...(subtasks.length > 0 ? { subtasks } : {}),
  }, estimatedRemainingRounds);
}

function normalizeWaitDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
): LoopPlusDecision | null {
  if (hasOwn(raw, "reviewEventId")) {
    return null;
  }
  const subtasks = readSubtasks(raw);
  if (!subtasks || subtasks.length > 0) {
    return null;
  }
  return withEstimatedRemainingRounds({ status: "wait" }, estimatedRemainingRounds);
}

function normalizeBlockedDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
): LoopPlusDecision | null {
  if (hasOwn(raw, "reviewEventId")) {
    return null;
  }
  const subtasks = readSubtasks(raw);
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
): LoopPlusDecision | null {
  const reviewEventId = readOptionalReviewEventId(raw, "reviewEventId");
  if (reviewEventId === null) {
    return null;
  }
  const subtasks = readSubtasks(raw);
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
    ...(reviewEventId ? { reviewEventId } : {}),
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

function readSubtasks(raw: Record<string, unknown>): LoopSubtaskDecision[] | null {
  const items = readRawSubtasks(raw);
  if (!items || items.length > LOOP_PLUS_DECISION_SUBTASK_MAX) {
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

function readOptionalReviewEventId(raw: Record<string, unknown>, key: string): string | undefined | null {
  if (!hasOwn(raw, key)) {
    return undefined;
  }
  return readOptionalText(raw[key]) ?? null;
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
