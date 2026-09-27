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
