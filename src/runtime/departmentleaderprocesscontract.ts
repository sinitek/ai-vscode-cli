import * as path from "path";
import { exactKeys, fingerprintDepartmentExecutionSelection, isDepartmentExecutionIdentity, record,
  type CleanupRequirements, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import type { CliProcessRuntimeLaunch } from "../cli/cliProcessRuntime";
import type { createOpenCodeRuntimeConfigOverlay } from "../cli/opencoderuntimeconfig";

export const DEPARTMENT_LEADER_PROCESS_REQUIREMENTS: Readonly<CleanupRequirements> = Object.freeze({
  processTerminal: true, turnTerminal: false, streams: true, runner: true,
  executionRoot: true, links: true, temp: true, tab: true,
});
export function departmentLeaderProcessRequirements(preparation: Pick<DepartmentLeaderProcessPreparation, "launch">): CleanupRequirements {
  return { ...DEPARTMENT_LEADER_PROCESS_REQUIREMENTS, temp: !!preparation.launch.overlay };
}
export const DEPARTMENT_LEADER_PROCESS_INVOCATION_LIMIT = 128;
export { isDepartmentLeaderInvocation as isDepartmentLeaderProcessInvocation } from "./departmentleaderinvocation";
export type { DepartmentLeaderInvocation as DepartmentLeaderProcessInvocation } from "./departmentleaderinvocation";
export type DepartmentLeaderProcessLaunch = Omit<CliProcessRuntimeLaunch, "args" | "cwd" | "overlay"> & {
  baseArgs: string[]; cwd: string; sessionId: string; openCodeVariant?: string | null;
  overlay?: Parameters<typeof createOpenCodeRuntimeConfigOverlay>[0] | null;
};
export type DepartmentLeaderProcessPreparation = {
  version: 1;
  token: string;
  identity: DepartmentExecutionIdentity;
  selection: DepartmentExecutionSelection;
  ownerDirectory: string;
  configurationDirectory: string;
  launch: DepartmentLeaderProcessLaunch;
  /** Private host capability; the host retains the original root cleanup closure. */
  hostExecutionRoot?: true;
};

export function isDepartmentLeaderProcessPreparation(value: unknown): value is DepartmentLeaderProcessPreparation {
  if (!record(value) || !exactKeys(value, ["version", "token", "identity", "selection", "ownerDirectory", "configurationDirectory", "launch", ...(value.hostExecutionRoot === undefined ? [] : ["hostExecutionRoot"])])
    || (value.hostExecutionRoot !== undefined && value.hostExecutionRoot !== true)
    || value.version !== 1 || typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)
    || typeof value.ownerDirectory !== "string" || !value.ownerDirectory.trim() || value.ownerDirectory.includes("\0")
    || typeof value.configurationDirectory !== "string" || !value.configurationDirectory.trim() || value.configurationDirectory.includes("\0")
    || !isDepartmentExecutionIdentity(value.identity)) return false;
  const identity = value.identity as DepartmentExecutionIdentity;
  if (identity.role !== "leader" || identity.cli !== "opencode" || identity.session.state !== "bound"
    || !/^ses_[A-Za-z0-9]+$/.test(identity.session.id)) return false;
  try {
    const selection = value.selection as DepartmentExecutionSelection;
    const f = fingerprintDepartmentExecutionSelection(selection);
    if (selection.role !== "leader" || selection.cli !== "opencode" || !selection.configId
      || selection.configId === null || f.configFingerprint !== identity.configFingerprint
      || f.profileFingerprint !== identity.profileFingerprint) return false;
  } catch { return false; }
  const launch = value.launch;
  if (!record(launch) || Object.keys(launch).some((k) => !["command", "baseArgs", "cwd", "baseEnvironment", "envOverrides", "processLabel", "macTaskShell", "sessionId", "openCodeVariant", "overlay"].includes(k))
    || typeof launch.command !== "string" || !launch.command.trim() || launch.command.includes("\0")
    || !Array.isArray(launch.baseArgs) || launch.baseArgs.length > 4096
    || !launch.baseArgs.every((arg) => typeof arg === "string" && !arg.includes("\0"))
    || hasDepartmentLeaderSessionOverride(launch.baseArgs) || hasDepartmentLeaderDirectoryOverride(launch.baseArgs)
    || typeof launch.cwd !== "string" || !launch.cwd.trim() || launch.cwd.includes("\0")
    || (value.hostExecutionRoot === true && !path.isAbsolute(launch.cwd))
    || launch.sessionId !== identity.session.id
    || (launch.openCodeVariant !== undefined && launch.openCodeVariant !== null && typeof launch.openCodeVariant !== "string")
    || (launch.macTaskShell !== undefined && launch.macTaskShell !== "bash" && launch.macTaskShell !== "zsh")
    || (launch.processLabel !== undefined && typeof launch.processLabel !== "string")) return false;
  if (launch.overlay !== undefined && launch.overlay !== null) {
    const overlay = launch.overlay;
    if (!record(overlay) || Object.keys(overlay).some((k) => !["configContent", "primaryModel", "smallModel", "primaryVariant", "smallVariant"].includes(k))
      || typeof overlay.configContent !== "string" || typeof overlay.primaryModel !== "string"
      || ![overlay.smallModel, overlay.primaryVariant, overlay.smallVariant].every((v) => v === undefined || v === null || typeof v === "string")) return false;
  }
  const validEnv = (env: unknown): boolean => env === undefined || record(env) && Object.entries(env).every(([key, item]) =>
    !!key && !/[=\0]/.test(key) && (item === undefined || typeof item === "string" && !item.includes("\0")));
  return validEnv(launch.baseEnvironment) && validEnv(launch.envOverrides)
    && Buffer.byteLength(JSON.stringify(value), "utf8") <= 4 * 1024 * 1024;
}

/** The trusted producer checks this before native preparation as well as binding. */
export function hasDepartmentLeaderSessionOverride(args: unknown): boolean {
  return !Array.isArray(args) || args.some((arg) => typeof arg !== "string"
    || arg === "--session" || arg.startsWith("--session=") || /^-s/.test(arg));
}

/** A generation cannot change its native event instance or adopt/fork a session. */
export function hasDepartmentLeaderDirectoryOverride(args: readonly string[]): boolean {
  return args.some(arg => /^(?:--dir|--attach|--continue|--fork)(?:=|$)/.test(arg) || /^-c/.test(arg));
}
