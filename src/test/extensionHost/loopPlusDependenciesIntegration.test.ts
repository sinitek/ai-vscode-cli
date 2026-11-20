import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
import type { LoopSubtaskDecision } from "../../loopTaskStore";

installVscodeMock();
const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const { createLoopPlusScheduler } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");

function child(id: string, dependsOn: string[] = []): LoopSubtaskDecision {
  return { id, title: id, taskType: "backend", dependsOn, writeFiles: [`src/${id}.ts`],
    prompt: `Implement ${id} against the agreed contract in src/${id}.ts. Preserve concurrent changes and record the focused test command, result and uncovered cases in this attempt report.` };
}

function json(value: unknown): string {
  return JSON.stringify(withLoopPlusAcceptReviews(value));
}

const input = { displayPrompt: "交付显式依赖任务", modelPrompt: "交付显式依赖任务", contextTags: [], loopSubtaskMode: "fullstack" as const };

test("runtime adapter persists dependencies and starts a successor while prerequisite acceptance is held", { timeout: 4000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain((request, tabId) => fixture.publish(request, tabId, { status: "end", content: json({
      status: "dispatch", subtasks: [child("dependent", ["source"]), child("source")],
    }) }));
    fixture.queueMain(async (request, tabId) => {
      const reviewEventId = createLoopPlusScheduler({ snapshot: fixture.readTask(request.loopTaskId!)!.loopPlus }).snapshot().currentReview!.eventId;
      await fixture.holdMain();
      fixture.publish(request, tabId, { status: "end", content: json({ status: "accept", reviewEventId, progressPercent: 40, subtasks: [] }) });
    });
    const running = fixture.adapter.runEventDriven(input, { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("source"), "source starts");
    const taskId = fixture.mainCalls[0].loopTaskId!;
    assert.deepEqual(fixture.parkedSubtaskIds(), ["source"]);
    assert.deepEqual(fixture.readTask(taskId)!.subTasks.find((item) => item.id === "dependent")!.dependsOn, ["source"]);
    fixture.finishParked("source", { status: "end", content: "source evidence" });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "source review held");
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("dependent"), "successor starts before acceptance");
    const snapshot = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot();
    assert.equal(snapshot.currentReview?.subtaskId, "source");
    assert.deepEqual(snapshot.running.find((item) => item.subtaskId === "dependent")!.dependsOn, ["source"]);
    assert.deepEqual(snapshot.seenAttempts.find((item) => item.subtaskId === "dependent")!.dependsOn, ["source"]);
    assert.match(fixture.attemptCalls[1].modelPrompt!, /dependsOn.*source/);
    fixture.queueMain((request, tabId) => {
      const reviewEventId = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot().currentReview!.eventId;
      fixture.publish(request, tabId, { status: "end", content: json({ status: "completed", reviewEventId,
        answerConclusion: "交付完成", finalSummary: "依赖与后继均通过", acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
        requirementCoverage: [{ name: "explicit dependencies", passed: true }],
      }) });
    });
    fixture.finishParked("dependent", { status: "end", content: "dependent evidence" });
    fixture.releaseHeldMain();
    await running;
    assert.equal(fixture.readTask(taskId)!.status, "completed");
    assert.equal(fixture.attemptCalls.length, 2);
  } finally {
    fixture.releaseHeldMain();
    fixture.dispose();
  }
});
