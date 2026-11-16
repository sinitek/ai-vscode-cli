import { loopPlusAcceptanceChecksFixture } from "../loopPlusAcceptFixture";
import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { productionWiring, gate, until } from "./fixtures/departmentproductionwiringfixture";
import { DepartmentLeaderExecutionCleanup } from "../../extensionHost/departmentleaderexecutioncleanup";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import { DepartmentExecutionReceiptStore } from "../../runtime/departmentexecutionreceiptstore";
import { cleanupComplete, sameExecution } from "../../runtime/departmentexecutionidentity";

function scenario(name: string, run: (t: test.TestContext) => Promise<void>) {
  if (process.env.R231_SCENARIO) { if (process.env.R231_SCENARIO === name) test(name, { timeout: 25000 }, run); return; }
  test(name, { timeout: 35000 }, async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "r231-user-"));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), R231_SCENARIO: name };
      delete env.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, ["--test", __filename], { env, detached: process.platform !== "win32" }); let out = "";
      child.stdout.on("data", (v) => out += v); child.stderr.on("data", (v) => out += v);
      let expired = false;
      const terminate = () => {
        // Failure-only reclamation of this test's own subprocess group. Never
        // treat this as an original receipt, natural exit or capacity return.
        if (process.platform !== "win32" && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
        else child.kill("SIGKILL");
      };
      const deadline = setTimeout(() => { expired = true; terminate(); }, 30000);
      try {
        const code = await new Promise((r, j) => { child.once("error", j); child.once("close", r); });
        t.diagnostic(out);
        assert.equal(expired, false, "isolated scenario exceeded its cleanup budget: " + out);
        assert.equal(code, 0, out);
      } finally { clearTimeout(deadline); if (child.exitCode === null && child.signalCode === null) terminate(); }
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

scenario("production normal closure observes original leader after its server exits and returns capacity", async (t) => {
  const h = await productionWiring(t, "codex", true, true);
  h.answer(1, completed());
  const started = await h.start(); assert.ok(started.ok); await started.done;
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 0);
  assert.equal(h.producer.canContinueLeader(started.taskId), false, "completed tasks do not retain one-shot continuation provenance");
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.equal(saved.value.leaderExecutionSets![0].state, "closed");
  assert.equal(saved.value.capacity.leaders.length, 0);
  const binding = saved.value.executionBindings![0];
  await until(async () => (await new DepartmentExecutionOwnerClient(h.file("owners/" + binding.identity.ownerId)).observeExecution(binding.identity)).status === "unknown");
  assert.equal(h.producer.originalClient(binding), null, "successful group retirement frees only resolved host references");
  assert.equal(h.mainCalls, 1); assert.equal(h.localRuns, 0);
});

scenario("production two main rounds and employee aggregate original observations after sockets exit", async (t) => {
  const h = await productionWiring(t, "codex", true, true), entered = gate(), release = gate();
  h.beforeEmployeeConsumerFinish(async () => { entered.resolve(); await release.promise; });
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "backend",
    prompt: "Implement the isolated employee requirement completely and verify source changes with meaningful tests; report actual paths and results." }] });
  h.answer(2, { status: "wait", finalSummary: "等待真实消费者" });
  const started = await h.start(); assert.ok(started.ok); await entered.promise;
  h.fixture.adapter.host().submitUserMessage(started.taskId, "核对目前真实进展");
  await until(() => h.mainCalls === 2 && h.wire().filter((m) => m.method === "turn/start").length === 2);
  await until(() => fs.existsSync(h.file("eof-2")));
  await new Promise((r) => setImmediate(r));
  // Seal directly while consumer remains held; this is the same production
  // producer fence used by stop/normal adapter completion.
  let closed = false; const closing = h.producer.close(started.taskId).then((r) => { closed = true; return r; });
  await new Promise((r) => setImmediate(r)); assert.equal(closed, false);
  const before = h.store.read("root", "workspace"); assert.ok(before.ok && before.value);
  const originals = new Map(before.value.executionBindings!.map((b) => [b.identity.executionId, h.producer.originalClient(b)]));
  release.resolve(); assert.equal((await closing).ok, true);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  const bindings = saved.value.executionBindings!; assert.equal(bindings.length, 2);
  for (const b of bindings) await until(async () => (await new DepartmentExecutionOwnerClient(h.file("owners/" + b.identity.ownerId)).observeExecution(b.identity)).status === "unknown");
  await started.done;
  const replay = new DepartmentLeaderExecutionCleanup(h.store, h.file("owners"), async (b) => b.selection.revision === h.expected.revision,
    (b) => originals.get(b.identity.executionId) ?? null).observe(saved.value.leaderExecutionSets![0].scope);
  assert.ok(replay); await replay.done; // Same strict original observations, never disk receipts.
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 0, "production orchestration aggregated original clients after sockets exited");
  assert.equal(h.wire().filter((m) => m.method === "thread/start").length, 1);
  assert.equal(h.wire().filter((m) => m.method === "thread/resume").length, 1);
  assert.equal(h.wire(h.file("employee")).filter((m) => m.method === "turn/start").length, 1);
});

