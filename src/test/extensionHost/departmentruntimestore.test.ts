import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { DepartmentRuntimeStore, type DepartmentStoredRuntime } from "../../extensionHost/departmentruntimestore";
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
