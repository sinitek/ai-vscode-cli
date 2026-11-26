import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import {
  isClaudeCompactBoundaryMessage,
  isClaudeCompactingStatusMessage,
  isClaudeNativeCompactUnsupportedError,
} from "../../interactive/claudeCompaction";

const {
  ClaudeInteractiveRunner,
  isClaudeEndTurnStop,
  isClaudeFailedFinalResult,
  isClaudeSuccessfulFinalResult,
  isClaudeToolUseStop,
  mapClaudeThinkingEffort,
  readClaudeAssistantStopReason,
} = require("../../interactive/claudeRunner") as typeof import("../../interactive/claudeRunner");
const dynamicImportModule = require("../../interactive/dynamicImport") as typeof import("../../interactive/dynamicImport");

test("detects Claude compacting status messages", () => {
  assert.equal(
    isClaudeCompactingStatusMessage({
      type: "system",
      subtype: "status",
      status: "compacting",
    }),
    true
  );
  assert.equal(
    isClaudeCompactingStatusMessage({
      type: "system",
      subtype: "status",
      status: null,
    }),
    false
  );
});

test("detects Claude compact boundary messages", () => {
  assert.equal(
    isClaudeCompactBoundaryMessage({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: {
        trigger: "manual",
        pre_tokens: 8192,
      },
    }),
    true
  );
  assert.equal(
    isClaudeCompactBoundaryMessage({
      type: "system",
      subtype: "status",
      status: "compacting",
    }),
    false
  );
});

test("detects unsupported native Claude compact errors", () => {
  assert.equal(
    isClaudeNativeCompactUnsupportedError(new Error("Unknown slash command: /compact")),
    true
  );
  assert.equal(
    isClaudeNativeCompactUnsupportedError(new Error("Slash command /compact is not supported in this environment")),
    true
  );
  assert.equal(
    isClaudeNativeCompactUnsupportedError(new Error("No conversation found with session ID: abc")),
    false
  );
});

test("preserves ultra in the Claude --effort path", () => {
  assert.equal(mapClaudeThinkingEffort("ultra"), "ultra");
  assert.equal(mapClaudeThinkingEffort("max"), "max");
  assert.equal(mapClaudeThinkingEffort("off"), null);
});

