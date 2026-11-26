import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installVscodeMock } from "../vscodeMock";
import { departmentRecords, fixtureDepartmentLeaderTaskIds } from "./departmentGroupChatHost.fixture";
import { createLoopMainQuestionQueue } from "../../loopMainQuestionQueue";
import { createLoopPlusScheduler } from "../../loopPlusScheduler";
import { waitForOrchestratorClarification, abortOrchestratorClarification, loopClarificationScope } from "../../orchestratorClarification";
import { assertDepartmentOrganizationContinuation, readDepartmentOrganizationStopFeedback, readDepartmentOrganizationControlState, buildDepartmentGroupChatProjection } from "../../extensionHost/departmentGroupChatProjection";

import type { DepartmentCapacitySnapshot } from "../../departmentcapacity";
import type { LoopTaskRecord } from "../../loopTaskStore";
installVscodeMock();
const { buildLoopGroupChatPanelContentPatch } = require("../../webview/loopGroupChatPanel") as typeof import("../../webview/loopGroupChatPanel");
const { createLoopGroupChatPanelCoordinator, buildLoopGroupChatPanelState } = require("../../extensionHost/loopGroupChatPanelCoordinator") as typeof import("../../extensionHost/loopGroupChatPanelCoordinator");
const vscode = require("vscode") as typeof import("vscode");
type Deps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function harness() {
  const data = departmentRecords();
  const posted: Array<any> = [], warnings: string[] = [], effects: Array<[string, string]> = [];
  const webviews: Array<{
    receive: (message: any) => void;
    dispose: () => void;
    reveals: boolean[];
    documents: string[];
    onPost?: (message: any) => void;
  }> = [];
  const receive = (message: any) => webviews.at(-1)!.receive(message);
  const domReady = deferred();
  const handshakeTimers = new Set<ReturnType<typeof setTimeout>>();
  const scheduleHandshake = (receiveMessage: typeof receive, message: any, onDelivered?: () => void) => {
    const timer = setTimeout(() => {
      handshakeTimers.delete(timer);
      receiveMessage(message);
      onDelivered?.();
    }, 0);
    handshakeTimers.add(timer);
  };
  const previous = vscode.window.createWebviewPanel;
  (vscode.window as any).createWebviewPanel = () => {
    const view: (typeof webviews)[number] = {
      receive: () => assert.fail("Webview message listener not installed"),
      dispose: () => assert.fail("Webview dispose listener not installed"),
      reveals: [], documents: [],
    };
    webviews.push(view);
    let html = "";
    return { title: "", webview: { cspSource: "self", get html() { return html; }, set html(value: string) {
      html = value;
      view.documents.push(value);
      if (value.includes('vscode.postMessage({ type: "loopGroupChatChat:loadingReady" })')) {
        scheduleHandshake(view.receive, { type: "loopGroupChatChat:loadingReady" });
      }
      const generation = /const PANEL_GENERATION = (\d+)/.exec(value)?.[1];
      if (generation) scheduleHandshake(view.receive, { type: "loopGroupChatChat:domReady", generation: Number(generation) }, domReady.resolve);
    },
    onDidReceiveMessage: (handler: typeof receive) => { view.receive = handler; return { dispose() {} }; },
    postMessage: (message: any) => { posted.push(structuredClone(message)); view.onPost?.(message); return Promise.resolve(true); },
    }, reveal(_column: unknown, preserveFocus: boolean) { view.reveals.push(preserveFocus); },
    onDidDispose: (handler: () => void) => { view.dispose = handler; return { dispose() {} }; } };
  };
  const deps: Deps = {
    getExtensionUri: () => ({ fsPath: "/fixture" } as any), panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    appendSupplementalRequirement: (previous, next) => [...(previous ?? []), next],
    recordPromptHistory: () => undefined,
    appendSupplementalRequirementToCommunication: (task) => { effects.push(["supplement", task.id]); },
    readTaskRecord: (id) => data.records.get(id) ?? null,
    readDepartmentOrganizationControlState: (task) => readDepartmentOrganizationStopFeedback(task, data.root.workspaceKey, {
      readTaskRecord: (id) => data.records.get(id) ?? null,
      readCapacity: (id) => ({ rootTaskId: id, maxLeaders: 4, maxEmployees: 20, leaders: [], employees: [] }),
    }),
    readDepartmentLeaderTaskIds: (rootId, moduleId) => fixtureDepartmentLeaderTaskIds(data.records, rootId, moduleId),
    updateTaskRecord: (id, patch) => { const task = data.records.get(id); if (!task) return null; Object.assign(task, patch); effects.push(["write", id]); return task; },
    listTaskStoreFiles: () => ["/fixture/tasks.json"], readTaskStoreTasks: () => [...data.records.values()],
    collectRunningTaskIds: () => new Set(), readTextFileIfNonEmpty: () => null, fileExists: () => false,
    writeTextFileEnsuringDir: () => true, getActiveSubtaskIds: () => [], buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: (task) => ({ tabId: task.id, cli: "codex" }), revealPanelView: async () => {}, switchVisibleConversationTabForLoop: async () => {},
    isTabRunActive: () => false, getActiveConfigIdForCli: () => "config", getSelectedCliModel: () => "model",
    runLoopPrompt: async (_input, options) => { effects.push(["continue", options.resumeTaskId]); },
    continueDepartmentLeader: async (task, _prompt, assertCurrent) => { assertCurrent(); effects.push(["continue-leader", task.id]); },
    stopRunsForTask: (id) => { effects.push(["stop", id]); }, markTaskStoppedByUser: (id) => data.records.get(id) ?? null,
    postPanelState: async () => {}, getActiveConversationTaskId: () => data.root.id,
    showInformationMessage: (message) => { warnings.push(message); }, showWarningMessage: (message) => { warnings.push(message); },
    pickTask: async () => data.root, askMainModel: async (task) => { effects.push(["ask", task.id]); return { status: "ready", answer: "组长回答" }; },
    t: ((key: string) => key) as Deps["t"],
  };
  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  const load = async (taskId = data.leader.id, instanceId = "instance-A") => {
    receive({ type: "loopGroupChatChat:departmentModal", action: "load", taskId, instanceId }); await tick();
    return { taskId, instanceId };
  };
  const send = async (target: { taskId: string; instanceId: string }, message: any) => {
    receive({ type: "loopGroupChatChat:departmentTaskMessage", ...target, message }); await tick();
  };
  return { ...data, deps, coordinator, effects, posted, warnings, load, send, webviews, domReady: domReady.promise,
    receive,
    panel: () => deps.panelsByTaskId.get(data.root.id)!,
    restore: () => { vscode.window.createWebviewPanel = previous; }, dispose: () => {
      for (const timer of handshakeTimers) clearTimeout(timer);
      handshakeTimers.clear();
      webviews.at(-1)?.dispose();
    },
  };
}

test("department continuation messages preserve live panels and isolate replacement from late disposal", async (context) => {
  const fixture = harness();
  context.after(() => {
    fixture.dispose();
    for (const view of fixture.webviews) view.dispose();
    fixture.restore();
  });
  const { root, leader, deps, coordinator, webviews } = fixture;
  const taskIdentity = (task: LoopTaskRecord) => ({
    id: task.id, department: structuredClone(task.department), workspace: task.workspaceKey, cli: task.cli, session: task.sessionId,
  });
  root.sessionId = "fixture-director-session";
  leader.sessionId = "fixture-leader-session";
  const expected = [taskIdentity(root), taskIdentity(leader)];
  const dispatched: unknown[] = [];
  deps.departmentOrganizationControl = {
    continue: async (task, prompt) => { dispatched.push([taskIdentity(task), prompt]); root.status = "running"; },
    stop: async () => assert.fail("unexpected stop"), complete: async () => assert.fail("unexpected completion"),
  };
  deps.continueDepartmentLeader = async (task, prompt, assertCurrent) => { assertCurrent(); dispatched.push([taskIdentity(task), prompt]); };
  deps.runLoopPrompt = async () => assert.fail("department continuation fell back to ordinary Loop");

  for (const task of [root, leader]) await withTimeout(coordinator.open(task.id), `open ${task.id}`);
  const originalPanels = [root, leader].map(task => deps.panelsByTaskId.get(task.id)!);
  assert.equal(webviews.length, 2);
  assert.notEqual(originalPanels[0], originalPanels[1]);
  const originalDocuments = webviews.map(view => [...view.documents]);
  for (const [index, task] of [root, leader].entries()) {
    const view = webviews[index];
    const other = webviews[1 - index];
    const otherReveals = [...other.reveals];
    const settled = deferred();
    const requestId = `continue:${task.id}`;
    view.onPost = message => {
      if (message.type === "loopGroupChatChat:continueTaskSettled" && message.requestId === requestId) settled.resolve();
    };
    view.receive({ type: "loopGroupChatChat:continueTask", requestId, prompt: task.id });
    await withTimeout(settled.promise, `settle ${task.id}`);
    assert.deepEqual(dispatched, expected.slice(0, index + 1).map(identity => [identity, identity.id]));
    assert.deepEqual(taskIdentity(task), expected[index]);
    assert.deepEqual(view.reveals, [true], "continuation refresh does not focus either panel");
    await withTimeout(coordinator.open(task.id, { focus: true }), `reveal ${task.id}`);
    assert.equal(webviews.length, 2);
    assert.equal(deps.panelsByTaskId.get(task.id), originalPanels[index]);
    assert.equal(originalPanels[index].getState()?.task.id, task.id);
    assert.deepEqual(view.reveals, [true, false, true]);
    assert.deepEqual(other.reveals, otherReveals);
    assert.deepEqual(webviews.map(entry => entry.documents), originalDocuments, "reveal and refresh did not reassign webview.html");
  }

  const oldLeader = webviews[1];
  oldLeader.dispose();
  assert.equal(deps.panelsByTaskId.has(leader.id), false);
  assert.equal(deps.panelsByTaskId.get(root.id), originalPanels[0]);
  await withTimeout(coordinator.open(leader.id), "reopen disposed leader");
  const replacement = deps.panelsByTaskId.get(leader.id);
  assert.ok(replacement);
  assert.notEqual(replacement, originalPanels[1]);
  assert.equal(webviews.length, 3);
  const replacementDocuments = [...webviews[2].documents];
  oldLeader.dispose();
  oldLeader.receive({ type: "loopGroupChatChat:continueTask", prompt: "late continuation" });
  await tick();
  await withTimeout(coordinator.open(leader.id, { focus: true }), "reveal replacement after stale disposal");
  assert.equal(webviews.length, 3);
  assert.equal(deps.panelsByTaskId.get(leader.id), replacement);
  assert.equal(deps.panelsByTaskId.get(root.id), originalPanels[0]);
  assert.deepEqual(webviews[2].documents, replacementDocuments);
  assert.deepEqual(webviews[2].reveals, [true, false, true]);
  assert.deepEqual(webviews[0].documents, originalDocuments[0]);
  assert.deepEqual(dispatched, expected.map(identity => [identity, identity.id]));
  assert.deepEqual(fixture.warnings, []);
});

