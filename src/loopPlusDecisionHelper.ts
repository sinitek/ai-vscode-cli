#!/usr/bin/env node
/**
 * Loop+ 决策填表入口。宿主把只读快照和模型填写的事实交给本进程，
 * 本进程组装协议对象并复用 parseLoopPlusDecisionForFrozenInput。
 * 不读写任务记录、调度状态或提交权。
 *
 * 接入约定：node dist/loopPlusDecisionHelper.js <template|build> --status <status>
 * 标准输入是一个 UTF-8 JSON 对象，含 context 与 fields。
 */
import * as fs from "fs";
import { LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES } from "./loopPlusAcceptancePlan";
import {
  LOOP_PLUS_DECISION_STATUSES,
  LOOP_PLUS_DECISION_SUBTASK_LIMIT,
  LOOP_PLUS_DECISION_SUBTASK_MIN,
  loopPlusFrozenParseOptions,
  parseLoopPlusDecisionForFrozenInput,
  type LoopPlusDecisionOptions,
  type LoopPlusDecisionParseResult,
  type LoopPlusDecisionStatus,
} from "./loopPlusDecision";
import { sameLoopPlusReportIds } from "./extensionHost/loopPlusDecisionStrategies";
import { initLogger, logError, logEssential, scheduleLogRetentionCleanup } from "./logger";
import { normalizeLoopWriteFiles } from "./loopParallel";
import { LOOP_PLUS_TASK_TYPES, type LoopPlusTaskType } from "./loopTaskStore";

export const LOOP_PLUS_DECISION_HELPER_CONTEXT_VERSION = 1;
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_NESTING_DEPTH = 8;
const MAX_COLLECTION_ITEMS = 64;

const COMMANDS = ["template", "build"] as const;
type HelperCommand = (typeof COMMANDS)[number];

const REASON = {
  ok: "decision.authored",
  usage: "input.usage",
  size: "input.too_large",
  json: "input.invalid_json",
  shape: "input.invalid_shape",
  version: "context.version",
  status: "status.not_allowed",
  contradiction: "input.contradiction",
  missing: "fields.missing",
  rejected: "decision.rejected",
} as const;

type ReasonCode = (typeof REASON)[keyof typeof REASON];

export type LoopPlusDecisionHelperReview = {
  eventId: string;
  subtaskId: string;
};

export type LoopPlusDecisionHelperContext = {
  v: typeof LOOP_PLUS_DECISION_HELPER_CONTEXT_VERSION;
  statuses: LoopPlusDecisionStatus[];
  reviews: LoopPlusDecisionHelperReview[];
  reportEventIds: string[];
  subtaskMax: number;
  acceptancePlanKeys: string[];
  allowDirectCompletion: boolean;
  requireAcceptanceFeedback?: boolean;
  requireProgressPercent?: boolean;
};

type FieldSpec = {
  path: string;
  required: boolean;
  description: string;
};

const TASK_TYPE_TEXT = "taskType 必须是 backend、frontend 或 general；general 不能带 writeFiles 或 codingDelivery。";
const CONTROLS_TEXT = "可选。对其它运行中或排队任务填写 close 或 reprompt，不要控制本次派发中的同一任务 ID；省略表示不控制。";

const STATUS_FIELDS: Record<LoopPlusDecisionStatus, readonly string[]> = {
  dispatch: ["subtasks", "nextStepPlan", "controls", "reportEventIds", "departmentCollaborations", "estimatedRemainingRounds"],
  accept: ["reviews", "acceptance", "acceptancePlanResults", "independentSubtasks", "nextStepPlan", "controls", "progressPercent", "reportEventIds", "departmentCollaborations", "estimatedRemainingRounds"],
  wait: ["nextStepPlan", "reportEventIds", "departmentCollaborations", "estimatedRemainingRounds"],
  steer: ["controls", "nextStepPlan", "reportEventIds", "departmentCollaborations", "estimatedRemainingRounds"],
  blocked: ["blocker", "finalSummary", "reportEventIds", "departmentCollaborations", "estimatedRemainingRounds"],
  clarify: ["clarification", "finalSummary", "reportEventIds", "departmentCollaborations", "estimatedRemainingRounds"],
  completed: ["directCompletion", "answerConclusion", "finalSummary", "acceptance", "requirementCoverage", "acceptancePlanResults", "reportEventIds", "departmentCollaborations", "estimatedRemainingRounds"],
};

