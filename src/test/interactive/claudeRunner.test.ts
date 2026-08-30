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

test("keeps the current Claude AbortController when an older run finishes", async (t) => {
  const originalDynamicImport = dynamicImportModule.dynamicImport;
  type MockRun = {
    prompt: string;
    abortController: AbortController;
    finish: () => void;
  };
  const runs: MockRun[] = [];
  const waitForRunCount = (count: number): Promise<void> => new Promise((resolve) => {
    const check = (): void => {
      if (runs.length >= count) {
        resolve();
        return;
      }
      setTimeout(check, 0);
    };
    check();
  });

  dynamicImportModule.dynamicImport = async () => ({
    query: ({ prompt, options }: { prompt: string; options: { abortController: AbortController } }) => {
      let finish: (() => void) | null = null;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      runs.push({
        prompt,
        abortController: options.abortController,
        finish: () => finish?.(),
      });
      return (async function* stream() {
        yield { type: "system", subtype: "status", status: "running" };
        await new Promise<void>((resolve, reject) => {
          options.abortController.signal.addEventListener("abort", () => {
            const error = new Error("mock claude aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
          finished.then(resolve, reject);
        });
        yield { type: "result", result: `done:${prompt}` };
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
  const handlers = {
    onAssistantDelta: () => {},
    onTrace: () => {},
    onTaskListUpdate: () => {},
    onSessionId: () => {},
  };

  const firstRun = runner.runStreamed("first", handlers);
  await waitForRunCount(1);
  const secondRun = runner.runStreamed("second", handlers);
  await waitForRunCount(2);

  const firstController = runs[0].abortController;
  const secondController = runs[1].abortController;
  assert.notEqual(firstController, secondController);

  runs[0].finish();
  await firstRun;
  assert.equal(secondController.signal.aborted, false);

  runner.stopAndRebuild();
  assert.equal(secondController.signal.aborted, true);
  await assert.rejects(secondRun, { name: "AbortError" });
});
