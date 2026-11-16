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
  resolveContextWindow?: NonNullable<PromptOneShotRuntimeDeps["resolveOpenCodeContextWindow"]>;
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
    resolveOpenCodeContextWindow: options.resolveContextWindow ?? (async () => null),
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
    deps,
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

test("one-shot runtime finalizes and propagates ENOENT for task-level automatic repair", async () => {
  const harness = createOneShotRuntimeHarness();
  const spawnError = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" });
  const titleKey = `cli.notFound.${process.platform === "win32" ? "win" : "unix"}.title`;

  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    handlers.onError(spawnError);
  }), async () => {
    await assert.rejects(harness.host.runPromptOneShot(
      { displayPrompt: "fail once", modelPrompt: "fail once", contextTags: [] },
      { tabId: "tab-fail", cli: "opencode", sessionId: null },
    ), (error) => error === spawnError);
  });

  assert.deepEqual(harness.statusEvents.map((event) => event.status), ["start", "error"]);
  assert.ok(harness.statusEvents[1]?.message?.includes(titleKey));
  assert.match(harness.statusEvents[1]?.message ?? "", /opencode/);
  assert.deepEqual(harness.completionStatuses, ["error"]);
  assert.deepEqual(harness.memoryPersistStatuses, []);
  assert.equal(harness.activeRunId, undefined);
  assert.equal(harness.shownCommandErrors.length, 1);
  assert.ok(harness.shownCommandErrors[0]?.includes(titleKey));
  assert.match(harness.shownCommandErrors[0] ?? "", /opencode/);
  assert.ok(harness.systemMessages.some((message) => message.includes(titleKey)));
});

test("one-shot automatic repair retry does not retry transient failures again", async () => {
  const harness = createOneShotRuntimeHarness();
  let attempts = 0;
  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    attempts += 1;
    handlers.onError(new Error("temporary provider failure"));
  }), async () => {
    await harness.host.runPromptOneShot(
      { displayPrompt: "执行", modelPrompt: "执行", contextTags: [], cliCommandRepairAttempted: true },
      { tabId: "repair-retry", cli: "opencode", sessionId: null },
    );
  });
  assert.equal(attempts, 1);
  assert.equal(harness.activeRunId, undefined);
});

function contextStep(sessionID: string, input: number): string {
  return JSON.stringify({
    type: "step_finish", timestamp: 1794280000000, sessionID,
    part: { type: "step-finish", id: `prt_${input}`, messageID: "msg_main", sessionID, reason: "stop", cost: 0,
      tokens: { input, output: 20, reasoning: 10, cache: { read: 40, write: 5 } } },
  });
}

function contextStart(sessionID: string): string {
  return JSON.stringify({ type: "step_start", sessionID, part: { type: "step-start", sessionID, messageID: "msg_main" } });
}

function contextAnswer(sessionID: string): string {
  return JSON.stringify({ type: "text", sessionID, part: { type: "text", sessionID, text: "[final_answer] completed" } });
}

test("OpenCode usage reaches the host panel through split JSONL, uses the frozen model and latest primary step", async () => {
  const requests: Array<Parameters<NonNullable<PromptOneShotRuntimeDeps["resolveOpenCodeContextWindow"]>>[0]> = [];
  const harness = createOneShotRuntimeHarness({ resolveContextWindow: async (request) => {
    requests.push(request);
    return 16384;
  } });
  const stdout = [contextStart("ses_main"), contextStep("ses_main", 1000), contextStep("ses_child", 9000),
    contextAnswer("ses_main"), contextStep("ses_main", 60)].join("\n");
  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    for (let offset = 0; offset < stdout.length; offset += 13) handlers.onStdout(stdout.slice(offset, offset + 13));
    handlers.onStderr(`${contextStep("ses_main", 99000)}\n`);
    handlers.onExit(0);
    handlers.onStdout(`${contextStep("ses_main", 88000)}\n`);
  }), async () => {
    await harness.host.runPromptOneShot({ displayPrompt: "run", modelPrompt: "run", contextTags: [], model: "requested-not-effective" }, {
      tabId: "tab-usage", cli: "opencode", sessionId: null,
    });
  });
  assert.deepEqual(harness.panelMessages.filter(message => message.type === "contextTokenUsage"), [{
    type: "contextTokenUsage", tabId: "tab-usage", tokensInContextWindow: 135,
    modelContextWindow: 16384, contextWindowSource: "opencode-model-window",
  }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "packyapi/claude-sonnet-5");
  assert.equal(requests[0].envOverrides?.OPENCODE_CONFIG_CONTENT, requests[0].configContent);
  assert.equal(requests[0].cwd, process.cwd());
  assert.ok(harness.assistantChunks.join("").includes("[final_answer] completed"));
});

