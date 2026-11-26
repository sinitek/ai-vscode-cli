import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import { withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
import type { PromptRunInput } from "../../promptRunTypes";
import type { LoopPlusRuntimeFixture } from "./fixtures/loopPlusRuntimeFixture";

installVscodeMock();

const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const { buildLoopPlusFinishEventId, createLoopPlusScheduler } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
const { createLoopGroupChatPanelCoordinator, buildLoopGroupChatPanelState } = require("../../extensionHost/loopGroupChatPanelCoordinator") as typeof import("../../extensionHost/loopGroupChatPanelCoordinator");

const rootPrompt = "SYNTHETIC_ROOT_PROMPT";
const reportBody = "SYNTHETIC_UNACKNOWLEDGED_REPORT_BODY";
const rejectionBody = "SYNTHETIC_REJECTED_DECISION_BODY";

function child(id: string, requiresAcceptance = true) {
  return { id, title: id, prompt: `SYNTHETIC_CHILD_PROMPT ${id}`, writeFiles: [`src/${id}.ts`], taskType: "backend" as const, requiresAcceptance };
}

function queueTurn(fixture: LoopPlusRuntimeFixture, label: string) {
  let turn: { input: PromptRunInput; tabId: string; reply: (value: unknown) => void; cancel: () => void } | undefined;
  fixture.queueMain(async (input, tabId) => {
    const held = fixture.holdMain();
    turn = {
      input, tabId,
      reply: (value) => {
        fixture.publish(input, tabId, { status: "end", content: JSON.stringify(withLoopPlusAcceptReviews(value)) });
        fixture.releaseHeldMain();
      },
      cancel: () => {
        fixture.publish(input, tabId, { status: "stopped", content: "SYNTHETIC_CANCELLED_DECISION_BODY" });
        fixture.releaseHeldMain();
      },
    };
    await held;
  });
  return async () => {
    await waitForLoopPlus(() => Boolean(turn), label);
    return turn!;
  };
}

type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
type Panel = NonNullable<ReturnType<CoordinatorDeps["panelsByTaskId"]["get"]>>;

test("a bounded linkage rejection preserves the frozen batch through group-chat continuation and same-ID repair", { timeout: 20000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture({ maxConcurrency: 5, decisionSubtaskMax: () => 5 });
  const host = fixture.adapter.host();
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const panelMessages: unknown[] = [];
  const warnings: string[] = [];
  const panelFiles = new Map<string, string>();
  const tasksWithOwnership = new Set<string>();
  const lifecycleRuns: Promise<unknown>[] = [];
  let taskId = "";
  const task = () => {
    const record = fixture.readTask(taskId);
    assert.ok(record, "the original task must remain readable");
    return record;
  };
  const snapshot = () => createLoopPlusScheduler({ snapshot: task().loopPlus }).snapshot();
  const pendingEvents = () => {
    const { currentReview, reviewQueue, reportQueue, pending } = snapshot();
    return { currentReview, reviewQueue, reportQueue, pending };
  };
  const attempts = () => fixture.attemptCalls.map(({ loopSubtaskId, loopAttemptId }) => [loopSubtaskId, loopAttemptId]);
  const protocolLogs = (event: string) => fixture.logs.filter((item) => item.event === event).map((item) => item.detail);
  const panelsByTaskId: CoordinatorDeps["panelsByTaskId"] = new Map();
  const deps: CoordinatorDeps = {
    panelsByTaskId,
    getExtensionUri: () => assert.fail("continuation must reuse the existing panel"),
    normalizeTaskId: (value) => typeof value === "string" ? value : null,
    normalizeSupplementalRequirement: (value) => typeof value === "string" ? value.trim() : null,
    appendSupplementalRequirement: (existing, next) => [...(existing ?? []), next],
    appendSupplementalRequirementToCommunication: () => assert.fail("unexpected supplemental report write"),
    recordPromptHistory: () => undefined,
    readTaskRecord: fixture.readTask,
    updateTaskRecord: () => assert.fail("the coordinator must let the runtime commit the resume"),
    listTaskStoreFiles: () => [], readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(tasksWithOwnership),
    resolveMainPromptTarget: () => fixture.target,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => null,
    getSelectedCliModel: () => "main-model",
    getSelectedLoopCliModel: (_cli, role) => role === "main" ? "main-model" : "sub-model",
    getSelectedLoopSubtaskMode: () => "fullstack",
    getLoopRoleExplicitModel: (_configId, role) => ({ configured: role === "fullstack", model: "sub-model" }),
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async (tabId) => { assert.equal(tabId, fixture.target.tabId); },
    runLoopPrompt: async (input, options) => {
      assert.equal(options.resumeTaskId, taskId);
      assert.equal(options.targetTabId, fixture.target.tabId);
      try {
        await fixture.adapter.runEventDriven(input, options, fixture.target, (ownedId, target) => {
          assert.equal(ownedId, taskId);
          assert.deepEqual(target, fixture.target);
          tasksWithOwnership.add(ownedId);
          options.onTaskStarted?.();
        });
      } finally {
        tasksWithOwnership.delete(taskId);
      }
    },
    getActiveSubtaskIds: () => fixture.parkedSubtaskIds(),
    getActiveReviewEventIds: host.getActiveReviewEventIds,
    stopRunsForTask: () => assert.fail("unexpected group-chat stop"),
    markTaskStoppedByUser: () => assert.fail("unexpected group-chat stop record"),
    getActiveConversationTaskId: () => taskId,
    postPanelState: async () => undefined,
    pickTask: async () => null,
    readTextFileIfNonEmpty: (filePath) => panelFiles.get(filePath) || null,
    fileExists: (filePath) => panelFiles.has(filePath),
    writeTextFileEnsuringDir: (filePath, content) => {
      panelFiles.set(filePath, content);
      return true;
    },
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    showInformationMessage: (message) => warnings.push(message),
    showWarningMessage: (message) => warnings.push(message),
    logEvent: (event, payload) => logs.push({ event, payload }),
    t: (key) => key,
  };
  const panelPort: Pick<Panel, "getState" | "setAskThread" | "update" | "post"> = {
    getState: () => buildLoopGroupChatPanelState(task(), deps),
    setAskThread: () => undefined,
    update: () => undefined,
    post: (message) => { panelMessages.push(message); },
  };
  const panel = panelPort as Panel;
  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  const request = (requestId: string) => {
    const run = coordinator.handleMessage(taskId, {
      type: "loopGroupChatChat:continueTask", prompt: `SYNTHETIC_CONTINUE_PROMPT ${requestId}`, requestId,
    }, panel);
    lifecycleRuns.push(run);
    return run;
  };
  const checkRequest = (requestId: string, started: boolean, taskStatus: string) => {
    const identity = { taskId, requestId };
    const expected = [
      { event: "received", payload: { ...identity, panelMatchesTask: true } },
      { event: "started", payload: { ...identity, source: "coordinator" } },
      { event: "evaluated", payload: { ...identity, status: "needs-review", schedulingMode: "event_driven", runningTask: false } },
      { event: "subtasks-fallback", payload: { ...identity, path: "main_target" } },
      { event: "dispatch", payload: { ...identity, path: "main_target", cli: "codex" } },
      ...(started ? [{ event: "task-started", payload: identity }] : []),
      { event: "settled", payload: { ...identity, taskStatus, canContinue: true } },
    ];
    assert.deepEqual(logs.filter((item) => item.payload.requestId === requestId),
      expected.map(({ event, payload }) => ({ event: `loop-group-chat-continue-${event}`, payload })));
    assert.deepEqual(panelMessages.filter((message) => (message as { requestId?: string }).requestId === requestId), [
      ...(started ? [{ type: "loopGroupChatChat:continueTaskStarted", requestId }] : []),
      { type: "loopGroupChatChat:continueTaskSettled", requestId, canContinue: true },
    ]);
  };

  try {
    const initial = queueTurn(fixture, "initial dispatch");
    lifecycleRuns.push(fixture.adapter.runEventDriven({ displayPrompt: rootPrompt, modelPrompt: rootPrompt, contextTags: [],
      loopMainModel: "main-model", loopSubtaskModel: "sub-model", loopSubtaskMode: "fullstack", loopSubtaskFullstackModel: "sub-model" },
    { schedulingMode: "event_driven" }, fixture.target));
    const initialTurn = await initial();
    taskId = initialTurn.input.loopTaskId!;
    const originalSession = task().sessionId;
    assert.equal(originalSession, fixture.target.sessionId);
    panelsByTaskId.set(taskId, panel);
    const childIds = ["anchor", "source", "peer", "late", "report"];
    initialTurn.reply({ status: "dispatch", subtasks: childIds.map((id) => child(id, id !== "report")) });
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === childIds.length, "all original attempts parked");
    assert.deepEqual(fixture.attemptCalls.map((call) => call.model), childIds.map(() => "sub-model"));
    const originalAttempts = attempts();
    const finishId = (id: string) => {
      const attemptId = fixture.peekParked(id)?.input.loopAttemptId;
      assert.ok(attemptId);
      return buildLoopPlusFinishEventId(id, attemptId);
    };
    const anchorId = finishId("anchor");
    const frozenIds = [finishId("source"), finishId("peer")];
    const lateId = finishId("late");
    const reportId = finishId("report");

    const anchorReview = queueTurn(fixture, "anchor review holds the consumer while the next two events arrive");
    fixture.finishParked("anchor", { status: "end", content: "SYNTHETIC_DELIVERY_BODY anchor" });
    const anchorTurn = await anchorReview();
    assert.deepEqual(host.getActiveReviewEventIds(taskId), [anchorId]);
    for (const id of ["source", "peer"]) {
      fixture.finishParked(id, { status: "end", content: `SYNTHETIC_DELIVERY_BODY ${id}` });
      await waitForLoopPlus(() => snapshot().reviewQueue.some((event) => event.subtaskId === id), `${id} queued before review`);
    }
    const review = queueTurn(fixture, "frozen review starts");
    anchorTurn.reply({ status: "accept", reviewEventId: anchorId, progressPercent: 20 });
    const reviewTurn = await review();
    assert.deepEqual(protocolLogs("loop-plus-protocol-miss"), [], "the setup acceptance must pass protocol validation");
    const checkFrozenTurn = (turn: typeof reviewTurn) => {
      assert.equal(turn.input.loopTaskId, taskId);
      assert.equal(turn.tabId, fixture.target.tabId);
      assert.equal(task().sessionId, originalSession);
      assert.deepEqual(host.getActiveReviewEventIds(taskId), frozenIds);
      assert.ok(turn.input.modelPrompt.includes(`\n1. ${frozenIds[0]}\n2. ${frozenIds[1]}\n`));
      assert.match(turn.input.modelPrompt, /reportEventIds=omit when none/u);
    };
    checkFrozenTurn(reviewTurn);
    for (const id of ["late", "report"]) {
      fixture.finishParked(id, { status: "end", content: id === "report" ? reportBody : `SYNTHETIC_DELIVERY_BODY ${id}` });
      await waitForLoopPlus(() => [...snapshot().reviewQueue, ...(snapshot().reportQueue ?? [])]
        .some((event) => event.subtaskId === id), `${id} queued after review froze`);
    }
    const frozenQueues = pendingEvents();
    assert.equal(frozenQueues.currentReview?.eventId, frozenIds[0]);
    assert.deepEqual(frozenQueues.reviewQueue.map((item) => item.eventId), [frozenIds[1], lateId]);
    assert.deepEqual(frozenQueues.reportQueue?.map((item) => item.eventId), [reportId]);
    const accept = (repairId: string) => ({ status: "accept", reviewEventIds: frozenIds, progressPercent: 40,
      reviews: [
        { reviewEventId: frozenIds[0], acceptance: "failed", reason: rejectionBody, subtaskIds: [repairId] },
        { reviewEventId: frozenIds[1], acceptance: "passed" },
      ], subtasks: [child(repairId)],
    });
    const badLink = accept("repair-alias");
    const expectedMiss = (count: number, dispatchWindow: string) => ({ taskId, held: true,
      protocolFailureCount: count, rejectionKind: "state", reasonCode: "state.repair.linkage_conflict", fieldPath: "subtasks",
      dispatchWindow, attemptState: count === 1 ? "first" : "retry",
    });
    const expectedRecovery = (count: number, result: string, attemptState = count === 1 ? "first" : "retry") => ({
      taskId, attemptState, protocolFailureCount: count, automaticRetryLimit: 3, result,
    });
    const rejectThroughBudget = async (firstTurn: Awaited<ReturnType<ReturnType<typeof queueTurn>>>, mainCalls: number) => {
      let currentTurn = firstTurn;
      const userMessages = snapshot().userMessageQueue;
      for (const count of [1, 2, 3]) {
        const retry = queueTurn(fixture, `fresh automatic continuation ${count}`);
        currentTurn.reply(badLink);
        currentTurn = await retry();
        checkFrozenTurn(currentTurn);
        assert.equal(fixture.mainCalls.length, mainCalls + count);
        assert.deepEqual(pendingEvents(), frozenQueues);
        assert.deepEqual(snapshot().userMessageQueue, userMessages);
        assert.deepEqual(attempts(), originalAttempts);
        assert.deepEqual(protocolLogs("loop-plus-protocol-recovery").at(-1), expectedRecovery(count, "continuation_requested"));
      }
      currentTurn.reply(badLink);
    };
    await rejectThroughBudget(reviewTurn, 3);
    await lifecycleRuns[0];
    assert.equal(task().status, "needs-review");
    assert.equal(fixture.mainCalls.length, 6, "initial dispatch, anchor review, frozen review, three retries");
    assert.match(task().finalSummary ?? "", /已自动继续执行 3 次.*state\.repair\.linkage_conflict/su);
    const missSequence = (firstWindow: string) => [1, 2, 3, 4].map((count) => expectedMiss(count, count === 1 ? firstWindow : "closed"));
    assert.deepEqual(protocolLogs("loop-plus-protocol-miss"), missSequence("open"));
    const recoverySequence = [1, 2, 3, 4].map((count) => expectedRecovery(count, count < 4 ? "continuation_requested" : "paused"));
    assert.deepEqual(protocolLogs("loop-plus-protocol-recovery"), recoverySequence);
    assert.deepEqual(pendingEvents(), frozenQueues);
    assert.deepEqual(attempts(), originalAttempts);

    fixture.setCompatible(false);
    await request("denied-resume");
    checkRequest("denied-resume", false, "needs-review");
    assert.deepEqual(fixture.refusals, ["incompatible"]);
    assert.equal(fixture.mainCalls.length, 6);
    assert.deepEqual(attempts(), originalAttempts);
    assert.deepEqual(pendingEvents(), frozenQueues);

    fixture.setCompatible(true);
    const resumedReview = queueTurn(fixture, "admitted continuation starts the original frozen review");
    const rejected = request("started-then-rejected");
    const resumedTurn = await resumedReview();
    checkFrozenTurn(resumedTurn);
    assert.deepEqual(pendingEvents(), frozenQueues);
    assert.deepEqual(attempts(), originalAttempts);
    await rejectThroughBudget(resumedTurn, 7);
    await rejected;
    assert.equal(task().status, "needs-review");
    checkRequest("started-then-rejected", true, "needs-review");
    assert.equal(fixture.mainCalls.length, 10);
    assert.deepEqual(protocolLogs("loop-plus-protocol-miss"), [
      ...missSequence("open"), ...missSequence("closed"),
    ]);
    const manualResume = expectedRecovery(4, "manual_resume", "explicit_resume");
    assert.deepEqual(protocolLogs("loop-plus-protocol-recovery"), [...recoverySequence, manualResume, ...recoverySequence]);
    assert.deepEqual(pendingEvents(), frozenQueues);
    assert.deepEqual(attempts(), originalAttempts);

    const legalReview = queueTurn(fixture, "continued review accepts the original logical repair ID");
    const repaired = request("legal-repair-resume");
    const legalTurn = await legalReview();
    checkFrozenTurn(legalTurn);
    assert.deepEqual(pendingEvents(), frozenQueues);
    const beforeRecovery = queueTurn(fixture, "legal repair follows one further rejection");
    legalTurn.reply(badLink);
    const recoveringTurn = await beforeRecovery();
    checkFrozenTurn(recoveringTurn);
    const nextReview = queueTurn(fixture, "late reviews remain available for the next batch");
    recoveringTurn.reply(accept("source"));
    await waitForLoopPlus(() => Boolean(fixture.peekParked("source")), "only the source repair runs");
    const repair = fixture.peekParked("source")!.input;
    assert.ok(repair.loopAttemptId);
    assert.notEqual(repair.loopAttemptId, originalAttempts.find(([id]) => id === "source")?.[1]);
    assert.equal(repair.loopTaskId, taskId);
    assert.equal(repair.model, "sub-model");
    assert.deepEqual(attempts(), [...originalAttempts, ["source", repair.loopAttemptId]]);
    const lateTurn = await nextReview();
    assert.deepEqual(host.getActiveReviewEventIds(taskId), [lateId]);
    assert.deepEqual(snapshot().reportQueue, frozenQueues.reportQueue);
    assert.deepEqual(fixture.createdTaskIds, [taskId]);
    assert.equal(task().sessionId, originalSession);
    assert.equal(panelsByTaskId.get(taskId), panel);
    const afterSuccess = queueTurn(fixture, "rejection after success has fresh budget");
    lateTurn.reply(badLink);
    const stoppedTurn = await afterSuccess();
    assert.deepEqual(protocolLogs("loop-plus-protocol-recovery").slice(-3), [
      expectedRecovery(1, "continuation_requested"), expectedRecovery(1, "recovered"), expectedRecovery(1, "continuation_requested"),
    ]);
    const mainCallsBeforeStop = fixture.mainCalls.length;
    host.stopParent(taskId);
    stoppedTurn.reply(badLink);
    await repaired;
    assert.ok(fixture.cancelledTabs.includes(stoppedTurn.tabId));
    assert.equal(fixture.mainCalls.length, mainCallsBeforeStop);
    assert.equal(protocolLogs("loop-plus-protocol-miss").length, 10, "a late reply after stop is not a new rejection");
    checkRequest("legal-repair-resume", true, "stopped");
    assert.deepEqual(attempts(), [...originalAttempts, ["source", repair.loopAttemptId]]);
    assert.deepEqual(warnings, []);
    assert.doesNotMatch(JSON.stringify([logs, fixture.logs]), /SYNTHETIC_(?:ROOT_PROMPT|CHILD_PROMPT|UNACKNOWLEDGED_REPORT_BODY|REJECTED_DECISION_BODY|CONTINUE_PROMPT|DELIVERY_BODY)/u);
  } finally {
    if (taskId && fixture.readTask(taskId)?.status !== "stopped") host.stopParent(taskId);
    fixture.releaseHeldMain();
    for (const id of fixture.parkedSubtaskIds()) fixture.releaseParkedIfPresent(id);
    await Promise.allSettled(lifecycleRuns);
    fixture.dispose();
  }
});

