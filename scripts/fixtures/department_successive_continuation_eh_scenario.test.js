"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDepartmentSuccessiveContinuationEhScenario } = require("./department_successive_continuation_eh_scenario");

const roles = { director: "opencode", leader: "opencode", employee: "opencode" };
function fixture(extra = {}) {
  const root = { id: "root-live", status: "running", sessionId: "tab-root", loopPlusAcceptancePlan: { id: "plan-actual" },
    cli: "opencode", department: { role: "director", rootTaskId: "root-live", routes: Object.fromEntries(Object.entries(roles).map(([role, cli]) => [role, { cli, model: null }])) } };
  const leader = { id: "leader-live", status: "running", sessionId: "tab-leader", schedulingMode: "event_driven", cli: "opencode",
    loopPlusAcceptancePlan: structuredClone(root.loopPlusAcceptancePlan), department: { role: "leader", rootTaskId: "root-live", routes: root.department.routes },
    subTasks: [], loopPlus: { parentStopped: false, running: [], reviewQueue: [], seenAttempts: [], currentReview: null } };
  const tasks = [root, leader];
  const cleanup = extra.cleanup || { complete: true, rootId: "root-live", saved: { executionBindings: [], runtime: { leaders: [{ taskId: "leader-live", status: "paused" }] } } };
  const scenario = createDepartmentSuccessiveContinuationEhScenario({ prompt: "successive isolated requirement", roles,
    readTasks: () => tasks, inspectCleanup: async () => cleanup, maxRequests: 32, holdTimeoutMs: 1000, ...extra });
  let index = 0;
  const ask = (text) => scenario.respondChat({ messages: [{ role: "user", content: text }] },
    { index: ++index, request: {}, purpose: "task", transport: "chat-completions" });
  const setTaskAttempt = (subtaskId, attemptId, reportFile, sourceId) => {
    const subtask = leader.subTasks.find((value) => value.id === subtaskId);
    Object.assign(subtask, { communicationFile: reportFile, status: "running", ...(sourceId ? { continueFromSubtaskId: sourceId } : {}) });
    leader.loopPlus.running = [{ subtaskId, attemptId }];
    leader.loopPlus.seenAttempts = leader.loopPlus.seenAttempts.filter((item) => item.subtaskId !== subtaskId || item.attemptId !== attemptId);
    leader.loopPlus.seenAttempts.push({ subtaskId, attemptId, disposition: "open" });
    return `You are one independent Loop+ execution attempt.\nAttempt report file: ${reportFile}`;
  };
  const leaderPrompt = (event = null) => `You are the Loop+ main reviewer.\nParent task: leader-live\n${event ? `Current review eventId: ${event.eventId}\n- current eventId=${event.eventId} subtask=${event.subtaskId} attempt=${event.attemptId} outcome=${event.outcome} detail=${event.detail}\nAcceptance batch count: 1\nAcceptance batch, oldest first. Confirm this whole list in this decision:\n1. ${event.eventId}\nFIFO review queue count: 0` : "Prompt kind: initial\nCurrent review eventId: (none)\nAcceptance batch count: 0\nAcceptance batch, oldest first. Confirm this whole list in this decision:\n(none)\nFIFO review queue count: 0\nStill running count: 0\nConfirmed acceptances: 0\nSnapshot says completion is allowed: yes"}`;
  async function startEmployee(id, attempt, source) {
    if (!leader.subTasks.find((subtask) => subtask.id === id)) {
      if (!leader.subTasks.length) {
        await ask("使用经典 Loop JSON 决策。\n任务 ID：root-live；轮次：1\nsuccessive isolated requirement\n模块总数：0");
        const response = JSON.parse(await ask(leaderPrompt()));
        leader.subTasks.push(response.subtasks[0]);
      }
      if (!leader.subTasks.find((subtask) => subtask.id === id)) throw new Error(`test setup has no subtask ${id}`);
    }
    const request = setTaskAttempt(id, attempt, `/isolated/${id}-${attempt}.md`, source);
    const pending = ask(request);
    await new Promise((resolve) => setImmediate(resolve));
    return pending;
  }
  return { root, leader, tasks, scenario, cleanup, ask, setTaskAttempt, leaderPrompt, startEmployee };
}

