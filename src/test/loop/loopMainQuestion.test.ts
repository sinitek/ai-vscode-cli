import test = require("node:test");
import assert = require("node:assert/strict");

import type { ChatMessage } from "../../webview/types";
import {
  askLoopMainModelSession,
  extractNewAssistantAnswer,
  presentLoopMainQuestionAnswer,
} from "../../loopMainQuestion";

function message(id: string, role: ChatMessage["role"], content: string): ChatMessage {
  return { id, role, content };
}

test("presents the text after the final answer marker", () => {
  assert.equal(presentLoopMainQuestionAnswer("draft\n[final_answer]\n可以合并。"), "可以合并。");
  assert.equal(presentLoopMainQuestionAnswer("  直接回答  "), "直接回答");
  assert.equal(presentLoopMainQuestionAnswer("[final_answer]"), "");
});

test("extracts only a new or updated assistant answer", () => {
  const before = [
    message("old", "assistant", "旧回答"),
    message("user-1", "user", "之前的问题"),
  ];
  const after = [
    ...before,
    message("user-2", "user", "现在呢"),
    message("new", "assistant", "[final_answer]\n现在可以。"),
  ];
  assert.equal(extractNewAssistantAnswer(before, after), "现在可以。");

  const updated = [
    message("old", "assistant", "[final_answer]\n更新后的回答"),
  ];
  assert.equal(
    extractNewAssistantAnswer([message("old", "assistant", "旧回答")], updated),
    "更新后的回答",
  );
  assert.equal(extractNewAssistantAnswer(updated, updated), null);
});

test("asks the current main session and returns the new answer", async () => {
  const messages: ChatMessage[] = [message("seed", "assistant", "已有上下文")];
  let ran = false;
  const result = await askLoopMainModelSession({
    question: "  这个方案能合并吗  ",
    modelPrompt: "只回答：这个方案能合并吗",
    target: { tabId: "main-tab", cli: "codex", sessionId: "session-1" },
    isTabRunActive: () => false,
    readMessages: () => messages,
    runPrompt: async (input, options) => {
      ran = true;
      assert.equal(input.displayPrompt, "这个方案能合并吗");
      assert.equal(input.modelPrompt, "只回答：这个方案能合并吗");
      assert.equal(input.loopAsk, true);
      assert.equal(input.skipLongTermMemoryPersist, true);
      assert.equal(input.throwOnError, true);
      assert.deepEqual(input.contextTags, []);
      assert.equal(options.targetTabId, "main-tab");
      messages.push(message("q", "user", input.displayPrompt));
      messages.push(message("a", "assistant", "[final_answer]\n可以，先处理冲突文件。"));
    },
    unavailableMessage: "unavailable",
    busyMessage: "busy",
    emptyMessage: "empty",
    failedMessage: (detail) => `failed:${detail}`,
  });

  assert.equal(ran, true);
  assert.deepEqual(result, { status: "ready", answer: "可以，先处理冲突文件。" });
});

test("does not preempt a busy main session and reports an empty answer", async () => {
  const busy = await askLoopMainModelSession({
    question: "在吗",
    modelPrompt: "在吗",
    target: { tabId: "main-tab", cli: "codex", sessionId: "session-1" },
    isTabRunActive: () => true,
    readMessages: () => [],
    runPrompt: async () => {
      throw new Error("should not run");
    },
    unavailableMessage: "unavailable",
    busyMessage: "busy",
    emptyMessage: "empty",
    failedMessage: (detail) => detail,
  });
  assert.deepEqual(busy, { status: "error", error: "busy" });

  const missing = await askLoopMainModelSession({
    question: "在吗",
    modelPrompt: "在吗",
    target: null,
    isTabRunActive: () => false,
    readMessages: () => [],
    runPrompt: async () => undefined,
    unavailableMessage: "unavailable",
    busyMessage: "busy",
    emptyMessage: "empty",
    failedMessage: (detail) => detail,
  });
  assert.deepEqual(missing, { status: "error", error: "unavailable" });

  const empty = await askLoopMainModelSession({
    question: "在吗",
    modelPrompt: "在吗",
    target: { tabId: "main-tab", cli: "claude", sessionId: null },
    isTabRunActive: () => false,
    readMessages: () => [],
    runPrompt: async () => undefined,
    unavailableMessage: "unavailable",
    busyMessage: "busy",
    emptyMessage: "empty",
    failedMessage: (detail) => detail,
  });
  assert.deepEqual(empty, { status: "error", error: "empty" });
});

test("recovers an answer when the prompt run throws after the reply is stored", async () => {
  const messages: ChatMessage[] = [];
  const result = await askLoopMainModelSession({
    question: "原因是什么",
    modelPrompt: "原因是什么",
    target: { tabId: "main-tab", cli: "opencode", sessionId: "session-2" },
    isTabRunActive: () => false,
    readMessages: () => messages,
    runPrompt: async () => {
      messages.push(message("a", "assistant", "是路径冲突。"));
      throw new Error("late stream failure");
    },
    unavailableMessage: "unavailable",
    busyMessage: "busy",
    emptyMessage: "empty",
    failedMessage: (detail) => `failed:${detail}`,
  });
  assert.deepEqual(result, { status: "ready", answer: "是路径冲突。" });
});

test("ignores thinking messages when extracting the answer and publishes progress", async () => {
  const before = [message("old", "assistant", "旧回答")];
  const after = [
    ...before,
    message("think", "assistant", "thinking 先分析", ),
    message("answer", "assistant", "[final_answer]\n最终答复"),
  ];
  after[1] = { ...after[1], kind: "thinking" };
  assert.equal(extractNewAssistantAnswer(before, after), "最终答复");

  const messages: ChatMessage[] = [];
  const seen: string[] = [];
  const result = await askLoopMainModelSession({
    question: "现在呢",
    modelPrompt: "现在呢",
    target: { tabId: "main-tab", cli: "codex", sessionId: "session-3" },
    isTabRunActive: () => false,
    readMessages: () => messages,
    onProgress: ({ current }) => {
      seen.push(current.map((item) => item.id).join(","));
    },
    progressIntervalMs: 5,
    runPrompt: async () => {
      messages.push({ id: "think", role: "assistant", content: "thinking 先分析", kind: "thinking" });
      await new Promise((resolve) => setTimeout(resolve, 15));
      messages.push(message("answer", "assistant", "[final_answer]\n最终答复"));
    },
    unavailableMessage: "unavailable",
    busyMessage: "busy",
    emptyMessage: "empty",
    failedMessage: (detail) => detail,
  });
  assert.deepEqual(result, { status: "ready", answer: "最终答复" });
  assert.ok(seen.some((entry) => entry.includes("think")));
});

test("returns stopped when the ask run is aborted before an answer exists", async () => {
  let aborted = false;
  const result = await askLoopMainModelSession({
    question: "停一下",
    modelPrompt: "停一下",
    target: { tabId: "main-tab", cli: "codex", sessionId: "session-4" },
    isTabRunActive: () => false,
    readMessages: () => [],
    isAborted: () => aborted,
    runPrompt: async () => {
      aborted = true;
      throw new Error("stopped by user");
    },
    unavailableMessage: "unavailable",
    busyMessage: "busy",
    emptyMessage: "empty",
    failedMessage: (detail) => `failed:${detail}`,
  });
  assert.deepEqual(result, { status: "stopped" });
});
