import * as vscode from "vscode";
import { type ChildProcess } from "child_process";
import { spawn } from "cross-spawn";
import { CliName, MacTaskShell, ThinkingMode } from "./types";
import { getCliArgs, getCliCommand, getMacTaskShell, getThinkingArgs } from "./config";
import { applyModelArg } from "./modelArgs";
import { normalizeCommandInput, resolveCliCommand } from "./commandResolution";

export { resolveCliCommand } from "./commandResolution";
export type { ResolvedCliCommand } from "./commandResolution";

type RunCliOptions = {
  thinkingMode?: ThinkingMode;
  model?: string | null;
  openCodeConfigContent?: string | null;
  imagePaths?: string[];
  envOverrides?: Record<string, string>;
};

const PROCESS_LABEL_PREFIX = "sinitek-ai-vscode-cli";
const LOCAL_SESSION_PREFIX = "local_";
const KILL_GRACE_MS = 2000;

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }

  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function checkCommandAvailableOnMacShell(command: string, shell: MacTaskShell): Promise<boolean> {
  return new Promise((resolve) => {
    const shellPath = resolveMacTaskShellExecutable(shell);
    const commandLine = `command -v ${escapeShellArg(command)} >/dev/null 2>&1`;
    const child = spawn(shellPath, ["-lc", commandLine], {
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {
      resolve(false);
    });
    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

export async function isCliCommandAvailable(command: string): Promise<boolean> {
  const normalized = normalizeCommandInput(command);
  if (!normalized) {
    return false;
  }

  if (resolveCliCommand(normalized)) {
    return true;
  }

  if (process.platform !== "darwin") {
    return false;
  }

  return checkCommandAvailableOnMacShell(normalized, getMacTaskShell());
}

export async function runCli(cli: CliName, options: RunCliOptions = {}): Promise<void> {
  const command = getCliCommand(cli);
  const fullArgs = buildCliArgs(cli, options);
  const terminalEnv = options.envOverrides ? { ...process.env, ...options.envOverrides } : process.env;
  const resolved = resolveCliCommand(command);

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
    env: terminalEnv,
  });

  const joinedArgs = fullArgs.map((arg) => escapeShellArg(arg)).join(" ");
  const commandLine = `${resolved?.command ?? command} ${joinedArgs}`.trim();

  terminal.sendText(commandLine);
}

type StreamHandlers = {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onExit: (code: number | null) => void;
  onError: (error: Error) => void;
};

type RunStreamOptions = RunCliOptions & {
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
};

export type OpenCodeRunOutput = {
  finalText: string | null;
  errorText: string | null;
  statusText: string | null;
};

export type OpenCodeFailureMessageOptions = {
  missingFinalOutputMessage?: string;
  missingFinalOutputWithStatusMessage?: (statusText: string) => string;
};

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OPENCODE_STATUS_LINE_PATTERN = /^>\s*[^·\n]+(?:\s*·\s*.+)?$/u;
const OPENCODE_JSON_TEXT_PART_TYPES = new Set([
  "text",
  "text-delta",
  "text_delta",
  "message",
  "message-part",
  "message_part",
  "part",
  "part-delta",
  "part_delta",
  "assistant",
  "assistant-message",
  "assistant_message",
  "output",
  "result",
]);

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function cleanOpenCodeStatusOutput(value: string): string {
  return stripAnsi(value)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !OPENCODE_STATUS_LINE_PATTERN.test(line))
    .join("\n")
    .trim();
}

function readStringProperty(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function readNumberProperty(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function pushUniqueText(target: string[], value: string | null | undefined): void {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return;
  }
  if (!target.includes(normalized)) {
    target.push(normalized);
  }
}

function collectOpenCodeProviderErrorDetails(error: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const details: string[] = [];
  pushUniqueText(details, readStringProperty(error, ["name"]));
  pushUniqueText(details, readStringProperty(error, ["message"]));
  pushUniqueText(details, readStringProperty(data, ["message", "error", "detail"]));
  pushUniqueText(details, readStringProperty(data, ["ref", "requestId", "requestID", "request_id"]));
  pushUniqueText(details, readStringProperty(error, ["ref", "requestId", "requestID", "request_id"]));

  const statusCode = readNumberProperty(data, ["statusCode", "status"]);
  if (statusCode !== null) {
    pushUniqueText(details, String(statusCode));
  }

  const metadata = data.metadata && typeof data.metadata === "object"
    ? data.metadata as Record<string, unknown>
    : {};
  pushUniqueText(details, readStringProperty(metadata, ["url"]));

  const responseBody = readStringProperty(data, ["responseBody", "body"]);
  if (responseBody) {
    try {
      const parsedBody = JSON.parse(responseBody) as unknown;
      if (parsedBody && typeof parsedBody === "object") {
        const bodyRecord = parsedBody as Record<string, unknown>;
        const bodyError = bodyRecord.error && typeof bodyRecord.error === "object"
          ? bodyRecord.error as Record<string, unknown>
          : bodyRecord;
        pushUniqueText(details, readStringProperty(bodyError, ["message", "type", "code", "param"]));
        pushUniqueText(details, readStringProperty(bodyError, ["type"]));
        pushUniqueText(details, readStringProperty(bodyError, ["code"]));
      }
    } catch {
      pushUniqueText(details, responseBody);
    }
  }

  return details;
}

function combineOpenCodeErrorText(...values: Array<string | null | undefined>): string | null {
  const lines: string[] = [];
  for (const value of values) {
    for (const line of (value ?? "").split(/\r?\n/u)) {
      pushUniqueText(lines, line);
    }
  }
  return lines.join("\n").trim() || null;
}

function collectOpenCodeJsonText(value: unknown, parentType?: string): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : parentType;
  const normalizedType = typeof type === "string" ? type.toLowerCase() : "";
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
  const shouldReadText = OPENCODE_JSON_TEXT_PART_TYPES.has(normalizedType)
    || role === "assistant"
    || parentType === "assistant";
  const nestedParentType = role === "assistant" ? "assistant" : normalizedType || parentType;
  const chunks: string[] = [];

  if (shouldReadText) {
    const directText = readStringProperty(record, ["text", "content", "delta", "message", "output", "result"]);
    if (directText) {
      chunks.push(directText);
    }
  }

  const part = record.part;
  if (part && typeof part === "object") {
    chunks.push(...collectOpenCodeJsonText(part, nestedParentType));
  }

  for (const key of ["parts", "content", "message", "messages", "output"]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      nested.forEach((item) => chunks.push(...collectOpenCodeJsonText(item, nestedParentType)));
    } else if (nested && typeof nested === "object") {
      chunks.push(...collectOpenCodeJsonText(nested, nestedParentType));
    }
  }

  return chunks;
}

