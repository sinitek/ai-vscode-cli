import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { removeEmptyDirBestEffort, removePathBestEffort } from "./shared/fsCleanup";

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

/**
 * Presents the workspace through a temporary root that omits repository rules
 * and skill directories while preserving writes through top-level links.
 */
export function createLoopSubtaskExecutionRoot(workspaceCwd: string): LoopSubtaskExecutionRoot {
  const workspaceRoot = path.resolve(workspaceCwd);
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  const { cwd, localTempRoot } = createExecutionRootDir(workspaceRoot);

  try {
    for (const entry of entries) {
      if (HIDDEN_ROOT_ENTRIES.has(entry.name)) {
        continue;
      }
      const sourcePath = path.join(workspaceRoot, entry.name);
      const targetPath = path.join(cwd, entry.name);
      try {
        linkWorkspaceEntry(sourcePath, targetPath, entry);
      } catch (error) {
        throw createLinkFailedError(entry.name, error);
      }
    }
  } catch (error) {
    disposeExecutionRoot(cwd, localTempRoot);
    throw error;
  }

  return {
    cwd,
    dispose: () => {
      disposeExecutionRoot(cwd, localTempRoot);
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

function disposeExecutionRoot(cwd: string, localTempRoot: string | null): void {
  removePathBestEffort(cwd);
  if (localTempRoot) {
    removeEmptyDirBestEffort(localTempRoot);
  }
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

function linkWorkspaceEntry(sourcePath: string, targetPath: string, entry: fs.Dirent): void {
  if (isDirectoryEntry(sourcePath, entry)) {
    fs.symlinkSync(sourcePath, targetPath, process.platform === "win32" ? "junction" : "dir");
    return;
  }
  if (process.platform !== "win32") {
    fs.symlinkSync(sourcePath, targetPath, "file");
    return;
  }
  try {
    fs.linkSync(sourcePath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EPERM" && code !== "EACCES") {
      throw error;
    }
    fs.symlinkSync(sourcePath, targetPath, "file");
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
