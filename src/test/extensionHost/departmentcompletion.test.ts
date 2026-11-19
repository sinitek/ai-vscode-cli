import test = require("node:test");
import assert = require("node:assert/strict");
import { isDepartmentLeaderCompleted } from "../../loopPlusCompletion";
import { buildLoopPlusFinishEventId, createLoopPlusScheduler, type LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import type { LoopTaskRecord } from "../../loopTaskStore";

type CompletedTask = LoopTaskRecord & { loopPlus: LoopPlusSchedulerSnapshot };
function task(): CompletedTask {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
  scheduler.dispatch([{ subtaskId: "source", attemptId: "a1" }]);
  scheduler.finish({ subtaskId: "source", attemptId: "a1", outcome: "stopped" });
  scheduler.claimNextReview();
  scheduler.submitReviewBatch([buildLoopPlusFinishEventId("source", "a1")], "failed");
  scheduler.dispatch([{ subtaskId: "repair", attemptId: "a2" }]);
  scheduler.finish({ subtaskId: "repair", attemptId: "a2", outcome: "completed" });
  scheduler.claimNextReview();
  scheduler.submitReviewBatch([buildLoopPlusFinishEventId("repair", "a2")], "passed");
  scheduler.complete();
  return { status: "completed", completionRequirementCoverage: [{ name: "scope", passed: true }],
    subTasks: [{ id: "source", title: "source", status: "completed" },
      { id: "repair", title: "repair", status: "completed", repairSource: { subtaskId: "source", attemptId: "a1", finishEventId: buildLoopPlusFinishEventId("source", "a1") } }],
    loopPlus: scheduler.snapshot() } as CompletedTask;
}
test("department settlement accepts proven repair without erasing stopped history", () => {
  const value = task(); assert.equal(isDepartmentLeaderCompleted(value), true);
  assert.equal(value.loopPlus!.seenAttempts[0].acceptance, "failed");
  assert.equal(value.loopPlus!.seenAttempts[0].outcome, "stopped");
});
for (const [name, change] of Object.entries<(value: CompletedTask) => void>({
  "session reuse alone": (v) => { delete v.subTasks[1].repairSource; v.subTasks[1].continueFromSubtaskId = "source"; },
  "unknown source": (v) => { v.subTasks[1].repairSource!.subtaskId = "unknown"; },
  "wrong attempt": (v) => { v.subTasks[1].repairSource!.attemptId = "other"; },
  "wrong event": (v) => { v.subTasks[1].repairSource!.finishEventId = "forged"; },
  "source later fails": (v) => { v.loopPlus!.seenAttempts.push({ subtaskId: "source", attemptId: "a3", disposition: "reviewed", acceptance: "failed", outcome: "failed" }); },
  "repair failed": (v) => { v.loopPlus!.seenAttempts[1].acceptance = "failed"; },
  "repair stopped": (v) => { v.loopPlus!.seenAttempts[1].outcome = "stopped"; },
  "repair unreviewed": (v) => { v.loopPlus!.seenAttempts[1].disposition = "finished"; },
  "repair not complete": (v) => { v.subTasks[1].status = "running"; },
  "unrelated failure": (v) => { v.subTasks.push({ id: "extra", title: "extra", status: "completed" }); v.loopPlus!.seenAttempts.push({ subtaskId: "extra", attemptId: "a3", disposition: "reviewed", acceptance: "failed", outcome: "failed" }); },
  "cycle": (v) => { v.subTasks[0].repairSource = { subtaskId: "repair", attemptId: "a2", finishEventId: buildLoopPlusFinishEventId("repair", "a2") }; },
  "duplicate subtask": (v) => { v.subTasks.push(v.subTasks[1]); },
  "duplicate attempt": (v) => { v.loopPlus!.seenAttempts.push(v.loopPlus!.seenAttempts[1]); },
  "empty coverage": (v) => { v.completionRequirementCoverage = []; },
  "failed coverage": (v) => { v.completionRequirementCoverage[0].passed = false; },
  "queued message": (v) => { v.loopPlus!.userMessageQueue.push("new requirement"); },
  "pending clarification": (v) => { v.pendingClarification = {} as NonNullable<LoopTaskRecord["pendingClarification"]>; },
  "parent stopped": (v) => { v.loopPlus!.parentStopped = true; },
  "scheduler incomplete": (v) => { v.loopPlus!.completed = false; },
  "task incomplete": (v) => { v.status = "running"; },
})) test(`department settlement rejects ${name}`, () => { const value = task(); change(value); assert.equal(isDepartmentLeaderCompleted(value), false); });
test("department settlement preserves ordinary latest-attempt and no-failure completion", () => {
  const value = task(); value.loopPlus!.seenAttempts[0].acceptance = "passed"; value.loopPlus!.seenAttempts[0].outcome = "completed";
  delete value.subTasks[1].repairSource; assert.equal(isDepartmentLeaderCompleted(value), true);
  value.loopPlus!.seenAttempts.unshift({ subtaskId: "source", attemptId: "a0", disposition: "reviewed", acceptance: "failed", outcome: "failed" });
  assert.equal(isDepartmentLeaderCompleted(value), true);
});
test("department settlement resolves bounded multilevel repair and requires every split repair", () => {
  const value = task(); value.loopPlus!.seenAttempts[1].acceptance = "failed";
  value.subTasks.push({ id: "final", title: "final", status: "completed", repairSource: { subtaskId: "repair", attemptId: "a2", finishEventId: buildLoopPlusFinishEventId("repair", "a2") } });
  value.loopPlus!.seenAttempts.push({ subtaskId: "final", attemptId: "a3", disposition: "reviewed", outcome: "completed", acceptance: "passed" });
  assert.equal(isDepartmentLeaderCompleted(value), true);
  value.subTasks.push({ id: "split", title: "split", status: "completed", repairSource: value.subTasks[1].repairSource });
  value.loopPlus!.seenAttempts.push({ subtaskId: "split", attemptId: "a4", disposition: "reviewed", outcome: "failed", acceptance: "failed" });
  assert.equal(isDepartmentLeaderCompleted(value), false);
});

test("department settlement preserves no-failure direct work with explicit final coverage", () => {
  const value = task(); value.subTasks = []; value.loopPlus.seenAttempts = [];
  assert.equal(isDepartmentLeaderCompleted(value), true);
  value.completionRequirementCoverage = [];
  assert.equal(isDepartmentLeaderCompleted(value), false);
});
