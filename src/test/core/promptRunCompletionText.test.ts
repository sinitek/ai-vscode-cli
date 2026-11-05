import test = require("node:test");
import assert = require("node:assert/strict");
import { buildTaskRunCompletionText } from "../../promptRunState";

const labels = {
  failed: "失败", stopped: "中断", completed: "任务已完成",
  failedWithDuration: (duration: string) => `失败 ${duration}`,
  stoppedWithDuration: (duration: string) => `中断 ${duration}`,
  completedWithDuration: (duration: string) => `任务已完成 ${duration}`,
  loopMain: "本轮调度已结束", loopMainWithDuration: (duration: string) => `本轮调度已结束 ${duration}`,
  loopSubtask: "执行结束，等待验收", loopSubtaskWithDuration: (duration: string) => `执行结束，等待验收 ${duration}`,
};

test("Loop+ main and subtask calls never report parent completion", () => {
  assert.equal(buildTaskRunCompletionText("end", 1000, labels, { loopPlus: true, taskRole: "main" }), "本轮调度已结束 00:01");
  assert.equal(buildTaskRunCompletionText("end", null, labels, { loopPlus: true, taskRole: "main" }), "本轮调度已结束");
  assert.equal(buildTaskRunCompletionText("end", 1000, labels, { loopPlus: true, taskRole: "subtask" }), "执行结束，等待验收 00:01");
  assert.equal(buildTaskRunCompletionText("end", Number.NaN, labels, { loopPlus: true, taskRole: "subtask" }), "执行结束，等待验收");
});

test("ordinary conversations, classic Loop and unsuccessful calls retain their original labels", () => {
  assert.equal(buildTaskRunCompletionText("end", 1000, labels), "任务已完成 00:01");
  assert.equal(buildTaskRunCompletionText("end", null, labels, { loopPlus: false, taskRole: "main" }), "任务已完成");
  assert.equal(buildTaskRunCompletionText("error", 1000, labels, { loopPlus: true, taskRole: "main" }), "失败 00:01");
  assert.equal(buildTaskRunCompletionText("stopped", null, labels, { loopPlus: true, taskRole: "subtask" }), "中断");
});
