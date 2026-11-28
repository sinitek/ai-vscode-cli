import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installVscodeMock } from "../vscodeMock";
import {
  loadPromptHistoryStore,
  recordPromptHistoryInStore,
  type PromptHistoryStore,
  type PromptHistoryStoreOptions,
} from "../../promptHistoryStore";

installVscodeMock();
require("../../extensionHost/departmentGroupChatProjection");

const { buildLoopGroupChatPanelState, createLoopGroupChatPanelCoordinator } = require("../../panelDiagnostics") as typeof import("../../panelDiagnostics");
import type { LoopTaskRecord } from "../../loopTaskStore";
import { createLoopMainQuestionQueue } from "../../loopMainQuestionQueue";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { setTimeout as delay } from "node:timers/promises";

function createStoppedTask(): LoopTaskRecord {
  return {
    id: "task-1",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/task-1/loop-tasks.json",
    rootPrompt: "Resume with the latest runtime selection.",
    status: "stopped",
    createdAt: 1,
    updatedAt: 2,
    maxRounds: 20,
    currentRound: 2,
    communicationDir: "/tmp/task-1",
    mainCommunicationFile: "/tmp/task-1/main-task.md",
    sessionId: "codex-session",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

function createContinuationRecoveryHarness() {
  const task = createStoppedTask();
  task.schedulingMode = "event_driven";
  task.originProfile = { configId: "original-config" };
  task.modelRouting = { main: { model: "main-model" }, subtask: { model: "subtask-model" } };
  const messages: Array<{ type: string; canContinue?: boolean }> = [];
  const warnings: string[] = [];
  let runs = 0;
  let refreshes = 0;
  const panel = {
    getState: () => undefined,
    setAskThread: () => undefined,
    update: () => { refreshes += 1; },
    post: (message: { type: string; canContinue?: boolean }) => messages.push(message),
  };
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map([[task.id, panel as never]]),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: () => task,
    updateTaskRecord: () => task,
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "codex" }),
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => "original-config",
    getSelectedCliModel: () => "main-model",
    restoreOriginalLoopRuntime: async () => ({ ok: true, target: { tabId: "main-tab", cli: "codex" } }),
    runLoopPrompt: async () => { runs += 1; },
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: (message) => { warnings.push(message); },
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };
  return { task, deps, messages, warnings, coordinator: createLoopGroupChatPanelCoordinator(deps),
    get runs() { return runs; }, get refreshes() { return refreshes; } };
}

function createCompactionContinuationHarness() {
  const harness = createContinuationRecoveryHarness();
  const queue = createLoopMainQuestionQueue();
  harness.task.status = "error";
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  void queue.runCompaction("main-tab", () => gate);
  let queued!: () => void;
  const waiting = new Promise<void>((resolve) => { queued = resolve; });
  harness.deps.showInformationMessage = (message) => { if (message.includes("已排队")) queued(); };
  harness.deps.isTabRunActive = (tabId) => Boolean(queue.getCompaction(tabId));
  harness.deps.getMainCompaction = (tabId) => {
    const flight = queue.getCompaction(tabId);
    return flight && { ready: flight.ready, isTargetCurrent: () => true };
  };
  harness.deps.cancelMainCompaction = queue.cancelCompaction;
  const click = (requestId: string) => harness.coordinator.handleMessage(harness.task.id, { type: "loopGroupChatChat:continueTask", requestId });
  return { harness, queue, finish, waiting, click };
}

test("one group chat continuation survives main compaction and duplicate clicks dispatch once", async () => {
  for (const restore of [true, false]) {
    const { harness, finish, waiting, click } = createCompactionContinuationHarness();
    if (!restore) harness.deps.restoreOriginalLoopRuntime = undefined;
    const first = click("continue-first");
    await waiting;
    await click("continue-duplicate");
    assert.equal(harness.runs, 0);
    finish();
    await first;
    assert.equal(harness.runs, 1);
  }
});

test("stopping, finishing, or rebinding the task while compaction runs invalidates the queued click", async () => {
  for (const change of ["group-stop", "panel-stop", "completed", "new-session", "new-tab", "other-work"]) {
    const { harness, queue, finish, waiting, click } = createCompactionContinuationHarness();
    const first = click("continue-original");
    await waiting;
    if (change === "group-stop") await harness.coordinator.handleMessage(harness.task.id, { type: "loopGroupChatChat:stopTask" });
    if (change === "panel-stop") queue.cancelCompaction("main-tab");
    if (change === "completed") harness.task.status = "completed";
    if (change === "new-session") harness.task.sessionId = "replacement";
    if (change === "new-tab") harness.deps.resolveMainPromptTarget = () => ({ tabId: "replacement", cli: "codex" });
    if (change === "other-work") harness.deps.isTabRunActive = () => true;
    if (change.endsWith("stop")) await first;
    finish();
    await first;
    assert.equal(harness.runs, 0, change);
  }
});

function createRestoredEditor() {
  let receive: (message: unknown) => void = () => undefined;
  let disposeListener = () => {};
  const editor = {
    webview: { html: "", options: {}, cspSource: "self", postMessage: async () => true,
      onDidReceiveMessage: (listener: typeof receive) => { receive = listener; } },
    active: false, disposed: false, reveals: 0,
    reveal: () => { editor.reveals++; },
    onDidDispose: (listener: typeof disposeListener) => { disposeListener = listener; },
    dispose: () => { editor.disposed = true; disposeListener(); },
  };
  return { editor, native: editor as unknown as import("vscode").WebviewPanel, send: (message: unknown) => receive(message) };
}

test("a cold Loop+ editor and a simultaneous task tab open share one panel and resume its original main", async () => {
  const { coordinator, deps, task, warnings } = createContinuationRecoveryHarness();
  deps.panelsByTaskId.clear();
  deps.getActiveConversationTaskId = () => assert.fail("restore must not use the active tab");
  const dispatches: unknown[] = [];
  deps.runLoopPrompt = async (_input, options) => { dispatches.push([options.targetTabId, options.resumeTaskId]); };
  const state = { loopGroupChat: { workspaceKey: task.workspaceKey, taskId: task.id, cli: task.cli, sessionId: task.sessionId } };
  const original = createRestoredEditor();
  coordinator.restore(original.native, state, task.workspaceKey);
  assert.equal(original.editor.reveals, 0);
  assert.match(original.editor.webview.html, /正在加载群聊/u);
  const current = deps.panelsByTaskId.get(task.id);
  assert.ok(current);
  const opening = coordinator.open(task.id);
  original.send({ type: "loopGroupChatChat:loadingReady" });
  await opening;
  assert.equal(current.getState()?.task.id, task.id);
  assert.equal(original.editor.reveals, 1);
  const duplicate = createRestoredEditor();
  coordinator.restore(duplicate.native, state, task.workspaceKey);
  assert.equal(duplicate.editor.disposed, true);
  assert.equal(deps.panelsByTaskId.get(task.id), current);
  assert.deepEqual(dispatches, []);
  original.send({ type: "loopGroupChatChat:continueTask", requestId: "continue-restart", prompt: "继续" });
  await delay(0);
  assert.deepEqual(dispatches, [["main-tab", task.id]]);
  original.editor.dispose();
  original.send({ type: "loopGroupChatChat:continueTask" });
  await delay(0);
  assert.equal(deps.panelsByTaskId.size, 0);
  assert.equal(dispatches.length, 1);
  assert.deepEqual(warnings, []);
});

test("锁竞争时群聊用原绑定恢复并刷新已提交快照，继续仍须读到权威记录", async () => {
  const harness = createContinuationRecoveryHarness();
  const { coordinator, deps, task } = harness;
  deps.panelsByTaskId.clear();
  const binding = { workspaceKey: task.workspaceKey, taskId: task.id, cli: task.cli, sessionId: task.sessionId ?? null };
  let busy = true;
  let knownSource = false;
  deps.readTaskRecord = (id, source) => {
    if (busy || id !== task.id) return null;
    if (source?.workspaceKey === binding.workspaceKey && source.cli === binding.cli && source.sessionId === binding.sessionId) knownSource = true;
    return knownSource ? task : null;
  };
  deps.readDisplaySnapshot = (id, source) => id === task.id && source?.workspaceKey === binding.workspaceKey
    && source.cli === binding.cli && source.sessionId === binding.sessionId ? task : null;
  const original = createRestoredEditor();
  try {
    coordinator.restore(original.native, { loopGroupChat: binding }, task.workspaceKey);
    original.send({ type: "loopGroupChatChat:loadingReady" });
    await delay(0);
    const panel = deps.panelsByTaskId.get(task.id);
    assert.equal(panel?.getState()?.task.id, task.id);
    task.rootPrompt = "已提交的新进度";
    await coordinator.refresh(task.id);
    assert.equal(panel?.getState()?.task.rootPrompt, task.rootPrompt);
    await coordinator.handleMessage(task.id, { type: "loopGroupChatChat:continueTask", requestId: "busy-continue" });
    assert.equal(harness.runs, 0);
    assert.match(harness.warnings.at(-1) ?? "", /暂时无法确认任务归属/);
    busy = false;
    await coordinator.handleMessage(task.id, { type: "loopGroupChatChat:continueTask", requestId: "released-continue" });
    assert.equal(harness.runs, 1);
  } finally { original.editor.dispose(); }
});

test("missing, legacy, foreign-workspace and mismatched restore identities cannot bind a different task", () => {
  const { coordinator, deps, task, warnings } = createContinuationRecoveryHarness();
  deps.panelsByTaskId.clear();
  deps.getActiveConversationTaskId = () => assert.fail("no implicit task");
  const binding = { taskId: task.id, workspaceKey: task.workspaceKey, cli: task.cli, sessionId: null };
  for (const state of [null, { scroll: { top: 1 } }, { loopGroupChat: { ...binding, workspaceKey: "foreign" } },
    { loopGroupChat: { ...binding, taskId: "missing" } }, { loopGroupChat: { ...binding, sessionId: ".." } }]) {
    const { editor, native } = createRestoredEditor();
    coordinator.restore(native, state, task.workspaceKey);
    assert.equal(editor.disposed, true);
  }
  deps.readTaskRecord = () => null;
  const missing = createRestoredEditor();
  coordinator.restore(missing.native, { loopGroupChat: binding }, task.workspaceKey);
  assert.equal(missing.editor.disposed, true);
  assert.equal(deps.panelsByTaskId.size, 0);
  assert.equal(warnings.length, 6);
});