test("passes AbortController to Claude SDK query and aborts active runs", async (t) => {
  const originalDynamicImport = dynamicImportModule.dynamicImport;
  const captured: { abortController?: AbortController } = {};
  let resolveQueryStarted: (() => void) | null = null;
  const queryStarted = new Promise<void>((resolve) => {
    resolveQueryStarted = resolve;
  });

  dynamicImportModule.dynamicImport = async () => ({
    query: ({ options }: { options: { abortController?: AbortController } }) => {
      captured.abortController = options.abortController;
      resolveQueryStarted?.();
      return (async function* stream() {
        yield { type: "system", subtype: "status", status: "running" };
        await new Promise<void>((_resolve, reject) => {
          options.abortController?.signal.addEventListener("abort", () => {
            const error = new Error("mock claude aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      })();
    },
  }) as any;
  t.after(() => {
    dynamicImportModule.dynamicImport = originalDynamicImport;
  });

  const runner = new ClaudeInteractiveRunner({
    command: "claude",
    args: [],
    thinkingMode: "medium",
    interactiveMode: "coding",
    sessionId: null,
  });
  const runPromise = runner.runStreamed("test", {
    onAssistantDelta: () => {},
    onTrace: () => {},
    onTaskListUpdate: () => {},
    onSessionId: () => {},
  });

  await queryStarted;
  const abortController = captured.abortController;
  assert.ok(abortController);
  assert.equal(abortController.signal.aborted, false);

  runner.stopAndRebuild();
  assert.equal(abortController.signal.aborted, true);
  await assert.rejects(runPromise, { name: "AbortError" });
});

test("Claude SDK custom spawn uses shared environment policy and keeps AbortSignal", async (t) => {
  const originalDynamicImport = dynamicImportModule.dynamicImport;
  let resolveCaptured: ((value: { spawn: Function; signal: AbortSignal; includePartialMessages?: boolean }) => void) | undefined;
  const captured = new Promise<{ spawn: Function; signal: AbortSignal; includePartialMessages?: boolean }>((resolve) => { resolveCaptured = resolve; });
  dynamicImportModule.dynamicImport = async () => ({
    query: ({ options }: { options: { abortController: AbortController; spawnClaudeCodeProcess: Function; includePartialMessages?: boolean } }) => {
      resolveCaptured?.({ spawn: options.spawnClaudeCodeProcess, signal: options.abortController.signal, includePartialMessages: options.includePartialMessages });
      return (async function* stream() {
        await new Promise<void>((_resolve, reject) => options.abortController.signal.addEventListener("abort", () => {
          const error = new Error("aborted"); error.name = "AbortError"; reject(error);
        }, { once: true }));
      })();
    },
  }) as any;
  t.after(() => { dynamicImportModule.dynamicImport = originalDynamicImport; });
  const runner = new ClaudeInteractiveRunner({
    command: "claude", args: [], thinkingMode: "off", interactiveMode: "coding", sessionId: null,
    env: { PATH: process.env.PATH ?? "", CLAUDE_POLICY_SENTINEL: "preserved" },
  });
  const run = runner.runStreamed("test", { onAssistantDelta: () => {}, onTrace: () => {}, onTaskListUpdate: () => {}, onSessionId: () => {} });
  const runtime = await captured;
  assert.equal(runtime.includePartialMessages, true);
  const child = runtime.spawn({
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.env.CLAUDE_POLICY_SENTINEL || '')"],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "", CLAUDE_POLICY_SENTINEL: "preserved" },
    signal: runtime.signal,
  }) as import("child_process").ChildProcess;
  let output = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
  assert.equal(output, "preserved");
  runner.stopAndRebuild();
  await assert.rejects(run, { name: "AbortError" });
});

test("keeps user Claude tools available when project instructions are isolated", async (t) => {
  const originalDynamicImport = dynamicImportModule.dynamicImport;
  const capturedOptions: { value: { permissionMode?: string; allowDangerouslySkipPermissions?: boolean; allowedTools?: string[]; settingSources?: string[] } | null } = { value: null };
  dynamicImportModule.dynamicImport = (async () => ({
    query: ({ options }: { options: { permissionMode?: string; allowDangerouslySkipPermissions?: boolean; allowedTools?: string[]; settingSources?: string[] } }) => {
      capturedOptions.value = options;
      return (async function* stream() {
        yield { type: "result", subtype: "success", result: "ok" };
      })();
    },
  })) as typeof dynamicImportModule.dynamicImport;
  t.after(() => {
    dynamicImportModule.dynamicImport = originalDynamicImport;
  });

  const runner = new ClaudeInteractiveRunner({
    command: "claude",
    args: [],
    cwd: process.cwd(),
    thinkingMode: "off",
    interactiveMode: "coding",
    sessionId: null,
    isolateProjectInstructions: true,
  });
  try {
    await expectSoon(runner.runStreamed("test", {
      onAssistantDelta: () => {},
      onTrace: () => {},
      onTaskListUpdate: () => {},
      onSessionId: () => {},
    }), "isolated Claude turn");
    assert.ok(capturedOptions.value);
    assert.deepEqual(capturedOptions.value.settingSources, ["user"]);
    assert.equal(capturedOptions.value.permissionMode, "bypassPermissions");
    assert.equal(capturedOptions.value.allowDangerouslySkipPermissions, true);
    assert.deepEqual(capturedOptions.value.allowedTools, ["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop"]);
  } finally {
    runner.dispose();
  }
});

for (const scenario of [
  { mode: "coding", isolated: false, sessionId: null },
  { mode: "coding", isolated: false, sessionId: "resumed-network-session" },
  { mode: "loop", isolated: true, sessionId: null },
  { mode: "loop_plus", isolated: true, sessionId: null },
  { mode: "plan", isolated: false, sessionId: null },
] as const) {
  test(`applies Claude network policy to every ${scenario.mode} turn (isolated=${scenario.isolated}, resumed=${Boolean(scenario.sessionId)})`, async (t) => {
    const originalDynamicImport = dynamicImportModule.dynamicImport;
    const requests: Array<Array<{ type: string; text: string }>> = [];
    const queryOptions: Array<Record<string, unknown>> = [];
    dynamicImportModule.dynamicImport = (async () => ({
      query: ({ prompt, options }: {
        prompt: AsyncIterable<{ message: { content: Array<{ type: string; text: string }> } }>;
        options: Record<string, unknown>;
      }) => {
        queryOptions.push(options);
        return (async function* stream() {
          for await (const message of prompt) {
            requests.push(message.message.content);
            yield { type: "result", subtype: "success", result: "ok" };
          }
        })();
      },
    })) as typeof dynamicImportModule.dynamicImport;
    t.after(() => {
      dynamicImportModule.dynamicImport = originalDynamicImport;
    });

    const runner = new ClaudeInteractiveRunner({
      command: "claude",
      args: [],
      cwd: process.cwd(),
      thinkingMode: "off",
      interactiveMode: scenario.mode,
      sessionId: scenario.sessionId,
      isolateProjectInstructions: scenario.isolated,
    });
    try {
      await expectSoon(runner.runForText("今天上海天气"), "first network turn");
      await expectSoon(runner.runForText("继续核对天气日期"), "second network turn");
      await expectSoon(runner.runForText("/compact 保留天气结果"), "native compact input");
      assert.equal(queryOptions.length, 1);
      assert.deepEqual(queryOptions[0].disallowedTools, ["WebSearch", "WebFetch"]);
      assert.equal(queryOptions[0].tools, undefined);
      assert.equal(queryOptions[0].permissionMode, scenario.mode === "plan" ? "plan" : "bypassPermissions");
      assert.deepEqual(queryOptions[0].settingSources, scenario.isolated ? ["user"] : ["user", "project", "local"]);
      assert.equal(queryOptions[0].resume, scenario.sessionId ?? undefined);
      assert.equal(requests.length, 3);
      assert.equal(requests[0][0].text, "今天上海天气");
      assert.equal(requests[1][0].text, "继续核对天气日期");
      for (const content of requests.slice(0, 2)) {
        assert.equal(content.length, 2);
        assert.match(content[1].text, /不要使用 WebSearch/);
        assert.match(content[1].text, /https:\/\/wttr\.in\/Shanghai\?format=j1/);
      }
      assert.deepEqual(requests[2], [{ type: "text", text: "/compact 保留天气结果" }]);
    } finally {
      runner.dispose();
    }
  });
}

test("reuses one Claude query across turns, interrupts without aborting, and closes once", async (t) => {
  const originalDynamicImport = dynamicImportModule.dynamicImport;
  const prompts: string[] = [];
  const resumeIds: Array<string | undefined> = [];
  let queryCalls = 0;
  let interruptCalls = 0;
  let inputFinished = 0;
  const captured: { abortController: AbortController | null } = { abortController: null };
  const pendingResults: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];

  const pushResult = (message: Record<string, unknown>): void => {
    pendingResults.push(message);
    waiters.splice(0).forEach((wake) => wake());
  };

  dynamicImportModule.dynamicImport = async () => ({
    query: ({ prompt, options }: { prompt: AsyncIterable<any>; options: { abortController?: AbortController; resume?: string } }) => {
      queryCalls += 1;
      captured.abortController = options.abortController ?? null;
      resumeIds.push(options.resume);
      void (async () => {
        try {
          for await (const message of prompt) {
            const content = message?.message?.content;
            const text = Array.isArray(content) ? content[0]?.text : "";
            if (typeof text === "string") {
              prompts.push(text);
            }
          }
        } finally {
          inputFinished += 1;
        }
      })();
      return {
        interrupt: async () => {
          interruptCalls += 1;
          pushResult({ type: "result", subtype: "error", is_error: true, result: "interrupted" });
        },
        async *[Symbol.asyncIterator]() {
          while (!options.abortController?.signal.aborted) {
            if (!pendingResults.length) {
              await new Promise<void>((resolve) => {
                const abortSignal = options.abortController?.signal;
                const onAbort = (): void => resolve();
                if (abortSignal?.aborted) {
                  resolve();
                  return;
                }
                abortSignal?.addEventListener("abort", onAbort, { once: true });
                waiters.push(() => {
                  abortSignal?.removeEventListener("abort", onAbort);
                  resolve();
                });
              });
              continue;
            }
            const nextMessage = pendingResults.shift();
            if (nextMessage) {
              yield nextMessage;
            }
          }
        },
      };
    },
  }) as any;
  t.after(() => {
    dynamicImportModule.dynamicImport = originalDynamicImport;
  });

  const runner = new ClaudeInteractiveRunner({
    command: "claude",
    args: [],
    thinkingMode: "medium",
    interactiveMode: "coding",
    sessionId: null,
  });
  const handlers = {
    onAssistantDelta: () => {},
    onTrace: () => {},
    onTaskListUpdate: () => {},
    onSessionId: () => {},
  };
  const waitForPrompt = async (prompt: string): Promise<void> => {
    const startedAt = Date.now();
    while (!prompts.includes(prompt)) {
      if (Date.now() - startedAt > 1000) {
        throw new Error(`timed out waiting for prompt ${prompt}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const firstRun = runner.runStreamed("first", handlers);
  await waitForPrompt("first");
  assert.equal(queryCalls, 1);
  pushResult({
    type: "assistant",
    session_id: "claude-session-1",
    message: { id: "m1", content: [{ type: "text", text: "hello" }] },
  });
  pushResult({ type: "result", subtype: "success", session_id: "claude-session-1", result: "" });
  await firstRun;
  assert.equal(runner.getSessionId(), "claude-session-1");
  assert.equal(captured.abortController?.signal.aborted, false);

  const secondRun = runner.runStreamed("second", handlers);
  await waitForPrompt("second");
  assert.equal(queryCalls, 1);
  runner.stopAndRebuild();
  assert.equal(interruptCalls, 1);
  assert.equal(captured.abortController?.signal.aborted, false);
  await assert.rejects(secondRun, { name: "AbortError" });

  const thirdRun = runner.runStreamed("third", handlers);
  await waitForPrompt("third");
  assert.equal(queryCalls, 1);
  pushResult({ type: "result", subtype: "error_max_turns", session_id: "claude-session-1", result: "cap" });
  await thirdRun;
  assert.equal(captured.abortController?.signal.aborted, true);

  const fourthRun = runner.runStreamed("fourth", handlers);
  await waitForPrompt("fourth");
  assert.equal(queryCalls, 2);
  assert.deepEqual(resumeIds[1], "claude-session-1");
  pushResult({ type: "result", subtype: "success", session_id: "claude-session-1", result: "done" });
  await fourthRun;

  runner.dispose();
  runner.dispose();
  assert.equal(runner.isDisposed(), true);
  const finishedAt = Date.now();
  while (inputFinished < 2) {
    if (Date.now() - finishedAt > 1000) {
      throw new Error(`expected both Claude inputs to close once, closed ${inputFinished}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(inputFinished, 2);
});

test("reads Claude native completion signals from assistant and result events", () => {
  const endTurn = {
    type: "assistant",
    message: { stop_reason: "end_turn", content: [{ type: "text", text: "Hi" }] },
  };
  const streamedEndTurn = {
    type: "stream_event",
    event: { type: "message_delta", delta: { stop_reason: "end_turn" } },
  };
  const toolUse = {
    type: "stream_event",
    event: { type: "message_delta", delta: { stop_reason: "tool_use" } },
  };
  assert.equal(readClaudeAssistantStopReason(endTurn), "end_turn");
  assert.equal(isClaudeEndTurnStop(streamedEndTurn), true);
  assert.equal(isClaudeToolUseStop(toolUse), true);
  assert.equal(isClaudeEndTurnStop({ type: "assistant", message: { stop_reason: "max_tokens" } }), false);
  assert.equal(readClaudeAssistantStopReason({ type: "system", subtype: "turn_duration" }), "");
  assert.equal(isClaudeSuccessfulFinalResult({ type: "result", subtype: "success", is_error: false }), true);
  assert.equal(isClaudeSuccessfulFinalResult({ type: "result", subtype: "", is_error: false }), true);
  assert.equal(isClaudeSuccessfulFinalResult({ type: "result", subtype: "error_during_execution", is_error: true }), false);
  assert.equal(isClaudeFailedFinalResult({ type: "result", subtype: "error_during_execution", is_error: true }), true);
});

type ClaudeTurnLogEntry =
  | { kind: "event"; event: unknown }
  | { kind: "delta"; text: string }
  | { kind: "trace"; content: string; traceKind?: string; merge?: boolean }
  | { kind: "tasks"; items: { text: string; done: boolean }[] };

function createClaudeTurnRecorder(): {
  log: ClaudeTurnLogEntry[];
  handlers: {
    onAssistantDelta: (chunk: string) => void;
    onTrace: (content: string, kind?: "thinking" | "normal" | "tool-use", meta?: { merge?: boolean }) => void;
    onTaskListUpdate: (items: { text: string; done: boolean }[]) => void;
    onSessionId: (sessionId: string) => void;
    onEvent: (event: unknown) => void;
  };
} {
  const log: ClaudeTurnLogEntry[] = [];
  return {
    log,
    handlers: {
      onAssistantDelta: (text) => {
        log.push({ kind: "delta", text });
      },
      onTrace: (content, traceKind, meta) => {
        log.push({ kind: "trace", content, traceKind, merge: meta?.merge });
      },
      onTaskListUpdate: (items) => {
        log.push({ kind: "tasks", items });
      },
      onSessionId: () => {},
      onEvent: (event) => {
        log.push({ kind: "event", event });
      },
    },
  };
}

function installScriptedClaudeQuery(
  t: { after: (fn: () => void) => void },
  scripts: Record<string, unknown[]>,
  queryCalls?: { count: number },
): void {
  const originalDynamicImport = dynamicImportModule.dynamicImport;
  dynamicImportModule.dynamicImport = (async () => ({
    query: ({ prompt }: { prompt: AsyncIterable<{ message?: { content?: Array<{ text?: string }> } }> }) => {
      if (queryCalls) {
        queryCalls.count += 1;
      }
      return (async function* stream() {
        for await (const message of prompt) {
          const text = message?.message?.content?.[0]?.text ?? "";
          const scripted = scripts[text] ?? [];
          for (const item of scripted) {
            yield item;
          }
        }
      })();
    },
  })) as typeof dynamicImportModule.dynamicImport;
  t.after(() => {
    dynamicImportModule.dynamicImport = originalDynamicImport;
  });
}

function createClaudeEventRunner(): InstanceType<typeof ClaudeInteractiveRunner> {
  return new ClaudeInteractiveRunner({
    command: "claude",
    args: [],
    thinkingMode: "off",
    interactiveMode: "coding",
    sessionId: null,
  });
}

test("wires per-request Claude usage with per-turn state and excludes child sessions", async (t) => {
  const root = { session_id: "usage-main", parent_tool_use_id: null };
  const start = (id: string, model: string) => ({
    ...root, type: "stream_event", event: {
      type: "message_start", message: {
        id, model, usage: { input_tokens: 11, cache_read_input_tokens: 37, cache_creation_input_tokens: 23, output_tokens: 1 },
      },
    },
  });
  const delta = (output: number) => ({
    ...root, type: "stream_event", event: { type: "message_delta", usage: { output_tokens: output } },
  });
  installScriptedClaudeQuery(t, {
    first: [
      { ...root, type: "system", subtype: "init", model: "configured-alias" },
      start("request-first", "model-a"),
      { ...start("request-child", "child-model"), session_id: "child-session", parent_tool_use_id: "agent-tool" },
      delta(19),
      { ...root, type: "result", subtype: "success", modelUsage: { "model-a": { contextWindow: 123456, inputTokens: 99999 } } },
      delta(999999),
    ],
    second: [
      delta(999999),
      start("request-second", "model-b"),
      delta(20),
      { ...root, type: "result", subtype: "success", modelUsage: { "model-a": { contextWindow: 123456 } } },
    ],
    third: [{ ...root, type: "result", subtype: "success", modelUsage: { "model-b": { contextWindow: 654321, inputTokens: 99999 } } }],
  });
  const runner = createClaudeEventRunner();
  t.after(() => runner.dispose());
  const updates: import("../../interactive/claudeContextUsage").ClaudeContextUsageUpdate[] = [];
  const sessions: string[] = [];
  const handlers = {
    ...createClaudeTurnRecorder().handlers,
    onSessionId: (id: string) => sessions.push(id),
    onTokenUsageUpdate: (usage: import("../../interactive/claudeContextUsage").ClaudeContextUsageUpdate) => updates.push(usage),
  };
  await expectSoon(runner.runStreamed("first", handlers), "usage first");
  await expectSoon(runner.runStreamed("second", handlers), "usage second");
  await expectSoon(runner.runStreamed("third", handlers), "usage third");
  assert.deepEqual(sessions, ["usage-main"]);
  assert.equal(runner.getSessionId(), "usage-main");
  assert.deepEqual(updates, [
    { sessionId: "usage-main", tokensInContextWindow: 90, modelContextWindow: null },
    { sessionId: "usage-main", tokensInContextWindow: 90, modelContextWindow: 123456, contextWindowSource: "claude-model-window" },
    { sessionId: "usage-main", tokensInContextWindow: 91, modelContextWindow: null },
  ]);
});

function expectSoon<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function summarizeClaudeTurn(log: ClaudeTurnLogEntry[]): string[] {
  return log.map((entry) => {
    if (entry.kind === "event") {
      const eventType = entry.event && typeof entry.event === "object"
        ? (entry.event as { type?: unknown }).type
        : undefined;
      return `event:${typeof eventType === "string" ? eventType : "none"}`;
    }
    if (entry.kind === "delta") {
      return `delta:${entry.text}`;
    }
    if (entry.kind === "tasks") {
      return `tasks:${JSON.stringify(entry.items)}`;
    }
    const firstLine = entry.content.split("\n")[0] ?? "";
    return `trace:${entry.traceKind ?? "default"}:${String(entry.merge)}:${firstLine}`;
  });
}

test("dispatches one Claude turn by message type and keeps callback order", async (t) => {
  const readToolUse = {
    type: "tool_use",
    id: "tool-1",
    name: "Read",
    input: { path: "a.ts" },
    content: "not a result",
  };
  installScriptedClaudeQuery(t, {
    order: [
      { type: "notice" },
      { type: "tool_progress", tool_use_id: "tool-1" },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          id: "stream-1",
          delta: { type: "text_delta", text: "Hel" },
          message: {
            id: "asst-1",
            content: [
              { type: "thinking", thinking: "   " },
              { type: "thinking", thinking: "plan the answer" },
              readToolUse,
            ],
          },
        },
      },
      {
        type: "assistant",
        message: {
          id: "asst-1",
          content: [
            { type: "text", text: "Hello" },
            { type: "thinking", thinking: "plan the answer", signature: "sig-1" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { path: "a.ts" } },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          id: "asst-1",
          content: [{ type: "text", text: "Hello world" }],
        },
      },
      {
        type: "assistant",
        message: {
          id: "asst-2",
          content: [{ type: "text", text: "Reset" }],
        },
      },
      {
        type: "user",
        message: {
          id: "user-1",
          content: [
            { type: "thinking", thinking: "check output" },
            { type: "tool_result", tool_use_id: "tool-1", content: "file contents" },
          ],
        },
        tool_use_result: {
          todos: [{ content: "ship it", status: "pending" }],
        },
      },
      {
        type: "system",
        subtype: "hook_response",
        hook_name: "pre",
        stdout: "ok",
        stderr: "warn",
      },
      { type: "system", subtype: "status", status: "running" },
      { type: "system", subtype: "compact_boundary" },
      { type: "system", subtype: "status", status: null },
      { type: "stream_event" },
      { type: "assistant" },
      {
        type: "user",
        tool_use_result: { todos: [{ content: "ignored", status: "pending" }] },
      },
      {},
      { type: "result", subtype: "success", result: "should-not-fallback" },
    ],
  });
  const runner = createClaudeEventRunner();
  const recorded = createClaudeTurnRecorder();
  try {
    await expectSoon(runner.runStreamed("order", recorded.handlers), "ordered turn");
    assert.deepEqual(summarizeClaudeTurn(recorded.log), [
      "event:notice",
      "event:tool_progress",
      "event:stream_event",
      "delta:Hel",
      "trace:thinking:false:thinking plan the answer",
      "trace:tool-use:false:tool: Read",
      "event:assistant",
      "delta:lo",
      "trace:thinking:false:thinking plan the answer",
      "event:assistant",
      "delta: world",
      "event:assistant",
      "delta:Reset",
      "event:user",
      "trace:thinking:false:thinking check output",
      "trace:normal:false:工具结果: Read",
      "tasks:[{\"text\":\"ship it\",\"done\":false}]",
      "event:system",
      "trace:default:undefined:hook pre",
      "event:system",
      "trace:default:undefined:status: running",
      "event:system",
      "event:system",
      "event:stream_event",
      "event:assistant",
      "event:user",
      "event:none",
      "event:result",
    ]);
  } finally {
    runner.dispose();
  }
});

test("reconciles streamed Claude text with snapshots by message and preserves result fallback", async (t) => {
  const root = { session_id: "stream-main", parent_tool_use_id: null };
  installScriptedClaudeQuery(t, {
    streamed: [
      { ...root, type: "stream_event", event: { type: "message_start", message: { id: "message-1" } } },
      { ...root, type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "CLAUDE_" } } },
      { ...root, type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "USAGE_OK" } } },
      { ...root, type: "assistant", message: { id: "message-1", content: [{ type: "text", text: "CLAUDE_USAGE_OK" }] } },
      { ...root, type: "assistant", message: { id: "message-2", content: [{ type: "text", text: "CLAUDE_USAGE_OK" }] } },
      { ...root, type: "result", subtype: "success", result: "ignored-result-fallback" },
    ],
    fallback: [{ ...root, type: "result", subtype: "success", result: "non-streaming-result" }],
  });
  const runner = createClaudeEventRunner();
  try {
    const streamed = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("streamed", streamed.handlers), "stream and snapshot reconciliation");
    assert.deepEqual(streamed.log.filter(({kind}) => kind === "delta"), [
      { kind: "delta", text: "CLAUDE_" },
      { kind: "delta", text: "USAGE_OK" },
      { kind: "delta", text: "CLAUDE_USAGE_OK" },
    ]);
    const fallback = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("fallback", fallback.handlers), "non-streaming result fallback");
    assert.deepEqual(fallback.log.filter(({kind}) => kind === "delta"), [
      { kind: "delta", text: "non-streaming-result" },
    ]);
  } finally {
    runner.dispose();
  }
});

test("does not allocate text progress for non-text Claude block indexes", async (t) => {
  const stream = (event: object) => ({ type: "stream_event", event });
  const events = [
    stream({ type: "message_start", message: { id: "message" } }),
    stream({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
    stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reasoning" } }),
    stream({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool", name: "Read", input: {} } }),
    stream({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\\\"path\\\":" } }),
    stream({ type: "content_block_start", index: 2, content_block: { type: "image", source: { type: "base64", data: "synthetic" } } }),
    stream({ type: "content_block_delta", index: 3, delta: { type: "text_delta", text: "visible" } }),
    stream({ type: "content_block_start", index: 4, content_block: { type: "tool_use", id: "other-tool", name: "Read", input: {} } }),
    { type: "assistant", message: { id: "message", content: [{ type: "text", text: "visible" }] } },
    { type: "result", subtype: "success" },
  ];
  installScriptedClaudeQuery(t, { "non-text indexes": events });
  const runner = createClaudeEventRunner();
  t.after(() => runner.dispose());
  const recorded = createClaudeTurnRecorder();
  await expectSoon(runner.runStreamed("non-text indexes", recorded.handlers), "non-text block indexes");
  assert.deepEqual(recorded.log.flatMap((entry) => entry.kind === "delta" ? [entry.text] : []), ["visible"]);
});

test("keeps single-block Claude frames separate and also accepts cumulative snapshots", async (t) => {
  const stream = (event: object) => ({ type: "stream_event", event });
  const text = (value: string) => ({ type: "text", text: value });
  const snapshot = (id: string, ...content: object[]) => ({ type: "assistant", message: { id, content } });
  const streamedBlock = (index: number, value: string) => [
    stream({ type: "content_block_start", index, content_block: text("") }),
    stream({ type: "content_block_delta", index, delta: { type: "text_delta", text: value } }),
    snapshot("first-message", text(value)),
    stream({ type: "content_block_stop", index }),
  ];
  const events = [
    stream({ type: "message_start", message: { id: "first-message" } }),
    ...streamedBlock(0, "A"),
    ...streamedBlock(1, "B"),
    ...streamedBlock(2, "B"),
    snapshot("first-message", text("A"), text("B"), text("B!")),
    stream({ type: "message_stop" }),
    snapshot("next-message", text("B")),
    { type: "result", subtype: "success", result: "should-not-fallback" },
  ];
  installScriptedClaudeQuery(t, { blocks: events });
  const runner = createClaudeEventRunner();
  t.after(() => runner.dispose());
  const recorded = createClaudeTurnRecorder();
  await expectSoon(runner.runStreamed("blocks", recorded.handlers), "multi-block Claude text");
  assert.deepEqual(recorded.log.flatMap((entry) => entry.kind === "delta" ? [entry.text] : []), ["A", "B", "B", "!", "B"]);
  assert.deepEqual(recorded.log.flatMap((entry) => entry.kind === "event" ? [entry.event] : []), events);
});

test("releases only the stopped Claude parent message and retains dedupe through assistant snapshots", async (t) => {
  const stream = (parent: string, event: object, apiMessageId?: string) => ({
    type: "stream_event",
    parent_tool_use_id: parent,
    ...(apiMessageId ? { api_message_id: apiMessageId } : {}),
    event,
  });
  const delta = (index: number, value: string) => ({
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text: value },
  });
  const snapshot = (id: string, value: string) => ({
    type: "assistant",
    message: { id, content: [{ type: "text", text: value }] },
  });
  const events = [
    stream("parent-a", { type: "message_start", message: { id: "message-a" } }, "message-a"),
    stream("parent-b", { type: "message_start", message: { id: "message-b" } }, "message-b"),
    stream("parent-a", delta(0, "A"), "message-a"),
    stream("parent-b", delta(0, "B"), "message-b"),
    stream("parent-a", { type: "message_stop" }, "message-a"),
    stream("parent-a", { type: "message_start", message: { id: "message-a-next" } }, "message-a-next"),
    stream("parent-a", { type: "message_stop" }, "message-a"),
    stream("parent-a", delta(0, "C")),
    stream("parent-b", delta(0, "!"), "message-b"),
    snapshot("message-a-next", "C"),
    snapshot("message-a", "A"),
    snapshot("message-b", "B!"),
    stream("parent-a", { type: "message_stop" }, "message-a-next"),
    stream("parent-b", { type: "message_stop" }, "message-b"),
    { type: "result", subtype: "success" },
  ];
  installScriptedClaudeQuery(t, { "parent message stops": events });
  const runner = createClaudeEventRunner();
  t.after(() => runner.dispose());
  const recorded = createClaudeTurnRecorder();
  await expectSoon(runner.runStreamed("parent message stops", recorded.handlers), "interleaved Claude parents");
  assert.deepEqual(recorded.log.flatMap((entry) => entry.kind === "delta" ? [entry.text] : []), ["A", "B", "C", "!"]);
  assert.deepEqual(recorded.log.flatMap((entry) => entry.kind === "event" ? [entry.event] : []), events);
});

test("retains Claude text progress for every message until the turn result", async (t) => {
  const snapshots = Array.from({ length: 10 }, (_, index) => ({
    type: "assistant",
    message: { id: `message-${index}`, content: [{ type: "text", text: `text-${index}` }] },
  }));
  installScriptedClaudeQuery(t, {
    "unbounded turn messages": [...snapshots, snapshots[0], { type: "result", subtype: "success" }],
  });
  const runner = createClaudeEventRunner();
  t.after(() => runner.dispose());
  const recorded = createClaudeTurnRecorder();
  await expectSoon(runner.runStreamed("unbounded turn messages", recorded.handlers), "ten Claude messages");
  assert.deepEqual(recorded.log.flatMap((entry) => entry.kind === "delta" ? [entry.text] : []),
    snapshots.map(({ message }) => message.content[0].text));
});

test("does not rewind Claude block progress for an older snapshot or replay its suffix via deltas", async (t) => {
  const stream = (event: object) => ({ type: "stream_event", event });
  const snapshot = (text: string) => ({
    type: "assistant", message: { id: "message", content: [{ type: "text", text }] },
  });
  const delta = (text: string) => stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text } });
  installScriptedClaudeQuery(t, {
    stale: [
      stream({ type: "message_start", message: { id: "message" } }),
      stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
      delta("Hello"),
      snapshot("Hel"),
      snapshot("Hello world"),
      delta(" world!"),
      snapshot("Hello world!"),
      { type: "result", subtype: "success" },
    ],
  });
  const runner = createClaudeEventRunner();
  t.after(() => runner.dispose());
  const recorded = createClaudeTurnRecorder();
  await expectSoon(runner.runStreamed("stale", recorded.handlers), "stale Claude snapshot");
  assert.deepEqual(recorded.log.flatMap((entry) => entry.kind === "delta" ? [entry.text] : []), ["Hello", " world", "!"]);
});

test("shows one redacted Claude tool trace from the complete assistant input", async (t) => {
  const tool = { type: "tool_use", id: "edit-tool", name: "Edit" };
  const args = { file_path: "fake.ts", old_string: "synthetic-old", new_string: "synthetic-new", replace_all: true };
  const stream = (event: object) => ({ type: "stream_event", event });
  const assistant = { type: "assistant", message: { id: "message", content: [{ ...tool, input: args }] } };
  const events = [
    stream({ type: "message_start", message: { id: "message" } }),
    stream({ type: "content_block_start", index: 0, content_block: { ...tool, input: {} } }),
    stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"file_path":' } }),
    stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"fake.ts","old_string":"synthetic-old","new_string":"synthetic-new","replace_all":true}' } }),
    assistant,
    stream({ type: "content_block_stop", index: 0 }),
    assistant,
    { type: "result", subtype: "success" },
  ];
  installScriptedClaudeQuery(t, { tool: events });
  const runner = createClaudeEventRunner();
  t.after(() => runner.dispose());
  const recorded = createClaudeTurnRecorder();
  await expectSoon(runner.runStreamed("tool", recorded.handlers), "Claude tool input");
  assert.deepEqual(recorded.log.flatMap((entry) => entry.kind === "event" ? [entry.event] : []), events);
  const traces = recorded.log.filter((entry) => entry.kind === "trace");
  assert.equal(traces.length, 1);
  const [trace] = traces;
  assert.equal(trace.traceKind, "tool-use");
  assert.match(trace.content, /^tool: Edit\n/);
  assert.deepEqual(JSON.parse(trace.content.slice(trace.content.indexOf("{"))), { file_path: "fake.ts", replace_all: true });
  assert.equal(recorded.log[recorded.log.indexOf(trace) - 1]?.kind, "event");
  assert.deepEqual(recorded.log[recorded.log.indexOf(trace) - 1], { kind: "event", event: assistant });
});

