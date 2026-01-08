import * as vscode from "vscode";
import { spawn, type ChildProcess } from "child_process";
import { CliName, ThinkingMode } from "./types";
import { getCliArgs, getCliCommand, getThinkingArgs } from "./config";

type RunCliOptions = {
  thinkingMode?: ThinkingMode;
};

const LOCAL_SESSION_PREFIX = "local_";
const KILL_GRACE_MS = 2000;

function escapeShellArg(value: string): string {
  if (value === "") {
    return "''";
  }

  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export async function runCli(cli: CliName, options: RunCliOptions = {}): Promise<void> {
  const command = getCliCommand(cli);
  const baseArgs = getCliArgs(cli);
  const thinkingArgs = options.thinkingMode
    ? getThinkingArgs(cli, options.thinkingMode)
    : [];

  const terminal = vscode.window.createTerminal({
    name: `CLI Bridge: ${cli}`,
  });
  terminal.show(true);

  const fullArgs = [...baseArgs, ...thinkingArgs];
  const joinedArgs = fullArgs.map((arg) => escapeShellArg(arg)).join(" ");
  const commandLine = `${command} ${joinedArgs}`.trim();

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
};

export type RunProcess = {
  pid?: number;
  kill: (signal?: NodeJS.Signals | number) => boolean | void;
};

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
  let sharedArgs = [...baseArgs, ...thinkingArgs];
  if (cli === "codex" && !sharedArgs.includes("--skip-git-repo-check")) {
    sharedArgs = [...sharedArgs, "--skip-git-repo-check"];
  }

  if (prompt === undefined || prompt === "") {
    return sharedArgs;
  }

  if (sessionId) {
    return buildSessionArgs(cli, sharedArgs, sessionId, prompt);
  }

  return buildPromptArgs(cli, sharedArgs, prompt);
}

function buildSessionArgs(
  cli: CliName,
  sharedArgs: string[],
  sessionId: string,
  prompt: string
): string[] {
  switch (cli) {
    case "codex":
      return ["exec", ...sharedArgs, "resume", sessionId, prompt];
    case "gemini":
      if (sessionId.startsWith(LOCAL_SESSION_PREFIX)) {
        return [...sharedArgs, prompt];
      }
      return [...sharedArgs, "--resume", sessionId, prompt];
    case "claude":
      return [...ensureClaudePrintArgs(sharedArgs), "--resume", sessionId, prompt];
    default:
      return [...sharedArgs, prompt];
  }
}

function buildPromptArgs(cli: CliName, sharedArgs: string[], prompt: string): string[] {
  if (cli === "codex") {
    return ["exec", ...sharedArgs, prompt];
  }
  if (cli === "claude") {
    return [...ensureClaudePrintArgs(sharedArgs), prompt];
  }
  return [...sharedArgs, prompt];
}

function ensureClaudePrintArgs(sharedArgs: string[]): string[] {
  const args = [...sharedArgs];
  const hasPrint = args.includes("--print") || args.includes("-p");
  if (!hasPrint) {
    args.push("--print");
  }
  const outputFormatIndex = args.findIndex((arg) => arg === "--output-format" || arg === "-o");
  const defaultOutputFormat = "stream-json";
  if (outputFormatIndex === -1) {
    args.push("--output-format", defaultOutputFormat);
  } else if (args.length > outputFormatIndex + 1) {
    args[outputFormatIndex + 1] = defaultOutputFormat;
  } else {
    args.push(defaultOutputFormat);
  }
  const outputFormat = args[outputFormatIndex === -1 ? args.length - 1 : outputFormatIndex + 1];
  const hasIncludePartial = args.includes("--include-partial-messages");
  if (outputFormat === "stream-json" && !hasIncludePartial) {
    args.push("--include-partial-messages");
  }
  if (outputFormat === "stream-json" && !args.includes("--verbose")) {
    args.push("--verbose");
  }
  return args;
}

export function runCliStream(
  cli: CliName,
  prompt: string,
  handlers: StreamHandlers,
  options: RunStreamOptions = {}
): RunProcess {
  const command = getCliCommand(cli);
  const fullArgs = buildCliArgs(cli, options, prompt);
  const child = spawn(command, fullArgs, {
    cwd: options.cwd,
    env: process.env,
    detached: true,
  });
  if (cli === "codex") {
    try {
      child.stdin?.write("\n");
    } finally {
      child.stdin?.end();
    }
  } else {
    child.stdin?.end();
  }

  child.stdout?.on("data", (data) => {
    handlers.onStdout(data.toString());
  });

  child.stderr?.on("data", (data) => {
    handlers.onStderr(data.toString());
  });

  child.on("error", (error) => {
    handlers.onError(error);
  });

  child.on("close", (code) => {
    handlers.onExit(code);
  });

  return {
    pid: child.pid,
    kill: (signal) => killProcessTree(child, signal),
  };
}

function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals | number = "SIGTERM"
): boolean {
  if (!child.pid) {
    return false;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
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
