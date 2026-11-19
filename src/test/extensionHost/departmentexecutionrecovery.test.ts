import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { once } from "node:events";
import { fork } from "node:child_process";
import { DepartmentRuntimeStore, type DepartmentStoredRuntime } from "../../extensionHost/departmentruntimestore";
import { DepartmentExecutionRecovery } from "../../extensionHost/departmentexecutionrecovery";
import { createDepartmentRuntimeSnapshot, type DepartmentExecutionBinding } from "../../extensionHost/departmentruntimestate";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";
import { DepartmentExecutionOwnerClient } from "../../runtime/departmentexecutionownerclient";
import type { LoopTaskRecord } from "../../loopTaskStore";

function setup(t: import("node:test").TestContext, cli: "codex" | "opencode" = "codex") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-bound-recovery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const selection: DepartmentExecutionSelection = { version: 1, cli, role: "employee", configId: "profile",
    revision: "revision-1", model: "employee-model", thinkingMode: "off", openCodeVariant: cli === "opencode" ? "fixture" : null };
  const binding: DepartmentExecutionBinding = {
    identity: { version: 1, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
      role: "employee", generation: 1, cli, session: { state: "bound", id: "fixture-session-execution" },
      ownerId: "owner", executionId: "execution", subtaskId: "subtask", attemptId: "attempt",
      ...fingerprintDepartmentExecutionSelection(selection) }, selection,
    requirements: { processTerminal: true, turnTerminal: false, streams: true, runner: true,
      executionRoot: true, links: true, temp: true, tab: true },
  };
  const value: DepartmentStoredRuntime = { version: 1, rootTaskId: "root", workspaceKey: "workspace",
    runtime: createDepartmentRuntimeSnapshot("root"), capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20,
      leaders: ["module"], employees: [JSON.stringify(["leader", "attempt"]), JSON.stringify(["leader", "attempt-2"])] } };
  value.runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", generation: 1, status: "running" });
  const store = new DepartmentRuntimeStore(path.join(directory, "runtime")); assert.equal(store.write(value).ok, true);
  const task = { id: "leader", workspaceKey: "workspace", cli, sessionId: "leader-session",
    department: { version: 1, rootTaskId: "root", parentTaskId: "root", leaderSubtaskId: "module", role: "leader", moduleTitle: "module",
      routes: { director: { cli }, leader: { cli }, employee: { cli, configId: "profile", model: "employee-model", thinkingMode: "off",
        ...(cli === "opencode" ? { openCodeVariant: "fixture" } : {}) } },
      limits: { maxLeaders: 4, maxEmployees: 20 } },
    subTasks: [{ id: "subtask", status: "running", executionSession: { cli, sessionId: "fixture-session-execution", configId: "profile" } }],
  } as LoopTaskRecord;
  const attempt = { subtaskId: "subtask", attemptId: "attempt" };
  const owners = path.join(directory, "owners");
  return { directory, binding, value, store, task, attempt, owners };
}

function secondAttemptBinding(binding: DepartmentExecutionBinding): DepartmentExecutionBinding {
  const second = structuredClone(binding);
  if (second.identity.role === "employee") {
    second.identity.executionId = "execution-2";
    second.identity.attemptId = "attempt-2";
    second.identity.session = { state: "bound", id: "fixture-session-execution-2" };
  }
  return second;
}

test("bound execution selection fingerprints allow only versioned credential-free metadata", () => {
  const selection: DepartmentExecutionSelection = { version: 1, cli: "codex", role: "employee", configId: "profile",
    revision: "revision-1", model: "model", thinkingMode: "off", openCodeVariant: null };
  const hashes = fingerprintDepartmentExecutionSelection(selection);
  assert.deepEqual(fingerprintDepartmentExecutionSelection({ ...selection }), hashes);
  assert.notDeepEqual(fingerprintDepartmentExecutionSelection({ ...selection, revision: "revision-2" }), hashes);
  assert.notEqual(fingerprintDepartmentExecutionSelection({ ...selection, role: "leader" }).profileFingerprint, hashes.profileFingerprint);
  for (const key of ["authContent", "envContent", "profileDigest", "content", "prompt"]) {
    assert.throws(() => fingerprintDepartmentExecutionSelection({ ...selection, [key]: "must-not-enter-projection" }), /selection-metadata/);
  }
});

