import * as fs from "fs";
import * as path from "path";

import type { WorkspaceMemoryPaths } from "./memory/memoryPaths";

const WORKSPACE_SCAFFOLD_ROOT = path.join("media", "workspace-scaffold");
const APPENDED_AGENTS_MARKER_START = "<!-- BEGIN SINITEK WORKSPACE HARNESS -->";
const APPENDED_AGENTS_MARKER_END = "<!-- END SINITEK WORKSPACE HARNESS -->";
const CLAUDE_POINTER_CONTENT = "See [AGENTS.md](./AGENTS.md) for workspace instructions.\n";
const CODEGRAPH_GITIGNORE_ENTRY = ".codegraph/";

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readFileIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function copyMissingFilesRecursively(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyMissingFilesRecursively(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile() && !fs.existsSync(targetPath)) {
      ensureParentDir(targetPath);
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function ensureTemplateFile(targetPath: string, templatePath: string): void {
  if (fs.existsSync(targetPath) || !fs.existsSync(templatePath)) {
    return;
  }
  ensureParentDir(targetPath);
  fs.copyFileSync(templatePath, targetPath);
}

function buildAppendedAgentsBlock(templateContent: string): string {
  return [
    "",
    APPENDED_AGENTS_MARKER_START,
    normalizeText(templateContent).trim(),
    APPENDED_AGENTS_MARKER_END,
    "",
  ].join("\n");
}

function ensureWorkspaceAgentsFile(targetPath: string, templatePath: string): void {
  const templateContent = readFileIfExists(templatePath).trim();
  if (!templateContent) {
    return;
  }
  if (!fs.existsSync(targetPath)) {
    ensureParentDir(targetPath);
    fs.writeFileSync(targetPath, `${templateContent}\n`, "utf8");
    return;
  }

  const existing = readFileIfExists(targetPath);
  if (existing.includes(APPENDED_AGENTS_MARKER_START)) {
    return;
  }

  const separator = existing.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(targetPath, `${existing}${separator}${buildAppendedAgentsBlock(templateContent)}`, "utf8");
}

function ensureClaudePointerFile(targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    return;
  }
  ensureParentDir(targetPath);
  fs.writeFileSync(targetPath, CLAUDE_POINTER_CONTENT, "utf8");
}

function ensureCodeGraphGitignoreEntry(workspaceRoot: string): void {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  const existing = readFileIfExists(gitignorePath);
  const normalized = normalizeText(existing);
  const hasEntry = normalized
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === CODEGRAPH_GITIGNORE_ENTRY || line === ".codegraph");
  if (hasEntry) {
    return;
  }

  const prefix = normalized && !normalized.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(gitignorePath, `${normalized}${prefix}${CODEGRAPH_GITIGNORE_ENTRY}\n`, "utf8");
}

export function resolveWorkspaceScaffoldRoot(extensionRoot: string): string {
  return path.join(extensionRoot, WORKSPACE_SCAFFOLD_ROOT);
}

export function ensureWorkspaceHarnessScaffold(
  extensionRoot: string,
  paths: WorkspaceMemoryPaths,
): void {
  const scaffoldRoot = resolveWorkspaceScaffoldRoot(extensionRoot);
  copyMissingFilesRecursively(path.join(scaffoldRoot, ".ch"), paths.projectChDir);
  copyMissingFilesRecursively(path.join(scaffoldRoot, ".agents"), paths.workspaceAgentsDir);
  ensureTemplateFile(paths.architectureFile, path.join(scaffoldRoot, "ARCHITECTURE.md"));
  ensureWorkspaceAgentsFile(paths.workspaceAgentsFile, path.join(scaffoldRoot, "AGENTS.md"));
  ensureClaudePointerFile(paths.claudeFile);
  ensureCodeGraphGitignoreEntry(paths.workspaceRoot);
}

export function workspaceAgentsAppendMarker(): { start: string; end: string } {
  return {
    start: APPENDED_AGENTS_MARKER_START,
    end: APPENDED_AGENTS_MARKER_END,
  };
}
