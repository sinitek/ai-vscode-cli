import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

import type { RunProcess } from "../../cli/commandRunner";
import type { HumanInteractionRequest, HumanInteractionSubmission } from "../../humanInteraction";
import type { TaskRunDraft, TaskRunStatus } from "../../promptRunState";
import type { ChatMessage } from "../../webview/types";

installVscodeMock();

const commandRunner = require("../../cli/commandRunner") as typeof import("../../cli/commandRunner");
const {
  createPromptOneShotRuntimeHost,
} = require("../../extensionHost/promptOneShotRuntime") as typeof import("../../extensionHost/promptOneShotRuntime");

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

function createOneShotRuntimeHarness(options: {
  humanInteractionEnabled?: boolean;
  humanInteractionSubmission?: HumanInteractionSubmission | ((request: HumanInteractionRequest) => Promise<HumanInteractionSubmission> | HumanInteractionSubmission);
  captureSessionFromBuffer?: PromptOneShotRuntimeDeps["captureSessionFromBuffer"];
  sessionMessagesById?: Map<string, ChatMessage[]>;
} = {}) {
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
  const humanInteractionRequests: HumanInteractionRequest[] = [];
  const canceledHumanInteractionTabs: Array<{ tabId: string; statusText?: string }> = [];
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
    captureSessionFromBuffer: options.captureSessionFromBuffer ?? (() => undefined),
    cancelHumanInteractionForTab: (tabId, statusText) => {
      canceledHumanInteractionTabs.push({ tabId, statusText });
    },
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
    getGlobalHumanInteractionEnabled: () => options.humanInteractionEnabled !== false,
    getPendingSessionDraft: (tabId) => {
      if (!pendingMessagesByTab.has(tabId)) {
        pendingMessagesByTab.set(tabId, messages);
      }
      return { messages: pendingMessagesByTab.get(tabId) ?? messages };
    },
    killActiveProcess: () => undefined,
    loadSessionMessages: (_cli, sessionId) => options.sessionMessagesById?.get(sessionId) ?? messages,
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
    humanInteractionRequests,
    canceledHumanInteractionTabs,
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

test("one-shot runtime host converts OpenCode natural clarification replies into human interaction forms", async () => {
  const prompts: string[] = [];
  const harness = createOneShotRuntimeHarness({
    humanInteractionSubmission: (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {
        answer_1: "秋天",
        answer_2: "古风",
      },
    }),
  });
  const buildStdout = (text: string, sessionID = "ses_natural_human"): string => `${JSON.stringify({
    type: "text",
    sessionID,
    part: { type: "text", text },
  })}\n`;
  const runCliStreamStub = ((_cli, prompt, handlers) => {
    prompts.push(prompt);
    const processHandle: RunProcess = {
      kill: () => true,
    };
    setImmediate(() => {
      const runNumber = prompts.length;
      if (runNumber === 1) {
        handlers.onStdout(buildStdout([
          "[final_answer] 可以。请先回答：",
          "1. 主题是什么？",
          "2. 希望什么风格？",
        ].join("\n")));
        handlers.onExit(0);
        return;
      }
      handlers.onStdout(buildStdout("[final_answer] 秋风入纸，古意成诗。"));
      handlers.onExit(0);
    });
    return processHandle;
  }) as RunCliStream;

  await withRunCliStreamStub(runCliStreamStub, async () => {
    await harness.host.runPromptOneShot(
      {
        displayPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
        modelPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
        contextTags: [],
      },
      { tabId: "tab-opencode-natural-human", cli: "opencode", sessionId: null },
    );
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[0] ?? "", /Human interaction requirement for Vibe tasks/);
  assert.match(prompts[1] ?? "", /已提交补充信息/);
  assert.match(prompts[1] ?? "", /主题是什么？：秋天/);
  assert.match(prompts[1] ?? "", /希望什么风格？：古风/);
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.deepEqual(
    harness.humanInteractionRequests[0]?.formFields.map((field) => field.label),
    ["主题是什么？", "希望什么风格？"],
  );
  assert.ok(harness.panelMessages.some((message) => message.type === "removeMessage" && message.tabId === "tab-opencode-natural-human"));
  assert.ok(harness.messages.some((message) => message.role === "system" && message.content === "run.humanInteractionWaiting"));
  assert.ok(harness.messages.some((message) => message.role === "user" && message.content.includes("主题是什么？：秋天")));
  assert.ok(harness.messages.some((message) => message.role === "assistant" && message.content === "[final_answer] 秋风入纸，古意成诗。"));
  assert.equal(harness.messages.some((message) => message.role === "assistant" && message.content.includes("请先回答")), false);
  assert.deepEqual(harness.statusEvents.map((event) => event.status), ["start", "end"]);
  assert.deepEqual(harness.completionStatuses, ["end"]);
  assert.deepEqual(harness.memoryPersistStatuses, ["end"]);
});

test("one-shot runtime host parses OpenCode optioned clarification replies into radio fields", async () => {
  const prompts: string[] = [];
  const harness = createOneShotRuntimeHarness({
    humanInteractionSubmission: (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {
        answer_1: "爱与思念（推荐）",
        answer_2: "温柔治愈（推荐）",
        answer_3: "现代诗（推荐）",
      },
    }),
  });
  const buildStdout = (text: string, sessionID = "ses_opencode_options"): string => `${JSON.stringify({
    type: "text",
    sessionID,
    part: { type: "text", text },
  })}\n`;
  const optionedClarification = [
    "[final_answer] 请按 `1A 2B 3A` 回复，也可以补充具体的人、地点或故事。",
    "",
    "1. **主题是什么？**",
    "A. 爱与思念（推荐）",
    "B. 成长与告别",
    "C. 自然与远方",
    "",
    "2. **情绪基调是什么？**",
    "A. 温柔治愈（推荐）",
    "B. 清冷克制",
    "C. 热烈浪漫",
    "",
    "3. **想要哪种形式？**",
    "A. 现代诗（推荐）",
    "B. 古风诗",
    "C. 歌词感短诗",
  ].join("\n");
  const runCliStreamStub = ((_cli, prompt, handlers) => {
    prompts.push(prompt);
    const processHandle: RunProcess = {
      kill: () => true,
    };
    setImmediate(() => {
      const runNumber = prompts.length;
      if (runNumber === 1) {
        handlers.onStdout(buildStdout(optionedClarification));
        handlers.onExit(0);
        return;
      }
      handlers.onStdout(buildStdout("[final_answer] 爱在秋风里落成一首现代诗。"));
      handlers.onExit(0);
    });
    return processHandle;
  }) as RunCliStream;

  await withRunCliStreamStub(runCliStreamStub, async () => {
    await harness.host.runPromptOneShot(
      {
        displayPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
        modelPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
        contextTags: [],
      },
      { tabId: "tab-opencode-optioned-human", cli: "opencode", sessionId: null },
    );
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1] ?? "", /主题是什么？：爱与思念（推荐）/);
  assert.match(prompts[1] ?? "", /情绪基调是什么？：温柔治愈（推荐）/);
  assert.match(prompts[1] ?? "", /想要哪种形式？：现代诗（推荐）/);
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.deepEqual(
    harness.humanInteractionRequests[0]?.formFields.map((field) => ({
      label: field.label,
      type: field.type,
      options: (field.options ?? []).map((option) => option.label),
    })),
    [
      { label: "主题是什么？", type: "radio", options: ["爱与思念（推荐）", "成长与告别", "自然与远方"] },
      { label: "情绪基调是什么？", type: "radio", options: ["温柔治愈（推荐）", "清冷克制", "热烈浪漫"] },
      { label: "想要哪种形式？", type: "radio", options: ["现代诗（推荐）", "古风诗", "歌词感短诗"] },
    ],
  );
  assert.ok(harness.panelMessages.some((message) => message.type === "removeMessage" && message.tabId === "tab-opencode-optioned-human"));
  assert.ok(harness.messages.some((message) => message.role === "assistant" && message.content === "[final_answer] 爱在秋风里落成一首现代诗。"));
  assert.equal(harness.messages.some((message) => message.role === "assistant" && message.content.includes("1A 2B 3A")), false);
});

