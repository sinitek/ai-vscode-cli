import type { CliName } from "./cli/types";
import {
  buildLobsterDebateModeratorArtifactFile,
  buildLobsterDebateParticipantArtifactFile,
  buildLobsterDebateParticipantTurnArtifactFile,
  LOBSTER_DEBATE_MODERATOR_ID,
  LOBSTER_DEBATE_MODERATOR_TITLE,
  type LobsterDebateActiveSpeakerRecord,
  type LobsterDebateModeratorDecisionRecord,
  type LobsterDebateParticipantRecord,
  type LobsterDebatePaths,
} from "./lobsterDebate";
import type { LobsterTaskRecord } from "./lobsterTaskStore";
import {
  buildLobsterDebateConsensusModelPrompt,
  buildLobsterDebateModeratorDisplayPrompt,
  buildLobsterDebateModeratorModelPrompt,
  buildLobsterDebateParticipantDisplayPrompt,
  buildLobsterDebateParticipantModelPrompt,
  buildLobsterDebateParticipantRosterModelPrompt,
  type LobsterDebateParticipantDefinition,
} from "./lobsterPromptBuilders";

export type LobsterDebateRunInput = {
  model?: string;
};

export type LobsterDebateRunPromptInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  model?: string;
};

export type LobsterDebateRunTarget = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

export type LobsterDebateSessionState = {
  participants: Partial<Record<string, string>>;
  moderator: string | null;
};

export type LobsterDebateParticipantRosterResult = {
  participants: LobsterDebateParticipantDefinition[];
  summary: string;
  openingSpeakerIds: string[];
  tabId: string;
  sessionId: string | null;
};

export type LobsterDebateParticipantRunResult = {
  participant: LobsterDebateParticipantRecord;
  tabId: string;
  sessionId: string | null;
};

export type LobsterDebateParticipantBatchRunItem = {
  participant: LobsterDebateParticipantDefinition;
  artifactFile: string;
  artifactText: string | null;
  result: LobsterDebateParticipantRunResult;
};

export type LobsterDebateModeratorRunResult = {
  decision: LobsterDebateModeratorDecisionRecord | null;
  tabId: string;
  sessionId: string | null;
};

export type LobsterDebateConsensusRunResult = {
  tabId: string;
  sessionId: string | null;
};

