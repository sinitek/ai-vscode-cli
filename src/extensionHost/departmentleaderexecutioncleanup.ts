import * as path from "path";
import { DepartmentExecutionOwnerClient } from "../runtime/departmentexecutionownerclient";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";
import { leaderExecutionSetFingerprint, type DepartmentLeaderExecutionScope } from "./departmentleaderexecutionledger";
import { DepartmentRuntimeStore } from "./departmentruntimestore";

/** Read-only, serial aggregation of a persisted CLOSED set, including the
 * coordinator producer's own execution. No start/handoff/stop/capacity methods.
 * Original host clients may retain a strict prior socket observation. */
export class DepartmentLeaderExecutionCleanup {
  constructor(private readonly store: DepartmentRuntimeStore, private readonly ownerDirectory: string,
    private readonly verifySelection: (binding: DepartmentExecutionBinding) => Promise<boolean>,
    private readonly originalClient?: (binding: DepartmentExecutionBinding) => DepartmentExecutionOwnerClient | null,
    private readonly verifyBindings?: (bindings: readonly DepartmentExecutionBinding[]) => Promise<boolean>) {}

  observe(scope: DepartmentLeaderExecutionScope, signal?: AbortSignal): { done: Promise<void> } | null {
    scope = structuredClone(scope);
    const initial = this.store.readLeaderExecutionSet(scope);
    if (!initial.ok || !initial.value) return null;
    const { set, bindings } = initial.value;
    if (set.state !== "closed" || !set.closure || !set.entries.length || bindings.length !== set.entries.length
      || set.entries.filter((entry) => entry.responsibility.target.role === "leader").length !== 1) return null;
    const fingerprint = leaderExecutionSetFingerprint(set, bindings);
    const done = (async (): Promise<void> => {
      if (signal?.aborted) throw new Error("leader-cleanup-observation-cancelled");
      if (this.verifyBindings && !await this.verifyBindings(structuredClone(bindings))) throw new Error("leader-cleanup-selection-conflict");
      for (const binding of bindings) {
        if (signal?.aborted) throw new Error("leader-cleanup-observation-cancelled");
        if (!this.verifyBindings && !await this.verifySelection(structuredClone(binding))) throw new Error("leader-cleanup-selection-conflict");
        if (signal?.aborted) throw new Error("leader-cleanup-observation-cancelled");
        const client = this.originalClient ? this.originalClient(structuredClone(binding))
          : new DepartmentExecutionOwnerClient(path.join(this.ownerDirectory, binding.identity.ownerId));
        if (!client) throw new Error("leader-cleanup-original-observation-unavailable");
        await client.waitForCleanup(binding.identity, binding.requirements, signal);
      }
      if (signal?.aborted) throw new Error("leader-cleanup-observation-cancelled");
      // Policy can change while another Owner/consumer is draining.
      if (this.verifyBindings && !await this.verifyBindings(structuredClone(bindings))) throw new Error("leader-cleanup-selection-conflict");
      for (const binding of bindings) {
        if (signal?.aborted) throw new Error("leader-cleanup-observation-cancelled");
        if (!this.verifyBindings && !await this.verifySelection(structuredClone(binding))) throw new Error("leader-cleanup-selection-conflict");
      }
      if (signal?.aborted) throw new Error("leader-cleanup-observation-cancelled");
      const current = this.store.readLeaderExecutionSet(scope);
      if (!current.ok || !current.value || current.value.set.state !== "closed"
        || leaderExecutionSetFingerprint(current.value.set, current.value.bindings) !== fingerprint) {
        throw new Error("leader-cleanup-generation-or-set-changed");
      }
    })();
    void done.catch(() => undefined);
    return { done };
  }
}
