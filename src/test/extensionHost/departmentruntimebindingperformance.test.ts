import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DepartmentRuntimeStore, type DepartmentStoredRuntime } from "../../extensionHost/departmentruntimestore";
import * as runtimeState from "../../extensionHost/departmentruntimestate";
import type { DepartmentExecutionBinding } from "../../extensionHost/departmentruntimestate";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";

/** Many completed members and generations, with one current leased execution.
 * All history remains on disk; this fixture never shrinks the binding set. */
function history(memberCount = 1024, generations = 4) {
  const selection: DepartmentExecutionSelection = { version: 1, cli: "codex", role: "employee", configId: "profile",
    revision: "revision-1", model: "employee-model", thinkingMode: "off", openCodeVariant: null };
  const fingerprints = fingerprintDepartmentExecutionSelection(selection);
  const binding = (member: number, generation: number): DepartmentExecutionBinding => ({
    identity: { version: 1, workspace: "workspace", rootTaskId: "root", leaderTaskId: `leader-${member}`, moduleId: `module-${member}`,
      role: "employee", generation, cli: "codex", session: { state: "bound", id: `session-${member}-${generation}` },
      ownerId: "owner", executionId: `execution-${member}-${generation}`, subtaskId: "subtask", attemptId: `attempt-${generation}`, ...fingerprints },
    selection: { ...selection }, requirements: { processTerminal: true, turnTerminal: false, streams: true, runner: true,
      executionRoot: true, links: true, temp: true, tab: true },
  });
  const next = binding(memberCount - 1, generations + 1);
  const value: DepartmentStoredRuntime = { version: 1, rootTaskId: "root", workspaceKey: "workspace",
    runtime: runtimeState.createDepartmentRuntimeSnapshot("root"), executionBindings: [],
    capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: [next.identity.moduleId],
      employees: [JSON.stringify([next.identity.leaderTaskId, "attempt-" + (generations + 1)])] } };
  for (let member = 0; member < memberCount; member++) {
    const current = member === memberCount - 1;
    value.runtime.leaders.push({ taskId: `leader-${member}`, leaderSubtaskId: `module-${member}`,
      generation: current ? generations + 1 : generations, status: current ? "running" : "completed" });
    for (let generation = 1; generation <= generations; generation++) value.executionBindings!.push(binding(member, generation));
  }
  return { value, next };
}
function setup(t: import("node:test").TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-binding-history-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { store: new DepartmentRuntimeStore(directory), file: path.join(directory, Buffer.from("root").toString("hex") + ".json") };
}
function load(store: DepartmentRuntimeStore): DepartmentStoredRuntime {
  const read = store.read("root", "workspace"); assert.ok(read.ok && read.value); return read.value;
}

test("large binding histories validate in bounded passes and bind uses one cold read without revalidating history", (t) => {
  const { store, file } = setup(t), { value, next } = history();
  assert.equal(store.write(value).ok, true);
  const count = value.executionBindings!.length;
  let reads = 0, validations = 0;
  const readFile = fs.readFileSync, validateBinding = runtimeState.isDepartmentExecutionBinding;
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    if (args[0] === file) reads++;
    return Reflect.apply(readFile, fs, args);
  });
  t.mock.method(runtimeState, "isDepartmentExecutionBinding", (value: unknown) => {
    validations++; return validateBinding(value);
  });
  assert.equal(store.write(value).ok, true);
  assert.equal(reads, 1, "independent writes cold-read the current file exactly once");
  assert.ok(validations <= 2 * count + 2, `full checks must stay within two linear passes, observed ${validations}`);
  reads = validations = 0;
  assert.equal(store.bindExecution("root", "workspace", next).ok, true);
  assert.equal(reads, 1, "binding must not delegate to a second cold-reading write");
  assert.ok(validations <= count + 2, `binding must validate history only once, observed ${validations}`);
  const saved = load(store);
  assert.deepEqual(saved.executionBindings, [...value.executionBindings!, next], "all identity history and order survive append");
  assert.deepEqual(saved.capacity, value.capacity, "binding does not grant or release capacity");
  assert.equal(store.bindExecution("root", "workspace", value.executionBindings![0]).ok, true, "historical exact identity remains idempotent");
  const bytes = readFile(file);
  assert.equal(store.bindExecution("root", "workspace", structuredClone(next)).ok, true);
  assert.deepEqual(readFile(file), bytes);
  next.identity.ownerId = "caller-mutated";
  value.executionBindings![0].requirements.tab = false;
  saved.executionBindings!.pop(); saved.runtime.leaders[0].taskId = "caller-mutated";
  assert.deepEqual(readFile(file), bytes, "input and read-result mutations cannot change committed data");
  assert.notEqual(load(store).runtime.leaders[0].taskId, "caller-mutated");
});

