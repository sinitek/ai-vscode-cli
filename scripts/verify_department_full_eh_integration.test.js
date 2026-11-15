"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { args, roleSelection, isolatedEnvironment, assertMixedEvidence, assertColdStartActivationSucceeded, classifyColdStartRecovery,
  assertColdRestartIdentity, assertColdUiRoot, findDepartmentWebviewTarget, createDepartmentWebviewAdapter, clickPublicControl } = require("./verify_department_full_eh_integration");
const base = ["--product", "/physical/product", "--report", "/new/report.json"];
test("default Codex and existing stop-continue arguments remain supported; OpenCode partial continuation stays rejected", () => {
  assert.equal(args(base).leaderCli, "codex"); assert.equal(args([...base, "--scenario", "stop-continue"]).scenario, "stop-continue");
  assert.equal(args([...base, "--scenario", "cold-start"]).scenario, "cold-start");
  assert.equal(args([...base, "--leader-cli", "opencode"]).leaderCli, "opencode");
  assert.equal(args([...base, "--leader-cli", "opencode"]).leaderModel, "explicit");
  assert.equal(args([...base, "--leader-cli", "opencode", "--leader-model", "default"]).leaderModel, "default");
  for (const extra of [["--leader-cli", "unknown"], ["--leader-cli"], ["--leader-cli", "opencode", "--scenario", "stop-continue"], ["--scenario", "guess"], ["--report", "/duplicate"]])
    assert.throws(() => args([...base, ...extra]));
  for (const flag of ["--director-cli", "--leader-cli", "--employee-cli"])
    assert.throws(() => args([...base, "--scenario", "cold-start", flag, "opencode"]), /Codex director\/leader\/employee/);
});

test("cold recovery classification rejects unrelated activation errors and only accepts the observed production fail-closed boundary", () => {
  assert.throws(() => assertColdStartActivationSucceeded({ activationError: "Error: missing extension dependency" }), /activation failed/);
  assert.throws(() => classifyColdStartRecovery({ activationError: "Error: unrelated activation failure", productionRecovery: null }), /activation failed/);
  assert.equal(classifyColdStartRecovery({ activationError: null, productionRecovery: {
    trigger: "public-department-stop", observed: true, outcome: "blocked", reason: "live-leader-unverifiable",
  } }), "production-recovery-blocked-live-leader-unverifiable");
  for (const productionRecovery of [null, { trigger: "public-department-stop", observed: false, outcome: "blocked", reason: "live-leader-unverifiable" },
    { trigger: "owner-observe-only", observed: true, outcome: "blocked", reason: "live-leader-unverifiable" },
    { trigger: "public-department-stop", observed: true, outcome: "blocked", reason: "invalid-recovery" }]) {
    assert.throws(() => classifyColdStartRecovery({ activationError: null, productionRecovery }));
  }
});

test("cold UI stop is bound to the exact opened root, and cross-host comparison rejects same execution IDs with changed identity or selection", () => {
  assert.equal(assertColdUiRoot("产研部 · root-expected", "root-expected"), true);
  assert.throws(() => assertColdUiRoot("产研部 · root-other", "root-expected"), /does not belong/);
  const identity = { rootTaskId: "root", workspace: "/workspace", moduleId: "module", leaderTaskId: "leader", generation: 3,
    subtaskId: "subtask", attemptId: "attempt", executionId: "execution", ownerId: "owner", role: "employee", cli: "codex",
    session: { state: "bound", id: "session" } };
  const leaderIdentity = { ...identity, role: "leader", executionId: "leader-execution", ownerId: "leader-owner", session: { state: "bound", id: "leader-session" } };
  delete leaderIdentity.subtaskId; delete leaderIdentity.attemptId;
  const capacity = { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: ["module"], employees: ['["leader","attempt"]'] };
  const selection = role => ({ version: 1, cli: "codex", role, configId: "codex-local", revision: "rev1", model: "__default__", thinkingMode: null, openCodeVariant: null });
  const requirements = { processTerminal: true, turnTerminal: false, streams: true, runner: false, executionRoot: false, links: false, temp: false, tab: false };
  const binding = { identity, selection: selection("employee"), requirements };
  const leaderBinding = { identity: leaderIdentity, selection: selection("leader"), requirements };
  const routes = { leader: { cli: "codex" }, employee: { cli: "codex" } };
  const rootTask = { id: "root", status: "running", workspaceKey: "/workspace", subTasks: [{ id: "module", status: "running" }], department: { routes } };
  const leaderTask = { id: "leader", status: "running", workspaceKey: "/workspace", executionSession: { cli: "codex", sessionId: "leader-session", configId: "codex-local" },
    subTasks: [{ id: "subtask", status: "running", executionSession: { cli: "codex", sessionId: "session", configId: "codex-local" } }],
    loopPlus: { running: [{ subtaskId: "subtask", attemptId: "attempt" }] }, department: { routes: structuredClone(routes) } };
  const set = { scope: { rootTaskId: "root", workspace: "/workspace", moduleId: "module", leaderTaskId: "leader", generation: 3 }, entries: [leaderBinding, binding].map(value => ({
    executionId: value.identity.executionId, responsibility: { target: { role: value.identity.role, ...(value.identity.role === "employee" ? { subtaskId: "subtask", attemptId: "attempt" } : {}) },
      selection: value.selection, requirements: value.requirements } })) };
  const runtime = { capacity, executionBindings: [leaderBinding, binding], leaderExecutionSets: [set], stopping: false,
    runtime: { stopping: false, leaders: [{ taskId: "leader", leaderSubtaskId: "module", generation: 3 }] } };
  const taskSnapshot = [rootTask, leaderTask], rootSnapshot = { id: "root", workspaceKey: "/workspace", runtime };
  const first = { binding, capacity, beforeRestart: { rootTask, leader: leaderTask, tasks: taskSnapshot, binding: structuredClone(binding), runtime },
    postExitTasks: taskSnapshot, postExitRuntime: structuredClone(runtime) };
  const phase = () => ({ tasks: structuredClone(taskSnapshot), roots: [structuredClone(rootSnapshot)], observations: [leaderBinding, binding].map(value => ({
    identity: structuredClone(value.identity), selection: structuredClone(value.selection), requirements: structuredClone(value.requirements), capacity: structuredClone(capacity) })) });
  const second = { beforeActivation: phase(), afterActivation: phase(), beforeControl: phase(), afterControl: phase(),
    originalOwnerObservations: [leaderBinding, binding].map(value => ({ identity: structuredClone(value.identity),
      result: { status: "unknown", identity: structuredClone(value.identity), reason: "owner-unreachable" } })) };
  assert.equal(assertColdRestartIdentity(first, second).ownerStatus, "unknown");
  for (const [index, mutate] of [
    value => { value.beforeActivation.observations[0].identity.session.id = "foreign-session"; },
    value => { value.beforeActivation.observations[0].selection.configId = "foreign-config"; },
    value => { value.beforeControl.observations[0].identity.attemptId = "foreign-attempt"; },
    value => { value.beforeControl.observations[0].selection.configId = "foreign-leader-config"; },
    value => { value.afterControl.tasks[1].loopPlus.running[0].attemptId = "foreign-attempt"; },
    value => { value.originalOwnerObservations[0].identity.ownerId = "foreign-owner"; },
    value => { value.afterActivation.observations[0].capacity.employees = []; },
    value => { value.beforeActivation.roots[0].runtime.executionBindings = value.beforeActivation.roots[0].runtime.executionBindings.filter(b => b.identity.role !== "leader"); },
    value => { value.beforeControl.roots[0].runtime.leaderExecutionSets[0].entries.pop(); },
    value => { value.beforeControl.roots[0].runtime.leaderExecutionSets[0].entries[0].responsibility.selection.configId = "foreign-config"; },
    value => { value.beforeControl.roots[0].runtime.capacity.employees = []; },
    value => { value.afterControl.tasks[1].executionSession.cli = "opencode"; },
  ].entries()) {
    const changed = structuredClone(second); mutate(changed); assert.throws(() => assertColdRestartIdentity(first, changed), `second-host drift mutation ${index} was accepted`);
  }
  for (const mutate of [
    value => { value.beforeRestart.runtime.capacity.employees = []; },
    value => { value.beforeRestart.leader.department.routes.leader.cli = "foreign"; },
    value => { value.postExitTasks.find(task => task.id === "leader").loopPlus = { running: [] }; },
    value => { value.postExitRuntime.leaderExecutionSets[0].entries.pop(); },
    value => { value.postExitRuntime.executionBindings = value.postExitRuntime.executionBindings.filter(b => b.identity.role !== "leader"); },
    value => { value.capacity.employees = []; },
  ]) {
    const changed = structuredClone(first); mutate(changed); assert.throws(() => assertColdRestartIdentity(changed, second));
  }
});

