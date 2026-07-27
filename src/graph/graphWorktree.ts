import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";

import {
  getGraphDataDir,
  sanitizeGraphPathSegment,
  type GraphRunDirectExecutionRecord,
  type GraphRunWorktreeRecord,
} from "./types";

const GRAPH_WORKTREE_DIR_NAME = "graph-worktrees";
const GRAPH_GIT_AUTHOR_NAME = "Sinitek Graph";
const GRAPH_GIT_AUTHOR_EMAIL = "sinitek-graph@local";

export type CreateGraphRunWorktreeOptions = {
  baseDir?: string;
  now?: () => number;
};

export type GraphNodeCheckpointInput = {
  worktreeCwd: string;
  graphRunId: string;
  nodeId: string;
  status: string;
  baseCommit: string;
  summary?: string;
};

export type GraphNodeCheckpointResult = {
  commit: string;
  baseCommit: string;
  worktreeCwd: string;
};

export type GraphWorktreeResetResult = {
  headCommit: string;
  resetTo: string;
  worktreeCwd: string;
};

export type GraphWorktreeMergeBackInput = {
  workspaceCwd: string;
  worktree: Pick<GraphRunWorktreeRecord, "cwd" | "branch" | "baseCommit">;
};

export type GraphWorktreeMergeBackResult = {
  workspaceCwd: string;
  repoRoot: string;
  worktreeCwd: string;
  sourceBranch: string;
  sourceCommit: string;
  targetHeadBefore: string;
  targetHeadAfter: string;
  statusBefore: string;
  statusAfter: string;
  mergeOutput: string;
};

export type GraphWorktreeCleanupInput = {
  workspaceCwd: string;
  worktree: Pick<GraphRunWorktreeRecord, "cwd" | "branch">;
};

export type GraphWorktreeCleanupResult = {
  workspaceCwd: string;
  repoRoot: string;
  worktreeCwd: string;
  worktreeRoot: string;
  sourceBranch: string;
  worktreePathExisted: boolean;
  worktreeRemoved: boolean;
  worktreePruned: boolean;
  branchExisted: boolean;
  branchDeleted: boolean;
  directoryExistsAfter: boolean;
  worktreeRootRemoved: boolean;
  worktreeRootExistsAfter: boolean;
};

export type GraphRunExecutionSetup = {
  executionMode: "worktree";
  worktree: GraphRunWorktreeRecord;
  directExecution?: undefined;
  fallbackReason?: undefined;
} | {
  executionMode: "direct";
  worktree?: undefined;
  directExecution: GraphRunDirectExecutionRecord;
  fallbackReason: string;
};

export function createGraphRunExecutionSetup(
  workspaceCwd: string,
  graphRunId: string,
  options: CreateGraphRunWorktreeOptions = {},
): GraphRunExecutionSetup {
  try {
    return {
      executionMode: "worktree",
      worktree: createGraphRunWorktree(workspaceCwd, graphRunId, options),
    };
  } catch (error) {
    const fallbackReason = errorToMessage(error);
    return {
      executionMode: "direct",
      directExecution: {
        cwd: workspaceCwd,
        reason: fallbackReason,
        createdAt: options.now?.() ?? Date.now(),
      },
      fallbackReason,
    };
  }
}

export function createGraphRunWorktree(
  workspaceCwd: string,
  graphRunId: string,
  options: CreateGraphRunWorktreeOptions = {},
): GraphRunWorktreeRecord {
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], workspaceCwd);
  const baseCommit = runGit(["rev-parse", "HEAD"], repoRoot);
  const safeRunId = sanitizeGraphPathSegment(graphRunId, "graph-run");
  const worktreeRoot = path.join(getGraphDataDir(options.baseDir), GRAPH_WORKTREE_DIR_NAME);
  const cwd = path.join(worktreeRoot, safeRunId);
  const branch = `sinitek-graph-${safeRunId}`;

  fs.mkdirSync(worktreeRoot, { recursive: true });
  if (!fs.existsSync(cwd)) {
    try {
      runGit(["worktree", "add", "-b", branch, cwd, baseCommit], repoRoot);
    } catch (error) {
      if (fs.existsSync(cwd)) {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
      removeEmptyGraphWorktreeRoot(worktreeRoot);
      throw error;
    }
  }

  return {
    cwd,
    branch,
    baseCommit,
    createdAt: options.now?.() ?? Date.now(),
  };
}

export function getGraphWorktreeHeadCommit(worktreeCwd: string): string {
  return runGit(["rev-parse", "HEAD"], worktreeCwd);
}

