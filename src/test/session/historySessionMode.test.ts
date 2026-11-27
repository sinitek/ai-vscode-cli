import * as assert from "node:assert/strict";
import { test } from "node:test";

import { classifyHistorySession } from "../../historySessionMode";
import type { LoopTaskRecord } from "../../loopTaskStore";

function task(patch: Record<string, unknown>): LoopTaskRecord {
  return {
    id: "task",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "tasks.json",
    rootPrompt: "任务",
    sessionId: "main-session",
    subTasks: [],
    updatedAt: 1,
    ...patch,
  } as unknown as LoopTaskRecord;
}

test("classifies classic Loop and event-driven Loop+ main and subtask sessions", () => {
  const tasks = [
    task({ id: "loop", sessionId: "loop-main", subTasks: [{ id: "loop-child", executionSession: { cli: "codex", sessionId: "loop-sub" } }] }),
    task({ id: "loop-plus", sessionId: "plus-main", schedulingMode: "event_driven", subTasks: [{ id: "plus-child", executionSession: { cli: "claude", sessionId: "plus-sub" } }] }),
  ];

  assert.deepEqual(classifyHistorySession(tasks, "codex", "loop-main"), { mode: "loop", taskRole: "main" });
  assert.deepEqual(classifyHistorySession(tasks, "codex", "loop-sub"), { mode: "loop", taskRole: "subtask" });
  assert.deepEqual(classifyHistorySession(tasks, "codex", "plus-main"), { mode: "loop-plus", taskRole: "main" });
  assert.deepEqual(classifyHistorySession(tasks, "claude", "plus-sub"), { mode: "loop-plus", taskRole: "subtask" });
  assert.deepEqual(classifyHistorySession(tasks, "codex", "plus-sub"), { mode: "vibe", taskRole: null });
});

test("classifies only a department director root as department and hides department workers", () => {
  const department = { role: "director", rootTaskId: "director", parentTaskId: null, leaderSubtaskId: null, executionMode: "loop-plus" };
  const tasks = [
    task({ id: "director", sessionId: "director-session", department }),
    task({ id: "leader", sessionId: "leader-session", department: { ...department, role: "leader" } }),
    task({ id: "worker-owner", sessionId: null, department, subTasks: [{ id: "worker", executionSession: { cli: "codex", sessionId: "worker-session" } }] }),
    task({ id: "invalid-root", sessionId: "invalid-root-session", department }),
  ];

  assert.deepEqual(classifyHistorySession(tasks, "codex", "director-session"), { mode: "department", taskRole: "main" });
  assert.deepEqual(classifyHistorySession(tasks, "codex", "leader-session"), { mode: "internal", taskRole: "main" });
  assert.deepEqual(classifyHistorySession(tasks, "codex", "worker-session"), { mode: "internal", taskRole: "subtask" });
  assert.deepEqual(classifyHistorySession(tasks, "codex", "invalid-root-session"), { mode: "internal", taskRole: "main" });
  assert.deepEqual(classifyHistorySession(tasks, "claude", "director-session"), { mode: "vibe", taskRole: null });
});

test("classifies conflicting task bindings as internal instead of guessing", () => {
  const tasks = [
    task({ id: "first", sessionId: "shared" }),
    task({ id: "second", sessionId: "shared", schedulingMode: "event_driven" }),
  ];

  assert.deepEqual(classifyHistorySession(tasks, "codex", "shared"), { mode: "internal", taskRole: null });
  assert.deepEqual(classifyHistorySession([], "codex", "unbound"), { mode: "vibe", taskRole: null });
});