test("public control click dispatch handles SVG and HTML while rejecting missing, duplicate, invisible and disabled controls", () => {
  const vm = require("node:vm"), events = [];
  class MouseEvent { constructor(type, options) { this.type = type; this.options = options; } }
  const context = { MouseEvent, window: {}, getComputedStyle: element => element.style, events };
  vm.createContext(context);
  const svg = { disabled: false, style: { visibility: "visible", display: "block", pointerEvents: "auto" },
    getAttribute: () => null, closest: () => null, getClientRects: () => [{}],
    dispatchEvent(event) { events.push(event); return true; } };
  context.elements = [svg];
  assert.equal(vm.runInContext(`(${clickPublicControl.toString()})(elements)`, context), true);
  assert.equal(events[0].type, "click"); assert.equal(events[0].options.bubbles, true);
  const htmlEvents = [];
  context.elements = [{ ...svg, click() { htmlEvents.push("click"); } }];
  assert.equal(vm.runInContext(`(${clickPublicControl.toString()})(elements)`, context), true);
  assert.deepEqual(htmlEvents, ["click"]);
  for (const elements of [[], [svg, svg], [{ ...svg, getClientRects: () => [] }], [{ ...svg, disabled: true }],
    [{ ...svg, getAttribute: key => key === "aria-disabled" ? "true" : null }]]) {
    context.elements = elements;
    assert.equal(vm.runInContext(`(${clickPublicControl.toString()})(elements)`, context), false);
  }
});

test("OOPIF adapter binds only the exact extension and Webview purpose and dispatches a public DOM click", async () => {
  const target = { type: "iframe", targetId: "webview-target", url: "vscode-webview://frame/index.html?extensionId=sinitek.sinitek-cli-tools&purpose=webviewView" };
  assert.equal(findDepartmentWebviewTarget([target], "webviewView").targetId, "webview-target");
  assert.throws(() => findDepartmentWebviewTarget([
    { ...target, targetId: "foreign-extension", url: target.url.replace("sinitek.sinitek-cli-tools", "sinitek-cli-tools") },
  ], "webviewView"));
  assert.throws(() => findDepartmentWebviewTarget([target, { ...target, targetId: "duplicate-target" }], "webviewView"));
  assert.throws(() => findDepartmentWebviewTarget([target], "webviewPanel"));
  const cdp = new EventEmitter();
  const targetCommands = [];
  cdp.send = async (method, params) => {
    if (method === "Target.setDiscoverTargets" || method === "Target.detachFromTarget") return {};
    if (method === "Target.getTargets") return { targetInfos: [target] };
    if (method === "Target.attachToTarget") return { sessionId: "attached-session" };
    if (method === "Target.sendMessageToTarget") {
      const command = JSON.parse(params.message); targetCommands.push(command);
      if (command.method === "Runtime.enable") setImmediate(() => cdp.emit("Target.receivedMessageFromTarget", { sessionId: params.sessionId,
        message: JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { id: 1, auxData: { isDefault: true } } } }) }));
      const value = command.method !== "Runtime.evaluate" ? undefined
        : command.params.expression.includes("dispatchEvent") ? true : 1;
      setImmediate(() => cdp.emit("Target.receivedMessageFromTarget", { sessionId: params.sessionId,
        message: JSON.stringify({ id: command.id, result: { result: { value } } }) }));
      return {};
    }
    throw new Error(`unexpected CDP command ${method}`);
  };
  cdp.detach = async () => {};
  const adapter = await createDepartmentWebviewAdapter({ newBrowserCDPSession: async () => cdp }, "webviewView", 100);
  try {
    assert.equal(await adapter.locator("#sendPrompt").count(), 1);
    await adapter.locator("#sendPrompt").click();
    assert.ok(targetCommands.some(command => command.method === "Runtime.evaluate" && command.params.expression.includes("dispatchEvent")));
  } finally {
    await adapter.close();
  }
});

test("cold CDP adapter uses one absolute budget across CDP sends and target responses", async () => {
  const target = { type: "iframe", targetId: "target", url: "vscode-webview://frame/index.html?extensionId=sinitek.sinitek-cli-tools&purpose=webviewView" };
  const makeAdapter = async ({ stallMethod, missingResponse = false, delayMs = 0, deadlineMs = 50, cleanupHangs = false } = {}) => {
    const cdp = new EventEmitter(), sent = [];
    cdp.send = async (method, params) => {
      if (method === "Target.setDiscoverTargets") return {};
      if (method === "Target.getTargets") return { targetInfos: [target] };
      if (method === "Target.attachToTarget") return { sessionId: "session" };
      if (method === "Target.detachFromTarget" && cleanupHangs) return new Promise(() => {});
      if (method === "Target.detachFromTarget") return {};
      if (method === "Target.sendMessageToTarget") {
        const command = JSON.parse(params.message); sent.push(command.method);
        if (command.method === stallMethod) return new Promise(() => {});
        if (command.method === "Runtime.enable") setImmediate(() => cdp.emit("Target.receivedMessageFromTarget", { sessionId: params.sessionId,
          message: JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { id: 1, auxData: { isDefault: true } } } }) }));
        if (!missingResponse) setTimeout(() => cdp.emit("Target.receivedMessageFromTarget", { sessionId: params.sessionId,
          message: JSON.stringify({ id: command.id, result: { result: { value: command.method === "Runtime.evaluate" ? 1 : undefined } } }) }), delayMs);
        return {};
      }
      throw new Error(`unexpected CDP command ${method}`);
    };
    cdp.detach = cleanupHangs ? () => new Promise(() => {}) : async () => {};
    const diagnostics = [], deadline = Date.now() + deadlineMs, cleanupDeadline = deadline + 30;
    const started = Date.now();
    try {
      const adapter = await createDepartmentWebviewAdapter({ newBrowserCDPSession: async () => cdp }, "webviewView", deadlineMs,
        { deadline, cleanupDeadline, diagnostics });
      return { adapter, sent, diagnostics, started };
    } catch (error) { return { error, sent, diagnostics, started, elapsed: Date.now() - started }; }
  };

  const multiPhase = await makeAdapter({ delayMs: 30, deadlineMs: 45 });
  assert.match(String(multiPhase.error), /absolute deadline/);
  assert.ok(multiPhase.elapsed < 100, `multi-stage CDP waits reset their budget (${multiPhase.elapsed}ms)`);
  assert.ok(multiPhase.sent.length >= 2, "fixture did not cross multiple CDP stages");

  const noResponse = await makeAdapter({ missingResponse: true, deadlineMs: 25 });
  assert.match(String(noResponse.error), /absolute deadline/);

  const hangingSend = await makeAdapter({ stallMethod: "Page.enable", deadlineMs: 25 });
  assert.match(String(hangingSend.error), /absolute deadline/);
  assert.ok(hangingSend.elapsed < 100, "a pending CDP send escaped its absolute budget");

  const cleanupFailure = await makeAdapter({ stallMethod: "Page.enable", deadlineMs: 20, cleanupHangs: true });
  assert.match(String(cleanupFailure.error), /absolute deadline/);
  assert.ok(cleanupFailure.diagnostics.some(value => value.status === "unconfirmed"), "unconfirmed detach was not observable");
});

