import test = require("node:test");
import assert = require("node:assert/strict");

import {
  classifyGraphNodeFailure,
  extractCandidateWriteFiles,
} from "../graph/graphFailureClassification";
import { GRAPH_SCHEMA_VERSION, type GraphNodeRecord, type GraphRunRecord } from "../graph/types";

const STALE_TEST_FILE = "apps/server/test/performance/performance-observation-schema.test.js";

function createNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "test-schema-definitions",
    title: "Validate schema definitions",
    kind: "test",
    status: "failed",
    ownerRole: "subtask",
    maxAttempts: 2,
    attempts: 2,
    dependsOn: ["implement-schema-definitions"],
    unlocks: [],
    ...overrides,
  };
}

function createRun(nodes: GraphNodeRecord[]): GraphRunRecord {
  const feedbackSourceNodeId = nodes[0]?.id ?? "test-schema-definitions";
  return {
    id: "run-1",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Optimize Graph failure handling.",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: "/tmp/graph-runs.json",
    nodes,
    edges: [{
      id: `${feedbackSourceNodeId}-if-fail`,
      from: feedbackSourceNodeId,
      to: "implement-schema-definitions",
      kind: "if_fail",
      active: true,
      metadata: {
        reworkTargetNodeId: "implement-schema-definitions",
      },
    }],
    activeNodeIds: [],
    maxConcurrent: 6,
    eventsFile: "/tmp/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
  };
}

test("classifies stale contract without write scope as missing_write_scope", () => {
  const node = createNode();
  const run = createRun([node]);
  const classification = classifyGraphNodeFailure({
    run,
    node,
    error: "performance-observation-schema still depends on old db.js text assertion.",
    result: {
      summary: "Build passed, but the source-contract assertion is stale after SQL moved to db/schema/observability.js.",
      artifactRef: "/tmp/nodes/test-schema-definitions.md",
      acceptance: [{
        name: "schema tests pass",
        passed: false,
        required: true,
        detail: `${STALE_TEST_FILE} still reads apps/server/src/db.js and checks CREATE_PERFORMANCE_OBSERVATION_TABLE_SQL after it migrated to apps/server/src/db/schema/observability.js.`,
      }],
    },
    attemptsExhausted: true,
  });

  assert.equal(classification.category, "missing_write_scope");
  assert.equal(classification.confidence, "high");
  assert.equal(classification.attemptsExhausted, true);
  assert.ok(classification.signals.some((signal) => signal.includes("stale_test_contract")));
  assert.ok(classification.signals.includes(`candidate_write_file: ${STALE_TEST_FILE}`));
  assert.equal(classification.recommendedRecovery?.action, "add_rework_node");
  assert.notEqual(classification.recommendedRecovery?.action, "retry_node");
  assert.ok(classification.recommendedRecovery?.recommendedWriteFiles?.includes(STALE_TEST_FILE));
  assert.equal(classification.recommendedRecovery?.nodeDraft?.id, "adapt-schema-contract-tests");
  assert.ok(classification.recommendedRecovery?.nodeDraft?.writeFiles?.includes(STALE_TEST_FILE));
});

test("classifies covered stale contracts separately from missing write scope", () => {
  const node = createNode({ writeFiles: [STALE_TEST_FILE] });
  const classification = classifyGraphNodeFailure({
    node,
    error: `${STALE_TEST_FILE} has an old source-contract assertion after implementation moved to db/schema/observability.js.`,
    attemptsExhausted: false,
  });

  assert.equal(classification.category, "stale_test_contract");
  assert.ok(classification.signals.some((signal) => signal.includes("stale_test_contract")));
});

test("classifies environment failures from process and filesystem signals", () => {
  const node = createNode({
    id: "test-command",
    title: "Run command",
    kind: "test",
    attempts: 1,
    maxAttempts: 2,
  });
  const classification = classifyGraphNodeFailure({
    node,
    error: "spawn npm ENOENT: command not found while running tests",
    attemptsExhausted: false,
  });

  assert.equal(classification.category, "environment_failure");
  assert.equal(classification.recommendedRecovery?.action, "retry_node");
});

test("classifies ordinary assertion failures as implementation_bug", () => {
  const node = createNode({
    id: "test-api",
    title: "Test API",
    kind: "test",
    attempts: 1,
    maxAttempts: 2,
  });
  const run = createRun([node]);
  const classification = classifyGraphNodeFailure({
    run,
    node,
    error: "AssertionError: expected 200 to equal 201",
    result: {
      acceptance: [{
        name: "API returns expected status",
        passed: false,
        required: true,
        detail: "The response status regressed after the implementation change.",
      }],
    },
  });

  assert.equal(classification.category, "implementation_bug");
  assert.equal(classification.recommendedRecovery?.action, "feedback_rollback");
  assert.equal(classification.recommendedRecovery?.targetNodeId, "implement-schema-definitions");
});

test("extracts test paths as preferred candidate write files", () => {
  assert.deepEqual(
    extractCandidateWriteFiles(`Update ${STALE_TEST_FILE} instead of apps/server/src/db.js.`),
    [STALE_TEST_FILE],
  );
});

test("prioritizes repeated failure-context test paths over broad command lists", () => {
  const source = [
    "node --test apps/server/test/source-contract/db-init-order-source.test.js apps/server/test/db/db-facade-exports.test.js apps/server/test/performance/performance-observation-schema.test.js",
    `${STALE_TEST_FILE} still reads apps/server/src/db.js after SQL migrated to apps/server/src/db/schema/observability.js.`,
    `The failed old assertion in ${STALE_TEST_FILE} needs adaptation.`,
  ].join("\n");

  assert.deepEqual(extractCandidateWriteFiles(source), [STALE_TEST_FILE]);
});
