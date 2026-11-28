import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { performance } from "node:perf_hooks";
import type { TestContext } from "node:test";
import { createLoopOrchestrationHost, LOOP_SUBTASK_RETRY_DELAY_MS, LOOP_SUBTASK_RETRY_MAX_RETRIES } from "../../extensionHost/loopOrchestration";
import type { TaskRunRecord } from "../../promptRunState";
import { startLoopWaitWatchdog, waitForLoopInvocation } from "../../loopWaitWatchdog";
import { buildLoopSubtaskExecutionPlan } from "../../loopParallel";
import { isLoopSubtaskProcessLost, observeLoopSubtaskProcess, recordLoopSubtaskProcessResult } from "../../loopSubtaskProcessActivity";
import type { RunProcess } from "../../cli/commandRunner";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { PromptRunInput } from "../../promptRunTypes";

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function failOnWatchdogError(error: unknown): never {
  throw error;
}

function mockWatchdogClock(t: TestContext) {
  // 当前 @types/node 仍描述旧版参数；运行时使用 Node 24 的对象接口。
  t.mock.timers.enable({ apis: ["setInterval"] } as never);
  let now = 0;
  t.mock.method(performance, "now", () => now);
  return {
    tick: (elapsedMs: number, timerMs = elapsedMs): void => {
      now += elapsedMs;
      t.mock.timers.tick(timerMs);
    },
  };
}

test("Loop+ 主任务每 60 秒巡检，旧等待每 300 秒巡检，释放后均停止", (t) => {
  const clock = mockWatchdogClock(t);
  const counts = { main: 0, classic: 0, plusWait: 0 };
  const stop = startLoopWaitWatchdog([
    () => { counts.classic++; },
    () => { counts.plusWait++; },
  ], failOnWatchdogError, [() => { counts.main++; }]);
  assert.deepEqual(counts, { main: 0, classic: 0, plusWait: 0 });
  clock.tick(59_999);
  assert.deepEqual(counts, { main: 0, classic: 0, plusWait: 0 });
  clock.tick(1);
  assert.deepEqual(counts, { main: 1, classic: 0, plusWait: 0 });
  for (let minute = 0; minute < 3; minute++) clock.tick(60_000);
  clock.tick(59_999);
  assert.deepEqual(counts, { main: 4, classic: 0, plusWait: 0 });
  clock.tick(1);
  assert.deepEqual(counts, { main: 5, classic: 1, plusWait: 1 });
  for (let minute = 0; minute < 5; minute++) clock.tick(60_000);
  assert.deepEqual(counts, { main: 10, classic: 2, plusWait: 2 });
  stop();
  clock.tick(300_000);
  assert.deepEqual(counts, { main: 10, classic: 2, plusWait: 2 });
});

test("长时间漏拍后首次回调只巡检一次旧等待，并从恢复时重新计时", (t) => {
  const clock = mockWatchdogClock(t);
  let main = 0;
  let wait = 0;
  const stop = startLoopWaitWatchdog([
    () => { wait++; },
  ], failOnWatchdogError, [() => { main++; }]);
  t.after(stop);
  clock.tick(60_000);
  assert.deepEqual([main, wait], [1, 0]);
  clock.tick(1_020_500, 60_000);
  assert.deepEqual([main, wait], [2, 1]);
  for (let minute = 0; minute < 4; minute++) {
    clock.tick(60_000);
    assert.deepEqual([main, wait], [3 + minute, 1]);
  }
  clock.tick(59_999);
  assert.deepEqual([main, wait], [6, 1]);
  clock.tick(1);
  assert.deepEqual([main, wait], [7, 2]);
});

test("主任务和旧等待巡检的异常分别上报，其它检查继续执行", (t) => {
  const clock = mockWatchdogClock(t);
  const mainError = new Error("主任务巡检失败");
  const classicError = new Error("经典 Loop 巡检失败");
  const errors: unknown[] = [];
  let main = 0;
  let reviews = 0;
  let plusWait = 0;
  const stop = startLoopWaitWatchdog([
    () => { throw classicError; },
    () => { plusWait++; },
  ], (error) => { errors.push(error); }, [() => {
    if (++main === 5) throw mainError;
  }, () => { reviews++; }]);
  t.after(stop);
  for (let minute = 0; minute < 5; minute++) clock.tick(60_000);
  assert.equal(errors.length, 2);
  assert.ok(errors.includes(mainError));
  assert.ok(errors.includes(classicError));
  assert.equal(reviews, 5);
  assert.equal(plusWait, 1);
  clock.tick(60_000);
  assert.equal(main, 6);
  assert.equal(errors.length, 2);
  assert.equal(plusWait, 1);
});

