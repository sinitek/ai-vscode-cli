import * as assert from "node:assert/strict";
import { test } from "node:test";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

import { buildGraphRunPanelStateWithDeps } from "../panelStateBuilder";
import {
  buildGraphRunPanelHtml,
} from "../webview/graphRunPanel";
import { getGraphRunPanelStrings } from "../webview/graphRunPanelRenderer";
import { GRAPH_RUN_PANEL_STYLES } from "../webview/graphRunPanelStyles";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";
import type { GraphEventRecord, GraphNodeRecord, GraphRunRecord } from "../graph/types";

function createNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "plan",
    title: "Plan work",
    kind: "plan",
    status: "passed",
    ownerRole: "main",
    maxAttempts: 1,
    attempts: 1,
    dependsOn: [],
    unlocks: ["implement"],
    acceptance: [{ name: "Plan accepted", required: true, passed: true }],
    ...overrides,
  };
}

function createRun(overrides: Partial<GraphRunRecord> = {}): GraphRunRecord {
  return {
    id: "graph-1",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Build a Graph panel",
    status: "running",
    createdAt: 1_000,
    updatedAt: 2_000,
    graphVersion: 1,
    runStoreFile: "/tmp/graph-runs.json",
    nodes: [
      createNode(),
      createNode({
        id: "implement",
        title: "Implement panel",
        kind: "implement",
        status: "running",
        ownerRole: "subtask",
        attempts: 1,
        maxAttempts: 2,
        dependsOn: ["plan"],
        unlocks: ["test"],
        writeFiles: ["src/webview/graphRunPanel.ts"],
        artifactRef: "/tmp/artifact.md",
        promptRef: "/tmp/prompt.md",
        communicationFile: "/tmp/node.md",
      }),
      createNode({
        id: "test",
        title: "Run tests",
        kind: "test",
        status: "blocked",
        ownerRole: "reviewer",
        attempts: 0,
        maxAttempts: 1,
        dependsOn: ["implement"],
        unlocks: [],
        lastError: "waiting for build",
      }),
    ],
    edges: [],
    activeNodeIds: ["implement"],
    maxConcurrent: 1,
    eventsFile: "/tmp/events.jsonl",
    communicationDir: "/tmp/graph",
    mainCommunicationFile: "/tmp/graph/main.md",
    graphFile: "/tmp/graph/graph.json",
    finalAnswer: {
      conclusion: "In progress",
      summary: "Graph run is still running.",
      evidence: ["plan:Plan work"],
      unresolved: ["test:blocked"],
    },
    ...overrides,
  };
}

function createSerialFiveNodeRun(): GraphRunRecord {
  const ids = ["plan", "implement", "test", "review", "summary"] as const;
  const kinds = {
    plan: "plan",
    implement: "implement",
    test: "test",
    review: "review",
    summary: "summary",
  } as const;
  const nodes = ids.map((id, index) => createNode({
    id,
    title: id,
    kind: kinds[id],
    status: index === ids.length - 1 ? "ready" : "passed",
    ownerRole: index === 0 ? "main" : "subtask",
    attempts: index === ids.length - 1 ? 0 : 1,
    dependsOn: index === 0 ? [] : [ids[index - 1]],
    unlocks: index === ids.length - 1 ? [] : [ids[index + 1]],
  }));
  return createRun({ nodes, edges: [] });
}

function createEvent(overrides: Partial<GraphEventRecord> = {}): GraphEventRecord {
  return {
    eventId: "event-1",
    runId: "graph-1",
    type: "node.started",
    timestamp: 3_000,
    nodeId: "implement",
    attempt: 1,
    summary: "Implement started",
    ...overrides,
  };
}

function buildState(run: GraphRunRecord, selectedNodeId?: string | null) {
  return buildGraphRunPanelStateWithDeps(run, [], {
    strings: getGraphRunPanelStrings("en"),
    selectedNodeId,
  });
}

test("builds Graph run panel state with status stats, selected node, events, edges, and i18n labels", () => {
  const state = buildGraphRunPanelStateWithDeps(
    createRun(),
    [
      createEvent({ eventId: "older", timestamp: 2_500, summary: "older" }),
      createEvent({ eventId: "newer", timestamp: 3_500, type: "node.blocked", summary: "newer" }),
    ],
    { strings: getGraphRunPanelStrings("en") },
  );

  assert.equal(state.run.statusLabel, "Running");
  assert.equal(state.stats.total, 3);
  assert.deepEqual(state.stats.statusCounts.map((item) => [item.status, item.count]), [
    ["running", 1],
    ["passed", 1],
    ["blocked", 1],
  ]);
  assert.equal(state.selectedNodeId, "implement");
  assert.equal(state.selectedNode?.artifactRef, "/tmp/artifact.md");
  assert.equal(state.nodes.find((node) => node.id === "plan")?.title, "规划工作");
  assert.equal(state.nodes.find((node) => node.id === "implement")?.title, "实现面板");
  assert.equal(state.nodes.find((node) => node.id === "test")?.title, "运行测试");
  assert.equal(state.nodes.find((node) => node.id === "implement")?.status, "running");
  assert.equal(state.nodes.find((node) => node.id === "test")?.lastError, "waiting for build");
  assert.deepEqual(state.events.map((event) => event.eventId), ["newer", "older"]);
  assert.deepEqual(state.edges.map((edge) => [edge.from, edge.to, edge.kind]), [
    ["plan", "implement", "depends_on"],
    ["implement", "test", "depends_on"],
  ]);
});

