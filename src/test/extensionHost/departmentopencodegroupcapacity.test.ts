import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { openCodeGroupCapacityFixture, bounded, eventually } from "./fixtures/departmentopencodegroupcapacityfixture";
import { gate } from "./fixtures/departmentproductionwiringfixture";
import { loopPlusAcceptanceChecksFixture } from "../loopPlusAcceptFixture";
import type { LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import { sameExecution } from "../../runtime/departmentexecutionidentity";
import { DepartmentExecutionReceiptStore } from "../../runtime/departmentexecutionreceiptstore";

type Harness = Awaited<ReturnType<typeof openCodeGroupCapacityFixture>>;
function scenario(name: string, run: (t: test.TestContext) => Promise<void>) {
  if (process.env.R361_SCENARIO) {
    if (process.env.R361_SCENARIO === name) test(name, { timeout: 25000 }, run);
    return;
  }
  test(name, { timeout: 35000 }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "r361-user-"));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), R361_SCENARIO: name };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ["--test", __filename], { env });
    let output = "";
    child.stdout.on("data", v => output += v); child.stderr.on("data", v => output += v);
    try {
      assert.equal(await bounded(new Promise((resolve, reject) => { child.once("close", resolve); child.once("error", reject); }),
        "isolated scenario failed to exit normally", () => output, 30000), 0, output);
    } finally {
      if (child.exitCode === null) child.kill();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}
function dispatch() { return { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
  prompt: "Implement the isolated employee requirement completely; verify actual execution and provide the complete evidence report for root acceptance." }] }; }
function completed() { return { status: "completed", progressPercent: 100, answerConclusion: "受控员工要求已完成", finalSummary: "原生执行、员工汇报与统一验收完成",
  acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "module", passed: true }] }; }
function saved(h: Harness) { const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value, h.diagnostic()); return read.value; }
function occupancy(h: Harness, leaders: number, employees: number) {
  const durable = saved(h).capacity, memory = h.composition.capacity.snapshot("root")[0];
  assert.equal(durable.leaders.length, leaders, h.diagnostic()); assert.equal(durable.employees.length, employees, h.diagnostic());
  assert.equal(memory.leaders.length, leaders); assert.equal(memory.employees.length, employees);
}
async function assertOriginalGroup(h: Harness, taskId: string) {
  const snapshot = saved(h), set = snapshot.leaderExecutionSets!.find(s => s.scope.leaderTaskId === taskId)!;
  assert.ok(set); assert.equal(set.state, "closed"); assert.ok(set.closure); assert.equal(set.entries.length, 2);
  const bindings = snapshot.executionBindings!.filter(b => b.identity.leaderTaskId === taskId);
  assert.equal(bindings.length, 2);
  for (const binding of bindings) {
    assert.ok(set.entries.some(e => e.executionId === binding.identity.executionId));
    const receipt = h.receipts.get(binding.identity.executionId); assert.ok(receipt, "must come from the original client's strict waitForCleanup");
    assert.ok(sameExecution(receipt.identity, binding.identity));
    assert.deepEqual(receipt.requirements, binding.requirements);
    for (const part of Object.keys(binding.requirements) as Array<keyof typeof binding.requirements>)
      if (binding.requirements[part]) assert.equal(receipt.cleanup[part].status, "confirmed", part);
    const original = h.originals.get(binding.identity.executionId)!;
    // Raw observe after a Codex socket exits may be unknown; its original
    // strictly validated waitForCleanup capability retains the receipt.
    assert.deepEqual(await bounded(original.waitForCleanup(binding.identity, binding.requirements),
      "original receipt retained after normal retirement", h.diagnostic), receipt);
    if (binding.identity.cli === "opencode") assert.equal((await original.observeExecution(binding.identity)).status, "cleaned");
    assert.equal(h.producer.originalClient(binding), null, "successful retirement clears only resolved original references");
  }
  assert.equal(h.read(taskId)!.status, "completed");
  assert.equal((h.read(taskId)!.loopPlus as LoopPlusSchedulerSnapshot).seenAttempts[0].disposition, "reviewed", "the real scheduler accepted the actual finish event");
}

