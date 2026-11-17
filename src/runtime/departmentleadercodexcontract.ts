import { CLEANUP_PARTS, exactKeys, fingerprintDepartmentExecutionSelection, isDepartmentExecutionIdentity,
  isExecutionCleanup, record, type CleanupRequirements, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import { boundedCodexMessage } from "./departmentcodexpreparationcontract";
import type { CodexRunnerOptions } from "../interactive/codexRunnerCore";
import type { ExecutionTerminalEvidence } from "./departmentexecutionowner";

export const LEADER_INVOCATION_LIMIT = 128;
export const LEADER_CALLBACK_LIMIT = 32;
export const LEADER_REQUIREMENTS: Readonly<CleanupRequirements> = Object.freeze(Object.fromEntries(CLEANUP_PARTS.map((p) => [p, true])) as CleanupRequirements);
export const LEADER_CALLBACKS = ["onAssistantDelta", "onTrace", "onTaskListUpdate", "onThreadId", "onTurnCompleted", "onEvent",
  "onTokenUsageUpdate", "onSubagentUpdate", "onRequest", "onNotification", "logInfo", "logError"] as const;
export { isDepartmentLeaderInvocation as isLeaderInvocation } from "./departmentleaderinvocation";
export type { DepartmentLeaderInvocation as LeaderInvocation } from "./departmentleaderinvocation";
export type LeaderCodexDescription = {
  configurationDirectory: string; workspaceDirectory: string; runner: CodexRunnerOptions;
  macTaskShell: "bash" | "zsh"; requestUserInputEnabled: boolean;
};
export type LeaderCodexPreparation = LeaderCodexDescription & {
  version: 1; token: string; identity: DepartmentExecutionIdentity; selection: DepartmentExecutionSelection; ownerDirectory: string;
};
export function isLeaderTerminal(value: unknown): value is ExecutionTerminalEvidence {
  return record(value) && exactKeys(value, ["processTerminal", "turnTerminal", "streams"])
    && isExecutionCleanup({ ...Object.fromEntries(CLEANUP_PARTS.map((p) => [p, { status: "unobservable", reason: "validation" }])), ...value });
}
export function isLeaderCodexPreparation(v: unknown): v is LeaderCodexPreparation {
  if (!record(v) || !exactKeys(v, ["version", "token", "identity", "selection", "ownerDirectory", "configurationDirectory",
    "workspaceDirectory", "runner", "macTaskShell", "requestUserInputEnabled"]) || v.version !== 1
    || typeof v.token !== "string" || !/^[a-f0-9]{64}$/.test(v.token) || !isDepartmentExecutionIdentity(v.identity)
    || v.identity.role !== "leader" || v.identity.cli !== "codex" || !["bash", "zsh"].includes(String(v.macTaskShell))
    || typeof v.requestUserInputEnabled !== "boolean" || ![v.ownerDirectory, v.configurationDirectory, v.workspaceDirectory]
      .every((p) => typeof p === "string" && !!p.trim() && !p.includes("\0"))) return false;
  try {
    const s = v.selection as DepartmentExecutionSelection, f = fingerprintDepartmentExecutionSelection(s);
    if (s.role !== "leader" || s.cli !== "codex" || !s.configId || s.openCodeVariant !== null
      || f.configFingerprint !== v.identity.configFingerprint || f.profileFingerprint !== v.identity.profileFingerprint) return false;
    const r = v.runner;
    if (!record(r) || !exactKeys(r, ["command", "args", "env", "thinkingMode", "interactiveMode", "model", "threadId", "configFingerprint"])
      || typeof r.command !== "string" || !r.command.trim() || r.command.includes("\0") || !Array.isArray(r.args) || r.args.length > 4096
      || !r.args.every((a) => typeof a === "string" && !a.includes("\0")) || !record(r.env)
      || !Object.entries(r.env).every(([k, val]) => !!k && !/[=\0]/.test(k) && (val === undefined || typeof val === "string" && !val.includes("\0")))
      || r.thinkingMode !== s.thinkingMode || !["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"].includes(String(r.thinkingMode))
      || r.model !== s.model || r.configFingerprint !== v.identity.configFingerprint || r.interactiveMode !== "coding"
      || r.threadId !== (v.identity.session.state === "bound" ? v.identity.session.id : null)) return false;
  } catch { return false; }
  return boundedCodexMessage(v, 4 * 1024 * 1024);
}
