import type { DepartmentCapacityLimits } from "./departmentcapacity";

export type DepartmentEmployeeAllocationLeader = {
  leaderTaskId: string;
  /** null selects the default; zero is an explicit regular limit. */
  manualLimit: number | null;
  /** null means no employee admission attempt has applied a limit yet. */
  appliedLimit: number | null;
};
export type DepartmentEmployeeAllocationState = {
  version: 1;
  rootTaskId: string;
  revision: number;
  maxLeaders: number;
  maxEmployees: number;
  leaders: DepartmentEmployeeAllocationLeader[];
};
export type DepartmentEmployeeAllocationProjection = {
  readonly rootTaskId: string;
  readonly revision: number;
  readonly defaultLimit: number;
  readonly leaders: readonly {
    readonly leaderTaskId: string;
    readonly source: "default" | "manual";
    readonly desiredLimit: number;
    readonly appliedLimit: number | null;
    readonly activeEmployees: number | null;
    readonly pending: boolean;
  }[];
};
export type DepartmentEmployeeAllocationCounts = {
  rootTaskId: string;
  leaders: { leaderTaskId: string; activeEmployees: number | null }[];
};
/** Supplied by the authoritative host, including all regular AND overflow employees. */
export type DepartmentEmployeeOccupancy = {
  rootTaskId: string;
  leaderTaskId: string;
  globalActiveEmployees: number | null;
  activeEmployees: number | null;
  leaderOverflowActive: boolean | null;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid employee allocation object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Invalid employee allocation object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) throw new TypeError("Invalid employee allocation fields");
}
function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new TypeError("Invalid employee allocation identity");
}
function integer(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RangeError("Employee allocation values must be non-negative safe integers");
}
function count(value: unknown): asserts value is number | null {
  if (value !== null) integer(value);
}
function limits(value: DepartmentCapacityLimits): void {
  integer(value.maxLeaders); integer(value.maxEmployees);
}
function nextRevision(state: DepartmentEmployeeAllocationState): void {
  if (state.revision === Number.MAX_SAFE_INTEGER) throw new RangeError("Employee allocation revision overflow");
  state.revision += 1;
}
function cas(state: DepartmentEmployeeAllocationState, expectedRevision: number): void {
  integer(expectedRevision);
  if (state.revision !== expectedRevision) throw new Error("Employee allocation revision conflict");
}
function member(state: DepartmentEmployeeAllocationState, leaderTaskId: string): DepartmentEmployeeAllocationLeader {
  identity(leaderTaskId);
  const leader = state.leaders.find((item) => item.leaderTaskId === leaderTaskId);
  if (!leader) throw new TypeError("Unknown employee allocation leader");
  return leader;
}
function desired(state: DepartmentEmployeeAllocationState, leader: DepartmentEmployeeAllocationLeader): number {
  return leader.manualLimit ?? getDepartmentDefaultEmployeeLimit(state);
}

/** Uses configured maxLeaders, never the number of currently registered leaders. */
export function getDepartmentDefaultEmployeeLimit(value: DepartmentCapacityLimits): number {
  limits(value);
  return value.maxLeaders > 0 ? Math.ceil(value.maxEmployees / value.maxLeaders) : 0;
}

/** Strict durable boundary. No coercion, fallback, root rebinding or silent member deduplication. */
export function normalizeDepartmentEmployeeAllocation(value: unknown, rootTaskId: string): DepartmentEmployeeAllocationState {
  identity(rootTaskId);
  const raw = record(value);
  keys(raw, ["version", "rootTaskId", "revision", "maxLeaders", "maxEmployees", "leaders"]);
  if (raw.version !== 1 || raw.rootTaskId !== rootTaskId) throw new TypeError("Invalid employee allocation version or root");
  integer(raw.revision); integer(raw.maxLeaders); integer(raw.maxEmployees);
  if (!Array.isArray(raw.leaders)) throw new TypeError("Invalid employee allocation leaders");
  const seen = new Set<string>();
  const leaders = raw.leaders.map((value) => {
    const leader = record(value);
    keys(leader, ["leaderTaskId", "manualLimit", "appliedLimit"]);
    identity(leader.leaderTaskId);
    if (leader.leaderTaskId === rootTaskId || seen.has(leader.leaderTaskId)) throw new TypeError("Invalid or duplicate employee allocation leader");
    seen.add(leader.leaderTaskId);
    count(leader.manualLimit); count(leader.appliedLimit);
    if (leader.manualLimit !== null && leader.manualLimit > (raw.maxEmployees as number)) throw new RangeError("Employee manual limit exceeds shared maximum");
    // Applied values can exceed today's maximum after a configuration reduction.
    return { leaderTaskId: leader.leaderTaskId, manualLimit: leader.manualLimit, appliedLimit: leader.appliedLimit };
  });
  return { version: 1, rootTaskId, revision: raw.revision, maxLeaders: raw.maxLeaders, maxEmployees: raw.maxEmployees, leaders };
}

