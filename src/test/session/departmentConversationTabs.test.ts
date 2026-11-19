import test = require("node:test");
import assert = require("node:assert/strict");
import type { DepartmentMetadata } from "../../department";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { ChatMessage, ConversationTabSummary } from "../../webview/types";
import { projectDepartmentConversationTab, projectDepartmentEmployeeConversationTab } from "../../extensionHost/departmentConversationTabs";

function metadata(rootTaskId: string, role: DepartmentMetadata["role"], moduleId: string | null, title: string): DepartmentMetadata {
  return { version: 1, rootTaskId, parentTaskId: role === "director" ? null : rootTaskId,
    leaderSubtaskId: moduleId, role, moduleTitle: title,
    routes: { director: {}, leader: {}, employee: {} }, limits: { maxLeaders: 4, maxEmployees: 20 } };
}

function task(id: string, workspaceKey = "workspace-a"): LoopTaskRecord {
  return { id, cli: "codex", workspaceKey, taskStoreFile: "/tasks.json", rootPrompt: "task", status: "running",
    createdAt: 1, updatedAt: 1, maxRounds: 20, currentRound: 1, communicationDir: "/tasks", mainCommunicationFile: "/tasks/main.md",
    sessionId: `${id}-session`, subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
    schedulingMode: "event_driven" };
}

function tab(id: string, taskId: string, role: "main" | "subtask" = "main", sessionId = `${taskId}-session`): ConversationTabSummary {
  return { id, cli: "codex", sessionId, createdAt: 1, loopTaskRole: role, loopTaskId: taskId };
}

function fixture() {
  const root = task("department-root-abcdef");
  root.department = metadata(root.id, "director", null, "产研部");
  root.subTasks = [{ id: "module-ui", title: "前端", status: "running" }];
  const leader = task("department-leader-123456");
  leader.department = metadata(root.id, "leader", "module-ui", "共享模块名");
  leader.subTasks = [{ id: "employee-subtask-789abc", title: "员工真实会话", status: "running",
    executionSession: { cli: "codex", sessionId: "employee-session", configId: null } }];
  const records = new Map([[root.id, root], [leader.id, leader]]);
  return { root, leader, records, port: {
    readTaskRecord: (id: string) => records.get(id) ?? null,
    readDepartmentLeaderTaskIds: (rootTaskId: string, moduleId: string) => rootTaskId === root.id && moduleId === "module-ui" ? [leader.id] : [],
  } };
}

const employeeMessages: ChatMessage[] = [{ id: "m1", role: "user", content: "work", taskRole: "subtask",
  loopTaskId: "department-leader-123456", loopSubtaskId: "employee-subtask-789abc", loopRound: 1 }];

test("projects director and event-driven leader only from their owned main sessions", () => {
  const { root, leader, port } = fixture();
  const summary = tab("director-tab", root.id);
  const director = projectDepartmentConversationTab({ ...summary, taskSummary: "实现账号与报表功能" }, root, [], port);
  assert.deepEqual(director.departmentPresentation, { role: "director", rootTaskId: root.id, taskId: root.id, moduleTitle: "产研部" });
  assert.equal(director.taskSummary, "实现账号与报表功能");
  assert.equal(projectDepartmentConversationTab(summary, root, [], port).taskSummary, undefined);

  const leaderSummary = projectDepartmentConversationTab(tab("leader-tab", leader.id), leader, [], port);
  assert.deepEqual(leaderSummary.departmentPresentation, { role: "leader", rootTaskId: root.id, taskId: leader.id, moduleTitle: "共享模块名" });
  assert.equal(leaderSummary.taskSummary, "组长 · 共享模块名");
  assert.equal(projectDepartmentConversationTab(tab("wrong-session", leader.id, "main", "other-session"), leader, [], port).departmentPresentation, undefined);
  assert.equal(projectDepartmentConversationTab({ ...tab("ordinary", root.id), loopTaskRole: "subtask" }, root, [], port).departmentPresentation, undefined);
});