export type LobsterDebateRunnerDeps = {
  appendSystemMessageForLobster: (target: LobsterDebateRunTarget, content: string) => void;
  buildLobsterDebateConsensusStartedText: (taskId: string, round: number, paths: LobsterDebatePaths) => string;
  buildLobsterDebateModeratorFinishedText: (
    taskId: string,
    round: number,
    decision: LobsterDebateModeratorDecisionRecord,
    maxDialogueTurns: number,
    participants: readonly LobsterDebateParticipantDefinition[],
  ) => string;
  buildLobsterDebateModeratorStartedText: (taskId: string, round: number, dialogueTurn: number, artifactFile: string) => string;
  buildLobsterDebateParticipantFinishedText: (
    taskId: string,
    round: number,
    dialogueTurn: number,
    participant: LobsterDebateParticipantRecord,
    finalPass: boolean,
  ) => string;
  buildLobsterDebateParticipantRosterFailedText: (taskId: string, round: number, reasons: string[], paths: LobsterDebatePaths) => string;
  buildLobsterDebateParticipantRosterFinishedText: (
    taskId: string,
    round: number,
    participants: readonly LobsterDebateParticipantDefinition[],
    paths: LobsterDebatePaths,
  ) => string;
  buildLobsterDebateParticipantRosterStartedText: (taskId: string, round: number, paths: LobsterDebatePaths) => string;
  buildLobsterDebateParticipantStartedText: (
    taskId: string,
    round: number,
    dialogueTurn: number,
    title: string,
    artifactFile: string,
    finalPass: boolean,
  ) => string;
  createLobsterSubtaskRunTarget: (cli: CliName, options?: { sessionId?: string | null }) => LobsterDebateRunTarget;
  errorToMessage: (error: unknown) => string;
  getExistingLobsterDebateRoundStartedAt: (task: LobsterTaskRecord, round: number, debateRound: number) => number | null;
  logError: (event: string, payload?: unknown) => Promise<void>;
  readLobsterDebateModeratorDecisionArtifact: (
    artifactFile: string,
    dialogueTurn: number,
    participantIds: readonly string[],
  ) => LobsterDebateModeratorDecisionRecord | null;
  readLobsterDebateParticipantArtifact: (
    paths: LobsterDebatePaths,
    participant: LobsterDebateParticipantDefinition,
    model: string | undefined,
  ) => LobsterDebateParticipantRecord;
  readLobsterDebateParticipantRosterArtifact: (
    artifactFile: string,
  ) => { valid: true; participants: LobsterDebateParticipantDefinition[]; summary: string; openingSpeakerIds: string[] } | { valid: false; reasons: string[] };
  readLobsterDebateParticipantTurnArtifact: (
    participant: LobsterDebateParticipantDefinition,
    artifactFile: string,
    model: string | undefined,
  ) => LobsterDebateParticipantRecord;
  readTextFileIfNonEmpty: (filePath: string) => string | null;
  refreshOpenLobsterDebateChatPanelForTask: (taskId: string) => void;
  resolvePromptRunTargetSessionId: (target: LobsterDebateRunTarget) => string | null;
  runPrompt: (input: LobsterDebateRunPromptInput, options: { targetTabId?: string | null }) => Promise<void>;
  updateLobsterDebateActiveSpeakerRecord: (
    taskId: string,
    round: number,
    debateRound: number,
    startedAt: number,
    paths: LobsterDebatePaths,
    activeSpeaker: LobsterDebateActiveSpeakerRecord,
  ) => void;
  updateLobsterDebateModeratorDecisionRecord: (
    taskId: string,
    round: number,
    debateRound: number,
    decision: LobsterDebateModeratorDecisionRecord,
    startedAt: number,
    paths: LobsterDebatePaths,
  ) => void;
  updateLobsterDebateParticipantRecord: (
    taskId: string,
    round: number,
    debateRound: number,
    participant: LobsterDebateParticipantRecord,
    startedAt: number,
    briefFile: string,
    chatFile: string,
    activeSpeaker?: LobsterDebateActiveSpeakerRecord,
  ) => void;
  updateLobsterDebateParticipantRosterSessionRecord: (
    taskId: string,
    round: number,
    debateRound: number,
    sessionId: string | null,
    startedAt: number,
    paths: LobsterDebatePaths,
  ) => void;
};

function resolveLobsterDebateModel(input: LobsterDebateRunInput): string | undefined {
  return input.model;
}