async function persistStoppedEvent(h, round, held, eventId, pendingEmployee) {
  h.scenario.releaseEmployee(round);
  Object.assign(h.leader.subTasks.find((value) => value.id === held.subtaskId), { status: "blocked", summary: "stopped" });
  h.leader.loopPlus.running = [];
  const event = { eventId, subtaskId: held.subtaskId, attemptId: held.attemptId, outcome: "stopped", detail: "public-stop" };
  h.leader.status = "paused"; h.root.status = "stopped";
  h.leader.loopPlus.parentStopped = true; h.leader.loopPlus.currentReview = null; h.leader.loopPlus.reviewQueue = [event];
  const seen = h.leader.loopPlus.seenAttempts.find((item) => item.subtaskId === held.subtaskId && item.attemptId === held.attemptId);
  Object.assign(seen, { disposition: "finished", outcome: "stopped" });
  await pendingEmployee;
  return event;
}

async function continueAndReview(h, round, held, event) {
  if (!h.scenario.snapshot().continuation.rounds[round - 1].continuePrompt) h.scenario.beginContinue(h.cleanup, round, event);
  h.scenario.confirmContinue(round);
  h.leader.status = "running"; h.root.status = "running"; h.leader.loopPlus.parentStopped = false;
  h.leader.loopPlus.currentReview = event; h.leader.loopPlus.reviewQueue = [];
  const answer = JSON.parse(await h.ask(h.leaderPrompt(event)));
  const reviewed = h.leader.loopPlus.seenAttempts.find((item) => item.subtaskId === held.subtaskId && item.attemptId === held.attemptId);
  Object.assign(reviewed, { disposition: "reviewed", acceptance: "failed" });
  h.leader.loopPlus.currentReview = null;
  h.leader.subTasks.push(answer.subtasks[0]);
  assert.equal(answer.reviews[0].acceptance, "failed");
  assert.equal(answer.subtasks[0].continueFromSubtaskId, held.subtaskId);
  return answer.subtasks[0];
}

const rootPrompt = "使用经典 Loop JSON 决策。\n任务 ID：root-live；轮次：1\nsuccessive isolated requirement\n模块总数：0";

