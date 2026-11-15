import test = require("node:test");
import assert = require("node:assert/strict");
import { normalizeDepartmentMetadata, readDepartmentMetadataField } from "../../department";
import { DepartmentCapacityPool } from "../../departmentcapacity";
import { validateDepartmentCollaboration } from "../../departmentcollaboration";
import { buildDepartmentRolePrompt } from "../../departmentprompts";

const metadata = {
  version: 1, rootTaskId: "root", parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "产品",
  routes: { director: { cli: "codex", configId: "profile", thinkingMode: "high" }, leader: { cli: "opencode", openCodeVariant: "reasoning" }, employee: { cli: "claude" } },
  limits: { maxLeaders: 4, maxEmployees: 20 },
} as const;

test("normalizes valid department snapshots and distinguishes absent from malformed metadata", () => {
  assert.equal(normalizeDepartmentMetadata(metadata)?.limits.maxEmployees, 20);
  assert.deepEqual(readDepartmentMetadataField(undefined), { invalid: false });
  assert.deepEqual(readDepartmentMetadataField({ ...metadata, version: 2 }), { invalid: true });
  assert.deepEqual(readDepartmentMetadataField(null), { invalid: true });
  assert.equal(normalizeDepartmentMetadata({ ...metadata, routes: { ...metadata.routes, employee: { cli: ["codex"] } } }), null);
  assert.equal(normalizeDepartmentMetadata({ ...metadata, routes: { ...metadata.routes, employee: { cli: "codex", thinkingMode: ["high"] } } }), null);
  assert.equal(normalizeDepartmentMetadata({ ...metadata, routes: { ...metadata.routes, employee: { cli: 1 } } }), null);
  assert.equal(readDepartmentMetadataField(undefined, true).invalid, true);
  assert.equal(readDepartmentMetadataField(metadata, true).invalid, false);
});

test("department pool enforces per-root leader and aggregate employee limits and idempotent release", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const leaders = await Promise.all(Array.from({ length: 4 }, (_, i) => pool.acquireLeader("a", `leader-${i}`)));
  const waitingLeader = pool.acquireLeader("a", "leader-overflow");
  const five = await Promise.all(Array.from({ length: 20 }, (_, i) => pool.acquireEmployee("a", `leader-${i % 4}`, `try-${i}`)));
  let employeeResolved = false;
  const waitingEmployee = pool.acquireEmployee("a", "leader-1", "extra").then((lease) => { employeeResolved = true; return lease; });
  await Promise.resolve();
  assert.equal(employeeResolved, false);
  assert.equal((await pool.acquireLeader("b", "other"))?.rootTaskId, "b");
  five[0]?.release(); five[0]?.release();
  assert.ok(await waitingEmployee);
  leaders[0]?.release();
  assert.equal((await waitingLeader)?.identity, "leader-overflow");
  assert.equal(pool.snapshot("a")[0].employees.length, 20);
  const rebuilt = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  rebuilt.restore(pool.snapshot());
  assert.equal(rebuilt.snapshot("a")[0].leaders.length, 4);
});

test("cancelled capacity waiters do not occupy slots and capacity reductions do not revoke leases", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 1 });
  const held = await pool.acquireLeader("root", "one");
  const controller = new AbortController();
  const cancelled = pool.acquireLeader("root", "cancelled", undefined, controller.signal);
  controller.abort();
  assert.equal(await cancelled, null);
  const heldEmployee = await pool.acquireEmployee("root", "one", "attempt");
  const blocked = pool.acquireEmployee("root", "one", "attempt-2");
  assert.equal(pool.snapshot("root")[0].employees.length, 1);
  assert.ok(heldEmployee);
  heldEmployee?.release();
  assert.ok(await blocked);
  held?.release();
});

test("restore rejects active leases or waiters without replacing their pool state", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 1 });
  const held = await pool.acquireLeader("root", "held");
  const waiting = pool.acquireLeader("root", "waiting");
  assert.throws(() => pool.restore([{ rootTaskId: "new", maxLeaders: 2, maxEmployees: 2, leaders: ["new-leader"], employees: [] }]), /active/u);
  assert.deepEqual(pool.snapshot("root")[0].leaders, ["held"]);
  held?.release();
  assert.equal((await waiting)?.identity, "waiting");
});

