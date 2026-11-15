import { CodexOwnedExecution, type CodexOwnedSession, type CodexOwnedExecutionOptions,
  type CodexOwnedExecutionResult } from "../interactive/codexOwnedExecution";
import { freezeCodexRuntimePorts } from "../interactive/codexRuntimePorts";
import { canonicalIdentity, exactKeys, fingerprintDepartmentExecutionSelection, identifier,
  isDepartmentExecutionIdentity, record, sameExecution, type CleanupResult, type CleanupRequirements,
  type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import type { ExecutionCleanupEvidence, ExecutionTerminalEvidence, TrustedExecutionHandle,
  TrustedExecutionLauncher } from "./departmentexecutionowner";

export type DepartmentCodexResource = Readonly<{
  owned: boolean;
  /** Must not await this execution's receipt or capacity return. */
  release?: (native: Readonly<CodexOwnedExecutionResult>) => CleanupResult | Promise<CleanupResult>;
}>;
export type DepartmentCodexResources = Record<keyof ExecutionCleanupEvidence, DepartmentCodexResource>;
export type PreparedDepartmentCodexExecution = {
  identity: DepartmentExecutionIdentity;
  selection: DepartmentExecutionSelection;
  session: { intent: "new" } | { intent: "resume"; threadId: string };
  runner: CodexOwnedExecutionOptions["runner"];
  runtime: CodexOwnedExecutionOptions["runtime"];
  prompt: string;
  handlers: CodexOwnedExecutionOptions["handlers"];
  /** Owner lifetime, never the socket/client/EH connection lifetime. */
  signal: AbortSignal;
  /** Persist/confirm exactly this native session, returning the SAME frozen object. */
  confirmSession: (session: CodexOwnedSession) => Promise<CodexOwnedSession>;
  /** runner is mandatory and owned: includes any additional native session responsibility. */
  resources: DepartmentCodexResources;
};
export type DepartmentCodexExecutionResolver =
  (identity: DepartmentExecutionIdentity) => PreparedDepartmentCodexExecution | null;

const PARTS = ["runner", "executionRoot", "links", "temp", "tab"] as const;
const LIMIT = 256;
const unknown = (reason: string): CleanupResult => ({ status: "unobservable", reason });
const absent = (): CleanupResult => ({ status: "not-applicable", reason: "no-owned-resource" });
const confirmed = (evidence: string): CleanupResult => ({ status: "confirmed", evidence });
type Snapshot = Omit<CodexOwnedExecutionOptions, "bindSession"> & {
  identity: DepartmentExecutionIdentity;
  confirmSession: PreparedDepartmentCodexExecution["confirmSession"];
  requirements: CleanupRequirements;
  resources: DepartmentCodexResources;
};
// Unknown/failed entries are deliberately never evicted into a second launch.
type Entry = { key: string; snapshot?: Snapshot; started?: Promise<TrustedExecutionHandle> };

function validResult(value: unknown): value is CleanupResult {
  if (!record(value)) return false;
  const text = (v: unknown): boolean => typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(v);
  return value.status === "confirmed" ? exactKeys(value, ["status", "evidence"]) && text(value.evidence)
    : ["failed", "unobservable", "not-applicable"].includes(String(value.status))
      && exactKeys(value, ["status", "reason"]) && text(value.reason);
}

function snapshot(identity: DepartmentExecutionIdentity, input: PreparedDepartmentCodexExecution | null): Snapshot {
  if (!input || !record(input) || !exactKeys(input, ["identity", "selection", "session", "runner", "runtime", "prompt", "handlers", "signal", "confirmSession", "resources"])
    || !isDepartmentExecutionIdentity(input.identity) || !sameExecution(identity, input.identity)) {
    throw new Error("department-codex-preparation-identity-conflict");
  }
  const fingerprints = fingerprintDepartmentExecutionSelection(input.selection);
  if (input.selection.cli !== "codex" || input.selection.role !== identity.role || input.selection.configId === null
    || fingerprints.configFingerprint !== identity.configFingerprint
    || fingerprints.profileFingerprint !== identity.profileFingerprint) throw new Error("department-codex-selection-conflict");
  const intent = input.session;
  if (!record(intent) || !(intent.intent === "new" && exactKeys(intent, ["intent"]) && identity.session.state === "unbound"
    || intent.intent === "resume" && exactKeys(intent, ["intent", "threadId"]) && identifier(intent.threadId)
      && identity.session.state === "bound" && identity.session.id === intent.threadId)) {
    throw new Error("department-codex-session-intent-conflict");
  }
  const runner = input.runner;
  const threadId = intent.intent === "new" ? null : intent.threadId;
  if (!record(runner) || typeof runner.command !== "string" || !runner.command.trim()
    || !Array.isArray(runner.args) || !runner.args.every((arg) => typeof arg === "string")
    || runner.threadId !== threadId || typeof input.prompt !== "string" || !input.prompt.trim()
    || !record(input.handlers) || !["onAssistantDelta", "onTrace", "onTaskListUpdate", "onThreadId"]
      .every((key) => typeof input.handlers[key as keyof typeof input.handlers] === "function")
    || !input.signal || typeof input.signal.addEventListener !== "function"
    || typeof input.confirmSession !== "function"
    || !record(input.resources) || !exactKeys(input.resources, PARTS)) throw new Error("department-codex-preparation-invalid");
  const resources = {} as DepartmentCodexResources;
  for (const part of PARTS) {
    const resource = input.resources[part];
    if (!record(resource) || typeof resource.owned !== "boolean"
      || Object.keys(resource).some((key) => key !== "owned" && key !== "release")
      || resource.release !== undefined && typeof resource.release !== "function"
      || !resource.owned && (resource.release !== undefined || part === "runner")) {
      throw new Error("department-codex-resource-contract-invalid");
    }
    resources[part] = Object.freeze({ owned: resource.owned, release: resource.release?.bind(resource) });
  }
  return Object.freeze({ identity: structuredClone(identity),
    runner: Object.freeze({ ...runner, args: [...runner.args], env: { ...(runner.env ?? process.env) } }),
    runtime: freezeCodexRuntimePorts(input.runtime), prompt: input.prompt, handlers: Object.freeze({ ...input.handlers }),
    signal: input.signal, confirmSession: input.confirmSession.bind(input), resources: Object.freeze(resources),
    requirements: Object.freeze({ processTerminal: true, turnTerminal: true, streams: true, runner: true,
      executionRoot: resources.executionRoot.owned, links: resources.links.owned,
      temp: resources.temp.owned, tab: resources.tab.owned }),
  });
}

function combine(first: CleanupResult, second: CleanupResult, evidence: string): CleanupResult {
  for (const result of [first, second]) {
    if (!validResult(result)) return unknown("codex-source-result-invalid");
    if (result.status === "failed" || result.status === "unobservable") return { ...result };
  }
  return first.status === "confirmed" && second.status === "confirmed" ? confirmed(evidence)
    : unknown("required-codex-fact-not-confirmed");
}

async function release(resource: DepartmentCodexResource, safe: boolean, native: CodexOwnedExecutionResult): Promise<CleanupResult> {
  if (!resource.owned) return absent();
  if (!safe) return unknown("codex-source-close-and-consumption-unconfirmed");
  if (!resource.release) return unknown("required-resource-release-missing");
  try {
    const result: unknown = await resource.release(Object.freeze(structuredClone(native)));
    return validResult(result) && result.status !== "not-applicable" ? { ...result }
      : unknown("owned-resource-release-result-invalid");
  } catch { return { status: "failed", reason: "resource-release-threw" }; }
}

function start(input: Snapshot, bindOwner: (sessionId: string) => Promise<void>): TrustedExecutionHandle {
  const owned = new CodexOwnedExecution({ ...input, bindSession: async (session) => {
    if (input.signal.aborted) throw new Error("department-codex-owner-cancelled");
    if (!identifier(session.threadId) || input.identity.session.state === "bound"
      && input.identity.session.id !== session.threadId) throw new Error("department-codex-native-session-conflict");
    const persisted = await input.confirmSession(session);
    if (persisted !== session || input.signal.aborted) throw new Error("department-codex-persistence-rejected");
    await bindOwner(session.threadId);
    if (input.signal.aborted) throw new Error("department-codex-owner-cancelled");
    return session;
  } });
  // Retain the original object and drain even if prepare/binding/execute rejects.
  // completion owns source finalization; it never waits for external resource cleanup.
  const facts = owned.execute().catch(() => undefined).then(() => owned.cleanup());
  const completion = facts.then((value): ExecutionTerminalEvidence => ({
    processTerminal: { ...value.processTerminal }, turnTerminal: { ...value.turnTerminal },
    streams: combine(value.streams, value.executionDrain, "codex-physical-streams-and-execution-drained"),
  }));
  let cleanupPromise: Promise<ExecutionCleanupEvidence> | undefined;
  // Attach a consumer immediately; a later caller still receives the original rejection.
  void completion.catch(() => undefined);
  return { kind: "both", completion,
    cleanup(): Promise<ExecutionCleanupEvidence> {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = facts.then(async (value: CodexOwnedExecutionResult) => {
        const safe = value.processTerminal.status === "confirmed" && value.streams.status === "confirmed"
          && value.executionDrain.status === "confirmed" && value.turnTerminal.status === "confirmed" && value.runner.status === "confirmed";
        const result = {} as ExecutionCleanupEvidence;
        for (const part of PARTS) result[part] = await release(input.resources[part], safe, value);
        result.runner = combine(value.runner, result.runner, "codex-runner-and-native-resources-released");
        return result;
      });
      return cleanupPromise;
    },
  };
}

/** Trusted injection only. requirements reserves and snapshots without creating a
 * native object. launch consumes that reservation; public IPC still carries identity only. */
export function createDepartmentCodexExecutionLauncher(resolvePrepared: DepartmentCodexExecutionResolver): TrustedExecutionLauncher {
  const entries = new Map<string, Entry>();
  const lookup = (identity: DepartmentExecutionIdentity): Entry | undefined => {
    if (!isDepartmentExecutionIdentity(identity) || identity.cli !== "codex") throw new Error("department-codex-invalid-identity");
    const entry = entries.get(identity.executionId);
    if (entry && entry.key !== canonicalIdentity(identity)) throw new Error("department-codex-identity-conflict");
    return entry;
  };
  return {
    requirements(identity) {
      let entry = lookup(identity);
      if (!entry) {
        if (entries.size >= LIMIT) throw new Error("department-codex-preparation-capacity");
        entry = { key: canonicalIdentity(identity) };
        entries.set(identity.executionId, entry);
        const expected = structuredClone(identity);
        entry.snapshot = snapshot(expected, resolvePrepared(structuredClone(expected)));
      }
      if (!entry.snapshot) throw new Error("department-codex-preparation-rejected");
      return { ...entry.snapshot.requirements };
    },
    launch(identity, bindSession) {
      try {
        const entry = lookup(identity);
        if (!entry?.snapshot || typeof bindSession !== "function") throw new Error("department-codex-not-prepared");
        if (!entry.started) {
          const fixed = entry.snapshot;
          entry.started = Promise.resolve().then(() => start(fixed, bindSession));
        }
        return entry.started;
      } catch { return Promise.reject(new Error("department-codex-launch-rejected")); }
    },
  };
}
