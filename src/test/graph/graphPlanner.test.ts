import test = require("node:test");
import assert = require("node:assert/strict");

import {
  appendGraphReplanningNode,
  buildGraphPlanningRunEdges,
  buildGraphPlanningRunNodes,
  GRAPH_AI_PLANNER_NODE_ID,
  GRAPH_AI_REPLANNER_NODE_ID_PREFIX,
  materializeGraphPlan,
  normalizeGraphPlannedGraphSpec,
} from "../../graph/graphPlanner";
import {
  GRAPH_DEFAULT_MAX_CONCURRENT_NODES,
  GRAPH_SCHEMA_VERSION,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type GraphPlannedGraphSpec,
  type GraphRunRecord,
} from "../../graph/types";

function createRun(
  nodes: GraphNodeRecord[] = buildGraphPlanningRunNodes("run-1"),
  edges: GraphEdgeRecord[] = buildGraphPlanningRunEdges(),
  overrides: Partial<GraphRunRecord> = {},
): GraphRunRecord {
  return {
    id: "run-1",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Implement a complex feature.",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: "/tmp/graph-runs.json",
    nodes,
    edges,
    activeNodeIds: [],
    maxConcurrent: 1,
    eventsFile: "/tmp/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
    ...overrides,
  };
}

function passedPlanner(): GraphNodeRecord {
  return {
    ...buildGraphPlanningRunNodes("run-1")[0],
    status: "passed",
    attempts: 1,
    artifactRef: "/tmp/graph/nodes/plan.md",
  };
}

test("materializes an AI planned non-linear DAG after the planner node passes", () => {
  assert.equal(buildGraphPlanningRunNodes("run-1")[0].title, "规划 Graph DAG 执行");
  assert.equal(
    buildGraphPlanningRunNodes("run-1")[0].acceptance?.[0]?.name,
    "Planner 在执行节点运行前输出已校验的 plannedGraph DAG。",
  );

  const plannedGraph: GraphPlannedGraphSpec = {
    maxConcurrent: 4,
    nodes: [{
      id: "implement-api",
      title: "Implement API",
      kind: "implement",
      writeFiles: ["src/api/**"],
      conflictGroup: "api",
      acceptance: [{ name: "API implemented", required: true }],
    }, {
      id: "implement-ui",
      title: "Implement UI",
      kind: "implement",
      writeFiles: ["src/webview/**"],
      conflictGroup: "ui",
      acceptance: [{ name: "UI implemented", required: true }],
    }, {
      id: "test-api",
      title: "Test API",
      kind: "test",
      dependsOn: ["implement-api"],
      writeFiles: ["src/test/api/**"],
    }, {
      id: "test-ui",
      title: "Test UI",
      kind: "test",
      dependsOn: ["implement-ui"],
      writeFiles: ["src/test/webview/**"],
    }, {
      id: "review-all",
      title: "Review merged result",
      kind: "review",
      ownerRole: "reviewer",
      dependsOn: ["test-api", "test-ui"],
    }],
    edges: [{
      from: "implement-api",
      to: "test-api",
    }, {
      from: "implement-ui",
      to: "test-ui",
    }, {
      from: "test-api",
      to: "review-all",
      kind: "if_pass",
      label: "API 测试通过后评审",
      condition: "test-api must pass",
      conditionExpression: {
        type: "source_status",
        operator: "equals",
        status: "passed",
        description: "API test node passed.",
      },
    }, {
      from: "test-ui",
      to: "review-all",
    }, {
      id: "review-feedback-api",
      from: "review-all",
      to: "implement-api",
      kind: "review_feedback",
      label: "评审失败返工 API",
      metadata: {
        feedbackReason: "Review failed; rework API branch.",
        reworkTargetNodeId: "implement-api",
        reworkScopeNodeIds: ["implement-api", "test-api", "review-all"],
      },
    }],
  };

  const result = materializeGraphPlan(createRun([passedPlanner()]), plannedGraph, { now: () => 2 });

  assert.equal(result.changed, true);
  assert.equal(result.error, undefined);
  assert.equal(result.run.status, "running");
  assert.equal(result.run.maxConcurrent, 4);
  assert.deepEqual(result.plannedNodeIds, [
    "implement-api",
    "implement-ui",
    "test-api",
    "test-ui",
    "review-all",
    "summary",
  ]);
  assert.deepEqual(result.run.nodes.map((node) => node.id), [
    GRAPH_AI_PLANNER_NODE_ID,
    "implement-api",
    "implement-ui",
    "test-api",
    "test-ui",
    "review-all",
    "summary",
  ]);
  assert.deepEqual(result.run.nodes.find((node) => node.id === GRAPH_AI_PLANNER_NODE_ID)?.unlocks, [
    "implement-api",
    "implement-ui",
  ]);
  assert.equal(result.run.nodes.find((node) => node.id === "implement-api")?.title, "实现 API");
  assert.equal(result.run.nodes.find((node) => node.id === "review-all")?.title, "评审合并结果");
  assert.equal(result.run.nodes.find((node) => node.id === "summary")?.title, "总结 AI 规划的 Graph 运行");
  assert.equal(result.run.nodes.find((node) => node.id === "summary")?.ownerRole, "main");
  assert.deepEqual(result.run.nodes.find((node) => node.id === "summary")?.dependsOn, ["review-all"]);
  assert.equal(result.run.edges.some((edge) => edge.from === GRAPH_AI_PLANNER_NODE_ID && edge.to === "implement-api"), true);
  assert.equal(result.run.edges.some((edge) => edge.from === GRAPH_AI_PLANNER_NODE_ID && edge.to === "implement-ui"), true);
  const conditionalEdge = result.run.edges.find((edge) => edge.from === "test-api" && edge.to === "review-all" && edge.kind === "if_pass");
  assert.equal(conditionalEdge?.label, "API 测试通过后评审");
  assert.equal(conditionalEdge?.conditionExpression?.type, "source_status");
  assert.equal(conditionalEdge?.conditionExpression?.status, "passed");
  const feedbackEdge = result.run.edges.find((edge) => edge.id === "review-feedback-api");
  assert.equal(feedbackEdge?.metadata?.feedbackReason, "Review failed; rework API branch.");
  assert.deepEqual(feedbackEdge?.metadata?.reworkScopeNodeIds, ["implement-api", "test-api", "review-all"]);
});

