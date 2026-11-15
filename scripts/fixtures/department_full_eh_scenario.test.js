"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDepartmentFullEhScenario, latestUserText } = require("./department_full_eh_scenario");
const request = (text) => ({ input: [{ role: "user", content: [{ type: "input_text", text }] }] });
const director = (id, total, state = "running") => `使用经典 Loop JSON 决策。\n任务 ID：${id}；轮次：1\nunique test prompt\n根任务：${id}；真实状态：running。模块总数：${total}。\n${total ? `"organizationStatus": "${state}"` : ""}`;
function fixture(cleanup = { complete: false }) {
  const tasks = [{ id: "root-actual", department: { role: "director", rootTaskId: "root-actual" } },
    { id: "leader-actual", department: { role: "leader", rootTaskId: "root-actual" }, schedulingMode: "event_driven", subTasks: [], loopPlus: { currentReview: { eventId: "event-actual", subtaskId: "subtask-actual", attemptId: "attempt-actual", outcome: "completed" } } }];
  const scenario = createDepartmentFullEhScenario({ prompt: "unique test prompt", readTasks: () => tasks, inspectCleanup: async () => cleanup, maxRequests: 10 });
  let index = 0;
  return { scenario, tasks, ask: (text) => scenario.respond(request(text), { index: ++index, request: {} }) };
}
const initialLeader = `You are the Loop+ main reviewer.
Parent task: leader-actual
Prompt kind: initial
Current review eventId: (none)
Still running count: 0
Confirmed acceptances: 0
Snapshot says completion is allowed: yes`;

test("only latest native user input selects a stage", () => {
  assert.equal(latestUserText({ input: [...request("old director").input, { role: "assistant", content: "old decision" }, ...request("current leader").input] }), "current leader");
  assert.throws(() => latestUserText({ input: [] }), /no user/);
});

test("scenario binds persisted runtime root and rejects unknown stages or identity replacement", async () => {
  const h = fixture();
  assert.equal(JSON.parse(await h.ask(director("root-actual", 0))).status, "continue");
  await assert.rejects(h.ask(director("replacement", 0)), /identity changed/);
  await assert.rejects(h.ask("unknown prompt"), /unknown production prompt stage/);
  assert.equal(h.scenario.history.length, 1);
});

test("task completion alone cannot authorize capacity reuse", async () => {
  const h = fixture(); await h.ask(director("root-actual", 0));
  await assert.rejects(h.ask(director("root-actual", 1, "completed")), /original Owner receipts/);
  assert.equal(h.scenario.snapshot().moduleCount, 1);
});

test("second dispatch records successful original cleanup before creating next module decision", async () => {
  const h = fixture({ complete: true, observations: ["test-only receipt"] });
  await h.ask(director("root-actual", 0));
  const answer = JSON.parse(await h.ask(director("root-actual", 1, "completed")));
  assert.equal(answer.status, "continue"); assert.equal(answer.subtasks[0].id, "protocol-module-2");
  assert.equal(h.scenario.snapshot().capacityReuse.complete, true);
});

test("leader acceptance copies the actual event and rejects an unregistered attempt", async () => {
  const h = fixture(); await h.ask(director("root-actual", 0));
  await h.ask(initialLeader);
  h.tasks[1].subTasks.push({ id: "subtask-actual", communicationFile: "/isolated/report.md" });
  h.tasks[1].loopPlus.running = [{ subtaskId: "subtask-actual", attemptId: "attempt-actual" }];
  await h.ask("You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/report.md");
  const text = `You are the Loop+ main reviewer.\nParent task: leader-actual\nCurrent review eventId: event-actual\nAcceptance batch count: 1\n- current eventId=event-actual subtask=subtask-actual attempt=attempt-actual outcome=completed`;
  const answer = JSON.parse(await h.ask(text));
  assert.equal(answer.reviewEventId, "event-actual"); assert.equal(answer.reviews[0].reviewEventId, "event-actual");
  await assert.rejects(h.ask(text.replace("attempt=attempt-actual", "attempt=unknown")), /not persisted/);
});

test("initial empty scheduler dispatches despite completion allowance and cannot claim a later closeout", async () => {
  const h = fixture(); await h.ask(director("root-actual", 0));
  const decision = JSON.parse(await h.ask(initialLeader));
  assert.equal(decision.status, "dispatch");
  assert.equal(h.scenario.history.at(-1).stage, "leader-dispatch");
  await assert.rejects(h.ask(initialLeader.replace("Prompt kind: initial", "Prompt kind: closeout")), /lacks a real employee event acceptance/);
});

