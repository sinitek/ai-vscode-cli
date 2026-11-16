"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { assertAllocationPrompt, assertReaderProjection, createDepartmentEmployeeAllocationEhScenario } = require("./department_employee_allocation_eh_scenario");
const saved = { employeeAllocation: { revision: 4, maxEmployees: 20, maxLeaders: 4,
  leaders: [{ leaderTaskId: "leader", manualLimit: 0, appliedLimit: 5 }] }, capacity: { employees: [JSON.stringify(["leader", "real-attempt"])] } };
const lines = ["Regular employee total: 20", "Active employees in this department across all leaders, including overflow employees: 1",
  "Available regular employee balance: 19", "Allocation source: manual", "Desired regular employee limit for this group: 0", "Applied group limit: 5",
  "Active employees in this leader group, including overflow employees: 1", "Regular employee balance available to this leader's next dispatch: 0",
  "Host allocation revision: 4", "Host reports this allocation pending: yes", "This leader may acquire an overflow employee now: no"];
test("captured provider prompt must match durable nested desired/applied/revision and live occupancy", () => {
  const text = lines.join("\n") + "\n";
  assert.equal(assertAllocationPrompt(text, saved, "leader").pending, true);
  for (const line of lines) assert.throws(() => assertAllocationPrompt(text.replace(line, "wrong"), saved, "leader"), /mismatch/);
});
test("scenario rejects unknown prompt and cannot dispatch without production identities", async () => {
  const scenario = createDepartmentEmployeeAllocationEhScenario({ prompt: "private-isolated", readTasks: () => [], readRuntime: () => saved });
  await assert.rejects(scenario.respond({ input: [{ role: "user", content: "unrelated" }] }, { request: {} }), /unexpected/);
  await assert.rejects(scenario.respond({ input: [{ role: "user", content: "You are the Loop+ main reviewer.\nParent task: leader\n" }] }, { request: {} }));
  scenario.releaseAll(); assert.equal(scenario.snapshot().initial, false);
});

for (const limits of [{ maxLeaders: 4, maxEmployees: 20 }, { maxLeaders: 2, maxEmployees: 6 }]) test(`${limits.maxLeaders}/${limits.maxEmployees} scenario review dispatches pass the current production ownership parser and resume only after UI save latch`, async () => {
  const { parseLoopPlusDecisionWithFeedback } = require("../../dist/loopPlusDecision");
  const defaultLimit = Math.ceil(limits.maxEmployees / limits.maxLeaders);
  let current = structuredClone(saved);
  Object.assign(current.employeeAllocation, limits);
  current.employeeAllocation.revision = 1;
  current.employeeAllocation.leaders[0] = { leaderTaskId: "leader", manualLimit: null, appliedLimit: null };
  current.capacity.employees = [];
  const root = { id: "root", department: { role: "director", limits }, subTasks: [] };
  const leader = { id: "leader", department: { role: "leader", rootTaskId: "root" }, loopPlus: { currentReview: null } };
  const scenario = createDepartmentEmployeeAllocationEhScenario({ prompt: "public request", expectedLimits: limits, readTasks: () => [root, leader], readRuntime: () => current });
  const ask = text => scenario.respond({ input: [{ role: "user", content: text }] }, { request: {} });
  const promptFor = (kind, event) => {
    const row = current.employeeAllocation.leaders[0], desired = row.manualLimit ?? defaultLimit, active = current.capacity.employees.length;
    return ["You are the Loop+ main reviewer.", "Parent task: leader", `Prompt kind: ${kind}`, `Current review eventId: ${event ?? "(none)"}`, "Acceptance batch count: 1",
      `Regular employee total: ${limits.maxEmployees}`, `Active employees in this department across all leaders, including overflow employees: ${active}`,
      `Available regular employee balance: ${limits.maxEmployees - active}`, `Allocation source: ${row.manualLimit === null ? "default" : "manual"}`,
      `Desired regular employee limit for this group: ${desired}`, `Applied group limit: ${row.appliedLimit === null ? "not yet applied" : row.appliedLimit}`,
      `Active employees in this leader group, including overflow employees: ${active}`, `Regular employee balance available to this leader's next dispatch: ${Math.max(0, desired-active)}`,
      `Host allocation revision: ${current.employeeAllocation.revision}`, `Host reports this allocation pending: ${row.appliedLimit !== desired ? "yes" : "no"}`,
      "This leader may acquire an overflow employee now: no", ""].join("\n");
  };
  await ask("使用经典 Loop JSON 决策。\n任务 ID：root；轮次：1");
  const parse = text => {
    const parsed = parseLoopPlusDecisionWithFeedback(text, { requireAcceptanceFeedback: true, requireProgressPercent: true });
    assert.ok(parsed.decision, parsed.rejectionReason); return parsed.decision;
  };
  parse(await ask(promptFor("initial")));
  current.employeeAllocation.revision = 3; current.employeeAllocation.leaders[0].manualLimit = 0; current.employeeAllocation.leaders[0].appliedLimit = defaultLimit;
  current.capacity.employees = [JSON.stringify(["leader", "held"])];
  leader.loopPlus.currentReview = { eventId: "pulse-event", subtaskId: "allocation-pulse", outcome: "completed" };
  const zero = parse(await ask(promptFor("review", "pulse-event")));
  assert.deepEqual(zero.independentSubtaskIds, ["allocation-denied"]);
  current.employeeAllocation.revision = 4; current.employeeAllocation.leaders[0].appliedLimit = 0;
  leader.loopPlus.currentReview = { eventId: "denied-event", subtaskId: "allocation-denied", outcome: "failed" };
  let resolved = false;
  const pending = ask(promptFor("review", "denied-event")).then(text => { resolved = true; return text; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(resolved, false);
  scenario.release("restore-saved"); const restore = parse(await pending);
  assert.deepEqual(restore.reviews[0].subtaskIds, ["allocation-restored"]); scenario.releaseAll();
});

test("decision evidence rejects reader drift in source/revision/limits/live balance", () => {
  const projection = assertAllocationPrompt(lines.join("\n") + "\n", saved, "leader");
  const reader = { rootTaskId: "root", leaderTaskId: "leader", result: { maxEmployees: 20, activeEmployees: 1, availableEmployees: 19,
    canAcquireOverflow: false, leaderOverflowActive: false, leaderAllocation: { revision: 4, source: "manual", desiredLimit: 0, appliedLimit: 5,
      pending: true, activeEmployees: 1, availableEmployees: 0 } } };
  assertReaderProjection(reader, projection, saved, "root", "leader");
  for (const [key, value] of [["revision", 3], ["source", "default"], ["desiredLimit", 5], ["appliedLimit", 0], ["pending", false], ["activeEmployees", 2], ["availableEmployees", 1]]) {
    const bad = structuredClone(reader); bad.result.leaderAllocation[key] = value;
    assert.throws(() => assertReaderProjection(bad, projection, saved, "root", "leader"));
  }
  const bad = structuredClone(reader); bad.result.activeEmployees = 2;
  assert.throws(() => assertReaderProjection(bad, projection, saved, "root", "leader"));
});
