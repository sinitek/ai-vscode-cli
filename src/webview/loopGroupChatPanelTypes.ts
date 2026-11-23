import type { LoopModelSwitchState } from "../loopModelSwitch";
import type { LoopPlusStatusSummary } from "../loopPlusStatusSummary";
import type { LoopPlusAcceptancePlan, LoopPlusAcceptancePlanSnapshot } from "../loopPlusAcceptancePlan";

export type LoopGroupChatPanelParticipant = {
  id: string;
  /** Actual Loop+ subtask identity when id identifies one employee attempt. */
  subtaskId?: string;
  title: string;
  role: string;
  status: string;
  sessionId?: string | null;
  summary?: string;
  updatedAt?: number;
  lastStartedAt?: number | null;
};

/** Trusted read-only snapshot; no allocation policy or reservation is computed in the Webview. */
export type DepartmentEmployeeAllocationProjection = {
  rootTaskId: string;
  revision: number;
  defaultLimit: number;
  leaders: Array<{
    leaderTaskId: string;
    source: "default" | "manual";
    desiredLimit: number;
    appliedLimit: number | null;
    activeEmployees: number | null;
    pending: boolean;
  }>;
};

export type DepartmentEmployeeLimitRequest = {
  requestId: string;
  leaderTaskId: string;
  employeeLimit: number | null;
  expectedRevision: number;
};

/** Read-only department UI contract. Employees are supplied by their actual leader.
 * A blank taskId means that leader chat has not been created; sessionId is a CLI
 * session identifier and is deliberately not used as chat availability evidence.
 */
export type DepartmentGroupChatProjection = {
  role: "director" | "leader";
  rootTaskId: string;
  parentTaskId?: string;
  title: string;
  director: LoopGroupChatPanelParticipant;
  leaders: Array<{
    taskId: string;
    leaderNumber: number;
    participant: LoopGroupChatPanelParticipant;
    progressPercent?: number;
    statusSummary?: Partial<LoopPlusStatusSummary>;
    employees: LoopGroupChatPanelParticipant[];
  }>;
  overallProgressPercent?: number;
  maxLeaders: number;
  maxEmployees: number;
  activeLeaders: number | null;
  activeEmployees: number | null;
  employeeAllocation?: DepartmentEmployeeAllocationProjection;
  employeeAllocationEditable?: boolean;
};

export type LoopGroupChatPanelActiveSpeaker = {
  kind: "main" | "subtask";
  id: string;
  title: string;
  updatedAt?: number;
};

export type LoopGroupChatPanelRound = {
  key: string;
  kind?: "execution";
  label?: string;
  loopRound: number;
  status: string;
  chatFile?: string;
  activeSpeaker?: LoopGroupChatPanelActiveSpeaker;
  startedAt: number;
  completedAt?: number;
  participants: LoopGroupChatPanelParticipant[];
};

export type LoopPlusPanelExecutionItem = {
  subtaskId: string;
  attemptId: string;
  title: string | null;
  state: "running" | "pending";
  interrupted?: boolean;
  repairing?: boolean;
  blockingDependencyLabels?: string[];
};

export type LoopPlusPanelReviewItem = {
  eventId: string;
  subtaskId: string;
  attemptId: string;
  outcome: "completed" | "failed" | "stopped";
  detail: string | null;
  repairing?: boolean;
};

export type LoopPlusPanelSeenAttempt = {
  subtaskId: string;
  attemptId: string;
  requiresAcceptance?: boolean;
  disposition: "open" | "finished" | "reviewed" | "reported" | "closed";
  outcome?: "completed" | "failed" | "stopped";
  acceptance?: "passed" | "failed" | "cancelled";
  acceptanceReason?: string;
  noRepairReason?: string;
};

export type LoopPlusPanelActivity =
  | "running"
  | "waiting"
  | "review_pending"
  | "reviewing"
  | "paused"
  | "stopped"
  | "completed"
  | "decomposing"
  | "idle"
  | "invalid";

export type LoopPlusPanelPhase =
  | "idle"
  | "waiting"
  | "review_ready"
  | "reviewing"
  | "stopped"
  | "completed"
  | "invalid";

export type LoopPlusPanelProjection = {
  ok: true;
  schedulingMode: "event_driven";
  activity: Exclude<LoopPlusPanelActivity, "invalid">;
  phase: Exclude<LoopPlusPanelPhase, "invalid">;
  wakePending: boolean;
  currentReview: LoopPlusPanelReviewItem | null;
  reviewQueue: LoopPlusPanelReviewItem[];
  activeReviewEventIds?: string[];
  currentReviewCount: number;
  reviewQueueCount: number;
  visibleReviewCount: number;
  running: LoopPlusPanelExecutionItem[];
  pending: LoopPlusPanelExecutionItem[];
  runningCount: number;
  pendingCount: number;
  repairRoundsBySubtask?: Readonly<Record<string, number>>;
  seenAttempts: LoopPlusPanelSeenAttempt[];
} | {
  ok: false;
  schedulingMode: "event_driven";
  activity: "invalid";
  phase: "invalid";
  error: string;
};

/** Host request feedback; capacity and persistent stopping flags are not stop receipts. */
export type DepartmentOrganizationStopState = "stopping" | "unconfirmed" | "confirmed";