test("OpenCode usage keeps an unknown context window null instead of guessing", async () => {
  const harness = createOneShotRuntimeHarness();
  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    handlers.onStdout([contextStart("ses_main"), contextStep("ses_main", 60), contextAnswer("ses_main"), ""].join("\n"));
    handlers.onExit(0);
  }), async () => harness.host.runPromptOneShot({ displayPrompt: "run", modelPrompt: "run", contextTags: [] }, { tabId: "tab-null", cli: "opencode", sessionId: null }));
  assert.deepEqual(harness.panelMessages.filter(message => message.type === "contextTokenUsage"), [{
    type: "contextTokenUsage", tabId: "tab-null", tokensInContextWindow: 135, modelContextWindow: null,
  }]);
});

test("OpenCode publishes live replacement measurements after metadata resolves, not running totals", async () => {
  const harness = createOneShotRuntimeHarness({ resolveContextWindow: async () => 16384 });
  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    handlers.onStdout([contextStart("ses_live"), contextStep("ses_live", 1000), ""].join("\n"));
    setImmediate(() => {
      handlers.onStdout([contextStep("ses_live", 60), contextAnswer("ses_live"), ""].join("\n"));
      handlers.onExit(0);
    });
  }), async () => harness.host.runPromptOneShot({ displayPrompt: "run", modelPrompt: "run", contextTags: [] }, {
    tabId: "tab-live", cli: "opencode", sessionId: null,
  }));
  assert.deepEqual(harness.panelMessages.filter(message => message.type === "contextTokenUsage")
    .map(message => message.tokensInContextWindow), [1075, 135]);
});

test("OpenCode background Loop subtask usage never queries metadata or updates the primary panel", async () => {
  let metadataCalls = 0;
  const harness = createOneShotRuntimeHarness({ resolveContextWindow: async () => { metadataCalls += 1; return 16384; } });
  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    handlers.onStdout([contextStart("ses_subtask"), contextStep("ses_subtask", 60), contextAnswer("ses_subtask"), ""].join("\n"));
    handlers.onExit(0);
  }), async () => harness.host.runPromptOneShot({ displayPrompt: "run", modelPrompt: "run", contextTags: [], taskRole: "subtask", loopTaskId: "task" }, {
    tabId: "tab-subtask", cli: "opencode", sessionId: null,
  }));
  assert.equal(metadataCalls, 0);
  assert.equal(harness.panelMessages.some(message => message.type === "contextTokenUsage"), false);
});

test("OpenCode cancellation discards a pending metadata result", async () => {
  let resolveWindow!: (window: number | null) => void;
  const harness = createOneShotRuntimeHarness({ resolveContextWindow: () => new Promise(resolve => { resolveWindow = resolve; }) });
  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    handlers.onStdout([contextStart("ses_main"), contextStep("ses_main", 60), contextAnswer("ses_main"), ""].join("\n"));
    handlers.onExit(0);
    setImmediate(() => { harness.deps.clearActiveRun(); resolveWindow(16384); });
  }), async () => harness.host.runPromptOneShot({ displayPrompt: "run", modelPrompt: "run", contextTags: [] }, { tabId: "tab-cancel", cli: "opencode", sessionId: null }));
  assert.equal(harness.panelMessages.some(message => message.type === "contextTokenUsage"), false);
});

test("OpenCode failed attempts cannot publish late metadata or post-exit JSONL", async () => {
  let resolveWindow!: (window: number | null) => void;
  const harness = createOneShotRuntimeHarness({ resolveContextWindow: () => new Promise(resolve => { resolveWindow = resolve; }) });
  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    handlers.onStdout([contextStart("ses_main"), contextStep("ses_main", 60), ""].join("\n"));
    handlers.onStderr("provider error");
    handlers.onExit(1);
    handlers.onStdout(`${contextStep("ses_main", 9000)}\n`);
    setImmediate(() => resolveWindow(16384));
  }), async () => harness.host.runPromptOneShot({ displayPrompt: "run", modelPrompt: "run", contextTags: [], cliCommandRepairAttempted: true }, {
    tabId: "tab-error", cli: "opencode", sessionId: null,
  }));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(harness.panelMessages.some(message => message.type === "contextTokenUsage"), false);
});

