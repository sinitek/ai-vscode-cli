import { createHash } from "crypto";
import { readLoopBlockedDecisionFields, type LoopBlocker } from "./loopBlocker";
import { normalizeLoopWriteFiles } from "./loopParallel";
import { readLoopPlusDependsOn } from "./loopPlusDependencies";
import { readLoopContinuationSource } from "./loopSubtaskSession";
import { createScanner, stripComments, SyntaxKind } from "jsonc-parser";
import { extractJsonObjectTexts } from "./shared/jsonObjectText";
import { normalizeLoopPlusNextStepPlan, type LoopPlusNextStepPlan } from "./loopPlusNextStepPlan";
import { parseOrchestratorClarification, type OrchestratorClarification } from "./orchestratorClarification";
import { LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES } from "./loopPlusAcceptancePlan";
export { LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES } from "./loopPlusAcceptancePlan";
import {
  normalizeLoopPlusProgressPercent,
  readLoopPlusTaskTypeField,
  type LoopAcceptance,
  type LoopAcceptanceCheck,
  type LoopPlusTaskType,
  type LoopSubtaskDecision,
} from "./loopTaskStore";

export const LOOP_PLUS_DECISION_SUBTASK_MAX = 6;
export const LOOP_PLUS_DECISION_SUBTASK_MIN = 1;
export const LOOP_PLUS_DECISION_SUBTASK_LIMIT = 20;
/** 宿主每次冻结的验收事件上限，与运行并发和单次派发上限独立。 */
export const LOOP_PLUS_ACCEPTANCE_BATCH_MAX = 4;
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
  /** 关闭原因，保留给用户及后续恢复。 */
  reason?: string;
  dependsOn?: string[];
  conflictGroup?: string;
  writeFiles?: string[];
  /** 省略时 reprompt 保留原子任务分类。 */
  taskType?: LoopPlusTaskType;
  codingDelivery?: boolean;
  requiresAcceptance?: boolean;
} & (
  | { action: "close"; prompt?: string; title?: string }
  | { action: "reprompt"; prompt: string; title: string }
);

export type LoopPlusAcceptReview = {
  reviewEventId: string;
  acceptance: "passed" | "failed" | "cancelled";
  reason?: string;
  noRepairReason?: string;
  subtaskIds?: string[];
};

export type LoopPlusDecision = {
  status: LoopPlusDecisionStatus;
  departmentCollaborations?: Array<{ id: string; targetLeaderTaskId: string; body: string }>;
  departmentCollaborationIssue?: "invalid-format";
  nextStepPlan?: LoopPlusNextStepPlan;
  progressPercent?: number;
  directCompletion?: true;
  reviewEventId?: string;
  reviewEventIds?: string[];
  reviews?: LoopPlusAcceptReview[];
  subtasks?: LoopSubtaskDecision[];
  /** accept 中独立推进剩余目标、不归属本批验收事件的新任务 ID。 */
  independentSubtaskIds?: string[];
  controls?: LoopPlusControlDecision[];
  answerConclusion?: string;
  finalSummary?: string;
  blocker?: LoopBlocker;
  /** 宿主解析得到的诊断缺项。 */
  blockerIssue?: string;
  clarification?: OrchestratorClarification;
  acceptance?: LoopAcceptance;
  requirementCoverage?: LoopAcceptanceCheck[];
  /** 已勾选审查项和“其它”的逐项结论。缺失表示这次没有做这些验收。 */
  acceptancePlanResults?: LoopPlusAcceptancePlanResult[];
  estimatedRemainingRounds?: number;
  /** 当前提示报告均已阅读；宿主只会确认冻结批次的 FIFO 前缀。 */
  reportEventIds?: string[];
};

export type LoopPlusAcceptancePlanResult = {
  key: string;
  passed: boolean;
  reason?: string;
};

export type LoopPlusDecisionOptions = {
  subtaskMax?: number;
  allowDirectCompletion?: boolean;
  acceptancePlanKeys?: readonly string[];
  requireAcceptanceFeedback?: boolean;
  requireProgressPercent?: boolean;
};

type LoopPlusDecisionValidationOptions = LoopPlusDecisionOptions & {
  reject?: (reason: string) => void;
};

