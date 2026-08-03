import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

import type { CliName } from "../cli/types";
import type { CodexInteractiveRunner, CodexStreamHandlers } from "../interactive/codexRunner";
import type { InteractiveRunnerManager } from "../interactive/manager";
import type { TaskRunRecord, TaskRunStatus } from "../promptRunState";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../extensionHost/graphRuntime";
import type { InteractiveTabRun } from "../extensionHost/promptExecutionShared";

installVscodeMock();

const {
  createPromptInteractiveRuntimeHost,
} = require("../extensionHost/promptInteractiveRuntime") as typeof import("../extensionHost/promptInteractiveRuntime");

type PromptInteractiveRuntimeDeps = Parameters<typeof createPromptInteractiveRuntimeHost>[0];

type RunStatusEvent = {
  tabId: string;
  status: "start" | "end" | "error" | "stopped";
  message?: string;
  prompt?: string;
  graphRunId?: string;
  graphNodeId?: string;
};

type PersistedMessages = {
  cli: CliName;
  sessionId: string | null;
  tabId: string;
  messages: ChatMessage[];
};

type CodexRunBehavior = (prompt: string, handlers: CodexStreamHandlers) => Promise<void>;

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({ ...message }));
}

function createDeferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createInteractiveRuntimeHarness(options: {
  codexRunBehavior?: CodexRunBehavior;
  requireExplicitFinalAnswer?: boolean;
  autoCompactAfterRun?: boolean;
} = {}) {
  const activeRunsByTabId = new Map<string, InteractiveTabRun>();
  const messagesBySession = new Map<string, ChatMessage[]>();
  const pendingMessagesByTab = new Map<string, ChatMessage[]>();
  const panelMessages: Array<Record<string, unknown>> = [];
  const runStatusEvents: RunStatusEvent[] = [];
  const taskRecords: TaskRunRecord[] = [];
  const persistedMessages: PersistedMessages[] = [];
  const memoryPersistStatuses: TaskRunStatus[] = [];
  const preparedLabels: Array<{ cli: CliName; tabId: string; prompt: string }> = [];
  const adoptedSessions: Array<{ cli: CliName; sessionId: string; tabId?: string | null }> = [];
  const migratedSessions: Array<{ cli: CliName; localSessionId: string; targetSessionId: string }> = [];
  const mappingUpserts: Array<{ cli: CliName; sessionId: string; mappedId: string; freezePrevious?: string }> = [];
  const processTitles: Array<{ cli: CliName; sessionId: string }> = [];
  const codexPrompts: string[] = [];
  let idCounter = 0;
  let codexRunnerCreateCalls = 0;
  let claudeRunnerCreateCalls = 0;
  let codexStopCalls = 0;
  let codexThreadId: string | null = null;

  const codexRunner = {
    getThreadId: () => codexThreadId,
    runStreamed: async (prompt: string, handlers: CodexStreamHandlers): Promise<void> => {
      codexPrompts.push(prompt);
      await (options.codexRunBehavior ?? (async (_prompt, streamHandlers) => {
        codexThreadId = "thread-default";
        streamHandlers.onThreadId("thread-default");
        streamHandlers.onAssistantDelta("[final_answer] default", { codexFinalAnswer: true });
      }))(prompt, handlers);
    },
    stopAndRebuild: () => {
      codexStopCalls += 1;
    },
    dispose: () => undefined,
  } as unknown as CodexInteractiveRunner;

  const manager = {
    getCodexRunnerSelection: () => null,
    getOrCreateCodexRunner: () => {
      codexRunnerCreateCalls += 1;
      return codexRunner;
    },
    getOrCreateClaudeRunner: () => {
      claudeRunnerCreateCalls += 1;
      throw new Error("claude runner was not configured for this test");
    },
    setRunner: () => undefined,
  } as unknown as InteractiveRunnerManager;

  const getSessionMessages = (sessionId: string): ChatMessage[] => {
    const existing = messagesBySession.get(sessionId);
    if (existing) {
      return existing;
    }
    const next: ChatMessage[] = [];
    messagesBySession.set(sessionId, next);
    return next;
  };

  const deps: PromptInteractiveRuntimeDeps = {
    AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024,
    activeRunsByTabId,
    adoptSessionId: (cli, sessionId, tabId) => {
      adoptedSessions.push({ cli, sessionId, tabId });
    },
    applyProcessTitle: () => undefined,
    applyThinkingWorkspaceFiles: () => undefined,
    appendTaskRun: (record) => {
      taskRecords.push(record);
    },
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
    buildTaskRunCompletionText: (status, durationMs) => `completion:${status}:${durationMs ?? "none"}`,
    createMessageId: () => `msg-${++idCounter}`,
    getActiveConfigIdForCli: () => "config-main",
    getConversationTabById: () => ({ sessionId: null }),
    getEffectiveCliArgs: () => ["--effective"],
    getEffectiveThinkingMode: () => "medium",
    getGlobalMultiAgentEnabled: () => false,
    getPendingSessionDraft: (tabId) => {
      const existing = pendingMessagesByTab.get(tabId);
      if (existing) {
        return { messages: existing };
      }
      const next: ChatMessage[] = [];
      pendingMessagesByTab.set(tabId, next);
      return { messages: next };
    },
    getSelectedCliModel: () => "gpt-5.5",
    getWorkspaceInteractiveMode: () => "coding",
    getInteractiveRunnerManager: () => manager,
    loadSessionMessages: (_cli, sessionId) => getSessionMessages(sessionId),
    logCliStartup: () => undefined,
    maybeAutoCompactContextAfterPromptSuccess: async () => undefined,
    maybePersistLongTermMemoryFromRun: ({ status }) => {
      memoryPersistStatuses.push(status);
    },
    migrateLocalSessionToTargetSession: (cli, localSessionId, targetSessionId) => {
      migratedSessions.push({ cli, localSessionId, targetSessionId });
    },
    persistMessagesForTab: (cli, sessionId, tabId, messages) => {
      persistedMessages.push({ cli, sessionId, tabId, messages: cloneMessages(messages) });
    },
    preparePendingLabel: (cli, tabId, prompt) => {
      preparedLabels.push({ cli, tabId, prompt });
    },
    resolveClaudeInteractiveEntrypoint: () => undefined,
    resolveCodexInteractiveSelection: () => null,
    resolveInteractiveMappedId: () => null,
    resolveInteractiveSessionForResume: async (_cli, sessionId) => sessionId,
    resolveWorkspaceCwd: () => process.cwd(),
    sendPanelMessage: (payload) => {
      panelMessages.push(payload);
    },
    sendRunStatusForTab: (tabId, status, runOptions) => {
      runStatusEvents.push({ tabId, status, ...runOptions });
    },
    shouldAutoCompactContextAfterRunForTarget: () => options.autoCompactAfterRun === true,
    shouldRequireExplicitFinalAnswerForRun: () => options.requireExplicitFinalAnswer ?? true,
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    updateProcessTitle: (cli, sessionId) => {
      processTitles.push({ cli, sessionId });
    },
    upsertInteractiveMapping: (cli, sessionId, mappedId, upsertOptions) => {
      mappingUpserts.push({
        cli,
        sessionId,
        mappedId,
        freezePrevious: upsertOptions?.freezePrevious,
      });
    },
  };

  return {
    host: createPromptInteractiveRuntimeHost(deps),
    activeRunsByTabId,
    messagesBySession,
    panelMessages,
    runStatusEvents,
    taskRecords,
    persistedMessages,
    memoryPersistStatuses,
    preparedLabels,
    adoptedSessions,
    migratedSessions,
    mappingUpserts,
    processTitles,
    codexPrompts,
    get codexRunnerCreateCalls() {
      return codexRunnerCreateCalls;
    },
    get claudeRunnerCreateCalls() {
      return claudeRunnerCreateCalls;
    },
    get codexStopCalls() {
      return codexStopCalls;
    },
    setCodexThreadId(threadId: string | null) {
      codexThreadId = threadId;
    },
  };
}