test("两参数调用仍只在 300 秒边界执行旧等待巡检", (t) => {
  const clock = mockWatchdogClock(t);
  const calls: string[] = [];
  const stop = startLoopWaitWatchdog([
    () => { calls.push("classic"); },
    () => { calls.push("plusWait"); },
  ], failOnWatchdogError);
  clock.tick(60_000);
  assert.deepEqual(calls, []);
  for (let minute = 0; minute < 3; minute++) clock.tick(60_000);
  clock.tick(59_999);
  assert.deepEqual(calls, []);
  clock.tick(1);
  assert.deepEqual(calls, ["classic", "plusWait"]);
  stop();
  clock.tick(300_000);
  assert.deepEqual(calls, ["classic", "plusWait"]);
});

test("宿主只注册一个 60 秒 interval 并调用 unref", (t) => {
  const interval = t.mock.method(globalThis, "setInterval");
  const stop = startLoopWaitWatchdog([], failOnWatchdogError, [assert.fail]);
  try {
    assert.equal(interval.mock.callCount(), 1);
    const [call] = interval.mock.calls;
    assert.equal(call.arguments[1], 60_000);
    assert.equal(call.result?.hasRef(), false);
  } finally {
    stop();
  }
});

test("同一拍释放看门狗后不执行余下的检查", (t) => {
  const clock = mockWatchdogClock(t);
  let main = 0;
  let reviews = 0;
  const stop = startLoopWaitWatchdog([assert.fail], failOnWatchdogError, [() => {
    if (++main === 5) stop();
  }, () => { reviews++; }]);
  for (let minute = 0; minute < 5; minute++) clock.tick(60_000);
  clock.tick(300_000);
  assert.equal(main, 5);
  assert.equal(reviews, 4);
});

test("失联等待可取消并消费迟到的拒绝结果", async () => {
  const controller = new AbortController();
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const waiting = waitForLoopInvocation(pending, controller.signal);
  controller.abort(new Error("失联"));
  await assert.rejects(waiting, /失联/);
  reject(new Error("迟到错误"));
  await flush();
  assert.equal(await waitForLoopInvocation(Promise.resolve(7)), 7);
});

test("进程退出须等待一轮巡检，已消费退出的 OpenCode 重试不算失联", async (t) => {
  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  let resolveLifecycle!: (value: NonNullable<RunProcess["lifecycle"]> extends Promise<infer T> ? T : never) => void;
  const process = { kill: () => undefined, lifecycle: new Promise((resolve) => { resolveLifecycle = resolve; }) } as RunProcess;
  observeLoopSubtaskProcess(process);
  resolveLifecycle({ processTerminal: { status: "confirmed", evidence: "child-process-close" },
    streams: { status: "confirmed", evidence: "owned-stdio-ended-and-closed" },
    temp: { status: "not-applicable", reason: "none" } });
  await flush();
  assert.equal(isLoopSubtaskProcessLost(process), false);
  now += 60_000;
  assert.equal(isLoopSubtaskProcessLost(process), true);
  recordLoopSubtaskProcessResult(process);
  assert.equal(isLoopSubtaskProcessLost(process), false);
});

