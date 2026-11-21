"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), cp = require("node:child_process"), crypto = require("node:crypto");
const { isolatedEnvironment, createDepartmentWebviewAdapter } = require("./verify_department_full_eh_integration");
const { createLocalResponsesServer } = require("./fixtures/codex_local_responses_server");
const { createDepartmentEmployeeAllocationEhScenario } = require("./fixtures/department_employee_allocation_eh_scenario");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
// The reused old observer emits literal \\n separators; the new allocation observer emits LF.
function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8"), result = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) {
      if (/\s/.test(c)) continue;
      if (c === "\\" && text[i + 1] === "n") { i++; continue; }
      assert.equal(c, "{", "unexpected observer framing"); start = i; depth = 1; continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) { result.push(JSON.parse(text.slice(start, i + 1))); start = -1; }
    }
  }
  assert.equal(start, -1, "partial observer event"); return result;
}
function argumentsFor(argv) {
  assert.ok(argv.length === 4 || argv.length === 5 && argv[4] === "--workspace-capacity", "use --product <built-worktree> --report <new-json> [--workspace-capacity]");
  assert.equal(argv[0], "--product"); assert.equal(argv[2], "--report");
  assert.ok(argv[1] && argv[3]); return { product: path.resolve(argv[1]), report: path.resolve(argv[3]), workspaceCapacity: argv.length === 5 };
}
function assertSavedTransition(before, after, leaderId, manualLimit) {
  assert.equal(after.employeeAllocation.revision, before.employeeAllocation.revision + 1);
  assert.equal(after.employeeAllocation.leaders.find(r => r.leaderTaskId === leaderId).manualLimit, manualLimit);
  assert.equal(after.employeeAllocation.leaders.find(r => r.leaderTaskId === leaderId).appliedLimit,
    before.employeeAllocation.leaders.find(r => r.leaderTaskId === leaderId).appliedLimit, "save applied early");
  assert.deepEqual(after.capacity, before.capacity, "save altered live capacity");
  assert.deepEqual(after.executionBindings, before.executionBindings, "save altered existing Owners");
  assert.deepEqual(after.leaderExecutionSets, before.leaderExecutionSets, "save altered responsibilities");
}
function assertSettled(events, rootId, leaderId, beforeRevision, value, revision, defaultLimit = 5) {
  const requests = events.filter(e => e.event === "webview-request" && e.message.leaderTaskId === leaderId
    && e.message.expectedRevision === beforeRevision && e.message.employeeLimit === value);
  assert.equal(requests.length, 1, "exact real host request required");
  const request = requests[0].message;
  const replies = events.filter(e => e.event === "webview-settled" && e.message.requestId === request.requestId);
  assert.equal(replies.length, 1, "matching real host settled required");
  assert.deepEqual(replies[0].message, { type: "loopGroupChatChat:departmentEmployeeLimitSettled", rootTaskId: rootId,
    leaderTaskId: leaderId, requestId: request.requestId, ok: true, revision, desiredLimit: value ?? defaultLimit });
  return { request, settled: replies[0].message };
}
function assertCleanup(saved, observations, protocol, identityApi, receiptApi, workerEvents, executionCount) {
  const bindings = saved.executionBindings ?? [], sets = saved.leaderExecutionSets ?? [];
  assert.equal(bindings.length, executionCount, "expected original execution bindings for every owner");
  assert.equal(sets.length, 1); const set = sets[0];
  assert.equal(set.state, "closed"); assert.ok(set.closure); assert.equal(set.entries.length, bindings.length);
  assert.deepEqual(set.closure.scope, set.scope); assert.equal(set.closure.producerId, set.producerId);
  assert.deepEqual(new Set(set.entries.map(e => e.executionId)), new Set(bindings.map(b => b.identity.executionId)));
  for (const binding of bindings) {
    const id = binding.identity;
    const original = observations.filter(o => identityApi.sameExecution(o.identity, id)); assert.equal(original.length, 1);
    assert.equal(original[0].source, "original-client-waitForCleanup-return");
    const receipt = original[0].receipt;
    assert.equal(receiptApi.isDepartmentExecutionReceipt(receipt), true); assert.ok(identityApi.sameExecution(receipt.identity, id));
    assert.deepEqual(receipt.requirements, binding.requirements); assert.deepEqual(original[0].requirements, binding.requirements);
    assert.equal(identityApi.cleanupComplete(receipt.cleanup, binding.requirements), true, "required receipt incomplete");
    const entry = set.entries.find(e => e.executionId === id.executionId);
    assert.deepEqual(entry.responsibility.selection, binding.selection); assert.deepEqual(entry.responsibility.requirements, binding.requirements);
    const events = protocol.filter(e => e.identity?.ownerId === id.ownerId); assert.ok(events.length);
    const pid = events[0].pid;
    assert.ok(workerEvents.some(e => e.pid === pid && e.event === "worker-exit" && e.code === 0 && !e.signal), "original worker did not exit naturally");
  }
  assert.deepEqual(saved.capacity.leaders, []); assert.deepEqual(saved.capacity.employees, []);
  assert.ok(!saved.capacity.employeeOverflow?.length);
  return { owners: bindings.length, closedSets: sets.length, complete: true };
}
function assertWorkspaceSaved(events, key, value, workspaceKey, durable, globalSettings) {
  const requests = events.filter(e => e.event === "settings-request" && e.message.key === key);
  assert.equal(requests.length, 1, "one actual UI settings request required");
  const request = requests[0].message;
  assert.equal(request.type, "updateSetting"); assert.equal(request.value.value, value);
  assert.equal(typeof request.value.scope, "string"); assert.ok(request.value.scope);
  assert.equal(JSON.parse(request.value.scope)[0], workspaceKey, "actual active workspace scope required");
  assert.equal(typeof request.value.requestId, "string"); assert.ok(request.value.requestId);
  const replies = events.filter(e => e.event === "settings-saved" && e.message.requestId === request.value.requestId);
  assert.equal(replies.length, 1, "exact settings persistence reply required");
  const reply = replies[0];
  assert.deepEqual(reply.message, { type: "workspaceDepartmentCapacitySaved", key, scope: request.value.scope, requestId: request.value.requestId, ok: true });
  const field = key === "workspaceDepartmentMaxLeaders" ? "departmentMaxLeaders" : "departmentMaxEmployees";
  assert.equal(reply.workspaceSettings[workspaceKey + ".json"]?.[field], value, "reply must follow actual persistence");
  assert.equal(durable[field], value);
  const state = events.filter(e => e.event === "settings-state" && e.state.departmentConfigurationScope === request.value.scope).at(-1)?.state;
  assert.ok(state, "matching panel state required"); assert.equal(state[key], value);
  assert.deepEqual([state.departmentMaxLeaders, state.departmentMaxEmployees], [4, 20]);
  assert.deepEqual([globalSettings.departmentMaxLeaders, globalSettings.departmentMaxEmployees], [4, 20]);
  return { request, reply, state, durable };
}
async function publicDepartmentEntry(view, prompt, wait, workspaceSettingsAction) {
  await view.locator("#toolSettingsButton").click();
  if (workspaceSettingsAction) await workspaceSettingsAction();
  await view.locator("#departmentEnabled").waitFor();
  await view.locator("#departmentEnabled").check();
  await wait("public department enable", async () => !await view.locator("#departmentEnabled").isDisabled());
  await view.locator("#closeToolSettings").click(); await view.locator("#toolSettingsOverlay").waitFor({ state: "hidden" });
  // The director uses the ordinary CLI/profile/model controls, as shown in its summary.
  await view.locator("#currentCli").selectOption("codex");
  const directorProfile = view.locator("#configSelect");
  await wait("director profile ready", async () => await directorProfile.isEnabled()
    && (await directorProfile.locator("option").evaluateAll(nodes => nodes.map(n => n.value))).includes("codex-local"));
  await directorProfile.selectOption("codex-local");
  const directorModel = view.locator("#modelSelect");
  await wait("director model ready", async () => await directorModel.isEnabled()
    && (await directorModel.locator("option").evaluateAll(nodes => nodes.map(n => n.value))).includes("gpt-5"));
  await directorModel.selectOption("gpt-5");
  await view.locator("#interactiveModeSelect").selectOption("department");
  for (const role of ["leader", "employee"]) {
    const cli = view.locator(`#department-${role}-cli`), model = view.locator(`#department-${role}-model`);
    await wait(`${role} CLI ready`, async () => await cli.isEnabled()); await cli.selectOption("codex");
    await wait(`${role} model ready`, async () => await model.isEnabled()
      && (await model.locator("option").evaluateAll(nodes => nodes.map(n => n.value))).includes("__default__"));
    await model.selectOption("__default__");
    await wait(`${role} saved`, async () => await model.isEnabled());
  }
  await view.locator("#promptInput").fill(prompt); assert.equal(await view.locator("#sendPrompt").isEnabled(), true);
  await view.locator("#sendPrompt").click(); await view.locator("#acceptancePlanOverlay").waitFor();
  assert.ok(await view.locator("#acceptancePlanSelect").inputValue());
  await view.locator("#confirmAcceptancePlan").click(); await view.locator("#acceptancePlanOverlay").waitFor({ state: "hidden" });
}
async function main(argv = process.argv.slice(2)) {
  const input = argumentsFor(argv), product = input.product;
  assert.ok(!fs.existsSync(input.report), "report must be new");
  assert.ok(fs.existsSync(path.join(product, "dist/extension.js")));
  assert.equal(fs.lstatSync(path.join(product, "dist")).isSymbolicLink(), false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s-allocation-eh-"));
  const env = isolatedEnvironment(root), home = env.HOME, workspace = path.join(root, "workspace");
  const report = { startedAt: new Date().toISOString(), product, root, platform: process.platform, node: process.version, stages: {}, failures: [], result: "failed" };
  report.sourceIdentity = { commit: cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: product, encoding: "utf8" }).trim(),
    tree: cp.execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: product, encoding: "utf8" }).trim(),
    sha256: Object.fromEntries(["scripts/verify_department_employee_allocation_eh_integration.js", "scripts/fixtures/department_employee_allocation_eh_scenario.js",
      "src/test/extensionHost/fixtures/departmentemployeeallocationehhost.ts", "dist/test/extensionHost/fixtures/departmentemployeeallocationehhost.js",
      "src/extensionHost/departmentruntimestore.ts", "src/extensionHost/departmentemployeeallocationhost.ts", "src/extensionHost/departmentorchestration.ts",
      "src/extensionHost/loopPlusPromptBuilders.ts", "src/extensionHost/loopPlusRuntimeAdapter.ts", "src/extension.ts", "src/webview/departmentEmployeeAllocation.ts", "scripts/verify_department_full_eh_integration.js",
      "src/extensionHost/modelSettings.ts", "src/workspaceSettingsStore.ts", "src/departmentSettings.ts", "src/settingMessageHandlers/preferences.ts",
      "dist/extension.js", "dist/extensionHost/modelSettings.js", "dist/workspaceSettingsStore.js", "dist/departmentSettings.js",
      "dist/settingMessageHandlers/preferences.js", "dist/extensionHost/departmentemployeeallocationhost.js", "dist/webview/viewContent.js"]
      .map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(product, file))).digest("hex")])) };
  const fixture = require(path.join(product, "dist/test/extensionHost/fixtures/departmentemployeeallocationehhost.js"));
  const { DepartmentRuntimeStore } = require(path.join(product, "dist/extensionHost/departmentruntimestore.js"));
  const runtimeStore = new DepartmentRuntimeStore(path.join(home, ".sinitek_cli/department-runtime"));
  const taskDir = path.join(home, ".sinitek_cli/department-tasks-v1");
  const readTasks = () => fs.existsSync(taskDir) ? fs.readdirSync(taskDir).filter(n => n.endsWith(".json") && !n.startsWith("."))
    .flatMap(n => JSON.parse(fs.readFileSync(path.join(taskDir, n), "utf8")).tasks) : [];
  const readRuntime = rootId => {
    const task = readTasks().find(t => t.id === rootId); assert.ok(task);
    const result = runtimeStore.read(rootId, task.workspaceKey); assert.ok(result.ok && result.value, `runtime read failed: ${result.error}`); return result.value;
  };
  const budget = Number(process.env.SINITEK_ALLOCATION_EH_TIMEOUT_MS || 180000), deadline = Date.now() + budget;
  const prompt = `隔离员工额度真实链路 ${crypto.randomUUID()}，只验证免费本机文本协议，不访问外网。`;
  const expectedLimits = input.workspaceCapacity ? { maxLeaders: 2, maxEmployees: 6 } : { maxLeaders: 4, maxEmployees: 20 };
  report.expectedLimits = expectedLimits;
  const scenario = createDepartmentEmployeeAllocationEhScenario({ prompt, readTasks, readRuntime, expectedLimits,
    readDecision: (rootId, leaderId) => events().filter(e => e.event === "capacity-reader" && e.rootTaskId === rootId && e.leaderTaskId === leaderId).at(-1),
    holdTimeoutMs: budget });
  const responses = createLocalResponsesServer({ respond: scenario.respond, maxRequests: 24 });
  let child, exited = false, browser, view, group;
  const wait = async (label, check) => {
    report.activePhase = label;
    while (Date.now() < deadline) {
      responses.assertHealthy();
      assert.equal(fs.existsSync(path.join(root, "allocation-observer-errors.ndjson")), false, "allocation observer failed");
      assert.equal(fs.existsSync(path.join(root, "original-owner-observation-errors.ndjson")), false, "Owner observer failed");
      const result = await check(); if (result) return result;
      assert.equal(exited, false, `EH exited before ${label}`); await pause(100);
    }
    throw Error(`allocation EH deadline: ${label}`);
  };
  const events = () => readEvents(path.join(root, "allocation-host.ndjson"));
  try {
    for (const key of ["HOME", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR"])
      fs.mkdirSync(env[key], { recursive: true });
    for (const dir of [workspace, path.join(root, "user-data/User"), path.join(root, "extensions"), path.join(home, ".sinitek_cli"), path.join(env.CODEX_HOME, "__config")]) fs.mkdirSync(dir, { recursive: true });
    report.environment = Object.fromEntries(Object.entries(env).filter(([k]) => /^(HOME|USERPROFILE|CODEX_HOME|XDG_|APPDATA|LOCALAPPDATA|TMP|TEMP)/.test(k)));
    const lookup = cp.spawnSync(process.platform === "win32" ? "where.exe" : "which", ["codex"], { encoding: "utf8", env });
    const codex = process.env.SINITEK_CODEX_EXE || lookup.stdout.trim().split(/\r?\n/)[0]; assert.ok(codex && fs.existsSync(codex));
    const code = process.env.SINITEK_VSCODE_EXE || (process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/MacOS/Code"
      : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe") : "/usr/share/code/code");
    assert.ok(fs.existsSync(code));
    report.codex = { executable: codex, version: cp.spawnSync(codex, ["--version"], { encoding: "utf8", env }).stdout.trim() };
    await new Promise((resolve, reject) => responses.server.once("error", reject).listen(0, "127.0.0.1", resolve));
    const providerPort = responses.server.address().port;
    const config = `model = "gpt-5"\nmodel_provider = "sinetik_local"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[model_providers.sinetik_local]\nname = "Free allocation protocol"\nbase_url = "http://127.0.0.1:${providerPort}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`;
    fs.writeFileSync(path.join(env.CODEX_HOME, "config.toml"), config, { flag: "wx" });
    fs.writeFileSync(path.join(env.CODEX_HOME, "__config/codex-local.json"), JSON.stringify({ id: "codex-local", name: "隔离本机 Responses", platform: "codex", content: config, configContent: config, authContent: "{}", codexSkills: [], createdAt: Date.now(), updatedAt: Date.now() }), { flag: "wx" });
    fs.writeFileSync(path.join(env.CODEX_HOME, "__config/config-order.json"), JSON.stringify({ codex: ["codex-local"] }), { flag: "wx" });
    fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({ debug: true, humanInteractionEnabled: false, departmentMaxLeaders: 4, departmentMaxEmployees: 20,
      cliEnabledByName: { codex: true, claude: false, opencode: false, grok: false, dsh: false, "kimi-code": false, zcode: false } }), { flag: "wx" });
    const workspaceKey = `${path.basename(workspace).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 32)}_${crypto.createHash("sha256").update(workspace).digest("hex").slice(0, 12)}`;
    fs.mkdirSync(path.join(home, ".sinitek_cli/workspace-settings"));
    fs.writeFileSync(path.join(home, ".sinitek_cli/workspace-settings", `${workspaceKey}.json`), JSON.stringify({ currentCli: "codex", interactiveModeByCli: { codex: "coding" }, activeConfigIdByCli: { codex: "codex-local" } }), { flag: "wx" });
    fs.writeFileSync(path.join(root, "user-data/User/settings.json"), JSON.stringify({ "workbench.startupEditor": "none", "security.workspace.trust.enabled": false,
      "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false, "update.mode": "none", "telemetry.telemetryLevel": "off", "window.restoreWindows": "none",
      "sinitek-cli-tools.autoOpenPanel": false, "sinitek-cli-tools.humanInteractionNotifications": false, "sinitek-cli-tools.commands.codex": codex,
      "sinitek-cli-tools.args.codex": ["--dangerously-bypass-approvals-and-sandbox", "--sandbox", "danger-full-access"] }), { flag: "wx" });
    const entry = path.join(root, "allocation-eh-entry.js"); fs.writeFileSync(entry, fixture.createDepartmentEmployeeAllocationEhHostEntry({ root, timeoutMs: budget }), { flag: "wx" });
    // Ask the OS for an unused loopback debugger port; no shared profile or running VS Code connection.
    const net = require("node:net"), listener = net.createServer();
    await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
    const fd = fs.openSync(path.join(root, "vscode.log"), "w");
    child = cp.spawn(code, ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust", "--use-inmemory-secretstorage",
      `--remote-debugging-port=${port}`, "--remote-allow-origins=*", `--user-data-dir=${path.join(root, "user-data")}`, `--extensions-dir=${path.join(root, "extensions")}`,
      `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${entry}`, workspace], { env, stdio: ["ignore", fd, fd], windowsHide: true });
    fs.closeSync(fd); child.once("exit", (code, signal) => { exited = true; report.hostExit = { code, signal }; });
    child.once("error", error => { exited = true; report.spawnError = String(error); });
    report.host = await wait("host-ready", () => readJson(path.join(root, "host-ready.json"))); report.stages.host = "passed";
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    view = await createDepartmentWebviewAdapter(browser, "webviewView", 30000, { deadline, cleanupDeadline: deadline + 15000 });
    await publicDepartmentEntry(view, prompt, wait, input.workspaceCapacity && (async () => {
      await view.locator("#toolSettingsWorkspaceTab").click();
      const file = path.join(home, ".sinitek_cli/workspace-settings", workspaceKey + ".json");
      const original = readJson(file);
      assert.equal(original.departmentMaxLeaders, undefined); assert.equal(original.departmentMaxEmployees, undefined);
      report.workspaceSettings = [];
      for (const [key, value, globalValue] of [["workspaceDepartmentMaxLeaders", 2, 4], ["workspaceDepartmentMaxEmployees", 6, 20]]) {
        const input = view.locator("#" + key);
        await wait(key + " ready", () => input.isEnabled());
        assert.equal(await input.inputValue(), ""); assert.equal(await input.getAttribute("placeholder"), "全局：" + globalValue);
        await input.fill(String(value)); // Existing public change path, no bridge messages or private calls.
        await wait(key + " matched persistence and panel state", async () => events().some(e => e.event === "settings-saved" && e.message.key === key)
          && events().some(e => e.event === "settings-state" && e.state[key] === value) && await input.isEnabled());
        const saved = assertWorkspaceSaved(events(), key, value, workspaceKey, readJson(file), readJson(path.join(home, ".sinitek_cli/settings.json")));
        assert.equal(await input.inputValue(), String(value));
        assert.equal(await view.locator("#" + key + "Status").innerText(), "");
        assert.deepEqual(Object.fromEntries(Object.entries(saved.durable).filter(([k]) => !["departmentMaxLeaders", "departmentMaxEmployees"].includes(k))), original);
        report.workspaceSettings.push(saved);
      }
      report.stages.workspaceUiSave = "passed";
      await view.locator("#toolSettingsGeneralTab").click();
    })); report.stages.publicEntry = "passed";
    const held = await wait("two actual employee requests", () => {
      const s = scenario.snapshot(); return s.held["allocation-held"] && s.held["allocation-pulse"] && s;
    });
    const rootId = held.rootId, leaderId = held.leaderId;
    const before = readRuntime(rootId); assert.deepEqual([before.capacity.maxLeaders, before.capacity.maxEmployees], [expectedLimits.maxLeaders, expectedLimits.maxEmployees]);
    const defaultLimit = Math.ceil(before.employeeAllocation.maxEmployees / before.employeeAllocation.maxLeaders);
    assert.deepEqual([before.employeeAllocation.maxLeaders, before.employeeAllocation.maxEmployees], [expectedLimits.maxLeaders, expectedLimits.maxEmployees]);
    assert.equal(defaultLimit, input.workspaceCapacity ? 3 : 5);
    assert.equal(before.capacity.employees.length, 2); assert.equal(before.employeeAllocation.leaders[0].appliedLimit, defaultLimit);
    report.baseline = before;
    await view.locator("#openCurrentLoopGroupChat").click(); await view.close(); view = null;
    group = await createDepartmentWebviewAdapter(browser, "webviewPanel", 30000, { rootId, deadline, cleanupDeadline: deadline + 15000 });
    await group.locator('#panelActions [data-action="allocateEmployees"]').click();
    const selector = `#departmentAllocationDialog [data-allocation-root="${rootId}"][data-allocation-leader="${leaderId}"]`, row = group.locator(selector);
    await row.waitFor(); assert.equal(await row.locator("input").inputValue(), String(defaultLimit));
    await row.locator("input").fill("0"); await group.locator("#departmentAllocationSave").click();
    await wait("zero durable settled and UI readback", async () => {
      const s = readRuntime(rootId); return s.employeeAllocation.leaders[0].manualLimit === 0
        && await row.getAttribute("aria-busy") === "false" && (await row.innerText()).includes("新参考值已保存") && s;
    });
    const zeroSaved = readRuntime(rootId); assertSavedTransition(before, zeroSaved, leaderId, 0);
    report.zeroSaved = { saved: zeroSaved, ui: await row.innerText(), confirmation: assertSettled(events(), rootId, leaderId, before.employeeAllocation.revision, 0, zeroSaved.employeeAllocation.revision) };
    report.stages.saveZero = "passed";
    scenario.release("allocation-pulse");
    const atZero = await wait("new attempt runs at zero reference", () => scenario.snapshot().held["allocation-zero"]);
    const runningAtZero = readRuntime(rootId);
    assert.equal(runningAtZero.employeeAllocation.leaders[0].appliedLimit, 0);
    assert.equal(runningAtZero.capacity.employees.length, 2);
    for (const attempt of [held.held["allocation-held"], atZero]) {
      assert.ok(runningAtZero.capacity.employees.includes(JSON.stringify([leaderId, attempt.attemptId])));
      assert.ok(runningAtZero.executionBindings.some(b => b.identity.subtaskId === attempt.subtaskId && b.identity.attemptId === attempt.attemptId));
    }
    scenario.release("allocation-zero");
    await wait("zero reference review", () => scenario.history.some(h => h.stage === "leader-zero-applied"));
    const applied = readRuntime(rootId);
    assert.equal(applied.capacity.employees.length, 1);
    report.zeroApplied = { saved: applied, running: runningAtZero, attempt: atZero }; report.stages.dispatchAtZero = "passed";
    await wait("zero applied UI", async () => (await row.innerText()).includes("上次派发参考 0"));
    await group.locator('#panelActions [data-action="allocateEmployees"]').click();
    await row.locator("input").fill(String(defaultLimit)); await group.locator("#departmentAllocationSave").click();
    const restored = await wait("restore durable settled and UI readback", async () => {
      const s = readRuntime(rootId); return s.employeeAllocation.leaders[0].manualLimit === defaultLimit && await row.getAttribute("aria-busy") === "false"
        && (await row.innerText()).includes("新参考值已保存") && await row.locator("input").inputValue() === String(defaultLimit) && s;
    });
    assertSavedTransition(applied, restored, leaderId, defaultLimit);
    report.restoreSaved = { mode: "manual", saved: restored, ui: await row.innerText(), confirmation: assertSettled(events(), rootId, leaderId, applied.employeeAllocation.revision, defaultLimit, restored.employeeAllocation.revision, defaultLimit) };
    report.stages.restoreSave = "passed"; scenario.release("restore-saved");
    await wait("new restored employee admitted", () => scenario.snapshot().held["allocation-restored"]);
    const admitted = readRuntime(rootId), next = scenario.snapshot().held["allocation-restored"];
    assert.equal(admitted.employeeAllocation.leaders[0].appliedLimit, defaultLimit); assert.equal(admitted.capacity.employees.length, 2);
    assert.ok(admitted.capacity.employees.includes(JSON.stringify([leaderId, next.attemptId])));
    assert.ok(admitted.executionBindings.some(b => b.identity.subtaskId === next.subtaskId && b.identity.attemptId === next.attemptId));
    assert.ok(admitted.capacity.employees.includes(JSON.stringify([leaderId, held.held["allocation-held"].attemptId])), "original held lease retained");
    assert.deepEqual(admitted.executionBindings.find(b => b.identity.attemptId === held.held["allocation-held"].attemptId), before.executionBindings.find(b => b.identity.attemptId === held.held["allocation-held"].attemptId));
    assert.ok(!admitted.capacity.employeeOverflow?.length); report.restoreApplied = admitted; report.stages.restoreAdmission = "passed";
    // A real employee event forces one final decision-time prompt after restored admission.
    scenario.release("allocation-restored");
    await wait("restored prompt captured", () => scenario.history.some(h => h.stage === "leader-restored-applied"));
    await group.locator('#panelActions [data-action="stopTask"]').click();
    scenario.releaseAll();
    const identityApi = require(path.join(product, "dist/runtime/departmentexecutionidentity.js"));
    const receiptApi = require(path.join(product, "dist/runtime/departmentexecutionreceiptstore.js"));
    report.cleanup = await wait("original receipts CLOSED returned capacity natural workers", () => {
      const saved = readRuntime(rootId);
      if (saved.capacity.employees.length || saved.capacity.leaders.length || !saved.leaderExecutionSets?.every(s => s.state === "closed")) return null;
      const protocol = readEvents(path.join(root, "original-owner-protocol.ndjson"));
      const observations = readEvents(path.join(root, "original-owner-observations.ndjson"));
      const executionCount = 5;
      if (observations.length < executionCount || events().filter(e => e.event === "worker-exit" && e.code === 0 && !e.signal).length < executionCount) return null;
      return { saved, result: assertCleanup(saved, observations, protocol, identityApi, receiptApi, events(), executionCount), observations, workers: events().filter(e => e.event.startsWith("worker-")) };
    });
    report.stages.cleanup = "passed";
    responses.assertHealthy(); report.result = "passed";
  } catch (error) { report.failures.push({ phase: report.activePhase, error: error.stack || String(error) }); }
  finally {
    scenario.releaseAll();
    if (report.result !== "passed" && group) {
      try { const stop = group.locator('#panelActions [data-action="stopTask"]'); if (await stop.isEnabled()) await stop.click(); }
      catch (error) { report.failureStop = String(error); }
    }
    if (report.result !== "passed" && group) {
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        const id = scenario.snapshot().rootId;
        const saved = id && readRuntime(id);
        if (saved && saved.capacity.employees.length === 0 && saved.capacity.leaders.length === 0
          && saved.leaderExecutionSets?.every(set => set.state === "closed")) {
          report.failureCleanup = { observed: true, saved }; break;
        }
        await pause(100);
      }
      if (!report.failureCleanup) report.failureCleanup = { observed: false, reason: "public stop cleanup not confirmed; retained state is not cleanup evidence" };
    }
    for (const adapter of [group, view]) if (adapter) {
      try { const diagnostics = await adapter.close(); assert.deepEqual(diagnostics, []); }
      catch (error) { report.failures.push({ phase: "adapter-cleanup", error: String(error) }); }
    }
    if (browser) await browser.close().catch(error => report.failures.push({ phase: "cdp-disconnect", error: String(error) }));
    if (child && !exited) {
      fs.writeFileSync(path.join(root, "host-finish.signal"), "normal-host-test-return\n", { flag: "wx" });
      const end = Date.now() + 15000; while (!exited && Date.now() < end) await pause(100);
      if (!exited) { report.failures.push({ phase: "host-exit", error: "normal EH exit not observed; no forced kill used" }); child.unref(); }
    }
    if (report.hostExit?.code !== 0 || report.hostExit?.signal) report.failures.push({ phase: "host-exit", error: JSON.stringify(report.hostExit) });
    if (responses.server.listening) { responses.server.closeAllConnections(); await new Promise(resolve => responses.server.close(resolve)); }
    report.scenario = scenario.snapshot(); report.responses = { count: responses.requests.length, failures: responses.failures };
    fs.writeFileSync(path.join(root, "responses-requests.json"), JSON.stringify(responses.requests, null, 2), { flag: "wx" });
    report.finishedAt = new Date().toISOString();
    if (report.failures.length) report.result = "failed";
    fs.mkdirSync(path.dirname(input.report), { recursive: true }); fs.writeFileSync(input.report, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ report: input.report, root, result: report.result, stages: report.stages, failures: report.failures }, null, 2));
  }
  return report;
}
// Re-assess existing immutable run inputs after a harness-only assertion repair.
// No launch, writer, task mutation, receipt production, migration or cleanup calls.
function verifyCapturedRun(reportFile) {
  const report = readJson(reportFile); assert.ok(report?.sourceIdentity && report.cleanup === undefined);
  assert.equal(report.result, "failed");
  assert.ok(report.failures.length > 0 && report.failures.every(f => f.phase === "original receipts CLOSED returned capacity natural workers"),
    "only the known close-event wait failure may be reassessed");
  for (const stage of ["host", "publicEntry", "saveZero", "refuseZero", "restoreSave", "restoreAdmission"]) assert.equal(report.stages[stage], "passed", stage);
  const checkedHashes = {};
  for (const [file, hash] of Object.entries(report.sourceIdentity.sha256)) {
    // Only this assertion's source changed. Its original fingerprint is retained.
    if (file === "scripts/verify_department_employee_allocation_eh_integration.js") continue;
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(report.product, file))).digest("hex");
    assert.equal(actual, hash, `run input changed: ${file}`); checkedHashes[file] = actual;
  }
  const baseline = report.baseline, rootId = baseline.rootTaskId, leaderId = baseline.runtime.leaders[0].taskId;
  const restoredManualLimit = report.restoreSaved.mode === "manual" ? Math.ceil(baseline.capacity.maxEmployees / baseline.capacity.maxLeaders) : null;
  assertSavedTransition(baseline, report.zeroSaved.saved, leaderId, 0);
  assertSavedTransition(report.zeroApplied.saved, report.restoreSaved.saved, leaderId, restoredManualLimit);
  const events = readEvents(path.join(report.root, "allocation-host.ndjson"));
  assertSettled(events, rootId, leaderId, baseline.employeeAllocation.revision, 0, report.zeroSaved.saved.employeeAllocation.revision);
  assertSettled(events, rootId, leaderId, report.zeroApplied.saved.employeeAllocation.revision, restoredManualLimit, report.restoreSaved.saved.employeeAllocation.revision);
  assert.equal(report.responses.failures.length, 0);
  const captured = readJson(path.join(report.root, "responses-requests.json"));
  const expected = [
    ["leader-initial", { revision: 1, desiredLimit: 5, appliedLimit: null, pending: true, activeEmployees: 0, globalActiveEmployees: 0, availableEmployees: 5 }],
    ["leader-zero-pending", { revision: report.zeroSaved.saved.employeeAllocation.revision, desiredLimit: 0, appliedLimit: 5, pending: true, activeEmployees: 1, globalActiveEmployees: 1, availableEmployees: 0 }],
    ["leader-zero-applied", { revision: report.zeroApplied.saved.employeeAllocation.revision, desiredLimit: 0, appliedLimit: 0, pending: false, activeEmployees: 1, globalActiveEmployees: 1, availableEmployees: 0 }],
    ["leader-restored-applied", { revision: report.restoreApplied.employeeAllocation.revision, desiredLimit: 5, appliedLimit: 5, pending: false, activeEmployees: 1, globalActiveEmployees: 1, availableEmployees: 4 }],
  ];
  for (const [stage, allocation] of expected) {
    const requests = captured.filter(r => r.stage === stage); assert.equal(requests.length, 1, stage);
    assert.deepEqual(requests[0].allocation, allocation);
    const snapshot = stage === "leader-initial" ? { employeeAllocation: { ...baseline.employeeAllocation, revision: 1,
      leaders: [{ leaderTaskId: leaderId, manualLimit: null, appliedLimit: null }] }, capacity: { employees: [] } }
      : stage === "leader-zero-pending" ? { ...report.zeroSaved.saved, capacity: report.zeroApplied.saved.capacity }
      : stage === "leader-zero-applied" ? report.zeroApplied.saved
      : { ...report.restoreApplied, capacity: { ...report.restoreApplied.capacity, employees: report.zeroApplied.saved.capacity.employees } };
    require("./fixtures/department_employee_allocation_eh_scenario").assertAllocationPrompt(requests[0].prompt, snapshot, leaderId, true);
  }
  const { DepartmentRuntimeStore } = require(path.join(report.product, "dist/extensionHost/departmentruntimestore.js"));
  const read = new DepartmentRuntimeStore(path.join(report.root, "home/.sinitek_cli/department-runtime")).read(rootId, baseline.workspaceKey);
  assert.ok(read.ok && read.value);
  assert.equal(read.value.runtime.stopping, true); assert.equal(read.value.runtime.leaders[0].status, "paused");
  const observations = readEvents(path.join(report.root, "original-owner-observations.ndjson"));
  const protocol = readEvents(path.join(report.root, "original-owner-protocol.ndjson"));
  assert.equal(fs.existsSync(path.join(report.root, "allocation-observer-errors.ndjson")), false);
  assert.equal(fs.existsSync(path.join(report.root, "original-owner-observation-errors.ndjson")), false);
  const result = assertCleanup(read.value, observations, protocol,
    require(path.join(report.product, "dist/runtime/departmentexecutionidentity.js")),
    require(path.join(report.product, "dist/runtime/departmentexecutionreceiptstore.js")), events, 4);
  assert.equal(report.hostExit.code, 0); assert.equal(report.hostExit.signal, null);
  const workerExits = events.filter(e => e.event === "worker-exit"); assert.equal(workerExits.length, 4);
  const finishSignalAt = fs.statSync(path.join(report.root, "host-finish.signal")).mtimeMs;
  assert.ok(workerExits.every(e => e.at < finishSignalAt), "worker exit must precede even the normal host finish signal");
  const evidenceSha256 = Object.fromEntries(["allocation-host.ndjson", "original-owner-observations.ndjson", "original-owner-protocol.ndjson", "responses-requests.json", "host-ready.json"]
    .map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(report.root, file))).digest("hex")]));
  return { result: "passed", sourceRun: path.resolve(reportFile), sourceRunSha256: crypto.createHash("sha256").update(fs.readFileSync(reportFile)).digest("hex"),
    root: report.root, checkedHashes, evidenceSha256, finishSignalAt, verifierSha256: crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"), originalFailure: report.failures, repairedAssertion: "actual exit code 0 and null signal; Electron close event is not required",
    cleanup: { ...result, saved: read.value, observations, workerExits }, promptStages: expected.map(([stage]) => stage), verifiedAt: new Date().toISOString() };
}
module.exports = { argumentsFor, readEvents, assertSavedTransition, assertSettled, assertCleanup, assertWorkspaceSaved, publicDepartmentEntry, verifyCapturedRun, main };
if (require.main === module) main().then(report => { if (report.result !== "passed") process.exitCode = 1; }).catch(error => { console.error(error); process.exitCode = 1; });