function createPromptInput(overrides: Partial<PromptRunInput> = {}): PromptRunInput {
  return {
    displayPrompt: "run interactive task",
    modelPrompt: "run interactive task",
    contextTags: ["ctx"],
    graphRunId: "graph-run-1",
    graphNodeId: "node-1",
    ...overrides,
  };
}

function createTarget(overrides: Partial<PromptRunTarget> = {}): PromptRunTarget {
  return {
    tabId: "tab-1",
    cli: "codex",
    sessionId: "session-1",
    ...overrides,
  };
}

test("interactive runtime host keeps empty prompts inside its boundary", async () => {
  const harness = createInteractiveRuntimeHarness({
    codexRunBehavior: async () => {
      throw new Error("runner should not start for empty prompts");
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({ displayPrompt: "", modelPrompt: "", contextTags: ["ignored"] }),
    createTarget({ tabId: "tab-empty", sessionId: "session-empty" }),
  );

  assert.equal(harness.codexRunnerCreateCalls, 0);
  assert.deepEqual(harness.runStatusEvents, []);
  assert.equal(harness.activeRunsByTabId.size, 0);
  assert.deepEqual(harness.persistedMessages, []);
});

test("interactive runtime host completes a successful Codex runner turn", async () => {
  const harness = createInteractiveRuntimeHarness({
    codexRunBehavior: async (_prompt, handlers) => {
      harness.setCodexThreadId("thread-success");
      handlers.onThreadId("thread-success");
      handlers.onTrace("thinking trace", "thinking");
      handlers.onEvent?.({ type: "codex.lifecycle", event: "turn_started" });
      handlers.onTaskListUpdate([{ text: "inspect runtime", done: false }]);
      handlers.onAssistantDelta("[final_answer] completed", { codexFinalAnswer: true });
    },
  });

  await harness.host.runPromptInteractive(createPromptInput(), createTarget());

  const messages = harness.messagesBySession.get("session-1") ?? [];
  const finalMessage = messages.find((message) => message.role === "assistant" && message.codexFinalAnswer === true);
  assert.ok(finalMessage);
  assert.equal(finalMessage.content, "[final_answer] completed");
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "end"]);
  assert.equal(harness.runStatusEvents[0]?.graphRunId, "graph-run-1");
  assert.equal(harness.runStatusEvents[0]?.graphNodeId, "node-1");
  assert.deepEqual(harness.taskRecords.map((record) => record.status), ["end"]);
  assert.deepEqual(harness.memoryPersistStatuses, ["end"]);
  assert.equal(harness.activeRunsByTabId.size, 0);
  assert.ok(harness.persistedMessages.some((item) => item.sessionId === "session-1" && item.messages.some((message) => message.id === finalMessage.id)));
  assert.ok(harness.panelMessages.some((message) => message.type === "rawStreamDelta" && message.stream === "event"));
  assert.ok(harness.panelMessages.some((message) => message.type === "taskListUpdate" && message.tabId === "tab-1"));
  assert.equal(harness.mappingUpserts.length, 1);
  assert.deepEqual(
    {
      cli: harness.mappingUpserts[0]?.cli,
      sessionId: harness.mappingUpserts[0]?.sessionId,
      mappedId: harness.mappingUpserts[0]?.mappedId,
    },
    { cli: "codex", sessionId: "session-1", mappedId: "thread-success" },
  );
  assert.deepEqual(harness.processTitles, [{ cli: "codex", sessionId: "thread-success" }]);
});