type Issue = { path: string; message: string; fix: string };

class HelperError extends Error {
  constructor(readonly reason: ReasonCode, readonly issues: Issue[]) {
    super(issues.map((issue) => `${issue.path}：${issue.message} 修正：${issue.fix}`).join("\n"));
  }
}

type RunIo = {
  readInput?: () => Promise<string>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  argv?: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function depthOf(value: unknown, depth = 0): number {
  if (!value || typeof value !== "object") return depth;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.reduce((max, child) => Math.max(max, depthOf(child, depth + 1)), depth);
}

function collectionTooLarge(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.length > MAX_COLLECTION_ITEMS || children.some(collectionTooLarge);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function issue(path: string, message: string, fix: string): Issue {
  return { path, message, fix };
}

function fail(reason: ReasonCode, items: Issue[]): never {
  throw new HelperError(reason, items);
}

function readStringList(value: unknown, path: string, options: { allowEmpty: boolean; unique: boolean }): string[] {
  if (!Array.isArray(value)) {
    fail(REASON.shape, [issue(path, "必须是字符串数组。", "改为 JSON 字符串数组，元素使用宿主给出的原值。")]);
  }
  if (!options.allowEmpty && value.length === 0) {
    fail(REASON.shape, [issue(path, "不能为空。", "至少放入一项非空字符串，或在协议允许时省略该数组。")]);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const normalized = text(item);
    if (!normalized) {
      fail(REASON.shape, [issue(`${path}[${index}]`, "必须是非空字符串。", "去掉空白项，改填宿主快照中的原 ID。")]);
    }
    if (options.unique && seen.has(normalized)) {
      fail(REASON.shape, [issue(`${path}[${index}]`, "出现重复值。", "每个 ID 只保留一次，并保持宿主给出的顺序。")]);
    }
    seen.add(normalized);
    return normalized;
  });
}

function parseContext(value: unknown): LoopPlusDecisionHelperContext {
  if (!isRecord(value)) {
    fail(REASON.shape, [issue("context", "必须是对象。", "传入 context 对象，版本固定为 v=1。")]);
  }
  if (value.v !== LOOP_PLUS_DECISION_HELPER_CONTEXT_VERSION) {
    fail(REASON.version, [issue("context.v", "上下文版本不受支持。", "将 context.v 设为 1，并按该版本填写其余字段。")]);
  }
  const statuses = readStringList(value.statuses, "context.statuses", { allowEmpty: false, unique: true });
  const unknown = statuses.filter((status) => !LOOP_PLUS_DECISION_STATUSES.includes(status as LoopPlusDecisionStatus));
  if (unknown.length > 0) {
    fail(REASON.shape, [issue("context.statuses", `包含不受支持的状态 ${unknown.join("、")}。`, `只使用 ${LOOP_PLUS_DECISION_STATUSES.join("、")}。`)]);
  }
  if (!Array.isArray(value.reviews)) {
    fail(REASON.shape, [issue("context.reviews", "必须是按冻结顺序排列的数组。", "每项填写 eventId 和 subtaskId；没有验收批次时用空数组。")]);
  }
  const reviews = value.reviews.map((item, index) => {
    if (!isRecord(item)) {
      fail(REASON.shape, [issue(`context.reviews[${index}]`, "必须是对象。", "填写 { eventId, subtaskId }。")]);
    }
    const eventId = text(item.eventId);
    const subtaskId = text(item.subtaskId);
    if (!eventId || !subtaskId) {
      fail(REASON.shape, [issue(`context.reviews[${index}]`, "缺少 eventId 或 subtaskId。", "两项都使用宿主冻结批次中的非空原值。")]);
    }
    return { eventId, subtaskId };
  });
  if (new Set(reviews.map((item) => item.eventId)).size !== reviews.length) {
    fail(REASON.contradiction, [issue("context.reviews", "冻结验收事件 ID 重复。", "按宿主顺序每个事件只保留一次。")]);
  }
  const reportEventIds = readStringList(value.reportEventIds, "context.reportEventIds", { allowEmpty: true, unique: true });
  if (typeof value.subtaskMax !== "number" || !Number.isInteger(value.subtaskMax)
    || value.subtaskMax < LOOP_PLUS_DECISION_SUBTASK_MIN
    || value.subtaskMax > LOOP_PLUS_DECISION_SUBTASK_LIMIT) {
    fail(REASON.shape, [issue("context.subtaskMax", "超出单次派发数量范围。", `填写 ${LOOP_PLUS_DECISION_SUBTASK_MIN} 到 ${LOOP_PLUS_DECISION_SUBTASK_LIMIT} 的整数。`)]);
  }
  const acceptancePlanKeys = readStringList(value.acceptancePlanKeys, "context.acceptancePlanKeys", { allowEmpty: true, unique: true });
  if (typeof value.allowDirectCompletion !== "boolean") {
    fail(REASON.shape, [issue("context.allowDirectCompletion", "必须是布尔值。", "按宿主是否开放直接完成填写 true 或 false。")]);
  }
  const requireAcceptanceFeedback = readOptionalBoolean(value.requireAcceptanceFeedback, "context.requireAcceptanceFeedback");
  const requireProgressPercent = readOptionalBoolean(value.requireProgressPercent, "context.requireProgressPercent");
  return {
    v: 1,
    statuses: statuses as LoopPlusDecisionStatus[],
    reviews,
    reportEventIds,
    subtaskMax: value.subtaskMax,
    acceptancePlanKeys,
    allowDirectCompletion: value.allowDirectCompletion,
    ...(requireAcceptanceFeedback === undefined ? {} : { requireAcceptanceFeedback }),
    ...(requireProgressPercent === undefined ? {} : { requireProgressPercent }),
  };
}

function readOptionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    fail(REASON.shape, [issue(path, "必须是布尔值或省略。", "按宿主选项填写 true 或 false；省略表示不启用。")]);
  }
  return value;
}

