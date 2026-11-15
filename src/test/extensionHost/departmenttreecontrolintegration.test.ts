import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { treeControl, bounded, eventually, treeFixtureCompleted } from "./fixtures/departmenttreecontrolfixture";
import { buildLoopPlusFinishEventId } from "../../loopPlusScheduler";
import { cleanupComplete, sameExecution } from "../../runtime/departmentexecutionidentity";
import { createDepartmentLeaderCallbackDelegate } from "../../extensionHost/departmentleaderproductionhost";

const MARKER = "DEPARTMENT_TREE_CONTROL_COMPLETE:";
function scenario(name: string, run: (t: test.TestContext) => Promise<void>) {
  const selected = process.env.DEPARTMENT_TREE_CONTROL_SCENARIO;
  if (selected) {
    if (selected === name) test(name, { timeout: 45000 }, async (t) => {
      await run(t);
      // After hooks (including real lifecycle/source settlement) run before this
      // final hook. A TAP pass AND marker are both required by the parent.
      t.after(() => { assert.equal(treeFixtureCompleted(t), true, "fixture lifecycle/source did not finish"); process.stdout.write(MARKER + name + "\n"); });
    });
    return;
  }
  test(name, { timeout: 65000 }, async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-tree-user-"));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"),
      DEPARTMENT_TREE_CONTROL_SCENARIO: name };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", __filename],
      { env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let output = "", expired = false;
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = setTimeout(() => {
      expired = true;
      // Failure-only reclamation of this subprocess group, never cleanup proof.
      if (process.platform !== "win32" && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
      else child.kill("SIGKILL");
    }, 55000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      t.diagnostic(output);
      assert.equal(expired, false, `child deadline exceeded; ${output}`);
      assert.equal(code, 0, output);
      assert.ok(output.includes(MARKER + name), "fixture exited without complete async lifecycle marker: " + output);
      assert.match(output, /# fail 0\b/, output);
    } finally { clearTimeout(timer); fs.rmSync(home, { recursive: true, force: true }); }
  });
}
const employeeDecision = { status: "dispatch", subtasks: [{ id: "employee", title: "employee", taskType: "general", writeFiles: [],
  prompt: "Implement the complete isolated employee requirement, verify source changes with meaningful checks and report changed paths and actual results." }] };
const waitDecision = { status: "wait", finalSummary: "等待真实员工与原 Owner 清理凭证" };

test("captured old leader callback delegate cannot reach a successor consumer", () => {
  let generation = 1, current = true, successorCalls = 0;
  const producer = { observationScope(_taskId: string, requested: number) {
    if (!current || requested !== generation) throw new Error("department-producer-observation-scope-unavailable");
    return { rootTaskId: "root", workspace: "workspace", leaderTaskId: "leader", moduleId: "module", generation };
  } };
  const original = { onAssistantDelta() {} } as unknown as import("../../interactive/codexOwnedExecution").CodexOwnedStreamHandlers;
  const delegate = createDepartmentLeaderCallbackDelegate(producer, "leader", producer.observationScope("leader", 1), () => current,
    () => current ? original : { onAssistantDelta() { successorCalls++; } } as unknown as import("../../interactive/codexOwnedExecution").CodexOwnedStreamHandlers);
  (delegate.onAssistantDelta as (...args: unknown[]) => unknown)("settle original");
  generation = 2;
  assert.throws(() => (delegate.onAssistantDelta as (...args: unknown[]) => unknown)("stale callback"), /observation-scope-unavailable/);
  assert.equal(successorCalls, 0);
});