test("keeps Claude dedupe and result fallback inside the current turn", async (t) => {
  const sharedTool = {
    type: "tool_use",
    id: "shared-tool",
    name: "Bash",
    input: { command: "pwd" },
  };
  installScriptedClaudeQuery(t, {
    one: [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "hello" },
            sharedTool,
          ],
        },
      },
      { type: "result", subtype: "success", result: "fallback-ignored" },
    ],
    two: [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "hello!" },
            sharedTool,
          ],
        },
      },
      { type: "result", subtype: "success", result: "fallback-ignored-again" },
    ],
    three: [
      { type: "result", subtype: "success", result: "fallback-used" },
    ],
  });
  const runner = createClaudeEventRunner();
  try {
    const first = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("one", first.handlers), "first turn");
    assert.deepEqual(
      first.log.filter((entry) => entry.kind === "delta"),
      [{ kind: "delta", text: "hello" }],
    );
    assert.equal(first.log.filter((entry) => entry.kind === "trace" && entry.traceKind === "tool-use").length, 1);

    const second = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("two", second.handlers), "second turn");
    assert.deepEqual(
      second.log.filter((entry) => entry.kind === "delta"),
      [{ kind: "delta", text: "hello!" }],
    );
    assert.equal(second.log.filter((entry) => entry.kind === "trace" && entry.traceKind === "tool-use").length, 1);

    const third = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("three", third.handlers), "third turn");
    assert.deepEqual(summarizeClaudeTurn(third.log), [
      "event:result",
      "delta:fallback-used",
    ]);
  } finally {
    runner.dispose();
  }
});

