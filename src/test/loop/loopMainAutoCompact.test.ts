import test = require("node:test");
import assert = require("node:assert/strict");

import {
  mergeCompactTranscriptIntoLive,
  settleAutoCompactAfterPrompt,
  shouldOverlapLoopMainContextCompaction,
} from "../../loopMainAutoCompact";
import { createLoopMainQuestionQueue } from "../../loopMainQuestionQueue";

test("overlaps context compaction only for Loop main sessions", () => {
  assert.equal(shouldOverlapLoopMainContextCompaction({
    taskRole: "main",
    loopTaskId: "loop-1",
  }), true);
  assert.equal(shouldOverlapLoopMainContextCompaction({
    taskRole: "subtask",
    loopTaskId: "loop-1",
  }), false);
  assert.equal(shouldOverlapLoopMainContextCompaction({
    taskRole: "main",
    loopTaskId: "  ",
  }), false);
  assert.equal(shouldOverlapLoopMainContextCompaction({
    taskRole: "main",
  }), false);
});

test("Loop main compaction starts without blocking other tabs", async () => {
  let releaseRun: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  let runFinished = false;
  let reserved = 0;
  let released = 0;
  const queue = createLoopMainQuestionQueue();

  await settleAutoCompactAfterPrompt({
    overlapLoopDispatch: true,
    canOverlap: () => true,
    run: async () => {
      await pending;
      runFinished = true;
    },
    reserve: () => {
      reserved += 1;
      return {
        adoptStop: () => {},
        release: () => {
          released += 1;
        },
      };
    },
    enqueue: (run) => { void queue.runCompaction("main-tab", run); },
  });

  assert.equal(runFinished, false);
  assert.equal(reserved, 1);
  assert.equal(released, 0);
  assert.ok(queue.getCompaction("main-tab"));
  await queue.runMain("subtask-tab", async () => undefined);
  assert.equal(runFinished, false);

  releaseRun();
  await queue.getCompaction("main-tab")?.done;
  assert.equal(runFinished, true);
  assert.equal(released, 1);
  assert.equal(queue.getCompaction("main-tab"), undefined);
});

test("non-loop compaction still waits before returning", async () => {
  let reserved = 0;
  let runFinished = false;

  await settleAutoCompactAfterPrompt({
    overlapLoopDispatch: false,
    canOverlap: () => true,
    run: async () => {
      runFinished = true;
    },
    reserve: () => {
      reserved += 1;
      return { adoptStop: () => {}, release: () => {} };
    },
    enqueue: () => assert.fail("普通会话压缩在本轮结束前完成"),
  });

  assert.equal(runFinished, true);
  assert.equal(reserved, 0);
});

test("occupied primary run keeps Loop main compaction serialized", async () => {
  let allowActiveRun: boolean | null = null;
  const queue = createLoopMainQuestionQueue();
  await settleAutoCompactAfterPrompt({
    overlapLoopDispatch: true,
    canOverlap: () => false,
    run: async (request) => {
      allowActiveRun = request.allowActiveRun;
    },
    reserve: () => {
      throw new Error("reservation should not be created while the primary run is busy");
    },
    enqueue: (run) => { void queue.runCompaction("main-tab", run); },
  });
  await queue.getCompaction("main-tab")?.done;
  assert.equal(allowActiveRun, false);
});

test("compact transcript merge keeps messages appended while compaction was running", () => {
  const live = [{ id: "decision" }, { id: "subtask-started" }];
  const snapshot = [{ id: "decision" }, { id: "compact-notice" }];
  const merged = mergeCompactTranscriptIntoLive(live, snapshot);
  assert.equal(merged, live);
  assert.deepEqual(merged.map((message) => message.id), ["decision", "subtask-started", "compact-notice"]);
});
