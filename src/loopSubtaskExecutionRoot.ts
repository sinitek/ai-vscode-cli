import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { logError, logInfo } from "./logger";
import { removeEmptyDirBestEffort } from "./shared/fsCleanup";

export const LOOP_SUBTASK_EXECUTION_ROOT_PREFIX = "sinitek-loop-subtask-";
export const LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME = ".sinitek-loop-tmp";
export const LOOP_SUBTASK_LINK_FAILED_CODE = "LOOP_SUBTASK_LINK_FAILED";

export function isGrokLoopExecutionRootId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function resolveGrokLoopExecutionCwd(workspaceCwd: string, rootId: string, dataDir: string, legacyCwd?: string): string {
  if (!isGrokLoopExecutionRootId(rootId)) throw new Error("Grok 子任务执行目录标识无效。");
  if (legacyCwd !== undefined) {
    if (path.resolve(legacyCwd) !== legacyCwd || !isLegacyGrokLoopExecutionCwd(workspaceCwd, legacyCwd)) {
      throw new Error("旧版 Grok 子任务执行目录不在受支持的临时根中。");
    }
    return legacyCwd;
  }
  const base = process.platform === "win32" && !isSameVolumePath(workspaceCwd, dataDir)
    ? path.join(workspaceCwd, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME)
    : path.join(dataDir, "grok-loop-workspaces");
  return path.join(base, `grok-${rootId}`);
}

export function isLegacyGrokLoopExecutionCwd(workspaceCwd: string, cwd: string): boolean {
  const workspaceRoot = path.resolve(workspaceCwd);
  const osTmp = os.tmpdir();
  const base = process.platform === "win32" && !isSameVolumePath(osTmp, workspaceRoot)
    ? path.join(workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME)
    : osTmp;
  const candidate = path.resolve(cwd);
  return candidate === cwd && isLegacyGrokLoopCwd(candidate, base);
}

function isLegacyGrokLoopCwd(cwd: string, base: string): boolean {
  if (!path.isAbsolute(cwd) || path.normalize(cwd) !== cwd) return false;
  const parent = path.dirname(cwd);
  const sameParent = process.platform === "win32" ? parent.toLowerCase() === base.toLowerCase() : parent === base;
  const name = path.basename(cwd);
  return sameParent && name.startsWith(LOOP_SUBTASK_EXECUTION_ROOT_PREFIX)
    && /^[a-zA-Z0-9]{6}$/.test(name.slice(LOOP_SUBTASK_EXECUTION_ROOT_PREFIX.length));
}

const HIDDEN_ROOT_ENTRIES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".agents",
  ".claude",
  ".codex",
  LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME,
]);

export type LoopSubtaskCleanupResult =
  | { ok: true; retainedDirectory: boolean }
  | { ok: false; reason: string };

export type LoopSubtaskExecutionRoot = {
  cwd: string;
  dispose: () => LoopSubtaskCleanupResult;
  /** Recheck the original physical directory before using a retained capability. */
  assertCurrent: () => void;
};

export type LoopSubtaskLinkFailedError = Error & {
  code: typeof LOOP_SUBTASK_LINK_FAILED_CODE;
  entryName: string;
  cleanupResult?: LoopSubtaskCleanupResult;
};

type LoopSubtaskLinkedEntry = {
  sourcePath: string;
  targetPath: string;
  kind: "junction" | "symlink" | "hardlink";
  identity: fs.BigIntStats;
};

/**
 * Presents the workspace through a temporary root that omits repository rules
 * and skill directories while preserving writes through top-level links.
 */
