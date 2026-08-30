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

test("treats skipped structural dependencies as continuable without satisfying if_pass edges", () => {
  const skipped = createNode({ id: "skipped", title: "Skipped", status: "skipped" });
  const structuralTarget = readyImplement("structural-target", { dependsOn: ["skipped"] });
  const passTarget = readyImplement("pass-target");
  const run = createRun([skipped, structuralTarget, passTarget], [{
    id: "edge-pass-skipped",
    from: "skipped",
    to: "pass-target",
    kind: "if_pass",
    active: true,
  }]);

  assert.deepEqual(computeGraphReadyNodeIds(run), ["structural-target"]);
  assert.deepEqual(getGraphNodeBlockers(run, "structural-target"), []);
  assert.equal(getGraphNodeBlockers(run, "pass-target")[0]?.reason, "if_pass_not_satisfied");
});

test("treats failed advisory dependencies as continuable without satisfying if_pass edges", () => {
  const advisory = createNode({
    id: "full-unit",
    title: "Full unit tests",
    kind: "test",
    status: "failed",
    blocking: false,
    attempts: 1,
    maxAttempts: 1,
    lastError: "Full suite has unrelated failures.",
  });
  const structuralTarget = readyImplement("structural-target", { dependsOn: ["full-unit"] });
  const passTarget = readyImplement("pass-target");
  const run = createRun([advisory, structuralTarget, passTarget], [{
    id: "edge-pass-advisory",
    from: "full-unit",
    to: "pass-target",
    kind: "if_pass",
    active: true,
  }]);

  assert.deepEqual(computeGraphReadyNodeIds(run), ["structural-target"]);
  assert.deepEqual(getGraphNodeBlockers(run, "structural-target"), []);
  assert.equal(getGraphNodeBlockers(run, "pass-target")[0]?.reason, "if_pass_not_satisfied");
  assert.equal(getGraphNodeBlockers(run, "full-unit")[0]?.reason, "attempts_exhausted");
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

test("ignores if_fail rework trigger edges when computing scheduler readiness", () => {
  const reviewSource = createNode({
    id: "review-source",
    title: "Review source",
    kind: "review",
    status: "passed",
    ownerRole: "reviewer",
  });
  const reworkTarget = readyImplement("rework-target");
  const ordinaryFailureTarget = readyImplement("ordinary-failure-target");
  const run = createRun([
    reviewSource,
    reworkTarget,
    ordinaryFailureTarget,
  ], [
    {
      id: "edge-rework",
      from: "review-source",
      to: "rework-target",
      kind: "if_fail",
      active: true,
      metadata: {
        feedbackReason: "Review feedback asks implementation rework.",
        reworkTargetNodeId: "rework-target",
        reworkScopeNodeIds: ["rework-target", "review-source"],
      },
    },
    {
      id: "edge-ordinary-fail",
      from: "review-source",
      to: "ordinary-failure-target",
      kind: "if_fail",
      active: true,
    },
  ]);

  assert.deepEqual(computeGraphReadyNodeIds(run), ["rework-target"]);
  assert.deepEqual(getGraphNodeBlockers(run, "rework-target"), []);
  assert.equal(getGraphNodeBlockers(run, "ordinary-failure-target")[0]?.reason, "if_fail_not_satisfied");
});

test("evaluates structured edge conditions and reports readable blockers", () => {
  const source = createNode({
    id: "source",
    title: "Source",
    status: "passed",
    acceptance: [{
      id: "unit",
      name: "Unit tests",
      required: true,
      passed: true,
      evidenceRef: "test.log",
    }],
  });
  const sourceWithoutFailedAcceptance = createNode({
    id: "source-clean",
    title: "Source clean",
    status: "passed",
    acceptance: [{
      id: "review",
      name: "Review",
      required: true,
      passed: true,
    }],
  });
  const acceptanceTarget = readyImplement("acceptance-target");
  const evidenceTarget = readyImplement("evidence-target");
  const failedAcceptanceTarget = readyImplement("failed-acceptance-target");
  const customTarget = readyImplement("custom-target");
  const run = createRun([
    source,
    sourceWithoutFailedAcceptance,
    acceptanceTarget,
    evidenceTarget,
    failedAcceptanceTarget,
    customTarget,
  ], [
    {
      id: "edge-acceptance",
      from: "source",
      to: "acceptance-target",
      kind: "if_pass",
      label: "验收通过后继续",
      active: true,
      conditionExpression: {
        type: "source_acceptance",
        operator: "all_required_passed",
        acceptanceId: "unit",
      },
    },
    {
      id: "edge-evidence",
      from: "source",
      to: "evidence-target",
      kind: "if_pass",
      active: true,
      conditionExpression: {
        type: "source_acceptance",
        operator: "has_evidence",
      },
    },
    {
      id: "edge-no-failure",
      from: "source-clean",
      to: "failed-acceptance-target",
      kind: "if_pass",
      active: true,
      conditionExpression: {
        type: "source_acceptance",
        operator: "any_required_failed",
      },
    },
    {
      id: "edge-custom",
      from: "source",
      to: "custom-target",
      kind: "if_pass",
      active: true,
      conditionExpression: {
        type: "custom",
        description: "coverage > 90%",
      },
    },
  ]);

  assert.deepEqual(computeGraphReadyNodeIds(run), ["acceptance-target", "evidence-target"]);
  const failedAcceptanceBlocker = getGraphNodeBlockers(run, "failed-acceptance-target")[0];
  assert.equal(failedAcceptanceBlocker?.reason, "edge_condition_not_satisfied");
  assert.equal(failedAcceptanceBlocker?.edgeKind, "if_pass");
  assert.match(failedAcceptanceBlocker?.message ?? "", /edge-no-failure/u);
  const customBlocker = getGraphNodeBlockers(run, "custom-target")[0];
  assert.equal(customBlocker?.reason, "edge_condition_not_evaluable");
  assert.match(customBlocker?.message ?? "", /custom condition/u);
  assert.equal(customBlocker?.conditionExpression?.description, "coverage > 90%");
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

test("allows unscoped ready nodes to run together when no explicit conflict is declared", () => {
  const unscopedA = readyImplement("unscoped-a");
  const unscopedB = readyImplement("unscoped-b");
  const readOnlyPlan = createNode({ id: "plan", title: "Plan", kind: "plan", status: "pending", ownerRole: "main" });
  const run = createRun([unscopedA, unscopedB, readOnlyPlan]);
  const batch = selectGraphRunnableBatch(run);

  assert.deepEqual(batch.selectedNodeIds, ["unscoped-a", "unscoped-b", "plan"]);
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "unscoped-b"), undefined);
  assert.equal(getGraphNodeConflictReason(unscopedA, unscopedB), null);
});

test("selects all planned parallel review nodes without writeFiles", () => {
  const plan = createNode({ id: "plan", title: "Plan", kind: "plan", status: "passed", ownerRole: "main" });
  const reviewNodeIds = [
    "audit-runtime-hosts",
    "audit-cli-interactive",
    "audit-graph-backend",
    "audit-test-contracts",
  ];
  const reviews = reviewNodeIds.map((id) => createNode({
    id,
    title: id,
    kind: "review",
    status: "pending",
    ownerRole: "subtask",
    dependsOn: ["plan"],
  }));
  const run = createRun([plan, ...reviews], [], { maxConcurrent: 4 });
  const batch = selectGraphRunnableBatch(run, { maxConcurrent: 4 });

  assert.deepEqual(batch.readyNodes.map((item) => item.nodeId), reviewNodeIds);
  assert.deepEqual(batch.selectedNodeIds, reviewNodeIds);
  assert.deepEqual(
    batch.deferredNodes.filter((item) => reviewNodeIds.includes(item.nodeId)),
    [],
  );
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

test("caps over-limit run maxConcurrent at the Graph default maximum", () => {
  const run = createRun(Array.from({ length: 8 }, (_unused, index) => readyImplement(`node-${index + 1}`, {
    writeFiles: [`src/over-limit-${index + 1}.ts`],
  })), [], { maxConcurrent: 99 });
  const batch = selectGraphRunnableBatch(run);

  assert.equal(batch.maxConcurrent, GRAPH_DEFAULT_MAX_CONCURRENT_NODES);
  assert.equal(batch.selectedNodeIds.length, GRAPH_DEFAULT_MAX_CONCURRENT_NODES);
});

test("does not expose human_gate as a runtime action and keeps sleep nodes out of CLI execution", () => {
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
  assert.deepEqual(batch.humanGateNodes.map((item) => item.nodeId), []);
  assert.deepEqual(batch.sleepReadyNodes.map((item) => item.nodeId), ["due-sleep"]);
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "gate")?.blockers[0]?.reason, "terminal_status");
  assert.equal(batch.deferredNodes.find((item) => item.nodeId === "sleeping")?.blockers[0]?.reason, "already_sleeping");
});