export function commitGraphNodeCheckpoint(input: GraphNodeCheckpointInput): GraphNodeCheckpointResult {
  runGit(["add", "-A"], input.worktreeCwd);
  const title = `graph(${input.graphRunId}): ${input.nodeId} ${input.status} checkpoint`;
  const body = [
    `Graph run: ${input.graphRunId}`,
    `Graph node: ${input.nodeId}`,
    `Node status: ${input.status}`,
    `Base commit: ${input.baseCommit}`,
    input.summary ? `Summary: ${input.summary}` : null,
  ].filter((line): line is string => Boolean(line));
  runGit([
    "-c",
    `user.name=${GRAPH_GIT_AUTHOR_NAME}`,
    "-c",
    `user.email=${GRAPH_GIT_AUTHOR_EMAIL}`,
    "commit",
    "--allow-empty",
    "-m",
    title,
    "-m",
    body.join("\n"),
  ], input.worktreeCwd);
  return {
    commit: getGraphWorktreeHeadCommit(input.worktreeCwd),
    baseCommit: input.baseCommit,
    worktreeCwd: input.worktreeCwd,
  };
}

export function resetGraphWorktreeToCommit(
  worktreeCwd: string,
  commit: string,
): GraphWorktreeResetResult {
  runGit(["reset", "--hard", commit], worktreeCwd);
  runGit(["clean", "-fd"], worktreeCwd);
  return {
    headCommit: getGraphWorktreeHeadCommit(worktreeCwd),
    resetTo: commit,
    worktreeCwd,
  };
}

export function mergeGraphRunWorktreeToWorkspace(input: GraphWorktreeMergeBackInput): GraphWorktreeMergeBackResult {
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], input.workspaceCwd);
  if (!fs.existsSync(input.worktree.cwd)) {
    throw new Error(`Graph worktree does not exist: ${input.worktree.cwd}`);
  }
  const statusBefore = runGit(["status", "--porcelain"], repoRoot);
  const sourceCommit = getGraphWorktreeHeadCommit(input.worktree.cwd);
  const targetHeadBefore = getGraphWorktreeHeadCommit(repoRoot);
  // Let Git decide whether the Graph diff can be safely applied. A dirty
  // workspace with unrelated files should still receive the completed graph.
  const mergeOutput = runGit(["merge", "--squash", sourceCommit], repoRoot);
  const targetHeadAfter = getGraphWorktreeHeadCommit(repoRoot);
  const statusAfter = runGit(["status", "--porcelain"], repoRoot);
  return {
    workspaceCwd: input.workspaceCwd,
    repoRoot,
    worktreeCwd: input.worktree.cwd,
    sourceBranch: input.worktree.branch,
    sourceCommit,
    targetHeadBefore,
    targetHeadAfter,
    statusBefore,
    statusAfter,
    mergeOutput,
  };
}

export function cleanupGraphRunWorktree(input: GraphWorktreeCleanupInput): GraphWorktreeCleanupResult {
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], input.workspaceCwd);
  const worktreePathExisted = fs.existsSync(input.worktree.cwd);
  let worktreeRemoved = false;
  if (worktreePathExisted) {
    runGit(["worktree", "remove", "--force", input.worktree.cwd], repoRoot);
    worktreeRemoved = true;
  }
  runGit(["worktree", "prune"], repoRoot);
  const branchExisted = gitBranchExists(repoRoot, input.worktree.branch);
  let branchDeleted = false;
  if (branchExisted) {
    runGit(["branch", "-D", input.worktree.branch], repoRoot);
    branchDeleted = true;
  }
  if (fs.existsSync(input.worktree.cwd)) {
    fs.rmSync(input.worktree.cwd, { recursive: true, force: true });
  }
  const directoryExistsAfter = fs.existsSync(input.worktree.cwd);
  if (directoryExistsAfter) {
    throw new Error(`Graph worktree cleanup left a residual directory: ${input.worktree.cwd}`);
  }
  const worktreeRoot = path.dirname(input.worktree.cwd);
  const worktreeRootRemoved = removeEmptyGraphWorktreeRoot(worktreeRoot);
  const worktreeRootExistsAfter = fs.existsSync(worktreeRoot);
  return {
    workspaceCwd: input.workspaceCwd,
    repoRoot,
    worktreeCwd: input.worktree.cwd,
    worktreeRoot,
    sourceBranch: input.worktree.branch,
    worktreePathExisted,
    worktreeRemoved,
    worktreePruned: true,
    branchExisted,
    branchDeleted,
    directoryExistsAfter,
    worktreeRootRemoved,
    worktreeRootExistsAfter,
  };
}

function removeEmptyGraphWorktreeRoot(worktreeRoot: string): boolean {
  if (path.basename(worktreeRoot) !== GRAPH_WORKTREE_DIR_NAME) {
    return false;
  }
  try {
    fs.rmdirSync(worktreeRoot);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function gitBranchExists(repoRoot: string, branch: string): boolean {
  try {
    childProcess.execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function runGit(args: readonly string[], cwd: string): string {
  try {
    return childProcess.execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${errorToMessage(error)}`);
  }
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    const maybeProcessError = error as Error & { stdout?: unknown; stderr?: unknown };
    const stdout = typeof maybeProcessError.stdout === "string"
      ? maybeProcessError.stdout.trim()
      : "";
    const output = typeof maybeProcessError.stderr === "string"
      ? maybeProcessError.stderr.trim()
      : "";
    return [output, stdout].filter(Boolean).join("\n") || error.message || String(error);
  }
  return String(error);
}
