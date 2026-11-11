import test = require("node:test");
import assert = require("node:assert/strict");

import { createLoopOrchestrationOwnershipTracker } from "../../loopOrchestrationOwnership";

test("releasing an old Loop orchestration does not clear a newly resumed owner", () => {
  const tracker = createLoopOrchestrationOwnershipTracker();
  const releaseInterruptedRun = tracker.acquire("task-1");
  const releaseResumedRun = tracker.acquire("task-1");

  assert.equal(tracker.getCount("task-1"), 2);
  releaseInterruptedRun();
  assert.equal(tracker.getCount("task-1"), 1);
  assert.deepEqual(Array.from(tracker.collectTaskIds()), ["task-1"]);

  releaseInterruptedRun();
  assert.equal(tracker.getCount("task-1"), 1);
  releaseResumedRun();
  assert.equal(tracker.getCount("task-1"), 0);
  assert.deepEqual(Array.from(tracker.collectTaskIds()), []);
});

test("idle waiters resolve only after all controllers for their task release", async () => {
  const tracker = createLoopOrchestrationOwnershipTracker();
  await tracker.waitForIdle("idle");
  const first = tracker.acquire("task");
  const second = tracker.acquire("task");
  const unrelated = tracker.acquire("other");
  let settled = 0;
  const waits = [tracker.waitForIdle("task"), tracker.waitForIdle("task")].map(async (wait) => {
    await wait;
    settled += 1;
  });
  first();
  await Promise.resolve();
  assert.equal(settled, 0);
  second();
  await Promise.all(waits);
  assert.equal(settled, 2);
  assert.equal(tracker.getCount("other"), 1);
  unrelated();
});
