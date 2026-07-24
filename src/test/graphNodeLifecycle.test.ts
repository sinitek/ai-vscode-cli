import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { readGraphEvents } from "../graph/graphEvents";
import {
  approveGraphHumanGateNode,
  completeGraphSleepNodeDue,
  markGraphHumanGateWaiting,
  markGraphNodeBlocked,
  markGraphNodeCompleted,
  markGraphNodeFailed,
  markGraphNodeSleeping,
  markGraphNodeStarted,
} from "../graph/graphNodeLifecycle";
import {
  retryGraphNodeForRun,
  stopGraphRunRecord,
} from "../graph/graphRunControl";
import {
  GRAPH_SCHEMA_VERSION,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "../graph/types";

function createTempBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-lifecycle-"));
}

function createNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "node-1",
    title: "Graph node",
    kind: "implement",
    status: "pending",
    ownerRole: "subtask",
    maxAttempts: 2,
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
    rootPrompt: "Run lifecycle tests.",
    status: "running",
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

test("marks a Graph node started and completed with events and activeNodeIds", async () => {
  const baseDir = createTempBaseDir();
  try {
    let now = 1_000;
    let run = createRun(baseDir, [createNode()]);
    const deps = { now: () => now };

    run = await markGraphNodeStarted(run, "node-1", deps);
    assert.equal(getNode(run, "node-1").status, "running");
    assert.equal(getNode(run, "node-1").attempts, 1);
    assert.equal(getNode(run, "node-1").startedAt, 1_000);
    assert.deepEqual(run.activeNodeIds, ["node-1"]);

    now = 2_000;
    run = await markGraphNodeCompleted(run, "node-1", {
      summary: "Implemented.",
      artifactRef: "artifacts/node-1.md",
      acceptance: [{ name: "Build passes", passed: true, required: true }],
    }, deps);
    assert.equal(getNode(run, "node-1").status, "passed");
    assert.equal(getNode(run, "node-1").completedAt, 2_000);
    assert.equal(getNode(run, "node-1").artifactRef, "artifacts/node-1.md");
    assert.deepEqual(run.activeNodeIds, []);
    assert.deepEqual(readGraphEvents(run.eventsFile).map((event) => event.type), ["node.started", "node.completed"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("keeps retryable failures failed and blocks exhausted failures", async () => {
  const baseDir = createTempBaseDir();
  try {
    let now = 1_000;
    let run = createRun(baseDir, [createNode({ maxAttempts: 2 })]);
    const deps = { now: () => now };

    run = await markGraphNodeStarted(run, "node-1", deps);
    now = 2_000;
    run = await markGraphNodeFailed(run, "node-1", "First failure", deps);
    assert.equal(getNode(run, "node-1").status, "failed");
    assert.equal(getNode(run, "node-1").lastError, "First failure");
    assert.deepEqual(run.activeNodeIds, []);

    now = 3_000;
    run = await markGraphNodeStarted(run, "node-1", deps);
    now = 4_000;
    run = await markGraphNodeFailed(run, "node-1", "Second failure", deps);
    assert.equal(getNode(run, "node-1").status, "blocked");
    assert.equal(run.status, "needs-review");
    assert.equal(getNode(run, "node-1").lastError, "Second failure");
    assert.deepEqual(readGraphEvents(run.eventsFile).map((event) => event.type), [
      "node.started",
      "node.failed",
      "node.started",
      "node.failed",
      "node.blocked",
    ]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("marks blocked and sleeping nodes with run status and events", async () => {
  const baseDir = createTempBaseDir();
  try {
    let now = 1_000;
    let run = createRun(baseDir, [
      createNode({ id: "blocked-node" }),
      createNode({ id: "sleep-node" }),
    ], [], { activeNodeIds: ["blocked-node", "sleep-node"] });
    const deps = { now: () => now };

    run = await markGraphNodeBlocked(run, "blocked-node", "Needs user decision", deps);
    assert.equal(getNode(run, "blocked-node").status, "blocked");
    assert.equal(run.status, "needs-review");
    assert.deepEqual(run.activeNodeIds, ["sleep-node"]);

    now = 2_000;
    run = await markGraphNodeSleeping(run, "sleep-node", 9_000, "Waiting for external signal", deps);
    assert.equal(getNode(run, "sleep-node").status, "sleeping");
    assert.equal(getNode(run, "sleep-node").wakeAt, 9_000);
    assert.equal(run.status, "sleeping");
    assert.deepEqual(run.activeNodeIds, []);
    assert.deepEqual(readGraphEvents(run.eventsFile).map((event) => event.type), ["node.blocked", "node.sleeping"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("approves human gates and completes due sleep nodes through system lifecycle", async () => {
  const baseDir = createTempBaseDir();
  try {
    let now = 5_000;
    let run = createRun(baseDir, [
      createNode({
        id: "gate",
        title: "Approve",
        kind: "human_gate",
        status: "ready",
        ownerRole: "human",
      }),
      createNode({
        id: "sleep",
        title: "Wait",
        kind: "sleep",
        status: "sleeping",
        ownerRole: "system",
        wakeAt: 4_000,
      }),
    ]);
    const deps = { now: () => now };

    run = await approveGraphHumanGateNode(run, "gate", "Approved by reviewer.", deps);
    assert.equal(getNode(run, "gate").status, "passed");
    assert.equal(getNode(run, "gate").completedAt, 5_000);
    assert.equal(run.status, "running");

    now = 6_000;
    run = await completeGraphSleepNodeDue(run, "sleep", deps);
    assert.equal(getNode(run, "sleep").status, "passed");
    assert.equal(getNode(run, "sleep").completedAt, 6_000);
    assert.deepEqual(readGraphEvents(run.eventsFile).map((event) => event.type), ["human_gate.approved", "node.completed"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("marks human gates waiting before approval", async () => {
  const baseDir = createTempBaseDir();
  try {
    const run = createRun(baseDir, [
      createNode({
        id: "gate",
        title: "Approve",
        kind: "human_gate",
        status: "pending",
        ownerRole: "human",
      }),
    ]);

    const waiting = await markGraphHumanGateWaiting(run, "gate", { now: () => 4_000 });
    assert.equal(getNode(waiting, "gate").status, "ready");
    assert.equal(getNode(waiting, "gate").startedAt, 4_000);
    assert.equal(waiting.status, "needs-review");

    const approved = await approveGraphHumanGateNode(waiting, "gate", "Approved.", { now: () => 5_000 });
    assert.equal(getNode(approved, "gate").status, "passed");
    assert.equal(approved.status, "running");
    assert.deepEqual(readGraphEvents(approved.eventsFile).map((event) => event.type), [
      "human_gate.waiting",
      "human_gate.approved",
    ]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("retries failed nodes and stops active run nodes through core controls", async () => {
  const baseDir = createTempBaseDir();
  try {
    const failed = createNode({
      id: "failed",
      status: "blocked",
      attempts: 2,
      maxAttempts: 2,
      completedAt: 1_000,
      lastError: "Attempts exhausted.",
    });
    const running = createNode({
      id: "running",
      status: "running",
      attempts: 1,
    });
    const pending = createNode({
      id: "pending",
      status: "pending",
    });
    let run = createRun(baseDir, [failed, running, pending], [], {
      status: "needs-review",
      activeNodeIds: ["running"],
    });

    const retry = await retryGraphNodeForRun(run, "failed", { now: () => 2_000 });
    run = retry.run;
    assert.equal(retry.ok, true);
    assert.equal(getNode(run, "failed").status, "pending");
    assert.equal(getNode(run, "failed").attempts, 2);
    assert.equal(getNode(run, "failed").maxAttempts, 3);
    assert.equal(getNode(run, "failed").completedAt, undefined);
    assert.equal(getNode(run, "failed").lastError, undefined);
    assert.equal(run.status, "running");

    const stopped = await stopGraphRunRecord(run, { now: () => 3_000, reason: "Canceled." });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.run.status, "stopped");
    assert.deepEqual(stopped.run.activeNodeIds, []);
    assert.equal(getNode(stopped.run, "running").status, "stopped");
    assert.equal(getNode(stopped.run, "pending").status, "pending");
    assert.deepEqual(readGraphEvents(stopped.run.eventsFile).map((event) => event.type), [
      "node.retry_requested",
      "node.stopped",
      "run.stopped",
    ]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("completed summary nodes can set finalAnswer and run.completed event", async () => {
  const baseDir = createTempBaseDir();
  try {
    const run = createRun(baseDir, [
      createNode({
        id: "summary",
        title: "Summary",
        kind: "summary",
        ownerRole: "main",
        status: "running",
        attempts: 1,
      }),
    ], [], { activeNodeIds: ["summary"] });
    const next = await markGraphNodeCompleted(run, "summary", {
      summary: "Final answer created.",
      finalAnswer: {
        conclusion: "Completed",
        summary: "All required nodes passed.",
        evidence: ["npm run build"],
        unresolved: [],
      },
    }, { now: () => 10_000 });

    assert.equal(next.status, "completed");
    assert.equal(next.finalAnswer?.completedAt, 10_000);
    assert.deepEqual(readGraphEvents(next.eventsFile).map((event) => event.type), ["node.completed", "run.completed"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
