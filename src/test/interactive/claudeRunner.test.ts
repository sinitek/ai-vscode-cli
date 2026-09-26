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
  mapClaudeThinkingEffort,
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

test("reuses one Claude stream for the next turn and interrupts without killing it", async (t) => {
  const originalDynamicImport = dynamicImportModule.dynamicImport;
  const prompts: string[] = [];
  let queryCalls = 0;
  let interruptCalls = 0;
  let releaseInterruptResult: (() => void) | null = null;
  const interruptResultReady = new Promise<void>((resolve) => {
    releaseInterruptResult = resolve;
  });
  const abortState: { controller: AbortController | null } = { controller: null };

  dynamicImportModule.dynamicImport = async () => ({
    query: ({ prompt, options }: { prompt: AsyncIterable<any>; options: { abortController: AbortController } }) => {
      queryCalls += 1;
      abortState.controller = options.abortController;
      const query = (async function* stream() {
        while (!options.abortController.signal.aborted) {
          const next = await prompt[Symbol.asyncIterator]().next();
          if (next.done) {
            return;
          }
          const text = next.value?.message?.content?.[0]?.text;
          if (typeof text === "string") {
            prompts.push(text);
          }
          if (text === "second") {
            await interruptResultReady;
          }
          yield { type: "result", result: text, session_id: "session-1" };
        }
      })();
      return Object.assign(query, {
        interrupt: async () => {
          interruptCalls += 1;
          releaseInterruptResult?.();
        },
      });
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

  await runner.runStreamed("first", handlers);
  const secondRun = runner.runStreamed("second", handlers);
  const promptDeadline = Date.now() + 1000;
  while (prompts.length < 2 && Date.now() < promptDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(queryCalls, 1);
  assert.deepEqual(prompts, ["first", "second"]);
  assert.equal(abortState.controller?.signal.aborted, false);

  runner.stopAndRebuild();
  assert.equal(interruptCalls, 1);
  assert.equal(abortState.controller?.signal.aborted, false);
  await assert.rejects(secondRun, { name: "AbortError" });

  await runner.runStreamed("third", handlers);
  assert.equal(queryCalls, 1);
  assert.deepEqual(prompts, ["first", "second", "third"]);
  runner.dispose();
});
