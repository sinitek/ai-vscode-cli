/* Real installed VS Code Extension Host plus its Chromium Webview. Uses only a private HOME/workspace. */
"use strict";
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const product = path.resolve(__dirname, "..");
const timeout = Number(process.env.SINITEK_DEPARTMENT_HOST_TIMEOUT_MS || 90000);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function vscodeExecutable() {
  if (process.env.SINITEK_VSCODE_EXE) return process.env.SINITEK_VSCODE_EXE;
  if (process.platform === "darwin") return "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe");
  return "/usr/share/code/code";
}

function remainingProcesses(pid, root) {
  if (process.platform === "win32") {
    const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Cannot verify VS Code process exit: ${result.stderr}`);
    const value = JSON.parse(result.stdout);
    return (Array.isArray(value) ? value : [value]).filter((item) => item.CommandLine?.includes(root));
  }
  const result = cp.spawnSync("ps", ["-axo", "pid=,pgid=,stat=,command="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Cannot verify VS Code process exit: ${result.stderr}`);
  return result.stdout.split("\n").filter((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return match && !match[3].includes("Z") && (Number(match[2]) === pid || match[4].includes(root));
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function workspaceKey(workspace) {
  const name = path.basename(workspace).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 32) || "workspace";
  return `${name}_${crypto.createHash("sha256").update(workspace).digest("hex").slice(0, 12)}`;
}

async function seedPrivateFixture({ root, home, workspace }) {
  require(path.join(product, "dist/test/vscodeMock.js")).installVscodeMock();
  const { createDepartmentConversationHostFixture } = require(path.join(product, "dist/test/extensionHost/fixtures/departmentconversationhostfixture.js"));
  const { createDepartmentProductionTaskStore } = require(path.join(product, "dist/extensionHost/departmentProductionTaskStore.js"));
  const { prepareDepartmentTaskRecord } = require(path.join(product, "dist/extensionHost/departmentOwnedTaskRepository.js"));
  const { createLoopPlusScheduler } = require(path.join(product, "dist/loopPlusScheduler.js"));
  const { writeSessionFile, writeMessageFile } = require(path.join(product, "dist/sessionStore.js"));
  const fixtureWorkspaceKey = workspaceKey(workspace);
  const fixture = createDepartmentConversationHostFixture(fixtureWorkspaceKey, crypto.randomBytes(4).toString("hex"));
  const communicationDir = path.join(root, "fixture-communication");
  const transcript = path.join(communicationDir, `${fixture.ids.rootTaskId}.md`);
  fs.mkdirSync(communicationDir, { recursive: true });
  fs.writeFileSync(transcript, "# 隔离部门历史\n\n总监和两位组长的已完成验证记录。\n", { flag: "wx" });
  for (const task of [fixture.root, fixture.leaderOne, fixture.leaderTwo]) {
    task.communicationDir = communicationDir;
    task.mainCommunicationFile = transcript;
  }
  fixture.leaderOne.loopPlus = createLoopPlusScheduler({ maxConcurrency: 4 }).snapshot();
  fixture.leaderTwo.loopPlus = createLoopPlusScheduler({ maxConcurrency: 4 }).snapshot();
  const store = createDepartmentProductionTaskStore(path.join(home, ".sinitek_cli", "department-tasks-v1"));
  try {
    store.create(prepareDepartmentTaskRecord(fixture.root, fixture.root.department,
      fixture.root.loopPlusAcceptancePlan));
    store.create(prepareDepartmentTaskRecord(fixture.leaderOne, fixture.leaderOne.department,
      fixture.leaderOne.loopPlusAcceptancePlan));
    store.create(prepareDepartmentTaskRecord(fixture.leaderTwo, fixture.leaderTwo.department,
      fixture.leaderTwo.loopPlusAcceptancePlan));
  } finally {
    const closed = await store.close();
    if (!closed) throw new Error("Fixture owner did not release normally");
  }
  const messageOptions = { activeWorkspaceKey: fixtureWorkspaceKey, workspaceKeyFallback: "workspace", legacyMessageDir: path.join(home, ".sinitek_cli", "messages"), messageDirRoot: path.join(home, ".sinitek_cli", "messages") };
  const messages = new Map([
    [fixture.ids.directorSessionId, [{ id: "director-message", role: "user", content: "已完成的部门历史记录", taskRole: "main", loopTaskId: fixture.ids.rootTaskId, actions: [fixture.directorMessageAction] }]],
    [fixture.ids.leaderOneSessionId, [{ id: "leader-one-message", role: "user", content: "已完成的同名模块会话一", taskRole: "main", loopTaskId: fixture.ids.leaderOneTaskId }]],
    [fixture.ids.leaderTwoSessionId, [{ id: "leader-two-message", role: "user", content: "已完成的同名模块会话二", taskRole: "main", loopTaskId: fixture.ids.leaderTwoTaskId }]],
    [fixture.ids.employeeSessionId, [{ id: "employee-message", role: "user", content: "已完成员工子任务历史", taskRole: "subtask", loopTaskId: fixture.ids.leaderOneTaskId, loopSubtaskId: fixture.ids.employeeSubtaskId, loopRound: 1 }]],
    [fixture.ids.ordinarySessionId, [{ id: "ordinary-message", role: "user", content: "普通会话历史" }]],
  ]);
  const now = Date.now();
  const taskSummaries = ["统筹部门模块并完成交付", `组长 · ${fixture.ids.moduleTitle}`, `组长 · ${fixture.ids.moduleTitle}`,
    `员工 · ${fixture.leaderOne.subTasks[0].title}`];
  const sessionRecord = (id, label) => ({ id, label, firstPrompt: label, createdAt: now, lastUsedAt: now });
  const sessionStore = Object.fromEntries(["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"].map((cli) => [cli, { currentId: null, sessions: [] }]));
  const sessionIds = [fixture.ids.directorSessionId, fixture.ids.leaderOneSessionId, fixture.ids.leaderTwoSessionId, fixture.ids.employeeSessionId, fixture.ids.ordinarySessionId];
  const originalSessionLabels = ["Codex", "Codex2", "Codex3", "Codex4", "Codex5"];
  sessionStore.codex = { currentId: fixture.ids.directorSessionId, sessions: sessionIds.map((id, index) => ({
    ...sessionRecord(id, originalSessionLabels[index]),
    ...(index === 0 ? { taskSummary: taskSummaries[0], taskSummaryAttempted: true } : {}),
  })) };
  const dataDir = path.join(home, ".sinitek_cli");
  const sessionOptions = { workspaceKeyFallback: "workspace", legacySessionFile: path.join(dataDir, "sessions.json"), sessionDir: path.join(dataDir, "sessions") };
  writeSessionFile(sessionStore, fixtureWorkspaceKey, sessionOptions);
  for (const [sessionId, items] of messages) {
    assert.equal(writeMessageFile("codex", sessionId, items, messageOptions), true, `persist messages for ${sessionId}`);
  }
  const tabs = sessionIds.map((sessionId, index) => ({
    id: `host-tab-${index + 1}`,
    cli: "codex",
    sessionId,
    sessionIdByCli: { codex: sessionId },
    createdAt: now + index,
  }));
  const settings = {
    currentCli: "codex",
    interactiveModeByCli: { codex: "coding" },
    conversationTabs: { activeTabId: tabs[0].id, tabs },
  };
  const workspaceSettingsDir = path.join(dataDir, "workspace-settings");
  fs.mkdirSync(workspaceSettingsDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceSettingsDir, `${fixtureWorkspaceKey}.json`), JSON.stringify(settings, null, 2), { flag: "wx" });
  return { workspaceKey: fixtureWorkspaceKey, fixture, sessionIds, taskSourceRoot: path.join(dataDir, "department-tasks-v1"),
    sessionStorePath: path.join(dataDir, "sessions", `${fixtureWorkspaceKey}.json`), originalSessionLabels, taskSummaries };
}

function extensionTestEntry({ root, manifest, home }) {
  const file = path.join(root, "extension-host-test.js");
  fs.writeFileSync(file, `
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
exports.run = async () => {
  const root = ${JSON.stringify(root)};
  const expectedHome = fs.realpathSync(${JSON.stringify(home)});
  if (fs.realpathSync(require('node:os').homedir()) !== expectedHome) throw new Error('Extension Host HOME is not isolated');
  let extension;
  const activationDeadline = Date.now() + 60000;
  while (Date.now() < activationDeadline) {
    extension = vscode.extensions.getExtension(${JSON.stringify(`${manifest.publisher}.${manifest.name}`)});
    if (extension?.isActive) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!extension?.isActive) throw new Error('Product was not automatically activated');
  await vscode.commands.executeCommand('sinitek-cli-tools.openPanel');
  fs.writeFileSync(path.join(root, 'host-ready.json'), JSON.stringify({ vscode: vscode.version, extensionPath: extension.extensionPath }));
  const until = Date.now() + ${timeout - 15000};
  while (Date.now() < until && !fs.existsSync(path.join(root, 'host-finish.signal'))) await new Promise(resolve => setTimeout(resolve, 100));
  if (!fs.existsSync(path.join(root, 'host-finish.signal'))) throw new Error('Browser verification did not finish');
};
`);
  return file;
}

async function waitForHostDebugger(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return await response.json();
    } catch { /* VS Code is still starting. */ }
    await pause(200);
  }
  throw new Error("VS Code Chromium debugging endpoint did not become available");
}

