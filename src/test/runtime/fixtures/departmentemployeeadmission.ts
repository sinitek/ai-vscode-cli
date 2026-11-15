import assert = require("node:assert/strict");
import { createDepartmentEmployeeExecutionAdmission } from "../../../extensionHost/departmentemployeeexecutionadmission";
import { DepartmentLeaderExecutionLedger, leaderExecutionScopeKey, type DepartmentLeaderExecutionProducer,
  type DepartmentLeaderExecutionScope } from "../../../extensionHost/departmentleaderexecutionledger";
import type { DepartmentRuntimeStore } from "../../../extensionHost/departmentruntimestore";

/** Controlled test producer only. Tracks in-flight admission and revocation;
 * deliberately cannot produce a closure or prove production cleanup. */
export function fixtureEmployeeAdmission(store: DepartmentRuntimeStore, workspace = "workspace", overlay: "required" | "absent" = "absent") {
  const scope: DepartmentLeaderExecutionScope = { rootTaskId: "root", workspace, leaderTaskId: "leader", moduleId: "module", generation: 1 };
  let tracked = false, revoked = false, active = 0;
  const same = (value: DepartmentLeaderExecutionScope) => leaderExecutionScopeKey(value) === leaderExecutionScopeKey(scope);
  const producer: DepartmentLeaderExecutionProducer = {
    producerId: "controlled-bootstrap-producer",
    beginTracking(value) { if (revoked || !same(value)) return false; tracked = true; return true; },
    isCurrent(value) { return tracked && !revoked && same(value); },
    async withAdmission(value, work) {
      if (!this.isCurrent(value)) throw new Error("fixture-admission-revoked");
      active++;
      try { return await work(); } finally { active--; }
    },
    async closeAdmissionsAndDrain() { throw new Error("fixture-cannot-prove-production-closure"); },
  };
  const ledger = new DepartmentLeaderExecutionLedger(store, producer);
  assert.equal(ledger.open(scope).ok, true);
  return { port: createDepartmentEmployeeExecutionAdmission(store, producer, { processOverlay: overlay }),
    scope, ledger, revoke() { revoked = true; }, get active() { return active; },
    entries() {
      const read = store.readLeaderExecutionSet(scope);
      assert.ok(read.ok && read.value); return read.value.set.entries;
    },
  };
}
