import { withLoopBlockerFixture } from "../loopBlockerFixture";
import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("fs");
import path = require("path");
import vm = require("node:vm");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createLoopSubtaskExecutionRoot, resolveGrokLoopExecutionCwd } = require("../../loopSubtaskExecutionRoot") as typeof import("../../loopSubtaskExecutionRoot");
const { schedulingModeForInteractiveMode } = require("../../extensionHost/modelSettings") as typeof import("../../extensionHost/modelSettings");
const { createLoopPlusScheduler } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
const { buildLoopPlusFinishEventId } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
const {
  createLoopPlusRuntimeFixture,
  createLoopPlusExtensionStopHarness,
  waitForLoopPlus,
} = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const {
  selectLoopPlusContinuationDetail,
  selectLoopPlusInvocationAssistant,
  selectLoopPlusInvocationRun,
} = require("../../extensionHost/loopPlusRuntimeAdapter") as typeof import("../../extensionHost/loopPlusRuntimeAdapter");
const { buildLoopGroupChatPanelState, createLoopGroupChatPanelCoordinator } = require("../../extensionHost/loopGroupChatPanelCoordinator") as typeof import("../../extensionHost/loopGroupChatPanelCoordinator");
const { buildLoopGroupChatPanelHtml } = require("../../webview/loopGroupChatPanel") as typeof import("../../webview/loopGroupChatPanel");

import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
import { withLoopSubtaskSession } from "../../loopSubtaskSession";
import { loopSubtaskAutoCompactions } from "../../loopSubtaskAutoCompact";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import type { LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import { normalizeLoopTaskRecord, type LoopTaskRecord } from "../../loopTaskStore";
import { isLoopTaskPromptResumeCandidate } from "../../loopTaskMessagePolicy";
import { LOOP_MAIN_AI_FAILURE_LIMIT } from "../../loopMainFailure";
import { RUNTIME_CONFIG_LOCK_TIMEOUT, RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE } from "../../loopMainFailure";
import { assertModeAvailable } from "../../modeAvailability";
import { loopClarificationScope } from "../../orchestratorClarification";
import * as logger from "../../logger";
import { createPerformanceTrace, type PerformanceEntry } from "../../performanceLog";

function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createMemoryTaskPersistence() {
  const records = new Map<string, LoopTaskRecord>();
  return {
    create: (task: LoopTaskRecord) => { records.set(task.id, task); return task; },
    read: (taskId: string) => records.get(taskId) ?? null,
    save: (task: LoopTaskRecord) => { records.set(task.id, task); },
    remove: (taskId: string) => { records.delete(taskId); },
  };
}

test("injected task persistence remains the single task source across remove failures and saves", () => {
  const records = new Map<string, LoopTaskRecord>();
  let refuseRemoval = false;
  const fixture = createLoopPlusRuntimeFixture({ taskPersistence: {
    create: (task) => { records.set(task.id, task); return task; },
    read: (taskId) => records.get(taskId) ?? null,
    save: (task) => { records.set(task.id, task); },
    remove: (taskId) => { if (refuseRemoval) return false; records.delete(taskId); return true; },
  } });
  try {
    const task = { id: "persisted", cli: "codex", workspaceKey: "workspace", taskStoreFile: fixture.storeFile,
      rootPrompt: "task", schedulingMode: "event_driven" as const, status: "stopped" as const, createdAt: Date.now(), updatedAt: Date.now(),
      maxRounds: 2, currentRound: 0, communicationDir: fixture.rootDir, mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
      subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [] } as LoopTaskRecord;
    fixture.saveTask(task);
    assert.equal(fixture.readTask(task.id)?.id, task.id);

    refuseRemoval = true;
    assert.throws(() => fixture.removeTask(task.id), /refused removal/);
    assert.equal(fixture.readTask(task.id)?.id, task.id, "a rejected durable delete must remain readable");
    assert.equal(records.get(task.id)?.id, task.id);

    refuseRemoval = false;
    fixture.removeTask(task.id);
    assert.equal(fixture.readTask(task.id), null);
    assert.equal(records.has(task.id), false, "successful delete must update the injected source");
    fixture.saveTask({ ...task, status: "running" });
    assert.equal(fixture.readTask(task.id)?.status, "running", "a later successful save restores visibility");
  } finally { fixture.dispose(); }

  const missed = createLoopPlusRuntimeFixture({ taskPersistence: {
    create: (task) => task, read: () => null, save: () => undefined, remove: () => undefined,
  } });
  try {
    const task = { id: "map-only", cli: "codex", workspaceKey: "workspace", taskStoreFile: missed.storeFile,
      rootPrompt: "task", schedulingMode: "event_driven" as const, status: "stopped" as const, createdAt: Date.now(), updatedAt: Date.now(),
      maxRounds: 2, currentRound: 0, communicationDir: missed.rootDir, mainCommunicationFile: path.join(missed.rootDir, "main.md"),
      subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [] } as LoopTaskRecord;
    missed.saveTask(task);
    assert.equal(missed.readTask(task.id), null, "an injected source miss must not fall back to the fixture Map");
  } finally { missed.dispose(); }
});


function longPrompt(id: string, file: string): string {
  return `Implement ${id} without editing the parent task record or scheduler snapshot. Write scope: ${file}. Report only the attempt result.`;
}

function decision(value: unknown): string {
  const enriched = withLoopPlusAcceptReviews(withLoopBlockerFixture(value));
  if (enriched && typeof enriched === "object" && !Array.isArray(enriched)
    && (enriched as { status?: unknown }).status === "accept"
    && !Object.prototype.hasOwnProperty.call(enriched, "progressPercent")) {
    return JSON.stringify({ ...enriched, progressPercent: 23 });
  }
  return JSON.stringify(enriched);
}

function subtask(id: string, file: string, conflictGroup?: string) {
  return {
    id,
    title: id,
    prompt: longPrompt(id, file),
    writeFiles: [file],
    taskType: "backend" as const,
    ...(conflictGroup ? { conflictGroup } : {}),
  };
}

function completedDecision(reviewEventId?: string | null): string {
  return decision({
    status: "completed",
    ...(reviewEventId ? { reviewEventId } : {}),
    answerConclusion: "finished",
    finalSummary: "everything passed",
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    requirementCoverage: [{ name: "scope", passed: true }],
  });
}

test("父任务停止能结束来源会话等待，保留停止事件且不启动 CLI", { timeout: 3000 }, async () => {
  const statuses: string[] = [];
  const fixture = createLoopPlusRuntimeFixture({ onSubtaskPreparationFailed: (_tabId, status) => { statuses.push(status); } });
  let release!: () => void;
  let previous: Promise<void> | undefined;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    fixture.queueMain(async (input, tabId) => {
      previous = withLoopSubtaskSession("codex", null, () => hold, {
        taskId: input.loopTaskId!, subtaskId: "waiting-child",
      });
      fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "dispatch", subtasks: [subtask("waiting-child", "src/a.ts")] }),
      });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.createdSubtaskTargets.length === 1, "attempt waiting for source lease");
    const taskId = fixture.mainCalls[0].loopTaskId!;
    assert.equal(fixture.attemptCalls.length, 0);
    fixture.adapter.host().stopParent(taskId);
    await running;
    await waitForLoopPlus(() => createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)?.loopPlus }).snapshot().running.length === 0, "cancelled reservation settled");
    const snapshot = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot();
    assert.equal(snapshot.parentStopped, true);
    assert.equal(snapshot.reviewQueue.length, 1);
    assert.equal(snapshot.reviewQueue[0].outcome, "stopped");
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(fixture.attemptCalls.length, 0);
    assert.deepEqual(statuses, ["stopped"]);
    release();
    await previous;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.attemptCalls.length, 0);
  } finally {
    release();
    await previous;
    fixture.dispose();
  }
});

test("子任务尚无 CLI 且启动准备未返回时，停止后仍能继续主任务，迟到准备不会再启动", { timeout: 3000 }, async () => {
  let release!: () => void;
  let preparing = false;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const fixture = createLoopPlusRuntimeFixture({ beforeRun: async (input) => {
    if (input.taskRole === "subtask") { preparing = true; await hold; }
  } });
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "dispatch", subtasks: [subtask("unstarted", "src/a.ts")] }),
      });
    });
    const first = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => preparing, "invocation preparation");
    const taskId = fixture.mainCalls[0].loopTaskId!;
    fixture.adapter.host().stopParent(taskId);
    await first;
    await waitForLoopPlus(() => createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)?.loopPlus }).snapshot().running.length === 0, "preparation cancelled");
    fixture.queueMain(async (input, tabId) => {
      assert.match(input.displayPrompt, /Prompt kind: review/);
      fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "accept", reviewEventId: currentEventId(input.displayPrompt), subtasks: [],
          reviews: [{ reviewEventId: currentEventId(input.displayPrompt), acceptance: "failed", reason: "启动准备已取消",
            noRepairReason: "该停止 attempt 无代码产出需要修复" }] }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "blocked", finalSummary: "未启动的交付仍需主任务后续处理" }) });
    });
    await fixture.adapter.runEventDriven(prompt("继续"), { resumeTaskId: taskId, resumeRequested: true }, fixture.target);
    assert.equal(fixture.readTask(taskId)?.status, "needs-review");
    assert.equal(fixture.hostMessages.includes("loop-plus-resume-blocked"), false);
    assert.equal(fixture.attemptCalls.length, 0);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.attemptCalls.length, 0);
    assert.equal(fixture.completionSubscriptionCount(), 0);
  } finally {
    release();
    await new Promise((resolve) => setImmediate(resolve));
    fixture.dispose();
  }
});

test("等待后台压缩的 attempt 可取消，原压缩与后续会话保护继续有效", { timeout: 3000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile" });
  const taskId = "cancel-compaction-parent";
  const sessionId = "cancel-compaction-session";
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    fixture.saveTask({
      id: taskId, cli: "codex", rootPrompt: "继续", status: "running", createdAt: Date.now(), updatedAt: Date.now(),
      workspaceKey: "workspace", taskStoreFile: fixture.storeFile, sessionId: fixture.target.sessionId,
      communicationDir: fixture.rootDir, mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
      completionRoundSummaries: [], completionRequirementCoverage: [],
      maxRounds: 20, currentRound: 1, rounds: [], activeSubtaskId: null,
      subTasks: [{ id: "source", title: "来源", status: "completed", executionSession: { cli: "codex", configId: "profile", sessionId } }],
    });
    loopSubtaskAutoCompactions.defer({
      ...prompt(), taskRole: "subtask", loopTaskId: taskId, loopSubtaskId: "source",
    }, { cli: "codex", tabId: "source-tab", sessionId }, () => hold);
    loopSubtaskAutoCompactions.notify(taskId, "source", true);
    assert.equal(fixture.readTask(taskId)?.subTasks[0]?.executionSession?.sessionId, sessionId);
    const attempt = fixture.adapter.startAttempt({
      taskId, subtaskId: "follow-up", continueFromSubtaskId: "source", attemptId: "follow-up-1", title: "续接",
      prompt: longPrompt("follow-up", "src/a.ts"), modelPrompt: "model", writeFiles: ["src/a.ts"], round: 1, targetCli: "codex",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.attemptCalls.length, 0);
    attempt.abort();
    assert.equal((await attempt.promise).outcome, "stopped");
    assert.equal(loopSubtaskAutoCompactions.has("codex", sessionId), true);
    assert.equal(fixture.attemptCalls.length, 0);
    release();
    await loopSubtaskAutoCompactions.wait("codex", sessionId);
    assert.equal(fixture.attemptCalls.length, 0);
  } finally {
    release();
    loopSubtaskAutoCompactions.notify(taskId, "source", false);
    await loopSubtaskAutoCompactions.wait("codex", sessionId);
    fixture.dispose();
  }
});

test("冷启动后子任务完成重建编排并经真实适配器验收至父任务完成", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  const taskId = "cold-manual-completion";
  try {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
    scheduler.dispatch([{ subtaskId: "A", attemptId: "A-1", writeFiles: ["src/a.ts"] }]);
    const communicationFile = path.join(fixture.rootDir, "a-report.md");
    fs.writeFileSync(communicationFile, "子任务恢复后完成，验证证据已记录。\n");
    fixture.saveTask({
      id: taskId, cli: "codex", workspaceKey: "workspace", taskStoreFile: fixture.storeFile,
      rootPrompt: "实现并验收功能", schedulingMode: "event_driven", loopPlus: scheduler.snapshot(),
      status: "stopped", runtimeInterrupted: true, createdAt: Date.now(), updatedAt: Date.now(),
      maxRounds: 20, currentRound: 1, sessionId: fixture.target.sessionId,
      communicationDir: fixture.rootDir, mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
      activeSubtaskId: "A", activeSubtaskIds: ["A"],
      subTasks: [{ id: "A", title: "功能实现", status: "blocked", communicationFile }],
      rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
      modelRouting: { main: { model: "original-main" }, subtask: { model: "original-sub" } },
      originProfile: { configId: "original-config", mainThinkingMode: "high" },
    });
    fixture.queueMain((input, tabId) => {
      assert.equal(input.loopTaskId, taskId);
      assert.equal(input.loopMainModel, "original-main");
      assert.equal(input.loopMainThinkingMode, "high");
      assert.match(input.displayPrompt, /恢复后实现完成/);
      fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
    });
    const host = fixture.adapter.host();
    assert.equal(host.hasController(taskId), false);
    assert.equal(host.notifySubtaskContinuation(taskId, "A", "completed", "旧 attempt 的迟到续接", {
      target: fixture.target, input: { displayPrompt: "实现并验收功能" },
    }, undefined, "A-previous"), false);
    assert.equal(fixture.readTask(taskId)?.status, "stopped");
    assert.equal(fixture.mainCalls.length, 0);
    assert.equal(host.notifySubtaskContinuation(taskId, "A", "completed", "恢复后实现完成", {
      target: fixture.target, input: { displayPrompt: "实现并验收功能" },
    }, undefined, "A-1"), true);
    await waitForLoopPlus(() => fixture.readTask(taskId)?.status === "completed", "恢复后的父任务完成验收");
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(fixture.attemptCalls.length, 0);
    assert.equal(fixture.readTask(taskId)?.subTasks[0].status, "completed");
    assert.match(fs.readFileSync(communicationFile, "utf8"), /attempt: A-1[\s\S]*恢复后实现完成/);
    assert.equal(fixture.completionMessages.length, 1);
    assert.equal(host.hasController(taskId), false);
    assert.deepEqual(host.collectRunningTaskIds(), []);
  } finally {
    fixture.dispose();
  }
});


function currentEventId(promptText: string): string {
  const match = promptText.match(/Current review eventId: (\S+)/);
  if (!match || match[1] === "(none)") {
    throw new Error("missing current review event id");
  }
  return match[1];
}

test("Loop+ 在原主任务中修复验收 JSON，不重复执行已完成子任务", { timeout: 3000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    let taskId = "";
    let eventId = "";
    fixture.queueMain((input, tabId) => {
      taskId = input.loopTaskId!;
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
    });
    fixture.setAttemptAction((input, tabId) => fixture.publish(input, tabId, { status: "end", content: "实现完成" }));
    fixture.queueMain((input, tabId) => {
      eventId = currentEventId(input.modelPrompt);
      fixture.publish(input, tabId, { status: "end", content: '{"status":"completed",' });
    });
    fixture.queueMain((input, tabId) => {
      assert.equal(input.loopTaskId, taskId);
      assert.equal(tabId, fixture.target.tabId);
      assert.equal(currentEventId(input.modelPrompt), eventId);
      assert.match(input.modelPrompt, /Loop\+ 继续执行/);
      assert.match(input.modelPrompt, /^上一次决策被拒绝。拒绝类别：format。原因码：format\.PropertyNameExpected$/m);
      assert.equal(fixture.attemptCalls.length, 1);
      const completed = completedDecision(eventId).slice(1, -1);
      fixture.publish(input, tabId, { status: "end", content: ["```jsonc", `{/* 实际验收结论 */${completed},}`, "```"].join("\n") });
    });
    await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    assert.equal(fixture.readTask(taskId)?.status, "completed");
    assert.equal(fixture.mainCalls.length, 3);
    assert.equal(fixture.attemptCalls.length, 1);
  } finally {
    fixture.dispose();
  }
});

test("本次完成记录从共享历史丢失后仍进入验收并自动关闭子任务 Tab", async () => {
  const fixture = createLoopPlusRuntimeFixture({ readRuns: () => [] });
  let taskId = "";
  try {
    fixture.queueMain((input, tabId) => {
      taskId = input.loopTaskId!;
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
    });
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
    });
    fixture.setAttemptAction((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "执行报告已写入本轮报告，其中列出了修改文件、检查命令和未覆盖边界。" });
    });
    await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    assert.equal(fixture.readTask(taskId)?.status, "completed");
    assert.equal(fixture.readTask(taskId)?.subTasks[0].status, "completed");
    await waitForLoopPlus(() => fixture.closedSubtaskTabs.includes(fixture.createdSubtaskTargets[0].tabId), "成功回报后关闭子任务标签");
    assert.deepEqual(fixture.closedSubtaskTabs, [fixture.createdSubtaskTargets[0].tabId]);
    assert.equal(fixture.completionSubscriptionCount(), 0);
  } finally {
    fixture.dispose();
  }
});

test("authoritative main final is validated on its first call when the chat projection is absent", async () => {
  const runs: import("../../promptRunState").TaskRunRecord[] = [];
  let invocationCount = 0;
  const terminal = decision({ status: "completed", answerConclusion: "first terminal", finalSummary: "validated without retry",
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "scope", passed: true }] });
  const fixture = createLoopPlusRuntimeFixture({ readRuns: () => runs, runPromptOverride: async (input) => {
    invocationCount += 1;
    const runId = "main-terminal-call";
    const startedAt = Date.now();
    const handoff = input.loopPlusFinalAssistantHandoff;
    assert.equal(input.taskRole, "main");
    assert.ok(handoff);
    runs.push({ id: runId, cli: "codex", sessionId: fixture.target.sessionId, prompt: input.displayPrompt,
      startedAt, endedAt: startedAt + 1, durationMs: 1, status: "end", taskRole: "main",
      loopTaskId: input.loopTaskId, loopRound: input.loopRound, loopAttemptId: input.loopAttemptId });
    handoff({ runId, sessionId: fixture.target.sessionId, taskId: input.loopTaskId!, round: input.loopRound!,
      role: "main", attemptId: input.loopAttemptId, content: terminal });
  } });
  try {
    assert.equal(await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target), true);
    assert.equal(invocationCount, 1);
    assert.equal(fixture.readTask(fixture.createdTaskIds[0])?.status, "completed");
    assert.equal(fixture.getMessages(fixture.target.tabId).some((message) => message.role === "assistant"), false);
  } finally {
    fixture.dispose();
  }
});

