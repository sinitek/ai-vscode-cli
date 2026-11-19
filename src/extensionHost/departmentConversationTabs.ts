import type { ChatMessage, ConversationTabSummary, DepartmentConversationTabPresentation } from "../webview/types";
import type { LoopTaskRecord } from "../loopTaskStore";
import { resolveLoopSubtaskConversationContextFromMessages } from "../loopConversationPresentation";
import { departmentMetadata, isDepartmentLeader } from "./departmentGroupChatProjection";

export type DepartmentConversationTabReadPort = {
  readTaskRecord(taskId: string): LoopTaskRecord | null;
  readDepartmentLeaderTaskIds(rootTaskId: string, leaderSubtaskId: string): readonly string[] | null;
};

function ownsMainSession(summary: ConversationTabSummary, task: LoopTaskRecord): boolean {
  return summary.loopTaskRole === "main"
    && summary.loopTaskId === task.id
    && Boolean(summary.sessionId && task.sessionId === summary.sessionId)
    && task.cli === summary.cli;
}

function presentation(
  role: DepartmentConversationTabPresentation["role"],
  rootTaskId: string,
  taskId: string,
  moduleTitle: string,
  employeeSubtaskId?: string,
): DepartmentConversationTabPresentation {
  return {
    role,
    rootTaskId,
    taskId,
    moduleTitle,
    ...(employeeSubtaskId ? { employeeSubtaskId } : {}),
  };
}

function describe(value: DepartmentConversationTabPresentation, rootTitle: string): string {
  const identity = `rootTaskId ${value.rootTaskId} / taskId ${value.taskId}`;
  if (value.role === "director") {
    return `产研部 / 总监 / ${value.moduleTitle} / ${identity}`;
  }
  if (value.role === "leader") {
    return `产研部 / ${rootTitle} / 组长 / 模块 ${value.moduleTitle} / ${identity}`;
  }
  return `产研部 / ${rootTitle} / 员工 / 模块 ${value.moduleTitle} / ${identity} / employeeSubtaskId ${value.employeeSubtaskId}`;
}

function hasUniqueModuleRelationship(root: LoopTaskRecord, leader: LoopTaskRecord, port: DepartmentConversationTabReadPort): boolean {
  const meta = departmentMetadata(leader);
  let leaders: readonly string[] | null = null;
  try { leaders = meta?.leaderSubtaskId ? port.readDepartmentLeaderTaskIds(root.id, meta.leaderSubtaskId) : null; }
  catch { return false; }
  return Boolean(meta?.leaderSubtaskId
    && Array.isArray(leaders) && leaders.length === 1 && leaders[0] === leader.id
    && root.subTasks.filter((subtask) => subtask.id === meta.leaderSubtaskId).length === 1
    && isDepartmentLeader(root, leader));
}

/** Projects a display hint only after the task and conversation ownership agree. */
export function projectDepartmentConversationTab(
  summary: ConversationTabSummary,
  task: LoopTaskRecord | null,
  messages: readonly ChatMessage[],
  port: DepartmentConversationTabReadPort,
): ConversationTabSummary {
  if (!task || summary.loopTaskId !== task.id || task.departmentInvalid) return summary;
  let ownedTask: LoopTaskRecord | null = null;
  try { ownedTask = port.readTaskRecord(task.id); } catch { return summary; }
  if (!ownedTask || ownedTask.id !== task.id) return summary;
  task = ownedTask;
  const meta = departmentMetadata(task);
  if (!meta) return summary;

  if (meta.role === "director") {
    if (meta.rootTaskId !== task.id || meta.parentTaskId !== null || meta.leaderSubtaskId !== null
      || !task.workspaceKey.trim()
      || !ownsMainSession(summary, task)) return summary;
    if (!hasUniqueRootIdentity(task, port)) return summary;
    const projected = presentation("director", task.id, task.id, meta.moduleTitle);
    return { ...summary, departmentPresentation: projected, taskSummary: describe(projected, meta.moduleTitle) };
  }

  if (meta.role !== "leader" || summary.loopTaskRole !== "main"
    || summary.loopTaskId !== task.id || task.schedulingMode !== "event_driven"
    || !summary.sessionId || task.sessionId !== summary.sessionId || task.cli !== summary.cli) return summary;

  let root: LoopTaskRecord | null = null;
  try { root = port.readTaskRecord(meta.rootTaskId); } catch { return summary; }
  if (!root || root.id !== meta.rootTaskId || !sameWorkspace(root, task) || !hasUniqueRootIdentity(root, port)
    || !hasUniqueModuleRelationship(root, task, port)) return summary;

  if (meta.parentTaskId !== root.id || !meta.leaderSubtaskId) return summary;
  const projected = presentation("leader", root.id, task.id, meta.moduleTitle);
  return { ...summary, departmentPresentation: projected, taskSummary: describe(projected, departmentMetadata(root)?.moduleTitle ?? meta.moduleTitle) };
}

export function projectDepartmentEmployeeConversationTab(
  summary: ConversationTabSummary,
  leader: LoopTaskRecord | null,
  messages: readonly ChatMessage[],
  port: DepartmentConversationTabReadPort,
): ConversationTabSummary {
  if (!leader || leader.departmentInvalid || summary.loopTaskRole !== "subtask"
    || summary.loopTaskId !== leader.id || !summary.sessionId) return summary;

  let ownedLeader: LoopTaskRecord | null = null;
  try { ownedLeader = port.readTaskRecord(leader.id); } catch { return summary; }
  if (!ownedLeader || ownedLeader.id !== leader.id) return summary;
  leader = ownedLeader;
  const meta = departmentMetadata(leader);
  if (!meta || meta.role !== "leader" || leader.schedulingMode !== "event_driven") return summary;

  let root: LoopTaskRecord | null = null;
  try { root = port.readTaskRecord(meta.rootTaskId); } catch { return summary; }
  if (!root || root.id !== meta.rootTaskId || !sameWorkspace(root, leader) || !hasUniqueRootIdentity(root, port)
    || !hasUniqueModuleRelationship(root, leader, port)) return summary;
  const context = resolveLoopSubtaskConversationContextFromMessages(messages);
  if (!context || context.taskId !== leader.id) return summary;

  const matches = leader.subTasks.filter((subtask) => subtask.id === context.subtaskId
    && subtask.executionSession?.cli === summary.cli
    && subtask.executionSession.sessionId === summary.sessionId);
  const sessionMatches = leader.subTasks.filter((subtask) => subtask.executionSession?.cli === summary.cli
    && subtask.executionSession.sessionId === summary.sessionId);
  if (matches.length !== 1 || sessionMatches.length !== 1) return summary;

  const rootMeta = departmentMetadata(root);
  if (!rootMeta) return summary;
  const projected = presentation("employee", root.id, leader.id, meta.moduleTitle, matches[0].id);
  return { ...summary, departmentPresentation: projected, taskSummary: describe(projected, rootMeta.moduleTitle) };
}

function sameWorkspace(root: LoopTaskRecord, task: LoopTaskRecord): boolean {
  return Boolean(root.workspaceKey.trim() && root.workspaceKey === task.workspaceKey);
}

function hasUniqueRootIdentity(root: LoopTaskRecord, port: DepartmentConversationTabReadPort): boolean {
  let current: LoopTaskRecord | null = null;
  try { current = port.readTaskRecord(root.id); } catch { return false; }
  return Boolean(current && current.id === root.id && current.workspaceKey === root.workspaceKey
    && current.cli === root.cli && current.sessionId === root.sessionId);
}
