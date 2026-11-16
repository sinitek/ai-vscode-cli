import { beginDepartmentEmployeeAdmission, createDepartmentEmployeeAllocation, normalizeDepartmentEmployeeAllocation,
  registerDepartmentEmployeeAllocationLeader, saveDepartmentEmployeeLimit, updateDepartmentEmployeeAllocationLimits,
  type DepartmentEmployeeAllocationState, type DepartmentEmployeeAdmissionOccupancy,
  type DepartmentEmployeeAdmissionEvaluation } from "../departmentemployeeallocation";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { DepartmentCapacityPool, type DepartmentCapacitySnapshot } from "../departmentcapacity";
import { isDepartmentExecutionBinding, isDepartmentRuntimeSnapshot, type DepartmentExecutionBinding,
  type DepartmentLeaderRuntimeState, type DepartmentRuntimeSnapshot } from "./departmentruntimestate";
import { CLEANUP_PARTS, exactKeys, executionSlot, identifier, record, sameExecution } from "../runtime/departmentexecutionidentity";
import { isExecutionResponsibility, isLeaderExecutionScope, isProducerClosure, leaderExecutionScopeKey,
  leaderExecutionSetFingerprint, responsibilityKey, responsibilityMatchesBinding,
  type DepartmentExecutionResponsibility, type DepartmentLeaderExecutionScope, type DepartmentLeaderExecutionSet,
  type DepartmentLeaderProducerClosure } from "./departmentleaderexecutionledger";

export type DepartmentStoredRuntime = {
  version: 1;
  rootTaskId: string;
  workspaceKey: string;
  runtime: DepartmentRuntimeSnapshot;
  capacity: DepartmentCapacitySnapshot;
  /** Append-only, separate from controller snapshots so a stale controller
   * cannot discard execution ownership when persisting organization state. */
  executionBindings?: DepartmentExecutionBinding[];
  /** Owned by synchronous allocation lifecycle/CAS ports, never controller snapshots. */
  employeeAllocation?: DepartmentEmployeeAllocationState;
  /** Trusted host facts, independent of stale controller scheduling snapshots. */
  leaderExecutionSets?: DepartmentLeaderExecutionSet[];
};
export type DepartmentRuntimeReadResult = { ok: true; value: DepartmentStoredRuntime | null } | { ok: false; error: string };
export type DepartmentRuntimeWriteResult = { ok: true } | { ok: false; error: string };
/** These indexes belong to one synchronous operation, never to the store. */
type ValidatedRuntime = {
  value: DepartmentStoredRuntime;
  members: Map<string, DepartmentLeaderRuntimeState>;
  bindings: Map<string, DepartmentExecutionBinding>;
  slots: Set<string>;
  sets: Map<string, ValidatedExecutionSet>;
  bindingScopes: Set<string>;
};
type ValidatedExecutionSet = { value: DepartmentLeaderExecutionSet;
  entries: Map<string, DepartmentLeaderExecutionSet["entries"][number]>; targets: Set<string> };
type SnapshotReadResult = { ok: true; snapshot: ValidatedRuntime | null } | { ok: false; error: string };
const memberKey = (taskId: string, moduleId: string): string => JSON.stringify([taskId, moduleId]);
/** Organization history distinguishes employee attempts. Owner fencing remains
 * intentionally broader and continues to use executionSlot(identity). */
const organizationBindingTarget = (identity: DepartmentExecutionBinding["identity"]): string => JSON.stringify([
  executionSlot(identity), identity.generation, identity.role === "employee" ? identity.attemptId : null,
]);
const bindingSlot = (binding: DepartmentExecutionBinding): string => organizationBindingTarget(binding.identity);
const responsibilityTarget = (r: DepartmentExecutionResponsibility): string => JSON.stringify(r.target.role === "leader"
  ? ["leader"] : ["employee", r.target.subtaskId, r.target.attemptId]);

