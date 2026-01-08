import * as vscode from "vscode";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

let logsDirPath: string | undefined;

export async function initLogger(): Promise<void> {
  const logsDir = resolveLogsDir();
  if (!logsDir) {
    return;
  }
  await fs.mkdir(logsDir, { recursive: true });
  logsDirPath = logsDir;
}

export async function logInfo(message: string, data?: unknown): Promise<void> {
  await appendLog("INFO", message, data);
}

export async function logDebug(message: string, data?: unknown): Promise<void> {
  await appendLog("DEBUG", message, data);
}

export async function logError(message: string, data?: unknown): Promise<void> {
  await appendLog("ERROR", message, data);
}

export async function logAssistantRaw(
  cli: string,
  content: string,
  sessionId?: string | null
): Promise<void> {
  if (!logsDirPath || !content) {
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
  raw: string;
  stderr?: string;
};

export async function logCliRaw(
  cli: string,
  sessionId: string | null | undefined,
  payload: Omit<CliRawLog, "time" | "sessionId">
): Promise<void> {
  if (!logsDirPath) {
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
  if (!logsDirPath) {
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

async function appendLog(
  level: "DEBUG" | "INFO" | "ERROR",
  message: string,
  data?: unknown
): Promise<void> {
  if (!logsDirPath) {
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