function parserOptions(context: LoopPlusDecisionHelperContext): LoopPlusDecisionOptions {
  return loopPlusFrozenParseOptions({
    subtaskMax: context.subtaskMax,
    allowDirectCompletion: context.allowDirectCompletion,
    acceptancePlanKeys: context.acceptancePlanKeys,
    requireAcceptanceFeedback: context.requireAcceptanceFeedback,
    requireProgressPercent: context.requireProgressPercent,
    frozenReviewEventIds: context.reviews.map((review) => review.eventId),
  });
}

function assertAllowed(context: LoopPlusDecisionHelperContext, status: string): asserts status is LoopPlusDecisionStatus {
  if (!context.statuses.includes(status as LoopPlusDecisionStatus)) {
    fail(REASON.status, [issue("--status", `当前快照不允许 ${status || "(空)"}。`, `改用 context.statuses 中的一项：${context.statuses.join("、")}。`)]);
  }
}

function reportFields(context: LoopPlusDecisionHelperContext, status: LoopPlusDecisionStatus): FieldSpec[] {
  if (context.reportEventIds.length === 0) return [];
  return [{
    path: "reportEventIds",
    required: true,
    description: status === "clarify"
      ? "按冻结顺序原样回填 context.reportEventIds。clarify 不消费报告，恢复调度后这些报告仍待确认。"
      : "按冻结 FIFO 前缀原样确认 context.reportEventIds，不能增删或调序。",
  }];
}

