import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

import type { RunProcess } from "../../cli/commandRunner";
import type { CliAttemptResult } from "../../panelDiagnostics";
import type { TaskRunRecord, TaskRunStatus } from "../../promptRunState";
import type { SubagentProgressStatus } from "../../subagentProgress";
import type { ChatMessage } from "../../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";

installVscodeMock();

const {
  createPromptParallelRuntimeHost,
} = require("../../extensionHost/promptParallelRuntime") as typeof import("../../extensionHost/promptParallelRuntime");
const {
  appendOpenCodeFinalTextToTabStream,
  consumeOpenCodeTabStreamChunk,
  createOpenCodeTabStreamState,
} = require("../../openCodeTabStream") as typeof import("../../openCodeTabStream");
const { appendBoundedUtf8Text } = require("../../boundedText") as typeof import("../../boundedText");

type PromptParallelRuntimeDeps = Parameters<typeof createPromptParallelRuntimeHost>[0];
type RunCliStream = NonNullable<PromptParallelRuntimeDeps["runCliStream"]>;
type RunCliStreamHandlers = Parameters<RunCliStream>[2];
type OpenCodeRunOutput = ReturnType<NonNullable<PromptParallelRuntimeDeps["parseOpenCodeRunOutput"]>>;

const TAB_ID = "tab-1";

type RunStatusEvent = {
  tabId: string;
  status: "start" | "end" | "error" | "stopped";
  options?: {
    message?: string;
    prompt?: string;
    startedAt?: number;
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
  deps?: PromptParallelRuntimeDeps;
  maxRetries?: number;
  retryEligible?: boolean;
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
    HIDDEN_RETRY_MAX_RETRIES: options.maxRetries ?? 0,
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
    isHiddenRetryEligibleAttempt: () => options.retryEligible ?? false,
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
    host: createPromptParallelRuntimeHost({ ...deps, ...options.deps }),
    memoryPersistStatuses,
    messages,
    panelMessages,
    parallelRunsByTabId,
    persistedMessages,
    runStatusEvents,
    taskRuns,
  };
}

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

test("parallel runtime propagates the original ENOENT error for task-level automatic repair", async () => {
  const failure = Object.assign(new Error("spawn opencode ENOENT"), { code: "ENOENT" });
  const harness = createParallelRuntimeHarness({
    runCliStream: createAsyncRunCliStreamStub((handlers) => handlers.onError(failure)),
  });
  await assert.rejects(
    harness.host.runPromptParallel(createPromptInput(), createTarget()),
    (error) => error === failure,
  );
  assert.equal(harness.parallelRunsByTabId.has(TAB_ID), false);
  assert.equal(harness.runStatusEvents.at(-1)?.status, "error");
});

test("parallel automatic repair retry has no further transient error retries", async () => {
  let attempts = 0;
  const harness = createParallelRuntimeHarness({
    maxRetries: 3,
    retryEligible: true,
    runCliStream: createAsyncRunCliStreamStub((handlers) => {
      attempts += 1;
      handlers.onError(new Error("temporary provider failure"));
    }),
  });
  await harness.host.runPromptParallel(createPromptInput({ cliCommandRepairAttempted: true }), createTarget());
  assert.equal(attempts, 1);
  assert.equal(harness.parallelRunsByTabId.has(TAB_ID), false);
});

test("department Owner port feeds the bound parallel session and disables hidden replacement executions", async () => {
  let calls = 0;
  const harness = createParallelRuntimeHarness({ maxRetries: 3, retryEligible: true, runCliStream: () => { assert.fail("fallback must not spawn"); } });
  const transport = createAsyncRunCliStreamStub(handlers => {
    calls++;
    handlers.onStdout(JSON.stringify({ type: "text", sessionID: "ses_bound", part: { type: "text", text: "Owner partial answer" } }) + "\n");
    handlers.onExit(1);
  });
  await harness.host.runPromptParallel(createPromptInput(), createTarget({ sessionId: "ses_bound" }), { departmentProcessStream: transport });
  assert.equal(calls, 1);
  assert.ok(harness.persistedMessages.some(entry => entry.sessionId === "ses_bound" && entry.messages.some(message => message.content.includes("Owner partial answer"))));
  assert.equal(harness.taskRuns[harness.taskRuns.length - 1]?.status, "error");
});

