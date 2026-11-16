import type { DepartmentEmployeeAdmissionOccupancy } from "./departmentemployeeallocation";
export type DepartmentCapacityLease = { rootTaskId: string; kind: "leader" | "employee"; identity: string };
export type DepartmentCapacitySnapshot = { rootTaskId: string; maxLeaders: number; maxEmployees: number; leaders: string[]; employees: string[]; employeeOverflow?: string[] };
export type DepartmentCapacityLimits = { maxLeaders: number; maxEmployees: number };
export type DepartmentLeaderEmployeeAllocation = { revision: number; source: "default" | "manual"; desiredLimit: number;
  appliedLimit: number | null; activeEmployees: number; availableEmployees: number; pending: boolean };
export type DepartmentEmployeeCapacity = { rootTaskId: string; leaderTaskId: string; maxEmployees: number; activeEmployees: number; availableEmployees: number; leaderOverflowActive: boolean; canAcquireOverflow: boolean; leaderAllocation?: DepartmentLeaderEmployeeAllocation };
type Pool = DepartmentCapacityLimits & {
  leases: Map<string, DepartmentCapacityLease>;
  leaderCount: number;
  employeeCount: number;
  waiters: Waiter[];
  pending: Map<string, Promise<CapacityLease | null>>;
  overflowEmployees: Set<string>;
};
type Waiter = { key: string; identity: string; kind: "leader" | "employee"; allowOverflow?: boolean; rejectIfUnavailable?: boolean; resolve: (lease: CapacityLease | null) => void; signal?: AbortSignal; abort?: () => void; settled: boolean };
export type CapacityLease = DepartmentCapacityLease & { release(): void };

const validText = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());

export class DepartmentCapacityPool {
  private pools = new Map<string, Pool>();
  private observers = new Set<(rootTaskId: string) => void>();
  /** Synchronous notification after actual occupancy/config changes, including release/drain. */
  subscribe(listener: (rootTaskId: string) => void): { dispose(): void } {
    this.observers.add(listener);
    return { dispose: () => { this.observers.delete(listener); } };
  }
  private changed(root: string): void {
    for (const listener of this.observers) {
      try { listener(root); } catch { /* Observers must retain a failed-persistence gate; never lose a live lease. */ }
    }
  }
  constructor(private readonly defaults: DepartmentCapacityLimits) {
    this.assertLimits(defaults);
  }

  acquireLeader(rootTaskId: string, leaderTaskId: string, limits?: DepartmentCapacityLimits, signal?: AbortSignal) {
    return this.acquire(rootTaskId, "leader", leaderTaskId, limits, signal);
  }

  acquireEmployee(rootTaskId: string, leaderTaskId: string, attempt: string, limits?: DepartmentCapacityLimits, signal?: AbortSignal) {
    if (!validText(leaderTaskId) || !validText(attempt)) return Promise.resolve(null);
    return this.acquire(rootTaskId, "employee", JSON.stringify([leaderTaskId, attempt]), limits, signal);
  }

  acquireEmployeeWithOverflow(rootTaskId: string, leaderTaskId: string, attempt: string, limits?: DepartmentCapacityLimits, signal?: AbortSignal) {
    if (!validText(leaderTaskId) || !validText(attempt)) return Promise.resolve(null);
    return this.acquire(rootTaskId, "employee", JSON.stringify([leaderTaskId, attempt]), limits, signal, true);
  }

  /** Decision admission: grant synchronously through drain, or settle null without retaining a new waiter.
   * Existing held/pending identities remain idempotent; the waiting APIs retain their queue semantics. */
  tryAcquireEmployeeWithOverflow(rootTaskId: string, leaderTaskId: string, attempt: string, limits?: DepartmentCapacityLimits, signal?: AbortSignal) {
    if (!validText(leaderTaskId) || !validText(attempt)) return Promise.resolve(null);
    return this.acquire(rootTaskId, "employee", JSON.stringify([leaderTaskId, attempt]), limits, signal, true, true);
  }

