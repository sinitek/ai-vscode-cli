import test = require("node:test");
import assert = require("node:assert/strict");

import {
  isCodexContextCompactionCompletedNotification,
  isCodexFinalAnswerAgentMessage,
  isCodexFinalAnswerPhase,
} from "../interactive/codexAppServerEvents";

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
