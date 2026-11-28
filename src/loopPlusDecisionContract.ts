import type { LoopPlusDecisionStatus } from "./loopPlusDecision";
import type { LoopPlusSchedulerView } from "./loopPlusScheduler";

export type LoopPlusDecisionContractInput = {
  acceptanceEventIds: readonly string[];
  reportEventIds: readonly string[];
  reportOnly?: boolean;
  allowDispatchBeforeReview?: boolean;
  view: LoopPlusSchedulerView;
  requiredRepairIds?: readonly string[];
  pendingUserMessages?: readonly string[];
  interruptedSubtaskIds?: readonly string[];
  maxConcurrency: number;
};

export type LoopPlusDecisionContract = {
  statuses: readonly LoopPlusDecisionStatus[];
  completionEligible: boolean;
  availableSlots: number;
};

function hasLaterReview(input: LoopPlusDecisionContractInput): boolean {
  const batch = new Set(input.acceptanceEventIds);
  return input.view.reviewQueue.some((item) => !batch.has(item.eventId))
    || (input.view.currentReview !== null && !batch.has(input.view.currentReview.eventId));
}

function hasLaterReport(input: LoopPlusDecisionContractInput): boolean {
  const reports = new Set(input.reportEventIds);
  return (input.view.reportQueue ?? []).some((item) => !reports.has(item.eventId));
}

function hasUnconsumedUserMessage(input: LoopPlusDecisionContractInput): boolean {
  return input.view.userMessageQueue.some((message, index) => input.pendingUserMessages?.[index] !== message);
}

function isCompletionEligible(input: LoopPlusDecisionContractInput): boolean {
  if (input.view.phase === "stopped" || input.view.phase === "completed") return false;
  if (input.view.running.length > 0 || input.view.pending.length > 0) return false;
  if (input.requiredRepairIds?.length || input.view.blockers.includes("repair_required")) return false;
  if (input.view.blockers.includes("parent_stopped") || input.view.blockers.includes("completed")) return false;
  if (hasLaterReview(input) || hasLaterReport(input) || hasUnconsumedUserMessage(input)) return false;
  const events = [input.view.currentReview, ...input.view.reviewQueue];
  if (input.view.visibleReviewCount > events.filter(Boolean).length) return false;
  return input.acceptanceEventIds.every((eventId) => events.some((event) => event?.eventId === eventId && event.outcome === "completed"));
}

export function deriveLoopPlusDecisionContract(
  input: LoopPlusDecisionContractInput,
): LoopPlusDecisionContract {
  const availableSlots = Math.max(0, input.maxConcurrency - input.view.running.length);
  if (input.reportOnly) {
    return { statuses: ["wait"], completionEligible: false, availableSlots };
  }

  const statuses: LoopPlusDecisionStatus[] = [];
  if (input.acceptanceEventIds.length > 0) {
    statuses.push("accept");
    if (input.allowDispatchBeforeReview && availableSlots > 0) statuses.push("dispatch");
  } else {
    const hasInterruptedWork = input.view.running.some(record => input.interruptedSubtaskIds?.includes(record.subtaskId));
    if ((availableSlots > 0 || hasInterruptedWork) && input.view.phase !== "stopped" && input.view.phase !== "completed") statuses.push("dispatch");
    const waitingCanAdvance = input.view.running.length > 0
      || (input.view.pending.length > 0 && !input.view.dependencyBlocks?.length);
    const reportsCanAdvance = input.reportEventIds.length > 0
      && (!input.view.dependencyBlocks?.length || input.view.visibleReviewCount > 0);
    if (!hasInterruptedWork && (waitingCanAdvance || reportsCanAdvance)) {
      statuses.push("wait");
    }
    if (input.view.running.length > 0 || input.view.pending.length > 0 || input.interruptedSubtaskIds?.length) {
      statuses.push("steer");
    }
  }
  statuses.push("blocked", "clarify");
  const completionEligible = isCompletionEligible(input);
  if (completionEligible) statuses.push("completed");
  return { statuses, completionEligible, availableSlots };
}
