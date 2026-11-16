import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { productionWiring, gate } from "./fixtures/departmentproductionwiringfixture";
import { treeControl, bounded, eventually, treeFixtureCompleted } from "./fixtures/departmenttreecontrolfixture";
import { prepareDepartmentTaskRecord } from "../../extensionHost/departmentOwnedTaskRepository";
import { loopPlusAcceptanceChecksFixture } from "../loopPlusAcceptFixture";
import { isLoopTaskRunOrphaned } from "../../loopGroupChat";

function completed() {
  return { status: "completed", progressPercent: 100, answerConclusion: "受控要求已完成", finalSummary: "受控原生执行结束",
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "module", passed: true }] };
}

const MARKER = "DEPARTMENT_CONTINUATION_LIFECYCLE_COMPLETE:";
function scenario(name: string, run: (t: test.TestContext) => Promise<void>) {
  const selected = process.env.DEPARTMENT_CONTINUATION_LIFECYCLE_SCENARIO;
  if (selected) {
    if (selected === name) test(name, { timeout: 70000 }, async (t) => {
      await run(t);
      t.after(() => {
        if (name.includes("new task creation")) assert.equal(treeFixtureCompleted(t), true, "tree fixture lifecycle/source did not settle");
        process.stdout.write(MARKER + name + "\n");
      });
    });
    return;
  }
  test(name, { timeout: 95000 }, async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-continuation-home-"));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"),
      DEPARTMENT_CONTINUATION_LIFECYCLE_SCENARIO: name };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", __filename],
      { env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let output = "", expired = false;
    child.stdout.on("data", (chunk) => output += chunk); child.stderr.on("data", (chunk) => output += chunk);
    const timer = setTimeout(() => {
      expired = true;
      if (process.platform !== "win32" && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
      else child.kill("SIGKILL");
    }, 80000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      t.diagnostic(output);
      assert.equal(expired, false, `child deadline exceeded; ${output}`);
      assert.equal(code, 0, output);
      assert.ok(output.includes(MARKER + name), "fixture exited without lifecycle-complete marker: " + output);
      assert.match(output, /# fail 0\b/, output);
    } finally { clearTimeout(timer); fs.rmSync(home, { recursive: true, force: true }); }
  });
}

scenario("new task creation does not read a retained continuation proof from another task", async (t) => {
  const h = await treeControl(t), entered = gate(), release = gate();
  h.beforeLeaderCallback(async () => { entered.resolve(); await release.promise; });
  fs.writeFileSync(h.file("hold-output"), "pause the granted native turn before callbacks");
  h.releaseOnTeardown(() => fs.rmSync(h.file("hold-output"), { force: true }));
  h.answer(1, { status: "wait", finalSummary: "保留可继续任务" });
  const started = await bounded(h.start(), "start original leader", h.diagnostic);
  assert.ok(started.ok); h.track(started.done);
  await eventually(() => fs.existsSync(h.file("started-1")), "original native turn started", h.diagnostic);
  const stopped = h.track(h.stop());
  fs.rmSync(h.file("hold-output")); await bounded(entered.promise, "original callback entered while closing", h.diagnostic);
  release.resolve();
  await bounded(stopped.done, "original generation retired", h.diagnostic);
  assert.equal(stopped.state.status, "fulfilled", String(stopped.state.error));
  assert.equal(h.producer.canContinueLeader(started.taskId), true, "stopped task retains its valid same-host proof");

  const originalRead = h.source.readTaskRecord.bind(h.source), historicalReads = new Map([[started.taskId, 0]]);
  h.source.readTaskRecord = ((id: string) => {
    if (historicalReads.has(id)) historicalReads.set(id, historicalReads.get(id)! + 1);
    return originalRead(id);
  }) as typeof h.source.readTaskRecord;
  const otherRoot = h.read("other-root")!, oldTask = h.read(started.taskId)!;
  const prepared = prepareDepartmentTaskRecord({ ...structuredClone(oldTask), id: "candidate-leader", taskStoreFile: "",
    status: "running", sessionId: "local_candidate", createdAt: Date.now(), updatedAt: Date.now(), rounds: [], subTasks: [],
    executionSession: undefined, executionSessionInvalid: false, mainCommunicationFile: h.file("candidate-main.md") },
  { ...otherRoot.department!, parentTaskId: otherRoot.id, leaderSubtaskId: "module", role: "leader", moduleTitle: "module" },
  otherRoot.loopPlusAcceptancePlan!);
  const { taskStoreFile: _taskStoreFile, ...newTaskRecord } = prepared;
  const unrelated = h.source.create(newTaskRecord);
  historicalReads.set(started.taskId, 0);
  h.producer.recordNewLeader(unrelated);
  assert.deepEqual([...historicalReads.values()], [0], "creation reads its own task without scanning retained proof task ids");
  t.diagnostic(`retained proofs=1; historical task reads during unrelated task creation=${[...historicalReads.values()].join(",")}`);
  h.source.readTaskRecord = originalRead;
});

scenario("completed task retirement does not retain continuation provenance", async (t) => {
  const h = await productionWiring(t, "codex", true, true);
  h.answer(1, completed());
  const started = await h.start(); assert.ok(started.ok); await started.done;
  assert.equal(h.read(started.taskId)?.status, "completed");
  assert.equal(h.producer.canContinueLeader(started.taskId), false);
  const saved = h.store.readLeaderExecutionSet({ rootTaskId: "root", workspace: "workspace", leaderTaskId: started.taskId,
    moduleId: "module", generation: 1 });
  assert.ok(saved.ok && saved.value);
  assert.equal(h.producer.originalClient(saved.value.bindings[0]), null, "completed task cleanup releases its resolved original client");
  t.diagnostic("completed task has no reusable continuation proof after clean retirement");
});

