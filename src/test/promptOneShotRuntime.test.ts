import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

import type { RunProcess } from "../cli/commandRunner";
import type { TaskRunDraft, TaskRunStatus } from "../promptRunState";
import type { ChatMessage } from "../webview/types";

installVscodeMock();

const commandRunner = require("../cli/commandRunner") as typeof import("../cli/commandRunner");
const {
  createPromptOneShotRuntimeHost,
} = require("../extensionHost/promptOneShotRuntime") as typeof import("../extensionHost/promptOneShotRuntime");

type PromptOneShotRuntimeDeps = Parameters<typeof createPromptOneShotRuntimeHost>[0];
type RunCliStream = typeof commandRunner.runCliStream;
type RunCliStreamHandlers = Parameters<RunCliStream>[2];

type RunStatusEvent = {
  status: "start" | "end" | "error" | "stopped";
  message?: string;
};

function withRunCliStreamStub<T>(
  stub: RunCliStream,
  callback: () => Promise<T>,
): Promise<T> {
  const mutableCommandRunner = commandRunner as typeof commandRunner & { runCliStream: RunCliStream };
  const originalRunCliStream = mutableCommandRunner.runCliStream;
  mutableCommandRunner.runCliStream = stub;
  return callback().finally(() => {
    mutableCommandRunner.runCliStream = originalRunCliStream;
  });
}

function createAsyncRunCliStreamStub(
  emit: (handlers: RunCliStreamHandlers) => void,
  killed: boolean[] = [],
): RunCliStream {
  return ((_cli, _prompt, handlers) => {
    const processHandle: RunProcess = {
      kill: () => {
        killed.push(true);
        return true;
      },
    };
    setImmediate(() => emit(handlers));
    return processHandle;
  }) as RunCliStream;
}

