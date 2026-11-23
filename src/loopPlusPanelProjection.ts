import { resolveLoopSchedulingMode, type LoopTaskRecord } from "./loopTaskStore";
import { createLoopPlusScheduler, requiresLoopPlusAcceptedDependencies, type LoopPlusExecutionRecord, type LoopPlusReviewItem, type LoopPlusSchedulerPhase } from "./loopPlusScheduler";
import { getLoopSubtaskDisplayTitle } from "./loopConversationPresentation";
import type { LoopPlusPanelProjection } from "./webview/loopGroupChatPanelTypes";

export function projectLoopPlusPanel(
  task: Pick<LoopTaskRecord, "schedulingMode" | "loopPlus" | "status" | "runtimeInterrupted" | "loopPlusMainPhase" | "department" | "departmentInvalid"> & {
    subTasks?: LoopTaskRecord["subTasks"];
  },
  activeReviewEventIds: readonly string[] = [],
  mainModelRunning = false,
  localExecutionInactive = false,
): LoopPlusPanelProjection | null {
  if (resolveLoopSchedulingMode(task.schedulingMode) !== "event_driven") {
    return null;
  }
  if (task.loopPlus === undefined || task.loopPlus === null) {
    return invalidLoopPlusProjection("missing");
  }
  try {
    const scheduler = createLoopPlusScheduler({ snapshot: task.loopPlus, requireAcceptedDependencies: requiresLoopPlusAcceptedDependencies(task) });
    const snapshot = scheduler.snapshot();
    const view = scheduler.wait().view;
    const latestAttempts = new Map<string, (typeof snapshot.seenAttempts)[number]>();
    const repairAttemptIds = new Set<string>();
    for (const attempt of snapshot.seenAttempts) {
      const previous = latestAttempts.get(attempt.subtaskId);
      if (previous?.disposition === "reviewed" && previous.acceptance === "failed") {
        repairAttemptIds.add(attempt.attemptId);
      }
      latestAttempts.set(attempt.subtaskId, attempt);
    }
    const projectReview = (item: LoopPlusReviewItem) => ({
      ...copyLoopPlusReviewItem(item),
      ...(repairAttemptIds.has(item.attemptId) ? { repairing: true } : {}),
    });
    const currentReview = view.currentReview ? projectReview(view.currentReview) : null;
    const reviewQueue = view.reviewQueue.map(projectReview);
    const currentReviewCount = currentReview ? 1 : 0;
    const reviewQueueCount = reviewQueue.length;
    if (view.visibleReviewCount !== currentReviewCount + reviewQueueCount) {
      return invalidLoopPlusProjection("visibleReviewCount");
    }
    const queuedIds = [currentReview?.eventId, ...reviewQueue.map((item) => item.eventId)].filter((id): id is string => Boolean(id));
    const activeBatchMatches = !localExecutionInactive && activeReviewEventIds.length > 0
      && activeReviewEventIds.every((id, index) => queuedIds[index] === id);
    const activeIds = activeBatchMatches ? [...activeReviewEventIds] : [];
    const runtimeInterrupted = task.status === "stopped"
      && task.runtimeInterrupted === true
      && !snapshot.completed
      && !snapshot.parentStopped;
    let activity = runtimeInterrupted ? "paused" : loopPlusActivityForPhase(view.phase, task.status);
    if (activity === "reviewing" && activeIds.length === 0) activity = "review_pending";
    if (localExecutionInactive && task.status === "running" && !snapshot.completed && !snapshot.parentStopped) {
      activity = "paused";
    }
    if (!localExecutionInactive && mainModelRunning && (activity === "idle" || activity === "waiting" || activity === "review_pending")) {
      activity = "running";
    }
    const running = view.running.map((item) => ({
      ...copyLoopPlusExecutionItem(item),
      ...(localExecutionInactive || task.subTasks?.some((subtask) => subtask.id === item.subtaskId && subtask.status === "blocked")
        ? { interrupted: true }
        : repairAttemptIds.has(item.attemptId) ? { repairing: true } : {}),
    }));
    const blockingLabelsByAttempt = new Map<string, string[]>();
    if (view.dependencyBlocks?.length) {
      const subtaskNumbers = new Map(task.subTasks?.map((subtask, index) => [subtask.id, index]));
      for (const { attemptId, dependencyId } of view.dependencyBlocks) {
        const index = subtaskNumbers.get(dependencyId);
        const label = index === undefined ? `任务 ID ${dependencyId}` : getLoopSubtaskDisplayTitle(index, { title: "" });
        const labels = blockingLabelsByAttempt.get(attemptId);
        if (labels) labels.push(label);
        else blockingLabelsByAttempt.set(attemptId, [label]);
      }
    }
    return {
      ok: true,
      schedulingMode: "event_driven",
      activity: isLoopPlusDecomposing(task, activity, view, snapshot) ? "decomposing" : activity,
      phase: view.phase,
      wakePending: snapshot.wakePending,
      currentReview,
      reviewQueue,
      activeReviewEventIds: activeIds,
      currentReviewCount,
      reviewQueueCount,
      visibleReviewCount: view.visibleReviewCount,
      running,
      pending: view.pending.map((item) => {
        const blockingDependencyLabels = blockingLabelsByAttempt.get(item.attemptId);
        return {
          ...copyLoopPlusExecutionItem(item),
          ...(repairAttemptIds.has(item.attemptId) ? { repairing: true } : {}),
          ...(blockingDependencyLabels ? { blockingDependencyLabels } : {}),
        };
      }),
      runningCount: running.filter((item) => !item.interrupted).length,
      pendingCount: view.pending.length,
      seenAttempts: snapshot.seenAttempts.map((item) => {
        const recordedStatus = task.subTasks?.find((subtask) => subtask.id === item.subtaskId)?.status;
        return {
          subtaskId: item.subtaskId,
          attemptId: item.attemptId,
          ...(item.requiresAcceptance !== undefined ? { requiresAcceptance: item.requiresAcceptance } : {}),
          disposition: item.disposition,
          ...(item.acceptanceReason ? { acceptanceReason: item.acceptanceReason } : {}),
          ...(item.noRepairReason ? { noRepairReason: item.noRepairReason } : {}),
          ...(item.outcome ? { outcome: item.outcome } : {}),
          ...(item.disposition === "reviewed"
            ? { acceptance: loopPlusReviewedAcceptance(item.outcome, recordedStatus, item.acceptance) }
            : {}),
        };
      }),
    };
  } catch (error) {
    const reason = error instanceof Error && error.message.trim() ? error.message.trim() : "invalid";
    return invalidLoopPlusProjection(reason);
  }
}

