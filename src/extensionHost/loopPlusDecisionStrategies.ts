import type {
  LoopPlusControlDecision,
  LoopPlusDecision,
  LoopPlusDecisionStatus,
} from "../loopPlusDecision";
import type { LoopPlusNextStepPlan } from "../loopPlusNextStepPlan";
import type { LoopPlusDependencyBlock, LoopPlusDispatchResult, LoopPlusReviewVerdict } from "../loopPlusScheduler";
import type { LoopSubtaskDecision } from "../loopTaskStore";

export type LoopPlusDecisionOutcome = "continue" | "wait" | "stop";

export type LoopPlusDecisionStepView = {
  kind: "initial" | "review" | "closeout" | "continue" | "user";
  eventId: string | null;
  eventIds: readonly string[];
  userMessageCount: number;
};

declare const loopPlusDecisionControlPlanBrand: unique symbol;

export type LoopPlusDecisionControlPlan = {
  readonly [loopPlusDecisionControlPlanBrand]: true;
};

export type LoopPlusDecisionQueueView = {
  hasCurrentReview: boolean;
  hasReview: boolean;
  hasReports: boolean;
  hasUserMessages: boolean;
  runningCount: number;
  pendingCount: number;
  parentStopped: boolean;
  /** Selection blockers for this main step; raw hasReview still gates completion. */
  reviewDependencyBlocks?: readonly LoopPlusDependencyBlock[];
  requiredRepairIds?: readonly string[];
};

export type LoopPlusDecisionInFlightView = {
  runningCount: number;
  pendingCount: number;
  dependencyBlocks?: readonly LoopPlusDependencyBlock[];
};

export interface LoopPlusDecisionStrategyPort {
  queueView(): LoopPlusDecisionQueueView;
  waitForInFlightWork(): LoopPlusDecisionInFlightView;
  protocolMiss(held: boolean, reason?: string): LoopPlusDecisionOutcome;
  markDecisionAccepted(): void;
  clearProtocolRetries(): void;
  acknowledgeUserMessages(count: number): void;
  acknowledgeReports(eventIds: readonly string[], preserveRecoveryFailures?: boolean): boolean;
  captureRemainingUserMessagesForHeldReview(): void;
  applyControls(controls: readonly LoopPlusControlDecision[]): boolean;
  planControls(controls: readonly LoopPlusControlDecision[]): LoopPlusDecisionControlPlan | null;
  previewControls(plan: LoopPlusDecisionControlPlan): boolean;
  commitControls(
    controls: readonly LoopPlusControlDecision[],
    plan: LoopPlusDecisionControlPlan,
  ): boolean;
  dispatchSubtasks(
    subtasks: readonly LoopSubtaskDecision[],
  ): Pick<LoopPlusDispatchResult, "decisions" | "rejected">;
  submitReviewBatch(
    eventIds: readonly string[],
    acceptance: "passed" | "failed" | readonly LoopPlusDecisionReviewVerdict[],
  ): { ok: boolean };
  requeueCurrentReview(): void;
  promoteDecisionWork(): void;
  persistRunning(): void;
  persistSnapshot(): void;
  applyNextStepPlan(plan: LoopPlusNextStepPlan | undefined): void;
  persistEstimatedRounds(decision: LoopPlusDecision): void;
  persistProgressPercent(decision: LoopPlusDecision): void;
  noteWaiting(runningCount: number): void;
  pauseForReview(message: string, summary?: string): void;
  armCloseout(): void;
  tryFinishParent(): boolean;
  finishParent(decision: LoopPlusDecision): LoopPlusDecisionOutcome;
  /** 验收已经结束时记录逐项结果。没做验收时由实现自行跳过。 */
  recordAcceptancePlanFeedback?(decision: LoopPlusDecision): void;
}

export type LoopPlusDecisionStrategy = (
  port: LoopPlusDecisionStrategyPort,
  step: LoopPlusDecisionStepView,
  decision: LoopPlusDecision,
) => LoopPlusDecisionOutcome;

export type LoopPlusDecisionStrategyRegistry = {
  readonly [Status in LoopPlusDecisionStatus]: LoopPlusDecisionStrategy;
};