for (const state of [{ scroll: { top: 1 } }, { loopGroupChat: null }]) {
test(`群聊绑定${"loopGroupChat" in state ? "为空" : "缺失"}时只展示当前工作区，经用户选定才打开`, async () => {
  const { coordinator, deps, task } = createContinuationRecoveryHarness();
  deps.panelsByTaskId.clear();
  deps.getActiveConversationTaskId = () => assert.fail("不能使用活动标签");
  deps.listTaskStoreFiles = () => [task.taskStoreFile!];
  deps.readTaskStoreTasks = () => [{ ...task, workspaceKey: "other", updatedAt: 99 }, task];
  const actions: string[] = [];
  deps.groupChatRecovery = { workspaceKey: () => task.workspaceKey, confirm: async (_message, action) => { actions.push(action); return true; } };
  deps.pickTask = async (tasks) => { assert.deepEqual(tasks, [task]); return tasks[0]; };
  let dispatches = 0;
  deps.runLoopPrompt = async (_input, options) => { assert.equal(options.resumeTaskId, task.id); dispatches++; };
  const restored = createRestoredEditor();
  coordinator.restore(restored.native, state, task.workspaceKey);
  await delay(0);
  restored.send({ type: "loopGroupChatChat:loadingReady" });
  await delay(0);
  assert.deepEqual(actions, ["选择任务"]);
  assert.equal(deps.panelsByTaskId.get(task.id)?.getState()?.task.id, task.id);
  assert.equal(dispatches, 0);
  restored.send({ type: "loopGroupChatChat:continueTask", prompt: "继续原任务", requestId: "manual" });
  await delay(0);
  assert.equal(dispatches, 1);
  restored.editor.dispose();
});

}

test("原任务暂不可读时只重试绑定的完整任务，切换工作区或关闭时终止", async () => {
  for (const outcome of ["retry", "cancel", "switch", "close"]) {
    const { coordinator, deps, task } = createContinuationRecoveryHarness();
    deps.panelsByTaskId.clear();
    deps.pickTask = async () => assert.fail("已有绑定不能重新选择任务");
    let workspaceKey = task.workspaceKey;
    let readable = false;
    const restored = createRestoredEditor();
    deps.readTaskRecord = (id) => { assert.equal(id, task.id); return readable ? task : null; };
    deps.groupChatRecovery = { workspaceKey: () => workspaceKey, confirm: async (_message, action) => {
      assert.equal(action, "重试原任务");
      if (outcome === "switch") workspaceKey = "other";
      if (outcome === "close") restored.editor.dispose();
      return outcome !== "cancel";
    }, retryLock: () => { assert.equal(outcome, "retry"); readable = true; } };
    coordinator.restore(restored.native, { loopGroupChat: { workspaceKey, taskId: task.id, cli: task.cli, sessionId: task.sessionId } }, workspaceKey);
    await delay(0);
    assert.equal(deps.panelsByTaskId.has(task.id), outcome === "retry");
    if (outcome === "retry") {
      restored.send({ type: "loopGroupChatChat:loadingReady" });
      await delay(0);
      restored.editor.dispose();
    } else assert.equal(restored.editor.disposed, true);
  }
});

test("restoring an ordinary editor reconciles only its lost runtime before accepting input", async () => {
  for (const live of [false, true]) {
    const { task, deps, coordinator } = createContinuationRecoveryHarness();
    deps.panelsByTaskId.clear();
    task.status = "running";
    deps.collectRunningTaskIds = () => new Set(live ? [task.id] : []);
    const reconciled: string[] = [];
    deps.reconcileInterruptedTask = (id) => { reconciled.push(id); task.status = "stopped"; task.runtimeInterrupted = true; return task; };
    const { editor, native, send } = createRestoredEditor();
    coordinator.restore(native, { loopGroupChat: { taskId: task.id, workspaceKey: task.workspaceKey, cli: task.cli, sessionId: null } }, task.workspaceKey);
    send({ type: "loopGroupChatChat:loadingReady" });
    await delay(0);
    assert.deepEqual(reconciled, live ? [] : [task.id]);
    assert.equal(deps.panelsByTaskId.get(task.id)?.getState()?.task.status, live ? "running" : "stopped");
    editor.dispose();
  }
});

test("group chat stop closes execution before recording its user stop source", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  const effects: unknown[] = [];
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  env.deps.stopRunsForTask = (taskId) => { effects.push(["cancel", taskId]); };
  env.deps.markTaskStoppedByUser = (taskId, source) => {
    effects.push(["persist", taskId, source]);
    return null;
  };
  await env.coordinator.handleMessage(env.task.id, { type: "loopGroupChatChat:stopTask" });
  assert.deepEqual(effects, [["cancel", env.task.id], ["persist", env.task.id, "group-chat"]]);
});

test("saving a Loop+ group chat template applies the stored template to the current task", async () => {
  const env = createContinuationRecoveryHarness();
  const old = { id: "release", name: "交付", checks: ["security" as const], otherText: "", systemDefault: false };
  const saved = { id: old.id, name: old.name, checks: ["other" as const], otherText: "核对变更记录", updatedAt: 3 };
  const snapshot = { id: saved.id, name: saved.name, checks: saved.checks, otherText: saved.otherText, systemDefault: false };
  env.task.loopPlusAcceptancePlan = old;
  env.deps.saveLoopPlusAcceptancePlan = () => ({ ok: true, plan: saved, plans: [saved], selection: saved.id });
  env.deps.applyLoopPlusAcceptancePlan = (taskId, plan) => {
    assert.equal(taskId, env.task.id);
    assert.deepEqual(plan, saved);
    env.task.loopPlusAcceptancePlan = snapshot;
    return { ok: true, plan: snapshot };
  };
  await env.coordinator.handleMessage(env.task.id, { type: "saveLoopPlusAcceptancePlan", ...saved });
  assert.deepEqual(buildLoopGroupChatPanelState(env.task, env.deps).acceptancePlan, snapshot);
  assert.deepEqual(env.messages.at(-1), {
    type: "loopPlusAcceptancePlanSaved", plan: saved, plans: [saved], selection: saved.id, taskAcceptancePlan: snapshot,
  });
});

test("group chat distinguishes a failed template save from a failed task update", async () => {
  const env = createContinuationRecoveryHarness();
  const saved = { id: "release", name: "交付", checks: [], otherText: "", updatedAt: 3 };
  const message = { type: "saveLoopPlusAcceptancePlan" as const, ...saved };
  let applications = 0;
  env.deps.applyLoopPlusAcceptancePlan = () => { applications += 1; return { ok: false, error: "任务写入失败" }; };
  env.deps.saveLoopPlusAcceptancePlan = () => ({ ok: false, error: "模板写入失败" });
  await env.coordinator.handleMessage(env.task.id, message);
  assert.equal(applications, 0);
  assert.deepEqual(env.messages.at(-1), { type: "loopPlusAcceptancePlanSaved", error: "模板写入失败" });
  env.deps.saveLoopPlusAcceptancePlan = () => ({ ok: true, plan: saved, plans: [saved], selection: saved.id });
  await env.coordinator.handleMessage(env.task.id, message);
  assert.equal(applications, 1);
  assert.deepEqual(env.messages.at(-1), {
    type: "loopPlusAcceptancePlanSaved", plan: saved, plans: [saved], selection: saved.id, applyError: "模板已保存。任务写入失败",
  });
});

for (const schedulingMode of ["classic", "event_driven"] as const) {
  test(`running member opens its existing AI conversation tab in ${schedulingMode}`, async () => {
    const env = createContinuationRecoveryHarness();
    env.task.schedulingMode = schedulingMode;
    env.task.status = "running";
    env.task.subTasks = [{ id: "subtask-1", title: "同名成员", status: "running" }];
    const calls: string[] = [];
    const originalTask = JSON.stringify(env.task);
    env.deps.resolveSubtaskConversationTabId = (task, subtaskId) => {
      assert.equal(task, env.task);
      assert.equal(subtaskId, "subtask-1");
      return "subtask-tab";
    };
    env.deps.isTabRunActive = (tabId) => tabId === "subtask-tab";
    env.deps.revealPanelView = async () => { calls.push("reveal"); };
    env.deps.switchVisibleConversationTabForLoop = async (tabId) => { calls.push(`switch:${tabId}`); };
    await env.coordinator.handleMessage(env.task.id, {
      type: "loopGroupChatChat:openSubtaskConversation", subtaskId: "subtask-1",
    });
    assert.deepEqual(calls, ["reveal", "switch:subtask-tab"]);
    assert.equal(JSON.stringify(env.task), originalTask);
    assert.equal(env.runs, 0);
    assert.deepEqual(env.warnings, []);
  });
}

test("member navigation ignores invalid, missing and foreign subtask identities", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.subTasks = [{ id: "subtask-1", title: "同名成员", status: "running" }];
  env.deps.readTaskRecord = (taskId) => taskId === env.task.id ? env.task : null;
  env.deps.resolveSubtaskConversationTabId = () => { throw new Error("must not resolve invalid identity"); };
  env.deps.revealPanelView = async () => { assert.fail("must not reveal"); };
  for (const subtaskId of [undefined, "", "  ", 5, "foreign-subtask"]) {
    await env.coordinator.handleMessage(env.task.id, {
      type: "loopGroupChatChat:openSubtaskConversation", subtaskId,
    } as never);
  }
  await env.coordinator.handleMessage("missing-parent", {
    type: "loopGroupChatChat:openSubtaskConversation", subtaskId: "subtask-1",
  });
  assert.deepEqual(env.warnings, []);
});

test("opening a missing explicit task ID does not fall through to a different recent task", async () => {
  const env = createContinuationRecoveryHarness();
  let picks = 0;
  env.deps.readTaskRecord = () => null;
  env.deps.getActiveConversationTaskId = () => "another-task";
  env.deps.pickTask = async () => { picks += 1; return env.task; };
  await env.coordinator.open(env.task.id);
  assert.equal(picks, 0);
  assert.equal(env.warnings[0], "loopGroupChatChat.taskMissing");
  assert.equal(env.warnings.length, 1);
});

for (const unavailable of ["missing", "finished", "finished-during-reveal"] as const) {
  test(`member navigation handles a ${unavailable} tab without switching`, async () => {
    const env = createContinuationRecoveryHarness();
    env.task.subTasks = [{ id: "subtask-1", title: "成员", status: "running" }];
    const notices: string[] = [];
    let active = unavailable !== "finished";
    env.deps.resolveSubtaskConversationTabId = () => unavailable === "missing" ? null : "subtask-tab";
    env.deps.isTabRunActive = () => active;
    env.deps.revealPanelView = async () => {
      assert.equal(unavailable, "finished-during-reveal");
      active = false;
    };
    env.deps.showInformationMessage = (message) => { notices.push(message); };
    env.deps.switchVisibleConversationTabForLoop = async () => { assert.fail("must not switch"); };
    await env.coordinator.handleMessage(env.task.id, {
      type: "loopGroupChatChat:openSubtaskConversation", subtaskId: "subtask-1",
    });
    assert.equal(notices.length, 1);
    assert.match(notices[0], /请刷新群聊/u);
    assert.equal(env.runs, 0);
  });
}

