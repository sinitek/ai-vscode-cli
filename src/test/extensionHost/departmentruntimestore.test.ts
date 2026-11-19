import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { DepartmentRuntimeStore, type DepartmentStoredRuntime } from "../../extensionHost/departmentruntimestore";
import { createDepartmentEmployeeAllocation } from "../../departmentemployeeallocation";
import { createDepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import { DepartmentOwnershipSourceLifecycleHost } from "../../extensionHost/departmentownershipsourcelifecycle";
import { DepartmentOwnershipIndex } from "../../extensionHost/departmentOwnershipIndex";
import { ledgerSetup } from "./fixtures/departmentleaderexecutionfixture";
import { departmentRecords } from "../loop/departmentGroupChatHost.fixture";
import { tryWriteLoopTaskStore, readLoopTaskStoreResult, subscribeLoopTaskStoreChanges } from "../../loopTaskStore";
const value = (): DepartmentStoredRuntime => ({ version: 1, rootTaskId: "root", workspaceKey: "workspace", runtime: createDepartmentRuntimeSnapshot("root"),
  capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: [], employees: [] } });

test("production runtime store atomically preserves versioned occupancy and overflow; invalid replacement leaves original intact", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "department-runtime-store-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new DepartmentRuntimeStore(dir), saved = value();
  saved.capacity.leaders = ["module"];
  saved.capacity.employees = [JSON.stringify(["leader", "attempt"])]; saved.capacity.employeeOverflow = [...saved.capacity.employees];
  assert.deepEqual(store.write(saved), { ok: true });
  const read = store.read("root", "workspace"); assert.deepEqual(read, { ok: true, value: saved });
  saved.capacity.employees.push("invalid"); assert.equal(store.write(saved).ok, false);
  assert.deepEqual(store.read("root", "workspace"), read);
  assert.equal(store.read("root", "another-workspace").ok, false);
  assert.deepEqual(store.read("unknown", "workspace"), { ok: true, value: null });
  assert.equal(fs.readdirSync(dir).some((file) => file.endsWith(".tmp")), false);
});

test("organization store persists two exact employee attempts for one subtask and preserves both across controller writes", async (t) => {
  const f = ledgerSetup(t);
  assert.equal(f.ledger.open(f.scope).ok, true);
  const coordinator = f.binding("leader"), first = f.binding("employee", 1), second = f.binding("employee", 2);
  if (first.identity.role === "employee" && second.identity.role === "employee") second.identity.subtaskId = first.identity.subtaskId;
  for (const binding of [coordinator, first, second]) await f.add(binding);

  const cold = new DepartmentRuntimeStore(f.storeDirectory), read = cold.read("root", "workspace");
  assert.ok(read.ok && read.value);
  assert.deepEqual(read.value.executionBindings, [coordinator, first, second]);
  assert.deepEqual(read.value.leaderExecutionSets?.[0].entries.map((entry) => entry.executionId), ["leader-1", "employee-1", "employee-2"]);

  const staleController = structuredClone(f.value);
  staleController.runtime.stopping = true;
  assert.deepEqual(cold.write(staleController), { ok: true });
  const retained = cold.read("root", "workspace");
  assert.ok(retained.ok && retained.value);
  assert.deepEqual(retained.value.executionBindings, [coordinator, first, second]);
  assert.deepEqual(retained.value.leaderExecutionSets?.[0].entries.map((entry) => entry.executionId), ["leader-1", "employee-1", "employee-2"]);
});