function classicHarness(t: TestContext, readRun?: () => TaskRunRecord | null, includeExecutionPlan = false) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-wait-classic-"));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  let task: LoopTaskRecord = {
    id: "classic-task", cli: "codex", workspaceKey: "workspace", taskStoreFile: path.join(rootDir, "loop-tasks.json"),
    rootPrompt: "实现功能", status: "running", createdAt: 1, updatedAt: 1,
    maxRounds: 10, currentRound: 1, communicationDir: rootDir, mainCommunicationFile: path.join(rootDir, "main.md"),
    sessionId: "parent", activeSubtaskId: null, activeSubtaskIds: [],
    subTasks: ["A", "B"].map((id) => ({ id, title: id, prompt: id, status: "pending" })),
    rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
  };
  const active = new Set<string>();
  const calls: Array<{ input: PromptRunInput; start: () => void; finish: () => void; fail: () => void; isAborted: () => boolean }> = [];
  const messages: string[] = [];
  const statuses: Array<{ tabId?: string; status?: string }> = [];
  let finalized = 0;
  let roundReports = 0;
  let manualActive = false;
  const host = createLoopOrchestrationHost({
    isTabRunActive: (tabId) => active.has(tabId),
    hasActiveSubtasks: () => manualActive,
    readLoopTaskRecord: () => task,
    updateLoopTaskRecord: (_id, patch) => { task = { ...task, ...patch }; return task; },
    getActiveLoopSubtaskIds: () => task.activeSubtaskIds ?? [],
    isLoopTaskExecutionInterrupted: () => task.status !== "running",
    ...(includeExecutionPlan ? {
      buildLoopSubtaskExecutionPlan,
      buildLoopSubtaskBatchStartedText: () => "批次启动",
      buildLoopSubtaskExecutionGroupStartedText: () => "并发组启动",
      buildLoopSubtaskBatchCompletedText: () => "批次完成",
    } : {}),
    createMessageId: () => "progress",
    getLoopMessagesForTarget: () => [],
    appendMessageToStore: () => undefined,
    persistLoopMessagesForTarget: () => undefined,
    sendPanelMessage: (message) => { if (message.type === "runStatus") statuses.push(message); },
    buildSubagentProgressLabels: () => ({} as never),
    createSubagentProgressController: () => ({ getMessage: () => null, update: () => undefined } as never),
    createLoopSubtaskProgressMonitor: () => ({ start: () => undefined, sync: () => undefined, finish: () => undefined } as never),
    createLoopSubtaskRunTarget: () => ({ tabId: `child-${calls.length}`, cli: "codex", sessionId: null }),
    prepareLoopSubtaskCommunicationFile: () => path.join(rootDir, "sub.md"),
    buildLoopSubtaskStartedText: () => "子任务启动",
    buildLoopSubtaskRetryText: () => "重试子任务",
    appendSystemMessageForLoop: (_target, message) => { messages.push(message); },
    getLoopSubtaskDisplayTitle: (_index, subtask) => subtask.title,
    formatLoopGroupChatMemberName: (title) => title ?? "子任务",
    ensureLoopMainSubChatTranscript: () => path.join(rootDir, "main.md"),
    resolvePromptRunTargetSessionId: () => null,
    switchVisibleConversationTabForLoop: async () => null,
    resolvePromptRunModelForRole: () => undefined,
    resolvePromptRunThinkingModeForRole: () => undefined,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    runPrompt: (input, options) => new Promise<void>((resolve, reject) => {
      calls.push({ input, start: () => options?.onStarted?.(), finish: resolve, fail: () => reject(new Error("迟到失败")), isAborted: options?.isAborted ?? (() => false) });
    }),
    getLoopRoundRunStatus: () => "stopped",
    getLatestLoopRoundRunRecord: readRun,
    appendLoopRound: () => { roundReports++; },
    buildLoopRoundSummary: () => "异常结果",
    getLastLoopAssistantContent: () => null,
    mapLoopRunStatusToSubagentStatus: () => "interrupted",
    finalizeLoopSubtaskRun: async (result) => {
      finalized++;
      if (result.runStatus === "error") {
        task = { ...task, subTasks: task.subTasks.map((item) => item.id === result.subtaskId
          ? { ...item, status: "blocked", executionFailure: result.failureDetail } : item) };
      }
    },
    logError: () => undefined,
    errorToMessage: String,
    t: () => "等待",
  });
  // 使用真实编排和临时沟通文件，不访问任何用户任务。
  const run = (subtasks: LoopTaskRecord["subTasks"] = [task.subTasks[0]]) => host.runLoopSubtasksBatchWithRetry({
    input: { displayPrompt: task.rootPrompt, modelPrompt: task.rootPrompt, contextTags: [] },
    target: { tabId: "main", cli: "codex", sessionId: "parent" }, task, round: 1, subtasks,
  });
  return { host, active, calls, messages, statuses, run, task: () => task,
    setTask: (patch: Partial<LoopTaskRecord>) => { task = { ...task, ...patch }; },
    setManualActive: (value: boolean) => { manualActive = value; },
    counts: () => ({ finalized, roundReports }),
  };
}