export function createLoopSubtaskExecutionRoot(
  workspaceCwd: string,
  options: { persistentCwd?: string } = {},
): LoopSubtaskExecutionRoot {
  const workspaceRoot = path.resolve(workspaceCwd);
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  const { cwd, localTempRoot } = createExecutionRootDir(workspaceRoot, options.persistentCwd);
  const linkedEntries: LoopSubtaskLinkedEntry[] = [];
  const rootIdentity = fs.lstatSync(cwd, { bigint: true });

  try {
    for (const entry of entries) {
      if (HIDDEN_ROOT_ENTRIES.has(entry.name)) {
        continue;
      }
      const sourcePath = path.join(workspaceRoot, entry.name);
      const targetPath = path.join(cwd, entry.name);
      try {
        const kind = linkWorkspaceEntry(sourcePath, targetPath, entry);
        const identity = fs.lstatSync(targetPath, { bigint: true });
        linkedEntries.push({ sourcePath, targetPath, kind, identity });
      } catch (error) {
        throw createLinkFailedError(entry.name, error);
      }
    }
  } catch (error) {
    const cleanupResult = disposeExecutionRoot(cwd, localTempRoot, rootIdentity, linkedEntries, Boolean(options.persistentCwd));
    (error as LoopSubtaskLinkFailedError).cleanupResult = cleanupResult;
    throw error;
  }

  return {
    cwd,
    assertCurrent: () => {
      assertExecutionRootIdentity(cwd, rootIdentity);
      for (const entry of linkedEntries) {
        const current = fs.lstatSync(entry.targetPath, { bigint: true });
        if (!isSameIdentity(entry.identity, current)) throw new Error("隔离执行根链接身份已改变");
      }
    },
    dispose: () => disposeExecutionRoot(cwd, localTempRoot, rootIdentity, linkedEntries, Boolean(options.persistentCwd)),
  };
}

export function isLoopSubtaskLinkFailedError(error: unknown): error is LoopSubtaskLinkFailedError {
  return Boolean(
    error
    && typeof error === "object"
    && (error as { code?: string }).code === LOOP_SUBTASK_LINK_FAILED_CODE,
  );
}

function createExecutionRootDir(workspaceRoot: string, persistentCwd?: string): {
  cwd: string;
  localTempRoot: string | null;
} {
  if (persistentCwd) {
    const cwd = path.resolve(persistentCwd);
    fs.mkdirSync(cwd, { recursive: true });
    const stat = fs.lstatSync(cwd);
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.readdirSync(cwd).length > 0) {
      throw new Error("隔离执行目录不是空的真实目录，已保留现场并停止恢复。");
    }
    return { cwd, localTempRoot: null };
  }
  const osTmp = os.tmpdir();
  if (process.platform !== "win32" || isSameVolumePath(osTmp, workspaceRoot)) {
    return {
      cwd: fs.mkdtempSync(path.join(osTmp, LOOP_SUBTASK_EXECUTION_ROOT_PREFIX)),
      localTempRoot: null,
    };
  }
  const localTempRoot = path.join(workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME);
  fs.mkdirSync(localTempRoot, { recursive: true });
  return {
    cwd: fs.mkdtempSync(path.join(localTempRoot, LOOP_SUBTASK_EXECUTION_ROOT_PREFIX)),
    localTempRoot,
  };
}

function disposeExecutionRoot(
  cwd: string,
  localTempRoot: string | null,
  rootIdentity: fs.BigIntStats,
  linkedEntries: LoopSubtaskLinkedEntry[],
  preserveDirectory = false,
): LoopSubtaskCleanupResult {
  const failure = (error: unknown): LoopSubtaskCleanupResult => ({ ok: false, reason: error instanceof Error ? error.message : String(error) });
  try {
    assertExecutionRootIdentity(cwd, rootIdentity);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logCleanupFailure(cwd, cwd, error);
      return failure(error);
    }
    return { ok: true, retainedDirectory: false };
  }

  const remainingEntries = linkedEntries.filter((entry) => {
    try {
      assertExecutionRootIdentity(cwd, rootIdentity);
      removeLinkedEntry(entry);
      return false;
    } catch (error) {
      logCleanupFailure(cwd, entry.targetPath, error);
      return true;
    }
  });
  linkedEntries.splice(0, linkedEntries.length, ...remainingEntries);

  if (linkedEntries.length > 0) {
    return failure(new Error(`隔离执行目录仍有 ${linkedEntries.length} 个链接未清理，已保留现场`));
  }
  try {
    assertExecutionRootIdentity(cwd, rootIdentity);
    if (preserveDirectory) {
      if (fs.readdirSync(cwd).length > 0) {
        throw new Error("隔离执行目录包含未知内容，已保留现场并跳过清理");
      }
      return { ok: true, retainedDirectory: true };
    }
    fs.rmdirSync(cwd);
    if (localTempRoot) {
      removeEmptyDirBestEffort(localTempRoot);
    }
    void logInfo("loop-subtask-execution-root-cleaned", { cwd }).catch(() => undefined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logCleanupFailure(cwd, cwd, error);
      return failure(error);
    }
  }
  return { ok: true, retainedDirectory: false };
}

