"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDepartmentContinuationEhScenario } = require("./department_continuation_eh_scenario");
const request = (text) => ({ input: [{ role: "user", content: text }] });
const initial = "You are the Loop+ main reviewer.\nParent task: actual-leader\nPrompt kind: initial\nCurrent review eventId: (none)\nStill running count: 0\nConfirmed acceptances: 0\nSnapshot says completion is allowed: yes";
function fixture(extra = {}) {
  const tasks = [{ id: "actual-root", department: { role: "director", rootTaskId: "actual-root" } },
    { id: "actual-leader", department: { role: "leader", rootTaskId: "actual-root" }, schedulingMode: "event_driven", subTasks: [], loopPlus: { running: [] } }];
  const scenario = createDepartmentContinuationEhScenario({ prompt: "isolated requirement", readTasks: () => tasks, inspectCleanup: async () => ({ complete: false }), ...extra });
  if (extra.roles) for (const task of tasks) task.cli = (task.department.routes = Object.fromEntries(Object.entries(extra.roles).map(([role, cli]) => [role, { cli }])))[task.department.role].cli;
  let index = 0;
  return { scenario, tasks, ask: (text) => extra.chat ? scenario.respondChat({ messages: [{ role: "user", content: text }] }, { index: ++index, request: {}, purpose: "task", transport: "chat-completions" }) : scenario.respond(request(text), { index: ++index, request: {} }) };
}
const director = "使用经典 Loop JSON 决策。\n任务 ID：actual-root；轮次：1\nisolated requirement\n模块总数：0";
const employee = "You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/actual-report.md";
async function held(h) {
  await h.ask(director); await h.ask(initial);
  h.tasks[1].subTasks = [{ id: "text-protocol", communicationFile: "/isolated/actual-report.md" }];
  h.tasks[1].loopPlus.running = [{ subtaskId: "text-protocol", attemptId: "actual-attempt" }];
  const result = h.ask(employee);
  await new Promise((resolve) => setImmediate(resolve));
  return { result };
}
const proof = () => ({ complete: true, rootId: "actual-root", saved: { runtime: { leaders: [{ taskId: "actual-leader", status: "paused" }] } } });
const event = (outcome = "stopped") => `You are the Loop+ main reviewer.\nParent task: actual-leader\nCurrent review eventId: actual-event\nAcceptance batch count: 1\n- current eventId=actual-event subtask=text-protocol attempt=actual-attempt outcome=${outcome}`;

test("employee latch is bounded, only original runtime identities are captured and cleanup gates public continuation", async () => {
  const h = fixture(); const pending = await held(h);
  try {
    assert.deepEqual(h.scenario.snapshot().continuation.held, { leaderTaskId: "actual-leader", subtaskId: "text-protocol", attemptId: "actual-attempt", reportFile: "/isolated/actual-report.md" });
    assert.throws(() => h.scenario.beginContinue({ ...proof(), complete: false }), /cleanup/);
    assert.throws(() => h.scenario.beginContinue({ ...proof(), rootId: "foreign" }), /another root/);
    const wrong = proof(); wrong.saved.runtime.leaders[0].status = "blocked";
    assert.throws(() => h.scenario.beginContinue(wrong), /paused/);
    assert.ok(h.scenario.beginContinue(proof()).includes("明确继续原组织"));
    assert.throws(() => h.scenario.beginContinue(proof()), /exactly one/);
  } finally { h.scenario.releaseEmployee(); await pending.result; }
});

test("resumed interrupted event is matched exactly and failed before an explicit session continuation is dispatched", async () => {
  const h = fixture(); const pending = await held(h); h.scenario.releaseEmployee(); await pending.result;
  h.scenario.beginContinue(proof());
  h.tasks[1].loopPlus.currentReview = { eventId: "actual-event", subtaskId: "text-protocol", attemptId: "actual-attempt", outcome: "stopped" };
  await assert.rejects(h.ask(event().replace("attempt=actual-attempt", "attempt=foreign")), /persisted/);
  const answer = JSON.parse(await h.ask(event()));
  assert.equal(answer.reviews[0].acceptance, "failed");
  assert.deepEqual(answer.reviews[0].subtaskIds, [answer.subtasks[0].id]);
  assert.equal(answer.subtasks[0].continueFromSubtaskId, "text-protocol");
  await assert.rejects(h.ask(event()), /duplicate/);
  await assert.rejects(h.ask(initial), /lacks successor/);
});

