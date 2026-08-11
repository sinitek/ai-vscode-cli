import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

import { buildGraphRunPanelStateWithDeps } from "../panelStateBuilder";
import {
  buildGraphRunPanelDagLayoutForTest,
  buildGraphRunPanelHtml,
} from "../webview/graphRunPanel";
import { getGraphRunPanelStrings } from "../webview/graphRunPanelRenderer";
import { GRAPH_RUN_PANEL_STYLES } from "../webview/graphRunPanelStyles";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";
import type { GraphEventRecord, GraphNodeRecord, GraphRunRecord } from "../graph/types";

const packageJson = require("../../package.json") as {
  dependencies?: Record<string, string>;
};
const repositoryRoot = path.join(__dirname, "..", "..");
const vscodeIgnoreText = fs.readFileSync(path.join(repositoryRoot, ".vscodeignore"), "utf8");

const STOP_BOUNDARY_COPY_PATTERNS = [
  /Stop boundary/,
  /Stop always persists Graph run\/node state as stopped/,
  /only attempts to stop real CLI processes that are currently mapped to this Graph run/,
  /Stop 能力边界/,
  /Stop 一定会把 Graph 运行\/节点状态落盘为 stopped/,
  /只有当前存在 Graph 映射的活动 CLI 运行时/,
] as const;

function assertOmitsStopBoundaryCopy(html: string): void {
  STOP_BOUNDARY_COPY_PATTERNS.forEach((pattern) => {
    assert.doesNotMatch(html, pattern);
  });
}

type DagEdgePathAttrs = Record<string, string>;
type DagBox = { x: number; y: number; width: number; height: number };
type DagPoint = { x: number; y: number };
const DAG_EXPECTED_PORT_RATIOS = [0.25, 0.5, 0.75] as const;

function getVisibleEdgeLabels(html: string): string[] {
  return Array.from(html.matchAll(/<text class="dag-edge-label [^"]+"[^>]*>([^<]*)<\/text>/g))
    .map((match) => match[1]);
}

function getDagEdgeLabelAttrs(html: string): DagEdgePathAttrs[] {
  return Array.from(html.matchAll(/<text class="dag-edge-label [^"]+"[^>]*>[^<]*<\/text>/g))
    .map((match) => {
      const attrs: DagEdgePathAttrs = {};
      Array.from(match[0].matchAll(/\s([\w-]+)="([^"]*)"/g)).forEach((attrMatch) => {
        attrs[attrMatch[1]] = attrMatch[2];
      });
      return attrs;
    });
}

function getDagEdgePathAttrs(html: string): DagEdgePathAttrs[] {
  return Array.from(html.matchAll(/<path id="dag-edge-[^"]+" class="dag-edge-path[^>]*>/g))
    .map((match) => {
      const attrs: DagEdgePathAttrs = {};
      Array.from(match[0].matchAll(/\s([\w-]+)="([^"]*)"/g)).forEach((attrMatch) => {
        attrs[attrMatch[1]] = attrMatch[2];
      });
      return attrs;
    });
}

function getRequiredDagEdgePathAttrs(html: string, edgeId: string): DagEdgePathAttrs {
  const edge = getDagEdgePathAttrs(html).find((attrs) => attrs["data-edge-id"] === edgeId);
  assert.ok(edge, `Expected DAG edge ${edgeId}`);
  return edge;
}

function getDagNodeAttrs(html: string): DagEdgePathAttrs[] {
  return Array.from(html.matchAll(/<button\s+class="dag-node[^>]*>/g))
    .map((match) => {
      const attrs: DagEdgePathAttrs = {};
      Array.from(match[0].matchAll(/\s([\w-]+)="([^"]*)"/g)).forEach((attrMatch) => {
        attrs[attrMatch[1]] = attrMatch[2];
      });
      return attrs;
    });
}

function getDagNodeLayoutById(html: string): Map<string, DagBox> {
  return new Map(getDagNodeAttrs(html).map((attrs) => [
    attrs["data-node-id"],
    {
      x: readRequiredDagNumber(attrs, "data-auto-x"),
      y: readRequiredDagNumber(attrs, "data-auto-y"),
      width: readRequiredDagNumber(attrs, "data-node-width"),
      height: readRequiredDagNumber(attrs, "data-node-height"),
    },
  ]));
}

function readRequiredDagNumber(attrs: DagEdgePathAttrs, key: string): number {
  const value = Number.parseFloat(attrs[key] ?? "");
  assert.ok(Number.isFinite(value), `Expected finite ${key}`);
  return value;
}

function readDagEdgePathEndpoints(edge: DagEdgePathAttrs): { start: DagPoint; end: DagPoint } {
  const numbers = Array.from((edge.d ?? "").matchAll(/-?\d+(?:\.\d+)?/g))
    .map((match) => Number.parseFloat(match[0]));
  assert.equal(numbers.length, 8, `Expected cubic path coordinates for ${edge["data-edge-id"]}`);
  return {
    start: { x: numbers[0], y: numbers[1] },
    end: { x: numbers[6], y: numbers[7] },
  };
}

function assertDagEdgeUsesVisiblePortPoints(edge: DagEdgePathAttrs, layouts: ReadonlyMap<string, DagBox>): void {
  const from = layouts.get(edge["data-edge-from"] ?? "");
  const to = layouts.get(edge["data-edge-to"] ?? "");
  assert.ok(from && to, `Expected node layouts for ${edge["data-edge-id"]}`);
  const endpoints = readDagEdgePathEndpoints(edge);
  assertDagPointOnBoxBorder(endpoints.start, from, "source", edge["data-edge-id"]);
  assertDagPointOnBoxBorder(endpoints.end, to, "target", edge["data-edge-id"]);
  assertDagPointOnVisiblePort(endpoints.start, from, "source", edge["data-edge-id"]);
  assertDagPointOnVisiblePort(endpoints.end, to, "target", edge["data-edge-id"]);
}

