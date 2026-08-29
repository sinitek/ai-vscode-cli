import * as fs from "fs";
import * as path from "path";
import type { CliName, ThinkingMode } from "../cli/types";
import type { GraphModelRole } from "../graph/types";
import type { I18nKey } from "../i18n";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import type { SubagentProgressController, SubagentProgressLabels, SubagentProgressUpdate } from "../subagentProgress";
import type { LoopTaskRole, TaskRunStatus } from "../promptRunState";
import type { LoopMainDecision, LoopSubtaskRecord, LoopTaskRecord } from "../loopTaskStore";
import type {
  LoopDebateActiveSpeakerRecord,
  LoopDebateConsensusRecord,
  LoopDebateDisagreementRecord,
  LoopDebateModeratorDecisionRecord,
  LoopDebateParticipantRecord,
  LoopDebateParticipantRole,
  LoopDebateParticipantStance,
  LoopDebatePaths,
  LoopDebateRoundRecord,
  LoopDebateRoundStatus,
} from "../loopDebate";
import type { LoopDebateParticipantDefinition } from "../loopPromptBuilders";
import type {
  LoopDebateParticipantBatchRunItem,
  LoopDebateRunnerDeps,
  LoopDebateSessionState,
} from "../loopDebateRunner";

export const LOOP_PARALLEL_SUBTASK_MAX = 6;
export const LOOP_SUBTASK_RETRY_MAX_RETRIES = 5;
export const LOOP_SUBTASK_RETRY_DELAY_MS = 60 * 1000;
export const LOOP_DEBATE_DEFAULT_DEBATE_ROUND = 1;
export const LOOP_DEBATE_ARTIFACT_SUMMARY_LIMIT = 1200;

type PromptRunRuntimeHostApi = ReturnType<typeof import("./promptRunRuntime").createPromptRunRuntimeHost>;
type LoopTaskStoreApi = typeof import("../loopTaskStore");
type PromptRunStateApi = typeof import("../promptRunState");
type LoopDebateApi = typeof import("../loopDebate");
type LoopPromptBuildersApi = typeof import("../loopPromptBuilders");
type LoopDebateRunnerApi = typeof import("../loopDebateRunner");
type LoopSubtaskProgressApi = typeof import("../loopSubtaskProgress");
type LoopParallelApi = typeof import("../loopParallel");
type LoopMainFailureApi = typeof import("../loopMainFailure");
type PanelStateBuilderApi = typeof import("../panelStateBuilder");
type WebviewCommandCoordinatorApi = typeof import("../webviewCommandCoordinator");
type CliTypesApi = typeof import("../cli/types");

type LoopOrchestrationPromptRunDeps = Pick<
  PromptRunRuntimeHostApi,
  | "appendSystemMessageForLoop"
  | "applyLoopMainDecision"
  | "extractJsonObjectText"
  | "finalizeLoopSubtaskRun"
  | "getActiveLoopSubtaskIds"
  | "getLastLoopAssistantContent"
  | "getLoopDecisionSubtasks"
  | "getLoopMessagesForTarget"
  | "getLoopRoundRunStatus"
  | "isLoopTaskExecutionInterrupted"
  | "markLoopSubtaskRunFinished"
  | "markLoopTaskInterrupted"
  | "parseLoopMainDecision"
  | "persistLoopMessagesForTarget"
>;

type LoopOrchestrationTaskStoreDeps = Pick<
  LoopTaskStoreApi,
  | "appendLoopRound"
  | "bindLoopTaskToSession"
  | "buildLoopSubtaskCommunicationFile"
  | "getLoopCommunicationPaths"
  | "prepareLoopSubtaskCommunicationFile"
  | "readLoopTaskRecord"
  | "updateLoopTaskRecord"
>;

type LoopOrchestrationDebateDeps = Pick<
  LoopDebateApi,
  | "LOOP_DEBATE_BLUE_TEAM_ROLE"
  | "LOOP_DEBATE_MAX_BATCH_SPEAKERS"
  | "LOOP_DEBATE_MAX_DIALOGUE_TURNS"
  | "LOOP_DEBATE_MODERATOR_ID"
  | "LOOP_DEBATE_PARTICIPANT_ROLES"
  | "LOOP_DEBATE_RED_TEAM_ROLE"
  | "buildLoopDebateModeratorArtifactFile"
  | "buildLoopDebateNeedsReviewSummary"
  | "buildLoopDebateParticipantArtifactFile"
  | "buildLoopDebatePaths"
  | "buildLoopMainSubChatTranscriptFile"
  | "buildLoopMainSubSubtaskTurnBody"
  | "findLatestLoopDebateModeratorSessionId"
  | "findLatestLoopDebateParticipantSessionId"
  | "formatLoopGroupChatMemberName"
  | "isLoopDebateAdversarialParticipantRole"
  | "normalizeLoopDebateModeratorAction"
  | "normalizeLoopDebateParticipantStance"
  | "normalizeLoopDebateSessionId"
  | "normalizeLoopDebateSpeakerIds"
  | "resolveLoopAnswerConclusion"
  | "selectDefaultLoopDebateOpeningSpeakerIds"
  | "validateLoopDebateConsensus"
>;

type LoopOrchestrationPromptBuilderDeps = Pick<
  LoopPromptBuildersApi,
  | "LOOP_DEBATE_MAX_PARTICIPANTS"
  | "LOOP_DEBATE_MIN_PARTICIPANTS"
  | "buildLoopDebateBriefMarkdown"
  | "buildLoopDebateChatTurnMarkdown"
  | "buildLoopDebateDialogueClosedMarkdown"
  | "buildLoopDebateDialogueTurnChatEventMarkdown"
  | "buildLoopDebateFinalParticipantMarkdown"
  | "buildLoopDebateInitialChatMarkdown"
  | "buildLoopDebateModeratorTurnMarkdown"
  | "buildLoopDebateParticipantRosterChatMarkdown"
  | "buildLoopDebateRuntimeForcedFinalizeMarkdown"
>;

type LoopOrchestrationRunnerDeps = Pick<
  LoopDebateRunnerApi,
  | "runLoopDebateConsensusSummary"
  | "runLoopDebateModerator"
  | "runLoopDebateParticipantBatch"
  | "runLoopDebateParticipantRoster"
>;

type LoopOrchestrationTextDeps = Pick<
  WebviewCommandCoordinatorApi,
  | "buildLoopCompletedConclusionAndSummaryMarkdown"
  | "buildLoopDebateConsensusReachedText"
  | "buildLoopDebateConsensusStartedText"
  | "buildLoopDebateDialogueTurnStartedText"
  | "buildLoopDebateFinalStanceStartedText"
  | "buildLoopDebateModeratorFinishedText"
  | "buildLoopDebateModeratorStartedText"
  | "buildLoopDebateNeedsReviewText"
  | "buildLoopDebateParticipantFinishedText"
  | "buildLoopDebateParticipantRosterFailedText"
  | "buildLoopDebateParticipantRosterFinishedText"
  | "buildLoopDebateParticipantRosterStartedText"
  | "buildLoopDebateParticipantStartedText"
  | "buildLoopDebateParticipantsCollectedText"
  | "buildLoopDebateRerunText"
  | "buildLoopDebateReuseText"
  | "buildLoopDebateStartedText"
  | "buildLoopRoundSummary"
  | "buildLoopSupplementalRequirementsLines"
>;

type LoopOrchestrationRequiredHostDeps =
  & LoopOrchestrationPromptRunDeps
  & LoopOrchestrationTaskStoreDeps
  & LoopOrchestrationDebateDeps
  & LoopOrchestrationPromptBuilderDeps
  & LoopOrchestrationRunnerDeps
  & LoopOrchestrationTextDeps
  & Pick<PromptRunStateApi, "appendMessageToStore">
  & Pick<LoopSubtaskProgressApi, "createLoopSubtaskProgressMonitor" | "mapLoopRunStatusToSubagentStatus">
  & Pick<LoopParallelApi, "buildLoopSubtaskExecutionPlan">
  & Pick<LoopMainFailureApi, "buildResetLoopMainAiFailureState">
  & Pick<
    PanelStateBuilderApi,
    | "buildLoopSubtaskBatchCompletedText"
    | "buildLoopSubtaskBatchStartedText"
    | "buildLoopSubtaskExecutionGroupStartedText"
    | "buildLoopSubtaskStartedText"
    | "formatLoopEstimatedRemainingRounds"
    | "getLoopMainSubChatMainTitle"
    | "getLoopSubtaskDisplayTitle"
  >
  & Pick<CliTypesApi, "normalizeLoopExecutionMode">
  & {
    buildSubagentProgressLabels: () => SubagentProgressLabels;
    buildLoopSubtaskRetryText: (taskId: string, subtaskId: string, retryCount: number) => string;
    closeConversationTabAndRefreshPanel: (tabId: string) => Promise<void>;
    createLoopSubtaskRunTarget: (cli: CliName, options?: { sessionId?: string | null }) => PromptRunTarget;
    createMessageId: () => string;
    createSubagentProgressController: typeof import("../subagentProgress").createSubagentProgressController;
    ensureLoopMainSubChatTranscript: (task: LoopTaskRecord) => string;
    errorToMessage: (error: unknown) => string;
    logError: (event: string, payload?: unknown) => void | Promise<void>;
    normalizeLoopContinuePromptForPrompt: (value: unknown) => string | null;
    refreshOpenLoopGroupChatPanelForTask: (taskId: string) => void;
    resolveLoopTaskSessionId: (target: PromptRunTarget) => string | null;
    resolvePromptRunModelForRole: (input: PromptRunInput, role: GraphModelRole) => string | undefined;
    resolvePromptRunTargetSessionId: (target: PromptRunTarget) => string | null;
    resolvePromptRunThinkingModeForRole: (
      input: PromptRunInput,
      cli: CliName,
      role: GraphModelRole,
      model: string | undefined,
      options?: { applySubtaskCap?: boolean },
    ) => ThinkingMode | undefined;
    runPrompt: (
      input: PromptRunInput,
      options?: { targetTabId?: string | null; resumeTaskId?: string; resumeRequested?: boolean },
    ) => Promise<void>;
    sendPanelMessage: (payload: Record<string, unknown>) => void;
    switchVisibleConversationTabForLoop: (tabId: string) => Promise<{ cli: CliName; sessionId: string | null } | null>;
    t: (key: I18nKey, params?: Record<string, string | number | boolean>) => string;
  };

export type LoopOrchestrationHostDeps = Partial<LoopOrchestrationRequiredHostDeps>;

