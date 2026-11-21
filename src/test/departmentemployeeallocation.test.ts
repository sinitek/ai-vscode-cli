import test = require("node:test");
import assert = require("node:assert/strict");
import {
  activateDepartmentEmployeeAllocation as activate,
  createDepartmentEmployeeAllocation as create,
  getDepartmentDefaultEmployeeLimit as defaultLimit,
  normalizeDepartmentEmployeeAllocation as normalize,
  projectDepartmentEmployeeAllocation as project,
  registerDepartmentEmployeeAllocationLeader as register,
  saveDepartmentEmployeeLimit as save,
  updateDepartmentEmployeeAllocationLimits as configure,
  type DepartmentEmployeeAllocationState as State,
} from "../departmentemployeeallocation";

const initial = (maxEmployees = 20, maxLeaders = 4) => create("root", { maxLeaders, maxEmployees }, ["a", "b"]);
const edit = (state: State, employeeLimit: unknown, leaderTaskId = "a") =>
  save(state, { rootTaskId: "root", leaderTaskId, employeeLimit, expectedRevision: state.revision });
const row = (state: State, leaderTaskId = "a") => project(state, "root").leaders.find((item) => item.leaderTaskId === leaderTaskId)!;

test("20/4 defaults to five even with only two registered leaders; first applied value is unknown", () => {
  const state = initial();
  assert.equal(defaultLimit(state), 5);
  assert.deepEqual(project(state, "root"), { rootTaskId: "root", revision: 0, defaultLimit: 5, leaders: ["a", "b"].map((leaderTaskId) =>
    ({ leaderTaskId, source: "default", desiredLimit: 5, appliedLimit: null, activeEmployees: null, pending: true })) });
  const applied = activate(state, "root", "a");
  assert.equal(row(applied).appliedLimit, 5);
  assert.equal(row(state).appliedLimit, null, "activation does not mutate its input");
});

test("nondivisible reference budgets round up", () => {
  const state = initial(10, 3);
  assert.equal(defaultLimit(state), 4);
  assert.equal(defaultLimit({ maxEmployees: Number.MAX_SAFE_INTEGER, maxLeaders: 1 }), Number.MAX_SAFE_INTEGER);
});

test("reference quotas can be zero", () => {
  assert.equal(defaultLimit({ maxEmployees: 20, maxLeaders: 0 }), 0);
  assert.equal(defaultLimit({ maxEmployees: 0, maxLeaders: 4 }), 0);
  const zero = edit(initial(), 0);
  assert.equal(row(zero).source, "manual");
  assert.equal(row(activate(zero, "root", "a")).appliedLimit, 0);
});

test("save and restore default affect desired only, are idempotent, and use CAS", () => {
  const applied = activate(initial(), "root", "a");
  const manual = edit(applied, 8);
  assert.deepEqual(row(manual), { leaderTaskId: "a", source: "manual", desiredLimit: 8, appliedLimit: 5, activeEmployees: null, pending: true });
  assert.deepEqual(edit(manual, 8), manual);
  assert.throws(() => save(manual, { rootTaskId: "root", leaderTaskId: "a", employeeLimit: 8, expectedRevision: applied.revision }), /revision conflict/);
  const restored = edit(activate(manual, "root", "a"), null);
  assert.equal(row(restored).source, "default");
  assert.equal(row(restored).desiredLimit, 5);
  assert.equal(row(restored).appliedLimit, 8);
  assert.equal(row(restored).pending, true);
  assert.deepEqual(edit(restored, null), restored);
  assert.equal(row(activate(restored, "root", "a")).appliedLimit, 5);
});

test("lowering the reference value preserves the actual active count", () => {
  const state = edit(activate(initial(), "root", "a"), 2);
  const counts = { rootTaskId: "root", leaders: [{ leaderTaskId: "a", activeEmployees: 6 }] };
  const before = JSON.stringify(state);
  assert.equal(project(state, "root", counts).leaders[0].appliedLimit, 5);
  assert.equal(JSON.stringify(state), before, "reading does not activate");
  const applied = activate(state, "root", "a");
  assert.equal(row(applied).appliedLimit, 2);
  assert.equal(row(applied).pending, false);
  assert.equal(project(applied, "root", counts).leaders[0].activeEmployees, 6);
  assert.deepEqual(counts.leaders, [{ leaderTaskId: "a", activeEmployees: 6 }]);
});

test("editing A cannot mark unchanged B pending through a global revision", () => {
  let state = activate(activate(initial(), "root", "a"), "root", "b");
  const b = row(state, "b");
  state = edit(state, 7);
  assert.equal(row(state).pending, true);
  assert.deepEqual(row(state, "b"), b);
  state = activate(state, "root", "a");
  assert.deepEqual(row(state, "b"), b);
  assert.deepEqual(activate(state, "root", "a"), state);
  const sameNumber = edit(state, 5, "b");
  assert.equal(row(sameNumber, "b").source, "manual");
  assert.equal(row(sameNumber, "b").pending, false, "an identical numerical limit is already applied");
});