// Controlled Owner transports publish onExit only when their physical/consumer
// drain is released. These are parser/tab-state tests, not native CLI receipts.
function createConcurrentLeaderHarness() {
  let retryWaits = 0;
  const transcripts = new Map<string, ChatMessage[]>([["local_a", []], ["local_b", []]]);
  const nativeSeen = new Map<string, string[]>();
  const controls = new Map<string, { handlers: RunCliStreamHandlers; kills: number }>();
  const started = new Map<string, Promise<void>>();
  const startResolvers = new Map<string, () => void>();
  for (const id of ["a", "b"]) {
    started.set(id, new Promise<void>(resolve => startResolvers.set(id, resolve)));
    nativeSeen.set(id, []);
  }
  const harness = createParallelRuntimeHarness({
    runCliStream: () => { assert.fail("leader must never fall back to ordinary execution"); },
    maxRetries: 3,
    retryEligible: true,
    parseOpenCodeRunOutput: () => ({ finalText: "", errorText: null, statusText: null, hasStructuredFinalAnswer: true }),
    deps: {
      waitForHiddenRetryDelay: async () => { retryWaits++; return false; },
      extractSessionId: (_cli, text) => {
        const match = /"sessionID":"(ses_[ab])"/.exec(text);
        return match?.[1];
      },
      isLocalSessionId: id => id.startsWith("local_"),
      loadSessionMessages: (_cli, id) => {
        assert.ok(transcripts.has(id), "native IDs must not replace durable transcript keys");
        return transcripts.get(id)!;
      },
      adoptDetectedSessionId: () => { assert.fail("leader session cannot be adopted as a new tab identity"); },
      adoptFreshOpenCodeLoopRecoverySession: () => { assert.fail("leader cannot replace its native Owner/session"); },
    },
  });
  const run = (id: "a" | "b") => harness.host.runPromptParallel(
    createPromptInput({ taskRole: "main", loopTaskId: `leader-${id}`, loopSubtaskId: undefined }),
    createTarget({ tabId: `tab-${id}`, sessionId: `local_${id}` }),
    {
      departmentLeaderNativeSession: sessionId => {
        assert.equal(sessionId, `ses_${id}`);
        nativeSeen.get(id)!.push(sessionId);
      },
      departmentProcessStream: ((_cli, _prompt, handlers) => {
        assert.equal(controls.has(id), false, "one Owner invocation only");
        const control = { handlers, kills: 0 };
        controls.set(id, control);
        startResolvers.get(id)!();
        return { kill: () => { control.kills++; return true; } };
      }) as RunCliStream,
    },
  );
  const text = (id: string, content: string) => controls.get(id)!.handlers.onStdout(
    JSON.stringify({ type: "text", sessionID: `ses_${id}`, part: { type: "text", text: content } }) + "\n",
  );
  return { ...harness, transcripts, nativeSeen, controls, started, run, text, get retryWaits() { return retryWaits; } };
}

for (const failureType of ["exit", "error"] as const) {
  test(`retryable department leader ${failureType} fails once while the other tab completes`, async () => {
    const h = createConcurrentLeaderHarness();
    const a = h.run("a"), b = h.run("b");
    await Promise.all([h.started.get("a"), h.started.get("b")]);
    h.text("a", "A partial answer"); h.text("b", "B before failure ");
    h.controls.get("a")!.handlers.onStderr("temporary provider failure");
    if (failureType === "exit") h.controls.get("a")!.handlers.onExit(1);
    else h.controls.get("a")!.handlers.onError(new Error("temporary provider failure"));
    await a;
    assert.equal(h.retryWaits, 0, "Owner failures must not enter retry waiting");
    assert.equal(h.parallelRunsByTabId.has("tab-a"), false);
    assert.equal(h.parallelRunsByTabId.has("tab-b"), true);
    assert.deepEqual(h.taskRuns.map(r => [r.loopTaskId, r.status]), [["leader-a", "error"]]);
    h.text("b", "B after failure");
    h.controls.get("b")!.handlers.onExit(0);
    await b;
    assert.deepEqual(h.runStatusEvents.filter(e => e.tabId === "tab-a").map(e => e.status), ["start", "error"]);
    assert.deepEqual(h.runStatusEvents.filter(e => e.tabId === "tab-b").map(e => e.status), ["start", "end"]);
    assert.deepEqual(h.taskRuns.map(r => [r.loopTaskId, r.status]), [["leader-a", "error"], ["leader-b", "end"]]);
    for (const [id, transcript] of h.transcripts) {
      assert.equal(transcript.some(m => /retry queued|retry started|retry prompt/.test(m.content)), false);
      assert.ok(h.persistedMessages.some(p => p.sessionId === id));
    }
    assert.ok(h.transcripts.get("local_a")!.some(m => m.content.includes("A partial answer")));
    assert.ok(h.transcripts.get("local_b")!.some(m => m.content.includes("B after failure")));
    assert.equal(h.parallelRunsByTabId.size, 0);
    assert.equal(h.controls.size, 2, "one original transport per leader; no fallback or replay");
  });
}