test("one-shot runtime host refreshes OpenCode session target before natural clarification parsing", async () => {
  const prompts: string[] = [];
  const sessionMessagesById = new Map<string, ChatMessage[]>();
  let adoptedSession = false;
  let harness: ReturnType<typeof createOneShotRuntimeHarness>;
  harness = createOneShotRuntimeHarness({
    sessionMessagesById,
    captureSessionFromBuffer: (_cli, buffer) => {
      const sessionId = buffer.match(/"sessionID":"([^"]+)"/)?.[1];
      if (!sessionId || adoptedSession) {
        return;
      }
      adoptedSession = true;
      sessionMessagesById.set(sessionId, harness.messages.slice());
      harness.messages.splice(1);
    },
    humanInteractionSubmission: (request) => ({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "completed",
      values: {
        answer_1: "爱情 / 思念",
        answer_2: "温柔治愈",
        answer_3: "现代诗，约 15-25 行",
      },
    }),
  });
  const buildStdout = (text: string, sessionID = "ses_adopted_human"): string => `${JSON.stringify({
    type: "text",
    sessionID,
    part: { type: "text", text },
  })}\n`;
  const clarification = [
    "请按下面格式回复即可，例如：`1A 2B 3A；写给某人，地点是海边`",
    "",
    "1. **主题与对象**",
    "   - A. 爱情 / 思念",
    "   - B. 人生 / 成长",
    "   - C. 自然 / 四季",
    "",
    "2. **情绪基调**",
    "   - A. 温柔治愈",
    "   - B. 孤独克制",
    "   - C. 热烈浪漫",
    "",
    "3. **形式与长度**",
    "   - A. 现代诗，约 15-25 行",
    "   - B. 短诗，约 8-12 行",
    "   - C. 叙事长诗，约 30 行以上",
    "[final_answer]等你回复选项后，我会据此写出完整的诗。",
  ].join("\n");
  const runCliStreamStub = ((_cli, prompt, handlers) => {
    prompts.push(prompt);
    const processHandle: RunProcess = {
      kill: () => true,
    };
    setImmediate(() => {
      const runNumber = prompts.length;
      if (runNumber === 1) {
        handlers.onStdout(buildStdout(clarification));
        handlers.onExit(0);
        return;
      }
      handlers.onStdout(buildStdout("[final_answer] 海边的风把思念写成现代诗。"));
      handlers.onExit(0);
    });
    return processHandle;
  }) as RunCliStream;

  await withRunCliStreamStub(runCliStreamStub, async () => {
    await harness.host.runPromptOneShot(
      {
        displayPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
        modelPrompt: "写一首诗，你来问我一些要求帮你更精准写出我想要的诗",
        contextTags: [],
      },
      { tabId: "tab-opencode-adopted-human", cli: "opencode", sessionId: null },
    );
  });

  const adoptedMessages = sessionMessagesById.get("ses_adopted_human") ?? [];
  assert.equal(prompts.length, 2);
  assert.equal(harness.humanInteractionRequests.length, 1);
  assert.deepEqual(
    harness.humanInteractionRequests[0]?.formFields.map((field) => field.label),
    ["主题与对象", "情绪基调", "形式与长度"],
  );
  assert.match(prompts[1] ?? "", /主题与对象：爱情 \/ 思念/);
  assert.ok(adoptedMessages.some((message) => message.role === "assistant" && message.content === "[final_answer] 海边的风把思念写成现代诗。"));
  assert.equal(adoptedMessages.some((message) => message.role === "assistant" && message.content.includes("1A 2B 3A")), false);
  assert.equal(harness.messages.some((message) => message.role === "assistant"), false);
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