test("member navigation reports a failed panel switch without running a prompt", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.subTasks = [{ id: "subtask-1", title: "成员", status: "running" }];
  env.deps.resolveSubtaskConversationTabId = () => "subtask-tab";
  env.deps.isTabRunActive = () => true;
  env.deps.switchVisibleConversationTabForLoop = async () => { throw new Error("无法恢复会话配置"); };
  await env.coordinator.handleMessage(env.task.id, {
    type: "loopGroupChatChat:openSubtaskConversation", subtaskId: "subtask-1",
  });
  assert.deepEqual(env.warnings, ["打开子任务对话失败：无法恢复会话配置"]);
  assert.equal(env.runs, 0);
});

for (const running of [true, false]) {
  test(`switching task models ${running ? "does not interrupt running calls" : "automatically continues paused work"}`, async () => {
    const env = createContinuationRecoveryHarness();
    env.task.status = running ? "running" : "stopped";
    let resumed = 0;
    env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
    env.deps.collectRunningTaskIds = () => new Set(running ? [env.task.id] : []);
    env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
    env.deps.resumeLoopSubtasks = () => { resumed += 1; };
    const prompts: Array<Parameters<typeof env.deps.runLoopPrompt>[0]> = [];
    const runLoopPrompt = env.deps.runLoopPrompt;
    env.deps.runLoopPrompt = async (...args) => { prompts.push(args[0]); await runLoopPrompt(...args); };
    await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" }, { main: "xhigh", fullstack: "max" });
    await delay(0);
    assert.equal(env.task.modelRouting?.main.model, "new-model");
    assert.equal(env.task.modelRouting?.subtaskFullstack?.model, "new-model");
    assert.equal(env.task.originProfile?.mainThinkingMode, "xhigh");
    assert.equal(env.task.originProfile?.subtaskFullstackThinkingMode, "max");
    assert.equal(env.runs, running ? 0 : 1);
    if (!running) {
      assert.equal(prompts[0].loopMainThinkingMode, "xhigh");
      assert.equal(prompts[0].loopSubtaskFullstackThinkingMode, "max");
    }
    assert.equal(resumed, 1);
    assert.deepEqual(env.warnings, []);
    assert.ok(env.messages.some((message) => message.type === "loopGroupChatChat:switchModelsSettled"));
  });
}

for (const savedProfile of [true, false]) {
  test(`经典 Loop 继续先恢复子任务并在完成后保留继续说明，原档案=${savedProfile}`, async () => {
    const env = createContinuationRecoveryHarness();
    env.task.schedulingMode = "classic";
    if (!savedProfile) env.task.originProfile = undefined;
    const originalRouting = JSON.stringify(env.task.modelRouting);
    let resumed = 0;
    let resumeMain = () => undefined as void;
    const inputs: Array<Parameters<typeof env.deps.runLoopPrompt>[0]> = [];
    env.deps.resumeLoopSubtasks = (taskId, resume) => {
      assert.equal(taskId, env.task.id);
      resumed += 1;
      resumeMain = resume;
      return true;
    };
    env.deps.runLoopPrompt = async (prompt) => { inputs.push(prompt); };

    await env.coordinator.handleMessage(env.task.id, {
      type: "loopGroupChatChat:continueTask", prompt: "继续完成剩余子任务",
    } as never);
    assert.equal(resumed, 1);
    assert.equal(inputs.length, 0);
    env.task.status = "running";
    resumeMain();
    await delay(0);
    assert.equal(resumed, 1);
    assert.equal(inputs[0]?.loopContinuePrompt, "继续完成剩余子任务");
    assert.equal(JSON.stringify(env.task.modelRouting), originalRouting);
    assert.deepEqual(env.warnings, []);
  });
}

test("Loop+ 继续恢复中断子任务并保留继续消息，不直接重启主任务", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  const messages: string[] = [];
  let resumed = 0;
  env.deps.resumeLoopSubtasks = () => { resumed += 1; return true; };
  env.deps.notifyLoopPlusUserMessage = (_taskId, text) => { messages.push(text); };
  const before = JSON.stringify(env.task);
  await env.coordinator.continueTask(env.task.id, "继续完成剩余子任务");
  assert.equal(resumed, 1);
  assert.equal(env.runs, 0);
  assert.deepEqual(messages, ["继续完成剩余子任务"]);
  assert.equal(JSON.stringify(env.task), before);
  assert.ok(env.messages.some((message) => message.type === "loopGroupChatChat:continueTaskSettled"));
});

for (const reason of ["completed", "busy", "failure-limit", "restore-failed"] as const) {
  test(`继续执行在 ${reason} 时不启动子任务`, async () => {
    const env = createContinuationRecoveryHarness();
    let resumed = 0;
    env.deps.resumeLoopSubtasks = () => { resumed += 1; return true; };
    if (reason === "completed") env.task.status = "completed";
    if (reason === "busy") {
      env.task.status = "running";
      env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
      env.deps.isTabRunActive = () => true;
    }
    if (reason === "failure-limit") env.task.mainAiFailureLimitReached = true;
    if (reason === "restore-failed") {
      env.deps.restoreOriginalLoopRuntime = async () => ({ ok: false, message: "配置已失效" });
    }
    await env.coordinator.continueTask(env.task.id, "继续执行");
    assert.equal(resumed, 0);
    assert.equal(env.runs, 0);
    assert.ok(env.messages.some((message) => message.type === "loopGroupChatChat:continueTaskSettled"));
  });
}

test("子任务恢复异常后继续按钮收尾并允许重试", async () => {
  const env = createContinuationRecoveryHarness();
  env.deps.resumeLoopSubtasks = () => { throw new Error("子任务恢复失败"); };
  await env.coordinator.continueTask(env.task.id, "继续执行");
  assert.deepEqual(env.warnings, ["子任务恢复失败"]);
  assert.equal(env.runs, 0);
  env.deps.resumeLoopSubtasks = () => false;
  await env.coordinator.continueTask(env.task.id, "重试继续");
  assert.equal(env.runs, 1);
});

test("opening reveals before model preparation, coalesces clicks and reads the latest task", async () => {
  const env = createContinuationRecoveryHarness();
  const events: string[] = [];
  let releasePaint!: (ready: boolean) => void;
  const paint = new Promise<boolean>((resolve) => { releasePaint = resolve; });
  let releaseModels!: () => void;
  const models = new Promise<void>((resolve) => { releaseModels = resolve; });
  let shownPrompt = "";
  const panel = {
    showLoading: () => { events.push("reveal"); return paint; },
    setAskThread: () => undefined,
    update: (state: import("../../webview/loopGroupChatPanel").LoopGroupChatPanelState) => {
      events.push("show"); shownPrompt = state.task.rootPrompt;
    },
  };
  env.deps.panelsByTaskId.set(env.task.id, panel as never);
  env.deps.prepareModelSwitchOptions = async () => { events.push("models"); await models; };
  const first = env.coordinator.open(env.task.id);
  const second = env.coordinator.open(env.task.id);
  await delay(0);
  assert.deepEqual(events, ["reveal", "reveal"]);
  releasePaint(true);
  await delay(0);
  assert.equal(events.filter((event) => event === "models").length, 1);
  await env.coordinator.refresh(env.task.id);
  env.task.rootPrompt = "加载期间更新后的任务";
  releaseModels();
  await Promise.all([first, second]);
  assert.equal(shownPrompt, "加载期间更新后的任务");
  assert.equal(events.filter((event) => event === "show").length, 1);
});

for (const outcome of ["closed-before-paint", "closed-during-models", "failed"] as const) {
  test(`opening handles ${outcome} without reviving a disposed page`, async () => {
    const env = createContinuationRecoveryHarness();
    let shown = 0;
    let failed = 0;
    const panel = {
      showLoading: async () => outcome !== "closed-before-paint",
      getState: () => undefined,
      setAskThread: () => undefined,
      update: () => { shown += 1; },
      showLoadingError: () => { failed += 1; },
    };
    env.deps.panelsByTaskId.set(env.task.id, panel as never);
    env.deps.prepareModelSwitchOptions = async () => {
      if (outcome === "failed") throw new Error("读取模型失败");
      env.deps.panelsByTaskId.delete(env.task.id);
    };
    await env.coordinator.open(env.task.id);
    assert.equal(shown, 0);
    assert.equal(failed, outcome === "failed" ? 1 : 0);
  });
}

test("invalid thinking switch does not persist or resume any role", async () => {
  const env = createContinuationRecoveryHarness();
  let writes = 0;
  let resumed = 0;
  env.deps.updateTaskRecord = () => { writes += 1; return env.task; };
  env.deps.resumeLoopSubtasks = () => { resumed += 1; };
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  const before = JSON.stringify(env.task);
  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" }, { main: "foreign", fullstack: "max" });
  assert.equal(writes, 0);
  assert.equal(resumed, 0);
  assert.equal(env.runs, 0);
  assert.equal(JSON.stringify(env.task), before);
  assert.match(env.warnings[0], /思考力度已不可用/u);
});

test("invalid model switch does not write or resume a task", async () => {
  const env = createContinuationRecoveryHarness();
  let writes = 0;
  env.deps.updateTaskRecord = () => { writes += 1; return env.task; };
  env.deps.getLoopModelSwitchOptions = () => [{ value: "available", label: "可用模型" }];
  await env.coordinator.switchModels(env.task.id, { main: "foreign", fullstack: "available" });
  assert.equal(writes, 0);
  assert.equal(env.runs, 0);
  assert.equal(env.warnings.length, 1);
});

test("duplicate model submissions save and resume only once while options load", async () => {
  const env = createContinuationRecoveryHarness();
  let writes = 0;
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  env.deps.prepareModelSwitchOptions = () => gate;
  env.deps.updateTaskRecord = (_taskId, patch) => { writes += 1; return Object.assign(env.task, patch); };
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  const models = { main: "new-model", fullstack: "new-model" };
  const first = env.coordinator.switchModels(env.task.id, models);
  const second = env.coordinator.switchModels(env.task.id, models);
  release();
  await Promise.all([first, second]);
  await delay(0);
  assert.equal(writes, 1);
  assert.equal(env.runs, 1);
});

test("model switch resumes a cold task despite stale persisted running status", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  env.deps.resumeLoopSubtasks = () => false;
  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" });
  await delay(0);
  await delay(0);
  assert.equal(env.runs, 1);
  assert.deepEqual(env.warnings, []);
});

test("model switch can resume paused Loop+ control while a sibling child remains active", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "needs-review";
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  env.deps.resumeLoopSubtasks = () => false;
  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" });
  await delay(0);
  assert.equal(env.runs, 1);
  assert.deepEqual(env.warnings, []);
});

