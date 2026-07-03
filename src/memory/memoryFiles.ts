import * as fs from "fs";
import * as path from "path";

import type { WorkspaceMemoryPaths } from "./memoryPaths";

export type MemoryLayer = "episodic" | "semantic" | "procedural";
export type MemoryHotFileId =
  | "rollingSummary"
  | "eventMemory"
  | "projectContext"
  | "userPreferences"
  | "pendingItems"
  | "activeRisks"
  | "lessonsLearned";
export type MemorySourceFileId = MemoryHotFileId | "pitfalls";

export type MemoryHotFileDefinition = {
  id: MemoryHotFileId;
  fileName: string;
  title: string;
  layer: MemoryLayer;
  memoryType: string;
};

export type MemoryHotFileSnapshot = MemoryHotFileDefinition & {
  absolutePath: string;
  relativePath: string;
  content: string;
  sanitizedContent: string;
  updatedAt: string | null;
  exists: boolean;
};

export type SupplementalMemoryFileSnapshot = {
  id: "pitfalls";
  title: string;
  layer: "procedural";
  memoryType: "pitfall";
  absolutePath: string;
  relativePath: string;
  content: string;
  sanitizedContent: string;
  updatedAt: string | null;
  exists: boolean;
};

export type MemoryEntryInput = {
  title: string;
  lines: string[];
  occurredAt?: Date;
};

export type PitfallRecordInput = {
  title: string;
  status?: string;
  firstSeen?: Date;
  scope?: string;
  phenomenon: string[];
  trigger?: string[];
  rootCause?: string[];
  avoidance?: string[];
  verification?: string[];
  relatedInfo?: string[];
};

export const MEMORY_HOT_FILES: readonly MemoryHotFileDefinition[] = [
  { id: "rollingSummary", fileName: "ROLLING_SUMMARY.md", title: "Rolling Summary", layer: "episodic", memoryType: "rolling_summary" },
  { id: "eventMemory", fileName: "EVENT_MEMORY.md", title: "Event Memory", layer: "episodic", memoryType: "event_memory" },
  { id: "projectContext", fileName: "PROJECT_CONTEXT.md", title: "Project Context", layer: "semantic", memoryType: "project_context" },
  { id: "userPreferences", fileName: "USER_PREFERENCES.md", title: "User Preferences", layer: "semantic", memoryType: "user_preferences" },
  { id: "pendingItems", fileName: "PENDING_ITEMS.md", title: "Pending Items", layer: "episodic", memoryType: "pending_items" },
  { id: "activeRisks", fileName: "ACTIVE_RISKS.md", title: "Active Risks", layer: "episodic", memoryType: "active_risk" },
  { id: "lessonsLearned", fileName: "LESSONS_LEARNED.md", title: "Lessons Learned", layer: "procedural", memoryType: "lesson" },
];

const PRIVATE_BLOCK_PATTERNS = [
  /<private>[\s\S]*?<\/private>/gi,
  /<no-memory>[\s\S]*?<\/no-memory>/gi,
  /<memory-private>[\s\S]*?<\/memory-private>/gi,
  /<system_instruction>[\s\S]*?<\/system_instruction>/gi,
  /<system-instruction>[\s\S]*?<\/system-instruction>/gi,
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<persisted-output>[\s\S]*?<\/persisted-output>/gi,
  /<!--[\s\S]*?-->/g,
];

function currentDateStamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function buildFrontMatter(definition: MemoryHotFileDefinition): string {
  const lastVerifiedAt = currentDateStamp();
  return [
    "---",
    `memory_type: ${definition.memoryType}`,
    "scope: project",
    "status: active",
    `last_verified_at: ${lastVerifiedAt}`,
    `source_of_truth: .ch/docs/memory/${definition.fileName}`,
    "derived_from: []",
    "supersedes: []",
    "related_paths: []",
    "---",
  ].join("\n");
}

