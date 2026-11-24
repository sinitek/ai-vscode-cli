import { normalizeDepartmentMetadata } from "../department";
import { isValidDepartmentCapacitySnapshot, type DepartmentCapacitySnapshot } from "../departmentcapacity";
import { getLoopSubtaskDisplayTitle } from "../loopConversationPresentation";
import { resolveLoopPanelProgressPercent, resolveLoopPlusMainMemberStatus, resolveLoopPlusSubtaskMemberStatus } from "../loopGroupChatPanelState";
import { projectLoopPlusPanel } from "../loopPlusPanelProjection";
import { summarizeLoopPlusMembers } from "../loopPlusStatusSummary";
import { normalizeLoopSubtaskProgressWeightPercent, type LoopTaskRecord } from "../loopTaskStore";
import type { DepartmentEmployeeAllocationProjection, DepartmentGroupChatProjection, LoopGroupChatPanelParticipant } from "../webview/loopGroupChatPanelTypes";

export type DepartmentGroupChatReadPort = {
  readTaskRecord(taskId: string): LoopTaskRecord | null;
  readLeaderTaskIds?: DepartmentLeaderOwnershipReader;
  getActiveReviewEventIds?(taskId: string): readonly string[];
  isMainModelRunning?(task: LoopTaskRecord): boolean;
  isLocalExecutionInactive?(task: LoopTaskRecord): boolean;
  /** Read only: absence/failure means unknown, never an empty lease pool. */
  readCapacity?(rootTaskId: string): DepartmentCapacitySnapshot | null;
  readEmployeeAllocation?(rootTaskId: string): DepartmentEmployeeAllocationProjection | null;
  employeeAllocationWritable?: boolean;
};

/** Trusted, exhaustive current membership index, never a browser assertion or a view cache.
 * Central composition must publish create/delete/ownership changes before returning IDs.
 * null (including index invalidation/rebuild) means unavailable and fails authorization closed.
 */
export type DepartmentLeaderOwnershipReader = (rootTaskId: string, leaderSubtaskId: string) => readonly string[] | null;

/** Small fresh authorization query; does not build participants, read capacity or list task stores. */
export function authorizeDepartmentLeader(root: LoopTaskRecord, leader: LoopTaskRecord,
  port: Pick<DepartmentGroupChatReadPort, "readTaskRecord">,
  readOwnership?: DepartmentLeaderOwnershipReader): boolean {
  if (!isDepartmentLeader(root, leader) || !readOwnership) return false;
  try {
    const moduleId = departmentMetadata(leader)!.leaderSubtaskId!;
    const ids = readOwnership(root.id, moduleId);
    if (!Array.isArray(ids) || ids.length !== 1 || ids[0] !== leader.id) return false;
    // Do not trust the index to validate record contents or workspace ownership.
    const current = port.readTaskRecord(ids[0]);
    return Boolean(current && current.id === leader.id && isDepartmentLeader(root, current)
      && departmentMetadata(current)!.leaderSubtaskId === moduleId);
  } catch { return false; }
}

export function departmentMetadata(task: LoopTaskRecord) {
  return task.departmentInvalid ? null : normalizeDepartmentMetadata(task.department);
}

export function resolveDepartmentRoot(task: LoopTaskRecord, port: Pick<DepartmentGroupChatReadPort, "readTaskRecord">): LoopTaskRecord | null {
  const meta = departmentMetadata(task);
  if (!meta || meta.role === "employee") return null;
  const root = meta.role === "director" ? task : port.readTaskRecord(meta.rootTaskId);
  if (!root || root.id !== meta.rootTaskId || !root.workspaceKey || root.workspaceKey !== task.workspaceKey) return null;
  const rootMeta = departmentMetadata(root);
  if (!rootMeta || rootMeta.role !== "director" || rootMeta.rootTaskId !== root.id
    || rootMeta.parentTaskId !== null || rootMeta.leaderSubtaskId !== null) return null;
  return meta.role === "director" || isDepartmentLeader(root, task) ? root : null;
}

function readDepartmentCapacity(rootTaskId: string, port: Pick<DepartmentGroupChatReadPort, "readCapacity">): DepartmentCapacitySnapshot | null {
  try {
    const capacity = port.readCapacity?.(rootTaskId) ?? null;
    return isValidDepartmentCapacitySnapshot(capacity, rootTaskId) ? capacity : null;
  } catch { return null; }
}