test("继续通过面板消息唤醒仍持有控制器但主模型空闲的 Loop+ 任务", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.task.loopPlus = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  let runOptions: Parameters<typeof env.deps.runLoopPrompt>[1] | undefined;
  env.deps.runLoopPrompt = async (_input, options) => { runOptions = options; };

  await env.coordinator.handleMessage(env.task.id, {
    type: "loopGroupChatChat:continueTask",
    prompt: "继续执行",
  } as never);

  assert.equal(env.runs, 0);
  assert.equal(runOptions?.resumeRequested, true);
  assert.equal(runOptions?.resumeUserMessage, "继续执行");
  assert.equal(env.messages.find((message) => message.type === "loopGroupChatChat:continueTaskSettled")?.canContinue, true);
  assert.deepEqual(env.warnings, []);
});

test("Loop+ 面板只在主模型空闲时显示继续入口，即使后台控制器仍存在", () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.task.loopPlus = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  const idle = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(idle.mainModelBusy, false);
  assert.equal(idle.loopPlus?.activity, "idle");
  assert.equal(idle.task.canContinue, true);
  assert.equal(idle.task.canStop, false);

  env.deps.isTabRunActive = () => true;
  const busy = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(busy.mainModelBusy, true);
  assert.equal(busy.task.canContinue, false);
  assert.equal(busy.loopPlus?.activity, "running");
  assert.equal(busy.rounds[0]?.participants[0]?.status, "running");

  env.deps.isTabRunActive = () => false;
  env.deps.resolveMainPromptTarget = () => null;
  const inactive = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(inactive.loopPlus?.activity, "idle");
});

test("Loop+ 继续与中止按钮互斥，活动子任务结束后才恢复 blocked 子任务", async () => {
  const env = createContinuationRecoveryHarness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([
    { subtaskId: "A", attemptId: "a-1", writeFiles: ["src/a.ts"] },
    { subtaskId: "B", attemptId: "b-1", writeFiles: ["src/b.ts"] },
  ]);
  env.task.status = "running";
  env.task.loopPlus = scheduler.snapshot();
  env.task.subTasks = ["A", "B"].map((id) => ({ id, title: id, status: "running" }));
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);

  const active = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(active.loopPlus?.activity, "waiting");
  assert.equal(active.task.canStop, true);
  assert.equal(active.task.canContinue, false);
  env.deps.collectRunningTaskIds = () => new Set();
  assert.equal(buildLoopGroupChatPanelState(env.task, env.deps).task.canContinue, false);
  await env.coordinator.handleMessage(env.task.id, { type: "loopGroupChatChat:continueTask", prompt: "继续执行" });
  assert.equal(env.runs, 0);
  assert.equal(env.messages.at(-1)?.canContinue, false);

  env.task.subTasks[0].status = "blocked";
  const mixed = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(mixed.task.canStop, true);
  assert.equal(mixed.task.canContinue, false);
  await env.coordinator.handleMessage(env.task.id, { type: "loopGroupChatChat:continueTask", prompt: "继续执行" });
  assert.equal(env.runs, 0);
  assert.equal(env.messages.at(-1)?.canContinue, false);

  env.task.subTasks[1].status = "blocked";
  const interrupted = buildLoopGroupChatPanelState(env.task, env.deps);
  assert.equal(interrupted.task.canStop, false);
  assert.equal(interrupted.task.canContinue, true);
});

test("Loop+ 子任务对话续跑期间群聊立即切换状态，兄弟和旧尝试保持中断", async () => {
  const env = createContinuationRecoveryHarness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([{ subtaskId: "A", attemptId: "a1" }]);
  scheduler.finish({ subtaskId: "A", attemptId: "a1", outcome: "completed" });
  const failed = scheduler.snapshot().currentReview!;
  scheduler.submitReviewBatch([failed.eventId], "failed");
  scheduler.dispatch([{ subtaskId: "A", attemptId: "a2" }, { subtaskId: "B", attemptId: "b1" }]);
  env.task.status = "running";
  env.task.loopPlus = scheduler.snapshot();
  env.task.subTasks = ["A", "B"].map(id => ({ id, title: id, status: "blocked", updatedAt: 12 }));
  const run = (subtaskId: string, attemptId?: string, stopped = false) => ({ taskRole: "subtask" as const, loopTaskId: env.task.id,
    loopSubtaskId: subtaskId, loopAttemptId: attemptId, loopRound: 1, startedAt: 20, stopped });
  const live = [run("A", "a1"), run("A"), run("A", "a2", true)];
  env.deps.getLiveSubtaskRuns = () => live;
  const render = () => buildLoopGroupChatPanelState(env.task, env.deps);
  const statuses = () => render().rounds[0].participants.filter(member => member.role === "subtask").map(member => member.status);
  assert.deepEqual(statuses(), ["waiting_continuation", "waiting_continuation"]);
  live.push(run("B"));
  assert.deepEqual(statuses(), ["waiting_continuation", "running"]);
  live.pop();
  live.push(run("B", "b1"));
  assert.deepEqual(statuses(), ["waiting_continuation", "running"]);
  live.push(run("A", "a2"));
  assert.deepEqual(statuses(), ["repairing", "running"]);
  const active = render();
  assert.ok(active.loopPlus?.ok);
  assert.equal(active.loopPlus.runningCount, 2);
  assert.equal(active.task.canContinue, false);
  await env.coordinator.handleMessage(env.task.id, { type: "loopGroupChatChat:continueTask", prompt: "继续执行" });
  assert.equal(env.runs, 0);
  assert.equal(env.messages.at(-1)?.canContinue, false);
  live.splice(-2);
  assert.deepEqual(statuses(), ["waiting_continuation", "waiting_continuation"]);
  assert.equal(render().task.canContinue, true);
  assert.deepEqual(env.task.subTasks.map(member => member.status), ["blocked", "blocked"]);
  scheduler.finish({ subtaskId: "B", attemptId: "b1", outcome: "completed" });
  env.task.loopPlus = scheduler.snapshot();
  live.push(run("B", "b1"));
  assert.deepEqual(statuses(), ["waiting_continuation", "queued_review"]);
});

test("群聊巡检重读错过通知的续跑与失联状态", async () => {
  const env = createContinuationRecoveryHarness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([{ subtaskId: "A", attemptId: "a1" }]);
  env.task.status = "running";
  env.task.loopPlus = scheduler.snapshot();
  env.task.subTasks = [{ id: "A", title: "A", status: "blocked" }];
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  const live = [{ taskRole: "subtask" as const, loopTaskId: env.task.id, loopSubtaskId: "A", loopAttemptId: "a1", loopRound: 1, startedAt: 20 }];
  env.deps.getLiveSubtaskRuns = () => live;
  const statuses: string[] = [];
  env.deps.panelsByTaskId.get(env.task.id)!.update = (state) => {
    statuses.push(state.rounds[0].participants.find(member => member.id === "A")?.status ?? "missing");
  };
  env.coordinator.refreshOpenPanels();
  await new Promise(resolve => setImmediate(resolve));
  live.pop();
  scheduler.finish({ subtaskId: "A", attemptId: "a1", outcome: "unconfirmed" });
  env.task.loopPlus = scheduler.snapshot();
  env.coordinator.refreshOpenPanels();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(statuses, ["running", "queued_review"]);
});

test("经典 Loop 只展示活动批次中当前轮次的真实续跑，停止后恢复等待", () => {
  const env = createContinuationRecoveryHarness();
  Object.assign(env.task, { schedulingMode: "classic", status: "stopped", runtimeInterrupted: true, activeSubtaskIds: ["A", "B"] });
  env.task.subTasks = ["A", "B", "C"].map(id => ({ id, title: id, status: "blocked" }));
  env.deps.getActiveSubtaskIds = () => ["A", "B"];
  const run = { taskRole: "subtask" as const, loopTaskId: env.task.id, loopSubtaskId: "A", loopRound: env.task.currentRound, startedAt: 20 };
  const live = [{ ...run, loopRound: run.loopRound - 1 }, { ...run, loopTaskId: "另一任务" }, { ...run, loopSubtaskId: "C" }];
  env.deps.getLiveSubtaskRuns = () => live;
  const render = () => buildLoopGroupChatPanelState(env.task, env.deps);
  const members = () => render().rounds[0].participants.filter(member => member.role === "subtask");
  assert.deepEqual(members().map(member => member.status), ["waiting_continuation", "waiting_continuation", "blocked"]);
  live.push(run);
  assert.deepEqual(members().map(member => member.status), ["running", "waiting_continuation", "blocked"]);
  assert.equal(members()[0].lastStartedAt, 20);
  assert.equal(render().task.canContinue, false);
  live.pop();
  assert.equal(members()[0].status, "waiting_continuation");
  assert.equal(render().task.canContinue, true);
  assert.equal(env.task.subTasks[0].status, "blocked");
});

for (const outcome of ["ready", "error", "stopped"] as const) {
  test(`Loop+ 提问开始立即更新主任务活动，${outcome} 后恢复空闲`, async () => {
    const env = createContinuationRecoveryHarness();
    env.task.status = "running";
    env.task.loopPlus = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
    env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
    env.deps.normalizeSupplementalRequirement = (value) => typeof value === "string" ? value : null;
    let mainModelActive = false;
    env.deps.isTabRunActive = () => mainModelActive;
    type State = ReturnType<typeof buildLoopGroupChatPanelState>;
    const updates: State[] = [];
    const panel = env.deps.panelsByTaskId.get(env.task.id)!;
    panel.update = (state) => { updates.push(state); };
    panel.publishAskThread = () => undefined;
    let start: (() => void) | undefined;
    let finish: (() => void) | undefined;
    env.deps.askMainModel = async (_task, _question, hooks) => {
      start = () => hooks?.onStarted?.();
      await new Promise<void>((resolve) => { finish = resolve; });
      if (outcome === "error") throw new Error("回答失败");
      return { status: outcome, answer: "回答内容" };
    };
    const asking = env.coordinator.handleMessage(env.task.id, {
      type: "loopGroupChatChat:askMainModel", prompt: "当前进展如何？",
    } as never);
    await env.coordinator.refresh(env.task.id);
    assert.equal(updates.at(-1)?.loopPlus?.activity, "idle", "排队本身不代表模型正在回答");
    mainModelActive = true;
    start?.();
    assert.equal(updates.at(-1)?.loopPlus?.activity, "running");
    assert.equal(updates.at(-1)?.mainModelBusy, true);
    assert.equal(updates.at(-1)?.task.canContinue, false);
    await env.coordinator.refresh(env.task.id);
    assert.equal(updates.at(-1)?.rounds[0]?.participants[0]?.status, "running");
    mainModelActive = false;
    finish?.();
    await asking;
    assert.equal(updates.at(-1)?.loopPlus?.activity, "idle");
    assert.equal(updates.at(-1)?.mainModelBusy, false);
  });
}

