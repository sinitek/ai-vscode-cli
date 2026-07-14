import type { CliName } from "./cli/types";
import {
  buildLoopDebateModeratorArtifactFile,
  buildLoopDebateParticipantArtifactFile,
  buildLoopDebateParticipantTurnArtifactFile,
  LOOP_DEBATE_MODERATOR_ID,
  LOOP_DEBATE_MODERATOR_TITLE,
  type LoopDebateActiveSpeakerRecord,
  type LoopDebateModeratorDecisionRecord,
  type LoopDebateParticipantRecord,
  type LoopDebatePaths,
} from "./loopDebate";
import type { LoopTaskRecord } from "./loopTaskStore";
import {
  buildLoopDebateConsensusModelPrompt,
  buildLoopDebateModeratorDisplayPrompt,
  buildLoopDebateModeratorModelPrompt,
  buildLoopDebateParticipantDisplayPrompt,
  buildLoopDebateParticipantModelPrompt,
  buildLoopDebateParticipantRosterModelPrompt,
  type LoopDebateParticipantDefinition,
} from "./loopPromptBuilders";

export type LoopDebateRunInput = {
  model?: string;
};

export type LoopDebateRunPromptInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  model?: string;
};

export type LoopDebateRunTarget = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

export type LoopDebateSessionState = {
  participants: Partial<Record<string, string>>;
  moderator: string | null;
};

export type LoopDebateParticipantRosterResult = {
  participants: LoopDebateParticipantDefinition[];
  summary: string;
  openingSpeakerIds: string[];
  tabId: string;
  sessionId: string | null;
};

export type LoopDebateParticipantRunResult = {
  participant: LoopDebateParticipantRecord;
  tabId: string;
  sessionId: string | null;
};

export type LoopDebateParticipantBatchRunItem = {
  participant: LoopDebateParticipantDefinition;
  artifactFile: string;
  artifactText: string | null;
  result: LoopDebateParticipantRunResult;
};

export type LoopDebateModeratorRunResult = {
  decision: LoopDebateModeratorDecisionRecord | null;
  tabId: string;
  sessionId: string | null;
};

export type LoopDebateConsensusRunResult = {
  tabId: string;
  sessionId: string | null;
};

export type LoopDebateRunnerDeps = {
  appendSystemMessageForLoop: (target: LoopDebateRunTarget, content: string) => void;
  buildLoopDebateConsensusStartedText: (taskId: string, round: number, paths: LoopDebatePaths) => string;
  buildLoopDebateModeratorFinishedText: (
    taskId: string,
    round: number,
    decision: LoopDebateModeratorDecisionRecord,
    maxDialogueTurns: number,
    participants: readonly LoopDebateParticipantDefinition[],
  ) => string;
  buildLoopDebateModeratorStartedText: (taskId: string, round: number, dialogueTurn: number, artifactFile: string) => string;
  buildLoopDebateParticipantFinishedText: (
    taskId: string,
    round: number,
    dialogueTurn: number,
    participant: LoopDebateParticipantRecord,
    finalPass: boolean,
  ) => string;
  buildLoopDebateParticipantRosterFailedText: (taskId: string, round: number, reasons: string[], paths: LoopDebatePaths) => string;
  buildLoopDebateParticipantRosterFinishedText: (
    taskId: string,
    round: number,
    participants: readonly LoopDebateParticipantDefinition[],
    paths: LoopDebatePaths,
  ) => string;
  buildLoopDebateParticipantRosterStartedText: (taskId: string, round: number, paths: LoopDebatePaths) => string;
  buildLoopDebateParticipantStartedText: (
    taskId: string,
    round: number,
    dialogueTurn: number,
    title: string,
    artifactFile: string,
    finalPass: boolean,
  ) => string;
  createLoopSubtaskRunTarget: (cli: CliName, options?: { sessionId?: string | null }) => LoopDebateRunTarget;
  errorToMessage: (error: unknown) => string;
  getExistingLoopDebateRoundStartedAt: (task: LoopTaskRecord, round: number, debateRound: number) => number | null;
  logError: (event: string, payload?: unknown) => Promise<void>;
  readLoopDebateModeratorDecisionArtifact: (
    artifactFile: string,
    dialogueTurn: number,
    participantIds: readonly string[],
  ) => LoopDebateModeratorDecisionRecord | null;
  readLoopDebateParticipantArtifact: (
    paths: LoopDebatePaths,
    participant: LoopDebateParticipantDefinition,
    model: string | undefined,
  ) => LoopDebateParticipantRecord;
  readLoopDebateParticipantRosterArtifact: (
    artifactFile: string,
  ) => { valid: true; participants: LoopDebateParticipantDefinition[]; summary: string; openingSpeakerIds: string[] } | { valid: false; reasons: string[] };
  readLoopDebateParticipantTurnArtifact: (
    participant: LoopDebateParticipantDefinition,
    artifactFile: string,
    model: string | undefined,
  ) => LoopDebateParticipantRecord;
  readTextFileIfNonEmpty: (filePath: string) => string | null;
  refreshOpenLoopGroupChatPanelForTask: (taskId: string) => void;
  resolvePromptRunTargetSessionId: (target: LoopDebateRunTarget) => string | null;
  runPrompt: (input: LoopDebateRunPromptInput, options: { targetTabId?: string | null }) => Promise<void>;
  updateLoopDebateActiveSpeakerRecord: (
    taskId: string,
    round: number,
    debateRound: number,
    startedAt: number,
    paths: LoopDebatePaths,
    activeSpeaker: LoopDebateActiveSpeakerRecord,
  ) => void;
  updateLoopDebateModeratorDecisionRecord: (
    taskId: string,
    round: number,
    debateRound: number,
    decision: LoopDebateModeratorDecisionRecord,
    startedAt: number,
    paths: LoopDebatePaths,
  ) => void;
  updateLoopDebateParticipantRecord: (
    taskId: string,
    round: number,
    debateRound: number,
    participant: LoopDebateParticipantRecord,
    startedAt: number,
    briefFile: string,
    chatFile: string,
    activeSpeaker?: LoopDebateActiveSpeakerRecord,
  ) => void;
  updateLoopDebateParticipantRosterSessionRecord: (
    taskId: string,
    round: number,
    debateRound: number,
    sessionId: string | null,
    startedAt: number,
    paths: LoopDebatePaths,
  ) => void;
};

