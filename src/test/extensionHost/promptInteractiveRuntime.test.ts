import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

import type { CliName } from "../../cli/types";
import type { CodexInteractiveRunner, CodexStreamHandlers } from "../../interactive/codexRunner";
import type { ClaudeStreamHandlers } from "../../interactive/claudeRunner";
import type { InteractiveRunnerManager } from "../../interactive/manager";
import type { TaskRunRecord, TaskRunStatus } from "../../promptRunState";
import type { ChatMessage } from "../../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import type { InteractiveTabRun } from "../../extensionHost/promptExecutionShared";
import type { HumanInteractionRequest, HumanInteractionSubmission } from "../../humanInteraction";

installVscodeMock();

const {
  createPromptInteractiveRuntimeHost,
} = require("../../extensionHost/promptInteractiveRuntime") as typeof import("../../extensionHost/promptInteractiveRuntime");

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
type ClaudeRunBehavior = (prompt: string, handlers: ClaudeStreamHandlers) => Promise<void>;

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
  claudeRunBehavior?: ClaudeRunBehavior;
  requireExplicitFinalAnswer?: boolean;
  autoCompactAfterRun?: boolean;
  humanInteractionEnabled?: boolean;
  humanInteractionSubmission?: HumanInteractionSubmission | ((request: HumanInteractionRequest) => Promise<HumanInteractionSubmission> | HumanInteractionSubmission);
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
  const humanInteractionRequests: HumanInteractionRequest[] = [];
  const canceledHumanInteractionTabs: Array<{ tabId: string; statusText?: string }> = [];
  let idCounter = 0;
  let codexRunnerCreateCalls = 0;
  let claudeRunnerCreateCalls = 0;
  let codexStopCalls = 0;
  let claudeStopCalls = 0;
  let codexThreadId: string | null = null;
  let claudeSessionId: string | null = null;

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

  const claudeRunner = {
    getSessionId: () => claudeSessionId,
    updateSessionId: (sessionId: string) => {
      claudeSessionId = sessionId;
    },
    runStreamed: async (prompt: string, handlers: ClaudeStreamHandlers): Promise<void> => {
      await (options.claudeRunBehavior ?? (async (_prompt, streamHandlers) => {
        claudeSessionId = "claude-session-default";
        streamHandlers.onSessionId("claude-session-default");
        streamHandlers.onAssistantDelta("[final_answer] default");
      }))(prompt, handlers);
    },
    stopAndRebuild: () => {
      claudeStopCalls += 1;
    },
    dispose: () => undefined,
  };

  const manager = {
    getCodexRunnerSelection: () => null,
    hasCodexRunner: () => false,
    getOrCreateCodexRunner: () => {
      codexRunnerCreateCalls += 1;
      return codexRunner;
    },
    getOrCreateClaudeRunner: () => {
      claudeRunnerCreateCalls += 1;
      return claudeRunner;
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
    getGlobalHumanInteractionEnabled: () => options.humanInteractionEnabled !== false,
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
    requestHumanInteraction: async (request) => {
      humanInteractionRequests.push(request);
      if (typeof options.humanInteractionSubmission === "function") {
        return options.humanInteractionSubmission(request);
      }
      return options.humanInteractionSubmission ?? {
        interactionId: request.interactionId,
        tabId: request.tabId,
        status: "completed",
        values: {},
      };
    },
    cancelHumanInteractionForTab: (tabId, statusText) => {
      canceledHumanInteractionTabs.push({ tabId, statusText });
    },
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
    humanInteractionRequests,
    canceledHumanInteractionTabs,
    get codexRunnerCreateCalls() {
      return codexRunnerCreateCalls;
    },
    get claudeRunnerCreateCalls() {
      return claudeRunnerCreateCalls;
    },
    get codexStopCalls() {
      return codexStopCalls;
    },
    get claudeStopCalls() {
      return claudeStopCalls;
    },
    setCodexThreadId(threadId: string | null) {
      codexThreadId = threadId;
    },
    setClaudeSessionId(sessionId: string | null) {
      claudeSessionId = sessionId;
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
      assert.equal(handlers.requestUserInputEnabled, false);
      harness.setCodexThreadId("thread-success");
      handlers.onThreadId("thread-success");
      handlers.onTrace("thinking trace", "thinking");
      handlers.onEvent?.({ type: "codex.lifecycle", event: "turn_started" });
      handlers.onTaskListUpdate([{ text: "inspect runtime", done: false }]);
      handlers.onTokenUsageUpdate?.({
        tokensInContextWindow: 12345,
        modelContextWindow: 272000,
        threadId: "thread-success",
      });
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
  assert.ok(harness.panelMessages.some((message) => (
    message.type === "contextTokenUsage"
    && message.tabId === "tab-1"
    && message.tokensInContextWindow === 12345
    && message.modelContextWindow === 272000
  )));
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

test("interactive runtime host enables Codex default-mode user input for Vibe runs", async () => {
  const harness = createInteractiveRuntimeHarness({
    codexRunBehavior: async (_prompt, handlers) => {
      assert.equal(handlers.requestUserInputEnabled, true);
      harness.setCodexThreadId("thread-human-input");
      handlers.onThreadId("thread-human-input");
      handlers.onAssistantDelta("[final_answer] completed", { codexFinalAnswer: true });
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({ graphRunId: undefined, graphNodeId: undefined }),
    createTarget({ tabId: "tab-human-input", sessionId: "session-human-input" }),
  );

  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "end"]);
});

test("interactive runtime host keeps Codex user input disabled when the global form is off", async () => {
  const harness = createInteractiveRuntimeHarness({
    humanInteractionEnabled: false,
    codexRunBehavior: async (_prompt, handlers) => {
      assert.equal(handlers.requestUserInputEnabled, false);
      harness.setCodexThreadId("thread-human-input-off");
      handlers.onThreadId("thread-human-input-off");
      handlers.onAssistantDelta("[final_answer] completed", { codexFinalAnswer: true });
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({ graphRunId: undefined, graphNodeId: undefined }),
    createTarget({ tabId: "tab-human-input-off", sessionId: "session-human-input-off" }),
  );

  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "end"]);
});

test("interactive runtime host retries Codex completion-like text without an explicit final signal", async () => {
  const harness = createInteractiveRuntimeHarness({
    codexRunBehavior: async (_prompt, handlers) => {
      harness.setCodexThreadId("thread-grok-final");
      handlers.onThreadId("thread-grok-final");
      handlers.onAssistantDelta("已定位到工坊本体卡片和设计文档，接下来核对属性配置的真实字段与用途。");
      handlers.onTrace("exec rg ontology");
      handlers.onAssistantDelta([
        "已完成本体属性配置的全面核对。",
        "",
        "## 补",
        "- 属性面板字段已全部支持。",
        "",
        "**结论**：本体属性配置已齐全，无需调整。",
      ].join("\n"));
    },
  });

  const runPromise = harness.host.runPromptInteractive(
    createPromptInput({ graphRunId: undefined, graphNodeId: undefined }),
    createTarget({ tabId: "tab-grok-final", sessionId: "session-grok-final" }),
  );
  const messages = await waitForSessionMessage(
    () => harness.messagesBySession.get("session-grok-final") ?? [],
    (message) => String(message.content).includes("run.missingFinalConclusionRetryReason"),
  );
  harness.activeRunsByTabId.get("tab-grok-final")?.stop();
  await runPromise;

  assert.equal(harness.codexPrompts.length, 1);
  assert.equal(harness.runStatusEvents.some((event) => event.status === "end"), false);
  assert.ok(messages.some((message) => (
    message.role === "assistant"
    && !message.codexFinalAnswer
    && String(message.content).includes("**结论**：本体属性配置已齐全")
  )));
});

async function waitForSessionMessage(
  getMessages: () => ChatMessage[],
  predicate: (message: ChatMessage) => boolean,
  timeoutMs = 1000,
): Promise<ChatMessage[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const messages = getMessages();
    if (messages.some(predicate)) {
      return messages;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for session message");
}

test("interactive runtime host retries Codex thinking-only completed turns without a final-answer bubble", async () => {
  const harness = createInteractiveRuntimeHarness({
    codexRunBehavior: async (_prompt, handlers) => {
      harness.setCodexThreadId("thread-grok-thinking");
      handlers.onThreadId("thread-grok-thinking");
      handlers.onTrace("The abort on cleanup of fetch effects is expected with StrictMode. Let me look at the screenshot.", "thinking");
      handlers.onTurnCompleted?.({
        threadId: "thread-grok-thinking",
        turnId: "turn-grok-thinking",
        status: "completed",
      });
    },
  });

  const runPromise = harness.host.runPromptInteractive(
    createPromptInput({ graphRunId: undefined, graphNodeId: undefined }),
    createTarget({ tabId: "tab-grok-thinking", sessionId: "session-grok-thinking" }),
  );
  const messages = await waitForSessionMessage(
    () => harness.messagesBySession.get("session-grok-thinking") ?? [],
    (message) => String(message.content).includes("run.missingFinalConclusionRetryReason"),
  );
  harness.activeRunsByTabId.get("tab-grok-thinking")?.stop();
  await runPromise;

  assert.equal(harness.codexPrompts.length, 1);
  assert.equal(harness.runStatusEvents.some((event) => event.status === "end"), false);
  assert.ok(messages.some((message) => (
    message.role === "assistant"
    && message.kind === "thinking"
    && String(message.content).includes("abort on cleanup of fetch effects")
  )));
});

test("interactive runtime host retries Codex commentary completed turns without a final-answer bubble", async () => {
  const harness = createInteractiveRuntimeHarness({
    codexRunBehavior: async (_prompt, handlers) => {
      harness.setCodexThreadId("thread-glm-final");
      handlers.onThreadId("thread-glm-final");
      handlers.onAssistantDelta("Hi! 我在这里，随时可以帮你处理这个工作区的任务。");
      handlers.onTurnCompleted?.({
        threadId: "thread-glm-final",
        turnId: "turn-glm-final",
        status: "completed",
      });
    },
  });

  const runPromise = harness.host.runPromptInteractive(
    createPromptInput({ graphRunId: undefined, graphNodeId: undefined }),
    createTarget({ tabId: "tab-glm-final", sessionId: "session-glm-final" }),
  );
  const messages = await waitForSessionMessage(
    () => harness.messagesBySession.get("session-glm-final") ?? [],
    (message) => String(message.content).includes("run.missingFinalConclusionRetryReason"),
  );
  harness.activeRunsByTabId.get("tab-glm-final")?.stop();
  await runPromise;

  assert.equal(harness.codexPrompts.length, 1);
  assert.equal(harness.runStatusEvents.some((event) => event.status === "end"), false);
  assert.ok(messages.some((message) => (
    message.role === "assistant"
    && !message.codexFinalAnswer
    && String(message.content).includes("随时可以帮你处理这个工作区的任务")
  )));
});

test("interactive runtime host submits Codex human interaction answers in Vibe mode", async () => {
  const submittedValues = {
    scope: "当前 Webview",
    density: "提高信息密度",
    validation: "桌面与移动端",
  };
  const harness = createInteractiveRuntimeHarness({
    humanInteractionSubmission: {
      interactionId: "ask-1",
      tabId: "tab-human",
      status: "completed",
      values: submittedValues,
    },
    codexRunBehavior: async (_prompt, handlers) => {
      harness.setCodexThreadId("thread-human");
      handlers.onThreadId("thread-human");
      const resolution = await handlers.onRequest?.({
        method: "item/tool/requestUserInput",
        params: {
          id: "ask-1",
          title: "Need context",
          question: "Choose the implementation details.",
          fields: [
            { id: "scope", label: "Scope", type: "text", required: true },
            { id: "density", label: "Density", type: "text", required: true },
            { id: "validation", label: "Validation", type: "text", required: true },
          ],
        },
      });
      assert.deepEqual(resolution?.result, {
        answers: {
          scope: { answers: [submittedValues.scope] },
          density: { answers: [submittedValues.density] },
          validation: { answers: [submittedValues.validation] },
        },
      });
      handlers.onAssistantDelta("[final_answer] continued", { codexFinalAnswer: true });
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({
      displayPrompt: "needs human context",
      modelPrompt: "needs human context",
      graphRunId: undefined,
      graphNodeId: undefined,
    }),
    createTarget({ tabId: "tab-human", sessionId: "session-human" }),
  );

  const messages = harness.messagesBySession.get("session-human") ?? [];
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.equal(harness.humanInteractionRequests[0]?.title, "Need context");
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "end"]);
  assert.ok(messages.some((message) => message.role === "system" && message.content === "run.humanInteractionWaiting"));
  const submittedMessage = messages.find((message) => message.role === "user" && message.content.includes("已提交补充信息"));
  assert.ok(submittedMessage);
  assert.match(submittedMessage.content, /Scope：当前 Webview/u);
  assert.match(submittedMessage.content, /Density：提高信息密度/u);
  assert.match(submittedMessage.content, /Validation：桌面与移动端/u);
  assert.ok(messages.some((message) => message.role === "assistant" && message.content === "[final_answer] continued"));
});

test("interactive runtime host converts explicit natural clarification replies into human interaction forms", async () => {
  let runCount = 0;
  const harness = createInteractiveRuntimeHarness({
    humanInteractionSubmission: (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {
        answer_1: "秋天",
        answer_2: "古风",
      },
    }),
    codexRunBehavior: async (prompt, handlers) => {
      runCount += 1;
      harness.setCodexThreadId("thread-natural-human");
      handlers.onThreadId("thread-natural-human");
      if (runCount === 1) {
        assert.match(prompt, /Human interaction requirement for Vibe tasks/);
        handlers.onAssistantDelta([
          "[final_answer] 可以。请先回答：",
          "1. 主题是什么？",
          "2. 希望什么风格？",
        ].join("\n"), { codexFinalAnswer: true });
        return;
      }
      assert.match(prompt, /已提交补充信息/);
      assert.match(prompt, /主题是什么？：秋天/);
      assert.match(prompt, /希望什么风格？：古风/);
      handlers.onAssistantDelta("[final_answer] 秋风入纸，古意成诗。", { codexFinalAnswer: true });
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({
      displayPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
      modelPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
      graphRunId: undefined,
      graphNodeId: undefined,
    }),
    createTarget({ tabId: "tab-natural-human", sessionId: "session-natural-human" }),
  );

  const messages = harness.messagesBySession.get("session-natural-human") ?? [];
  assert.equal(runCount, 2);
  assert.equal(harness.codexPrompts.length, 2);
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.deepEqual(
    harness.humanInteractionRequests[0]?.formFields.map((field) => field.label),
    ["主题是什么？", "希望什么风格？"],
  );
  assert.ok(harness.panelMessages.some((message) => message.type === "removeMessage" && message.tabId === "tab-natural-human"));
  assert.ok(messages.some((message) => message.role === "system" && message.content === "run.humanInteractionWaiting"));
  assert.ok(messages.some((message) => message.role === "user" && message.content.includes("主题是什么？：秋天")));
  assert.ok(messages.some((message) => message.role === "assistant" && message.content === "[final_answer] 秋风入纸，古意成诗。"));
  assert.equal(messages.some((message) => message.role === "assistant" && message.content.includes("请先回答")), false);
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "end"]);
});

test("interactive runtime host converts Claude natural clarification replies into human interaction forms", async () => {
  let runCount = 0;
  const harness = createInteractiveRuntimeHarness({
    humanInteractionSubmission: (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {
        answer_1: "秋天",
        answer_2: "古风",
      },
    }),
    claudeRunBehavior: async (prompt, handlers) => {
      runCount += 1;
      harness.setClaudeSessionId("claude-natural-human");
      handlers.onSessionId("claude-natural-human");
      if (runCount === 1) {
        assert.match(prompt, /Human interaction requirement for Vibe tasks/);
        handlers.onAssistantDelta([
          "[final_answer] 可以。请先回答：",
          "1. 主题是什么？",
          "2. 希望什么风格？",
        ].join("\n"));
        return;
      }
      assert.match(prompt, /已提交补充信息/);
      assert.match(prompt, /主题是什么？：秋天/);
      assert.match(prompt, /希望什么风格？：古风/);
      handlers.onAssistantDelta("[final_answer] 秋风入纸，古意成诗。");
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({
      displayPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
      modelPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
      graphRunId: undefined,
      graphNodeId: undefined,
    }),
    createTarget({ cli: "claude", tabId: "tab-claude-natural-human", sessionId: "session-claude-natural-human" }),
  );

  const messages = harness.messagesBySession.get("session-claude-natural-human") ?? [];
  assert.equal(runCount, 2);
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.deepEqual(
    harness.humanInteractionRequests[0]?.formFields.map((field) => field.label),
    ["主题是什么？", "希望什么风格？"],
  );
  assert.ok(harness.panelMessages.some((message) => message.type === "removeMessage" && message.tabId === "tab-claude-natural-human"));
  assert.ok(messages.some((message) => message.role === "system" && message.content === "run.humanInteractionWaiting"));
  assert.ok(messages.some((message) => message.role === "user" && message.content.includes("主题是什么？：秋天")));
  assert.ok(messages.some((message) => message.role === "assistant" && message.content === "[final_answer] 秋风入纸，古意成诗。"));
  assert.equal(messages.some((message) => message.role === "assistant" && message.content.includes("请先回答")), false);
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "end"]);
});

test("interactive runtime host preserves lettered natural clarification options", async () => {
  let runCount = 0;
  const harness = createInteractiveRuntimeHarness({
    humanInteractionSubmission: (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {
        answer_1: "自然 / 四季",
        answer_2: "温柔治愈",
      },
    }),
    codexRunBehavior: async (prompt, handlers) => {
      runCount += 1;
      harness.setCodexThreadId("thread-natural-options");
      handlers.onThreadId("thread-natural-options");
      if (runCount === 1) {
        handlers.onAssistantDelta([
          "[final_answer] 可以。你按下面格式回复选项即可，比如：1A 2C。",
          "1. **主题想写什么？**",
          "A. 爱情 / 思念",
          "B. 人生 / 成长",
          "C. 自然 / 四季",
          "2. **情绪基调？** A. 温柔治愈 B. 孤独克制 C. 热烈浪漫",
        ].join("\n"), { codexFinalAnswer: true });
        return;
      }
      assert.match(prompt, /主题想写什么？：自然 \/ 四季/);
      assert.match(prompt, /情绪基调？：温柔治愈/);
      handlers.onAssistantDelta("[final_answer] 春风拂过四季。", { codexFinalAnswer: true });
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({
      displayPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
      modelPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
      graphRunId: undefined,
      graphNodeId: undefined,
    }),
    createTarget({ tabId: "tab-natural-options", sessionId: "session-natural-options" }),
  );

  assert.equal(runCount, 2);
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.deepEqual(
    harness.humanInteractionRequests[0]?.formFields.map((field) => ({
      label: field.label,
      type: field.type,
      options: field.options?.map((option) => option.label) ?? [],
    })),
    [
      {
        label: "主题想写什么？",
        type: "radio",
        options: ["爱情 / 思念", "人生 / 成长", "自然 / 四季"],
      },
      {
        label: "情绪基调？",
        type: "radio",
        options: ["温柔治愈", "孤独克制", "热烈浪漫"],
      },
    ],
  );
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "end"]);
});

test("interactive runtime host stops when natural-language human interaction is rejected", async () => {
  let runCount = 0;
  const harness = createInteractiveRuntimeHarness({
    humanInteractionSubmission: (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "aborted",
      values: {},
    }),
    codexRunBehavior: async (_prompt, handlers) => {
      runCount += 1;
      harness.setCodexThreadId("thread-natural-stop");
      handlers.onThreadId("thread-natural-stop");
      handlers.onAssistantDelta([
        "[final_answer] 可以。请先回答：",
        "1. 主题是什么？",
        "2. 希望什么风格？",
      ].join("\n"), { codexFinalAnswer: true });
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({
      displayPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
      modelPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
      graphRunId: undefined,
      graphNodeId: undefined,
    }),
    createTarget({ tabId: "tab-natural-stop", sessionId: "session-natural-stop" }),
  );

  const messages = harness.messagesBySession.get("session-natural-stop") ?? [];
  assert.equal(runCount, 1);
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "stopped"]);
  assert.deepEqual(harness.taskRecords.map((record) => record.status), ["stopped"]);
  assert.deepEqual(harness.memoryPersistStatuses, ["stopped"]);
  assert.equal(harness.canceledHumanInteractionTabs.length, 1);
  assert.ok(messages.some((message) => message.role === "user" && message.content === "用户已拒绝补充信息。"));
  assert.ok(messages.some((message) => message.role === "system" && message.content === "run.humanInteractionRejected"));
  assert.equal(messages.some((message) => message.role === "assistant" && message.content.includes("请先回答")), false);
});

