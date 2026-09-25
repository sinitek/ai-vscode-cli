import assert = require("node:assert/strict");
import test = require("node:test");

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  buildLoopDebateChatPanelStateWithDeps,
  projectLoopPlusPanel,
} = require("../../panelStateBuilder") as typeof import("../../panelStateBuilder");
const {
  createLoopPlusScheduler,
} = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");

type LoopPlusScheduler = ReturnType<typeof createLoopPlusScheduler>;
type LoopPlusSchedulerSnapshot = ReturnType<LoopPlusScheduler["snapshot"]>;
type LoopTaskRecord = import("../../loopTaskStore").LoopTaskRecord;

function spec(subtaskId: string, attemptId: string, title?: string) {
  return {
    subtaskId,
    attemptId,
    ...(title ? { title } : {}),
    writeFiles: [`loop-plus/${subtaskId}-${attemptId}.txt`],
  };
}

function dispatchAndFinish(
  scheduler: LoopPlusScheduler,
  subtaskId: string,
  attemptId: string,
  detail?: string,
): void {
  const dispatched = scheduler.dispatch([spec(subtaskId, attemptId, subtaskId)]);
  assert.equal(dispatched.rejected.length, 0);
  assert.equal(dispatched.started.length, 1);
  const finished = scheduler.finish({
    subtaskId,
    attemptId,
    outcome: "completed",
    ...(detail ? { detail } : {}),
  });
  assert.equal(finished.applied, true);
}

function parallelSnapshot(): LoopPlusSchedulerSnapshot {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1", "<script>alert(1)</script>");
  dispatchAndFinish(scheduler, "B", "b-1", "report-B");
  dispatchAndFinish(scheduler, "C", "c-1", "report-C");
  const running = scheduler.dispatch([spec("D", "d-1", "<b>running</b>")]);
  assert.equal(running.started[0]?.subtaskId, "D");
  const pending = scheduler.dispatch([spec("E", "e-1", "Echo")]);
  assert.equal(pending.started.length, 0);
  assert.equal(pending.decisions[0]?.admission, "pending");
  return scheduler.snapshot();
}

function queueWithoutRunningSnapshot(): LoopPlusSchedulerSnapshot {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  dispatchAndFinish(scheduler, "B", "b-1");
  dispatchAndFinish(scheduler, "C", "c-1");
  const current = scheduler.snapshot().currentReview;
  assert.ok(current);
  const submitted = scheduler.submitReview(current.eventId);
  assert.equal(submitted.ok, true);
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.currentReview, null);
  assert.deepEqual(snapshot.reviewQueue.map((item) => item.subtaskId), ["B", "C"]);
  assert.equal(snapshot.running.length, 0);
  return snapshot;
}

function stoppedAndResumed(): { stopped: LoopPlusSchedulerSnapshot; resumed: LoopPlusSchedulerSnapshot } {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  dispatchAndFinish(scheduler, "B", "b-1");
  const stoppedResult = scheduler.stopParent();
  assert.equal(stoppedResult.reason, "stopped");
  const stopped = scheduler.snapshot();
  const resumedResult = scheduler.resumeParent();
  assert.equal(resumedResult.ok, true);
  assert.equal(resumedResult.reason, "resumed");
  assert.equal(resumedResult.wake, true);
  return { stopped, resumed: scheduler.snapshot() };
}

function task(loopPlus: unknown, overrides: Partial<LoopTaskRecord> = {}): LoopTaskRecord {
  return {
    id: "loop-plus-task",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/loop-plus-tasks.json",
    rootPrompt: "Review each finished subtask.",
    schedulingMode: "event_driven",
    status: "running",
    createdAt: 10,
    updatedAt: 20,
    maxRounds: 6,
    currentRound: 4,
    communicationDir: "/tmp/loop-plus-task",
    mainCommunicationFile: "/tmp/loop-plus-task/main.md",
    activeSubtaskIds: [],
    subTasks: [
      { id: "A", title: "Alpha", status: "completed", updatedAt: 11 },
      { id: "B", title: "Bravo", status: "completed", updatedAt: 12 },
      { id: "C", title: "Charlie", status: "completed", updatedAt: 13 },
      { id: "D", title: "Delta", status: "running", updatedAt: 14 },
      { id: "E", title: "Echo", status: "pending", updatedAt: 15 },
    ],
    rounds: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
    loopPlus,
    ...overrides,
  };
}

