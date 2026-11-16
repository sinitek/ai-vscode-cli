import { canonicalIdentity, exactKeys, fingerprintDepartmentExecutionSelection, isDepartmentExecutionIdentity,
  record, sameExecution, type CleanupRequirements, type CleanupResult,
  type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import { runCliProcess, type CliProcessRuntimeHandle, type CliProcessRuntimeLaunch, type CliProcessRuntimeHandlers } from "../cli/cliProcessRuntime";
import type { ExecutionCleanupEvidence, ExecutionTerminalEvidence, TrustedExecutionHandle,
  TrustedExecutionLauncher } from "./departmentexecutionowner";

export type DepartmentProcessResource = {
  owned: boolean;
  /** Must release this execution's resource, without waiting for its receipt or capacity return. */
  release?: () => CleanupResult | Promise<CleanupResult>;
};
export type DepartmentProcessResources = Record<keyof ExecutionCleanupEvidence, DepartmentProcessResource>;
export type PreparedDepartmentProcessExecution = {
  identity: DepartmentExecutionIdentity;
  selection: DepartmentExecutionSelection;
  /** Only an already prepared process execution is supported; never reclassify an interactive turn. */
  executionMode: "process";
  launch: CliProcessRuntimeLaunch;
  /** runner includes the bound native session. temp describes resources in addition to the core overlay. */
  resources: DepartmentProcessResources;
  /** Trusted, bounded output consumer. Business events never authorize cleanup. */
  handlers?: CliProcessRuntimeHandlers;
};
export type DepartmentProcessExecutionResolver =
  (identity: DepartmentExecutionIdentity) => PreparedDepartmentProcessExecution | null;

const RESOURCE_PARTS = ["runner", "executionRoot", "links", "temp", "tab"] as const;
const MAX_PREPARED_EXECUTIONS = 256;
const unavailable = (reason: string): CleanupResult => ({ status: "unobservable", reason });
const notApplicable = (reason: string): CleanupResult => ({ status: "not-applicable", reason });
const confirmed = (evidence: string): CleanupResult => ({ status: "confirmed", evidence });
const NO_TURN = notApplicable("process-execution-has-no-turn-terminal");
type Lifecycle = ExecutionTerminalEvidence & { temp: CleanupResult };
type Snapshot = {
  identity: DepartmentExecutionIdentity;
  selection: DepartmentExecutionSelection;
  requirements: CleanupRequirements;
  launch: CliProcessRuntimeLaunch;
  resources: DepartmentProcessResources;
  handlers: CliProcessRuntimeHandlers;
};
type Entry = { key: string; snapshot?: Snapshot; started?: Promise<TrustedExecutionHandle> };

function validResult(value: unknown): value is CleanupResult {
  if (!record(value)) return false;
  const text = (v: unknown): boolean => typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(v);
  return value.status === "confirmed" ? exactKeys(value, ["status", "evidence"]) && text(value.evidence)
    : ["not-applicable", "failed", "unobservable"].includes(String(value.status))
      && exactKeys(value, ["status", "reason"]) && text(value.reason);
}

function prepareSnapshot(identity: DepartmentExecutionIdentity, prepared: PreparedDepartmentProcessExecution | null): Snapshot {
  if (!prepared || !isDepartmentExecutionIdentity(prepared.identity) || !sameExecution(identity, prepared.identity)
    || prepared.executionMode !== "process") throw new Error("department-process-preparation-unavailable");
  // Validate the original allowlist before copying: extra credential/body fields must be rejected.
  const fingerprints = fingerprintDepartmentExecutionSelection(prepared.selection);
  if (prepared.selection.configId === null || prepared.selection.role !== identity.role || prepared.selection.cli !== identity.cli
    || fingerprints.configFingerprint !== identity.configFingerprint
    || fingerprints.profileFingerprint !== identity.profileFingerprint) throw new Error("department-process-selection-conflict");
  const input = prepared.launch;
  if (!record(input) || typeof input.command !== "string" || !input.command.trim()
    || !Array.isArray(input.args) || !input.args.every((arg) => typeof arg === "string")
    || (input.overlay && typeof input.overlay.cleanup !== "function")
    || !record(prepared.resources) || !exactKeys(prepared.resources, RESOURCE_PARTS)) {
    throw new Error("department-process-preparation-invalid");
  }
  const resources = {} as DepartmentProcessResources;
  for (const part of RESOURCE_PARTS) {
    const resource = prepared.resources[part];
    if (!record(resource) || typeof resource.owned !== "boolean"
      || Object.keys(resource).some((key) => key !== "owned" && key !== "release")
      || (resource.release !== undefined && typeof resource.release !== "function")
      || (!resource.owned && resource.release !== undefined)) throw new Error("department-process-resource-contract-invalid");
    resources[part] = { owned: resource.owned, release: resource.release?.bind(resource) };
  }
  const overlay = input.overlay;
  const launch: CliProcessRuntimeLaunch = {
    command: input.command, args: [...input.args], cwd: input.cwd,
    // Freeze default inheritance at preparation too; requirements and launch use one snapshot.
    baseEnvironment: { ...(input.baseEnvironment ?? process.env) },
    envOverrides: input.envOverrides ? { ...input.envOverrides } : undefined,
    processLabel: input.processLabel, macTaskShell: input.macTaskShell,
    overlay: overlay ? { envOverrides: { ...overlay.envOverrides }, cleanup: overlay.cleanup.bind(overlay) } : undefined,
  };
  return { identity: structuredClone(identity), selection: structuredClone(prepared.selection), launch, resources,
    handlers: { ...prepared.handlers },
    requirements: { processTerminal: true, turnTerminal: false, streams: true,
      runner: resources.runner.owned, executionRoot: resources.executionRoot.owned,
      links: resources.links.owned, temp: !!overlay || resources.temp.owned, tab: resources.tab.owned } };
}

function observeLifecycle(handle: CliProcessRuntimeHandle): Promise<Lifecycle> {
  const missing = (): Lifecycle => ({ processTerminal: unavailable("process-lifecycle-unavailable"), turnTerminal: NO_TURN,
    streams: unavailable("process-lifecycle-unavailable"), temp: unavailable("process-lifecycle-unavailable") });
  if (!handle.lifecycle) return Promise.resolve(missing());
  return handle.lifecycle.then((facts) => {
    if (!record(facts) || !validResult(facts.processTerminal) || !validResult(facts.streams) || !validResult(facts.temp)) return missing();
    return { processTerminal: { ...facts.processTerminal }, turnTerminal: NO_TURN,
      streams: { ...facts.streams }, temp: { ...facts.temp } };
  }, missing);
}

async function releaseResource(resource: DepartmentProcessResource): Promise<CleanupResult> {
  if (!resource.owned) return notApplicable("no-owned-resource");
  if (!resource.release) return unavailable("required-resource-release-missing");
  try {
    const result: unknown = await resource.release();
    // An owned resource cannot disappear from requirements by returning not-applicable.
    return validResult(result) ? result.status === "not-applicable"
      ? unavailable("owned-resource-release-not-applicable") : { ...result } : unavailable("resource-release-result-invalid");
  } catch { return { status: "failed", reason: "resource-release-threw" }; }
}

function joinTemp(overlay: CleanupResult, extra: CleanupResult, ownsOverlay: boolean, ownsExtra: boolean): CleanupResult {
  if (overlay.status === "failed" || overlay.status === "unobservable") return overlay;
  if (extra.status === "failed" || extra.status === "unobservable") return extra;
  if ((ownsOverlay && overlay.status !== "confirmed") || (ownsExtra && extra.status !== "confirmed")) {
    return unavailable("required-temp-resource-not-confirmed");
  }
  return ownsOverlay || ownsExtra ? confirmed("all-owned-temp-resources-released") : notApplicable("no-owned-temp-resource");
}

function start(snapshot: Snapshot): TrustedExecutionHandle {
  // Output is consumed in the Owner; callbacks, PID and kill never become terminal evidence.
  const processHandle = runCliProcess(snapshot.launch, snapshot.handlers);
  const lifecycle = observeLifecycle(processHandle);
  const completion = lifecycle.then((facts): ExecutionTerminalEvidence => ({
    processTerminal: { ...facts.processTerminal }, turnTerminal: { ...NO_TURN }, streams: { ...facts.streams },
  }));
  let cleanupPromise: Promise<ExecutionCleanupEvidence> | undefined;
  return { kind: "process", completion, seal() { processHandle.kill(); },
    cleanup(): Promise<ExecutionCleanupEvidence> {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = lifecycle.then(async (facts) => {
        const result = {} as ExecutionCleanupEvidence;
        // Missing/rejected/incomplete observation cannot authorize destructive resource releases.
        const safeToRelease = facts.processTerminal.status === "confirmed" && facts.streams.status === "confirmed";
        for (const part of RESOURCE_PARTS) {
          const resource = snapshot.resources[part];
          result[part] = safeToRelease ? await releaseResource(resource) : resource.owned
            ? unavailable("process-close-and-drain-unconfirmed") : notApplicable("no-owned-resource");
        }
        result.temp = joinTemp(facts.temp, result.temp, !!snapshot.launch.overlay, snapshot.resources.temp.owned);
        return result;
      });
      return cleanupPromise;
    },
  };
}

/** Trusted in-process adapter only. Public Owner IPC remains identity-only.
 * Cache is bounded and never evicts an active or failed execution into a second spawn.
 * The trusted resolver retains its configuration lease until its own release capability completes. */
export function createDepartmentProcessExecutionLauncher(resolvePrepared: DepartmentProcessExecutionResolver): TrustedExecutionLauncher {
  const entries = new Map<string, Entry>();
  const getEntry = (identity: DepartmentExecutionIdentity): Entry & { snapshot: Snapshot } => {
    if (!isDepartmentExecutionIdentity(identity) || identity.session.state !== "bound") {
      throw new Error("department-process-requires-bound-identity");
    }
    const key = canonicalIdentity(identity), existing = entries.get(identity.executionId);
    if (existing) {
      if (existing.key !== key || existing.snapshot && !sameExecution(existing.snapshot.identity, identity)) {
        throw new Error("department-process-identity-conflict");
      }
      if (!existing.snapshot) throw new Error("department-process-preparation-rejected");
      return existing as Entry & { snapshot: Snapshot };
    }
    if (entries.size >= MAX_PREPARED_EXECUTIONS) throw new Error("department-process-preparation-capacity");
    // Reserve before calling trusted code, including failures/reentrant calls.
    const entry: Entry = { key };
    entries.set(identity.executionId, entry);
    entry.snapshot = prepareSnapshot(identity, resolvePrepared(structuredClone(identity)));
    return entry as Entry & { snapshot: Snapshot };
  };
  return {
    seal(identity) {
      const entry = entries.get(identity.executionId);
      if (!entry?.snapshot || !sameExecution(entry.snapshot.identity, identity) || !entry.started)
        throw new Error("department-process-original-execution-unavailable");
      void entry.started.then(handle => handle.seal?.());
    },
    requirements(identity) { return { ...getEntry(identity).snapshot.requirements }; },
    launch(identity, _bindSession): Promise<TrustedExecutionHandle> {
      try {
        const entry = getEntry(identity);
        // Bind is deliberately unused: only the already-bound native session is accepted.
        if (!entry.started) entry.started = Promise.resolve().then(() => start(entry.snapshot));
        return entry.started;
      } catch { return Promise.reject(new Error("department-process-launch-rejected")); }
    },
  };
}
