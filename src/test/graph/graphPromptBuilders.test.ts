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
    maxConcurrent: 5,
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
  assert.match(prompt, /Graph 模式默认不触发长期记忆写入/u);
  assert.match(prompt, /只能读取已有仓库记忆或运行态 recall/u);
  assert.match(prompt, /长期记忆沉淀只由主智能体/u);
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
  assert.match(prompt, /"status":"passed\|failed"/u);
});

test("node prompt includes graph-level model routing and node fallback records", () => {
  const node = createNode({
    modelRole: "subtask",
    model: "opencode-executor",
    modelFallback: "subtask model missing; using main model",
  });
  const run = createRun([node], [], {
    cli: "opencode",
    modelRouting: {
      planner: {
        role: "main",
        model: "opencode-main",
      },
      executor: {
        role: "subtask",
        model: "opencode-executor",
        fallback: "subtask model missing; using main model",
      },
    },
  });
  const prompt = buildGraphNodePrompt({ run, node });

  assert.match(prompt, /Planner model role：main/u);
  assert.match(prompt, /Planner model used：opencode-main/u);
  assert.match(prompt, /Execution node model role：subtask/u);
  assert.match(prompt, /Execution node model used：opencode-executor/u);
  assert.match(prompt, /Execution node model fallback：subtask model missing; using main model/u);
  assert.match(prompt, /Model role：subtask/u);
  assert.match(prompt, /Model used：opencode-executor/u);
  assert.match(prompt, /Model fallback：subtask model missing; using main model/u);
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
  assert.match(prompt, /默认先寻找可并行分支/u);
  assert.match(prompt, /不要仅因为任务在列表中靠后/u);
  assert.match(prompt, /fan-out 并行开始/u);
  assert.match(prompt, /重构\/迁移\/拆模块任务必须显式检查旧测试契约/u);
  assert.match(prompt, /source-contract、文本快照、路径断言、测试里的 canonical source/u);
  assert.match(prompt, /test adaptation\/契约更新节点/u);
  assert.match(prompt, /声明具体测试 writeFiles/u);
  assert.match(prompt, /无写权限的 test 验证节点/u);
  assert.match(prompt, /stale_test_contract/u);
  assert.match(prompt, /missing_write_scope/u);
  assert.match(prompt, /完整单测、全仓测试、全量 lint/u);
  assert.match(prompt, /blocking:false/u);
  assert.match(prompt, /"blocking":false/u);
  assert.match(prompt, /"title":"运行完整单测"/u);
  assert.match(prompt, /adapt-schema-contract-tests/u);
  assert.match(prompt, /writeFiles=\["src\/test\/test-schema-definitions\.test\.js"\]/u);
  assert.match(prompt, /返工到 `adapt-schema-contract-tests`/u);
  assert.match(prompt, /plannedGraph\.maxConcurrent 应设置为首批无冲突可执行分支数量/u);
  assert.match(prompt, /plannedGraph\.nodes\[\]\.title 必须使用简洁中文/u);
  assert.match(prompt, /"title":"实现 API 改动"/u);
  assert.match(prompt, /"title":"实现 UI 改动"/u);
  assert.match(prompt, /"title":"验证 API 行为"/u);
  assert.match(prompt, /"title":"验证 UI 行为"/u);
  assert.match(prompt, /"title":"评审并行结果"/u);
  assert.doesNotMatch(prompt, /"title":"Implement API changes"/u);
  assert.match(prompt, /plannedGraph\.nodes 不得包含保留 ID `plan`/u);
});