function deps(writes: { count: number } = { count: 0 }) {
  return {
    collectRunningLoopTaskIds: () => new Set<string>(),
    readTextFileIfNonEmpty: () => "# Loop chat\n\nstatus line\n",
    fileExists: () => true,
    writeTextFileEnsuringDir: () => {
      writes.count += 1;
      return true;
    },
    getActiveLoopSubtaskIds: () => [],
    buildLoopCompletedConclusionAndSummaryMarkdown: () => "done",
    t: (key: string) => key,
  };
}

test("projects the current review, FIFO queue, running work, and pending work from the snapshot", () => {
  const snapshot = parallelSnapshot();
  const source = task(snapshot);
  const before = JSON.stringify(snapshot);
  const writes = { count: 0 };
  const state = buildLoopDebateChatPanelStateWithDeps(source, deps(writes));
  const projection = state.loopPlus;

  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(writes.count, 0);
  assert.ok(projection?.ok);
  if (!projection?.ok) {
    return;
  }
  assert.equal(projection.phase, "reviewing");
  assert.equal(projection.activity, "reviewing");
  assert.equal(projection.currentReview?.subtaskId, "A");
  assert.equal(projection.currentReview?.attemptId, "a-1");
  assert.equal(projection.currentReview?.outcome, "completed");
  assert.deepEqual(projection.reviewQueue.map((item) => `${item.subtaskId}:${item.attemptId}`), ["B:b-1", "C:c-1"]);
  assert.deepEqual(projection.running.map((item) => `${item.subtaskId}:${item.attemptId}`), ["D:d-1"]);
  assert.deepEqual(projection.pending.map((item) => `${item.subtaskId}:${item.attemptId}`), ["E:e-1"]);
  assert.equal(projection.currentReviewCount, 1);
  assert.equal(projection.reviewQueueCount, 2);
  assert.equal(projection.visibleReviewCount, 3);
  assert.equal(projection.runningCount, 1);
  assert.equal(projection.pendingCount, 1);
  assert.equal(projection.seenAttempts.filter((item) => item.disposition === "reviewed").length, 0);
  assert.equal(state.task.currentRound, 4);
  assert.equal(state.rounds[0]?.loopRound, 4);
  assert.equal(state.rounds[0]?.status, "reviewing");
  assert.equal(state.rounds[0]?.activeSpeaker, undefined);
  assert.equal(state.rounds[0]?.completedAt, undefined);
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "main")?.status, "reviewing");
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "A")?.status, "reviewing");
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "B")?.status, "queued_review");
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "C")?.status, "queued_review");
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "D")?.status, "running");
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "E")?.status, "pending");
  assert.equal(state.task.canStop, true);
  assert.equal(state.task.canSupplement, true);
  assert.equal(state.task.canContinue, false);
});

test("shows waiting instead of a generating main task while only executions are running", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  const dispatched = scheduler.dispatch([spec("D", "d-1")]);
  assert.equal(dispatched.started.length, 1);
  const state = buildLoopDebateChatPanelStateWithDeps(task(scheduler.snapshot(), {
    subTasks: [{ id: "D", title: "Delta", status: "completed", updatedAt: 14 }],
  }), deps());
  const projection = state.loopPlus;
  assert.ok(projection?.ok);
  if (!projection?.ok) {
    return;
  }
  assert.equal(projection.phase, "waiting");
  assert.equal(projection.activity, "waiting");
  assert.equal(projection.currentReview, null);
  assert.equal(projection.reviewQueueCount, 0);
  assert.equal(projection.visibleReviewCount, 0);
  assert.equal(projection.runningCount, 1);
  assert.equal(state.rounds[0]?.activeSpeaker, undefined);
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "main")?.status, "waiting");
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "D")?.status, "running");
});