scenario("production root stop drains an already-granted leader callback before continuation", async (t) => {
  const h = await treeControl(t), entered = h.gate(), release = h.gate();
  h.beforeLeaderCallback(async () => { entered.resolve(); await release.promise; });
  fs.writeFileSync(h.file("hold-output"), "pause the granted native turn before callbacks");
  h.releaseOnTeardown(() => fs.rmSync(h.file("hold-output"), { force: true }));
  h.answer(1, waitDecision);
  const started = await bounded(h.start(), "leader with granted main turn", h.diagnostic); assert.ok(started.ok);
  h.track(started.done);
  await eventually(() => fs.existsSync(h.file("started-1")), "native turn authorized before stop", h.diagnostic);
  const scope = h.producer.observationScope(started.taskId, 1);
  const before = h.composition.readCapacity("root")!;
  const stop = h.track(h.stop());
  assert.equal(h.read("root")?.status, "stopped");
  assert.equal(h.producer.producer.canLaunch!(scope), false, "stop closes new grants immediately");
  assert.deepEqual(h.composition.readCapacity("root")!.leaders, before.leaders, "closing retains the original leader lease");
  await assert.rejects(bounded(h.continue(), "continue while granted callback is pending", h.diagnostic), /部门继续被拒绝：root-not-ready/);
  assert.equal(stop.state.status, "pending");
  fs.rmSync(h.file("hold-output"));
  await bounded(entered.promise, "original leader callback entered after closing", h.diagnostic);
  assert.equal(stop.state.status, "pending", "an acknowledged native turn still waits for its actual consumer");
  release.resolve();
  await bounded(stop.done, "original callback and Owner drain", h.diagnostic);
  assert.equal(stop.state.status, "fulfilled", String(stop.state.error));
  const stopped = h.store.read("root", "workspace"); assert.ok(stopped.ok && stopped.value);
  const oldSet = stopped.value.leaderExecutionSets!.find((v) => v.scope.leaderTaskId === started.taskId && v.scope.generation === 1);
  assert.ok(oldSet); assert.equal(oldSet.state, "closed");
  assert.deepEqual(stopped.value.capacity.leaders, []);
  await bounded(h.fixture.adapter.waitForTaskIdle(started.taskId), "stopped original adapter idle", h.diagnostic);
  h.answer(2, waitDecision);
  const resumed = await bounded(h.composition.host.continueRoot("root"), "continue after callback drain", h.diagnostic);
  assert.ok(resumed.ok, "host continuation remains authorized after the original callback settles");
  await eventually(() => h.mainCalls > 1, "successor main invocation", h.diagnostic);
  assert.throws(() => h.producer.observationScope(started.taskId, 1), /observation-scope-unavailable/,
    "the old generation scope cannot address a successor consumer");
  assert.ok((h.composition.host.runtimeSnapshot("root")!.leaders.find((v) => v.taskId === started.taskId)?.generation ?? 0) > 1);
  await eventually(() => fs.existsSync(h.file("started-2")), "successor native turn", h.diagnostic);
  const successorStop = h.track(h.stop());
  await bounded(successorStop.done, "successor Owner cleanup", h.diagnostic);
  assert.equal(successorStop.state.status, "fulfilled", String(successorStop.state.error));
  await bounded(h.fixture.adapter.waitForTaskIdle(started.taskId), "successor adapter idle", h.diagnostic);
  assert.deepEqual(h.composition.readCapacity("root")!.leaders, []);
  t.diagnostic("CHECKPOINT closing allowed the granted original callback to settle; cleanup/lease return completed before continuation; old generation scope rejected beside successor");
});