test("restore validates atomically and rebuilds exact occupancy counts", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 3, maxEmployees: 3 });
  const old = await pool.acquireLeader("old", "old-leader");
  old?.release();
  const before = pool.snapshot();
  assert.throws(() => pool.restore([
    { rootTaskId: "new", maxLeaders: 2, maxEmployees: 2, leaders: ["one"], employees: [] },
    { rootTaskId: "bad", maxLeaders: -1, maxEmployees: 1, leaders: [], employees: [] },
  ]));
  assert.deepEqual(pool.snapshot(), before);
  assert.throws(() => pool.restore([
    { rootTaskId: "same", maxLeaders: 1, maxEmployees: 1, leaders: [], employees: [] },
    { rootTaskId: "same", maxLeaders: 1, maxEmployees: 1, leaders: [], employees: [] },
  ]));
  pool.restore([{ rootTaskId: "new", maxLeaders: 2, maxEmployees: 3, leaders: ["a", "b"], employees: [JSON.stringify(["a", "try-1"]), JSON.stringify(["b", "try-2"])] }]);
  assert.deepEqual(pool.snapshot("new")[0], { rootTaskId: "new", maxLeaders: 2, maxEmployees: 3, leaders: ["a", "b"], employees: [JSON.stringify(["a", "try-1"]), JSON.stringify(["b", "try-2"])] });
});

test("capacity keeps custom limits, applies downsize safely, wakes waiters on expansion, and clears idle roots", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 });
  const limits = { maxLeaders: 2, maxEmployees: 1 };
  const one = await pool.acquireLeader("root", "one", limits);
  const two = await pool.acquireLeader("root", "two");
  const blocked = pool.acquireLeader("root", "three");
  assert.equal(pool.snapshot("root")[0].maxLeaders, 2);
  const down = { maxLeaders: 1, maxEmployees: 1 };
  const heldAgain = await pool.acquireLeader("root", "one", down);
  assert.equal(heldAgain?.identity, "one");
  assert.equal(pool.snapshot("root")[0].leaders.length, 2);
  one?.release();
  assert.equal(pool.snapshot("root")[0].leaders.length, 1);
  two?.release();
  assert.equal((await blocked)?.identity, "three");
  const expanded = { maxLeaders: 3, maxEmployees: 1 };
  const pending = pool.acquireLeader("root", "four", down);
  const duplicate = pool.acquireLeader("root", "four", expanded);
  assert.equal((await duplicate)?.identity, "four");
  assert.equal((await pending)?.identity, "four");
  assert.equal(pool.snapshot("root")[0].leaders.length, 2);
  heldAgain?.release();
  (await pool.acquireLeader("root", "three"))?.release();
  (await pool.acquireLeader("root", "four"))?.release();
  assert.equal(pool.clearRoot("root"), true);
  assert.deepEqual(pool.snapshot("root"), []);
});

test("duplicate waiting identities share admission and stale releases cannot clear restored leases", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 0 });
  const first = await pool.acquireLeader("root", "held");
  const pending = pool.acquireLeader("root", "next");
  assert.equal(pool.acquireLeader("root", "next"), pending);
  first?.release();
  const stale = await pending;
  const snapshot = pool.snapshot();
  const restoredPool = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 0 });
  restoredPool.restore(snapshot);
  stale?.release();
  assert.deepEqual(restoredPool.snapshot("root")[0].leaders, ["next"]);
});

test("employee identity requires actual strings and capacity queries are read-only", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 1 });
  assert.equal(await pool.acquireEmployee("root", {} as string, "attempt"), null);
  assert.equal(await pool.acquireEmployee("root", "leader", [] as unknown as string), null);
  assert.equal(pool.getEmployeeCapacity("unknown", "leader"), null);
  assert.equal(pool.snapshot().length, 0);
  const held = await pool.acquireEmployee("root", "leader", "one");
  assert.deepEqual(pool.getEmployeeCapacity("root", "leader"), {
    rootTaskId: "root", leaderTaskId: "leader", maxEmployees: 1, activeEmployees: 1,
    availableEmployees: 0, leaderOverflowActive: false, canAcquireOverflow: true,
  });
  held?.release();
});

test("overflow is explicit, per leader, counted, cancellable, and preserved through restore", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 1 });
  const regular = await pool.acquireEmployee("root", "leader-a", "regular");
  const overflow = await pool.acquireEmployeeWithOverflow("root", "leader-a", "extra");
  assert.equal(overflow?.identity, JSON.stringify(["leader-a", "extra"]));
  assert.equal(pool.getEmployeeCapacity("root", "leader-a")?.activeEmployees, 2);
  assert.equal(pool.getEmployeeCapacity("root", "leader-a")?.leaderOverflowActive, true);
  const cancelledController = new AbortController();
  const blockedSameLeader = pool.acquireEmployeeWithOverflow("root", "leader-a", "second", undefined, cancelledController.signal);
  const otherLeaderOverflow = await pool.acquireEmployeeWithOverflow("root", "leader-b", "extra");
  assert.ok(otherLeaderOverflow);
  assert.equal(pool.getEmployeeCapacity("root", "leader-a")?.canAcquireOverflow, false);
  cancelledController.abort();
  assert.equal(await blockedSameLeader, null);
  const restored = new DepartmentCapacityPool({ maxLeaders: 1, maxEmployees: 1 });
  restored.restore(pool.snapshot());
  assert.equal(restored.getEmployeeCapacity("root", "leader-a")?.leaderOverflowActive, true);
  const existing = await restored.acquireEmployeeWithOverflow("root", "leader-a", "extra");
  assert.equal(existing?.identity, overflow?.identity);
  existing?.release(); existing?.release();
  assert.equal(restored.getEmployeeCapacity("root", "leader-a")?.leaderOverflowActive, false);
  assert.equal(restored.getEmployeeCapacity("root", "leader-a")?.activeEmployees, 2);
  regular?.release(); otherLeaderOverflow?.release();
});

