import type { DepartmentMetadata } from "../department";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { LoopConversationTabContext } from "../panelStateBuilder";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";
import { isDepartmentExecutionBinding } from "./departmentruntimestate";

/** Read-only association, NOT a tab, live observation, producer or execution grant.
 * The orchestration reader separately verifies the root, frozen routes and plan.
 * Local transcript keys and native Owner sessions deliberately remain distinct. */
export function createDepartmentStoredLeaderIdentityReader(deps: {
  store: DepartmentRuntimeStore;
  workspaceKey(): string;
  readSessionContext(cli: LoopTaskRecord["cli"], sessionId: string): LoopConversationTabContext;
}) {
  return (task: LoopTaskRecord, expected: DepartmentMetadata, generation: number): boolean => {
    try {
      if (task.departmentInvalid || task.executionSessionInvalid || expected.role !== "leader"
        || expected.parentTaskId !== expected.rootTaskId || !expected.leaderSubtaskId
        || task.workspaceKey !== deps.workspaceKey() || !task.sessionId?.trim()
        || JSON.stringify(task.department) !== JSON.stringify(expected)) return false;
      const context = deps.readSessionContext(task.cli, task.sessionId);
      if (context.taskRole !== "main" || context.loopTaskId !== task.id) return false;
      const read = deps.store.read(expected.rootTaskId, task.workspaceKey);
      if (!read.ok || !read.value) return false;
      const members = read.value.runtime.leaders.filter(m => m.taskId === task.id && m.leaderSubtaskId === expected.leaderSubtaskId);
      if (members.length !== 1 || members[0].generation !== generation) return false;
      const bindings = (read.value.executionBindings ?? []).filter(b => b.identity.role === "leader"
        && b.identity.leaderTaskId === task.id && b.identity.generation === generation);
      if (bindings.length !== 1 || !isDepartmentExecutionBinding(bindings[0])) return false;
      const { identity: i, selection: s } = bindings[0], route = expected.routes.leader, native = task.executionSession;
      return i.workspace === task.workspaceKey && i.rootTaskId === expected.rootTaskId && i.moduleId === expected.leaderSubtaskId
        && i.cli === task.cli && i.session.state === "bound" && native?.cli === i.cli && native.sessionId === i.session.id
        && native.configId === s.configId && route.cli === s.cli && (route.configId ?? null) === s.configId
        && (route.model ?? null) === s.model && (route.thinkingMode ?? null) === s.thinkingMode
        && (route.openCodeVariant ?? null) === s.openCodeVariant;
    } catch { return false; }
  };
}