scenario("unknown preparation responsibility remains live and cannot be retired into a proof", async (t) => {
  const h = await productionWiring(t), entered = gate(), release = gate();
  h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  const started = await h.start(); assert.ok(started.ok); await entered.promise;
  const scope = h.producer.observationScope(started.taskId, 1);
  const closing = h.producer.close(started.taskId);
  release.resolve(); const result = await closing; await started.done;
  assert.equal(result.ok, false);
  h.producer.retire(started.taskId, 1);
  assert.equal(h.producer.canContinueLeader(started.taskId), false);
  assert.equal(h.producer.observationScope(started.taskId, 1).generation, scope.generation,
    "failed/unbound responsibility remains under its original generation");
  t.diagnostic("unbound execution retained producer generation and did not receive continuation provenance");
});

scenario("continued leader owns preparation and coordination until its real stopped generation retires", async (t) => {
  const h = await treeControl(t);
  const entered = h.gate(), release = h.gate();
  h.answer(1, { status: "wait", finalSummary: "等待续接测试" });
  const first = await bounded(h.start(), "initial leader", h.diagnostic); assert.ok(first.ok);
  h.track(first.done);
  await eventually(() => fs.existsSync(h.file("started-1")), "initial native task", h.diagnostic);
  await bounded(h.stop(), "first generation fully cleaned", h.diagnostic);
  assert.equal(h.ownership.getCount(first.taskId), 0);
  assert.equal(h.producer.canContinueLeader(first.taskId), true);
  const old = h.store.read("root", "workspace"); assert.ok(old.ok && old.value);
  assert.deepEqual(old.value.capacity.leaders, []);
  assert.equal(old.value.leaderExecutionSets![0].state, "closed");
  h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  h.answer(2, { status: "wait", finalSummary: "继续协调等待" });
  let runningProjections = 0;
  h.onTaskUpdated((task, patch) => {
    if (task.id !== first.taskId || patch.status !== "running") return;
    runningProjections++;
    assert.equal(h.ownership.getCount(task.id), 1, "own before the first running write can project state");
    assert.equal(isLoopTaskRunOrphaned(task, h.ownership.collectTaskIds()), false);
  });
  const continued = await bounded(h.composition.host.continueRoot("root"), "resume exact leader", h.diagnostic);
  assert.ok(continued.ok);
  assert.ok(runningProjections > 0);
  await bounded(entered.promise, "resumed preparation", h.diagnostic);
  const assertOwned = () => {
    assert.equal(h.ownership.getCount(first.taskId), 1);
    assert.equal(isLoopTaskRunOrphaned(h.read(first.taskId)!, h.ownership.collectTaskIds()), false);
  };
  assertOwned();
  assert.equal(h.wire().filter((m) => m.method === "turn/start").length, 1, "second native task still gated by preparation");
  release.resolve();
  await eventually(() => fs.existsSync(h.file("started-2")), "successor native task", h.diagnostic);
  await bounded(h.fixture.adapter.waitForTaskIdle(first.taskId), "successor turn consumed", h.diagnostic);
  assertOwned(); // runEventDriven still owns its real event-driven coordination wait.
  const stopping = h.stop();
  await bounded(stopping, "successor cleanup", h.diagnostic);
  await bounded(h.ownership.waitForIdle(first.taskId), "successor ownership release", h.diagnostic);
  assert.equal(h.ownership.getCount(first.taskId), 0);
  assert.equal(h.read(first.taskId)?.status, "stopped");
  assert.deepEqual(h.composition.readCapacity("root")?.leaders, []);
});

scenario("cancelled continued preparation releases orchestration ownership but retains unbound cleanup responsibility", async (t) => {
  const h = await treeControl(t), entered = h.gate(), release = h.gate();
  h.answer(1, { status: "wait", finalSummary: "等待停止" });
  const first = await h.start(); assert.ok(first.ok); h.track(first.done);
  await eventually(() => fs.existsSync(h.file("started-1")), "first task", h.diagnostic);
  await bounded(h.stop(), "first cleanup", h.diagnostic);
  h.beforeBuilder(async () => { entered.resolve(); await release.promise; });
  assert.ok((await h.composition.host.continueRoot("root")).ok);
  await bounded(entered.promise, "successor preparation", h.diagnostic);
  assert.equal(h.ownership.getCount(first.taskId), 1);
  const stopping = h.track(h.stop());
  assert.equal(h.ownership.getCount(first.taskId), 1, "cancellation does not forget pending preparation");
  release.resolve();
  await bounded(stopping.done, "cancelled successor settles", h.diagnostic);
  assert.equal(stopping.state.status, "rejected", "unbound preparation cannot produce a full cleanup receipt");
  await bounded(h.ownership.waitForIdle(first.taskId), "cancelled coordinator settles", h.diagnostic);
  assert.equal(h.ownership.getCount(first.taskId), 0);
  assert.equal(h.wire().filter((m) => m.method === "turn/start").length, 1);
  assert.equal(h.producer.canContinueLeader(first.taskId), false);
  assert.equal(h.composition.readCapacity("root")?.leaders.length, 1, "tracker release is not capacity release");
});