function resolveLoopDebateModel(input: LoopDebateRunInput): string | undefined {
  return input.model;
}

export async function runLoopDebateParticipantRoster(options: {
  deps: LoopDebateRunnerDeps;
  input: LoopDebateRunInput;
  mainTarget: LoopDebateRunTarget;
  task: LoopTaskRecord;
  round: number;
  debateRound: number;
  paths: LoopDebatePaths;
  sessionId: string | null;
  startedAt: number;
}): Promise<(LoopDebateParticipantRosterResult & { valid: true }) | {
  valid: false;
  reasons: string[];
  tabId: string;
  sessionId: string | null;
}> {
  const { deps, input, mainTarget, task, round, debateRound, paths, sessionId, startedAt } = options;
  const moderatorTarget = deps.createLoopSubtaskRunTarget(task.cli, { sessionId });
  deps.updateLoopDebateActiveSpeakerRecord(task.id, round, debateRound, startedAt, paths, {
    kind: "moderator",
    id: LOOP_DEBATE_MODERATOR_ID,
    title: "裁判主持人组队",
    updatedAt: Date.now(),
  });
  deps.appendSystemMessageForLoop(
    moderatorTarget,
    deps.buildLoopDebateParticipantRosterStartedText(task.id, round, paths)
  );

  try {
    await deps.runPrompt({
      displayPrompt: `Loop 红蓝对抗第 ${round} 轮裁判主持人组队`,
      modelPrompt: buildLoopDebateParticipantRosterModelPrompt(task, round, paths),
      contextTags: [],
      model: resolveLoopDebateModel(input),
    }, { targetTabId: moderatorTarget.tabId });
  } catch (error) {
    void deps.logError("loop-debate-participant-roster-run-error", {
      taskId: task.id,
      round,
      error: deps.errorToMessage(error),
    });
  }

  const completedSessionId = deps.resolvePromptRunTargetSessionId(moderatorTarget);
  const parsed = deps.readLoopDebateParticipantRosterArtifact(paths.participantRosterFile);
  deps.updateLoopDebateParticipantRosterSessionRecord(
    task.id,
    round,
    debateRound,
    completedSessionId,
    startedAt,
    paths
  );
  if (!parsed.valid) {
    deps.appendSystemMessageForLoop(mainTarget, deps.buildLoopDebateParticipantRosterFailedText(task.id, round, parsed.reasons, paths));
    return {
      valid: false,
      reasons: parsed.reasons,
      tabId: moderatorTarget.tabId,
      sessionId: completedSessionId,
    };
  }
  deps.appendSystemMessageForLoop(
    mainTarget,
    deps.buildLoopDebateParticipantRosterFinishedText(task.id, round, parsed.participants, paths)
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

async function runLoopDebateParticipant(options: {
  deps: LoopDebateRunnerDeps;
  input: LoopDebateRunInput;
  mainTarget: LoopDebateRunTarget;
  task: LoopTaskRecord;
  round: number;
  debateRound: number;
  dialogueTurn: number;
  maxDialogueTurns: number;
  finalPass: boolean;
  paths: LoopDebatePaths;
  participant: LoopDebateParticipantDefinition;
  artifactFile: string;
  sessionId: string | null;
  moderatorDecision: LoopDebateModeratorDecisionRecord | null;
  startedAt: number;
}): Promise<LoopDebateParticipantRunResult> {
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
  const participantTarget = deps.createLoopSubtaskRunTarget(task.cli, { sessionId });
  const runningRecord: LoopDebateParticipantRecord = {
    id: participant.id,
    role: participant.role,
    title: participant.title,
    model: resolveLoopDebateModel(input) ?? null,
    status: "running",
    artifactFile,
    sessionId,
    updatedAt: Date.now(),
  };
  deps.updateLoopDebateParticipantRecord(
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
  deps.refreshOpenLoopGroupChatPanelForTask(task.id);
  deps.appendSystemMessageForLoop(
    participantTarget,
    deps.buildLoopDebateParticipantStartedText(task.id, round, dialogueTurn, participant.title, artifactFile, finalPass)
  );

  try {
    await deps.runPrompt({
      displayPrompt: buildLoopDebateParticipantDisplayPrompt(round, dialogueTurn, participant.title, finalPass),
      modelPrompt: buildLoopDebateParticipantModelPrompt(
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
      model: resolveLoopDebateModel(input),
    }, { targetTabId: participantTarget.tabId });
  } catch (error) {
    void deps.logError("loop-debate-participant-run-error", {
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
        ...deps.readLoopDebateParticipantArtifact(paths, participant, resolveLoopDebateModel(input)),
        sessionId: completedSessionId,
      }
    : {
        ...deps.readLoopDebateParticipantTurnArtifact(participant, artifactFile, resolveLoopDebateModel(input)),
        sessionId: completedSessionId,
      };
  deps.updateLoopDebateParticipantRecord(task.id, round, debateRound, completedRecord, startedAt, paths.briefFile, paths.chatFile);
  deps.appendSystemMessageForLoop(
    mainTarget,
    deps.buildLoopDebateParticipantFinishedText(task.id, round, dialogueTurn, completedRecord, finalPass)
  );
  return { participant: completedRecord, tabId: participantTarget.tabId, sessionId: completedSessionId };
}

export async function runLoopDebateParticipantBatch(options: {
  deps: LoopDebateRunnerDeps;
  input: LoopDebateRunInput;
  mainTarget: LoopDebateRunTarget;
  task: LoopTaskRecord;
  round: number;
  debateRound: number;
  dialogueTurn: number;
  maxDialogueTurns: number;
  finalPass: boolean;
  paths: LoopDebatePaths;
  participants: readonly LoopDebateParticipantDefinition[];
  debateSessions: LoopDebateSessionState;
  moderatorDecision: LoopDebateModeratorDecisionRecord | null;
  startedAt: number;
}): Promise<LoopDebateParticipantBatchRunItem[]> {
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
  const batchResults = await Promise.all(participants.map(async (participant): Promise<LoopDebateParticipantBatchRunItem> => {
    const artifactFile = finalPass
      ? buildLoopDebateParticipantArtifactFile(paths, participant.id)
      : buildLoopDebateParticipantTurnArtifactFile(paths, participant.id, dialogueTurn);
    const result = await runLoopDebateParticipant({
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

export async function runLoopDebateModerator(options: {
  deps: LoopDebateRunnerDeps;
  input: LoopDebateRunInput;
  mainTarget: LoopDebateRunTarget;
  task: LoopTaskRecord;
  round: number;
  debateRound: number;
  dialogueTurn: number;
  maxDialogueTurns: number;
  paths: LoopDebatePaths;
  participants: readonly LoopDebateParticipantDefinition[];
  sessionId: string | null;
  startedAt: number;
}): Promise<LoopDebateModeratorRunResult> {
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
  const moderatorTarget = deps.createLoopSubtaskRunTarget(task.cli, { sessionId });
  const artifactFile = buildLoopDebateModeratorArtifactFile(paths, dialogueTurn);
  deps.updateLoopDebateActiveSpeakerRecord(task.id, round, debateRound, startedAt, paths, {
    kind: "moderator",
    id: LOOP_DEBATE_MODERATOR_ID,
    title: LOOP_DEBATE_MODERATOR_TITLE,
    dialogueTurn,
    updatedAt: Date.now(),
  });
  deps.appendSystemMessageForLoop(
    moderatorTarget,
    deps.buildLoopDebateModeratorStartedText(task.id, round, dialogueTurn, artifactFile)
  );

  try {
    await deps.runPrompt({
      displayPrompt: buildLoopDebateModeratorDisplayPrompt(round, dialogueTurn, maxDialogueTurns),
      modelPrompt: buildLoopDebateModeratorModelPrompt(
        task,
        round,
        dialogueTurn,
        maxDialogueTurns,
        paths,
        artifactFile
      ),
      contextTags: [],
      model: resolveLoopDebateModel(input),
    }, { targetTabId: moderatorTarget.tabId });
  } catch (error) {
    void deps.logError("loop-debate-moderator-run-error", {
      taskId: task.id,
      round,
      dialogueTurn,
      error: deps.errorToMessage(error),
    });
  }

  const completedSessionId = deps.resolvePromptRunTargetSessionId(moderatorTarget);
  const parsedDecision = deps.readLoopDebateModeratorDecisionArtifact(
    artifactFile,
    dialogueTurn,
    participants.map((participant) => participant.id),
  );
  const decision = parsedDecision
    ? { ...parsedDecision, sessionId: completedSessionId }
    : null;
  if (decision) {
    deps.updateLoopDebateModeratorDecisionRecord(task.id, round, debateRound, decision, startedAt, paths);
    deps.appendSystemMessageForLoop(
      mainTarget,
      deps.buildLoopDebateModeratorFinishedText(task.id, round, decision, maxDialogueTurns, participants)
    );
  }
  return { decision, tabId: moderatorTarget.tabId, sessionId: completedSessionId };
}

export async function runLoopDebateConsensusSummary(options: {
  deps: LoopDebateRunnerDeps;
  input: LoopDebateRunInput;
  target: LoopDebateRunTarget;
  task: LoopTaskRecord;
  round: number;
  debateRound: number;
  paths: LoopDebatePaths;
  participants: LoopDebateParticipantRecord[];
  compactSkillCatalogSection?: string;
}): Promise<LoopDebateConsensusRunResult> {
  const {
    deps,
    input,
    task,
    round,
    debateRound,
    paths,
    participants,
    compactSkillCatalogSection,
  } = options;
  const consensusTarget = deps.createLoopSubtaskRunTarget(task.cli);
  deps.updateLoopDebateActiveSpeakerRecord(
    task.id,
    round,
    debateRound,
    deps.getExistingLoopDebateRoundStartedAt(task, round, debateRound) ?? Date.now(),
    paths,
    {
      kind: "consensus",
      id: "consensus",
      title: "共识汇总器",
      updatedAt: Date.now(),
    }
  );
  deps.appendSystemMessageForLoop(consensusTarget, deps.buildLoopDebateConsensusStartedText(task.id, round, paths));
  try {
    await deps.runPrompt({
      displayPrompt: `Loop 红蓝对抗共识汇总：第 ${round} 轮`,
      modelPrompt: buildLoopDebateConsensusModelPrompt(
        task,
        round,
        paths,
        participants,
        compactSkillCatalogSection,
      ),
      contextTags: [],
      model: resolveLoopDebateModel(input),
    }, { targetTabId: consensusTarget.tabId });
  } catch (error) {
    void deps.logError("loop-debate-consensus-run-error", {
      taskId: task.id,
      round,
      error: deps.errorToMessage(error),
    });
  }
  return { tabId: consensusTarget.tabId, sessionId: deps.resolvePromptRunTargetSessionId(consensusTarget) };
}
