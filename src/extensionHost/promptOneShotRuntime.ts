import { appendBoundedUtf8Text } from "../boundedText";
import {
  buildCliArgs,
  buildProcessLabel,
  createOpenCodeStreamActivityTracker,
  isOpenCodePlaceholderText,
  parseOpenCodeRunOutput,
  parseOpenCodeVisibleStreamEvents,
  runCliStream,
  type OpenCodeVisibleStreamEvent,
  type RunProcess,
} from "../cli/commandRunner";
import { getCliCommand, getDebugLogging } from "../cli/config";
import type { OpenCodeTaskListItem } from "../cli/openCodeTaskList";
import {
  createOpenCodeSubagentMonitor,
  OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
  type OpenCodeSubagentMonitor,
} from "../cli/openCodeSubagentMonitor";
import { resolveOpenCodeOneShotWatchdogTimeoutMs } from "../cli/opencodewatchdog";
import type { CliName, ThinkingMode } from "../cli/types";
import { hasAssistantFinalConclusionAfterMessage } from "../finalConclusion";
import { buildHiddenRetryFailureMessage, getHiddenRetryDelayMs, resetHiddenRetryCountOnRecoveredReply } from "../hiddenRetry";
import { getLocaleSetting, resolveLocale, type I18nKey } from "../i18n";
import {
  buildNaturalLanguageHumanInteractionRequest,
  formatHumanInteractionSubmittedText,
  type HumanInteractionRequest,
  type HumanInteractionSubmission,
} from "../humanInteraction";
import { logCliRaw, logCliStream, logDebug, logError, logInfo, sanitizeEnv } from "../logger";
import { resolveOpenCodeSuccessfulExitOutcome, shouldRecoverOpenCodeLoopMainSessionInFreshSession } from "../openCodeRunCompletion";
import {
  appendHiddenRetryErrorTraceMessage,
  buildHiddenRetryLimitMessage,
  buildHiddenRetryQueuedMessage,
  buildHiddenRetryStartedMessage,
  getAttemptFailureMessage,
  HIDDEN_RETRY_MAX_RETRIES,
  isHiddenRetryEligibleAttempt,
  waitForHiddenRetryDelay,
} from "../panelDiagnostics";
import { buildHiddenRetryPrompt, buildThinkingPrompt, redactPromptArg } from "../promptRuntime";
import type { LoopTaskRole, RunActivity, TaskRunDraft, TaskRunStatus } from "../promptRunState";
import { extractSessionId } from "../sessionLifecycle";
import { createSubagentProgressController, type SubagentProgressLabels } from "../subagentProgress";
import type { TraceMessageKind } from "../traceDisplay";
import type { ChatMessage } from "../webview/types";
import { buildCliCommandNotFoundMessage } from "../webviewCommandCoordinator";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import type {
  OpenCodeRuntimePreparation,
  OpenCodeRuntimePreparationInput,
  PreparedOpenCodeSubagentRuntime,
  PromptRunExecutionOptions,
} from "./promptExecutionShared";

const OPENCODE_JSONL_PENDING_LINE_MAX_BYTES = 64 * 1024;

type OpenCodeRunOutput = ReturnType<typeof parseOpenCodeRunOutput>;

type PromptOneShotRuntimeHostDeps = {
  AI_TASK_RAW_OUTPUT_MAX_BYTES: number;
  adoptFreshOpenCodeLoopRecoverySession: (options: {
    sessionId: string;
    previousSessionId: string | null;
    tabId: string;
    messageTarget: ChatMessage[];
    loopTaskId: string;
  }) => ChatMessage[];
  appendAssistantChunk: (chunk: string, kind?: ChatMessage["kind"]) => void;
  appendCompletionMessage: (status: TaskRunStatus) => void;
  appendMessageToStore: (target: ChatMessage[], message: ChatMessage) => void;
  appendSystemMessage: (content: string) => void;
  appendTraceLines: (chunk: string) => void;
  appendTraceMessage: (content: string, kind?: TraceMessageKind, options?: {
    merge?: boolean;
    persist?: boolean;
    forceTraceBubble?: boolean;
    taskListItems?: OpenCodeTaskListItem[];
  }) => void;
  applyProcessTitle: (runId: string, cli: CliName, sessionId: string | null) => void;
  applyThinkingWorkspaceFiles: (cli: CliName, thinkingMode: ThinkingMode, cwd?: string) => void;
  buildOpenCodeFailureMessage: (output: OpenCodeRunOutput, fallbackMessage: string) => string;
  buildOpenCodeMissingFinalConclusionMessage: (output: OpenCodeRunOutput) => string;
  buildSubagentProgressLabels: () => SubagentProgressLabels;
  buildUserChatMessage: (input: PromptRunInput, createdAt: number, messageId: string) => ChatMessage;
  captureSessionFromBuffer: (cli: CliName, buffer: string) => void;
  cancelHumanInteractionForTab: (tabId: string, statusText?: string) => void;
  clearActiveRun: () => void;
  createDisabledOpenCodeSubagentMonitor: () => OpenCodeSubagentMonitor;
  createMessageId: () => string;
  flushTraceBuffer: () => void;
  getActiveRunId: () => string | undefined;
  getActiveTaskRun: () => TaskRunDraft | null;
  getEffectiveThinkingMode: (cli: CliName, model?: string | null) => ThinkingMode;
  getGlobalHumanInteractionEnabled: () => boolean;
  getPendingSessionDraft: (tabId: string, cli: CliName) => { messages: ChatMessage[] };
  killActiveProcess: () => void;
  loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[];
  logCliStartup: (payload: {
    cli: CliName;
    cwd?: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    mode: "one-shot" | "interactive";
  }) => void;
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
  persistActiveMessages: () => void;
  prepareOpenCodeRuntime: (input?: string | null | OpenCodeRuntimePreparationInput) => Promise<OpenCodeRuntimePreparation>;
  prepareOpenCodeSubagentRuntime: (options: {
    cwd: string | undefined;
    runId: string;
    runtime: OpenCodeRuntimePreparation;
    isolateProjectInstructions?: boolean;
  }) => Promise<PreparedOpenCodeSubagentRuntime>;
  preparePendingLabel: (cli: CliName, tabId: string, prompt: string) => void;
  requestHumanInteraction: (request: HumanInteractionRequest) => Promise<HumanInteractionSubmission>;
  resetActiveAssistantMessage: () => void;
  resetTraceState: () => void;
  resolveCliSessionIdForResume: (cli: CliName, sessionId: string | null) => string | null;
  resolveWorkspaceCwd: () => string | undefined;
  sendOpenCodeTaskListUpdate: (items: readonly OpenCodeTaskListItem[], options: {
    source: "primary-stream" | "parallel-stream";
    tabId?: string | null;
  }) => void;
  sendPanelMessage: (payload: Record<string, unknown>) => void;
  sendRawStreamDelta: (content: unknown, options?: { stream?: "stdout" | "stderr" | "event"; appendNewline?: boolean }) => void;
  sendRunStatus: (status: "start" | "end" | "error" | "stopped", message?: string, options?: { activity?: RunActivity }) => void;
  setActiveCliForRun: (cli: CliName | null) => void;
  setActiveMessageTarget: (target: ChatMessage[] | null) => void;
  setActiveProcess: (process: RunProcess) => void;
  setActiveRunId: (runId: string | undefined) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setActiveTabIdForRun: (tabId: string | null) => void;
  shouldAutoCompactContextAfterRunForTarget: (target: PromptRunTarget) => boolean;
  shouldRequireExplicitFinalAnswerForRun: (input: PromptRunInput) => boolean;
  showCliCommandNotFoundError: (message: string, cli: CliName) => void;
  startTaskRun: (
    runId: string,
    cli: CliName,
    sessionId: string | null,
    prompt: string,
    options?: {
      taskRole?: LoopTaskRole;
      loopTaskId?: string;
      loopRound?: number;
      loopSubtaskId?: string;
      graphRunId?: string;
      graphNodeId?: string;
    },
  ) => void;
  startTraceMessage: (cli: CliName) => void;
  t: (key: I18nKey, params?: Record<string, string | number | boolean>) => string;
  updateSessionBuffer: (buffer: string, chunk: string) => string;
};