test("does not present a review queue as complete when nothing is running", () => {
  const snapshot = queueWithoutRunningSnapshot();
  const state = buildLoopDebateChatPanelStateWithDeps(task(snapshot), deps());
  const projection = state.loopPlus;
  assert.ok(projection?.ok);
  if (!projection?.ok) {
    return;
  }
  assert.equal(projection.phase, "review_ready");
  assert.equal(projection.activity, "review_pending");
  assert.equal(projection.runningCount, 0);
  assert.equal(projection.pendingCount, 0);
  assert.equal(projection.currentReviewCount, 0);
  assert.equal(projection.reviewQueueCount, 2);
  assert.equal(projection.visibleReviewCount, 2);
  assert.deepEqual(projection.reviewQueue.map((item) => item.subtaskId), ["B", "C"]);
  assert.notEqual(projection.phase, "completed");
  assert.equal(state.rounds[0]?.status, "review_ready");
  assert.equal(state.rounds[0]?.completedAt, undefined);
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "B")?.status, "queued_review");
  assert.equal(state.rounds[0]?.participants.find((item) => item.id === "A")?.status, "acceptance_passed");
  assert.equal(projection.seenAttempts.find((item) => item.attemptId === "a-1")?.outcome, "completed");
  assert.equal(projection.seenAttempts.find((item) => item.attemptId === "a-1")?.acceptance, "passed");
});

test("keeps a damaged or missing event-driven snapshot from looking idle or complete", () => {
  const missing = projectLoopPlusPanel(task(undefined));
  const absent = projectLoopPlusPanel(task(null));
  const broken = projectLoopPlusPanel(task({}));
  const classic = projectLoopPlusPanel(task(parallelSnapshot(), { schedulingMode: "classic" }));
  assert.equal(missing?.ok, false);
  assert.equal(absent?.ok, false);
  assert.equal(broken?.ok, false);
  assert.equal(classic, null);
  if (!missing || missing.ok || !absent || absent.ok || !broken || broken.ok) {
    return;
  }
  assert.equal(missing.error, "missing");
  assert.equal(absent.error, "missing");
  assert.match(broken.error, /Invalid Loop\+ scheduler snapshot/u);
  assert.equal(missing.phase, "invalid");
  assert.equal("reviewQueue" in missing, false);

  const ambiguous = parallelSnapshot();
  assert.ok(ambiguous.currentReview);
  ambiguous.currentReview.eventId = "loop-plus-finish:A:a-1";
  const invalidEvent = buildState(ambiguous);
  assert.equal(invalidEvent.loopPlus?.ok, false);
  if (!invalidEvent.loopPlus || invalidEvent.loopPlus.ok) {
    return;
  }
  assert.match(invalidEvent.loopPlus.error, /currentReview/u);
  assert.equal(invalidEvent.rounds[0]?.status, "invalid");
  assert.equal(invalidEvent.rounds[0]?.activeSpeaker, undefined);
  assert.equal(invalidEvent.rounds[0]?.participants.every((item) => item.status === "invalid"), true);
});