function assertDagPointOnBoxBorder(point: DagPoint, box: DagBox, label: string, edgeId: string | undefined): void {
  const epsilon = 0.75;
  const withinX = point.x >= box.x - epsilon && point.x <= box.x + box.width + epsilon;
  const withinY = point.y >= box.y - epsilon && point.y <= box.y + box.height + epsilon;
  const onVerticalBorder = (Math.abs(point.x - box.x) <= epsilon || Math.abs(point.x - (box.x + box.width)) <= epsilon) && withinY;
  const onHorizontalBorder = (Math.abs(point.y - box.y) <= epsilon || Math.abs(point.y - (box.y + box.height)) <= epsilon) && withinX;
  assert.ok(onVerticalBorder || onHorizontalBorder, `Expected ${label} endpoint for ${edgeId} to sit on node border`);
}

function assertDagPointOnVisiblePort(point: DagPoint, box: DagBox, label: string, edgeId: string | undefined): void {
  const epsilon = 0.75;
  const visiblePorts = DAG_EXPECTED_PORT_RATIOS.flatMap((ratio) => [
    { x: box.x + box.width * ratio, y: box.y },
    { x: box.x + box.width, y: box.y + box.height * ratio },
    { x: box.x + box.width * ratio, y: box.y + box.height },
    { x: box.x, y: box.y + box.height * ratio },
  ]);
  const matchesVisiblePort = visiblePorts.some((port) => (
    Math.abs(point.x - port.x) <= epsilon && Math.abs(point.y - port.y) <= epsilon
  ));
  assert.ok(matchesVisiblePort, `Expected ${label} endpoint for ${edgeId} to use one of the three visible ports per node side`);
}

function assertDagNodeLayoutsDoNotOverlap(layouts: Iterable<DagBox>): void {
  const boxes = Array.from(layouts);
  boxes.forEach((left, leftIndex) => {
    boxes.slice(leftIndex + 1).forEach((right) => {
      const overlaps = left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y;
      assert.equal(overlaps, false);
    });
  });
}

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
  assert.deepEqual(state.edges.map((edge) => [edge.from, edge.to, edge.visited]), [
    ["plan", "implement", true],
    ["implement", "test", false],
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
        label: "Return to implementation",
        condition: "tests failed",
        conditionExpression: {
          type: "source_status",
          status: "failed",
          description: "source node failed",
        },
        metadata: {
          feedbackReason: "review found missing coverage",
          reworkTargetNodeId: "implement",
        },
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
    label: edge.label,
    condition: edge.condition,
    conditionExpression: edge.conditionExpression,
    metadata: edge.metadata,
  })), [{
    id: "review-feedback",
    from: "test",
    to: "implement",
    kind: "review_feedback",
    label: "Return to implementation",
    condition: "tests failed",
    conditionExpression: {
      type: "source_status",
      status: "failed",
      description: "source node failed",
    },
    metadata: {
      feedbackReason: "review found missing coverage",
      reworkTargetNodeId: "implement",
    },
  }]);
});