test("Loop+ invocation diagnostics distinguish evidenced exit and transport failures without raw errors", async () => {
  const unexpected = require("../../interactive/codexRunner").CodexUnexpectedTurnExitError as new (message: string, threadId: string) => Error;
  const cases: Array<{ error: Error; expected: string }> = [
    { error: new unexpected("private detail", "private-session"), expected: "early-exit" },
    { error: Object.assign(new Error("private detail"), { code: "ECONNRESET" }), expected: "transport-interrupted" },
    { error: new Error("private detail"), expected: "unknown" },
  ];
  for (const [index, item] of cases.entries()) {
    const fixture = createLoopPlusRuntimeFixture({ runPromptOverride: async () => { throw item.error; } });
    try {
      await assert.rejects(fixture.adapter.runMain({ taskId: `diagnostic-${index}`, kind: "review",
        prompt: "controlled", modelPrompt: "controlled", reviewEventId: `event-${index}`, target: fixture.target }).promise);
      const diagnostic = fixture.logs.find((entry) => entry.event === "loop-plus-invocation-diagnostic");
      assert.deepEqual(diagnostic?.detail, { stage: "execution", code: item.expected });
      assert.equal(JSON.stringify(diagnostic).includes("private detail"), false);
      assert.equal(JSON.stringify(diagnostic).includes("private-session"), false);
    } finally {
      fixture.dispose();
    }
  }
});

test("Loop+ rejects an otherwise complete terminal bound to another session", async () => {
  const runs: import("../../promptRunState").TaskRunRecord[] = [];
  const fixture = createLoopPlusRuntimeFixture({ readRuns: () => runs, runPromptOverride: async (input) => {
    const runId = "session-bound-call";
    const startedAt = Date.now();
    runs.push({ id: runId, cli: "codex", sessionId: fixture.target.sessionId, prompt: input.displayPrompt,
      startedAt, endedAt: startedAt + 1, durationMs: 1, status: "end", taskRole: "main",
      loopTaskId: input.loopTaskId, loopRound: input.loopRound, loopAttemptId: input.loopAttemptId });
    input.loopPlusFinalAssistantHandoff?.({ runId, sessionId: "unrelated-session", taskId: input.loopTaskId!,
      round: input.loopRound!, role: "main", attemptId: input.loopAttemptId, content: "must not be accepted" });
  } });
  try {
    const result = await fixture.adapter.runMain({ taskId: "session-bound-task", kind: "review", prompt: "controlled",
      modelPrompt: "controlled", reviewEventId: "session-bound-review", target: fixture.target }).promise;
    assert.equal(result, null);
    assert.ok(fixture.logs.some((entry) => entry.event === "loop-plus-invocation-diagnostic"
      && (entry.detail as { code?: string }).code === "identity-rejected"));
  } finally {
    fixture.dispose();
  }
});

test("Loop+ never falls back to ordinary assistant projection after observing an unbound native terminal", async () => {
  for (const mismatch of [false, true]) {
    const fixture = createLoopPlusRuntimeFixture();
    try {
      fixture.queueMain((input, tabId) => {
        input.loopPlusNativeFinalObserved?.();
        if (mismatch) input.loopPlusFinalAssistantHandoff?.({ runId: "wrong-run", sessionId: "wrong-session",
          taskId: input.loopTaskId!, round: input.loopRound!, role: "main", attemptId: input.loopAttemptId,
          content: "mismatched terminal content" });
        fixture.publish(input, tabId, {
          status: "end",
          content: decision({ status: "completed", finalSummary: "ordinary assistant text is not terminal proof" }),
        });
      });
      const result = await fixture.adapter.runMain({ taskId: "native-terminal-gap", kind: "review",
        prompt: "controlled", modelPrompt: "controlled", reviewEventId: "native-terminal-review", target: fixture.target }).promise;
      assert.equal(result, null);
      assert.equal(fixture.mainCalls.length, 1);
      assert.ok(fixture.logs.some((entry) => entry.event === "loop-plus-invocation-diagnostic"
        && (entry.detail as { stage?: string; code?: string }).stage === "projection"
        && (entry.detail as { code?: string }).code === "terminal-content-unknown"));
    } finally {
      fixture.dispose();
    }
  }
});

test("Loop+ records main-turn and attempt lifecycle performance stages", async (context) => {
  const entries: PerformanceEntry[] = [];
  context.mock.method(logger, "writePerformanceLog", async (entry: PerformanceEntry) => {
    entries.push(entry);
  });
  const fixture = createLoopPlusRuntimeFixture({
    createPerformanceTrace,
    acquireAttemptExecution: async () => ({ release: () => undefined }),
  });
  let taskId = "";
  try {
    fixture.queueMain((input, tabId) => {
      taskId = input.loopTaskId!;
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
    });
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
    });
    fixture.setAttemptAction((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "执行已完成" });
    });
    await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(fixture.readTask(taskId)?.status, "completed");
    assert.deepEqual(new Set(entries.map((entry) => entry.phase)), new Set([
      "main-turn", "attempt", "attempt-admission", "attempt-execution", "attempt-cleanup",
    ]));
    assert.ok(entries.every((entry) => entry.mode === "loop_plus" && entry.durationMs >= 0));
  } finally {
    fixture.dispose();
  }
});

test("Loop+ passes a returned CLI failure into review and preserves it in the confirmed blocker", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  const failure = "department-interactive-session-conflict";
  const incompleteOutput = "PARTIAL_OUTPUT_IS_NOT_A_CLI_ERROR";
  let taskId = "";
  try {
    fixture.queueMain((input, tabId) => {
      taskId = input.loopTaskId ?? "";
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
    });
    fixture.setAttemptAction((input, tabId) => {
      fixture.publish(input, tabId, { status: "error", content: incompleteOutput, failureDetail: `${failure}: token=synthetic-fixture-value` });
    });
    fixture.queueMain((input, tabId) => {
      assert.match(input.modelPrompt, /outcome=failed detail=department-interactive-session-conflict/);
      assert.doesNotMatch(input.modelPrompt, /PARTIAL_OUTPUT_IS_NOT_A_CLI_ERROR|synthetic-fixture-value/);
      fixture.publish(input, tabId, { status: "end", content: decision({
        status: "accept", reviewEventId: currentEventId(input.displayPrompt), subtasks: [],
        reviews: [{ reviewEventId: currentEventId(input.displayPrompt), acceptance: "failed", subtaskIds: [],
          noRepairReason: "需要用户恢复外部会话，当前无代码修复" }],
      }) });
    });
    for (const boundedReview of [false, true]) {
      fixture.queueMain((input, tabId) => {
        assert.equal(input.modelPrompt.includes("Bounded blocked review"), boundedReview);
        assert.match(input.modelPrompt, /Unresolved subtask execution failures recorded by the host/);
        assert.match(input.modelPrompt, /department-interactive-session-conflict/);
        fixture.publish(input, tabId, { status: "end", content: decision({ status: "blocked", finalSummary: "需要人工恢复" }) });
      });
    }
    await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    const task = fixture.readTask(taskId);
    assert.equal(task?.status, "needs-review");
    assert.match(task?.finalSummary ?? "", /A：department-interactive-session-conflict: token=\[redacted\]/);
    assert.doesNotMatch(task?.finalSummary ?? "", /synthetic-fixture-value|PARTIAL_OUTPUT_IS_NOT_A_CLI_ERROR/);
    const report = fs.readFileSync(task?.subTasks[0]?.communicationFile ?? "", "utf8");
    assert.match(report, /department-interactive-session-conflict: token=\[redacted\]/);
    assert.doesNotMatch(report, /synthetic-fixture-value|PARTIAL_OUTPUT_IS_NOT_A_CLI_ERROR/);
    assert.equal(fixture.attemptCalls.length, 1);
  } finally {
    fixture.dispose();
  }
});

test("Loop+ does not reuse a CLI failure after the same subtask succeeds on a new attempt", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  let taskId = "";
  try {
    fixture.queueMain((input, tabId) => {
      taskId = input.loopTaskId ?? "";
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
    });
    fixture.setAttemptAction((input, tabId) => {
      fixture.publish(input, tabId, fixture.attemptCalls.length === 1
        ? { status: "error", failureDetail: "CLI_CONFIG_DENIED" }
        : { status: "end", content: "本次执行成功" });
    });
    fixture.queueMain((input, tabId) => {
      const reviewEventId = currentEventId(input.displayPrompt);
      assert.match(input.modelPrompt, /CLI_CONFIG_DENIED/);
      fixture.publish(input, tabId, { status: "end", content: decision({
        status: "accept", reviewEventId, subtasks: [subtask("A", "src/a.ts")],
        reviews: [{ reviewEventId, acceptance: "failed", subtaskIds: ["A"] }],
      }) });
    });
    fixture.queueMain((input, tabId) => {
      assert.doesNotMatch(input.modelPrompt, /CLI_CONFIG_DENIED/);
      fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
    });
    await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    assert.equal(fixture.attemptCalls.length, 2);
    assert.equal(fixture.readTask(taskId)?.status, "completed");
    assert.equal(fixture.readTask(taskId)?.subTasks[0]?.executionFailure, undefined);
  } finally {
    fixture.dispose();
  }
});

for (const status of ["end", "error", "stopped", null] as const) {
  test(`共享历史缺失时只按本次真实完成状态 ${status} 决定是否关页`, async () => {
    const fixture = createLoopPlusRuntimeFixture({ readRuns: () => [] });
    try {
      fixture.setAttemptAction((input, tabId) => {
        fixture.publish(input, tabId, { status, content: "任务已完成，执行报告已写入本轮报告。" });
      });
      const handle = fixture.adapter.startAttempt({
        taskId: "task-main", subtaskId: "A", attemptId: "attempt-A", title: "A",
        prompt: longPrompt("A", "src/a.ts"), modelPrompt: "model", writeFiles: ["src/a.ts"], round: 1, targetCli: "codex",
      });
      const result = await handle.promise;
      assert.equal(fixture.closedSubtaskTabs.length, 0);
      if (result.outcome === "completed") await handle.onCompleted?.();
      assert.equal(result.outcome, status === "end" ? "completed" : status === "stopped" ? "stopped" : "failed");
      assert.equal(fixture.closedSubtaskTabs.length, status === "end" ? 1 : 0);
      assert.equal(fixture.completionSubscriptionCount(), 0);
    } finally {
      fixture.dispose();
    }
  });
}

test("completion subscription and history scan both reject a run owned by another attempt", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.setAttemptAction((input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: "stale attempt result",
        attemptId: "attempt-old",
      });
    });
    const handle = fixture.adapter.startAttempt({
      taskId: "task-main", subtaskId: "A", attemptId: "attempt-current", title: "A",
      prompt: longPrompt("A", "src/a.ts"), modelPrompt: "model", writeFiles: ["src/a.ts"], round: 1, targetCli: "codex",
    });
    const result = await handle.promise;
    assert.equal(result.outcome, "failed");
    assert.equal(fixture.closedSubtaskTabs.length, 0);
    assert.equal(fixture.completionSubscriptionCount(), 0);
  } finally {
    fixture.dispose();
  }
});

test("并行调用的完成事件不能替代本次缺失的结果，结束后释放各自订阅", async () => {
  const fixture = createLoopPlusRuntimeFixture({ readRuns: () => [] });
  try {
    const start = (id: string) => fixture.adapter.startAttempt({
      taskId: "task-main", subtaskId: id, attemptId: `attempt-${id}`, title: id,
      prompt: longPrompt(id, `src/${id}.ts`), modelPrompt: "model", writeFiles: [`src/${id}.ts`], round: 1, targetCli: "codex",
    });
    const first = start("A");
    const second = start("B");
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 2, "两个调用均已启动");
    assert.equal(fixture.completionSubscriptionCount(), 2);
    fixture.finishParked("B", { status: "end", content: "B 已完成" });
    assert.equal((await second.promise).outcome, "completed");
    assert.deepEqual(fixture.closedSubtaskTabs, []);
    await second.onCompleted?.();
    assert.equal(fixture.completionSubscriptionCount(), 1);
    fixture.releaseParked("A");
    assert.equal((await first.promise).outcome, "failed");
    assert.deepEqual(fixture.closedSubtaskTabs, [fixture.createdSubtaskTargets[1].tabId]);
    assert.equal(fixture.completionSubscriptionCount(), 0);
  } finally {
    fixture.dispose();
  }
});

test("完成后共享历史读取异常不影响结果，CLI 收口异常仍为失败且释放订阅", async () => {
  for (const throwsAfterCompletion of [false, true]) {
    let completed = false;
    const fixture = createLoopPlusRuntimeFixture({ readRuns: () => {
      if (completed) throw new Error("共享历史读取失败");
      return [];
    } });
    try {
      fixture.setAttemptAction((input, tabId) => {
        fixture.publish(input, tabId, { status: "end", content: "本次真实完成结果" });
        completed = true;
        if (throwsAfterCompletion) throw new Error("CLI 收口失败");
      });
      const handle = fixture.adapter.startAttempt({
        taskId: "task-main", subtaskId: "A", attemptId: "attempt-A", title: "A",
        prompt: longPrompt("A", "src/a.ts"), modelPrompt: "model", writeFiles: ["src/a.ts"], round: 1, targetCli: "codex",
      });
      const result = await handle.promise;
      assert.equal(fixture.closedSubtaskTabs.length, 0);
      if (result.outcome === "completed") await handle.onCompleted?.();
      assert.equal(result.outcome, throwsAfterCompletion ? "failed" : "completed");
      assert.equal(result.detail, throwsAfterCompletion ? "CLI 收口失败" : "本次真实完成结果");
      assert.equal(fixture.closedSubtaskTabs.length, throwsAfterCompletion ? 0 : 1);
      assert.equal(fixture.completionSubscriptionCount(), 0);
    } finally {
      fixture.dispose();
    }
  }
});

test("未提供完成事件端口的适配器继续读取历史记录", async () => {
  const fixture = createLoopPlusRuntimeFixture({ observeRunCompletions: false });
  try {
    fixture.setAttemptAction((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "兼容历史读取" });
    });
    const handle = fixture.adapter.startAttempt({
      taskId: "task-main", subtaskId: "A", attemptId: "attempt-A", title: "A",
      prompt: longPrompt("A", "src/a.ts"), modelPrompt: "model", writeFiles: ["src/a.ts"], round: 1, targetCli: "codex",
    });
    const result = await handle.promise;
    assert.equal(fixture.closedSubtaskTabs.length, 0);
    await handle.onCompleted?.();
    assert.deepEqual(result, { outcome: "completed", detail: "兼容历史读取" });
    assert.equal(fixture.closedSubtaskTabs.length, 1);
    assert.equal(fixture.completionSubscriptionCount(), 0);
  } finally {
    fixture.dispose();
  }
});

for (const configId of [null, "active-profile"]) {
for (const continuationKind of ["repair", "follow-up"] as const) {
  test(`Loop+ ${continuationKind} with ${configId ?? "no profile"} restores the original session after its tab was closed`, async () => {
    const fixture = createLoopPlusRuntimeFixture({ configId });
    const nextSubtaskId = continuationKind === "repair" ? "A" : "B";
    let taskId = "";
    try {
      fixture.queueMain((input, tabId) => {
        taskId = input.loopTaskId ?? "";
        fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
      });
      fixture.queueMain(async (input, tabId) => {
        await waitForLoopPlus(() => fixture.closedSubtaskTabs.includes(fixture.createdSubtaskTargets[0].tabId), "复用会话前原子任务标签已关闭");
        assert.equal(fixture.readTask(taskId)?.subTasks.find((item) => item.id === "A")?.executionSession?.sessionId, "original-subtask-thread");
        fixture.publish(input, tabId, { status: "end", content: decision({
          status: "accept", reviewEventId: currentEventId(input.displayPrompt),
          reviews: [{ reviewEventId: currentEventId(input.displayPrompt), acceptance: continuationKind === "repair" ? "failed" : "passed", subtaskIds: [nextSubtaskId] }],
          subtasks: [{ ...subtask(nextSubtaskId, "src/a.ts"), ...(continuationKind === "follow-up" ? { continueFromSubtaskId: "A" } : {}) }],
        }) });
      });
      fixture.queueMain((input, tabId) => {
        fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
      });
      fixture.setAttemptAction((input, tabId) => {
        const target = fixture.createdSubtaskTargets.find((item) => item.tabId === tabId);
        assert.ok(target);
        if (tabId === fixture.createdSubtaskTargets[0].tabId) {
          assert.equal(target.sessionId, null);
          target.sessionId = "original-subtask-thread";
        } else {
          assert.equal(target.sessionId, "original-subtask-thread");
        }
        fixture.publish(input, tabId, { status: "end", content: `${input.loopSubtaskId} 已执行并汇报` });
      });
      await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
      assert.equal(fixture.readTask(taskId)?.status, "completed");
      assert.equal(fixture.createdSubtaskTargets.length, 2);
      assert.equal(fixture.attemptCalls[1]?.loopSubtaskConfigId ?? null, configId);
      assert.deepEqual(fixture.attemptCalls.map((input) => input.loopSubtaskId), ["A", nextSubtaskId]);
      assert.ok(fixture.attemptCalls.every((input) => input.loopAttemptId));
      assert.notEqual(fixture.attemptCalls[0].loopAttemptId, fixture.attemptCalls[1].loopAttemptId);
      assert.equal(fixture.readTask(taskId)?.subTasks.find((item) => item.id === nextSubtaskId)?.executionSession?.configId, configId);
      assert.notEqual(fixture.createdSubtaskTargets[0].tabId, fixture.createdSubtaskTargets[1].tabId);
      assert.equal(fixture.readTask(taskId)?.subTasks.find((item) => item.id === nextSubtaskId)?.executionSession?.sessionId, "original-subtask-thread");
    } finally {
      fixture.dispose();
    }
  });
}
}

