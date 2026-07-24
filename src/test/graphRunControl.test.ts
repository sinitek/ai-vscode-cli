import test = require("node:test");
import assert = require("node:assert/strict");
import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { readGraphEvents } from "../graph/graphEvents";
import {
  approveGraphHumanGateForRun,
  feedbackGraphNodeForRun,
  findGraphPassedDescendantNodeIds,
  getGraphRunControlState,
  resumeGraphRunRecord,
  retryGraphNodeForRun,
  stopGraphRunRecord,
} from "../graph/graphRunControl";
import {
  commitGraphNodeCheckpoint,
  createGraphRunWorktree,
  getGraphWorktreeHeadCommit,
} from "../graph/graphWorktree";
import {
  GRAPH_SCHEMA_VERSION,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "../graph/types";

function createTempBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-run-control-"));
}

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

function createNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "node-1",
    title: "Graph node",
    kind: "implement",
    status: "pending",
    ownerRole: "subtask",
    maxAttempts: 1,
    attempts: 0,
    dependsOn: [],
    unlocks: [],
    ...overrides,
  };
}

function createRun(
  baseDir: string,
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[] = [],
  overrides: Partial<GraphRunRecord> = {},
): GraphRunRecord {
  return {
    id: "run-1",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Run control tests.",
    status: "needs-review",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: path.join(baseDir, "graph-runs.json"),
    nodes,
    edges,
    activeNodeIds: [],
    maxConcurrent: 6,
    eventsFile: path.join(baseDir, "events.jsonl"),
    communicationDir: path.join(baseDir, "graph"),
    mainCommunicationFile: path.join(baseDir, "graph", "main.md"),
    graphFile: path.join(baseDir, "graph", "graph.json"),
    ...overrides,
  };
}

function getNode(run: GraphRunRecord, nodeId: string): GraphNodeRecord {
  const node = run.nodes.find((item) => item.id === nodeId);
  assert.ok(node);
  return node;
}