test("切模型在没有可恢复子任务时会把继续消息交给主任务调度", async () => {
  const env = createContinuationRecoveryHarness();
  env.task.status = "running";
  env.deps.collectRunningTaskIds = () => new Set([env.task.id]);
  env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  env.deps.resumeLoopSubtasks = () => false;
  let runOptions: Parameters<typeof env.deps.runLoopPrompt>[1] | undefined;
  env.deps.runLoopPrompt = async (_input, options) => { runOptions = options; };

  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" });
  await delay(0);

  assert.equal(runOptions?.resumeRequested, true);
  assert.equal(runOptions?.resumeUserMessage, "run.hiddenContinuePrompt");
  assert.deepEqual(env.warnings, []);
});

test("model switch waits for resumed children before starting their parent", async () => {
  const env = createContinuationRecoveryHarness();
  env.deps.updateTaskRecord = (_taskId, patch) => Object.assign(env.task, patch);
  env.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
  let resumeMain = () => undefined as void;
  env.deps.resumeLoopSubtasks = (_taskId, resume) => { resumeMain = resume; return true; };
  await env.coordinator.switchModels(env.task.id, { main: "new-model", fullstack: "new-model" });
  assert.equal(env.runs, 0);
  env.task.status = "running";
  resumeMain();
  await delay(0);
  assert.equal(env.runs, 1);
});

test("failed original-runtime restoration settles continuation and allows a second attempt", async () => {
  const harness = createContinuationRecoveryHarness();
  const restore = harness.deps.restoreOriginalLoopRuntime;
  harness.deps.restoreOriginalLoopRuntime = async () => ({ ok: false, message: "执行中的任务尚未结束" });
  await harness.coordinator.continueTask(harness.task.id, "继续执行", "original");
  assert.deepEqual(harness.warnings, ["执行中的任务尚未结束"]);
  assert.deepEqual(harness.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: true }]);
  assert.equal(harness.runs, 0);
  assert.equal(harness.refreshes, 1);
  harness.deps.restoreOriginalLoopRuntime = restore;
  await harness.coordinator.continueTask(harness.task.id, "再次继续", "original");
  assert.equal(harness.runs, 1);
  assert.equal(harness.messages.length, 2);
});

for (const schedulingMode of ["classic", "event_driven"] as const) {
  test(`reports continuation start before the ${schedulingMode} run settles`, async () => {
    const harness = createContinuationRecoveryHarness();
    harness.task.schedulingMode = schedulingMode;
    let admit!: () => void;
    let finish!: () => void;
    let reportStarted!: () => void;
    const admission = new Promise<void>((resolve) => { admit = resolve; });
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const started = new Promise<void>((resolve) => { reportStarted = resolve; });
    harness.deps.runLoopPrompt = async (_input, options) => {
      await admission;
      options.onTaskStarted?.();
      reportStarted();
      await finished;
    };
    const requestId = "continue-client-test-1";
    const continuing = harness.coordinator.handleMessage(harness.task.id, {
      type: "loopGroupChatChat:continueTask", requestId, prompt: "继续执行",
    });
    await delay(0);
    const refreshPending = () => harness.coordinator.handleMessage(harness.task.id, { type: "loopGroupChatChat:refresh", continueRequestId: requestId });
    await refreshPending();
    assert.equal(harness.messages.length, 0);
    admit();
    await started;
    await refreshPending();
    assert.deepEqual(harness.messages, [{ type: "loopGroupChatChat:continueTaskStarted", requestId }]);
    finish();
    await continuing;
    assert.equal(harness.messages[1].type, "loopGroupChatChat:continueTaskSettled");
    await refreshPending();
    assert.deepEqual(harness.messages[2], harness.messages[1]);
  });
}

test("rejects an unavailable question with the original request ID", async () => {
  const harness = createContinuationRecoveryHarness();
  const requestId = "ask-client-test-1";
  await harness.coordinator.handleMessage(harness.task.id, {
    type: "loopGroupChatChat:askMainModel", requestId, prompt: "哪里需要确认？",
  });
  assert.deepEqual(harness.messages, [{
    type: "loopGroupChatChat:askSubmissionRejected", requestId, error: "loopGroupChatChat.askUnavailable",
  }]);
});

for (const failureStage of ["restore", "run"] as const) {
  test(`unexpected ${failureStage} errors settle continuation and remain retryable`, async () => {
    const harness = createContinuationRecoveryHarness();
    const failure = async (): Promise<never> => { throw new Error("续跑启动异常"); };
    if (failureStage === "restore") harness.deps.restoreOriginalLoopRuntime = failure;
    else harness.deps.runLoopPrompt = failure;
    await harness.coordinator.continueTask(harness.task.id, "继续执行", "original");
    assert.deepEqual(harness.warnings, ["续跑启动异常"]);
    assert.deepEqual(harness.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: true }]);
    harness.deps.restoreOriginalLoopRuntime = async () => ({ ok: true, target: { tabId: "main-tab", cli: "codex" } });
    harness.deps.runLoopPrompt = async () => undefined;
    await harness.coordinator.continueTask(harness.task.id, "再次继续", "original");
    assert.equal(harness.messages.length, 2);
  });
}

test("missing and already-running tasks still acknowledge continuation requests", async () => {
  const missing = createContinuationRecoveryHarness();
  missing.deps.readTaskRecord = () => null;
  await missing.coordinator.continueTask(missing.task.id, "继续执行", "original");
  assert.deepEqual(missing.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: false }]);
  const running = createContinuationRecoveryHarness();
  running.task.status = "running";
  running.deps.collectRunningTaskIds = () => new Set([running.task.id]);
  running.deps.isTabRunActive = () => true;
  await running.coordinator.continueTask(running.task.id, "继续执行", "original");
  assert.deepEqual(running.messages, [{ type: "loopGroupChatChat:continueTaskSettled", canContinue: false }]);
  assert.equal(running.runs, 0);
});

test("continues a persisted-running Loop+ task when its host owns an idle controller", async () => {
  const orphaned = createContinuationRecoveryHarness();
  orphaned.task.status = "running";
  orphaned.deps.collectRunningTaskIds = () => new Set();
  await orphaned.coordinator.continueTask(orphaned.task.id, "继续执行");
  assert.equal(orphaned.runs, 1);

  const active = createContinuationRecoveryHarness();
  active.task.status = "running";
  active.deps.collectRunningTaskIds = () => new Set([active.task.id]);
  active.deps.isTabRunActive = () => true;
  await active.coordinator.continueTask(active.task.id, "继续执行");
  assert.equal(active.runs, 0);
  assert.deepEqual(active.warnings, []);
});

test("duplicate continuation requests cannot start a task twice while original runtime restoration is pending", async () => {
  const harness = createContinuationRecoveryHarness();
  let releaseRestore!: () => void;
  const gate = new Promise<void>((resolve) => { releaseRestore = resolve; });
  harness.deps.restoreOriginalLoopRuntime = async () => {
    await gate;
    return { ok: true, target: { tabId: "main-tab", cli: "codex" } };
  };
  const first = harness.coordinator.continueTask(harness.task.id, "继续执行", "original");
  await harness.coordinator.continueTask(harness.task.id, "重复继续", "original");
  assert.equal(harness.runs, 0);
  assert.equal(harness.messages.length, 0);
  releaseRestore();
  await first;
  assert.equal(harness.runs, 1);
  assert.equal(harness.messages.length, 1);
});

test("continuation stages identify an open loop wait, a rejected restore, and a failed leader handoff", async () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const remember = (env: ReturnType<typeof createContinuationRecoveryHarness>) => {
    env.deps.logEvent = (event, payload) => logs.push({ event, payload });
  };
  const stages = (requestId: string) => logs.filter((item) => item.event === "loop-group-chat-continue-stage" && item.payload.requestId === requestId);
  const classic = createContinuationRecoveryHarness();
  remember(classic);
  classic.task.schedulingMode = "classic";
  delete classic.task.originProfile;
  let releaseRun!: () => void;
  const running = new Promise<void>((resolve) => { releaseRun = resolve; });
  classic.deps.runLoopPrompt = async () => { await running; };
  const classicRequest = classic.coordinator.handleMessage(classic.task.id, {
    type: "loopGroupChatChat:continueTask", requestId: "continue-loop-1", prompt: "SECRET_PROMPT",
  });
  await delay(0);
  assert.deepEqual(stages("continue-loop-1").filter((item) => item.payload.stage === "run_loop_prompt").map((item) => item.payload.boundary), ["start"]);
  assert.equal(stages("continue-loop-1").some((item) => item.payload.stage === "settled_refresh"), false);
  assert.equal(stages("continue-loop-1").every((item) => item.payload.path === "loop"), true);
  releaseRun();
  await classicRequest;
  const classicEnd = stages("continue-loop-1").find((item) => item.payload.stage === "run_loop_prompt" && item.payload.boundary === "end");
  assert.equal(classicEnd?.payload.result, "ok");
  assert.equal(typeof classicEnd?.payload.elapsedMs, "number");
  assert.equal(stages("continue-loop-1").some((item) => item.payload.stage === "settled_refresh" && item.payload.boundary === "end"), true);

  const restored = createContinuationRecoveryHarness();
  remember(restored);
  let releaseRestore!: (value: { ok: false; message: string }) => void;
  const restoration = new Promise<{ ok: false; message: string }>((resolve) => { releaseRestore = resolve; });
  restored.deps.restoreOriginalLoopRuntime = () => restoration;
  const unsafeRequest = restored.coordinator.handleMessage(restored.task.id, {
    type: "loopGroupChatChat:continueTask", requestId: "continue bad id", prompt: "SECRET_PROMPT",
  });
  await delay(0);
  assert.equal(stages("invalid-id").some((item) => item.payload.stage === "restore_original_runtime" && item.payload.boundary === "start" && item.payload.path === "loop_plus"), true);
  assert.equal(stages("invalid-id").some((item) => item.payload.stage === "restore_original_runtime" && item.payload.boundary === "end"), false);
  assert.equal(stages("invalid-id").some((item) => item.payload.stage === "settled_refresh"), false);
  releaseRestore({ ok: false, message: "执行中的任务尚未结束" });
  await unsafeRequest;
  assert.equal(stages("invalid-id").find((item) => item.payload.stage === "restore_original_runtime" && item.payload.boundary === "end")?.payload.result, "rejected");
  assert.equal(JSON.stringify(logs).includes("SECRET_PROMPT"), false);
  assert.equal(JSON.stringify(logs).includes("continue bad id"), false);

  const route = { cli: "codex" as const };
  const limits = { maxLeaders: 1, maxEmployees: 1 };
  const routes = { director: route, leader: route, employee: route };
  const leader = createContinuationRecoveryHarness();
  remember(leader);
  const root = createStoppedTask();
  root.id = "root-1";
  root.subTasks = [{ id: "module-1", title: "module", status: "running" }];
  root.department = { version: 1, role: "director", rootTaskId: root.id, parentTaskId: null, leaderSubtaskId: null, moduleTitle: "root", routes, limits };
  leader.task.id = "leader-1";
  leader.task.department = { version: 1, role: "leader", rootTaskId: root.id, parentTaskId: root.id, leaderSubtaskId: "module-1", moduleTitle: "module", routes, limits };
  const panel = leader.deps.panelsByTaskId.get("task-1");
  leader.deps.panelsByTaskId.set(leader.task.id, panel as never);
  leader.deps.readTaskRecord = (taskId) => taskId === root.id ? root : taskId === leader.task.id ? leader.task : null;
  leader.deps.continueDepartmentLeader = async () => { throw new Error("SYNTHETIC_SECRET_STACK"); };
  await leader.coordinator.handleMessage(leader.task.id, { type: "loopGroupChatChat:continueTask", requestId: "continue-leader-1", prompt: "SECRET_PROMPT" });
  const leaderEnd = stages("continue-leader-1").find((item) => item.payload.stage === "leader_continue" && item.payload.boundary === "end");
  assert.equal(leaderEnd?.payload.path, "leader");
  assert.equal(leaderEnd?.payload.result, "failed");
  assert.equal(leaderEnd?.payload.reason, "unexpected_failure");
  assert.equal(JSON.stringify(logs).includes("SYNTHETIC_SECRET_STACK"), false);
  assert.equal(leader.warnings.includes("SYNTHETIC_SECRET_STACK"), true);

  const director = createContinuationRecoveryHarness();
  remember(director);
  director.task.department = { version: 1, role: "director", rootTaskId: director.task.id, parentTaskId: null, leaderSubtaskId: null, moduleTitle: "root", routes, limits };
  director.deps.readDepartmentOrganizationControlState = () => ({ needsCleanup: false });
  let releaseDirector!: () => void;
  const directorGate = new Promise<void>((resolve) => { releaseDirector = resolve; });
  director.deps.departmentOrganizationControl = { continue: async (_root, _prompt, requestId) => {
    assert.equal(requestId, "continue-director-1");
    await directorGate;
  }, stop: async () => undefined, complete: async () => undefined };
  const directorRequest = director.coordinator.handleMessage(director.task.id, {
    type: "loopGroupChatChat:continueTask", requestId: "continue-director-1", prompt: "SECRET_PROMPT",
  });
  await delay(0);
  assert.deepEqual(stages("continue-director-1").filter((item) => item.payload.stage === "director_continue").map((item) => item.payload.boundary), ["start"]);
  releaseDirector();
  await directorRequest;
  assert.equal(stages("continue-director-1").find((item) => item.payload.stage === "director_continue" && item.payload.boundary === "end")?.payload.result, "ok");
  assert.equal(stages("continue-director-1").some((item) => item.payload.stage === "settled_refresh" && item.payload.boundary === "end" && item.payload.path === "director"), true);
});

