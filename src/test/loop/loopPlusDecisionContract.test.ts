import test = require("node:test");
import assert = require("node:assert/strict");

import { deriveLoopPlusDecisionContract, type LoopPlusDecisionContractInput } from "../../loopPlusDecisionContract";
import { parseLoopPlusDecision, type LoopPlusDecision } from "../../loopPlusDecision";
import { createLoopPlusScheduler, type LoopPlusScheduler, type LoopPlusSubtaskSpec } from "../../loopPlusScheduler";
import { buildLoopPlusMainModelPrompt, type LoopPlusMainPromptContext } from "../../extensionHost/loopPlusPromptBuilders";
import { loopPlusDecisionStrategyFor, type LoopPlusDecisionStrategyPort } from "../../extensionHost/loopPlusDecisionStrategies";

function spec(subtaskId: string, requiresAcceptance = true, dependsOn: string[] = []): LoopPlusSubtaskSpec {
  return { subtaskId, attemptId: `${subtaskId}-1`, requiresAcceptance, dependsOn, writeFiles: [`src/${subtaskId}.ts`] };
}

function inputFor(
  scheduler: LoopPlusScheduler,
  overrides: Partial<LoopPlusDecisionContractInput> = {},
): LoopPlusDecisionContractInput {
  return {
    view: scheduler.wait().view,
    maxConcurrency: scheduler.snapshot().maxConcurrency,
    acceptanceEventIds: [],
    reportEventIds: [],
    ...overrides,
  };
}

function examplesFor(
  input: LoopPlusDecisionContractInput,
  overrides: Partial<LoopPlusMainPromptContext> = {},
): Map<string, LoopPlusDecision> {
  const prompt = buildLoopPlusMainModelPrompt({
    taskId: "contract-task",
    rootPrompt: "Implement the requested change and verify each requirement.",
    taskStoreFile: ".tmp/task.json",
    mainCommunicationFile: ".tmp/main.md",
    kind: input.acceptanceEventIds.length > 0 ? "review" : "continue",
    currentEventId: input.acceptanceEventIds[0] ?? null,
    supplementalRequirements: [],
    ...input,
    ...overrides,
  });
  const examples = new Map<string, LoopPlusDecision>();
  for (const match of prompt.matchAll(/LOOP_PLUS_PROTOCOL_EXAMPLE ([a-z]+)\n```json\n([\s\S]*?)\n```/g)) {
    const decision = parseLoopPlusDecision(match[2]);
    assert.ok(decision, `parser rejected ${match[1]}`);
    assert.equal(decision.status, match[1]);
    examples.set(match[1], decision);
  }
  assert.deepEqual([...examples.keys()], deriveLoopPlusDecisionContract(input).statuses);
  return examples;
}

