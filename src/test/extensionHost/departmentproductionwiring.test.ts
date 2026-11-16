import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

function wiringTest(name: string, options: test.TestOptions, run: (t: test.TestContext) => Promise<void>) {
  const selected = process.env.DEPARTMENT_WIRING_SCENARIO;
  if (selected) { if (selected === name) test(name, options, run); return; }
  test(name, { timeout: 30000 }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-wiring-user-"));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), DEPARTMENT_WIRING_SCENARIO: name };
      delete env.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, ["--test-reporter=tap", "--test", __filename], { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; child.stdout.on("data", (v) => { output += v; }); child.stderr.on("data", (v) => { output += v; });
      const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
      assert.equal(code, 0, output);
      assert.match(output, /# tests 1\b/, output);
      assert.match(output, /# pass 1\b/, output);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

import { productionWiring, until, gate } from "./fixtures/departmentproductionwiringfixture";
import { createDepartmentExecutionProducer } from "../../extensionHost/departmentexecutionproducer";
import { normalizeLoopTaskRecord, mergeLoopTaskRecordPatch } from "../../loopTaskStore";

for (const employee of ["codex", "opencode"] as const) wiringTest(`production composition uses one producer for two native mains and ${employee} employee admission`, { timeout: 20000 }, async (t) => {
  const h = await productionWiring(t, employee);
  // Keep the employee native turn active until the explicit user wake has
  // produced main 2; a completed turn may otherwise open a review batch.
  if (employee === "codex") fs.writeFileSync(h.file("employee/hold-terminal"), "held");
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
    prompt: "Implement the complete isolated employee requirement with source changes and meaningful verification; report changed paths and actual results." }] });
  h.answer(2, { status: "wait", finalSummary: "等待真实员工清理凭证" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => h.employeeBuilders === 1 && h.wire(h.file("employee")).some((m) => m.method === "turn/start") || employee === "opencode" && fs.existsSync(h.file("employee/started")));
  const leader = h.read(launch.taskId)!;
  assert.equal(leader.sessionId, "local_leader");
  assert.deepEqual(leader.executionSession, { cli: "codex", configId: "profile", sessionId: "native" });
  assert.equal(h.fixture.adapter.host().submitUserMessage(launch.taskId, "补充要求：保持原生组长身份和全部未知占用"), true);
  await until(() => h.mainCalls === 2 && h.wire().filter((m) => m.method === "turn/start").length === 2);
  await until(() => h.entries().length === 2 && h.entries().every((e) => !!e.executionId));
  const calls = h.wire().filter((m) => m.method === "thread/start" || m.method === "thread/resume");
  assert.equal(calls.length, 2); assert.equal(calls[0].method, "thread/start"); assert.equal(calls[1].method, "thread/resume");
  assert.equal(calls[1].params.threadId, "native"); assert.equal(h.localRuns, 0);
  const closing = h.producer.close(launch.taskId);
  if (employee === "codex") fs.rmSync(h.file("employee/hold-terminal"));
  const close = await closing; assert.deepEqual(close, { ok: true });
  const stored = h.store.read("root", "workspace"); assert.ok(stored.ok && stored.value);
  assert.equal(stored.value.leaderExecutionSets![0].state, "closed");
  assert.equal(stored.value.capacity.leaders.length, 1); assert.equal(stored.value.capacity.employees.length, 1);
  assert.ok(stored.value.executionBindings!.every((b) => b.requirements.tab && b.requirements.runner));
  const scope = stored.value.leaderExecutionSets![0].scope;
  assert.equal(h.producer.producer.isCurrent(scope), true, "closure identity remains current for Ledger final recheck");
  assert.equal(h.producer.producer.canLaunch!(scope), false);
  await assert.rejects(h.producer.track(launch.taskId, async () => assert.fail("sealed")), /no-live-generation/);
  // Sealing is durable set closure, never a session/tab release receipt.
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
});

wiringTest("production close fences a late leader builder and cannot close while original preparation is pending", { timeout: 20000 }, async (t) => {
  const h = await productionWiring(t), entered = gate(), release = gate();
  h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  const started = await h.start(); assert.ok(started.ok); await entered.promise;
  assert.equal(h.entries().length, 1); assert.equal(h.entries()[0].executionId, null);
  let settled = false;
  const close = h.producer.close(started.taskId).then((r) => { settled = true; return r; });
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false); assert.equal(h.wire().length, 0);
  await assert.rejects(h.producer.track(started.taskId, async () => assert.fail("late preparation")), /no-live-generation/);
  release.resolve(); await until(() => settled);
  assert.equal((await close).ok, false); assert.equal(h.wire().filter((m) => m.method === "turn/start").length, 0);
  assert.equal(h.entries()[0].executionId, null);
});

wiringTest("new producer cannot adopt a cold generation or replay a persisted native main", { timeout: 20000 }, async (t) => {
  const h = await productionWiring(t); h.answer(1, { status: "blocked", finalSummary: "受控暂停" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => !!h.read(launch.taskId)?.executionSession);
  const recovered = createDepartmentExecutionProducer({ store: h.store, readTask: h.read, workspaceKey: () => "workspace", validateRoutes: () => true, processOverlay: "required" });
  assert.throws(() => recovered.openNewLeader(launch.taskId, 1), /existing-or-capacity/);
  assert.throws(() => recovered.scope(launch.taskId), /no-live-generation/);
  await until(() => h.wire().filter((v) => v.method === "turn/start").length === 1);
  assert.equal(h.wire().filter((v) => v.method === "thread/start").length, 1);
});

wiringTest("main native persistence validates exact fields, survives cold read and cannot replace thread", { timeout: 20000 }, async (t) => {
  const h = await productionWiring(t); h.answer(1, { status: "blocked", finalSummary: "受控暂停" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => !!h.read(launch.taskId)?.executionSession);
  const task = h.read(launch.taskId)!, native = task.executionSession!;
  assert.deepEqual(normalizeLoopTaskRecord(JSON.parse(JSON.stringify(task)), task.taskStoreFile)?.executionSession, native);
  assert.throws(() => mergeLoopTaskRecordPatch(task, { executionSession: { ...native, sessionId: "replacement" } }), /不可替换/);
  assert.throws(() => mergeLoopTaskRecordPatch(task, { executionSession: { ...native, sessionId: "local_tab" } }), /无效/);
  assert.equal(normalizeLoopTaskRecord({ ...task, executionSession: { ...native, sessionId: "local_tab" } }, task.taskStoreFile)?.executionSessionInvalid, true);
  assert.equal(h.update(task.id, { executionSession: { ...native, sessionId: "replacement" } }), null);
  for (const invalid of [{ ...native, configId: "other-profile" }, { ...native, cli: "opencode" },
    { ...native, sessionId: " native " }, { ...native, extra: true }]) {
    assert.equal(normalizeLoopTaskRecord({ ...task, executionSession: invalid }, task.taskStoreFile)?.executionSessionInvalid, true);
    assert.throws(() => mergeLoopTaskRecordPatch(task, { executionSession: invalid as typeof native }), /无效/);
  }
  assert.equal(h.read(task.id)?.sessionId, "local_leader");
});

for (const employee of ["codex", "opencode"] as const) wiringTest(`production sealing retains a late ${employee} employee preparation and rejects its grant`, { timeout: 20000 }, async (t) => {
  const h = await productionWiring(t, employee), entered = gate(), release = gate();
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
    prompt: "Implement the complete isolated employee requirement with meaningful source verification and report actual changed paths and results." }] });
  h.beforeEmployeeBuilder(async () => { entered.resolve(); await release.promise; });
  const launch = await h.start(); assert.ok(launch.ok); await entered.promise;
  assert.equal(h.entries().length, 2);
  assert.equal(h.entries().find((e) => e.responsibility.target.role === "employee")!.executionId, null);
  let settled = false;
  const closing = h.producer.close(launch.taskId).then((r) => { settled = true; return r; });
  await new Promise((r) => setImmediate(r)); assert.equal(settled, false);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.equal(h.producer.producer.canLaunch!(saved.value.leaderExecutionSets![0].scope), false);
  release.resolve(); await until(() => settled);
  assert.equal((await closing).ok, false);
  assert.equal(h.wire(h.file("employee")).filter((m) => m.method === "turn/start").length, 0);
  assert.equal(fs.existsSync(h.file("employee/started")), false);
  assert.equal(h.entries().find((e) => e.responsibility.target.role === "employee")!.executionId, null);
  assert.equal(h.composition.readCapacity("root")!.employees.length, 1);
});

