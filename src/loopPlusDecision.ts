import { createHash } from "crypto";
import { normalizeLoopWriteFiles } from "./loopParallel";
import { extractJsonObjectTexts } from "./shared/jsonObjectText";
import { parseOrchestratorClarification, type OrchestratorClarification } from "./orchestratorClarification";
import type {
  LoopAcceptance,
  LoopAcceptanceCheck,
  LoopSubtaskDecision,
} from "./loopTaskStore";

export const LOOP_PLUS_DECISION_SUBTASK_MAX = 6;
export const LOOP_PLUS_DECISION_SUBTASK_MIN = 1;
export const LOOP_PLUS_DECISION_SUBTASK_LIMIT = 20;
export const LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT = 100;
export const LOOP_PLUS_MAX_ACCEPTANCES_MIN = 1;
export const LOOP_PLUS_MAX_ACCEPTANCES_LIMIT = 999;
export const LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH = 80;
export const LOOP_PLUS_DECISION_STATUSES = [
  "dispatch",
  "accept",
  "wait",
  "steer",
  "blocked",
  "completed",
  "clarify",
] as const;

export const LOOP_PLUS_CONTROL_ACTIONS = ["close", "reprompt"] as const;

const ESTIMATED_REMAINING_ROUNDS_MAX = 100;
const IMPLICIT_QUEUE_CONFIRMATION_KEYS = [
  "confirmedEventIds",
  "acceptedEventIds",
] as const;

export type LoopPlusDecisionStatus = (typeof LOOP_PLUS_DECISION_STATUSES)[number];

export type LoopPlusControlAction = (typeof LOOP_PLUS_CONTROL_ACTIONS)[number];

export type LoopPlusControlDecision = {
  id: string;
  action: LoopPlusControlAction;
  prompt?: string;
  title?: string;
  conflictGroup?: string;
  writeFiles?: string[];
};

export type LoopPlusAcceptReview = {
  reviewEventId: string;
  acceptance: "passed" | "failed";
  subtaskIds?: string[];
};

export type LoopPlusDecision = {
  status: LoopPlusDecisionStatus;
  reviewEventId?: string;
  reviewEventIds?: string[];
  reviews?: LoopPlusAcceptReview[];
  subtasks?: LoopSubtaskDecision[];
  controls?: LoopPlusControlDecision[];
  answerConclusion?: string;
  finalSummary?: string;
  clarification?: OrchestratorClarification;
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

export function resolveLoopPlusMaxAcceptances(value?: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT;
  }
  return Math.min(
    Math.max(Math.floor(numeric), LOOP_PLUS_MAX_ACCEPTANCES_MIN),
    LOOP_PLUS_MAX_ACCEPTANCES_LIMIT,
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
    case "steer":
      return normalizeSteerDecision(value, estimatedRemainingRounds, subtaskMax);
    case "blocked":
      return normalizeBlockedDecision(value, estimatedRemainingRounds, subtaskMax);
    case "clarify":
      return normalizeClarifyDecision(value, estimatedRemainingRounds, subtaskMax);
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
  const controls = readControls(raw, subtaskMax);
  if (!controls || controlsOverlapSubtasks(controls, subtasks)) {
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "dispatch",
    subtasks,
    ...(controls.length > 0 ? { controls } : {}),
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
  const controls = readControls(raw, subtaskMax);
  if (!controls || controlsOverlapSubtasks(controls, subtasks)) {
    return null;
  }
  const eventIds = reviewEvents.reviewEventIds ?? (
    reviewEvents.reviewEventId ? [reviewEvents.reviewEventId] : []
  );
  const reviews = readAcceptReviews(raw, eventIds, subtasks);
  if (!reviews) {
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "accept",
    ...reviewEvents,
    reviews,
    ...(subtasks.length > 0 ? { subtasks } : {}),
    ...(controls.length > 0 ? { controls } : {}),
  }, estimatedRemainingRounds);
}

function normalizeWaitDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
): LoopPlusDecision | null {
  if (hasReviewEventConfirmation(raw) || hasOwn(raw, "controls")) {
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks || subtasks.length > 0) {
    return null;
  }
  return withEstimatedRemainingRounds({ status: "wait" }, estimatedRemainingRounds);
}

function normalizeSteerDecision(
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
  const controls = readControls(raw, subtaskMax);
  if (!controls || controls.length < 1) {
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "steer",
    controls,
  }, estimatedRemainingRounds);
}


function normalizeClarifyDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
): LoopPlusDecision | null {
  if (hasReviewEventConfirmation(raw) || hasOwn(raw, "controls")) {
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks || subtasks.length > 0) {
    return null;
  }
  const clarification = parseOrchestratorClarification(raw, `loop-plus-clarify-${Date.now()}`);
  if (!clarification) {
    return null;
  }
  const finalSummary = readOptionalText(raw.finalSummary);
  return withEstimatedRemainingRounds({
    status: "clarify",
    clarification,
    ...(finalSummary ? { finalSummary } : {}),
  }, estimatedRemainingRounds);
}

function normalizeBlockedDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
): LoopPlusDecision | null {
  if (hasReviewEventConfirmation(raw) || hasOwn(raw, "controls")) {
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
  if (hasOwn(raw, "controls") || hasOwn(raw, "reviews")) {
    return null;
  }
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

function readControls(
  raw: Record<string, unknown>,
  subtaskMax: number,
): LoopPlusControlDecision[] | null {
  if (!hasOwn(raw, "controls")) {
    return [];
  }
  if (!Array.isArray(raw.controls) || raw.controls.length > subtaskMax) {
    return null;
  }
  const controls: LoopPlusControlDecision[] = [];
  const seenIds = new Set<string>();
  for (const item of raw.controls) {
    const control = normalizeControl(item);
    if (!control || seenIds.has(control.id)) {
      return null;
    }
    seenIds.add(control.id);
    controls.push(control);
  }
  return controls;
}

function normalizeControl(value: unknown): LoopPlusControlDecision | null {
  if (!isRecord(value) || (value.action !== "close" && value.action !== "reprompt")) {
    return null;
  }
  const id = readOptionalText(value.id);
  if (!id) {
    return null;
  }
  const title = readOptionalText(value.title);
  const conflictGroup = readOptionalText(value.conflictGroup);
  const writeFiles = normalizeLoopWriteFiles(value.writeFiles);
  if (value.action === "close") {
    return {
      id,
      action: "close",
      ...(title ? { title } : {}),
      ...(conflictGroup ? { conflictGroup } : {}),
      ...(writeFiles.length > 0 ? { writeFiles } : {}),
    };
  }
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  if (prompt.length < LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH) {
    return null;
  }
  return {
    id,
    action: "reprompt",
    prompt,
    ...(title ? { title } : {}),
    ...(conflictGroup ? { conflictGroup } : {}),
    ...(writeFiles.length > 0 ? { writeFiles } : {}),
  };
}

function controlsOverlapSubtasks(
  controls: readonly LoopPlusControlDecision[],
  subtasks: readonly LoopSubtaskDecision[],
): boolean {
  const ids = new Set(subtasks.map((subtask) => subtask.id).filter((id): id is string => Boolean(id)));
  return controls.some((control) => ids.has(control.id));
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

function readAcceptReviews(
  raw: Record<string, unknown>,
  eventIds: readonly string[],
  subtasks: readonly LoopSubtaskDecision[],
): LoopPlusAcceptReview[] | null {
  if (!hasOwn(raw, "reviews") || !Array.isArray(raw.reviews) || raw.reviews.length !== eventIds.length) {
    return null;
  }
  const reviews: LoopPlusAcceptReview[] = [];
  const linkedIds: string[] = [];
  for (let index = 0; index < raw.reviews.length; index += 1) {
    const item = raw.reviews[index];
    if (!isRecord(item)) {
      return null;
    }
    const reviewEventId = readOptionalText(item.reviewEventId);
    if (!reviewEventId || reviewEventId !== eventIds[index]) {
      return null;
    }
    if (item.acceptance !== "passed" && item.acceptance !== "failed") {
      return null;
    }
    const subtaskIds = readAcceptSubtaskIds(item);
    if (!subtaskIds) {
      return null;
    }
    linkedIds.push(...subtaskIds);
    reviews.push({
      reviewEventId,
      acceptance: item.acceptance,
      ...(subtaskIds.length > 0 ? { subtaskIds } : {}),
    });
  }
  const subtaskIds = subtasks.map((subtask) => subtask.id).filter((id): id is string => Boolean(id));
  if (!sameIdSet(linkedIds, subtaskIds)) {
    return null;
  }
  return reviews;
}

function readAcceptSubtaskIds(review: Record<string, unknown>): string[] | null {
  if (!hasOwn(review, "subtaskIds")) {
    return [];
  }
  if (!Array.isArray(review.subtaskIds)) {
    return null;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of review.subtaskIds) {
    const id = readOptionalText(item);
    if (!id || seen.has(id)) {
      return null;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const seen = new Set(left);
  return seen.size === left.length && right.every((id) => seen.has(id));
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
