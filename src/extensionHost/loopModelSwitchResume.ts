import type { LoopSubtaskRecord, LoopTaskRecord } from "../loopTaskStore";
import type { TaskRunStatus } from "../promptRunState";
import { shouldWakeLoopMainAfterSubtaskCompletion } from "../loopSubtaskLifecycle";
import { buildLoopSubtaskExecutionPlan } from "../loopParallel";

export type LoopModelSwitchResumeDeps = {
  readTask: (taskId: string) => LoopTaskRecord | null;
  updateTask: (taskId: string, patch: Partial<LoopTaskRecord>) => LoopTaskRecord | null;
  resumeEventDrivenSubtasks: (taskId: string) => boolean;
  hasClassicController: (taskId: string) => boolean;
  waitForClassicIdle: (taskId: string) => Promise<void>;
  isSubtaskRunning: (taskId: string, subtaskId: string) => boolean;
  runClassicSubtask: (task: LoopTaskRecord, subtask: LoopSubtaskRecord) => Promise<TaskRunStatus>;
  onError: (error: unknown) => void;
};

export function createLoopModelSwitchResumeCoordinator(deps: LoopModelSwitchResumeDeps) {
  const resumingTasks = new Set<string>();

  function resume(taskId: string, resumeMain: () => void): boolean {
    const task = deps.readTask(taskId);
    if (!task || task.status === "completed") return true;
    if (task.schedulingMode === "event_driven") return deps.resumeEventDrivenSubtasks(taskId);
    if (resumingTasks.has(taskId)) return true;
    const activeIds = new Set(task.activeSubtaskIds ?? (task.activeSubtaskId ? [task.activeSubtaskId] : []));
    const subtasks = task.subTasks.filter((subtask) => (
      (subtask.status === "running" || subtask.status === "blocked" || (subtask.status === "pending" && activeIds.has(subtask.id)))
      && !deps.isSubtaskRunning(taskId, subtask.id)
    ));
    if (!subtasks.length) {
      return deps.hasClassicController(taskId) || task.subTasks.some((subtask) => deps.isSubtaskRunning(taskId, subtask.id));
    }
    subtasks.forEach((subtask) => activeIds.add(subtask.id));
    const updated = deps.updateTask(taskId, {
      status: "running",
      activeSubtaskId: [...activeIds][0] ?? null,
      activeSubtaskIds: [...activeIds],
      updatedAt: Date.now(),
    });
    if (!updated) throw new Error("任务恢复失败，请刷新后重试。");
    resumingTasks.add(taskId);
    void (async () => {
      try {
        for (const group of buildLoopSubtaskExecutionPlan(subtasks).groups) {
          if (deps.readTask(taskId)?.status !== "running") return;
          const results = await Promise.all(group.map((subtask) => deps.runClassicSubtask(updated, subtask)));
          if (results.some((status) => status !== "end")) return;
        }
        await deps.waitForClassicIdle(taskId);
        const latest = deps.readTask(taskId);
        if (latest
          && shouldWakeLoopMainAfterSubtaskCompletion(latest)
          && !deps.hasClassicController(taskId)
          && !latest.subTasks.some((subtask) => deps.isSubtaskRunning(taskId, subtask.id))) {
          resumeMain();
        }
      } catch (error) {
        deps.onError(error);
      } finally {
        resumingTasks.delete(taskId);
      }
    })();
    return true;
  }

  return { resume };
}
