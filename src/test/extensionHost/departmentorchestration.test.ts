import test = require("node:test");
import assert = require("node:assert/strict");
import { isDepartmentRuntimeSnapshot } from "../../extensionHost/departmentruntimestate";
import { DepartmentCapacityPool } from "../../departmentcapacity";

test("runtime recovery rejects duplicate task/module/message identities and foreign collaboration roots", () => {
  const member = { taskId: "leader", leaderSubtaskId: "module", status: "running" };
  const message = { id: "message", rootTaskId: "root", sourceLeaderTaskId: "leader", targetLeaderTaskId: "leader", body: "help", status: "pending" };
  const saved = { version: 1, rootTaskId: "root", stopping: false, leaders: [member], collaborations: [message] };
  assert.equal(isDepartmentRuntimeSnapshot(saved, "root"), true);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, leaders: [member, member] }, "root"), false);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, leaders: [member, { ...member, taskId: "other" }] }, "root"), false);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, collaborations: [message, message] }, "root"), false);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, collaborations: [{ ...message, rootTaskId: "foreign" }] }, "root"), false);
  assert.equal(isDepartmentRuntimeSnapshot({ ...saved, startingModules: ["module"] }, "root"), false);
});

test("per-root restore validates atomically, preserves other roots and old release handles cannot release successors", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const other = await pool.acquireLeader("other", "active");
  const old = await pool.acquireEmployee("root", "leader", "attempt"); old!.release();
  const identity = JSON.stringify(["leader", "attempt"]);
  const snapshot = { rootTaskId: "root", maxLeaders: 1, maxEmployees: 0, leaders: ["module"], employees: [identity], employeeOverflow: [identity] };
  const before = pool.snapshot();
  assert.throws(() => pool.restoreRoot({ ...snapshot, employeeOverflow: [identity, identity] }));
  assert.deepEqual(pool.snapshot(), before);
  const leases = pool.restoreRoot(snapshot);
  assert.equal(pool.snapshot("other")[0].leaders.length, 1);
  old!.release();
  assert.equal(pool.snapshot("root")[0].employees.length, 1);
  assert.equal(pool.getEmployeeCapacity("root", "leader")!.leaderOverflowActive, true);
  assert.throws(() => pool.restoreRoot(snapshot));
  leases.forEach((lease) => lease.release()); other!.release();
  assert.equal(pool.clearRoot("root"), true);
});