function createOneShotRuntimeHarness() {
  const messages: ChatMessage[] = [];
  const pendingMessagesByTab = new Map<string, ChatMessage[]>();
  const panelMessages: Array<Record<string, unknown>> = [];
  const statusEvents: RunStatusEvent[] = [];
  const completionStatuses: TaskRunStatus[] = [];
  const systemMessages: string[] = [];
  const assistantChunks: string[] = [];
  const shownCommandErrors: string[] = [];
  const memoryPersistStatuses: TaskRunStatus[] = [];
  const rawStreamDeltas: Array<{ content: unknown; stream?: string }> = [];
  let activeRunId: string | undefined;
  let activeTaskRun: TaskRunDraft | null = null;
  let activeMessageTarget: ChatMessage[] | null = null;
  let idCounter = 0;
  let prepareRuntimeCalls = 0;

  const appendAssistantChunkToActiveTarget = (chunk: string, kind?: ChatMessage["kind"]): void => {
    assistantChunks.push(chunk);
    if (!activeMessageTarget) {
      return;
    }
    const last = activeMessageTarget[activeMessageTarget.length - 1];
    if (!last || last.role !== "assistant" || last.kind !== kind) {
      const assistantMessage: ChatMessage = {
        id: `assistant-${++idCounter}`,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        ...(kind ? { kind } : {}),
      };
      activeMessageTarget.push(assistantMessage);
      panelMessages.push({ type: "appendMessage", message: assistantMessage });
    }
    const current = activeMessageTarget[activeMessageTarget.length - 1];
    if (current) {
      current.content += chunk;
    }
  };

  const deps: PromptOneShotRuntimeDeps = {
    AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024 * 1024,
    adoptFreshOpenCodeLoopRecoverySession: ({ messageTarget }) => messageTarget,
    appendAssistantChunk: appendAssistantChunkToActiveTarget,
    appendCompletionMessage: (status) => {
      completionStatuses.push(status);
    },
    appendMessageToStore: (target, message) => {
      target.push(message);
    },
    appendSystemMessage: (content) => {
      systemMessages.push(content);
      if (activeMessageTarget) {
        activeMessageTarget.push({
          id: `system-${++idCounter}`,
          role: "system",
          content,
          createdAt: Date.now(),
        });
      }
    },
    appendTraceLines: () => undefined,
    appendTraceMessage: (content) => {
      panelMessages.push({ type: "trace", content });
    },
    applyProcessTitle: () => undefined,
    applyThinkingWorkspaceFiles: () => undefined,
    buildOpenCodeFailureMessage: (output, fallbackMessage) => output.errorText ?? fallbackMessage,
    buildOpenCodeMissingFinalConclusionMessage: () => "missing final conclusion",
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
    captureSessionFromBuffer: () => undefined,
    clearActiveRun: () => {
      activeRunId = undefined;
      activeTaskRun = null;
      activeMessageTarget = null;
    },
    createDisabledOpenCodeSubagentMonitor: () => ({
      setParentSessionId: () => undefined,
      pollNow: async () => undefined,
      finish: () => undefined,
      dispose: () => undefined,
    }),
    createMessageId: () => `msg-${++idCounter}`,
    flushTraceBuffer: () => undefined,
    getActiveRunId: () => activeRunId,
    getActiveTaskRun: () => activeTaskRun,
    getEffectiveThinkingMode: () => "medium",
    getPendingSessionDraft: (tabId) => {
      if (!pendingMessagesByTab.has(tabId)) {
        pendingMessagesByTab.set(tabId, messages);
      }
      return { messages: pendingMessagesByTab.get(tabId) ?? messages };
    },
    killActiveProcess: () => undefined,
    loadSessionMessages: () => messages,
    logCliStartup: () => undefined,
    maybeAutoCompactContextAfterPromptSuccess: async () => undefined,
    maybePersistLongTermMemoryFromRun: ({ status }) => {
      memoryPersistStatuses.push(status);
    },
    persistActiveMessages: () => undefined,
    prepareOpenCodeRuntime: async () => {
      prepareRuntimeCalls += 1;
      const model = "packyapi/claude-sonnet-5";
      return {
        envOverrides: {},
        configContent: JSON.stringify({
          model,
          provider: { packyapi: { models: { "claude-sonnet-5": {} } } },
        }),
        role: "main",
        mainModel: model,
        subtaskModel: null,
        effectiveModel: model,
        mainVariant: null,
        subtaskVariant: null,
        effectiveVariant: null,
        modelFallback: "none",
        primaryModel: model,
        smallModel: null,
        primaryVariant: null,
        smallVariant: null,
      };
    },
    prepareOpenCodeSubagentRuntime: async () => ({
      connection: null,
      endpointSource: "unavailable",
      error: null,
      dispose: () => undefined,
    }),
    preparePendingLabel: () => undefined,
    resetActiveAssistantMessage: () => undefined,
    resetTraceState: () => undefined,
    resolveCliSessionIdForResume: (_cli, sessionId) => sessionId,
    resolveWorkspaceCwd: () => process.cwd(),
    sendOpenCodeTaskListUpdate: (items, options) => {
      panelMessages.push({ type: "taskListUpdate", items, source: options.source });
    },
    sendPanelMessage: (payload) => {
      panelMessages.push(payload);
    },
    sendRawStreamDelta: (content, options) => {
      rawStreamDeltas.push({ content, stream: options?.stream });
    },
    sendRunStatus: (status, message) => {
      statusEvents.push({ status, message });
    },
    setActiveCliForRun: () => undefined,
    setActiveMessageTarget: (target) => {
      activeMessageTarget = target;
    },
    setActiveProcess: () => undefined,
    setActiveRunId: (runId) => {
      activeRunId = runId;
    },
    setActiveSessionId: () => undefined,
    setActiveTabIdForRun: () => undefined,
    shouldAutoCompactContextAfterRunForTarget: () => false,
    shouldRequireExplicitFinalAnswerForRun: () => false,
    showCliCommandNotFoundError: (message) => {
      shownCommandErrors.push(message);
    },
    startTaskRun: (runId, cli, sessionId, prompt, options) => {
      activeTaskRun = {
        id: runId,
        cli,
        sessionId,
        prompt,
        startedAt: Date.now(),
        ...options,
      };
    },
    startTraceMessage: () => undefined,
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    updateSessionBuffer: (buffer, chunk) => `${buffer}${chunk}`,
  };

  return {
    host: createPromptOneShotRuntimeHost(deps),
    messages,
    panelMessages,
    statusEvents,
    completionStatuses,
    systemMessages,
    assistantChunks,
    shownCommandErrors,
    memoryPersistStatuses,
    rawStreamDeltas,
    get activeRunId() {
      return activeRunId;
    },
    get prepareRuntimeCalls() {
      return prepareRuntimeCalls;
    },
  };
}

