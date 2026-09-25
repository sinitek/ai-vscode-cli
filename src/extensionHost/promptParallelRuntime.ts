import type { RunProcess } from "../cli/commandRunner";
import type { OpenCodeTaskListItem } from "../cli/openCodeTaskList";
import type { OpenCodeSubagentMonitor } from "../cli/openCodeSubagentMonitor";
import type { CliName, ThinkingMode } from "../cli/types";
import {
  buildNaturalLanguageHumanInteractionRequest,
  formatHumanInteractionSubmittedText,
  type HumanInteractionRequest,
  type HumanInteractionSubmission,
} from "../humanInteraction";
import type { I18nKey } from "../i18n";
import type { OpenCodeTabStreamAction } from "../openCodeTabStream";
import type { CliAttemptResult } from "../panelDiagnostics";
import type { LoopTaskRole, TaskRunRecord, TaskRunStatus } from "../promptRunState";
import type { SubagentProgressLabels, SubagentProgressUpdate } from "../subagentProgress";
import type { TraceMessageKind } from "../traceDisplay";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import type {
  OpenCodeRuntimePreparation,
  OpenCodeRuntimePreparationInput,
  PreparedOpenCodeSubagentRuntime,
  PromptRunExecutionOptions,
} from "./promptExecutionShared";
import { runOpenCodePromptTemplate } from "./openCodePromptRunTemplate";

type OpenCodeRunOutput = ReturnType<typeof import("../cli/commandRunner").parseOpenCodeRunOutput>;

type PromptParallelTabRun = {
  runId: string;
  tabId: string;
  cli: CliName;
  sessionId: string | null;
  prompt: string;
  startedAt: number;
  process: RunProcess;
  messageTarget: ChatMessage[];
  stopped: boolean;
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  graphRunId?: string;
  graphNodeId?: string;
};

