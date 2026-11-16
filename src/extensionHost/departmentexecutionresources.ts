import { takeDepartmentColdRestoredTab, type DepartmentColdRestoredTab } from "./departmentcoldgenerationrecovery";
import { canonicalIdentity, isDepartmentExecutionIdentity, sameExecution, type CleanupResult, type DepartmentExecutionIdentity } from "../runtime/departmentexecutionidentity";

/** In-memory capabilities only. A persisted tab ID or a structurally similar
 * object cannot confer ownership. Unknown responsibilities are never evicted. */
export type DepartmentExecutionTabTarget = Readonly<{ kind: "department-created-tab" }>;
export type DepartmentExecutionTabCapability = Readonly<{ kind: "department-owned-tab" }>;
type Tab = { id: string; cli: string; sessionId: string | null };
type Entry = { tab: Tab; workspace: string; consumers: Set<Promise<void>>; consumerFailed?: boolean; identity?: DepartmentExecutionIdentity;
  restored?: { scope: { rootTaskId: string; leaderTaskId: string; moduleId: string; generation: number }; retired(): boolean }; session?: string | null; capability?: DepartmentExecutionTabCapability; releaseIdentity?: string; release?: Promise<CleanupResult> };
const targets = new WeakMap<DepartmentExecutionTabTarget, { entry: Entry; release(i: DepartmentExecutionIdentity): Promise<CleanupResult> }>();
const capabilities = new WeakMap<DepartmentExecutionTabCapability, (i: DepartmentExecutionIdentity) => Promise<CleanupResult>>();
const unknown = (reason: string): CleanupResult => ({ status: "unobservable", reason });

export function bindDepartmentExecutionTab(target: DepartmentExecutionTabTarget | undefined, identity: DepartmentExecutionIdentity): DepartmentExecutionTabCapability | undefined {
  const owned = target && targets.get(target);
  if (!owned) return undefined;
  if (!isDepartmentExecutionIdentity(identity) || identity.cli !== owned.entry.tab.cli || identity.workspace !== owned.entry.workspace) throw new Error("department-tab-execution-identity-invalid");
  const e = owned.entry;
  if (e.restored && (!e.restored.retired() || identity.role !== "leader" || identity.rootTaskId !== e.restored.scope.rootTaskId
    || identity.leaderTaskId !== e.restored.scope.leaderTaskId || identity.moduleId !== e.restored.scope.moduleId
    || identity.generation <= e.restored.scope.generation)) throw new Error("department-tab-restored-scope-conflict");
  if (e.release) throw new Error("department-tab-release-already-requested");
  if (e.tab.sessionId !== e.session) throw new Error("department-tab-session-changed-before-binding");
  if (e.identity && !sameExecution(e.identity, identity)) throw new Error("department-tab-identity-conflict");
  if (!e.identity) {
    e.identity = structuredClone(identity);
    e.capability = Object.freeze({ kind: "department-owned-tab" });
    capabilities.set(e.capability, owned.release);
  }
  return e.capability;
}
export function releaseDepartmentExecutionTab(capability: DepartmentExecutionTabCapability | undefined, identity: DepartmentExecutionIdentity): Promise<CleanupResult> {
  return capability && capabilities.has(capability) ? capabilities.get(capability)!(identity)
    : Promise.resolve(unknown("department-tab-capability-unavailable"));
}

