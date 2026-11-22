import test = require("node:test");
import assert = require("node:assert/strict");
import { LoopSubtaskAutoCompactions, loopSubtaskAutoCompactions, scheduleAutoCompactAfterPrompt } from "../../loopSubtaskAutoCompact";
import { withLoopSubtaskSession } from "../../loopSubtaskSession";
import { finalizeLoopSubtaskRun } from "../../loopSubtaskLifecycle";
import type { PromptRunInput, PromptRunTarget } from "../../promptRunTypes";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function input(overrides: Partial<PromptRunInput> = {}): PromptRunInput {
  return { displayPrompt: "完成子任务", modelPrompt: "完成子任务", contextTags: [], taskRole: "subtask", loopTaskId: "task", loopSubtaskId: "child", ...overrides };
}

function target(overrides: Partial<PromptRunTarget> = {}): PromptRunTarget {
  return { cli: "codex", tabId: "child-tab", sessionId: "child-session", ...overrides };
}

test("subtask compaction starts only after reporting and does not block other sessions", { timeout: 2000 }, async () => {
  const events: string[] = [];
  const gate = createDeferred();
  const started = createDeferred();
  const compactions = new LoopSubtaskAutoCompactions(() => assert.fail("unexpected compaction failure"));
  assert.equal(compactions.defer(input(), target(), async () => {
    events.push("compact");
    started.resolve();
    await gate.promise;
  }), true);
  assert.equal(compactions.has("codex", "child-session"), true);
  assert.equal(compactions.has("codex", null), false);
  let resumed = false;
  const resume = compactions.wait("codex", "child-session").then(() => { resumed = true; });
  await compactions.wait("codex", "main-session");
  await compactions.wait("claude", "child-session");
  assert.equal(events.length, 0);
  assert.equal(resumed, false);

  events.push("reported");
  compactions.notify("task", "child", true);
  await started.promise;
  assert.deepEqual(events, ["reported", "compact"]);
  assert.equal(resumed, false);
  gate.resolve();
  await resume;
  assert.equal(resumed, true);
  assert.equal(compactions.has("codex", "child-session"), false);
});

test("failed or stopped reporting discards pending compaction and releases the session", async () => {
  const compactions = new LoopSubtaskAutoCompactions(() => assert.fail("unexpected compaction failure"));
  compactions.defer(input(), target(), async () => assert.fail("cancelled compaction must not run"));
  let closed = false;
  compactions.notify("task", "child", false, async () => { closed = true; });
  await compactions.wait("codex", "child-session");
  assert.equal(closed, false);
  compactions.notify("task", "child", true);
});

test("stale attempt notifications cannot consume its replacement, regardless of outcome", async () => {
  for (const staleOutcome of [true, false]) {
    const events: string[] = [];
    const compactions = new LoopSubtaskAutoCompactions(() => assert.fail("unexpected compaction failure"));
    const runInput = input({ loopAttemptId: "attempt-a" });
    compactions.defer(runInput, target(), async () => { events.push("A compact"); });
    runInput.loopAttemptId = "attempt-b";
    compactions.defer(runInput, target(), async () => { events.push("B compact"); });

    assert.equal(compactions.notify("task", "child", staleOutcome, async () => { events.push("stale callback"); }, "attempt-a"), undefined);
    assert.equal(compactions.notify("task", "child", true, async () => { events.push("missing callback"); }), undefined);
    assert.deepEqual(events, []);
    assert.equal(compactions.has("codex", "child-session"), true);

    let callbacks = 0;
    const flight = compactions.notify("task", "child", true, async () => { callbacks += 1; }, "attempt-b");
    assert.ok(flight);
    assert.equal(compactions.notify("task", "child", true, async () => { callbacks += 1; }, "attempt-b"), undefined);
    await flight;
    assert.deepEqual(events, ["B compact"]);
    assert.equal(callbacks, 1);
    assert.equal(compactions.has("codex", "child-session"), false);
  }
});