function strategyHarness(scheduler: LoopPlusScheduler) {
  const misses: string[] = [];
  let finished = false;
  const port: LoopPlusDecisionStrategyPort = {
    queueView() {
      const view = scheduler.wait().view;
      return {
        hasCurrentReview: view.currentReview !== null,
        hasReview: view.visibleReviewCount > 0,
        hasReports: (view.reportQueue?.length ?? 0) > 0,
        hasUserMessages: view.userMessageQueue.length > 0,
        runningCount: view.running.length,
        pendingCount: view.pending.length,
        parentStopped: view.phase === "stopped",
        requiredRepairIds: scheduler.snapshot().seenAttempts.filter((item) => item.repairRequired).map((item) => item.subtaskId),
      };
    },
    waitForInFlightWork() {
      const view = scheduler.wait().view;
      return { runningCount: view.running.length, pendingCount: view.pending.length, dependencyBlocks: view.dependencyBlocks };
    },
    protocolMiss(_held, _reason, diagnostic) {
      misses.push(diagnostic?.reasonCode ?? "protocol");
      return "stop";
    },
    markDecisionAccepted() {},
    clearProtocolFailure() {},
    acknowledgeUserMessages(count) { scheduler.ackUserMessages(count); },
    acknowledgeReports(ids) { return ids.length === 0 || scheduler.acknowledgeReports(ids); },
    captureRemainingUserMessagesForHeldReview() {},
    applyControls() { throw new Error("Unexpected controls"); },
    planControls() { throw new Error("Unexpected control planning"); },
    previewControls() { throw new Error("Unexpected control preview"); },
    commitControls() { throw new Error("Unexpected control commit"); },
    dispatchSubtasks(subtasks) {
      return scheduler.dispatch(subtasks.map((item) => ({
        subtaskId: item.id,
        attemptId: `${item.id}-contract`,
        requiresAcceptance: item.requiresAcceptance,
        writeFiles: item.writeFiles,
        dependsOn: item.dependsOn,
      })));
    },
    submitReviewBatch(ids, verdicts) { return scheduler.submitReviewBatch(ids, verdicts); },
    requeueCurrentReview() { scheduler.requeueCurrentReview(); },
    promoteDecisionWork() { scheduler.promotePending(); },
    persistRunning() {},
    persistSnapshot() {},
    applyNextStepPlan() {},
    persistEstimatedRounds() {},
    persistProgressPercent() {},
    noteWaiting() {},
    pauseForReview() {},
    armCloseout() {},
    tryFinishParent() { return scheduler.complete().ok; },
    finishParent() { finished = true; return "stop"; },
  };
  return {
    misses,
    finished: () => finished,
    apply(decision: LoopPlusDecision, input: LoopPlusDecisionContractInput) {
      return loopPlusDecisionStrategyFor(decision.status)(port, {
        kind: input.acceptanceEventIds.length > 0 ? "review" : "continue",
        eventId: input.acceptanceEventIds[0] ?? null,
        eventIds: input.acceptanceEventIds,
        userMessageCount: input.pendingUserMessages?.length ?? 0,
      }, decision);
    },
  };
}

for (const batchSize of [1, 4]) {
  test(`frozen batch of ${batchSize} keeps order and gates dispatch by the explicit window`, () => {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
    const tasks = Array.from({ length: batchSize }, (_, index) => spec(`batch-${index}`));
    scheduler.dispatch(tasks);
    for (const task of tasks) scheduler.finish({ ...task, outcome: "completed" });
    const acceptanceEventIds = scheduler.prepareReviewBatch(4).items.map((item) => item.eventId);
    const before = scheduler.snapshot();
    for (const allowDispatchBeforeReview of [false, true]) {
      const input = inputFor(scheduler, { acceptanceEventIds, allowDispatchBeforeReview });
      const examples = examplesFor(input);
      assert.equal([...examples.keys()][0], "accept");
      assert.equal(examples.has("dispatch"), allowDispatchBeforeReview);
      assert.equal(examples.has("wait"), false);
      assert.equal(examples.has("steer"), false);
      const accept = examples.get("accept")!;
      assert.deepEqual(accept.reviewEventIds ?? [accept.reviewEventId], acceptanceEventIds);
      assert.deepEqual(accept.reviews?.map((item) => item.reviewEventId), acceptanceEventIds);
      const repairs = accept.reviews?.flatMap((item) => item.subtaskIds ?? []) ?? [];
      assert.deepEqual(repairs, [tasks.at(-1)!.subtaskId]);
      assert.deepEqual(new Set([...repairs, ...(accept.independentSubtaskIds ?? [])]), new Set(accept.subtasks?.map((item) => item.id)));
      if (allowDispatchBeforeReview) {
        const dispatch = examples.get("dispatch")!;
        assert.ok(dispatch.nextStepPlan?.objective);
        for (const key of ["reviewEventId", "reviewEventIds", "reviews", "controls"]) assert.equal(key in dispatch, false);
        assert.ok(dispatch.subtasks?.every((item) => !item.dependsOn?.length));
      }
      assert.deepEqual(scheduler.snapshot(), before);
    }
    const input = inputFor(scheduler, { acceptanceEventIds });
    const completed = examplesFor(input).get("completed")!;
    assert.ok(completed);
    assert.equal(input.view.canComplete, false);
    const host = strategyHarness(scheduler);
    host.apply(completed, input);
    assert.deepEqual(host.misses, []);
    assert.equal(host.finished(), true);
  });
}

