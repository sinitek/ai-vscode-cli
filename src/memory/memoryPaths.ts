import * as path from "path";

export type WorkspaceMemoryPaths = {
  workspaceRoot: string;
  projectChDir: string;
  docsDir: string;
  memoryDir: string;
  generatedDir: string;
  runbooksDir: string;
  pitfallsFile: string;
  workspaceAgentsDir: string;
  workspaceAgentsFile: string;
  architectureFile: string;
  claudeFile: string;
};

export function resolveWorkspaceMemoryPaths(workspaceRoot?: string | null): WorkspaceMemoryPaths | null {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    return null;
  }
  const normalizedRoot = path.resolve(workspaceRoot.trim());
  const projectChDir = path.join(normalizedRoot, ".ch");
  const docsDir = path.join(projectChDir, "docs");
  const memoryDir = path.join(docsDir, "memory");
  const generatedDir = path.join(docsDir, "generated", "memory-index");
  const runbooksDir = path.join(docsDir, "runbooks");
  return {
    workspaceRoot: normalizedRoot,
    projectChDir,
    docsDir,
    memoryDir,
    generatedDir,
    runbooksDir,
    pitfallsFile: path.join(runbooksDir, "PITFALLS.md"),
    workspaceAgentsDir: path.join(normalizedRoot, ".agents"),
    workspaceAgentsFile: path.join(normalizedRoot, "AGENTS.md"),
    architectureFile: path.join(normalizedRoot, "ARCHITECTURE.md"),
    claudeFile: path.join(normalizedRoot, "CLAUDE.md"),
  };
}