test("Grok Loop+ restores legacy sessions when possible and continues safely when their cwd is missing", async () => {
  let legacyCwd = "";
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile",
    findLegacyGrokExecutionCwd: async (sessionId) => sessionId === "legacy-session" ? legacyCwd : null,
    executionRootFactory: (rootId, _useWorkspaceCwd, previousCwd) => {
    assert.ok(rootId);
    const workspace = path.join(fixture.rootDir, "workspace");
    return createLoopSubtaskExecutionRoot(workspace, { persistentCwd: previousCwd ?? resolveGrokLoopExecutionCwd(workspace, rootId, fixture.rootDir) });
  } });
  try {
    const workspace = path.join(fixture.rootDir, "workspace");
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "private project instructions");
    fixture.saveTask({ id: "grok-task", cli: "codex", status: "running", workspaceKey: "workspace", subTasks: [
      { id: "first", title: "首轮", status: "running" },
      { id: "next", title: "修补", status: "running" },
      { id: "further", title: "续接", status: "running" },
      { id: "independent", title: "独立", status: "running" },
      { id: "legacy-found", title: "可恢复旧会话", status: "running", executionSession: { cli: "grok", configId: "profile", sessionId: "legacy-session" } },
      { id: "legacy-missing", title: "目录缺失旧会话", status: "running", executionSession: { cli: "grok", configId: "profile", sessionId: "legacy-session-missing" } },
    ] } as LoopTaskRecord);
    legacyCwd = path.join(fixture.rootDir, "sinitek-loop-subtask-Ab12Cd");
    fs.mkdirSync(legacyCwd);
    const seen: string[] = [];
    const resumeIds: Array<string | null | undefined> = [];
    fixture.setAttemptAction((input, tabId) => {
      const target = fixture.createdSubtaskTargets.find((value) => value.tabId === tabId)!;
      if (input.loopSubtaskId !== "legacy-missing") assert.equal(input.grokLoopResumeSessionId, target.sessionId);
      assert.ok(input.executionCwd);
      assert.equal(fs.existsSync(path.join(input.executionCwd, "AGENTS.md")), false);
      assert.equal(fs.statSync(path.join(input.executionCwd, "src")).isDirectory(), true);
      seen.push(input.executionCwd);
      resumeIds.push(input.grokLoopResumeSessionId);
      target.sessionId = input.grokLoopResumeSessionId ?? `${input.loopSubtaskId}-session`;
      fixture.publish(input, tabId, { status: "end", content: "完成" });
    });
    const run = async (subtaskId: string, round: number, continueFromSubtaskId?: string) => {
      const handle = fixture.adapter.startAttempt({ taskId: "grok-task", subtaskId, attemptId: `attempt-${round}`, continueFromSubtaskId,
        targetCli: "grok", title: subtaskId, prompt: "继续", modelPrompt: "继续", writeFiles: [], round });
      const result = await handle.promise;
      if (result.outcome === "completed") await handle.onCompleted?.();
      return result;
    };
    assert.equal((await run("first", 1)).outcome, "completed");
    const initial = fs.statSync(seen[0], { bigint: true });
    assert.deepEqual(fs.readdirSync(seen[0]), []);
    fs.writeFileSync(path.join(workspace, "new.txt"), "new workspace entry");
    assert.equal((await run("first", 2)).outcome, "completed");
    assert.equal((await run("next", 3, "first")).outcome, "completed");
    assert.equal((await run("further", 4, "next")).outcome, "completed");
    assert.equal((await run("independent", 5)).outcome, "completed");
    assert.deepEqual(seen.slice(0, 4), Array(4).fill(seen[0]));
    assert.notEqual(seen[4], seen[0]);
    assert.equal(fs.statSync(seen[0], { bigint: true }).ino, initial.ino);
    assert.deepEqual(fs.readdirSync(seen[0]), []);
    const [first, next, further, independent] = fixture.readTask("grok-task")!.subTasks;
    assert.ok(first.executionSession?.grokExecutionRootId);
    assert.deepEqual(next.executionSession, first.executionSession);
    assert.deepEqual(further.executionSession, first.executionSession);
    assert.notEqual(independent.executionSession?.grokExecutionRootId, first.executionSession.grokExecutionRootId);
    assert.equal((await run("legacy-found", 6)).outcome, "completed");
    const foundSession = fixture.readTask("grok-task")!.subTasks[4].executionSession;
    assert.equal(seen[5], legacyCwd);
    assert.equal(resumeIds[5], "legacy-session");
    assert.equal(foundSession?.sessionId, "legacy-session");
    assert.equal(foundSession?.grokExecutionCwd, legacyCwd);
    assert.ok(foundSession?.grokExecutionRootId);
    assert.equal((await run("legacy-missing", 7)).outcome, "completed");
    const fallbackCwd = seen[6];
    assert.notEqual(fallbackCwd, legacyCwd);
    assert.equal(resumeIds[6], null);
    assert.match(fixture.attemptCalls[6].displayPrompt, /升级兼容/);
    assert.match(fixture.attemptCalls[6].modelPrompt, /不要假定已继承旧对话/);
    const fallbackSession = fixture.readTask("grok-task")!.subTasks[5].executionSession;
    assert.equal(fallbackSession?.sessionId, "legacy-missing-session");
    assert.ok(fallbackSession?.grokExecutionRootId);
    assert.equal((await run("legacy-missing", 8)).outcome, "completed");
    assert.equal(seen[7], fallbackCwd);
    assert.equal(resumeIds[7], "legacy-missing-session");
    fs.writeFileSync(path.join(seen[0], "unknown.txt"), "preserve");
    assert.match((await run("first", 9)).detail ?? "", /已保留现场/);
    assert.equal(seen.length, 8);
    assert.equal(fs.readFileSync(path.join(seen[0], "unknown.txt"), "utf8"), "preserve");
  } finally { fixture.dispose(); }
});

function prompt(text = "ship the feature") {
  return {
    displayPrompt: text,
    modelPrompt: text,
    contextTags: [] as string[],
    model: "main-model",
    loopMainModel: "main-model",
    loopSubtaskModel: "sub-model",
    loopMainThinkingMode: "low" as const,
    loopSubtaskThinkingMode: "low" as const,
  };
}

for (const compactFails of [false, true]) {
  test(`Loop+ 提交汇报及完成事件后、后台压缩${compactFails ? "失败" : "成功"}前关闭子任务标签`, { timeout: 3000 }, async () => {
    const fixture = createLoopPlusRuntimeFixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sessionId = `completion-order-${compactFails}`;
    let taskId = "";
    let compactStarted = false;
    try {
      fixture.queueMain((input, tabId) => {
        taskId = input.loopTaskId!;
        fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
      });
      fixture.queueMain((input, tabId) => {
        fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
      });
      fixture.setAttemptAction((input, tabId) => {
        fixture.createdSubtaskTargets.find((target) => target.tabId === tabId)!.sessionId = sessionId;
        fixture.publish(input, tabId, { status: "end", content: "本轮子任务已完成" });
        loopSubtaskAutoCompactions.defer(input, { cli: "codex", tabId, sessionId }, async () => {
          assert.match(reportText(fixture.rootDir), /Attempt result/);
          assert.equal(fixture.readTask(taskId)?.subTasks.find((item) => item.id === "A")?.status, "completed");
          compactStarted = true;
          assert.deepEqual(fixture.closedSubtaskTabs, [tabId]);
          const snapshot = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)?.loopPlus }).snapshot();
          assert.equal(snapshot.seenAttempts.find((attempt) => attempt.attemptId === input.loopAttemptId)?.outcome, "completed");
          await gate;
          if (compactFails) throw new Error("受控压缩失败");
        });
      });
      await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
      assert.equal(fixture.readTask(taskId)?.status, "completed");
      assert.equal(compactStarted, true);
      assert.deepEqual(fixture.closedSubtaskTabs, [fixture.createdSubtaskTargets[0].tabId]);
      release();
      await loopSubtaskAutoCompactions.wait("codex", sessionId);
      assert.deepEqual(fixture.closedSubtaskTabs, [fixture.createdSubtaskTargets[0].tabId]);
    } finally {
      release();
      await loopSubtaskAutoCompactions.wait("codex", sessionId);
      fixture.dispose();
    }
  });
}

test("Loop+ 汇报落盘失败时保留完成标签且取消压缩", { timeout: 3000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture();
  const sessionId = "report-failure-retains-tab";
  let taskId = "";
  try {
    fixture.setReportFailure("受控报告落盘失败");
    fixture.queueMain((input, tabId) => {
      taskId = input.loopTaskId!;
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
    });
    fixture.setAttemptAction((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "执行完成" });
      loopSubtaskAutoCompactions.defer(input, { cli: "codex", tabId, sessionId }, async () => assert.fail("未回报成功不得压缩"));
    });
    await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await loopSubtaskAutoCompactions.wait("codex", sessionId);
    assert.equal(fixture.readTask(taskId)?.status, "error");
    assert.deepEqual(fixture.closedSubtaskTabs, []);
  } finally {
    fixture.dispose();
  }
});

function reportText(rootDir: string): string {
  const commDir = path.join(rootDir, "comm");
  if (!fs.existsSync(commDir)) {
    return "";
  }
  const chunks: string[] = [];
  const stack = [commDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        chunks.push(fs.readFileSync(fullPath, "utf8"));
      }
    }
  }
  return chunks.join("\n");
}

test("model switch applies persisted routing and thinking to the next calls, not the active invocation", async () => {
  const fixture = createLoopPlusRuntimeFixture({
    resolveThinkingMode: (input, _cli, role) => role === "main" ? input.loopMainThinkingMode : input.loopSubtaskThinkingMode,
  });
  try {
    fixture.queueMain(async (input, tabId) => {
      assert.equal(input.model, "main-model");
      assert.equal(input.thinkingModeOverride, "low");
      await fixture.holdMain();
      assert.equal(input.model, "main-model");
      assert.equal(input.thinkingModeOverride, "low");
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("changed", "src/changed.ts")] }) });
    });
    fixture.queueMain((input, tabId) => {
      assert.equal(input.model, "new-main");
      assert.equal(input.thinkingModeOverride, "xhigh");
      fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.modelPrompt)) });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.mainCalls.length === 1, "first main invocation");
    const taskId = fixture.mainCalls[0].loopTaskId!;
    const record = fixture.readTask(taskId)!;
    fixture.saveTask({ ...record, modelRouting: { main: { model: "new-main" }, subtask: { model: "new-child" } },
      originProfile: { configId: "config", mainThinkingMode: "xhigh", subtaskThinkingMode: "max" },
    });
    fixture.releaseHeldMain();
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("changed"), "changed model child invocation");
    assert.equal(fixture.attemptCalls[0].model, "new-child");
    assert.equal(fixture.attemptCalls[0].thinkingModeOverride, "max");
    fixture.finishParked("changed", { status: "end", content: "已完成" });
    await running;
    assert.equal(fixture.mainCalls[1].model, "new-main");
    assert.equal(fixture.refusals.length, 0);
  } finally {
    fixture.dispose();
  }
});

for (const preserveLoopOrigin of [true, false]) {
  test(`explicit continuation ${preserveLoopOrigin ? "preserves task routing from group chat" : "persists the main tab selection"}`, async () => {
    const fixture = createLoopPlusRuntimeFixture({
      configId: "current-config",
      assertNewTaskModeAvailable: () => { throw new Error("existing continuation must not request new-task authority"); },
    });
    try {
      const task: import("../../loopTaskStore").LoopTaskRecord = {
        id: "resume-models", cli: "codex", workspaceKey: "workspace", taskStoreFile: fixture.storeFile,
        rootPrompt: "完成任务", schedulingMode: "event_driven", loopPlus: createLoopPlusScheduler({ maxConcurrency: 2 }).snapshot(),
        status: "stopped", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0,
        communicationDir: path.join(fixture.rootDir, "comm"), mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
        subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
        modelRouting: { main: { model: "stored-main" }, subtask: { model: "stored-child" } },
        originProfile: { configId: "current-config", mainThinkingMode: "xhigh", subtaskThinkingMode: "max" },
      };
      fixture.saveTask(task);
      fixture.queueMain((input, tabId) => {
        assert.equal(input.model, preserveLoopOrigin ? "stored-main" : "main-model");
        assert.equal(input.loopMainThinkingMode, preserveLoopOrigin ? "xhigh" : "low");
        fixture.publish(input, tabId, { status: "end", content: decision({ status: "wait", subtasks: [] }) });
      });
      await fixture.adapter.runEventDriven(prompt(), { resumeTaskId: task.id, resumeRequested: true, preserveLoopOrigin }, fixture.target);
      assert.equal(fixture.readTask(task.id)?.modelRouting?.main.model, preserveLoopOrigin ? "stored-main" : "main-model");
      assert.equal(fixture.readTask(task.id)?.modelRouting?.subtask.model, preserveLoopOrigin ? "stored-child" : "sub-model");
      assert.equal(fixture.readTask(task.id)?.originProfile?.mainThinkingMode, preserveLoopOrigin ? "xhigh" : "low");
      assert.equal(fixture.readTask(task.id)?.originProfile?.subtaskThinkingMode, preserveLoopOrigin ? "max" : "low");
    } finally {
      fixture.dispose();
    }
  });
}

test("rechecks host Loop+ authority after a stale resume candidate disappears during runner wait", async () => {
  for (const enabled of [false, true]) {
    let modeEnabled = true;
    const fixture = createLoopPlusRuntimeFixture({
      taskPersistence: createMemoryTaskPersistence(),
      assertNewTaskModeAvailable: () => assertModeAvailable("loop_plus", { loopPlusEnabled: modeEnabled }),
    });
    try {
      const candidate: LoopTaskRecord = {
        id: "resume-candidate", cli: "codex", workspaceKey: "workspace", taskStoreFile: fixture.storeFile,
        rootPrompt: "原任务", schedulingMode: "event_driven", loopPlus: createLoopPlusScheduler({ maxConcurrency: 2 }).snapshot(),
        status: "stopped", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0,
        communicationDir: path.join(fixture.rootDir, "comm"), mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
        subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
      };
      fixture.saveTask(candidate);
      const capturedCandidate = fixture.readTask(candidate.id);
      assert.equal(capturedCandidate?.id, candidate.id);
      if (enabled) {
        fixture.queueMain((input, tabId) => {
          fixture.publish(input, tabId, { status: "end", content: completedDecision() });
        });
      }
      const wait = createDeferred<void>();
      const dispatchAfterRunnerWait = (async () => {
        await wait.promise;
        fixture.removeTask(capturedCandidate!.id);
        modeEnabled = enabled;
        return fixture.adapter.runEventDriven(prompt("继续已失效候选"), {
          resumeTaskId: capturedCandidate!.id,
          resumeRequested: true,
          schedulingMode: "event_driven",
        }, fixture.target);
      })();
      wait.resolve();
      if (enabled) {
        assert.equal(await dispatchAfterRunnerWait, true);
        assert.equal(fixture.createdTaskIds.length, 1, "enabled mode keeps the legacy new-root fallback");
        assert.equal(fixture.mainCalls.length, 1, "the enabled fallback reaches the normal Loop+ main runner");
      } else {
        await assert.rejects(dispatchAfterRunnerWait, /Loop\+已在工具设置中关闭/);
        assert.equal(fixture.createdTaskIds.length, 0);
        assert.equal(fixture.mainCalls.length, 0);
        assert.equal(fixture.attemptCalls.length, 0);
        assert.equal(fixture.rootsCreated.length, 0);
      }
    } finally {
      fixture.dispose();
    }
  }
});

test("valid Loop+ continuation remains available while new Loop+ mode is disabled", async () => {
  let authorityChecks = 0;
  const fixture = createLoopPlusRuntimeFixture({
    taskPersistence: createMemoryTaskPersistence(),
    assertNewTaskModeAvailable: () => { authorityChecks += 1; throw new Error("disabled new-task mode"); },
  });
  try {
    const task: LoopTaskRecord = {
      id: "valid-resume", cli: "codex", workspaceKey: "workspace", taskStoreFile: fixture.storeFile,
      rootPrompt: "原 Loop+ 任务", schedulingMode: "event_driven", loopPlus: createLoopPlusScheduler({ maxConcurrency: 2 }).snapshot(),
      status: "stopped", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0,
      communicationDir: path.join(fixture.rootDir, "comm"), mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
      subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
    };
    fixture.saveTask(task);
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: completedDecision() });
    });
    assert.equal(await fixture.adapter.runEventDriven(prompt("继续原 Loop+"), {
      resumeTaskId: task.id, resumeRequested: true, schedulingMode: "event_driven",
    }, fixture.target), true);
    assert.equal(authorityChecks, 0);
    assert.equal(fixture.createdTaskIds.length, 0);
    assert.equal(fixture.mainCalls.length, 1);
  } finally {
    fixture.dispose();
  }
});

for (const configureDuringMain of [false, true]) {
  test(`adapter starts ten independent subtasks with the dispatch limit configured ${configureDuringMain ? "during the main call" : "before startup"}`, async () => {
    let maximum = configureDuringMain ? 6 : 10;
    const fixture = createLoopPlusRuntimeFixture({ decisionSubtaskMax: () => maximum });
    try {
      fixture.queueMain(async (input, tabId) => {
        assert.match(input.modelPrompt ?? "", new RegExp(`Scheduler concurrency limit: ${maximum}`));
        maximum = 10;
        fixture.publish(input, tabId, {
          status: "end",
          content: decision({
            status: "dispatch",
            subtasks: Array.from({ length: 10 }, (_, index) => subtask(`item-${index}`, `src/item-${index}.ts`)),
          }),
        });

      });
      const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
      await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 10, "ten independent attempts started");
      const taskId = fixture.mainCalls[0].loopTaskId ?? "";
      const snapshot = fixture.readTask(taskId)?.loopPlus as import("../../loopPlusScheduler").LoopPlusSchedulerSnapshot;
      assert.equal(snapshot.maxConcurrency, 10);
      assert.equal(snapshot.running.length, 10);
      assert.equal(snapshot.pending.length, 0);
      fixture.adapter.host().stopParent(taskId);
      await running;
    } finally {
      fixture.dispose();
    }
  });
}

test("Loop+ does not carry a stale configuration snapshot through task dispatch", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain((input, tabId) => {
      assert.equal("configSelections" in input, false);
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }) });
    });
    fixture.queueMain((input, tabId) => {
      assert.equal("configSelections" in input, false);
      fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
    });
    fixture.setAttemptAction((input, tabId) => {
      assert.equal("configSelections" in input, false);
      fixture.publish(input, tabId, { status: "end", content: "已完成所见配置任务" });
    });
    await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    assert.equal(fixture.mainCalls.length, 2);
    assert.equal(fixture.attemptCalls.length, 1);
  } finally { fixture.dispose(); }
});

test("adapter creates only the normal user prompt bubble in a subtask conversation", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  let messages: ReturnType<typeof fixture.getMessages> = [];
  try {
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }),
      });
    });
    fixture.setAttemptAction((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "A attempt result" });
      messages = fixture.getMessages(tabId).slice();
    });
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: completedDecision(currentEventId(input.displayPrompt)),
      });
    });

    await fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);

    const subtaskTarget = fixture.createdSubtaskTargets[0];
    assert.ok(subtaskTarget);
    assert.equal(subtaskTarget.loopTaskId, fixture.mainCalls[0]?.loopTaskId);
    assert.equal(subtaskTarget.loopSubtaskId, "A");
    const displayPrompt = fixture.attemptCalls[0]?.displayPrompt;
    assert.ok(displayPrompt?.includes(longPrompt("A", "src/a.ts")));
    const promptMessages = messages.filter((message) => message.content === displayPrompt);
    assert.equal(promptMessages.length, 1);
    assert.equal(promptMessages[0]?.role, "user");
    assert.equal(promptMessages[0]?.taskRole, "subtask");
    assert.equal(promptMessages[0]?.loopTaskId, fixture.mainCalls[0]?.loopTaskId);
    assert.equal(promptMessages[0]?.loopRound, fixture.attemptCalls[0]?.loopRound);
    assert.equal(promptMessages[0]?.loopSubtaskId, "A");
    assert.equal(typeof fixture.attemptCalls[0]?.loopAttemptId, "string");
    assert.equal(promptMessages[0]?.loopAttemptId, fixture.attemptCalls[0]?.loopAttemptId);
    assert.equal(messages.find((message) => message.role === "assistant")?.loopAttemptId, fixture.attemptCalls[0]?.loopAttemptId);
    assert.equal(messages.some((message) => message.role === "system"), false);
    assert.equal(fixture.getMessages(fixture.target.tabId).filter((message) => (
      message.role === "user" && message.content === fixture.mainCalls[0]?.displayPrompt
    )).length, 1);
    assert.equal(fixture.completionMessages[0]?.task.status, "completed");
  } finally {
    fixture.dispose();
  }
});