export type LoopPlusDecisionParseResult = {
  decision: LoopPlusDecision | null;
  rejectionReason: string | null;
  rejectionKind?: "format" | "validation";
};

type LoopPlusDecisionNormalizer = (
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
  options?: LoopPlusDecisionValidationOptions,
) => LoopPlusDecision | null;

const LOOP_PLUS_DECISION_NORMALIZERS: Readonly<Record<LoopPlusDecisionStatus, LoopPlusDecisionNormalizer>> = {
  dispatch: normalizeDispatchDecision,
  accept: normalizeAcceptDecision,
  wait: normalizeWaitDecision,
  steer: normalizeSteerDecision,
  blocked: normalizeBlockedDecision,
  completed: normalizeCompletedDecision,
  clarify: normalizeClarifyDecision,
};

function isLoopPlusDecisionStatus(value: unknown): value is LoopPlusDecisionStatus {
  return typeof value === "string" && hasOwn(LOOP_PLUS_DECISION_NORMALIZERS, value);
}

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
  return parseLoopPlusDecisionWithFeedback(content, options).decision;
}

export function parseLoopPlusDecisionWithFeedback(
  content: string | null | undefined,
  options?: LoopPlusDecisionOptions,
): LoopPlusDecisionParseResult {
  if (typeof content !== "string" || !content.trim()) {
    return { decision: null, rejectionKind: "format", rejectionReason: "主模型未返回决策 JSON，请按当前快照返回一份完整的 Loop+ 决策。" };
  }
  let hasJsonObject = false;
  let hasMalformedObject = false;
  let rejectionReason = "决策 JSON 未通过协议校验。请核对 status、验收事件、子任务字段、验收反馈及完成条件。";
  for (const jsonText of extractJsonObjectTexts(content, { allowComments: true })) {
    let candidate: unknown;
    try {
      candidate = parseLoopPlusJsonObject(jsonText);
    } catch {
      hasMalformedObject = true;
      continue;
    }
    hasJsonObject = true;
    const decision = normalizeDecision(candidate, {
      ...options,
      reject: (reason) => { rejectionReason = reason; },
    });
    if (decision) {
      return { decision, rejectionReason: null };
    }
  }
  return hasJsonObject
    ? { decision: null, rejectionKind: "validation", rejectionReason }
    : { decision: null, rejectionKind: "format", rejectionReason: hasMalformedObject
      ? "回复中的 JSON 对象存在语法错误。请检查双引号、冒号和括号是否成对，并返回完整对象。"
      : "未找到可解析的 Loop+ 决策 JSON 对象：回复没有完整对象。请按当前快照返回完整对象。" };
}

function parseLoopPlusJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const withoutComments = stripComments(text, " ");
    const scanner = createScanner(withoutComments, true);
    const parts: string[] = [];
    let start = 0;
    let previous = SyntaxKind.Unknown;
    let trailingComma = -1;
    for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
      if (trailingComma >= 0 && (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken)) {
        parts.push(withoutComments.slice(start, trailingComma));
        start = trailingComma + 1;
      }
      trailingComma = token === SyntaxKind.CommaToken && previous !== SyntaxKind.OpenBracketToken
        && previous !== SyntaxKind.OpenBraceToken && previous !== SyntaxKind.CommaToken ? scanner.getTokenOffset() : -1;
      previous = token;
    }
    parts.push(withoutComments.slice(start));
    return JSON.parse(parts.join(""));
  }
}

export function normalizeLoopPlusDecision(
  value: unknown,
  options?: LoopPlusDecisionOptions,
): LoopPlusDecision | null {
  return normalizeDecision(value, options);
}