test("OpenCode late metadata from an older run cannot overwrite a newer tab session", async () => {
  let resolveOldWindow!: (window: number | null) => void;
  let signalOldQuery!: () => void;
  const oldQueryStarted = new Promise<void>(resolve => { signalOldQuery = resolve; });
  let metadataCalls = 0;
  const harness = createOneShotRuntimeHarness({ resolveContextWindow: async () => {
    metadataCalls += 1;
    if (metadataCalls === 1) {
      signalOldQuery();
      return new Promise(resolve => { resolveOldWindow = resolve; });
    }
    return 16384;
  } });
  let attempts = 0;
  await withRunCliStreamStub(createAsyncRunCliStreamStub((handlers) => {
    attempts += 1;
    const sessionID = attempts === 1 ? "ses_old" : "ses_new";
    handlers.onStdout([contextStart(sessionID), contextStep(sessionID, attempts === 1 ? 9000 : 60), contextAnswer(sessionID), ""].join("\n"));
    handlers.onExit(0);
  }), async () => {
    const oldRun = harness.host.runPromptOneShot({ displayPrompt: "old", modelPrompt: "old", contextTags: [] }, {
      tabId: "same-tab", cli: "opencode", sessionId: null,
    });
    await oldQueryStarted;
    await harness.host.runPromptOneShot({ displayPrompt: "new", modelPrompt: "new", contextTags: [] }, {
      tabId: "same-tab", cli: "opencode", sessionId: null,
    });
    resolveOldWindow(200000);
    await oldRun;
  });
  assert.deepEqual(harness.panelMessages.filter(message => message.type === "contextTokenUsage"), [{
    type: "contextTokenUsage", tabId: "same-tab", tokensInContextWindow: 135,
    modelContextWindow: 16384, contextWindowSource: "opencode-model-window",
  }]);
});

for (const freshSession of [false, true]) {
  test(`OpenCode ${freshSession ? "fresh-session" : "hidden"} retry rebinds usage and drops settled attempt callbacks`, async () => {
    const retry = require("../../promptRetry") as typeof import("../../promptRetry");
    const originalWait = retry.waitForHiddenRetryDelay;
    const originalRecovery = commandRunner.recoverOpenCodeMissingAssistantOutput;
    retry.waitForHiddenRetryDelay = async () => true;
    commandRunner.recoverOpenCodeMissingAssistantOutput = async () => commandRunner.parseOpenCodeRunOutput("", "");
    let metadataCalls = 0;
    const harness = createOneShotRuntimeHarness({ resolveContextWindow: async () => { metadataCalls += 1; return 16384; } });
    const sessions: Array<string | null | undefined> = [];
    let oldHandlers: RunCliStreamHandlers | undefined;
    const streamStub: RunCliStream = (_cli, _prompt, handlers, options) => {
      sessions.push(options?.sessionId);
      const attempt = sessions.length;
      setImmediate(() => {
        if (attempt === 1) {
          oldHandlers = handlers;
          handlers.onStdout(`${contextStep("ses_old", 1000)}\n`);
          if (freshSession) handlers.onExit(0);
          else handlers.onError(new Error("temporary provider failure"));
          return;
        }
        const sessionID = freshSession ? "ses_new" : "ses_old";
        oldHandlers?.onStdout(`${contextStep(sessionID, 99999)}\n`);
        handlers.onStdout([
          ...(freshSession ? [contextStart("ses_old"), contextStep("ses_old", 99000), contextStart(sessionID)] : []),
          contextStep(sessionID, 60), contextAnswer(sessionID), "",
        ].join("\n"));
        handlers.onExit(0);
      });
      return { kill: () => true };
    };
    try {
      await withRunCliStreamStub(streamStub, async () => harness.host.runPromptOneShot({
        displayPrompt: "run", modelPrompt: "run", contextTags: [], taskRole: "main", loopTaskId: "loop-task",
      }, { tabId: "retry-tab", cli: "opencode", sessionId: "ses_old" }));
    } finally {
      retry.waitForHiddenRetryDelay = originalWait;
      commandRunner.recoverOpenCodeMissingAssistantOutput = originalRecovery;
    }
    assert.deepEqual(sessions, ["ses_old", freshSession ? null : "ses_old"]);
    assert.equal(metadataCalls, 1);
    const usageMessages = harness.panelMessages.filter(message => message.type === "contextTokenUsage");
    assert.equal(usageMessages[usageMessages.length - 1]?.tokensInContextWindow, 135);
    assert.ok(usageMessages.every(message => Number(message.tokensInContextWindow) < 2000));
  });
}

