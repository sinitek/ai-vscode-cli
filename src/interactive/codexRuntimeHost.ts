// Extension Host adapter only. Node consumers import the Core modules directly.
import { getMacTaskShell } from "../cli/config";
import { logInfo, logError } from "../logger";
import { freezeCodexRuntimePorts, type CodexRuntimePorts } from "./codexRuntimePorts";

export function captureCodexHostRuntime(): CodexRuntimePorts {
  return freezeCodexRuntimePorts({ macTaskShell: getMacTaskShell(), logInfo, logError });
}
