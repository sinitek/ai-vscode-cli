import { setTimeout as delay } from "timers/promises";
import { OrdinaryUpdateIdentityLockBusy, OrdinaryUpdateVersionChanged, type LoopSubtaskRecord, type LoopTaskRecord } from "./loopTaskStore";
import { createLoopPlusScheduler, type LoopPlusSchedulerSnapshot } from "./loopPlusScheduler";
import { loopPlusIdentityRetryDelaysMs, sameLoopPlusMainParent } from "./extensionHost/loopPlusMainAdmission";
import type { LoopPlusOrchestrationDeps } from "./extensionHost/loopPlusOrchestration";

export function projectLaunchReservations(parent: LoopTaskRecord, snapshot: LoopPlusSchedulerSnapshot, subtasks: LoopSubtaskRecord[]): void {
  if (!snapshot.pending.length && !snapshot.running.length) return;
  const previous = new Map(parent.subTasks.map(task => [task.id, task.launchReservation]));
  let known: Set<string> | undefined;
  const open = new Map([...snapshot.pending, ...snapshot.running].map(attempt => [attempt.subtaskId, attempt.attemptId]));
  for (const task of subtasks) {
    const attemptId = open.get(task.id);
    if (!attemptId) continue;
    const reservation = previous.get(task.id);
    if (reservation?.attemptId === attemptId) task.launchReservation = reservation;
    else {
      if (!known) {
        const prior = parent.loopPlus ? createLoopPlusScheduler({ snapshot: parent.loopPlus }).snapshot() : undefined;
        known = new Set(prior?.seenAttempts.map(attempt => attempt.attemptId));
      }
      if (!known.has(attemptId)) task.launchReservation = { attemptId, state: "waiting" };
    }
  }
}

export async function claimOrdinaryLaunch(expected: LoopTaskRecord, subtaskId: string, attemptId: string, signal: AbortSignal,
  read: LoopPlusOrchestrationDeps["readTask"], commit: NonNullable<LoopPlusOrchestrationDeps["commitOrdinaryRun"]>): Promise<boolean> {
  for (let retry = 0; !signal.aborted; retry++) {
    let busy = false;
    const parent = read(expected.id, { onUnavailable: reason => { busy = reason === "identity-lock-present"; } });
    if (parent) {
      if (!sameLoopPlusMainParent(expected, parent) || parent.department || parent.departmentInvalid || parent.status !== "running"
        || parent.runtimeInterrupted || parent.userStopSource || parent.pendingClarification || parent.loopPlusBlockReview || !parent.loopPlus) return false;
      const snapshot = createLoopPlusScheduler({ snapshot: parent.loopPlus }).snapshot();
      if (snapshot.parentStopped || snapshot.completed || !snapshot.running.some(item => item.attemptId === attemptId && item.subtaskId === subtaskId)) return false;
      const reservation = parent.subTasks.find(task => task.id === subtaskId)?.launchReservation;
      if (reservation?.attemptId !== attemptId || reservation.state !== "waiting") return false;
      const subTasks = parent.subTasks.map(task => task.id === subtaskId ? { ...task, launchReservation: { attemptId, state: "claimed" as const } } : task);
      try {
        const saved = commit(parent, { subTasks });
        if (saved) return saved.subTasks.some(task => task.id === subtaskId && task.launchReservation?.attemptId === attemptId && task.launchReservation.state === "claimed");
        const current = read(expected.id, { onUnavailable: reason => { busy = reason === "identity-lock-present"; } });
        if (!busy && (!current || current.updatedAt === parent.updatedAt)) return false;
      } catch (error) {
        if (!(error instanceof OrdinaryUpdateIdentityLockBusy || error instanceof OrdinaryUpdateVersionChanged)) throw error;
      }
    } else if (!busy) return false;
    const wait = loopPlusIdentityRetryDelaysMs[Math.min(retry, loopPlusIdentityRetryDelaysMs.length - 1)];
    try { await delay(wait, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  }
  return false;
}