export function createDepartmentExecutionResources(deps: {
  workspace(): string; readTab(id: string): Tab | null; isActive(id: string): boolean;
  /** Exact original persisted binding AND current generation; closing is allowed. */
  owns(identity: DepartmentExecutionIdentity): boolean;
  /** Actual host tab close port. Must neither stop a native task nor await receipt. */
  close(tab: Tab): Promise<void>;
}) {
  const entries = new Map<string, Entry>();
  return {
    recordRestored(capability: DepartmentColdRestoredTab): void {
      const proof = takeDepartmentColdRestoredTab(capability), tab = proof.tab;
      if (entries.has(tab.id) || entries.size >= 256 || deps.workspace() !== proof.scope.workspace
        || deps.readTab(tab.id) !== tab || deps.isActive(tab.id) || !["codex", "opencode"].includes(tab.cli)
        || tab.sessionId !== proof.localSession) throw new Error("department-tab-restoration-conflict-or-capacity");
      entries.set(tab.id, { tab, workspace: proof.scope.workspace, session: proof.localSession, consumers: new Set(),
        restored: { scope: proof.scope, retired: proof.retired } });
    },
    recordCreated(tabId: string): void {
      const tab = deps.readTab(tabId);
      if (!tab || entries.has(tabId) || entries.size >= 256) throw new Error("department-tab-creation-conflict-or-capacity");
      entries.set(tabId, { tab, session: tab.sessionId, workspace: deps.workspace(), consumers: new Set() });
    },
    /** Only the existing synchronous local-session writer calls this. A model,
     * restored task or arbitrary tab edit cannot refresh an ownership snapshot. */
    confirmSessionTransition(tabId: string, previous: string | null, next: string | null): void {
      const e = entries.get(tabId);
      if (!e) return;
      if (e.release || e.identity || e.session !== previous || e.tab.sessionId !== next || deps.readTab(tabId) !== e.tab || deps.workspace() !== e.workspace) {
        throw new Error("department-tab-local-session-transition-conflict");
      }
      e.session = next;
    },
    beginConsumer(tabId: string): { target: DepartmentExecutionTabTarget; finish(consumed?: boolean): void } {
      const e = entries.get(tabId);
      if (!e || e.restored && (!e.restored.retired() || deps.isActive(tabId)) || e.release || e.consumerFailed || deps.readTab(tabId) !== e.tab || e.workspace !== deps.workspace() || e.consumers.size >= 64) throw new Error("department-tab-not-owned-or-consumer-capacity");
      if (e.tab.sessionId !== e.session) throw new Error("department-tab-local-session-changed");
      let finish!: () => void;
      const consumer = new Promise<void>((r) => { finish = r; }); e.consumers.add(consumer);
      const target: DepartmentExecutionTabTarget = Object.freeze({ kind: "department-created-tab" });
      targets.set(target, { entry: e, release: (candidate) => {
        // Reject conflicting requests even after an earlier successful release.
        const bound = e.identity && isDepartmentExecutionIdentity(candidate) && candidate.session.state === "bound"
          && (e.identity.session.state === "unbound" || e.identity.session.id === candidate.session.id)
          && sameExecution({ ...e.identity, session: candidate.session }, candidate);
        if (!bound) return Promise.resolve(unknown("department-tab-release-identity-conflict"));
        if (e.release) return e.releaseIdentity === canonicalIdentity(candidate) ? e.release : Promise.resolve(unknown("department-tab-release-identity-conflict"));
        const identity = structuredClone(candidate), key = canonicalIdentity(identity);
        e.releaseIdentity = key;
        e.release = (async () => {
          // Retain original consumer responsibilities. No polling/idle timeout,
          // adapter termination, Owner receipt or capacity-return dependency.
          while (e.consumers.size) await Promise.all([...e.consumers]);
          const valid = () => !e.consumerFailed && deps.workspace() === e.workspace && identity.workspace === e.workspace
            && deps.readTab(tabId) === e.tab && e.tab.cli === identity.cli && !deps.isActive(tabId)
            && (e.tab.sessionId === e.session || identity.role === "employee" && identity.session.state === "bound" && e.tab.sessionId === identity.session.id)
            && deps.owns(identity) && canonicalIdentity(identity) === key;
          if (!valid()) return unknown("department-tab-owner-or-target-changed");
          try { await deps.close(e.tab); }
          catch { return { status: "failed", reason: "department-tab-close-failed" } as CleanupResult; }
          if (deps.readTab(tabId) !== null || deps.workspace() !== e.workspace || !deps.owns(identity)) return unknown("department-tab-close-readback-unconfirmed");
          // The capability retains its immutable idempotent result; only proven
          // released entries leave the admission table. Unknown entries stay.
          if (entries.get(tabId) === e) entries.delete(tabId);
          return { status: "confirmed", evidence: "department-exact-owned-tab-closed-and-read-back" } as CleanupResult;
        })();
        return e.release;
      } });
      let finished = false;
      return { target, finish(consumed = true) { if (!finished) { finished = true; if (!consumed) e.consumerFailed = true; e.consumers.delete(consumer); finish(); } } };
    },
  };
}
