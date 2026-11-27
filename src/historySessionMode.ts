import type { CliName } from "./cli/types";
import type { LoopTaskRecord } from "./loopTaskStore";

export type HistorySessionMode = "vibe" | "loop" | "loop-plus" | "department" | "internal";
export type HistorySessionTaskRole = "main" | "subtask" | null;

export type HistorySessionClassification = {
  mode: HistorySessionMode;
  taskRole: HistorySessionTaskRole;
};

function resolveTaskMode(task: LoopTaskRecord): HistorySessionMode {
  if (task.departmentInvalid) return "internal";
  if (task.department) {
    return task.department.role === "director"
      && task.department.rootTaskId === task.id
      && task.department.parentTaskId === null
      && task.department.leaderSubtaskId === null ? "department" : "internal";
  }
  return task.schedulingMode === "event_driven" ? "loop-plus" : "loop";
}

export function classifyHistorySession(
  tasks: readonly LoopTaskRecord[],
  cli: CliName,
  sessionId: string,
): HistorySessionClassification {
  const mainTasks = tasks.filter((task) => task.cli === cli && task.sessionId === sessionId);
  const subtaskOwners = tasks.filter((task) => task.subTasks.some((subtask) => (
    subtask.executionSession?.cli === cli && subtask.executionSession.sessionId === sessionId
  )));
  const matches = [
    ...mainTasks.map((task) => ({ task, taskRole: "main" as const })),
    ...subtaskOwners.map((task) => ({ task, taskRole: "subtask" as const })),
  ];
  if (!matches.length) return { mode: "vibe", taskRole: null };
  if (matches.length !== 1) return { mode: "internal", taskRole: null };

  const match = matches[0];
  if (match.task.department && (match.task.department.role !== "director" || match.taskRole !== "main")) {
    return { mode: "internal", taskRole: match.taskRole };
  }
  return { mode: resolveTaskMode(match.task), taskRole: match.taskRole };
}