  getEmployeeCapacity(rootTaskId: string, leaderTaskId: string): DepartmentEmployeeCapacity | null {
    if (!validText(rootTaskId) || !validText(leaderTaskId)) return null;
    const pool = this.pools.get(rootTaskId);
    if (!pool) return null;
    const leaderOverflowActive = [...pool.overflowEmployees].some((identity) => this.employeeLeader(identity) === leaderTaskId);
    const availableEmployees = Math.max(0, pool.maxEmployees - pool.employeeCount);
    return { rootTaskId, leaderTaskId, maxEmployees: pool.maxEmployees, activeEmployees: pool.employeeCount,
      availableEmployees, leaderOverflowActive, canAcquireOverflow: availableEmployees === 0 && !leaderOverflowActive };
  }

  /** Authoritative per-group occupancy from actual held leases, including overflow. Never task history. */
  getEmployeeAllocationOccupancy(rootTaskId: string, leaderTaskId: string): DepartmentEmployeeAdmissionOccupancy | null {
    const pool = this.pools.get(rootTaskId);
    if (!pool || !validText(leaderTaskId)) return null;
    let activeEmployees = 0;
    for (const lease of pool.leases.values()) if (lease.kind === "employee" && this.employeeLeader(lease.identity) === leaderTaskId) activeEmployees++;
    return { rootTaskId, leaderTaskId, globalActiveEmployees: pool.employeeCount, activeEmployees,
      leaderOverflowActive: [...pool.overflowEmployees].some((identity) => this.employeeLeader(identity) === leaderTaskId) };
  }

  snapshot(rootTaskId?: string): DepartmentCapacitySnapshot[] {
    return [...this.pools].filter(([root]) => rootTaskId === undefined || root === rootTaskId).map(([root, pool]) => ({
      rootTaskId: root,
      maxLeaders: pool.maxLeaders,
      maxEmployees: pool.maxEmployees,
      leaders: [...pool.leases.values()].filter((item) => item.kind === "leader").map((item) => item.identity),
      employees: [...pool.leases.values()].filter((item) => item.kind === "employee").map((item) => item.identity),
      ...(pool.overflowEmployees.size ? { employeeOverflow: [...pool.overflowEmployees] } : {}),
    }));
  }

  restore(snapshots: DepartmentCapacitySnapshot[]): void {
    if ([...this.pools.values()].some((pool) => pool.leases.size > 0 || pool.waiters.length > 0)) {
      throw new Error("Cannot restore department capacity while leases or waiters are active");
    }
    if (!Array.isArray(snapshots)) throw new TypeError("Department capacity snapshots must be an array");
    const nextPools = new Map<string, Pool>();
    for (const snapshot of snapshots) {
      if (!snapshot || !validText(snapshot.rootTaskId) || nextPools.has(snapshot.rootTaskId)) {
        throw new TypeError("Invalid or duplicate department capacity root");
      }
      this.assertLimits(snapshot);
      if (!Array.isArray(snapshot.leaders) || !Array.isArray(snapshot.employees)
        || snapshot.leaders.some((id) => !validText(id))) {
        throw new TypeError("Invalid department capacity identities");
      }
      const employees = snapshot.employees.map((id) => this.normalizeEmployeeIdentity(id));
      if (snapshot.employeeOverflow !== undefined && !Array.isArray(snapshot.employeeOverflow)) throw new TypeError("Invalid employee overflow snapshot");
      const overflow = snapshot.employeeOverflow === undefined ? [] : snapshot.employeeOverflow.map((id) => this.normalizeEmployeeIdentity(id));
      if (!Array.isArray(snapshot.employeeOverflow ?? []) || new Set(snapshot.leaders).size !== snapshot.leaders.length
        || new Set(employees).size !== employees.length || new Set(overflow).size !== overflow.length
        || overflow.some((id) => !employees.includes(id))) {
        throw new TypeError("Duplicate department capacity identity");
      }
      const pool = this.createPool(snapshot);
      for (const identity of snapshot.leaders) {
        const lease = { rootTaskId: snapshot.rootTaskId, kind: "leader" as const, identity };
        pool.leases.set(this.leaseKey(lease.kind, identity), lease);
      }
      for (const identity of employees) {
        const lease = { rootTaskId: snapshot.rootTaskId, kind: "employee" as const, identity };
        pool.leases.set(this.leaseKey(lease.kind, identity), lease);
      }
      for (const identity of overflow) {
        if (pool.overflowEmployees.has(identity)) throw new TypeError("Duplicate employee overflow identity");
        const leader = this.employeeLeader(identity);
        if ([...pool.overflowEmployees].some((existing) => this.employeeLeader(existing) === leader)) throw new TypeError("Multiple employee overflows for leader");
        pool.overflowEmployees.add(identity);
      }
      pool.leaderCount = snapshot.leaders.length;
      pool.employeeCount = snapshot.employees.length;
      nextPools.set(snapshot.rootTaskId, pool);
    }
    this.pools = nextPools;
    for (const root of nextPools.keys()) this.changed(root);
  }

