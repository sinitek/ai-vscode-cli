import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildGraphNodeExecutionBatch,
  computeGraphReadyNodeIds,
  getGraphNodeBlockers,
  getGraphNodeConflictReason,
  normalizeGraphWriteFiles,
  selectGraphRunnableBatch,
} from "../graph/graphScheduler";
import {
  GRAPH_DEFAULT_MAX_CONCURRENT_NODES,
  GRAPH_SCHEMA_VERSION,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "../graph/types";

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
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[] = [],
  overrides: Partial<GraphRunRecord> = {},
): GraphRunRecord {
  return {
    id: "run-1",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Run Graph scheduler tests.",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: "/tmp/graph-runs.json",
    nodes,
    edges,
    activeNodeIds: [],
    maxConcurrent: GRAPH_DEFAULT_MAX_CONCURRENT_NODES,
    eventsFile: "/tmp/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
    ...overrides,
  };
}

function readyImplement(id: string, overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return createNode({
    id,
    title: id,
    kind: "implement",
    status: "pending",
    ownerRole: "subtask",
    ...overrides,
  });
}

test("marks nodes ready only after all dependencies have passed and reports dependency blockers", () => {
  const passed = createNode({ id: "passed", title: "Passed", status: "passed" });
  const failed = createNode({ id: "failed", title: "Failed", status: "failed", attempts: 1, maxAttempts: 2 });
  const ready = readyImplement("ready", { dependsOn: ["passed"] });
  const waiting = readyImplement("waiting", { dependsOn: ["passed", "failed"] });
  const missing = readyImplement("missing", { dependsOn: ["does-not-exist"] });
  const run = createRun([passed, failed, ready, waiting, missing]);

  assert.deepEqual(computeGraphReadyNodeIds(run), ["failed", "ready"]);
  assert.equal(getGraphNodeBlockers(run, "waiting")[0]?.reason, "dependency_not_passed");
  assert.equal(getGraphNodeBlockers(run, "missing")[0]?.reason, "missing_dependency");
});

test("allows failed nodes to retry before maxAttempts and blocks exhausted failed nodes", () => {
  const retryable = readyImplement("retryable", { status: "failed", attempts: 1, maxAttempts: 2 });
  const exhausted = readyImplement("exhausted", { status: "failed", attempts: 2, maxAttempts: 2 });
  const run = createRun([retryable, exhausted]);

  assert.deepEqual(computeGraphReadyNodeIds(run), ["retryable"]);
  assert.equal(getGraphNodeBlockers(run, "exhausted")[0]?.reason, "attempts_exhausted");
});

test("respects active if_pass and if_fail conditional edges", () => {
  const passSource = createNode({ id: "pass-source", title: "Pass source", status: "passed" });
  const failSource = createNode({ id: "fail-source", title: "Fail source", status: "failed", attempts: 1, maxAttempts: 2 });
  const blockedSource = createNode({ id: "blocked-source", title: "Blocked source", status: "blocked" });
  const pendingSource = createNode({ id: "pending-source", title: "Pending source", status: "pending" });
  const passTarget = readyImplement("pass-target");
  const failTarget = readyImplement("fail-target");
  const blockedTarget = readyImplement("blocked-target");
  const waitingTarget = readyImplement("waiting-target");
  const inactiveTarget = readyImplement("inactive-target");
  const run = createRun([
    passSource,
    failSource,
    blockedSource,
    pendingSource,
    passTarget,
    failTarget,
    blockedTarget,
    waitingTarget,
    inactiveTarget,
  ], [
    { id: "edge-pass", from: "pass-source", to: "pass-target", kind: "if_pass", active: true },
    { id: "edge-fail", from: "fail-source", to: "fail-target", kind: "if_fail", active: true },
    { id: "edge-blocked", from: "blocked-source", to: "blocked-target", kind: "if_fail", active: true },
    { id: "edge-wait", from: "pending-source", to: "waiting-target", kind: "if_pass", active: true },
    { id: "edge-inactive", from: "pass-source", to: "inactive-target", kind: "if_pass", active: false },
  ]);

  assert.deepEqual(
    computeGraphReadyNodeIds(run),
    ["fail-source", "pending-source", "pass-target", "fail-target", "blocked-target"],
  );
  assert.equal(getGraphNodeBlockers(run, "waiting-target")[0]?.reason, "if_pass_not_satisfied");
  assert.equal(getGraphNodeBlockers(run, "inactive-target")[0]?.reason, "conditional_edge_inactive");
});

test("defers ready nodes that conflict with currently running node writeFiles", () => {
  const running = readyImplement("running", { status: "running", writeFiles: ["src/graph"] });
  const conflicts = readyImplement("conflicts", { writeFiles: ["./src/graph/graphScheduler.ts"] });
  const independent = readyImplement("independent", { writeFiles: ["src/webview/viewContent.ts"] });
  const run = createRun([running, conflicts, independent], [], { activeNodeIds: ["running"] });
  const batch = selectGraphRunnableBatch(run);

  assert.deepEqual(batch.selectedNodeIds, ["independent"]);
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "conflicts")?.blockers[0]?.reason, "running_conflict");
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "conflicts")?.blockers[0]?.conflict?.reason, "writeFiles");
});

