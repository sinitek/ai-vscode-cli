import type { LoopTaskRecord } from "./loopTaskStore";
import { buildLoopPlusFinishEventId, type LoopPlusSeenAttempt, type LoopPlusSchedulerSnapshot, createLoopPlusScheduler } from "./loopPlusScheduler";

/** Organization delivery settlement only. This never proves cleanup or returns capacity. */
export function isDepartmentLeaderCompleted(task: LoopTaskRecord | null): boolean {
  try { return completed(task); } catch { return false; }
}

function completed(task: LoopTaskRecord | null): boolean {
  const snapshot = task?.loopPlus as LoopPlusSchedulerSnapshot | undefined;
  if (snapshot) createLoopPlusScheduler({ snapshot });
  if (!task || task.status !== "completed" || !snapshot?.completed || snapshot.parentStopped
    || snapshot.running.length || snapshot.pending.length || snapshot.reportQueue?.length || snapshot.reviewQueue.length || snapshot.currentReview
    || snapshot.userMessageQueue.length || task.pendingClarification
    || !task.completionRequirementCoverage.length || !task.completionRequirementCoverage.every((item) => item.passed === true)) return false;
  const tasks = new Map(task.subTasks.map((item) => [item.id, item]));
  if (tasks.size !== task.subTasks.length) return false;
  const latest = new Map<string, { attempt: LoopPlusSeenAttempt; index: number }>();
  const attempts = new Set<string>();
  for (let index = 0; index < snapshot.seenAttempts.length; index++) {
    const attempt = snapshot.seenAttempts[index];
    if (!tasks.has(attempt.subtaskId) || attempts.has(attempt.attemptId)) return false;
    attempts.add(attempt.attemptId); latest.set(attempt.subtaskId, { attempt, index });
  }
  if (latest.size !== tasks.size) return false;
  const children = new Map<string, string[]>();
  for (const item of tasks.values()) {
    const source = item.repairSource;
    if (!source) continue;
    const origin = latest.get(source.subtaskId), successor = latest.get(item.id);
    // Strict ordering makes cycles impossible and bounds resolution to one pass per edge.
    if (!origin || !successor || origin.index >= successor.index
      || origin.attempt.attemptId !== source.attemptId || origin.attempt.disposition !== "reviewed"
      || origin.attempt.acceptance !== "failed"
      || source.finishEventId !== buildLoopPlusFinishEventId(source.subtaskId, source.attemptId)) return false;
    const list = children.get(source.subtaskId) ?? []; list.push(item.id); children.set(source.subtaskId, list);
  }
  const settled = new Set<string>();
  // Map insertion order follows first attempts, so explicitly use latest chronological order.
  const ordered = [...latest.entries()].sort((a, b) => b[1].index - a[1].index);
  for (const [id, { attempt }] of ordered) {
    const subtask = tasks.get(id)!;
    if (attempt.disposition === "reported") {
      if (attempt.requiresAcceptance !== false || subtask.requiresAcceptance !== false || subtask.repairSource
        || attempt.outcome !== "completed" || subtask.status !== "completed") return false;
      settled.add(id);
      continue;
    }
    if (attempt.disposition !== "reviewed") return false;
    if (attempt.acceptance === "passed") {
      if (attempt.outcome !== "completed" || subtask.status !== "completed") return false;
      settled.add(id);
    } else {
      const repairs = children.get(id);
      if (attempt.acceptance !== "failed" || !repairs?.length || !repairs.every((repair) => settled.has(repair))) return false;
      settled.add(id);
    }
  }
  return settled.size === tasks.size;
}