function normalizeDecision(
  value: unknown,
  options?: LoopPlusDecisionValidationOptions,
): LoopPlusDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  if (hasImplicitQueueConfirmation(value)) {
    options?.reject?.("请勿使用隐式队列确认字段；只确认本次提示列出的验收事件和报告事件 ID。");
    return null;
  }
  if (hasOwn(value, "independentSubtaskIds") && value.status !== "accept") {
    options?.reject?.("independentSubtaskIds 只用于 accept 中独立推进剩余目标的子任务。");
    return null;
  }
  if (hasOwn(value, "directCompletion") && (value.status !== "completed" || value.directCompletion !== true)) {
    options?.reject?.("directCompletion 仅可在宿主允许直接完成时与 completed 一起设为 true，否则请省略。");
    return null;
  }
  const estimatedRemainingRounds = normalizeEstimatedRemainingRounds(value.estimatedRemainingRounds);
  const subtaskMax = resolveLoopPlusDecisionSubtaskMax(options?.subtaskMax);
  const status = value.status;
  if (!isLoopPlusDecisionStatus(status)) {
    options?.reject?.(`status 缺失或无效，请选择当前快照适用的值：${LOOP_PLUS_DECISION_STATUSES.join("、")}。`);
    return null;
  }
  const nextStepPlan = hasOwn(value, "nextStepPlan") ? normalizeLoopPlusNextStepPlan(value.nextStepPlan) : undefined;
  if (hasOwn(value, "nextStepPlan") && (
    !nextStepPlan || status === "clarify" || status === "blocked" || status === "completed"
  )) {
    options?.reject?.("nextStepPlan 只能用于有效的继续型决策，且不能与 clarify、blocked 或 completed 同时返回。");
    return null;
  }
  const decision = LOOP_PLUS_DECISION_NORMALIZERS[status](value, estimatedRemainingRounds, subtaskMax, options);
  if (!decision) return null;
  const reportEventIds = readOptionalReportEventIds(value);
  if (reportEventIds === null) {
    options?.reject?.("reportEventIds 须为数组，元素是按当前提示排列且不重复的非空事件 ID；没有待确认报告时可省略或返回空数组。");
    return null;
  }
  const normalized: LoopPlusDecision = {
    ...decision,
    ...(nextStepPlan ? { nextStepPlan } : {}),
    ...(reportEventIds !== undefined ? { reportEventIds } : {}),
  };
  if (value.departmentCollaborations === undefined) return normalized;
  const messages = value.departmentCollaborations;
  if (!Array.isArray(messages) || messages.some((item) => !item || typeof item !== "object"
    || ["id", "targetLeaderTaskId", "body"].some((key) => typeof item[key] !== "string" || !item[key].trim()))
    || new Set(messages.map((item) => item.id)).size !== messages.length) return { ...normalized, departmentCollaborationIssue: "invalid-format" };
  return { ...normalized, departmentCollaborations: messages.map(({ id, targetLeaderTaskId, body }) => ({ id, targetLeaderTaskId, body })) };
}

function normalizeDispatchDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
  options?: LoopPlusDecisionValidationOptions,
): LoopPlusDecision | null {
  if (hasReviewEventConfirmation(raw)) {
    options?.reject?.("dispatch 不确认验收事件；需确认当前验收批次时请用 accept。");
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks || subtasks.length < 1) {
    options?.reject?.(`dispatch.subtasks 需要 1 至 ${subtaskMax} 个有效任务；检查 ID 是否重复、标题和 prompt 是否为空，以及任务分类和依赖字段。`);
    return null;
  }
  const controls = readControls(raw, subtaskMax);
  if (!controls || controlsOverlapSubtasks(controls, subtasks)) {
    options?.reject?.("dispatch.controls 格式或任务 ID 冲突；请核对操作字段，避免对同一 ID 同时派发和控制。");
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
  options?: LoopPlusDecisionValidationOptions,
): LoopPlusDecision | null {
  const progressPercent = normalizeLoopPlusProgressPercent(raw.progressPercent);
  if (
    (hasOwn(raw, "progressPercent") && (progressPercent === undefined || progressPercent === 100))
    || (options?.requireProgressPercent === true && progressPercent === undefined)
  ) {
    options?.reject?.("accept.progressPercent 必须是 0 到 99 的整数，不能缺失或填写 100。");
    return null;
  }
  const reviewEvents = readReviewConfirmation(raw, true);
  if (!reviewEvents) {
    options?.reject?.("accept 必须使用 reviewEventId 或 reviewEventIds 确认当前批次，不能同时填写两者或重复事件。");
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks) {
    options?.reject?.(`accept.subtasks 必须包含不超过 ${subtaskMax} 项有效任务；每项须有独立 ID、标题和非空 prompt，并使用合法的任务分类。`);
    return null;
  }
  const controls = readControls(raw, subtaskMax);
  if (!controls || controlsOverlapSubtasks(controls, subtasks)) {
    options?.reject?.("accept.controls 格式或任务 ID 冲突；请核对操作字段，避免对同一 ID 同时派发和控制。");
    return null;
  }
  const eventIds = reviewEvents.reviewEventIds ?? (
    reviewEvents.reviewEventId ? [reviewEvents.reviewEventId] : []
  );
  const requireAcceptanceFeedback = options?.requireAcceptanceFeedback === true;
  const independentSubtaskIds = readAcceptSubtaskIds(raw, "independentSubtaskIds");
  if (!independentSubtaskIds) {
    options?.reject?.("accept.independentSubtaskIds 必须是由非空字符串组成且没有重复 ID 的数组。");
    return null;
  }
  const reviews = readAcceptReviews(raw, eventIds, subtasks, independentSubtaskIds, requireAcceptanceFeedback, options?.reject);
  if (!reviews) {
    return null;
  }
  const allCancelled = reviews.every((review) => review.acceptance === "cancelled");
  const acceptancePlanResults = readAcceptancePlanResults(raw.acceptancePlanResults, requireAcceptanceFeedback, options?.acceptancePlanKeys);
  if (!allCancelled && !matchesAcceptancePlanKeys(acceptancePlanResults, options?.acceptancePlanKeys)) {
    options?.reject?.(`acceptancePlanResults 必须按 key 覆盖每个已选项：${options?.acceptancePlanKeys?.join(", ") ?? "当前验收方案"}，并说明证据或限制。`);
    return null;
  }
  const acceptance = hasOwn(raw, "acceptance")
    ? normalizeAcceptance(raw.acceptance, requireAcceptanceFeedback)
    : undefined;
  if (requireAcceptanceFeedback && !allCancelled && (!acceptance || !hasDefaultAcceptanceChecks(acceptance))) {
    options?.reject?.(`accept.acceptance 必须包含六项默认检查：${LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES.join(", ")}；每项提供 passed 和证据 detail，失败项可以保留并派发修复。`);
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "accept",
    ...(progressPercent !== undefined ? { progressPercent } : {}),
    ...reviewEvents,
    reviews,
    ...(subtasks.length > 0 ? { subtasks } : {}),
    ...(independentSubtaskIds.length > 0 ? { independentSubtaskIds } : {}),
    ...(controls.length > 0 ? { controls } : {}),
    ...(!allCancelled && acceptance ? { acceptance } : {}),
    ...(!allCancelled && acceptancePlanResults ? { acceptancePlanResults } : {}),
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
  return withEstimatedRemainingRounds({
    status: "blocked",
    ...readLoopBlockedDecisionFields(raw),
  }, estimatedRemainingRounds);
}

function normalizeCompletedDecision(
  raw: Record<string, unknown>,
  estimatedRemainingRounds: number | undefined,
  subtaskMax: number,
  options?: LoopPlusDecisionValidationOptions,
): LoopPlusDecision | null {
  if (hasOwn(raw, "controls") || hasOwn(raw, "reviews")) {
    options?.reject?.("completed 不能携带 controls 或 reviews；有失败或后续工作时应使用 accept 并继续派发。");
    return null;
  }
  const reviewEvents = readReviewConfirmation(raw, false);
  if (!reviewEvents) {
    return null;
  }
  const subtasks = readSubtasks(raw, subtaskMax);
  if (!subtasks || subtasks.length > 0) {
    options?.reject?.("completed 不能包含待派发子任务；请先通过 accept 或 dispatch 派发未完成工作。");
    return null;
  }
  const answerConclusion = readOptionalText(raw.answerConclusion);
  const finalSummary = readOptionalText(raw.finalSummary);
  if (raw.directCompletion === true) {
    if (
      options?.allowDirectCompletion !== true
      || !answerConclusion
      || !finalSummary
      || hasOwn(raw, "reviewEventId")
      || hasOwn(raw, "reviewEventIds")
      || hasOwn(raw, "subtasks")
      || hasOwn(raw, "acceptance")
      || hasOwn(raw, "requirementCoverage")
      || hasOwn(raw, "acceptancePlanResults")
      || (options.acceptancePlanKeys?.length ?? 0) > 0
    ) {
      options?.reject?.("directCompletion 未获当前宿主授权或混入了验收字段；请按当前开放工作和完成门禁返回正常决策。");
      return null;
    }
    return withEstimatedRemainingRounds({
      status: "completed",
      directCompletion: true,
      answerConclusion,
      finalSummary,
    }, estimatedRemainingRounds);
  }
  const requireAcceptanceFeedback = options?.requireAcceptanceFeedback === true;
  const acceptance = normalizeAcceptance(raw.acceptance, requireAcceptanceFeedback);
  const requirementCoverage = normalizeAcceptanceChecks(raw.requirementCoverage);
  const acceptancePlanResults = readAcceptancePlanResults(raw.acceptancePlanResults, requireAcceptanceFeedback, options?.acceptancePlanKeys);
  if (
    !answerConclusion
    || !finalSummary
    || !acceptance
    || (requireAcceptanceFeedback && !hasDefaultAcceptanceChecks(acceptance))
    || acceptance.passed !== true
    || acceptance.checks.length === 0
    || acceptance.checks.some((check) => check.passed !== true)
    || !requirementCoverage
    || requirementCoverage.length === 0
    || requirementCoverage.some((item) => item.passed !== true)
    || !matchesAcceptancePlanKeys(acceptancePlanResults, options?.acceptancePlanKeys)
    || acceptancePlanResults?.some((result) => result.passed !== true)
  ) {
    options?.reject?.("completed 需要全部默认验收与 requirementCoverage 通过且附加结果完整；附加验收失败时请用 accept 保留真实失败并派发修复，存在未完成工作时继续推进，不能伪造通过。");
    return null;
  }
  return withEstimatedRemainingRounds({
    status: "completed",
    ...reviewEvents,
    answerConclusion,
    finalSummary,
    acceptance,
    requirementCoverage,
    ...(acceptancePlanResults ? { acceptancePlanResults } : {}),
  }, estimatedRemainingRounds);
}

function hasDefaultAcceptanceChecks(acceptance: LoopAcceptance): boolean {
  const names = new Set(acceptance.checks.map((check) => check.name));
  return acceptance.checks.length === LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES.length
    && LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES.every((name) => names.has(name));
}

function readAcceptancePlanResults(
  value: unknown,
  requireReason: boolean,
  expectedKeys?: readonly string[],
): LoopPlusAcceptancePlanResult[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const results: LoopPlusAcceptancePlanResult[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const key = isRecord(item) ? readOptionalText(item.key) : undefined;
    if (expectedKeys && (!key || !expectedKeys.includes(key))) {
      continue;
    }
    if (!key || !isRecord(item) || typeof item.passed !== "boolean" || seen.has(key)) {
      return null;
    }
    const reason = readOptionalText(item.reason);
    if (requireReason && !reason) {
      return null;
    }
    seen.add(key);
    results.push({
      key,
      passed: item.passed,
      ...(reason ? { reason } : {}),
    });
  }
  return results.length > 0 ? results : null;
}

function matchesAcceptancePlanKeys(
  results: readonly LoopPlusAcceptancePlanResult[] | null,
  expectedKeys?: readonly string[],
): boolean {
  if (!expectedKeys) {
    return true;
  }
  if (expectedKeys.length === 0) {
    return !results || results.length === 0;
  }
  return Boolean(results)
    && results?.length === expectedKeys.length
    && expectedKeys.every((key) => results?.some((result) => result.key === key));
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
  const classification = readLoopPlusWorkClassification(value);
  if (classification === null || (hasOwn(value, "requiresAcceptance") && typeof value.requiresAcceptance !== "boolean")) {
    return null;
  }
  const requiresAcceptance = value.requiresAcceptance as boolean | undefined;
  const dependsOn = readLoopPlusDependsOn(value.dependsOn, id);
  if (!dependsOn) {
    return null;
  }
  if (value.action === "close") {
    const reason = readOptionalText(value.reason);
    if (hasOwn(value, "reason") && !reason) return null;
    return {
      id,
      action: "close",
      ...(reason ? { reason } : {}),
      ...(title ? { title } : {}),
      ...(conflictGroup ? { conflictGroup } : {}),
      ...(writeFiles.length > 0 ? { writeFiles } : {}),
      ...classification,
      ...(requiresAcceptance !== undefined ? { requiresAcceptance } : {}),
      ...(Object.prototype.hasOwnProperty.call(value, "dependsOn") ? { dependsOn } : {}),
    };
  }
  const prompt = readOptionalText(value.prompt);
  if (!title || !prompt) {
    return null;
  }
  return {
    id,
    action: "reprompt",
    prompt,
    title,
    ...(value.dependsOn !== undefined ? { dependsOn } : {}),
    ...(conflictGroup ? { conflictGroup } : {}),
    ...(writeFiles.length > 0 ? { writeFiles } : {}),
    ...classification,
    ...(requiresAcceptance !== undefined ? { requiresAcceptance } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "dependsOn") ? { dependsOn } : {}),
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
  const prompt = readOptionalText(value.prompt);
  if (!title || !prompt) {
    return null;
  }
  const id = readOptionalText(value.id) ?? buildLoopPlusSubtaskId(title);
  const conflictGroup = readOptionalText(value.conflictGroup);
  const writeFiles = normalizeLoopWriteFiles(value.writeFiles);
  const skillIds = normalizeSkillIds(value.skillIds);
  const continueFromSubtaskId = readLoopContinuationSource(value.continueFromSubtaskId);
  if (continueFromSubtaskId === null) {
    return null;
  }
  const classification = readLoopPlusWorkClassification(value);
  if (classification === null || (hasOwn(value, "requiresAcceptance") && typeof value.requiresAcceptance !== "boolean")) {
    return null;
  }
  const requiresAcceptance = value.requiresAcceptance as boolean | undefined;
  const dependsOn = readLoopPlusDependsOn(value.dependsOn, id);
  if (!dependsOn) {
    return null;
  }
  return {
    id,
    title,
    prompt,
    ...(value.dependsOn !== undefined ? { dependsOn } : {}),
    ...(conflictGroup ? { conflictGroup } : {}),
    ...(writeFiles.length > 0 ? { writeFiles } : {}),
    ...classification,
    ...(requiresAcceptance !== undefined ? { requiresAcceptance } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "dependsOn") ? { dependsOn } : {}),
    ...(continueFromSubtaskId ? { continueFromSubtaskId } : {}),
    ...(skillIds.length > 0 ? { skillIds } : {}),
  };
}

function readOptionalReportEventIds(value: Record<string, unknown>): string[] | undefined | null {
  if (!hasOwn(value, "reportEventIds")) return undefined;
  if (!Array.isArray(value.reportEventIds)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value.reportEventIds) {
    const id = readOptionalText(item);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function readLoopPlusWorkClassification(
  value: Record<string, unknown>,
): { taskType?: LoopPlusTaskType; codingDelivery?: boolean } | null {
  const taskType = hasOwn(value, "taskType")
    ? readLoopPlusTaskTypeField(value.taskType)
    : undefined;
  if (taskType === null) {
    return null;
  }
  if (hasOwn(value, "codingDelivery") && typeof value.codingDelivery !== "boolean") {
    return null;
  }
  const codingDelivery = value.codingDelivery === true;
  const writeFiles = normalizeLoopWriteFiles(value.writeFiles);
  if (taskType === "general" && (writeFiles.length > 0 || codingDelivery)) {
    return null;
  }
  return {
    ...(taskType ? { taskType } : {}),
    ...(codingDelivery ? { codingDelivery } : {}),
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

function normalizeAcceptance(value: unknown, requireReason = false): LoopAcceptance | null {
  if (!isRecord(value)) {
    return null;
  }
  const checks = normalizeAcceptanceChecks(value.checks, requireReason);
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

function normalizeAcceptanceChecks(value: unknown, requireReason = false): LoopAcceptanceCheck[] | null {
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
    if (requireReason && !detail) {
      return null;
    }
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
  independentSubtaskIds: readonly string[],
  requireReason = false,
  reject?: (reason: string) => void,
): LoopPlusAcceptReview[] | null {
  if (!hasOwn(raw, "reviews") || !Array.isArray(raw.reviews) || raw.reviews.length !== eventIds.length) {
    reject?.("accept.reviews 必须逐项覆盖确认的整个验收批次，数量和顺序与 reviewEventId/reviewEventIds 一致。");
    return null;
  }
  const reviews: LoopPlusAcceptReview[] = [];
  const linkedIds: string[] = [...independentSubtaskIds];
  for (let index = 0; index < raw.reviews.length; index += 1) {
    const item = raw.reviews[index];
    if (!isRecord(item)) {
      return null;
    }
    const reviewEventId = readOptionalText(item.reviewEventId);
    if (!reviewEventId || reviewEventId !== eventIds[index]) {
      reject?.(`reviews[${index}].reviewEventId 必须是 ${eventIds[index]}，不能遗漏或调换顺序。`);
      return null;
    }
    if (item.acceptance !== "passed" && item.acceptance !== "failed" && item.acceptance !== "cancelled") {
      reject?.(`reviews[${index}].acceptance 只能是 passed、failed 或 cancelled。`);
      return null;
    }
    const needsReason = requireReason || item.acceptance === "cancelled";
    const reason = readOptionalText(item.reason);
    if (needsReason && !reason) {
      reject?.(`reviews[${index}].reason 必须提供非空验收依据。`);
      return null;
    }
    const subtaskIds = readAcceptSubtaskIds(item);
    if (!subtaskIds) {
      reject?.(`reviews[${index}].subtaskIds 必须是由非空字符串组成且没有重复 ID 的数组。`);
      return null;
    }
    const noRepairReason = readOptionalText(item.noRepairReason);
    if (hasOwn(item, "noRepairReason") && (item.acceptance !== "failed" || !noRepairReason || subtaskIds.length > 0)) {
      reject?.(`reviews[${index}].noRepairReason 仅用于不派修的失败项，须填写结案原因。`);
      return null;
    }
    if (item.acceptance === "failed" && subtaskIds.length === 0 && !noRepairReason) {
      reject?.(`reviews[${index}] 验收失败必须关联修复子任务，或填写 noRepairReason；未处置的失败不能确认。`);
      return null;
    }
    linkedIds.push(...subtaskIds);
    reviews.push({
      reviewEventId,
      acceptance: item.acceptance,
      ...(reason ? { reason } : {}),
      ...(noRepairReason ? { noRepairReason } : {}),
      ...(subtaskIds.length > 0 ? { subtaskIds } : {}),
    });
  }
  const subtaskIds = subtasks.map((subtask) => subtask.id).filter((id): id is string => Boolean(id));
  if (!sameIdSet(linkedIds, subtaskIds)) {
    const unlinked = subtaskIds.filter((id) => !linkedIds.includes(id));
    const unknown = linkedIds.filter((id) => !subtaskIds.includes(id));
    const duplicates = [...new Set(linkedIds.filter((id, index) => linkedIds.indexOf(id) !== index))];
    reject?.([
      "accept.subtasks 中的每个任务 ID 必须恰好归属一个 reviews[].subtaskIds 或 independentSubtaskIds，不能重复。",
      ...(unlinked.length ? [`未关联任务：${unlinked.join(", ")}。`] : []),
      ...(unknown.length ? [`关联了不存在的任务：${unknown.join(", ")}。`] : []),
      ...(duplicates.length ? [`重复关联任务：${duplicates.join(", ")}。`] : []),
      "修复和相关后续任务关联真实验收事件；独立的剩余目标任务列入 independentSubtaskIds，不要为补齐关联而伪造失败或继承无关修复会话。",
    ].join(""));
    return null;
  }
  return reviews;
}

function readAcceptSubtaskIds(
  value: Record<string, unknown>,
  key: "subtaskIds" | "independentSubtaskIds" = "subtaskIds",
): string[] | null {
  if (!hasOwn(value, key)) {
    return [];
  }
  const items = value[key];
  if (!Array.isArray(items)) {
    return null;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
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
