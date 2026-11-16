import { normalizeDepartmentMetadata } from "../department";
import { projectDepartmentEmployeeAllocation } from "../departmentemployeeallocation";
import type { DepartmentCapacityPool, DepartmentEmployeeCapacity } from "../departmentcapacity";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { DepartmentEmployeeAllocationProjection, DepartmentEmployeeLimitRequest } from "../webview/loopGroupChatPanelTypes";
import { authorizeDepartmentLeader, type DepartmentLeaderOwnershipReader } from "./departmentGroupChatProjection";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";
import type { DepartmentRuntimeSnapshot } from "./departmentruntimestate";

/** Trusted single-EH composition ports. No reader initializes state or recovers execution. */
export function createDepartmentEmployeeAllocationHost(deps: {
  store: DepartmentRuntimeStore;
  capacity: DepartmentCapacityPool;
  workspaceKey(): string;
  readTask(id: string): LoopTaskRecord | null;
  runtimeSnapshot(root: string): DepartmentRuntimeSnapshot | null;
  readLeaderTaskIds?: DepartmentLeaderOwnershipReader;
  current(root: string): boolean;
  persistenceFailed(root: string): void;
}) {
  function rootTask(id: string): LoopTaskRecord | null {
    const task = deps.readTask(id), meta = task && !task.departmentInvalid && normalizeDepartmentMetadata(task.department);
    return task && meta && task.workspaceKey === deps.workspaceKey() && meta.role === "director"
      && meta.rootTaskId === id && meta.parentTaskId === null && meta.leaderSubtaskId === null ? task : null;
  }
  function leader(root: LoopTaskRecord, id: string): boolean {
    const task = deps.readTask(id), runtime = deps.runtimeSnapshot(root.id);
    const member = runtime?.leaders.find((item) => item.taskId === id);
    if (!task || !member) return false;
    const readOwnership: DepartmentLeaderOwnershipReader = deps.readLeaderTaskIds ?? ((rootId, moduleId) =>
      rootId === root.id ? runtime!.leaders.filter((item) => item.leaderSubtaskId === moduleId).map((item) => item.taskId) : null);
    return authorizeDepartmentLeader(root, task, { readTaskRecord: deps.readTask }, readOwnership);
  }
  function readDepartmentEmployeeAllocation(id: string): DepartmentEmployeeAllocationProjection | null {
    const root = rootTask(id);
    if (!root) return null;
    const read = deps.store.read(id, root.workspaceKey);
    if (!read.ok || !read.value?.employeeAllocation) return null;
    const state = read.value.employeeAllocation;
    // Counts are exclusively from this host's current live lease pool. Cold disk counts are not live observations.
    const members = deps.runtimeSnapshot(id)?.leaders ?? [];
    const leaders = state.leaders.filter((row) => members.some((member) => member.taskId === row.leaderTaskId) && leader(root, row.leaderTaskId));
    const projection = projectDepartmentEmployeeAllocation({ ...state, leaders }, id, { rootTaskId: id, leaders: leaders.map((row) => ({
      leaderTaskId: row.leaderTaskId,
      activeEmployees: deps.current(id) ? deps.capacity.getEmployeeAllocationOccupancy(id, row.leaderTaskId)?.activeEmployees ?? null : null,
    })) });
    return { ...projection, leaders: projection.leaders.map((row) => ({ ...row })) };
  }
  function updateDepartmentEmployeeLimit(requestRoot: LoopTaskRecord, request: DepartmentEmployeeLimitRequest):
    { ok: true; allocation: DepartmentEmployeeAllocationProjection } | { ok: false; error: string } {
    const root = rootTask(requestRoot.id);
    if (!root || requestRoot.workspaceKey !== root.workspaceKey || JSON.stringify(requestRoot.department) !== JSON.stringify(root.department)
      || !deps.current(root.id) || !leader(root, request.leaderTaskId)
      || typeof request.requestId !== "string" || !request.requestId.trim() || request.requestId.length > 160) {
      return { ok: false, error: "仅当前产研部总监可调整本部门有效组长额度。" };
    }
    const saved = deps.store.saveEmployeeLimit(root.id, root.workspaceKey, request);
    if (!saved.ok) return saved;
    const allocation = readDepartmentEmployeeAllocation(root.id);
    return allocation ? { ok: true, allocation } : { ok: false, error: "员工额度确认读取失败，请刷新后重试。" };
  }
  /** Called synchronously after identity/idempotence checks, immediately before the original pool grant. */
  function beginEmployeeAdmission(rootId: string, leaderTaskId: string): boolean {
    const root = rootTask(rootId);
    if (!root || !deps.current(rootId) || !leader(root, leaderTaskId)) return false;
    const occupancy = deps.capacity.getEmployeeAllocationOccupancy(rootId, leaderTaskId);
    if (!occupancy) return false;
    const result = deps.store.beginEmployeeAdmission(root.workspaceKey, occupancy);
    if (!result.ok) { deps.persistenceFailed(rootId); return false; }
    return result.evaluation.eligible;
  }
  function readEmployeeCapacity(rootId: string, leaderTaskId: string): DepartmentEmployeeCapacity | null {
    const root = rootTask(rootId);
    if (!root || !deps.current(rootId) || !leader(root, leaderTaskId)) return null;
    const global = deps.capacity.getEmployeeCapacity(rootId, leaderTaskId);
    const occupancy = deps.capacity.getEmployeeAllocationOccupancy(rootId, leaderTaskId);
    const view = readDepartmentEmployeeAllocation(rootId), row = view?.leaders.find((item) => item.leaderTaskId === leaderTaskId);
    if (!global || !occupancy || !view || !row || row.activeEmployees === null
      || occupancy.globalActiveEmployees === null || row.activeEmployees > occupancy.globalActiveEmployees
      || global.leaderOverflowActive && row.activeEmployees === 0) return null;
    return { ...global, leaderAllocation: { revision: view.revision, source: row.source, desiredLimit: row.desiredLimit,
      appliedLimit: row.appliedLimit, activeEmployees: row.activeEmployees,
      availableEmployees: Math.min(global.availableEmployees, Math.max(0, row.desiredLimit - row.activeEmployees)), pending: row.pending } };
  }
  return { readDepartmentEmployeeAllocation, updateDepartmentEmployeeLimit, beginEmployeeAdmission, readEmployeeCapacity };
}
