import test = require("node:test");
import assert = require("node:assert/strict");

import {
  createSubagentProgressController,
  type SubagentProgressLabels,
} from "../../subagentProgress";
import type { ChatMessage } from "../../webview/types";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";

const LABELS: SubagentProgressLabels = {
  provider: { opencode: "OpenCode", codex: "Codex", loop: "Loop" },
  subagent: "subagent",
  status: {
    running: "running",
    completed: "completed",
    failed: "failed",
    interrupted: "interrupted",
  },
  errorPrefix: "Error: ",
};

function createHarness() {
  const messages: ChatMessage[] = [];
  const deltas: Array<{ id: string; content: string }> = [];
  const replacements: string[] = [];
  let nextId = 1;
  const controller = createSubagentProgressController({
    labels: LABELS,
    createMessageId: () => `message-${nextId++}`,
    appendMessage: (message) => messages.push(message),
    replaceMessage: (message) => replacements.push(message.id),
    appendDelta: (id, content) => deltas.push({ id, content }),
    now: () => 100,
  });
  return { controller, messages, deltas, replacements };
}

test("creates one non-merging assistant bubble and appends streamed subagent deltas", () => {
  const harness = createHarness();

  harness.controller.update({
    provider: "codex",
    id: "thread-1",
    agentName: "reviewer",
    status: "running",
  });
  harness.controller.update({ provider: "codex", id: "thread-1", delta: "First" });
  harness.controller.update({ provider: "codex", id: "thread-1", delta: " second" });

  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].role, "assistant");
  assert.equal(harness.messages[0].merge, false);
  assert.equal(harness.messages[0].subagentId, "thread-1");
  assert.equal(harness.messages[0].content, "**Codex subagent · reviewer · running**\n\nFirst second");
  assert.deepEqual(harness.deltas, [
    { id: "message-1", content: "\n\nFirst" },
    { id: "message-1", content: " second" },
  ]);
});

test("keeps concurrent subagents isolated and replaces non-prefix snapshots", () => {
  const harness = createHarness();

  harness.controller.update({ provider: "opencode", id: "child-a", text: "partial" });
  harness.controller.update({ provider: "opencode", id: "child-b", text: "other" });
  harness.controller.update({ provider: "opencode", id: "child-a", text: "corrected" });

  assert.equal(harness.messages.length, 2);
  assert.match(harness.messages[0].content, /corrected$/u);
  assert.match(harness.messages[1].content, /other$/u);
  assert.deepEqual(harness.replacements, ["message-1"]);
});

test("updates lifecycle status and finishes only running subagents", () => {
  const harness = createHarness();

  harness.controller.update({ provider: "codex", id: "done", status: "completed", text: "ok" });
  harness.controller.update({ provider: "codex", id: "active", status: "running" });
  harness.controller.finishRunning("interrupted");

  assert.equal(harness.controller.getMessage("codex", "done")?.subagentStatus, "completed");
  assert.equal(harness.controller.getMessage("codex", "active")?.subagentStatus, "interrupted");
  assert.match(harness.controller.getMessage("codex", "active")?.content ?? "", /interrupted/u);
});

test("re-renders late text after an error without concatenating it into the error line", () => {
  const harness = createHarness();

  harness.controller.update({
    provider: "opencode",
    id: "failed-child",
    status: "failed",
    error: "provider failed",
  });
  harness.controller.update({ provider: "opencode", id: "failed-child", text: "partial result" });

  assert.equal(harness.replacements.length, 1);
  assert.match(
    harness.controller.getMessage("opencode", "failed-child")?.content ?? "",
    /partial result\n\nError: provider failed$/u,
  );
});

test("webview keeps interleaved subagent deltas on their original bubble", () => {
  assert.match(VIEW_CONTENT_SCRIPT_TRACE_RENDERING, /canUpdateDetachedSubagent/u);
  assert.match(
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING,
    /targetIndex === -1 \|\| \(!isLastAssistant && !canUpdateDetachedSubagent\)/u,
  );
});