wiringTest("production close during exact session persistence fences the first native grant", { timeout: 20000 }, async (t) => {
  const h = await productionWiring(t);
  let closing: ReturnType<typeof h.producer.close> | undefined;
  h.onSessionWritten((id) => { if (!closing) closing = h.producer.close(id); });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => !!closing); assert.equal((await closing!).ok, false);
  assert.equal(h.wire().filter((m) => m.method === "turn/start").length, 0);
  assert.equal(h.read(launch.taskId)?.executionSession?.sessionId, "native");
  assert.equal(h.entries()[0].executionId, null);
});

wiringTest("real scheduler pauses a department main failure once without automatic replay", { timeout: 20000 }, async (t) => {
  const h = await productionWiring(t);
  h.beforeBuilder(async () => { throw new Error("controlled-native-preparation-failure"); });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => h.read(launch.taskId)?.status === "needs-review");
  await new Promise((r) => setImmediate(r));
  assert.equal(h.mainCalls, 1); assert.equal(h.localRuns, 0);
  assert.equal(h.wire().length, 0); assert.equal(h.entries()[0].executionId, null);
  assert.equal(h.read(launch.taskId)?.mainAiFailureCount, 1);
});

wiringTest("actual adapter cancellation during preparation never sends a task or revives on continue", { timeout: 20000 }, async (t) => {
  const h = await productionWiring(t), entered = gate(), release = gate();
  h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  const launch = await h.start(); assert.ok(launch.ok); await entered.promise;
  h.fixture.adapter.host().stopParent(launch.taskId);
  const closing = h.producer.close(launch.taskId);
  release.resolve(); assert.equal((await closing).ok, false);
  assert.equal(h.wire().length, 0); assert.equal(h.entries()[0].executionId, null);
  assert.equal(h.fixture.adapter.host().submitUserMessage(launch.taskId, "late input"), false);
  const saved = h.read(launch.taskId)!;
  const handle = h.fixture.adapter.runMain({ taskId: saved.id, kind: "initial", prompt: "late explicit continuation",
    modelPrompt: "late explicit continuation", reviewEventId: null, target: { tabId: "leader-tab", cli: "codex", sessionId: saved.sessionId ?? null } });
  await assert.rejects(handle.promise, /no-live-generation/);
  assert.equal(h.wire().length, 0); assert.equal(h.localRuns, 0);
});

