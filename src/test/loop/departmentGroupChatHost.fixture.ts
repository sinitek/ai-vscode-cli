import type { LoopTaskRecord } from "../../loopTaskStore";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import type { DepartmentMetadata } from "../../department";

/** Exhaustive in-memory test index. Production must provide an independently maintained trusted index. */
export function fixtureDepartmentLeaderTaskIds(records: ReadonlyMap<string, LoopTaskRecord>, rootTaskId: string, moduleId: string): string[] {
  return [...records.values()].filter((task) => task.department?.role === "leader"
    && task.department.rootTaskId === rootTaskId && task.department.leaderSubtaskId === moduleId).map((task) => task.id);
}

/** Task-record fixtures only; no organization is started and no user records are written. */
export function departmentRecords(): { root: LoopTaskRecord; leader: LoopTaskRecord; other: LoopTaskRecord; records: Map<string, LoopTaskRecord> } {
  const meta = (rootTaskId: string, role: "director" | "leader", leaderSubtaskId: string | null): DepartmentMetadata => ({
    version: 1, rootTaskId, parentTaskId: role === "director" ? null : rootTaskId, leaderSubtaskId,
    role, moduleTitle: role === "director" ? "真实记录部门" : "同名模块",
    routes: { director: {}, leader: {}, employee: {} }, limits: { maxLeaders: 4, maxEmployees: 20 },
  });
  const task = (id: string): LoopTaskRecord => ({ id, cli: "codex", workspaceKey: "workspace-A", taskStoreFile: "/fixture/tasks.json",
    rootPrompt: "记录中的需求", status: "stopped", createdAt: 1, updatedAt: 2, maxRounds: 20, currentRound: 1,
    communicationDir: `/fixture/${id}`, mainCommunicationFile: `/fixture/${id}/main.md`, subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
    schedulingMode: "event_driven", loopPlus: createLoopPlusScheduler({ maxConcurrency: 4 }).snapshot(),
  });
  const root = task("department-root-abcdef"); root.department = meta(root.id, "director", null);
  root.subTasks = [{ id: "module-A", title: "同名模块", prompt: "模块需求", status: "running" }, { id: "module-B", title: "同名模块", prompt: "模块需求", status: "pending" }];
  root.loopPlusAcceptancePlan = { id: "root-plan", name: "根固化快照", checks: ["security"], otherText: "", systemDefault: false };
  const leader = task("department-leader-111111"); leader.department = meta(root.id, "leader", "module-A");
  leader.subTasks = [{ id: "employee-A", title: "真实员工", prompt: "员工需求", status: "running" }];
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 }); scheduler.dispatch([{ subtaskId: "employee-A", attemptId: "attempt-A", title: "真实员工" }]);
  leader.loopPlus = scheduler.snapshot();
  const other = task("department-leader-222222"); other.department = meta(root.id, "leader", "module-B");
  return { root, leader, other, records: new Map([root, leader, other].map((item) => [item.id, item])) };
}
