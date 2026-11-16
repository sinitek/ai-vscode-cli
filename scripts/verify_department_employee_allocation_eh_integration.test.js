"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { argumentsFor, readEvents, assertSavedTransition, assertSettled, assertCleanup, assertWorkspaceSaved, publicDepartmentEntry } = require("./verify_department_employee_allocation_eh_integration");

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
  after.capacity.employees = []; assert.throws(() => assertSavedTransition(before, after, "leader", 0));
  const events = [{ event: "webview-request", message: { requestId: "req", leaderTaskId: "leader", expectedRevision: 2, employeeLimit: 0 } },
    { event: "webview-settled", message: { type: "loopGroupChatChat:departmentEmployeeLimitSettled", rootTaskId: "root", leaderTaskId: "leader", requestId: "req", ok: true, revision: 3, desiredLimit: 0 } }];
  assertSettled(events, "root", "leader", 2, 0, 3);
  for (const key of ["requestId", "rootTaskId", "leaderTaskId"]) {
    const bad = structuredClone(events); bad[1].message[key] = "foreign"; assert.throws(() => assertSettled(bad, "root", "leader", 2, 0, 3));
  }
  assert.throws(() => assertSettled(events.slice(0, 1), "root", "leader", 2, 0, 3), /settled/);
});
test("cleanup checker rejects task-status-only completion without original responsibility/receipt proof", () => {
  assert.throws(() => assertCleanup({ runtime: { status: "completed" }, capacity: { employees: [], leaders: [] } }, [], [], {}, {}), /leader and three/);
});

test("cleanup requires all original policies, CLOSED entries and natural exit, without requiring Electron close", () => {
  const bindings = Array.from({ length: 4 }, (_, i) => ({ identity: { executionId: `exec-${i}`, ownerId: `owner-${i}` }, selection: { cli: "codex" }, requirements: { streams: true } }));
  const saved = { executionBindings: bindings, leaderExecutionSets: [{ state: "closed", scope: { rootTaskId: "root" }, producerId: "producer",
    closure: { scope: { rootTaskId: "root" }, producerId: "producer" }, entries: bindings.map(b => ({ executionId: b.identity.executionId, responsibility: { selection: b.selection, requirements: b.requirements } })) }],
    capacity: { leaders: [], employees: [] } };
  const observations = bindings.map(b => ({ source: "original-client-waitForCleanup-return", identity: b.identity, requirements: b.requirements,
    receipt: { identity: b.identity, requirements: b.requirements, cleanup: { streams: "confirmed" } } }));
  const protocol = bindings.map((b, i) => ({ pid: i + 1, identity: b.identity }));
  const workers = bindings.map((b, i) => ({ event: "worker-exit", pid: i + 1, code: 0, signal: null }));
  const identityApi = { sameExecution: (a, b) => a.executionId === b.executionId, cleanupComplete: (c, r) => r.streams && c.streams === "confirmed" };
  const receiptApi = { isDepartmentExecutionReceipt: r => !!r.identity };
  assert.equal(assertCleanup(saved, observations, protocol, identityApi, receiptApi, workers).complete, true);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const bad = structuredClone(workers); bad[0].signal = signal;
    assert.throws(() => assertCleanup(saved, observations, protocol, identityApi, receiptApi, bad), /naturally/);
  }
  assert.throws(() => assertCleanup(saved, observations.slice(1), protocol, identityApi, receiptApi, workers));
  const partial = structuredClone(observations); partial[0].receipt.cleanup.streams = "unknown";
  assert.throws(() => assertCleanup(saved, partial, protocol, identityApi, receiptApi, workers), /incomplete/);
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
  assert.ok(actions.findIndex(a => a[0] === "workspace") < actions.findIndex(a => a[0] === "#departmentEnabled"));
  for (const [selector, value] of [["#configSelect", "codex-local"], ["#modelSelect", "gpt-5"], ["#department-leader-model", "__default__"], ["#department-employee-model", "__default__"]]) {
    assert.ok(actions.some(a => a[0] === selector && a[1] === value));
    assert.ok(actions.findIndex(a => a[0] === selector) < actions.findIndex(a => a[0] === "#sendPrompt"));
  }
});