test("attempt identity is captured at defer time and mismatches do not cancel pending work", async () => {
  const events: string[] = [];
  const compactions = new LoopSubtaskAutoCompactions(() => assert.fail("unexpected compaction failure"));
  const runInput = input({ loopAttemptId: "captured-at-defer" });
  compactions.defer(runInput, target(), async () => { events.push("compact"); });
  runInput.loopAttemptId = "mutated-after-defer";
  assert.equal(compactions.notify("task", "child", false, undefined, "mutated-after-defer"), undefined);
  const flight = compactions.notify("task", "child", true, undefined, "captured-at-defer");
  assert.ok(flight);
  await flight;
  assert.deepEqual(events, ["compact"]);
});

test("identity-less notifications only retain compatibility with identity-less pending entries", async () => {
  const events: string[] = [];
  let legacyRan = false;
  const compactions = new LoopSubtaskAutoCompactions(() => assert.fail("unexpected compaction failure"));
  compactions.defer(input({ loopAttemptId: "modern" }), target(), async () => { events.push("modern"); });
  assert.equal(compactions.notify("task", "child", true), undefined);
  assert.deepEqual(events, []);
  const modern = compactions.notify("task", "child", true, undefined, "modern");
  assert.ok(modern);
  await modern;

  compactions.defer(input(), target(), async () => { legacyRan = true; });
  const legacy = compactions.notify("task", "child", true);
  assert.ok(legacy);
  await legacy;
  assert.deepEqual(events, ["modern"]);
  assert.equal(legacyRan, true);
});

test("compaction rejection is recorded without failing a completed subtask or its continuation", async () => {
  const errors: unknown[] = [];
  const compactions = new LoopSubtaskAutoCompactions((error) => { errors.push(error); });
  const failure = new Error("native compaction failed");
  compactions.defer(input(), target(), () => { throw failure; });
  compactions.notify("task", "child", true);
  await compactions.wait("codex", "child-session");
  assert.deepEqual(errors, [failure]);
});

test("missing subtask identity or session keeps the existing synchronous path", async () => {
  const compactions = new LoopSubtaskAutoCompactions(() => {});
  for (const runInput of [input({ taskRole: undefined }), input({ loopTaskId: " " }), input({ loopSubtaskId: undefined })]) {
    assert.equal(compactions.defer(runInput, target(), async () => {}), false);
  }
  assert.equal(compactions.defer(input(), target({ sessionId: null }), async () => {}), false);
  await compactions.wait("codex", null);
  const options: unknown[] = [];
  await scheduleAutoCompactAfterPrompt(input({ taskRole: "main" }), target(), async (request) => { options.push(request); });
  await scheduleAutoCompactAfterPrompt(input({ taskRole: undefined }), target(), async (request) => { options.push(request); });
  assert.deepEqual(options, [{ overlapLoopDispatch: true }, { overlapLoopDispatch: false }]);
});

test("classic Loop reports completion and closes the old tab before background compaction", { timeout: 2000 }, async () => {
  const events: string[] = [];
  const gate = createDeferred();
  const started = createDeferred();
  const runInput = input({ loopTaskId: "classic-report-first" });
  await scheduleAutoCompactAfterPrompt(runInput, target(), async (options) => {
    assert.deepEqual(options, { isolatedRun: true });
    events.push("compact");
    started.resolve();
    await gate.promise;
  });
  assert.equal(events.length, 0);
  await finalizeLoopSubtaskRun({ taskId: runInput.loopTaskId!, subtaskId: "child", round: 1, runStatus: "end", assistantContent: "已完成", tabId: "child-tab" }, {
    markSubtaskRunFinished: () => { events.push("reported"); return "committed"; },
    closeSubtaskTab: async () => { events.push("closed"); },
    logSubtaskTabAutoClosed: () => {},
  });
  await started.promise;
  assert.deepEqual(events, ["reported", "closed", "compact"]);
  let continued = false;
  const continuation = withLoopSubtaskSession("codex", "child-session", async () => { continued = true; });
  await withLoopSubtaskSession("codex", "another-session", async () => {});
  assert.equal(continued, false);
  gate.resolve();
  await continuation;
  await loopSubtaskAutoCompactions.wait("codex", "child-session");
  assert.equal(continued, true);
});