test("public protocol gates A to B to C on two exact stopped events and two explicit continuations", async (t) => {
  const h = fixture();
  t.after(() => h.scenario.releaseAll());
  await h.ask(rootPrompt);
  const initialDispatch = JSON.parse(await h.ask(h.leaderPrompt()));
  h.leader.subTasks.push(initialDispatch.subtasks[0]);
  const requestA = h.setTaskAttempt("text-protocol", "attempt-a", "/isolated/a.md");
  const pendingA = h.ask(`You are one independent Loop+ execution attempt.\nAttempt report file: ${requestA.split("Attempt report file: ")[1]}`);
  pendingA.catch(() => undefined);
  const heldA = await h.scenario.waitForHeldEmployee(1);
  assert.equal(heldA.subtaskId, "text-protocol");
  await assert.rejects(h.ask(`You are one independent Loop+ execution attempt.\nAttempt report file: ${heldA.reportFile}`), /duplicate employee request/);
  assert.throws(() => h.scenario.beginContinue(h.cleanup, 1), /stopped execution with no prior continuation/);
  await assert.rejects(h.ask(h.leaderPrompt({ eventId: "wrong", subtaskId: heldA.subtaskId, attemptId: "attempt-a", outcome: "stopped" })), /persisted current attempt/);
  const eventA = await persistStoppedEvent(h, 1, heldA, "event-a-stopped", pendingA);
  assert.throws(() => h.scenario.beginContinue({ ...h.cleanup, complete: false }, 1, eventA), /cleanup and capacity proof/);
  assert.throws(() => h.scenario.beginContinue({ ...h.cleanup, rootId: "foreign-root" }, 1, eventA), /another root/);
  assert.throws(() => h.scenario.beginContinue(h.cleanup, 1, { ...eventA, attemptId: "foreign-attempt" }), /exact durable stopped event/);
  const successorB = await continueAndReview(h, 1, heldA, eventA);
  assert.throws(() => h.scenario.beginContinue(h.cleanup, 1, eventA), /duplicate or out-of-order/);
  await assert.rejects(h.ask(h.leaderPrompt(eventA)), /duplicate successive event/);
  await pendingA;

  const pendingB = h.startEmployee(successorB.id, "attempt-b", heldA.subtaskId);
  pendingB.catch(() => undefined);
  const heldB = await h.scenario.waitForHeldEmployee(2);
  assert.equal(heldB.subtaskId, successorB.id);
  assert.equal(heldB.attemptId, "attempt-b");
  assert.equal(heldB.leaderTaskId, heldA.leaderTaskId);
  const eventB = await persistStoppedEvent(h, 2, heldB, "event-b-stopped", pendingB);
  const successorC = await continueAndReview(h, 2, heldB, eventB);
  assert.equal(successorC.continueFromSubtaskId, heldB.subtaskId);
  await pendingB;

  const reportC = h.setTaskAttempt(successorC.id, "attempt-c", "/isolated/c.md", heldB.subtaskId);
  assert.match(await h.ask(`You are one independent Loop+ execution attempt.\nAttempt report file: ${reportC.split("Attempt report file: ")[1]}`), /ISOLATED PROTOCOL/);
  h.leader.subTasks.find((value) => value.id === successorC.id).status = "completed";
  h.leader.loopPlus.running = [];
  const completed = { eventId: "event-c-completed", subtaskId: successorC.id, attemptId: "attempt-c", outcome: "completed", detail: "Input: isolated protocol\nOutput: ISOLATED PROTOCOL\nDeterministic local protocol fixture; no code changes, external model, or independent review claimed." };
  Object.assign(h.leader.loopPlus.seenAttempts.find((item) => item.subtaskId === successorC.id && item.attemptId === "attempt-c"),
    { disposition: "finished", outcome: "completed" });
  h.leader.loopPlus.currentReview = completed;
  await assert.rejects(h.ask(h.leaderPrompt({ ...completed, detail: completed.detail + "\nforeign detail" })), /persisted current attempt or detail/);
  assert.equal(JSON.parse(await h.ask(h.leaderPrompt(completed))).reviews[0].acceptance, "passed");
  h.leader.loopPlus.currentReview = null;
  assert.equal(JSON.parse(await h.ask(h.leaderPrompt())).status, "completed");
  assert.equal(h.scenario.snapshot().continuation.leaderReport, true);
  assert.deepEqual(h.scenario.snapshot().continuation.rounds.map((round) => round.stoppedReview.acceptance), ["failed", "failed"]);
  assert.equal(h.scenario.snapshot().employees.length, 3);

  const dispatchSecond = JSON.parse(await h.ask(`使用经典 Loop JSON 决策。\n任务 ID：root-live；轮次：2\nsuccessive isolated requirement\n模块总数：1\n"organizationStatus": "completed"`));
  assert.equal(dispatchSecond.subtasks[0].id, "protocol-module-2", "scenario did not follow the real second-module dispatch response");
  const secondLeader = { id: "leader-second", status: "running", sessionId: "tab-leader-second", schedulingMode: "event_driven",
    cli: "opencode", loopPlusAcceptancePlan: structuredClone(h.root.loopPlusAcceptancePlan),
    department: { role: "leader", rootTaskId: "root-live", routes: h.root.department.routes }, subTasks: [],
    loopPlus: { running: [], currentReview: null } };
  h.tasks.push(secondLeader);
  const secondInitial = JSON.parse(await h.ask(`You are the Loop+ main reviewer.\nParent task: leader-second\nPrompt kind: initial\nCurrent review eventId: (none)\nStill running count: 0\nConfirmed acceptances: 0`));
  secondLeader.subTasks.push(secondInitial.subtasks[0]);
  secondLeader.subTasks[0].communicationFile = "/isolated/second-module.md";
  secondLeader.loopPlus.running = [{ subtaskId: secondLeader.subTasks[0].id, attemptId: "attempt-second" }];
  await h.ask("You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/second-module.md");
  const secondEvent = { eventId: "event-second", subtaskId: secondLeader.subTasks[0].id, attemptId: "attempt-second", outcome: "completed", detail: "worker-finished" };
  secondLeader.loopPlus.seenAttempts = [{ subtaskId: secondEvent.subtaskId, attemptId: secondEvent.attemptId, disposition: "finished", outcome: "completed" }];
  secondLeader.loopPlus.currentReview = secondEvent;
  const secondAcceptance = JSON.parse(await h.ask(`You are the Loop+ main reviewer.\nParent task: leader-second\nCurrent review eventId: ${secondEvent.eventId}\nAcceptance batch count: 1\n- current eventId=${secondEvent.eventId} subtask=${secondEvent.subtaskId} attempt=${secondEvent.attemptId} outcome=completed`));
  assert.equal(secondAcceptance.reviews[0].acceptance, "passed");
  secondLeader.subTasks[0].status = "completed"; secondLeader.loopPlus.running = []; secondLeader.loopPlus.currentReview = null;
  assert.equal(JSON.parse(await h.ask(`You are the Loop+ main reviewer.\nParent task: leader-second\nPrompt kind: closeout\nCurrent review eventId: (none)\nStill running count: 0\nConfirmed acceptances: 1\nSnapshot says completion is allowed: yes`)).status, "completed");
  const final = JSON.parse(await h.ask(`使用经典 Loop JSON 决策。\n任务 ID：root-live；轮次：4\nsuccessive isolated requirement\n模块总数：2\n"organizationStatus": "completed"\n"organizationStatus": "completed"`));
  assert.equal(final.status, "completed", "final director report did not follow both completed module organizations");
  h.scenario.releaseAll();
});