test("a resolved runLoopPrompt that leaves the task interrupted or needing review is not a successful handoff", async () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const stageEnd = (requestId: string) => logs.find((item) => item.event === "loop-group-chat-continue-stage"
    && item.payload.requestId === requestId && item.payload.stage === "run_loop_prompt" && item.payload.boundary === "end");
  const continueWith = async (requestId: string, apply: (task: ReturnType<typeof createStoppedTask>) => void) => {
    const env = createContinuationRecoveryHarness();
    env.deps.logEvent = (event, payload) => logs.push({ event, payload });
    env.task.schedulingMode = "classic";
    delete env.task.originProfile;
    env.deps.runLoopPrompt = async () => { apply(env.task); };
    await env.coordinator.handleMessage(env.task.id, {
      type: "loopGroupChatChat:continueTask", requestId, prompt: "SECRET_PROMPT",
    });
    return stageEnd(requestId)?.payload;
  };

  const interrupted = await continueWith("continue-interrupted-1", (task) => {
    task.status = "needs-review";
    task.runtimeInterrupted = true;
    task.finalSummary = "SECRET_FAILURE_TEXT";
    task.sessionId = "SECRET_SESSION";
  });
  const errored = await continueWith("continue-error-1", (task) => {
    task.status = "error";
    task.loopPlusInterruption = { phase: "reviewing", reason: "execution-error" };
    task.finalSummary = "SECRET_FAILURE_TEXT";
  });
  const running = await continueWith("continue-running-1", (task) => {
    task.status = "running";
    task.runtimeInterrupted = undefined;
    task.loopPlusInterruption = undefined;
  });

  assert.equal(interrupted?.result, "failed");
  assert.equal(interrupted?.reason, "task_interrupted");
  assert.equal(interrupted?.path, "loop");
  assert.equal(errored?.result, "failed");
  assert.equal(errored?.reason, "task_interrupted");
  assert.notEqual(interrupted?.result, running?.result);
  assert.equal(running?.result, "ok");
  assert.equal(running?.reason, "none");
  assert.equal(JSON.stringify(logs).includes("SECRET_PROMPT"), false);
  assert.equal(JSON.stringify(logs).includes("SECRET_FAILURE_TEXT"), false);
  assert.equal(JSON.stringify(logs).includes("SECRET_SESSION"), false);
});

test("does not recreate a closed main tab while rendering a terminal Loop panel", () => {
  const task = createStoppedTask();
  let createOptions: { createIfMissing?: boolean } | undefined;
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: (taskId) => taskId === task.id ? task : null,
    updateTaskRecord: () => task,
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: (_task, options) => {
      createOptions = options;
      return null;
    },
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => "current-config",
    getSelectedCliModel: () => "current-model",
    runLoopPrompt: async () => undefined,
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: () => undefined,
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  assert.equal(buildLoopGroupChatPanelState(task, deps).messageLimit, undefined);
  deps.getMessageLimit = () => 320;
  assert.equal(buildLoopGroupChatPanelState(task, deps).messageLimit, 320);
  deps.getMessageLimit = () => 100;
  assert.equal(buildLoopGroupChatPanelState(task, deps).messageLimit, 100);
  assert.deepEqual(createOptions, { createIfMissing: false });
});

for (const originalMode of ["split", "fullstack"] as const) {
  test(`Loop+ model switch preserves task ${originalMode} instead of current UI mode`, () => {
    const task = createStoppedTask();
    task.schedulingMode = "event_driven";
    task.loopSubtaskMode = originalMode;
    task.originProfile = { configId: "original-config" };
    task.modelRouting = {
      main: { model: "original-main" },
      subtask: { model: "original-backend" },
      subtaskFrontend: { cli: "claude", model: "original-frontend" },
      subtaskFullstack: { cli: "grok", model: "original-fullstack" },
    };
    const currentMode = originalMode === "split" ? "fullstack" : "split";
    const state = buildLoopGroupChatPanelState(task, {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: () => task.id,
      normalizeSupplementalRequirement: () => null,
      appendSupplementalRequirement: () => [],
      appendSupplementalRequirementToCommunication: () => undefined,
      recordPromptHistory: () => undefined,
      readTaskRecord: () => task,
      updateTaskRecord: () => task,
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set(),
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      getActiveSubtaskIds: () => [],
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      resolveMainPromptTarget: () => null,
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => false,
      getActiveConfigIdForCli: (cli) => `${cli}-config`,
      getSelectedCliModel: () => "current-main",
      getSelectedLoopCliModel: (_cli, role) => role === "main" ? "current-main" : "current-backend",
      getSelectedLoopFrontendCli: () => "claude",
      getSelectedLoopFullstackCli: () => "grok",
      getSelectedLoopSubtaskMode: () => currentMode,
      getLoopRoleExplicitModel: (_configId, role) => ({ configured: true, model: `current-${role}` }),
      runLoopPrompt: async () => undefined,
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => task,
      postPanelState: async () => undefined,
      getActiveConversationTaskId: () => task.id,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      pickTask: async () => task,
      t: ((key: string) => key) as Parameters<typeof buildLoopGroupChatPanelState>[1]["t"],
    });

    assert.deepEqual(state.modelSwitch?.fields.map((field) => field.role), originalMode === "split"
      ? ["main", "subtask", "frontend"] : ["main", "fullstack"]);
    assert.equal(state.modelSwitch?.fields[0].model, "original-main");
  });
}

test("Loop group chat continuation uses the main tab current CLI config and model", async () => {
  const task = createStoppedTask();
  const configCalls: string[] = [];
  const modelCalls: Array<{ cli: string; configId: string | null }> = [];
  const runCalls: Array<{ input: Record<string, unknown>; options: Record<string, unknown> }> = [];
  let continueTargetOptions: { createIfMissing?: boolean } | undefined;
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: (taskId) => taskId === task.id ? task : null,
    updateTaskRecord: () => task,
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: (_task, options) => {
      continueTargetOptions = options;
      return { tabId: "main-tab", cli: "opencode" };
    },
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: (cli) => {
      configCalls.push(cli);
      return `${cli}-active-config`;
    },
    getSelectedCliModel: (cli, configId) => {
      modelCalls.push({ cli, configId: configId ?? null });
      return `${cli}-latest-model`;
    },
    runLoopPrompt: async (input, options) => {
      runCalls.push({ input, options });
    },
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: () => undefined,
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  await coordinator.continueTask(task.id, "继续执行");

  assert.deepEqual(configCalls, ["opencode"]);
  assert.deepEqual(modelCalls, [{ cli: "opencode", configId: "opencode-active-config" }]);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0]?.input.model, "opencode-latest-model");
  assert.equal(runCalls[0]?.options.targetTabId, "main-tab");
  assert.equal(runCalls[0]?.options.resumeTaskId, task.id);
  assert.equal(runCalls[0]?.options.resumeRequested, true);
  assert.deepEqual(continueTargetOptions, { createIfMissing: true });
});

test("legacy tasks without a runtime profile continue without choosing a model source", async () => {
  const task = createStoppedTask();
  task.modelRouting = {
    main: { model: "original-main" },
    subtask: { model: "original-subtask" },
  };
  const patches: Array<Partial<LoopTaskRecord>> = [];
  const warnings: string[] = [];
  const runCalls: Array<Record<string, unknown>> = [];
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: (taskId) => taskId === task.id ? task : null,
    updateTaskRecord: (_taskId, patch) => {
      patches.push(patch);
      return task;
    },
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "codex" }),
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => undefined,
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => "codex-active-config",
    getSelectedCliModel: () => "selected-model",
    getSelectedLoopCliModel: (_cli, role) => role === "main" ? "current-main" : "current-subtask",
    runLoopPrompt: async (input) => {
      runCalls.push(input);
    },
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: (message) => { warnings.push(message); },
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  await coordinator.continueTask(task.id, "继续", "original");

  assert.deepEqual(warnings, []);
  assert.equal(runCalls.length, 1);

  await coordinator.continueTask(task.id, "继续", "current");

  assert.equal(patches.length, 0);
  assert.equal(runCalls[0]?.model, "current-main");
  assert.equal(runCalls[0]?.loopSubtaskModel, "current-subtask");
});

