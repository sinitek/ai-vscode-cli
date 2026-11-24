import test = require("node:test");
import assert = require("node:assert/strict");

import { buildLoopPlusFinishEventId, createLoopPlusScheduler } from "../../loopPlusScheduler";

const event = (id: string, attempt = `${id}-1`) => buildLoopPlusFinishEventId(id, attempt);
const task = (subtaskId: string, attemptId = `${subtaskId}-1`, dependsOn?: string[], requiresAcceptance?: boolean) => ({
  subtaskId,
  attemptId,
  writeFiles: [`src/${subtaskId}.ts`],
  ...(dependsOn ? { dependsOn } : {}),
  ...(requiresAcceptance !== undefined ? { requiresAcceptance } : {}),
});

test("accepts forward references in a batch and keeps dependency-blocked work pending while independent work fills capacity", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  const result = scheduler.dispatch([
    task("tail", "tail-1", ["middle"]),
    task("free"),
    task("middle", "middle-1", ["root"]),
    task("root"),
  ]);
  assert.deepEqual(result.started.map((item) => item.subtaskId), ["free", "root"]);
  assert.deepEqual(result.view.pending.map((item) => item.subtaskId), ["tail", "middle"]);
  assert.deepEqual(scheduler.getDependencyBlocks().map((item) => [item.subtaskId, item.dependencyId, item.reason]), [
    ["tail", "middle", "execution_pending"],
    ["middle", "root", "execution_pending"],
  ]);
  const detached = scheduler.getDependencyBlocks();
  detached[0].dependencyId = "mutated";
  assert.equal(scheduler.getDependencyBlocks()[0]?.dependencyId, "middle");
});

test("promotes a diamond only after each prerequisite reaches its own success boundary", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 3 });
  scheduler.dispatch([
    task("tip", "tip-1", ["left", "right"]),
    task("right", "right-1", ["base"]),
    task("base"),
    task("left", "left-1", ["base"]),
  ]);
  const base = scheduler.finish({ subtaskId: "base", attemptId: "base-1", outcome: "completed" });
  assert.deepEqual(base.started.map((item) => item.subtaskId), ["right", "left"]);
  const right = scheduler.finish({ subtaskId: "right", attemptId: "right-1", outcome: "completed" });
  assert.deepEqual(right.started, []);
  const left = scheduler.finish({ subtaskId: "left", attemptId: "left-1", outcome: "completed" });
  assert.deepEqual(left.started.map((item) => item.subtaskId), ["tip"]);
  scheduler.finish({ subtaskId: "tip", attemptId: "tip-1", outcome: "completed" });
  assert.deepEqual(scheduler.prepareReviewBatch(4).items.map((item) => item.subtaskId), ["base", "right", "left", "tip"]);
});

test("keeps dependents pending when their prerequisite is closed", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([task("closed"), task("waiting", "waiting-1", ["closed"])]);
  const result = scheduler.applyControls([{ subtaskId: "closed", action: "close" }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.started, []);
  assert.deepEqual(scheduler.getDependencyBlocks().map((item) => item.reason), ["closed"]);
});