test("completes Claude error results, ignores unknown messages, and rejects missing sessions", async (t) => {
  const queryCalls = { count: 0 };
  installScriptedClaudeQuery(t, {
    "error-result": [
      { type: "weird" },
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["boom"],
        result: "error text",
      },
    ],
    "plain-result": [
      { type: "result", subtype: "success", result: { unexpected: true } },
    ],
    missing: [
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["No conversation found with session ID: abc"],
        result: "nope",
      },
    ],
    recover: [
      { type: "result", subtype: "success", result: "ok" },
    ],
  }, queryCalls);
  const runner = createClaudeEventRunner();
  try {
    const errorTurn = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("error-result", errorTurn.handlers), "error result");
    assert.deepEqual(summarizeClaudeTurn(errorTurn.log), [
      "event:weird",
      "event:result",
      "delta:error text",
    ]);
    assert.equal(queryCalls.count, 1);

    const plainTurn = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("plain-result", plainTurn.handlers), "plain result");
    assert.deepEqual(summarizeClaudeTurn(plainTurn.log), ["event:result"]);
    assert.equal(queryCalls.count, 1);

    const missingTurn = createClaudeTurnRecorder();
    await expectSoon(assert.rejects(
      runner.runStreamed("missing", missingTurn.handlers),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "No conversation found with session ID: abc");
        assert.equal((error as Error & { code?: string }).code, "CLAUDE_SESSION_NOT_FOUND");
        return true;
      },
    ), "missing session");
    assert.deepEqual(summarizeClaudeTurn(missingTurn.log), ["event:result"]);
    assert.equal(runner.isDisposed(), false);

    const recoverTurn = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("recover", recoverTurn.handlers), "recover turn");
    assert.deepEqual(summarizeClaudeTurn(recoverTurn.log), [
      "event:result",
      "delta:ok",
    ]);
    assert.equal(queryCalls.count, 2);
  } finally {
    runner.dispose();
  }
});

