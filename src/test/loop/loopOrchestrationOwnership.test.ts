import test = require("node:test");
import assert = require("node:assert/strict");

import { createLoopOrchestrationOwnershipTracker } from "../loopOrchestrationOwnership";

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
