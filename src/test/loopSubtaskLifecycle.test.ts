import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");

import {
  finalizeLoopSubtaskRun,
  type LoopSubtaskCompletionDeps,
} from "../loopSubtaskLifecycle";

type CompletionHarness = {
  deps: LoopSubtaskCompletionDeps;
  calls: string[];
};

function createCompletionHarness(): CompletionHarness {
  const calls: string[] = [];
  return {
    deps: {
      markSubtaskRunFinished: (_taskId, _subtaskId, status) => {
        calls.push(`mark:${status}`);
      },
      closeSubtaskTab: async (tabId) => {
        calls.push(`close:${tabId}`);
      },
      logSubtaskTabAutoClosed: ({ tabId }) => {
        calls.push(`log:${tabId}`);
      },
    },
    calls,
  };
}

function extractAsyncFunctionSection(source: string, name: string, nextFunctionName: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in source`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start);
  assert.notEqual(end, -1, `${nextFunctionName} should follow ${name}`);
  return source.slice(start, end);
}

test("records a successful Loop subtask before automatically closing its tab", async () => {
  const harness = createCompletionHarness();

  await finalizeLoopSubtaskRun({
    taskId: "task-1",
    round: 2,
    subtaskId: "subtask-1",
    runStatus: "end",
    assistantContent: "completed result",
    tabId: "subtask-tab-1",
  }, harness.deps);

  assert.deepEqual(harness.calls, [
    "mark:end",
    "close:subtask-tab-1",
    "log:subtask-tab-1",
  ]);
});

test("does not automatically close a successful Loop subtask without a tab id", async () => {
  const harness = createCompletionHarness();

  await finalizeLoopSubtaskRun({
    taskId: "task-1",
    round: 2,
    subtaskId: "subtask-1",
    runStatus: "end",
    assistantContent: "completed result",
    tabId: null,
  }, harness.deps);

  assert.deepEqual(harness.calls, ["mark:end"]);
});

test("does not automatically close stopped or failed Loop subtask tabs", async () => {
  const stopped = createCompletionHarness();
  const failed = createCompletionHarness();

  await finalizeLoopSubtaskRun({
    taskId: "task-1",
    round: 2,
    subtaskId: "subtask-stopped",
    runStatus: "stopped",
    assistantContent: null,
    tabId: "subtask-tab-stopped",
  }, stopped.deps);
  await finalizeLoopSubtaskRun({
    taskId: "task-1",
    round: 2,
    subtaskId: "subtask-failed",
    runStatus: "error",
    assistantContent: null,
    tabId: "subtask-tab-failed",
  }, failed.deps);

  assert.deepEqual(stopped.calls, ["mark:stopped"]);
  assert.deepEqual(failed.calls, ["mark:error"]);
});

test("uses the same completion lifecycle for automatic retries and manual subtask resumes", () => {
  const loopOrchestrationSource = fs.readFileSync(
    path.join(process.cwd(), "src", "extensionHost", "loopOrchestration.ts"),
    "utf8",
  );
  const promptRuntimeSource = fs.readFileSync(
    path.join(process.cwd(), "src", "extensionHost", "promptRunRuntime.ts"),
    "utf8",
  );
  const automaticRetrySource = extractAsyncFunctionSection(
    loopOrchestrationSource,
    "runLoopSubtaskWithRetry",
    "waitForLoopSubtaskRetryDelay",
  );
  const manualResumeSource = extractAsyncFunctionSection(
    promptRuntimeSource,
    "maybeWakeLoopMainAfterSubtaskContinuation",
    "getLoopTargetSessionId",
  );

  assert.match(automaticRetrySource, /await finalizeLoopSubtaskRun\(\{[\s\S]*tabId: subtaskTarget\.tabId/);
  assert.match(manualResumeSource, /await finalizeLoopSubtaskRun\(\{[\s\S]*tabId: subtaskTarget\?\.tabId \?\? null/);
});
