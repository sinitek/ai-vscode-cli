import type { DepartmentCollaborationMessage } from "../departmentcollaboration";
import { exactKeys, fingerprintDepartmentExecutionSelection, isCleanupRequirements, isDepartmentExecutionIdentity, record,
  type CleanupRequirements, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";

/** Immutable launch authorization, written before Owner.startExecution. Not a
 * receipt or permission to release capacity. Legacy snapshots have no binding. */
export type DepartmentExecutionBinding = { identity: DepartmentExecutionIdentity; requirements: CleanupRequirements;
  selection: DepartmentExecutionSelection };
export function isDepartmentExecutionBinding(value: unknown): value is DepartmentExecutionBinding {
  if (!(record(value) && exactKeys(value, ["identity", "requirements", "selection"])
    && isDepartmentExecutionIdentity(value.identity) && value.identity.session.state === "bound"
    && isCleanupRequirements(value.requirements))) return false;
  try {
    const selection = value.selection as DepartmentExecutionSelection;
    const fingerprints = fingerprintDepartmentExecutionSelection(selection);
    return selection.cli === value.identity.cli && selection.role === value.identity.role
      && fingerprints.configFingerprint === value.identity.configFingerprint && fingerprints.profileFingerprint === value.identity.profileFingerprint;
  } catch { return false; }
}

export type DepartmentLeaderStatus = "starting" | "running" | "stopping" | "paused" | "completed" | "failed" | "blocked";
export type DepartmentLeaderRuntimeState = { taskId: string; leaderSubtaskId: string; status: DepartmentLeaderStatus; generation?: number };
export type DepartmentCoordination = DepartmentCollaborationMessage & {
  coordination?: "awaiting-director" | "approved" | "dismissed";
  error?: string;
};
export type DepartmentRuntimeSnapshot = {
  version: 1;
  rootTaskId: string;
  stopping: boolean;
  leaders: DepartmentLeaderRuntimeState[];
  collaborations: DepartmentCoordination[];
  /** Reservations are persisted before any capacity wait or task creation. */
  startingModules?: string[];
  acknowledgedRootRequirements?: string[];
};
export function createDepartmentRuntimeSnapshot(rootTaskId: string): DepartmentRuntimeSnapshot {
  return { version: 1, rootTaskId, stopping: false, leaders: [], collaborations: [], startingModules: [], acknowledgedRootRequirements: [] };
}
const text = (v: unknown): v is string => typeof v === "string" && Boolean(v.trim());
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
export function isDepartmentRuntimeSnapshot(value: unknown, rootTaskId: string): value is DepartmentRuntimeSnapshot {
  if (!object(value) || value.version !== 1 || value.rootTaskId !== rootTaskId || typeof value.stopping !== "boolean"
    || !Array.isArray(value.leaders) || !Array.isArray(value.collaborations)) return false;
  const tasks = new Set<string>(), modules = new Set<string>(), messages = new Set<string>();
  for (const member of value.leaders) {
    if (!object(member) || !text(member.taskId) || !text(member.leaderSubtaskId) || tasks.has(member.taskId) || modules.has(member.leaderSubtaskId)
      || typeof member.status !== "string" || !["starting", "running", "stopping", "paused", "completed", "failed", "blocked"].includes(member.status)
      || (member.generation !== undefined && (!Number.isSafeInteger(member.generation) || (member.generation as number) < 0))) return false;
    tasks.add(member.taskId); modules.add(member.leaderSubtaskId);
  }
  for (const message of value.collaborations) {
    if (!object(message) || !text(message.id) || messages.has(message.id) || message.rootTaskId !== rootTaskId
      || !text(message.sourceLeaderTaskId) || !tasks.has(message.sourceLeaderTaskId)
      || !text(message.targetLeaderTaskId) || !tasks.has(message.targetLeaderTaskId) || !text(message.body)
      || typeof message.status !== "string" || !["pending", "delivered", "rejected"].includes(message.status)
      || (message.coordination !== undefined && (typeof message.coordination !== "string" || !["awaiting-director", "approved", "dismissed"].includes(message.coordination)))
      || (message.error !== undefined && typeof message.error !== "string")) return false;
    messages.add(message.id);
  }
  if (value.startingModules !== undefined && (!Array.isArray(value.startingModules)
    || value.startingModules.some((id) => !text(id) || modules.has(id)) || new Set(value.startingModules).size !== value.startingModules.length)) return false;
  return value.acknowledgedRootRequirements === undefined || (Array.isArray(value.acknowledgedRootRequirements) && value.acknowledgedRootRequirements.every(text));
}
