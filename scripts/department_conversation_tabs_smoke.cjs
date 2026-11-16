const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const dist = path.resolve(process.env.DEPARTMENT_TABS_DIST || path.join(__dirname, "../dist"));
const output = path.resolve(process.env.DEPARTMENT_TABS_EVIDENCE || "/tmp/sinitek-loop-round26-evidence");
const deltaOnly = process.env.DEPARTMENT_TABS_DELTA_ONLY === "1";
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright");
require(path.join(dist, "test/vscodeMock.js")).installVscodeMock();
const { getWebviewHtml } = require(path.join(dist, "webview/viewContent.js"));
const { projectDepartmentConversationTab, projectDepartmentEmployeeConversationTab } = require(path.join(dist, "extensionHost/departmentConversationTabs.js"));
fs.mkdirSync(output, { recursive: true });

const rootId = "department-root-20261113-abcdef01";
const leaderId = "department-leader-20261113-12345678";
const employeeId = "employee-subtask-20261113-87654321";
const longModule = "产研部统一核心模块与真实会话映射的特别长模块名称用于检查窄屏省略行为";
const metadata = (taskId, role, moduleId, title) => ({ version: 1, rootTaskId: rootId,
  parentTaskId: role === "director" ? null : rootId, leaderSubtaskId: moduleId, role, moduleTitle: title,
  routes: { director: {}, leader: {}, employee: {} }, limits: { maxLeaders: 4, maxEmployees: 20 } });
const makeTask = (id, title) => ({ id, cli: "codex", workspaceKey: "workspace-smoke", taskStoreFile: "/tasks.json",
  rootPrompt: title, status: "running", createdAt: 1, updatedAt: 1, maxRounds: 20, currentRound: 1,
  communicationDir: "/tasks", mainCommunicationFile: "/tasks/main.md", sessionId: `${id}-session`,
  subTasks: [], rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [], schedulingMode: "event_driven" });
const rootTask = makeTask(rootId, "产研部统一任务总览");
rootTask.department = { ...metadata(rootId, "director", null, "产研部统一任务总览"), rootTaskId: rootId };
rootTask.schedulingMode = "classic";
rootTask.subTasks = [{ id: "module-smoke", title: longModule, status: "running" }];
const leaderTask = makeTask(leaderId, longModule);
leaderTask.department = metadata(leaderId, "leader", "module-smoke", longModule);
leaderTask.subTasks = [{ id: employeeId, title: "员工真实会话", status: "running",
  executionSession: { cli: "codex", sessionId: "employee-session", configId: null } }];
const tasksById = new Map([[rootId, rootTask], [leaderId, leaderTask]]);
const messages = [{ id: "employee-message", role: "user", content: "work", taskRole: "subtask",
  loopTaskId: leaderId, loopSubtaskId: employeeId, loopRound: 1 }];
const ownershipPort = { readTaskRecord: (id) => tasksById.get(id) ?? null,
  readDepartmentLeaderTaskIds: (root, module) => root === rootId && module === "module-smoke" ? [leaderId] : [] };
const projectedTabs = [
  projectDepartmentConversationTab({ id: "director-tab", cli: "codex", sessionId: `${rootId}-session`, createdAt: 1, loopTaskRole: "main", loopTaskId: rootId }, rootTask, [], ownershipPort),
  projectDepartmentConversationTab({ id: "leader-tab", cli: "codex", sessionId: `${leaderId}-session`, createdAt: 2, loopTaskRole: "main", loopTaskId: leaderId }, leaderTask, [], ownershipPort),
  projectDepartmentEmployeeConversationTab({ id: "employee-tab", cli: "codex", sessionId: "employee-session", createdAt: 3, loopTaskRole: "subtask", loopTaskId: leaderId }, leaderTask, messages, ownershipPort),
];
const tabs = [
  { ...projectedTabs[0], loopSchedulingMode: "classic", loopTaskRunning: true },
  { ...projectedTabs[1], loopSchedulingMode: "event_driven" },
  { ...projectedTabs[2], loopSchedulingMode: "event_driven", loopTaskRunning: true },
  { id: "ordinary-tab", cli: "codex", sessionId: "ordinary-session", createdAt: 4, taskSummary: "普通会话原有 tooltip" },
];

