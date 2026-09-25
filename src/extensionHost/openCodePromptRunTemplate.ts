import type { RunProcess } from "../cli/commandRunner";
import type { OpenCodeSubagentMonitor } from "../cli/openCodeSubagentMonitor";
import type { CliName, ThinkingMode } from "../cli/types";
import type { FinalConclusionCheckOptions } from "../finalConclusion";
import type { I18nKey } from "../i18n";
import type { LoopTaskRole } from "../promptRunState";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import type {
  OpenCodeRuntimePreparation,
  OpenCodeRuntimePreparationInput,
  PreparedOpenCodeSubagentRuntime,
  PromptRunExecutionOptions,
} from "./promptExecutionShared";

export type OpenCodePromptAttemptResult =
  | { type: "exit"; code: number | null }
  | { type: "error"; error: Error };

export type OpenCodePromptRunOutput = ReturnType<typeof import("../cli/commandRunner").parseOpenCodeRunOutput>;

export type OpenCodePromptStreamState = {
  rawStdout: string;
  rawStderr: string;
  sessionBuffer: string;
  attemptHadNormalReply: boolean;
};

export type OpenCodePromptRunGuard =
  | { status: "skip" }
  | {
    status: "ready";
    prompt: string;
    modelPrompt: string;
    runCli: "opencode";
  };

export type OpenCodePromptPreparedRun = {
  input: PromptRunInput;
  target: PromptRunTarget;
  executionOptions: PromptRunExecutionOptions;
  prompt: string;
  modelPrompt: string;
  runCli: "opencode";
  cwd: string | undefined;
  runtimePreparation: OpenCodeRuntimePreparation;
  runtimeModel: string;
  thinkingMode: ThinkingMode;
  includeFinalAnswerInstruction: boolean;
  humanInteractionEnabled: boolean;
  thinkingPrompt: string;
  hiddenRetryPrompt: string;
  shouldAutoCompactAfterRun: boolean;
  messageTarget: ChatMessage[];
};

export type OpenCodePromptUserIdentity = {
  userMessageId: string;
  userCreatedAt: number;
};

export type OpenCodePromptRetryContext = {
  retryNumber: number;
  retryDelayMs: number;
  attemptNumber: number;
  hiddenRetryCount: number;
  isFreshSessionRecoveryAttempt: boolean;
};

export type OpenCodePromptAttemptContext = {
  attemptNumber: number;
  hiddenRetryCount: number;
  isFreshSessionRecoveryAttempt: boolean;
};

export type OpenCodePromptStartupWatchdog = {
  arm: () => void;
  dispose: () => void;
};

export type OpenCodePromptStartupWatchdogContext = {
  attemptNumber: number;
  hiddenRetryCount: number;
  isRunActive: () => boolean;
  getOutputLengths: () => { stdout: number; stderr: number };
  settle: (result: OpenCodePromptAttemptResult) => void;
};

export type OpenCodePromptSubagentMonitorContext = {
  subagentRuntime: PreparedOpenCodeSubagentRuntime;
  attemptNumber: number;
  directory: string;
};

export type OpenCodePromptStreamFinishContext = {
  attemptPrompt: string;
  attemptResult: OpenCodePromptAttemptResult;
  stream: OpenCodePromptStreamState;
  runtimeSessionId: string | null;
  attemptNumber: number;
  hiddenRetryCount: number;
  isFreshSessionRecoveryAttempt: boolean;
};

export type OpenCodePromptSessionAdoption = {
  attemptResult: OpenCodePromptAttemptResult;
  rawStdout: string;
  rawStderr: string;
  sessionBuffer: string;
  isFreshSessionRecoveryAttempt: boolean;
  isLoopMainRun: boolean;
  runtimeSessionId: string | null;
};

export type OpenCodePromptMissingConclusionRetryLog = {
  cli: "opencode";
  runId: string;
  tabId: string;
  sessionId: string | null;
  taskRole: LoopTaskRole | undefined;
  loopTaskId: string | undefined;
  loopRound: number | undefined;
  attempt: number;
  retryCount: number;
  maxRetries: number;
  conversationHasFinalConclusion: boolean;
  currentAttemptHasAssistantAnswer: boolean;
  structuredFinalAnswer: boolean;
  stdoutLength: number;
  stderrLength: number;
  freshSessionRecoveryQueued: boolean;
};

