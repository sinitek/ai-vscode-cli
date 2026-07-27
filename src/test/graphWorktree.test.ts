import test = require("node:test");
import assert = require("node:assert/strict");
import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  cleanupGraphRunWorktree,
  commitGraphNodeCheckpoint,
  createGraphRunExecutionSetup,
  createGraphRunWorktree,
  getGraphWorktreeHeadCommit,
  mergeGraphRunWorktreeToWorkspace,
  resetGraphWorktreeToCommit,
} from "../graph/graphWorktree";

function git(cwd: string, args: string[]): string {
  return childProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createGitRepo(root: string): string {
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(repo, "README.md"), "base\n", "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("creates a Graph worktree and records per-node checkpoint commits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-worktree-"));
  try {
    const repo = createGitRepo(root);
    const baseDir = path.join(root, "data");
    const worktree = createGraphRunWorktree(repo, "graph_run_1", { baseDir, now: () => 1_000 });
    const baseCommit = getGraphWorktreeHeadCommit(worktree.cwd);

    assert.notEqual(worktree.cwd, repo);
    assert.equal(worktree.baseCommit, baseCommit);
    assert.equal(worktree.createdAt, 1_000);

    fs.writeFileSync(path.join(worktree.cwd, "employee.html"), "<main></main>\n", "utf8");
    const checkpoint = commitGraphNodeCheckpoint({
      worktreeCwd: worktree.cwd,
      graphRunId: "graph_run_1",
      nodeId: "implement",
      status: "passed",
      baseCommit,
      summary: "Created prototype.",
    });

    assert.equal(checkpoint.baseCommit, baseCommit);
    assert.notEqual(checkpoint.commit, baseCommit);
    assert.equal(getGraphWorktreeHeadCommit(worktree.cwd), checkpoint.commit);

    resetGraphWorktreeToCommit(worktree.cwd, baseCommit);
    assert.equal(getGraphWorktreeHeadCommit(worktree.cwd), baseCommit);
    assert.equal(fs.existsSync(path.join(worktree.cwd, "employee.html")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("falls back to direct workspace execution when git worktree setup is unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-direct-fallback-"));
  try {
    const workspace = path.join(root, "not-a-git-repo");
    fs.mkdirSync(workspace, { recursive: true });

    const setup = createGraphRunExecutionSetup(workspace, "graph_run_direct", {
      baseDir: path.join(root, "data"),
      now: () => 3_000,
    });

    assert.equal(setup.executionMode, "direct");
    assert.equal(setup.directExecution.cwd, workspace);
    assert.equal(setup.directExecution.createdAt, 3_000);
    assert.match(setup.fallbackReason, /git rev-parse --show-toplevel failed/u);
    assert.equal(fs.existsSync(path.join(root, "data", "graph-worktrees")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleans up a completed Graph worktree directory, registration, and branch after merge-back", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-cleanup-"));
  try {
    const repo = createGitRepo(root);
    const baseDir = path.join(root, "data");
    const worktree = createGraphRunWorktree(repo, "graph_run_cleanup", { baseDir });
    const baseCommit = getGraphWorktreeHeadCommit(worktree.cwd);
    fs.writeFileSync(path.join(worktree.cwd, "employee.html"), "<main></main>\n", "utf8");
    commitGraphNodeCheckpoint({
      worktreeCwd: worktree.cwd,
      graphRunId: "graph_run_cleanup",
      nodeId: "implement",
      status: "passed",
      baseCommit,
    });
    mergeGraphRunWorktreeToWorkspace({ workspaceCwd: repo, worktree });

    const cleanup = cleanupGraphRunWorktree({ workspaceCwd: repo, worktree });

    assert.equal(cleanup.worktreeRemoved, true);
    assert.equal(cleanup.worktreePruned, true);
    assert.equal(cleanup.branchDeleted, true);
    assert.equal(cleanup.directoryExistsAfter, false);
    assert.equal(cleanup.worktreeRootRemoved, true);
    assert.equal(cleanup.worktreeRootExistsAfter, false);
    assert.equal(fs.existsSync(worktree.cwd), false);
    assert.equal(fs.existsSync(path.join(baseDir, "graph-worktrees")), false);
    assert.doesNotMatch(git(repo, ["worktree", "list", "--porcelain"]), new RegExp(escapeRegExp(worktree.cwd), "u"));
    assert.equal(git(repo, ["branch", "--list", worktree.branch]), "");
    assert.match(git(repo, ["status", "--porcelain"]), /A  employee\.html/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("keeps the Graph worktree root when another run worktree still exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-cleanup-shared-root-"));
  try {
    const repo = createGitRepo(root);
    const baseDir = path.join(root, "data");
    const first = createGraphRunWorktree(repo, "graph_run_first", { baseDir });
    const second = createGraphRunWorktree(repo, "graph_run_second", { baseDir });

    const cleanup = cleanupGraphRunWorktree({ workspaceCwd: repo, worktree: first });

    assert.equal(cleanup.worktreeRootRemoved, false);
    assert.equal(cleanup.worktreeRootExistsAfter, true);
    assert.equal(fs.existsSync(first.cwd), false);
    assert.equal(fs.existsSync(second.cwd), true);
    assert.match(git(repo, ["worktree", "list", "--porcelain"]), new RegExp(escapeRegExp(second.cwd), "u"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("merges a completed Graph worktree back into the workspace without committing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-merge-back-"));
  try {
    const repo = createGitRepo(root);
    const baseDir = path.join(root, "data");
    const worktree = createGraphRunWorktree(repo, "graph_run_merge", { baseDir, now: () => 2_000 });
    const baseCommit = getGraphWorktreeHeadCommit(worktree.cwd);
    fs.writeFileSync(path.join(worktree.cwd, "employee.html"), "<main></main>\n", "utf8");
    const checkpoint = commitGraphNodeCheckpoint({
      worktreeCwd: worktree.cwd,
      graphRunId: "graph_run_merge",
      nodeId: "implement",
      status: "passed",
      baseCommit,
      summary: "Created prototype.",
    });

    const result = mergeGraphRunWorktreeToWorkspace({ workspaceCwd: repo, worktree });

    assert.equal(fs.realpathSync(result.repoRoot), fs.realpathSync(repo));
    assert.equal(result.worktreeCwd, worktree.cwd);
    assert.equal(result.sourceBranch, worktree.branch);
    assert.equal(result.sourceCommit, checkpoint.commit);
    assert.equal(result.targetHeadBefore, baseCommit);
    assert.equal(result.targetHeadAfter, baseCommit);
    assert.equal(fs.readFileSync(path.join(repo, "employee.html"), "utf8"), "<main></main>\n");
    assert.match(git(repo, ["status", "--porcelain"]), /A  employee\.html/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("merges a Graph worktree into a dirty workspace when changes do not overlap", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-merge-dirty-"));
  try {
    const repo = createGitRepo(root);
    const baseDir = path.join(root, "data");
    const worktree = createGraphRunWorktree(repo, "graph_run_dirty", { baseDir });
    const baseCommit = getGraphWorktreeHeadCommit(worktree.cwd);
    fs.writeFileSync(path.join(worktree.cwd, "employee.html"), "<main></main>\n", "utf8");
    commitGraphNodeCheckpoint({
      worktreeCwd: worktree.cwd,
      graphRunId: "graph_run_dirty",
      nodeId: "implement",
      status: "passed",
      baseCommit,
    });
    fs.writeFileSync(path.join(repo, "scratch.txt"), "dirty\n", "utf8");

    const result = mergeGraphRunWorktreeToWorkspace({ workspaceCwd: repo, worktree });

    assert.equal(result.statusBefore, "?? scratch.txt");
    assert.equal(fs.readFileSync(path.join(repo, "scratch.txt"), "utf8"), "dirty\n");
    assert.equal(fs.readFileSync(path.join(repo, "employee.html"), "utf8"), "<main></main>\n");
    const status = git(repo, ["status", "--porcelain"]);
    assert.match(status, /A  employee\.html/u);
    assert.match(status, /\?\? scratch\.txt/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fails to merge a Graph worktree when target changes overlap", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-merge-conflict-"));
  try {
    const repo = createGitRepo(root);
    const baseDir = path.join(root, "data");
    const worktree = createGraphRunWorktree(repo, "graph_run_conflict", { baseDir });
    const baseCommit = getGraphWorktreeHeadCommit(worktree.cwd);
    fs.writeFileSync(path.join(worktree.cwd, "README.md"), "graph\n", "utf8");
    commitGraphNodeCheckpoint({
      worktreeCwd: worktree.cwd,
      graphRunId: "graph_run_conflict",
      nodeId: "implement",
      status: "passed",
      baseCommit,
    });
    fs.writeFileSync(path.join(repo, "README.md"), "local\n", "utf8");

    assert.throws(
      () => mergeGraphRunWorktreeToWorkspace({ workspaceCwd: repo, worktree }),
      /git merge --squash .* failed/u,
    );
    assert.equal(fs.readFileSync(path.join(repo, "README.md"), "utf8"), "local\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