test("configuration changes recompute defaults and cap manual desired values without rewriting applied limits", () => {
  let state = activate(edit(initial(), 12), "root", "a");
  state = activate(state, "root", "b");
  const changed = configure(state, { rootTaskId: "root", expectedRevision: state.revision, maxEmployees: 6, maxLeaders: 4 });
  assert.equal(row(changed).desiredLimit, 6);
  assert.equal(row(changed).appliedLimit, 12);
  assert.equal(row(changed, "b").desiredLimit, 2);
  assert.equal(row(changed, "b").appliedLimit, 5);
  const larger = configure(changed, { rootTaskId: "root", expectedRevision: changed.revision, maxEmployees: 24, maxLeaders: 4 });
  assert.equal(row(larger, "b").desiredLimit, 6);
  assert.equal(row(larger).desiredLimit, 6, "a capped manual value remains explicit until edited/restored");
  assert.deepEqual(configure(larger, { ...larger, expectedRevision: larger.revision }), larger);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(changed)), "root"), changed, "historical applied limit above the new total remains valid");
});

test("per-group reference quotas can sum to more than the department quota", () => {
  const state = edit(edit(initial(), 20), 20, "b");
  assert.equal(project(state, "root").leaders.reduce((sum, leader) => sum + leader.desiredLimit, 0), 40);
});

test("unknown occupancy remains unknown after the latest reference quota is applied", () => {
  const state = activate(edit(initial(), 3), "root", "a");
  assert.equal(row(state).appliedLimit, 3);
  assert.equal(project(state, "root", { rootTaskId: "root", leaders: [] }).leaders[0].activeEmployees, null);
});

test("durable JSON roundtrip and returned projections do not alias their inputs", () => {
  const state = edit(activate(initial(), "root", "a"), 3);
  const restored = normalize(JSON.parse(JSON.stringify(state)), "root");
  assert.deepEqual(restored, state);
  restored.leaders[0].appliedLimit = 1;
  assert.equal(state.leaders[0].appliedLimit, 5);
  const view = project(state, "root");
  (view.leaders[0] as { desiredLimit: number }).desiredLimit = 99;
  assert.equal(row(state).desiredLimit, 3);
  const added = register(state, "root", "c");
  assert.equal(row(added, "c").appliedLimit, null);
  assert.deepEqual(register(added, "root", "c"), added);
  assert.equal(state.leaders.length, 2);
});

test("strict boundaries reject invalid manual values, roots, members, schemas and revisions", () => {
  const state = initial();
  for (const invalid of ["5", "", undefined, NaN, Infinity, -Infinity, -1, 1.5, 21, Number.MAX_SAFE_INTEGER + 1, {}, true]) {
    assert.throws(() => edit(state, invalid));
  }
  for (const invalid of ["4", NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => defaultLimit({ maxLeaders: invalid as number, maxEmployees: 20 }));
    assert.throws(() => normalize({ ...state, revision: invalid }, "root"));
    assert.throws(() => save(state, { rootTaskId: "root", leaderTaskId: "a", employeeLimit: 1, expectedRevision: invalid as number }));
  }
  assert.throws(() => normalize(state, "other"));
  assert.throws(() => edit(state, 1, "unknown"));
  assert.throws(() => normalize({ ...state, version: 2 }, "root"));
  assert.throws(() => normalize({ ...state, extra: 1 }, "root"));
  assert.throws(() => normalize({ ...state, leaders: [state.leaders[0], state.leaders[0]] }, "root"));
  assert.throws(() => normalize({ ...state, leaders: [{ leaderTaskId: "a", manualLimit: null }] }, "root"));
  assert.throws(() => create("root", state, ["a", "a"]));
  assert.throws(() => register(state, "other", "c"));
  assert.throws(() => register(state, "root", "root"));
  assert.throws(() => activate(state, "other", "a"));
  assert.throws(() => activate(state, "root", "missing"));
  assert.throws(() => configure(state, { rootTaskId: "root", expectedRevision: 0, maxLeaders: 4, maxEmployees: NaN }));
});

test("occupancy display rejects coercion and duplicate or mismatched members", () => {
  const state = initial();
  for (const invalid of ["0", undefined, NaN, Infinity, -1, 0.5]) {
    assert.throws(() => project(state, "root", { rootTaskId: "root", leaders: [{ leaderTaskId: "a", activeEmployees: invalid as number }] }));
  }
  assert.throws(() => project(state, "root", { rootTaskId: "other", leaders: [] }));
  assert.throws(() => project(state, "root", { rootTaskId: "root", leaders: [{ leaderTaskId: "a", activeEmployees: 1 }, { leaderTaskId: "a", activeEmployees: 1 }] }));
  assert.throws(() => project(state, "root", { rootTaskId: "root", leaders: [{ leaderTaskId: "missing", activeEmployees: 1 }] }));
});

test("revision never overflows, including activation and configuration; no-op saves remain idempotent", () => {
  const state = { ...initial(), revision: Number.MAX_SAFE_INTEGER };
  assert.throws(() => edit(state, 1), /revision overflow/);
  assert.throws(() => activate(state, "root", "a"), /revision overflow/);
  assert.throws(() => register(state, "root", "c"), /revision overflow/);
  assert.throws(() => configure(state, { rootTaskId: "root", expectedRevision: state.revision, maxLeaders: 4, maxEmployees: 10 }), /revision overflow/);
  assert.deepEqual(edit(state, null), state);
  assert.equal(state.revision, Number.MAX_SAFE_INTEGER);
  assert.equal(state.leaders[0].appliedLimit, null);
});
