import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

let logsDirPath: string | undefined;
let debugLoggingEnabled = false;

const ENV_REDACT_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH)/i;

export async function initLogger(): Promise<void> {
  const logsDir = resolveLogsDir();
  if (!logsDir) {
    return;
  }
  await fs.mkdir(logsDir, { recursive: true });
  logsDirPath = logsDir;
}

export function setDebugLogging(enabled: boolean): void {
  debugLoggingEnabled = enabled;
}

export function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const entries = Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const normalized = String(value);
      const redacted = ENV_REDACT_PATTERN.test(key) ? "[redacted]" : normalized;
      return [key, redacted] as const;
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  return Object.fromEntries(entries);
}

export async function logInfo(message: string, data?: unknown): Promise<void> {
  await appendLog("INFO", message, data);
}

export async function logDebug(message: string, data?: unknown): Promise<void> {
  await appendLog("DEBUG", message, data);
}

export async function logError(message: string, data?: unknown): Promise<void> {
  await appendLog("ERROR", message, data, { force: true });
}

export async function logEssential(message: string, data?: unknown): Promise<void> {
  await appendLog("INFO", message, data, { force: true });
}

export async function logAssistantRaw(
  cli: string,
  content: string,
  sessionId?: string | null
): Promise<void> {
  if (!logsDirPath || !debugLoggingEnabled || !content) {
    return;
  }
  const date = formatLocalDate(new Date());
  const filename = `sinitek-cli.${cli}.${date}.log`;
  const filePath = path.join(logsDirPath, filename);
  const time = new Date().toISOString();
  const sessionLabel = sessionId ? sessionId : "new";
  const line = `[${time}] [session:${sessionLabel}]\n${content}\n\n`;
  await fs.appendFile(filePath, line, "utf8");
}

type CliRawLog = {
  time: string;
  sessionId: string;
  command: string;
  args: string[];
  cwd?: string;
  exitCode?: number | null;
  error?: string;
  stdin?: string;
  stdout?: string;
  raw: string;
  stderr?: string;
};

