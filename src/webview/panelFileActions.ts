import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { t } from "../i18n";
import { logError, logEssential } from "../logger";
import type { CliName } from "../cli/types";
import type {
  ChatMessage,
  RunStreamExportRecordPayload,
  UploadFilePayload,
} from "./types";

export type WorkspacePathItem = vscode.QuickPickItem & { value: string };

export type UploadedFilesResult = {
  paths: string[];
  error?: string;
};

export type RunStreamExportRecord = {
  index: number;
  content: string;
  source: "stdout" | "stderr" | "event";
  createdAt: number;
};

export type RunStreamExportResult = {
  path: string;
  fileName: string;
};

export type SessionHistoryExportMessage = {
  index: number;
  role: ChatMessage["role"];
  kind: ChatMessage["kind"] | null;
  createdAt: number;
  content: string;
};

export type ExportSessionHistoryMessagesOptions = {
  cli: CliName;
  sessionId: string;
  messages: ChatMessage[];
};

const DATA_DIR = path.join(os.homedir(), ".sinitek_cli");
const TEMP_DIR = path.join(DATA_DIR, "temp");
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const TEMP_CLEAN_INTERVAL_MS = 15 * 60 * 1000;
const TEMP_FILE_RANDOM_LENGTH = 8;
const RUN_STREAM_EXPORT_FILENAME_PREFIX = "sinitek-run-stream";
const SESSION_HISTORY_EXPORT_FILENAME_PREFIX = "sinitek-session-history";
const PATH_PICKER_EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}";
const PATH_PICKER_MAX_RESULTS = 2000;

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function collectDirectoryPaths(filePath: string, dirSet: Set<string>): void {
  const normalized = normalizeWorkspacePath(filePath);
  const parts = normalized.split("/");
  if (parts.length <= 1) {
    return;
  }
  for (let i = 1; i < parts.length; i += 1) {
    dirSet.add(parts.slice(0, i).join("/"));
  }
}

export async function buildWorkspacePathItems(): Promise<WorkspacePathItem[]> {
  const files = await vscode.workspace.findFiles("**/*", PATH_PICKER_EXCLUDE, PATH_PICKER_MAX_RESULTS);
  const dirSet = new Set<string>();
  const fileItems = files
    .map((uri) => normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false)))
    .filter((relativePath) => relativePath)
    .map((relativePath) => {
      collectDirectoryPaths(relativePath, dirSet);
      return {
        label: relativePath,
        description: t("pathPicker.file"),
        value: relativePath,
      };
    });
  const dirItems = Array.from(dirSet)
    .sort((a, b) => a.localeCompare(b))
    .map((dirPath) => ({
      label: dirPath + "/",
      description: t("pathPicker.folder"),
      value: dirPath,
    }));
  const sortedFileItems = fileItems.sort((a, b) => a.label.localeCompare(b.label));
  return [...dirItems, ...sortedFileItems];
}

export function startTempCleanup(context: vscode.ExtensionContext): void {
  cleanupTempDir();
  const timer = setInterval(() => {
    cleanupTempDir();
  }, TEMP_CLEAN_INTERVAL_MS);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(timer)));
}

export function ensureTempDir(): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export function cleanupTempDir(): void {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      return;
    }
    const now = Date.now();
    const entries = fs.readdirSync(TEMP_DIR);
    entries.forEach((entry) => {
      const fullPath = path.join(TEMP_DIR, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      } catch (error) {
        void logError("temp-cleanup-entry-failed", error);
      }
    });
  } catch (error) {
    void logError("temp-cleanup-failed", error);
  }
}

export function buildTempFilePath(fileName: string): string {
  const baseName = path.basename(fileName || "file");
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const randomSuffix = Math.random()
    .toString(16)
    .slice(2, 2 + TEMP_FILE_RANDOM_LENGTH);
  const timestamp = Date.now();
  return path.join(TEMP_DIR, `${timestamp}_${randomSuffix}_${safeName || "file"}`);
}

function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:.*;base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return Buffer.from(match[1], "base64");
}

export async function saveUploadedFiles(files: UploadFilePayload[]): Promise<UploadedFilesResult> {
  if (!Array.isArray(files) || files.length === 0) {
    return { paths: [] };
  }
  const savedPaths: string[] = [];
  try {
    ensureTempDir();
    cleanupTempDir();
    for (const file of files) {
      const buffer = decodeDataUrl(file.dataUrl);
      if (!buffer) {
        return { paths: savedPaths, error: t("upload.parseError") };
      }
      const targetPath = buildTempFilePath(file.name);
      fs.writeFileSync(targetPath, buffer);
      savedPaths.push(targetPath);
    }
    return { paths: savedPaths };
  } catch (error) {
    void logError("save-uploaded-files-failed", error);
    return { paths: savedPaths, error: t("upload.saveError") };
  }
}

function normalizeRunStreamExportSource(
  source: RunStreamExportRecordPayload["source"]
): "stdout" | "stderr" | "event" {
  if (source === "stderr") {
    return "stderr";
  }
  if (source === "event") {
    return "event";
  }
  return "stdout";
}

