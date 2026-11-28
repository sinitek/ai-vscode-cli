const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
require("../dist/test/vscodeMock").installVscodeMock();
const { buildLoopGroupChatPanelHtml, buildLoopGroupChatPanelContentPatch } = require("../dist/webview/loopGroupChatPanel");
const { buildLoopGroupChatPanelState } = require("../dist/extensionHost/loopGroupChatPanelCoordinator");
const { createLoopPlusScheduler } = require("../dist/loopPlusScheduler");

const task = {
  id: "continue-refresh", cli: "codex", status: "stopped", rootPrompt: "验证群聊继续说明。",
  taskStoreFile: "", mainCommunicationFile: "", currentRound: 1, updatedAt: 1,
  canContinue: true, canSupplement: true, canStop: false, progressPercent: 30,
};
const state = {
  task, rounds: [], chatMarkdown: "", loopPlus: {
    ok: true, schedulingMode: "event_driven", activity: "paused", phase: "paused", wakePending: false,
    currentReview: null, reviewQueue: [], currentReviewCount: 0, reviewQueueCount: 0, visibleReviewCount: 0,
    running: [], pending: [], runningCount: 0, pendingCount: 0, seenAttempts: [],
  },
};
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH }); });
after(async () => { await browser?.close(); });

async function openGroupChat(context, initialState = state) {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  context.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => errors.push(request.url()));
  const html = buildLoopGroupChatPanelHtml({ cspSource: "'self'" }, initialState, undefined, 1);
  await page.route("https://group-chat.test/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await page.addInitScript(() => {
    let stored;
    window.posted = [];
    window.acquireVsCodeApi = () => ({ getState: () => stored, setState: (value) => { stored = value; }, postMessage: (message) => window.posted.push(message) });
  });
  await page.goto("https://group-chat.test/");
  await page.waitForFunction(() => window.posted.some((message) => message.type === "loopGroupChatChat:domReady"));
  const deliver = (data) => page.evaluate((message) => window.dispatchEvent(new MessageEvent("message", { data: message })), data);
  const refresh = (generation, changes) => deliver(buildLoopGroupChatPanelContentPatch({ ...state, task: { ...task, ...changes } }, generation));
  const requests = () => page.evaluate(() => window.posted.filter((message) => message.type === "loopGroupChatChat:continueTask"));
  return { page, deliver, refresh, requests, button: page.locator('[data-action="continueTask"]'), dialog: page.locator("#continueDialogBackdrop") };
}

test("waiting for storage is visible while the same reservation is pending", async (context) => {
  const running = [{ subtaskId: "plot", attemptId: "plot-2", title: "绘图", state: "running", waitingForStorage: true }];
  const pending = { ...state, task: { ...task, status: "running" },
    loopPlus: { ...state.loopPlus, activity: "waiting", phase: "awaiting_subtasks", running, runningCount: 1 } };
  const { page } = await openGroupChat(context, pending);
  assert.equal(await page.getByText("等待任务存储确认启动", { exact: true }).isVisible(), true);
});

test("a native click spanning a progress refresh opens the Loop+ continuation dialog", async (context) => {
  const { page, button, dialog, refresh, requests } = await openGroupChat(context);
  const bounds = await button.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await refresh(2, { progressPercent: 31 });
  await page.mouse.up();
  assert.equal(await dialog.isVisible(), true, "releasing the button should open the dialog");
  const input = page.locator("#continueDialogInput");
  await input.fill("从上次暂停处继续");
  await refresh(3, { progressPercent: 32 });
  assert.equal(await input.inputValue(), "从上次暂停处继续");
  assert.equal(await input.evaluate((element) => document.activeElement === element), true);
  await input.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await button.evaluate((element) => document.activeElement === element), true);
  await button.press("Space");
  assert.equal(await dialog.isVisible(), true);
  await input.press("Escape");
  await page.mouse.down();
  await refresh(4, { canContinue: false, canStop: true, status: "running" });
  await page.mouse.up();
  assert.equal(await button.count(), 0);
  assert.equal(await dialog.isVisible(), false);
  assert.deepEqual(await requests(), []);
});