test("concurrent department leaders retain interleaved output and independent completion by tab", async () => {
  const h = createConcurrentLeaderHarness();
  const a = h.run("a"), b = h.run("b");
  await Promise.all([h.started.get("a"), h.started.get("b")]);
  h.text("a", "A first "); h.text("b", "B first ");
  h.text("a", "A second "); h.text("b", "B second ");
  h.controls.get("b")!.handlers.onExit(0);
  await b;
  assert.equal(h.parallelRunsByTabId.has("tab-b"), false);
  assert.equal(h.parallelRunsByTabId.has("tab-a"), true);
  assert.deepEqual(h.taskRuns.map(r => [r.loopTaskId, r.status]), [["leader-b", "end"]]);
  h.text("a", "A tail");
  h.controls.get("a")!.handlers.onExit(0);
  await a;
  for (const id of ["a", "b"]) {
    const answer = h.transcripts.get(`local_${id}`)!.filter(m => m.role === "assistant").map(m => m.content).join("");
    assert.ok(answer.includes(`${id.toUpperCase()} first `));
    assert.ok(answer.includes(`${id.toUpperCase()} second `));
    assert.equal(answer.includes(id === "a" ? "B first" : "A first"), false);
    assert.ok(h.nativeSeen.get(id)!.length > 0);
    const deltas = h.panelMessages.filter(m => m.type === "assistantDelta" && m.tabId === `tab-${id}`).map(m => m.content).join("");
    assert.ok(deltas.includes(`${id.toUpperCase()} first `));
    assert.equal(deltas.includes(id === "a" ? "B first" : "A first"), false);
    assert.deepEqual(h.runStatusEvents.filter(e => e.tabId === `tab-${id}`).map(e => e.status), ["start", "end"]);
    assert.equal(h.controls.get(id)!.kills, 0);
    assert.ok(h.persistedMessages.some(p => p.tabId === `tab-${id}` && p.sessionId === `local_${id}`));
  }
  assert.ok(h.transcripts.get("local_a")!.some(m => m.content.includes("A tail")));
  assert.equal(h.parallelRunsByTabId.size, 0);
  assert.deepEqual(h.taskRuns.map(r => [r.loopTaskId, r.status]), [["leader-b", "end"], ["leader-a", "end"]]);
});

test("cancelling one department leader waits its Owner drain and leaves the other leader active", async () => {
  const h = createConcurrentLeaderHarness();
  let aDrained = false;
  const a = h.run("a").then(() => { aDrained = true; }), b = h.run("b");
  await Promise.all([h.started.get("a"), h.started.get("b")]);
  h.text("a", "A before stop"); h.text("b", "B before stop ");
  assert.equal(h.host.stopParallelRunForTab("tab-a"), true);
  assert.equal(h.host.stopParallelRunForTab("tab-a"), false);
  assert.equal(h.controls.get("a")!.kills, 1);
  assert.equal(h.controls.get("b")!.kills, 0);
  assert.equal(h.parallelRunsByTabId.has("tab-b"), true);
  h.text("a", "A late output"); h.text("b", "B after A stop");
  h.controls.get("b")!.handlers.onExit(0);
  await b;
  assert.equal(aDrained, false, "stop request is not physical/consumer drain");
  h.controls.get("a")!.handlers.onExit(null);
  await a;
  assert.deepEqual(h.taskRuns.map(r => [r.loopTaskId, r.status]), [["leader-a", "stopped"], ["leader-b", "end"]]);
  assert.deepEqual(h.runStatusEvents.filter(e => e.tabId === "tab-a").map(e => e.status), ["start", "stopped"]);
  assert.deepEqual(h.runStatusEvents.filter(e => e.tabId === "tab-b").map(e => e.status), ["start", "end"]);
  assert.ok(h.transcripts.get("local_a")!.some(m => m.content.includes("A before stop")));
  assert.equal(h.transcripts.get("local_a")!.some(m => m.content.includes("A late output")), false);
  assert.ok(h.transcripts.get("local_b")!.some(m => m.content.includes("B after A stop")));
  assert.equal(h.transcripts.get("local_b")!.some(m => m.content.includes("A before stop")), false);
  assert.equal(h.parallelRunsByTabId.size, 0);
});