test("runner cancellation during automatic protocol continuation does not start another turn", { timeout: 5000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture({});
  const host = fixture.adapter.host();
  let taskId = "";
  const main = queueTurn(fixture, "initial decision");
  const done = fixture.adapter.runEventDriven({ displayPrompt: rootPrompt, modelPrompt: rootPrompt, contextTags: [] },
    { schedulingMode: "event_driven" }, fixture.target);
  try {
    const initial = await main();
    taskId = initial.input.loopTaskId!;
    const retry = queueTurn(fixture, "automatic continuation before cancellation");
    initial.reply({ status: "invalid", content: rejectionBody });
    (await retry()).cancel();
    await done;
    assert.equal(fixture.readTask(taskId)?.status, "stopped");
    assert.equal(fixture.mainCalls.length, 2);
    assert.equal(fixture.attemptCalls.length, 0);
    assert.equal(fixture.logs.filter(({ event }) => event === "loop-plus-protocol-miss").length, 1);
    assert.doesNotMatch(JSON.stringify(fixture.logs), /SYNTHETIC_(?:ROOT_PROMPT|REJECTED_DECISION_BODY|CANCELLED_DECISION_BODY)/u);
  } finally {
    if (taskId && fixture.readTask(taskId)?.status !== "stopped") host.stopParent(taskId);
    fixture.releaseHeldMain();
    await Promise.allSettled([done]);
    fixture.dispose();
  }
});
