import type { RunProcess } from "../cli/commandRunner";
import type { OpenCodeTaskListItem } from "../cli/openCodeTaskList";
import {
  buildNaturalLanguageHumanInteractionRequest,
  formatHumanInteractionSubmittedText,
  type HumanInteractionRequest,
  type HumanInteractionSubmission,
} from "../humanInteraction";
import type { OpenCodeTabStreamAction } from "../openCodeTabStream";
import type { TaskRunRecord } from "../promptRunState";
import type { SubagentProgressUpdate } from "../subagentProgress";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";

export type PromptParallelRuntimeHostDeps = Record<string, any>;

export function createPromptParallelRuntimeHost(deps: PromptParallelRuntimeHostDeps) {
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
  } = deps;

  async function runPromptParallel(
    input: PromptRunInput,
    target: PromptRunTarget,
    executionOptions: { cwd?: string; isolateProjectInstructions?: boolean } = {},
  ): Promise<void> {
    const prompt = input.displayPrompt;
    if (!prompt) {
      return;
    }
    const runCli = target.cli;
    if (runCli !== "opencode") {
      throw new Error(`parallel-run-unsupported:${runCli}`);
    }
    const modelPrompt = input.modelPrompt || prompt;
    const contextTags = Array.isArray(input.contextTags)
      ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [];
    const cwd = executionOptions.cwd ?? resolveWorkspaceCwd();
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
    const shouldAutoCompactAfterRun = shouldAutoCompactContextAfterRunForTarget(target);

    preparePendingLabel(runCli, target.tabId, prompt);
    let sessionId = target.sessionId;
    const includeFinalAnswerInstruction = !input.loopTaskId;
    const humanInteractionEnabledForVibeRun = !input.loopTaskId
      && !input.graphRunId
      && (typeof getGlobalHumanInteractionEnabled === "function"
        ? getGlobalHumanInteractionEnabled()
        : false);
    const thinkingPrompt = buildThinkingPrompt(runCli, thinkingMode, modelPrompt, {
      includeFinalAnswerInstruction,
      includeHumanInteractionInstruction: humanInteractionEnabledForVibeRun,
    });
    const hiddenRetryPrompt = buildHiddenRetryPrompt(runCli, thinkingMode, {
      includeFinalAnswerInstruction,
    });
    let messageTarget = sessionId
      ? loadSessionMessages(runCli, sessionId)
      : getPendingSessionDraft(target.tabId, runCli).messages;
    const userMessageId = input.preloadedUserMessageId ?? createMessageId();
    const userCreatedAt = Date.now();

    if (!input.preloadedUserMessageId) {
      const userMessage = buildUserChatMessage(input, userCreatedAt, userMessageId);
      appendMessageToStore(messageTarget, userMessage);
      sendPanelMessage({ type: "appendMessage", message: userMessage, tabId: target.tabId });
    }

    const runId = createMessageId();
    const startedAt = Date.now();
    let hiddenRetryCount = 0;
    const isLoopMainRun = Boolean(input.loopTaskId && input.taskRole === "main");
    let freshSessionRecoveryPending = false;
    let freshSessionRecoveryAttempted = false;
    let silentProgressNoticeShown = false;
    let monitorUnavailableNoticeShown = false;
    let naturalLanguageHumanInteractionCount = 0;
    let pendingHumanInteractionContinuationPrompt: string | null = null;
    let openCodeTabStreamState = createOpenCodeTabStreamState();
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
    void logInfo("runPrompt-parallel-start", {
      cli: runCli,
      cwd,
      tabId: target.tabId,
      sessionId,
      modelRole: runtimePreparation.role,
      mainModel: runtimePreparation.mainModel,
      subtaskModel: runtimePreparation.subtaskModel,
      effectiveModel: runtimePreparation.effectiveModel,
      modelFallback: runtimePreparation.modelFallback,
      mainVariant: runtimePreparation.mainVariant,
      subtaskVariant: runtimePreparation.subtaskVariant,
      effectiveVariant: runtimePreparation.effectiveVariant,
    });
    sendRunStatusForTab(target.tabId, "start", {
      prompt,
      startedAt,
      graphRunId: input.graphRunId,
      graphNodeId: input.graphNodeId,
    });

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

    const syncParallelRun = (process: RunProcess): void => {
      const currentMessageTarget = resolveParallelMessageTarget();
      parallelRunsByTabId.set(target.tabId, {
        runId,
        tabId: target.tabId,
        cli: runCli,
        sessionId,
        prompt,
        startedAt,
        process,
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

    const subagentProgress = createSubagentProgressController({
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
      const taskRecord: TaskRunRecord = {
        id: runId,
        cli: runCli,
        sessionId,
        prompt,
        startedAt,
        endedAt: Date.now(),
        durationMs: Math.max(0, Date.now() - startedAt),
        status: "stopped",
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        graphRunId: input.graphRunId,
        graphNodeId: input.graphNodeId,
      };
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
      const runtimeSessionId = isFreshSessionRecoveryAttempt
        ? null
        : resolveCliSessionIdForResume(runCli, sessionId);
      let attemptHadNormalReply = false;

      if (hiddenRetryCount > 0) {
        const retryNumber = hiddenRetryCount;
        const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
        const shouldContinue = await waitForHiddenRetryDelay(retryNumber, isParallelRunActive);
        if (!shouldContinue) {
          return;
        }
        openCodeTabStreamState = {
          ...openCodeTabStreamState,
          activeAssistantMessageId: null,
          activeAssistantKind: null,
        };
        if (isFreshSessionRecoveryAttempt) {
          const recoveryMessage: ChatMessage = {
            id: createMessageId(),
            role: "system",
            content: t("run.openCodeLoopFreshSessionRecoveryStarted"),
            createdAt: Date.now(),
          };
          const recoveryMessageTarget = resolveParallelMessageTarget();
          appendMessageToStore(recoveryMessageTarget, recoveryMessage);
          sendPanelMessage({ type: "appendMessage", message: recoveryMessage, tabId: target.tabId });
        }
        const retryStartedMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: buildHiddenRetryStartedMessage(retryNumber),
          createdAt: Date.now(),
        };
        const retryMessageTarget = resolveParallelMessageTarget();
        appendMessageToStore(retryMessageTarget, retryStartedMessage);
        sendPanelMessage({ type: "appendMessage", message: retryStartedMessage, tabId: target.tabId });
        void logInfo("runPrompt-parallel-hidden-retry", {
          cli: runCli,
          tabId: target.tabId,
          runId,
          sessionId,
          attempt: attemptNumber,
          retryCount: hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryDelayMs,
          freshSessionRecovery: isFreshSessionRecoveryAttempt,
        });
      }

      let rawStdout = "";
      let rawStderr = "";
      let sessionBuffer = "";
      const subagentRuntime = await prepareOpenCodeSubagentRuntime({
        cwd,
        runId,
        runtime: runtimePreparation,
        isolateProjectInstructions: executionOptions.isolateProjectInstructions,
      });
      if (subagentRuntime.error && !monitorUnavailableNoticeShown) {
        monitorUnavailableNoticeShown = true;
        const message: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: t("run.openCodeSubagentMonitorUnavailable"),
          createdAt: Date.now(),
        };
        appendMessageToStore(resolveParallelMessageTarget(), message);
        sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
      }
      void logInfo("runPrompt-parallel-subagent-monitor-start", {
        cli: runCli,
        runId,
        tabId: target.tabId,
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
        const subagentMonitor = subagentRuntime.connection
          ? createOpenCodeSubagentMonitor({
              connection: subagentRuntime.connection,
              directory: cwd ?? process.cwd(),
              onUpdate: (update: SubagentProgressUpdate) => {
                const current = parallelRunsByTabId.get(target.tabId);
                if (!current || current.runId !== runId) {
                  return;
                }
                subagentProgress.update(update);
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
        const settle = (result: { type: "exit"; code: number | null } | { type: "error"; error: Error }): void => {
          if (settled) {
            return;
          }
          settled = true;
          subagentMonitor.finish(
            result.type === "exit" && result.code === 0 ? "completed" : "failed",
          );
          subagentRuntime.dispose();
          resolve(result);
        };
        const runProcess = runCliStream(
          runCli,
          attemptPrompt,
          {
            onStdout: (chunk: string) => {
              if (!isParallelRunActive()) {
                return;
              }
              rawStdout = appendBoundedUtf8Text(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
              sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
              subagentMonitor.setParentSessionId(extractSessionId(runCli, sessionBuffer));
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
                attemptHadNormalReply = true;
              }
            },
            onStderr: (chunk: string) => {
              if (!isParallelRunActive()) {
                return;
              }
              rawStderr = appendBoundedUtf8Text(rawStderr, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
              sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
              sendPanelMessage({ type: "rawStreamDelta", content: chunk, stream: "stderr", tabId: target.tabId });
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
        syncParallelRun(runProcess);
        subagentMonitor.setParentSessionId(runtimeSessionId);
      });

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
      if (!isParallelRunActive()) {
        return;
      }

      const detectedSessionId = extractSessionId(runCli, sessionBuffer) ?? extractSessionId(runCli, `${rawStdout}
  ${rawStderr}`);
      if (
        isFreshSessionRecoveryAttempt
        && isLoopMainRun
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

      if (attemptResult.type === "exit" && attemptResult.code === 0) {
        const currentMessageTarget = resolveParallelMessageTarget();
        const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
        if (openCodeOutput.finalText) {
          const finalTextResult = appendOpenCodeFinalTextToTabStream(
            openCodeTabStreamState,
            openCodeOutput.finalText,
            openCodeTabStreamContext,
          );
          openCodeTabStreamState = finalTextResult.state;
          applyOpenCodeTabStreamActions(finalTextResult.actions);
        }
        const humanInteractionResult = await maybeHandleNaturalLanguageHumanInteraction(currentMessageTarget);
        if (humanInteractionResult === "stopped") {
          return;
        }
        if (humanInteractionResult === "continue") {
          hiddenRetryCount = 0;
          freshSessionRecoveryPending = false;
          continue;
        }
        const conversationHasFinalConclusion = hasAssistantFinalConclusionAfterMessage(currentMessageTarget, userMessageId, {
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
              hasResumableSession: Boolean(resolveCliSessionIdForResume(runCli, sessionId)),
              hasProviderError: Boolean(openCodeOutput.errorText),
              freshSessionRecoveryAttempted,
            });
            void logInfo("runPrompt-parallel-missing-final-conclusion-retry", {
              cli: runCli,
              runId,
              tabId: target.tabId,
              sessionId,
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
              const recoveryMessage: ChatMessage = {
                id: createMessageId(),
                role: "system",
                content: t("run.openCodeLoopFreshSessionRecoveryQueued"),
                createdAt: Date.now(),
              };
              appendMessageToStore(currentMessageTarget, recoveryMessage);
              sendPanelMessage({ type: "appendMessage", message: recoveryMessage, tabId: target.tabId });
            } else {
              appendHiddenRetryErrorTraceMessage(currentMessageTarget, missingConclusionMessage, {
                tabId: target.tabId,
                taskRole: input.taskRole,
                loopTaskId: input.loopTaskId,
                loopRound: input.loopRound,
                loopSubtaskId: input.loopSubtaskId,
              }, { createMessageId, sendPanelMessage });
            }
            const retryMessage = buildHiddenRetryQueuedMessage(hiddenRetryCount);
            const systemMessage: ChatMessage = {
              id: createMessageId(),
              role: "system",
              content: retryMessage,
              createdAt: Date.now(),
            };
            appendMessageToStore(currentMessageTarget, systemMessage);
            sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
            hiddenRetryCount += 1;
            continue;
          }
          void logError("runPrompt-parallel-missing-final-conclusion", {
            cli: runCli,
            runId,
            tabId: target.tabId,
            sessionId,
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
          parallelRunsByTabId.delete(target.tabId);
          const taskRecord: TaskRunRecord = {
            id: runId,
            cli: runCli,
            sessionId,
            prompt,
            startedAt,
            endedAt: Date.now(),
            durationMs: Math.max(0, Date.now() - startedAt),
            status: "error",
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            loopSubtaskId: input.loopSubtaskId,
            graphRunId: input.graphRunId,
            graphNodeId: input.graphNodeId,
          };
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
          appendMessageToStore(currentMessageTarget, systemMessage);
          sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
          sendRunStatusForTab(target.tabId, "error", { message: userMessageText });
          const completionMessage: ChatMessage = {
            id: createMessageId(),
            role: "system",
            content: buildTaskRunCompletionText("error", taskRecord.durationMs),
            createdAt: Date.now(),
          };
          appendMessageToStore(currentMessageTarget, completionMessage);
          sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
          persistMessagesForTab(runCli, sessionId, target.tabId, currentMessageTarget);
          return;
        }
        parallelRunsByTabId.delete(target.tabId);
        const taskRecord: TaskRunRecord = {
          id: runId,
          cli: runCli,
          sessionId,
          prompt,
          startedAt,
          endedAt: Date.now(),
          durationMs: Math.max(0, Date.now() - startedAt),
          status: "end",
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
          graphRunId: input.graphRunId,
          graphNodeId: input.graphNodeId,
        };
        appendTaskRun(taskRecord);
        sendRunStatusForTab(target.tabId, "end");
        const completionMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: buildTaskRunCompletionText("end", taskRecord.durationMs),
          createdAt: Date.now(),
        };
        appendMessageToStore(currentMessageTarget, completionMessage);
        sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
        persistMessagesForTab(runCli, sessionId, target.tabId, currentMessageTarget);
        maybePersistLongTermMemoryFromRun({
          status: "end",
          cli: runCli,
          prompt,
          messages: currentMessageTarget,
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
          skip: input.skipLongTermMemoryPersist,
        });
        if (shouldAutoCompactAfterRun) {
          await maybeAutoCompactContextAfterPromptSuccess(target, sessionId, taskRecord.durationMs);
        }
        return;
      }

      const lastFailureMessage = getAttemptFailureMessage(attemptResult, rawStderr || null);
      hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
      const shouldRetry = hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
        && isHiddenRetryEligibleAttempt(attemptResult, lastFailureMessage);
      const failureMessageTarget = resolveParallelMessageTarget();
      if (shouldRetry) {
        appendHiddenRetryErrorTraceMessage(failureMessageTarget, lastFailureMessage, {
          tabId: target.tabId,
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
        }, { createMessageId, sendPanelMessage });
        const retryMessage = buildHiddenRetryQueuedMessage(hiddenRetryCount);
        const systemMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: retryMessage,
          createdAt: Date.now(),
        };
        appendMessageToStore(failureMessageTarget, systemMessage);
        sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
        hiddenRetryCount += 1;
        continue;
      }

      parallelRunsByTabId.delete(target.tabId);
      const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
      if (openCodeOutput.finalText) {
        const finalTextResult = appendOpenCodeFinalTextToTabStream(
          openCodeTabStreamState,
          openCodeOutput.finalText,
          openCodeTabStreamContext,
        );
        openCodeTabStreamState = finalTextResult.state;
        applyOpenCodeTabStreamActions(finalTextResult.actions);
      }

      const taskRecord: TaskRunRecord = {
        id: runId,
        cli: runCli,
        sessionId,
        prompt,
        startedAt,
        endedAt: Date.now(),
        durationMs: Math.max(0, Date.now() - startedAt),
        status: "error",
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      };
      appendTaskRun(taskRecord);

      const finalFailureMessage = buildOpenCodeFailureMessage(openCodeOutput, lastFailureMessage);
      const userMessageText = buildHiddenRetryFailureMessage({
        hiddenRetryCount,
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
      return;
    }
  }

  return { runPromptParallel };
}
