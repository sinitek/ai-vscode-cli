import { appendBoundedUtf8Text } from "../boundedText";
import { buildCliArgs, resolveCliCommand } from "../cli/commandRunner";
import { getCliCommand, getDebugLogging } from "../cli/config";
import type { OpenCodeTaskListItem } from "../cli/openCodeTaskList";
import type { CliName, InteractiveMode, ThinkingMode } from "../cli/types";
import { hasAssistantFinalConclusionAfterMessage } from "../finalConclusion";
import { buildHiddenRetryFailureMessage, getHiddenRetryDelayMs, resetHiddenRetryCountOnRecoveredReply } from "../hiddenRetry";
import {
  buildNaturalLanguageHumanInteractionRequest,
  buildCodexHumanInteractionResolution,
  createHumanInteractionRejectedError,
  formatHumanInteractionSubmittedText,
  isHumanInteractionRejectedErrorInfo,
  normalizeHumanInteractionRequestFromCodex,
  type HumanInteractionRequest,
  type HumanInteractionSubmission,
} from "../humanInteraction";
import { ClaudeInteractiveRunner } from "../interactive/claudeRunner";
import { extractTaskListItemsFromForwardedCodexEvent } from "../interactive/codexAppServerProtocol";
import { CodexInteractiveRunner } from "../interactive/codexRunner";
import { isCodexRetryProgressTraceKind } from "../interactive/codexRunnerRuntime";
import { decideCodexThreadForSelection, normalizeCodexRunSelection, type CodexRunSelection } from "../interactive/codexThreadSelection";
import type { InteractiveRunnerManager } from "../interactive/manager";
import { isLocalSessionId } from "../interactive/sessionHistoryRepair";
import type { I18nKey } from "../i18n";
import { logCliInteractiveOutput, logCliInteractiveStart, logCliRaw, logError, logInfo, sanitizeEnv } from "../logger";
import {
  buildHiddenRetryLimitMessage,
  buildHiddenRetryQueuedMessage,
  buildHiddenRetryStartedMessage,
  createHiddenRetryErrorTraceMessage,
  getErrorInfo,
  HIDDEN_RETRY_MAX_RETRIES,
  isHiddenRetryEligibleErrorInfo,
  waitForHiddenRetryDelay,
  type ErrorInfo,
} from "../panelDiagnostics";
import { buildUserChatMessage } from "../panelStateBuilder";
import { buildHiddenRetryPrompt, buildThinkingPrompt } from "../promptRuntime";
import {
  appendMessageToStore,
  normalizeRawStreamContent,
  type LoopTaskRole,
  type TaskRunRecord,
  type TaskRunStatus,
} from "../promptRunState";
import { createSubagentProgressController, type SubagentProgressLabels } from "../subagentProgress";
import {
  normalizeTraceContentForDisplay,
  resolveTraceKind,
  resolveTraceMerge,
  type TraceMessageKind,
} from "../traceDisplay";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import type { InteractiveTabRun, PromptRunExecutionOptions } from "./promptExecutionShared";

type TraceMessageOptions = {
  merge?: boolean;
  persist?: boolean;
  forceTraceBubble?: boolean;
  taskListItems?: OpenCodeTaskListItem[];
};

export type PromptInteractiveRuntimeHostDeps = {
  AI_TASK_RAW_OUTPUT_MAX_BYTES: number;
  activeRunsByTabId: Map<string, InteractiveTabRun>;
  adoptSessionId: (cli: CliName, sessionId: string, tabId?: string | null) => void;
  applyProcessTitle: (runId: string, cli: CliName, sessionId: string | null) => void;
  applyThinkingWorkspaceFiles: (cli: CliName, thinkingMode: ThinkingMode, cwd?: string) => void;
  appendTaskRun: (record: TaskRunRecord) => void;
  buildSubagentProgressLabels: () => SubagentProgressLabels;
  buildTaskRunCompletionText: (status: TaskRunStatus, durationMs?: number | null) => string;
  createMessageId: () => string;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  getConversationTabById: (tabId: string) => { sessionId?: string | null } | null | undefined;
  getEffectiveCliArgs: (cli: CliName, model: string | null) => string[];
  getEffectiveThinkingMode: (cli: CliName, model?: string | null) => ThinkingMode;
  getGlobalHumanInteractionEnabled: () => boolean;
  getGlobalMultiAgentEnabled: () => boolean;
  getPendingSessionDraft: (tabId: string, cli: CliName) => { messages: ChatMessage[] };
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  getWorkspaceInteractiveMode: (cli: CliName) => InteractiveMode;
  getInteractiveRunnerManager: () => InteractiveRunnerManager;
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
  migrateLocalSessionToTargetSession: (cli: CliName, localSessionId: string, targetSessionId: string) => void;
  persistMessagesForTab: (cli: CliName, sessionId: string | null, tabId: string, messages: ChatMessage[]) => void;
  preparePendingLabel: (cli: CliName, tabId: string, prompt: string) => void;
  resolveClaudeInteractiveEntrypoint: (command: string | undefined) => string | undefined;
  resolveCodexInteractiveSelection: (sessionId: string) => CodexRunSelection | null;
  resolveInteractiveMappedId: (cli: CliName, sessionId: string) => string | null;
  resolveInteractiveSessionForResume: (cli: CliName, sessionId: string | null, tabId: string | null) => Promise<string | null | undefined>;
  resolveWorkspaceCwd: () => string | undefined;
  requestHumanInteraction: (request: HumanInteractionRequest) => Promise<HumanInteractionSubmission>;
  cancelHumanInteractionForTab: (tabId: string, statusText?: string) => void;
  sendPanelMessage: (payload: Record<string, unknown>) => void;
  sendRunStatusForTab: (tabId: string, status: "start" | "end" | "error" | "stopped", options?: {
    message?: string;
    prompt?: string;
    startedAt?: number;
    graphRunId?: string;
    graphNodeId?: string;
  }) => void;
  shouldAutoCompactContextAfterRunForTarget: (target: PromptRunTarget) => boolean;
  shouldRequireExplicitFinalAnswerForRun: (input: PromptRunInput) => boolean;
  t: (key: I18nKey, params?: Record<string, string | number | boolean>) => string;
  updateProcessTitle: (cli: CliName, sessionId: string) => void;
  upsertInteractiveMapping: (
    cli: CliName,
    sessionId: string,
    mappedId: string,
    options?: { freezePrevious?: string; codexSelection?: CodexRunSelection | null },
  ) => void;
};

