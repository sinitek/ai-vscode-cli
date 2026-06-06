import test = require("node:test");
import assert = require("node:assert/strict");

import {
  hasAssistantFinalConclusionAfterMessage,
  isAssistantFinalConclusionMessage,
} from "../finalConclusion";
import type { ChatMessage } from "../webview/types";

function message(partial: ChatMessage): ChatMessage {
  return partial;
}

test("detects a normal assistant conclusion after the user message", () => {
  const messages = [
    message({ id: "user-1", role: "user", content: "prompt", createdAt: 10 }),
    message({ id: "assistant-1", role: "assistant", content: "done", createdAt: 20 }),
  ];

  assert.equal(hasAssistantFinalConclusionAfterMessage(messages, "user-1"), true);
});

test("ignores thinking assistant messages as final conclusions", () => {
  assert.equal(
    isAssistantFinalConclusionMessage(message({
      id: "assistant-thinking",
      role: "assistant",
      content: "thinking",
      kind: "thinking",
    })),
    false,
  );
});

test("accepts an observed Codex final answer when the user anchor is missing", () => {
  assert.equal(
    hasAssistantFinalConclusionAfterMessage([], "missing-user", {
      observedCodexFinalAnswer: true,
    }),
    true,
  );
});

test("falls back to run creation time when the user anchor is missing", () => {
  const messages = [
    message({ id: "assistant-before", role: "assistant", content: "old", createdAt: 10 }),
    message({ id: "assistant-after", role: "assistant", content: "done", createdAt: 30 }),
  ];

  assert.equal(
    hasAssistantFinalConclusionAfterMessage(messages, "missing-user", {
      fallbackCreatedAt: 20,
    }),
    true,
  );
});

test("does not use old assistant messages for missing user anchors", () => {
  const messages = [
    message({ id: "assistant-before", role: "assistant", content: "old", createdAt: 10 }),
  ];

  assert.equal(
    hasAssistantFinalConclusionAfterMessage(messages, "missing-user", {
      fallbackCreatedAt: 20,
    }),
    false,
  );
});