function templateFields(context: LoopPlusDecisionHelperContext, status: LoopPlusDecisionStatus): FieldSpec[] {
  const reports = reportFields(context, status);
  const plan = context.acceptancePlanKeys.map((key) => ({
    path: `acceptancePlanResults.${key}`,
    required: true,
    description: "填写 passed 布尔值和证据 reason。",
  }));
  const checks = LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES.map((name) => ({
    path: `acceptance.checks.${name}`,
    required: true,
    description: "填写 passed 布尔值和证据 detail。",
  }));
  if (status === "accept") {
    return [
      { path: "progressPercent", required: context.requireProgressPercent === true, description: context.requireProgressPercent === true ? "填写 0 到 99 的整数。" : "可选。填写 0 到 99 的整数；不更新进度时省略。" },
      ...context.reviews.flatMap((review, index) => [
        { path: `reviews[${index}].acceptance`, required: true, description: `事件 ${review.eventId} 只能填 passed、failed 或 cancelled。` },
        { path: `reviews[${index}].reason`, required: context.requireAcceptanceFeedback === true, description: "填写该事件的验收依据；cancelled 始终必填。" },
        { path: `reviews[${index}].repair`, required: false, description: `失败且需要返工时填写同 ID ${review.subtaskId} 的 title、prompt 和 taskType。${TASK_TYPE_TEXT} 无需返工改填 noRepairReason。` },
      ]),
      ...checks,
      ...plan,
      { path: "independentSubtasks", required: false, description: `只放与本批事件无关的新任务，每项含 id、title、prompt 和 taskType。${TASK_TYPE_TEXT}` },
      { path: "controls", required: false, description: CONTROLS_TEXT },
      { path: "nextStepPlan", required: false, description: "可选，含 objective 和非空 acceptanceCriteria 数组。" },
      compatibilityField(),
      ...reports,
    ];
  }
  if (status === "dispatch") {
    return [
      { path: "subtasks", required: true, description: `填写 1 到 ${context.subtaskMax} 个新任务，每项含 id、title、prompt 和 taskType。${TASK_TYPE_TEXT}` },
      { path: "controls", required: false, description: CONTROLS_TEXT },
      { path: "nextStepPlan", required: false, description: "可选，含 objective。" },
      compatibilityField(),
      ...reports,
    ];
  }
  if (status === "completed" && context.allowDirectCompletion && context.reviews.length === 0 && context.acceptancePlanKeys.length === 0) {
    return [
      { path: "directCompletion", required: false, description: "只有选择直接完成时填 true，并且不要同时填写验收、覆盖或子任务字段。" },
      { path: "answerConclusion", required: true, description: "填写实际结果。" },
      { path: "finalSummary", required: true, description: "填写实际操作与结果。" },
      compatibilityField(),
      ...reports,
    ];
  }
  if (status === "completed") {
    return [
      { path: "answerConclusion", required: true, description: "填写实际结果。" },
      { path: "finalSummary", required: true, description: "填写完成说明。" },
      ...checks.map((field) => ({ ...field, description: "每项必须 passed=true，并填写证据 detail。" })),
      { path: "requirementCoverage", required: true, description: "每项含 name、passed=true 和 detail。" },
      ...plan.map((field) => ({ ...field, description: "每项必须 passed=true，并填写证据 reason。" })),
      compatibilityField(),
      ...reports,
    ];
  }
  if (status === "clarify") {
    return [
      { path: "clarification.formFields", required: true, description: "填写 1 到 8 个用户字段。" },
      { path: "finalSummary", required: false, description: "可选，填写向用户展示的澄清说明。" },
      compatibilityField(),
      ...reports,
    ];
  }
  if (status === "blocked") {
    return [
      { path: "blocker", required: true, description: "填写 kind、cause、affectedRequirements、evidence、attempts、nextSteps，以及恢复条件或替代方案。" },
      { path: "finalSummary", required: true, description: "填写非空熔断说明，并与 blocker 一并提交。" },
      compatibilityField(),
      ...reports,
    ];
  }
  if (status === "steer") {
    return [
      { path: "controls", required: true, description: "填写针对运行中或排队任务的 close 或 reprompt。" },
      { path: "nextStepPlan", required: false, description: "可选，含 objective。" },
      compatibilityField(),
      ...reports,
    ];
  }
  return [
    { path: "nextStepPlan", required: false, description: "可选，含 objective。" },
    compatibilityField(),
    ...reports,
  ];
}

function compatibilityField(): FieldSpec {
  return {
    path: "estimatedRemainingRounds",
    required: false,
    description: "可选兼容字段，填写 0 到 100 的整数；省略不影响调度。",
  };
}

function applyReports(context: LoopPlusDecisionHelperContext, _status: LoopPlusDecisionStatus, fields: Record<string, unknown>, decision: Record<string, unknown>): void {
  if (context.reportEventIds.length === 0) {
    if (fields.reportEventIds !== undefined) {
      fail(REASON.contradiction, [issue("fields.reportEventIds", "当前没有待确认报告。", "省略 reportEventIds。")]);
    }
    return;
  }
  const supplied = readStringList(fields.reportEventIds, "fields.reportEventIds", { allowEmpty: false, unique: true });
  if (!sameLoopPlusReportIds(supplied, context.reportEventIds)) {
    fail(REASON.contradiction, [issue("fields.reportEventIds", "与冻结 FIFO 前缀不一致。", `按原序原样填写 ${JSON.stringify(context.reportEventIds)}。`)]);
  }
  decision.reportEventIds = supplied;
}

function assertSupportedFields(status: LoopPlusDecisionStatus, fields: Record<string, unknown>): void {
  const allowed = new Set<string>(STATUS_FIELDS[status]);
  const extras = Object.keys(fields).filter((key) => !allowed.has(key));
  if (extras.length === 0) return;
  fail(REASON.contradiction, extras.map((key) => issue(
    `fields.${key}`,
    `${status} 不支持该字段。`,
    `删除 fields.${key}。${status} 只使用 ${STATUS_FIELDS[status].join("、")}。`,
  )));
}

