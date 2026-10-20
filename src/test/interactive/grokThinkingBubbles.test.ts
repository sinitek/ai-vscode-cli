import test = require("node:test");
import assert = require("node:assert/strict");

import { FINAL_ANSWER_TEXT_MARKER } from "../../finalAnswerProtocol";
import {
  collapseGrokConsecutiveThinkingMessages,
  prepareGrokThinkingContinuation,
  type GrokThinkingBubbleMessage,
} from "../../interactive/grokThinkingBubbles";

function message(
  id: string,
  role: GrokThinkingBubbleMessage["role"],
  content: string,
  kind?: GrokThinkingBubbleMessage["kind"],
): GrokThinkingBubbleMessage {
  return {
    id,
    role,
    content,
    ...(kind ? { kind } : {}),
  };
}

test("folds consecutive Grok thinking bubbles and keeps the trailing progress sentence", () => {
  const collapsed = collapseGrokConsecutiveThinkingMessages([
    message("tool", "trace", "tool: read_file", "tool-use"),
    message("status-before", "assistant", "磁盘核对已经对齐类型、配置顺序和执行入口。"),
    message("think-1", "assistant", "CSS 文件名已被测试用例固定。", "thinking"),
    message("status-mid", "assistant", "磁盘核对已经对齐类型、配置档案、路由和配置页现状。"),
    message("think-2", "assistant", "测试已固定 CSS 文件名。", "thinking"),
    message("status-after", "assistant", "接下来只写审计交接，不改产品代码。"),
  ]);

  assert.equal(collapsed.changed, true);
  assert.deepEqual(collapsed.messages.map((item) => [item.id, item.kind ?? "", item.content]), [
    ["tool", "tool-use", "tool: read_file"],
    ["status-before", "", "磁盘核对已经对齐类型、配置顺序和执行入口。"],
    ["think-1", "thinking", "CSS 文件名已被测试用例固定。\n\n磁盘核对已经对齐类型、配置档案、路由和配置页现状。\n\n测试已固定 CSS 文件名。"],
    ["status-after", "", "接下来只写审计交接，不改产品代码。"],
  ]);
});

test("keeps one thinking bubble and its following answer separate", () => {
  const messages = [
    message("think", "assistant", "先看调用链。", "thinking"),
    message("answer", "assistant", "磁盘核对已经对齐，接下来只写审计交接。"),
  ];

  const collapsed = collapseGrokConsecutiveThinkingMessages(messages);

  assert.equal(collapsed.changed, false);
  assert.deepEqual(collapsed.messages.map((item) => item.id), ["think", "answer"]);
});

test("appends the next Grok thought into the previous thinking bubble", () => {
  const messages = [
    message("tool", "trace", "tool: grep", "tool-use"),
    message("think", "assistant", "CSS 文件名已被测试用例固定。", "thinking"),
    message("status", "assistant", "磁盘核对已经对齐类型、配置档案、路由和配置页现状。"),
  ];

  const continuation = prepareGrokThinkingContinuation(messages);

  assert.deepEqual(continuation, {
    thinkingMessageId: "think",
    removedIds: ["status"],
    appendedContent: "\n\n磁盘核对已经对齐类型、配置档案、路由和配置页现状。",
    separateNextChunk: true,
  });
  assert.deepEqual(messages.map((item) => item.id), ["tool", "think"]);
  assert.equal(
    messages[1]?.content,
    "CSS 文件名已被测试用例固定。\n\n磁盘核对已经对齐类型、配置档案、路由和配置页现状。",
  );
});

test("continues an open Grok thinking bubble without adding a separator", () => {
  const messages = [
    message("think", "assistant", "正在核对", "thinking"),
  ];

  const continuation = prepareGrokThinkingContinuation(messages);

  assert.deepEqual(continuation, {
    thinkingMessageId: "think",
    removedIds: [],
    appendedContent: "",
    separateNextChunk: false,
  });
  assert.equal(messages[0]?.content, "正在核对");
});

test("does not append a new Grok thought across tools or a final answer", () => {
  const afterTool = [
    message("think", "assistant", "先看调用链。", "thinking"),
    message("tool", "trace", "tool: read_file", "tool-use"),
  ];
  assert.equal(prepareGrokThinkingContinuation(afterTool), null);

  const afterAnswer = [
    message("think", "assistant", "先看调用链。", "thinking"),
    message("answer", "assistant", `${FINAL_ANSWER_TEXT_MARKER}\n交接已写完。`),
  ];
  assert.equal(prepareGrokThinkingContinuation(afterAnswer), null);
  assert.equal(afterAnswer[1]?.content?.includes("交接已写完"), true);
});
