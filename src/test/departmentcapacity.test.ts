import test = require("node:test");
import assert = require("node:assert/strict");
import { DepartmentCapacityPool } from "../departmentcapacity";

test("immediate overflow admission atomically grants one competing request and rejects the rest without a waiter", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 0 });
  const requests = ["one", "two", "three"].map((id) => pool.tryAcquireEmployeeWithOverflow("root", "leader", id));
  assert.equal(pool.snapshot("root")[0].employees.length, 1, "grant linearizes before the promises resume");
  const [one, two, three] = await Promise.all(requests);
  assert.ok(one); assert.equal(two, null); assert.equal(three, null);
  const again = await pool.tryAcquireEmployeeWithOverflow("root", "leader", "one");
  assert.equal(again?.identity, one.identity);
  assert.equal(pool.snapshot("root")[0].employees.length, 1);
  one.release();
  assert.equal(pool.snapshot("root")[0].employees.length, 0, "rejected requests were never queued");
  again?.release();
  assert.equal(pool.snapshot("root")[0].employees.length, 0);
});

test("immediate overflow admission preserves waiting identity idempotence and cancellation", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 0 });
  const held = await pool.tryAcquireEmployeeWithOverflow("root", "leader", "held");
  const controller = new AbortController();
  const waiting = pool.acquireEmployeeWithOverflow("root", "leader", "waiting", undefined, controller.signal);
  assert.equal(pool.tryAcquireEmployeeWithOverflow("root", "leader", "waiting"), waiting);
  controller.abort();
  assert.equal(await waiting, null);
  assert.equal(await pool.tryAcquireEmployeeWithOverflow("root", "leader", "cancelled", undefined, controller.signal), null);
  held!.release();
  assert.equal(pool.snapshot("root")[0].employees.length, 0);
  const next = await pool.tryAcquireEmployeeWithOverflow("root", "leader", "next");
  assert.ok(next); next.release();
});

test("immediate overflow admission permits regular balance after expansion without relabelling the outstanding overflow", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 1 });
  const regular = await pool.tryAcquireEmployeeWithOverflow("root", "leader", "regular");
  const overflow = await pool.tryAcquireEmployeeWithOverflow("root", "leader", "overflow");
  regular!.release();
  assert.equal(await pool.tryAcquireEmployeeWithOverflow("root", "leader", "at-limit"), null);
  const later = await pool.tryAcquireEmployeeWithOverflow("root", "leader", "expanded", { maxLeaders: 1, maxEmployees: 3 });
  assert.ok(later);
  assert.deepEqual(pool.snapshot("root")[0].employeeOverflow, [overflow!.identity]);
  assert.equal(pool.getEmployeeCapacity("root", "leader")!.availableEmployees, 1);
  later.release(); overflow!.release();
});

test("immediate overflow admission isolates groups and roots and does not alter normal waiting APIs", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 0 });
  const first = await pool.tryAcquireEmployeeWithOverflow("root", "a", "attempt");
  const otherGroup = await pool.tryAcquireEmployeeWithOverflow("root", "b", "attempt");
  const otherRoot = await pool.tryAcquireEmployeeWithOverflow("other", "a", "attempt");
  assert.ok(first); assert.ok(otherGroup); assert.ok(otherRoot);
  const waiting = pool.acquireEmployeeWithOverflow("root", "a", "queued");
  let settled = false;
  void waiting.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  first.release();
  const granted = await waiting; assert.ok(granted);
  assert.equal(pool.snapshot("root")[0].employees.length, 2);
  assert.equal(pool.snapshot("other")[0].employees.length, 1);
  granted.release(); otherGroup.release(); otherRoot.release();
});

test("immediate overflow admission rejects invalid identities without creating a pool", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 1 });
  for (const [root, leader, attempt] of [["", "l", "a"], ["r", "", "a"], ["r", "l", ""]]) {
    assert.equal(await pool.tryAcquireEmployeeWithOverflow(root, leader, attempt), null);
  }
  assert.deepEqual(pool.snapshot(), []);
});
