import type { TaskRunStatus } from "./promptRunState";
import type { LoopTaskRecord } from "./loopTaskStore";
import { loopSubtaskAutoCompactions } from "./loopSubtaskAutoCompact";
import { logError } from "./logger";

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
  prepareSubtaskTabClose?: (tabId: string) => () => Promise<void>;
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
  let closeTab: (() => Promise<void>) | undefined;
  try {
    closeTab = tabId ? deps.prepareSubtaskTabClose?.(tabId) ?? (() => deps.closeSubtaskTab(tabId)) : undefined;
  } catch (error) {
    closeTab = async () => { throw error; };
  }
  const closeCompletedTab = async (): Promise<void> => {
    if (!tabId || !closeTab) return;
    try {
      await closeTab();
      deps.logSubtaskTabAutoClosed({ taskId, round, subtaskId, tabId });
    } catch (error) {
      await logError("loop-subtask-tab-auto-close-error", { taskId, round, subtaskId, tabId,
        error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    }
  };
  let reported = false;
  let cleanup: Promise<void> | undefined;
  try {
    deps.markSubtaskRunFinished(taskId, subtaskId, runStatus, assistantContent);
    reported = runStatus === "end";
  } finally {
    cleanup = loopSubtaskAutoCompactions.notify(taskId, subtaskId, reported, closeCompletedTab);
  }

  if (runStatus !== "end" || !tabId) {
    return;
  }

  if (!cleanup) await closeCompletedTab();
}

export function shouldDelegateSubtaskContinuationToLoopPlus(
  task: { schedulingMode?: unknown } | null | undefined,
): boolean {
  return task?.schedulingMode === "event_driven";
}