test("renders a true visual DAG with SVG edges, arrow marker, node buttons, aria labels, and status", () => {
  const state = buildState(createSerialFiveNodeRun(), "review");
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, state, "en");

  assert.match(html, /class="content graph-canvas-content"/);
  assert.match(html, /class="section graph-dag"/);
  assert.match(html, /data-layout-engine="@dagrejs\/dagre"/);
  assert.match(html, /data-auto-width="\d+"/);
  assert.match(html, /data-auto-height="\d+"/);
  assert.match(html, /data-dag-viewport/);
  assert.match(html, /data-dag-canvas-shell/);
  assert.match(html, /data-default-zoom="75"/);
  assert.match(html, /data-zoom-percent="75"/);
  assert.match(html, /data-zoom-scale="0\.75"/);
  assert.match(html, /transform: scale\(0\.75\)/);
  assert.match(html, /data-dag-zoom-select/);
  assert.match(html, /<option value="25">25%<\/option>/);
  assert.match(html, /<option value="50">50%<\/option>/);
  assert.match(html, /<option value="75" selected>75%<\/option>/);
  assert.match(html, /<option value="100">100%<\/option>/);
  assert.match(html, /<option value="125">125%<\/option>/);
  assert.match(html, /<svg class="dag-edges"/);
  assert.match(html, /marker id="graph-arrowhead"/);
  assert.match(html, /marker id="graph-arrowhead-visited"/);
  assert.match(html, /class="dag-edge-path active edge-kind-depends_on" data-edge-id="depends_on:plan-&gt;implement" data-edge-from="plan" data-edge-to="implement" data-from-port="right-50" data-to-port="left-50"/);
  assert.match(html, /data-edge-id="depends_on:plan-&gt;implement"[\s\S]*data-edge-visited="true"[\s\S]*marker-end="url\(#graph-arrowhead-visited\)"/);
  assert.match(html, /data-edge-id="depends_on:review-&gt;summary"[\s\S]*data-edge-visited="true"[\s\S]*marker-end="url\(#graph-arrowhead-visited\)"/);
  assert.match(html, /data-edge-label="[^"]*Depends On/);
  assert.match(html, /data-edge-id="depends_on:plan-&gt;implement"[\s\S]*data-edge-display-label=""/);
  assert.deepEqual(getVisibleEdgeLabels(html), []);
	  assert.equal((html.match(/class="dag-edge-path/g) ?? []).length, 4);
	  assert.match(html, /<button[\s\S]*class="dag-node node-select-target status-passed kind-test node-tone-validation semantic-normal"[\s\S]*data-node-id="test"/);
	  assert.match(html, /<button[\s\S]*class="dag-node node-select-target selected status-passed kind-review node-tone-validation semantic-normal"/);
	  assert.match(html, /data-node-tone="validation"/);
	  assert.match(html, /data-node-kind-tone="validation"/);
	  assert.match(html, /data-auto-x="\d+"[\s\S]*data-auto-y="\d+"[\s\S]*data-node-width="192"[\s\S]*data-node-height="78"/);
  assert.equal((html.match(/class="dag-port-dot/g) ?? []).length, 60);
  assert.match(html, /data-port-id="top-25"/);
  assert.match(html, /data-port-id="right-50"/);
  assert.match(html, /data-port-id="bottom-75"/);
		  assert.match(html, /data-port-id="left-50"/);
  assert.doesNotMatch(html, /data-port-id="(?:top|right|bottom|left)-(?:0|100)"/);
  assert.doesNotMatch(html, /data-(?:from|to)-port="(?:top|right|bottom|left)-(?:0|100)"/);
		  assert.match(html, /height: 78px/);
		  assert.match(html, /class="dag-tone-stripe"/);
		  assert.doesNotMatch(html, /class="dag-kind-mark"/);
		  assert.doesNotMatch(html, /class="dag-kind-mark"[\s\S]*>R<\/span>/);
		  assert.match(html, /class="dag-kind-chip">Review<\/span>/);
		  assert.match(html, /class="semantic-chip semantic-normal">Step<\/span>/);
		  assert.match(html, /aria-label="Node 评审, status Passed, kind Review/);
	  assert.match(html, /data-node-id="plan"[\s\S]*data-node-id="implement"[\s\S]*data-node-id="test"[\s\S]*data-node-id="review"[\s\S]*data-node-id="summary"/);
	  assert.match(html, /data-node-detail="review"/);
	  assert.match(html, /id="nodeDetailDialogBackdrop" class="dialog-backdrop node-detail-backdrop"/);
	  assert.match(html, /id="nodeDetailDialog" class="dialog node-detail-dialog" role="dialog" aria-modal="true"/);
	  assert.match(html, /<svg id="nodeDetailDialogClose" class="node-detail-close-icon"[\s\S]*data-node-detail-close[\s\S]*role="button"[\s\S]*aria-label="Close Details"[\s\S]*viewBox="0 0 16 16"/);
	  assert.match(html, /<path d="M4 4l8 8M12 4 4 12" aria-hidden="true"><\/path>/);
	  assert.doesNotMatch(html, /<button id="nodeDetailDialogClose"/);
	  assert.match(html, /data-action="resetLayout"[\s\S]*aria-label="Clear saved manual node positions for this Graph run"[\s\S]*>↺</);
	  assert.doesNotMatch(html, />\s*Reset layout\s*</);
	  assert.match(html, /graphRunLayouts/);
	  assert.match(html, /\[graphRunId\]/);
	  assert.match(html, /vscode\.getState\(\)/);
	  assert.match(html, /vscode\.setState/);
	  assert.match(html, /getSavedRunLayout/);
	  assert.match(html, /getSavedZoomPercent/);
	  assert.match(html, /persistZoom/);
	  assert.match(html, /graphRunLayouts\[graphRunId\] = \{/);
	  assert.match(html, /zoom: normalizeZoomPercent\(zoomPercent\)/);
	  assert.match(html, /persistManualLayout/);
	  assert.match(html, /centerInitialDagViewport/);
	  assert.match(html, /resolveInitialViewportNodeId/);
	  assert.match(html, /status-running", "status-sleeping", "status-blocked", "status-failed"/);
	  assert.match(html, /dagViewport\.scrollLeft = Math\.max\(0, Math\.round\(centerX - dagViewport\.clientWidth \/ 2\)\)/);
	  assert.match(html, /dagViewport\.scrollTop = Math\.max\(0, Math\.round\(centerY - dagViewport\.clientHeight \/ 2\)\)/);
	  assert.match(html, /startNodeDrag/);
	  assert.match(html, /pointermove/);
	  assert.match(html, /nodeDragMoveThreshold/);
	  assert.match(html, /const zoomScale = getCurrentZoomScale\(\);[\s\S]*const dx = rawDx \/ zoomScale;[\s\S]*const dy = rawDy \/ zoomScale;/);
	  assert.match(html, /openNodeDetailDialog/);
	  assert.match(html, /element\.addEventListener\("click", \(event\) => \{[\s\S]*openNodeDetailDialog\(element\.dataset\.nodeId \|\| "", \{ trigger: element, persist: true \}\)/);
	  assert.match(html, /addEventListener\("dblclick"/);
	  assert.match(html, /event\.stopPropagation\(\);[\s\S]*suppressNodeClickId = "";/);
	  assert.match(html, /closeNodeDetailDialog/);
	  assert.match(html, /event\.key === "Escape" && isNodeDetailDialogOpen\(\)/);
	  assert.match(html, /startCanvasPan/);
	  assert.match(html, /isCanvasPanBlockedTarget/);
	  assert.match(html, /\[data-node-id\], button, select, input, textarea, a/);
	  assert.match(html, /dagViewport\.scrollLeft = activePan\.startScrollLeft - rawDx/);
	  assert.match(html, /dagViewport\.scrollTop = activePan\.startScrollTop - rawDy/);
	  assert.match(html, /syncGraphCanvasAndEdges/);
	  assert.match(html, /setAttribute\("d", edgePath\.path\)/);
	  assert.match(html, /const edgeLabelsById = new Map/);
	  assert.match(html, /edgeLabel\.setAttribute\("x", formatPathNumber\(edgePath\.labelX\)\)/);
	  assert.match(html, /edgeLabel\.setAttribute\("y", formatPathNumber\(edgePath\.labelY\)\)/);
	  assert.match(html, /chooseEdgePortPair/);
	  assert.match(html, /pathElement\.dataset\.fromPort = edgePath\.fromPort/);
	  assert.match(html, /pathElement\.dataset\.toPort = edgePath\.toPort/);
	  assert.doesNotMatch(html, /<textPath/);
	  assert.ok(getVisibleEdgeLabels(html).every((label) => !label.includes("\n")));
	  assert.doesNotMatch(html, /dag-node-meta/);
	  assert.doesNotMatch(html, /class="sidebar"|class="node-list"/);
	  assert.doesNotMatch(html, /class="content graph-split"/);
	  assert.doesNotMatch(html, /node-details-section/);
	  assert.doesNotMatch(html, />\s*(Overview|Status Statistics|Final Answer|Recent Events)\s*</);
	  assert.doesNotMatch(html, />\s*(Retry|Approve|Continue|Stop)\s*</);
});

test("uses workflow-style auto layout spacing, collision handling, and dynamic node sizing", () => {
  const run = createRun({
    nodes: [
      createNode({
        id: "start",
        title: "Start intake",
        kind: "intake",
        dependsOn: [],
        unlocks: ["design", "implement", "validate"],
      }),
      createNode({
        id: "design",
        title: "Design execution path",
        kind: "plan",
        dependsOn: ["start"],
        unlocks: ["summary"],
      }),
      createNode({
        id: "implement",
        title: "Implement upgraded graph auto layout",
        kind: "implement",
        dependsOn: ["start"],
        unlocks: ["summary"],
      }),
      createNode({
        id: "validate",
        title: "Validate a very long Graph visualization branch title",
        kind: "test",
        dependsOn: ["start"],
        unlocks: ["summary"],
      }),
      createNode({
        id: "summary",
        title: "Summarize result",
        kind: "summary",
        dependsOn: ["design", "implement", "validate"],
        unlocks: [],
      }),
    ],
    edges: [],
  });
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, buildState(run, "start"), "en");
  const nodeLayouts = getDagNodeLayoutById(html);
  const start = nodeLayouts.get("start");
  const design = nodeLayouts.get("design");
  const implement = nodeLayouts.get("implement");
  const validate = nodeLayouts.get("validate");
  const summary = nodeLayouts.get("summary");
  assert.ok(start && design && implement && validate && summary);

  assert.equal(start.width, 192);
  assert.ok(start.height > 78);
  assert.ok(validate.height > 78);
  assert.ok(Math.min(design.x, implement.x, validate.x) - start.x >= 300);
  assert.ok(summary.x - Math.max(design.x, implement.x, validate.x) >= 300);
  assertDagNodeLayoutsDoNotOverlap(nodeLayouts.values());
});

test("supports target workflow-style layout directions and tuned spacing parameters", () => {
  const run = createRun({
    nodes: [
      createNode({ id: "start", title: "Start intake", kind: "intake", dependsOn: [], unlocks: ["step"] }),
      createNode({
        id: "step",
        title: "Execute step",
        kind: "implement",
        dependsOn: ["start"],
        unlocks: [],
      }),
    ],
    edges: [],
  });
  const state = buildState(run, "step");
  const lrLayout = buildGraphRunPanelDagLayoutForTest(state, "en", "LR");
  const tbLayout = buildGraphRunPanelDagLayoutForTest(state, "en", "TB");
  const lrNodes = new Map(lrLayout.nodeLayouts.map((layout) => [layout.node.id, layout]));
  const tbNodes = new Map(tbLayout.nodeLayouts.map((layout) => [layout.node.id, layout]));
  const lrStart = lrNodes.get("start");
  const lrStep = lrNodes.get("step");
  const tbStart = tbNodes.get("start");
  const tbStep = tbNodes.get("step");
  assert.ok(lrStart && lrStep && tbStart && tbStep);

  assert.equal(lrLayout.config.direction, "LR");
  assert.equal(tbLayout.config.direction, "TB");
  assert.equal(lrLayout.config.ranksep, 124);
  assert.equal(lrLayout.config.nodesep, 88);
  assert.equal(lrLayout.config.edgesep, 44);
  assert.equal(lrLayout.config.marginX, 56);
  assert.equal(lrLayout.config.marginY, 56);
  assert.ok(lrStep.x - lrStart.x >= 300);
  assert.ok(tbStep.y - tbStart.y >= 190);

  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, state, "en");
  assert.match(html, /data-auto-layout-direction="LR"/);
  assert.match(html, /data-auto-ranksep="124"/);
  assert.match(html, /data-auto-nodesep="88"/);
  assert.match(html, /data-auto-edgesep="44"/);
  assert.match(html, /data-auto-margin-x="56"/);
  assert.match(html, /data-auto-margin-y="56"/);
});

test("fallback auto layout expands all zero-indegree roots instead of drafting parallel roots", () => {
  const run = createRun({
    nodes: [
      createNode({
        id: "root-a",
        title: "Primary intake",
        kind: "intake",
        dependsOn: [],
        unlocks: ["merge"],
      }),
      createNode({
        id: "root-b",
        title: "Independent plan",
        kind: "plan",
        dependsOn: [],
        unlocks: ["merge"],
      }),
      createNode({
        id: "merge",
        title: "Merge roots",
        kind: "merge",
        dependsOn: ["root-a", "root-b"],
        unlocks: [],
      }),
    ],
    edges: [],
  });
  const state = buildState(run, "merge");
  const lrLayout = buildGraphRunPanelDagLayoutForTest(state, "en", "LR", "fallback");
  const tbLayout = buildGraphRunPanelDagLayoutForTest(state, "en", "TB", "fallback");
  const lrNodes = new Map(lrLayout.nodeLayouts.map((layout) => [layout.node.id, layout]));
  const tbNodes = new Map(tbLayout.nodeLayouts.map((layout) => [layout.node.id, layout]));
  const lrRootA = lrNodes.get("root-a");
  const lrRootB = lrNodes.get("root-b");
  const lrMerge = lrNodes.get("merge");
  const tbRootA = tbNodes.get("root-a");
  const tbRootB = tbNodes.get("root-b");
  const tbMerge = tbNodes.get("merge");
  assert.ok(lrRootA && lrRootB && lrMerge && tbRootA && tbRootB && tbMerge);

  assert.equal(lrRootA.x, lrRootB.x);
  assert.ok(lrRootB.y > lrRootA.y);
  assert.ok(lrMerge.x > lrRootA.x);
  assert.ok(lrRootB.y - lrRootA.y < 260);
  assert.equal(tbRootA.y, tbRootB.y);
  assert.ok(tbRootB.x > tbRootA.x);
  assert.ok(tbMerge.y > tbRootA.y);
  assert.ok(tbRootB.x - tbRootA.x < 360);
  assertDagNodeLayoutsDoNotOverlap(lrLayout.nodeLayouts);
  assertDagNodeLayoutsDoNotOverlap(tbLayout.nodeLayouts);
});

test("packages dagre runtime dependency used by graph run panel layout", () => {
  assert.equal(packageJson.dependencies?.["@dagrejs/dagre"], "^3.0.0");
  assert.match(vscodeIgnoreText, /^!node_modules\/@dagrejs\/\*\*$/m);
});

test("simplifies DAG canvas header while keeping compact zoom and reset controls", () => {
  const state = buildState(createSerialFiveNodeRun(), "review");
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, state, "zh-CN");

  assert.match(html, /class="graph-dag-toolbar"/);
  assert.match(html, /aria-label="运行图工具"/);
  assert.match(html, /title="缩放"/);
  assert.match(html, /data-action="resetLayout"[\s\S]*title="清除当前 Graph 运行保存的手动节点位置"[\s\S]*>↺</);
  assert.doesNotMatch(html, />\s*可视图\s*</);
  assert.doesNotMatch(html, /使用 Dagre 分层布局展示节点与依赖，可拖拽调整当前运行。/);
  assert.doesNotMatch(html, /可拖拽节点调整布局；按 Tab 聚焦，按 Enter 或空格选择。/);
  assert.doesNotMatch(html, />\s*重置布局\s*</);
});

test("renders cyclic and feedback edges conservatively without hiding valid edges", () => {
  const run = createRun({
    nodes: [
      createNode({ id: "plan", title: "Plan", unlocks: ["implement"] }),
      createNode({
        id: "implement",
        title: "Implement",
        kind: "implement",
        status: "failed",
        dependsOn: ["plan"],
        unlocks: ["review"],
      }),
      createNode({
        id: "review",
        title: "Review",
        kind: "review",
        status: "ready",
        dependsOn: ["implement"],
        unlocks: [],
      }),
    ],
    edges: [
      { id: "plan-implement", from: "plan", to: "implement", kind: "depends_on", active: true },
      { id: "implement-review", from: "implement", to: "review", kind: "depends_on", active: true },
      { id: "review-implement", from: "review", to: "implement", kind: "review_feedback", active: true, condition: "needs changes" },
      { id: "review-plan", from: "review", to: "plan", kind: "if_fail", active: false, condition: "reset plan" },
    ],
  });
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, buildState(run, "review"), "en");

  assert.match(html, /data-layout-engine="@dagrejs\/dagre"/);
  assert.equal((html.match(/class="dag-edge-path/g) ?? []).length, 4);
  assert.match(html, /edge-kind-review_feedback" data-edge-id="review-implement" data-edge-from="review" data-edge-to="implement"/);
  assert.match(html, /edge-kind-if_fail" data-edge-id="review-plan" data-edge-from="review" data-edge-to="plan"/);
  assert.match(html, /needs changes/);
  const nodeLayouts = getDagNodeLayoutById(html);
  const plan = nodeLayouts.get("plan");
  const implement = nodeLayouts.get("implement");
  const review = nodeLayouts.get("review");
  assert.ok(plan && implement && review);
  assert.ok(plan.x < implement.x);
  assert.ok(implement.x < review.x);
  const edges = getDagEdgePathAttrs(html);
  const reviewFeedback = edges.find((edge) => edge["data-edge-id"] === "review-implement");
  const ifFail = edges.find((edge) => edge["data-edge-id"] === "review-plan");
  assert.ok(reviewFeedback && ifFail);
  assert.ok(Math.abs(Number.parseFloat(reviewFeedback["data-edge-offset"] ?? "")) >= 18);
  assert.ok(Math.abs(Number.parseFloat(ifFail["data-edge-offset"] ?? "")) >= 18);
});

test("colors visited non-dependency workflow edges by kind", () => {
  const run = createRun({
    nodes: [
      createNode({ id: "pass-source", title: "Pass source", status: "passed", unlocks: ["pass-target"] }),
      createNode({ id: "pass-target", title: "Pass target", status: "pending", dependsOn: ["pass-source"], unlocks: [] }),
      createNode({ id: "fail-source", title: "Fail source", status: "failed", unlocks: ["fail-target"] }),
      createNode({ id: "fail-target", title: "Fail target", status: "pending", dependsOn: ["fail-source"], unlocks: [] }),
      createNode({ id: "review", title: "Review", kind: "review", status: "failed", unlocks: ["implement"] }),
      createNode({ id: "implement", title: "Implement", kind: "implement", status: "pending", dependsOn: ["review"], unlocks: [] }),
      createNode({ id: "gate", title: "Gate", kind: "human_gate", status: "passed", unlocks: ["summary"] }),
      createNode({ id: "summary", title: "Summary", kind: "summary", status: "pending", dependsOn: ["gate"], unlocks: [] }),
      createNode({ id: "pending-source", title: "Pending source", status: "pending", unlocks: ["pending-target"] }),
      createNode({ id: "pending-target", title: "Pending target", status: "pending", dependsOn: ["pending-source"], unlocks: [] }),
    ],
    edges: [
      { id: "visited-pass", from: "pass-source", to: "pass-target", kind: "if_pass", active: true },
      { id: "visited-fail", from: "fail-source", to: "fail-target", kind: "if_fail", active: true },
      { id: "visited-feedback", from: "review", to: "implement", kind: "review_feedback", active: true },
      { id: "visited-approved", from: "gate", to: "summary", kind: "human_approved", active: true },
      { id: "unvisited-pass", from: "pending-source", to: "pending-target", kind: "if_pass", active: true },
    ],
  });
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, buildState(run, "gate"), "en");

  assert.equal(getRequiredDagEdgePathAttrs(html, "visited-pass")["data-edge-visited"], "true");
  assert.equal(getRequiredDagEdgePathAttrs(html, "visited-pass")["marker-end"], "url(#graph-arrowhead-visited-if-pass)");
  assert.equal(getRequiredDagEdgePathAttrs(html, "visited-fail")["data-edge-visited"], "true");
  assert.equal(getRequiredDagEdgePathAttrs(html, "visited-fail")["marker-end"], "url(#graph-arrowhead-visited-if-fail)");
  assert.equal(getRequiredDagEdgePathAttrs(html, "visited-feedback")["data-edge-visited"], "true");
  assert.equal(getRequiredDagEdgePathAttrs(html, "visited-feedback")["marker-end"], "url(#graph-arrowhead-visited-review-feedback)");
  assert.equal(getRequiredDagEdgePathAttrs(html, "visited-approved")["data-edge-visited"], "true");
  assert.equal(getRequiredDagEdgePathAttrs(html, "visited-approved")["marker-end"], "url(#graph-arrowhead-visited-human-approved)");
  assert.equal(getRequiredDagEdgePathAttrs(html, "unvisited-pass")["data-edge-visited"], "false");
  assert.equal(getRequiredDagEdgePathAttrs(html, "unvisited-pass")["marker-end"], "url(#graph-arrowhead)");
});

test("dedupes same-direction DAG edges and separates bidirectional connection ports", () => {
  const run = createRun({
    nodes: [
      createNode({ id: "alpha", title: "Alpha", unlocks: ["beta"] }),
      createNode({
        id: "beta",
        title: "Beta",
        kind: "review",
        status: "ready",
        dependsOn: ["alpha"],
        unlocks: ["alpha"],
      }),
    ],
    edges: [
      { id: "alpha-beta-default", from: "alpha", to: "beta", kind: "depends_on", active: true },
      { id: "alpha-beta-purpose", from: "alpha", to: "beta", kind: "if_pass", active: true, label: "Manual override" },
      { id: "beta-alpha-feedback", from: "beta", to: "alpha", kind: "review_feedback", active: true, condition: "needs change" },
    ],
  });
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, buildState(run, "beta"), "en");
  const edges = getDagEdgePathAttrs(html);
  const alphaToBeta = edges.find((edge) => edge["data-edge-from"] === "alpha" && edge["data-edge-to"] === "beta");
  const betaToAlpha = edges.find((edge) => edge["data-edge-from"] === "beta" && edge["data-edge-to"] === "alpha");

  assert.equal(edges.length, 2);
  assert.equal(edges.filter((edge) => edge["data-edge-from"] === "alpha" && edge["data-edge-to"] === "beta").length, 1);
  assert.equal(alphaToBeta?.["data-edge-id"], "alpha-beta-purpose");
  assert.equal(alphaToBeta?.["data-edge-port-hint"], "start");
  assert.equal(betaToAlpha?.["data-edge-port-hint"], "end");
  assert.notEqual(alphaToBeta?.["data-from-port"], betaToAlpha?.["data-to-port"]);
  assert.notEqual(alphaToBeta?.["data-to-port"], betaToAlpha?.["data-from-port"]);
  assert.match(html, /data-edge-display-label="Manu \/ over"/);
  assert.match(html, /data-edge-display-label="need \/ chan"/);
  assert.match(html, /<text class="dag-edge-label active" data-edge-label-for="beta-alpha-feedback" x="[\d.]+" y="[\d.]+" text-anchor="middle" dominant-baseline="central" aria-hidden="true">need \/ chan<\/text>/);
  assert.ok(getDagEdgeLabelAttrs(html).every((edgeLabel) => Number.isFinite(Number.parseFloat(edgeLabel.x ?? "")) && Number.isFinite(Number.parseFloat(edgeLabel.y ?? ""))));
  assert.doesNotMatch(html, /<textPath/);
});

test("snaps fan-out and fan-in edges to visible side ports while keeping offsets", () => {
  const run = createRun({
    nodes: [
      createNode({
        id: "fan",
        title: "Parallel fan out",
        kind: "plan",
        dependsOn: [],
        unlocks: ["branch-a", "branch-b"],
      }),
      createNode({
        id: "branch-a",
        title: "Branch A",
        kind: "implement",
        dependsOn: ["fan"],
        unlocks: ["merge"],
      }),
      createNode({
        id: "branch-b",
        title: "Branch B",
        kind: "test",
        dependsOn: ["fan"],
        unlocks: ["merge"],
      }),
      createNode({
        id: "merge",
        title: "Merge",
        kind: "merge",
        dependsOn: ["branch-a", "branch-b"],
        unlocks: [],
      }),
    ],
    edges: [
      { id: "fan-a", from: "fan", to: "branch-a", kind: "depends_on", active: true },
      { id: "fan-b", from: "fan", to: "branch-b", kind: "depends_on", active: true },
      { id: "a-merge", from: "branch-a", to: "merge", kind: "depends_on", active: true },
      { id: "b-merge", from: "branch-b", to: "merge", kind: "depends_on", active: true },
    ],
  });
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, buildState(run, "fan"), "en");
  const edges = getDagEdgePathAttrs(html);
  const nodeLayouts = getDagNodeLayoutById(html);
  const fanOutEdges = edges.filter((edge) => edge["data-edge-from"] === "fan");
  const fanInEdges = edges.filter((edge) => edge["data-edge-to"] === "merge");

  assert.equal(fanOutEdges.length, 2);
  assert.equal(fanInEdges.length, 2);
  [...fanOutEdges, ...fanInEdges].forEach((edge) => {
    assert.equal(edge["data-edge-from-side-hint"], undefined);
    assert.equal(edge["data-edge-to-side-hint"], undefined);
    assertDagEdgeUsesVisiblePortPoints(edge, nodeLayouts);
  });
  assert.ok(fanOutEdges.every((edge) => Math.abs(Number.parseFloat(edge["data-edge-offset"] ?? "")) > 0));
  assert.ok(fanInEdges.every((edge) => Math.abs(Number.parseFloat(edge["data-edge-offset"] ?? "")) > 0));
});

test("renders edge purpose labels, semantic node classes, and twelve ports per node", () => {
  const run = createRun({
    nodes: [
      createNode({ id: "start", title: "Start intake", kind: "intake", dependsOn: [], unlocks: ["decision"] }),
      createNode({
        id: "decision",
        title: "Decide branch",
        kind: "review",
        status: "ready",
        dependsOn: ["start"],
        unlocks: ["end", "start"],
      }),
      createNode({
        id: "end",
        title: "Finish summary",
        kind: "summary",
        status: "pending",
        dependsOn: ["decision"],
        unlocks: [],
      }),
    ],
    edges: [
      { id: "start-decision", from: "start", to: "decision", kind: "depends_on", active: true, label: "Prepare decision" },
      { id: "decision-end", from: "decision", to: "end", kind: "if_pass", active: true, condition: "Approved path" },
      { id: "decision-start", from: "decision", to: "start", kind: "if_fail", active: true, label: "Needs rework" },
    ],
  });
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, buildState(run, "decision"), "en");

  assert.match(html, /class="dag-node node-select-target status-passed kind-intake node-tone-start semantic-start"[\s\S]*data-node-id="start"[\s\S]*data-node-semantic="start"/);
  assert.match(html, /class="dag-node node-select-target selected status-ready kind-review node-tone-decision semantic-decision"[\s\S]*data-node-id="decision"[\s\S]*data-node-semantic="decision"/);
  assert.match(html, /class="dag-node node-select-target status-pending kind-summary node-tone-danger semantic-end"[\s\S]*data-node-id="end"[\s\S]*data-node-semantic="end"/);
  assert.match(html, /data-node-tone="start"/);
  assert.match(html, /data-node-tone="decision"/);
  assert.match(html, /data-node-tone="danger"/);
  assert.match(html, /data-node-kind-tone="start"/);
  assert.match(html, /data-node-kind-tone="decision"/);
  assert.match(html, /data-node-kind-tone="danger"/);
  assert.match(html, />Start<\/span>/);
  assert.match(html, />Decision<\/span>/);
  assert.match(html, />End<\/span>/);
  assert.match(html, /class="dag-kind-chip">Intake<\/span>/);
  assert.match(html, /class="dag-kind-chip">Review<\/span>/);
  assert.match(html, /class="dag-kind-chip">Summary<\/span>/);
  assert.equal((html.match(/class="dag-port-dot/g) ?? []).length, 36);
  assert.match(html, /data-edge-id="start-decision"[\s\S]*data-edge-label="[^"]*Prepare decision"[\s\S]*data-edge-display-label=""/);
  assert.match(html, /data-edge-id="decision-end"[\s\S]*data-edge-label="[^"]*Approved path"[\s\S]*data-edge-display-label="Appr \/ path"/);
  assert.match(html, /data-edge-id="decision-start"[\s\S]*data-edge-label="[^"]*Needs rework"[\s\S]*data-edge-display-label="Need \/ rewo"/);
  assert.match(html, /data-from-port="[^"]+" data-to-port="[^"]+"/);
  assert.match(html, /<text class="dag-edge-label active" data-edge-label-for="decision-end" x="[\d.]+" y="[\d.]+" text-anchor="middle" dominant-baseline="central" aria-hidden="true">Appr \/ path<\/text>/);
  assert.doesNotMatch(html, /<text class="dag-edge-label [^"]+"[^>]*>Appr<\/text>[\s\S]*<text class="dag-edge-label [^"]+"[^>]*>path<\/text>/);
  assert.doesNotMatch(html, /<textPath/);
  assert.ok(getVisibleEdgeLabels(html).every((label) => !label.includes("\n")));
  assert.doesNotMatch(html, /class="dag-edge-label [^"]+" dy="(?:-5|8)"/);
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
	  assert.equal(state.nodes.find((node) => node.id === "gate")?.control.canApprove, false);
  assert.match(html, /data-action="continue"[\s\S]*>Continue</);
	  assert.match(html, /data-action="supplement"[\s\S]*>I want to speak</);
		  assert.match(html, /data-action="stop"[\s\S]*>Stop Run</);
		  assert.match(html, /title="Persist Graph stopped state and only attempt mapped CLI run stops"/);
		  assertOmitsStopBoundaryCopy(html);
		  assert.match(html, /data-action="retry" data-control-node-id="fix"[\s\S]*>Retry Failed Node</);
		  assert.match(html, /data-action="feedback" data-control-node-id="failed-test"[\s\S]*>Rollback Upstream</);
		  assert.doesNotMatch(html, /data-action="approve" data-control-node-id="gate"/);
  assert.match(html, /graphRun:continue/);
	  assert.match(html, /graphRun:supplementRun/);
	  assert.match(html, /graphRun:retryNode/);
	  assert.match(html, /graphRun:feedbackNode/);
	  assert.doesNotMatch(html, /graphRun:approveHumanGate/);
	  assert.match(html, /graphRun:stopRun/);

  const zhStopState = buildGraphRunPanelStateWithDeps(
    createRun(),
    [],
    {
      strings: getGraphRunPanelStrings("zh-CN"),
      controls: { stopRun: true },
    },
  );
  const zhStopHtml = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, zhStopState, "zh-CN");
  assert.equal(zhStopState.runControl.canStop, true);
  assert.match(zhStopHtml, /data-action="stop"[\s\S]*>中止运行</);
  assert.match(zhStopHtml, /title="落盘停止 Graph 状态，并仅尝试停止已映射的 CLI 运行"/);
  assertOmitsStopBoundaryCopy(zhStopHtml);

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
  assertOmitsStopBoundaryCopy(zhHtml);

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
	        stopRun: true,
      },
    },
	  );
	  const hiddenHtml = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, hiddenState, "en");
		  assert.doesNotMatch(hiddenHtml, />\s*(Continue|I want to speak|Stop Run|Retry Failed Node|Rollback Upstream|Approve Human Gate)\s*</);
  assertOmitsStopBoundaryCopy(hiddenHtml);
	});

test("renders historical human gates without approval controls", () => {
  const state = buildGraphRunPanelStateWithDeps(
    createRun({
      status: "needs-review",
      activeNodeIds: [],
      nodes: [
        createNode({ id: "plan", status: "passed", unlocks: ["gate"] }),
        createNode({
          id: "gate",
          title: "Approve production change",
          kind: "human_gate",
          status: "ready",
          ownerRole: "human",
          attempts: 0,
          dependsOn: ["plan"],
          unlocks: [],
          communicationFile: "/tmp/graph/gate.md",
          acceptance: [{ name: "Human approval captured", evidenceRef: "/tmp/graph/gate.md" }],
        }),
      ],
    }),
    [],
    {
      strings: getGraphRunPanelStrings("zh-CN"),
    },
  );
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, state, "zh-CN");

  assert.equal(state.selectedNodeId, "gate");
  assert.equal(state.nodes.find((node) => node.id === "gate")?.control.canApprove, false);
  assert.match(html, /人工关卡/);
  assert.doesNotMatch(html, /需要人工审批/);
  assert.doesNotMatch(html, /请你审批，点击这里/);
  assert.doesNotMatch(html, /data-action="approve" data-control-node-id="gate"/);
  assert.doesNotMatch(html, /graphRun:approveHumanGate/);
});

test("renders first-class evidence for selected node and final answer sources", () => {
  const state = buildGraphRunPanelStateWithDeps(
    createRun({
      nodes: [
        createNode({
          id: "evidence-node",
          title: "Collect evidence",
          kind: "test",
          status: "blocked",
          attempts: 1,
          maxAttempts: 2,
          artifactRef: "/tmp/graph/evidence-artifact.md",
          communicationFile: "/tmp/graph/evidence-chat.md",
          acceptance: [{
            name: "Build log attached",
            required: true,
            passed: false,
            evidenceRef: "/tmp/graph/build.log",
          }],
          dependsOn: [],
          unlocks: [],
        }),
      ],
      finalAnswer: {
        conclusion: "Evidence needs review",
        summary: "Review the collected evidence.",
        evidence: ["evidence-node:/tmp/graph/evidence-artifact.md"],
        unresolved: ["evidence-node:blocked"],
      },
    }),
    [
      createEvent({
        eventId: "evidence-event",
        type: "node.blocked",
        nodeId: "evidence-node",
        timestamp: 4_000,
        summary: "Build log failed validation",
      }),
    ],
    { strings: getGraphRunPanelStrings("en"), selectedNodeId: "evidence-node" },
  );
  const html = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, state, "en");

  assert.deepEqual(state.selectedEvidence.map((item) => item.kind), [
    "artifactRef",
    "communicationFile",
    "acceptanceEvidence",
    "event",
    "finalAnswer",
  ]);
  assert.match(html, />Evidence</);
  assert.match(html, /Artifact: \/tmp\/graph\/evidence-artifact\.md/);
  assert.match(html, /Communication: \/tmp\/graph\/evidence-chat\.md/);
  assert.match(html, /Acceptance Evidence: \/tmp\/graph\/build\.log/);
  assert.match(html, /Event: node\.blocked - Build log failed validation/);
  assert.match(html, /Final Answer Evidence: evidence-node:\/tmp\/graph\/evidence-artifact\.md/);
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

  const traceOnly = createRun({
    edges: [
      { id: "plan-test-evidence", from: "plan", to: "test", kind: "evidence_for", active: true },
      { id: "plan-test-conflict", from: "plan", to: "test", kind: "conflicts_with", active: true },
    ],
  });
  const traceOnlyHtml = buildGraphRunPanelHtml({ cspSource: "vscode-resource://graph" }, buildState(traceOnly), "en");
  assert.match(traceOnlyHtml, /No active edges are recorded/);
  assert.doesNotMatch(traceOnlyHtml, /edge-kind-evidence_for/);
  assert.doesNotMatch(traceOnlyHtml, /edge-kind-conflicts_with/);

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
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.graph-canvas-content[\s\S]*height:\s*100%/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.graph-dag[\s\S]*flex:\s*1 1 auto/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-viewport[\s\S]*cursor:\s*grab/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-viewport\.panning[\s\S]*cursor:\s*grabbing/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-edge-path\[data-edge-visited="true"\][\s\S]*stroke:\s*var\(--vscode-textLink-foreground,\s*var\(--vscode-focusBorder\)\)/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-edge-path\[data-edge-visited="true"\]\.edge-kind-if_pass\s*\{[\s\S]*stroke:\s*var\(--vscode-testing-iconPassed/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-edge-path\[data-edge-visited="true"\]\.edge-kind-if_fail\s*\{[\s\S]*stroke:\s*var\(--vscode-testing-iconFailed/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-edge-path\[data-edge-visited="true"\]\.edge-kind-review_feedback\s*\{[\s\S]*stroke:\s*var\(--vscode-editorWarning-foreground/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-edge-path\[data-edge-visited="true"\]\.edge-kind-human_approved\s*\{[\s\S]*stroke:\s*var\(--vscode-charts-orange/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-arrowhead-visited\s*\{[\s\S]*fill:\s*var\(--vscode-textLink-foreground,\s*var\(--vscode-focusBorder\)\)/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-arrowhead-visited-if-pass\s*\{[\s\S]*fill:\s*var\(--vscode-testing-iconPassed/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-arrowhead-visited-if-fail\s*\{[\s\S]*fill:\s*var\(--vscode-testing-iconFailed/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-arrowhead-visited-review-feedback\s*\{[\s\S]*fill:\s*var\(--vscode-editorWarning-foreground/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-arrowhead-visited-human-approved\s*\{[\s\S]*fill:\s*var\(--vscode-charts-orange/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.node-detail-dialog[\s\S]*width:\s*min\(860px, 100%\)/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.node-detail-dialog-body[\s\S]*overflow:\s*auto/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.node-detail-close-icon[\s\S]*position:\s*absolute/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.node-detail-close-icon[\s\S]*color:\s*var\(--vscode-icon-foreground,\s*var\(--vscode-foreground\)\)/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.node-detail-close-icon path[\s\S]*stroke:\s*currentColor/);
  assert.doesNotMatch(GRAPH_RUN_PANEL_STYLES, /flex:\s*0 0 50%/);
  assert.doesNotMatch(GRAPH_RUN_PANEL_STYLES, /flex:\s*1 1 50%/);
  assert.doesNotMatch(GRAPH_RUN_PANEL_STYLES, /node-details-section/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /justify-content:\s*space-between/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /-webkit-line-clamp:\s*2/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /white-space:\s*normal/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.node-tone-info[\s\S]*--node-tone:\s*var\(--vscode-focusBorder\)/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.node-tone-accent[\s\S]*--node-tone:\s*var\(--vscode-progressBar-background/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.node-tone-start[\s\S]*--node-tone:\s*var\(--vscode-testing-iconPassed/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.node-tone-decision[\s\S]*--node-tone:\s*var\(--vscode-editorWarning-foreground/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.node-tone-validation[\s\S]*--node-tone:\s*var\(--vscode-charts-orange/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.node-tone-warning[\s\S]*--node-tone:\s*var\(--vscode-editorWarning-foreground/);
	  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.node-tone-success[\s\S]*--node-tone:\s*var\(--vscode-testing-iconPassed/);
		  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.node-tone-danger[\s\S]*--node-tone:\s*var\(--vscode-errorForeground\)/);
		  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-tone-stripe[\s\S]*background:\s*var\(--node-tone\)/);
		  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-kind-chip/);
		  assert.doesNotMatch(GRAPH_RUN_PANEL_STYLES, /\.dag-kind-mark/);
		  assert.doesNotMatch(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.semantic-(?:start|end)[\s\S]*border-radius:\s*999px/);
	  assert.doesNotMatch(GRAPH_RUN_PANEL_STYLES, /dag-node-meta/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node \.status-pill[\s\S]*flex:\s*0 0 auto/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.status-blocked\s*\{[\s\S]*border-color:\s*var\(--vscode-errorForeground/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.status-blocked\s*\{[\s\S]*border-width:\s*2px/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.status-running\s*\{[\s\S]*border-color:\s*var\(--node-tone\)/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.status-running::before[\s\S]*animation:\s*graph-running-border-flow/);
  assert.match(GRAPH_RUN_PANEL_STYLES, /\.dag-node\.status-running::before[\s\S]*repeating-linear-gradient\(90deg,\s*var\(--node-tone\)/);
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
