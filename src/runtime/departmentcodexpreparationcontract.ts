import { CLEANUP_PARTS, exactKeys, fingerprintDepartmentExecutionSelection, identifier, isDepartmentExecutionIdentity, isExecutionCleanup, record,
  type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import type { CodexRunnerOptions } from "../interactive/codexRunnerCore";
import type { CodexOwnedSession } from "../interactive/codexOwnedExecution";

/** Inherited private channel only. Never accepted by the identity-only public socket. */
export type DepartmentCodexPreparation = {
  version: 1; token: string; ownerDirectory: string; configurationDirectory: string; workspaceDirectory: string;
  identity: DepartmentExecutionIdentity; selection: DepartmentExecutionSelection;
  runner: CodexRunnerOptions; macTaskShell: "bash" | "zsh"; prompt: string; requestUserInputEnabled: boolean;
};
export const CODEX_OWNER_MESSAGE_LIMIT = 64 * 1024;
/** Same strict result schema as the original Owner receipt, with no host receipt writer. */
export function isCodexResourceResult(value: unknown): value is import("./departmentexecutionidentity").CleanupResult {
  return isExecutionCleanup(Object.fromEntries(CLEANUP_PARTS.map((part) => [part, value])))
    && record(value) && value.status !== "not-applicable";
}
export function isCodexOwnedSession(value: unknown): value is CodexOwnedSession {
  if (!record(value) || !exactKeys(value, ["threadId", "connectionId", "token"]) || !identifier(value.threadId)
    || !Number.isSafeInteger(value.connectionId) || Number(value.connectionId) < 1 || !record(value.token)) return false;
  return exactKeys(value.token, ["runnerId", "generation", "abortGeneration", "disposeGeneration"])
    && identifier(value.token.runnerId) && [value.token.generation, value.token.abortGeneration, value.token.disposeGeneration]
      .every((v) => Number.isSafeInteger(v) && Number(v) >= 0);
}
export function boundedCodexMessage(value: unknown, limit = CODEX_OWNER_MESSAGE_LIMIT): boolean {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8") <= limit; } catch { return false; }
}
export function isDepartmentCodexPreparation(value: unknown): value is DepartmentCodexPreparation {
  if (!record(value) || !exactKeys(value, ["version", "token", "ownerDirectory", "configurationDirectory", "workspaceDirectory", "identity",
    "selection", "runner", "macTaskShell", "prompt", "requestUserInputEnabled"]) || value.version !== 1
    || typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)
    || ![value.ownerDirectory, value.configurationDirectory, value.workspaceDirectory].every((v) => typeof v === "string" && !!v.trim() && !v.includes("\0"))
    || !isDepartmentExecutionIdentity(value.identity) || value.identity.cli !== "codex" || value.identity.role !== "employee"
    || typeof value.macTaskShell !== "string" || !["bash", "zsh"].includes(value.macTaskShell) || typeof value.requestUserInputEnabled !== "boolean"
    || typeof value.prompt !== "string" || !value.prompt.trim()) return false;
  try {
    const selection = value.selection as DepartmentExecutionSelection;
    const fingerprints = fingerprintDepartmentExecutionSelection(selection);
    if (!selection.configId || selection.cli !== "codex" || selection.role !== "employee" || selection.openCodeVariant !== null
      || fingerprints.configFingerprint !== value.identity.configFingerprint || fingerprints.profileFingerprint !== value.identity.profileFingerprint) return false;
  } catch { return false; }
  const r = value.runner;
  if (!record(r) || !exactKeys(r, ["command", "args", "env", "thinkingMode", "interactiveMode", "model", "threadId", "configFingerprint"])
    || typeof r.command !== "string" || !r.command.trim() || r.command.includes("\0") || !Array.isArray(r.args) || r.args.length > 4096
    || !r.args.every((v) => typeof v === "string" && !v.includes("\0")) || !record(r.env)
    || !Object.entries(r.env).every(([k, v]) => !!k && !/[=\0]/.test(k) && (v === undefined || typeof v === "string" && !v.includes("\0")))
    || r.thinkingMode !== (value.selection as DepartmentExecutionSelection).thinkingMode
    || !["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"].includes(String(r.thinkingMode)) || r.interactiveMode !== "coding"
    || r.model !== (value.selection as DepartmentExecutionSelection).model || r.configFingerprint !== value.identity.configFingerprint
    || r.threadId !== (value.identity.session.state === "bound" ? value.identity.session.id : null)) return false;
  return boundedCodexMessage(value, 4 * 1024 * 1024);
}