test("department Owner port feeds existing one-shot OpenCode parsing without calling facade spawn", async () => {
  const harness = createOneShotRuntimeHarness();
  let calls = 0;
  const transport = createAsyncRunCliStreamStub(handlers => {
    calls++;
    handlers.onStdout(JSON.stringify({ type: "text", sessionID: "ses_bound", part: { type: "text", text: "Owner answer" } }) + "\n");
    handlers.onExit(0);
  });
  await withRunCliStreamStub(() => { assert.fail("facade must not spawn a duplicate"); }, async () => {
    await harness.host.runPromptOneShot({ displayPrompt: "controlled", modelPrompt: "controlled", contextTags: [] },
      { tabId: "owner-tab", cli: "opencode", sessionId: "ses_bound" }, { departmentProcessStream: transport });
  });
  assert.equal(calls, 1);
  assert.ok(harness.messages.some(message => message.role === "assistant" && message.content.includes("Owner answer")));
  assert.deepEqual(harness.completionStatuses, ["end"]);
});

for (const failureType of ["exit", "error"] as const) {
  test(`department one-shot retryable ${failureType} finalizes without replay or retry status`, async () => {
    const retry = require("../../promptRetry") as typeof import("../../promptRetry");
    assert.ok(retry.HIDDEN_RETRY_MAX_RETRIES > 0, "exercise a nonzero ordinary retry budget");
    const failure = failureType === "exit"
      ? { type: "exit" as const, code: 1 }
      : { type: "error" as const, error: new Error("temporary provider failure") };
    assert.equal(retry.isHiddenRetryEligibleAttempt(failure, "temporary provider failure"), true);
    const originalWait = retry.waitForHiddenRetryDelay;
    let waits = 0, calls = 0;
    retry.waitForHiddenRetryDelay = async () => { waits++; return false; };
    const harness = createOneShotRuntimeHarness();
    const transport = createAsyncRunCliStreamStub(handlers => {
      calls++;
      handlers.onStdout(contextAnswer("ses_bound"));
      handlers.onStderr("temporary provider failure");
      if (failure.type === "exit") handlers.onExit(failure.code);
      else handlers.onError(failure.error);
    });
    try {
      await withRunCliStreamStub(() => { assert.fail("Owner failures cannot fall back to ordinary execution"); }, async () => {
        await harness.host.runPromptOneShot({ displayPrompt: "controlled", modelPrompt: "controlled", contextTags: [], taskRole: "main", loopTaskId: "leader" },
          { tabId: "owner-tab", cli: "opencode", sessionId: "ses_bound" }, { departmentProcessStream: transport });
      });
    } finally {
      retry.waitForHiddenRetryDelay = originalWait;
    }
    assert.equal(calls, 1);
    assert.equal(waits, 0);
    assert.deepEqual(harness.statusEvents.map(e => e.status), ["start", "error"]);
    assert.deepEqual(harness.completionStatuses, ["error"]);
    assert.equal(harness.activeRunId, undefined);
    assert.ok(harness.messages.some(m => m.role === "assistant"));
    assert.equal(harness.systemMessages.includes(retry.buildHiddenRetryQueuedMessage(0)), false);
    assert.equal(harness.systemMessages.includes(retry.buildHiddenRetryStartedMessage(1)), false);
  });
}


test("department leader native output preserves its durable local transcript identity", async () => {
  let adopted = 0;
  const harness = createOneShotRuntimeHarness({ captureSessionFromBuffer: () => { adopted++; } });
  const native: string[] = [];
  const transport = createAsyncRunCliStreamStub(handlers => {
    handlers.onStdout(JSON.stringify({ type: "text", sessionID: "ses_bound", part: { type: "text", text: "Leader answer" } }) + "\n");
    handlers.onExit(0);
  });
  await withRunCliStreamStub(() => { assert.fail("leader cannot spawn the facade transport"); }, async () => {
    await harness.host.runPromptOneShot({ displayPrompt: "controlled", modelPrompt: "controlled", contextTags: [], taskRole: "main", loopTaskId: "leader" },
      { tabId: "leader-tab", cli: "opencode", sessionId: "local_leader" }, {
        departmentProcessStream: transport, departmentLeaderNativeSession: (id) => { native.push(id); },
      });
  });
  assert.ok(native.length > 0); assert.ok(native.every(id => id === "ses_bound"));
  assert.equal(adopted, 0, "native session must not replace the durable local task/tab key");
  assert.ok(harness.messages.some(message => message.role === "assistant" && message.content.includes("Leader answer")));
  assert.deepEqual(harness.completionStatuses, ["end"]);
});

