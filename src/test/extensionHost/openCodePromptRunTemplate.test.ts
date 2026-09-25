import test = require("node:test");
import assert = require("node:assert/strict");
import { runOpenCodePromptTemplate } from "../../extensionHost/openCodePromptRunTemplate";
import type { OpenCodePromptRunPorts } from "../../extensionHost/openCodePromptRunTemplate";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";

type RecordedPort = OpenCodePromptRunPorts & {
  events: string[];
};

function createRuntimePreparation() {
  return {
    envOverrides: {},
    configContent: "{}",
    role: "main" as const,
    mainModel: "main-model",
    subtaskModel: null,
    effectiveModel: "effective-model",
    mainVariant: null,
    subtaskVariant: null,
    effectiveVariant: null,
    modelFallback: "none",
    primaryModel: "main-model",
    smallModel: null,
    primaryVariant: null,
    smallVariant: null,
  };
}

function createRecordingPorts(events: string[], overrides: Partial<OpenCodePromptRunPorts> = {}): RecordedPort {
  const call = <T>(name: string, value: T): T => {
    events.push(name);
    return value;
  };
  const ports: OpenCodePromptRunPorts = {
    guardRun: () => call("guardRun", {
      status: "ready" as const,
      prompt: "ship the template",
      modelPrompt: "ship the template",
      runCli: "opencode" as const,
    }),
    resolveWorkspaceCwd: () => call("resolveWorkspaceCwd", "/workspace"),
    noteMissingWorkspace: () => {
      events.push("noteMissingWorkspace");
    },
    prepareOpenCodeRuntime: async () => call("prepareOpenCodeRuntime", createRuntimePreparation()),
    getEffectiveThinkingMode: () => call("getEffectiveThinkingMode", "medium" as const),
    applyThinkingWorkspaceFiles: () => {
      events.push("applyThinkingWorkspaceFiles");
    },
    shouldAutoCompactContextAfterRunForTarget: () => call("shouldAutoCompactContextAfterRunForTarget", true),
    preparePendingLabel: () => {
      events.push("preparePendingLabel");
    },
    readGlobalHumanInteractionEnabled: () => call("readGlobalHumanInteractionEnabled", false),
    buildThinkingPrompt: () => call("buildThinkingPrompt", "thinking"),
    buildHiddenRetryPrompt: () => call("buildHiddenRetryPrompt", "hidden-retry"),
    beforeLoadMessages: () => {
      events.push("beforeLoadMessages");
    },
    loadSessionMessages: () => call("loadSessionMessages", []),
    getPendingSessionDraft: () => call("getPendingSessionDraft", { messages: [] }),
    stageRunBeforeUserMessage: () => {
      events.push("stageRunBeforeUserMessage");
    },
    createMessageId: () => call("createMessageId", `id-${events.length}`),
    bindRunIdentityBeforeUserBubble: () => {
      events.push("bindRunIdentityBeforeUserBubble");
    },
    buildUserChatMessage: (input, createdAt, messageId) => call("buildUserChatMessage", {
      id: messageId,
      role: "user" as const,
      content: input.displayPrompt,
      createdAt,
    }),
    appendUserMessage: () => {
      events.push("appendUserMessage");
    },
    finishRunActivation: () => {
      events.push("finishRunActivation");
    },
    isRunActive: () => call("isRunActive", true),
    resolveMessageTarget: () => call("resolveMessageTarget", []),
    getRunId: () => call("getRunId", "run-1"),
    getSessionId: () => call("getSessionId", "session-1"),
    takeContinuationPrompt: () => call("takeContinuationPrompt", null),
    getHiddenRetryDelayMs: () => call("getHiddenRetryDelayMs", 0),
    waitForHiddenRetryDelay: async () => call("waitForHiddenRetryDelay", true),
    prepareHiddenRetry: () => {
      events.push("prepareHiddenRetry");
    },
    publishSystem: () => {
      events.push("publishSystem");
    },
    t: (key) => call("t", key),
    buildHiddenRetryStartedMessage: () => call("buildHiddenRetryStartedMessage", "started"),
    logHiddenRetry: () => {
      events.push("logHiddenRetry");
    },
    resolveCliSessionIdForResume: (_cli, sessionId) => call("resolveCliSessionIdForResume", sessionId),
    beginStreamAttempt: () => {
      events.push("beginStreamAttempt");
    },
    prepareOpenCodeSubagentRuntime: async () => call("prepareOpenCodeSubagentRuntime", {
      connection: null,
      endpointSource: "unavailable" as const,
      error: null,
      dispose: () => {
        events.push("disposeSubagentRuntime");
      },
    }),
    shouldAnnounceSubagentMonitorUnavailable: () => call("shouldAnnounceSubagentMonitorUnavailable", false),
    prepareSubagentMonitorUnavailableNotice: () => {
      events.push("prepareSubagentMonitorUnavailableNotice");
    },
    logSubagentMonitorStart: () => {
      events.push("logSubagentMonitorStart");
    },
    createStartupWatchdog: () => {
      events.push("createStartupWatchdog");
      return {
        arm: () => {
          events.push("watchdog.arm");
        },
        dispose: () => {
          events.push("watchdog.dispose");
        },
      };
    },
    createSubagentMonitor: () => {
      events.push("createSubagentMonitor");
      return {
        setParentSessionId: () => undefined,
        pollNow: async () => undefined,
        finish: () => {
          events.push("monitor.finish");
        },
        dispose: () => undefined,
      };
    },
    runCliStream: (_cli, _prompt, handlers) => {
      events.push("runCliStream");
      handlers.onStdout("out");
      handlers.onStderr("err");
      handlers.onExit(0);
      return { kill: () => true };
    },
    buildProcessLabel: () => call("buildProcessLabel", "process"),
    appendBoundedUtf8Text: (current, chunk) => call("appendBoundedUtf8Text", {
      text: `${current}${chunk}`,
      truncated: false,
    }),
    maxRawOutputBytes: 1024,
    maxHiddenRetries: 1,
    onStdoutChunk: () => {
      events.push("onStdoutChunk");
    },
    onStderrChunk: () => {
      events.push("onStderrChunk");
    },
    onAttemptProcessStarted: () => {
      events.push("onAttemptProcessStarted");
    },
    finishStreamAttempt: () => call("finishStreamAttempt", true),
    adoptSession: () => {
      events.push("adoptSession");
    },
    beginSuccessfulExit: () => {
      events.push("beginSuccessfulExit");
    },
    parseOpenCodeRunOutput: () => call("parseOpenCodeRunOutput", {
      finalText: "done",
      errorText: null,
      statusText: null,
      hasStructuredFinalAnswer: true,
    }),
    appendParsedOutput: () => call("appendParsedOutput", []),
    maybeHandleNaturalLanguageHumanInteraction: async () => call("maybeHandleNaturalLanguageHumanInteraction", false as const),
    hasAssistantFinalConclusionAfterMessage: () => call("hasAssistantFinalConclusionAfterMessage", true),
    shouldRequireExplicitFinalAnswerForRun: () => call("shouldRequireExplicitFinalAnswerForRun", false),
    resolveOpenCodeSuccessfulExitOutcome: () => call("resolveOpenCodeSuccessfulExitOutcome", "complete" as const),
    buildOpenCodeMissingFinalConclusionMessage: () => call("buildOpenCodeMissingFinalConclusionMessage", "missing"),
    shouldRecoverOpenCodeLoopMainSessionInFreshSession: () => call("shouldRecoverOpenCodeLoopMainSessionInFreshSession", false),
    logMissingFinalConclusionRetry: () => {
      events.push("logMissingFinalConclusionRetry");
    },
    publishMissingConclusionRetry: () => {
      events.push("publishMissingConclusionRetry");
    },
    logMissingFinalConclusionFailure: () => {
      events.push("logMissingFinalConclusionFailure");
    },
    finalizeMissingFinalConclusion: async () => {
      events.push("finalizeMissingFinalConclusion");
    },
    finalizeSuccessfulExit: async () => call("finalizeSuccessfulExit", {
      sessionId: "session-1",
      durationMs: 5,
    }),
    maybeAutoCompactContextAfterPromptSuccess: async () => {
      events.push("maybeAutoCompactContextAfterPromptSuccess");
    },
    evaluateFailedAttempt: () => call("evaluateFailedAttempt", {
      hiddenRetryCount: 0,
      shouldRetry: false,
    }),
    recordFailedAttemptRetry: () => {
      events.push("recordFailedAttemptRetry");
    },
    finalizeFailedAttempt: async () => {
      events.push("finalizeFailedAttempt");
    },
  };
  return { events, ...ports, ...overrides };
}