function normalizeRunStreamExportRecords(
  records: RunStreamExportRecordPayload[]
): RunStreamExportRecord[] {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }
  const normalized: RunStreamExportRecord[] = [];
  for (const rawRecord of records) {
    if (!rawRecord || typeof rawRecord !== "object") {
      continue;
    }
    const content = typeof rawRecord.content === "string" ? rawRecord.content : "";
    if (!content.trim()) {
      continue;
    }
    const createdAt = typeof rawRecord.createdAt === "number" && Number.isFinite(rawRecord.createdAt)
      ? rawRecord.createdAt
      : Date.now();
    normalized.push({
      index: normalized.length + 1,
      content,
      source: normalizeRunStreamExportSource(rawRecord.source),
      createdAt,
    });
  }
  return normalized;
}

function buildRunStreamExportFileName(timestamp: number): string {
  const iso = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  return `${RUN_STREAM_EXPORT_FILENAME_PREFIX}-${iso}.txt`;
}

function formatRunStreamExportContent(
  records: RunStreamExportRecord[],
  options: { cli: CliName; tabId: string | null; exportedAt: number }
): string {
  const lines: string[] = [
    "# Sinitek CLI Run Stream Export",
    `Exported At: ${new Date(options.exportedAt).toISOString()}`,
    `CLI: ${options.cli}`,
    `Tab ID: ${options.tabId ?? "-"}`,
    `Record Count: ${records.length}`,
    "",
  ];
  for (const record of records) {
    lines.push(
      `## Line ${record.index} | ${record.source} | ${new Date(record.createdAt).toISOString()}`
    );
    lines.push(record.content);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function resolveRunStreamExportDirectory(): Promise<string> {
  let targetDir = path.join(os.homedir(), "Downloads");
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
    return targetDir;
  } catch {
    targetDir = os.homedir();
    await fs.promises.mkdir(targetDir, { recursive: true });
    return targetDir;
  }
}

export async function exportRunStreamRecordsToTxt(
  records: RunStreamExportRecordPayload[],
  options: { cli: CliName; tabId: string | null }
): Promise<RunStreamExportResult> {
  const normalizedRecords = normalizeRunStreamExportRecords(records);
  if (!normalizedRecords.length) {
    throw new Error(t("runStream.exportEmpty"));
  }
  const exportedAt = Date.now();
  const fileName = buildRunStreamExportFileName(exportedAt);
  const targetDir = await resolveRunStreamExportDirectory();
  const targetPath = path.join(targetDir, fileName);
  const content = formatRunStreamExportContent(normalizedRecords, {
    cli: options.cli,
    tabId: options.tabId,
    exportedAt,
  });
  await fs.promises.writeFile(targetPath, content, "utf8");
  void logEssential("run-stream-export", {
    path: targetPath,
    fileName,
    recordCount: normalizedRecords.length,
    cli: options.cli,
    tabId: options.tabId ?? null,
  });
  return {
    path: targetPath,
    fileName,
  };
}

function sanitizeExportNameSegment(value: string | null | undefined, fallback: string, maxLength: number = 48): string {
  const normalized = String(value ?? "")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
}

function normalizeSessionHistoryExportMessages(messages: ChatMessage[]): SessionHistoryExportMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }
  const normalized: SessionHistoryExportMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const content = typeof message.content === "string" ? message.content : "";
    if (!content.trim()) {
      continue;
    }
    const createdAt = typeof message.createdAt === "number" && Number.isFinite(message.createdAt)
      ? message.createdAt
      : Date.now();
    normalized.push({
      index: normalized.length + 1,
      role: message.role,
      kind: message.kind ?? null,
      createdAt,
      content,
    });
  }
  return normalized;
}

function buildSessionHistoryExportFileName(cli: CliName, sessionId: string, timestamp: number): string {
  const iso = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  const sessionSegment = sanitizeExportNameSegment(sessionId, "session", 40);
  return `${SESSION_HISTORY_EXPORT_FILENAME_PREFIX}-${cli}-${sessionSegment}-${iso}.txt`;
}

function formatSessionHistoryExportContent(
  messages: SessionHistoryExportMessage[],
  options: { cli: CliName; sessionId: string; exportedAt: number }
): string {
  const lines: string[] = [
    "# Sinitek CLI Session History Export",
    `Exported At: ${new Date(options.exportedAt).toISOString()}`,
    `CLI: ${options.cli}`,
    `Session ID: ${options.sessionId}`,
    `Message Count: ${messages.length}`,
    "",
  ];
  for (const message of messages) {
    const kindLabel = message.kind ? ` | ${message.kind}` : "";
    lines.push(
      `## Message ${message.index} | ${message.role}${kindLabel} | ${new Date(message.createdAt).toISOString()}`
    );
    lines.push(message.content);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function exportSessionHistoryMessagesToTxt(
  options: ExportSessionHistoryMessagesOptions
): Promise<RunStreamExportResult> {
  const normalizedMessages = normalizeSessionHistoryExportMessages(options.messages);
  if (!normalizedMessages.length) {
    throw new Error(t("historySession.exportEmpty"));
  }
  const exportedAt = Date.now();
  const fileName = buildSessionHistoryExportFileName(options.cli, options.sessionId, exportedAt);
  const targetDir = await resolveRunStreamExportDirectory();
  const targetPath = path.join(targetDir, fileName);
  const content = formatSessionHistoryExportContent(normalizedMessages, {
    cli: options.cli,
    sessionId: options.sessionId,
    exportedAt,
  });
  await fs.promises.writeFile(targetPath, content, "utf8");
  void logEssential("session-history-export", {
    path: targetPath,
    fileName,
    messageCount: normalizedMessages.length,
    cli: options.cli,
    sessionId: options.sessionId,
  });
  return {
    path: targetPath,
    fileName,
  };
}