test("cold driver refuses missing evidence before its shared deadline and reports its owned cleanup", async () => {
  const { driveColdProductionRecoveryCheck } = require("./verify_department_full_eh_integration");
  const fs = require("node:fs"), os = require("node:os"), root = fs.mkdtempSync(path.join(os.tmpdir(), "cold-driver-deadline-"));
  const target = { type: "iframe", targetId: "target", url: "vscode-webview://frame/index.html?extensionId=sinitek.sinitek-cli-tools&purpose=webviewPanel" };
  const cdp = new EventEmitter(); let clicks = 0, browserClosed = 0;
  cdp.send = async (method, params) => {
    if (method === "Target.setDiscoverTargets" || method === "Target.detachFromTarget") return {};
    if (method === "Target.getTargets") return { targetInfos: [target] };
    if (method === "Target.attachToTarget") return { sessionId: "session" };
    if (method === "Target.sendMessageToTarget") {
      const command = JSON.parse(params.message);
      if (command.method === "Runtime.enable") setImmediate(() => cdp.emit("Target.receivedMessageFromTarget", { sessionId: params.sessionId,
        message: JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { id: 1, auxData: { isDefault: true } } } }) }));
      const value = command.method === "Runtime.evaluate" ? command.params.expression.includes("#panelSubtitle") ? "部门 · root"
        : command.params.expression.includes("innerText") ? "产研部 · 总监 root"
        : command.params.expression.includes("dispatchEvent") ? (clicks += 1, true) : 1 : undefined;
      setImmediate(() => cdp.emit("Target.receivedMessageFromTarget", { sessionId: params.sessionId,
        message: JSON.stringify({ id: command.id, result: { result: { value } } }) }));
      return {};
    }
    throw new Error(`unexpected CDP command ${method}`);
  };
  cdp.detach = async () => {};
  const browser = { contexts: () => [{ pages: () => [{ url: () => "vscode-file://workbench" }] }],
    newBrowserCDPSession: async () => cdp, isConnected: () => true, close: async () => { browserClosed += 1; } };
  const base = Date.now(), deadlines = { actionDeadline: base + 500, evidenceDeadline: base + 80, hostDeadline: base + 650 };
  let signalCount = 0;
  try {
    await assert.rejects(driveColdProductionRecoveryCheck(1, "root", root, deadlines, { chromium: { connectOverCDP: async () => browser },
      signal: () => { signalCount += 1; }, evidenceExists: () => false }), /cold recovery evidence exceeded its absolute deadline/);
    assert.equal(clicks, 1, "public stop was not dispatched exactly once before evidence waiting");
    assert.equal(signalCount, 1);
    assert.equal(browserClosed, 1, "driver did not close the CDP connection it created");
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "cold-cdp-cleanup.json"), "utf8")).confirmed, true);

    const successStart = Date.now(), successBase = Date.now();
    await driveColdProductionRecoveryCheck(1, "root", root,
      { actionDeadline: successBase + 500, evidenceDeadline: successBase + 700, hostDeadline: successBase + 900 },
      { chromium: { connectOverCDP: async () => browser }, signal: () => { signalCount += 1; }, evidenceExists: () => true });
    assert.equal(signalCount, 2, "successful cold path did not issue exactly one public action");
    assert.equal(browserClosed, 2);
    assert.ok(Date.now() < successBase + 700, "normal CDP action did not complete before evidence cutoff");
    assert.ok(Date.now() - successStart < 500, "controlled normal CDP path exceeded its short budget");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("default OpenCode model uses the public default control without changing previous driver defaults", () => {
  assert.deepEqual(roleSelection("leader", "opencode", "default"), { cli: "opencode", profile: "opencode-local", model: "__default__" });
  assert.deepEqual(roleSelection("employee", "opencode", "default"), { cli: "opencode", profile: "opencode-local", model: "__default__" });
  for (const extra of [["--leader-model", "guess"], ["--leader-model", "explicit"], ["--leader-model"], ["--leader-model", "default", "--leader-model", "default"]])
    assert.throws(() => args([...base, ...extra]));
  assert.throws(() => roleSelection("leader", "opencode", "guess"));
});
test("environment whitelists OS launch inputs, isolates all storage, blocks remote proxies and drops credentials", () => {
  const root = path.resolve("isolated-root"), env = isolatedEnvironment(root, { PATH: "/bin", OPENAI_API_KEY: "secret", OPENCODE_CONFIG: "/private/config", HOME: "/private", NODE_OPTIONS: "private preload", HTTP_PROXY: "https://remote", SYSTEMROOT: "unused" });
  assert.equal(env.PATH, "/bin"); assert.equal(env.OPENAI_API_KEY, "local-only-no-network");
  for (const key of ["OPENCODE_CONFIG", "NODE_OPTIONS"]) assert.equal(env[key], undefined);
  for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMP", "TEMP", "OPENCODE_CONFIG_DIR"]) {
    const relative = path.relative(root, env[key]); assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  }
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:9"); assert.equal(env.NO_PROXY, "127.0.0.1,localhost,::1");
});
function evidence() {
  const snapshot = { rootId: "root", leaders: ["leader1", "leader2"], capacityReuse: { complete: true } }, tasks = [{ id: "root", status: "completed" }], protocol = [];
  const executionBindings = [], leaderExecutionSets = [];
  for (const leaderId of snapshot.leaders) {
    const scope = { rootTaskId: "root", leaderTaskId: leaderId, generation: 1, moduleId: leaderId, workspace: "workspace" }, entries = [];
    const leader = { id: leaderId, executionSession: { cli: "opencode", sessionId: `${leaderId}-session` }, subTasks: [{ id: "sub", executionSession: { cli: "codex", sessionId: `${leaderId}-employee-session` } }] }; tasks.push(leader);
    for (const role of ["leader", "employee"]) {
      const cli = role === "leader" ? "opencode" : "codex", pid = executionBindings.length + 1;
      const identity = { ...scope, role, cli, ownerId: `owner${pid}`, executionId: `execution${pid}`, session: { state: "bound", id: role === "leader" ? leader.executionSession.sessionId : leader.subTasks[0].executionSession.sessionId }, ...(role === "employee" ? { subtaskId: "sub", attemptId: "attempt" } : {}) };
      const selection = { cli, configId: `${cli}-local` }, requirements = { streams: true };
      executionBindings.push({ identity, selection, requirements }); entries.push({ executionId: identity.executionId, responsibility: { selection, requirements } });
      const types = role === "leader" ? ["ready", "drained", "stopped"] : ["prepared", "session", "owner-bound", "granted", "terminal", "resources-released"];
      protocol.push(...types.map(type => ({ event: "received", type, identity, pid })));
      if (role === "leader") {
        for (let invocationId = 1; invocationId <= 3; invocationId++) protocol.push(
          { event: "received", type: "grant-request", requestSequence: invocationId, invocationId, identity, pid },
          { event: "sent", operation: "ack", requestSequence: invocationId, ok: true, identity, pid },
          { event: "received", type: "settled", invocationId, terminal: { processTerminal: { status: "confirmed" }, streams: { status: "confirmed" } }, identity, pid });
      }
      if (role === "leader") protocol.push(...["seal", "shutdown"].map(operation => ({ event: "sent", operation, identity, pid })), { event: "owner-close", pid, code: 0, signal: null });
    }
    leaderExecutionSets.push({ scope, state: "closed", producerId: leaderId, closure: { scope, producerId: leaderId }, entries });
  }
  return { cleanup: { complete: true, saved: { executionBindings, leaderExecutionSets } }, tasks, snapshot, protocol };
}
test("mixed evidence requires exact CLOSED identities, original sessions and protocol-specific natural handshakes", () => {
  assert.equal(assertMixedEvidence(evidence()).length, 4);
  const mutate = [
    h => h.cleanup.saved.executionBindings[0].identity.cli = "codex",
    h => h.protocol = h.protocol.filter(e => e.type !== "stopped"),
    h => h.protocol.find(e => e.event === "owner-close").signal = "SIGKILL",
    h => h.cleanup.saved.leaderExecutionSets[0].entries[1].executionId = h.cleanup.saved.leaderExecutionSets[0].entries[0].executionId,
    h => h.tasks[1].executionSession.sessionId = "other-session",
    h => h.snapshot.capacityReuse.complete = false,
    h => h.cleanup.complete = false,
  ];
  for (const change of mutate) { const h = evidence(); change(h); assert.throws(() => assertMixedEvidence(h)); }
});