export async function logCliRaw(
  cli: string,
  sessionId: string | null | undefined,
  payload: Omit<CliRawLog, "time" | "sessionId">
): Promise<void> {
  if (!logsDirPath || !debugLoggingEnabled) {
    return;
  }
  const date = formatLocalDate(new Date());
  const filename = `sinitek-cli.${cli}.${date}.log`;
  const filePath = path.join(logsDirPath, filename);
  const time = new Date().toISOString();
  const sessionLabel = sessionId ?? "new";
  const entry: CliRawLog = {
    time,
    sessionId: sessionLabel,
    command: payload.command,
    args: payload.args,
    cwd: payload.cwd,
    exitCode: payload.exitCode,
    error: payload.error,
    stdin: payload.stdin,
    stdout: payload.stdout ?? payload.raw,
    raw: payload.raw,
    stderr: payload.stderr,
  };
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

const STREAM_LOG_PREVIEW_LIMIT = 400;

type CliStreamLog = {
  time: string;
  sessionId: string;
  stream: "stdout" | "stderr";
  preview: string;
  content: string;
};

export async function logCliStream(
  cli: string,
  sessionId: string | null | undefined,
  stream: "stdout" | "stderr",
  content: string
): Promise<void> {
  if (!logsDirPath || !debugLoggingEnabled) {
    return;
  }
  const date = formatLocalDate(new Date());
  const filename = `sinitek-cli.${cli}.${date}.log`;
  const filePath = path.join(logsDirPath, filename);
  const time = new Date().toISOString();
  const sessionLabel = sessionId ?? "new";
  const normalized = content.replace(/\r\n/g, "\n");
  const preview =
    normalized.length <= STREAM_LOG_PREVIEW_LIMIT
      ? normalized
      : normalized.slice(0, STREAM_LOG_PREVIEW_LIMIT) + "...";
  const entry: CliStreamLog = {
    time,
    sessionId: sessionLabel,
    stream,
    preview,
    content: normalized,
  };
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

type CliInteractiveStart = {
  command: string;
  args: string[];
  cwd?: string;
  stdin?: string;
  resolvedCommand?: string;
  resolvedFrom?: string;
  execPath?: string;
  entrypoint?: string;
};

function formatCliPrefix(sessionLabel: string, tag: string, time: string): string {
  return `[${time}] [session:${sessionLabel}] [${tag}]`;
}

function normalizeCliContent(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function prefixCliContent(prefix: string, content: string): string {
  const normalized = normalizeCliContent(content);
  const lines = normalized.split("\n");
  return lines.map((line) => `${prefix} ${line}`).join("\n");
}

export async function logCliInteractiveStart(
  cli: string,
  sessionId: string | null | undefined,
  payload: CliInteractiveStart
): Promise<void> {
  if (!logsDirPath || !debugLoggingEnabled) {
    return;
  }
  const date = formatLocalDate(new Date());
  const filePath = path.join(logsDirPath, `sinitek-cli.${cli}.${date}.log`);
  const time = new Date().toISOString();
  const sessionLabel = sessionId ?? "new";
  const commandLine = [payload.command, ...payload.args].join(" ").trim();
  const lines: string[] = [];
  lines.push(`${formatCliPrefix(sessionLabel, "command", time)} ${commandLine}`);
  if (payload.resolvedCommand) {
    lines.push(`${formatCliPrefix(sessionLabel, "resolved", time)} ${payload.resolvedCommand}`);
  }
  if (payload.resolvedFrom) {
    lines.push(`${formatCliPrefix(sessionLabel, "resolved-from", time)} ${payload.resolvedFrom}`);
  }
  if (payload.execPath) {
    lines.push(`${formatCliPrefix(sessionLabel, "exec", time)} ${payload.execPath}`);
  }
  if (payload.entrypoint) {
    lines.push(`${formatCliPrefix(sessionLabel, "entrypoint", time)} ${payload.entrypoint}`);
  }
  if (payload.cwd) {
    lines.push(`${formatCliPrefix(sessionLabel, "cwd", time)} ${payload.cwd}`);
  }
  if (payload.stdin !== undefined) {
    lines.push(prefixCliContent(formatCliPrefix(sessionLabel, "stdin", time), payload.stdin));
  }
  await fs.appendFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

export async function logCliInteractiveOutput(
  cli: string,
  sessionId: string | null | undefined,
  stream: "stdout" | "stderr" | "event" | "trace",
  content: string
): Promise<void> {
  if (!logsDirPath || !debugLoggingEnabled || !content) {
    return;
  }
  const date = formatLocalDate(new Date());
  const filePath = path.join(logsDirPath, `sinitek-cli.${cli}.${date}.log`);
  const time = new Date().toISOString();
  const sessionLabel = sessionId ?? "new";
  const prefixed = prefixCliContent(formatCliPrefix(sessionLabel, stream, time), content);
  await fs.appendFile(filePath, `${prefixed}\n`, "utf8");
}

type AppendLogOptions = {
  force?: boolean;
};

async function appendLog(
  level: "DEBUG" | "INFO" | "ERROR",
  message: string,
  data?: unknown,
  options: AppendLogOptions = {}
): Promise<void> {
  if (!logsDirPath) {
    return;
  }
  if (!debugLoggingEnabled && !options.force && level !== "ERROR") {
    return;
  }
  const time = new Date().toISOString();
  const payload = formatData(data);
  const date = formatLocalDate(new Date());
  const filePath = path.join(logsDirPath, `sinitek-cli.${date}.log`);
  const line = `[${time}] [${level}] ${message}${payload}\n`;
  await fs.appendFile(filePath, line, "utf8");
}

function formatData(data?: unknown): string {
  if (data === undefined) {
    return "";
  }
  try {
    return ` | ${JSON.stringify(data)}`;
  } catch {
    return " | [unserializable]";
  }
}

function resolveLogsDir(): string | undefined {
  return path.join(os.homedir(), ".sinitek_cli", "logs");
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