function parseOpenCodeJsonOutput(stdout: string): string | null {
  const chunks: string[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      chunks.push(...collectOpenCodeJsonText(JSON.parse(trimmed)));
    } catch {
      // Ignore non-JSON progress lines in default output.
    }
  }
  const finalText = chunks.join("").trim();
  return finalText || null;
}

function parseOpenCodePlainOutput(stdout: string): string | null {
  const cleaned = cleanOpenCodeStatusOutput(stdout);
  if (!cleaned) {
    return null;
  }
  const meaningfulLines = cleaned
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (meaningfulLines.length > 0 && meaningfulLines.every((line) => line.startsWith("{"))) {
    return null;
  }
  const jsonText = parseOpenCodeJsonOutput(cleaned);
  return jsonText ?? cleaned;
}

function collectOpenCodeJsonErrors(stdout: string): string | null {
  const errors: string[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      if (record.type !== "error" || !record.error || typeof record.error !== "object") {
        continue;
      }
      const error = record.error as Record<string, unknown>;
      const data = error.data && typeof error.data === "object"
        ? error.data as Record<string, unknown>
        : {};
      const details = collectOpenCodeProviderErrorDetails(error, data);
      if (details.length > 0) {
        pushUniqueText(errors, details.join("\n"));
      } else {
        pushUniqueText(errors, readStringProperty(error, ["message", "name"]));
      }
    } catch {
      // Ignore non-JSON progress lines in default output.
    }
  }

  return errors.join("\n").trim() || null;
}