test("infers materialized maxConcurrent from independent root branches when planner omits it", () => {
  const plannedGraph: GraphPlannedGraphSpec = {
    nodes: [{
      id: "implement-api",
      title: "Implement API",
      kind: "implement",
      writeFiles: ["src/api"],
      conflictGroup: "api",
    }, {
      id: "implement-ui",
      title: "Implement UI",
      kind: "implement",
      writeFiles: ["src/webview"],
      conflictGroup: "ui",
    }, {
      id: "test-all",
      title: "Test all",
      kind: "test",
      dependsOn: ["implement-api", "implement-ui"],
      writeFiles: ["src/test"],
    }],
  };

  const result = materializeGraphPlan(createRun([passedPlanner()], [], { maxConcurrent: 1 }), plannedGraph, { now: () => 2 });

  assert.equal(result.changed, true);
  assert.equal(result.error, undefined);
  assert.equal(result.run.maxConcurrent, 2);
  assert.deepEqual(result.run.nodes.find((node) => node.id === GRAPH_AI_PLANNER_NODE_ID)?.unlocks, [
    "implement-api",
    "implement-ui",
  ]);
});

test("infers up to five independent root branches when planner omits maxConcurrent", () => {
  const rootNodes = Array.from({ length: GRAPH_DEFAULT_MAX_CONCURRENT_NODES }, (_unused, index) => {
    const number = index + 1;
    return {
      id: `implement-part-${number}`,
      title: `Implement part ${number}`,
      kind: "implement" as const,
      writeFiles: [`src/part-${number}`],
      conflictGroup: `part-${number}`,
    };
  });
  const plannedGraph: GraphPlannedGraphSpec = {
    nodes: [
      ...rootNodes,
      {
        id: "review-all",
        title: "Review all",
        kind: "review",
        dependsOn: rootNodes.map((node) => node.id),
      },
    ],
  };

  const result = materializeGraphPlan(createRun([passedPlanner()], [], { maxConcurrent: 1 }), plannedGraph, { now: () => 2 });

  assert.equal(result.changed, true);
  assert.equal(result.error, undefined);
  assert.equal(result.run.maxConcurrent, GRAPH_DEFAULT_MAX_CONCURRENT_NODES);
  assert.deepEqual(
    result.run.nodes.find((node) => node.id === GRAPH_AI_PLANNER_NODE_ID)?.unlocks,
    rootNodes.map((node) => node.id),
  );
});