test("resumes sleeping, needs-review, and error runs while rejecting completed and stopped runs", async () => {
  const baseDir = createTempBaseDir();
  try {
    const sleeping = createRun(baseDir, [createNode()], [], { status: "sleeping" });
    const resumed = await resumeGraphRunRecord(sleeping, {
      now: () => 1_000,
      source: "panel",
      reason: "User clicked continue.",
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.changed, true);
    assert.equal(resumed.run.status, "running");
    assert.equal(resumed.run.updatedAt, 1_000);
    assert.deepEqual(readGraphEvents(resumed.run.eventsFile).map((event) => event.type), ["run.resumed"]);

    for (const status of ["needs-review", "error"] as const) {
      const result = await resumeGraphRunRecord(createRun(baseDir, [createNode()], [], { status }));
      assert.equal(result.ok, true);
      assert.equal(result.run.status, "running");
    }

    const completed = await resumeGraphRunRecord(createRun(baseDir, [createNode()], [], { status: "completed" }));
    const stopped = await resumeGraphRunRecord(createRun(baseDir, [createNode()], [], { status: "stopped" }));
    assert.equal(completed.ok, false);
    assert.equal(completed.changed, false);
    assert.equal(completed.reason, "completed_run");
    assert.equal(stopped.ok, false);
    assert.equal(stopped.changed, false);
    assert.equal(stopped.reason, "already_stopped");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("retries failed and exhausted blocked nodes while preserving attempt history", async () => {
  const baseDir = createTempBaseDir();
  try {
    const failed = createNode({
      id: "failed",
      status: "failed",
      attempts: 1,
      maxAttempts: 2,
      startedAt: 500,
      completedAt: 900,
      lastError: "Try again.",
    });
    let run = createRun(baseDir, [failed], [], { activeNodeIds: ["failed"] });
    const retryFailed = await retryGraphNodeForRun(run, "failed", {
      now: () => 1_000,
      source: "panel",
      reason: "Manual retry.",
    });
    run = retryFailed.run;
    assert.equal(retryFailed.ok, true);
    assert.equal(getNode(run, "failed").status, "pending");
    assert.equal(getNode(run, "failed").attempts, 1);
    assert.equal(getNode(run, "failed").maxAttempts, 2);
    assert.equal(getNode(run, "failed").startedAt, undefined);
    assert.equal(getNode(run, "failed").completedAt, undefined);
    assert.equal(getNode(run, "failed").lastError, undefined);
    assert.deepEqual(run.activeNodeIds, []);
    assert.equal(run.status, "running");

    const exhausted = createNode({
      id: "exhausted",
      status: "blocked",
      attempts: 2,
      maxAttempts: 2,
      lastError: "Exhausted.",
    });
    const retryExhausted = await retryGraphNodeForRun(createRun(path.join(baseDir, "exhausted"), [exhausted]), "exhausted", {
      now: () => 2_000,
    });
    assert.equal(getNode(retryExhausted.run, "exhausted").status, "pending");
    assert.equal(getNode(retryExhausted.run, "exhausted").attempts, 2);
    assert.equal(getNode(retryExhausted.run, "exhausted").maxAttempts, 3);
    assert.deepEqual(readGraphEvents(run.eventsFile).map((event) => event.type), ["node.retry_requested"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("retry resets the Graph worktree to the node base commit", async () => {
  const baseDir = createTempBaseDir();
  try {
    const repo = createGitRepo(baseDir);
    const worktree = createGraphRunWorktree(repo, "run-1", { baseDir: path.join(baseDir, "data") });
    const baseCommit = getGraphWorktreeHeadCommit(worktree.cwd);
    fs.writeFileSync(path.join(worktree.cwd, "prototype.html"), "<main></main>\n", "utf8");
    const checkpoint = commitGraphNodeCheckpoint({
      worktreeCwd: worktree.cwd,
      graphRunId: "run-1",
      nodeId: "failed",
      status: "failed",
      baseCommit,
      summary: "Partial work.",
    });
    fs.writeFileSync(path.join(worktree.cwd, "scratch.tmp"), "dirty\n", "utf8");
    const failed = createNode({
      id: "failed",
      status: "failed",
      attempts: 1,
      maxAttempts: 2,
      worktreeCwd: worktree.cwd,
      baseCommit,
      commit: checkpoint.commit,
    });
    const run = createRun(baseDir, [failed], [], { worktree });

    const retry = await retryGraphNodeForRun(run, "failed", { now: () => 5_000 });

    assert.equal(retry.ok, true);
    assert.equal(getGraphWorktreeHeadCommit(worktree.cwd), baseCommit);
    assert.equal(fs.existsSync(path.join(worktree.cwd, "prototype.html")), false);
    assert.equal(fs.existsSync(path.join(worktree.cwd, "scratch.tmp")), false);
    assert.equal(getNode(retry.run, "failed").status, "pending");
    assert.equal(getNode(retry.run, "failed").baseCommit, undefined);
    assert.equal(getNode(retry.run, "failed").commit, undefined);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("feedback from failed validation rolls back to upstream checkpoint and resets downstream nodes", async () => {
  const baseDir = createTempBaseDir();
  try {
    const repo = createGitRepo(baseDir);
    const worktree = createGraphRunWorktree(repo, "run-1", { baseDir: path.join(baseDir, "data") });
    const runBaseCommit = getGraphWorktreeHeadCommit(worktree.cwd);
    fs.writeFileSync(path.join(worktree.cwd, "feature.ts"), "export const feature = true;\n", "utf8");
    const implementCheckpoint = commitGraphNodeCheckpoint({
      worktreeCwd: worktree.cwd,
      graphRunId: "run-1",
      nodeId: "implement",
      status: "passed",
      baseCommit: runBaseCommit,
      summary: "Implemented feature.",
    });
    fs.writeFileSync(path.join(worktree.cwd, "test-output.log"), "failure\n", "utf8");
    const testCheckpoint = commitGraphNodeCheckpoint({
      worktreeCwd: worktree.cwd,
      graphRunId: "run-1",
      nodeId: "test",
      status: "failed",
      baseCommit: implementCheckpoint.commit,
      summary: "Tests failed.",
    });
    fs.writeFileSync(path.join(worktree.cwd, "scratch.tmp"), "dirty\n", "utf8");

    const plan = createNode({ id: "plan", kind: "plan", status: "passed", attempts: 1, unlocks: ["implement"] });
    const implement = createNode({
      id: "implement",
      status: "passed",
      attempts: 1,
      maxAttempts: 1,
      dependsOn: ["plan"],
      unlocks: ["test"],
      worktreeCwd: worktree.cwd,
      baseCommit: runBaseCommit,
      commit: implementCheckpoint.commit,
      artifactRef: "nodes/implement.md",
      acceptance: [{ name: "Feature implemented", required: true, passed: true, evidenceRef: "feature.ts" }],
    });
    const testNode = createNode({
      id: "test",
      kind: "test",
      status: "failed",
      ownerRole: "reviewer",
      attempts: 1,
      maxAttempts: 1,
      dependsOn: ["implement"],
      unlocks: ["review"],
      worktreeCwd: worktree.cwd,
      baseCommit: implementCheckpoint.commit,
      commit: testCheckpoint.commit,
      lastError: "Unit tests failed.",
      acceptance: [{ name: "Unit tests", required: true, passed: false, detail: "1 failure", evidenceRef: "test-output.log" }],
    });
    const review = createNode({
      id: "review",
      kind: "review",
      status: "passed",
      ownerRole: "reviewer",
      attempts: 1,
      maxAttempts: 1,
      dependsOn: ["test"],
      unlocks: ["summary"],
      artifactRef: "nodes/review.md",
    });
    const summary = createNode({
      id: "summary",
      kind: "summary",
      status: "pending",
      dependsOn: ["review"],
      unlocks: [],
    });
    const unrelated = createNode({
      id: "unrelated",
      status: "passed",
      attempts: 1,
      unlocks: [],
      artifactRef: "nodes/unrelated.md",
    });
    const run = createRun(baseDir, [plan, implement, testNode, review, summary, unrelated], [{
      id: "test-feedback",
      from: "test",
      to: "implement",
      kind: "review_feedback",
      active: true,
    }], {
      worktree,
      status: "needs-review",
      activeNodeIds: ["test"],
    });

    assert.deepEqual(getGraphRunControlState(run).feedbackableNodeIds, ["test"]);

    const feedback = await feedbackGraphNodeForRun(run, "test", {
      now: () => 6_000,
      source: "panel",
      reason: "Validation failed; rework implementation.",
    });

    assert.equal(feedback.ok, true);
    assert.equal(feedback.run.status, "running");
    assert.deepEqual(feedback.changedNodeIds, ["implement", "review", "summary", "test"]);
    assert.equal(getGraphWorktreeHeadCommit(worktree.cwd), runBaseCommit);
    assert.equal(fs.existsSync(path.join(worktree.cwd, "feature.ts")), false);
    assert.equal(fs.existsSync(path.join(worktree.cwd, "test-output.log")), false);
    assert.equal(fs.existsSync(path.join(worktree.cwd, "scratch.tmp")), false);
    assert.equal(getNode(feedback.run, "plan").status, "passed");
    assert.equal(getNode(feedback.run, "unrelated").status, "passed");
    for (const nodeId of ["implement", "test", "review", "summary"]) {
      assert.equal(getNode(feedback.run, nodeId).status, "pending");
      assert.equal(getNode(feedback.run, nodeId).startedAt, undefined);
      assert.equal(getNode(feedback.run, nodeId).completedAt, undefined);
      assert.equal(getNode(feedback.run, nodeId).lastError, undefined);
      assert.equal(getNode(feedback.run, nodeId).commit, undefined);
    }
    assert.equal(getNode(feedback.run, "implement").maxAttempts, 2);
    assert.equal(getNode(feedback.run, "test").maxAttempts, 2);
    assert.equal(getNode(feedback.run, "review").maxAttempts, 2);
    assert.deepEqual(getNode(feedback.run, "test").acceptance, [{ name: "Unit tests", required: true, detail: "1 failure" }]);
    const [event] = readGraphEvents(feedback.run.eventsFile);
    assert.equal(event?.type, "node.feedback_requested");
    assert.equal((event?.data as { feedbackNodeId?: string; reworkNodeId?: string } | undefined)?.feedbackNodeId, "test");
    assert.equal((event?.data as { feedbackNodeId?: string; reworkNodeId?: string } | undefined)?.reworkNodeId, "implement");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("blocks retry when the target has passed descendants", async () => {
  const baseDir = createTempBaseDir();
  try {
    const upstream = createNode({ id: "upstream", status: "failed", attempts: 1, maxAttempts: 2 });
    const downstream = createNode({ id: "downstream", status: "passed", dependsOn: ["upstream"] });
    const run = createRun(baseDir, [upstream, downstream]);

    assert.deepEqual(findGraphPassedDescendantNodeIds(run, "upstream"), ["downstream"]);
    const result = await retryGraphNodeForRun(run, "upstream");
    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.equal(result.reason, "passed_descendants");
    assert.deepEqual(result.blockedNodeIds, ["downstream"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("approves human gates and exposes control state", async () => {
  const baseDir = createTempBaseDir();
  try {
    const retryable = createNode({ id: "retryable", status: "failed", attempts: 1, maxAttempts: 2 });
    const gate = createNode({
      id: "gate",
      title: "Approve risky step",
      kind: "human_gate",
      status: "ready",
      ownerRole: "human",
    });
    const run = createRun(baseDir, [retryable, gate]);

	    assert.deepEqual(getGraphRunControlState(run), {
	      canContinue: true,
	      canSupplement: true,
	      canStop: true,
	      retryableNodeIds: ["retryable"],
	      feedbackableNodeIds: [],
	      approvableNodeIds: ["gate"],
	    });

    const approved = await approveGraphHumanGateForRun(run, "gate", {
      now: () => 3_000,
      summary: "Approved by operator.",
    });
    assert.equal(approved.ok, true);
    assert.equal(approved.changed, true);
    assert.equal(getNode(approved.run, "gate").status, "passed");
    assert.equal(approved.run.status, "running");
    assert.deepEqual(readGraphEvents(approved.run.eventsFile).map((event) => event.type), ["human_gate.approved"]);

    const wrongNode = await approveGraphHumanGateForRun(approved.run, "retryable");
    assert.equal(wrongNode.ok, false);
    assert.equal(wrongNode.reason, "not_human_gate");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("stops runs by clearing active nodes and remains idempotent for stopped runs", async () => {
  const baseDir = createTempBaseDir();
  try {
    const active = createNode({ id: "active", status: "running", attempts: 1 });
    const referencedActive = createNode({ id: "referenced-active", status: "pending" });
    const waiting = createNode({ id: "waiting", status: "pending" });
    const run = createRun(baseDir, [active, referencedActive, waiting], [], {
      status: "running",
      activeNodeIds: ["active", "referenced-active"],
    });

    const stopped = await stopGraphRunRecord(run, {
      now: () => 4_000,
      source: "panel",
      reason: "User canceled.",
    });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.changed, true);
    assert.equal(stopped.run.status, "stopped");
    assert.deepEqual(stopped.run.activeNodeIds, []);
    assert.equal(getNode(stopped.run, "active").status, "stopped");
    assert.equal(getNode(stopped.run, "referenced-active").status, "stopped");
    assert.equal(getNode(stopped.run, "waiting").status, "pending");
    assert.deepEqual(readGraphEvents(stopped.run.eventsFile).map((event) => event.type), [
      "node.stopped",
      "node.stopped",
      "run.stopped",
    ]);

    const secondStop = await stopGraphRunRecord(stopped.run);
    assert.equal(secondStop.ok, true);
    assert.equal(secondStop.changed, false);
    assert.equal(secondStop.reason, "already_stopped");

    const completedStop = await stopGraphRunRecord(createRun(baseDir, [waiting], [], { status: "completed" }));
    assert.equal(completedStop.ok, false);
    assert.equal(completedStop.changed, false);
    assert.equal(completedStop.reason, "completed_run");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