test("经典 Loop 重试耗尽后将最后一次 CLI 错误交给主任务", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] } as never);
  let latestRun: TaskRunRecord | null = null;
  const env = classicHarness(t, () => latestRun);
  const pending = env.run();
  for (let index = 0; index <= LOOP_SUBTASK_RETRY_MAX_RETRIES; index++) {
    await flush();
    const call = env.calls[index];
    assert.ok(call);
    call.start();
    latestRun = {
      id: `run-${index}`, cli: "codex", prompt: call.input.displayPrompt, sessionId: null,
      startedAt: index, endedAt: index + 1, durationMs: 1, status: "error",
      failureDetail: index === LOOP_SUBTASK_RETRY_MAX_RETRIES ? "EACCES: CLI 无法读取配置" : "旧的瞬时错误",
    };
    call.finish();
    await flush();
    if (index < LOOP_SUBTASK_RETRY_MAX_RETRIES) t.mock.timers.tick(LOOP_SUBTASK_RETRY_DELAY_MS);
  }
  env.host.checkWaitingTasks();
  assert.equal((await pending)[0]?.watchdogRecovered, true);
  assert.equal(env.task().status, "running");
  assert.match(env.task().subTasks[0].executionFailure ?? "", /EACCES: CLI 无法读取配置/);
  assert.doesNotMatch(env.task().subTasks[0].executionFailure ?? "", /旧的瞬时错误/);
  assert.ok(env.messages.some((message) => message.includes("EACCES")));
});

test("经典 Loop 在分钟边界解除失联等待并唤醒原主任务", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const env = classicHarness(t);
  const pending = env.run();
  await flush();
  assert.equal(env.calls.length, 1);
  env.host.checkWaitingTasks(); // 尚在准备，不误判。
  assert.equal(env.messages.some((message) => message.includes("定时检查")), false);
  env.calls[0].start();
  env.active.add("child-0");
  env.host.checkWaitingTasks();
  assert.equal(env.messages.some((message) => message.includes("定时检查")), false);
  env.active.clear();
  env.host.checkWaitingTasks(); // 启动瞬间没有 runner 的短暂交接也不能误判。
  assert.equal(env.messages.some((message) => message.includes("定时检查")), false);
  now += 59_999;
  env.host.checkWaitingTasks();
  assert.equal(env.calls[0].isAborted(), false);
  assert.equal(env.messages.some((message) => message.includes("定时检查")), false);
  now += 1;
  env.host.checkWaitingTasks();
  env.host.checkWaitingTasks();
  const results = await pending;
  await flush();
  assert.equal(env.task().status, "running");
  assert.equal(env.task().runtimeInterrupted, undefined);
  assert.equal(env.calls[0].isAborted(), true);
  assert.equal(env.task().subTasks[0].status, "blocked");
  assert.equal(env.task().subTasks[1].status, "pending");
  assert.deepEqual(env.task().activeSubtaskIds, []);
  assert.equal(env.host.isSubtaskRunning(env.task().id, "A"), false);
  assert.equal(results[0].watchdogRecovered, true);
  assert.equal(results[0].status, "stopped");
  assert.equal(env.host.resumeWaitingBatch(env.task().id), false);
  const counts = env.counts();
  env.calls[0].fail();
  await flush();
  assert.deepEqual(env.counts(), counts);
  assert.equal(env.messages.filter((message) => message.includes("定时检查")).length, 1);
});

