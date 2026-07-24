import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildGraphNodePrompt,
  buildGraphSummaryNodePrompt,
  resolveGraphNodeCommunicationFile,
} from "../graph/graphPromptBuilders";
import {
  GRAPH_SCHEMA_VERSION,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "../graph/types";

function createNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "implement-1",
    title: "Implement kernel adapter",
    kind: "implement",
    status: "pending",
    ownerRole: "subtask",
    promptRef: "prompts/implement-1.md",
    artifactRef: "artifacts/implement-1.md",
    communicationFile: "/tmp/graph/nodes/implement-1.md",
    writeFiles: ["src/graph/graphKernel.ts"],
    conflictGroup: "graph-kernel",
    maxAttempts: 2,
    attempts: 0,
    dependsOn: ["plan-1"],
    unlocks: ["test-1"],
    acceptance: [{
      name: "Kernel adapter compiles",
      required: true,
      detail: "npm run build passes",
    }],
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
    sessionId: "session-1",
    rootPrompt: "Build Graph mode from the design document.",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: "/tmp/graph-runs.json",
    nodes,
    edges,
    activeNodeIds: [],
    maxConcurrent: 6,
    eventsFile: "/tmp/graph/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
    ...overrides,
  };
}

test("builds a self-contained executable Graph node prompt with scope and acceptance", () => {
  const plan = createNode({
    id: "plan-1",
    title: "Plan Graph work",
    kind: "plan",
    status: "passed",
    ownerRole: "main",
    artifactRef: "artifacts/plan-1.md",
    writeFiles: [],
    conflictGroup: undefined,
    dependsOn: [],
  });
  const node = createNode();
  const run = createRun([plan, node], [], {
    supplementalRequirements: ["必须保持 Graph 并行调度语义。"],
  });
  const prompt = buildGraphNodePrompt({
    run,
    node,
    options: {
      generatedAt: "2026-07-23T00:00:00.000Z",
      validationRequirements: ["运行 npm run build。"],
    },
  });

  assert.match(prompt, /Graph run id：run-1/u);
  assert.match(prompt, /Node id：implement-1/u);
  assert.match(prompt, /Title：Implement kernel adapter/u);
  assert.match(prompt, /Kind：implement/u);
  assert.match(prompt, /Build Graph mode from the design document/u);
  assert.match(prompt, /用户补充消息/u);
  assert.match(prompt, /必须保持 Graph 并行调度语义/u);
  assert.match(prompt, /后续节点必须纳入判断和验收/u);
  assert.match(prompt, /writeFiles：src\/graph\/graphKernel\.ts/u);
  assert.match(prompt, /conflictGroup：graph-kernel/u);
  assert.match(prompt, /Depends on：plan-1/u);
  assert.match(prompt, /Prompt ref：prompts\/implement-1\.md/u);
  assert.match(prompt, /Artifact ref：artifacts\/implement-1\.md/u);
  assert.match(prompt, /Communication file：\/tmp\/graph\/nodes\/implement-1\.md/u);
  assert.match(prompt, /Kernel adapter compiles/u);
  assert.match(prompt, /运行 npm run build/u);
  assert.match(prompt, /禁止越权/u);
  assert.match(prompt, /"status":"passed\|failed\|blocked"/u);
});

test("derives a node communication file when the node does not declare one", () => {
  const node = createNode({
    id: "Node With Spaces",
    communicationFile: undefined,
  });
  const run = createRun([node]);

  assert.equal(
    resolveGraphNodeCommunicationFile(run, node),
    "/tmp/graph/nodes/Node_With_Spaces.md",
  );
  assert.match(buildGraphNodePrompt({ run, node }), /Communication file：\/tmp\/graph\/nodes\/Node_With_Spaces\.md/u);
});

test("planner prompt requires an AI planned DAG instead of a fixed linear graph", () => {
  const planner = createNode({
    id: "plan",
    title: "规划 Graph DAG 执行",
    kind: "plan",
    status: "pending",
    ownerRole: "main",
    writeFiles: [],
    conflictGroup: undefined,
    dependsOn: [],
    unlocks: [],
  });
  const prompt = buildGraphNodePrompt({
    run: createRun([planner]),
    node: planner,
    options: { generatedAt: "2026-07-24T00:00:00.000Z" },
  });

  assert.match(prompt, /AI Planner 节点专用要求/u);
  assert.match(prompt, /plannedGraph/u);
  assert.match(prompt, /不能固定输出线形/u);
  assert.match(prompt, /并行分支、依赖边、验证节点、评审节点/u);
  assert.match(prompt, /plannedGraph\.nodes\[\]\.title 必须使用简洁中文/u);
  assert.match(prompt, /"title":"实现 API 改动"/u);
  assert.match(prompt, /"title":"验证 API 行为"/u);
  assert.doesNotMatch(prompt, /"title":"Implement API changes"/u);
  assert.match(prompt, /plannedGraph\.nodes 不得包含保留 ID `plan`/u);
});

