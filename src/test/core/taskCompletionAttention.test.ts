import test = require("node:test");
import assert = require("node:assert/strict");
import { createHumanInteractionAttentionController } from "../../humanInteractionAttention";
import { notifyLoopTaskCompletion, notifyTaskRunCompletion } from "../../taskCompletionAttention";
import type { TaskRunRecord } from "../../promptRunState";

function harness() {
  const events: string[] = [];
  const controller = createHumanInteractionAttentionController({
    isFocused: () => false,
    isLocal: () => true,
    readSettings: () => ({ notifications: true, windowAttention: true }),
    transport: {
      notify: async (kind) => { events.push(kind ?? "human-interaction"); },
      startAttention: async () => { events.push("start"); },
      stopAttention: async () => { events.push("stop"); },
    },
    onError: () => undefined,
  });
  return { events, controller };
}

function runRecord(patch: Partial<TaskRunRecord> = {}): TaskRunRecord {
  return {
    id: "run", cli: "codex", sessionId: null, prompt: "private prompt",
    startedAt: 1, endedAt: 2, durationMs: 1, status: "end", ...patch,
  };
}

test("successful Vibe runs and finalized main tasks notify through separate deduplicated identities", async () => {
  const env = harness();
  notifyTaskRunCompletion(env.controller, runRecord());
  await env.controller.refresh();
  notifyTaskRunCompletion(env.controller, runRecord());
  notifyLoopTaskCompletion(env.controller, { id: "run", status: "completed" });
  await env.controller.refresh();
  notifyLoopTaskCompletion(env.controller, { id: "run", status: "completed" });
  await env.controller.refresh();
  assert.deepEqual(env.events, ["task-completed", "start", "task-completed"]);
  await env.controller.dispose();
});

test("subtasks, main-model intermediate runs, failed and stopped runs never notify", async () => {
  const env = harness();
  for (const patch of [
    { taskRole: "subtask" as const }, { taskRole: "main" as const },
    { loopTaskId: "parent" }, { loopSubtaskId: "child" }, { loopRound: 1 },
    { status: "error" as const }, { status: "stopped" as const },
  ]) {
    notifyTaskRunCompletion(env.controller, runRecord(patch));
  }
  for (const status of ["running", "needs-review", "error", "stopped"] as const) {
    notifyLoopTaskCompletion(env.controller, { id: "parent", status });
  }
  await env.controller.refresh();
  assert.deepEqual(env.events, []);
});

test("completion reporting tolerates a missing desktop host", () => {
  notifyTaskRunCompletion(undefined, runRecord());
  notifyLoopTaskCompletion(undefined, { id: "parent", status: "completed" });
});

test("a resumed main task can notify for a new persisted completion without replaying the previous completion", async () => {
  const env = harness();
  notifyLoopTaskCompletion(env.controller, { id: "parent", status: "completed", updatedAt: 1 });
  await env.controller.refresh();
  notifyLoopTaskCompletion(env.controller, { id: "parent", status: "completed", updatedAt: 1 });
  await env.controller.refresh();
  notifyLoopTaskCompletion(env.controller, { id: "parent", status: "completed", updatedAt: 2 });
  await env.controller.refresh();
  assert.deepEqual(env.events, ["task-completed", "start", "task-completed"]);
  await env.controller.dispose();
});
