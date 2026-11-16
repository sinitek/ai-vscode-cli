/* Generated production Webview + production setting router/store; no real CLI or VS Code EH. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/tmp/zq-playwright-smoke/node_modules/playwright');
const dist = path.resolve(__dirname, '../dist');
require(path.join(dist, 'test/vscodeMock.js')).installVscodeMock();
const { getWebviewHtml } = require(path.join(dist, 'webview/viewContent.js'));
const { routeSettingMessage } = require(path.join(dist, 'settingMessageRouter.js'));
const { loadWorkspaceSettings, trySaveWorkspaceSettings } = require(path.join(dist, 'workspaceSettingsStore.js'));
const output = path.resolve(process.env.DEPARTMENT_CAPACITY_EVIDENCE || '/tmp/department-workspace-capacity-round694');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'department-capacity-smoke-'));
const options = { workspaceSettingsDir: directory, workspaceKey: 'a', isCliName: () => false, isThinkingMode: () => false,
  isInteractiveMode: () => false, normalizeVisibleInteractiveMode: () => 'coding', normalizeLoopMaxRounds: () => 20, sanitizeConversationTabRecord: () => null };
let settings = {}, fail = false, writes = 0;
const payload = () => ({ currentCli: 'codex', interactiveMode: 'coding', conversationTabs: { activeTabId: null, tabs: [] },
  sessionState: { currentSessionId: null, sessions: [] }, configState: { configs: [], activeConfigId: null }, configStateByCli: {},
  chatMessageLimit: 100, loopGroupChatMessageLimit: 100, promptHistory: [], humanInteractionHistory: [], scheduledTasks: [],
  loopPlusAcceptancePlans: [], loopPlusAcceptancePlanSelection: '', cliEnabledByName: {}, loopEnabled: true, loopPlusEnabled: true,
  departmentEnabled: true, rulePaths: { global: {}, project: {} }, interactive: { supported: true, enabled: true },
  departmentConfigurationScope: 'workspace-a:1', departmentMaxLeaders: 4, departmentMaxEmployees: 20,
  workspaceDepartmentMaxLeaders: settings.departmentMaxLeaders ?? null, workspaceDepartmentMaxEmployees: settings.departmentMaxEmployees ?? null });
// Same theme-token fixture as the existing department_conversation_tabs_smoke runner.
const existing = fs.readFileSync(path.join(__dirname, 'department_conversation_tabs_smoke.cjs'), 'utf8');
const css = existing.match(/const css = `([^`]+)`;/)[1];
const html = getWebviewHtml({ cspSource: "'self'" }).replace('<head>', `<head><style>${css}</style>`);
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'generated-input.html'), html);
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const errors = [], results = [];
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/setting') {
        let body = ''; for await (const chunk of request) body += chunk;
        const message = JSON.parse(body), messages = [];
        await routeSettingMessage(message, { getCurrentCli: () => 'codex', getWorkspaceSettings: () => settings,
          getDepartmentConfigurationScope: () => 'workspace-a:1',
          saveWorkspaceSettingsWithResult: (next) => { writes++; return fail ? { ok: false } : trySaveWorkspaceSettings(next, options); },
          setWorkspaceSettings: (next) => { settings = next; }, showWebviewError: () => {}, postWebviewMessage: (m) => messages.push(m),
          postPanelState: async () => messages.push({ type: 'state', payload: payload() }) });
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(messages)); return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
    } catch (error) { errors.push(error.stack); response.statusCode = 500; response.end('error'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [width, theme] of [[1440, 'dark'], [280, 'light']]) {
      settings = {}; trySaveWorkspaceSettings(settings, options);
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('requestfailed', (r) => errors.push(r.failure()?.errorText));
      page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}`); });
      // The VS Code message bridge runs outside page CSP; use a Node-side binding for this fixture too.
      await page.exposeFunction('__hostSetting', async (message) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/setting`, { method: 'POST', body: JSON.stringify(message) });
        assert.equal(response.status, 200); return response.json();
      });
      await page.addInitScript(() => {
        window.__postedMessages = [];
        let state = {};
        window.acquireVsCodeApi = () => ({ getState: () => state, setState: (s) => { state = s; }, postMessage: (m) => {
          window.__postedMessages.push(m);
          if (m.type === 'updateSetting' && m.key.startsWith('workspaceDepartment')) window.__hostSetting(m)
            .then((messages) => messages.forEach((data) => window.postMessage(data, '*')));
        } });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('body').evaluate((body, theme) => { body.className = `vscode-${theme}`; }, theme);
      await page.evaluate((state) => window.postMessage({ type: 'state', payload: state }, '*'), payload());
      await page.locator('#toolSettingsButton').click();
      await page.locator('#toolSettingsWorkspaceTab').click();
      const leaders = page.locator('#workspaceDepartmentMaxLeaders'), employees = page.locator('#workspaceDepartmentMaxEmployees');
      await leaders.waitFor({ state: 'visible' });
      assert.equal(await leaders.inputValue(), ''); assert.equal(await leaders.getAttribute('placeholder'), '全局：4');
      const geometry = await page.evaluate(() => {
        const ids = ['workspaceLoopPlusDecisionSubtaskMax', 'workspaceDepartmentMaxLeaders', 'workspaceDepartmentMaxEmployees', 'longTermMemoryEnabled'];
        return ids.map((id) => { const card = document.getElementById(id).closest('.tool-settings-card'), box = card.getBoundingClientRect();
          return { id, top: box.top, bottom: box.bottom, left: box.left, right: box.right, parent: card.parentElement.id, overflow: card.scrollWidth > card.clientWidth }; });
      });
      for (let i = 0; i < geometry.length; i++) {
        assert.equal(geometry[i].parent, 'toolSettingsWorkspacePanel'); assert.equal(geometry[i].overflow, false);
        assert.ok(geometry[i].left >= 0 && geometry[i].right <= width);
        for (let j = 0; j < i; j++) assert.ok(geometry[i].top >= geometry[j].bottom || geometry[i].bottom <= geometry[j].top || geometry[i].left >= geometry[j].right || geometry[i].right <= geometry[j].left, JSON.stringify(geometry));
      }
      const submit = async (input, value) => { await input.fill(value); await input.dispatchEvent('change'); await input.dispatchEvent('blur'); try { await page.waitForFunction((id) => !document.getElementById(id).disabled, await input.getAttribute('id'), { timeout: 5000 }); }
        catch (error) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); fs.writeFileSync(path.join(output, 'browser-failure.json'), JSON.stringify({ errors, posted: await page.evaluate(() => window.__postedMessages) }, null, 2)); throw error; } };
      const before = writes;
      await submit(leaders, '3'); assert.equal(writes, before + 1); assert.equal(loadWorkspaceSettings(options).departmentMaxLeaders, 3);
      await submit(employees, '9'); assert.equal(loadWorkspaceSettings(options).departmentMaxEmployees, 9);
      await page.reload();
      await page.locator('body').evaluate((body, theme) => { body.className = `vscode-${theme}`; }, theme);
      await page.evaluate((state) => window.postMessage({ type: 'state', payload: state }, '*'), payload());
      await page.locator('#toolSettingsButton').click(); await page.locator('#toolSettingsWorkspaceTab').click();
      assert.equal(await leaders.inputValue(), '3'); assert.equal(await employees.inputValue(), '9');
      await submit(leaders, ''); assert.equal(loadWorkspaceSettings(options).departmentMaxLeaders, undefined); assert.equal(loadWorkspaceSettings(options).departmentMaxEmployees, 9);
      await submit(leaders, '0.5'); assert.match(await page.locator('#workspaceDepartmentMaxLeadersStatus').textContent(), /安全数字/);
      fail = true; await submit(leaders, '6');
      assert.equal(await leaders.inputValue(), ''); assert.match(await page.locator('#workspaceDepartmentMaxLeadersStatus').textContent(), /保存失败/);
      assert.equal(loadWorkspaceSettings(options).departmentMaxLeaders, undefined);
      await page.screenshot({ path: path.join(output, `${width}-${theme}-save-error.png`), fullPage: true });
      fail = false; await submit(leaders, '6'); assert.equal(loadWorkspaceSettings(options).departmentMaxLeaders, 6);
      await submit(leaders, ''); await submit(employees, '');
      await page.evaluate((state) => window.postMessage({ type: 'state', payload: { ...state, departmentMaxLeaders: 8, departmentMaxEmployees: 30 } }, '*'), payload());
      await page.waitForFunction(() => document.getElementById('workspaceDepartmentMaxLeaders').placeholder === '全局：8');
      assert.equal(await employees.getAttribute('placeholder'), '全局：30');
      assert.equal(await page.locator('body').getAttribute('class'), `vscode-${theme}`);
      await page.screenshot({ path: path.join(output, `${width}-${theme}.png`), fullPage: true });
      results.push({ width, theme, geometry, saved: loadWorkspaceSettings(options), checks: 'inherit/save/dedup/reload/clear/invalid/failure/retry/global-change' });
      await page.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
    console.log(JSON.stringify({ passed: true, output, scenarios: results.length }));
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch((error) => { fs.writeFileSync(path.join(output, 'failure.txt'), error.stack); console.error(error); process.exitCode = 1; });
