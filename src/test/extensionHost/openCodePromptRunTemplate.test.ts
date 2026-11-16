import test = require("node:test");
import assert = require("node:assert/strict");
import { runOpenCodePromptTemplate } from "../../extensionHost/openCodePromptRunTemplate";
import type { OpenCodePromptRunPorts } from "../../extensionHost/openCodePromptRunTemplate";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";
import { loopSubtaskAutoCompactions } from "../../loopSubtaskAutoCompact";

type RecordedPort = OpenCodePromptRunPorts & {
  events: string[];
};

function createRuntimePreparation() {
  return {
    configId: "open-config",
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
      executionModel: input.executionModel,
      executionProfile: input.executionProfile,
      createdAt,
    }),
    appendUserMessage: () => {
      events.push("appendUserMessage");
    },
    replaceUserMessage: () => {
      events.push("replaceUserMessage");
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
    recoverOpenCodeMissingAssistantOutput: async () => call("recoverOpenCodeMissingAssistantOutput", {
      finalText: null,
      errorText: null,
      statusText: null,
      hasStructuredFinalAnswer: false,
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

test("cancelling during OpenCode configuration preparation prevents run activation", async () => {
  const events: string[] = [];
  let aborted = false;
  const ports = createRecordingPorts(events, {
    prepareOpenCodeRuntime: async () => {
      aborted = true;
      return createRuntimePreparation();
    },
  });
  await runOpenCodePromptTemplate(createInput(), createTarget(), { isAborted: () => aborted }, ports);
  assert.equal(events.includes("finishRunActivation"), false);
  assert.equal(events.includes("runCliStream"), false);
});

test("cancelling during OpenCode subagent preparation disposes resources without spawning", async () => {
  const events: string[] = [];
  let aborted = false;
  const ports = createRecordingPorts(events, {
    prepareOpenCodeSubagentRuntime: async () => {
      aborted = true;
      return {
        connection: null,
        endpointSource: "unavailable",
        error: null,
        dispose: () => { events.push("disposed"); },
      };
    },
  });
  await runOpenCodePromptTemplate(createInput(), createTarget(), { isAborted: () => aborted }, ports);
  assert.equal(events.includes("disposed"), true);
  assert.equal(events.includes("runCliStream"), false);
  assert.equal(events.includes("finalizeSuccessfulExit"), false);
});

test("recovers an empty OpenCode stdout before judging the final answer", async () => {
  const events: string[] = [];
  const ports = createRecordingPorts(events, {
    parseOpenCodeRunOutput: () => {
      events.push("parseOpenCodeRunOutput");
      return {
        finalText: null,
        errorText: null,
        statusText: null,
        hasStructuredFinalAnswer: false,
      };
    },
    recoverOpenCodeMissingAssistantOutput: async () => {
      events.push("recoverOpenCodeMissingAssistantOutput");
      return {
        finalText: "Hello",
        errorText: null,
        statusText: null,
        hasStructuredFinalAnswer: true,
      };
    },
  });

  await runOpenCodePromptTemplate(createInput(), createTarget(), { cwd: "/workspace" }, ports);

  assert.ok(events.indexOf("parseOpenCodeRunOutput") < events.indexOf("recoverOpenCodeMissingAssistantOutput"));
  assert.ok(events.indexOf("recoverOpenCodeMissingAssistantOutput") < events.indexOf("appendParsedOutput"));
  assert.ok(events.includes("finalizeSuccessfulExit"));
});

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

test("OpenCode subtask returns its result before notification starts background compaction", { timeout: 2000 }, async () => {
  const events: string[] = [];
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const ports = createRecordingPorts(events, {
    maybeAutoCompactContextAfterPromptSuccess: async (target, sessionId, _duration, options) => {
      assert.equal(target.sessionId, "session-1");
      assert.equal(sessionId, "session-1");
      assert.deepEqual(options, { isolatedRun: true });
      events.push("compact");
      await gate;
    },
  });
  await runOpenCodePromptTemplate(createInput({ taskRole: "subtask", loopTaskId: "opencode-report-first", loopSubtaskId: "child" }), createTarget(), { cwd: "/workspace" }, ports);
  assert.ok(events.includes("finalizeSuccessfulExit"));
  assert.equal(events.includes("compact"), false);
  events.push("reported");
  loopSubtaskAutoCompactions.notify("opencode-report-first", "child", true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(events.indexOf("reported") < events.indexOf("compact"));
  finish();
  await loopSubtaskAutoCompactions.wait("opencode", "session-1");
});

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


test("records the effective OpenCode model and preserves each prompt snapshot", async () => {
  const messages: import("../../webview/types").ChatMessage[] = [];
  const ports = createRecordingPorts([], {
    getPendingSessionDraft: () => ({ messages }),
    appendUserMessage: (target, message) => { target.push(message); },
  });
  await runOpenCodePromptTemplate(createInput({ model: "requested-model" }), createTarget(), {}, ports);
  assert.equal(messages[0]?.executionModel, "effective-model");
  assert.deepEqual(messages[0]?.executionProfile, {
    configId: "open-config", model: "effective-model", thinkingMode: "medium", openCodeVariant: null,
  });
  ports.prepareOpenCodeRuntime = async () => ({ ...createRuntimePreparation(), effectiveModel: "next-model" });
  await runOpenCodePromptTemplate(createInput(), createTarget(), {}, ports);
  assert.deepEqual(messages.map((message) => message.executionModel), ["effective-model", "next-model"]);
  assert.deepEqual(messages.map((message) => message.executionProfile?.model), ["effective-model", "next-model"]);
});

for (const taskRole of ["main", "subtask"] as const) {
  test(`OpenCode ${taskRole} forwards bound role thinking to the actual variant preparation`, async () => {
    let captured: unknown;
    const ports = createRecordingPorts([], {
      prepareOpenCodeRuntime: async (input) => {
        captured = input;
        return createRuntimePreparation();
      },
    });
    await runOpenCodePromptTemplate(createInput({
      taskRole, loopTaskId: "task", model: "provider/bound-model", thinkingModeOverride: taskRole === "main" ? "high" : "low",
      loopMainThinkingMode: "xhigh", loopSubtaskThinkingMode: "medium",
    }), createTarget(), {}, ports);
    assert.deepEqual(captured, { role: taskRole, model: "provider/bound-model", variant: taskRole === "main" ? "high" : "low", requiresSubtaskModel: true });
  });
}

test("OpenCode host-pinned exact variant and explicit CLI default override visible role thinking", async () => {
  for (const variant of ["custom-variant", null]) {
    let captured: unknown;
    const ports = createRecordingPorts([], { prepareOpenCodeRuntime: async (input) => { captured = input; return createRuntimePreparation(); } });
    await runOpenCodePromptTemplate(createInput({ taskRole: "subtask", loopTaskId: "leader", model: "provider/model", thinkingModeOverride: "high",
      executionProfile: { configId: "open-config", model: "provider/model", thinkingMode: "high", openCodeVariant: variant },
    }), createTarget(), {}, ports);
    assert.deepEqual(captured, { role: "subtask", model: "provider/model", variant, requiresSubtaskModel: true });
  }
});

test("fills the execution model on a preloaded OpenCode prompt without duplicating it", async () => {
  const message: import("../../webview/types").ChatMessage = {
    id: "preloaded", role: "user", content: "ship the template", createdAt: 123,
  };
  const messages = [message];
  const replacements: unknown[] = [];
  const ports = createRecordingPorts([], {
    getPendingSessionDraft: () => ({ messages }),
    appendUserMessage: () => { assert.fail("preloaded message must remain unique"); },
    replaceUserMessage: (replacement) => { replacements.push({ ...replacement }); },
  });
  await runOpenCodePromptTemplate(createInput({ preloadedUserMessageId: message.id }), createTarget(), {}, ports);
  assert.equal(messages.length, 1);
  assert.equal(message.executionModel, "effective-model");
  assert.deepEqual(message.executionProfile, {
    configId: "open-config", model: "effective-model", thinkingMode: "medium", openCodeVariant: null,
  });
  assert.equal(message.createdAt, 123);
  assert.deepEqual(replacements, [message]);
});

test("department Owner transport leaves monitoring servers in Owner ownership and preserves output callbacks", async () => {
  const events: string[] = [];
  const ports = createRecordingPorts(events, {
    prepareOpenCodeSubagentRuntime: async () => { assert.fail("EH must not prepare its own server for Owner execution"); },
  });
  await runOpenCodePromptTemplate(createInput(), createTarget(), { departmentProcessStream: ports.runCliStream }, ports);
  assert.ok(events.includes("runCliStream"));
  assert.ok(events.includes("appendBoundedUtf8Text"));
  assert.equal(events.includes("prepareOpenCodeSubagentRuntime"), false);
  assert.equal(events.includes("applyThinkingWorkspaceFiles"), false);
  assert.equal(events.includes("maybeAutoCompactContextAfterPromptSuccess"), false);
});

for (const owned of [false, true]) {
  test(`${owned ? "Owner" : "zero-budget ordinary"} stream cannot retry despite a positive failure evaluation`, async () => {
    const events: string[] = [];
    let attempts = 0;
    const ports = createRecordingPorts(events, {
      maxHiddenRetries: owned ? 3 : 0,
      runCliStream: (_cli, _prompt, handlers) => {
        attempts++;
        assert.equal(attempts, 1, "no invocation replay");
        handlers.onExit(1);
        return { kill: () => false };
      },
      evaluateFailedAttempt: () => ({ hiddenRetryCount: 0, shouldRetry: true }),
    });
    await runOpenCodePromptTemplate(createInput(), createTarget(), owned ? { departmentProcessStream: ports.runCliStream } : {}, ports);
    assert.equal(attempts, 1);
    assert.ok(events.includes("finalizeFailedAttempt"));
    for (const event of ["recordFailedAttemptRetry", "waitForHiddenRetryDelay", "prepareHiddenRetry", "publishSystem", "logHiddenRetry"]) {
      assert.equal(events.includes(event), false, event);
    }
  });
}

test("Owner stream with no conclusion cannot recover a fresh session under an ordinary retry budget", async () => {
  const { resolveOpenCodeSuccessfulExitOutcome } = require("../../openCodeRunCompletion") as typeof import("../../openCodeRunCompletion");
  const events: string[] = [];
  const empty = { finalText: null, errorText: null, statusText: null, hasStructuredFinalAnswer: false };
  let attempts = 0;
  const ports = createRecordingPorts(events, {
    maxHiddenRetries: 3,
    runCliStream: (_cli, _prompt, handlers) => {
      assert.equal(++attempts, 1);
      handlers.onExit(0);
      return { kill: () => false };
    },
    parseOpenCodeRunOutput: () => empty,
    recoverOpenCodeMissingAssistantOutput: async () => empty,
    resolveOpenCodeSuccessfulExitOutcome,
    shouldRecoverOpenCodeLoopMainSessionInFreshSession: () => { assert.fail("cannot replace an Owner session"); },
  });
  await runOpenCodePromptTemplate(createInput({ taskRole: "main", loopTaskId: "leader" }), createTarget(), { departmentProcessStream: ports.runCliStream }, ports);
  assert.ok(events.includes("finalizeMissingFinalConclusion"));
  assert.equal(events.includes("publishMissingConclusionRetry"), false);
  assert.equal(events.includes("waitForHiddenRetryDelay"), false);
});

test("classic managed main consumes its exact native response before monitor/server disposal", async t => {
  const http = await import("http"), fs = await import("fs"), os = await import("os"), path = await import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classic-managed-test-")), cwd = fs.realpathSync(root);
  const events: string[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/event?")) {
      res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); return;
    }
    if (req.method === "GET") { res.end(JSON.stringify({ id: "ses_fixed", directory: cwd })); return; }
    assert.ok(events.includes("monitor.parent:ses_fixed"));
    assert.ok(!events.includes("server.dispose"));
    const body = JSON.parse(raw); assert.equal(body.parts[0].text, "thinking");
    res.end(JSON.stringify({ info: { id: "msg_response", role: "assistant", sessionID: "ses_fixed", parentID: body.messageID,
      providerID: "local", modelID: "model", path: { cwd }, time: { completed: Date.now() }, finish: "stop" },
      parts: [{ id: "prt_response", type: "text", sessionID: "ses_fixed", messageID: "msg_response", text: "native decision" }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true }); });
  const ports = createRecordingPorts(events, {
    getSessionId: () => "ses_fixed",
    prepareOpenCodeRuntime: async () => ({ ...createRuntimePreparation(), effectiveModel: "local/model" }),
    prepareOpenCodeSubagentRuntime: async () => ({ connection: { serverUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }, endpointSource: "managed-server", error: null, dispose: () => { events.push("server.dispose"); } }),
    createSubagentMonitor: () => ({ setParentSessionId: id => { events.push(`monitor.parent:${id}`); }, pollNow: async () => {}, finish: () => { events.push("monitor.finished"); }, dispose: () => {} }),
    runCliStream: () => { assert.fail("must not execute the attached command a second time"); },
    onStdoutChunk: chunk => { assert.match(chunk, /native decision/); events.push("native.output"); },
    adoptSession: adoption => { assert.match(adoption.rawStdout, /ses_fixed/); events.push("native.adopt"); },
  });
  await runOpenCodePromptTemplate(createInput({ taskRole: "main", loopTaskId: "root" }), createTarget(), { cwd }, ports);
  assert.ok(events.indexOf("native.output") < events.indexOf("monitor.finished"));
  assert.ok(events.indexOf("monitor.finished") < events.indexOf("server.dispose"));
  assert.ok(events.indexOf("server.dispose") < events.indexOf("native.adopt"));
  assert.ok(events.includes("finalizeSuccessfulExit"));
});