test("shows stopped and resumed snapshots without treating them as automatic review or completion", () => {
  const { stopped, resumed } = stoppedAndResumed();
  stopped.wakePending = true;
  const stoppedBefore = JSON.stringify(stopped);
  const stoppedState = buildState(stopped);
  assert.equal(JSON.stringify(stopped), stoppedBefore);
  const stoppedProjection = stoppedState.loopPlus;
  assert.ok(stoppedProjection?.ok);
  if (!stoppedProjection?.ok) {
    return;
  }
  assert.equal(stoppedProjection.phase, "stopped");
  assert.equal(stoppedProjection.activity, "stopped");
  assert.equal(stoppedProjection.wakePending, false);
  assert.equal(stoppedProjection.currentReview?.subtaskId, "A");
  assert.deepEqual(stoppedProjection.reviewQueue.map((item) => item.subtaskId), ["B"]);
  assert.equal(stoppedState.rounds[0]?.participants.find((item) => item.id === "main")?.status, "stopped");
  assert.equal(stoppedState.rounds[0]?.participants.find((item) => item.id === "A")?.status, "held_review");
  assert.equal(stoppedState.rounds[0]?.activeSpeaker, undefined);

  const resumedState = buildState(resumed);
  const resumedProjection = resumedState.loopPlus;
  assert.ok(resumedProjection?.ok);
  if (!resumedProjection?.ok) {
    return;
  }
  assert.equal(resumedProjection.phase, "review_ready");
  assert.equal(resumedProjection.activity, "review_pending");
  assert.equal(resumedProjection.wakePending, true);
  assert.equal(resumedProjection.currentReview, null);
  assert.deepEqual(resumedProjection.reviewQueue.map((item) => `${item.subtaskId}:${item.attemptId}`), ["A:a-1", "B:b-1"]);
  assert.equal(resumedProjection.visibleReviewCount, 2);
  assert.notEqual(resumedProjection.phase, "completed");
  assert.notEqual(resumedProjection.phase, "stopped");
});

test("preserves retry attempt identity and does not change classic main or debate speakers", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(scheduler, "A", "a-1");
  const current = scheduler.snapshot().currentReview;
  assert.ok(current);
  assert.equal(scheduler.submitReview(current.eventId).ok, true);
  const retried = scheduler.dispatch([spec("A", "a-2", "Alpha retry")]);
  assert.equal(retried.started[0]?.attemptId, "a-2");
  const retriedState = buildState(scheduler.snapshot());
  const retriedProjection = retriedState.loopPlus;
  assert.ok(retriedProjection?.ok);
  if (!retriedProjection?.ok) {
    return;
  }
  assert.deepEqual(
    retriedProjection.seenAttempts.map((item) => `${item.attemptId}:${item.disposition}`),
    ["a-1:reviewed", "a-2:open"],
  );
  assert.equal(retriedProjection.running[0]?.attemptId, "a-2");
  assert.equal(retriedState.rounds[0]?.participants.find((item) => item.id === "A")?.status, "running");

  const classic = buildLoopDebateChatPanelStateWithDeps(task(parallelSnapshot(), {
    schedulingMode: undefined,
    subTasks: [],
    activeSubtaskIds: [],
  }), deps());
  assert.equal(classic.loopPlus, undefined);
  assert.equal(classic.mode, "main_sub");
  assert.equal(classic.rounds[0]?.activeSpeaker?.kind, "main");
  assert.equal(classic.rounds[0]?.participants.find((item) => item.id === "main")?.status, "running");
  assert.equal(classic.rounds[0]?.status, "running");

  const debate = buildLoopDebateChatPanelStateWithDeps(task(undefined, {
    schedulingMode: undefined,
    loopPlus: undefined,
    executionMode: "debate_multi_agent",
    subTasks: [],
    debateRounds: [{
      loopRound: 2,
      debateRound: 1,
      status: "running",
      startedAt: 30,
      briefFile: "/tmp/debate-brief.md",
      activeSpeaker: { kind: "moderator", id: "moderator", title: "Judge", dialogueTurn: 2, updatedAt: 31 },
      participants: [],
      moderatorDecisions: [],
    }],
  }), {
    ...deps(),
    fileExists: () => false,
  });
  assert.equal(debate.loopPlus, undefined);
  assert.equal(debate.mode, "debate");
  assert.equal(debate.rounds[0]?.activeSpeaker?.kind, "moderator");
  assert.equal(debate.rounds.some((round) => round.kind === "execution"), false);
});

