const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");

const dist = path.resolve(process.env.DEPARTMENT_ROLE_FORM_DIST || path.join(__dirname, "../dist"));
const output = path.resolve(process.env.DEPARTMENT_ROLE_FORM_EVIDENCE || "/tmp/department-role-model-form-smoke");
const playwright = process.env.PLAYWRIGHT_MODULE || "/tmp/department-role-form-playwright/node_modules/playwright";
const { chromium } = require(playwright);
require(path.join(dist, "test/vscodeMock.js")).installVscodeMock();
const { getWebviewHtml } = require(path.join(dist, "webview/viewContent.js"));
const { validateDepartmentRoleCandidate } = require(path.join(dist, "departmentConfiguration.js"));
const { handlePanelMessageWithDeps } = require(path.join(dist, "sessionMessageHandlers.js"));
const { trySaveWorkspaceSettings, loadWorkspaceSettings } = require(path.join(dist, "workspaceSettingsStore.js"));
fs.mkdirSync(output, { recursive: true });

const longModel = "model-" + "long-name-".repeat(15) + "final";
const panelState = (cli = "codex", mode = "department", scope = "fixture-workspace:director:r1") => ({
  currentCli: cli,
  interactiveMode: mode,
  departmentEnabled: true,
  departmentConfigurationScope: scope,
  departmentDirector: { cli, configId: "director-profile", model: "gpt-5", thinkingMode: "high", openCodeVariant: "high" },
  departmentRolePreferences: { leader: { cli: "opencode", configId: "old-open-profile", model: "model-a", thinkingMode: "high", openCodeVariant: null } },
  configState: { configs: [{ id: "director-profile", name: "Director" }], activeConfigId: "director-profile", revision: "r1" },
  configStateByCli: {
    codex: { configs: [{ id: "codex-target", name: "Codex target" }], activeConfigId: "codex-target", revision: "c1" },
    opencode: { configs: [{ id: "open-target", name: "OpenCode target" }], activeConfigId: "open-target", revision: "o1" },
  },
  modelState: {
    activeConfigIdByCli: { codex: "director-profile", opencode: "open-target" },
    selectedByCli: { codex: "gpt-5", opencode: "openai/gpt-5" },
    optionsByCli: { codex: ["gpt-5"], opencode: ["openai/gpt-5"] },
    modelIssuesByCli: {}, thinkingModeByCli: {},
    openCodeModels: { primary: "openai/gpt-5", secondary: "" },
  },
  conversationTabs: { activeTabId: "fixture-tab", tabs: [{ id: "fixture-tab", cli, sessionId: "fixture-session", createdAt: 1 }] },
  sessionState: { currentSessionId: "fixture-session", sessions: [] },
  chatMessageLimit: 100, loopGroupChatMessageLimit: 100, promptHistory: [], humanInteractionHistory: [],
  scheduledTasks: [], loopPlusAcceptancePlans: [], loopPlusAcceptancePlanSelection: "", cliEnabledByName: {},
  loopEnabled: true, loopPlusEnabled: true, rulePaths: { global: {}, project: {} }, interactive: { supported: true, enabled: true },
});

const candidateReply = (request, options = {}) => ({ type: "departmentRoleCandidates", scope: request.scope, role: request.role,
  requestId: request.requestId, candidates: { cli: request.cli, configId: request.configId,
    configs: [{ id: request.configId, name: "隔离 smoke 配置" }],
    models: options.models ?? (request.cli === "opencode" ? ["openai/gpt-5", longModel] : ["model-a", longModel]), supportsDefaultModel: options.supportsDefaultModel ?? true,
    defaultModel: options.defaultModel ?? (request.cli === "opencode" ? "openai/gpt-5" : "model-a"), thinkingByModel: { "model-a": ["low", "high"], "openai/gpt-5": ["low", "high"], [longModel]: ["high"] },
    variantsByModel: { "openai/gpt-5": ["high", "max"] } } });
