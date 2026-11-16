import * as path from "path";
import { normalizeDepartmentMetadata } from "../department";
import type { LoopTaskRecord } from "../loopTaskStore";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import { sameExecution } from "../runtime/departmentexecutionidentity";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import { DepartmentRuntimeStore } from "./departmentruntimestore";

/** Read-only production recovery consumer. Endpoint comes from trusted app data
 * plus a validated ownerId; no task/model path, PID or directory scan is used.
 * This class has no start/handoff/release capability. Missing legacy bindings
 * return null; failed observations reject and retain the original occupancy. */
export class DepartmentExecutionRecovery {
  constructor(private readonly store: DepartmentRuntimeStore, private readonly ownerDirectory: string,
    private readonly verifySelection: (binding: DepartmentExecutionBinding) => Promise<boolean>) {}

  observeAttempt(task: LoopTaskRecord, attempt: { subtaskId: string; attemptId: string }): { done: Promise<void> } | null {
    const department = normalizeDepartmentMetadata(task.department);
    if (task.departmentInvalid || department?.role !== "leader" || department.parentTaskId !== department.rootTaskId
      || !department.leaderSubtaskId || !task.workspaceKey) return null;
    const read = this.store.read(department.rootTaskId, task.workspaceKey);
    if (!read.ok || !read.value) return null;
    const member = read.value.runtime.leaders.find((item) => item.taskId === task.id && item.leaderSubtaskId === department.leaderSubtaskId);
    const bindings = read.value.executionBindings?.filter(({ identity }) => identity.role === "employee"
      && identity.leaderTaskId === task.id && identity.moduleId === department.leaderSubtaskId
      && identity.generation === member?.generation && identity.subtaskId === attempt.subtaskId && identity.attemptId === attempt.attemptId) ?? [];
    if (bindings.length !== 1 || !read.value.capacity.employees.includes(JSON.stringify([task.id, attempt.attemptId]))) return null;
    const binding = structuredClone(bindings[0]), identity = binding.identity, selection = binding.selection;
    const route = department.routes.employee;
    const session = task.subTasks.find((item) => item.id === attempt.subtaskId)?.executionSession;
    if (identity.cli !== route.cli || session?.cli !== identity.cli || identity.session.state !== "bound"
      || session.sessionId !== identity.session.id || (session.configId ?? null) !== selection.configId
      || selection.configId !== (route.configId ?? null) || selection.model !== (route.model ?? null)
      || selection.thinkingMode !== (route.thinkingMode ?? null) || selection.openCodeVariant !== (route.openCodeVariant ?? null)) return null;
    const done = (async (): Promise<void> => {
      if (!await this.verifySelection(structuredClone(binding))) throw new Error("department-recovery-selection-conflict");
      await new DepartmentExecutionOwnerClient(path.join(this.ownerDirectory, identity.ownerId)).waitForCleanup(identity, binding.requirements);
      const current = this.store.read(identity.rootTaskId, identity.workspace);
      if (!current.ok || !current.value?.executionBindings?.some((item) => sameExecution(item.identity, identity))) {
        throw new Error("department-recovery-binding-lost");
      }
    })();
    // Recovery may reject before orchestration subscribes. This observes errors
    // without turning rejection into a successful cleanup signal.
    void done.catch(() => undefined);
    return { done };
  }
}