test("replanner prompt requires appending continuation nodes inside the current graph", () => {
  const review = createNode({
    id: "review",
    title: "评审功能结果",
    kind: "review",
    status: "failed",
    ownerRole: "reviewer",
    writeFiles: [],
    conflictGroup: undefined,
    dependsOn: ["implement-1"],
    unlocks: ["replan-1"],
    lastError: "审核失败：缺少验证。",
  });
  const replanner = createNode({
    id: "replan-1",
    title: "重新规划 Graph 续跑",
    kind: "plan",
    status: "pending",
    ownerRole: "main",
    writeFiles: [],
    conflictGroup: "graph:run-1:replanning",
    dependsOn: [],
    unlocks: [],
  });
  const run = createRun([review, replanner], [{
    id: "edge-review-replan",
    from: "review",
    to: "replan-1",
    kind: "if_fail",
    active: true,
  }]);

  const prompt = buildGraphNodePrompt({
    run,
    node: replanner,
    options: { generatedAt: "2026-08-11T00:00:00.000Z" },
  });

  assert.match(prompt, /AI Replanner 节点专用要求/u);
  assert.match(prompt, /当前 Graph run 内追加节点继续执行，而不是新建 Graph run/u);
  assert.match(prompt, /plannedGraph 必须是增量/u);
  assert.match(prompt, /不得重写、覆盖、重命名或删除当前图中已有节点/u);
  assert.match(prompt, /不得让新增边指向已有节点/u);
  assert.match(prompt, /failed\/blocked 旧节点到新增节点应优先使用 evidence_for 或 if_fail，不要用 depends_on/u);
  assert.match(prompt, /当前失败\/阻塞节点：review（评审功能结果｜review｜failed）/u);
  assert.match(prompt, /所有新增节点都会自动依赖当前 replanner 节点 `replan-1`/u);
  assert.match(prompt, /不要把 failed\/blocked 旧节点写成 depends_on 结构依赖/u);
  assert.match(prompt, /不要复用旧 summary 节点/u);
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
    rework: {
      sourceNodeId: "review-ui",
      targetNodeId: "implement-ui",
      resetAt: 6_000,
      resetScopeNodeIds: ["implement-ui", "test-ui", "review-ui"],
      reason: "Review feedback rollback.",
      edgeId: "review-feedback-ui",
      edgeKind: "review_feedback",
    },
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
    conditionExpression: {
      type: "source_status",
      operator: "equals",
      status: "passed",
      description: "测试通过后评审。",
    },
    active: true,
  }, {
    id: "edge-review-summary",
    from: "review-ui",
    to: "summary-1",
    kind: "evidence_for",
    metadata: {
      evidenceRef: "nodes/review-ui.md",
      rationale: "评审结论作为 summary 证据。",
    },
    active: true,
  }, {
    id: "review-feedback-ui",
    from: "review-ui",
    to: "implement-ui",
    kind: "review_feedback",
    metadata: {
      feedbackReason: "Review feedback rollback.",
      reworkTargetNodeId: "implement-ui",
      reworkScopeNodeIds: ["implement-ui", "test-ui", "review-ui"],
    },
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
  assert.match(prompt, /### 边语义/u);
  assert.match(prompt, /review_feedback \/ if_fail 可作为返工路径/u);
  assert.match(prompt, /evidence_for 是证据追踪边/u);
  assert.match(prompt, /edge-test-review｜test-ui -> review-ui；kind=if_pass；active=true；label=未声明；condition=测试通过后评审；conditionExpression=type=source_status/u);
  assert.match(prompt, /edge-review-summary｜review-ui -> summary-1；kind=evidence_for；active=true/u);
  assert.match(prompt, /metadata=rationale=评审结论作为 summary 证据。；evidenceRef=nodes\/review-ui\.md/u);
  assert.match(prompt, /review-feedback-ui｜review-ui -> implement-ui；kind=review_feedback/u);
  assert.match(prompt, /reworkTargetNodeId=implement-ui/u);
  assert.match(prompt, /Rework source：review-ui/u);
  assert.match(prompt, /Rework reason：Review feedback rollback/u);
  assert.match(prompt, /Rework scope：implement-ui、test-ui、review-ui/u);
  assert.match(prompt, /同批\/并发中的其他节点：implement-docs（同步 Graph 文档｜implement｜running）/u);
  assert.match(prompt, /图中已有后续 test 节点：test-ui（验证运行图节点态｜test｜pending）/u);
  assert.match(prompt, /不替代这些测试节点完成完整验证/u);
  assert.match(prompt, /图中已有后续 review 节点：review-ui/u);
  assert.match(prompt, /图中已有后续 summary 节点：summary-1/u);
  assert.match(prompt, /只产出本节点证据/u);
});

test("node prompt ignores polluted materialized unlocks from rework edges while listing every edge", () => {
  const plan = createNode({
    id: "plan",
    title: "规划 Graph 控制",
    kind: "plan",
    status: "passed",
    ownerRole: "main",
    writeFiles: [],
    conflictGroup: undefined,
    dependsOn: [],
    unlocks: ["implement"],
  });
  const implement = createNode({
    id: "implement",
    title: "实现 Graph 控制",
    status: "running",
    dependsOn: ["plan"],
    unlocks: ["test"],
    writeFiles: ["src/graph/graphRunControl.ts"],
  });
  const testNode = createNode({
    id: "test",
    title: "验证 Graph 控制",
    kind: "test",
    status: "pending",
    dependsOn: ["implement"],
    unlocks: ["implement"],
  });
  const review = createNode({
    id: "review",
    title: "评审 Graph 控制",
    kind: "review",
    status: "failed",
    ownerRole: "reviewer",
    dependsOn: [],
    unlocks: ["implement"],
  });
  const evidence = createNode({
    id: "audit",
    title: "审计证据节点",
    kind: "intake",
    status: "passed",
    dependsOn: [],
    unlocks: [],
  });
  const summary = createNode({
    id: "summary",
    title: "总结 Graph 控制",
    kind: "summary",
    status: "pending",
    ownerRole: "main",
    dependsOn: [],
    unlocks: [],
  });
  const run = createRun([plan, implement, testNode, review, evidence, summary], [{
    id: "edge-audit-implement",
    from: "audit",
    to: "implement",
    kind: "evidence_for",
    active: true,
    metadata: {
      evidenceRef: "nodes/audit.md",
      rationale: "审计证据供实现参考。",
    },
  }, {
    id: "edge-review-feedback",
    from: "review",
    to: "implement",
    kind: "review_feedback",
    active: true,
    metadata: {
      feedbackReason: "Review feedback asks implementation rework.",
      reworkTargetNodeId: "implement",
    },
  }, {
    id: "edge-test-rework",
    from: "test",
    to: "implement",
    kind: "if_fail",
    active: true,
    conditionExpression: {
      type: "source_status",
      operator: "equals",
      status: "failed",
      description: "Focused test failure triggers contract rework.",
    },
    metadata: {
      feedbackReason: "Focused test failed after contract drift.",
      reworkTargetNodeId: "implement",
      reworkScopeNodeIds: ["implement", "test"],
    },
  }, {
    id: "edge-inactive-summary",
    from: "implement",
    to: "summary",
    kind: "if_pass",
    active: false,
    condition: "Inactive summary edge.",
  }]);

  const prompt = buildGraphNodePrompt({
    run,
    node: implement,
    options: { generatedAt: "2026-08-29T00:00:00.000Z" },
  });
  const topologySummary = prompt.slice(0, prompt.indexOf("### 节点清单"));

  assert.match(topologySummary, /直接前置节点：plan（规划 Graph 控制｜plan｜passed）/u);
  assert.match(topologySummary, /直接后续节点：test（验证 Graph 控制｜test｜pending）/u);
  assert.match(topologySummary, /上游链路：plan（规划 Graph 控制｜plan｜passed）/u);
  assert.match(topologySummary, /下游链路：test（验证 Graph 控制｜test｜pending）/u);
  assert.doesNotMatch(topologySummary, /审计证据节点|评审 Graph 控制|总结 Graph 控制/u);
  assert.match(prompt, /\[全图\] test｜验证 Graph 控制；kind=test；status=pending；[^\n]*unlocks=implement/u);
  assert.match(prompt, /\[全图\] review｜评审 Graph 控制；kind=review；status=failed；[^\n]*unlocks=implement/u);
  assert.match(prompt, /edge-audit-implement｜audit -> implement；kind=evidence_for；active=true/u);
  assert.match(prompt, /edge-review-feedback｜review -> implement；kind=review_feedback；active=true/u);
  assert.match(prompt, /edge-test-rework｜test -> implement；kind=if_fail；active=true/u);
  assert.match(prompt, /metadata=feedbackReason=Focused test failed after contract drift\.；reworkTargetNodeId=implement；reworkScopeNodeIds=implement,test/u);
  assert.match(prompt, /edge-inactive-summary｜implement -> summary；kind=if_pass；active=false/u);
});

test("review node prompt scopes review to upstream task files instead of unrelated dirty workspace", () => {
  const implement = createNode({
    id: "implement-feature",
    title: "实现 Graph 评审范围",
    kind: "implement",
    status: "passed",
    ownerRole: "subtask",
    artifactRef: "artifacts/implement-feature.md",
    communicationFile: "/tmp/graph/nodes/implement-feature.md",
    writeFiles: ["src/graph/graphPromptBuilders.ts"],
    dependsOn: [],
    unlocks: ["test-feature"],
  });
  const testNode = createNode({
    id: "test-feature",
    title: "验证 Graph 评审范围",
    kind: "test",
    status: "passed",
    ownerRole: "subtask",
    artifactRef: "artifacts/test-feature.md",
    communicationFile: "/tmp/graph/nodes/test-feature.md",
    writeFiles: ["src/test/graphPromptBuilders.test.ts"],
    dependsOn: ["implement-feature"],
    unlocks: ["review-feature"],
  });
  const review = createNode({
    id: "review-feature",
    title: "评审 Graph 评审范围",
    kind: "review",
    status: "pending",
    ownerRole: "reviewer",
    artifactRef: "artifacts/review-feature.md",
    communicationFile: "/tmp/graph/nodes/review-feature.md",
    writeFiles: [],
    dependsOn: ["test-feature"],
    unlocks: ["summary-feature"],
  });
  const summary = createNode({
    id: "summary-feature",
    title: "总结 Graph 评审范围",
    kind: "summary",
    status: "pending",
    ownerRole: "system",
    writeFiles: [],
    dependsOn: ["review-feature"],
    unlocks: [],
  });
  const run = createRun([implement, testNode, review, summary]);

  const prompt = buildGraphNodePrompt({
    run,
    node: review,
    options: { generatedAt: "2026-07-29T00:00:00.000Z" },
  });

  assert.match(prompt, /## Review 节点评审范围/u);
  assert.match(prompt, /范围来源节点：test-feature（验证 Graph 评审范围｜test｜passed）、implement-feature（实现 Graph 评审范围｜implement｜passed）/u);
  assert.match(prompt, /本次任务候选改动文件：src\/test\/graphPromptBuilders\.test\.ts、src\/graph\/graphPromptBuilders\.ts/u);
  assert.match(prompt, /artifacts\/test-feature\.md、\/tmp\/graph\/nodes\/test-feature\.md/u);
  assert.match(prompt, /artifacts\/implement-feature\.md、\/tmp\/graph\/nodes\/implement-feature\.md/u);
  assert.match(prompt, /加 pathspec 过滤/u);
  assert.match(prompt, /范围外路径，默认视为同一 workspace 中的无关改动/u);
  assert.match(prompt, /不得单独导致 failed/u);
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
  assert.match(prompt, /不得把 failed、历史 blocked、stopped、skipped 或未验证节点描述为成功完成/u);
  assert.match(prompt, /finalAnswer/u);
  assert.match(prompt, /implement-1｜implement｜passed｜Implementation/u);
  assert.match(prompt, /test-1｜test｜failed｜Validation/u);
  assert.match(prompt, /lastError：Tests failed/u);
  assert.match(prompt, /unresolved/u);
});
