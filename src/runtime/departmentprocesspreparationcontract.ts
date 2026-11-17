import { assertRetiredOpenCodeSession, type DepartmentOpenCodeRetiredSession } from "./departmentopencodesessionpreparation";
import * as path from "path";
import { exactKeys, fingerprintDepartmentExecutionSelection, isDepartmentExecutionIdentity, record,
  type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import type { CliProcessRuntimeLaunch } from "../cli/cliProcessRuntime";
import type { createOpenCodeRuntimeConfigOverlay } from "../cli/opencoderuntimeconfig";

/** Only sent on the inherited fork channel. Unbound is private first preparation only;
 * the public Owner endpoint and process launcher still receive bound identities exclusively. */
export type DepartmentProcessPreparation = {
  version: 1;
  token: string;
  ownerDirectory: string;
  configurationDirectory: string;
  workspaceDirectory: string;
  identity: DepartmentExecutionIdentity;
  selection: DepartmentExecutionSelection;
  launch: Omit<CliProcessRuntimeLaunch, "overlay" | "cwd">;
  retired?: DepartmentOpenCodeRetiredSession;
  overlay: Parameters<typeof createOpenCodeRuntimeConfigOverlay>[0] | null;
};

export function isDepartmentProcessPreparation(value: unknown): value is DepartmentProcessPreparation {
  if (!record(value) || !exactKeys(value, ["version", "token", "ownerDirectory", "configurationDirectory", "workspaceDirectory",
    "identity", "selection", "launch", "overlay", ...(value.retired === undefined ? [] : ["retired"])]) || value.version !== 1
    || typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)
    || ![value.ownerDirectory, value.configurationDirectory, value.workspaceDirectory].every((v) => typeof v === "string" && !!v && !v.includes("\0"))
    || !isDepartmentExecutionIdentity(value.identity) || value.identity.cli !== "opencode" || value.identity.role !== "employee"
    || value.identity.session.state === "bound" && !/^ses_[A-Za-z0-9]+$/.test(value.identity.session.id)) return false;
  try {
    const selection = value.selection as DepartmentExecutionSelection;
    const fingerprints = fingerprintDepartmentExecutionSelection(selection);
    if (!selection.configId || selection.role !== value.identity.role || selection.cli !== value.identity.cli
      || fingerprints.configFingerprint !== value.identity.configFingerprint || fingerprints.profileFingerprint !== value.identity.profileFingerprint) return false;
  } catch { return false; }
  if (value.retired !== undefined) {
    try {
      if (!record(value.retired) || !exactKeys(value.retired, ["identity", "selection", "directory"])
        || !isDepartmentExecutionIdentity(value.retired.identity)) return false;
      assertRetiredOpenCodeSession(value.retired as DepartmentOpenCodeRetiredSession, value.identity, value.selection as DepartmentExecutionSelection);
    } catch { return false; }
  }
  const launch = value.launch;
  const env = (v: unknown): boolean => v === undefined || record(v) && Object.entries(v).every(([k, item]) => !!k && !/[=\0]/.test(k)
    && (item === undefined || typeof item === "string" && !item.includes("\0")));
  if (!record(launch) || Object.keys(launch).some((k) => !["command", "args", "baseEnvironment", "envOverrides", "processLabel", "macTaskShell"].includes(k))
    || typeof launch.command !== "string" || !launch.command || launch.command.includes("\0")
    || !Array.isArray(launch.args) || launch.args.length > 4096 || !launch.args.every((s) => typeof s === "string" && !s.includes("\0"))
    || !env(launch.baseEnvironment) || !env(launch.envOverrides)
    || (launch.macTaskShell !== undefined && launch.macTaskShell !== "bash" && launch.macTaskShell !== "zsh")
    || (launch.processLabel !== undefined && typeof launch.processLabel !== "string")) return false;
  // The same native session must be passed to the existing run strategy, without conflicting aliases.
  const args = launch.args as string[];
  if (![value.ownerDirectory, value.configurationDirectory, value.workspaceDirectory].every(v => path.isAbsolute(v as string))
    || args.some(arg => (/^-s/.test(arg) && arg !== "-s" && !arg.startsWith("-s=")) || /^(?:--dir|--directory|--cwd|--attach|--continue|--fork)(?:=|$)/.test(arg) || /^-c/.test(arg))) return false;
  const sessionArgs = args.flatMap((arg, index) => arg === "--session" || arg === "-s" ? [args[index + 1]]
    : typeof arg === "string" && /^(--session|-s)=/.test(arg) ? [arg.slice(arg.indexOf("=") + 1)] : []);
  if (value.identity.session.state === "bound"
    ? sessionArgs.length !== 1 || sessionArgs[0] !== value.identity.session.id : sessionArgs.length !== 0) return false;
  if (value.overlay !== null) {
    const overlay = value.overlay;
    if (!record(overlay) || Object.keys(overlay).some((k) => !["configContent", "primaryModel", "smallModel", "primaryVariant", "smallVariant"].includes(k))
      || typeof overlay.configContent !== "string" || typeof overlay.primaryModel !== "string"
      || ![overlay.smallModel, overlay.primaryVariant, overlay.smallVariant].every((v) => v === undefined || v === null || typeof v === "string")) return false;
  }
  // CLI arguments carry the complete Loop+ prompt. Do not include their text
  // in the configuration-preparation budget or truncate the native invocation.
  return Buffer.byteLength(JSON.stringify({ ...value, launch: { ...launch, args: [] } }), "utf8") <= 4 * 1024 * 1024;
}