test("adapter runs A review while B is live, then refreshes current and queued finishes", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    let reviewPrompt = "";
    fixture.queueMain(async (input, tabId) => {
      reviewPrompt = input.displayPrompt;
      await fixture.holdMain();
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "wait", subtasks: [] }) });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 2, "both attempts");
    fixture.finishParked("A", { status: "end", content: "A attempt result" });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "one review");
    assert.equal(fixture.mainCalls.length, 2);
    assert.equal(fixture.parkedSubtaskIds().includes("B"), true);
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    const duringReview = fixture.readTask(taskId);
    assert.equal(duringReview?.loopPlus && (duringReview.loopPlus as { currentReview?: { subtaskId?: string } }).currentReview?.subtaskId, "A");
    fixture.finishParked("B", { status: "end", content: "B attempt result" });
    await waitForLoopPlus(() => fixture.refreshes.some((item) => {
      const snapshot = item.snapshot;
      return item.taskId === taskId
        && snapshot?.currentReview?.subtaskId === "A"
        && snapshot.reviewQueue.some((queued) => queued.subtaskId === "B");
    }), "refresh current and queue");
    const stored = fixture.readTask(taskId);
    const snapshot = stored?.loopPlus as { currentReview?: { subtaskId?: string }; reviewQueue?: Array<{ subtaskId?: string }> };
    assert.equal(snapshot.currentReview?.subtaskId, "A");
    assert.equal(snapshot.reviewQueue?.some((item) => item.subtaskId === "B"), true);
    assert.equal(reviewPrompt.includes("subtask=A"), true);
    const report = reportText(fixture.rootDir);
    assert.equal(report.includes("## Attempt result"), true);
    assert.equal(report.includes("outcome: completed"), true);
    assert.equal(report.includes("A attempt result"), true);
    assert.equal(stored?.schedulingMode, "event_driven");
    assert.equal(fixture.adapter.getLivePrompt(taskId)?.displayPrompt, "ship the feature");
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("adapter accepts A by adding C while B keeps running and does not call main again", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          reviews: [{ reviewEventId: currentEventId(input.displayPrompt), acceptance: "passed" }],
          independentSubtaskIds: ["C"],
          subtasks: [subtask("C", "src/c.ts")],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A started");
    fixture.finishParked("A", { status: "end", content: "A done" });
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("C"), "C started");
    assert.deepEqual(fixture.parkedSubtaskIds().sort(), ["B", "C"]);
    assert.equal(fixture.mainCalls.length, 2);
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    const snapshot = fixture.readTask(taskId)?.loopPlus as { running?: Array<{ subtaskId?: string }> };
    assert.equal(snapshot.running?.some((item) => item.subtaskId === "B"), true);
    assert.equal(snapshot.running?.some((item) => item.subtaskId === "C"), true);
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("adapter accept without new work does not call the main AI while another attempt is running", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [],
          reviews: [{ reviewEventId: currentEventId(input.displayPrompt), acceptance: "failed", reason: "父任务停止导致子任务结束",
            noRepairReason: "执行环境需用户确认，当前不派代码修复" }],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A started");
    fixture.finishParked("A", { status: "end", content: "A done" });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "review returned");
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 1, "only B remains");
    assert.deepEqual(fixture.parkedSubtaskIds(), ["B"]);
    assert.equal(fixture.mainCalls.length, 2);
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("adapter enforces write conflicts and the supplied concurrency limit", async () => {
  const conflict = createLoopPlusRuntimeFixture();
  const limited = createLoopPlusRuntimeFixture({ maxConcurrency: 1 });
  try {
    conflict.queueMain(async (input, tabId) => {
      conflict.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src\\shared.ts", "shared"), subtask("B", "src/shared.ts", "shared")],
        }),
      });
    });
    const conflictRun = conflict.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, conflict.target);
    await waitForLoopPlus(() => conflict.parkedSubtaskIds().length === 1, "conflict started one");
    assert.deepEqual(conflict.parkedSubtaskIds(), ["A"]);
    const conflictTask = conflict.readTask(conflict.mainCalls[0].loopTaskId ?? "");
    const conflictSnapshot = conflictTask?.loopPlus as { pending?: Array<{ subtaskId?: string }> };
    assert.equal(conflictSnapshot.pending?.some((item) => item.subtaskId === "B"), true);
    conflictRun.catch(() => undefined);

    limited.queueMain(async (input, tabId) => {
      limited.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    const limitedRun = limited.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, limited.target);
    await waitForLoopPlus(() => limited.parkedSubtaskIds().length === 1, "concurrency started one");
    assert.deepEqual(limited.parkedSubtaskIds(), ["A"]);
    const limitedSnapshot = limited.readTask(limited.mainCalls[0].loopTaskId ?? "")?.loopPlus as { pending?: Array<{ subtaskId?: string }>; running?: unknown[] };
    assert.equal(limitedSnapshot.running?.length, 1);
    assert.equal(limitedSnapshot.pending?.some((item) => item.subtaskId === "B"), true);
    limitedRun.catch(() => undefined);
  } finally {
    conflict.dispose();
    limited.dispose();
  }
});

test("adapter keeps a late sibling finish from turning the parent completed", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.finishParked("B", { status: "end", content: "B late result" });
      await waitForLoopPlus(() => !fixture.parkedSubtaskIds().includes("B"), "B finished during review");
      fixture.publish(input, tabId, {
        status: "end",
        content: completedDecision(currentEventId(input.displayPrompt)),
      });
    });
    fixture.queueMain(async () => {
      await fixture.holdMain();
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A started");
    fixture.finishParked("A", { status: "end", content: "A result" });
    await waitForLoopPlus(() => fixture.mainCalls.length >= 3, "B review started");
    const task = fixture.readTask(fixture.mainCalls[0].loopTaskId ?? "");
    assert.notEqual(task?.status, "completed");
    assert.equal(fixture.mainCalls[2].displayPrompt.includes("subtask=B"), true);
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("adapter appends main-task completion messages only after Loop+ is persisted completed", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "completed",
          answerConclusion: "主任务已完成。",
          finalSummary: "已完成实现并通过验收。",
          acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
          requirementCoverage: [{ name: "范围", passed: true }],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.completionMessages.length === 1, "main-task completion message");
    const completion = fixture.completionMessages[0];
    assert.ok(completion);
    assert.equal(completion.target.tabId, fixture.target.tabId);
    assert.equal(completion.task.status, "completed");
    assert.equal(completion.task.answerConclusion, "主任务已完成。");
    assert.equal(completion.task.finalSummary, "已完成实现并通过验收。");
    assert.equal(fixture.hostMessages.filter((message) => message === "loop-plus-completed").length, 1);
    await running;
  } finally {
    fixture.dispose();
  }
});

for (const departmentMode of [false, true]) {
  test(`${departmentMode ? "department leader skips" : "ordinary Loop+ requests"} standalone group chat on start, clarification and resume`, async () => {
    const revealed: string[] = [];
    const clarificationScopes: string[] = [];
    const fixture = createLoopPlusRuntimeFixture({
      revealClarification: (taskId) => { revealed.push(taskId); },
      waitForClarification: async (scope, request) => {
        clarificationScopes.push(scope);
        return { interactionId: request.interactionId, status: "aborted", values: {} };
      },
    });
    const input = { ...prompt("完成任务"), loopPlusAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot() };
    const departmentMetadata = departmentMode ? {
      version: 1 as const,
      rootTaskId: "department-root",
      parentTaskId: "department-root",
      leaderSubtaskId: "accounts",
      role: "leader" as const,
      moduleTitle: "账号模块",
      routes: { director: { cli: "codex" as const }, leader: { cli: "codex" as const }, employee: { cli: "codex" as const } },
      limits: { maxLeaders: 2, maxEmployees: 20 },
    } : undefined;
    try {
      fixture.queueMain((request, tabId) => fixture.publish(request, tabId, { status: "end", content: decision({
        status: "clarify",
        clarification: { formFields: [{ id: "scope", label: "范围", type: "text" }] },
      }) }));
      assert.equal(await fixture.adapter.runEventDriven(input, { schedulingMode: "event_driven", departmentMetadata }, fixture.target), true);
      const [taskId] = fixture.createdTaskIds;
      assert.ok(taskId);
      assert.deepEqual(clarificationScopes, [loopClarificationScope(taskId)]);
      assert.equal(fixture.readTask(taskId)?.status, "needs-review");
      assert.deepEqual(revealed, departmentMode ? [] : [taskId, taskId]);

      fixture.queueMain((request, tabId) => fixture.publish(request, tabId, { status: "end", content: decision({
        status: "completed", directCompletion: true, answerConclusion: "已完成", finalSummary: "任务完成",
      }) }));
      assert.equal(await fixture.adapter.runEventDriven(input, { resumeTaskId: taskId, resumeRequested: true,
        preserveLoopOrigin: true }, fixture.target), true);
      assert.equal(fixture.readTask(taskId)?.status, "completed");
      assert.deepEqual(revealed, departmentMode ? [] : [taskId, taskId, taskId]);
    } finally {
      fixture.dispose();
    }
  });
}

for (const { mode, department, requiresAcceptance } of [
  { mode: "ordinary execution completion", department: false, requiresAcceptance: true },
  { mode: "department acceptance", department: true, requiresAcceptance: true },
  { mode: "department report acknowledgement", department: true, requiresAcceptance: false },
] as const) {
  test(`first Loop+ dispatch releases the successor after ${mode}`, async () => {
    const fixture = createLoopPlusRuntimeFixture({ maxConcurrency: 2 });
    const departmentMetadata = department ? {
      version: 1 as const,
      rootTaskId: "department-root",
      parentTaskId: "department-root",
      leaderSubtaskId: "accounts",
      role: "leader" as const,
      moduleTitle: "accounts",
      routes: { director: { cli: "codex" as const }, leader: { cli: "codex" as const }, employee: { cli: "codex" as const } },
      limits: { maxLeaders: 2, maxEmployees: 20 },
    } : undefined;
    let running: Promise<boolean> | undefined;
    try {
      fixture.queueMain((input, tabId) => fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "dispatch", subtasks: [
          { ...subtask("prerequisite", "source.ts"), requiresAcceptance },
          { ...subtask("successor", "target.ts"), dependsOn: ["prerequisite"] },
        ] }),
      }));
      fixture.queueMain(async (input, tabId) => {
        await fixture.holdMain();
        const task = fixture.readTask(input.loopTaskId!)!;
        const snapshot = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
        fixture.publish(input, tabId, { status: "end", content: decision(requiresAcceptance
          ? { status: "accept", reviewEventId: currentEventId(input.displayPrompt) }
          : { status: "wait", reportEventIds: snapshot.reportQueue!.map((report) => report.eventId) }) });
      });
      running = fixture.adapter.runEventDriven({
        ...prompt(), loopPlusAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot(),
      }, { schedulingMode: "event_driven", departmentMetadata }, fixture.target);
      await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("prerequisite"), "first prerequisite launched");
      const { modelPrompt } = fixture.peekParked("prerequisite")!.input;
      assert.match(modelPrompt, /^Loop\+ subtask self-check before reporting$/m);
      assert.match(modelPrompt, /actually start it through its normal entry point/);
      assert.doesNotMatch(fixture.mainCalls[0].modelPrompt, /^Loop\+ subtask self-check before reporting$/m);
      if (department) {
        assert.match(modelPrompt, /^你是产研部员工/);
      } else {
        assert.doesNotMatch(modelPrompt, /^你是产研部员工/);
      }
      const [taskId] = fixture.createdTaskIds;
      const snapshot = () => createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot();
      assert.deepEqual(snapshot().pending.map((item) => item.subtaskId), ["successor"]);
      fixture.finishParked("prerequisite", { status: "end", content: "prerequisite complete" });
      await waitForLoopPlus(() => fixture.mainCalls.length === 2, "first review or report main decision held open");
      if (department) {
        assert.deepEqual(snapshot().pending.map((item) => item.subtaskId), ["successor"]);
        assert.equal(fixture.parkedSubtaskIds().includes("successor"), false);
        const before = snapshot();
        assert.equal((requiresAcceptance ? before.currentReview : before.reportQueue?.[0])?.subtaskId, "prerequisite");
        fixture.releaseHeldMain();
      }
      await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("successor"), "successor launched");
      const after = snapshot();
      const prerequisite = after.seenAttempts.find((item) => item.subtaskId === "prerequisite");
      if (!department) {
        assert.equal(after.currentReview?.subtaskId, "prerequisite", "ordinary execution did not wait for acceptance");
      } else if (requiresAcceptance) {
        assert.equal(prerequisite?.disposition, "reviewed");
        assert.equal(prerequisite?.acceptance, "passed");
      } else {
        assert.equal(prerequisite?.disposition, "reported");
        assert.equal(prerequisite?.requiresAcceptance, false);
      }
      const gate = department ? /latest attempt completes and passes acceptance/ : /Acceptance or report acknowledgement is not required for execution admission/;
      assert.match(fixture.mainCalls[0].modelPrompt, gate);
      assert.match(fixture.peekParked("successor")!.input.modelPrompt, gate);
    } finally {
      fixture.adapter.host().stopParent(fixture.createdTaskIds[0] ?? "");
      fixture.releaseHeldMain();
      await running;
      fixture.dispose();
    }
  });
}

test("Loop+ routes an end without a final reply to failure review and keeps its successor pending", { timeout: 5000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture({
    maxConcurrency: 2,
    taskPersistenceFactory: (rootDir) => {
      const storeFile = path.join(rootDir, "loop-tasks.json");
      const save = (task: LoopTaskRecord): void => fs.writeFileSync(storeFile, JSON.stringify(task));
      return {
        create: (task) => { save(task); return task; },
        read: (taskId) => {
          if (!fs.existsSync(storeFile)) return null;
          const task = JSON.parse(fs.readFileSync(storeFile, "utf8")) as LoopTaskRecord;
          return task.id === taskId ? task : null;
        },
        save,
        remove: () => fs.rmSync(storeFile, { force: true }),
      };
    },
  });
  const failure = "任务中断，等待主任务重新派发。";
  let running: Promise<boolean> | undefined;
  try {
    fixture.queueMain((input, tabId) => fixture.publish(input, tabId, {
      status: "end", content: decision({ status: "dispatch", subtasks: [
        { ...subtask("prerequisite", "source.ts"), requiresAcceptance: false },
        { ...subtask("successor", "target.ts"), dependsOn: ["prerequisite"] },
      ] }),
    }));
    fixture.queueMain(() => fixture.holdMain());
    running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);

    await waitForLoopPlus(() => fixture.peekParked("prerequisite") !== null, "prerequisite invocation parked");
    const [taskId] = fixture.createdTaskIds;
    const parked = fixture.peekParked("prerequisite");
    const attemptId = parked?.input.loopAttemptId;
    assert.ok(parked && attemptId);
    assert.equal(parked.input.loopTaskId, taskId);
    const dispatched = fixture.readTask(taskId)?.loopPlus;
    assert.ok(dispatched);
    const before = createLoopPlusScheduler({ snapshot: dispatched }).snapshot();
    assert.deepEqual(before.running.map((item) => item.attemptId), [attemptId]);
    assert.equal(before.seenAttempts.find((item) => item.attemptId === attemptId)?.requiresAcceptance, false);
    assert.deepEqual(before.pending.map((item) => item.subtaskId), ["successor"]);

    fixture.finishParked("prerequisite", { status: "end", attemptId });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "failure review invocation held open");

    const task = fixture.readTask(taskId);
    assert.ok(task?.loopPlus);
    const storedTask = JSON.parse(fs.readFileSync(fixture.storeFile, "utf8")) as LoopTaskRecord;
    assert.equal(storedTask.id, taskId);
    assert.deepEqual(task, storedTask);
    const after = storedTask.loopPlus as LoopPlusSchedulerSnapshot | undefined;
    assert.ok(after);
    const persisted = after.seenAttempts.find((item) => item.attemptId === attemptId);
    assert.equal(persisted?.outcome, "failed");
    assert.equal(persisted.disposition, "finished");
    assert.equal(persisted.requiresAcceptance, false);
    const eventId = buildLoopPlusFinishEventId("prerequisite", attemptId);
    assert.deepEqual(after.currentReview, { eventId, subtaskId: "prerequisite", attemptId, outcome: "failed", detail: failure });
    assert.equal(currentEventId(fixture.mainCalls[1].displayPrompt), eventId);
    assert.match(fixture.mainCalls[1].modelPrompt, /outcome=failed detail=任务中断，等待主任务重新派发。/);
    assert.equal(task.subTasks.find((item) => item.id === "prerequisite")?.status, "blocked");
    assert.deepEqual(after.reportQueue ?? [], []);
    assert.deepEqual(after.running, []);
    assert.deepEqual(after.pending, before.pending);
    assert.deepEqual(fixture.attemptCalls.map((input) => input.loopAttemptId), [attemptId]);
    assert.deepEqual(fixture.closeSubtaskTabAttempts, []);
    assert.deepEqual(fixture.closedSubtaskTabs, []);
  } finally {
    fixture.adapter.host().stopParent(fixture.createdTaskIds[0] ?? "");
    fixture.releaseHeldMain();
    try {
      await running;
      assert.equal(fixture.completionSubscriptionCount(), 0);
    } finally {
      fixture.dispose();
    }
  }
});

test("leader model invocation keeps its captured department balance snapshot", async () => {
  const fixture = createLoopPlusRuntimeFixture({
    taskPersistence: createMemoryTaskPersistence(),
    assertNewTaskModeAvailable: () => { throw new Error("trusted department leader dispatch must bypass user Loop+ mode gate"); },
  });
  const reads: Array<[string, string]> = [];
  const departmentMetadata = {
    version: 1 as const,
    rootTaskId: "department-root",
    parentTaskId: "department-root",
    leaderSubtaskId: null,
    role: "leader" as const,
    moduleTitle: "accounts",
    routes: { director: { cli: "codex" as const }, leader: { cli: "codex" as const }, employee: { cli: "codex" as const } },
    limits: { maxLeaders: 2, maxEmployees: 20 },
  };
  let available = true;
  const snapshot = {
    rootTaskId: "department-root",
    leaderTaskId: "leader-task",
    maxEmployees: 4,
    activeEmployees: 1,
    availableEmployees: 3,
    leaderOverflowActive: false,
    canAcquireOverflow: false,
  };
  let taskId = "";
  try {
    fixture.adapter.setDepartmentEmployeeCapacityReader?.((rootTaskId, leaderTaskId) => {
      reads.push([rootTaskId, leaderTaskId]);
      return available ? { ...snapshot, leaderTaskId } : null;
    });
    fixture.queueMain(async (input, tabId) => {
      taskId = input.loopTaskId ?? "";
      assert.match(input.displayPrompt, /Regular employee total: 4/);
      assert.match(input.displayPrompt, /Available regular employee balance: 3/);
      await fixture.holdMain();
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "wait" }) });
    });
    fixture.queueMain((input, tabId) => {
      assert.match(input.displayPrompt, /employee balance unknown/);
      assert.doesNotMatch(input.displayPrompt, /Available regular employee balance: (?:0|20)/);
      fixture.publish(input, tabId, { status: "end", content: decision({
        status: "completed",
        directCompletion: true,
        answerConclusion: "余额未知时仍完成普通主决策",
        finalSummary: "本次组长决策未伪造员工余额",
      }) });
    });
    const running = fixture.adapter.runEventDriven({
      ...prompt("按要求完成部门工作"),
      loopPlusAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot(),
    }, { schedulingMode: "event_driven", departmentMetadata }, fixture.target);
    await waitForLoopPlus(() => fixture.mainCalls.length === 1 && taskId !== "", "initial leader decision issued");
    const issuedPrompt = fixture.mainCalls[0].displayPrompt;
    available = false;
    fixture.releaseHeldMain();
    const handled = await running;
    assert.equal(handled, true);
    assert.equal(fixture.mainCalls.length, 2);
    assert.equal(fixture.mainCalls[0].displayPrompt, issuedPrompt, "an issued model prompt is a fixed snapshot");
    assert.match(issuedPrompt, /Available regular employee balance: 3/);
    assert.match(fixture.mainCalls[1].displayPrompt, /employee balance unknown/);
    assert.ok(reads.length >= 2, "initial and closeout decisions each read the provider");
    assert.ok(reads.every(([root, leader]) => root === "department-root" && leader === taskId));
    assert.equal(fixture.readTask(taskId)?.department?.role, "leader");
  } finally {
    fixture.dispose();
  }
});