test("prefers run.edges over dependsOn fallback and honors requested node selection", () => {
  const state = buildGraphRunPanelStateWithDeps(
    createRun({
      edges: [{
        id: "review-feedback",
        from: "test",
        to: "implement",
        kind: "review_feedback",
        condition: "tests failed",
        active: true,
      }],
    }),
    [],
    { strings: getGraphRunPanelStrings("en"), selectedNodeId: "test" },
  );

  assert.equal(state.selectedNodeId, "test");
  assert.deepEqual(state.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    condition: edge.condition,
  })), [{
    id: "review-feedback",
    from: "test",
    to: "implement",
    kind: "review_feedback",
    condition: "tests failed",
  }]);
});

test("renders a true visual DAG with SVG edges, arrow marker, node buttons, aria labels, and status", () => {
  const state = buildState(createSerialFiveNodeRun(), "review");
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, state, "en");

  assert.match(html, /class="content graph-split"/);
  assert.match(html, /class="section graph-dag"/);
  assert.match(html, /<svg class="dag-edges"/);
  assert.match(html, /marker id="graph-arrowhead"/);
  assert.match(html, /class="dag-edge-path active edge-kind-depends_on"/);
	  assert.equal((html.match(/class="dag-edge-path/g) ?? []).length, 4);
	  assert.match(html, /<button[\s\S]*class="dag-node node-select-target selected status-passed kind-review"/);
	  assert.match(html, /height: 58px/);
	  assert.match(html, /aria-label="Node 评审, status Passed, kind Review/);
	  assert.match(html, /data-node-id="plan"[\s\S]*data-node-id="implement"[\s\S]*data-node-id="test"[\s\S]*data-node-id="review"[\s\S]*data-node-id="summary"/);
	  assert.match(html, /data-node-detail="review"/);
	  assert.doesNotMatch(html, /dag-node-meta/);
	  assert.doesNotMatch(html, /class="sidebar"|class="node-list"/);
	  assert.doesNotMatch(html, />\s*(Overview|Status Statistics|Final Answer|Recent Events)\s*</);
	  assert.doesNotMatch(html, />\s*(Retry|Approve|Continue|Stop)\s*</);
});

test("renders only wired and currently available Graph run and node controls", () => {
  const state = buildGraphRunPanelStateWithDeps(
    createRun({
      status: "needs-review",
      activeNodeIds: [],
      nodes: [
        createNode({
          id: "fix",
          title: "Fix failed node",
          status: "failed",
          attempts: 1,
          maxAttempts: 1,
          dependsOn: [],
          unlocks: [],
        }),
	        createNode({
	          id: "gate",
	          title: "Approve deployment",
	          kind: "human_gate",
          status: "ready",
          ownerRole: "human",
          attempts: 0,
          dependsOn: [],
	          unlocks: [],
	        }),
	        createNode({
	          id: "impl",
	          title: "Implement upstream",
	          kind: "implement",
	          status: "passed",
	          attempts: 1,
	          maxAttempts: 1,
	          dependsOn: [],
	          unlocks: ["failed-test"],
	          baseCommit: "base",
	          commit: "impl-commit",
	        }),
	        createNode({
	          id: "failed-test",
	          title: "Validate implementation",
	          kind: "test",
	          status: "failed",
	          attempts: 1,
	          maxAttempts: 1,
	          dependsOn: ["impl"],
	          unlocks: [],
	        }),
	      ],
	      worktree: {
	        cwd: "/tmp/graph-worktree",
	        branch: "sinitek-graph-test",
	        baseCommit: "base",
	      },
	    }),
    [],
    {
      strings: getGraphRunPanelStrings("en"),
      selectedNodeId: "fix",
      controls: {
        continueRun: true,
	        supplementRun: true,
	        retryNode: true,
	        feedbackNode: true,
	        approveHumanGate: true,
	        stopRun: true,
	      },
    },
  );
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, state, "en");

  assert.equal(state.runControl.canContinue, true);
  assert.equal(state.runControl.canSupplement, true);
	  assert.equal(state.runControl.canStop, true);
	  assert.equal(state.nodes.find((node) => node.id === "fix")?.control.canRetry, true);
	  assert.equal(state.nodes.find((node) => node.id === "failed-test")?.control.canFeedback, true);
	  assert.equal(state.nodes.find((node) => node.id === "gate")?.control.canApprove, true);
  assert.match(html, /data-action="continue"[\s\S]*>Continue</);
  assert.match(html, /data-action="supplement"[\s\S]*>I want to speak</);
	  assert.match(html, /data-action="stop"[\s\S]*>Stop Run</);
	  assert.match(html, /data-action="retry" data-control-node-id="fix"[\s\S]*>Retry Failed Node</);
	  assert.match(html, /data-action="feedback" data-control-node-id="failed-test"[\s\S]*>Rollback Upstream</);
	  assert.match(html, /data-action="approve" data-control-node-id="gate"[\s\S]*>Approve Human Gate</);
  assert.match(html, /graphRun:continue/);
	  assert.match(html, /graphRun:supplementRun/);
	  assert.match(html, /graphRun:retryNode/);
	  assert.match(html, /graphRun:feedbackNode/);
	  assert.match(html, /graphRun:approveHumanGate/);
  assert.match(html, /graphRun:stopRun/);

  const zhState = buildGraphRunPanelStateWithDeps(
    createRun({ supplementalRequirements: ["请优先验证并行节点。"] }),
    [],
    {
      strings: getGraphRunPanelStrings("zh-CN"),
      controls: { supplementRun: true },
    },
  );
  const zhHtml = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, zhState, "zh-CN");
  assert.match(zhHtml, /data-action="supplement"[\s\S]*>我要说话</);
  assert.match(zhHtml, /补充消息/);
  assert.match(zhHtml, /请优先验证并行节点。/);

  const hiddenState = buildGraphRunPanelStateWithDeps(
    createRun({ status: "completed" }),
    [],
    {
      strings: getGraphRunPanelStrings("en"),
      controls: {
        continueRun: true,
	        supplementRun: true,
	        retryNode: true,
	        feedbackNode: true,
	        approveHumanGate: true,
	        stopRun: true,
      },
    },
  );
  const hiddenHtml = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, hiddenState, "en");
	  assert.doesNotMatch(hiddenHtml, />\s*(Continue|I want to speak|Stop Run|Retry Failed Node|Rollback Upstream|Approve Human Gate)\s*</);
});

