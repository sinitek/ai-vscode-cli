"use strict";

/*
 * macOS Loop+ 定向场景：同一成员第二轮返工，群聊面板保持打开。
 *
 * 私有目录编译当前候选（含 lp609 的 replacesAttemptId），隔离 Extension Host
 * 确认 extensionPath 与激活。合成执行器走生产适配器 runEventDriven 和
 * createLoopPlusPersistedTaskRefresher，刷新回调接到真实群聊面板。
 * 工作台证据只读真实 Webview DOM，不调用投影、不改 DOM、不发手动 refresh。
 *
 * 复用部门全量宿主的隔离启动参数和 Playwright CDP Webview 读取方式。
 */

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function vscodeExecutable() {
  if (process.env.SINITEK_VSCODE_EXE) return process.env.SINITEK_VSCODE_EXE;
  if (process.platform === "darwin") return "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
  return "";
}

function processesFor(token, pid) {
  const result = cp.spawnSync("ps", ["-axo", "pid=,pgid=,ppid=,stat=,command="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`无法核对本次进程：${result.stderr}`);
  return result.stdout.split("\n").filter((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match || match[4].includes("Z")) return false;
    return Number(match[2]) === pid || match[5].includes(token);
  });
}

async function runInsideHost() {
  const vscode = require("vscode");
  const root = process.env.LOOP_PLUS_REPAIR_MEMBER_ROOT;
  const extension = vscode.extensions.getExtension(process.env.LOOP_PLUS_REPAIR_MEMBER_EXTENSION_ID);
  const extensionPath = extension.extensionPath;
  const dist = path.join(extensionPath, "dist");
  const projectionSource = fs.readFileSync(path.join(dist, "loopPlusPanelProjection.js"), "utf8");
  const schedulerSource = fs.readFileSync(path.join(dist, "loopPlusScheduler.js"), "utf8");
  if (!projectionSource.includes("replacesAttemptId") || !schedulerSource.includes("replacesAttemptId")) {
    throw new Error("私有候选缺少 lp609 replacesAttemptId");
  }
  const { createLoopPlusRuntimeFixture } = require(path.join(dist, "test/extensionHost/fixtures/loopPlusRuntimeFixture.js"));
  const { createLoopGroupChatPanelCoordinator } = require(path.join(dist, "extensionHost/loopGroupChatPanelCoordinator.js"));
  const { withLoopPlusAcceptReviews } = require(path.join(dist, "test/loopPlusAcceptFixture.js"));
  const { withLoopBlockerFixture } = require(path.join(dist, "test/loopBlockerFixture.js"));
  const stagePath = path.join(root, "stage.json");
  const ackPath = path.join(root, "ack.json");
  const failedPath = path.join(root, "observer-failed.json");
  let seq = 0;
  let mainBusy = false;
  let releaseRepair = () => {};
  const repairGate = new Promise((resolve) => { releaseRepair = resolve; });
  let targetStarts = 0;
  let taskId = "";
  const warnings = [];
  const panelsByTaskId = new Map();
  let coordinator;
  const fixture = createLoopPlusRuntimeFixture({
    maxConcurrency: 2,
    onTaskSurfaceRefresh: (id) => coordinator?.refreshOpenPanelForTask(id),
    onMainActivityChange: (id) => coordinator?.refreshOpenPanelForTask(id),
  });
  function decision(value) {
    const enriched = withLoopPlusAcceptReviews(withLoopBlockerFixture(value));
    if (enriched && typeof enriched === "object" && !Array.isArray(enriched)
      && enriched.status === "accept" && !Object.prototype.hasOwnProperty.call(enriched, "progressPercent")) {
      return JSON.stringify({ ...enriched, progressPercent: 30 });
    }
    return JSON.stringify(enriched);
  }
  function subtask(id, title, file) {
    return {
      id,
      title,
      taskType: "backend",
      writeFiles: [file],
      prompt: `实现${title}。只报告该成员本次执行结果，写入范围 ${file}。不要修改父任务记录、调度状态或其他成员的执行。`,
    };
  }
  function currentEventId(promptText) {
    const match = String(promptText).match(/Current review eventId: (\S+)/);
    if (!match || match[1] === "(none)") throw new Error("主回合提示缺少当前验收事件");
    return match[1];
  }
  async function publishStage(phase, extra) {
    seq += 1;
    const current = seq;
    fs.rmSync(ackPath, { force: true });
    writeJson(stagePath, { phase, seq: current, at: Date.now(), taskId, ...extra });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (fs.existsSync(failedPath)) throw new Error(`工作台观察失败：${fs.readFileSync(failedPath, "utf8")}`);
      const ack = readJson(ackPath);
      if (ack && ack.phase === phase && ack.seq === current) return ack;
      await sleep(100);
    }
    throw new Error(`工作台没有在时限内确认阶段 ${phase}`);
  }
  function runningIds() {
    return (fixture.readTask(taskId)?.loopPlus?.running ?? []).map((item) => item.subtaskId).sort();
  }
  coordinator = createLoopGroupChatPanelCoordinator({
    getExtensionUri: () => vscode.Uri.file(extensionPath),
    panelsByTaskId,
    normalizeTaskId: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizeSupplementalRequirement: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
    appendSupplementalRequirement: (items, item) => [...(items || []), item],
    appendSupplementalRequirementToCommunication: () => {},
    recordPromptHistory: () => {},
    readTaskRecord: (id) => fixture.readTask(id),
    updateTaskRecord: () => null,
    listTaskStoreFiles: () => [fixture.storeFile],
    readTaskStoreTasks: () => fixture.createdTaskIds.map((id) => fixture.readTask(id)).filter(Boolean),
    collectRunningTaskIds: () => {
      try { return new Set(fixture.adapter.host().collectRunningTaskIds()); }
      catch { return new Set(); }
    },
    readTextFileIfNonEmpty: (filePath) => {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const text = fs.readFileSync(filePath, "utf8");
      return text.trim() ? text : null;
    },
    fileExists: (filePath) => Boolean(filePath) && fs.existsSync(filePath),
    writeTextFileEnsuringDir: (filePath, content) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
      return true;
    },
    getActiveSubtaskIds: (task) => Array.isArray(task.activeSubtaskIds) ? task.activeSubtaskIds : [],
    getActiveReviewEventIds: (id) => {
      try { return fixture.adapter.host().getActiveReviewEventIds(id); }
      catch { return []; }
    },
    buildCompletedConclusionAndSummaryMarkdown: () => "",
    resolveMainPromptTarget: () => ({ tabId: fixture.target.tabId, cli: "codex" }),
    revealPanelView: async () => {},
    switchVisibleConversationTabForLoop: async () => {},
    isTabRunActive: () => mainBusy,
    getActiveConfigIdForCli: () => null,
    getSelectedCliModel: () => "sub-model",
    runLoopPrompt: async () => {},
    stopRunsForTask: () => {},
    markTaskStoppedByUser: (id) => fixture.readTask(id),
    postPanelState: async () => {},
    getActiveConversationTaskId: () => taskId || null,
    showInformationMessage: (message) => warnings.push(String(message)),
    showWarningMessage: (message) => warnings.push(String(message)),
    pickTask: async () => null,
    t: (key) => key,
  });
  fixture.setAttemptAction(async (input, tabId) => {
    if (input.loopSubtaskId === "other") {
      await new Promise(() => {});
      return;
    }
    if (input.loopSubtaskId !== "target") throw new Error(`意外成员 ${input.loopSubtaskId}`);
    targetStarts += 1;
    if (targetStarts < 3) {
      fixture.publish(input, tabId, { status: "end", content: `目标成员第 ${targetStarts} 次执行结束` });
      return;
    }
    if (targetStarts !== 3) throw new Error(`目标成员执行次数异常 ${targetStarts}`);
    await repairGate;
    fixture.publish(input, tabId, { status: "end", content: "目标成员第二轮返工执行结束" });
  });
  const failAndRedispatch = (round) => async (input, tabId) => {
    mainBusy = true;
    try {
      taskId = input.loopTaskId || taskId;
      const eventId = currentEventId(input.displayPrompt);
      if (round === 2) {
        const queued = fixture.adapter.host().submitUserMessage(taskId, "暂缓主模型领取第二轮返工复验。");
        if (!queued) throw new Error("没能在当前主回合排队暂缓消息");
      }
      fixture.publish(input, tabId, { status: "end", content: decision({
        status: "accept",
        reviewEventId: eventId,
        progressPercent: 20 + round * 10,
        reviews: [{ reviewEventId: eventId, acceptance: "failed", reason: `第 ${round} 次验收失败，进入下一轮返工`, subtaskIds: ["target"] }],
        subtasks: [subtask("target", "目标成员", "src/target.ts")],
      }) });
    } finally {
      mainBusy = false;
    }
  };
  fixture.queueMain(async (input, tabId) => {
    mainBusy = true;
    try {
      taskId = input.loopTaskId || "";
      if (!taskId) throw new Error("首个主回合没有任务 ID");
      fixture.publish(input, tabId, { status: "end", content: decision({
        status: "dispatch",
        subtasks: [subtask("target", "目标成员", "src/target.ts"), subtask("other", "对照成员", "src/other.ts")],
      }) });
    } finally {
      mainBusy = false;
    }
  });
  fixture.queueMain(failAndRedispatch(1));
  fixture.queueMain(failAndRedispatch(2));
  fixture.queueMain(async (input, tabId) => {
    mainBusy = true;
    try {
      const readyDeadline = Date.now() + 15000;
      while (targetStarts < 3 || !runningIds().includes("target") || !runningIds().includes("other")) {
        if (Date.now() > readyDeadline) throw new Error(`第二轮返工没有进入运行：starts=${targetStarts} running=${runningIds().join(",")}`);
        await sleep(50);
      }
      let openTimer;
      try {
        writeJson(path.join(root, "panel-open.json"), { at: Date.now(), taskId, targetStarts, running: runningIds() });
      await Promise.race([
          coordinator.open(taskId, { focus: true }),
          new Promise((_, reject) => { openTimer = setTimeout(() => reject(new Error("群聊面板 loadingReady 超时")), 45000); }),
        ]);
      writeJson(path.join(root, "panel-opened.json"), { at: Date.now(), panels: panelsByTaskId.size });
      } catch (error) {
        writeJson(path.join(root, "panel-open-error.json"), { error: error instanceof Error ? error.stack : String(error) });
        throw error;
      } finally {
        clearTimeout(openTimer);
      }
      if (panelsByTaskId.size !== 1) throw new Error(`群聊面板数量不是 1：${panelsByTaskId.size}`);
      await publishStage("repairing", {
        panels: panelsByTaskId.size,
        refreshes: fixture.refreshes.length,
        activeReviewEventIds: fixture.adapter.host().getActiveReviewEventIds(taskId),
      });
      const beforeRelease = fixture.refreshes.length;
      releaseRepair();
      const releaseDeadline = Date.now() + 15000;
      while (runningIds().includes("target")) {
        if (Date.now() > releaseDeadline) throw new Error("释放第二轮返工后，目标成员仍留在 running");
        await sleep(50);
      }
      const activeReviewEventIds = fixture.adapter.host().getActiveReviewEventIds(taskId);
      if (activeReviewEventIds.length !== 0) throw new Error(`暂缓期间已经领取复验：${activeReviewEventIds.join(",")}`);
      await publishStage("released", {
        panels: panelsByTaskId.size,
        refreshes: fixture.refreshes.length,
        refreshesSinceRelease: fixture.refreshes.length - beforeRelease,
        activeReviewEventIds,
      });
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "wait" }) });
    } finally {
      mainBusy = false;
    }
  });
  fixture.queueMain(async (input) => {
    mainBusy = true;
    const eventId = currentEventId(input.displayPrompt);
    const activeReviewEventIds = fixture.adapter.host().getActiveReviewEventIds(taskId);
    if (!activeReviewEventIds.includes(eventId)) throw new Error("复验回合没有活动验收事件");
    await publishStage("claimed", { panels: panelsByTaskId.size, reviewEventId: eventId, activeReviewEventIds });
    await new Promise(() => {});
  });
  const prompt = "验证同一成员第二轮返工结束后，打开的群聊从修复中变为待验收，领取复验后变为验收中。";
  const running = fixture.adapter.runEventDriven({
    displayPrompt: prompt,
    modelPrompt: prompt,
    contextTags: [],
    model: "sub-model",
    loopMainModel: "sub-model",
    loopSubtaskModel: "sub-model",
    loopMainThinkingMode: "low",
    loopSubtaskThinkingMode: "low",
  }, { schedulingMode: "event_driven" }, fixture.target);
  const failure = running.then(() => null, (error) => error);
  const started = Date.now();
  while (Date.now() - started < 120000) {
    if (fs.existsSync(failedPath)) throw new Error(`工作台观察失败：${fs.readFileSync(failedPath, "utf8")}`);
    const crashed = await Promise.race([failure.then((error) => error || "done"), sleep(200).then(() => "tick")]);
    if (crashed && crashed !== "tick" && crashed !== "done") throw crashed;
    if (readJson(ackPath)?.phase === "claimed") break;
    if (crashed === "done") await sleep(200);
  }
  if (readJson(ackPath)?.phase !== "claimed") {
    const detail = {
      taskId,
      targetStarts,
      status: fixture.readTask(taskId)?.status,
      running: taskId ? runningIds() : [],
      attempts: fixture.attemptCalls.map((item) => item.loopSubtaskId),
      warnings,
      hostMessages: fixture.hostMessages.slice(-12),
      logs: fixture.logs.slice(-20),
      prompts: fixture.mainCalls.map((item) => String(item.displayPrompt).slice(0, 240)),
    };
    throw new Error(`第二轮返工场景没有走完领取复验 ${JSON.stringify(detail)}`);
  }
  return {
    taskId,
    warnings,
    panels: panelsByTaskId.size,
    targetStarts,
    mainCalls: fixture.mainCalls.length,
    attemptCalls: fixture.attemptCalls.map((item) => item.loopSubtaskId),
    manualRefreshPostedByScenario: 0,
    candidate: {
      extensionPath,
      projectionSha256: sha256(path.join(dist, "loopPlusPanelProjection.js")),
      hasLp609Link: true,
    },
  };
}