test("interactive runtime host finalizes runner failures", async () => {
  const spawnError = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
  const harness = createInteractiveRuntimeHarness({
    codexRunBehavior: async () => {
      throw spawnError;
    },
  });

  await assert.rejects(
    harness.host.runPromptInteractive(
      createPromptInput({ displayPrompt: "fail interactive", modelPrompt: "fail interactive" }),
      createTarget({ tabId: "tab-error", sessionId: "session-error" }),
    ),
    /spawn codex ENOENT/,
  );

  const messages = harness.messagesBySession.get("session-error") ?? [];
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "error"]);
  assert.deepEqual(harness.taskRecords.map((record) => record.status), ["error"]);
  assert.deepEqual(harness.memoryPersistStatuses, ["error"]);
  assert.equal(harness.activeRunsByTabId.size, 0);
  assert.ok(messages.some((message) => message.role === "system" && message.content.includes("spawn codex ENOENT")));
  assert.ok(harness.persistedMessages.some((item) => item.sessionId === "session-error"));
});

test("interactive runtime host stops an active runner and persists the stopped turn", async () => {
  const runStarted = createDeferred();
  const runnerReleased = createDeferred();
  const harness = createInteractiveRuntimeHarness({
    codexRunBehavior: async () => {
      runStarted.resolve();
      await runnerReleased.promise;
    },
  });

  const runPromise = harness.host.runPromptInteractive(
    createPromptInput({ displayPrompt: "stop interactive", modelPrompt: "stop interactive" }),
    createTarget({ tabId: "tab-stop", sessionId: "session-stop" }),
  );
  await runStarted.promise;

  const activeRun = harness.activeRunsByTabId.get("tab-stop");
  assert.ok(activeRun);
  activeRun.stop();
  runnerReleased.resolve();
  await runPromise;

  const messages = harness.messagesBySession.get("session-stop") ?? [];
  assert.equal(harness.codexStopCalls, 1);
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "stopped"]);
  assert.deepEqual(harness.taskRecords.map((record) => record.status), ["stopped"]);
  assert.deepEqual(harness.memoryPersistStatuses, []);
  assert.equal(harness.activeRunsByTabId.size, 0);
  assert.ok(messages.some((message) => message.role === "system" && message.content === "run.stoppedByUser"));
  assert.ok(harness.persistedMessages.some((item) => item.sessionId === "session-stop" && item.messages.some((message) => message.content === "run.stoppedByUser")));
});