export type OpenCodePromptMissingConclusionFailureLog = {
  cli: "opencode";
  runId: string;
  tabId: string;
  sessionId: string | null;
  taskRole: LoopTaskRole | undefined;
  loopTaskId: string | undefined;
  loopRound: number | undefined;
  hiddenRetryCount: number;
  conversationHasFinalConclusion: boolean;
  currentAttemptHasAssistantAnswer: boolean;
  structuredFinalAnswer: boolean;
  stdoutLength: number;
  stderrLength: number;
};

export type OpenCodePromptMissingConclusionRetry = {
  shouldRecoverFreshSession: boolean;
  missingConclusionMessage: string;
  hiddenRetryCount: number;
};

export type OpenCodePromptFailureAttempt = {
  attemptResult: OpenCodePromptAttemptResult;
  rawStdout: string;
  rawStderr: string;
  attemptHadNormalReply: boolean;
  hiddenRetryCount: number;
};

export type OpenCodePromptFailureEvaluation = {
  hiddenRetryCount: number;
  shouldRetry: boolean;
};

export type OpenCodePromptSuccessCompletion = {
  sessionId: string | null;
  durationMs: number | null;
};

export type OpenCodePromptRunPorts = {
  guardRun: (input: PromptRunInput, target: PromptRunTarget) => OpenCodePromptRunGuard;
  resolveWorkspaceCwd: () => string | undefined;
  noteMissingWorkspace: (cli: "opencode", cwd: string | undefined) => void;
  prepareOpenCodeRuntime: (
    input?: string | null | OpenCodeRuntimePreparationInput,
  ) => Promise<OpenCodeRuntimePreparation>;
  getEffectiveThinkingMode: (cli: CliName, model?: string | null) => ThinkingMode;
  applyThinkingWorkspaceFiles: (cli: CliName, thinkingMode: ThinkingMode, cwd?: string) => void;
  shouldAutoCompactContextAfterRunForTarget: (target: PromptRunTarget) => boolean;
  preparePendingLabel: (cli: CliName, tabId: string, prompt: string) => void;
  readGlobalHumanInteractionEnabled: () => boolean;
  buildThinkingPrompt: typeof import("../promptRuntime").buildThinkingPrompt;
  buildHiddenRetryPrompt: typeof import("../promptRuntime").buildHiddenRetryPrompt;
  beforeLoadMessages: () => void;
  loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[];
  getPendingSessionDraft: (tabId: string, cli: CliName) => { messages: ChatMessage[] };
  stageRunBeforeUserMessage: (prepared: OpenCodePromptPreparedRun) => void;
  createMessageId: () => string;
  bindRunIdentityBeforeUserBubble: (
    prepared: OpenCodePromptPreparedRun,
    identity: OpenCodePromptUserIdentity,
  ) => void;
  buildUserChatMessage: (input: PromptRunInput, createdAt: number, messageId: string) => ChatMessage;
  appendUserMessage: (messageTarget: ChatMessage[], message: ChatMessage) => void;
  finishRunActivation: (
    prepared: OpenCodePromptPreparedRun,
    identity: OpenCodePromptUserIdentity,
  ) => void;
  isRunActive: () => boolean;
  resolveMessageTarget: () => ChatMessage[];
  getRunId: () => string;
  getSessionId: () => string | null;
  takeContinuationPrompt: () => string | null;
  getHiddenRetryDelayMs: (retryNumber: number) => number;
  waitForHiddenRetryDelay: (retryNumber: number, isRunActive: () => boolean) => Promise<boolean>;
  prepareHiddenRetry: (context: OpenCodePromptRetryContext) => void;
  publishSystem: (content: string) => void;
  t: (key: I18nKey, params?: Record<string, string | number | boolean>) => string;
  buildHiddenRetryStartedMessage: (retryNumber: number) => string;
  logHiddenRetry: (context: OpenCodePromptRetryContext) => void;
  resolveCliSessionIdForResume: (cli: CliName, sessionId: string | null) => string | null;
  beginStreamAttempt: (context: OpenCodePromptAttemptContext) => void;
  prepareOpenCodeSubagentRuntime: (options: {
    cwd: string | undefined;
    runId: string;
    runtime: OpenCodeRuntimePreparation;
    isolateProjectInstructions?: boolean;
  }) => Promise<PreparedOpenCodeSubagentRuntime>;
  shouldAnnounceSubagentMonitorUnavailable: (error: Error | null, alreadyShown: boolean) => boolean;
  prepareSubagentMonitorUnavailableNotice: () => void;
  logSubagentMonitorStart: (context: {
    subagentRuntime: PreparedOpenCodeSubagentRuntime;
    runtimeSessionId: string | null;
    attemptNumber: number;
    hiddenRetryCount: number;
  }) => void;
  createStartupWatchdog: (context: OpenCodePromptStartupWatchdogContext) => OpenCodePromptStartupWatchdog;
  createSubagentMonitor: (context: OpenCodePromptSubagentMonitorContext) => OpenCodeSubagentMonitor;
  runCliStream: typeof import("../cli/commandRunner").runCliStream;
  buildProcessLabel: typeof import("../cli/commandRunner").buildProcessLabel;
  appendBoundedUtf8Text: typeof import("../boundedText").appendBoundedUtf8Text;
  maxRawOutputBytes: number;
  maxHiddenRetries: number;
  onStdoutChunk: (chunk: string, stream: OpenCodePromptStreamState) => void;
  onStderrChunk: (chunk: string, stream: OpenCodePromptStreamState) => void;
  onAttemptProcessStarted: (process: RunProcess, runtimeSessionId: string | null) => void;
  finishStreamAttempt: (context: OpenCodePromptStreamFinishContext) => boolean;
  adoptSession: (adoption: OpenCodePromptSessionAdoption) => void;
  beginSuccessfulExit: (context: {
    attemptResult: OpenCodePromptAttemptResult;
    stream: OpenCodePromptStreamState;
    attemptPrompt: string;
    runtimeSessionId: string | null;
  }) => void;
  parseOpenCodeRunOutput: typeof import("../cli/commandRunner").parseOpenCodeRunOutput;
  appendParsedOutput: (output: OpenCodePromptRunOutput) => ChatMessage[];
  maybeHandleNaturalLanguageHumanInteraction: (
    targetMessages: ChatMessage[],
    finalText: string | null,
  ) => Promise<"continue" | "stopped" | false>;
  hasAssistantFinalConclusionAfterMessage: (
    messages: ChatMessage[],
    messageId: string,
    options?: FinalConclusionCheckOptions,
  ) => boolean;
  shouldRequireExplicitFinalAnswerForRun: (input: PromptRunInput) => boolean;
  resolveOpenCodeSuccessfulExitOutcome: typeof import("../openCodeRunCompletion").resolveOpenCodeSuccessfulExitOutcome;
  buildOpenCodeMissingFinalConclusionMessage: (output: OpenCodePromptRunOutput) => string;
  shouldRecoverOpenCodeLoopMainSessionInFreshSession: typeof import("../openCodeRunCompletion").shouldRecoverOpenCodeLoopMainSessionInFreshSession;
  logMissingFinalConclusionRetry: (payload: OpenCodePromptMissingConclusionRetryLog) => void;
  publishMissingConclusionRetry: (
    messageTarget: ChatMessage[],
    retry: OpenCodePromptMissingConclusionRetry,
  ) => void;
  logMissingFinalConclusionFailure: (payload: OpenCodePromptMissingConclusionFailureLog) => void;
  finalizeMissingFinalConclusion: (context: {
    missingConclusionMessage: string;
    finalMessageTarget: ChatMessage[];
    hiddenRetryCount: number;
    openCodeOutput: OpenCodePromptRunOutput;
  }) => Promise<void>;
  finalizeSuccessfulExit: (context: {
    finalMessageTarget: ChatMessage[];
    openCodeOutput: OpenCodePromptRunOutput;
    currentAttemptHasAssistantAnswer: boolean;
    conversationHasFinalConclusion: boolean;
  }) => Promise<OpenCodePromptSuccessCompletion>;
  maybeAutoCompactContextAfterPromptSuccess: (
    target: PromptRunTarget,
    sessionId: string | null,
    durationMs: number | null | undefined,
  ) => Promise<void>;
  evaluateFailedAttempt: (context: OpenCodePromptFailureAttempt) => OpenCodePromptFailureEvaluation;
  recordFailedAttemptRetry: (context: OpenCodePromptFailureAttempt) => void;
  finalizeFailedAttempt: (context: OpenCodePromptFailureAttempt) => Promise<void>;
};

