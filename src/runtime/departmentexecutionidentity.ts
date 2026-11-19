import { createHash } from "crypto";

export type DepartmentExecutionSession = { state: "unbound" } | { state: "bound"; id: string };
type BaseIdentity = {
  version: 1;
  workspace: string;
  rootTaskId: string;
  leaderTaskId: string;
  moduleId: string;
  generation: number;
  cli: "codex" | "claude" | "opencode" | "grok" | "dsh" | "kimi-code" | "zcode";
  /** Hash only canonical, non-secret resolved configuration metadata. Never hash credentials. */
  configFingerprint: string;
  profileFingerprint: string;
  session: DepartmentExecutionSession;
  ownerId: string;
  executionId: string;
};
export type DepartmentExecutionIdentity = BaseIdentity & (
  { role: "leader" } | { role: "employee"; subtaskId: string; attemptId: string }
);

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}
export function isExecutionSession(value: unknown): value is DepartmentExecutionSession {
  return record(value) && ((value.state === "unbound" && exactKeys(value, ["state"]))
    || (value.state === "bound" && exactKeys(value, ["state", "id"]) && identifier(value.id)));
}
export function isDepartmentExecutionIdentity(value: unknown): value is DepartmentExecutionIdentity {
  if (!record(value)) return false;
  const keys = ["version", "workspace", "rootTaskId", "leaderTaskId", "moduleId", "role", "generation", "cli",
    "configFingerprint", "profileFingerprint", "session", "ownerId", "executionId"];
  if (value.role === "employee") keys.push("subtaskId", "attemptId");
  else if (value.role !== "leader") return false;
  return exactKeys(value, keys) && value.version === 1
    && typeof value.workspace === "string" && value.workspace.length > 0 && value.workspace.length <= 1024
    && value.workspace.trim() === value.workspace && !/[\x00-\x1f\x7f]/.test(value.workspace)
    && [value.rootTaskId, value.leaderTaskId, value.moduleId, value.ownerId, value.executionId].every(identifier)
    && Number.isSafeInteger(value.generation) && (value.generation as number) >= 1
    && ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"].includes(value.cli as string)
    && [value.configFingerprint, value.profileFingerprint].every((v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v))
    && isExecutionSession(value.session)
    && (value.role !== "employee" || (identifier(value.subtaskId) && identifier(value.attemptId)));
}
/** Canonical order also makes equality independent of wire property ordering. */
export function canonicalIdentity(identity: DepartmentExecutionIdentity): string {
  return JSON.stringify([identity.version, identity.workspace, identity.rootTaskId, identity.leaderTaskId, identity.moduleId,
    identity.role, identity.generation, identity.cli, identity.configFingerprint, identity.profileFingerprint,
    identity.session.state === "bound" ? identity.session.id : null, identity.ownerId, identity.executionId,
    identity.role === "employee" ? identity.subtaskId : null, identity.role === "employee" ? identity.attemptId : null]);
}
export function sameExecution(a: DepartmentExecutionIdentity, b: DepartmentExecutionIdentity): boolean {
  return canonicalIdentity(a) === canonicalIdentity(b);
}
/** A successor of this slot must be fenced even when its execution/attempt/owner id changes. */
export function executionSlot(identity: DepartmentExecutionIdentity): string {
  return createHash("sha256").update(JSON.stringify([identity.workspace, identity.rootTaskId, identity.leaderTaskId,
    identity.moduleId, identity.role, identity.role === "employee" ? identity.subtaskId : null])).digest("hex");
}

export type DepartmentExecutionSelection = {
  version: 1;
  cli: DepartmentExecutionIdentity["cli"];
  role: "leader" | "employee";
  configId: string | null;
  revision: string;
  model: string | null;
  thinkingMode: string | null;
  openCodeVariant: string | null;
};
/** Explicit allowlist of selection metadata. Never accepts ConfigItem,
 * SharedConfigSelection.profileDigest, env/auth contents or a full config body. */
export function fingerprintDepartmentExecutionSelection(selection: DepartmentExecutionSelection): {
  configFingerprint: string; profileFingerprint: string;
} {
  const label = (value: unknown): boolean => value === null || typeof value === "string"
    && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
  if (!record(selection) || !exactKeys(selection, ["version", "cli", "role", "configId", "revision", "model", "thinkingMode", "openCodeVariant"])
    || selection.version !== 1 || !["leader", "employee"].includes(selection.role)
    || !["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"].includes(selection.cli)
    || !identifier(selection.revision) || ![selection.configId, selection.model, selection.thinkingMode, selection.openCodeVariant].every(label)) {
    throw new Error("invalid-department-execution-selection-metadata");
  }
  const hash = (fields: unknown[]): string => createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  return {
    configFingerprint: hash(["department-config-selection", 1, selection.cli, selection.configId, selection.revision]),
    profileFingerprint: hash(["department-role-selection", 1, selection.cli, selection.configId, selection.revision,
      selection.role, selection.model, selection.thinkingMode, selection.openCodeVariant]),
  };
}

export const CLEANUP_PARTS = ["processTerminal", "turnTerminal", "streams", "runner", "executionRoot", "links", "temp", "tab"] as const;
export type CleanupPart = typeof CLEANUP_PARTS[number];
export type CleanupResult = { status: "confirmed"; evidence: string } | { status: "not-applicable"; reason: string }
  | { status: "failed" | "unobservable"; reason: string };
export type DepartmentExecutionCleanup = Record<CleanupPart, CleanupResult>;
export type CleanupRequirements = Record<CleanupPart, boolean>;

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}
export function isCleanupRequirements(value: unknown): value is CleanupRequirements {
  return record(value) && exactKeys(value, CLEANUP_PARTS) && CLEANUP_PARTS.every((key) => typeof value[key] === "boolean")
    && (value.processTerminal === true || value.turnTerminal === true) && value.streams === true;
}
export function isExecutionCleanup(value: unknown): value is DepartmentExecutionCleanup {
  return record(value) && exactKeys(value, CLEANUP_PARTS) && CLEANUP_PARTS.every((key) => {
    const item = value[key];
    return record(item) && (item.status === "confirmed"
      ? exactKeys(item, ["status", "evidence"]) && boundedText(item.evidence)
      : ["not-applicable", "failed", "unobservable"].includes(item.status as string)
        && exactKeys(item, ["status", "reason"]) && boundedText(item.reason));
  });
}
export function cleanupComplete(cleanup: DepartmentExecutionCleanup, required: CleanupRequirements): boolean {
  return CLEANUP_PARTS.every((part) => required[part]
    ? cleanup[part].status === "confirmed" : cleanup[part].status === "not-applicable");
}