wiringTest("allocation production lifecycle applies saved zero at next adapter refusal and releases only after original cleanup", { timeout: 25000 }, async (t) => {
  const h = await productionWiring(t, "codex", true, true), entered = gate(), release = gate();
  t.after(() => release.resolve());
  h.beforeEmployeeConsumerFinish(async () => { entered.resolve(); await release.promise; });
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
    prompt: "Implement this complete independent requirement and verify the result. Report all changed files and meaningful test evidence to the leader." }] });
  h.answer(2, { status: "dispatch", subtasks: [{ id: "refused", title: "refused", taskType: "general", writeFiles: [],
    prompt: "Implement another independent requirement with complete source changes and meaningful verification. Report the actual changed paths and results." }] });
  h.answer(3, { status: "blocked", finalSummary: "本组常规额度为零，等待总监调整" });
  const started = await h.start(); assert.ok(started.ok); await entered.promise;
  const root = h.read("root")!, before = h.composition.readDepartmentEmployeeAllocation("root")!;
  assert.equal(before.defaultLimit, 5); assert.equal(before.leaders[0].activeEmployees, 1);
  const result = h.composition.updateDepartmentEmployeeLimit(root, { requestId: "actual-production-save", leaderTaskId: started.taskId,
    employeeLimit: 0, expectedRevision: before.revision });
  assert.ok(result.ok); assert.equal(result.allocation.leaders[0].appliedLimit, 5);
  assert.equal(result.allocation.leaders[0].pending, true);
  const confirmed = h.store.read("root", "workspace"); assert.ok(confirmed.ok && confirmed.value?.employeeAllocation);
  assert.equal(confirmed.value.employeeAllocation.leaders[0].manualLimit, 0);
  assert.equal(h.fixture.adapter.host().submitUserMessage(started.taskId, "下一次派发必须使用总监已保存的额度"), true);
  await until(() => h.composition.readDepartmentEmployeeAllocation("root")?.leaders[0].appliedLimit === 0);
  await until(() => fs.existsSync(h.file("eof-3")));
  assert.equal(h.employeeBuilders, 1, "the second attempt is refused before native preparation");
  assert.equal(h.fixture.createdSubtaskTargets.length, 1, "refused attempt creates no new target");
  assert.equal(h.composition.readCapacity("root")!.employees.length, 1, "saving zero never releases the held consumer");
  const pending = h.store.read("root", "workspace"); assert.ok(pending.ok && pending.value);
  assert.equal(pending.value.executionBindings!.length, 2, "only original coordinator/employee responsibility exists");
  const stopping = h.composition.host.stopRoot("root");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.composition.readCapacity("root")!.employees.length, 1, "stop does not bypass original cleanup");
  release.resolve(); assert.equal(await stopping, true); await started.done;
  const final = h.store.read("root", "workspace"); assert.ok(final.ok && final.value?.employeeAllocation);
  assert.equal(final.value.capacity.employees.length, 0); assert.equal(final.value.capacity.leaders.length, 0);
  assert.equal(final.value.leaderExecutionSets![0].state, "closed");
  assert.equal(final.value.employeeAllocation.leaders[0].appliedLimit, 0);
});
