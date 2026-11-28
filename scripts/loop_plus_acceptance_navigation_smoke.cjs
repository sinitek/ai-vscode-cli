const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.resolve(root, process.env.LOOP_PLUS_UI_EVIDENCE || ".tmp/loop-plus-acceptance-navigation");
const compiled = path.join(root, "dist");
const playwrightPath = process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright";
const { chromium } = require(playwrightPath);
require(path.join(compiled, "test/vscodeMock.js")).installVscodeMock();
const { buildLoopGroupChatPanelHtml, buildLoopGroupChatPanelContentPatch } = require(path.join(compiled, "webview/loopGroupChatPanel.js"));
const { buildLoopPlusAcceptanceFeedbackSection, LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES } = require(path.join(compiled, "loopPlusAcceptancePlan.js"));
const { buildLoopPlusFinishEventId } = require(path.join(compiled, "loopPlusScheduler.js"));

const viewport = { width: 280, height: 640 };
const title = "同名交付";
const messageLimit = 8;
const initialHistoryCount = 40;
const retryHistoryCount = 30;
const memberA = { id: "member-a", lastStartedAt: Date.UTC(2026, 10, 20, 8) };
const memberB = { id: "member-b", lastStartedAt: Date.UTC(2026, 10, 20, 9) };
const initialA = { member: memberA, attemptId: "a-1", acceptance: "failed", marker: "甲的初验：契约检查失败" };
const initialB = { member: memberB, attemptId: "b-1", acceptance: "passed", marker: "乙的初验：交付符合契约", withSecurity: true };
const retryA = { member: memberA, attemptId: "a-2", acceptance: "passed", marker: "甲的复验：修复后边界通过" };
const theme = {
  "font-family": "Arial, sans-serif", "font-size": "13px", "editor-background": "#ffffff", "editor-foreground": "#202020",
  foreground: "#202020", descriptionForeground: "#555555", "sideBar-background": "#f3f3f3", "widget-border": "#aaaaaa",
  focusBorder: "#005fb8", "editorWidget-background": "#ffffff", "button-background": "#005fb8", "button-foreground": "#ffffff",
  "button-secondaryBackground": "#dedede", "button-secondaryForeground": "#202020", "button-secondaryHoverBackground": "#cccccc",
  "button-hoverBackground": "#00539f", "badge-background": "#dddddd", "badge-foreground": "#202020", "input-background": "#ffffff",
  "input-foreground": "#202020", "input-border": "#888888", "list-hoverBackground": "#e8e8e8", "toolbar-hoverBackground": "#e8e8e8",
  "textLink-foreground": "#005fb8", "charts-green": "#246b2a", "charts-blue": "#005fb8", "charts-orange": "#854500",
  errorForeground: "#a31515", "icon-foreground": "#202020",
};

function feedback({ member, attemptId, acceptance, marker, withSecurity }) {
  const section = buildLoopPlusAcceptanceFeedbackSection({
    subtaskTitles: [title],
    reviews: [{ eventId: buildLoopPlusFinishEventId(member.id, attemptId), acceptance, reason: marker }],
    checks: LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES.map((name) => ({
      name, passed: acceptance === "passed" || name !== "contracts", detail: "按交付证据逐项核对结果。",
    })),
    ...(withSecurity ? {
      snapshot: { id: "secure", name: "加严", checks: ["security"], otherText: "", systemDefault: false },
      planResults: [{ key: "security", passed: true, reason: "输入边界已校验" }],
    } : {}),
  });
  assert.ok(section, `feedback for ${attemptId}`);
  return `## ${section.heading}\n\n${section.body}\n\n`;
}

function history(label, count) {
  return Array.from({ length: count }, (_, index) =>
    `## 主任务发言：第 ${index + 1} 轮\n\n${label}消息-${index + 1}。\n\n${"交付上下文与验证记录。\n\n".repeat(24)}`).join("");
}