test("bound execution store preserves identity across stale controller writes and rejects deletion, replacement, policy and slot conflicts", (t) => {
  const { store, value, binding } = setup(t);
  assert.equal(store.bindExecution("root", "workspace", binding).ok, true);
  const later = secondAttemptBinding(binding);
  assert.equal(store.bindExecution("root", "workspace", later).ok, true, "same subtask in another attempt has a separate organization target");
  assert.equal(new DepartmentRuntimeStore((store as unknown as { directory: string }).directory).read("root", "workspace").ok, true);
  assert.equal(store.bindExecution("root", "workspace", structuredClone(binding)).ok, true, "duplicate bound start is idempotent");
  assert.equal(store.write(value).ok, true, "legacy controller writes retain immutable bindings");
  const read = store.read("root", "workspace"); assert.ok(read.ok && read.value);
  assert.deepEqual(read.value.executionBindings, [binding, later]);
  assert.equal(store.write({ ...read.value, executionBindings: [] }).ok, false);
  assert.equal(store.bindExecution("root", "workspace", { ...binding, requirements: { ...binding.requirements, tab: false } }).ok, false);
  const conflict = structuredClone(binding); conflict.identity.executionId = "second-execution";
  assert.equal(store.bindExecution("root", "workspace", conflict).ok, false, "same exact attempt cannot select another execution");
  const sameAttemptReplacement = structuredClone(later); sameAttemptReplacement.identity.executionId = "replacement-execution";
  assert.equal(store.bindExecution("root", "workspace", sameAttemptReplacement).ok, false, "same attempt cannot be rebound to another execution");
  const replacementPolicy = structuredClone(later); replacementPolicy.requirements.tab = false;
  assert.equal(store.bindExecution("root", "workspace", replacementPolicy).ok, false, "same attempt cannot change cleanup policy");
  const unbound = structuredClone(binding); unbound.identity.session = { state: "unbound" };
  assert.equal(store.bindExecution("root", "workspace", unbound).ok, false);
  assert.equal(store.bindExecution("root", "other-workspace", binding).ok, false);
  const late = structuredClone(binding); late.identity.generation = 2; late.identity.executionId = "later";
  assert.equal(store.bindExecution("root", "workspace", late).ok, false, "no lease for later generation");
  assert.deepEqual(store.read("root", "workspace"), read, "failed replacements preserve original bytes/identity");
});

test("bound recovery refuses legacy, wrong session/role/attempt, changed selection and absent owner without spawning", async (t) => {
  const { store, task, attempt, binding, owners, directory } = setup(t);
  const recovery = new DepartmentExecutionRecovery(store, owners, async () => true);
  assert.equal(recovery.observeAttempt(task, attempt), null, "no inference for legacy records");
  assert.equal(store.bindExecution("root", "workspace", binding).ok, true);
  assert.equal(recovery.observeAttempt(task, { ...attempt, attemptId: "different" }), null);
  const laterBinding = secondAttemptBinding(binding);
  laterBinding.identity.session = { state: "bound", id: "historical-session" };
  assert.equal(store.bindExecution("root", "workspace", laterBinding).ok, true);
  assert.equal(recovery.observeAttempt(task, { subtaskId: "subtask", attemptId: "attempt-2" }), null,
    "historical attempt with non-current authoritative session remains unknown");
  assert.ok(recovery.observeAttempt(task, attempt), "the exact current attempt remains independently discoverable");
  const wrong = structuredClone(task); wrong.subTasks[0].executionSession!.sessionId = "different";
  assert.equal(recovery.observeAttempt(wrong, attempt), null);
  const changed = new DepartmentExecutionRecovery(store, owners, async () => false).observeAttempt(task, attempt);
  assert.ok(changed); await assert.rejects(changed.done, /selection-conflict/);
  const missing = recovery.observeAttempt(task, attempt); assert.ok(missing); await assert.rejects(missing.done, /owner-unreachable/);
  assert.equal(fs.existsSync(owners), false, "observation does not create owner or execute payload");
  const file = path.join(directory, "runtime", Buffer.from("root").toString("hex") + ".json");
  fs.writeFileSync(file, "{corrupt");
  assert.equal(recovery.observeAttempt(task, attempt), null);
  assert.equal(store.write({ version: 1 } as DepartmentStoredRuntime).ok, false);
});

for (const cli of ["codex", "opencode"] as const) for (const mode of ["ok", "fail-root"] as const) {
  test(`bound ${cli} recovery consumes independent owner receipt, never disk state alone (${mode})`, { timeout: 15000 }, async (t) => {
    const { store, task, attempt, binding, owners } = setup(t, cli);
    assert.equal(store.bindExecution("root", "workspace", binding).ok, true, "persist before contacting owner start");
    const ownerDir = path.join(owners, binding.identity.ownerId);
    const worker = path.join(__dirname, "..", "runtime", "fixtures", "departmentexecutionownerworker.js");
    const owner = fork(worker, ["owner", ownerDir, binding.identity.ownerId, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const closed = once(owner, "close");
    try {
      const [ready] = await once(owner, "message"); assert.deepEqual(ready, { ready: true });
      const client = new DepartmentExecutionOwnerClient(ownerDir);
      assert.equal((await client.startExecution(binding.identity)).status, "live");
      const recovered = new DepartmentExecutionRecovery(store, owners, async () => true).observeAttempt(task, attempt);
      assert.ok(recovered);
      if (mode === "ok") await recovered.done;
      else await assert.rejects(recovered.done, /cleanup-observation-unknown/);
      assert.equal(fs.readFileSync(path.join(ownerDir, "spawn-count.txt"), "utf8").trim(), binding.identity.executionId);
      assert.equal((await client.startExecution(binding.identity)).status, mode === "ok" ? "cleaned" : "unknown");
      assert.equal(fs.readFileSync(path.join(ownerDir, "spawn-count.txt"), "utf8").trim().split("\n").length, 1);
      owner.send({ shutdown: true }); const [code] = await closed; assert.equal(code, 0);
      const lost = new DepartmentExecutionRecovery(store, owners, async () => true).observeAttempt(task, attempt);
      assert.ok(lost); await assert.rejects(lost.done, /owner-unreachable/);
      const state = store.read("root", "workspace"); assert.ok(state.ok && state.value);
      assert.equal(state.value.capacity.employees.length, 2, "observer does not release either attempt lease");
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) {
        // Fixed fixture only. No signals or process enumeration touch user runs.
        owner.kill(); await closed;
      }
    }
  });
}
