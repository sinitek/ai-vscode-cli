"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createDepartmentColdRecoveryEhScenario } = require("./department_cold_recovery_eh_scenario");
const { args, isolatedEnvironment } = require("../verify_department_full_eh_integration");
test("cold recovery has separate role scope; existing cold safety rejection stays Codex only", () => {
  const flags = ["--product", "/product", "--report", "/new.json", "--scenario", "cold-recovery"];
  assert.equal(args(flags).leaderCli, "codex");
  assert.equal(args([...flags, "--leader-cli", "opencode", "--leader-model", "default"]).leaderCli, "opencode");
  assert.throws(() => args([...flags, "--employee-cli", "opencode"]), /Cold recovery supports/);
  assert.throws(() => args(flags.map(v => v === "cold-recovery" ? "cold-start" : v).concat(["--leader-cli", "opencode"])), /only Codex/);
  const a = isolatedEnvironment("/owned-a", { PATH: "/bin", OPENAI_API_KEY: "user-secret" });
  const b = isolatedEnvironment("/owned-b", { PATH: "/bin" });
  for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "APPDATA"])
    assert.notEqual(a[key], b[key]);
  assert.notEqual(a.OPENAI_API_KEY, "user-secret");
});
test("cold provider refuses continue without original cleanup and never writes persistence", () => {
  const scenario = createDepartmentColdRecoveryEhScenario({ prompt: "owned", readTasks: () => [], inspectCleanup: async () => null,
    roles: { director: "codex", leader: "codex", employee: "codex" } });
  assert.throws(() => scenario.beginContinue({ complete: false }), /original complete cleanup/);
  assert.equal(scenario.snapshot().coldRecovery.continuing, false);
  assert.equal(scenario.history.length, 0); scenario.releaseAll();
});

test("cold controls call the shared adapter click and preserve deadline and adapter refusal", async () => {
  const { clickColdPublicControl } = require("./department_cold_recovery_eh_scenario");
  const events = []; let clock = 10;
  const adapter = { locator(selector) { assert.equal(selector, '#public-control'); return {
    async waitFor(options) { events.push(options); clock = 15; }, async click() { events.push('real-adapter-click'); },
  }; } };
  await clickColdPublicControl(adapter, '#public-control', 20, () => clock);
  assert.deepEqual(events, [{ state: 'visible', timeout: 10 }, 'real-adapter-click']);
  await assert.rejects(clickColdPublicControl(adapter, '#public-control', 15, () => clock), /absolute deadline/);
  const error = Error('duplicate-or-foreign-public-root');
  await assert.rejects(clickColdPublicControl({ locator: () => ({ waitFor: async () => {}, click: async () => { throw error; } }) }, 'x', 30, () => clock), e => e === error);
});
test("cold successor reports concrete production rejection before deadline without treating it as cleanup", () => {
  const { assertColdSuccessorNotRejected } = require("./department_cold_recovery_eh_scenario");
  const tasks = [{ id: 'leader', mainAiLastFailureMessage: 'department-tab-not-owned-or-consumer-capacity' }];
  assert.throws(() => assertColdSuccessorNotRejected(tasks, { runtime: { leaders: [{ taskId: 'leader', generation: 3, status: 'blocked' }] } }, 1), /production rejection: department-tab-not-owned/);
  assert.doesNotThrow(() => assertColdSuccessorNotRejected(tasks, { runtime: { leaders: [{ taskId: 'leader', generation: 1, status: 'blocked' }] } }, 1));
});
