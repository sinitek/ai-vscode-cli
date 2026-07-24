import type { TaskRunStatus } from "./promptRunState";

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