scenario("production OpenCode employee close and drain, owned resources and tab readback return mixed group capacity", async (t) => {
  const h = await productionWiring(t, "opencode", true, true), entered = gate(), release = gate();
  h.beforeEmployeeConsumerFinish(async () => { entered.resolve(); await release.promise; });
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "backend",
    prompt: "Implement the complete controlled employee requirement, verify the result with meaningful checks, and report the actual execution outcome and resource evidence." }] });
  h.answer(2, completed());
  const started = await h.start(); assert.ok(started.ok); await until(() => h.employeeBuilders === 1); await entered.promise;
  await until(() => fs.existsSync(h.file("employee/started")));
  h.fixture.adapter.host().submitUserMessage(started.taskId, "核对员工执行结果");
  await until(() => h.mainCalls === 2);
  const before = h.store.read("root", "workspace"); assert.ok(before.ok && before.value);
  const employeeBinding = before.value.executionBindings!.find((b) => b.identity.role === "employee");
  assert.ok(employeeBinding); assert.equal(employeeBinding.selection.cli, "opencode");
  assert.equal(employeeBinding.identity.session.state, "bound");
  assert.deepEqual(employeeBinding.requirements, { processTerminal: true, turnTerminal: false, streams: true, runner: true,
    executionRoot: true, links: true, temp: true, tab: true });
  const employeeClient = h.producer.originalClient(employeeBinding);
  assert.ok(employeeClient, "the production producer retains this exact OpenCode OwnerClient");
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1, "capacity stays leased while original tab consumer is active");
  assert.equal(before.value.capacity.employees.length, 1);
  assert.equal(h.tabs.size, 2);
  const employeeTabId = [...h.tabs.keys()].find((id) => id !== "leader-tab"); assert.ok(employeeTabId);

  release.resolve(); await started.done;
  assert.deepEqual(h.employeeProcessLifecycles.at(-1), { processTerminal: "confirmed", streams: "confirmed", temp: "unobservable" });
  await until(() => h.tabCloseAttempts.includes(employeeTabId));
  await until(() => h.tabs.size === 0);
  await until(() => JSON.parse(fs.readFileSync(h.file("configuration/selection.json"), "utf8")).leases.length === 0);
  const employeeRecord = new DepartmentExecutionReceiptStore(h.file("owners/" + employeeBinding.identity.ownerId))
    .read(employeeBinding.identity.executionId, employeeBinding.identity);
  assert.equal(employeeRecord.kind, "ok");
  assert.equal(employeeRecord.value.state, "cleaned", employeeRecord.value.state === "cleaned" ? undefined : "OpenCode Owner did not persist its cleanup receipt");
  assert.equal(employeeRecord.value.receipt?.cleanup.processTerminal.status, "confirmed");
  assert.equal(employeeRecord.value.receipt?.cleanup.streams.status, "confirmed");
  assert.equal(employeeRecord.value.receipt?.cleanup.runner.status, "confirmed");
  assert.equal(employeeRecord.value.receipt?.cleanup.executionRoot.status, "confirmed");
  assert.equal(employeeRecord.value.receipt?.cleanup.links.status, "confirmed");
  assert.equal(employeeRecord.value.receipt?.cleanup.temp.status, "confirmed");
  assert.equal(employeeRecord.value.receipt?.cleanup.tab.status, "confirmed");
  await until(() => h.composition.readCapacity("root")!.leaders.length === 0
    && h.composition.readCapacity("root")!.employees.length === 0);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.equal(saved.value.leaderExecutionSets![0].state, "closed");
  assert.equal(saved.value.capacity.leaders.length, 0);
  assert.equal(saved.value.capacity.employees.length, 0);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 0);
  assert.equal(h.composition.readCapacity("root")!.employees.length, 0);
  assert.equal(h.tabs.size, 0, "both original tabs were actually closed and read back absent");
  assert.ok(h.closedTabs.some((id) => id !== "leader-tab"), "employee tab close reached the trusted host capability");
  assert.equal(h.producer.originalClient(employeeBinding), null, "group retirement releases the resolved original OwnerClient only after cleanup proof");
  const task = h.read(started.taskId)!;
  assert.deepEqual(task.subTasks[0].executionSession, { cli: "opencode", configId: "profile", sessionId: "ses_fixture" }, "native session history remains bound");
  assert.deepEqual((await employeeClient.waitForCleanup(employeeBinding.identity, employeeBinding.requirements)).cleanup,
    employeeRecord.value.receipt!.cleanup, "original client retains its validated full receipt after worker retirement");
  await until(() => !fs.existsSync(h.file("owners/" + employeeBinding.identity.ownerId + "/owner.lock")));
  assert.equal((await new DepartmentExecutionOwnerClient(h.file("owners/" + employeeBinding.identity.ownerId))
    .observeExecution(employeeBinding.identity)).status, "unknown", "a cold client cannot replace the retired original Owner");
  assert.equal(fs.readFileSync(h.file("employee/export-count"), "utf8").trim().split("\n").length, 1);
});