export type LoopGroupChatPanelState = {
  department?: DepartmentGroupChatProjection;
  messageLimit?: number;
  mainModelBusy?: boolean;
  loopPlus?: LoopPlusPanelProjection;
  modelSwitch?: LoopModelSwitchState;
  task: {
    id: string;
    cli: string;
    status: string;
    rootPrompt: string;
    progressPercent?: number;
    taskStoreFile: string;
    mainCommunicationFile: string;
    currentRound: number;
    updatedAt: number;
    canSupplement: boolean;
    canContinue: boolean;
    canStop: boolean;
    departmentStopState?: DepartmentOrganizationStopState;
    departmentExecutionInterrupted?: boolean;
  };
  rounds: LoopGroupChatPanelRound[];
  chatMarkdown: string;
  error?: string | null;
  clarification?: import("../orchestratorClarification").OrchestratorClarification | null;
  /** Loop+ 群聊可修改的验收方案模板与当前任务快照。 */
  acceptancePlanReadOnly?: boolean;
  acceptancePlans?: LoopPlusAcceptancePlan[];
  acceptancePlanSelection?: string;
  acceptancePlan?: LoopPlusAcceptancePlanSnapshot | null;
};

export type LoopGroupChatPanelBaseMessage =
  | import("./chatImageHost").ChatImageMessage
  | import("./chatLinkHost").ChatLinkMessage
  /** Target only; the host must validate membership in the same department. */
  | { type: "loopGroupChatChat:openDepartmentTask"; taskId?: unknown }
  | ({ type: "loopGroupChatChat:updateDepartmentEmployeeLimit" } & DepartmentEmployeeLimitRequest)
  | { type: "loopGroupChatChat:refresh" }
  | { type: "loopGroupChatChat:openSubtaskConversation"; subtaskId?: string }
  | { type: "loopGroupChatChat:cancelSubtask"; subtaskId?: string }
  | { type: "loopGroupChatChat:domReady"; generation?: number }
  | { type: "loopGroupChatChat:loadingReady" }
  | { type: "loopGroupChatChat:copyText"; text: string }
  | { type: "loopGroupChatChat:continueTask"; prompt?: string; requestId?: string }
  | { type: "loopGroupChatChat:switchModels"; models?: Record<string, string>; thinkingModes?: Record<string, string> }
  | { type: "loopGroupChatChat:supplementTask"; prompt?: string }
  | { type: "loopGroupChatChat:askMainModel"; prompt?: string; requestId?: string }
  | { type: "loopGroupChatChat:abortMainModelQuestion" }
  | { type: "loopGroupChatChat:openAskDialog" }
  | { type: "loopGroupChatChat:closeAskDialog" }
  | { type: "loopGroupChatChat:dismissMainModelAnswer" }
  | { type: "loopGroupChatChat:stopTask" }
  | { type: "loopGroupChatChat:openCommunicationFile"; requestId?: string; path?: string }
  | { type: "loopGroupChatChat:submitClarification"; interactionId?: string; values?: Record<string, unknown> }
  | { type: "loopGroupChatChat:rejectClarification"; interactionId?: string }
  | { type: "saveLoopPlusAcceptancePlan"; planId?: string | null; name?: unknown; checks?: unknown; otherText?: unknown; select?: boolean }
  | { type: "selectLoopPlusAcceptancePlan"; planId?: unknown }
  | { type: "deleteLoopPlusAcceptancePlan"; planId?: unknown }
  | { type: "loopGroupChatChat:updateAcceptancePlan"; plan?: unknown };

export type LoopCommunicationFilePreviewMessage = {
  type: "loopGroupChatChat:communicationFile";
  requestId: string;
  path: string;
  ok: boolean;
  html?: string;
  error?: "invalid" | "forbidden" | "missing" | "unreadable" | "empty" | "too_large";
};

/** Browser instance IDs bind a view; they are never authority to operate on a task. */
export type DepartmentGroupChatModalTarget = { taskId: string; instanceId: string };

export type DepartmentGroupChatTaskMessage = Exclude<LoopGroupChatPanelBaseMessage,
  | { type: "saveLoopPlusAcceptancePlan" | "selectLoopPlusAcceptancePlan" | "deleteLoopPlusAcceptancePlan" | "loopGroupChatChat:updateAcceptancePlan" }
  | { type: "loopGroupChatChat:openDepartmentTask" | "loopGroupChatChat:updateDepartmentEmployeeLimit" }>;

export type LoopGroupChatPanelMessage = LoopGroupChatPanelBaseMessage
  | (DepartmentGroupChatModalTarget & { type: "loopGroupChatChat:departmentModal"; action: "load" | "retry" | "close" })
  | (DepartmentGroupChatModalTarget & { type: "loopGroupChatChat:departmentTaskMessage"; message: DepartmentGroupChatTaskMessage });

/** Presentation allowlist only. Host must independently authorize task, binding and payload. */
export const DEPARTMENT_GROUP_CHAT_TASK_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "loopGroupChatChat:domReady", "loopGroupChatChat:refresh", "loopGroupChatChat:continueTask",
  "loopGroupChatChat:copyText",
  "loopGroupChatChat:switchModels", "loopGroupChatChat:supplementTask", "loopGroupChatChat:askMainModel",
  "loopGroupChatChat:abortMainModelQuestion", "loopGroupChatChat:openAskDialog", "loopGroupChatChat:closeAskDialog",
  "loopGroupChatChat:dismissMainModelAnswer", "loopGroupChatChat:stopTask", "loopGroupChatChat:openCommunicationFile",
  "loopGroupChatChat:submitClarification", "loopGroupChatChat:rejectClarification",
  "previewChatImage", "resolveChatImage", "downloadChatImage", "openChatLink",
]);
