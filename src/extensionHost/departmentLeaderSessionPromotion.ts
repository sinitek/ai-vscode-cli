import type { CliName } from "../cli/types";
import { normalizeDepartmentMetadata } from "../department";
import { isLocalSessionId } from "../interactive/sessionHistoryRepair";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { LoopTaskRole, TaskRunRecord } from "../promptRunState";
import { departmentLifecycleDiagnostic, type DepartmentLifecycleReason, type DepartmentLifecycleStage } from "./departmentlifecyclediagnostics";

type SessionContext = { taskRole?: LoopTaskRole | null; loopTaskId?: string | null };
type PromotionDeps = {
  workspaceKey: string;
  readTask: (taskId: string) => LoopTaskRecord | null;
  bindTask: (taskId: string, sessionId: string) => LoopTaskRecord | null;
  readContext: (cli: CliName, sessionId: string) => SessionContext;
};

export function isDepartmentLeaderMainContext(context: SessionContext, taskId: string): boolean {
  return context.taskRole === "main" && context.loopTaskId === taskId;
}

export function canPromoteDepartmentLeaderSession(task: LoopTaskRecord, sessionId: string, workspaceKey: string): boolean {
  const metadata = task.departmentInvalid ? null : normalizeDepartmentMetadata(task.department);
  return metadata?.role === "leader" && metadata.executionMode === "loop-plus"
    && task.schedulingMode === "event_driven" && task.workspaceKey === workspaceKey
    && task.cli === metadata.routes.leader.cli && task.originProfile?.configId === metadata.routes.leader.configId
    && !!task.sessionId && isLocalSessionId(task.sessionId) && !!sessionId.trim() && !isLocalSessionId(sessionId);
}

function promotionDiagnostic(task: LoopTaskRecord, stage: DepartmentLifecycleStage, reason: DepartmentLifecycleReason): void {
  departmentLifecycleDiagnostic("department-leader-session-promotion", {
    rootTaskId: task.department?.rootTaskId ?? task.id, leaderTaskId: task.id,
    stage, result: reason === "none" ? "confirmed" : "unconfirmed", reason,
  });
}

export function commitDepartmentLeaderSessionPromotion(task: LoopTaskRecord, sessionId: string, deps: PromotionDeps): LoopTaskRecord | null {
  if (!canPromoteDepartmentLeaderSession(task, sessionId, deps.workspaceKey)) {
    promotionDiagnostic(task, "identity", "evidence-rejected");
    return null;
  }
  if (!isDepartmentLeaderMainContext(deps.readContext(task.cli, sessionId), task.id)) {
    promotionDiagnostic(task, "transcript-verify", "evidence-rejected");
    return null;
  }
  const current = deps.readTask(task.id);
  if (!current || current.sessionId !== task.sessionId || current.status !== task.status
    || current.taskStoreFile !== task.taskStoreFile || current.cli !== task.cli
    || !canPromoteDepartmentLeaderSession(current, sessionId, deps.workspaceKey)) {
    promotionDiagnostic(task, "identity", "identity-changed");
    return null;
  }
  if (!deps.bindTask(task.id, sessionId)) {
    promotionDiagnostic(task, "binding-write", "persistence-failed");
    return null;
  }
  const saved = deps.readTask(task.id);
  const confirmed = saved && saved.id === task.id && saved.workspaceKey === task.workspaceKey && saved.cli === task.cli
    && saved.taskStoreFile === task.taskStoreFile && saved.status === task.status && saved.sessionId === sessionId ? saved : null;
  promotionDiagnostic(task, "binding-readback", confirmed ? "none" : "persistence-failed");
  return confirmed;
}

export function repairIdleDepartmentLeaderSession(task: LoopTaskRecord, deps: PromotionDeps & {
  readRuns: () => readonly TaskRunRecord[];
  isTargetAvailable: (cli: CliName, sessionId: string, taskId: string) => boolean;
}): LoopTaskRecord | null {
  if ((task.status !== "stopped" && task.status !== "needs-review") || !task.sessionId || !isLocalSessionId(task.sessionId)) return task;
  const runs = deps.readRuns();
  let run: TaskRunRecord | undefined;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const record = runs[index];
    if (record.taskRole === "main" && record.loopTaskId === task.id) { run = record; break; }
  }
  if (!run?.sessionId || run.sessionId === task.sessionId) {
    promotionDiagnostic(task, "run-evidence", "evidence-missing");
    return task;
  }
  if (run.cli !== task.cli || run.startedAt < task.createdAt || (task.status === "needs-review" && run.status !== "end")
    || !canPromoteDepartmentLeaderSession(task, run.sessionId, deps.workspaceKey)) {
    promotionDiagnostic(task, "run-evidence", "evidence-rejected");
    return null;
  }
  const oldContext = deps.readContext(task.cli, task.sessionId);
  if ((oldContext.loopTaskId || oldContext.taskRole) && !isDepartmentLeaderMainContext(oldContext, task.id)) {
    promotionDiagnostic(task, "transcript-verify", "identity-changed");
    return null;
  }
  if (!deps.isTargetAvailable(task.cli, run.sessionId, task.id)) {
    promotionDiagnostic(task, "target-availability", "evidence-rejected");
    return null;
  }
  return commitDepartmentLeaderSessionPromotion(task, run.sessionId, deps);
}
