import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSessionHealth } from "../../sessionHealth";
import { mergeSessionRecords } from "../../interactive/sessionHistoryRepair";
import type { ChatMessage } from "../../webview/types";

function createMessage(role: ChatMessage["role"], content: string, kind?: ChatMessage["kind"]): ChatMessage {
  return { id: "message", role, content, kind };
}

test("keeps empty, error-only and diagnostic-only conversations abnormal", () => {
  const messages = [
    createMessage("user", "请执行任务"),
    createMessage("system", "执行失败，正在重试"),
    createMessage("trace", "error\nAuthentication failed"),
    createMessage("trace", "错误：鉴权失败", "tool-use"),
    createMessage("trace", "warning: reconnecting"),
    createMessage("trace", "警告：连接中断", "thinking"),
    createMessage("trace", "Reconnecting... 1/5"),
    createMessage("assistant", "  ", "thinking"),
    createMessage("assistant", "[final_answer]"),
    createMessage("trace", "  ", "tool-use"),
  ];
  assert.equal(resolveSessionHealth(undefined, []), "abnormal");
  assert.equal(resolveSessionHealth(undefined, messages), "abnormal");
  assert.equal(resolveSessionHealth("abnormal", messages), "abnormal");
});

test("marks a conversation normal after any real operation, thought or assistant reply", () => {
  const messages = [
    createMessage("assistant", "先查看实现", "thinking"),
    createMessage("assistant", "正在处理"),
    createMessage("assistant", "[final_answer] 已完成"),
    createMessage("trace", "分析执行方案", "thinking"),
    createMessage("trace", "读取配置", "tool-use"),
    createMessage("trace", "thinking\nInspect the sources"),
    createMessage("trace", "exec npm run build"),
    createMessage("trace", "【执行命令】 npm run build"),
    createMessage("trace", "file update\nsrc/example.ts"),
    createMessage("trace", "tool Read"),
    createMessage("trace", "tool result: Read\n{}"),
    createMessage("trace", "工具结果：Read\n{}"),
    createMessage("trace", "【网络查询】会话恢复"),
  ];
  for (const message of messages) {
    assert.equal(resolveSessionHealth("abnormal", [message]), "normal", message.content);
  }
});

test("never downgrades a session after it has become normal", () => {
  assert.equal(resolveSessionHealth("normal", []), "normal");
  assert.equal(resolveSessionHealth("normal", [createMessage("system", "后续执行失败")]), "normal");
});

test("preserves normal health from either side of a session migration", () => {
  const record = { id: "session", label: "会话", createdAt: 1, lastUsedAt: 2 };
  assert.equal(mergeSessionRecords({ ...record, health: "abnormal" }, { ...record, health: "normal" }).health, "normal");
  assert.equal(mergeSessionRecords({ ...record, health: "normal" }, { ...record, health: "abnormal" }).health, "normal");
  assert.equal(mergeSessionRecords(record, { ...record, health: "abnormal" }).health, "abnormal");
  assert.equal(mergeSessionRecords(record, record).health, undefined);
});