test("ignores inherited object keys as Claude message types and still processes the following result", async (t) => {
  installScriptedClaudeQuery(t, {
    inherited: [
      { type: "toString" },
      { type: "constructor" },
      { type: "__proto__" },
      { type: "result", subtype: "success", result: "kept" },
    ],
  });
  const runner = createClaudeEventRunner();
  try {
    const turn = createClaudeTurnRecorder();
    await expectSoon(runner.runStreamed("inherited", turn.handlers), "inherited message types");
    assert.deepEqual(summarizeClaudeTurn(turn.log), [
      "event:toString",
      "event:constructor",
      "event:__proto__",
      "event:result",
      "delta:kept",
    ]);
    assert.equal(runner.isDisposed(), false);
  } finally {
    runner.dispose();
  }
});

test("dedupes TodoWrite updates and still tracks task tools inside one Claude turn", async (t) => {
  const todoUse = {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "todo-1",
          name: "TodoWrite",
          input: { todos: [{ content: "a", status: "pending" }] },
        },
      ],
    },
  };
  const todoResult = {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "todo-1",
          content: { todos: [{ content: "a", status: "completed" }] },
        },
      ],
    },
  };
  installScriptedClaudeQuery(t, {
    tasks: [
      todoUse,
      todoUse,
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "TodoWrite",
              input: { todos: [{ content: "b", status: "completed" }] },
            },
          ],
        },
      },
      todoResult,
      todoResult,
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "task-1",
              name: "TaskCreate",
              input: { subject: "Write tests" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "task-1",
              content: "Task #7 created successfully: Write tests",
            },
          ],
        },
      },
      { type: "result", subtype: "success", result: "" },
    ],
  });
  const runner = createClaudeEventRunner();
  const recorded = createClaudeTurnRecorder();
  try {
    await expectSoon(runner.runStreamed("tasks", recorded.handlers), "task turn");
    assert.deepEqual(
      recorded.log.filter((entry) => entry.kind === "tasks").map((entry) => entry.kind === "tasks" ? entry.items : []),
      [
        [{ text: "a", done: false }],
        [{ text: "b", done: true }],
        [{ text: "a", done: true }],
        [{ text: "Write tests", done: false }],
      ],
    );
    assert.equal(recorded.log.filter((entry) => entry.kind === "trace" && entry.traceKind === "tool-use").length, 3);
    assert.equal(recorded.log.filter((entry) => entry.kind === "trace" && entry.traceKind === "normal").length, 2);
  } finally {
    runner.dispose();
  }
});