type PromptParallelRuntimeRequiredHostDeps = {
  AI_TASK_RAW_OUTPUT_MAX_BYTES: number;
  HIDDEN_RETRY_MAX_RETRIES: number;
  OPENCODE_SUBAGENT_POLL_INTERVAL_MS: number;
  adoptDetectedSessionId: (
    cli: CliName,
    sessionId: string,
    tabId: string | null,
    previousSessionId: string | null,
  ) => void;
  adoptFreshOpenCodeLoopRecoverySession: (options: {
    sessionId: string;
    previousSessionId: string | null;
    tabId: string | null;
    messageTarget: ChatMessage[];
    loopTaskId: string;
  }) => ChatMessage[];
  appendBoundedUtf8Text: typeof import("../boundedText").appendBoundedUtf8Text;
  appendHiddenRetryErrorTraceMessage: typeof import("../panelDiagnostics").appendHiddenRetryErrorTraceMessage;
  appendMessageToStore: typeof import("../promptRunState").appendMessageToStore;
  appendOpenCodeFinalTextToTabStream: typeof import("../openCodeTabStream").appendOpenCodeFinalTextToTabStream;
  appendTaskRun: (record: TaskRunRecord) => void;
  applyThinkingWorkspaceFiles: (cli: CliName, thinkingMode: ThinkingMode, cwd?: string) => void;
  buildHiddenRetryFailureMessage: typeof import("../hiddenRetry").buildHiddenRetryFailureMessage;
  buildHiddenRetryLimitMessage: typeof import("../panelDiagnostics").buildHiddenRetryLimitMessage;
  buildHiddenRetryPrompt: typeof import("../promptRuntime").buildHiddenRetryPrompt;
  buildHiddenRetryQueuedMessage: typeof import("../panelDiagnostics").buildHiddenRetryQueuedMessage;
  buildHiddenRetryStartedMessage: typeof import("../panelDiagnostics").buildHiddenRetryStartedMessage;
  buildOpenCodeFailureMessage: (output: OpenCodeRunOutput, fallbackMessage: string) => string;
  buildOpenCodeMissingFinalConclusionMessage: (output: OpenCodeRunOutput) => string;
  buildProcessLabel: typeof import("../cli/commandRunner").buildProcessLabel;
  buildSubagentProgressLabels: () => SubagentProgressLabels;
  buildTaskRunCompletionText: (status: TaskRunStatus, durationMs?: number | null) => string;
  buildThinkingPrompt: typeof import("../promptRuntime").buildThinkingPrompt;
  buildUserChatMessage: (input: PromptRunInput, createdAt: number, messageId: string) => ChatMessage;
  cancelHumanInteractionForTab: (tabId: string, statusText?: string) => void;
  consumeOpenCodeTabStreamChunk: typeof import("../openCodeTabStream").consumeOpenCodeTabStreamChunk;
  createDisabledOpenCodeSubagentMonitor: () => OpenCodeSubagentMonitor;
  createMessageId: () => string;
  createOpenCodeSubagentMonitor: (options: {
    connection: NonNullable<PreparedOpenCodeSubagentRuntime["connection"]>;
    directory: string;
    onUpdate: (update: SubagentProgressUpdate) => void;
    onNoChildren?: () => void;
    onError?: (error: Error) => void;
  }) => OpenCodeSubagentMonitor;
  createOpenCodeTabStreamState: typeof import("../openCodeTabStream").createOpenCodeTabStreamState;
  createSubagentProgressController: typeof import("../subagentProgress").createSubagentProgressController;
  extractSessionId: typeof import("../sessionLifecycle").extractSessionId;
  getAttemptFailureMessage: (attemptResult: CliAttemptResult, resultErrorText?: string | null) => string;
  getEffectiveThinkingMode: (cli: CliName, model?: string | null) => ThinkingMode;
  getGlobalHumanInteractionEnabled: () => boolean;
  getHiddenRetryDelayMs: typeof import("../hiddenRetry").getHiddenRetryDelayMs;
  getPendingSessionDraft: (tabId: string, cli: CliName) => { messages: ChatMessage[] };
  hasAssistantFinalConclusionAfterMessage: typeof import("../finalConclusion").hasAssistantFinalConclusionAfterMessage;
  isHiddenRetryEligibleAttempt: typeof import("../panelDiagnostics").isHiddenRetryEligibleAttempt;
  isLocalSessionId: (sessionId: string) => boolean;
  loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[];
  logDebug: (event: string, payload?: unknown) => Promise<void>;
  logError: (event: string, payload?: unknown) => Promise<void>;
  logInfo: (event: string, payload?: unknown) => Promise<void>;
  maybeAutoCompactContextAfterPromptSuccess: (
    target: PromptRunTarget,
    sessionId: string | null,
    durationMs: number | null | undefined,
  ) => Promise<void>;
  maybePersistLongTermMemoryFromRun: (options: {
    status: TaskRunStatus;
    cli: CliName;
    prompt: string;
    messages: readonly ChatMessage[];
    taskRole?: LoopTaskRole;
    loopTaskId?: string;
    loopRound?: number;
    loopSubtaskId?: string;
    skip?: boolean;
  }) => void;
  normalizeTraceContentForDisplay: typeof import("../traceDisplay").normalizeTraceContentForDisplay;
  parallelRunsByTabId: Map<string, PromptParallelTabRun>;
  parseOpenCodeRunOutput: typeof import("../cli/commandRunner").parseOpenCodeRunOutput;
  persistMessagesForTab: (cli: CliName, sessionId: string | null, tabId: string, messages: ChatMessage[]) => void;
  prepareOpenCodeRuntime: (input?: string | null | OpenCodeRuntimePreparationInput) => Promise<OpenCodeRuntimePreparation>;
  prepareOpenCodeSubagentRuntime: (options: {
    cwd: string | undefined;
    runId: string;
    runtime: OpenCodeRuntimePreparation;
    isolateProjectInstructions?: boolean;
  }) => Promise<PreparedOpenCodeSubagentRuntime>;
  preparePendingLabel: (cli: CliName, tabId: string, prompt: string) => void;
  requestHumanInteraction: (request: HumanInteractionRequest) => Promise<HumanInteractionSubmission>;
  resetHiddenRetryCountOnRecoveredReply: typeof import("../hiddenRetry").resetHiddenRetryCountOnRecoveredReply;
  resolveCliSessionIdForResume: (cli: CliName, sessionId: string | null) => string | null;
  resolveOpenCodeSuccessfulExitOutcome: typeof import("../openCodeRunCompletion").resolveOpenCodeSuccessfulExitOutcome;
  resolveTraceKind: (content: string, kind: TraceMessageKind) => TraceMessageKind;
  resolveTraceMerge: typeof import("../traceDisplay").resolveTraceMerge;
  resolveWorkspaceCwd: () => string | undefined;
  runCliStream: typeof import("../cli/commandRunner").runCliStream;
  sendOpenCodeTaskListUpdate: (items: readonly OpenCodeTaskListItem[], options: {
    source: "primary-stream" | "parallel-stream";
    tabId?: string | null;
  }) => void;
  sendPanelMessage: (payload: Record<string, unknown>) => void;
  sendRunStatusForTab: (tabId: string, status: "start" | "end" | "error" | "stopped", options?: {
    message?: string;
    prompt?: string;
    startedAt?: number;
    graphRunId?: string;
    graphNodeId?: string;
  }) => void;
  shouldAutoCompactContextAfterRunForTarget: (target: PromptRunTarget) => boolean;
  shouldRecoverOpenCodeLoopMainSessionInFreshSession: typeof import("../openCodeRunCompletion").shouldRecoverOpenCodeLoopMainSessionInFreshSession;
  shouldRequireExplicitFinalAnswerForRun: (input: PromptRunInput) => boolean;
  t: (key: I18nKey, params?: Record<string, string | number | boolean>) => string;
  updateSessionBuffer: (buffer: string, chunk: string) => string;
  waitForHiddenRetryDelay: typeof import("../panelDiagnostics").waitForHiddenRetryDelay;
};

export type PromptParallelRuntimeHostDeps = Partial<PromptParallelRuntimeRequiredHostDeps>;

export type PromptParallelRuntimeHost = {
  runPromptParallel: (
    input: PromptRunInput,
    target: PromptRunTarget,
    executionOptions?: PromptRunExecutionOptions,
  ) => Promise<void>;
};