test("first non-initial leader request cannot acquire fixture dispatch authority", async () => {
  const h = fixture(); await h.ask(director("root-actual", 0));
  await assert.rejects(h.ask(initialLeader.replace("Prompt kind: initial", "Prompt kind: closeout")), /not initial/);
  assert.equal(h.scenario.history.length, 1);
});

test("employee attempt IDs are scoped to the real leader and subtask; duplicates within that identity fail", async () => {
  const h = fixture(); await h.ask(director("root-actual", 0));
  const second = structuredClone(h.tasks[1]); second.id = "second-leader"; h.tasks.push(second);
  for (const leader of [h.tasks[1], second]) {
    await h.ask(initialLeader.replace("leader-actual", leader.id));
    const report = `/isolated/${leader.id}/report.md`;
    leader.subTasks.push({ id: "subtask-actual", communicationFile: report });
    leader.loopPlus.running = [{ subtaskId: "subtask-actual", attemptId: "attempt-actual" }];
    const text = `You are one independent Loop+ execution attempt.\nAttempt report file: ${report}`;
    await h.ask(text);
    await assert.rejects(h.ask(text), /duplicate employee request/);
  }
  assert.equal(h.scenario.snapshot().employees.length, 2);
  assert.deepEqual(h.scenario.snapshot().employees.map((entry) => entry.leaderTaskId), ["leader-actual", "second-leader"]);
});


test("production summary side request is bounded to this public requirement", async () => {
  const h = fixture();
  const prefix = '你是任务摘要器。只输出摘要\n';
  assert.equal(await h.ask(prefix + JSON.stringify({ requirement: "unique test prompt" })), "隔离本机文本协议验收");
  await assert.rejects(h.ask(prefix + JSON.stringify({ requirement: "foreign prompt" })), /unrelated/);
});

test("Chat Completions adapter shares real leader parser/identity and rejects foreign stages and titles", async () => {
  const h = fixture(); await h.ask(director("root-actual", 0));
  const context = () => ({ index: 1, purpose: "task", request: {} });
  const body = text => ({ messages: [{ role: "user", content: [{ type: "text", text }] }] });
  assert.equal(JSON.parse(await h.scenario.respondChat(body(initialLeader), context())).status, "dispatch");
  assert.equal(h.scenario.history.at(-1).transport, "chat-completions");
  await assert.rejects(h.scenario.respondChat(body("unknown prompt"), context()), /unknown OpenCode/);
  await assert.rejects(h.scenario.respondChat(body(director("replacement", 0)), context()), /identity changed/);
  const title = body(initialLeader); title.messages.unshift({ role: "system", content: "You are a title generator." });
  assert.equal(await h.scenario.respondChat(title, { ...context(), purpose: "title" }), "隔离组织文本协议验收");
  await assert.rejects(h.scenario.respondChat({ messages: [{ role: "system", content: "You are a title generator." }, { role: "user", content: "foreign leader" }] }, { ...context(), purpose: "title" }), /no unique current runtime/);
});

test("Chat transport drives persisted director, leader and employee through actual event acceptance", async () => {
  const h = fixture();
  const ask = text => h.scenario.respondChat({ messages: [{ role: "user", content: text }] }, { index: 1, purpose: "task", request: {} });
  assert.equal(JSON.parse(await ask(director("root-actual", 0))).status, "continue");
  await ask(initialLeader);
  h.tasks[1].subTasks.push({ id: "subtask-actual", communicationFile: "/isolated/employee.md" });
  h.tasks[1].loopPlus.running = [{ subtaskId: "subtask-actual", attemptId: "attempt-actual" }];
  const employee = "You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/employee.md\n";
  assert.match(await ask(employee), /ISOLATED PROTOCOL/);
  await assert.rejects(ask(employee), /duplicate employee/);
  const review = "You are the Loop+ main reviewer.\nParent task: leader-actual\nCurrent review eventId: event-actual\nAcceptance batch count: 1\n- current eventId=event-actual subtask=subtask-actual attempt=attempt-actual outcome=completed";
  assert.equal(JSON.parse(await ask(review)).reviewEventId, "event-actual");
  await assert.rejects(ask(review.replace("attempt-actual", "foreign-attempt")), /not persisted/);
  assert.ok(h.scenario.history.every(e => e.transport === "chat-completions"));
});