function memberNamed(dom, title) {
  return (dom.members || []).find((item) => item.name.includes(title)) || null;
}

function assess(phase, dom) {
  const target = memberNamed(dom, "目标成员");
  const other = memberNamed(dom, "对照成员");
  const counts = dom.counts || {};
  const problems = [];
  if (!target) problems.push("缺少目标成员");
  if (!other) problems.push("缺少对照成员");
  const expect = (actual, expected, label) => {
    if (actual !== expected) problems.push(`${label}=${JSON.stringify(actual)}`);
  };
  if (phase === "repairing") {
    if (!target?.meta.includes("修复中 x2")) problems.push(`目标成员不是修复中 x2：${target?.meta}`);
    if (/待验收|验收中|验收成功/.test(target?.meta || "")) problems.push(`修复中阶段目标成员文本过早变化：${target?.meta}`);
    if (!other?.meta.includes("运行中") || other?.meta.includes("修复中")) problems.push(`对照成员不能代替目标执行：${other?.meta}`);
    expect(counts.repairing, "修复中 1", "修复中人数");
    expect(counts.queue, "待验收 0", "待验收人数");
    expect(counts.reviewing, "验收中 0", "验收中人数");
    // 主回合仍被暂缓，主任务也计为运行中；人数不包含轮次。
    expect(counts.running, "运行中 2", "运行中人数");
  } else if (phase === "released") {
    if (!target?.meta.includes("待验收 x2")) problems.push(`目标成员不是待验收 x2：${target?.meta}`);
    if (target?.meta.includes("修复中") || target?.meta.includes("验收成功") || target?.meta.includes("验收中")) problems.push(`释放后目标成员文本不对：${target?.meta}`);
    if (!other?.meta.includes("运行中")) problems.push(`对照成员状态变化：${other?.meta}`);
    expect(counts.repairing, "修复中 0", "修复中人数");
    expect(counts.queue, "待验收 1", "待验收人数");
    expect(counts.reviewing, "验收中 0", "验收中人数");
    expect(counts.running, "运行中 2", "运行中人数");
  } else if (phase === "claimed") {
    if (!target?.meta.includes("验收中 x2")) problems.push(`目标成员不是验收中 x2：${target?.meta}`);
    if (target?.meta.includes("验收成功")) problems.push("领取复验后提前显示验收成功");
    if (!other?.meta.includes("运行中")) problems.push(`对照成员状态变化：${other?.meta}`);
    expect(counts.repairing, "修复中 0", "修复中人数");
    expect(counts.queue, "待验收 0", "待验收人数");
    expect(counts.reviewing, "验收中 1", "验收中人数");
    expect(counts.running, "运行中 1", "运行中人数");
  } else problems.push(`未知阶段 ${phase}`);
  return { ok: problems.length === 0, problems, target, other, counts };
}

