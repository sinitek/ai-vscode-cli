import { normalizeDepartmentMetadata } from "../department";
import type { DepartmentCapacitySnapshot } from "../departmentcapacity";
import { projectLoopPlusPanel } from "../loopPlusPanelProjection";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { DepartmentEmployeeAllocationProjection, DepartmentGroupChatProjection, LoopGroupChatPanelParticipant } from "../webview/loopGroupChatPanelTypes";

export type DepartmentGroupChatReadPort = {
  readTaskRecord(taskId: string): LoopTaskRecord | null;
  readLeaderTaskIds?: DepartmentLeaderOwnershipReader;
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

function participant(task: LoopTaskRecord, role: "director" | "leader"): LoopGroupChatPanelParticipant {
  return { id: task.id, title: departmentMetadata(task)!.moduleTitle, role, status: task.status,
    sessionId: task.sessionId, summary: task.finalSummary, updatedAt: task.updatedAt };
}

function employees(task: LoopTaskRecord): LoopGroupChatPanelParticipant[] {
  const projection = projectLoopPlusPanel(task);
  if (!projection?.ok) return [];
  return projection.seenAttempts.flatMap((attempt) => {
    const spec = task.subTasks.find((item) => item.id === attempt.subtaskId);
    if (!spec) return [];
    const execution = [...projection.running, ...projection.pending].find((item) => item.attemptId === attempt.attemptId);
    const review = [projection.currentReview, ...projection.reviewQueue].find((item) => item?.attemptId === attempt.attemptId);
    return [{ id: attempt.attemptId, subtaskId: spec.id, title: spec.title, role: "employee",
      status: execution?.state ?? (attempt.disposition === "reviewed" ? `acceptance_${attempt.acceptance}`
        : review ? "queued_review" : attempt.outcome === "completed" ? "execution_completed"
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
  const byId = new Map<string, LoopTaskRecord>();
  try {
    for (const module of root.subTasks) {
      const ids = port.readLeaderTaskIds(root.id, module.id);
      if (!Array.isArray(ids)) return undefined;
      if (ids.length !== 1) continue; // Missing or ambiguous modules expose no leader contents.
      const record = port.readTaskRecord(ids[0]);
      if (record && record.id === ids[0] && isDepartmentLeader(root, record)
        && departmentMetadata(record)!.leaderSubtaskId === module.id) byId.set(record.id, record);
    }
  } catch { return undefined; }
  const leaders = [...byId.values()];
  let capacity: DepartmentCapacitySnapshot | null = null;
  try { capacity = port.readCapacity?.(root.id) ?? null; } catch { /* Unknown is explicit. */ }
  const valid = capacity && capacity.rootTaskId === root.id
    && Number.isSafeInteger(capacity.maxLeaders) && capacity.maxLeaders >= 0
    && Number.isSafeInteger(capacity.maxEmployees) && capacity.maxEmployees >= 0
    && Array.isArray(capacity.leaders) && Array.isArray(capacity.employees)
    && capacity.leaders.every((id) => typeof id === "string" && id.trim())
    && capacity.employees.every((id) => typeof id === "string" && id.trim())
    && new Set(capacity.leaders).size === capacity.leaders.length && new Set(capacity.employees).size === capacity.employees.length;
  let employeeAllocation: DepartmentEmployeeAllocationProjection | undefined;
  try { employeeAllocation = normalizeDepartmentEmployeeAllocation(port.readEmployeeAllocation?.(root.id), root.id,
    leaders.map((leader) => leader.id), valid ? capacity!.maxEmployees : rootMeta.limits.maxEmployees); } catch { /* Unknown, never fabricated. */ }
  return {
    ...(employeeAllocation ? { employeeAllocation } : {}),
    employeeAllocationEditable: meta.role === "director" && Boolean(employeeAllocation && port.employeeAllocationWritable),
    role: meta.role as "director" | "leader", rootTaskId: root.id,
    ...(meta.parentTaskId ? { parentTaskId: meta.parentTaskId } : {}), title: meta.moduleTitle,
    director: participant(root, "director"),
    leaders: leaders.map((leader) => ({ taskId: leader.id, participant: participant(leader, "leader"), employees: employees(leader) })),
    maxLeaders: valid ? capacity!.maxLeaders : rootMeta.limits.maxLeaders,
    maxEmployees: valid ? capacity!.maxEmployees : rootMeta.limits.maxEmployees,
    activeLeaders: valid ? capacity!.leaders.length : null,
    activeEmployees: valid ? capacity!.employees.length : null,
  };
}
