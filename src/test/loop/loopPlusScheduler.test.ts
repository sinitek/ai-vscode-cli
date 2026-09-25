import test = require("node:test");
import assert = require("node:assert/strict");

import { buildLoopSubtaskExecutionPlan } from "../../loopParallel";
import {
  buildLoopPlusFinishEventId,
  createLoopPlusScheduler,
  type LoopPlusExecutionRecord,
  type LoopPlusScheduler,
  type LoopPlusSchedulerHostContract,
  type LoopPlusSubtaskSpec,
} from "../../loopPlusScheduler";

function spec(
  name: string,
  writeFiles: string[] = [`src/${name}.ts`],
  conflictGroup?: string,
): LoopPlusSubtaskSpec {
  return {
    subtaskId: name,
    attemptId: `${name}-1`,
    title: name,
    writeFiles,
    ...(conflictGroup ? { conflictGroup } : {}),
  };
}

function attemptIds(records: readonly { attemptId: string }[]): string[] {
  return records.map((record) => record.attemptId);
}

function reviewEvent(name: string, attemptId = `${name}-1`): string {
  return buildLoopPlusFinishEventId(name, attemptId);
}

test("reviews the first finished sibling immediately while the other keeps running", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const dispatched = scheduler.dispatch([spec("alpha"), spec("beta")]);

  assert.deepEqual(attemptIds(dispatched.started), ["alpha-1", "beta-1"]);
  assert.equal(scheduler.snapshot().phase, "waiting");

  const finished = scheduler.finish({
    subtaskId: "alpha",
    attemptId: "alpha-1",
    outcome: "completed",
  });
  assert.equal(finished.applied, true);
  assert.equal(finished.wake, true);
  assert.equal(finished.eventId, reviewEvent("alpha"));
  assert.equal(finished.view.phase, "reviewing");
  assert.equal(finished.view.currentReview?.attemptId, "alpha-1");
  assert.equal(finished.view.reviewQueue.length, 0);
  assert.deepEqual(attemptIds(finished.view.running), ["beta-1"]);
  assert.equal(finished.view.visibleReviewCount, 1);

  const claimed = scheduler.claimNextReview();
  assert.equal(claimed.ok, true);
  assert.equal(claimed.reason, "already_held");
  assert.equal(claimed.item?.attemptId, "alpha-1");
  assert.equal(claimed.item?.eventId, reviewEvent("alpha"));
  assert.equal(claimed.view.phase, "reviewing");
  assert.deepEqual(attemptIds(claimed.view.running), ["beta-1"]);
  assert.equal(claimed.view.reviewQueue.length, 0);

  const submitted = scheduler.submitReview(reviewEvent("alpha"));
  assert.equal(submitted.ok, true);
  assert.equal(submitted.followUp, "wait");
  assert.equal(submitted.view.currentReview, null);
  assert.deepEqual(attemptIds(submitted.view.running), ["beta-1"]);
  assert.equal(submitted.view.phase, "waiting");
  assert.equal(scheduler.complete().ok, false);
});

test("keeps completions that arrive during review in a stable FIFO queue", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 3 });
  scheduler.dispatch([spec("alpha"), spec("beta"), spec("gamma")]);
  const first = scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  const claimed = scheduler.claimNextReview();
  const wakeSeq = claimed.view.wakeSeq;
  const seqBeforeArrivals = claimed.view.seq;

  const beta = scheduler.finish({ subtaskId: "beta", attemptId: "beta-1", outcome: "completed" });
  const gamma = scheduler.finish({ subtaskId: "gamma", attemptId: "gamma-1", outcome: "failed" });
  assert.equal(first.wake, true);
  assert.equal(beta.wake, false);
  assert.equal(gamma.wake, false);
  assert.equal(gamma.view.wakeSeq, wakeSeq);
  assert.deepEqual(attemptIds(gamma.view.reviewQueue), ["beta-1", "gamma-1"]);
  assert.equal(gamma.view.currentReview?.attemptId, "alpha-1");
  assert.equal(gamma.view.visibleReviewCount, 3);

  const duplicate = scheduler.finish({ subtaskId: "beta", attemptId: "beta-1", outcome: "completed" });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.deepEqual(attemptIds(scheduler.snapshot().reviewQueue), ["beta-1", "gamma-1"]);
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "alpha-1");

  const secondClaim = scheduler.claimNextReview();
  assert.equal(secondClaim.reason, "already_held");
  assert.equal(secondClaim.item?.attemptId, "alpha-1");
  assert.deepEqual(attemptIds(secondClaim.view.reviewQueue), ["beta-1", "gamma-1"]);

  const mismatch = scheduler.submitReview("loop-plus-finish:other:attempt");
  assert.equal(mismatch.reason, "mismatch");
  assert.equal(scheduler.snapshot().seq, gamma.view.seq);
  assert.deepEqual(attemptIds(scheduler.snapshot().reviewQueue), ["beta-1", "gamma-1"]);

  const submitted = scheduler.submitReview(reviewEvent("alpha"));
  assert.equal(submitted.followUp, "claim_next");
  assert.deepEqual(attemptIds(submitted.view.reviewQueue), ["beta-1", "gamma-1"]);
  const seqAfterSubmit = scheduler.snapshot().seq;
  const repeated = scheduler.submitReview(reviewEvent("alpha"));
  assert.equal(repeated.ok, true);
  assert.equal(repeated.reason, "submitted");
  assert.equal(scheduler.snapshot().seq, seqAfterSubmit);
  assert.equal(scheduler.snapshot().currentReview, null);
  assert.deepEqual(attemptIds(scheduler.snapshot().reviewQueue), ["beta-1", "gamma-1"]);
  assert.equal(scheduler.claimNextReview().item?.attemptId, "beta-1");
  assert.equal(scheduler.claimNextReview().reason, "already_held");
  assert.deepEqual(attemptIds(scheduler.snapshot().reviewQueue), ["gamma-1"]);
  assert.ok(scheduler.snapshot().seq > seqBeforeArrivals);
});

