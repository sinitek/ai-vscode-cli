/* Display-layer smoke only. The host below injects fixtures; it does not open real organization tasks. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const compiled = path.resolve(root, process.env.DEPARTMENT_UI_DIST || ".tmp/department-group-ui-dist/dist");
const output = path.resolve(root, process.env.DEPARTMENT_UI_EVIDENCE || ".tmp/department-group-ui-dist/browser");
const themeOnly = process.env.DEPARTMENT_UI_THEME_ONLY === "1";
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright");
require(path.join(compiled, "test/vscodeMock.js")).installVscodeMock();
const vscode = require("vscode");
const { LoopGroupChatPanel } = require(path.join(compiled, "webview/loopGroupChatPanel.js"));
const { departmentState } = require(path.join(compiled, "test/loop/departmentGroupChatPanel.fixture.js"));
fs.mkdirSync(output, { recursive: true });

function theme(dark) {
  const bg = dark ? "#1f1f1f" : "#ffffff";
  const fg = dark ? "#ededed" : "#202020";
  return {
    "font-family": "Arial, sans-serif", "font-size": "13px", "editor-background": bg, "editor-foreground": fg,
    "foreground": fg, "descriptionForeground": dark ? "#c0c0c0" : "#555555", "sideBar-background": dark ? "#252526" : "#f3f3f3",
    "widget-border": dark ? "#656565" : "#aaaaaa", "focusBorder": dark ? "#6db9ff" : "#005fb8",
    "editorWidget-background": bg, "button-background": "#005fb8", "button-foreground": "#ffffff",
    "button-secondaryBackground": dark ? "#3d3d3d" : "#dedede", "button-secondaryForeground": fg,
    "button-secondaryHoverBackground": dark ? "#505050" : "#cccccc", "button-hoverBackground": "#00539f",
    "badge-background": dark ? "#404040" : "#dddddd", "badge-foreground": fg,
    "input-background": bg, "input-foreground": fg, "input-border": dark ? "#777777" : "#888888",
    "list-hoverBackground": dark ? "#353535" : "#e8e8e8", "toolbar-hoverBackground": dark ? "#353535" : "#e8e8e8",
    "textLink-foreground": dark ? "#85c4ff" : "#005fb8", "charts-green": dark ? "#89d185" : "#246b2a",
    "charts-blue": dark ? "#85c4ff" : "#005fb8", "charts-orange": dark ? "#ffc679" : "#854500",
    "errorForeground": dark ? "#ff9999" : "#a31515", "icon-foreground": fg,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  let currentHtml = "";
  const server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(currentHtml);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const results = [];
  try {
    for (const width of (themeOnly ? [1440] : [1440, 280])) for (const dark of (themeOnly ? [true] : [true, false])) {
      const name = `${width}-${dark ? "dark" : "light"}`;
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("requestfailed", (request) => errors.push(request.url() + " " + request.failure()?.errorText));
      const sent = [];
      let receive;
      vscode.window.createWebviewPanel = () => ({
        webview: { cspSource: "'self'", set html(value) { currentHtml = value; }, get html() { return currentHtml; },
          onDidReceiveMessage(callback) { receive = callback; },
          postMessage: (message) => page.evaluate((data) => window.dispatchEvent(new MessageEvent("message", { data })), message),
        }, onDidDispose() {}, reveal() {},
      });
      const panel = new LoopGroupChatPanel({ fsPath: root }, { onMessage: (message) => sent.push(message) });
      const parentState = departmentState();
      panel.show(parentState);
      const css = Object.entries(theme(dark)).map(([key, value]) => `--vscode-${key}:${value}`).join(";");
      currentHtml = currentHtml.replace("<head>", `<head><style id="departmentFixtureTheme">:root{${css}}</style>`);
      await page.exposeFunction("fixtureHostMessage", (message) => receive(message));
      await page.addInitScript(() => {
        if (window !== window.top) return;
        let stored = {};
        window.acquireVsCodeApi = () => ({ getState: () => stored, setState: (state) => { stored = state; }, postMessage: (message) => window.fixtureHostMessage(message) });
      });
      const check = async (condition, label) => assert.ok(await condition, label);
      const settle = () => page.waitForTimeout(70);
      const targetReady = async () => {
        await page.waitForFunction(() => document.getElementById("departmentChatBackdrop").classList.contains("visible"));
        await settle();
        const target = panel.getDepartmentModalTarget(); assert.ok(target); return target;
      };
      const inject = async (target) => {
        const state = departmentState("leader"); state.task.id = target.taskId;
        state.department.title += target.taskId.endsWith("222222") ? " · B组" : " · A组";
        state.acceptancePlan = parentState.acceptancePlan;
        assert.equal(panel.setDepartmentModalState(target, state), true);
        await page.locator("#departmentChatContent iframe").waitFor();
        const handle = await page.locator("#departmentChatContent iframe").elementHandle();
        const frame = await handle.contentFrame();
        await frame.locator(".main").waitFor(); await settle();
        return { frame, state };
      };
      const showMembers = async (context) => {
        if (await context.locator("#sidebarToggle").isVisible() && !(await context.locator(".layout").evaluate((element) => element.classList.contains("sidebar-open")))) await context.locator("#sidebarToggle").click();
      };
      const overflow = async (context) => {
        const value = await context.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert.ok(value.root <= value.viewport + 1 && value.body <= value.viewport + 1, JSON.stringify(value));
      };
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.locator("#panelHeading").waitFor();
        if (themeOnly) {
          const changeTheme = async (isDark) => {
            await page.evaluate(({ tokens, isDark }) => {
              document.getElementById("departmentFixtureTheme").textContent = ":root{" + Object.entries(tokens).map(([key, value]) => `--vscode-${key}:${value}`).join(";") + "}";
              const kind = isDark ? "vscode-dark" : "vscode-light";
              document.body.classList.remove("vscode-dark", "vscode-light");
              document.body.classList.add(kind);
              document.body.setAttribute("data-vscode-theme-kind", kind);
              document.body.setAttribute("data-vscode-theme-name", isDark ? "深色夹具" : "浅色夹具");
              document.documentElement.setAttribute("data-vscode-theme-id", isDark ? "dark-fixture" : "light-fixture");
              document.body.style.colorScheme = isDark ? "dark" : "light";
              if (isDark) document.body.style.setProperty("--vscode-button-border", "rgb(11, 22, 33)");
              else document.body.style.removeProperty("--vscode-button-border");
            }, { tokens: theme(isDark), isDark });
          };
          await changeTheme(true);
          await page.locator(".main").evaluate((element) => { element.scrollTop = 140; });
          const parentTop = await page.locator(".main").evaluate((element) => element.scrollTop);
          await page.locator('.department-group').nth(0).locator('[data-action="openDepartmentTask"]').click();
          const target = await targetReady();
          const { frame, state } = await inject(target);
          await frame.evaluate(() => { window.themeDocumentIdentity = "unchanged-child-document"; document.querySelector(".main").scrollTop = 180; });
          const childTop = await frame.locator(".main").evaluate((element) => element.scrollTop);
          await frame.locator('[data-action="askMainModel"]').click();
          await frame.locator("#askChatInput").fill("主题切换保留的组长草稿");
          const readColors = () => frame.evaluate(() => ({
            background: getComputedStyle(document.body).backgroundColor,
            foreground: getComputedStyle(document.body).color,
            border: getComputedStyle(document.querySelector('[data-action="refresh"]')).borderTopColor,
            focus: getComputedStyle(document.body).getPropertyValue("--vscode-focusBorder").trim(),
            scheme: getComputedStyle(document.documentElement).colorScheme,
            kind: document.body.getAttribute("data-vscode-theme-kind"),
            name: document.body.getAttribute("data-vscode-theme-name"),
            id: document.documentElement.getAttribute("data-vscode-theme-id"),
            optionalToken: document.documentElement.style.getPropertyValue("--vscode-button-border"),
            classes: document.body.className,
          }));
          const colors = [];
          for (const isDark of [true, false, true]) {
            await changeTheme(isDark);
            await frame.waitForFunction((isDark) => getComputedStyle(document.body).backgroundColor === (isDark ? "rgb(31, 31, 31)" : "rgb(255, 255, 255)"), isDark);
            const actual = await readColors();
            assert.equal(actual.foreground, isDark ? "rgb(237, 237, 237)" : "rgb(32, 32, 32)");
            assert.equal(actual.border, isDark ? "rgb(11, 22, 33)" : "rgb(170, 170, 170)");
            assert.equal(actual.focus, isDark ? "#6db9ff" : "#005fb8");
            assert.equal(actual.kind, isDark ? "vscode-dark" : "vscode-light");
            assert.equal(actual.name, isDark ? "深色夹具" : "浅色夹具");
            assert.equal(actual.id, isDark ? "dark-fixture" : "light-fixture");
            assert.equal(actual.scheme, isDark ? "dark" : "light");
            assert.equal(actual.optionalToken.trim(), isDark ? "rgb(11, 22, 33)" : "", "removed token must not linger");
            assert.ok(actual.classes.includes("department-chat-page"));
            assert.ok(!actual.classes.includes(isDark ? "vscode-light" : "vscode-dark"));
            assert.equal(await frame.locator("#askChatInput").inputValue(), "主题切换保留的组长草稿");
            assert.equal(await frame.evaluate(() => document.activeElement.id), "askChatInput");
            assert.equal(await frame.locator(".main").evaluate((element) => element.scrollTop), childTop);
            assert.equal(await page.locator(".main").evaluate((element) => element.scrollTop), parentTop);
            assert.deepEqual(panel.getDepartmentModalTarget(), target);
            colors.push(actual);
            await page.screenshot({ path: path.join(output, `dynamic-${colors.length}-${isDark ? "dark" : "light"}.png`) });
          }
          state.chatMarkdown += "\n## 主任务发言\n\n动态主题后的正常状态补丁\n";
          assert.equal(panel.setDepartmentModalState(target, state), true);
          parentState.department.leaders[0].participant.status = "paused"; panel.update(parentState);
          await frame.getByText("动态主题后的正常状态补丁", { exact: true }).waitFor();
          assert.equal(await frame.evaluate(() => window.themeDocumentIdentity), "unchanged-child-document");
          assert.equal(await frame.locator("#askChatInput").inputValue(), "主题切换保留的组长草稿");
          assert.equal(await frame.evaluate(() => document.activeElement.id), "askChatInput");
          assert.equal(await frame.locator(".main").evaluate((element) => element.scrollTop), childTop);
          assert.equal(await page.locator(".main").evaluate((element) => element.scrollTop), parentTop);
          assert.deepEqual(await readColors(), colors.at(-1));
          await frame.locator("#askChatInput").press("Control+Enter"); await settle();
          const question = sent.filter((message) => message.type === "loopGroupChatChat:departmentTaskMessage" && message.message.type === "loopGroupChatChat:askMainModel").at(-1);
          assert.equal(question?.taskId, target.taskId); assert.equal(question?.instanceId, target.instanceId);
          assert.equal(question?.message.prompt, "主题切换保留的组长草稿");
          await overflow(page); await overflow(frame);
          assert.deepEqual(errors, []);
          results.push({ name: "dynamic-dark-light-dark", result: "passed", colors, parentTop, childTop, target, browserErrors: errors });
          continue;
        }
        assert.match(await page.title(), /👴🏻.*#-root-abcdef/u);
        await overflow(page);
        await showMembers(page);
        const groups = page.locator(".department-group");
        assert.equal(await groups.count(), 3);
        assert.match(await groups.nth(0).locator(".department-employees").innerText(), /员工甲/u);
        assert.doesNotMatch(await groups.nth(0).locator(".department-employees").innerText(), /员工乙/u);
        assert.match(await groups.nth(1).locator(".department-employees").innerText(), /员工乙/u);
        assert.equal(await groups.nth(2).locator("button").isDisabled(), true);
        await page.locator(".main").evaluate((element) => { element.scrollTop = 140; });
        const parentTop = await page.locator(".main").evaluate((element) => element.scrollTop);
        await page.screenshot({ path: path.join(output, `${name}-tree.png`) });
        const openA = groups.nth(0).locator('[data-action="openDepartmentTask"]');
        await openA.focus(); await openA.press("Enter");
        const loading = await targetReady();
        assert.equal(await page.locator("#departmentChatStatus").innerText(), "正在加载组长群聊…");
        assert.equal(await page.locator("#departmentChatContent iframe").count(), 0);
        await check(page.locator(".shell").evaluate((element) => element.inert), "parent must be inert");
        await page.locator("#departmentChatClose").press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement.id), "departmentChatClose");
        assert.equal(panel.setDepartmentModalError(loading, "读取组长失败 <本地夹具>"), true);
        await settle(); assert.equal(await page.locator("#departmentChatStatus").innerText(), "读取组长失败 <本地夹具>");
        await page.locator("#departmentChatRetry").click();
        const a = await targetReady(); assert.notEqual(a.instanceId, loading.instanceId);
        let { frame, state } = await inject(a);
        await overflow(page); await overflow(frame);
        assert.match(await frame.locator("#panelHeading").innerText(), /组长 👨🏻/u);
        assert.equal(await frame.locator('[data-action="acceptancePlan"]').count(), 0);
        await showMembers(frame);
        assert.match(await frame.locator("#taskPanelSlot").innerText(), /继承产研部统一验收方案.*\n产研部统一规则 <严格>/u);
        await showMembers(frame);
        const spacing = await frame.locator(".department-employees").first().evaluate((element) => ({ indent: getComputedStyle(element).marginInlineStart, border: getComputedStyle(element).borderInlineStartWidth, gap: getComputedStyle(document.querySelector(".department-leaders")).rowGap, avatar: getComputedStyle(document.querySelector(".avatar")).width, memberGap: getComputedStyle(document.querySelector(".member")).columnGap, padding: getComputedStyle(document.querySelector(".member")).padding }));
        assert.deepEqual(spacing, { indent: "16px", border: "1px", gap: "8px", avatar: "28px", memberGap: "8px", padding: "4px" });
        if (width === 280) await frame.locator("#sidebarToggle").click();
        await frame.locator('[data-action="supplementTask"]').click();
        await frame.locator("#continueDialogInput").fill("A组独立补充草稿");
        await frame.locator("#continueDialogConfirm").focus(); await frame.locator("#continueDialogConfirm").press("Tab");
        assert.equal(await frame.evaluate(() => document.activeElement.id), "continueDialogInput");
        await frame.locator("#continueDialogInput").press("Escape");
        assert.equal(await frame.locator("#continueDialogBackdrop").getAttribute("aria-hidden"), "true");
        assert.equal(await page.locator("#departmentChatBackdrop").getAttribute("aria-hidden"), "false");
        assert.equal(await frame.evaluate(() => document.activeElement.getAttribute("data-action")), "supplementTask");
        await frame.locator('[data-action="supplementTask"]').click();
        await frame.locator("#continueDialogInput").fill("提交给A组的补充");
        await frame.locator("#continueDialogConfirm").click();
        await frame.locator('[data-action="continueTask"]').click();
        await frame.locator("#continueDialogInput").fill("继续A组任务");
        await frame.locator("#continueDialogConfirm").click();
        panel.postDepartmentModalMessage(a, { type: "loopGroupChatChat:continueTaskSettled", canContinue: true });
        await frame.locator('[data-action="switchModels"]').click();
        await frame.locator("#modelSwitchConfirm").click();
        panel.postDepartmentModalMessage(a, { type: "loopGroupChatChat:switchModelsSettled", ok: true });
        await settle();
        state.task.canStop = true; state.task.canContinue = false; panel.setDepartmentModalState(a, state);
        await settle(); await frame.locator('[data-action="stopTask"]').click(); await settle();
        for (const type of ["supplementTask", "continueTask", "switchModels", "stopTask"]) {
          const action = sent.find((message) => message.type === "loopGroupChatChat:departmentTaskMessage" && message.message.type === "loopGroupChatChat:" + type);
          assert.equal(action?.taskId, a.taskId, type); assert.equal(action?.instanceId, a.instanceId, type);
        }
        await frame.locator('[data-action="askMainModel"]').click();
        await frame.locator("#askChatInput").fill("组长A问题"); await frame.locator("#askChatInput").press("Control+Enter");
        await frame.locator("#askChatInput").fill("只属于A的草稿");
        await settle();
        const question = sent.find((message) => message.type === "loopGroupChatChat:departmentTaskMessage" && message.message.type === "loopGroupChatChat:askMainModel");
        assert.equal(question.taskId, a.taskId); assert.equal(question.instanceId, a.instanceId);
        assert.equal(question.message.prompt, "组长A问题");
        panel.publishDepartmentModalAskThread(a, { version: 1, messages: [{ id: "answer-a", role: "assistant", content: "只属于A的回答", createdAt: 1 }], running: false, dialogOpen: true, updatedAt: 1 });
        await settle(); assert.match(await frame.locator("#askChatMessages").innerText(), /只属于A的回答/u);
        state.chatMarkdown += "\n## 主任务发言\n\n组长增量内容\n";
        panel.setDepartmentModalState(a, state);
        parentState.department.leaders[0].participant.status = "paused"; panel.update(parentState);
        await settle(); assert.equal(await frame.locator("#askChatInput").inputValue(), "只属于A的草稿");
        await frame.locator("#askChatClose").click();
        await frame.evaluate(() => openCommunicationFilePreview("/display-only/leader.md", true)); await settle();
        const previewRequest = sent.filter((message) => message.type === "loopGroupChatChat:departmentTaskMessage" && message.message.type === "loopGroupChatChat:openCommunicationFile").at(-1);
        panel.postDepartmentModalCommunicationFilePreview(a, { type: "loopGroupChatChat:communicationFile", requestId: previewRequest.message.requestId, path: "/display-only/leader.md", ok: true, html: "<p>只属于A的文件预览</p>" });
        await settle(); assert.match(await frame.locator("#filePreviewContent").innerText(), /只属于A的文件预览/u);
        await frame.locator("#filePreviewClose").click();
        await frame.locator(".main").evaluate((element) => { element.scrollTop = 180; }); await settle();
        const childTop = await frame.locator(".main").evaluate((element) => element.scrollTop);
        await showMembers(frame);
        await frame.locator('.department-group').nth(1).locator('[data-action="openDepartmentTask"]').click();
        const b = await targetReady(); assert.notEqual(b.taskId, a.taskId);
        assert.equal(panel.setDepartmentModalState(a, state), false);
        assert.equal(panel.publishDepartmentModalAskThread(a, { version: 1, messages: [], running: false, dialogOpen: false, updatedAt: 0 }), false);
        await page.evaluate((target) => window.dispatchEvent(new MessageEvent("message", { data: { type: "loopGroupChatChat:departmentModalContent", ...target, error: "迟到的A错误" } })), a);
        ({ frame } = await inject(b));
        assert.equal(await frame.locator("#askChatInput").inputValue(), "");
        assert.doesNotMatch(await frame.locator("#askChatMessages").innerText(), /只属于A/u);
        assert.doesNotMatch(await page.locator("#departmentChatStatus").innerText(), /迟到/u);
        await frame.locator('[data-action="refresh"]').click(); await settle();
        const refreshed = sent.filter((message) => message.type === "loopGroupChatChat:departmentTaskMessage" && message.message.type === "loopGroupChatChat:refresh").at(-1);
        assert.equal(refreshed.taskId, b.taskId);
        await frame.locator('[data-action="refresh"]').press("Escape"); await settle();
        assert.equal(await page.locator("#departmentChatBackdrop").getAttribute("aria-hidden"), "true");
        assert.equal(await page.locator(".main").evaluate((element) => element.scrollTop), parentTop);
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute("data-department-task-id")), a.taskId);
        await page.locator('.department-group').nth(0).locator('[data-action="openDepartmentTask"]').press("Space");
        const reopened = await targetReady();
        ({ frame } = await inject(reopened));
        assert.equal(await frame.locator("#askChatInput").inputValue(), "只属于A的草稿", "the restored draft belongs to A only");
        assert.equal(await frame.locator(".main").evaluate((element) => element.scrollTop), childTop);
        await page.screenshot({ path: path.join(output, `${name}-modal.png`) });
        await page.locator("#departmentChatClose").focus(); await page.locator("#departmentChatClose").press("Enter");
        await settle(); assert.equal(panel.getDepartmentModalTarget(), undefined);
        await overflow(page);
        assert.deepEqual(errors, []);
        results.push({ name, result: "passed", spacing, parentTop, childTop, taskMessages: sent.filter((message) => message.type === "loopGroupChatChat:departmentTaskMessage").length });
      } catch (error) {
        await page.screenshot({ path: path.join(output, `${name}-failure.png`) });
        results.push({ name, result: "failed", error: error.stack, browserErrors: errors });
      } finally { await page.close(); }
    }
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ scope: "generated HTML + fixture host API; no organization runtime", results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.result !== "passed")) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
