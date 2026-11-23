import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { isSameVolumePath, LOOP_SUBTASK_EXECUTION_ROOT_PREFIX, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME } from "./loopSubtaskExecutionRoot";
import { resolveGrokHomeDir } from "./shared/userHomePaths";

export function isLegacyGrokLoopCwd(
  cwd: string, base: string, platform: NodeJS.Platform = process.platform,
): boolean {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (!paths.isAbsolute(cwd) || paths.normalize(cwd) !== cwd) return false;
  const parent = paths.dirname(cwd);
  const sameParent = platform === "win32" ? parent.toLowerCase() === base.toLowerCase() : parent === base;
  const name = paths.basename(cwd);
  return sameParent && name.startsWith(LOOP_SUBTASK_EXECUTION_ROOT_PREFIX)
    && /^[a-zA-Z0-9]{6}$/.test(name.slice(LOOP_SUBTASK_EXECUTION_ROOT_PREFIX.length));
}

export async function findLegacyGrokLoopCwd(workspaceCwd: string, sessionId: string, options: {
  grokHome?: string;
  tempDir?: string;
} = {}): Promise<string | null> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) return null;
  const tempDir = path.resolve(options.tempDir ?? os.tmpdir());
  const localTemp = process.platform === "win32" && !isSameVolumePath(workspaceCwd, tempDir);
  const base = localTemp ? path.join(path.resolve(workspaceCwd), LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME) : tempDir;
  const sessions = path.join(options.grokHome ?? resolveGrokHomeDir(), "sessions");
  try {
    const parent = await fs.lstat(base).catch((error: NodeJS.ErrnoException) => {
      if (localTemp && error.code === "ENOENT") return null;
      throw error;
    });
    if (localTemp && parent && !parent.isDirectory()) return null;
    const physicalBase = parent ? await fs.realpath(base) : base;
    if (!(await fs.lstat(sessions)).isDirectory()) return null;
    const groups = await fs.readdir(sessions, { withFileTypes: true });
    let found: string | null = null;
    for (const group of groups) {
      if (!group.isDirectory()) continue;
      const groupPath = path.join(sessions, group.name);
      let cwd = decodeURIComponentSafe(group.name);
      if (!cwd || !path.isAbsolute(cwd)) cwd = await readSmallFile(path.join(groupPath, ".cwd"), 16_384);
      if (!cwd || !(isLegacyGrokLoopCwd(cwd, base) || isLegacyGrokLoopCwd(cwd, physicalBase))) continue;
      const sessionPath = path.join(groupPath, sessionId);
      if (!(await fs.lstat(sessionPath).catch(() => null))?.isDirectory()) continue;
      const summary = await readSmallFile(path.join(sessionPath, "summary.json"), 1_048_576);
      const updates = await fs.lstat(path.join(sessionPath, "updates.jsonl")).catch(() => null);
      if (!summary || !updates?.isFile()) continue;
      const info = (JSON.parse(summary) as { info?: { id?: unknown; cwd?: unknown } } | null)?.info;
      if (info?.id !== sessionId || info.cwd !== cwd) continue;
      if (found !== null) return null;
      found = cwd;
    }
    if (!found) return null;
    const root = await fs.lstat(found).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return !root || (root.isDirectory() && (await fs.readdir(found)).length === 0) ? found : null;
  } catch {
    return null;
  }
}

function decodeURIComponentSafe(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

async function readSmallFile(file: string, limit: number): Promise<string | null> {
  const stat = await fs.lstat(file).catch(() => null);
  return stat?.isFile() && stat.size <= limit ? await fs.readFile(file, "utf8") : null;
}
