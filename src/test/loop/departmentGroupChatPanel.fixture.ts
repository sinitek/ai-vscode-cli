import type { DepartmentGroupChatProjection, LoopGroupChatPanelState } from "../../webview/loopGroupChatPanelTypes";
import { buildLoopPlusAcceptanceFeedbackSection } from "../../loopPlusAcceptancePlan";
import { buildLoopPlusFinishEventId } from "../../loopPlusScheduler";
import { loopPlusAcceptanceChecksFixture } from "../loopPlusAcceptFixture";

/** Display-only fixture: it does not represent a created organization or host navigation. */
export function departmentState(role: DepartmentGroupChatProjection["role"] = "director"): LoopGroupChatPanelState {
  const employee = { id: "employee-a", title: "子任务 1：" + "导出接口 / API <契约> & 长标题".repeat(3), role: "subtask", status: "acceptance_passed" };
  const feedback = buildLoopPlusAcceptanceFeedbackSection({
    subtaskTitles: [employee.title],
    checks: loopPlusAcceptanceChecksFixture(),
    reviews: [{ eventId: buildLoopPlusFinishEventId(employee.id, "attempt-a"), acceptance: "passed", reason: "展示夹具的验收反馈" }],
  })!;
  return {
    task: {
      id: role === "director" ? "department-20261113-root-abcdef" : "department-20261113-leader-111111",
      cli: "codex", status: "running", rootPrompt: "部门任务 **Markdown** <需求>\n\n" + "任务说明\n\n".repeat(30),
      taskStoreFile: "/display-only/tasks.json", mainCommunicationFile: "/display-only/main.md",
      currentRound: 1, updatedAt: 1, canSupplement: true, canContinue: true, canStop: false,
    },
    department: {
      role, rootTaskId: "department-20261113-root-abcdef", parentTaskId: role === "leader" ? "department-20261113-root-abcdef" : undefined,
      title: "同名模块 <流程> & \"标题\" / " + "很长的模块标题与Windows路径C:\\workspace\\module".repeat(5),
      director: { id: "director", title: "部门总监", role: "main", status: "running" },
      leaders: [
        { taskId: "department-20261113-leader-111111", leaderNumber: 1, participant: { id: "leader-a", title: "同名模块", role: "main", status: "running" },
          statusSummary: { running: 1, repairing: 0, reviewing: 0, queue: 0, pending: 0, acceptance_failed: 0, blocked: 0, completed: 1 }, employees: [employee] },
        { taskId: "department-20261113-leader-222222", leaderNumber: 2, participant: { id: "leader-b", title: "同名模块", role: "main", status: "paused" },
          statusSummary: { running: 0, repairing: 0, reviewing: 0, queue: 0, pending: 1, blocked: 0, completed: 0 }, employees: [{ id: "employee-b", title: "子任务 1：报表接口", role: "subtask", status: "pending" }] },
        { taskId: "", leaderNumber: 3, participant: { id: "leader-pending", title: "尚未创建的模块", role: "main", status: "pending" }, employees: [] },
      ],
      maxLeaders: 4, maxEmployees: 20, activeLeaders: 2, activeEmployees: 1,
    },
    acceptancePlan: { id: "department-plan", name: "产研部统一规则 <严格>", checks: ["security"], otherText: "", systemDefault: false },
    loopPlus: {
      ok: true, schedulingMode: "event_driven", activity: "waiting", phase: "waiting", wakePending: false,
      currentReview: null, reviewQueue: [], currentReviewCount: 0, reviewQueueCount: 0, visibleReviewCount: 0,
      running: [], pending: [], runningCount: 0, pendingCount: 0,
      seenAttempts: [{ subtaskId: employee.id, attemptId: "attempt-a", disposition: "reviewed", outcome: "completed", acceptance: "passed" }],
    },
    rounds: [{ key: "round-1", loopRound: 1, status: "running", startedAt: 1, participants: [employee] }],
    chatMarkdown: `## ${feedback.heading}\n\n${feedback.body}\n\n` + Array.from({ length: 30 }, (_, i) => `## 主任务发言\n\n消息 ${i} **Markdown**\n\n`).join(""),
  };
}