async function verifyWebview(root, port, fixture, report) {
  const playwrightPath = process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright";
  const { chromium } = require(playwrightPath);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  report.chromiumVersion = browser.version();
  const workbenchDeadline = Date.now() + 10000;
  let workbenchPage;
  while (Date.now() < workbenchDeadline && !workbenchPage) {
    workbenchPage = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().startsWith("vscode-file:"));
    if (!workbenchPage) await pause(100);
  }
  if (!workbenchPage) throw new Error("Playwright did not expose the VS Code workbench page");
  await workbenchPage.setViewportSize({ width: 1280, height: 900 });
  workbenchPage.on("pageerror", (error) => report.webviewErrors.push(error.message));
  workbenchPage.on("console", (message) => { if (message.type() === "error") report.webviewErrors.push(message.text()); });
  const { default: WebSocket } = await import("node:ws").catch(() => ({ default: globalThis.WebSocket }));
  if (!WebSocket) throw new Error("Node WebSocket is required to inspect VS Code's isolated Webview target");
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  report.chromiumVersion = version.Browser || report.chromiumVersion;
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const errors = [];
  let onDebuggerPaused;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result || {});
    } else if (message.method) {
      events.push(message);
      if (message.method === "Debugger.paused" && onDebuggerPaused) void onDebuggerPaused(message);
      if (/Runtime\.exceptionThrown|Log\.entryAdded/.test(message.method)) errors.push(message.params?.exceptionDetails?.text || message.params?.entry?.text || message.method);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, 10000).unref?.();
  });
  let targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const workbenchTarget = targets.find((item) => item.type === "page" && item.url.startsWith("vscode-file:"));
  if (!workbenchTarget) throw new Error("VS Code workbench Chromium target did not appear");
  if (workbenchPage.url() !== workbenchTarget.url) throw new Error("Playwright page and Chromium workbench target disagree");
  const targetDeadline = Date.now() + 30000;
  let target;
  while (Date.now() < targetDeadline && !target) {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    target = targets.find((item) => item.type === "iframe" && item.url.includes("purpose=webviewView") && item.url.includes("sinitek-cli-tools"));
    if (!target) await pause(250);
  }
  if (!target) {
    fs.writeFileSync(path.join(root, "webview-target-diagnostics.json"), JSON.stringify(targets, null, 2));
    socket.close();
    throw new Error(`Production Webview CDP target did not appear: ${JSON.stringify(targets)}`);
  }
  const { sessionId } = await send("Target.attachToTarget", { targetId: target.id, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Log.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  const frameTree = await send("Page.getFrameTree", {}, sessionId);
  const appFrameId = frameTree.frameTree.childFrames?.find((item) => item.frame.name === "active-frame")?.frame.id;
  if (!appFrameId) throw new Error("VS Code Webview shell did not expose its production active-frame");
  const contextDeadline = Date.now() + 10000;
  let appContextId;
  while (Date.now() < contextDeadline && !appContextId) {
    appContextId = events.find((event) => event.method === "Runtime.executionContextCreated" && event.sessionId === sessionId && event.params.context.auxData?.isDefault === true && event.params.context.auxData?.frameId === appFrameId)?.params.context.id;
    if (!appContextId) await pause(50);
  }
  if (!appContextId) throw new Error("Production active-frame execution context did not initialize");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, contextId: appContextId, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Webview evaluation failed");
    return result.result?.value;
  };
  const waitFor = async (expression, label, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await pause(100); }
    if (label === "tab renderer") {
      const diagnostics = await evaluate("({ url: location.href, readyState: document.readyState, text: document.body?.innerText, html: document.body?.innerHTML?.slice(0, 30000), frames: Array.from(document.querySelectorAll('iframe'), el => ({ id: el.id, src: el.getAttribute('src'), className: el.className, ready: el.contentDocument?.readyState, text: el.contentDocument?.body?.innerText?.slice(0, 1000) })) })").catch((error) => ({ error: String(error) }));
      const frameTree = await send("Page.getFrameTree", {}, sessionId).catch((error) => ({ error: String(error) }));
      fs.writeFileSync(path.join(root, "webview-renderer-diagnostics.json"), JSON.stringify({ target, diagnostics, frameTree, events: events.slice(-30) }, null, 2));
      await screenshot("webview-renderer-timeout.png").catch(() => undefined);
    }
    throw new Error(`Timed out waiting for production Webview ${label}`);
  };
  const screenshot = async (name) => {
    await workbenchPage.screenshot({ path: path.join(root, name), fullPage: true });
  };
  await waitFor("document.querySelectorAll('.conversation-tab').length > 0", "tab renderer");
  const expectedLabels = ["☀️ Codex", "🌛 Codex2", "🌛 Codex3", "⭐️ Codex4", "Codex5"];
  const currentTabIndex = async () => evaluate(`(() => { const label=document.querySelector('.conversation-tab-label')?.textContent.trim() || ''; return ${JSON.stringify(expectedLabels)}.indexOf(label); })()`);
  const goToTab = async (index) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await currentTabIndex();
      if (current === index) return;
      const direction = current < index ? "next" : "prev";
      const moved = await evaluate(`(() => { const button=document.querySelector('.conversation-tabs-nav-${direction}'); if (!button) return false; button.click(); return true; })()`);
      if (!moved) throw new Error(`Conversation tab pager cannot reach index ${index} from ${current}`);
      await pause(100);
    }
    throw new Error(`Conversation tab pager did not reach index ${index}`);
  };
  const labels = [];
  for (let index = 0; index < 5; index++) {
    await goToTab(index);
    const label = await evaluate("document.querySelector('.conversation-tab-label')?.textContent.trim() || ''");
    labels.push(label);
    assert.equal(label, expectedLabels[index], `tab ${index} preserves its original CLI title and only adds the role icon`);
    assert.equal(await evaluate("document.querySelector('.conversation-tab').getAttribute('aria-label')"), expectedLabels[index],
      `tab ${index} accessible title preserves the original CLI name`);
  }
  assert.notEqual(labels[1], labels[2], "same-title leaders preserve distinct original CLI tab names");
  const focus = async () => {
    await evaluate("document.querySelector('.conversation-tab').focus()");
    await pause(1100);
  };
  const tooltip = async () => evaluate("document.querySelector('#conversationTabSummaryTooltip')?.innerText || ''");
  await goToTab(0); await focus();
  const directorTooltip = await tooltip();
  assert.equal(directorTooltip, fixture.taskSummaries[0]);
  await screenshot("webview-desktop.png");
  for (const index of [1, 2, 3]) {
    await goToTab(index); await focus();
    const fullTooltip = await tooltip();
    assert.equal(fullTooltip, fixture.taskSummaries[index], `tooltip for tab ${index}`);
  }
  if (process.argv.includes("--task-summaries-only")) {
    report.webviewErrors.push(...errors.filter((message) => !message.includes("Unrecognized feature: 'local-network-access'.")));
    assert.deepEqual(report.webviewErrors, [], `Webview errors: ${JSON.stringify(report.webviewErrors)}`);
    report.browser = { status: "passed", labels, assertions: ["restored director summary and complete leader and employee member titles"] };
    socket.close();
    await browser.close();
    return;
  }
  const clickTab = async (index) => { await goToTab(index); await evaluate("document.querySelector('.conversation-tab').click()"); };
  const mode = async () => evaluate("document.querySelector('#interactiveModeSelect')?.value");
  await clickTab(1); assert.equal(await mode(), "loop_plus");
  await clickTab(3); assert.equal(await mode(), "coding");
  await clickTab(0); assert.equal(await mode(), "department");
  await goToTab(2); await evaluate("document.querySelector('.conversation-tab').focus()");
  await workbenchPage.keyboard.press("Enter");
  assert.equal(await evaluate("document.querySelector('.conversation-tab').getAttribute('aria-selected')"), "true");
  await clickTab(0); assert.equal(await mode(), "department");
  const attachedWebviews = new Map();
  const inspectWebviewTarget = async (candidate) => {
    let attached = attachedWebviews.get(candidate.id);
    if (!attached) {
      const candidateSession = (await send("Target.attachToTarget", { targetId: candidate.id, flatten: true })).sessionId;
      await send("Runtime.enable", {}, candidateSession); await send("Page.enable", {}, candidateSession);
      const candidateTree = await send("Page.getFrameTree", {}, candidateSession);
      const candidateFrameId = candidateTree.frameTree.childFrames?.find((item) => item.frame.name === "active-frame")?.frame.id;
      const deadline = Date.now() + 3000;
      let contextId;
      while (Date.now() < deadline && !contextId) {
        contextId = events.find((event) => event.method === "Runtime.executionContextCreated" && event.sessionId === candidateSession
          && event.params.context.auxData?.isDefault === true && event.params.context.auxData?.frameId === candidateFrameId)?.params.context.id;
        if (!contextId) await pause(50);
      }
      if (!contextId) return { candidate, candidateSession, contextId: null, text: "" };
      attached = { candidate, candidateSession, contextId, frameId: candidateFrameId };
      attachedWebviews.set(candidate.id, attached);
    }
    const result = await send("Runtime.evaluate", { expression: "document.body?.innerText || ''", contextId: attached.contextId, returnByValue: true }, attached.candidateSession);
    return { ...attached, candidate, text: result.result?.value || "" };
  };
  let groupWebview;
  const candidateSummaries = new Map();
  let visibleWebviews = [];
  const groupDeadline = Date.now() + 20000;
  while (Date.now() < groupDeadline && !groupWebview) {
    const currentTargets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    visibleWebviews = await workbenchPage.evaluate(() => Array.from(document.querySelectorAll("iframe")).map((frame) => {
      const rect = frame.getBoundingClientRect();
      const url = new URL(frame.src || "about:blank", location.href);
      return { id: url.searchParams.get("id"), src: frame.src, title: frame.title, visible: rect.width > 0 && rect.height > 0
        && getComputedStyle(frame).display !== "none" && getComputedStyle(frame).visibility !== "hidden",
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } };
    }).filter((frame) => frame.id));
    const candidates = currentTargets.filter((item) => item.type === "iframe" && item.url.includes("vscode-webview")
      && item.url.includes("sinitek-cli-tools") && item.id !== target.id);
    for (const candidate of candidates) {
      const inspected = await inspectWebviewTarget(candidate);
      const webviewId = new URL(candidate.url).searchParams.get("id");
      const surface = visibleWebviews.find((item) => item.id === webviewId);
      candidateSummaries.set(candidate.id, { id: candidate.id, webviewId, url: candidate.url, visibleSurface: surface ?? null, text: inspected.text.slice(0, 1200) });
      if (surface?.visible && inspected.text.includes("产研部群聊") && inspected.text.includes(fixture.ids.rootTaskId)) {
        groupWebview = inspected; break;
      }
    }
    if (!groupWebview) await pause(200);
  }
  const groupTarget = groupWebview?.candidate;
  const groupSession = groupWebview?.candidateSession;
  const groupContextId = groupWebview?.contextId;
  if (!groupTarget) {
    const currentTargets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    fs.writeFileSync(path.join(root, "group-chat-target-diagnostics.json"), JSON.stringify({ currentTargets, visibleWebviews, candidateSummaries: [...candidateSummaries.values()],
      activeTab: await evaluate("document.querySelector('.conversation-tab')?.getAttribute('aria-label')"), panelBody: await evaluate("document.body?.innerText?.slice(0, 1200)") }, null, 2));
    throw new Error("Director group-chat panel did not project its root task into a production Webview");
  }
  if (!groupContextId) throw new Error("Production group-chat panel Webview did not initialize");
  const groupEvaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, contextId: groupContextId, returnByValue: true, awaitPromise: true }, groupSession);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Group-chat Webview evaluation failed");
    return result.result?.value;
  };
  const groupWaitFor = async (expression, label, ms = 15000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (await groupEvaluate(expression)) return; await pause(100); }
    if (label === "leader department dialog" || label === "leader srcdoc frame") {
      const diagnostics = await groupEvaluate("({ url: location.href, text: document.body?.innerText, modal: document.querySelector('#departmentChatBackdrop')?.outerHTML?.slice(0, 4000), status: { text: document.querySelector('#departmentChatStatus')?.textContent, hidden: document.querySelector('#departmentChatStatus')?.hidden }, frames: Array.from(document.querySelectorAll('#departmentChatContent iframe'), el => ({ title: el.title, src: el.src, ready: el.contentDocument?.readyState, frameName: el.name })), actions: Array.from(document.querySelectorAll('[data-action]'), el => ({ action: el.getAttribute('data-action'), taskId: el.getAttribute('data-department-task-id'), text: el.innerText, disabled: el.disabled })) })").catch((error) => ({ error: String(error) }));
      const frameTree = await send("Page.getFrameTree", {}, groupSession).catch((error) => ({ error: String(error) }));
      const messageTrace = await groupEvaluate("window.__departmentHostMessageTrace || null").catch((error) => ({ error: String(error) }));
      fs.writeFileSync(path.join(root, "department-dialog-diagnostics.json"), JSON.stringify({ groupTarget, groupContextId, diagnostics, frameTree, messageTrace, events: events.slice(-80) }, null, 2));
      await screenshot("webview-department-dialog-timeout.png").catch(() => undefined);
    }
    throw new Error(`Timed out waiting for production group-chat Webview ${label}`);
  };
  await groupWaitFor("document.querySelectorAll('[data-action=\\\"openDepartmentTask\\\"]').length > 0", "leader cards");
  const leaderButtonSelector = `[data-action="openDepartmentTask"][data-department-task-id="${fixture.ids.leaderOneTaskId}"]`;
  const clickGroupControl = async (selector) => {
    const rect = await groupEvaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element?.checkVisibility() || element.closest('[inert]')) return null; const r=element.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height, viewportWidth:innerWidth, viewportHeight:innerHeight }; })()`);
    assert.ok(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0
      && rect.left + rect.width <= rect.viewportWidth + 1 && rect.top + rect.height <= rect.viewportHeight + 1,
      `the actual group-chat control is visible and reachable: ${selector}`);
    const shell = await workbenchPage.evaluate((id) => {
      const frame=Array.from(document.querySelectorAll('iframe')).find(element => { try { return new URL(element.src).searchParams.get('id') === id; } catch { return false; } });
      const r=frame?.getBoundingClientRect(); return r && { left:r.left, top:r.top };
    }, new URL(groupTarget.url).searchParams.get("id"));
    assert.ok(shell, "the visible control belongs to the selected workbench Webview");
    await workbenchPage.mouse.click(shell.left + rect.left + rect.width / 2, shell.top + rect.top + rect.height / 2);
  };
  // A non-zero position distinguishes genuine restoration from an accidental reset to the top.
  await groupEvaluate("(() => { const main=document.querySelector('.main'); main.scrollTop=Math.min(120, main.scrollHeight-main.clientHeight); })()");
  const sidebarHidden = await groupEvaluate("document.querySelector('#panelSidebar')?.inert === true");
  if (sidebarHidden) await clickGroupControl("#sidebarToggle");
  await groupEvaluate(`document.querySelector(${JSON.stringify(leaderButtonSelector)})?.scrollIntoView({block:'nearest'})`);

  assert.equal(await groupEvaluate(`document.querySelectorAll(${JSON.stringify(leaderButtonSelector)}).length`), 1,
    "director group chat exposes the exact intended leader task");
  // The production API is frozen. Observe calls through CDP instead of silently failing to replace postMessage.
  const outgoingMessages = [];
  const observationErrors = [];
  await send("Debugger.enable", {}, groupSession);
  const apiFunction = await send("Runtime.evaluate", { expression: "vscode.postMessage", contextId: groupContextId }, groupSession);
  assert.ok(apiFunction.result?.objectId, "the observer uses the production active-frame API function");
  const observer = await send("Debugger.setBreakpointOnFunctionCall", { objectId: apiFunction.result.objectId }, groupSession);
  onDebuggerPaused = async (event) => {
    if (event.sessionId !== groupSession) return;
    try {
      assert.ok(event.params.hitBreakpoints?.includes(observer.breakpointId), "only the API observation breakpoint may pause the panel");
      const call = await send("Debugger.evaluateOnCallFrame", { callFrameId: event.params.callFrames[0].callFrameId,
        expression: "JSON.stringify(arguments[0])", returnByValue: true }, groupSession);
      if (call.exceptionDetails) throw new Error("Cannot observe production postMessage arguments");
      outgoingMessages.push(JSON.parse(call.result.value));
    } catch (error) { observationErrors.push(String(error)); }
    finally { await send("Debugger.resume", {}, groupSession); }
  };
  await groupEvaluate("(() => { window.__departmentHostMessageTrace={incoming:[]}; window.addEventListener('message', event => { const data=event.data; window.__departmentHostMessageTrace.incoming.push({ type:data?.type, taskId:data?.taskId, instanceId:data?.instanceId, htmlLength:data?.html?.length || 0, origin:event.origin, owningShell:isLoopGroupChatHostMessage(event) }); }, true); })()");
  const beforeDialog = await groupEvaluate(`(() => { const button=document.querySelector(${JSON.stringify(leaderButtonSelector)}); const scroller=document.querySelector('.main') || document.scrollingElement; window.__departmentHostTestOpener=button; return { openerKey: button?.getAttribute('data-department-nav-key'), scrollTop: scroller?.scrollTop ?? 0, scrollHeight: scroller?.scrollHeight ?? 0 }; })()`);
  assert.equal(beforeDialog.openerKey, `leader:${fixture.ids.leaderOneTaskId}`, "the intended leader navigation button is recorded as the modal opener");
  assert.ok(beforeDialog.scrollTop > 0, "the controlled director history is read at a non-zero scroll position");
  await clickGroupControl(leaderButtonSelector);
  await groupWaitFor("document.querySelector('#departmentChatBackdrop.visible')", "leader department dialog");
  assert.equal(await groupEvaluate("document.activeElement?.id"), "departmentChatClose", "opening the modal moves focus to its close control");
  await groupWaitFor("(() => { const status=document.querySelector('#departmentChatStatus'); const frame=document.querySelector('#departmentChatContent iframe'); return Boolean(status?.hidden && frame && frame.title); })()", "leader srcdoc frame");
  const modalFrameDeadline = Date.now() + 15000;
  let modalFrame;
  let modalFrameTree;
  const modalSessions = new Map();
  while (Date.now() < modalFrameDeadline && !modalFrame) {
    modalFrameTree = await send("Page.getFrameTree", {}, groupSession);
    const frames = [];
    const visit = (node) => { frames.push(node.frame); for (const child of node.childFrames || []) visit(child); };
    visit(modalFrameTree.frameTree);
    let frame = frames.find((item) => item.url === "about:srcdoc");
    if (!frame) {
      // OOPIFs can be absent from the parent Page tree; require their precise product-frame parent.
      const childTargets = (await send("Target.getTargets")).targetInfos.filter((item) => item.type === "iframe"
        && item.url === "about:srcdoc" && item.parentFrameId === groupWebview.frameId && item.parentId === groupTarget.id);
      assert.ok(childTargets.length <= 1, "the selected modal owns at most one sandboxed srcdoc target");
      if (childTargets[0]) frame = { id: childTargets[0].targetId, url: childTargets[0].url, parentId: childTargets[0].parentFrameId };
    }
    if (frame) {
      // The opaque sandbox may be an out-of-process iframe. Follow its exact frame ID, never a title.
      let context = events.findLast((event) => event.method === "Runtime.executionContextCreated"
        && event.params.context.auxData?.isDefault === true && event.params.context.auxData?.frameId === frame.id);
      if (!context && !modalSessions.has(frame.id)) {
        const childSession = (await send("Target.attachToTarget", { targetId: frame.id, flatten: true })).sessionId;
        modalSessions.set(frame.id, childSession);
        await send("Runtime.enable", {}, childSession);
        await send("Log.enable", {}, childSession);
        context = events.findLast((event) => event.method === "Runtime.executionContextCreated" && event.sessionId === childSession
          && event.params.context.auxData?.isDefault === true && event.params.context.auxData?.frameId === frame.id);
      }
      if (context) modalFrame = { frame, contextId: context.params.context.id, sessionId: context.sessionId };
    }
    if (!modalFrame) await pause(100);
  }
  if (!modalFrame) {
    fs.writeFileSync(path.join(root, "department-srcdoc-diagnostics.json"), JSON.stringify({ groupTarget, groupContextId,
      frameTree: modalFrameTree, targets: await send("Target.getTargets"), events: events.slice(-100) }, null, 2));
    await screenshot("webview-srcdoc-context-timeout.png");
  }
  assert.ok(modalFrame, "the modal's actual sandboxed srcdoc execution context loaded");
  const modalEvaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, contextId: modalFrame.contextId, returnByValue: true, awaitPromise: true }, modalFrame.sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Embedded leader Webview evaluation failed");
    return result.result?.value;
  };
  await groupWaitFor("document.querySelector('#departmentChatContent iframe')?.contentWindow !== null", "leader iframe presence");
  const modalReadyDeadline = Date.now() + 15000;
  let modalDetails;
  while (Date.now() < modalReadyDeadline) {
    modalDetails = await modalEvaluate("(() => ({ title: document.title, text: document.body?.innerText || '', taskId: document.querySelector('[data-department-task-id]')?.getAttribute('data-department-task-id') || '', role: document.body?.className || '', toolbar: document.querySelector('#panelActions')?.innerText || '', loopPlus: document.querySelector('[data-loop-plus-mode]')?.getAttribute('data-loop-plus-mode') || '', actions: Array.from(document.querySelectorAll('#panelActions [data-action]'), el => ({ action: el.getAttribute('data-action'), disabled: el.disabled })) }))()");
    if (modalDetails.text.includes(fixture.ids.leaderOneTaskId) && modalDetails.loopPlus === "event_driven") break;
    await pause(100);
  }
  assert.ok(modalDetails?.text.includes(fixture.ids.leaderOneTaskId), "embedded group-chat content identifies the exact selected leader task");
  assert.ok(modalDetails.text.includes("财务模块"), "embedded group-chat content identifies the selected leader module");
  assert.equal(modalDetails.loopPlus, "event_driven", "the selected leader's actual Loop+ projection is rendered");
  assert.ok(modalDetails.toolbar.length > 0, "the existing panel action bar is rendered in the embedded leader view");
  assert.ok(modalDetails.actions.some((item) => item.action === "refresh"), "the applicable department action remains present");
  assert.equal(modalDetails.actions.some((item) => item.action === "stopTask" || item.action === "supplementTask" || item.action === "continueTask"), false,
    "completed historical fixture keeps non-applicable run actions unavailable");
  const dialogTitle = await groupEvaluate("document.querySelector('#departmentChatTitle')?.textContent || ''");
  assert.equal(dialogTitle, "组长1", "department modal title identifies the selected leader by module number");
  report.modal = { frameUrl: modalFrame.frame.url, leaderTaskId: fixture.ids.leaderOneTaskId, title: dialogTitle,
    context: { groupContextId, frameId: modalFrame.frame.id, contextId: modalFrame.contextId, defaultWorld: true }, loopPlus: modalDetails.loopPlus, toolbar: modalDetails.toolbar, actions: modalDetails.actions };
  await screenshot("webview-department-dialog.png");
  await clickGroupControl("#departmentChatClose");
  await groupWaitFor("!document.querySelector('#departmentChatBackdrop.visible')", "director dialog close");
  assert.equal(await groupEvaluate("document.querySelector('#departmentChatBackdrop.visible')"), null,
    "closing the modal returns to the director group-chat page without stopping the task");
  const closeMessages = outgoingMessages.filter((message) => message?.type === "loopGroupChatChat:departmentModal" && message.action === "close");
  assert.equal(closeMessages.length, 1, "closing the dialog releases its single display subscription");
  const stopMessages = outgoingMessages.filter((message) => /(?:stopTask|stopLoop|stopTaskTree)/i.test(message?.type || "") || /^(?:stop|cancel)$/.test(message?.action || ""));
  assert.deepEqual(stopMessages, [], "closing the dialog sends no task stop or cancellation request");
  assert.deepEqual(observationErrors, [], "all production API calls were observed without altering messages");
  const loadMessages = outgoingMessages.filter((message) => message?.type === "loopGroupChatChat:departmentModal" && message.action === "load");
  assert.equal(loadMessages.length, 1, "the selected leader has a single load subscription");
  assert.equal(loadMessages[0].taskId, fixture.ids.leaderOneTaskId);
  assert.equal(closeMessages[0].instanceId, loadMessages[0].instanceId, "close releases the exact loaded display instance");
  report.modal.messageEvidence = { load: loadMessages[0], close: closeMessages[0], stopMessages,
    incoming: await groupEvaluate("window.__departmentHostMessageTrace.incoming") };
  await send("Debugger.removeBreakpoint", { breakpointId: observer.breakpointId }, groupSession);
  await send("Debugger.disable", {}, groupSession);
  onDebuggerPaused = undefined;
  const afterDialog = await groupEvaluate("(() => { const button=document.activeElement; const scroller=document.querySelector('.main') || document.scrollingElement; return { openerKey: button?.getAttribute('data-department-nav-key'), sameOpener: button === window.__departmentHostTestOpener, scrollTop: scroller?.scrollTop ?? 0, scrollHeight: scroller?.scrollHeight ?? 0 }; })()");
  report.modal.focusAndReadingPosition = { before: beforeDialog, after: afterDialog };
  await screenshot("webview-department-dialog-closed.png");
  assert.equal(afterDialog.openerKey, beforeDialog.openerKey, "closing the dialog restores focus to the opening leader button");
  assert.equal(afterDialog.sameOpener, true, "the exact opening button receives focus after close");
  assert.equal(afterDialog.scrollTop, beforeDialog.scrollTop, "closing the dialog preserves the director page reading position");
  const mainWebviewId = new URL(target.url).searchParams.get("id");
  const surfaceGeometry = () => workbenchPage.evaluate((webviewId) => {
    const host = Array.from(document.querySelectorAll("iframe")).find((frame) => {
      try { return new URL(frame.src, location.href).searchParams.get("id") === webviewId; } catch { return false; }
    })?.getBoundingClientRect();
    const parts = Array.from(document.querySelectorAll(".part.sidebar, .part.auxiliarybar"));
    const part = host && parts.find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && host.left >= rect.left - 2 && host.right <= rect.right + 2;
    });
    const rect = part?.getBoundingClientRect();
    const geometry = (value) => value && { left: value.left, right: value.right, width: value.width, top: value.top, bottom: value.bottom, height: value.height };
    return { screen: { width: innerWidth, height: innerHeight }, sidebar: geometry(rect), sidebarClass: part?.className,
      webview: geometry(host) };
  }, mainWebviewId);
  const initialSurface = await surfaceGeometry();
  assert.ok(initialSurface.sidebar && initialSurface.webview, "the exact production Webview is located inside its real workbench sidebar");
  const rightSidebar = initialSurface.sidebar.left > initialSurface.screen.width / 2;
  const boundaryX = rightSidebar ? initialSurface.sidebar.left : initialSurface.sidebar.right;
  const sashBounds = await workbenchPage.evaluate((boundaryX) => {
    const candidates = Array.from(document.querySelectorAll(".monaco-sash.vertical")).map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, element };
    }).filter((item) => Math.abs((item.left + item.right) / 2 - boundaryX) < 12 && item.bottom - item.top > 100)
      .sort((a, b) => Math.abs((a.left + a.right) / 2 - boundaryX) - Math.abs((b.left + b.right) / 2 - boundaryX))[0];
    return candidates ? { x: (candidates.left + candidates.right) / 2, y: Math.min(candidates.bottom - 20, Math.max(candidates.top + 20, innerHeight / 2)) } : null;
  }, boundaryX);
  if (!sashBounds) throw new Error("Cannot locate the exact production Webview sidebar resize sash");
  const targetSurfaceWidth = 280;
  const narrowBoundary = rightSidebar ? initialSurface.sidebar.right - targetSurfaceWidth : initialSurface.sidebar.left + targetSurfaceWidth;
  await workbenchPage.mouse.move(sashBounds.x, sashBounds.y);
  await workbenchPage.mouse.down();
  await workbenchPage.mouse.move(narrowBoundary, sashBounds.y, { steps: 12 });
  await workbenchPage.mouse.up();
  await pause(500);
  await clickTab(0); await focus();
  const narrowGeometry = await surfaceGeometry();
  const narrowViewport = await evaluate("({ innerWidth, innerHeight, documentWidth: document.documentElement.clientWidth, bodyWidth: document.body.clientWidth })");
  report.narrow = { requestedSurfaceWidth: targetSurfaceWidth, initialSurface, screenGeometry: narrowGeometry, webviewViewport: narrowViewport };
  await screenshot("webview-narrow-measured.png");
  assert.ok(narrowGeometry.webview?.left >= 0 && narrowGeometry.webview.right <= narrowGeometry.screen.width + 1
    && narrowGeometry.webview.top >= 0 && narrowGeometry.webview.bottom <= narrowGeometry.screen.height + 1,
    "the complete measured Webview iframe lies inside the visible workbench");
  assert.ok(Math.abs(narrowGeometry.webview.width - narrowViewport.innerWidth) <= 2,
    "the visible iframe width and the product execution context viewport agree");
  assert.ok(narrowGeometry.webview?.width >= 250 && narrowGeometry.webview.width <= 330,
    `the selected production Webview iframe is narrow (measured ${narrowGeometry.webview?.width}px)`);
  assert.ok(narrowViewport.innerWidth >= 250 && narrowViewport.innerWidth <= 330,
    `the actual Webview viewport is narrow (measured ${narrowViewport.innerWidth}px)`);
  const narrowTabGeometry = await evaluate("(() => { const tab=document.querySelector('.conversation-tab')?.getBoundingClientRect(); const root=document.querySelector('.conversation-tabs')?.getBoundingClientRect(); return { tab: tab && { left: tab.left, right: tab.right, width: tab.width }, tabs: root && { left: root.left, right: root.right, width: root.width } }; })()");
  report.narrow.tabGeometry = narrowTabGeometry;
  assert.ok(narrowTabGeometry.tab && narrowTabGeometry.tabs && narrowTabGeometry.tab.left >= narrowTabGeometry.tabs.left - 1
    && narrowTabGeometry.tab.right <= narrowTabGeometry.tabs.right + 1, "narrow tab remains visible inside the measured tab surface");
  for (const [index, expectedLabel] of [[0, expectedLabels[0]], [1, expectedLabels[1]], [2, expectedLabels[2]], [3, expectedLabels[3]]]) {
    await goToTab(index);
    const visible = await evaluate("(() => { const el=document.querySelector('.conversation-tab'); return { text: el.innerText, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; })()");
    assert.equal(visible.text.split("\n")[0].trim(), expectedLabel, `narrow tab ${index} keeps its original title and role icon`);
    assert.ok(visible.scrollWidth <= visible.clientWidth + 1, `narrow tab ${index} does not overflow its track`);
  }
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1"), true);
  await goToTab(1); await focus();
  const narrowTooltip = await tooltip();
  assert.equal(narrowTooltip, fixture.taskSummaries[1], "narrow Webview tooltip retains the full member title");
  report.narrow.tooltip = narrowTooltip;
  await screenshot("webview-narrow-leader-tooltip.png");
  await goToTab(0);
  await screenshot("webview-narrow-surface.png");
  report.webviewErrors.push(...errors.filter((message) => !message.includes("Unrecognized feature: 'local-network-access'.")));
  assert.deepEqual(report.webviewErrors, [], `Webview errors: ${JSON.stringify(report.webviewErrors)}`);
  report.browser = { status: "passed", targetUrl: target.url, targetId: target.id, labels, errors,
    assertions: ["actual production state restored from owned task/session stores", "three role icons preserve original Codex/Codex2/Codex3/Codex4 tab names and ordinary Codex5 title", "same-title leaders retain their original distinct tab names", "director session summary and full member title tooltips at desktop and measured narrow surface", "department/Loop+/coding modes", "keyboard focus and tab activation", "director group-chat WebviewPanel loads the exact leader's sandboxed srcdoc and Loop+ action bar", "dialog close restores opener focus and reading position", `measured ${narrowViewport.innerWidth}px actual Webview viewport, tab bounds, and page overflow`] };
  report.browser.cdpEvents = events.filter((event) => event.method === "Runtime.exceptionThrown" || (event.method === "Log.entryAdded" && event.params.entry?.level === "error")).length;
  socket.close();
  await browser.close();
}

async function main() {
  const root = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "sinitek-dept-conversation-"));
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  const port = await freePort();
  const report = { root, product, workspace, port, platform: process.platform,
    scope: "Installed production VS Code Extension Host, owned task/session persistence, real panel state and embedded Chromium Webview; no CLI/model execution", webviewErrors: [] };
  let child, exited = false, forced = false;
  console.log(`Artifacts: ${root}`);
  try {
    const code = vscodeExecutable();
    assert.ok(fs.existsSync(code), `Installed VS Code missing: ${code}`);
    assert.ok(fs.existsSync(path.join(product, "dist/extension.js")), "Build an isolated source copy before this check");
    const manifest = JSON.parse(fs.readFileSync(path.join(product, "package.json"), "utf8"));
    assert.ok(manifest.activationEvents.includes("onStartupFinished"));
    fs.mkdirSync(workspace, { recursive: true });
    for (const dir of [home, path.join(home, ".sinitek_cli"), path.join(root, "user-data/User"), path.join(root, "extensions")]) fs.mkdirSync(dir, { recursive: true });
    const clis = ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"];
    fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({ humanInteractionEnabled: false,
      autoCompactContextAfterRun: false, memoryAutoExtractAfterCompact: false, memoryAutoExtractAfterLoopTask: false,
      cliEnabledByName: Object.fromEntries(clis.map((cli) => [cli, false])) }));
    fs.writeFileSync(path.join(root, "user-data/User/settings.json"), JSON.stringify({
      "workbench.startupEditor": "none", "security.workspace.trust.enabled": false, "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false, "update.mode": "none", "telemetry.telemetryLevel": "off", "window.restoreWindows": "none",
      "sinitek-cli-tools.autoOpenPanel": false, "sinitek-cli-tools.humanInteractionNotifications": false,
      ...Object.fromEntries(clis.map((cli) => [`sinitek-cli-tools.commands.${cli}`, process.execPath])),
    }));
    const fixtureFile = path.join(root, "seeded-fixture.json");
    const seedEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex") };
    const seededProcess = cp.spawnSync(process.execPath, [__filename, "--seed", root, home, workspace, fixtureFile], {
      env: seedEnv, encoding: "utf8", timeout: 30000,
    });
    assert.equal(seededProcess.status, 0, `Private production fixture seeding failed: ${seededProcess.stderr || seededProcess.stdout}`);
    const seeded = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
    assert.equal(fs.existsSync(path.join(seeded.taskSourceRoot, ".department-owner.json")), false,
      "preseed repository writer closed and released its owner marker before Extension Host startup");
    report.fixture = { workspaceKey: seeded.workspaceKey, ids: seeded.fixture.ids, ownerReleasedBeforeHost: true };
    const testEntry = extensionTestEntry({ root, manifest, home });
    const env = Object.fromEntries(["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"]
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"), CODEX_HOME: path.join(home, ".codex") });
    const args = ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust",
      "--use-inmemory-secretstorage", "--log=trace", `--remote-debugging-port=${port}`, "--remote-allow-origins=*",
      `--user-data-dir=${path.join(root, "user-data")}`, `--extensions-dir=${path.join(root, "extensions")}`,
      `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${testEntry}`, workspace];
    report.launch = { code, args, home };
    const output = fs.openSync(path.join(root, "vscode.log"), "w");
    child = cp.spawn(code, args, { env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", output, output] });
    fs.closeSync(output);
    child.once("exit", (code, signal) => { exited = true; report.exit = { code, signal }; });
    child.once("error", (error) => { exited = true; report.spawnError = error.message; });
    const deadline = Date.now() + timeout;
    while (!exited && Date.now() < deadline && !fs.existsSync(path.join(root, "host-ready.json"))) await pause(200);
    assert.ok(!exited, `VS Code exited before panel was opened: ${JSON.stringify(report.exit || report.spawnError)}`);
    assert.ok(fs.existsSync(path.join(root, "host-ready.json")), "Extension test entry did not open the production panel");
    report.host = JSON.parse(fs.readFileSync(path.join(root, "host-ready.json"), "utf8"));
    assert.equal(fs.realpathSync(report.host.extensionPath), fs.realpathSync(product));
    await waitForHostDebugger(port, Math.min(deadline, Date.now() + 30000));
    await verifyWebview(root, port, seeded.fixture, report);
    fs.writeFileSync(path.join(root, "host-finish.signal"), "verified\n", { flag: "wx" });
    while (!exited && Date.now() < deadline) await pause(200);
    assert.ok(exited, "VS Code did not shut down after Extension Host tests completed");
    assert.equal(report.exit?.code, 0, JSON.stringify(report.exit || report.spawnError));
    let remaining = remainingProcesses(child.pid, root);
    const drainUntil = Date.now() + 10000;
    while (remaining.length && Date.now() < drainUntil) { await pause(200); remaining = remainingProcesses(child.pid, root); }
    report.remaining = remaining;
    assert.deepEqual(remaining, [], "Isolated VS Code processes remain after normal test shutdown");
    const owner = path.join(seeded.taskSourceRoot, ".department-owner.json");
    report.ownerMarkerRemaining = fs.existsSync(owner);
    assert.equal(report.ownerMarkerRemaining, false, "Production owner marker was not released on normal Extension Host exit");
    report.normalExit = true;
    const persistedSessionStore = JSON.parse(fs.readFileSync(seeded.sessionStorePath, "utf8"));
    const persistedLabels = persistedSessionStore.codex.sessions.map((session) => session.label);
    assert.deepEqual(persistedLabels, seeded.originalSessionLabels, "Role icons must not change persisted session labels");
    report.persistedSessionLabels = persistedLabels;
    report.browser.assertions.push("original Codex/Codex2/Codex3/Codex4/Codex5 session labels remain unchanged in production persistence");
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.stack || String(error); process.exitCode = 1;
    console.error(report.error);
  } finally {
    if (!exited && fs.existsSync(root)) fs.writeFileSync(path.join(root, "host-finish.signal"), "failure cleanup\n");
    if (child?.pid) {
      try {
        const shutdownDeadline = Date.now() + 20000;
        while (!exited && Date.now() < shutdownDeadline) await pause(200);
        let remaining = remainingProcesses(child.pid, root);
        if (!exited || remaining.length) {
          forced = true;
          if (process.platform === "win32") cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
          else process.kill(-child.pid, "SIGTERM");
          for (let i = 0; i < 50 && remainingProcesses(child.pid, root).length; i++) await pause(100);
          remaining = remainingProcesses(child.pid, root);
          if (remaining.length && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          report.remainingAfterCleanup = remainingProcesses(child.pid, root);
        }
      } catch (error) { report.cleanupError = String(error); }
    }
    report.forcedCleanup = forced;
    if (forced) { report.ok = false; process.exitCode = 1; }
    const ownerPath = path.join(home, ".sinitek_cli/department-tasks-v1/.department-owner.json");
    report.ownerMarkerAtFinish = fs.existsSync(ownerPath);
    if (!report.ok && fs.existsSync(path.join(root, "vscode.log"))) report.outputTail = fs.readFileSync(path.join(root, "vscode.log"), "utf8").slice(-12000);
    fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}

if (process.argv[2] === "--seed") {
  seedPrivateFixture({ root: process.argv[3], home: process.argv[4], workspace: process.argv[5] })
    .then((seeded) => fs.writeFileSync(process.argv[6], JSON.stringify({ workspaceKey: seeded.workspaceKey, fixture: { ids: seeded.fixture.ids, taskSummaries: seeded.taskSummaries },
      taskSourceRoot: seeded.taskSourceRoot, sessionStorePath: seeded.sessionStorePath, originalSessionLabels: seeded.originalSessionLabels,
      sessionIds: seeded.sessionIds }, null, 2), { flag: "wx" }))
    .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
} else {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