test("adapter stop keeps resume state, blocks continue while cancellation is live, then reviews explicitly", async () => {
  const fixture = createLoopPlusRuntimeFixture({ taskPersistence: createMemoryTaskPersistence() });
  let taskId = "";
  let first: Promise<boolean> | null = null;
  let blocked: Promise<boolean> | null = null;
  let firstSettled = false;
  let blockedSettled = false;
  let recoveryFailure: unknown;
  try {
    fixture.setHoldAbort(true);
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }),
      });
    });
    first = fixture.adapter.runEventDriven(prompt("keep the saved prompt"), { schedulingMode: "event_driven" }, fixture.target);
    void first.then(() => { firstSettled = true; }, () => { firstSettled = true; });
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A parked");
    taskId = fixture.mainCalls[0].loopTaskId ?? "";
    fixture.adapter.host().stopParent(taskId);
    assert.equal(firstSettled, false, "the first lifecycle remains live while the parked runner is unsettled");
    assert.equal(fixture.adapter.getLivePrompt(taskId)?.displayPrompt, "keep the saved prompt");
    assert.equal(fixture.parkedSubtaskIds().includes("A"), true);
    blocked = fixture.adapter.runEventDriven(prompt("keep the saved prompt"), {
      schedulingMode: undefined,
      resumeTaskId: taskId,
      resumeRequested: true,
    }, fixture.target);
    void blocked.then(() => { blockedSettled = true; }, () => { blockedSettled = true; });
    await waitForLoopPlus(() => fixture.hostMessages.includes("loop-plus-resume-blocked"), "authoritative blocked-continue refusal notification");
    assert.equal(firstSettled, false, "the first adapter lifecycle remains pending until the runner settles");
    assert.equal(blockedSettled, false, "the rejected continue still waits for the original execution to settle");
    assert.equal(fixture.adapter.hasTaskExecution(taskId), true);
    assert.equal(fixture.readTask(taskId)?.status, "stopped", "the task remains stopped while its original runner owns execution");
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(fixture.attemptCalls.length, 1);
    assert.deepEqual(fixture.createdTaskIds, [taskId], "blocked continue creates no replacement task");
    fixture.setHoldAbort(false);
    fixture.releaseParked("A");
    await waitForLoopPlus(() => !fixture.adapter.hasTaskExecution(taskId) && firstSettled && blockedSettled,
      "cancelled runner, original lifecycle and refused continue settled");
    assert.equal(await first, true);
    assert.equal(await blocked, true, "the stopped task accepts an explicit continue only after runner settlement");
    assert.equal(firstSettled, true);
    assert.equal(blockedSettled, true);
    const stoppedSnapshot = fixture.readTask(taskId)?.loopPlus as {
      running?: unknown[];
      reviewQueue?: Array<{ eventId: string; subtaskId: string; outcome: string }>;
      seenAttempts?: Array<{ subtaskId: string; disposition: string; outcome?: string }>;
    } | undefined;
    assert.deepEqual(stoppedSnapshot?.running, []);
    assert.equal(stoppedSnapshot?.seenAttempts?.some((item) => item.subtaskId === "A" && item.outcome === "stopped"), true);
    fixture.queueMain(async (input, tabId) => {
      assert.equal(input.displayPrompt.includes("Prompt kind: review"), true);
      assert.equal(input.displayPrompt.includes("subtask=A"), true);
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [],
          reviews: [{ reviewEventId: currentEventId(input.displayPrompt), acceptance: "failed", reason: "父任务停止导致子任务结束",
            noRepairReason: "执行环境需用户确认，当前不派代码修复" }],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      assert.equal(input.displayPrompt.includes("Prompt kind: closeout"), true);
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "blocked",
          subtasks: [],
          finalSummary: "stopped attempt reviewed; waiting for a person",
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      assert.match(input.displayPrompt, /Bounded blocked review/);
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({ status: "blocked", finalSummary: "all remaining work needs a person" }),
      });
    });
    await fixture.adapter.runEventDriven(prompt("keep the saved prompt"), {
      resumeTaskId: taskId,
      resumeRequested: true,
    }, fixture.target);
    assert.equal(fixture.mainCalls.length, 4);
    assert.equal(fixture.attemptCalls.length, 1);
    assert.equal(fixture.parkedSubtaskIds().includes("A"), false);
    const resumed = fixture.readTask(taskId);
    const resumedSnapshot = resumed?.loopPlus as { running?: unknown[]; pending?: unknown[]; reviewQueue?: unknown[] } | undefined;
    assert.equal(resumed?.status, "needs-review");
    assert.equal(resumed?.schedulingMode, "event_driven");
    assert.equal(resumedSnapshot?.running?.length, 0);
    assert.equal(resumedSnapshot?.pending?.length, 0);
    assert.equal(resumedSnapshot?.reviewQueue?.length, 0);
    const savedAttempt = (resumed?.loopPlus as { seenAttempts?: Array<{
      subtaskId: string; attemptId: string; disposition: string; outcome?: string; acceptance?: string;
    }> } | undefined)
      ?.seenAttempts?.find((item) => item.subtaskId === "A");
    assert.equal(savedAttempt?.disposition, "reviewed");
    assert.equal(savedAttempt?.outcome, "stopped");
    assert.equal(buildLoopPlusFinishEventId("A", savedAttempt?.attemptId ?? ""), currentEventId(fixture.mainCalls[1]?.displayPrompt ?? ""),
      "the persisted stopped attempt is reviewed under its saved finish event");
    assert.equal(fixture.adapter.getLivePrompt(taskId)?.displayPrompt, "keep the saved prompt");
  } finally {
    fixture.setHoldAbort(false);
    fixture.releaseParkedIfPresent("A");
    try {
      await waitForLoopPlus(() => (!taskId || !fixture.adapter.hasTaskExecution(taskId))
        && (!first || firstSettled) && (!blocked || blockedSettled), "bounded stop-test runner and lifecycle settlement");
      if (first) await first;
      if (blocked) await blocked;
    } catch (error) { recoveryFailure = error; }
    fixture.dispose();
    if (recoveryFailure) {
      throw new Error(`stop-test fixture recovery failed: ${String(recoveryFailure)}`);
    }
  }
});

test("adapter rejects corrupt snapshots, clears live prompts after completion, and keeps pause state", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const now = Date.now();
    fixture.saveTask({
      id: "corrupt",
      cli: "codex",
      workspaceKey: "workspace",
      taskStoreFile: fixture.storeFile,
      rootPrompt: "corrupt",
      schedulingMode: "event_driven",
      loopPlus: { nope: true },
      status: "running",
      createdAt: now,
      updatedAt: now,
      maxRounds: 20,
      currentRound: 0,
      communicationDir: path.join(fixture.rootDir, "comm", "corrupt"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "corrupt", "main.md"),
      sessionId: "session",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      subTasks: [],
      rounds: [],
      supplementalRequirements: [],
      completionRoundSummaries: [],
      completionRequirementCoverage: [],
    });
    const corruptHandled = await fixture.adapter.runEventDriven(prompt("corrupt"), {
      resumeTaskId: "corrupt",
      resumeRequested: true,
    }, fixture.target);
    assert.equal(corruptHandled, true);
    assert.equal(fixture.readTask("corrupt")?.status, "error");
    assert.equal(fixture.readTask("corrupt")?.schedulingMode, "event_driven");
    assert.equal(fixture.mainCalls.length, 0);

    const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
    assert.equal(scheduler.complete().ok, true);
    fixture.saveTask({
      ...(fixture.readTask("corrupt") as NonNullable<ReturnType<typeof fixture.readTask>>),
      id: "done",
      rootPrompt: "done",
      status: "completed",
      schedulingMode: "event_driven",
      loopPlus: scheduler.snapshot(),
      communicationDir: path.join(fixture.rootDir, "comm", "done"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "done", "main.md"),
      updatedAt: Date.now(),
    });
    await fixture.adapter.runEventDriven(prompt("done"), { resumeTaskId: "done", resumeRequested: true }, fixture.target);
    assert.equal(fixture.adapter.getLivePrompt("done"), null);
    assert.equal(fixture.adapter.host().hasController("done"), false);

    const idle = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
    fixture.saveTask({
      ...(fixture.readTask("done") as NonNullable<ReturnType<typeof fixture.readTask>>),
      id: "paused",
      rootPrompt: "paused",
      status: "running",
      schedulingMode: "event_driven",
      loopPlus: idle,
      finalSummary: undefined,
      communicationDir: path.join(fixture.rootDir, "comm", "paused"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "paused", "main.md"),
      updatedAt: Date.now(),
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "wait", subtasks: [] }) });
    });
    await fixture.adapter.runEventDriven(prompt("hold for resume"), {
      resumeTaskId: "paused",
      resumeRequested: true,
    }, fixture.target);
    assert.equal(fixture.readTask("paused")?.status, "needs-review");
    assert.equal(fixture.adapter.getLivePrompt("paused")?.displayPrompt, "hold for resume");
    assert.equal(fixture.readTask("paused")?.supplementalRequirements?.includes("hold for resume"), true);
  } finally {
    fixture.dispose();
  }
});

test("adapter gives saved Loop+ mode priority and does not capture classic or vibe entry", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const now = Date.now();
    const base = {
      cli: "codex" as const,
      workspaceKey: "workspace",
      taskStoreFile: fixture.storeFile,
      status: "running" as const,
      createdAt: now,
      updatedAt: now,
      maxRounds: 20,
      currentRound: 0,
      sessionId: "session",
      activeSubtaskId: null,
      activeSubtaskIds: [] as string[],
      subTasks: [],
      rounds: [],
      supplementalRequirements: [] as string[],
      completionRoundSummaries: [],
      completionRequirementCoverage: [],
    };
    fixture.saveTask({
      ...base,
      id: "saved-plus",
      rootPrompt: "saved plus",
      schedulingMode: "event_driven",
      loopPlus: createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot(),
      communicationDir: path.join(fixture.rootDir, "comm", "saved-plus"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "saved-plus", "main.md"),
    });
    fixture.saveTask({
      ...base,
      id: "saved-classic",
      rootPrompt: "saved classic",
      schedulingMode: "classic",
      communicationDir: path.join(fixture.rootDir, "comm", "saved-classic"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "saved-classic", "main.md"),
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: completedDecision(null) });
    });
    assert.equal(await fixture.adapter.runEventDriven(prompt("manual without mode"), {
      resumeTaskId: "saved-plus",
    }, fixture.target), true);
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(await fixture.adapter.runEventDriven(prompt("timer asks plus"), {
      schedulingMode: schedulingModeForInteractiveMode("loop_plus"),
      resumeTaskId: "saved-classic",
    }, fixture.target), false);
    assert.equal(fixture.readTask("saved-classic")?.status, "running");
    assert.equal(fixture.readTask("saved-classic")?.schedulingMode, "classic");
    fixture.adapter.host().stopParent("saved-classic");
    assert.equal(fixture.readTask("saved-classic")?.status, "running");
    assert.equal(await fixture.adapter.runEventDriven(prompt("classic manual"), {
      schedulingMode: schedulingModeForInteractiveMode("loop"),
    }, fixture.target), false);
    assert.equal(await fixture.adapter.runEventDriven({
      ...prompt("classic-fallback"),
    }, {}, fixture.target), false);
    assert.equal(await fixture.adapter.runEventDriven(prompt("vibe"), {}, fixture.target), false);
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: completedDecision(null) });
    });
    assert.equal(await fixture.adapter.runEventDriven(prompt("timer plus"), {
      schedulingMode: schedulingModeForInteractiveMode("loop_plus"),
    }, fixture.target), true);
    const created = fixture.readTask(fixture.mainCalls[1].loopTaskId ?? "");
    assert.equal(created?.schedulingMode, "event_driven");
    assert.equal(Object.prototype.hasOwnProperty.call(created, "executionMode"), false);
    assert.equal(created?.status, "completed");
    assert.equal(fixture.adapter.getLivePrompt(created?.id ?? ""), null);
    fixture.setSubtaskConversation(true);
    assert.equal(await fixture.adapter.runEventDriven(prompt("nested"), {
      schedulingMode: "event_driven",
    }, fixture.target), true);
    assert.deepEqual(fixture.refusals, ["nested"]);
  } finally {
    fixture.dispose();
  }
});

test("adapter isolates this invocation from old, missing, failed, retried, and late results", async () => {
  const activityChanges: string[] = [];
  const fixture = createLoopPlusRuntimeFixture({ onMainActivityChange: (taskId) => activityChanges.push(taskId) });
  try {
    const mainTarget = fixture.target;
    const oldMain = {
      ...prompt("previous main decision"),
      taskRole: "main" as const,
      loopTaskId: "task-main",
      loopRound: 1,
    };
    fixture.seedHistory(oldMain, mainTarget.tabId, {
      content: decision({ status: "dispatch", subtasks: [subtask("OLD", "src/old.ts")] }),
      status: "end",
      prompt: "previous main decision",
    });
    fixture.queueMain(async () => undefined);
    const early = await fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review the new event",
      modelPrompt: "review the new event",
      reviewEventId: "event-new",
      target: mainTarget,
    }).promise;
    assert.equal(early, null);

    fixture.queueMain(async () => {
      throw new Error("main failed");
    });
    await assert.rejects(fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review after failure",
      modelPrompt: "review after failure",
      reviewEventId: "event-fail",
      target: mainTarget,
    }).promise, /main failed/);

    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "stopped" });
    });
    const stopped = await fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review after stop",
      modelPrompt: "review after stop",
      reviewEventId: "event-stop",
      target: mainTarget,
    }).promise;
    assert.equal(stopped, null);

    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        late: true,
        status: "end",
        content: decision({ status: "dispatch", subtasks: [subtask("LATE", "src/late.ts")] }),
        prompt: input.displayPrompt,
      });
    });
    const late = await fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review while old output arrives",
      modelPrompt: "review while old output arrives",
      reviewEventId: "event-late",
      target: mainTarget,
    }).promise;
    assert.equal(late, null);

    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "NEW_MAIN_DECISION" });
    });
    const fresh = await fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review with a new answer",
      modelPrompt: "review with a new answer",
      reviewEventId: "event-fresh",
      target: mainTarget,
    }).promise;
    assert.equal(fresh, "NEW_MAIN_DECISION");
    assert.equal(activityChanges.length, 10);
    assert.deepEqual(activityChanges.filter((_, index) => index % 2 === 0), Array(5).fill("task-main"));
    assert.deepEqual(activityChanges.filter((_, index) => index % 2 === 1), Array(5).fill("task-main"));

    fixture.setSubtaskTab("seed-sub");
    fixture.seedHistory({
      ...prompt("old subtask prompt"),
      taskRole: "subtask",
      loopTaskId: "task-main",
      loopRound: 1,
      loopSubtaskId: "A",
    }, "seed-sub", {
      content: "OLD_SUBTASK_RESULT",
      status: "end",
      prompt: "old subtask prompt",
    });
    fixture.setAttemptAction(async () => undefined);
    const retried = await fixture.adapter.startAttempt({
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "retry-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(retried.outcome, "failed");
    assert.equal(retried.detail === "OLD_SUBTASK_RESULT", false);

    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, {
        late: true,
        status: "end",
        content: "OLD_SUBTASK_RESULT",
        prompt: input.displayPrompt,
      });
    });
    const lateAttempt = await fixture.adapter.startAttempt({
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "late-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.notEqual(lateAttempt.outcome, "completed");
    assert.equal(lateAttempt.detail === "OLD_SUBTASK_RESULT", false);

    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "stopped", content: "OLD_SUBTASK_RESULT" });
    });
    const stoppedAttempt = await fixture.adapter.startAttempt({
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "stop-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(stoppedAttempt.outcome, "stopped");
    assert.equal(stoppedAttempt.detail === "OLD_SUBTASK_RESULT", false);

    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "NEW_SUBTASK_RESULT" });
    });
    const succeeded = await fixture.adapter.startAttempt({
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "new-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(succeeded.outcome, "completed");
    assert.equal(succeeded.detail, "NEW_SUBTASK_RESULT");
    assert.equal(fixture.executionCwds.filter((cwd) => typeof cwd === "string" && cwd.startsWith(fixture.rootDir)).length > 0, true);
    assert.equal(fixture.rootsDisposed.length >= 4, true);
  } finally {
    fixture.dispose();
  }
});