test("ignores duplicate notifications and stale attempts without touching the new run", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([spec("alpha")]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  const queued = scheduler.snapshot();
  const duplicate = scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "failed" });
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(duplicate.wake, false);
  assert.deepEqual(scheduler.snapshot(), queued);

  const blocked = scheduler.dispatch([{ ...spec("alpha"), attemptId: "alpha-2" }]);
  assert.equal(blocked.rejected[0]?.reason, "active_subtask");
  assert.equal(scheduler.claimNextReview().item?.attemptId, "alpha-1");
  assert.equal(scheduler.submitReview(reviewEvent("alpha")).ok, true);

  const restarted = scheduler.dispatch([{ ...spec("alpha"), attemptId: "alpha-2" }]);
  assert.deepEqual(attemptIds(restarted.started), ["alpha-2"]);
  const waiting = scheduler.dispatch([spec("beta")]);
  assert.equal(waiting.decisions[0]?.admission, "pending");
  assert.equal(waiting.decisions[0]?.concurrencyBlocked, true);
  const beforeStale = scheduler.snapshot();

  const stale = scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "stopped" });
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, "stale_attempt");
  assert.deepEqual(stale.started, []);
  assert.deepEqual(scheduler.snapshot(), beforeStale);

  const unknown = scheduler.finish({ subtaskId: "missing", attemptId: "missing-1", outcome: "failed" });
  assert.equal(unknown.reason, "unknown_attempt");
  assert.deepEqual(scheduler.snapshot(), beforeStale);
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["alpha-2"]);
  assert.deepEqual(attemptIds(scheduler.snapshot().pending), ["beta-1"]);
});

test("can dispatch after a review while an older task is still running", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 3 });
  scheduler.dispatch([spec("alpha"), spec("beta")]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  assert.equal(scheduler.claimNextReview().item?.attemptId, "alpha-1");

  const added = scheduler.dispatch([spec("delta")]);
  assert.deepEqual(attemptIds(added.started), ["delta-1"]);
  assert.equal(added.view.currentReview?.attemptId, "alpha-1");
  assert.deepEqual(attemptIds(added.view.running), ["beta-1", "delta-1"]);

  const submitted = scheduler.submitReview(reviewEvent("alpha"));
  assert.equal(submitted.followUp, "wait");
  assert.equal(scheduler.complete().ok, false);
  assert.deepEqual(scheduler.getCompletionBlockers(), ["running"]);
  assert.equal(scheduler.wait().action, "wait");
  assert.equal(scheduler.wait().view.wake, false);
});

test("waiting for a still-running task does not spin or invent wake edges", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([spec("alpha"), spec("beta")]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  const ready = scheduler.snapshot();
  for (let index = 0; index < 20; index += 1) {
    const assessment = scheduler.wait();
    assert.equal(assessment.action, "review");
    assert.equal(assessment.view.wake, true);
    assert.equal(assessment.view.visibleReviewCount, 1);
  }
  assert.deepEqual(scheduler.snapshot(), ready);

  scheduler.claimNextReview();
  scheduler.submitReview(reviewEvent("alpha"));
  const waiting = scheduler.snapshot();
  for (let index = 0; index < 20; index += 1) {
    const assessment = scheduler.wait();
    assert.equal(assessment.action, "wait");
    assert.equal(assessment.view.wake, false);
    assert.equal(assessment.view.canComplete, false);
    assert.deepEqual(assessment.view.blockers, ["running"]);
  }
  assert.deepEqual(scheduler.snapshot(), waiting);
  assert.equal(waiting.phase, "waiting");
  assert.equal(waiting.wakePending, false);
});

test("blocks final completion until running, pending, queued, and current reviews are gone", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([
    spec("alpha", ["src/shared.ts"]),
    spec("beta", ["src/shared.ts"]),
  ]);
  assert.deepEqual(scheduler.getCompletionBlockers(), ["running", "pending"]);
  assert.equal(scheduler.complete().ok, false);
  assert.equal(scheduler.snapshot().completed, false);

  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["beta-1"]);
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "alpha-1");
  assert.deepEqual(scheduler.getCompletionBlockers(), ["running", "current_review"]);

  scheduler.finish({ subtaskId: "beta", attemptId: "beta-1", outcome: "completed" });
  assert.deepEqual(scheduler.getCompletionBlockers(), ["review_queue", "current_review"]);
  assert.equal(scheduler.submitReview(reviewEvent("alpha")).followUp, "claim_next");
  assert.deepEqual(scheduler.getCompletionBlockers(), ["review_queue"]);
  assert.equal(scheduler.claimNextReview().reason, "claimed");
  assert.deepEqual(scheduler.getCompletionBlockers(), ["current_review"]);
  const submitted = scheduler.submitReview(reviewEvent("beta"));
  assert.equal(submitted.followUp, "may_complete");
  assert.equal(submitted.view.phase, "idle");
  assert.equal(scheduler.wait().view.canComplete, true);

  const completed = scheduler.complete();
  assert.equal(completed.ok, true);
  assert.equal(completed.alreadyCompleted, false);
  assert.equal(completed.view.phase, "completed");
  assert.equal(scheduler.wait().action, "completed");
  assert.equal(scheduler.wait().view.wake, false);
  assert.equal(scheduler.complete().alreadyCompleted, true);
  assert.equal(scheduler.dispatch([spec("gamma")]).rejected[0]?.reason, "completed");
  assert.equal(scheduler.snapshot().phase, "completed");
});

