import { createHash } from "crypto";
import * as os from "os";
import * as path from "path";

export type WorkspaceMemoryPaths = {
  workspaceRoot: string;
  runtimeDataDir: string;
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

export type ResolveWorkspaceMemoryPathsOptions = {
  runtimeDataDir?: string;
};

const SINITEK_RUNTIME_DIR_NAME = ".sinitek_cli";
const MEMORY_GENERATED_DIR_NAME = "memory-generated";
const MEMORY_INDEX_DIR_NAME = "memory-index";
const SAFE_WORKSPACE_SEGMENT_PATTERN = /[^a-zA-Z0-9_.-]/g;

function resolveRuntimeDataDir(options?: ResolveWorkspaceMemoryPathsOptions): string {
  const configured = options?.runtimeDataDir?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), SINITEK_RUNTIME_DIR_NAME);
}

function buildWorkspaceRuntimeSegment(workspaceRoot: string): string {
  const workspaceName = path.basename(workspaceRoot).replace(SAFE_WORKSPACE_SEGMENT_PATTERN, "_") || "workspace";
  const digest = createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 12);
  return `${workspaceName}-${digest}`;
}

export function resolveWorkspaceMemoryPaths(
  workspaceRoot?: string | null,
  options?: ResolveWorkspaceMemoryPathsOptions,
): WorkspaceMemoryPaths | null {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    return null;
  }
  const normalizedRoot = path.resolve(workspaceRoot.trim());
  const runtimeDataDir = resolveRuntimeDataDir(options);
  const projectChDir = path.join(normalizedRoot, ".ch");
  const docsDir = path.join(projectChDir, "docs");
  const memoryDir = path.join(docsDir, "memory");
  const generatedDir = path.join(
    runtimeDataDir,
    MEMORY_GENERATED_DIR_NAME,
    buildWorkspaceRuntimeSegment(normalizedRoot),
    MEMORY_INDEX_DIR_NAME,
  );
  const runbooksDir = path.join(docsDir, "runbooks");
  return {
    workspaceRoot: normalizedRoot,
    runtimeDataDir,
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
