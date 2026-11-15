import type { DepartmentMetadata, DepartmentRole } from "../../../department";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../../loopPlusAcceptancePlan";
import { buildLoopGroupChatMessageAction } from "../../../panelStateBuilder";
import type { LoopTaskRecord } from "../../../loopTaskStore";

const now = Date.now();

function metadata(input: {
  rootTaskId: string;
  parentTaskId: string | null;
  leaderSubtaskId: string | null;
  role: DepartmentRole;
  moduleTitle: string;
}): DepartmentMetadata {
  return {
    version: 1,
    ...input,
    routes: { director: { cli: "codex" }, leader: { cli: "codex" }, employee: { cli: "codex" } },
    limits: { maxLeaders: 4, maxEmployees: 20 },
  };
}

function task(input: {
  id: string;
  workspaceKey: string;
  sessionId: string;
  rootTaskId: string;
  role: DepartmentRole;
  moduleId: string | null;
  moduleTitle: string;
  root: boolean;
}): LoopTaskRecord {
  return {
    id: input.id,
    cli: "codex",
    workspaceKey: input.workspaceKey,
    taskStoreFile: "",
    rootPrompt: `隔离 Extension Host 展示验证：${input.moduleTitle}`,
    taskKind: "development",
    schedulingMode: input.root ? "classic" : "event_driven",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    maxRounds: 20,
    currentRound: 1,
    communicationDir: "",
    mainCommunicationFile: "",
    sessionId: input.sessionId,
    subTasks: [],
    rounds: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
    department: metadata({
      rootTaskId: input.rootTaskId,
      parentTaskId: input.root ? null : input.rootTaskId,
      leaderSubtaskId: input.moduleId,
      role: input.role,
      moduleTitle: input.moduleTitle,
    }),
  };
}

export function createDepartmentConversationHostFixture(workspaceKey: string, nonce: string) {
  const rootTaskId = `host-department-root-${nonce}-r00000001`;
  const moduleOneId = `host-module-one-${nonce}-m00000011`;
  const moduleTwoId = `host-module-two-${nonce}-m00000012`;
  const leaderOneTaskId = `host-department-leader-one-${nonce}-l00000021`;
  const leaderTwoTaskId = `host-department-leader-two-${nonce}-l00000022`;
  const employeeSubtaskId = `host-employee-subtask-${nonce}-e00000031`;
  const directorSessionId = `host-director-session-${nonce}-s00000001`;
  const leaderOneSessionId = `host-leader-one-session-${nonce}-s00000002`;
  const leaderTwoSessionId = `host-leader-two-session-${nonce}-s00000003`;
  const employeeSessionId = `host-employee-session-${nonce}-s00000004`;
  const ordinarySessionId = `host-ordinary-session-${nonce}-s00000005`;
  const moduleTitle = "同名财务模块用于真实宿主验证的长标题";
  const root = task({ id: rootTaskId, workspaceKey, sessionId: directorSessionId, rootTaskId, role: "director",
    moduleId: null, moduleTitle: "产研部真实会话验证", root: true });
  root.loopPlusAcceptancePlan = buildSystemLoopPlusAcceptancePlanSnapshot();
  root.subTasks = [
    { id: moduleOneId, title: moduleTitle, status: "completed", executionSession: { cli: "codex", sessionId: leaderOneSessionId, configId: null } },
    { id: moduleTwoId, title: moduleTitle, status: "completed", executionSession: { cli: "codex", sessionId: leaderTwoSessionId, configId: null } },
  ];
  const leaderOne = task({ id: leaderOneTaskId, workspaceKey, sessionId: leaderOneSessionId, rootTaskId, role: "leader",
    moduleId: moduleOneId, moduleTitle, root: false });
  leaderOne.loopPlusAcceptancePlan = buildSystemLoopPlusAcceptancePlanSnapshot();
  leaderOne.subTasks = [{ id: employeeSubtaskId, title: "真实员工执行会话", status: "completed",
    executionSession: { cli: "codex", sessionId: employeeSessionId, configId: null } }];
  const leaderTwo = task({ id: leaderTwoTaskId, workspaceKey, sessionId: leaderTwoSessionId, rootTaskId, role: "leader",
    moduleId: moduleTwoId, moduleTitle, root: false });
  leaderTwo.loopPlusAcceptancePlan = buildSystemLoopPlusAcceptancePlanSnapshot();
  return {
    root, leaderOne, leaderTwo,
    directorMessageAction: buildLoopGroupChatMessageAction(rootTaskId),
    ids: { rootTaskId, leaderOneTaskId, leaderTwoTaskId, employeeSubtaskId, directorSessionId, leaderOneSessionId,
      leaderTwoSessionId, employeeSessionId, ordinarySessionId, moduleTitle },
  };
}
