import { createHash } from "crypto";
import { CLEANUP_PARTS, canonicalIdentity, exactKeys, fingerprintDepartmentExecutionSelection, identifier,
  isCleanupRequirements, record, type CleanupRequirements, type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import type { DepartmentRuntimeStore, DepartmentRuntimeWriteResult } from "./departmentruntimestore";

export type DepartmentLeaderExecutionScope = {
  rootTaskId: string; workspace: string; leaderTaskId: string; moduleId: string; generation: number;
};
/** Responsibility exists BEFORE native preparation. Null executionId retains
 * unbound/failed/unsupported attempts; it is never a synthetic Owner identity. */
export type DepartmentExecutionResponsibility = {
  registrationId: string;
  target: { role: "leader" } | { role: "employee"; subtaskId: string; attemptId: string };
  selection: DepartmentExecutionSelection;
  requirements: CleanupRequirements;
};
export type DepartmentLeaderProducerClosure = { version: 1; scope: DepartmentLeaderExecutionScope; producerId: string; admissionFence: string };
export type DepartmentLeaderExecutionSet = {
  version: 1; scope: DepartmentLeaderExecutionScope; producerId: string;
  state: "open" | "closed";
  closure: DepartmentLeaderProducerClosure | null;
  entries: { responsibility: DepartmentExecutionResponsibility; executionId: string | null }[];
};

export function isLeaderExecutionScope(value: unknown): value is DepartmentLeaderExecutionScope {
  return record(value) && exactKeys(value, ["rootTaskId", "workspace", "leaderTaskId", "moduleId", "generation"])
    && [value.rootTaskId, value.leaderTaskId, value.moduleId].every(identifier)
    && typeof value.workspace === "string" && value.workspace.length > 0 && value.workspace.length <= 1024
    && value.workspace.trim() === value.workspace && !/[\x00-\x1f\x7f]/.test(value.workspace)
    && Number.isSafeInteger(value.generation) && (value.generation as number) >= 1;
}
export const leaderExecutionScopeKey = (scope: DepartmentLeaderExecutionScope): string =>
  JSON.stringify([scope.rootTaskId, scope.workspace, scope.leaderTaskId, scope.moduleId, scope.generation]);
export function isExecutionResponsibility(value: unknown): value is DepartmentExecutionResponsibility {
  if (!record(value) || !exactKeys(value, ["registrationId", "target", "selection", "requirements"])
    || !identifier(value.registrationId) || !record(value.target) || !isCleanupRequirements(value.requirements)) return false;
  const target = value.target;
  if (!(target.role === "leader" && exactKeys(target, ["role"]))
    && !(target.role === "employee" && exactKeys(target, ["role", "subtaskId", "attemptId"])
      && identifier(target.subtaskId) && identifier(target.attemptId))) return false;
  try { fingerprintDepartmentExecutionSelection(value.selection as DepartmentExecutionSelection);
    return (value.selection as DepartmentExecutionSelection).role === target.role;
  } catch { return false; }
}
export function responsibilityKey(value: DepartmentExecutionResponsibility): string {
  const s = value.selection, t = value.target;
  return JSON.stringify([value.registrationId, t.role, t.role === "employee" ? t.subtaskId : null,
    t.role === "employee" ? t.attemptId : null, s.version, s.cli, s.role, s.configId, s.revision, s.model,
    s.thinkingMode, s.openCodeVariant, ...CLEANUP_PARTS.map((part) => value.requirements[part])]);
}
export function responsibilityMatchesBinding(scope: DepartmentLeaderExecutionScope, r: DepartmentExecutionResponsibility,
  binding: DepartmentExecutionBinding): boolean {
  const i = binding.identity, t = r.target, s = binding.selection;
  return leaderExecutionScopeKey(i) === leaderExecutionScopeKey(scope) && t.role === i.role
    && (t.role !== "employee" || i.role === "employee" && t.subtaskId === i.subtaskId && t.attemptId === i.attemptId)
    && responsibilityKey(r) === responsibilityKey({ ...r, selection: s, requirements: binding.requirements });
}
export function isProducerClosure(value: unknown, producerId: string, scope: DepartmentLeaderExecutionScope): value is DepartmentLeaderProducerClosure {
  return record(value) && exactKeys(value, ["version", "scope", "producerId", "admissionFence"])
    && value.version === 1 && value.producerId === producerId && identifier(value.producerId) && identifier(value.admissionFence)
    && isLeaderExecutionScope(value.scope) && leaderExecutionScopeKey(value.scope) === leaderExecutionScopeKey(scope);
}
/** Includes bound identities for the final post-wait comparison, not merely IDs. */
export function leaderExecutionSetFingerprint(set: DepartmentLeaderExecutionSet, bindings: DepartmentExecutionBinding[]): string {
  return createHash("sha256").update(JSON.stringify([set.version, leaderExecutionScopeKey(set.scope), set.producerId,
    set.state, set.closure && [set.closure.version, leaderExecutionScopeKey(set.closure.scope), set.closure.producerId, set.closure.admissionFence],
    set.entries.map((e) => [responsibilityKey(e.responsibility), e.executionId]),
    bindings.map((b) => canonicalIdentity(b.identity))])).digest("hex");
}

/** HOST capability, never deserialize from task/model/UI data. Implementation
 * must cover the whole coordinator from BEFORE first preparation; it must not
 * adopt an old untracked generation. withAdmission owns native preparation and
 * launch grants; close atomically fences new admission/grants and drains ALL
 * existing admissions before returning its durable-fence identifier. A settled
 * task promise, timer or an empty local Map cannot implement this contract.
 * No production capability is installed by this library. */
export interface DepartmentLeaderExecutionProducer {
  readonly producerId: string;
  beginTracking(scope: DepartmentLeaderExecutionScope): boolean;
  isCurrent(scope: DepartmentLeaderExecutionScope): boolean;
  /** Identity remains current during closure; grants need the stronger live fence. */
  canLaunch?(scope: DepartmentLeaderExecutionScope): boolean;
  withAdmission<T>(scope: DepartmentLeaderExecutionScope, work: () => Promise<T>): Promise<T>;
  closeAdmissionsAndDrain(scope: DepartmentLeaderExecutionScope): Promise<DepartmentLeaderProducerClosure>;
}

export function leaderExecutionCanLaunch(producer: DepartmentLeaderExecutionProducer, scope: DepartmentLeaderExecutionScope): boolean {
  return producer.isCurrent(structuredClone(scope)) && (producer.canLaunch?.(structuredClone(scope)) ?? true);
}

export class DepartmentLeaderExecutionLedger {
  constructor(private readonly store: DepartmentRuntimeStore, private readonly producer: DepartmentLeaderExecutionProducer | null) {}
  open(scope: DepartmentLeaderExecutionScope): DepartmentRuntimeWriteResult {
    scope = structuredClone(scope);
    if (!isLeaderExecutionScope(scope) || !this.producer || !identifier(this.producer.producerId)
      || !this.producer.beginTracking(structuredClone(scope)) || !this.producer.isCurrent(structuredClone(scope))) {
      return { ok: false, error: "leader-execution-producer-unavailable" };
    }
    return this.store.openLeaderExecutionSet(scope, this.producer.producerId);
  }
  /** Persistence precedes work (including native preparation). Bind must succeed
   * before the trusted caller grants start. Failed work leaves its responsibility
   * on disk. Even a duplicate registration is checked for policy conflicts. */
  async admit<T>(scope: DepartmentLeaderExecutionScope, responsibility: DepartmentExecutionResponsibility,
    work: (bind: (binding: DepartmentExecutionBinding) => DepartmentRuntimeWriteResult) => Promise<T>): Promise<T> {
    scope = structuredClone(scope); responsibility = structuredClone(responsibility);
    const producer = this.producer;
    if (!producer || !isLeaderExecutionScope(scope) || !producer.isCurrent(structuredClone(scope))) throw new Error("leader-execution-producer-unavailable");
    return producer.withAdmission(structuredClone(scope), async () => {
      if (!leaderExecutionCanLaunch(producer, scope)) throw new Error("leader-execution-producer-unavailable");
      const registered = this.store.registerLeaderExecution(scope, producer.producerId, responsibility);
      if (!registered.ok) throw new Error(registered.error);
      let active = true;
      try { return await work((binding) => active && leaderExecutionCanLaunch(producer, scope)
        ? this.store.bindLeaderExecution(scope, producer.producerId, responsibility.registrationId, binding)
        : { ok: false, error: "leader-execution-admission-ended" }); }
      finally { active = false; }
    });
  }
  async close(scope: DepartmentLeaderExecutionScope): Promise<DepartmentRuntimeWriteResult> {
    scope = structuredClone(scope);
    const producer = this.producer;
    if (!producer || !isLeaderExecutionScope(scope) || !producer.isCurrent(structuredClone(scope))) return { ok: false, error: "leader-execution-producer-unavailable" };
    try {
      const closure = await producer.closeAdmissionsAndDrain(structuredClone(scope));
      if (!producer.isCurrent(structuredClone(scope)) || !isProducerClosure(closure, producer.producerId, scope)) throw new Error("leader-execution-producer-closure-invalid");
      return this.store.closeLeaderExecutionSet(scope, closure);
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}