async function attachWebview(port, predicate, deadline) {
  const { chromium } = require(playwrightModule);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  let target;
  while (!target && Date.now() < deadline) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const candidates = targetInfos.filter((info) => {
      if (info.type !== "iframe") return false;
      try {
        const url = new URL(info.url);
        return url.protocol === "vscode-webview:" && url.searchParams.get("extensionId") === "sinitek.sinitek-cli-tools";
      } catch { return false; }
    });
    for (const candidate of candidates) {
      let attached;
      try {
        attached = await attachTarget(cdp, candidate);
        const dom = await readDom(attached);
        if (predicate(dom)) {
          target = { browser, cdp, ...attached, targetId: candidate.targetId, url: candidate.url };
          break;
        }
      } catch { /* 面板 HTML 还在替换时，下一轮再读。 */ }
      if (candidate.onMessage) cdp.off("Target.receivedMessageFromTarget", candidate.onMessage);
      if (attached?.sessionId) await cdp.send("Target.detachFromTarget", { sessionId: attached.sessionId }).catch(() => undefined);
    }
    if (!target) await sleep(150);
  }
  if (!target) {
    await cdp.detach().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw new Error("没有找到含目标成员的携宁群聊 Webview");
  }
  return {
    targetId: target.targetId,
    url: target.url,
    snapshot: () => readDom(target),
    close: async () => {
      await cdp.send("Target.detachFromTarget", { sessionId: target.sessionId }).catch(() => undefined);
      await cdp.detach().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

async function attachTarget(cdp, target) {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
  const pending = new Map();
  let nextId = 0;
  const contexts = new Map();
  const onMessage = (event) => {
    if (event.sessionId !== sessionId) return;
    let response;
    try { response = JSON.parse(event.message); } catch { return; }
    if (response.method === "Runtime.executionContextCreated") contexts.set(response.params.context.id, response.params.context);
    if (response.method === "Runtime.executionContextDestroyed") contexts.delete(response.params.executionContextId);
    if (response.method === "Runtime.executionContextsCleared") contexts.clear();
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.error) waiter.reject(new Error(response.error.message));
    else waiter.resolve(response.result || {});
  };
  cdp.on("Target.receivedMessageFromTarget", onMessage);
  target.onMessage = onMessage;
  const send = (method, params = {}) => {
    const id = ++nextId;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    return Promise.all([
      cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }),
      response,
    ]).then(([, result]) => result).finally(() => pending.delete(id));
  };
  await send("Runtime.enable");
  await send("Page.enable");
  const deadline = Date.now() + 10000;
  let context;
  while (!context && Date.now() < deadline) {
    context = [...contexts.values()].find((item) => item.auxData?.isDefault) || [...contexts.values()][0];
    if (!context) await sleep(25);
  }
  if (!context) throw new Error(`Webview ${target.targetId} 没有执行上下文`);
  return { sessionId, contextId: context.id, send };
}

