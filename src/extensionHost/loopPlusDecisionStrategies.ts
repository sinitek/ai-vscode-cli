import type {
  LoopPlusControlDecision,
  LoopPlusDecision,
  LoopPlusDecisionStatus,
} from "../loopPlusDecision";
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
  hasUserMessages: boolean;
  runningCount: number;
  pendingCount: number;
  parentStopped: boolean;
};

export type LoopPlusDecisionInFlightView = {
  runningCount: number;
  pendingCount: number;
};

export interface LoopPlusDecisionStrategyPort {
  queueView(): LoopPlusDecisionQueueView;
  waitForInFlightWork(): LoopPlusDecisionInFlightView;
  protocolMiss(held: boolean): LoopPlusDecisionOutcome;
  markDecisionAccepted(): void;
  clearProtocolRetries(): void;
  acknowledgeUserMessages(count: number): void;
  refuseDispatchPastAcceptanceLimit(plannedLaunches: number): boolean;
  confirmReviewWithinAcceptanceLimit(eventIds: readonly string[]): boolean;
  applyControls(controls: readonly LoopPlusControlDecision[]): boolean;
  planControls(controls: readonly LoopPlusControlDecision[]): LoopPlusDecisionControlPlan | null;
  previewControls(plan: LoopPlusDecisionControlPlan): boolean;
  commitControls(
    controls: readonly LoopPlusControlDecision[],
    plan: LoopPlusDecisionControlPlan,
  ): boolean;
  dispatchSubtasks(subtasks: readonly LoopSubtaskDecision[]): void;
  submitReviewBatch(
    eventIds: readonly string[],
    acceptance: "passed" | "failed",
  ): { ok: boolean };
  requeueCurrentReview(): void;
  persistRunning(): void;
  persistSnapshot(): void;
  persistEstimatedRounds(decision: LoopPlusDecision): void;
  noteWaiting(runningCount: number): void;
  pauseForReview(message: string, summary?: string): void;
  armCloseout(): void;
  tryFinishParent(): boolean;
  finishParent(decision: LoopPlusDecision): LoopPlusDecisionOutcome;
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

export function plannedLoopPlusLaunchCount(decision: LoopPlusDecision): number {
  const continues = (decision.controls ?? []).filter((control) => control.action === "reprompt").length;
  return (decision.subtasks?.length ?? 0) + continues;
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
    return port.protocolMiss(true);
  }
  const controls = decision.controls ?? [];
  if (port.refuseDispatchPastAcceptanceLimit(plannedLoopPlusLaunchCount(decision))) {
    return "stop";
  }
  if (controls.length > 0 && !port.applyControls(controls)) {
    return port.protocolMiss(false);
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  port.markDecisionAccepted();
  port.dispatchSubtasks(decision.subtasks ?? []);
  port.persistEstimatedRounds(decision);
  if (port.queueView().hasReview) {
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
  if (port.refuseDispatchPastAcceptanceLimit(plannedLoopPlusLaunchCount(decision))) {
    return "stop";
  }
  if (!port.applyControls(controls)) {
    return port.protocolMiss(false);
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  port.markDecisionAccepted();
  port.persistEstimatedRounds(decision);
  if (port.queueView().hasReview) {
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
    return port.protocolMiss(step.eventIds.length > 0);
  }
  if (!port.confirmReviewWithinAcceptanceLimit(step.eventIds)) {
    return "stop";
  }
  const controls = decision.controls ?? [];
  const controlPlan = controls.length > 0 ? port.planControls(controls) : null;
  if (controls.length > 0 && (controlPlan === null || !port.previewControls(controlPlan))) {
    return port.protocolMiss(true);
  }
  const acceptance = (decision.subtasks?.length ?? 0) > 0 ? "failed" : "passed";
  const submitted = port.submitReviewBatch(step.eventIds, acceptance);
  if (!submitted.ok) {
    port.persistSnapshot();
    return port.queueView().parentStopped ? "stop" : port.protocolMiss(true);
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  port.markDecisionAccepted();
  if (port.refuseDispatchPastAcceptanceLimit(plannedLoopPlusLaunchCount(decision))) {
    return "stop";
  }
  if (controlPlan !== null && !port.commitControls(controls, controlPlan)) {
    return port.protocolMiss(false);
  }
  port.dispatchSubtasks(decision.subtasks ?? []);
  port.persistEstimatedRounds(decision);
  if (port.queueView().hasReview) {
    return "continue";
  }
  const inFlight = port.waitForInFlightWork();
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
): LoopPlusDecisionOutcome {
  const snapshot = port.queueView();
  if (snapshot.hasCurrentReview) {
    return port.protocolMiss(true);
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  if (port.queueView().hasReview) {
    return "continue";
  }
  port.markDecisionAccepted();
  if (snapshot.runningCount === 0 && snapshot.pendingCount === 0) {
    if (port.queueView().hasUserMessages) {
      return "continue";
    }
    port.pauseForReview("loop-plus-idle-wait");
    return "stop";
  }
  port.persistRunning();
  port.noteWaiting(snapshot.runningCount);
  return "wait";
}

function applyBlockedDecision(
  port: LoopPlusDecisionStrategyPort,
  step: LoopPlusDecisionStepView,
  decision: LoopPlusDecision,
): LoopPlusDecisionOutcome {
  if (port.queueView().hasCurrentReview) {
    port.requeueCurrentReview();
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  port.clearProtocolRetries();
  if (port.queueView().hasUserMessages) {
    return "continue";
  }
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
      return port.protocolMiss(true);
    }
    if (!port.confirmReviewWithinAcceptanceLimit(step.eventIds)) {
      return "stop";
    }
    const submitted = port.submitReviewBatch(step.eventIds, "passed");
    if (!submitted.ok) {
      port.persistSnapshot();
      return "stop";
    }
    submittedReview = true;
  } else if (confirmed.length > 0) {
    return port.protocolMiss(false);
  }
  port.acknowledgeUserMessages(step.userMessageCount);
  const pending = port.queueView();
  if (
    pending.hasReview
    || pending.hasUserMessages
    || pending.runningCount > 0
    || pending.pendingCount > 0
  ) {
    if (submittedReview) {
      port.markDecisionAccepted();
    } else {
      port.clearProtocolRetries();
    }
    const latest = port.queueView();
    if (latest.hasReview || latest.hasUserMessages) {
      return "continue";
    }
    port.persistRunning();
    return "wait";
  }
  if (!port.tryFinishParent()) {
    const latest = port.queueView();
    if (latest.hasReview || latest.hasUserMessages) {
      return "continue";
    }
    port.persistRunning();
    return "wait";
  }
  port.markDecisionAccepted();
  return port.finishParent(decision);
}

function applyClarifyDecision(): LoopPlusDecisionOutcome {
  return "stop";
}

function unreachableDecisionStatus(status: never): never {
  throw new Error(`unhandled loop-plus decision status: ${String(status)}`);
}