export function confirmedLoopPlusReviewIds(decision: LoopPlusDecision): string[] {
  if (decision.reviewEventIds && decision.reviewEventIds.length > 0) {
    return decision.reviewEventIds;
  }
  if (decision.reviewEventId) {
    return [decision.reviewEventId];
  }
  return [];
}

export function sameLoopPlusReviewIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export const sameLoopPlusReportIds = sameLoopPlusReviewIds;

export type LoopPlusDecisionReviewVerdict = LoopPlusReviewVerdict;

export function loopPlusAcceptVerdicts(
  decision: LoopPlusDecision,
  eventIds: readonly string[],
): LoopPlusDecisionReviewVerdict[] | null {
  const reviews = decision.reviews;
  if (!reviews || reviews.length !== eventIds.length) {
    return null;
  }
  const verdicts: LoopPlusDecisionReviewVerdict[] = [];
  for (let index = 0; index < eventIds.length; index += 1) {
    const review = reviews[index];
    const eventId = eventIds[index];
    if (!review || review.reviewEventId !== eventId) {
      return null;
    }
    if (review.acceptance !== "passed" && review.acceptance !== "failed" && review.acceptance !== "cancelled") {
      return null;
    }
    if (review.acceptance === "cancelled" && !review.reason?.trim()) return null;
    if (review.acceptance === "failed" && (!review.subtaskIds?.length && !review.noRepairReason?.trim())) return null;
    verdicts.push({
      eventId,
      acceptance: review.acceptance,
      ...(review.acceptance === "cancelled" ? { reason: review.reason } : {}),
      ...(review.noRepairReason ? { noRepairReason: review.noRepairReason } : {}),
      ...(review.acceptance === "failed" && review.subtaskIds?.length ? { repairRequired: true } : {}),
    });
  }
  return verdicts;
}

function hasPendingDecisionWork(view: LoopPlusDecisionQueueView): boolean {
  return view.hasReview || view.hasReports;
}

function acknowledgeDecisionReports(
  port: LoopPlusDecisionStrategyPort,
  decision: LoopPlusDecision,
): boolean {
  const reportEventIds = decision.reportEventIds ?? [];
  return reportEventIds.length === 0 || port.acknowledgeReports(reportEventIds);
}

export function createLoopPlusDecisionStrategyRegistry(): LoopPlusDecisionStrategyRegistry {
  return {
    dispatch: applyDispatchDecision,
    accept: applyAcceptDecision,
    wait: applyWaitDecision,
    steer: applySteerDecision,
    blocked: applyBlockedDecision,
    completed: applyCompletedDecision,
    clarify: applyClarifyDecision,
  };
}

export function loopPlusDecisionStrategyFor(
  status: LoopPlusDecisionStatus,
  registry: LoopPlusDecisionStrategyRegistry = createLoopPlusDecisionStrategyRegistry(),
): LoopPlusDecisionStrategy {
  switch (status) {
    case "dispatch":
    case "accept":
    case "wait":
    case "steer":
    case "blocked":
    case "completed":
    case "clarify":
      return registry[status];
    default:
      return unreachableDecisionStatus(status);
  }
}