function assertAuthorTaskType(task: Record<string, unknown>, path: string): void {
  const raw = task.taskType;
  const taskType = typeof raw === "string" ? raw.trim() : "";
  if (!taskType || !LOOP_PLUS_TASK_TYPES.includes(taskType as LoopPlusTaskType)) {
    fail(REASON.missing, [issue(
      `${path}.taskType`,
      "必须是非空的 backend、frontend 或 general。",
      "填写这三项之一。general 不能声明 writeFiles 或 codingDelivery。",
    )]);
  }
  if (taskType !== "general") return;
  const writeFiles = normalizeLoopWriteFiles(task.writeFiles);
  const declaresCodingDelivery = Object.prototype.hasOwnProperty.call(task, "codingDelivery");
  if (writeFiles.length === 0 && !declaresCodingDelivery) return;
  fail(REASON.contradiction, [issue(
    writeFiles.length > 0 ? `${path}.writeFiles` : `${path}.codingDelivery`,
    "general 任务不能声明写入文件或编码交付。",
    "移除 writeFiles 和 codingDelivery，或把 taskType 改为 backend 或 frontend。",
  )]);
}

function assertDispatchTasks(fields: Record<string, unknown>): void {
  if (!Array.isArray(fields.subtasks)) return;
  fields.subtasks.forEach((item, index) => {
    if (!isRecord(item) || !text(item.id) || !text(item.title) || !text(item.prompt)) return;
    assertAuthorTaskType(item, `fields.subtasks[${index}]`);
  });
}

function readEstimatedRemainingRounds(fields: Record<string, unknown>): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(fields, "estimatedRemainingRounds")) return undefined;
  const value = fields.estimatedRemainingRounds;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    fail(REASON.shape, [issue(
      "fields.estimatedRemainingRounds",
      "必须是 0 到 100 的整数。",
      "改正为该范围内的整数，或省略这个可选兼容字段。",
    )]);
  }
  return value;
}

function requireBlockedFinalSummary(fields: Record<string, unknown>): string {
  if (typeof fields.finalSummary !== "string" || !fields.finalSummary.trim()) {
    fail(REASON.missing, [issue(
      "fields.finalSummary",
      "必须是非空字符串。",
      "与 blocker 一起填写熔断说明，不能只留空白。",
    )]);
  }
  return fields.finalSummary;
}

function readTask(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value) || !text(value.id) || !text(value.title) || !text(value.prompt)) {
    fail(REASON.missing, [issue(path, "任务事实不完整。", "填写非空 id、title、prompt 和 taskType。")]);
  }
  assertAuthorTaskType(value, path);
  return value;
}

