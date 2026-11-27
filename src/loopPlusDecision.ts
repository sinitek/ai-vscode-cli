import { createHash } from "crypto";
import { printParseErrorCode, visit } from "jsonc-parser";
import { readLoopBlockedDecisionFields, type LoopBlocker } from "./loopBlocker";
import { normalizeLoopWriteFiles } from "./loopParallel";
import { readLoopPlusDependsOn } from "./loopPlusDependencies";
import { readLoopContinuationSource } from "./loopSubtaskSession";
import { normalizeJsonObjectText } from "./shared/jsonObject";
import { extractJsonObjectTexts } from "./shared/jsonObjectText";
import { normalizeLoopPlusNextStepPlan, type LoopPlusNextStepPlan } from "./loopPlusNextStepPlan";
import { parseOrchestratorClarification, type OrchestratorClarification } from "./orchestratorClarification";
import { LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES } from "./loopPlusAcceptancePlan";
export { LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES } from "./loopPlusAcceptancePlan";
import {
  LOOP_PLUS_TASK_TYPES,
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
/** 验收项诊断只使用这些字段名，不接受模型原文或业务 ID。 */
export const LOOP_PLUS_REVIEW_DIAGNOSTIC_FIELDS = [
  "reviewEventId",
  "acceptance",
  "reason",
  "subtaskIds",
  "noRepairReason",
] as const;
export type LoopPlusReviewDiagnosticField = (typeof LOOP_PLUS_REVIEW_DIAGNOSTIC_FIELDS)[number];
export type LoopPlusReviewFieldDiagnostic = {
  code: "EventOrderMismatch" | "InvalidReviewItem" | "FailedRepairMissing";
  /** 仅当该下标能映射到本请求捕获的冻结行时出现。 */
  index?: number;
  field: LoopPlusReviewDiagnosticField;
};
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
  /** 本请求捕获的冻结验收事件。省略表示调用方未提供冻结依据，沿用回复声明的批次。 */
  frozenReviewEventIds?: readonly string[];
};

type LoopPlusDecisionValidationOptions = LoopPlusDecisionOptions & {
  reject?: (reason: string, diagnostic?: LoopPlusDecisionValidationDiagnostic) => void;
  rejectReviewField?: (reason: string, diagnostic?: LoopPlusReviewFieldDiagnostic) => void;
};

export type LoopPlusDecisionRejectionKind = "format" | "validation" | "state";

export type LoopPlusDecisionFormatDiagnostic = {
  code: string;
  position?: { line: number; column: number };
};

type SubtaskListField = "subtasks" | "subtask";
type SubtaskField = "id" | "title" | "prompt" | "continueFromSubtaskId" | "taskType"
  | "codingDelivery" | "writeFiles" | "requiresAcceptance" | "dependsOn";

const SUBTASK_VALIDATION_HINTS = {
  InvalidSubtaskList: "请使用子任务对象数组。",
  InvalidSubtaskCount: "请按本轮允许的数量返回子任务。",
  InvalidSubtaskItem: "请使用包含 title 和 prompt 的子任务对象。",
  DuplicateSubtaskId: "请使用唯一的子任务 ID；省略 ID 时，相同标题也会生成相同 ID。",
  MissingSubtaskTitle: "请提供非空字符串标题。",
  MissingSubtaskPrompt: "请提供非空字符串 prompt。",
  InvalidSubtaskContinuation: "请省略该字段，或填写非空的来源子任务 ID。",
  InvalidSubtaskType: `请将 taskType 设为 ${LOOP_PLUS_TASK_TYPES.join("、")}，或省略该字段。`,
  InvalidCodingDelivery: "请使用布尔值，或省略该字段。",
  SubtaskClassificationConflict: `general 任务不能声明写入文件或编码交付；请移除冲突声明，或将 taskType 设为 ${LOOP_PLUS_TASK_TYPES.filter((type) => type !== "general").join("、")}。`,
  InvalidRequiresAcceptance: "请使用布尔值，或省略该字段。",
  InvalidSubtaskDependencies: "请使用非空 ID 字符串数组，不要重复或依赖自身；无依赖时可省略或用空数组。",
} as const;

export type LoopPlusDecisionValidationDiagnostic = {
  code: keyof typeof SUBTASK_VALIDATION_HINTS;
  status: "accept" | "dispatch";
  field: SubtaskListField | SubtaskField;
  index?: number;
};