test("department admission still requires successful review or explicit report acknowledgement", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4, requireAcceptedDependencies: true });
  scheduler.dispatch([task("reviewed"), task("reported", "reported-1", [], false), task("next", "next-1", ["reviewed", "reported"])]);
  scheduler.finish({ subtaskId: "reviewed", attemptId: "reviewed-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "reported", attemptId: "reported-1", outcome: "completed" });
  assert.equal(scheduler.snapshot().pending.some((item) => item.subtaskId === "next"), true);
  assert.deepEqual(scheduler.getDependencyBlocks().map((item) => item.reason), ["review_pending", "report_pending"]);
  const restored = createLoopPlusScheduler({ snapshot: scheduler.snapshot() });
  assert.deepEqual(restored.getDependencyBlocks(), []);
  assert.deepEqual(restored.promotePending().started.map((item) => item.subtaskId), ["next"]);
  assert.equal(restored.snapshot().reportQueue?.length, 1);
  assert.equal(restored.snapshot().currentReview?.subtaskId, "reviewed");
  scheduler.submitReviewBatch([event("reviewed")], "passed");
  assert.equal(scheduler.acknowledgeReports([event("reported")]), true);
  assert.equal(scheduler.promotePending().started.some((item) => item.subtaskId === "next"), true);

  scheduler.finish({ subtaskId: "next", attemptId: "next-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("next")], "passed");
  const repair = scheduler.dispatch([task("reviewed", "reviewed-2")]);
  assert.deepEqual(repair.started.map((item) => item.subtaskId), ["reviewed"]);
  scheduler.finish({ subtaskId: "reviewed", attemptId: "reviewed-2", outcome: "failed" });
  scheduler.submitReviewBatch([event("reviewed", "reviewed-2")], "failed");
  scheduler.dispatch([task("after-failure", "after-failure-1", ["reviewed"])]);
  assert.equal(scheduler.getDependencyBlocks().some((item) => item.subtaskId === "after-failure" && item.reason === "failed"), true);
});

test("ordinary admission uses execution outcomes even after an acceptance verdict", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([task("source")]);
  scheduler.finish({ subtaskId: "source", attemptId: "source-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("source")], "failed");
  assert.deepEqual(scheduler.dispatch([task("successor", "successor-1", ["source"])]).started.map((item) => item.subtaskId), ["successor"]);
  scheduler.dispatch([task("source", "source-2")]);
  scheduler.finish({ subtaskId: "source", attemptId: "source-2", outcome: "stopped" });
  assert.deepEqual(scheduler.dispatch([task("waiting", "waiting-1", ["source"])]).started, []);
  assert.deepEqual(scheduler.getDependencyBlocks().map((item) => [item.dependencyAttemptId, item.reason]), [["source-2", "failed"]]);
});

test("rejects unknown dependencies and cycles atomically without changing scheduler state", () => {
  for (const specs of [
    [task("known"), task("unknown", "unknown-1", ["missing"])],
    [task("a", "a-1", ["b"]), task("b", "b-1", ["a"])],
  ]) {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
    const before = scheduler.snapshot();
    const result = scheduler.dispatch(specs);
    assert.equal(result.rejected.length, specs.length);
    assert.ok(result.rejected.every((item) => item.reason === "invalid_dependencies" && !!item.detail));
    assert.deepEqual(scheduler.snapshot(), before);
  }
});

test("failed review repair obligation survives rejected same-ID attempts and clears only on accepted repair", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([task("A")]);
  scheduler.finish({ subtaskId: "A", attemptId: "A-1", outcome: "completed" });
  const failedEvent = event("A", "A-1");
  assert.equal(scheduler.submitReviewBatch([failedEvent], [{ eventId: failedEvent, acceptance: "failed", repairRequired: true }]).ok, true);
  const failedSnapshot = scheduler.snapshot();
  assert.equal(failedSnapshot.seenAttempts[0].repairRequired, true);
  assert.equal(scheduler.complete().ok, false);

  const rejectedRepair = scheduler.dispatch([
    task("A", "A-2", ["missing"]), task("independent", "independent-1"),
  ]);
  assert.deepEqual(rejectedRepair.rejected.map((item) => item.subtaskId), ["A"]);
  assert.deepEqual(rejectedRepair.decisions.map((item) => item.subtaskId), ["independent"]);
  assert.equal(scheduler.snapshot().seenAttempts[0].repairRequired, true);

  const reloaded = createLoopPlusScheduler({ snapshot: JSON.parse(JSON.stringify(scheduler.snapshot())), maxConcurrency: 2 });
  const repaired = reloaded.dispatch([task("A", "A-3")]);
  assert.equal(repaired.rejected.length, 0);
  assert.equal(reloaded.snapshot().seenAttempts[0].repairRequired, undefined);
  assert.equal(reloaded.snapshot().running.concat(reloaded.snapshot().pending).some((item) => item.subtaskId === "A"), true);

  const legacy = JSON.parse(JSON.stringify(failedSnapshot)) as ReturnType<typeof scheduler.snapshot>;
  delete legacy.seenAttempts[0].repairRequired;
  const restoredLegacy = createLoopPlusScheduler({ snapshot: legacy });
  assert.equal(restoredLegacy.snapshot().seenAttempts[0].repairRequired, undefined);
});

test("preflights control replacements before closing attempts and keeps dry runs side-effect free", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([task("parent"), task("child", "child-1", ["parent"])]);
  const before = scheduler.snapshot();
  const bad = scheduler.applyControls([
    { subtaskId: "parent", action: "reprompt", replacement: task("parent", "parent-2", ["missing"]) },
  ]);
  assert.equal(bad.ok, false);
  assert.deepEqual(scheduler.snapshot(), before);
  const dry = scheduler.applyControls([
    { subtaskId: "parent", action: "reprompt", replacement: task("parent", "parent-2", []) },
  ], { dryRun: true });
  assert.equal(dry.ok, true);
  assert.deepEqual(scheduler.snapshot(), before);
});

test("persists dependencies, accepts legacy snapshots without them, and rejects inconsistent new snapshots", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([task("base"), task("child", "child-1", ["base"])]);
  const snapshot = scheduler.snapshot();
  assert.deepEqual(snapshot.pending[0]?.dependsOn, ["base"]);
  assert.deepEqual(snapshot.seenAttempts[1]?.dependsOn, ["base"]);
  const legacy = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
  delete legacy.pending[0]?.dependsOn;
  delete legacy.seenAttempts[1]?.dependsOn;
  assert.doesNotThrow(() => createLoopPlusScheduler({ snapshot: legacy }));
  const mismatched = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
  mismatched.seenAttempts[1]!.dependsOn = [];
  assert.throws(() => createLoopPlusScheduler({ snapshot: mismatched }), /dependsOn/);
  const unknown = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
  unknown.pending[0]!.dependsOn = ["unknown"];
  unknown.seenAttempts[1]!.dependsOn = ["unknown"];
  assert.throws(() => createLoopPlusScheduler({ snapshot: unknown }), /dependsOn/);
});

