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
import { runOpenCodePromptTemplate } from "./openCodePromptRunTemplate";

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
    const runCli = target.cli;
    const prompt = input.displayPrompt;
    const activeTabId = target.tabId;
    let messageTarget: ChatMessage[] = [];
    let runId = "";
    let userMessageId = "";
    let userCreatedAt = 0;
    let thinkingMode: ThinkingMode = "off";
    let humanInteractionEnabledForVibeRun = false;
    let includeFinalAnswerInstruction = true;
    let pendingHumanInteractionContinuationPrompt: string | null = null;
    let naturalLanguageHumanInteractionCount = 0;
    let silentProgressNoticeShown = false;
    let debugLogging = false;
    let startupCommand = "";
    let startupArgs: string[] = [];
    let runCwd: string | undefined;
    let successfulSessionId: string | null = null;
    let successfulDurationMs: number | null = null;
    let openCodeActivityTracker!: ReturnType<typeof createOpenCodeStreamActivityTracker>;
    let attemptSubagentMonitor: OpenCodeSubagentMonitor | null = null;
    let refreshStartupTimeout = (): void => {};
    let noteStartupOutputActivity = (_active: boolean): void => {};
    let markExternalStartupActivity = (): void => {};
    let subagentProgress: ReturnType<typeof createSubagentProgressController> | null = null;

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

    const buildRetryFailureMessage = (
      attemptResult: { type: "exit"; code: number | null } | { type: "error"; error: Error },
      rawStdout: string,
      rawStderr: string,
    ) => {
      const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
      return {
        openCodeOutput,
        retryFailureMessage: buildOpenCodeFailureMessage(
          openCodeOutput,
          getAttemptFailureMessage(attemptResult, rawStderr || null),
        ),
      };
    };

    await runOpenCodePromptTemplate(input, target, executionOptions, {
      guardRun: (runInput, runTarget) => {
        const displayPrompt = runInput.displayPrompt;
        const cli = runTarget.cli;
        if (cli !== "opencode") {
          throw new Error(`one-shot-run-unsupported:${cli}`);
        }
        const modelPrompt = runInput.modelPrompt || displayPrompt;
        const contextTags = Array.isArray(runInput.contextTags)
          ? runInput.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          : [];
        void contextTags;
        if (!displayPrompt) {
          return { status: "skip" };
        }
        return { status: "ready", prompt: displayPrompt, modelPrompt, runCli: cli };
      },
      resolveWorkspaceCwd,
      noteMissingWorkspace: (cli, cwd) => {
        if (!cwd) {
          void logInfo("runPrompt-no-workspace", { cli });
        }
      },
      prepareOpenCodeRuntime,
      getEffectiveThinkingMode,
      applyThinkingWorkspaceFiles,
      shouldAutoCompactContextAfterRunForTarget,
      preparePendingLabel,
      readGlobalHumanInteractionEnabled: () => getGlobalHumanInteractionEnabled(),
      buildThinkingPrompt,
      buildHiddenRetryPrompt,
      beforeLoadMessages: () => {
        debugLogging = getDebugLogging();
      },
      loadSessionMessages,
      getPendingSessionDraft,
      stageRunBeforeUserMessage: (prepared) => {
        messageTarget = prepared.messageTarget;
        thinkingMode = prepared.thinkingMode;
        humanInteractionEnabledForVibeRun = prepared.humanInteractionEnabled;
        includeFinalAnswerInstruction = prepared.includeFinalAnswerInstruction;
        runCwd = prepared.cwd;
        const initialRuntimeSessionId = resolveCliSessionIdForResume(runCli, target.sessionId);
        startupArgs = buildCliArgs(
          runCli,
          {
            sessionId: initialRuntimeSessionId,
            thinkingMode: prepared.thinkingMode,
            openCodeVariant: prepared.runtimePreparation.effectiveVariant,
            openCodeSmallVariant: prepared.runtimePreparation.subtaskVariant,
            model: prepared.runtimeModel,
            openCodeConfigContent: prepared.runtimePreparation.configContent,
            envOverrides: prepared.runtimePreparation.envOverrides,
            isolateProjectInstructions: prepared.executionOptions.isolateProjectInstructions,
          },
          prepared.thinkingPrompt,
        );
        startupCommand = getCliCommand(runCli);
        logCliStartup({
          cli: runCli,
          cwd: prepared.cwd,
          command: startupCommand,
          args: redactPromptArg(startupArgs, prepared.thinkingPrompt),
          env: sanitizeEnv({
            ...process.env,
            ...(prepared.runtimePreparation.envOverrides ?? {}),
            ...(prepared.cwd ? { PWD: prepared.cwd } : {}),
          }),
          mode: "one-shot",
        });
        void logInfo("runPrompt-start", {
          cli: runCli,
          command: getCliCommand(runCli),
          args: startupArgs,
          cwd: prepared.cwd,
          sessionId: target.sessionId,
          thinkingMode: prepared.thinkingMode,
          modelRole: prepared.runtimePreparation.role,
          mainModel: prepared.runtimePreparation.mainModel,
          subtaskModel: prepared.runtimePreparation.subtaskModel,
          effectiveModel: prepared.runtimePreparation.effectiveModel,
          modelFallback: prepared.runtimePreparation.modelFallback,
          mainVariant: prepared.runtimePreparation.mainVariant,
          subtaskVariant: prepared.runtimePreparation.subtaskVariant,
          effectiveVariant: prepared.runtimePreparation.effectiveVariant,
        });
      },
      createMessageId,
      bindRunIdentityBeforeUserBubble: (prepared, identity) => {
        userMessageId = identity.userMessageId;
        userCreatedAt = identity.userCreatedAt;
        runId = createMessageId();
        setActiveRunId(runId);
        applyProcessTitle(runId, runCli, target.sessionId);
        startTaskRun(runId, runCli, target.sessionId, prepared.prompt, {
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
          graphRunId: input.graphRunId,
          graphNodeId: input.graphNodeId,
        });
        setActiveMessageTarget(prepared.messageTarget);
        setActiveSessionId(target.sessionId);
        setActiveCliForRun(runCli);
        setActiveTabIdForRun(activeTabId);
      },
      buildUserChatMessage,
      appendUserMessage: (targetMessages, userMessage) => {
        appendMessageToStore(targetMessages, userMessage);
        sendPanelMessage({
          type: "appendMessage",
          message: userMessage,
        });
      },
      finishRunActivation: () => {
        resetActiveAssistantMessage();
        startTraceMessage(runCli);
        resetTraceState();
        sendRunStatus("start");
        subagentProgress = createSubagentProgressController({
          labels: buildSubagentProgressLabels(),
          createMessageId,
          messageMetadata: {
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            loopSubtaskId: input.loopSubtaskId,
          },
          appendMessage: (message) => {
            if (!activeMessageTarget || getActiveRunId() !== runId) {
              return;
            }
            resetActiveAssistantMessage();
            appendMessageToStore(activeMessageTarget, message);
            sendPanelMessage({ type: "appendMessage", message, tabId: activeTabId });
          },
          replaceMessage: (message) => {
            if (!activeMessageTarget || getActiveRunId() !== runId) {
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
            if (getActiveRunId() !== runId) {
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
      },
      isRunActive: () => getActiveRunId() === runId,
      resolveMessageTarget: () => activeMessageTarget ?? messageTarget,
      getRunId: () => runId,
      getSessionId: () => activeSessionId,
      takeContinuationPrompt: () => {
        const continuationPrompt = pendingHumanInteractionContinuationPrompt;
        pendingHumanInteractionContinuationPrompt = null;
        return continuationPrompt;
      },
      getHiddenRetryDelayMs,
      waitForHiddenRetryDelay,
      prepareHiddenRetry: () => {},
      publishSystem: (content) => {
        appendSystemMessage(content);
      },
      t,
      buildHiddenRetryStartedMessage,
      logHiddenRetry: (context) => {
        void logInfo("runPrompt-one-shot-hidden-retry", {
          cli: runCli,
          runId,
          tabId: activeTabId,
          sessionId: activeSessionId,
          attempt: context.attemptNumber,
          retryCount: context.hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryDelayMs: context.retryDelayMs,
          freshSessionRecovery: context.isFreshSessionRecoveryAttempt,
        });
      },
      resolveCliSessionIdForResume,
      beginStreamAttempt: () => {
        openCodeActivityTracker = createOpenCodeStreamActivityTracker();
      },
      prepareOpenCodeSubagentRuntime,
      shouldAnnounceSubagentMonitorUnavailable: (error, alreadyShown) => (
        Boolean(error) && !alreadyShown && getActiveRunId() === runId
      ),
      prepareSubagentMonitorUnavailableNotice: () => {
        resetActiveAssistantMessage();
      },
      logSubagentMonitorStart: ({ subagentRuntime, runtimeSessionId }) => {
        void logInfo("runPrompt-one-shot-subagent-monitor-start", {
          cli: runCli,
          runId,
          tabId: activeTabId,
          sessionId: runtimeSessionId,
          endpointSource: subagentRuntime.endpointSource,
          serverPort: subagentRuntime.connection?.serverPort ?? null,
          pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
        });
      },
      createStartupWatchdog: (context) => {
        let startupTimeoutHandle: NodeJS.Timeout | null = null;
        let sawOpenCodeActivity = false;
        const clearStartupTimeout = (): void => {
          if (startupTimeoutHandle) {
            clearTimeout(startupTimeoutHandle);
            startupTimeoutHandle = null;
          }
        };
        refreshStartupTimeout = () => {
          clearStartupTimeout();
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
            if (getActiveRunId() !== runId) {
              context.settle({ type: "error", error });
              return;
            }
            void logError("runPrompt-one-shot-idle-timeout", {
              cli: runCli,
              runId,
              tabId: activeTabId,
              sessionId: activeSessionId,
              attempt: context.attemptNumber,
              retryCount: context.hiddenRetryCount,
              timeoutMs,
              stdoutLength: context.getOutputLengths().stdout,
              stderrLength: context.getOutputLengths().stderr,
            });
            killActiveProcess();
            context.settle({ type: "error", error });
          }, timeoutMs);
        };
        noteStartupOutputActivity = (active) => {
          if (active) {
            sawOpenCodeActivity = true;
          }
          refreshStartupTimeout();
        };
        markExternalStartupActivity = () => {
          sawOpenCodeActivity = true;
          refreshStartupTimeout();
        };
        return {
          arm: () => {
            refreshStartupTimeout();
          },
          dispose: () => {
            clearStartupTimeout();
          },
        };
      },
      createSubagentMonitor: ({ subagentRuntime, attemptNumber, directory }) => {
        const subagentMonitor = subagentRuntime.connection
          ? createOpenCodeSubagentMonitor({
            connection: subagentRuntime.connection,
            directory,
            onUpdate: (update) => {
              if (getActiveRunId() !== runId) {
                return;
              }
              markExternalStartupActivity();
              subagentProgress?.update(update);
            },
            onNoChildren: () => {
              if (silentProgressNoticeShown || getActiveRunId() !== runId) {
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
        attemptSubagentMonitor = subagentMonitor;
        return subagentMonitor;
      },
      runCliStream,
      buildProcessLabel,
      appendBoundedUtf8Text,
      maxRawOutputBytes: AI_TASK_RAW_OUTPUT_MAX_BYTES,
      maxHiddenRetries: HIDDEN_RETRY_MAX_RETRIES,
      onStdoutChunk: (chunk, stream) => {
        const activity = openCodeActivityTracker.updateStdout(chunk);
        if (activity.hasAssistantAnswer) {
          stream.attemptHadNormalReply = true;
        }
        noteStartupOutputActivity(
          activity.hasAssistantAnswer || activity.hasError || activity.hasStatus || activity.hasProgress,
        );
        sendRawStreamDelta(chunk, { stream: "stdout" });
        appendOpenCodeJsonlEvents(chunk);
        stream.sessionBuffer = updateSessionBuffer(stream.sessionBuffer, chunk);
        syncDetectedSessionTargetFromBuffer(stream.sessionBuffer, "stdout");
        attemptSubagentMonitor?.setParentSessionId(extractSessionId(runCli, stream.sessionBuffer));
        if (debugLogging) {
          void logCliStream(runCli, activeSessionId, "stdout", chunk);
        }
      },
      onStderrChunk: (chunk, stream) => {
        const activity = openCodeActivityTracker.updateStderr(chunk);
        noteStartupOutputActivity(
          activity.hasAssistantAnswer || activity.hasError || activity.hasStatus || activity.hasProgress,
        );
        sendRawStreamDelta(chunk, { stream: "stderr" });
        stream.sessionBuffer = updateSessionBuffer(stream.sessionBuffer, chunk);
        syncDetectedSessionTargetFromBuffer(stream.sessionBuffer, "stderr");
        attemptSubagentMonitor?.setParentSessionId(extractSessionId(runCli, stream.sessionBuffer));
        appendTraceLines(chunk);
        if (debugLogging) {
          void logCliStream(runCli, activeSessionId, "stderr", chunk);
        }
      },
      onAttemptProcessStarted: (runProcess, runtimeSessionId) => {
        setActiveProcess(runProcess);
        attemptSubagentMonitor?.setParentSessionId(runtimeSessionId);
      },
      finishStreamAttempt: (context) => {
        if (getActiveRunId() !== runId) {
          return false;
        }
        const finalActivity = openCodeActivityTracker.flush();
        if (finalActivity.hasAssistantAnswer) {
          context.stream.attemptHadNormalReply = true;
        }
        if (debugLogging) {
          void logCliRaw(runCli, activeSessionId, {
            command: startupCommand,
            args: startupArgs,
            cwd: runCwd,
            exitCode: context.attemptResult.type === "exit" ? context.attemptResult.code : null,
            error: context.attemptResult.type === "error" ? context.attemptResult.error.message : undefined,
            stdin: context.attemptPrompt,
            stdout: context.stream.rawStdout,
            raw: context.stream.rawStdout,
            stderr: context.stream.rawStderr,
          });
        }
        return true;
      },
      adoptSession: (adoption) => {
        if (!(adoption.attemptResult.type === "exit" && adoption.attemptResult.code === 0)) {
          return;
        }
        const detectedSessionId = extractSessionId(runCli, `${adoption.rawStdout}\n${adoption.rawStderr}`);
        if (
          adoption.isFreshSessionRecoveryAttempt
          && adoption.isLoopMainRun
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
      },
      beginSuccessfulExit: (context) => {
        successfulSessionId = activeSessionId;
        const activeTaskRun = getActiveTaskRun();
        successfulDurationMs = activeTaskRun?.id === runId
          ? Math.max(0, Date.now() - activeTaskRun.startedAt)
          : null;
        void logInfo("runPrompt-exit", {
          cli: runCli,
          code: context.attemptResult.type === "exit" ? context.attemptResult.code : null,
        });
        flushOpenCodeJsonlBuffer();
        flushTraceBuffer();
      },
      parseOpenCodeRunOutput,
      appendParsedOutput: (openCodeOutput) => {
        let finalMessageTarget = activeMessageTarget ?? messageTarget;
        if (openCodeOutput.finalText) {
          appendOpenCodeFinalText(openCodeOutput.finalText);
          finalMessageTarget = activeMessageTarget ?? finalMessageTarget;
        }
        return finalMessageTarget;
      },
      maybeHandleNaturalLanguageHumanInteraction,
      hasAssistantFinalConclusionAfterMessage,
      shouldRequireExplicitFinalAnswerForRun,
      resolveOpenCodeSuccessfulExitOutcome,
      buildOpenCodeMissingFinalConclusionMessage,
      shouldRecoverOpenCodeLoopMainSessionInFreshSession,
      logMissingFinalConclusionRetry: (payload) => {
        void logInfo("runPrompt-one-shot-missing-final-conclusion-retry", payload);
      },
      publishMissingConclusionRetry: (finalMessageTarget, retry) => {
        if (retry.shouldRecoverFreshSession) {
          appendSystemMessage(t("run.openCodeLoopFreshSessionRecoveryQueued"));
        } else {
          appendHiddenRetryErrorTraceMessage(finalMessageTarget, retry.missingConclusionMessage, {
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            loopSubtaskId: input.loopSubtaskId,
          }, { createMessageId, sendPanelMessage });
        }
        appendSystemMessage(buildHiddenRetryQueuedMessage(retry.hiddenRetryCount));
      },
      logMissingFinalConclusionFailure: (payload) => {
        void logError("runPrompt-one-shot-missing-final-conclusion", payload);
      },
      finalizeMissingFinalConclusion: async ({ missingConclusionMessage, hiddenRetryCount }) => {
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
        if (input.throwOnError) {
          throw new Error(userMessageText);
        }
      },
      finalizeSuccessfulExit: async () => {
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
        const completion = {
          sessionId: successfulSessionId,
          durationMs: successfulDurationMs,
        };
        clearActiveRun();
        return completion;
      },
      maybeAutoCompactContextAfterPromptSuccess,
      evaluateFailedAttempt: (context) => {
        const nextHiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(
          context.hiddenRetryCount,
          context.attemptHadNormalReply,
        );
        const failure = buildRetryFailureMessage(context.attemptResult, context.rawStdout, context.rawStderr);
        return {
          hiddenRetryCount: nextHiddenRetryCount,
          shouldRetry: nextHiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
            && isHiddenRetryEligibleAttempt(context.attemptResult, failure.retryFailureMessage),
        };
      },
      recordFailedAttemptRetry: (context) => {
        const failure = buildRetryFailureMessage(context.attemptResult, context.rawStdout, context.rawStderr);
        appendHiddenRetryErrorTraceMessage(activeMessageTarget, failure.retryFailureMessage, {
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
        }, { createMessageId, sendPanelMessage });
        appendSystemMessage(buildHiddenRetryQueuedMessage(context.hiddenRetryCount));
      },
      finalizeFailedAttempt: async (context) => {
        const failure = buildRetryFailureMessage(context.attemptResult, context.rawStdout, context.rawStderr);
        const { openCodeOutput, retryFailureMessage } = failure;
        let userMessageForThrow = retryFailureMessage;
        if (context.attemptResult.type === "error") {
          const error = context.attemptResult.error;
          const errnoError = error as NodeJS.ErrnoException;
          const isNotFound = errnoError?.code === "ENOENT";
          const rawUserMessage = isNotFound
            ? buildCliCommandNotFoundMessage(runCli, startupCommand, process.platform, t)
            : error.message;
          const userMessage = buildHiddenRetryFailureMessage({
            hiddenRetryCount: context.hiddenRetryCount,
            maxRetries: HIDDEN_RETRY_MAX_RETRIES,
            retryLimitMessage: buildHiddenRetryLimitMessage(),
            fallbackMessage: rawUserMessage,
            lastFailureMessage: rawUserMessage,
            lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
          });
          userMessageForThrow = userMessage;
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
          void logInfo("runPrompt-exit", { cli: runCli, code: context.attemptResult.code });
          const lastFailureMessage = context.rawStderr.trim()
            ? context.rawStderr.trim()
            : t("run.exitCode", { code: context.attemptResult.code ?? "unknown" });
          const finalFailureMessage = buildOpenCodeFailureMessage(openCodeOutput, lastFailureMessage);
          const userMessage = buildHiddenRetryFailureMessage({
            hiddenRetryCount: context.hiddenRetryCount,
            maxRetries: HIDDEN_RETRY_MAX_RETRIES,
            retryLimitMessage: buildHiddenRetryLimitMessage(),
            fallbackMessage: finalFailureMessage,
            lastFailureMessage: finalFailureMessage,
            lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
          });
          userMessageForThrow = userMessage;
          void logError("runPrompt-opencode-final-failure", {
            cli: runCli,
            code: context.attemptResult.code,
            hiddenRetryCount: context.hiddenRetryCount,
            errorText: openCodeOutput.errorText,
            statusText: openCodeOutput.statusText,
            stdoutLength: context.rawStdout.length,
            stderrLength: context.rawStderr.length,
          });
          sendRunStatus("error", userMessage);
          appendSystemMessage(userMessage);
        }
        flushOpenCodeJsonlBuffer();
        flushTraceBuffer();
        appendCompletionMessage("error");
        persistActiveMessages();
        clearActiveRun();
        if (input.throwOnError) {
          throw new Error(userMessageForThrow);
        }
      },
    });
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
