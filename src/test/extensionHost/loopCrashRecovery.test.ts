import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { spawn } from "node:child_process";
import { once } from "node:events";
import { installVscodeMock } from "../vscodeMock";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { ConversationTabRecord } from "../../sessionTabs";
import type { TaskStore } from "../../promptRunState";
import type { ChatMessage } from "../../webview/types";

installVscodeMock();
const taskHome = fs.mkdtempSync(path.join(os.tmpdir(), "loop-crash-recovery-"));
const homeMock = test.mock.method(os, "homedir", () => taskHome);
const store = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
const { createPromptRunRuntimeHost } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
homeMock.mock.restore();
const { createLoopPlusOrchestrationHost } = require("../../extensionHost/loopPlusOrchestration") as typeof import("../../extensionHost/loopPlusOrchestration");
const { createLoopPlusScheduler, buildLoopPlusFinishEventId } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
test.after(() => fs.rmSync(taskHome, { recursive: true, force: true }));

let sequence = 0;
function harness(mode: "classic" | "event_driven" = "classic") {
  const id = `recovery-${++sequence}`;
  const dir = path.join(taskHome, id);
  fs.mkdirSync(dir, { recursive: true });
  const task: LoopTaskRecord = {
    id, cli: "codex", workspaceKey: "workspace", taskStoreFile: store.buildLoopTaskStoreFile("codex", "workspace", "main", id),
    rootPrompt: "完成两项独立工作", schedulingMode: mode, status: "running", createdAt: Date.now(), updatedAt: Date.now(),
    maxRounds: 20, currentRound: 1, communicationDir: dir, mainCommunicationFile: path.join(dir, "main.md"), sessionId: "main",
    activeSubtaskId: "alpha", activeSubtaskIds: ["alpha", "beta"],
    subTasks: ["alpha", "beta"].map((child) => ({ id: child, title: child, status: "running", communicationFile: path.join(dir, `${child}.md`) })),
    rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
  };
  if (mode === "event_driven") {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
    scheduler.dispatch(["alpha", "beta"].map((child) => ({ subtaskId: child, attemptId: `${child}-1`, writeFiles: [`${child}.ts`] })));
    task.loopPlus = scheduler.snapshot();
  }
  store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const tabs: ConversationTabRecord[] = ["main", "alpha", "beta"].map((tabId) => ({
    id: tabId, cli: "codex", sessionId: tabId, sessionIdByCli: { codex: tabId }, createdAt: 1,
  }));
  const messages = new Map<string, ChatMessage[]>();
  for (const child of ["alpha", "beta"]) messages.set(child, [{
    id: child, role: "assistant", content: `${child} 已完成，修改和结果已写入沟通文件。`,
    taskRole: "subtask", loopTaskId: id, loopRound: 1, loopSubtaskId: child,
  }]);
  const taskStore: TaskStore = { runs: [] };
  const reports: string[] = [];
  const wakeups: string[] = [];
  let releaseWake: (() => void) | undefined;
  const wakeGate = new Promise<void>((resolve) => { releaseWake = resolve; });
  let reconcileOnClose = false;
  let host: ReturnType<typeof createPromptRunRuntimeHost>;
  const createHost = () => createPromptRunRuntimeHost({
    getActiveWorkspaceKey: () => "workspace", getConversationTabById: (tabId) => tabs.find((tab) => tab.id === tabId) ?? null,
    getConversationTabs: () => tabs, createConversationTabId: () => "restored-main", persistConversationTabsToWorkspaceSettings: () => undefined,
    postPanelState: async () => undefined, loadSessionMessages: (_cli, sessionId) => messages.get(sessionId) ?? [],
    persistMessagesForTab: (_cli, sessionId, tabId, next) => { messages.set(sessionId ?? tabId, next); },
    getPendingSessionDraft: () => ({ messages: [] }), updatePendingSessionDraft: () => undefined,
    sendPanelMessage: () => undefined, createMessageId: () => "notice", readTaskStore: () => taskStore,
    writeTaskStore: () => undefined, appendLoopMainSubChatMainDecision: () => undefined,
    buildLoopGroupChatMessageAction: () => ({ type: "openLoopGroupChat", taskId: id }),
    runLoopPrompt: async (_input, options) => { wakeups.push(options?.resumeTaskId ?? ""); await wakeGate; },
    isTabRunActive: () => false, refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolveConversationTabLoopContext: (tab) => ({ taskRole: tab.id === "main" ? "main" : "subtask", loopTaskId: id }),
    resolveLoopTaskSessionId: (target) => target.sessionId, isLoopTaskBlockedByMainAiFailureLimit: () => false,
    appendLoopMainSubChatSubtaskFinished: (_task, child) => { reports.push(child.id); },
    closeConversationTabAndRefreshPanel: async () => { if (reconcileOnClose) host.markLoopTaskStoppedAfterRuntimeEnded(id); },
  });
  host = createHost();
  return {
    id, task, reports, wakeups, createHost, read: () => store.readLoopTaskRecord(id)!, host,
    reconcileOnClose: () => { reconcileOnClose = true; }, releaseWake: () => releaseWake!(),
    finish: (child: string, runtime = host) => {
      taskStore.runs.push({ id: `${child}-run`, cli: "codex", sessionId: child, prompt: "继续", startedAt: 10, endedAt: 20,
        durationMs: 10, status: "end", taskRole: "subtask", loopTaskId: id, loopRound: 1, loopSubtaskId: child });
      return runtime.maybeWakeLoopMainAfterSubtaskContinuation({ taskId: id, round: 1, subtaskId: child }, { tabId: child, previousRunEndedAt: 0 });
    },
  };
}

