import type {
  LoopPlusControlDecision,
  LoopPlusDecision,
  LoopPlusDecisionStatus,
} from "../loopPlusDecision";
import type { LoopPlusNextStepPlan } from "../loopPlusNextStepPlan";
import type { LoopPlusDependencyBlock, LoopPlusDispatchResult, LoopPlusReviewVerdict } from "../loopPlusScheduler";
import type { LoopSubtaskDecision } from "../loopTaskStore";
import { loopPlusProtocolBranchDiagnostic, type LoopPlusProtocolBranchCode } from "../loopPlusProtocolDiagnostics";

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
  protocolMiss(held: boolean, reason?: string, diagnostic?: ReturnType<typeof loopPlusProtocolBranchDiagnostic>): LoopPlusDecisionOutcome;
  markDecisionAccepted(): void;
  clearProtocolFailure(): void;
  acknowledgeUserMessages(count: number): void;
  acknowledgeReports(eventIds: readonly string[], preserveRecoveryFailures?: boolean): boolean;
  captureRemainingUserMessagesForHeldReview(): void;
  applyControls(controls: readonly LoopPlusControlDecision[]): boolean;
  planControls(controls: readonly LoopPlusControlDecision[]): LoopPlusDecisionControlPlan | null;
  previewControls(plan: LoopPlusDecisionControlPlan): string | null;
  commitControls(
    controls: readonly LoopPlusControlDecision[],
    plan: LoopPlusDecisionControlPlan,
  ): string | null;
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

const invalidControlPlan = "controls 无法生成控制计划，请核对操作目标及 reprompt 的标题和提示词。";

function branch(reasonCode: LoopPlusProtocolBranchCode): ReturnType<typeof loopPlusProtocolBranchDiagnostic> {
  return loopPlusProtocolBranchDiagnostic(reasonCode);
}

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
    return port.protocolMiss(true, undefined, branch("state.review_batch_open.dispatch_forbidden"));
  }
  const controls = decision.controls ?? [];
  const controlPlan = controls.length > 0 ? port.planControls(controls) : null;
  const previewFailure = controlPlan ? port.previewControls(controlPlan) : controls.length > 0 ? invalidControlPlan : null;
  if (previewFailure) return port.protocolMiss(false, undefined, branch("state.controls.unavailable"));
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(false);
  const commitFailure = controlPlan ? port.commitControls(controls, controlPlan) : null;
  if (commitFailure) return port.protocolMiss(false, commitFailure);
  port.acknowledgeUserMessages(step.userMessageCount);
  const dispatched = port.dispatchSubtasks(decision.subtasks ?? []);
  if (dispatched.rejected.length > 0) {
    port.promoteDecisionWork();
    return port.protocolMiss(false, undefined, branch("state.dispatch.rejected"));
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
    return port.protocolMiss(true, undefined, branch("state.review_batch_open.steer_forbidden"));
  }
  const controls = decision.controls ?? [];
  if (controls.length === 0) {
    return port.protocolMiss(false);
  }
  const controlPlan = port.planControls(controls);
  if (!controlPlan) return port.protocolMiss(false, invalidControlPlan);
  const previewFailure = port.previewControls(controlPlan);
  if (previewFailure) return port.protocolMiss(false, previewFailure);
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(false);
  const commitFailure = port.commitControls(controls, controlPlan);
  if (commitFailure) return port.protocolMiss(false, undefined, branch("state.controls.unavailable"));
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
    return port.protocolMiss(step.eventIds.length > 0, undefined, branch("state.review_batch.mismatch"));
  }
  const verdicts = loopPlusAcceptVerdicts(decision, step.eventIds);
  if (!verdicts) {
    return port.protocolMiss(true, undefined, branch("validation.accept.invalid_reviews"));
  }
  const controls = decision.controls ?? [];
  const controlPlan = controls.length > 0 ? port.planControls(controls) : null;
  const previewFailure = controlPlan ? port.previewControls(controlPlan) : controls.length > 0 ? invalidControlPlan : null;
  if (previewFailure) return port.protocolMiss(true, undefined, branch("state.controls.unavailable"));
  const submitted = port.submitReviewBatch(step.eventIds, verdicts);
  if (!submitted.ok) {
    port.persistSnapshot();
    return port.queueView().parentStopped ? "stop" : port.protocolMiss(true);
  }
  if (!acknowledgeDecisionReports(port, decision)) return port.protocolMiss(true);
  port.acknowledgeUserMessages(step.userMessageCount);
  port.persistProgressPercent(decision);
  port.recordAcceptancePlanFeedback?.(decision);
  const commitFailure = controlPlan ? port.commitControls(controls, controlPlan) : null;
  if (commitFailure) return port.protocolMiss(false, commitFailure);
  const dispatched = port.dispatchSubtasks(decision.subtasks ?? []);
  if (dispatched.rejected.length > 0) {
    port.promoteDecisionWork();
    return port.protocolMiss(false, undefined, branch("state.dispatch.rejected"));
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
    return port.protocolMiss(true, undefined, branch("state.review_batch_open.wait_forbidden"));
  }
  if (snapshot.runningCount === 0 && snapshot.pendingCount === 0 && !snapshot.hasReview && !snapshot.hasReports) {
    return port.protocolMiss(false, undefined, branch("state.wait.no_work"));
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
    return port.protocolMiss(false, undefined, branch("state.wait.review_dependency_blocked"));
  }
  if (onlyDependencyBlocked(inFlight)) {
    return port.protocolMiss(false, undefined, branch("state.wait.dependency_blocked"));
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
  port.clearProtocolFailure();
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
      return port.protocolMiss(true, undefined, branch("state.review_batch.mismatch"));
    }
    const submitted = port.submitReviewBatch(step.eventIds, "passed");
    if (!submitted.ok) {
      port.persistSnapshot();
      return "stop";
    }
    submittedReview = true;
  } else if (confirmed.length > 0) {
    return port.protocolMiss(false, undefined, branch("state.review_batch.mismatch"));
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
    return port.protocolMiss(false, undefined, branch("state.completion.repair_required"));
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
      return port.protocolMiss(false, undefined, branch("state.wait.dependency_blocked"));
    }
    if (!submittedReview && inFlight.runningCount === 0 && pending.reviewDependencyBlocks?.length
      && !pending.hasReports && !pending.hasUserMessages && !(decision.reportEventIds?.length)) {
      return port.protocolMiss(false, undefined, branch("state.wait.review_dependency_blocked"));
    }
    if (submittedReview) {
      port.markDecisionAccepted();
      port.applyNextStepPlan(undefined);
      port.recordAcceptancePlanFeedback?.(decision);
    } else {
      port.clearProtocolFailure();
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
    return port.protocolMiss(false, undefined, branch("state.completion.repair_required"));
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

function onlyDependencyBlocked(view: LoopPlusDecisionInFlightView): boolean {
  return view.runningCount === 0 && view.pendingCount > 0 && (view.dependencyBlocks?.length ?? 0) > 0;
}

function applyClarifyDecision(): LoopPlusDecisionOutcome {
  return "stop";
}

function unreachableDecisionStatus(status: never): never {
  throw new Error(`unhandled loop-plus decision status: ${String(status)}`);
}
