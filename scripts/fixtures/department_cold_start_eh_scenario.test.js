"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDepartmentColdStartEhScenario } = require("./department_cold_start_eh_scenario");

function prompts(readTasks) {
  const root = { id: "root-cold", cli: "codex", workspaceKey: "workspace", department: { role: "director", rootTaskId: "root-cold", routes: { director: { cli: "codex" } } } };
  const leader = { id: "leader-cold", cli: "codex", workspaceKey: "workspace", department: { role: "leader", rootTaskId: "root-cold", routes: { leader: { cli: "codex" } } }, schedulingMode: "event_driven", subTasks: [], loopPlus: {} };
  readTasks.push(root, leader);
  return { root: "使用经典 Loop JSON 决策。\n任务 ID：root-cold；轮次：1\n冷启动验收\n根任务：root-cold；真实状态：running。模块总数：0。",
    leader: "You are the Loop+ main reviewer.\nParent task: leader-cold\nPrompt kind: initial\nCurrent review eventId: (none)\nStill running count: 0\nConfirmed acceptances: 0\nSnapshot says completion is allowed: yes",
    employee: "You are one independent Loop+ execution attempt.\nAttempt report file: /isolated/attempt-cold.md" };
}

test("cold EH scenario gate is reached only after persisted employee identity and blocks the provider response", async () => {
  const tasks = [], p = prompts(tasks);
  const scenario = createDepartmentColdStartEhScenario({ prompt: "冷启动验收", readTasks: () => tasks, inspectCleanup: async () => ({ complete: false }) });
  const request = text => ({ input: [{ role: "user", content: text }] });
  await scenario.respond(request(p.root), { index: 1, request: {} });
  await scenario.respond(request(p.leader), { index: 2, request: {} });
  tasks[1].subTasks.push({ id: "subtask-cold", communicationFile: "/isolated/attempt-cold.md" });
  tasks[1].loopPlus.running = [{ subtaskId: "subtask-cold", attemptId: "attempt-cold" }];
  const pending = scenario.respond(request(p.employee), { index: 3, request: {} });
  const identity = await scenario.waitForActiveEmployee();
  assert.deepEqual(identity, { leaderTaskId: "leader-cold", subtaskId: "subtask-cold", attemptId: "attempt-cold", reportFile: "/isolated/attempt-cold.md" });
  let settled = false;
  void pending.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "provider response must remain held until the EH restart trigger");
  scenario.releasePendingProviderResponse();
  await pending;
});