test("关页失败仍按顺序压缩，压缩失败不阻止同会话续接", async () => {
  const errors: unknown[] = [];
  const compactions = new LoopSubtaskAutoCompactions((error) => { errors.push(error); });
  const closeFailure = new Error("关页失败");
  const compactFailure = new Error("压缩超时");
  const closing = createDeferred();
  const started = createDeferred();
  compactions.defer(input(), target(), async () => { throw compactFailure; });
  compactions.notify("task", "child", true, async () => {
    started.resolve();
    await closing.promise;
    throw closeFailure;
  });
  await started.promise;
  let resumed = false;
  const waiter = compactions.wait("codex", "child-session").then(() => { resumed = true; });
  await Promise.resolve();
  assert.equal(resumed, false);
  assert.equal(compactions.has("codex", "child-session"), true);
  assert.deepEqual(errors, []);
  closing.resolve();
  await waiter;
  assert.equal(resumed, true);
  assert.deepEqual(errors, [closeFailure, compactFailure]);
});

test("failed classic completion reporting cancels compaction and releases its session", async () => {
  const runInput = input({ loopTaskId: "failed-report" });
  await scheduleAutoCompactAfterPrompt(runInput, target(), async () => assert.fail("unreported work must not compact"));
  let closed = false;
  await assert.rejects(finalizeLoopSubtaskRun({ taskId: "failed-report", subtaskId: "child", round: 1, runStatus: "end", assistantContent: "已完成", tabId: "child-tab" }, {
    markSubtaskRunFinished: () => { throw new Error("persist failed"); },
    closeSubtaskTab: async () => { closed = true; },
    logSubtaskTabAutoClosed: () => {},
  }), /persist failed/);
  await loopSubtaskAutoCompactions.wait("codex", "child-session");
  assert.equal(closed, false);
});

test("unconfirmed or skipped classic completion retains its tab and cancels compaction", async () => {
  for (const report of ["unconfirmed", "skipped"] as const) {
    const runInput = input({ loopTaskId: `not-committed-${report}` });
    await scheduleAutoCompactAfterPrompt(runInput, target(), async () => assert.fail("uncommitted work must not compact"));
    const events: string[] = [];
    await finalizeLoopSubtaskRun({ taskId: runInput.loopTaskId!, subtaskId: "child", round: 1, runStatus: "end", assistantContent: "done", tabId: "child-tab" }, {
      markSubtaskRunFinished: () => report,
      closeSubtaskTab: async () => { events.push("closed"); },
      logSubtaskTabAutoClosed: () => events.push("logged"),
    });
    await loopSubtaskAutoCompactions.wait("codex", "child-session");
    assert.deepEqual(events, []);
  }
});

test("same-session compactions stay serialized without delaying a notified tab close", async () => {
  const compactions = new LoopSubtaskAutoCompactions(() => assert.fail("unexpected failure"));
  const events: string[] = [];
  const first = createDeferred();
  const firstStarted = createDeferred();
  const secondClosed = createDeferred();
  compactions.defer(input(), target(), async () => {
    events.push("first");
    firstStarted.resolve();
    await first.promise;
  });
  compactions.notify("task", "child", true);
  await firstStarted.promise;
  compactions.defer(input({ loopSubtaskId: "second" }), target(), async () => { events.push("second"); });
  compactions.notify("task", "second", true, async () => {
    events.push("closed second");
    secondClosed.resolve();
  });
  await secondClosed.promise;
  assert.deepEqual(events, ["first", "closed second"]);
  first.resolve();
  await compactions.wait("codex", "child-session");
  assert.deepEqual(events, ["first", "closed second", "second"]);
});

