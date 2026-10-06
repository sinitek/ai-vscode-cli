export const CONVERSATION_TAB_RUNNING_FLOW_CHECK_INTERVAL_MS = 60_000;

export type ConversationTabRunningFlowTask = {
  id: string;
  status: string;
  loopPlus?: ConversationTabRunningFlowLoopPlus | null;
};

export type ConversationTabRunningFlowLoopPlus = {
  completed?: boolean;
  wakePending?: boolean;
  currentReview?: unknown;
  running?: readonly unknown[];
  pending?: readonly unknown[];
  reviewQueue?: readonly unknown[];
  userMessageQueue?: readonly unknown[];
};

export type ConversationTabRunningFlowRun = {
  loopTaskId?: string | null;
};

export type ConversationTabRunningFlowCheck = {
  tabId: string;
  task: ConversationTabRunningFlowTask | null;
  activeRun: ConversationTabRunningFlowRun | null;
};

const FINISHED_LOOP_TASK_STATUSES = new Set(["completed", "stopped", "error", "needs-review"]);

export function readConversationTabRunningFlowLoopPlus(
  value: unknown,
): ConversationTabRunningFlowLoopPlus | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    completed: record.completed === true,
    wakePending: record.wakePending === true,
    currentReview: record.currentReview ?? null,
    running: Array.isArray(record.running) ? record.running : [],
    pending: Array.isArray(record.pending) ? record.pending : [],
    reviewQueue: Array.isArray(record.reviewQueue) ? record.reviewQueue : [],
    userMessageQueue: Array.isArray(record.userMessageQueue) ? record.userMessageQueue : [],
  };
}

function hasOutstandingLoopPlusWork(task: ConversationTabRunningFlowTask): boolean {
  const loopPlus = task.loopPlus;
  if (!loopPlus) {
    return false;
  }
  return loopPlus.wakePending === true
    || Boolean(loopPlus.currentReview)
    || (loopPlus.running?.length ?? 0) > 0
    || (loopPlus.pending?.length ?? 0) > 0
    || (loopPlus.reviewQueue?.length ?? 0) > 0
    || (loopPlus.userMessageQueue?.length ?? 0) > 0;
}

export function isLoopTaskFinishedForRunningFlow(task: ConversationTabRunningFlowTask): boolean {
  if (hasOutstandingLoopPlusWork(task)) {
    return false;
  }
  return FINISHED_LOOP_TASK_STATUSES.has(task.status);
}

export function shouldClearConversationTabRunningFlow(
  check: ConversationTabRunningFlowCheck,
): boolean {
  const tabId = check.tabId.trim();
  if (!tabId) {
    return false;
  }
  if (!check.task) {
    return check.activeRun == null;
  }
  if (!isLoopTaskFinishedForRunningFlow(check.task)) {
    return false;
  }
  if (!check.activeRun) {
    return true;
  }
  if (check.task.status !== "completed") {
    return false;
  }
  const runTaskId = typeof check.activeRun.loopTaskId === "string"
    ? check.activeRun.loopTaskId.trim()
    : "";
  if (!runTaskId) {
    return false;
  }
  return runTaskId === check.task.id;
}

function hasActiveLoopTaskRun(check: ConversationTabRunningFlowCheck): boolean {
  const loopTaskId = typeof check.activeRun?.loopTaskId === "string"
    ? check.activeRun.loopTaskId.trim()
    : "";
  return loopTaskId.length > 0;
}

export function shouldStartConversationTabRunningFlow(
  check: ConversationTabRunningFlowCheck,
): boolean {
  const tabId = check.tabId.trim();
  if (!tabId || !hasActiveLoopTaskRun(check)) {
    return false;
  }
  return !shouldClearConversationTabRunningFlow(check);
}

export function selectActiveConversationTabRunningFlowIds(
  checks: readonly ConversationTabRunningFlowCheck[],
): string[] {
  return checks
    .filter((check) => shouldStartConversationTabRunningFlow(check))
    .map((check) => check.tabId);
}

export function selectStaleConversationTabRunningFlowIds(
  checks: readonly ConversationTabRunningFlowCheck[],
): string[] {
  return checks
    .filter((check) => shouldClearConversationTabRunningFlow(check))
    .map((check) => check.tabId);
}
