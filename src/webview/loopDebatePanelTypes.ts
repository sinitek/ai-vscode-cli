export type LoopDebateChatPanelParticipant = {
  id: string;
  title: string;
  role: string;
  status: string;
  stance?: string;
  sessionId?: string | null;
  summary?: string;
  updatedAt?: number;
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

export type LoopDebateChatPanelState = {
  mode: "main_sub" | "debate";
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
  | { type: "loopDebateChat:continueTask"; prompt?: string }
  | { type: "loopDebateChat:supplementTask"; prompt?: string }
  | { type: "loopDebateChat:stopTask" };
