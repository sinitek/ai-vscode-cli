import test = require("node:test");
import assert = require("node:assert/strict");

import {
  ClaudeTaskListTracker,
  extractClaudeTodoWriteItems,
  hasClaudeTodoWriteResultShape,
} from "../../interactive/claudeTaskList";

test("TodoWrite payload parsing keeps existing Claude todo behavior", () => {
  const items = extractClaudeTodoWriteItems({
    newTodos: [
      { content: "inspect logs", status: "pending" },
      { text: "patch parser", completed: true },
    ],
  });
  assert.deepEqual(items, [
    { text: "inspect logs", done: false },
    { text: "patch parser", done: true },
  ]);
  assert.equal(hasClaudeTodoWriteResultShape({ todos: [] }), true);
  assert.equal(hasClaudeTodoWriteResultShape({ foo: [] }), false);
});

test("Claude task tracker builds task list from TaskCreate and TaskUpdate events", () => {
  const tracker = new ClaudeTaskListTracker();

  assert.equal(
    tracker.recordToolUse({
      id: "tooluse_task_1",
      name: "TaskCreate",
      input: {
        subject: "深入调研现有 HTML 设计器实现",
        description: "read diagram editor files",
      },
    }),
    null
  );

  assert.deepEqual(
    tracker.recordToolResult({
      toolUseId: "tooluse_task_1",
      toolName: "TaskCreate",
      content: {
        task: {
          id: "1",
          subject: "深入调研现有 HTML 设计器实现",
        },
      },
    }),
    [{ text: "深入调研现有 HTML 设计器实现", done: false }]
  );

  assert.deepEqual(
    tracker.recordToolUse({
      id: "tooluse_task_2",
      name: "TaskCreate",
      input: {
        subject: "梳理后端图稿存储与 AI 生成链路",
      },
    }),
    null
  );

  assert.deepEqual(
    tracker.recordToolResult({
      toolUseId: "tooluse_task_2",
      toolName: "TaskCreate",
      content: "Task #2 created successfully: 梳理后端图稿存储与 AI 生成链路",
    }),
    [
      { text: "深入调研现有 HTML 设计器实现", done: false },
      { text: "梳理后端图稿存储与 AI 生成链路", done: false },
    ]
  );

  assert.deepEqual(
    tracker.recordToolUse({
      id: "tooluse_task_1_update",
      name: "TaskUpdate",
      input: {
        taskId: "1",
        status: "completed",
      },
    }),
    [
      { text: "深入调研现有 HTML 设计器实现", done: true },
      { text: "梳理后端图稿存储与 AI 生成链路", done: false },
    ]
  );

  assert.equal(
    tracker.recordToolResult({
      toolUseId: "tooluse_task_1_update",
      toolName: "TaskUpdate",
      content: {
        success: true,
        taskId: "1",
        updatedFields: ["status"],
        statusChange: {
          from: "pending",
          to: "completed",
        },
      },
    }),
    null
  );
});

test("Claude task tracker replaces state from TaskList payloads", () => {
  const tracker = new ClaudeTaskListTracker();

  assert.deepEqual(
    tracker.recordToolResult({
      toolName: "TaskList",
      content: {
        tasks: [
          { id: "1", subject: "alpha", status: "pending" },
          { id: "2", subject: "beta", status: "completed" },
        ],
      },
    }),
    [
      { text: "alpha", done: false },
      { text: "beta", done: true },
    ]
  );
});
