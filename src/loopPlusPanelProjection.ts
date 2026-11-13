import { resolveLoopSchedulingMode, type LoopTaskRecord } from "./loopTaskStore";
import { createLoopPlusScheduler, type LoopPlusExecutionRecord, type LoopPlusReviewItem, type LoopPlusSchedulerPhase } from "./loopPlusScheduler";
import type { LoopPlusPanelProjection } from "./webview/loopGroupChatPanelTypes";

export function projectLoopPlusPanel(
  task: Pick<LoopTaskRecord, "schedulingMode" | "loopPlus" | "status" | "loopPlusMainPhase"> & {
    subTasks?: LoopTaskRecord["subTasks"];
  },
): LoopPlusPanelProjection | null {
  if (resolveLoopSchedulingMode(task.schedulingMode) !== "event_driven") {
    return null;
  }
  if (task.loopPlus === undefined || task.loopPlus === null) {
    return invalidLoopPlusProjection("missing");
  }
  try {
    const scheduler = createLoopPlusScheduler({ snapshot: task.loopPlus });
    const snapshot = scheduler.snapshot();
    const view = scheduler.wait().view;
    const currentReview = view.currentReview ? copyLoopPlusReviewItem(view.currentReview) : null;
    const reviewQueue = view.reviewQueue.map(copyLoopPlusReviewItem);
    const currentReviewCount = currentReview ? 1 : 0;
    const reviewQueueCount = reviewQueue.length;
    if (view.visibleReviewCount !== currentReviewCount + reviewQueueCount) {
      return invalidLoopPlusProjection("visibleReviewCount");
    }
    const activity = loopPlusActivityForPhase(view.phase, task.status);
    const running = view.running.map((item) => ({
      ...copyLoopPlusExecutionItem(item),
      ...(task.subTasks?.some((subtask) => subtask.id === item.subtaskId && subtask.status === "blocked")
        ? { interrupted: true }
        : {}),
    }));
    return {
      ok: true,
      schedulingMode: "event_driven",
      activity: isLoopPlusDecomposing(task, activity, view, snapshot) ? "decomposing" : activity,
      phase: view.phase,
      wakePending: snapshot.wakePending,
      currentReview,
      reviewQueue,
      currentReviewCount,
      reviewQueueCount,
      visibleReviewCount: view.visibleReviewCount,
      running,
      pending: view.pending.map(copyLoopPlusExecutionItem),
      runningCount: running.filter((item) => !item.interrupted).length,
      pendingCount: view.pending.length,
      seenAttempts: snapshot.seenAttempts.map((item) => {
        const recordedStatus = task.subTasks?.find((subtask) => subtask.id === item.subtaskId)?.status;
        return {
          subtaskId: item.subtaskId,
          attemptId: item.attemptId,
          disposition: item.disposition,
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
  recordedAcceptance?: "passed" | "failed",
): "passed" | "failed" {
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