function buildAccept(context: LoopPlusDecisionHelperContext, fields: Record<string, unknown>): Record<string, unknown> {
  if (context.reviews.length === 0) {
    fail(REASON.status, [issue("--status", "当前没有可确认的冻结验收批次。", "改用 context.statuses 里不依赖验收批次的状态。")]);
  }
  const reviewInputs = fields.reviews;
  if (!Array.isArray(reviewInputs) || reviewInputs.length !== context.reviews.length) {
    fail(REASON.missing, [issue("fields.reviews", "必须逐项覆盖冻结批次。", `按顺序提供 ${context.reviews.length} 项结论。`)]);
  }
  const subtasks: Record<string, unknown>[] = [];
  const reviews = context.reviews.map((frozen, index) => {
    const raw = reviewInputs[index];
    const path = `fields.reviews[${index}]`;
    if (!isRecord(raw) || !text(raw.acceptance)) {
      fail(REASON.missing, [issue(`${path}.acceptance`, "缺少明确验收结论。", "填写 passed、failed 或 cancelled。")]);
    }
    if (raw.acceptance !== "passed" && raw.acceptance !== "failed" && raw.acceptance !== "cancelled") {
      fail(REASON.shape, [issue(`${path}.acceptance`, "结论无效。", "只能填写 passed、failed 或 cancelled。")]);
    }
    const review: Record<string, unknown> = {
      reviewEventId: frozen.eventId,
      acceptance: raw.acceptance,
      ...(text(raw.reason) ? { reason: text(raw.reason) } : {}),
    };
    if (raw.acceptance === "failed") {
      const hasRepair = raw.repair !== undefined;
      const hasNoRepair = text(raw.noRepairReason) !== undefined;
      if (hasRepair === hasNoRepair) {
        fail(REASON.contradiction, [issue(path, "失败项必须且只能选择一种处置。", `返工时提供 repair，并使用原逻辑 ID ${frozen.subtaskId}；无须返工时只填 noRepairReason。`)]);
      }
      if (hasNoRepair) {
        review.noRepairReason = text(raw.noRepairReason);
      } else {
        const repair = readTask(raw.repair, `${path}.repair`);
        if (text(repair.id) !== frozen.subtaskId) {
          fail(REASON.contradiction, [issue(`${path}.repair.id`, "返工 ID 与冻结事件的原子任务不一致。", `改为 ${frozen.subtaskId}，不要新建逻辑 ID。`)]);
        }
        if (repair.requiresAcceptance === false) {
          fail(REASON.contradiction, [issue(`${path}.repair.requiresAcceptance`, "同 ID 返工必须再次验收。", "省略该字段或设为 true。")]);
        }
        subtasks.push({ ...repair, id: frozen.subtaskId, requiresAcceptance: true });
        review.subtaskIds = [frozen.subtaskId];
      }
    } else if (raw.repair !== undefined || raw.noRepairReason !== undefined) {
      fail(REASON.contradiction, [issue(path, "只有失败项才能携带返工或无须返工原因。", "删除 repair 和 noRepairReason。")]);
    }
    return review;
  });
  if (fields.independentSubtasks !== undefined && !Array.isArray(fields.independentSubtasks)) {
    fail(REASON.shape, [issue("fields.independentSubtasks", "必须是任务数组。", "每个独立任务填写 id、title 和 prompt；没有则省略该字段。")]);
  }
  const independent = Array.isArray(fields.independentSubtasks) ? fields.independentSubtasks : [];
  const independentIds = independent.map((item, index) => text(readTask(item, `fields.independentSubtasks[${index}]`).id)!);
  const repairIds = subtasks.map((item) => text(item.id)).filter((id): id is string => Boolean(id));
  if (new Set(repairIds).size !== repairIds.length || repairIds.some((id) => independentIds.includes(id))) {
    fail(REASON.contradiction, [issue("fields.reviews", "返工和独立派发的任务 ID 冲突。", "每个任务 ID 只能归属一个失败项或 independentSubtasks。")]);
  }
  if (independentIds.some((id) => context.reviews.some((review) => review.subtaskId === id))) {
    fail(REASON.contradiction, [issue("fields.independentSubtasks", "独立任务使用了本批验收的原子 ID。", "独立派发使用新 ID；同 ID 返工只放在对应失败项的 repair。")]);
  }
  const decision: Record<string, unknown> = {
    status: "accept",
    ...(context.reviews.length === 1
      ? { reviewEventId: context.reviews[0]?.eventId }
      : { reviewEventIds: context.reviews.map((review) => review.eventId) }),
    reviews,
    ...(context.requireProgressPercent || fields.progressPercent !== undefined ? { progressPercent: fields.progressPercent } : {}),
    ...(fields.acceptance !== undefined ? { acceptance: fields.acceptance } : {}),
    ...(fields.acceptancePlanResults !== undefined ? { acceptancePlanResults: fields.acceptancePlanResults } : {}),
    ...(subtasks.length + independent.length > 0 ? { subtasks: [...subtasks, ...independent] } : {}),
    ...(independentIds.length > 0 ? { independentSubtaskIds: independentIds } : {}),
    ...(fields.controls !== undefined ? { controls: fields.controls } : {}),
    ...(fields.nextStepPlan !== undefined ? { nextStepPlan: fields.nextStepPlan } : {}),
  };
  return decision;
}