export async function runLobsterDebateParticipantRoster(options: {
  deps: LobsterDebateRunnerDeps;
  input: LobsterDebateRunInput;
  mainTarget: LobsterDebateRunTarget;
  task: LobsterTaskRecord;
  round: number;
  debateRound: number;
  paths: LobsterDebatePaths;
  sessionId: string | null;
  startedAt: number;
}): Promise<(LobsterDebateParticipantRosterResult & { valid: true }) | {
  valid: false;
  reasons: string[];
  tabId: string;
  sessionId: string | null;
}> {
  const { deps, input, mainTarget, task, round, debateRound, paths, sessionId, startedAt } = options;
  const moderatorTarget = deps.createLobsterSubtaskRunTarget(task.cli, { sessionId });
  deps.updateLobsterDebateActiveSpeakerRecord(task.id, round, debateRound, startedAt, paths, {
    kind: "moderator",
    id: LOBSTER_DEBATE_MODERATOR_ID,
    title: "裁判主持人组队",
    updatedAt: Date.now(),
  });
  deps.appendSystemMessageForLobster(
    moderatorTarget,
    deps.buildLobsterDebateParticipantRosterStartedText(task.id, round, paths)
  );

  try {
    await deps.runPrompt({
      displayPrompt: `Loop 红蓝对抗第 ${round} 轮裁判主持人组队`,
      modelPrompt: buildLobsterDebateParticipantRosterModelPrompt(task, round, paths),
      contextTags: [],
      model: resolveLobsterDebateModel(input),
    }, { targetTabId: moderatorTarget.tabId });
  } catch (error) {
    void deps.logError("lobster-debate-participant-roster-run-error", {
      taskId: task.id,
      round,
      error: deps.errorToMessage(error),
    });
  }

  const completedSessionId = deps.resolvePromptRunTargetSessionId(moderatorTarget);
  const parsed = deps.readLobsterDebateParticipantRosterArtifact(paths.participantRosterFile);
  deps.updateLobsterDebateParticipantRosterSessionRecord(
    task.id,
    round,
    debateRound,
    completedSessionId,
    startedAt,
    paths
  );
  if (!parsed.valid) {
    deps.appendSystemMessageForLobster(mainTarget, deps.buildLobsterDebateParticipantRosterFailedText(task.id, round, parsed.reasons, paths));
    return {
      valid: false,
      reasons: parsed.reasons,
      tabId: moderatorTarget.tabId,
      sessionId: completedSessionId,
    };
  }
  deps.appendSystemMessageForLobster(
    mainTarget,
    deps.buildLobsterDebateParticipantRosterFinishedText(task.id, round, parsed.participants, paths)
  );
  return {
    valid: true,
    participants: parsed.participants,
    summary: parsed.summary,
    openingSpeakerIds: parsed.openingSpeakerIds,
    tabId: moderatorTarget.tabId,
    sessionId: completedSessionId,
  };
}

async function runLobsterDebateParticipant(options: {
  deps: LobsterDebateRunnerDeps;
  input: LobsterDebateRunInput;
  mainTarget: LobsterDebateRunTarget;
  task: LobsterTaskRecord;
  round: number;
  debateRound: number;
  dialogueTurn: number;
  maxDialogueTurns: number;
  finalPass: boolean;
  paths: LobsterDebatePaths;
  participant: LobsterDebateParticipantDefinition;
  artifactFile: string;
  sessionId: string | null;
  moderatorDecision: LobsterDebateModeratorDecisionRecord | null;
  startedAt: number;
}): Promise<LobsterDebateParticipantRunResult> {
  const {
    deps,
    input,
    mainTarget,
    task,
    round,
    debateRound,
    dialogueTurn,
    maxDialogueTurns,
    finalPass,
    paths,
    participant,
    artifactFile,
    sessionId,
    moderatorDecision,
    startedAt,
  } = options;
  const participantTarget = deps.createLobsterSubtaskRunTarget(task.cli, { sessionId });
  const runningRecord: LobsterDebateParticipantRecord = {
    id: participant.id,
    role: participant.role,
    title: participant.title,
    model: resolveLobsterDebateModel(input) ?? null,
    status: "running",
    artifactFile,
    sessionId,
    updatedAt: Date.now(),
  };
  deps.updateLobsterDebateParticipantRecord(
    task.id,
    round,
    debateRound,
    runningRecord,
    startedAt,
    paths.briefFile,
    paths.chatFile,
    {
      kind: "participant",
      id: participant.id,
      title: participant.title,
      dialogueTurn,
      finalPass,
      updatedAt: Date.now(),
    }
  );
  deps.refreshOpenLobsterDebateChatPanelForTask(task.id);
  deps.appendSystemMessageForLobster(
    participantTarget,
    deps.buildLobsterDebateParticipantStartedText(task.id, round, dialogueTurn, participant.title, artifactFile, finalPass)
  );

  try {
    await deps.runPrompt({
      displayPrompt: buildLobsterDebateParticipantDisplayPrompt(round, dialogueTurn, participant.title, finalPass),
      modelPrompt: buildLobsterDebateParticipantModelPrompt(
        task,
        round,
        dialogueTurn,
        maxDialogueTurns,
        finalPass,
        paths,
        participant,
        artifactFile,
        moderatorDecision
      ),
      contextTags: [],
      model: resolveLobsterDebateModel(input),
    }, { targetTabId: participantTarget.tabId });
  } catch (error) {
    void deps.logError("lobster-debate-participant-run-error", {
      taskId: task.id,
      round,
      participantId: participant.id,
      dialogueTurn,
      error: deps.errorToMessage(error),
    });
  }

  const completedSessionId = deps.resolvePromptRunTargetSessionId(participantTarget);
  const completedRecord = finalPass
    ? {
        ...deps.readLobsterDebateParticipantArtifact(paths, participant, resolveLobsterDebateModel(input)),
        sessionId: completedSessionId,
      }
    : {
        ...deps.readLobsterDebateParticipantTurnArtifact(participant, artifactFile, resolveLobsterDebateModel(input)),
        sessionId: completedSessionId,
      };
  deps.updateLobsterDebateParticipantRecord(task.id, round, debateRound, completedRecord, startedAt, paths.briefFile, paths.chatFile);
  deps.appendSystemMessageForLobster(
    mainTarget,
    deps.buildLobsterDebateParticipantFinishedText(task.id, round, dialogueTurn, completedRecord, finalPass)
  );
  return { participant: completedRecord, tabId: participantTarget.tabId, sessionId: completedSessionId };
}