test("turns a local failure or stop into a review without stopping siblings", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 3 });
  scheduler.dispatch([spec("alpha"), spec("beta"), spec("gamma")]);

  const failed = scheduler.finish({
    subtaskId: "alpha",
    attemptId: "alpha-1",
    outcome: "failed",
    detail: "alpha failed",
  });
  assert.equal(failed.wake, true);
  assert.equal(failed.item?.outcome, "failed");
  assert.equal(failed.item?.detail, "alpha failed");
  assert.deepEqual(attemptIds(failed.view.running), ["beta-1", "gamma-1"]);
  assert.equal(failed.view.phase, "reviewing");

  scheduler.claimNextReview();
  const stopped = scheduler.finish({
    subtaskId: "beta",
    attemptId: "beta-1",
    outcome: "stopped",
  });
  assert.equal(stopped.wake, false);
  assert.equal(stopped.item?.outcome, "stopped");
  assert.deepEqual(attemptIds(stopped.view.running), ["gamma-1"]);
  assert.deepEqual(attemptIds(stopped.view.reviewQueue), ["beta-1"]);
  assert.equal(scheduler.snapshot().parentStopped, false);

  const added = scheduler.dispatch([spec("delta")]);
  assert.deepEqual(attemptIds(added.started), ["delta-1"]);
  assert.equal(added.view.currentReview?.attemptId, "alpha-1");
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["gamma-1", "delta-1"]);
});

test("parent stop forbids new starts and wakes without dropping reviewable work", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([spec("alpha", ["src/alpha.ts"]), spec("beta", ["src/beta.ts"])]);
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["alpha-1"]);
  assert.equal(scheduler.snapshot().pending[0]?.attemptId, "beta-1");

  const stopped = scheduler.stopParent();
  assert.equal(stopped.reason, "stopped");
  assert.equal(stopped.view.phase, "stopped");
  assert.equal(stopped.view.wake, false);
  const seqAfterStop = stopped.view.seq;
  assert.equal(scheduler.stopParent().reason, "already_stopped");
  assert.equal(scheduler.snapshot().seq, seqAfterStop);

  const rejected = scheduler.dispatch([spec("gamma")]);
  assert.equal(rejected.rejected[0]?.reason, "parent_stopped");
  assert.deepEqual(rejected.started, []);
  assert.equal(scheduler.snapshot().seq, seqAfterStop);

  const finished = scheduler.finish({
    subtaskId: "alpha",
    attemptId: "alpha-1",
    outcome: "stopped",
  });
  assert.equal(finished.applied, true);
  assert.equal(finished.wake, false);
  assert.deepEqual(finished.started, []);
  assert.equal(finished.view.wakeSeq, 0);
  assert.deepEqual(attemptIds(finished.view.pending), ["beta-1"]);
  assert.deepEqual(attemptIds(finished.view.running), []);
  assert.deepEqual(attemptIds(finished.view.reviewQueue), ["alpha-1"]);
  assert.equal(scheduler.claimNextReview().reason, "parent_stopped");
  assert.deepEqual(scheduler.getCompletionBlockers(), ["parent_stopped", "pending", "review_queue"]);
  assert.equal(scheduler.complete().ok, false);

  const restored = createLoopPlusScheduler({
    snapshot: JSON.parse(JSON.stringify(scheduler.snapshot())),
  });
  assert.equal(restored.snapshot().phase, "stopped");
  assert.deepEqual(attemptIds(restored.snapshot().pending), ["beta-1"]);
  assert.deepEqual(attemptIds(restored.snapshot().reviewQueue), ["alpha-1"]);
  assert.equal(restored.dispatch([spec("delta")]).rejected[0]?.reason, "parent_stopped");
  assert.equal(restored.wait().action, "stopped");
  assert.equal(restored.wait().view.wake, false);
});

test("restores a snapshot without losing reviews, pending work, or dedupe history", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 3 });
  scheduler.dispatch([
    spec("holder", ["src/shared.ts"]),
    spec("alpha"),
    spec("gamma"),
  ]);
  const pendingBeta = scheduler.dispatch([spec("beta", ["src/shared.ts"])]);
  assert.equal(pendingBeta.decisions[0]?.admission, "pending");
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "gamma", attemptId: "gamma-1", outcome: "failed" });
  scheduler.claimNextReview();
  const saved = scheduler.snapshot();
  saved.reviewQueue.push({
    eventId: reviewEvent("foreign"),
    subtaskId: "foreign",
    attemptId: "foreign-1",
    outcome: "completed",
    detail: null,
  });

  assert.equal(scheduler.snapshot().reviewQueue.length, 1);
  const restored = createLoopPlusScheduler({
    snapshot: JSON.parse(JSON.stringify(scheduler.snapshot())),
  });
  assert.deepEqual(restored.snapshot(), scheduler.snapshot());
  assert.equal(restored.snapshot().currentReview?.attemptId, "alpha-1");
  assert.deepEqual(attemptIds(restored.snapshot().reviewQueue), ["gamma-1"]);
  assert.deepEqual(attemptIds(restored.snapshot().pending), ["beta-1"]);
  assert.deepEqual(attemptIds(restored.snapshot().running), ["holder-1"]);
  assert.equal(restored.claimNextReview().reason, "already_held");

  const duplicate = restored.finish({
    subtaskId: "gamma",
    attemptId: "gamma-1",
    outcome: "completed",
  });
  assert.equal(duplicate.reason, "duplicate");
  assert.deepEqual(attemptIds(restored.snapshot().reviewQueue), ["gamma-1"]);

  const invalid = scheduler.snapshot();
  invalid.completed = true;
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: invalid }),
    /Invalid Loop\+ scheduler snapshot: completed/,
  );
  const wrongVersion = scheduler.snapshot();
  (wrongVersion as { version: number }).version = 2;
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: wrongVersion }),
    /Invalid Loop\+ scheduler snapshot: version/,
  );
  assert.throws(() => createLoopPlusScheduler({ maxConcurrency: 0 }), /Invalid Loop\+ maxConcurrency/);
  assert.throws(() => createLoopPlusScheduler(), /Invalid Loop\+ maxConcurrency/);
});