function buildHotFileTemplate(definition: MemoryHotFileDefinition): string {
  return `${buildFrontMatter(definition)}\n\n# ${definition.title}\n`;
}

function buildReadmeTemplate(): string {
  return [
    "# Workspace Long-Term Memory",
    "",
    "This directory is the hot memory surface for plugin-side long-term memory in the current workspace.",
    "",
    "Hot files:",
    "- `ROLLING_SUMMARY.md`: recent episodic summaries worth carrying across sessions",
    "- `EVENT_MEMORY.md`: important decisions, failures, and milestones",
    "- `PROJECT_CONTEXT.md`: stable project facts and structure",
    "- `USER_PREFERENCES.md`: persistent user collaboration preferences",
    "- `PENDING_ITEMS.md`: open follow-up items",
    "- `ACTIVE_RISKS.md`: currently active risks or caveats",
    "- `LESSONS_LEARNED.md`: repeatable procedures and lessons",
    "",
    "Pitfall records live in `../runbooks/PITFALLS.md` so they stay with the runbook system.",
    "",
    "Generated recall artifacts live under `../generated/memory-index/` and can be rebuilt from the Markdown files above.",
    "",
  ].join("\n");
}

export function getMemoryHotFileDefinition(id: MemoryHotFileId): MemoryHotFileDefinition {
  const matched = MEMORY_HOT_FILES.find((item) => item.id === id);
  if (!matched) {
    throw new Error(`unknown-memory-hot-file:${id}`);
  }
  return matched;
}

export function getMemoryHotFilePath(paths: WorkspaceMemoryPaths, id: MemoryHotFileId): string {
  return path.join(paths.memoryDir, getMemoryHotFileDefinition(id).fileName);
}

export function ensureMemoryWorkspaceScaffold(paths: WorkspaceMemoryPaths): void {
  fs.mkdirSync(paths.memoryDir, { recursive: true });
  fs.mkdirSync(paths.generatedDir, { recursive: true });
  fs.mkdirSync(paths.runbooksDir, { recursive: true });

  const readmePath = path.join(paths.memoryDir, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, buildReadmeTemplate(), "utf8");
  }

  MEMORY_HOT_FILES.forEach((definition) => {
    const filePath = getMemoryHotFilePath(paths, definition.id);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buildHotFileTemplate(definition), "utf8");
    }
  });
}

export function stripMemoryFrontMatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "");
}