test("production runtime store rejects corrupt JSON and I/O failure as errors, never empty organizations", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "department-runtime-corrupt-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new DepartmentRuntimeStore(dir); assert.equal(store.write(value()).ok, true);
  fs.writeFileSync(path.join(dir, fs.readdirSync(dir)[0]), "{broken");
  assert.equal(store.read("root", "workspace").ok, false);
  assert.equal(store.write(value()).ok, false);
  assert.equal(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8"), "{broken");
  const blocked = path.join(dir, "blocked"); fs.writeFileSync(blocked, "file");
  assert.equal(new DepartmentRuntimeStore(blocked).write(value()).ok, false);
});

test("runtime store distinguishes permission errors from missing files and never overwrites unreadable history", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "department-runtime-permission-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new DepartmentRuntimeStore(dir), file = path.join(dir, Buffer.from("root").toString("hex") + ".json");
  assert.equal(store.write(value()).ok, true);
  const readFile = fs.readFileSync, bytes = readFile(file);
  t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
    if (args[0] === file) throw Object.assign(new Error("fixture-permission-denied"), { code: "EACCES" });
    return Reflect.apply(readFile, fs, args);
  });
  const read = store.read("root", "workspace");
  assert.ok(!read.ok && /permission-denied/.test(read.error));
  assert.equal(store.write(value()).ok, false);
  assert.deepEqual(store.read("missing", "workspace"), { ok: true, value: null });
  assert.deepEqual(readFile(file), bytes);
  assert.deepEqual(fs.readdirSync(dir), [path.basename(file)]);
});

for (const operation of ["openSync", "writeFileSync", "fsyncSync", "renameSync"] as const) {
  test(`runtime atomic commit preserves original bytes and reclaims its temporary file after ${operation} failure`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "department-runtime-atomic-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new DepartmentRuntimeStore(dir), file = path.join(dir, Buffer.from("root").toString("hex") + ".json");
    assert.equal(store.write(value()).ok, true);
    const bytes = fs.readFileSync(file), changed = value(); changed.runtime.stopping = true;
    const open = fs.openSync;
    let temporaryOpens = 0;
    t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
      if (args[1] === "wx") {
        temporaryOpens++; assert.equal(args[2], 0o600);
        if (operation === "openSync") throw new Error("fixture-openSync-failure");
      }
      return Reflect.apply(open, fs, args);
    });
    if (operation !== "openSync") t.mock.method(fs, operation, () => { throw new Error(`fixture-${operation}-failure`); });
    const result = store.write(changed);
    assert.ok(!result.ok && result.error.includes(`fixture-${operation}-failure`));
    assert.equal(temporaryOpens, 1, "commit must reach exclusive temporary-file creation");
    // Restore before readFileSync, which itself uses openSync internally.
    t.mock.restoreAll();
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.deepEqual(fs.readdirSync(dir), [path.basename(file)]);
    assert.deepEqual(store.read("root", "workspace"), { ok: true, value: value() });
    assert.equal(store.write(changed).ok, true, "a later call must cold-read and may retry safely");
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });
}

test("ownership source requires an actual authority and explicit rebuild after revocation", () => {
  const absent = new DepartmentOwnershipSourceLifecycleHost(null);
  assert.equal(absent.prepareRebuild(), false); assert.equal(absent.isCurrent(), false); assert.match(absent.issue!, /外部写入/); absent.dispose();
  let current = true, revocation: (() => void) | null = null, invalidations = 0;
  const source = new DepartmentOwnershipSourceLifecycleHost({ isCurrent: () => current, subscribeRevocation: (cb) => { revocation = cb; return { dispose: () => { revocation = null; } }; } });
  source.subscribe(() => { invalidations++; });
  assert.equal(source.isCurrent(), false); assert.equal(source.prepareRebuild(), true); assert.equal(source.isCurrent(), true);
  source.beforeSourceChange(); assert.equal(source.isCurrent(), false); assert.equal(invalidations, 1);
  assert.equal(source.prepareRebuild(), true);
  current = false; (revocation as unknown as () => void)();
  assert.equal(source.isCurrent(), false); assert.equal(source.prepareRebuild(), false);
  current = true; assert.equal(source.isCurrent(), false, "incremental success cannot heal revocation");
  assert.equal(source.prepareRebuild(), true); source.dispose(); assert.equal(source.isCurrent(), false); assert.equal(revocation, null);
});