scenario("OpenCode leader tree drains original Owners before durable capacity return and legal redispatch", async t => {
  const h = await openCodeGroupCapacityFixture(t), employeeEntered = gate(), employeeRelease = gate(), finalEntered = gate(), finalRelease = gate();
  h.hold("hold-main-1"); h.hold("employee/hold-pipe");
  h.beforeEmployeeConsumerFinish(async () => { employeeEntered.resolve(); await employeeRelease.promise; });
  h.beforeMainConsumerFinish(async round => { if (round === 2) { finalEntered.resolve(); await finalRelease.promise; } });
  h.answer(1, dispatch()); h.answer(2, completed());
  const started = await h.start(); assert.ok(started.ok);
  await eventually(() => h.events().some(e => e.kind === "task-run" && e.round === 1), "first physical invocation", h.diagnostic);
  occupancy(h, 1, 0); assert.equal(h.lifecycles.length, 0, "stdout alone cannot prove physical close/drain");
  const first = saved(h).executionBindings!.find(b => b.identity.role === "leader")!;
  assert.ok(first); assert.equal(first.identity.cli, "opencode"); assert.equal(first.identity.session.state, "bound");
  assert.equal(h.read(started.taskId)!.executionSession!.sessionId, first.identity.session.state === "bound" ? first.identity.session.id : "invalid");
  const events = h.events(), index = (kind: string) => events.findIndex(e => e.kind === kind);
  assert.ok(index("responsibility-persisted") < index("session-created"));
  assert.ok(index("session-created") < index("task-session-readback"));
  assert.ok(index("task-session-readback") < index("binding-persisted"));
  assert.ok(index("binding-persisted") < index("binding-cold-read"));
  assert.ok(index("binding-cold-read") < index("task-run"), "task/session and Store binding readback precede real task launch");
  assert.equal((await h.originals.get(first.identity.executionId)!.observeExecution(first.identity)).status === "cleaned", false);
  h.release("hold-main-1");
  await eventually(() => fs.existsSync(h.file("employee/eof-1")), "employee original stdio remains open", h.diagnostic);
  occupancy(h, 1, 1); assert.equal(h.employeeBuilders, 1);
  h.release("employee/hold-pipe");
  await bounded(employeeEntered.promise, "employee physical drain before consumer finish", h.diagnostic);
  occupancy(h, 1, 1); assert.equal(h.closedTabs.length, 0, "neither original consumer has authorized tab removal");
  employeeRelease.resolve();
  await bounded(finalEntered.promise, "second native invocation parsed and drained", h.diagnostic);
  assert.equal(h.lifecycles.length, 2); assert.equal(h.mainCalls, 2);
  await eventually(() => saved(h).capacity.employees.length === 0, "employee original receipt consumption", h.diagnostic);
  occupancy(h, 1, 0); assert.ok(h.tabs.has("leader-tab-1"));
  assert.equal(h.tabs.get("leader-tab-1")!.sessionId, h.read(started.taskId)!.sessionId);
  assert.equal(h.receipts.has(first.identity.executionId), false, "leader tab consumer still holds generation cleanup");
  finalRelease.resolve();
  await bounded(started.done, "normal scheduler/organization lifecycle completion", h.diagnostic);
  await eventually(() => saved(h).capacity.leaders.length === 0, "durable group capacity return", h.diagnostic);
  await assertOriginalGroup(h, started.taskId); occupancy(h, 0, 0);
  assert.equal(h.tabs.size, 0); assert.equal(h.configurationLeases().length, 0);
  const runs = h.events().filter(e => e.kind === "task-run");
  assert.equal(runs.length, 2); assert.equal(runs[0].session, runs[1].session); assert.equal(runs[0].ownerPid, runs[1].ownerPid);
  assert.equal(h.events().filter(e => e.kind === "session-created").length, 1);
  assert.equal(h.events().find(e => e.kind === "session-created")!.body, "{}", "native creation never receives the task prompt");
  assert.equal(h.transcripts[0].localSessionId, h.transcripts[1].localSessionId);
  assert.equal(h.transcripts[0].tabId, h.transcripts[1].tabId);
  const trace = h.events();
  const removed = trace.findIndex(e => e.kind === "capacity-persisted" && (e.leaders as string[]).length === 0
    && (e.memoryLeadersBefore as string[]).length === 1);
  assert.ok(removed >= 0); assert.equal((trace[removed].receipts as string[]).length, 2); assert.equal(trace[removed].closedSets, 1);
  assert.ok(trace.slice(0, removed).some(e => e.kind === "binding-cold-read" && e.state === "closed"));
  assert.ok(trace.slice(removed + 1).some(e => e.kind === "capacity-memory" && (e.leaders as string[]).length === 0
    && (e.durableLeaders as string[]).length === 0), "persistent removal precedes the actual leader pool release notification");

  // Legal organization start, never clear occupancy or reopen an old Owner.
  h.answer(3, dispatch()); h.answer(4, completed());
  const next = await h.start("module-1"); assert.ok(next.ok);
  await bounded(next.done, "redispatched group normal lifecycle", h.diagnostic);
  await eventually(() => saved(h).capacity.leaders.length === 0, "redispatched capacity consumption", h.diagnostic);
  await assertOriginalGroup(h, next.taskId); occupancy(h, 0, 0);
  assert.equal(h.tabs.size, 0); assert.equal(h.configurationLeases().length, 0);
  assert.equal(saved(h).leaderExecutionSets!.length, 2); assert.equal(h.events().filter(e => e.kind === "session-created").length, 2);
  assert.notEqual(h.read(next.taskId)!.executionSession!.sessionId, h.read(started.taskId)!.executionSession!.sessionId);
  assert.equal(h.localRuns, 0); assert.equal(h.fixture.completionMessages.length, 2);
});