export async function runOpenCodePromptTemplate(
  input: PromptRunInput,
  target: PromptRunTarget,
  executionOptions: PromptRunExecutionOptions = {},
  ports: OpenCodePromptRunPorts,
): Promise<void> {
  const guarded = ports.guardRun(input, target);
  if (guarded.status === "skip") {
    return;
  }
  const { prompt, modelPrompt, runCli } = guarded;
  const cwd = executionOptions.cwd ?? ports.resolveWorkspaceCwd();
  ports.noteMissingWorkspace(runCli, cwd);
  const runtimePreparation = await ports.prepareOpenCodeRuntime({
    role: input.taskRole === "subtask" ? "subtask" : "main",
    model: input.model ?? null,
    requiresSubtaskModel: Boolean(input.loopTaskId || input.graphRunId),
  });
  const runtimeModel = runtimePreparation.effectiveModel;
  const thinkingMode = input.thinkingModeOverride ?? ports.getEffectiveThinkingMode(runCli, runtimeModel);
  ports.applyThinkingWorkspaceFiles(runCli, thinkingMode, cwd);
  const shouldAutoCompactAfterRun = ports.shouldAutoCompactContextAfterRunForTarget(target);
  ports.preparePendingLabel(runCli, target.tabId, prompt);
  const includeFinalAnswerInstruction = !input.loopTaskId;
  const humanInteractionEnabled = !input.loopTaskId
    && !input.graphRunId
    && ports.readGlobalHumanInteractionEnabled();
  const thinkingPrompt = ports.buildThinkingPrompt(runCli, thinkingMode, modelPrompt, {
    includeFinalAnswerInstruction,
    includeHumanInteractionInstruction: humanInteractionEnabled,
  });
  const hiddenRetryPrompt = ports.buildHiddenRetryPrompt(runCli, thinkingMode, {
    includeFinalAnswerInstruction,
  });
  ports.beforeLoadMessages();
  const messageTarget = target.sessionId
    ? ports.loadSessionMessages(runCli, target.sessionId)
    : ports.getPendingSessionDraft(target.tabId, runCli).messages;
  const prepared: OpenCodePromptPreparedRun = {
    input,
    target,
    executionOptions,
    prompt,
    modelPrompt,
    runCli,
    cwd,
    runtimePreparation,
    runtimeModel,
    thinkingMode,
    includeFinalAnswerInstruction,
    humanInteractionEnabled,
    thinkingPrompt,
    hiddenRetryPrompt,
    shouldAutoCompactAfterRun,
    messageTarget,
  };
  ports.stageRunBeforeUserMessage(prepared);
  const userMessageId = input.preloadedUserMessageId ?? ports.createMessageId();
  const userCreatedAt = Date.now();
  const identity = { userMessageId, userCreatedAt };
  ports.bindRunIdentityBeforeUserBubble(prepared, identity);
  if (!input.preloadedUserMessageId) {
    ports.appendUserMessage(messageTarget, ports.buildUserChatMessage(input, userCreatedAt, userMessageId));
  }
  ports.finishRunActivation(prepared, identity);

  let hiddenRetryCount = 0;
  const isLoopMainRun = Boolean(input.loopTaskId && input.taskRole === "main");
  let freshSessionRecoveryPending = false;
  let freshSessionRecoveryAttempted = false;
  let monitorUnavailableNoticeShown = false;

  while (true) {
    const isFreshSessionRecoveryAttempt = freshSessionRecoveryPending;
    freshSessionRecoveryPending = false;
    if (isFreshSessionRecoveryAttempt) {
      freshSessionRecoveryAttempted = true;
    }
    const attemptNumber = hiddenRetryCount + 1;
    const continuationPrompt = ports.takeContinuationPrompt();
    const attemptPrompt = continuationPrompt
      ?? ((isFreshSessionRecoveryAttempt || hiddenRetryCount === 0) ? thinkingPrompt : hiddenRetryPrompt);
    if (hiddenRetryCount > 0) {
      const retryNumber = hiddenRetryCount;
      const retryDelayMs = ports.getHiddenRetryDelayMs(retryNumber);
      const shouldContinue = await ports.waitForHiddenRetryDelay(retryNumber, ports.isRunActive);
      if (!shouldContinue) {
        return;
      }
      const retryContext = {
        retryNumber,
        retryDelayMs,
        attemptNumber,
        hiddenRetryCount,
        isFreshSessionRecoveryAttempt,
      };
      ports.prepareHiddenRetry(retryContext);
      if (isFreshSessionRecoveryAttempt) {
        ports.publishSystem(ports.t("run.openCodeLoopFreshSessionRecoveryStarted"));
      }
      ports.publishSystem(ports.buildHiddenRetryStartedMessage(retryNumber));
      ports.logHiddenRetry(retryContext);
    }

    const stream: OpenCodePromptStreamState = {
      rawStdout: "",
      rawStderr: "",
      sessionBuffer: "",
      attemptHadNormalReply: false,
    };
    ports.beginStreamAttempt({
      attemptNumber,
      hiddenRetryCount,
      isFreshSessionRecoveryAttempt,
    });
    const runtimeSessionId = isFreshSessionRecoveryAttempt
      ? null
      : ports.resolveCliSessionIdForResume(runCli, ports.getSessionId());
    const subagentRuntime = await ports.prepareOpenCodeSubagentRuntime({
      cwd,
      runId: ports.getRunId(),
      runtime: runtimePreparation,
      isolateProjectInstructions: executionOptions.isolateProjectInstructions,
    });
    if (ports.shouldAnnounceSubagentMonitorUnavailable(subagentRuntime.error, monitorUnavailableNoticeShown)) {
      monitorUnavailableNoticeShown = true;
      ports.prepareSubagentMonitorUnavailableNotice();
      ports.publishSystem(ports.t("run.openCodeSubagentMonitorUnavailable"));
    }
    ports.logSubagentMonitorStart({
      subagentRuntime,
      runtimeSessionId,
      attemptNumber,
      hiddenRetryCount,
    });
    const attemptResult = await runOpenCodePromptAttemptStream({
      ports,
      stream,
      runCli,
      attemptPrompt,
      cwd,
      runtimeSessionId,
      thinkingMode,
      runtimePreparation,
      executionOptions,
      subagentRuntime,
      attemptNumber,
      hiddenRetryCount,
    });
    if (!ports.finishStreamAttempt({
      attemptPrompt,
      attemptResult,
      stream,
      runtimeSessionId,
      attemptNumber,
      hiddenRetryCount,
      isFreshSessionRecoveryAttempt,
    })) {
      return;
    }
    ports.adoptSession({
      attemptResult,
      rawStdout: stream.rawStdout,
      rawStderr: stream.rawStderr,
      sessionBuffer: stream.sessionBuffer,
      isFreshSessionRecoveryAttempt,
      isLoopMainRun,
      runtimeSessionId,
    });
    if (attemptResult.type === "exit" && attemptResult.code === 0) {
      ports.beginSuccessfulExit({
        attemptResult,
        stream,
        attemptPrompt,
        runtimeSessionId,
      });
      const openCodeOutput = ports.parseOpenCodeRunOutput(stream.rawStdout, stream.rawStderr);
      const finalMessageTarget = ports.appendParsedOutput(openCodeOutput);
      const humanInteractionResult = await ports.maybeHandleNaturalLanguageHumanInteraction(
        finalMessageTarget,
        openCodeOutput.finalText,
      );
      if (humanInteractionResult === "stopped") {
        return;
      }
      if (humanInteractionResult === "continue") {
        hiddenRetryCount = 0;
        freshSessionRecoveryPending = false;
        continue;
      }
      const conversationHasFinalConclusion = ports.hasAssistantFinalConclusionAfterMessage(
        finalMessageTarget,
        userMessageId,
        {
          observedFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
          fallbackCreatedAt: userCreatedAt,
          requireExplicitFinalAnswer: ports.shouldRequireExplicitFinalAnswerForRun(input),
        },
      );
      const currentAttemptHasAssistantAnswer = stream.attemptHadNormalReply
        || Boolean(openCodeOutput.finalText?.trim());
      const successfulExitOutcome = ports.resolveOpenCodeSuccessfulExitOutcome({
        isLoopRun: Boolean(input.loopTaskId),
        currentAttemptHasAssistantAnswer,
        conversationHasFinalConclusion,
        hiddenRetryCount,
        maxHiddenRetries: ports.maxHiddenRetries,
      });
      if (successfulExitOutcome !== "complete") {
        const missingConclusionMessage = ports.buildOpenCodeMissingFinalConclusionMessage(openCodeOutput);
        if (successfulExitOutcome === "retry") {
          const shouldRecoverFreshSession = ports.shouldRecoverOpenCodeLoopMainSessionInFreshSession({
            isLoopMainRun,
            hasResumableSession: Boolean(ports.resolveCliSessionIdForResume(runCli, ports.getSessionId())),
            hasProviderError: Boolean(openCodeOutput.errorText),
            freshSessionRecoveryAttempted,
          });
          ports.logMissingFinalConclusionRetry({
            cli: runCli,
            runId: ports.getRunId(),
            tabId: target.tabId,
            sessionId: ports.getSessionId(),
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            attempt: hiddenRetryCount + 1,
            retryCount: hiddenRetryCount,
            maxRetries: ports.maxHiddenRetries,
            conversationHasFinalConclusion,
            currentAttemptHasAssistantAnswer,
            structuredFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
            stdoutLength: stream.rawStdout.length,
            stderrLength: stream.rawStderr.length,
            freshSessionRecoveryQueued: shouldRecoverFreshSession,
          });
          if (shouldRecoverFreshSession) {
            freshSessionRecoveryPending = true;
          }
          ports.publishMissingConclusionRetry(finalMessageTarget, {
            shouldRecoverFreshSession,
            missingConclusionMessage,
            hiddenRetryCount,
          });
          hiddenRetryCount += 1;
          continue;
        }
        ports.logMissingFinalConclusionFailure({
          cli: runCli,
          runId: ports.getRunId(),
          tabId: target.tabId,
          sessionId: ports.getSessionId(),
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          hiddenRetryCount,
          conversationHasFinalConclusion,
          currentAttemptHasAssistantAnswer,
          structuredFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
          stdoutLength: stream.rawStdout.length,
          stderrLength: stream.rawStderr.length,
        });
        await ports.finalizeMissingFinalConclusion({
          missingConclusionMessage,
          finalMessageTarget,
          hiddenRetryCount,
          openCodeOutput,
        });
        return;
      }
      const completion = await ports.finalizeSuccessfulExit({
        finalMessageTarget,
        openCodeOutput,
        currentAttemptHasAssistantAnswer,
        conversationHasFinalConclusion,
      });
      if (shouldAutoCompactAfterRun) {
        await ports.maybeAutoCompactContextAfterPromptSuccess(target, completion.sessionId, completion.durationMs);
      }
      return;
    }

    const failure = ports.evaluateFailedAttempt({
      attemptResult,
      rawStdout: stream.rawStdout,
      rawStderr: stream.rawStderr,
      attemptHadNormalReply: stream.attemptHadNormalReply,
      hiddenRetryCount,
    });
    hiddenRetryCount = failure.hiddenRetryCount;
    if (failure.shouldRetry) {
      ports.recordFailedAttemptRetry({
        attemptResult,
        rawStdout: stream.rawStdout,
        rawStderr: stream.rawStderr,
        attemptHadNormalReply: stream.attemptHadNormalReply,
        hiddenRetryCount,
      });
      hiddenRetryCount += 1;
      continue;
    }
    await ports.finalizeFailedAttempt({
      attemptResult,
      rawStdout: stream.rawStdout,
      rawStderr: stream.rawStderr,
      attemptHadNormalReply: stream.attemptHadNormalReply,
      hiddenRetryCount,
    });
    return;
  }
}