export function stripMemoryPrivateBlocks(content: string): string {
  let normalized = stripMemoryFrontMatter(content);
  PRIVATE_BLOCK_PATTERNS.forEach((pattern) => {
    normalized = normalized.replace(pattern, "");
  });
  return normalized.trim();
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function readMemoryHotFiles(paths: WorkspaceMemoryPaths): MemoryHotFileSnapshot[] {
  return MEMORY_HOT_FILES.map((definition) => {
    const absolutePath = getMemoryHotFilePath(paths, definition.id);
    const exists = fs.existsSync(absolutePath);
    const content = exists ? readFileSafe(absolutePath) : "";
    const updatedAt = exists
      ? fs.statSync(absolutePath).mtime.toISOString()
      : null;
    return {
      ...definition,
      absolutePath,
      relativePath: path.relative(paths.workspaceRoot, absolutePath).replace(/\\/g, "/"),
      content,
      sanitizedContent: stripMemoryPrivateBlocks(content),
      updatedAt,
      exists,
    };
  });
}

export function readPitfallsMemoryFile(paths: WorkspaceMemoryPaths): SupplementalMemoryFileSnapshot {
  const absolutePath = paths.pitfallsFile;
  const exists = fs.existsSync(absolutePath);
  const content = exists ? readFileSafe(absolutePath) : "";
  const updatedAt = exists
    ? fs.statSync(absolutePath).mtime.toISOString()
    : null;
  return {
    id: "pitfalls",
    title: "Pitfalls",
    layer: "procedural",
    memoryType: "pitfall",
    absolutePath,
    relativePath: path.relative(paths.workspaceRoot, absolutePath).replace(/\\/g, "/"),
    content,
    sanitizedContent: stripMemoryPrivateBlocks(content),
    updatedAt,
    exists,
  };
}

function normalizeEntryLine(line: string): string | null {
  const normalized = String(line ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

export function appendMemoryEntry(
  paths: WorkspaceMemoryPaths,
  fileId: MemoryHotFileId,
  input: MemoryEntryInput,
): string {
  ensureMemoryWorkspaceScaffold(paths);
  const filePath = getMemoryHotFilePath(paths, fileId);
  const existing = readFileSafe(filePath).trimEnd();
  const lines = input.lines
    .map((line) => normalizeEntryLine(line))
    .filter((line): line is string => Boolean(line));
  if (!lines.length) {
    return filePath;
  }
  const title = normalizeEntryLine(input.title) ?? "Entry";
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  const block = [
    "",
    `## ${occurredAt} - ${title}`,
    ...lines.map((line) => `- ${line}`),
    "",
  ].join("\n");
  fs.writeFileSync(filePath, `${existing}${block}`, "utf8");
  return filePath;
}

function normalizeRecordLines(lines?: string[]): string[] {
  return (lines ?? [])
    .map((line) => normalizeEntryLine(line))
    .filter((line): line is string => Boolean(line));
}

function appendRecordSection(lines: string[], title: string, items?: string[]): void {
  const normalized = normalizeRecordLines(items);
  if (!normalized.length) {
    return;
  }
  lines.push(`### ${title}`);
  normalized.forEach((line) => {
    lines.push(`- ${line}`);
  });
  lines.push("");
}

export function appendPitfallRecord(
  paths: WorkspaceMemoryPaths,
  input: PitfallRecordInput,
): string {
  ensureMemoryWorkspaceScaffold(paths);
  const filePath = paths.pitfallsFile;
  const existing = readFileSafe(filePath).trimEnd();
  const title = normalizeEntryLine(input.title) ?? "Pitfall";
  const firstSeen = input.firstSeen ?? new Date();
  let nextContent = existing;
  if (!nextContent) {
    nextContent = [
      "# Pitfalls",
      "",
      "Auto-captured plugin-side pitfalls are appended here when they have recurring value.",
      "",
    ].join("\n");
  }
  const lines: string[] = [
    "",
    `## ${title}`,
    "",
    `- Status: ${normalizeEntryLine(input.status ?? "") ?? "needs-observation"}`,
    `- First seen: ${currentDateStamp(firstSeen)}`,
    `- Scope: ${normalizeEntryLine(input.scope ?? "") ?? "workspace"}`,
    "",
  ];

  appendRecordSection(lines, "Phenomenon", input.phenomenon);
  appendRecordSection(lines, "Trigger", input.trigger);
  appendRecordSection(lines, "Root Cause", input.rootCause);
  appendRecordSection(lines, "Long-Term Avoidance", input.avoidance);
  appendRecordSection(lines, "Verification", input.verification);
  appendRecordSection(lines, "Related Info", input.relatedInfo);

  fs.writeFileSync(filePath, `${nextContent.trimEnd()}${lines.join("\n").trimEnd()}\n`, "utf8");
  return filePath;
}

export function writeGeneratedMemoryArtifact(
  paths: WorkspaceMemoryPaths,
  fileName: string,
  content: string,
): string {
  ensureMemoryWorkspaceScaffold(paths);
  const absolutePath = path.join(paths.generatedDir, fileName);
  fs.writeFileSync(absolutePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return absolutePath;
}

export function writeGeneratedMemoryJson(
  paths: WorkspaceMemoryPaths,
  fileName: string,
  value: unknown,
): string {
  ensureMemoryWorkspaceScaffold(paths);
  const absolutePath = path.join(paths.generatedDir, fileName);
  fs.writeFileSync(absolutePath, JSON.stringify(value, null, 2), "utf8");
  return absolutePath;
}
