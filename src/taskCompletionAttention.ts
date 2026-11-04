import type { HumanInteractionAttentionController } from "./humanInteractionAttention";
import type { LoopTaskRecord } from "./loopTaskStore";
import type { TaskRunRecord } from "./promptRunState";

export function notifyTaskRunCompletion(
  controller: HumanInteractionAttentionController | undefined,
  record: TaskRunRecord,
): void {
  if (record.status !== "end" || record.taskRole || record.loopTaskId
    || record.loopSubtaskId || record.loopRound !== undefined) {
    return;
  }
  void controller?.taskCompleted(`vibe:${record.id}`);
}

export function notifyLoopTaskCompletion(
  controller: HumanInteractionAttentionController | undefined,
  task: Pick<LoopTaskRecord, "id" | "status"> & Partial<Pick<LoopTaskRecord, "updatedAt">>,
): void {
  if (task.status === "completed") {
    const completionId = task.updatedAt === undefined ? `loop:${task.id}` : `loop:${task.id}:${task.updatedAt}`;
    void controller?.taskCompleted(completionId);
  }
}