test("orders a completed dependent behind the newest reprompted prerequisite", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([task("base"), task("child", "child-1", ["base"])]);
  scheduler.finish({ subtaskId: "base", attemptId: "base-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("base")], "passed");
  scheduler.promotePending();

  scheduler.dispatch([task("base", "base-2")]);
  scheduler.finish({ subtaskId: "child", attemptId: "child-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "base", attemptId: "base-2", outcome: "completed" });

  const prepared = scheduler.prepareReviewBatch(4);
  assert.deepEqual(prepared.items.map((item) => item.attemptId), ["base-2", "child-1"]);
  assert.equal(prepared.view.currentReview?.attemptId, "base-2");
  assert.deepEqual(prepared.view.reviewQueue.map((item) => item.attemptId), ["child-1"]);
  assert.equal(prepared.dependencyBlocks.length, 0);
  const preparedSeq = prepared.view.seq;
  assert.equal(scheduler.prepareReviewBatch(4).view.seq, preparedSeq);
});

test("orders transitive chain reviews before each dependent's newest attempt", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 3 });
  scheduler.dispatch([task("root")]);
  scheduler.finish({ subtaskId: "root", attemptId: "root-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("root")], "passed");
  scheduler.promotePending();
  scheduler.dispatch([task("middle", "middle-1", ["root"])]);
  scheduler.finish({ subtaskId: "middle", attemptId: "middle-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("middle")], "passed");
  scheduler.promotePending();
  scheduler.dispatch([task("leaf", "leaf-1", ["middle"])]);
  scheduler.dispatch([task("middle", "middle-2", ["root"])]);
  scheduler.dispatch([task("root", "root-2")]);
  scheduler.finish({ subtaskId: "leaf", attemptId: "leaf-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "middle", attemptId: "middle-2", outcome: "failed" });
  scheduler.finish({ subtaskId: "root", attemptId: "root-2", outcome: "completed" });

  const prepared = scheduler.prepareReviewBatch(3);
  assert.deepEqual(prepared.items.map((item) => item.attemptId), ["root-2", "middle-2", "leaf-1"]);
  assert.deepEqual(prepared.dependencyBlocks, []);
});

test("blocks only dependents of open or unacknowledged report prerequisites", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 3 });
  scheduler.dispatch([task("base", "base-1", [], false)]);
  scheduler.finish({ subtaskId: "base", attemptId: "base-1", outcome: "completed" });
  assert.equal(scheduler.acknowledgeReports([event("base")]), true);
  scheduler.dispatch([task("child", "child-1", ["base"])]);
  scheduler.dispatch([task("base", "base-2", [], false)]);
  scheduler.dispatch([task("independent")]);
  scheduler.finish({ subtaskId: "child", attemptId: "child-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "independent", attemptId: "independent-1", outcome: "completed" });

  const open = scheduler.prepareReviewBatch(4);
  assert.deepEqual(open.items.map((item) => item.subtaskId), ["independent"]);
  assert.deepEqual(open.dependencyBlocks.map((block) => [block.subtaskId, block.reason]), [["child", "execution_pending"]]);
  open.dependencyBlocks[0]!.dependencyId = "mutated";
  assert.equal(scheduler.prepareReviewBatch(4).dependencyBlocks[0]?.dependencyId, "base");

  scheduler.finish({ subtaskId: "base", attemptId: "base-2", outcome: "completed" });
  const reportPending = scheduler.prepareReviewBatch(4);
  assert.deepEqual(reportPending.items.map((item) => item.subtaskId), ["independent"]);
  assert.deepEqual(reportPending.dependencyBlocks.map((block) => [block.subtaskId, block.reason]), [["child", "report_pending"]]);
  scheduler.submitReviewBatch([event("independent")], "passed");
  const blockedSeq = scheduler.snapshot().seq;
  const blockedOnly = scheduler.prepareReviewBatch(4);
  assert.deepEqual(blockedOnly.items, []);
  assert.equal(blockedOnly.view.currentReview, null);
  assert.deepEqual(blockedOnly.view.reviewQueue.map((item) => item.subtaskId), ["child"]);
  assert.equal(blockedOnly.view.seq, blockedSeq);
  assert.deepEqual(blockedOnly.dependencyBlocks.map((block) => block.reason), ["report_pending"]);
});

test("uses stable arrival order among ready events and preserves unselected events", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  scheduler.dispatch([task("root")]);
  scheduler.finish({ subtaskId: "root", attemptId: "root-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("root")], "passed");
  scheduler.dispatch([
    task("left", "left-1", ["root"]),
    task("right", "right-1", ["root"]),
  ]);
  scheduler.dispatch([task("root", "root-2")]);
  scheduler.finish({ subtaskId: "right", attemptId: "right-1", outcome: "failed" });
  scheduler.finish({ subtaskId: "left", attemptId: "left-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "root", attemptId: "root-2", outcome: "failed" });
  const beforeSeq = scheduler.snapshot().seq;

  const first = scheduler.prepareReviewBatch(2);
  assert.deepEqual(first.items.map((item) => item.attemptId), ["root-2", "right-1"]);
  assert.deepEqual(first.dependencyBlocks, []);
  assert.equal(first.view.currentReview?.attemptId, "root-2");
  assert.deepEqual(first.view.reviewQueue.map((item) => item.attemptId), ["right-1", "left-1"]);
  assert.equal(first.view.seq, beforeSeq + 1);

  const detached = first.items;
  detached[0].detail = "mutated";
  assert.equal(scheduler.snapshot().currentReview?.detail, null);
});

test("does not let a dependent pass a prerequisite excluded by the four item capacity", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 7 });
  scheduler.dispatch([task("base"), task("child", "child-1", ["base"])]);
  scheduler.finish({ subtaskId: "base", attemptId: "base-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("base")], "passed");
  scheduler.promotePending();
  scheduler.dispatch([task("base", "base-2"), task("i1"), task("i2"), task("i3"), task("i4")]);
  scheduler.finish({ subtaskId: "child", attemptId: "child-1", outcome: "completed" });
  for (const id of ["i1", "i2", "i3", "i4"]) {
    scheduler.finish({ subtaskId: id, attemptId: `${id}-1`, outcome: "completed" });
  }
  scheduler.finish({ subtaskId: "base", attemptId: "base-2", outcome: "completed" });

  const first = scheduler.prepareReviewBatch(4);
  assert.deepEqual(first.items.map((item) => item.subtaskId), ["i1", "i2", "i3", "i4"]);
  assert.deepEqual(first.dependencyBlocks.map((block) => [block.subtaskId, block.dependencyId, block.reason]), [
    ["child", "base", "review_pending"],
  ]);
  scheduler.submitReviewBatch(first.items.map((item) => item.eventId), "passed");
  const second = scheduler.prepareReviewBatch(4);
  assert.deepEqual(second.items.map((item) => item.attemptId), ["base-2", "child-1"]);
});

test("orders a re-opened diamond by latest prerequisite attempts", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  scheduler.dispatch([task("root")]);
  scheduler.finish({ subtaskId: "root", attemptId: "root-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("root")], "passed");
  scheduler.promotePending();
  scheduler.dispatch([
    task("left", "left-1", ["root"]),
    task("right", "right-1", ["root"]),
  ]);
  scheduler.finish({ subtaskId: "left", attemptId: "left-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "right", attemptId: "right-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("left"), event("right")], [
    { eventId: event("left"), acceptance: "passed" },
    { eventId: event("right"), acceptance: "passed" },
  ]);
  scheduler.promotePending();
  scheduler.dispatch([task("tip", "tip-1", ["left", "right"])]);
  scheduler.dispatch([
    task("left", "left-2", ["root"]),
    task("right", "right-2", ["root"]),
    task("root", "root-2"),
  ]);
  scheduler.finish({ subtaskId: "left", attemptId: "left-2", outcome: "failed" });
  scheduler.finish({ subtaskId: "right", attemptId: "right-2", outcome: "completed" });
  scheduler.finish({ subtaskId: "tip", attemptId: "tip-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "root", attemptId: "root-2", outcome: "completed" });

  const prepared = scheduler.prepareReviewBatch(4);
  assert.deepEqual(prepared.items.map((item) => item.attemptId), ["root-2", "left-2", "right-2", "tip-1"]);
  assert.deepEqual(prepared.dependencyBlocks, []);
});

test("accepts a selected failed prerequisite before its completed dependent without releasing execution", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([task("base")]);
  scheduler.finish({ subtaskId: "base", attemptId: "base-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("base")], "passed");
  scheduler.promotePending();
  scheduler.dispatch([task("child", "child-1", ["base"])]);
  scheduler.dispatch([task("base", "base-2")]);
  scheduler.dispatch([task("future", "future-1", ["base"])]);
  scheduler.finish({ subtaskId: "child", attemptId: "child-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "base", attemptId: "base-2", outcome: "failed" });

  const prepared = scheduler.prepareReviewBatch(4);
  assert.deepEqual(prepared.items.map((item) => item.attemptId), ["base-2", "child-1"]);
  assert.equal(prepared.items[0]?.outcome, "failed");
  assert.deepEqual(prepared.view.pending.map((item) => item.attemptId), ["future-1"]);
  assert.deepEqual(prepared.view.dependencyBlocks?.map((block) => block.reason), ["failed"]);
  assert.equal(scheduler.submitReviewBatch([event("base", "base-2"), event("child")], [
    { eventId: event("base", "base-2"), acceptance: "failed" },
    { eventId: event("child"), acceptance: "passed" },
  ]).ok, true);
  assert.equal(scheduler.snapshot().seenAttempts.find((item) => item.attemptId === "base-2")?.acceptance, "failed");
  assert.equal(scheduler.snapshot().seenAttempts.find((item) => item.attemptId === "child-1")?.acceptance, "passed");
  assert.deepEqual(scheduler.snapshot().pending.map((item) => item.attemptId), ["future-1"]);
  const before = scheduler.snapshot();
  assert.throws(() => scheduler.prepareReviewBatch(0), RangeError);
  assert.deepEqual(scheduler.snapshot(), before);
  assert.throws(() => scheduler.prepareReviewBatch(Number.MAX_SAFE_INTEGER + 1), RangeError);
});

test("keeps arrival order for unrelated reviews, caps the batch, and is inert when stopped or completed", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 5 });
  scheduler.dispatch([task("a"), task("b"), task("c"), task("d"), task("e")]);
  for (const id of ["a", "b", "c", "d"]) {
    scheduler.finish({ subtaskId: id, attemptId: `${id}-1`, outcome: "completed" });
  }
  const first = scheduler.prepareReviewBatch(4);
  assert.deepEqual(first.items.map((item) => item.subtaskId), ["a", "b", "c", "d"]);
  assert.deepEqual(first.view.reviewQueue.map((item) => item.subtaskId), ["b", "c", "d"]);
  scheduler.finish({ subtaskId: "e", attemptId: "e-1", outcome: "completed" });
  const submittedIds = first.items.map((item) => item.eventId);
  assert.equal(scheduler.submitReviewBatch(submittedIds, "passed").ok, true);
  assert.deepEqual(scheduler.snapshot().reviewQueue.map((item) => item.subtaskId), ["e"]);

  scheduler.stopParent();
  const stopped = scheduler.snapshot();
  assert.deepEqual(scheduler.prepareReviewBatch(4).items, []);
  assert.deepEqual(scheduler.snapshot(), stopped);

  const completed = createLoopPlusScheduler({ maxConcurrency: 1 });
  assert.equal(completed.complete().ok, true);
  const completedSnapshot = completed.snapshot();
  assert.deepEqual(completed.prepareReviewBatch(4).items, []);
  assert.deepEqual(completed.snapshot(), completedSnapshot);
});

test("rejects invalid batch sizes before changing state and restores prepared prefixes", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([task("one"), task("two")]);
  scheduler.finish({ subtaskId: "one", attemptId: "one-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "two", attemptId: "two-1", outcome: "completed" });
  const before = scheduler.snapshot();
  for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => scheduler.prepareReviewBatch(size), RangeError);
    assert.deepEqual(scheduler.snapshot(), before);
  }
  const prepared = scheduler.prepareReviewBatch(2);
  const restored = createLoopPlusScheduler({ snapshot: JSON.parse(JSON.stringify(scheduler.snapshot())) });
  assert.equal(restored.snapshot().currentReview?.attemptId, "one-1");
  assert.deepEqual(restored.snapshot().reviewQueue.map((item) => item.attemptId), ["two-1"]);
});

test("reports the real failed prerequisite reason when capacity defers its review", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
  scheduler.dispatch([task("base"), task("child", "child-1", ["base"])]);
  scheduler.finish({ subtaskId: "base", attemptId: "base-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("base")], "passed");
  scheduler.promotePending();

  scheduler.dispatch([task("base", "base-2"), task("i1"), task("i2"), task("i3"), task("i4")]);
  scheduler.finish({ subtaskId: "child", attemptId: "child-1", outcome: "completed" });
  for (const id of ["i1", "i2", "i3", "i4"]) {
    scheduler.finish({ subtaskId: id, attemptId: `${id}-1`, outcome: "completed" });
  }
  scheduler.finish({ subtaskId: "base", attemptId: "base-2", outcome: "failed" });

  const first = scheduler.prepareReviewBatch(4);
  assert.deepEqual(first.items.map((item) => item.subtaskId), ["i1", "i2", "i3", "i4"]);
  assert.deepEqual(first.dependencyBlocks.map((block) => [block.subtaskId, block.dependencyId, block.dependencyAttemptId, block.reason]), [
    ["child", "base", "base-2", "failed"],
  ]);
  assert.deepEqual(first.view.reviewQueue.map((item) => item.attemptId), ["i2-1", "i3-1", "i4-1", "child-1", "base-2"]);

  assert.equal(scheduler.submitReviewBatch(first.items.map((item) => item.eventId), "passed").ok, true);
  assert.deepEqual(scheduler.prepareReviewBatch(4).items.map((item) => item.attemptId), ["base-2", "child-1"]);
});

test("preserves distinct blocked tuples when valid identifiers contain NUL characters", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  scheduler.dispatch([
    task("b\u0000c", "prerequisite-one"),
    task("c", "prerequisite-two"),
    task("x", "a", ["b\u0000c"]),
    task("y", "a\u0000b", ["c"]),
  ]);
  scheduler.finish({ subtaskId: "x", attemptId: "a", outcome: "completed" });
  scheduler.finish({ subtaskId: "y", attemptId: "a\u0000b", outcome: "completed" });

  const first = scheduler.prepareReviewBatch(4);
  assert.deepEqual(first.items, []);
  assert.deepEqual(first.dependencyBlocks.map((block) => [block.attemptId, block.dependencyId, block.dependencyAttemptId, block.reason]), [
    ["a", "b\u0000c", "prerequisite-one", "execution_pending"],
    ["a\u0000b", "c", "prerequisite-two", "execution_pending"],
  ]);
  first.dependencyBlocks[0]!.dependencyId = "mutated";
  assert.equal(scheduler.prepareReviewBatch(4).dependencyBlocks[0]?.dependencyId, "b\u0000c");
});

test("keeps transitive dependent reviews blocked behind an open latest root while independent reviews proceed", () => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
  scheduler.dispatch([task("root"), task("middle", "middle-1", ["root"])]);
  scheduler.finish({ subtaskId: "root", attemptId: "root-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("root")], "passed");
  scheduler.promotePending();
  scheduler.finish({ subtaskId: "middle", attemptId: "middle-1", outcome: "completed" });
  scheduler.submitReviewBatch([event("middle")], "passed");
  scheduler.promotePending();

  scheduler.dispatch([task("leaf", "leaf-1", ["middle"])]);
  scheduler.dispatch([task("middle", "middle-2", ["root"])]);
  scheduler.dispatch([task("root", "root-2")]);
  scheduler.dispatch([task("independent")]);
  scheduler.finish({ subtaskId: "leaf", attemptId: "leaf-1", outcome: "completed" });
  scheduler.finish({ subtaskId: "middle", attemptId: "middle-2", outcome: "completed" });
  scheduler.finish({ subtaskId: "independent", attemptId: "independent-1", outcome: "completed" });
  scheduler.dispatch([task("future", "future-1", ["root"])]);

  const before = scheduler.snapshot();
  const prepared = scheduler.prepareReviewBatch(4);
  assert.deepEqual(prepared.items.map((item) => item.subtaskId), ["independent"]);
  assert.deepEqual(prepared.dependencyBlocks.map((block) => [block.subtaskId, block.attemptId, block.dependencyId, block.dependencyAttemptId, block.reason]), [
    ["leaf", "leaf-1", "middle", "middle-2", "review_pending"],
    ["middle", "middle-2", "root", "root-2", "execution_pending"],
  ]);
  assert.deepEqual(prepared.view.reviewQueue.map((item) => item.attemptId), ["leaf-1", "middle-2"]);
  assert.equal(prepared.view.seq, before.seq + 1);
  assert.equal(scheduler.snapshot().pending.some((item) => item.attemptId === "future-1"), true);
  assert.equal(scheduler.snapshot().seenAttempts.find((item) => item.attemptId === "leaf-1")?.disposition, "finished");
  assert.equal(scheduler.snapshot().seenAttempts.find((item) => item.attemptId === "middle-2")?.disposition, "finished");
  assert.deepEqual(scheduler.promotePending().started, []);
});
