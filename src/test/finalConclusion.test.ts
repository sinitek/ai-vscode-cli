import test = require("node:test");
import assert = require("node:assert/strict");

import {
  hasAssistantFinalConclusionAfterMessage,
  isAssistantFinalConclusionMessage,
  isExplicitAssistantFinalConclusionMessage,
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
      observedFinalAnswer: true,
      requireExplicitFinalAnswer: true,
    }),
    true,
  );
});

test("does not treat an ordinary assistant reply as final in strict mode", () => {
  const messages = [
    message({ id: "user-1", role: "user", content: "prompt", createdAt: 10 }),
    message({ id: "assistant-1", role: "assistant", content: "I will keep working.", createdAt: 20 }),
  ];

  assert.equal(
    hasAssistantFinalConclusionAfterMessage(messages, "user-1", {
      requireExplicitFinalAnswer: true,
    }),
    false,
  );
});

test("accepts a structured Codex final answer in strict mode", () => {
  const messages = [
    message({ id: "user-1", role: "user", content: "prompt", createdAt: 10 }),
    message({
      id: "assistant-1",
      role: "assistant",
      content: "done",
      createdAt: 20,
      codexFinalAnswer: true,
    }),
  ];

  assert.equal(
    hasAssistantFinalConclusionAfterMessage(messages, "user-1", {
      requireExplicitFinalAnswer: true,
    }),
    true,
  );
});

test("accepts [final_answer] anywhere in non-thinking assistant text in strict mode", () => {
  const messages = [
    message({ id: "user-1", role: "user", content: "prompt", createdAt: 10 }),
    message({
      id: "assistant-1",
      role: "assistant",
      content: "Completed. [final_answer] The requested change is ready.",
      createdAt: 20,
    }),
  ];

  assert.equal(isExplicitAssistantFinalConclusionMessage(messages[1]), true);
  assert.equal(
    hasAssistantFinalConclusionAfterMessage(messages, "user-1", {
      requireExplicitFinalAnswer: true,
    }),
    true,
  );
});

test("does not accept [final_answer] from thinking assistant text", () => {
  const thinking = message({
    id: "assistant-thinking",
    role: "assistant",
    content: "I may eventually emit [final_answer].",
    kind: "thinking",
    createdAt: 20,
  });

  assert.equal(isExplicitAssistantFinalConclusionMessage(thinking), false);
});

test("does not use a marked assistant message before the current user anchor", () => {
  const messages = [
    message({ id: "assistant-old", role: "assistant", content: "[final_answer] old", createdAt: 10 }),
    message({ id: "user-1", role: "user", content: "new prompt", createdAt: 20 }),
    message({ id: "assistant-new", role: "assistant", content: "working", createdAt: 30 }),
  ];

  assert.equal(
    hasAssistantFinalConclusionAfterMessage(messages, "user-1", {
      requireExplicitFinalAnswer: true,
    }),
    false,
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
