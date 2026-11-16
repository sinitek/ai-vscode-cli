import * as vscode from "vscode";
import { CliName, ThinkingMode } from "./types";
import type { MacTaskShell } from "./types";
import { getCliCommand, getMacTaskShell } from "./config";
import { normalizeCommandInput, resolveCliCommand, splitConfiguredCliCommand } from "./commandResolution";
import { applyOpenCodeVariantArg, buildCliArgs } from "./cliRunArgStrategies";
import { createOpenCodeRuntimeConfigOverlay } from "./opencoderuntimeconfig";
import {
  captureCliProcessOutput,
  isCliProcessCommandAvailable,
  runCliProcess,
  type CliProcessRuntimeHandle,
} from "./cliProcessRuntime";
import {
  extractOpenCodeRuntimeMessageIds,
  extractOpenCodeRuntimeSessionId,
  parseOpenCodeExportStdout,
  parseOpenCodeRunOutput,
  type OpenCodeRunOutput,
} from "./openCodeRunOutput";

export { resolveCliCommand } from "./commandResolution";
export type { ResolvedCliCommand } from "./commandResolution";
export { applyOpenCodeVariantArg, buildCliArgs };
export {
  OPENCODE_ACTIVITY_PENDING_LINE_MAX_BYTES,
  buildOpenCodeRunFailureMessage,
  createOpenCodeStreamActivityTracker,
  detectOpenCodeStreamActivity,
  extractOpenCodePrintLogErrorText,
  extractOpenCodeRuntimeMessageIds,
  extractOpenCodeRuntimeSessionId,
  isOpenCodePlaceholderText,
  parseOpenCodeExportStdout,
  parseOpenCodeRunOutput,
  parseOpenCodeSessionId,
  parseOpenCodeVisibleStreamEvents,
} from "./openCodeRunOutput";
export type {
  OpenCodeFailureMessageOptions,
  OpenCodeRunOutput,
  OpenCodeStreamActivity,
  OpenCodeStreamActivityTracker,
  OpenCodeVisibleStreamEvent,
} from "./openCodeRunOutput";

type RunCliOptions = {
  thinkingMode?: ThinkingMode;
  isolateProjectInstructions?: boolean;
  openCodeVariant?: string | null;
  model?: string | null;
  openCodeSmallModel?: string | null;
  openCodeSmallVariant?: string | null;
  openCodeConfigContent?: string | null;
  imagePaths?: string[];
  envOverrides?: Record<string, string>;
  openCodeServerUrl?: string;
};

const PROCESS_LABEL_PREFIX = "sinitek-ai-vscode-cli";

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }

  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function getMacTaskShellSnapshot(command: string): MacTaskShell | undefined {
  return process.platform === "darwin" && !resolveCliCommand(command)
    ? getMacTaskShell()
    : undefined;
}

export async function isCliCommandAvailable(command: string): Promise<boolean> {
  const commandParts = splitConfiguredCliCommand(command);
  const normalized = commandParts[0] ?? normalizeCommandInput(command);
  if (!normalized) {
    return false;
  }

  return isCliProcessCommandAvailable(normalized, getMacTaskShellSnapshot(normalized));
}

export async function runCli(cli: CliName, options: RunCliOptions = {}): Promise<void> {
  const command = getCliCommand(cli);
  const commandParts = splitConfiguredCliCommand(command);
  const commandExecutable = commandParts[0] ?? command;
  const configuredArgs = commandParts.slice(1);
  const fullArgs = buildCliArgs(cli, options);
  const terminalEnv = options.envOverrides ? { ...process.env, ...options.envOverrides } : process.env;
  const resolved = resolveCliCommand(commandExecutable);

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
    env: terminalEnv,
  });

  const joinedArgs = [...configuredArgs, ...fullArgs].map((arg) => escapeShellArg(arg)).join(" ");
  const commandLine = `${resolved?.command ?? commandExecutable} ${joinedArgs}`.trim();

  terminal.sendText(commandLine);
}

type StreamHandlers = {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onExit: (code: number | null) => void;
  onError: (error: Error) => void;
};

type RunStreamOptions = RunCliOptions & {
  environment?: NodeJS.ProcessEnv;
  commandOverride?: string;
  argsOverride?: string[];
  cwd?: string;
  sessionId?: string | null;
  processLabel?: string;
};

export type CapturedCliOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  resolvedCommand?: string;
};

export type RunProcess = {
  pid?: number;
  resolvedCommand?: string;
  kill: (signal?: NodeJS.Signals | number) => boolean | void;
  /** Actual child close + stdio drain + owned temporary overlay removal. Not a
   * runner/session/root/tab receipt. Missing observation is not cleanup. */
  lifecycle?: CliProcessRuntimeHandle["lifecycle"];
};

export const OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS = 15 * 1000;

