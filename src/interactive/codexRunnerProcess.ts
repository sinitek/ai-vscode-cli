import type { ChildProcess } from "child_process";
import * as core from "./codexRunnerProcessCore";
import { captureCodexHostRuntime } from "./codexRuntimeHost";
export { buildShellCommandLine, type ResolvedSpawnCommand } from "./codexRunnerProcessCore";

export function resolveSpawnCommand(command: string, args: string[], platform?: NodeJS.Platform): core.ResolvedSpawnCommand {
  return core.resolveSpawnCommand(command, args, captureCodexHostRuntime(), platform);
}
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals | number = "SIGTERM", options?: Parameters<typeof core.killProcessTree>[3]): boolean {
  return core.killProcessTree(child, captureCodexHostRuntime(), signal, options);
}
export function requestChildShutdown(child: ChildProcess, mode: "graceful" | "terminate"): void {
  core.requestChildShutdown(child, mode, captureCodexHostRuntime());
}