test("renders no-edge state with nodes and omits SVG for empty node state", () => {
  const isolated = createRun({
    nodes: [
      createNode({ id: "solo-a", title: "Solo A", unlocks: [] }),
      createNode({ id: "solo-b", title: "Solo B", dependsOn: [], unlocks: [] }),
    ],
    edges: [],
  });
  const isolatedHtml = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, buildState(isolated), "en");
  assert.match(isolatedHtml, /No active edges are recorded/);
  assert.match(isolatedHtml, /class="dag-node node-select-target/);

  const emptyState = buildGraphRunPanelStateWithDeps(
    createRun({ nodes: [], finalAnswer: undefined }),
    [],
    { strings: getGraphRunPanelStrings("zh-CN"), error: "事件读取失败" },
  );
  const emptyHtml = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, emptyState, "zh-CN");
  assert.match(emptyHtml, /<html lang="zh-CN">/);
  assert.match(emptyHtml, /Graph 运行图/);
  assert.match(emptyHtml, /事件读取失败/);
  assert.match(emptyHtml, /暂无 Graph 节点记录。/);
  assert.match(emptyHtml, /选择一个节点查看详情。/);
  assert.doesNotMatch(emptyHtml, /<svg class="dag-edges"/);
  assert.doesNotMatch(emptyHtml, /class="sidebar"|class="node-list"/);
});

test("keeps DAG visible when events read fails and keeps CSS on VS Code theme variables", () => {
  const state = buildGraphRunPanelStateWithDeps(
    createSerialFiveNodeRun(),
    [],
    { strings: getGraphRunPanelStrings("zh-CN"), error: "事件读取失败" },
  );
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, state, "zh-CN");

  assert.match(html, /class="section graph-dag"/);
  assert.match(html, /<svg class="dag-edges"/);
  assert.match(html, /事件读取失败/);
  assert.match(html, /var\(--vscode-editor-foreground\)/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /flex:\s*0 0 50%/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /flex:\s*1 1 50%/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /justify-content:\s*space-between/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /-webkit-line-clamp:\s*1/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /white-space:\s*normal/);
	  assert.doesNotMatch(GRAPH_RUN_PANEL_STYLES, /dag-node-meta/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node \.status-pill[\s\S]*flex:\s*0 0 auto/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.status-running::before[\s\S]*animation:\s*graph-running-border-flow/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /@keyframes graph-running-border-flow/);
  assert.doesNotMatch(`${GRAPH_RUN_PANEL_STYLES}\n${html}`, /#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(|hsla\(/);
});

test("keeps Graph webview i18n keys aligned between English and Chinese", () => {
  const englishKeys = Object.keys(WEBVIEW_I18N.en).sort();
  const chineseKeys = Object.keys(WEBVIEW_I18N["zh-CN"]).sort();
  assert.deepEqual(chineseKeys, englishKeys);
  assert.equal(WEBVIEW_I18N.en.interactiveModeGraph, "Graph");
  assert.equal(WEBVIEW_I18N["zh-CN"].openGraphRunAction, "打开 Graph 运行图");
});
