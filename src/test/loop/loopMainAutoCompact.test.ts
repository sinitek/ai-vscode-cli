import test = require("node:test");
import assert = require("node:assert/strict");

import {
  LoopMainAutoCompactFlights,
  mergeCompactTranscriptIntoLive,
  settleAutoCompactAfterPrompt,
  shouldOverlapLoopMainContextCompaction,
} from "../../loopMainAutoCompact";

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
  const flights = new LoopMainAutoCompactFlights();

  await settleAutoCompactAfterPrompt({
    overlapLoopDispatch: true,
    canOverlap: true,
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
    track: (flight) => {
      flights.track("main-tab", flight);
    },
  });

  assert.equal(runFinished, false);
  assert.equal(reserved, 1);
  assert.equal(released, 0);
  assert.equal(flights.has("main-tab"), true);
  await flights.wait("subtask-tab");
  assert.equal(runFinished, false);

  releaseRun();
  await flights.wait("main-tab");
  assert.equal(runFinished, true);
  assert.equal(released, 1);
  assert.equal(flights.has("main-tab"), false);
});

test("non-loop compaction still waits before returning", async () => {
  let reserved = 0;
  let runFinished = false;
  const flights = new LoopMainAutoCompactFlights();

  await settleAutoCompactAfterPrompt({
    overlapLoopDispatch: false,
    canOverlap: true,
    run: async () => {
      runFinished = true;
    },
    reserve: () => {
      reserved += 1;
      return { adoptStop: () => {}, release: () => {} };
    },
    track: (flight) => {
      flights.track("main-tab", flight);
    },
  });

  assert.equal(runFinished, true);
  assert.equal(reserved, 0);
  assert.equal(flights.has("main-tab"), false);
});

test("occupied primary run keeps Loop main compaction serialized", async () => {
  let allowActiveRun: boolean | null = null;
  await settleAutoCompactAfterPrompt({
    overlapLoopDispatch: true,
    canOverlap: false,
    run: async (request) => {
      allowActiveRun = request.allowActiveRun;
    },
    reserve: () => {
      throw new Error("reservation should not be created while the primary run is busy");
    },
    track: () => {
      throw new Error("busy compaction should not be tracked as an overlap");
    },
  });
  assert.equal(allowActiveRun, false);
});

test("compact transcript merge keeps messages appended while compaction was running", () => {
  const live = [{ id: "decision" }, { id: "subtask-started" }];
  const snapshot = [{ id: "decision" }, { id: "compact-notice" }];
  const merged = mergeCompactTranscriptIntoLive(live, snapshot);
  assert.equal(merged, live);
  assert.deepEqual(merged.map((message) => message.id), ["decision", "subtask-started", "compact-notice"]);
});