test("adapter releases execution roots after success, failure, and creation failure", async () => {
  const statuses: string[] = [];
  const fixture = createLoopPlusRuntimeFixture({ onSubtaskPreparationFailed: (_tabId, status) => { statuses.push(status); } });
  try {
    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "root ran" });
    });
    const succeeded = await fixture.adapter.startAttempt({
      taskId: "task-root",
      subtaskId: "root",
      attemptId: "root-1",
      title: "root",
      prompt: longPrompt("root", "src/root.ts"),
      modelPrompt: "model",
      writeFiles: ["src/root.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(succeeded.outcome, "completed");
    assert.deepEqual(fixture.rootsDisposed, [1]);

    fixture.setAttemptAction(async () => {
      throw new Error("prompt failed");
    });
    const failed = await fixture.adapter.startAttempt({
      taskId: "task-root",
      subtaskId: "root",
      attemptId: "root-2",
      title: "root",
      prompt: longPrompt("root", "src/root.ts"),
      modelPrompt: "model",
      writeFiles: ["src/root.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(failed.outcome, "failed");
    assert.equal(failed.detail, "prompt failed");
    assert.deepEqual(fixture.rootsDisposed, [1, 2]);
    assert.deepEqual(statuses, []);

    fixture.setRootFailure("root failed");
    const unavailable = await fixture.adapter.startAttempt({
      taskId: "task-root",
      subtaskId: "root",
      attemptId: "root-3",
      title: "root",
      prompt: longPrompt("root", "src/root.ts"),
      modelPrompt: "model",
      writeFiles: ["src/root.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(unavailable.outcome, "failed");
    assert.equal(unavailable.detail, "root failed");
    assert.deepEqual(fixture.rootsDisposed, [1, 2]);
    assert.deepEqual(statuses, ["error"]);
  } finally {
    fixture.dispose();
  }
});

test("ordinary Loop+ completion survives an execution-root cleanup failure", async () => {
  let fixture!: ReturnType<typeof createLoopPlusRuntimeFixture>;
  fixture = createLoopPlusRuntimeFixture({
    executionRootFactory: () => ({
      cwd: path.join(fixture.rootDir, "cleanup-failure"),
      dispose: () => ({ ok: false, reason: "目录仍有内容" }),
    }),
  });
  try {
    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "最终答复已完成" });
    });
    const result = await fixture.adapter.startAttempt({
      taskId: "task-cleanup-failure",
      subtaskId: "cleanup",
      attemptId: "cleanup-1",
      title: "cleanup",
      prompt: longPrompt("cleanup", "src/cleanup.ts"),
      modelPrompt: "model",
      writeFiles: ["src/cleanup.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(result.outcome, "completed");
    assert.equal(result.detail, "最终答复已完成");
    assert.equal(fixture.logs.some(({ event }) => event === "loop-plus-execution-root-cleanup-failed"), true);
  } finally {
    fixture.dispose();
  }
});

test("closes a Loop+ subtask tab only after its completed result is reported", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const request = {
      taskId: "task-close",
      subtaskId: "close-me",
      title: "close-me",
      prompt: longPrompt("close-me", "src/close.ts"),
      modelPrompt: "model",
      writeFiles: ["src/close.ts"],
      round: 1,
      targetCli: "codex" as const,
    };

    fixture.setAttemptAction(async () => {
      throw new Error("prompt failed");
    });
    const failed = await fixture.adapter.startAttempt({ ...request, attemptId: "close-failed" }).promise;
    assert.equal(failed.outcome, "failed");
    assert.deepEqual(fixture.closedSubtaskTabs, []);

    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "stopped", content: "stopped result" });
    });
    const stopped = await fixture.adapter.startAttempt({ ...request, attemptId: "close-stopped" }).promise;
    assert.equal(stopped.outcome, "stopped");
    assert.deepEqual(fixture.closedSubtaskTabs, []);

    fixture.setRootFailure("root failed");
    const unavailable = await fixture.adapter.startAttempt({ ...request, attemptId: "close-root" }).promise;
    assert.equal(unavailable.outcome, "failed");
    assert.deepEqual(fixture.closedSubtaskTabs, []);
    fixture.setRootFailure(null);

    fixture.setCloseSubtaskTabError("模拟瞬时宿主关闭失败");
    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "kept before close" });
    });
    const handle = fixture.adapter.startAttempt({ ...request, attemptId: "close-ok" });
    const closed = await handle.promise;
    assert.deepEqual(fixture.closedSubtaskTabs, []);
    await handle.onCompleted?.();
    assert.equal(closed.outcome, "completed");
    assert.equal(closed.detail, "kept before close");
    assert.equal(fixture.closedSubtaskTabs.length, 1);
    assert.deepEqual(fixture.closeSubtaskTabAttempts, [fixture.closedSubtaskTabs[0], fixture.closedSubtaskTabs[0]]);
    assert.equal(fixture.logs.filter((item) => item.event === "loop-plus-subtask-tab-auto-close-error").length, 1);
    assert.equal(fixture.logs.some((item) => item.event === "loop-plus-subtask-tab-auto-closed"
      && (item.detail as { closeAttempt?: number }).closeAttempt === 2), true);
    assert.equal(fixture.attemptCalls.at(-1)?.loopSubtaskId, "close-me");

    fixture.setCloseSubtaskTabError("模拟持续宿主关闭失败", 2);
    const retryHandle = fixture.adapter.startAttempt({ ...request, attemptId: "close-retry-after-error" });
    await retryHandle.promise;
    await retryHandle.onCompleted?.();
    assert.equal(fixture.closedSubtaskTabs.length, 1);
    const failedCloseAttempts = fixture.closeSubtaskTabAttempts.length;
    fixture.setCloseSubtaskTabError(null);
    await retryHandle.onCompleted?.();
    assert.equal(fixture.closedSubtaskTabs.length, 2);
    assert.equal(fixture.closeSubtaskTabAttempts.length, failedCloseAttempts + 1);
  } finally {
    fixture.dispose();
  }
});

test("closes a Loop+ subtask tab when the main task aborts that attempt", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const request = {
      taskId: "task-abort-tab",
      subtaskId: "abort-me",
      title: "abort-me",
      prompt: longPrompt("abort-me", "src/abort.ts"),
      modelPrompt: "model",
      writeFiles: ["src/abort.ts"],
      round: 1,
      targetCli: "codex" as const,
    };

    const controlled = fixture.adapter.startAttempt({ ...request, attemptId: "controlled-stop" });
    await waitForLoopPlus(() => fixture.parkedAttempts().length === 1, "controlled attempt parked");
    const controlledTabId = fixture.parkedAttempts()[0]?.tabId ?? "";
    controlled.abort({ closeTab: true });
    const controlledResult = await controlled.promise;
    assert.equal(controlledResult.outcome, "stopped");
    assert.deepEqual(fixture.closedSubtaskTabs, [controlledTabId]);
    assert.deepEqual(fixture.cancelledTabs, [controlledTabId]);

    const manual = fixture.adapter.startAttempt({ ...request, attemptId: "manual-stop" });
    await waitForLoopPlus(() => fixture.parkedAttempts().length === 1, "manual attempt parked");
    const manualTabId = fixture.parkedAttempts()[0]?.tabId ?? "";
    manual.abort();
    const manualResult = await manual.promise;
    assert.equal(manualResult.outcome, "stopped");
    assert.notEqual(manualTabId, controlledTabId);
    assert.deepEqual(fixture.closedSubtaskTabs, [controlledTabId]);

    fixture.setCloseSubtaskTabError("panel refresh failed");
    const failedClose = fixture.adapter.startAttempt({ ...request, attemptId: "close-error" });
    await waitForLoopPlus(() => fixture.parkedAttempts().length === 1, "close error attempt parked");
    const failedCloseTabId = fixture.parkedAttempts()[0]?.tabId ?? "";
    failedClose.abort({ closeTab: true });
    const failedCloseResult = await failedClose.promise;
    assert.equal(failedCloseResult.outcome, "stopped");
    assert.deepEqual(fixture.closedSubtaskTabs, [controlledTabId, failedCloseTabId]);
  } finally {
    fixture.dispose();
  }
});

test("continuation detail uses only the assistant inside the qualifying run", () => {
  const query = {
    taskId: "task-main",
    round: 1,
    role: "subtask" as const,
    subtaskId: "A",
  };
  const run = {
    id: "run-new",
    cli: "codex" as const,
    sessionId: "session",
    prompt: longPrompt("A", "src/a.ts"),
    startedAt: 2_000,
    endedAt: 3_000,
    durationMs: 1_000,
    status: "end" as const,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const oldMessage = {
    id: "old",
    role: "assistant" as const,
    content: "OLD_SUBTASK_RESULT",
    createdAt: 1_000,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const freshMessage = {
    ...oldMessage,
    id: "fresh",
    content: "NEW_SUBTASK_RESULT",
    createdAt: 2_500,
  };
  assert.equal(selectLoopPlusContinuationDetail([oldMessage, freshMessage], run, query), "NEW_SUBTASK_RESULT");
  assert.equal(selectLoopPlusContinuationDetail([oldMessage], run, query), null);
  assert.equal(selectLoopPlusContinuationDetail([oldMessage, freshMessage], { ...run, status: "stopped" }, query), null);
  assert.equal(selectLoopPlusContinuationDetail([oldMessage, freshMessage], { ...run, loopSubtaskId: "B" }, query), null);
  assert.equal(selectLoopPlusContinuationDetail([{
    ...freshMessage,
    loopSubtaskId: "B",
  }], run, query), null);
});

test("report failure pauses without simulating a user parent stop", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  const harness = createLoopPlusExtensionStopHarness({
    getHost: () => fixture.adapter.host(),
    readTask: (taskId) => fixture.readTask(taskId),
  });
  fixture.setCancelInvocation((tabId) => {
    harness.cancelInvocation(tabId);
  });
  try {
    assert.equal(harness.wiredCancelSource.includes("cancelLoopPlusInvocation("), true);
    assert.equal(harness.wiredCancelSource.includes("stopRunForTab("), false);
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts"), subtask("C", "src/c.ts")],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      await fixture.holdMain();
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [subtask("D", "src/d.ts")],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 3, "A B C running");
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    harness.noteTab(fixture.target.tabId, { taskRole: "main", loopTaskId: taskId });
    for (const parked of fixture.parkedAttempts()) {
      harness.noteTab(parked.tabId, { taskRole: "subtask", loopTaskId: taskId });
      harness.attachParallel(parked.tabId, {
        loopTaskId: taskId,
        taskRole: "subtask",
        onStop: () => {
          if (fixture.parkedSubtaskIds().includes(parked.subtaskId)) {
            fixture.releaseParked(parked.subtaskId);
          }
        },
      });
    }
    fixture.finishParked("A", { status: "end", content: "A attempt result" });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "review A");
    harness.attachInteractive(fixture.target.tabId, {
      loopTaskId: taskId,
      taskRole: "main",
      onStop: () => fixture.releaseHeldMain(),
    });
    fixture.setReportFailure("report failure");
    fixture.finishParked("B", { status: "end", content: "B attempt result" });
    await waitForLoopPlus(() => fixture.readTask(taskId)?.status === "error", "error pause");
    const paused = fixture.readTask(taskId);
    const snapshot = paused?.loopPlus as {
      parentStopped?: boolean;
      running?: Array<{ subtaskId: string }>;
      pending?: Array<{ subtaskId: string }>;
      currentReview?: { subtaskId?: string } | null;
    };
    assert.equal(paused?.status, "error");
    assert.equal(snapshot.parentStopped, false);
    assert.equal(snapshot.currentReview?.subtaskId, "A");
    assert.equal(snapshot.running?.some((item) => item.subtaskId === "C"), true);
    assert.equal(snapshot.running?.some((item) => item.subtaskId === "D"), false);
    assert.equal(snapshot.pending?.some((item) => item.subtaskId === "D"), false);
    assert.equal(fixture.parkedSubtaskIds().includes("C"), true);
    assert.deepEqual(fixture.cancelledTabs, [fixture.target.tabId]);
    assert.deepEqual(harness.parentStopIds, []);
    assert.deepEqual(harness.fallbackTaskIds, []);
    assert.deepEqual(harness.stoppedTabs, [fixture.target.tabId]);
    assert.equal(fixture.hostMessages.includes("loop-plus-report-failed"), true);
    assert.equal(fixture.hostMessages.includes("loop-plus-stopped"), false);
    assert.equal((paused?.subTasks ?? []).some((item) => item.id === "D"), false);
    assert.equal(fixture.mainCalls.length, 2);

    fixture.queueMain(async (input, tabId) => {
      assert.equal(input.displayPrompt.includes("subtask=A"), true);
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [],
        }),
      });
    });
    fixture.queueMain(async (input) => {
      assert.equal(input.displayPrompt.includes("subtask=B"), true);
      await fixture.holdMain();
    });
    const resumed = fixture.adapter.runEventDriven(prompt(), {
      resumeTaskId: taskId,
      resumeRequested: true,
    }, fixture.target);
    await waitForLoopPlus(() => (
      fixture.mainCalls.length >= 4 && fixture.readTask(taskId)?.status === "running"
    ), "explicit resume");
    const resumedTask = fixture.readTask(taskId);
    const resumedSnapshot = resumedTask?.loopPlus as {
      parentStopped?: boolean;
      running?: Array<{ subtaskId: string }>;
    };
    assert.equal(resumedTask?.status, "running");
    assert.equal(resumedSnapshot.parentStopped, false);
    assert.equal(resumedSnapshot.running?.some((item) => item.subtaskId === "C"), true);
    assert.equal(fixture.parkedSubtaskIds().includes("C"), true);
    assert.equal(fixture.attemptCalls.some((call) => call.loopSubtaskId === "D"), false);
    assert.equal((resumedTask?.subTasks ?? []).some((item) => item.id === "D"), false);
    assert.deepEqual(harness.parentStopIds, []);
    running.catch(() => undefined);
    resumed.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("assistant text must fall inside the actual run window and invocation anchor", () => {
  const boundary = {
    messageIds: new Set(["old-assistant", "old-user"]),
    runIds: new Set(["old-run"]),
    startedAt: 100,
  };
  const subtaskQuery = {
    taskId: "task-main",
    round: 1,
    role: "subtask" as const,
    subtaskId: "A",
    displayPrompt: "PROMPT_A",
  };
  const mainQuery = {
    taskId: "task-main",
    round: 1,
    role: "main" as const,
    displayPrompt: "PROMPT_MAIN",
  };
  const run = {
    id: "run-new",
    cli: "codex" as const,
    sessionId: "session",
    prompt: "PROMPT_A",
    startedAt: 200,
    endedAt: 300,
    durationMs: 100,
    status: "end" as const,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const mainRun = {
    ...run,
    id: "run-main",
    prompt: "PROMPT_MAIN",
    taskRole: "main" as const,
    loopSubtaskId: undefined,
  };
  const assistant = {
    role: "assistant" as const,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const mainAssistant = {
    role: "assistant" as const,
    taskRole: "main" as const,
    loopTaskId: "task-main",
    loopRound: 1,
  };
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "stale",
    content: "STALE_BEFORE_ACTUAL_RUN",
    createdAt: 150,
  }], boundary, subtaskQuery, run), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "after",
    content: "AFTER_END",
    createdAt: 350,
  }], boundary, subtaskQuery, run), null);
  assert.equal(selectLoopPlusInvocationAssistant([], boundary, subtaskQuery, run), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "fresh",
    content: "FRESH",
    createdAt: 250,
  }], boundary, subtaskQuery, run), "FRESH");
  assert.equal(selectLoopPlusInvocationAssistant([
    { ...assistant, id: "decision", content: "COMPLETE_DECISION", createdAt: 250 },
    { ...assistant, id: "thinking-tail", content: "reasoning projection", createdAt: 260, kind: "thinking" },
  ], boundary, subtaskQuery, run), "COMPLETE_DECISION");
  assert.equal(selectLoopPlusInvocationAssistant([
    { ...assistant, id: "decision", content: "COMPLETE_DECISION", createdAt: 250 },
    { ...assistant, id: "subagent-tail", content: "delegated output", createdAt: 260, subagentId: "agent-1" },
  ], boundary, subtaskQuery, run), "COMPLETE_DECISION");
  const identifiedQuery = { ...subtaskQuery, attemptId: "attempt-current" };
  const identifiedRun = { ...run, loopAttemptId: "attempt-current" };
  const identifiedAssistant = { ...assistant, loopAttemptId: "attempt-current" };
  const identifiedMessage = { ...identifiedAssistant, id: "identified", content: "IDENTIFIED", createdAt: 250 };
  assert.equal(selectLoopPlusInvocationRun([identifiedRun], boundary, identifiedQuery), identifiedRun);
  assert.equal(selectLoopPlusInvocationRun([run], boundary, identifiedQuery), null);
  assert.equal(selectLoopPlusInvocationAssistant([identifiedMessage], boundary, identifiedQuery, identifiedRun), "IDENTIFIED");
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...identifiedMessage,
    loopAttemptId: undefined,
  }], boundary, identifiedQuery, identifiedRun), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...identifiedMessage,
    loopAttemptId: "attempt-old",
  }], boundary, identifiedQuery, identifiedRun), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "old-assistant",
    content: "REUSED_ID",
    createdAt: 250,
  }], boundary, subtaskQuery, run), null);
  assert.equal(selectLoopPlusInvocationAssistant([
    { ...assistant, id: "dup", content: "FIRST", createdAt: 240 },
    { ...assistant, id: "dup", content: "SECOND", createdAt: 260 },
  ], boundary, subtaskQuery, run), null);
  const invalidRun = { ...run, startedAt: 300, endedAt: 200 };
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "fresh",
    content: "FRESH",
    createdAt: 250,
  }], boundary, subtaskQuery, invalidRun), null);
  assert.equal(selectLoopPlusInvocationRun([invalidRun], boundary, subtaskQuery), null);
  const preloadedUser = {
    id: "user-preload",
    role: "user" as const,
    content: "PROMPT_A",
    createdAt: 120,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const fresh = { ...assistant, id: "fresh", content: "FRESH", createdAt: 250 };
  assert.equal(selectLoopPlusInvocationAssistant([
    preloadedUser,
    fresh,
    {
      id: "user-other",
      role: "user" as const,
      content: "OTHER_PROMPT",
      createdAt: 280,
      taskRole: "subtask" as const,
      loopTaskId: "task-main",
      loopRound: 1,
      loopSubtaskId: "A",
    },
  ], boundary, subtaskQuery, run), "FRESH");
  assert.equal(selectLoopPlusInvocationAssistant([
    preloadedUser,
    fresh,
    { ...preloadedUser, id: "user-b", createdAt: 280, loopSubtaskId: "B" },
  ], boundary, subtaskQuery, run), "FRESH");
  assert.equal(selectLoopPlusInvocationAssistant([
    { ...preloadedUser, id: "old-user", createdAt: 50 },
    fresh,
  ], boundary, subtaskQuery, run), "FRESH");
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...mainAssistant,
    id: "main-stale",
    content: "STALE_BEFORE_ACTUAL_RUN",
    createdAt: 150,
  }], boundary, mainQuery, mainRun), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...mainAssistant,
    id: "main-after",
    content: "AFTER_END",
    createdAt: 350,
  }], boundary, mainQuery, mainRun), null);
  assert.equal(selectLoopPlusInvocationAssistant([], boundary, mainQuery, mainRun), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...mainAssistant,
    id: "main-fresh",
    content: "FRESH_MAIN",
    createdAt: 250,
  }], boundary, mainQuery, mainRun), "FRESH_MAIN");
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...mainAssistant,
    id: "old-assistant",
    content: "REUSED_ID",
    createdAt: 250,
  }], boundary, mainQuery, mainRun), null);

  const continuationQuery = {
    taskId: "task-main",
    round: 1,
    role: "subtask" as const,
    subtaskId: "A",
  };
  assert.equal(selectLoopPlusContinuationDetail([fresh], run, continuationQuery), "FRESH");
  assert.equal(selectLoopPlusContinuationDetail([{
    ...fresh,
    createdAt: 150,
    content: "STALE_BEFORE_ACTUAL_RUN",
  }], run, continuationQuery), null);
  assert.equal(selectLoopPlusContinuationDetail([{
    ...fresh,
    createdAt: 350,
    content: "AFTER_END",
  }], run, continuationQuery), null);
  assert.equal(selectLoopPlusContinuationDetail([], run, continuationQuery), null);
  assert.equal(selectLoopPlusContinuationDetail([
    { ...fresh, id: "dup", createdAt: 150, content: "OLD" },
    { ...fresh, id: "dup", createdAt: 250, content: "NEW" },
  ], run, continuationQuery), null);
});

