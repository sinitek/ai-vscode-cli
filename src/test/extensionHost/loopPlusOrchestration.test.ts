import { withLoopBlockerFixture, loopBlockerFixture } from "../loopBlockerFixture";
import { buildLoopBlockerSummary } from "../../loopBlocker";
import test = require("node:test");
import assert = require("node:assert/strict");
import { createLoopMainQuestionQueue } from "../../loopMainQuestionQueue";
import { setTimeout as delay } from "node:timers/promises";

import {
  createLoopPlusOrchestrationHost,
  resolveLoopPlusEntry,
  type LoopPlusAttemptRequest,
  type LoopPlusAttemptResult,
  type LoopPlusMainHandle,
  type LoopPlusMainRequest,
  type LoopPlusOrchestrationDeps,
  type LoopPlusPromptTarget,
  type LoopPlusRunResult,
} from "../../extensionHost/loopPlusOrchestration";
import { summarizeLoopPlusProtocolRejection } from "../../extensionHost/loopPlusDiagnostics";
import type { LoopPlusSubtaskChatNotice } from "../../extensionHost/loopPlusSubtaskChat";
import { buildLoopPlusFinishEventId, createLoopPlusScheduler, type LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import { normalizeLoopTaskRecord, type LoopSubtaskDecision, type LoopTaskRecord } from "../../loopTaskStore";
import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
import { loopSubtaskAutoCompactions, scheduleAutoCompactAfterPrompt } from "../../loopSubtaskAutoCompact";
import { startLoopWaitWatchdog } from "../../loopWaitWatchdog";
import { createRunStatusHarness } from "../webview/tabRunStatusHarness";
import {
  loopClarificationScope,
  LOOP_RECOVERY_PLAN_FIELD,
  submitOrchestratorClarification,
  rejectOrchestratorClarification,
  waitForOrchestratorClarification,
} from "../../orchestratorClarification";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

type MainCall = {
  request: LoopPlusMainRequest;
  invocationPrompt: string;
  invocationModelPrompt: string;
  resolve: (value: string | null) => void;
  releaseAbort: (value?: string | null) => void;
  reject: (error: Error) => void;
  abortCount: number;
};

type AttemptReport = {
  subtaskId: string;
  attemptId: string;
  outcome: string;
  detail: string | null;
};

type AttemptCall = {
  request: LoopPlusAttemptRequest;
  resolve: (value: LoopPlusAttemptResult) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function longPrompt(title: string, files: readonly string[]): string {
  return `Implement ${title} without editing the parent task record or scheduler snapshot. Write scope: ${files.join(", ")}. Report only the attempt result.`;
}

function subtask(id: string, files: string[], conflictGroup?: string): LoopSubtaskDecision {
  return {
    id,
    title: id,
    prompt: longPrompt(id, files),
    writeFiles: files,
    ...(conflictGroup ? { conflictGroup } : {}),
  };
}

function decisionJson(value: unknown): string {
  const enriched = withLoopPlusAcceptReviews(withLoopBlockerFixture(value));
  if (enriched && typeof enriched === "object" && !Array.isArray(enriched)
    && (enriched as { status?: unknown }).status === "accept"
    && !Object.prototype.hasOwnProperty.call(enriched, "progressPercent")) {
    return JSON.stringify({ ...enriched, progressPercent: 23 });
  }
  return JSON.stringify(enriched);
}

function acceptWithIndependentWork(reviewEventIds: readonly string[], subtasks: LoopSubtaskDecision[]): string {
  return decisionJson({
    status: "accept", reviewEventIds,
    reviews: reviewEventIds.map((reviewEventId) => ({ reviewEventId, acceptance: "passed" })),
    independentSubtaskIds: subtasks.map((item) => item.id), subtasks,
  });
}

function completedDecision(extra: Record<string, unknown> = {}): string {
  return decisionJson({
    status: "completed",
    answerConclusion: "finished",
    finalSummary: "everything passed",
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    requirementCoverage: [{ name: "scope", passed: true }],
    ...extra,
  });
}

function directCompletionDecision(): string {
  return decisionJson({
    status: "completed", directCompletion: true,
    answerConclusion: "已处理简单事项", finalSummary: "直接处理完成，未新增子任务或验收。",
  });
}

test("trivial work completes in one main call without subtasks or acceptance feedback", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "处理一个明确、低风险的简单事项" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.match(env.mains[0].request.prompt, /Direct completion available: yes/);
  env.mains[0].resolve(directCompletionDecision());
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.equal(env.tasks.get(run.taskId ?? "")?.answerConclusion, "已处理简单事项");
  assert.equal(env.attempts.length, 0);
  assert.equal(env.mains.length, 1);
  assert.equal(env.acceptanceFeedback.length, 0);
});

test("an acceptance can return a next-step plan that launches a separate main decision", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "先完成首项交付，再按验收结果继续" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("first", ["src/first.ts"])] }));
  await flush();

  const firstAttemptId = env.attempts[0].request.attemptId;
  env.attempts[0].resolve({ outcome: "completed", detail: "首项实现完成" });
  await flush();
  const firstReviewId = buildLoopPlusFinishEventId("first", firstAttemptId);
  env.mains[1].resolve(decisionJson({
    status: "accept",
    reviewEventId: firstReviewId,
    subtasks: [],
    nextStepPlan: { objective: "根据首项验收结果推进后续交付", acceptanceCriteria: ["不重复已完成工作"] },
  }));
  await flush();

  assert.equal(env.mains.length, 3);
  assert.match(env.mains[2].request.prompt, /Objective: 根据首项验收结果推进后续交付/);
  assert.deepEqual(env.tasks.get(taskId)?.loopPlusNextStepPlan, {
    objective: "根据首项验收结果推进后续交付",
    acceptanceCriteria: ["不重复已完成工作"],
  });
  env.mains[2].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("second", ["src/second.ts"])],
    nextStepPlan: { objective: "验收后核对整体交付" },
  }));
  await flush();
  assert.deepEqual(env.tasks.get(taskId)?.loopPlusNextStepPlan, { objective: "验收后核对整体交付" });

  const secondAttemptId = env.attempts[1].request.attemptId;
  env.attempts[1].resolve({ outcome: "completed", detail: "后续交付完成" });
  await flush();
  assert.match(env.mains[3].request.prompt, /Objective: 验收后核对整体交付/);
  env.mains[3].resolve(completedDecision({
    reviewEventId: buildLoopPlusFinishEventId("second", secondAttemptId),
  }));
  await flush();
  await run.done;
  assert.equal(env.tasks.get(taskId)?.status, "completed");
  assert.equal(env.tasks.get(taskId)?.loopPlusNextStepPlan, undefined);
});

test("dispatches independent work once before reviewing the unchanged frozen batch", async () => {
  const env = harness({ maxConcurrency: 1 });
  const run = env.host.tryRun({ displayPrompt: "先派发独立交付再验收" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("first", ["src/first.ts"])] }));
  await flush();
  const firstAttemptId = env.attempts[0].request.attemptId;
  env.attempts[0].resolve({ outcome: "completed", detail: "首项交付已完成" });
  await flush();

  const frozenEventId = buildLoopPlusFinishEventId("first", firstAttemptId);
  const dispatchFirst = env.mains[1];
  assert.deepEqual(dispatchFirst.request.reviewEventIds, [frozenEventId]);
  assert.match(dispatchFirst.request.prompt, /One-time dispatch-first check/);
  dispatchFirst.resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("independent", ["src/independent.ts"])],
    nextStepPlan: { objective: "检查并验收首项冻结批次" },
  }));
  await flush();

  assert.equal(env.attempts.length, 2);
  assert.equal(env.attempts[1].request.subtaskId, "independent");
  assert.deepEqual(env.tasks.get(taskId)?.loopPlusNextStepPlan, { objective: "检查并验收首项冻结批次" });
  const review = env.mains[2];
  assert.deepEqual(review.request.reviewEventIds, [frozenEventId]);
  assert.match(review.request.prompt, /Objective: 检查并验收首项冻结批次/);
  assert.doesNotMatch(review.request.prompt, /One-time dispatch-first check/);
  review.resolve(decisionJson({ status: "accept", reviewEventId: frozenEventId, subtasks: [] }));
  await flush();
  assert.equal(env.tasks.get(taskId)?.loopPlusNextStepPlan, undefined);
  assert.equal(env.tasks.get(taskId)?.status, "running");

  const independentAttemptId = env.attempts[1].request.attemptId;
  env.attempts[1].resolve({ outcome: "completed", detail: "独立交付已完成" });
  await flush();
  env.mains[3].resolve(completedDecision({
    reviewEventId: buildLoopPlusFinishEventId("independent", independentAttemptId),
  }));
  await run.done;
  assert.equal(env.tasks.get(taskId)?.status, "completed");
});

test("protocol miss logs the host dispatch window, not the presence of an acceptance item", async (context) => {
  const env = protocolHarness(context, { maxConcurrency: 1 });
  const run = env.host.tryRun({ displayPrompt: "先派发再验收" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("source", ["src/source.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "完成" });
  await flush();
  const review = env.mains[1];
  const eventId = review.request.reviewEventId!;
  review.resolve(decisionJson({ status: "dispatch", subtasks: [subtask("independent", ["src/independent.ts"]) ] }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.acceptanceFeedback.length, 0);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.eventId, eventId);
  assert.equal((env.logs.find((item) => item.event === "loop-plus-protocol-miss")?.payload as { dispatchWindow?: string }).dispatchWindow, "open");
  const retry = env.mains[2];
  assert.deepEqual(retry.request.reviewEventIds, [eventId]);
  assert.doesNotMatch(retry.request.prompt, /One-time dispatch-first check/);
  retry.resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("independent", ["src/independent.ts"])],
    nextStepPlan: { objective: "验收保留的批次" },
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).pending, []);
  assert.deepEqual(env.logs.filter((item) => item.event === "loop-plus-protocol-miss")
    .map((item) => (item.payload as { dispatchWindow: string }).dispatchWindow), ["open", "closed"]);
  assert.deepEqual(env.mains[3].request.reviewEventIds, [eventId]);
  assert.match(env.mains[3].request.prompt, /state\.review_batch_open\.dispatch_forbidden/);
  env.mains[3].resolve(decisionJson({ status: "accept", reviewEventId: eventId,
    reviews: [{ reviewEventId: eventId, acceptance: "passed" }], subtasks: [],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.acceptanceFeedback.length, 1);
  env.host.stopParent(run.taskId ?? "");
  await run.done;
});

test("does not dispatch a successor that depends on the frozen review result", async () => {
  const env = harness({ maxConcurrency: 1 });
  const run = env.host.tryRun({ displayPrompt: "验收前不能派发依赖任务" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("prerequisite", ["src/prerequisite.ts"])] }));
  await flush();
  const prerequisite = env.attempts[0];
  prerequisite.resolve({ outcome: "completed", detail: "前置交付已完成，等待验收" });
  await flush();
  const frozenEventId = buildLoopPlusFinishEventId("prerequisite", prerequisite.request.attemptId);
  env.mains[1].resolve(decisionJson({
    status: "dispatch",
    subtasks: [dependentSubtask("successor", ["prerequisite"])],
    nextStepPlan: { objective: "之后再处理依赖交付" },
  }));
  await flush();

  assert.equal(env.attempts.length, 1);
  assert.equal(env.tasks.get(run.taskId ?? "")?.loopPlusNextStepPlan, undefined);
  assert.deepEqual(env.mains[2].request.reviewEventIds, [frozenEventId]);
  assert.doesNotMatch(env.mains[2].request.prompt, /One-time dispatch-first check/);
  env.host.stopParent(run.taskId ?? "");
  await run.done;
});

test("invalid main responses and explicit host recovery retain the pending next-step plan", async (context) => {
  const env = protocolHarness(context);
  const task = baseTask("next-plan-recovery", createLoopPlusScheduler({ maxConcurrency: 2 }).snapshot());
  task.loopPlusNextStepPlan = { objective: "完成尚未处理的后续交付" };
  env.tasks.set(task.id, task);
  const run = env.reloadHost().tryRun({ displayPrompt: "继续" }, env.target, {
    resumeTaskId: task.id,
    resumeRequested: true,
  });
  const resumeIndex = await exhaustProtocolBudget(env, run, 0, (main) => {
    assert.match(main.request.prompt, /Objective: 完成尚未处理的后续交付/);
    return decisionJson({ status: "unknown" });
  });
  assert.deepEqual(env.tasks.get(task.id)?.loopPlusNextStepPlan, task.loopPlusNextStepPlan);

  const resumedHost = env.reloadHost();
  const resumed = resumedHost.tryRun({ displayPrompt: "恢复" }, env.target, {
    resumeTaskId: task.id,
    resumeRequested: true,
  });
  await flush();
  assert.match(env.mains[resumeIndex].request.prompt, /Objective: 完成尚未处理的后续交付/);
  resumedHost.stopParent(task.id);
  await resumed.done;
  assert.equal(env.tasks.get(task.id)?.status, "stopped");
  assert.equal(env.tasks.get(task.id)?.loopPlusNextStepPlan, undefined);
});

test("clarification preserves a pending plan for the post-answer main request", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "完成主任务" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("clarify-source", ["src/source.ts"])],
    nextStepPlan: { objective: "澄清后按确认范围完成剩余工作" },
  }));
  await flush();
  const attemptId = env.attempts[0].request.attemptId;
  env.attempts[0].resolve({ outcome: "completed", detail: "等待主任务确认范围" });
  await flush();
  const review = env.mains[1];
  assert.match(review.request.prompt, /Objective: 澄清后按确认范围完成剩余工作/);
  review.resolve(clarificationDecision());
  await flush();
  const waiting = env.tasks.get(taskId);
  assert.deepEqual(waiting?.loopPlusNextStepPlan, { objective: "澄清后按确认范围完成剩余工作" });
  assert.equal(submitOrchestratorClarification(
    loopClarificationScope(taskId),
    waiting?.pendingClarification?.interactionId ?? "",
    { scope: "api" },
  ).ok, true);
  await flush();
  assert.match(env.mains[2].request.prompt, /Objective: 澄清后按确认范围完成剩余工作/);
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).currentReview?.eventId, buildLoopPlusFinishEventId("clarify-source", attemptId));
  env.host.stopParent(taskId);
  await run.done;
});

test("no-acceptance completion wakes the main task to read its report and continue dispatching", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "汇总验证结果并完成交付" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [{ ...subtask("report-a", []), requiresAcceptance: false }],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  const firstAttemptId = env.attempts[0].request.attemptId;

  env.attempts[0].resolve({ outcome: "completed", detail: "npm test 通过；未覆盖真实宿主集成" });
  await flush();
  const reportDecision = env.mains[1];
  const firstReportId = buildLoopPlusFinishEventId("report-a", firstAttemptId);
  assert.equal(reportDecision.request.kind, "continue");
  assert.deepEqual(reportDecision.request.reportEventIds, [firstReportId]);
  assert.match(reportDecision.request.prompt, /npm test 通过；未覆盖真实宿主集成/);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).reportQueue?.length, 1);

  env.mains[1].resolve(decisionJson({
    status: "dispatch",
    reportEventIds: [firstReportId],
    subtasks: [{ ...subtask("report-b", []), requiresAcceptance: false }],
  }));
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).reportQueue?.length ?? 0, 0);
  assert.equal(env.attempts.length, 2);
  const secondAttemptId = env.attempts[1].request.attemptId;

  env.attempts[1].resolve({ outcome: "completed", detail: "报告生成完成" });
  await flush();
  const secondReportId = buildLoopPlusFinishEventId("report-b", secondAttemptId);
  assert.deepEqual(env.mains[2].request.reportEventIds, [secondReportId]);
  env.mains[2].resolve(completedDecision({ reportEventIds: [secondReportId] }));
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts.every((item) => item.disposition === "reported"), true);
  const { isDepartmentLeaderCompleted } = require("../../loopPlusCompletion") as typeof import("../../loopPlusCompletion");
  assert.equal(isDepartmentLeaderCompleted(env.tasks.get(run.taskId!)!), true);
  assert.equal(env.acceptanceFeedback.length, 0);
});

test("keeps reports arriving during a frozen acceptance for the next main decision", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "完成实现并读取独立验证报告" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [
      subtask("reviewed-delivery", ["src/delivery.ts"]),
      { ...subtask("late-report", []), requiresAcceptance: false },
    ],
  }));
  await flush();
  const reviewedAttemptId = env.attempts[0].request.attemptId;
  const reportAttemptId = env.attempts[1].request.attemptId;
  env.attempts[0].resolve({ outcome: "completed", detail: "实现交付完成" });
  await flush();
  const review = env.mains[1];
  assert.equal(review.request.kind, "review");
  assert.deepEqual(review.request.reportEventIds, []);

  env.attempts[1].resolve({ outcome: "completed", detail: "late report evidence" });
  await flush();
  assert.doesNotMatch(review.request.prompt, /late report evidence/);
  review.resolve(decisionJson({
    status: "accept",
    reviewEventId: buildLoopPlusFinishEventId("reviewed-delivery", reviewedAttemptId),
    subtasks: [],
  }));
  await flush();

  const report = env.mains[2];
  const reportEventId = buildLoopPlusFinishEventId("late-report", reportAttemptId);
  assert.equal(report.request.kind, "continue");
  assert.deepEqual(report.request.reportEventIds, [reportEventId]);
  assert.match(report.request.prompt, /late report evidence/);
  report.resolve(completedDecision({ reportEventIds: [reportEventId] }));
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  await run.done;
});

test("report continuation consumes visible user messages and preserves late reports and messages", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "汇总两个报告" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    { ...subtask("report-a", []), requiresAcceptance: false },
    { ...subtask("report-b", []), requiresAcceptance: false },
  ] }));
  await flush();
  env.host.submitUserMessage(taskId, "先检查报告范围");
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "报告 A" });
  env.host.submitUserMessage(taskId, "随后汇总报告");
  await flush();
  env.mains[1].resolve(decisionJson({ status: "wait" }));
  await flush();
  const firstReport = env.mains[2];
  const firstId = buildLoopPlusFinishEventId("report-a", env.attempts[0].request.attemptId);
  assert.equal(firstReport.request.kind, "continue");
  assert.equal(firstReport.request.userMessageCount, 1);
  assert.deepEqual(firstReport.request.reportEventIds, [firstId]);
  assert.match(firstReport.request.prompt, /随后汇总报告/);
  env.host.submitUserMessage(taskId, "补充最终说明");
  env.attempts[1].resolve({ outcome: "completed", detail: "报告 B" });
  await flush();
  firstReport.resolve(completedDecision({ reportEventIds: [firstId] }));
  await flush();
  const secondReport = env.mains[3];
  const secondId = buildLoopPlusFinishEventId("report-b", env.attempts[1].request.attemptId);
  assert.equal(env.tasks.get(taskId)?.status, "running");
  assert.equal(secondReport.request.kind, "continue");
  assert.equal(secondReport.request.userMessageCount, 1);
  assert.deepEqual(secondReport.request.reportEventIds, [secondId]);
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).userMessageQueue, ["补充最终说明"]);
  secondReport.resolve(completedDecision({ reportEventIds: [secondId] }));
  await flush();
  await run.done;
  assert.equal(env.tasks.get(taskId)?.status, "completed");
  assert.equal(env.mains.length, 4);
  assert.equal(env.acceptanceFeedback.length, 0);
});

test("reprompt decides acceptance for the new attempt instead of inheriting the old exemption", async () => {
  for (const requiresAcceptance of [undefined, false, true]) {
    const env = harness();
    const run = env.host.tryRun({ displayPrompt: "先调查再调整工作" }, env.target, { schedulingMode: "event_driven" });
    const taskId = run.taskId ?? "";
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
      { ...subtask("redirected", []), requiresAcceptance: false },
    ] }));
    await flush();
    env.host.submitUserMessage(taskId, "重新安排此任务");
    await flush();
    env.mains[1].resolve(decisionJson({ status: "steer", controls: [{
      id: "redirected", action: "reprompt", title: "调整后任务", prompt: longPrompt("adjusted", []),
      ...(requiresAcceptance !== undefined ? { requiresAcceptance } : {}),
    }] }));
    await flush();
    assert.equal(env.attempts.length, 2);
    const snapshot = snapshotOf(env.tasks.get(taskId));
    assert.equal(snapshot.running[0]?.requiresAcceptance, requiresAcceptance);
    assert.equal(env.tasks.get(taskId)?.subTasks[0]?.requiresAcceptance, requiresAcceptance);
    env.attempts[1].resolve({ outcome: "completed", detail: "新 attempt 结果" });
    await flush();
    assert.equal(env.mains[2].request.kind, requiresAcceptance === false ? "continue" : "review");
    env.host.stopParent(taskId);
    await flush();
    await run.done;
  }
});

test("restores a pending no-acceptance report and wakes the resumed main task", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([{ subtaskId: "restored-report", attemptId: "restored-report-1", requiresAcceptance: false }]);
  scheduler.finish({
    subtaskId: "restored-report",
    attemptId: "restored-report-1",
    outcome: "completed",
    detail: "恢复后仍需读取的报告",
  });
  const task = baseTask("restored-report-task", scheduler.snapshot());
  task.subTasks = [{
    id: "restored-report",
    title: "恢复报告",
    prompt: longPrompt("恢复报告", []),
    status: "completed",
    requiresAcceptance: false,
    summary: "恢复后仍需读取的报告",
  }];
  env.tasks.set(task.id, task);

  const cold = env.reloadHost();
  const run = cold.tryRun({ displayPrompt: "继续处理" }, env.target, {
    resumeTaskId: task.id,
    resumeRequested: true,
  });
  await flush();
  const reportId = buildLoopPlusFinishEventId("restored-report", "restored-report-1");
  assert.equal(env.mains[0].request.kind, "continue");
  assert.deepEqual(env.mains[0].request.reportEventIds, [reportId]);
  assert.match(env.mains[0].request.prompt, /恢复后仍需读取的报告/);
  env.mains[0].resolve(completedDecision({ reportEventIds: [reportId] }));
  await flush();
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  await run.done;
  assert.equal(snapshotOf(env.tasks.get(task.id)).seenAttempts[0]?.disposition, "reported");
});

test("blocked review consumes reports once while preserving the held acceptance batch", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([
    { subtaskId: "delivery", attemptId: "delivery-1" },
    { subtaskId: "report", attemptId: "report-1", requiresAcceptance: false },
  ]);
  scheduler.finish({ subtaskId: "report", attemptId: "report-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "delivery", attemptId: "delivery-1", outcome: "completed" });
  const task = baseTask("blocked-report-task", scheduler.snapshot());
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: "继续" }, env.target, { resumeTaskId: task.id, resumeRequested: true });
  await flush();
  const reportId = buildLoopPlusFinishEventId("report", "report-1");
  assert.deepEqual(env.mains[0].request.reportEventIds, [reportId]);
  env.host.submitUserMessage(task.id, "补充可继续推进的要求");
  env.mains[0].resolve(decisionJson({ status: "blocked", finalSummary: "需要更多信息", reportEventIds: [reportId] }));
  await flush();
  const continuedReview = env.mains[1];
  assert.equal(continuedReview.request.kind, "review");
  assert.deepEqual(continuedReview.request.reportEventIds, []);
  assert.equal(continuedReview.request.userMessageCount, 1);
  assert.deepEqual(continuedReview.request.reviewEventIds, [buildLoopPlusFinishEventId("delivery", "delivery-1")]);
  continuedReview.resolve(completedDecision({ reviewEventIds: continuedReview.request.reviewEventIds }));
  await flush();
  await run.done;
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  assert.equal(snapshotOf(env.tasks.get(task.id)).seenAttempts.find((attempt) => attempt.subtaskId === "report")?.disposition, "reported");
  assert.equal(env.logs.some((item) => item.event === "loop-plus-protocol-miss"), false);
});

test("simple supplemental work is handled during live work and after earlier acceptance", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "实现功能" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("feature", ["src/feature.ts"])] }));
  await flush();
  env.host.submitUserMessage(run.taskId ?? "", "顺便处理一个不冲突的简单事项");
  await flush();
  const supplemental = env.mains[1];
  assert.equal(supplemental.request.kind, "user");
  assert.match(supplemental.request.prompt, /Direct completion available: no/);
  assert.match(supplemental.request.prompt, /directly handle eligible independent trivial work first/);
  supplemental.resolve(decisionJson({ status: "wait" }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).userMessageQueue, []);
  env.attempts[0].resolve({ outcome: "completed", detail: "功能完成" });
  await flush();
  const review = env.mains[2];
  assert.match(review.request.prompt, /Direct completion available: no/);
  review.resolve(decisionJson({ status: "accept", reviewEventIds: review.request.reviewEventIds, subtasks: [] }));
  await flush();
  const closeout = env.mains[3];
  assert.match(closeout.request.prompt, /Direct completion available: yes/);
  env.host.submitUserMessage(run.taskId ?? "", "再处理一项简单补充需求");
  closeout.resolve(directCompletionDecision());
  await flush();
  const followup = env.mains[4];
  assert.match(followup.request.prompt, /再处理一项简单补充需求/);
  assert.match(followup.request.prompt, /Direct completion available: yes/);
  followup.resolve(directCompletionDecision());
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.equal(env.attempts.length, 1);
  assert.equal(env.acceptanceFeedback.length, 1);
});

test("a failed supplemental persistence closes launching without starting the pending successor", async () => {
  let failNextUpdate = false;
  const env = harness({
    maxConcurrency: 1,
    beforeUpdateTask: () => {
      if (failNextUpdate) {
        failNextUpdate = false;
        throw new Error("supplement persistence failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "先完成首项交付" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    subtask("first", ["src/first.ts"]),
    subtask("successor", ["src/successor.ts"]),
  ] }));
  await flush();
  assert.equal(env.attempts.length, 1);

  failNextUpdate = true;
  assert.throws(() => env.host.submitUserMessage(run.taskId!, "补充需求写入失败"), /supplement persistence failed/);
  env.attempts[0].resolve({ outcome: "completed", detail: "首项交付完成" });
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId!)).pending.map((item) => item.subtaskId), ["successor"]);
  env.host.stopParent(run.taskId!);
  await run.done;
});

test("a stopped task with a failed resume supplement stays stopped and can retry atomically", async () => {
  let failNextUpdate = false;
  const env = harness({
    beforeUpdateTask: () => {
      if (failNextUpdate) {
        failNextUpdate = false;
        throw new Error("resume supplement persistence failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "等待继续" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.host.stopParent(run.taskId!);
  await flush();
  const mainCount = env.mains.length;
  failNextUpdate = true;
  env.host.tryRun({ displayPrompt: "继续" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
    resumeUserMessage: "原子续跑补充",
    schedulingMode: "event_driven",
  });
  await flush();
  assert.equal(env.mains.length, mainCount);
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).parentStopped, true);

  const retried = env.host.tryRun({ displayPrompt: "继续" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
    resumeUserMessage: "原子续跑补充",
    schedulingMode: "event_driven",
  });
  await flush();
  assert.equal(env.mains.length, mainCount + 1);
  assert.equal(env.mains[mainCount].request.userMessageCount, 1);
  assert.match(env.mains[mainCount].request.prompt, /原子续跑补充/);
  env.mains[mainCount].resolve(decisionJson({ status: "blocked", finalSummary: "等待后续" }));
  await flush();
  env.host.stopParent(run.taskId!);
  await retried.done;
});

test("stopping Loop+ aborts live requests before persisting the stopped state", async () => {
  const events: string[] = [];
  const main = deferred<string | null>();
  const env = harness({
    beforeUpdateTask: (patch) => {
      if (patch.status === "stopped") events.push("persist-stopped");
    },
    adaptMain: () => ({
      promise: main.promise,
      abort: () => {
        events.push("abort-main");
        main.resolve(null);
      },
    }),
  });
  const run = env.host.tryRun({ displayPrompt: "实现并检查改动" }, env.target, { schedulingMode: "event_driven" });
  await flush();

  env.host.stopParent(run.taskId ?? "");

  assert.deepEqual(events.slice(0, 2), ["abort-main", "persist-stopped"]);
  await run.done;
});

test("Loop+ answers a queued question between consecutive acceptance batches", async () => {
  const queue = createLoopMainQuestionQueue();
  const calls: string[] = [];
  const firstReview = deferred<void>();
  const answer = deferred<void>();
  const env = harness({
    adaptMain: (request) => ({
      promise: queue.runMain(request.target.tabId, async () => {
        if (request.kind === "initial") {
          calls.push("initial");
          return decisionJson({ status: "dispatch", subtasks: [
            subtask("first", ["src/first.ts"]), subtask("second", ["src/second.ts"]),
          ] });
        }
        if (request.kind === "review") {
          const isFirst = !calls.includes("review-1");
          calls.push(isFirst ? "review-1" : "review-2");
          assert.equal(request.reviewEventIds?.length, 1);
          if (isFirst) {
            await firstReview.promise;
            return decisionJson({ status: "accept", reviewEventIds: request.reviewEventIds, subtasks: [] });
          }
          return completedDecision({ reviewEventIds: request.reviewEventIds });
        }
        throw new Error(`Unexpected main request: ${request.kind}`);
      }),
      abort: () => undefined,
    }),
  });
  const run = env.host.tryRun({ displayPrompt: "实现功能" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "第一批待验收" });
  await flush();
  assert.deepEqual(calls, ["initial", "review-1"]);
  const question = queue.runQuestion(env.target.tabId, { canRun: () => true }, async () => {
    calls.push("answer");
    await answer.promise;
  });
  env.attempts[1].resolve({ outcome: "completed", detail: "下一批待验收" });
  await flush();
  assert.deepEqual(calls, ["initial", "review-1"]);
  firstReview.resolve();
  await flush();
  assert.deepEqual(calls, ["initial", "review-1", "answer"]);
  answer.resolve();
  await Promise.all([question, run.done]);
  assert.deepEqual(calls, ["initial", "review-1", "answer", "review-2"]);
  assert.equal(env.tasks.get(taskId)?.status, "completed");
});

test("direct completion cannot bypass open work, review events or selected reviews", async () => {
  for (const stage of ["running", "pending", "review", "plan"] as const) {
    const env = harness({ maxConcurrency: 1 });
    const run = env.host.tryRun({
      displayPrompt: "处理工作",
      ...(stage === "plan" ? { loopPlusAcceptancePlan: { id: "security", name: "安全审查", checks: ["security"] as const, otherText: "", systemDefault: false } } : {}),
    }, env.target, { schedulingMode: "event_driven" });
    await flush();
    if (stage !== "plan") {
      env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: stage === "pending"
        ? [subtask("first", ["first.ts"]), subtask("second", ["second.ts"])]
        : [subtask("first", ["first.ts"])] }));
      await flush();
      if (stage === "review") {
        env.attempts[0].resolve({ outcome: "completed", detail: "待验收" });
      } else {
        env.host.submitUserMessage(run.taskId ?? "", "处理一个简单补充事项");
      }
      await flush();
    }
    const current = env.mains[env.mains.length - 1];
    assert.match(current.request.prompt, /Direct completion available: no/);
    current.resolve(directCompletionDecision());
    await flush();
    assert.notEqual(env.tasks.get(run.taskId ?? "")?.status, "completed");
    assert.equal(env.acceptanceFeedback.length, 0);
    assert.equal(env.messages.includes("loop-plus-completed"), false);
    env.host.stopParent(run.taskId ?? "");
    await run.done;
  }
});

test("a proposed global block receives one bounded review and can dispatch independent work", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "blocked", finalSummary: "SDK recovery needs external evidence" }));
  await flush();
  const current = () => env.tasks.get(run.taskId ?? "");
  assert.equal(current()?.status, "running");
  assert.equal(current()?.loopPlusBlockReview?.state, "pending");
  assert.equal(await isSettled(run.done), false);
  assert.match(env.mains[1].request.prompt, /Bounded blocked review/);
  assert.match(env.mains[1].request.prompt, /SDK recovery needs external evidence/);
  assert.match(env.mains[1].request.prompt, /every unfinished root and supplemental requirement/);
  env.mains[1].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("launcher", ["start.py"])] }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0].request.subtaskId, "launcher");
  assert.equal(current()?.loopPlusBlockReview, undefined);
  assert.equal(env.messages.includes("loop-plus-blocked"), false);
  env.host.stopParent(run.taskId ?? "");
});

test("the main model confirms a stalled repair and pauses once without accepting the failed attempt", async () => {
  const pauses: Array<{ task: LoopTaskRecord; message: string }> = [];
  const env = harness({ recordPause: (task, message) => { pauses.push({ task, message }); } });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId!;
  const repair = subtask("page-test", ["page.test.ts"]);
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [repair] }));
  await flush();
  const detail = "隔离环境访问被拒绝，未执行页面测试";
  env.attempts[0].resolve({ outcome: "failed", detail });
  await flush();
  const firstEventId = env.mains[1].request.reviewEventIds![0];
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: firstEventId,
    reviews: [{ reviewEventId: firstEventId, acceptance: "failed", reason: detail, subtaskIds: [repair.id] }],
    subtasks: [repair],
  }));
  await flush();
  env.attempts[1].resolve({ outcome: "failed", detail });
  await flush();
  const stalledReview = env.mains[2];
  assert.match(stalledReview.request.prompt, /隔离环境访问被拒绝/);
  assert.equal(env.tasks.get(taskId)?.status, "running");
  assert.equal(pauses.length, 0);
  stalledReview.resolve(decisionJson({ status: "blocked", finalSummary: "仍缺隔离环境访问权限，两轮均未能开始验证。" }));
  await flush();
  assert.equal(env.tasks.get(taskId)?.loopPlusBlockReview?.state, "pending");
  assert.equal(pauses.length, 0);
  assert.match(env.mains[3].request.prompt, /Bounded blocked review/);
  const summary = "页面测试未完成；平台维护方补齐隔离证据后点击继续。";
  env.mains[3].resolve(decisionJson({ status: "blocked", finalSummary: summary }));
  await flush();
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.mains.length, 4);
  assert.equal(env.tasks.get(taskId)?.status, "needs-review");
  assert.equal(env.tasks.get(taskId)?.loopPlusBlockReview?.state, "reviewed");
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).reviewQueue.map((event) => event.eventId), stalledReview.request.reviewEventIds);
  assert.equal(env.acceptanceFeedback.length, 1);
  assert.equal(pauses.length, 1);
  assert.ok(pauses[0].task.finalSummary?.includes(buildLoopBlockerSummary(loopBlockerFixture(summary))));
  assert.equal(pauses[0].message, "loop-plus-blocked");
  env.host.tryRun({ displayPrompt: "show state" }, env.target, { resumeTaskId: taskId });
  await flush();
  assert.equal(env.mains.length, 4);
  assert.equal(pauses.length, 1);
  assert.equal(env.messages.includes("loop-plus-completed"), false);
});

for (const autoSelect of [false, true]) {
  test(`Loop+ resumes recoverable blocker after ${autoSelect ? "configured timeout" : "manual selection"}`, async () => {
    let waiting: ReturnType<typeof waitForOrchestratorClarification> | undefined;
    const env = harness({ clarificationTimeoutMs: () => autoSelect ? 30 : 0,
      waitForClarification: (...args) => (waiting = waitForOrchestratorClarification(...args)) });
    const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
    const taskId = run.taskId ?? "";
    await flush();
    env.mains[0].resolve(decisionJson({ status: "blocked", finalSummary: "need evidence" }));
    await flush();
    const blocker = { ...loopBlockerFixture("构建环境缺少项目工具。"), recoveryOptions: [
      { label: "使用仓库工具", action: "运行仓库声明的本地构建工具。", verification: "检查版本后重新构建。" },
      { label: "使用已有容器", action: "在项目声明的容器中构建。", verification: "容器构建成功。" },
    ] };
    env.mains[1].resolve(decisionJson({ status: "blocked", blocker }));
    await flush();
    const request = env.tasks.get(taskId)?.pendingClarification;
    assert.ok(waiting);
    if (!autoSelect) {
      assert.ok(request);
      const scope = loopClarificationScope(taskId);
      assert.equal(submitOrchestratorClarification(scope, request.interactionId, { [LOOP_RECOVERY_PLAN_FIELD]: "99" }).ok, false);
      assert.equal(submitOrchestratorClarification(scope, request.interactionId, { [LOOP_RECOVERY_PLAN_FIELD]: "2" }).ok, true);
    }
    const submission = await waiting;
    assert.equal(Boolean(submission.timedOut), autoSelect);
    await flush();
    assert.equal(env.mains.length, 3);
    if (autoSelect) assert.match(env.mains[2].request.prompt, /主任务澄清超时/);
    assert.match(env.mains[2].request.prompt, autoSelect ? /运行仓库声明的本地构建工具/ : /在项目声明的容器中构建/);
    assert.match(env.mains[2].request.prompt, /仅在现有授权内执行所选方案/);
    assert.equal(env.tasks.get(taskId)?.status, "running");
    assert.equal(env.tasks.get(taskId)?.pendingClarification, undefined);
    env.host.stopParent(taskId);
    await run.done;
  });
}

test("incomplete blocker diagnostics are corrected before pause without confirming held events", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "完成构建" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("build", ["src/a.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "failed", detail: "缺少工具" });
  await flush();
  const incomplete = JSON.stringify({ status: "blocked", finalSummary: "缺少工具" });
  env.mains[1].resolve(incomplete);
  await flush();
  assert.match(env.mains[2].request.prompt, /Bounded blocked review/);
  env.mains[2].resolve(incomplete);
  await flush();
  assert.equal(env.tasks.get(run.taskId!)?.status, "running");
  assert.match(env.mains[3].request.prompt, /Loop\+ 继续执行/);
  assert.match(env.mains[3].request.prompt, /validation\.blocked\.invalid_blocker/);
  env.mains[3].resolve(decisionJson({ status: "blocked", blocker: loopBlockerFixture("缺少 Node.js，构建未完成。") }));
  await flush();
  await run.done;
  const task = env.tasks.get(run.taskId!)!;
  assert.equal(task.status, "needs-review");
  assert.match(task.finalSummary ?? "", /Node.js/);
  assert.match(task.finalSummary ?? "", /### 继续前需要解决的事项\n[^\n]+\n\n### 恢复条件/);
  assert.doesNotMatch(task.finalSummary ?? "", /确认方式/);
  assert.equal(snapshotOf(task).reviewQueue.length, 1);
  assert.equal(task.loopPlusProgressPercent ?? 0, 0);
  assert.equal(env.messages.includes("loop-plus-completed"), false);
});

test("diagnostic correction exhaustion is bounded and does not reuse a stale business reason", async (context) => {
  const env = protocolHarness(context);
  const task = baseTask("diagnostic-recovery", createLoopPlusScheduler({ maxConcurrency: 6 }).snapshot());
  task.loopPlusBlockReview = { state: "reviewed", summary: "容器缺少构建工具，具体软件尚未报告。" };
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: "恢复" }, env.target, { resumeTaskId: task.id });
  await exhaustProtocolBudget(env, run, 0,
    JSON.stringify({ status: "blocked", blocker: { kind: "recoverable", cause: "缺依赖" } }));
  assert.equal(env.attempts.length, 0);
  const paused = env.tasks.get(task.id)!;
  assert.equal(paused.status, "needs-review");
  assert.match(paused.finalSummary ?? "", /已自动继续执行 3 次/);
  assert.match(paused.finalSummary ?? "", /validation\.blocked\.invalid_blocker/);
  assert.doesNotMatch(paused.finalSummary ?? "", /容器缺少构建工具/);
  assert.match(paused.finalSummary ?? "", /按当前 blocked 形状补充/);
  assert.equal(env.messages.includes("loop-plus-completed"), false);
});

test("pause communication recording continues when the chat notification fails", async () => {
  const pauses: Array<{ task: LoopTaskRecord; message: string }> = [];
  const env = harness({
    appendMessage: (_target, message) => {
      if (message === "loop-plus-blocked") {
        throw new Error("chat unavailable");
      }
    },
    recordPause: (task, message) => { pauses.push({ task, message }); },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "blocked", finalSummary: "need evidence" }));
  await flush();
  env.mains[1].resolve(decisionJson({ status: "blocked", finalSummary: "need evidence" }));
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "needs-review");
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].message, "loop-plus-blocked");
  assert.equal(env.logs.some((entry) => entry.event === "loop-plus-pause-message-failed"), true);
});

test("block review survives host reconstruction and cannot restart the same no-progress check", async () => {
  const env = harness();
  const pending = baseTask("pending-review", createLoopPlusScheduler({ maxConcurrency: 6 }).snapshot());
  pending.loopPlusBlockReview = { state: "pending", summary: "need external input" };
  env.tasks.set(pending.id, pending);
  const run = env.host.tryRun({ displayPrompt: "restore" }, env.target, { resumeTaskId: pending.id });
  await flush();
  assert.match(env.mains[0].request.prompt, /Bounded blocked review/);
  env.mains[0].resolve(decisionJson({ status: "blocked" }));
  await flush();
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.mains.length, 1);
  assert.match(env.tasks.get(pending.id)?.finalSummary ?? "", /外部接口约定待确认/);
  assert.match(env.tasks.get(pending.id)?.finalSummary ?? "", /### 恢复条件/);

  const reviewed = baseTask("reviewed", createLoopPlusScheduler({ maxConcurrency: 6 }).snapshot());
  reviewed.loopPlusBlockReview = { state: "reviewed", summary: "already checked" };
  env.tasks.set(reviewed.id, reviewed);
  env.host.tryRun({ displayPrompt: "restore" }, env.target, { resumeTaskId: reviewed.id });
  await flush();
  env.mains[1].resolve(decisionJson({ status: "blocked", finalSummary: "still waiting" }));
  await flush();
  assert.equal(env.mains.length, 2);
  assert.equal(env.tasks.get(reviewed.id)?.status, "needs-review");
});

test("new user input rearms one review while malformed answers exhaust the protocol budget", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "ship" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "blocked", finalSummary: "missing evidence" }));
  await flush();
  env.mains[1].resolve(decisionJson({ status: "blocked", finalSummary: "no independent work" }));
  await flush();
  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "new platform evidence supplied"), true);
  await flush();
  assert.equal(env.mains[2].request.userMessageCount, 1);
  assert.match(env.mains[2].request.prompt, /new platform evidence supplied/u);
  env.mains[2].resolve(decisionJson({ status: "blocked", finalSummary: "evidence still incomplete" }));
  await flush();
  assert.match(env.mains[3].request.prompt, /Bounded blocked review/);
  assert.equal(env.mains[3].request.userMessageCount, 0);
  const boundedMessageSection = env.mains[3].request.prompt.split("New user messages, oldest first.")[1]?.split("Root request:")[0] ?? "";
  assert.doesNotMatch(boundedMessageSection, /new platform evidence supplied/u);
  await exhaustProtocolBudget(env, run, 3, decisionJson({ status: "unknown" }));
  assert.equal(env.messages.filter((message) => message === "loop-plus-block-review").length, 2);
});

test("user input received without a live host rearms the persisted block review", () => {
  const env = harness();
  const paused = baseTask("stored-blocked-review", createLoopPlusScheduler({ maxConcurrency: 6 }).snapshot());
  paused.status = "needs-review";
  paused.loopPlusBlockReview = { state: "reviewed", summary: "waiting for platform evidence" };
  env.tasks.set(paused.id, paused);
  assert.equal(env.host.submitUserMessage(paused.id, "new platform evidence supplied"), true);
  assert.equal(env.tasks.get(paused.id)?.loopPlusBlockReview, undefined);
  assert.deepEqual(snapshotOf(env.tasks.get(paused.id)).userMessageQueue, ["new platform evidence supplied"]);
  assert.equal(env.tasks.get(paused.id)?.status, "needs-review");
  assert.equal(env.mains.length, 0);
});

test("blocked review preserves its event and later completions for resumed FIFO review", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("a", ["a.ts"]), subtask("b", ["b.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "a done" });
  await flush();
  const eventId = env.mains[1].request.reviewEventId;
  env.mains[1].resolve(decisionJson({ status: "blocked", finalSummary: "a path is blocked" }));
  await flush();
  assert.equal(env.mains[2].request.reviewEventId, eventId);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).running[0]?.subtaskId, "b");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts[0]?.disposition, "finished");
  env.attempts[1].resolve({ outcome: "completed", detail: "b done during review" });
  await flush();
  const snapshot = snapshotOf(env.tasks.get(run.taskId ?? ""));
  assert.deepEqual([snapshot.currentReview?.eventId, ...snapshot.reviewQueue.map((item) => item.eventId)], [
    eventId,
    buildLoopPlusFinishEventId("b", env.attempts[1].request.attemptId),
  ]);
  assert.equal(env.mains.length, 3, "new queued work starts a bounded follow-up decision after the blocked review");
  assert.deepEqual(env.mains[2].request.reviewEventIds, [eventId]);
  assert.equal(env.mains[2].request.userMessageCount, 0);
  env.host.stopParent(run.taskId ?? "");
});

test("blocked frozen review exposes messages arriving after its captured prefix exactly once", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([{ subtaskId: "alpha", attemptId: "alpha-1", title: "alpha", writeFiles: ["a.ts"] }]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  scheduler.enqueueUserMessage("before review");
  const task = baseTask("blocked-frozen-review", scheduler.snapshot());
  task.status = "needs-review";
  env.tasks.set(task.id, task);
  const taskId = task.id;
  const run = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  const first = env.mains[0];
  const eventId = first.request.reviewEventId;
  assert.equal(first.request.userMessageCount, 1);
  assert.match(first.request.prompt, /before review/u);
  env.host.submitUserMessage(taskId, "arrived during review");
  assert.deepEqual(first.request.reviewEventIds, [eventId]);
  assert.equal(first.request.userMessageCount, 1);
  first.resolve(decisionJson({ status: "blocked", finalSummary: "blocked by external evidence" }));
  await flush();
  const second = env.mains[1];
  assert.deepEqual(second.request.reviewEventIds, [eventId]);
  assert.equal(second.request.userMessageCount, 1);
  assert.match(second.request.prompt, /arrived during review/u);
  const secondMessageSection = second.request.prompt.split("New user messages, oldest first.")[1]?.split("Root request:")[0] ?? "";
  assert.doesNotMatch(secondMessageSection, /before review/u);
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts[0]?.disposition, "finished");
  second.resolve(decisionJson({ status: "blocked", finalSummary: "still blocked" }));
  await flush();
  const bounded = env.mains[2];
  assert.match(bounded.request.prompt, /Bounded blocked review/u);
  assert.deepEqual(bounded.request.reviewEventIds, [eventId]);
  assert.equal(bounded.request.userMessageCount, 0);
  bounded.resolve(decisionJson({ status: "blocked", finalSummary: "still blocked" }));
  await flush();
  assert.equal(env.tasks.get(taskId)?.status, "needs-review");
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).userMessageQueue, []);
  const pausedSnapshot = snapshotOf(env.tasks.get(taskId));
  assert.deepEqual(
    [pausedSnapshot.currentReview?.eventId, ...pausedSnapshot.reviewQueue.map((item) => item.eventId)].filter(Boolean),
    [eventId],
  );
  assert.equal(env.mains.length, 3, "without a newer message the held batch receives one bounded review before pause");
  await run.done;
});

function baseTask(id: string, snapshot?: LoopPlusSchedulerSnapshot): LoopTaskRecord {
  return {
    id,
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: `/tmp/${id}/loop-tasks.json`,
    rootPrompt: "ship the feature",
    schedulingMode: "event_driven",
    loopPlus: snapshot,
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    maxRounds: 20,
    currentRound: 0,
    communicationDir: `/tmp/${id}`,
    mainCommunicationFile: `/tmp/${id}/main.md`,
    sessionId: "session",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    supplementalRequirements: ["keep the public API stable"],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

function harness(options: {
  isAttemptActive?: () => boolean;
  hasActiveSubtasks?: (taskId: string) => boolean;
  maxConcurrency?: number;
  decisionSubtaskMax?: () => number;
  launchDelayMs?: (last: number | null, now: number) => number;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
  deferMainAbort?: boolean;
  deferAttemptAbort?: boolean;
  throwOnStart?: boolean;
  prepareCommunication?: LoopPlusOrchestrationDeps["prepareCommunication"];
  recordAttempt?: LoopPlusOrchestrationDeps["recordAttempt"];
  appendSubtaskChat?: LoopPlusOrchestrationDeps["appendSubtaskChat"];
  log?: LoopPlusOrchestrationDeps["log"];
  removeClarificationResponse?: LoopPlusOrchestrationDeps["removeClarificationResponse"];
  beforeReadTask?: () => void;
  projectReadTask?: (task: LoopTaskRecord | null, taskId: string) => LoopTaskRecord | null;
  beforeUpdateTask?: (patch: Partial<LoopTaskRecord>) => void;
  adaptMain?: (request: LoopPlusMainRequest, callIndex: number) => LoopPlusMainHandle | undefined;
  clarificationTimeoutMs?: () => number;
  waitForClarification?: LoopPlusOrchestrationDeps["waitForClarification"];
  onTaskCompleted?: LoopPlusOrchestrationDeps["onTaskCompleted"];
  appendMessage?: LoopPlusOrchestrationDeps["appendMessage"];
  department?: LoopTaskRecord["department"];
  departmentInvalid?: boolean;
  getDepartmentEmployeeCapacity?: LoopPlusOrchestrationDeps["getDepartmentEmployeeCapacity"];
  recordPause?: LoopPlusOrchestrationDeps["recordPause"];
  closeSubtaskTabs?: LoopPlusOrchestrationDeps["closeSubtaskTabs"];
  onAttemptCompleted?: () => Promise<void>;
  canAutoResumeMain?: LoopPlusOrchestrationDeps["canAutoResumeMain"];
} = {}) {
  const tasks = new Map<string, LoopTaskRecord>();
  const mains: MainCall[] = [];
  const attempts: AttemptCall[] = [];
  const messages: string[] = [];
  const reports: AttemptReport[] = [];
  const logs: Array<{ event: string; payload?: unknown }> = [];
  const abortedAttemptIds: string[] = [];
  const closeTabAttemptIds: string[] = [];
  const acceptanceFeedback: Array<{ taskId: string; heading: string; body: string }> = [];
  let activeMains = 0;
  let maxMains = 0;
  let taskSeq = 0;
  let mainCalls = 0;
  const target: LoopPlusPromptTarget = { tabId: "tab-main", cli: "codex", sessionId: "session" };
  const deps: LoopPlusOrchestrationDeps = {
    hasActiveSubtasks: options.hasActiveSubtasks,
    canAutoResumeMain: options.canAutoResumeMain,
    closeSubtaskTabs: options.closeSubtaskTabs,
    getDepartmentEmployeeCapacity: options.getDepartmentEmployeeCapacity,
    maxConcurrency: options.maxConcurrency,
    ...(options.decisionSubtaskMax ? { decisionSubtaskMax: options.decisionSubtaskMax } : {}),
    ...(options.clarificationTimeoutMs ? { clarificationTimeoutMs: options.clarificationTimeoutMs } : {}),
    waitForClarification: options.waitForClarification,
    onTaskCompleted: options.onTaskCompleted,
    recordPause: options.recordPause,
    launchDelayMs: options.launchDelayMs ?? (() => 0),
    delay: options.delay ?? (async () => undefined),
    ...(options.now ? { now: options.now } : {}),
    prepareCommunication: options.prepareCommunication,
    appendSubtaskChat: options.appendSubtaskChat,
    appendAcceptancePlanChat: (taskId, section) => {
      acceptanceFeedback.push({ taskId, ...section });
    },
    readTask: (taskId) => {
      options.beforeReadTask?.();
      const stored = tasks.get(taskId) ?? null;
      return options.projectReadTask ? options.projectReadTask(stored, taskId) : stored;
    },
    createTask: (input) => {
      taskSeq += 1;
      const task = baseTask(`task-${taskSeq}`, input.snapshot);
      task.rootPrompt = input.rootPrompt;
      task.sessionId = input.sessionId;
      if (options.department) task.department = options.department;
      if (options.departmentInvalid) task.departmentInvalid = true;
      if (input.prompt.loopPlusAcceptancePlan) {
        task.loopPlusAcceptancePlan = input.prompt.loopPlusAcceptancePlan;
      }
      tasks.set(task.id, task);
      return task;
    },
    updateTask: (taskId, patch) => {
      options.beforeUpdateTask?.(patch);
      const existing = tasks.get(taskId);
      if (!existing) {
        return null;
      }
      const next = { ...existing, ...patch, id: existing.id };
      tasks.set(taskId, next);
      return next;
    },
    appendMessage: options.appendMessage ?? ((_target, message) => {
      messages.push(message);
    }),
    removeClarificationResponse: options.removeClarificationResponse,
    runMain: (request) => {
      mainCalls += 1;
      if (options.adaptMain) {
        const adapted = options.adaptMain(request, mainCalls);
        if (adapted) {
          return adapted;
        }
      }
      activeMains += 1;
      maxMains = Math.max(maxMains, activeMains);
      const gate = deferred<string | null>();
      const call: MainCall = {
        request,
        invocationPrompt: request.prompt,
        invocationModelPrompt: request.modelPrompt,
        resolve: gate.resolve,
        reject: gate.reject,
        abortCount: 0,
        releaseAbort: (value) => gate.resolve(value ?? null),
      };
      if (request.canSendAutoResumedMain && !request.canSendAutoResumedMain()) {
        activeMains -= 1;
        return { promise: Promise.resolve(null), abort: () => undefined };
      }
      mains.push(call);
      return {
        promise: gate.promise.finally(() => {
          activeMains -= 1;
        }),
        abort: () => {
          call.abortCount += 1;
          if (options.deferMainAbort) {
            return;
          }
          gate.resolve(null);
        },
      };
    },
    startAttempt: (request) => {
      if (options.throwOnStart) {
        throw new Error("sync start adapter");
      }
      const gate = deferred<LoopPlusAttemptResult>();
      attempts.push({ request, resolve: gate.resolve });
      return {
        promise: gate.promise,
        onCompleted: options.onAttemptCompleted,
        isActive: options.isAttemptActive,
        abort: (abortOptions) => {
          abortedAttemptIds.push(request.attemptId);
          if (abortOptions?.closeTab === true) {
            closeTabAttemptIds.push(request.attemptId);
          }
          if (options.deferAttemptAbort) {
            return;
          }
          gate.resolve({ outcome: "stopped", detail: "aborted" });
        },
      };
    },
    recordAttempt: (input) => {
      options.recordAttempt?.(input);
      reports.push({
        subtaskId: input.subtaskId,
        attemptId: input.attemptId,
        outcome: input.outcome,
        detail: input.detail,
      });
    },
    log: (event, payload) => {
      logs.push({ event, payload });
      options.log?.(event, payload);
    },
  };
  return {
    host: createLoopPlusOrchestrationHost(deps),
    reloadHost: () => createLoopPlusOrchestrationHost(deps),
    tasks,
    mains,
    attempts,
    messages,
    reports,
    logs,
    abortedAttemptIds,
    closeTabAttemptIds,
    acceptanceFeedback,
    target,
    maxMains: () => maxMains,
    activeMains: () => activeMains,
    mainCalls: () => mainCalls,
  };
}

function snapshotOf(task: LoopTaskRecord | undefined): LoopPlusSchedulerSnapshot {
  return task?.loopPlus as LoopPlusSchedulerSnapshot;
}

function protocolHarness(context: import("node:test").TestContext, options?: Parameters<typeof harness>[0]) {
  const env = harness(options);
  const hosts: Array<{ host: ReturnType<typeof createLoopPlusOrchestrationHost>; taskIds: Set<string> }> = [];
  const trackHost = (host: ReturnType<typeof createLoopPlusOrchestrationHost>) => {
    const tracked = { host, taskIds: new Set<string>() };
    hosts.push(tracked);
    return {
      ...host,
      tryRun: (...args: Parameters<typeof host.tryRun>) => {
        const result = host.tryRun(...args);
        if (result.taskId) tracked.taskIds.add(result.taskId);
        return result;
      },
    };
  };
  const initialHost = trackHost(env.host);
  context.after(async () => {
    const pausedTaskStatuses = new Map<string, LoopTaskRecord["status"]>();
    for (const { host, taskIds } of hosts) {
      for (const taskId of taskIds) {
        const status = env.tasks.get(taskId)?.status;
        if (status === "needs-review") pausedTaskStatuses.set(taskId, status);
        else if (status === "running") host.stopParent(taskId);
      }
    }
    await flush();
    assert.equal(env.activeMains(), 0, "protocol fixture must not leave a pending main response");
    for (const [taskId, status] of pausedTaskStatuses) {
      assert.equal(env.tasks.get(taskId)?.status, status, "fixture cleanup must not turn a protocol pause into a user stop");
    }
  });
  return {
    ...env,
    host: initialHost,
    reloadHost: () => {
      return trackHost(env.reloadHost());
    },
  };
}

async function exhaustProtocolBudget(
  env: ReturnType<typeof harness>,
  run: LoopPlusRunResult,
  firstIndex: number,
  response: string | ((main: MainCall, rejection: number) => string),
  firstRejectionAlreadySubmitted = false,
): Promise<number> {
  const firstRejection = firstRejectionAlreadySubmitted ? 2 : 1;
  for (let rejection = firstRejection; rejection <= 4; rejection += 1) {
    await flush();
    const mainIndex = firstIndex + rejection - 1;
    assert.equal(env.mains.length, mainIndex + 1, `expected main request for rejection ${rejection}`);
    assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
    const main = env.mains[mainIndex];
    main.resolve(typeof response === "string" ? response : response(main, rejection));
  }
  assert.equal(await isSettled(run.done), true, "the fourth rejection must settle the lifecycle");
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "needs-review");
  assert.equal(env.mains.length, firstIndex + 4, "no fifth decision after four rejections");
  return env.mains.length;
}

test("recovers an unexpectedly interrupted main call once with its frozen request", async () => {
  let allowedChecks = 0;
  const env = harness({
    canAutoResumeMain: (task, target) => {
      allowedChecks += 1;
      return task.sessionId === target.sessionId && target.tabId === "tab-main";
    },
    adaptMain: (_request, callIndex) => callIndex === 1 ? {
      promise: Promise.resolve("partial output"),
      abort: () => undefined,
      hasStarted: () => true,
      wasUnexpectedlyInterrupted: () => true,
    } : undefined,
  });
  const run = env.host.tryRun({ displayPrompt: "resume the original step" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains.length, 0);
  env.host.checkInterruptedMainTasks();
  env.host.checkInterruptedMainTasks();
  await flush();
  assert.equal(env.mains.length, 1);
  assert.equal(env.mains[0].request.kind, "initial");
  assert.equal(allowedChecks, 3);
  assert.equal(env.mains[0].request.canSendAutoResumedMain?.(), false);
  env.mains[0].resolve(directCompletionDecision());
  await run.done;
  assert.equal(env.tasks.get(run.taskId!)?.status, "completed");
  assert.equal(env.mains.length, 1);
});

function interruptedMainCall(): LoopPlusMainHandle {
  return {
    promise: Promise.resolve(null),
    abort: () => undefined,
    hasStarted: () => true,
    wasUnexpectedlyInterrupted: () => true,
    getInterruptedNativeSessionId: () => "original-thread",
  };
}

test("each minute admits one retry and the third interrupted retry persists the circuit break", async (t) => {
  const frozenPrompts: string[] = [];
  const env = harness({
    canAutoResumeMain: (_task, _target, threadId) => threadId === "original-thread",
    adaptMain: (request) => {
      if (request.canSendAutoResumedMain) {
        assert.equal(request.canSendAutoResumedMain(), true);
        assert.equal(request.canSendAutoResumedMain(), false);
      }
      frozenPrompts.push(request.modelPrompt);
      return interruptedMainCall();
    },
  });
  t.mock.timers.enable({ apis: ["setInterval"] } as never);
  const dispose = startLoopWaitWatchdog([env.host.checkWaitingTasks], (error) => { throw error; }, [env.host.checkInterruptedMainTasks, env.host.checkWaitingReviews]);
  t.after(dispose);
  const run = env.host.tryRun({ displayPrompt: "retry interrupted main turn" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId!;
  await flush();
  assert.equal(env.mainCalls(), 1);
  assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount ?? 0, 0);
  for (const count of [1, 2, 3]) {
    t.mock.timers.tick(59_999);
    await flush();
    assert.equal(env.mainCalls(), count);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(env.mainCalls(), count + 1);
    assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount, count);
    assert.equal(env.tasks.get(taskId)?.status, count === 3 ? "needs-review" : "running");
  }
  await run.done;
  assert.equal(new Set(frozenPrompts).size, 1);
  assert.equal(env.messages.filter((message) => message === "loop-plus-main-recovery-exhausted").length, 1);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(env.mainCalls(), 4);
});

test("分钟巡检补唤醒已入队但漏通知的验收，不等运行中的兄弟任务", async (t) => {
  const missedWake = new Error("模拟完成入队后缺少唤醒");
  const env = harness({
    maxConcurrency: 2,
    isAttemptActive: () => true,
    hasActiveSubtasks: () => true,
    appendSubtaskChat: (_target, notice) => {
      if (notice.phase === "finished" && notice.subtaskId === "ready") throw missedWake;
    },
    log: (event) => {
      if (event === "loop-plus-chat-failed") throw missedWake;
    },
  });
  t.mock.timers.enable({ apis: ["setInterval"] } as never);
  t.after(startLoopWaitWatchdog([env.host.checkWaitingTasks], (error) => { throw error; }, [env.host.checkWaitingReviews]));
  const run = env.host.tryRun({ displayPrompt: "等待两项交付" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId!;
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    subtask("ready", ["src/ready.ts"]), subtask("running", ["src/running.ts"]),
  ] }));
  await flush();
  const ready = env.attempts.find(({ request }) => request.subtaskId === "ready")!.request;
  const eventId = buildLoopPlusFinishEventId(ready.subtaskId, ready.attemptId);
  assert.throws(() => env.host.reportAttempt(taskId, {
    subtaskId: ready.subtaskId, attemptId: ready.attemptId, outcome: "completed",
  }), (error) => error === missedWake);
  const parked = snapshotOf(env.tasks.get(taskId));
  assert.equal(parked.currentReview?.eventId, eventId);
  assert.deepEqual(parked.running.map(({ subtaskId }) => subtaskId), ["running"]);
  env.host.checkWaitingTasks();
  t.mock.timers.tick(59_999);
  assert.equal(env.mainCalls(), 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(env.mainCalls(), 2);
  assert.deepEqual(env.mains[1].request.reviewEventIds, [eventId]);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.maxMains(), 1);
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventIds: [eventId], subtasks: [] }));
  await flush();
  t.mock.timers.tick(60_000);
  assert.equal(env.mainCalls(), 2);
  env.host.stopParent(taskId);
  await run.done;
  t.mock.timers.tick(60_000);
  assert.equal(env.mainCalls(), 2);
});

test("a rebuilt host retains the count without adopting a queued recovery from another host", async () => {
  const env = harness({
    canAutoResumeMain: () => true,
    adaptMain: (request) => {
      if (request.canSendAutoResumedMain) assert.equal(request.canSendAutoResumedMain(), true);
      return interruptedMainCall();
    },
  });
  const run = env.host.tryRun({ displayPrompt: "retain the retry count" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId!;
  await flush();
  env.host.checkInterruptedMainTasks();
  await flush();
  env.host.checkInterruptedMainTasks();
  await flush();
  assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount, 2);

  const rebuilt = env.reloadHost();
  rebuilt.checkInterruptedMainTasks();
  rebuilt.checkWaitingTasks();
  await flush();
  assert.equal(rebuilt.hasController(taskId), false);
  assert.equal(env.mainCalls(), 3);
  assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount, 2);

  const continued = rebuilt.tryRun({ displayPrompt: "explicit continue" }, env.target, { resumeTaskId: taskId, resumeRequested: true });
  await flush();
  assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount, 2);
  rebuilt.checkInterruptedMainTasks();
  await continued.done;
  assert.equal(env.mainCalls(), 5);
  assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount, 3);
  assert.equal(env.tasks.get(taskId)?.status, "needs-review");
});

for (const evidence of ["passed", "failed", "reported"] as const) {
  test(`main retry count after ${evidence} subtask evidence`, async () => {
    const env = harness({
      canAutoResumeMain: () => true,
      adaptMain: (request, callIndex) => {
        if (callIndex > 2) return undefined;
        if (request.canSendAutoResumedMain) assert.equal(request.canSendAutoResumedMain(), true);
        return interruptedMainCall();
      },
    });
    const run = env.host.tryRun({ displayPrompt: "reset only on confirmed progress" }, env.target, { schedulingMode: "event_driven" });
    const taskId = run.taskId!;
    await flush();
    env.host.checkInterruptedMainTasks();
    await flush();
    env.host.checkInterruptedMainTasks();
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
      { ...subtask("evidence", []), requiresAcceptance: evidence !== "reported" },
    ] }));
    await flush();
    assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount, 1);
    const attempt = env.attempts[0];
    attempt.resolve({ outcome: "completed", detail: "已交付执行结果" });
    await flush();
    assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount, 1, "execution alone does not reset the count");
    const eventId = buildLoopPlusFinishEventId("evidence", attempt.request.attemptId);
    env.mains[1].resolve(evidence === "reported"
      ? decisionJson({ status: "wait", reportEventIds: [eventId] })
      : decisionJson({ status: "accept", reviewEventId: eventId, subtasks: [], reviews: [
        { reviewEventId: eventId, acceptance: evidence, reason: "已检查执行结果", subtaskIds: [],
          ...(evidence === "failed" ? { noRepairReason: "此用例仅验证失败验收证据" } : {}) },
      ] }));
    await flush();
    const committed = snapshotOf(env.tasks.get(taskId)).seenAttempts[0];
    assert.equal(committed.disposition, evidence === "reported" ? "reported" : "reviewed");
    assert.equal(committed.acceptance, evidence === "reported" ? undefined : evidence);
    assert.equal(env.tasks.get(taskId)?.loopPlusMainRecoveryFailureCount, evidence === "failed" ? 1 : 0);
    env.host.stopParent(taskId);
    await run.done;
  });
}

test("an admitted recovery with an unknown exit cannot retry or add a recovery failure", async () => {
  const env = harness({
    canAutoResumeMain: () => true,
    adaptMain: (request, callIndex) => {
      if (request.canSendAutoResumedMain) assert.equal(request.canSendAutoResumedMain(), true);
      return callIndex < 3 ? interruptedMainCall() : { promise: Promise.resolve(null), abort: () => undefined };
    },
  });
  const run = env.host.tryRun({ displayPrompt: "unknown recovery exit" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.host.checkInterruptedMainTasks();
  await flush();
  env.host.checkInterruptedMainTasks();
  await run.done;
  env.host.checkInterruptedMainTasks();
  env.host.checkWaitingTasks();
  await flush();
  assert.equal(env.mainCalls(), 3);
  assert.equal(env.tasks.get(run.taskId!)?.loopPlusMainRecoveryFailureCount, 1);
  assert.equal(env.tasks.get(run.taskId!)?.status, "needs-review");
});

for (const failedWriteAt of [1, 3]) {
  test(`a failed recovery count write at ${failedWriteAt} stops this host from sending again`, async () => {
    const env = harness({
      canAutoResumeMain: () => true,
      beforeUpdateTask: (patch) => {
        if (patch.loopPlusMainRecoveryFailureCount === failedWriteAt) throw new Error("recovery count write failed");
      },
      adaptMain: (request) => {
        if (request.canSendAutoResumedMain) assert.equal(request.canSendAutoResumedMain(), true);
        return interruptedMainCall();
      },
    });
    const run = env.host.tryRun({ displayPrompt: "fail closed on uncommitted count" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    for (let tick = 0; tick < failedWriteAt; tick += 1) {
      env.host.checkInterruptedMainTasks();
      await flush();
    }
    await run.done;
    env.host.checkInterruptedMainTasks();
    env.host.checkWaitingTasks();
    await flush();
    assert.equal(env.mainCalls(), failedWriteAt + 1);
    assert.equal(env.tasks.get(run.taskId!)?.loopPlusMainRecoveryFailureCount ?? 0, failedWriteAt - 1);
  });
}

test("main watchdog denies recovery when the ownership approval callback is absent", async () => {
  const env = harness({
    adaptMain: (_request, callIndex) => callIndex === 1 ? {
      promise: Promise.resolve(null), abort: () => undefined, hasStarted: () => true,
      wasUnexpectedlyInterrupted: () => true,
    } : undefined,
  });
  const run = env.host.tryRun({ displayPrompt: "approval is required" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.host.checkInterruptedMainTasks();
  await flush();
  assert.equal(env.mains.length, 0);
  assert.equal(env.tasks.get(run.taskId!)?.status, "running");
  assert.equal(env.logs.some(({ event }) => event === "loop-plus-main-recovery-denied"), true);
  await run.done;
});

test("main watchdog discards a recovery result that never passed the send gate", async () => {
  const env = harness({
    canAutoResumeMain: () => true,
    adaptMain: (_request, callIndex) => callIndex === 1 ? {
      ...interruptedMainCall(),
    } : { promise: Promise.resolve(directCompletionDecision()), abort: () => undefined },
  });
  const run = env.host.tryRun({ displayPrompt: "do not accept an unsent recovery" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.host.checkInterruptedMainTasks();
  await run.done;
  env.host.checkInterruptedMainTasks();
  assert.equal(env.tasks.get(run.taskId!)?.status, "running");
  assert.equal(env.logs.filter(({ event }) => event === "loop-plus-main-recovery-denied").length, 1);
});

test("main watchdog resumes the original frozen review batch without selecting newer events", async () => {
  const env = harness({
    canAutoResumeMain: () => true,
    adaptMain: (_request, callIndex) => callIndex === 2 ? {
      promise: Promise.resolve(null), abort: () => undefined, hasStarted: () => true,
      wasUnexpectedlyInterrupted: () => true,
    } : undefined,
  });
  const run = env.host.tryRun({ displayPrompt: "keep the review batch frozen" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("frozen", ["src/frozen.ts"])] }));
  await flush();
  const attempt = env.attempts[0];
  attempt.resolve({ outcome: "completed", detail: "已完成" });
  await flush();
  const eventId = buildLoopPlusFinishEventId("frozen", attempt.request.attemptId);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId!)).currentReview?.eventId, eventId);
  env.host.checkInterruptedMainTasks();
  await flush();
  assert.deepEqual(env.mains[1].request.reviewEventIds, [eventId]);
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventIds: [eventId], subtasks: [] }));
  await flush();
  assert.equal(env.mains[2].request.kind, "closeout");
  env.mains[2].resolve(completedDecision());
  await run.done;
  assert.equal(env.tasks.get(run.taskId!)?.status, "completed");
});

test("a stopped-looking ordinary response does not qualify as an unexpected main interruption", async () => {
  const env = harness({
    adaptMain: (_request, callIndex) => callIndex === 1 ? {
      promise: Promise.resolve("stopped"), abort: () => undefined, hasStarted: () => true,
    } : undefined,
  });
  const run = env.host.tryRun({ displayPrompt: "stopped text is not a signal" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.host.checkInterruptedMainTasks();
  await flush();
  assert.equal(env.logs.some(({ event }) => event === "loop-plus-main-interrupted"), false);
  assert.equal(env.mains.length, 1);
  env.host.stopParent(run.taskId!);
  await run.done;
});

test("main watchdog revalidates blocked, stopped and interrupted records after claiming recovery", async () => {
  const blocks: Array<Partial<LoopTaskRecord>> = [
    { status: "needs-review" }, { status: "completed" }, { runtimeInterrupted: true },
    { userStopSource: "ai-panel" }, { userStopSource: "group-chat" }, { mainAiFailureLimitReached: true },
    { loopPlusMainRecoveryFailureCount: 3 },
    { pendingClarification: {} as NonNullable<LoopTaskRecord["pendingClarification"]> },
    { loopPlusBlockReview: {} as NonNullable<LoopTaskRecord["loopPlusBlockReview"]> },
  ];
  for (const block of blocks) {
    const env = harness({
      canAutoResumeMain: () => true,
      adaptMain: (_request, index) => index === 1 ? {
        promise: Promise.resolve(null), abort: () => undefined, hasStarted: () => true,
        wasUnexpectedlyInterrupted: () => true,
      } : undefined,
    });
    const run = env.host.tryRun({ displayPrompt: "check persisted stop gates" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.host.checkInterruptedMainTasks();
    Object.assign(env.tasks.get(run.taskId!)!, block);
    await run.done;
    assert.equal(env.mains.length, 0, JSON.stringify(block));
  }
});

test("main watchdog denies queued and preparing recovery after a user stop even when persistence throws", async () => {
  for (const stopDuringPreparation of [false, true]) {
    const prepared = deferred<LoopPlusMainRequest>();
    const release = deferred<void>();
    let aborted = false;
    let sends = 0;
    const env = harness({
      canAutoResumeMain: () => true,
      beforeUpdateTask: (patch) => { if (patch.status === "stopped") throw new Error("stop write failed"); },
      adaptMain: (request, index) => {
        if (index === 1) return {
          promise: Promise.resolve(null), abort: () => undefined, hasStarted: () => true,
          wasUnexpectedlyInterrupted: () => true,
        };
        prepared.resolve(request);
        return {
          promise: release.promise.then(() => {
            if (request.canSendAutoResumedMain?.()) sends += 1;
            return null;
          }),
          abort: () => {
            aborted = true;
            assert.equal(request.canSendAutoResumedMain?.(), false);
          },
        };
      },
    });
    const run = env.host.tryRun({ displayPrompt: "stop while recovery races" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.host.checkInterruptedMainTasks();
    if (stopDuringPreparation) await prepared.promise;
    env.host.stopParent(run.taskId!);
    release.resolve();
    await run.done;
    env.host.checkInterruptedMainTasks();
    await flush();
    assert.equal(sends, 0);
    assert.equal(aborted, stopDuringPreparation);
    assert.equal(env.tasks.get(run.taskId!)?.status, "running");
  }
});

test("new Loop+ task waits for trusted ownership setup before the first scheduler pump", async () => {
  const env = harness();
  const gate = deferred<void>();
  const readyCalls: string[] = [];
  const run = env.host.tryRun({ displayPrompt: "create the owned coordinator" }, env.target, {
    schedulingMode: "event_driven",
    beforeInitialPump: async (taskId) => { readyCalls.push(taskId); await gate.promise; },
  });
  await flush();
  assert.deepEqual(readyCalls, [run.taskId]);
  assert.equal(env.mains.length, 0);
  gate.resolve();
  await flush();
  assert.equal(env.mains.length, 1);
  env.host.stopParent(run.taskId!);
  await run.done;
});

test("failed new-task ownership setup prevents all Loop+ execution", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "do not pump without ownership" }, env.target, {
    schedulingMode: "event_driven",
    beforeInitialPump: async () => { throw new Error("authority setup failed"); },
  });
  await run.done;
  assert.equal(env.mains.length, 0);
  assert.equal(env.attempts.length, 0);
  assert.equal(env.tasks.get(run.taskId!)?.status, "error");
  assert.equal(env.logs.some(({ event }) => event === "loop-plus-initial-ownership-failed"), true);
});

test("leader capacity is read per decision while an issued invocation keeps its original prompt", async () => {
  const reads: Array<[string, string]> = [];
  let live = {
    rootTaskId: "department-root",
    leaderTaskId: "task-1",
    maxEmployees: 3,
    activeEmployees: 2,
    availableEmployees: 1,
    leaderOverflowActive: false,
    canAcquireOverflow: false,
    leaderAllocation: {
      revision: 0, source: "default" as const, desiredLimit: 3, appliedLimit: 3,
      activeEmployees: 2, availableEmployees: 1, pending: false,
    },
  };
  const env = harness({
    department: {
      version: 1,
      rootTaskId: "department-root",
      parentTaskId: null,
      leaderSubtaskId: null,
      role: "leader",
      moduleTitle: "module",
      routes: { director: {}, leader: {}, employee: {} },
      limits: { maxLeaders: 2, maxEmployees: 3 },
    },
    getDepartmentEmployeeCapacity: (rootTaskId, leaderTaskId) => {
      reads.push([rootTaskId, leaderTaskId]);
      return live;
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.deepEqual(reads, [["department-root", run.taskId ?? ""]]);
  assert.match(env.mains[0].invocationPrompt, /Available regular employee balance: 1/);

  live = { ...live, activeEmployees: 3, availableEmployees: 0, canAcquireOverflow: true,
    leaderAllocation: { ...live.leaderAllocation, activeEmployees: 3, availableEmployees: 0 },
  };
  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "add one more requirement"), true);
  assert.equal(reads.length, 1, "queuing a message does not change the already-issued invocation");
  assert.match(env.mains[0].invocationPrompt, /Available regular employee balance: 1/);
  assert.match(env.mains[0].invocationPrompt, /Department capacity figures are advisory/);
  assert.match(env.mains[0].invocationModelPrompt, /Available regular employee balance: 1/);

  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("feature", ["src/feature.ts"])] }));
  await flush();
  const userRequest = env.mains.find((call) => call.request.kind === "user");
  assert.ok(userRequest);
  assert.match(userRequest?.invocationPrompt ?? "", /Available regular employee balance: 0/);
  assert.match(userRequest?.invocationPrompt ?? "", /Choose how many employees to dispatch based on the work, including when the balance is zero or unknown/);
  assert.equal(reads.length, 4, "refreshes and the supplemental decision each read current capacity");
  assert.ok(reads.every(([root, leader]) => root === "department-root" && leader === run.taskId));

  userRequest?.resolve(decisionJson({ status: "wait" }));
  await flush();
  env.host.stopParent(run.taskId ?? "");
});

test("invalid department identity and ordinary Loop+ do not query employee capacity", async () => {
  const makeDepartment = (): NonNullable<LoopTaskRecord["department"]> => ({
    version: 1,
    rootTaskId: "department-root",
    parentTaskId: null,
    leaderSubtaskId: null,
    role: "leader",
    moduleTitle: "module",
    routes: { director: {}, leader: {}, employee: {} },
    limits: { maxLeaders: 2, maxEmployees: 3 },
  });
  for (const options of [{ departmentInvalid: true, department: makeDepartment() }, {}] as const) {
    let reads = 0;
    const env = harness({
      ...options,
      getDepartmentEmployeeCapacity: () => {
        reads += 1;
        return null;
      },
    });
    const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    assert.equal(reads, 0);
    assert.doesNotMatch(env.mains[0].request.prompt, /Department employee capacity/);
    env.host.stopParent(run.taskId ?? "");
  }
});

test("department capacity provider failures keep leader request generation available", async () => {
  const env = harness({
    department: {
      version: 1,
      rootTaskId: "department-root",
      parentTaskId: null,
      leaderSubtaskId: null,
      role: "leader",
      moduleTitle: "module",
      routes: { director: {}, leader: {}, employee: {} },
      limits: { maxLeaders: 2, maxEmployees: 3 },
    },
    getDepartmentEmployeeCapacity: () => { throw new Error("capacity unavailable"); },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains.length, 1);
  assert.match(env.mains[0].request.prompt, /employee balance unknown/);
  env.host.stopParent(run.taskId ?? "");
});

test("missing department capacity provider renders unknown for a validated leader", async () => {
  const env = harness({
    department: {
      version: 1,
      rootTaskId: "department-root",
      parentTaskId: null,
      leaderSubtaskId: null,
      role: "leader",
      moduleTitle: "module",
      routes: { director: {}, leader: {}, employee: {} },
      limits: { maxLeaders: 2, maxEmployees: 3 },
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains.length, 1);
  assert.match(env.mains[0].request.prompt, /employee balance unknown/);
  env.host.stopParent(run.taskId ?? "");
});

test("resolveLoopPlusEntry keeps the saved scheduling mode ahead of the current dropdown", () => {
  assert.equal(resolveLoopPlusEntry(null, "event_driven"), "event_driven");
  assert.equal(resolveLoopPlusEntry(null, "classic"), "classic");
  assert.equal(resolveLoopPlusEntry(null, undefined), "classic");
  assert.equal(resolveLoopPlusEntry({ schedulingMode: "event_driven" }, "classic"), "event_driven");
  assert.equal(resolveLoopPlusEntry({ schedulingMode: "classic" }, "event_driven"), "classic");
  assert.equal(resolveLoopPlusEntry({}, "event_driven"), "classic");
});

test("Loop+ records completion and starts main review without waiting for subtask compaction", { timeout: 3000 }, async () => {
  for (const viaContinuation of [false, true]) {
    const closeGate = deferred<void>();
    let closed = false;
    const close = async (): Promise<void> => {
      assert.ok(env.reports.some((report) => report.subtaskId === attempt.subtaskId
        && report.attemptId === attempt.attemptId && report.outcome === "completed"));
      const snapshot = snapshotOf(env.tasks.get(attempt.taskId));
      const reviewEventId = buildLoopPlusFinishEventId(attempt.subtaskId, attempt.attemptId);
      assert.ok(snapshot.currentReview?.eventId === reviewEventId
        || snapshot.reviewQueue.some((review) => review.eventId === reviewEventId));
      await closeGate.promise;
      closed = true;
    };
    const env = harness({ onAttemptCompleted: close });
    const run = env.host.tryRun({ displayPrompt: "完成任务" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["src/alpha.ts"])] }));
    await flush();
    const attempt = env.attempts[0].request;
    if (viaContinuation) {
      env.attempts[0].resolve({ outcome: "stopped", detail: "等待人工续接" });
      await flush();
    }
    const gate = deferred<void>();
    let compactStarted = false;
    const sessionId = viaContinuation ? "continued-session" : "attempt-session";
    await scheduleAutoCompactAfterPrompt({ displayPrompt: "完成子任务", modelPrompt: "完成子任务", contextTags: [], taskRole: "subtask", loopTaskId: attempt.taskId, loopSubtaskId: attempt.subtaskId, loopAttemptId: attempt.attemptId }, { cli: "codex", tabId: "child-tab", sessionId }, async () => {
      assert.equal(closed, true, "the subtask tab must be closed before compaction starts");
      compactStarted = true;
      await gate.promise;
    });
    assert.equal(compactStarted, false);
    let rejectedCloseCalled = false;
    const rejectedClose = async () => { rejectedCloseCalled = true; };
    assert.equal(env.host.notifySubtaskContinuation(attempt.taskId, "unknown-subtask", "completed", "不应关页", undefined, rejectedClose), false);
    assert.equal(env.host.notifySubtaskContinuation(attempt.taskId, attempt.subtaskId, "completed", "过期续接", undefined, rejectedClose, "stale-attempt"), false);
    env.host.reportAttempt(attempt.taskId, { subtaskId: attempt.subtaskId, attemptId: "stale-attempt", outcome: "completed", detail: "过期结果" });
    await flush();
    assert.equal(rejectedCloseCalled, false);
    assert.equal(compactStarted, false);
    if (viaContinuation) {
      assert.equal(env.host.notifySubtaskContinuation(attempt.taskId, attempt.subtaskId, "completed", "已完成续接", undefined, close, attempt.attemptId), true);
    } else {
      env.attempts[0].resolve({ outcome: "completed", detail: "已完成" });
    }
    await flush();
    assert.equal(closed, false);
    assert.equal(compactStarted, false);
    closeGate.resolve();
    await flush();
    assert.equal(compactStarted, true);
    assert.equal(loopSubtaskAutoCompactions.has("codex", sessionId), true);
    assert.equal(env.mains.length, 2);
    assert.equal(env.mains[1].request.kind, "review");
    gate.resolve();
    await loopSubtaskAutoCompactions.wait("codex", sessionId);
    env.host.stopParent(run.taskId ?? "");
    await run.done;
  }
});

test("Loop+ late Codex compaction handoff failure preserves the completed report and active review", { timeout: 5000 }, async (t) => {
  await verifyCompletedCompaction(t);
});

for (const visibility of ["active", "background"] as const) {
  test(`Loop+ completed subtask routes compaction failure through the ${visibility} Webview tab`, { timeout: 5000 }, async (t) => {
    const view = createRunStatusHarness();
    view.activate(visibility === "active" ? "child-tab" : "tab-main");
    await verifyCompletedCompaction(t, view);
  });
}

async function verifyCompletedCompaction(t: import("node:test").TestContext, view?: ReturnType<typeof createRunStatusHarness>): Promise<void> {
  require("../vscodeMock").installVscodeMock();
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "loop-compaction-attribution-"));
  const reportFile = path.join(root, "attempt.json");
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { createIsolatedContextCompactionDeps } = require("../../extensionHost/isolatedContextCompaction") as typeof import("../../extensionHost/isolatedContextCompaction");
  const { withLoopSubtaskSession } = require("../../loopSubtaskSession") as typeof import("../../loopSubtaskSession");
  const { createCodexHandoffError } = require("../../interactive/codexThreadErrors") as typeof import("../../interactive/codexThreadErrors");
  const logger = require("../../logger") as typeof import("../../logger");
  const errors: Array<{ event: string; data: unknown }> = [];
  t.mock.method(logger, "logError", async (event: string, data: unknown) => { errors.push({ event, data }); });
  const env = harness({
    recordAttempt: (report) => {
      fs.writeFileSync(reportFile, JSON.stringify(report));
      if (view) {
        assert.equal(report.outcome, "completed");
        view.run("child-tab", "end");
      }
    },
    adaptMain: (request) => { view?.run(request.target.tabId, "start"); return undefined; },
  });
  const run = env.host.tryRun({ displayPrompt: "review completed work" }, env.target, { schedulingMode: "event_driven" });
  const gate = deferred<{ compacted: boolean; threadId: string }>();
  const started = deferred<void>();
  const statuses: Array<{ tabId: string | null; status: string }> = [];
  const published: unknown[] = [];
  const sessionId = "late-handoff-child-session";
  let attemptId: string | undefined;
  t.after(async () => {
    gate.resolve({ compacted: true, threadId: "thread-child" });
    loopSubtaskAutoCompactions.notify(run.taskId!, "alpha", false, undefined, attemptId);
    await loopSubtaskAutoCompactions.wait("codex", sessionId);
    env.host.stopParent(run.taskId!);
    await run.done;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const unexpected = (): never => { throw new Error("unexpected primary mutation or CLI runner"); };
  const base: import("../../contextCompactionRunner").ContextCompactionRunDeps = {
    getCurrentCli: () => "codex", getActiveConversationTabId: () => "main-tab",
    isInteractiveSupported: () => true, appendSystemMessageForCli: unexpected,
    getCurrentSessionId: () => sessionId, hasActiveProcessOrInteractiveStop: () => true,
    resolveInteractiveSessionForResume: async (_cli, session) => session,
    resolveWorkspaceCwd: () => root, getActiveConfigIdForCli: () => "child-config",
    getSelectedCliModel: () => "child-model", getEffectiveThinkingMode: () => "high",
    getWorkspaceInteractiveMode: () => "coding", applyThinkingWorkspaceFiles: () => {},
    getEffectiveCliArgs: () => [], getCliCommand: () => "controlled-codex",
    resolveClaudeInteractiveEntrypoint: () => undefined, logCliStartup: () => {},
    loadSessionMessages: () => [], createMessageId: () => "background-compact-run",
    beginActiveRunState: unexpected, getActiveRunId: () => "main-review-run",
    setActiveInteractiveStop: unexpected, isActiveInteractiveStop: () => false,
    appendStopMessageToStore: unexpected, killActiveProcess: unexpected, sendRunStatus: unexpected,
    appendCompletionMessage: unexpected, persistActiveMessages: unexpected, clearActiveRun: unexpected,
    interactiveRunnerManager: {
      beginActiveRun: () => {}, endActiveRun: () => {},
      getOrCreateCodexRunner: () => ({ compactThread: () => { started.resolve(); return gate.promise; } }) as never,
      getOrCreateClaudeRunner: unexpected, getOrCreateGrokRunner: unexpected,
      getOrCreateKimiCodeRunner: unexpected, hasKimiCodeRunner: () => false,
      hasZcodeRunner: () => false, waitForPendingDisposal: async () => {},
      getOrCreateZcodeRunner: unexpected, setRunner: unexpected,
    },
    resolveInteractiveMappedId: () => "thread-child", appendSystemMessage: unexpected,
    upsertInteractiveMapping: unexpected, sendRawStreamDelta: unexpected, sendPanelMessage: unexpected,
    updateProcessTitle: unexpected, appendTraceMessage: unexpected, setActiveProcess: unexpected,
    appendAssistantChunk: unexpected, adoptSessionId: unexpected,
  };
  const isolated = createIsolatedContextCompactionDeps(base, {
    saveMessages: () => {}, publishMessage: (message, tabId) => {
      published.push(message);
      view?.send({ type: "appendMessage", message, tabId: tabId ?? undefined });
    },
    publishPanelMessage: (message) => { published.push(message); view?.send(message); },
    sendRunStatus: (tabId, status, message, runOptions) => {
      statuses.push({ tabId, status });
      // Same envelope as the isolated ports in extension.ts; keep the real activity.
      view?.send({ type: "runStatus", tabId: tabId ?? undefined, status, message,
        activity: status === "start" ? runOptions?.activity : undefined });
    },
  });
  await flush();
  view?.run(env.target.tabId, "end");
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["src/alpha.ts"])] }));
  await flush();
  const attempt = env.attempts[0].request;
  attemptId = attempt.attemptId;
  let compacted: boolean | undefined;
  await scheduleAutoCompactAfterPrompt({ displayPrompt: "done", modelPrompt: "done", contextTags: [],
    taskRole: "subtask", loopTaskId: attempt.taskId, loopSubtaskId: attempt.subtaskId, loopAttemptId: attempt.attemptId,
  }, { cli: "codex", tabId: "child-tab", sessionId }, async () => {
    assert.equal(env.reports[0]?.outcome, "completed");
    compacted = await runContextCompactionWithDeps(isolated, { silent: true, cli: "codex", tabId: "child-tab", sessionId });
  });
  view?.run("child-tab", "start");
  env.attempts[0].resolve({ outcome: "completed", detail: "finished, pending acceptance" });
  await started.promise;
  await flush();
  assert.equal(env.mains[1]?.request.kind, "review");
  assert.ok(env.mains[1].request.reviewEventIds?.length);
  const mainViewBeforeFailure = view ? JSON.stringify(view.tabState(env.target.tabId)) : null;
  if (view) {
    assert.deepEqual(view.tabState(env.target.tabId), { running: true, errored: false, activity: "", lastRunStatus: "start" });
    assert.deepEqual(view.tabState("child-tab"), {
      running: true, errored: false, activity: "contextCompaction", lastRunStatus: "start",
    });
    if (view.context.getActiveConversationTabId() === "child-tab") {
      assert.equal(view.elements.runStatusText.textContent, "runStatusCompacting");
      assert.equal(view.elements.runStatusText.classes.has("compacting"), true);
    } else {
      assert.equal(view.context.state.isRunning, true, "the main review remains the active run");
      assert.equal(view.elements.runStatusText.classes.has("compacting"), false);
    }
  }
  const report = fs.readFileSync(reportFile, "utf8");
  const task = JSON.stringify(env.tasks.get(run.taskId!));
  const reports = JSON.stringify(env.reports);
  let continued = false;
  const continuation = withLoopSubtaskSession("codex", sessionId, async () => { continued = true; });
  await withLoopSubtaskSession("codex", "other-session", async () => {});
  assert.equal(continued, false);
  const failure = createCodexHandoffError({ connectionId: 7, threadId: "thread-child", stage: "waiting_close",
    reason: "timeout", rpcMethod: "thread/unsubscribe" });
  gate.reject(failure);
  await continuation;
  assert.equal(compacted, false);
  assert.equal(continued, true);
  assert.equal(base.getActiveRunId(), "main-review-run");
  assert.equal(fs.readFileSync(reportFile, "utf8"), report);
  assert.equal(JSON.stringify(env.tasks.get(run.taskId!)), task);
  assert.equal(JSON.stringify(env.reports), reports);
  assert.equal(env.mains.length, 2);
  assert.deepEqual(statuses, [{ tabId: "child-tab", status: "start" }, { tabId: "child-tab", status: "end" }]);
  assert.deepEqual(published, []);
  assert.deepEqual(errors, [{ event: "context-compact-command-failed", data: {
    cli: "codex", tabId: "child-tab", sessionId, runId: "background-compact-run", activity: "contextCompaction",
    error: failure.message, errorCode: failure.code, silent: true,
  } }]);
  if (view) {
    assert.deepEqual(view.tabState("child-tab"), { running: false, errored: false, activity: "", lastRunStatus: "end" });
    assert.equal(view.elements.runStatusText.classes.has("compacting"), false);
    assert.equal(JSON.stringify(view.tabState(env.target.tabId)), mainViewBeforeFailure);
    // Only a genuinely new prompt produces this execution error; do not turn the compact failure into one.
    view.message("child-tab", "appendMessage", "user", "a new execution");
    view.run("child-tab", "start");
    view.run("child-tab", "error");
    assert.equal(view.tabState("child-tab").errored, true);
    assert.equal(JSON.stringify(view.tabState(env.target.tabId)), mainViewBeforeFailure);
  }
}

test("accept feedback requires evidence but commits long and unordered selected review results", async () => {
  for (const passed of [true, false]) {
    const env = harness();
    const run = env.host.tryRun({
      displayPrompt: "ship the feature",
      loopPlusAcceptancePlan: { id: "plan-a", name: "加严", checks: ["security", "performance"], otherText: "", systemDefault: false },
    }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["src/alpha.ts"])] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "用例命令及结果已写入报告" });
    await flush();
    const eventId = env.mains[1].request.reviewEventId;
    const checks = loopPlusAcceptanceChecksFixture().map((check) => check.name === "tests"
      ? { ...check, passed, detail: passed ? "报告中的回归用例全部通过" : "报告中的回归断言失败" } : check);
    const performanceReason = "对照变更前后调用链，确认没有新增请求、写入和重复扫描。".repeat(4);
    const decision = {
      status: "accept", reviewEventId: eventId,
      progressPercent: 23,
      reviews: [{ reviewEventId: eventId, acceptance: passed ? "passed" : "failed",
        reason: passed ? "回归通过且实现符合需求" : "回归断言失败，尚未满足需求",
        ...(!passed ? { noRepairReason: "此用例仅验证失败反馈记录" } : {}) }],
      acceptance: { passed, checks },
      acceptancePlanResults: [
        { key: "performance", passed: true, reason: performanceReason },
        { key: "security", passed: true, reason: "输入已校验，日志无敏感信息" },
        { key: "other", passed: false, reason: "不属于验收方案" },
      ],
    };
    env.mains[1].resolve(JSON.stringify({ ...decision, reviews: [{ reviewEventId: eventId, acceptance: passed ? "passed" : "failed" }] }));
    await flush();
    assert.equal(env.acceptanceFeedback.length, 0);
    assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.eventId, eventId);
    env.mains[env.mains.length - 1].resolve(JSON.stringify(decision));
    await flush();
    assert.equal(env.acceptanceFeedback.length, 1);
    assert.equal(env.tasks.get(run.taskId ?? "")?.loopPlusProgressPercent, 23);
    const feedback = env.acceptanceFeedback[0];
    assert.equal(feedback.taskId, run.taskId);
    assert.equal(feedback.heading, "验收结果");
    assert.match(feedback.body, passed
      ? /\| 默认验收·测试验证 \| ✅ 报告中的回归用例全部通过 \|/
      : /\| 默认验收·测试验证 \| ❌ 报告中的回归断言失败 \|/);
    assert.match(feedback.body, passed
      ? /\n\n✅ 回归通过且实现符合需求\n\n/
      : /\n\n❌ 回归断言失败，尚未满足需求（无需修复：此用例仅验证失败反馈记录）\n\n/);
    assert.match(feedback.body, /^\*\*子任务：子任务 1：alpha\*\*\n\n/u);
    assert.ok(feedback.body.includes(`**整体验收结果：${passed ? "✅ 通过" : "❌ 未通过"}**`));
    assert.doesNotMatch(feedback.body, /验收事件|\| 整体验收结果/u);
    assert.match(feedback.body, /\| 安全审查 \| ✅ 输入已校验，日志无敏感信息 \|/);
    assert.ok(feedback.body.includes(`| 性能审查 | ✅ ${performanceReason} |`));
    assert.doesNotMatch(feedback.body, /不属于验收方案/u);
    assert.match(feedback.body, /\| 审查内容 \| 审查结果 \|/);
    assert.equal((feedback.body.match(/默认验收·/gu) ?? []).length, 6);
    const metadata = feedback.body.match(/<!-- loop-plus-acceptance:([^\n]*?) -->/u);
    assert.ok(metadata);
    assert.deepEqual(JSON.parse(decodeURIComponent(metadata[1])), [eventId]);
  }
});

test("Loop+ persists assessed acceptance progress, retains it after pause, and completes at 100 percent", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "完成全部任务" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  const taskId = run.taskId ?? "";
  assert.equal(env.tasks.get(taskId)?.loopPlusProgressPercent, 0);
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["src/alpha.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "第一阶段已完成" });
  await flush();
  const accept = env.mains[1];
  accept.resolve(decisionJson({
    status: "accept",
    reviewEventId: accept.request.reviewEventId,
    reviews: [{ reviewEventId: accept.request.reviewEventId, acceptance: "passed", reason: "阶段验收通过" }],
    progressPercent: 23,
    subtasks: [],
  }));
  await flush();
  assert.equal(env.tasks.get(taskId)?.loopPlusProgressPercent, 23);
  assert.match(env.mains[2].request.prompt, /Last overall progress: 23%/);

  env.host.stopParent(taskId);
  await run.done;
  assert.equal(env.tasks.get(taskId)?.loopPlusProgressPercent, 23);
  const resumed = env.host.tryRun(
    { displayPrompt: "完成全部任务" }, env.target,
    { resumeTaskId: taskId, schedulingMode: "event_driven", resumeRequested: true },
  );
  await flush();
  const continuation = env.mains.at(-1);
  assert.ok(continuation);
  assert.match(continuation.request.prompt, /Last overall progress: 23%/);
  continuation.resolve(directCompletionDecision());
  await flush();
  await resumed.done;
  assert.equal(env.tasks.get(taskId)?.status, "completed");
  assert.equal(env.tasks.get(taskId)?.loopPlusProgressPercent, 100);
});

test("parent context keeps verified progress, route, reviews, and frozen order when a continuation cannot read", async () => {
  await assertParentContextContinuation("missing");
});

test("parent context ignores an identity mismatch and withholds acceptance until the same task is readable", async () => {
  await assertParentContextContinuation("mismatch");
});

async function assertParentContextContinuation(fault: "missing" | "mismatch"): Promise<void> {
  const mode: { fault: "none" | "missing" | "mismatch" } = { fault: "none" };
  const env = harness({
    projectReadTask: (task) => {
      if (mode.fault === "none" || !task) return task;
      if (mode.fault === "missing") return null;
      return {
        ...task,
        id: "foreign-task",
        rootPrompt: "FOREIGN_ROOT",
        supplementalRequirements: [],
        loopPlusProgressPercent: 0,
        taskStoreFile: "",
        mainCommunicationFile: "",
        loopSubtaskMode: undefined,
        modelRouting: undefined,
        loopPlusAcceptancePlan: undefined,
      };
    },
  });
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([
    { subtaskId: "alpha", attemptId: "alpha-1", title: "alpha", writeFiles: ["a.ts"] },
    { subtaskId: "beta", attemptId: "beta-1", title: "beta", writeFiles: ["b.ts"] },
  ]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "beta", attemptId: "beta-1", outcome: "completed" });
  const task = baseTask(`parent-context-${fault}`, scheduler.snapshot());
  task.status = "running";
  task.rootPrompt = "root requirement: preserve the public contract";
  task.supplementalRequirements = ["supplemental requirement: keep four reviews"];
  task.loopPlusProgressPercent = 78;
  task.taskStoreFile = "/synthetic/parent/loop-tasks.json";
  task.communicationDir = "/synthetic/parent";
  task.mainCommunicationFile = "/synthetic/parent/main.md";
  task.loopSubtaskMode = "fullstack";
  task.modelRouting = {
    main: { cli: "codex", model: "main-model" },
    subtask: { cli: "grok", model: "legacy-model" },
    subtaskFullstack: { cli: "grok", model: "full-model" },
  };
  task.loopPlusAcceptancePlan = {
    id: "plan-four",
    name: "加强方案",
    checks: ["maintainability", "security", "performance", "ui_aesthetics"],
    otherText: "",
    systemDefault: false,
  };
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, { resumeTaskId: task.id });
  await flush();
  const review = env.mains[0];
  const frozenIds = review.request.reviewEventIds?.slice() ?? [];
  assert.equal(frozenIds.length, 2);
  assertParentContextPrompt(review.request.prompt, frozenIds);
  assert.equal(env.logs.some((item) => item.event === "loop-plus-parent-context"), false);

  mode.fault = fault;
  review.resolve("{");
  await flush();
  const correction = env.mains[1];
  assert.match(correction.request.prompt, /Loop\+ 继续执行/);
  assert.deepEqual(correction.request.reviewEventIds, frozenIds);
  assertParentContextPrompt(correction.request.prompt, frozenIds);
  assert.doesNotMatch(correction.request.prompt, /FOREIGN_ROOT|legacyAtomic|Last overall progress: 0%/);

  correction.resolve(frozenAccept(frozenIds));
  await flush();
  const retried = env.mains[2];
  assert.deepEqual(retried.request.reviewEventIds, frozenIds);
  assertParentContextPrompt(retried.request.prompt, frozenIds);
  assert.equal(env.tasks.get(task.id)?.loopPlusProgressPercent, 78);
  assert.equal(env.acceptanceFeedback.length, 0);
  assert.equal(snapshotOf(env.tasks.get(task.id)).currentReview?.eventId, frozenIds[0]);
  const contextLogs = env.logs.filter((item) => item.event === "loop-plus-parent-context");
  assert.ok(contextLogs.length > 0);
  const expectedCode = fault === "missing" ? "record-unreadable" : "identity-mismatch";
  assert.ok(contextLogs.some((item) => (item.payload as { stage?: string; code?: string }).stage === "parent-context"
    && (item.payload as { code?: string }).code === expectedCode));
  assert.ok(contextLogs.some((item) => (item.payload as { stage?: string }).stage === "decision-validation"));
  const withheld = contextLogs.find((item) => (item.payload as { stage?: string }).stage === "acceptance-submit");
  assert.ok(withheld);
  const payload = withheld.payload as {
    code?: string;
    taskPresent?: boolean;
    identityMatched?: boolean;
    frozenContextPresent?: boolean;
    frozenPrefixIntact?: boolean;
    acceptancePlanPresent?: boolean;
    routePresent?: boolean;
    progressPresent?: boolean;
    rootPresent?: boolean;
    authoritative?: boolean;
    acceptanceSubmitted?: boolean;
    fieldKnown?: boolean;
  };
  assert.equal(payload.code, expectedCode);
  assert.equal((withheld.payload as { taskId?: string }).taskId, task.id);
  assert.equal(payload.taskPresent, fault === "mismatch");
  assert.equal(payload.identityMatched, false);
  assert.equal(payload.frozenContextPresent, true);
  assert.equal(payload.frozenPrefixIntact, true);
  assert.equal(payload.acceptancePlanPresent, true);
  assert.equal(payload.routePresent, true);
  assert.equal(payload.progressPresent, true);
  assert.equal(payload.rootPresent, true);
  assert.equal(payload.authoritative, false);
  assert.equal(payload.acceptanceSubmitted, false);
  assert.equal(payload.fieldKnown, false);
  for (const item of contextLogs) {
    const text = JSON.stringify(item.payload);
    assert.equal(text.includes("/synthetic"), false);
    assert.equal(text.includes("FOREIGN_ROOT"), false);
    assert.equal(text.includes("full-model"), false);
    assert.equal(text.includes("root requirement"), false);
    assert.equal(text.includes("78"), false);
  }

  mode.fault = "none";
  retried.resolve(frozenAccept(frozenIds));
  await flush();
  assert.equal(env.tasks.get(task.id)?.loopPlusProgressPercent, 81);
  assert.equal(env.acceptanceFeedback.length, 1);
  assert.equal(snapshotOf(env.tasks.get(task.id)).currentReview, null);
  env.host.stopParent(task.id);
  await run.done;
}

function assertParentContextPrompt(prompt: string, frozenIds: readonly string[]): void {
  assert.match(prompt, /root requirement: preserve the public contract/);
  assert.match(prompt, /supplemental requirement: keep four reviews/);
  assert.match(prompt, /\/synthetic\/parent\/main\.md/);
  assert.match(prompt, /\/synthetic\/parent\/loop-tasks\.json/);
  assert.match(prompt, /Last overall progress: 78%/);
  assert.match(prompt, /mode=fullstack coding=grok \/ full-model analysis=codex \/ main-model/);
  assert.doesNotMatch(prompt, /legacyAtomic/);
  assert.match(prompt, /maintainability, security, performance, ui_aesthetics/);
  assert.match(prompt, /Maintainability review:/);
  assert.match(prompt, /Performance review:/);
  assert.match(prompt, /Security review:/);
  assert.match(prompt, /User experience review:/);
  const batch = prompt.split("Acceptance batch, frozen host-selected order")[1]?.split("Review queue count")[0] ?? "";
  const positions = frozenIds.map((id) => batch.indexOf(id));
  assert.ok(positions[0] >= 0 && positions[1] > positions[0]);
}

function frozenAccept(reviewEventIds: readonly string[]): string {
  return decisionJson({
    status: "accept",
    reviewEventIds,
    progressPercent: 81,
    reviews: reviewEventIds.map((reviewEventId) => ({
      reviewEventId,
      acceptance: "passed",
      reason: "实现与证据均符合要求",
    })),
    acceptancePlanResults: [
      { key: "maintainability", passed: true, reason: "结构保持可读" },
      { key: "security", passed: true, reason: "没有新增敏感日志" },
      { key: "performance", passed: true, reason: "没有新增热路径扫描" },
      { key: "ui_aesthetics", passed: true, reason: "本次无界面变更" },
    ],
    subtasks: [],
  });
}

test("completed without subtask events only summarizes and never writes an acceptance table", async () => {
  for (const withPlan of [false, true]) {
    const env = harness();
    const run = env.host.tryRun({
      displayPrompt: "ship the feature",
      ...(withPlan ? {
        loopPlusAcceptancePlan: { id: "security", name: "安全审查", checks: ["security"] as const, otherText: "", systemDefault: false },
      } : {}),
    }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.mains[0].resolve(completedDecision(withPlan ? {
      acceptancePlanResults: [{ key: "security", passed: true, reason: "输入边界已核对" }],
    } : {}));
    await flush();
    assert.equal(env.acceptanceFeedback.length, 0);
    assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
    assert.equal(env.tasks.get(run.taskId ?? "")?.answerConclusion, "finished");
    assert.equal(env.tasks.get(run.taskId ?? "")?.finalSummary, "everything passed");
  }
});

test("parent completion attention fires only after persisted closeout, not after subtask execution", async () => {
  const completed: string[] = [];
  const env = harness({ onTaskCompleted: (taskId) => {
    assert.equal(env.tasks.get(taskId)?.status, "completed");
    completed.push(taskId);
  } });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["src/alpha.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  assert.deepEqual(completed, []);
  const review = env.mains[env.mains.length - 1];
  review.resolve(completedDecision({ reviewEventIds: review.request.reviewEventIds }));
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  await run.done;
  assert.deepEqual(completed, [run.taskId]);
  await env.host.tryRun({ displayPrompt: "already done" }, env.target, { resumeTaskId: run.taskId }).done;
  assert.deepEqual(completed, [run.taskId]);
});

test("completion attention waits for a failed final persistence to be retried", async () => {
  const completed: string[] = [];
  let failFinalWrite = true;
  const env = harness({
    onTaskCompleted: (taskId) => { completed.push(taskId); },
    beforeUpdateTask: (patch) => {
      if (patch.status === "completed" && failFinalWrite) {
        failFinalWrite = false;
        throw new Error("final write failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(completedDecision());
  await run.done;
  assert.deepEqual(completed, []);
  assert.notEqual(env.tasks.get(run.taskId ?? "")?.status, "completed");
  await env.host.tryRun({ displayPrompt: "retry final write" }, env.target, { resumeTaskId: run.taskId }).done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.deepEqual(completed, [run.taskId]);
});

test("a completion attention failure cannot fail the completed parent task", async () => {
  const env = harness({ onTaskCompleted: () => { throw new Error("native failure"); } });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(completedDecision());
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.equal(env.logs.some((entry) => entry.event === "loop-plus-completion-notification-failed"), true);
});

test("accept followed by completed closeout writes only one subtask acceptance table", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch", subtasks: [{ ...subtask("alpha", ["src/alpha.ts"]), title: "重构规则表" }],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "实现与回归通过" });
  await flush();
  env.mains.at(-1)!.resolve(decisionJson({ status: "accept", reviewEventIds: env.mains.at(-1)!.request.reviewEventIds }));
  await flush();
  assert.equal(env.acceptanceFeedback.length, 1);
  assert.match(env.acceptanceFeedback[0].body, /^\*\*子任务：子任务 1：重构规则表\*\*/u);
  assert.equal(env.mains.at(-1)?.request.kind, "closeout");
  env.mains.at(-1)!.resolve(completedDecision());
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.equal(env.acceptanceFeedback.length, 1);
});

test("completed can directly accept a batch and names every subtask above one table", async () => {
  const env = harness();
  const task = baseTask("complete-batch", twoFinishedReviews());
  task.subTasks = [
    { id: "beta", title: "后端接口", status: "completed", updatedAt: 1 },
    { id: "alpha", title: "前端表单", status: "completed", updatedAt: 1 },
  ];
  env.tasks.set(task.id, task);
  env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, { resumeTaskId: task.id, schedulingMode: "event_driven" });
  await flush();
  const main = env.mains.at(-1)!;
  assert.equal(main.request.reviewEventIds?.length, 2);
  main.resolve(completedDecision({ reviewEventIds: main.request.reviewEventIds }));
  await flush();
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  assert.equal(env.acceptanceFeedback.length, 1);
  assert.match(env.acceptanceFeedback[0].body, /^\*\*子任务：子任务 2：前端表单、子任务 1：后端接口\*\*\n\n\*\*整体验收结果：✅ 通过\*\*/u);
  assert.doesNotMatch(env.acceptanceFeedback[0].body, /验收事件/u);
});

test("restored reviewed attempts suppress only closeout feedback, not a new attempt", async () => {
  for (const newAttempt of [false, true]) {
    const env = harness();
    const scheduler = createLoopPlusScheduler({ snapshot: twoFinishedReviews() });
    const ids = [scheduler.snapshot().currentReview!.eventId, ...scheduler.snapshot().reviewQueue.map((item) => item.eventId)];
    assert.equal(scheduler.submitReviewBatch(ids, [
      { eventId: ids[0], acceptance: "failed" },
      { eventId: ids[1], acceptance: "passed" },
    ]).ok, true);
    if (newAttempt) {
      scheduler.dispatch([{ subtaskId: "alpha", attemptId: "a2", writeFiles: ["src/alpha.ts"] }]);
      scheduler.finish({ subtaskId: "alpha", attemptId: "a2", outcome: "completed" });
    }
    const task = baseTask(`restored-${newAttempt}`, scheduler.snapshot());
    task.subTasks = [{ id: "alpha", title: "规则表修复", status: "completed", updatedAt: 1 }];
    env.tasks.set(task.id, task);
    env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
      resumeTaskId: task.id, resumeRequested: true, schedulingMode: "event_driven",
    });
    await flush();
    const main = env.mains.at(-1)!;
    main.resolve(completedDecision(newAttempt ? { reviewEventIds: main.request.reviewEventIds } : {}));
    await flush();
    assert.equal(env.tasks.get(task.id)?.status, "completed");
    assert.equal(env.acceptanceFeedback.length, newAttempt ? 1 : 0);
    if (newAttempt) {
      assert.match(env.acceptanceFeedback[0].body, /^\*\*子任务：子任务 1：规则表修复\*\*/u);
    }
  }
});

test("refreshes concurrency from the configured dispatch limit when continuing live or restored parents", async () => {
  for (const reload of [false, true]) {
    let maximum = 6;
    const env = harness({ decisionSubtaskMax: () => maximum });
    const initial = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    assert.match(env.mains[0].request.modelPrompt, /Scheduler concurrency limit: 6/);
    env.host.stopParent(initial.taskId ?? "");
    await initial.done;
    maximum = 10;
    const host = reload ? env.reloadHost() : env.host;
    const resumed = host.tryRun({ displayPrompt: "continue" }, env.target, {
      resumeTaskId: initial.taskId,
      resumeRequested: true,
    });
    await flush();
    assert.match(env.mains.at(-1)?.request.modelPrompt ?? "", /Scheduler concurrency limit: 10/);
    env.mains.at(-1)?.resolve(decisionJson({
      status: "dispatch",
      subtasks: Array.from({ length: 10 }, (_, index) => subtask(`item-${index}`, [`src/item-${index}.ts`])),
    }));
    await flush();
    assert.equal(env.attempts.length, 10);
    assert.equal(snapshotOf(env.tasks.get(initial.taskId ?? "")).maxConcurrency, 10);
    host.stopParent(initial.taskId ?? "");
    await resumed.done;
  }
});

test("refreshes capacity when the dispatch limit changes during an active main call", async () => {
  let maximum = 6;
  const env = harness({ decisionSubtaskMax: () => maximum });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  maximum = 10;
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: Array.from({ length: 10 }, (_, index) => subtask(`item-${index}`, [`src/item-${index}.ts`])),
  }));
  await flush();
  try {
    assert.equal(env.attempts.length, 10);
    assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).maxConcurrency, 10);
    env.attempts[0].resolve({ outcome: "completed", detail: "done" });
    await flush();
    assert.match(env.mains.at(-1)!.request.modelPrompt, /Scheduler concurrency limit: 10/);
    assert.match(env.mains.at(-1)!.request.modelPrompt, /Decision subtask limit: 10/);
  } finally {
    env.host.stopParent(run.taskId ?? "");
    await run.done;
  }
});

test("refreshes pending admission on a finish notification while honoring explicit host limits", async () => {
  for (const hostLimit of [undefined, 3]) {
    let maximum = 2;
    const env = harness({ decisionSubtaskMax: () => maximum, maxConcurrency: hostLimit });
    const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.mains[0].resolve(decisionJson({
      status: "dispatch", subtasks: [subtask("a", ["src/a.ts"]), subtask("b", ["src/b.ts"])],
    }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "done" });
    await flush();
    const review = env.mains.at(-1)!;
    review.resolve(acceptWithIndependentWork(review.request.reviewEventIds!, [subtask("c", ["src/c.ts"]), subtask("d", ["src/d.ts"])]));
    await flush();
    const snapshotBefore = snapshotOf(env.tasks.get(run.taskId ?? ""));
    maximum = 10;
    env.attempts[1].resolve({ outcome: "completed", detail: "done" });
    await flush();
    try {
      const snapshot = snapshotOf(env.tasks.get(run.taskId ?? ""));
      assert.equal(snapshot.maxConcurrency, hostLimit ?? 10);
      assert.equal(snapshot.pending.length, 0);
      assert.equal(env.attempts.length, 4);
      assert.deepEqual(snapshot.seenAttempts.map((item) => item.attemptId), snapshotBefore.seenAttempts.map((item) => item.attemptId));
      assert.match(env.mains.at(-1)!.request.modelPrompt, new RegExp(`Scheduler concurrency limit: ${hostLimit ?? 10}`));
      assert.match(env.mains.at(-1)!.request.modelPrompt, /Decision subtask limit: 10/);
    } finally {
      env.host.stopParent(run.taskId ?? "");
      await run.done;
    }
  }
});

test("lowering the active dispatch limit preserves running work and drains to the new capacity", async () => {
  let maximum = 6;
  const env = harness({ decisionSubtaskMax: () => maximum });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: Array.from({ length: 6 }, (_, index) => subtask(`item-${index}`, [`src/item-${index}.ts`])),
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "done" });
  await flush();
  maximum = 2;
  const review = env.mains.at(-1)!;
  review.resolve(acceptWithIndependentWork(review.request.reviewEventIds!, [subtask("next-a", ["src/next-a.ts"]), subtask("next-b", ["src/next-b.ts"])]));
  await flush();
  try {
    assert.equal(env.attempts.length, 6, "do not backfill while already above the new limit");
    assert.equal(env.abortedAttemptIds.length, 0);
    assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).pending.length, 2);
    for (let index = 1; index <= 4; index += 1) {
      env.attempts[index].resolve({ outcome: "completed", detail: "done" });
      await flush();
      assert.equal(env.attempts.length, index < 4 ? 6 : 7);
      assert.doesNotThrow(() => createLoopPlusScheduler({ snapshot: snapshotOf(env.tasks.get(run.taskId ?? "")) }));
    }
    const snapshot = snapshotOf(env.tasks.get(run.taskId ?? ""));
    assert.equal(snapshot.maxConcurrency, 2);
    assert.equal(snapshot.running.length, 2);
    assert.equal(snapshot.pending.length, 1);
  } finally {
    env.host.stopParent(run.taskId ?? "");
    await run.done;
  }
});

test("uses the configured Loop+ dispatch subtask maximum", async () => {
  const limited = harness({ decisionSubtaskMax: () => 1 });
  limited.host.tryRun({ displayPrompt: "ship the feature" }, limited.target, { schedulingMode: "event_driven" });
  await flush();
  assert.match(limited.mains[0].request.modelPrompt, /1 to 1 new self-contained subtasks/);
  limited.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(limited.attempts.length, 0);
  assert.equal(limited.logs.some((item) => item.event === "loop-plus-protocol-miss"), true);

  const raised = harness({ decisionSubtaskMax: () => 10 });
  raised.host.tryRun({ displayPrompt: "ship the feature" }, raised.target, { schedulingMode: "event_driven" });
  await flush();
  assert.match(raised.mains[0].request.modelPrompt, /1 to 10 new self-contained subtasks/);
  assert.match(raised.mains[0].request.modelPrompt, /Scheduler concurrency limit: 10/);
  raised.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: Array.from({ length: 10 }, (_, index) => subtask(`item-${index}`, [`src/item-${index}.ts`])),
  }));
  await flush();
  assert.equal(raised.attempts.length, 10);
});

test("keeps the main task decomposing until the initial Loop+ decision is accepted", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains[0]?.request.kind, "initial");
  assert.equal(env.tasks.get(run.taskId ?? "")?.loopPlusMainPhase, "decomposing");
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.tasks.get(run.taskId ?? "")?.loopPlusMainPhase, undefined);
  assert.notEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).phase, "idle");
});

test("starts one main review when A finishes while B is still running", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains.length, 1);
  assert.equal(env.mains[0].request.kind, "initial");
  assert.match(env.mains[0].request.modelPrompt, /Review queue count: 0/);
  assert.match(env.mains[0].request.modelPrompt, /keep the public API stable/);
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 2);
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const reviews = env.mains.filter((item) => item.request.kind === "review");
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].request.reviewEventId, buildLoopPlusFinishEventId("alpha", alpha.request.attemptId));
  assert.equal(env.maxMains(), 1);
  const task = env.tasks.get(run.taskId ?? "");
  assert.deepEqual(task?.activeSubtaskIds, ["beta"]);
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(task).running.map((item) => item.subtaskId), ["beta"]);
  assert.equal(beta.request.attemptId.length > 0, true);
});

test("freezes the active acceptance batch and reviews later completions in the next FIFO batch", async () => {
  const env = harness({ maxConcurrency: 3 });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [
      subtask("alpha", ["src/alpha.ts"]),
      subtask("beta", ["src/beta.ts"]),
      subtask("gamma", ["src/gamma.ts"]),
    ],
  }));
  await flush();
  assert.equal(env.attempts.length, 3);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const reviews = () => env.mains.filter((item) => item.request.kind === "review");
  assert.equal(reviews().length, 1);
  env.attempts[1].resolve({ outcome: "completed", detail: "beta" });
  env.attempts[2].resolve({ outcome: "failed", detail: "gamma" });
  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "cover the new failure"), true);
  await flush();
  assert.equal(reviews().length, 1);
  assert.equal(env.activeMains(), 1);
  const alphaEventId = buildLoopPlusFinishEventId("alpha", env.attempts[0].request.attemptId);
  const betaEventId = buildLoopPlusFinishEventId("beta", env.attempts[1].request.attemptId);
  const gammaEventId = buildLoopPlusFinishEventId("gamma", env.attempts[2].request.attemptId);
  const first = reviews()[0];
  assert.deepEqual(first.request.reviewEventIds, [alphaEventId]);
  assert.equal(first.request.userMessageCount, 0);
  assert.deepEqual(env.host.getActiveReviewEventIds(run.taskId ?? ""), [alphaEventId]);
  first.resolve(decisionJson({ status: "accept", reviewEventId: alphaEventId }));
  await flush();
  assert.equal(reviews().length, 2);
  const second = reviews()[1];
  assert.deepEqual(second.request.reviewEventIds, [betaEventId, gammaEventId]);
  assert.deepEqual(env.host.getActiveReviewEventIds(run.taskId ?? ""), [betaEventId, gammaEventId]);
  assert.match(second.request.prompt, /cover the new failure/);
  second.resolve(decisionJson({
    status: "accept",
    reviewEventIds: [betaEventId, gammaEventId],
    reviews: [
      { reviewEventId: betaEventId, acceptance: "passed", reason: "beta completed" },
      { reviewEventId: gammaEventId, acceptance: "failed", reason: "gamma execution failed", noRepairReason: "此测试只验证批次结算" },
    ],
    subtasks: [],
  }));
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(snapshotOf(task).currentReview, null);
  assert.equal(snapshotOf(task).reviewQueue.length, 0);
  assert.deepEqual(snapshotOf(task).userMessageQueue, []);
  assert.equal(snapshotOf(task).seenAttempts.filter((item) => item.disposition === "reviewed").length, 3);
  assert.equal(env.maxMains(), 1);
});

function finishedReviewTask(id: string, count: number, previousRounds = 0): LoopTaskRecord {
  const scheduler = reviewedRoundsScheduler(previousRounds, count);
  const specs = Array.from({ length: count }, (_, index) => ({
    subtaskId: `finished-${index}`, attemptId: `attempt-${index}`, writeFiles: [`src/finished-${index}.ts`],
  }));
  scheduler.dispatch(specs);
  for (const spec of specs) scheduler.finish({ ...spec, outcome: "completed" });
  const task = baseTask(id, scheduler.snapshot());
  task.subTasks = specs.map((spec) => ({ id: spec.subtaskId, title: spec.subtaskId, status: "completed", updatedAt: 1 }));
  return task;
}

test("reviews a restored backlog in FIFO batches of at most four and completes without filler dispatches", async () => {
  for (const reload of [false, true]) {
    const env = harness();
    const task = finishedReviewTask(`bounded-reviews-${reload}`, 8);
    env.tasks.set(task.id, task);
    let host = env.host;
    let run = host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
      resumeTaskId: task.id, schedulingMode: "event_driven",
    });
    await flush();
    assert.doesNotMatch(env.mains[0].request.prompt, /One-time dispatch-first check/);
    const allIds = Array.from({ length: 8 }, (_, index) => buildLoopPlusFinishEventId(`finished-${index}`, `attempt-${index}`));
    let confirmed = 0;
    for (const count of [4, 4]) {
      if (reload && confirmed === 4) {
        host.stopParent(task.id);
        await run.done;
        host = env.reloadHost();
        run = host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
          resumeTaskId: task.id, resumeRequested: true,
        });
        await flush();
      }
      const main = env.mains.at(-1)!;
      const expected = allIds.slice(confirmed, confirmed + count);
      assert.equal(main.request.kind, "review");
      if (reload && confirmed === 4) {
        assert.doesNotMatch(main.request.prompt, /One-time dispatch-first check/);
      } else if (!reload && confirmed === 4) {
        assert.match(main.request.prompt, /One-time dispatch-first check/);
      }
      assert.deepEqual(main.request.reviewEventIds, expected);
      assert.deepEqual(host.getActiveReviewEventIds(task.id), expected);
      assert.equal(snapshotOf(env.tasks.get(task.id)).reviewQueue.length, 8 - confirmed - 1,
        "items beyond this batch remain in the scheduler FIFO");
      main.resolve(completedDecision({ reviewEventIds: expected }));
      await flush();
      confirmed += count;
      assert.equal(snapshotOf(env.tasks.get(task.id)).seenAttempts.filter((item) => item.disposition === "reviewed").length, confirmed);
      assert.equal(env.tasks.get(task.id)?.status, confirmed === 8 ? "completed" : "running");
      assert.equal(env.attempts.length, 0, "finishing the goal does not require filling configured slots");
    }
    assert.equal(env.acceptanceFeedback.length, 2);
    assert.equal(env.maxMains(), 1);
    await run.done;
  }
});

test("rejects confirmation beyond four and fills configured slots before reviewing the remaining FIFO", async () => {
  const env = harness();
  const task = finishedReviewTask("bounded-refill", 5);
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
    resumeTaskId: task.id, schedulingMode: "event_driven",
  });
  await flush();
  const allIds = Array.from({ length: 5 }, (_, index) => buildLoopPlusFinishEventId(`finished-${index}`, `attempt-${index}`));
  env.mains[0].resolve(decisionJson({ status: "accept", reviewEventIds: allIds.slice(0, 5) }));
  await flush();
  const retry = env.mains.at(-1)!;
  assert.deepEqual(retry.request.reviewEventIds, allIds.slice(0, 4));
  assert.equal(snapshotOf(env.tasks.get(task.id)).seenAttempts.some((item) => item.disposition === "reviewed"), false);
  const deliveries = Array.from({ length: 5 }, (_, index) => subtask(`new-${index}`, [`src/new-${index}.ts`]));
  retry.resolve(decisionJson({
    status: "accept", reviewEventIds: allIds.slice(0, 4),
    reviews: allIds.slice(0, 4).map((reviewEventId, index) => ({
      reviewEventId, acceptance: index === 0 ? "failed" : "passed", reason: index === 0 ? "边界分支遗漏" : "实现与验证符合要求",
      ...(index === 0 ? { subtaskIds: ["finished-0"] } : {}),
    })),
    acceptance: { passed: false, checks: loopPlusAcceptanceChecksFixture().map((check) => ({ ...check, passed: false })) },
    subtasks: [subtask("finished-0", ["src/finished-0.ts"]), ...deliveries],
    independentSubtaskIds: deliveries.map((item) => item.id),
  }));
  await flush();
  const snapshot = snapshotOf(env.tasks.get(task.id));
  assert.equal(snapshot.running.length, 6, "review batch size does not limit dispatch or runtime capacity");
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["finished-0", ...deliveries.map((item) => item.id)]);
  assert.equal(env.attempts[0].request.continueFromSubtaskId, "finished-0");
  assert.equal(env.attempts.slice(1).every((item) => item.request.continueFromSubtaskId === undefined), true);
  assert.deepEqual(env.mains.at(-1)!.request.reviewEventIds, allIds.slice(4));
  assert.deepEqual(env.host.getActiveReviewEventIds(task.id), allIds.slice(4));
  assert.equal(env.tasks.get(task.id)?.status, "running");
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 1);
  env.host.stopParent(task.id);
  await run.done;
});

test("reviews the entire backlog regardless of historical dispatch count", async () => {
  const env = harness();
  const task = finishedReviewTask("unlimited-history", 5, 46);
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
    resumeTaskId: task.id, schedulingMode: "event_driven",
  });
  await flush();
  assert.equal(env.mains[0].request.reviewEventIds?.length, 4);
  env.mains[0].resolve(decisionJson({ status: "accept", reviewEventIds: env.mains[0].request.reviewEventIds }));
  await flush();
  assert.equal(env.mains[1].request.reviewEventIds?.length, 1);
  env.mains[1].resolve(completedDecision({ reviewEventIds: env.mains[1].request.reviewEventIds }));
  await run.done;
  assert.equal(snapshotOf(env.tasks.get(task.id)).seenAttempts.filter((item) => item.disposition === "reviewed").length, 51);
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  assert.equal(env.messages.includes("loop-plus-subtask-round-limit"), false);
});

test("waits without a new dispatch or another main prompt while work is still running", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = env.mains[1];
  const before = env.mains.length;
  review.resolve(decisionJson({ status: "accept", reviewEventId: review.request.reviewEventId }));
  await flush();
  assert.equal(env.mains.length, before);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.deepEqual(env.tasks.get(run.taskId ?? "")?.activeSubtaskIds, ["beta"]);
  assert.equal(env.messages.includes("loop-plus-waiting") || env.tasks.get(run.taskId ?? "")?.status === "running", true);
  assert.equal(env.tasks.get(run.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.currentRound ?? 0, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.rounds.length ?? 0, 0);
});

test("keeps conflict and concurrency limits when new work is added beside a running attempt", async () => {
  const env = harness({ maxConcurrency: 2 });
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src\\shared.ts"]), subtask("beta", ["src/shared.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0].request.subtaskId, "alpha");
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = env.mains[1];
  review.resolve(acceptWithIndependentWork(review.request.reviewEventIds!, [
    subtask("gamma", ["src/gamma.ts"]), subtask("delta", ["src/delta.ts"]), subtask("epsilon", ["src/epsilon.ts"]),
  ]));
  await flush();
  const started = env.attempts.map((item) => item.request.subtaskId);
  assert.deepEqual(started, ["alpha", "beta", "gamma"]);
  assert.equal(env.attempts.length, 3);
  const task = Array.from(env.tasks.values())[0];
  assert.equal(snapshotOf(task).running.length <= 2, true);
  assert.equal(snapshotOf(task).pending.length >= 1, true);
});

test("fills six production slots while serializing only a conflicting follow-up", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship independent deliverables" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.match(env.mains[0].request.modelPrompt, /Scheduler concurrency limit: 6/);
  assert.match(env.mains[0].request.modelPrompt, /Available concurrency slots in this snapshot: 6/);
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: Array.from({ length: 6 }, (_, index) => subtask(`delivery-${index}`, [`src/delivery-${index}.ts`])),
  }));
  await flush();
  assert.equal(env.attempts.length, 6);
  const task = () => env.tasks.get(run.taskId ?? "")!;
  assert.equal(snapshotOf(task()).running.length, 6);
  env.attempts[0].resolve({ outcome: "completed", detail: "delivery-0 ready" });
  await flush();
  const review = env.mains[1];
  assert.match(review.request.modelPrompt, /Available concurrency slots in this snapshot: 1/);
  review.resolve(acceptWithIndependentWork(review.request.reviewEventIds!, [
    subtask("shared-follow-up", ["src\\delivery-1.ts"]),
    subtask("independent-follow-up", ["src/independent-follow-up.ts"]),
  ]));
  await flush();
  assert.equal(env.attempts.length, 7);
  assert.equal(env.attempts[6].request.subtaskId, "independent-follow-up");
  assert.equal(snapshotOf(task()).running.length, 6);
  assert.deepEqual(snapshotOf(task()).pending.map((item) => item.subtaskId), ["shared-follow-up"]);
  env.attempts[1].resolve({ outcome: "completed", detail: "delivery-1 ready" });
  await flush();
  assert.equal(env.attempts.length, 8);
  assert.equal(env.attempts[7].request.subtaskId, "shared-follow-up");
  assert.equal(snapshotOf(task()).running.length, 6);
  assert.equal(snapshotOf(task()).pending.length, 0);
});

test("accept repairs the original member beside independent remaining-goal deliveries", async () => {
  const env = harness({ maxConcurrency: 3 });
  const run = env.host.tryRun({ displayPrompt: "修复验收缺口并完成其余独立交付" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("original", ["src/original.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "验收发现校验遗漏" });
  await flush();
  const review = env.mains[1];
  review.resolve(decisionJson({
    status: "accept", reviewEventId: review.request.reviewEventId,
    reviews: [{ reviewEventId: review.request.reviewEventId, acceptance: "failed", reason: "校验分支遗漏", subtaskIds: ["original"] }],
    subtasks: [subtask("original", ["src/original.ts"]), subtask("feature", ["src/feature.ts"]), subtask("docs", ["docs/usage.md"])],
    independentSubtaskIds: ["feature", "docs"],
    acceptance: { passed: false, checks: loopPlusAcceptanceChecksFixture().map((check) => ({ ...check, passed: false })) },
  }));
  await flush();
  assert.deepEqual(env.attempts.slice(1).map((item) => item.request.subtaskId), ["original", "feature", "docs"]);
  assert.equal(env.attempts[1].request.continueFromSubtaskId, "original");
  assert.equal(env.attempts[2].request.continueFromSubtaskId, undefined);
  assert.equal(env.attempts[3].request.continueFromSubtaskId, undefined);
  assert.equal(snapshotOf(env.tasks.get(taskId)).running.length, 3);
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts[0].acceptance, "failed");
  assert.equal(env.tasks.get(taskId)?.status, "running");

  env.attempts[2].resolve({ outcome: "completed", detail: "独立功能完成并通过针对性验证" });
  await flush();
  const featureReview = env.mains[2];
  assert.equal(featureReview.request.kind, "review");
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).running.map((item) => item.subtaskId), ["original", "docs"]);
  featureReview.resolve(completedDecision({ reviewEventId: featureReview.request.reviewEventId }));
  await flush();
  assert.equal(env.tasks.get(taskId)?.status, "running", "live repair and independent work still prevent parent completion");

  env.attempts[1].resolve({ outcome: "completed", detail: "遗漏已修复，针对性验证通过" });
  env.attempts[3].resolve({ outcome: "completed", detail: "使用说明已交付" });
  await flush();
  for (let index = 0; index < 3 && env.tasks.get(taskId)?.status !== "completed"; index += 1) {
    const next = env.mains.at(-1)!;
    const ids = next.request.reviewEventIds ?? [];
    const confirmation = ids.length === 1 ? { reviewEventId: ids[0] } : ids.length > 1 ? { reviewEventIds: ids } : {};
    next.resolve(completedDecision(confirmation));
    await flush();
  }
  assert.equal(env.tasks.get(taskId)?.status, "completed");
  assert.equal(env.messages.includes("loop-plus-protocol-paused"), false);
  await run.done;
});

for (const conflict of ["writeFiles", "conflictGroup", "capacity"] as const) {
  test(`independent accept delivery preserves ${conflict} reservations while safe work backfills`, async () => {
    const env = harness({ maxConcurrency: conflict === "capacity" ? 2 : 4 });
    const run = env.host.tryRun({ displayPrompt: "有边界地并行交付" }, env.target, { schedulingMode: "event_driven" });
    const taskId = run.taskId ?? "";
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
      subtask("original", ["src/original.ts"]), subtask("owner", ["src/shared.ts"], "shared-resource"),
    ] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "发现可修复遗漏" });
    await flush();
    const review = env.mains[1];
    review.resolve(decisionJson({
      status: "accept", reviewEventId: review.request.reviewEventId,
      reviews: [{ reviewEventId: review.request.reviewEventId, acceptance: "failed", subtaskIds: ["original"] }],
      subtasks: [
        subtask("original", ["src/original.ts"]),
        subtask("reserved", conflict === "writeFiles" ? ["src\\shared.ts"] : ["src/reserved.ts"], conflict === "conflictGroup" ? "shared-resource" : undefined),
        subtask("independent", ["docs/independent.md"]),
      ],
      independentSubtaskIds: ["reserved", "independent"],
    }));
    await flush();
    const snapshot = () => snapshotOf(env.tasks.get(taskId));
    assert.equal(env.attempts[2].request.subtaskId, "original");
    if (conflict === "capacity") {
      assert.deepEqual(snapshot().pending.map((item) => item.subtaskId), ["reserved", "independent"]);
      assert.equal(snapshot().running.length, 2);
    } else {
      assert.equal(env.attempts[3].request.subtaskId, "independent", "safe work bypasses the blocked independent delivery");
      assert.deepEqual(snapshot().pending.map((item) => item.subtaskId), ["reserved"]);
      assert.equal(snapshot().running.length, 3);
    }
    env.attempts[1].resolve({ outcome: "completed", detail: "共享资源释放" });
    await flush();
    assert.equal(env.attempts.at(-1)?.request.subtaskId, "reserved");
    assert.ok(snapshot().running.some((item) => item.subtaskId === "original"));
    assert.equal(env.tasks.get(taskId)?.status, "running");
    env.host.stopParent(taskId);
    await run.done;
  });
}

test("records each accept review without failing a successful sibling", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alphaAttempt = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const betaAttempt = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alphaAttempt && betaAttempt);
  alphaAttempt.resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  betaAttempt.resolve({ outcome: "completed", detail: "beta" });
  await flush();
  const reviews = () => env.mains.filter((item) => item.request.kind === "review");
  const alphaEventId = buildLoopPlusFinishEventId("alpha", alphaAttempt.request.attemptId);
  const betaEventId = buildLoopPlusFinishEventId("beta", betaAttempt.request.attemptId);
  const batch = reviews().at(-1);
  assert.ok(batch);
  assert.deepEqual(batch.request.reviewEventIds, [alphaEventId]);
  assert.equal(batch.abortCount, 0, "later finishes stay queued without aborting the active review");
  batch.resolve(decisionJson({
    status: "accept",
    reviewEventId: alphaEventId,
    reviews: [{ reviewEventId: alphaEventId, acceptance: "passed", subtaskIds: ["follow-up"] }],
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    subtasks: [subtask("follow-up", ["src/follow-up.ts"])],
  }));
  await flush();
  const taskId = run.taskId ?? "";
  const seen = (subtaskId: string) => snapshotOf(env.tasks.get(taskId)).seenAttempts.find((item) => item.subtaskId === subtaskId);
  assert.equal(seen("alpha")?.outcome, "completed");
  assert.equal(seen("alpha")?.acceptance, "passed");
  assert.equal(seen("beta")?.outcome, "completed");
  assert.equal(seen("beta")?.acceptance, undefined);
  assert.equal(seen("follow-up")?.acceptance, undefined);
  assert.equal(env.tasks.get(taskId)!.subTasks.some((item) => item.id === "repair"), false, "later queued review cannot authorize a repair early");
  assert.equal(env.tasks.get(taskId)!.subTasks.find((item) => item.id === "follow-up")!.repairSource, undefined);

  assert.equal(reviews().filter((item) => item.request.reviewEventIds?.includes(alphaEventId) === true).length, 1);
  const betaReview = reviews().at(-1);
  assert.ok(betaReview);
  assert.deepEqual(betaReview.request.reviewEventIds, [betaEventId]);
  assert.equal(reviews().filter((item) => item.request.reviewEventIds?.includes(betaEventId) === true).length, 1);
  betaReview.resolve(decisionJson({
    status: "accept",
    reviewEventId: betaEventId,
    reviews: [{ reviewEventId: betaEventId, acceptance: "failed", subtaskIds: ["beta"] }],
    acceptance: {
      passed: false,
      checks: loopPlusAcceptanceChecksFixture().map((check) => ({ ...check, passed: false })),
    },
    subtasks: [subtask("beta", ["src/repair.ts"])],
  }));
  await flush();

  assert.equal(env.tasks.get(taskId)!.subTasks.some((item) => item.id === "repair"), false);
  assert.ok(env.tasks.get(taskId)!.subTasks.some((item) => item.id === "beta"));

  const repairAttempt = env.attempts.find((item) => item.request.subtaskId === "beta" && item.request.attemptId !== betaAttempt.request.attemptId);
  assert.ok(repairAttempt);
  repairAttempt.resolve({ outcome: "completed", detail: "repair" });
  await flush();
  const repairReview = reviews().at(-1);
  assert.ok(repairReview);
  assert.notEqual(repairReview, betaReview);
  assert.deepEqual(repairReview.request.reviewEventIds, [buildLoopPlusFinishEventId("beta", repairAttempt.request.attemptId)]);
  repairReview.resolve(decisionJson({
    status: "accept",
    reviewEventId: repairReview.request.reviewEventId,
    reviews: [{ reviewEventId: repairReview.request.reviewEventId, acceptance: "passed" }],
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    subtasks: [],
  }));
  await flush();
  assert.equal(seen("alpha")?.acceptance, "passed");
  assert.equal(seen("beta")?.acceptance, "failed");
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts.filter((item) => item.subtaskId === "beta").at(-1)?.acceptance, "passed");
  assert.equal(seen("beta")?.acceptance, "failed");
  assert.equal(reviews().filter((item) => item.request.reviewEventIds?.includes(alphaEventId) === true).length, 1);
  env.host.stopParent(taskId);
  await run.done;
});

test("does not complete from a stale review after another finish joins the batch", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const stale = env.mains[1];
  env.attempts[1].resolve({ outcome: "completed", detail: "beta" });
  await flush();
  const reviews = () => env.mains.filter((item) => item.request.kind === "review");
  assert.equal(reviews().length, 1);
  const alphaEventId = buildLoopPlusFinishEventId("alpha", env.attempts[0].request.attemptId);
  const betaEventId = buildLoopPlusFinishEventId("beta", env.attempts[1].request.attemptId);
  assert.deepEqual(reviews()[0].request.reviewEventIds, [alphaEventId]);
  stale.resolve(decisionJson({
    status: "completed",
    reviewEventId: alphaEventId,
    answerConclusion: "finished",
    finalSummary: "everything passed",
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    requirementCoverage: [{ name: "scope", passed: true }],
  }));
  await flush();
  assert.notEqual(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.equal(reviews().length, 2);
  assert.deepEqual(reviews()[1].request.reviewEventIds, [betaEventId]);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.eventId, betaEventId);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts.find((item) => item.subtaskId === "alpha")?.disposition, "reviewed");
  reviews()[1].resolve(decisionJson({ status: "accept", reviewEventId: betaEventId }));
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts.filter((item) => item.disposition === "reviewed").length, 2);
  env.host.stopParent(run.taskId ?? "");
  await run.done;
});

test("ignores duplicate and stale attempt callbacks", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  const first = env.attempts[0];
  first.resolve({ outcome: "completed", detail: "first" });
  await flush();
  const reviewCount = env.mains.filter((item) => item.request.kind === "review").length;
  env.host.reportAttempt(run.taskId ?? "", {
    subtaskId: "alpha",
    attemptId: first.request.attemptId,
    outcome: "failed",
    detail: "duplicate",
  });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, reviewCount);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.attemptId, first.request.attemptId);
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: env.mains[1].request.reviewEventId }));
  await flush();
  const closeout = env.mains.find((item) => item.request.kind === "closeout");
  assert.ok(closeout);
  closeout.resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha-next.ts"])],
  }));
  await flush();
  const second = env.attempts[1];
  assert.notEqual(second.request.attemptId, first.request.attemptId);
  const runningBefore = snapshotOf(env.tasks.get(run.taskId ?? "")).running.map((item) => item.attemptId);
  env.host.reportAttempt(run.taskId ?? "", {
    subtaskId: "alpha",
    attemptId: first.request.attemptId,
    outcome: "stopped",
    detail: "stale",
  });
  await flush();
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).running.map((item) => item.attemptId), runningBefore);
});

test("stops the parent gate before cancelling attempts and resumes without reviving them", async () => {
  const env = harness({ maxConcurrency: 2 });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 2);
  const beforeStop = env.attempts.map((item) => item.request.attemptId);
  env.host.stopParent(run.taskId ?? "");
  await flush();
  assert.deepEqual(env.closeTabAttemptIds, []);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).parentStopped, true);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "stopped");
  assert.equal(env.tasks.get(run.taskId ?? "")?.schedulingMode, "event_driven");
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    schedulingMode: "classic",
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).parentStopped, false);
  const revived = env.attempts.filter((item) => !beforeStop.includes(item.request.attemptId));
  assert.deepEqual(revived, []);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length > 0, true);
});

test("does not block an immediate review behind the launch throttle", async () => {
  let releaseDelay: (() => void) | null = null;
  const env = harness({
    maxConcurrency: 1,
    launchDelayMs: (last) => last === null ? 0 : 60_000,
    delay: () => new Promise((resolve) => {
      releaseDelay = resolve;
    }),
  });
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(env.attempts.length, 1);
  assert.equal(typeof releaseDelay, "function");
});

test("rejects a damaged event_driven snapshot without downgrading or clearing it", async () => {
  const env = harness();
  const damaged = baseTask("damaged");
  damaged.loopPlus = { version: 1, broken: true };
  env.tasks.set(damaged.id, damaged);
  const run = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    schedulingMode: "classic",
    resumeTaskId: damaged.id,
    resumeRequested: true,
  });
  await flush();
  assert.equal(run.handled, true);
  assert.equal(env.tasks.get(damaged.id)?.status, "error");
  assert.equal(env.tasks.get(damaged.id)?.schedulingMode, "event_driven");
  assert.deepEqual(env.tasks.get(damaged.id)?.loopPlus, damaged.loopPlus);
  assert.equal(env.attempts.length, 0);
  assert.equal(env.mains.length, 0);
  const missing = baseTask("missing");
  delete missing.loopPlus;
  env.tasks.set(missing.id, missing);
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: missing.id,
    resumeRequested: true,
    schedulingMode: "event_driven",
  });
  await flush();
  assert.equal(env.tasks.get(missing.id)?.status, "error");
  assert.equal(Object.prototype.hasOwnProperty.call(env.tasks.get(missing.id), "loopPlus"), false);
  assert.equal(env.tasks.get(missing.id)?.schedulingMode, "event_driven");
});

test("model switch resumes interrupted attempts once without disturbing running attempts", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "实现功能" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])] }));
  await flush();
  const taskId = run.taskId ?? "";
  const attemptId = env.attempts[0].request.attemptId;
  env.host.resumeInterruptedSubtasks(taskId);
  assert.equal(env.attempts.length, 2);
  env.attempts[0].resolve({ outcome: "stopped", detail: "stopped" });
  await flush();
  env.host.resumeInterruptedSubtasks(taskId);
  env.host.resumeInterruptedSubtasks(taskId);
  await flush();
  assert.equal(env.attempts.length, 3);
  assert.equal(env.attempts[2].request.attemptId, attemptId);
  assert.equal(env.attempts[2].request.subtaskId, "alpha");
  assert.equal(snapshotOf(env.tasks.get(taskId)).running.length, 2);
  assert.equal(env.reports.length, 0);
  env.attempts[2].resolve({ outcome: "completed", detail: "切换后完成" });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(snapshotOf(env.tasks.get(taskId)).currentReview?.attemptId, attemptId);
});

test("model switch reconstructs a cold controller and resumes its interrupted reservation", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "实现功能" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["src/alpha.ts"])] }));
  await flush();
  const taskId = run.taskId ?? "";
  const attemptId = env.attempts[0].request.attemptId;
  env.attempts[0].resolve({ outcome: "stopped", detail: "stopped" });
  await flush();
  const cold = env.reloadHost();
  assert.equal(cold.resumeInterruptedSubtasks(taskId), false);
  cold.tryRun({ displayPrompt: "继续" }, env.target, { resumeTaskId: taskId, resumeRequested: true });
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.equal(env.attempts[1].request.attemptId, attemptId);
  assert.equal(env.tasks.get(taskId)?.subTasks[0].status, "running");
  assert.equal(cold.resumeInterruptedSubtasks(taskId), false);
  await flush();
  assert.equal(env.attempts.length, 2);
});

test("cold split frontend resume preserves its role and new frontend model", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([{ subtaskId: "front", attemptId: "front-1", title: "前端", writeFiles: ["src/ui.ts"], taskType: "frontend" }]);
  const task = baseTask("split-cold", scheduler.snapshot());
  task.loopSubtaskMode = "split";
  task.modelRouting = {
    main: { model: "new-main" }, subtask: { cli: "codex", configId: "backend-config", model: "new-backend" },
    subtaskFrontend: { cli: "opencode", configId: "frontend-config", model: "new-frontend" },
  };
  task.subTasks = [{ id: "front", title: "前端", prompt: longPrompt("前端", ["src/ui.ts"]), taskType: "frontend", writeFiles: ["src/ui.ts"], status: "blocked" }];
  env.tasks.set(task.id, task);
  assert.equal(env.host.resumeInterruptedSubtasks(task.id), false);
  env.host.tryRun({ displayPrompt: "继续", loopSubtaskFrontendModel: "cached-frontend" }, env.target, {
    resumeTaskId: task.id, resumeRequested: true,
  });
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0].request.attemptId, "front-1");
  assert.equal(env.attempts[0].request.targetCli, "opencode");
  assert.equal(env.attempts[0].request.execution?.role, "frontend");
  assert.equal(env.attempts[0].request.execution?.model, "new-frontend");
  assert.equal(env.tasks.get(task.id)?.subTasks[0].taskType, "frontend");
});

test("manual interruption keeps an open reservation until a successful continuation notification", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/shared.ts"]), subtask("beta", ["src/shared.ts"])],
  }));
  await flush();
  const taskId = run.taskId ?? "";
  const attemptId = env.attempts[0].request.attemptId;
  env.attempts[0].resolve({ outcome: "stopped", detail: "stopped" });
  await flush();
  const interrupted = env.tasks.get(taskId);
  assert.equal(interrupted?.subTasks.find((item) => item.id === "alpha")?.status, "blocked");
  assert.equal(snapshotOf(interrupted).running[0]?.attemptId, attemptId);
  assert.equal(snapshotOf(interrupted).seenAttempts[0]?.disposition, "open");
  assert.equal(snapshotOf(interrupted).currentReview, null);
  assert.equal(snapshotOf(interrupted).reviewQueue.length, 0);
  assert.equal(env.mains.length, 1);
  assert.equal(env.reports.length, 0);
  assert.equal(env.attempts.length, 1);
  assert.equal(await isSettled(run.done), false);

  env.host.reportAttempt(taskId, { subtaskId: "alpha", attemptId, outcome: "stopped" });
  env.host.tryRun({ displayPrompt: "continue" }, env.target, { resumeTaskId: taskId, resumeRequested: true });
  await flush();
  assert.equal(snapshotOf(env.tasks.get(taskId)).currentReview, null);
  assert.equal(env.mains.length, 1);
  assert.equal(env.attempts.length, 1);

  assert.equal(env.host.notifySubtaskContinuation(taskId, "alpha", "completed", "stale continuation", undefined, undefined, "older-attempt"), false);
  env.host.notifySubtaskContinuation(taskId, "alpha", "completed", "resumed successfully", undefined, undefined, attemptId);
  env.host.notifySubtaskContinuation(taskId, "alpha", "completed", "duplicate", undefined, undefined, attemptId);
  await flush();
  assert.equal(snapshotOf(env.tasks.get(taskId)).currentReview?.attemptId, attemptId);
  assert.equal(env.mains.length, 2);
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0].outcome, "completed");
  assert.equal(env.attempts.length, 2);
});

test("restored interrupted reservations survive reconciliation and allow independent reviews", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
  scheduler.dispatch([
    { subtaskId: "alpha", attemptId: "alpha-1", writeFiles: ["src/alpha.ts"] },
    { subtaskId: "beta", attemptId: "beta-1", writeFiles: ["src/beta.ts"] },
  ]);
  scheduler.finish({ subtaskId: "beta", attemptId: "beta-1", outcome: "completed" });
  const task = baseTask("restored-interruption", scheduler.snapshot());
  task.subTasks = [
    { id: "alpha", title: "alpha", status: "blocked", updatedAt: 1 },
    { id: "beta", title: "beta", status: "completed", updatedAt: 1 },
  ];
  env.tasks.set(task.id, task);
  const restored = env.reloadHost();
  restored.tryRun({ displayPrompt: "continue" }, env.target, { resumeTaskId: task.id, resumeRequested: true });
  await flush();
  assert.equal(env.mains.length, 1);
  assert.equal(env.mains[0].request.reviewEventId, buildLoopPlusFinishEventId("beta", "beta-1"));
  assert.match(env.mains[0].request.modelPrompt, /Interrupted subtasks awaiting continuation: alpha/);
  assert.equal(snapshotOf(env.tasks.get(task.id)).running[0]?.subtaskId, "alpha");
  env.mains[0].resolve(decisionJson({
    status: "accept",
    reviewEventId: buildLoopPlusFinishEventId("beta", "beta-1"),
    subtasks: [],
  }));
  await flush();
  assert.equal(env.mains.length, 1);
  assert.equal(snapshotOf(env.tasks.get(task.id)).seenAttempts.find((item) => item.subtaskId === "alpha")?.disposition, "open");
  restored.notifySubtaskContinuation(task.id, "alpha", "completed", "continued after restore");
  await flush();
  assert.equal(env.mains.length, 2);
  assert.equal(env.mains[1].request.reviewEventId, buildLoopPlusFinishEventId("alpha", "alpha-1"));
});

for (const requiresAcceptance of [true, false]) {
  const stopTiming = requiresAcceptance ? "cold stop after checkpoint" : "warm stop before checkpoint";
  test(`cold stop completion receipt: ${stopTiming} preserves ${requiresAcceptance ? "acceptance" : "report FIFO"}`, async () => {
    let refuseSettlement = false;
    let cleanupCount = 0;
    const env = harness({
      maxConcurrency: 1,
      deferAttemptAbort: true,
      onAttemptCompleted: async () => { cleanupCount += 1; },
      beforeUpdateTask: (patch) => {
        const snapshot = patch.loopPlus as LoopPlusSchedulerSnapshot | undefined;
        if (refuseSettlement && snapshot?.seenAttempts.some((item) => item.outcome === "completed")) {
          throw new Error("settlement unavailable");
        }
      },
    });
    const run = env.host.tryRun({ displayPrompt: "implement" }, env.target, { schedulingMode: "event_driven" });
    const taskId = run.taskId!;
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
      { ...subtask("done", ["src/done.ts"]), requiresAcceptance },
      subtask("pending", ["src/pending.ts"]),
    ] }));
    await flush();
    assert.deepEqual(env.attempts.map(({ request }) => request.subtaskId), ["done"]);
    const attemptId = env.attempts[0].request.attemptId;
    const eventId = buildLoopPlusFinishEventId("done", attemptId);
    const detail = "result committed by the runner";
    if (!requiresAcceptance) env.host.stopParent(taskId);
    refuseSettlement = true;
    env.attempts[0].resolve({ outcome: "completed", detail });
    await flush();
    await run.done;
    const before = env.tasks.get(taskId)!;
    assert.deepEqual(before.loopPlusAttemptCompletionReceipts, [{ subtaskId: "done", attemptId, detail }]);
    assert.equal(snapshotOf(before).parentStopped, !requiresAcceptance);
    assert.deepEqual(snapshotOf(before).running.map((item) => item.attemptId), [attemptId]);
    assert.deepEqual(snapshotOf(before).pending.map((item) => item.subtaskId), ["pending"]);
    assert.equal(env.reports.length, 1);

    const cold = env.reloadHost();
    assert.throws(() => cold.stopParent(taskId), /settlement unavailable/);
    assert.equal(env.tasks.get(taskId), before);
    refuseSettlement = false;
    cold.stopParent(taskId);
    const stopped = env.tasks.get(taskId)!;
    const snapshot = snapshotOf(stopped);
    assert.equal(stopped.status, "stopped");
    assert.equal(snapshot.parentStopped, true);
    assert.equal(snapshot.currentReview, null);
    assert.deepEqual(snapshot.running, []);
    assert.deepEqual(stopped.activeSubtaskIds, []);
    assert.equal(stopped.activeSubtaskId, null);
    assert.deepEqual(snapshot.pending, snapshotOf(before).pending);
    assert.equal(stopped.loopPlusAttemptCompletionReceipts, undefined);
    assert.equal(stopped.subTasks.find((item) => item.id === "done")?.status, "completed");
    assert.equal(stopped.subTasks.find((item) => item.id === "done")?.summary, detail);
    const finishEvent = { eventId, subtaskId: "done", attemptId, outcome: "completed", detail };
    assert.deepEqual(snapshot.reviewQueue ?? [], requiresAcceptance ? [finishEvent] : []);
    assert.deepEqual(snapshot.reportQueue ?? [], requiresAcceptance ? [] : [finishEvent]);

    const observer = env.reloadHost();
    observer.stopParent(taskId);
    observer.stopParent(taskId);
    assert.deepEqual(snapshotOf(env.tasks.get(taskId)), snapshot);
    assert.equal(env.mainCalls(), 1);
    assert.equal(env.attempts.length, 1);
    assert.equal(env.reports.length, 1);
    assert.equal(cleanupCount, 0);

    const resumed = observer.tryRun({ displayPrompt: "continue" }, env.target, { resumeTaskId: taskId, resumeRequested: true });
    await flush();
    assert.equal(env.mainCalls(), 2);
    assert.deepEqual(env.mains[1].request.reviewEventIds, requiresAcceptance ? [eventId] : []);
    assert.deepEqual(env.mains[1].request.reportEventIds, requiresAcceptance ? [] : [eventId]);
    assert.deepEqual(env.attempts.map(({ request }) => request.subtaskId), ["done", "pending"]);
    observer.stopParent(taskId);
    env.attempts[1].resolve({ outcome: "stopped", detail: "test cleanup" });
    await flush();
    await resumed.done;
  });
}

test("cold stop completion receipt rejects ambiguous and stale evidence and preserves receipt FIFO", () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 12 });
  const ids = ["prior", "failed", "stopped", "first", "second", "duplicate", "ambiguous", "mismatch", "foreign"];
  scheduler.dispatch(ids.map((id) => ({ subtaskId: id, attemptId: `${id}-1`, requiresAcceptance: false })));
  scheduler.finish({ subtaskId: "prior", attemptId: "prior-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "failed", attemptId: "failed-1", outcome: "failed", detail: "original failure" });
  scheduler.finish({ subtaskId: "stopped", attemptId: "stopped-1", outcome: "stopped", detail: "original stop" });
  const task = baseTask("cold-stop-invalid-receipts", scheduler.snapshot());
  task.loopPlusAttemptCompletionReceipts = [
    ["second", "second-1"], ["duplicate", "duplicate-1"], ["first", "first-1"], ["duplicate", "duplicate-1"],
    ["ambiguous", "ambiguous-1"], ["other", "ambiguous-1"], ["other", "mismatch-1"],
    ["failed", "failed-1"], ["stopped", "stopped-1"], ["unknown", "unknown-1"],
  ].map(([subtaskId, attemptId]) => ({ subtaskId, attemptId, detail: "receipt" }));
  const other = baseTask("other-task");
  other.loopPlusAttemptCompletionReceipts = [{ subtaskId: "foreign", attemptId: "foreign-1", detail: "different task" }];
  env.tasks.set(other.id, other);
  env.tasks.set(task.id, task);
  env.reloadHost().stopParent(task.id);
  const stopped = env.tasks.get(task.id)!;
  const snapshot = snapshotOf(stopped);
  assert.equal(snapshot.parentStopped, true);
  assert.deepEqual(snapshot.running, []);
  assert.deepEqual(snapshot.reportQueue?.map((item) => item.subtaskId), ["prior", "second", "first"]);
  assert.deepEqual([snapshot.currentReview, ...snapshot.reviewQueue].map((item) => [item?.subtaskId, item?.outcome, item?.detail]), [
    ["failed", "failed", "original failure"], ["stopped", "stopped", "original stop"],
    ["duplicate", "stopped", "lost-process"], ["ambiguous", "stopped", "lost-process"],
    ["mismatch", "stopped", "lost-process"], ["foreign", "stopped", "lost-process"],
  ]);
  assert.equal(stopped.loopPlusAttemptCompletionReceipts, undefined);
  assert.equal(env.tasks.get(other.id), other);
  assert.equal(env.mainCalls(), 0);
  assert.deepEqual(env.attempts, []);
});

test("原子任务与句柄已不存在时，显式继续结算残留预留并保留旧验收，允许重新派发", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 3 });
  scheduler.dispatch([
    { subtaskId: "reviewed-later", attemptId: "prior-1", writeFiles: ["src/old.ts"] },
    { subtaskId: "missing-a", attemptId: "lost-2", writeFiles: ["src/a.ts"] },
    { subtaskId: "missing-b", attemptId: "lost-3", writeFiles: ["src/b.ts"] },
  ]);
  scheduler.finish({ subtaskId: "reviewed-later", attemptId: "prior-1", outcome: "completed", detail: "原验收证据" });
  scheduler.stopParent();
  const task = baseTask("missing-stopped-children", scheduler.snapshot());
  task.status = "stopped";
  assert.deepEqual(task.subTasks, []);
  env.tasks.set(task.id, task);
  env.host.tryRun({ displayPrompt: "继续" }, env.target, { resumeTaskId: task.id, resumeRequested: true });
  await flush();
  const snapshot = snapshotOf(env.tasks.get(task.id));
  assert.equal(snapshot.running.length, 0);
  assert.equal(snapshot.parentStopped, false);
  assert.equal(env.messages.includes("loop-plus-resume-blocked"), false);
  const events = [snapshot.currentReview!, ...snapshot.reviewQueue];
  assert.equal(events.length, 3);
  assert.equal(events[0].detail, "原验收证据");
  assert.deepEqual(events.slice(1).map((item) => [item.outcome, item.detail]), [["stopped", "lost-process"], ["stopped", "lost-process"]]);
  env.mains[0].resolve(decisionJson({
    status: "accept",
    reviewEventIds: events.map((item) => item.eventId),
    reviews: events.map((item) => item.outcome === "completed"
      ? { reviewEventId: item.eventId, acceptance: "passed", reason: "原验收证据有效" }
      : { reviewEventId: item.eventId, acceptance: "failed", reason: "原子任务句柄已丢失", noRepairReason: "旧 attempt 无法恢复，后续使用新子任务重新派发" }),
    independentSubtaskIds: ["replacement"],
    subtasks: [subtask("replacement", ["src/b.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0].request.subtaskId, "replacement");
  assert.equal(env.tasks.get(task.id)?.status, "running");
  env.host.stopParent(task.id);
  await flush();
});

test("does not let a subtask continuation revive a finished attempt", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.host.notifySubtaskContinuation(run.taskId ?? "", "alpha", "completed", "from subtab");
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview, null);
  assert.equal(env.attempts.length, 1);
  env.attempts[0].resolve({ outcome: "completed", detail: "runner" });
  await flush();
  const attemptId = env.attempts[0].request.attemptId;
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.attemptId, attemptId);
  env.host.notifySubtaskContinuation(run.taskId ?? "", "alpha", "completed", "again");
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).running.length, 0);
});

async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await flush();
  return settled;
}

test("resume after stopping the unanswered initial main issues exactly one executable main", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains.length, 1);
  env.host.stopParent(run.taskId ?? "");
  await flush();
  assert.equal(await isSettled(run.done), true);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    schedulingMode: "classic",
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(env.mains.length, 2);
  assert.equal(env.mains[1].request.kind, "continue");
  assert.equal(task?.status, "running");
  assert.equal(snapshotOf(task).phase, "idle");
  assert.equal(snapshotOf(task).parentStopped, false);
  assert.equal(env.attempts.length, 0);
  assert.equal(await isSettled(continued.done), false);
  await flush();
  assert.equal(env.mains.length, 2);
  env.mains[1].resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "hold" }));
  await flush();
  env.mains[2].resolve(decisionJson({ status: "blocked", finalSummary: "hold" }));
  await flush();
  assert.equal(await isSettled(continued.done), true);
  assert.equal(env.attempts.length, 0);
});

test("ignores a late initial decision that returns after stop and explicit resume", async () => {
  const env = harness({ deferMainAbort: true });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.host.stopParent(run.taskId ?? "");
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  env.mains[0].releaseAbort(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 0);
  assert.equal(env.mains.length, 2);
  assert.equal(env.mains[1].request.kind, "continue");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).running.length, 0);
  assert.equal(await isSettled(continued.done), false);
  await flush();
  assert.equal(env.mains.length, 2);
});

test("does not confirm a review when its old main result arrives after resume", async () => {
  const env = harness({ deferMainAbort: true });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "real result" });
  await flush();
  const review = env.mains[1];
  const eventId = review.request.reviewEventId;
  env.host.stopParent(run.taskId ?? "");
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  review.releaseAbort(decisionJson({ status: "accept", reviewEventId: eventId, subtasks: [] }));
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "closeout").length, 0);
  assert.equal(env.attempts.length, 1);
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(snapshotOf(task).currentReview?.eventId, eventId);
  assert.equal(snapshotOf(task).currentReview?.outcome, "completed");
  assert.notEqual(task?.status, "completed");
});

test("settles an already completed snapshot without occupying the controller", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
  assert.equal(scheduler.complete().ok, true);
  const task = baseTask("completed-task", scheduler.snapshot());
  task.status = "completed";
  task.finalSummary = "already done";
  env.tasks.set(task.id, task);
  const first = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    schedulingMode: "classic",
    resumeTaskId: task.id,
    resumeRequested: true,
  });
  const second = env.host.tryRun({ displayPrompt: "continue again" }, env.target, {
    resumeTaskId: task.id,
    resumeRequested: true,
  });
  assert.equal(await isSettled(first.done), true);
  assert.equal(await isSettled(second.done), true);
  assert.equal(env.host.hasController(task.id), false);
  assert.equal(env.mains.length, 0);
  assert.equal(env.attempts.length, 0);
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  assert.equal(env.tasks.get(task.id)?.finalSummary, "already done");
  assert.equal(snapshotOf(env.tasks.get(task.id)).phase, "completed");
  env.host.stopParent(task.id);
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  assert.equal(snapshotOf(env.tasks.get(task.id)).completed, true);
});

test("does not let a rejected duplicate or stale finish rewrite records or reports", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "real result" });
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  const alpha = () => stored()?.subTasks.find((item) => item.id === "alpha");
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0].detail, "real result");
  assert.equal(alpha()?.summary, "real result");
  assert.equal(alpha()?.status, "completed");
  assert.equal(snapshotOf(stored()).currentReview?.outcome, "completed");
  assert.equal(snapshotOf(stored()).currentReview?.detail, "real result");
  const updatedAt = stored()?.updatedAt;
  env.host.reportAttempt(taskId, {
    subtaskId: "alpha",
    attemptId: env.attempts[0].request.attemptId,
    outcome: "failed",
    detail: "stale overwrite",
  });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(alpha()?.summary, "real result");
  assert.equal(alpha()?.status, "completed");
  assert.notEqual(stored()?.status, "blocked");
  assert.equal(snapshotOf(stored()).currentReview?.outcome, "completed");
  assert.equal(snapshotOf(stored()).currentReview?.detail, "real result");
  assert.equal(stored()?.updatedAt, updatedAt);
  env.host.reportAttempt(taskId, {
    subtaskId: "missing",
    attemptId: "unknown-attempt",
    outcome: "failed",
    detail: "unknown",
  });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(stored()?.subTasks.some((item) => item.id === "missing"), false);
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: env.mains[1].request.reviewEventId, subtasks: [] }));
  await flush();
  const closeout = env.mains.find((item) => item.request.kind === "closeout");
  assert.ok(closeout);
  closeout.resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha-next.ts"])],
  }));
  await flush();
  const retry = env.attempts[1];
  assert.notEqual(retry.request.attemptId, env.attempts[0].request.attemptId);
  const runningBefore = snapshotOf(stored()).running.map((item) => item.attemptId);
  const reportsBefore = env.reports.length;
  const summaryBefore = alpha()?.summary;
  env.host.reportAttempt(taskId, {
    subtaskId: "alpha",
    attemptId: env.attempts[0].request.attemptId,
    outcome: "failed",
    detail: "stale overwrite",
  });
  await flush();
  assert.deepEqual(snapshotOf(stored()).running.map((item) => item.attemptId), runningBefore);
  assert.equal(env.reports.length, reportsBefore);
  assert.equal(alpha()?.summary, summaryBefore);
  assert.notEqual(alpha()?.status, "blocked");
  assert.equal(alpha()?.summary === "stale overwrite", false);
});

test("keeps the running task meta when a same-id dispatch is rejected", async () => {
  const env = harness({
    prepareCommunication: (_task, subtask) => `/reports/${subtask.id}.md`,
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"], "beta-group")],
  }));
  await flush();
  const taskId = run.taskId ?? "";
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatched").length, 1);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected").length, 0);
  const stored = () => env.tasks.get(taskId);
  const beta = stored()?.subTasks.find((item) => item.id === "beta");
  assert.ok(beta);
  beta.summary = "beta summary";
  env.attempts.find((item) => item.request.subtaskId === "alpha")?.resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  review.resolve(decisionJson({
    status: "accept",
    reviewEventId: review.request.reviewEventId,
    reviews: [{ reviewEventId: review.request.reviewEventId, acceptance: "passed", subtaskIds: ["beta"] }],
    subtasks: [{
      id: "beta",
      title: "REJECTED replacement B",
      prompt: longPrompt("REJECTED replacement B", ["src/evil.ts"]),
      writeFiles: ["src/evil.ts"],
      conflictGroup: "evil-group",
    }],
  }));
  await flush();
  const nextBeta = stored()?.subTasks.find((item) => item.id === "beta");
  assert.equal(nextBeta?.title, "beta");
  assert.equal(nextBeta?.prompt, longPrompt("beta", ["src/beta.ts"]));
  assert.deepEqual(nextBeta?.writeFiles, ["src/beta.ts"]);
  assert.equal(nextBeta?.conflictGroup, "beta-group");
  assert.equal(nextBeta?.communicationFile, "/reports/beta.md");
  assert.equal(nextBeta?.summary, "beta summary");
  assert.equal(nextBeta?.status, "running");
  assert.equal(snapshotOf(stored()).running.find((item) => item.subtaskId === "beta")?.title, "beta");
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "beta").length, 1);
  assert.equal(env.logs.some((item) => {
    const rejected = (item.payload as { rejected?: Array<{ subtaskId?: string; reason?: string }> } | undefined)?.rejected;
    return item.event === "loop-plus-dispatched" && rejected?.some((entry) => entry.subtaskId === "beta" && entry.reason === "active_subtask");
  }), true);
  const dispatchRejections = env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected");
  assert.equal(dispatchRejections.length, 1);
  assert.deepEqual(dispatchRejections[0]?.payload, {
    rejectedCount: 1,
    reasonCounts: { active_subtask: 1 },
  });
  const rejectionText = JSON.stringify(dispatchRejections[0]?.payload);
  assert.equal(rejectionText.includes("beta"), false);
  assert.equal(rejectionText.includes(taskId), false);
  assert.equal(rejectionText.includes("src/evil.ts"), false);
  assert.equal(rejectionText.includes("REJECTED replacement"), false);
  const correction = env.mains.at(-1)!;
  assert.notEqual(correction, review);
  assert.equal(correction.request.kind, "continue");
  assert.match(correction.request.prompt, /state\.dispatch\.rejected/);
  assert.match(correction.request.prompt, /不得重复 accept/);
});

async function openDispatchFirstReview(env: ReturnType<typeof harness>, subtasks: LoopSubtaskDecision[]) {
  const run = env.host.tryRun({ displayPrompt: "先派发再验收" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks }));
  await flush();
  const finished = env.attempts.find((item) => item.request.subtaskId === subtasks[0]?.id);
  assert.ok(finished);
  finished.resolve({ outcome: "completed", detail: "首项完成" });
  await flush();
  const review = env.mains.at(-1)!;
  assert.equal(review.request.kind, "review");
  assert.match(review.request.prompt, /One-time dispatch-first check/);
  return { run, taskId, review };
}

function rejectionPayloadText(env: ReturnType<typeof harness>): string {
  return JSON.stringify(env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected").map((item) => item.payload));
}

test("logs one redacted summary when the temporary scheduler preview rejects", async () => {
  const env = harness();
  const opened = await openDispatchFirstReview(env, [subtask("first", ["src/first.ts"])]);
  const { run, taskId, review } = opened;
  assert.equal(env.attempts[0].request.attemptId, "lp1-first");
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected").length, 0);
  const before = JSON.stringify(snapshotOf(env.tasks.get(taskId)));
  const secretId = "preview-secret-child";
  const secretDependency = "missing-preview-secret";
  const secretFile = "src/preview-secret-evil.ts";
  review.resolve(decisionJson({
    status: "dispatch",
    subtasks: [{
      ...subtask(secretId, [secretFile]),
      dependsOn: [secretDependency],
      prompt: `${longPrompt(secretId, [secretFile])} PROMPT_PREVIEW_SECRET`,
    }],
    nextStepPlan: { objective: "预检拒绝后保持冻结批次" },
  }));
  await flush();
  const rejections = env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected");
  assert.equal(rejections.length, 1);
  assert.deepEqual(rejections[0]?.payload, {
    rejectedCount: 1,
    reasonCounts: { invalid_dependencies: 1 },
  });
  const text = rejectionPayloadText(env);
  assert.equal(text.includes(secretId), false);
  assert.equal(text.includes(secretDependency), false);
  assert.equal(text.includes(secretFile), false);
  assert.equal(text.includes("PROMPT_PREVIEW_SECRET"), false);
  assert.equal(text.includes(taskId), false);
  assert.equal(text.includes("lp2-"), false);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatched").length, 1);
  assert.equal(JSON.stringify(snapshotOf(env.tasks.get(taskId))), before);
  assert.equal(env.tasks.get(taskId)?.status, "running");
  assert.equal(env.tasks.get(taskId)?.loopPlusNextStepPlan, undefined);
  assert.equal(env.attempts.length, 1);
  assert.equal(env.tasks.get(taskId)?.subTasks.some((item) => item.id === secretId), false);
  const miss = env.logs.filter((item) => item.event === "loop-plus-protocol-miss");
  assert.equal(miss.length, 1);
  assert.equal((miss[0]?.payload as { reasonCode?: string }).reasonCode, "state.dispatch_window.preflight_failed");
  assert.equal((miss[0]?.payload as { dispatchWindow?: string }).dispatchWindow, "open");
  const retry = env.mains.at(-1)!;
  assert.notEqual(retry, review);
  const eventIds = retry.request.reviewEventIds ?? [retry.request.reviewEventId ?? ""];
  retry.resolve(acceptWithIndependentWork(eventIds, [subtask("preview-ok", ["src/preview-ok.ts"])]));
  await flush();
  assert.equal(env.attempts.at(-1)?.request.attemptId, "lp2-preview-ok");
  assert.equal(env.attempts.at(-1)?.request.subtaskId, "preview-ok");
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected").length, 1);
  assert.equal(env.tasks.get(taskId)?.status, "running");
  env.host.stopParent(taskId);
  await run.done;
});

test("logs one redacted summary when the live scheduler rejects and rolls back", async () => {
  const schedulerModule = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
  const originalCreate = schedulerModule.createLoopPlusScheduler;
  let armed = false;
  let scriptedCalls = 0;
  schedulerModule.createLoopPlusScheduler = (options) => {
    const scheduler = originalCreate(options);
    const dispatch = scheduler.dispatch.bind(scheduler);
    scheduler.dispatch = (specs, dispatchOptions) => {
      if (!armed) return dispatch(specs, dispatchOptions);
      scriptedCalls += 1;
      if (scriptedCalls !== 2) return dispatch(specs, dispatchOptions);
      const idleView = dispatch([], { deferPromotion: true }).view;
      const list = Array.isArray(specs) ? specs : [];
      return {
        decisions: [],
        started: [],
        view: idleView,
        rejected: list.map((spec) => {
          const record = spec && typeof spec === "object" ? spec as { subtaskId?: unknown; attemptId?: unknown } : {};
          return {
            subtaskId: typeof record.subtaskId === "string" ? record.subtaskId : "secret-subtask",
            attemptId: typeof record.attemptId === "string" ? record.attemptId : "secret-attempt",
            reason: "active_subtask" as const,
            detail: "PROMPT_LIVE_SECRET /tmp/live-secret/src/evil.ts",
          };
        }),
      };
    };
    return scheduler;
  };
  const env = harness();
  try {
    const { run, taskId, review } = await openDispatchFirstReview(env, [subtask("first", ["src/first.ts"])]);
    assert.equal(env.attempts[0].request.attemptId, "lp1-first");
    assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected").length, 0);
    const before = JSON.stringify(snapshotOf(env.tasks.get(taskId)));
    const secretId = "live-secret-child";
    const secretFile = "src/live-secret-evil.ts";
    armed = true;
    scriptedCalls = 0;
    review.resolve(decisionJson({
      status: "dispatch",
      subtasks: [{
        ...subtask(secretId, [secretFile]),
        prompt: `${longPrompt(secretId, [secretFile])} PROMPT_LIVE_SECRET`,
      }],
      nextStepPlan: { objective: "真实调度拒绝后回滚" },
    }));
    await flush();
    armed = false;
    assert.equal(scriptedCalls, 2);
    const rejections = env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected");
    assert.equal(rejections.length, 1);
    assert.deepEqual(rejections[0]?.payload, {
      rejectedCount: 1,
      reasonCounts: { active_subtask: 1 },
    });
    const text = rejectionPayloadText(env);
    assert.equal(text.includes(secretId), false);
    assert.equal(text.includes(secretFile), false);
    assert.equal(text.includes("PROMPT_LIVE_SECRET"), false);
    assert.equal(text.includes("/tmp/live-secret"), false);
    assert.equal(text.includes(taskId), false);
    assert.equal(text.includes("lp2-"), false);
    assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatched").length, 1);
    assert.equal(JSON.stringify(snapshotOf(env.tasks.get(taskId))), before);
    assert.equal(env.tasks.get(taskId)?.status, "running");
    assert.equal(env.tasks.get(taskId)?.loopPlusNextStepPlan, undefined);
    assert.equal(env.attempts.length, 1);
    assert.equal(env.tasks.get(taskId)?.subTasks.some((item) => item.id === secretId), false);
    const miss = env.logs.filter((item) => item.event === "loop-plus-protocol-miss");
    assert.equal(miss.length, 1);
    assert.equal((miss[0]?.payload as { reasonCode?: string }).reasonCode, "state.dispatch_window.preflight_failed");
    const retry = env.mains.at(-1)!;
    assert.notEqual(retry, review);
    const eventIds = retry.request.reviewEventIds ?? [retry.request.reviewEventId ?? ""];
    retry.resolve(acceptWithIndependentWork(eventIds, [subtask("live-ok", ["src/live-ok.ts"])]));
    await flush();
    assert.equal(env.attempts.at(-1)?.request.attemptId, "lp2-live-ok");
    assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatch-rejected").length, 1);
    assert.equal(env.tasks.get(taskId)?.status, "running");
    env.host.stopParent(taskId);
    await run.done;
  } finally {
    schedulerModule.createLoopPlusScheduler = originalCreate;
  }
});

test("does not invent scheduler rejections when preflight exits without a rejection list", async () => {
  const cases = [
    {
      name: "continuation",
      maxConcurrency: 1,
      initial: [subtask("first", ["src/first.ts"])],
      proposed: [{
        ...subtask("continued-secret", ["src/continued-secret.ts"]),
        continueFromSubtaskId: "first",
        prompt: `${longPrompt("continued-secret", ["src/continued-secret.ts"])} PROMPT_CONTINUE_SECRET`,
      }],
    },
    {
      name: "capacity",
      maxConcurrency: 1,
      initial: [subtask("first", ["src/first.ts"])],
      proposed: [subtask("slot-secret-a", ["src/slot-secret-a.ts"]), subtask("slot-secret-b", ["src/slot-secret-b.ts"])],
    },
    {
      name: "write-conflict",
      maxConcurrency: 2,
      initial: [subtask("first", ["src/first.ts"]), subtask("owner", ["src/shared-secret.ts"])],
      proposed: [subtask("conflict-secret", ["src/shared-secret.ts"])],
    },
  ] as const;
  for (const item of cases) {
    const env = harness({ maxConcurrency: item.maxConcurrency });
    const { run, taskId, review } = await openDispatchFirstReview(env, [...item.initial]);
    const before = JSON.stringify(snapshotOf(env.tasks.get(taskId)));
    const attemptsBefore = env.attempts.length;
    review.resolve(decisionJson({
      status: "dispatch",
      subtasks: item.proposed,
      nextStepPlan: { objective: "只因预检条件退出" },
    }));
    await flush();
    assert.equal(env.logs.filter((entry) => entry.event === "loop-plus-dispatch-rejected").length, 0, item.name);
    assert.equal(rejectionPayloadText(env).includes("secret"), false, item.name);
    assert.equal(JSON.stringify(snapshotOf(env.tasks.get(taskId))), before, item.name);
    assert.equal(env.attempts.length, attemptsBefore, item.name);
    assert.equal(env.tasks.get(taskId)?.status, "running", item.name);
    assert.equal(env.tasks.get(taskId)?.loopPlusNextStepPlan, undefined, item.name);
    const miss = env.logs.filter((entry) => entry.event === "loop-plus-protocol-miss");
    assert.equal(miss.length, 1, item.name);
    assert.equal((miss[0]?.payload as { reasonCode?: string }).reasonCode, "state.dispatch_window.preflight_failed", item.name);
    env.host.stopParent(taskId);
    await run.done;
  }
});

test("does not treat a delayed launch as a lost process", async () => {
  const delayed: { release: (() => void) | null } = { release: null };
  const env = harness({
    maxConcurrency: 2,
    launchDelayMs: (last) => last === null ? 0 : 60_000,
    delay: () => new Promise((resolve) => {
      delayed.release = () => resolve();
    }),
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(typeof delayed.release, "function");
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.deepEqual(snapshotOf(task).running.map((item) => item.subtaskId).sort(), ["alpha", "beta"]);
  assert.equal(snapshotOf(task).currentReview, null);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 0);
  assert.equal(env.attempts.length, 1);
  delayed.release?.();
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId).sort(), ["alpha", "beta"]);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview, null);
});

test("Loop+ continues a progressing repair of the same subtask past the former main decision limit", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "修复所有复现点", modelPrompt: "修复所有复现点" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId!;
  const repair = subtask("repair", ["src/repair.ts"]);
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [repair] }));
  await flush();
  for (let round = 1; round <= 51; round += 1) {
    for (const evidence of ["复现条件", "验证方法", "兼容约束"]) {
      const previousCount = env.mains.length;
      env.host.submitUserMessage(taskId, `第 ${round} 个复现点的${evidence}已补充。`);
      await flush();
      assert.equal(env.tasks.get(taskId)?.status, "running");
      assert.equal(env.mains.length, previousCount + 1);
      env.mains.at(-1)!.resolve(decisionJson({ status: "wait" }));
      await flush();
    }
    const attempt = env.attempts.at(-1)!;
    const detail = `第 ${round} 个复现点已修复并验证，下一个复现点仍失败。`;
    attempt.resolve({ outcome: "failed", detail });
    await flush();
    const review = env.mains.at(-1)!;
    const reviewEventId = attemptEvent(attempt);
    assert.deepEqual(review.request.reviewEventIds, [reviewEventId]);
    assert.ok(review.request.prompt.includes(detail));
    assert.match(review.request.prompt, /You decide whether the remaining goal is blocked from evidence/);
    review.resolve(decisionJson({ status: "accept", reviewEventId,
      reviews: [{ reviewEventId, acceptance: "failed", reason: detail, subtaskIds: [repair.id] }],
      subtasks: [{ ...repair, prompt: `${repair.prompt} 仅处理第 ${round + 1} 个复现点。` }],
    }));
    await flush();
    assert.equal(env.attempts.length, round + 1);
  }
  assert.ok(env.mains.length > 200);
  const finalAttempt = env.attempts.at(-1)!;
  finalAttempt.resolve({ outcome: "completed", detail: "全部复现点验证通过" });
  await flush();
  const finalReview = env.mains.at(-1)!;
  const finalReviewEventId = attemptEvent(finalAttempt);
  assert.deepEqual(finalReview.request.reviewEventIds, [finalReviewEventId]);
  finalReview.resolve(completedDecision({ reviewEventId: finalReviewEventId }));
  await run.done;
  assert.equal(env.tasks.get(taskId)?.status, "completed");
  const attempts = snapshotOf(env.tasks.get(taskId)).seenAttempts;
  assert.equal(attempts.filter((attempt) => attempt.subtaskId === repair.id && attempt.acceptance === "failed").length, 51);
  assert.equal(attempts.at(-1)?.acceptance, "passed");
  assert.equal(env.messages.includes("loop-plus-blocked"), false);
});

test("resumes a blocked review and a main-failure pause without reviving attempts", async () => {
  const blocked = harness();
  const blockedRun = blocked.host.tryRun({ displayPrompt: "ship the feature" }, blocked.target, { schedulingMode: "event_driven" });
  await flush();
  blocked.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  blocked.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = blocked.mains[1];
  review.resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "need a person" }));
  await flush();
  blocked.mains[2].resolve(decisionJson({ status: "blocked", finalSummary: "need a person" }));
  await flush();
  assert.equal(blocked.tasks.get(blockedRun.taskId ?? "")?.status, "needs-review");
  assert.equal(snapshotOf(blocked.tasks.get(blockedRun.taskId ?? "")).currentReview, null);
  assert.equal(snapshotOf(blocked.tasks.get(blockedRun.taskId ?? "")).reviewQueue.length, 1);
  blocked.host.tryRun({ displayPrompt: "continue" }, blocked.target, {
    resumeTaskId: blockedRun.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(blocked.mains.filter((item) => item.request.kind === "review").length, 3);
  assert.equal(blocked.attempts.length, 1);
  assert.equal(blocked.tasks.get(blockedRun.taskId ?? "")?.status, "running");
  assert.equal(blocked.tasks.get(blockedRun.taskId ?? "")?.mainAiFailureCount ?? 0, 0);

  let mainCalls = 0;
  const failed = harness({
    adaptMain: () => {
      mainCalls += 1;
      if (mainCalls <= 5) {
        throw new Error(`sync down ${mainCalls}`);
      }
      return undefined;
    },
  });
  const failedRun = failed.host.tryRun({ displayPrompt: "ship the feature" }, failed.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(mainCalls, 5);
  assert.equal(failed.mainCalls(), 5);
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.status, "needs-review");
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.mainAiFailureCount, 5);
  assert.match(failed.tasks.get(failedRun.taskId ?? "")?.finalSummary ?? "", /sync down 5/);
  assert.equal(await isSettled(failedRun.done), true);
  failed.host.tryRun({ displayPrompt: "continue" }, failed.target, {
    resumeTaskId: failedRun.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(mainCalls, 6);
  assert.equal(failed.mains.length, 1);
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.mainAiFailureLimitReached, false);
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.status, "running");
  assert.equal(failed.messages.filter((item) => item === "loop-plus-main-failure-limit").length, 1);
});

for (const code of ["CODEX_THREAD_HANDOFF_FAILED", "CODEX_THREAD_BUSY", "CODEX_THREAD_WRITER_CONFLICT", "SESSION_RUN_ACTIVE"]) {
  test(`pauses once for ${code} without retrying or consuming review work`, async () => {
    let fail = false;
    const env = harness({ adaptMain: () => {
      if (fail) throw Object.assign(new Error("原会话仍未释放，不能写入"), { code });
      return undefined;
    } });
    const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["src/alpha.ts"])] }));
    await flush();
    fail = true;
    env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
    await flush();
    const paused = env.tasks.get(run.taskId ?? "")!;
    assert.equal(env.mainCalls(), 2);
    assert.equal(paused.status, "needs-review");
    assert.equal(paused.mainAiFailureCount, 1);
    assert.equal(paused.mainAiFailureLimitReached, false);
    assert.match(paused.finalSummary ?? "", /禁止自动重试/);
    assert.ok(paused.finalSummary?.includes(code));
    assert.match(paused.finalSummary ?? "", /原会话仍未释放/);
    const before = snapshotOf(paused);
    assert.equal(before.reviewQueue.length + Number(Boolean(before.currentReview)), 1);
    assert.equal(await isSettled(run.done), true);
    fail = false;
    env.host.tryRun({ displayPrompt: "continue" }, env.target, { resumeTaskId: run.taskId, resumeRequested: true });
    await flush();
    assert.equal(env.mainCalls(), 3);
    assert.equal(env.attempts.length, 1);
    assert.equal(env.tasks.get(paused.id)?.mainAiFailureCount, 0);
    assert.equal(env.tasks.get(paused.id)?.finalSummary, undefined);
    assert.equal(env.tasks.get(paused.id)?.status, "running");
  });
}

test("finishes a synchronously thrown attempt without hanging the controller", async () => {
  const env = harness({ throwOnStart: true });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 0);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0].outcome, "failed");
  assert.equal(await isSettled(run.done), false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
});

test("rejects continue while a cancelled attempt is still aborting, then reviews it on the next explicit continue", async () => {
  const env = harness({ deferMainAbort: true, deferAttemptAbort: true, maxConcurrency: 2 });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  const alphaEventId = review.request.reviewEventId;
  assert.equal(env.mainCalls(), 2);
  env.host.stopParent(run.taskId ?? "");
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "stopped");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).parentStopped, true);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).running.some((item) => item.subtaskId === "beta"), true);
  assert.equal(await isSettled(run.done), true);
  assert.equal(await isSettled(continued.done), true);
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.messages.filter((item) => item === "loop-plus-resume-blocked").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-resumed").length, 0);
  review.releaseAbort(decisionJson({
    status: "accept",
    reviewEventId: alphaEventId,
    subtasks: [subtask("gamma", ["src/gamma.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.some((item) => item.request.subtaskId === "gamma"), false);
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "stopped");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.eventId, alphaEventId);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.outcome, "completed");
  beta.resolve({ outcome: "stopped", detail: "aborted late" });
  await flush();
  const queued = snapshotOf(env.tasks.get(run.taskId ?? ""));
  assert.equal(queued.running.length, 0);
  assert.equal(queued.parentStopped, true);
  assert.equal(queued.currentReview?.eventId, alphaEventId);
  assert.equal(queued.reviewQueue.length, 1);
  assert.equal(queued.reviewQueue[0]?.subtaskId, "beta");
  assert.equal(queued.reviewQueue[0]?.outcome, "stopped");
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.attempts.length, 2);
  assert.equal(await isSettled(continued.done), true);
  assert.equal(env.tasks.get(run.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
  const again = env.host.tryRun({ displayPrompt: "continue again" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  const resumed = snapshotOf(env.tasks.get(run.taskId ?? ""));
  assert.equal(resumed.parentStopped, false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.equal(env.mainCalls(), 3);
  assert.equal(env.mains[2]?.request.kind, "review");
  assert.equal(env.mains[2]?.request.reviewEventId, alphaEventId);
  assert.equal(env.attempts.length, 2);
  assert.equal(env.attempts.some((item) => item.request.subtaskId === "gamma"), false);
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "beta").length, 1);
  assert.equal(await isSettled(again.done), false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.currentRound ?? 0, 0);
  assert.equal(env.host.hasController(run.taskId ?? ""), true);
});

test("retains a finished attempt when report writing fails and reviews the queue on explicit continue", async () => {
  let alphaReports = 0;
  const env = harness({
    maxConcurrency: 2,
    recordAttempt: (input) => {
      if (input.subtaskId === "alpha") {
        alphaReports += 1;
        throw new Error("report disk full");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  env.mains.at(-1)?.resolve(decisionJson({ status: "blocked", finalSummary: "need a person" }));
  await flush();
  assert.equal(alphaReports, 1);
  assert.equal(env.reports.length, 0);
  assert.equal(stored()?.status, "error");
  assert.match(stored()?.finalSummary ?? "", /report disk full/);
  assert.equal(env.messages.filter((item) => item === "loop-plus-report-failed").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
  assert.equal(env.mainCalls(), 1);
  assert.deepEqual(snapshotOf(stored()).running.map((item) => item.subtaskId), ["beta"]);
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.equal(snapshotOf(stored()).currentReview?.outcome, "completed");
  assert.equal(snapshotOf(stored()).currentReview?.detail, "alpha done");
  assert.equal(snapshotOf(stored()).reviewQueue.length, 0);
  assert.equal(stored()?.subTasks.find((item) => item.id === "alpha")?.summary, "alpha done");
  assert.equal(await isSettled(run.done), true);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  const updatedAt = stored()?.updatedAt;
  env.host.reportAttempt(taskId, {
    subtaskId: "alpha",
    attemptId: alpha.request.attemptId,
    outcome: "failed",
    detail: "duplicate report",
  });
  await flush();
  assert.equal(alphaReports, 1);
  assert.equal(env.reports.length, 0);
  assert.equal(env.mainCalls(), 1);
  assert.equal(snapshotOf(stored()).currentReview?.detail, "alpha done");
  assert.equal(snapshotOf(stored()).reviewQueue.length, 0);
  assert.equal(stored()?.updatedAt, updatedAt);
  assert.equal(stored()?.status, "error");
  beta.resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0]?.subtaskId, "beta");
  assert.equal(snapshotOf(stored()).running.length, 0);
  assert.deepEqual(snapshotOf(stored()).reviewQueue.map((item) => item.subtaskId), ["beta"]);
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.equal(stored()?.status, "error");
  assert.equal(env.mainCalls(), 1);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(stored()?.status, "running");
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.mains[1]?.request.kind, "review");
  assert.deepEqual(env.mains[1]?.request.reviewEventIds, [
    buildLoopPlusFinishEventId("alpha", alpha.request.attemptId),
    buildLoopPlusFinishEventId("beta", beta.request.attemptId),
  ]);
  assert.equal(env.attempts.length, 2);
  assert.equal(await isSettled(continued.done), false);
  env.mains[1]?.resolve(decisionJson({
    status: "accept",
    reviewEventIds: env.mains[1]?.request.reviewEventIds,
    subtasks: [],
  }));
  await flush();
  assert.equal(snapshotOf(stored()).currentReview, null);
  assert.equal(snapshotOf(stored()).reviewQueue.length, 0);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(env.attempts.length, 2);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  assert.equal(stored()?.currentRound ?? 0, 0);
});

test("turns a communication preparation failure into one visible failed finish", async () => {
  const env = harness({
    prepareCommunication: () => {
      throw new Error("prepare failed");
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(env.attempts.length, 0);
  assert.equal(snapshotOf(task).running.length, 0);
  assert.equal(snapshotOf(task).currentReview?.outcome, "failed");
  assert.equal(snapshotOf(task).currentReview?.detail, "prepare failed");
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0]?.outcome, "failed");
  assert.equal(env.reports[0]?.detail, "prepare failed");
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(task?.status, "running");
  assert.equal(task?.mainAiFailureCount ?? 0, 0);
  assert.equal(await isSettled(run.done), false);
  const attemptId = snapshotOf(task).currentReview?.attemptId ?? "";
  env.host.reportAttempt(run.taskId ?? "", {
    subtaskId: "alpha",
    attemptId,
    outcome: "completed",
    detail: "duplicate prepare",
  });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.detail, "prepare failed");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).reviewQueue.length, 0);
});

test("pauses recoverably when persisting a finish fails and keeps the completion queue", async () => {
  let persistFailures = 0;
  const env = harness({
    beforeUpdateTask: (patch) => {
      const snapshot = patch.loopPlus as LoopPlusSchedulerSnapshot | undefined;
      if (persistFailures === 0 && snapshot?.currentReview?.subtaskId === "alpha") {
        persistFailures += 1;
        throw new Error("persist failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(persistFailures, 1);
  assert.equal(task?.status, "error");
  assert.equal(task?.loopPlusInterruption?.reason, "persistence-failure");
  assert.equal(typeof task?.loopPlusInterruption?.phase, "string");
  assert.match(task?.finalSummary ?? "", /persist failed/);
  assert.equal(snapshotOf(task).running.length, 0);
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.equal(snapshotOf(task).currentReview?.detail, "alpha done");
  assert.equal(env.mainCalls(), 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-persist-failed").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.logs.some((item) => item.event === "loop-plus-persist-failed"), true);
  const diagnostic = env.logs.find((item) => item.event === "loop-plus-persist-failed")?.payload as Record<string, unknown>;
  assert.equal(diagnostic.stage, "finish-commit");
  assert.equal(diagnostic.reason, "exception");
  assert.equal(diagnostic.runningCount, 0);
  assert.equal(diagnostic.reviewCount, 1);
  env.host.reportAttempt(run.taskId ?? "", {
    subtaskId: "alpha",
    attemptId: env.attempts[0].request.attemptId,
    outcome: "failed",
    detail: "second event",
  });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.detail, "alpha done");
  assert.equal(env.mainCalls(), 1);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.equal(env.tasks.get(run.taskId ?? "")?.loopPlusInterruption, undefined);
  assert.equal(env.mains[1]?.request.kind, "review");
  assert.equal(env.mains[1]?.request.reviewEventId, buildLoopPlusFinishEventId("alpha", env.attempts[0].request.attemptId));
  assert.equal(env.attempts.length, 1);
  assert.equal(await isSettled(continued.done), false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
});

test("keeps the persisted finish queue when refreshing an in-flight main prompt fails", async () => {
  let failRefresh = false;
  let armedRefreshFailure = false;
  const env = harness({
    maxConcurrency: 2,
    beforeUpdateTask: (patch) => {
      const snapshot = patch.loopPlus as LoopPlusSchedulerSnapshot | undefined;
      if (!armedRefreshFailure && snapshot?.reviewQueue.some((item) => item.subtaskId === "beta")) {
        armedRefreshFailure = true;
        failRefresh = true;
      }
    },
    beforeReadTask: () => {
      if (failRefresh) {
        failRefresh = false;
        throw new Error("refresh failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  beta.resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  const alphaEventId = buildLoopPlusFinishEventId("alpha", alpha.request.attemptId);
  const betaEventId = buildLoopPlusFinishEventId("beta", beta.request.attemptId);
  assert.equal(task?.status, "running");
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(task).reviewQueue.map((item) => item.subtaskId), ["beta"]);
  const reviews = env.mains.filter((item) => item.request.kind === "review");
  assert.deepEqual(reviews.at(-1)?.request.reviewEventIds, [alphaEventId],
    "a later finish must remain queued while the in-flight review keeps its captured batch");
  assert.equal(env.logs.some((item) => item.event === "loop-plus-refresh-failed"), true);
  assert.equal(await isSettled(run.done), false);
  assert.equal(task?.mainAiFailureCount ?? 0, 0);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
});

test("releases the controller when loop plus completes and ignores late callbacks", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  env.mains[1].resolve(decisionJson({
    status: "accept",
    reviewEventId: env.mains[1].request.reviewEventId,
    subtasks: [],
  }));
  await flush();
  const closeout = env.mains.find((item) => item.request.kind === "closeout");
  assert.ok(closeout);
  closeout.resolve(decisionJson({
    status: "completed",
    answerConclusion: "finished",
    finalSummary: "everything passed",
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    requirementCoverage: [{ name: "scope", passed: true }],
  }));
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  assert.equal(stored()?.status, "completed");
  assert.equal(stored()?.finalSummary, "everything passed");
  assert.equal(snapshotOf(stored()).completed, true);
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.host.hasController(taskId), false);
  assert.equal(env.mainCalls(), 3);
  const updatedAt = stored()?.updatedAt;
  const reportsBefore = env.reports.length;
  env.host.reportAttempt(taskId, {
    subtaskId: "alpha",
    attemptId: env.attempts[0].request.attemptId,
    outcome: "failed",
    detail: "late callback",
  });
  await flush();
  assert.equal(env.host.hasController(taskId), false);
  assert.equal(stored()?.status, "completed");
  assert.equal(stored()?.finalSummary, "everything passed");
  assert.equal(stored()?.updatedAt, updatedAt);
  assert.equal(env.reports.length, reportsBefore);
  assert.equal(snapshotOf(stored()).completed, true);
  assert.equal(snapshotOf(stored()).reviewQueue.length, 0);
  assert.equal(snapshotOf(stored()).currentReview, null);
  const again = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(await isSettled(again.done), true);
  assert.equal(env.host.hasController(taskId), false);
  assert.equal(stored()?.status, "completed");
  assert.equal(stored()?.finalSummary, "everything passed");
  assert.equal(stored()?.updatedAt, updatedAt);
  assert.equal(env.mainCalls(), 3);
  assert.equal(env.attempts.length, 1);
  env.host.stopParent(taskId);
  assert.equal(stored()?.status, "completed");
  assert.equal(snapshotOf(stored()).completed, true);
});

test("parks a pending successor when report writing fails and starts it once after reload", async () => {
  const env = harness({
    maxConcurrency: 1,
    recordAttempt: (input) => {
      if (input.subtaskId === "alpha") {
        throw new Error("report failure");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha"]);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).running.map((item) => item.subtaskId), ["alpha"]);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).pending.map((item) => item.subtaskId), ["beta"]);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  const parkedId = snapshotOf(stored()).pending[0]?.attemptId ?? "";
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.mainCalls(), 1);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha"]);
  assert.equal(stored()?.status, "error");
  assert.match(stored()?.finalSummary ?? "", /report failure/);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  assert.equal(stored()?.currentRound ?? 0, 0);
  assert.deepEqual(stored()?.activeSubtaskIds, []);
  assert.equal(stored()?.subTasks.find((item) => item.id === "beta")?.status, "pending");
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.equal(snapshotOf(stored()).currentReview?.detail, "alpha done");
  assert.deepEqual(snapshotOf(stored()).running.map((item) => item.subtaskId), []);
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.equal(env.messages.filter((item) => item === "loop-plus-report-failed").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
  assert.equal(env.reports.length, 0);

  const reloaded = env.reloadHost();
  const observed = reloaded.tryRun({ displayPrompt: "continue" }, env.target, { resumeTaskId: taskId });
  await flush();
  assert.equal(await isSettled(observed.done), true);
  assert.equal(reloaded.hasController(taskId), true);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha"]);
  assert.equal(stored()?.status, "error");
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.deepEqual(snapshotOf(stored()).running, []);

  const continued = reloaded.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(stored()?.status, "running");
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.mains[1]?.request.kind, "review");
  const alphaEventId = buildLoopPlusFinishEventId("alpha", env.attempts[0].request.attemptId);
  assert.equal(env.mains[1]?.request.reviewEventId, alphaEventId);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  assert.equal(env.attempts[1]?.request.attemptId, parkedId);
  assert.equal(await isSettled(continued.done), false);
  env.mains[1]?.resolve(decisionJson({
    status: "accept",
    reviewEventId: alphaEventId,
    subtasks: [],
  }));
  await flush();
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "beta").length, 1);
  env.attempts[1]?.resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  assert.equal(env.mainCalls(), 3);
  assert.equal(env.mains[2]?.request.kind, "review");
  assert.equal(env.mains[2]?.request.reviewEventId, buildLoopPlusFinishEventId("beta", parkedId));
  assert.equal(env.reports.filter((item) => item.subtaskId === "beta").length, 1);
  assert.equal(env.reports.filter((item) => item.subtaskId === "alpha").length, 0);
  assert.equal(env.attempts.length, 2);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  assert.equal(stored()?.currentRound ?? 0, 0);
});

test("parks a pending successor when persisting a finish fails", async () => {
  let persistFailures = 0;
  const env = harness({
    maxConcurrency: 1,
    beforeUpdateTask: (patch) => {
      const snapshot = patch.loopPlus as LoopPlusSchedulerSnapshot | undefined;
      if (
        persistFailures === 0
        && snapshot?.currentReview?.subtaskId === "alpha"
        && snapshot.running.some((item) => item.subtaskId === "beta")
      ) {
        persistFailures += 1;
        throw new Error("persist failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(persistFailures, 1);
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.mainCalls(), 1);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha"]);
  assert.equal(task?.status, "error");
  assert.match(task?.finalSummary ?? "", /persist failed/);
  assert.equal(task?.mainAiFailureCount ?? 0, 0);
  assert.deepEqual(task?.activeSubtaskIds, []);
  assert.equal(task?.subTasks.find((item) => item.id === "beta")?.status, "pending");
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(task).running, []);
  assert.deepEqual(snapshotOf(task).pending.map((item) => item.subtaskId), ["beta"]);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
});

test("does not let a delayed reservation cross a needs-review pause", async () => {
  const gates: Array<() => void> = [];
  const env = harness({
    maxConcurrency: 2,
    launchDelayMs: (last) => last === null ? 0 : 1,
    delay: () => new Promise((resolve) => {
      gates.push(resolve);
    }),
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(gates.length, 1);
  const parkedId = snapshotOf(env.tasks.get(run.taskId ?? "")).running.find((item) => item.subtaskId === "beta")?.attemptId ?? "";
  assert.notEqual(parkedId, "");
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  review.resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "need a person" }));
  await flush();
  const blockReview = env.mains[2];
  assert.match(blockReview.request.prompt, /Bounded blocked review/);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  blockReview.resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "need a person" }));
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  assert.equal(await isSettled(run.done), true);
  assert.equal(stored()?.status, "needs-review");
  assert.equal(env.attempts.length, 1);
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.deepEqual(snapshotOf(stored()).running, []);
  gates.shift()?.();
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(stored()?.status, "needs-review");
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(gates.length, 1);
  gates.shift()?.();
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  assert.equal(env.attempts[1]?.request.attemptId, parkedId);
  assert.equal(stored()?.status, "running");
  const resumedReview = env.mains.filter((item) => item.request.kind === "review");
  assert.equal(resumedReview.length, 3);
  assert.equal(resumedReview[2]?.request.reviewEventId, review.request.reviewEventId);
  assert.equal(await isSettled(continued.done), false);
  resumedReview[2]?.resolve(decisionJson({
    status: "accept",
    reviewEventId: resumedReview[2]?.request.reviewEventId,
    subtasks: [],
  }));
  await flush();
  assert.equal(env.mains.filter((item) => item.request.reviewEventId === review.request.reviewEventId).length, 3);
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "beta").length, 1);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
});

test("does not start a paused reservation when continue races its launch delay", async () => {
  const gates: Array<() => void> = [];
  const env = harness({
    maxConcurrency: 2,
    launchDelayMs: (last) => last === null ? 0 : 1,
    delay: () => new Promise((resolve) => {
      gates.push(resolve);
    }),
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const parkedId = snapshotOf(env.tasks.get(run.taskId ?? "")).running.find((item) => item.subtaskId === "beta")?.attemptId ?? "";
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  review.resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "need a person" }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(gates.length, 1);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.attempts.length, 1);
  for (let guard = 0; guard < 5 && gates.length > 0; guard += 1) {
    gates.shift()?.();
    await flush();
  }
  assert.equal(gates.length, 0);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  assert.equal(env.attempts[1]?.request.attemptId, parkedId);
  assert.equal(env.mains.filter((item) => item.request.reviewEventId === review.request.reviewEventId).length, 2);
  assert.equal(await isSettled(continued.done), false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
});

test("keeps an in-flight completion queued while paused without starting the successor", async () => {
  const env = harness({
    maxConcurrency: 2,
    recordAttempt: (input) => {
      if (input.subtaskId === "alpha") {
        throw new Error("report failure");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [
      subtask("alpha", ["src/alpha.ts"]),
      subtask("beta", ["src/beta.ts"]),
      subtask("gamma", ["src/gamma.ts"]),
    ],
  }));
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  const parkedId = snapshotOf(stored()).pending[0]?.attemptId ?? "";
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.mainCalls(), 1);
  assert.equal(stored()?.status, "error");
  assert.deepEqual(snapshotOf(stored()).running.map((item) => item.subtaskId), ["beta"]);
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.equal(env.attempts.length, 2);
  beta.resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.equal(env.mainCalls(), 1);
  assert.equal(stored()?.status, "error");
  assert.deepEqual(stored()?.activeSubtaskIds, []);
  assert.equal(stored()?.subTasks.find((item) => item.id === "gamma")?.status, "pending");
  assert.deepEqual(snapshotOf(stored()).running, []);
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(stored()).reviewQueue.map((item) => item.subtaskId), ["beta"]);
  assert.equal(env.reports.filter((item) => item.subtaskId === "beta").length, 1);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.attempts.filter((item) => item.request.attemptId === parkedId).length, 1);
  assert.equal(env.attempts.length, 3);
  const alphaEventId = buildLoopPlusFinishEventId("alpha", alpha.request.attemptId);
  const betaEventId = buildLoopPlusFinishEventId("beta", beta.request.attemptId);
  assert.deepEqual(env.mains[1]?.request.reviewEventIds, [alphaEventId, betaEventId]);
  env.mains[1]?.resolve(decisionJson({
    status: "accept",
    reviewEventIds: [alphaEventId, betaEventId],
    subtasks: [],
  }));
  await flush();
  assert.equal(snapshotOf(stored()).currentReview, null);
  assert.equal(snapshotOf(stored()).reviewQueue.length, 0);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  const gamma = env.attempts.find((item) => item.request.attemptId === parkedId);
  assert.ok(gamma);
  gamma.resolve({ outcome: "completed", detail: "gamma done" });
  await flush();
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "gamma").length, 1);
  assert.equal(env.reports.filter((item) => item.subtaskId === "gamma").length, 1);
  assert.equal(env.mains.filter((item) => item.request.reviewEventId === buildLoopPlusFinishEventId("gamma", parkedId)).length, 1);
  assert.equal(await isSettled(continued.done), false);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  assert.equal(stored()?.status, "running");
});

test("reads user messages that arrived during the main task together, then waits or dispatches", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains.length, 1);
  assert.equal(env.mains[0].request.kind, "initial");
  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "while planning"), true);
  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "also while planning"), true);
  assert.equal(env.mains.length, 1);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).userMessageQueue, [
    "while planning",
    "also while planning",
  ]);

  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  const firstUser = env.mains.filter((item) => item.request.kind === "user");
  assert.equal(firstUser.length, 1);
  assert.match(firstUser[0].request.prompt, /1\. while planning/);
  assert.match(firstUser[0].request.prompt, /2\. also while planning/);
  assert.equal(env.messages.includes("loop-plus-user-messages"), true);
  firstUser[0].resolve(decisionJson({ status: "wait" }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0].request.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).userMessageQueue, []);
  assert.equal(env.mains.filter((item) => item.request.kind === "user").length, 1);

  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "start the follow-up"), true);
  await flush();
  const followUp = env.mains.filter((item) => item.request.kind === "user");
  assert.equal(followUp.length, 2);
  assert.match(followUp[1].request.prompt, /start the follow-up/);
  assert.equal(followUp[1].request.prompt.includes("while planning"), false);
  followUp[1].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
});

test("keeps a stopped or failed-limit Loop+ parent from being woken by user speech", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.ok(task);
  task.mainAiFailureLimitReached = true;
  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "blocked by failure limit"), false);
  task.mainAiFailureLimitReached = false;
  env.host.stopParent(run.taskId ?? "");
  await flush();
  const mainsBefore = env.mains.length;
  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "after stop"), false);
  await flush();
  assert.equal(env.mains.length, mainsBefore);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).userMessageQueue.includes("after stop"), false);

  const reloaded = env.reloadHost();
  assert.equal(reloaded.submitUserMessage(run.taskId ?? "", "without a live controller"), false);
  const running = env.tasks.get(run.taskId ?? "");
  assert.ok(running);
  running.status = "running";
  const snapshot = snapshotOf(running);
  snapshot.parentStopped = false;
  snapshot.completed = false;
  running.loopPlus = snapshot;
  assert.equal(reloaded.submitUserMessage(run.taskId ?? "", "stored while the controller is gone"), true);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).userMessageQueue, [
    "stored while the controller is gone",
  ]);
  assert.equal(env.mains.length, mainsBefore);
});


test("posts the communication file when a Loop+ subtask starts and finishes", async () => {
  const notices: LoopPlusSubtaskChatNotice[] = [];
  const env = harness({
    prepareCommunication: (_task, subtask) => `/tmp/loop-plus/${subtask.id}.md`,
    appendSubtaskChat: (_target, notice) => {
      notices.push(notice);
    },
  });
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.phase, "started");
  assert.equal(notices[0]?.subtaskId, "alpha");
  assert.equal(notices[0]?.communicationFile, "/tmp/loop-plus/alpha.md");
  assert.equal(env.attempts[0]?.request.communicationFile, "/tmp/loop-plus/alpha.md");
  env.attempts[0]?.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  assert.equal(notices.length, 2);
  assert.equal(notices[1]?.phase, "finished");
  assert.equal(notices[1]?.runStatus, "end");
  assert.equal(notices[1]?.assistantContent, "alpha done");
  assert.equal(notices[1]?.communicationFile, "/tmp/loop-plus/alpha.md");
  assert.equal(env.mains.some((item) => item.request.kind === "review"), true);
});

test("still accepts a finished Loop+ subtask when the chat notice fails", async () => {
  const env = harness({
    prepareCommunication: () => "/tmp/loop-plus/alpha.md",
    appendSubtaskChat: () => {
      throw new Error("chat down");
    },
  });
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0]?.resolve({ outcome: "failed", detail: "boom" });
  await flush();
  assert.equal(env.logs.some((item) => item.event === "loop-plus-chat-failed"), true);
  assert.equal(env.mains.some((item) => item.request.kind === "review"), true);
});

test("bounds structured Loop+ validation failures instead of dispatching invalid decisions", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains[0]?.request.kind, "initial");

  env.mains[0].resolve(decisionJson({ status: "unknown", subtasks: [] }));
  await flush();
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 1);
  assert.equal(env.attempts.length, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.equal(env.mains[1]?.request.kind, "continue");
  assert.match(env.mains[1].request.prompt, /validation\.status\.invalid/);

  await exhaustProtocolBudget(env, run, 0, decisionJson({
    status: "completed",
    answerConclusion: "finished",
    finalSummary: "everything passed",
  }), true);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 4);
  assert.equal(env.messages.includes("loop-plus-protocol-paused"), true);
  assert.equal(env.messages.includes("loop-plus-protocol-paused"), true);
  assert.equal(env.messages.includes("loop-plus-completed"), false);
  assert.equal(env.attempts.length, 0);
  assert.equal(await isSettled(run.done), true);
});

test("continues from format, field or state failure on the same main session without a resume notification", async (context) => {
  for (const [response, reason, discarded] of [
    ["Codex context summary without a decision object", /format\.ObjectNotFound/, /Codex context summary/],
    ['{"status":"unknown"}', /validation\.status\.invalid/, /"status":"unknown"/],
    ['{"status":"wait","reportEventIds":["stale-report"]}', /state\.report_batch\.mismatch/, /stale-report/],
    ['{"status":"dispatch","controls":[{"id":"new-audit"}]}', /InvalidSubtaskCount/, /new-audit/],
  ] as const) {
    const env = protocolHarness(context);
    const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.mains[0].resolve(response);
    await flush();
    assert.equal(env.mains.length, 2);
    const resumed = env.mains[1];
    assert.match(resumed.request.prompt, /Loop\+ 继续执行/);
    assert.match(resumed.request.prompt, reason);
    assert.doesNotMatch(resumed.request.prompt, discarded);
    assert.equal(resumed.request.taskId, run.taskId);
    assert.equal(resumed.request.target, env.target);
    assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
    assert.equal(await isSettled(run.done), false);
    assert.equal(env.messages.includes("loop-plus-resumed"), false);
    assert.equal(env.messages.includes("loop-plus-protocol-paused"), false);
    resumed.resolve(directCompletionDecision());
    await run.done;
    assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
    assert.equal(env.attempts.length, 0);
  }
});

test("stops the automatic continuation without launching another main request", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve('回复前言 {"status":');
  await flush();
  assert.equal(env.mains.length, 2);
  assert.match(env.mains[1].request.prompt, /format\./);
  assert.doesNotMatch(env.mains[1].request.prompt, /回复前言|\{"status":$/);
  env.host.stopParent(run.taskId ?? "");
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "stopped");
  assert.equal(env.mains[1].abortCount, 1);
  assert.equal(env.mains.length, 2);
});

test("persistent malformed output pauses after three automatic continuations", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve('{\n  "status" "synthetic-first-secret"\n}');
  await flush();
  assert.match(env.mains[1].request.prompt, /format\.ColonExpected/);
  assert.match(env.mains[1].request.prompt, /第 2 行第 12 列/);
  assert.match(env.mains[1].request.prompt, /检查属性名后是否缺少冒号/);
  assert.doesNotMatch(env.mains[1].request.prompt, /synthetic-first-secret/);
  await exhaustProtocolBudget(env, run, 0, (main, rejection) => {
    assert.match(main.request.prompt, /format\./);
    return rejection === 2 ? '{"status":"synthetic-second-secret", /* unclosed' : "synthetic-invalid-secret";
  }, true);
  const summary = env.tasks.get(run.taskId ?? "")?.finalSummary ?? "";
  assert.match(summary, /已自动继续执行 3 次/);
  assert.match(summary, /协议原因码\nformat\.ObjectNotFound/);
  assert.doesNotMatch(summary, /ColonExpected|UnexpectedEndOfComment|synthetic-(first|second)-secret/);
  assert.deepEqual(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").map((item) => item.payload), [
    {
      taskId: run.taskId, held: false, protocolFailureCount: 1, rejectionKind: "format",
      reasonCode: "format.ColonExpected", dispatchWindow: "closed", attemptState: "first",
    },
    {
      taskId: run.taskId, held: false, protocolFailureCount: 2, rejectionKind: "format",
      reasonCode: "format.UnexpectedEndOfComment", dispatchWindow: "closed", attemptState: "retry",
    },
    ...[3, 4].map((protocolFailureCount) => ({ taskId: run.taskId, held: false, protocolFailureCount,
      rejectionKind: "format", reasonCode: "format.ObjectNotFound", dispatchWindow: "closed", attemptState: "retry" })),
  ]);
  assert.deepEqual(env.logs.filter((item) => item.event === "loop-plus-protocol-recovery")
    .map((item) => (item.payload as { result: string }).result),
  ["continuation_requested", "continuation_requested", "continuation_requested", "paused"]);
  assert.equal(env.messages.includes("loop-plus-protocol-paused"), true);
});

test("subtask validation logs controlled field metadata and continues without private decision text", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(JSON.stringify({
    status: "dispatch",
    subtasks: [{ id: "private-id", title: "private title", prompt: "private prompt", dependsOn: "private path" }],
  }));
  await flush();
  assert.equal(env.mains.length, 2);
  assert.match(env.mains[1].request.prompt, /InvalidSubtaskDependencies[\s\S]*dispatch\.subtasks\[0\]\.dependsOn/);
  assert.doesNotMatch(env.mains[1].request.prompt, /private-id|private title|private prompt|private path/);
  assert.deepEqual(env.logs.filter((item) => item.event === "loop-plus-protocol-miss")[0]?.payload, {
    taskId: run.taskId, held: false, protocolFailureCount: 1, rejectionKind: "validation",
    reasonCode: "validation.subtasks.InvalidSubtaskDependencies", fieldPath: "dispatch.subtasks[0].dependsOn",
    dispatchWindow: "closed", attemptState: "first",
  });
  assert.doesNotMatch(JSON.stringify(env.logs), /private-id|private title|private prompt|private path/);
  env.mains[1].resolve(directCompletionDecision());
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
});

test("fourth invalid decision pauses with the latest rejection", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve("no decision JSON");
  await flush();
  assert.equal(env.mains.length, 2);
  await exhaustProtocolBudget(env, run, 0, '{"status":"unknown"}', true);
  const summary = env.tasks.get(run.taskId ?? "")?.finalSummary ?? "";
  assert.match(summary, /已自动继续执行 3 次/);
  assert.match(summary, /validation\.status\.invalid/);
  assert.match(summary, /协议原因码/);
  assert.doesNotMatch(summary, /format\.ObjectNotFound/);
});

test("automatically corrects unlinked supplemental work and dispatches it without consuming review early", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "实现并交付报告" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("feature", ["src/feature.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "实现和针对性测试通过" });
  await flush();
  const review = env.mains[1];
  const eventId = review.request.reviewEventId;
  const rejected = decisionJson({
    status: "accept", reviewEventId: eventId,
    reviews: [{ reviewEventId: eventId, acceptance: "passed", reason: "实现及测试符合要求" }],
    subtasks: [subtask("independent-research", ["reports/research.md"])],
  });
  review.resolve(rejected);
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.equal(env.attempts.length, 1);
  assert.equal(env.acceptanceFeedback.length, 0);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.eventId, eventId);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts[0].disposition, "finished");
  const retry = env.mains[2];
  assert.equal(retry.request.kind, "review");
  assert.match(retry.request.prompt, /validation\.accept\.unlinked_subtasks/);
  assert.match(retry.request.prompt, /independentSubtaskIds/);
  assert.doesNotMatch(retry.request.prompt, /independent-research/);
  assert.deepEqual(env.logs.find((item) => item.event === "loop-plus-protocol-miss")?.payload, {
    taskId: run.taskId, held: true, protocolFailureCount: 1, rejectionKind: "validation",
    reasonCode: "validation.accept.unlinked_subtasks", fieldPath: "subtasks", dispatchWindow: "open", attemptState: "first",
  });
  assert.match(retry.request.modelPrompt, /依据上方当前调度快照继续同一任务/);
  const corrected = JSON.parse(rejected);
  corrected.independentSubtaskIds = ["independent-research"];
  retry.resolve(JSON.stringify(corrected));
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.equal(env.attempts[1].request.subtaskId, "independent-research");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts[0].acceptance, "passed");
  assert.equal(env.messages.includes("loop-plus-protocol-paused"), false);
  assert.equal(env.logs.some((item) => item.event === "loop-plus-protocol-recovery"
    && (item.payload as { result?: string }).result === "recovered"), true);
  env.attempts[1].resolve({ outcome: "completed", detail: "报告和来源检查通过" });
  await flush();
  const finalReview = env.mains[3];
  assert.doesNotMatch(finalReview.request.prompt, /Loop\+ 继续执行/);
  finalReview.resolve(completedDecision({ reviewEventId: finalReview.request.reviewEventId }));
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
});

test("continues the frozen review when a reprompt target finishes during the main turn", async () => {
  const env = harness({ maxConcurrency: 2 });
  const run = env.host.tryRun({ displayPrompt: "完成两个交付" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch", subtasks: [subtask("metadata", ["src/metadata.ts"]), subtask("card-ui", ["src/card.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "元数据已完成" });
  await flush();
  const original = env.mains[1];
  const eventId = original.request.reviewEventId;
  assert.ok(eventId);
  env.attempts[1].resolve({ outcome: "completed", detail: "卡片已完成" });
  await flush();
  const accepted = { status: "accept", reviewEventId: eventId };
  original.resolve(decisionJson({
    ...accepted,
    controls: [{ id: "card-ui", action: "reprompt", title: "检查卡片", prompt: "核对最新展示结果" }],
  }));
  await flush();
  const resumed = env.mains[2];
  assert.equal(resumed.request.taskId, run.taskId);
  assert.deepEqual(resumed.request.reviewEventIds, original.request.reviewEventIds);
  assert.match(resumed.request.prompt, /Loop\+ 继续执行/);
  assert.match(resumed.request.prompt, /state\.controls\.unavailable/);
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).reviewQueue[0].subtaskId, "card-ui");
  assert.equal(env.acceptanceFeedback.length, 0);
  assert.equal(env.attempts.length, 2);
  assert.deepEqual(env.abortedAttemptIds, []);
  resumed.resolve(decisionJson(accepted));
  await flush();
  const nextReview = env.mains[3];
  assert.equal(nextReview.request.reviewEventId, buildLoopPlusFinishEventId("card-ui", env.attempts[1].request.attemptId));
  assert.doesNotMatch(nextReview.request.prompt, /Loop\+ 继续执行/);
  nextReview.resolve(completedDecision({ reviewEventId: nextReview.request.reviewEventId }));
  await run.done;
  assert.equal(env.tasks.get(run.taskId!)?.status, "completed");
  assert.equal(env.attempts.length, 2);
});

test("corrects contradictory completion ids and completes from the preserved acceptance batch", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "完成实现" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("feature", ["src/feature.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "全部要求及验证完成" });
  await flush();
  const eventId = env.mains[1].request.reviewEventId;
  env.mains[1].resolve(completedDecision({ reviewEventId: "stale-event" }));
  await flush();
  const retry = env.mains[2];
  assert.match(retry.request.prompt, /state\.review_batch\.mismatch/);
  assert.ok(retry.request.prompt.includes(eventId ?? ""));
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.equal(env.attempts.length, 1);
  retry.resolve(completedDecision({ reviewEventId: eventId }));
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
});

test("accepted block review clears the protocol failure and allows a fresh three-retry budget", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "完成实现" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("feature", ["src/feature.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "实现完成，外部验收环境尚不可用" });
  await flush();
  const taskId = run.taskId ?? "";
  const eventId = env.mains[1].request.reviewEventId;
  env.mains[1].resolve(completedDecision({ reviewEventId: "stale-event" }));
  await flush();
  assert.match(env.mains[2].request.prompt, /Loop\+ 继续执行/);
  env.mains[2].resolve(decisionJson({ status: "blocked", finalSummary: "外部验收环境不可用，需要恢复环境后继续核验。" }));
  await flush();
  assert.equal(env.tasks.get(taskId)?.loopPlusBlockReview?.state, "pending");
  assert.equal(env.mains[3].request.reviewEventId, eventId);
  assert.doesNotMatch(env.mains[3].request.prompt, /Loop\+ 继续执行|stale-event/);
  assert.equal(env.attempts.length, 1);
  assert.equal(env.acceptanceFeedback.length, 0);

  for (let index = 0; index < 4; index += 1) {
    env.mains[3 + index].resolve(completedDecision({ reviewEventId: "another-stale-event" }));
    await flush();
    const snapshot = snapshotOf(env.tasks.get(taskId));
    assert.equal(snapshot.currentReview?.eventId, eventId);
    assert.equal(snapshot.seenAttempts[0].disposition, "finished");
    assert.equal(env.attempts.length, 1);
    assert.equal(env.acceptanceFeedback.length, 0);
    assert.equal(env.tasks.get(taskId)?.status, index < 3 ? "running" : "needs-review");
  }
  await run.done;
  assert.equal(env.mains.length, 7);
  assert.deepEqual(env.logs.filter((item) => item.event === "loop-plus-protocol-miss")
    .map((item) => (item.payload as { protocolFailureCount: number }).protocolFailureCount), [1, 1, 2, 3, 4]);
  assert.match(env.tasks.get(taskId)?.finalSummary ?? "", /已自动继续执行 3 次/);
});

test("persistent protocol errors pause with the actual reason and carry repair context across explicit reload", async (context) => {
  const pauses: LoopTaskRecord[] = [];
  const env = protocolHarness(context, { recordPause: (task) => { pauses.push({ ...task }); } });
  const run = env.host.tryRun({ displayPrompt: "完成实现" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  const resumeIndex = await exhaustProtocolBudget(env, run, 0, '{"status":"accept","progressPercent":23}');
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(task?.status, "needs-review");
  assert.match(task?.finalSummary ?? "", /调度协议校验失败/);
  assert.match(task?.finalSummary ?? "", /reviewEventId/);
  assert.doesNotMatch(task?.finalSummary ?? "", /主模型未提供具体熔断原因/);
  assert.equal(pauses[0].finalSummary, task?.finalSummary);
  assert.equal(env.mains.length, 4);
  const reloaded = env.reloadHost();
  const resumed = reloaded.tryRun({ displayPrompt: "继续" }, env.target, {
    schedulingMode: "event_driven", resumeTaskId: run.taskId, resumeRequested: true,
  });
  await flush();
  assert.match(env.mains[resumeIndex].request.prompt, /Loop\+ 继续执行/);
  assert.match(env.mains[resumeIndex].request.prompt, /state\.review_batch\.mismatch/);
  const repairPrompt = env.mains[resumeIndex].request.prompt.split("Loop+ 继续执行")[1];
  assert.doesNotMatch(repairPrompt, /### 恢复条件/);
  assert.equal(env.tasks.get(run.taskId ?? "")?.finalSummary, undefined);
  env.mains[resumeIndex].resolve(directCompletionDecision());
  await resumed.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
});

test("explicit resume with a supplement restores the prior rejection after host reload", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "完成实现" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  const resumeIndex = await exhaustProtocolBudget(env, run, 0, '{"status":"wait","reportEventIds":["stale"]}');
  const resumedHost = env.reloadHost();
  const resumed = resumedHost.tryRun({ displayPrompt: "继续" }, env.target, {
    resumeTaskId: run.taskId, resumeRequested: true, resumeUserMessage: "不要确认旧报告",
  });
  await flush();
  assert.match(env.mains[resumeIndex].request.prompt, /不要确认旧报告/);
  assert.match(env.mains[resumeIndex].request.prompt, /state\.report_batch\.mismatch/);
  resumedHost.stopParent(run.taskId!);
  await resumed.done;
});

test("persistent idle wait decisions stop after three automatic continuations", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "完成剩余要求" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  await exhaustProtocolBudget(env, run, 0, decisionJson({ status: "wait" }));
  assert.equal(env.attempts.length, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "needs-review");
  assert.match(env.tasks.get(run.taskId ?? "")?.finalSummary ?? "", /wait 无法推进/);
  assert.equal(env.messages.includes("loop-plus-protocol-paused"), true);
});

test("routes wait, dispatch, and blocked decisions through separate strategies", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "wait", estimatedRemainingRounds: 9 }));
  await flush();
  const taskId = run.taskId ?? "";
  assert.equal(env.tasks.get(taskId)?.status, "running");
  assert.equal(env.tasks.get(taskId)?.estimatedRemainingRounds, undefined);
  assert.equal(env.tasks.get(taskId)?.finalSummary, undefined);
  assert.equal(env.messages.filter((item) => item === "loop-plus-idle-wait").length, 0);
  assert.equal(env.messages.includes("loop-plus-waiting"), false);
  assert.equal(env.attempts.length, 0);

  assert.equal(env.mains[1]?.request.kind, "continue");
  assert.match(env.mains[1].request.prompt, /wait 无法推进/);
  env.mains[1].resolve(decisionJson({
    status: "dispatch",
    estimatedRemainingRounds: 3,
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0]?.request.subtaskId, "alpha");
  assert.equal(env.tasks.get(taskId)?.status, "running");
  assert.equal(env.tasks.get(taskId)?.estimatedRemainingRounds, 3);
  assert.equal(env.messages.includes("loop-plus-waiting"), false);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-dispatched").length, 1);

  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const reviews = () => env.mains.filter((item) => item.request.kind === "review");
  const held = reviews()[0];
  assert.ok(held);
  const eventId = held.request.reviewEventId;
  held.resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(snapshotOf(env.tasks.get(taskId)).currentReview?.eventId, eventId);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 2);
  assert.equal(reviews()[1]?.request.reviewEventId, eventId);

  reviews()[1].resolve(decisionJson({ status: "wait" }));
  await flush();
  assert.equal(env.attempts.length, 1, "wait during an open review does not dispatch");
  assert.equal(reviews()[2]?.request.reviewEventId, eventId);
  reviews()[2].resolve(decisionJson({ status: "wait" }));
  await flush();
  assert.equal(reviews()[3]?.request.reviewEventId, eventId);
  reviews()[3].resolve(decisionJson({ status: "wait" }));
  await run.done;
  assert.equal(env.tasks.get(taskId)?.status, "needs-review");
  assert.equal(env.messages.filter((item) => item === "loop-plus-idle-wait").length, 0);
  assert.equal(snapshotOf(env.tasks.get(taskId)).currentReview?.eventId, eventId);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 5);
  assert.equal(reviews().length, 4);
  const resumed = env.host.tryRun({ displayPrompt: "继续" }, env.target, { resumeTaskId: taskId, resumeRequested: true });
  await flush();
  assert.equal(reviews()[4]?.request.reviewEventId, eventId);

  reviews()[4].resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "need a person" }));
  await flush();
  reviews()[5].resolve(decisionJson({ status: "blocked", finalSummary: "need a person" }));
  await resumed.done;
  assert.equal(env.tasks.get(taskId)?.status, "needs-review");
  assert.equal(env.tasks.get(taskId)?.finalSummary, buildLoopBlockerSummary(loopBlockerFixture("need a person")));
  assert.equal(env.tasks.get(taskId)?.estimatedRemainingRounds, 3);
  assert.equal(env.messages.includes("loop-plus-blocked"), true);
  assert.equal(env.messages.includes("loop-plus-completed"), false);
  assert.equal(snapshotOf(env.tasks.get(taskId)).currentReview, null);
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).reviewQueue.map((item) => item.eventId), [eventId]);
  assert.equal(env.attempts.length, 1);
});

test("freezes in-flight review, then confirms the next FIFO batch in its original order", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"]),
    subtask("gamma", ["src/gamma.ts"]), subtask("delta", ["src/delta.ts"]),
  ] }));
  await flush();
  assert.equal(env.attempts.length, 4);
  const [alpha, beta, gamma, delta] = env.attempts;
  const id = (attempt: AttemptCall) => buildLoopPlusFinishEventId(attempt.request.subtaskId, attempt.request.attemptId);
  const reviews = () => env.mains.filter((item) => item.request.kind === "review");
  const reviewed = () => snapshotOf(env.tasks.get(taskId)).seenAttempts.filter((item) => item.disposition === "reviewed");
  alpha.resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const first = reviews()[0];
  assert.deepEqual(first.request.reviewEventIds, [id(alpha)]);
  assert.equal(snapshotOf(env.tasks.get(taskId)).running.length, 3, "first finish starts review without a barrier");
  beta.resolve({ outcome: "completed", detail: "beta" });
  gamma.resolve({ outcome: "completed", detail: "gamma" });
  await flush();
  assert.equal(first.abortCount, 0);
  assert.equal(reviews().length, 1);
  assert.deepEqual(first.request.reviewEventIds, [id(alpha)]);
  assert.match(first.request.prompt, /Acceptance batch count: 1/);
  assert.ok(first.request.prompt.includes("1. " + id(alpha) + "\nReview queue count: 2"));
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).reviewQueue.map((item) => item.eventId), [id(beta), id(gamma)]);
  first.resolve(decisionJson({ status: "accept", reviewEventId: id(alpha), subtasks: [] }));
  await flush();
  assert.equal(reviewed().length, 1);
  const second = reviews()[1];
  assert.deepEqual(second.request.reviewEventIds, [id(beta), id(gamma)]);
  delta.resolve({ outcome: "failed", detail: "delta" });
  await flush();
  assert.equal(second.abortCount, 0);
  assert.deepEqual(second.request.reviewEventIds, [id(beta), id(gamma)]);
  second.resolve(decisionJson({ status: "accept", reviewEventIds: [id(gamma), id(beta)], subtasks: [] }));
  await flush();
  assert.equal(reviewed().length, 1, "reordering confirms no events");
  assert.deepEqual(reviews()[2].request.reviewEventIds, [id(beta), id(gamma)], "protocol repair keeps the original batch");
  reviews()[2].resolve(decisionJson({ status: "accept", reviewEventIds: [id(beta), id(gamma)], subtasks: [] }));
  await flush();
  assert.deepEqual(reviewed().map((item) => item.subtaskId), ["alpha", "beta", "gamma"]);
  assert.deepEqual(reviews()[3].request.reviewEventIds, [id(delta)]);
  reviews()[3].resolve(decisionJson({ status: "accept", reviewEventId: id(delta), subtasks: [], reviews: [
    { reviewEventId: id(delta), acceptance: "failed", reason: "execution failed", subtaskIds: [], noRepairReason: "此测试只验证冻结批次结算" },
  ] }));
  await flush();
  assert.equal(reviewed().length, 4);
  assert.equal(reviewed().find((item) => item.subtaskId === "delta")?.acceptance, "failed");
  assert.equal(env.acceptanceFeedback.length, 3);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 1);
  assert.equal(env.tasks.get(taskId)?.mainAiFailureCount ?? 0, 0);
  assert.equal(env.messages.includes("loop-plus-completed"), false);
  env.host.stopParent(taskId);
  await run.done;
});

test("completed submits a frozen batch once while late events and messages block global completion", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["a.ts"]), subtask("beta", ["b.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const first = env.mains[1];
  assert.equal(first.request.userMessageCount, 0);
  env.host.submitUserMessage(taskId, "late requirement");
  env.attempts[1].resolve({ outcome: "completed", detail: "beta" });
  await flush();
  first.resolve(completedDecision({ reviewEventId: first.request.reviewEventId }));
  await flush();
  const second = env.mains[2];
  const snapshot = snapshotOf(env.tasks.get(taskId));
  assert.equal(snapshot.seenAttempts.filter((item) => item.disposition === "reviewed").length, 1);
  assert.deepEqual(second.request.reviewEventIds, [buildLoopPlusFinishEventId("beta", env.attempts[1].request.attemptId)]);
  assert.deepEqual(snapshot.userMessageQueue, ["late requirement"]);
  assert.equal(second.request.userMessageCount, 1);
  assert.equal(env.tasks.get(taskId)?.status, "running");
  assert.equal(env.tasks.get(taskId)?.answerConclusion, undefined);
  assert.equal(env.messages.includes("loop-plus-completed"), false);
  env.host.submitUserMessage(taskId, "newer requirement");
  second.resolve(completedDecision({ reviewEventId: second.request.reviewEventId }));
  await flush();
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).userMessageQueue, ["newer requirement"]);
  assert.equal(env.mains[3].request.kind, "user");
  assert.equal(env.mains[3].request.userMessageCount, 1);
  env.mains[3].resolve(completedDecision());
  await run.done;
  assert.equal(snapshotOf(env.tasks.get(taskId)).completed, true);
  assert.equal(env.acceptanceFeedback.length, 2);
});

test("main failure, protocol pause and explicit resume retain the unconfirmed batch and message prefix", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId ?? "";
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["a.ts"]), subtask("beta", ["b.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const first = env.mains[1];
  env.attempts[1].resolve({ outcome: "completed", detail: "beta" });
  env.host.submitUserMessage(taskId, "after frozen prefix");
  await flush();
  first.reject(new Error("temporary main failure"));
  await flush();
  assert.equal(env.tasks.get(taskId)?.mainAiFailureCount, 1);
  for (let retry = 2; retry <= 3; retry += 1) {
    assert.deepEqual(env.mains[retry].request.reviewEventIds, first.request.reviewEventIds);
    assert.equal(env.mains[retry].request.userMessageCount, 0);
    env.mains[retry].resolve(retry % 2 ? '{"status":' : decisionJson({ status: "unknown" }));
    await flush();
  }
  await run.done;
  assert.equal(env.tasks.get(taskId)?.status, "needs-review");
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts.filter((item) => item.disposition === "reviewed").length, 0);
  const resumed = env.host.tryRun({ displayPrompt: "continue" }, env.target, { resumeTaskId: taskId, resumeRequested: true });
  await flush();
  const retry = env.mains[4];
  assert.deepEqual(retry.request.reviewEventIds, first.request.reviewEventIds);
  assert.equal(retry.request.userMessageCount, 0);
  retry.resolve(decisionJson({ status: "accept", reviewEventId: retry.request.reviewEventId, subtasks: [] }));
  await flush();
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts.filter((item) => item.disposition === "reviewed").length, 1);
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).userMessageQueue, ["after frozen prefix"]);
  const last = env.mains[5];
  assert.deepEqual(last.request.reviewEventIds, [buildLoopPlusFinishEventId("beta", env.attempts[1].request.attemptId)]);
  assert.equal(last.request.userMessageCount, 1);
  last.resolve(completedDecision({ reviewEventId: last.request.reviewEventId }));
  await resumed.done;
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts.filter((item) => item.disposition === "reviewed").length, 2);
  assert.equal(env.tasks.get(taskId)?.status, "completed");
});

test("does not let completed bypass running work or user messages the request did not capture", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const reviews = () => env.mains.filter((item) => item.request.kind === "review");
  const alphaEventId = buildLoopPlusFinishEventId("alpha", alpha.request.attemptId);
  reviews()[0].resolve(completedDecision({ reviewEventId: alphaEventId }));
  await flush();
  const taskId = run.taskId ?? "";
  assert.notEqual(env.tasks.get(taskId)?.status, "completed");
  assert.equal(env.messages.includes("loop-plus-completed"), false);
  assert.equal(snapshotOf(env.tasks.get(taskId)).running.some((item) => item.subtaskId === "beta"), true);
  assert.equal(reviews().length, 1);

  beta.resolve({ outcome: "completed", detail: "beta" });
  await flush();
  const betaEventId = buildLoopPlusFinishEventId("beta", beta.request.attemptId);
  assert.equal(reviews()[1]?.request.reviewEventId, betaEventId);
  reviews()[1].resolve(decisionJson({
    status: "accept",
    reviewEventId: betaEventId,
    subtasks: [],
    estimatedRemainingRounds: 2,
  }));
  await flush();
  const closeout = env.mains.find((item) => item.request.kind === "closeout");
  assert.ok(closeout);
  assert.equal(env.tasks.get(taskId)?.estimatedRemainingRounds, 2);
  assert.equal(env.host.submitUserMessage(taskId, "before closeout finishes"), true);
  closeout.resolve(completedDecision());
  await flush();
  assert.notEqual(env.tasks.get(taskId)?.status, "completed");
  assert.equal(env.tasks.get(taskId)?.answerConclusion, undefined);
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).userMessageQueue, ["before closeout finishes"]);
  const users = () => env.mains.filter((item) => item.request.kind === "user");
  assert.equal(users()[0]?.request.userMessageCount, 1);
  assert.match(users()[0].request.prompt, /before closeout finishes/);

  assert.equal(env.host.submitUserMessage(taskId, "arrived during the user decision"), true);
  users()[0].resolve(completedDecision());
  await flush();
  assert.notEqual(env.tasks.get(taskId)?.status, "completed");
  assert.equal(env.tasks.get(taskId)?.estimatedRemainingRounds, 2);
  assert.equal(users().length, 2);
  assert.equal(users()[1]?.request.userMessageCount, 1);
  assert.match(users()[1].request.prompt, /arrived during the user decision/);
  assert.equal(users()[1].request.prompt.includes("before closeout finishes"), false);

  users()[1].resolve(completedDecision());
  await flush();
  assert.equal(env.tasks.get(taskId)?.status, "completed");
  assert.equal(env.tasks.get(taskId)?.answerConclusion, "finished");
  assert.equal(env.tasks.get(taskId)?.finalSummary, "everything passed");
  assert.equal(env.tasks.get(taskId)?.estimatedRemainingRounds, 0);
  assert.equal(snapshotOf(env.tasks.get(taskId)).completed, true);
  assert.deepEqual(snapshotOf(env.tasks.get(taskId)).userMessageQueue, []);
  assert.equal(env.messages.includes("loop-plus-completed"), true);
});

function reviewedRoundsScheduler(rounds = 0, maxConcurrency = 2) {
  const scheduler = createLoopPlusScheduler({ maxConcurrency });
  for (let index = 0; index < rounds; index += 1) {
    const subtaskId = `previous-${index}`;
    const attemptId = `previous-attempt-${index}`;
    scheduler.dispatch([{ subtaskId, attemptId, title: subtaskId, writeFiles: [`previous-${index}.ts`] }]);
    scheduler.finish({ subtaskId, attemptId, outcome: "completed" });
    assert.equal(scheduler.submitReview(buildLoopPlusFinishEventId(subtaskId, attemptId)).ok, true);
  }
  return scheduler;
}

function twoFinishedReviews(previousRounds = 0): LoopPlusSchedulerSnapshot {
  const scheduler = reviewedRoundsScheduler(previousRounds);
  scheduler.dispatch([
    { subtaskId: "alpha", attemptId: "a1", title: "alpha", writeFiles: ["src/alpha.ts"] },
    { subtaskId: "beta", attemptId: "b1", title: "beta", writeFiles: ["src/beta.ts"] },
  ]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "a1", outcome: "completed", detail: "alpha" });
  scheduler.finish({ subtaskId: "beta", attemptId: "b1", outcome: "completed", detail: "beta" });
  return scheduler.snapshot();
}

test("allows completed to confirm an existing batch after many dispatches", async () => {
  const env = harness();
  const task = baseTask("limited-batch", twoFinishedReviews(49));
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
    resumeTaskId: task.id, schedulingMode: "event_driven",
  });
  await flush();
  assert.equal(env.mains.length, 1);
  assert.equal(env.mains[0].request.reviewEventIds?.length, 2);
  env.mains[0].resolve(completedDecision({ reviewEventIds: env.mains[0].request.reviewEventIds }));
  await run.done;
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  assert.equal(env.messages.includes("loop-plus-subtask-round-limit"), false);
});

test("dispatches new Loop+ subtasks after many completed historical attempts", async () => {
  const env = harness();
  const task = baseTask("unlimited-dispatch", twoFinishedReviews(200));
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
    resumeTaskId: task.id,
    schedulingMode: "event_driven",
  });
  await flush();
  const review = env.mains[0];
  review.resolve(acceptWithIndependentWork(review.request.reviewEventIds!, [subtask("gamma", ["src/gamma.ts"])]));
  await flush();
  const snapshot = snapshotOf(env.tasks.get(task.id));
  assert.equal(snapshot.seenAttempts.length, 203);
  assert.ok(snapshot.seenAttempts.length > 200);
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0].request.subtaskId, "gamma");
  assert.equal(env.tasks.get(task.id)?.status, "running");
  assert.equal(env.messages.includes("loop-plus-subtask-round-limit"), false);
  env.host.stopParent(task.id);
  await run.done;
});

test("dispatches new Loop+ subtasks when the historical attempt count exceeds the former minimum limit", async () => {
  const scheduler = reviewedRoundsScheduler(49, 1);
  scheduler.dispatch([{ subtaskId: "alpha", attemptId: "a1", title: "alpha", writeFiles: ["src/alpha.ts"] }]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "a1", outcome: "completed", detail: "alpha" });
  assert.equal(scheduler.submitReview(buildLoopPlusFinishEventId("alpha", "a1")).ok, true);
  const env = harness();
  const task = baseTask("dispatch-above-former-minimum", scheduler.snapshot());
  env.tasks.set(task.id, task);
  env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
    resumeTaskId: task.id,
    resumeRequested: true,
    schedulingMode: "event_driven",
  });
  await flush();
  assert.equal(env.mains[0]?.request.kind, "continue");
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0].request.subtaskId, "beta");
  assert.equal(env.messages.includes("loop-plus-subtask-round-limit"), false);
  assert.equal(env.tasks.get(task.id)?.status, "running");
  env.host.stopParent(task.id);
});

test("records each Loop+ subtask's own execution start time", async () => {
  let clock = 1_000;
  const env = harness({
    maxConcurrency: 2,
    now: () => clock,
    launchDelayMs: (last, now) => last === null ? 0 : Math.max(0, 3_000 - (now - last)),
    delay: async (ms) => {
      clock += ms;
    },
  });
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 2);
  const task = Array.from(env.tasks.values())[0];
  const alpha = task?.subTasks.find((item) => item.id === "alpha");
  const beta = task?.subTasks.find((item) => item.id === "beta");
  assert.equal(alpha?.lastStartedAt, 1_000);
  assert.equal(beta?.lastStartedAt, 4_000);
  assert.notEqual(alpha?.lastStartedAt, beta?.lastStartedAt);
  assert.equal(alpha?.updatedAt, beta?.updatedAt);
});

test("steer closes one running subtask and reprompts another without an acceptance event", async () => {
  const notices: LoopPlusSubtaskChatNotice[] = [];
  const env = harness({
    appendSubtaskChat: (_target, notice) => {
      notices.push(notice);
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  assert.equal(env.host.submitUserMessage(run.taskId ?? "", "close alpha and redirect beta"), true);
  await flush();
  const steer = env.mains[1];
  assert.equal(steer.request.kind, "user");
  const nextPrompt = longPrompt("beta-next", ["src/beta-next.ts"]);
  const nextTitle = "按补充需求修正 beta";
  for (const attempt of [alpha, beta]) {
    await scheduleAutoCompactAfterPrompt({ displayPrompt: "完成", modelPrompt: "完成", contextTags: [], taskRole: "subtask", loopTaskId: attempt.request.taskId, loopSubtaskId: attempt.request.subtaskId, loopAttemptId: attempt.request.attemptId }, { cli: "codex", tabId: "controlled-tab", sessionId: `controlled-${attempt.request.subtaskId}` }, async () => assert.fail("retired attempts must not compact"));
  }
  steer.resolve(decisionJson({
    status: "steer",
    controls: [
      { id: "alpha", action: "close", reason: "用户取消该需求" },
      { id: "beta", action: "reprompt", title: nextTitle, prompt: nextPrompt, writeFiles: ["src/beta-next.ts"] },
    ],
  }));
  await flush();

  await loopSubtaskAutoCompactions.wait("codex", "controlled-alpha");
  await loopSubtaskAutoCompactions.wait("codex", "controlled-beta");
  const task = env.tasks.get(run.taskId ?? "");
  const snapshot = snapshotOf(task);
  assert.equal(snapshot.reviewQueue.length, 0);
  assert.equal(snapshot.currentReview, null);
  assert.equal(snapshot.seenAttempts.find((item) => item.attemptId === alpha.request.attemptId)?.disposition, "closed");
  assert.equal(snapshot.seenAttempts.find((item) => item.attemptId === beta.request.attemptId)?.disposition, "closed");
  assert.equal(snapshot.seenAttempts.some((item) => item.disposition === "reviewed"), false);
  assert.equal(snapshot.running.some((item) => item.subtaskId === "alpha"), false);
  const restarted = env.attempts.filter((item) => item.request.subtaskId === "beta");
  assert.equal(restarted.length, 2);
  assert.equal(restarted[1].request.prompt, nextPrompt);
  assert.equal(restarted[1].request.title, nextTitle);
  assert.equal(restarted[1].request.continueFromSubtaskId, "beta");
  assert.deepEqual(restarted[1].request.writeFiles, ["src/beta-next.ts"]);
  assert.equal(snapshot.running.some((item) => item.attemptId === restarted[1].request.attemptId), true);
  assert.equal(snapshot.running.find((item) => item.subtaskId === "beta")?.title, nextTitle);
  assert.equal(env.reports.some((item) => item.attemptId === alpha.request.attemptId), false);
  assert.equal(env.reports.some((item) => item.attemptId === beta.request.attemptId), false);
  assert.deepEqual(env.abortedAttemptIds, [alpha.request.attemptId, beta.request.attemptId]);
  assert.deepEqual(env.closeTabAttemptIds, [alpha.request.attemptId, beta.request.attemptId]);
  assert.equal(task?.subTasks.find((item) => item.id === "alpha")?.status, "blocked");
  assert.match(task?.subTasks.find((item) => item.id === "alpha")?.summary ?? "", /用户取消该需求/u);
  alpha.resolve({ outcome: "completed", detail: "迟到结果" });
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).currentReview, null);
  assert.equal(task?.subTasks.find((item) => item.id === "beta")?.prompt, nextPrompt);
  assert.equal(task?.subTasks.find((item) => item.id === "beta")?.title, nextTitle);
  assert.equal(task?.subTasks.find((item) => item.id === "beta")?.status, "running");
  assert.equal(notices.some((notice) => (
    notice.subtaskId === "alpha" && notice.phase === "finished" && notice.runStatus === "stopped"
  )), true);
  assert.equal(notices.some((notice) => (
    notice.subtaskId === "beta" && notice.phase === "started" && notice.title === nextTitle
  )), true);
  assert.equal(notices.some((notice) => (
    notice.subtaskId === "beta"
    && notice.phase === "finished"
    && notice.assistantContent === "主任务已中断该子任务，并改用新的提示词继续执行。"
  )), true);
});

test("does not interrupt an existing attempt until reprompt includes the corrected title", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  const taskId = run.taskId ?? "";
  const original = env.attempts[0];
  assert.equal(env.host.submitUserMessage(taskId, "根据补充要求纠正 alpha，并更新标题"), true);
  await flush();
  const nextPrompt = longPrompt("alpha-corrected", ["src/alpha.ts"]);
  env.mains[1].resolve(decisionJson({
    status: "steer",
    controls: [{ id: "alpha", action: "reprompt", prompt: nextPrompt }],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.deepEqual(env.abortedAttemptIds, []);
  assert.equal(env.tasks.get(taskId)?.subTasks[0]?.title, "alpha");
  assert.equal(snapshotOf(env.tasks.get(taskId)).running[0]?.attemptId, original.request.attemptId);
  assert.equal(env.logs.some((item) => item.event === "loop-plus-protocol-miss"), true);

  const nextTitle = "按补充要求修正 alpha";
  env.mains[2].resolve(decisionJson({
    status: "steer",
    controls: [{ id: "alpha", action: "reprompt", title: nextTitle, prompt: nextPrompt }],
  }));
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.deepEqual(env.abortedAttemptIds, [original.request.attemptId]);
  assert.equal(env.attempts[1].request.title, nextTitle);
  assert.equal(env.tasks.get(taskId)?.subTasks[0]?.title, nextTitle);
});

test("main controls can close or reprompt interrupted open subtasks", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"]),
  ] }));
  await flush();
  env.attempts.forEach((attempt) => attempt.resolve({ outcome: "stopped", detail: "stopped" }));
  await flush();
  assert.equal(env.mains.length, 1);
  env.host.submitUserMessage(run.taskId ?? "", "close alpha and reprompt beta");
  await flush();
  env.mains[1].resolve(decisionJson({ status: "steer", controls: [
    { id: "alpha", action: "close" },
    { id: "beta", action: "reprompt", title: "继续修正 beta", prompt: longPrompt("beta", ["src/beta.ts"]) },
  ] }));
  await flush();
  assert.deepEqual(env.closeTabAttemptIds, env.attempts.slice(0, 2).map((item) => item.request.attemptId));
  assert.equal(env.attempts.length, 3);
  const snapshot = snapshotOf(env.tasks.get(run.taskId ?? ""));
  assert.equal(snapshot.currentReview, null);
  assert.equal(snapshot.running.length, 1);
  assert.equal(snapshot.running[0]?.attemptId, env.attempts[2].request.attemptId);
  assert.equal(env.tasks.get(run.taskId ?? "")?.subTasks.find((item) => item.id === "beta")?.status, "running");
});

test("does not steer while an acceptance batch is open", async () => {
  const env = harness();
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  const before = env.attempts.length;
  review.resolve(decisionJson({
    status: "steer",
    controls: [{ id: "beta", action: "close" }],
  }));
  await flush();
  assert.equal(env.logs.some((item) => item.event === "loop-plus-protocol-miss"), true);
  assert.equal(env.abortedAttemptIds.length, 0);
  assert.equal(env.attempts.length, before);
  const task = Array.from(env.tasks.values())[0];
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.equal(snapshotOf(task).running.some((item) => item.subtaskId === "beta"), true);
});

test("restored Loop+ runtime reprompts the later subtask with a fresh attempt id", async () => {
  const closedSubtasks: string[] = [];
  const env = harness({ closeSubtaskTabs: async (taskId, subtaskId) => { closedSubtasks.push(`${taskId}:${subtaskId}`); } });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const taskId = run.taskId ?? "";
  const reloaded = env.reloadHost();
  assert.equal(reloaded.tryRun(
    { displayPrompt: "ship the feature" },
    env.target,
    { resumeTaskId: taskId, schedulingMode: "event_driven" },
  ).handled, true);
  await flush();
  assert.equal(reloaded.submitUserMessage(taskId, "redirect beta after reload"), true);
  await flush();
  const steer = env.mains.filter((item) => item.request.kind === "user").at(-1);
  assert.ok(steer);
  const nextPrompt = longPrompt("beta-reloaded", ["src/beta.ts"]);
  steer.resolve(decisionJson({
    status: "steer",
    controls: [{ id: "beta", action: "reprompt", title: "恢复后修正 beta", prompt: nextPrompt }],
  }));
  await flush();
  const betaAttempts = snapshotOf(env.tasks.get(taskId)).seenAttempts.filter((item) => item.subtaskId === "beta");
  assert.deepEqual(betaAttempts.map((item) => item.disposition), ["closed", "open"]);
  assert.notEqual(betaAttempts[1]?.attemptId, betaAttempts[0]?.attemptId);
  const restarted = env.attempts.filter((item) => item.request.subtaskId === "beta");
  assert.equal(restarted.at(-1)?.request.prompt, nextPrompt);
  assert.equal(restarted.at(-1)?.request.title, "恢复后修正 beta");
  assert.equal(env.tasks.get(taskId)?.subTasks.find((item) => item.id === "beta")?.title, "恢复后修正 beta");
  assert.equal(env.logs.some((item) => item.event === "loop-plus-protocol-miss"), false);
  assert.deepEqual(closedSubtasks, [`${taskId}:beta`]);
});

function clarificationDecision(): string {
  return decisionJson({
    status: "clarify",
    finalSummary: "需要确认范围",
    clarification: {
      title: "需要确认需求",
      instruction: "请选择范围",
      formFields: [{
        id: "scope",
        label: "范围",
        type: "radio",
        required: true,
        options: [
          { label: "只改接口", value: "api" },
          { label: "接口和调用方", value: "all" },
        ],
      }],
    },
  });
}

test("continues Loop+ after the user submits the main-task clarification form", async () => {
  const removedResponses: Array<{ target: LoopPlusPromptTarget; taskId: string; response: string }> = [];
  const env = harness({
    removeClarificationResponse: (target, taskId, response) => removedResponses.push({ target, taskId, response }),
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  const taskId = run.taskId ?? "";
  env.mains[0].resolve(clarificationDecision());
  await flush();
  const waiting = env.tasks.get(taskId);
  assert.equal(waiting?.status, "running");
  assert.equal(waiting?.clarificationCount, 1);
  assert.equal(waiting?.pendingClarification?.formFields[0]?.id, "scope");
  assert.deepEqual(removedResponses, [{ target: env.target, taskId, response: clarificationDecision() }]);
  assert.equal(env.mains.length, 1);
  const delivered = submitOrchestratorClarification(
    loopClarificationScope(taskId),
    waiting?.pendingClarification?.interactionId ?? "",
    { scope: "api" },
  );
  assert.equal(delivered.ok, true);
  await flush();
  const continued = env.tasks.get(taskId);
  assert.equal(continued?.pendingClarification, undefined);
  assert.equal(continued?.status, "running");
  assert.match(continued?.supplementalRequirements?.join("\n") ?? "", /用户已提交主任务澄清表单/);
  assert.match(continued?.supplementalRequirements?.join("\n") ?? "", /只改接口/);
  assert.equal(env.mains.length, 2);
  assert.equal(env.mains[1]?.request.kind, "continue");
  assert.match(env.mains[1]?.request.prompt ?? "", /用户已提交主任务澄清表单/);
});

test("Loop+ routes main-task clarification through the injected desktop-attention adapter", async () => {
  let waitingScope: string | undefined;
  const env = harness({
    waitForClarification: async (scopeId, clarification) => {
      waitingScope = scopeId;
      return { interactionId: clarification.interactionId, status: "completed", values: { scope: "api" } };
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(clarificationDecision());
  await flush();
  assert.equal(waitingScope, loopClarificationScope(run.taskId ?? ""));
  assert.equal(env.mains.length, 2);
  assert.equal(env.tasks.get(run.taskId ?? "")?.pendingClarification, undefined);
  env.host.stopParent(run.taskId ?? "");
});

test("continues Loop+ with the best plan when clarification times out", async () => {
  const env = harness({ clarificationTimeoutMs: () => 20 });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  const taskId = run.taskId ?? "";
  env.mains[0].resolve(clarificationDecision());
  await new Promise((resolve) => setTimeout(resolve, 40));
  await flush();
  const continued = env.tasks.get(taskId);
  assert.equal(continued?.pendingClarification, undefined);
  assert.equal(continued?.status, "running");
  assert.match(continued?.supplementalRequirements?.join("\n") ?? "", /未在时限内回答/);
  assert.equal(env.messages.includes("loop-plus-clarification-rejected"), false);
  assert.equal(env.mains.length, 2);
  assert.equal(env.mains[1]?.request.kind, "continue");
  assert.match(env.mains[1]?.request.prompt ?? "", /未在时限内回答/);
});

test("pauses Loop+ when the user rejects main-task clarification", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  const taskId = run.taskId ?? "";
  env.mains[0].resolve(clarificationDecision());
  await flush();
  const waiting = env.tasks.get(taskId);
  assert.equal(rejectOrchestratorClarification(
    loopClarificationScope(taskId),
    waiting?.pendingClarification?.interactionId ?? "",
  ), true);
  await flush();
  const paused = env.tasks.get(taskId);
  assert.equal(paused?.status, "needs-review");
  assert.equal(paused?.pendingClarification, undefined);
  assert.equal(env.mains.length, 1);
  assert.equal(env.messages.includes("loop-plus-clarification-rejected"), true);
});

test("does not open another clarification form after the limit", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  const taskId = run.taskId ?? "";
  const task = env.tasks.get(taskId);
  assert.ok(task);
  task.clarificationCount = 8;
  env.mains[0].resolve(clarificationDecision());
  await flush();
  const paused = env.tasks.get(taskId);
  assert.equal(paused?.status, "needs-review");
  assert.equal(paused?.pendingClarification, undefined);
  assert.equal(paused?.clarificationCount, 8);
  assert.equal(env.mains.length, 1);
});

test("clears a pending Loop+ clarification form when the parent stops", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  const taskId = run.taskId ?? "";
  env.mains[0].resolve(clarificationDecision());
  await flush();
  const interactionId = env.tasks.get(taskId)?.pendingClarification?.interactionId ?? "";
  env.host.stopParent(taskId);
  await flush();
  const stopped = env.tasks.get(taskId);
  assert.equal(stopped?.status, "stopped");
  assert.equal(stopped?.pendingClarification, undefined);
  assert.equal(submitOrchestratorClarification(loopClarificationScope(taskId), interactionId, { scope: "api" }).ok, false);
  assert.equal(env.mains.length, 1);
});

test("passes the confirmed acceptance plan into the created task and every main prompt", async () => {
  const env = harness();
  const run = env.host.tryRun({
    displayPrompt: "ship the feature",
    loopPlusAcceptancePlan: {
      id: "plan-hardening",
      name: "上线前加严",
      checks: ["security", "other"],
      otherText: "确认审计日志不写入密钥",
      systemDefault: false,
    },
  }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains[0].request.kind, "initial");
  assert.match(env.mains[0].request.modelPrompt, /Additional acceptance reviews from the acceptance plan "上线前加严"/);
  assert.match(env.mains[0].request.modelPrompt, /Security review: defensive code review only/);
  assert.match(env.mains[0].request.modelPrompt, /确认审计日志不写入密钥/);

  const stored = env.tasks.get(run.taskId ?? "");
  assert.deepEqual(stored?.loopPlusAcceptancePlan, {
    id: "plan-hardening",
    name: "上线前加严",
    checks: ["security", "other"],
    otherText: "确认审计日志不写入密钥",
    systemDefault: false,
  });

  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.find((call) => call.request.kind === "review");
  assert.ok(review, "a review prompt should follow");
  assert.match(review.request.modelPrompt, /Additional acceptance reviews from the acceptance plan/);
  assert.match(review.request.modelPrompt, /确认审计日志不写入密钥/);
});

test("a group-chat acceptance plan change restarts the in-flight review with the new snapshot", async () => {
  const env = harness({ deferMainAbort: true });
  const run = env.host.tryRun({
    displayPrompt: "ship the feature",
    loopPlusAcceptancePlan: {
      id: "plan-security",
      name: "安全",
      checks: ["security"],
      otherText: "",
      systemDefault: false,
    },
  }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 2);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const firstReview = env.mains.find((call) => call.request.kind === "review");
  assert.ok(firstReview);
  assert.match(firstReview.request.modelPrompt, /Security review: defensive code review only/);

  const applied = env.host.applyAcceptancePlan(run.taskId ?? "", {
    id: "plan-performance",
    name: "性能",
    checks: ["performance"],
    otherText: "",
    systemDefault: false,
  });
  assert.equal(applied.ok, true);
  assert.equal(firstReview.abortCount, 1);
  env.attempts[1].resolve({ outcome: "completed", detail: "beta arrived after the frozen batch" });
  firstReview.releaseAbort(completedDecision({ reviewEventId: firstReview.request.reviewEventId }));
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts.filter((item) => item.disposition === "reviewed").length, 0);
  assert.equal(env.acceptanceFeedback.length, 0);
  assert.equal(env.messages.includes("loop-plus-completed"), false);

  const reviews = env.mains.filter((call) => call.request.kind === "review");
  assert.equal(reviews.length, 2);
  assert.deepEqual(reviews[1].request.reviewEventIds, firstReview.request.reviewEventIds);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).reviewQueue.length, 1);
  assert.match(reviews[1].request.modelPrompt, /Performance review:/);
  assert.doesNotMatch(reviews[1].request.modelPrompt, /Security review: defensive code review only/);
  assert.deepEqual(env.tasks.get(run.taskId ?? "")?.loopPlusAcceptancePlan, {
    id: "plan-performance",
    name: "性能",
    checks: ["performance"],
    otherText: "",
    systemDefault: false,
  });
});

test("a task started without an acceptance plan falls back to the fixed baseline", async () => {
  const env = harness();
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.doesNotMatch(env.mains[0].request.modelPrompt, /Additional acceptance reviews/);
});

test("acceptance repair requires the original member ID before dispatch", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "repair the failed delivery" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("source", ["src/source.ts"])] }));
  await flush();
  const sourceAttempt = env.attempts[0];
  sourceAttempt.resolve({ outcome: "completed", detail: "requires a focused repair" });
  await flush();
  const failedReview = env.mains.at(-1)!;
  const failedEventId = failedReview.request.reviewEventId!;
  failedReview.resolve(decisionJson({ status: "accept", reviewEventId: failedEventId,
    reviews: [{ reviewEventId: failedEventId, acceptance: "failed", subtaskIds: ["repair-alias"] }],
    subtasks: [subtask("repair-alias", ["src/source.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.acceptanceFeedback.length, 0);
  assert.match(env.mains.at(-1)!.request.prompt, /repair\.linkage_conflict/);
  env.mains.at(-1)!.resolve(decisionJson({ status: "accept", reviewEventId: failedEventId,
    reviews: [{ reviewEventId: failedEventId, acceptance: "failed", subtaskIds: ["source"] }],
    subtasks: [subtask("source", ["src/source.ts"])],
  }));
  await flush();
  const task = env.tasks.get(run.taskId!)!;
  assert.deepEqual(task.subTasks.map((item) => item.id), ["source"]);
  assert.equal(env.attempts[1].request.subtaskId, "source");
  assert.notEqual(env.attempts[1].request.attemptId, sourceAttempt.request.attemptId);
  assert.equal(env.attempts[1].request.continueFromSubtaskId, "source");
  env.host.stopParent(run.taskId!);
  await run.done;
});

test("same-ID acceptance repair preserves the member row without replacement metadata", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ordinary retry" }, env.target, { schedulingMode: "event_driven" });
  await flush(); env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("same", [])] })); await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "requires repair" }); await flush();
  const event = env.mains[1].request.reviewEventId!;
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: event,
    reviews: [{ reviewEventId: event, acceptance: "failed", subtaskIds: ["same"] }], subtasks: [subtask("same", [])] })); await flush();
  assert.equal(env.attempts.length, 2);
  assert.equal(env.tasks.get(run.taskId!)!.subTasks[0].repairSource, undefined);
  env.attempts[1].resolve({ outcome: "completed", detail: "fixed" }); await flush();
  const review = env.mains.at(-1)!; review.resolve(decisionJson({ status: "accept", reviewEventId: review.request.reviewEventId,
    reviews: [{ reviewEventId: review.request.reviewEventId, acceptance: "passed" }], subtasks: [] })); await flush();
  env.mains.at(-1)!.resolve(completedDecision()); await flush(); await run.done;
  const { isDepartmentLeaderCompleted } = require("../../loopPlusCompletion") as typeof import("../../loopPlusCompletion");
  assert.equal(isDepartmentLeaderCompleted(env.tasks.get(run.taskId!)!), true);
});

test("巡检等待中的 Loop+：真实子任务活动时不唤醒，失联后续跑并验收新结果", async () => {
  let active = true;
  const env = harness({ isAttemptActive: () => active, deferAttemptAbort: true });
  const run = env.host.tryRun({ displayPrompt: "实现功能" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("lost", ["src/lost.ts"])] }));
  await flush();
  env.host.checkWaitingTasks();
  await flush();
  assert.equal(env.mains.length, 1);
  active = false;
  env.host.checkWaitingTasks();
  env.host.checkWaitingTasks();
  await flush();
  assert.equal(env.mains.length, 1);
  const snapshot = snapshotOf(env.tasks.get(run.taskId!));
  assert.equal(snapshot.running.length, 1);
  assert.equal(snapshot.currentReview, null);
  assert.equal(env.reports.length, 0);
  assert.equal(env.host.resumeInterruptedSubtasks(run.taskId!), true);
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.equal(env.attempts[1].request.attemptId, env.attempts[0].request.attemptId);
  env.attempts[1].resolve({ outcome: "completed", detail: "续跑完成" });
  await flush();
  assert.equal(env.mains[1].request.kind, "review");
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).currentReview?.outcome, "completed");
  assert.equal(env.reports.length, 1);
  env.attempts[0].resolve({ outcome: "completed", detail: "迟到的旧结果" });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).currentReview?.outcome, "completed");
  assert.equal(env.maxMains(), 1);
  env.host.stopParent(run.taskId!);
  await run.done;
});

test("Loop+ 巡检保留失联 attempt，继续时重启子任务而非先交主任务验收", async () => {
  let active = true;
  const env = harness({ isAttemptActive: () => active });
  const run = env.host.tryRun({ displayPrompt: "实现功能" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("stopped", ["src/a.ts"])] }));
  await flush();
  active = false;
  env.host.checkWaitingTasks();
  await flush();
  assert.equal(env.mains.length, 1);
  const interruptedSnapshot = snapshotOf(env.tasks.get(run.taskId!));
  assert.equal(interruptedSnapshot.running[0]?.attemptId, env.attempts[0].request.attemptId);
  assert.equal(interruptedSnapshot.currentReview, null);
  assert.equal(env.tasks.get(run.taskId!)?.subTasks[0]?.status, "blocked");
  assert.equal(env.host.resumeInterruptedSubtasks(run.taskId!), true);
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.equal(env.attempts[1].request.attemptId, env.attempts[0].request.attemptId);
  assert.equal(env.attempts[1].request.subtaskId, "stopped");
  assert.equal(env.mains.length, 1);
  env.attempts[1].resolve({ outcome: "completed", detail: "继续后完成" });
  await flush();
  assert.equal(env.mains[1].request.kind, "review");
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).currentReview?.outcome, "completed");
  env.host.stopParent(run.taskId!);
  env.host.checkWaitingTasks();
  await flush();
  assert.equal(env.mains.length, 2);
  assert.equal(env.tasks.get(run.taskId!)?.status, "stopped");
  await run.done;
});

test("Loop+ 巡检不复活暂停、等待澄清、失败上限和已完成任务", async () => {
  for (const state of ["needs-review", "error", "stopped", "completed", "clarification", "failure-limit"] as const) {
    const env = harness({ isAttemptActive: () => false });
    const run = env.host.tryRun({ displayPrompt: "实现功能" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("work", ["src/a.ts"])] }));
    await flush();
    const task = env.tasks.get(run.taskId!)!;
    if (state === "clarification") task.pendingClarification = { interactionId: "pending" } as never;
    else if (state === "failure-limit") task.mainAiFailureLimitReached = true;
    else task.status = state;
    env.host.checkWaitingTasks();
    await flush();
    assert.equal(env.mains.length, 1, state);
    assert.equal(env.reports.length, 0, state);
    env.host.stopParent(run.taskId!);
  }
});

test("Loop+ 同次巡检保留多个失联子任务，续跑完成后合并验收", async () => {
  const env = harness({ isAttemptActive: () => false, deferAttemptAbort: true });
  const run = env.host.tryRun({ displayPrompt: "并行实现功能" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("A", ["src/a.ts"]), subtask("B", ["src/b.ts"])] }));
  await flush();
  env.host.checkWaitingTasks();
  await flush();
  assert.equal(env.mains.length, 1);
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).running.length, 2);
  assert.equal(env.reports.length, 0);
  assert.equal(env.host.resumeInterruptedSubtasks(run.taskId!), true);
  await flush();
  assert.equal(env.attempts.length, 4);
  assert.deepEqual(env.attempts.slice(2).map((item) => item.request.attemptId), env.attempts.slice(0, 2).map((item) => item.request.attemptId));
  env.attempts.slice(2).forEach((attempt) => attempt.resolve({ outcome: "completed", detail: "续跑完成" }));
  await flush();
  assert.equal(env.mains[1].request.kind, "review");
  const finished = snapshotOf(env.tasks.get(run.taskId!));
  const events = [finished.currentReview, ...finished.reviewQueue].filter(Boolean);
  assert.equal(events.length, 2);
  assert.equal(events.every((event) => event?.outcome === "completed"), true);
  assert.equal(env.reports.length, 2);
  assert.equal(env.maxMains(), 1);
  env.host.stopParent(run.taskId!);
  await run.done;

});


// Explicit dependencies use the same controlled host runner as the lifecycle regressions above.
function dependentSubtask(id: string, dependsOn: string[], requiresAcceptance = true): LoopSubtaskDecision {
  return { ...subtask(id, [`src/${id}.ts`]), dependsOn, requiresAcceptance };
}

function attemptEvent(call: AttemptCall): string {
  return buildLoopPlusFinishEventId(call.request.subtaskId, call.request.attemptId);
}

test("successor starts before acceptance while independent work and frozen reviews keep moving", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "显式依赖与独立任务" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    dependentSubtask("successor", ["prerequisite"]), dependentSubtask("prerequisite", []), dependentSubtask("independent", []),
  ] }));
  await flush();
  assert.deepEqual(env.attempts.map((a) => a.request.subtaskId), ["prerequisite", "independent"]);
  assert.deepEqual(env.tasks.get(run.taskId!)?.subTasks.find((s) => s.id === "successor")?.dependsOn, ["prerequisite"]);
  env.attempts[0].resolve({ outcome: "completed", detail: "prerequisite done" });
  await flush();
  const frozen = env.mains[1];
  assert.deepEqual(frozen.request.reviewEventIds, [attemptEvent(env.attempts[0])]);
  assert.match(frozen.request.prompt, /One-time dispatch-first check/);
  assert.deepEqual(env.attempts.map((a) => a.request.subtaskId), ["prerequisite", "independent", "successor"]);
  assert.doesNotMatch(frozen.request.prompt, /reason=review_pending/);
  env.attempts[1].resolve({ outcome: "completed", detail: "later independent completion" });
  await flush();
  assert.deepEqual(frozen.request.reviewEventIds, [attemptEvent(env.attempts[0])]);
  frozen.resolve(decisionJson({ status: "accept", reviewEventId: attemptEvent(env.attempts[0]), subtasks: [] }));
  await flush();
  assert.deepEqual(env.attempts.map((a) => a.request.subtaskId), ["prerequisite", "independent", "successor"]);
  assert.deepEqual(env.attempts[2].request.dependsOn, ["prerequisite"]);
  assert.deepEqual(env.mains[2].request.reviewEventIds, [attemptEvent(env.attempts[1])]);
  env.mains[2].resolve(completedDecision({ reviewEventId: attemptEvent(env.attempts[1]) }));
  await flush();
  assert.equal(env.tasks.get(run.taskId!)?.status, "running", "completed cannot bypass a live successor");
  env.attempts[2].resolve({ outcome: "completed", detail: "successor done" });
  await flush();
  env.mains[3].resolve(completedDecision({ reviewEventId: attemptEvent(env.attempts[2]) }));
  await run.done;
  assert.equal(env.tasks.get(run.taskId!)?.status, "completed");
});

for (const status of ["wait", "dispatch", "completed"] as const) {
  test(`a successor starts before the prerequisite report is acknowledged through ${status}`, async () => {
    const env = harness();
    const run = env.host.tryRun({ displayPrompt: "报告确认释放依赖" }, env.target, { schedulingMode: "event_driven" });
    await flush();
    env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
      dependentSubtask("report-source", [], false), dependentSubtask("report-child", ["report-source"]),
    ] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "report evidence" });
    await flush();
    assert.deepEqual(env.attempts.map((a) => a.request.subtaskId), ["report-source", "report-child"]);
    assert.equal(snapshotOf(env.tasks.get(run.taskId!)).reportQueue?.length, 1);
    const confirmation = { reportEventIds: [attemptEvent(env.attempts[0])] };
    env.mains[1].resolve(status === "completed" ? completedDecision(confirmation) : decisionJson({
      status, ...confirmation, ...(status === "dispatch" ? { subtasks: [dependentSubtask("extra", [])] } : {}),
    }));
    await flush();
    assert.equal(env.attempts.filter((a) => a.request.subtaskId === "report-child").length, 1);
    assert.equal(env.tasks.get(run.taskId!)?.status, "running");
    assert.equal(snapshotOf(env.tasks.get(run.taskId!)).seenAttempts.find((a) => a.subtaskId === "report-source")?.disposition, "reported");
    env.host.stopParent(run.taskId!);
    await run.done;
  });
}

test("a conflict-blocked successor considers the latest prerequisite after the whole review decision", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "整份决策后再准入" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    dependentSubtask("source", []), dependentSubtask("child", ["source"]),
    { ...dependentSubtask("other", []), writeFiles: ["src/child.ts"] },
  ] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "first source" });
  await flush();
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: attemptEvent(env.attempts[0]),
    reviews: [{ reviewEventId: attemptEvent(env.attempts[0]), acceptance: "passed", reason: "first attempt passed" }],
    independentSubtaskIds: ["source"], subtasks: [dependentSubtask("source", [])],
    controls: [{ id: "other", action: "close" }],
  }));
  await flush();
  assert.equal(env.attempts.some((a) => a.request.subtaskId === "child"), false);
  const latestSource = env.attempts.filter((a) => a.request.subtaskId === "source").at(-1)!;
  assert.notEqual(latestSource.request.attemptId, env.attempts[0].request.attemptId);
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).pending.some((a) => a.subtaskId === "child"), true);
  latestSource.resolve({ outcome: "completed", detail: "latest source" });
  await flush();
  assert.equal(env.attempts.filter((a) => a.request.subtaskId === "child").length, 1);
  env.host.stopParent(run.taskId!);
  await run.done;
});

test("failed prerequisite dispatches same-id repair while independent delivery remains live", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "失败依赖可修复" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    dependentSubtask("failed-source", []), dependentSubtask("waiting-child", ["failed-source"]), dependentSubtask("independent", []),
  ] }));
  await flush();
  assert.deepEqual(env.attempts.map((a) => a.request.subtaskId), ["failed-source", "independent"]);
  env.attempts[0].resolve({ outcome: "failed", detail: "validation failed" });
  await flush();
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: attemptEvent(env.attempts[0]),
    reviews: [{ reviewEventId: attemptEvent(env.attempts[0]), acceptance: "failed", reason: "validation failed", subtaskIds: ["failed-source"] }],
    subtasks: [dependentSubtask("failed-source", [])],
  }));
  await flush();
  assert.equal(env.mains.length, 2, "independent execution remains live");
  assert.equal(env.attempts.length, 3);
  assert.equal(env.attempts[2].request.subtaskId, "failed-source");
  env.attempts[1].resolve({ outcome: "completed", detail: "independent passed" });
  await flush();
  env.mains[2].resolve(decisionJson({ status: "accept", reviewEventId: attemptEvent(env.attempts[1]),
    reviews: [{ reviewEventId: attemptEvent(env.attempts[1]), acceptance: "passed", reason: "independent delivery passed" }], subtasks: [] }));
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).seenAttempts[0].acceptance, "failed");
  assert.equal(env.attempts.some((a) => a.request.subtaskId === "waiting-child"), false);
  env.attempts[2].resolve({ outcome: "completed", detail: "repair passed" });
  await flush();
  env.mains[3].resolve(decisionJson({ status: "accept", reviewEventId: attemptEvent(env.attempts[2]),
    reviews: [{ reviewEventId: attemptEvent(env.attempts[2]), acceptance: "passed", reason: "repair passed" }], subtasks: [] }));
  await flush();
  assert.equal(env.attempts[3].request.subtaskId, "waiting-child");
  env.host.stopParent(run.taskId!);
  await run.done;
});

test("rejected failed repair preserves obligation and independent admissions; a later same-ID attempt clears it", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "修复失败交付" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("source", ["source.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "交付存在问题" });
  await flush();
  const review = env.mains[1];
  const failedEventId = review.request.reviewEventIds![0];
  review.resolve(decisionJson({ status: "accept", reviewEventIds: [failedEventId], reviews: [
    { reviewEventId: failedEventId, acceptance: "failed", reason: "验证失败", subtaskIds: ["source"] },
  ], independentSubtaskIds: ["independent"], subtasks: [
    { ...subtask("source", ["source.ts"]), dependsOn: ["missing"] },
    subtask("independent", ["independent.ts"]),
  ] }));
  await flush();
  let snapshot = snapshotOf(env.tasks.get(run.taskId!));
  assert.equal(snapshot.seenAttempts[0].acceptance, "failed");
  assert.equal(snapshot.seenAttempts[0].repairRequired, true);
  assert.equal(snapshot.running.some((item) => item.subtaskId === "independent"), true);
  assert.equal(env.attempts.some((item) => item.request.subtaskId === "source" && item.request.attemptId !== env.attempts[0].request.attemptId), false);
  const correction = env.mains[2];
  assert.match(correction.request.prompt, /Outstanding required repairs.*source/);
  correction.resolve(decisionJson({ status: "completed", finalSummary: "全部完成" }));
  await run.done;
  assert.equal(env.tasks.get(run.taskId!)?.status, "needs-review");
  const resumed = env.host.tryRun({ displayPrompt: "继续返工" }, env.target, { resumeTaskId: run.taskId, resumeRequested: true });
  await flush();
  assert.match(env.mains[3].request.prompt, /Outstanding required repairs.*source/);
  env.mains[3].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("source", ["source.ts"])] }));
  await flush();
  snapshot = snapshotOf(env.tasks.get(run.taskId!));
  assert.equal(snapshot.seenAttempts.some((item) => item.repairRequired), false);
  assert.equal(snapshot.running.concat(snapshot.pending).some((item) => item.subtaskId === "source"), true);
  env.host.stopParent(run.taskId!);
  await resumed.done;
});

async function resumeFrozenReviewAfterLateReport() {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "验收期间读取后到报告" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId!;
  const snapshot = () => snapshotOf(env.tasks.get(taskId));
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    subtask("delivery", ["delivery.ts"]), { ...subtask("report", ["report.md"]), requiresAcceptance: false },
    subtask("in-flight", ["in-flight.ts"]),
  ] }));
  await flush();
  const [delivery, report, inFlight] = env.attempts;
  delivery.resolve({ outcome: "completed", detail: "待验收交付" });
  await flush();
  const frozen = env.mains[1];
  const frozenIds = [attemptEvent(delivery)];
  assert.deepEqual(frozen.request.reviewEventIds, frozenIds);
  assert.deepEqual(frozen.request.reportEventIds, []);
  report.resolve({ outcome: "completed", detail: "LATE_REPORT_EVIDENCE" });
  await flush();
  frozen.resolve(decisionJson({ status: "blocked", finalSummary: "需要读取新报告" }));
  await flush();
  const reportRequest = env.mains[2];
  assert.deepEqual(reportRequest.request.reviewEventIds, []);
  assert.equal(reportRequest.request.reportOnly, true);
  const reportIds = [attemptEvent(report)];
  assert.deepEqual(reportRequest.request.reportEventIds, reportIds);
  assert.match(reportRequest.request.prompt, /LATE_REPORT_EVIDENCE/);
  reportRequest.resolve(decisionJson({ status: "wait", reportEventIds: reportIds }));
  await flush();
  const resumed = env.mains[3];
  assert.deepEqual(resumed.request.reviewEventIds, frozenIds);
  assert.deepEqual(resumed.request.reportEventIds, []);
  assert.deepEqual(snapshot().reportQueue ?? [], []);
  assert.deepEqual(snapshot().seenAttempts.filter((item) => item.disposition === "reported").map((item) => item.attemptId),
    [report.request.attemptId]);
  assert.equal(env.tasks.get(taskId)?.loopPlusBlockReview, undefined);
  return { env, run, taskId, snapshot, resumed, frozenIds, inFlight };
}

test("late no-acceptance report handoff waits after accept and wakes on the next finish", async () => {
  const { env, run, taskId, snapshot, resumed, frozenIds, inFlight } = await resumeFrozenReviewAfterLateReport();
  resumed.resolve(decisionJson({ status: "accept", reviewEventIds: frozenIds }));
  await flush();
  assert.deepEqual(snapshot().running.map((item) => item.attemptId), [inFlight.request.attemptId]);
  assert.equal(snapshot().currentReview, null);
  assert.equal(env.tasks.get(taskId)?.status, "running");
  assert.equal(env.mains.length, 4, "the finished report handoff must not trigger another main request while work is in flight");

  inFlight.resolve({ outcome: "completed", detail: "在途交付已完成" });
  await flush();
  assert.equal(env.mains.length, 5);
  const next = env.mains[4];
  const nextIds = [attemptEvent(inFlight)];
  assert.deepEqual(next.request.reviewEventIds, nextIds);
  assert.deepEqual(next.request.reportEventIds, []);
  next.resolve(completedDecision({ reviewEventIds: nextIds }));
  await flush();
  assert.equal(env.tasks.get(taskId)?.status, "completed");
  await run.done;
});

test("late no-acceptance report handoff still allows a real blocker to trigger review and pause", async () => {
  const { env, run, taskId, snapshot, resumed, frozenIds } = await resumeFrozenReviewAfterLateReport();
  const cause = "外部接口契约仍需负责人确认";
  const blocked = decisionJson({ status: "blocked", finalSummary: cause });
  resumed.resolve(blocked);
  await flush();
  assert.equal(env.tasks.get(taskId)?.loopPlusBlockReview?.state, "pending");
  assert.equal(env.mains.length, 5);
  const recheck = env.mains[4];
  assert.deepEqual(recheck.request.reviewEventIds, frozenIds);
  assert.deepEqual(recheck.request.reportEventIds, []);
  recheck.resolve(blocked);
  await flush();
  assert.equal(env.tasks.get(taskId)?.status, "needs-review");
  assert.equal(env.tasks.get(taskId)?.finalSummary, buildLoopBlockerSummary(loopBlockerFixture(cause)));
  assert.equal(env.messages.filter((item) => item === "loop-plus-block-review").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-blocked").length, 1);
  assert.deepEqual(snapshot().reviewQueue.map((item) => item.eventId), frozenIds);
  assert.equal(env.mains.length, 5);
  await run.done;
});

test("failed repair persistence restores the durable failed obligation and blocks completion", async () => {
  let failRepairWrite = false;
  const env = harness({ beforeUpdateTask: (patch) => {
    const snapshot = patch.loopPlus as LoopPlusSchedulerSnapshot | undefined;
    if (failRepairWrite && snapshot?.seenAttempts.some((item) => item.subtaskId === "source"
      && item.attemptId !== "lp1-source" && item.disposition === "open")) {
      failRepairWrite = false;
      throw new Error("repair write failed");
    }
  } });
  const run = env.host.tryRun({ displayPrompt: "持久化返工" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("source", ["source.ts"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "需要返工" });
  await flush();
  const review = env.mains[1];
  const eventId = review.request.reviewEventIds![0];
  failRepairWrite = true;
  review.resolve(decisionJson({ status: "accept", reviewEventIds: [eventId], reviews: [
    { reviewEventId: eventId, acceptance: "failed", reason: "验证失败", subtaskIds: ["source"] },
  ], subtasks: [subtask("source", ["source.ts"])] }));
  await run.done;
  const durable = snapshotOf(env.tasks.get(run.taskId!));
  assert.equal(durable.seenAttempts[0].acceptance, "failed");
  assert.equal(durable.seenAttempts[0].repairRequired, true);
  assert.equal(durable.running.concat(durable.pending).some((item) => item.subtaskId === "source"), false);
  assert.notEqual(env.tasks.get(run.taskId!)?.status, "completed");
});

test("reprompt inherits dependencies and resets acceptance, explicit empty list clears, invalid graph aborts nothing", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "依赖控制预检" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    dependentSubtask("source", []), dependentSubtask("child", ["source"], false),
  ] }));
  await flush();
  env.host.submitUserMessage(run.taskId!, "调整依赖");
  await flush();
  const control = { id: "child", action: "reprompt", title: "调整后继任务", prompt: longPrompt("child", ["src/child.ts"]) };
  env.mains[1].resolve(decisionJson({ status: "steer", controls: [control] }));
  await flush();
  const inherited = snapshotOf(env.tasks.get(run.taskId!)).pending.find((a) => a.subtaskId === "child")!;
  assert.deepEqual(inherited.dependsOn, ["source"]);
  assert.notEqual(inherited.requiresAcceptance, false);
  assert.deepEqual(env.tasks.get(run.taskId!)?.subTasks.find((a) => a.id === "child")?.dependsOn, ["source"]);
  env.host.submitUserMessage(run.taskId!, "拒绝未知前置");
  await flush();
  const before = snapshotOf(env.tasks.get(run.taskId!));
  env.mains[2].resolve(decisionJson({ status: "dispatch", controls: [{ ...control, dependsOn: ["new-id"] }],
    subtasks: [dependentSubtask("new-id", [])],
  }));
  await flush();
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId!)).seenAttempts, before.seenAttempts);
  assert.equal(env.abortedAttemptIds.length, 0);
  env.mains[3].resolve(decisionJson({ status: "steer", controls: [{ ...control, dependsOn: [] }] }));
  await flush();
  assert.equal(env.attempts[1].request.subtaskId, "child");
  assert.deepEqual(env.attempts[1].request.dependsOn, []);
  assert.deepEqual(env.tasks.get(run.taskId!)?.subTasks.find((a) => a.id === "child")?.dependsOn, []);
  env.host.stopParent(run.taskId!);
  await run.done;
});

test("closed prerequisite wakes dependency planning, impossible wait uses bounded repair and explicit resume recovers", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "关闭依赖后继续规划" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [dependentSubtask("source", []), dependentSubtask("child", ["source"])] }));
  await flush();
  env.host.submitUserMessage(run.taskId!, "关闭前置");
  await flush();
  env.mains[1].resolve(decisionJson({ status: "steer", controls: [{ id: "source", action: "close" }] }));
  await flush();
  assert.match(env.mains[2].request.prompt, /reason=closed/);
  for (let index = 2; index < 4; index += 1) {
    env.mains[index].resolve(decisionJson({ status: "wait" }));
    await flush();
  }
  await run.done;
  assert.equal(env.tasks.get(run.taskId!)?.status, "needs-review");
  assert.equal(env.logs.filter((l) => l.event === "loop-plus-protocol-miss").length, 2);
  const resumed = env.host.tryRun({ displayPrompt: "恢复依赖" }, env.target, { resumeTaskId: run.taskId, resumeRequested: true });
  await flush();
  assert.match(env.mains[4].request.prompt, /reason=closed/);
  env.mains[4].resolve(decisionJson({ status: "steer", controls: [{ id: "child", action: "reprompt", title: "独立执行后继", prompt: longPrompt("child", []), dependsOn: [] }] }));
  await flush();
  assert.equal(env.attempts[1].request.subtaskId, "child");
  env.host.stopParent(run.taskId!);
  await resumed.done;
});

test("immediate resume after dependency promotion failure preserves its lifecycle and drains queued wake once", async () => {
  let rejectPromotion = false;
  const env = harness({ beforeUpdateTask(patch) {
    if (rejectPromotion && (patch.loopPlus as LoopPlusSchedulerSnapshot | undefined)?.running.some((a) => a.subtaskId === "child")) {
      rejectPromotion = false;
      throw new Error("dependency reservation disk failure");
    }
  } });
  const run = env.host.tryRun({ displayPrompt: "依赖准入立即恢复" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [dependentSubtask("source", []), dependentSubtask("child", ["source"])] }));
  await flush();
  const childId = snapshotOf(env.tasks.get(run.taskId!)).pending[0].attemptId;
  rejectPromotion = true;
  env.attempts[0].resolve({ outcome: "completed", detail: "source finished" });
  await run.done;
  const saved = snapshotOf(env.tasks.get(run.taskId!));
  assert.deepEqual(saved.pending.map((a) => a.attemptId), [childId]);
  assert.deepEqual(saved.running, []);
  assert.equal(saved.currentReview?.eventId, attemptEvent(env.attempts[0]));
  assert.equal(env.attempts.length, 1);
  // Do not flush the failed consumer before resuming and queuing the next wake.
  const resumed = env.host.tryRun({ displayPrompt: "立即恢复" }, env.target, { resumeTaskId: run.taskId, resumeRequested: true });
  assert.equal(env.host.submitUserMessage(run.taskId!, "恢复后仅消费一次的消息"), true);
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.equal(env.attempts[1].request.attemptId, childId);
  assert.deepEqual(env.attempts[1].request.dependsOn, ["source"]);
  assert.equal(env.mains.length, 2);
  assert.equal(env.mains[1].request.kind, "review");
  assert.deepEqual(env.mains[1].request.reviewEventIds, [attemptEvent(env.attempts[0])]);
  assert.equal(env.maxMains(), 1);
  assert.equal(await isSettled(resumed.done), false);
  assert.equal(env.tasks.get(run.taskId!)?.status, "running");
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId!)).seenAttempts, saved.seenAttempts);
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: attemptEvent(env.attempts[0]), subtasks: [] }));
  await flush();
  assert.equal(env.mains.length, 3);
  assert.equal(env.mains[2].request.kind, "user");
  assert.match(env.mains[2].request.prompt, /恢复后仅消费一次的消息/);
  env.mains[2].resolve(decisionJson({ status: "wait" }));
  await flush();
  assert.equal(env.mains.length, 3);
  assert.equal(env.attempts.length, 2);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId!)).userMessageQueue, []);
  assert.deepEqual(env.abortedAttemptIds, []);
  env.host.stopParent(run.taskId!);
  await resumed.done;
});

test("failed persistence of dependency promotion rolls back reservations and reload starts once", async () => {
  let rejectPromotion = false;
  const env = harness({ beforeUpdateTask(patch) {
    if (rejectPromotion && (patch.loopPlus as LoopPlusSchedulerSnapshot | undefined)?.running.some((a) => a.subtaskId === "child")) {
      rejectPromotion = false;
      throw new Error("dependency reservation disk failure");
    }
  } });
  const run = env.host.tryRun({ displayPrompt: "依赖准入必须先落盘" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [dependentSubtask("source", []), dependentSubtask("child", ["source"])] }));
  await flush();
  rejectPromotion = true;
  env.attempts[0].resolve({ outcome: "completed", detail: "source finished" });
  await run.done;
  await flush();
  const saved = snapshotOf(env.tasks.get(run.taskId!));
  assert.equal(saved.running.length, 0);
  assert.deepEqual(saved.pending.map((a) => a.subtaskId), ["child"]);
  assert.equal(saved.currentReview?.eventId, attemptEvent(env.attempts[0]));
  assert.equal(env.attempts.length, 1);
  const reloaded = env.reloadHost();
  const resumed = reloaded.tryRun({ displayPrompt: "重试落盘" }, env.target, { resumeTaskId: run.taskId, resumeRequested: true });
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.deepEqual(env.attempts[1].request.dependsOn, ["source"]);
  assert.match(env.attempts[1].request.modelPrompt, /dependsOn.*source/);
  reloaded.stopParent(run.taskId!);
  await resumed.done;
});

test("cold dependency-only snapshot wakes planning and watchdog preserves a live repair", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  scheduler.dispatch([{ subtaskId: "source", attemptId: "old-source" }, { subtaskId: "child", attemptId: "old-child", dependsOn: ["source"] }]);
  scheduler.applyControls([{ subtaskId: "source", action: "close" }]);
  const task = baseTask("dependency-cold", scheduler.snapshot());
  task.subTasks = [dependentSubtask("source", []), dependentSubtask("child", ["source"])].map((s) => ({ ...s, id: s.id!, status: "pending" }));
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: "恢复阻塞图" }, env.target, { resumeTaskId: task.id, resumeRequested: true });
  await flush();
  assert.equal(env.attempts.length, 0);
  assert.match(env.mains[0].request.prompt, /dependsOn=source latestAttempt=old-source reason=closed/);
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [dependentSubtask("source", [])] }));
  await flush();
  assert.equal(env.attempts[0].request.subtaskId, "source");
  env.host.checkWaitingTasks();
  await flush();
  assert.equal(env.attempts.length, 1, "watchdog keeps the live repair");
  env.host.stopParent(task.id);
  await run.done;
});


test("acknowledging a report and redispatching its logical id only blocks newly queued successors", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "报告与重派同一决策" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [dependentSubtask("source", [], false), dependentSubtask("child", ["source"])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "first report" });
  await flush();
  env.mains[1].resolve(decisionJson({ status: "dispatch", reportEventIds: [attemptEvent(env.attempts[0])],
    subtasks: [dependentSubtask("late-child", ["source"]), dependentSubtask("source", [], false)],
  }));
  await flush();
  assert.deepEqual(env.attempts.map((a) => a.request.subtaskId), ["source", "child", "source"]);
  assert.equal(snapshotOf(env.tasks.get(run.taskId!)).pending[0].subtaskId, "late-child");
  env.attempts[2].resolve({ outcome: "completed", detail: "latest report" });
  await flush();
  assert.equal(env.attempts[3].request.subtaskId, "late-child");
  env.host.stopParent(run.taskId!);
  await run.done;
});


test("wait acknowledging the last report arms closeout rather than waiting without live work", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "确认最后报告后收口" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [dependentSubtask("report", [], false)] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "last report" });
  await flush();
  env.mains[1].resolve(decisionJson({ status: "wait", reportEventIds: [attemptEvent(env.attempts[0])] }));
  await flush();
  assert.equal(env.mains[2].request.kind, "closeout");
  env.mains[2].resolve(completedDecision());
  await run.done;
  assert.equal(env.tasks.get(run.taskId!)?.status, "completed");
});


test("close preserves the dependency projection of the closed attempt", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "关闭不改写历史依赖" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [dependentSubtask("source", []), dependentSubtask("child", ["source"])] }));
  await flush();
  env.host.submitUserMessage(run.taskId!, "关闭后继");
  await flush();
  env.mains[1].resolve(decisionJson({ status: "steer", controls: [{ id: "child", action: "close", dependsOn: [] }] }));
  await flush();
  assert.deepEqual(env.tasks.get(run.taskId!)?.subTasks.find((a) => a.id === "child")?.dependsOn, ["source"]);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId!)).seenAttempts.find((a) => a.subtaskId === "child")?.dependsOn, ["source"]);
  env.host.stopParent(run.taskId!);
  await run.done;
});


test("allows parallel dispatch beyond the former cumulative subtask limit", async () => {
  const env = harness();
  const task = baseTask("parallel-budget", reviewedRoundsScheduler(49).snapshot());
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: "implement" }, env.target, { resumeTaskId: task.id, resumeRequested: true });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["a.ts"]), subtask("beta", ["b.ts"])] }));
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts.length, 51);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  env.host.stopParent(run.taskId ?? "");
  await run.done;
});

test("acceptance-exempt attempts, pending reservations, and reprompts continue past the former limit", async () => {
  const env = harness({ maxConcurrency: 1 });
  const task = baseTask("pending-budget", reviewedRoundsScheduler(48, 1).snapshot());
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: "implement" }, env.target, { resumeTaskId: task.id, resumeRequested: true });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    { ...subtask("alpha", ["a.ts"]), requiresAcceptance: false }, subtask("beta", ["b.ts"]),
  ] }));
  await flush();
  const taskId = run.taskId ?? "";
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts.length, 50);
  assert.equal(snapshotOf(env.tasks.get(taskId)).pending.length, 1);
  env.host.submitUserMessage(taskId, "stop alpha");
  await flush();
  env.mains[1].resolve(decisionJson({ status: "steer", controls: [{ id: "alpha", action: "close" }] }));
  await flush();
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts.length, 50);
  assert.equal(env.attempts.length, 2, "already reserved beta still launches at the limit");
  env.host.submitUserMessage(taskId, "reprompt beta");
  await flush();
  env.mains[2].resolve(decisionJson({ status: "steer", controls: [{ id: "beta", action: "reprompt", title: "修正 beta", prompt: longPrompt("beta", ["b.ts"]) }] }));
  await flush();
  assert.equal(snapshotOf(env.tasks.get(taskId)).seenAttempts.length, 51);
  assert.equal(env.attempts.length, 3);
  assert.notEqual(env.attempts[1].request.attemptId, env.attempts[2].request.attemptId);
  env.host.stopParent(taskId);
  await run.done;
});

test("reprompt creates a new attempt beyond the former cumulative subtask limit", async () => {
  const env = harness();
  const task = baseTask("reprompt-no-total-limit", reviewedRoundsScheduler(49).snapshot());
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: "implement" }, env.target, { resumeTaskId: task.id, resumeRequested: true });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("alpha", ["a.ts"])] }));
  await flush();
  env.host.submitUserMessage(run.taskId ?? "", "correct alpha");
  await flush();
  env.mains[1].resolve(decisionJson({ status: "steer", controls: [{ id: "alpha", action: "reprompt", title: "修正 alpha", prompt: longPrompt("alpha", ["a.ts"]) }] }));
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.notEqual(env.attempts[0].request.attemptId, env.attempts[1].request.attemptId);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts.length, 51);
  env.host.stopParent(run.taskId ?? "");
  await run.done;
});


test("Loop+ completes after more than 100 subtasks and 200 main decisions", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "implement sequential deliveries" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  for (let round = 0; round < 101; round += 1) {
    env.mains.at(-1)!.resolve(decisionJson({ status: "dispatch", subtasks: [subtask(`item-${round}`, [`item-${round}.ts`])] }));
    await flush();
    env.attempts.at(-1)!.resolve({ outcome: "completed", detail: "done" });
    await flush();
    const review = env.mains.at(-1)!;
    review.resolve(decisionJson({ status: "accept", reviewEventIds: review.request.reviewEventIds, subtasks: [] }));
    await flush();
  }
  assert.ok(env.mains.length > 200);
  env.mains.at(-1)!.resolve(completedDecision());
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).seenAttempts.filter((item) => item.disposition === "reviewed").length, 101);
});

// Build the dependency history through real host decisions, never by injecting
// an impossible dependent execution into a snapshot.
async function runningReviewDependency(options: { report?: boolean; independent?: boolean; reportCompanion?: boolean; inactive?: () => boolean } = {}) {
  const env = harness({ isAttemptActive: options.inactive });
  const run = env.host.tryRun({ displayPrompt: "验收选序与执行准入分别处理" }, env.target, { schedulingMode: "event_driven" });
  const taskId = run.taskId!;
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [
    subtask("source", ["src/source.ts"]),
    { ...subtask("successor", ["src/successor.ts"]), dependsOn: ["source"] },
    ...(options.independent ? [subtask("independent", ["src/independent.ts"])] : []),
    ...(options.reportCompanion ? [{ ...subtask("report", ["src/report.ts"]), requiresAcceptance: false }] : []),
  ] }));
  await flush();
  env.attempts.find((item) => item.request.subtaskId === "source")!.resolve({ outcome: "completed", detail: null });
  await flush();
  const first = env.mains.at(-1)!;
  first.resolve(decisionJson({ status: "accept", reviewEventIds: first.request.reviewEventIds, subtasks: [] }));
  await flush();
  assert.ok(env.attempts.some((item) => item.request.subtaskId === "successor"));
  env.host.submitUserMessage(taskId, "重新执行前置，保留已启动后继交付");
  await flush();
  env.mains.at(-1)!.resolve(decisionJson({ status: "dispatch", subtasks: [{
    ...subtask("source", ["src/source.ts"]), title: "source again",
    ...(options.report ? { requiresAcceptance: false } : {}),
  }] }));
  await flush();
  const source = env.attempts.filter((item) => item.request.subtaskId === "source").at(-1)!;
  const successor = env.attempts.find((item) => item.request.subtaskId === "successor")!;
  assert.notEqual(source.request.attemptId, env.attempts[0].request.attemptId);
  const id = (attempt: AttemptCall) => buildLoopPlusFinishEventId(attempt.request.subtaskId, attempt.request.attemptId);
  return { ...env, run, taskId, source, successor, id };
}

test("review selection defers only a running prerequisite's successor, then orders the new prerequisite first without a busy loop", async () => {
  const env = await runningReviewDependency({ independent: true });
  env.successor.resolve({ outcome: "completed", detail: "successor arrived first" });
  await flush();
  assert.equal(env.mains.length, 3);
  assert.equal(env.tasks.get(env.taskId)?.status, "running");
  const dependencyWait = env.tasks.get(env.taskId);
  env.host.checkWaitingReviews();
  env.host.checkWaitingReviews();
  assert.equal(env.tasks.get(env.taskId), dependencyWait, "unchanged dependency wait does not persist the same batch on every tick");
  env.host.checkWaitingTasks();
  await flush();
  assert.equal(env.mains.length, 3, "watchdog leaves a live prerequisite alone");
  const independent = env.attempts.find((item) => item.request.subtaskId === "independent")!;
  independent.resolve({ outcome: "completed", detail: null });
  await flush();
  const frozen = env.mains.at(-1)!;
  assert.deepEqual(frozen.request.reviewEventIds, [env.id(independent)]);
  assert.match(frozen.request.prompt, /source.*attempt|execution_pending/s);
  env.source.resolve({ outcome: "completed", detail: null });
  await flush();
  assert.deepEqual(env.host.getActiveReviewEventIds(env.taskId), [env.id(independent)], "late prerequisite cannot rewrite the frozen batch");
  frozen.resolve(decisionJson({ status: "accept", reviewEventIds: frozen.request.reviewEventIds, subtasks: [] }));
  await flush();
  const next = env.mains.at(-1)!;
  assert.deepEqual(next.request.reviewEventIds, [env.id(env.source), env.id(env.successor)]);
  assert.deepEqual(env.host.getActiveReviewEventIds(env.taskId), next.request.reviewEventIds);
  next.resolve(completedDecision({ reviewEventIds: next.request.reviewEventIds }));
  await env.run.done;
  assert.equal(env.tasks.get(env.taskId)?.status, "completed");
  assert.equal(env.maxMains(), 1);
});

for (const outcome of ["completed", "failed"] as const) {
  test(`frozen review explanations expire on prerequisite ${outcome} for both prompt refresh and main retry`, async () => {
    const env = await runningReviewDependency({ independent: true, reportCompanion: true });
    env.successor.resolve({ outcome: "completed", detail: "successor delivered before the new prerequisite" });
    await flush();
    env.host.submitUserMessage(env.taskId, "planning message before the frozen prefix");
    await flush();
    const user = env.mains.at(-1)!;
    assert.equal(user.request.kind, "user");
    const report = env.attempts.find((item) => item.request.subtaskId === "report")!;
    const independent = env.attempts.find((item) => item.request.subtaskId === "independent")!;
    report.resolve({ outcome: "completed", detail: "captured report evidence" });
    independent.resolve({ outcome: "completed", detail: "independent evidence" });
    env.host.submitUserMessage(env.taskId, "captured frozen message");
    await flush();
    user.reject(new Error("planning request failed while reports and reviews arrived"));
    await flush();
    const first = env.mains.at(-1)!;
    const identity = {
      eventId: first.request.reviewEventId,
      eventIds: first.request.reviewEventIds,
      reportIds: first.request.reportEventIds,
      messageCount: first.request.userMessageCount,
    };
    assert.deepEqual(identity, { eventId: env.id(independent), eventIds: [env.id(independent)],
      reportIds: [env.id(report)], messageCount: 2 });
    assert.match(first.request.prompt, /reason=execution_pending/);
    assert.match(first.request.prompt, new RegExp(env.source.request.attemptId));
    assert.match(first.request.prompt, /captured frozen message/);
    assert.match(first.request.prompt, /captured report evidence/);

    // An interrupted runner retains its open reservation and persists a
    // prompt refresh without changing the scheduler or its selection sequence.
    const selectionState = snapshotOf(env.tasks.get(env.taskId));
    const mainCount = env.mains.length;
    env.source.resolve({ outcome: "stopped", detail: "awaiting controlled continuation" });
    await flush();
    assert.equal(env.mains.length, mainCount);
    assert.deepEqual(snapshotOf(env.tasks.get(env.taskId)), selectionState);
    assert.match(first.request.prompt, /reason=execution_pending/,
      "refresh preserves an explanation still tied to the current scheduler state");

    // Retrying unchanged scheduler state uses that same validity rule.
    first.reject(new Error("temporary main failure before dependency state changes"));
    await flush();
    const retry = env.mains.at(-1)!;
    assert.notEqual(retry, first);
    assert.match(retry.request.prompt, /reason=execution_pending/);
    assert.deepEqual(snapshotOf(env.tasks.get(env.taskId)), selectionState,
      "retrying a held batch must not prepare or mutate the scheduler");

    // A real finish persists and refreshes the in-flight request, without
    // selecting again or changing the identity submitted by this main call.
    assert.equal(env.host.notifySubtaskContinuation(env.taskId, "source", outcome,
      "new prerequisite finished during frozen review", undefined, undefined, env.source.request.attemptId), true);
    await flush();
    const afterFinish = snapshotOf(env.tasks.get(env.taskId));
    assert.doesNotMatch(retry.request.prompt, /reason=execution_pending/);
    assert.doesNotMatch(retry.request.modelPrompt, /reason=execution_pending/);
    assert.deepEqual(env.host.getActiveReviewEventIds(env.taskId), identity.eventIds);
    assert.equal(afterFinish.currentReview?.eventId, identity.eventId);
    assert.deepEqual(afterFinish.reviewQueue.map((item) => item.eventId), [env.id(env.successor), env.id(env.source)]);
    assert.equal(afterFinish.seenAttempts.find((item) => item.attemptId === env.source.request.attemptId)?.disposition, "finished");

    env.host.submitUserMessage(env.taskId, "late message excluded from the frozen prefix");
    await flush();
    const beforeRetry = snapshotOf(env.tasks.get(env.taskId));
    retry.reject(new Error("temporary main failure after dependency state changes"));
    await flush();
    const current = env.mains.at(-1)!;
    assert.notEqual(current, retry);
    assert.doesNotMatch(current.request.prompt, /reason=execution_pending/);
    for (const call of [retry, current]) {
      assert.deepEqual({ eventId: call.request.reviewEventId, eventIds: call.request.reviewEventIds,
        reportIds: call.request.reportEventIds, messageCount: call.request.userMessageCount }, identity);
      assert.match(call.request.prompt, /captured frozen message/);
      assert.match(call.request.prompt, /captured report evidence/);
      assert.doesNotMatch(call.request.prompt, /late message excluded/);
    }
    assert.deepEqual(snapshotOf(env.tasks.get(env.taskId)), beforeRetry,
      "failure retry must not reorder, acknowledge, or expand any prefix");
    assert.equal(env.attempts.length, 5, "refresh and retry launch no additional attempts");
    assert.equal(env.tasks.get(env.taskId)?.status, "running");

    current.resolve(completedDecision({ reviewEventIds: identity.eventIds, reportEventIds: identity.reportIds }));
    await flush();
    const next = env.mains.at(-1)!;
    assert.deepEqual(next.request.reviewEventIds, [env.id(env.source), env.id(env.successor)],
      "the next new batch still selects the latest prerequisite before its successor");
    const confirmed = snapshotOf(env.tasks.get(env.taskId));
    assert.equal(confirmed.completed, false, "remaining unconfirmed events still prevent global completed");
    assert.equal(confirmed.seenAttempts.find((item) => item.attemptId === independent.request.attemptId)?.disposition, "reviewed");
    assert.equal(confirmed.seenAttempts.find((item) => item.attemptId === report.request.attemptId)?.disposition, "reported");
    assert.deepEqual(confirmed.userMessageQueue, ["late message excluded from the frozen prefix"]);
    assert.equal(next.request.userMessageCount, 1);
    assert.deepEqual(next.request.reportEventIds, []);
    assert.equal(env.maxMains(), 1);
    env.host.stopParent(env.taskId);
    await env.run.done;
  });
}

test("review selection consumes an unconfirmed prerequisite report FIFO before selecting its successor", async () => {
  const env = await runningReviewDependency({ report: true });
  env.successor.resolve({ outcome: "completed", detail: null });
  await flush();
  assert.equal(env.mains.length, 3);
  env.source.resolve({ outcome: "completed", detail: "source report evidence" });
  await flush();
  const report = env.mains.at(-1)!;
  assert.equal(report.request.kind, "continue");
  assert.deepEqual(report.request.reviewEventIds, []);
  assert.deepEqual(report.request.reportEventIds, [env.id(env.source)]);
  assert.match(report.request.prompt, /reason=report_pending/);
  assert.deepEqual(env.host.getActiveReviewEventIds(env.taskId), []);
  report.resolve(decisionJson({ status: "wait", reportEventIds: report.request.reportEventIds }));
  await flush();
  const review = env.mains.at(-1)!;
  assert.deepEqual(review.request.reviewEventIds, [env.id(env.successor)]);
  assert.deepEqual(review.request.reportEventIds, []);
  review.resolve(completedDecision({ reviewEventIds: review.request.reviewEventIds }));
  await env.run.done;
});

test("review selection survives same-host stop/resume and watchdog continuation", async (t) => {
  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  let active = true;
  const env = await runningReviewDependency({ inactive: () => active });
  env.successor.resolve({ outcome: "completed", detail: null });
  await flush();
  env.host.stopParent(env.taskId);
  await env.run.done;
  const resumed = env.host.tryRun({ displayPrompt: "恢复待审任务" }, env.target, { resumeTaskId: env.taskId, resumeRequested: true });
  await flush();
  const review = env.mains.at(-1)!;
  // Stop records a real stopped prerequisite event; it must precede the successor.
  assert.deepEqual(review.request.reviewEventIds, [env.id(env.source), env.id(env.successor)]);
  review.resolve(decisionJson({
    status: "accept",
    reviewEventIds: review.request.reviewEventIds,
    reviews: [
      { reviewEventId: env.id(env.source), acceptance: "failed", reason: "来源任务已停止", noRepairReason: "后继交付已独立覆盖来源目标" },
      { reviewEventId: env.id(env.successor), acceptance: "passed", reason: "后继交付已完成" },
    ],
    subtasks: [],
  }));
  await flush();
  const closeout = env.mains.at(-1)!;
  assert.equal(closeout.request.kind, "closeout");
  closeout.resolve(completedDecision());
  await resumed.done;

  const watched = await runningReviewDependency({ inactive: () => active });
  watched.successor.resolve({ outcome: "completed", detail: null });
  await flush();
  active = false;
  now += 5 * 60 * 1000;
  watched.host.checkWaitingTasks();
  await flush();
  assert.equal(watched.mains.length, 3);
  assert.equal(snapshotOf(watched.tasks.get(watched.taskId)).currentReview, null);
  assert.equal(watched.host.resumeInterruptedSubtasks(watched.taskId), true);
  await flush();
  const restartedSource = watched.attempts.filter((item) => item.request.subtaskId === "source").at(-1)!;
  restartedSource.resolve({ outcome: "completed", detail: "续跑后完成" });
  await flush();
  const reviews = [snapshotOf(watched.tasks.get(watched.taskId)).currentReview,
    ...snapshotOf(watched.tasks.get(watched.taskId)).reviewQueue].filter(Boolean);
  assert.equal(reviews.length, 2);
  assert.equal(reviews.every((event) => event?.outcome === "completed"), true);
  watched.host.stopParent(watched.taskId);
  await watched.run.done;
});

function dependencyReviewChainTask(id: string) {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
  const spec = (index: number, attempt: string) => ({ subtaskId: `chain-${index}`, attemptId: attempt,
    writeFiles: [`src/chain-${index}.ts`], dependsOn: index ? [`chain-${index - 1}`] : [] });
  // Each old predecessor passes before the next execution is admitted.
  for (let index = 0; index < 5; index += 1) {
    const item = spec(index, `old-${index}`);
    assert.equal(scheduler.dispatch([item]).started.length, 1);
    scheduler.finish({ ...item, outcome: "completed" });
    const review = scheduler.claimNextReview();
    assert.ok(review.item);
    scheduler.submitReviewBatch([review.item.eventId], "passed");
  }
  // Reprompt from the leaf up while its latest predecessor is still passed.
  for (let index = 4; index >= 0; index -= 1) {
    assert.equal(scheduler.dispatch([spec(index, `new-${index}`)]).started.length, 1);
  }
  for (let index = 4; index >= 0; index -= 1) scheduler.finish({ ...spec(index, `new-${index}`), outcome: "completed" });
  const task = baseTask(id, scheduler.snapshot());
  task.subTasks = Array.from({ length: 5 }, (_, index) => ({ id: `chain-${index}`, title: `chain-${index}`, status: "completed" as const, updatedAt: 1 }));
  return task;
}

test("review selection cold recovery sorts a real reversed transitive chain and truncates at four", async () => {
  const env = harness();
  const task = dependencyReviewChainTask("transitive-review");
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, { resumeTaskId: task.id });
  await flush();
  const ordered = Array.from({ length: 5 }, (_, index) => buildLoopPlusFinishEventId(`chain-${index}`, `new-${index}`));
  assert.deepEqual(env.mains[0].request.reviewEventIds, ordered.slice(0, 4));
  env.mains[0].resolve(completedDecision({ reviewEventIds: ordered.slice(0, 4) }));
  await flush();
  assert.equal(env.tasks.get(task.id)?.status, "running", "the fifth unconfirmed event still gates completed");
  assert.deepEqual(env.mains[1].request.reviewEventIds, ordered.slice(4));
  env.mains[1].resolve(completedDecision({ reviewEventIds: ordered.slice(4) }));
  await run.done;
  assert.equal(env.tasks.get(task.id)?.status, "completed");
});

test("review selection a failed predecessor can be reviewed before existing successor evidence but cannot admit new execution", async () => {
  const env = await runningReviewDependency();
  env.successor.resolve({ outcome: "completed", detail: null });
  await flush();
  env.source.resolve({ outcome: "failed", detail: "real failed prerequisite" });
  await flush();
  const review = env.mains.at(-1)!;
  assert.deepEqual(review.request.reviewEventIds, [env.id(env.source), env.id(env.successor)]);
  review.resolve(decisionJson({ status: "accept", reviewEventIds: review.request.reviewEventIds,
    reviews: [
      { reviewEventId: env.id(env.source), acceptance: "failed", reason: "执行失败，保留真实失败", subtaskIds: [],
        noRepairReason: "本测试验证前置失败不会放行新依赖" },
      { reviewEventId: env.id(env.successor), acceptance: "passed", reason: "后继已有独立有效交付" },
    ], acceptance: { passed: false, checks: loopPlusAcceptanceChecksFixture().map((item) => ({ ...item, passed: false })) },
    subtasks: [{ ...subtask("new-dependent", ["src/new-dependent.ts"]), dependsOn: ["source"] }],
    independentSubtaskIds: ["new-dependent"],
  }));
  await flush();
  const state = snapshotOf(env.tasks.get(env.taskId));
  assert.equal(state.seenAttempts.find((item) => item.attemptId === env.source.request.attemptId)?.acceptance, "failed");
  assert.equal(state.seenAttempts.find((item) => item.attemptId === env.successor.request.attemptId)?.acceptance, "passed");
  assert.equal(state.pending.some((item) => item.subtaskId === "new-dependent"), true);
  assert.equal(env.attempts.some((item) => item.request.subtaskId === "new-dependent"), false);
  env.host.stopParent(env.taskId);
  await env.run.done;
});

test("review selection with no active progress bounds wait/completed corrections and preserves every unconfirmed event", async () => {
  for (const status of ["wait", "completed"] as const) {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
    const root = { subtaskId: "root", attemptId: "root-failed" };
    scheduler.dispatch([root]);
    scheduler.finish({ ...root, outcome: "failed" });
    scheduler.claimNextReview();
    scheduler.submitReviewBatch([buildLoopPlusFinishEventId(root.subtaskId, root.attemptId)], "failed");
    const oldSource = { subtaskId: "source", attemptId: "source-passed" };
    scheduler.dispatch([oldSource]);
    scheduler.finish({ ...oldSource, outcome: "completed" });
    scheduler.claimNextReview();
    scheduler.submitReviewBatch([buildLoopPlusFinishEventId(oldSource.subtaskId, oldSource.attemptId)], "passed");
    const successor = { subtaskId: "successor", attemptId: "existing-successor", dependsOn: ["source"] };
    assert.equal(scheduler.dispatch([successor]).started.length, 1);
    assert.equal(scheduler.dispatch([{ subtaskId: "source", attemptId: "source-pending", dependsOn: ["root"] }]).started.length, 0);
    scheduler.finish({ ...successor, outcome: "completed" });
    const env = harness();
    const task = baseTask(`review-deadlock-${status}`, scheduler.snapshot());
    env.tasks.set(task.id, task);
    const run = env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, { resumeTaskId: task.id });
    await flush();
    for (let index = 0; index < 4; index += 1) {
      const main = env.mains[index];
      assert.ok(main);
      assert.equal(main.request.kind, "continue");
      assert.deepEqual(main.request.reviewEventIds, []);
      assert.match(main.request.prompt, /source-pending/);
      assert.match(main.request.prompt, /reason=execution_pending/);
      assert.match(main.request.prompt, /reason=failed/);
      main.resolve(status === "wait" ? decisionJson({ status }) : completedDecision());
      await flush();
    }
    await run.done;
    assert.equal(env.mains.length, 4, "no-progress decisions pause after three automatic continuations");
    assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 4);
    const saved = snapshotOf(env.tasks.get(task.id));
    assert.equal(saved.completed, false);
    assert.equal(saved.reviewQueue.length, 1);
    assert.equal(saved.pending[0].attemptId, "source-pending");
    assert.equal(env.tasks.get(task.id)?.status, "needs-review");
    assert.equal(env.attempts.length, 0);
  }
});

test("需求变更时撤销冻结验收并保留晚到事件，随后可以正常完成", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "按最新需求交付" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({ status: "dispatch", subtasks: [subtask("old", []), subtask("keep", [])] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "旧需求实现" });
  await flush();
  const oldReview = env.mains[1];
  const eventId = oldReview.request.reviewEventIds![0];
  env.attempts[1].resolve({ outcome: "completed", detail: "当前需求实现" });
  env.host.submitUserMessage(run.taskId!, "旧需求取消，不再验收旧交付");
  await flush();
  oldReview.resolve(JSON.stringify({ status: "accept", progressPercent: 70, reviewEventId: eventId,
    reviews: [{ reviewEventId: eventId, acceptance: "cancelled", reason: "用户已取消旧需求" }] }));
  await flush();
  const snapshot = snapshotOf(env.tasks.get(run.taskId!));
  assert.equal(snapshot.seenAttempts.find((item) => item.subtaskId === "old")?.acceptance, "cancelled");
  assert.equal(snapshot.seenAttempts.find((item) => item.subtaskId === "old")?.acceptanceReason, "用户已取消旧需求");
  assert.equal(env.acceptanceFeedback.length, 1);
  assert.match(env.acceptanceFeedback[0].body, /验收已撤销/u);
  assert.doesNotMatch(env.acceptanceFeedback[0].body, /❌|✅/u);
  assert.equal(env.mains[2].request.reviewEventIds!.length, 1);
  assert.notEqual(env.mains[2].request.reviewEventIds![0], eventId);
  assert.notEqual(env.tasks.get(run.taskId!)?.status, "completed");
  env.mains[2].resolve(completedDecision({ reviewEventId: env.mains[2].request.reviewEventIds![0] }));
  await flush();
  await run.done;
  assert.equal(env.tasks.get(run.taskId!)?.status, "completed");
});

test("consumer failure persists execution-error through pause and a later finish only carries it", async () => {
  let explode = false;
  const env = harness({
    beforeReadTask: () => {
      if (!explode) return;
      explode = false;
      throw new Error("synthetic-consumer-escape");
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 2);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.at(-1)!;
  assert.equal(review.request.kind, "review");
  explode = true;
  review.resolve(decisionJson({ status: "wait" }));
  await flush();
  const taskId = run.taskId ?? "";
  const paused = env.tasks.get(taskId);
  assert.equal(paused?.status, "error");
  assert.equal(paused?.finalSummary, "execution-error: loop-plus-consumer-failed");
  assert.equal(paused?.loopPlusInterruption?.reason, "execution-error");
  assert.equal(typeof paused?.loopPlusInterruption?.phase, "string");
  assert.equal(env.messages.includes("loop-plus-consumer-failed"), true);
  assert.equal(JSON.stringify(paused).includes("synthetic-consumer-escape"), false);
  const transition = env.logs.filter((item) => item.event === "loop-plus-interruption-source"
    && (item.payload as { carried?: boolean } | undefined)?.carried !== true);
  assert.ok(transition.length >= 1);
  assert.deepEqual(transition[0]?.payload, {
    phase: paused?.loopPlusInterruption?.phase,
    reason: "execution-error",
    carried: false,
  });
  env.attempts[1].resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  const carriedTask = env.tasks.get(taskId);
  assert.equal(carriedTask?.status, "error");
  assert.deepEqual(carriedTask?.loopPlusInterruption, paused?.loopPlusInterruption);
  assert.equal(carriedTask?.finalSummary, paused?.finalSummary);
  const carried = env.logs.filter((item) => item.event === "loop-plus-interruption-source"
    && (item.payload as { carried?: boolean } | undefined)?.carried === true);
  assert.ok(carried.length >= 1);
  assert.deepEqual(Object.keys(carried.at(-1)?.payload as object).sort(), ["carried", "phase", "reason"]);
  assert.equal((carried.at(-1)?.payload as { reason?: string }).reason, "execution-error");
  const normalized = normalizeLoopTaskRecord(carriedTask);
  assert.deepEqual(normalized?.loopPlusInterruption, carriedTask?.loopPlusInterruption);
  assert.deepEqual(normalizeLoopTaskRecord({
    ...carriedTask!,
    loopPlusInterruption: {
      phase: "reviewing",
      reason: "execution-error",
      taskId: "msg_secret",
      error: "synthetic-consumer-escape",
    } as LoopTaskRecord["loopPlusInterruption"],
  })?.loopPlusInterruption, { phase: "reviewing", reason: "execution-error" });
  assert.equal(normalizeLoopTaskRecord({
    ...carriedTask!,
    loopPlusInterruption: { phase: "nope", reason: "execution-error" } as unknown as LoopTaskRecord["loopPlusInterruption"],
  })?.loopPlusInterruption, undefined);
  env.host.stopParent(taskId);
  const stopped = env.tasks.get(taskId);
  assert.equal(stopped?.status, "stopped");
  assert.equal(stopped?.loopPlusInterruption?.reason, "user-stop");
});

test("an expanded reply does not name reviews[1] when the host froze one event", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.at(-1)!;
  const frozen = review.request.reviewEventIds?.slice() ?? [];
  assert.deepEqual(frozen, [buildLoopPlusFinishEventId("alpha", env.attempts[0].request.attemptId)]);
  env.attempts[1].resolve({ outcome: "completed", detail: "beta arrived late" });
  await flush();
  const lateId = buildLoopPlusFinishEventId("beta", env.attempts[1].request.attemptId);
  const live = snapshotOf(env.tasks.get(run.taskId ?? ""));
  assert.equal(live.currentReview?.eventId, frozen[0]);
  assert.ok(live.reviewQueue.some((item) => item.eventId === lateId));
  assert.deepEqual(review.request.reviewEventIds, frozen);
  const expanded = decisionJson({
    status: "accept",
    reviewEventIds: [frozen[0], lateId],
    reviews: [
      { reviewEventId: frozen[0], acceptance: "passed", reason: "第一项符合冻结批次" },
      { reviewEventId: lateId, acceptance: "maybe", reason: "第二项自报有误" },
    ],
  });
  review.resolve(expanded);
  await flush();
  const correction = env.mains.at(-1)!;
  assert.equal(correction.request.kind, "review");
  assert.deepEqual(correction.request.reviewEventIds, frozen);
  assert.match(correction.request.prompt, /修正提示：/);
  assert.match(correction.request.prompt, /validation\.accept\.invalid_reviews/);
  assert.doesNotMatch(correction.request.prompt, /reviews\[1\]/);
  assert.equal((env.logs.find((item) => item.event === "loop-plus-protocol-miss")?.payload as { fieldPath?: string }).fieldPath, "accept.reviews");
  await exhaustProtocolBudget(env, run, 1, expanded, true);
  const summary = env.tasks.get(run.taskId ?? "")?.finalSummary ?? "";
  assert.match(summary, /validation\.accept\.invalid_reviews/);
  assert.match(summary, /accept\.reviews/);
  assert.doesNotMatch(summary, /reviews\[1\]/);
  assert.doesNotMatch(summary, /第二项自报有误|maybe/);
});

test("a real two-event frozen batch still names the wrong second review field", async (context) => {
  const env = protocolHarness(context);
  const task = baseTask("frozen-two-field", twoFinishedReviews());
  env.tasks.set(task.id, task);
  const run = env.host.tryRun({ displayPrompt: task.rootPrompt }, env.target, {
    resumeTaskId: task.id,
    schedulingMode: "event_driven",
  });
  await flush();
  const review = env.mains[0];
  const frozen = review.request.reviewEventIds?.slice() ?? [];
  assert.equal(frozen.length, 2);
  const wrong = decisionJson({
    status: "accept",
    reviewEventIds: frozen,
    reviews: [
      { reviewEventId: frozen[0], acceptance: "passed", reason: "第一项符合要求" },
      { reviewEventId: frozen[1], acceptance: "maybe", reason: "第二项结论无效" },
    ],
  });
  review.resolve(wrong);
  await flush();
  const correction = env.mains[1];
  assert.deepEqual(correction.request.reviewEventIds, frozen);
  assert.match(correction.request.prompt, /修正提示：/);
  assert.match(correction.request.prompt, /受控字段：accept\.reviews\[1\]\.acceptance/);
  await exhaustProtocolBudget(env, run, 0, wrong, true);
  const summary = env.tasks.get(task.id)?.finalSummary ?? "";
  assert.match(summary, /accept\.reviews\[1\]\.acceptance/);
  assert.doesNotMatch(summary, /第二项结论无效|maybe/);
});

test("a legal decision writes no protocol rejection summary", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "处理一个明确、低风险的简单事项" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(directCompletionDecision());
  await run.done;
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "completed");
  assert.equal(env.attempts.length, 0);
  assert.equal(env.mains.length, 1);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 0);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-rejection").length, 0);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-recovery").length, 0);
});

test("format, cross-field, and preflight rejections keep one summary and the original recovery contract", async (context) => {
  const format = protocolHarness(context);
  const formatRun = format.host.tryRun({ displayPrompt: "ship the feature" }, format.target, { schedulingMode: "event_driven" });
  await flush();
  format.mains[0].resolve('{\n  "status" "synthetic-format-secret"\n}');
  await flush();
  const formatMiss = format.logs.filter((item) => item.event === "loop-plus-protocol-miss");
  const formatRejection = format.logs.filter((item) => item.event === "loop-plus-protocol-rejection");
  assert.equal(formatMiss.length, 1);
  assert.equal(formatRejection.length, 1);
  assert.equal((formatMiss[0]?.payload as { taskId?: string }).taskId, formatRun.taskId);
  assert.equal("recoveryStage" in (formatMiss[0]?.payload as object), false);
  assert.doesNotMatch(JSON.stringify(formatRejection[0]?.payload), /synthetic-format-secret|task-/);
  assert.deepEqual(summarizeLoopPlusProtocolRejection(formatRejection[0]?.payload), {
    rejectionKind: "format",
    reasonCode: "format.ColonExpected",
    protocolFailureCount: 1,
    recoveryStage: "continuation_requested",
    dispatchWindow: "closed",
  });
  assert.deepEqual(format.logs.filter((item) => item.event === "loop-plus-protocol-recovery").map((item) => item.payload), [{
    taskId: formatRun.taskId,
    attemptState: "first",
    protocolFailureCount: 1,
    automaticRetryLimit: 3,
    result: "continuation_requested",
  }]);
  assert.equal(format.attempts.length, 0);
  assert.equal(format.tasks.get(formatRun.taskId ?? "")?.status, "running");
  format.mains[1].resolve(directCompletionDecision());
  await formatRun.done;
  assert.equal(format.logs.filter((item) => item.event === "loop-plus-protocol-rejection").length, 1);
  assert.deepEqual(format.logs.filter((item) => item.event === "loop-plus-protocol-recovery").map((item) => (item.payload as { result?: string }).result), [
    "continuation_requested",
    "recovered",
  ]);
  assert.equal(format.tasks.get(formatRun.taskId ?? "")?.status, "completed");
  assert.equal(format.attempts.length, 0);

  const cross = protocolHarness(context);
  const crossRun = cross.host.tryRun({ displayPrompt: "ship the feature" }, cross.target, { schedulingMode: "event_driven" });
  await flush();
  cross.mains[0].resolve(JSON.stringify({
    status: "completed",
    directCompletion: true,
    nextStepPlan: { objective: "SECRET_CROSS_FIELD" },
    answerConclusion: "SECRET_CROSS_FIELD",
    finalSummary: "SECRET_CROSS_FIELD",
  }));
  await flush();
  const crossRejection = cross.logs.filter((item) => item.event === "loop-plus-protocol-rejection");
  assert.equal(cross.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 1);
  assert.equal(crossRejection.length, 1);
  assert.deepEqual(summarizeLoopPlusProtocolRejection(crossRejection[0]?.payload), {
    rejectionKind: "validation",
    reasonCode: "validation.invalid_decision",
    protocolFailureCount: 1,
    recoveryStage: "continuation_requested",
    dispatchWindow: "closed",
  });
  assert.equal(JSON.stringify(crossRejection[0]?.payload).includes("SECRET_CROSS_FIELD"), false);
  assert.equal(JSON.stringify(crossRejection[0]?.payload).includes(crossRun.taskId ?? "missing-task"), false);
  assert.equal(cross.attempts.length, 0);
  assert.equal(cross.tasks.get(crossRun.taskId ?? "")?.status, "running");
  assert.equal((cross.logs.find((item) => item.event === "loop-plus-protocol-recovery")?.payload as { result?: string }).result, "continuation_requested");
  cross.host.stopParent(crossRun.taskId ?? "");
  await crossRun.done;

  const preflight = harness();
  const opened = await openDispatchFirstReview(preflight, [subtask("first", ["src/first.ts"])]);
  const before = JSON.stringify(snapshotOf(preflight.tasks.get(opened.taskId)));
  opened.review.resolve(decisionJson({
    status: "dispatch",
    subtasks: [{
      ...subtask("preview-secret-child", ["src/preview-secret-evil.ts"]),
      dependsOn: ["missing-preview-secret"],
      prompt: `${longPrompt("preview-secret-child", ["src/preview-secret-evil.ts"])} PROMPT_PREVIEW_SECRET`,
    }],
    nextStepPlan: { objective: "预检拒绝后只留下协议摘要" },
  }));
  await flush();
  const preflightRejection = preflight.logs.filter((item) => item.event === "loop-plus-protocol-rejection");
  const dispatchRejections = preflight.logs.filter((item) => item.event === "loop-plus-dispatch-rejected");
  assert.equal(preflight.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 1);
  assert.equal(preflightRejection.length, 1);
  assert.equal(dispatchRejections.length, 1);
  assert.deepEqual(summarizeLoopPlusProtocolRejection(preflightRejection[0]?.payload), {
    rejectionKind: "state",
    reasonCode: "state.dispatch_window.preflight_failed",
    fieldPath: "subtasks",
    protocolFailureCount: 1,
    recoveryStage: "continuation_requested",
    dispatchWindow: "open",
  });
  assert.equal(JSON.stringify(preflightRejection[0]?.payload).includes("reasonCounts"), false);
  assert.deepEqual(dispatchRejections[0]?.payload, { rejectedCount: 1, reasonCounts: { invalid_dependencies: 1 } });
  assert.equal(JSON.stringify(snapshotOf(preflight.tasks.get(opened.taskId))), before);
  assert.equal(preflight.attempts.length, 1);
  assert.equal(preflight.tasks.get(opened.taskId)?.status, "running");
  preflight.host.stopParent(opened.taskId);
  await opened.run.done;
});

test("protocol rejection stages follow the three automatic continuations and then pause", async (context) => {
  const env = protocolHarness(context);
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  await exhaustProtocolBudget(env, run, 0, "not json");
  const summaries = env.logs.filter((item) => item.event === "loop-plus-protocol-rejection")
    .map((item) => summarizeLoopPlusProtocolRejection(item.payload));
  assert.deepEqual(summaries.map((item) => item.protocolFailureCount), [1, 2, 3, 4]);
  assert.deepEqual(summaries.map((item) => item.recoveryStage), [
    "continuation_requested",
    "continuation_requested",
    "continuation_requested",
    "paused",
  ]);
  assert.deepEqual(summaries.map((item) => item.reasonCode), [
    "format.ObjectNotFound",
    "format.ObjectNotFound",
    "format.ObjectNotFound",
    "format.ObjectNotFound",
  ]);
  assert.deepEqual(env.logs.filter((item) => item.event === "loop-plus-protocol-recovery")
    .map((item) => (item.payload as { result?: string }).result), [
    "continuation_requested",
    "continuation_requested",
    "continuation_requested",
    "paused",
  ]);
  assert.equal(env.logs.filter((item) => item.event === "loop-plus-protocol-miss").length, 4);
  assert.equal(env.mains.length, 4);
  assert.equal(env.attempts.length, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "needs-review");
});
