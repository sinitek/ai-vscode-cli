import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildGraphNodeCommunicationFile,
  getGraphCommunicationPaths,
} from "../graph/graphCommunications";
import {
  buildGraphRunStoreFile,
  buildGraphRunIdsBySessionByCli,
  createGraphRunRecord,
  findLatestGraphRun,
  listGraphRuns,
  normalizeGraphRunRecord,
  readGraphRunRecord,
  readGraphRunStore,
  updateGraphRunRecord,
} from "../graph/graphStore";
import { GRAPH_SCHEMA_VERSION, type GraphFailureClassification, type GraphNodeRecord } from "../graph/types";

function createTempBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-store-"));
}

function createNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "node-1",
    title: "Implement base store",
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

test("builds Graph run store paths by workspace, cli, session, and run id", () => {
  const baseDir = createTempBaseDir();
  try {
    const sessionFile = buildGraphRunStoreFile("codex", "Workspace A/B", "session/one", "run/one", { baseDir });
    const pendingFile = buildGraphRunStoreFile("claude", "", null, "run-2", { baseDir });

    assert.equal(
      sessionFile,
      path.join(baseDir, "graph-runs", "Workspace_A_B", "codex", "session_one", "run_one", "graph-runs.json"),
    );
    assert.equal(
      pendingFile,
      path.join(baseDir, "graph-runs", "no-workspace", "claude", "__pending__", "run-2", "graph-runs.json"),
    );
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("creates, reads, and updates a Graph run with v1 defaults and communication files", () => {
  const baseDir = createTempBaseDir();
  try {
    const run = createGraphRunRecord({
      id: "run-1",
      workspaceKey: "workspace-a",
      cli: "codex",
      sessionId: null,
      rootPrompt: "Build the Graph store foundation.",
      supplementalRequirements: [" keep this supplement ", ""],
      nodes: [createNode()],
      edges: [],
    }, { baseDir, now: () => 1_000 });
    const storeFile = buildGraphRunStoreFile("codex", "workspace-a", null, "run-1", { baseDir });
    const communication = getGraphCommunicationPaths("run-1", { baseDir });

    assert.equal(run.status, "draft");
    assert.equal(run.graphVersion, GRAPH_SCHEMA_VERSION);
    assert.deepEqual(run.supplementalRequirements, ["keep this supplement"]);
    assert.equal(run.runStoreFile, storeFile);
    assert.equal(run.eventsFile, communication.eventsFile);
    assert.equal(fs.existsSync(storeFile), true);
    assert.equal(fs.existsSync(communication.mainFile), true);
    assert.equal(fs.existsSync(communication.graphFile), true);
    assert.equal(fs.existsSync(communication.eventsFile), true);
    assert.equal(fs.existsSync(buildGraphNodeCommunicationFile("run-1", "node-1", { baseDir })), true);

    const loaded = readGraphRunStore(storeFile, { baseDir });
    assert.equal(loaded.runs.length, 1);
    assert.equal(loaded.runs[0].id, "run-1");
    assert.equal(loaded.runs[0].nodes[0].kind, "implement");

    const updated = updateGraphRunRecord("run-1", {
      status: "running",
      activeNodeIds: ["node-1"],
      supplementalRequirements: [" next supplement ", ""],
    }, { baseDir, storeFile, now: () => 2_000 });
    assert.ok(updated);
    assert.equal(updated.status, "running");
    assert.deepEqual(updated.activeNodeIds, ["node-1"]);
    assert.deepEqual(updated.supplementalRequirements, ["next supplement"]);
    assert.equal(updated.updatedAt, 2_000);

    const snapshot = JSON.parse(fs.readFileSync(communication.graphFile, "utf8")) as { status: string; activeNodeIds: string[]; supplementalRequirements: string[] };
    assert.equal(snapshot.status, "running");
    assert.deepEqual(snapshot.activeNodeIds, ["node-1"]);
    assert.deepEqual(snapshot.supplementalRequirements, ["next supplement"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("persists direct workspace Graph execution metadata", () => {
  const baseDir = createTempBaseDir();
  try {
    const run = createGraphRunRecord({
      id: "run-direct",
      workspaceKey: "workspace-a",
      cli: "codex",
      sessionId: null,
      rootPrompt: "Run without git worktree.",
      status: "running",
      nodes: [createNode({ executionCwd: "/workspace/project" })],
      edges: [],
      executionMode: "direct",
      directExecution: {
        cwd: "/workspace/project",
        reason: "git worktree unavailable",
        createdAt: 4_000,
      },
    }, { baseDir, now: () => 4_000 });
    const communication = getGraphCommunicationPaths("run-direct", { baseDir });
    const loaded = readGraphRunStore(run.runStoreFile, { baseDir });
    const snapshot = JSON.parse(fs.readFileSync(communication.graphFile, "utf8")) as {
      executionMode?: string;
      directExecution?: { cwd?: string; reason?: string };
      nodes?: Array<{ executionCwd?: string }>;
    };

    assert.equal(run.executionMode, "direct");
    assert.equal(run.directExecution?.cwd, "/workspace/project");
    assert.equal(loaded.runs[0].executionMode, "direct");
    assert.equal(loaded.runs[0].directExecution?.reason, "git worktree unavailable");
    assert.equal(snapshot.executionMode, "direct");
    assert.equal(snapshot.directExecution?.cwd, "/workspace/project");
    assert.equal(snapshot.nodes?.[0].executionCwd, "/workspace/project");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("lists, filters, limits, and reads Graph runs with partial tolerance for damaged stores", () => {
  const baseDir = createTempBaseDir();
  try {
    createGraphRunRecord({
      id: "run-old",
      workspaceKey: "workspace-a",
      cli: "codex",
      sessionId: null,
      rootPrompt: "Old run.",
      status: "needs-review",
      createdAt: 1_000,
      updatedAt: 2_000,
      nodes: [createNode({ id: "old-node" })],
      edges: [],
    }, { baseDir });
    createGraphRunRecord({
      id: "run-new",
      workspaceKey: "workspace-a",
      cli: "codex",
      sessionId: "session-a",
      rootPrompt: "New run.",
      status: "sleeping",
      createdAt: 3_000,
      updatedAt: 5_000,
      nodes: [createNode({ id: "new-node" })],
      edges: [],
    }, { baseDir });
    createGraphRunRecord({
      id: "run-other-cli",
      workspaceKey: "workspace-a",
      cli: "claude",
      sessionId: null,
      rootPrompt: "Other CLI run.",
      status: "running",
      createdAt: 4_000,
      updatedAt: 4_000,
      nodes: [createNode({ id: "other-node" })],
      edges: [],
    }, { baseDir });
    createGraphRunRecord({
      id: "run-other-workspace",
      workspaceKey: "workspace-b",
      cli: "codex",
      sessionId: null,
      rootPrompt: "Other workspace run.",
      status: "running",
      createdAt: 6_000,
      updatedAt: 6_000,
      nodes: [createNode({ id: "workspace-b-node" })],
      edges: [],
    }, { baseDir });

    const damagedStoreFile = buildGraphRunStoreFile("opencode", "workspace-a", null, "run-damaged-list", { baseDir });
    fs.mkdirSync(path.dirname(damagedStoreFile), { recursive: true });
    fs.writeFileSync(damagedStoreFile, "{damaged-json", "utf8");

    const allRuns = listGraphRuns({ baseDir });
    assert.deepEqual(allRuns.runs.map((run) => run.id), [
      "run-other-workspace",
      "run-new",
      "run-other-cli",
      "run-old",
    ]);
    assert.equal(allRuns.errors.length, 1);
    assert.equal(allRuns.diagnostics.scannedStoreFiles, 5);
    assert.equal(allRuns.diagnostics.unreadableStoreFiles, 1);
    assert.equal(allRuns.diagnostics.returnedRuns, 4);

    const codexWorkspaceRuns = listGraphRuns({
      baseDir,
      workspaceKey: "workspace-a",
      cli: "codex",
      statuses: ["sleeping", "needs-review"],
      limit: 1,
    });
    assert.deepEqual(codexWorkspaceRuns.runs.map((run) => run.id), ["run-new"]);
    assert.equal(codexWorkspaceRuns.diagnostics.matchedRuns, 2);

    const latest = findLatestGraphRun({ baseDir, workspaceKey: "workspace-a", cli: "codex" });
    assert.equal(latest.run?.id, "run-new");
    assert.equal(latest.errors.length, 1);

    const readNew = readGraphRunRecord("run-new", { baseDir, workspaceKey: "workspace-a", cli: "codex", limit: 1 });
    assert.equal(readNew.run?.id, "run-new");
    assert.equal(readNew.run?.status, "sleeping");
    assert.equal(readNew.errors.length, 1);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("builds latest Graph run ids by CLI session", () => {
  const byCli = buildGraphRunIdsBySessionByCli([
    { id: "run-old", cli: "codex", sessionId: " session-a ", createdAt: 1, updatedAt: 2 },
    { id: "run-new", cli: "codex", sessionId: "session-a", createdAt: 3, updatedAt: 5 },
    { id: "run-other", cli: "claude", sessionId: "session-b", createdAt: 4, updatedAt: 4 },
    { id: "run-pending", cli: "opencode", sessionId: null, createdAt: 6, updatedAt: 6 },
  ]);

  assert.equal(byCli.codex.get("session-a"), "run-new");
  assert.equal(byCli.claude.get("session-b"), "run-other");
  assert.equal(byCli.opencode.size, 0);
});

test("rejects unknown Graph run status, node kind, node status, and edge kind", () => {
  const base = {
    id: "run-bad",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Reject unknown enum values.",
    status: "draft",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: "/tmp/graph-runs.json",
    nodes: [createNode()],
    edges: [{
      id: "edge-1",
      from: "node-1",
      to: "node-2",
      kind: "depends_on",
      active: true,
    }],
    activeNodeIds: [],
    maxConcurrent: 6,
    eventsFile: "/tmp/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
  };

  assert.equal(normalizeGraphRunRecord({ ...base, status: "ready" }), null);
  assert.equal(normalizeGraphRunRecord({
    ...base,
    nodes: [{ ...createNode(), kind: "execute" }],
  }), null);
  assert.equal(normalizeGraphRunRecord({
    ...base,
    nodes: [{ ...createNode(), status: "done" }],
  }), null);
  assert.equal(normalizeGraphRunRecord({
    ...base,
    edges: [{ ...base.edges[0], kind: "unknown_edge" }],
  }), null);
});

test("normalizes structured edge metadata and node rework records", () => {
  const base = {
    id: "run-structured",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Keep structured Graph semantics.",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: "/tmp/graph-runs.json",
    nodes: [createNode({
      id: "implement",
      blocking: false,
      rework: {
        sourceNodeId: "review",
        targetNodeId: "implement",
        resetAt: 2,
        resetScopeNodeIds: ["implement", "test", "review"],
        reason: "Review feedback.",
        edgeId: "feedback-edge",
        edgeKind: "review_feedback",
      },
    })],
    edges: [{
      id: "edge-pass",
      from: "test",
      to: "review",
      kind: "if_pass",
      label: "测试通过后评审",
      condition: "test passed",
      conditionExpression: {
        type: "source_status",
        operator: "equals",
        status: "passed",
      },
      metadata: {
        feedbackReason: "Review failed.",
        evidenceRef: "nodes/test.md",
        reworkTargetNodeId: "implement",
        reworkScopeNodeIds: ["implement", "test", "review"],
      },
      active: true,
    }],
    activeNodeIds: [],
    maxConcurrent: 6,
    eventsFile: "/tmp/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
  };

  const normalized = normalizeGraphRunRecord(base);
  assert.equal(normalized?.nodes[0].blocking, false);
  assert.equal(normalized?.nodes[0].rework?.reason, "Review feedback.");
  assert.deepEqual(normalized?.nodes[0].rework?.resetScopeNodeIds, ["implement", "test", "review"]);
  assert.equal(normalized?.edges[0].label, "测试通过后评审");
  assert.equal(normalized?.edges[0].conditionExpression?.type, "source_status");
  assert.equal(normalized?.edges[0].metadata?.evidenceRef, "nodes/test.md");

  assert.equal(normalizeGraphRunRecord({
    ...base,
    edges: [{
      ...base.edges[0],
      conditionExpression: { type: "source_status", operator: "invalid" },
    }],
  }), null);
  assert.equal(normalizeGraphRunRecord({
    ...base,
    nodes: [{ ...base.nodes[0], rework: { sourceNodeId: "review" } }],
  }), null);
});

test("normalizes optional Graph node failure classifications", () => {
  const validFailure = {
    category: "missing_write_scope",
    confidence: "high",
    summary: "Needs a test write scope.",
    signals: ["candidate_write_file: apps/server/test/performance/performance-observation-schema.test.js"],
    attemptsExhausted: true,
    recommendedRecovery: {
      action: "add_rework_node",
      summary: "Add a rework node.",
      recommendedWriteFiles: ["apps/server/test/performance/performance-observation-schema.test.js"],
      nodeDraft: {
        id: "adapt-schema-contract-tests",
        title: "Adapt schema contract tests",
        kind: "test",
        writeFiles: ["apps/server/test/performance/performance-observation-schema.test.js"],
      },
    },
  } satisfies GraphFailureClassification;
  const base = {
    id: "run-failure-classification",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Keep failure classification compatible.",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: "/tmp/graph-runs.json",
    nodes: [createNode({ failure: validFailure })],
    edges: [],
    activeNodeIds: [],
    maxConcurrent: 6,
    eventsFile: "/tmp/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
  };

  const normalized = normalizeGraphRunRecord(base);
  assert.equal(normalized?.nodes[0].failure?.category, "missing_write_scope");
  assert.equal(normalized?.nodes[0].failure?.recommendedRecovery?.action, "add_rework_node");
  assert.equal(normalized?.nodes[0].failure?.recommendedRecovery?.nodeDraft?.id, "adapt-schema-contract-tests");

  const oldGraph = normalizeGraphRunRecord({
    ...base,
    nodes: [createNode()],
  });
  assert.equal(oldGraph?.nodes[0].failure, undefined);

  const invalidCategory = normalizeGraphRunRecord({
    ...base,
    nodes: [{ ...createNode(), failure: { ...validFailure, category: "unknown_category" } }],
  });
  assert.ok(invalidCategory);
  assert.equal(invalidCategory.nodes[0].failure, undefined);

  const invalidAction = normalizeGraphRunRecord({
    ...base,
    nodes: [{
      ...createNode(),
      failure: {
        ...validFailure,
        recommendedRecovery: {
          ...validFailure.recommendedRecovery,
          action: "unknown_action",
        },
      },
    }],
  });
  assert.equal(invalidAction?.nodes[0].failure?.category, "missing_write_scope");
  assert.equal(invalidAction?.nodes[0].failure?.recommendedRecovery, undefined);
});

test("throws on damaged Graph run store JSON instead of silently succeeding", () => {
  const baseDir = createTempBaseDir();
  try {
    const storeFile = buildGraphRunStoreFile("opencode", "workspace-a", null, "run-damaged", { baseDir });
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, "{not-valid-json", "utf8");

    assert.throws(
      () => readGraphRunStore(storeFile, { baseDir }),
      /Invalid Graph run store JSON/u,
    );
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("filters invalid persisted runs before they can be executed", () => {
  const baseDir = createTempBaseDir();
  try {
    const storeFile = buildGraphRunStoreFile("codex", "workspace-a", null, "run-invalid", { baseDir });
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify({
      runs: [{
        id: "run-invalid",
        workspaceKey: "workspace-a",
        cli: "codex",
        sessionId: null,
        rootPrompt: "Do not execute unknown node kinds.",
        status: "draft",
        createdAt: 1,
        updatedAt: 1,
        graphVersion: GRAPH_SCHEMA_VERSION,
        runStoreFile: storeFile,
        nodes: [{ ...createNode(), kind: "unsupported" }],
        edges: [],
        activeNodeIds: [],
        maxConcurrent: 6,
        eventsFile: "/tmp/events.jsonl",
        communicationDir: "/tmp/graph",
        mainCommunicationFile: "/tmp/graph/main.md",
        graphFile: "/tmp/graph/graph.json",
      }],
    }), "utf8");

    const loaded = readGraphRunStore(storeFile, { baseDir });
    assert.deepEqual(loaded.runs, []);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