function buildFromFields(context: LoopPlusDecisionHelperContext, status: LoopPlusDecisionStatus, fields: Record<string, unknown>): Record<string, unknown> {
  assertSupportedFields(status, fields);
  let decision: Record<string, unknown>;
  if (status === "accept") decision = buildAccept(context, fields);
  else if (status === "dispatch") {
    assertDispatchTasks(fields);
    decision = {
      status,
      subtasks: fields.subtasks,
      ...(fields.controls !== undefined ? { controls: fields.controls } : {}),
      ...(fields.nextStepPlan !== undefined ? { nextStepPlan: fields.nextStepPlan } : {}),
    };
  } else if (status === "completed" && fields.directCompletion === true) {
    if (!context.allowDirectCompletion) {
      fail(REASON.status, [issue("fields.directCompletion", "宿主没有开放直接完成。", "删除 directCompletion，改为填写正常完成证据。")]);
    }
    if (context.reviews.length > 0 || context.acceptancePlanKeys.length > 0) {
      fail(REASON.contradiction, [issue("fields.directCompletion", "当前快照仍有冻结验收或附加审查。", "删除 directCompletion，改为确认验收批次并填写正常完成证据。")]);
    }
    const mixed = ["acceptance", "requirementCoverage", "acceptancePlanResults", "subtasks", "reviews", "controls", "reviewEventId", "reviewEventIds"]
      .filter((key) => fields[key] !== undefined);
    if (mixed.length > 0) {
      fail(REASON.contradiction, [issue("fields.directCompletion", "直接完成不能混入验收或派发字段。", `删除 ${mixed.join("、")}，只保留结论和总结。`)]);
    }
    decision = { status, directCompletion: true, answerConclusion: fields.answerConclusion, finalSummary: fields.finalSummary };
  } else if (status === "completed") {
    if (fields.directCompletion !== undefined) {
      fail(REASON.shape, [issue("fields.directCompletion", "只能为 true 或省略。", "选择直接完成时填 true；否则删除该字段并填写验收证据。")]);
    }
    decision = {
      status,
      ...(context.reviews.length === 1 ? { reviewEventId: context.reviews[0]?.eventId } : {}),
      ...(context.reviews.length > 1 ? { reviewEventIds: context.reviews.map((review) => review.eventId) } : {}),
      answerConclusion: fields.answerConclusion,
      finalSummary: fields.finalSummary,
      acceptance: fields.acceptance,
      requirementCoverage: fields.requirementCoverage,
      ...(fields.acceptancePlanResults !== undefined ? { acceptancePlanResults: fields.acceptancePlanResults } : {}),
    };
  } else if (status === "clarify") {
    decision = { status, clarification: fields.clarification, ...(fields.finalSummary !== undefined ? { finalSummary: fields.finalSummary } : {}) };
  } else if (status === "blocked") {
    // 非空 finalSummary 进入候选 JSON。有效 blocker 时，共用解析器改写成诊断摘要。
    decision = { status, blocker: fields.blocker, finalSummary: requireBlockedFinalSummary(fields) };
  } else if (status === "steer") {
    decision = { status, controls: fields.controls, ...(fields.nextStepPlan !== undefined ? { nextStepPlan: fields.nextStepPlan } : {}) };
  } else {
    decision = { status, ...(fields.nextStepPlan !== undefined ? { nextStepPlan: fields.nextStepPlan } : {}) };
  }
  applyReports(context, status, fields, decision);
  if (fields.departmentCollaborations !== undefined) {
    decision.departmentCollaborations = fields.departmentCollaborations;
  }
  const estimatedRemainingRounds = readEstimatedRemainingRounds(fields);
  if (estimatedRemainingRounds !== undefined) decision.estimatedRemainingRounds = estimatedRemainingRounds;
  return decision;
}

function rejectionField(status: LoopPlusDecisionStatus, parsed: LoopPlusDecisionParseResult): string {
  if (parsed.decision?.blockerIssue) return "fields.blocker";
  const diagnostic = parsed.validationDiagnostic;
  if (diagnostic) {
    if (diagnostic.field === "subtasks" || diagnostic.field === "subtask") return `fields.${diagnostic.field}`;
    const index = diagnostic.index === undefined ? "" : `[${diagnostic.index}]`;
    return `fields.subtasks${index}.${diagnostic.field}`;
  }
  const review = parsed.reviewFieldDiagnostic;
  if (review) {
    return review.index === undefined ? `fields.reviews.${review.field}` : `fields.reviews[${review.index}].${review.field}`;
  }
  const reason = parsed.rejectionReason ?? "";
  if (reason.includes("controls") || (status === "steer" && reason.includes("协议校验失败"))) return "fields.controls";
  if (reason.includes("nextStepPlan")) return "fields.nextStepPlan";
  if (reason.includes("progressPercent")) return "fields.progressPercent";
  if (reason.includes("finalSummary")) return "fields.finalSummary";
  if (reason.includes("directCompletion")) return "fields.directCompletion";
  if (reason.includes("reportEventIds")) return "fields.reportEventIds";
  if (reason.includes("clarification")) return "fields.clarification";
  return "fields.decision";
}