scenario("production OpenCode employee tab release failure retains mixed group capacity", async (t) => {
  const h = await productionWiring(t, "opencode", true, true);
  h.failTabClose(true);
  h.answer(1, { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "backend",
    prompt: "Implement the complete controlled employee requirement, verify the result with meaningful checks, and report the actual execution outcome and resource evidence." }] });
  h.answer(2, completed());
  const started = await h.start(); assert.ok(started.ok); await started.done;
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  const binding = saved.value.executionBindings!.find((b) => b.identity.role === "employee"); assert.ok(binding);
  assert.equal(binding.selection.cli, "opencode"); assert.equal(binding.requirements.tab, true);
  await until(() => h.tabCloseAttempts.some((id) => id !== "leader-tab"));
  const employeeRecord = new DepartmentExecutionReceiptStore(h.file("owners/" + binding.identity.ownerId))
    .read(binding.identity.executionId, binding.identity);
  assert.ok(employeeRecord.kind === "ok"); assert.equal(employeeRecord.value.state, "cleanup-failed");
  assert.equal(saved.value.capacity.leaders.length, 1);
  assert.equal(saved.value.capacity.employees.length, 1);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
  assert.equal(h.composition.readCapacity("root")!.employees.length, 1);
  assert.equal(h.tabs.size, 2, "failed close is not treated as released evidence");
  assert.deepEqual(h.read(started.taskId)!.subTasks[0].executionSession, { cli: "opencode", configId: "profile", sessionId: "ses_fixture" });
});

for (const failure of ["tab", "selection", "missing-original", "persistence", "late-builder", "pipe"] as const) scenario(`production ${failure} retains group capacity`, async (t) => {
  const h = await productionWiring(t, "codex", true, true), entered = gate(), release = gate();
  h.answer(1, completed());
  if (failure === "tab") h.failTabClose(true);
  if (failure === "late-builder") h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  if (failure === "pipe") fs.writeFileSync(h.file("hold-pipe"), "held");
  // Exercise missing retained capability itself, rather than the former
  // per-binding lookup method now replaced by a trusted batch snapshot.
  if (failure === "missing-original") h.producer.retainOriginalClient = () => undefined;
  const started = await h.start(); assert.ok(started.ok);
  if (failure === "late-builder") {
    await entered.promise; const closing = h.producer.close(started.taskId);
    release.resolve(); assert.equal((await closing).ok, false); assert.equal(h.wire().length, 0);
  } else if (failure === "pipe") {
    await until(() => fs.existsSync(h.file("eof-1")));
    assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
    fs.rmSync(h.file("hold-pipe")); await started.done; return;
  } else {
    if (failure === "selection") h.setCleanupSelection(async () => ({ ...h.expected, ready: true, revision: "wrong-revision" }));
    if (failure === "persistence") {
      const write = h.store.write.bind(h.store);
      h.store.write = (value) => value.capacity.leaders.length === 0 ? { ok: false, error: "injected-release-persistence-failure" } : write(value);
    }
    await started.done;
  }
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value); assert.equal(saved.value.capacity.leaders.length, 1);
});