type RejectSubtask = (code: LoopPlusDecisionValidationDiagnostic["code"], field?: SubtaskField) => null;

export type LoopPlusDecisionParseResult = {
  decision: LoopPlusDecision | null;
  rejectionReason: string | null;
  rejectionKind?: LoopPlusDecisionRejectionKind;
  formatDiagnostic?: LoopPlusDecisionFormatDiagnostic;
  validationDiagnostic?: LoopPlusDecisionValidationDiagnostic;
  /** 验收项字段诊断。行下标只对应本请求冻结行，不含模型原文。 */
  reviewFieldDiagnostic?: LoopPlusReviewFieldDiagnostic;
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

/** 同一次冻结输入上的解析选项。生成器与宿主都从这里进入协议校验。 */
export type LoopPlusFrozenParseInput = {
  subtaskMax?: number;
  allowDirectCompletion?: boolean;
  acceptancePlanKeys?: readonly string[];
  requireAcceptanceFeedback?: boolean;
  requireProgressPercent?: boolean;
  /** 本请求捕获的冻结验收事件。生成器与宿主都从这里传入，迟到事件不在其中。 */
  frozenReviewEventIds?: readonly string[];
};

export function loopPlusFrozenParseOptions(input: LoopPlusFrozenParseInput): LoopPlusDecisionOptions {
  return {
    ...(input.subtaskMax === undefined ? {} : { subtaskMax: input.subtaskMax }),
    ...(input.allowDirectCompletion === undefined ? {} : { allowDirectCompletion: input.allowDirectCompletion }),
    ...(input.acceptancePlanKeys === undefined ? {} : { acceptancePlanKeys: input.acceptancePlanKeys }),
    ...(input.requireAcceptanceFeedback === undefined ? {} : { requireAcceptanceFeedback: input.requireAcceptanceFeedback }),
    ...(input.requireProgressPercent === undefined ? {} : { requireProgressPercent: input.requireProgressPercent }),
    ...(input.frozenReviewEventIds === undefined ? {} : { frozenReviewEventIds: [...input.frozenReviewEventIds] }),
  };
}

export function parseLoopPlusDecisionForFrozenInput(
  content: string | null | undefined,
  input: LoopPlusFrozenParseInput,
): LoopPlusDecisionParseResult {
  return parseLoopPlusDecisionWithFeedback(content, loopPlusFrozenParseOptions(input));
}

export function parseLoopPlusDecisionWithFeedback(
  content: string | null | undefined,
  options?: LoopPlusDecisionOptions,
): LoopPlusDecisionParseResult {
  if (typeof content !== "string" || !content.trim()) {
    return {
      decision: null,
      rejectionKind: "format",
      rejectionReason: "主模型未返回决策 JSON，请按当前快照返回一份完整的 Loop+ 决策。",
      formatDiagnostic: { code: "EmptyResponse" },
    };
  }
  let hasJsonObject = false;
  let firstMalformedObject: string | undefined;
  let rejectionReason = "决策 JSON 未通过协议校验。请核对 status、验收事件、子任务字段、验收反馈及完成条件。";
  let validationDiagnostic: LoopPlusDecisionValidationDiagnostic | undefined;
  let reviewFieldDiagnostic: LoopPlusReviewFieldDiagnostic | undefined;
  for (const jsonText of extractJsonObjectTexts(content, { allowComments: true })) {
    let candidate: unknown;
    try {
      candidate = parseLoopPlusJsonObject(jsonText);
    } catch {
      firstMalformedObject ??= jsonText;
      continue;
    }
    hasJsonObject = true;
    const decision = normalizeDecision(candidate, {
      ...options,
      reject: (reason, diagnostic) => {
        rejectionReason = reason;
        validationDiagnostic = diagnostic;
        reviewFieldDiagnostic = undefined;
      },
      rejectReviewField: (reason, diagnostic) => {
        rejectionReason = reason;
        validationDiagnostic = undefined;
        reviewFieldDiagnostic = diagnostic;
      },
    });
    if (decision) {
      return { decision, rejectionReason: null };
    }
  }
  if (hasJsonObject) {
    return {
      decision: null,
      rejectionKind: "validation",
      rejectionReason,
      ...(validationDiagnostic ? { validationDiagnostic } : {}),
      ...(reviewFieldDiagnostic ? { reviewFieldDiagnostic } : {}),
    };
  }
  const objectStart = content.indexOf("{");
  return {
    decision: null,
    rejectionKind: "format",
    rejectionReason: firstMalformedObject !== undefined
      ? "回复中的 JSON 对象存在语法错误。请按当前快照返回完整对象。"
      : "未找到可解析的 Loop+ 决策 JSON 对象：回复没有完整对象。请按当前快照返回完整对象。",
    formatDiagnostic: firstMalformedObject !== undefined
      ? diagnoseLoopPlusJsonFormat(firstMalformedObject, "InvalidJson")
      : objectStart >= 0
        ? diagnoseLoopPlusJsonFormat(content.slice(objectStart), "IncompleteObject")
        : { code: "ObjectNotFound" },
  };
}

function diagnoseLoopPlusJsonFormat(text: string, fallbackCode: string): LoopPlusDecisionFormatDiagnostic {
  let diagnostic: LoopPlusDecisionFormatDiagnostic | undefined;
  try {
    visit(text, {
      onError(error, _offset, _length, line, column) {
        diagnostic ??= { code: printParseErrorCode(error), position: { line: line + 1, column: column + 1 } };
      },
    }, { allowTrailingComma: true });
  } catch {
    return diagnostic ?? { code: fallbackCode };
  }
  return diagnostic ?? { code: fallbackCode };
}

function parseLoopPlusJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(normalizeJsonObjectText(text, "jsonc", { requireValueBeforeTrailingComma: true }));
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
  const subtasks = readSubtasks(raw, subtaskMax, "dispatch", options?.reject);
  if (!subtasks) return null;
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
  const subtasks = readSubtasks(raw, subtaskMax, "accept", options?.reject);
  if (!subtasks) return null;
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
  const reviews = readAcceptReviews(
    raw,
    eventIds,
    subtasks,
    independentSubtaskIds,
    requireAcceptanceFeedback,
    options?.rejectReviewField,
    options?.frozenReviewEventIds,
  );
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

function readSubtasks(
  raw: Record<string, unknown>,
  subtaskMax: number,
  status?: LoopPlusDecisionValidationDiagnostic["status"],
  reject?: LoopPlusDecisionValidationOptions["reject"],
): LoopSubtaskDecision[] | null {
  const listField: SubtaskListField = !hasOwn(raw, "subtasks") && hasOwn(raw, "subtask") ? "subtask" : "subtasks";
  const rejectList = (code: LoopPlusDecisionValidationDiagnostic["code"], hint: string, field?: SubtaskField, index?: number) => {
    if (status && reject) {
      const location = `${status}.${listField}${index === undefined ? "" : `[${index}]`}${field ? `.${field}` : ""}`;
      reject(`${location}（${code}）：${hint}`, { code, status, field: field ?? listField, ...(index === undefined ? {} : { index }) });
    }
    return null;
  };
  let items: unknown[] = [];
  if (hasOwn(raw, "subtasks")) {
    if (!Array.isArray(raw.subtasks)) {
      return rejectList("InvalidSubtaskList", SUBTASK_VALIDATION_HINTS.InvalidSubtaskList);
    }
    items = raw.subtasks;
  } else if (listField === "subtask") {
    if (!isRecord(raw.subtask)) {
      return rejectList("InvalidSubtaskList", "请使用单个子任务对象，或改用 subtasks 数组。");
    }
    items = [raw.subtask];
  }
  if (items.length > subtaskMax) {
    return rejectList("InvalidSubtaskCount", `请将子任务数量限制在 ${subtaskMax} 项以内。`);
  }
  if (status === "dispatch" && items.length === 0) {
    return rejectList("InvalidSubtaskCount", `请返回 1 至 ${subtaskMax} 个子任务；新任务写入 subtasks，controls 只放针对运行中或排队任务的 close 或 reprompt；无开放验收批次且只需控制任务时请用 steer。`);
  }
  const subtasks: LoopSubtaskDecision[] = [];
  const seenIds = new Set<string>();
  for (const [index, item] of items.entries()) {
    const rejectItem: RejectSubtask = (code, field) => rejectList(
      code, SUBTASK_VALIDATION_HINTS[code], field, listField === "subtasks" ? index : undefined,
    );
    const subtask = normalizeSubtask(item, rejectItem);
    if (!subtask?.id) return null;
    if (seenIds.has(subtask.id)) return rejectItem("DuplicateSubtaskId", "id");
    seenIds.add(subtask.id);
    subtasks.push(subtask);
  }
  return subtasks;
}

function normalizeSubtask(value: unknown, reject: RejectSubtask): LoopSubtaskDecision | null {
  if (!isRecord(value)) {
    return reject("InvalidSubtaskItem");
  }
  const title = readOptionalText(value.title);
  if (!title) return reject("MissingSubtaskTitle", "title");
  const prompt = readOptionalText(value.prompt);
  if (!prompt) return reject("MissingSubtaskPrompt", "prompt");
  const id = readOptionalText(value.id) ?? buildLoopPlusSubtaskId(title);
  const conflictGroup = readOptionalText(value.conflictGroup);
  const writeFiles = normalizeLoopWriteFiles(value.writeFiles);
  const skillIds = normalizeSkillIds(value.skillIds);
  const continueFromSubtaskId = readLoopContinuationSource(value.continueFromSubtaskId);
  if (continueFromSubtaskId === null) {
    return reject("InvalidSubtaskContinuation", "continueFromSubtaskId");
  }
  const classification = readLoopPlusWorkClassification(value, reject);
  if (classification === null) return null;
  if (hasOwn(value, "requiresAcceptance") && typeof value.requiresAcceptance !== "boolean") {
    return reject("InvalidRequiresAcceptance", "requiresAcceptance");
  }
  const requiresAcceptance = value.requiresAcceptance as boolean | undefined;
  const dependsOn = readLoopPlusDependsOn(value.dependsOn, id);
  if (!dependsOn) {
    return reject("InvalidSubtaskDependencies", "dependsOn");
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
  reject?: RejectSubtask,
): { taskType?: LoopPlusTaskType; codingDelivery?: boolean } | null {
  const taskType = hasOwn(value, "taskType")
    ? readLoopPlusTaskTypeField(value.taskType)
    : undefined;
  if (taskType === null) {
    return reject?.("InvalidSubtaskType", "taskType") ?? null;
  }
  if (hasOwn(value, "codingDelivery") && typeof value.codingDelivery !== "boolean") {
    return reject?.("InvalidCodingDelivery", "codingDelivery") ?? null;
  }
  const codingDelivery = value.codingDelivery === true;
  const writeFiles = normalizeLoopWriteFiles(value.writeFiles);
  if (taskType === "general" && (writeFiles.length > 0 || hasOwn(value, "codingDelivery"))) {
    return reject?.("SubtaskClassificationConflict", writeFiles.length > 0 ? "writeFiles" : "codingDelivery") ?? null;
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
  reject?: (reason: string, diagnostic?: LoopPlusReviewFieldDiagnostic) => void,
  frozenEventIds?: readonly string[],
): LoopPlusAcceptReview[] | null {
  if (!hasOwn(raw, "reviews") || !Array.isArray(raw.reviews) || raw.reviews.length !== eventIds.length) {
    reject?.("accept.reviews 必须逐项覆盖确认的整个验收批次，数量和顺序与 reviewEventId/reviewEventIds 一致。");
    return null;
  }
  const reviews: LoopPlusAcceptReview[] = [];
  const linkedIds: string[] = [...independentSubtaskIds];
  const rejectReview = (
    index: number,
    field: LoopPlusReviewDiagnosticField,
    code: LoopPlusReviewFieldDiagnostic["code"],
    message: string,
    includeFieldInLocation: boolean,
  ) => {
    const diagnostic = reviewRowFieldDiagnostic(index, eventIds, frozenEventIds, code, field);
    const mapped = frozenEventIds === undefined
      || (index < frozenEventIds.length && eventIds[index] === frozenEventIds[index]);
    const indexedLocation = includeFieldInLocation ? `reviews[${index}].${field}` : `reviews[${index}]`;
    const location = mapped ? indexedLocation : "accept.reviews";
    reject?.(`${location} ${message}`, diagnostic);
  };
  for (let index = 0; index < raw.reviews.length; index += 1) {
    const item = raw.reviews[index];
    if (!isRecord(item)) {
      return null;
    }
    const reviewEventId = readOptionalText(item.reviewEventId);
    if (!reviewEventId || reviewEventId !== eventIds[index]) {
      rejectReview(index, "reviewEventId", "EventOrderMismatch", "必须与本次确认的同序验收事件一致，不能遗漏或调换顺序。", true);
      return null;
    }
    if (item.acceptance !== "passed" && item.acceptance !== "failed" && item.acceptance !== "cancelled") {
      rejectReview(index, "acceptance", "InvalidReviewItem", "只能是 passed、failed 或 cancelled。", true);
      return null;
    }
    const needsReason = requireReason || item.acceptance === "cancelled";
    const reason = readOptionalText(item.reason);
    if (needsReason && !reason) {
      rejectReview(index, "reason", "InvalidReviewItem", "必须提供非空验收依据。", true);
      return null;
    }
    const subtaskIds = readAcceptSubtaskIds(item);
    if (!subtaskIds) {
      rejectReview(index, "subtaskIds", "InvalidReviewItem", "必须是由非空字符串组成且没有重复 ID 的数组。", true);
      return null;
    }
    const noRepairReason = readOptionalText(item.noRepairReason);
    if (hasOwn(item, "noRepairReason") && (item.acceptance !== "failed" || !noRepairReason || subtaskIds.length > 0)) {
      rejectReview(index, "noRepairReason", "InvalidReviewItem", "仅用于不派修的失败项，须填写结案原因。", true);
      return null;
    }
    if (item.acceptance === "failed" && subtaskIds.length === 0 && !noRepairReason) {
      rejectReview(index, "subtaskIds", "FailedRepairMissing", "验收失败必须关联修复子任务，或填写 noRepairReason；未处置的失败不能确认。", false);
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
      ...(unlinked.length ? [`有 ${unlinked.length} 项任务未关联。`] : []),
      ...(unknown.length ? [`有 ${unknown.length} 项关联指向 subtasks 中不存在的任务。`] : []),
      ...(duplicates.length ? [`有 ${duplicates.length} 项任务被重复关联。`] : []),
      "修复和相关后续任务关联真实验收事件；独立的剩余目标任务列入 independentSubtaskIds，不要为补齐关联而伪造失败或继承无关修复会话。",
    ].join(""));
    return null;
  }
  return reviews;
}

function reviewRowFieldDiagnostic(
  index: number,
  replyEventIds: readonly string[],
  frozenEventIds: readonly string[] | undefined,
  code: LoopPlusReviewFieldDiagnostic["code"],
  field: LoopPlusReviewDiagnosticField,
): LoopPlusReviewFieldDiagnostic | undefined {
  const bounds = frozenEventIds === undefined ? replyEventIds.length : frozenEventIds.length;
  const mapsToFrozenRow = frozenEventIds === undefined
    || (index < frozenEventIds.length && replyEventIds[index] === frozenEventIds[index]);
  if (!mapsToFrozenRow) {
    return batchReviewFieldDiagnostic(code, field);
  }
  return hostReviewFieldDiagnostic(index, bounds, code, field);
}

function batchReviewFieldDiagnostic(
  code: LoopPlusReviewFieldDiagnostic["code"],
  field: LoopPlusReviewDiagnosticField,
): LoopPlusReviewFieldDiagnostic | undefined {
  if (!reviewFieldAllowed(code, field)) return undefined;
  return { code, field };
}

function reviewFieldAllowed(
  code: LoopPlusReviewFieldDiagnostic["code"],
  field: LoopPlusReviewDiagnosticField,
): boolean {
  if (code === "EventOrderMismatch" && field !== "reviewEventId") return false;
  if (code === "FailedRepairMissing" && field !== "subtaskIds") return false;
  if (code === "InvalidReviewItem" && field === "reviewEventId") return false;
  return LOOP_PLUS_REVIEW_DIAGNOSTIC_FIELDS.includes(field);
}

function hostReviewFieldDiagnostic(
  index: number,
  batchLength: number,
  code: LoopPlusReviewFieldDiagnostic["code"],
  field: LoopPlusReviewDiagnosticField,
): LoopPlusReviewFieldDiagnostic | undefined {
  if (!reviewFieldAllowed(code, field)) return undefined;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(batchLength)
    || index < 0 || index >= batchLength || index >= LOOP_PLUS_ACCEPTANCE_BATCH_MAX) {
    return undefined;
  }
  return { code, index, field };
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