async function readDom(attached) {
  const expression = `(() => {
    const text = (value) => (value || "").replace(/\\s+/g, " ").trim();
    const counts = {};
    document.querySelectorAll("[data-loop-plus-count]").forEach((element) => {
      counts[element.getAttribute("data-loop-plus-count")] = text(element.innerText);
    });
    return {
      members: Array.from(document.querySelectorAll(".roster-member-row")).map((row) => ({
        name: text(row.querySelector(".member-name") && row.querySelector(".member-name").innerText),
        meta: text(row.querySelector(".member-meta") && row.querySelector(".member-meta").innerText),
      })),
      counts,
      subtitle: text(document.querySelector("#panelSubtitle") && document.querySelector("#panelSubtitle").innerText),
      heading: text(document.querySelector("#panelHeading") && document.querySelector("#panelHeading").innerText),
    };
  })()`;
  const result = await attached.send("Runtime.evaluate", {
    expression,
    contextId: attached.contextId,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(`Webview 读取失败：${result.exceptionDetails.text}`);
  return result.result?.value || { members: [], counts: {} };
}

async function waitForDebugger(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch { /* Chromium 仍在启动。 */ }
    await sleep(200);
  }
  throw new Error("VS Code 调试端口没有启动");
}

async function waitForMatch(reader, phase, stageAt, deadline) {
  let last;
  while (Date.now() < deadline) {
    last = await reader.snapshot();
    const assessment = assess(phase, last);
    if (assessment.ok) {
      return { ...assessment, dom: last, firstSeenDelayMs: Date.now() - stageAt };
    }
    last = { ...last, problems: assessment.problems };
    await sleep(150);
  }
  return { ok: false, dom: last, problems: last?.problems || ["观察超时"], firstSeenDelayMs: Date.now() - stageAt };
}

function buildProduct(product) {
  fs.mkdirSync(product, { recursive: true });
  fs.copyFileSync(path.join(repo, "package.json"), path.join(product, "package.json"));
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(product, "node_modules"));
  fs.symlinkSync(path.join(repo, "media"), path.join(product, "media"));
  const tsc = path.join(repo, "node_modules/.bin/tsc");
  const result = cp.spawnSync(tsc, ["-p", path.join(repo, "tsconfig.json"), "--outDir", path.join(product, "dist"), "--noEmitOnError", "--pretty", "false"], {
    cwd: repo,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`私有候选编译失败\n${result.stdout}\n${result.stderr}`);
  }
  const extensionJs = path.join(product, "dist/extension.js");
  assert.equal(fs.existsSync(extensionJs), true, "私有候选没有 dist/extension.js");
  assert.equal(fs.lstatSync(path.join(product, "dist")).isSymbolicLink(), false, "私有 dist 不能是共享符号链接");
}

