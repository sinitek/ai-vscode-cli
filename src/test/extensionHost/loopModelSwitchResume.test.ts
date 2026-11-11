import test = require("node:test");
import assert = require("node:assert/strict");
import { setImmediate as nextTurn } from "node:timers/promises";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { TaskRunStatus } from "../../promptRunState";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
const { createLoopModelSwitchResumeCoordinator } = require("../../extensionHost/loopModelSwitchResume") as typeof import("../../extensionHost/loopModelSwitchResume");

function harness() {
  const task: LoopTaskRecord = {
    id: "task", cli: "codex", workspaceKey: "workspace", taskStoreFile: "/tmp/task.json",
    rootPrompt: "完成任务", status: "running", createdAt: 1, updatedAt: 1, maxRounds: 20, currentRound: 2,
    communicationDir: "/tmp/comm", mainCommunicationFile: "/tmp/comm/main.md", rounds: [],
    completionRoundSummaries: [], completionRequirementCoverage: [],
    activeSubtaskIds: ["blocked", "live"],
    subTasks: [
      { id: "blocked", title: "待续跑", status: "blocked" },
      { id: "live", title: "正在执行", status: "running" },
      { id: "done", title: "已完成", status: "completed" },
      { id: "skipped", title: "已跳过", status: "skipped" },
    ],
  };
  const running = new Set(["live"]);
  const calls: string[] = [];
  const errors: unknown[] = [];
  const releases: Array<(status: TaskRunStatus) => void> = [];
  let activeController = false;
  let idle = Promise.resolve();
  let mains = 0;
  const deps: import("../../extensionHost/loopModelSwitchResume").LoopModelSwitchResumeDeps = {
    readTask: () => task,
    updateTask: (_taskId, patch) => Object.assign(task, patch),
    resumeEventDrivenSubtasks: () => true,
    hasClassicController: () => activeController,
    waitForClassicIdle: () => idle,
    isSubtaskRunning: (_taskId, subtaskId) => running.has(subtaskId),
    runClassicSubtask: async (_task, subtask) => {
      calls.push(subtask.id);
      running.add(subtask.id);
      return new Promise<TaskRunStatus>((resolve) => releases.push((status) => {
        running.delete(subtask.id);
        subtask.status = status === "end" ? "completed" : "blocked";
        if (status === "end") task.activeSubtaskIds = task.activeSubtaskIds?.filter((id) => id !== subtask.id);
        resolve(status);
      }));
    },
    onError: (error) => errors.push(error),
  };
  const host = createLoopModelSwitchResumeCoordinator(deps);
  return {
    task, deps, running, calls, errors, releases, host,
    resume: () => host.resume(task.id, () => { mains += 1; }),
    get mains() { return mains; },
    setController: (active: boolean, wait = Promise.resolve()) => { activeController = active; idle = wait; },
  };
}

test("classic model switch immediately resumes only stopped children and waits for live siblings", async () => {
  const env = harness();
  let releaseOwner = () => undefined as void;
  env.setController(true, new Promise<void>((resolve) => { releaseOwner = resolve; }));
  assert.equal(env.resume(), true);
  assert.deepEqual(env.calls, ["blocked"]);
  assert.equal(env.resume(), true);
  assert.equal(env.calls.length, 1);
  env.releases[0]("end");
  await nextTurn();
  assert.equal(env.mains, 0);
  env.running.delete("live");
  env.task.subTasks[1].status = "completed";
  env.task.activeSubtaskIds = [];
  env.setController(false);
  releaseOwner();
  await nextTurn();
  assert.equal(env.mains, 1);
  assert.deepEqual(env.errors, []);
});

test("stopped classic parent and child resume without a live controller", async () => {
  const env = harness();
  env.task.status = "stopped";
  env.task.activeSubtaskIds = [];
  env.task.subTasks = env.task.subTasks.filter((subtask) => subtask.id !== "live");
  env.running.clear();
  assert.equal(env.resume(), true);
  assert.equal(env.task.status, "running");
  assert.deepEqual(env.task.activeSubtaskIds, ["blocked"]);
  env.releases[0]("end");
  await nextTurn();
  assert.equal(env.mains, 1);
});

test("cold running children resume but completed and skipped children never restart", async () => {
  const env = harness();
  env.running.clear();
  env.resume();
  assert.deepEqual(env.calls, ["blocked", "live"]);
  env.releases.forEach((release) => release("end"));
  await nextTurn();
  assert.equal(env.mains, 1);
});

test("resumed classic children preserve existing write-conflict serialization", async () => {
  const env = harness();
  env.running.clear();
  env.task.subTasks[0].writeFiles = ["src/shared.ts"];
  env.task.subTasks[1].writeFiles = ["src/shared.ts"];
  env.resume();
  assert.deepEqual(env.calls, ["blocked"]);
  env.releases[0]("end");
  await nextTurn();
  assert.deepEqual(env.calls, ["blocked", "live"]);
  assert.equal(env.mains, 0);
  env.releases[1]("end");
  await nextTurn();
  assert.equal(env.mains, 1);
});

for (const status of ["stopped", "error"] as const) {
  test(`unsuccessful classic child ${status} does not wake its parent`, async () => {
    const env = harness();
    env.resume();
    env.releases[0](status);
    await nextTurn();
    assert.equal(env.mains, 0);
  });
}

test("a later user stop is preserved when resumed children settle", async () => {
  const env = harness();
  env.resume();
  env.task.status = "stopped";
  env.task.activeSubtaskIds = [];
  env.releases[0]("end");
  await nextTurn();
  assert.equal(env.mains, 0);
});

test("resume startup errors are reported and a later switch can retry", async () => {
  const env = harness();
  env.deps.runClassicSubtask = async () => { throw new Error("启动失败"); };
  env.resume();
  await nextTurn();
  env.resume();
  await nextTurn();
  assert.equal(env.errors.length, 2);
  assert.equal(env.mains, 0);
});

test("idle main requests parent continuation while active work and completed tasks do not", () => {
  const env = harness();
  env.task.subTasks = [];
  assert.equal(env.resume(), false);
  env.setController(true);
  assert.equal(env.resume(), true);
  env.setController(false);
  env.task.status = "completed";
  assert.equal(env.resume(), true);
  assert.deepEqual(env.calls, []);
});

test("Loop+ delegates live resume and requests reconstruction only for a cold controller", () => {
  const env = harness();
  env.task.schedulingMode = "event_driven";
  assert.equal(env.resume(), true);
  env.deps.resumeEventDrivenSubtasks = () => false;
  assert.equal(env.resume(), false);
  assert.deepEqual(env.calls, []);
});