test("uses loopParallel conflict rules for running tasks and reserves pending write scopes", () => {
  const fresh = createLoopPlusScheduler({ maxConcurrency: 2 });
  const sameBatch = fresh.dispatch([
    spec("left", ["src/shared.ts"]),
    spec("right", ["src/shared.ts"]),
  ]);
  assert.equal(sameBatch.decisions[0]?.admission, "started");
  assert.equal(sameBatch.decisions[1]?.admission, "pending");
  assert.equal(sameBatch.decisions[1]?.block?.reason, "writeFiles");
  assert.equal(sameBatch.decisions[1]?.block?.otherAttemptId, "left-1");

  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  scheduler.dispatch([
    spec("parent", ["src/graph"]),
    spec("grouped", ["src/grouped.ts"], "model-store"),
    spec("editor", ["src/extension.ts"]),
  ]);
  const admitted = scheduler.dispatch([
    spec("child", ["./src/graph/graphScheduler.ts"]),
    spec("same-group", ["src/other-group.ts"], "MODEL-store"),
    spec("windows", ["SRC\\Extension.ts"]),
    spec("clear", ["docs/readme.md"]),
  ]);
  const decisionByAttempt = new Map(admitted.decisions.map((decision) => [decision.attemptId, decision]));
  const child = decisionByAttempt.get("child-1");
  const sameGroup = decisionByAttempt.get("same-group-1");
  const windows = decisionByAttempt.get("windows-1");
  const clear = decisionByAttempt.get("clear-1");
  assert.equal(child?.admission, "pending");
  assert.equal(sameGroup?.admission, "pending");
  assert.equal(windows?.admission, "pending");
  assert.equal(clear?.admission, "started");

  const directoryPlan = buildLoopSubtaskExecutionPlan([
    { id: "parent-1", writeFiles: ["src/graph"] },
    { id: "child-1", writeFiles: ["./src/graph/graphScheduler.ts"] },
  ]);
  const groupPlan = buildLoopSubtaskExecutionPlan([
    { id: "grouped-1", conflictGroup: "model-store" },
    { id: "same-group-1", conflictGroup: "MODEL-store" },
  ]);
  const filePlan = buildLoopSubtaskExecutionPlan([
    { id: "editor-1", writeFiles: ["src/extension.ts"] },
    { id: "windows-1", writeFiles: ["SRC\\Extension.ts"] },
  ]);
  assert.equal(child?.block?.reason, directoryPlan.conflicts[0]?.reason);
  assert.equal(child?.block?.value, directoryPlan.conflicts[0]?.value);
  assert.equal(sameGroup?.block?.reason, "conflictGroup");
  assert.equal(sameGroup?.block?.value, groupPlan.conflicts[0]?.value);
  assert.equal(windows?.block?.reason, filePlan.conflicts[0]?.reason);
  assert.equal(windows?.block?.value, filePlan.conflicts[0]?.value);
  assert.deepEqual(attemptIds(admitted.started), ["clear-1"]);

  const reserved = createLoopPlusScheduler({ maxConcurrency: 1 });
  reserved.dispatch([spec("holder", ["src/holder.ts"])]);
  const waiting = reserved.dispatch([spec("queued", ["src/queued.ts"])]);
  assert.equal(waiting.decisions[0]?.admission, "pending");
  assert.equal(waiting.decisions[0]?.concurrencyBlocked, true);
  const overlapping = reserved.dispatch([spec("overlap", ["./SRC/Queued.ts"])]);
  assert.equal(overlapping.decisions[0]?.admission, "pending");
  assert.equal(overlapping.decisions[0]?.concurrencyBlocked, false);
  assert.equal(overlapping.decisions[0]?.block?.reason, "writeFiles");
  assert.equal(overlapping.decisions[0]?.block?.otherAttemptId, "queued-1");
  assert.deepEqual(overlapping.started, []);
});

test("counts already-running work against concurrency and promotes the oldest eligible task", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const initial = scheduler.dispatch([spec("alpha"), spec("beta")]);
  assert.deepEqual(attemptIds(initial.started), ["alpha-1", "beta-1"]);

  const overflow = scheduler.dispatch([spec("gamma"), spec("delta")]);
  assert.deepEqual(overflow.started, []);
  assert.equal(overflow.decisions[0]?.concurrencyBlocked, true);
  assert.equal(overflow.decisions[1]?.concurrencyBlocked, true);
  assert.equal(scheduler.snapshot().running.length, 2);

  const finished = scheduler.finish({
    subtaskId: "alpha",
    attemptId: "alpha-1",
    outcome: "completed",
  });
  assert.deepEqual(attemptIds(finished.started), ["gamma-1"]);
  assert.deepEqual(attemptIds(finished.view.running), ["beta-1", "gamma-1"]);
  assert.deepEqual(attemptIds(finished.view.pending), ["delta-1"]);
  assert.equal(finished.view.currentReview?.attemptId, "alpha-1");
  assert.equal(finished.view.reviewQueue.length, 0);
});

