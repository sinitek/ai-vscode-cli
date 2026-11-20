import * as assert from "node:assert/strict";
import { test } from "node:test";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import {
  buildUserChatMessage,
  buildVibeModeTransitionPrompt,
  resolveLoopConversationTabContextFromMessages,
  resolveLoopSubtaskConversationContextFromMessages,
} from "../../panelStateBuilder";
import type { ChatMessage } from "../../webview/types";

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return partial;
}

test("keeps the main task identity after a loop ask is appended", () => {
  const context = resolveLoopConversationTabContextFromMessages([
    message({
      id: "main",
      role: "user",
      content: "完成这个任务",
      taskRole: "main",
      loopTaskId: "loop-1",
    }),
    message({ id: "ask", role: "user", content: "为什么这样拆？", loopAsk: true }),
    message({ id: "answer", role: "assistant", content: "因为写入边界不同。", loopAsk: true }),
    message({ id: "done", role: "system", content: "任务已完成" }),
  ]);

  assert.deepEqual(context, { taskRole: "main", loopTaskId: "loop-1" });
});

test("still treats a later plain user message as leaving the loop task", () => {
  const context = resolveLoopConversationTabContextFromMessages([
    message({
      id: "main",
      role: "assistant",
      content: "主任务结果",
      taskRole: "main",
      loopTaskId: "loop-1",
    }),
    message({ id: "ask", role: "user", content: "问一句", loopAsk: true }),
    message({ id: "vibe", role: "user", content: "随便聊聊" }),
  ]);

  assert.deepEqual(context, { taskRole: null, loopTaskId: null });
});

test("resets the orchestration instructions on the first Vibe prompt in a reused session", () => {
  const input = {
    displayPrompt: "直接修复这个问题",
    modelPrompt: "直接修复这个问题\n附加文件上下文",
    preloadedUserMessageId: "vibe-request",
  };
  const current = buildUserChatMessage({ ...input, contextTags: [] }, 10, input.preloadedUserMessageId);
  for (const loopTaskId of ["loop-task", "loop-plus-task", "department-task"]) {
    const history = [
      message({ id: "old-request", role: "user", content: "原需求" }),
      message({ id: "old-result", role: "assistant", content: '{"action":"done"}', loopTaskId, taskRole: "main" }),
      message({ id: "ask", role: "user", content: "这个结果是什么？", loopAsk: true }),
      current,
      message({ id: "later-request", role: "user", content: "另一个请求" }),
    ];

    const modelPrompt = buildVibeModeTransitionPrompt(input, history);
    assert.ok(modelPrompt.startsWith(input.modelPrompt));
    assert.match(modelPrompt, /当前执行模式是 Vibe/);
    assert.match(modelPrompt, /亲自完成本次任务.*不要派发子任务/);
    assert.match(modelPrompt, /不要返回旧模式.*JSON/);
    assert.equal(current.content, input.displayPrompt);
    assert.equal(buildVibeModeTransitionPrompt({ ...input, preloadedUserMessageId: "later-request" }, history), input.modelPrompt);
  }
});

test("uses the existing prompt for an empty history or a previous Vibe turn", () => {
  const input = { displayPrompt: "继续", modelPrompt: "" };
  const loopResult = message({ id: "old", role: "assistant", content: "旧编排结果", loopTaskId: "loop-task", taskRole: "main" });
  const priorVibe = message({ id: "vibe", role: "user", content: "上一轮 Vibe" });

  assert.equal(buildVibeModeTransitionPrompt(input, []), input.displayPrompt);
  assert.equal(buildVibeModeTransitionPrompt(input, [loopResult, priorVibe]), input.displayPrompt);
  assert.match(buildVibeModeTransitionPrompt(input, [loopResult]), /^继续\n\n当前执行模式是 Vibe/);
});

test("does not let a loop ask clear subtask conversation context", () => {
  const context = resolveLoopSubtaskConversationContextFromMessages([
    message({
      id: "sub",
      role: "user",
      content: "实现这一段",
      taskRole: "subtask",
      loopTaskId: "loop-1",
      loopSubtaskId: "sub-1",
      loopRound: 2,
    }),
    message({ id: "ask", role: "user", content: "这个函数谁调用？", loopAsk: true }),
  ]);

  assert.deepEqual(context, { taskId: "loop-1", subtaskId: "sub-1", round: 2 });
});

test("marks only loop ask user bubbles and leaves ordinary prompts unchanged", () => {
  const ask = buildUserChatMessage({
    displayPrompt: "为什么这样拆？",
    contextTags: [],
    loopAsk: true,
  }, 10, "ask-1");
  const ordinary = buildUserChatMessage({
    displayPrompt: "继续做",
    executionProfile: { configId: "main-config", model: "raw-model", thinkingMode: "high" },
    contextTags: ["file"],
    taskRole: "main",
    loopTaskId: "loop-1",
  }, 11, "main-1");

  assert.equal(ask.loopAsk, true);
  assert.equal(ask.role, "user");
  assert.equal(ask.content, "为什么这样拆？");
  assert.equal(ordinary.loopAsk, undefined);
  assert.equal(ordinary.taskRole, "main");
  assert.equal(ordinary.loopTaskId, "loop-1");
  assert.deepEqual(ordinary.executionProfile, { configId: "main-config", model: "raw-model", thinkingMode: "high" });
});