test("distinguishes an idle validated snapshot from a fully closed Loop+ task", () => {
  const idleScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  const idle = buildState(idleScheduler.snapshot());
  assert.equal(idle.loopPlus?.ok, true);
  if (!idle.loopPlus?.ok) {
    return;
  }
  assert.equal(idle.loopPlus.phase, "idle");
  assert.equal(idle.loopPlus.activity, "idle");
  assert.equal(idle.loopPlus.visibleReviewCount, 0);
  assert.notEqual(idle.loopPlus.phase, "completed");

  const completed = idleScheduler.complete();
  assert.equal(completed.ok, true);
  const closed = buildState(idleScheduler.snapshot());
  assert.equal(closed.loopPlus?.ok, true);
  if (!closed.loopPlus?.ok) {
    return;
  }
  assert.equal(closed.loopPlus.phase, "completed");
  assert.equal(closed.loopPlus.activity, "completed");
  assert.equal(closed.rounds[0]?.completedAt, 20);
});

function buildState(loopPlus: unknown): ReturnType<typeof buildLoopDebateChatPanelStateWithDeps> {
  return buildLoopDebateChatPanelStateWithDeps(task(loopPlus), deps());
}

test("shows needs-review and error as a display pause without hiding the kernel phase or queue", () => {
  const heldScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(heldScheduler, "A", "a-1");
  dispatchAndFinish(heldScheduler, "B", "b-1");
  assert.equal(heldScheduler.dispatch([spec("D", "d-1")]).started.length, 1);
  assert.equal(heldScheduler.dispatch([spec("E", "e-1")]).started.length, 0);
  const heldSnapshot = heldScheduler.snapshot();
  const heldBefore = JSON.stringify(heldSnapshot);
  const writes = { count: 0 };
  const held = buildLoopDebateChatPanelStateWithDeps(task(heldSnapshot, {
    status: "needs-review",
    activeSubtaskIds: [],
  }), deps(writes));
  assert.equal(JSON.stringify(heldSnapshot), heldBefore);
  assert.equal(writes.count, 0);
  const heldProjection = held.loopPlus;
  assert.ok(heldProjection?.ok);
  if (!heldProjection?.ok) {
    return;
  }
  assert.equal(heldProjection.phase, "reviewing");
  assert.equal(heldProjection.activity, "paused");
  assert.equal(heldProjection.currentReview?.subtaskId, "A");
  assert.equal(heldProjection.currentReview?.attemptId, "a-1");
  assert.deepEqual(heldProjection.reviewQueue.map((item) => item.subtaskId), ["B"]);
  assert.deepEqual(heldProjection.running.map((item) => item.subtaskId), ["D"]);
  assert.deepEqual(heldProjection.pending.map((item) => item.subtaskId), ["E"]);
  assert.equal(heldProjection.currentReviewCount, 1);
  assert.equal(heldProjection.reviewQueueCount, 1);
  assert.equal(heldProjection.visibleReviewCount, 2);
  assert.equal(heldProjection.runningCount, 1);
  assert.equal(heldProjection.pendingCount, 1);
  assert.equal(held.rounds[0]?.status, "reviewing");
  assert.equal(held.rounds[0]?.activeSpeaker, undefined);
  assert.equal(held.rounds[0]?.participants.find((item) => item.id === "main")?.status, "paused");
  assert.equal(held.rounds[0]?.participants.find((item) => item.id === "A")?.status, "held_review");
  assert.equal(held.rounds[0]?.participants.find((item) => item.id === "B")?.status, "queued_review");
  assert.equal(held.rounds[0]?.participants.find((item) => item.id === "D")?.status, "running");
  assert.equal(held.rounds[0]?.participants.find((item) => item.id === "E")?.status, "pending");
  assert.equal(held.task.canContinue, true);
  assert.equal(held.task.canStop, false);

  const continued = buildLoopDebateChatPanelStateWithDeps(task(heldSnapshot, {
    status: "running",
    activeSubtaskIds: [],
  }), deps());
  assert.equal(JSON.stringify(heldSnapshot), heldBefore);
  const continuedProjection = continued.loopPlus;
  assert.ok(continuedProjection?.ok);
  if (!continuedProjection?.ok) {
    return;
  }
  assert.equal(continuedProjection.phase, "reviewing");
  assert.equal(continuedProjection.activity, "reviewing");
  assert.equal(continuedProjection.visibleReviewCount, 2);
  assert.equal(continued.rounds[0]?.participants.find((item) => item.id === "main")?.status, "reviewing");
  assert.equal(continued.rounds[0]?.participants.find((item) => item.id === "A")?.status, "reviewing");
  assert.equal(continued.rounds[0]?.activeSpeaker, undefined);

  const queueScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  dispatchAndFinish(queueScheduler, "A", "a-1");
  dispatchAndFinish(queueScheduler, "B", "b-1");
  const current = queueScheduler.snapshot().currentReview;
  assert.ok(current);
  assert.equal(queueScheduler.submitReview(current.eventId).ok, true);
  const queueSnapshot = queueScheduler.snapshot();
  const queueBefore = JSON.stringify(queueSnapshot);
  const queued = buildLoopDebateChatPanelStateWithDeps(task(queueSnapshot, {
    status: "error",
    activeSubtaskIds: [],
  }), deps());
  assert.equal(JSON.stringify(queueSnapshot), queueBefore);
  const queuedProjection = queued.loopPlus;
  assert.ok(queuedProjection?.ok);
  if (!queuedProjection?.ok) {
    return;
  }
  assert.equal(queuedProjection.phase, "review_ready");
  assert.equal(queuedProjection.activity, "paused");
  assert.equal(queuedProjection.currentReview, null);
  assert.deepEqual(queuedProjection.reviewQueue.map((item) => `${item.subtaskId}:${item.attemptId}`), ["B:b-1"]);
  assert.equal(queuedProjection.visibleReviewCount, 1);
  assert.equal(queuedProjection.runningCount, 0);
  assert.equal(queued.rounds[0]?.status, "review_ready");
  assert.equal(queued.rounds[0]?.activeSpeaker, undefined);
  assert.equal(queued.rounds[0]?.participants.find((item) => item.id === "main")?.status, "paused");
  assert.equal(queued.rounds[0]?.participants.find((item) => item.id === "B")?.status, "queued_review");
  const queueContinued = buildLoopDebateChatPanelStateWithDeps(task(queueSnapshot, {
    status: "running",
    activeSubtaskIds: [],
  }), deps());
  assert.equal(JSON.stringify(queueSnapshot), queueBefore);
  assert.equal(queueContinued.loopPlus?.ok, true);
  if (!queueContinued.loopPlus?.ok) {
    return;
  }
  assert.equal(queueContinued.loopPlus.phase, "review_ready");
  assert.equal(queueContinued.loopPlus.activity, "review_pending");
  assert.equal(queueContinued.loopPlus.visibleReviewCount, 1);

  const waitingScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(waitingScheduler.dispatch([spec("D", "d-1")]).started.length, 1);
  const waitingPaused = buildLoopDebateChatPanelStateWithDeps(task(waitingScheduler.snapshot(), {
    status: "needs-review",
    activeSubtaskIds: [],
  }), deps());
  assert.equal(waitingPaused.loopPlus?.ok, true);
  if (!waitingPaused.loopPlus?.ok) {
    return;
  }
  assert.equal(waitingPaused.loopPlus.phase, "waiting");
  assert.equal(waitingPaused.loopPlus.activity, "paused");
  assert.equal(waitingPaused.loopPlus.runningCount, 1);
  assert.equal(waitingPaused.loopPlus.visibleReviewCount, 0);
  assert.equal(waitingPaused.rounds[0]?.activeSpeaker, undefined);

  const { stopped } = stoppedAndResumed();
  const stoppedState = buildLoopDebateChatPanelStateWithDeps(task(stopped, { status: "needs-review" }), deps());
  assert.equal(stoppedState.loopPlus?.ok, true);
  if (!stoppedState.loopPlus?.ok) {
    return;
  }
  assert.equal(stoppedState.loopPlus.phase, "stopped");
  assert.equal(stoppedState.loopPlus.activity, "stopped");
  assert.equal(stoppedState.loopPlus.currentReview?.subtaskId, "A");
  assert.deepEqual(stoppedState.loopPlus.reviewQueue.map((item) => item.subtaskId), ["B"]);

  const completedScheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(completedScheduler.complete().ok, true);
  const completed = buildLoopDebateChatPanelStateWithDeps(task(completedScheduler.snapshot(), {
    status: "error",
  }), deps());
  assert.equal(completed.loopPlus?.ok, true);
  if (!completed.loopPlus?.ok) {
    return;
  }
  assert.equal(completed.loopPlus.phase, "completed");
  assert.equal(completed.loopPlus.activity, "completed");

  const missing = projectLoopPlusPanel(task(undefined, { status: "error" }));
  const broken = projectLoopPlusPanel(task({}, { status: "needs-review" }));
  assert.equal(missing?.ok, false);
  assert.equal(broken?.ok, false);
  if (!missing || missing.ok || !broken || broken.ok) {
    return;
  }
  assert.equal(missing.activity, "invalid");
  assert.equal(missing.phase, "invalid");
  assert.equal(missing.error, "missing");
  assert.equal("reviewQueue" in missing, false);
  assert.match(broken.error, /Invalid Loop\+ scheduler snapshot/u);

  const classic = buildLoopDebateChatPanelStateWithDeps(task(heldSnapshot, {
    schedulingMode: undefined,
    status: "needs-review",
    subTasks: [],
    activeSubtaskIds: [],
  }), deps());
  assert.equal(classic.loopPlus, undefined);
  assert.equal(classic.mode, "main_sub");
  assert.equal(classic.rounds[0]?.activeSpeaker, undefined);
  assert.equal(classic.rounds[0]?.status, "needs-review");

  const debate = buildLoopDebateChatPanelStateWithDeps(task(undefined, {
    schedulingMode: undefined,
    status: "running",
    executionMode: "debate_multi_agent",
    subTasks: [],
    debateRounds: [{
      loopRound: 2,
      debateRound: 1,
      status: "running",
      startedAt: 30,
      briefFile: "/tmp/debate-brief.md",
      activeSpeaker: { kind: "moderator", id: "moderator", title: "Judge", dialogueTurn: 2, updatedAt: 31 },
      participants: [],
      moderatorDecisions: [],
    }],
  }), {
    ...deps(),
    fileExists: () => false,
  });
  assert.equal(debate.loopPlus, undefined);
  assert.equal(debate.mode, "debate");
  assert.equal(debate.rounds[0]?.activeSpeaker?.kind, "moderator");
  assert.equal(debate.rounds.some((round) => round.kind === "execution"), false);
});

