import type { TaskRunStatus } from "./promptRunState";
import type { LoopTaskRecord } from "./loopTaskStore";

export type LoopSubtaskCompletionOptions = {
  taskId: string;
  round: number;
  subtaskId: string;
  runStatus: TaskRunStatus;
  assistantContent: string | null;
  tabId: string | null;
};

export type LoopSubtaskTabAutoClosedEvent = {
  taskId: string;
  round: number;
  subtaskId: string;
  tabId: string;
};

export type LoopSubtaskCompletionDeps = {
  markSubtaskRunFinished: (
    taskId: string,
    subtaskId: string,
    runStatus: TaskRunStatus,
    assistantContent: string | null,
  ) => void;
  closeSubtaskTab: (tabId: string) => Promise<void>;
  logSubtaskTabAutoClosed: (event: LoopSubtaskTabAutoClosedEvent) => void;
};

/**
 * A stopped subtask leaves the parent Loop task waiting until that subtask is
 * continued successfully. The parent must not be woken while any subtask id
 * remains active, even when the parent runtime owner has already released.
 */
export function shouldWakeLoopMainAfterSubtaskCompletion(
  task: Pick<LoopTaskRecord, "status" | "activeSubtaskIds" | "mainAiFailureCount" | "mainAiFailureLimitReached">,
): boolean {
  return task.status === "running"
    && (task.activeSubtaskIds?.length ?? 0) === 0
    && task.mainAiFailureLimitReached !== true;
}

/**
 * Applies the shared terminal cleanup for automatic retries and manual resumes.
 */
export async function finalizeLoopSubtaskRun(
  options: LoopSubtaskCompletionOptions,
  deps: LoopSubtaskCompletionDeps,
): Promise<void> {
  const {
    taskId,
    round,
    subtaskId,
    runStatus,
    assistantContent,
    tabId,
  } = options;
  deps.markSubtaskRunFinished(taskId, subtaskId, runStatus, assistantContent);

  if (runStatus !== "end" || !tabId) {
    return;
  }

  await deps.closeSubtaskTab(tabId);
  deps.logSubtaskTabAutoClosed({ taskId, round, subtaskId, tabId });
}