test("department Claude admission binds the exact native UUID before SDK startup and waits for iterator drain", async t => {
  let authorize!: () => void, finishDrain!: () => void;
  const admission = new Promise<void>(resolve => { authorize = resolve; });
  const drain = new Promise<void>(resolve => { finishDrain = resolve; });
  let entered!: () => void; const entering = new Promise<void>(resolve => { entered = resolve; });
  let native = "", queries = 0;
  t.mock.method(dynamicImportModule, "dynamicImport", async () => ({ query: ({ prompt, options }: any) => {
    queries++;
    assert.equal(options.extraArgs["session-id"], native);
    return (async function* () {
      try {
        for await (const ignored of prompt) {
          void ignored;
          yield { type: "system", subtype: "init", session_id: native };
          yield { type: "result", subtype: "success", session_id: native };
        }
      } finally { await drain; }
    })();
  } }));
  const runner = new ClaudeInteractiveRunner({ command: "claude", args: [], thinkingMode: "off", interactiveMode: "coding", sessionId: null, env: {} });
  t.after(() => { authorize(); finishDrain(); runner.dispose(); });
  const running = runner.runStreamed("执行", { beforeSessionStart: async id => { native = id; entered(); await admission; },
    onAssistantDelta() {}, onTrace() {}, onTaskListUpdate() {}, onSessionId(id) { assert.equal(id, native); } });
  await entering; assert.match(native, /^[0-9a-f-]{36}$/); assert.equal(queries, 0);
  authorize(); await running; assert.equal(queries, 1);
  let released = false; const closing = runner.disposeAndWait().then(() => { released = true; });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(released, false);
  finishDrain(); await closing; assert.equal(released, true);
});

test("rejected department Claude admission never starts the SDK or delivers a prompt", async t => {
  t.mock.method(dynamicImportModule, "dynamicImport", async () => { assert.fail("SDK must not start"); });
  const runner = new ClaudeInteractiveRunner({ command: "claude", args: [], thinkingMode: "off", interactiveMode: "coding", sessionId: "native-resumed", env: {} });
  await assert.rejects(runner.runStreamed("执行", { beforeSessionStart: async id => { assert.equal(id, "native-resumed"); throw new Error("sealed"); },
    onAssistantDelta() {}, onTrace() {}, onTaskListUpdate() {}, onSessionId() {} }), /sealed/);
  await runner.disposeAndWait();
});