function validate(value: unknown, root: string, workspace: string): ValidatedRuntime | null {
  if (!value || typeof value !== "object") return null;
  const v = value as DepartmentStoredRuntime;
  if (v.version !== 1 || v.rootTaskId !== root || v.workspaceKey !== workspace
    || !isDepartmentRuntimeSnapshot(v.runtime, root) || v.capacity?.rootTaskId !== root) return null;
  try { new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 20 }).restore([v.capacity]); }
  catch { return null; }
  if (v.employeeAllocation !== undefined) {
    try { v.employeeAllocation = normalizeDepartmentEmployeeAllocation(v.employeeAllocation, root); }
    catch { return null; }
  }
  const members = new Map(v.runtime.leaders.map((member) => [memberKey(member.taskId, member.leaderSubtaskId), member]));
  const bindings = new Map<string, DepartmentExecutionBinding>(), slots = new Set<string>(), bindingScopes = new Set<string>();
  if (v.executionBindings !== undefined) {
    if (!Array.isArray(v.executionBindings)) return null;
    for (const binding of v.executionBindings) {
      if (!isDepartmentExecutionBinding(binding)) return null;
      const identity = binding.identity, slot = bindingSlot(binding);
      const member = members.get(memberKey(identity.leaderTaskId, identity.moduleId));
      if (identity.rootTaskId !== root || identity.workspace !== workspace || !member
        || identity.generation > (member.generation ?? 0) || bindings.has(identity.executionId) || slots.has(slot)) return null;
      bindings.set(identity.executionId, binding); slots.add(slot); bindingScopes.add(leaderExecutionScopeKey(identity));
    }
  }
  const sets = new Map<string, ValidatedExecutionSet>(), represented = new Set<string>();
  if (v.leaderExecutionSets !== undefined) {
    if (!Array.isArray(v.leaderExecutionSets)) return null;
    for (const set of v.leaderExecutionSets) {
      if (!record(set) || !exactKeys(set, ["version", "scope", "producerId", "state", "closure", "entries"])
        || set.version !== 1 || !isLeaderExecutionScope(set.scope) || !identifier(set.producerId)
        || !["open", "closed"].includes(set.state) || !Array.isArray(set.entries)) return null;
      const scope = set.scope, key = leaderExecutionScopeKey(scope), member = members.get(memberKey(scope.leaderTaskId, scope.moduleId));
      if (scope.rootTaskId !== root || scope.workspace !== workspace || !member
        || scope.generation > (member.generation ?? 0) || sets.has(key)
        || (set.state === "open" ? set.closure !== null : !isProducerClosure(set.closure, set.producerId, scope))) return null;
      const entries: ValidatedExecutionSet["entries"] = new Map(), targets = new Set<string>();
      let leaders = 0;
      for (const entry of set.entries) {
        if (!record(entry) || !exactKeys(entry, ["responsibility", "executionId"]) || !isExecutionResponsibility(entry.responsibility)
          || (entry.executionId !== null && !identifier(entry.executionId))) return null;
        const r = entry.responsibility, target = responsibilityTarget(r);
        if (entries.has(r.registrationId) || targets.has(target)) return null;
        if (r.target.role === "leader") leaders++;
        if (entry.executionId !== null) {
          const binding = bindings.get(entry.executionId);
          if (!binding || represented.has(entry.executionId) || !responsibilityMatchesBinding(scope, r, binding)) return null;
          represented.add(entry.executionId);
        }
        entries.set(r.registrationId, entry); targets.add(target);
      }
      if (set.state === "closed" && leaders !== 1) return null;
      sets.set(key, { value: set, entries, targets });
    }
    // Existing binding APIs may not sneak an unregistered execution into a
    // tracked generation. One linear pass, never pairwise binding comparisons.
    for (const binding of bindings.values()) if (sets.has(leaderExecutionScopeKey(binding.identity))
      && !represented.has(binding.identity.executionId)) return null;
  }
  return { value: v, members, bindings, slots, sets, bindingScopes };
}
/** One atomic file per organization. A corrupt/unreadable file is NEVER an empty organization. */
export class DepartmentRuntimeStore {
  constructor(private readonly directory: string) {}
  private file(root: string): string {
    if (typeof root !== "string" || !root.trim()) throw new Error("部门根任务标识无效。");
    return path.join(this.directory, `${Buffer.from(root).toString("hex")}.json`);
  }
  read(root: string, workspace: string): DepartmentRuntimeReadResult {
    const read = this.readSnapshot(root, workspace);
    // JSON.parse produces a fresh object on every call; no store-owned data or
    // per-operation indexes escape to the caller.
    return read.ok ? { ok: true, value: read.snapshot?.value ?? null } : read;
  }
  private readSnapshot(root: string, workspace: string): SnapshotReadResult {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.file(root), "utf8"));
      const snapshot = validate(value, root, workspace);
      if (!snapshot) throw new Error("部门运行快照损坏或工作区不匹配，已封闭新派发。");
      return { ok: true, snapshot };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, snapshot: null };
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  write(value: DepartmentStoredRuntime): DepartmentRuntimeWriteResult {
    try {
      value = structuredClone(value);
      // Read errors never turn into an empty binding set. All writes in this
      // host are synchronous, with no await between read and atomic rename.
      const previous = this.readSnapshot(value.rootTaskId, value.workspaceKey);
      if (!previous.ok) throw new Error(previous.error);
      const allocation = previous.snapshot?.value.employeeAllocation;
      if (value.employeeAllocation !== undefined && JSON.stringify(value.employeeAllocation) !== JSON.stringify(allocation)) {
        throw new Error("department-allocation-host-port-required");
      }
      if (allocation !== undefined) value.employeeAllocation = allocation;
      const retained = previous.snapshot?.value.executionBindings;
      if (retained?.length && value.executionBindings === undefined) value.executionBindings = retained;
      const retainedSets = previous.snapshot?.value.leaderExecutionSets;
      if (retainedSets !== undefined && value.leaderExecutionSets === undefined) value.leaderExecutionSets = retainedSets;
      const next = validate(value, value.rootTaskId, value.workspaceKey);
      if (!next) throw new Error("部门运行快照无效，未写入。");
      for (const old of retained ?? []) {
        const replacement = next.bindings.get(old.identity.executionId);
        if (!replacement || !sameBinding(old, replacement)) {
          throw new Error("部门执行身份不可删除或替换，已封闭派发。");
        }
      }
      // Generic controller writes can retain facts, but cannot add, seal, reset
      // or edit them. Only the trusted lifecycle ports below mutate a set.
      const oldSets = previous.snapshot?.sets ?? new Map<string, ValidatedExecutionSet>();
      if (next.sets.size !== oldSets.size) throw new Error("leader-execution-set-host-port-required");
      for (const [key, old] of oldSets) {
        const replacement = next.sets.get(key);
        if (!replacement || leaderExecutionSetFingerprint(old.value, []) !== leaderExecutionSetFingerprint(replacement.value, [])) {
          throw new Error("leader-execution-set-immutable-controller-facts");
        }
      }
      return this.commitValidated(value);
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  /** Only accepts an isolated, validated value within the same synchronous
   * call as its cold read. This is not a cross-process compare-and-swap. */
  private commitValidated(value: DepartmentStoredRuntime): DepartmentRuntimeWriteResult {
    let temporary: string | undefined;
    try {
      const file = this.file(value.rootTaskId);
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      temporary = `${file}.${randomUUID()}.tmp`;
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value), "utf8"); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    finally { if (temporary) { try { fs.unlinkSync(temporary); } catch { /* rename already consumed it */ } } }
  }

  /** Explicit verified lifecycle ONLY. Readers and generic controller writes never migrate legacy state.
   * One EH writer; these read/modify/rename operations are synchronous, not cross-process CAS. */
  synchronizeEmployeeAllocation(root: string, workspace: string): DepartmentRuntimeWriteResult {
    try {
      const read = this.readSnapshot(root, workspace);
      if (!read.ok || !read.snapshot) throw new Error(read.ok ? "部门运行快照缺失。" : read.error);
      const value = read.snapshot.value;
      let state = value.employeeAllocation ?? createDepartmentEmployeeAllocation(root, value.capacity, []);
      state = updateDepartmentEmployeeAllocationLimits(state, { rootTaskId: root, expectedRevision: state.revision,
        maxLeaders: value.capacity.maxLeaders, maxEmployees: value.capacity.maxEmployees });
      // Completed leaders remain in history beyond maxLeaders. Index this cold
      // snapshot once so unchanged members do not each normalize the whole policy.
      const registered = new Set(state.leaders.map((leader) => leader.leaderTaskId));
      for (const member of value.runtime.leaders) {
        if (registered.has(member.taskId)) continue;
        state = registerDepartmentEmployeeAllocationLeader(state, root, member.taskId);
        registered.add(member.taskId);
      }
      if (JSON.stringify(state) === JSON.stringify(value.employeeAllocation)) return { ok: true };
      value.employeeAllocation = state;
      return this.commitValidated(value);
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  saveEmployeeLimit(root: string, workspace: string, request: {
    leaderTaskId: string; employeeLimit: number | null; expectedRevision: number;
  }): DepartmentRuntimeWriteResult {
    try {
      const read = this.readSnapshot(root, workspace);
      if (!read.ok || !read.snapshot?.value.employeeAllocation) throw new Error(read.ok ? "部门员工额度尚未初始化。" : read.error);
      const value = read.snapshot.value;
      if (!value.runtime.leaders.some((member) => member.taskId === request.leaderTaskId)) throw new Error("部门组长身份无效。");
      const state = saveDepartmentEmployeeLimit(value.employeeAllocation!, { ...request, rootTaskId: root });
      if (state.maxEmployees !== value.capacity.maxEmployees || state.maxLeaders !== value.capacity.maxLeaders) throw new Error("部门额度配置尚未同步。");
      if (JSON.stringify(state) === JSON.stringify(value.employeeAllocation)) return { ok: true };
      value.employeeAllocation = state;
      return this.commitValidated(value);
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  /** Occupancy comes from live leases at the synchronous grant boundary, never disk history. */
  beginEmployeeAdmission(workspace: string, occupancy: DepartmentEmployeeAdmissionOccupancy):
    { ok: true; evaluation: DepartmentEmployeeAdmissionEvaluation } | { ok: false; error: string } {
    try {
      const read = this.readSnapshot(occupancy.rootTaskId, workspace);
      if (!read.ok || !read.snapshot?.value.employeeAllocation) throw new Error(read.ok ? "部门员工额度尚未初始化。" : read.error);
      const value = read.snapshot.value;
      if (!value.runtime.leaders.some((member) => member.taskId === occupancy.leaderTaskId)) throw new Error("部门组长身份无效。");
      if (value.employeeAllocation!.maxEmployees !== value.capacity.maxEmployees
        || value.employeeAllocation!.maxLeaders !== value.capacity.maxLeaders) throw new Error("部门额度配置尚未同步。");
      const result = beginDepartmentEmployeeAdmission(value.employeeAllocation!, occupancy);
      if (JSON.stringify(result.state) !== JSON.stringify(value.employeeAllocation)) {
        value.employeeAllocation = result.state;
        const commit = this.commitValidated(value);
        if (!commit.ok) return commit;
      }
      return { ok: true, evaluation: result.evaluation };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }

  /** Trusted host port. Returns only after the bound identity is durable. It
   * never launches, guesses a session, edits receipts or grants a capacity lease.
   * Ownership of this runtime store remains with the existing single EH writer. */
  bindExecution(root: string, workspace: string, binding: DepartmentExecutionBinding): DepartmentRuntimeWriteResult {
    try {
      binding = structuredClone(binding);
      if (!isDepartmentExecutionBinding(binding)) return { ok: false, error: "部门执行身份尚未完整绑定。" };
      const read = this.readSnapshot(root, workspace);
      if (!read.ok || !read.snapshot) return { ok: false, error: read.ok ? "部门运行快照缺失。" : read.error };
      const { value, members, bindings, slots } = read.snapshot, identity = binding.identity;
      const duplicate = bindings.get(identity.executionId);
      if (duplicate) return sameBinding(duplicate, binding) ? { ok: true } : { ok: false, error: "部门执行身份或清理策略冲突。" };
      const member = members.get(memberKey(identity.leaderTaskId, identity.moduleId));
      if (identity.rootTaskId !== root || identity.workspace !== workspace || !member || member.generation !== identity.generation
        || !value.capacity.leaders.includes(identity.moduleId)
        || (identity.role === "employee" && !value.capacity.employees.includes(JSON.stringify([identity.leaderTaskId, identity.attemptId])))) {
        return { ok: false, error: "部门执行身份没有对应的当前代次与容量租约。" };
      }
      if (slots.has(bindingSlot(binding))) return { ok: false, error: "部门执行身份存在同代次槽位冲突。" };
      if (read.snapshot.sets.has(leaderExecutionScopeKey(identity))) return { ok: false, error: "leader-execution-registration-required" };
      // The old snapshot was fully validated once above. Check only the new
      // binding against its indexes, then commit without a second read/clone.
      value.executionBindings = [...(value.executionBindings ?? []), binding];
      return this.commitValidated(value);
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }

  /** All lifecycle ports below belong to the same existing synchronous EH
   * writer. Do not expose them to webview/model RPC or another process. */
  private mutateExecutionSet(scope: DepartmentLeaderExecutionScope,
    change: (snapshot: ValidatedRuntime, key: string) => DepartmentRuntimeWriteResult): DepartmentRuntimeWriteResult {
    try {
      scope = structuredClone(scope);
      if (!isLeaderExecutionScope(scope)) throw new Error("leader-execution-scope-invalid");
      const read = this.readSnapshot(scope.rootTaskId, scope.workspace);
      if (!read.ok || !read.snapshot) throw new Error(read.ok ? "leader-execution-runtime-missing" : read.error);
      const member = read.snapshot.members.get(memberKey(scope.leaderTaskId, scope.moduleId));
      if (member?.generation !== scope.generation) throw new Error("leader-execution-generation-conflict");
      return change(read.snapshot, leaderExecutionScopeKey(scope));
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  openLeaderExecutionSet(scope: DepartmentLeaderExecutionScope, producerId: string): DepartmentRuntimeWriteResult {
    return this.mutateExecutionSet(scope, (snapshot, key) => {
      if (!identifier(producerId)) throw new Error("leader-execution-producer-invalid");
      const old = snapshot.sets.get(key);
      if (old) return old.value.producerId === producerId && old.value.state === "open"
        ? { ok: true } : { ok: false, error: "leader-execution-producer-or-closure-conflict" };
      if (snapshot.bindingScopes.has(key)) throw new Error("leader-execution-legacy-untracked-bindings");
      snapshot.value.leaderExecutionSets = [...(snapshot.value.leaderExecutionSets ?? []), {
        version: 1, scope: structuredClone(scope), producerId, state: "open", closure: null, entries: [],
      }];
      return this.commitValidated(snapshot.value);
    });
  }
  registerLeaderExecution(scope: DepartmentLeaderExecutionScope, producerId: string,
    responsibility: DepartmentExecutionResponsibility): DepartmentRuntimeWriteResult {
    responsibility = structuredClone(responsibility);
    return this.mutateExecutionSet(scope, (snapshot, key) => {
      const set = snapshot.sets.get(key);
      if (!set || set.value.producerId !== producerId || set.value.state !== "open") throw new Error("leader-execution-set-not-open");
      if (!isExecutionResponsibility(responsibility)) throw new Error("leader-execution-responsibility-invalid");
      const old = set.entries.get(responsibility.registrationId);
      if (old) return responsibilityKey(old.responsibility) === responsibilityKey(responsibility)
        ? { ok: true } : { ok: false, error: "leader-execution-responsibility-conflict" };
      if (set.targets.has(responsibilityTarget(responsibility))) throw new Error("leader-execution-target-conflict");
      set.value.entries.push({ responsibility, executionId: null });
      return this.commitValidated(snapshot.value);
    });
  }
  bindLeaderExecution(scope: DepartmentLeaderExecutionScope, producerId: string, registrationId: string,
    binding: DepartmentExecutionBinding): DepartmentRuntimeWriteResult {
    binding = structuredClone(binding);
    return this.mutateExecutionSet(scope, (snapshot, key) => {
      const set = snapshot.sets.get(key), entry = set?.entries.get(registrationId);
      if (!set || !entry || set.value.producerId !== producerId || set.value.state !== "open") throw new Error("leader-execution-set-not-open");
      if (!isDepartmentExecutionBinding(binding) || !responsibilityMatchesBinding(scope, entry.responsibility, binding)) {
        throw new Error("leader-execution-binding-contract-conflict");
      }
      const identity = binding.identity, old = snapshot.bindings.get(identity.executionId);
      if (entry.executionId !== null) return entry.executionId === identity.executionId && old && sameBinding(old, binding)
        ? { ok: true } : { ok: false, error: "leader-execution-identity-immutable" };
      if (old || snapshot.slots.has(bindingSlot(binding))) throw new Error("leader-execution-slot-conflict");
      if (!snapshot.value.capacity.leaders.includes(scope.moduleId) || (identity.role === "employee"
        && !snapshot.value.capacity.employees.includes(JSON.stringify([scope.leaderTaskId, identity.attemptId])))) {
        throw new Error("leader-execution-capacity-missing");
      }
      // Register reference and existing binding in ONE atomic commit.
      entry.executionId = identity.executionId;
      snapshot.value.executionBindings = [...(snapshot.value.executionBindings ?? []), binding];
      return this.commitValidated(snapshot.value);
    });
  }
  closeLeaderExecutionSet(scope: DepartmentLeaderExecutionScope, closure: DepartmentLeaderProducerClosure): DepartmentRuntimeWriteResult {
    closure = structuredClone(closure);
    return this.mutateExecutionSet(scope, (snapshot, key) => {
      const set = snapshot.sets.get(key);
      if (!set || !isProducerClosure(closure, set.value.producerId, scope)) throw new Error("leader-execution-producer-closure-invalid");
      if (set.value.state === "closed") return set.value.closure?.admissionFence === closure.admissionFence
        ? { ok: true } : { ok: false, error: "leader-execution-closure-immutable" };
      if (!set.targets.has(JSON.stringify(["leader"]))) throw new Error("leader-execution-coordinator-missing");
      set.value.state = "closed"; set.value.closure = closure;
      return this.commitValidated(snapshot.value);
    });
  }
  /** One cold read and one validation/index pass. Historical or missing sets
   * remain unobservable; no empty set is synthesized for old snapshots. */
  readLeaderExecutionSet(scope: DepartmentLeaderExecutionScope): { ok: true; value: {
    set: DepartmentLeaderExecutionSet; bindings: DepartmentExecutionBinding[] } | null } | { ok: false; error: string } {
    if (!isLeaderExecutionScope(scope)) return { ok: false, error: "leader-execution-scope-invalid" };
    const read = this.readSnapshot(scope.rootTaskId, scope.workspace);
    if (!read.ok) return read;
    const snapshot = read.snapshot;
    if (!snapshot || snapshot.members.get(memberKey(scope.leaderTaskId, scope.moduleId))?.generation !== scope.generation) {
      return { ok: true, value: null };
    }
    const set = snapshot.sets.get(leaderExecutionScopeKey(scope));
    if (!set) return { ok: true, value: null };
    return { ok: true, value: { set: set.value, bindings: set.value.entries.flatMap((entry) =>
      entry.executionId === null ? [] : [snapshot.bindings.get(entry.executionId)!]) } };
  }
}

function sameBinding(a: DepartmentExecutionBinding, b: DepartmentExecutionBinding): boolean {
  // Both arguments have already passed full binding validation in this call.
  return sameExecution(a.identity, b.identity)
    && CLEANUP_PARTS.every((part) => a.requirements[part] === b.requirements[part]);
}
