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

import { departmentGenerationAuthorityDirectory, readDepartmentGenerationAuthority } from "../../runtime/departmentgenerationauthority";
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
  await assert.rejects(recovered.openNewLeader(launch.taskId, 1), /existing-or-capacity/);
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
  const h = await productionWiring(t, employee, false, false, 1, undefined, "codex", true), entered = gate(), release = gate();
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

for (const employee of ["codex", "opencode"] as const) wiringTest(`authority production Ledger grants two Codex leader rounds and ${employee} employee then retires after original receipts`, { timeout: 25000 }, async t => {
  const h = await productionWiring(t, employee, true, true, 1, undefined, "codex", true);
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
    prompt: "Implement this isolated employee requirement completely, verify the source and report the actual changes and verification evidence." }] });
  h.answer(2, { status: "wait", finalSummary: "等待员工原始清理凭证" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => h.entries().length === 2 && h.entries().every(entry => entry.executionId !== null));
  assert.equal(h.fixture.adapter.host().submitUserMessage(launch.taskId, "核验第二轮仍保留原生会话与原执行责任"), true);
  await until(() => h.wire().filter(message => message.method === "turn/start").length === 2);
  const snapshot = h.store.read("root", "workspace"); assert.ok(snapshot.ok && snapshot.value);
  const set = snapshot.value.leaderExecutionSets![0];
  const directory = departmentGenerationAuthorityDirectory(h.file("authorities"), set.scope);
  const started = readDepartmentGenerationAuthority(directory); assert.ok(started);
  assert.equal(started.snapshot.tickets.length, 2);
  assert.ok(started.snapshot.tickets.every(ticket => ticket.state === "started"));
  for (const ticket of started.snapshot.tickets) {
    const entry = set.entries.find(entry => entry.responsibility.registrationId === ticket.registrationId); assert.ok(entry);
    const binding: import("../../extensionHost/departmentruntimestate").DepartmentExecutionBinding | undefined = snapshot.value.executionBindings!.find(candidate => candidate.identity.executionId === entry.executionId); assert.ok(binding);
    assert.deepEqual(ticket.identity, binding.identity);
    assert.deepEqual(ticket.selection, binding.selection);
    assert.deepEqual(ticket.requirements, binding.requirements);
    assert.equal(ticket.localSessionId, h.read(launch.taskId)!.sessionId);
    assert.notEqual(ticket.localSessionId, ticket.nativeSessionId);
  }
  // The real organization stop aggregates original clients and persists lease
  // removal; authority retirement is awaited by leaderReleased.
  await h.composition.organizationControl.stop(h.read("root")!);
  await launch.done;
  const finished = h.store.read("root", "workspace"); assert.ok(finished.ok && finished.value);
  assert.equal(finished.value.leaderExecutionSets![0].state, "closed");
  assert.deepEqual(finished.value.capacity.leaders, []);
  assert.deepEqual(finished.value.capacity.employees, []);
  assert.ok(readDepartmentGenerationAuthority(directory)!.snapshot.tickets.every(ticket => ticket.state === "released"));
  const worker = h.workers.find(value => value.module.endsWith("departmentgenerationauthorityworker.js")); assert.ok(worker);
  assert.equal(worker.child.exitCode, 0); assert.equal(worker.child.signalCode, null);
});

wiringTest("failed production Ledger open retires its empty authority before any scheduler pump", { timeout: 20000 }, async t => {
  const h = await productionWiring(t, "codex", false, false, 1, undefined, "codex", true);
  t.mock.method(h.store, "openLeaderExecutionSet", () => ({ ok: false as const, error: "injected-ledger-persistence-failure" }));
  const launch = await h.start(); assert.ok(launch.ok);
  await launch.done;
  assert.equal(h.mainCalls, 0); assert.equal(h.employeeBuilders, 0); assert.equal(h.wire().length, 0);
  const worker = h.workers.find(value => value.module.endsWith("departmentgenerationauthorityworker.js")); assert.ok(worker);
  assert.equal(worker.child.exitCode, 0); assert.equal(worker.child.signalCode, null);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.equal(saved.value.leaderExecutionSets?.length ?? 0, 0);
});

