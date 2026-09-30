import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { ChatMessage } from "../../webview/types";
import {
  applyLoopAskThinking,
  beginLoopAskTurn,
  createEmptyLoopAskThread,
  loopAskThreadPath,
  parseLoopAskThread,
  projectLoopAskThinking,
  readLoopAskThreadFile,
  settleLoopAskTurn,
  writeLoopAskThreadFile,
} from "../../loopAskThread";

function message(id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: "assistant", content, ...extra };
}

test("keeps ask history and settles only the final answer", () => {
  const started = beginLoopAskTurn(createEmptyLoopAskThread(1), "  可以合并吗  ", 2, "ask-1");
  assert.equal(started.running, true);
  assert.equal(started.dialogOpen, true);
  assert.deepEqual(started.messages.map((item) => item.role), ["user"]);

  const withThinking = applyLoopAskThinking(started, [], [
    message("tool", "tool: read", { kind: "tool-use" }),
    message("think", "thinking 先看冲突", { kind: "thinking" }),
    message("reason", "**Planning**\n检查写入范围"),
    message("old", "thinking 旧思考", { kind: "thinking" }),
  ].slice(0, 3), 3);
  assert.deepEqual(withThinking.messages.map((item) => item.content), [
    "可以合并吗",
    "先看冲突",
    "**Planning**\n检查写入范围",
  ]);

  const settled = settleLoopAskTurn(withThinking, {
    answer: "可以合并。",
    now: 4,
    noticeId: "ask-1:result",
  });
  assert.equal(settled.running, false);
  assert.equal(settled.dialogOpen, true);
  assert.deepEqual(settled.messages.map((item) => [item.role, item.content]), [
    ["user", "可以合并吗"],
    ["assistant", "可以合并。"],
  ]);

  const next = beginLoopAskTurn({
    ...settled,
    messages: [
      ...settled.messages,
      { id: "legacy", role: "thinking", content: "旧思考", createdAt: 4 },
    ],
  }, "再确认一次", 5, "ask-2");
  assert.equal(next.messages[0]?.content, "可以合并吗");
  assert.equal(next.messages.at(-1)?.content, "再确认一次");
  assert.equal(next.messages.some((item) => item.role === "thinking"), false);
  assert.equal(next.running, true);
});

test("projects only new or updated thinking and ignores unchanged or tool text", () => {
  const before = [
    message("same", "thinking 没变", { kind: "thinking" }),
    message("tool", "exec ls", { kind: "tool-use" }),
  ];
  const current = [
    ...before,
    message("same", "thinking 没变", { kind: "thinking" }),
    message("changed", "思考：补充边界", { kind: "thinking" }),
    message("blank", "thinking   ", { kind: "thinking" }),
  ];
  current[0] = message("same", "thinking 没变", { kind: "thinking" });
  assert.deepEqual(projectLoopAskThinking(before, current), [
    { id: "changed", content: "补充边界" },
  ]);
  assert.equal(applyLoopAskThinking(createEmptyLoopAskThread(), before, current, 1).running, false);
});

test("settles a stop notice without dropping prior bubbles and caps stored messages", () => {
  const stopped = settleLoopAskTurn({
    version: 1,
    running: true,
    dialogOpen: true,
    updatedAt: 1,
    messages: [
      { id: "q", role: "user", content: "问题", createdAt: 1 },
      { id: "t", role: "thinking", content: "", createdAt: 1, streaming: true },
    ],
  }, {
    notice: "已中止这次回答。",
    now: 2,
    noticeId: "stop",
  });
  assert.deepEqual(stopped.messages.map((item) => [item.role, item.content]), [
    ["user", "问题"],
    ["system", "已中止这次回答。"],
  ]);

  const bloated = parseLoopAskThread(JSON.stringify({
    version: 1,
    running: false,
    dialogOpen: false,
    updatedAt: 9,
    messages: Array.from({ length: 205 }, (_item, index) => ({
      id: `m-${index}`,
      role: "user",
      content: String(index),
      createdAt: index,
    })),
  }));
  assert.equal(bloated?.messages.length, 200);
  assert.equal(bloated?.messages[0]?.content, "5");
  assert.equal(parseLoopAskThread("{"), null);
  assert.equal(parseLoopAskThread(JSON.stringify({ version: 2, messages: [] })), null);
});

test("round-trips the ask thread beside the task communication directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-ask-"));
  const filePath = loopAskThreadPath(dir);
  assert.equal(readLoopAskThreadFile(filePath).messages.length, 0);
  writeLoopAskThreadFile(filePath, {
    version: 1,
    running: false,
    dialogOpen: false,
    updatedAt: 3,
    messages: [{ id: "q", role: "user", content: "历史问题", createdAt: 3 }],
  });
  assert.equal(readLoopAskThreadFile(filePath).messages[0]?.content, "历史问题");
  fs.writeFileSync(filePath, "{", "utf8");
  assert.equal(readLoopAskThreadFile(filePath).messages.length, 0);
  writeLoopAskThreadFile("", createEmptyLoopAskThread());
});