function invalidLoopPlusProjection(error: string): LoopPlusPanelProjection {
  return {
    ok: false,
    schedulingMode: "event_driven",
    activity: "invalid",
    phase: "invalid",
    error,
  };
}

function loopPlusActivityForPhase(
  phase: LoopPlusSchedulerPhase,
  parentStatus: string,
): Extract<LoopPlusPanelProjection, { ok: true }>["activity"] {
  switch (phase) {
    case "stopped":
      return "stopped";
    case "completed":
      return "completed";
    case "waiting":
      return isLoopPlusDisplayPaused(parentStatus) ? "paused" : "waiting";
    case "review_ready":
      return isLoopPlusDisplayPaused(parentStatus) ? "paused" : "review_pending";
    case "reviewing":
      return isLoopPlusDisplayPaused(parentStatus) ? "paused" : "reviewing";
    case "idle":
      return isLoopPlusDisplayPaused(parentStatus) ? "paused" : "idle";
    default: {
      const unexpected: never = phase;
      throw new Error(`Unexpected Loop+ phase: ${unexpected}`);
    }
  }
}

function isLoopPlusDecomposing(
  task: { status: string; loopPlusMainPhase?: string; subTasks?: readonly unknown[] },
  activity: string,
  view: { running: readonly unknown[]; pending: readonly unknown[]; visibleReviewCount: number },
  snapshot: { seenAttempts: readonly unknown[] },
): boolean {
  return task.loopPlusMainPhase === "decomposing"
    && task.status === "running"
    && activity === "idle"
    && view.running.length === 0
    && view.pending.length === 0
    && view.visibleReviewCount === 0
    && snapshot.seenAttempts.length === 0
    && (task.subTasks?.length ?? 0) === 0;
}

function isLoopPlusDisplayPaused(status: string): boolean {
  return status === "needs-review" || status === "error";
}

function loopPlusReviewedAcceptance(
  outcome: "completed" | "failed" | "stopped" | undefined,
  recordedStatus: string | undefined,
  recordedAcceptance?: "passed" | "failed" | "cancelled",
): "passed" | "failed" | "cancelled" {
  if (recordedAcceptance === "cancelled") return "cancelled";
  if (recordedAcceptance === "failed" || outcome === "failed" || outcome === "stopped") {
    return "failed";
  }
  if (recordedAcceptance === "passed" || outcome === "completed") {
    return "passed";
  }
  if (recordedStatus === "blocked") {
    return "failed";
  }
  return "passed";
}

function copyLoopPlusReviewItem(item: LoopPlusReviewItem): Extract<LoopPlusPanelProjection, { ok: true }>["reviewQueue"][number] {
  return {
    eventId: item.eventId,
    subtaskId: item.subtaskId,
    attemptId: item.attemptId,
    outcome: item.outcome,
    detail: item.detail,
  };
}

function copyLoopPlusExecutionItem(
  item: LoopPlusExecutionRecord,
): Extract<LoopPlusPanelProjection, { ok: true }>["running"][number] {
  return {
    subtaskId: item.subtaskId,
    attemptId: item.attemptId,
    title: item.title,
    state: item.state,
  };
}