test("overflow snapshot validation is atomic and downsize snapshots may exceed new limits", async () => {
  const pool = new DepartmentCapacityPool({ maxLeaders: 3, maxEmployees: 3 });
  pool.restore([{ rootTaskId: "old", maxLeaders: 2, maxEmployees: 1, leaders: [], employees: [
    JSON.stringify(["a", "one"]), JSON.stringify(["b", "two"]),
  ] }]);
  const before = pool.snapshot();
  assert.equal(pool.getEmployeeCapacity("old", "a")?.availableEmployees, 0);
  assert.throws(() => pool.restore([
    { rootTaskId: "valid", maxLeaders: 1, maxEmployees: 1, leaders: [], employees: [JSON.stringify(["a", "one"])] },
    { rootTaskId: "bad", maxLeaders: 1, maxEmployees: 1, leaders: [], employees: ["not-a-tuple"] },
  ]));
  assert.deepEqual(pool.snapshot(), before);
  assert.throws(() => pool.restore([{ rootTaskId: "bad-overflow", maxLeaders: 1, maxEmployees: 0, leaders: [],
    employees: [JSON.stringify(["a", "one"]), JSON.stringify(["a", "two"])],
    employeeOverflow: [JSON.stringify(["a", "one"]), JSON.stringify(["a", "two"])],
  }]));
  assert.deepEqual(pool.snapshot(), before);
});

test("collaboration rejects duplicate, empty, stopped, unknown, and cross-department deliveries", () => {
  const members = new Map([["a", { rootTaskId: "root" }], ["b", { rootTaskId: "root", stopped: true }], ["x", { rootTaskId: "other" }]]);
  const seen = new Set<string>();
  const message = { id: "m1", rootTaskId: "root", sourceLeaderTaskId: "a", targetLeaderTaskId: "b", body: "please coordinate", status: "pending" as const };
  assert.equal(validateDepartmentCollaboration(message, members, seen).ok, false);
  assert.equal(validateDepartmentCollaboration({ ...message, targetLeaderTaskId: "missing" }, members, seen).ok, false);
  assert.equal(validateDepartmentCollaboration({ ...message, body: " " }, members, seen).ok, false);
  assert.equal(validateDepartmentCollaboration({ ...message, targetLeaderTaskId: "x" }, members, seen).ok, false);
  const good = validateDepartmentCollaboration({ ...message, targetLeaderTaskId: "a" }, members, seen);
  assert.equal(good.ok, true);
  assert.deepEqual(validateDepartmentCollaboration({ ...message, targetLeaderTaskId: "a" }, members, seen), { ok: false, reason: "duplicate-id" });
  assert.deepEqual(validateDepartmentCollaboration(null, members, seen), { ok: false, reason: "invalid-message" });
  assert.deepEqual(validateDepartmentCollaboration({ ...message, id: [] }, members, seen), { ok: false, reason: "invalid-message" });
  assert.deepEqual(validateDepartmentCollaboration({ ...message, sourceLeaderTaskId: 9 }, members, seen), { ok: false, reason: "invalid-message" });
  assert.deepEqual(validateDepartmentCollaboration({ ...message, rootTaskId: " " }, members, seen), { ok: false, reason: "invalid-message" });
});

test("role prompts preserve director boundaries and live collaboration path", () => {
  assert.match(buildDepartmentRolePrompt("director"), /不检查代码、不执行验收/u);
  assert.match(buildDepartmentRolePrompt("director"), /无需等所有其他组长结束/u);
  assert.match(buildDepartmentRolePrompt("leader"), /任务未结束时/u);
  assert.match(buildDepartmentRolePrompt("director"), /根任务统一的验收方案快照/u);
  assert.match(buildDepartmentRolePrompt("director"), /协作请求尚未处理/u);
  assert.match(buildDepartmentRolePrompt("leader"), /真实.*Loop\+/u);
  assert.match(buildDepartmentRolePrompt("leader"), /读取最新容量余额/u);
  assert.match(buildDepartmentRolePrompt("leader"), /宿主原子裁决/u);
});
