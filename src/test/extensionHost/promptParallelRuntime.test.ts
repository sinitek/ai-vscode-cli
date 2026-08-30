import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

import type { RunProcess } from "../cli/commandRunner";
import type { CliAttemptResult } from "../panelDiagnostics";
import type { TaskRunRecord, TaskRunStatus } from "../promptRunState";
import type { SubagentProgressStatus } from "../subagentProgress";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../extensionHost/graphRuntime";

installVscodeMock();

const {
  createPromptParallelRuntimeHost,
} = require("../extensionHost/promptParallelRuntime") as typeof import("../extensionHost/promptParallelRuntime");
const {
  appendOpenCodeFinalTextToTabStream,
  consumeOpenCodeTabStreamChunk,
  createOpenCodeTabStreamState,
} = require("../openCodeTabStream") as typeof import("../openCodeTabStream");
const { appendBoundedUtf8Text } = require("../boundedText") as typeof import("../boundedText");

type PromptParallelRuntimeDeps = Parameters<typeof createPromptParallelRuntimeHost>[0];
type RunCliStream = NonNullable<PromptParallelRuntimeDeps["runCliStream"]>;
type RunCliStreamHandlers = Parameters<RunCliStream>[2];
type OpenCodeRunOutput = ReturnType<NonNullable<PromptParallelRuntimeDeps["parseOpenCodeRunOutput"]>>;

const GRAPH_RUN_ID = "graph-run-1";
const GRAPH_NODE_ID = "node-1";
const TAB_ID = "tab-1";

type RunStatusEvent = {
  tabId: string;
  status: "start" | "end" | "error" | "stopped";
  options?: {
    message?: string;
    prompt?: string;
    startedAt?: number;
    graphRunId?: string;
    graphNodeId?: string;
  };
};

function createPromptInput(overrides: Partial<PromptRunInput> = {}): PromptRunInput {
  return {
    displayPrompt: "Implement the runtime node",
    modelPrompt: "Implement the runtime node",
    contextTags: [],
    taskRole: "subtask",
    loopTaskId: "loop-task-1",
    loopRound: 1,
    loopSubtaskId: "loop-subtask-1",
    graphRunId: GRAPH_RUN_ID,
    graphNodeId: GRAPH_NODE_ID,
    ...overrides,
  };
}

function createTarget(overrides: Partial<PromptRunTarget> = {}): PromptRunTarget {
  return {
    tabId: TAB_ID,
    cli: "opencode",
    sessionId: null,
    ...overrides,
  };
}

function createAsyncRunCliStreamStub(
  emit: (handlers: RunCliStreamHandlers) => void,
): RunCliStream {
  return ((_cli, _prompt, handlers) => {
    const processHandle: RunProcess = {
      kill: () => true,
    };
    setImmediate(() => emit(handlers));
    return processHandle;
  }) as RunCliStream;
}

function createRuntimePreparation(): Awaited<ReturnType<NonNullable<PromptParallelRuntimeDeps["prepareOpenCodeRuntime"]>>> {
  const model = "packyapi/claude-sonnet-5";
  return {
    envOverrides: {},
    configContent: JSON.stringify({
      model,
      provider: { packyapi: { models: { "claude-sonnet-5": {} } } },
    }),
    role: "subtask",
    mainModel: "packyapi/claude-opus-5",
    subtaskModel: model,
    effectiveModel: model,
    mainVariant: null,
    subtaskVariant: null,
    effectiveVariant: null,
    modelFallback: "none",
    primaryModel: "packyapi/claude-opus-5",
    smallModel: model,
    primaryVariant: null,
    smallVariant: null,
  };
}

function createDisabledSubagentMonitor() {
  return {
    setParentSessionId: () => undefined,
    pollNow: async () => undefined,
    finish: (_status?: SubagentProgressStatus) => undefined,
    dispose: () => undefined,
  };
}