export function parseOpenCodeRunOutput(stdout: string, stderr: string): OpenCodeRunOutput {
  const finalText = parseOpenCodeJsonOutput(stdout) ?? parseOpenCodePlainOutput(stdout);
  const stderrErrorText = cleanOpenCodeStatusOutput(stderr);
  const jsonErrorText = collectOpenCodeJsonErrors(stdout);
  const statusText = stripAnsi(stderr)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => OPENCODE_STATUS_LINE_PATTERN.test(line))
    .join("\n")
    .trim();

  return {
    finalText,
    errorText: combineOpenCodeErrorText(jsonErrorText, stderrErrorText),
    statusText: statusText || null,
  };
}

export function buildOpenCodeRunFailureMessage(
  output: OpenCodeRunOutput,
  fallbackMessage: string,
  options: OpenCodeFailureMessageOptions = {},
): string {
  if (output.errorText) {
    return output.errorText;
  }
  if (output.statusText) {
    return options.missingFinalOutputWithStatusMessage?.(output.statusText)
      ?? `OpenCode exited successfully, but did not return an assistant answer. Last status: ${output.statusText}`;
  }
  return fallbackMessage || options.missingFinalOutputMessage
    || "OpenCode exited without returning an assistant answer or a provider error. Check the OpenCode provider/model config or run `opencode run --format json` to verify it.";
}

export function buildCliArgs(
  cli: CliName,
  options: RunStreamOptions = {},
  prompt?: string
): string[] {
  const baseArgs = getCliArgs(cli);
  const thinkingArgs = options.thinkingMode
    ? getThinkingArgs(cli, options.thinkingMode)
    : [];
  const sessionId = options.sessionId ?? null;
  let sharedArgs = applyModelArg(cli, [...baseArgs, ...thinkingArgs], options.model, {
    openCodeConfigContent: options.openCodeConfigContent,
  });
  if (cli === "codex" && !sharedArgs.includes("--skip-git-repo-check")) {
    sharedArgs = [...sharedArgs, "--skip-git-repo-check"];
  }
  if (cli === "codex" && Array.isArray(options.imagePaths) && options.imagePaths.length) {
    const normalizedImagePaths = options.imagePaths
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (normalizedImagePaths.length) {
      sharedArgs = [
        ...sharedArgs,
        ...normalizedImagePaths.flatMap((imagePath) => ["--image", imagePath]),
      ];
    }
  }

  if (prompt === undefined || prompt === "") {
    return sharedArgs;
  }

  if (cli === "opencode") {
    return buildOpenCodeRunArgs(sharedArgs, sessionId, prompt);
  }

  if (sessionId) {
    return buildSessionArgs(cli, sharedArgs, sessionId, prompt);
  }

  return buildPromptArgs(cli, sharedArgs, prompt);
}

export function buildProcessLabel(cli: CliName, sessionId?: string | null): string {
  const suffix = sessionId ? sessionId : "new";
  return `${PROCESS_LABEL_PREFIX}-${cli}/${suffix}`;
}

function buildSessionArgs(
  _cli: CliName,
  sharedArgs: string[],
  _sessionId: string,
  prompt: string
): string[] {
  return [...sharedArgs, prompt];
}

function buildPromptArgs(_cli: CliName, sharedArgs: string[], prompt: string): string[] {
  return [...sharedArgs, prompt];
}