export type PromptOneShotRuntimeHost = {
  runPromptOneShot: (
    input: PromptRunInput,
    target: PromptRunTarget,
    executionOptions?: PromptRunExecutionOptions,
  ) => Promise<void>;
};

function buildOpenCodeOneShotStartupTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return resolveLocale(getLocaleSetting()).startsWith("zh")
    ? `OpenCode run --format json 已启动，但 ${seconds} 秒内没有返回助手回答、错误或状态输出。插件已终止本次尝试并进入错误收口；请检查 OpenCode provider/model/key 配置，或在终端运行 \`opencode run --format json '<你的任务>'\` 验证真实任务。`
    : `OpenCode run --format json started, but returned no assistant answer, error, or status output within ${seconds} seconds. The extension stopped this attempt and finalized it as an error; check the OpenCode provider/model/key config or run \`opencode run --format json '<your task>'\` in a terminal.`;
}

export function createPromptOneShotRuntimeHost(deps: PromptOneShotRuntimeHostDeps): PromptOneShotRuntimeHost {
  const {
    AI_TASK_RAW_OUTPUT_MAX_BYTES,
    adoptFreshOpenCodeLoopRecoverySession,
    appendAssistantChunk,
    appendCompletionMessage,
    appendMessageToStore,
    appendSystemMessage,
    appendTraceLines,
    appendTraceMessage,
    applyProcessTitle,
    applyThinkingWorkspaceFiles,
    buildOpenCodeFailureMessage,
    buildOpenCodeMissingFinalConclusionMessage,
    buildSubagentProgressLabels,
    buildUserChatMessage,
    captureSessionFromBuffer,
    cancelHumanInteractionForTab,
    clearActiveRun: clearPrimaryActiveRun,
    createDisabledOpenCodeSubagentMonitor,
    createMessageId,
    flushTraceBuffer,
    getActiveRunId,
    getActiveTaskRun,
    getEffectiveThinkingMode,
    getGlobalHumanInteractionEnabled,
    getPendingSessionDraft,
    killActiveProcess,
    loadSessionMessages,
    logCliStartup,
    maybeAutoCompactContextAfterPromptSuccess,
    maybePersistLongTermMemoryFromRun,
    persistActiveMessages,
    prepareOpenCodeRuntime,
    prepareOpenCodeSubagentRuntime,
    preparePendingLabel,
    requestHumanInteraction,
    resetActiveAssistantMessage,
    resetTraceState,
    resolveCliSessionIdForResume,
    resolveWorkspaceCwd,
    sendOpenCodeTaskListUpdate,
    sendPanelMessage,
    sendRawStreamDelta,
    sendRunStatus,
    setActiveCliForRun,
    setActiveMessageTarget: setPrimaryActiveMessageTarget,
    setActiveProcess,
    setActiveRunId,
    setActiveSessionId: setPrimaryActiveSessionId,
    setActiveTabIdForRun: setPrimaryActiveTabIdForRun,
    shouldAutoCompactContextAfterRunForTarget,
    shouldRequireExplicitFinalAnswerForRun,
    showCliCommandNotFoundError,
    startTaskRun,
    startTraceMessage,
    t,
    updateSessionBuffer,
  } = deps;

  let activeMessageTarget: ChatMessage[] | null = null;
  let activeSessionId: string | null = null;
  let activeTabIdForRun: string | null = null;
  let activeOpenCodeJsonlBuffer = "";
  let activeOpenCodeDisplayedFinalText: string | null = null;

  const setActiveMessageTarget = (target: ChatMessage[] | null): void => {
    activeMessageTarget = target;
    setPrimaryActiveMessageTarget(target);
  };

  const setActiveSessionId = (sessionId: string | null): void => {
    activeSessionId = sessionId;
    setPrimaryActiveSessionId(sessionId);
  };

  const setActiveTabIdForRun = (tabId: string | null): void => {
    activeTabIdForRun = tabId;
    setPrimaryActiveTabIdForRun(tabId);
  };

  const clearActiveRun = (): void => {
    activeMessageTarget = null;
    activeSessionId = null;
    activeTabIdForRun = null;
    activeOpenCodeJsonlBuffer = "";
    activeOpenCodeDisplayedFinalText = null;
    clearPrimaryActiveRun();
  };

  async function runPromptOneShot(
    input: PromptRunInput,
    target: PromptRunTarget,
    executionOptions: PromptRunExecutionOptions = {},
  ): Promise<void> {
    const prompt = input.displayPrompt;
    const runCli = target.cli;
    if (runCli !== "opencode") {
      throw new Error(`one-shot-run-unsupported:${runCli}`);
    }
    const modelPrompt = input.modelPrompt || prompt;
    const contextTags = Array.isArray(input.contextTags)
      ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [];
    if (!prompt) {
      return;
    }
    const cwd = executionOptions.cwd ?? resolveWorkspaceCwd();
    if (!cwd) {
      void logInfo("runPrompt-no-workspace", { cli: runCli });
    }
    const runtimePreparation = await prepareOpenCodeRuntime({
      role: input.taskRole === "subtask" ? "subtask" : "main",
      model: input.model ?? null,
      requiresSubtaskModel: Boolean(input.loopTaskId || input.graphRunId),
    });
    const runtimeModel = runtimePreparation.effectiveModel;
    const thinkingMode = input.thinkingModeOverride ?? getEffectiveThinkingMode(runCli, runtimeModel);
    applyThinkingWorkspaceFiles(runCli, thinkingMode, cwd);
    const runtimeEnvOverrides = runtimePreparation.envOverrides;
    const runtimeOpenCodeConfigContent = runtimePreparation.configContent;
    const activeTabId = target.tabId;
    const shouldAutoCompactAfterRun = shouldAutoCompactContextAfterRunForTarget(target);
    preparePendingLabel(runCli, activeTabId, prompt);
    const initialSessionId = target.sessionId;
    const initialRuntimeSessionId = resolveCliSessionIdForResume(runCli, initialSessionId);
    const includeFinalAnswerInstruction = !input.loopTaskId;
    const humanInteractionEnabledForVibeRun = !input.loopTaskId
      && !input.graphRunId
      && getGlobalHumanInteractionEnabled();
    const thinkingPrompt = buildThinkingPrompt(runCli, thinkingMode, modelPrompt, {
      includeFinalAnswerInstruction,
      includeHumanInteractionInstruction: humanInteractionEnabledForVibeRun,
    });
    const hiddenRetryPrompt = buildHiddenRetryPrompt(runCli, thinkingMode, {
      includeFinalAnswerInstruction,
    });
    const debugLogging = getDebugLogging();
    const messageTarget = initialSessionId
      ? loadSessionMessages(runCli, initialSessionId)
      : getPendingSessionDraft(activeTabId, runCli).messages;
    const args = buildCliArgs(
      runCli,
      {
        sessionId: initialRuntimeSessionId,
        thinkingMode,
        openCodeVariant: runtimePreparation.effectiveVariant,
        openCodeSmallVariant: runtimePreparation.subtaskVariant,
        model: runtimeModel,
        openCodeConfigContent: runtimeOpenCodeConfigContent,
        envOverrides: runtimeEnvOverrides,
        isolateProjectInstructions: executionOptions.isolateProjectInstructions,
      },
      thinkingPrompt,
    );
    const command = getCliCommand(runCli);
    logCliStartup({
      cli: runCli,
      cwd,
      command,
      args: redactPromptArg(args, thinkingPrompt),
      env: sanitizeEnv({
        ...process.env,
        ...(runtimeEnvOverrides ?? {}),
        ...(cwd ? { PWD: cwd } : {}),
      }),
      mode: "one-shot",
    });
    void logInfo("runPrompt-start", {
      cli: runCli,
      command: getCliCommand(runCli),
      args,
      cwd,
      sessionId: initialSessionId,
      thinkingMode,
      modelRole: runtimePreparation.role,
      mainModel: runtimePreparation.mainModel,
      subtaskModel: runtimePreparation.subtaskModel,
      effectiveModel: runtimePreparation.effectiveModel,
      modelFallback: runtimePreparation.modelFallback,
      mainVariant: runtimePreparation.mainVariant,
      subtaskVariant: runtimePreparation.subtaskVariant,
      effectiveVariant: runtimePreparation.effectiveVariant,
    });

    const userMessageId = input.preloadedUserMessageId ?? createMessageId();
    const userCreatedAt = Date.now();
    const runId = createMessageId();
    setActiveRunId(runId);
    applyProcessTitle(runId, runCli, initialSessionId);
    startTaskRun(runId, runCli, initialSessionId, prompt, {
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
      graphRunId: input.graphRunId,
      graphNodeId: input.graphNodeId,
    });
    setActiveMessageTarget(messageTarget);
    setActiveSessionId(initialSessionId);
    setActiveCliForRun(runCli);
    setActiveTabIdForRun(activeTabId);
    if (!input.preloadedUserMessageId) {
      const userMessage = buildUserChatMessage(input, userCreatedAt, userMessageId);
      appendMessageToStore(messageTarget, userMessage);
      sendPanelMessage({
        type: "appendMessage",
        message: userMessage,
      });
    }

    resetActiveAssistantMessage();
    startTraceMessage(runCli);
    resetTraceState();

    sendRunStatus("start");
    let hiddenRetryCount = 0;
    const isLoopMainRun = Boolean(input.loopTaskId && input.taskRole === "main");
    let freshSessionRecoveryPending = false;
    let freshSessionRecoveryAttempted = false;
    let silentProgressNoticeShown = false;
    let monitorUnavailableNoticeShown = false;

    const isCurrentOneShotRunActive = (): boolean => getActiveRunId() === runId;
    const subagentProgress = createSubagentProgressController({
      labels: buildSubagentProgressLabels(),
      createMessageId,
      messageMetadata: {
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      },
      appendMessage: (message) => {
        if (!activeMessageTarget || !isCurrentOneShotRunActive()) {
          return;
        }
        resetActiveAssistantMessage();
        appendMessageToStore(activeMessageTarget, message);
        sendPanelMessage({ type: "appendMessage", message, tabId: activeTabId });
      },
      replaceMessage: (message) => {
        if (!activeMessageTarget || !isCurrentOneShotRunActive()) {
          return;
        }
        const index = activeMessageTarget.findIndex((item) => item.id === message.id);
        if (index < 0) {
          appendMessageToStore(activeMessageTarget, message);
          sendPanelMessage({ type: "appendMessage", message, tabId: activeTabId });
          return;
        }
        activeMessageTarget[index] = message;
        sendPanelMessage({ type: "replaceMessage", message, tabId: activeTabId });
      },
      appendDelta: (messageId, content) => {
        if (!isCurrentOneShotRunActive()) {
          return;
        }
        sendPanelMessage({
          type: "assistantDelta",
          id: messageId,
          content,
          tabId: activeTabId,
        });
      },
    });

    let naturalLanguageHumanInteractionCount = 0;
    let pendingHumanInteractionContinuationPrompt: string | null = null;

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
      sendPanelMessage({ type: "appendMessage", message, tabId: activeTabId });
    };

    const summarizeMessagesForHumanInteractionLog = (targetMessages: ChatMessage[]): Array<Record<string, unknown>> => (
      targetMessages.slice(-6).map((message, index) => {
        const content = String(message.content ?? "").replace(/\s+/g, " ").trim();
        return {
          offset: targetMessages.length - Math.min(targetMessages.length, 6) + index,
          id: message.id,
          role: message.role,
          kind: message.kind ?? null,
          subagentId: message.subagentId ?? null,
          contentLength: String(message.content ?? "").length,
          contentPreview: content.slice(0, 160),
        };
      })
    );

    const removeLatestAssistantMessage = (targetMessages: ChatMessage[], options: {
      allowThinking?: boolean;
    } = {}): boolean => {
      const userMessageIndex = targetMessages.findIndex((message) => message.id === userMessageId);
      for (let index = targetMessages.length - 1; index > userMessageIndex; index -= 1) {
        const message = targetMessages[index];
        if (
          !message
          || message.role !== "assistant"
          || (!options.allowThinking && message.kind === "thinking")
          || message.subagentId
        ) {
          continue;
        }
        targetMessages.splice(index, 1);
        activeOpenCodeDisplayedFinalText = null;
        resetActiveAssistantMessage();
        sendPanelMessage({ type: "removeMessage", id: message.id, tabId: activeTabId });
        return true;
      }
      return false;
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

    const maybeHandleNaturalLanguageHumanInteraction = async (
      targetMessages: ChatMessage[],
      fallbackAssistantText: string | null = null,
    ): Promise<"continue" | "stopped" | false> => {
      if (!humanInteractionEnabledForVibeRun || naturalLanguageHumanInteractionCount > 0) {
        return false;
      }
      const assistantMessage = [...targetMessages].reverse().find((message) => (
        message.role === "assistant"
        && message.kind !== "thinking"
        && !message.subagentId
        && String(message.content ?? "").trim().length > 0
      ));
      const assistantText = String(assistantMessage?.content ?? fallbackAssistantText ?? "").trim();
      const assistantSource = assistantMessage ? "message" : (assistantText ? "opencode-final-text" : "none");
      if (!assistantText) {
        void logDebug("runPrompt-one-shot-natural-human-interaction-skip", {
          cli: runCli,
          tabId: activeTabId,
          runId,
          sessionId: activeSessionId,
          reason: "no-assistant-message",
          messageCount: targetMessages.length,
          activeMessageCount: activeMessageTarget?.length ?? null,
          fallbackAssistantLength: String(fallbackAssistantText ?? "").length,
          candidates: summarizeMessagesForHumanInteractionLog(targetMessages),
        });
        return false;
      }
      const humanRequest = buildNaturalLanguageHumanInteractionRequest({
        tabId: activeTabId,
        fallbackInteractionId: createMessageId(),
        userPrompt: prompt,
        assistantText,
      });
      if (!humanRequest) {
        void logDebug("runPrompt-one-shot-natural-human-interaction-skip", {
          cli: runCli,
          tabId: activeTabId,
          runId,
          sessionId: activeSessionId,
          reason: "unparseable-assistant-message",
          source: assistantSource,
          assistantLength: assistantText.length,
          candidates: summarizeMessagesForHumanInteractionLog(targetMessages),
        });
        return false;
      }
      naturalLanguageHumanInteractionCount += 1;
      const removedAssistantMessage = removeLatestAssistantMessage(targetMessages, {
        allowThinking: !assistantMessage && assistantSource === "opencode-final-text",
      });
      void logDebug("runPrompt-one-shot-natural-human-interaction-prepared", {
        cli: runCli,
        tabId: activeTabId,
        runId,
        sessionId: activeSessionId,
        interactionId: humanRequest.interactionId,
        source: assistantSource,
        fields: humanRequest.formFields.length,
        removedAssistantMessage,
        messageCount: targetMessages.length,
      });
      appendSystemMessage(t("run.humanInteractionWaiting"));
      const submission = await requestHumanInteraction(humanRequest);
      appendHumanInteractionSubmission(targetMessages, submission, humanRequest);
      if (submission.status === "aborted") {
        const userMessage = t("run.humanInteractionRejected");
        appendSystemMessage(userMessage);
        cancelHumanInteractionForTab(activeTabId, userMessage);
        void logInfo("runPrompt-one-shot-human-interaction-rejected", {
          cli: runCli,
          tabId: activeTabId,
          runId,
          sessionId: activeSessionId,
          interactionId: humanRequest.interactionId,
        });
        sendRunStatus("stopped");
        appendCompletionMessage("stopped");
        persistActiveMessages();
        maybePersistLongTermMemoryFromRun({
          status: "stopped",
          cli: runCli,
          prompt,
          messages: activeMessageTarget ?? targetMessages,
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
          skip: input.skipLongTermMemoryPersist,
        });
        clearActiveRun();
        return "stopped";
      }
      pendingHumanInteractionContinuationPrompt = buildHumanInteractionContinuationPrompt(submission, humanRequest);
      void logInfo("runPrompt-one-shot-natural-human-interaction", {
        cli: runCli,
        tabId: activeTabId,
        runId,
        sessionId: activeSessionId,
        interactionId: humanRequest.interactionId,
        fields: humanRequest.formFields.length,
      });
      return "continue";
    };

    const syncDetectedSessionTargetFromBuffer = (buffer: string, stream: "stdout" | "stderr"): void => {
      const detectedSessionId = extractSessionId(runCli, buffer);
      const previousSessionId = activeSessionId;
      captureSessionFromBuffer(runCli, buffer);
      if (!detectedSessionId || detectedSessionId === previousSessionId) {
        return;
      }
      const syncedMessages = loadSessionMessages(runCli, detectedSessionId);
      setActiveSessionId(detectedSessionId);
      setActiveMessageTarget(syncedMessages);
      void logDebug("runPrompt-one-shot-session-target-synced", {
        cli: runCli,
        tabId: activeTabId,
        runId,
        stream,
        previousSessionId,
        sessionId: detectedSessionId,
        messageCount: syncedMessages.length,
        candidates: summarizeMessagesForHumanInteractionLog(syncedMessages),
      });
    };

    while (true) {
      const isFreshSessionRecoveryAttempt = freshSessionRecoveryPending;
      freshSessionRecoveryPending = false;
      if (isFreshSessionRecoveryAttempt) {
        freshSessionRecoveryAttempted = true;
      }
      const attemptNumber = hiddenRetryCount + 1;
      const attemptPrompt = pendingHumanInteractionContinuationPrompt
        ?? (isFreshSessionRecoveryAttempt || hiddenRetryCount === 0
          ? thinkingPrompt
          : hiddenRetryPrompt);
      pendingHumanInteractionContinuationPrompt = null;
      let attemptHadNormalReply = false;

      if (hiddenRetryCount > 0) {
        const retryNumber = hiddenRetryCount;
        const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
        const shouldContinue = await waitForHiddenRetryDelay(retryNumber, isCurrentOneShotRunActive);
        if (!shouldContinue) {
          return;
        }
        if (isFreshSessionRecoveryAttempt) {
          appendSystemMessage(t("run.openCodeLoopFreshSessionRecoveryStarted"));
        }
        appendSystemMessage(buildHiddenRetryStartedMessage(retryNumber));
        void logInfo("runPrompt-one-shot-hidden-retry", {
          cli: runCli,
          runId,
          tabId: activeTabId,
          sessionId: activeSessionId,
          attempt: attemptNumber,
          retryCount: hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryDelayMs,
          freshSessionRecovery: isFreshSessionRecoveryAttempt,
        });
      }

      let sessionBuffer = "";
      let rawStdout = "";
      let rawStderr = "";
      const openCodeActivityTracker = createOpenCodeStreamActivityTracker();
      const runtimeSessionId = isFreshSessionRecoveryAttempt
        ? null
        : resolveCliSessionIdForResume(runCli, activeSessionId);
      const subagentRuntime = await prepareOpenCodeSubagentRuntime({
        cwd,
        runId,
        runtime: runtimePreparation,
        isolateProjectInstructions: executionOptions.isolateProjectInstructions,
      });
      if (subagentRuntime.error && !monitorUnavailableNoticeShown && isCurrentOneShotRunActive()) {
        monitorUnavailableNoticeShown = true;
        resetActiveAssistantMessage();
        appendSystemMessage(t("run.openCodeSubagentMonitorUnavailable"));
      }
      void logInfo("runPrompt-one-shot-subagent-monitor-start", {
        cli: runCli,
        runId,
        tabId: activeTabId,
        sessionId: runtimeSessionId,
        endpointSource: subagentRuntime.endpointSource,
        serverPort: subagentRuntime.connection?.serverPort ?? null,
        pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
      });
      const attemptResult = await new Promise<
        { type: "exit"; code: number | null }
        | { type: "error"; error: Error }
      >((resolve) => {
        let settled = false;
        let startupTimeoutHandle: NodeJS.Timeout | null = null;
        let sawOpenCodeActivity = false;
        const subagentMonitor = subagentRuntime.connection
          ? createOpenCodeSubagentMonitor({
              connection: subagentRuntime.connection,
              directory: cwd ?? process.cwd(),
              onUpdate: (update) => {
                if (isCurrentOneShotRunActive()) {
                  sawOpenCodeActivity = true;
                  refreshStartupTimeout();
                  subagentProgress.update(update);
                }
              },
              onNoChildren: () => {
                if (silentProgressNoticeShown || !isCurrentOneShotRunActive()) {
                  return;
                }
                silentProgressNoticeShown = true;
                resetActiveAssistantMessage();
                appendSystemMessage(t("run.openCodeSubagentPollEmpty"));
                void logInfo("runPrompt-one-shot-subagent-poll-empty", {
                  cli: runCli,
                  runId,
                  tabId: activeTabId,
                  sessionId: activeSessionId,
                  attempt: attemptNumber,
                  pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
                });
              },
              onError: (error) => {
                void logDebug("runPrompt-one-shot-subagent-monitor-error", {
                  cli: runCli,
                  runId,
                  tabId: activeTabId,
                  sessionId: activeSessionId,
                  attempt: attemptNumber,
                  error: error.message,
                });
              },
            })
          : createDisabledOpenCodeSubagentMonitor();
        const settle = (result: { type: "exit"; code: number | null } | { type: "error"; error: Error }): void => {
          if (settled) {
            return;
          }
          settled = true;
          subagentMonitor.finish(
            result.type === "exit" && result.code === 0 ? "completed" : "failed",
          );
          subagentRuntime.dispose();
          if (startupTimeoutHandle) {
            clearTimeout(startupTimeoutHandle);
            startupTimeoutHandle = null;
          }
          resolve(result);
        };
        const refreshStartupTimeout = (): void => {
          if (startupTimeoutHandle) {
            clearTimeout(startupTimeoutHandle);
            startupTimeoutHandle = null;
          }
          const timeoutMs = resolveOpenCodeOneShotWatchdogTimeoutMs(sawOpenCodeActivity);
          if (timeoutMs === null) {
            return;
          }
          startupTimeoutHandle = setTimeout(() => {
            startupTimeoutHandle = null;
            const activity = openCodeActivityTracker.snapshot();
            const hasCurrentActivity = activity.hasAssistantAnswer
              || activity.hasError
              || activity.hasStatus
              || activity.hasProgress;
            if (hasCurrentActivity) {
              sawOpenCodeActivity = true;
              return;
            }
            const error = new Error(buildOpenCodeOneShotStartupTimeoutMessage(timeoutMs));
            if (!isCurrentOneShotRunActive()) {
              settle({ type: "error", error });
              return;
            }
            void logError("runPrompt-one-shot-idle-timeout", {
              cli: runCli,
              runId,
              tabId: activeTabId,
              sessionId: activeSessionId,
              attempt: attemptNumber,
              retryCount: hiddenRetryCount,
              timeoutMs,
              stdoutLength: rawStdout.length,
              stderrLength: rawStderr.length,
            });
            killActiveProcess();
            settle({ type: "error", error });
          }, timeoutMs);
        };
        refreshStartupTimeout();
        const runProcess = runCliStream(
          runCli,
          attemptPrompt,
          {
            onStdout: (chunk: string) => {
              if (!isCurrentOneShotRunActive()) {
                return;
              }
              rawStdout = appendBoundedUtf8Text(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
              const activity = openCodeActivityTracker.updateStdout(chunk);
              if (activity.hasAssistantAnswer || activity.hasError || activity.hasStatus || activity.hasProgress) {
                sawOpenCodeActivity = true;
              }
              refreshStartupTimeout();
              sendRawStreamDelta(chunk, { stream: "stdout" });
              appendOpenCodeJsonlEvents(chunk);
              sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
              syncDetectedSessionTargetFromBuffer(sessionBuffer, "stdout");
              subagentMonitor.setParentSessionId(extractSessionId(runCli, sessionBuffer));
              if (activity.hasAssistantAnswer) {
                attemptHadNormalReply = true;
              }
              if (debugLogging) {
                void logCliStream(runCli, activeSessionId, "stdout", chunk);
              }
            },
            onStderr: (chunk: string) => {
              if (!isCurrentOneShotRunActive()) {
                return;
              }
              rawStderr = appendBoundedUtf8Text(rawStderr, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
              const activity = openCodeActivityTracker.updateStderr(chunk);
              if (activity.hasAssistantAnswer || activity.hasError || activity.hasStatus || activity.hasProgress) {
                sawOpenCodeActivity = true;
              }
              refreshStartupTimeout();
              sendRawStreamDelta(chunk, { stream: "stderr" });
              sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
              syncDetectedSessionTargetFromBuffer(sessionBuffer, "stderr");
              subagentMonitor.setParentSessionId(extractSessionId(runCli, sessionBuffer));
              appendTraceLines(chunk);
              if (debugLogging) {
                void logCliStream(runCli, activeSessionId, "stderr", chunk);
              }
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
            model: runtimeModel,
            openCodeSmallModel: runtimePreparation.subtaskModel,
            openCodeConfigContent: runtimeOpenCodeConfigContent,
            envOverrides: runtimeEnvOverrides,
            isolateProjectInstructions: executionOptions.isolateProjectInstructions,
            openCodeServerUrl: subagentRuntime.connection?.serverUrl,
            processLabel: buildProcessLabel(runCli, runtimeSessionId ?? runId),
          }
        );
        setActiveProcess(runProcess);
        subagentMonitor.setParentSessionId(runtimeSessionId);
      });

      if (getActiveRunId() !== runId) {
        return;
      }
      const finalActivity = openCodeActivityTracker.flush();
      if (finalActivity.hasAssistantAnswer) {
        attemptHadNormalReply = true;
      }

      if (debugLogging) {
        void logCliRaw(runCli, activeSessionId, {
          command,
          args,
          cwd,
          exitCode: attemptResult.type === "exit" ? attemptResult.code : null,
          error: attemptResult.type === "error" ? attemptResult.error.message : undefined,
          stdin: attemptPrompt,
          stdout: rawStdout,
          raw: rawStdout,
          stderr: rawStderr,
        });
      }

      if (attemptResult.type === "exit" && attemptResult.code === 0) {
        const detectedSessionId = extractSessionId(runCli, `${rawStdout}
  ${rawStderr}`);
        if (
          isFreshSessionRecoveryAttempt
          && isLoopMainRun
          && detectedSessionId
          && detectedSessionId !== activeSessionId
          && input.loopTaskId
        ) {
          const previousSessionId = activeSessionId;
          setActiveMessageTarget(adoptFreshOpenCodeLoopRecoverySession({
            sessionId: detectedSessionId,
            previousSessionId,
            tabId: activeTabId,
            messageTarget: activeMessageTarget ?? messageTarget,
            loopTaskId: input.loopTaskId,
          }));
          setActiveSessionId(detectedSessionId);
        }
        const finalSessionId = activeSessionId;
        const activeTaskRun = getActiveTaskRun();
        const durationMs = activeTaskRun?.id === runId
          ? Math.max(0, Date.now() - activeTaskRun.startedAt)
          : null;
        void logInfo("runPrompt-exit", { cli: runCli, code: attemptResult.code });
        flushOpenCodeJsonlBuffer();
        flushTraceBuffer();
        let finalMessageTarget = activeMessageTarget ?? messageTarget;
        const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
        if (openCodeOutput.finalText) {
          appendOpenCodeFinalText(openCodeOutput.finalText);
          finalMessageTarget = activeMessageTarget ?? finalMessageTarget;
        }
        const humanInteractionResult = await maybeHandleNaturalLanguageHumanInteraction(
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
        const conversationHasFinalConclusion = hasAssistantFinalConclusionAfterMessage(finalMessageTarget, userMessageId, {
          observedFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
          fallbackCreatedAt: userCreatedAt,
          requireExplicitFinalAnswer: shouldRequireExplicitFinalAnswerForRun(input),
        });
        const currentAttemptHasAssistantAnswer = attemptHadNormalReply || Boolean(openCodeOutput.finalText?.trim());
        const successfulExitOutcome = resolveOpenCodeSuccessfulExitOutcome({
          isLoopRun: Boolean(input.loopTaskId),
          currentAttemptHasAssistantAnswer,
          conversationHasFinalConclusion,
          hiddenRetryCount,
          maxHiddenRetries: HIDDEN_RETRY_MAX_RETRIES,
        });
        if (successfulExitOutcome !== "complete") {
          const missingConclusionMessage = buildOpenCodeMissingFinalConclusionMessage(openCodeOutput);
          if (successfulExitOutcome === "retry") {
            const shouldRecoverFreshSession = shouldRecoverOpenCodeLoopMainSessionInFreshSession({
              isLoopMainRun,
              hasResumableSession: Boolean(resolveCliSessionIdForResume(runCli, activeSessionId)),
              hasProviderError: Boolean(openCodeOutput.errorText),
              freshSessionRecoveryAttempted,
            });
            void logInfo("runPrompt-one-shot-missing-final-conclusion-retry", {
              cli: runCli,
              runId,
              tabId: activeTabId,
              sessionId: activeSessionId,
              taskRole: input.taskRole,
              loopTaskId: input.loopTaskId,
              loopRound: input.loopRound,
              attempt: hiddenRetryCount + 1,
              retryCount: hiddenRetryCount,
              maxRetries: HIDDEN_RETRY_MAX_RETRIES,
              conversationHasFinalConclusion,
              currentAttemptHasAssistantAnswer,
              structuredFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
              stdoutLength: rawStdout.length,
              stderrLength: rawStderr.length,
              freshSessionRecoveryQueued: shouldRecoverFreshSession,
            });
            if (shouldRecoverFreshSession) {
              freshSessionRecoveryPending = true;
              appendSystemMessage(t("run.openCodeLoopFreshSessionRecoveryQueued"));
            } else {
              appendHiddenRetryErrorTraceMessage(finalMessageTarget, missingConclusionMessage, {
                taskRole: input.taskRole,
                loopTaskId: input.loopTaskId,
                loopRound: input.loopRound,
                loopSubtaskId: input.loopSubtaskId,
              }, { createMessageId, sendPanelMessage });
            }
            appendSystemMessage(buildHiddenRetryQueuedMessage(hiddenRetryCount));
            hiddenRetryCount += 1;
            continue;
          }
          void logError("runPrompt-one-shot-missing-final-conclusion", {
            cli: runCli,
            runId,
            tabId: activeTabId,
            sessionId: activeSessionId,
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            hiddenRetryCount,
            conversationHasFinalConclusion,
            currentAttemptHasAssistantAnswer,
            structuredFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
            stdoutLength: rawStdout.length,
            stderrLength: rawStderr.length,
          });
          const userMessageText = buildHiddenRetryFailureMessage({
            hiddenRetryCount,
            maxRetries: HIDDEN_RETRY_MAX_RETRIES,
            retryLimitMessage: buildHiddenRetryLimitMessage(),
            fallbackMessage: missingConclusionMessage,
            lastFailureMessage: missingConclusionMessage,
            lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
          });
          sendRunStatus("error", userMessageText);
          appendSystemMessage(userMessageText);
          appendCompletionMessage("error");
          persistActiveMessages();
          clearActiveRun();
          return;
        }
        sendRunStatus("end");
        appendCompletionMessage("end");
        persistActiveMessages();
        maybePersistLongTermMemoryFromRun({
          status: "end",
          cli: runCli,
          prompt,
          messages: activeMessageTarget ?? messageTarget,
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
          skip: input.skipLongTermMemoryPersist,
        });
        clearActiveRun();
        if (shouldAutoCompactAfterRun) {
          await maybeAutoCompactContextAfterPromptSuccess(target, finalSessionId, durationMs);
        }
        return;
      }

      hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
      const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
      const retryFailureMessage = buildOpenCodeFailureMessage(
        openCodeOutput,
        getAttemptFailureMessage(attemptResult, rawStderr || null),
      );
      const shouldRetry = hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
        && isHiddenRetryEligibleAttempt(attemptResult, retryFailureMessage);
      if (shouldRetry) {
        appendHiddenRetryErrorTraceMessage(activeMessageTarget, retryFailureMessage, {
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
        }, { createMessageId, sendPanelMessage });
        appendSystemMessage(buildHiddenRetryQueuedMessage(hiddenRetryCount));
        hiddenRetryCount += 1;
        continue;
      }

      if (attemptResult.type === "error") {
        const error = attemptResult.error;
        const errnoError = error as NodeJS.ErrnoException;
        const isNotFound = errnoError?.code === "ENOENT";
        const rawUserMessage = isNotFound
          ? buildCliCommandNotFoundMessage(runCli, command, process.platform, t)
          : error.message;
        const userMessage = buildHiddenRetryFailureMessage({
          hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryLimitMessage: buildHiddenRetryLimitMessage(),
          fallbackMessage: rawUserMessage,
          lastFailureMessage: rawUserMessage,
          lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
        });
        if (isNotFound) {
          showCliCommandNotFoundError(userMessage, runCli);
        }
        void logError("runPrompt-error", {
          cli: runCli,
          error: isNotFound ? `${error.message} (ENOENT)` : error.message,
        });
        sendRunStatus("error", userMessage);
        appendSystemMessage(userMessage);
      } else {
        void logInfo("runPrompt-exit", { cli: runCli, code: attemptResult.code });
        const lastFailureMessage = rawStderr.trim()
          ? rawStderr.trim()
          : t("run.exitCode", { code: attemptResult.code ?? "unknown" });
        const finalFailureMessage = buildOpenCodeFailureMessage(openCodeOutput, lastFailureMessage);
        const userMessage = buildHiddenRetryFailureMessage({
          hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryLimitMessage: buildHiddenRetryLimitMessage(),
          fallbackMessage: finalFailureMessage,
          lastFailureMessage: finalFailureMessage,
          lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
        });
        void logError("runPrompt-opencode-final-failure", {
          cli: runCli,
          code: attemptResult.code,
          hiddenRetryCount,
          errorText: openCodeOutput.errorText,
          statusText: openCodeOutput.statusText,
          stdoutLength: rawStdout.length,
          stderrLength: rawStderr.length,
        });
        sendRunStatus("error", userMessage);
        appendSystemMessage(userMessage);
      }

      flushOpenCodeJsonlBuffer();
      flushTraceBuffer();
      appendCompletionMessage("error");
      persistActiveMessages();
      clearActiveRun();
      return;
    }
  }

  function appendOpenCodeFinalText(finalText: string): void {
    if (isOpenCodePlaceholderText(finalText)) {
      return;
    }
    const displayedText = activeOpenCodeDisplayedFinalText?.trim() ?? "";
    if (displayedText && finalText === displayedText) {
      activeOpenCodeDisplayedFinalText = finalText;
      return;
    }
    if (displayedText && finalText.startsWith(displayedText)) {
      const remainingText = finalText.slice(displayedText.length).trim();
      if (remainingText) {
        appendAssistantChunk(`${remainingText}\n`);
      }
      activeOpenCodeDisplayedFinalText = finalText;
      return;
    }
    appendAssistantChunk(`${finalText}\n`);
    activeOpenCodeDisplayedFinalText = finalText;
  }

  function appendOpenCodeJsonlEvents(chunk: string): boolean {
    let hasVisibleEvent = false;
    activeOpenCodeJsonlBuffer = consumeOpenCodeJsonlChunk(
      activeOpenCodeJsonlBuffer,
      chunk,
      false,
      (event) => {
        hasVisibleEvent = true;
        appendOpenCodeVisibleEvent(event);
      },
    );
    return hasVisibleEvent;
  }

  function flushOpenCodeJsonlBuffer(): void {
    activeOpenCodeJsonlBuffer = consumeOpenCodeJsonlChunk(
      activeOpenCodeJsonlBuffer,
      "",
      true,
      appendOpenCodeVisibleEvent,
    );
  }

  function consumeOpenCodeJsonlChunk(
    currentBuffer: string,
    chunk: string,
    flush: boolean,
    onEvent: (event: OpenCodeVisibleStreamEvent) => void,
  ): string {
    const combined = currentBuffer + chunk.replace(/\r\n/g, "\n");
    const lines = combined.split("\n");
    const pendingLine = flush ? "" : (lines.pop() ?? "");
    const nextBuffer = appendBoundedUtf8Text("", pendingLine, OPENCODE_JSONL_PENDING_LINE_MAX_BYTES).text;
    lines.forEach((line) => {
      parseOpenCodeVisibleStreamEvents(line).forEach(onEvent);
    });
    return nextBuffer;
  }

  function appendOpenCodeVisibleEvent(event: OpenCodeVisibleStreamEvent): void {
    if (Array.isArray(event.taskListItems)) {
      sendOpenCodeTaskListUpdate(event.taskListItems, { source: "primary-stream" });
    }
    if (event.kind === "assistant") {
      if (isOpenCodePlaceholderText(event.content)) {
        return;
      }
      appendAssistantChunk(event.content);
      activeOpenCodeDisplayedFinalText = `${activeOpenCodeDisplayedFinalText ?? ""}${event.content}`;
      return;
    }
    if (event.kind === "thinking") {
      appendTraceMessage(event.content, "thinking");
      return;
    }
    appendTraceMessage(event.content, "tool-use", {
      merge: false,
      forceTraceBubble: true,
      taskListItems: event.taskListItems,
    });
  }

  return { runPromptOneShot };
}
