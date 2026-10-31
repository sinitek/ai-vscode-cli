import type { ContinueModelChoice } from "../continueModelChoice";
import type { LoopPlusAcceptancePlan, LoopPlusAcceptancePlanSnapshot } from "../loopPlusAcceptancePlan";

export type LoopGroupChatPanelParticipant = {
  id: string;
  title: string;
  role: string;
  status: string;
  sessionId?: string | null;
  summary?: string;
  updatedAt?: number;
  lastStartedAt?: number | null;
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
};

export type LoopPlusPanelReviewItem = {
  eventId: string;
  subtaskId: string;
  attemptId: string;
  outcome: "completed" | "failed" | "stopped";
  detail: string | null;
};

export type LoopPlusPanelSeenAttempt = {
  subtaskId: string;
  attemptId: string;
  disposition: "open" | "finished" | "reviewed" | "closed";
  outcome?: "completed" | "failed" | "stopped";
  acceptance?: "passed" | "failed";
};

export type LoopPlusPanelActivity =
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
  currentReviewCount: number;
  reviewQueueCount: number;
  visibleReviewCount: number;
  running: LoopPlusPanelExecutionItem[];
  pending: LoopPlusPanelExecutionItem[];
  runningCount: number;
  pendingCount: number;
  seenAttempts: LoopPlusPanelSeenAttempt[];
} | {
  ok: false;
  schedulingMode: "event_driven";
  activity: "invalid";
  phase: "invalid";
  error: string;
};

export type LoopGroupChatPanelState = {
  loopPlus?: LoopPlusPanelProjection;
  continueModels?: ContinueModelChoice;
  task: {
    id: string;
    cli: string;
    status: string;
    rootPrompt: string;
    taskStoreFile: string;
    mainCommunicationFile: string;
    currentRound: number;
    updatedAt: number;
    canSupplement: boolean;
    canContinue: boolean;
    canStop: boolean;
  };
  rounds: LoopGroupChatPanelRound[];
  chatMarkdown: string;
  error?: string | null;
  clarification?: import("../orchestratorClarification").OrchestratorClarification | null;
  /** Loop+ 群聊可修改的验收方案模板与当前任务快照。 */
  acceptancePlans?: LoopPlusAcceptancePlan[];
  acceptancePlanSelection?: string;
  acceptancePlan?: LoopPlusAcceptancePlanSnapshot | null;
};

export type LoopGroupChatPanelMessage =
  | import("./chatImageHost").ChatImageMessage
  | { type: "loopGroupChatChat:refresh" }
  | { type: "loopGroupChatChat:domReady"; generation?: number }
  | { type: "loopGroupChatChat:continueTask"; prompt?: string; modelSource?: "original" | "current" }
  | { type: "loopGroupChatChat:supplementTask"; prompt?: string }
  | { type: "loopGroupChatChat:askMainModel"; prompt?: string }
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