test("department host projection uses validated records, actual attempts and read-only lease snapshot", () => {
  const { root, leader, other, records } = departmentRecords();
  leader.subTasks.unshift({ id: "employee-undispatched", title: "尚未派发", status: "pending" });
  const port = { readTaskRecord: (id: string) => records.get(id) ?? null, readLeaderTaskIds: (rootId: string, moduleId: string) => fixtureDepartmentLeaderTaskIds(records, rootId, moduleId) };
  const projection = buildDepartmentGroupChatProjection(root, port)!;
  assert.equal(projection.leaders.length, 2);
  assert.deepEqual(projection.leaders.map(({ taskId, leaderNumber }) => [taskId, leaderNumber]), [[leader.id, 1], [other.id, 2]]);
  root.subTasks[0].progressWeightPercent = 20;
  root.subTasks[1].progressWeightPercent = 40;
  leader.loopPlusProgressPercent = 50;
  assert.equal(buildDepartmentGroupChatProjection(root, port)!.overallProgressPercent, 10);
  other.loopPlusProgressPercent = 25;
  assert.equal(buildDepartmentGroupChatProjection(root, port)!.overallProgressPercent, 20);
  other.loopPlusProgressPercent = undefined;
  leader.loopPlusProgressPercent = 25;
  const weightedProjection = buildDepartmentGroupChatProjection(root, port)!;
  assert.equal(weightedProjection.leaders[0].progressPercent, 25);
  assert.equal(weightedProjection.overallProgressPercent, 5);
  root.subTasks[1].progressWeightPercent = undefined;
  assert.equal(buildDepartmentGroupChatProjection(root, port)!.overallProgressPercent, undefined);
  root.subTasks[1].progressWeightPercent = 40;
  assert.deepEqual(buildDepartmentGroupChatProjection(other, {
    ...port, readLeaderTaskIds: (rootId, moduleId) => moduleId === leader.department!.leaderSubtaskId ? [] : port.readLeaderTaskIds(rootId, moduleId),
  })!.leaders.map(({ taskId, leaderNumber }) => [taskId, leaderNumber]), [[other.id, 2]]);
  assert.deepEqual(projection.leaders[0].employees.map((item) => [item.id, item.subtaskId, item.title]), [["attempt-A", "employee-A", "子任务 2：真实员工"]]);
  assert.deepEqual(projection.leaders[1].employees, []);
  assert.equal(projection.activeLeaders, null); assert.equal(projection.activeEmployees, null);
  const capacity = { rootTaskId: root.id, maxLeaders: 4, maxEmployees: 20, leaders: ["lease-A"], employees: ["lease-1", "lease-2"] };
  assert.equal(buildDepartmentGroupChatProjection(root, { ...port, readCapacity: () => capacity })!.activeEmployees, 2);
  assert.equal(buildDepartmentGroupChatProjection(root, { ...port, readCapacity: () => { throw Error("offline"); } })!.activeEmployees, null);
  assert.equal(buildDepartmentGroupChatProjection(root, { ...port, readCapacity: () => ({ ...capacity, rootTaskId: "other" }) })!.activeLeaders, null);
  other.department!.leaderSubtaskId = leader.department!.leaderSubtaskId;
  assert.deepEqual(buildDepartmentGroupChatProjection(root, port)!.leaders, []); // ambiguous ownership fails closed
});

test("department roster projects blocked running attempts and successful attempts that need no acceptance", () => {
  const { root, leader, records } = departmentRecords();
  const port = { readTaskRecord: (id: string) => records.get(id) ?? null, readLeaderTaskIds: (rootId: string, moduleId: string) => fixtureDepartmentLeaderTaskIds(records, rootId, moduleId) };
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
  scheduler.dispatch([
    { subtaskId: "employee-A", attemptId: "attempt-A", requiresAcceptance: false },
    { subtaskId: "employee-B", attemptId: "attempt-B" },
  ]);
  leader.subTasks[0].status = "blocked";
  leader.subTasks.push({ id: "employee-B", title: "等待启动的员工", status: "pending" });
  const statuses = () => {
    leader.loopPlus = scheduler.snapshot();
    return buildDepartmentGroupChatProjection(root, port)!.leaders[0].employees.map((employee) => employee.status);
  };
  assert.deepEqual(statuses(), ["blocked", "pending"]);
  const report = scheduler.finish({ subtaskId: "employee-A", attemptId: "attempt-A", outcome: "completed" });
  assert.ok(report.applied && report.eventId);
  assert.deepEqual(statuses(), ["no_acceptance", "running"]);
  assert.equal(scheduler.acknowledgeReports([report.eventId]), true);
  assert.deepEqual(statuses(), ["no_acceptance", "running"]);
  const review = scheduler.finish({ subtaskId: "employee-B", attemptId: "attempt-B", outcome: "completed" });
  assert.ok(review.applied && review.eventId);
  assert.deepEqual(statuses(), ["no_acceptance", "queued_review"]);
  assert.equal(scheduler.submitReviewBatch([review.eventId], "passed").ok, true);
  assert.deepEqual(statuses(), ["no_acceptance", "acceptance_passed"]);
});

test("director group chat refreshes its overall progress from weighted leader progress", async () => {
  const h = harness();
  h.root.status = "running";
  h.root.schedulingMode = "classic";
  delete h.root.loopPlus;
  h.root.loopProgressPercent = 64;
  h.root.subTasks[0].progressWeightPercent = 20;
  h.root.subTasks[1].progressWeightPercent = 80;
  h.leader.loopPlusProgressPercent = 50;
  try {
    await h.coordinator.open(h.root.id);
    await h.domReady;
    assert.equal(h.panel().getState()?.task.progressPercent, 10);
    assert.match(h.panel().getState()?.rounds[0].participants[0].title ?? "", /10%/u);

    h.leader.loopPlusProgressPercent = 65;
    h.coordinator.refreshOpenPanelForTask(h.leader.id);
    await tick();
    assert.equal(h.panel().getState()?.task.progressPercent, 13);
    assert.match(h.panel().getState()?.rounds[0].participants[0].title ?? "", /13%/u);
    assert.ok(h.posted.some((item) => item.type === "loopGroupChatChat:contentPatch"
      && item.actionsHtml?.includes('aria-valuenow="13"')));

    h.root.status = "completed";
    h.coordinator.refreshOpenPanelForTask(h.root.id);
    await tick();
    assert.equal(h.panel().getState()?.task.progressPercent, 100);
    assert.ok(h.posted.some((item) => item.type === "loopGroupChatChat:contentPatch"
      && item.actionsHtml?.includes('aria-valuenow="100"')));
  } finally { h.restore(); }
});

test("director refresh forwards the same Loop+ task tags as the leader chat", async () => {
  const h = harness();
  h.leader.status = "running";
  let mainBusy = false;
  let reviewEventIds: string[] = [];
  h.deps.isTabRunActive = (tabId) => tabId === h.leader.id && mainBusy;
  h.deps.getActiveReviewEventIds = (taskId) => taskId === h.leader.id ? reviewEventIds : [];
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 1, snapshot: h.leader.loopPlus });
  try {
    await h.coordinator.open(h.root.id);
    await h.domReady;
    const assertSharedTags = async (expected: string) => {
      h.leader.loopPlus = scheduler.snapshot();
      h.coordinator.refreshOpenPanelForTask(h.leader.id);
      await tick();
      const roster = h.posted.filter((item) => item.type === "loopGroupChatChat:contentPatch").at(-1)?.rosterPanelHtml ?? "";
      const groupTags = /aria-label="组长A任务状态汇总">(.*?)<\/div>/u.exec(roster)?.[1];
      const taskPanel = buildLoopGroupChatPanelContentPatch(buildLoopGroupChatPanelState(h.leader, h.deps), 2).taskPanelHtml;
      const leaderTags = /aria-label="任务状态汇总">(.*?)<\/div>/u.exec(taskPanel)?.[1];
      assert.ok(groupTags && groupTags.includes(`>${expected}</span>`), roster);
      assert.equal(groupTags, leaderTags);
      return groupTags;
    };

    mainBusy = true;
    await assertSharedTags("运行中 2");
    mainBusy = false;
    const review = scheduler.finish({ subtaskId: "employee-A", attemptId: "attempt-A", outcome: "completed" });
    assert.ok(review.applied && review.eventId);
    await assertSharedTags("待验收 2");
    reviewEventIds = [review.eventId];
    await assertSharedTags("验收中 1");

    assert.equal(scheduler.submitReviewBatch(reviewEventIds, "failed").ok, true);
    reviewEventIds = [];
    const failed = await assertSharedTags("验收失败 1");
    assert.match(failed, /data-loop-plus-tone="empty" data-loop-plus-count="completed">已完成 0/u);
    scheduler.dispatch([{ subtaskId: "employee-A", attemptId: "attempt-repair" }]);
    const repairing = await assertSharedTags("修复中 1");
    assert.match(repairing, /data-loop-plus-tone="empty" data-loop-plus-count="acceptance_failed">验收失败 0/u);

    h.leader.subTasks[0].status = "blocked";
    const interrupted = await assertSharedTags("修复中 0");
    assert.match(interrupted, /data-loop-plus-tone="empty" data-loop-plus-count="blocked">已阻塞 0/u);

    h.leader.subTasks[0].status = "completed";
    const repairedReview = scheduler.finish({ subtaskId: "employee-A", attemptId: "attempt-repair", outcome: "completed" });
    assert.ok(repairedReview.applied && repairedReview.eventId);
    assert.equal(scheduler.submitReviewBatch([repairedReview.eventId], "failed").ok, true);
    scheduler.dispatch([{ subtaskId: "employee-A", attemptId: "attempt-second-repair" }]);
    await assertSharedTags("修复中 1");
    const leaderRoster = buildLoopGroupChatPanelContentPatch(buildLoopGroupChatPanelState(h.leader, h.deps), 3).rosterPanelHtml;
    assert.match(leaderRoster, /class="member-status-repairing">修复中 x2<\/span>/u);

    const secondReview = scheduler.finish({ subtaskId: "employee-A", attemptId: "attempt-second-repair", outcome: "completed" });
    assert.ok(secondReview.applied && secondReview.eventId);
    reviewEventIds = [secondReview.eventId];
    const reviewing = await assertSharedTags("验收中 1");
    assert.match(reviewing, /data-loop-plus-count="repairing">修复中 0<\/span>/u);
    const reviewingRoster = buildLoopGroupChatPanelContentPatch(buildLoopGroupChatPanelState(h.leader, h.deps), 4).rosterPanelHtml;
    assert.match(reviewingRoster, /class="member-status-reviewing">验收中 x2<\/span>/u);
    assert.equal(scheduler.submitReviewBatch(reviewEventIds, "passed").ok, true);
    reviewEventIds = [];
    const passed = await assertSharedTags("已完成 1");
    assert.match(passed, /data-loop-plus-tone="empty" data-loop-plus-count="acceptance_failed">验收失败 0/u);
  } finally { h.restore(); }
});

test("department host rejects cross-department, bad root, metadata, workspace and classic leader records", async () => {
  const h = harness();
  try {
    await h.coordinator.open(h.root.id);
    await h.domReady;
    const mutations: Array<(task: LoopTaskRecord) => void> = [
      (task) => { task.departmentInvalid = true; }, (task) => { task.department!.rootTaskId = "another-root"; },
      (task) => { task.department!.parentTaskId = "another-root"; }, (task) => { task.department!.leaderSubtaskId = "absent"; },
      (task) => { task.workspaceKey = "other-workspace"; }, (task) => { task.schedulingMode = "classic"; },
      (task) => { task.department!.role = "employee"; },
    ];
    const original = JSON.stringify(h.leader);
    for (const [i, mutate] of mutations.entries()) {
      const record = JSON.parse(original); mutate(record); h.records.set(record.id, record);
      await h.load(record.id, `invalid-${i}`);
      assert.match(h.posted.at(-1)?.error ?? "", /不属于当前产研部或关联无效/);
      await h.send({ taskId: record.id, instanceId: `invalid-${i}` }, { type: "loopGroupChatChat:stopTask" });
    }
    h.records.set(h.leader.id, h.leader); h.root.department!.role = "leader";
    await h.load(); assert.match(h.posted.at(-1)?.error ?? "", /关联无效/);
    assert.equal(h.effects.length, 0);
  } finally { h.restore(); }
});