export function createLoopOrchestrationHost(deps: LoopOrchestrationHostDeps) {
  const requiredDeps = deps as LoopOrchestrationRequiredHostDeps;
  const {
    LOOP_DEBATE_BLUE_TEAM_ROLE,
    LOOP_DEBATE_MAX_BATCH_SPEAKERS,
    LOOP_DEBATE_MAX_DIALOGUE_TURNS,
    LOOP_DEBATE_MAX_PARTICIPANTS,
    LOOP_DEBATE_MIN_PARTICIPANTS,
    LOOP_DEBATE_MODERATOR_ID,
    LOOP_DEBATE_PARTICIPANT_ROLES,
    LOOP_DEBATE_RED_TEAM_ROLE,
    appendLoopRound,
    appendMessageToStore,
    appendSystemMessageForLoop,
    applyLoopMainDecision,
    bindLoopTaskToSession,
    buildLoopCompletedConclusionAndSummaryMarkdown,
    buildLoopDebateBriefMarkdown,
    buildLoopDebateChatTurnMarkdown,
    buildLoopDebateConsensusReachedText,
    buildLoopDebateConsensusStartedText,
    buildLoopDebateDialogueClosedMarkdown,
    buildLoopDebateDialogueTurnChatEventMarkdown,
    buildLoopDebateDialogueTurnStartedText,
    buildLoopDebateFinalParticipantMarkdown,
    buildLoopDebateFinalStanceStartedText,
    buildLoopDebateInitialChatMarkdown,
    buildLoopDebateModeratorArtifactFile,
    buildLoopDebateModeratorFinishedText,
    buildLoopDebateModeratorStartedText,
    buildLoopDebateModeratorTurnMarkdown,
    buildLoopDebateNeedsReviewSummary,
    buildLoopDebateNeedsReviewText,
    buildLoopDebateParticipantArtifactFile,
    buildLoopDebateParticipantFinishedText,
    buildLoopDebateParticipantRosterChatMarkdown,
    buildLoopDebateParticipantRosterFailedText,
    buildLoopDebateParticipantRosterFinishedText,
    buildLoopDebateParticipantRosterStartedText,
    buildLoopDebateParticipantStartedText,
    buildLoopDebateParticipantsCollectedText,
    buildLoopDebatePaths,
    buildLoopDebateRerunText,
    buildLoopDebateReuseText,
    buildLoopDebateRuntimeForcedFinalizeMarkdown,
    buildLoopDebateStartedText,
    buildLoopMainSubChatTranscriptFile,
    buildLoopMainSubSubtaskTurnBody,
    buildLoopRoundSummary,
    buildLoopSubtaskBatchCompletedText,
    buildLoopSubtaskBatchStartedText,
    buildLoopSubtaskCommunicationFile,
    buildLoopSubtaskExecutionGroupStartedText,
    buildLoopSubtaskExecutionPlan,
    buildLoopSubtaskRetryText,
    buildLoopSubtaskStartedText,
    buildLoopSupplementalRequirementsLines,
    buildResetLoopMainAiFailureState,
    buildSubagentProgressLabels,
    closeConversationTabAndRefreshPanel,
    createLoopSubtaskProgressMonitor,
    createLoopSubtaskRunTarget,
    createMessageId,
    createSubagentProgressController,
    ensureLoopMainSubChatTranscript,
    errorToMessage,
    extractJsonObjectText,
    finalizeLoopSubtaskRun,
    findLatestLoopDebateModeratorSessionId,
    findLatestLoopDebateParticipantSessionId,
    formatLoopEstimatedRemainingRounds,
    formatLoopGroupChatMemberName,
    getActiveLoopSubtaskIds,
    getLastLoopAssistantContent,
    getLoopCommunicationPaths,
    getLoopDecisionSubtasks,
    getLoopMainSubChatMainTitle,
    getLoopMessagesForTarget,
    getLoopRoundRunStatus,
    getLoopSubtaskDisplayTitle,
    isLoopDebateAdversarialParticipantRole,
    isLoopTaskExecutionInterrupted,
    logError,
    mapLoopRunStatusToSubagentStatus,
    markLoopSubtaskRunFinished,
    markLoopTaskInterrupted,
    normalizeLoopContinuePromptForPrompt,
    normalizeLoopDebateModeratorAction,
    normalizeLoopDebateParticipantStance,
    normalizeLoopDebateSessionId,
    normalizeLoopDebateSpeakerIds,
    normalizeLoopExecutionMode,
    parseLoopMainDecision,
    persistLoopMessagesForTarget,
    prepareLoopSubtaskCommunicationFile,
    readLoopTaskRecord,
    refreshOpenLoopGroupChatPanelForTask,
    resolveLoopAnswerConclusion,
    resolveLoopTaskSessionId,
    resolvePromptRunModelForRole,
    resolvePromptRunTargetSessionId,
    resolvePromptRunThinkingModeForRole,
    runLoopDebateConsensusSummary,
    runLoopDebateModerator,
    runLoopDebateParticipantBatch,
    runLoopDebateParticipantRoster,
    runPrompt,
    selectDefaultLoopDebateOpeningSpeakerIds,
    sendPanelMessage,
    switchVisibleConversationTabForLoop,
    t,
    updateLoopTaskRecord,
    validateLoopDebateConsensus,
  } = requiredDeps;

  async function runClassicLoopMainDecision(options: {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
    moderatorLed?: boolean;
  }): Promise<LoopMainDecisionRunResult> {
    const { input, target, task, round } = options;
    const moderatorLed = options.moderatorLed === true;
    let mainStatus: TaskRunStatus;
    try {
      mainStatus = await runLoopRound({
        input,
        target,
        task,
        round,
        role: "main",
        displayPrompt: moderatorLed
          ? buildLoopModeratorMainDisplayPrompt(task.rootPrompt, round)
          : buildLoopMainDisplayPrompt(task.rootPrompt, round),
        modelPrompt: moderatorLed
          ? buildLoopModeratorMainModelPrompt(
              input.loopContinuePrompt ? task.rootPrompt : (input.modelPrompt || task.rootPrompt),
              task,
              round,
              input.loopContinuePrompt,
            )
          : buildLoopMainModelPrompt(
              input.loopContinuePrompt ? task.rootPrompt : (input.modelPrompt || task.rootPrompt),
              task,
              round,
              input.loopContinuePrompt,
            ),
      });
    } catch (error) {
      void logError("loop-main-round-run-error", {
        taskId: task.id,
        round,
        error: errorToMessage(error),
      });
      markLoopTaskInterrupted(task.id, "error", target, {
        source: "main",
        failureMessage: errorToMessage(error),
      });
      return { status: "interrupted", task: readLoopTaskRecord(task.id) ?? task, runStatus: "error" };
    }
    if (mainStatus === "error" || mainStatus === "stopped") {
      return { status: "interrupted", task, runStatus: mainStatus };
    }

    const mainContent = getLastLoopAssistantContent(target, task.id, round, "main");
    const decision = parseLoopMainDecision(mainContent);
    if (!decision) {
      void logError("loop-main-decision-invalid", {
        taskId: task.id,
        round,
        cli: target.cli,
        hasAssistantContent: Boolean(mainContent?.trim()),
        assistantContentLength: mainContent?.length ?? 0,
      });
      const failedRecord = updateLoopTaskRecord(task.id, {
        status: "needs-review",
        activeSubtaskId: null,
        activeSubtaskIds: [],
        updatedAt: Date.now(),
        finalSummary: "Main task did not return a valid loop decision JSON.",
      }) ?? task;
      return { status: "needs-review", task: failedRecord };
    }

    return applyLoopMainDecisionForRun(task.id, decision);
  }

  function applyLoopMainDecisionForRun(
    taskId: string,
    decision: LoopMainDecision,
  ): LoopMainDecisionRunResult {
    updateLoopTaskRecord(taskId, {
      ...buildResetLoopMainAiFailureState(),
      updatedAt: Date.now(),
    });
    const decisionResult = applyLoopMainDecision(taskId, decision);
    if (decisionResult.status === "completed") {
      return { status: "completed", task: decisionResult.task, decision };
    }
    if (decisionResult.status === "blocked" || !decisionResult.subtasks?.length) {
      return { status: "needs-review", task: decisionResult.task, decision };
    }
    return {
      status: "continue",
      task: decisionResult.task,
      decision,
      subtasks: decisionResult.subtasks,
    };
  }

  type LoopDebateParticipantArtifactValidation = {
    valid: boolean;
    participants: LoopDebateParticipantRecord[];
    reasons: string[];
  };

  type LoopDebateReusableDecisionResult =
    | {
        status: "reusable";
        decision: LoopMainDecision;
        consensus: LoopDebateConsensusRecord<LoopMainDecision>;
        participants: LoopDebateParticipantRecord[];
      }
    | {
        status: "needs-review";
        reasons: string[];
        consensus?: LoopDebateConsensusRecord<LoopMainDecision>;
        participants: LoopDebateParticipantRecord[];
      }
    | { status: "rerun"; reasons: string[] };

  type LoopDebateSpeakerBatch = {
    speakerIds: string[];
    speakers: LoopDebateParticipantDefinition[];
  };

  function shouldRunLoopPlanningDebate(task: LoopTaskRecord, round: number): boolean {
    if (normalizeLoopExecutionMode(task.executionMode) !== "debate_multi_agent") {
      return false;
    }
    void round;
    return !findReusableLoopPlanningDebateRound(task);
  }

  function findReusableLoopPlanningDebateRound(
    task: LoopTaskRecord,
  ): LoopDebateRoundRecord<LoopMainDecision> | null {
    const rounds = Array.isArray(task.debateRounds) ? task.debateRounds : [];
    const sortedRounds = rounds
      .filter((round) => round.status === "consensus" && Boolean(round.consensus))
      .slice()
      .sort((left, right) => (
        left.loopRound - right.loopRound
        || left.debateRound - right.debateRound
        || left.startedAt - right.startedAt
      ));

    for (const round of sortedRounds) {
      const paths = buildLoopDebatePaths(task.communicationDir, round.loopRound, round.debateRound);
      const participants = resolveExistingLoopDebateParticipantRecords(
        task,
        round.loopRound,
        round.debateRound,
        paths,
        undefined,
        buildLoopDebateSessionState(task, round.loopRound, round.debateRound),
      );
      const reusable = evaluateReusableLoopDebateDecision(
        task,
        round.loopRound,
        round.debateRound,
        paths,
        participants,
      );
      if (reusable.status === "reusable" && reusable.decision.status !== "blocked") {
        return round;
      }
    }

    return null;
  }

  function readLoopPlanningDebateDecision(
    task: LoopTaskRecord,
    round: Pick<LoopDebateRoundRecord<LoopMainDecision>, "loopRound" | "debateRound">,
  ): LoopMainDecision | null {
    const paths = buildLoopDebatePaths(task.communicationDir, round.loopRound, round.debateRound);
    return parseLoopMainDecision(readTextFileIfNonEmpty(paths.decisionFile));
  }

  async function runLoopDebateRound(options: {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
  }): Promise<LoopMainDecisionRunResult> {
    const { input, target, task, round } = options;
    const debateRound = LOOP_DEBATE_DEFAULT_DEBATE_ROUND;
    const paths = buildLoopDebatePaths(task.communicationDir, round, debateRound);
    const model = resolveLoopDebateModel(input);
    const debateSessions = buildLoopDebateSessionState(task, round, debateRound);
    const reusableParticipants = resolveExistingLoopDebateParticipantRecords(
      task,
      round,
      debateRound,
      paths,
      model,
      debateSessions
    );
    const reusable = evaluateReusableLoopDebateDecision(task, round, debateRound, paths, reusableParticipants);
    if (reusable.status === "reusable") {
      upsertLoopDebateRoundRecord(task.id, {
        loopRound: round,
        debateRound,
        status: "consensus",
        startedAt: getExistingLoopDebateRoundStartedAt(task, round, debateRound) ?? Date.now(),
        completedAt: Date.now(),
        briefFile: paths.briefFile,
        chatFile: paths.chatFile,
        participantRosterFile: paths.participantRosterFile,
        participants: reusable.participants,
        consensus: reusable.consensus,
      });
      refreshOpenLoopGroupChatPanelForTask(task.id);
      appendSystemMessageForLoop(target, buildLoopDebateReuseText(task.id, round, paths));
      appendLoopDebateMainCommunicationLog(task, round, paths, "复用红蓝对抗共识", [
        `decision.json：${paths.decisionFile}`,
        `consensus.md：${paths.consensusFile}`,
      ]);
      return applyLoopMainDecisionForRun(task.id, reusable.decision);
    }
    if (reusable.status === "needs-review") {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: reusable.participants,
        consensus: reusable.consensus,
        reasons: reusable.reasons,
        status: "blocked",
      });
    }
    if (reusable.reasons.length > 0) {
      appendSystemMessageForLoop(target, buildLoopDebateRerunText(task.id, round, reusable.reasons));
    }

    const startedAt = Date.now();
    const briefWritten = writeTextFileEnsuringDir(
      paths.briefFile,
      buildLoopDebateBriefMarkdown(
        task,
        target,
        round,
        paths,
        input.loopContinuePrompt,
      )
    );
    if (!briefWritten) {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: [],
        reasons: [`无法写入辩论 brief：${paths.briefFile}`],
        status: "error",
      });
    }
    const chatWritten = writeTextFileEnsuringDir(paths.chatFile, buildLoopDebateInitialChatMarkdown(task, target, round, paths));
    if (!chatWritten) {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: [],
        reasons: [`无法写入红蓝对抗群聊记录：${paths.chatFile}`],
        status: "error",
      });
    }

    updateLoopTaskRecord(task.id, {
      status: "running",
      currentRound: round,
      activeSubtaskId: null,
      activeSubtaskIds: [],
      updatedAt: startedAt,
    });
    upsertLoopDebateRoundRecord(task.id, {
      loopRound: round,
      debateRound,
      status: "running",
      startedAt,
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      dialogueTurns: 0,
      participants: [],
      moderatorDecisions: [],
    });
    refreshOpenLoopGroupChatPanelForTask(task.id);

    const runnerDeps = getLoopDebateRunnerDeps();
    const debateTabIds: string[] = [];
    const rosterResult = await runLoopDebateParticipantRoster({
      deps: runnerDeps,
      input,
      mainTarget: target,
      task,
      round,
      debateRound,
      paths,
      sessionId: debateSessions.moderator,
      startedAt,
    });
    debateTabIds.push(rosterResult.tabId);
    if (rosterResult.sessionId) {
      debateSessions.moderator = rosterResult.sessionId;
    }
    await closeCompletedLoopDebateTabs([rosterResult.tabId]);
    if (!rosterResult.valid) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: [],
        reasons: rosterResult.reasons,
        status: "error",
      });
    }

    const participantDefinitions = rosterResult.participants;
    const participantRecords = buildLoopDebateParticipantRecords(
      paths,
      model,
      "pending",
      participantDefinitions
    ).map((participant) => ({
      ...participant,
      sessionId: debateSessions.participants[participant.id] ?? null,
    }));
    const rosterAppended = appendTextFileEnsuringDir(
      paths.chatFile,
      buildLoopDebateParticipantRosterChatMarkdown(
        participantDefinitions,
        rosterResult.summary,
        rosterResult.openingSpeakerIds,
      )
    );
    if (!rosterAppended) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: participantRecords,
        reasons: [`无法追加裁判主持人选定的红蓝参与者到群聊记录：${paths.chatFile}`],
        status: "error",
      });
    }

    upsertLoopDebateRoundRecord(task.id, {
      loopRound: round,
      debateRound,
      status: "running",
      startedAt,
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      dialogueTurns: 0,
      participants: participantRecords,
      moderatorDecisions: [],
    });
    refreshOpenLoopGroupChatPanelForTask(task.id);
    appendSystemMessageForLoop(target, buildLoopDebateStartedText(task.id, round, participantRecords, paths));

    let finalModeratorDecision: LoopDebateModeratorDecisionRecord | null = null;
    let completedDialogueTurns = 0;
    let currentSpeakerBatch = buildLoopDebateSpeakerBatch(participantDefinitions, rosterResult.openingSpeakerIds);
    if (currentSpeakerBatch.speakers.length === 0) {
      currentSpeakerBatch = buildLoopDebateSpeakerBatch(
        participantDefinitions,
        selectDefaultLoopDebateOpeningSpeakerIds(participantDefinitions),
      );
    }
    for (let dialogueTurn = 1; dialogueTurn <= LOOP_DEBATE_MAX_DIALOGUE_TURNS; dialogueTurn += 1) {
      completedDialogueTurns = dialogueTurn;
      if (currentSpeakerBatch.speakers.length === 0) {
        await closeCompletedLoopDebateTabs(debateTabIds);
        return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`裁判主持人未为第 ${dialogueTurn} 个发言批次指定有效发言者。`],
          status: "error",
        });
      }
      appendSystemMessageForLoop(
        target,
        buildLoopDebateDialogueTurnStartedText(
          task.id,
          round,
          dialogueTurn,
          LOOP_DEBATE_MAX_DIALOGUE_TURNS,
          currentSpeakerBatch.speakers,
          paths,
        )
      );
      const dialogueTurnEventAppended = appendTextFileEnsuringDir(
        paths.chatFile,
        buildLoopDebateDialogueTurnChatEventMarkdown(
          round,
          dialogueTurn,
          LOOP_DEBATE_MAX_DIALOGUE_TURNS,
          finalModeratorDecision,
          currentSpeakerBatch.speakers,
        )
      );
      if (!dialogueTurnEventAppended) {
        await closeCompletedLoopDebateTabs(debateTabIds);
        return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`无法追加辩论发言批次系统消息：${paths.chatFile}`],
          status: "error",
        });
      }
      refreshOpenLoopGroupChatPanelForTask(task.id);
      const participantBatch: LoopDebateParticipantBatchRunItem[] = await runLoopDebateParticipantBatch({
        deps: runnerDeps,
        input,
        mainTarget: target,
        task,
        round,
        debateRound,
        dialogueTurn,
        maxDialogueTurns: LOOP_DEBATE_MAX_DIALOGUE_TURNS,
        finalPass: false,
        paths,
        participants: currentSpeakerBatch.speakers,
        debateSessions,
        moderatorDecision: finalModeratorDecision,
        startedAt,
      });
      debateTabIds.push(...participantBatch.map((item) => item.result.tabId));
      participantBatch.forEach((item) => {
        if (item.result.sessionId) {
          debateSessions.participants[item.participant.id] = item.result.sessionId;
        }
      });
      await closeCompletedLoopDebateTabs(participantBatch.map((item) => item.result.tabId));
      const missingArtifacts = participantBatch.filter((item) => !item.artifactText);
      if (missingArtifacts.length > 0) {
        await closeCompletedLoopDebateTabs(debateTabIds);
        return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: missingArtifacts.map((item) => (
            `红蓝对抗发言批次 ${dialogueTurn} 参与者 ${item.participant.id} 未写入发言 artifact：${item.artifactFile}`
          )),
          status: "error",
        });
      }
      for (const item of participantBatch) {
        const appended = appendTextFileEnsuringDir(
          paths.chatFile,
          buildLoopDebateChatTurnMarkdown(
            dialogueTurn,
            item.participant.id,
            item.participant.title,
            item.artifactText ?? "",
          )
        );
  	      if (!appended) {
  	        await closeCompletedLoopDebateTabs(debateTabIds);
  	        return markLoopDebateNeedsReview({
            task,
            target,
            round,
            debateRound,
            paths,
            participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
            reasons: [`无法追加红蓝对抗群聊记录：${paths.chatFile}`],
            status: "error",
          });
        }
        refreshOpenLoopGroupChatPanelForTask(task.id);
      }

      const moderatorResult = await runLoopDebateModerator({
        deps: runnerDeps,
        input,
        mainTarget: target,
        task,
        round,
        debateRound,
        dialogueTurn,
        maxDialogueTurns: LOOP_DEBATE_MAX_DIALOGUE_TURNS,
        paths,
        sessionId: debateSessions.moderator,
        participants: participantDefinitions,
        startedAt,
      });
      debateTabIds.push(moderatorResult.tabId);
      if (moderatorResult.sessionId) {
        debateSessions.moderator = moderatorResult.sessionId;
      }
      await closeCompletedLoopDebateTabs([moderatorResult.tabId]);
      const moderatorArtifactFile = buildLoopDebateModeratorArtifactFile(paths, dialogueTurn);
      const moderatorText = readTextFileIfNonEmpty(moderatorArtifactFile);
      if (!moderatorText || !moderatorResult.decision) {
        await closeCompletedLoopDebateTabs(debateTabIds);
        return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`裁判主持人第 ${dialogueTurn} 轮控场 artifact 缺失、为空或无法解析：${moderatorArtifactFile}`],
          status: "error",
        });
      }
      finalModeratorDecision = moderatorResult.decision;
      const nextSpeakerBatch = buildLoopDebateSpeakerBatch(participantDefinitions, moderatorResult.decision.nextSpeakerIds);
      const moderatorAppended = appendTextFileEnsuringDir(
        paths.chatFile,
        buildLoopDebateModeratorTurnMarkdown(dialogueTurn, moderatorText)
      );
  	    if (!moderatorAppended) {
  	      await closeCompletedLoopDebateTabs(debateTabIds);
  	      return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`无法追加裁判主持人控场记录：${paths.chatFile}`],
          status: "error",
        });
      }
      refreshOpenLoopGroupChatPanelForTask(task.id);
      if (moderatorResult.decision.action === "continue" && nextSpeakerBatch.speakers.length === 0) {
        await closeCompletedLoopDebateTabs(debateTabIds);
        return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`裁判主持人第 ${dialogueTurn} 轮选择 continue，但未指定有效的下一批发言者。`],
          status: "error",
        });
      }
      if (moderatorResult.decision.action !== "continue") {
        break;
      }
      currentSpeakerBatch = nextSpeakerBatch;
      if (dialogueTurn === LOOP_DEBATE_MAX_DIALOGUE_TURNS) {
        finalModeratorDecision = {
          ...moderatorResult.decision,
          action: "finalize",
          reason: `已达到运行时最大安全上限 ${LOOP_DEBATE_MAX_DIALOGUE_TURNS} 个发言批次，强制进入最终立场收集。裁判主持人原始理由：${moderatorResult.decision.reason}`,
          nextSpeakerIds: [],
          updatedAt: Date.now(),
        };
        const capAppended = appendTextFileEnsuringDir(
          paths.chatFile,
          buildLoopDebateRuntimeForcedFinalizeMarkdown(finalModeratorDecision)
        );
  	      if (!capAppended) {
  	        await closeCompletedLoopDebateTabs(debateTabIds);
  	        return markLoopDebateNeedsReview({
            task,
            target,
            round,
            debateRound,
            paths,
            participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
            reasons: [`无法追加最大安全发言批次数收束记录：${paths.chatFile}`],
            status: "error",
          });
        }
        refreshOpenLoopGroupChatPanelForTask(task.id);
        break;
      }
    }

    if (!finalModeratorDecision) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: ["裁判主持人未输出任何控场决策。"],
        status: "error",
      });
    }

    appendSystemMessageForLoop(
      target,
      buildLoopDebateFinalStanceStartedText(task.id, round, finalModeratorDecision, paths)
    );
    const finalStanceBatch: LoopDebateParticipantBatchRunItem[] = await runLoopDebateParticipantBatch({
      deps: runnerDeps,
      input,
      mainTarget: target,
      task,
      round,
      debateRound,
      dialogueTurn: completedDialogueTurns,
      maxDialogueTurns: LOOP_DEBATE_MAX_DIALOGUE_TURNS,
      finalPass: true,
      paths,
      participants: participantDefinitions,
      debateSessions,
      moderatorDecision: finalModeratorDecision,
      startedAt,
    });
    debateTabIds.push(...finalStanceBatch.map((item) => item.result.tabId));
    finalStanceBatch.forEach((item) => {
      if (item.result.sessionId) {
        debateSessions.participants[item.participant.id] = item.result.sessionId;
      }
    });
    await closeCompletedLoopDebateTabs(finalStanceBatch.map((item) => item.result.tabId));
    const missingFinalArtifacts = finalStanceBatch.filter((item) => !item.artifactText);
    if (missingFinalArtifacts.length > 0) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: missingFinalArtifacts.map((item) => (
          `参与者 ${item.participant.id} 未写入最终立场 artifact：${item.artifactFile}`
        )),
        status: "error",
      });
    }
    for (const item of finalStanceBatch) {
      const appended = appendTextFileEnsuringDir(
        paths.chatFile,
        buildLoopDebateFinalParticipantMarkdown(
          item.participant.id,
          item.participant.title,
          item.artifactText ?? "",
        )
      );
  	    if (!appended) {
  	      await closeCompletedLoopDebateTabs(debateTabIds);
  	      return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`无法追加最终立场到红蓝对抗群聊记录：${paths.chatFile}`],
          status: "error",
        });
      }
      refreshOpenLoopGroupChatPanelForTask(task.id);
    }
    const chatClosed = appendTextFileEnsuringDir(
      paths.chatFile,
      buildLoopDebateDialogueClosedMarkdown(
        completedDialogueTurns,
        LOOP_DEBATE_MAX_DIALOGUE_TURNS,
        finalModeratorDecision
      )
    );
  	  if (!chatClosed) {
  	    await closeCompletedLoopDebateTabs(debateTabIds);
  	    return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`无法写入红蓝对抗群聊收束标记：${paths.chatFile}`],
        status: "error",
      });
    }
    refreshOpenLoopGroupChatPanelForTask(task.id);
    await closeCompletedLoopDebateTabs(debateTabIds);
    await switchVisibleConversationTabForLoop(target.tabId);

    const participantValidation = validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions);
    upsertLoopDebateRoundRecord(task.id, {
      loopRound: round,
      debateRound,
      status: "running",
      startedAt,
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      dialogueTurns: completedDialogueTurns,
      participants: participantValidation.participants,
    });

    if (!participantValidation.valid) {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: participantValidation.participants,
        reasons: participantValidation.reasons,
        status: "blocked",
      });
    }

    appendSystemMessageForLoop(target, buildLoopDebateParticipantsCollectedText(task.id, round, participantValidation.participants));

    if (finalModeratorDecision.action === "block") {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: participantValidation.participants,
        reasons: [`裁判主持人决定阻塞：${finalModeratorDecision.reason}`],
        status: "blocked",
      });
    }

    const consensusRun = await runLoopDebateConsensusSummary({
      deps: runnerDeps,
      input,
      target,
      task,
      round,
      debateRound,
      paths,
      participants: participantValidation.participants,
    });
    await closeCompletedLoopDebateTabs([consensusRun.tabId]);
    await switchVisibleConversationTabForLoop(target.tabId);

    const crossReviewText = readTextFileIfNonEmpty(paths.crossReviewFile);
    if (!crossReviewText) {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: participantValidation.participants,
        reasons: [`cross-review.md 缺失或为空：${paths.crossReviewFile}`],
        status: "error",
      });
    }

    const decisionText = readTextFileIfNonEmpty(paths.decisionFile);
    const decision = parseLoopMainDecision(decisionText);
    if (!decision) {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: participantValidation.participants,
        reasons: [`decision.json 缺失或不是合法 LoopMainDecision JSON：${paths.decisionFile}`],
        status: "error",
      });
    }

    const consensus = readLoopDebateConsensusRecord(paths.consensusFile, participantValidation.participants, decision);
    if (!consensus) {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: participantValidation.participants,
        reasons: [`consensus.md 缺失或不含合法共识 JSON：${paths.consensusFile}`],
        status: "error",
      });
    }
    const mergedConsensus = mergeLoopDebateConsensusWithParticipantArtifacts(consensus, participantValidation.participants, decision);
    const consensusValidation = validateLoopDebateConsensus(mergedConsensus);
    if (!consensusValidation.canProceed) {
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: participantValidation.participants,
        consensus: mergedConsensus,
        reasons: consensusValidation.reasons,
        status: "blocked",
      });
    }

    upsertLoopDebateRoundRecord(task.id, {
      loopRound: round,
      debateRound,
      status: "consensus",
      startedAt,
      completedAt: Date.now(),
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      participants: participantValidation.participants,
      consensus: mergedConsensus,
    });
    refreshOpenLoopGroupChatPanelForTask(task.id);
    appendSystemMessageForLoop(
      target,
      buildLoopDebateConsensusReachedText(
        task.id,
        round,
        decision,
        paths,
        getLoopDecisionSubtasks,
        formatLoopEstimatedRemainingRounds,
      )
    );
    appendLoopDebateMainCommunicationLog(task, round, paths, "红蓝对抗共识已形成", [
      `共识摘要：${mergedConsensus.summary}`,
      `决策状态：${decision.status}`,
      `decision.json：${paths.decisionFile}`,
    ]);
    return applyLoopMainDecisionForRun(task.id, decision);
  }

  function resolveLoopDebateModel(input: PromptRunInput): string | undefined {
    return resolvePromptRunModelForRole(input, "main");
  }

  function getLoopDebateRunnerDeps(): LoopDebateRunnerDeps {
    return {
      appendSystemMessageForLoop,
      buildLoopDebateConsensusStartedText,
      buildLoopDebateModeratorFinishedText,
      buildLoopDebateModeratorStartedText,
      buildLoopDebateParticipantFinishedText,
      buildLoopDebateParticipantRosterFailedText,
      buildLoopDebateParticipantRosterFinishedText,
      buildLoopDebateParticipantRosterStartedText,
      buildLoopDebateParticipantStartedText,
      createLoopSubtaskRunTarget,
      errorToMessage,
      getExistingLoopDebateRoundStartedAt,
      logError: async (event: string, payload?: unknown) => {
        await logError(event, payload);
      },
      readLoopDebateModeratorDecisionArtifact,
      readLoopDebateParticipantArtifact,
      readLoopDebateParticipantRosterArtifact,
      readLoopDebateParticipantTurnArtifact,
      readTextFileIfNonEmpty,
      refreshOpenLoopGroupChatPanelForTask,
      resolvePromptRunTargetSessionId,
      runPrompt,
      updateLoopDebateActiveSpeakerRecord,
      updateLoopDebateModeratorDecisionRecord,
      updateLoopDebateParticipantRecord,
      updateLoopDebateParticipantRosterSessionRecord,
    };
  }

  function buildLoopDebateParticipantRecords(
    paths: LoopDebatePaths,
    model: string | undefined,
    status: LoopDebateParticipantRecord["status"],
    participants: readonly LoopDebateParticipantDefinition[],
  ): LoopDebateParticipantRecord[] {
    const now = Date.now();
    return participants.map((participant) => ({
      id: participant.id,
      role: participant.role,
      title: participant.title,
      model: model ?? null,
      status,
      artifactFile: buildLoopDebateParticipantArtifactFile(paths, participant.id),
      updatedAt: now,
    }));
  }

  function buildLoopDebateSessionState(
    task: LoopTaskRecord,
    round: number,
    debateRound: number,
  ): LoopDebateSessionState {
    const existingRound = task.debateRounds?.find((item: LoopDebateRoundRecord<LoopMainDecision>) => (
      item.loopRound === round
      && item.debateRound === debateRound
    ));
    const participants: Partial<Record<string, string>> = {};
    (existingRound?.participants ?? []).forEach((participant) => {
      const sessionId = findLatestLoopDebateParticipantSessionId(existingRound?.participants, participant.id);
      if (sessionId) {
        participants[participant.id] = sessionId;
      }
    });
    return {
      participants,
      moderator: findLatestLoopDebateModeratorSessionId(existingRound?.moderatorDecisions)
        ?? normalizeLoopDebateSessionId(existingRound?.participantRosterSessionId),
    };
  }

  function resolveExistingLoopDebateParticipantRecords(
    task: LoopTaskRecord,
    round: number,
    debateRound: number,
    paths: LoopDebatePaths,
    model: string | undefined,
    sessionState?: LoopDebateSessionState,
  ): LoopDebateParticipantRecord[] {
    const existingRound = task.debateRounds?.find((item: LoopDebateRoundRecord<LoopMainDecision>) => (
      item.loopRound === round
      && item.debateRound === debateRound
    ));
    const existingParticipants = existingRound?.participants?.filter((participant) => (
      typeof participant.id === "string"
      && Boolean(participant.id.trim())
      && typeof participant.title === "string"
      && Boolean(participant.title.trim())
    )) ?? [];
    if (existingParticipants.length === 0) {
      return [];
    }
    return existingParticipants.map((participant) => ({
      ...participant,
      model: participant.model ?? model ?? null,
      artifactFile: participant.artifactFile || buildLoopDebateParticipantArtifactFile(paths, participant.id),
      sessionId: sessionState?.participants[participant.id] ?? participant.sessionId ?? null,
      updatedAt: typeof participant.updatedAt === "number" ? participant.updatedAt : Date.now(),
    }));
  }

  function evaluateReusableLoopDebateDecision(
    task: LoopTaskRecord,
    round: number,
    debateRound: number,
    paths: LoopDebatePaths,
    participantRecords: LoopDebateParticipantRecord[],
  ): LoopDebateReusableDecisionResult {
    const decisionText = readTextFileIfNonEmpty(paths.decisionFile);
    if (!decisionText) {
      return { status: "rerun", reasons: [] };
    }
    const chatText = readTextFileIfNonEmpty(paths.chatFile);
    if (!chatText || !isCompleteLoopDebateChatTranscript(chatText)) {
      return { status: "rerun", reasons: [`已有 decision.json，但缺少完整群聊记录 chat.md，将重跑辩论：${paths.chatFile}`] };
    }
    const crossReviewText = readTextFileIfNonEmpty(paths.crossReviewFile);
    if (!crossReviewText) {
      return { status: "rerun", reasons: [`已有 decision.json，但缺少 cross-review.md 或文件为空：${paths.crossReviewFile}`] };
    }
    const consensusText = readTextFileIfNonEmpty(paths.consensusFile);
    if (!consensusText) {
      return { status: "rerun", reasons: [`已有 decision.json，但缺少 consensus.md：${paths.consensusFile}`] };
    }
    if (participantRecords.length === 0) {
      return { status: "rerun", reasons: [`已有 decision.json，但缺少裁判主持人红蓝参与者清单：${paths.participantRosterFile}`] };
    }
    const participantValidation = validateLoopDebateParticipantArtifacts(
      paths,
      participantRecords,
      participantRecords[0]?.model ?? undefined
    );
    if (!participantValidation.valid) {
      return { status: "rerun", reasons: participantValidation.reasons };
    }
    const decision = parseLoopMainDecision(decisionText);
    if (!decision) {
      return { status: "rerun", reasons: [`已有 decision.json 非法，将重跑辩论：${paths.decisionFile}`] };
    }

    const fileConsensus = readLoopDebateConsensusRecord(paths.consensusFile, participantValidation.participants, decision);
    if (!fileConsensus) {
      return { status: "rerun", reasons: [`已有 decision.json，但 consensus.md 不含合法共识 JSON：${paths.consensusFile}`] };
    }
    const consensus = mergeLoopDebateConsensusWithParticipantArtifacts(fileConsensus, participantValidation.participants, decision);
    const consensusValidation = validateLoopDebateConsensus(consensus);
    if (!consensusValidation.canProceed) {
      return {
        status: "needs-review",
        reasons: consensusValidation.reasons,
        consensus,
        participants: participantValidation.participants,
      };
    }
    return {
      status: "reusable",
      decision,
      consensus,
      participants: participantValidation.participants,
    };
  }

  function validateLoopDebateParticipantArtifacts(
    paths: LoopDebatePaths,
    participantRecords: readonly LoopDebateParticipantRecord[],
    model: string | null | undefined,
    sessionState?: LoopDebateSessionState,
  ): LoopDebateParticipantArtifactValidation {
    const participants = participantRecords.map((participant) => (
      {
        ...readLoopDebateParticipantArtifact(paths, {
          id: participant.id,
          role: participant.role,
          title: participant.title,
          focus: participant.summary ?? participant.title,
        }, model ?? undefined),
        sessionId: sessionState?.participants[participant.id] ?? participant.sessionId ?? null,
      }
    ));
    const reasons: string[] = [];
    participants.forEach((participant) => {
      if (participant.status !== "completed") {
        reasons.push(`参与者 ${participant.id} artifact 缺失或为空：${participant.artifactFile}`);
      }
      if (!participant.stance) {
        reasons.push(`参与者 ${participant.id} 未提供可解析立场（agree / agree_with_reservations / block）。`);
      }
    });
    return {
      valid: reasons.length === 0,
      participants,
      reasons,
    };
  }

  function readLoopDebateParticipantArtifact(
    paths: LoopDebatePaths,
    participant: LoopDebateParticipantDefinition,
    model: string | undefined,
  ): LoopDebateParticipantRecord {
    const artifactFile = buildLoopDebateParticipantArtifactFile(paths, participant.id);
    const content = readTextFileIfNonEmpty(artifactFile);
    const stance = content ? extractLoopDebateParticipantStance(content) : null;
    const status: LoopDebateParticipantRecord["status"] = content && stance ? "completed" : "error";
    return {
      id: participant.id,
      role: participant.role,
      title: participant.title,
      model: model ?? null,
      status,
      artifactFile,
      summary: content ? summarizeLoopDebateArtifact(content) : undefined,
      stance: stance ?? undefined,
      blockingIssues: content ? extractLoopDebateBlockingIssues(content, stance ?? undefined) : undefined,
      updatedAt: Date.now(),
    };
  }

  function readLoopDebateParticipantTurnArtifact(
    participant: LoopDebateParticipantDefinition,
    artifactFile: string,
    model: string | undefined,
  ): LoopDebateParticipantRecord {
    const content = readTextFileIfNonEmpty(artifactFile);
    return {
      id: participant.id,
      role: participant.role,
      title: participant.title,
      model: model ?? null,
      status: content ? "completed" : "error",
      artifactFile,
      summary: content ? summarizeLoopDebateArtifact(content) : undefined,
      updatedAt: Date.now(),
    };
  }

  function readLoopDebateParticipantRosterArtifact(
    artifactFile: string,
  ): { valid: true; participants: LoopDebateParticipantDefinition[]; summary: string; openingSpeakerIds: string[] } | { valid: false; reasons: string[] } {
    const content = readTextFileIfNonEmpty(artifactFile);
    if (!content) {
      return { valid: false, reasons: [`裁判主持人红蓝参与者清单 artifact 缺失或为空：${artifactFile}`] };
    }
    const jsonText = extractJsonObjectText(content);
    if (!jsonText) {
      return { valid: false, reasons: [`裁判主持人红蓝参与者清单缺少 JSON 对象：${artifactFile}`] };
    }
    try {
      const parsed = JSON.parse(jsonText);
      return normalizeLoopDebateParticipantRosterObject(parsed, artifactFile);
    } catch (error) {
      return { valid: false, reasons: [`裁判主持人红蓝参与者清单 JSON 无法解析：${errorToMessage(error)}`] };
    }
  }

  function normalizeLoopDebateParticipantRosterObject(
    value: unknown,
    artifactFile: string,
  ): { valid: true; participants: LoopDebateParticipantDefinition[]; summary: string; openingSpeakerIds: string[] } | { valid: false; reasons: string[] } {
    const reasons: string[] = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { valid: false, reasons: ["裁判主持人红蓝参与者清单必须是 JSON 对象。"] };
    }
    const raw = value as {
      artifactFile?: unknown;
      summary?: unknown;
      participants?: unknown;
      openingSpeakerIds?: unknown;
      initialSpeakerIds?: unknown;
    };
    if (typeof raw.artifactFile !== "string" || !raw.artifactFile.trim()) {
      reasons.push("裁判主持人红蓝参与者清单 JSON 必须包含 artifactFile。");
    }
    if (typeof raw.artifactFile === "string" && raw.artifactFile.trim() && raw.artifactFile.trim() !== artifactFile) {
      reasons.push(`裁判主持人红蓝参与者清单 artifactFile 与实际文件不一致：${raw.artifactFile}`);
    }
    const summary = typeof raw.summary === "string" && raw.summary.trim()
      ? raw.summary.trim()
      : "";
    if (!summary) {
      reasons.push("裁判主持人红蓝参与者清单 JSON 必须包含非空 summary。");
    }
    if (!Array.isArray(raw.participants)) {
      reasons.push("裁判主持人红蓝参与者清单 JSON 必须包含 participants 数组。");
      return { valid: false, reasons };
    }
    if (raw.participants.length < LOOP_DEBATE_MIN_PARTICIPANTS || raw.participants.length > LOOP_DEBATE_MAX_PARTICIPANTS) {
      reasons.push(`裁判主持人红蓝参与者数量必须在 ${LOOP_DEBATE_MIN_PARTICIPANTS}-${LOOP_DEBATE_MAX_PARTICIPANTS} 个之间。`);
    }

    const ids = new Set<string>();
    const participants = raw.participants
      .map((item, index): LoopDebateParticipantDefinition | null => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          reasons.push(`第 ${index + 1} 个参与者必须是对象。`);
          return null;
        }
        const participant = item as {
          id?: unknown;
          role?: unknown;
          title?: unknown;
          focus?: unknown;
        };
        const id = typeof participant.id === "string" ? participant.id.trim() : "";
        const title = typeof participant.title === "string" ? participant.title.trim() : "";
        const focus = typeof participant.focus === "string" ? participant.focus.trim() : "";
        const role = normalizeLoopDebateParticipantRole(participant.role);
        if (!id || !/^[a-z0-9][a-z0-9_.-]{1,48}$/u.test(id)) {
          reasons.push(`第 ${index + 1} 个参与者 id 非法：${id || "<empty>"}`);
        }
        if (id === LOOP_DEBATE_MODERATOR_ID || id === "consensus") {
          reasons.push(`参与者 id 不能使用保留值：${id}`);
        }
        if (id && ids.has(id)) {
          reasons.push(`参与者 id 重复：${id}`);
        }
        if (id) {
          ids.add(id);
        }
        if (!role) {
          reasons.push(`参与者 ${id || index + 1} role 非法。`);
        } else if (!isLoopDebateAdversarialParticipantRole(role)) {
          reasons.push(`参与者 ${id || index + 1} role 必须是 ${LOOP_DEBATE_BLUE_TEAM_ROLE} 或 ${LOOP_DEBATE_RED_TEAM_ROLE}；${role} 仅用于兼容旧任务记录，不允许新辩论清单使用。`);
        }
        if (!title) {
          reasons.push(`参与者 ${id || index + 1} title 不能为空。`);
        }
        if (!focus) {
          reasons.push(`参与者 ${id || index + 1} focus 不能为空。`);
        }
        if (!id || !role || !title || !focus) {
          return null;
        }
        return { id, role, title, focus };
      })
      .filter((participant): participant is LoopDebateParticipantDefinition => Boolean(participant));

    if (participants.length < LOOP_DEBATE_MIN_PARTICIPANTS) {
      reasons.push(`可用参与者不足 ${LOOP_DEBATE_MIN_PARTICIPANTS} 个。`);
    }
    const hasBlueTeam = participants.some((participant) => participant.role === LOOP_DEBATE_BLUE_TEAM_ROLE);
    const hasRedTeam = participants.some((participant) => participant.role === LOOP_DEBATE_RED_TEAM_ROLE);
    if (!hasBlueTeam) {
      reasons.push(`裁判主持人红蓝参与者清单必须至少包含 1 个蓝队参与者（role=${LOOP_DEBATE_BLUE_TEAM_ROLE}）。`);
    }
    if (!hasRedTeam) {
      reasons.push(`裁判主持人红蓝参与者清单必须至少包含 1 个红队参与者（role=${LOOP_DEBATE_RED_TEAM_ROLE}）。`);
    }
    if (reasons.length > 0) {
      return { valid: false, reasons };
    }
    const openingSpeakerIds = normalizeLoopDebateSpeakerIds(
      Array.isArray(raw.openingSpeakerIds) ? raw.openingSpeakerIds : raw.initialSpeakerIds,
      participants.map((participant) => participant.id),
      LOOP_DEBATE_MAX_BATCH_SPEAKERS,
    );
    return {
      valid: true,
      participants,
      summary,
      openingSpeakerIds: openingSpeakerIds.length > 0
        ? openingSpeakerIds
        : selectDefaultLoopDebateOpeningSpeakerIds(participants),
    };
  }

  function normalizeLoopDebateParticipantRole(value: unknown): LoopDebateParticipantRole | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return LOOP_DEBATE_PARTICIPANT_ROLES.some((role: string) => role === normalized)
      ? normalized as LoopDebateParticipantRole
      : null;
  }

  function readLoopDebateModeratorDecisionArtifact(
    artifactFile: string,
    dialogueTurn: number,
    allowedSpeakerIds: readonly string[] = [],
  ): LoopDebateModeratorDecisionRecord | null {
    const content = readTextFileIfNonEmpty(artifactFile);
    if (!content) {
      return null;
    }
    const jsonText = extractJsonObjectText(content);
    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText);
        const decision = normalizeLoopDebateModeratorDecisionObject(parsed, artifactFile, dialogueTurn, allowedSpeakerIds);
        if (decision) {
          if (decision.action === "continue" && decision.nextSpeakerIds.length === 0) {
            return null;
          }
          return decision;
        }
      } catch {
        // Fall back to markdown parsing below.
      }
    }

    const decisionSection = extractMarkdownSection(content, "主持人决策") ?? content.slice(0, 1600);
    const action = extractLoopDebateModeratorAction(decisionSection);
    if (!action) {
      return null;
    }
    const reason = extractMarkdownSection(content, "理由")
      ?? extractMarkdownSection(content, "主持人理由")
      ?? extractMarkdownSection(content, "收束或继续理由")
      ?? summarizeLoopDebateArtifact(content);
    return {
      artifactFile,
      dialogueTurn,
      action,
      reason: reason.trim() || "裁判主持人未提供理由。",
      nextSpeakerIds: extractLoopDebateModeratorNextSpeakerIds(content, allowedSpeakerIds),
      nextFocus: extractLoopDebateModeratorNextFocus(content),
      updatedAt: Date.now(),
    };
  }

  function normalizeLoopDebateModeratorDecisionObject(
    value: unknown,
    artifactFile: string,
    dialogueTurn: number,
    allowedSpeakerIds: readonly string[] = [],
  ): LoopDebateModeratorDecisionRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const raw = value as {
      artifactFile?: unknown;
      dialogueTurn?: unknown;
      action?: unknown;
      reason?: unknown;
      nextFocus?: unknown;
      nextFocusQuestions?: unknown;
    };
    const action = extractLoopDebateModeratorAction(raw.action);
    if (!action) {
      return null;
    }
    const reason = typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim()
      : "裁判主持人未提供理由。";
    const nextFocusValue = Array.isArray(raw.nextFocus) ? raw.nextFocus : raw.nextFocusQuestions;
    const nextFocus = Array.isArray(nextFocusValue)
      ? nextFocusValue
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim())
        .slice(0, 8)
      : [];
    const nextSpeakerIds = normalizeLoopDebateSpeakerIds(
      (value as { nextSpeakerIds?: unknown; nextSpeakers?: unknown; nextParticipants?: unknown }).nextSpeakerIds
        ?? (value as { nextSpeakers?: unknown }).nextSpeakers
        ?? (value as { nextParticipants?: unknown }).nextParticipants,
      allowedSpeakerIds,
      LOOP_DEBATE_MAX_BATCH_SPEAKERS,
    );
    return {
      artifactFile: typeof raw.artifactFile === "string" && raw.artifactFile.trim()
        ? raw.artifactFile.trim()
        : artifactFile,
      dialogueTurn: typeof raw.dialogueTurn === "number" && Number.isFinite(raw.dialogueTurn)
        ? Math.max(1, Math.trunc(raw.dialogueTurn))
        : dialogueTurn,
      action,
      reason,
      nextSpeakerIds,
      nextFocus,
      updatedAt: Date.now(),
    };
  }

  function extractLoopDebateModeratorAction(value: unknown): LoopDebateModeratorDecisionRecord["action"] | null {
    if (typeof value !== "string") {
      return null;
    }
    const explicit = value.match(/\b(continue|finalize|block)\b/i)?.[1];
    if (explicit) {
      return normalizeLoopDebateModeratorAction(explicit);
    }
    if (/阻塞|人工复核|无法继续|不能继续/u.test(value)) {
      return "block";
    }
    if (/收束|最终立场|进入共识|汇总|结束辩论/u.test(value)) {
      return "finalize";
    }
    if (/继续|下一轮|追问|再讨论/u.test(value)) {
      return "continue";
    }
    return null;
  }

  function extractLoopDebateModeratorNextFocus(content: string): string[] {
    const section = extractMarkdownSection(content, "下一轮关注点")
      ?? extractMarkdownSection(content, "继续关注点")
      ?? "";
    return section
      .split(/\r?\n/g)
      .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function extractLoopDebateModeratorNextSpeakerIds(
    content: string,
    allowedSpeakerIds: readonly string[],
  ): string[] {
    const section = extractMarkdownSection(content, "下一批发言者")
      ?? extractMarkdownSection(content, "下一轮发言者")
      ?? "";
    if (!section) {
      return [];
    }
    const items = section
      .split(/\r?\n/g)
      .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean)
      .flatMap((line) => line.split(/[，,、；;]/g).map((item) => item.trim()).filter(Boolean));
    return normalizeLoopDebateSpeakerIds(items, allowedSpeakerIds, LOOP_DEBATE_MAX_BATCH_SPEAKERS);
  }

  function extractLoopDebateParticipantStance(content: string): LoopDebateParticipantStance | null {
    const stanceSection = extractMarkdownSection(content, "立场") ?? content.slice(0, 1200);
    const explicit = stanceSection.match(/\b(agree_with_reservations|agree|block)\b/i)?.[1];
    if (explicit) {
      return normalizeLoopDebateParticipantStance(explicit);
    }
    if (/阻塞|不同意|不能继续/u.test(stanceSection)) {
      return "block";
    }
    if (/保留|风险|reservation/i.test(stanceSection)) {
      return "agree_with_reservations";
    }
    if (/同意|通过|agree/i.test(stanceSection)) {
      return "agree";
    }
    return null;
  }

  function extractLoopDebateBlockingIssues(
    content: string,
    stance: LoopDebateParticipantStance | undefined,
  ): string[] | undefined {
    const section = extractMarkdownSection(content, "阻塞性异议");
    if (!section) {
      return stance === "block" ? ["参与者声明 block，但未写明阻塞性异议。"] : undefined;
    }
    const normalized = section.trim();
    if (!normalized || /^无(?:。|$)/u.test(normalized) || /^none$/i.test(normalized)) {
      return stance === "block" ? ["参与者声明 block，但阻塞性异议小节为空。"] : undefined;
    }
    const issues = normalized
      .split(/\r?\n/g)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
    return issues.length > 0 ? issues : undefined;
  }

  function extractMarkdownSection(content: string, title: string): string | null {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\n)##\\s*${escapedTitle}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "u");
    const match = content.match(pattern);
    return match?.[1]?.trim() || null;
  }

  function summarizeLoopDebateArtifact(content: string): string {
    const normalized = content.trim().replace(/\s+/g, " ");
    return normalized.length > LOOP_DEBATE_ARTIFACT_SUMMARY_LIMIT
      ? `${normalized.slice(0, LOOP_DEBATE_ARTIFACT_SUMMARY_LIMIT)}...`
      : normalized;
  }

  function isCompleteLoopDebateChatTranscript(content: string): boolean {
    return /##\s*群聊收束/u.test(content)
      && /##\s*参与者加入：/u.test(content)
      && /(?:【裁判主持人】|裁判主持人|主持人)最终动作：(?:continue|finalize|block)/u.test(content)
      && /##\s*(?:第\s+\d+\s+轮)?主持人控场/u.test(content);
  }

  function readLoopDebateConsensusRecord(
    consensusFile: string,
    participants: LoopDebateParticipantRecord[],
    decision: LoopMainDecision,
  ): LoopDebateConsensusRecord<LoopMainDecision> | null {
    const content = readTextFileIfNonEmpty(consensusFile);
    if (!content) {
      return null;
    }
    const jsonText = extractJsonObjectText(content);
    if (!jsonText) {
      return null;
    }
    try {
      const parsed = JSON.parse(jsonText);
      return normalizeLoopDebateConsensusRecord(parsed, consensusFile, participants, decision);
    } catch {
      return null;
    }
  }

  function normalizeLoopDebateConsensusRecord(
    value: unknown,
    artifactFile: string,
    participants: LoopDebateParticipantRecord[],
    decision: LoopMainDecision,
  ): LoopDebateConsensusRecord<LoopMainDecision> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const raw = value as {
      artifactFile?: unknown;
      reached?: unknown;
      summary?: unknown;
      participantStances?: unknown;
      resolvedDisagreements?: unknown;
      openDisagreements?: unknown;
    };
    const summary = typeof raw.summary === "string" && raw.summary.trim()
      ? raw.summary.trim()
      : "";
    if (
      typeof raw.artifactFile !== "string"
      || !raw.artifactFile.trim()
      || typeof raw.reached !== "boolean"
      || !summary
      || !hasValidLoopDebateConsensusStanceRecords(raw.participantStances)
      || !hasValidLoopDebateDisagreementRecords(raw.resolvedDisagreements)
      || !hasValidLoopDebateDisagreementRecords(raw.openDisagreements)
    ) {
      return null;
    }
    return {
      artifactFile: raw.artifactFile.trim() || artifactFile,
      reached: raw.reached === true,
      summary,
      participantStances: normalizeLoopDebateConsensusStances(raw.participantStances, participants),
      resolvedDisagreements: normalizeLoopDebateDisagreements(raw.resolvedDisagreements),
      openDisagreements: normalizeLoopDebateDisagreements(raw.openDisagreements),
      decision,
    };
  }

  function hasValidLoopDebateConsensusStanceRecords(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) {
      return false;
    }
    return value.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }
      const raw = item as { participantId?: unknown; stance?: unknown };
      return (
        typeof raw.participantId === "string"
        && Boolean(raw.participantId.trim())
        && Boolean(normalizeLoopDebateParticipantStance(raw.stance))
      );
    });
  }

  function normalizeLoopDebateConsensusStances(
    value: unknown,
    participants: LoopDebateParticipantRecord[],
  ): LoopDebateConsensusRecord<LoopMainDecision>["participantStances"] {
    const stances = new Map<string, { participantId: string; stance: LoopDebateParticipantStance; note?: string }>();
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return;
        }
        const raw = item as { participantId?: unknown; stance?: unknown; note?: unknown };
        const participantId = typeof raw.participantId === "string" && raw.participantId.trim()
          ? raw.participantId.trim()
          : "";
        const stance = normalizeLoopDebateParticipantStance(raw.stance);
        if (!participantId || !stance) {
          return;
        }
        stances.set(participantId, {
          participantId,
          stance,
          note: typeof raw.note === "string" ? raw.note : undefined,
        });
      });
    }
    participants.forEach((participant) => {
      if (!participant.stance || stances.has(participant.id)) {
        return;
      }
      stances.set(participant.id, {
        participantId: participant.id,
        stance: participant.stance,
        note: participant.summary,
      });
    });
    return Array.from(stances.values());
  }

  function hasValidLoopDebateDisagreementRecords(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    return value.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }
      const raw = item as {
        id?: unknown;
        title?: unknown;
        participants?: unknown;
        severity?: unknown;
        resolution?: unknown;
      };
      return (
        typeof raw.id === "string"
        && Boolean(raw.id.trim())
        && typeof raw.title === "string"
        && Boolean(raw.title.trim())
        && Array.isArray(raw.participants)
        && raw.participants.every((participant) => typeof participant === "string" && Boolean(participant.trim()))
        && (raw.severity === "blocking" || raw.severity === "non_blocking")
        && (raw.resolution === undefined || typeof raw.resolution === "string")
      );
    });
  }

  function normalizeLoopDebateDisagreements(value: unknown): LoopDebateDisagreementRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item, index): LoopDebateDisagreementRecord | null => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }
        const raw = item as {
          id?: unknown;
          title?: unknown;
          participants?: unknown;
          severity?: unknown;
          resolution?: unknown;
        };
        const id = typeof raw.id === "string" && raw.id.trim()
          ? raw.id.trim()
          : `disagreement-${index + 1}`;
        const title = typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : id;
        const participants = Array.isArray(raw.participants)
          ? raw.participants.filter((participant): participant is string => typeof participant === "string" && Boolean(participant.trim()))
          : [];
        return {
          id,
          title,
          participants,
          severity: raw.severity === "blocking" ? "blocking" : "non_blocking",
          resolution: typeof raw.resolution === "string" ? raw.resolution : undefined,
        };
      })
      .filter((item): item is LoopDebateDisagreementRecord => Boolean(item));
  }

  function mergeLoopDebateConsensusWithParticipantArtifacts(
    consensus: LoopDebateConsensusRecord<LoopMainDecision>,
    participants: LoopDebateParticipantRecord[],
    decision: LoopMainDecision,
  ): LoopDebateConsensusRecord<LoopMainDecision> {
    return {
      ...consensus,
      participantStances: normalizeLoopDebateConsensusStances(consensus.participantStances, participants),
      decision,
    };
  }

  function markLoopDebateNeedsReview(options: {
    task: LoopTaskRecord;
    target: PromptRunTarget;
    round: number;
    debateRound: number;
    paths: LoopDebatePaths;
    participants: LoopDebateParticipantRecord[];
    reasons: string[];
    consensus?: LoopDebateConsensusRecord<LoopMainDecision>;
    status: Exclude<LoopDebateRoundStatus, "running" | "consensus">;
  }): LoopMainDecisionRunResult {
    const { task, target, round, debateRound, paths, participants, reasons, consensus, status } = options;
    const latestTask = readLoopTaskRecord(task.id);
    if (latestTask?.status === "stopped") {
      return { status: "interrupted", task: latestTask, runStatus: "stopped" };
    }
    const reviewSummary = buildLoopDebateNeedsReviewSummary({ reasons, consensus });
    const startedAt = getExistingLoopDebateRoundStartedAt(task, round, debateRound) ?? Date.now();
    upsertLoopDebateRoundRecord(task.id, {
      loopRound: round,
      debateRound,
      status,
      startedAt,
      completedAt: Date.now(),
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      participants,
      consensus,
    });
    const failedRecord = updateLoopTaskRecord(task.id, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      updatedAt: Date.now(),
      finalSummary: reviewSummary.finalSummary,
      ...(typeof reviewSummary.estimatedRemainingRounds === "number"
        ? { estimatedRemainingRounds: reviewSummary.estimatedRemainingRounds }
        : {}),
    }) ?? task;
    refreshOpenLoopGroupChatPanelForTask(task.id);
    appendSystemMessageForLoop(target, buildLoopDebateNeedsReviewText(task.id, round, reviewSummary, paths));
    appendLoopDebateMainCommunicationLog(failedRecord, round, paths, reviewSummary.title, [
      ...reviewSummary.details,
      ...(consensus ? [`consensus.md：${paths.consensusFile}`] : []),
      ...(consensus?.decision ? [`decision.json：${paths.decisionFile}`] : []),
    ]);
    return { status: "needs-review", task: failedRecord };
  }

  function getExistingLoopDebateRoundStartedAt(
    task: LoopTaskRecord,
    round: number,
    debateRound: number,
  ): number | null {
    const record = task.debateRounds?.find((item: LoopDebateRoundRecord<LoopMainDecision>) => item.loopRound === round && item.debateRound === debateRound);
    return typeof record?.startedAt === "number" ? record.startedAt : null;
  }

  function upsertLoopDebateRoundRecord(
    taskId: string,
    roundRecord: LoopDebateRoundRecord<LoopMainDecision>,
  ): void {
    const latest = readLoopTaskRecord(taskId);
    if (!latest) {
      return;
    }
    const debateRounds = Array.isArray(latest.debateRounds) ? [...latest.debateRounds] : [];
    const existingIndex = debateRounds.findIndex((item) => (
      item.loopRound === roundRecord.loopRound
      && item.debateRound === roundRecord.debateRound
    ));
  	  if (existingIndex >= 0) {
  	    debateRounds[existingIndex] = {
  	      ...debateRounds[existingIndex],
  	      ...roundRecord,
  	      participants: roundRecord.participants,
  	      participantRosterFile: roundRecord.participantRosterFile ?? debateRounds[existingIndex].participantRosterFile,
  	      participantRosterSessionId: roundRecord.participantRosterSessionId ?? debateRounds[existingIndex].participantRosterSessionId,
  	      activeSpeaker: roundRecord.activeSpeaker,
  	      consensus: roundRecord.consensus,
  	    };
    } else {
      debateRounds.push(roundRecord);
    }
    updateLoopTaskRecord(taskId, {
      debateRounds,
      updatedAt: Date.now(),
    });
  }

  function updateLoopDebateParticipantRecord(
    taskId: string,
    round: number,
    debateRound: number,
    participant: LoopDebateParticipantRecord,
    startedAt: number,
    briefFile: string,
    chatFile: string,
    activeSpeaker?: LoopDebateActiveSpeakerRecord,
  ): void {
    const latest = readLoopTaskRecord(taskId) as LoopTaskRecord | null;
    const existingRound = latest?.debateRounds?.find((item: LoopDebateRoundRecord<LoopMainDecision>) => item.loopRound === round && item.debateRound === debateRound);
    const participants = existingRound?.participants?.length
      ? [...existingRound.participants]
      : [];
    const index = participants.findIndex((item) => item.id === participant.id);
    if (index >= 0) {
      participants[index] = { ...participants[index], ...participant };
    } else {
      participants.push(participant);
    }
  	  upsertLoopDebateRoundRecord(taskId, {
  	    loopRound: round,
  	    debateRound,
  	    status: "running",
      startedAt,
      briefFile,
      chatFile,
      participantRosterFile: existingRound?.participantRosterFile,
      participants,
      activeSpeaker,
    });
  }

  function updateLoopDebateActiveSpeakerRecord(
    taskId: string,
    round: number,
    debateRound: number,
    startedAt: number,
    paths: LoopDebatePaths,
    activeSpeaker: LoopDebateActiveSpeakerRecord,
  ): void {
    const latest = readLoopTaskRecord(taskId) as LoopTaskRecord | null;
    const existingRound = latest?.debateRounds?.find((item: LoopDebateRoundRecord<LoopMainDecision>) => item.loopRound === round && item.debateRound === debateRound);
    const participants = existingRound?.participants?.length
      ? [...existingRound.participants]
      : [];
    upsertLoopDebateRoundRecord(taskId, {
      loopRound: round,
      debateRound,
      status: "running",
      startedAt,
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      dialogueTurns: existingRound?.dialogueTurns,
      participants,
      moderatorDecisions: existingRound?.moderatorDecisions,
      activeSpeaker,
    });
    refreshOpenLoopGroupChatPanelForTask(taskId);
  }

  function updateLoopDebateParticipantRosterSessionRecord(
    taskId: string,
    round: number,
    debateRound: number,
    sessionId: string | null,
    startedAt: number,
    paths: LoopDebatePaths,
  ): void {
    const latest = readLoopTaskRecord(taskId) as LoopTaskRecord | null;
    const existingRound = latest?.debateRounds?.find((item: LoopDebateRoundRecord<LoopMainDecision>) => item.loopRound === round && item.debateRound === debateRound);
    upsertLoopDebateRoundRecord(taskId, {
      loopRound: round,
      debateRound,
      status: "running",
      startedAt,
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      participantRosterSessionId: sessionId,
      dialogueTurns: existingRound?.dialogueTurns,
      participants: existingRound?.participants ?? [],
      moderatorDecisions: existingRound?.moderatorDecisions,
      activeSpeaker: existingRound?.activeSpeaker,
    });
  }

  function updateLoopDebateModeratorDecisionRecord(
    taskId: string,
    round: number,
    debateRound: number,
    decision: LoopDebateModeratorDecisionRecord,
    startedAt: number,
    paths: LoopDebatePaths,
  ): void {
    const latest = readLoopTaskRecord(taskId) as LoopTaskRecord | null;
    const existingRound = latest?.debateRounds?.find((item: LoopDebateRoundRecord<LoopMainDecision>) => item.loopRound === round && item.debateRound === debateRound);
    const participants = existingRound?.participants?.length
      ? [...existingRound.participants]
      : [];
    const moderatorDecisions = existingRound?.moderatorDecisions?.length
      ? [...existingRound.moderatorDecisions]
      : [];
    const index = moderatorDecisions.findIndex((item) => item.dialogueTurn === decision.dialogueTurn);
    if (index >= 0) {
      moderatorDecisions[index] = decision;
    } else {
      moderatorDecisions.push(decision);
    }
    upsertLoopDebateRoundRecord(taskId, {
      loopRound: round,
      debateRound,
      status: "running",
      startedAt,
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      dialogueTurns: decision.dialogueTurn,
      participants,
      moderatorDecisions,
    });
  }

  function buildLoopDebateSpeakerBatch(participants: readonly LoopDebateParticipantDefinition[], speakerIds: readonly string[]): LoopDebateSpeakerBatch {
    const participantById = new Map(participants.map((participant) => [participant.id, participant] as const));
    const normalizedSpeakerIds = speakerIds
      .filter((speakerId): speakerId is string => typeof speakerId === "string" && Boolean(speakerId.trim()))
      .map((speakerId) => speakerId.trim())
      .filter((speakerId, index, list) => list.indexOf(speakerId) === index)
      .slice(0, LOOP_DEBATE_MAX_BATCH_SPEAKERS)
      .filter((speakerId) => participantById.has(speakerId));
    const speakers = normalizedSpeakerIds
      .map((speakerId) => participantById.get(speakerId))
      .filter((participant): participant is LoopDebateParticipantDefinition => Boolean(participant));
    return {
      speakerIds: normalizedSpeakerIds,
      speakers,
    };
  }

  function readTextFileIfNonEmpty(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, "utf8").trim();
      return content ? content : null;
    } catch (error) {
      void logError("read-text-file-error", { filePath, error: String(error) });
      return null;
    }
  }

  function writeTextFileEnsuringDir(filePath: string, content: string): boolean {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf8");
      return true;
    } catch (error) {
      void logError("write-text-file-error", { filePath, error: String(error) });
      return false;
    }
  }

  function appendTextFileEnsuringDir(filePath: string, content: string): boolean {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, content, "utf8");
      return true;
    } catch (error) {
      void logError("append-text-file-error", { filePath, error: String(error) });
      return false;
    }
  }

  async function closeCompletedLoopDebateTabs(tabIds: string[]): Promise<void> {
    for (const tabId of tabIds) {
      if (tabId) {
        await closeConversationTabAndRefreshPanel(tabId);
      }
    }
  }

  function appendLoopDebateMainCommunicationLog(
    task: LoopTaskRecord,
    round: number,
    paths: LoopDebatePaths,
    title: string,
    details: string[],
  ): void {
    try {
      fs.mkdirSync(path.dirname(task.mainCommunicationFile), { recursive: true });
      const lines = [
        "",
        `## ${title}`,
        `- 时间：${new Date().toISOString()}`,
        `- 轮次：${round}`,
        `- 辩论目录：${paths.roundDir}`,
        `- 群聊记录：${paths.chatFile}`,
        ...details.map((detail) => `- ${detail}`),
      ];
      fs.appendFileSync(task.mainCommunicationFile, `${lines.join("\n")}\n`, "utf8");
    } catch (error) {
      void logError("loop-debate-main-communication-write-error", {
        taskId: task.id,
        filePath: task.mainCommunicationFile,
        error: String(error),
      });
    }
  }

  function appendLoopSupplementalRequirement(
    existing: readonly string[] | undefined,
    nextItem: string,
  ): string[] {
    const normalizedExisting = Array.isArray(existing)
      ? existing.map((item) => String(item).trim()).filter(Boolean)
      : [];
    return [...normalizedExisting, nextItem];
  }

  function appendLoopSupplementalRequirementToCommunication(
    task: LoopTaskRecord,
    requirement: string,
  ): void {
    const body = [
      `- 时间：${new Date().toISOString()}`,
      `- 主任务轮次：${Math.max(1, task.currentRound || 1)}`,
      requirement,
    ].join("\n");
    try {
      fs.mkdirSync(path.dirname(task.mainCommunicationFile), { recursive: true });
      fs.appendFileSync(task.mainCommunicationFile, `\n## 补充需求\n${body}\n`, "utf8");
    } catch (error) {
      void logError("loop-supplemental-requirement-write-error", {
        taskId: task.id,
        filePath: task.mainCommunicationFile,
        error: String(error),
      });
    }
    appendLoopMainSubChatSection(task, "补充需求", body);
  }

  function appendLoopMainSubChatTaskEvent(task: LoopTaskRecord, body: string): void {
    appendLoopMainSubChatSection(task, "任务事件", body);
  }

  function appendLoopMainSubChatMainDecision(
    task: LoopTaskRecord,
    decision: LoopMainDecision,
    subtasks: LoopSubtaskRecord[] = [],
  ): void {
    const round = Math.max(1, task.currentRound || 1);
    const bodyLines = [
      `- 时间：${new Date().toISOString()}`,
      `- 决策状态：${decision.status}`,
    ];
    const remainingRounds = formatLoopEstimatedRemainingRounds(decision.estimatedRemainingRounds);
    if (remainingRounds) {
      bodyLines.push(`- 预计剩余轮次：${remainingRounds}`);
    }
    if (decision.acceptance?.summary) {
      bodyLines.push(`- 复核摘要：${decision.acceptance.summary}`);
    }
    if (decision.parallelReason) {
      bodyLines.push(`- 并发判断：${decision.parallelReason}`);
    }
    if (subtasks.length > 0) {
      bodyLines.push("");
      bodyLines.push("### 派发子任务");
      subtasks.forEach((subtask, index) => {
        bodyLines.push(`- ${getLoopSubtaskDisplayTitle(index, subtask)}（${subtask.id}）：${subtask.status}`);
      });
    }
    if (decision.status === "completed") {
      bodyLines.push("");
      bodyLines.push("### 问题回答结论");
      bodyLines.push(resolveLoopAnswerConclusion(task, decision));
    }
    if (decision.finalSummary) {
      bodyLines.push("");
      bodyLines.push("### 总结");
      bodyLines.push(decision.finalSummary);
    }
    bodyLines.unshift(`- 成员 ID：main`);
    const mainTitle = getLoopMainSubChatMainTitle(task);
    appendLoopMainSubChatSection(
      task,
      `主任务发言：第 ${round} 轮${formatLoopGroupChatMemberName(mainTitle)}`,
      bodyLines.join("\n"),
    );
    if (decision.status === "completed") {
      appendLoopMainSubChatSection(task, "群聊收束", buildLoopCompletedConclusionAndSummaryMarkdown(task, decision));
    }
  }

  function appendLoopMainSubChatSubtaskStarted(
    task: LoopTaskRecord,
    subtask: LoopSubtaskRecord,
    round: number,
    communicationFile: string,
    retryCount: number,
  ): void {
    const latest = (readLoopTaskRecord(task.id) as LoopTaskRecord | null) ?? task;
    const index = latest.subTasks.findIndex((item: LoopSubtaskRecord) => item.id === subtask.id);
    const title = getLoopSubtaskDisplayTitle(index, subtask);
    const retryLine = retryCount > 0 ? `- 重试：第 ${retryCount} 次` : null;
    appendLoopMainSubChatSection(latest, `子任务加入：${formatLoopGroupChatMemberName(title)}`, [
      `- 成员 ID：${subtask.id}`,
      `- 时间：${new Date().toISOString()}`,
      `- 轮次：${round}`,
      retryLine,
      `- 状态：running`,
      `- 沟通文件：${communicationFile}`,
    ].filter((line): line is string => Boolean(line)).join("\n"));
  }

  function appendLoopMainSubChatSubtaskFinished(
    task: LoopTaskRecord,
    subtask: LoopSubtaskRecord,
    runStatus: TaskRunStatus,
    assistantContent?: string | null,
  ): void {
    const latest = (readLoopTaskRecord(task.id) as LoopTaskRecord | null) ?? task;
    const index = latest.subTasks.findIndex((item: LoopSubtaskRecord) => item.id === subtask.id);
    const latestSubtask = latest.subTasks[index] ?? subtask;
    const title = getLoopSubtaskDisplayTitle(index, latestSubtask);
    appendLoopMainSubChatSection(
      latest,
      `子任务发言：${formatLoopGroupChatMemberName(title)}`,
      [
        `- 成员 ID：${latestSubtask.id}`,
        "",
        buildLoopMainSubSubtaskTurnBody({
          runStatus,
          assistantContent,
          communicationFile: latestSubtask.communicationFile,
        }),
      ].join("\n"),
    );
  }

  function appendLoopMainSubChatSection(
    task: LoopTaskRecord,
    heading: string,
    body: string,
  ): void {
    const chatFile = ensureLoopMainSubChatTranscript(task);
    appendTextFileEnsuringDir(chatFile, `\n## ${heading}\n${body.trim()}\n`);
    refreshOpenLoopGroupChatPanelForTask(task.id);
  }

  type LoopSubtaskRetryOptions = {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
    subtask: LoopSubtaskRecord;
    switchVisible?: boolean;
  };

  type LoopSubtaskBatchOptions = {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
    subtasks: LoopSubtaskRecord[];
  };

  type LoopSubtaskRunResult = {
    subtask: LoopSubtaskRecord;
    status: TaskRunStatus;
  };

  type LoopMainDecisionRunResult =
    | { status: "interrupted"; task: LoopTaskRecord; runStatus: "error" | "stopped" }
    | { status: "needs-review"; task: LoopTaskRecord; decision?: LoopMainDecision | null }
    | { status: "completed"; task: LoopTaskRecord; decision: LoopMainDecision }
    | { status: "continue"; task: LoopTaskRecord; decision: LoopMainDecision; subtasks: LoopSubtaskRecord[] };

  async function runLoopSubtasksBatchWithRetry(
    options: LoopSubtaskBatchOptions
  ): Promise<LoopSubtaskRunResult[]> {
    const { input, target, task, round, subtasks } = options;
    if (subtasks.length <= 1) {
      const subtask = subtasks[0];
      if (!subtask) {
        return [];
      }
      const status = await runLoopSubtaskWithRetry({
        input,
        target,
        task,
        round,
        subtask,
        switchVisible: true,
      });
      return [{ subtask, status }];
    }

    const executionPlan = buildLoopSubtaskExecutionPlan(subtasks);
    appendSystemMessageForLoop(target, buildLoopSubtaskBatchStartedText(task.id, round, subtasks, executionPlan));
    const results: LoopSubtaskRunResult[] = [];

    for (let groupIndex = 0; groupIndex < executionPlan.groups.length; groupIndex += 1) {
      const group = executionPlan.groups[groupIndex] ?? [];
      if (group.length === 0) {
        continue;
      }
      if (executionPlan.groups.length > 1) {
        appendSystemMessageForLoop(
          target,
          buildLoopSubtaskExecutionGroupStartedText(task.id, round, groupIndex, executionPlan.groups.length, group)
        );
      }

      const groupResults = await Promise.all(group.map(async (subtask): Promise<LoopSubtaskRunResult> => {
        try {
          const status = await runLoopSubtaskWithRetry({
            input,
            target,
            task,
            round,
            subtask,
            switchVisible: false,
          });
          return { subtask, status };
        } catch (error) {
          void logError("loop-subtask-batch-run-error", {
            taskId: task.id,
            round,
            subtaskId: subtask.id,
            error: error instanceof Error ? error.message : String(error),
          });
          markLoopSubtaskRunFinished(task.id, subtask.id, "error", null);
          return { subtask, status: "error" };
        }
      }));

      results.push(...groupResults);
      if (groupResults.some((result) => result.status === "error" || result.status === "stopped")) {
        markUndispatchedLoopSubtasksSkipped(task, executionPlan.groups.slice(groupIndex + 1));
        await switchVisibleConversationTabForLoop(target.tabId);
        return results;
      }
    }

    await switchVisibleConversationTabForLoop(target.tabId);
    if (results.every((result) => result.status === "end")) {
      updateLoopTaskRecord(task.id, {
        activeSubtaskId: null,
        activeSubtaskIds: [],
        updatedAt: Date.now(),
      });
      refreshOpenLoopGroupChatPanelForTask(task.id);
      appendSystemMessageForLoop(target, buildLoopSubtaskBatchCompletedText(task.id, round, subtasks));
      const latest = (readLoopTaskRecord(task.id) as LoopTaskRecord | null) ?? task;
      appendLoopMainSubChatTaskEvent(
        latest,
        [
          `- 时间：${new Date().toISOString()}`,
          `- 轮次：${round}`,
          `- 子任务批次已全部完成：${subtasks.length} 个`,
          `- 子任务：${subtasks.map((subtask: LoopSubtaskRecord) => subtask.title).join("、")}`,
        ].join("\n"),
      );
    }
    return results;
  }

  function markUndispatchedLoopSubtasksSkipped(
    task: LoopTaskRecord,
    remainingGroups: readonly LoopSubtaskRecord[][],
  ): void {
    const skippedIds = new Set(remainingGroups.flatMap((group) => group.map((subtask) => subtask.id)));
    if (skippedIds.size === 0) {
      return;
    }

    const latest = readLoopTaskRecord(task.id) ?? task;
    const activeSubtaskIds = getActiveLoopSubtaskIds(latest).filter((id: string) => !skippedIds.has(id));
    const now = Date.now();
    updateLoopTaskRecord(task.id, {
      activeSubtaskId: activeSubtaskIds[0] ?? null,
      activeSubtaskIds,
      subTasks: latest.subTasks.map((subtask: LoopSubtaskRecord) => (
        skippedIds.has(subtask.id)
          ? {
              ...subtask,
              status: "skipped" as const,
              summary: subtask.summary ?? "该子任务尚未启动；等待主任务在下一轮重新评估。",
              updatedAt: now,
            }
          : subtask
      )),
      updatedAt: now,
    });
  }

  async function runLoopSubtaskWithRetry(options: LoopSubtaskRetryOptions): Promise<TaskRunStatus> {
    const { input, target, task, round, subtask } = options;
    const shouldSwitchVisible = options.switchVisible !== false;
    const mainTabId = target.tabId;
    const progressId = `${task.id}:${round}:${subtask.id}`;
    let currentSubtaskTarget: PromptRunTarget | null = null;
    let terminalProgressStatus: "completed" | "failed" | "interrupted" | null = null;
    let parentProgress: SubagentProgressController | null = null;

    const persistParentProgressMessage = (message: ChatMessage): void => {
      const messages = getLoopMessagesForTarget(target) as ChatMessage[];
      const index = messages.findIndex((item: ChatMessage) => item.id === message.id);
      if (index >= 0) {
        messages[index] = message;
      } else {
        appendMessageToStore(messages, message);
      }
      persistLoopMessagesForTarget(target, messages);
    };

    parentProgress = createSubagentProgressController({
      labels: buildSubagentProgressLabels(),
      createMessageId,
      messageMetadata: {
        taskRole: "main",
        loopTaskId: task.id,
        loopRound: round,
        loopSubtaskId: subtask.id,
      },
      appendMessage: (message: ChatMessage) => {
        persistParentProgressMessage(message);
        sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
      },
      replaceMessage: (message: ChatMessage) => {
        persistParentProgressMessage(message);
        sendPanelMessage({ type: "replaceMessage", message, tabId: target.tabId });
      },
      appendDelta: (messageId: string, content: string) => {
        const message = parentProgress?.getMessage("loop", progressId);
        if (message) {
          persistParentProgressMessage(message);
        }
        sendPanelMessage({
          type: "assistantDelta",
          id: messageId,
          content,
          tabId: target.tabId,
        });
      },
    });

    const progressMonitor = createLoopSubtaskProgressMonitor({
      taskId: task.id,
      round,
      subtaskId: subtask.id,
      subtaskTitle: subtask.title,
      waitingText: t("run.loopSubtaskWaiting"),
      readMessages: () => currentSubtaskTarget
        ? getLoopMessagesForTarget(currentSubtaskTarget)
        : [],
      onUpdate: (update: SubagentProgressUpdate) => parentProgress?.update(update),
    });
    progressMonitor.start();

    let retryCount = 0;
    try {
      while (true) {
        if (isLoopTaskExecutionInterrupted(task.id)) {
          terminalProgressStatus = "interrupted";
          return "stopped";
        }
        const communicationFile = prepareLoopSubtaskCommunicationFile(task, subtask, round, retryCount);
        const subtaskTarget = createLoopSubtaskRunTarget(target.cli);
        currentSubtaskTarget = subtaskTarget;
        appendSystemMessageForLoop(
          target,
          buildLoopSubtaskStartedText(task.id, subtask, round, communicationFile, retryCount)
        );
        appendSystemMessageForLoop(
          subtaskTarget,
          buildLoopSubtaskStartedText(task.id, subtask, round, communicationFile, retryCount)
        );
        appendLoopMainSubChatSubtaskStarted(task, subtask, round, communicationFile, retryCount);
        if (shouldSwitchVisible) {
          await switchVisibleConversationTabForLoop(subtaskTarget.tabId);
        }

        let status: TaskRunStatus = "error";
        try {
          status = await runLoopRound({
            input,
            target: subtaskTarget,
            task,
            round,
            role: "subtask",
            subtaskId: subtask.id,
            displayPrompt: buildLoopSubtaskDisplayPrompt(round, subtask, retryCount),
            modelPrompt: buildLoopSubtaskModelPrompt(
              input.modelPrompt || input.displayPrompt,
              task,
              round,
              subtask,
              retryCount,
              communicationFile
            ),
          });
        } catch (error) {
          status = "error";
          void logError("loop-subtask-run-error", {
            taskId: task.id,
            round,
            subtaskId: subtask.id,
            retryCount,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          progressMonitor.sync();
          if (shouldSwitchVisible) {
            await switchVisibleConversationTabForLoop(mainTabId);
          }
        }

        if (status !== "error") {
          const summary = getLastLoopAssistantContent(subtaskTarget, task.id, round, "subtask");
          await finalizeLoopSubtaskRun({
            taskId: task.id,
            round,
            subtaskId: subtask.id,
            runStatus: status,
            assistantContent: summary,
            tabId: subtaskTarget.tabId,
          });
          terminalProgressStatus = mapLoopRunStatusToSubagentStatus(status);
          return status;
        }
        if (retryCount >= LOOP_SUBTASK_RETRY_MAX_RETRIES) {
          const summary = getLastLoopAssistantContent(subtaskTarget, task.id, round, "subtask");
          await finalizeLoopSubtaskRun({
            taskId: task.id,
            round,
            subtaskId: subtask.id,
            runStatus: status,
            assistantContent: summary,
            tabId: subtaskTarget.tabId,
          });
          terminalProgressStatus = mapLoopRunStatusToSubagentStatus(status);
          return status;
        }

        retryCount += 1;
        appendSystemMessageForLoop(
          target,
          buildLoopSubtaskRetryText(task.id, subtask.id, retryCount)
        );
        await waitForLoopSubtaskRetryDelay();
      }
    } finally {
      progressMonitor.finish(terminalProgressStatus ?? "interrupted");
    }
  }

  async function waitForLoopSubtaskRetryDelay(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, LOOP_SUBTASK_RETRY_DELAY_MS));
  }

  type LoopRoundRunOptions = {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
    role: LoopTaskRole;
    displayPrompt: string;
    modelPrompt: string;
    subtaskId?: string;
  };

  async function runLoopRound(options: LoopRoundRunOptions): Promise<TaskRunStatus> {
    const { input, target, task, round, role, displayPrompt, modelPrompt, subtaskId } = options;
    if (isLoopTaskExecutionInterrupted(task.id)) {
      return "stopped";
    }
    const roundStartedAt = Date.now();
    const activeSubtaskPatch = role === "main"
      ? { activeSubtaskId: null, activeSubtaskIds: [] }
      : buildLoopActiveSubtaskPatch(task.id, subtaskId);
    updateLoopTaskRecord(task.id, {
      status: "running",
      currentRound: round,
      ...activeSubtaskPatch,
      updatedAt: roundStartedAt,
    });
    refreshOpenLoopGroupChatPanelForTask(task.id);

    const roleModel = resolvePromptRunModelForRole(input, role);
    const thinkingModeOverride = resolvePromptRunThinkingModeForRole(input, target.cli, role, roleModel, {
      applySubtaskCap: true,
    });
    await runPrompt({
      ...input,
      displayPrompt,
      modelPrompt,
      model: roleModel,
      taskRole: role,
      loopTaskId: task.id,
      loopRound: round,
      loopSubtaskId: subtaskId,
      thinkingModeOverride,
    }, { targetTabId: target.tabId });

    if (role === "main") {
      const mainSessionId = resolveLoopTaskSessionId(target);
      if (mainSessionId) {
        bindLoopTaskToSession(task.id, mainSessionId);
      }
    }

    const roundEndedAt = Date.now();
    const roundStatus = getLoopRoundRunStatus(task.id, round, role, subtaskId) ?? "end";
    appendLoopRound(task.id, {
      round,
      role,
      subtaskId,
      status: roundStatus,
      startedAt: roundStartedAt,
      endedAt: roundEndedAt,
      summary: buildLoopRoundSummary(round, role, subtaskId),
    });
    return roundStatus;
  }

  function buildLoopActiveSubtaskPatch(
    taskId: string,
    subtaskId?: string,
  ): { activeSubtaskId?: string | null; activeSubtaskIds?: string[] } {
    if (!subtaskId) {
      return {};
    }
    const latest = readLoopTaskRecord(taskId);
    const activeSubtaskIds = latest ? getActiveLoopSubtaskIds(latest) : [];
    if (!activeSubtaskIds.includes(subtaskId)) {
      activeSubtaskIds.push(subtaskId);
    }
    return {
      activeSubtaskId: activeSubtaskIds[0] ?? subtaskId,
      activeSubtaskIds,
    };
  }

  function buildLoopMainDisplayPrompt(rootPrompt: string, round: number): string {
    if (round === 1) {
      return [
        rootPrompt,
        "",
        "Loop 主任务：请拆分目标，优先并发派发互不冲突的子任务，返回 JSON 决策，由程序启动子任务。",
      ].join("\n");
    }
    return [
      `Loop 主任务第 ${round} 轮复核。`,
      "上一批子任务已结束（可能成功或中断），请读取任务记录判断整体是否完成；未完成则返回下一批子任务 JSON。",
      "本轮必须预判 estimatedRemainingRounds，说明当前决策之后预计还剩多少轮。",
    ].join("\n");
  }

  function buildLoopModeratorMainDisplayPrompt(rootPrompt: string, round: number): string {
    if (round === 1) {
      return [
        rootPrompt,
        "",
        "Loop 主持人主智能体：红蓝规划共识已形成，请基于共识进入主从多智能体执行，不再重复红蓝辩论。",
      ].join("\n");
    }
    return [
      `Loop 主持人主智能体第 ${round} 轮复核。`,
      "上一批子任务已结束，请读取首轮红蓝规划共识、任务记录和主从沟通文件；后续实现阶段使用主从多智能体模式继续派发或验收。",
      "本轮必须预判 estimatedRemainingRounds，说明当前决策之后预计还剩多少轮。",
    ].join("\n");
  }

  function buildLoopSubtaskDisplayPrompt(round: number, subtask: LoopSubtaskRecord, retryCount = 0): string {
    const retryLine = retryCount > 0
      ? `第 ${retryCount} 次重试（最多 ${LOOP_SUBTASK_RETRY_MAX_RETRIES} 次）。`
      : "";
    return [
      `Loop 子任务第 ${round} 轮执行：${subtask.title}`,
      retryLine,
      subtask.prompt ?? subtask.title,
    ].filter(Boolean).join("\n");
  }

  function buildLoopMainModelPrompt(
    rootPrompt: string,
    task: LoopTaskRecord,
    round: number,
    continuePrompt?: string,
  ): string {
    const taskId = task.id;
    const taskFile = task.taskStoreFile;
    const communication = getLoopCommunicationPaths(taskId);
    const normalizedContinuePrompt = normalizeLoopContinuePromptForPrompt(continuePrompt);
    return [
      "你正在执行 VS Code 插件的 Loop 模式主任务。",
      `Loop 任务 ID：${taskId}`,
      `当前轮次：${round}`,
      `任务记录文件：${taskFile}`,
      `沟通目录：${communication.dir}`,
      `主任务沟通文件：${communication.mainFile}`,
      `子任务沟通目录：${communication.subtasksDir}`,
      "",
      "Loop 模式原理（必须遵守）：",
      "1. 主任务每轮只输出一个 JSON 决策，不直接做具体实现。",
      `2. 当你返回 status=continue 时，程序会按 subtasks 数组启动 1~${LOOP_PARALLEL_SUBTASK_MAX} 个子任务新会话。`,
      "3. 只有同一批次所有子任务都结束后，程序才会回到当前主任务会话并唤醒你继续复核。",
      "4. 你需要基于任务记录 + 沟通文件再次决策，循环直到你返回 status=completed。",
      "5. 任务不会因为子任务都显示 completed 自动结束，只有你返回 completed 才结束；当前没有可执行子任务且需要人工或外部结果时必须返回 blocked。",
      "",
      "主任务职责：",
      "1. 读取任务记录文件中当前任务的 status、activeSubtaskId、activeSubtaskIds、subTasks 和 rounds 概要。",
      "2. 必须读取主任务沟通文件和子任务沟通目录中的最新执行报告，再做审核验收和下一步决策。",
      "3. 第 1 轮先给出整体阶段计划（建议 3~6 个阶段）并写入主任务沟通文件，然后优先派发首批互不冲突的最小可执行子任务；不要默认只派发 1 个。",
      "4. 后续轮次按计划滚动更新：完成一个子任务或一批子任务后复核一次，不满足就继续派发下一批尽可能并发的子任务。",
      "5. 并发优先：只要能确定多个子任务预计写入文件/目录互不重叠、没有先后依赖、不会争抢同一验证环境，就必须放入同一个 subtasks 批次。",
      "6. 串行兜底：只有共享写入同一文件/同一配置、需要基于另一个子任务产物继续修改、或必须独占同一验证环境时，才只返回 1 个子任务。",
      `7. 每批最多 ${LOOP_PARALLEL_SUBTASK_MAX} 个子任务；如果可并发项超过上限，优先选择当前阶段最独立、收益最高的一组。`,
      "8. 先做审核和验收：对照原始目标、已完成子任务 summary、沟通文件、代码/文档状态和验证结果逐项检查。",
      "9. 若子任务沟通文件已提供可核验的单测/编译命令与结果，主任务无需重复执行这些验证；优先复核逻辑正确性、改动范围和结果一致性，仅在证据缺失或结果可疑时补充验证。",
      "10. 子任务沟通文件的 `## 待主任务确认` 若标记为待确认，你必须先处理：能依据现有事实和规则自主确定时，把结论写入后续子任务 prompt；确实必须用户或人工确认时返回 blocked，不得把该子任务误判为已验收。",
      "11. 每次主任务复核都必须预判 estimatedRemainingRounds：从当前决策之后预计还需要多少个主任务复核轮/子任务批次才能 completed；completed 时必须为 0。",
      "12. 只有验收全部通过，才能返回 completed；有可执行补齐工作时必须返回 continue。只有明确等待外部结果且当前没有可执行子任务时，才可返回 sleep。",
      "13. 主任务只负责复核整体进度、拆分/维护 subTasks、选择下一批最小子任务。",
      "14. 主任务不要直接执行具体代码/文件修改；返回 JSON 后由程序启动子任务。",
      "15. 输出必须是一个 JSON 对象，不要包裹 markdown，不要输出额外解释。",
      "",
      "JSON 协议：",
      '{"status":"completed","estimatedRemainingRounds":0,"answerConclusion":"直接回答用户原始问题的简短结论","finalSummary":"整体完成说明","requirementCoverage":[{"name":"用户需求A","passed":true,"detail":"覆盖说明"}],"roundSummaries":[{"round":1,"subtaskId":"stable-id","title":"子任务标题","summary":"本轮完成内容摘要"}],"acceptance":{"passed":true,"summary":"验收通过说明","checks":[{"name":"目标覆盖","passed":true,"detail":"..."}]}}',
      '{"status":"continue","estimatedRemainingRounds":2,"acceptance":{"passed":false,"summary":"未通过原因","checks":[{"name":"缺口项","passed":false,"detail":"..."}]},"parallelReason":"这些子任务预计写入文件互不重叠、没有先后依赖，可以并发","subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src-a","writeFiles":["src/a.ts","src/a.test.ts"],"prompt":"给子任务A执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"},{"id":"stable-id-b","title":"子任务B标题","conflictGroup":"docs-b","writeFiles":["docs/b.md"],"prompt":"给子任务B执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"}]}',
      '{"status":"continue","estimatedRemainingRounds":1,"acceptance":{"passed":false,"summary":"存在同文件或依赖冲突，必须串行","checks":[{"name":"依赖关系","passed":false,"detail":"B 依赖 A 对 src/shared.ts 的修改结果"}]},"subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src/shared.ts","writeFiles":["src/shared.ts"],"prompt":"给子任务A执行的完整指令"}]}',
      '{"status":"blocked","estimatedRemainingRounds":0,"finalSummary":"阻塞原因"}',
      "",
      "字段要求：",
      "- status 只能是 completed、continue、blocked。",
      "- 每次返回都必须提供 estimatedRemainingRounds；含义是从当前决策之后预计还需要多少个主任务复核轮/子任务批次才能 completed，必须是非负整数。",
      "- status=completed 时必须提供 estimatedRemainingRounds=0、acceptance.passed=true、answerConclusion、finalSummary、requirementCoverage 和 roundSummaries。",
      "- answerConclusion 用于直接回答用户原始问题，应尽量简短明确；finalSummary 用于整体完成说明和交付总结。",
      "- requirementCoverage 必须逐条覆盖用户原始需求，不可遗漏；所有项都必须 passed=true。",
      "- roundSummaries 需要按轮次汇总每轮子任务完成内容，至少包含 round、title、summary；如有 subtaskId 也应带上。",
      "- finalSummary 需要给出整体结果，并基于 roundSummaries 归纳所有轮次完成项与最终交付情况。",
      `- status=continue 时必须提供 acceptance.passed=false、subtasks 数组，数组长度 1~${LOOP_PARALLEL_SUBTASK_MAX}。`,
      "- 当前没有可执行子任务、需要等待外部结果或需要人工判断时，必须返回 blocked，并在 finalSummary 说明等待对象或人工判断点。",
      "- subtasks 中每个对象都必须提供 title 和 prompt；prompt 必须自包含且足够详细，因为子任务每次都会在单独新会话中执行，看不到主任务对话上下文。",
      "- subtasks[*].prompt 至少包含：背景目标、具体范围、预计只读/写文件或目录、执行步骤、验收标准、必须更新任务记录文件和写入沟通文件的要求。",
      "- subtasks[*].id 应稳定可读；如果复用已有子任务，请使用已有 id。",
      "- subtasks[*].writeFiles 可选；但返回多个 subtasks 时，必须为每个会写文件的子任务列出预计写入文件或目录，用于证明文件不冲突；纯验证/调研子任务可省略并在 parallelReason 说明不会写文件。",
      "- subtasks[*].conflictGroup 可选，用于说明冲突域；同一批次内不应出现会互相覆盖的冲突域。",
      "- 返回多个 subtasks 前，必须确认它们的 writeFiles / conflictGroup 互不重叠；只要能确认文件不冲突，就优先并发，不要保守串行；无法判断写入范围的实现类子任务应串行。",
      "- 返回 continue 前，同时更新任务记录文件中的 subTasks、activeSubtaskId、activeSubtaskIds 和 estimatedRemainingRounds。",
      "- 返回 completed 前，同时更新任务记录文件 status=completed、estimatedRemainingRounds=0、answerConclusion、finalSummary、roundSummaries，并保证 acceptance.checks 全部 passed=true。",
      "",
      ...buildLoopSupplementalRequirementsLines(task),
      ...(normalizedContinuePrompt ? [
        "本次继续指令：",
        normalizedContinuePrompt,
        "",
      ] : []),
      "原始目标：",
      rootPrompt,
    ].join("\n");
  }

  function buildLoopModeratorMainModelPrompt(
    rootPrompt: string,
    task: LoopTaskRecord,
    round: number,
    continuePrompt?: string,
  ): string {
    const planningDebate = findReusableLoopPlanningDebateRound(task);
    const planningPaths = planningDebate
      ? buildLoopDebatePaths(task.communicationDir, planningDebate.loopRound, planningDebate.debateRound)
      : null;
    const planningDecision = planningDebate?.consensus?.decision
      ?? (planningDebate ? readLoopPlanningDebateDecision(task, planningDebate) : null);
    const planningConsensus = planningDebate?.consensus;
    const mainSubChatFile = buildLoopMainSubChatTranscriptFile(task.communicationDir);
    const basePrompt = buildLoopMainModelPrompt(
      rootPrompt,
      task,
      round,
      continuePrompt,
    );
    const planningLines = planningDebate && planningPaths
      ? [
          `- 红蓝规划轮次：主任务第 ${planningDebate.loopRound} 轮 / 辩论第 ${planningDebate.debateRound} 轮`,
          `- brief 文件：${planningPaths.briefFile}`,
          `- 红蓝群聊记录：${planningPaths.chatFile}`,
          `- 参与者清单：${planningPaths.participantRosterFile}`,
          `- cross-review 文件：${planningPaths.crossReviewFile}`,
          `- consensus 文件：${planningPaths.consensusFile}`,
          `- decision 文件：${planningPaths.decisionFile}`,
          planningConsensus?.summary ? `- 红蓝共识摘要：${planningConsensus.summary}` : "- 红蓝共识摘要：未记录",
          planningDecision?.status ? `- 红蓝规划初始决策状态：${planningDecision.status}` : "- 红蓝规划初始决策状态：未解析",
          typeof planningDecision?.estimatedRemainingRounds === "number"
            ? `- 红蓝规划预计剩余轮次：${planningDecision.estimatedRemainingRounds}`
            : "- 红蓝规划预计剩余轮次：未记录",
        ]
      : [
          "- 未找到可复用的红蓝规划共识；如果你无法确认规划基线，必须返回 blocked，说明需要先完成规划辩论。",
        ];

    return [
      "你正在执行 VS Code 插件的 Loop 红蓝辩论模式后续实现阶段。",
      "",
      "关键阶段规则（必须优先遵守）：",
      "1. 红蓝辩论只用于规划阶段；当前阶段不要再启动、要求或模拟新的红蓝辩论。",
      "2. 你现在是主持人主智能体，负责把首轮红蓝规划共识落到主从多智能体执行链路中。",
      "3. 后续实现、复核、继续派发和最终验收都由你主持；具体实现仍由程序根据你的 JSON 决策启动子任务。",
      "4. 你必须把首轮红蓝共识作为规划基线。只有执行反馈证明共识需要调整时，才可通过新的子任务、验收标准或 blocked 决策调整，不得忽略红队已识别的风险。",
      "5. 你仍然不能直接修改工作区内容；只能输出一个符合 LoopMainDecision 的 JSON，由程序派发子任务。",
      "",
      "必须读取的规划与执行上下文：",
      ...planningLines,
      `- 主从执行群聊：${mainSubChatFile}`,
      `- 主任务沟通文件：${task.mainCommunicationFile}`,
      `- 任务记录文件：${task.taskStoreFile}`,
      "",
      "主持人主智能体职责补充：",
      "- 第 1 次红蓝共识已经完成了规划审查；你应从主从执行视角拆分或复核子任务，不要重复组织蓝队/红队发言。",
      "- 派发子任务时，必须把相关红蓝共识、红队风险、蓝队修正方案和验收证据要求写入 subtasks[*].prompt。",
      "- 子任务完成后，优先依据子任务沟通文件和主从执行群聊做验收；证据不足时继续派发验证或修复子任务。",
      "- 如果执行阶段发现首轮共识存在无法自动化解决的阻塞问题，返回 status=blocked，并在 finalSummary 说明需要人工复核的原因。",
      "",
      "下面是通用主任务协议，除本节新增的红蓝规划阶段规则外，仍需完整遵守：",
      "",
      basePrompt,
    ].join("\n");
  }

  function buildLoopSubtaskModelPrompt(
    rootPrompt: string,
    task: LoopTaskRecord,
    round: number,
    subtask: LoopSubtaskRecord,
    retryCount = 0,
    communicationFile?: string
  ): string {
    const taskId = task.id;
    const taskFile = task.taskStoreFile;
    const communication = getLoopCommunicationPaths(taskId);
    const reportFile = communicationFile ?? buildLoopSubtaskCommunicationFile(taskId, subtask.id, round, retryCount);
    const writeFiles = Array.isArray(subtask.writeFiles) && subtask.writeFiles.length > 0
      ? subtask.writeFiles.join("、")
      : "未声明；以当前子任务指令明确授权的文件/范围为准";
    return [
      "你正在执行 VS Code 插件的 Loop 模式子任务。",
      "注意：这是单独新会话，不具备主任务对话上下文；只能依赖本提示词和任务记录文件。",
      "注意：同一轮可能存在其他子任务并发执行；必须严格限定在当前子任务授权范围内，发现写入范围冲突时先停止并在沟通文件中报告。",
      `Loop 任务 ID：${taskId}`,
      `当前轮次：${round}`,
      `当前子任务 ID：${subtask.id}`,
      `当前重试次数：${retryCount}`,
      `任务记录文件：${taskFile}`,
      `沟通目录：${communication.dir}`,
      `本子任务沟通文件：${reportFile}`,
      "",
      "子任务职责：",
      "1. 只执行当前子任务，不重新拆分主目标。",
      "2. 可以进行当前子任务范围内必要代码/文件修改和验证，不要修改未在指令或 writeFiles 中授权的范围。",
      "3. 完成后更新任务记录文件中对应 subTasks 项的 status、summary 和 communicationFile。",
      "4. 子任务结束前必须把执行情况写入本子任务沟通文件，主任务唤醒后一定会读取该文件。",
      "5. 涉及代码改动时，优先在子任务内完成必要单测/编译，并把命令与结果写入沟通文件，供主任务直接复核，不要留给主任务重复执行。",
      "6. 沟通文件必须写清：执行目标、实际修改/操作、涉及文件、验证命令与结果、遗留问题、给主任务的建议。",
      "7. 子任务结束后不要继续生成下一个子任务；程序会自动唤醒主任务复核。",
      "8. 在一个连续执行回合内完成当前授权范围；先实施，再只运行能直接证明本次改动的最小必要检查。不要为了可选调研、额外检查或无关重试增加轮次。",
      "",
      "疑问交接协议（强制）：",
      "1. 只有当需求不明、授权不足、依赖或写入冲突，或存在必须由主任务/用户确认后才能安全继续的问题时，立即停止实施；能依据现有事实和规则自行判断的问题不得上交。",
      "2. 在本子任务沟通文件的 `## 待主任务确认` 章节写明：待确认问题、已知事实、影响/阻塞步骤、可选方案、推荐方案；不要等待回复。",
      "3. 合并更新任务记录中当前 subTasks 项：status=completed，summary 明确“待主任务确认”，communicationFile 指向本文件；然后结束子任务。",
      "4. 严禁在 assistant 回复中向用户或主任务提问，也不得复述待确认问题；疑问只允许出现在沟通文件中。",
      "5. 疑问交接场景的最终 assistant 回复必须且只能是：`子任务已结束，待主任务确认事项已写入沟通文件。`",
      "",
      "当前子任务：",
      `标题：${subtask.title}`,
      `授权写入文件/范围：${writeFiles}`,
      `指令：${subtask.prompt ?? subtask.title}`,
      "",
      "原始目标：",
      rootPrompt,
    ].join("\n");
  }

  return {
    appendLoopMainSubChatMainDecision,
    appendLoopMainSubChatSubtaskFinished,
    appendLoopSupplementalRequirement,
    appendLoopSupplementalRequirementToCommunication,
    appendTextFileEnsuringDir,
    readTextFileIfNonEmpty,
    runClassicLoopMainDecision,
    runLoopDebateRound,
    runLoopSubtasksBatchWithRetry,
    shouldRunLoopPlanningDebate,
    writeTextFileEnsuringDir,
  };
}