scenario("production root stop drains two original groups before explicit continuation", async (t) => {
  const h = await treeControl(t), release = h.gate(); let consumers = 0;
  h.beforeEmployeeConsumerFinish(async () => { consumers++; await release.promise; });
  h.answer(1, employeeDecision); h.answer(2, employeeDecision); h.answer(3, waitDecision);
  const a = await bounded(h.start(), "first leader", h.diagnostic); assert.ok(a.ok);
  h.track(a.done);
  await eventually(() => consumers === 1, "first original consumer", h.diagnostic);
  const b = await bounded(h.start("module-1"), "second leader", h.diagnostic); assert.ok(b.ok);
  h.track(b.done);
  await eventually(() => consumers === 2, "second original consumer", h.diagnostic);
  // Keep the unrelated root's actual native turn active. Its normal wait/idle
  // decisions would otherwise create unrelated extra mains during our checks.
  fs.writeFileSync(h.file("hold-terminal"), "held independent root");
  h.releaseOnTeardown(() => fs.rmSync(h.file("hold-terminal"), { force: true }));
  const other = await bounded(h.startOther(), "independent root leader", h.diagnostic); assert.ok(other.ok);
  h.track(other.done);
  await eventually(() => fs.existsSync(h.file("started-3")), "independent native main running", h.diagnostic);
  const otherBefore = h.composition.host.runtimeSnapshot("other-root");
  const otherCapacity = h.composition.readCapacity("other-root");
  const before = h.composition.readCapacity("root")!;
  assert.equal(before.leaders.length, 2); assert.equal(before.employees.length, 2);
  assert.equal(before.employeeOverflow?.length, 1);
  const overflow = before.employeeOverflow![0];
  const [overflowLeader, overflowAttempt] = JSON.parse(overflow) as [string, string];
  assert.equal(overflowLeader, b.taskId, "the second group owns the overflow");
  assert.ok(h.snapshot(b.taskId).running.some((v) => v.subtaskId === "employee" && v.attemptId === overflowAttempt),
    "the original overflow names the exact live employee attempt");
  const original = [a.taskId, b.taskId].map((id) => {
    const phase = h.producer.observationSnapshot(id, 1);
    const read = h.store.readLeaderExecutionSet(phase.scope); assert.ok(read.ok && read.value);
    assert.equal(read.value.bindings.length, 2, "leader plus actually authorized employee");
    return { phase, bindings: read.value.bindings };
  });
  const originalPrompts = h.mainInvocations.map((v) => ({ ...v }));
  const stop = h.track(h.stop());
  assert.equal(h.read("root")?.status, "stopped");
  assert.equal(h.composition.host.runtimeSnapshot("root")?.stopping, true);
  const counts = h.counts();
  await assert.rejects(bounded(h.continue(), "continue while original consumers pending", h.diagnostic), /部门继续被拒绝：root-not-ready/);
  assert.equal(stop.state.status, "pending", "explicit consumer latches still own the stop lifecycle");
  assert.deepEqual(h.counts(), counts);
  assert.deepEqual(h.composition.readCapacity("root")!.employees, before.employees);
  assert.deepEqual(h.composition.readCapacity("root")!.employeeOverflow, [overflow]);
  assert.deepEqual(h.composition.readCapacity("root")!.leaders, before.leaders);
  const refused = await bounded(h.start("module-2"), "late new dispatch", h.diagnostic);
  assert.equal(refused.ok, false);
  assert.deepEqual(h.counts(), counts);
  for (const { phase } of original) {
    assert.equal(h.producer.producer.canLaunch!(phase.scope), false);
    await assert.rejects(h.producer.producer.withAdmission(phase.scope, async () => assert.fail("late grant ran")), /sealed/);
  }
  assert.deepEqual(h.composition.host.runtimeSnapshot("other-root"), otherBefore);
  assert.deepEqual(h.composition.readCapacity("other-root"), otherCapacity);
  assert.equal(h.read(other.taskId)?.status, "running");
  t.diagnostic("CHECKPOINT stop fenced both groups; pending consumers retained regular/overflow/leader leases; authoritative continue refusal; other root unchanged");
  release.resolve();
  await bounded(stop.done, "root stop real lifecycle", h.diagnostic);
  assert.equal(stop.state.status, "fulfilled", String(stop.state.error));
  for (const { phase, bindings } of original) {
    for (const binding of bindings) {
      const client = phase.originalClient(binding); assert.ok(client, "retain the original client capability");
      const receipt = await bounded(client.waitForCleanup(binding.identity, binding.requirements), "original Owner receipt", h.diagnostic);
      assert.equal(sameExecution(receipt.identity, binding.identity), true);
      assert.equal(cleanupComplete(receipt.cleanup, binding.requirements), true);
    }
    // stop advances the current member generation. Read the durable historical
    // complete set through the cold root API, not the current-generation API.
    const current = h.store.read("root", "workspace"); assert.ok(current.ok && current.value);
    const set = current.value.leaderExecutionSets!.find((v) => v.scope.leaderTaskId === phase.scope.leaderTaskId && v.scope.generation === phase.scope.generation);
    assert.ok(set); assert.equal(set.state, "closed"); assert.ok(set.closure);
    assert.deepEqual(set.entries.map((v) => v.executionId).sort(), bindings.map((v) => v.identity.executionId).sort());
    for (const binding of bindings) assert.ok(current.value.executionBindings!.some((v) => sameExecution(v.identity, binding.identity)));
  }
  const saved = h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
  assert.deepEqual(saved.value.capacity.employees, []); assert.deepEqual(saved.value.capacity.leaders, []);
  assert.deepEqual(h.composition.readCapacity("root")!.employees, []); assert.deepEqual(h.composition.readCapacity("root")!.leaders, []);
  for (const id of [a.taskId, b.taskId]) {
    await bounded(h.fixture.adapter.waitForTaskIdle(id), "original adapter idle", h.diagnostic);
    assert.equal(h.fixture.adapter.hasTaskExecution(id), false);
    const s = h.snapshot(id), attempt = s.seenAttempts.find((v) => v.subtaskId === "employee"); assert.ok(attempt);
    assert.equal(attempt.outcome, "stopped");
    assert.ok(s.reviewQueue.some((v) => v.eventId === buildLoopPlusFinishEventId("employee", attempt.attemptId)
      && v.subtaskId === "employee" && v.attemptId === attempt.attemptId && v.outcome === "stopped"));
  }
  assert.deepEqual(h.mainInvocations, originalPrompts, "issued main prompts are immutable decision snapshots");
  assert.deepEqual(h.composition.host.runtimeSnapshot("other-root"), otherBefore);
  t.diagnostic("CHECKPOINT original Owner receipts, closed complete sets, durable lease removal, adapter idle and exact stopped finish review events confirmed");

  // Required positive contract. Keep this assertion red if production cannot
  // legally resume. Do not recreate tabs, adopt sets or open a replacement Owner.
  await t.test("explicit continue after proven tree cleanup resumes legal successor generations", async () => {
    await bounded(h.continue(), "positive root continuation", h.diagnostic);
    await eventually(() => h.mainCalls > counts.mains, "successor main invocation", h.diagnostic);
    for (const id of [a.taskId, b.taskId]) {
      assert.ok((h.composition.host.runtimeSnapshot("root")!.leaders.find((v) => v.taskId === id)?.generation ?? 0) > 1);
      const stopped = h.snapshot(id).seenAttempts.find((v) => v.subtaskId === "employee"); assert.equal(stopped?.outcome, "stopped");
      assert.ok(h.mainInvocations.some((v) => v.taskId === id && v.prompt.includes(buildLoopPlusFinishEventId("employee", stopped!.attemptId))));
    }
    const successor = h.store.read("root", "workspace"); assert.ok(successor.ok && successor.value);
    for (const { phase, bindings } of original) {
      await assert.rejects(h.producer.producer.withAdmission(phase.scope, async () => assert.fail("old generation launched")), /sealed/);
      assert.throws(() => h.producer.observationScope(phase.scope.leaderTaskId, phase.scope.generation), /observation-scope-unavailable/);
      for (const binding of bindings) {
        const client = phase.originalClient(binding); assert.ok(client);
        await bounded(client.waitForCleanup(binding.identity, binding.requirements), "late old callback", h.diagnostic);
      }
    }
    assert.deepEqual(h.store.read("root", "workspace"), successor, "late original callbacks cannot rewrite or release successor capacity");
  });
});

