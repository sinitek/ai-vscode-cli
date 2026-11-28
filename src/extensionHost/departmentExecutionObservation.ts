import type { LoopTaskRecord } from "../loopTaskStore";
import type { DepartmentExecutionActivity } from "../department";

export type DepartmentTaskSourceState = "owned" | "inactive" | "unverified";
export type DepartmentExecutionObservation = { source: DepartmentTaskSourceState; activity: DepartmentExecutionActivity };

export function observeDepartmentExecution(task: LoopTaskRecord, runningTaskIds: ReadonlySet<string>,
  readSource: (task: LoopTaskRecord) => DepartmentTaskSourceState,
  hasDirectorActivity?: (rootTaskId: string) => boolean): DepartmentExecutionObservation {
  try {
    const source = readSource(task);
    if (source !== "owned") return { source, activity: source };
    if (task.departmentInvalid || !task.department) return { source, activity: "unverified" };
    if (runningTaskIds.has(task.id)) return { source, activity: "active" };
    if (task.department.role === "director") {
      if (!hasDirectorActivity) return { source, activity: "unverified" };
      if (hasDirectorActivity(task.id)) return { source, activity: "active" };
    }
    return { source, activity: "inactive" };
  } catch { return { source: "unverified", activity: "unverified" }; }
}
