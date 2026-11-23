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
  const director = buildDepartmentRolePrompt("director");
  const leader = buildDepartmentRolePrompt("leader");
  const employee = buildDepartmentRolePrompt("employee");
  assert.match(director, /不检查代码、不执行验收/u);
  assert.match(director, /无需等所有其他组长结束/u);
  assert.match(leader, /任务未结束时/u);
  assert.match(director, /根任务统一的验收方案快照/u);
  assert.match(director, /待处理协作是否影响目标/u);
  assert.match(leader, /真实.*Loop\+/u);
  assert.match(leader, /参考额度、实际占用/u);
  assert.match(leader, /附带 departmentCollaborations/u);
  assert.match(director, /maxEmployees 与 maxLeaders 均分预算/u);
  assert.match(director, /向上取整/u);
  assert.match(director, /20 名员工、4 名组长时每组默认额度为 5/u);
  assert.match(director, /组长预算和余额仅供参考/u);
  assert.match(leader, /余额为零时仍可按任务需要派发/u);
  assert.match(leader, /快照缺失时，仍可根据任务需要/u);
  assert.doesNotMatch(employee, /部门员工额度|宿主限额/u);
});

test("director prefers useful same-round parallelism and retains cohesive single-group tasks", () => {
  const director = buildDepartmentRolePrompt("director");
  assert.match(director, /多个目标若已就绪、可以独立交付和验收、写入范围互不冲突.*同轮派给多个组长/u);
  assert.match(director, /每位组长负责一个内聚、可独立验收的目标/u);
  assert.match(director, /强耦合或需要共同修改同一文件或契约的工作适合留在一组/u);
  assert.match(director, /必须先后完成的工作按依赖分轮。只有一个合适目标时就派一组/u);
  assert.match(director, /预计实现与验证工作量.*尽量均衡各组/u);
  assert.match(director, /按需补派新就绪且不冲突的目标/u);
  assert.match(director, /在整体结论中交代遗留事项/u);
});

test("employee prompt keeps temporary build output outside the execution directory", () => {
  const employee = buildDepartmentRolePrompt("employee");
  assert.match(employee, /构建副本、缓存和临时测试日志应放在当前工作目录之外的系统临时目录/u);
  assert.match(employee, /将构建和测试的临时输出指向该目录/u);
  assert.match(employee, /验收的证据应放在任务约定的持久位置，并在沟通文件中记录路径/u);
});

test("all department roles prefer compliant alternatives before reporting a blocker", () => {
  for (const role of ["director", "leader", "employee"] as const) {
    const prompt = buildDepartmentRolePrompt(role);
    assert.match(prompt, /现有授权范围内.*低风险的常规决策.*不为形式性确认暂停任务/u, role);
    assert.match(prompt, /许可明确且符合用途的免费网络图片.*记录来源及适用许可/u, role);
    assert.match(prompt, /不得假定宿主管理员已批准实际提权/u, role);
    assert.match(prompt, /先绕开该步骤推进不依赖它的工作/u, role);
    assert.match(prompt, /没有合规可行的替代且当前无工作可推进时，才按既有流程报阻塞/u, role);
    assert.match(prompt, /不虚报完成，不降低验收标准/u, role);
  }
});
