import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractOpenCodeTaskListItems,
  isOpenCodeTaskListTool,
} from "../cli/openCodeTaskList";

test("normalizes OpenCode todowrite input todos", () => {
  assert.deepEqual(extractOpenCodeTaskListItems({
    input: {
      todos: [
        { content: "检查日志格式", status: "completed", priority: "high" },
        { content: "实现任务列表解析", status: "in_progress", priority: "high" },
        { content: "运行构建验证", status: "pending", priority: "medium" },
      ],
    },
  }), [
    { text: "检查日志格式", done: true },
    { text: "实现任务列表解析", done: false },
    { text: "运行构建验证", done: false },
  ]);
});

test("reads OpenCode todos from metadata and JSON output fallbacks", () => {
  assert.deepEqual(extractOpenCodeTaskListItems({
    metadata: {
      todos: [{ text: "同步文档", completed: true }],
    },
  }), [{ text: "同步文档", done: true }]);

  assert.deepEqual(extractOpenCodeTaskListItems({
    output: JSON.stringify([
      { title: "执行测试", status: "done" },
      { subject: "检查结果", status: "pending" },
    ]),
  }), [
    { text: "执行测试", done: true },
    { text: "检查结果", done: false },
  ]);
});

test("distinguishes an explicit empty OpenCode todo list from missing data", () => {
  assert.deepEqual(extractOpenCodeTaskListItems({ input: { todos: [] } }), []);
  assert.equal(extractOpenCodeTaskListItems({ input: { query: "todo" } }), null);
});

test("recognizes OpenCode todowrite tool aliases", () => {
  assert.equal(isOpenCodeTaskListTool("todowrite"), true);
  assert.equal(isOpenCodeTaskListTool("Todo_Write"), true);
  assert.equal(isOpenCodeTaskListTool("todo-write"), true);
  assert.equal(isOpenCodeTaskListTool("read"), false);
});