function state(reviews, chatMarkdown) {
  const latest = new Map(reviews.map((review) => [review.member.id, review]));
  return {
    task: { id: "acceptance-navigation-smoke", cli: "codex", status: "completed", rootPrompt: "验证同名成员的验收定位。",
      taskStoreFile: "/fixture/task.json", mainCommunicationFile: "/fixture/main.md", currentRound: 1, updatedAt: 1,
      canSupplement: false, canContinue: false, canStop: false },
    loopPlus: { ok: true, schedulingMode: "event_driven", activity: "completed", phase: "completed", wakePending: false,
      currentReview: null, reviewQueue: [], currentReviewCount: 0, reviewQueueCount: 0, visibleReviewCount: 0,
      running: [], pending: [], runningCount: 0, pendingCount: 0,
      seenAttempts: reviews.map(({ member, attemptId, acceptance }) => ({
        subtaskId: member.id, attemptId, disposition: "reviewed", outcome: "completed", acceptance,
      })) },
    rounds: [{ key: "main-sub", loopRound: 1, status: "completed", startedAt: 1, participants: [
      { id: "main", title: "主任务", role: "main", status: "completed" },
      ...[memberA, memberB].map((member) => ({ ...member, title, role: "subtask", status: `acceptance_${latest.get(member.id).acceptance}` })),
    ] }],
    messageLimit,
    chatMarkdown,
  };
}