export async function runLobsterDebateParticipantBatch(options: {
  deps: LobsterDebateRunnerDeps;
  input: LobsterDebateRunInput;
  mainTarget: LobsterDebateRunTarget;
  task: LobsterTaskRecord;
  round: number;
  debateRound: number;
  dialogueTurn: number;
  maxDialogueTurns: number;
  finalPass: boolean;
  paths: LobsterDebatePaths;
  participants: readonly LobsterDebateParticipantDefinition[];
  debateSessions: LobsterDebateSessionState;
  moderatorDecision: LobsterDebateModeratorDecisionRecord | null;
  startedAt: number;
}): Promise<LobsterDebateParticipantBatchRunItem[]> {
  const {
    deps,
    input,
    mainTarget,
    task,
    round,
    debateRound,
    dialogueTurn,
    maxDialogueTurns,
    finalPass,
    paths,
    participants,
    debateSessions,
    moderatorDecision,
    startedAt,
  } = options;
  const batchResults = await Promise.all(participants.map(async (participant): Promise<LobsterDebateParticipantBatchRunItem> => {
    const artifactFile = finalPass
      ? buildLobsterDebateParticipantArtifactFile(paths, participant.id)
      : buildLobsterDebateParticipantTurnArtifactFile(paths, participant.id, dialogueTurn);
    const result = await runLobsterDebateParticipant({
      deps,
      input,
      mainTarget,
      task,
      round,
      debateRound,
      dialogueTurn,
      maxDialogueTurns,
      finalPass,
      paths,
      participant,
      artifactFile,
      sessionId: debateSessions.participants[participant.id] ?? null,
      moderatorDecision,
      startedAt,
    });
    return {
      participant,
      artifactFile,
      artifactText: deps.readTextFileIfNonEmpty(artifactFile),
      result,
    };
  }));
  return batchResults;
}

