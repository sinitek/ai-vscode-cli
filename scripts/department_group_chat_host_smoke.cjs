/* Coordinator/browser integration with task-record fixtures, not an Extension Development Host. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const dist = path.resolve(root, process.env.DEPARTMENT_UI_DIST || ".tmp/department-group-ui-dist/round17/dist");
const output = path.resolve(root, process.env.DEPARTMENT_UI_EVIDENCE || ".tmp/department-group-ui-dist/round17/browser-host");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright");
require(path.join(dist, "test/vscodeMock.js")).installVscodeMock();
const vscode = require("vscode");
const { departmentRecords, fixtureDepartmentLeaderTaskIds } = require(path.join(dist, "test/loop/departmentGroupChatHost.fixture.js"));
const { createLoopGroupChatPanelCoordinator } = require(path.join(dist, "extensionHost/loopGroupChatPanelCoordinator.js"));
fs.mkdirSync(output, { recursive: true });
function theme(dark) {
  const background = dark ? "#1f1f1f" : "#ffffff";
  const foreground = dark ? "#ededed" : "#202020";
  return {
    "font-family": "Arial, sans-serif", "font-size": "13px", "editor-background": background, "editor-foreground": foreground,
    foreground, descriptionForeground: dark ? "#c0c0c0" : "#555555", "sideBar-background": dark ? "#252526" : "#f3f3f3",
    "widget-border": dark ? "#656565" : "#aaaaaa", focusBorder: dark ? "#6db9ff" : "#005fb8",
    "editorWidget-background": background, "button-background": "#005fb8", "button-foreground": "#ffffff",
    "button-secondaryBackground": dark ? "#3d3d3d" : "#dedede", "button-secondaryForeground": foreground,
    "button-secondaryHoverBackground": dark ? "#505050" : "#cccccc", "button-hoverBackground": "#00539f",
    "badge-background": dark ? "#404040" : "#dddddd", "badge-foreground": foreground,
    "input-background": background, "input-foreground": foreground, "input-border": dark ? "#777777" : "#888888",
    "list-hoverBackground": dark ? "#353535" : "#e8e8e8", "toolbar-hoverBackground": dark ? "#353535" : "#e8e8e8",
    "textLink-foreground": dark ? "#85c4ff" : "#005fb8", "charts-green": dark ? "#89d185" : "#246b2a",
    "charts-blue": dark ? "#85c4ff" : "#005fb8", "charts-orange": dark ? "#ffc679" : "#854500",
    "errorForeground": dark ? "#ff9999" : "#a31515", "icon-foreground": foreground,
  };
}
function withTimeout(promise, label, timeoutMs = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], effects = [], warnings = [], messages = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => errors.push(request.url() + " " + request.failure()?.errorText));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const data = departmentRecords(); let receive, html;
  vscode.window.createWebviewPanel = () => ({ title: "", webview: {
    cspSource: "'self'", set html(value) {
      html = value;
      if (value.includes('vscode.postMessage({ type: "loopGroupChatChat:loadingReady" })')) {
        setTimeout(() => receive?.({ type: "loopGroupChatChat:loadingReady" }), 0);
      }
    }, get html() { return html; },
    onDidReceiveMessage(callback) { receive = callback; },
    postMessage: (message) => { messages.push(message); return page.evaluate((value) => window.dispatchEvent(new MessageEvent("message", { data: value })), message); },
  }, reveal() {}, onDidDispose() {} });
  const deps = {
    getExtensionUri: () => ({ fsPath: root }), panelsByTaskId: new Map(),
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    appendSupplementalRequirement: (items, item) => [...(items || []), item],
    appendSupplementalRequirementToCommunication: (task) => effects.push(["supplement", task.id]),
    readTaskRecord: (id) => data.records.get(id) || null,
    readDepartmentLeaderTaskIds: (rootId, moduleId) => fixtureDepartmentLeaderTaskIds(data.records, rootId, moduleId),
    updateTaskRecord: (id, patch) => Object.assign(data.records.get(id), patch),
    listTaskStoreFiles: () => ["/fixture/tasks.json"], readTaskStoreTasks: () => [...data.records.values()],
    collectRunningTaskIds: () => new Set(),
    readTextFileIfNonEmpty: () => "## 主任务发言\n\n" + "夹具中的沟通内容 **Markdown**。\n\n".repeat(160),
    fileExists: () => true, writeTextFileEnsuringDir: () => true, getActiveSubtaskIds: () => [], buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: (task) => ({ tabId: task.id, cli: "codex" }), revealPanelView: async () => {}, switchVisibleConversationTabForLoop: async () => {},
    isTabRunActive: () => false, getActiveConfigIdForCli: () => "fixture-config", getSelectedCliModel: () => "fixture-model",
    runLoopPrompt: async (_input, options) => effects.push(["continue", options.resumeTaskId]),
    stopRunsForTask: (id) => effects.push(["stop", id]), markTaskStoppedByUser: (id) => data.records.get(id),
    postPanelState: async () => {}, getActiveConversationTaskId: () => data.root.id,
    showInformationMessage: (value) => warnings.push(value), showWarningMessage: (value) => warnings.push(value), pickTask: async () => data.root,
    askMainModel: async (task) => { effects.push(["ask", task.id]); return { status: "ready", answer: "记录驱动的组长回答" }; },
    t: (key) => key,
  };
  const stopFeedback = process.env.DEPARTMENT_STOP_FEEDBACK === "1";
  let stopCalls = 0, finishStop, stopResult;
  const capacity = { rootTaskId: data.root.id, maxLeaders: 4, maxEmployees: 20, leaders: [], employees: [] };
  if (stopFeedback) {
    // Synthetic equivalent of the four blocked/open leaders; never load user tasks.
    data.root.status = "running";
    data.root.subTasks = Array.from({ length: 4 }, (_, i) => ({ id: `module-${i}`, title: `合成组长 ${i + 1}`, prompt: "合成夹具", status: "blocked" }));
    for (const [i, module] of data.root.subTasks.entries()) {
      const leader = structuredClone(data.leader);
      leader.id = `synthetic-leader-${i}`; leader.status = "blocked";
      leader.department.leaderSubtaskId = module.id;
      data.records.set(leader.id, leader); capacity.leaders.push(module.id);
    }
    const { readDepartmentOrganizationStopFeedback } = require(path.join(dist, "extensionHost/departmentGroupChatProjection.js"));
    deps.readDepartmentCapacity = () => capacity;
    deps.readDepartmentOrganizationControlState = task => readDepartmentOrganizationStopFeedback(task, "workspace-A", {
      readTaskRecord: deps.readTaskRecord, readCapacity: () => capacity,
    }, stopResult);
    deps.departmentOrganizationControl = {
      stop: async root => {
        assert.equal(root.id, data.root.id); stopCalls++; stopResult = "stopping";
        effects.push(["organization-stop", root.id]); data.root.status = "stopped";
        try { await new Promise((resolve, reject) => { finishStop = { resolve, reject }; }); stopResult = "confirmed"; }
        catch (error) { stopResult = "unconfirmed"; throw error; }
      },
      continue: async root => effects.push(["organization-continue", root.id]), complete: async () => {},
    };
  } else {
    data.root.status = data.leader.status = "running";
    deps.getDepartmentTaskSourceState = (task) => data.records.has(task.id) ? "owned" : "unverified";
    deps.collectRunningTaskIds = () => new Set([data.root, data.leader].filter((task) => task.status === "running").map((task) => task.id));
    data.root.schedulingMode = "classic";
    delete data.root.loopPlus;
    data.root.subTasks[0].progressWeightPercent = 20;
    data.root.subTasks[1].progressWeightPercent = 80;
    data.leader.loopPlusProgressPercent = 50;
    const displayPlan = { ...data.root.loopPlusAcceptancePlan, name: "旧的总监展示快照" };
    deps.readDisplaySnapshot = (id) => id === data.root.id ? { ...data.root, loopPlusAcceptancePlan: displayPlan } : null;
  }
  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  await withTimeout(coordinator.open(data.root.id), "loadingReady handshake");
  const css = Object.entries(theme(true)).map(([key, value]) => `--vscode-${key}:${value}`).join(";");
  html = html.replace("<head>", `<head><style>:root{${css}}</style>`);
  const server = http.createServer((request, response) => {
    if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    let resolveChildReady;
    const childReady = new Promise((resolve) => { resolveChildReady = resolve; });
    await page.exposeFunction("fixtureHostMessage", async (message) => {
      const panelMessage = message.message ?? message;
      if (!stopFeedback && panelMessage.type === "loopGroupChatChat:refresh" && !panelMessage.continueRequestId) return;
      await receive(message);
      if (message.type === "loopGroupChatChat:departmentTaskMessage" && panelMessage.type === "loopGroupChatChat:domReady") {
        resolveChildReady({ taskId: message.taskId, instanceId: message.instanceId });
      }
    });
    await page.addInitScript(() => {
      if (window !== window.top) return;
      let stored = {};
      window.acquireVsCodeApi = () => ({ getState: () => stored, setState: (state) => { stored = state; }, postMessage: (message) => window.fixtureHostMessage(message) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".department-roster").waitFor();
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--vscode-editor-background").trim()), "#1f1f1f");
    if (stopFeedback) {
      const stop = page.locator('[data-action="stopTask"]');
      const continuation = page.locator('[data-action="continueTask"]');
      const refresh = () => page.evaluate(() => window.fixtureHostMessage({ type: "loopGroupChatChat:refresh" }));
      assert.equal(await stop.innerText(), "中止");
      assert.equal(await stop.evaluate(el => el.parentElement.className), "progress-controls");
      await stop.click();
      await page.waitForFunction(() => document.querySelector('[data-action="stopTask"]')?.textContent === "正在停止…");
      assert.equal(await stop.isDisabled(), true); assert.equal(stopCalls, 1);
      assert.equal(capacity.leaders.length, 4); assert.equal(await continuation.count(), 0);
      await refresh();
      await page.evaluate(() => window.fixtureHostMessage({ type: "loopGroupChatChat:stopTask" }));
      assert.equal(await stop.isDisabled(), true); assert.equal(stopCalls, 1);
      await page.screenshot({ path: path.join(output, "stop-pending-after-refresh.png"), fullPage: true });
      const occupiedLeaders = capacity.leaders;
      capacity.leaders = [];
      await refresh();
      assert.equal(await stop.isDisabled(), true); assert.equal(await continuation.count(), 0);
      capacity.leaders = occupiedLeaders;
      const cleanupError = "部门停止尚未完成全部执行清理；原执行记录继续保留。";
      finishStop.reject(new Error(cleanupError));
      await continuation.waitFor();
      assert.equal(await stop.innerText(), "重试中止"); assert.equal(await continuation.isDisabled(), true);
      assert.match(await page.locator("#taskPanelSlot").textContent(), /整组中止待确认/);
      assert.match(await page.locator("#departmentContinueBlocked").innerText(), /整组中止尚未确认/);
      assert.ok(warnings.includes(cleanupError));
      await refresh();
      await page.evaluate(() => window.fixtureHostMessage({ type: "loopGroupChatChat:stopTask" }));
      assert.equal(stopCalls, 2, "the unconfirmed stop action explicitly retries cleanup");
      assert.equal(await stop.isDisabled(), true);
      finishStop.resolve();
      await page.waitForFunction(() => document.querySelector('[data-action="stopTask"]')?.textContent === "重试中止" || !document.querySelector('[data-action="stopTask"]'));
      await page.setViewportSize({ width: 280, height: 720 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: path.join(output, "stop-unconfirmed-narrow.png"), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 960 });
      capacity.leaders = [];
      stopResult = "confirmed";
      data.root.mainAiFailureLimitReached = true;
      await refresh();
      await continuation.waitFor({ state: "detached" });
      assert.equal(await continuation.count(), 0);
      data.root.mainAiFailureLimitReached = false;
      await refresh();
      await continuation.waitFor();
      assert.equal(await continuation.isEnabled(), true);
      assert.equal(await page.locator("#departmentContinueBlocked").count(), 0);
      assert.equal(await stop.count(), 0);
      await page.evaluate(() => window.fixtureHostMessage({ type: "loopGroupChatChat:stopTask" }));
      assert.equal(stopCalls, 2, "confirmed late duplicate is a no-op");
      await page.screenshot({ path: path.join(output, "stop-confirmed-continue.png"), fullPage: true });
      await continuation.click();
      await page.locator("#continueDialogInput").fill("继续产研部夹具任务");
      await page.locator("#continueDialogConfirm").click();
      await page.waitForFunction(() => document.querySelector('[data-action="continueTask"]')?.getAttribute("aria-busy") === "false");
      assert.deepEqual(effects, [["organization-stop", data.root.id], ["organization-stop", data.root.id], ["organization-continue", data.root.id]]);
      assert.deepEqual(errors, []);
      const result = { scenario: "director-stop-feedback", status: "passed", stopCalls, effects, warnings, errors,
        checks: ["four-blocked-open-leader-fixture", "actual-stop-click", "empty-capacity-still-pending", "refresh-keeps-disabled", "duplicate-inflight-noop", "stopped-with-retained-leases", "disabled-continue-reason", "280px-no-overflow", "no-stop-after-persisted-stop", "cleanup-restores-continue", "existing-continue-failure-gate", "late-duplicate-noop", "actual-continue-click"],
        boundary: "Headless Chromium + real coordinator/renderer/trusted projection, synthetic records and organization stop port; reuses round-366 real stop/cleanup/continue evidence" };
      fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
      return;
    }
    await page.locator('#panelActions [role="progressbar"][aria-valuenow="10"]').waitFor();
    data.leader.loopPlusProgressPercent = 65;
    coordinator.refreshOpenPanelForTask(data.leader.id);
    await page.locator('#panelActions [role="progressbar"][aria-valuenow="13"]').waitFor();
    assert.match(await page.locator(".department-occupancy").innerText(), /组长 未知\/4 · 员工 未知\/20/);
    assert.equal(await page.locator('[data-action="acceptancePlan"]').count(), 0);
    assert.doesNotMatch(await page.locator("#taskPanelSlot").innerText(), /统一验收方案（只读）|根固化快照/u);
    const parentScroll = await page.locator(".main").evaluate((element) => { element.scrollTop = 120; return element.scrollTop; });
    assert.ok(parentScroll > 0);
    const opener = page.locator(`[data-department-task-id="${data.leader.id}"]`).first();
    const readLeaderIds = deps.readDepartmentLeaderTaskIds;
    deps.readDepartmentLeaderTaskIds = (...args) => { deps.readDepartmentLeaderTaskIds = readLeaderIds; return []; };
    await opener.press("Enter");
    const retry = page.locator("#departmentChatRetry");
    await retry.waitFor();
    assert.match(await page.locator("#departmentChatStatus").innerText(), /关联无效/);
    assert.equal(await page.locator("#departmentChatContent iframe").count(), 0);
    const directorPanel = deps.panelsByTaskId.get(data.root.id);
    const failedBinding = directorPanel.getDepartmentModalTarget();
    let finishLoading;
    const loading = new Promise((resolve) => { finishLoading = resolve; });
    deps.prepareModelSwitchOptions = (task) => task.id === data.leader.id ? loading : Promise.resolve();
    await retry.press("Enter");
    await page.getByText("正在加载组长群聊…", { exact: true }).waitFor();
    await retry.waitFor({ state: "hidden" });
    finishLoading();
    const frameHandle = await page.locator("#departmentChatContent iframe").elementHandle({ timeout: 10000 });
    const frame = await frameHandle.contentFrame(); await frame.locator(".department-roster").waitFor();
    const binding = await withTimeout(childReady, "bound child DOM-ready handshake");
    assert.equal(binding.taskId, data.leader.id);
    assert.notEqual(binding.instanceId, failedBinding.instanceId);
    assert.equal(await frame.locator("#panelHeading").innerText(), "组长A");
    assert.equal(await frame.locator(".department-roster .member-name").last().innerText(), "子任务 1：真实员工");
    assert.match(await frame.locator("#taskPanelSlot").innerText(), /继承产研部统一验收方案[\s\S]*根固化快照/);
    assert.equal(await frame.locator('[data-action="acceptancePlan"]').count(), 0);
    const close = page.locator("#departmentChatClose");
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    await frame.waitForFunction(() => document.hasFocus() && document.activeElement !== document.body);
    const ask = frame.locator('[data-action="askMainModel"]');
    await ask.press("Enter");
    const askInput = frame.locator("#askChatInput");
    assert.equal(await askInput.evaluate((element) => element === document.activeElement), true);
    await askInput.fill("只问当前组长"); await frame.locator("#askChatSend").click();
    await frame.waitForFunction(() => document.body.innerText.includes("记录驱动的组长回答"), null, { timeout: 5000 });
    assert.deepEqual(effects, [["ask", data.leader.id]]);
    assert.ok(messages.some((message) => message.instanceId === binding.instanceId && message.taskId === data.leader.id && message.message?.type === "loopGroupChatChat:askThread"));
    await page.screenshot({ path: path.join(output, "coordinator-leader-ask.png"), fullPage: true, animations: "disabled" });
    await frame.locator("#askChatClose").press("Escape");
    await frame.locator("#askChatBackdrop").waitFor({ state: "hidden" });
    assert.equal(await ask.evaluate((element) => element === document.activeElement), true);

    const childScroll = await frame.locator(".main").evaluate((element) => { element.scrollTop = 180; return element.scrollTop; });
    assert.ok(childScroll > 0);
    const sameFrame = () => page.evaluate((element) => document.querySelector("#departmentChatContent iframe") === element, frameHandle);
    const taskPanel = frame.locator("#taskPanelSlot");
    const refreshPlan = async (expected, trigger) => {
      const start = messages.length;
      await trigger();
      await taskPanel.getByText(expected, { exact: false }).waitFor({ state: "attached" });
      const child = messages.slice(start).filter((message) => message.taskId === binding.taskId && message.instanceId === binding.instanceId);
      const patches = child.filter((message) => message.message?.type === "loopGroupChatChat:contentPatch");
      const plans = patches.map((message) => message.message.taskPanelHtml.includes(expected) ? expected : message.message.taskPanelHtml);
      assert.deepEqual(plans, [expected]);
      assert.ok(child.every((message) => !message.html));
      assert.deepEqual(directorPanel.getDepartmentModalTarget(), binding);
      assert.equal(await sameFrame(), true);
      assert.doesNotMatch(await taskPanel.innerText(), /旧的总监展示快照|根固化快照/);
      assert.equal(await frame.locator('[data-action="acceptancePlan"], #acceptancePlanOverlay').count(), 0);
      assert.equal(await frame.locator(".main").evaluate((element) => element.scrollTop), childScroll);
      return { expected, childContentPatches: patches.length };
    };
    data.root.loopPlusAcceptancePlan = { ...data.root.loopPlusAcceptancePlan, name: "根记录刷新后的方案" };
    const refreshes = [await refreshPlan("根记录刷新后的方案", () => coordinator.refresh(data.root.id))];
    assert.equal(directorPanel.getState().acceptancePlan.name, "旧的总监展示快照");
    await page.screenshot({ path: path.join(output, "coordinator-root-plan-refreshed.png"), fullPage: true, animations: "disabled" });
    delete data.root.loopPlusAcceptancePlan;
    refreshes.push(await refreshPlan("尚未同步统一验收方案", () => coordinator.refresh(data.leader.id)));
    assert.doesNotMatch(await taskPanel.innerText(), /根记录刷新后的方案/);
    assert.equal(deps.panelsByTaskId.has(data.leader.id), false);

    const themeSnapshot = (keys) => ({ tokens: Object.fromEntries(keys.map((key) => [key, getComputedStyle(document.body).getPropertyValue(`--vscode-${key}`).trim()])),
      scheme: getComputedStyle(document.body).colorScheme, kind: document.body.dataset.vscodeThemeKind });
    const themeKeys = Object.keys(theme(true));
    assert.deepEqual(await frame.evaluate(themeSnapshot, themeKeys), await page.evaluate(themeSnapshot, themeKeys));
    await page.evaluate((tokens) => {
      const style = document.createElement("style");
      style.id = "departmentFixtureTheme";
      style.textContent = ":root{" + Object.entries(tokens).map(([key, value]) => `--vscode-${key}:${value}`).join(";") + "}";
      document.head.append(style);
      document.body.classList.replace("vscode-dark", "vscode-light");
      document.body.dataset.vscodeThemeKind = "vscode-light";
      document.body.dataset.vscodeThemeName = "浅色夹具";
      document.documentElement.dataset.vscodeThemeId = "light-fixture";
      document.body.style.colorScheme = "light";
    }, theme(false));
    await frame.waitForFunction(() => document.body.dataset.vscodeThemeKind === "vscode-light");
    assert.deepEqual(await frame.evaluate(themeSnapshot, themeKeys), await page.evaluate(themeSnapshot, themeKeys));
    assert.equal(await sameFrame(), true);
    await page.setViewportSize({ width: 280, height: 720 });
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), true);
    await frame.locator("#sidebarToggle").press("Enter");
    await frame.locator('#taskPanelSlot .member-name[title="尚未同步统一验收方案"]').waitFor();
    const emptyPlanReadability = await frame.locator("#taskPanelSlot .panel").first().evaluate((element) => {
      const heading = element.querySelector("h2"), text = element.querySelector(".member-name");
      const headingStyle = getComputedStyle(heading), textStyle = getComputedStyle(text);
      const colors = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = (value) => colors(value).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const contrast = (foreground, background) => { const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return (values[0] + 0.05) / (values[1] + 0.05); };
      return { text: text.textContent, foreground: textStyle.color, background: getComputedStyle(element).backgroundColor,
        headingForeground: headingStyle.color, headingBackground: getComputedStyle(element).backgroundColor,
        textContrast: contrast(textStyle.color, getComputedStyle(element).backgroundColor),
        headingContrast: contrast(headingStyle.color, getComputedStyle(element).backgroundColor),
        scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    assert.equal(emptyPlanReadability.text, "尚未同步统一验收方案");
    assert.equal(emptyPlanReadability.foreground, "rgb(32, 32, 32)");
    assert.equal(emptyPlanReadability.background, "rgb(255, 255, 255)");
    assert.ok(emptyPlanReadability.textContrast >= 4.5, `empty plan text contrast: ${emptyPlanReadability.textContrast}`);
    assert.ok(emptyPlanReadability.headingContrast >= 4.5, `empty plan heading contrast: ${emptyPlanReadability.headingContrast}`);
    assert.ok(emptyPlanReadability.scrollWidth <= emptyPlanReadability.viewportWidth + 1, "empty plan must not cause horizontal overflow");
    await page.screenshot({ path: path.join(output, "coordinator-root-plan-empty-narrow.png"), fullPage: true, animations: "disabled" });
    await frame.locator("#sidebarToggle").click();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator("#departmentChatClose").click();
    await page.waitForFunction(() => !document.getElementById("departmentChatBackdrop").classList.contains("visible"));
    assert.equal(await page.locator(".main").evaluate((element) => element.scrollTop), parentScroll);
    assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
    assert.ok(!effects.some(([action]) => action === "stop"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), true);
    data.root.status = "completed";
    coordinator.refreshOpenPanelForTask(data.root.id);
    await page.locator('#panelActions [role="progressbar"][aria-valuenow="100"]').waitFor();
    assert.deepEqual(errors, []);
    const result = { scenario: "coordinator-record-fixtures", status: "passed", binding, refreshes, parentScroll, childScroll, effects, warnings, errors,
      emptyPlanReadability, checks: ["weighted-progress-initial", "weighted-progress-live", "weighted-progress-completed", "unknown-capacity", "director-plan-panel-removed", "invalid-binding-retry-and-loading", "leader-inherited-plan", "record-hierarchy", "loop-plus-subtask-title", "bound-leader-ask", "keyboard-focus", "single-root-record-patch", "leader-refresh-without-panel", "empty-read-only-plan", "same-iframe-and-child-scroll", "live-light-theme", "full-light-theme-token-sync", "280px-empty-state", "empty-plan-text-contrast", "no-horizontal-overflow", "return-closes-only", "parent-scroll-and-focus"],
      boundary: "Mock VS Code and task record ports; not a real Extension Development Host or organization launch" };
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } catch (error) {
    fs.writeFileSync(path.join(output, "failure.json"), JSON.stringify({ errors, effects, warnings, messages: messages.map(({ html, ...message }) => message), frames: await Promise.all(page.frames().map(async (frame) => ({ url: frame.url(), text: await frame.locator("body").innerText().catch(() => "unavailable") }))) }, null, 2));
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
    throw error;
  } finally { await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