export type PromptInteractiveRuntimeHost = {
  runPromptInteractive: (
    input: PromptRunInput,
    target: PromptRunTarget,
    executionOptions?: PromptRunExecutionOptions,
  ) => Promise<void>;
};

function isClaudeSessionNotFoundErrorInfo(info: ErrorInfo): boolean {
  const combined = `${String(info.code ?? "")} ${String(info.message ?? "")}`.toLowerCase();
  return combined.includes("claude_session_not_found")
    || combined.includes("no conversation found with session id:");
}

export function createPromptInteractiveRuntimeHost(deps: PromptInteractiveRuntimeHostDeps): PromptInteractiveRuntimeHost {
  const {
    AI_TASK_RAW_OUTPUT_MAX_BYTES,
    activeRunsByTabId: interactiveRunsByTabId,
    adoptSessionId,
    applyProcessTitle,
    applyThinkingWorkspaceFiles,
    appendTaskRun,
    buildSubagentProgressLabels,
    buildTaskRunCompletionText,
    createMessageId,
    getActiveConfigIdForCli,
    getConversationTabById,
    getEffectiveCliArgs,
    getEffectiveThinkingMode,
    getGlobalHumanInteractionEnabled,
    getGlobalMultiAgentEnabled,
    getPendingSessionDraft,
    getSelectedCliModel,
    getWorkspaceInteractiveMode,
    getInteractiveRunnerManager,
    loadSessionMessages,
    logCliStartup,
    maybeAutoCompactContextAfterPromptSuccess,
    maybePersistLongTermMemoryFromRun,
    migrateLocalSessionToTargetSession,
    persistMessagesForTab,
    preparePendingLabel,
    resolveClaudeInteractiveEntrypoint,
    resolveCodexInteractiveSelection,
    resolveInteractiveMappedId,
    resolveInteractiveSessionForResume,
    resolveWorkspaceCwd,
    requestHumanInteraction,
    cancelHumanInteractionForTab,
    sendPanelMessage,
    sendRunStatusForTab,
    shouldAutoCompactContextAfterRunForTarget,
    shouldRequireExplicitFinalAnswerForRun,
    t,
    updateProcessTitle,
    upsertInteractiveMapping,
  } = deps;
  async function runPromptInteractive(
    input: PromptRunInput,
    target: PromptRunTarget,
    executionOptions: { cwd?: string; isolateProjectInstructions?: boolean } = {},
  ): Promise<void> {
    const prompt = input.displayPrompt;
    const modelPrompt = input.modelPrompt || prompt;
    const contextTags = Array.isArray(input.contextTags)
      ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [];
    if (!prompt) {
      return;
    }

    const interactiveRunnerManager = getInteractiveRunnerManager();

    const cli = target.cli;
    const cwd = executionOptions.cwd ?? resolveWorkspaceCwd();
    const activeConfigId = getActiveConfigIdForCli(cli);
    const selectedModel = input.model || getSelectedCliModel(cli, activeConfigId);
    const thinkingMode = input.thinkingModeOverride ?? getEffectiveThinkingMode(cli, selectedModel);
    const interactiveMode = getWorkspaceInteractiveMode(cli);
    applyThinkingWorkspaceFiles(cli, thinkingMode, cwd);

    const tabId = target.tabId;
    const shouldAutoCompactAfterRun = shouldAutoCompactContextAfterRunForTarget(target);
    const resolvedSessionId = await resolveInteractiveSessionForResume(cli, target.sessionId, tabId);
    if (resolvedSessionId === undefined) {
      return;
    }
    preparePendingLabel(cli, tabId, prompt);

    let uiSessionId = resolvedSessionId;
    let messageTarget = uiSessionId
      ? loadSessionMessages(cli, uiSessionId)
      : getPendingSessionDraft(tabId, cli).messages;

    const includeFinalAnswerInstruction = !input.loopTaskId;
    const humanInteractionEnabledForCodexRun = cli === "codex"
      && interactiveMode === "coding"
      && !input.loopTaskId
      && !input.graphRunId
      && getGlobalHumanInteractionEnabled();
    const thinkingPrompt = buildThinkingPrompt(cli, thinkingMode, modelPrompt, {
      includeSuffix: false,
      includeFinalAnswerInstruction,
      includeHumanInteractionInstruction: humanInteractionEnabledForCodexRun,
    });
    const hiddenRetryPrompt = buildHiddenRetryPrompt(cli, thinkingMode, {
      includeFinalAnswerInstruction,
    });
    const debugLogging = getDebugLogging();
    const args = cli === "codex" || executionOptions.isolateProjectInstructions
      ? buildCliArgs(cli, {
          thinkingMode,
          model: selectedModel,
          imagePaths: input.imagePaths,
          isolateProjectInstructions: executionOptions.isolateProjectInstructions,
        })
      : getEffectiveCliArgs(cli, selectedModel);
    const command = getCliCommand(cli);
    const resolvedCommand = cli === "claude" ? resolveCliCommand(command) : null;
    const commandForRunner = cli === "claude"
      ? (resolvedCommand?.command ?? "claude")
      : command;
    const claudeEntrypoint = cli === "claude"
      ? resolveClaudeInteractiveEntrypoint(resolvedCommand?.command ?? commandForRunner)
      : undefined;

    logCliStartup({
      cli,
      cwd,
      command: commandForRunner,
      args,
      env: sanitizeEnv(process.env),
      mode: "interactive",
    });
    void logInfo("runPrompt-interactive-start", {
      cli,
      sessionId: uiSessionId,
      thinkingMode,
      interactiveMode,
      model: selectedModel,
      configId: activeConfigId,
      cwd,
      promptLength: prompt.length,
      modelPromptLength: modelPrompt.length,
      imagePaths: input.imagePaths ?? [],
      tabId,
    });

    const userMessageId = input.preloadedUserMessageId ?? createMessageId();
    const userCreatedAt = Date.now();
    const runId = createMessageId();
    const startedAt = Date.now();
    const processSessionId = uiSessionId ?? runId;
    applyProcessTitle(runId, cli, processSessionId);

    let assistantMessageId: string | undefined;
    let assistantMessageIndex: number | null = null;
    let completionSent = false;
    let interactiveInput = thinkingPrompt;
    let rawStdout = "";
    let rawStderr = "";
    let didLogInteractiveIo = false;
    let didLogInteractiveStart = false;
    let stopCurrentTurn: (() => void) | null = null;
    let hiddenRetryCount = 0;
    let observedCodexFinalAnswer = false;
    let naturalLanguageHumanInteractionCount = 0;
    let pendingHumanInteractionContinuationPrompt: string | null = null;

    const syncInteractiveRunEntry = (stop?: () => void): void => {
      const entry = interactiveRunsByTabId.get(tabId);
      if (!entry || entry.runId !== runId) {
        return;
      }
      entry.sessionId = uiSessionId;
      entry.messageTarget = messageTarget;
      if (stop) {
        entry.stop = stop;
      }
    };

    const isCurrentRunActive = (): boolean => {
      const entry = interactiveRunsByTabId.get(tabId);
      return Boolean(entry && entry.runId === runId && !entry.stopped);
    };

    const startInteractiveLog = (input: string): void => {
      if (!debugLogging || didLogInteractiveStart) {
        return;
      }
      didLogInteractiveStart = true;
      interactiveInput = input;
      rawStdout = "";
      rawStderr = "";
      void logCliInteractiveStart(cli, uiSessionId, {
        command: commandForRunner,
        args,
        cwd,
        stdin: input,
        resolvedCommand: cli === "claude" ? resolvedCommand?.command : undefined,
        resolvedFrom: cli === "claude" ? resolvedCommand?.resolvedFrom : undefined,
        execPath: cli === "claude" ? process.execPath : undefined,
        entrypoint: claudeEntrypoint,
      });
    };

    const appendDebugStdout = (chunk: string): void => {
      if (!debugLogging) {
        return;
      }
      rawStdout = appendBoundedUtf8Text(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
      startInteractiveLog(interactiveInput);
      void logCliInteractiveOutput(cli, uiSessionId, "stdout", chunk);
    };

    const appendTraceLog = (content: string): void => {
      if (!debugLogging || !content.trim()) {
        return;
      }
      const normalized = content.endsWith("\n") ? content : content + "\n";
      rawStderr = appendBoundedUtf8Text(rawStderr, normalized, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
      startInteractiveLog(interactiveInput);
      void logCliInteractiveOutput(cli, uiSessionId, "trace", normalized);
    };

    const appendDebugEvent = (event: unknown): void => {
      if (!debugLogging) {
        return;
      }
      let text = "";
      if (typeof event === "string") {
        text = event;
      } else {
        try {
          text = JSON.stringify(event);
        } catch {
          text = String(event);
        }
      }
      if (!text.trim()) {
        return;
      }
      startInteractiveLog(interactiveInput);
      void logCliInteractiveOutput(cli, uiSessionId, "event", text);
    };

    const logInteractiveIo = (status: TaskRunStatus, userMessage?: string): void => {
      if (!debugLogging || didLogInteractiveIo) {
        return;
      }
      didLogInteractiveIo = true;
      void logCliRaw(cli, uiSessionId, {
        command,
        args,
        cwd,
        exitCode: status === "end" ? 0 : null,
        error: status === "error" ? userMessage : undefined,
        stdin: interactiveInput,
        stdout: rawStdout,
        raw: rawStdout,
        stderr: rawStderr,
      });
    };

    const beginInteractiveAttempt = (input: string): void => {
      didLogInteractiveStart = false;
      didLogInteractiveIo = false;
      interactiveInput = input;
      rawStdout = "";
      rawStderr = "";
      startInteractiveLog(input);
    };

    const appendMessageForTab = (message: ChatMessage): void => {
      appendMessageToStore(messageTarget, message);
      sendPanelMessage({ type: "appendMessage", message, tabId });
      syncInteractiveRunEntry();
      schedulePersistForInteractiveRun();
    };

    let persistTimer: NodeJS.Timeout | null = null;

    const persistMessagesForInteractiveRun = (): void => {
      persistMessagesForTab(cli, uiSessionId, tabId, messageTarget);
      syncInteractiveRunEntry();
    };

    const flushPersistForInteractiveRun = (): void => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      persistMessagesForInteractiveRun();
    };

    const schedulePersistForInteractiveRun = (): void => {
      if (persistTimer) {
        return;
      }
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persistMessagesForInteractiveRun();
      }, 200);
    };

    const subagentProgress = createSubagentProgressController({
      labels: buildSubagentProgressLabels(),
      createMessageId,
      messageMetadata: {
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      },
      appendMessage: appendMessageForTab,
      replaceMessage: (message) => {
        const index = messageTarget.findIndex((item) => item.id === message.id);
        if (index < 0) {
          appendMessageForTab(message);
          return;
        }
        messageTarget[index] = message;
        sendPanelMessage({ type: "replaceMessage", message, tabId });
        syncInteractiveRunEntry();
        schedulePersistForInteractiveRun();
      },
      appendDelta: (messageId, content) => {
        sendPanelMessage({
          type: "assistantDelta",
          id: messageId,
          content,
          tabId,
        });
        syncInteractiveRunEntry();
        schedulePersistForInteractiveRun();
      },
    });

    const refreshMessageTargetFromSession = (): void => {
      if (!uiSessionId) {
        return;
      }
      messageTarget = loadSessionMessages(cli, uiSessionId);
      if (assistantMessageId) {
        const nextIndex = messageTarget.findIndex((message) => message.id === assistantMessageId);
        assistantMessageIndex = nextIndex >= 0 ? nextIndex : null;
      }
      syncInteractiveRunEntry();
    };

    const normalizeAssistantKindForTab = (kind?: ChatMessage["kind"]): "thinking" | "normal" => (
      kind === "thinking" ? "thinking" : "normal"
    );

    const hasSameAssistantKindForTab = (message: ChatMessage | undefined, kind?: ChatMessage["kind"]): boolean => {
      return normalizeAssistantKindForTab(message?.kind) === normalizeAssistantKindForTab(kind);
    };

    const ensureAssistantMessage = (
      kind?: ChatMessage["kind"],
      options: { forceNew?: boolean; codexFinalAnswer?: boolean } = {}
    ): void => {
      const last = messageTarget[messageTarget.length - 1];
      if (
        options.forceNew !== true
        && assistantMessageId
        && last
        && last.role === "assistant"
        && last.id === assistantMessageId
        && hasSameAssistantKindForTab(last, kind)
      ) {
        return;
      }
      assistantMessageId = createMessageId();
      const message: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        ...(kind === "thinking" ? { kind: "thinking" } : {}),
        ...(options.codexFinalAnswer === true ? { codexFinalAnswer: true } : {}),
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      };
      appendMessageToStore(messageTarget, message);
      assistantMessageIndex = messageTarget.length - 1;
      sendPanelMessage({ type: "appendMessage", message, tabId });
      syncInteractiveRunEntry();
    };

    const appendAssistantChunkForTab = (
      chunk: string,
      kind?: ChatMessage["kind"],
      options: { codexFinalAnswer?: boolean } = {}
    ): void => {
      const marksCodexFinalAnswer = options.codexFinalAnswer === true;
      if (!chunk && !marksCodexFinalAnswer) {
        return;
      }
      const last = messageTarget[messageTarget.length - 1];
      const forceNewFinalAnswer = Boolean(
        marksCodexFinalAnswer
        && chunk
        && last
        && last.role === "assistant"
        && last.id === assistantMessageId
        && last.codexFinalAnswer !== true
        && String(last.content || "").trim()
      );
      if (chunk) {
        ensureAssistantMessage(kind, {
          forceNew: forceNewFinalAnswer,
          codexFinalAnswer: marksCodexFinalAnswer,
        });
      }
      if (!assistantMessageId || assistantMessageIndex === null) {
        return;
      }
      const message = messageTarget[assistantMessageIndex];
      if (!message || message.role !== "assistant") {
        return;
      }
      if (marksCodexFinalAnswer) {
        message.codexFinalAnswer = true;
      }
      if (kind === "thinking") {
        message.kind = "thinking";
      }
      if (chunk) {
        message.content += chunk;
      }
      sendPanelMessage({
        type: "assistantDelta",
        id: assistantMessageId,
        content: chunk,
        kind,
        tabId,
        ...(marksCodexFinalAnswer ? { codexFinalAnswer: true } : {}),
      });
      syncInteractiveRunEntry();
      schedulePersistForInteractiveRun();
    };

    const removeAssistantPlaceholderForTab = (): boolean => {
      if (assistantMessageIndex === null) {
        return false;
      }
      const message = messageTarget[assistantMessageIndex];
      if (!message || message.role !== "assistant") {
        return false;
      }
      if (message.content.trim()) {
        return false;
      }
      messageTarget.splice(assistantMessageIndex, 1);
      assistantMessageIndex = null;
      return true;
    };

    const removeCurrentAssistantMessageForTab = (): string => {
      if (assistantMessageIndex === null) {
        return "";
      }
      const message = messageTarget[assistantMessageIndex];
      if (!message || message.role !== "assistant") {
        return "";
      }
      const removedId = message.id;
      const content = String(message.content ?? "");
      messageTarget.splice(assistantMessageIndex, 1);
      assistantMessageIndex = null;
      if (assistantMessageId === removedId) {
        assistantMessageId = undefined;
      }
      sendPanelMessage({ type: "removeMessage", id: removedId, tabId });
      syncInteractiveRunEntry();
      schedulePersistForInteractiveRun();
      return content;
    };

    const appendSystemMessageForTab = (content: string): void => {
      if (!content.trim()) {
        return;
      }
      appendMessageForTab({
        id: createMessageId(),
        role: "system",
        content,
        createdAt: Date.now(),
      });
    };

    const appendTraceMessageForTab = (
      content: string,
      kind: TraceMessageKind = "normal",
      options: TraceMessageOptions = {}
    ): void => {
      if (!content.trim()) {
        return;
      }
      const { content: displayContent, shouldPersist } = normalizeTraceContentForDisplay(content, cli);
      if (!displayContent.trim()) {
        return;
      }
      const resolvedKind = resolveTraceKind(displayContent, kind);
      if (resolvedKind === "thinking" && options.forceTraceBubble !== true) {
        appendAssistantChunkForTab(`${displayContent}\n`, "thinking");
        return;
      }
      const shouldMerge = resolveTraceMerge(displayContent, options.merge);
      const mergePayload = shouldMerge ? {} : { merge: false };
      const message: ChatMessage = {
        id: createMessageId(),
        role: "trace",
        content: displayContent,
        createdAt: Date.now(),
        kind: resolvedKind,
        ...mergePayload,
      };
      if (shouldPersist && options.persist !== false) {
        appendMessageToStore(messageTarget, message);
        schedulePersistForInteractiveRun();
      }
      sendPanelMessage({
        type: "traceSegment",
        id: message.id,
        createdAt: message.createdAt,
        sequence: message.sequence,
        content: message.content,
        kind: resolvedKind,
        tabId,
        ...(Array.isArray(options.taskListItems) ? { taskListItems: options.taskListItems } : {}),
        ...mergePayload,
      });
      syncInteractiveRunEntry();
    };

    const appendCompletionMessageForTab = (status: TaskRunStatus): TaskRunRecord | null => {
      if (completionSent) {
        return null;
      }
      completionSent = true;
      const endedAt = Date.now();
      const taskRecord: TaskRunRecord = {
        id: runId,
        cli,
        sessionId: uiSessionId,
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
      appendTaskRun(taskRecord);
      appendSystemMessageForTab(
        buildTaskRunCompletionText(status, taskRecord.durationMs)
      );
      return taskRecord;
    };

    const canHandleHumanInteractionRequest = (): boolean => {
      return humanInteractionEnabledForCodexRun;
    };

    const appendHumanInteractionSubmissionForTab = (
      submission: HumanInteractionSubmission,
      request: HumanInteractionRequest,
    ): void => {
      appendMessageForTab({
        id: createMessageId(),
        role: "user",
        content: formatHumanInteractionSubmittedText(submission, request.formFields),
        createdAt: Date.now(),
        merge: false,
      });
    };

    const handleCodexHumanInteractionRequest = async (request: {
      method: string;
      params?: unknown;
    }) => {
      if (
        !canHandleHumanInteractionRequest()
        || (
          request.method !== "item/tool/requestUserInput"
          && request.method !== "mcpServer/elicitation/request"
        )
      ) {
        return null;
      }
      const humanRequest = normalizeHumanInteractionRequestFromCodex({
        method: request.method,
        params: request.params,
        fallbackInteractionId: createMessageId(),
        tabId,
      });
      appendSystemMessageForTab(t("run.humanInteractionWaiting"));
      const submission = await requestHumanInteraction(humanRequest);
      appendHumanInteractionSubmissionForTab(submission, humanRequest);
      if (submission.status === "aborted") {
        throw createHumanInteractionRejectedError();
      }
      return buildCodexHumanInteractionResolution(request.method, submission);
    };

    const buildHumanInteractionContinuationPrompt = (
      submission: HumanInteractionSubmission,
      request: HumanInteractionRequest,
    ): string => {
      return buildThinkingPrompt(cli, thinkingMode, [
        formatHumanInteractionSubmittedText(submission, request.formFields),
        "",
        "请根据以上补充信息继续完成原始任务。",
      ].join("\n"), {
        includePrefix: false,
        includeSuffix: false,
        includeFinalAnswerInstruction,
        includeHumanInteractionInstruction: canHandleHumanInteractionRequest(),
      });
    };

    const maybeHandleNaturalLanguageHumanInteraction = async (): Promise<boolean> => {
      if (!canHandleHumanInteractionRequest() || naturalLanguageHumanInteractionCount > 0) {
        return false;
      }
      if (assistantMessageIndex === null) {
        return false;
      }
      const message = messageTarget[assistantMessageIndex];
      if (!message || message.role !== "assistant" || message.kind === "thinking") {
        return false;
      }
      const humanRequest = buildNaturalLanguageHumanInteractionRequest({
        tabId,
        fallbackInteractionId: createMessageId(),
        userPrompt: prompt,
        assistantText: String(message.content ?? ""),
      });
      if (!humanRequest) {
        return false;
      }
      naturalLanguageHumanInteractionCount += 1;
      removeCurrentAssistantMessageForTab();
      appendSystemMessageForTab(t("run.humanInteractionWaiting"));
      const submission = await requestHumanInteraction(humanRequest);
      appendHumanInteractionSubmissionForTab(submission, humanRequest);
      if (submission.status === "aborted") {
        throw createHumanInteractionRejectedError();
      }
      pendingHumanInteractionContinuationPrompt = buildHumanInteractionContinuationPrompt(submission, humanRequest);
      void logInfo("runPrompt-interactive-natural-human-interaction", {
        cli,
        tabId,
        runId,
        sessionId: uiSessionId,
        interactionId: humanRequest.interactionId,
        fields: humanRequest.formFields.length,
      });
      return true;
    };

    const cleanupAfterRun = async (status: TaskRunStatus, userMessage?: string): Promise<void> => {
      subagentProgress.finishRunning(status === "end" ? "completed" : "failed");
      void logInfo("runPrompt-interactive-end", {
        cli,
        sessionId: uiSessionId,
        runId,
        tabId,
        status,
        message: userMessage ?? null,
      });
      logInteractiveIo(status, userMessage);
      if (status === "error" && userMessage) {
        appendSystemMessageForTab(userMessage);
      }
      sendRunStatusForTab(tabId, status === "end" ? "end" : status);
      const taskRecord = appendCompletionMessageForTab(status);
      flushPersistForInteractiveRun();
      maybePersistLongTermMemoryFromRun({
        status,
        cli,
        prompt,
        messages: messageTarget,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        skip: input.skipLongTermMemoryPersist,
      });
      interactiveRunsByTabId.delete(tabId);
      if (status === "end" && shouldAutoCompactAfterRun) {
        await maybeAutoCompactContextAfterPromptSuccess(target, uiSessionId, taskRecord?.durationMs ?? null);
      }
    };

    const updateSessionForNewRun = (
      newId: string,
      options: { freezePrevious?: string | null; codexSelection?: CodexRunSelection | null } = {}
    ): void => {
      const localSessionIdToPromote = !uiSessionId
        ? (getConversationTabById(tabId)?.sessionId ?? null)
        : (isLocalSessionId(uiSessionId) ? uiSessionId : null);

      if (!uiSessionId || localSessionIdToPromote) {
        adoptSessionId(cli, newId, tabId);
        upsertInteractiveMapping(cli, newId, newId, {
          freezePrevious: options.freezePrevious ?? undefined,
          codexSelection: options.codexSelection,
        });
        if (localSessionIdToPromote && localSessionIdToPromote !== newId) {
          migrateLocalSessionToTargetSession(cli, localSessionIdToPromote, newId);
        }
        uiSessionId = newId;
        refreshMessageTargetFromSession();
        return;
      }
      upsertInteractiveMapping(cli, uiSessionId, newId, {
        freezePrevious: options.freezePrevious ?? undefined,
        codexSelection: options.codexSelection,
      });
    };

    const stopFn = (): void => {
      const entry = interactiveRunsByTabId.get(tabId);
      if (!entry || entry.runId !== runId || entry.stopped) {
        return;
      }
      entry.stopped = true;
      subagentProgress.finishRunning("interrupted");
      void logInfo("runPrompt-interactive-stop-requested", { cli, sessionId: uiSessionId, runId, tabId });
      const removedPlaceholder = removeAssistantPlaceholderForTab();
      appendSystemMessageForTab(t("run.stoppedByUser"));
      cancelHumanInteractionForTab(tabId, t("run.stoppedByUser"));
      try {
        stopCurrentTurn?.();
      } catch {
        // ignore
      }
      logInteractiveIo("stopped", t("run.stoppedByUser"));
      sendRunStatusForTab(tabId, "stopped");
      appendCompletionMessageForTab("stopped");
      if (removedPlaceholder && assistantMessageId) {
        sendPanelMessage({ type: "removeMessage", id: assistantMessageId, tabId });
      }
      flushPersistForInteractiveRun();
      interactiveRunsByTabId.delete(tabId);
    };

    const handleMissingFinalConclusionForTab = (
      source: string
    ): { action: "ok" | "retry" | "error" | "stopped"; message?: string } => {
      if (!isCurrentRunActive()) {
        void logInfo("runPrompt-interactive-missing-final-conclusion-skip-inactive", {
          cli,
          tabId,
          runId,
          sessionId: uiSessionId,
          source,
        });
        return { action: "stopped" };
      }
      if (hasAssistantFinalConclusionAfterMessage(messageTarget, userMessageId, {
        observedFinalAnswer: source === "codex" && observedCodexFinalAnswer,
        fallbackCreatedAt: userCreatedAt,
        requireExplicitFinalAnswer: shouldRequireExplicitFinalAnswerForRun(input),
      })) {
        return { action: "ok" };
      }
      const missingConclusionMessage = t("run.missingFinalConclusionRetryReason");
      if (hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES) {
        appendMessageForTab(createHiddenRetryErrorTraceMessage(missingConclusionMessage, {
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
        }, { createMessageId }));
        appendSystemMessageForTab(buildHiddenRetryQueuedMessage(hiddenRetryCount));
        hiddenRetryCount += 1;
        void logInfo("runPrompt-interactive-missing-final-conclusion-retry", {
          cli,
          tabId,
          runId,
          sessionId: uiSessionId,
          source,
          retryCount: hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        });
        return { action: "retry" };
      }
      return {
        action: "error",
        message: buildHiddenRetryFailureMessage({
          hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryLimitMessage: buildHiddenRetryLimitMessage(),
          fallbackMessage: missingConclusionMessage,
          lastFailureMessage: missingConclusionMessage,
          lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
        }),
      };
    };

    if (!input.preloadedUserMessageId) {
      appendMessageForTab(buildUserChatMessage(input, userCreatedAt, userMessageId));
    }
    sendRunStatusForTab(tabId, "start", {
      prompt,
      startedAt,
      graphRunId: input.graphRunId,
      graphNodeId: input.graphNodeId,
    });

    interactiveRunsByTabId.set(tabId, {
      runId,
      tabId,
      cli,
      sessionId: uiSessionId,
      prompt,
      startedAt,
      stop: stopFn,
      messageTarget,
      stopped: false,
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
      graphRunId: input.graphRunId,
      graphNodeId: input.graphNodeId,
    });

    while (true) {
      const attemptNumber = hiddenRetryCount + 1;
      const attemptPrompt = pendingHumanInteractionContinuationPrompt
        ?? (hiddenRetryCount === 0 ? thinkingPrompt : hiddenRetryPrompt);
      pendingHumanInteractionContinuationPrompt = null;
      let attemptHadNormalReply = false;

      if (hiddenRetryCount > 0) {
        const retryNumber = hiddenRetryCount;
        const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
        const shouldContinue = await waitForHiddenRetryDelay(retryNumber, isCurrentRunActive);
        if (!shouldContinue) {
          return;
        }
        appendSystemMessageForTab(buildHiddenRetryStartedMessage(retryNumber));
        void logInfo("runPrompt-interactive-hidden-retry", {
          cli,
          tabId,
          runId,
          sessionId: uiSessionId,
          attempt: attemptNumber,
          retryCount: hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryDelayMs,
        });
      }

      beginInteractiveAttempt(attemptPrompt);

      try {
        if (cli === "codex") {
          const mappedThreadId = uiSessionId ? resolveInteractiveMappedId(cli, uiSessionId) : null;
          const nextSelection = normalizeCodexRunSelection({
            configId: activeConfigId,
            model: selectedModel,
          });
          const threadDecision = decideCodexThreadForSelection({
            mappedThreadId,
            previousSelection: uiSessionId
              ? interactiveRunnerManager.getCodexRunnerSelection(uiSessionId)
                ?? resolveCodexInteractiveSelection(uiSessionId)
              : null,
            nextSelection,
          });
          if (threadDecision.startedFreshForSelectionChange) {
            void logInfo("runPrompt-interactive-codex-selection-new-thread", {
              cli,
              sessionId: uiSessionId,
              previousThreadId: mappedThreadId,
              configId: nextSelection.configId,
              model: nextSelection.model,
              tabId,
            });
          }
          const runner = uiSessionId
            ? interactiveRunnerManager.getOrCreateCodexRunner({
                sessionId: uiSessionId,
                threadId: threadDecision.threadId,
                command,
                args,
                cwd: cwd ?? undefined,
                thinkingMode,
                interactiveMode,
                model: nextSelection.model,
                configId: nextSelection.configId,
                multiAgentEnabled: getGlobalMultiAgentEnabled(),
              })
            : new CodexInteractiveRunner({
                command,
                args,
                cwd: cwd ?? undefined,
                thinkingMode,
                interactiveMode,
                model: nextSelection.model,
                threadId: null,
                multiAgentEnabled: getGlobalMultiAgentEnabled(),
              });

          stopCurrentTurn = () => runner.stopAndRebuild();
          syncInteractiveRunEntry(stopFn);
          await runner.runStreamed(attemptPrompt, {
            onAssistantDelta: (chunk, meta) => {
              if (!isCurrentRunActive()) {
                return;
              }
              if (meta?.codexFinalAnswer === true) {
                observedCodexFinalAnswer = true;
              }
              if (chunk.trim().length > 0) {
                attemptHadNormalReply = true;
              }
              appendAssistantChunkForTab(chunk, undefined, {
                codexFinalAnswer: meta?.codexFinalAnswer === true,
              });
              appendDebugStdout(chunk);
            },
            onSubagentUpdate: (update) => {
              if (!isCurrentRunActive()) {
                return;
              }
              subagentProgress.update({
                provider: "codex",
                id: update.threadId,
                agentName: update.agentName,
                status: update.status,
                delta: update.delta,
                error: update.error,
              });
            },
            onTrace: (content, kind, meta) => {
              if (!isCurrentRunActive()) {
                return;
              }
              if (content.trim().length > 0 && isCodexRetryProgressTraceKind(kind)) {
                attemptHadNormalReply = true;
              }
              appendTraceMessageForTab(content, kind === "thinking" ? "thinking" : "normal", meta);
              appendTraceLog(content);
            },
            onEvent: (event) => {
              if (!isCurrentRunActive()) {
                return;
              }
              sendPanelMessage({ type: "rawStreamDelta", content: normalizeRawStreamContent(event) + (String(normalizeRawStreamContent(event)).endsWith("\n") ? "" : "\n"), stream: "event", tabId });
              const eventTaskListItems = extractTaskListItemsFromForwardedCodexEvent(event, runner.getThreadId());
              if (eventTaskListItems.length) {
                sendPanelMessage({ type: "taskListUpdate", items: eventTaskListItems, tabId });
              }
              appendDebugEvent(event);
            },
            onTaskListUpdate: (items) => {
              sendPanelMessage({ type: "taskListUpdate", items, tabId });
            },
            onRequest: handleCodexHumanInteractionRequest,
            onThreadId: (threadId) => {
              updateProcessTitle(cli, threadId);
              updateSessionForNewRun(threadId, {
                freezePrevious: threadDecision.freezePrevious,
                codexSelection: nextSelection,
              });
              void logInfo("runPrompt-interactive-codex-thread", {
                cli,
                sessionId: uiSessionId,
                threadId,
                replacedThreadId: threadDecision.freezePrevious,
                configId: nextSelection.configId,
                model: nextSelection.model,
                originalSessionId: target.sessionId,
                tabId,
              });
              if (uiSessionId) {
                interactiveRunnerManager.setRunner("codex", uiSessionId, runner, thinkingMode, interactiveMode, nextSelection.model, {
                  multiAgentEnabled: getGlobalMultiAgentEnabled(),
                  configId: nextSelection.configId,
                  command,
                  args,
                  cwd: cwd ?? undefined,
                });
              }
              syncInteractiveRunEntry();
            },
          });
          if (await maybeHandleNaturalLanguageHumanInteraction()) {
            continue;
          }
          const finalConclusionState = handleMissingFinalConclusionForTab("codex");
          if (finalConclusionState.action === "stopped") {
            return;
          }
          if (finalConclusionState.action === "retry") {
            continue;
          }
          if (finalConclusionState.action === "error") {
            await cleanupAfterRun("error", finalConclusionState.message);
            return;
          }
          await cleanupAfterRun("end");
          return;
        }

        if (cli === "claude") {
          const mappedSessionId = uiSessionId ? resolveInteractiveMappedId(cli, uiSessionId) : null;
          let runner = uiSessionId
            ? interactiveRunnerManager.getOrCreateClaudeRunner({
                sessionId: uiSessionId,
                mappedSessionId,
                command: commandForRunner,
                args,
                cwd: cwd ?? undefined,
                thinkingMode,
                interactiveMode,
                model: selectedModel,
                entrypoint: claudeEntrypoint,
                isolateProjectInstructions: executionOptions.isolateProjectInstructions,
              })
            : new ClaudeInteractiveRunner({
                command: commandForRunner,
                args,
                cwd: cwd ?? undefined,
                thinkingMode,
                interactiveMode,
                model: selectedModel,
                entrypoint: claudeEntrypoint,
                sessionId: null,
                isolateProjectInstructions: executionOptions.isolateProjectInstructions,
              });

          const runStreamHandlers = {
            onAssistantDelta: (chunk: string) => {
              if (!isCurrentRunActive()) {
                return;
              }
              if (chunk.trim().length > 0) {
                attemptHadNormalReply = true;
              }
              appendAssistantChunkForTab(chunk);
              appendDebugStdout(chunk);
            },
            onTrace: (content: string, kind?: "thinking" | "normal" | "tool-use", meta?: { merge?: boolean }) => {
              if (!isCurrentRunActive()) {
                return;
              }
              if (content.trim().length > 0 && kind !== "thinking") {
                attemptHadNormalReply = true;
              }
              appendTraceMessageForTab(content, kind ?? "normal", {
                ...meta,
                forceTraceBubble: kind === "thinking",
              });
              appendTraceLog(content);
            },
            onEvent: (event: unknown) => {
              if (!isCurrentRunActive()) {
                return;
              }
              sendPanelMessage({ type: "rawStreamDelta", content: normalizeRawStreamContent(event) + (String(normalizeRawStreamContent(event)).endsWith("\n") ? "" : "\n"), stream: "event", tabId });
              appendDebugEvent(event);
            },
            onTaskListUpdate: (items: { text: string; done: boolean }[]) => {
              sendPanelMessage({ type: "taskListUpdate", items, tabId });
            },
            onSessionId: (newSessionId: string) => {
              updateProcessTitle(cli, newSessionId);
              updateSessionForNewRun(newSessionId);
              void logInfo("runPrompt-interactive-claude-session", {
                cli,
                sessionId: uiSessionId,
                newSessionId,
                originalSessionId: target.sessionId,
                tabId,
              });
              if (uiSessionId) {
                interactiveRunnerManager.setRunner("claude", uiSessionId, runner, thinkingMode, interactiveMode, selectedModel);
              }
              syncInteractiveRunEntry();
            },
          };

          stopCurrentTurn = () => runner.stopAndRebuild();
          syncInteractiveRunEntry(stopFn);
          try {
            await runner.runStreamed(attemptPrompt, runStreamHandlers);
          } catch (error) {
            const info = getErrorInfo(error);
            if (uiSessionId && isClaudeSessionNotFoundErrorInfo(info)) {
              appendSystemMessageForTab(t("claude.sessionResetRetry"));
              void logInfo("runPrompt-interactive-claude-session-reset-retry", {
                cli,
                sessionId: uiSessionId,
                mappedSessionId,
                error: info.message,
                errorCode: info.code,
                tabId,
              });
              runner.dispose();
              runner = new ClaudeInteractiveRunner({
                command: commandForRunner,
                args,
                cwd: cwd ?? undefined,
                thinkingMode,
                interactiveMode,
                model: selectedModel,
                entrypoint: claudeEntrypoint,
                sessionId: null,
                isolateProjectInstructions: executionOptions.isolateProjectInstructions,
              });
              stopCurrentTurn = () => runner.stopAndRebuild();
              syncInteractiveRunEntry(stopFn);
              await runner.runStreamed(attemptPrompt, runStreamHandlers);
            } else {
              throw error;
            }
          }
          const finalConclusionState = handleMissingFinalConclusionForTab("claude");
          if (finalConclusionState.action === "stopped") {
            return;
          }
          if (finalConclusionState.action === "retry") {
            continue;
          }
          if (finalConclusionState.action === "error") {
            await cleanupAfterRun("error", finalConclusionState.message);
            return;
          }
          await cleanupAfterRun("end");
          return;
        }

        throw new Error(`interactive-runner-unsupported:${cli}`);
      } catch (error) {
        const entry = interactiveRunsByTabId.get(tabId);
        if (!entry || entry.runId !== runId) {
          return;
        }
        const info = getErrorInfo(error);
        if (entry.stopped) {
          void logInfo("runPrompt-interactive-aborted", {
            cli,
            tabId,
            error: info.message,
            errorName: info.name,
            errorCode: info.code,
            errorStack: info.stack,
          });
          return;
        }
        subagentProgress.finishRunning("failed");

        if (isHumanInteractionRejectedErrorInfo(info)) {
          const userMessage = t("run.humanInteractionRejected");
          appendSystemMessageForTab(userMessage);
          cancelHumanInteractionForTab(tabId, userMessage);
          void logInfo("runPrompt-interactive-human-interaction-rejected", {
            cli,
            tabId,
            runId,
            sessionId: uiSessionId,
            error: info.message,
            errorName: info.name,
            errorCode: info.code,
          });
          await cleanupAfterRun("stopped");
          return;
        }

        const canContinueCurrentConversation = Boolean(uiSessionId);
        hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
        const shouldRetry = canContinueCurrentConversation
          && hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
          && isHiddenRetryEligibleErrorInfo(info);
        if (shouldRetry) {
          const retryDelayMs = getHiddenRetryDelayMs(hiddenRetryCount + 1);
          appendMessageForTab(createHiddenRetryErrorTraceMessage(info.message, {
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            loopSubtaskId: input.loopSubtaskId,
          }, { createMessageId }));
          appendSystemMessageForTab(buildHiddenRetryQueuedMessage(hiddenRetryCount));
          hiddenRetryCount += 1;
          void logInfo("runPrompt-interactive-hidden-retry-queued", {
            cli,
            tabId,
            runId,
            sessionId: uiSessionId,
            failedAttempt: attemptNumber,
            nextAttempt: attemptNumber + 1,
            retryCount: hiddenRetryCount,
            maxRetries: HIDDEN_RETRY_MAX_RETRIES,
            retryDelayMs,
            error: info.message,
            errorName: info.name,
            errorCode: info.code,
            errorStack: info.stack,
          });
          continue;
        }

        void logError("runPrompt-interactive-error", {
          cli,
          tabId,
          error: info.message,
          errorName: info.name,
          errorCode: info.code,
          errorStack: info.stack,
        });
        const rawUserMessage = error instanceof Error ? error.message : String(error);
        const userMessage = buildHiddenRetryFailureMessage({
          hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryLimitMessage: buildHiddenRetryLimitMessage(),
          fallbackMessage: rawUserMessage,
          lastFailureMessage: rawUserMessage,
          lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
        });
        await cleanupAfterRun("error", userMessage);
        throw error;
      }
    }
  }

  return { runPromptInteractive };
}
