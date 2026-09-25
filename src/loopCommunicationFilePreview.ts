import * as fs from "fs";
import * as path from "path";
import { Marked, Renderer } from "marked";
import { getLoopCommunicationPaths, type LoopTaskRecord } from "./loopTaskStore";

const MAX_PREVIEW_BYTES = 1024 * 1024;
const COMMUNICATION_FILE_LINE = /^(\s*(?:-\s*)?)(.*沟通文件)(\s*[：:]\s*)(\S+)\s*$/u;

export type LoopCommunicationPreviewError =
  | "invalid"
  | "forbidden"
  | "missing"
  | "unreadable"
  | "empty"
  | "too_large";

export type LoopCommunicationFilePreview =
  | { ok: true; path: string; html: string }
  | { ok: false; path: string; error: LoopCommunicationPreviewError };

export function renderLoopGroupChatMessageText(body: string, linkTitle: string): string {
  return String(body ?? "").split(/\r?\n/u).map((line) => renderCommunicationFileLine(line, linkTitle)).join("\n");
}

export function isLoopCommunicationPreviewPath(value: string): boolean {
  const filePath = normalizeCommunicationFileToken(value);
  if (!filePath || /[\u0000\r\n]/u.test(filePath) || !/\.md$/iu.test(filePath)) {
    return false;
  }
  return filePath.startsWith("/")
    || filePath.startsWith("\\\\")
    || /^[A-Za-z]:[\\/]/u.test(filePath);
}

export function collectLoopCommunicationPreviewRoots(
  task: Pick<LoopTaskRecord, "id" | "communicationDir" | "mainCommunicationFile">,
): string[] {
  const roots = new Set<string>();
  const add = (value: string | null | undefined): void => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || !isTaskScopedCommunicationRoot(trimmed, task.id)) {
      return;
    }
    roots.add(path.resolve(trimmed));
  };
  add(task.communicationDir);
  add(path.dirname(task.mainCommunicationFile));
  add(getLoopCommunicationPaths(task.id).dir);
  return [...roots];
}

export function readLoopCommunicationFilePreview(
  requestedPath: unknown,
  allowedRoots: readonly string[],
): LoopCommunicationFilePreview {
  const displayPath = typeof requestedPath === "string" ? requestedPath.trim() : "";
  if (!isLoopCommunicationPreviewPath(displayPath)) {
    return { ok: false, path: displayPath, error: "invalid" };
  }
  const absolute = path.resolve(displayPath);
  const lexicalRoots = allowedRoots
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(root));
  const lexicalAllowed = lexicalRoots.some((root) => isPathInside(root, absolute));
  let realFile = "";
  try {
    const listed = fs.lstatSync(absolute);
    if (!listed.isFile() && !listed.isSymbolicLink()) {
      return { ok: false, path: absolute, error: "forbidden" };
    }
    realFile = fs.realpathSync(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const realRoots = resolveExistingRoots(lexicalRoots);
      const allowed = lexicalAllowed || realRoots.some((root) => isPathInside(root, absolute));
      return { ok: false, path: absolute, error: allowed ? "missing" : "forbidden" };
    }
    return { ok: false, path: absolute, error: "unreadable" };
  }

  const realRoots = resolveExistingRoots(lexicalRoots);
  if (!realRoots.some((root) => isPathInside(root, realFile))) {
    return { ok: false, path: absolute, error: "forbidden" };
  }
  try {
    const stat = fs.statSync(realFile);
    if (!stat.isFile()) {
      return { ok: false, path: absolute, error: "forbidden" };
    }
    if (stat.size > MAX_PREVIEW_BYTES) {
      return { ok: false, path: absolute, error: "too_large" };
    }
    if (stat.size === 0) {
      return { ok: false, path: absolute, error: "empty" };
    }
    const content = fs.readFileSync(realFile, "utf8");
    if (!content.trim()) {
      return { ok: false, path: absolute, error: "empty" };
    }
    return { ok: true, path: absolute, html: renderLoopCommunicationMarkdown(content) };
  } catch {
    return { ok: false, path: absolute, error: "unreadable" };
  }
}

export function renderLoopCommunicationMarkdown(markdown: string): string {
  const marked = new Marked();
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  const html = marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  });
  return typeof html === "string" ? html : "";
}

function renderCommunicationFileLine(line: string, linkTitle: string): string {
  const match = line.match(COMMUNICATION_FILE_LINE);
  if (!match) {
    return escapeHtml(line);
  }
  const filePath = normalizeCommunicationFileToken(match[4] ?? "");
  if (!isLoopCommunicationPreviewPath(filePath)) {
    return escapeHtml(line);
  }
  const prefix = match[1] ?? "";
  const label = match[2] ?? "";
  const separator = match[3] ?? "：";
  return `${escapeHtml(prefix)}${escapeHtml(label)}${escapeHtml(separator)}<button type="button" class="communication-file-link" data-action="openCommunicationFile" data-file-path="${escapeAttribute(filePath)}" title="${escapeAttribute(linkTitle)}">${escapeHtml(filePath)}</button>`;
}

function normalizeCommunicationFileToken(value: string): string {
  return value.trim().replace(/[),，。；;]+$/u, "");
}

function isTaskScopedCommunicationRoot(root: string, taskId: string): boolean {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return false;
  }
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) {
    return false;
  }
  return resolved.split(path.sep).includes(normalizedTaskId);
}

function resolveExistingRoots(roots: readonly string[]): string[] {
  return roots.map((root) => {
    try {
      return fs.realpathSync(root);
    } catch {
      return root;
    }
  });
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