async function main() {
  assert.equal(process.platform, "darwin", "这个定向场景只在 macOS 上启动 Extension Host");
  const code = vscodeExecutable();
  assert.equal(fs.existsSync(code), true, `未找到 VS Code：${code}`);
  assert.equal(fs.existsSync(path.join(playwrightModule, "package.json")), true, "未找到隔离 Playwright");
  const sharedDist = path.join(repo, "dist/extension.js");
  const sharedBefore = fs.existsSync(sharedDist) ? fs.statSync(sharedDist).mtimeMs : null;
  const token = `lp670-repair-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  const product = fs.mkdtempSync(path.join("/tmp", `${token}-product-`));
  const root = fs.mkdtempSync(path.join("/tmp", `${token}-`));
  const home = path.join(root, "home");
  const report = {
    token,
    product,
    root,
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    source: {
      scenario: sha256(__filename),
      projection: sha256(path.join(repo, "src/loopPlusPanelProjection.ts")),
      scheduler: sha256(path.join(repo, "src/loopPlusScheduler.ts")),
      fixture: sha256(path.join(repo, "src/test/extensionHost/fixtures/loopPlusRuntimeFixture.ts")),
    },
  };
  let child;
  let exited = false;
  let reader;
  try {
    buildProduct(product);
    report.build = "passed";
    const manifest = JSON.parse(fs.readFileSync(path.join(product, "package.json"), "utf8"));
    for (const dir of [home, path.join(home, ".sinitek_cli"), path.join(root, "user-data/User"), path.join(root, "extensions"), path.join(root, "workspace"), path.join(root, "tmp")]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const clis = ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"];
    fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({
      humanInteractionEnabled: false,
      autoCompactContextAfterRun: false,
      memoryAutoExtractAfterCompact: false,
      memoryAutoExtractAfterLoopTask: false,
      cliEnabledByName: Object.fromEntries(clis.map((cli) => [cli, false])),
    }));
    fs.writeFileSync(path.join(root, "user-data/User/settings.json"), JSON.stringify({
      "window.title": "Sinitek isolated repair member live review",
      "workbench.startupEditor": "none",
      "security.workspace.trust.enabled": false,
      "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false,
      "update.mode": "none",
      "telemetry.telemetryLevel": "off",
      "window.restoreWindows": "none",
      "sinitek-cli-tools.autoOpenPanel": false,
      "sinitek-cli-tools.humanInteractionNotifications": false,
      ...Object.fromEntries(clis.map((cli) => [`sinitek-cli-tools.commands.${cli}`, process.execPath])),
    }));
    const testEntry = path.join(root, "extension-test.js");
    fs.writeFileSync(testEntry, `"use strict";
const fs = require("fs");
const os = require("os");
exports.run = async () => {
  const resultPath = process.env.LOOP_PLUS_REPAIR_MEMBER_RESULT;
  const readyPath = process.env.LOOP_PLUS_REPAIR_MEMBER_READY;
  try {
    const vscode = require("vscode");
    const id = process.env.LOOP_PLUS_REPAIR_MEMBER_EXTENSION_ID;
    const product = process.env.LOOP_PLUS_REPAIR_MEMBER_PRODUCT;
    const home = process.env.LOOP_PLUS_REPAIR_MEMBER_HOME;
    const until = Date.now() + 60000;
    let extension;
    while (Date.now() < until) {
      extension = vscode.extensions.getExtension(id);
      if (extension && extension.isActive) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!extension || !extension.isActive) throw new Error("onStartupFinished did not activate the product");
    if (fs.realpathSync(extension.extensionPath) !== fs.realpathSync(product)) throw new Error("activated extensionPath is not the private candidate: " + extension.extensionPath);
    if (fs.realpathSync(os.homedir()) !== fs.realpathSync(home)) throw new Error("Extension Host HOME was not isolated");
    const activation = { vscode: vscode.version, extensionId: id, extensionPath: extension.extensionPath, isActive: true, home: os.homedir() };
    fs.writeFileSync(readyPath, JSON.stringify(activation, null, 2));
    const scenario = require(process.env.LOOP_PLUS_REPAIR_MEMBER_SCENARIO);
    const outcome = await scenario.runInsideHost();
    fs.writeFileSync(resultPath, JSON.stringify({ ok: true, activation, outcome }, null, 2));
  } catch (error) {
    try { fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error: error && error.stack ? error.stack : String(error) }, null, 2)); } catch {}
    throw error;
  }
};
`);
    const port = await new Promise((resolve, reject) => {
      const server = require("node:http").createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const value = server.address().port;
        server.close(() => resolve(value));
      });
    });
    const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "LANG", "DISPLAY", "TMPDIR"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, {
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, "AppData/Roaming"),
      LOCALAPPDATA: path.join(home, "AppData/Local"),
      CODEX_HOME: path.join(home, ".codex"),
      TMPDIR: path.join(root, "tmp"),
      LOOP_PLUS_REPAIR_MEMBER_ROOT: root,
      LOOP_PLUS_REPAIR_MEMBER_PRODUCT: product,
      LOOP_PLUS_REPAIR_MEMBER_HOME: home,
      LOOP_PLUS_REPAIR_MEMBER_EXTENSION_ID: `${manifest.publisher}.${manifest.name}`,
      LOOP_PLUS_REPAIR_MEMBER_SCENARIO: __filename,
      LOOP_PLUS_REPAIR_MEMBER_READY: path.join(root, "host-ready.json"),
      LOOP_PLUS_REPAIR_MEMBER_RESULT: path.join(root, "scenario-result.json"),
    });
    const args = ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust", "--use-inmemory-secretstorage",
      `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=*",
      `--user-data-dir=${path.join(root, "user-data")}`, `--extensions-dir=${path.join(root, "extensions")}`,
      `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${testEntry}`, path.join(root, "workspace")];
    report.launch = { code, args, port };
    const output = fs.openSync(path.join(root, "vscode.log"), "w");
    child = cp.spawn(code, args, { env, detached: true, stdio: ["ignore", output, output] });
    fs.closeSync(output);
    child.once("exit", (exitCode, signal) => { exited = true; report.exit = { exitCode, signal }; });
    child.once("error", (error) => { exited = true; report.spawnError = error.message; });
    const deadline = Date.now() + 240000;
    while (!exited && Date.now() < deadline && !fs.existsSync(env.LOOP_PLUS_REPAIR_MEMBER_READY)) await sleep(200);
    if (!fs.existsSync(env.LOOP_PLUS_REPAIR_MEMBER_READY)) throw new Error(`Extension Host 没有激活：${JSON.stringify(report.exit || report.spawnError)}`);
    report.activation = readJson(env.LOOP_PLUS_REPAIR_MEMBER_READY);
    await waitForDebugger(port, Math.min(deadline, Date.now() + 30000));
    const phases = [];
    let seq = 0;
    let failure;
    while (!failure && seq < 3 && Date.now() < deadline && !exited) {
      const stage = readJson(path.join(root, "stage.json"));
      if (!stage || stage.seq === seq) {
        if (fs.existsSync(env.LOOP_PLUS_REPAIR_MEMBER_RESULT)) break;
        await sleep(100);
        continue;
      }
      if (!reader) {
        reader = await attachWebview(port, (dom) => (dom.members || []).some((item) => item.name.includes("目标成员")), Math.min(deadline, Date.now() + 30000));
        report.webview = { targetId: reader.targetId, url: reader.url };
      }
      const matched = await waitForMatch(reader, stage.phase, stage.at, Math.min(deadline, Date.now() + (stage.phase === "released" ? 8000 : 20000)));
      const phaseEvidence = {
        phase: stage.phase,
        seq: stage.seq,
        ok: matched.ok,
        problems: matched.problems,
        target: matched.target,
        other: matched.other,
        counts: matched.counts,
        firstSeenDelayMs: matched.firstSeenDelayMs,
        dom: matched.dom,
        targetId: reader.targetId,
      };
      phases.push(phaseEvidence);
      if (!matched.ok) {
        failure = `${stage.phase}：${(matched.problems || []).join("；")}`;
        writeJson(path.join(root, "observer-failed.json"), { phase: stage.phase, seq: stage.seq, failure, evidence: phaseEvidence });
        break;
      }
      if (stage.phase === "released" && matched.firstSeenDelayMs > 3500) {
        failure = `待验收出现过慢（${matched.firstSeenDelayMs}ms），不能把它当成事件推送`;
        writeJson(path.join(root, "observer-failed.json"), { phase: stage.phase, seq: stage.seq, failure, evidence: phaseEvidence });
        break;
      }
      writeJson(path.join(root, `observed-${stage.phase}.json`), phaseEvidence);
      writeJson(path.join(root, "ack.json"), { phase: stage.phase, seq: stage.seq });
      seq = stage.seq;
    }
    report.phases = phases;
    const resultDeadline = Date.now() + 20000;
    while (!exited && Date.now() < resultDeadline && !fs.existsSync(env.LOOP_PLUS_REPAIR_MEMBER_RESULT)) await sleep(200);
    report.scenario = readJson(env.LOOP_PLUS_REPAIR_MEMBER_RESULT);
    if (failure) throw new Error(failure);
    if (!report.scenario?.ok) throw new Error(report.scenario?.error || "宿主场景没有成功返回");
    if (report.webview?.targetId && new Set(phases.map((item) => item.targetId)).size !== 1) throw new Error("观察跨了多个 Webview");
    if (phases.map((item) => item.phase).join(",") !== "repairing,released,claimed") throw new Error(`阶段不完整：${phases.map((item) => item.phase).join(",")}`);
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error && error.stack ? error.stack : String(error);
    process.exitCode = 1;
  } finally {
    if (reader) await reader.close().catch((error) => { report.readerCloseError = String(error); });
    if (child?.pid && !exited) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* 进程组可能已经退出。 */ }
      for (let index = 0; index < 50 && processesFor(token, child.pid).length; index += 1) await sleep(100);
      if (processesFor(token, child.pid).length) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* 只作用于本次进程组。 */ }
        for (let index = 0; index < 50 && processesFor(token, child.pid).length; index += 1) await sleep(100);
      }
    }
    if (child?.pid) report.remaining = processesFor(token, child.pid);
    const sharedAfter = fs.existsSync(sharedDist) ? fs.statSync(sharedDist).mtimeMs : null;
    report.sharedDistUnchanged = sharedBefore === sharedAfter;
    if (report.remaining?.length) report.ok = false;
    const preserved = { ...report };
    if (!report.ok && fs.existsSync(path.join(root, "vscode.log"))) {
      preserved.logTail = fs.readFileSync(path.join(root, "vscode.log"), "utf8").slice(-4000);
    }
    for (const name of ["panel-open.json", "panel-opened.json", "panel-open-error.json", "stage.json"]) {
      preserved[name] = readJson(path.join(root, name));
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(product, { recursive: true, force: true });
    preserved.cleanup = { rootRemoved: !fs.existsSync(root), productRemoved: !fs.existsSync(product), remaining: report.remaining || [] };
    writeJson(path.join(repo, ".tmp/loopplus-repair-member-ui-last.json"), preserved);
    const summary = {
      ok: preserved.ok,
      activation: preserved.activation,
      webview: preserved.webview,
      phases: (preserved.phases || []).map((item) => ({
        phase: item.phase,
        ok: item.ok,
        firstSeenDelayMs: item.firstSeenDelayMs,
        target: item.target,
        other: item.other,
        counts: item.counts,
        problems: item.problems,
        targetId: item.targetId,
      })),
      scenario: preserved.scenario,
      exit: preserved.exit,
      cleanup: preserved.cleanup,
      sharedDistUnchanged: preserved.sharedDistUnchanged,
      error: preserved.error,
    };
    console.log(JSON.stringify(summary));
  }
}

module.exports = { runInsideHost };

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
