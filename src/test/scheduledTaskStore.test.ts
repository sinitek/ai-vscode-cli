import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildScheduledTaskSummaries,
  createScheduledTaskRecord,
  ensureScheduledTaskStore,
  normalizeScheduledTaskRecord,
  readScheduledTaskStore,
  removeScheduledTask,
  resolveScheduledTaskExecutionConfig,
  resolveScheduledTaskExecutionConfigForTask,
  ScheduledTaskScheduler,
  upsertScheduledTask,
  writeScheduledTaskStore,
  type ScheduledTaskStore,
} from "../scheduledTaskStore";
import type { CliName, InteractiveMode, ThinkingMode } from "../cli/types";

const NOW = Date.UTC(2026, 8, 15, 8, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;

const storeDeps = {
  isCliName: (value: string): value is CliName => (
    value === "codex" || value === "claude" || value === "opencode"
  ),
  isInteractiveMode: (value: unknown): value is InteractiveMode => (
    value === "coding" || value === "plan" || value === "loop" || value === "graph"
  ),
  isThinkingMode: (value: unknown): value is ThinkingMode => (
    value === "off" || value === "on" || value === "low" || value === "medium"
      || value === "high" || value === "xhigh" || value === "max" || value === "ultra"
  ),
};

function createInput(overrides: Partial<Parameters<typeof createScheduledTaskRecord>[0]> = {}) {
  return {
    id: "task-1",
    prompt: "  检查构建状态  ",
    scheduledAt: NOW + DAY_MS,
    cli: "codex" as const,
    tabId: " tab-1 ",
    workspaceKey: "workspace-a",
    interactiveMode: "loop" as const,
    contextOptions: { includeCurrentFile: true, includeSelection: false },
    model: "  gpt-test  ",
    loopMainModel: "main-model",
    loopSubtaskModel: "subtask-model",
    loopMainThinkingMode: "high" as const,
    loopSubtaskThinkingMode: "medium" as const,
    loopExecutionMode: "debate_multi_agent" as const,
    attachments: [{ name: "report.md", path: "/tmp/report.md" }],
    ...overrides,
  };
}

function createTask(
  id: string,
  overrides: Partial<Parameters<typeof createScheduledTaskRecord>[0]> = {},
  now = NOW,
) {
  return createScheduledTaskRecord(createInput({ id, ...overrides }), now);
}

function createFakeTimer() {
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const cleared: Array<{ callback: () => void; delayMs: number }> = [];
  return {
    scheduled,
    cleared,
    setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
      scheduled.push({ callback, delayMs });
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(handle: ReturnType<typeof setTimeout>): void {
      const index = Number(handle) - 1;
      if (index >= 0 && index < scheduled.length) {
        const entry = scheduled[index];
        if (entry) {
          cleared.push(entry);
        }
      }
    },
  };
}

test("creates and upserts normalized task records with attachments and execution options", () => {
  const task = createTask("task-1");
  assert.deepEqual(task, {
    id: "task-1",
    prompt: "检查构建状态",
    scheduledAt: NOW + DAY_MS,
    createdAt: NOW,
    updatedAt: NOW,
    cli: "codex",
    tabId: "tab-1",
    workspaceKey: "workspace-a",
    status: "pending",
    interactiveMode: "loop",
    contextOptions: { includeCurrentFile: true, includeSelection: false },
    model: "gpt-test",
    loopMainModel: "main-model",
    loopSubtaskModel: "subtask-model",
    loopMainThinkingMode: "high",
    loopSubtaskThinkingMode: "medium",
    loopExecutionMode: "debate_multi_agent",
    attachments: [{ name: "report.md", path: "/tmp/report.md" }],
  });

  const store: ScheduledTaskStore = { tasks: [task] };
  const replaced = upsertScheduledTask(store, createInput({ id: "task-1", prompt: "updated" }), NOW + 1);
  assert.equal(store.tasks.length, 1);
  assert.equal(replaced.prompt, "updated");
  assert.equal(store.tasks[0]?.updatedAt, NOW + 1);
});

test("resolves scheduled execution mode from the mode active at execution time", () => {
  assert.deepEqual(
    resolveScheduledTaskExecutionConfig("loop", "debate_multi_agent"),
    { interactiveMode: "loop", loopExecutionMode: "debate_multi_agent" },
  );
  assert.deepEqual(
    resolveScheduledTaskExecutionConfig("graph", "debate_multi_agent"),
    { interactiveMode: "graph" },
  );
  assert.deepEqual(
    resolveScheduledTaskExecutionConfig("coding", "debate_multi_agent"),
    { interactiveMode: "coding" },
  );
});

test("prefers the task selected mode and falls back for legacy records", () => {
  assert.deepEqual(
    resolveScheduledTaskExecutionConfigForTask(
      { interactiveMode: "graph" },
      "loop",
      "debate_multi_agent",
    ),
    { interactiveMode: "graph" },
  );
  assert.deepEqual(
    resolveScheduledTaskExecutionConfigForTask(
      { interactiveMode: "loop", loopExecutionMode: "main_sub_multi_agent" },
      "coding",
      "debate_multi_agent",
    ),
    { interactiveMode: "loop", loopExecutionMode: "main_sub_multi_agent" },
  );
  assert.deepEqual(
    resolveScheduledTaskExecutionConfigForTask(
      { interactiveMode: "loop" },
      "coding",
      "debate_multi_agent",
    ),
    { interactiveMode: "loop", loopExecutionMode: "debate_multi_agent" },
  );
  assert.deepEqual(
    resolveScheduledTaskExecutionConfigForTask(
      {},
      "coding",
      "debate_multi_agent",
    ),
    { interactiveMode: "coding" },
  );
});

test("rejects empty prompts and invalid schedule times", () => {
  assert.throws(
    () => createScheduledTaskRecord(createInput({ prompt: "   " })),
    /prompt cannot be empty/u,
  );
  assert.throws(
    () => createScheduledTaskRecord(createInput({ scheduledAt: Number.NaN })),
    /time is invalid/u,
  );
});

test("normalizes persisted records, drops invalid attachments, and recovers running tasks", () => {
  const normalized = normalizeScheduledTaskRecord({
    ...createTask("task-1"),
    status: "running",
    updatedAt: 0,
    interactiveMode: "unknown",
    loopMainThinkingMode: "unknown",
    attachments: [
      { name: " valid.txt ", path: " /tmp/valid.txt " },
      { name: "", path: "/tmp/missing-name" },
      "invalid",
    ],
  }, storeDeps);

  assert.ok(normalized);
  assert.equal(normalized.status, "pending");
  assert.equal(normalized.updatedAt, normalized.createdAt);
  assert.equal(normalized.interactiveMode, undefined);
  assert.equal(normalized.loopMainThinkingMode, undefined);
  assert.deepEqual(normalized.attachments, [{ name: "valid.txt", path: "/tmp/valid.txt" }]);
  assert.equal(normalizeScheduledTaskRecord({ prompt: "missing id" }, storeDeps), null);
  assert.equal(normalizeScheduledTaskRecord({ ...createTask("bad"), cli: "other" }, storeDeps), null);
});

test("retains active tasks, removes old terminal history, and caps the store", () => {
  const oldCompleted = { ...createTask("old-completed", { scheduledAt: NOW - 10 * DAY_MS }, NOW - RETENTION_MS - DAY_MS), status: "completed" as const };
  const oldPending = createTask("old-pending", { scheduledAt: NOW - 90 * DAY_MS }, NOW - RETENTION_MS - DAY_MS);
  const running = { ...createTask("running"), status: "running" as const, updatedAt: NOW - RETENTION_MS - DAY_MS };
  const recentFailed = { ...createTask("recent-failed"), status: "failed" as const, updatedAt: NOW - DAY_MS };
  const capped = ensureScheduledTaskStore({
    tasks: [oldCompleted, oldPending, running, recentFailed],
  }, storeDeps, NOW);

  assert.deepEqual(capped.tasks.map((task) => task.id), ["old-pending", "running", "recent-failed"]);
  assert.equal(capped.tasks.find((task) => task.id === "running")?.status, "pending");

  const many = Array.from({ length: 505 }, (_, index) => createTask(`task-${index}`, {
    scheduledAt: NOW + index,
  }));
  assert.equal(ensureScheduledTaskStore({ tasks: many }, storeDeps, NOW).tasks.length, 500);
});

test("uses the configured history retention callback for terminal tasks", () => {
  const oldCompleted = { ...createTask("old-completed"), status: "completed" as const, updatedAt: NOW - 10 * DAY_MS };
  const recentCompleted = { ...createTask("recent-completed"), status: "completed" as const, updatedAt: NOW - DAY_MS };
  const retained = ensureScheduledTaskStore({ tasks: [oldCompleted, recentCompleted] }, {
    ...storeDeps,
    isTimestampWithinHistoryRetention: (timestamp, now) => timestamp >= (now ?? NOW) - 2 * DAY_MS,
  }, NOW);
  assert.deepEqual(retained.tasks.map((task) => task.id), ["recent-completed"]);
});

test("reads and writes JSON stores while recovering malformed files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-scheduled-store-"));
  const storeFile = path.join(tempDir, "nested", "scheduled-tasks.json");
  const errors: string[] = [];
  const deps = {
    ...storeDeps,
    storeFile,
    logError: (event: string) => errors.push(event),
  };
  try {
    const task = createTask("task-1");
    writeScheduledTaskStore({ tasks: [task] }, deps);
    assert.deepEqual(readScheduledTaskStore(deps).tasks, [task]);

    fs.writeFileSync(storeFile, "not-json", "utf8");
    assert.deepEqual(readScheduledTaskStore(deps), { tasks: [] });
    assert.deepEqual(errors, ["scheduled-task-store-read-error"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("builds summaries in reverse schedule order and removes tasks by id", () => {
  const first = createTask("first", { scheduledAt: NOW + DAY_MS });
  const second = createTask("second", { scheduledAt: NOW + 2 * DAY_MS });
  const store: ScheduledTaskStore = { tasks: [first, second] };
  const summaries = buildScheduledTaskSummaries(store);
  assert.deepEqual(summaries.map((task) => task.id), ["second", "first"]);
  assert.equal(summaries[0]?.interactiveMode, "loop");
  assert.equal(removeScheduledTask(store, "first")?.id, "first");
  assert.equal(removeScheduledTask(store, "missing"), null);
  assert.deepEqual(store.tasks.map((task) => task.id), ["second"]);
});

test("executes due tasks for the active workspace and records success or failure", async () => {
  let now = NOW;
  let store: ScheduledTaskStore = {
    tasks: [
      createTask("due", { scheduledAt: NOW - 1 }),
      createTask("future", { scheduledAt: NOW + DAY_MS }),
      createTask("other-workspace", { scheduledAt: NOW - 1, workspaceKey: "workspace-b" }),
    ],
  };
  const writes: ScheduledTaskStore[] = [];
  const executed: string[] = [];
  const changes: number[] = [];
  const scheduler = new ScheduledTaskScheduler({
    readStore: () => store,
    writeStore: (next) => {
      store = next;
      writes.push(next);
    },
    getWorkspaceKey: () => "workspace-a",
    executeTask: async (task) => {
      executed.push(task.id);
    },
    onChanged: () => changes.push(changes.length + 1),
    now: () => now,
    setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => undefined,
  });
  scheduler.start();
  await scheduler.runDueTasks();
  scheduler.stop();

  assert.deepEqual(executed, ["due"]);
  assert.equal(store.tasks.find((task) => task.id === "due")?.status, "completed");
  assert.equal(store.tasks.find((task) => task.id === "due")?.executedAt, NOW);
  assert.equal(store.tasks.find((task) => task.id === "other-workspace")?.status, "pending");
  assert.ok(writes.length >= 2);
  assert.ok(changes.length >= 2);

  now = NOW + DAY_MS;
  store.tasks.find((task) => task.id === "future")!.scheduledAt = now - 1;
  const failingScheduler = new ScheduledTaskScheduler({
    readStore: () => store,
    writeStore: (next) => { store = next; },
    getWorkspaceKey: () => "workspace-a",
    executeTask: async (task) => { throw new Error(`failed:${task.id}`); },
    now: () => now,
    setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => undefined,
  });
  failingScheduler.start();
  await failingScheduler.runDueTasks();
  failingScheduler.stop();
  const failed = store.tasks.find((task) => task.id === "future");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.lastError, "failed:future");
});

test("limits the next timer delay to one minute and reschedules after changes", () => {
  const timers = createFakeTimer();
  const task = createTask("future", { scheduledAt: NOW + 10 * 60 * 1000 });
  let store: ScheduledTaskStore = { tasks: [task] };
  const scheduler = new ScheduledTaskScheduler({
    readStore: () => store,
    writeStore: (next) => { store = next; },
    getWorkspaceKey: () => "workspace-a",
    executeTask: async () => undefined,
    now: () => NOW,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  scheduler.start();
  assert.equal(timers.scheduled[0]?.delayMs, 60 * 1000);
  scheduler.notifyChanged();
  assert.equal(timers.cleared.length, 1);
  scheduler.stop();
  assert.equal(timers.cleared.length, 2);
});