scenario("six sequential production modules reuse the four leader slots after durable release", async (t) => {
  const h = await productionWiring(t, "codex", true, true, 6);
  for (let n = 0; n < 6; n++) {
    h.answer(n + 1, completed());
    const started = await h.start(n ? "module-" + n : "module"); assert.ok(started.ok); await started.done;
    assert.equal(h.composition.readCapacity("root")!.leaders.length, 0);
    const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value);
    assert.equal(read.value.capacity.leaders.length, 0);
    assert.equal(read.value.leaderExecutionSets!.length, n + 1);
  }
  assert.equal(h.mainCalls, 6); assert.equal(h.localRuns, 0);
});

function completed() { return { status: "completed", progressPercent: 100, answerConclusion: "受控要求已完成", finalSummary: "受控原生执行结束",
  acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "module", passed: true }] }; }

scenario("stop fences the production coordinator but waits for an authorized native pipe before capacity return", async (t) => {
  const h = await productionWiring(t, "codex", true, true);
  h.answer(1, completed()); fs.writeFileSync(h.file("hold-pipe"), "held");
  const started = await h.start(); assert.ok(started.ok);
  await until(() => fs.existsSync(h.file("eof-1")));
  let stopped = false;
  const stopping = h.composition.host.stopRoot("root").then((v) => { stopped = true; return v; });
  await new Promise((r) => setImmediate(r));
  assert.equal(stopped, false); assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
  assert.throws(() => h.producer.scope(started.taskId), /no-live-generation/);
  assert.equal(h.wire().filter((m) => m.method === "turn/start").length, 1);
  fs.rmSync(h.file("hold-pipe")); assert.equal(await stopping, true);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 0);
  const read = h.store.read("root", "workspace"); assert.ok(read.ok && read.value); assert.equal(read.value.capacity.leaders.length, 0);
});

scenario("production OpenCode coverage and foreign generations cannot consume a leader slot", async (t) => {
  const h = await productionWiring(t, "opencode", true, true), entered = gate(), release = gate();
  h.beforeLeaderCallback(async () => { entered.resolve(); await release.promise; });
  try {
    h.answer(1, completed()); const started = await h.start(); assert.ok(started.ok); await entered.promise;
    const scope = h.producer.observationScope(started.taskId, 1);
    const before = h.store.readLeaderExecutionSet(scope); assert.ok(before.ok && before.value);
    assert.equal(before.value.set.state, "open");
    assert.equal(before.value.bindings.length, 1);
    const binding = before.value.bindings[0], original = h.producer.originalClient(binding); assert.ok(original);
    let received = false;
    const receipt = original.waitForCleanup(binding.identity, binding.requirements).then((value) => { received = true; return value; });
    const observation = h.groupCleanup.observe(h.read(started.taskId)!, scope.generation); assert.ok(observation);
    let observed = false; const observing = observation.done.then(() => { observed = true; });
    assert.equal(h.groupCleanup.observe(h.read(started.taskId)!, scope.generation + 1), null);
    assert.equal(new DepartmentLeaderExecutionCleanup(h.store, h.file("owners"), async () => false)
      .observe(scope), null, "the original producer has not yet proved a CLOSED complete set");
    await new Promise((r) => setImmediate(r));
    assert.equal(received, false, "the original consumer still prevents a full cleanup receipt");
    assert.equal(observed, false);
    assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
    const pending = h.store.read("root", "workspace"); assert.ok(pending.ok && pending.value);
    assert.equal(pending.value.capacity.leaders.length, 1, "foreign or incomplete observations cannot release the durable lease");

    release.resolve(); await observing; await started.done;
    const proof = await receipt;
    assert.equal(sameExecution(proof.identity, binding.identity), true);
    assert.equal(cleanupComplete(proof.cleanup, binding.requirements), true);
    const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
    const closed = saved.value.leaderExecutionSets!.find((set) => set.scope.leaderTaskId === started.taskId);
    assert.ok(closed?.closure); assert.equal(closed.state, "closed");
    assert.equal(closed.producerId, before.value.set.producerId);
    assert.deepEqual(closed.scope, scope); assert.deepEqual(closed.closure.scope, scope);
    assert.equal(closed.closure.producerId, before.value.set.producerId);
    assert.deepEqual(closed.entries.map((entry) => entry.executionId), [binding.identity.executionId]);
    assert.equal(saved.value.capacity.leaders.length, 0);
    assert.equal(h.composition.readCapacity("root")!.leaders.length, 0, "only the original complete proof returns capacity");
    assert.equal(h.groupCleanup.observe(h.read(started.taskId)!, scope.generation), null, "retired provenance cannot be consumed again");
  } finally { release.resolve(); }
});