test("department host loads in-page leader and routes actions, ask thread, preview and refresh without panel alias", async () => {
  const h = harness(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-host-"));
  try {
    h.leader.communicationDir = path.join(temp, h.leader.id); fs.mkdirSync(h.leader.communicationDir);
    h.leader.mainCommunicationFile = path.join(h.leader.communicationDir, "main.md"); fs.writeFileSync(h.leader.mainCommunicationFile, "# 组长内容\n");
    await withTimeout(h.coordinator.open(h.root.id), "loadingReady and DOM-ready handshake"); const target = await h.load();
    assert.equal(h.deps.panelsByTaskId.size, 1); assert.equal(h.deps.panelsByTaskId.has(h.leader.id), false);
    const content = h.posted.find((item) => item.type === "loopGroupChatChat:departmentModalContent" && item.html);
    assert.equal(content.taskId, h.leader.id);
    assert.deepEqual(Object.keys(content).sort(), ["html", "instanceId", "taskId", "title", "type"]);
    assert.doesNotMatch(content.html, /rootTaskId.*panel.*handlers/); assert.match(content.html, /<title>组长A<\/title>/); assert.match(content.html, /根固化快照/);
    assert.doesNotMatch(content.html, /data-action="acceptancePlan"/);
    assert.match(content.html, /id="askChatSend"[^>]*type="button"/);
    assert.equal(h.panel().getState()?.department?.activeEmployees, null);
    const patch = buildLoopGroupChatPanelContentPatch(h.panel().getState()!, 1);
    assert.match(patch.rosterPanelHtml, /员工 未知\/20/);
    assert.doesNotMatch(patch.taskPanelHtml, /统一验收方案（只读）|根固化快照/u);
    assert.doesNotMatch(patch.actionsHtml, /data-action="acceptancePlan"/);
    h.receive({ type: "loopGroupChatChat:departmentTaskMessage", ...target, message: { type: "loopGroupChatChat:domReady", generation: 1 } });
    await h.send(target, { type: "loopGroupChatChat:supplementTask", taskId: h.root.id, prompt: "组长补充" });
    assert.deepEqual(h.leader.supplementalRequirements, ["组长补充"]); assert.equal(h.root.supplementalRequirements, undefined);
    await h.send(target, { type: "loopGroupChatChat:askMainModel", taskId: h.root.id, prompt: "问组长" });
    assert.ok(h.effects.some(([action, id]) => action === "ask" && id === h.leader.id));
    assert.ok(h.posted.some((item) => item.taskId === h.leader.id && item.instanceId === target.instanceId && item.message?.type === "loopGroupChatChat:askThread" && JSON.stringify(item.message).includes("组长回答")));
    await h.send(target, { type: "loopGroupChatChat:openCommunicationFile", requestId: "preview-A", path: h.leader.mainCommunicationFile });
    assert.ok(h.posted.some((item) => item.instanceId === target.instanceId && item.message?.requestId === "preview-A" && item.message.ok));
    await h.send(target, { type: "loopGroupChatChat:openCommunicationFile", requestId: "preview-deny", path: __filename });
    assert.equal(h.posted.at(-1).message.ok, false);
    await h.send(target, { type: "loopGroupChatChat:continueTask", taskId: h.root.id, prompt: "继续组长" });
    assert.ok(h.effects.some(([action, id]) => action === "continue-leader" && id === h.leader.id));
    assert.ok(h.effects.every(([action]) => action !== "continue"));
    h.leader.status = "running"; h.deps.collectRunningTaskIds = () => new Set([h.leader.id]);
    await h.send(target, { type: "loopGroupChatChat:stopTask", taskId: h.root.id });
    assert.ok(h.effects.some(([action, id]) => action === "stop" && id === h.leader.id));
    h.root.loopPlusAcceptancePlan = { ...h.root.loopPlusAcceptancePlan!, name: "新的根固化快照" };
    const count = h.posted.length; h.leader.updatedAt += 10; h.coordinator.refreshOpenPanelForTask(h.leader.id); await tick();
    assert.ok(h.posted.slice(count).some((item) => JSON.stringify(item).includes("新的根固化快照")));
    assert.ok(h.posted.slice(count).some((item) => item.instanceId === target.instanceId && item.message?.type === "loopGroupChatChat:contentPatch"));
    const progressUpdate = h.posted.length;
    h.leader.loopPlusProgressPercent = 25;
    h.coordinator.refreshOpenPanelForTask(h.leader.id); await tick();
    assert.ok(h.posted.slice(progressUpdate).some((item) => item.type === "loopGroupChatChat:contentPatch"
      && item.rosterPanelHtml?.includes('class="department-leader-progress">25%</span>')));
  } finally { h.restore(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test("department host rejects plan overrides, stale instances and operations after close, preserves ordinary Loop+ edits", async () => {
  const h = harness();
  let applies = 0; h.deps.applyLoopPlusAcceptancePlan = () => { applies += 1; return { ok: true }; };
  try {
    await h.coordinator.open(h.root.id); const old = await h.load(); const target = await h.load(h.other.id, "instance-B");
    await h.send(old, { type: "loopGroupChatChat:supplementTask", prompt: "迟到" });
    await h.send(target, { type: "loopGroupChatChat:updateAcceptancePlan", plan: {} });
    h.receive({ type: "loopGroupChatChat:updateAcceptancePlan", plan: {} }); await tick();
    assert.equal(applies, 0);
    h.receive({ type: "loopGroupChatChat:departmentModal", action: "close", ...target }); await tick();
    await h.send(target, { type: "loopGroupChatChat:stopTask" }); assert.equal(h.effects.length, 0);
    assert.equal(h.panel().getDepartmentModalTarget(), undefined);
    delete h.root.department;
    h.receive({ type: "loopGroupChatChat:updateAcceptancePlan", plan: {} }); await tick(); assert.equal(applies, 1);
  } finally { h.restore(); }
});

test("department host isolates late load, model switch and question responses across close/reopen", async () => {
  const h = harness();
  try {
    await h.coordinator.open(h.root.id);
    const gate = deferred(); h.deps.prepareModelSwitchOptions = async (task) => { if (task.id === h.leader.id) await gate.promise; };
    const old = await h.load(); h.receive({ type: "loopGroupChatChat:departmentModal", action: "close", ...old });
    await h.load(h.other.id, "instance-B"); const count = h.posted.length; gate.resolve(); await tick();
    assert.ok(h.posted.slice(count).every((item) => item.taskId !== h.leader.id));
    h.deps.prepareModelSwitchOptions = async () => {};
    const target = await h.load(h.leader.id, "instance-C");
    const models = deferred(); h.deps.prepareModelSwitchOptions = async () => { await models.promise; };
    h.receive({ type: "loopGroupChatChat:departmentTaskMessage", ...target, message: { type: "loopGroupChatChat:switchModels", models: {} } });
    h.receive({ type: "loopGroupChatChat:departmentModal", action: "close", ...target }); models.resolve(); await tick();
    assert.equal(h.effects.length, 0);
    h.deps.prepareModelSwitchOptions = async () => {};
    const questions = deferred(); h.deps.askMainModel = async () => { await questions.promise; return { status: "ready", answer: "过期回答" }; };
    const q = await h.load(h.leader.id, "instance-D");
    h.receive({ type: "loopGroupChatChat:departmentTaskMessage", ...q, message: { type: "loopGroupChatChat:askMainModel", prompt: "旧提问" } }); await tick();
    h.receive({ type: "loopGroupChatChat:departmentModal", action: "close", ...q });
    await h.load(h.leader.id, "instance-E"); const after = h.posted.length; questions.resolve(); await tick();
    assert.ok(h.posted.slice(after).every((item) => !JSON.stringify(item).includes("过期回答")));
    assert.ok(!h.effects.some(([action]) => action === "stop"));
  } finally { h.restore(); }
});

test("closing a bound department modal cancels its queued questions while the Tab keeps its prior invocation", async () => {
  const h = harness();
  const queue = createLoopMainQuestionQueue();
  const blocker = deferred();
  const events: string[] = [];
  let submitted = 0;
  const running = queue.runMain("leader-tab", () => blocker.promise);
  try {
    h.deps.askMainModel = async (_task, question, hooks) => {
      submitted += 1;
      return await queue.runQuestion("leader-tab", { canRun: () => true, isAborted: hooks?.isAborted, signal: hooks?.signal }, async () => {
        hooks?.onStarted?.();
        hooks?.signal?.addEventListener("abort", () => { events.push("abort"); }, { once: true });
        events.push(question);
        return { status: "ready" as const, answer: `${question}的回答` };
      }) ?? { status: "stopped" };
    };
    await h.coordinator.open(h.root.id);
    const old = await h.load();
    await h.send(old, { type: "loopGroupChatChat:askMainModel", prompt: "旧问题一" });
    await h.send(old, { type: "loopGroupChatChat:askMainModel", prompt: "旧问题二" });
    assert.equal(submitted, 2);
    assert.equal(events.length, 0);
    await h.coordinator.handleMessage(h.leader.id, { type: "loopGroupChatChat:abortMainModelQuestion" });
    h.receive({ type: "loopGroupChatChat:departmentModal", action: "close", ...old });
    const current = await h.load(h.leader.id, "instance-reopened");
    const afterReopen = h.posted.length;
    await h.send(old, { type: "loopGroupChatChat:askMainModel", prompt: "过期弹窗的问题" });
    assert.equal(submitted, 2);
    await h.send(current, { type: "loopGroupChatChat:askMainModel", prompt: "新问题" });
    const drain = queue.runMain("leader-tab", async () => { events.push("排空"); });
    blocker.resolve();
    await running;
    await drain;
    await tick();
    assert.deepEqual(events, ["新问题", "排空"]);
    assert.ok(h.posted.slice(afterReopen).some((item) => JSON.stringify(item).includes("新问题的回答")));
    assert.ok(h.posted.slice(afterReopen).every((item) => !/旧问题[一二]的回答/u.test(JSON.stringify(item))));
  } finally {
    blocker.resolve();
    await running;
    h.dispose();
    h.restore();
  }
});

test("department root lifecycle requires injected subtree controls and never falls back to single-task stop/continue", async () => {
  const h = harness();
  try {
    h.root.status = "running";
    await h.coordinator.open(h.root.id);
    await h.coordinator.continueTask(h.root.id);
    h.receive({ type: "loopGroupChatChat:stopTask" }); await tick();
    await assert.rejects(h.coordinator.completeDepartment(h.root.id), /组织控制尚未接入/);
    assert.equal(h.effects.length, 0); assert.ok(h.warnings.some((message) => message.includes("组织控制尚未接入")));
    const called: string[] = [];
    h.deps.departmentOrganizationControl = { continue: async (root) => { called.push(`continue:${root.id}`); }, stop: async (root) => { called.push(`stop:${root.id}`); }, complete: async (root) => { called.push(`complete:${root.id}`); } };
    await h.coordinator.continueTask(h.root.id);
    h.deps.readDepartmentOrganizationControlState = () => ({ needsCleanup: true });
    h.receive({ type: "loopGroupChatChat:stopTask" }); await tick(); await h.coordinator.completeDepartment(h.root.id);
    assert.deepEqual(called, [`continue:${h.root.id}`, `stop:${h.root.id}`, `complete:${h.root.id}`]); assert.equal(h.effects.length, 0);
  } finally { h.restore(); }
});


test("department leader legal model switch stays on bound record and response channel", async () => {
  const h = harness();
  try {
    h.leader.loopSubtaskMode = "fullstack";
    h.deps.getLoopModelSwitchOptions = () => [{ value: "new-model", label: "新模型" }];
    let resume: (() => void) | undefined;
    h.deps.resumeLoopSubtasks = (id, callback) => { resume = callback; h.effects.push(["resume", id]); return true; };
    await h.coordinator.open(h.root.id); const target = await h.load();
    await h.send(target, { type: "loopGroupChatChat:switchModels", taskId: h.root.id, models: { main: "new-model", fullstack: "new-model" } });
    assert.equal(h.leader.modelRouting?.main.model, "new-model"); assert.equal(h.root.modelRouting, undefined);
    assert.ok(h.effects.some(([action, id]) => action === "resume" && id === h.leader.id));
    assert.ok(h.posted.some((item) => item.instanceId === target.instanceId && item.message?.type === "loopGroupChatChat:switchModelsSettled" && item.message.ok));
    h.receive({ type: "loopGroupChatChat:departmentModal", action: "close", ...target });
    await h.load(h.other.id, "after-model-switch");
    const count = h.effects.length; resume?.(); await tick(); assert.equal(h.effects.length, count);
  } finally { h.restore(); }
});

test("department continuation waiting on runtime cannot launch after binding revocation", async () => {
  const h = harness();
  try {
    h.leader.originProfile = { configId: "original" }; h.leader.modelRouting = { main: { model: "main" }, subtask: { model: "sub" } };
    const gate = deferred();
    h.deps.continueDepartmentLeader = async (task, _prompt, assertCurrent) => {
      await gate.promise;
      assertCurrent();
      h.effects.push(["continue-leader", task.id]);
    };
    await h.coordinator.open(h.root.id); const target = await h.load();
    h.receive({ type: "loopGroupChatChat:departmentTaskMessage", ...target, message: { type: "loopGroupChatChat:continueTask" } }); await tick();
    h.receive({ type: "loopGroupChatChat:departmentModal", ...target, action: "close" });
    await h.load(h.other.id, "next-instance"); const count = h.posted.length; gate.resolve(); await tick();
    assert.equal(h.effects.length, 0);
    assert.ok(h.posted.slice(count).every((item) => item.instanceId !== target.instanceId));
  } finally { h.restore(); }
});

test("department projection refuses missing or invalid employee execution snapshot instead of guessing from subtask count", () => {
  const { root, leader, records } = departmentRecords();
  const port = { readTaskRecord: (id: string) => records.get(id) ?? null, readLeaderTaskIds: (rootId: string, moduleId: string) => fixtureDepartmentLeaderTaskIds(records, rootId, moduleId) };
  leader.loopPlus = { version: "broken" };
  assert.deepEqual(buildDepartmentGroupChatProjection(root, port)!.leaders[0].employees, []);
  leader.departmentInvalid = true;
  assert.equal(buildDepartmentGroupChatProjection(leader, port), undefined);
});

test("department resources preserve target, reject escaped roots and cancel late local-link actions", async () => {
  const h = harness(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-resource-"));
  const previousFs = vscode.workspace.fs, previousCommand = vscode.commands.executeCommand;
  try {
    h.leader.communicationDir = path.join(temp, h.leader.id); fs.mkdirSync(h.leader.communicationDir);
    h.leader.mainCommunicationFile = path.join(h.leader.communicationDir, "main.md");
    const image = path.join(h.leader.communicationDir, "图.png");
    fs.writeFileSync(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64"));
    const outside = path.join(temp, "outside.png"); fs.copyFileSync(image, outside);
    const escape = path.join(h.leader.communicationDir, "escape.png"); fs.symlinkSync(outside, escape);
    await h.coordinator.open(h.root.id); const target = await h.load();
    await h.send(target, { type: "resolveChatImage", source: image });
    for (let i = 0; i < 100 && !h.posted.some((item) => item.message?.resolvedSource); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    const resolved = h.posted.find((item) => item.message?.resolvedSource);
    assert.equal(resolved?.taskId, target.taskId); assert.equal(resolved?.instanceId, target.instanceId);
    assert.match(resolved?.message.resolvedSource ?? "", /^data:image\/png;base64,/);
    await h.send(target, { type: "resolveChatImage", source: escape }); assert.match(h.posted.at(-1).message.error, /许可目录/);
    fs.writeFileSync(h.leader.mainCommunicationFile, "# 当前组长\n");
    const gate = deferred(), entered = deferred();
    (vscode.workspace as any).fs = { ...previousFs, stat: async () => { entered.resolve(); await gate.promise; return { type: 1, size: 1, ctime: 1, mtime: 1 }; } };
    const commands: unknown[] = [];
    (vscode.commands as any).executeCommand = async (...args: unknown[]) => { commands.push(args); };
    h.receive({ type: "loopGroupChatChat:departmentTaskMessage", ...target, message: { type: "openChatLink", source: h.leader.mainCommunicationFile } });
    await entered.promise;
    h.receive({ type: "loopGroupChatChat:departmentModal", action: "close", ...target });
    await h.load(h.other.id, "resource-next"); gate.resolve(); await tick();
    assert.equal(commands.length, 0);
  } finally { h.restore(); (vscode.workspace as any).fs = previousFs; vscode.commands.executeCommand = previousCommand; fs.rmSync(temp, { recursive: true, force: true }); }
});

function clarification(id = "round20-clarification"): NonNullable<LoopTaskRecord["pendingClarification"]> {
  return { interactionId: id, title: "补充范围", instruction: "", submitLabel: "提交", cancelLabel: "拒绝",
    formFields: [{ id: "scope", type: "text", label: "范围", required: true }] };
}

const submitAnswer = (h: ReturnType<typeof harness>) => h.receive({ type: "loopGroupChatChat:submitClarification",
  interactionId: h.root.pendingClarification!.interactionId, values: { scope: "已确认范围" } });

test("department clarification without waiter persists then resumes fresh root through organization control only", async () => {
  const h = harness(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-answer-"));
  try {
    h.root.communicationDir = temp;
    h.root.status = "running";
    await h.coordinator.open(h.root.id);
    let targetCreations = 0;
    h.deps.resolveMainPromptTarget = (_task, options) => { if (options?.createIfMissing) targetCreations += 1; return null; };
    h.root.pendingClarification = clarification(); submitAnswer(h); await tick();
    assert.equal(h.root.pendingClarification, undefined);
    assert.match(h.root.supplementalRequirements?.[0] ?? "", /已确认范围/);
    assert.ok(h.warnings.some((message) => /组织控制尚未接入.*澄清已保存/.test(message)));
    assert.equal(targetCreations, 0); assert.ok(!h.effects.some(([kind]) => kind === "continue"));

    h.root.pendingClarification = clarification("second");
    const update = h.deps.updateTaskRecord;
    h.deps.updateTaskRecord = (id, patch) => {
      const saved = update(id, patch)!;
      const replacement = { ...saved, updatedAt: saved.updatedAt + 100 };
      h.records.set(id, replacement); return replacement;
    };
    let resumed: LoopTaskRecord | undefined;
    h.deps.departmentOrganizationControl = { continue: async (root) => { resumed = root; }, stop: async () => {}, complete: async () => {} };
    submitAnswer(h); await tick();
    assert.equal(resumed, h.records.get(h.root.id)); assert.notEqual(resumed, h.root);
    assert.equal(resumed?.pendingClarification, undefined);
    assert.match(resumed?.supplementalRequirements?.at(-1) ?? "", /已确认范围/);
    assert.equal(targetCreations, 0); assert.ok(!h.effects.some(([kind]) => kind === "continue"));
  } finally { h.restore(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test("department clarification preserves active waiter and rejection without launching a task", async () => {
  const h = harness();
  const scope = loopClarificationScope(h.root.id);
  try {
    h.root.status = "running";
    h.deps.readDepartmentOrganizationControlState = () => ({ needsCleanup: true }); // Active members can own leases.
    await h.coordinator.open(h.root.id);
    h.root.pendingClarification = clarification();
    const answer = waitForOrchestratorClarification(scope, h.root.pendingClarification);
    submitAnswer(h); await tick(); assert.equal((await withTimeout(answer, "healthy clarification")).status, "completed");
    assert.equal(h.effects.length, 0);
    h.root.pendingClarification = clarification("reject-active");
    const rejected = waitForOrchestratorClarification(scope, h.root.pendingClarification);
    h.receive({ type: "loopGroupChatChat:rejectClarification", interactionId: "reject-active" }); await tick();
    assert.equal((await rejected).status, "aborted"); assert.equal(h.effects.length, 0);
    h.root.pendingClarification = clarification("reject-saved");
    h.receive({ type: "loopGroupChatChat:rejectClarification", interactionId: "reject-saved" }); await tick();
    assert.equal(h.root.status, "needs-review"); assert.equal(h.root.pendingClarification, undefined);
    assert.deepEqual(h.effects.map(([kind]) => kind), ["write"]);
    for (const invalid of [() => { h.root.departmentInvalid = true; }, () => { delete h.root.departmentInvalid; h.root.department!.parentTaskId = "wrong"; }]) {
      invalid(); h.root.pendingClarification = clarification("invalid");
      const count: number = h.effects.length;
      submitAnswer(h); h.receive({ type: "loopGroupChatChat:rejectClarification", interactionId: "invalid" }); await tick();
      await h.coordinator.continueTask(h.root.id);
      assert.equal(h.effects.length, count); assert.ok(h.root.pendingClarification);
    }
  } finally { abortOrchestratorClarification(scope); h.restore(); }
});

test("department clarification refuses lost or changed root after saving instead of single-task fallback", async () => {
  for (const mutate of [(task: LoopTaskRecord) => { task.departmentInvalid = true; },
    (task: LoopTaskRecord) => { delete task.department; },
    (task: LoopTaskRecord) => { task.department!.rootTaskId = "different-root"; }]) {
    const h = harness(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-changed-"));
    try {
      h.root.communicationDir = temp; await h.coordinator.open(h.root.id);
      h.root.pendingClarification = clarification();
      const update = h.deps.updateTaskRecord;
      h.deps.updateTaskRecord = (id, patch) => { const saved = update(id, patch)!; const next = structuredClone(saved); mutate(next); h.records.set(id, next); return next; };
      let resumes = 0; h.deps.departmentOrganizationControl = { continue: async () => { resumes += 1; }, stop: async () => {}, complete: async () => {} };
      submitAnswer(h); await tick();
      assert.equal(resumes, 0); assert.ok(!h.effects.some(([kind]) => kind === "continue"));
      assert.ok(h.warnings.some((message) => /部门任务关联无效/.test(message)));
    } finally { h.restore(); fs.rmSync(temp, { recursive: true, force: true }); }
  }
});

test("ordinary Loop+ clarification without waiter retains the single-task continuation", async () => {
  const h = harness(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "ordinary-answer-"));
  try {
    delete h.root.department; h.root.communicationDir = temp;
    await h.coordinator.open(h.root.id); h.root.pendingClarification = clarification();
    submitAnswer(h); await tick();
    assert.equal(h.root.pendingClarification, undefined);
    assert.ok(h.effects.some(([kind, id]) => kind === "continue" && id === h.root.id));
  } finally { h.restore(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test("department authorization hot path uses fresh ownership without task-store scans for repeated responses", async () => {
  const h = harness(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-count-"));
  try {
    h.leader.communicationDir = path.join(temp, h.leader.id); fs.mkdirSync(h.leader.communicationDir);
    h.leader.mainCommunicationFile = path.join(h.leader.communicationDir, "main.md"); fs.writeFileSync(h.leader.mainCommunicationFile, "# 内容");
    await h.coordinator.open(h.root.id); const target = await h.load();
    let scans = 0, queries = 0;
    h.deps.readTaskStoreTasks = () => { scans += 1; return [...h.records.values()]; };
    const ownership = h.deps.readDepartmentLeaderTaskIds!;
    h.deps.readDepartmentLeaderTaskIds = (...args) => { queries += 1; return ownership(...args); };
    for (let i = 0; i < 12; i++) await h.send(target, { type: "loopGroupChatChat:openCommunicationFile", requestId: `hot-${i}`, path: h.leader.mainCommunicationFile });
    assert.equal(h.posted.filter((message) => message.message?.requestId?.startsWith("hot-") && message.message.ok).length, 12);
    assert.equal(scans, 0); assert.ok(queries >= 12);
    const gate = deferred(); let hooks!: Parameters<NonNullable<Deps["askMainModel"]>>[2];
    h.deps.askMainModel = async (_task, _question, currentHooks) => { hooks = currentHooks; await gate.promise; return { status: "ready", answer: "当前回答" }; };
    h.receive({ type: "loopGroupChatChat:departmentTaskMessage", ...target, message: { type: "loopGroupChatChat:askMainModel", prompt: "计数检查" } }); await tick();
    for (let i = 0; i < 20; i++) { assert.equal(hooks?.isAborted?.(), false); hooks?.onStarted?.(); }
    assert.equal(scans, 0); gate.resolve(); await tick();
    assert.equal(scans, 0); // Display refresh also uses the indexed root/module query.
    assert.ok(h.posted.some((message) => JSON.stringify(message).includes("当前回答")));
  } finally { h.restore(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test("department ownership port unavailable, duplicate modules and changed ownership revoke current actions and pending effects", async (t) => {
  const mutations: Array<[string, (h: ReturnType<typeof harness>) => void]> = [
    ["missing ownership port", (h) => { h.deps.readDepartmentLeaderTaskIds = undefined; }],
    ["unavailable ownership index", (h) => { h.deps.readDepartmentLeaderTaskIds = () => null; }],
    ["throwing ownership index", (h) => { h.deps.readDepartmentLeaderTaskIds = () => { throw Error("invalid index"); }; }],
    ["duplicate module", (h) => { h.other.department!.leaderSubtaskId = h.leader.department!.leaderSubtaskId; }],
    ["workspace changed", (h) => { h.leader.workspaceKey = "moved-workspace"; }],
    ["parent changed", (h) => { h.leader.department!.parentTaskId = "moved-root"; }],
    ["root invalidated", (h) => { h.root.departmentInvalid = true; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const h = harness(), gate = deferred(), restoreEntered = deferred();
    let pendingContinue: Promise<void> | undefined;
    try {
      h.leader.originProfile = { configId: "original" }; h.leader.modelRouting = { main: { model: "main" }, subtask: { model: "sub" } };
      h.deps.continueDepartmentLeader = async (task, _prompt, assertCurrent) => {
        restoreEntered.resolve();
        await gate.promise;
        assertCurrent();
        h.effects.push(["continue-leader", task.id]);
      };
      h.deps.notifyLoopPlusUserMessage = (id) => { h.effects.push(["notify", id]); };
      h.deps.resumeLoopSubtasks = (id) => { h.effects.push(["resume", id]); return false; };
      h.deps.recordPromptHistory = () => { h.effects.push(["history", h.leader.id]); };
      await withTimeout(h.coordinator.open(h.root.id), `${name}: loadingReady`);
      await withTimeout(h.domReady, `${name}: director DOM-ready`);
      const target = await h.load();
      const initialContent = h.posted.find((post) => post.type === "loopGroupChatChat:departmentModalContent" && post.html);
      assert.equal(initialContent?.taskId, target.taskId);
      assert.equal(initialContent?.instanceId, target.instanceId);
      const generation = Number(/const PANEL_GENERATION = (\d+)/.exec(initialContent.html)?.[1]);
      assert.ok(generation > 0);
      await h.send(target, { type: "loopGroupChatChat:domReady", generation });
      assert.deepEqual([...h.deps.panelsByTaskId.keys()], [h.root.id], "modal-only subscriber must not alias director as leader panel");
      assert.ok(h.posted.some((post) => post.taskId === target.taskId && post.instanceId === target.instanceId
        && post.message?.type === "loopGroupChatChat:contentPatch" && post.message.generation === generation));

      // Await the real dispatcher's entire operation, including its finally/settlement path.
      pendingContinue = h.coordinator.handleMessage(h.root.id, {
        type: "loopGroupChatChat:departmentTaskMessage", ...target, message: { type: "loopGroupChatChat:continueTask" },
      });
      await withTimeout(restoreEntered.promise, `${name}: entered original-runtime restore`);
      const effects = structuredClone(h.effects), posts = h.posted.length;
      const requirements = h.leader.supplementalRequirements;
      mutate(h);
      await h.coordinator.handleMessage(h.root.id, { type: "loopGroupChatChat:departmentTaskMessage", ...target,
        message: { type: "loopGroupChatChat:supplementTask", prompt: "应拒绝" } });
      assert.deepEqual(h.effects, effects, "revoked supplement must not persist, notify or record history");
      assert.deepEqual(h.posted.slice(posts), [], "revoked supplement must not publish a business reply");

      const invalidation = { type: "loopGroupChatChat:departmentModalContent", ...target,
        error: "组长群聊关联已失效，请关闭后重试。" };
      // Settle while the binding still exists: after-await authorization must reread the
      // changed source, rather than relying only on a refresh having deleted the binding.
      gate.resolve();
      await withTimeout(pendingContinue, `${name}: revoked continue fully settled`);
      const settlementPosts = h.posted.slice(posts);
      assert.ok(settlementPosts.length <= 1, "only this binding's invalidation notice may accompany revoked settlement");
      for (const post of settlementPosts) assert.deepEqual(post, invalidation,
        "no settled/content/ask/preview reply for any task, instance, generation or request is permitted");
      assert.deepEqual(h.effects, effects, "late restore must not persist, supplement, notify, resume, continue or stop");

      // A store-driven refresh is allowed to report this exact binding's invalidation.
      await withTimeout(h.coordinator.refresh(h.leader.id), `${name}: revoked subscriber refresh`);
      assert.deepEqual(h.posted.slice(posts), [invalidation]);
      const rootPosts = h.posted.length;
      const previousRootGeneration = h.posted.filter((post) => post.type === "loopGroupChatChat:contentPatch").at(-1)?.generation ?? 1;
      await withTimeout(h.coordinator.refresh(h.root.id), `${name}: director projection refresh`);
      assert.equal(h.panel().getState()?.task.id, h.root.id);
      // Root projections are distinct from any iframe response: exact current state and generation,
      // with no task/instance envelope, request ID, settlement, or previous leader content.
      assert.deepEqual(h.posted.slice(rootPosts), [buildLoopGroupChatPanelContentPatch(h.panel().getState()!, previousRootGeneration + 1)]);
      const allowedPosts = structuredClone(h.posted.slice(posts));
      assert.equal(h.leader.supplementalRequirements, requirements);
      // A released binding stays revoked even if the source later reports its old membership again.
      const original = departmentRecords();
      h.records.clear(); for (const [id, record] of original.records) h.records.set(id, record);
      h.deps.readDepartmentLeaderTaskIds = (rootId, moduleId) => fixtureDepartmentLeaderTaskIds(h.records, rootId, moduleId);
      await h.coordinator.handleMessage(h.root.id, { type: "loopGroupChatChat:departmentTaskMessage", ...target,
        message: { type: "loopGroupChatChat:supplementTask", prompt: "旧实例仍应拒绝" } });
      assert.deepEqual(h.effects, effects);
      assert.deepEqual(h.posted.slice(posts), allowedPosts);
    } finally {
      // Release before disposal so assertions/timeouts cannot strand this test's continuation.
      gate.resolve();
      h.dispose();
      try { if (pendingContinue) await withTimeout(pendingContinue, `${name}: cleanup settlement`); }
      finally { h.restore(); }
    }
  });
  const h = harness();
  try {
    h.deps.readDepartmentLeaderTaskIds = undefined;
    await withTimeout(h.coordinator.open(h.root.id), "missing index: loadingReady");
    await withTimeout(h.domReady, "missing index: DOM-ready");
    await h.load();
    // No index means no department projection/container; forged loads cannot inject any contents.
    const state = buildLoopGroupChatPanelState(h.root, h.deps);
    assert.equal(state.department, undefined); assert.equal(state.acceptancePlanReadOnly, true);
    assert.equal(h.panel().getDepartmentModalTarget(), undefined); assert.ok(!h.posted.some((item) => item.html));
  } finally { h.dispose(); h.restore(); }
});

test("department images reuse one preview per binding and dispose on close, switch and panel disposal", async () => {
  const h = harness();
  try {
    await h.coordinator.open(h.root.id); const target = await h.load();
    const previews: Array<{ webview: { html: string }; disposed: number; reveals: number }> = [];
    (vscode.window as any).createWebviewPanel = () => {
      const state = { webview: { html: "" }, disposed: 0, reveals: 0 }; let onDispose = () => {};
      previews.push(state);
      return { webview: state.webview, onDidDispose: (callback: () => void) => { onDispose = callback; },
        reveal: () => { state.reveals += 1; }, dispose: () => { state.disposed += 1; onDispose(); } };
    };
    const source = "data:image/png;base64,iVBORw0KGgo=";
    await h.send(target, { type: "previewChatImage", source, alt: "第一张" });
    await h.send(target, { type: "previewChatImage", source, alt: "第二张" });
    assert.equal(previews.length, 1); assert.equal(previews[0].reveals, 2); assert.match(previews[0].webview.html, /第二张/);
    const second = await h.load(h.other.id, "image-B"); assert.equal(previews[0].disposed, 1);
    await h.send(second, { type: "previewChatImage", source }); assert.equal(previews.length, 2);
    await h.send(target, { type: "previewChatImage", source }); assert.equal(previews.length, 2);
    h.receive({ type: "loopGroupChatChat:departmentModal", action: "close", ...second }); await tick(); assert.equal(previews[1].disposed, 1);
    const third = await h.load(h.leader.id, "image-C"); await h.send(third, { type: "previewChatImage", source });
    h.dispose(); assert.equal(previews[2].disposed, 1); assert.ok(!h.effects.some(([kind]) => kind === "stop"));
  } finally { h.restore(); }
});

test("department image late reads and save dialogs cannot affect a closed or replaced binding", { timeout: 5000 }, async () => {
  const h = harness(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-image-late-"));
  const resource = require("../../webview/chatImageResource") as typeof import("../../webview/chatImageResource");
  const loadResource = resource.loadChatImageResource;
  const previousSave = vscode.window.showSaveDialog, previousFs = vscode.workspace.fs;
  try {
    h.leader.communicationDir = path.join(temp, h.leader.id); fs.mkdirSync(h.leader.communicationDir);
    const file = path.join(h.leader.communicationDir, "image.png"); fs.writeFileSync(file, "fixture");
    await h.coordinator.open(h.root.id); const target = await h.load();
    let previewCreates = 0, saves = 0;
    (vscode.window as any).createWebviewPanel = () => { previewCreates += 1; throw Error("obsolete preview"); };
    const image = { bytes: Buffer.from([137, 80, 78, 71]), mime: "image/png", filename: "image.png", source: "data:image/png;base64,iVBORw0KGgo=" };
    const gate = deferred(), entered = deferred();
    resource.loadChatImageResource = async () => { entered.resolve(); await gate.promise; return image; };
    h.receive({ type: "loopGroupChatChat:departmentTaskMessage", ...target, message: { type: "previewChatImage", source: file } }); await entered.promise;
    h.receive({ type: "loopGroupChatChat:departmentModal", ...target, action: "close" });
    await h.load(h.leader.id, "image-new"); const posts = h.posted.length;
    gate.resolve(); await tick(); assert.equal(previewCreates, 0); assert.equal(h.posted.length, posts);
    const next = await h.load(h.leader.id, "save-old");
    resource.loadChatImageResource = async () => image;
    const save = deferred(), saveEntered = deferred();
    (vscode.window as any).showSaveDialog = async () => { saveEntered.resolve(); await save.promise; return vscode.Uri.file(path.join(temp, "saved.png")); };
    (vscode.workspace as any).fs = { ...previousFs, writeFile: async () => { saves += 1; } };
    h.receive({ type: "loopGroupChatChat:departmentTaskMessage", ...next, message: { type: "downloadChatImage", source: file } }); await saveEntered.promise;
    await h.load(h.other.id, "save-next"); save.resolve(); await tick();
    assert.equal(saves, 0); assert.ok(!h.effects.some(([kind]) => kind === "stop"));
  } finally {
    resource.loadChatImageResource = loadResource; vscode.window.showSaveDialog = previousSave;
    (vscode.workspace as any).fs = previousFs; h.restore(); fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("department clarification save failure cannot resume organization", async () => {
  const h = harness();
  try {
    await h.coordinator.open(h.root.id); h.root.pendingClarification = clarification();
    h.deps.updateTaskRecord = () => null;
    let resumes = 0;
    h.deps.departmentOrganizationControl = { continue: async () => { resumes += 1; }, stop: async () => {}, complete: async () => {} };
    submitAnswer(h); await tick();
    assert.equal(resumes, 0); assert.equal(h.effects.length, 0); assert.ok(h.root.pendingClarification);
    assert.ok(h.warnings.some((message) => /部门澄清保存失败/.test(message)));
  } finally { h.restore(); }
});

test("delayed ordinary continuation cannot fall back to a single task after becoming a department director or invalid record", async () => {
  for (const invalid of [false, true]) {
    const h = harness();
    try {
      const department = h.root.department; delete h.root.department;
      await h.coordinator.open(h.root.id);
      const gate = deferred(), entered = deferred();
      h.deps.switchVisibleConversationTabForLoop = async () => { entered.resolve(); await gate.promise; };
      const run = h.coordinator.continueTask(h.root.id); await entered.promise;
      h.root.department = department; h.root.departmentInvalid = invalid;
      gate.resolve(); await run;
      assert.ok(!h.effects.some(([kind]) => kind === "continue"));
      assert.ok(h.warnings.some((message) => /拒绝单任务恢复/.test(message)));
    } finally { h.restore(); }
  }
});

test("ordinary image host keeps preview reuse and invalidate semantics with optional disposal", async () => {
  const previous = vscode.window.createWebviewPanel;
  const { ChatImageHost } = require("../../webview/chatImageHost") as typeof import("../../webview/chatImageHost");
  let creates = 0, disposes = 0;
  (vscode.window as any).createWebviewPanel = () => { creates += 1; return {
    webview: { html: "" }, reveal() {}, onDidDispose() {}, dispose() { disposes += 1; },
  }; };
  try {
    const host = new ChatImageHost(() => undefined);
    const message = { type: "previewChatImage" as const, source: "data:image/png;base64,iVBORw0KGgo=" };
    await host.handleMessage(message); host.invalidate(); await host.handleMessage(message);
    assert.equal(creates, 1); assert.equal(disposes, 0); host.dispose(); assert.equal(disposes, 1);
  } finally { vscode.window.createWebviewPanel = previous; }
});

function allocationFixture(h: ReturnType<typeof harness>) {
  return { rootTaskId: h.root.id, revision: 3, defaultLimit: 5,
    leaders: [h.leader, h.other].map((leader) => ({ leaderTaskId: leader.id, source: "default" as "default" | "manual",
      desiredLimit: 5, appliedLimit: null as number | null, activeEmployees: null as number | null, pending: false })) };
}

const limitRequest = (leaderTaskId: string, patch = {}) => ({ type: "loopGroupChatChat:updateDepartmentEmployeeLimit",
  requestId: "allocation-request-1", leaderTaskId, employeeLimit: 0, expectedRevision: 3, ...patch });

function allocationReceipts(messages: readonly any[], rootTaskId: string, request: ReturnType<typeof limitRequest>) {
  return messages.filter((message) => message.type === "loopGroupChatChat:departmentEmployeeLimitSettled"
    && message.rootTaskId === rootTaskId && message.leaderTaskId === request.leaderTaskId
    && message.requestId === request.requestId);
}

test("allocation projection copies validated host DTO, preserves null/zero and fails unknown closed", () => {
  const h = harness();
  try {
    const data = allocationFixture(h);
    h.deps.readDepartmentEmployeeAllocation = () => data;
    let state = buildLoopGroupChatPanelState(h.root, h.deps);
    assert.equal(state.department?.employeeAllocation?.defaultLimit, 5);
    assert.equal(state.department?.employeeAllocationEditable, false, "a reader is not a write capability");
    data.leaders[0] = { ...data.leaders[0], source: "manual", desiredLimit: 0, appliedLimit: null, pending: true };
    h.deps.updateDepartmentEmployeeLimit = async () => ({ ok: true, allocation: data });
    state = buildLoopGroupChatPanelState(h.root, h.deps);
    assert.equal(state.department?.employeeAllocationEditable, true);
    assert.equal(state.department?.employeeAllocation?.leaders[0].desiredLimit, 0);
    assert.equal(state.department?.employeeAllocation?.leaders[0].appliedLimit, null);
    assert.notEqual(state.department?.employeeAllocation, data);
    assert.equal(buildLoopGroupChatPanelState(h.leader, h.deps).department?.employeeAllocationEditable, false);
    const broken: any[] = [null, { ...data, rootTaskId: "other" }, { ...data, revision: "3" }, { ...data, defaultLimit: 21 },
      { ...data, leaders: [data.leaders[0], data.leaders[0]] }, { ...data, leaders: [{ ...data.leaders[0], desiredLimit: -1 }] },
      { ...data, leaders: [{ ...data.leaders[0], activeEmployees: -1 }] }, { ...data, leaders: [{ ...data.leaders[0], source: "default", desiredLimit: 0 }] },
      { ...data, leaders: [{ ...data.leaders[0], leaderTaskId: "unknown" }] }];
    for (const value of broken) {
      h.deps.readDepartmentEmployeeAllocation = () => value;
      const department = buildLoopGroupChatPanelState(h.root, h.deps).department!;
      assert.equal(department.employeeAllocation, undefined); assert.equal(department.employeeAllocationEditable, false);
    }
    h.deps.readDepartmentEmployeeAllocation = () => { throw Error("offline"); };
    assert.equal(buildLoopGroupChatPanelState(h.root, h.deps).department?.employeeAllocation, undefined);
  } finally { h.restore(); }
});

test("director allocation writer receives exact CAS payload; zero/reset, pending, duplicate and failure have no task effects", async () => {
  const h = harness();
  let data = allocationFixture(h), writes = 0;
  const gate = deferred();
  try {
    h.deps.readDepartmentEmployeeAllocation = () => data;
    h.deps.updateDepartmentEmployeeLimit = async (root, request) => {
      writes += 1; assert.equal(root.id, h.root.id);
      assert.deepEqual(Object.keys(request).sort(), ["employeeLimit", "expectedRevision", "leaderTaskId", "requestId"]);
      await gate.promise;
      data = { ...data, revision: data.revision + 1, leaders: data.leaders.map((row) => row.leaderTaskId === request.leaderTaskId
        ? { ...row, source: request.employeeLimit === null ? "default" : "manual", desiredLimit: request.employeeLimit ?? data.defaultLimit, pending: true } : row) };
      return { ok: true, allocation: data };
    };
    await h.coordinator.open(h.root.id);
    const request = limitRequest(h.leader.id, { rootTaskId: "browser-lie" });
    h.receive(request); h.receive(request); await tick(); assert.equal(writes, 1);
    gate.resolve(); await tick();
    const receipt = h.posted.filter((row) => row.type === "loopGroupChatChat:departmentEmployeeLimitSettled").at(-1);
    assert.equal(receipt.ok, true); assert.equal(receipt.desiredLimit, 0); assert.equal(receipt.revision, 4);
    assert.equal(h.panel().getState()?.department?.employeeAllocation?.leaders[0].appliedLimit, null);
    h.receive(request); await tick(); assert.equal(writes, 1, "stale CAS cannot replay a write");
    h.receive(limitRequest(h.leader.id, { requestId: "reset", expectedRevision: 4, employeeLimit: null })); await tick();
    assert.equal(writes, 2); assert.equal(data.leaders[0].source, "default"); assert.equal(data.leaders[0].desiredLimit, 5);
    h.deps.updateDepartmentEmployeeLimit = async () => { throw Error("持久保存失败"); };
    h.receive(limitRequest(h.leader.id, { requestId: "fail", expectedRevision: 5 })); await tick();
    assert.match(h.posted.at(-1).error, /持久保存失败/);
    assert.deepEqual(h.effects, [], "no task creation, run, stop, supplement or task-store writes");
  } finally { gate.resolve(); h.restore(); }
});

test("allocation message rejects invalid payloads, absent ports, stale records and cross-root/role/ambiguous membership", async () => {
  const h = harness(); let writes = 0;
  try {
    let requestNumber = 0;
    const rejects = async (patch: object, error: RegExp, rootTaskId = h.root.id) => {
      const request = limitRequest(h.leader.id, { ...patch, requestId: `reject-${++requestNumber}` });
      const count = h.posted.length;
      h.receive(request); await tick();
      const receipts = allocationReceipts(h.posted.slice(count), rootTaskId, request);
      assert.equal(receipts.length, 1, "exactly one rejection for this root/leader/request, independently of panel patches");
      assert.equal(receipts[0].ok, false); assert.match(receipts[0].error, error);
      assert.equal(writes, 0, "rejected input must never reach the allocation writer");
    };
    const data = allocationFixture(h);
    h.deps.readDepartmentEmployeeAllocation = () => data;
    await h.coordinator.open(h.root.id);
    await rejects({}, /不可用/);
    h.deps.updateDepartmentEmployeeLimit = async () => { writes += 1; return { ok: true, allocation: data }; };
    for (const employeeLimit of [-1, 21, 1.5, "5", undefined, NaN, Infinity, true]) {
      await rejects({ employeeLimit }, /无效/);
    }
    for (const expectedRevision of [-1, 2, "3", Number.MAX_SAFE_INTEGER]) {
      await rejects({ expectedRevision }, /无效/);
    }
    const original = structuredClone(h.leader);
    for (const mutate of [
      (t: LoopTaskRecord) => { t.department!.rootTaskId = "other-root"; },
      (t: LoopTaskRecord) => { t.workspaceKey = "other-workspace"; },
      (t: LoopTaskRecord) => { t.departmentInvalid = true; },
      (t: LoopTaskRecord) => { t.department!.role = "employee"; },
    ]) {
      const record = structuredClone(original); mutate(record); h.records.set(record.id, record);
      await rejects({}, /仅当前/);
    }
    h.records.set(original.id, original);
    h.deps.readDepartmentLeaderTaskIds = () => [h.leader.id, "duplicate"];
    await rejects({}, /仅当前/);
    h.deps.readDepartmentLeaderTaskIds = (rootId, moduleId) => fixtureDepartmentLeaderTaskIds(h.records, rootId, moduleId);
    const target = await h.load(); const count = h.posted.length;
    const childRequest = limitRequest(h.leader.id, { requestId: "iframe-denied" });
    await h.send(target, childRequest);
    assert.equal(allocationReceipts(h.posted.slice(count), h.root.id, childRequest).length, 0, "iframe has no allocation write capability");
    assert.equal(writes, 0);
    await h.coordinator.open(h.leader.id);
    await rejects({ leaderTaskId: h.other.id }, /仅当前/, h.leader.id);
    assert.equal(writes, 0); assert.deepEqual(h.effects, []);
  } finally { h.restore(); }
});

test("allocation async receipt is discarded after membership, workspace or panel binding changes", async () => {
  for (const change of ["member", "workspace", "binding", "dispose"]) {
    const h = harness(); const gate = deferred();
    try {
      let writes = 0;
      const data = allocationFixture(h);
      h.deps.readDepartmentEmployeeAllocation = () => data;
      h.deps.updateDepartmentEmployeeLimit = async () => { writes++; await gate.promise; return { ok: true, allocation: { ...data, revision: 4,
        leaders: data.leaders.map((row, index) => index ? row : { ...row, source: "manual", desiredLimit: 0, pending: true }) } }; };
      const request = limitRequest(h.leader.id, { requestId: `late-${change}` });
      await h.coordinator.open(h.root.id); h.receive(request); await tick();
      assert.equal(writes, 1, `${change}: original request reached the writer`);
      assert.equal(allocationReceipts(h.posted, h.root.id, request).length, 0, "no receipt before durable confirmation");
      if (change === "member") h.records.delete(h.leader.id);
      if (change === "workspace") { h.root.workspaceKey = "new"; h.leader.workspaceKey = "new"; }
      if (change === "binding") h.panel().update({ ...h.panel().getState()!, task: { ...h.panel().getState()!.task, id: "other-root" } });
      if (change === "dispose") h.dispose();
      const count = h.posted.length;
      gate.resolve(); await tick();
      assert.equal(allocationReceipts(h.posted.slice(count), h.root.id, request).length, 0, `${change}: no late allocation receipt`);
      assert.equal(allocationReceipts(h.posted, h.root.id, request).length, 0, `${change}: never acknowledged the obsolete request`);
      assert.equal(writes, 1, "invalidation does not retry the write");
      assert.deepEqual(h.effects, []);
    } finally { gate.resolve(); h.restore(); }
  }
});


test("allocation duplicate cannot prematurely settle an in-flight request after another group advances revision", async () => {
  const h = harness(); const gate = deferred(); let writes = 0;
  try {
    let data = allocationFixture(h);
    h.deps.readDepartmentEmployeeAllocation = () => data;
    h.deps.updateDepartmentEmployeeLimit = async () => {
      writes += 1; await gate.promise;
      data = { ...data, revision: 5, leaders: data.leaders.map((row, index) => index ? row : { ...row, source: "manual", desiredLimit: 0, pending: true }) };
      return { ok: true, allocation: data };
    };
    await h.coordinator.open(h.root.id);
    const request = limitRequest(h.leader.id);
    h.receive(request); await tick();
    data = { ...data, revision: 4 }; // trusted service revision advanced by a different group
    h.receive(request); await tick();
    assert.equal(writes, 1);
    assert.equal(h.posted.filter((row) => row.type === "loopGroupChatChat:departmentEmployeeLimitSettled").length, 0);
    gate.resolve(); await tick();
    const receipts = h.posted.filter((row) => row.type === "loopGroupChatChat:departmentEmployeeLimitSettled");
    assert.equal(receipts.length, 1); assert.equal(receipts[0].ok, true); assert.equal(receipts[0].revision, 5);
  } finally { gate.resolve(); h.restore(); }
});

for (const status of ["running", "stopped", "interrupted"] as const) {
  test(`cold organization controls distinguish task status from remaining leases: ${status}`, async () => {
    const h = harness();
    try {
      h.root.status = status === "stopped" ? "stopped" : "running";
      h.root.runtimeInterrupted = status === "interrupted" ? true : undefined;
      const capacity = { rootTaskId: h.root.id, maxLeaders: 4, maxEmployees: 20, leaders: ["module-A"], employees: [] as string[] };
      h.deps.readDepartmentOrganizationControlState = task => readDepartmentOrganizationControlState(task, "workspace-A", {
        readTaskRecord: h.deps.readTaskRecord, readCapacity: () => capacity,
      });
      let stops = 0;
      h.deps.departmentOrganizationControl = { stop: async root => { assert.equal(root.id, h.root.id); stops++; }, continue: async () => {}, complete: async () => {} };
      // Ordinary reconciliation has already happened before the delayed Webview handshake.
      assert.equal(h.deps.collectRunningTaskIds().size, 0);
      const state = buildLoopGroupChatPanelState(h.root, h.deps);
      assert.equal(state.task.status, status === "running" ? "running" : "stopped");
      assert.equal(state.department?.director.status, state.task.status);
      assert.equal(state.task.canStop, status === "running"); assert.equal(state.task.canContinue, false);
      const actions = buildLoopGroupChatPanelContentPatch(state, 1).actionsHtml;
      if (status === "running") {
        assert.match(actions, /data-action="stopTask"/);
        assert.doesNotMatch(actions, /data-action="continueTask"/);
      } else {
        assert.doesNotMatch(actions, /data-action="stopTask"/);
        assert.match(actions, /data-action="continueTask"[^>]*disabled/);
      }
      await h.coordinator.open(h.root.id);
      h.receive({ type: "loopGroupChatChat:stopTask" }); await tick();
      assert.equal(stops, status === "running" ? 1 : 0);
      assert.equal(h.effects.length, 0, "never dispatch a single-task runner or ordinary stop");
      capacity.leaders = [];
      if (status === "running") h.root.status = "stopped";
      const cleaned = buildLoopGroupChatPanelState(h.root, h.deps);
      assert.equal(cleaned.task.canStop, false); assert.equal(cleaned.task.canContinue, true);
    } finally { h.restore(); }
  });
}

test("organization control projection requires trusted source, exact root/workspace and keeps unknown capacity pending", () => {
  const { root, leader, records } = departmentRecords();
  const port = { readTaskRecord: (id: string) => records.get(id) ?? null,
    readCapacity: () => ({ rootTaskId: root.id, maxLeaders: 4, maxEmployees: 20, leaders: ["module-A"], employees: [] }) };
  assert.deepEqual(readDepartmentOrganizationControlState(root, "workspace-A", port), { needsCleanup: true });
  assert.equal(readDepartmentOrganizationControlState(root, "workspace-B", port), null);
  assert.equal(readDepartmentOrganizationControlState(root, "workspace-A", { ...port, readTaskRecord: () => null }), null);
  assert.equal(readDepartmentOrganizationControlState(leader, "workspace-A", port), null);
  for (const mutate of [(t: LoopTaskRecord) => { t.departmentInvalid = true; },
    (t: LoopTaskRecord) => { t.department!.parentTaskId = "foreign"; },
    (t: LoopTaskRecord) => { t.department!.rootTaskId = "foreign"; },
    (t: LoopTaskRecord) => { t.department!.leaderSubtaskId = "module-A"; },
    (t: LoopTaskRecord) => { t.workspaceKey = "foreign"; },
    (t: LoopTaskRecord) => { t.taskStoreFile = "/untrusted/tasks.json"; }]) {
    const bad = structuredClone(root); mutate(bad);
    assert.equal(readDepartmentOrganizationControlState(bad, "workspace-A", port), null);
  }
  for (const readCapacity of [() => null, () => { throw new Error("offline"); }, () => ({ ...port.readCapacity(), rootTaskId: "foreign" })]) {
    assert.deepEqual(readDepartmentOrganizationControlState(root, "workspace-A", { ...port, readCapacity }), { needsCleanup: true });
  }
});

test("director projection marks only a trusted root without a local controller interrupted and preserves reconciliation controls", async () => {
  const h = harness();
  h.root.status = "running";
  const capacity = { rootTaskId: h.root.id, maxLeaders: 4, maxEmployees: 20, leaders: ["module-A"], employees: [] };
  h.deps.readDepartmentOrganizationControlState = (task) => readDepartmentOrganizationStopFeedback(task, h.root.workspaceKey!, {
    readTaskRecord: (id) => h.records.get(id) ?? null, readCapacity: () => capacity,
  });
  try {
    h.deps.hasLocalDepartmentDirectorActivity = () => false;
    let state = buildLoopGroupChatPanelState(h.root, h.deps);
    assert.equal(state.task.status, "stopped");
    assert.equal(state.task.departmentExecutionInterrupted, true);
    assert.equal(state.task.canStop, true);
    assert.equal(state.task.canContinue, false);
    let actions = buildLoopGroupChatPanelContentPatch(state, 1).actionsHtml;
    assert.match(actions, /本宿主执行已中断/u);
    assert.match(actions, /data-action="stopTask"/u);
    assert.match(actions, /data-action="continueTask"[^>]*disabled/u);

    h.deps.hasLocalDepartmentDirectorActivity = () => true;
    state = buildLoopGroupChatPanelState(h.root, h.deps);
    assert.equal(state.task.status, "running");
    assert.equal(state.task.departmentExecutionInterrupted, undefined);

    delete h.deps.hasLocalDepartmentDirectorActivity;
    state = buildLoopGroupChatPanelState(h.root, h.deps);
    assert.equal(state.task.status, "running", "an unavailable host-activity reader is not evidence of interruption");
  } finally { h.restore(); }
});

test("cold department panels show no stale director, leader or employee work and preserve local activity", () => {
  const h = harness();
  try {
    h.root.status = "running";
    h.root.schedulingMode = "classic";
    h.leader.status = "stopped";
    h.deps.hasLocalDepartmentDirectorActivity = () => false;
    const runningIds = new Set<string>();
    h.deps.collectRunningTaskIds = () => runningIds;
    const persisted = structuredClone([h.root, h.leader]);
    const originalLeaderLoopPlus = h.leader.loopPlus;
    const originalLeaderMainPhase = h.leader.loopPlusMainPhase;
    const originalLeaderSubTasks = h.leader.subTasks;

    const directorState = buildLoopGroupChatPanelState(h.root, h.deps);
    assert.equal(directorState.task.status, "stopped");
    assert.equal(directorState.department?.director.status, "runtime_interrupted");
    assert.equal(directorState.rounds[0].participants.find((member) => member.id === "module-A")?.status, "waiting_continuation");
    assert.equal(directorState.department?.leaders[0].participant.status, "stopped");
    assert.equal(directorState.department?.leaders[0].statusSummary?.running, 0);
    assert.equal(directorState.department?.leaders[0].employees[0].status, "blocked");
    assert.match(buildLoopGroupChatPanelContentPatch(directorState, 1).rosterPanelHtml, /本宿主执行已中断/u);

    h.root.status = "stopped";
    const staleStoppedRoot = buildLoopGroupChatPanelState(h.root, h.deps);
    assert.equal(staleStoppedRoot.task.status, "stopped");
    assert.equal(staleStoppedRoot.rounds[0].participants.find((member) => member.id === "module-A")?.status, "waiting_continuation");

    h.root.status = "running";
    h.leader.status = "running";
    h.leader.loopPlus = createLoopPlusScheduler({ maxConcurrency: 4 }).snapshot();
    h.leader.loopPlusMainPhase = "decomposing";
    h.leader.subTasks = [];
    const staleDecomposition = buildLoopGroupChatPanelState(h.root, h.deps).department?.leaders[0];
    assert.equal(staleDecomposition?.participant.status, "runtime_interrupted");
    assert.equal(staleDecomposition?.statusSummary?.running, 0);

    h.leader.status = "stopped";
    h.leader.loopPlus = originalLeaderLoopPlus;
    if (originalLeaderMainPhase === undefined) delete h.leader.loopPlusMainPhase;
    else h.leader.loopPlusMainPhase = originalLeaderMainPhase;
    h.leader.subTasks = originalLeaderSubTasks;
    const stoppedLeader = buildLoopGroupChatPanelState(h.leader, h.deps);
    assert.equal(stoppedLeader.task.status, "stopped");
    assert.equal(stoppedLeader.loopPlus?.ok && stoppedLeader.loopPlus.runningCount, 0);
    assert.equal(stoppedLeader.loopPlus?.ok && stoppedLeader.loopPlus.running[0].interrupted, true);
    assert.equal(stoppedLeader.rounds[0].participants[1].status, "waiting_continuation");
    assert.deepEqual([h.root, h.leader], persisted);
    assert.deepEqual(h.effects, []);

    h.leader.status = "running";
    const interruptedLeader = buildLoopGroupChatPanelState(h.leader, h.deps);
    assert.equal(interruptedLeader.task.canContinue, false);
    assert.equal(interruptedLeader.department?.leaders[0].participant.status, "runtime_interrupted");
    const interruptedPanel = buildLoopGroupChatPanelContentPatch(interruptedLeader, 1).taskPanelHtml;
    assert.match(interruptedPanel, /<h2>任务状态<\/h2>[\s\S]*本宿主执行已中断/u);
    assert.doesNotMatch(interruptedPanel, /<h2>任务<\/h2>/u);

    runningIds.add(h.leader.id);
    assert.equal(buildLoopGroupChatPanelState(h.leader, h.deps).task.status, "running");
    const liveLeader = buildLoopGroupChatPanelState(h.root, h.deps).department?.leaders[0];
    assert.equal(liveLeader?.statusSummary?.running, 1);
    assert.equal(liveLeader?.employees[0].status, "running");

    runningIds.clear();
    h.deps.readDepartmentOrganizationControlState = () => null;
    assert.equal(buildLoopGroupChatPanelState(h.root, h.deps).task.status, "running", "untrusted roots do not opt into department projection");
  } finally { h.restore(); }
});

test("projection and organization controls agree on valid, empty and unknown capacity", () => {
  const { root, records } = departmentRecords();
  const port = { readTaskRecord: (id: string) => records.get(id) ?? null,
    readLeaderTaskIds: (rootId: string, moduleId: string) => fixtureDepartmentLeaderTaskIds(records, rootId, moduleId) };
  const empty: DepartmentCapacitySnapshot = { rootTaskId: root.id, maxLeaders: 0, maxEmployees: Number.MAX_SAFE_INTEGER,
    leaders: [], employees: [], employeeOverflow: ["unused-overflow-metadata"] };
  const occupied = { ...empty, leaders: ["lease-A"], employees: ["lease-A", "lease-B"] };
  for (const [capacity, needsCleanup] of [[empty, false], [occupied, true]] as const) {
    const withCapacity = { ...port, readCapacity: () => capacity };
    const { maxLeaders, maxEmployees, activeLeaders, activeEmployees } = buildDepartmentGroupChatProjection(root, withCapacity)!;
    assert.deepEqual([maxLeaders, maxEmployees, activeLeaders, activeEmployees],
      [capacity.maxLeaders, capacity.maxEmployees, capacity.leaders.length, capacity.employees.length]);
    const feedback = readDepartmentOrganizationStopFeedback(root, root.workspaceKey!, withCapacity, "confirmed");
    assert.deepEqual(feedback, { needsCleanup, stopState: needsCleanup ? "unconfirmed" : "confirmed" });
    if (needsCleanup) assert.throws(() => assertDepartmentOrganizationContinuation(root, feedback), /部门停止未确认/);
    else assert.doesNotThrow(() => assertDepartmentOrganizationContinuation(root, feedback));
  }

  const invalid: Array<[string, Partial<Record<keyof DepartmentCapacitySnapshot, unknown>>]> = [
    ["nonexact root", { rootTaskId: ` ${root.id}` }],
    ["negative limit", { maxLeaders: -1 }],
    ["fractional limit", { maxEmployees: 1.5 }],
    ["unsafe limit", { maxLeaders: Number.MAX_SAFE_INTEGER + 1 }],
    ["non-numeric limit", { maxEmployees: "1" }],
    ["missing leader array", { leaders: undefined }],
    ["non-array employee leases", { employees: "lease-A" }],
    ["blank leader lease", { leaders: [" "] }],
    ["non-string employee lease", { employees: [42] }],
    ["sparse lease array", { leaders: new Array<string>(1) }],
    ["duplicate leaders", { leaders: ["lease-A", "lease-A"] }],
    ["duplicate employees", { employees: ["lease-A", "lease-A"] }],
  ];
  const unavailable: ReadonlyArray<readonly [string, (() => unknown)?]> = [
    ["missing reader"],
    ["missing snapshot", () => null],
    ["read error", () => { throw new Error("offline"); }],
    ...invalid.map(([name, fields]) => [name, () => ({ ...empty, ...fields })] as const),
  ];
  for (const [name, readCapacity] of unavailable) {
    const withCapacity = { ...port, readCapacity: readCapacity as (() => DepartmentCapacitySnapshot | null) | undefined };
    const { maxLeaders, maxEmployees, activeLeaders, activeEmployees } = buildDepartmentGroupChatProjection(root, withCapacity)!;
    assert.deepEqual([maxLeaders, maxEmployees, activeLeaders, activeEmployees],
      [root.department!.limits.maxLeaders, root.department!.limits.maxEmployees, null, null], name);
    const feedback = readDepartmentOrganizationStopFeedback(root, root.workspaceKey!, withCapacity, "confirmed");
    assert.deepEqual(feedback, { needsCleanup: true, stopState: "unconfirmed" }, name);
    assert.throws(() => assertDepartmentOrganizationContinuation(root, feedback), /部门停止未确认/, name);
  }
});

test("a refused continuation settlement cannot re-enable continue while organization cleanup is unconfirmed", async () => {
  const h = harness();
  try {
    h.root.status = "stopped"; h.root.runtimeInterrupted = true;
    h.deps.readDepartmentOrganizationControlState = () => ({ needsCleanup: true });
    h.deps.departmentOrganizationControl = { continue: async () => { throw new Error("original-retirement-unconfirmed"); },
      stop: async () => {}, complete: async () => {} };
    await h.coordinator.open(h.root.id);
    await h.coordinator.continueTask(h.root.id);
    const settled = h.posted.filter(message => message.type === "loopGroupChatChat:continueTaskSettled").at(-1);
    assert.equal(settled?.canContinue, false);
    assert.equal(h.panel().getState()?.task.canContinue, false);
    assert.equal(h.panel().getState()?.task.canStop, false);
    assert.match(buildLoopGroupChatPanelContentPatch(h.panel().getState()!, 1).actionsHtml, /data-action="continueTask"[^>]*disabled/);
    assert.equal(h.effects.length, 0);
  } finally { h.restore(); }
});


test("stop feedback uses trusted cleanup state without requiring a local stop receipt", () => {
  const { root, records } = departmentRecords();
  const empty = { rootTaskId: root.id, maxLeaders: 4, maxEmployees: 20, leaders: [] as string[], employees: [] as string[] };
  const port = { readTaskRecord: (id: string) => records.get(id) ?? null, readCapacity: () => empty };
  assert.deepEqual(readDepartmentOrganizationStopFeedback(root, "workspace-A", port), { needsCleanup: false, stopState: undefined });
  for (const result of ["stopping", "unconfirmed"] as const) {
    const control = readDepartmentOrganizationStopFeedback(root, "workspace-A", port, result)!;
    assert.deepEqual(control, { needsCleanup: false, stopState: result });
  }
  assert.deepEqual(readDepartmentOrganizationStopFeedback(root, "workspace-A", port, "confirmed"), { needsCleanup: false, stopState: "confirmed" });
  for (const readCapacity of [() => null, () => ({ ...empty, leaders: ["module-A"] }), () => ({ ...empty, rootTaskId: "other-root" })]) {
    assert.deepEqual(readDepartmentOrganizationStopFeedback(root, "workspace-A", { ...port, readCapacity }, "confirmed"), { needsCleanup: true, stopState: "unconfirmed" });
  }
  assert.equal(readDepartmentOrganizationStopFeedback(root, "workspace-B", port, "confirmed"), null);
  root.status = "running";
  assert.equal(readDepartmentOrganizationStopFeedback(root, "workspace-A", port, "confirmed")?.stopState, undefined, "a resumed root shows its normal stop action");
  assert.deepEqual(readDepartmentOrganizationStopFeedback(root, "workspace-A", { ...port, readCapacity: () => null }), { needsCleanup: true, stopState: "unconfirmed" });
});

for (const reject of [false, true]) {
  test(`root page stop survives refresh, ignores duplicates and settles with trusted cleanup: reject=${reject}`, async () => {
    const h = harness(), gate = deferred(); let calls = 0, resumes = 0, needsCleanup = true;
    try {
      h.root.status = "running";
      h.deps.readDepartmentOrganizationControlState = () => ({ needsCleanup });
      h.deps.departmentOrganizationControl = {
        stop: async () => { calls++; h.root.status = "stopped"; needsCleanup = false; await gate.promise; if (reject && calls === 1) throw new Error("停止核验拒绝：保留原占用"); },
        continue: async () => { resumes++; h.root.status = "running"; }, complete: async () => {},
      };
      await h.coordinator.open(h.root.id);
      h.receive({ type: "loopGroupChatChat:stopTask" }); await tick();
      assert.equal(calls, 1);
      const pending = h.panel().getState()!;
      assert.equal(pending.task.departmentStopState, "stopping"); assert.equal(pending.task.canContinue, false);
      assert.match(buildLoopGroupChatPanelContentPatch(pending, 1).actionsHtml, /data-action="stopTask"[^>]*disabled[^>]*>正在停止…/);
      h.receive({ type: "loopGroupChatChat:refresh" });
      h.receive({ type: "loopGroupChatChat:stopTask" }); await tick();
      assert.equal(calls, 1); assert.equal(h.panel().getState()?.task.departmentStopState, "stopping");
      assert.equal(needsCleanup, false, "capacity is already empty");
      h.receive({ type: "loopGroupChatChat:continueTask" }); await tick();
      assert.equal(resumes, 0); assert.ok(h.warnings.some((message) => /部门正在停止/.test(message)));
      gate.resolve(); await tick(); await tick();
      if (reject) {
        const refused = h.panel().getState()!;
        assert.equal(refused.task.canContinue, false);
        const patch = buildLoopGroupChatPanelContentPatch(refused, 2);
        assert.doesNotMatch(patch.actionsHtml, /核验停止|data-action="stopTask"/);
        assert.match(patch.actionsHtml, /data-action="continueTask"[^>]*disabled/);
        assert.match(patch.taskPanelHtml, /<h2>任务状态<\/h2>/u);
        assert.doesNotMatch(patch.taskPanelHtml, /<h2>任务<\/h2>/u);
        assert.match(patch.taskPanelHtml, /已中止/);
        assert.ok(h.warnings.includes("停止核验拒绝：保留原占用"));
        h.receive({ type: "loopGroupChatChat:continueTask" }); await tick();
        assert.equal(resumes, 0); assert.ok(h.warnings.some((message) => /部门停止未确认/.test(message)));
        h.receive({ type: "loopGroupChatChat:stopTask" }); await tick(); await tick();
        assert.equal(calls, 1);
        return;
      }
      assert.equal(h.panel().getState()?.task.canStop, false);
      assert.equal(h.panel().getState()?.task.canContinue, true);
      h.receive({ type: "loopGroupChatChat:stopTask" }); await tick();
      assert.equal(calls, 1, "late duplicate after completed stop has no effect");
      h.receive({ type: "loopGroupChatChat:continueTask" }); await tick();
      assert.equal(resumes, 1);
    } finally { gate.resolve(); h.dispose(); h.restore(); }
  });
}

test("director clarification saves an answer without waking a waiter or resuming after stop refusal", async () => {
  const h = harness(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "department-stop-answer-"));
  const scope = loopClarificationScope(h.root.id);
  try {
    h.root.communicationDir = temp;
    h.root.status = "stopped";
    h.deps.readDepartmentOrganizationControlState = () => ({ needsCleanup: false, stopState: "unconfirmed" });
    let resumes = 0;
    h.deps.departmentOrganizationControl = { continue: async () => { resumes++; }, stop: async () => {}, complete: async () => {} };
    await h.coordinator.open(h.root.id);
    h.root.pendingClarification = clarification();
    let delivered = false;
    const answer = waitForOrchestratorClarification(scope, h.root.pendingClarification).then((result) => { delivered = true; return result; });
    submitAnswer(h); await tick();
    assert.equal(h.root.pendingClarification, undefined);
    assert.match(h.root.supplementalRequirements?.at(-1) ?? "", /已确认范围/);
    assert.equal(delivered, false);
    assert.equal(resumes, 0);
    assert.ok(!h.effects.some(([kind]) => kind === "continue"));
    assert.ok(h.warnings.some((message) => /部门停止未确认/.test(message)));
    abortOrchestratorClarification(scope);
    assert.equal((await answer).status, "aborted");
  } finally { abortOrchestratorClarification(scope); h.dispose(); h.restore(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test("stop rejection still refreshes and its original error survives a refresh failure", async () => {
  const h = harness(); let stopping = false;
  try {
    h.root.status = "running";
    h.deps.readDepartmentOrganizationControlState = () => ({ needsCleanup: true });
    h.deps.departmentOrganizationControl = { stop: async () => { stopping = true; throw new Error("原停止错误"); }, continue: async () => {}, complete: async () => {} };
    await h.coordinator.open(h.root.id);
    const update = h.panel().update.bind(h.panel());
    h.panel().update = ((...args: Parameters<typeof update>) => { if (stopping) throw new Error("刷新错误"); return update(...args); });
    h.receive({ type: "loopGroupChatChat:stopTask" }); await tick(); await tick();
    assert.ok(h.warnings.includes("群聊刷新失败，请重试。"));
    assert.ok(h.warnings.includes("原停止错误"));
  } finally { h.dispose(); h.restore(); }
});

test("late root stop completion cannot update another root or replace a reopened view", async () => {
  const h = harness(), gate = deferred();
  try {
    h.root.status = "running";
    h.deps.readDepartmentOrganizationControlState = () => ({ needsCleanup: true });
    h.deps.departmentOrganizationControl = { stop: async () => { await gate.promise; }, continue: async () => {}, complete: async () => {} };
    await h.coordinator.open(h.root.id);
    h.receive({ type: "loopGroupChatChat:stopTask" }); await tick();
    h.dispose();
    // Reopening uses the same root fence; it must not send another stop.
    await h.coordinator.open(h.root.id);
    assert.equal(h.panel().getState()?.task.departmentStopState, "stopping");
    const other = structuredClone(h.root); other.id = "other-director"; other.department!.rootTaskId = other.id; other.status = "stopped";
    h.records.set(other.id, other);
    await h.coordinator.open(other.id);
    const otherPanel = h.deps.panelsByTaskId.get(other.id)!;
    const before = otherPanel.getState();
    gate.resolve(); await tick(); await tick();
    assert.deepEqual(otherPanel.getState(), before);
    assert.equal(otherPanel.getState()?.task.departmentStopState, "unconfirmed");
  } finally { gate.resolve(); h.dispose(); h.restore(); }
});


test("trusted root refusal and workspace revocation during start refresh perform no organization stop", async () => {
  const h = harness(); let calls = 0, trusted = false;
  try {
    h.root.status = "running";
    h.deps.readDepartmentOrganizationControlState = () => trusted ? { needsCleanup: true } : null;
    h.deps.departmentOrganizationControl = { stop: async () => { calls++; }, continue: async () => {}, complete: async () => {} };
    await h.coordinator.open(h.root.id);
    h.receive({ type: "loopGroupChatChat:stopTask" }); await tick();
    assert.equal(calls, 0);
    trusted = true;
    h.deps.prepareModelSwitchOptions = async () => { trusted = false; };
    h.receive({ type: "loopGroupChatChat:stopTask" }); await tick(); await tick();
    assert.equal(calls, 0);
    assert.ok(h.warnings.includes("部门停止归属已变化。"));
  } finally { h.dispose(); h.restore(); }
});
