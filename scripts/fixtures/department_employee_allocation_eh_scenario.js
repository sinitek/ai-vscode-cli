"use strict";
const assert = require("node:assert/strict");
const { latestUserText } = require("./department_full_eh_scenario");

function assertAllocationPrompt(text, saved, leaderId, legacy = false) {
  const allocation = saved.employeeAllocation;
  const row = allocation.leaders.find(r => r.leaderTaskId === leaderId);
  assert.ok(row, "decision lacks durable allocation membership");
  const active = saved.capacity.employees.length;
  const own = saved.capacity.employees.filter(k => JSON.parse(k)[0] === leaderId).length;
  const desired = row.manualLimit ?? Math.ceil(allocation.maxEmployees / allocation.maxLeaders);
  const available = Math.min(Math.max(0, allocation.maxEmployees - active), Math.max(0, desired - own));
  const lines = [
    `Regular employee total: ${allocation.maxEmployees}`,
    `Active employees in this department across all leaders, including overflow employees: ${active}`,
    `Available regular employee balance: ${Math.max(0, allocation.maxEmployees - active)}`,
    `Allocation source: ${row.manualLimit === null ? "default" : "manual"}`,
    `Desired regular employee limit for this group: ${desired}`,
    `Applied group limit: ${row.appliedLimit === null ? "not yet applied" : row.appliedLimit}`,
    `Active employees in this leader group, including overflow employees: ${own}`,
    `Regular employee balance available to this leader's next dispatch: ${available}`,
    `Host allocation revision: ${allocation.revision}`,
    `Host reports this allocation pending: ${row.appliedLimit !== desired ? "yes" : "no"}`,
    legacy ? "This leader may acquire an overflow employee now: no"
      : "Department capacity figures are advisory. Choose how many employees to dispatch based on the work, including when the balance is zero or unknown.",
  ];
  for (const line of lines) assert.ok(text.includes(line + "\n"), `production prompt mismatch: ${line}`);
  assert.doesNotMatch(text, /allocation: unknown|employee balance unknown/);
  return { revision: allocation.revision, desiredLimit: desired, appliedLimit: row.appliedLimit,
    pending: row.appliedLimit !== desired, activeEmployees: own, globalActiveEmployees: active, availableEmployees: available };
}

function assertReaderProjection(reader, projection, saved, rootId, leaderId) {
  assert.ok(reader?.result?.leaderAllocation, "original production capacity reader required");
  assert.equal(reader.rootTaskId, rootId); assert.equal(reader.leaderTaskId, leaderId);
  const result = reader.result;
  assert.equal(result.maxEmployees, saved.employeeAllocation.maxEmployees);
  assert.equal(result.activeEmployees, projection.globalActiveEmployees);
  assert.equal(result.availableEmployees, Math.max(0, result.maxEmployees - projection.globalActiveEmployees));
  assert.equal(result.canAcquireOverflow, false); assert.equal(result.leaderOverflowActive, false);
  assert.deepEqual(result.leaderAllocation, { revision: projection.revision,
    source: saved.employeeAllocation.leaders.find(r => r.leaderTaskId === leaderId).manualLimit === null ? "default" : "manual",
    desiredLimit: projection.desiredLimit, appliedLimit: projection.appliedLimit, pending: projection.pending,
    activeEmployees: projection.activeEmployees, availableEmployees: projection.availableEmployees });
}