for (const hasActivity of [true, false]) test(`managed one-shot real parent ${hasActivity ? "activity survives" : "silence reaches"} the 60-second startup boundary without children`, async t => {
  const http = await import("http"), fs = await import("fs"), os = await import("os"), path = await import("path");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "oneshot-parent-")));
  const h = createOneShotRuntimeHarness();
  const events = new Set<import("http").ServerResponse>();
  let answer!: import("http").ServerResponse, message: any, posted!: () => void;
  const entered = new Promise<void>(resolve => { posted = resolve; });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/event") { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); events.add(res); return; }
    let raw = ""; for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/session" && req.method === "POST") { res.end(JSON.stringify({ id: "ses_parent", directory: root })); return; }
    if (url.pathname === "/session/ses_parent/message") { answer = res; message = JSON.parse(raw); posted(); return; }
    res.end("[]"); // genuine monitor children/messages poll: no child activity
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let handle: RunProcess | undefined, kills = 0, aborted = false, disposed = 0;
  const timers = new Map<object, () => void>();
  const set = global.setTimeout, clear = global.clearTimeout;
  // Only startup time is controlled; native HTTP and the finite overall helper
  // deadline remain real. This exercises the production one-shot watchdog port.
  global.setTimeout = ((callback: () => void, delay: number, ...args: any[]) => {
    if (delay !== 60000) return (set as (...values: any[]) => NodeJS.Timeout)(callback, delay, ...args);
    const token = {}; timers.set(token, callback); return token;
  }) as typeof set;
  global.clearTimeout = ((token: any) => { if (!timers.delete(token)) clear(token); }) as typeof clear;
  t.after(async () => { global.setTimeout = set; global.clearTimeout = clear; handle?.kill();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true }); });
  h.deps.resolveWorkspaceCwd = () => root;
  h.deps.prepareOpenCodeSubagentRuntime = async () => ({ connection: { serverUrl: `http://127.0.0.1:${(server.address() as any).port}` },
    endpointSource: "managed-server", error: null, dispose: () => { disposed++; } });
  h.deps.setActiveProcess = process => { handle = process; };
  h.deps.killActiveProcess = () => { kills++; handle?.kill(); };
  const host = createPromptOneShotRuntimeHost(h.deps);
  const running = host.runPromptOneShot({ displayPrompt: "slow healthy main", modelPrompt: "slow healthy main", contextTags: [],
    taskRole: "main", loopTaskId: "parent", cliCommandRepairAttempted: true }, { cli: "opencode", tabId: "main", sessionId: null }, { isAborted: () => aborted });
  await entered;
  assert.equal(timers.size, 1);
  const advancePastStartup = () => { for (const [token, callback] of [...timers]) { timers.delete(token); callback(); } };
  const info = { id: "msg_current", role: "assistant", sessionID: "ses_parent", parentID: message.messageID,
    modelID: message.model.modelID, providerID: message.model.providerID, path: { cwd: root } };
  if (hasActivity) {
    for (const event of [{ type: "message.updated", properties: { info } }, { type: "message.part.updated", properties: {
      part: { id: "prt_think", type: "reasoning", sessionID: "ses_parent", messageID: info.id, text: "actual parent reasoning" } } }]) {
      for (const stream of events) stream.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    for (let i = 0; i < 200 && timers.size; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(timers.size, 0, "verified parent activity disarms startup; there is still no final stdout or child");
    // Controlled time crosses the former startup deadline. The timer was
    // cancelled; final answer arrives after that boundary, within total budget.
    advancePastStartup(); // virtual startup time now 60,001ms
    assert.equal(kills, 0);
    answer.end(JSON.stringify({ info: { ...info, finish: "stop", time: { completed: Date.now() } },
      parts: [{ id: "prt_final", type: "text", sessionID: "ses_parent", messageID: info.id, text: "[final_answer] slow main completed" }] }));
    await running;
    assert.deepEqual(h.completionStatuses, ["end"]);
    assert.ok(h.assistantChunks.some(text => text.includes("slow main completed")));
  } else {
    advancePastStartup(); await running;
    assert.equal(kills, 1);
    assert.equal(h.assistantChunks.some(text => text.includes("slow main completed")), false);
    assert.ok(h.statusEvents.some(event => event.status === "error" && /60 秒内/.test(event.message ?? "")),
      "startup timeout must retain its diagnostic even when managed kill reports cancellation synchronously");
  }
  assert.equal(disposed, 1); assert.equal(timers.size, 0);
});
