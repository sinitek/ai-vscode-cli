import type { TaskRunStatus } from "./promptRunState";

export type LobsterSubtaskCompletionOptions = {
  taskId: string;
  round: number;
  subtaskId: string;
  runStatus: TaskRunStatus;
  assistantContent: string | null;
  tabId: string | null;
};

export type LobsterSubtaskTabAutoClosedEvent = {
  taskId: string;
  round: number;
  subtaskId: string;
  tabId: string;
};

export type LobsterSubtaskCompletionDeps = {
  markSubtaskRunFinished: (
    taskId: string,
    subtaskId: string,
    runStatus: TaskRunStatus,
    assistantContent: string | null,
  ) => void;
  shouldAutoCloseSubtaskTab: () => boolean;
  closeSubtaskTab: (tabId: string) => Promise<void>;
  logSubtaskTabAutoClosed: (event: LobsterSubtaskTabAutoClosedEvent) => void;
};

/**
 * Applies the shared terminal cleanup for automatic retries and manual resumes.
 */
export async function finalizeLobsterSubtaskRun(
  options: LobsterSubtaskCompletionOptions,
  deps: LobsterSubtaskCompletionDeps,
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

  if (runStatus !== "end" || !tabId || !deps.shouldAutoCloseSubtaskTab()) {
    return;
  }

  await deps.closeSubtaskTab(tabId);
  deps.logSubtaskTabAutoClosed({ taskId, round, subtaskId, tabId });
}