function applyDispatchDecision(
  port: LoopPlusDecisionStrategyPort,
  step: LoopPlusDecisionStepView,
  decision: LoopPlusDecision,
): LoopPlusDecisionOutcome {
  if (port.queueView().hasCurrentReview) {
    return port.protocolMiss(true, "当前有开放验收批次，不能 dispatch；请返回 accept 确认整批，并在同一决策中派发后续任务。");
  }
  const controls = decision.controls ?? [];
  const controlPlan = controls.length > 0 ? port.planControls(controls) : null;
  if (controls.length > 0 && (controlPlan === null || !port.previewControls(controlPlan))) {
    return port.protocolMiss(false);
  }
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(false);
  if (controlPlan !== null && !port.commitControls(controls, controlPlan)) {
    return port.protocolMiss(false);
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  const dispatched = port.dispatchSubtasks(decision.subtasks ?? []);
  if (dispatched.rejected.length > 0) {
    port.promoteDecisionWork();
    return port.protocolMiss(false, dispatchRejectionReason(dispatched));
  }
  port.persistEstimatedRounds(decision);
  port.markDecisionAccepted();
  port.applyNextStepPlan(decision.nextStepPlan);
  port.promoteDecisionWork();
  const inFlight = port.waitForInFlightWork();
  if (hasPendingDecisionWork(port.queueView()) || onlyDependencyBlocked(inFlight)) {
    return "continue";
  }
  const after = port.queueView();
  if (after.runningCount === 0 && after.pendingCount === 0) {
    if (port.queueView().hasUserMessages) {
      return "continue";
    }
    port.pauseForReview("loop-plus-no-work");
    return "stop";
  }
  return "wait";
}

function applySteerDecision(
  port: LoopPlusDecisionStrategyPort,
  step: LoopPlusDecisionStepView,
  decision: LoopPlusDecision,
): LoopPlusDecisionOutcome {
  if (port.queueView().hasCurrentReview) {
    return port.protocolMiss(true);
  }
  const controls = decision.controls ?? [];
  if (controls.length === 0) {
    return port.protocolMiss(false);
  }
  const controlPlan = port.planControls(controls);
  if (controlPlan === null || !port.previewControls(controlPlan)) {
    return port.protocolMiss(false);
  }
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(false);
  if (!port.commitControls(controls, controlPlan)) {
    return port.protocolMiss(false);
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  port.markDecisionAccepted();
  port.applyNextStepPlan(decision.nextStepPlan);
  port.persistEstimatedRounds(decision);
  port.promoteDecisionWork();
  const inFlight = port.waitForInFlightWork();
  if (hasPendingDecisionWork(port.queueView()) || onlyDependencyBlocked(inFlight)) {
    return "continue";
  }
  const after = port.queueView();
  if (after.runningCount === 0 && after.pendingCount === 0) {
    if (port.queueView().hasUserMessages) {
      return "continue";
    }
    port.armCloseout();
    return "continue";
  }
  return "wait";
}

function applyAcceptDecision(
  port: LoopPlusDecisionStrategyPort,
  step: LoopPlusDecisionStepView,
  decision: LoopPlusDecision,
): LoopPlusDecisionOutcome {
  if (step.kind !== "review" || !sameLoopPlusReviewIds(confirmedLoopPlusReviewIds(decision), step.eventIds)) {
    return port.protocolMiss(step.eventIds.length > 0,
      `accept 确认的事件必须与当前验收批次数量及顺序一致：${JSON.stringify(step.eventIds)}。`);
  }
  const verdicts = loopPlusAcceptVerdicts(decision, step.eventIds);
  if (!verdicts) {
    return port.protocolMiss(true, "accept.reviews 必须与当前批次逐项对应，且每项保留真实 passed、failed 或 cancelled 结论及撤销原因。");
  }
  const controls = decision.controls ?? [];
  const controlPlan = controls.length > 0 ? port.planControls(controls) : null;
  if (controls.length > 0 && (controlPlan === null || !port.previewControls(controlPlan))) {
    return port.protocolMiss(true);
  }
  const submitted = port.submitReviewBatch(step.eventIds, verdicts);
  if (!submitted.ok) {
    port.persistSnapshot();
    return port.queueView().parentStopped ? "stop" : port.protocolMiss(true);
  }
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(true);
  port.acknowledgeUserMessages(step.userMessageCount);
  port.persistProgressPercent(decision);
  port.recordAcceptancePlanFeedback?.(decision);
  if (controlPlan !== null && !port.commitControls(controls, controlPlan)) {
    return port.protocolMiss(false);
  }
  const dispatched = port.dispatchSubtasks(decision.subtasks ?? []);
  if (dispatched.rejected.length > 0) {
    port.promoteDecisionWork();
    return port.protocolMiss(false, dispatchRejectionReason(dispatched));
  }
  port.persistEstimatedRounds(decision);
  port.markDecisionAccepted();
  port.applyNextStepPlan(decision.nextStepPlan);
  port.promoteDecisionWork();
  const inFlight = port.waitForInFlightWork();
  if (hasPendingDecisionWork(port.queueView()) || onlyDependencyBlocked(inFlight)) {
    return "continue";
  }
  if (inFlight.runningCount > 0 || inFlight.pendingCount > 0) {
    port.persistRunning();
    return "wait";
  }
  port.armCloseout();
  return "continue";
}

function applyWaitDecision(
  port: LoopPlusDecisionStrategyPort,
  step: LoopPlusDecisionStepView,
  decision: LoopPlusDecision,
): LoopPlusDecisionOutcome {
  const snapshot = port.queueView();
  if (snapshot.hasCurrentReview) {
    return port.protocolMiss(true, "当前有开放验收批次，不能 wait；请返回 accept 确认整批并继续派发剩余工作，或在满足全部完成门禁时返回 completed。");
  }
  if (snapshot.runningCount === 0 && snapshot.pendingCount === 0 && !snapshot.hasReview && !snapshot.hasReports) {
    return port.protocolMiss(false, "当前没有运行中或排队任务，wait 无法推进。请完成满足全部门禁的任务，或用 dispatch 派发未完成工作；不要因这项矛盾请求用户继续。");
  }
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(false);
  port.acknowledgeUserMessages(step.userMessageCount);
  port.promoteDecisionWork();
  const afterReports = port.queueView();
  if (hasPendingDecisionWork(afterReports) && (
    !afterReports.reviewDependencyBlocks?.length || afterReports.hasReports
    || (decision.reportEventIds?.length ?? 0) > 0
  )) {
    return "continue";
  }
  const inFlight = port.waitForInFlightWork();
  if (inFlight.runningCount === 0 && afterReports.reviewDependencyBlocks?.length) {
    return port.protocolMiss(false, reviewDependencyWaitReason(afterReports));
  }
  if (onlyDependencyBlocked(inFlight)) {
    return port.protocolMiss(false, dependencyWaitReason(inFlight));
  }
  port.markDecisionAccepted();
  port.applyNextStepPlan(decision.nextStepPlan);
  if (inFlight.runningCount === 0 && inFlight.pendingCount === 0) {
    port.armCloseout();
    return "continue";
  }
  port.persistRunning();
  port.noteWaiting(inFlight.runningCount);
  return "wait";
}

function applyBlockedDecision(
  port: LoopPlusDecisionStrategyPort,
  step: LoopPlusDecisionStepView,
  decision: LoopPlusDecision,
): LoopPlusDecisionOutcome {
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(false);
  if (port.queueView().hasCurrentReview) {
    port.requeueCurrentReview();
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  port.clearProtocolRetries();
  const pending = port.queueView();
  if (pending.hasUserMessages || pending.hasReports) {
    port.captureRemainingUserMessagesForHeldReview();
    port.promoteDecisionWork();
    return "continue";
  }
  port.applyNextStepPlan(undefined);
  port.pauseForReview("loop-plus-blocked", decision.finalSummary);
  return "stop";
}

function applyCompletedDecision(
  port: LoopPlusDecisionStrategyPort,
  step: LoopPlusDecisionStepView,
  decision: LoopPlusDecision,
): LoopPlusDecisionOutcome {
  const confirmed = confirmedLoopPlusReviewIds(decision);
  let submittedReview = false;
  if (step.eventIds.length > 0) {
    if (!sameLoopPlusReviewIds(confirmed, step.eventIds)) {
      return port.protocolMiss(true,
        `completed 确认的事件必须与当前验收批次数量及顺序一致：${JSON.stringify(step.eventIds)}。`);
    }
    const submitted = port.submitReviewBatch(step.eventIds, "passed");
    if (!submitted.ok) {
      port.persistSnapshot();
      return "stop";
    }
    submittedReview = true;
  } else if (confirmed.length > 0) {
    return port.protocolMiss(false, "当前没有验收事件，completed 不得携带 reviewEventId 或 reviewEventIds。");
  }
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(step.eventIds.length > 0);
  port.acknowledgeUserMessages(step.userMessageCount);
  port.persistSnapshot();
  port.promoteDecisionWork();
  const inFlight = port.waitForInFlightWork();
  const pending = port.queueView();
  if (pending.requiredRepairIds?.length && !hasPendingDecisionWork(pending) && !pending.hasUserMessages
    && inFlight.runningCount === 0 && (inFlight.pendingCount === 0 || onlyDependencyBlocked(inFlight))) {
    if (submittedReview) port.recordAcceptancePlanFeedback?.(decision);
    return port.protocolMiss(false, `尚欠返工 ${JSON.stringify(pending.requiredRepairIds)}。请用原逻辑 ID dispatch 新 attempt 并再次验收；不要重复确认原事件。`);
  }
  if (
    hasPendingDecisionWork(pending)
    || pending.hasUserMessages
    || pending.runningCount > 0
    || pending.pendingCount > 0
  ) {
    if (onlyDependencyBlocked(inFlight) && !hasPendingDecisionWork(pending) && !pending.hasUserMessages) {
      if (submittedReview) {
        port.markDecisionAccepted();
        port.applyNextStepPlan(undefined);
        port.recordAcceptancePlanFeedback?.(decision);
        return "continue";
      }
      return port.protocolMiss(false, dependencyWaitReason(inFlight));
    }
    if (!submittedReview && inFlight.runningCount === 0 && pending.reviewDependencyBlocks?.length
      && !pending.hasReports && !pending.hasUserMessages && !(decision.reportEventIds?.length)) {
      return port.protocolMiss(false, reviewDependencyWaitReason(pending));
    }
    if (submittedReview) {
      port.markDecisionAccepted();
      port.applyNextStepPlan(undefined);
      port.recordAcceptancePlanFeedback?.(decision);
    } else {
      port.clearProtocolRetries();
    }
    const latest = port.queueView();
    if (hasPendingDecisionWork(latest) || latest.hasUserMessages) {
      return "continue";
    }
    port.persistRunning();
    return "wait";
  }
  if (pending.requiredRepairIds?.length) {
    port.recordAcceptancePlanFeedback?.(decision);
    return port.protocolMiss(false, `尚欠返工 ${JSON.stringify(pending.requiredRepairIds)}。请用原逻辑 ID dispatch 新 attempt 并再次验收；不要重复确认原事件。`);
  }
  if (!port.tryFinishParent()) {
    const latest = port.queueView();
    if (hasPendingDecisionWork(latest) || latest.hasUserMessages) {
      return "continue";
    }
    port.persistRunning();
    return "wait";
  }
  port.markDecisionAccepted();
  port.recordAcceptancePlanFeedback?.(decision);
  return port.finishParent(decision);
}

function reviewDependencyWaitReason(view: LoopPlusDecisionQueueView): string {
  return `当前待审事件被验收依赖阻塞且无活跃执行，wait/completed 无法推进：${JSON.stringify(view.reviewDependencyBlocks)}。`
    + "请按最新 attempt 修复前置或调整尚未运行后继的依赖；保留未确认事件与真实验收结论，无安全工作时使用既有 blocked 规则。";
}

function onlyDependencyBlocked(view: LoopPlusDecisionInFlightView): boolean {
  return view.runningCount === 0 && view.pendingCount > 0 && (view.dependencyBlocks?.length ?? 0) > 0;
}

function dependencyWaitReason(view: LoopPlusDecisionInFlightView): string {
  return `当前全部 pending 被依赖阻塞，wait 无法推进：${JSON.stringify(view.dependencyBlocks)}。`
    + "请用原逻辑 ID 重派失败或关闭的前置，或用 controls.reprompt 调整尚未运行后继的 dependsOn；新 ID 不会替代旧前置。保留真实失败结论，无安全工作可推进时按既有 blocked 规则处理。";
}

function applyClarifyDecision(): LoopPlusDecisionOutcome {
  return "stop";
}

function unreachableDecisionStatus(status: never): never {
  throw new Error(`unhandled loop-plus decision status: ${String(status)}`);
}

function dispatchRejectionReason(result: Pick<LoopPlusDispatchResult, "decisions" | "rejected">): string {
  return `派发存在拒绝项：${JSON.stringify(result.rejected)}。已接受任务：${JSON.stringify(result.decisions)}。`
    + "此前验收结论和用户消息确认已经保留；不得重复 accept、改变 failed 结论或重发已接受任务。"
    + "请依据最新快照使用 dispatch 仅纠正尚未接受的派发，使用不占用活动任务的 ID；后到验收事件仍按当前批次处理。";
}