test("same module titles remain distinct by actual leader task id and reject duplicate root module ids", () => {
  const { root, leader, port } = fixture();
  root.subTasks.push({ id: "module-copy", title: "共享模块名", status: "running" });
  const secondLeader = task("department-leader-654321");
  secondLeader.department = metadata(root.id, "leader", "module-copy", "共享模块名");
  const records = new Map([[root.id, root], [leader.id, leader], [secondLeader.id, secondLeader]]);
  const first = projectDepartmentConversationTab(tab("leader-one", leader.id), leader, [], port);
  const second = projectDepartmentConversationTab(tab("leader-two", secondLeader.id), secondLeader, [], {
    readTaskRecord: (id) => records.get(id) ?? null,
    readDepartmentLeaderTaskIds: (rootTaskId, moduleId) => rootTaskId === root.id && moduleId === "module-copy" ? [secondLeader.id] : [],
  });
  assert.equal(first.departmentPresentation?.moduleTitle, second.departmentPresentation?.moduleTitle);
  assert.notEqual(first.departmentPresentation?.taskId, second.departmentPresentation?.taskId);
  assert.equal(first.taskSummary, "组长 · 共享模块名");
  assert.equal(second.taskSummary, first.taskSummary);

  root.subTasks.push({ id: "module-ui", title: "duplicate module id", status: "running" });
  assert.equal(projectDepartmentConversationTab(tab("ambiguous-module", leader.id), leader, [], port).departmentPresentation, undefined);
});

test("projects an employee only when message identity and a unique execution session agree", () => {
  const { leader, port } = fixture();
  leader.subTasks.unshift({ id: "employee-undispatched", title: "尚未派发", status: "pending" });
  const result = projectDepartmentEmployeeConversationTab(tab("employee-tab", leader.id, "subtask", "employee-session"), leader, employeeMessages, port);
  assert.deepEqual(result.departmentPresentation, { role: "employee", rootTaskId: "department-root-abcdef", taskId: leader.id,
    moduleTitle: "共享模块名", employeeSubtaskId: "employee-subtask-789abc" });
  assert.equal(result.taskSummary, "员工 2 · 员工真实会话");

  assert.equal(projectDepartmentEmployeeConversationTab(tab("wrong-message", leader.id, "subtask", "employee-session"), leader,
    [{ ...employeeMessages[0], loopTaskId: "other-task" }], port).departmentPresentation, undefined);
  assert.equal(projectDepartmentEmployeeConversationTab(tab("wrong-session", leader.id, "subtask", "other-session"), leader,
    employeeMessages, port).departmentPresentation, undefined);
  assert.equal(projectDepartmentEmployeeConversationTab(tab("no-message", leader.id, "subtask", "employee-session"), leader,
    [], port).departmentPresentation, undefined);

  leader.subTasks.push({ id: "duplicate-session", title: "ambiguous", status: "running",
    executionSession: { cli: "codex", sessionId: "employee-session", configId: null } });
  assert.equal(projectDepartmentEmployeeConversationTab(tab("ambiguous", leader.id, "subtask", "employee-session"), leader,
    employeeMessages, port).departmentPresentation, undefined);
});

test("invalid department records and root/workspace conflicts fall back to ordinary Loop tabs", () => {
  const { root, leader, records, port } = fixture();
  const summary = tab("leader-tab", leader.id);
  leader.department = { ...leader.department!, rootTaskId: "another-root" };
  assert.equal(projectDepartmentConversationTab(summary, leader, [], port).departmentPresentation, undefined);
  leader.department = metadata(root.id, "leader", "missing-module", "同名");
  assert.equal(projectDepartmentConversationTab(summary, leader, [], port).departmentPresentation, undefined);
  leader.department = metadata(root.id, "leader", "module-ui", "同名");
  leader.workspaceKey = "workspace-b";
  assert.equal(projectDepartmentConversationTab(summary, leader, [], port).departmentPresentation, undefined);
  leader.workspaceKey = root.workspaceKey;
  leader.departmentInvalid = true;
  assert.equal(projectDepartmentConversationTab(summary, leader, [], port).departmentPresentation, undefined);

  const otherRoot = task("another-root"); otherRoot.department = metadata(otherRoot.id, "director", null, "另一个产研部");
  records.set(otherRoot.id, otherRoot);
  leader.departmentInvalid = false;
  leader.department = metadata(otherRoot.id, "leader", "module-ui", "同名");
  assert.equal(projectDepartmentConversationTab(summary, leader, [], port).departmentPresentation, undefined);
});