export function createPromptParallelRuntimeHost(deps: PromptParallelRuntimeHostDeps): PromptParallelRuntimeHost {
  const requiredDeps = deps as PromptParallelRuntimeRequiredHostDeps;
  const {
    AI_TASK_RAW_OUTPUT_MAX_BYTES,
    HIDDEN_RETRY_MAX_RETRIES,
    OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
    adoptDetectedSessionId,
    adoptFreshOpenCodeLoopRecoverySession,
    appendBoundedUtf8Text,
    appendHiddenRetryErrorTraceMessage,
    appendMessageToStore,
    appendOpenCodeFinalTextToTabStream,
    appendTaskRun,
    applyThinkingWorkspaceFiles,
    buildHiddenRetryFailureMessage,
    buildHiddenRetryLimitMessage,
    buildHiddenRetryPrompt,
    buildHiddenRetryQueuedMessage,
    buildHiddenRetryStartedMessage,
    buildOpenCodeFailureMessage,
    buildOpenCodeMissingFinalConclusionMessage,
    buildProcessLabel,
    buildSubagentProgressLabels,
    buildTaskRunCompletionText,
    buildThinkingPrompt,
    buildUserChatMessage,
    consumeOpenCodeTabStreamChunk,
    createDisabledOpenCodeSubagentMonitor,
    createMessageId,
    createOpenCodeSubagentMonitor,
    createOpenCodeTabStreamState,
    createSubagentProgressController,
    extractSessionId,
    getAttemptFailureMessage,
    getEffectiveThinkingMode,
    getGlobalHumanInteractionEnabled,
    getHiddenRetryDelayMs,
    getPendingSessionDraft,
    hasAssistantFinalConclusionAfterMessage,
    isHiddenRetryEligibleAttempt,
    isLocalSessionId,
    loadSessionMessages,
    logDebug,
    logError,
    logInfo,
    maybeAutoCompactContextAfterPromptSuccess,
    maybePersistLongTermMemoryFromRun,
    normalizeTraceContentForDisplay,
    parallelRunsByTabId,
    parseOpenCodeRunOutput,
    persistMessagesForTab,
    prepareOpenCodeRuntime,
    prepareOpenCodeSubagentRuntime,
    preparePendingLabel,
    requestHumanInteraction,
    cancelHumanInteractionForTab,
    resetHiddenRetryCountOnRecoveredReply,
    resolveCliSessionIdForResume,
    resolveOpenCodeSuccessfulExitOutcome,
    resolveTraceKind,
    resolveTraceMerge,
    resolveWorkspaceCwd,
    runCliStream,
    sendOpenCodeTaskListUpdate,
    sendPanelMessage,
    sendRunStatusForTab,
    shouldAutoCompactContextAfterRunForTarget,
    shouldRecoverOpenCodeLoopMainSessionInFreshSession,
    shouldRequireExplicitFinalAnswerForRun,
    t,
    updateSessionBuffer,
    waitForHiddenRetryDelay,
  } = requiredDeps;

  async function runPromptParallel(
    input: PromptRunInput,
    target: PromptRunTarget,
    executionOptions: PromptRunExecutionOptions = {},
  ): Promise<void> {
    const runCli = target.cli;
    const prompt = input.displayPrompt;
    let sessionId = target.sessionId;
    let messageTarget: ChatMessage[] = [];
    let runId = "";
    let startedAt = 0;
    let userMessageId = "";
    let userCreatedAt = 0;
    let thinkingMode: ThinkingMode = "off";
    let humanInteractionEnabledForVibeRun = false;
    let includeFinalAnswerInstruction = true;
    let pendingHumanInteractionContinuationPrompt: string | null = null;
    let naturalLanguageHumanInteractionCount = 0;
    let silentProgressNoticeShown = false;
    let openCodeTabStreamState!: ReturnType<typeof createOpenCodeTabStreamState>;
    const openCodeTabStreamContext = {
      createMessageId,
      metadata: {
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        graphRunId: input.graphRunId,
        graphNodeId: input.graphNodeId,
      },
    };
    let attemptSubagentMonitor: OpenCodeSubagentMonitor | null = null;
    let subagentProgress: ReturnType<typeof createSubagentProgressController> | null = null;

    const isParallelRunActive = (): boolean => {
      const current = parallelRunsByTabId.get(target.tabId);
      return Boolean(current && current.runId === runId && !current.stopped);
    };

    const resolveParallelMessageTarget = (): ChatMessage[] => {
      const current = parallelRunsByTabId.get(target.tabId);
      if (sessionId) {
        messageTarget = loadSessionMessages(runCli, sessionId);
        if (current && current.runId === runId) {
          current.sessionId = sessionId;
          current.messageTarget = messageTarget;
        }
        return messageTarget;
      }
      if (current && current.runId === runId && current.messageTarget) {
        messageTarget = current.messageTarget;
        return messageTarget;
      }
      return messageTarget;
    };

    const syncParallelRun = (runProcess: RunProcess): void => {
      const currentMessageTarget = resolveParallelMessageTarget();
      parallelRunsByTabId.set(target.tabId, {
        runId,
        tabId: target.tabId,
        cli: runCli,
        sessionId,
        prompt,
        startedAt,
        process: runProcess,
        messageTarget: currentMessageTarget,
        stopped: false,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        graphRunId: input.graphRunId,
        graphNodeId: input.graphNodeId,
      });
    };

    const appendParallelTrace = (
      content: string,
      taskListItems?: OpenCodeTaskListItem[],
    ): void => {
      if (!content.trim()) {
        return;
      }
      const { content: displayContent, shouldPersist } = normalizeTraceContentForDisplay(content, runCli);
      if (!displayContent.trim()) {
        return;
      }
      const resolvedKind = resolveTraceKind(displayContent, "tool-use");
      const shouldMerge = resolveTraceMerge(displayContent, false);
      const mergePayload = shouldMerge ? {} : { merge: false };
      const message: ChatMessage = {
        id: createMessageId(),
        role: "trace",
        content: displayContent,
        createdAt: Date.now(),
        kind: resolvedKind,
        ...mergePayload,
      };
      if (shouldPersist) {
        appendMessageToStore(resolveParallelMessageTarget(), message);
      }
      sendPanelMessage({
        type: "traceSegment",
        id: message.id,
        createdAt: message.createdAt,
        sequence: message.sequence,
        content: message.content,
        kind: resolvedKind,
        tabId: target.tabId,
        ...(Array.isArray(taskListItems) ? { taskListItems } : {}),
        ...mergePayload,
      });
    };

    const applyOpenCodeTabStreamActions = (actions: readonly OpenCodeTabStreamAction[]): void => {
      actions.forEach((action) => {
        if (action.type === "task-list-update") {
          sendOpenCodeTaskListUpdate(action.items, {
            source: "parallel-stream",
            tabId: target.tabId,
          });
          return;
        }
        if (action.type === "append-trace") {
          appendParallelTrace(action.content, action.taskListItems);
          return;
        }
        if (action.type === "append-assistant-message") {
          appendMessageToStore(resolveParallelMessageTarget(), action.message);
          sendPanelMessage({ type: "appendMessage", message: action.message, tabId: target.tabId });
          return;
        }
        const currentMessageTarget = resolveParallelMessageTarget();
        let message = currentMessageTarget.find((item) => item.id === action.id);
        if (!message) {
          message = {
            id: action.id,
            role: "assistant",
            content: "",
            createdAt: Date.now(),
            ...(action.kind === "thinking" ? { kind: "thinking" as const } : {}),
            ...openCodeTabStreamContext.metadata,
          };
          appendMessageToStore(currentMessageTarget, message);
          sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
        }
        if (message.role !== "assistant") {
          return;
        }
        message.content += action.content;
        if (action.kind === "thinking") {
          message.kind = "thinking";
        }
        sendPanelMessage({
          type: "assistantDelta",
          id: action.id,
          content: action.content,
          kind: action.kind,
          tabId: target.tabId,
        });
      });
    };

    const appendParallelSystemMessage = (content: string, status?: "stopped" | "error"): ChatMessage => {
      const message: ChatMessage = {
        id: createMessageId(),
        role: "system",
        content,
        createdAt: Date.now(),
      };
      appendMessageToStore(resolveParallelMessageTarget(), message);
      sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
      if (status) {
        sendRunStatusForTab(target.tabId, status, { message: content });
      }
      return message;
    };

    const buildParallelTaskRunRecord = (status: TaskRunStatus): TaskRunRecord => {
      const endedAt = Date.now();
      return {
        id: runId,
        cli: runCli,
        sessionId,
        prompt,
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        status,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        graphRunId: input.graphRunId,
        graphNodeId: input.graphNodeId,
      };
    };

    const appendHumanInteractionSubmission = (
      targetMessages: ChatMessage[],
      submission: HumanInteractionSubmission,
      request: HumanInteractionRequest,
    ): void => {
      const message: ChatMessage = {
        id: createMessageId(),
        role: "user",
        content: formatHumanInteractionSubmittedText(submission, request.formFields),
        createdAt: Date.now(),
        merge: false,
      };
      appendMessageToStore(targetMessages, message);
      sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
    };

    const removeLatestAssistantMessage = (targetMessages: ChatMessage[]): void => {
      const userMessageIndex = targetMessages.findIndex((message) => message.id === userMessageId);
      for (let index = targetMessages.length - 1; index > userMessageIndex; index -= 1) {
        const message = targetMessages[index];
        if (!message || message.role !== "assistant" || message.kind === "thinking" || message.subagentId) {
          continue;
        }
        targetMessages.splice(index, 1);
        openCodeTabStreamState = createOpenCodeTabStreamState();
        sendPanelMessage({ type: "removeMessage", id: message.id, tabId: target.tabId });
        return;
      }
    };

    const buildHumanInteractionContinuationPrompt = (
      submission: HumanInteractionSubmission,
      request: HumanInteractionRequest,
    ): string => buildThinkingPrompt(runCli, thinkingMode, [
      formatHumanInteractionSubmittedText(submission, request.formFields),
      "",
      "请根据以上补充信息继续完成原始任务。",
    ].join("\n"), {
      includePrefix: false,
      includeSuffix: false,
      includeFinalAnswerInstruction,
      includeHumanInteractionInstruction: humanInteractionEnabledForVibeRun,
    });

    const finishParallelHumanInteractionRejected = (
      targetMessages: ChatMessage[],
      humanRequest: HumanInteractionRequest,
    ): void => {
      const userMessage = t("run.humanInteractionRejected");
      appendParallelSystemMessage(userMessage, "stopped");
      if (typeof cancelHumanInteractionForTab === "function") {
        cancelHumanInteractionForTab(target.tabId, userMessage);
      }
      void logInfo("runPrompt-parallel-human-interaction-rejected", {
        cli: runCli,
        tabId: target.tabId,
        runId,
        sessionId,
        interactionId: humanRequest.interactionId,
      });
      parallelRunsByTabId.delete(target.tabId);
      const taskRecord = buildParallelTaskRunRecord("stopped");
      appendTaskRun(taskRecord);
      const completionMessage: ChatMessage = {
        id: createMessageId(),
        role: "system",
        content: buildTaskRunCompletionText("stopped", taskRecord.durationMs),
        createdAt: Date.now(),
      };
      appendMessageToStore(targetMessages, completionMessage);
      sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
      persistMessagesForTab(runCli, sessionId, target.tabId, targetMessages);
      maybePersistLongTermMemoryFromRun({
        status: "stopped",
        cli: runCli,
        prompt,
        messages: targetMessages,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        skip: input.skipLongTermMemoryPersist,
      });
    };

    const maybeHandleNaturalLanguageHumanInteraction = async (
      targetMessages: ChatMessage[],
    ): Promise<"continue" | "stopped" | false> => {
      if (!humanInteractionEnabledForVibeRun || naturalLanguageHumanInteractionCount > 0) {
        return false;
      }
      if (typeof requestHumanInteraction !== "function") {
        return false;
      }
      const assistantMessage = [...targetMessages].reverse().find((message) => (
        message.role === "assistant"
        && message.kind !== "thinking"
        && !message.subagentId
        && String(message.content ?? "").trim().length > 0
      ));
      if (!assistantMessage) {
        return false;
      }
      const humanRequest = buildNaturalLanguageHumanInteractionRequest({
        tabId: target.tabId,
        fallbackInteractionId: createMessageId(),
        userPrompt: prompt,
        assistantText: String(assistantMessage.content ?? ""),
      });
      if (!humanRequest) {
        return false;
      }
      naturalLanguageHumanInteractionCount += 1;
      removeLatestAssistantMessage(targetMessages);
      appendParallelSystemMessage(t("run.humanInteractionWaiting"));
      const submission = await requestHumanInteraction(humanRequest);
      appendHumanInteractionSubmission(targetMessages, submission, humanRequest);
      if (submission.status === "aborted") {
        finishParallelHumanInteractionRejected(targetMessages, humanRequest);
        return "stopped";
      }
      pendingHumanInteractionContinuationPrompt = buildHumanInteractionContinuationPrompt(submission, humanRequest);
      void logInfo("runPrompt-parallel-natural-human-interaction", {
        cli: runCli,
        tabId: target.tabId,
        runId,
        sessionId,
        interactionId: humanRequest.interactionId,
        fields: humanRequest.formFields.length,
      });
      return "continue";
    };

    await runOpenCodePromptTemplate(input, target, executionOptions, {
      guardRun: (runInput, runTarget) => {
        const displayPrompt = runInput.displayPrompt;
        if (!displayPrompt) {
          return { status: "skip" };
        }
        const cli = runTarget.cli;
        if (cli !== "opencode") {
          throw new Error(`parallel-run-unsupported:${cli}`);
        }
        const modelPrompt = runInput.modelPrompt || displayPrompt;
        const contextTags = Array.isArray(runInput.contextTags)
          ? runInput.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          : [];
        void contextTags;
        return { status: "ready", prompt: displayPrompt, modelPrompt, runCli: cli };
      },
      resolveWorkspaceCwd,
      noteMissingWorkspace: () => {},
      prepareOpenCodeRuntime,
      getEffectiveThinkingMode,
      applyThinkingWorkspaceFiles,
      shouldAutoCompactContextAfterRunForTarget,
      preparePendingLabel,
      readGlobalHumanInteractionEnabled: () => (
        typeof getGlobalHumanInteractionEnabled === "function"
          ? getGlobalHumanInteractionEnabled()
          : false
      ),
      buildThinkingPrompt,
      buildHiddenRetryPrompt,
      beforeLoadMessages: () => {},
      loadSessionMessages,
      getPendingSessionDraft,
      stageRunBeforeUserMessage: (prepared) => {
        messageTarget = prepared.messageTarget;
        thinkingMode = prepared.thinkingMode;
        humanInteractionEnabledForVibeRun = prepared.humanInteractionEnabled;
        includeFinalAnswerInstruction = prepared.includeFinalAnswerInstruction;
      },
      createMessageId,
      bindRunIdentityBeforeUserBubble: (_prepared, identity) => {
        userMessageId = identity.userMessageId;
        userCreatedAt = identity.userCreatedAt;
      },
      buildUserChatMessage,
      appendUserMessage: (targetMessages, userMessage) => {
        appendMessageToStore(targetMessages, userMessage);
        sendPanelMessage({ type: "appendMessage", message: userMessage, tabId: target.tabId });
      },
      finishRunActivation: (prepared) => {
        runId = createMessageId();
        startedAt = Date.now();
        openCodeTabStreamState = createOpenCodeTabStreamState();
        void logInfo("runPrompt-parallel-start", {
          cli: runCli,
          cwd: prepared.cwd,
          tabId: target.tabId,
          sessionId,
          modelRole: prepared.runtimePreparation.role,
          mainModel: prepared.runtimePreparation.mainModel,
          subtaskModel: prepared.runtimePreparation.subtaskModel,
          effectiveModel: prepared.runtimePreparation.effectiveModel,
          modelFallback: prepared.runtimePreparation.modelFallback,
          mainVariant: prepared.runtimePreparation.mainVariant,
          subtaskVariant: prepared.runtimePreparation.subtaskVariant,
          effectiveVariant: prepared.runtimePreparation.effectiveVariant,
        });
        sendRunStatusForTab(target.tabId, "start", {
          prompt,
          startedAt,
          graphRunId: input.graphRunId,
          graphNodeId: input.graphNodeId,
        });
        subagentProgress = createSubagentProgressController({
          labels: buildSubagentProgressLabels(),
          createMessageId,
          messageMetadata: openCodeTabStreamContext.metadata,
          appendMessage: (message: ChatMessage) => {
            openCodeTabStreamState = {
              ...openCodeTabStreamState,
              activeAssistantMessageId: null,
              activeAssistantKind: null,
            };
            appendMessageToStore(resolveParallelMessageTarget(), message);
            sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
          },
          replaceMessage: (message: ChatMessage) => {
            const currentMessageTarget = resolveParallelMessageTarget();
            const index = currentMessageTarget.findIndex((item) => item.id === message.id);
            if (index < 0) {
              appendMessageToStore(currentMessageTarget, message);
              sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
              return;
            }
            currentMessageTarget[index] = message;
            sendPanelMessage({ type: "replaceMessage", message, tabId: target.tabId });
          },
          appendDelta: (messageId: string, content: string) => {
            sendPanelMessage({
              type: "assistantDelta",
              id: messageId,
              content,
              tabId: target.tabId,
            });
          },
        });
      },
      isRunActive: isParallelRunActive,
      resolveMessageTarget: resolveParallelMessageTarget,
      getRunId: () => runId,
      getSessionId: () => sessionId,
      takeContinuationPrompt: () => {
        const continuationPrompt = pendingHumanInteractionContinuationPrompt;
        pendingHumanInteractionContinuationPrompt = null;
        return continuationPrompt;
      },
      getHiddenRetryDelayMs,
      waitForHiddenRetryDelay,
      prepareHiddenRetry: () => {
        openCodeTabStreamState = {
          ...openCodeTabStreamState,
          activeAssistantMessageId: null,
          activeAssistantKind: null,
        };
      },
      publishSystem: (content) => {
        appendParallelSystemMessage(content);
      },
      t,
      buildHiddenRetryStartedMessage,
      logHiddenRetry: (context) => {
        void logInfo("runPrompt-parallel-hidden-retry", {
          cli: runCli,
          tabId: target.tabId,
          runId,
          sessionId,
          attempt: context.attemptNumber,
          retryCount: context.hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryDelayMs: context.retryDelayMs,
          freshSessionRecovery: context.isFreshSessionRecoveryAttempt,
        });
      },
      resolveCliSessionIdForResume,
      beginStreamAttempt: () => {},
      prepareOpenCodeSubagentRuntime,
      shouldAnnounceSubagentMonitorUnavailable: (error, alreadyShown) => Boolean(error) && !alreadyShown,
      prepareSubagentMonitorUnavailableNotice: () => {},
      logSubagentMonitorStart: ({ subagentRuntime, runtimeSessionId }) => {
        void logInfo("runPrompt-parallel-subagent-monitor-start", {
          cli: runCli,
          runId,
          tabId: target.tabId,
          sessionId: runtimeSessionId,
          endpointSource: subagentRuntime.endpointSource,
          serverPort: subagentRuntime.connection?.serverPort ?? null,
          pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
        });
      },
      createStartupWatchdog: () => ({
        arm: () => {},
        dispose: () => {},
      }),
      createSubagentMonitor: ({ subagentRuntime, attemptNumber, directory }) => {
        const subagentMonitor = subagentRuntime.connection
          ? createOpenCodeSubagentMonitor({
            connection: subagentRuntime.connection,
            directory,
            onUpdate: (update: SubagentProgressUpdate) => {
              const current = parallelRunsByTabId.get(target.tabId);
              if (!current || current.runId !== runId) {
                return;
              }
              subagentProgress?.update(update);
            },
            onNoChildren: () => {
              if (silentProgressNoticeShown || !isParallelRunActive()) {
                return;
              }
              silentProgressNoticeShown = true;
              openCodeTabStreamState = {
                ...openCodeTabStreamState,
                activeAssistantMessageId: null,
                activeAssistantKind: null,
              };
              const message: ChatMessage = {
                id: createMessageId(),
                role: "system",
                content: t("run.openCodeSubagentPollEmpty"),
                createdAt: Date.now(),
              };
              appendMessageToStore(resolveParallelMessageTarget(), message);
              sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
              void logInfo("runPrompt-parallel-subagent-poll-empty", {
                cli: runCli,
                runId,
                tabId: target.tabId,
                sessionId,
                attempt: attemptNumber,
                pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
              });
            },
            onError: (error: Error) => {
              void logDebug("runPrompt-parallel-subagent-monitor-error", {
                cli: runCli,
                runId,
                tabId: target.tabId,
                sessionId,
                attempt: attemptNumber,
                error: error.message,
              });
            },
          })
          : createDisabledOpenCodeSubagentMonitor();
        attemptSubagentMonitor = subagentMonitor;
        return subagentMonitor;
      },
      runCliStream,
      buildProcessLabel,
      appendBoundedUtf8Text,
      maxRawOutputBytes: AI_TASK_RAW_OUTPUT_MAX_BYTES,
      maxHiddenRetries: HIDDEN_RETRY_MAX_RETRIES,
      onStdoutChunk: (chunk, stream) => {
        stream.sessionBuffer = updateSessionBuffer(stream.sessionBuffer, chunk);
        attemptSubagentMonitor?.setParentSessionId(extractSessionId(runCli, stream.sessionBuffer));
        sendPanelMessage({ type: "rawStreamDelta", content: chunk, stream: "stdout", tabId: target.tabId });
        const streamResult = consumeOpenCodeTabStreamChunk(
          openCodeTabStreamState,
          chunk,
          false,
          openCodeTabStreamContext,
        );
        openCodeTabStreamState = streamResult.state;
        applyOpenCodeTabStreamActions(streamResult.actions);
        if (streamResult.actions.some((action: OpenCodeTabStreamAction) => (
          action.type === "append-assistant-delta" && action.kind !== "thinking"
        ))) {
          stream.attemptHadNormalReply = true;
        }
      },
      onStderrChunk: (chunk, stream) => {
        stream.sessionBuffer = updateSessionBuffer(stream.sessionBuffer, chunk);
        sendPanelMessage({ type: "rawStreamDelta", content: chunk, stream: "stderr", tabId: target.tabId });
      },
      onAttemptProcessStarted: (runProcess, runtimeSessionId) => {
        syncParallelRun(runProcess);
        attemptSubagentMonitor?.setParentSessionId(runtimeSessionId);
      },
      finishStreamAttempt: () => {
        if (isParallelRunActive()) {
          const streamResult = consumeOpenCodeTabStreamChunk(
            openCodeTabStreamState,
            "",
            true,
            openCodeTabStreamContext,
          );
          openCodeTabStreamState = streamResult.state;
          applyOpenCodeTabStreamActions(streamResult.actions);
        }
        return isParallelRunActive();
      },
      adoptSession: (adoption) => {
        const detectedSessionId = extractSessionId(runCli, adoption.sessionBuffer)
          ?? extractSessionId(runCli, `${adoption.rawStdout}\n${adoption.rawStderr}`);
        if (
          adoption.isFreshSessionRecoveryAttempt
          && adoption.isLoopMainRun
          && detectedSessionId
          && detectedSessionId !== sessionId
          && input.loopTaskId
        ) {
          const previousSessionId = sessionId;
          messageTarget = adoptFreshOpenCodeLoopRecoverySession({
            sessionId: detectedSessionId,
            previousSessionId,
            tabId: target.tabId,
            messageTarget,
            loopTaskId: input.loopTaskId,
          });
          sessionId = detectedSessionId;
          const current = parallelRunsByTabId.get(target.tabId);
          if (current && current.runId === runId) {
            current.sessionId = sessionId;
            current.messageTarget = messageTarget;
          }
        } else if ((!sessionId || isLocalSessionId(sessionId)) && detectedSessionId) {
          adoptDetectedSessionId(runCli, detectedSessionId, target.tabId, sessionId);
          sessionId = detectedSessionId;
          messageTarget = loadSessionMessages(runCli, detectedSessionId);
        }
      },
      beginSuccessfulExit: () => {},
      parseOpenCodeRunOutput,
      appendParsedOutput: (openCodeOutput) => {
        const currentMessageTarget = resolveParallelMessageTarget();
        if (openCodeOutput.finalText) {
          const finalTextResult = appendOpenCodeFinalTextToTabStream(
            openCodeTabStreamState,
            openCodeOutput.finalText,
            openCodeTabStreamContext,
          );
          openCodeTabStreamState = finalTextResult.state;
          applyOpenCodeTabStreamActions(finalTextResult.actions);
        }
        return currentMessageTarget;
      },
      maybeHandleNaturalLanguageHumanInteraction: (targetMessages) => (
        maybeHandleNaturalLanguageHumanInteraction(targetMessages)
      ),
      hasAssistantFinalConclusionAfterMessage,
      shouldRequireExplicitFinalAnswerForRun,
      resolveOpenCodeSuccessfulExitOutcome,
      buildOpenCodeMissingFinalConclusionMessage,
      shouldRecoverOpenCodeLoopMainSessionInFreshSession,
      logMissingFinalConclusionRetry: (payload) => {
        void logInfo("runPrompt-parallel-missing-final-conclusion-retry", payload);
      },
      publishMissingConclusionRetry: (currentMessageTarget, retry) => {
        if (retry.shouldRecoverFreshSession) {
          const recoveryMessage: ChatMessage = {
            id: createMessageId(),
            role: "system",
            content: t("run.openCodeLoopFreshSessionRecoveryQueued"),
            createdAt: Date.now(),
          };
          appendMessageToStore(currentMessageTarget, recoveryMessage);
          sendPanelMessage({ type: "appendMessage", message: recoveryMessage, tabId: target.tabId });
        } else {
          appendHiddenRetryErrorTraceMessage(currentMessageTarget, retry.missingConclusionMessage, {
            tabId: target.tabId,
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            loopSubtaskId: input.loopSubtaskId,
          }, { createMessageId, sendPanelMessage });
        }
        const retryMessage = buildHiddenRetryQueuedMessage(retry.hiddenRetryCount);
        const systemMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: retryMessage,
          createdAt: Date.now(),
        };
        appendMessageToStore(currentMessageTarget, systemMessage);
        sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
      },
      logMissingFinalConclusionFailure: (payload) => {
        void logError("runPrompt-parallel-missing-final-conclusion", payload);
      },
      finalizeMissingFinalConclusion: async ({ missingConclusionMessage, finalMessageTarget, hiddenRetryCount }) => {
        parallelRunsByTabId.delete(target.tabId);
        const taskRecord = buildParallelTaskRunRecord("error");
        appendTaskRun(taskRecord);
        const userMessageText = buildHiddenRetryFailureMessage({
          hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryLimitMessage: buildHiddenRetryLimitMessage(),
          fallbackMessage: missingConclusionMessage,
          lastFailureMessage: missingConclusionMessage,
          lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
        });
        const systemMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: userMessageText,
          createdAt: Date.now(),
        };
        appendMessageToStore(finalMessageTarget, systemMessage);
        sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
        sendRunStatusForTab(target.tabId, "error", { message: userMessageText });
        const completionMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: buildTaskRunCompletionText("error", taskRecord.durationMs),
          createdAt: Date.now(),
        };
        appendMessageToStore(finalMessageTarget, completionMessage);
        sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
        persistMessagesForTab(runCli, sessionId, target.tabId, finalMessageTarget);
        if (input.throwOnError) {
          throw new Error(userMessageText);
        }
      },
      finalizeSuccessfulExit: async ({ finalMessageTarget }) => {
        parallelRunsByTabId.delete(target.tabId);
        const taskRecord = buildParallelTaskRunRecord("end");
        appendTaskRun(taskRecord);
        sendRunStatusForTab(target.tabId, "end");
        const completionMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: buildTaskRunCompletionText("end", taskRecord.durationMs),
          createdAt: Date.now(),
        };
        appendMessageToStore(finalMessageTarget, completionMessage);
        sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
        persistMessagesForTab(runCli, sessionId, target.tabId, finalMessageTarget);
        maybePersistLongTermMemoryFromRun({
          status: "end",
          cli: runCli,
          prompt,
          messages: finalMessageTarget,
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
          skip: input.skipLongTermMemoryPersist,
        });
        return {
          sessionId,
          durationMs: taskRecord.durationMs,
        };
      },
      maybeAutoCompactContextAfterPromptSuccess,
      evaluateFailedAttempt: (context) => {
        const lastFailureMessage = getAttemptFailureMessage(context.attemptResult, context.rawStderr || null);
        const nextHiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(
          context.hiddenRetryCount,
          context.attemptHadNormalReply,
        );
        return {
          hiddenRetryCount: nextHiddenRetryCount,
          shouldRetry: nextHiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
            && isHiddenRetryEligibleAttempt(context.attemptResult, lastFailureMessage),
        };
      },
      recordFailedAttemptRetry: (context) => {
        const lastFailureMessage = getAttemptFailureMessage(context.attemptResult, context.rawStderr || null);
        const failureMessageTarget = resolveParallelMessageTarget();
        appendHiddenRetryErrorTraceMessage(failureMessageTarget, lastFailureMessage, {
          tabId: target.tabId,
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
        }, { createMessageId, sendPanelMessage });
        const retryMessage = buildHiddenRetryQueuedMessage(context.hiddenRetryCount);
        const systemMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: retryMessage,
          createdAt: Date.now(),
        };
        appendMessageToStore(failureMessageTarget, systemMessage);
        sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
      },
      finalizeFailedAttempt: async (context) => {
        const lastFailureMessage = getAttemptFailureMessage(context.attemptResult, context.rawStderr || null);
        const failureMessageTarget = resolveParallelMessageTarget();
        parallelRunsByTabId.delete(target.tabId);
        const openCodeOutput = parseOpenCodeRunOutput(context.rawStdout, context.rawStderr);
        if (openCodeOutput.finalText) {
          const finalTextResult = appendOpenCodeFinalTextToTabStream(
            openCodeTabStreamState,
            openCodeOutput.finalText,
            openCodeTabStreamContext,
          );
          openCodeTabStreamState = finalTextResult.state;
          applyOpenCodeTabStreamActions(finalTextResult.actions);
        }
        const taskRecord = buildParallelTaskRunRecord("error");
        appendTaskRun(taskRecord);
        const finalFailureMessage = buildOpenCodeFailureMessage(openCodeOutput, lastFailureMessage);
        const userMessageText = buildHiddenRetryFailureMessage({
          hiddenRetryCount: context.hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryLimitMessage: buildHiddenRetryLimitMessage(),
          fallbackMessage: finalFailureMessage,
          lastFailureMessage: finalFailureMessage,
          lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
        });
        const systemMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: userMessageText,
          createdAt: Date.now(),
        };
        appendMessageToStore(failureMessageTarget, systemMessage);
        sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
        sendRunStatusForTab(target.tabId, "error", { message: userMessageText });
        const completionMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: buildTaskRunCompletionText("error", taskRecord.durationMs),
          createdAt: Date.now(),
        };
        appendMessageToStore(failureMessageTarget, completionMessage);
        sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
        persistMessagesForTab(runCli, sessionId, target.tabId, failureMessageTarget);
        if (input.throwOnError) {
          throw new Error(userMessageText);
        }
      },
    });
  }

  return { runPromptParallel };
}