test("main and attempt reads reject text outside the run, missing text, and reused ids", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const mainTarget = fixture.target;
    const mainRequest = {
      taskId: "task-main",
      kind: "review" as const,
      prompt: "review the bounded run",
      modelPrompt: "review the bounded run",
      reviewEventId: "event-window",
      target: mainTarget,
    };
    fixture.queueMain(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "STALE_BEFORE_ACTUAL_RUN",
        createdAt: now,
        userCreatedAt: now,
        runStartedAt: now + 1_000,
        runEndedAt: now + 2_000,
      });
    });
    assert.equal(await fixture.adapter.runMain(mainRequest).promise, null);

    fixture.queueMain(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "AFTER_END",
        createdAt: now + 3_000,
        userCreatedAt: now,
        runStartedAt: now,
        runEndedAt: now + 1_000,
      });
    });
    assert.equal(await fixture.adapter.runMain({ ...mainRequest, prompt: "review after the run" }).promise, null);

    fixture.queueMain(async () => undefined);
    assert.equal(await fixture.adapter.runMain({ ...mainRequest, prompt: "review without text" }).promise, null);

    fixture.queueMain(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "FRESH_MAIN",
        createdAt: now + 40,
        userCreatedAt: now,
        runStartedAt: now + 20,
        runEndedAt: now + 80,
      });
    });
    assert.equal(await fixture.adapter.runMain({ ...mainRequest, prompt: "review with fresh text" }).promise, "FRESH_MAIN");

    fixture.seedHistory({
      ...prompt("old main"),
      taskRole: "main",
      loopTaskId: "task-main",
      loopRound: 1,
    }, mainTarget.tabId, {
      content: "OLD_MAIN",
      status: "end",
      prompt: "old main",
      assistantId: "reused-main",
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: "REUSED_MAIN",
        assistantId: "reused-main",
      });
    });
    assert.equal(await fixture.adapter.runMain({ ...mainRequest, prompt: "review with a reused id" }).promise, null);

    const attempt = {
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "window-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex" as const,
    };
    fixture.setAttemptAction(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "STALE_BEFORE_ACTUAL_RUN",
        createdAt: now,
        userCreatedAt: now,
        runStartedAt: now + 1_000,
        runEndedAt: now + 2_000,
      });
    });
    const staleAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "stale-a" }).promise;
    assert.notEqual(staleAttempt.detail, "STALE_BEFORE_ACTUAL_RUN");

    fixture.setAttemptAction(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "AFTER_END",
        createdAt: now + 3_000,
        userCreatedAt: now,
        runStartedAt: now,
        runEndedAt: now + 1_000,
      });
    });
    const lateAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "late-window-a" }).promise;
    assert.notEqual(lateAttempt.detail, "AFTER_END");

    fixture.setAttemptAction(async () => undefined);
    const missingAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "missing-a" }).promise;
    assert.equal(missingAttempt.outcome, "failed");

    fixture.setAttemptAction(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "FRESH_ATTEMPT",
        createdAt: now + 40,
        userCreatedAt: now,
        runStartedAt: now + 20,
        runEndedAt: now + 80,
      });
    });
    const freshAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "fresh-a" }).promise;
    assert.equal(freshAttempt.outcome, "completed");
    assert.equal(freshAttempt.detail, "FRESH_ATTEMPT");

    fixture.setSubtaskTab("dup-sub");
    fixture.seedHistory({
      ...prompt("old subtask"),
      taskRole: "subtask",
      loopTaskId: "task-main",
      loopRound: 1,
      loopSubtaskId: "A",
    }, "dup-sub", {
      content: "OLD_SUBTASK_RESULT",
      status: "end",
      prompt: "old subtask",
      assistantId: "reused-attempt",
    });
    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: "REUSED_ATTEMPT",
        assistantId: "reused-attempt",
      });
    });
    const reusedAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "reused-a" }).promise;
    assert.notEqual(reusedAttempt.detail, "REUSED_ATTEMPT");
    assert.notEqual(reusedAttempt.detail, "OLD_SUBTASK_RESULT");

    fixture.setSubtaskTab(null);
    fixture.setAttemptAction(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "INVALID_WINDOW",
        createdAt: now + 50,
        runStartedAt: now + 200,
        runEndedAt: now + 100,
      });
    });
    const invalidAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "invalid-a" }).promise;
    assert.equal(invalidAttempt.outcome, "failed");
    assert.notEqual(invalidAttempt.detail, "INVALID_WINDOW");
  } finally {
    fixture.dispose();
  }
});


test("adapter manual stop waits for continuation notification before review", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }),
      });
    });
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A started");
    const attempt = fixture.peekParked("A");
    assert.ok(attempt);
    const taskId = attempt.input.loopTaskId ?? "";
    fixture.finishParked("A", { status: "stopped", content: "partial work" });
    await waitForLoopPlus(() => fixture.readTask(taskId)?.subTasks[0]?.status === "blocked", "interrupted reservation persisted");
    const interrupted = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)?.loopPlus }).snapshot();
    assert.equal(interrupted.running.length, 1);
    assert.equal(interrupted.currentReview, null);
    assert.equal(interrupted.seenAttempts[0]?.disposition, "open");
    assert.equal(fixture.mainCalls.length, 1);
    assert.deepEqual(fixture.closedSubtaskTabs, []);
    assert.doesNotMatch(reportText(fixture.rootDir), /## Attempt result/);

    fixture.publish(attempt.input, attempt.tabId, { status: "stopped", content: "interrupted again" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)?.loopPlus }).snapshot().currentReview, null);

    // The extension sends this notification only for the latest successful continuation run.
    fixture.adapter.host().notifySubtaskContinuation(taskId, "A", "completed", "continuation done");
    fixture.adapter.host().notifySubtaskContinuation(taskId, "A", "completed", "duplicate");
    await running;
    assert.equal(fixture.mainCalls.length, 2);
    assert.equal(fixture.readTask(taskId)?.status, "completed");
    const finished = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)?.loopPlus }).snapshot();
    assert.equal(finished.seenAttempts.length, 1);
    assert.equal(finished.seenAttempts[0]?.disposition, "reviewed");
    assert.equal((reportText(fixture.rootDir).match(/## Attempt result/g) ?? []).length, 1);
  } finally {
    fixture.dispose();
  }
});

test("群聊按钮在五次启动前配置锁超时后只续跑原 Loop+ 并保留验收顺序", { timeout: 5000 }, async () => {
  const configId = "original-config";
  const firstReview = createDeferred();
  let failures = 0;
  let injectHistoricalFailure = false;
  let duringPreparation: (() => Promise<void>) | undefined;
  let admissionAttempts = 0;
  const fixture = createLoopPlusRuntimeFixture({ configId, prepareConfigLockResume: async () => {
    admissionAttempts += 1;
    await duringPreparation?.();
  }, beforePromptStart: async (input) => {
    if (input.taskRole !== "main" || !injectHistoricalFailure || failures >= LOOP_MAIN_AI_FAILURE_LIMIT) return;
    await firstReview.promise;
    failures += 1;
    throw Object.assign(new Error(RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE), { code: RUNTIME_CONFIG_LOCK_TIMEOUT });
  } });
  const reviewStarted = createDeferred();
  const runReview = createDeferred();
  const finishNextReview = createDeferred();
  let restoreBarrier: { entered: ReturnType<typeof createDeferred<void>>; release: ReturnType<typeof createDeferred<void>> } | undefined;
  const runs: Promise<unknown>[] = [];
  let taskId = "";
  try {
    fixture.queueMain((input, tabId) => fixture.publish(input, tabId, {
      status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "a.ts"), subtask("B", "b.ts"), subtask("C", "c.ts"),
        { ...subtask("successor", "successor.ts"), dependsOn: ["A"] }] }),
    }));
    runs.push(fixture.adapter.runEventDriven(prompt("Verify A, B and C, then deliver the successor to A"), { schedulingMode: "event_driven" }, fixture.target));
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 3, "original child runners");
    taskId = fixture.createdTaskIds[0];
    const original = fixture.readTask(taskId)!;
    fixture.saveTask({ ...original, originProfile: { configId, mainThinkingMode: "low" }, loopSubtaskMode: "fullstack",
      modelRouting: { main: { cli: "codex", model: "main-model" }, subtask: { model: "sub-model" }, subtaskFullstack: { model: "sub-model" } } });
    injectHistoricalFailure = true;
    const snapshot = () => createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot();
    for (const child of ["A", "B", "C"]) {
      fixture.finishParked(child, { status: "end", content: `finished ${child}` });
      await waitForLoopPlus(() => !snapshot().running.some((attempt) => attempt.subtaskId === child), `${child} finish persisted`);
    }
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("successor"), "successor starts with A still awaiting review");
    fixture.finishParked("successor", { status: "end", content: "finished successor" });
    await waitForLoopPlus(() => !snapshot().running.length, "successor finish persisted");
    firstReview.resolve();
    await runs[0];
    const paused = fixture.readTask(taskId)!;
    const pausedSnapshot = snapshot();
    assert.equal(failures, LOOP_MAIN_AI_FAILURE_LIMIT);
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(paused.status, "needs-review");
    assert.equal(paused.mainAiFailureCount, LOOP_MAIN_AI_FAILURE_LIMIT);
    assert.equal(paused.mainAiLastFailureCode, RUNTIME_CONFIG_LOCK_TIMEOUT);
    assert.equal(normalizeLoopTaskRecord(JSON.parse(JSON.stringify(paused)))?.mainAiLastFailureCode, RUNTIME_CONFIG_LOCK_TIMEOUT);
    assert.equal(pausedSnapshot.currentReview?.subtaskId, "A");
    assert.deepEqual(pausedSnapshot.reviewQueue.map((review) => review.subtaskId), ["B", "C", "successor"]);
    assert.equal(pausedSnapshot.version, 1);
    assert.deepEqual(pausedSnapshot.pending, []);

    type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    type Panel = NonNullable<ReturnType<CoordinatorDeps["panelsByTaskId"]["get"]>>;
    const warnings: string[] = [];
    let busy = false;
    let targetSession = fixture.target.sessionId;
    let restores = 0;
    let submissions = 0;
    let applySettlement: ((message: { canContinue: boolean }) => void) | undefined;
    let state: ReturnType<typeof buildLoopGroupChatPanelState>;
    const panel = {
      getState: () => state, setAskThread: () => undefined,
      update: (latest: typeof state) => { state = latest; },
      post: (message: { type: string; canContinue: boolean }) => {
        if (message.type === "loopGroupChatChat:continueTaskSettled") applySettlement?.(message);
      },
    } as unknown as Panel;
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: fixture.rootDir } as ReturnType<CoordinatorDeps["getExtensionUri"]>),
      panelsByTaskId: new Map([[taskId, panel]]),
      normalizeTaskId: (value: unknown) => typeof value === "string" ? value : null,
      normalizeSupplementalRequirement: () => null,
      appendSupplementalRequirement: () => [],
      appendSupplementalRequirementToCommunication: () => undefined,
      recordPromptHistory: () => undefined,
      readTaskRecord: fixture.readTask,
      updateTaskRecord: () => null,
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set(fixture.adapter.host().collectRunningTaskIds()),
      resolveMainPromptTarget: () => fixture.target,
      isTabRunActive: () => busy,
      isConfigLockResumeSessionAvailable: (task, restoredTabId) => !busy && task.workspaceKey === "workspace"
        && task.sessionId === targetSession && (!restoredTabId || restoredTabId === fixture.target.tabId),
      getActiveConfigIdForCli: () => configId,
      getSelectedCliModel: () => "main-model",
      restoreOriginalLoopRuntime: async (_task, options) => {
        assert.equal(options?.configLockRecovery, true);
        assert.equal(options?.originalTabId, fixture.target.tabId);
        restores += 1;
        if (restoreBarrier) { restoreBarrier.entered.resolve(); await restoreBarrier.release.promise; }
        return { ok: true, target: fixture.target,
          isOriginalTargetCurrent: () => true, codexConfigEvidence: { identity: "fixture-native-identity", provider: null } };
      },
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      runLoopPrompt: async (input, options) => {
        submissions += 1;
        assert.equal(options.preserveLoopOrigin, true);
        assert.equal(options.resumeRequested, true);
        assert.equal(options.resumeTaskId, taskId);
        assert.equal("configSelections" in input, false);
        await fixture.adapter.runEventDriven(input, options, fixture.target);
      },
      getActiveSubtaskIds: () => [],
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => null,
      getActiveConversationTaskId: () => taskId,
      postPanelState: async () => undefined,
      pickTask: async () => null,
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      showInformationMessage: () => undefined,
      showWarningMessage: (message) => { warnings.push(message); },
      t: (key: string) => key,
    };
    const coordinator = createLoopGroupChatPanelCoordinator(deps);
    state = buildLoopGroupChatPanelState(paused, deps);
    const message = { type: "loopGroupChatChat:continueTask", prompt: "继续原任务" } as const;
    assert.equal(state.task.canContinue, true);
    assert.equal(state.task.canSupplement, false);
    assert.equal(isLoopTaskPromptResumeCandidate(paused, { hasCompleteCompletionMessages: false }), false);
    await coordinator.continueTask(taskId, "普通入口不能解锁");
    await coordinator.handleMessage(taskId, message);
    fixture.adapter.host().checkWaitingTasks();
    assert.equal(restores, 0);
    assert.equal(fixture.mainCalls.length, 1);

    const stopped = createLoopPlusScheduler({ snapshot: paused.loopPlus });
    stopped.stopParent();
    const reserved = createLoopPlusScheduler({ snapshot: paused.loopPlus });
    assert.equal(reserved.dispatch([{ subtaskId: "dependent", attemptId: "not-yet-owned", writeFiles: ["dependent.ts"] }]).started.length, 1);
    assert.equal(buildLoopGroupChatPanelState({ ...paused, mainAiLastFailureCode: undefined,
      mainAiLastFailureMessage: RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE }, deps).task.canContinue, true);
    for (const patch of [
      { status: "completed" }, { status: "stopped" }, { cli: "opencode" }, { departmentInvalid: true },
      { workspaceKey: "other" }, { sessionId: null }, { originProfile: { configId: "" } },
      { loopPlus: undefined }, { loopPlus: {} }, { loopPlus: stopped.snapshot() }, { loopPlus: reserved.snapshot() },
      { pendingClarification: { interactionId: "required", title: "澄清", instruction: "等待回答", formFields: [], submitLabel: "提交", cancelLabel: "取消" } },
      { mainAiLastFailureCode: "SESSION_RUN_ACTIVE" }, { mainAiLastFailureCode: null },
      { mainAiLastFailureCode: undefined, mainAiLastFailureMessage: `prefix ${RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE}` },
    ] as Partial<LoopTaskRecord>[]) {
      const ineligible = { ...paused, ...patch };
      fixture.saveTask(ineligible);
      state = buildLoopGroupChatPanelState(ineligible, deps);
      assert.equal(state.task.canContinue, false, JSON.stringify(patch));
      await coordinator.handleMessage(taskId, message, panel);
    }
    fixture.saveTask(paused);
    busy = true;
    state = buildLoopGroupChatPanelState(paused, deps);
    assert.equal(state.task.canContinue, false);
    await coordinator.handleMessage(taskId, message, panel);
    assert.equal(restores, 0);
    busy = false;
    state = buildLoopGroupChatPanelState(paused, deps);

    injectHistoricalFailure = false;

    for (const changed of ["target", "record"]) {
      restoreBarrier = { entered: createDeferred(), release: createDeferred() };
      const stale = coordinator.handleMessage(taskId, message, panel);
      await restoreBarrier.entered.promise;
      if (changed === "target") targetSession = "different-session";
      else fixture.saveTask({ ...paused, originProfile: { configId: "different-config" } });
      restoreBarrier.release.resolve();
      await stale;
      assert.equal(fixture.readTask(taskId)?.status, "needs-review");
      assert.equal(fixture.readTask(taskId)?.mainAiFailureCount, LOOP_MAIN_AI_FAILURE_LIMIT);
      assert.deepEqual(snapshot(), pausedSnapshot);
      assert.equal(submissions, 0);
      if (changed === "record") assert.equal(fixture.readTask(taskId)?.originProfile?.configId, "different-config");
      fixture.saveTask(paused);
      targetSession = fixture.target.sessionId;
      state = buildLoopGroupChatPanelState(paused, deps);
    }
    restoreBarrier = undefined;

    const queued = createLoopPlusScheduler({ snapshot: pausedSnapshot });
    const parkedAttempt = { subtaskId: "pending-child", attemptId: "pending-child-attempt" };
    assert.equal(queued.dispatch([parkedAttempt]).started.length, 1);
    assert.equal(queued.releaseUnstarted([parkedAttempt.attemptId]).released.length, 1);
    fixture.saveTask({ ...paused, loopPlus: queued.snapshot() });
    assert.equal(snapshot().pending.length, 1);
    fixture.saveTask(paused);
    for (const change of ["session", "busy"] as const) {
      const entered = createDeferred();
      const prepared = createDeferred();
      const before = structuredClone(fixture.readTask(taskId));
      const warningCount = warnings.length;
      duringPreparation = async () => { entered.resolve(); await prepared.promise; };
      const refused = coordinator.handleMessage(taskId, message, panel);
      await entered.promise;
      assert.deepEqual(fixture.readTask(taskId), before);
      if (change === "busy") busy = true;
      else targetSession = "rebound-during-preflight";
      prepared.resolve();
      await refused;
      assert.equal(warnings.length, warningCount + 1);
      assert.deepEqual(fixture.readTask(taskId), before);
      assert.equal(fixture.mainCalls.length, 1);
      assert.equal(fixture.attemptCalls.length, 4);
      busy = false;
      targetSession = fixture.target.sessionId;
    }
    duringPreparation = undefined;
    state = buildLoopGroupChatPanelState(paused, deps);
    const rejectedSubmissions = submissions;
    const rejectedAdmissions = admissionAttempts;

    const html = buildLoopGroupChatPanelHtml({ cspSource: "self" } as Parameters<typeof buildLoopGroupChatPanelHtml>[0], state);
    assert.match(html, /<button class="button primary"[^>]*data-action="continueTask"[^>]*>继续执行<span[^>]*role="status"[^>]*hidden>/u);
    const loading = { hidden: true };
    const attributes = new Map<string, string>();
    const button = {
      disabled: false,
      querySelector: () => loading,
      setAttribute: (key: string, value: string) => { attributes.set(key, value); },
      hasAttribute: (key: string) => attributes.has(key),
      removeAttribute: (key: string) => { attributes.delete(key); },
    };
    const input = { value: "", focus: () => undefined, select: () => undefined };
    const source = html.slice(html.indexOf("function openContinueDialog"), html.indexOf("function submitSupplementDialog"));
    const actions = vm.runInNewContext(`${source}\n({openContinueDialog, submitContinueDialog, applyContinueTaskSettled})`, {
      continueDialogBackdrop: { classList: { add: () => undefined, remove: () => undefined }, setAttribute: () => undefined },
      continueDialogInput: input, continueDialogConfirm: { dataset: {} }, continueDialogOpen: false,
      continueDialogMode: undefined, continueDialogOpener: null, continueRequestPending: false,
      continueRequestId: null, requestSessionId: "fixture", requestSequence: 0,
      actionButton: () => button, window: {}, document: { activeElement: button },
      setContinueDialogError: () => undefined, saveDialogState: () => undefined, requestRefresh: () => undefined,
      clearDialogState: () => undefined,
      vscode: { postMessage: (payload: typeof message) => { runs.push(coordinator.handleMessage(taskId, payload, panel)); } },
    }) as { openContinueDialog: () => void; submitContinueDialog: () => void; applyContinueTaskSettled: typeof applySettlement };
    applySettlement = actions.applyContinueTaskSettled;
    const predecessorEventId = pausedSnapshot.currentReview!.eventId;
    fixture.queueMain(async (input, tabId) => {
      assert.equal(input.loopTaskId, taskId);
      assert.equal(tabId, fixture.target.tabId);
      assert.equal(targetSession, fixture.target.sessionId);
      assert.equal(input.loopMainModel, "main-model");
      assert.equal(currentEventId(input.displayPrompt), pausedSnapshot.currentReview?.eventId);
      reviewStarted.resolve();
      await runReview.promise;
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "accept", reviewEventIds: [predecessorEventId],
        reviews: [{ reviewEventId: predecessorEventId, acceptance: "passed", reason: "Synthetic result verified" }],
        acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() } }) });
    });
    fixture.queueMain(async () => finishNextReview.promise);
    actions.openContinueDialog();
    actions.submitContinueDialog();
    actions.submitContinueDialog();
    assert.equal(button.disabled, true);
    assert.equal(loading.hidden, false);
    const resumed = runs.at(-1)!;
    await coordinator.handleMessage(taskId, message, panel);
    await Promise.race([reviewStarted.promise, resumed.then(() => {
      assert.fail(`original review did not start: ${warnings.at(-1)}; ${fixture.readTask(taskId)?.finalSummary}`);
    })]);
    assert.equal(submissions, rejectedSubmissions + 1);
    assert.equal(admissionAttempts, rejectedAdmissions + 1);
    assert.equal(fixture.mainCalls.length, 2);
    assert.deepEqual(fixture.createdTaskIds, [taskId]);
    assert.deepEqual(fixture.readTask(taskId)?.modelRouting, paused.modelRouting);
    assert.deepEqual(snapshot().currentReview, pausedSnapshot.currentReview);
    assert.deepEqual(snapshot().reviewQueue, pausedSnapshot.reviewQueue);
    assert.deepEqual(snapshot().pending, []);
    try {
      runReview.resolve();
      await waitForLoopPlus(() => snapshot().currentReview?.subtaskId === "B", "next review starts after accepting A");
      const advanced = snapshot();
      assert.deepEqual(advanced.seenAttempts.filter((item) => item.disposition === "reviewed").map((item) => item.subtaskId), ["A"]);
      assert.deepEqual([advanced.currentReview, ...advanced.reviewQueue].filter(Boolean), pausedSnapshot.reviewQueue);
      assert.deepEqual(fixture.attemptCalls.map((input) => input.loopSubtaskId), ["A", "B", "C", "successor"]);
    } finally {
      fixture.adapter.host().stopParent(taskId);
      finishNextReview.resolve();
    }
    await resumed;
  } finally {
    firstReview.resolve();
    restoreBarrier?.release.resolve();
    fixture.adapter.host().stopParent(taskId);
    runReview.resolve();
    finishNextReview.resolve();
    await Promise.allSettled(runs);
    fixture.dispose();
  }
});