function createDepartmentEmployeeAllocationEhScenario({ prompt, readTasks, readRuntime, readDecision,
  expectedLimits = { maxLeaders: 4, maxEmployees: 20 }, holdTimeoutMs = 120000 }) {
  const history = [], held = new Map(), released = new Set(), employees = [];
  let rootId, leaderId, initial = false, zeroDispatched = false, restoreDispatched = false;
  const gates = new Map();
  const checks = ["dispatched work", "contracts", "tests", "artifacts", "unauthorized changes", "omissions and regressions"]
    .map(name => ({ name, passed: true, detail: "免费本机额度生命周期协议；非模型代码验收" }));
  const work = id => ({ id, title: `额度验证 ${id}`, taskType: "backend", writeFiles: [],
    prompt: `仅完成本机协议任务 ${id}：回复 ISOLATED ALLOCATION，不改文件、不访问外网，不再拆分任务。记录这是免费本地协议验证。` });
  const gate = name => {
    assert.ok(!gates.has(name), `duplicate provider hold ${name}`);
    if (released.has(name)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { gates.delete(name); reject(Error(`provider hold ${name} expired`)); }, holdTimeoutMs);
      gates.set(name, () => { clearTimeout(timer); gates.delete(name); resolve(); });
    });
  };
  const release = name => { released.add(name); gates.get(name)?.(); };
  async function respond(body, context) {
    const text = latestUserText(body); context.request.prompt = text;
    let stage, identity, answer, wait;
    if (text.startsWith("你是任务摘要器。")) {
      assert.ok(text.includes(prompt)); stage = "summary"; answer = "逐组额度生产链路验证";
    } else if (text.includes("使用经典 Loop JSON 决策。")) {
      identity = text.match(/任务 ID：([^；\s]+)；轮次：\d+/)?.[1];
      assert.ok(identity); rootId ??= identity; assert.equal(identity, rootId);
      const root = readTasks().find(t => t.id === rootId); assert.equal(root?.department?.role, "director");
      assert.deepEqual(root.department.limits, expectedLimits);
      if (!root.subTasks.length) {
        stage = "director-dispatch";
        answer = { status: "continue", progressPercent: 0, estimatedRemainingRounds: 1, subtasks: [{ id: "allocation-module", title: "额度链路",
          prompt: `${prompt}\n按真实事件派发与汇报本机额度验证，不修改任务记录、授权或调度状态。` }] };
      } else { stage = "director-wait"; answer = { status: "blocked", finalSummary: "等待额度场景公开停止与原完整清理" }; }
    } else if (text.includes("You are the Loop+ main reviewer.")) {
      identity = text.match(/^Parent task: (\S+)/m)?.[1];
      assert.ok(identity); leaderId ??= identity; assert.equal(identity, leaderId);
      const leader = readTasks().find(t => t.id === identity);
      assert.equal(leader?.department?.rootTaskId, rootId); assert.equal(leader?.department?.role, "leader");
      const snapshot = readRuntime(rootId);
      const projection = assertAllocationPrompt(text, snapshot, leaderId);
      context.request.allocation = projection;
      context.request.saved = snapshot;
      if (readDecision) {
        const reader = readDecision(rootId, leaderId);
        assertReaderProjection(reader, projection, snapshot, rootId, leaderId);
        context.request.productionReader = reader;
      }
      const event = leader.loopPlus?.currentReview;
      if (!initial) {
        assert.equal(text.match(/^Prompt kind: (\S+)/m)?.[1], "initial");
        initial = true; stage = "leader-initial";
        answer = { status: "dispatch", subtasks: [work("allocation-held"), work("allocation-pulse")] };
      } else {
        assert.ok(event && text.includes(`Current review eventId: ${event.eventId}\n`), "real event required");
        assert.equal(Number(text.match(/^Acceptance batch count: (\d+)/m)?.[1]), 1);
        assert.equal(event.outcome, "completed");
        answer = { status: "accept", reviewEventId: event.eventId, progressPercent: 30,
          reviews: [{ reviewEventId: event.eventId, acceptance: "passed", reason: "真实员工答复已到达事件" }],
          acceptance: { passed: true, checks } };
        if (event.subtaskId === "allocation-pulse") {
          assert.equal(zeroDispatched, false); zeroDispatched = true;
          assert.equal(projection.desiredLimit, 0); assert.equal(projection.appliedLimit, Math.ceil(snapshot.employeeAllocation.maxEmployees / snapshot.employeeAllocation.maxLeaders)); assert.equal(projection.pending, true);
          stage = "leader-zero-pending"; answer.subtasks = [work("allocation-zero")]; answer.independentSubtaskIds = ["allocation-zero"];
        } else if (event.subtaskId === "allocation-zero") {
          assert.equal(restoreDispatched, false); restoreDispatched = true;
          assert.equal(projection.desiredLimit, 0); assert.equal(projection.appliedLimit, 0); assert.equal(projection.pending, false);
          stage = "leader-zero-applied"; wait = "restore-saved";
          const next = work("allocation-restored"); answer.subtasks = [next]; answer.reviews[0].subtaskIds = [next.id];
        } else { stage = "leader-restored-applied"; }
      }
    } else if (text.includes("You are one independent Loop+ execution attempt.")) {
      const file = text.match(/^Attempt report file: (.+)$/m)?.[1]; assert.ok(file);
      const leader = readTasks().find(t => t.id === leaderId);
      const subtask = leader?.subTasks.find(s => s.communicationFile === file); assert.ok(subtask);
      const attempts = leader.loopPlus.running.filter(a => a.subtaskId === subtask.id); assert.equal(attempts.length, 1);
      assert.ok(["allocation-held", "allocation-pulse", "allocation-zero", "allocation-restored"].includes(subtask.id));
      identity = { leaderTaskId: leaderId, subtaskId: subtask.id, attemptId: attempts[0].attemptId };
      assert.ok(!employees.some(e => e.attemptId === identity.attemptId), "duplicate employee identity"); employees.push(identity);
      held.set(subtask.id, identity); stage = subtask.id; wait = subtask.id;
      answer = "ISOLATED ALLOCATION — 免费本机协议答复，未调用外部模型或修改代码。";
    } else throw Error("unexpected allocation production prompt");
    context.request.stage = stage; history.push({ stage, identity, allocation: context.request.allocation, at: Date.now() });
    if (wait) await gate(wait);
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  }
  return { respond, history, release, releaseAll: () => { for (const name of gates.keys()) release(name); },
    snapshot: () => ({ rootId, leaderId, initial, zeroDispatched, restoreDispatched, held: Object.fromEntries(held), employees, history }) };
}
module.exports = { assertAllocationPrompt, assertReaderProjection, createDepartmentEmployeeAllocationEhScenario };