function parseEnvelope(raw: string): { context: LoopPlusDecisionHelperContext; fields: Record<string, unknown> } {
  if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_BYTES) {
    fail(REASON.size, [issue("stdin", `输入超过 ${MAX_INPUT_BYTES} 字节。`, "只提交当前 context 和 fields，不要粘贴报告正文或会话内容。")]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(REASON.json, [issue("stdin", "不是 UTF-8 JSON 对象。", "标准输入只放一个 JSON 对象，包含 context 和 fields。")]);
  }
  if (!isRecord(parsed)) {
    fail(REASON.shape, [issue("stdin", "顶层必须是对象。", "不要使用数组或字符串包裹。")]);
  }
  if (depthOf(parsed) > MAX_NESTING_DEPTH || collectionTooLarge(parsed)) {
    fail(REASON.size, [issue("stdin", "对象嵌套或集合过大。", `嵌套不超过 ${MAX_NESTING_DEPTH} 层，每层集合不超过 ${MAX_COLLECTION_ITEMS} 项。`)]);
  }
  const context = parseContext(parsed.context);
  if (!isRecord(parsed.fields)) {
    fail(REASON.shape, [issue("fields", "必须是对象。", "模型填写的结论放在 fields；template 可传空对象。")]);
  }
  return { context, fields: parsed.fields };
}

async function record(operation: string, status: string, outcome: "ok" | "error", reason: ReasonCode): Promise<void> {
  const entry = { operation, status, outcome, reason };
  try {
    await initLogger();
    if (outcome === "ok") await logEssential("loop-plus-decision-helper", entry);
    else await logError("loop-plus-decision-helper", entry);
    await scheduleLogRetentionCleanup();
  } catch {
    // 日志失败不能改变生成结果或退出码。
  }
}

export async function runLoopPlusDecisionHelper(io: RunIo = {}): Promise<number> {
  const argv = io.argv ?? process.argv.slice(2);
  const stdout = io.stdout ?? ((text) => { process.stdout.write(text); });
  const stderr = io.stderr ?? ((text) => { process.stderr.write(text); });
  const readInput = io.readInput ?? (() => Promise.resolve(fs.readFileSync(0, "utf8")));
  const [command, statusFlag, status = ""] = argv;
  if (!COMMANDS.includes(command as HelperCommand) || statusFlag !== "--status" || argv.length !== 3) {
    const failure = new HelperError(REASON.usage, [issue("argv", "命令无效。", "使用 template --status <status> 或 build --status <status>，并从标准输入读取 JSON。")]);
    stderr(`${failure.message}\n`);
    await record("usage", "", "error", failure.reason);
    return 2;
  }
  try {
    const input = parseEnvelope(await readInput());
    assertAllowed(input.context, status);
    if (command === "template") {
      stdout(`${JSON.stringify({ status, fields: templateFields(input.context, status) }, null, 2)}\n`);
      await record(command, status, "ok", REASON.ok);
      return 0;
    }
    const candidate = buildFromFields(input.context, status, input.fields);
    const parsed = parseLoopPlusDecisionForFrozenInput(JSON.stringify(candidate), parserOptions(input.context));
    if (!parsed.decision || (parsed.decision.status === "blocked" && !parsed.decision.blocker)) {
      const reason = parsed.decision?.blockerIssue ?? parsed.rejectionReason ?? "协议校验失败。";
      fail(REASON.rejected, [issue(rejectionField(status, parsed), reason, "按原因中的字段修正 fields 后重新调用 build。")]);
    }
    if (parsed.decision.departmentCollaborationIssue) {
      fail(REASON.rejected, [issue("fields.departmentCollaborations", "协作请求没有通过共享协议校验。", "每项填写互不重复的非空 id、targetLeaderTaskId 和 body，或省略该字段。")]);
    }
    stdout(`${JSON.stringify(parsed.decision)}\n`);
    await record(command, status, "ok", REASON.ok);
    return 0;
  } catch (error) {
    const failure = error instanceof HelperError
      ? error
      : new HelperError(REASON.shape, [issue("helper", "生成过程出现内部错误。", "检查 JSON 字段类型后重试；不要改为手写最终协议。")]);
    stderr(`${failure.message}\n`);
    await record(command, status, "error", failure.reason);
    return 1;
  }
}

if (require.main === module) {
  runLoopPlusDecisionHelper().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.exitCode = 1;
  });
}