test("群聊在活跃同级结束前拒绝恢复中断子任务", { timeout: 5000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture();
  let originalRun: Promise<boolean> | undefined;
  try {
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")] }),
      });
    });
    fixture.queueMain(async (input) => {
      assert.match(input.displayPrompt, /继续执行/u);
      await fixture.holdMain();
    });
    originalRun = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 2, "初始子任务启动");
    const taskId = fixture.mainCalls[0].loopTaskId!;
    const before = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)?.loopPlus }).snapshot();
    const originalRouting = JSON.stringify(fixture.readTask(taskId)?.modelRouting);
    const originalTargetCount = fixture.createdSubtaskTargets.length;
    fixture.finishParked("A", { status: "stopped", content: "手动中断" });
    await waitForLoopPlus(() => fixture.readTask(taskId)?.subTasks[0]?.status === "blocked", "中断状态落盘");

    const coordinator = createLoopGroupChatPanelCoordinator({
      panelsByTaskId: new Map(),
      normalizeTaskId: (value: unknown) => typeof value === "string" ? value : null,
      readTaskRecord: fixture.readTask,
      updateTaskRecord: (id: string, patch: Record<string, unknown>) => {
        const task = fixture.readTask(id);
        if (!task) return null;
        const updated = { ...task, ...patch, updatedAt: Date.now() };
        fixture.saveTask(updated);
        return updated;
      },
      collectRunningTaskIds: () => new Set(fixture.adapter.host().collectRunningTaskIds()),
      resolveMainPromptTarget: () => fixture.target,
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => false,
      getActiveConfigIdForCli: () => null,
      getSelectedCliModel: () => "main-model",
      resumeLoopSubtasks: (id: string) => fixture.adapter.host().resumeInterruptedSubtasks(id),
      notifyLoopPlusUserMessage: (id: string, text: string) => { fixture.adapter.host().submitUserMessage(id, text); },
      runLoopPrompt: (input: unknown, options: Record<string, unknown>) => {
        return fixture.adapter.runEventDriven(input as any, options as any, fixture.target);
      },
      showInformationMessage: () => undefined,
      showWarningMessage: (message: string) => { throw new Error(message); },
      t: (key: string) => key,
    } as any);

    const beforeCalls = fixture.mainCalls.length;
    await coordinator.handleMessage(taskId, { type: "loopGroupChatChat:continueTask", prompt: "继续执行" });
    assert.equal(fixture.mainCalls.length, beforeCalls);
    assert.deepEqual(fixture.parkedSubtaskIds(), ["B"]);
    const after = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)?.loopPlus }).snapshot();
    assert.deepEqual(after.running.map((attempt) => attempt.attemptId).sort(), before.running.map((attempt) => attempt.attemptId).sort());
    assert.equal(fixture.createdSubtaskTargets.length, originalTargetCount);
    assert.equal(JSON.stringify(fixture.readTask(taskId)?.modelRouting), originalRouting);
    fixture.adapter.host().stopParent(taskId);
    fixture.releaseHeldMain();
    await originalRun;
    await waitForLoopPlus(() => fixture.completionSubscriptionCount() === 0, "停止后释放恢复子任务的完成订阅");
    assert.equal(fixture.completionSubscriptionCount(), 0);
  } finally {
    fixture.adapter.host().stopParent(fixture.mainCalls[0]?.loopTaskId ?? "");
    await Promise.allSettled([originalRun].filter((run): run is Promise<boolean> => Boolean(run)));
    fixture.dispose();
  }
});

test("切模型消息经真实 adapter 唤醒主模型并保留正在运行的子任务", { timeout: 5000 }, async () => {
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile" });
  let originalRun: Promise<boolean> | undefined;
  let switchingRun: Promise<void> | undefined;
  try {
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }),
      });
    });
    fixture.queueMain(async () => { await fixture.holdMain(); });
    originalRun = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "切模型前子任务已启动");
    const taskId = fixture.mainCalls[0].loopTaskId!;
    const coordinator = createLoopGroupChatPanelCoordinator({
      panelsByTaskId: new Map(),
      normalizeTaskId: (value: unknown) => typeof value === "string" ? value : null,
      readTaskRecord: fixture.readTask,
      updateTaskRecord: (id: string, patch: Record<string, unknown>) => {
        const task = fixture.readTask(id);
        if (!task) return null;
        const updated = { ...task, ...patch, updatedAt: Date.now() };
        fixture.saveTask(updated);
        return updated;
      },
      collectRunningTaskIds: () => new Set(fixture.adapter.host().collectRunningTaskIds()),
      resolveMainPromptTarget: () => fixture.target,
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => false,
      getActiveConfigIdForCli: () => "profile",
      getSelectedCliModel: () => "main-model",
      getLoopModelSwitchOptions: () => ["new-main", "main-model", "sub-model"].map((value) => ({ value, label: value })),
      restoreOriginalLoopRuntime: async () => ({ ok: true, target: fixture.target }),
      resumeLoopSubtasks: (id: string) => fixture.adapter.host().resumeInterruptedSubtasks(id),
      runLoopPrompt: (input: unknown, options: Record<string, unknown>) => {
        switchingRun = fixture.adapter.runEventDriven(input as any, options as any, fixture.target).then(() => undefined);
        return switchingRun;
      },
      showInformationMessage: () => undefined,
      showWarningMessage: (message: string) => { throw new Error(message); },
      t: (key: string) => key,
    } as any);

    const handling = coordinator.handleMessage(taskId, {
      type: "loopGroupChatChat:switchModels",
      models: { main: "new-main", fullstack: "new-main" },
    });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "切模型触发主模型执行");
    assert.equal(fixture.mainCalls[1]?.loopMainModel, "new-main");
    assert.deepEqual(fixture.parkedSubtaskIds(), ["A"]);
    fixture.adapter.host().stopParent(taskId);
    fixture.releaseHeldMain();
    await Promise.all([handling, originalRun, switchingRun]);
    await waitForLoopPlus(() => fixture.completionSubscriptionCount() === 0, "停止后释放完成订阅");
    assert.equal(fixture.completionSubscriptionCount(), 0);
  } finally {
    fixture.adapter.host().stopParent(fixture.mainCalls[0]?.loopTaskId ?? "");
    fixture.releaseHeldMain();
    await Promise.allSettled([originalRun, switchingRun].filter((run): run is Promise<any> => Boolean(run)));
    fixture.dispose();
  }
});


test("combined accept registers the new prerequisite before filling slots freed by controls", async () => {
  const fixture = createLoopPlusRuntimeFixture({ maxConcurrency: 2 });
  let running: Promise<unknown> | undefined;
  try {
    fixture.queueMain((input, tabId) => fixture.publish(input, tabId, {
      status: "end", content: decision({ status: "dispatch", subtasks: [subtask("P", "p.ts"), subtask("X", "b.ts"),
        { ...subtask("B", "b.ts"), dependsOn: ["P"] }, subtask("C", "c.ts")] }),
    }));
    fixture.queueMain((input, tabId) => {
      const reviewEventId = currentEventId(input.displayPrompt);
      fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "accept", reviewEventId,
          reviews: [{ reviewEventId, acceptance: "passed", subtaskIds: ["P"] }],
          controls: [{ id: "X", action: "close" }], subtasks: [subtask("P", "p.ts")] }),
      });
    });
    fixture.queueMain((input, tabId) => fixture.publish(input, tabId, {
      status: "end", content: decision({ status: "accept", reviewEventId: currentEventId(input.displayPrompt) }),
    }));
    running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 2, "old P and X running");
    const oldAttemptId = fixture.peekParked("P")!.input.loopAttemptId;
    const taskId = fixture.createdTaskIds[0];
    const snapshot = () => createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot();
    fixture.finishParked("P", { status: "end", content: "old P complete" });
    await waitForLoopPlus(() => fixture.peekParked("P")?.input.loopAttemptId !== undefined
      && fixture.peekParked("P")?.input.loopAttemptId !== oldAttemptId, "new P starts after closing X");
    assert.deepEqual(snapshot().running.map(item => item.subtaskId).sort(), ["C", "P"]);
    assert.deepEqual(snapshot().pending.map(item => item.subtaskId), ["B"]);
    assert.equal(snapshot().seenAttempts.find(item => item.subtaskId === "X")?.disposition, "closed");
    assert.equal(snapshot().seenAttempts.find(item => item.attemptId === oldAttemptId)?.acceptance, "passed");
    assert.equal(fixture.parkedSubtaskIds().includes("B"), false);
    fixture.finishParked("P", { status: "end", content: "new P complete" });
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("B"), "B starts after latest P finishes");
    assert.deepEqual(snapshot().running.map(item => item.subtaskId).sort(), ["B", "C"]);
    assert.equal(snapshot().pending.length, 0);
  } finally {
    fixture.adapter.host().stopParent(fixture.createdTaskIds[0] ?? "");
    await running;
    fixture.dispose();
  }
});

test("main reprompt closes an interrupted tab, resumes its session and closes the replacement on completion", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }),
      });
    });
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end", content: decision({ status: "steer", controls: [{
          id: "A", action: "reprompt", title: "修正后重新执行", prompt: longPrompt("A revised", "src/a.ts"),
        }] }),
      });
    });
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: completedDecision(currentEventId(input.displayPrompt)) });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "original attempt started");
    const original = fixture.createdSubtaskTargets[0];
    original.sessionId = "control-resume-session";
    const taskId = fixture.peekParked("A")?.input.loopTaskId ?? "";
    fixture.finishParked("A", { status: "stopped", content: "等待纠正" });
    await waitForLoopPlus(() => fixture.readTask(taskId)?.subTasks[0]?.status === "blocked", "original attempt interrupted");
    assert.deepEqual(fixture.closedSubtaskTabs, []);
    assert.equal(fixture.adapter.host().submitUserMessage(taskId, "请纠正后重新执行 A"), true);
    await waitForLoopPlus(() => fixture.createdSubtaskTargets.length === 2 && fixture.parkedSubtaskIds().includes("A"), "replacement started");
    const replacement = fixture.createdSubtaskTargets[1];
    assert.notEqual(replacement.tabId, original.tabId);
    assert.equal(replacement.sessionId, original.sessionId);
    assert.deepEqual(fixture.closedSubtaskTabs, [original.tabId]);
    fixture.finishParked("A", { status: "end", content: "纠正完成" });
    await running;
    assert.deepEqual(fixture.closedSubtaskTabs, [original.tabId, replacement.tabId]);
    assert.equal(fixture.readTask(taskId)?.status, "completed");
  } finally {
    fixture.dispose();
  }
});

for (const closeAfterSettled of [false, true]) {
  test(`main control upgrades an earlier stop to tab cleanup ${closeAfterSettled ? "after" : "before"} the attempt settles`, async () => {
    const fixture = createLoopPlusRuntimeFixture();
    try {
      const attempt = fixture.adapter.startAttempt({
        taskId: "stopped-control", subtaskId: "A", attemptId: "A-1", title: "A",
        prompt: longPrompt("A", "src/a.ts"), modelPrompt: "model", writeFiles: ["src/a.ts"],
        round: 1, targetCli: "codex",
      });
      await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "attempt started");
      const tabId = fixture.peekParked("A")?.tabId ?? "";
      fixture.setCancelInvocation(() => undefined);
      attempt.abort();
      if (closeAfterSettled) {
        fixture.finishParked("A", { status: "stopped" });
        assert.equal((await attempt.promise).outcome, "stopped");
      }
      assert.deepEqual(fixture.closedSubtaskTabs, []);
      attempt.abort({ closeTab: true });
      if (!closeAfterSettled) {
        fixture.finishParked("A", { status: "stopped" });
        assert.equal((await attempt.promise).outcome, "stopped");
      }
      await waitForLoopPlus(() => fixture.closedSubtaskTabs.includes(tabId), "stopped tab closed");
      attempt.abort({ closeTab: true });
      assert.deepEqual(fixture.closedSubtaskTabs, [tabId]);
      assert.deepEqual(fixture.cancelledTabs, [tabId]);
    } finally {
      fixture.dispose();
    }
  });
}

test("main control closes an already interrupted attempt tab", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const attempt = fixture.adapter.startAttempt({
      taskId: "interrupted-control", subtaskId: "A", attemptId: "A-1", title: "A",
      prompt: longPrompt("A", "src/a.ts"), modelPrompt: "model", writeFiles: ["src/a.ts"],
      round: 1, targetCli: "codex",
    });
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "attempt started");
    const tabId = fixture.peekParked("A")?.tabId ?? "";
    fixture.finishParked("A", { status: "stopped" });
    assert.equal((await attempt.promise).outcome, "stopped");
    assert.deepEqual(fixture.closedSubtaskTabs, []);
    attempt.abort({ closeTab: true });
    await waitForLoopPlus(() => fixture.closedSubtaskTabs.includes(tabId), "interrupted tab closed");
    assert.deepEqual(fixture.cancelledTabs, []);
    attempt.abort({ closeTab: true });
    assert.deepEqual(fixture.closedSubtaskTabs, [tabId]);
  } finally {
    fixture.dispose();
  }
});

for (const conflict of [false, true]) test(`Department Codex writeback ${conflict ? "rejects stale target without overwriting Owner" : "preserves confirmed continuation binding"}`, async () => {
  const fixture = createLoopPlusRuntimeFixture({ configId: "profile", ownsDepartmentAttemptResources: () => true });
  let quarantines = 0, releases = 0;
  try {
    fixture.saveTask({ id: "leader", cli: "codex", status: "running", workspaceKey: "workspace", subTasks: [
      { id: "source", title: "source", status: "completed", executionSession: { cli: "codex", configId: "profile", sessionId: "original" } },
      { id: "next", title: "next", status: "running", continueFromSubtaskId: "source" },
    ], department: { role: "leader" } } as LoopTaskRecord);
    fixture.adapter.setDepartmentExecutionAdmission!(async () => ({ release() { releases++; }, cleanupFailed() { quarantines++; } }));
    fixture.setAttemptAction((input, tabId) => {
      const task = fixture.readTask("leader")!;
      fixture.saveTask({ ...task, subTasks: task.subTasks.map((s) => s.id === "next" ? { ...s,
        executionSession: { cli: "codex", configId: "profile", sessionId: conflict ? "owner-native" : "original" } } : s) });
      fixture.publish(input, tabId, { status: "end", content: "done" });
    });
    const handle = fixture.adapter.startAttempt({ taskId: "leader", subtaskId: "next", attemptId: "attempt",
      continueFromSubtaskId: "source", targetCli: "codex", title: "next", prompt: "next", modelPrompt: "next", writeFiles: [], round: 1 });
    const result = await handle.promise;
    assert.equal(result.outcome, conflict ? "failed" : "completed");
    assert.equal(fixture.readTask("leader")!.subTasks[1].executionSession!.sessionId, conflict ? "owner-native" : "original");
    assert.equal(quarantines, conflict ? 1 : 0); assert.equal(releases, conflict ? 0 : 1);
  } finally { fixture.dispose(); }
});

test("本机子进程异常退出且完成 Promise 丢失时，巡检保留子任务供显式续跑", { timeout: 5000 }, async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  let active = true;
  let exited = false;
  let releaseLate!: () => void;
  const late = new Promise<void>((resolve) => { releaseLate = resolve; });
  const fixture = createLoopPlusRuntimeFixture({ isInvocationActive: () => active });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    fixture.setAttemptAction(async () => {
      child = spawn(process.execPath, ["-e", "process.exit(9)"], { stdio: "ignore" });
      await new Promise<void>((resolve, reject) => {
        child!.once("error", reject);
        child!.once("exit", (code) => {
          assert.equal(code, 9);
          active = false;
          exited = true;
          resolve();
        });
      });
      await late; // 模拟进程已退出，但调用方遗失了完成通知。
    });
    fixture.queueMain((input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("crashed", "src/crashed.ts")] }) });
    });
    fixture.queueMain(async () => { await fixture.holdMain(); });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => child !== undefined, "真实子进程启动");
    await new Promise<void>((resolve, reject) => {
      if (exited) resolve();
      else {
        child!.once("exit", () => resolve());
        child!.once("error", reject);
      }
    });
    const taskId = fixture.mainCalls[0].loopTaskId!;
    fixture.adapter.host().checkWaitingTasks();
    assert.equal(fixture.mainCalls.length, 1);
    now += 5 * 60 * 1000;
    fixture.adapter.host().checkWaitingTasks();
    await waitForLoopPlus(() => fixture.rootsDisposed.length === 1, "失联调用释放执行根");
    const snapshot = createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot();
    assert.equal(snapshot.currentReview, null);
    assert.equal(snapshot.running.length, 1);
    assert.equal(fixture.readTask(taskId)?.subTasks[0]?.status, "blocked");
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(fixture.completionSubscriptionCount(), 0);
    await withLoopSubtaskSession("codex", null, async () => undefined, { taskId, subtaskId: "crashed" });
    const communicationFile = fixture.readTask(taskId)!.subTasks[0].communicationFile!;
    assert.doesNotMatch(fs.readFileSync(communicationFile, "utf8"), /outcome: failed/);
    const attemptId = snapshot.running[0]!.attemptId;
    assert.equal(fixture.adapter.host().notifySubtaskContinuation(
      taskId, "crashed", "completed", "显式续跑后完成", undefined, undefined, attemptId,
    ), true);
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "续跑完成后进入子任务验收");
    assert.equal(createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot().currentReview?.outcome, "completed");
    releaseLate();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.mainCalls.length, 2);
    assert.equal(createLoopPlusScheduler({ snapshot: fixture.readTask(taskId)!.loopPlus }).snapshot().currentReview?.outcome, "completed");
    fixture.adapter.host().stopParent(taskId);
    await running;
  } finally {
    releaseLate();
    child?.kill();
    fixture.dispose();
  }

});
