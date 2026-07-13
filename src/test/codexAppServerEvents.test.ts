import test = require("node:test");
import assert = require("node:assert/strict");

import {
  extractCodexSubagentLifecycleUpdates,
  isCodexSubagentThreadEvent,
  isCodexContextCompactionCompletedNotification,
  isCodexFinalAnswerAgentMessage,
  isCodexFinalAnswerPhase,
  shouldSettleCodexPrimaryTurn,
} from "../interactive/codexAppServerEvents";

test("keeps child thread completion separate from the active parent turn", () => {
  assert.equal(isCodexSubagentThreadEvent("child", "parent"), true);
  assert.equal(shouldSettleCodexPrimaryTurn({
    eventThreadId: "child",
    eventTurnId: "child-turn",
    primaryThreadId: "parent",
    activeTurnId: "parent-turn",
  }), false);
  assert.equal(shouldSettleCodexPrimaryTurn({
    eventThreadId: "parent",
    eventTurnId: "old-parent-turn",
    primaryThreadId: "parent",
    activeTurnId: "parent-turn",
  }), false);
  assert.equal(shouldSettleCodexPrimaryTurn({
    eventThreadId: "parent",
    eventTurnId: "parent-turn",
    primaryThreadId: "parent",
    activeTurnId: "parent-turn",
  }), true);
});

test("extracts Codex collaboration and subagent activity lifecycle updates", () => {
  assert.deepEqual(extractCodexSubagentLifecycleUpdates({
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    status: "completed",
    receiverThreadIds: ["child-1"],
    agentsStates: {
      "child-1": { status: "running" },
    },
  }), [{ threadId: "child-1", status: "running" }]);

  assert.deepEqual(extractCodexSubagentLifecycleUpdates({
    type: "collabAgentToolCall",
    tool: "wait",
    status: "failed",
    receiverThreadIds: ["child-1", "child-2"],
    agentsStates: {
      "child-1": { status: "completed" },
      "child-2": { status: "errored", message: "review failed" },
    },
  }), [
    { threadId: "child-1", status: "completed" },
    { threadId: "child-2", status: "failed", error: "review failed" },
  ]);

  assert.deepEqual(extractCodexSubagentLifecycleUpdates({
    type: "subAgentActivity",
    agentThreadId: "child-3",
    agentPath: "reviewer",
    kind: "started",
  }), [{ threadId: "child-3", status: "running", agentName: "reviewer" }]);
});

test("detects thread/compacted notification for the expected thread", () => {
  assert.equal(
    isCodexContextCompactionCompletedNotification({
      method: "thread/compacted",
      params: { threadId: "thread-1" },
    }, "thread-1"),
    true
  );
});

test("detects context compaction completion item with normalized type", () => {
  assert.equal(
    isCodexContextCompactionCompletedNotification({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: { type: "context_compaction" },
      },
    }, "thread-1"),
    true
  );
});

test("ignores compaction notifications for a different thread", () => {
  assert.equal(
    isCodexContextCompactionCompletedNotification({
      method: "thread/compacted",
      params: { threadId: "thread-2" },
    }, "thread-1"),
    false
  );
});

test("detects Codex final answer phase", () => {
  assert.equal(isCodexFinalAnswerPhase("final_answer"), true);
  assert.equal(isCodexFinalAnswerPhase("commentary"), false);
});

test("detects Codex final answer agent messages", () => {
  assert.equal(
    isCodexFinalAnswerAgentMessage({
      type: "agent_message",
      phase: "final_answer",
      text: "Done",
    }),
    true
  );
  assert.equal(
    isCodexFinalAnswerAgentMessage({
      type: "agentMessage",
      phase: "final_answer",
      text: "Done",
    }),
    true
  );
  assert.equal(
    isCodexFinalAnswerAgentMessage({
      type: "agent_message",
      phase: "commentary",
      text: "Working",
    }),
    false
  );
});