test("host projection reads only known task ids and reuses a root read within one state build", () => {
  const { root, leader } = fixture();
  root.sessionId = `${root.id}-session`;
  leader.sessionId = `${leader.id}-session`;
  const records = new Map([[root.id, root], [leader.id, leader]]);
  const { installVscodeMock } = require("../vscodeMock") as typeof import("../vscodeMock");
  installVscodeMock();
  const hostModule = require("../../extensionHost/sessionTabs") as typeof import("../../extensionHost/sessionTabs");
  const summaries = [{ ...tab("director-tab", root.id), taskSummary: "实现账号与报表功能" }, tab("leader-tab", leader.id),
    tab("employee-tab", leader.id, "subtask", "employee-session"), tab("ordinary", "missing-task")];
  const ordinaryReadIds: string[] = [];
  const ownershipReadIds: string[] = [];
  const membershipReads: string[] = [];
  type HostDeps = Parameters<typeof hostModule.createExtensionSessionTabsHost>[0];
  const host = hostModule.createExtensionSessionTabsHost({
    readOrdinaryConversationTabTaskRecord: (id: string) => { ordinaryReadIds.push(id); return records.get(id) ?? null; },
    readDepartmentTaskRecord: (id: string) => { ownershipReadIds.push(id); return records.get(id) ?? null; },
    readDepartmentLeaderTaskIds: (rootId: string, moduleId: string) => {
      membershipReads.push(`${rootId}:${moduleId}`);
      return rootId === root.id && moduleId === "module-ui" ? [leader.id] : [];
    },
    getSessionTabsController: () => ({ buildConversationTabsState: () => ({ activeTabId: "director-tab", tabs: summaries }) }),
    getSessionLifecycleController: () => ({}), getSessionStore: () => ({}), getCurrentCli: () => "codex", getActiveWorkspaceKey: () => "workspace-a",
    getWorkspaceSettings: () => ({}), getActiveTaskRun: () => null, getLiveMessagesForTab: () => employeeMessages,
    isTabRunActive: () => false,
    loadSessionMessages: () => employeeMessages, getPendingSessionDraft: () => ({ messages: employeeMessages }),
    setSessionStore: () => undefined, setCurrentCli: () => undefined, activeData: {},
  } as unknown as HostDeps);
  const state = host.buildConversationTabsState();
  assert.deepEqual(state.tabs.map((item) => item.departmentPresentation?.role), ["director", "leader", "employee", undefined]);
  assert.deepEqual(ordinaryReadIds, ["missing-task"]);
  assert.deepEqual(ownershipReadIds, [root.id, leader.id, "missing-task"]);
  assert.deepEqual(membershipReads, [`${root.id}:module-ui`, `${root.id}:module-ui`]);
  assert.equal(state.tabs[0].taskSummary, "实现账号与报表功能");
  assert.equal(state.tabs[1].taskSummary, "组长 · 共享模块名");
  assert.equal(state.tabs[2].taskSummary, "员工 1 · 员工真实会话");
  assert.equal(state.tabs[3].departmentPresentation, undefined);
});

test("ownership ambiguity or unavailable readers fail closed for department projection", () => {
  const { root, leader, port } = fixture();
  const summary = tab("leader-tab", leader.id);
  assert.equal(projectDepartmentConversationTab(summary, leader, [], { ...port, readTaskRecord: () => null }).departmentPresentation, undefined);
  assert.equal(projectDepartmentConversationTab(summary, leader, [], {
    ...port, readDepartmentLeaderTaskIds: () => null,
  }).departmentPresentation, undefined);
  assert.equal(projectDepartmentConversationTab(summary, leader, [], {
    ...port, readDepartmentLeaderTaskIds: () => [leader.id, "duplicate-leader-id"],
  }).departmentPresentation, undefined);
  assert.equal(projectDepartmentConversationTab(summary, leader, [], {
    ...port, readTaskRecord: (id) => id === root.id ? null : id === leader.id ? leader : null,
  }).departmentPresentation, undefined);
});
