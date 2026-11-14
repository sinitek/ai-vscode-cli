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
  compactions.notify("task", "child", false);
  await compactions.wait("codex", "child-session");
  compactions.notify("task", "child", true);
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

test("classic Loop reports completion before background compaction and gates cross-tab continuation", { timeout: 2000 }, async () => {
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
    markSubtaskRunFinished: () => { events.push("reported"); },
    closeSubtaskTab: async () => { events.push("closed"); },
    logSubtaskTabAutoClosed: () => {},
  });
  await started.promise;
  assert.ok(events.indexOf("reported") < events.indexOf("compact"));
  assert.equal(events.includes("closed"), false);
  let continued = false;
  const continuation = withLoopSubtaskSession("codex", "child-session", async () => { continued = true; });
  await withLoopSubtaskSession("codex", "another-session", async () => {});
  assert.equal(continued, false);
  gate.resolve();
  await continuation;
  await loopSubtaskAutoCompactions.wait("codex", "child-session");
  assert.equal(continued, true);
  assert.deepEqual(events, ["reported", "compact", "closed"]);
});

test("压缩失败后仍关闭成功标签，关页结束前不放行同会话", async () => {
  const errors: unknown[] = [];
  const compactions = new LoopSubtaskAutoCompactions((error) => { errors.push(error); });
  const failure = new Error("压缩超时");
  const closing = createDeferred();
  const started = createDeferred();
  compactions.defer(input(), target(), async () => { throw failure; });
  compactions.notify("task", "child", true, async () => {
    started.resolve();
    await closing.promise;
  });
  await started.promise;
  let resumed = false;
  const waiter = compactions.wait("codex", "child-session").then(() => { resumed = true; });
  await Promise.resolve();
  assert.equal(resumed, false);
  assert.equal(compactions.has("codex", "child-session"), true);
  assert.deepEqual(errors, [failure]);
  closing.resolve();
  await waiter;
  assert.equal(resumed, true);
});

test("failed classic completion reporting cancels compaction and releases its session", async () => {
  const runInput = input({ loopTaskId: "failed-report" });
  await scheduleAutoCompactAfterPrompt(runInput, target(), async () => assert.fail("unreported work must not compact"));
  await assert.rejects(finalizeLoopSubtaskRun({ taskId: "failed-report", subtaskId: "child", round: 1, runStatus: "end", assistantContent: "已完成", tabId: null }, {
    markSubtaskRunFinished: () => { throw new Error("persist failed"); },
    closeSubtaskTab: async () => {},
    logSubtaskTabAutoClosed: () => {},
  }), /persist failed/);
  await loopSubtaskAutoCompactions.wait("codex", "child-session");
});

test("compactions sharing a session remain serialized even when notifications arrive out of order", async () => {
  const compactions = new LoopSubtaskAutoCompactions(() => assert.fail("unexpected failure"));
  const events: string[] = [];
  compactions.defer(input(), target(), async () => { events.push("first"); });
  compactions.defer(input({ loopSubtaskId: "second" }), target(), async () => { events.push("second"); });
  compactions.notify("task", "second", true);
  await Promise.resolve();
  assert.equal(events.length, 0);
  compactions.notify("task", "child", true);
  await compactions.wait("codex", "child-session");
  assert.deepEqual(events, ["first", "second"]);
});

test("subtask compaction retains the execution config, model and thinking snapshot", async () => {
  const selection = { configId: "child-profile", revision: "selected-revision" };
  const runInput = input({ loopTaskId: "snapshot-task", configSelections: { codex: selection }, model: "child-model", thinkingModeOverride: "high" });
  const options: unknown[] = [];
  await scheduleAutoCompactAfterPrompt(runInput, target(), async (request) => { options.push(request); });
  runInput.model = "new-model";
  loopSubtaskAutoCompactions.notify("snapshot-task", "child", true);
  await loopSubtaskAutoCompactions.wait("codex", "child-session");
  assert.deepEqual(options, [{ isolatedRun: true, execution: { configSelection: selection, model: "child-model", thinkingMode: "high" } }]);
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
