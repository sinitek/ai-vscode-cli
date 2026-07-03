import * as fs from "fs";
import * as path from "path";

export type WorkspaceMemoryPaths = {
  workspaceRoot: string;
  sinitekDir: string;
  memoryDir: string;
  generatedDir: string;
  projectChDir: string;
};

export function resolveWorkspaceMemoryPaths(workspaceRoot?: string | null): WorkspaceMemoryPaths | null {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    return null;
  }
  const normalizedRoot = path.resolve(workspaceRoot.trim());
  const sinitekDir = path.join(normalizedRoot, ".sinitek_cli");
  const memoryDir = path.join(sinitekDir, "memory");
  return {
    workspaceRoot: normalizedRoot,
    sinitekDir,
    memoryDir,
    generatedDir: path.join(memoryDir, "generated"),
    projectChDir: path.join(normalizedRoot, ".ch"),
  };
}

export function workspaceHasProjectChDirectory(
  input: string | WorkspaceMemoryPaths | null | undefined,
): boolean {
  const paths = typeof input === "string" ? resolveWorkspaceMemoryPaths(input) : input;
  if (!paths) {
    return false;
  }
  try {
    return fs.existsSync(paths.projectChDir) && fs.statSync(paths.projectChDir).isDirectory();
  } catch {
    return false;
  }
}
