import type { SpawnOptions } from "child_process";
import { resolveCliCommand, type CommandResolutionContext } from "./commandResolution";
import { buildShellCommandLine, isLoginShellCommand, resolveChildArgv0, stripNvmIncompatibleEnv } from "./processArgv";

export type MacTaskShell = "zsh" | "bash";
export type ResolvedProcessCommand = {
  command: string;
  args: string[];
  usesShell: boolean;
  resolvedFrom: string;
};

export type ProcessEnvironment = {
  baseEnvironment?: NodeJS.ProcessEnv;
  envOverrides?: NodeJS.ProcessEnv;
  overlayEnvOverrides?: NodeJS.ProcessEnv;
};

export function buildProcessEnvironment(input: ProcessEnvironment, pwd?: string): NodeJS.ProcessEnv {
  const env = { ...(input.baseEnvironment ?? process.env), ...input.envOverrides, ...input.overlayEnvOverrides };
  if (pwd) env.PWD = pwd;
  return env;
}

type ProcessSpawnInput = ProcessEnvironment & {
  cwd?: string;
  syncPwd?: boolean;
  processLabel?: string;
  processGroup?: boolean;
  preserveShellEnvironment?: boolean;
  signal?: AbortSignal;
  stdio?: SpawnOptions["stdio"];
};

export function createCliProcessPolicy(platform?: NodeJS.Platform) {
  const host = platform ?? process.platform;
  const loginShell = (shell?: MacTaskShell): string | null => host === "darwin"
    ? shell === "bash" ? "/bin/bash" : "/bin/zsh"
    : null;
  const resolve = (command: string, args: string[], options: {
    macTaskShell?: MacTaskShell;
    allowLoginShell?: boolean;
    lookup?: Omit<CommandResolutionContext, "platform">;
  } = {}): ResolvedProcessCommand | null => {
    const direct = resolveCliCommand(command, { ...options.lookup, platform: host });
    if (direct) return { ...direct, args, usesShell: false };
    const shell = options.allowLoginShell === false ? null : loginShell(options.macTaskShell);
    return shell ? {
      command: shell,
      args: ["-lc", buildShellCommandLine(command, args)],
      usesShell: true,
      resolvedFrom: "mac-shell-fallback",
    } : null;
  };
  const spawnOptions = (command: string, input: ProcessSpawnInput = {}): SpawnOptions => {
    const env = buildProcessEnvironment(input, input.syncPwd ? input.cwd : undefined);
    return {
      cwd: input.cwd,
      env: !input.preserveShellEnvironment && isLoginShellCommand(command) ? stripNvmIncompatibleEnv(env) : env,
      detached: host !== "win32" && input.processGroup !== false,
      windowsHide: true,
      stdio: input.stdio ?? ["pipe", "pipe", "pipe"],
      argv0: resolveChildArgv0(command, input.processLabel),
      ...(input.signal ? { signal: input.signal } : {}),
    };
  };
  return { resolve, loginShell, spawnOptions };
}