test("Loop group chat original runtime restores recorded selections and rejects restoration failures", async () => {
  const task = createStoppedTask();
  task.modelRouting = {
    main: { model: "original-main" },
    subtask: { model: "original-subtask" },
  };
  task.originProfile = {
    configId: "original-config",
    mainThinkingMode: "high",
    subtaskThinkingMode: "low",
  };
  const runCalls: Array<{ input: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const restored: string[] = [];
  const warnings: string[] = [];
  const sideEffects: string[] = [];
  type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
  const deps: CoordinatorDeps = {
    getExtensionUri: () => ({ fsPath: "/extension" } as any),
    panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: () => null,
    appendSupplementalRequirement: (existing) => [...(existing ?? [])],
    appendSupplementalRequirementToCommunication: () => undefined,
    recordPromptHistory: () => undefined,
    readTaskRecord: (taskId) => taskId === task.id ? task : null,
    updateTaskRecord: () => { sideEffects.push("update"); return task; },
    listTaskStoreFiles: () => [],
    readTaskStoreTasks: () => [],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => null,
    fileExists: () => false,
    writeTextFileEnsuringDir: () => true,
    getActiveSubtaskIds: () => [],
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: () => ({ tabId: "current-tab", cli: "opencode" }),
    revealPanelView: async () => undefined,
    switchVisibleConversationTabForLoop: async () => { sideEffects.push("switch"); },
    isTabRunActive: () => false,
    getActiveConfigIdForCli: () => "current-config",
    getSelectedCliModel: () => "current-model",
    restoreOriginalLoopRuntime: async (restoredTask) => {
      restored.push(restoredTask.id);
      return { ok: true, target: { tabId: "origin-tab", cli: "codex" } };
    },
    runLoopPrompt: async (input, options) => {
      runCalls.push({ input, options });
    },
    stopRunsForTask: () => undefined,
    markTaskStoppedByUser: () => task,
    postPanelState: async () => undefined,
    getActiveConversationTaskId: () => task.id,
    showInformationMessage: () => undefined,
    showWarningMessage: (message) => { warnings.push(message); },
    pickTask: async () => task,
    t: ((key: string) => key) as CoordinatorDeps["t"],
  };

  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  await coordinator.continueTask(task.id, "继续", "original");

  assert.deepEqual(restored, [task.id]);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0]?.input.model, "original-main");
  assert.equal(runCalls[0]?.input.loopMainModel, "original-main");
  assert.equal(runCalls[0]?.input.loopSubtaskModel, "original-subtask");
  assert.equal(runCalls[0]?.input.loopMainThinkingMode, "high");
  assert.equal(runCalls[0]?.input.loopSubtaskThinkingMode, "low");
  assert.equal(runCalls[0]?.options.targetTabId, "origin-tab");
  assert.equal(runCalls[0]?.options.preserveLoopOrigin, true);
  assert.equal(runCalls[0]?.options.resumeTaskId, task.id);

  const previousSideEffects = [...sideEffects];
  deps.restoreOriginalLoopRuntime = async () => ({ ok: false, message: "recorded config missing" });
  await coordinator.continueTask(task.id, "继续", "original");
  assert.deepEqual(warnings, ["recorded config missing"]);
  assert.equal(runCalls.length, 1);
  assert.deepEqual(sideEffects, previousSideEffects);

  deps.restoreOriginalLoopRuntime = async () => ({ ok: true, target: { tabId: null, cli: "codex" } });
  await coordinator.continueTask(task.id, "继续", "original");
  assert.deepEqual(warnings, ["recorded config missing", "loopGroupChatChat.originalRuntimeUnavailable"]);
  assert.equal(runCalls.length, 1);
  assert.deepEqual(sideEffects, previousSideEffects);
});

test("previews a communication file from the open Loop group chat", async () => {
  const fs = require("fs") as typeof import("fs");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const vscode = require("vscode") as typeof import("vscode");
  const previousCreate = vscode.window.createWebviewPanel;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-chat-preview-"));
  const posted: unknown[] = [];
  let messageHandler: ((message: unknown) => void) | undefined;
  (vscode.window as { createWebviewPanel: (...args: unknown[]) => unknown }).createWebviewPanel = () => ({
    title: "",
    webview: {
      cspSource: "self",
      html: "",
      postMessage(message: unknown) {
        posted.push(message);
      },
      onDidReceiveMessage(handler: (message: unknown) => void) {
        messageHandler = handler;
        return { dispose: () => undefined };
      },
    },
    reveal() {
      return undefined;
    },
    onDidDispose() {
      return { dispose: () => undefined };
    },
  });
  try {
    const task = createStoppedTask();
    const communicationDir = path.join(root, task.id);
    const filePath = path.join(communicationDir, "subtasks", "round-1-demo.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "# 标题\n\n- 一条\n<script>alert(1)</script>\n", "utf8");
    task.communicationDir = communicationDir;
    task.mainCommunicationFile = path.join(communicationDir, "main-task.md");
    type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      normalizeSupplementalRequirement: () => null,
      appendSupplementalRequirement: (existing) => [...(existing ?? [])],
      appendSupplementalRequirementToCommunication: () => undefined,
      recordPromptHistory: () => undefined,
      readTaskRecord: (taskId) => taskId === task.id ? task : null,
      updateTaskRecord: () => task,
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set(),
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      getActiveSubtaskIds: () => [],
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      resolveMainPromptTarget: () => null,
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => false,
      getActiveConfigIdForCli: () => "current-config",
      getSelectedCliModel: () => "current-model",
      runLoopPrompt: async () => undefined,
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => task,
      postPanelState: async () => undefined,
      getActiveConversationTaskId: () => task.id,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      pickTask: async () => task,
      t: ((key: string) => key) as CoordinatorDeps["t"],
    };
    const coordinator = createLoopGroupChatPanelCoordinator(deps);
    const opening = coordinator.open(task.id);
    await delay(0);
    messageHandler?.({ type: "loopGroupChatChat:loadingReady" });
    await opening;
    assert.equal(typeof messageHandler, "function");
    messageHandler?.({ type: "loopGroupChatChat:openCommunicationFile", requestId: " ", path: filePath });
    messageHandler?.({ type: "loopGroupChatChat:openCommunicationFile", requestId: "x".repeat(81), path: filePath });
    messageHandler?.({ type: "loopGroupChatChat:openCommunicationFile", requestId: "req-1", path: filePath });
    assert.equal(posted.length, 1);
    const message = posted[0] as { ok?: boolean; html?: string; error?: string };
    assert.equal(message.ok, true);
    assert.match(message.html ?? "", /<h1>标题<\/h1>/u);
    assert.match(message.html ?? "", /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
    assert.doesNotMatch(message.html ?? "", /<script>/u);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("persists Loop and Loop+ supplements in prompt history while busy and queues only Loop+ messages", async (context) => {
  const historyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-supplement-history-"));
  context.after(() => fs.rmSync(historyRoot, { recursive: true, force: true }));
  const vscode = require("vscode") as typeof import("vscode");
  const previousCreate = vscode.window.createWebviewPanel;
  let messageHandler: ((message: unknown) => void) | undefined;
  (vscode.window as { createWebviewPanel: (...args: unknown[]) => unknown }).createWebviewPanel = () => ({
    title: "",
    webview: {
      cspSource: "self",
      html: "",
      postMessage() {
        return undefined;
      },
      onDidReceiveMessage(handler: (message: unknown) => void) {
        messageHandler = handler;
        return { dispose: () => undefined };
      },
    },
    reveal() {
      return undefined;
    },
    onDidDispose() {
      return { dispose: () => undefined };
    },
  });
  try {
    const task = createStoppedTask();
    task.status = "running";
    task.schedulingMode = "event_driven";
    const notices: string[] = [];
    const communication: string[] = [];
    const historyCalls: Array<{ prompt: string; cli: string }> = [];
    const historyOptions: PromptHistoryStoreOptions = {
      promptHistoryDir: path.join(historyRoot, "prompt-history"),
      legacyPromptHistoryFile: path.join(historyRoot, "prompt-history.json"),
      workspaceKey: task.workspaceKey,
      workspaceKeyFallback: "no-workspace",
      promptHistoryLimit: 200,
      currentCli: "codex",
      isCliName: (value): value is "codex" | "claude" => value === "codex" || value === "claude",
      isTimestampWithinHistoryRetention: () => true,
    };
    let historyStore: PromptHistoryStore = { items: [] };
    let historyRefreshes = 0;
    type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      appendSupplementalRequirement: (existing, nextItem) => [...(existing ?? []), nextItem],
      appendSupplementalRequirementToCommunication: (_task, requirement) => { communication.push(requirement); },
      recordPromptHistory: (prompt, cli) => {
        historyCalls.push({ prompt, cli });
        historyStore = recordPromptHistoryInStore(historyStore, prompt, cli, historyOptions);
      },
      readTaskRecord: (taskId) => taskId === task.id ? task : null,
      updateTaskRecord: (_taskId, patch) => Object.assign(task, patch),
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set([task.id]),
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      getActiveSubtaskIds: () => [],
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "codex" }),
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => true,
      getActiveConfigIdForCli: () => "current-config",
      getSelectedCliModel: () => "current-model",
      runLoopPrompt: async () => { assert.fail("补充需求不应启动并发主模型调用"); },
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => task,
      postPanelState: async () => { historyRefreshes += 1; },
      getActiveConversationTaskId: () => task.id,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      pickTask: async () => task,
      notifyLoopPlusUserMessage: (_taskId, text) => {
        notices.push(text);
      },
      t: ((key: string) => key) as CoordinatorDeps["t"],
    };
    const coordinator = createLoopGroupChatPanelCoordinator(deps);
    const opening = coordinator.open(task.id);
    await delay(0);
    messageHandler?.({ type: "loopGroupChatChat:loadingReady" });
    await opening;
    assert.equal(typeof messageHandler, "function");
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "  please check the running subtask  " });
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "then check another requirement" });
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "   " });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notices, ["please check the running subtask", "then check another requirement"]);
    assert.deepEqual(task.supplementalRequirements, notices);
    assert.deepEqual(communication, notices);
    assert.deepEqual(historyCalls, notices.map((prompt) => ({ prompt, cli: "codex" })));
    assert.equal(historyRefreshes, 2);
    assert.deepEqual(loadPromptHistoryStore(historyOptions).items.map((item) => item.prompt).sort(), [...notices].sort());
    const originalHistoryId = historyStore.items.find((item) => item.prompt === notices[0])?.id;

    notices.length = 0;
    task.schedulingMode = "classic";
    task.cli = "claude";
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "classic only" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(notices, []);
    assert.deepEqual(task.supplementalRequirements, ["please check the running subtask", "then check another requirement", "classic only"]);
    assert.deepEqual(communication, task.supplementalRequirements);

    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "  please check the running subtask  " });
    await new Promise((resolve) => setImmediate(resolve));
    const reloadedHistory = loadPromptHistoryStore(historyOptions);
    assert.equal(reloadedHistory.items.length, 3);
    assert.deepEqual(historyCalls.slice(2), [
      { prompt: "classic only", cli: "claude" },
      { prompt: "please check the running subtask", cli: "claude" },
    ]);
    assert.equal(reloadedHistory.items.find((item) => item.prompt === "classic only")?.cli, "claude");
    assert.equal(reloadedHistory.items[0].id, originalHistoryId);
    assert.equal(reloadedHistory.items[0].cli, "claude");
    assert.equal(historyRefreshes, 4);
    assert.deepEqual(notices, []);

    deps.readTaskRecord = () => null;
    messageHandler?.({ type: "loopGroupChatChat:supplementTask", prompt: "missing task" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(historyCalls.length, 4);
    assert.equal(historyRefreshes, 4);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
  }
});