test("host launches only attempts the scheduler started and wakes on one finish edge", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  const launched: string[] = [];
  const wakes: number[] = [];
  const persisted: string[] = [];
  const host: LoopPlusSchedulerHostContract = {
    maxConcurrency: 1,
    launchAttempts: (attempts) => {
      launched.push(...attemptIds(attempts));
    },
    wakeMainReviewer: (signal) => {
      wakes.push(signal.wakeSeq);
    },
    persistSnapshot: (snapshot) => {
      persisted.push(String(snapshot.seq));
    },
  };

  const first = scheduler.dispatch([spec("alpha", ["src/alpha.ts"]), spec("beta", ["src/beta.ts"])]);
  host.launchAttempts(first.started);
  host.persistSnapshot(scheduler.snapshot());
  const started = first.started[0] as LoopPlusExecutionRecord;
  started.writeFiles.push("src/evil.ts");
  assert.deepEqual(scheduler.snapshot().running[0]?.writeFiles, ["src/alpha.ts"]);
  assert.deepEqual(launched, ["alpha-1"]);

  const finished = scheduler.finish({
    subtaskId: "alpha",
    attemptId: "alpha-1",
    outcome: "completed",
  });
  if (finished.wake) {
    host.wakeMainReviewer({ wakeSeq: finished.view.wakeSeq });
  }
  host.launchAttempts(finished.started);
  const duplicate = scheduler.finish({
    subtaskId: "alpha",
    attemptId: "alpha-1",
    outcome: "completed",
  });
  if (duplicate.wake) {
    host.wakeMainReviewer({ wakeSeq: duplicate.view.wakeSeq });
  }
  host.launchAttempts(duplicate.started);

  assert.deepEqual(launched, ["alpha-1", "beta-1"]);
  assert.deepEqual(wakes, [1]);
  assert.deepEqual(duplicate.started, []);
  assert.deepEqual(persisted, ["1"]);
  assert.equal(scheduler.snapshot().running[0]?.attemptId, "beta-1");
});

test("requeues the held review ahead of later items when the consumer is recovered", () => {
  const scheduler: LoopPlusScheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  assert.equal(scheduler.requeueCurrentReview().requeued, false);
  assert.equal(scheduler.snapshot().seq, 0);

  scheduler.dispatch([spec("alpha"), spec("beta")]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "beta", attemptId: "beta-1", outcome: "completed" });
  assert.equal(scheduler.claimNextReview().item?.attemptId, "alpha-1");
  assert.equal(scheduler.snapshot().wakePending, false);

  const recovered = scheduler.requeueCurrentReview();
  assert.equal(recovered.requeued, true);
  assert.equal(recovered.item?.attemptId, "alpha-1");
  assert.deepEqual(attemptIds(recovered.view.reviewQueue), ["alpha-1", "beta-1"]);
  assert.equal(recovered.view.currentReview, null);
  assert.equal(recovered.view.wake, true);
  assert.equal(recovered.view.visibleReviewCount, 2);

  const claimed = scheduler.claimNextReview();
  assert.equal(claimed.item?.attemptId, "alpha-1");
  assert.deepEqual(attemptIds(claimed.view.reviewQueue), ["beta-1"]);
  assert.equal(claimed.view.wake, false);
});

test("keeps colon-bearing finish identities distinct and ignores a repeated old confirmation", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const left = { subtaskId: "a:b", attemptId: "c", title: "left", writeFiles: ["src/left.ts"] };
  const right = { subtaskId: "a", attemptId: "b:c", title: "right", writeFiles: ["src/right.ts"] };
  scheduler.dispatch([left, right]);
  const finishedLeft = scheduler.finish({ subtaskId: "a:b", attemptId: "c", outcome: "completed" });
  const finishedRight = scheduler.finish({ subtaskId: "a", attemptId: "b:c", outcome: "completed" });
  const legacyEventId = "loop-plus-finish:a:b:c";
  assert.equal(finishedLeft.eventId, buildLoopPlusFinishEventId("a:b", "c"));
  assert.equal(finishedRight.eventId, buildLoopPlusFinishEventId("a", "b:c"));
  assert.notEqual(finishedLeft.eventId, finishedRight.eventId);
  assert.notEqual(finishedLeft.eventId, legacyEventId);
  assert.notEqual(finishedRight.eventId, legacyEventId);
  assert.equal(scheduler.snapshot().currentReview?.eventId, finishedLeft.eventId);
  assert.deepEqual(attemptIds(scheduler.snapshot().reviewQueue), ["b:c"]);

  assert.equal(scheduler.submitReview(finishedLeft.eventId ?? "").followUp, "claim_next");
  const claimed = scheduler.claimNextReview();
  assert.equal(claimed.reason, "claimed");
  assert.equal(claimed.item?.eventId, finishedRight.eventId);
  const seq = scheduler.snapshot().seq;
  const repeated = scheduler.submitReview(finishedLeft.eventId ?? "");
  assert.equal(repeated.ok, true);
  assert.equal(repeated.reason, "submitted");
  assert.equal(scheduler.snapshot().seq, seq);
  assert.equal(scheduler.snapshot().currentReview?.subtaskId, "a");
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "b:c");
  assert.equal(scheduler.snapshot().reviewQueue.length, 0);

  const legacy = scheduler.submitReview(legacyEventId);
  assert.equal(legacy.reason, "mismatch");
  assert.equal(scheduler.snapshot().seq, seq);
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "b:c");
});

test("round-trips colon and unicode event identities through snapshot JSON", () => {
  const subtaskId = "任务:甲";
  const attemptId = "第1次:🙂";
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([{
    subtaskId,
    attemptId,
    title: "标题:甲",
    writeFiles: ["src/任务.ts"],
  }]);
  const finished = scheduler.finish({
    subtaskId,
    attemptId,
    outcome: "completed",
    detail: "明细:完成",
  });
  const eventId = buildLoopPlusFinishEventId(subtaskId, attemptId);
  assert.equal(finished.eventId, eventId);
  assert.equal(eventId.startsWith("loop-plus-finish:"), false);

  const restored = createLoopPlusScheduler({
    snapshot: JSON.parse(JSON.stringify(scheduler.snapshot())),
  });
  assert.deepEqual(restored.snapshot(), scheduler.snapshot());
  assert.equal(restored.snapshot().currentReview?.eventId, eventId);
  assert.equal(restored.submitReview(eventId).ok, true);
  assert.equal(restored.snapshot().currentReview, null);
});