test("a full interrupted reservation offers a valid replacement dispatch and a steer that preserves dependencies", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([spec("prior")]);
  scheduler.finish({ ...spec("prior"), outcome: "completed" });
  const batch = scheduler.prepareReviewBatch(1);
  scheduler.submitReviewBatch(batch.items.map(item => item.eventId), "passed");
  scheduler.dispatch([{ ...spec("old"), dependsOn: ["prior"] }]);
  const input = inputFor(scheduler, { interruptedSubtaskIds: ["old"] });
  const examples = examplesFor(input);
  assert.equal(deriveLoopPlusDecisionContract(input).availableSlots, 0);
  assert.deepEqual(examples.get("dispatch")?.controls?.map(control => [control.id, control.action]), [["old", "close"]]);
  assert.deepEqual(examples.get("dispatch")?.subtasks?.[0].dependsOn, ["prior"]);
  assert.equal(examples.get("steer")?.controls?.[0].id, "old");
  assert.equal(examples.get("steer")?.controls?.[0].dependsOn, undefined);
  assert.equal(examples.has("wait"), false);
});

test("report-only hands off the exact frozen report prefix despite an open batch and later arrivals", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  const tasks = [spec("review"), spec("report-b", false), spec("report-a", false), spec("later", false)];
  scheduler.dispatch(tasks);
  for (const task of tasks.slice(0, 3)) scheduler.finish({ ...task, outcome: "completed" });
  scheduler.prepareReviewBatch(4);
  const reportEventIds = scheduler.wait().view.reportQueue!.map((item) => item.eventId);
  scheduler.finish({ ...tasks[3], outcome: "completed" });
  const input = inputFor(scheduler, { reportEventIds, reportOnly: true, allowDispatchBeforeReview: true });
  const examples = examplesFor(input);
  assert.deepEqual([...examples.keys()], ["wait"]);
  assert.deepEqual(examples.get("wait"), { status: "wait", reportEventIds });
  assert.equal(scheduler.acknowledgeReports(reportEventIds), true);
  assert.equal(scheduler.wait().view.reportQueue?.length, 1);
  assert.equal(scheduler.wait().view.visibleReviewCount, 1);
  assert.equal(scheduler.complete().ok, false);
});

test("running and capacity-queued work expose wait and steer without dispatch or completion", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([spec("running"), spec("queued")]);
  const input = inputFor(scheduler);
  const examples = examplesFor(input);
  assert.deepEqual([...examples.keys()], ["wait", "steer", "blocked", "clarify"]);
  assert.equal(examples.get("steer")?.controls?.[0].id, "running");
  const host = strategyHarness(scheduler);
  assert.equal(host.apply(examples.get("wait")!, input), "wait");
  assert.deepEqual(host.misses, []);
});

test("deferred runnable reservations can advance while failed dependencies require an active decision", () => {
  const runnable = createLoopPlusScheduler({ maxConcurrency: 1 });
  runnable.dispatch([spec("deferred")], { deferPromotion: true });
  const runnableInput = inputFor(runnable);
  assert.equal(examplesFor(runnableInput).has("wait"), true);
  const progressing = strategyHarness(runnable);
  assert.equal(progressing.apply({ status: "wait" }, runnableInput), "wait");
  assert.deepEqual(progressing.misses, []);

  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const source = spec("source");
  scheduler.dispatch([source]);
  scheduler.finish({ ...source, outcome: "failed" });
  const batch = scheduler.prepareReviewBatch(4).items;
  scheduler.submitReviewBatch(batch.map((item) => item.eventId), "failed");
  scheduler.dispatch([spec("dependent", true, ["source"])]);
  const input = inputFor(scheduler);
  assert.equal(input.view.dependencyBlocks?.[0].reason, "failed");
  const examples = examplesFor(input);
  assert.equal(examples.has("wait"), false);
  assert.equal(examples.has("dispatch"), true);
  assert.equal(examples.has("completed"), false);
  const host = strategyHarness(scheduler);
  host.apply({ status: "wait" }, input);
  assert.deepEqual(host.misses, ["state.wait.dependency_blocked"]);
});