wiringTest("original generation receipt escrow preserves OpenCode employee full required cleanup and normal retirement", { timeout: 25000 }, async t => {
  const h = await productionWiring(t, "opencode", true, true, 1, undefined, "codex", true, true);
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
    prompt: "Implement the isolated employee requirement completely and verify actual source changes and report all changes and results." }] });
  h.answer(2, { status: "wait", finalSummary: "原凭证完整后才关闭" });
  const launch = await h.start(); assert.ok(launch.ok);
  await until(() => h.employeeProcessLifecycles.length === 1);
  await h.fixture.adapter.waitForTaskIdle(launch.taskId);
  await h.composition.organizationControl.stop(h.read("root")!);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  const set = saved.value.leaderExecutionSets![0]; assert.equal(set.state, "closed");
  assert.deepEqual(saved.value.capacity.leaders, []); assert.deepEqual(saved.value.capacity.employees, []);
  assert.ok(readDepartmentGenerationAuthority(departmentGenerationAuthorityDirectory(h.file("authorities"), set.scope))!.snapshot.tickets.every(t => t.state === "released"));
  const worker = h.workers.find(w => w.module.endsWith("departmentgenerationauthorityworker.js"))!;
  assert.equal(worker.child.exitCode, 0); assert.equal(worker.child.signalCode, null);
});

import * as net from "net";
import { departmentExecutionOwnerEndpoint } from "../../runtime/departmentexecutionowner";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
wiringTest("OpenCode parallel original receipt waiter survives endpoint retirement after another waiter verifies cleanup", { timeout: 25000 }, async t => {
  const h = await productionWiring(t, "opencode", true, true, 1, undefined, "codex", true, true);
  const consumed = gate(), release = gate();
  h.beforeEmployeeConsumerFinish(async () => { consumed.resolve(); await release.promise; });
  t.after(() => release.resolve());
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
    prompt: "Implement the complete isolated requirement and verify source changes and report actual results with meaningful evidence." }] });
  for (let n = 2; n <= 8; n++) h.answer(n, { status: "wait", finalSummary: "核对原凭证" });
  const launch = await h.start(); assert.ok(launch.ok); await consumed.promise;
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  const binding = saved.value.executionBindings!.find(b => b.identity.role === "employee")!;
  const original = h.producer.originalClient(binding)!; assert.ok(original);
  const endpoint = departmentExecutionOwnerEndpoint(path.join(h.file("owners"), binding.identity.ownerId));
  const connect = net.createConnection; const delayed = gate(); let intercepted = false;
  t.mock.method(net, "createConnection", ((...args: unknown[]) => {
    if (!intercepted && args[0] === endpoint) {
      intercepted = true; const socket = new net.Socket();
      void delayed.promise.then(() => socket.connect(endpoint)); return socket;
    }
    return Reflect.apply(connect, net, args);
  }) as typeof net.createConnection);
  const waiting = original.waitForCleanup(binding.identity, binding.requirements);
  assert.equal(intercepted, true);
  release.resolve();
  await until(() => !fs.existsSync(endpoint));
  delayed.resolve();
  const receipt = await waiting;
  assert.deepEqual(receipt.identity, binding.identity); assert.deepEqual(receipt.requirements, binding.requirements);
  await assert.rejects(original.waitForCleanup(binding.identity, { ...binding.requirements, tab: false }), /identity-or-policy-conflict/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(original.waitForCleanup(binding.identity, binding.requirements, cancelled.signal), /cancelled/);
  assert.equal((await new DepartmentExecutionOwnerClient(path.join(h.file("owners"), binding.identity.ownerId)).observeExecution(binding.identity)).status, "unknown",
    "a new client cannot replace the original observation with disk completion");
  await h.fixture.adapter.waitForTaskIdle(launch.taskId);
  await h.composition.organizationControl.stop(h.read("root")!);
  const finished = h.store.read("root", "workspace"); assert.ok(finished.ok && finished.value);
  assert.equal(finished.value.leaderExecutionSets![0].state, "closed");
  assert.deepEqual(finished.value.capacity.leaders, []); assert.deepEqual(finished.value.capacity.employees, []);
  const worker = h.workers.find(w => w.module.endsWith("departmentgenerationauthorityworker.js"))!;
  assert.equal(worker.child.exitCode, 0); assert.equal(worker.child.signalCode, null);
});
