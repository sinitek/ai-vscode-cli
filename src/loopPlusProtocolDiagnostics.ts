import { createHash, randomBytes } from "crypto";
import {
  CODEX_THREAD_BUSY,
  CODEX_THREAD_HANDOFF_FAILED,
  CODEX_THREAD_WRITER_CONFLICT,
} from "./interactive/codexThreadErrors";
import {
  LOOP_PLUS_ACCEPTANCE_BATCH_MAX,
  LOOP_PLUS_REVIEW_DIAGNOSTIC_FIELDS,
  type LoopPlusDecisionParseResult,
  type LoopPlusDecisionValidationDiagnostic,
  type LoopPlusReviewFieldDiagnostic,
} from "./loopPlusDecision";
import { LOOP_PLUS_MAIN_FAILURE_CODES, RUNTIME_CONFIG_LOCK_TIMEOUT } from "./loopMainFailure";

/** 冻结验收事件与报告前缀的关联键。只由已有 ID 序列派生，不进入上下文契约。 */
export function loopPlusFrozenBatchKey(reviewEventIds: readonly string[], reportEventIds: readonly string[] = []): string {
  const canonical = `v1\nreviews\n${reviewEventIds.join("\n")}\nreports\n${reportEventIds.join("\n")}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
}

export const LOOP_PLUS_RESPONSE_SHAPES = ["absent", "empty", "whitespace", "json_object", "text", "execution_failed"] as const;
export type LoopPlusResponseShape = (typeof LOOP_PLUS_RESPONSE_SHAPES)[number];

export const LOOP_PLUS_REQUEST_PHASES = ["initial", "continue", "review", "user", "closeout"] as const;
export type LoopPlusRequestPhase = (typeof LOOP_PLUS_REQUEST_PHASES)[number];

const RESPONSE_SHAPE_SET = new Set<string>(LOOP_PLUS_RESPONSE_SHAPES);
const REQUEST_PHASE_SET = new Set<string>(LOOP_PLUS_REQUEST_PHASES);

export function isLoopPlusResponseShape(value: unknown): value is LoopPlusResponseShape {
  return typeof value === "string" && RESPONSE_SHAPE_SET.has(value);
}

export function isLoopPlusRequestPhase(value: unknown): value is LoopPlusRequestPhase {
  return typeof value === "string" && REQUEST_PHASE_SET.has(value);
}

export function readLoopPlusBatchKey(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{12}$/.test(value) ? value : undefined;
}

/** 一次宿主主调用的不透明键。只用于把该次终结日志和协议拒绝日志配成一对。 */
export function loopPlusInvocationKey(): string {
  return randomBytes(6).toString("hex");
}

export function readLoopPlusInvocationKey(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{12}$/.test(value) ? value : undefined;
}

/** batchKey 只表示冻结验收与报告 ID 序列相同，不表示同一次调用或同一个父任务。 */
export const LOOP_PLUS_BATCH_EVIDENCE = "frozen_id_sequence" as const;

export function readLoopPlusBatchEvidence(value: unknown): typeof LOOP_PLUS_BATCH_EVIDENCE | undefined {
  return value === LOOP_PLUS_BATCH_EVIDENCE ? LOOP_PLUS_BATCH_EVIDENCE : undefined;
}

export const LOOP_PLUS_TERMINAL_REASON_CODES = [
  ...LOOP_PLUS_MAIN_FAILURE_CODES,
  "DEPARTMENT_NATIVE_UNKNOWN",
  "SESSION_RUN_ACTIVE",
  RUNTIME_CONFIG_LOCK_TIMEOUT,
  CODEX_THREAD_BUSY,
  CODEX_THREAD_HANDOFF_FAILED,
  CODEX_THREAD_WRITER_CONFLICT,
] as const;

export type LoopPlusTerminalReasonCode = (typeof LOOP_PLUS_TERMINAL_REASON_CODES)[number];

const TERMINAL_REASON_SET = new Set<string>(LOOP_PLUS_TERMINAL_REASON_CODES);

/** getErrorInfo.code 来源开放。只有这份固定枚举可以进入终结观测和持久化摘要。 */
export function readLoopPlusTerminalReasonCode(value: unknown): LoopPlusTerminalReasonCode | undefined {
  return typeof value === "string" && TERMINAL_REASON_SET.has(value) ? value as LoopPlusTerminalReasonCode : undefined;
}

/** 只区分宿主看到的返回形态，不解析协议，也不保留正文。 */
export function classifyLoopPlusResponse(content: string | null | undefined): {
  responseShape: Exclude<LoopPlusResponseShape, "execution_failed">;
  charCount: number;
} {
  if (typeof content !== "string") return { responseShape: "absent", charCount: 0 };
  const charCount = content.length;
  if (charCount === 0) return { responseShape: "empty", charCount: 0 };
  if (!content.trim()) return { responseShape: "whitespace", charCount };
  if (content.trimStart().startsWith("{")) return { responseShape: "json_object", charCount };
  return { responseShape: "text", charCount };
}

export const FORMAT_ERROR_HINTS: Readonly<Record<string, string>> = {
  EmptyResponse: "请返回一个完整的决策 JSON 对象，不要返回空回复。",
  ObjectNotFound: "未找到可解析的 JSON 对象；请返回完整的决策对象。",
  InvalidObject: "请修正 JSON 语法并返回一个完整的对象。",
  IncompleteObject: "请补全 JSON 对象，检查字符串、数组及对象是否闭合。",
  ColonExpected: "检查属性名后是否缺少冒号。",
  CommaExpected: "检查相邻成员或数组元素之间是否缺少逗号。",
  PropertyNameExpected: "检查对象成员名是否使用双引号，并检查多余的逗号。",
  ValueExpected: "检查冒号或逗号后是否缺少合法 JSON 值。",
  CloseBraceExpected: "检查对象是否缺少右花括号。",
  CloseBracketExpected: "检查数组是否缺少右方括号。",
  UnexpectedEndOfString: "检查字符串的双引号和转义是否完整。",
  UnexpectedEndOfComment: "检查块注释是否已闭合。",
  InvalidEscapeCharacter: "检查字符串中的反斜杠转义。",
  InvalidSymbol: "检查属性名、字符串和 JSON 字面值的写法。",
  InvalidNumberFormat: "检查 JSON 数字的写法。",
  UnexpectedEndOfNumber: "请补全 JSON 数字。",
  EndOfFileExpected: "请只返回一个完整的 JSON 对象。",
  InvalidCommentToken: "检查注释标记或移除该注释。",
  InvalidUnicode: "检查字符串的 Unicode 转义。",
  InvalidCharacter: "检查非法字符与字符串转义。",
};

const VALIDATION_HINTS = {
  InvalidSubtaskList: "请使用 subtasks 对象数组，或使用合法的单个 subtask 对象。",
  InvalidSubtaskCount: "按当前形状和本轮数量上限返回子任务；只需控制任务且没有开放验收批次时使用 steer。",
  InvalidSubtaskItem: "请使用包含 title 和 prompt 的子任务对象。",
  DuplicateSubtaskId: "请使用唯一子任务 ID；省略 ID 时，相同标题也会生成相同 ID。",
  MissingSubtaskTitle: "请提供非空字符串标题。",
  MissingSubtaskPrompt: "请提供非空字符串 prompt。",
  InvalidSubtaskContinuation: "请省略该字段，或填写非空的来源子任务 ID。",
  InvalidSubtaskType: "请使用 backend、frontend 或 general，或省略该字段。",
  InvalidCodingDelivery: "请使用布尔值，或省略该字段。",
  SubtaskClassificationConflict: "general 任务不能声明写入文件或编码交付；请移除冲突声明，或改用 backend 或 frontend。",
  InvalidRequiresAcceptance: "请使用布尔值，或省略该字段。",
  InvalidSubtaskDependencies: "请使用非空 ID 字符串数组，不要重复或依赖自身；无依赖时可省略或用空数组。",
} satisfies Record<LoopPlusDecisionValidationDiagnostic["code"], string>;

const BRANCH_DIAGNOSTICS = {
  "validation.invalid_decision": ["请按当前决策形状核对 status、必要字段及跨字段关联。"],
  "validation.status.invalid": ["请从当前提示允许的 status 中选择一个，并返回该状态对应的完整字段。", "status"],
  "validation.accept.invalid_reviews": ["每项须保留真实 passed、failed 或 cancelled 结论及适用原因，并与声明的事件逐项对应。", "accept.reviews"],
  "validation.accept.unlinked_subtasks": ["accept.subtasks 中与验收事件有关的任务须只关联至对应 reviews[i].subtaskIds；独立的剩余目标工作须列入 independentSubtaskIds。每个新增任务 ID 必须按合约恰好归属一处，不得把独立工作挂到失败项。", "subtasks"],
  "validation.accept.failed_repair_missing": ["针对每个实际失败的 reviews[i] 分别处理：仅当该项确需修复时，才在该项 subtaskIds 关联快照中的原逻辑 ID，并在 subtasks 恰好派发一项同 ID 返工；若该项无需修复，则不关联返工并填写非空 noRepairReason。独立的剩余目标工作使用 independentSubtaskIds，不要挂到失败项。"],
  "validation.steer.controls_required": ["steer 必须提供实际的控制操作。", "steer.controls"],
  "validation.blocked.invalid_blocker": ["优先执行或派发授权内的可行方案。方案均不可行时把理由写入 attempts 并省略 recoveryOptions，补齐 blocker.constraintSource（具体要求、项目规则、权限拒绝或技术事实）、证据、影响和恢复条件。", "blocked.blocker"],
  "state.review_batch_open.dispatch_forbidden": ["当前有开放验收批次，不能 dispatch；请用 accept 确认整批并在同一决策中派发后续任务。"],
  "state.review_batch_open.wait_forbidden": ["当前有开放验收批次，不能 wait；请用 accept 确认整批，或仅在满足全部完成门禁时使用 completed。"],
  "state.review_batch_open.steer_forbidden": ["先按当前验收形状确认整批；后续控制只能使用当前形状允许的 controls。"],
  "state.review_batch.mismatch": ["确认的事件必须与当前冻结验收批次数量及顺序一致；没有验收批次时不要声明验收事件。", "reviewEventId / reviewEventIds"],
  "state.review_batch.unavailable": ["按最新快照重新核对当前未确认的批次，不要确认已消费的事件。"],
  "state.review_batch.failed_cannot_pass": ["执行失败或停止的事件不能验收通过；请用 accept 标记失败并派修或说明无需修复，仅在交付不再需要时才撤销验收。", "reviews"],
  "state.report_batch.mismatch": ["按快照所列顺序确认本次提示冻结的全部报告；没有待确认报告时省略该字段或返回空数组。", "reportEventIds"],
  "state.report_batch.wait_required": ["请用 wait 和当前 reportEventIds 仅确认本次报告；原验收批次在报告消费后恢复。", "reportEventIds"],
  "state.clarification.limit_reached": ["本任务的澄清次数已用尽。请按已有需求和授权继续可行工作。剩余目标确实无法推进时，用 blocked 说明限制的来源、已尝试的方法和恢复条件。", "clarification"],
  "state.dispatch_window.plan_required": ["验收前派发须提供用于续跑本批验收的 nextStepPlan。也可直接继续验收冻结批次。", "nextStepPlan"],
  "state.dispatch_window.controls_forbidden": ["验收前派发不能带 controls；请省略控制操作或直接继续验收冻结批次。", "controls"],
  "state.dispatch_window.preflight_failed": ["验收前只允许在单次派发上限和空槽内立即启动独立新任务；不得等待、续接、依赖待确认结果或与待验收交付冲突。不满足时请继续验收冻结批次。", "subtasks"],
  "state.controls.unavailable": ["请核对 controls 的目标是快照中允许操作的运行中或排队任务；不要重放已应用的操作。", "controls"],
  "state.dispatch.rejected": ["派发存在拒绝项。此前验收结论及已确认消息保留；不得重复 accept、改变 failed 结论或重发已接受任务。按快照仅纠正未接受的派发。", "subtasks"],
  "state.wait.no_work": ["当前没有运行中或排队任务，wait 无法推进。请用 dispatch 派发未完成工作，或在满足全部门禁时使用 completed；不要因这项矛盾请求用户继续。"],
  "state.wait.interrupted_work": ["主任务须处置“已中断，等待续跑”的子任务。请用 controls.reprompt 沿原 ID 继续，或在派发接替任务时用 controls.close 关闭原预留。后继仍依赖原 ID 时保留原 ID。确需外部输入时说明阻塞。"],
  "state.wait.dependency_blocked": ["当前全部 pending 被依赖阻塞。请用原逻辑 ID 重派失败或关闭的前置，或调整尚未运行后继的 dependsOn；无安全工作时使用既有 blocked 规则。"],
  "state.wait.review_dependency_blocked": ["当前待审事件被验收依赖阻塞且无活跃执行。按最新 attempt 修复前置或调整尚未运行后继的依赖，保留未确认事件及真实验收结论。"],
  "state.completion.repair_required": ["尚欠返工。按快照用原逻辑 ID dispatch 新 attempt 并再次验收；不要重复确认原事件。"],
  "state.repair.source_unavailable": ["修复必须关联当前批次或欠返工记录中的原子任务；不能用其它 ID 替代缺失的原任务。"],
  "state.repair.linkage_conflict": ["每个失败交付只能关联一项修复，沿用原子任务 ID，不得覆盖其它已有任务或在同一决策中重复派发。", "subtasks"],
} as const;

export type LoopPlusProtocolBranchCode = keyof typeof BRANCH_DIAGNOSTICS;

const REVIEW_ITEM_BRANCH_FIELDS: Partial<Record<LoopPlusProtocolBranchCode, ReadonlySet<string>>> = {
  "validation.accept.invalid_reviews": new Set(LOOP_PLUS_REVIEW_DIAGNOSTIC_FIELDS),
  "validation.accept.failed_repair_missing": new Set(["subtaskIds"]),
};

export type LoopPlusProtocolDiagnostic = {
  rejectionKind: "format" | "validation" | "state";
  reasonCode: string;
  fieldPath?: string;
  position?: { line: number; column: number };
};

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function loopPlusProtocolBranchDiagnostic(reasonCode: LoopPlusProtocolBranchCode): LoopPlusProtocolDiagnostic {
  const [, fieldPath] = BRANCH_DIAGNOSTICS[reasonCode];
  return {
    rejectionKind: reasonCode.startsWith("state.") ? "state" : "validation",
    reasonCode,
    ...(fieldPath ? { fieldPath } : {}),
  };
}

export function loopPlusProtocolParseDiagnostic(parsed: LoopPlusDecisionParseResult): LoopPlusProtocolDiagnostic {
  if (parsed.rejectionKind === "format") {
    const diagnostic = parsed.formatDiagnostic;
    return readLoopPlusProtocolDiagnostic(`format.${diagnostic?.code ?? "invalid_json"}`, undefined, diagnostic?.position);
  }
  const diagnostic = parsed.validationDiagnostic;
  if (!diagnostic) {
    const reviewDiagnostic = reviewProtocolDiagnostic(parsed.reviewFieldDiagnostic);
    if (reviewDiagnostic) return reviewDiagnostic;
    const reason = parsed.rejectionReason ?? "";
    if (reason.includes("status 缺失或无效")) return loopPlusProtocolBranchDiagnostic("validation.status.invalid");
    if (reason.includes("completed 确认的事件必须") || reason.includes("accept 必须使用 reviewEventId")) {
      return loopPlusProtocolBranchDiagnostic("state.review_batch.mismatch");
    }
    if (reason.includes("缺少 blocker") || reason.includes("熔断诊断未补齐")) {
      return loopPlusProtocolBranchDiagnostic("validation.blocked.invalid_blocker");
    }
    if (reason.includes("未关联") || reason.includes("independentSubtaskIds")) {
      return loopPlusProtocolBranchDiagnostic("validation.accept.unlinked_subtasks");
    }
    if (reason.includes("验收失败必须关联修复子任务")) {
      return loopPlusProtocolBranchDiagnostic("validation.accept.failed_repair_missing");
    }
    if (reason.includes("控制目标")) return loopPlusProtocolBranchDiagnostic("state.controls.unavailable");
    return loopPlusProtocolBranchDiagnostic("validation.invalid_decision");
  }
  const listField = diagnostic.field === "subtask" || (diagnostic.index === undefined && diagnostic.field !== "subtasks")
    ? "subtask" : "subtasks";
  const index = diagnostic.index === undefined ? "" : `[${diagnostic.index}]`;
  const field = diagnostic.field === "subtasks" || diagnostic.field === "subtask" ? "" : `.${diagnostic.field}`;
  return readLoopPlusProtocolDiagnostic(`validation.subtasks.${diagnostic.code}`, `${diagnostic.status}.${listField}${index}${field}`);
}

export function readLoopPlusProtocolDiagnostic(
  reasonCode: string,
  fieldPath?: string,
  position?: LoopPlusProtocolDiagnostic["position"],
): LoopPlusProtocolDiagnostic {
  if (hasOwn(BRANCH_DIAGNOSTICS, reasonCode)) {
    const branch = loopPlusProtocolBranchDiagnostic(reasonCode as LoopPlusProtocolBranchCode);
    const controlled = controlledReviewFieldPath(reasonCode, fieldPath);
    return controlled ? { ...branch, fieldPath: controlled } : branch;
  }
  if (reasonCode.startsWith("format.")) {
    return {
      rejectionKind: "format",
      reasonCode: hasOwn(FORMAT_ERROR_HINTS, reasonCode.slice("format.".length)) ? reasonCode : "format.invalid_json",
      ...(position && Number.isSafeInteger(position.line) && position.line > 0
        && Number.isSafeInteger(position.column) && position.column > 0 ? { position } : {}),
    };
  }
  if (reasonCode.startsWith("validation.subtasks.") && hasOwn(VALIDATION_HINTS, reasonCode.slice("validation.subtasks.".length))) {
    return {
      rejectionKind: "validation", reasonCode,
      ...(fieldPath && /^(accept|dispatch)\.(subtasks(\[\d{1,9}\])?|subtask)(\.(id|title|prompt|continueFromSubtaskId|taskType|codingDelivery|writeFiles|requiresAcceptance|dependsOn))?$/.test(fieldPath)
        ? { fieldPath } : {}),
    };
  }
  return loopPlusProtocolBranchDiagnostic("validation.invalid_decision");
}

function reviewProtocolDiagnostic(
  diagnostic: LoopPlusReviewFieldDiagnostic | undefined,
): LoopPlusProtocolDiagnostic | undefined {
  if (!diagnostic) return undefined;
  const reasonCode = diagnostic.code === "FailedRepairMissing"
    ? "validation.accept.failed_repair_missing"
    : diagnostic.code === "EventOrderMismatch" || diagnostic.code === "InvalidReviewItem"
      ? "validation.accept.invalid_reviews"
      : undefined;
  if (!reasonCode) return undefined;
  const indexed = diagnostic.index;
  const fieldPath = Number.isSafeInteger(indexed)
    ? controlledReviewFieldPath(reasonCode, `accept.reviews[${indexed}].${diagnostic.field}`)
    : undefined;
  return readLoopPlusProtocolDiagnostic(reasonCode, fieldPath);
}

function controlledReviewFieldPath(reasonCode: string, fieldPath: string | undefined): string | undefined {
  if (!fieldPath || !hasOwn(REVIEW_ITEM_BRANCH_FIELDS, reasonCode)) return undefined;
  const allowed = REVIEW_ITEM_BRANCH_FIELDS[reasonCode as keyof typeof REVIEW_ITEM_BRANCH_FIELDS];
  const match = /^accept\.reviews\[(\d{1,9})\]\.([A-Za-z]+)$/.exec(fieldPath);
  if (!allowed || !match) return undefined;
  const index = Number(match[1]);
  const field = match[2];
  if (!Number.isSafeInteger(index) || index < 0 || index >= LOOP_PLUS_ACCEPTANCE_BATCH_MAX || !allowed.has(field)) {
    return undefined;
  }
  return `accept.reviews[${index}].${field}`;
}

export function loopPlusProtocolDiagnosticHint({ reasonCode }: LoopPlusProtocolDiagnostic): string {
  if (reasonCode.startsWith("format.")) {
    return FORMAT_ERROR_HINTS[reasonCode.slice("format.".length)] ?? "请修正语法并返回完整的决策 JSON 对象。";
  }
  if (reasonCode.startsWith("validation.subtasks.")) {
    return VALIDATION_HINTS[reasonCode.slice("validation.subtasks.".length) as keyof typeof VALIDATION_HINTS];
  }
  return BRANCH_DIAGNOSTICS[reasonCode as LoopPlusProtocolBranchCode][0];
}
