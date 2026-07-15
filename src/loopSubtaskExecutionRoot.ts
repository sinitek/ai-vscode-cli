import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const EXECUTION_ROOT_PREFIX = "sinitek-loop-subtask-";
const HIDDEN_ROOT_ENTRIES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".agents",
  ".claude",
  ".codex",
]);

export type LoopSubtaskExecutionRoot = {
  cwd: string;
  dispose: () => void;
};

/**
 * Presents the workspace through a temporary root that omits repository rules
 * and skill directories while preserving writes through top-level symlinks.
 */
export function createLoopSubtaskExecutionRoot(workspaceCwd: string): LoopSubtaskExecutionRoot {
  const workspaceRoot = path.resolve(workspaceCwd);
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), EXECUTION_ROOT_PREFIX));

  try {
    for (const entry of entries) {
      if (HIDDEN_ROOT_ENTRIES.has(entry.name)) {
        continue;
      }
      const sourcePath = path.join(workspaceRoot, entry.name);
      const targetPath = path.join(cwd, entry.name);
      const linkType = process.platform === "win32" && entry.isDirectory()
        ? "junction"
        : entry.isDirectory()
          ? "dir"
          : "file";
      fs.symlinkSync(sourcePath, targetPath, linkType);
    }
  } catch (error) {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 2 });
    throw error;
  }

  return {
    cwd,
    dispose: () => {
      fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 2 });
    },
  };
}