async function runOpenCodePromptAttemptStream(options: {
  ports: OpenCodePromptRunPorts;
  stream: OpenCodePromptStreamState;
  runCli: "opencode";
  attemptPrompt: string;
  cwd: string | undefined;
  runtimeSessionId: string | null;
  thinkingMode: ThinkingMode;
  runtimePreparation: OpenCodeRuntimePreparation;
  executionOptions: PromptRunExecutionOptions;
  subagentRuntime: PreparedOpenCodeSubagentRuntime;
  attemptNumber: number;
  hiddenRetryCount: number;
}): Promise<OpenCodePromptAttemptResult> {
  const {
    ports,
    stream,
    runCli,
    attemptPrompt,
    cwd,
    runtimeSessionId,
    thinkingMode,
    runtimePreparation,
    executionOptions,
    subagentRuntime,
    attemptNumber,
    hiddenRetryCount,
  } = options;
  return await new Promise<OpenCodePromptAttemptResult>((resolve) => {
    let settled = false;
    let settleAttempt: (result: OpenCodePromptAttemptResult) => void = () => {};
    const watchdog = ports.createStartupWatchdog({
      attemptNumber,
      hiddenRetryCount,
      isRunActive: ports.isRunActive,
      getOutputLengths: () => ({
        stdout: stream.rawStdout.length,
        stderr: stream.rawStderr.length,
      }),
      settle: (result) => {
        settleAttempt(result);
      },
    });
    const subagentMonitor = ports.createSubagentMonitor({
      subagentRuntime,
      attemptNumber,
      directory: cwd ?? process.cwd(),
    });
    const settle = (result: OpenCodePromptAttemptResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      subagentMonitor.finish(result.type === "exit" && result.code === 0 ? "completed" : "failed");
      subagentRuntime.dispose();
      watchdog.dispose();
      resolve(result);
    };
    settleAttempt = settle;
    watchdog.arm();
    const runProcess = ports.runCliStream(
      runCli,
      attemptPrompt,
      {
        onStdout: (chunk: string) => {
          if (!ports.isRunActive()) {
            return;
          }
          stream.rawStdout = ports.appendBoundedUtf8Text(stream.rawStdout, chunk, ports.maxRawOutputBytes).text;
          ports.onStdoutChunk(chunk, stream);
        },
        onStderr: (chunk: string) => {
          if (!ports.isRunActive()) {
            return;
          }
          stream.rawStderr = ports.appendBoundedUtf8Text(stream.rawStderr, chunk, ports.maxRawOutputBytes).text;
          ports.onStderrChunk(chunk, stream);
        },
        onExit: (code: number | null) => {
          settle({ type: "exit", code });
        },
        onError: (error: Error) => {
          settle({ type: "error", error });
        },
      },
      {
        cwd,
        sessionId: runtimeSessionId,
        thinkingMode,
        openCodeVariant: runtimePreparation.effectiveVariant,
        openCodeSmallVariant: runtimePreparation.subtaskVariant,
        model: runtimePreparation.effectiveModel,
        openCodeSmallModel: runtimePreparation.subtaskModel,
        openCodeConfigContent: runtimePreparation.configContent,
        envOverrides: runtimePreparation.envOverrides,
        isolateProjectInstructions: executionOptions.isolateProjectInstructions,
        openCodeServerUrl: subagentRuntime.connection?.serverUrl,
        processLabel: ports.buildProcessLabel(runCli, runtimeSessionId ?? ports.getRunId()),
      },
    );
    ports.onAttemptProcessStarted(runProcess, runtimeSessionId);
  });
}