const storeOptions = { workspaceSettingsDir: path.join(output, "workspace-settings"), workspaceKey: "department-role-smoke",
  isCliName: (value) => ["codex", "claude", "opencode", "grok", "kimi-code", "dsh", "zcode"].includes(value),
  isThinkingMode: (value) => ["off", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value),
  isInteractiveMode: (value) => ["coding", "loop", "loop_plus", "department"].includes(value), normalizeVisibleInteractiveMode: (value) => value,
  normalizeLoopMaxRounds: (value) => Number(value) || 1, sanitizeConversationTabRecord: () => null };
function saveRoleThroughProductionStore(message, candidate) {
  validateDepartmentRoleCandidate(message.preference, candidate);
  const current = loadWorkspaceSettings(storeOptions);
  const next = { ...current, departmentRoleRoutesByDirectorConfig: {
    ...current.departmentRoleRoutesByDirectorConfig,
    [message.directorConfigId]: { ...current.departmentRoleRoutesByDirectorConfig?.[message.directorConfigId], [message.role]: message.preference },
  } };
  const result = trySaveWorkspaceSettings(next, storeOptions);
  assert.equal(result.ok, true, `isolated production WorkspaceSettings write: ${result.error || ""}`);
  return loadWorkspaceSettings(storeOptions);
}
const themeCss = `:root{--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#ededed;--vscode-foreground:#ededed;--vscode-editorWidget-background:#252526;--vscode-editorWidget-foreground:#ededed;--vscode-input-background:#3c3c3c;--vscode-input-foreground:#f0f0f0;--vscode-input-border:#666;--vscode-widget-border:#666;--vscode-focusBorder:#77bbff;--vscode-descriptionForeground:#bdbdbd;--vscode-errorForeground:#ff7777;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-font-family:Arial,sans-serif;--vscode-font-size:13px}body.vscode-light{--vscode-editor-background:#fff;--vscode-editor-foreground:#222;--vscode-foreground:#222;--vscode-editorWidget-background:#f3f3f3;--vscode-editorWidget-foreground:#222;--vscode-input-background:#fff;--vscode-input-foreground:#222;--vscode-input-border:#aaa;--vscode-widget-border:#aaa;--vscode-focusBorder:#005fb8;--vscode-descriptionForeground:#555;--vscode-errorForeground:#b00020}`;
const generatedHtml = getWebviewHtml({ cspSource: "'self'" }).replace("<head>", `<head><style>${themeCss}</style>`);

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const errors = [];
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(generatedHtml);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
    page.on("response", (response) => { if (response.status() >= 400) errors.push(`http: ${response.status()} ${response.url()}`); });
    await page.addInitScript(() => {
      let saved = {};
      window.__posted = [];
      window.acquireVsCodeApi = () => ({ getState: () => saved, setState: (next) => { saved = next; }, postMessage: (message) => window.__posted.push(message) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    // Exercise initial production message order against the real host router.
    // Do not emit a second panel state or use role CLI changes/manual retry to heal it.
    for (const scenario of ["cold-department", "local-mode-entry", "warm-panel-entry"]) {
      const initialPage = await browser.newPage();
      initialPage.on("pageerror", (error) => errors.push(`${scenario}: ${error.message}`));
      initialPage.on("console", (message) => { if (message.type() === "error") errors.push(`${scenario}: ${message.text()}`); });
      initialPage.on("requestfailed", (request) => errors.push(`${scenario}: ${request.url()} ${request.failure()?.errorText}`));
      initialPage.on("response", (response) => { if (response.status() >= 400) errors.push(`${scenario}: HTTP ${response.status()}`); });
      await initialPage.addInitScript(() => {
        window.__posted = [];
        window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage: (message) => window.__posted.push(message) });
      });
      await initialPage.goto(`http://127.0.0.1:${server.address().port}`);
      const initialState = panelState("codex", scenario === "cold-department" ? "department" : "coding", "initialization:" + scenario);
      initialState.departmentRolePreferences = {};
      initialState.thinkingMode = scenario === "cold-department" ? "off" : "high";
      await initialPage.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), initialState);
      await initialPage.waitForFunction(() => document.getElementById("configSelect").value === "director-profile");
      if (scenario === "local-mode-entry") {
        await initialPage.locator("#interactiveModeSelect").selectOption("department");
      } else if (scenario === "warm-panel-entry") {
        await initialPage.evaluate((state) => window.postMessage({ type: "state", payload: { ...state, interactiveMode: "department", thinkingMode: "off" } }, "*"), initialState);
      }
      await initialPage.waitForFunction(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates").length === 2);
      const messages = await initialPage.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates"
        || message.type === "updateSetting" && (message.key === "thinkingMode" || message.key.startsWith("interactiveMode."))));
      let revision = 0;
      let hostMode = scenario === "local-mode-entry" ? "coding" : "department";
      const replies = [];
      const deps = {
        ensureWorkspaceSessionStore: () => {}, getCurrentCli: () => "codex", getActiveConfigIdForCli: () => "director-profile",
        getDepartmentConfigurationScope: () => initialState.departmentConfigurationScope,
        getDepartmentSelectionContextRevision: () => revision, invalidateDepartmentSelectionContext: () => { revision++; },
        isCliName: storeOptions.isCliName, isInteractiveMode: storeOptions.isInteractiveMode, isThinkingMode: storeOptions.isThinkingMode,
        normalizeThinkingModeForCli: (_cli, value) => value, saveWorkspaceSettings: () => {}, setCliModelThinkingMode: () => {},
        getSelectedCliModel: () => "gpt-5", getWorkspaceSettings: () => ({}),
        setWorkspaceInteractiveModeForCli: (_cli, mode) => { hostMode = mode; }, postPanelState: async () => {},
        readStoredToolSettings: () => ({ departmentEnabled: true }),
        readDepartmentConfigBinding: async () => ({ configId: "director-profile", revision: "r1", ready: true }),
        getDepartmentRoleCandidates: async (cli, configId) => candidateReply({ cli, configId }).candidates,
        postWebviewMessage: (message) => replies.push(message),
      };
      await Promise.all(messages.map((message) => handlePanelMessageWithDeps(message, deps)));
      assert.equal(hostMode, "department", scenario);
      assert.equal(replies.length, 2, scenario);
      assert.ok(replies.every((reply) => reply.candidates && !reply.error), `${scenario}: ${JSON.stringify(replies)}`);
      if (scenario !== "local-mode-entry") assert.ok(messages.some((message) => message.key === "thinkingMode" && message.value === "low"), `${scenario} normalizes unsupported Codex off before candidates`);
      for (const reply of replies) await initialPage.evaluate((message) => window.postMessage(message, "*"), reply);
      for (const role of ["leader", "employee"]) {
        const model = initialPage.locator(`#department-${role}-model`);
        await model.waitFor({ state: "visible" });
        assert.equal(await model.isDisabled(), false, `${scenario}: ${role} initial model enabled`);
        await model.selectOption("model-a");
        assert.ok(await initialPage.evaluate((expectedRole) => window.__posted.some((message) => message.type === "updateDepartmentRolePreference"
          && message.role === expectedRole && message.preference.model === "model-a"), role), `${scenario}: initial model selection saves`);
      }
      await initialPage.close();
    }
    const unsupportedPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    unsupportedPage.on("pageerror", (error) => errors.push(`unsupported-role: ${error.message}`));
    unsupportedPage.on("console", (message) => { if (message.type() === "error") errors.push(`unsupported-role: ${message.text()}`); });
    await unsupportedPage.addInitScript(() => {
      window.__posted = [];
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage: (message) => window.__posted.push(message) });
    });
    await unsupportedPage.goto(`http://127.0.0.1:${server.address().port}`);
    const unsupportedState = panelState();
    unsupportedState.departmentRolePreferences = {
      employee: { cli: "grok", configId: "grok-target", model: "grok-model", thinkingMode: null, openCodeVariant: null },
    };
    unsupportedState.configStateByCli.grok = { configs: [{ id: "grok-target", name: "Grok target" }], activeConfigId: "grok-target", revision: "g1" };
    unsupportedState.modelState.activeConfigIdByCli.grok = "grok-target";
    await unsupportedPage.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), unsupportedState);
    await unsupportedPage.waitForFunction(() => document.getElementById("configSelect").value === "director-profile");
    assert.deepEqual(await unsupportedPage.locator("#department-employee-cli option").evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["__missing__", ...require(path.join(dist, "cli/types.js")).CLI_LIST]);
    const supportedQuery = await unsupportedPage.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "employee").at(-1));
    assert.equal(supportedQuery.cli, "grok");
    assert.equal(supportedQuery.configId, "grok-target");
    await unsupportedPage.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(supportedQuery));
    await unsupportedPage.locator("#department-employee-model").selectOption("model-a");
    const supportedSave = await unsupportedPage.evaluate(() => window.__posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1));
    assert.equal(supportedSave.preference.cli, "grok");
    assert.equal(supportedSave.preference.model, "model-a");
    await unsupportedPage.close();
    const originalOpenCodeModelParent = await page.locator("#openCodePrimaryModelSelect").evaluate((node) => node.parentElement);
    const acknowledgeSave = async (message) => {
      const candidate = candidateReply({ cli: message.preference.cli, configId: message.preference.configId }).candidates;
      const saved = saveRoleThroughProductionStore(message, candidate);
      assert.deepEqual(saved.departmentRoleRoutesByDirectorConfig[message.directorConfigId][message.role], message.preference,
        "production validator and isolated WorkspaceSettings store preserve the exact browser payload");
      await page.evaluate((payload) => window.postMessage(payload, "*"), { ...message, type: "departmentRolePreferenceSaved", ok: true });
    };
    await page.locator("body").evaluate((body) => { body.className = "vscode-dark"; });
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), panelState());
    await page.locator("#departmentRoleConfiguration").waitFor({ state: "visible" });
    assert.equal(await page.locator(".department-performance-warning").count(), 0);
    assert.equal(await page.locator("#departmentRoleConfiguration").getByText("20 多个 CLI", { exact: false }).count(), 0);
    for (const id of ["departmentMaxEmployeesNote", "workspaceDepartmentMaxEmployeesNote"]) {
      assert.match(await page.locator("#" + id).textContent(), /根据本机性能设置.*20 多个 CLI/);
    }
    assert.equal(await page.locator("#department-leader-message, #department-employee-message").count(), 0);
    assert.equal(await page.locator("#department-employee-thinking").isVisible(), false);
    const initialRequests = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates"));
    assert.equal(initialRequests.length, 2);
    assert.deepEqual(initialRequests.map((request) => request.configId), ["open-target", "director-profile"], "one panel message applies the cross-CLI active map before role synchronization");
    assert.equal(initialRequests.find((request) => request.role === "leader").cli, "opencode");
    assert.equal(await page.locator("#department-leader-model").isDisabled(), true, "model waits for candidates");
    await page.evaluate((reply) => window.postMessage(reply, "*"), { ...initialRequests[1], type: "departmentRoleCandidates", error: "CLI、模式或配置作用域已变化，请重新加载角色候选。" });
    assert.equal(await page.locator("#department-employee-retry").isVisible(), true);
    assert.match(await page.locator("#departmentRoleMessage").innerText(), /失败.*重试/);
    assert.equal(await page.getByText("CLI、模式或配置作用域已变化，请重新加载角色候选。", { exact: true }).count(), 0);
    await page.locator("#department-employee-retry").click();
    const retryRequest = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "employee").at(-1));
    assert.notEqual(retryRequest.requestId, initialRequests[1].requestId);
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(initialRequests[0]));
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(retryRequest));
    const director = page.locator("#modelSelect");
    await director.focus();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp");
    await director.selectOption({ label: "gpt-5" });
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), panelState());
    assert.equal(await page.evaluate(() => document.activeElement?.id), "modelSelect", "same-parent panel render preserves keyboard focus");
    const directorMessage = await page.evaluate(() => window.__posted.filter((message) => ["selectCliModel", "updateOpenCodeRoleModel"].includes(message.type)).at(-1));
    assert.equal(directorMessage.type, "selectCliModel"); assert.equal(directorMessage.cli, "codex");
    assert.equal(directorMessage.model, "gpt-5", "director choice uses the existing primary model payload");
    await page.locator("#thinkingMode").selectOption("high");
    const directorThinkingMessage = await page.evaluate(() => window.__posted.filter((message) => message.type === "updateSetting" && message.key === "thinkingMode").at(-1));
    assert.deepEqual({ key: directorThinkingMessage.key, value: directorThinkingMessage.value }, { key: "thinkingMode", value: "high" });
    assert.equal(await page.locator("#department-leader-config").count(), 0);
    assert.equal(await page.locator("#department-employee-config").count(), 0);
    await page.locator("#department-leader-model").selectOption("__default__");
    const leaderSave = await page.evaluate(() => window.__posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1));
    assert.equal(leaderSave.preference.configId, "open-target");
    assert.equal(leaderSave.preference.model, null, "explicit default remains distinct from no selection");
    await page.locator("#interactiveModeSelect").selectOption("loop");
    await page.evaluate((message) => window.postMessage({ ...message, type: "departmentRolePreferenceSaved", ok: true }, "*"), leaderSave);
    assert.equal(await page.locator("#department-leader-retry").evaluate((node) => !node.hidden), true, "local mode change keeps the invalidated save retryable before host projection");
    await page.locator("#interactiveModeSelect").selectOption("department");
    const returnedModeQueries = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates").slice(-2));
    for (const request of returnedModeQueries) await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(request));
    await page.waitForFunction(() => document.getElementById("department-leader-model").options.length >= 2);
    await page.locator("#department-leader-model").selectOption("openai/gpt-5");
    const failedSave = await page.evaluate(() => window.__posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1));
    assert.notEqual(failedSave.requestId, leaderSave.requestId);
    await page.evaluate((message) => window.postMessage({ ...message, type: "departmentRolePreferenceSaved", ok: false, error: "隔离保存失败，请重试。" }, "*"), failedSave);
    assert.match(await page.locator("#departmentRoleMessage").innerText(), /失败/);
    await page.locator("#department-leader-retry").click();
    const leaderRetry = await page.evaluate(() => window.__posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1));
    assert.notEqual(leaderRetry.requestId, failedSave.requestId);
    await acknowledgeSave(leaderRetry);

    await page.locator("#department-leader-cli").selectOption("codex");
    const sameCli = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates").at(-1));
    assert.equal(sameCli.configId, "director-profile", "same CLI follows the current director profile");
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(sameCli));
    await page.locator("#department-leader-model").selectOption("model-a");
    const sameCliSave = await page.evaluate(() => window.__posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1));
    assert.equal(sameCliSave.preference.configId, "director-profile");
    assert.equal(sameCliSave.preference.thinkingMode, await page.locator("#department-leader-thinking").inputValue());
    assert.deepEqual(await page.locator("#department-leader-thinking option").evaluateAll((nodes) => nodes.map((node) => node.value)), ["low", "high"]);
    await acknowledgeSave(sameCliSave);

    await page.locator("#department-leader-cli").selectOption("opencode");
    const crossCli = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates").at(-1));
    assert.equal(crossCli.configId, "open-target");
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(crossCli));
    await page.locator("#department-leader-model").selectOption("openai/gpt-5");
    const openCodeModelSave = await page.evaluate(() => window.__posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1));
    assert.equal(openCodeModelSave.preference.configId, "open-target");
    await acknowledgeSave(openCodeModelSave);
    const opencodeVariant = page.locator("#department-leader-variant");
    assert.equal(await opencodeVariant.isVisible(), true);
    assert.deepEqual(await opencodeVariant.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value)), ["high", "max"]);
    assert.equal(await page.locator("#department-leader-thinking").isVisible(), false);
    await opencodeVariant.focus();
    await opencodeVariant.selectOption("max");
    const variantSave = await page.evaluate(() => window.__posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1));
    assert.equal(variantSave.preference.configId, "open-target");
    assert.equal(variantSave.preference.openCodeVariant, "max");
    assert.equal(variantSave.role, "leader"); assert.equal(variantSave.preference.cli, "opencode");
    await acknowledgeSave(variantSave);

    await page.locator("#currentCli").selectOption("opencode");
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), panelState("opencode"));
    assert.equal(await page.locator("#openCodePrimaryModelSelect").evaluate((node) => node.parentElement.id), "departmentDirectorControls");
    await page.locator("#currentCli").selectOption("codex");
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), panelState("codex"));
    assert.equal(await page.locator("#modelSelect").evaluate((node) => node.parentElement.id), "departmentDirectorControls");
    const changeModeWithoutPanel = async (mode) => {
      await page.locator("#interactiveModeSelect").selectOption(mode);
      assert.equal(await page.locator("#departmentRoleConfiguration").isVisible(), mode === "department", `${mode} department visibility`);
      assert.equal(await page.locator("#interactiveModeSelect").inputValue(), mode);
      const modeUpdate = await page.evaluate((expectedMode) => window.__posted.filter((message) => message.type === "updateSetting"
        && message.key === "interactiveMode." + document.getElementById("currentCli").value && message.value === expectedMode).at(-1), mode);
      assert.ok(modeUpdate, `${mode} change posts the existing interactive-mode setting`);
    };
    await changeModeWithoutPanel("coding");
    assert.equal(await page.locator("#modelSelect").isVisible(), true, "Codex coding restores the single model selector immediately");
    assert.equal(await page.locator("#modelSelect").isDisabled(), false);
    assert.equal(await page.locator("#codexLoopModelGroup").isVisible(), false);
    assert.equal(await page.locator("#codexLoopMainModelSelect").isDisabled(), true);
    await changeModeWithoutPanel("loop");
    assert.equal(await page.locator("#codexLoopModelGroup").isVisible(), true, "Codex Loop exposes its role model group immediately");
    assert.equal(await page.locator("#codexLoopMainModelSelect").isDisabled(), false);
    assert.equal(await page.locator("#codexLoopSubtaskModelSelect").isDisabled(), false);
    assert.equal(await page.locator("#modelSelect").isVisible(), false);
    assert.equal(await page.locator("#modelSelect").isDisabled(), true);
    await changeModeWithoutPanel("loop_plus");
    assert.equal(await page.locator("#codexLoopModelGroup").isVisible(), true, "Codex Loop+ keeps its role model group available");
    assert.equal(await page.locator("#codexLoopMainModelSelect").isDisabled(), false);
    await changeModeWithoutPanel("department");
    assert.equal(await page.locator("#modelSelect").evaluate((node) => node.parentElement.id), "departmentDirectorControls");
    assert.equal(await page.locator("#modelSelect").isVisible(), true, "returning to department restores the director model control");
    assert.equal(await page.locator("#openCodePrimaryModelSelect").evaluate((node) => node.parentElement), originalOpenCodeModelParent,
      "mode and CLI round trips restore the exact original OpenCode model parent");

    await page.locator("#currentCli").selectOption("opencode");
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), panelState("opencode"));
    await changeModeWithoutPanel("coding");
    assert.equal(await page.locator("#openCodeModelGroup").isVisible(), true, "OpenCode keeps its primary model control in coding mode");
    assert.equal(await page.locator("#openCodeSmallModelSelect").isVisible(), false);
    assert.equal(await page.locator("#openCodeSmallModelSelect").isDisabled(), true);
    await changeModeWithoutPanel("loop");
    assert.equal(await page.locator("#openCodeSmallModelSelect").isVisible(), true, "OpenCode Loop enables its subtask model control immediately");
    assert.equal(await page.locator("#openCodeSmallModelSelect").isDisabled(), false);
    await page.locator("#currentCli").selectOption("claude");
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), panelState("claude"));
    await changeModeWithoutPanel("coding");
    assert.equal(await page.locator("#claudeLoopSubtaskGroup").isVisible(), false);
    await changeModeWithoutPanel("loop_plus");
    assert.equal(await page.locator("#claudeLoopSubtaskGroup").isVisible(), true, "Claude Loop+ restores its subtask route immediately");
    await page.locator("#currentCli").selectOption("codex");
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), panelState("codex"));
    await changeModeWithoutPanel("department");

    await page.locator("#department-employee-cli").selectOption("opencode");
    const pendingTargetQuery = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "employee").at(-1));
    const revisedTarget = panelState("codex"); revisedTarget.configStateByCli.opencode.revision = "o2";
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), revisedTarget);
    const revisionQuery = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "employee").at(-1));
    assert.notEqual(revisionQuery.requestId, pendingTargetQuery.requestId, "same config ID with new revision replaces the request token");
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(pendingTargetQuery));
    assert.equal(await page.locator("#department-employee-model").isDisabled(), true, "late prior-revision candidate cannot unlock the row");
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(revisionQuery));

    const changedIdState = panelState("codex");
    changedIdState.modelState.activeConfigIdByCli.opencode = "open-target-2";
    changedIdState.configStateByCli.opencode = { configs: [{ id: "open-target-2", name: "OpenCode target 2" }], activeConfigId: "open-target-2", revision: "o3" };
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), changedIdState);
    const changedIdQuery = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "employee").at(-1));
    assert.equal(changedIdQuery.configId, "open-target-2");
    assert.equal(await page.locator("#department-employee-model").isDisabled(), true, "config ID change clears the prior candidate before loading");
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(changedIdQuery));

    await page.evaluate((state) => {
      state.modelState.activeConfigIdByCli.opencode = null;
      state.configStateByCli.opencode.activeConfigId = null;
      window.postMessage({ type: "state", payload: state }, "*");
    }, panelState("codex"));
    await page.locator("#department-employee-cli").selectOption("opencode");
    assert.match(await page.locator("#departmentRoleMessage").innerText(), /顶部配置入口/);
    assert.equal(await page.locator("#department-employee-model").isDisabled(), true);

    const emptyState = panelState("codex");
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), emptyState);
    await page.locator("#department-employee-cli").selectOption("codex");
    const emptyQuery = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "employee").at(-1));
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(emptyQuery, { models: [], supportsDefaultModel: false, defaultModel: null }));
    assert.match(await page.locator("#departmentRoleMessage").innerText(), /没有可用模型/);
    assert.equal(await page.locator("#department-employee-model").isDisabled(), true);
    assert.equal(await page.locator("#department-employee-thinking").isVisible(), false);
    const readyState = panelState("codex", "department", "fixture-workspace:ready:r1");
    readyState.departmentRolePreferences = {
      leader: { cli: "codex", configId: "director-profile", model: "model-a", thinkingMode: "high", openCodeVariant: null },
      employee: { cli: "codex", configId: "director-profile", model: "model-a", thinkingMode: "high", openCodeVariant: null },
    };
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), readyState);
    const readyQueries = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates").slice(-2));
    for (const request of readyQueries) await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(request));
    await page.waitForFunction(() => document.getElementById("departmentRoleMessage").textContent === "");
    const assertRolePosition = async () => {
      const positions = await page.evaluate(() => {
        const box = document.querySelector(".input-box");
        const roles = document.getElementById("departmentRoleConfiguration");
        const actions = document.querySelector(".input-actions");
        return { inputBottom: box.getBoundingClientRect().bottom, rolesTop: roles.getBoundingClientRect().top,
          rolesBottom: roles.getBoundingClientRect().bottom, actionsTop: actions.getBoundingClientRect().top,
          footer: roles.parentElement.className };
      });
      assert.equal(positions.footer, "input-footer");
      assert.ok(positions.rolesTop >= positions.inputBottom && positions.actionsTop >= positions.rolesBottom,
        `input -> role configuration -> send actions: ${JSON.stringify(positions)}`);
    };
    await assertRolePosition();
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth }));
    assert.ok(overflow.document <= overflow.viewport + 1 && overflow.body <= overflow.viewport + 1, JSON.stringify(overflow));
    await page.screenshot({ path: path.join(output, "department-form-desktop-dark.png"), fullPage: true });

    await page.setViewportSize({ width: 280, height: 900 });
    await page.locator("body").evaluate((body) => { body.className = "vscode-light"; });
    await page.evaluate((state) => window.postMessage({ type: "state", payload: state }, "*"), readyState);
    await page.locator("#department-employee-cli").selectOption("codex");
    const narrowEmployeeQuery = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates" && message.role === "employee").at(-1));
    await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(narrowEmployeeQuery));
    const narrowRequests = await page.evaluate(() => window.__posted.filter((message) => message.type === "requestDepartmentRoleCandidates").slice(-2));
    for (const request of narrowRequests) await page.evaluate((reply) => window.postMessage(reply, "*"), candidateReply(request));
    await page.waitForFunction(() => document.getElementById("department-employee-model").options.length >= 3);
    await page.locator("#department-employee-model").selectOption(longModel);
    const longModelSave = await page.evaluate(() => window.__posted.filter((message) => message.type === "updateDepartmentRolePreference").at(-1));
    assert.equal(longModelSave.preference.model, longModel);
    await acknowledgeSave(longModelSave);
    assert.equal(await page.locator("#department-employee-model").getAttribute("title"), longModel);
    const narrowOverflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth }));
    assert.ok(narrowOverflow.document <= narrowOverflow.viewport + 1 && narrowOverflow.body <= narrowOverflow.viewport + 1, JSON.stringify(narrowOverflow));
    await assertRolePosition();
    await page.screenshot({ path: path.join(output, "department-form-280-light.png"), fullPage: true });
    assert.deepEqual(errors, []);
    fs.rmSync(path.join(output, "failure.txt"), { force: true });
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ passed: true, fixture: "generated production Webview, real host message router for initialization, isolated WorkspaceSettings persistence; no real CLI/EH", inputs: { dist, generatedHtmlSha256: crypto.createHash("sha256").update(generatedHtml).digest("hex"), viewportWidths: [1280, 280], themeClasses: ["vscode-dark", "vscode-light"] }, checks: ["initial role loading through production host: cold restore, local mode entry, warm panel with thinking normalization", "performance guidance only in employee capacity notes", "concrete role effort selection without inherit options or right-side stale message", "same-message active config map", "director exact model and thinking messages", "role controls and same/cross-CLI config binding", "production candidate validation and isolated WorkspaceSettings persistence", "explicit default and OpenCode variant", "local mode change and ABA stale save", "target config ID and same-ID revision invalidation", "missing target and empty model states", "candidate error and save failure retry", "keyboard input and same-parent focus retention", "director CLI/mode round trips", "long model accessible title", "desktop and narrow overflow", "strict pageerror/console/request/HTTP checks"], errors, screenshots: ["department-form-desktop-dark.png", "department-form-280-light.png"] }, null, 2));
    await page.close();
  } catch (error) {
    fs.writeFileSync(path.join(output, "failure.txt"), error.stack || String(error));
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