function buildOpenCodeRunArgs(
  sharedArgs: string[],
  sessionId: string | null,
  prompt: string
): string[] {
  const hasRunSubcommand = sharedArgs[0] === "run";
  const runArgs = hasRunSubcommand ? [...sharedArgs] : ["run", ...sharedArgs];
  if (!runArgs.includes("--format") && !runArgs.some((arg) => arg.startsWith("--format="))) {
    runArgs.splice(1, 0, "--format", "json");
  }
  if (sessionId && !runArgs.includes("--session") && !runArgs.includes("-s")) {
    return [...runArgs, "--session", sessionId, prompt];
  }
  return [...runArgs, prompt];
}

function buildShellCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((segment) => escapeShellArg(segment)).join(" ");
}

function resolveMacTaskShellExecutable(shell: MacTaskShell): string {
  return shell === "bash" ? "/bin/bash" : "/bin/zsh";
}

function resolveSpawnCommand(command: string, args: string[]): {
  commandToSpawn: string;
  argsToSpawn: string[];
  resolvedCommand: string;
} | null {
  const resolved = resolveCliCommand(command);
  if (resolved) {
    return {
      commandToSpawn: resolved.command,
      argsToSpawn: args,
      resolvedCommand: resolved.command,
    };
  }

  if (process.platform !== "darwin") {
    return null;
  }

  const macTaskShell = getMacTaskShell();
  return {
    commandToSpawn: resolveMacTaskShellExecutable(macTaskShell),
    argsToSpawn: ["-lc", buildShellCommandLine(command, args)],
    resolvedCommand: command,
  };
}

export function runCliStream(
  cli: CliName,
  prompt: string,
  handlers: StreamHandlers,
  options: RunStreamOptions = {}
): RunProcess {
  const configuredCommand = getCliCommand(cli);
  const fullArgs = buildCliArgs(cli, options, prompt);
  const processLabel = options.processLabel;
  const spawnCommand = resolveSpawnCommand(configuredCommand, fullArgs);
  if (!spawnCommand) {
    const error = new Error(`spawn ${configuredCommand} ENOENT`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    handlers.onError(error);
    handlers.onExit(127);
    return {
      pid: undefined,
      resolvedCommand: undefined,
      kill: () => false,
    };
  }

  const child = spawn(spawnCommand.commandToSpawn, spawnCommand.argsToSpawn, {
    cwd: options.cwd,
    env: options.envOverrides ? { ...process.env, ...options.envOverrides } : process.env,
    argv0: processLabel,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end();

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (data) => {
    handlers.onStdout(data);
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (data) => {
    handlers.onStderr(data);
  });

  child.on("error", (error) => {
    handlers.onError(error);
  });

  child.on("close", (code) => {
    handlers.onExit(code);
  });

  return {
    pid: child.pid,
    resolvedCommand: spawnCommand.resolvedCommand,
    kill: (signal) => killProcessTree(child, signal),
  };
}

export function captureCliOutput(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<CapturedCliOutput> {
  return new Promise((resolve, reject) => {
    const spawnCommand = resolveSpawnCommand(command, args);
    if (!spawnCommand) {
      const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      reject(error);
      return;
    }

    const child = spawn(spawnCommand.commandToSpawn, spawnCommand.argsToSpawn, {
      cwd: options.cwd,
      env: process.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const finishResolve = (payload: CapturedCliOutput): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve(payload);
    };

    const finishReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finishReject(error);
    });

    child.on("close", (code) => {
      finishResolve({
          stdout,
          stderr,
          exitCode: code,
          resolvedCommand: spawnCommand.resolvedCommand,
        });
      });

    const timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 0;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        killProcessTree(child, "SIGTERM");
        finishReject(new Error(`capture-cli-output-timeout:${timeoutMs}`));
      }, timeoutMs);
    }
  });
}

function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals | number = "SIGTERM"
): boolean {
  if (!child.pid) {
    return false;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return true;
  }
  const pid = child.pid;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    try {
      child.kill(signal);
    } catch (innerError) {
      return false;
    }
  }
  if (signal === "SIGTERM") {
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        try {
          child.kill("SIGKILL");
        } catch (innerError) {
          return;
        }
      }
    }, KILL_GRACE_MS);
  }
  return true;
}
