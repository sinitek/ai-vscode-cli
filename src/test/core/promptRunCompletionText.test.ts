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
  loopSubtaskNoAcceptance: "执行结束，无需验收", loopSubtaskNoAcceptanceWithDuration: (duration: string) => `执行结束，无需验收 ${duration}`,
  loopSubtaskInterrupted: "任务中断，等待主任务重新派发。",
  loopSubtaskInterruptedWithDuration: (duration: string) => `任务中断，用时 ${duration}，等待主任务重新派发。`,
};

test("Loop+ main and subtask calls never report parent completion", () => {
  assert.equal(buildTaskRunCompletionText("end", 1000, labels, { loopPlus: true, taskRole: "main" }), "本轮调度已结束 00:01");
  assert.equal(buildTaskRunCompletionText("end", null, labels, { loopPlus: true, taskRole: "main" }), "本轮调度已结束");
  assert.equal(buildTaskRunCompletionText("end", 1000, labels, { loopPlus: true, taskRole: "subtask" }), "执行结束，等待验收 00:01");
  assert.equal(buildTaskRunCompletionText("end", Number.NaN, labels, { loopPlus: true, taskRole: "subtask" }), "执行结束，等待验收");
});

test("successful exempt Loop+ subtasks display no acceptance while unsuccessful calls retain their status", () => {
  const context = { loopPlus: true, taskRole: "subtask" as const, requiresAcceptance: false };
  assert.equal(buildTaskRunCompletionText("end", 1000, labels, context), "执行结束，无需验收 00:01");
  assert.equal(buildTaskRunCompletionText("end", null, labels, context), "执行结束，无需验收");
  assert.equal(buildTaskRunCompletionText("error", 1000, labels, context), "任务中断，用时 00:01，等待主任务重新派发。");
  assert.equal(buildTaskRunCompletionText("error", 1000, labels, { loopPlus: true, taskRole: "subtask" }), "任务中断，用时 00:01，等待主任务重新派发。");
  assert.equal(buildTaskRunCompletionText("stopped", null, labels, context), "中断");
  assert.equal(buildTaskRunCompletionText("end", null, labels, { ...context, loopPlus: false }), "任务已完成");
  assert.equal(buildTaskRunCompletionText("end", null, labels, { ...context, requiresAcceptance: true }), "执行结束，等待验收");
});

test("ordinary conversations, classic Loop and unsuccessful calls retain their original labels", () => {
  assert.equal(buildTaskRunCompletionText("end", 1000, labels), "任务已完成 00:01");
  assert.equal(buildTaskRunCompletionText("end", null, labels, { loopPlus: false, taskRole: "main" }), "任务已完成");
  assert.equal(buildTaskRunCompletionText("error", 1000, labels, { loopPlus: true, taskRole: "main" }), "失败 00:01");
  assert.equal(buildTaskRunCompletionText("stopped", null, labels, { loopPlus: true, taskRole: "subtask" }), "中断");
});