function assertExecutionRootIdentity(cwd: string, identity: fs.BigIntStats): void {
  const current = fs.lstatSync(cwd, { bigint: true });
  if (current.isSymbolicLink() || !current.isDirectory() || !isSameIdentity(identity, current)) {
    throw new Error("临时执行根身份已改变，保留目录并跳过清理");
  }
}

function removeLinkedEntry(entry: LoopSubtaskLinkedEntry): void {
  let targetStats: fs.BigIntStats;
  try {
    targetStats = fs.lstatSync(entry.targetPath, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!isSameIdentity(entry.identity, targetStats)) {
    throw new Error("链接项身份已改变，保留该项并跳过清理");
  }

  if (entry.kind === "hardlink") {
    const sourceStats = fs.statSync(entry.sourcePath, { bigint: true });
    if (!targetStats.isFile() || !sourceStats.isFile() || !isSameIdentity(sourceStats, targetStats)) {
      throw new Error("硬链接与源文件身份不一致，保留该项并跳过清理");
    }
  } else if (!targetStats.isSymbolicLink()) {
    throw new Error("链接项已不再是符号链接，保留该项并跳过清理");
  }

  if (entry.kind === "junction") {
    fs.rmdirSync(entry.targetPath);
  } else {
    fs.unlinkSync(entry.targetPath);
  }
}

function isSameIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.ino !== 0n
    && left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs;
}

function logCleanupFailure(cwd: string, targetPath: string, error: unknown): void {
  void logError("loop-subtask-execution-root-cleanup-skipped", {
    cwd,
    targetPath,
    errorCode: (error as NodeJS.ErrnoException).code,
    error: error instanceof Error ? error.message : String(error),
  }).catch(() => undefined);
}

export function isSameVolumePath(left: string, right: string): boolean {
  return path.parse(path.resolve(left)).root.toLowerCase()
    === path.parse(path.resolve(right)).root.toLowerCase();
}

function isDirectoryEntry(sourcePath: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) {
    return true;
  }
  try {
    return fs.statSync(sourcePath).isDirectory();
  } catch {
    return false;
  }
}

function linkWorkspaceEntry(
  sourcePath: string,
  targetPath: string,
  entry: fs.Dirent,
): LoopSubtaskLinkedEntry["kind"] {
  if (isDirectoryEntry(sourcePath, entry)) {
    fs.symlinkSync(sourcePath, targetPath, process.platform === "win32" ? "junction" : "dir");
    return process.platform === "win32" ? "junction" : "symlink";
  }
  if (process.platform !== "win32") {
    fs.symlinkSync(sourcePath, targetPath, "file");
    return "symlink";
  }
  try {
    fs.linkSync(sourcePath, targetPath);
    return "hardlink";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EPERM" && code !== "EACCES") {
      throw error;
    }
    fs.symlinkSync(sourcePath, targetPath, "file");
    return "symlink";
  }
}

function createLinkFailedError(entryName: string, cause: unknown): LoopSubtaskLinkFailedError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `Failed to link "${entryName}" into the Loop subtask execution root: ${detail}`,
  ) as LoopSubtaskLinkFailedError;
  error.code = LOOP_SUBTASK_LINK_FAILED_CODE;
  error.entryName = entryName;
  return error;
}