test("a resumable patch restores a settled button even when the toolbar markup repeats", async (context) => {
  const { page, button, dialog, deliver, refresh, requests } = await openGroupChat(context);
  await refresh(2, {});
  await button.click();
  await page.locator("#continueDialogInput").fill("继续验证");
  await page.locator("#continueDialogConfirm").click();
  const [request] = await requests();
  assert.equal(request.prompt, "继续验证");
  await refresh(3, {});
  assert.equal(await button.isDisabled(), true);
  await deliver({ type: "loopGroupChatChat:continueTaskSettled", requestId: request.requestId, canContinue: false });
  assert.equal(await button.isDisabled(), true);
  await refresh(4, {});
  assert.equal(await button.isEnabled(), true, "a fresh resumable snapshot should enable the button");
  await button.click();
  assert.equal(await dialog.isVisible(), true);
  assert.equal((await requests()).length, 1);
});

test("a returning page can reconcile a missed continuation receipt without submitting again", async (context) => {
  const { page, button, dialog, deliver, refresh, requests } = await openGroupChat(context);
  await button.click();
  await page.locator("#continueDialogConfirm").click();
  const [{ requestId }] = await requests();
  await refresh(2, { canContinue: false, canStop: true, status: "running" });
  assert.equal(await button.getAttribute("aria-busy"), "true");
  await refresh(3, {});
  await deliver({ type: "loopGroupChatChat:continueTaskSettled", requestId: "obsolete", canContinue: true });
  assert.equal(await button.isDisabled(), true);
  const request = await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    return window.posted.at(-1);
  });
  assert.deepEqual(request, { type: "loopGroupChatChat:refresh", continueRequestId: requestId });
  await deliver({ type: "loopGroupChatChat:continueTaskSettled", requestId: request.continueRequestId, canContinue: true });
  await button.click();
  assert.equal(await dialog.isVisible(), true);
  assert.equal((await requests()).length, 1);
});

test("同一群聊页面随子任务续跑、再次中断和待验收更新成员及汇总", async (context) => {
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 2 });
  scheduler.dispatch([{ subtaskId: "repair", attemptId: "repair-1" }]);
  scheduler.finish({ subtaskId: "repair", attemptId: "repair-1", outcome: "completed" });
  scheduler.submitReviewBatch([scheduler.snapshot().currentReview.eventId], "failed");
  scheduler.dispatch([{ subtaskId: "repair", attemptId: "repair-2" }, { subtaskId: "plain", attemptId: "plain-1" }]);
  const record = { ...task, status: "running", schedulingMode: "event_driven", workspaceKey: "smoke", createdAt: 1,
    subTasks: ["repair", "plain"].map(id => ({ id, title: id, status: "blocked" })), rounds: [], communicationDir: "" };
  const live = [];
  const deps = { getLiveSubtaskRuns: () => live, collectRunningTaskIds: () => new Set([record.id]), getActiveSubtaskIds: () => [],
    resolveMainPromptTarget: () => null, readTextFileIfNonEmpty: () => "## 群聊\n", fileExists: () => true,
    getSelectedCliModel: () => null, getActiveConfigIdForCli: () => null, t: key => key };
  const project = () => buildLoopGroupChatPanelState({ ...record, loopPlus: scheduler.snapshot() }, deps);
  const { page, deliver } = await openGroupChat(context, project());
  let generation = 1;
  const update = () => deliver(buildLoopGroupChatPanelContentPatch(project(), ++generation));
  const roster = page.locator("#rosterPanelSlot .roster-member-row");
  const member = (id, status) => roster.filter({ hasText: id }).getByText(status, { exact: true }).waitFor({ state: "visible" });
  const count = field => page.locator(`#taskPanelSlot [data-loop-plus-count="${field}"]`).textContent();
  await member("repair", "已中断，等待续跑");
  await member("plain", "已中断，等待续跑");
  const run = (id, attempt) => ({ taskRole: "subtask", loopTaskId: record.id, loopRound: 1, loopSubtaskId: id, loopAttemptId: attempt, startedAt: 2 });
  live.push(run("plain", "plain-1"), run("repair", "repair-2"));
  await update();
  await member("plain", "运行中");
  await member("repair", "修复中");
  assert.equal(await count("running"), "运行中 1");
  assert.equal(await count("repairing"), "修复中 1");
  live.pop();
  await update();
  await member("repair", "已中断，等待续跑");
  assert.equal(await count("repairing"), "修复中 0");
  scheduler.finish({ subtaskId: "plain", attemptId: "plain-1", outcome: "unconfirmed", detail: "定时检查发现子任务已失联" });
  live.pop();
  await update();
  await member("plain", "待验收");
  assert.equal(await count("running"), "运行中 0");
});
