export type LobsterDebateChatPanelParticipant = {
  id: string;
  title: string;
  role: string;
  status: string;
  stance?: string;
  sessionId?: string | null;
  summary?: string;
  updatedAt?: number;
};

export type LobsterDebateChatPanelModeratorDecision = {
  dialogueTurn: number;
  action: string;
  reason: string;
  sessionId?: string | null;
  updatedAt?: number;
};

export type LobsterDebateChatPanelActiveSpeaker = {
  kind: "main" | "subtask" | "participant" | "moderator" | "consensus";
  id: string;
  title: string;
  dialogueTurn?: number;
  finalPass?: boolean;
  updatedAt?: number;
};

export type LobsterDebateChatPanelRound = {
  key: string;
  kind?: "debate" | "execution";
  label?: string;
  lobsterRound: number;
  debateRound: number;
  status: string;
  chatFile?: string;
  participantRosterSessionId?: string | null;
  dialogueTurns?: number;
  activeSpeaker?: LobsterDebateChatPanelActiveSpeaker;
  startedAt: number;
  completedAt?: number;
  participants: LobsterDebateChatPanelParticipant[];
  moderatorDecisions: LobsterDebateChatPanelModeratorDecision[];
  consensusSummary?: string;
  consensusReached?: boolean;
  openDisagreementCount?: number;
};

export type LobsterDebateChatPanelState = {
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
  rounds: LobsterDebateChatPanelRound[];
  chatMarkdown: string;
  error?: string | null;
};

export type LobsterDebateChatPanelMessage =
  | { type: "lobsterDebateChat:refresh" }
  | { type: "lobsterDebateChat:continueTask"; prompt?: string }
  | { type: "lobsterDebateChat:supplementTask"; prompt?: string }
  | { type: "lobsterDebateChat:stopTask" };