const writeJson = (name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const errors = { page: [], console: [], http: [], requestFailed: [] };
  const result = { scope: "ordinary Loop+ generated webview and simulated VS Code API", viewport, messageLimit,
    historyCount: [initialHistoryCount, retryHistoryCount], phases: [], jumps: [], errors, outcome: "failed" };
  let browser, server, page;
  try {
    const initialTranscript = feedback(initialA) + feedback(initialB) + history("初验历史", initialHistoryCount);
    const initial = state([initialA, initialB], initialTranscript);
    const retry = state([initialA, initialB, retryA], initialTranscript + feedback(retryA) + history("复验历史", retryHistoryCount));
    const bubbleWindow = { start: 0 };
    const css = Object.entries(theme).map(([key, value]) => `--vscode-${key}:${value}`).join(";");
    const html = buildLoopGroupChatPanelHtml({ cspSource: "'self'" }, initial, undefined, 1, bubbleWindow, { nonce: "fixture-loop-plus-navigation" })
      .replace("<head>", `<head><style>:root{${css}}</style>`);
    const initialWindowStart = bubbleWindow.start;
    const patch = buildLoopGroupChatPanelContentPatch(retry, 2, bubbleWindow);
    assert.ok(initialWindowStart > 0 && bubbleWindow.start > initialWindowStart,
      `production retention window advances across the patch: ${initialWindowStart} -> ${bubbleWindow.start}`);
    const files = [__filename, ...["webview/loopGroupChatPanel", "webview/loopGroupChatPanelRenderer", "webview/loopGroupChatPanelStyles",
      "webview/loopGroupChatBubbleRetention", "loopGroupChat", "loopGroupChatAcceptance", "loopPlusAcceptancePlan", "loopPlusScheduler",
      "test/vscodeMock"].map((file) => path.join(compiled, `${file}.js`))];
    writeJson("inputs.json", {
      node: process.version, platform: `${process.platform}/${process.arch}`, playwright: require(`${playwrightPath}/package.json`).version,
      chromium: process.env.CHROMIUM_PATH || chromium.executablePath(), fixtureSha256: sha256(JSON.stringify({ initial, retry })),
      htmlSha256: sha256(html), patchSha256: sha256(JSON.stringify(patch)), bubbleWindowStarts: [initialWindowStart, bubbleWindow.start],
      files: files.map((file) => ({ file: path.relative(root, file), sha256: sha256(fs.readFileSync(file)) })),
    });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    result.chromiumVersion = browser.version();
    page = await browser.newPage({ viewport, colorScheme: "light", reducedMotion: "reduce" });
    page.setDefaultTimeout(6000);
    page.on("pageerror", (error) => errors.page.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.console.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) errors.http.push(`${response.status()} ${response.url()}`); });
    page.on("requestfailed", (request) => errors.requestFailed.push(`${request.url()} ${request.failure()?.errorText}`));
    await page.addInitScript(() => {
      let stored = { scroll: { stickToBottom: true } };
      window.fixtureHostMessages = [];
      window.acquireVsCodeApi = () => ({
        getState: () => stored,
        setState: (state) => { stored = state; },
        postMessage: (message) => window.fixtureHostMessages.push({ message, event: window.event?.type ?? null }),
      });
    });
    server = http.createServer((request, response) => {
      if (request.url === "/favicon.ico") return response.writeHead(204).end();
      if (request.url !== "/") return response.writeHead(404).end();
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.fixtureHostMessages.some(({ message }) => message.type === "loopGroupChatChat:domReady"));
    const environment = await page.evaluate(() => ({ width: innerWidth, light: matchMedia("(prefers-color-scheme: light)").matches,
      reduce: matchMedia("(prefers-reduced-motion: reduce)").matches, background: getComputedStyle(document.body).backgroundColor }));
    assert.deepEqual(environment, { width: viewport.width, light: true, reduce: true, background: "rgb(255, 255, 255)" });
    result.environment = environment;

    const timeline = page.locator("main #timelineSlot");
    const anchors = timeline.locator("article.acceptance-anchor");
    const drawer = page.locator("#panelSidebar");
    const toggle = page.locator("#sidebarToggle");
    const buttons = drawer.locator('button[data-action="jumpToAcceptance"]');
    const screenshot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) });
    const assertDrawer = async (open) => {
      assert.equal(await toggle.getAttribute("aria-expanded"), String(open));
      assert.equal(await drawer.getAttribute("aria-hidden"), String(!open));
      assert.equal(await drawer.evaluate((element) => element.inert), !open);
      assert.equal(await page.locator("#sidebarBackdrop").isVisible(), open);
      assert.equal(await page.locator(".layout").evaluate((element) => element.classList.contains("sidebar-open")), open);
    };
    const assertTrimmed = async (name, missing, retained, expected) => {
      const count = await timeline.locator("article.message").count();
      const text = await timeline.innerText();
      result.phases.push({ name, count, missing: missing.filter((marker) => !text.includes(marker)), anchors: await anchors.count() });
      assert.ok(count < messageLimit, `${name}: trimmed timeline (${count} articles)`);
      for (const marker of missing) assert.ok(!text.includes(marker), `${name}: trimmed ${marker}`);
      assert.ok(text.includes(retained), `${name}: latest ordinary message remains`);
      assert.equal(await anchors.count(), expected.length, `${name}: exact anchor count`);
      assert.equal(await buttons.count(), expected.length, `${name}: exact button count`);
      assert.deepEqual(await buttons.locator(".member-name").allTextContents(), expected.map(() => title));
      for (const { marker, acceptance, withSecurity } of expected) {
        const anchor = anchors.filter({ hasText: marker });
        assert.equal(await anchor.count(), 1, `${name}: preserved ${marker}`);
        const tables = anchor.locator("table");
        assert.equal(await tables.count(), withSecurity ? 2 : 1);
        const rows = tables.first().locator("tbody tr");
        assert.deepEqual(await rows.locator("td:first-child").allTextContents(), ["交付与范围", "契约与回归", "验证与运行"]);
        assert.match(await rows.nth(1).locator("td").last().innerText(), acceptance === "failed" ? /^❌ 契约一致性未通过/u : /^✅/u);
        if (withSecurity) assert.deepEqual(await tables.nth(1).locator("tbody td").allTextContents(), ["安全审查", "✅ 输入边界已校验"]);
      }
    };
    const inspectAnchor = (anchor) => anchor.evaluate((element) => {
      const main = element.closest("main");
      const mainRect = main.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const body = element.querySelector(".message-text").getBoundingClientRect();
      const overlap = (bounds) => ({
        width: Math.max(0, Math.min(bounds.right, mainRect.right, innerWidth) - Math.max(bounds.left, mainRect.left, 0)),
        height: Math.max(0, Math.min(bounds.bottom, mainRect.bottom, innerHeight) - Math.max(bounds.top, mainRect.top, 0)),
      });
      return { id: element.id, activeId: document.activeElement.id, focused: document.activeElement === element && document.hasFocus(),
        tabIndex: element.tabIndex, scrollTop: main.scrollTop, overlap: overlap(rect), bodyOverlap: overlap(body),
        anchorRect: rect.toJSON(), mainRect: mainRect.toJSON() };
    });
    const jump = async (review, name, { mustScroll = false, scrollToBottom = false } = {}) => {
      await assertDrawer(true);
      if (scrollToBottom) {
        await page.locator("main").evaluate((element) => { element.scrollTop = element.scrollHeight; });
      }
      const { member, marker } = review;
      const started = new Date(member.lastStartedAt).toLocaleString("zh-CN");
      const button = buttons.filter({ has: page.locator(`[data-member-last-started=${JSON.stringify(started)}]`) });
      assert.equal(await button.count(), 1, `${name}: identify member independently of acceptance target and title`);
      const anchor = anchors.filter({ has: page.locator(".message-text", { hasText: marker }) });
      assert.equal(await anchor.count(), 1, `${name}: locate expected event body`);
      const before = await inspectAnchor(anchor);
      const linkedId = await button.getAttribute("data-acceptance-target");
      const check = { name, memberId: member.id, eventId: buildLoopPlusFinishEventId(member.id, review.attemptId), before, linkedId };
      result.jumps.push(check);
      assert.equal(linkedId, before.id, `${name}: button links to own latest reviewed event`);
      assert.equal(await page.locator(`[id=${JSON.stringify(linkedId)}]`).count(), 1, `${name}: target id is unique`);
      if (mustScroll) assert.equal(before.overlap.height, 0, `${name}: target starts outside visible timeline`);
      await button.click();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = check.after = await inspectAnchor(anchor);
      assert.equal(after.focused, true, `${name}: native focus is on the acceptance article`);
      assert.equal(after.tabIndex, -1, `${name}: anchor is programmatically focusable`);
      assert.ok(after.bodyOverlap.width > 0 && after.bodyOverlap.height > 0, `${name}: focused message body is inside the clipped viewport`);
      if (mustScroll) assert.notEqual(after.scrollTop, before.scrollTop, `${name}: timeline scrolled into view`);
      await assertDrawer(false);
    };

    await assertDrawer(false);
    await assertTrimmed("initial", ["初验历史消息-1。"], `初验历史消息-${initialHistoryCount}。`, [initialA, initialB]);
    await toggle.click();
    await jump(initialA, "initial-a", { mustScroll: true });
    await screenshot("initial-a-focused");
    await toggle.click();
    await jump(initialB, "initial-b");
    await toggle.click();
    await assertDrawer(true);
    await page.evaluate((data) => {
      window.fixtureOriginalMain = document.querySelector("main");
      window.dispatchEvent(new MessageEvent("message", { data }));
    }, patch);
    assert.ok(await page.evaluate(() => window.fixtureOriginalMain === document.querySelector("main")), "contentPatch keeps the same document and main container");
    await assertDrawer(true);
    await assertTrimmed("retry", [initialA.marker, `初验历史消息-${initialHistoryCount}。`, "复验历史消息-1。"],
      `复验历史消息-${retryHistoryCount}。`, [initialB, retryA]);
    await screenshot("retry-drawer-open");
    await jump(retryA, "retry-a");
    await screenshot("retry-a-focused");
    await toggle.click();
    await jump(initialB, "retry-b", { mustScroll: true, scrollToBottom: true });
    await screenshot("retry-b-focused");

    result.hostMessages = await page.evaluate(() => window.fixtureHostMessages);
    const isBackgroundRefresh = ({ message, event }) => message.type === "loopGroupChatChat:refresh" && (event === null || event === "visibilitychange");
    result.backgroundRefreshCount = result.hostMessages.filter(isBackgroundRefresh).length;
    assert.deepEqual(result.hostMessages.filter((entry) => !isBackgroundRefresh(entry)).map(({ message }) => message),
      [{ type: "loopGroupChatChat:domReady", generation: 1 }], "only initial handshake; drawer, patch and acceptance navigation send no host action");
    assert.equal(Object.values(errors).flat().length, 0, JSON.stringify(errors));
    result.outcome = "passed";
  } catch (error) {
    result.failure = error.stack || String(error);
    if (page) {
      result.hostMessages = await page.evaluate(() => window.fixtureHostMessages).catch(() => []);
      await page.screenshot({ path: path.join(output, "failure.png"), timeout: 2000 }).catch(() => {});
    }
    throw error;
  } finally {
    result.errorCounts = Object.fromEntries(Object.entries(errors).map(([type, entries]) => [type, entries.length]));
    writeJson("result.json", result);
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
  console.log(`PASS 280px Loop+ acceptance navigation: ${result.jumps.length} jumps, no browser errors; ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