test("successive chain rejects a B request whose persisted source is not A", async (t) => {
  const h = fixture(); t.after(() => h.scenario.releaseAll());
  await h.ask(rootPrompt);
  h.leader.subTasks.push(JSON.parse(await h.ask(h.leaderPrompt())).subtasks[0]);
  h.setTaskAttempt("text-protocol", "attempt-a", "/isolated/a.md");
  const pendingA = h.ask("You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/a.md");
  pendingA.catch(() => undefined);
  const heldA = await h.scenario.waitForHeldEmployee(1);
  const eventA = await persistStoppedEvent(h, 1, heldA, "event-a-stopped", pendingA);
  h.cleanup.saved.runtime.leaders[0].status = "paused";
  const successorB = await continueAndReview(h, 1, heldA, eventA);
  await pendingA;
  const originalA = h.leader.subTasks.find((value) => value.id === heldA.subtaskId);
  originalA.status = "running"; originalA.communicationFile = "/isolated/a-replay.md";
  h.leader.loopPlus.running = [{ subtaskId: heldA.subtaskId, attemptId: "attempt-a-replay" }];
  await assert.rejects(h.ask("You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/a-replay.md"), /subtask was retried or dispatched twice/);
  originalA.status = "stopped";
  successorB.continueFromSubtaskId = "unrelated-subtask";
  const report = h.setTaskAttempt(successorB.id, "attempt-b", "/isolated/b.md", "unrelated-subtask");
  await assert.rejects(h.ask(`You are one independent Loop+ execution attempt.\nAttempt report file: ${report.split("Attempt report file: ")[1]}`), /exact immediately preceding stopped source/);
  assert.equal(h.scenario.snapshot().continuation.rounds[1].held, null);
});