test("mixed public role choices use an explicit OpenCode model and preserve Codex defaults", () => {
  assert.deepEqual(roleSelection("leader", "opencode"), { cli: "opencode", profile: "opencode-local", model: "isolated/native-drain" });
  assert.deepEqual(roleSelection("employee", "opencode"), { cli: "opencode", profile: "opencode-local", model: "__default__" });
  assert.deepEqual(roleSelection("leader"), { cli: "codex", profile: "codex-local", model: "__default__" });
  assert.deepEqual(roleSelection("director", "opencode"), { cli: "opencode", profile: "opencode-local", model: "isolated/native-drain" });
});

test("all-role CLI flags are strict, default to Codex and enable only the exact default all-OpenCode continuation", () => {
  const parsed = args([...base, "--director-cli", "opencode", "--leader-cli", "opencode", "--leader-model", "default", "--employee-cli", "opencode"]);
  assert.equal(parsed.directorCli, "opencode"); assert.equal(parsed.employeeCli, "opencode");
  assert.equal(args(base).directorCli, "codex"); assert.equal(args(base).employeeCli, "codex");
  for (const flag of ["--director-cli", "--employee-cli"]) for (const extra of [[flag], [flag, "unknown"], [flag, "opencode", flag, "codex"], [flag, "opencode", "--scenario", "stop-continue"]]) assert.throws(() => args([...base, ...extra]));
});
function allOpenCodeEvidence() {
  const h = evidence(); h.roles = { director: "opencode", leader: "opencode", employee: "opencode" };
  for (const binding of h.cleanup.saved.executionBindings.filter(b => b.identity.role === "employee")) {
    const id = binding.identity, pid = h.protocol.find(e => e.identity?.ownerId === id.ownerId).pid;
    id.cli = "opencode"; binding.selection = { cli: "opencode", configId: "opencode-local" };
    h.cleanup.saved.leaderExecutionSets.flatMap(s => s.entries).find(e => e.executionId === id.executionId).responsibility.selection = binding.selection;
    h.tasks.find(t => t.id === id.leaderTaskId).subTasks[0].executionSession.cli = "opencode";
    h.protocol = h.protocol.filter(e => e.pid !== pid);
    h.protocol.push(...["native-session", "prepared", "committed", "launch-request", "terminal", "release-tab", "stopped"].map(type => ({ event: "received", type, identity: id, pid })),
      ...["finalize", "commit", "launch", "shutdown"].map(operation => ({ event: "sent", operation, identity: id, pid })), { event: "owner-close", pid, code: 0, signal: null });
  }
  return h;
}
test("all OpenCode evidence applies employee protocol separately and rejects missing or cross-role proofs", () => {
  assert.equal(assertMixedEvidence(allOpenCodeEvidence()).length, 4);
  for (const change of [h => h.protocol = h.protocol.filter(e => e.type !== "native-session"), h => h.protocol = h.protocol.filter(e => e.operation !== "commit"), h => h.protocol.find(e => e.operation === "ack").ok = false, h => h.protocol.find(e => e.type === "settled").terminal.streams.status = "unknown", h => h.roles.employee = "codex"]) {
    const h = allOpenCodeEvidence(); change(h); assert.throws(() => assertMixedEvidence(h));
  }
});

const { assertOpenCodeLaunchEvidence, readOpenCodeNativeFacts } = require('./verify_department_full_eh_integration');
function launchEvidence() {
  const h = allOpenCodeEvidence(), nativeFacts = [], originals = [];
  for (const binding of h.cleanup.saved.executionBindings) {
    const id = binding.identity;
    binding.requirements = Object.fromEntries(['processTerminal','turnTerminal','streams','runner','executionRoot','links','temp','tab'].map(part => [part, part !== 'turnTerminal']));
    const receipt = { identity: structuredClone(id), requirements: structuredClone(binding.requirements), cleanup: Object.fromEntries(Object.entries(binding.requirements).map(([part, required]) => [part, { status: required ? 'confirmed' : 'not-applicable' }])) };
    originals.push({ source: 'original-client-waitForCleanup-return', identity: structuredClone(id), receipt, requirements: structuredClone(binding.requirements) });
    const events = h.protocol.filter(e => e.identity?.ownerId === id.ownerId);
    const initial = { identity: id, event: 'sent', selection: binding.selection, launchEvidence: { overlayModel: binding.selection.model, sessionId: id.session.id } };
    h.protocol.push(initial);
    if (id.role === 'employee') Object.assign(events.find(e => e.operation === 'finalize'), { launchEvidence: { modelArgs: [binding.selection.model], sessionArgs: [id.session.id] } });
    for (const grant of events.filter(e => e.type === 'grant-request' || e.type === 'launch-request')) {
      grant.at = 10;
      const ack = events.find(e => id.role === 'employee' ? e.operation === 'launch' : e.operation === 'ack' && e.requestSequence === grant.requestSequence);
      ack.preGrantReadback = { runtimeOk: true, taskId: id.leaderTaskId, bindings: [structuredClone(binding)], session: { cli: id.cli, sessionId: id.session.id }, capacity: { leaders: [id.moduleId], employees: [JSON.stringify([id.leaderTaskId, id.attemptId])] } };
    }
    const directory = `/isolated/native/${id.executionId}`;
    nativeFacts.push({ executionId: id.executionId, session: { id: id.session.id, directory, time_created: 1 }, directoryRemoved: true,
      turns: Array.from({ length: id.role === 'leader' ? 3 : 1 }, () => ({ cwd: directory, model: binding.selection.model, finish: 'stop', completedAt: 12 })) });
  }
  return { bindings: h.cleanup.saved.executionBindings, protocol: h.protocol, nativeFacts, originals, isolatedRoot: '/isolated' };
}
test('strict OpenCode gate requires original policy, durable pre-grant identity, argv/overlay and same canonical task directory', () => {
  assert.equal(assertOpenCodeLaunchEvidence(launchEvidence()).length, 4);
  const mutations = [
    h => {
      // All copies agree: policy downgrade must fail independently of equality.
      for (const binding of h.bindings) binding.requirements.temp = false;
      for (const original of h.originals) {
        original.requirements.temp = false; original.receipt.requirements.temp = false;
        original.receipt.cleanup.temp.status = 'not-applicable';
      }
      for (const event of h.protocol) for (const binding of event.preGrantReadback?.bindings || []) binding.requirements.temp = false;
    },
    h => h.originals.pop(), h => h.originals[0].source = 'disk-cleaned', h => h.originals[0].receipt.cleanup.streams.status = 'unknown',
    h => h.protocol.find(e => e.preGrantReadback).preGrantReadback.bindings = [],
    h => h.protocol.find(e => e.preGrantReadback).preGrantReadback.session.sessionId = 'foreign',
    h => h.protocol.find(e => e.operation === 'launch').preGrantReadback.capacity.employees = [],
    h => h.protocol.find(e => e.selection).launchEvidence.overlayModel = 'wrong-model',
    h => h.protocol.find(e => e.operation === 'finalize').launchEvidence.sessionArgs = ['old-session'],
    h => h.nativeFacts[0].turns[0].cwd = '/foreign', h => h.nativeFacts[0].directoryRemoved = false,
    h => h.nativeFacts[0].session.directory = '/outside', h => h.nativeFacts[0].session.time_created = 11,
    h => h.nativeFacts[1].turns.push(h.nativeFacts[1].turns[0]),
  ];
  for (const change of mutations) { const h = launchEvidence(); change(h); assert.throws(() => assertOpenCodeLaunchEvidence(h)); }
});