test("rejects unpublished ambiguous event ids instead of remapping the confirmation", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([{ subtaskId: "a:b", attemptId: "c", writeFiles: ["src/left.ts"] }]);
  scheduler.finish({ subtaskId: "a:b", attemptId: "c", outcome: "completed" });
  const ambiguous = scheduler.snapshot();
  assert.ok(ambiguous.currentReview);
  ambiguous.currentReview.eventId = "loop-plus-finish:a:b:c";
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: ambiguous }),
    /Invalid Loop\+ scheduler snapshot: currentReview/,
  );

  const otherTuple = scheduler.snapshot();
  assert.ok(otherTuple.currentReview);
  otherTuple.currentReview.subtaskId = "a";
  otherTuple.currentReview.attemptId = "b:c";
  otherTuple.currentReview.eventId = "loop-plus-finish:a:b:c";
  const seen = otherTuple.seenAttempts.find((item) => item.attemptId === "c");
  assert.ok(seen);
  seen.subtaskId = "a";
  seen.attemptId = "b:c";
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: otherTuple }),
    /Invalid Loop\+ scheduler snapshot: currentReview/,
  );
  assert.equal(scheduler.snapshot().currentReview?.subtaskId, "a:b");
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "c");
});

test("parent stop rejects a current review before it can be claimed or confirmed", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([spec("alpha"), spec("beta")]);
  const finished = scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  assert.equal(finished.wake, true);
  assert.equal(finished.view.currentReview?.attemptId, "alpha-1");
  const wakeSeq = finished.view.wakeSeq;

  scheduler.stopParent();
  const claim = scheduler.claimNextReview();
  assert.equal(claim.ok, false);
  assert.equal(claim.reason, "parent_stopped");
  assert.equal(claim.item, null);
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "alpha-1");

  const seq = scheduler.snapshot().seq;
  const late = scheduler.submitReview(reviewEvent("alpha"));
  assert.equal(late.ok, false);
  assert.equal(late.reason, "parent_stopped");
  assert.equal(late.followUp, "stopped");
  assert.equal(scheduler.snapshot().seq, seq);
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "alpha-1");
  assert.equal(scheduler.snapshot().reviewQueue.length, 0);

  const sibling = scheduler.finish({ subtaskId: "beta", attemptId: "beta-1", outcome: "stopped" });
  assert.equal(sibling.applied, true);
  assert.equal(sibling.wake, false);
  assert.deepEqual(sibling.started, []);
  assert.equal(sibling.view.wakeSeq, wakeSeq);
  assert.deepEqual(attemptIds(sibling.view.running), []);
  assert.deepEqual(attemptIds(sibling.view.reviewQueue), ["beta-1"]);
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "alpha-1");
  assert.equal(scheduler.claimNextReview().reason, "parent_stopped");
});

test("parent stop after a claim still rejects the held review and a late confirmation", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([spec("alpha"), spec("beta", ["src/beta.ts"])]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  assert.equal(scheduler.claimNextReview().reason, "already_held");
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["beta-1"]);

  scheduler.stopParent();
  const claim = scheduler.claimNextReview();
  assert.equal(claim.ok, false);
  assert.equal(claim.reason, "parent_stopped");
  assert.equal(claim.item, null);
  const seq = scheduler.snapshot().seq;
  const late = scheduler.submitReview(reviewEvent("alpha"));
  assert.equal(late.ok, false);
  assert.equal(late.reason, "parent_stopped");
  assert.equal(scheduler.snapshot().seq, seq);
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "alpha-1");
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["beta-1"]);
  assert.deepEqual(attemptIds(scheduler.snapshot().pending), []);
});

test("resumeParent keeps queued reviews and does not relaunch old running attempts", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([
    spec("alpha"),
    spec("beta"),
    spec("gamma", ["src/beta.ts"]),
  ]);
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["alpha-1", "beta-1"]);
  assert.deepEqual(attemptIds(scheduler.snapshot().pending), ["gamma-1"]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  scheduler.stopParent();

  const blocked = scheduler.resumeParent();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "running_outstanding");
  assert.deepEqual(blocked.started, []);
  assert.equal(blocked.wake, false);
  assert.equal(scheduler.snapshot().parentStopped, true);
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["beta-1"]);
  assert.equal(scheduler.snapshot().currentReview?.attemptId, "alpha-1");

  const stoppedBeta = scheduler.finish({ subtaskId: "beta", attemptId: "beta-1", outcome: "stopped" });
  assert.equal(stoppedBeta.wake, false);
  assert.deepEqual(stoppedBeta.started, []);
  const seenBefore = scheduler.snapshot().seenAttempts.map((item) => `${item.subtaskId}:${item.attemptId}:${item.disposition}`);
  const resumed = scheduler.resumeParent();
  assert.equal(resumed.ok, true);
  assert.equal(resumed.reason, "resumed");
  assert.deepEqual(attemptIds(resumed.started), ["gamma-1"]);
  assert.equal(resumed.wake, true);
  assert.equal(resumed.view.wake, true);
  assert.equal(resumed.view.currentReview, null);
  assert.deepEqual(attemptIds(resumed.view.reviewQueue), ["alpha-1", "beta-1"]);
  assert.deepEqual(attemptIds(resumed.view.running), ["gamma-1"]);
  assert.deepEqual(attemptIds(resumed.view.pending), []);
  assert.equal(resumed.view.phase, "review_ready");
  assert.deepEqual(
    scheduler.snapshot().seenAttempts.map((item) => `${item.subtaskId}:${item.attemptId}:${item.disposition}`),
    seenBefore,
  );
  assert.equal(scheduler.claimNextReview().item?.attemptId, "alpha-1");
  assert.deepEqual(attemptIds(scheduler.snapshot().reviewQueue), ["beta-1"]);

  const wakeSeq = scheduler.snapshot().wakeSeq;
  const running = attemptIds(scheduler.snapshot().running);
  const again = scheduler.resumeParent();
  assert.equal(again.ok, false);
  assert.equal(again.reason, "not_stopped");
  assert.deepEqual(again.started, []);
  assert.equal(scheduler.snapshot().wakeSeq, wakeSeq);
  assert.deepEqual(attemptIds(scheduler.snapshot().running), running);

  const restored = createLoopPlusScheduler({
    snapshot: JSON.parse(JSON.stringify(scheduler.snapshot())),
  });
  assert.equal(restored.snapshot().parentStopped, false);
  assert.equal(restored.resumeParent().reason, "not_stopped");
});