test("经典 Loop 只回收同批失联子任务并保留仍运行的兄弟", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const env = classicHarness(t, undefined, true);
  const pending = env.host.runLoopSubtasksBatchWithRetry({
    input: { displayPrompt: env.task().rootPrompt, modelPrompt: env.task().rootPrompt, contextTags: [] },
    target: { tabId: "main", cli: "codex", sessionId: "parent" },
    task: env.task(), round: 1, subtasks: env.task().subTasks,
  });
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await flush();
  assert.equal(env.calls.length, 2);
  env.calls.forEach((call) => call.start());
  env.active.add("child-1");
  now += 60_000;
  env.host.checkWaitingTasks();
  assert.equal(env.calls[0].isAborted(), true);
  assert.equal(env.calls[1].isAborted(), false);
  assert.deepEqual(env.task().activeSubtaskIds, ["B"]);
  assert.equal(env.task().subTasks.find((item) => item.id === "A")?.status, "blocked");
  assert.equal(env.messages.filter((message) => message.includes("定时检查")).length, 1);
  env.active.clear();
  env.calls[1].finish();
  await flush();
  env.host.checkWaitingTasks();
  const results = await pending;
  assert.equal(results.find((item) => item.subtask.id === "A")?.watchdogRecovered, true);
  assert.equal(env.task().status, "running");
});

test("经典 Loop 在 CLI 启动前停止会清除派发时的运行状态", async (t) => {
  const env = classicHarness(t);
  const pending = env.run();
  await flush();
  assert.equal(env.calls.length, 1);
  env.setTask({ status: "stopped" });
  env.host.checkWaitingTasks();
  await pending;
  await flush();
  assert.deepEqual(env.statuses, [{ type: "runStatus", tabId: "child-0", status: "stopped" }]);
  env.calls[0].finish();
  await flush();
  assert.equal(env.statuses.length, 1);
});

test("经典 Loop 已主动停止的批次等待其它活动子任务，随后保留续跑入口", async (t) => {
  const env = classicHarness(t);
  const pending = env.run();
  await flush();
  env.calls[0].start();
  env.calls[0].finish();
  await flush();
  env.setManualActive(true);
  env.host.checkWaitingTasks();
  assert.equal(env.messages.some((message) => message.includes("定时检查")), false);
  env.setManualActive(false);
  env.host.checkWaitingTasks();
  const results = await pending;
  assert.equal(results[0].watchdogRecovered, undefined);
  assert.equal(results[0].status, "stopped");
  assert.equal(env.task().runtimeInterrupted, true);
  assert.equal(env.task().subTasks[0].status, "blocked");
  assert.equal(env.counts().finalized, 1);
});

test("经典 Loop 巡检不会复活停止、暂停、完成和澄清中的父任务", async (t) => {
  for (const state of ["stopped", "needs-review", "completed", "clarification", "failure-limit"] as const) {
    const env = classicHarness(t);
    const pending = env.run();
    await flush();
    env.calls[0].start();
    if (state === "clarification") env.setTask({ pendingClarification: { interactionId: "pending" } as never });
    else if (state === "failure-limit") env.setTask({ mainAiFailureLimitReached: true });
    else env.setTask({ status: state });
    env.host.checkWaitingTasks();
    if (state === "clarification") {
      assert.equal(env.calls[0].isAborted(), false);
      assert.equal(env.task().status, "running");
      assert.equal(env.messages.some((message) => message.includes("定时检查")), false);
      env.setTask({ status: "stopped", pendingClarification: undefined });
      env.host.checkWaitingTasks();
    }
    const results = await pending;
    assert.equal(results[0].watchdogRecovered, undefined, state);
    assert.equal(env.messages.some((message) => message.includes("定时检查")), false, state);
    env.calls[0].finish();
    await flush();
  }
});

test("经典 Loop 手动续跑成功后立即唤醒原批次，不等待下一次巡检", async (t) => {
  const env = classicHarness(t);
  const pending = env.run();
  await flush();
  env.calls[0].start();
  env.calls[0].finish();
  await flush();
  assert.equal(env.host.resumeWaitingBatch(env.task().id), false);
  env.setTask({
    activeSubtaskId: null, activeSubtaskIds: [],
    subTasks: env.task().subTasks.map((item) => item.id === "A" ? { ...item, status: "completed" } : item),
  });
  assert.equal(env.host.resumeWaitingBatch(env.task().id), true);
  assert.equal(env.host.resumeWaitingBatch(env.task().id), false);
  const results = await pending;
  assert.equal(results[0].status, "end");
  assert.equal(env.messages.some((message) => message.includes("定时检查")), false);
});