scenario("production root stop before binding fences late preparation and retains unknown responsibility", async (t) => {
  const h = await treeControl(t), entered = h.gate(), release = h.gate();
  h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  const launch = await bounded(h.start(), "unbound leader start", h.diagnostic); assert.ok(launch.ok);
  h.track(launch.done); await bounded(entered.promise, "original unbound builder", h.diagnostic);
  assert.equal(h.entries().length, 1); assert.equal(h.entries()[0].executionId, null);
  const original = structuredClone(h.entries()[0]);
  const capacity = h.composition.readCapacity("root"); const counts = h.counts();
  const stop = h.track(h.stop());
  await assert.rejects(bounded(h.continue(), "unbound pending continue", h.diagnostic), /部门继续被拒绝：root-not-ready/);
  assert.equal(stop.state.status, "pending"); assert.deepEqual(h.counts(), counts);
  release.resolve(); await bounded(stop.done, "failed original preparation settlement", h.diagnostic);
  assert.equal(stop.state.status, "rejected"); assert.match(String(stop.state.error), /尚未核验全部执行清理/);
  assert.equal(h.wire().filter((v) => v.method === "turn/start").length, 0, "late prepare never sends a task prompt");
  assert.deepEqual(h.entries(), [original], "the original null responsibility is never cleared or adopted");
  assert.deepEqual(h.composition.readCapacity("root"), capacity);
  const member = h.composition.host.runtimeSnapshot("root")!.leaders.find((v) => v.taskId === launch.taskId)!;
  assert.equal(member.status, "blocked");
  h.producer.retire(launch.taskId, 1);
  assert.equal(h.producer.canContinueLeader(launch.taskId), false);
  assert.equal(h.producer.observationScope(launch.taskId, 1).generation, 1, "retirement cannot discard unknown preparation responsibility");
  await assert.rejects(bounded(h.continue(), "unknown original responsibility continue", h.diagnostic), /部门继续被拒绝：execution-cleanup-unverified/);
  assert.deepEqual(h.counts(), counts);
  assert.equal(h.read("root")?.status, "stopped");
  const persisted = h.store.read("root", "workspace"); assert.ok(persisted.ok && persisted.value);
  assert.deepEqual(persisted.value.capacity, capacity);
  t.diagnostic("CHECKPOINT late unbound preparation sent zero prompts; stop rejected; original null entry and unknown leader occupancy retained; subsequent continue rejected");
});