test("a frozen report can close out after consumption but cannot turn failed-dependency waiting into progress", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const report = spec("report", false);
  scheduler.dispatch([report]);
  scheduler.finish({ ...report, outcome: "completed" });
  const reportEventIds = scheduler.wait().view.reportQueue!.map((item) => item.eventId);
  const input = inputFor(scheduler, { reportEventIds });
  const examples = examplesFor(input);
  assert.equal(input.view.canComplete, false);
  assert.equal(examples.has("wait"), true);
  const completed = examples.get("completed")!;
  assert.deepEqual(completed.reportEventIds, reportEventIds);
  const host = strategyHarness(scheduler);
  host.apply(completed, input);
  assert.equal(host.finished(), true);
  assert.deepEqual(host.misses, []);
});

test("required repair IDs survive an otherwise empty view and appear in the dispatch shape", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const source = spec("repair-source");
  scheduler.dispatch([source]);
  scheduler.finish({ ...source, outcome: "completed" });
  const ids = scheduler.prepareReviewBatch(4).items.map((item) => item.eventId);
  scheduler.submitReviewBatch(ids, [{ eventId: ids[0], acceptance: "failed", reason: "Regression failed", repairRequired: true }]);
  const input = inputFor(scheduler, { requiredRepairIds: [source.subtaskId] });
  const examples = examplesFor(input);
  assert.equal(examples.has("completed"), false);
  assert.equal(examples.has("wait"), false);
  assert.equal(examples.get("dispatch")?.subtasks?.[0].id, source.subtaskId);
  const clean = examplesFor(inputFor(createLoopPlusScheduler({ maxConcurrency: 2 }))).get("completed")!;
  const host = strategyHarness(scheduler);
  host.apply(clean, input);
  assert.deepEqual(host.misses, ["state.completion.repair_required"]);
  assert.equal(host.finished(), false);
});

for (const late of ["review", "report", "message"] as const) {
  test(`completion consumes the frozen prefixes and leaves a late ${late} pending`, () => {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
    const reviewed = spec("reviewed");
    const report = spec("report", false);
    scheduler.dispatch([reviewed, report]);
    scheduler.finish({ ...reviewed, outcome: "completed" });
    scheduler.finish({ ...report, outcome: "completed" });
    const acceptanceEventIds = scheduler.prepareReviewBatch(4).items.map((item) => item.eventId);
    const reportEventIds = scheduler.wait().view.reportQueue!.map((item) => item.eventId);
    scheduler.enqueueUserMessage("frozen message");
    const frozenInput = inputFor(scheduler, { acceptanceEventIds, reportEventIds, pendingUserMessages: ["frozen message"] });
    const completed = examplesFor(frozenInput).get("completed")!;
    assert.ok(completed);
    if (late === "message") {
      scheduler.enqueueUserMessage("late message");
    } else {
      const task = spec(`late-${late}`, late === "review");
      scheduler.dispatch([task]);
      scheduler.finish({ ...task, outcome: "completed" });
    }
    const latest = inputFor(scheduler, frozenInput);
    latest.view = scheduler.wait().view;
    assert.equal(examplesFor(latest).has("completed"), false);
    const host = strategyHarness(scheduler);
    assert.equal(host.apply(completed, frozenInput), "continue");
    assert.equal(host.finished(), false);
    assert.equal(scheduler.snapshot().completed, false);
    if (late === "message") assert.deepEqual(scheduler.wait().view.userMessageQueue, ["late message"]);
    if (late === "report") assert.equal(scheduler.wait().view.reportQueue?.length, 1);
    if (late === "review") assert.equal(scheduler.wait().view.visibleReviewCount, 1);
    assert.deepEqual(host.misses, []);
  });
}