test("same-session replacement waits for canceled predecessor while an independent session proceeds", async () => {
  const compactions = new LoopSubtaskAutoCompactions(() => assert.fail("unexpected failure"));
  const firstStarted = createDeferred();
  const releaseFirst = createDeferred();
  const events: string[] = [];
  compactions.defer(input({ loopSubtaskId: "first", loopAttemptId: "first-attempt" }), target(), async () => {
    events.push("first");
    firstStarted.resolve();
    await releaseFirst.promise;
  });
  const secondInput = input({ loopSubtaskId: "second", loopAttemptId: "second-attempt" });
  compactions.defer(secondInput, target(), async () => { events.push("second"); });
  compactions.notify("task", "first", true, undefined, "first-attempt");
  await firstStarted.promise;
  const secondFlight = compactions.notify("task", "second", true, undefined, "second-attempt");
  assert.ok(secondFlight);
  compactions.defer(input({ loopTaskId: "other", loopAttemptId: "other-attempt" }), target({ sessionId: "other-session" }), async () => { events.push("other"); });
  const independent = compactions.notify("other", "child", true, undefined, "other-attempt");
  assert.ok(independent);
  await independent;
  assert.deepEqual(events, ["first", "other"]);
  releaseFirst.resolve();
  await secondFlight;
  assert.deepEqual(events, ["first", "other", "second"]);
});

test("subtask compaction reads the current runtime config instead of retaining a selection snapshot", async () => {
  const runInput = input({ loopTaskId: "snapshot-task", model: "child-model", thinkingModeOverride: "high" });
  const options: unknown[] = [];
  await scheduleAutoCompactAfterPrompt(runInput, target(), async (request) => { options.push(request); });
  runInput.model = "new-model";
  loopSubtaskAutoCompactions.notify("snapshot-task", "child", true);
  await loopSubtaskAutoCompactions.wait("codex", "child-session");
  assert.deepEqual(options, [{ isolatedRun: true }]);
});

test("late compaction rejection logs its original subtask and session without failing a waiting continuation", async (t) => {
  const logger = require("../../logger") as typeof import("../../logger");
  const logs: Array<{ event: string; data: unknown }> = [];
  t.mock.method(logger, "logError", async (event: string, data: unknown) => { logs.push({ event, data }); });
  const gate = createDeferred();
  const started = createDeferred();
  const runInput = input({ loopTaskId: "late-attribution" });
  const runTarget = target({ sessionId: "late-attribution-session" });
  const failure = Object.assign(new Error("controlled handoff failure"), { code: "CODEX_THREAD_HANDOFF_FAILED" });
  await scheduleAutoCompactAfterPrompt(runInput, runTarget, async () => {
    started.resolve();
    await gate.promise;
    throw failure;
  });
  loopSubtaskAutoCompactions.notify("late-attribution", "child", true);
  await started.promise;
  runInput.loopSubtaskId = "new-child";
  runTarget.tabId = "new-tab";
  runTarget.sessionId = "new-session";
  let continued = false;
  const continuation = withLoopSubtaskSession("codex", "late-attribution-session", async () => { continued = true; });
  await withLoopSubtaskSession("codex", "independent-session", async () => {});
  assert.equal(continued, false);
  gate.resolve();
  await continuation;
  assert.equal(continued, true);
  assert.equal(loopSubtaskAutoCompactions.has("codex", "late-attribution-session"), false);
  assert.deepEqual(logs, [{ event: "loop-subtask-auto-compact-failed", data: {
    activity: "contextCompaction", taskId: "late-attribution", subtaskId: "child", cli: "codex",
    tabId: "child-tab", sessionId: "late-attribution-session",
    error: failure.message, errorCode: failure.code,
  } }]);
});