function createParallelRuntimeHarness(options: {
  runCliStream: RunCliStream;
  parseOpenCodeRunOutput?: (stdout: string, stderr: string) => OpenCodeRunOutput;
} = {
  runCliStream: createAsyncRunCliStreamStub((handlers) => handlers.onExit(0)),
}) {
  const messages: ChatMessage[] = [];
  const panelMessages: Array<Record<string, unknown>> = [];
  const taskRuns: TaskRunRecord[] = [];
  const runStatusEvents: RunStatusEvent[] = [];
  const persistedMessages: Array<{ cli: string; sessionId: string | null; tabId: string; messages: ChatMessage[] }> = [];
  const memoryPersistStatuses: TaskRunStatus[] = [];
  const parallelRunsByTabId = new Map<string, unknown>();
  let idCounter = 0;

  const deps: PromptParallelRuntimeDeps = {
    AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024 * 1024,
    HIDDEN_RETRY_MAX_RETRIES: 0,
    OPENCODE_SUBAGENT_POLL_INTERVAL_MS: 100,
    adoptDetectedSessionId: () => undefined,
    adoptFreshOpenCodeLoopRecoverySession: ({ messageTarget }) => messageTarget,
    appendBoundedUtf8Text,
    appendHiddenRetryErrorTraceMessage: () => undefined,
    appendMessageToStore: (target, message) => {
      target.push(message);
    },
    appendOpenCodeFinalTextToTabStream,
    appendTaskRun: (record) => {
      taskRuns.push(record);
    },
    applyThinkingWorkspaceFiles: () => undefined,
    buildHiddenRetryFailureMessage: ({ fallbackMessage }) => fallbackMessage,
    buildHiddenRetryLimitMessage: () => "retry limit reached",
    buildHiddenRetryPrompt: () => "retry prompt",
    buildHiddenRetryQueuedMessage: () => "retry queued",
    buildHiddenRetryStartedMessage: () => "retry started",
    buildOpenCodeFailureMessage: (output, fallbackMessage) => output.errorText ?? fallbackMessage,
    buildOpenCodeMissingFinalConclusionMessage: () => "missing final conclusion",
    buildProcessLabel: (_cli, runId) => `process:${runId}`,
    buildSubagentProgressLabels: () => ({
      provider: { codex: "Codex", loop: "Loop", opencode: "OpenCode" },
      subagent: "subagent",
      status: {
        running: "running",
        completed: "completed",
        failed: "failed",
        interrupted: "interrupted",
      },
      errorPrefix: "error: ",
    }),
    buildTaskRunCompletionText: (status, durationMs) => `${status}:${durationMs ?? ""}`,
    buildThinkingPrompt: (_cli, _thinkingMode, prompt) => prompt,
    buildUserChatMessage: (input, createdAt, messageId) => ({
      id: messageId,
      role: "user",
      content: input.displayPrompt,
      createdAt,
      contextTags: input.contextTags,
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
      graphRunId: input.graphRunId,
      graphNodeId: input.graphNodeId,
    }),
    cancelHumanInteractionForTab: () => undefined,
    consumeOpenCodeTabStreamChunk,
    createDisabledOpenCodeSubagentMonitor: createDisabledSubagentMonitor,
    createMessageId: () => `msg-${++idCounter}`,
    createOpenCodeSubagentMonitor: () => createDisabledSubagentMonitor(),
    createOpenCodeTabStreamState,
    createSubagentProgressController: () => ({
      update: () => undefined,
      finishRunning: () => undefined,
      getMessage: () => null,
    }),
    extractSessionId: () => undefined,
    getAttemptFailureMessage: (attemptResult: CliAttemptResult, resultErrorText) => {
      if (resultErrorText) {
        return resultErrorText;
      }
      if (attemptResult.type === "error") {
        return attemptResult.error.message;
      }
      return `exit ${attemptResult.code ?? "null"}`;
    },
    getEffectiveThinkingMode: () => "medium",
    getGlobalHumanInteractionEnabled: () => false,
    getHiddenRetryDelayMs: () => 0,
    getPendingSessionDraft: () => ({ messages }),
    hasAssistantFinalConclusionAfterMessage: () => true,
    isHiddenRetryEligibleAttempt: () => false,
    isLocalSessionId: () => false,
    loadSessionMessages: () => messages,
    logDebug: async () => undefined,
    logError: async () => undefined,
    logInfo: async () => undefined,
    maybeAutoCompactContextAfterPromptSuccess: async () => undefined,
    maybePersistLongTermMemoryFromRun: ({ status }) => {
      memoryPersistStatuses.push(status);
    },
    normalizeTraceContentForDisplay: (content) => ({ content, shouldPersist: true }),
    parallelRunsByTabId: parallelRunsByTabId as PromptParallelRuntimeDeps["parallelRunsByTabId"],
    parseOpenCodeRunOutput: options.parseOpenCodeRunOutput ?? (() => ({
      finalText: "[final_answer] done",
      errorText: null,
      statusText: null,
      hasStructuredFinalAnswer: true,
    })),
    persistMessagesForTab: (cli, sessionId, tabId, nextMessages) => {
      persistedMessages.push({ cli, sessionId, tabId, messages: nextMessages.slice() });
    },
    prepareOpenCodeRuntime: async () => createRuntimePreparation(),
    prepareOpenCodeSubagentRuntime: async () => ({
      connection: null,
      endpointSource: "unavailable",
      error: null,
      dispose: () => undefined,
    }),
    preparePendingLabel: () => undefined,
    requestHumanInteraction: async (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {},
    }),
    resetHiddenRetryCountOnRecoveredReply: (count) => count,
    resolveCliSessionIdForResume: (_cli, sessionId) => sessionId,
    resolveOpenCodeSuccessfulExitOutcome: () => "complete",
    resolveTraceKind: (_content, kind) => kind,
    resolveTraceMerge: () => false,
    resolveWorkspaceCwd: () => process.cwd(),
    runCliStream: options.runCliStream,
    sendOpenCodeTaskListUpdate: (items, sendOptions) => {
      panelMessages.push({ type: "taskListUpdate", items, source: sendOptions.source, tabId: sendOptions.tabId });
    },
    sendPanelMessage: (payload) => {
      panelMessages.push(payload);
    },
    sendRunStatusForTab: (tabId, status, runStatusOptions) => {
      runStatusEvents.push({ tabId, status, options: runStatusOptions });
    },
    shouldAutoCompactContextAfterRunForTarget: () => false,
    shouldRecoverOpenCodeLoopMainSessionInFreshSession: () => false,
    shouldRequireExplicitFinalAnswerForRun: () => false,
    t: (key) => key,
    updateSessionBuffer: (buffer, chunk) => `${buffer}${chunk}`,
    waitForHiddenRetryDelay: async () => true,
  };

  return {
    host: createPromptParallelRuntimeHost(deps),
    memoryPersistStatuses,
    messages,
    panelMessages,
    parallelRunsByTabId,
    persistedMessages,
    runStatusEvents,
    taskRuns,
  };
}