/** Read-only organizational control, independent of a host-local model invocation.
 * The reader MUST be the trusted department source, never ordinary task discovery.
 * Unknown capacity retains the stop route; only an exact empty snapshot proves
 * there is no remaining capacity to reconcile. This grants no execution right. */
export function readDepartmentOrganizationControlState(task: LoopTaskRecord, workspaceKey: string,
  port: Pick<DepartmentGroupChatReadPort, "readTaskRecord" | "readCapacity">): { needsCleanup: boolean } | null {
  const state = readDepartmentOrganizationControl(task, workspaceKey, port);
  return state && { needsCleanup: state.needsCleanup };
}

function readDepartmentOrganizationControl(task: LoopTaskRecord, workspaceKey: string,
  port: Pick<DepartmentGroupChatReadPort, "readTaskRecord" | "readCapacity">) {
  const current = port.readTaskRecord(task.id);
  if (!current || !workspaceKey || current.workspaceKey !== workspaceKey || task.workspaceKey !== workspaceKey
    || current.id !== task.id || current.taskStoreFile !== task.taskStoreFile
    || JSON.stringify(current.department) !== JSON.stringify(task.department)
    || current.departmentInvalid !== task.departmentInvalid) return null;
  const root = resolveDepartmentRoot(current, port);
  if (!root || root.id !== current.id) return null;
  const capacity = readDepartmentCapacity(root.id, port);
  return { needsCleanup: !capacity || capacity.leaders.length > 0 || capacity.employees.length > 0,
    capacityKnown: capacity !== null, status: current.status, interrupted: current.runtimeInterrupted === true };
}

export function readDepartmentOrganizationStopFeedback(task: LoopTaskRecord, workspaceKey: string,
  port: Pick<DepartmentGroupChatReadPort, "readTaskRecord" | "readCapacity">,
  result?: import("../webview/loopGroupChatPanelTypes").DepartmentOrganizationStopState) {
  const state = readDepartmentOrganizationControl(task, workspaceKey, port);
  if (!state) return null;
  const stopState: import("../webview/loopGroupChatPanelTypes").DepartmentOrganizationStopState | undefined = result === "stopping" ? "stopping"
    : result === "unconfirmed" || !state.capacityKnown || (state.needsCleanup && (state.status !== "running" || state.interrupted)) ? "unconfirmed"
    : result === "confirmed" && (state.status !== "running" || state.interrupted) ? "confirmed"
    : undefined;
  return { needsCleanup: state.needsCleanup, stopState };
}

export function assertDepartmentOrganizationContinuation(task: LoopTaskRecord,
  state: { needsCleanup: boolean; stopState?: import("../webview/loopGroupChatPanelTypes").DepartmentOrganizationStopState } | null | undefined): void {
  if (!state) throw new Error("部门续接归属已变化。");
  if (state.stopState === "stopping") throw new Error("部门正在停止，请稍候。");
  if (state.stopState === "unconfirmed" || ((task.status !== "running" || task.runtimeInterrupted) && state.needsCleanup)) {
    throw new Error("部门停止未确认，仍有执行清理或状态保存未完成。");
  }
}

/** Neither labels, sessions nor browser IDs establish membership. */
export function isDepartmentLeader(root: LoopTaskRecord, leader: LoopTaskRecord): boolean {
  const rootMeta = departmentMetadata(root), meta = departmentMetadata(leader);
  return Boolean(rootMeta && rootMeta.role === "director" && rootMeta.rootTaskId === root.id
    && rootMeta.parentTaskId === null && rootMeta.leaderSubtaskId === null
    && meta && meta.role === "leader" && leader.id !== root.id
    && meta.rootTaskId === root.id && meta.parentTaskId === root.id
    && meta.leaderSubtaskId && root.subTasks.some((item) => item.id === meta.leaderSubtaskId)
    && leader.schedulingMode === "event_driven" && root.workspaceKey && root.workspaceKey === leader.workspaceKey);
}