  /** Atomically replace only an inactive root. Other departments and their waiters remain untouched. */
  restoreRoot(snapshot: DepartmentCapacitySnapshot): CapacityLease[] {
    const existing = this.pools.get(snapshot?.rootTaskId);
    if (existing && (existing.leases.size || existing.waiters.length)) {
      throw new Error("Cannot restore an active department root");
    }
    const validated = new DepartmentCapacityPool(this.defaults);
    validated.restore([snapshot]);
    const pool = validated.pools.get(snapshot.rootTaskId)!;
    this.pools.set(snapshot.rootTaskId, pool);
    this.changed(snapshot.rootTaskId);
    return [...pool.leases].map(([key, lease]) => this.lease(pool, key, lease));
  }

  clearRoot(rootTaskId: string): boolean {
    const pool = this.pools.get(rootTaskId);
    if (!pool) return true;
    if (pool.leases.size > 0 || pool.waiters.length > 0) return false;
    this.pools.delete(rootTaskId);
    this.changed(rootTaskId);
    return true;
  }

  private acquire(root: string, kind: "leader" | "employee", identity: string, limits?: DepartmentCapacityLimits, signal?: AbortSignal, allowOverflow = false, rejectIfUnavailable = false): Promise<CapacityLease | null> {
    if (!validText(root) || !validText(identity)) return Promise.resolve(null);
    if (limits) this.assertLimits(limits);
    const pool = this.getPool(root, limits);
    if (limits) { this.drain(root, pool); this.changed(root); }
    if (signal?.aborted) return Promise.resolve(null);
    const key = this.leaseKey(kind, identity);
    const held = pool.leases.get(key);
    if (held) return Promise.resolve(this.lease(pool, key, held));
    const pending = pool.pending.get(key);
    if (pending) return pending;
    const result = new Promise<CapacityLease | null>((resolve) => {
      const waiter: Waiter = { key, identity, kind, allowOverflow, rejectIfUnavailable, resolve, signal, settled: false };
      waiter.abort = () => {
        if (waiter.settled) return;
        waiter.settled = true;
        this.removeWaiter(pool, waiter);
        pool.pending.delete(key);
        signal?.removeEventListener("abort", waiter.abort!);
        resolve(null);
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      pool.waiters.push(waiter);
    });
    pool.pending.set(key, result);
    this.drain(root, pool);
    return result;
  }

  private getPool(root: string, limits?: DepartmentCapacityLimits): Pool {
    let pool = this.pools.get(root);
    if (!pool) {
      pool = this.createPool(limits ?? this.defaults);
      this.pools.set(root, pool);
    } else if (limits) {
      pool.maxLeaders = limits.maxLeaders;
      pool.maxEmployees = limits.maxEmployees;
    }
    return pool;
  }

  private createPool(limits: DepartmentCapacityLimits): Pool {
    return { ...limits, leases: new Map(), leaderCount: 0, employeeCount: 0, waiters: [], pending: new Map(), overflowEmployees: new Set() };
  }

  private drain(root: string, pool: Pool): void {
    for (let index = 0; index < pool.waiters.length;) {
      const waiter = pool.waiters[index];
      const employeeLeader = waiter.kind === "employee" ? this.employeeLeader(waiter.identity) : null;
      const overflowAllowed = waiter.kind === "employee" && waiter.allowOverflow && pool.employeeCount >= pool.maxEmployees
        && ![...pool.overflowEmployees].some((identity) => this.employeeLeader(identity) === employeeLeader);
      const available = waiter.kind === "leader" ? pool.leaderCount < pool.maxLeaders
        : pool.employeeCount < pool.maxEmployees || overflowAllowed;
      if (!available) {
        if (waiter.rejectIfUnavailable) {
          pool.waiters.splice(index, 1);
          waiter.settled = true;
          pool.pending.delete(waiter.key);
          waiter.signal?.removeEventListener("abort", waiter.abort!);
          waiter.resolve(null);
        } else index += 1;
        continue;
      }
      pool.waiters.splice(index, 1);
      const lease = { rootTaskId: root, kind: waiter.kind, identity: waiter.identity } as DepartmentCapacityLease;
      pool.leases.set(waiter.key, lease);
      if (waiter.kind === "leader") pool.leaderCount += 1;
      else pool.employeeCount += 1;
      if (overflowAllowed) pool.overflowEmployees.add(waiter.identity);
      waiter.settled = true;
      pool.pending.delete(waiter.key);
      waiter.signal?.removeEventListener("abort", waiter.abort!);
      this.changed(root);
      waiter.resolve(this.lease(pool, waiter.key, lease));
    }
  }

  private lease(pool: Pool, key: string, value: DepartmentCapacityLease): CapacityLease {
    let released = false;
    return { ...value, release: () => {
      if (released) return;
      released = true;
      if (pool.leases.get(key) !== value) return;
      pool.leases.delete(key);
      if (value.kind === "leader") pool.leaderCount -= 1;
      else { pool.employeeCount -= 1; pool.overflowEmployees.delete(value.identity); }
      this.changed(value.rootTaskId);
      this.drain(value.rootTaskId, pool);
    } };
  }

  private removeWaiter(pool: Pool, waiter: Waiter): void {
    const index = pool.waiters.indexOf(waiter);
    if (index >= 0) pool.waiters.splice(index, 1);
  }

  private leaseKey(kind: "leader" | "employee", identity: string): string {
    return `${kind}\u0000${identity}`;
  }

  private employeeLeader(identity: string): string {
    return (JSON.parse(identity) as [string, string])[0];
  }

  private normalizeEmployeeIdentity(identity: unknown): string {
    if (!validText(identity)) throw new TypeError("Invalid employee capacity identity");
    let parsed: unknown;
    try { parsed = JSON.parse(identity); } catch { throw new TypeError("Invalid employee capacity identity"); }
    if (!Array.isArray(parsed) || parsed.length !== 2 || !validText(parsed[0]) || !validText(parsed[1])) throw new TypeError("Invalid employee capacity identity");
    const normalized = JSON.stringify(parsed);
    if (normalized !== identity) throw new TypeError("Non-canonical employee capacity identity");
    return normalized;
  }

  private assertLimits(value: DepartmentCapacityLimits): void {
    if (!Number.isSafeInteger(value.maxLeaders) || value.maxLeaders < 0
      || !Number.isSafeInteger(value.maxEmployees) || value.maxEmployees < 0) {
      throw new RangeError("Department capacity limits must be non-negative safe integers");
    }
  }
}