test('native audit reads only requested original session/assistant facts from an isolated read-only database', () => {
  const fs = require('node:fs'), os = require('node:os'), { DatabaseSync } = require('node:sqlite');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'department-native-audit-unit-'));
  const file = path.join(root, 'data/opencode/opencode.db'); fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE session(id TEXT, directory TEXT, time_created INTEGER); CREATE TABLE message(session_id TEXT, id TEXT, data TEXT, time_created INTEGER)');
  db.prepare('INSERT INTO session VALUES(?,?,?)').run('session', root + '/already-removed', 1);
  const info = { role: 'assistant', path: { cwd: root + '/already-removed' }, providerID: 'isolated', modelID: 'native-drain', time: { completed: 3 }, finish: 'stop' };
  db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('session','message',JSON.stringify(info),2); db.close();
  try {
    const before = fs.readFileSync(file);
    const facts = readOpenCodeNativeFacts(root, [{ identity: { cli: 'opencode', executionId: 'exec', session: { id: 'session' } } }]);
    assert.equal(facts.length, 1); assert.equal(facts[0].turns[0].cwd, facts[0].session.directory); assert.equal(facts[0].directoryRemoved, true);
    assert.deepEqual(fs.readFileSync(file), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test("only all OpenCode default continuation joins the existing Codex public contract", () => {
  const all = ["--director-cli", "opencode", "--leader-cli", "opencode", "--employee-cli", "opencode"];
  assert.equal(args([...base, ...all, "--leader-model", "default", "--scenario", "stop-continue"]).scenario, "stop-continue");
  assert.throws(() => args([...base, ...all, "--scenario", "stop-continue"]), /default models/);
  assert.throws(() => args([...base, "--director-cli", "opencode", "--employee-cli", "opencode", "--scenario", "stop-continue"]));
});

test("continued native evidence keeps per-generation canonical turns, original ID and exact retired source", () => {
  const h = launchEvidence(), originals = h.bindings.slice(0, 2);
  for (const binding of originals) {
    const originalId = structuredClone(binding.identity), oldFacts = h.nativeFacts.find(f => f.executionId === originalId.executionId);
    oldFacts.canonicalDirectory = oldFacts.session.directory;
    oldFacts.turns = oldFacts.turns.slice(0, 1);
    const next = structuredClone(binding); next.identity = { ...next.identity, generation: 3, ownerId: originalId.ownerId + '-next', executionId: originalId.executionId + '-next' };
    if (next.identity.role === 'employee') { next.identity.subtaskId += '-next'; next.identity.attemptId += '-next'; }
    const directory = oldFacts.canonicalDirectory + '-next'; oldFacts.session.directory = directory;
    h.nativeFacts.push({ ...structuredClone(oldFacts), executionId: next.identity.executionId, canonicalDirectory: directory,
      turns: Array.from({ length: next.identity.role === 'leader' ? 3 : 1 }, () => ({ cwd: directory, model: next.selection.model, finish: 'stop', completedAt: 12 })) });
    const cloned = h.protocol.filter(e => e.identity?.ownerId === originalId.ownerId).map(e => ({ ...structuredClone(e), identity: next.identity }));
    for (const event of cloned) if (event.preGrantReadback) {
      event.preGrantReadback.bindings = [structuredClone(next)];
      if (next.identity.role === 'employee') event.preGrantReadback.capacity.employees = [JSON.stringify([next.identity.leaderTaskId, next.identity.attemptId])];
    }
    const prepared = cloned.find(e => e.selection); prepared.retired = { identity: originalId, selection: structuredClone(binding.selection), directory: oldFacts.canonicalDirectory };
    if (next.identity.role === 'leader') h.protocol = h.protocol.filter(e => e.identity?.ownerId !== originalId.ownerId || e.type !== 'grant-request' || e.requestSequence === 1);
    h.protocol.push(...cloned); h.bindings.push(next);
    const receipt = structuredClone(h.originals.find(v => v.identity.executionId === originalId.executionId)); receipt.identity = next.identity; receipt.receipt.identity = next.identity; h.originals.push(receipt);
  }
  h.snapshot = { continuation: { stopped: { saved: { executionBindings: originals } } } };
  assert.equal(assertOpenCodeLaunchEvidence(h).length, 6);
  const corrupt = structuredClone(h); corrupt.protocol.find(e => e.retired).retired.directory = '/foreign';
  assert.throws(() => assertOpenCodeLaunchEvidence(corrupt), /equal/);
});

const { continuationRounds, expectedNativeTurns, assertSuccessiveEvidence, drivePublicSuccessiveContinuation } = require('./verify_department_full_eh_integration');
test('successive-stop-continue entry accepts only the default all-OpenCode combination without changing old entries', () => {
  const all = ['--director-cli','opencode','--leader-cli','opencode','--employee-cli','opencode','--leader-model','default'];
  assert.equal(args([...base,...all,'--scenario','successive-stop-continue']).scenario, 'successive-stop-continue');
  for (const extra of [[], all.slice(0,6), ['--leader-cli','opencode','--leader-model','default']])
    assert.throws(() => args([...base,...extra,'--scenario','successive-stop-continue']), /requires/);
  assert.throws(() => args([...base,...all,'--scenario','successive-stop-continue','--scenario','cold-start']), /Duplicate/);
  assert.equal(continuationRounds({}).length, 0);
  assert.equal(continuationRounds({ continuation: { stopped: {} } }).length, 1);
});

// Aggregation fixture: each stop snapshot is cumulative, but each direct move
// and actual native turn belongs to a distinct original Owner/execution.
function successiveEvidence() {
  const source = launchEvidence(), initial = source.bindings.slice(0,2);
  const bindings = [], protocol = [], nativeFacts = [], originals = [], sets = [];
  const tasks = [{id:'root',status:'completed'}, {id:'leader1',subTasks:[],loopPlus:{seenAttempts:[]}}];
  const firstTask = tasks[1];
  for (const [index,generation] of [1,3,5].entries()) {
    const entries = [];
    for (const baseBinding of initial) {
      const binding = structuredClone(baseBinding), id = binding.identity;
      Object.assign(id, {generation, ownerId:`${id.ownerId}-g${generation}`, executionId:`${id.executionId}-g${generation}`});
      if(id.role==='employee') Object.assign(id,{subtaskId:`sub-${index}`,attemptId:`attempt-${index}`});
      const directory = `/isolated/native/${id.executionId}`;
      const events = source.protocol.filter(e=>e.identity?.ownerId===baseBinding.identity.ownerId).map(e=>({...structuredClone(e),identity:id}));
      const kept = events.filter(e=>index===2 || !['grant-request','settled'].includes(e.type) || e.requestSequence===1 || e.invocationId===1)
        .filter(e=>index===2 || e.operation!=='ack' || e.requestSequence===1);
      for(const event of kept) {
        event.pid = bindings.length+1;
        if(event.at) event.at = 10+index*10;
        if(event.preGrantReadback) {
          event.preGrantReadback.bindings=[structuredClone(binding)];
          event.preGrantReadback.session={cli:id.cli,sessionId:id.session.id};
          event.preGrantReadback.capacity.employees=id.role==='employee'?[JSON.stringify([id.leaderTaskId,id.attemptId])]:[];
        }
      }
      const prepared=kept.find(e=>e.selection);
      prepared.launchEvidence.cwd=directory;
      if(index && id.role==='employee') {
        const previous=bindings.filter(b=>b.identity.role===id.role).at(-1);
        prepared.retired={identity:structuredClone(previous.identity),selection:structuredClone(previous.selection),directory:`/isolated/native/${previous.identity.executionId}`};
      }
      nativeFacts.push({executionId:id.executionId,canonicalDirectory:directory,session:{id:id.session.id,directory:`/isolated/native/${baseBinding.identity.executionId}-g5`,time_created:1},directoryRemoved:true,
        turns:Array.from({length:id.role==='leader' && index===2?3:1},()=>({cwd:directory,model:binding.selection.model,finish:'stop',completedAt:12}))});
      const receipt=structuredClone(source.originals.find(o=>o.identity.executionId===baseBinding.identity.executionId));
      receipt.identity=structuredClone(id);receipt.receipt.identity=structuredClone(id); originals.push(receipt);
      bindings.push(binding);protocol.push(...kept, {event:"owner-close",pid:bindings.length,code:0,signal:null});
      entries.push({executionId:id.executionId,responsibility:{selection:binding.selection,requirements:binding.requirements}});
      if(id.role==='employee') {
        firstTask.subTasks.push({id:id.subtaskId,status:index<2?'failed':'completed',...(index?{continueFromSubtaskId:`sub-${index-1}`} : {}),executionSession:{cli:id.cli,sessionId:id.session.id,configId:binding.selection.configId}});
        firstTask.loopPlus.seenAttempts.push({subtaskId:id.subtaskId,attemptId:id.attemptId,disposition:'reviewed',acceptance:index<2?'failed':'passed'});
      }
    }
    const scope={...source.bindings[0].identity,generation};
    sets.push({scope,state:'closed',producerId:'producer',closure:{scope,producerId:'producer'},entries});
  }
  // The untouched second module runs only after C and capacity return.
  for(const binding of source.bindings.slice(2)) bindings.push(binding);
  protocol.push(...source.protocol.filter(e=>e.identity?.leaderTaskId==='leader2').map(e=>({...e,pid:e.identity.role==='leader'?7:8})),
    ...[7,8].map(pid=>({event:'owner-close',pid,code:0,signal:null})));
  nativeFacts.push(...source.nativeFacts.slice(2)); originals.push(...source.originals.slice(2));
  const secondSet=allOpenCodeEvidence().cleanup.saved.leaderExecutionSets[1];
  secondSet.entries=source.bindings.slice(2).map(b=>({executionId:b.identity.executionId,responsibility:{selection:b.selection,requirements:b.requirements}}));
  sets.push(secondSet);
  firstTask.executionSession={cli:'opencode',sessionId:initial[0].identity.session.id};
  tasks.push(allOpenCodeEvidence().tasks[2]);
  const rounds=[], observed=[];
  for(const index of [0,1]) {
    const held={leaderTaskId:'leader1',subtaskId:`sub-${index}`,attemptId:`attempt-${index}`};
    const saved={runtime:{leaders:[{taskId:'leader1',status:'paused',generation:2+index*2}]},executionBindings:structuredClone(bindings.slice(0,2*(index+1))),leaderExecutionSets:structuredClone(sets.slice(0,index+1)),capacity:{rootTaskId:'root',maxLeaders:4,maxEmployees:20,leaders:[],employees:[]}};
    const pendingEvent={eventId:`event-${index}`,subtaskId:held.subtaskId,attemptId:held.attemptId,outcome:'stopped',detail:'公开停止'};
    const stoppedReview={...pendingEvent,acceptance:'failed'};
    rounds.push({held,stopped:{saved},pendingEvent,stoppedReview});
    observed.push({round:index+1,held,afterStopCleanup:{complete:true,saved,observations:saved.executionBindings.map(b=>({status:'cleaned',identity:b.identity}))},
      beforeStop:{employeeBinding:bindings[2*index+1]},pendingEvent,stoppedReview,noAutomaticRevival:{stable:true},cleanupObservedAt:15+index*10,
      successorBinding:bindings[2*(index+1)+1],afterContinue:{executionBindings:bindings.slice(0,2*(index+2))}});
  }
  const snapshot={rootId:'root',leaders:['leader1','leader2'],capacityReuse:{complete:true},employees:Array(4).fill({}),continuation:{rounds,continueCount:2,acceptedFinalEvent:'event-C',leaderReport:true}};
  return {cleanup:{complete:true,saved:{executionBindings:bindings,leaderExecutionSets:sets}},tasks,snapshot,protocol,evidence:{result:'two-stops-and-continues-observed',rounds:observed},
    launch:{bindings,protocol,nativeFacts,originals,isolatedRoot:'/isolated',snapshot}};
}
test('successive native facts retain both stopped generations and final three-turn leaders', () => {
  const h=successiveEvidence();
  assert.deepEqual(h.launch.bindings.map(b=>expectedNativeTurns(b.identity,h.snapshot)),[1,1,1,1,3,1,3,1]);
  assert.equal(assertOpenCodeLaunchEvidence(h.launch).length,8);
  assert.equal(assertMixedEvidence({...h,roles:{leader:'opencode',employee:'opencode'}}).length,8);
  for(const change of [h=>h.launch.nativeFacts[2].turns.push(h.launch.nativeFacts[2].turns[0]),
    h=>h.launch.protocol.find(e=>e.retired?.identity.generation===3).retired.directory='/foreign',
    h=>h.launch.originals.splice(2,1)]) {
    const h=successiveEvidence();change(h);assert.throws(()=>assertOpenCodeLaunchEvidence(h.launch));
  }
});
test('successive aggregation proves each exact stopped source, preserved binding, returned capacity and direct successor independently', () => {
  assert.equal(assertSuccessiveEvidence(successiveEvidence()).links.length,4);
  for(const change of [h=>h.evidence.rounds.pop(),h=>h.evidence.rounds[1].afterStopCleanup.complete=false,
    h=>h.snapshot.continuation.rounds[1].stopped.saved.capacity.employees.push('retained'),
    h=>h.evidence.rounds[1].beforeStop.employeeBinding=h.evidence.rounds[0].beforeStop.employeeBinding,
    h=>h.protocol.find(e=>e.retired?.identity.generation===3).retired.identity=h.launch.bindings[0].identity,
    h=>h.evidence.rounds[1].cleanupObservedAt=100,
    h=>h.protocol.find(e=>e.selection && e.identity.role==='leader' && e.identity.generation===3).launchEvidence.sessionId='foreign',
    h=>h.protocol.find(e=>e.selection && e.identity.role==='leader' && e.identity.generation===3).launchEvidence.cwd=h.protocol.find(e=>e.selection && e.identity.role==='leader' && e.identity.generation===1).launchEvidence.cwd,
    h=>h.evidence.rounds[1].successorBinding=structuredClone(h.evidence.rounds[0].successorBinding),
    h=>h.tasks[1].subTasks[2].executionSession.configId='foreign',h=>h.snapshot.continuation.acceptedFinalEvent=null]) {
    const h=successiveEvidence();change(h);assert.throws(()=>assertSuccessiveEvidence(h));
  }
});

test('successive driver injects the isolated product validator and shared absolute CDP deadline, releasing only its connection', async () => {
  const fs=require('node:fs'),os=require('node:os');
  const product=fs.mkdtempSync(path.join(os.tmpdir(),'successive-driver-validator-'));
  fs.mkdirSync(path.join(product,'dist/extensionHost'),{recursive:true});
  fs.writeFileSync(path.join(product,'dist/extensionHost/departmentruntimestate.js'),'exports.isDepartmentExecutionBinding = value => value === "isolated-validator-sentinel";');
  let closed=0,released=0;
  const browser={close:async()=>{closed++;}};
  const report={};
  try {
    const run=async fail=>drivePublicSuccessiveContinuation({port:123,product,report,scenario:{releaseAll:()=>released++},budgetMs:1000,
      chromium:{connectOverCDP:async()=>browser},webviewFactory:async(b,p,ms,options)=>({b,p,ms,options}),
      drive:async options=>{
        assert.equal(options.browser,browser);assert.equal(options.isExecutionBinding('isolated-validator-sentinel'),true);
        assert.equal(options.isExecutionBinding({}),false);
        const a=await options.createWebviewAdapter(browser,'webviewView',options.timeoutMs);
        const b=await options.createWebviewAdapter(browser,'webviewPanel',options.timeoutMs);
        assert.equal(a.options.deadline,b.options.deadline);assert.ok(a.options.cleanupDeadline>a.options.deadline);
        if(fail) throw new Error('adapter failure');return 'observed';
      }});
    assert.equal(await run(false),'observed');await assert.rejects(run(true),/adapter failure/);
    assert.equal(closed,2);assert.equal(released,2);
  } finally {fs.rmSync(product,{recursive:true,force:true});}
});

test('root-scoped shared CDP discovers real untyped OOPIF panels by exact public DOM and rejects duplicates/foreign targets', async () => {
  const rootId='root-public';
  const url='vscode-webview://panel/index.html?extensionId=sinitek.sinitek-cli-tools';
  const run=async ({duplicate=false,foreign=false,wrongRoot=false}={})=>{
    const infos=[{type:'iframe',targetId:'leader',url}, {type:'iframe',targetId:'root',url:foreign?url.replace('sinitek.sinitek','foreign.sinitek'):url},
      ...(duplicate?[{type:'iframe',targetId:'duplicate',url}]:[])];
    let detached=0;
    const browser={newBrowserCDPSession:async()=>{
      const cdp=new EventEmitter();cdp.detach=async()=>detached++;
      cdp.send=async(method,params)=>{
        if(method==='Target.getTargets')return {targetInfos:infos};
        if(['Target.setDiscoverTargets','Target.detachFromTarget'].includes(method))return {};
        if(method==='Target.attachToTarget')return {sessionId:params.targetId};
        if(method==='Target.sendMessageToTarget'){
          const command=JSON.parse(params.message);
          if(command.method==='Runtime.enable')setImmediate(()=>cdp.emit('Target.receivedMessageFromTarget',{sessionId:params.sessionId,
            message:JSON.stringify({method:'Runtime.executionContextCreated',params:{context:{id:1,auxData:{isDefault:true}}}})}));
          const targetRoot=wrongRoot?'another-root':rootId;
          const value=command.method!=='Runtime.evaluate'?undefined:params.sessionId==='leader'?'产研部 · 组长 · leader-other':
            command.params.expression.includes('getAttribute')?`产研部 · 总监 · ${targetRoot}`:`产研部 · 总监 ${targetRoot}`;
          setImmediate(()=>cdp.emit('Target.receivedMessageFromTarget',{sessionId:params.sessionId,message:JSON.stringify({id:command.id,result:{result:{value}}})}));
          return {};
        }
        throw Error(method);
      };return cdp;
    }};
    const deadline=Date.now()+100;
    const adapter=await createDepartmentWebviewAdapter(browser,'webviewPanel',100,{rootId,deadline,cleanupDeadline:deadline});
    assert.equal(adapter.target.verifiedPurpose,'webviewPanel');assert.equal(adapter.target.verifiedRootId,rootId);
    assert.equal(adapter.target.targetId,'root');await adapter.close();assert.ok(detached>=3);
  };
  await run();
  await assert.rejects(run({duplicate:true}),/multiple production/);
  await assert.rejects(run({foreign:true}),/deadline|budget/);
  await assert.rejects(run({wrongRoot:true}),/deadline|budget/);
});

// These tests exercise the real public-driver wrapper, not just its diagnostics.
test('successive driver rejects unconfirmed disconnect or adapter cleanup and preserves business failure', async (t) => {
  const fs = require('node:fs'), os = require('node:os');
  const product = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cleanup-gate-'));
  fs.mkdirSync(path.join(product, 'dist/extensionHost'), { recursive: true });
  fs.writeFileSync(path.join(product, 'dist/extensionHost/departmentruntimestate.js'), 'exports.isDepartmentExecutionBinding = () => false;');
  try {
    for (const mode of ['reject', 'hang', 'diagnostics', 'business-and-cleanup', 'expired']) await t.test(mode, async () => {
      const report = {}, business = new Error('original business error'); let released = 0, closed = 0;
      const start = Date.now();
      const running = drivePublicSuccessiveContinuation({ port: 1, product, report, budgetMs: 120,
        scenario: { releaseAll: () => released++ },
        chromium: { connectOverCDP: async () => ({ close: () => {
          closed++;
          if (mode === 'hang') return new Promise(() => {});
          if (mode !== 'diagnostics') throw Error('disconnect rejected');
        } }) },
        drive: async options => {
          if (mode === 'diagnostics') {
            const adapter = await options.createWebviewAdapter(options.browser, 'webviewPanel', options.timeoutMs);
            await adapter.close();
          }
          if (mode === 'business-and-cleanup') throw business;
          if (mode === 'expired') await new Promise(resolve => setTimeout(resolve, 135));
          return 'business succeeded';
        }, webviewFactory: async (_b, _p, _ms, options) => ({ close: async () => options.diagnostics.push({ operation: 'target detach', status: 'unconfirmed' }) }) });
      await assert.rejects(running, error => mode === 'business-and-cleanup' ? error === business : /CDP cleanup unconfirmed/.test(error.message));
      assert.equal(closed, 1); assert.equal(released, 1);
      assert.ok(report.successiveCdpCleanup.length > 0);
      assert.ok(Date.now() - start < 400, 'cleanup escaped its absolute budget');
    });
  } finally { fs.rmSync(product, { recursive: true, force: true }); }
});

function cleanupGateBrowser({ candidateFailure = false, discoveryFailure = false, duplicate = false } = {}) {
  let connections = 0;
  const released = [];
  return { released, newBrowserCDPSession: async () => {
    const index = connections++, cdp = new EventEmitter();
    cdp.detach = async () => { released.push(index); if (index === 0 && discoveryFailure) throw Error('discovery detach rejected'); };
    cdp.send = async (method, params) => {
      if (method === 'Target.getTargets') return { targetInfos: [
        { type: 'iframe', targetId: candidateFailure ? 'wrong' : 'root', url: 'vscode-webview://panel/index.html?extensionId=sinitek.sinitek-cli-tools' },
        ...(duplicate ? [{ type: 'iframe', targetId: 'duplicate', url: 'vscode-webview://panel/index.html?extensionId=sinitek.sinitek-cli-tools' }] : [])] };
      if (method === 'Target.setDiscoverTargets') return {};
      if (method === 'Target.detachFromTarget') { if (candidateFailure) throw Error('candidate target detach rejected'); return {}; }
      if (method === 'Target.attachToTarget') return { sessionId: params.targetId };
      if (method === 'Target.sendMessageToTarget') {
        const command = JSON.parse(params.message);
        if (command.method === 'Runtime.enable') setImmediate(() => cdp.emit('Target.receivedMessageFromTarget', { sessionId: params.sessionId,
          message: JSON.stringify({ method: 'Runtime.executionContextCreated', params: { context: { id: 1, auxData: { isDefault: true } } } }) }));
        const value = command.method !== 'Runtime.evaluate' ? undefined : params.sessionId === 'wrong' ? 'other' :
          command.params.expression.includes('getAttribute') ? '产研部 · 总监 · root' : '产研部 · 总监 root';
        setImmediate(() => cdp.emit('Target.receivedMessageFromTarget', { sessionId: params.sessionId,
          message: JSON.stringify({ id: command.id, result: { result: { value } } }) }));
        return {};
      }
      throw Error(method);
    };
    return cdp;
  } };
}

test('root panel candidate and discovery cleanup failures reject actual factory and preserve discovery errors', async (t) => {
  for (const mode of ['candidateFailure', 'discoveryFailure', 'duplicate']) await t.test(mode, async () => {
    const browser = cleanupGateBrowser({ [mode]: true, discoveryFailure: mode !== 'candidateFailure' });
    const diagnostics = [], deadline = Date.now() + 50;
    await assert.rejects(createDepartmentWebviewAdapter(browser, 'webviewPanel', 50,
      { rootId: 'root', deadline, cleanupDeadline: deadline + 40, diagnostics }),
      mode === 'duplicate' ? /multiple production/ : /cleanup unconfirmed/);
    assert.ok(diagnostics.length > 0);
    assert.ok(browser.released.length >= 2, 'selected/candidate sessions leaked on discovery failure');
  });
});

test('late root discovery session is only released, bounded and diagnosed after timeout', async () => {
  let resolveSession, detached = 0, sent = 0;
  const diagnostics = [], deadline = Date.now() + 20;
  const acquiring = createDepartmentWebviewAdapter({ newBrowserCDPSession: () => new Promise(resolve => { resolveSession = resolve; }) },
    'webviewPanel', 20, { rootId: 'root', deadline, cleanupDeadline: deadline + 35, diagnostics });
  await assert.rejects(acquiring, /discovery session exceeded its absolute deadline/);
  resolveSession({ detach: () => { detached++; return new Promise(() => {}); }, send: () => { sent++; } });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(detached, 1); assert.equal(sent, 0);
  assert.ok(diagnostics.some(d => d.operation === 'late root panel discovery detach' && d.status === 'unconfirmed'));
});

test('cold driver passes exact root and deadlines to shared panel factory and rejects cleanup-only failure', async () => {
  const { driveColdProductionRecoveryCheck } = require('./verify_department_full_eh_integration');
  const fs = require('node:fs'), os = require('node:os'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'cold-root-gate-'));
  try {
    let clicked = 0, closed = 0;
    for (const fail of [false, true]) {
      const now = Date.now(), deadlines = { actionDeadline: now + 100, evidenceDeadline: now + 150, hostDeadline: now + 200 };
      const running = driveColdProductionRecoveryCheck(1, 'root', root, deadlines, {
        chromium: { connectOverCDP: async () => ({ contexts: () => [{ pages: () => [{ url: () => 'vscode-file://workbench' }] }], close: async () => closed++ }) },
        signal: () => {}, evidenceExists: () => true,
        webviewFactory: async (_browser, purpose, _ms, options) => {
          assert.equal(purpose, 'webviewPanel'); assert.equal(options.rootId, 'root');
          assert.equal(options.deadline, deadlines.actionDeadline); assert.equal(options.cleanupDeadline, deadlines.hostDeadline);
          return { locator: selector => ({ waitFor: async () => {}, count: async () => 1, getAttribute: async () => '产研部 · 总监 · root', click: async () => clicked++ }),
            close: async () => fail ? [{ operation: 'target detach', status: 'unconfirmed' }] : [] };
        }
      });
      if (fail) await assert.rejects(running, /cold CDP cleanup unconfirmed/); else await running;
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'cold-cdp-cleanup.json'))).confirmed, !fail);
    }
    assert.equal(clicked, 2); assert.equal(closed, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('successive late connection cannot resume business and failed late disconnect remains diagnosed', async () => {
  let connected, closed = 0, invoked = 0;
  const report = {};
  const running = drivePublicSuccessiveContinuation({ port: 1, product: '/unused-before-connection', report, budgetMs: 60,
    scenario: { releaseAll() {} }, chromium: { connectOverCDP: () => new Promise(resolve => { connected = resolve; }) },
    drive: async () => { invoked++; } });
  await assert.rejects(running, /successive browser connection exceeded its absolute deadline/);
  connected({ close: async () => { closed++; throw Error('late disconnect failed'); } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(closed, 1); assert.equal(invoked, 0);
  assert.ok(report.successiveCdpCleanup.some(d => d.error.includes('late disconnect failed')));
});

test('cold driver propagates concrete observer failure and confirms CDP release before the EH may exit', async () => {
  const { driveColdProductionRecoveryCheck } = require('./verify_department_full_eh_integration');
  const fs = require('node:fs'), os = require('node:os'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'cold-observer-failure-'));
  const events = [];
  try {
    const now = Date.now();
    const running = driveColdProductionRecoveryCheck(1, 'root', root,
      { actionDeadline: now + 300, evidenceDeadline: now + 500, hostDeadline: now + 700 }, {
        chromium: { connectOverCDP: async () => ({ contexts: () => [{ pages: () => [{ url: () => 'vscode-file://workbench' }] }],
          close: async () => events.push('disconnect') }) },
        webviewFactory: async () => ({ locator: () => ({ waitFor: async () => {}, count: async () => 1,
          getAttribute: async () => '部门 · root', click: async () => events.push('click') }), close: async () => events.push('detach') }),
        signal: () => events.push('signal'), evidenceExists: () => false,
        readFailure: () => ({ phase: 'awaiting-public-stop', error: 'exact original failure' }),
      });
    await assert.rejects(running, /cold second EH awaiting-public-stop: exact original failure/);
    assert.deepEqual(events, ['click', 'signal', 'detach', 'disconnect']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'cold-cdp-cleanup.json'))).confirmed, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cold main failure waits for second EH normal exit within its original deadline and preserves first error', async () => {
  const { settleColdPublicControl } = require('./verify_department_full_eh_integration');
  for (const exits of [true, false]) {
    let clock = 10, exited = false, cleanupConfirmed = false;
    const original = Error('original warning mismatch');
    await assert.rejects(settleColdPublicControl(async () => { cleanupConfirmed = true; throw original; },
      () => exited, 50, async ms => { assert.equal(cleanupConfirmed, true); clock += ms; if (exits) exited = true; }, () => clock),
    error => error === original);
    assert.equal(clock, 50);
    assert.equal(exited, exits);
  }
  assert.equal(await settleColdPublicControl(async () => 'evidence-ready', () => false, 0, async () => {
    assert.fail('success branch introduced a second wait'); }), 'evidence-ready');
});
