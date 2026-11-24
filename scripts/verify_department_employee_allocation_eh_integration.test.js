"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { argumentsFor, readEvents, assertSavedTransition, assertSettled, assertCleanup, assertAllocationDispatch, assertAppliedTransition,
  readOrganizationStop, assertPublicStop, assertWorkspaceSaved, publicDepartmentEntry } = require("./verify_department_employee_allocation_eh_integration");

test("allocation driver accepts only the dedicated product/report command", () => {
  assert.equal(argumentsFor(["--product", ".", "--report", "report.json"]).product, process.cwd());
  assert.equal(argumentsFor(["--product", ".", "--report", "report.json", "--workspace-capacity"]).workspaceCapacity, true);
  assert.throws(() => argumentsFor(["--product", ".", "--report", "r", "--arbitrary"]));
  assert.throws(() => argumentsFor(["--product", ".", "--scenario", "cold-start"]));
});
test("observer reader preserves LF and legacy literal separators without splitting JSON strings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allocation-log-test-")), file = path.join(dir, "log");
  try {
    const values = [{ text: "line\nnext\n{nested}\\n{literal}" }, { text: "other" }];
    for (const separator of ["\n", "\\n"]) {
      fs.writeFileSync(file, values.map(v => JSON.stringify(v)).join(separator) + separator); assert.deepEqual(readEvents(file), values);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("save evidence requires revision-only desired transition and matching actual settled identities", () => {
  const before = { employeeAllocation: { revision: 2, leaders: [{ leaderTaskId: "leader", manualLimit: null, appliedLimit: 5 }] }, capacity: { employees: ["held"] }, executionBindings: ["owner"], leaderExecutionSets: ["responsibility"] };
  const after = structuredClone(before); after.employeeAllocation.revision++; after.employeeAllocation.leaders[0].manualLimit = 0;
  assertSavedTransition(before, after, "leader", 0);
  const earlyApply = structuredClone(after); earlyApply.employeeAllocation.leaders[0].appliedLimit = 0;
  assert.throws(() => assertSavedTransition(before, earlyApply, "leader", 0), /save applied early/);
  after.capacity.employees = []; assert.throws(() => assertSavedTransition(before, after, "leader", 0), /altered live capacity/);
  const events = [{ event: "webview-request", message: { requestId: "req", leaderTaskId: "leader", expectedRevision: 2, employeeLimit: 0 } },
    { event: "webview-settled", message: { type: "loopGroupChatChat:departmentEmployeeLimitSettled", rootTaskId: "root", leaderTaskId: "leader", requestId: "req", ok: true, revision: 3, desiredLimit: 0 } }];
  assertSettled(events, "root", "leader", 2, 0, 3);
  for (const key of ["requestId", "rootTaskId", "leaderTaskId"]) {
    const bad = structuredClone(events); bad[1].message[key] = "foreign"; assert.throws(() => assertSettled(bad, "root", "leader", 2, 0, 3));
  }
  assert.throws(() => assertSettled(events.slice(0, 1), "root", "leader", 2, 0, 3), /settled/);
  assert.throws(() => assertSettled(events, "root", "leader", 1, 0, 3), /exact real host request/);
});

function loopPlusStopFixture() {
  const root = { id: "root", workspaceKey: "workspace", status: "running", department: { role: "director", rootTaskId: "root", executionMode: "loop-plus" }, subTasks: [{ id: "module" }] };
  const original = { leaderTaskId: "leader", subtaskId: "allocation-held", attemptId: "actual-attempt" };
  const { leaderTaskId, ...attempt } = original;
  const leader = { id: leaderTaskId, workspaceKey: "workspace", status: "running", schedulingMode: "event_driven",
    department: { role: "leader", rootTaskId: "root", parentTaskId: "root", executionMode: "loop-plus", leaderSubtaskId: "module" },
    subTasks: [{ id: attempt.subtaskId, status: "running" }], loopPlus: { running: [attempt], pending: [], seenAttempts: [{ ...attempt, disposition: "open" }] } };
  const saved = { workspaceKey: "workspace", runtime: { rootTaskId: "root", stopping: false, leaders: [{ taskId: leaderTaskId, leaderSubtaskId: "module", status: "running" }] },
    employeeAllocation: { revision: 4, leaders: [{ leaderTaskId, manualLimit: 0, appliedLimit: 0 }] }, capacity: { leaders: ["module"], employees: [JSON.stringify([leaderTaskId, attempt.attemptId])] } };
  const tasks = [root, leader];
  const stopped = structuredClone({ tasks, saved });
  Object.assign(stopped.tasks[0], { status: "stopped" });
  Object.assign(stopped.tasks[1], { status: "stopped", activeSubtaskId: null, activeSubtaskIds: [] });
  stopped.tasks[1].subTasks[0].status = "blocked";
  Object.assign(stopped.tasks[1].loopPlus, { parentStopped: true, running: [], seenAttempts: [{ ...attempt, disposition: "finished", outcome: "stopped" }] });
  stopped.saved.runtime.leaders[0].status = "paused";
  stopped.saved.capacity = { leaders: [], employees: [] };
  const events = [{ event: "webview-stop", rootTaskId: "root", at: 1 }];
  const diagnostics = [{ path: "live", result: "started", stage: "request", at: 1 }, { path: "live", result: "confirmed", stage: "cleanup", at: 2 }];
  return { tasks, saved, original, stopped, events, diagnostics };
}

test("Loop+ dispatch at zero requires the observed logical task and attempt, exact occupancy, and no Owner fixtures", () => {
  const { tasks, saved, original } = loopPlusStopFixture();
  assertAllocationDispatch(tasks, saved, "root", "leader", [original], 0);
  const pending = structuredClone(saved); pending.employeeAllocation.revision--; pending.employeeAllocation.leaders[0].appliedLimit = 5;
  assertAppliedTransition(pending, saved, "leader", 0);
  assert.throws(() => assertAppliedTransition(saved, saved, "leader", 0));
  for (const key of [["leader", original.subtaskId], ["module", original.attemptId], ["foreign", original.attemptId]]) {
    const bad = structuredClone(saved); bad.capacity.employees = [JSON.stringify(key)];
    assert.throws(() => assertAllocationDispatch(tasks, bad, "root", "leader", [original], 0), /exact employee capacity keys/);
  }
  assert.throws(() => assertAllocationDispatch(tasks, saved, "root", "leader", [{ ...original, subtaskId: "wrong" }], 0), /durable logical employee task/);
  tasks[0].department.executionMode = undefined;
  assert.throws(() => assertAllocationDispatch(tasks, saved, "root", "leader", [original], 0), /public Loop\+ root/);
});

test("public Loop+ stop needs a confirmed live stop, durable original settlement, unchanged attempts and returned capacity", () => {
  const { tasks, saved, original, stopped, events, diagnostics } = loopPlusStopFixture();
  const before = assertAllocationDispatch(tasks, saved, "root", "leader", [original], 0);
  const check = ({ tasks, saved }, actions = events, proof = diagnostics) => assertPublicStop(before, tasks, saved, original, [original], actions, proof);
  assert.equal(check(stopped).originalAttempt.outcome, "stopped");
  assert.throws(() => check(stopped, []), /actual director webview stop/);
  assert.throws(() => check(stopped, events, diagnostics.slice(0, 1)), /not confirmed/);
  assert.throws(() => check(stopped, events, [diagnostics[0], { ...diagnostics[1], result: "unconfirmed" }]), /not confirmed/);
  for (const mutate of [
    after => { after.saved.runtime.stopping = true; },
    after => { after.saved.capacity.employees = saved.capacity.employees; },
    after => { after.tasks[1].loopPlus.seenAttempts[0].outcome = "completed"; },
    after => { after.tasks[1].loopPlus.seenAttempts.push({ subtaskId: original.subtaskId, attemptId: "replacement", disposition: "finished", outcome: "stopped" }); },
    after => { after.tasks[1].loopPlus.seenAttempts = []; },
    after => { after.tasks[1].loopPlus.running = tasks[1].loopPlus.running; },
    after => { after.tasks[0].subTasks.push({ id: "new-module" }); },
  ]) {
    const bad = structuredClone(stopped); mutate(bad); assert.throws(() => check(bad));
  }
});

test("stop log reader joins real logger segments by root and ignores only the unfinished tail", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allocation-stop-log-test-"));
  const line = (rootTaskId, result, stage, seconds) => `[2026-11-23T00:00:0${seconds}.000Z] [INFO] department-organization-stop | ${JSON.stringify({ rootTaskId, path: "live", result, stage })}\n`;
  try {
    fs.writeFileSync(path.join(dir, "sinitek-cli.2026-11-23.log"), line("root", "started", "request", 1) + line("other", "unconfirmed", "cleanup", 2));
    fs.writeFileSync(path.join(dir, "sinitek-cli.2026-11-23.1.log"), line("root", "confirmed", "cleanup", 3) + "incomplete");
    assert.deepEqual(readOrganizationStop(dir, "root").map(event => [event.result, event.stage]), [["started", "request"], ["confirmed", "cleanup"]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("cleanup checker rejects task-status-only completion without original responsibility/receipt proof", () => {
  assert.throws(() => assertCleanup({ runtime: { status: "completed" }, capacity: { employees: [], leaders: [] } }, [], [], {}, {}, [], 5), /original execution bindings/);
});

test("cleanup requires all original policies, CLOSED entries and natural exit, without requiring Electron close", () => {
  const expectedExecutions = 5;
  const bindings = Array.from({ length: expectedExecutions }, (_, index) => ({ identity: { executionId: `exec-${index}`, ownerId: `owner-${index}` }, selection: { cli: "codex" }, requirements: { streams: true } }));
  const saved = { executionBindings: bindings, leaderExecutionSets: [{ state: "closed", scope: { rootTaskId: "root" }, producerId: "producer",
    closure: { scope: { rootTaskId: "root" }, producerId: "producer" }, entries: bindings.map(b => ({ executionId: b.identity.executionId, responsibility: { selection: b.selection, requirements: b.requirements } })) }],
    capacity: { leaders: [], employees: [] } };
  const observations = bindings.map(b => ({ source: "original-client-waitForCleanup-return", identity: b.identity, requirements: b.requirements,
    receipt: { identity: b.identity, requirements: b.requirements, cleanup: { streams: "confirmed" } } }));
  const protocol = bindings.map((b, i) => ({ pid: i + 1, identity: b.identity }));
  const workers = bindings.map((b, i) => ({ event: "worker-exit", pid: i + 1, code: 0, signal: null }));
  const identityApi = { sameExecution: (a, b) => a.executionId === b.executionId, cleanupComplete: (c, r) => r.streams && c.streams === "confirmed" };
  const receiptApi = { isDepartmentExecutionReceipt: r => !!r.identity };
  assert.equal(assertCleanup(saved, observations, protocol, identityApi, receiptApi, workers, expectedExecutions).complete, true);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const bad = structuredClone(workers); bad[0].signal = signal;
    assert.throws(() => assertCleanup(saved, observations, protocol, identityApi, receiptApi, bad, expectedExecutions), /naturally/);
  }
  assert.throws(() => assertCleanup(saved, observations.slice(1), protocol, identityApi, receiptApi, workers, expectedExecutions));
  const partial = structuredClone(observations); partial[0].receipt.cleanup.streams = "unknown";
  assert.throws(() => assertCleanup(saved, partial, protocol, identityApi, receiptApi, workers, expectedExecutions), /incomplete/);
});

test("workspace UI proof rejects unmatched scope/request, missing durable save and global mutation", () => {
  const key = "workspaceDepartmentMaxEmployees", scope = JSON.stringify(["workspace", 1, "codex", "local"]);
  const durable = { departmentMaxLeaders: 2, departmentMaxEmployees: 6 }, global = { departmentMaxLeaders: 4, departmentMaxEmployees: 20 };
  const events = [{ event: "settings-request", message: { type: "updateSetting", key, value: { scope, requestId: "ui-2", value: 6 } } },
    { event: "settings-saved", message: { type: "workspaceDepartmentCapacitySaved", key, scope, requestId: "ui-2", ok: true }, workspaceSettings: { "workspace.json": durable } },
    { event: "settings-state", state: { departmentConfigurationScope: scope, departmentMaxLeaders: 4, departmentMaxEmployees: 20, [key]: 6 } }];
  const check = (items = events, disk = durable, settings = global) => assertWorkspaceSaved(items, key, 6, "workspace", disk, settings);
  check();
  for (const field of ["scope", "requestId", "key", "ok"]) {
    const bad = structuredClone(events); bad[1].message[field] = "wrong"; assert.throws(() => check(bad));
  }
  const unsaved = structuredClone(events); unsaved[1].workspaceSettings["workspace.json"].departmentMaxEmployees = 20;
  assert.throws(() => check(unsaved)); assert.throws(() => check(events, {}));
  assert.throws(() => check(events, durable, { ...global, departmentMaxEmployees: 6 }));
  const stale = structuredClone(events); stale[2].state.departmentConfigurationScope = "old"; assert.throws(() => check(stale));
});

test("restored settled uses the snapshot-derived default quota for 2/6", () => {
  const events = [{ event: "webview-request", message: { requestId: "restore", leaderTaskId: "leader", expectedRevision: 4, employeeLimit: null } },
    { event: "webview-settled", message: { type: "loopGroupChatChat:departmentEmployeeLimitSettled", rootTaskId: "root", leaderTaskId: "leader", requestId: "restore", ok: true, revision: 5, desiredLimit: 3 } }];
  assertSettled(events, "root", "leader", 4, null, 5, 3);
  assert.throws(() => assertSettled(events, "root", "leader", 4, null, 5));
});

test("public entry saves workspace before enable and selects all three roles through existing controls", async () => {
  const actions = [];
  const view = { locator(selector) { return {
    click: async () => actions.push([selector, "click"]), check: async () => actions.push([selector, "check"]),
    waitFor: async () => {}, isEnabled: async () => true, isDisabled: async () => false,
    fill: async value => actions.push([selector, value]), innerText: async () => "", inputValue: async () => "plan",
    locator: () => ({ evaluateAll: async () => selector === "#modelSelect" ? ["gpt-5"] : ["codex-local", "__default__"] }),
    selectOption: async value => {
      if (selector === "#modelSelect") assert.equal(value, "gpt-5", "configured Codex model has no empty default option");
      actions.push([selector, value]);
    },
  }; } };
  await publicDepartmentEntry(view, "create", async (_label, check) => assert.ok(await check()), async () => actions.push(["workspace", "saved"]));
  assert.ok(!actions.some(([selector]) => /^#department-(leader|employee)-config$/.test(selector)));
  assert.ok(actions.findIndex(a => a[0] === "workspace") < actions.findIndex(a => a[0] === "#departmentEnabled"));
  for (const [selector, value] of [["#configSelect", "codex-local"], ["#modelSelect", "gpt-5"], ["#department-leader-model", "__default__"], ["#department-employee-model", "__default__"]]) {
    assert.ok(actions.some(a => a[0] === selector && a[1] === value));
    assert.ok(actions.findIndex(a => a[0] === selector) < actions.findIndex(a => a[0] === "#sendPrompt"));
  }
});