test("one-shot runtime host completes a successful OpenCode run", async () => {
  const harness = createOneShotRuntimeHarness();
  const stdout = `${JSON.stringify({
    type: "text",
    sessionID: "ses_success",
    part: { type: "text", text: "[final_answer] completed" },
  })}\n`;

  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    handlers.onStdout(stdout);
    handlers.onExit(0);
  }), async () => {
    await harness.host.runPromptOneShot(
      { displayPrompt: "complete this", modelPrompt: "complete this", contextTags: ["ctx"] },
      { tabId: "tab-1", cli: "opencode", sessionId: null },
    );
  });

  assert.deepEqual(harness.statusEvents.map((event) => event.status), ["start", "end"]);
  assert.deepEqual(harness.completionStatuses, ["end"]);
  assert.deepEqual(harness.memoryPersistStatuses, ["end"]);
  assert.equal(harness.activeRunId, undefined);
  assert.equal(harness.messages[0]?.role, "user");
  assert.equal(harness.messages[0]?.content, "complete this");
  const assistantMessage = harness.messages.find((message) => message.role === "assistant");
  assert.ok(assistantMessage);
  assert.equal(assistantMessage.content, "[final_answer] completed");
  assert.deepEqual(harness.rawStreamDeltas, [{ content: stdout, stream: "stdout" }]);
});

test("one-shot runtime host keeps empty and unsupported prompts inside its boundary", async () => {
  const harness = createOneShotRuntimeHarness();
  const throwingRunCliStream = (() => {
    throw new Error("runCliStream should not be called for empty one-shot prompt");
  }) as RunCliStream;

  await withRunCliStreamStub(throwingRunCliStream, async () => {
    await harness.host.runPromptOneShot(
      { displayPrompt: "", modelPrompt: "", contextTags: ["ignored"] },
      { tabId: "tab-empty", cli: "opencode", sessionId: null },
    );
  });

  assert.equal(harness.prepareRuntimeCalls, 0);
  assert.deepEqual(harness.statusEvents, []);
  await assert.rejects(
    harness.host.runPromptOneShot(
      { displayPrompt: "run", modelPrompt: "run", contextTags: [] },
      { tabId: "tab-unsupported", cli: "codex", sessionId: null },
    ),
    /one-shot-run-unsupported:codex/,
  );
});

test("one-shot runtime host finalizes non-retryable runner failures", async () => {
  const harness = createOneShotRuntimeHarness();
  const spawnError = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" });

  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    handlers.onError(spawnError);
  }), async () => {
    await harness.host.runPromptOneShot(
      { displayPrompt: "fail once", modelPrompt: "fail once", contextTags: [] },
      { tabId: "tab-fail", cli: "opencode", sessionId: null },
    );
  });

  assert.deepEqual(harness.statusEvents.map((event) => event.status), ["start", "error"]);
  assert.match(harness.statusEvents[1]?.message ?? "", /cli\.notFound\.unix\.title[\s\S]*opencode/);
  assert.deepEqual(harness.completionStatuses, ["error"]);
  assert.deepEqual(harness.memoryPersistStatuses, []);
  assert.equal(harness.activeRunId, undefined);
  assert.equal(harness.shownCommandErrors.length, 1);
  assert.match(harness.shownCommandErrors[0] ?? "", /cli\.notFound\.unix\.title[\s\S]*opencode/);
  assert.ok(harness.systemMessages.some((message) => message.includes("cli.notFound.unix.title")));
});
