"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { argumentsFor, readEvents, assertSavedTransition, assertSettled, assertCleanup } = require("./verify_department_employee_allocation_eh_integration");

test("allocation driver accepts only the dedicated product/report command", () => {
  assert.equal(argumentsFor(["--product", ".", "--report", "report.json"]).product, process.cwd());
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