test("interactive runtime host stops when Codex human interaction is rejected", async () => {
  const harness = createInteractiveRuntimeHarness({
    humanInteractionSubmission: {
      interactionId: "ask-stop",
      tabId: "tab-human-stop",
      status: "aborted",
      values: {},
    },
    codexRunBehavior: async (_prompt, handlers) => {
      harness.setCodexThreadId("thread-human-stop");
      handlers.onThreadId("thread-human-stop");
      await handlers.onRequest?.({
        method: "mcpServer/elicitation/request",
        params: {
          id: "ask-stop",
          title: "Need decision",
          message: "Should this continue?",
          fields: [{ id: "decision", label: "Decision", type: "textarea", required: true }],
        },
      });
      handlers.onAssistantDelta("[final_answer] should not render", { codexFinalAnswer: true });
    },
  });

  await harness.host.runPromptInteractive(
    createPromptInput({
      displayPrompt: "reject human context",
      modelPrompt: "reject human context",
      graphRunId: undefined,
      graphNodeId: undefined,
    }),
    createTarget({ tabId: "tab-human-stop", sessionId: "session-human-stop" }),
  );

  const messages = harness.messagesBySession.get("session-human-stop") ?? [];
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.deepEqual(harness.runStatusEvents.map((event) => event.status), ["start", "stopped"]);
  assert.deepEqual(harness.taskRecords.map((record) => record.status), ["stopped"]);
  assert.deepEqual(harness.memoryPersistStatuses, ["stopped"]);
  assert.equal(harness.canceledHumanInteractionTabs.length, 1);
  assert.ok(messages.some((message) => message.role === "user" && message.content === "用户已拒绝补充信息。"));
  assert.ok(messages.some((message) => message.role === "system" && message.content === "run.humanInteractionRejected"));
  assert.equal(messages.some((message) => message.content === "[final_answer] should not render"), false);
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