scenario("OpenCode leader tree retains both capacities when an original employee tab close fails", async t => {
  const h = await openCodeGroupCapacityFixture(t);
  h.failTabClose(true); h.answer(1, dispatch()); h.answer(2, completed());
  const started = await h.start(); assert.ok(started.ok);
  await bounded(started.done, "failed-cleanup scheduler lifecycle must settle", h.diagnostic);
  await eventually(() => h.tabCloseAttempts.some(id => id.startsWith("subtab")), "original employee tab close attempted", h.diagnostic);
  const snapshot = saved(h), employee = snapshot.executionBindings!.find(b => b.identity.role === "employee")!;
  assert.ok(employee); occupancy(h, 1, 1);
  const record = new DepartmentExecutionReceiptStore(h.file("owners/" + employee.identity.ownerId)).read(employee.identity.executionId, employee.identity);
  assert.ok(record.kind === "ok"); assert.equal(record.value.state, "cleanup-failed");
  assert.equal(h.receipts.has(employee.identity.executionId), false);
  assert.ok(h.producer.originalClient(employee), "unknown responsibility retains its original capability");
  assert.equal(snapshot.executionBindings!.length, 2); assert.equal(h.events().filter(e => e.kind === "session-created").length, 1);
  assert.equal(h.employeeBuilders, 1); assert.equal(h.tabs.size, 2);
  const runsBefore = h.events().filter(e => e.kind === "task-run").length;
  assert.ok(runsBefore >= 1);
  const again = await h.start(); assert.equal(again.ok, false, "same module cannot replace the unresolved Owner");
  assert.equal(saved(h).executionBindings!.length, 2); occupancy(h, 1, 1);
  assert.equal(h.events().filter(e => e.kind === "task-run").length, runsBefore, "refusal cannot replay a task invocation");
  assert.equal(h.events().filter(e => e.kind === "session-created").length, 1);
});
