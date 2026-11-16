import test = require("node:test");
import assert = require("node:assert/strict");
import {
  activateDepartmentEmployeeAllocation as activate,
  beginDepartmentEmployeeAdmission as begin,
  createDepartmentEmployeeAllocation as create,
  evaluateDepartmentEmployeeAllocation as evaluate,
  getDepartmentDefaultEmployeeLimit as defaultLimit,
  normalizeDepartmentEmployeeAllocation as normalize,
  projectDepartmentEmployeeAllocation as project,
  registerDepartmentEmployeeAllocationLeader as register,
  saveDepartmentEmployeeLimit as save,
  updateDepartmentEmployeeAllocationLimits as configure,
  type DepartmentEmployeeAllocationState as State,
  type DepartmentEmployeeAdmissionOccupancy as Occupancy,
} from "../departmentemployeeallocation";

const initial = (maxEmployees = 20, maxLeaders = 4) => create("root", { maxLeaders, maxEmployees }, ["a", "b"]);
const occupancy = (activeEmployees: number | null = 0, globalActiveEmployees: number | null = activeEmployees,
  leaderOverflowActive: boolean | null = false, leaderTaskId = "a"): Occupancy =>
  ({ rootTaskId: "root", leaderTaskId, activeEmployees, globalActiveEmployees, leaderOverflowActive });
const edit = (state: State, employeeLimit: unknown, leaderTaskId = "a") =>
  save(state, { rootTaskId: "root", leaderTaskId, employeeLimit, expectedRevision: state.revision });
const row = (state: State, leaderTaskId = "a") => project(state, "root").leaders.find((item) => item.leaderTaskId === leaderTaskId)!;

test("20/4 defaults to five even with only two registered leaders; first applied value is unknown", () => {
  const state = initial();
  assert.equal(defaultLimit(state), 5);
  assert.deepEqual(project(state, "root"), { rootTaskId: "root", revision: 0, defaultLimit: 5, leaders: ["a", "b"].map((leaderTaskId) =>
    ({ leaderTaskId, source: "default", desiredLimit: 5, appliedLimit: null, activeEmployees: null, pending: true })) });
  assert.equal(evaluate(state, occupancy()).reason, "not-applied");
  const attempt = begin(state, occupancy(4, 4));
  assert.equal(attempt.evaluation.availableEmployees, 1);
  assert.equal(attempt.evaluation.kind, "regular");
  assert.equal(row(attempt.state).appliedLimit, 5);
  assert.equal(row(state).appliedLimit, null, "pure attempt does not mutate its input");
});

test("nondivisible budgets round up but regular eligibility still needs shared capacity", () => {
  const state = initial(10, 3);
  assert.equal(defaultLimit(state), 4);
  assert.equal(begin(state, occupancy(3, 9)).evaluation.availableEmployees, 1);
  assert.equal(begin(state, occupancy(4, 9)).evaluation.reason, "group-limit");
  assert.equal(begin(state, occupancy(3, 10)).evaluation.kind, "overflow");
  assert.equal(begin(state, occupancy(3, 10, true)).evaluation.reason, "overflow-active");
  assert.equal(defaultLimit({ maxEmployees: Number.MAX_SAFE_INTEGER, maxLeaders: 1 }), Number.MAX_SAFE_INTEGER);
});

test("zero is a regular quota, and zero global balance retains the explicit overflow exception", () => {
  assert.equal(defaultLimit({ maxEmployees: 20, maxLeaders: 0 }), 0);
  assert.equal(defaultLimit({ maxEmployees: 0, maxLeaders: 4 }), 0);
  assert.equal(begin(initial(20, 0), occupancy()).evaluation.reason, "group-limit");
  const zero = edit(initial(), 0);
  assert.equal(row(zero).source, "manual");
  assert.equal(begin(zero, occupancy()).evaluation.reason, "group-limit");
  assert.equal(begin(zero, occupancy(0, 20)).evaluation.kind, "overflow");
  assert.equal(begin(initial(0), occupancy()).evaluation.kind, "overflow");
  assert.equal(begin(initial(0), occupancy(1, 1, true)).evaluation.reason, "overflow-active");
});