scenario("cancelled group observation detaches while the original producer retains a late preparation", async (t) => {
  const h = await productionWiring(t, "codex", true, true), entered = gate(), release = gate();
  h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  const started = await h.start(); assert.ok(started.ok); await entered.promise;
  const controller = new AbortController();
  const observation = h.groupCleanup.observe(h.read(started.taskId)!, 1, controller.signal); assert.ok(observation);
  controller.abort(); await assert.rejects(observation.done, /cancelled/);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
  assert.equal(h.entries()[0].executionId, null);
  assert.throws(() => h.producer.scope(started.taskId), /no-live-generation/);
  release.resolve(); await started.done;
  assert.equal(h.wire().filter((m) => m.method === "turn/start").length, 0);
  assert.equal(h.composition.readCapacity("root")!.leaders.length, 1);
});

scenario("two production leaders share twenty employee leases and retain one unresolved overflow per group", async (t) => {
  const h = await productionWiring(t, "codex", true, true, 2), release = gate();
  const firstEntered = gate(), firstRelease = gate(), secondEntered = gate(), secondRelease = gate();
  h.beforeEmployeeBuilder(async () => { await release.promise; throw new Error("controlled-no-native-employee-preparation"); });
  // The fixture's multi-module decision limit is 20. Each real decision is
  // bounded below that limit and uses implementation work's legal backend type.
  const dispatch = (prefix: string, count: number) => ({ status: "dispatch", subtasks: Array.from({ length: count }, (_, n) => ({
    id: prefix + n, title: prefix + n, taskType: "backend", writeFiles: [prefix + n + ".ts"],
    prompt: "Implement this complete isolated backend requirement with meaningful source verification and report actual changed paths and results.",
  })) });
  const blocked = { status: "blocked", finalSummary: "全部门常规名额耗尽且本组应急名额已占用，等待原准备完成。" };
  const authorize = (leaderTaskId: string) => {
    const root = h.read("root")!, projection = h.composition.readDepartmentEmployeeAllocation(root.id)!;
    assert.deepEqual(root.department!.limits, { maxLeaders: 4, maxEmployees: 20 });
    assert.equal(projection.defaultLimit, 5, "default allocation remains based on all four configured leaders");
    const row = projection.leaders.find((item) => item.leaderTaskId === leaderTaskId); assert.ok(row);
    assert.equal(row.source, "default"); assert.equal(row.desiredLimit, 5); assert.equal(row.appliedLimit, null);
    const saved = h.composition.updateDepartmentEmployeeLimit(root, { requestId: "authorize-shared-capacity-" + leaderTaskId,
      leaderTaskId, employeeLimit: root.department!.limits.maxEmployees, expectedRevision: projection.revision });
    assert.ok(saved.ok, saved.ok ? undefined : saved.error);
    const confirmed = saved.allocation.leaders.find((item) => item.leaderTaskId === leaderTaskId)!;
    assert.equal(confirmed.source, "manual"); assert.equal(confirmed.desiredLimit, 20);
    assert.equal(confirmed.appliedLimit, null); assert.equal(confirmed.pending, true);
  };
  try {
    h.answer(1, dispatch("employee-", 11)); h.answer(2, dispatch("employee-", 11)); h.answer(3, blocked);
    h.answer(4, dispatch("emergency-", 2)); h.answer(5, blocked);
    h.beforeBuilder(async () => { firstEntered.resolve(); await firstRelease.promise; });
    const first = await h.start(); assert.ok(first.ok); await firstEntered.promise;
    authorize(first.taskId); firstRelease.resolve();
    await until(() => h.employeeBuilders === 11);
    const firstPool = h.composition.readCapacity("root")!;
    assert.equal(firstPool.employees.length, 11); assert.deepEqual(firstPool.employeeOverflow ?? [], []);
    assert.equal(h.composition.capacity.getEmployeeCapacity("root", first.taskId)?.availableEmployees, 9);

    h.beforeBuilder(async () => { secondEntered.resolve(); await secondRelease.promise; });
    const second = await h.start("module-1"); assert.ok(second.ok); await secondEntered.promise;
    authorize(second.taskId); secondRelease.resolve();
    await until(() => h.employeeBuilders === 21 && fs.existsSync(h.file("eof-3")));
    const shared = h.composition.readCapacity("root")!;
    assert.equal(shared.maxEmployees, 20); assert.equal(shared.employees.length, 21);
    assert.equal(shared.employeeOverflow?.length, 1);
    assert.equal(JSON.parse(shared.employeeOverflow![0])[0], second.taskId, "the second group used the final nine regular slots then one emergency slot");
    assert.equal(shared.employees.filter((id) => !shared.employeeOverflow!.includes(id)).length, 20);

    // With global balance zero the first group can also request one emergency
    // employee, while both groups' further requests must be refused.
    assert.equal(h.fixture.adapter.host().submitUserMessage(first.taskId, "全部门余额为零时核对本组唯一应急准入"), true);
    await until(() => h.employeeBuilders === 22 && fs.existsSync(h.file("eof-5")));
    const capacity = h.composition.readCapacity("root")!;
    assert.equal(capacity.employees.length, 22); assert.equal(capacity.employeeOverflow?.length, 2);
    assert.deepEqual(capacity.employeeOverflow!.map((id) => JSON.parse(id)[0]).sort(), [first.taskId, second.taskId].sort());
    assert.deepEqual(capacity.employees.filter((id) => !capacity.employeeOverflow!.includes(id)),
      shared.employees.filter((id) => !shared.employeeOverflow!.includes(id)), "the same twenty regular leases remain held");
    for (const [leaderTaskId, activeEmployees] of [[first.taskId, 12], [second.taskId, 10]] as const) {
      const current = h.composition.readEmployeeCapacity("root", leaderTaskId); assert.ok(current?.leaderAllocation);
      assert.equal(current.availableEmployees, 0); assert.equal(current.leaderOverflowActive, true); assert.equal(current.canAcquireOverflow, false);
      assert.equal(current.leaderAllocation.activeEmployees, activeEmployees);
      assert.equal(current.leaderAllocation.appliedLimit, 20); assert.equal(current.leaderAllocation.pending, false);
    }
    const before = h.store.read("root", "workspace"); assert.ok(before.ok && before.value);
    const responsibilities = before.value.leaderExecutionSets!.flatMap((set) => set.entries)
      .filter((entry) => entry.responsibility.target.role === "employee");
    assert.equal(responsibilities.length, 22, "refused attempts create no preparation responsibility");
    assert.ok(responsibilities.every((entry) => entry.executionId === null), "all admitted preparations remain unconfirmed");
    assert.equal(before.value.executionBindings!.filter((binding) => binding.identity.role === "employee").length, 0);
    assert.deepEqual(before.value.capacity.employees, capacity.employees);
    let stopped = false; const stopping = h.composition.host.stopRoot("root").then((v) => { stopped = true; return v; });
    await new Promise((r) => setImmediate(r)); assert.equal(stopped, false);
    assert.deepEqual(h.composition.readCapacity("root")!, capacity, "stop retains every pending regular, overflow and leader lease");
    release.resolve(); assert.equal(await stopping, false);
    await Promise.all([first.done, second.done]);
    assert.deepEqual(h.composition.readCapacity("root")!, capacity, "failed preparations keep every regular and overflow responsibility");
    assert.equal(capacity.leaders.length, 2);
    const failed = h.store.read("root", "workspace"); assert.ok(failed.ok && failed.value);
    assert.deepEqual(failed.value.capacity, before.value.capacity);
    assert.deepEqual(failed.value.leaderExecutionSets!.flatMap((set) => set.entries)
      .filter((entry) => entry.responsibility.target.role === "employee"), responsibilities);
    assert.equal(h.employeeBuilders, 22, "neither group's second emergency request reached preparation");
    assert.equal(h.wire(h.file("employee")).length, 0, "failed preparation emitted no native employee request");
  } finally { release.resolve(); firstRelease.resolve(); secondRelease.resolve(); }
});