test("large history retains legacy writes and rejects tail deletion, full identity/policy changes and slot conflicts atomically", (t) => {
  const { store, file } = setup(t), { value } = history();
  assert.equal(store.write(value).ok, true);
  const legacy = structuredClone(value); delete legacy.executionBindings; legacy.runtime.stopping = true;
  assert.equal(store.write(legacy).ok, true);
  assert.deepEqual(load(store).executionBindings, value.executionBindings);
  const original = fs.readFileSync(file), base = load(store);
  const rejected = (change: (value: DepartmentStoredRuntime, tail: DepartmentExecutionBinding) => void): void => {
    const changed = structuredClone(base), tail = changed.executionBindings![changed.executionBindings!.length - 1];
    change(changed, tail);
    assert.equal(store.write(changed).ok, false);
    assert.deepEqual(fs.readFileSync(file), original, "rejected tail edits must not change any original bytes");
  };
  rejected((value) => { value.executionBindings!.pop(); });
  rejected((_, tail) => { tail.identity.ownerId = "different-owner"; });
  rejected((_, tail) => { tail.requirements.tab = false; });
  rejected((_, tail) => {
    tail.selection.revision = "new-revision"; Object.assign(tail.identity, fingerprintDepartmentExecutionSelection(tail.selection));
  });
  rejected((value, tail) => { const conflict = structuredClone(tail); conflict.identity.executionId = "conflicting-execution"; value.executionBindings!.push(conflict); });
  rejected((value, tail) => { const duplicate = structuredClone(tail); duplicate.identity.generation--; value.executionBindings!.push(duplicate); });
  rejected((_, tail) => { tail.identity.moduleId = "module-0"; });
  rejected((_, tail) => { tail.identity.rootTaskId = "other-root"; });
  rejected((_, tail) => { tail.identity.workspace = "other-workspace"; });
  rejected((_, tail) => { tail.identity.session = { state: "unbound" }; });
  rejected((_, tail) => { tail.selection.model = "fingerprint-mismatch"; });
  // A replacement on disk between calls must be seen, even by this same store.
  const corrupt = structuredClone(base); corrupt.executionBindings![corrupt.executionBindings!.length - 1].selection.model = "bad-tail";
  const corruptBytes = JSON.stringify(corrupt); fs.writeFileSync(file, corruptBytes);
  assert.equal(store.read("root", "workspace").ok, false);
  assert.equal(store.write(base).ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), corruptBytes, "cold validation cannot heal a bad tail by overwriting it");
});

test("incremental binding still validates exact member pair, current generation, leases, root, workspace and immutable duplicates", (t) => {
  const { store, file } = setup(t), { value, next } = history(2, 2);
  assert.equal(store.write(value).ok, true);
  const original = fs.readFileSync(file);
  const rejected = (change: (binding: DepartmentExecutionBinding) => void): void => {
    const changed = structuredClone(next); change(changed);
    assert.equal(store.bindExecution("root", "workspace", changed).ok, false);
    assert.deepEqual(fs.readFileSync(file), original);
  };
  rejected((binding) => { binding.identity.moduleId = "module-0"; });
  rejected((binding) => { binding.identity.rootTaskId = "other-root"; });
  rejected((binding) => { binding.identity.workspace = "other-workspace"; });
  rejected((binding) => { binding.identity.generation--; });
  rejected((binding) => { if (binding.identity.role === "employee") binding.identity.attemptId = "unleased-attempt"; });
  rejected((binding) => { binding.identity.session = { state: "unbound" }; });
  rejected((binding) => { binding.selection.model = "changed-without-fingerprint"; });
  assert.equal(store.read("root", "other-workspace").ok, false);
  assert.equal(store.bindExecution("root", "other-workspace", next).ok, false);
  assert.equal(store.bindExecution("other-root", "workspace", next).ok, false);
  assert.equal(store.bindExecution("root", "workspace", next).ok, true);
  const appended = fs.readFileSync(file);
  const conflict = structuredClone(next); conflict.identity.executionId = "different-execution";
  assert.equal(store.bindExecution("root", "workspace", conflict).ok, false, "same slot and generation is fenced");
  const policy = structuredClone(next); policy.requirements.tab = false;
  assert.equal(store.bindExecution("root", "workspace", policy).ok, false);
  const owner = structuredClone(next); owner.identity.ownerId = "other-owner";
  assert.equal(store.bindExecution("root", "workspace", owner).ok, false);
  assert.deepEqual(fs.readFileSync(file), appended);
  const unleased = load(store); unleased.capacity.leaders = []; unleased.capacity.employees = [];
  assert.equal(store.write(unleased).ok, true);
  assert.equal(store.bindExecution("root", "workspace", next).ok, true, "exact persisted history remains idempotent after leases end");
  const noLease = structuredClone(next); noLease.identity.executionId = "unleased-execution";
  assert.equal(store.bindExecution("root", "workspace", noLease).ok, false);
});

test("binding commit failure preserves history and a later cold-read retry appends exactly once", (t) => {
  const { store, file } = setup(t), { value, next } = history(2, 2);
  assert.equal(store.write(value).ok, true);
  const bytes = fs.readFileSync(file);
  t.mock.method(fs, "renameSync", () => { throw new Error("fixture-binding-rename-failure"); });
  const result = store.bindExecution("root", "workspace", next);
  assert.ok(!result.ok && /binding-rename-failure/.test(result.error));
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)]);
  t.mock.restoreAll();
  assert.equal(store.bindExecution("root", "workspace", next).ok, true);
  assert.deepEqual(load(store).executionBindings, [...value.executionBindings!, next]);
});
