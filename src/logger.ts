import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

let logsDirPath: string | undefined;
let debugLoggingEnabled = false;
let logRetentionCleanupPromise: Promise<void> | null = null;
const logWriteQueues = new Map<string, Promise<void>>();

const ENV_REDACT_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH)/i;
const LOG_RETENTION_DAYS = 7;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LOG_FILE_SIZE_BYTES = 10 * 1024 * 1024;

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

export function scheduleLogRetentionCleanup(): void {
  if (!logsDirPath || logRetentionCleanupPromise) {
    return;
  }
  logRetentionCleanupPromise = pruneExpiredLogs(logsDirPath)
    .catch((error) => {
      void appendLog("ERROR", "logs-retention-cleanup-failed", {
        error: String(error),
      }, { force: true });
    })
    .finally(() => {
      logRetentionCleanupPromise = null;
    });
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
  const time = new Date().toISOString();
  const sessionLabel = sessionId ? sessionId : "new";
  const line = `[${time}] [session:${sessionLabel}]\n${content}\n\n`;
  await appendToSegmentedLog(filename, line);
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
  await appendToSegmentedLog(filename, `${JSON.stringify(entry)}\n`);
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
  await appendToSegmentedLog(filename, `${JSON.stringify(entry)}\n`);
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
  const filename = `sinitek-cli.${cli}.${date}.log`;
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
  await appendToSegmentedLog(filename, `${lines.join("\n")}\n`);
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
  const filename = `sinitek-cli.${cli}.${date}.log`;
  const time = new Date().toISOString();
  const sessionLabel = sessionId ?? "new";
  const prefixed = prefixCliContent(formatCliPrefix(sessionLabel, stream, time), content);
  await appendToSegmentedLog(filename, `${prefixed}\n`);
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
  const filename = `sinitek-cli.${date}.log`;
  const line = `[${time}] [${level}] ${message}${payload}\n`;
  await appendToSegmentedLog(filename, line);
}

async function pruneExpiredLogs(dirPath: string): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const cutoffMs = Date.now() - LOG_RETENTION_DAYS * ONE_DAY_MS;
  let removed = 0;

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".log")) {
      return;
    }
    const filePath = path.join(dirPath, entry.name);
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoffMs) {
        await fs.unlink(filePath);
        removed += 1;
      }
    } catch {
      // Ignore races where files are removed between readdir/stat/unlink.
    }
  }));

  if (removed > 0) {
    await appendLog("DEBUG", "logs-retention-pruned", {
      removed,
      retentionDays: LOG_RETENTION_DAYS,
    });
  }
}

async function appendToSegmentedLog(baseFilename: string, content: string): Promise<void> {
  if (!logsDirPath) {
    return;
  }
  const queueKey = baseFilename;
  const previous = logWriteQueues.get(queueKey) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      if (!logsDirPath) {
        return;
      }
      const contentSize = Buffer.byteLength(content, "utf8");
      const target = await resolveSegmentedLogPath(logsDirPath, baseFilename, contentSize);
      await fs.appendFile(target, content, "utf8");
    });
  logWriteQueues.set(queueKey, current);
  try {
    await current;
  } finally {
    if (logWriteQueues.get(queueKey) === current) {
      logWriteQueues.delete(queueKey);
    }
  }
}

async function resolveSegmentedLogPath(
  dirPath: string,
  baseFilename: string,
  incomingBytes: number
): Promise<string> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const indexes = entries
    .filter((entry) => entry.isFile())
    .map((entry) => parseLogSegmentIndex(baseFilename, entry.name))
    .filter((value): value is number => value !== null);

  const latestIndex = indexes.length ? Math.max(...indexes) : 0;
  const latestFilename = buildSegmentFilename(baseFilename, latestIndex);
  const latestPath = path.join(dirPath, latestFilename);
  const latestSize = await getFileSizeSafe(latestPath);
  if (latestSize + incomingBytes <= MAX_LOG_FILE_SIZE_BYTES) {
    return latestPath;
  }
  const nextIndex = latestIndex + 1;
  return path.join(dirPath, buildSegmentFilename(baseFilename, nextIndex));
}

async function getFileSizeSafe(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

function parseLogSegmentIndex(baseFilename: string, fileName: string): number | null {
  if (fileName === baseFilename) {
    return 0;
  }
  if (!baseFilename.endsWith(".log")) {
    return null;
  }
  const stem = baseFilename.slice(0, -4);
  if (!fileName.startsWith(`${stem}.`) || !fileName.endsWith(".log")) {
    return null;
  }
  const suffix = fileName.slice(stem.length + 1, -4);
  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  return Number(suffix);
}

function buildSegmentFilename(baseFilename: string, index: number): string {
  if (index <= 0) {
    return baseFilename;
  }
  if (!baseFilename.endsWith(".log")) {
    return `${baseFilename}.${index}`;
  }
  const stem = baseFilename.slice(0, -4);
  return `${stem}.${index}.log`;
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