test("OpenCode title identities support pre-decision director and current attempt with finite budgets", async () => {
  const h = fixture();
  const title = text => h.scenario.respondChat({ messages: [{ role: "system", content: "You are a title generator." }, { role: "user", content: text }] }, { index: 1, purpose: "title", request: {} });
  await title(director("root-actual", 0));
  await h.ask(director("root-actual", 0));
  h.tasks[1].subTasks.push({ id: "subtask-actual", communicationFile: "/isolated/current.md" });
  await title("You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/current.md\n");
  await assert.rejects(title("Attempt report file: /foreign.md\n"), /no unique/);
  for (let n = 0; n < 4; n++) await title(initialLeader);
  await assert.rejects(title(initialLeader), /title request budget/);
  const bounded = fixture();
  for (let n = 0; n < 32; n++) await assert.rejects(bounded.scenario.respondChat({ messages: [{ role: "user", content: "unknown" }] }, { purpose: "task", request: {} }));
  await assert.rejects(bounded.scenario.respondChat({ messages: [{ role: "user", content: "unknown" }] }, { purpose: "task", request: {} }), /request budget/);
});

test("installed one-shot Chat quoting and summary titles decode narrowly without relaxing stages", async () => {
  const h = fixture();
  const quote = text => '"' + text.replace(/"/g, '\\"') + '"';
  const ask = (text, title = false) => h.scenario.respondChat({ messages: [...(title ? [{ role: "system", content: "You are a title generator." }] : []), { role: "user", content: text }] }, { purpose: title ? "title" : "task", request: {} });
  const summary = '你是任务摘要器。仅摘要\n' + JSON.stringify({ requirement: "unique test prompt" });
  await ask("Generate a title for this conversation:\n\nuser " + quote(summary), true);
  assert.equal(await ask(quote(summary)), "隔离本机文本协议验收");
  assert.equal(JSON.parse(await ask(quote(director("root-actual", 0)))).status, "continue");
  await assert.rejects(ask(quote("unrecognized")), /unknown OpenCode/);
  await assert.rejects(ask("Generate a title for this conversation:\n\nuser " + quote(summary.replace("unique test prompt", "foreign")), true), /unrelated/);
});

test('configured role transport cannot be substituted, including OpenCode director summary', async () => {
  const h = fixture();
  for (const task of h.tasks) { task.cli = 'opencode'; task.department.routes = { director: { cli: 'opencode' }, leader: { cli: 'opencode' }, employee: { cli: 'opencode' } }; }
  const scenario = createDepartmentFullEhScenario({ prompt: 'unique test prompt', readTasks: () => h.tasks, inspectCleanup: async () => ({ complete: false }), roles: { director: 'opencode', leader: 'opencode', employee: 'opencode' } });
  await assert.rejects(scenario.respond(request(director('root-actual', 0)), { index: 1, request: {} }), /wrong CLI transport/);
  assert.equal(scenario.history.length, 0);
  await scenario.respondChat({ messages: request(director('root-actual', 0)).input }, { purpose: 'task', request: {} });
  assert.equal(scenario.history[0].stage, 'director-dispatch');
  assert.throws(() => createDepartmentFullEhScenario({ maxRequests: Infinity }));
  assert.throws(() => createDepartmentFullEhScenario({ roles: { director: 'unknown' } }));
});

test('all OpenCode two-module titles have seven finite slots; the eighth and foreign identity still fail', async () => {
  const h = fixture();
  const roles = { director: 'opencode', leader: 'opencode', employee: 'opencode' };
  const second = structuredClone(h.tasks[1]); second.id = 'second-leader'; h.tasks.push(second);
  for (const record of h.tasks) { record.cli = 'opencode'; record.department.routes = Object.fromEntries(Object.entries(roles).map(([role, cli]) => [role, { cli }])); }
  const scenario = createDepartmentFullEhScenario({ prompt: 'unique test prompt', readTasks: () => h.tasks, inspectCleanup: async () => ({ complete: false }), roles });
  const ask = (text, title = true) => scenario.respondChat({ messages: [...(title ? [{ role: 'system', content: 'You are a title generator.' }] : []), { role: 'user', content: text }] }, { purpose: title ? 'title' : 'task', request: {} });
  const summary = '你是任务摘要器。仅摘要\n' + JSON.stringify({ requirement: 'unique test prompt' });
  await ask(summary); await ask(director('root-actual', 0));
  await ask(director('root-actual', 0), false); // Establish the actual root identity.
  await ask(summary);
  for (const leader of [h.tasks[1], second]) {
    await ask(initialLeader.replace('leader-actual', leader.id));
    const report = `/isolated/${leader.id}.md`;
    leader.subTasks.push({ id: 'current', communicationFile: report });
    await ask(`You are one independent Loop+ execution attempt.\nAttempt report file: ${report}\n`);
  }
  assert.equal(scenario.history.filter(entry => entry.stage === 'opencode-title').length, 7);
  await assert.rejects(ask(initialLeader), /title request budget/);
  await assert.rejects(ask(initialLeader.replace('leader-actual', 'foreign')), /no unique/);
});