test("unknown stages, substituted identities and budgets fail without granting continuation", async () => {
  const h = fixture({ maxRequests: 2 });
  await h.ask(director);
  await assert.rejects(h.ask("unknown"), /unknown production/);
  await assert.rejects(h.ask(initial), /budget/);
  assert.equal(h.scenario.snapshot().continuation.continuing, false);
});

test("unreleased provider latch times out as failure", async () => {
  const h = fixture({ holdTimeoutMs: 30 }); const pending = await held(h);
  await assert.rejects(pending.result, /bounded employee/); h.scenario.releaseEmployee();
});

test("successor completed event requires a real recorded employee and cannot silently accept foreign work", async () => {
  const h = fixture(); const pending = await held(h); h.scenario.releaseEmployee(); await pending.result; h.scenario.beginContinue(proof());
  h.tasks[1].loopPlus.currentReview = { eventId: "actual-event", subtaskId: "text-protocol", attemptId: "actual-attempt", outcome: "stopped" };
  await h.ask(event());
  h.tasks[1].loopPlus.currentReview = { eventId: "actual-event", subtaskId: "foreign", attemptId: "foreign", outcome: "completed" };
  await assert.rejects(h.ask(event("completed").replace("subtask=text-protocol attempt=actual-attempt", "subtask=foreign attempt=foreign")), /no real employee/);
});

test("real successor request permits its persisted completed event and final leader report", async () => {
  const h = fixture(); const pending = await held(h); h.scenario.releaseEmployee(); await pending.result; h.scenario.beginContinue(proof());
  const leader = h.tasks[1];
  leader.loopPlus.currentReview = { eventId: "actual-event", subtaskId: "text-protocol", attemptId: "actual-attempt", outcome: "stopped" };
  await h.ask(event());
  leader.subTasks.push({ id: "text-protocol-continued", communicationFile: "/isolated/successor-report.md", status: "running" });
  leader.loopPlus.running = [{ subtaskId: "text-protocol-continued", attemptId: "successor-attempt" }];
  await h.ask(employee.replace("/isolated/actual-report.md", "/isolated/successor-report.md"));
  leader.loopPlus.currentReview = { eventId: "successor-event", subtaskId: "text-protocol-continued", attemptId: "successor-attempt", outcome: "completed" };
  const response = JSON.parse(await h.ask(event("completed").replaceAll("actual-event", "successor-event")
    .replace("subtask=text-protocol attempt=actual-attempt", "subtask=text-protocol-continued attempt=successor-attempt")));
  assert.equal(response.reviewEventId, "successor-event"); assert.equal(response.reviews[0].acceptance, "passed");
  leader.subTasks[1].status = "completed"; leader.loopPlus.running = []; leader.loopPlus.currentReview = null;
  leader.loopPlus.seenAttempts = [];
  await assert.rejects(h.ask(initial), /original attempt was not retained/);
  leader.loopPlus.seenAttempts = [{ subtaskId: "text-protocol", attemptId: "actual-attempt", outcome: "stopped", acceptance: "failed" }];
  assert.equal(JSON.parse(await h.ask(initial)).status, "completed");
  assert.equal(h.scenario.snapshot().continuation.accepted, true);
});


test("OpenCode Chat continuation uses the same persisted stopped event and explicit successor protocol", async () => {
  const h = fixture({ chat: true, roles: { director: "opencode", leader: "opencode", employee: "opencode" } });
  const pending = await held(h); h.scenario.releaseEmployee(); await pending.result; h.scenario.beginContinue(proof());
  h.tasks[1].loopPlus.currentReview = { eventId: "actual-event", subtaskId: "text-protocol", attemptId: "actual-attempt", outcome: "stopped" };
  await assert.rejects(h.ask(event().replace("attempt=actual-attempt", "attempt=foreign")), /persisted/);
  const answer = JSON.parse(await h.ask(event()));
  assert.equal(answer.subtasks[0].continueFromSubtaskId, "text-protocol");
  assert.deepEqual(answer.reviews[0].subtaskIds, ["text-protocol-continued"]);
  await assert.rejects(h.ask(event()), /duplicate/);
});