test("unconsumed messages, unknown events, failed outcomes and terminal parents withhold completion", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.enqueueUserMessage("new scope");
  assert.equal(examplesFor(inputFor(scheduler)).has("completed"), false);
  assert.equal(examplesFor(inputFor(scheduler, { pendingUserMessages: ["new scope"] })).has("completed"), true);
  assert.equal(examplesFor(inputFor(scheduler, { acceptanceEventIds: ["unknown"], pendingUserMessages: ["new scope"] })).has("completed"), false);
  for (const outcome of ["failed", "stopped"] as const) {
    const failed = createLoopPlusScheduler({ maxConcurrency: 2 });
    const task = spec(outcome);
    failed.dispatch([task]);
    failed.finish({ ...task, outcome });
    const acceptanceEventIds = failed.prepareReviewBatch(4).items.map((item) => item.eventId);
    const examples = examplesFor(inputFor(failed, { acceptanceEventIds }));
    assert.equal(examples.has("completed"), false);
    assert.equal(examples.get("accept")?.reviews?.[0].acceptance, "failed");
  }
  for (const terminal of ["stopParent", "complete"] as const) {
    const ended = createLoopPlusScheduler({ maxConcurrency: 2 });
    ended[terminal]();
    const examples = examplesFor(inputFor(ended));
    assert.equal(examples.has("completed"), false);
    assert.equal(examples.has("dispatch"), false);
  }
});

test("open-batch illegal neighbors remain rejected by existing strategies and parser", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const tasks = [spec("first"), spec("second")];
  scheduler.dispatch(tasks);
  for (const task of tasks) scheduler.finish({ ...task, outcome: "completed" });
  const acceptanceEventIds = scheduler.prepareReviewBatch(4).items.map((item) => item.eventId);
  const input = inputFor(scheduler, { acceptanceEventIds });
  const examples = examplesFor(input);
  const before = scheduler.snapshot();
  for (const decision of [{ status: "wait" }, { status: "dispatch", subtasks: [] }, { status: "steer", controls: [] }] as LoopPlusDecision[]) {
    const host = strategyHarness(scheduler);
    host.apply(decision, input);
    assert.equal(host.misses.length, 1);
    assert.deepEqual(scheduler.snapshot(), before);
  }
  const accept = examples.get("accept")!;
  assert.equal(parseLoopPlusDecision(JSON.stringify({ ...accept, reviews: [...accept.reviews!].reverse() })), null);
  const missingAssociation = { ...accept, independentSubtaskIds: [] };
  assert.equal(parseLoopPlusDecision(JSON.stringify(missingAssociation)), null);
  const reversed = { ...accept, reviewEventIds: [...acceptanceEventIds].reverse(), reviews: [...accept.reviews!].reverse() };
  assert.ok(parseLoopPlusDecision(JSON.stringify(reversed)));
  const host = strategyHarness(scheduler);
  host.apply(reversed, input);
  assert.deepEqual(host.misses, ["state.review_batch.mismatch"]);
  assert.deepEqual(scheduler.snapshot(), before);
});

test("generated window shapes preserve frozen reports and text candidate JSONC compatibility", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  const tasks = [spec("review"), spec("report-b", false), spec("report-a", false)];
  scheduler.dispatch(tasks);
  for (const task of tasks) scheduler.finish({ ...task, outcome: "completed" });
  const acceptanceEventIds = scheduler.prepareReviewBatch(4).items.map((item) => item.eventId);
  const reportEventIds = scheduler.wait().view.reportQueue!.map((item) => item.eventId);
  for (const allowDispatchBeforeReview of [true, false]) {
    const examples = examplesFor(inputFor(scheduler, { acceptanceEventIds, reportEventIds, allowDispatchBeforeReview }));
    for (const decision of examples.values()) assert.deepEqual(decision.reportEventIds, reportEventIds);
    if (allowDispatchBeforeReview) {
      const json = JSON.stringify(examples.get("dispatch"), null, 2).replace(/\n}$/, ",\n}");
      const candidate = `Reasoning before the decision.\n\`\`\`jsonc\n// frozen report prefix\n${json}\n\`\`\``;
      assert.deepEqual(parseLoopPlusDecision(candidate), examples.get("dispatch"));
      const illegal = { ...examples.get("dispatch"), reviewEventIds: acceptanceEventIds };
      assert.equal(parseLoopPlusDecision(JSON.stringify(illegal)), null);
    }
  }
});