test("records graph metadata when a parallel OpenCode run succeeds", async () => {
  const harness = createParallelRuntimeHarness({
    runCliStream: createAsyncRunCliStreamStub((handlers) => handlers.onExit(0)),
  });

  await harness.host.runPromptParallel(createPromptInput(), createTarget());

  assert.equal(harness.taskRuns.length, 1);
  assert.equal(harness.taskRuns[0]?.status, "end");
  assert.equal(harness.taskRuns[0]?.graphRunId, GRAPH_RUN_ID);
  assert.equal(harness.taskRuns[0]?.graphNodeId, GRAPH_NODE_ID);
  assert.equal(harness.taskRuns[0]?.loopTaskId, "loop-task-1");
  assert.equal(harness.runStatusEvents[0]?.status, "start");
  assert.equal(harness.runStatusEvents[0]?.options?.graphRunId, GRAPH_RUN_ID);
  assert.equal(harness.runStatusEvents[0]?.options?.graphNodeId, GRAPH_NODE_ID);
  assert.equal(harness.runStatusEvents.at(-1)?.status, "end");
  assert.deepEqual(harness.memoryPersistStatuses, ["end"]);
  assert.equal(harness.parallelRunsByTabId.has(TAB_ID), false);
});

test("rejects unsupported parallel runtime CLIs before starting a run", async () => {
  const harness = createParallelRuntimeHarness();

  await assert.rejects(
    harness.host.runPromptParallel(createPromptInput(), createTarget({ cli: "codex" })),
    /parallel-run-unsupported:codex/,
  );

  assert.deepEqual(harness.taskRuns, []);
  assert.deepEqual(harness.runStatusEvents, []);
  assert.equal(harness.parallelRunsByTabId.has(TAB_ID), false);
});

test("records graph metadata when a parallel OpenCode run fails without retry", async () => {
  const harness = createParallelRuntimeHarness({
    runCliStream: createAsyncRunCliStreamStub((handlers) => {
      handlers.onStderr("provider unavailable");
      handlers.onExit(1);
    }),
    parseOpenCodeRunOutput: () => ({
      finalText: null,
      errorText: null,
      statusText: null,
      hasStructuredFinalAnswer: false,
    }),
  });

  await harness.host.runPromptParallel(createPromptInput(), createTarget());

  assert.equal(harness.taskRuns.length, 1);
  assert.equal(harness.taskRuns[0]?.status, "error");
  assert.equal(harness.taskRuns[0]?.graphRunId, GRAPH_RUN_ID);
  assert.equal(harness.taskRuns[0]?.graphNodeId, GRAPH_NODE_ID);
  assert.equal(harness.taskRuns[0]?.loopSubtaskId, "loop-subtask-1");
  assert.equal(harness.runStatusEvents.at(-1)?.status, "error");
  assert.deepEqual(harness.memoryPersistStatuses, []);
  assert.equal(harness.parallelRunsByTabId.has(TAB_ID), false);
  assert.ok(harness.persistedMessages.at(-1)?.messages.some((message) => (
    message.role === "system" && message.content.includes("provider unavailable")
  )));
});