test("disk recovery preserves classic child links and wakes the parent after both manual continuations", async () => {
  const env = harness();
  env.host.markLoopTaskStoppedAfterRuntimeEnded(env.id);
  assert.equal(env.read().runtimeInterrupted, true);
  assert.deepEqual(env.read().activeSubtaskIds, ["alpha", "beta"]);
  assert.deepEqual(env.read().subTasks.map((child) => child.status), ["blocked", "blocked"]);
  const restored = env.createHost();
  await env.finish("alpha", restored);
  assert.equal(env.read().status, "stopped");
  assert.deepEqual(env.read().activeSubtaskIds, ["beta"]);
  assert.equal(env.wakeups.length, 0);
  const finished = env.finish("beta", restored);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.wakeups, [env.id]);
  assert.equal(env.read().status, "running");
  assert.equal(env.read().runtimeInterrupted, undefined);
  assert.deepEqual(env.reports, ["alpha", "beta"]);
  env.releaseWake();
  await finished;
});

test("classic completion survives the close-tab refresh gap and concurrent duplicate notifications", async () => {
  const env = harness();
  store.updateLoopTaskRecord(env.id, { activeSubtaskId: "alpha", activeSubtaskIds: ["alpha"] });
  env.reconcileOnClose();
  const first = env.finish("alpha");
  await new Promise((resolve) => setImmediate(resolve));
  const second = env.finish("alpha");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.wakeups, [env.id]);
  assert.deepEqual(env.reports, ["alpha"]);
  env.releaseWake();
  await Promise.all([first, second]);
});

test("a manual child completion does not revive an explicitly stopped classic parent", async () => {
  const env = harness();
  env.host.markLoopTaskStoppedAfterRuntimeEnded(env.id);
  env.host.markLoopTaskStoppedByUser(env.id);
  assert.equal(env.read().runtimeInterrupted, undefined);
  await env.finish("alpha");
  assert.equal(env.read().status, "stopped");
  assert.equal(env.wakeups.length, 0);
});

test("a resumed classic parent still receives a subsequent active child's completion", async () => {
  const env = harness();
  store.updateLoopTaskRecord(env.id, { activeSubtaskId: "alpha", activeSubtaskIds: ["alpha"] });
  const first = env.finish("alpha");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.wakeups, [env.id]);
  store.updateLoopTaskRecord(env.id, { activeSubtaskId: "beta", activeSubtaskIds: ["beta"] });
  await env.finish("beta");
  assert.deepEqual(env.reports, ["alpha", "beta"]);
  assert.deepEqual(env.read().activeSubtaskIds, []);
  assert.equal(env.read().subTasks.find((item) => item.id === "beta")?.status, "completed");
  assert.deepEqual(env.wakeups, [env.id]);
  env.releaseWake();
  await first;
});

function plusHost(env: ReturnType<typeof harness>) {
  const mains: import("../../extensionHost/loopPlusOrchestration").LoopPlusMainRequest[] = [];
  const reports: string[] = [];
  const host = createLoopPlusOrchestrationHost({
    readTask: store.readLoopTaskRecord, updateTask: store.updateLoopTaskRecord,
    createTask: () => { throw new Error("不能创建另一个父任务"); }, appendMessage: () => undefined,
    recordAttempt: (input) => { reports.push(input.attemptId); },
    runMain: (request) => { mains.push(request); return { promise: new Promise(() => undefined), abort: () => undefined }; },
    startAttempt: () => { throw new Error("不能重新启动已经完成或失去进程的子任务"); },
  });
  return { host, mains, reports, recovery: { target: { tabId: "main", cli: "codex" as const, sessionId: "main" }, input: { displayPrompt: env.task.rootPrompt } } };
}

test("Loop+ reconstructs from disk on child completion, reports once and preserves its interrupted sibling", async () => {
  const env = harness("event_driven");
  env.host.markLoopTaskStoppedAfterRuntimeEnded(env.id);
  const plus = plusHost(env);
  assert.equal(plus.host.notifySubtaskContinuation(env.id, "alpha", "completed", "恢复后的真实结果", plus.recovery), true);
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = createLoopPlusScheduler({ snapshot: env.read().loopPlus }).snapshot();
  assert.equal(snapshot.currentReview?.eventId, buildLoopPlusFinishEventId("alpha", "alpha-1"));
  assert.deepEqual(snapshot.running.map((attempt) => attempt.subtaskId), ["beta"]);
  assert.equal(env.read().subTasks.find((child) => child.id === "beta")?.status, "blocked");
  assert.equal(env.read().subTasks.find((child) => child.id === "alpha")?.summary, "恢复后的真实结果");
  assert.match(plus.mains[0].modelPrompt, /Interrupted subtasks awaiting continuation: beta/);
  assert.deepEqual(plus.host.collectRunningTaskIds(), [env.id]);
  assert.equal(plus.host.notifySubtaskContinuation(env.id, "alpha", "completed", "重复", plus.recovery), false);
  assert.deepEqual(plus.reports, ["alpha-1"]);
});

