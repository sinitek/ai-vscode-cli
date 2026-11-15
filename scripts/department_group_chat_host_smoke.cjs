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
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], effects = [], warnings = [], messages = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => errors.push(request.url() + " " + request.failure()?.errorText));
  const data = departmentRecords(); let receive, html;
  vscode.window.createWebviewPanel = () => ({ title: "", webview: {
    cspSource: "'self'", set html(value) { html = value; }, get html() { return html; },
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
  const coordinator = createLoopGroupChatPanelCoordinator(deps);
  await coordinator.open(data.root.id);
  const css = "--vscode-editorWidget-background:#1f1f1f;--vscode-button-secondaryBackground:#3d3d3d;--vscode-button-secondaryForeground:#ededed;--vscode-button-secondaryHoverBackground:#505050;--vscode-button-hoverBackground:#00539f;--vscode-input-border:#777777;--vscode-list-hoverBackground:#353535;--vscode-toolbar-hoverBackground:#353535;--vscode-badge-background:#404040;--vscode-badge-foreground:#ededed;--vscode-textLink-foreground:#85c4ff;--vscode-icon-foreground:#ededed;--vscode-charts-green:#89d185;--vscode-charts-blue:#85c4ff;--vscode-charts-orange:#ffc679;--vscode-errorForeground:#ff9999;--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#ededed;--vscode-foreground:#ededed;--vscode-descriptionForeground:#c0c0c0;--vscode-sideBar-background:#252526;--vscode-widget-border:#656565;--vscode-focusBorder:#6db9ff;--vscode-button-background:#005fb8;--vscode-button-foreground:#ffffff;--vscode-input-background:#1f1f1f;--vscode-input-foreground:#ededed;--vscode-font-family:Arial,sans-serif;--vscode-font-size:13px";
  html = html.replace("<head>", `<head><style>:root{${css}}</style>`);
  const server = http.createServer((request, response) => {
    if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await page.exposeFunction("fixtureHostMessage", (message) => receive(message));
    await page.addInitScript(() => {
      if (window !== window.top) return;
      let stored = {};
      window.acquireVsCodeApi = () => ({ getState: () => stored, setState: (state) => { stored = state; }, postMessage: (message) => window.fixtureHostMessage(message) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".department-roster").waitFor();
    assert.match(await page.locator(".department-occupancy").innerText(), /组长 未知\/4 · 员工 未知\/20/);
    assert.equal(await page.locator('[data-action="acceptancePlan"]').count(), 0);
    assert.match(await page.locator("#taskPanelSlot").innerText(), /统一验收方案（只读）/);
    const parentScroll = await page.locator(".main").evaluate((element) => { element.scrollTop = 120; return element.scrollTop; });
    const opener = page.locator(`[data-department-task-id="${data.leader.id}"]`).first();
    await opener.click();
    const frameHandle = await page.locator("#departmentChatContent iframe").elementHandle({ timeout: 10000 });
    const frame = await frameHandle.contentFrame(); await frame.locator(".department-roster").waitFor();
    assert.match(await frame.locator("#panelHeading").innerText(), /组长 👨🏻/);
    assert.match(await frame.locator(".department-roster").innerText(), /真实员工/);
    assert.match(await frame.locator("#taskPanelSlot").innerText(), /继承产研部统一验收方案[\s\S]*根固化快照/);
    assert.equal(await frame.locator('[data-action="acceptancePlan"]').count(), 0);
    const binding = deps.panelsByTaskId.get(data.root.id).getDepartmentModalTarget();
    await frame.locator('[data-action="askMainModel"]').click();
    await frame.locator("#askChatInput").fill("只问当前组长"); await frame.locator("#askChatSend").click();
    await frame.waitForFunction(() => document.body.innerText.includes("记录驱动的组长回答"), null, { timeout: 5000 });
    assert.deepEqual(effects, [["ask", data.leader.id]]);
    assert.ok(messages.some((message) => message.instanceId === binding.instanceId && message.taskId === data.leader.id && message.message?.type === "loopGroupChatChat:askThread"));
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), true);
    await page.waitForTimeout(250); // Capture after the incumbent dialog entrance animation.
    await page.screenshot({ path: path.join(output, "coordinator-leader-ask.png"), fullPage: true });
    await frame.locator("#askChatClose").click();
    const before = messages.length; data.leader.updatedAt += 10; coordinator.refreshOpenPanelForTask(data.leader.id);
    await page.waitForTimeout(100);
    assert.ok(messages.slice(before).some((message) => message.instanceId === binding.instanceId && message.message?.type === "loopGroupChatChat:contentPatch"));
    await frame.locator(`[data-department-task-id="${data.root.id}"]`).first().click();
    await page.waitForFunction(() => !document.getElementById("departmentChatBackdrop").classList.contains("visible"));
    assert.equal(await page.locator(".main").evaluate((element) => element.scrollTop), parentScroll);
    assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
    assert.ok(!effects.some(([action]) => action === "stop"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    const result = { scenario: "coordinator-record-fixtures", status: "passed", binding, parentScroll, effects, warnings, errors,
      checks: ["unknown-capacity", "read-only-root-plan", "record-hierarchy", "bound-leader-ask", "leader-refresh-without-panel", "return-closes-only", "parent-scroll-and-focus"],
      boundary: "Mock VS Code and task record ports; not a real Extension Development Host or organization launch" };
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } catch (error) {
    fs.writeFileSync(path.join(output, "failure.json"), JSON.stringify({ errors, effects, warnings, messages: messages.map(({ html, ...message }) => message), frames: await Promise.all(page.frames().map(async (frame) => ({ url: frame.url(), text: await frame.locator("body").innerText().catch(() => "unavailable") }))) }, null, 2));
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
    throw error;
  } finally { await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