test("save and restore default affect desired only, are idempotent, and use CAS", () => {
  const applied = activate(initial(), "root", "a");
  const manual = edit(applied, 8);
  assert.deepEqual(row(manual), { leaderTaskId: "a", source: "manual", desiredLimit: 8, appliedLimit: 5, activeEmployees: null, pending: true });
  assert.deepEqual(edit(manual, 8), manual);
  assert.throws(() => save(manual, { rootTaskId: "root", leaderTaskId: "a", employeeLimit: 8, expectedRevision: applied.revision }), /revision conflict/);
  const attempted = begin(manual, occupancy(6, 6));
  assert.equal(attempted.evaluation.availableEmployees, 2);
  const restored = edit(attempted.state, null);
  assert.equal(row(restored).source, "default");
  assert.equal(row(restored).desiredLimit, 5);
  assert.equal(row(restored).appliedLimit, 8);
  assert.equal(row(restored).pending, true);
  assert.deepEqual(edit(restored, null), restored);
  assert.equal(row(begin(restored, occupancy(6, 6)).state).appliedLimit, 5);
});

test("lowering applies at the next refused attempt and retains all trusted active counts including overflow", () => {
  const state = edit(activate(initial(), "root", "a"), 2);
  const counts = { rootTaskId: "root", leaders: [{ leaderTaskId: "a", activeEmployees: 6 }] };
  const before = JSON.stringify(state);
  assert.equal(project(state, "root", counts).leaders[0].appliedLimit, 5);
  assert.equal(JSON.stringify(state), before, "reading does not activate");
  const attempted = begin(state, occupancy(6, 10, true));
  assert.equal(attempted.evaluation.reason, "group-limit");
  assert.equal(row(attempted.state).appliedLimit, 2);
  assert.equal(row(attempted.state).pending, false, "refusal still applies the saved limit");
  assert.equal(project(attempted.state, "root", counts).leaders[0].activeEmployees, 6);
  assert.deepEqual(counts.leaders, [{ leaderTaskId: "a", activeEmployees: 6 }]);
  assert.equal(begin(attempted.state, occupancy(1, 10, true)).evaluation.kind, "regular", "unreleased overflow counts but does not block positive regular balance");
  assert.equal(begin(attempted.state, occupancy(6, 20, false)).evaluation.kind, "overflow", "the global-zero exception is preserved even over the group quota");
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
  assert.equal(begin(changed, occupancy(6, 6, true)).evaluation.eligible, false);
  const larger = configure(changed, { rootTaskId: "root", expectedRevision: changed.revision, maxEmployees: 24, maxLeaders: 4 });
  assert.equal(row(larger, "b").desiredLimit, 6);
  assert.equal(row(larger).desiredLimit, 6, "a capped manual value remains explicit until edited/restored");
  assert.deepEqual(configure(larger, { ...larger, expectedRevision: larger.revision }), larger);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(changed)), "root"), changed, "historical applied limit above the new total remains valid");
});

test("manual quotas are per-group ceilings rather than reservations; their sum may exceed total", () => {
  const state = edit(edit(initial(), 20), 20, "b");
  assert.equal(project(state, "root").leaders.reduce((sum, leader) => sum + leader.desiredLimit, 0), 40);
  assert.equal(begin(state, occupancy(10, 19)).evaluation.availableEmployees, 1);
  assert.equal(begin(state, occupancy(10, 20, true)).evaluation.eligible, false);
});

test("unknown occupancy refuses both regular and overflow while still activating the latest desired limit", () => {
  const state = edit(initial(), 3);
  for (const counts of [occupancy(null, 20), occupancy(0, null), occupancy(0, 20, null)]) {
    const attempted = begin(state, counts);
    assert.equal(attempted.evaluation.reason, "unknown-occupancy");
    assert.equal(attempted.evaluation.eligible, false);
    assert.equal(attempted.evaluation.availableEmployees, null);
    assert.equal(row(attempted.state).appliedLimit, 3);
  }
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
  assert.throws(() => begin(state, { ...occupancy(), rootTaskId: "other" }));
  assert.throws(() => begin(state, occupancy(0, 0, false, "missing")));
  assert.throws(() => configure(state, { rootTaskId: "root", expectedRevision: 0, maxLeaders: 4, maxEmployees: NaN }));
});

test("occupancy rejects coercion, duplicate or mismatched members and inconsistent trusted counts", () => {
  const state = initial();
  for (const invalid of ["0", undefined, NaN, Infinity, -1, 0.5]) {
    assert.throws(() => begin(state, { ...occupancy(0, 20), activeEmployees: invalid as number }));
    assert.throws(() => begin(state, { ...occupancy(0, 20), globalActiveEmployees: invalid as number }));
    assert.throws(() => project(state, "root", { rootTaskId: "root", leaders: [{ leaderTaskId: "a", activeEmployees: invalid as number }] }));
  }
  assert.throws(() => begin(state, occupancy(2, 1)));
  assert.throws(() => begin(state, occupancy(0, 20, true)));
  assert.throws(() => begin(state, occupancy(0, 20, "false" as unknown as boolean)));
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