function participant(task: LoopTaskRecord, role: "director" | "leader", localExecutionInactive?: boolean): LoopGroupChatPanelParticipant {
  const status = task.status === "running" && localExecutionInactive ? "runtime_interrupted"
    : task.status === "running" && role === "director" && task.runtimeInterrupted ? "stopped" : task.status;
  return { id: task.id, title: departmentMetadata(task)!.moduleTitle, role, status,
    sessionId: task.sessionId, summary: task.finalSummary, updatedAt: task.updatedAt };
}

function employees(task: LoopTaskRecord, projection: ReturnType<typeof projectLoopPlusPanel>): LoopGroupChatPanelParticipant[] {
  if (!projection?.ok) return [];
  const latestAttempts = new Map(projection.seenAttempts.map((attempt) => [attempt.subtaskId, attempt]));
  return [...latestAttempts.values()].flatMap((attempt) => {
    const subtaskIndex = task.subTasks.findIndex((item) => item.id === attempt.subtaskId);
    const spec = task.subTasks[subtaskIndex];
    if (!spec) return [];
    const execution = [...projection.running, ...projection.pending].find((item) => item.attemptId === attempt.attemptId);
    const review = [projection.currentReview, ...projection.reviewQueue].find((item) => item?.attemptId === attempt.attemptId);
    const interrupted = execution && "interrupted" in execution && execution.interrupted;
    const completedWithoutAcceptance = attempt.requiresAcceptance === false && attempt.outcome === "completed"
      && (attempt.disposition === "finished" || attempt.disposition === "reported");
    return [{ id: attempt.attemptId, subtaskId: spec.id,
      title: getLoopSubtaskDisplayTitle(subtaskIndex, spec), role: "employee",
      status: interrupted ? "blocked" : review ? resolveLoopPlusSubtaskMemberStatus(projection, spec.id, spec.status)
        : execution?.repairing ? "repairing" : execution?.state ?? (attempt.disposition === "reviewed" ? `acceptance_${attempt.noRepairReason ? "passed" : attempt.acceptance}`
          : completedWithoutAcceptance ? "no_acceptance" : attempt.outcome === "completed" ? "execution_completed"
          : attempt.outcome === "failed" ? "blocked"
            : attempt.outcome === "stopped" || attempt.disposition === "closed" ? "stopped" : "not_in_snapshot"),
      summary: review?.detail ?? spec.summary, updatedAt: spec.updatedAt }];
  });
}

/** Validate and copy at the projection boundary. Missing/malformed data remains unknown. */
export function normalizeDepartmentEmployeeAllocation(value: unknown, rootTaskId: string,
  leaderTaskIds: readonly string[], maxEmployees: number): DepartmentEmployeeAllocationProjection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as DepartmentEmployeeAllocationProjection;
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  if (data.rootTaskId !== rootTaskId || !count(data.revision) || !count(data.defaultLimit)
    || data.defaultLimit > maxEmployees || !Array.isArray(data.leaders)) return undefined;
  const seen = new Set<string>();
  for (const row of data.leaders) {
    if (!row || !leaderTaskIds.includes(row.leaderTaskId) || seen.has(row.leaderTaskId)
      || !["default", "manual"].includes(row.source) || !count(row.desiredLimit) || row.desiredLimit > maxEmployees
      || (row.source === "default" && row.desiredLimit !== data.defaultLimit)
      || (row.appliedLimit !== null && !count(row.appliedLimit))
      || (row.activeEmployees !== null && !count(row.activeEmployees)) || typeof row.pending !== "boolean") return undefined;
    seen.add(row.leaderTaskId);
  }
  return { rootTaskId, revision: data.revision, defaultLimit: data.defaultLimit,
    leaders: data.leaders.map((row) => ({ leaderTaskId: row.leaderTaskId, source: row.source,
      desiredLimit: row.desiredLimit, appliedLimit: row.appliedLimit, activeEmployees: row.activeEmployees, pending: row.pending })) };
}

