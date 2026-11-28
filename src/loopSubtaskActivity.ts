import type { TaskRunDraft } from "./promptRunState";
import { createLoopPlusScheduler } from "./loopPlusScheduler";
import type { LoopTaskRecord } from "./loopTaskStore";
import { getActiveLoopSubtaskIds } from "./extensionHost/loopTaskStateMachine";

export type LiveLoopSubtaskRun = Pick<TaskRunDraft, "taskRole" | "loopTaskId" | "loopSubtaskId" | "loopAttemptId" | "loopRound" | "startedAt"> & { stopped?: boolean };

export function projectLiveLoopSubtasks(task: LoopTaskRecord, runs: readonly LiveLoopSubtaskRun[] = []): LoopTaskRecord {
  if (!runs.length || !(task.status === "running" || (task.status === "stopped" && task.runtimeInterrupted && !task.userStopSource))) return task;
  const blockedIds = new Set(task.subTasks.filter(member => member.status === "blocked").map(member => member.id));
  type MemberRun = LiveLoopSubtaskRun & { loopSubtaskId: string };
  const live = runs.filter((run): run is MemberRun => run.taskRole === "subtask" && run.loopTaskId === task.id
    && typeof run.loopSubtaskId === "string" && blockedIds.has(run.loopSubtaskId) && !run.stopped);
  if (!live.length) return task;
  let matches: (run: MemberRun) => boolean;
  if (task.schedulingMode === "event_driven") {
    if (!task.loopPlus) return task;
    try {
      const snapshot = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
      if (snapshot.completed || snapshot.parentStopped) return task;
      matches = run => {
        const open = snapshot.running.find(attempt => attempt.subtaskId === run.loopSubtaskId);
        if (!open) return false;
        if (run.loopAttemptId) return run.loopAttemptId === open.attemptId;
        return snapshot.seenAttempts.filter(seen => seen.subtaskId === run.loopSubtaskId).length === 1;
      };
    } catch {
      return task;
    }
  } else {
    const activeIds = getActiveLoopSubtaskIds(task);
    matches = run => !run.loopAttemptId && run.loopRound === task.currentRound && activeIds.includes(run.loopSubtaskId);
  }
  const startedByMember = new Map<string, number>();
  for (const run of live) {
    if (matches(run)) startedByMember.set(run.loopSubtaskId, Math.max(startedByMember.get(run.loopSubtaskId) ?? 0, run.startedAt));
  }
  if (!startedByMember.size) return task;
  return { ...task, subTasks: task.subTasks.map(member => {
    const lastStartedAt = startedByMember.get(member.id);
    return lastStartedAt !== undefined ? { ...member, status: "running", lastStartedAt } : member;
  }) };
}