function createInput(overrides: Partial<PromptRunInput> = {}): PromptRunInput {
  return {
    displayPrompt: "ship the template",
    modelPrompt: "ship the template",
    contextTags: [],
    ...overrides,
  };
}

function createTarget(): PromptRunTarget {
  return { tabId: "tab-1", cli: "opencode", sessionId: null };
}

test("runs the shared OpenCode attempt steps and calls explicit ports in order", async () => {
  const events: string[] = [];
  const ports = createRecordingPorts(events);
  const originalSetTimeout = global.setTimeout;
  let scheduledTimers = 0;
  global.setTimeout = ((handler: Parameters<typeof setTimeout>[0], timeout?: number) => {
    scheduledTimers += 1;
    return originalSetTimeout(handler, timeout);
  }) as typeof setTimeout;
  try {
    await runOpenCodePromptTemplate(createInput(), createTarget(), {}, ports);
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(events, [
    "guardRun",
    "resolveWorkspaceCwd",
    "noteMissingWorkspace",
    "prepareOpenCodeRuntime",
    "getEffectiveThinkingMode",
    "applyThinkingWorkspaceFiles",
    "shouldAutoCompactContextAfterRunForTarget",
    "preparePendingLabel",
    "readGlobalHumanInteractionEnabled",
    "buildThinkingPrompt",
    "buildHiddenRetryPrompt",
    "beforeLoadMessages",
    "getPendingSessionDraft",
    "stageRunBeforeUserMessage",
    "createMessageId",
    "bindRunIdentityBeforeUserBubble",
    "buildUserChatMessage",
    "appendUserMessage",
    "finishRunActivation",
    "takeContinuationPrompt",
    "beginStreamAttempt",
    "getSessionId",
    "resolveCliSessionIdForResume",
    "getRunId",
    "prepareOpenCodeSubagentRuntime",
    "shouldAnnounceSubagentMonitorUnavailable",
    "logSubagentMonitorStart",
    "createStartupWatchdog",
    "createSubagentMonitor",
    "watchdog.arm",
    "buildProcessLabel",
    "runCliStream",
    "isRunActive",
    "appendBoundedUtf8Text",
    "onStdoutChunk",
    "isRunActive",
    "appendBoundedUtf8Text",
    "onStderrChunk",
    "monitor.finish",
    "disposeSubagentRuntime",
    "watchdog.dispose",
    "onAttemptProcessStarted",
    "finishStreamAttempt",
    "adoptSession",
    "beginSuccessfulExit",
    "parseOpenCodeRunOutput",
    "appendParsedOutput",
    "maybeHandleNaturalLanguageHumanInteraction",
    "shouldRequireExplicitFinalAnswerForRun",
    "hasAssistantFinalConclusionAfterMessage",
    "resolveOpenCodeSuccessfulExitOutcome",
    "finalizeSuccessfulExit",
    "maybeAutoCompactContextAfterPromptSuccess",
  ]);
  assert.equal(scheduledTimers, 0);
  assert.equal(typeof ports.resolveMessageTarget, "function");
  assert.equal(typeof ports.publishSystem, "function");
});

test("stops before runtime preparation when the host guard skips", async () => {
  const events: string[] = [];
  const ports = createRecordingPorts(events, {
    guardRun: () => {
      events.push("guardRun");
      return { status: "skip" };
    },
  });

  await runOpenCodePromptTemplate(createInput({ displayPrompt: "" }), createTarget(), {}, ports);

  assert.deepEqual(events, ["guardRun"]);
});

test("does not read the global human interaction switch for loop runs", async () => {
  const events: string[] = [];
  const ports = createRecordingPorts(events, {
    runCliStream: (_cli, _prompt, handlers) => {
      events.push("runCliStream");
      handlers.onExit(0);
      return { kill: () => false };
    },
  });

  await runOpenCodePromptTemplate(createInput({ loopTaskId: "loop-1" }), createTarget(), { cwd: "/workspace" }, ports);

  assert.equal(events.includes("readGlobalHumanInteractionEnabled"), false);
  assert.equal(events.includes("resolveWorkspaceCwd"), false);
  assert.ok(events.indexOf("guardRun") < events.indexOf("prepareOpenCodeRuntime"));
  assert.ok(events.indexOf("prepareOpenCodeRuntime") < events.indexOf("buildThinkingPrompt"));
});

test("skips stdout and stderr ports when the run is no longer active", async () => {
  const events: string[] = [];
  const ports = createRecordingPorts(events, {
    isRunActive: () => {
      events.push("isRunActive");
      return false;
    },
    runCliStream: (_cli, _prompt, handlers) => {
      events.push("runCliStream");
      handlers.onStdout("out");
      handlers.onStderr("err");
      handlers.onExit(0);
      return { kill: () => false };
    },
    finishStreamAttempt: () => {
      events.push("finishStreamAttempt");
      return false;
    },
  });

  await runOpenCodePromptTemplate(createInput(), createTarget(), { cwd: "/workspace" }, ports);

  assert.equal(events.includes("onStdoutChunk"), false);
  assert.equal(events.includes("onStderrChunk"), false);
  assert.equal(events.includes("appendBoundedUtf8Text"), false);
  assert.equal(events.includes("adoptSession"), false);
  assert.ok(events.indexOf("runCliStream") < events.indexOf("finishStreamAttempt"));
});

test("retries a failed attempt before parsing a later successful exit", async () => {
  const events: string[] = [];
  let attempts = 0;
  const prompts: string[] = [];
  const ports = createRecordingPorts(events, {
    runCliStream: (_cli, prompt, handlers) => {
      const attemptIndex = attempts;
      attempts += 1;
      prompts.push(prompt);
      events.push("runCliStream");
      handlers.onExit(attemptIndex === 0 ? 1 : 0);
      return { kill: () => false };
    },
    evaluateFailedAttempt: () => {
      events.push("evaluateFailedAttempt");
      return { hiddenRetryCount: 0, shouldRetry: true };
    },
  });

  await runOpenCodePromptTemplate(createInput(), createTarget(), { cwd: "/workspace" }, ports);

  assert.deepEqual(prompts, ["thinking", "hidden-retry"]);
  const retryEvents = events.slice(events.indexOf("evaluateFailedAttempt"));
  assert.deepEqual(retryEvents.slice(0, 6), [
    "evaluateFailedAttempt",
    "recordFailedAttemptRetry",
    "takeContinuationPrompt",
    "getHiddenRetryDelayMs",
    "waitForHiddenRetryDelay",
    "prepareHiddenRetry",
  ]);
  assert.ok(retryEvents.includes("publishSystem"));
  assert.ok(retryEvents.includes("logHiddenRetry"));
  assert.equal(events.includes("finalizeFailedAttempt"), false);
});