export function createDepartmentEmployeeAllocation(rootTaskId: string, value: DepartmentCapacityLimits, leaderTaskIds: readonly string[]): DepartmentEmployeeAllocationState {
  if (!Array.isArray(leaderTaskIds)) throw new TypeError("Invalid employee allocation members");
  return normalizeDepartmentEmployeeAllocation({ version: 1, rootTaskId, revision: 0, maxLeaders: value.maxLeaders, maxEmployees: value.maxEmployees,
    leaders: leaderTaskIds.map((leaderTaskId) => ({ leaderTaskId, manualLimit: null, appliedLimit: null })) }, rootTaskId);
}

/** Trusted host save only. Caller owns authorization, serialized CAS persistence and acknowledgment. */
export function saveDepartmentEmployeeLimit(value: DepartmentEmployeeAllocationState, request: {
  rootTaskId: string; leaderTaskId: string; employeeLimit: unknown; expectedRevision: number;
}): DepartmentEmployeeAllocationState {
  const state = normalizeDepartmentEmployeeAllocation(value, request.rootTaskId);
  cas(state, request.expectedRevision);
  const leader = member(state, request.leaderTaskId);
  if (request.employeeLimit !== null) {
    integer(request.employeeLimit);
    if (request.employeeLimit > state.maxEmployees) throw new RangeError("Employee manual limit exceeds shared maximum");
  }
  if (leader.manualLimit === request.employeeLimit) return state;
  nextRevision(state);
  leader.manualLimit = request.employeeLimit;
  return state;
}

/** Recompute defaults; clamp manual desired values to the new shared maximum. Never change applied limits. */
export function updateDepartmentEmployeeAllocationLimits(value: DepartmentEmployeeAllocationState, request: {
  rootTaskId: string; expectedRevision: number; maxLeaders: number; maxEmployees: number;
}): DepartmentEmployeeAllocationState {
  const state = normalizeDepartmentEmployeeAllocation(value, request.rootTaskId);
  cas(state, request.expectedRevision); limits(request);
  if (state.maxLeaders === request.maxLeaders && state.maxEmployees === request.maxEmployees) return state;
  nextRevision(state);
  state.maxLeaders = request.maxLeaders; state.maxEmployees = request.maxEmployees;
  for (const leader of state.leaders) {
    if (leader.manualLimit !== null) leader.manualLimit = Math.min(leader.manualLimit, state.maxEmployees);
  }
  return state;
}

/** Membership is provided by the authoritative host; this function grants no organization authority. */
export function registerDepartmentEmployeeAllocationLeader(value: DepartmentEmployeeAllocationState, rootTaskId: string, leaderTaskId: string): DepartmentEmployeeAllocationState {
  const state = normalizeDepartmentEmployeeAllocation(value, rootTaskId);
  identity(leaderTaskId);
  if (leaderTaskId === rootTaskId) throw new TypeError("Invalid employee allocation leader");
  if (state.leaders.some((item) => item.leaderTaskId === leaderTaskId)) return state;
  nextRevision(state);
  state.leaders.push({ leaderTaskId, manualLimit: null, appliedLimit: null });
  return state;
}

/** Call only at the start of a REAL employee admission attempt, before checking occupancy.
 * Persist the returned state even if admission is then refused. This creates no reservation. */
export function activateDepartmentEmployeeAllocation(value: DepartmentEmployeeAllocationState, rootTaskId: string, leaderTaskId: string): DepartmentEmployeeAllocationState {
  const state = normalizeDepartmentEmployeeAllocation(value, rootTaskId);
  const leader = member(state, leaderTaskId);
  const limit = desired(state, leader);
  if (leader.appliedLimit === limit) return state;
  nextRevision(state);
  leader.appliedLimit = limit;
  return state;
}

/** Read-only projection. Missing counts stay unknown, never inferred from chat or from shared balance. */
export function projectDepartmentEmployeeAllocation(value: DepartmentEmployeeAllocationState, rootTaskId: string, counts?: DepartmentEmployeeAllocationCounts): DepartmentEmployeeAllocationProjection {
  const state = normalizeDepartmentEmployeeAllocation(value, rootTaskId);
  const active = new Map<string, number | null>();
  if (counts !== undefined) {
    if (counts.rootTaskId !== rootTaskId || !Array.isArray(counts.leaders)) throw new TypeError("Invalid employee allocation counts root or members");
    for (const entry of counts.leaders) {
      member(state, entry.leaderTaskId); count(entry.activeEmployees);
      if (active.has(entry.leaderTaskId)) throw new TypeError("Duplicate employee allocation counts member");
      active.set(entry.leaderTaskId, entry.activeEmployees);
    }
  }
  return { rootTaskId, revision: state.revision, defaultLimit: getDepartmentDefaultEmployeeLimit(state), leaders: state.leaders.map((leader) => {
    const desiredLimit = desired(state, leader);
    return { leaderTaskId: leader.leaderTaskId, source: leader.manualLimit === null ? "default" : "manual", desiredLimit,
      appliedLimit: leader.appliedLimit, activeEmployees: active.get(leader.leaderTaskId) ?? null, pending: leader.appliedLimit !== desiredLimit };
  }) };
}