test("production source lifecycle revokes real stored index authorization before import and requires complete explicit rebuild", (t) => {
  if (process.env.DEPARTMENT_SOURCE_LIFECYCLE_ISOLATED !== "1") {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-source-home-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const result = require("node:child_process").spawnSync(process.execPath, ["--test", "--test-name-pattern=production source lifecycle", __filename], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, DEPARTMENT_SOURCE_LIFECYCLE_ISOLATED: "1" },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-source-composition-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = departmentRecords(), file = path.join(directory, "tasks.json");
  for (const task of data.records.values()) { task.createdAt = task.updatedAt = Date.now(); task.taskStoreFile = file; }
  let authority = true, revoke: (() => void) | null = null, scans = 0;
  const source = new DepartmentOwnershipSourceLifecycleHost({ isCurrent: () => authority,
    subscribeRevocation: (listener) => { revoke = listener; return { dispose: () => { revoke = null; } }; } });
  const index = new DepartmentOwnershipIndex({ lifecycle: source, listFiles: () => { scans++; return [file]; },
    readFile: (name) => { const result = readLoopTaskStoreResult(name, true, true); return result.ok ? result.store.tasks : null; },
    subscribe: subscribeLoopTaskStoreChanges });
  t.after(() => { index.dispose(); source.dispose(); });
  assert.equal(tryWriteLoopTaskStore(file, { tasks: [...data.records.values()] }), true);
  assert.equal(index.rebuild(), false); assert.equal(source.prepareRebuild(), true); assert.equal(index.rebuild(), true);
  assert.ok(index.readDepartmentLeaderTaskIds(data.root.id, "module-A")?.includes(data.leader.id));
  for (let i = 0; i < 10; i++) assert.ok(index.readTaskRecord(data.root.id));
  assert.equal(scans, 1);
  source.beforeSourceChange();
  assert.equal(index.readTaskRecord(data.root.id), null);
  assert.equal(tryWriteLoopTaskStore(file, { tasks: [...data.records.values()] }), true);
  assert.equal(index.readDepartmentLeaderTaskIds(data.root.id, "module-A"), null, "successful write cannot heal invalidation");
  assert.equal(source.prepareRebuild(), true); assert.equal(index.rebuild(), true);
  authority = false; (revoke as unknown as () => void)();
  assert.equal(index.readTaskRecord(data.root.id), null); assert.equal(source.prepareRebuild(), false);
  authority = true; assert.equal(index.rebuild(), false);
  assert.equal(source.prepareRebuild(), true); assert.equal(index.rebuild(), true);
});

test("allocation store initializes only via explicit lifecycle, preserves saved state across stale controllers and serializes CAS", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "department-allocation-store-"));
  try {
    const store = new DepartmentRuntimeStore(dir), old = value();
    old.runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", status: "running", generation: 1 });
    assert.equal(store.write(old).ok, true);
    assert.equal(store.read("root", "workspace").ok, true);
    assert.equal(store.saveEmployeeLimit("root", "workspace", { leaderTaskId: "leader", employeeLimit: 2, expectedRevision: 0 }).ok, false);
    assert.equal(store.synchronizeEmployeeAllocation("root", "workspace").ok, true);
    const read = store.read("root", "workspace"); assert.ok(read.ok && read.value?.employeeAllocation);
    const revision = read.value.employeeAllocation.revision;
    assert.equal(store.saveEmployeeLimit("root", "workspace", { leaderTaskId: "leader", employeeLimit: 2, expectedRevision: revision }).ok, true);
    assert.equal(store.saveEmployeeLimit("root", "workspace", { leaderTaskId: "leader", employeeLimit: 3, expectedRevision: revision }).ok, false);
    assert.equal(store.write(old).ok, true, "legacy controller omits allocation but cannot drop it");
    const saved = store.read("root", "workspace"); assert.ok(saved.ok && saved.value?.employeeAllocation);
    assert.equal(saved.value.employeeAllocation.leaders[0].manualLimit, 2);
    assert.equal(saved.value.employeeAllocation.revision, revision + 1);
    assert.equal(store.write({ ...old, employeeAllocation: read.value.employeeAllocation }).ok, false, "stale explicit allocation cannot overwrite a later save");
    assert.equal(store.saveEmployeeLimit("root", "workspace", { leaderTaskId: "foreign", employeeLimit: 1, expectedRevision: revision + 1 }).ok, false);
    assert.equal(store.synchronizeEmployeeAllocation("root", "foreign").ok, false);
    const cold = new DepartmentRuntimeStore(dir).read("root", "workspace"); assert.deepEqual(cold, saved);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("allocation shrink clamps manual desired, retains historical applied and refuses corrupt policy rather than defaulting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "department-allocation-shrink-"));
  try {
    const store = new DepartmentRuntimeStore(dir), old = value();
    old.runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", status: "running", generation: 1 });
    assert.equal(store.write(old).ok, true); assert.equal(store.synchronizeEmployeeAllocation("root", "workspace").ok, true);
    assert.equal(store.saveEmployeeLimit("root", "workspace", { leaderTaskId: "leader", employeeLimit: 12, expectedRevision: 1 }).ok, true);
    const before = { rootTaskId: "root", leaderTaskId: "leader", globalActiveEmployees: 0, activeEmployees: 0, leaderOverflowActive: false };
    assert.equal(store.beginEmployeeAdmission("workspace", before).ok, true);
    old.capacity.maxEmployees = 6;
    assert.equal(store.write(old).ok, true); assert.equal(store.synchronizeEmployeeAllocation("root", "workspace").ok, true);
    const shrunk = store.read("root", "workspace"); assert.ok(shrunk.ok && shrunk.value?.employeeAllocation);
    assert.deepEqual(shrunk.value.employeeAllocation.leaders[0], { leaderTaskId: "leader", manualLimit: 6, appliedLimit: 12 });
    const refused = store.beginEmployeeAdmission("workspace", { ...before, activeEmployees: 6, globalActiveEmployees: 6, leaderOverflowActive: true });
    assert.ok(refused.ok && !refused.evaluation.eligible);
    const after = store.read("root", "workspace"); assert.ok(after.ok && after.value?.employeeAllocation);
    assert.equal(after.value.employeeAllocation.leaders[0].appliedLimit, 6);
    const file = path.join(dir, Buffer.from("root").toString("hex") + ".json");
    fs.writeFileSync(file, JSON.stringify({ ...after.value, employeeAllocation: { ...after.value.employeeAllocation, revision: "4" } }));
    assert.equal(store.read("root", "workspace").ok, false);
    assert.equal(store.write(old).ok, false); assert.equal(store.synchronizeEmployeeAllocation("root", "workspace").ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/** A valid persisted history can outgrow maxLeaders: completed members are retained. */
function allocationHistory(t: import("node:test").TestContext, size: number, revision = 17) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "department-allocation-history-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new DepartmentRuntimeStore(dir), saved = value();
  saved.runtime.leaders = Array.from({ length: size }, (_, i) => ({
    taskId: `history-${i}`, leaderSubtaskId: `module-${i}`, status: "completed", generation: 1,
  }));
  saved.employeeAllocation = createDepartmentEmployeeAllocation("root", saved.capacity, saved.runtime.leaders.map((m) => m.taskId));
  saved.employeeAllocation.revision = revision;
  saved.employeeAllocation.leaders[0] = { leaderTaskId: "history-0", manualLimit: 12, appliedLimit: 18 };
  const file = path.join(dir, Buffer.from("root").toString("hex") + ".json");
  fs.writeFileSync(file, JSON.stringify(saved));
  return { store, saved, file };
}

test("allocation history synchronization scales linearly for unchanged history and one new member without redundant writes", (t) => {
  // Count actual member-field validation work across all copies, not elapsed time
  // or calls to a particular registration helper. File parsing/validation stays real.
  const keys = Object.keys, rename = fs.renameSync;
  let inspections = 0, writes = 0;
  t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => { writes++; return rename(...args); });
  const workloads = [256, 1024].map((size) => {
    const { store, saved, file } = allocationHistory(t, size), original = fs.readFileSync(file);
    const measure = (repeats: number) => {
      inspections = 0;
      // Avoid mock call recording: retaining every argument would itself grow
      // quadratically on the unfixed implementation and distort this probe.
      Object.keys = ((object: object) => {
        const result = keys(object);
        if (result.includes("leaderTaskId") && result.includes("manualLimit") && result.includes("appliedLimit")) inspections++;
        return result;
      }) as typeof Object.keys;
      try {
        for (let i = 0; i < repeats; i++) assert.deepEqual(store.synchronizeEmployeeAllocation("root", "workspace"), { ok: true });
        return inspections;
      } finally { Object.keys = keys; }
    };
    writes = 0;
    const unchanged = measure(3);
    assert.equal(writes, 0); assert.deepEqual(fs.readFileSync(file), original);
    saved.runtime.leaders.push({ taskId: "new-leader", leaderSubtaskId: "new-module", status: "running", generation: 1 });
    assert.equal(store.write(saved).ok, true);
    writes = 0;
    const added = measure(1);
    assert.equal(writes, 1, "one real membership change commits once");
    const read = store.read("root", "workspace"); assert.ok(read.ok && read.value?.employeeAllocation);
    const allocation = read.value.employeeAllocation;
    assert.equal(allocation.revision, 18);
    assert.deepEqual(allocation.leaders.slice(0, size), saved.employeeAllocation!.leaders);
    assert.deepEqual(allocation.leaders[size], { leaderTaskId: "new-leader", manualLimit: null, appliedLimit: null });
    const addedBytes = fs.readFileSync(file);
    writes = 0;
    const repeated = measure(2);
    assert.equal(writes, 0); assert.deepEqual(fs.readFileSync(file), addedBytes);
    // Configuration changes still use the domain clamp and keep historical applied.
    read.value.capacity.maxEmployees = 6; read.value.capacity.maxLeaders = 3;
    assert.equal(store.write(read.value).ok, true);
    assert.equal(store.synchronizeEmployeeAllocation("root", "workspace").ok, true);
    const shrunk = store.read("root", "workspace"); assert.ok(shrunk.ok && shrunk.value?.employeeAllocation);
    assert.equal(shrunk.value.employeeAllocation.revision, 19);
    assert.equal(shrunk.value.employeeAllocation.maxLeaders, 3);
    assert.equal(shrunk.value.employeeAllocation.maxEmployees, 6);
    assert.deepEqual(shrunk.value.employeeAllocation.leaders[0], { leaderTaskId: "history-0", manualLimit: 6, appliedLimit: 18 });
    return { unchanged, added, repeated };
  });
  t.diagnostic(`member-field validations for histories 256/1024: ${JSON.stringify(workloads)}`);
  for (const stage of ["unchanged", "added", "repeated"] as const) {
    assert.ok(workloads[0][stage] > 0, "cold persisted members must still be validated");
    assert.ok(workloads[1][stage] <= workloads[0][stage] * 5,
      `${stage}: quadrupling history exceeded linear work allowance: ${JSON.stringify(workloads)}`);
  }
});

test("allocation history synchronization cold-validates each operation and preserves bytes on revision exhaustion", (t) => {
  const { store, saved, file } = allocationHistory(t, 256, Number.MAX_SAFE_INTEGER);
  const original = fs.readFileSync(file);
  assert.equal(store.synchronizeEmployeeAllocation("root", "workspace").ok, true);
  assert.deepEqual(fs.readFileSync(file), original);
  saved.runtime.leaders.push({ taskId: "new-leader", leaderSubtaskId: "new-module", status: "running", generation: 1 });
  assert.equal(store.write(saved).ok, true);
  const added = fs.readFileSync(file);
  const refused = store.synchronizeEmployeeAllocation("root", "workspace");
  assert.ok(!refused.ok && /revision overflow/.test(refused.error));
  assert.deepEqual(fs.readFileSync(file), added);
  saved.runtime.leaders.pop(); saved.capacity.maxEmployees = 6;
  assert.equal(store.write(saved).ok, true);
  const changed = fs.readFileSync(file);
  assert.equal(store.synchronizeEmployeeAllocation("root", "workspace").ok, false);
  assert.deepEqual(fs.readFileSync(file), changed);
  // An external edit after successful reads must be validated, not served from a cache.
  saved.employeeAllocation!.leaders.push(saved.employeeAllocation!.leaders[0]);
  fs.writeFileSync(file, JSON.stringify(saved));
  const corrupt = fs.readFileSync(file);
  assert.equal(store.synchronizeEmployeeAllocation("root", "workspace").ok, false);
  assert.deepEqual(fs.readFileSync(file), corrupt);
});
