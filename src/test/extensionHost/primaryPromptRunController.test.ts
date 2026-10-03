import test = require("node:test");
import assert = require("node:assert/strict");

import { createPrimaryPromptRunController } from "../../extensionHost/primaryPromptRunController";
import type { ChatMessage } from "../../webview/types";

test("primary prompt run controller tracks the active run and rejects stale identities", () => {
  const controller = createPrimaryPromptRunController();
  const messageTarget: ChatMessage[] = [];

  controller.begin({
    runId: "run-1",
    cli: "codex",
    sessionId: "session-1",
    tabId: "tab-1",
    messageTarget,
  });

  assert.equal(controller.activeRunId, "run-1");
  assert.equal(controller.activeCliForRun, "codex");
  assert.equal(controller.activeSessionId, "session-1");
  assert.equal(controller.activeTabIdForRun, "tab-1");
  assert.equal(controller.activeMessageTarget, messageTarget);
  assert.equal(controller.isCurrent("run-1"), true);
  assert.equal(controller.isCurrent("run-2"), false);
  assert.equal(controller.isCurrent(undefined), false);
});

test("primary prompt run controller clears process, stop callback, transcript and task state together", () => {
  const controller = createPrimaryPromptRunController();
  const stop = () => undefined;

  controller.begin({
    runId: "run-1",
    cli: "claude",
    sessionId: null,
    tabId: "tab-1",
    messageTarget: [],
  });
  controller.activeInteractiveStop = stop;
  controller.activeTraceBuffer = "partial";
  controller.activeTraceSegmentLines = ["trace"];
  controller.activeCompletionSent = true;
  controller.activeTaskRun = {
    id: "run-1",
    cli: "claude",
    sessionId: null,
    prompt: "prompt",
    startedAt: 1,
  };

  controller.clear();

  assert.equal(controller.activeRunId, undefined);
  assert.equal(controller.activeInteractiveStop, null);
  assert.equal(controller.activeTraceBuffer, "");
  assert.deepEqual(controller.activeTraceSegmentLines, []);
  assert.equal(controller.activeCompletionSent, false);
  assert.equal(controller.activeTaskRun, null);
  assert.equal(controller.activeMessageTarget, null);
});

test("primary prompt run controller snapshot does not expose the live trace line array", () => {
  const controller = createPrimaryPromptRunController();
  controller.activeTraceSegmentLines = ["one"];

  const snapshot = controller.snapshot();
  snapshot.traceSegmentLines.push("two");

  assert.deepEqual(controller.activeTraceSegmentLines, ["one"]);
});