test("Loop+ can receive a cold completion before panel state reconciliation", () => {
  const env = harness("event_driven");
  const plus = plusHost(env);
  assert.equal(plus.host.notifySubtaskContinuation(env.id, "alpha", "completed", "已完成", plus.recovery), true);
  assert.equal(env.read().subTasks.find((child) => child.id === "alpha")?.status, "completed");
});

test("explicit Loop+ parent continuation retains cold reservations instead of fabricating stopped results", () => {
  const env = harness("event_driven");
  const plus = plusHost(env);
  plus.host.tryRun(plus.recovery.input, plus.recovery.target, { resumeTaskId: env.id, resumeRequested: true });
  assert.deepEqual(createLoopPlusScheduler({ snapshot: env.read().loopPlus }).snapshot().running.map((item) => item.subtaskId), ["alpha", "beta"]);
  assert.deepEqual(plus.reports, []);
  assert.deepEqual(env.read().subTasks.map((child) => child.status), ["blocked", "blocked"]);
});

test("cold Loop+ notifications refuse explicit stops, completed parents, invalid snapshots and closed attempts", () => {
  for (const scenario of ["stopped", "completed", "invalid", "closed", "failure-limit"] as const) {
    const env = harness("event_driven");
    if (scenario === "stopped") env.host.markLoopTaskStoppedByUser(env.id);
    if (scenario === "completed") store.updateLoopTaskRecord(env.id, { status: "completed" });
    if (scenario === "invalid") store.updateLoopTaskRecord(env.id, { loopPlus: { version: "invalid" } });
    if (scenario === "failure-limit") store.updateLoopTaskRecord(env.id, { mainAiFailureLimitReached: true });
    if (scenario === "closed") {
      const scheduler = createLoopPlusScheduler({ snapshot: env.read().loopPlus });
      scheduler.finish({ subtaskId: "alpha", attemptId: "alpha-1", outcome: "completed" });
      store.updateLoopTaskRecord(env.id, { loopPlus: scheduler.snapshot() });
    }
    const plus = plusHost(env);
    assert.equal(plus.host.notifySubtaskContinuation(env.id, "alpha", "completed", "迟到的结果", plus.recovery), false, scenario);
    assert.deepEqual(plus.reports, []);
    assert.deepEqual(plus.mains, []);
  }
});

test("a real host process killed after dispatch leaves recoverable Loop+ completion and sibling state", { timeout: 10_000 }, async () => {
  const env = harness("event_driven");
  const worker = spawn(process.execPath, ["-e", `
    const os = require('node:os');
    os.homedir = () => process.env.LOOP_RECOVERY_TEST_HOME;
    require(process.env.LOOP_RECOVERY_VSCODE_MOCK).installVscodeMock();
    const store = require(process.env.LOOP_RECOVERY_TASK_STORE);
    store.writeLoopTaskStore(process.env.LOOP_RECOVERY_FILE, { tasks: [JSON.parse(process.env.LOOP_RECOVERY_TASK)] });
    process.send('persisted');
    setInterval(() => {}, 1000);
  `], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      LOOP_RECOVERY_TEST_HOME: taskHome,
      LOOP_RECOVERY_VSCODE_MOCK: require.resolve("../vscodeMock"),
      LOOP_RECOVERY_TASK_STORE: require.resolve("../../loopTaskStore"),
      LOOP_RECOVERY_FILE: env.task.taskStoreFile,
      LOOP_RECOVERY_TASK: JSON.stringify(env.task),
    },
  });
  let errors = "";
  worker.stderr?.on("data", (chunk) => { errors += String(chunk); });
  const exited = once(worker, "exit");
  try {
    const ready = await Promise.race([
      once(worker, "message").then(([message]) => message),
      exited.then(() => { throw new Error(`恢复夹具提前退出：${errors}`); }),
    ]);
    assert.equal(ready, "persisted");
    worker.kill("SIGKILL");
    await exited;
    const restored = env.createHost();
    restored.markLoopTaskStoppedAfterRuntimeEnded(env.id);
    const plus = plusHost(env);
    assert.equal(plus.host.notifySubtaskContinuation(env.id, "alpha", "completed", "强制退出后继续完成", plus.recovery), true);
    assert.equal(env.read().subTasks.find((child) => child.id === "alpha")?.status, "completed");
    assert.equal(env.read().subTasks.find((child) => child.id === "beta")?.status, "blocked");
    assert.deepEqual(plus.reports, ["alpha-1"]);
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    await exited;
  }
});
