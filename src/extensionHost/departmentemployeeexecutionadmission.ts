import { createHash } from "crypto";
import { CLEANUP_PARTS, type CleanupRequirements, type DepartmentExecutionSelection } from "../runtime/departmentexecutionidentity";
import { DepartmentLeaderExecutionLedger, leaderExecutionCanLaunch, responsibilityKey, type DepartmentLeaderExecutionProducer,
  type DepartmentLeaderExecutionScope, type DepartmentExecutionResponsibility } from "./departmentleaderexecutionledger";
import type { DepartmentRuntimeStore } from "./departmentruntimestore";
import type { DepartmentExecutionBinding } from "./departmentruntimestate";

declare const admissionBrand: unique symbol;
/** In-memory host capability. Never deserialize or accept from a task/UI/model. */
export type DepartmentEmployeeExecutionAdmission = { readonly [admissionBrand]: true };
type Capability = {
  store: DepartmentRuntimeStore; producer: DepartmentLeaderExecutionProducer;
  ledger: DepartmentLeaderExecutionLedger; processOverlay(selection: DepartmentExecutionSelection): boolean;
};
const capabilities = new WeakMap<DepartmentEmployeeExecutionAdmission, Capability>();

/** The coordinator must already have opened this exact generation through Ledger.open.
 * This factory neither adopts legacy bindings nor implements a producer/closure.
 * Overlay policy is fixed by the trusted configuration strategy BEFORE its builder runs. */
export function createDepartmentEmployeeExecutionAdmission(store: DepartmentRuntimeStore,
  producer: DepartmentLeaderExecutionProducer, policy: { processOverlay: "required" | "absent" | ((selection: DepartmentExecutionSelection) => boolean) }): DepartmentEmployeeExecutionAdmission {
  if (!producer || !(typeof policy.processOverlay === "function" || ["required", "absent"].includes(policy.processOverlay))) throw new Error("department-employee-admission-policy-invalid");
  const port = Object.freeze({}) as DepartmentEmployeeExecutionAdmission;
  const overlayPolicy = policy.processOverlay;
  const processOverlay = typeof overlayPolicy === "function" ? overlayPolicy : () => overlayPolicy === "required";
  capabilities.set(port, { store, producer, ledger: new DepartmentLeaderExecutionLedger(store, producer), processOverlay });
  return port;
}

export type DepartmentEmployeeAdmissionContext = {
  assertCurrent(): void;
  assertProcessOverlay(present: boolean): void;
  assertRequirements(actual: CleanupRequirements): void;
  bind(binding: DepartmentExecutionBinding): void;
};

/** Only called after the preparer's authoritative task/scheduler/capacity checks.
 * Ledger persists responsibility before invoking work and owns the atomic bind. */
export async function admitDepartmentEmployeeExecution<T>(port: DepartmentEmployeeExecutionAdmission | null | undefined,
  store: DepartmentRuntimeStore, scope: DepartmentLeaderExecutionScope, target: { subtaskId: string; attemptId: string },
  selection: DepartmentExecutionSelection, work: (context: DepartmentEmployeeAdmissionContext) => Promise<T>): Promise<T> {
  const capability = port && capabilities.get(port);
  if (!capability || capability.store !== store) throw new Error("department-employee-admission-unavailable");
  scope = structuredClone(scope); selection = structuredClone(selection); target = structuredClone(target);
  if (selection.cli !== "codex" && selection.cli !== "opencode") throw new Error("department-employee-admission-cli-unsupported");
  // Mirrors the fixed production workers: both own root/links/session/tab;
  // Codex owns a turn and config lease, process temp is its configuration overlay.
  const overlayExpected = selection.cli === "opencode" && capability.processOverlay(structuredClone(selection));
  if (typeof overlayExpected !== "boolean") throw new Error("department-employee-admission-policy-invalid");
  const requirements: CleanupRequirements = { processTerminal: true, turnTerminal: selection.cli === "codex", streams: true,
    runner: true, executionRoot: true, links: true, temp: selection.cli === "codex" || overlayExpected, tab: true };
  const registrationId = "employee-" + createHash("sha256").update(JSON.stringify([
    scope.rootTaskId, scope.workspace, scope.leaderTaskId, scope.moduleId, scope.generation, target.subtaskId, target.attemptId,
  ])).digest("hex");
  const responsibility: DepartmentExecutionResponsibility = { registrationId, target: { role: "employee", ...target }, selection, requirements };
  return capability.ledger.admit(scope, responsibility, async (bind) => {
    let active = true;
    const assertCurrent = () => {
      if (!active || !leaderExecutionCanLaunch(capability.producer, scope)) throw new Error("department-employee-admission-revoked");
    };
    const assertRequirements = (actual: CleanupRequirements) => {
      if (!actual || CLEANUP_PARTS.some((part) => actual[part] !== requirements[part])) throw new Error("department-employee-requirements-conflict");
    };
    try {
      assertCurrent();
      return await work({ assertCurrent, assertRequirements,
        assertProcessOverlay(present) {
          if (present !== overlayExpected) throw new Error("department-employee-overlay-policy-conflict");
        },
        bind(binding) {
          assertCurrent(); assertRequirements(binding.requirements);
          const result = bind(binding);
          if (!result.ok) throw new Error(`department-employee-binding-persistence-failed:${result.error}`);
          const read = store.readLeaderExecutionSet(scope);
          if (!read.ok || !read.value) throw new Error("department-employee-binding-readback-failed");
          const entry = read.value.set.entries.find((v) => v.responsibility.registrationId === registrationId);
          const saved = read.value.bindings.find((v) => v.identity.executionId === binding.identity.executionId);
          if (!entry || entry.executionId !== binding.identity.executionId || responsibilityKey(entry.responsibility) !== responsibilityKey(responsibility)
            || JSON.stringify(saved) !== JSON.stringify(binding)) throw new Error("department-employee-binding-readback-failed");
          assertCurrent();
        },
      });
    } finally { active = false; }
  });
}