const payload = {
  currentCli: "codex", interactiveMode: "coding", conversationTabs: { activeTabId: "director-tab", tabs },
  sessionState: { currentSessionId: "director-session", sessions: [] },
  configState: { configs: [], activeConfigId: null }, configStateByCli: {},
  chatMessageLimit: deltaOnly ? 48 : 100, loopGroupChatMessageLimit: 100, promptHistory: [], humanInteractionHistory: [],
  scheduledTasks: [], loopPlusAcceptancePlans: [], loopPlusAcceptancePlanSelection: "", cliEnabledByName: {},
  loopEnabled: true, loopPlusEnabled: true, departmentEnabled: true,
  rulePaths: { global: {}, project: {} }, interactive: { supported: true, enabled: true },
};

const css = `:root{--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#ededed;--vscode-foreground:#ededed;--vscode-editorWidget-background:#252526;--vscode-editorWidget-foreground:#ededed;--vscode-editorGroupHeader-tabsBackground:#252526;--vscode-tab-activeBackground:#1f1f1f;--vscode-tab-activeForeground:#ffffff;--vscode-tab-hoverBackground:#343434;--vscode-toolbar-hoverBackground:#343434;--vscode-widget-border:#666;--vscode-input-border:#666;--vscode-widget-shadow:#0008;--vscode-textLink-foreground:#8cc8ff;--vscode-focusBorder:#77bbff;--vscode-descriptionForeground:#bdbdbd;--vscode-errorForeground:#ff7777;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-font-family:Arial,sans-serif;--vscode-font-size:13px}body.vscode-light{--vscode-editor-background:#fff;--vscode-editor-foreground:#222;--vscode-foreground:#222;--vscode-editorWidget-background:#f3f3f3;--vscode-editorWidget-foreground:#222;--vscode-editorGroupHeader-tabsBackground:#ececec;--vscode-tab-activeBackground:#fff;--vscode-tab-activeForeground:#111;--vscode-tab-hoverBackground:#e8e8e8;--vscode-toolbar-hoverBackground:#e8e8e8;--vscode-widget-border:#aaa;--vscode-input-border:#aaa;--vscode-widget-shadow:#0003;--vscode-textLink-foreground:#005fb8;--vscode-focusBorder:#005fb8;--vscode-descriptionForeground:#555;--vscode-errorForeground:#b00020}`;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const html = getWebviewHtml({ cspSource: "'self'" }).replace("<head>", `<head><style>${css}</style>`);
  const server = http.createServer((_request, response) => { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await page.addInitScript(() => {
      window.__postedMessages = [];
      let saved = {};
      window.acquireVsCodeApi = () => ({ getState: () => saved, setState: (value) => { saved = value; }, postMessage: (message) => window.__postedMessages.push(message) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), payload);
    await page.locator(".conversation-tab").first().waitFor();
    if (deltaOnly) {
      const directorMessages = Array.from({ length: 49 }, (_, index) => ({ id: `director-message-${index + 1}`, role: index % 2 ? "assistant" : "user", content: `总监历史消息 ${index + 1}`, createdAt: index + 1 }));
      await page.evaluate((messages) => window.postMessage({ type: "setMessages", tabId: "director-tab", messages }, "*"), directorMessages);
      await page.getByText("总监历史消息 49", { exact: true }).waitFor();
      await page.waitForFunction(() => window.__postedMessages.some((message) => message.type === "pruneChatMessages" && message.tabId === "director-tab"));
      const pruneRequest = await page.evaluate(() => window.__postedMessages.filter((message) => message.type === "pruneChatMessages" && message.tabId === "director-tab").at(-1));
      assert.ok(pruneRequest.messages.length > 0, "49 messages cross the 48-message retention threshold and queue pruning");
      assert.ok(await page.locator("#messages .message").count() < 49, "old unprotected entries leave the visible batch while pruning is pending");
      const leaderPayload = { ...payload, conversationTabs: { activeTabId: "leader-tab", tabs } };
      const employeePayload = { ...payload, conversationTabs: { activeTabId: "employee-tab", tabs } };
      await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), leaderPayload);
      await page.getByText("正在加载对话").waitFor();
      await page.evaluate(() => window.postMessage({ type: "setMessages", tabId: "leader-tab", messages: [{ id: "leader-only", role: "assistant", content: "组长专属会话消息", createdAt: 50 }] }, "*"), null);
      await page.getByText("组长专属会话消息", { exact: true }).waitFor();
      await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), employeePayload);
      await page.getByText("正在加载对话").waitFor();
      await page.waitForTimeout(30);
      const prunedDirectorMessages = directorMessages.filter((message) => !new Set(pruneRequest.messages.map((item) => item.id)).has(message.id));
      await page.evaluate(({ requestId, messages }) => window.postMessage({ type: "chatMessagesPruned", requestId, tabId: "director-tab", messages }, "*"),
        { requestId: pruneRequest.requestId, messages: prunedDirectorMessages });
      await page.evaluate(() => window.postMessage({ type: "setMessages", tabId: "leader-tab", messages: [{ id: "leader-late", role: "assistant", content: "组长迟到的旧批次", createdAt: 52 }] }, "*"));
      await page.evaluate(() => window.postMessage({ type: "setMessages", tabId: "employee-tab", messages: [{ id: "employee-only", role: "assistant", content: "员工专属会话消息", createdAt: 51 }] }, "*"));
      await page.getByText("员工专属会话消息", { exact: true }).waitFor();
      await page.waitForTimeout(80);
      assert.equal(await page.getByText("总监历史消息 49", { exact: true }).count(), 0, "old role-tab transcript is cleared after rapid role switches");
      assert.equal(await page.getByText("组长专属会话消息", { exact: true }).count(), 0, "previous role-tab response does not pollute the active transcript");
      assert.equal(await page.locator("#messages .message").count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: path.join(output, "tabs-delta-employee-active.png"), fullPage: true });
      const webviewErrors = await page.evaluate(() => window.__postedMessages.filter((message) => message.type === "webviewError"));
      assert.deepEqual(webviewErrors, []);
      assert.deepEqual(errors, []);
      assert.equal(await page.getByText("正在加载对话").count(), 0, "loading state disappears after active tab messages arrive");
      const result = { status: "passed", mode: "merged-ui-delta", viewportChecks: [1280], serverPort: server.address().port, screenshots: fs.readdirSync(output).filter((name) => name.endsWith(".png")), checks: ["49 messages cross the 48-message retention threshold", "async prune request queued", "late inactive-tab message and prune responses do not pollute active transcript", "loading placeholder disappears after active batch", "no webview/browser errors"], boundary: "Generated full webview runtime with fixture PanelState and realistic setMessages/pruneChatMessages host messages; no extension-host session store/CLI is exercised" };
      fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      return;
    }
    await page.evaluate(() => window.postMessage({ type: "runStatus", status: "start", tabId: "employee-tab" }, "*"));
    await page.waitForTimeout(400);
    assert.equal(await page.locator(".conversation-tab").count(), 4);
    const expectedRoleLabels = ["👴🏻 Codex", "👨🏻 Codex2", "👶🏻 Codex3"];
    for (const [index, expected] of expectedRoleLabels.entries()) {
      const visibleLabel = await page.locator(".conversation-tab-label").nth(index).textContent();
      assert.equal(visibleLabel, expected,
        "department role decorates the existing CLI session label only");
      assert.doesNotMatch(visibleLabel, /总监|组长|员工|abcdef01|12345678|87654321/u,
        "role names and task IDs stay out of the visible label");
    }
    assert.equal(await page.locator(".conversation-tab").nth(0).locator(".conversation-tab-close").isDisabled(), true);
    assert.equal(await page.locator(".conversation-tab").nth(2).locator(".conversation-tab-close").isDisabled(), true);
    assert.equal(await page.locator(".conversation-tab-label").nth(3).textContent(), "Codex4");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const tooltipExpectations = [
      [0, ["总监", "产研部统一任务总览", rootId]],
      [1, ["组长", longModule, rootId, leaderId]],
      [2, ["员工", longModule, rootId, leaderId, employeeId]],
    ];
    for (const [index, expectedParts] of tooltipExpectations) {
      await page.locator(".conversation-tab").nth(index).focus();
      await page.waitForTimeout(350);
      const tooltip = await page.locator("#conversationTabSummaryTooltip").innerText();
      for (const part of expectedParts) assert.ok(tooltip.includes(part), `tooltip includes ${part}`);
      assert.ok(await page.locator(".conversation-tab").nth(index).getAttribute("aria-describedby"));
    }
    await page.screenshot({ path: path.join(output, "tabs-desktop-dark.png"), fullPage: true });

    for (const [name, className] of [["light", "vscode-light"], ["dark", "vscode-dark"]]) {
      await page.locator("body").evaluate((body, theme) => { body.className = theme; }, className);
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(output, `tabs-desktop-${name}.png`), fullPage: true });
    }

    const modeSelect = page.locator("#interactiveModeSelect");
    await page.locator(".conversation-tab").nth(1).click();
    assert.equal(await modeSelect.inputValue(), "loop_plus");
    await page.locator(".conversation-tab").nth(2).click();
    assert.equal(await modeSelect.inputValue(), "coding");
    await page.locator(".conversation-tab").nth(0).click();
    assert.equal(await modeSelect.inputValue(), "department");
    await page.locator(".conversation-tab").nth(2).focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".conversation-tab").nth(2).getAttribute("aria-selected"), "true");
    assert.equal(await modeSelect.inputValue(), "coding");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "tab");
    const beforeRoleChange = await modeSelect.inputValue();
    const changedTabs = tabs.map((tab) => tab.id === "employee-tab"
      ? { ...tab, loopTaskRole: "main", departmentPresentation: { role: "leader", rootTaskId: rootId, taskId: leaderId, moduleTitle: longModule } }
      : tab);
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), { ...payload, conversationTabs: { activeTabId: "employee-tab", tabs: changedTabs } });
    assert.equal(beforeRoleChange, "coding");
    await page.waitForFunction(() => document.getElementById("interactiveModeSelect").value === "loop_plus", null, { timeout: 3000 });
    assert.equal(await modeSelect.inputValue(), "loop_plus", "role identity update on the same tab is applied");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "tab", "rerender restores tab focus");

    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), payload);
    await page.setViewportSize({ width: 280, height: 800 });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), true);
    for (const [index, expectedLabel, fullIds] of [
      [0, expectedRoleLabels[0], ["总监", "产研部统一任务总览", rootId]],
      [1, expectedRoleLabels[1], ["组长", longModule, rootId, leaderId]],
      [2, expectedRoleLabels[2], ["员工", longModule, rootId, leaderId, employeeId]],
    ]) {
      const visible = page.locator(".conversation-tab").first();
      assert.equal(await visible.locator(".conversation-tab-label").textContent(), expectedLabel);
      assert.equal(await visible.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
      await visible.focus(); await page.waitForTimeout(350);
      const tooltip = await page.locator("#conversationTabSummaryTooltip").innerText();
      for (const expectedPart of fullIds) assert.ok(tooltip.includes(expectedPart), `tooltip includes ${expectedPart}`);
      await page.screenshot({ path: path.join(output, `tabs-mobile-dark-${index}.png`), fullPage: true });
      if (index < 2) await page.locator(".conversation-tabs-nav-next").click();
    }
    await page.locator("body").evaluate((body) => { body.className = "vscode-light"; });
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(output, "tabs-mobile-light.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), true);
    const webviewErrors = await page.evaluate(() => window.__postedMessages.filter((message) => message.type === "webviewError"));
    assert.deepEqual(webviewErrors, []);
    assert.deepEqual(errors, []);
    const result = { status: "passed", mode: "full-existing-smoke", viewportChecks: [1280, 280], themes: ["dark", "light"], screenshots: fs.readdirSync(output).filter((name) => name.endsWith(".png")),
      checks: ["role icons decorate unchanged Codex/Codex2/Codex3 labels", "role names and task IDs stay out of visible labels", "long module truncation", "full hierarchy and identity tooltips", "ordinary tab label", "department/Loop+/coding mode switching with enabled modes", "same-tab role update", "keyboard focus and selection", "close/run lock", "horizontal overflow"],
      errors, webviewErrors, boundary: "Generated full webview runtime with a fixture PanelState and VS Code API bridge; does not verify real CLI organization startup" };
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    fs.writeFileSync(path.join(output, "failure.json"), JSON.stringify({ errors, pageErrors: await page.locator("body").innerText().catch(() => "unavailable") }, null, 2));
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
    throw error;
  } finally {
    await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