test("resumeParent refuses a completed scheduler and a restored stopped snapshot stays stopped", () => {
  const stopped = createLoopPlusScheduler({ maxConcurrency: 1 });
  stopped.dispatch([spec("alpha"), spec("beta")]);
  stopped.stopParent();
  stopped.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "stopped" });
  const restored = createLoopPlusScheduler({
    snapshot: JSON.parse(JSON.stringify(stopped.snapshot())),
  });
  assert.equal(restored.snapshot().phase, "stopped");
  assert.equal(restored.snapshot().parentStopped, true);
  assert.deepEqual(attemptIds(restored.snapshot().running), []);
  assert.deepEqual(attemptIds(restored.snapshot().pending), ["beta-1"]);
  assert.deepEqual(attemptIds(restored.snapshot().reviewQueue), ["alpha-1"]);
  assert.equal(restored.claimNextReview().reason, "parent_stopped");

  const finished = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(finished.complete().ok, true);
  const seq = finished.snapshot().seq;
  const resumed = finished.resumeParent();
  assert.equal(resumed.ok, false);
  assert.equal(resumed.reason, "completed");
  assert.deepEqual(resumed.started, []);
  assert.equal(resumed.wake, false);
  assert.equal(finished.snapshot().phase, "completed");
  assert.equal(finished.snapshot().seq, seq);
});

test("rejects snapshots that violate dispatch invariants instead of repairing them", () => {
  const crowded = createLoopPlusScheduler({ maxConcurrency: 2 });
  crowded.dispatch([spec("alpha"), spec("beta")]);
  const overCapacity = crowded.snapshot();
  overCapacity.maxConcurrency = 1;
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: overCapacity }),
    /Invalid Loop\+ scheduler snapshot: maxConcurrency/,
  );
  assert.equal(crowded.snapshot().phase, "waiting");
  assert.deepEqual(attemptIds(crowded.snapshot().running), ["alpha-1", "beta-1"]);

  const conflicting = createLoopPlusScheduler({ maxConcurrency: 2 });
  conflicting.dispatch([spec("alpha", ["src/shared.ts"]), spec("beta", ["src/other.ts"])]);
  const overlapped = conflicting.snapshot();
  const beta = overlapped.running.find((item) => item.attemptId === "beta-1");
  assert.ok(beta);
  beta.writeFiles = ["src/shared.ts"];
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: overlapped }),
    /Invalid Loop\+ scheduler snapshot: running/,
  );

  const active = createLoopPlusScheduler({ maxConcurrency: 1 });
  active.dispatch([spec("alpha")]);
  active.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  const duplicateSubtask = active.snapshot();
  duplicateSubtask.reviewQueue.push({
    eventId: reviewEvent("alpha", "alpha-2"),
    subtaskId: "alpha",
    attemptId: "alpha-2",
    outcome: "failed",
    detail: null,
  });
  duplicateSubtask.seenAttempts.push({
    subtaskId: "alpha",
    attemptId: "alpha-2",
    disposition: "finished",
  });
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: duplicateSubtask }),
    /Invalid Loop\+ scheduler snapshot: active_subtask/,
  );
  assert.equal(active.snapshot().phase, "reviewing");
  assert.equal(active.snapshot().currentReview?.attemptId, "alpha-1");
  assert.equal(active.snapshot().reviewQueue.length, 0);
});

test("returns an unstarted reservation to pending and promotes that same attempt once", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([
    spec("alpha"),
    spec("beta"),
    spec("gamma", ["src/beta.ts"]),
  ]);
  const finished = scheduler.finish({
    subtaskId: "alpha",
    attemptId: "alpha-1",
    outcome: "completed",
    detail: "alpha done",
  });
  assert.equal(finished.applied, true);
  assert.deepEqual(attemptIds(finished.started), ["beta-1"]);
  assert.equal(finished.started[0]?.state, "running");
  const seen = scheduler.snapshot().seenAttempts.map((item) => `${item.subtaskId}:${item.attemptId}:${item.disposition}`);
  const wakeSeq = scheduler.snapshot().wakeSeq;
  const eventId = scheduler.snapshot().currentReview?.eventId;
  const released = scheduler.releaseUnstarted(["beta-1", "beta-1", "missing", "alpha-1"]);
  assert.deepEqual(attemptIds(released.released), ["beta-1"]);
  assert.equal(released.released[0]?.state, "pending");
  assert.deepEqual(attemptIds(scheduler.snapshot().running), []);
  assert.deepEqual(attemptIds(scheduler.snapshot().pending), ["beta-1", "gamma-1"]);
  assert.equal(scheduler.snapshot().parentStopped, false);
  assert.equal(scheduler.snapshot().currentReview?.eventId, eventId);
  assert.equal(scheduler.snapshot().currentReview?.detail, "alpha done");
  assert.equal(scheduler.snapshot().wakeSeq, wakeSeq);
  assert.deepEqual(
    scheduler.snapshot().seenAttempts.map((item) => `${item.subtaskId}:${item.attemptId}:${item.disposition}`),
    seen,
  );
  const seq = scheduler.snapshot().seq;
  const again = scheduler.releaseUnstarted(["beta-1"]);
  assert.deepEqual(again.released, []);
  assert.equal(scheduler.snapshot().seq, seq);

  const restored = createLoopPlusScheduler({
    snapshot: JSON.parse(JSON.stringify(scheduler.snapshot())),
  });
  assert.deepEqual(attemptIds(restored.snapshot().pending), ["beta-1", "gamma-1"]);
  assert.equal(restored.snapshot().currentReview?.attemptId, "alpha-1");
  const promoted = restored.promotePending();
  assert.deepEqual(attemptIds(promoted.started), ["beta-1"]);
  assert.equal(promoted.started[0]?.state, "running");
  assert.deepEqual(attemptIds(restored.snapshot().running), ["beta-1"]);
  assert.deepEqual(attemptIds(restored.snapshot().pending), ["gamma-1"]);
  const twice = restored.promotePending();
  assert.deepEqual(twice.started, []);
  assert.deepEqual(attemptIds(restored.snapshot().running), ["beta-1"]);
  assert.equal(restored.snapshot().wakeSeq, wakeSeq);
});