test("asks the current main model session and shows the answer without supplementing the task", async () => {
  const vscode = require("vscode");
  const previousCreate = vscode.window.createWebviewPanel;
  let messageHandler: ((message: unknown) => void) | undefined;
  const posted: Array<{ type?: string; thread?: { messages?: Array<{ content?: string; role?: string; queued?: boolean }>; running?: boolean; queued?: boolean } }> = [];
  const webview = {
    cspSource: "self",
    html: "",
    postMessage(message: { type?: string; thread?: { messages?: Array<{ content?: string; role?: string; queued?: boolean }>; running?: boolean; queued?: boolean } }) {
      posted.push(message);
      return undefined;
    },
    onDidReceiveMessage(handler: (message: unknown) => void) {
      messageHandler = handler;
      return { dispose: () => undefined };
    },
  };
  (vscode.window as { createWebviewPanel: (...args: unknown[]) => unknown }).createWebviewPanel = () => ({
    title: "",
    webview,
    reveal() {
      return undefined;
    },
    onDidDispose() {
      return { dispose: () => undefined };
    },
  });
  try {
    const task = createStoppedTask();
    task.schedulingMode = "event_driven";
    const notices: string[] = [];
    const questions: string[] = [];
    const savedThreads: string[] = [];
    let mainModelBusy = true;
    let supplementalCount = 0;
    let aborts = 0;
    let holdAnswer = false;
    const questionQueue = createLoopMainQuestionQueue({ pollIntervalMs: 1 });
    type CoordinatorDeps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    const deps: CoordinatorDeps = {
      getExtensionUri: () => ({ fsPath: "/extension" } as any),
      panelsByTaskId: new Map(),
      normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      appendSupplementalRequirement: (existing, nextItem) => {
        supplementalCount += 1;
        return [...(existing ?? []), nextItem];
      },
      appendSupplementalRequirementToCommunication: () => undefined,
      recordPromptHistory: () => undefined,
      readTaskRecord: (taskId) => taskId === task.id ? task : null,
      updateTaskRecord: () => task,
      listTaskStoreFiles: () => [],
      readTaskStoreTasks: () => [],
      collectRunningTaskIds: () => new Set([task.id]),
      readTextFileIfNonEmpty: () => null,
      fileExists: () => false,
      writeTextFileEnsuringDir: () => true,
      getActiveSubtaskIds: () => [],
      buildCompletedConclusionAndSummaryMarkdown: () => "",
      resolveMainPromptTarget: () => ({ tabId: "main-tab", cli: "codex" }),
      revealPanelView: async () => undefined,
      switchVisibleConversationTabForLoop: async () => undefined,
      isTabRunActive: () => mainModelBusy,
      getActiveConfigIdForCli: () => "current-config",
      getSelectedCliModel: () => "current-model",
      runLoopPrompt: async () => undefined,
      stopRunsForTask: () => undefined,
      markTaskStoppedByUser: () => task,
      postPanelState: async () => undefined,
      getActiveConversationTaskId: () => task.id,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      pickTask: async () => task,
      notifyLoopPlusUserMessage: (_taskId, text) => {
        notices.push(text);
      },
      askMainModel: async (_task, question, hooks) => await questionQueue.runQuestion("main-tab", {
        canRun: () => !mainModelBusy,
        isAborted: hooks?.isAborted,
        signal: hooks?.signal,
      }, async () => {
        hooks?.onStarted?.();
        questions.push(question);
        if (question === "失败的问题") {
          throw new Error("answer failed");
        }
        hooks?.onProgress?.({
          before: [],
          current: [{
            id: "think",
            role: "assistant",
            content: "thinking 先看冲突",
            kind: "thinking",
            createdAt: 1,
          }],
        });
        if (holdAnswer) {
          await new Promise<void>((resolve) => {
            hooks?.signal?.addEventListener("abort", () => { aborts += 1; resolve(); }, { once: true });
          });
        }
        return { status: "ready" as const, answer: "可以先合并冲突文件。" };
      }) ?? { status: "stopped" as const },
      readAskThread: () => ({
        version: 1,
        messages: [{ id: "old", role: "user", content: "上次的问题", createdAt: 1 }],
        running: false,
        dialogOpen: false,
        updatedAt: 1,
      }),
      writeAskThread: (_task, thread) => {
        savedThreads.push(thread.messages.map((message) => message.content).join("|"));
      },
      t: ((key: string) => key) as CoordinatorDeps["t"],
    };
    const coordinator = createLoopGroupChatPanelCoordinator(deps);
    const opening = coordinator.open(task.id);
    await delay(0);
    messageHandler?.({ type: "loopGroupChatChat:loadingReady" });
    await opening;
    const installedHtml = webview.html;
    assert.match(installedHtml, /上次的问题/u);
    assert.doesNotMatch(installedHtml, /id="askChatSend"[^>]*disabled/u);
    messageHandler?.({ type: "loopGroupChatChat:domReady", generation: 1 });
    const savedCount = savedThreads.length;
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "  可以合并吗  ", requestId: "ask-client-test-1" });
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "再确认当前进度", requestId: "ask-client-test-2" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(questions.length, 0);
    assert.ok(savedThreads.length > savedCount);
    const panelWhileBusy = deps.panelsByTaskId.get(task.id);
    assert.equal(panelWhileBusy?.getState()?.mainModelBusy, true);
    assert.deepEqual(panelWhileBusy?.getAskThread().messages.map((message) => message.content), ["上次的问题", "可以合并吗", "再确认当前进度"]);
    assert.deepEqual(panelWhileBusy?.getAskThread().messages.map((message) => message.id), ["old", "ask-client-test-1", "ask-client-test-2"]);
    assert.equal(panelWhileBusy?.getAskThread().running, true);
    assert.equal(panelWhileBusy?.getAskThread().queued, true);
    assert.deepEqual(panelWhileBusy?.getAskThread().messages.filter((message) => message.queued).map((message) => message.content), ["可以合并吗", "再确认当前进度"]);
    mainModelBusy = false;
    await coordinator.refresh(task.id);
    assert.equal(panelWhileBusy?.getState()?.mainModelBusy, false);
    await delay(15);
    assert.deepEqual(questions, ["可以合并吗", "再确认当前进度"]);
    assert.equal(supplementalCount, 0);
    assert.equal(webview.html, installedHtml);
    const askThreads = posted.filter((message) => message.type === "loopGroupChatChat:askThread");
    const latestAsk = askThreads.at(-1)?.thread;
    const answeringFirst = askThreads.find((message) => message.thread?.running && !message.thread.queued);
    assert.deepEqual(answeringFirst?.thread?.messages?.filter((message) => message.queued).map((message) => message.content), ["再确认当前进度"]);
    const askText = latestAsk?.messages?.map((message) => message.content ?? "").join("\n") ?? "";
    assert.match(askText, /可以合并吗/u);
    assert.doesNotMatch(askText, /先看冲突/u);
    assert.equal(latestAsk?.running, false);
    assert.equal(panelWhileBusy?.getAskThread().messages.some((message) => message.queued), false);
    assert.match(askText, /可以先合并冲突文件。/u);
    assert.doesNotMatch(installedHtml, /ask-chat-thinking/u);
    assert.ok(savedThreads.every((entry) => !entry.includes("先看冲突")));
    const panel = deps.panelsByTaskId.get(task.id);
    assert.equal(panel?.getAskThread().dialogOpen, true);
    assert.equal(panel?.getAskThread().running, false);
    assert.equal(notices.length, 0);
    assert.ok(savedThreads.some((entry) => entry.includes("可以先合并冲突文件。")));

    messageHandler?.({ type: "loopGroupChatChat:dismissMainModelAnswer" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(panel?.getAskThread().dialogOpen, false);
    assert.match(panel?.getAskThread().messages.map((message) => message.content).join("\n") ?? "", /上次的问题/u);
    assert.match(panel?.getAskThread().messages.map((message) => message.content).join("\n") ?? "", /可以先合并冲突文件。/u);
    mainModelBusy = true;
    messageHandler?.({ type: "loopGroupChatChat:openAskDialog" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(panel?.getState()?.mainModelBusy, true);
    assert.equal(panel?.getAskThread().dialogOpen, true);
    assert.deepEqual(questions, ["可以合并吗", "再确认当前进度"]);

    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "取消排队的问题" });
    messageHandler?.({ type: "loopGroupChatChat:abortMainModelQuestion" });
    await delay(5);
    assert.equal(aborts, 0);
    assert.equal(panel?.getAskThread().running, false);
    assert.doesNotMatch(questions.join("\n"), /取消排队的问题/u);
    assert.equal(panel?.getAskThread().messages.some((message) => message.queued), false);

    mainModelBusy = false;
    holdAnswer = true;
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "中止正在回答的问题" });
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "同时清空后续问题" });
    await delay(5);
    assert.deepEqual(panel?.getAskThread().messages.filter((message) => message.queued).map((message) => message.content), ["同时清空后续问题"]);
    messageHandler?.({ type: "loopGroupChatChat:abortMainModelQuestion" });
    await delay(5);
    assert.equal(aborts, 1);
    assert.equal(panel?.getAskThread().running, false);
    assert.doesNotMatch(questions.join("\n"), /同时清空后续问题/u);
    assert.equal(panel?.getAskThread().messages.some((message) => message.queued), false);

    holdAnswer = false;
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "失败的问题" });
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "失败后继续" });
    const review = questionQueue.runMain("main-tab", async () => { questions.push("后到的验收"); });
    messageHandler?.({ type: "loopGroupChatChat:askMainModel", prompt: "验收之后的问题" });
    const settled = questionQueue.runMain("main-tab", async () => undefined);
    await Promise.all([review, settled]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(questions.slice(-4), ["失败的问题", "失败后继续", "后到的验收", "验收之后的问题"]);
    assert.equal(panel?.getAskThread().running, false);
    assert.equal(panel?.getAskThread().messages.some((message) => message.queued), false);
  } finally {
    vscode.window.createWebviewPanel = previousCreate;
  }
});