export async function runLobsterDebateModerator(options: {
  deps: LobsterDebateRunnerDeps;
  input: LobsterDebateRunInput;
  mainTarget: LobsterDebateRunTarget;
  task: LobsterTaskRecord;
  round: number;
  debateRound: number;
  dialogueTurn: number;
  maxDialogueTurns: number;
  paths: LobsterDebatePaths;
  participants: readonly LobsterDebateParticipantDefinition[];
  sessionId: string | null;
  startedAt: number;
}): Promise<LobsterDebateModeratorRunResult> {
  const {
    deps,
    input,
    mainTarget,
    task,
    round,
    debateRound,
    dialogueTurn,
    maxDialogueTurns,
    paths,
    participants,
    sessionId,
    startedAt,
  } = options;
  const moderatorTarget = deps.createLobsterSubtaskRunTarget(task.cli, { sessionId });
  const artifactFile = buildLobsterDebateModeratorArtifactFile(paths, dialogueTurn);
  deps.updateLobsterDebateActiveSpeakerRecord(task.id, round, debateRound, startedAt, paths, {
    kind: "moderator",
    id: LOBSTER_DEBATE_MODERATOR_ID,
    title: LOBSTER_DEBATE_MODERATOR_TITLE,
    dialogueTurn,
    updatedAt: Date.now(),
  });
  deps.appendSystemMessageForLobster(
    moderatorTarget,
    deps.buildLobsterDebateModeratorStartedText(task.id, round, dialogueTurn, artifactFile)
  );

  try {
    await deps.runPrompt({
      displayPrompt: buildLobsterDebateModeratorDisplayPrompt(round, dialogueTurn, maxDialogueTurns),
      modelPrompt: buildLobsterDebateModeratorModelPrompt(
        task,
        round,
        dialogueTurn,
        maxDialogueTurns,
        paths,
        artifactFile
      ),
      contextTags: [],
      model: resolveLobsterDebateModel(input),
    }, { targetTabId: moderatorTarget.tabId });
  } catch (error) {
    void deps.logError("lobster-debate-moderator-run-error", {
      taskId: task.id,
      round,
      dialogueTurn,
      error: deps.errorToMessage(error),
    });
  }

  const completedSessionId = deps.resolvePromptRunTargetSessionId(moderatorTarget);
  const parsedDecision = deps.readLobsterDebateModeratorDecisionArtifact(
    artifactFile,
    dialogueTurn,
    participants.map((participant) => participant.id),
  );
  const decision = parsedDecision
    ? { ...parsedDecision, sessionId: completedSessionId }
    : null;
  if (decision) {
    deps.updateLobsterDebateModeratorDecisionRecord(task.id, round, debateRound, decision, startedAt, paths);
    deps.appendSystemMessageForLobster(
      mainTarget,
      deps.buildLobsterDebateModeratorFinishedText(task.id, round, decision, maxDialogueTurns, participants)
    );
  }
  return { decision, tabId: moderatorTarget.tabId, sessionId: completedSessionId };
}

export async function runLobsterDebateConsensusSummary(options: {
  deps: LobsterDebateRunnerDeps;
  input: LobsterDebateRunInput;
  target: LobsterDebateRunTarget;
  task: LobsterTaskRecord;
  round: number;
  debateRound: number;
  paths: LobsterDebatePaths;
  participants: LobsterDebateParticipantRecord[];
}): Promise<LobsterDebateConsensusRunResult> {
  const { deps, input, task, round, debateRound, paths, participants } = options;
  const consensusTarget = deps.createLobsterSubtaskRunTarget(task.cli);
  deps.updateLobsterDebateActiveSpeakerRecord(
    task.id,
    round,
    debateRound,
    deps.getExistingLobsterDebateRoundStartedAt(task, round, debateRound) ?? Date.now(),
    paths,
    {
      kind: "consensus",
      id: "consensus",
      title: "共识汇总器",
      updatedAt: Date.now(),
    }
  );
  deps.appendSystemMessageForLobster(consensusTarget, deps.buildLobsterDebateConsensusStartedText(task.id, round, paths));
  try {
    await deps.runPrompt({
      displayPrompt: `Loop 红蓝对抗共识汇总：第 ${round} 轮`,
      modelPrompt: buildLobsterDebateConsensusModelPrompt(task, round, paths, participants),
      contextTags: [],
      model: resolveLobsterDebateModel(input),
    }, { targetTabId: consensusTarget.tabId });
  } catch (error) {
    void deps.logError("lobster-debate-consensus-run-error", {
      taskId: task.id,
      round,
      error: deps.errorToMessage(error),
    });
  }
  return { tabId: consensusTarget.tabId, sessionId: deps.resolvePromptRunTargetSessionId(consensusTarget) };
}
