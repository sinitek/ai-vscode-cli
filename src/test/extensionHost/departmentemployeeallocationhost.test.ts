import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { DepartmentRuntimeStore } from "../../extensionHost/departmentruntimestore";
import { createDepartmentEmployeeAllocationHost } from "../../extensionHost/departmentemployeeallocationhost";
import { createDepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import { DepartmentCapacityPool } from "../../departmentcapacity";
import { departmentRecords, fixtureDepartmentLeaderTaskIds } from "../loop/departmentGroupChatHost.fixture";

function setup(t: test.TestContext) {
  const data = departmentRecords(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "allocation-host-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new DepartmentRuntimeStore(dir), capacity = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const runtime = createDepartmentRuntimeSnapshot(data.root.id);
  runtime.leaders.push({ taskId: data.leader.id, leaderSubtaskId: "module-A", status: "running", generation: 1 });
  assert.equal(store.write({ version: 1, rootTaskId: data.root.id, workspaceKey: data.root.workspaceKey, runtime,
    capacity: { rootTaskId: data.root.id, maxLeaders: 4, maxEmployees: 20, leaders: ["module-A"], employees: [] } }).ok, true);
  let workspace = data.root.workspaceKey, index = true;
  const host = createDepartmentEmployeeAllocationHost({ store, capacity, workspaceKey: () => workspace,
    readTask: (id) => data.records.get(id) ?? null, runtimeSnapshot: () => runtime, current: () => true,
    readLeaderTaskIds: (root, module) => index ? fixtureDepartmentLeaderTaskIds(data.records, root, module) : null });
  return { ...data, store, capacity, runtime, host,
    workspace: (value: string) => { workspace = value; }, index: (value: boolean) => { index = value; } };
}

test("allocation reader never migrates legacy policy or treats absent live leases as zero", async (t) => {
  const h = setup(t);
  assert.equal(h.host.readDepartmentEmployeeAllocation(h.root.id), null);
  const old = h.store.read(h.root.id, h.root.workspaceKey); assert.ok(old.ok && old.value);
  assert.equal(old.value.employeeAllocation, undefined);
  assert.equal(h.store.synchronizeEmployeeAllocation(h.root.id, h.root.workspaceKey).ok, true);
  const unknown = h.host.readDepartmentEmployeeAllocation(h.root.id)!;
  assert.equal(unknown.leaders[0].activeEmployees, null);
  assert.equal(unknown.leaders[0].appliedLimit, null);
  assert.equal(h.host.readEmployeeCapacity(h.root.id, h.leader.id), null);
  const leaderLease = await h.capacity.acquireLeader(h.root.id, "module-A"); assert.ok(leaderLease);
  const known = h.host.readEmployeeCapacity(h.root.id, h.leader.id)!;
  assert.deepEqual(known.leaderAllocation, { revision: 1, source: "default", desiredLimit: 5,
    appliedLimit: null, activeEmployees: 0, availableEmployees: 5, pending: true });
  leaderLease.release();
});

test("allocation host refuses invalidated or ambiguous authoritative membership, foreign workspace and cross leader/root writes", (t) => {
  const h = setup(t); assert.equal(h.store.synchronizeEmployeeAllocation(h.root.id, h.root.workspaceKey).ok, true);
  const request = { requestId: "save", leaderTaskId: h.leader.id, employeeLimit: 3, expectedRevision: 1 };
  h.index(false); assert.equal(h.host.updateDepartmentEmployeeLimit(h.root, request).ok, false);
  assert.equal(h.host.readEmployeeCapacity(h.root.id, h.leader.id), null);
  h.index(true); h.workspace("foreign"); assert.equal(h.host.updateDepartmentEmployeeLimit(h.root, request).ok, false);
  h.workspace(h.root.workspaceKey);
  assert.equal(h.host.updateDepartmentEmployeeLimit(h.leader, request).ok, false);
  assert.equal(h.host.updateDepartmentEmployeeLimit(h.root, { ...request, leaderTaskId: h.other.id }).ok, false);
  const duplicate = { ...h.leader, id: "ambiguous" }; h.records.set(duplicate.id, duplicate);
  assert.equal(h.host.updateDepartmentEmployeeLimit(h.root, request).ok, false);
  h.records.delete(duplicate.id);
  const saved = h.host.updateDepartmentEmployeeLimit(h.root, request); assert.ok(saved.ok);
  assert.equal(saved.allocation.revision, 2); assert.equal(saved.allocation.leaders[0].desiredLimit, 3);
  assert.equal(h.host.updateDepartmentEmployeeLimit(h.root, { ...request, requestId: "same-revision" }).ok, false);
});

test("allocation save I/O failure never returns success or edits durable quota", (t) => {
  const h = setup(t); assert.equal(h.store.synchronizeEmployeeAllocation(h.root.id, h.root.workspaceKey).ok, true);
  const before = h.store.read(h.root.id, h.root.workspaceKey);
  t.mock.method(fs, "renameSync", () => { throw new Error("allocation-save-failure"); });
  const result = h.host.updateDepartmentEmployeeLimit(h.root, { requestId: "save", leaderTaskId: h.leader.id, employeeLimit: 2, expectedRevision: 1 });
  assert.ok(!result.ok && result.error.includes("allocation-save-failure"));
  assert.deepEqual(h.store.read(h.root.id, h.root.workspaceKey), before);
});
