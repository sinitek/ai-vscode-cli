import * as assert from "node:assert/strict";
import { test } from "node:test";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import {
  buildUserChatMessage,
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
});