test("materializes advisory validation nodes without making them implicitly blocking", () => {
  const plannedGraph: GraphPlannedGraphSpec = {
    nodes: [{
      id: "test-unit-full",
      title: "Run full unit tests",
      kind: "test",
      blocking: false,
      writeFiles: ["dist/**"],
      acceptance: [{ name: "Full unit suite result recorded", required: false }],
    }, {
      id: "review-result",
      title: "Review result",
      kind: "review",
      dependsOn: ["test-unit-full"],
    }],
  };

  const result = materializeGraphPlan(createRun([passedPlanner()]), plannedGraph, { now: () => 2 });

  assert.equal(result.changed, true);
  assert.equal(result.run.nodes.find((node) => node.id === "test-unit-full")?.blocking, false);
  assert.equal(result.run.nodes.find((node) => node.id === "review-result")?.dependsOn.includes("test-unit-full"), true);
});

test("appends a main replanner node and materializes its plannedGraph into the current run", () => {
  const planner = passedPlanner();
  const implement = {
    id: "implement",
    title: "Implement feature",
    kind: "implement" as const,
    status: "passed" as const,
    ownerRole: "subtask" as const,
    maxAttempts: 2,
    attempts: 1,
    dependsOn: [GRAPH_AI_PLANNER_NODE_ID],
    unlocks: ["review"],
  };
  const review = {
    id: "review",
    title: "Review feature",
    kind: "review" as const,
    status: "failed" as const,
    ownerRole: "reviewer" as const,
    maxAttempts: 1,
    attempts: 1,
    dependsOn: ["implement"],
    unlocks: [],
    lastError: "Review found missing validation.",
  };
  const run = createRun([planner, implement, review], [{
    id: "edge-plan-implement",
    from: GRAPH_AI_PLANNER_NODE_ID,
    to: "implement",
    kind: "depends_on",
    active: true,
  }, {
    id: "edge-implement-review",
    from: "implement",
    to: "review",
    kind: "depends_on",
    active: true,
  }]);

  const appended = appendGraphReplanningNode(run, {
    triggerNodeIds: ["review"],
    reason: "Review failed.",
    now: () => 3,
  });

  assert.equal(appended.changed, true);
  assert.equal(appended.nodeId, `${GRAPH_AI_REPLANNER_NODE_ID_PREFIX}-1`);
  assert.equal(appended.run.status, "running");
  assert.equal(appended.run.nodes.find((node) => node.id === "review")?.unlocks.includes("replan-1"), true);
  const replanner = appended.run.nodes.find((node) => node.id === "replan-1");
  assert.equal(replanner?.kind, "plan");
  assert.equal(replanner?.ownerRole, "main");
  assert.equal(replanner?.lastError, "Review failed.");
  assert.equal(appended.run.edges.some((edge) => edge.from === "review" && edge.to === "replan-1" && edge.kind === "if_fail"), true);

  const runWithPassedReplanner = {
    ...appended.run,
    nodes: appended.run.nodes.map((node) => node.id === "replan-1"
      ? { ...node, status: "passed" as const, attempts: 1 }
      : node),
  };
  const result = materializeGraphPlan(runWithPassedReplanner, {
    nodes: [{
      id: "fix-review-feedback",
      title: "Fix review feedback",
      kind: "implement",
      writeFiles: ["src/feature.ts"],
      maxAttempts: 2,
    }, {
      id: "test-review-feedback",
      title: "Test review feedback",
      kind: "test",
      dependsOn: ["fix-review-feedback"],
      writeFiles: ["src/test/feature.test.ts"],
    }],
    edges: [{
      from: "review",
      to: "fix-review-feedback",
      kind: "evidence_for",
      metadata: {
        evidenceRef: "nodes/review.md",
        rationale: "Review failure drives the continuation plan.",
      },
    }, {
      from: "fix-review-feedback",
      to: "test-review-feedback",
      kind: "depends_on",
    }],
  }, {
    plannerNodeId: "replan-1",
    mode: "append",
    now: () => 4,
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.plannedNodeIds, ["fix-review-feedback", "test-review-feedback", "replan-1-summary"]);
  assert.deepEqual(result.run.nodes.map((node) => node.id), [
    GRAPH_AI_PLANNER_NODE_ID,
    "implement",
    "review",
    "replan-1",
    "fix-review-feedback",
    "test-review-feedback",
    "replan-1-summary",
  ]);
  assert.deepEqual(result.run.nodes.find((node) => node.id === "fix-review-feedback")?.dependsOn, ["replan-1"]);
  assert.deepEqual(result.run.nodes.find((node) => node.id === "test-review-feedback")?.dependsOn, ["fix-review-feedback", "replan-1"]);
  assert.deepEqual(result.run.nodes.find((node) => node.id === "replan-1-summary")?.dependsOn, ["test-review-feedback"]);
  assert.equal(result.run.nodes.find((node) => node.id === "replan-1")?.unlocks.includes("fix-review-feedback"), true);
  assert.equal(result.run.edges.some((edge) => edge.from === "review" && edge.to === "fix-review-feedback" && edge.kind === "evidence_for"), true);

  const collision = materializeGraphPlan(runWithPassedReplanner, {
    nodes: [{
      id: "review",
      title: "Overwrite old review",
      kind: "review",
    }],
  }, {
    plannerNodeId: "replan-1",
    mode: "append",
  });
  assert.equal(collision.changed, false);
  assert.match(collision.error ?? "", /must only add new node ids/u);
});

test("keeps inferred maxConcurrent conservative for explicit conflicts while allowing unscoped roots", () => {
  const plannedGraph: GraphPlannedGraphSpec = {
    nodes: [{
      id: "implement-api",
      title: "Implement API",
      kind: "implement",
      writeFiles: ["src/api"],
      conflictGroup: "api",
    }, {
      id: "implement-api-routes",
      title: "Implement API routes",
      kind: "implement",
      writeFiles: ["src/api/routes.ts"],
    }, {
      id: "implement-api-docs",
      title: "Implement API docs",
      kind: "implement",
      writeFiles: ["docs/api.md"],
      conflictGroup: "api",
    }, {
      id: "implement-unknown",
      title: "Implement unknown",
      kind: "implement",
    }],
  };

  const result = materializeGraphPlan(createRun([passedPlanner()], [], { maxConcurrent: 1 }), plannedGraph, { now: () => 2 });

  assert.equal(result.changed, true);
  assert.equal(result.error, undefined);
  assert.equal(result.run.maxConcurrent, 2);
});

test("rejects invalid planner graphs instead of falling back to a fixed linear graph", () => {
  assert.equal(normalizeGraphPlannedGraphSpec({
    nodes: [{
      id: "bad id with spaces",
      title: "Bad id",
      kind: "implement",
    }],
  }), null);
  assert.equal(normalizeGraphPlannedGraphSpec({
    nodes: [{
      id: "source",
      title: "Source",
      kind: "implement",
    }, {
      id: "target",
      title: "Target",
      kind: "test",
    }],
    edges: [{
      from: "source",
      to: "target",
      kind: "if_pass",
      conditionExpression: {
        type: "source_status",
        operator: "not-supported",
      } as never,
    }],
  }), null);

  const duplicateResult = materializeGraphPlan(createRun([passedPlanner()]), {
    nodes: [{
      id: "implement",
      title: "Implement A",
      kind: "implement",
    }, {
      id: "implement",
      title: "Implement B",
      kind: "implement",
    }],
  });
  assert.equal(duplicateResult.changed, false);
  assert.match(duplicateResult.error ?? "", /duplicate node id implement/u);

  const humanGateResult = materializeGraphPlan(createRun([passedPlanner()]), {
    nodes: [{
      id: "approve",
      title: "Approve",
      kind: "human_gate",
    }],
  });
  assert.equal(humanGateResult.changed, false);
  assert.match(humanGateResult.error ?? "", /must not include human_gate/u);

  const humanEdgeResult = materializeGraphPlan(createRun([passedPlanner()]), {
    nodes: [{
      id: "source",
      title: "Source",
      kind: "implement",
    }, {
      id: "target",
      title: "Target",
      kind: "review",
    }],
    edges: [{
      from: "source",
      to: "target",
      kind: "human_approved",
    }],
  });
  assert.equal(humanEdgeResult.changed, false);
  assert.match(humanEdgeResult.error ?? "", /must not require human approval/u);

  const manualConditionResult = materializeGraphPlan(createRun([passedPlanner()]), {
    nodes: [{
      id: "source",
      title: "Source",
      kind: "implement",
    }, {
      id: "target",
      title: "Target",
      kind: "review",
    }],
    edges: [{
      from: "source",
      to: "target",
      kind: "if_pass",
      conditionExpression: { type: "manual" },
    }],
  });
  assert.equal(manualConditionResult.changed, false);
  assert.match(manualConditionResult.error ?? "", /manual conditions/u);

  const cycleResult = materializeGraphPlan(createRun([passedPlanner()]), {
    nodes: [{
      id: "a",
      title: "A",
      kind: "implement",
      dependsOn: ["b"],
    }, {
      id: "b",
      title: "B",
      kind: "test",
      dependsOn: ["a"],
    }],
  });
  assert.equal(cycleResult.changed, false);
  assert.match(cycleResult.error ?? "", /dependency cycle/u);
});