test("node prompt includes the full graph topology, current position, and downstream boundaries", () => {
  const plan = createNode({
    id: "plan-1",
    title: "规划 Graph DAG",
    kind: "plan",
    status: "passed",
    ownerRole: "main",
    writeFiles: [],
    conflictGroup: undefined,
    dependsOn: [],
    unlocks: ["implement-ui", "implement-docs"],
  });
  const implement = createNode({
    id: "implement-ui",
    title: "实现运行图节点态",
    status: "running",
    dependsOn: ["plan-1"],
    unlocks: ["test-ui"],
    writeFiles: ["src/webview/graphRunPanel*.ts"],
    conflictGroup: "graph-ui",
    acceptance: [{ name: "运行态 UI 改动完成且范围受控", required: true }],
  });
  const parallelDocs = createNode({
    id: "implement-docs",
    title: "同步 Graph 文档",
    status: "running",
    dependsOn: ["plan-1"],
    unlocks: ["summary-1"],
    writeFiles: [".ch/docs/**"],
    conflictGroup: "graph-docs",
  });
  const testNode = createNode({
    id: "test-ui",
    title: "验证运行图节点态",
    kind: "test",
    status: "pending",
    ownerRole: "subtask",
    dependsOn: ["implement-ui"],
    unlocks: ["review-ui"],
    writeFiles: ["src/test/graphRunPanel.test.ts"],
    conflictGroup: "graph-tests",
  });
  const reviewNode = createNode({
    id: "review-ui",
    title: "评审运行图结果",
    kind: "review",
    status: "pending",
    ownerRole: "reviewer",
    dependsOn: ["test-ui"],
    unlocks: ["summary-1"],
    writeFiles: [],
    conflictGroup: undefined,
  });
  const summary = createNode({
    id: "summary-1",
    title: "总结 Graph 运行结果",
    kind: "summary",
    status: "pending",
    ownerRole: "main",
    dependsOn: ["review-ui", "implement-docs"],
    unlocks: [],
    writeFiles: [],
    conflictGroup: undefined,
  });
  const run = createRun([plan, implement, parallelDocs, testNode, reviewNode, summary], [{
    id: "edge-plan-ui",
    from: "plan-1",
    to: "implement-ui",
    kind: "depends_on",
    active: true,
  }, {
    id: "edge-ui-test",
    from: "implement-ui",
    to: "test-ui",
    kind: "depends_on",
    active: true,
  }, {
    id: "edge-test-review",
    from: "test-ui",
    to: "review-ui",
    kind: "if_pass",
    condition: "测试通过后评审",
    active: true,
  }, {
    id: "edge-review-summary",
    from: "review-ui",
    to: "summary-1",
    kind: "evidence_for",
    active: true,
  }], {
    activeNodeIds: ["implement-ui", "implement-docs"],
  });
  const prompt = buildGraphNodePrompt({
    run,
    node: implement,
    options: { generatedAt: "2026-07-24T00:00:00.000Z" },
  });

  assert.match(prompt, /## 全图拓扑与当前位置/u);
  assert.match(prompt, /本节点不是 Loop 主智能体/u);
  assert.match(prompt, /当前节点位置：2\/6；implement-ui（实现运行图节点态）/u);
  assert.match(prompt, /\[当前\] implement-ui｜实现运行图节点态/u);
  assert.match(prompt, /\[全图\] test-ui｜验证运行图节点态/u);
  assert.match(prompt, /edge-ui-test｜implement-ui -> test-ui；kind=depends_on；active=true/u);
  assert.match(prompt, /edge-test-review｜test-ui -> review-ui；kind=if_pass；active=true；condition=测试通过后评审/u);
  assert.match(prompt, /同批\/并发中的其他节点：implement-docs（同步 Graph 文档｜implement｜running）/u);
  assert.match(prompt, /图中已有后续 test 节点：test-ui（验证运行图节点态｜test｜pending）/u);
  assert.match(prompt, /不替代这些测试节点完成完整验证/u);
  assert.match(prompt, /图中已有后续 review 节点：review-ui/u);
  assert.match(prompt, /图中已有后续 summary 节点：summary-1/u);
  assert.match(prompt, /只产出本节点证据/u);
});

test("summary node prompt requires events, node artifacts, evidence, and unresolved failures", () => {
  const passed = createNode({
    id: "implement-1",
    title: "Implementation",
    status: "passed",
    artifactRef: "artifacts/implementation.md",
  });
  const failed = createNode({
    id: "test-1",
    title: "Validation",
    kind: "test",
    status: "failed",
    ownerRole: "reviewer",
    attempts: 1,
    maxAttempts: 2,
    artifactRef: "artifacts/test.md",
    lastError: "Tests failed",
  });
  const summary = createNode({
    id: "summary-1",
    title: "Final Graph summary",
    kind: "summary",
    status: "pending",
    ownerRole: "main",
    communicationFile: "/tmp/graph/nodes/summary-1.md",
    writeFiles: [],
    conflictGroup: undefined,
    dependsOn: ["implement-1", "test-1"],
  });
  const run = createRun([passed, failed, summary]);
  const prompt = buildGraphSummaryNodePrompt(run, summary, { generatedAt: "2026-07-23T00:00:00.000Z" });

  assert.match(prompt, /必须读取 events file：\/tmp\/graph\/events\.jsonl/u);
  assert.match(prompt, /必须读取 graph snapshot：\/tmp\/graph\/graph\.json/u);
  assert.match(prompt, /不得把 failed、blocked、stopped、skipped 或未验证节点描述为成功完成/u);
  assert.match(prompt, /finalAnswer/u);
  assert.match(prompt, /implement-1｜implement｜passed｜Implementation/u);
  assert.match(prompt, /test-1｜test｜failed｜Validation/u);
  assert.match(prompt, /lastError：Tests failed/u);
  assert.match(prompt, /unresolved/u);
});
