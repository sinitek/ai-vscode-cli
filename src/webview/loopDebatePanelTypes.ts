import type { ContinueModelChoice } from "../continueModelChoice";

export type LoopDebateChatPanelParticipant = {
  id: string;
  title: string;
  role: string;
  status: string;
  stance?: string;
  sessionId?: string | null;
  summary?: string;
  updatedAt?: number;
  lastStartedAt?: number | null;
};

export type LoopDebateChatPanelModeratorDecision = {
  dialogueTurn: number;
  action: string;
  reason: string;
  sessionId?: string | null;
  updatedAt?: number;
};

export type LoopDebateChatPanelActiveSpeaker = {
  kind: "main" | "subtask" | "participant" | "moderator" | "consensus";
  id: string;
  title: string;
  dialogueTurn?: number;
  finalPass?: boolean;
  updatedAt?: number;
};

export type LoopDebateChatPanelRound = {
  key: string;
  kind?: "debate" | "execution";
  label?: string;
  loopRound: number;
  debateRound: number;
  status: string;
  chatFile?: string;
  participantRosterSessionId?: string | null;
  dialogueTurns?: number;
  activeSpeaker?: LoopDebateChatPanelActiveSpeaker;
  startedAt: number;
  completedAt?: number;
  participants: LoopDebateChatPanelParticipant[];
  moderatorDecisions: LoopDebateChatPanelModeratorDecision[];
  consensusSummary?: string;
  consensusReached?: boolean;
  openDisagreementCount?: number;
};

export type LoopPlusPanelExecutionItem = {
  subtaskId: string;
  attemptId: string;
  title: string | null;
  state: "running" | "pending";
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
  disposition: "open" | "finished" | "reviewed";
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

export type LoopDebateChatPanelState = {
  mode: "main_sub" | "debate";
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
  rounds: LoopDebateChatPanelRound[];
  chatMarkdown: string;
  error?: string | null;
};

export type LoopDebateChatPanelMessage =
  | { type: "loopDebateChat:refresh" }
  | { type: "loopDebateChat:continueTask"; prompt?: string; modelSource?: "original" | "current" }
  | { type: "loopDebateChat:supplementTask"; prompt?: string }
  | { type: "loopDebateChat:stopTask" }
  | { type: "loopDebateChat:openCommunicationFile"; requestId?: string; path?: string };

export type LoopCommunicationFilePreviewMessage = {
  type: "loopDebateChat:communicationFile";
  requestId: string;
  path: string;
  ok: boolean;
  html?: string;
  error?: "invalid" | "forbidden" | "missing" | "unreadable" | "empty" | "too_large";
};