test("successive event rejects a foreign leader, changed root or wrong current attempt", async (t) => {
  const h = fixture(); t.after(() => h.scenario.releaseAll());
  await h.ask(rootPrompt);
  h.leader.subTasks.push(JSON.parse(await h.ask(h.leaderPrompt())).subtasks[0]);
  h.setTaskAttempt("text-protocol", "attempt-a", "/isolated/a.md");
  const pendingA = h.ask("You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/a.md");
  pendingA.catch(() => undefined);
  const held = await h.scenario.waitForHeldEmployee(1);
  await assert.rejects(h.ask(h.leaderPrompt().replace("Parent task: leader-live", "Parent task: foreign-leader")), /persisted leader/);
  h.leader.department.rootTaskId = "foreign-root";
  await assert.rejects(h.ask(h.leaderPrompt()), /root identity/);
  h.leader.department.rootTaskId = h.root.id;
  h.scenario.releaseEmployee(1);
  h.leader.subTasks[0].status = "stopped"; h.leader.loopPlus.running = [];
  const current = { eventId: "event-current", subtaskId: held.subtaskId, attemptId: held.attemptId, outcome: "stopped", detail: "public-stop" };
  const heldSeen = h.leader.loopPlus.seenAttempts.find((item) => item.subtaskId === held.subtaskId && item.attemptId === held.attemptId);
  Object.assign(heldSeen, { disposition: "finished", outcome: "stopped" });
  h.leader.loopPlus.currentReview = current;
  await assert.rejects(h.ask(h.leaderPrompt({ ...current, attemptId: "foreign-attempt" })), /persisted current attempt/);
  h.leader.loopPlus.parentStopped = true; h.leader.loopPlus.reviewQueue = [current]; h.leader.loopPlus.currentReview = null;
  h.scenario.beginContinue(h.cleanup, 1, current);
  h.scenario.confirmContinue(1);
  h.leader.loopPlus.parentStopped = false; h.leader.loopPlus.reviewQueue = []; h.leader.loopPlus.currentReview = current;
  assert.equal(JSON.parse(await h.ask(h.leaderPrompt(current))).reviews[0].acceptance, "failed");
  await pendingA;
});

test("successive scenario rejects wrong roles, unknown rounds and exhausted prompt budget", () => {
  assert.throws(() => fixture({ roles: { director: "codex", leader: "opencode", employee: "opencode" } }), /OpenCode director/);
  const h = fixture();
  assert.throws(() => h.scenario.waitForHeldEmployee(3), /unknown held employee round/);
  assert.throws(() => h.scenario.beginContinue(h.cleanup, 3), /unknown public continuation round/);
  const { createDepartmentFullEhScenario } = require("./department_full_eh_scenario");
  assert.throws(() => createDepartmentFullEhScenario({ prompt: "x", readTasks: () => [], inspectCleanup: async () => ({ complete: false }), continuationPrompts: ["a", "b", "c"] }), /invalid continuation prompt budget/);
  h.scenario.releaseAll();
});

test("unreleased response latches fail and releaseAll is idempotent", async () => {
  const h = fixture({ holdTimeoutMs: 30 });
  await h.ask(rootPrompt);
  const initialDispatch = JSON.parse(await h.ask(h.leaderPrompt()));
  h.leader.subTasks.push(initialDispatch.subtasks[0]);
  h.setTaskAttempt("text-protocol", "attempt-a", "/isolated/a.md");
  const pending = h.ask("You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/a.md");
  await h.scenario.waitForHeldEmployee(1);
  await assert.rejects(pending, /was not released by public stop/);
  h.scenario.releaseAll(); h.scenario.releaseAll();
});

 test("stopped task projection accepts only the production blocked/stopped detail", () => {
  const { isStoppedTaskRecord } = require("./department_successive_continuation_eh_scenario");
  assert.equal(isStoppedTaskRecord({ status: "blocked", summary: "stopped" }), true);
  for (const record of [undefined, {status:"running",summary:"stopped"},{status:"blocked"},{status:"blocked",summary:"tool-error"}]) assert.equal(isStoppedTaskRecord(record),false);
});
