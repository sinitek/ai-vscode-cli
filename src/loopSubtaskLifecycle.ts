import type { TaskRunStatus } from "./promptRunState";
import type { LoopTaskRecord } from "./loopTaskStore";
import type { LoopSubtaskConversationContext } from "./loopConversationPresentation";
import { loopSubtaskAutoCompactions } from "./loopSubtaskAutoCompact";
import { logError } from "./logger";

export type LoopSubtaskCompletionOptions = LoopSubtaskConversationContext & {
  runStatus: TaskRunStatus;
  assistantContent: string | null;
  failureDetail?: string;
  tabId: string | null;
};

export type LoopSubtaskReportResult = "committed" | "missing" | "skipped" | "unconfirmed";

export type LoopSubtaskTabCloseOptions = { completed?: boolean; expected?: LoopSubtaskConversationContext };

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
    failureDetail?: string,
  ) => LoopSubtaskReportResult;
  closeSubtaskTab: (tabId: string) => Promise<void>;
  prepareSubtaskTabClose?: (tabId: string, options?: LoopSubtaskTabCloseOptions) => () => Promise<void>;
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
    attemptId,
    runStatus,
    assistantContent,
    tabId,
  } = options;
  let closeTab: (() => Promise<void>) | undefined;
  try {
    if (runStatus === "end" && tabId) {
      closeTab = deps.prepareSubtaskTabClose?.(tabId, { completed: true, expected: { taskId, round, subtaskId, attemptId } })
        ?? (() => deps.closeSubtaskTab(tabId));
    }
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
    const report = deps.markSubtaskRunFinished(taskId, subtaskId, runStatus, assistantContent, options.failureDetail);
    reported = runStatus === "end" && report === "committed";
  } finally {
    cleanup = loopSubtaskAutoCompactions.notify(taskId, subtaskId, reported, reported ? closeCompletedTab : undefined);
  }

  if (runStatus !== "end" || !tabId) {
    return;
  }

  if (reported && !cleanup) await closeCompletedTab();
}

export function shouldDelegateSubtaskContinuationToLoopPlus(
  task: { schedulingMode?: unknown } | null | undefined,
): boolean {
  return task?.schedulingMode === "event_driven";
}
