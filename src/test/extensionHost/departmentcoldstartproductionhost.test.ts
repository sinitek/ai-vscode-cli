import * as assert from "node:assert/strict";
import { test } from "node:test";
import { createColdDeadlinePlan, createDepartmentColdStartHostTestEntry, readColdLoopPlusAttempt, coldRemaining, waitForColdPublicStopAction,
  waitForColdRecoveryWarning } from "./fixtures/departmentcoldstartproductionhost";
import { sameExecution } from "../../runtime/departmentexecutionidentity";

test("cold EH fixture reads exact persisted identities and only calls the original Owner observe endpoint", () => {
  const entry = createDepartmentColdStartHostTestEntry({ root: "/isolated/root", home: "/isolated/home", product: "/isolated/product", rootTaskId: "root-exact" });
  assert.match(entry, /department-source\.json/);
  assert.match(entry, /department-owner\.json/);
  assert.match(entry, /loop-task-identities/);
  assert.match(entry, /department-runtime/);
  assert.match(entry, /identity\.session\.state !== 'bound'/);
  assert.match(entry, /identity\.rootTaskId/);
  assert.match(entry, /isDepartmentExecutionBinding\(binding\)/);
  assert.match(entry, /sameExecution\(item\.identity, item\.observation\.identity\)/);
  assert.match(entry, /identity\.generation/);
  assert.match(entry, /leader\.loopPlus\?\.running/);
  assert.match(entry, /binding\.selection\?\.configId/);
  assert.match(entry, /capacity\.employees/);
  assert.match(entry, /capacity\.leaders/);
  assert.match(entry, /observeExecution\(item\.identity\)/);
  assert.doesNotMatch(entry, /\.startExecution\(|\.handoffExecution\(|waitForCleanup\(|releaseCapacity|recoverRoot\(/);
  assert.match(entry, /sinitek-cli-tools\.openLoopGroupChat/);
  assert.match(entry, /cold-second-host-ready\.json/);
  assert.match(entry, /original-owner-observation-errors\.ndjson/);
  assert.match(entry, /cold EH protocol observer reported a diagnostic/);
  assert.match(entry, /cold-recovery-check\.signal/);
  assert.match(entry, /waitForColdPublicStopAction/);
  assert.match(entry, /live-leader-unverifiable/);
  assert.match(entry, /beforeActivation/);
  assert.match(entry, /afterActivation/);
  assert.match(entry, /module\.status !== 'running'/);
  assert.match(entry, /finally/);
  assert.match(entry, /public recovery action was not triggered before its deadline/);
});

test("cold Loop+ fixture requires the exact durable scheduler attempt and retained leader/employee capacity", () => {
  const root: any = { id: "root", workspaceKey: "workspace", status: "running", department: { executionMode: "loop-plus", role: "director",
    rootTaskId: "root", routes: { leader: "frozen" } }, subTasks: [{ id: "module", status: "running" }] };
  const held = { leaderTaskId: "leader", subtaskId: "employee", attemptId: "attempt", reportFile: "/attempt-report" };
  const leader: any = { id: "leader", workspaceKey: "workspace", status: "running", department: { executionMode: "loop-plus", role: "leader",
    rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", routes: { leader: "frozen" } },
  subTasks: [{ id: "employee", status: "running", communicationFile: "/attempt-report" }], loopPlus: { running: [{ subtaskId: "employee", attemptId: "attempt" }] } };
  const saved: any = { rootTaskId: "root", workspaceKey: "workspace", runtime: { stopping: false,
    leaders: [{ taskId: "leader", leaderSubtaskId: "module", status: "running" }] },
  capacity: { leaders: ["module"], employees: [JSON.stringify(["leader", "attempt"])] } };
  assert.deepEqual(readColdLoopPlusAttempt(root, [root, leader], saved, held).capacityKey, JSON.stringify(["leader", "attempt"]));
  for (const mutate of [
    (value: any) => { value.leader.loopPlus.running[0].attemptId = "other"; },
    (value: any) => { value.saved.capacity.employees = []; },
    (value: any) => { value.saved.capacity.leaders = []; },
    (value: any) => { value.leader.subTasks[0].communicationFile = "/other"; },
  ]) {
    const value = structuredClone({ leader, saved }); mutate(value);
    assert.throws(() => readColdLoopPlusAttempt(root, [root, value.leader], value.saved, held));
  }
});

test("cold EH waits for delayed production warning and rejects missing or unrelated results", async () => {
  const exact = { message: "部门恢复核验阻塞：live-leader-unverifiable。保留原占用，不能重新派发。", rootTaskId: "root", actionSequence: 1 };
  const warnings: typeof exact[] = [];
  const delayed = setTimeout(() => warnings.push(exact), 8);
  try {
    const actions = [{ rootTaskId: "root", sequence: 1 }];
    assert.equal(await waitForColdRecoveryWarning(() => warnings, "root", Date.now() + 40,
      ms => new Promise(resolve => setTimeout(resolve, ms)), () => actions), exact.message);
  } finally {
    clearTimeout(delayed);
  }
  const pause = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));
  const actions = [{ rootTaskId: "root", sequence: 1 }];
  const until = Date.now() + 20;
  await assert.rejects(() => waitForColdRecoveryWarning(() => [], "root", until, pause, () => actions), /exact action warning/);
  await assert.rejects(() => waitForColdRecoveryWarning(() => [{ ...exact, message: "other live-leader-unverifiable text" }], "root", Date.now() + 20, pause, () => actions), /not the exact/);
  await assert.rejects(() => waitForColdRecoveryWarning(() => [exact, { ...exact, message: "activation failed" }], "root", Date.now() + 20, pause, () => actions), /duplicate or mixed/);
  await assert.rejects(() => waitForColdRecoveryWarning(() => [{ ...exact, rootTaskId: "other" }], "root", Date.now() + 20, pause, () => actions), /not the exact/);
  await assert.rejects(() => waitForColdRecoveryWarning(() => [{ ...exact, actionSequence: 0 }], "root", Date.now() + 20, pause, () => actions), /not the exact/);
  await assert.rejects(() => waitForColdRecoveryWarning(() => [exact], "root", Date.now() + 30, pause,
    () => [{ ...actions[0] }, { rootTaskId: "root", sequence: 2 }]), /action changed/);
  const duplicateWarnings: typeof exact[] = [];
  const duplicateLater = setTimeout(() => duplicateWarnings.push({ ...exact }), 8);
  const duplicateLatest = setTimeout(() => duplicateWarnings.push({ ...exact }), 16);
  try {
    await assert.rejects(() => waitForColdRecoveryWarning(() => duplicateWarnings, "root", Date.now() + 30, pause, () => actions), /duplicate/);
  } finally { clearTimeout(duplicateLater); clearTimeout(duplicateLatest); }
  const delayedMixed: typeof exact[] = [];
  const firstExact = setTimeout(() => delayedMixed.push({ ...exact }), 5);
  const lateWrong = setTimeout(() => delayedMixed.push({ ...exact, message: "late unrelated warning" }), 14);
  try {
    await assert.rejects(() => waitForColdRecoveryWarning(() => delayedMixed, "root", Date.now() + 35, pause, () => actions), /duplicate or mixed/);
  } finally { clearTimeout(firstExact); clearTimeout(lateWrong); }
  const afterFirstWarning: { rootTaskId: string; sequence: number }[] = [{ rootTaskId: "root", sequence: 1 }];
  const stopWarnings: typeof exact[] = [];
  const firstWarningTimer = setTimeout(() => stopWarnings.push({ ...exact }), 5);
  const repeatedStopTimer = setTimeout(() => afterFirstWarning.push({ rootTaskId: "root", sequence: 2 }), 14);
  try {
    await assert.rejects(() => waitForColdRecoveryWarning(() => stopWarnings, "root", Date.now() + 35, pause,
      () => afterFirstWarning), /action changed/);
  } finally { clearTimeout(firstWarningTimer); clearTimeout(repeatedStopTimer); }
});

test("cold EH shares one absolute deadline across host, action, observation, evidence and exit", () => {
  const plan = createColdDeadlinePlan(1000, 180000);
  assert.equal(plan.hostDeadline, 181000);
  assert.ok(plan.actionDeadline < plan.observationDeadline);
  assert.ok(plan.observationDeadline < plan.evidenceDeadline);
  assert.ok(plan.evidenceDeadline < plan.hostDeadline);
  assert.ok(plan.warningWindowMs < plan.observationDeadline - plan.actionDeadline);
  assert.throws(() => coldRemaining(plan.hostDeadline, () => 181000), /deadline exhausted/);
  assert.throws(() => coldRemaining(plan.hostDeadline, () => 181001), /deadline exhausted/);
  const entry = createDepartmentColdStartHostTestEntry({ root: "/isolated/root", home: "/isolated/home", product: "/isolated/product",
    rootTaskId: "root-exact", deadlines: plan });
  assert.match(entry, /cold EH absolute deadline exhausted/);
  assert.match(entry, /deadlines\.observationDeadline/);
  assert.match(entry, /deadlines\.evidenceDeadline/);
  assert.match(entry, /finally \{ observer.restore\(\); restoreProtocolObserver\(\); \}/);
});

test("cold EH distinguishes the public click signal from delivered root-bound stop action", async () => {
  const pause = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));
  const actions: { rootTaskId: string; sequence: number }[] = [];
  const delayed = setTimeout(() => actions.push({ rootTaskId: "root", sequence: 1 }), 8);
  try {
    assert.deepEqual(await waitForColdPublicStopAction(() => actions, "root", Date.now() + 100, pause), { rootTaskId: "root", sequence: 1 });
  } finally { clearTimeout(delayed); }
  await assert.rejects(() => waitForColdPublicStopAction(() => [], "root", Date.now() + 10, pause), /not followed by a delivered/);
  await assert.rejects(() => waitForColdPublicStopAction(() => [{ rootTaskId: "foreign", sequence: 1 }], "root", Date.now() + 20, pause), /belonged to another root/);
  await assert.rejects(() => waitForColdPublicStopAction(() => [{ rootTaskId: "root", sequence: 1 }, { rootTaskId: "root", sequence: 2 }], "root", Date.now() + 20, pause), /duplicate/);
});

import { installColdPublicControlObserver } from "./fixtures/departmentcoldstartproductionhost";
import { installVscodeMock } from "../vscodeMock";
import { departmentState } from "../loop/departmentGroupChatPanel.fixture";
installVscodeMock();
const vscode = require("vscode") as typeof import("vscode");
const { LoopGroupChatPanel } = require("../../webview/loopGroupChatPanel") as typeof import("../../webview/loopGroupChatPanel");

function publicPanelApi() {
  const panels: any[] = [], calls: any[] = [];
  const window = {
    createWebviewPanel(this: unknown, ...args: any[]) {
      calls.push({ thisArg: this, args });
      const listeners = new Set<(value: any) => void>();
      const postResult = Promise.resolve(true);
      const panel = { webview: { html: "", cspSource: "self", postResult,
        postMessage(this: unknown, ...postArgs: any[]) { calls.push({ postThis: this, postArgs }); return postResult; },
        onDidReceiveMessage(callback: (value: any) => void) { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; },
      }, reveal() {}, onDidDispose() { return { dispose() {} }; },
      receive: (message: any) => { for (const listener of listeners) listener(message); }, listeners };
      panels.push(panel); return panel;
    },
    showWarningMessage(this: unknown, ...args: any[]) { calls.push({ warningThis: this, args }); return Promise.resolve("original-result"); },
  };
  return { panels, calls, window: window as unknown as Parameters<typeof installColdPublicControlObserver>[0] };
}

test("cold public observer installs on production API before activation and observes a real panel reused after DOM ready", async () => {
  const api = publicPanelApi(), originalCreate = vscode.window.createWebviewPanel, originalWarning = vscode.window.showWarningMessage;
  vscode.window.createWebviewPanel = api.window.createWebviewPanel;
  vscode.window.showWarningMessage = api.window.showWarningMessage;
  const restoreCreate = vscode.window.createWebviewPanel, restoreWarning = vscode.window.showWarningMessage;
  const observer = installColdPublicControlObserver(vscode.window);
  try {
    const state = departmentState("director"), delivered: unknown[] = [];
    const group = new LoopGroupChatPanel({ fsPath: "/fixture" } as any, { onMessage: message => {
      delivered.push(message);
      if (message.type === "loopGroupChatChat:stopTask") void vscode.window.showWarningMessage("exact warning");
    } });
    // Represents activation creating the panel, then the command reusing it.
    group.show(state);
    api.panels[0].receive({ type: "loopGroupChatChat:domReady", generation: 1 });
    group.show(state);
    assert.equal(api.panels.length, 1);
    const message = { type: "loopGroupChatChat:stopTask" };
    api.panels[0].receive(message);
    assert.equal(delivered[0], message, "production receives the original message exactly once");
    assert.equal(observer.actions.length, 1);
    assert.equal(observer.actions[0].rootTaskId, state.task.id);
    assert.equal(observer.warnings[0].rootTaskId, state.task.id);
    assert.equal(observer.warnings[0].actionSequence, 1);
    assert.equal(api.calls[0].thisArg, vscode.window);
    const post = api.calls.find(call => call.postArgs);
    assert.equal(post.postThis, api.panels[0].webview);
    assert.equal(api.panels[0].webview.postMessage({ type: "unchanged" }), api.panels[0].webview.postResult);
    assert.equal(await vscode.window.showWarningMessage("another warning"), "original-result");
    assert.equal(api.calls[api.calls.length - 1].warningThis, vscode.window);
    observer.restore();
    assert.equal(vscode.window.createWebviewPanel, restoreCreate);
    assert.equal(vscode.window.showWarningMessage, restoreWarning);
    api.panels[0].receive(message);
    assert.equal(observer.actions.length, 1, "disposed observer accepted late action");
  } finally { observer.restore(); vscode.window.createWebviewPanel = originalCreate; vscode.window.showWarningMessage = originalWarning; }
});

test("cold public observer uses actual root on content reuse and rejects foreign, unbound, duplicate or missing delivery", async () => {
  for (const mode of ["foreign", "unbound", "duplicate", "missing", "icon-only", "wrong-role", "malformed-root"] as const) {
    const api = publicPanelApi(), observer = installColdPublicControlObserver(api.window);
    try {
      const panel = api.window.createWebviewPanel("sinitek-cli-tools.loopGroupChatChat", "title", 1, {}) as any;
      panel.webview.html = '<h1 id="panelHeading">产研部群聊</h1><p id="panelSubtitle" title="root">root</p>';
      if (mode === "foreign") panel.webview.postMessage({ type: "loopGroupChatChat:contentPatch", subtitleText: "foreign", headingText: "产研部群聊" });
      if (mode === "unbound") panel.webview.html = '<h1 id="panelHeading">组长1</h1>';
      if (mode === "icon-only") panel.webview.html = '<h1 id="panelHeading">☀️</h1><p id="panelSubtitle" title="root">root</p>';
      if (mode === "wrong-role") panel.webview.html = '<h1 id="panelHeading">组长1</h1><p id="panelSubtitle" title="root">root</p>';
      if (mode === "malformed-root") panel.webview.html = '<h1 id="panelHeading">产研部群聊</h1><p id="panelSubtitle" title="root/foreign">root/foreign</p>';
      if (mode !== "missing") panel.receive({ type: "loopGroupChatChat:stopTask" });
      if (mode === "duplicate") panel.receive({ type: "loopGroupChatChat:stopTask" });
      await assert.rejects(() => waitForColdPublicStopAction(() => observer.readActions(), "root", 0, async () => {}),
        ["unbound", "icon-only", "wrong-role", "malformed-root"].includes(mode) ? /unbound/ : mode === "missing" ? /not followed/ : /duplicate or belonged/);
    } finally { observer.restore(); }
  }
});

test("cold generated entry resolves the production extension API and installs before activate, retaining evidence until CDP release", () => {
  const entry = createDepartmentColdStartHostTestEntry({ root: "/isolated/root", home: "/isolated/home", product: "/isolated/product", rootTaskId: "root" });
  assert.match(entry, /createRequire\(path.join\(product, 'package.json'\)\)\('vscode'\)/);
  assert.ok(entry.indexOf("const observer =") < entry.indexOf("extension.activate()"));
  assert.ok(entry.lastIndexOf("await waitForCdpCleanup();") > entry.indexOf("'cold-second-host.json'"));
  assert.match(entry, /cold-second-host-failure.json/);
  assert.match(entry, /observer.restore\(\); restoreProtocolObserver\(\)/);
  assert.doesNotThrow(() => new (require("node:vm").Script)(entry));
});