test("parent stop keeps release and promote from bypassing the stop gate", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([spec("alpha"), spec("beta")]);
  scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
  scheduler.stopParent();
  const seq = scheduler.snapshot().seq;
  const seen = scheduler.snapshot().seenAttempts.map((item) => `${item.subtaskId}:${item.attemptId}:${item.disposition}`);
  const released = scheduler.releaseUnstarted(["beta-1"]);
  assert.deepEqual(released.released, []);
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["beta-1"]);
  assert.deepEqual(attemptIds(scheduler.snapshot().pending), []);
  assert.equal(scheduler.snapshot().parentStopped, true);
  const promoted = scheduler.promotePending();
  assert.deepEqual(promoted.started, []);
  assert.equal(scheduler.snapshot().seq, seq);
  assert.equal(scheduler.snapshot().parentStopped, true);
  assert.deepEqual(
    scheduler.snapshot().seenAttempts.map((item) => `${item.subtaskId}:${item.attemptId}:${item.disposition}`),
    seen,
  );
  assert.equal(scheduler.resumeParent().reason, "running_outstanding");
  assert.deepEqual(attemptIds(scheduler.snapshot().running), ["beta-1"]);
});

test("queues user speech separately from reviews and still loads snapshots without the field", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([spec("alpha")]);
  assert.equal(scheduler.enqueueUserMessage("   ").queued, false);
  const first = scheduler.enqueueUserMessage("  first message  ");
  const second = scheduler.enqueueUserMessage("second message");
  assert.equal(first.queued, true);
  assert.equal(second.depth, 2);
  assert.deepEqual(scheduler.snapshot().userMessageQueue, ["first message", "second message"]);
  assert.equal(scheduler.snapshot().currentReview, null);
  assert.deepEqual(scheduler.snapshot().reviewQueue, []);
  assert.deepEqual(scheduler.getCompletionBlockers(), ["running", "user_messages"]);
  assert.equal(scheduler.complete().ok, false);

  const acked = scheduler.ackUserMessages(1);
  assert.deepEqual(acked.acked, ["first message"]);
  assert.deepEqual(scheduler.snapshot().userMessageQueue, ["second message"]);
  assert.deepEqual(scheduler.ackUserMessages(0).acked, []);

  scheduler.stopParent();
  assert.equal(scheduler.enqueueUserMessage("late").queued, false);
  assert.deepEqual(scheduler.snapshot().userMessageQueue, ["second message"]);

  const legacy = JSON.parse(JSON.stringify(scheduler.snapshot())) as { userMessageQueue?: string[] };
  delete legacy.userMessageQueue;
  const restored = createLoopPlusScheduler({ snapshot: legacy });
  assert.deepEqual(restored.snapshot().userMessageQueue, []);

  const invalid = scheduler.snapshot();
  invalid.userMessageQueue = [" padded "];
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: invalid }),
    /Invalid Loop\+ scheduler snapshot: userMessageQueue/,
  );
});

test("keeps the execution outcome after review and still loads a legacy attempt without one", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([spec("alpha")]);
  const finished = scheduler.finish({
    subtaskId: "alpha",
    attemptId: "alpha-1",
    outcome: "stopped",
  });
  assert.equal(finished.applied, true);
  assert.equal(scheduler.snapshot().seenAttempts[0]?.outcome, "stopped");
  assert.equal(scheduler.snapshot().seenAttempts[0]?.disposition, "finished");
  assert.equal(scheduler.submitReview(reviewEvent("alpha")).ok, true);
  assert.equal(scheduler.snapshot().seenAttempts[0]?.disposition, "reviewed");
  assert.equal(scheduler.snapshot().seenAttempts[0]?.outcome, "stopped");

  const legacy = scheduler.snapshot();
  delete legacy.seenAttempts[0]?.outcome;
  const restored = createLoopPlusScheduler({ snapshot: legacy });
  assert.equal(restored.snapshot().seenAttempts[0]?.disposition, "reviewed");
  assert.equal(restored.snapshot().seenAttempts[0]?.outcome, undefined);

  const invalid = scheduler.snapshot();
  (invalid.seenAttempts[0] as { outcome?: string }).outcome = "nope";
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: invalid }),
    /Invalid Loop\+ scheduler snapshot: seenAttempts\[0\]/,
  );

  const running = createLoopPlusScheduler({ maxConcurrency: 1 });
  running.dispatch([spec("beta")]);
  const open = running.snapshot();
  open.seenAttempts[0]!.outcome = "completed";
  assert.throws(
    () => createLoopPlusScheduler({ snapshot: open }),
    /Invalid Loop\+ scheduler snapshot: seenAttempts\[0\]/,
  );
});