export async function recoverOpenCodeMissingAssistantOutput(options: {
  stdout: string;
  stderr: string;
  cwd?: string;
  exportSession?: (sessionId: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
}): Promise<OpenCodeRunOutput> {
  const parsed = parseOpenCodeRunOutput(options.stdout, options.stderr);
  if (parsed.hasStructuredFinalAnswer && parsed.finalText?.trim()) {
    return parsed;
  }
  const sessionId = extractOpenCodeRuntimeSessionId(`${options.stdout}\n${options.stderr}`);
  if (!sessionId || !/^ses_[A-Za-z0-9]+$/u.test(sessionId)) {
    return parsed;
  }
  try {
    const exported = options.exportSession
      ? await options.exportSession(sessionId)
      : await captureCliOutput(getCliCommand("opencode"), ["export", sessionId], {
          cwd: options.cwd,
          timeoutMs: OPENCODE_EXPORT_RECOVERY_TIMEOUT_MS,
        });
    if (exported.exitCode !== 0) {
      return parsed;
    }
    const recovered = parseOpenCodeExportStdout(
      exported.stdout,
      extractOpenCodeRuntimeMessageIds(`${options.stdout}\n${options.stderr}`),
    );
    if (!recovered?.hasStructuredFinalAnswer || !recovered.finalText?.trim()) {
      return parsed;
    }
    return {
      finalText: recovered.finalText,
      errorText: null,
      statusText: parsed.statusText,
      hasStructuredFinalAnswer: true,
    };
  } catch {
    return parsed;
  }
}

export function buildProcessLabel(cli: CliName, sessionId?: string | null): string {
  const suffix = sessionId ? sessionId : "new";
  return `${PROCESS_LABEL_PREFIX}-${cli}/${suffix}`;
}

function createOpenCodeRuntimeOverlayForOptions(options: RunCliOptions) {
  return options.openCodeConfigContent && options.model
    ? createOpenCodeRuntimeConfigOverlay({
        configContent: options.openCodeConfigContent,
        primaryModel: options.model,
        smallModel: options.openCodeSmallModel ?? null,
        primaryVariant: options.openCodeVariant ?? null,
        smallVariant: options.openCodeSmallVariant ?? null,
      })
    : null;
}

export function startOpenCodeServer(
  port: number,
  handlers: Partial<StreamHandlers> = {},
  options: RunStreamOptions = {},
): RunProcess {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    const error = new Error(`invalid-opencode-server-port:${port}`);
    handlers.onError?.(error);
    handlers.onExit?.(1);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }

  const configuredCommand = getCliCommand("opencode");
  const runtimeOverlay = createOpenCodeRuntimeOverlayForOptions(options);
  if (runtimeOverlay && (!runtimeOverlay.ok || !runtimeOverlay.overlay)) {
    const error = new Error(runtimeOverlay.issues.map((issue) => issue.message).join("\n"));
    handlers.onError?.(error);
    handlers.onExit?.(1);
    return { pid: undefined, resolvedCommand: undefined, kill: () => false };
  }
  const overlay = runtimeOverlay?.overlay ?? null;
  const args = [
    "serve",
    ...(options.isolateProjectInstructions ? ["--pure"] : []),
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ];
  const commandParts = splitConfiguredCliCommand(configuredCommand);
  const handle = runCliProcess({
    command: commandParts[0] ?? configuredCommand,
    args: [...commandParts.slice(1), ...args],
    cwd: options.cwd,
    envOverrides: options.envOverrides,
    processLabel: options.processLabel,
    macTaskShell: getMacTaskShellSnapshot(commandParts[0] ?? configuredCommand),
    overlay,
  }, handlers, "ignore");
  return handle;
}

export function runCliStream(
  cli: CliName,
  prompt: string,
  handlers: StreamHandlers,
  options: RunStreamOptions = {}
): RunProcess {
  const configuredCommand = options.commandOverride ?? getCliCommand(cli);
  const fullArgs = options.argsOverride ?? buildCliArgs(cli, options, prompt);
  const processLabel = options.processLabel;
  const runtimeOverlay = cli === "opencode"
    ? createOpenCodeRuntimeOverlayForOptions(options)
    : null;
  if (runtimeOverlay && (!runtimeOverlay.ok || !runtimeOverlay.overlay)) {
    const error = new Error(runtimeOverlay.issues.map((issue) => issue.message).join("\n"));
    handlers.onError(error);
    handlers.onExit(1);
    return {
      pid: undefined,
      resolvedCommand: undefined,
      kill: () => false,
    };
  }
  const overlay = runtimeOverlay?.overlay ?? null;
  const commandParts = splitConfiguredCliCommand(configuredCommand);
  return runCliProcess({
    command: commandParts[0] ?? configuredCommand,
    args: [...commandParts.slice(1), ...fullArgs],
    cwd: options.cwd,
    baseEnvironment: options.environment,
    envOverrides: options.envOverrides,
    processLabel,
    macTaskShell: getMacTaskShellSnapshot(commandParts[0] ?? configuredCommand),
    overlay,
  }, handlers);
}

export function captureCliOutput(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; envOverrides?: Record<string, string> } = {}
): Promise<CapturedCliOutput> {
  const commandParts = splitConfiguredCliCommand(command);
  return captureCliProcessOutput({
    command: commandParts[0] ?? command,
    args: [...commandParts.slice(1), ...args],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    envOverrides: options.envOverrides,
    macTaskShell: getMacTaskShellSnapshot(commandParts[0] ?? command),
  });
}