test("projects a failed reviewed execution as acceptance_failed and keeps a legacy snapshot binary", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(scheduler.dispatch([spec("B", "b-1")]).started.length, 1);
  assert.equal(scheduler.finish({
    subtaskId: "B",
    attemptId: "b-1",
    outcome: "failed",
  }).applied, true);
  const current = scheduler.snapshot().currentReview;
  assert.ok(current);
  assert.equal(scheduler.submitReview(current.eventId).ok, true);
  const failed = buildLoopDebateChatPanelStateWithDeps(task(scheduler.snapshot()), deps());
  assert.equal(failed.loopPlus?.ok, true);
  if (!failed.loopPlus?.ok) {
    return;
  }
  assert.equal(failed.loopPlus.seenAttempts.find((item) => item.attemptId === "b-1")?.acceptance, "failed");
  assert.equal(failed.rounds[0]?.participants.find((item) => item.id === "B")?.status, "acceptance_failed");

  const legacy = scheduler.snapshot();
  delete legacy.seenAttempts.find((item) => item.attemptId === "b-1")?.outcome;
  const legacyState = buildLoopDebateChatPanelStateWithDeps(task(legacy, {
    subTasks: [{ id: "B", title: "Bravo", status: "blocked", updatedAt: 12 }],
  }), deps());
  assert.equal(legacyState.loopPlus?.ok, true);
  if (!legacyState.loopPlus?.ok) {
    return;
  }
  assert.equal(legacyState.loopPlus.seenAttempts.find((item) => item.attemptId === "b-1")?.acceptance, "failed");
  assert.equal(legacyState.rounds[0]?.participants.find((item) => item.id === "B")?.status, "acceptance_failed");
});
