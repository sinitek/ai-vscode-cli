import type { ChildProcess } from "child_process";
import * as core from "./codexRunnerProcessCore";
import { captureCodexHostRuntime } from "./codexRuntimeHost";
export { buildShellCommandLine, type ResolvedSpawnCommand } from "./codexRunnerProcessCore";

export function resolveSpawnCommand(command: string, args: string[]): core.ResolvedSpawnCommand {
  return core.resolveSpawnCommand(command, args, captureCodexHostRuntime());
}
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals | number = "SIGTERM"): boolean {
  return core.killProcessTree(child, captureCodexHostRuntime(), signal);
}
export function requestChildShutdown(child: ChildProcess, mode: "graceful" | "terminate"): void {
  core.requestChildShutdown(child, mode, captureCodexHostRuntime());
}