export function buildDepartmentGroupChatProjection(task: LoopTaskRecord, port: DepartmentGroupChatReadPort): DepartmentGroupChatProjection | undefined {
  const root = resolveDepartmentRoot(task, port);
  if (!root) return undefined;
  const meta = departmentMetadata(task)!, rootMeta = departmentMetadata(root)!;
  // The same complete production index serves rendering and authorization. No list fallback.
  if (!port.readLeaderTaskIds) return undefined;
  const byId = new Map<string, { record: LoopTaskRecord; leaderNumber: number }>();
  try {
    for (const [index, module] of root.subTasks.entries()) {
      const ids = port.readLeaderTaskIds(root.id, module.id);
      if (!Array.isArray(ids)) return undefined;
      if (ids.length !== 1) continue; // Missing or ambiguous modules expose no leader contents.
      const record = port.readTaskRecord(ids[0]);
      if (record && record.id === ids[0] && isDepartmentLeader(root, record)
        && departmentMetadata(record)!.leaderSubtaskId === module.id && !byId.has(record.id)) {
        byId.set(record.id, { record, leaderNumber: index + 1 });
      }
    }
  } catch { return undefined; }
  const progressByModuleId = new Map<string, number>();
  const leaders = [...byId.values()].map(({ record, leaderNumber }) => {
    const localExecutionInactive = port.isLocalExecutionInactive?.(record);
    const loopPlus = projectLoopPlusPanel(record, port.getActiveReviewEventIds?.(record.id), port.isMainModelRunning?.(record), localExecutionInactive);
    const progressPercent = resolveLoopPanelProgressPercent(record, loopPlus);
    const statusSummary = meta.role === "director" && loopPlus?.ok ? summarizeLoopPlusMembers([
      { id: "main", role: "main", status: resolveLoopPlusMainMemberStatus(record, loopPlus) },
      ...record.subTasks.map((subtask) => ({ id: subtask.id, role: "subtask", status: resolveLoopPlusSubtaskMemberStatus(loopPlus, subtask.id, subtask.status) })),
    ]) : undefined;
    progressByModuleId.set(root.subTasks[leaderNumber - 1].id, progressPercent);
    return { taskId: record.id, leaderNumber, participant: participant(record, "leader", localExecutionInactive), progressPercent,
      ...(statusSummary ? { statusSummary } : {}), employees: employees(record, loopPlus) };
  });
  const overallProgressPercent = meta.role === "director" ? resolveDepartmentWeightedProgress(root, progressByModuleId) : undefined;
  const capacity = readDepartmentCapacity(root.id, port);
  let employeeAllocation: DepartmentEmployeeAllocationProjection | undefined;
  try { employeeAllocation = normalizeDepartmentEmployeeAllocation(port.readEmployeeAllocation?.(root.id), root.id,
    [...byId.keys()], capacity?.maxEmployees ?? rootMeta.limits.maxEmployees); } catch { /* Unknown, never fabricated. */ }
  return {
    ...(employeeAllocation ? { employeeAllocation } : {}),
    employeeAllocationEditable: meta.role === "director" && Boolean(employeeAllocation && port.employeeAllocationWritable),
    role: meta.role as "director" | "leader", rootTaskId: root.id,
    ...(meta.parentTaskId ? { parentTaskId: meta.parentTaskId } : {}), title: meta.moduleTitle,
    director: participant(root, "director", port.isLocalExecutionInactive?.(root)),
    leaders,
    ...(overallProgressPercent !== undefined ? { overallProgressPercent } : {}),
    maxLeaders: capacity?.maxLeaders ?? rootMeta.limits.maxLeaders,
    maxEmployees: capacity?.maxEmployees ?? rootMeta.limits.maxEmployees,
    activeLeaders: capacity?.leaders.length ?? null,
    activeEmployees: capacity?.employees.length ?? null,
  };
}

function resolveDepartmentWeightedProgress(
  root: LoopTaskRecord,
  progressByModuleId: ReadonlyMap<string, number>,
): number | undefined {
  if (root.status === "completed") return 100;
  if (root.subTasks.length === 0) return undefined;
  let totalWeight = 0;
  let weightedProgress = 0;
  for (const module of root.subTasks) {
    const weight = normalizeLoopSubtaskProgressWeightPercent(module.progressWeightPercent);
    if (weight === undefined) return undefined;
    totalWeight += weight;
    weightedProgress += weight * (progressByModuleId.get(module.id) ?? 0);
  }
  if (totalWeight > 100) return undefined;
  return Math.min(99, Math.round(weightedProgress / 100));
}
