import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { logError, logInfo } from "./logger";
import { removeEmptyDirBestEffort } from "./shared/fsCleanup";

const EXECUTION_ROOT_PREFIX = "sinitek-loop-subtask-";
export const LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME = ".sinitek-loop-tmp";
export const LOOP_SUBTASK_LINK_FAILED_CODE = "LOOP_SUBTASK_LINK_FAILED";

const HIDDEN_ROOT_ENTRIES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".agents",
  ".claude",
  ".codex",
  LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME,
]);

export type LoopSubtaskExecutionRoot = {
  cwd: string;
  dispose: () => void;
};

export type LoopSubtaskLinkFailedError = Error & {
  code: typeof LOOP_SUBTASK_LINK_FAILED_CODE;
  entryName: string;
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
export function createLoopSubtaskExecutionRoot(workspaceCwd: string): LoopSubtaskExecutionRoot {
  const workspaceRoot = path.resolve(workspaceCwd);
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  const { cwd, localTempRoot } = createExecutionRootDir(workspaceRoot);
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
    disposeExecutionRoot(cwd, localTempRoot, rootIdentity, linkedEntries);
    throw error;
  }

  return {
    cwd,
    dispose: () => {
      disposeExecutionRoot(cwd, localTempRoot, rootIdentity, linkedEntries);
    },
  };
}

export function isLoopSubtaskLinkFailedError(error: unknown): error is LoopSubtaskLinkFailedError {
  return Boolean(
    error
    && typeof error === "object"
    && (error as { code?: string }).code === LOOP_SUBTASK_LINK_FAILED_CODE,
  );
}

function createExecutionRootDir(workspaceRoot: string): {
  cwd: string;
  localTempRoot: string | null;
} {
  const osTmp = os.tmpdir();
  if (process.platform !== "win32" || isSameVolumePath(osTmp, workspaceRoot)) {
    return {
      cwd: fs.mkdtempSync(path.join(osTmp, EXECUTION_ROOT_PREFIX)),
      localTempRoot: null,
    };
  }
  const localTempRoot = path.join(workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME);
  fs.mkdirSync(localTempRoot, { recursive: true });
  return {
    cwd: fs.mkdtempSync(path.join(localTempRoot, EXECUTION_ROOT_PREFIX)),
    localTempRoot,
  };
}

function disposeExecutionRoot(
  cwd: string,
  localTempRoot: string | null,
  rootIdentity: fs.BigIntStats,
  linkedEntries: LoopSubtaskLinkedEntry[],
): void {
  try {
    assertExecutionRootIdentity(cwd, rootIdentity);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logCleanupFailure(cwd, cwd, error);
    }
    return;
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
    return;
  }
  try {
    assertExecutionRootIdentity(cwd, rootIdentity);
    fs.rmdirSync(cwd);
    if (localTempRoot) {
      removeEmptyDirBestEffort(localTempRoot);
    }
    void logInfo("loop-subtask-execution-root-cleaned", { cwd }).catch(() => undefined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logCleanupFailure(cwd, cwd, error);
    }
  }
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

function isSameVolumePath(left: string, right: string): boolean {
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