test("greedily selects a batch without parent-child writeFile conflicts or same conflictGroup", () => {
  const parent = readyImplement("parent", { writeFiles: ["src/graph"] });
  const child = readyImplement("child", { writeFiles: ["src/graph/graphScheduler.ts"] });
  const groupA = readyImplement("group-a", { conflictGroup: "Docs" });
  const groupB = readyImplement("group-b", { conflictGroup: "docs" });
  const independent = readyImplement("independent", { writeFiles: ["src/cli/types.ts"] });
  const run = createRun([parent, child, groupA, groupB, independent]);
  const batch = buildGraphNodeExecutionBatch(run);

  assert.deepEqual(batch.selectedNodeIds, ["parent", "group-a", "independent"]);
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "child")?.blockers[0]?.reason, "batch_conflict");
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "group-b")?.blockers[0]?.conflict?.reason, "conflictGroup");
  assert.equal(getGraphNodeConflictReason(parent, child)?.reason, "writeFiles");
  assert.deepEqual(normalizeGraphWriteFiles([" ./SRC/Graph ", "src//graph", "", 1]), ["src/graph"]);
});

test("serializes unscoped write-class nodes that cannot prove their write range", () => {
  const unscopedA = readyImplement("unscoped-a");
  const unscopedB = readyImplement("unscoped-b");
  const readOnlyPlan = createNode({ id: "plan", title: "Plan", kind: "plan", status: "pending", ownerRole: "main" });
  const run = createRun([unscopedA, unscopedB, readOnlyPlan]);
  const batch = selectGraphRunnableBatch(run);

  assert.deepEqual(batch.selectedNodeIds, ["unscoped-a", "plan"]);
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "unscoped-b")?.blockers[0]?.conflict?.reason, "unscopedWrite");
});

test("uses default maxConcurrent and honors a valid run maxConcurrent override", () => {
  const defaultRun = createRun(Array.from({ length: 8 }, (_unused, index) => readyImplement(`node-${index + 1}`, {
    writeFiles: [`src/${index + 1}.ts`],
  })));
  const limitedRun = createRun(Array.from({ length: 4 }, (_unused, index) => readyImplement(`limited-${index + 1}`, {
    writeFiles: [`lib/${index + 1}.ts`],
  })), [], { maxConcurrent: 2 });

  assert.equal(selectGraphRunnableBatch(defaultRun).maxConcurrent, GRAPH_DEFAULT_MAX_CONCURRENT_NODES);
  assert.deepEqual(selectGraphRunnableBatch(defaultRun).selectedNodeIds, [
    "node-1",
    "node-2",
    "node-3",
    "node-4",
    "node-5",
    "node-6",
  ]);
  assert.deepEqual(selectGraphRunnableBatch(limitedRun).selectedNodeIds, ["limited-1", "limited-2"]);
});

test("falls back to default maxConcurrent when run maxConcurrent is invalid", () => {
  const run = createRun(Array.from({ length: 7 }, (_unused, index) => readyImplement(`node-${index + 1}`, {
    writeFiles: [`src/${index + 1}.ts`],
  })), [], { maxConcurrent: 0 });

  assert.equal(selectGraphRunnableBatch(run).maxConcurrent, GRAPH_DEFAULT_MAX_CONCURRENT_NODES);
  assert.equal(selectGraphRunnableBatch(run).selectedNodeIds.length, GRAPH_DEFAULT_MAX_CONCURRENT_NODES);
});

test("keeps human_gate and sleep nodes out of the ordinary CLI execution batch", () => {
  const cli = readyImplement("cli", { writeFiles: ["src/graph/graphScheduler.ts"] });
  const gate = createNode({
    id: "gate",
    title: "Approve",
    kind: "human_gate",
    status: "pending",
    ownerRole: "human",
  });
  const sleeping = createNode({
    id: "sleeping",
    title: "Wait",
    kind: "sleep",
    status: "sleeping",
    ownerRole: "system",
    wakeAt: 2_000,
  });
  const dueSleep = createNode({
    id: "due-sleep",
    title: "Wake",
    kind: "sleep",
    status: "sleeping",
    ownerRole: "system",
    wakeAt: 900,
  });
  const run = createRun([cli, gate, sleeping, dueSleep]);
  const batch = selectGraphRunnableBatch(run, { now: 1_000 });

  assert.deepEqual(batch.selectedNodeIds, ["cli"]);
  assert.deepEqual(batch.humanGateNodes.map((item) => item.nodeId), ["gate"]);
  assert.deepEqual(batch.sleepReadyNodes.map((item) => item.nodeId), ["due-sleep"]);
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "sleeping")?.blockers[0]?.reason, "already_sleeping");
});
