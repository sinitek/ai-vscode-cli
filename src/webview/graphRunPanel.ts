import * as vscode from "vscode";
import {
  graphlib,
  layout as applyDagreLayout,
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
} from "@dagrejs/dagre";
import { resolveLocale, type AppLocale } from "../i18n";
import { GRAPH_RUN_PANEL_STYLES } from "./graphRunPanelStyles";
import {
  buildGraphRunPanelTitle,
  getGraphRunPanelStrings,
  interpolateGraphRunPanelString,
  type GraphRunPanelStrings,
} from "./graphRunPanelRenderer";
import type {
  GraphRunPanelEdge,
  GraphRunPanelEvidenceItem,
  GraphRunPanelMessage,
  GraphRunPanelNode,
  GraphRunPanelState,
} from "./graphRunPanelTypes";

export type {
  GraphRunPanelEdge,
  GraphRunPanelMessage,
  GraphRunPanelNode,
  GraphRunPanelState,
} from "./graphRunPanelTypes";

type GraphRunPanelHandlers = {
  onMessage: (message: GraphRunPanelMessage) => void;
  onDispose?: () => void;
};

type DagNodeLayout = {
  node: GraphRunPanelNode;
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
};

type DagPortSide = "top" | "right" | "bottom" | "left";
type DagPortHint = "start" | "center" | "end";

type DagPort = {
  id: string;
  side: DagPortSide;
  x: number;
  y: number;
};

type DagPoint = {
  x: number;
  y: number;
};

type DagEdgeGeometry = {
  path: string;
  fromPort: DagPort;
  toPort: DagPort;
  labelX: number;
  labelY: number;
  maxX: number;
  maxY: number;
};

type DagEdgeLayout = {
  edge: GraphRunPanelEdge;
  path: string;
  label: string;
  displayLabel: string;
  fromPort: string;
  toPort: string;
  portHint: DagPortHint;
  offset: number;
  labelX: number;
  labelY: number;
  maxX: number;
  maxY: number;
};

type GraphNodeSemanticKind = "start" | "decision" | "end" | "normal";
type GraphNodeTone = "info" | "accent" | "warning" | "success" | "neutral" | "danger" | "start" | "decision" | "validation";

type DagLayout = {
  width: number;
  height: number;
  config: DagAutoLayoutConfig;
  nodeLayouts: DagNodeLayout[];
  edgeLayouts: DagEdgeLayout[];
};

type DagAutoLayoutDirection = "LR" | "RL" | "TB" | "BT";

type DagAutoLayoutConfig = {
  direction: DagAutoLayoutDirection;
  ranksep: number;
  nodesep: number;
  edgesep: number;
  marginX: number;
  marginY: number;
};

type DagAutoLayoutBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type DagNodeSize = {
  width: number;
  height: number;
};

const DAG_NODE_WIDTH = 192;
const DAG_NODE_HEIGHT = 78;
const DAG_RANK_SEP = 124;
const DAG_NODE_SEP = 88;
const DAG_EDGE_SEP = 44;
const DAG_MARGIN_X = 56;
const DAG_MARGIN_Y = 56;
const DAG_AUTO_LAYOUT_CONFIG: DagAutoLayoutConfig = {
  direction: "LR",
  ranksep: DAG_RANK_SEP,
  nodesep: DAG_NODE_SEP,
  edgesep: DAG_EDGE_SEP,
  marginX: DAG_MARGIN_X,
  marginY: DAG_MARGIN_Y,
};
const DAG_NODE_LONG_TITLE_THRESHOLD = 28;
const DAG_NODE_LONG_TITLE_EXTRA_HEIGHT = 18;
const DAG_NODE_BRANCH_EXTRA_HEIGHT = 10;
const DAG_FALLBACK_DRAFT_EXTRA_GAP = 160;
const DAG_EDGE_CURVE_MIN = 42;
const DAG_EDGE_PARALLEL_OFFSET = 18;
const DAG_EDGE_LABEL_SEGMENT_LIMIT = 4;
const DAG_EDGE_LABEL_MAX_SEGMENTS = 2;
const DAG_PORT_RATIOS = [0.25, 0.5, 0.75] as const;
const DAG_VISIBLE_EDGE_ACTIVE_WEIGHT = 4;
const DAG_VISIBLE_EDGE_PURPOSE_WEIGHT = 2;
const DAG_VISIBLE_EDGE_NON_DEFAULT_KIND_WEIGHT = 1;
const DAG_FLOW_EDGE_KINDS: ReadonlySet<GraphRunPanelEdge["kind"]> = new Set([
  "depends_on",
  "if_pass",
  "if_fail",
  "review_feedback",
  "human_approved",
]);
const DAG_ZOOM_PERCENT_OPTIONS = [25, 50, 75, 100, 125] as const;
const DAG_DEFAULT_ZOOM_PERCENT = 75;

export class GraphRunPanel {
  private panel: vscode.WebviewPanel | undefined;
  private state: GraphRunPanelState | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: GraphRunPanelHandlers,
  ) {}

  public show(state: GraphRunPanelState): void {
    const locale = resolveLocale();
    const strings = getGraphRunPanelStrings(locale);
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "sinitek-cli-tools.graphRun",
        buildGraphRunPanelTitle(state, strings),
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.extensionUri],
        },
      );
      this.panel.webview.onDidReceiveMessage((message: GraphRunPanelMessage) => {
        this.handlers.onMessage(message);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.state = undefined;
        this.handlers.onDispose?.();
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Active, true);
    }
    this.update(state);
  }

  public update(state: GraphRunPanelState): void {
    this.state = state;
    if (!this.panel) {
      return;
    }
    const locale = resolveLocale();
    const strings = getGraphRunPanelStrings(locale);
    this.panel.title = buildGraphRunPanelTitle(state, strings);
    this.panel.webview.html = buildGraphRunPanelHtml(this.panel.webview, state, locale);
  }

  public getState(): GraphRunPanelState | undefined {
    return this.state;
  }
}

export function buildGraphRunPanelHtml(
  webview: Pick<vscode.Webview, "cspSource">,
  state: GraphRunPanelState,
  locale: AppLocale,
): string {
  const nonce = getNonce();
  const strings = getGraphRunPanelStrings(locale);
  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(strings.title)}</title>
    <style>
${GRAPH_RUN_PANEL_STYLES}
    </style>
  </head>
  <body data-run-id="${escapeHtml(state.run.id)}" data-selected-node-id="${escapeHtml(state.selectedNodeId ?? "")}">
    <div class="shell">
      <header class="topbar">
        <div class="title">
          <h1>${escapeHtml(strings.title)}</h1>
          <p>${escapeHtml(interpolateGraphRunPanelString(strings.runSubtitle, {
            status: state.run.statusLabel,
            cli: state.run.cli,
          }))} · ${escapeHtml(state.run.id)}</p>
        </div>
        <div class="actions">
          ${renderRunControls(state, strings)}
          <button class="button" type="button" data-action="refresh">${escapeHtml(strings.refresh)}</button>
        </div>
      </header>
      ${renderSupplementDialog(strings)}
      <main class="content graph-canvas-content">
        ${renderGraphDag(state, strings)}
        ${renderNodeDetails(state, strings)}
      </main>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const selectableNodes = Array.from(document.querySelectorAll("[data-node-id]"));
      const nodeIds = selectableNodes.map((element) => element.dataset.nodeId).filter(Boolean);
      const supplementBackdrop = document.getElementById("supplementDialogBackdrop");
      const supplementInput = document.getElementById("supplementDialogInput");
      const supplementError = document.getElementById("supplementDialogError");
      const supplementConfirm = document.getElementById("supplementDialogConfirm");
      const supplementCancel = document.getElementById("supplementDialogCancel");
      const supplementButton = document.querySelector('[data-action="supplement"]');
      const nodeDetailBackdrop = document.getElementById("nodeDetailDialogBackdrop");
      const nodeDetailDialog = document.getElementById("nodeDetailDialog");
      const nodeDetailClose = document.getElementById("nodeDetailDialogClose");
      const graphRunId = document.body.dataset.runId || "unknown";
      const dagViewport = document.querySelector("[data-dag-viewport]");
      const dagCanvasShell = document.querySelector("[data-dag-canvas-shell]");
      const dagCanvas = document.querySelector("[data-dag-canvas]");
      const dagSvg = document.querySelector("[data-dag-svg]");
      const dagZoomSelect = document.querySelector("[data-dag-zoom-select]");
      const edgePaths = Array.from(document.querySelectorAll("[data-edge-from][data-edge-to]"));
      const edgeLabelsById = new Map(Array.from(document.querySelectorAll("[data-edge-label-for]")).map((element) => [
        element.dataset.edgeLabelFor || "",
        element,
      ]));
      const allowedDagZoomPercents = [${DAG_ZOOM_PERCENT_OPTIONS.join(", ")}];
      const defaultDagZoomPercent = ${DAG_DEFAULT_ZOOM_PERCENT};
      const dagPortRatios = [${DAG_PORT_RATIOS.join(", ")}];
      const panMoveThreshold = 4;
      const nodeDragMoveThreshold = 4;
      let activeDrag = null;
      let activePan = null;
      let suppressNodeClickId = "";
      let lastDetailTrigger = null;

      function getSelectedNodeId() {
        return document.body.dataset.selectedNodeId || "";
      }

      function getStoredState() {
        return vscode.getState() || {};
      }

      function persistSelectedNode(nodeId) {
        const previous = getStoredState();
        vscode.setState({ ...previous, selectedGraphNodeId: nodeId });
      }

      function readNumber(value, fallback) {
        const parsed = Number.parseFloat(String(value ?? ""));
        return Number.isFinite(parsed) ? parsed : fallback;
      }

      function formatPathNumber(value) {
        return String(Math.round(value * 100) / 100);
      }

      function normalizeZoomPercent(value) {
        const parsed = Number.parseInt(String(value ?? ""), 10);
        return allowedDagZoomPercents.includes(parsed) ? parsed : defaultDagZoomPercent;
      }

      function getCurrentZoomPercent() {
        return normalizeZoomPercent(dagCanvas?.dataset.zoomPercent);
      }

      function getCurrentZoomScale() {
        return Math.max(0.01, getCurrentZoomPercent() / 100);
      }

      function getNodeBox(element) {
        return {
          x: readNumber(element.dataset.layoutX, readNumber(element.style.left, 0)),
          y: readNumber(element.dataset.layoutY, readNumber(element.style.top, 0)),
          width: readNumber(element.dataset.nodeWidth, element.offsetWidth || ${DAG_NODE_WIDTH}),
          height: readNumber(element.dataset.nodeHeight, element.offsetHeight || ${DAG_NODE_HEIGHT}),
        };
      }

      function setNodePosition(element, x, y) {
        const nextX = Math.max(0, Math.round(x));
        const nextY = Math.max(0, Math.round(y));
        element.dataset.layoutX = String(nextX);
        element.dataset.layoutY = String(nextY);
        element.style.left = nextX + "px";
        element.style.top = nextY + "px";
      }

      function resetNodePosition(element) {
        setNodePosition(
          element,
          readNumber(element.dataset.autoX, 0),
          readNumber(element.dataset.autoY, 0),
        );
      }

      function getBoxCenter(box) {
        return {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
      }

      function getPreferredPortSides(from, to) {
        const fromCenter = getBoxCenter(from);
        const toCenter = getBoxCenter(to);
        const dx = toCenter.x - fromCenter.x;
        const dy = toCenter.y - fromCenter.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
          return dx >= 0
            ? { fromSide: "right", toSide: "left" }
            : { fromSide: "left", toSide: "right" };
        }
        return dy >= 0
          ? { fromSide: "bottom", toSide: "top" }
          : { fromSide: "top", toSide: "bottom" };
      }

      function getPortHintRatioValue(portHint) {
        if (portHint === "start") {
          return 0.25;
        }
        if (portHint === "end") {
          return 0.75;
        }
        return 0.5;
      }

      function chooseEdgePortPair(from, to, portHint = "center") {
        if (from === to || (from.id && from.id === to.id)) {
          return getFallbackEdgePortPair(from, to);
        }
        const preferred = getPreferredPortSides(from, to);
        const nearest = getNearestBoxBorderPoints(from, to, getPortHintRatioValue(portHint));
        if (!nearest) {
          return getFallbackEdgePortPair(from, to);
        }
        return {
          fromPort: buildNearestPort(from, nearest.fromPoint, preferred.fromSide),
          toPort: buildNearestPort(to, nearest.toPoint, preferred.toSide),
          score: nearest.distance,
        };
      }

      function getNearestBoxBorderPoints(from, to, hintRatio) {
        const x = getNearestIntervalCoordinates(from.x, from.x + from.width, to.x, to.x + to.width, hintRatio);
        const y = getNearestIntervalCoordinates(from.y, from.y + from.height, to.y, to.y + to.height, hintRatio);
        if (x.overlaps && y.overlaps) {
          return null;
        }
        const dx = x.to - x.from;
        const dy = y.to - y.from;
        return {
          fromPoint: { x: x.from, y: y.from },
          toPoint: { x: x.to, y: y.to },
          distance: Math.sqrt((dx * dx) + (dy * dy)),
        };
      }

      function getNearestIntervalCoordinates(fromMin, fromMax, toMin, toMax, hintRatio) {
        if (fromMax <= toMin) {
          return { from: fromMax, to: toMin, overlaps: false };
        }
        if (toMax <= fromMin) {
          return { from: fromMin, to: toMax, overlaps: false };
        }
        const overlapMin = Math.max(fromMin, toMin);
        const overlapMax = Math.min(fromMax, toMax);
        const coordinate = overlapMin + (overlapMax - overlapMin) * hintRatio;
        return { from: coordinate, to: coordinate, overlaps: true };
      }

      function buildNearestPort(box, point, fallbackSide) {
        const side = resolveNearestPortSide(box, point, fallbackSide);
        const snappedPoint = snapPointToPortSide(box, side, point);
        return {
          id: side + "-" + getPortCoordinateLabel(box, side, snappedPoint),
          side,
          x: snappedPoint.x,
          y: snappedPoint.y,
        };
      }

      function snapPointToPortSide(box, side, point) {
        const rawRatio = side === "left" || side === "right"
          ? (point.y - box.y) / Math.max(1, box.height)
          : (point.x - box.x) / Math.max(1, box.width);
        const ratio = getNearestPortRatio(rawRatio);
        if (side === "left" || side === "right") {
          return {
            x: side === "right" ? box.x + box.width : box.x,
            y: box.y + box.height * ratio,
          };
        }
        return {
          x: box.x + box.width * ratio,
          y: side === "bottom" ? box.y + box.height : box.y,
        };
      }

      function getNearestPortRatio(rawRatio) {
        return dagPortRatios.reduce((nearest, ratio) => (
          Math.abs(rawRatio - ratio) < Math.abs(rawRatio - nearest) ? ratio : nearest
        ), dagPortRatios[0]);
      }

      function resolveNearestPortSide(box, point, fallbackSide) {
        const epsilon = 0.01;
        const candidates = [
          { side: "top", distance: Math.abs(point.y - box.y) },
          { side: "right", distance: Math.abs(point.x - (box.x + box.width)) },
          { side: "bottom", distance: Math.abs(point.y - (box.y + box.height)) },
          { side: "left", distance: Math.abs(point.x - box.x) },
        ];
        const minDistance = Math.min(...candidates.map((candidate) => candidate.distance));
        if (candidates.some((candidate) => candidate.side === fallbackSide && candidate.distance <= minDistance + epsilon)) {
          return fallbackSide;
        }
        return candidates.sort((left, right) => left.distance - right.distance)[0].side;
      }

      function getPortCoordinateLabel(box, side, point) {
        const ratio = side === "left" || side === "right"
          ? (point.y - box.y) / Math.max(1, box.height)
          : (point.x - box.x) / Math.max(1, box.width);
        const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
        return String(percent);
      }

      function getFallbackEdgePortPair(from, to) {
        return {
          fromPort: { id: "right-50", side: "right", x: from.x + from.width, y: from.y + from.height / 2 },
          toPort: { id: "left-50", side: "left", x: to.x, y: to.y + to.height / 2 },
          score: 0,
        };
      }

      function getPortNormal(side) {
        if (side === "top") {
          return { x: 0, y: -1 };
        }
        if (side === "right") {
          return { x: 1, y: 0 };
        }
        if (side === "bottom") {
          return { x: 0, y: 1 };
        }
        return { x: -1, y: 0 };
      }

      function buildCurvedEdgePath(fromPort, toPort, offset) {
        const dx = toPort.x - fromPort.x;
        const dy = toPort.y - fromPort.y;
        const distance = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        const curve = Math.max(${DAG_EDGE_CURVE_MIN}, Math.min(140, distance * 0.35));
        const fromNormal = getPortNormal(fromPort.side);
        const toNormal = getPortNormal(toPort.side);
        const offsetX = (-dy / distance) * offset;
        const offsetY = (dx / distance) * offset;
        const c1x = fromPort.x + fromNormal.x * curve + offsetX;
        const c1y = fromPort.y + fromNormal.y * curve + offsetY;
        const c2x = toPort.x + toNormal.x * curve + offsetX;
        const c2y = toPort.y + toNormal.y * curve + offsetY;
        return {
          path: [
            "M", formatPathNumber(fromPort.x), formatPathNumber(fromPort.y),
            "C", formatPathNumber(c1x), formatPathNumber(c1y) + ",",
            formatPathNumber(c2x), formatPathNumber(c2y) + ",",
            formatPathNumber(toPort.x), formatPathNumber(toPort.y),
          ].join(" "),
          labelX: cubicBezierPoint(fromPort.x, c1x, c2x, toPort.x, 0.5),
          labelY: cubicBezierPoint(fromPort.y, c1y, c2y, toPort.y, 0.5),
          maxX: Math.max(fromPort.x, toPort.x, c1x, c2x),
          maxY: Math.max(fromPort.y, toPort.y, c1y, c2y),
        };
      }

      function cubicBezierPoint(start, controlA, controlB, end, t) {
        const inverseT = 1 - t;
        return (inverseT * inverseT * inverseT * start)
          + (3 * inverseT * inverseT * t * controlA)
          + (3 * inverseT * t * t * controlB)
          + (t * t * t * end);
      }

      function buildEdgePathFromBoxes(from, to, options = {}) {
        const pair = chooseEdgePortPair(from, to, options.portHint || "center");
        const offset = readNumber(options.offset, 0);
        const edgePath = buildCurvedEdgePath(pair.fromPort, pair.toPort, offset);
        return {
          ...edgePath,
          fromPort: pair.fromPort.id,
          toPort: pair.toPort.id,
        };
      }

      function syncGraphCanvasAndEdges() {
        if (!dagCanvas) {
          return;
        }
        const nodeById = new Map();
        let maxX = readNumber(dagCanvas.dataset.autoWidth, 0);
        let maxY = readNumber(dagCanvas.dataset.autoHeight, 0);
        selectableNodes.forEach((element) => {
          const box = getNodeBox(element);
          const nodeId = element.dataset.nodeId || "";
          nodeById.set(nodeId, box);
          maxX = Math.max(maxX, box.x + box.width + ${DAG_MARGIN_X});
          maxY = Math.max(maxY, box.y + box.height + ${DAG_MARGIN_Y});
        });
        edgePaths.forEach((pathElement) => {
          const from = nodeById.get(pathElement.dataset.edgeFrom || "");
          const to = nodeById.get(pathElement.dataset.edgeTo || "");
          if (!from || !to) {
            return;
          }
          const edgePath = buildEdgePathFromBoxes(from, to, {
            offset: readNumber(pathElement.dataset.edgeOffset, 0),
            portHint: pathElement.dataset.edgePortHint || "center",
          });
          pathElement.setAttribute("d", edgePath.path);
          pathElement.dataset.fromPort = edgePath.fromPort;
          pathElement.dataset.toPort = edgePath.toPort;
          const edgeLabel = edgeLabelsById.get(pathElement.dataset.edgeId || "");
          if (edgeLabel) {
            edgeLabel.setAttribute("x", formatPathNumber(edgePath.labelX));
            edgeLabel.setAttribute("y", formatPathNumber(edgePath.labelY));
          }
          maxX = Math.max(maxX, edgePath.maxX + ${DAG_MARGIN_X});
          maxY = Math.max(maxY, edgePath.maxY + ${DAG_MARGIN_Y});
        });
        const zoomScale = getCurrentZoomScale();
        const viewportWidth = (dagViewport?.clientWidth || dagCanvas.parentElement?.clientWidth || 0) / zoomScale;
        const viewportHeight = (dagViewport?.clientHeight || dagCanvas.parentElement?.clientHeight || 0) / zoomScale;
        const width = Math.max(maxX, viewportWidth);
        const height = Math.max(maxY, viewportHeight);
        dagCanvas.style.width = Math.ceil(width) + "px";
        dagCanvas.style.height = Math.ceil(height) + "px";
        if (dagCanvasShell) {
          dagCanvasShell.style.width = Math.ceil(width * zoomScale) + "px";
          dagCanvasShell.style.height = Math.ceil(height * zoomScale) + "px";
        }
        if (dagSvg) {
          dagSvg.setAttribute("width", String(Math.ceil(width)));
          dagSvg.setAttribute("height", String(Math.ceil(height)));
          dagSvg.setAttribute("viewBox", "0 0 " + Math.ceil(width) + " " + Math.ceil(height));
        }
      }

      function getSavedRunLayout() {
        const previous = getStoredState();
        return previous.graphRunLayouts?.[graphRunId] || {};
      }

      function getSavedManualLayout() {
        return getSavedRunLayout().nodes || {};
      }

      function getSavedZoomPercent() {
        return normalizeZoomPercent(getSavedRunLayout().zoom);
      }

      function persistRunLayout(updates) {
        const previous = getStoredState();
        const graphRunLayouts = { ...(previous.graphRunLayouts || {}) };
        graphRunLayouts[graphRunId] = {
          ...getSavedRunLayout(),
          ...updates,
          updatedAt: Date.now(),
        };
        vscode.setState({ ...previous, graphRunLayouts });
      }

      function persistManualLayout() {
        const nodes = {};
        selectableNodes.forEach((element) => {
          const nodeId = element.dataset.nodeId || "";
          if (!nodeId) {
            return;
          }
          const box = getNodeBox(element);
          nodes[nodeId] = { x: box.x, y: box.y };
        });
        persistRunLayout({ nodes });
      }

      function persistZoom(zoomPercent) {
        persistRunLayout({ zoom: normalizeZoomPercent(zoomPercent) });
      }

      function applyZoom(zoomPercent, options = {}) {
        const normalized = normalizeZoomPercent(zoomPercent);
        const zoomScale = normalized / 100;
        if (dagZoomSelect) {
          dagZoomSelect.value = String(normalized);
        }
        if (dagCanvas) {
          dagCanvas.dataset.zoomPercent = String(normalized);
          dagCanvas.dataset.zoomScale = String(zoomScale);
          dagCanvas.style.transform = "scale(" + zoomScale + ")";
        }
        syncGraphCanvasAndEdges();
        if (options.persist !== false) {
          persistZoom(normalized);
        }
      }

      function applySavedManualLayout() {
        const savedNodes = getSavedManualLayout();
        selectableNodes.forEach((element) => {
          const nodeId = element.dataset.nodeId || "";
          const saved = savedNodes[nodeId];
          if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
            setNodePosition(element, saved.x, saved.y);
          } else {
            resetNodePosition(element);
          }
        });
        syncGraphCanvasAndEdges();
      }

      function centerDagViewportOnNode(nodeId) {
        if (!dagViewport || !nodeId) {
          return;
        }
        const target = selectableNodes.find((element) => element.dataset.nodeId === nodeId);
        if (!target) {
          return;
        }
        const box = getNodeBox(target);
        const zoomScale = getCurrentZoomScale();
        const centerX = (box.x + box.width / 2) * zoomScale;
        const centerY = (box.y + box.height / 2) * zoomScale;
        dagViewport.scrollLeft = Math.max(0, Math.round(centerX - dagViewport.clientWidth / 2));
        dagViewport.scrollTop = Math.max(0, Math.round(centerY - dagViewport.clientHeight / 2));
      }

      function resolveInitialViewportNodeId(preferredNodeId) {
        if (preferredNodeId && nodeIds.includes(preferredNodeId)) {
          return preferredNodeId;
        }
        const priorityClasses = ["status-running", "status-sleeping", "status-blocked", "status-failed"];
        for (const statusClass of priorityClasses) {
          const target = selectableNodes.find((element) => element.classList.contains(statusClass));
          if (target?.dataset.nodeId) {
            return target.dataset.nodeId;
          }
        }
        return nodeIds[0] || "";
      }

      function centerInitialDagViewport(nodeId) {
        const targetNodeId = resolveInitialViewportNodeId(nodeId);
        if (!targetNodeId) {
          return;
        }
        window.requestAnimationFrame?.(() => {
          syncGraphCanvasAndEdges();
          centerDagViewportOnNode(targetNodeId);
        });
      }

      function resetManualLayout() {
        const previous = getStoredState();
        const graphRunLayouts = { ...(previous.graphRunLayouts || {}) };
        const nextRunLayout = { ...(graphRunLayouts[graphRunId] || {}) };
        delete nextRunLayout.nodes;
        if (Number.isFinite(nextRunLayout.zoom)) {
          graphRunLayouts[graphRunId] = {
            ...nextRunLayout,
            updatedAt: Date.now(),
          };
        } else {
          delete graphRunLayouts[graphRunId];
        }
        vscode.setState({ ...previous, graphRunLayouts });
        selectableNodes.forEach((element) => {
          resetNodePosition(element);
        });
        syncGraphCanvasAndEdges();
      }

      function startNodeDrag(element, event) {
        if (event.button !== 0) {
          return;
        }
        const box = getNodeBox(element);
        activeDrag = {
          element,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startX: box.x,
          startY: box.y,
          moved: false,
        };
        element.classList.add("dragging");
        element.setPointerCapture?.(event.pointerId);
      }

      function moveNodeDrag(event) {
        if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
          return;
        }
        const rawDx = event.clientX - activeDrag.startClientX;
        const rawDy = event.clientY - activeDrag.startClientY;
        if (Math.abs(rawDx) > nodeDragMoveThreshold || Math.abs(rawDy) > nodeDragMoveThreshold) {
          activeDrag.moved = true;
          event.preventDefault();
        }
        if (!activeDrag.moved) {
          return;
        }
        const zoomScale = getCurrentZoomScale();
        const dx = rawDx / zoomScale;
        const dy = rawDy / zoomScale;
        setNodePosition(activeDrag.element, activeDrag.startX + dx, activeDrag.startY + dy);
        syncGraphCanvasAndEdges();
      }

      function finishNodeDrag(event) {
        if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
          return;
        }
        const draggedNodeId = activeDrag.element.dataset.nodeId || "";
        activeDrag.element.classList.remove("dragging");
        activeDrag.element.releasePointerCapture?.(event.pointerId);
        if (activeDrag.moved) {
          suppressNodeClickId = draggedNodeId;
          event.preventDefault();
          event.stopPropagation();
          persistManualLayout();
          window.setTimeout(() => {
            if (suppressNodeClickId === draggedNodeId) {
              suppressNodeClickId = "";
            }
          }, 250);
        }
        activeDrag = null;
      }

      function setSelectedNode(nodeId, options = {}) {
        if (!nodeId || !nodeIds.includes(nodeId)) {
          return;
        }
        document.body.dataset.selectedNodeId = nodeId;
        selectableNodes.forEach((element) => {
          const selected = element.dataset.nodeId === nodeId;
          element.classList.toggle("selected", selected);
          if (selected) {
            element.setAttribute("aria-current", "true");
          } else {
            element.removeAttribute("aria-current");
          }
        });
        document.querySelectorAll("[data-node-detail]").forEach((element) => {
          element.hidden = element.dataset.nodeDetail !== nodeId;
        });
        if (options.focus === true) {
          const target = selectableNodes.find((element) => element.dataset.nodeId === nodeId);
          target?.focus();
        }
        if (options.persist !== false) {
          persistSelectedNode(nodeId);
        }
      }

      function setSupplementError(message) {
        if (supplementError) {
          supplementError.textContent = message || "";
        }
      }

      function openSupplementDialog() {
        if (!supplementBackdrop || !supplementInput) {
          return;
        }
        setSupplementError("");
        supplementInput.value = "${escapeJsString(strings.supplementPromptDefault)}";
        supplementBackdrop.classList.add("visible");
        supplementBackdrop.setAttribute("aria-hidden", "false");
        window.setTimeout(() => {
          supplementInput.focus();
          supplementInput.select();
        }, 0);
      }

      function closeSupplementDialog() {
        if (!supplementBackdrop) {
          return;
        }
        supplementBackdrop.classList.remove("visible");
        supplementBackdrop.setAttribute("aria-hidden", "true");
        setSupplementError("");
      }

      function submitSupplementDialog() {
        if (!supplementInput) {
          return;
        }
        const prompt = supplementInput.value.trim();
        if (!prompt) {
          setSupplementError("${escapeJsString(strings.supplementPromptRequired)}");
          supplementInput.focus();
          return;
        }
        closeSupplementDialog();
        if (supplementButton) {
          supplementButton.disabled = true;
        }
        vscode.postMessage({
          type: "graphRun:supplementRun",
          prompt,
          selectedNodeId: getSelectedNodeId() || null,
        });
      }

      function openNodeDetailDialog(nodeId, options = {}) {
        if (!nodeDetailBackdrop || !nodeDetailDialog || !nodeId || !nodeIds.includes(nodeId)) {
          return;
        }
        setSelectedNode(nodeId, { persist: options.persist });
        lastDetailTrigger = options.trigger || selectableNodes.find((element) => element.dataset.nodeId === nodeId) || null;
        nodeDetailBackdrop.classList.add("visible");
        nodeDetailBackdrop.setAttribute("aria-hidden", "false");
        nodeDetailDialog.scrollTop = 0;
        window.setTimeout(() => {
          nodeDetailClose?.focus();
        }, 0);
      }

      function closeNodeDetailDialog() {
        if (!nodeDetailBackdrop) {
          return;
        }
        nodeDetailBackdrop.classList.remove("visible");
        nodeDetailBackdrop.setAttribute("aria-hidden", "true");
        if (lastDetailTrigger?.isConnected) {
          lastDetailTrigger.focus();
        }
      }

      function isNodeDetailDialogOpen() {
        return Boolean(nodeDetailBackdrop?.classList.contains("visible"));
      }

      function isCanvasPanBlockedTarget(target) {
        return Boolean(target?.closest?.(
          "[data-node-id], button, select, input, textarea, a, [role='dialog'], [data-action]",
        ));
      }

      function startCanvasPan(event) {
        if (!dagViewport || event.button !== 0 || isCanvasPanBlockedTarget(event.target)) {
          return;
        }
        activePan = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startScrollLeft: dagViewport.scrollLeft,
          startScrollTop: dagViewport.scrollTop,
          moved: false,
        };
        dagViewport.setPointerCapture?.(event.pointerId);
      }

      function moveCanvasPan(event) {
        if (!activePan || activePan.pointerId !== event.pointerId || !dagViewport) {
          return;
        }
        const rawDx = event.clientX - activePan.startClientX;
        const rawDy = event.clientY - activePan.startClientY;
        if (!activePan.moved && (Math.abs(rawDx) > panMoveThreshold || Math.abs(rawDy) > panMoveThreshold)) {
          activePan.moved = true;
          dagViewport.classList.add("panning");
        }
        if (!activePan.moved) {
          return;
        }
        event.preventDefault();
        dagViewport.scrollLeft = activePan.startScrollLeft - rawDx;
        dagViewport.scrollTop = activePan.startScrollTop - rawDy;
      }

      function finishCanvasPan(event) {
        if (!activePan || activePan.pointerId !== event.pointerId || !dagViewport) {
          return;
        }
        dagViewport.releasePointerCapture?.(event.pointerId);
        dagViewport.classList.remove("panning");
        activePan = null;
      }

      selectableNodes.forEach((element) => {
        element.addEventListener("pointerdown", (event) => {
          startNodeDrag(element, event);
        });
        element.addEventListener("pointermove", moveNodeDrag);
        element.addEventListener("pointerup", finishNodeDrag);
        element.addEventListener("pointercancel", finishNodeDrag);
        element.addEventListener("click", (event) => {
          if (suppressNodeClickId === element.dataset.nodeId) {
            event.preventDefault();
            event.stopPropagation();
            suppressNodeClickId = "";
            return;
          }
          event.preventDefault();
          openNodeDetailDialog(element.dataset.nodeId || "", { trigger: element, persist: true });
        });
        element.addEventListener("dblclick", (event) => {
          event.preventDefault();
          openNodeDetailDialog(element.dataset.nodeId || "", { trigger: element });
        });
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openNodeDetailDialog(element.dataset.nodeId || "", { trigger: element, persist: true });
          }
        });
      });

      dagViewport?.addEventListener("pointerdown", startCanvasPan);
      dagViewport?.addEventListener("pointermove", moveCanvasPan);
      dagViewport?.addEventListener("pointerup", finishCanvasPan);
      dagViewport?.addEventListener("pointercancel", finishCanvasPan);

      document.querySelectorAll("[data-action]").forEach((element) => {
        element.addEventListener("click", () => {
          const action = element.dataset.action || "";
          const selectedNodeId = getSelectedNodeId() || null;
          if (action === "refresh") {
            vscode.postMessage({ type: "graphRun:refresh", selectedNodeId });
            return;
          }
          if (action === "resetLayout") {
            resetManualLayout();
            return;
          }
          if (action === "continue") {
            vscode.postMessage({ type: "graphRun:continue", selectedNodeId });
            return;
          }
          if (action === "supplement") {
            openSupplementDialog();
            return;
          }
          if (action === "stop") {
            vscode.postMessage({ type: "graphRun:stopRun", selectedNodeId });
            return;
          }
	          if (action === "retry") {
	            vscode.postMessage({
	              type: "graphRun:retryNode",
	              nodeId: element.dataset.controlNodeId || "",
	              selectedNodeId,
	            });
	            return;
	          }
	          if (action === "feedback") {
	            vscode.postMessage({
	              type: "graphRun:feedbackNode",
	              nodeId: element.dataset.controlNodeId || "",
	              selectedNodeId,
	            });
          }
        });
      });

      dagZoomSelect?.addEventListener("change", () => {
        applyZoom(dagZoomSelect.value);
      });

      supplementConfirm?.addEventListener("click", submitSupplementDialog);
      supplementCancel?.addEventListener("click", closeSupplementDialog);
      supplementBackdrop?.addEventListener("click", (event) => {
        if (event.target === supplementBackdrop) {
          closeSupplementDialog();
        }
      });
      supplementInput?.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          submitSupplementDialog();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeSupplementDialog();
        }
      });
      nodeDetailClose?.addEventListener("click", closeNodeDetailDialog);
      nodeDetailClose?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          closeNodeDetailDialog();
        }
      });
      nodeDetailBackdrop?.addEventListener("click", (event) => {
        if (event.target === nodeDetailBackdrop) {
          closeNodeDetailDialog();
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isNodeDetailDialogOpen()) {
          event.preventDefault();
          closeNodeDetailDialog();
        }
      });

      applyZoom(getSavedZoomPercent(), { persist: false });
      applySavedManualLayout();

      const persisted = getStoredState().selectedGraphNodeId;
      const serverSelected = getSelectedNodeId();
      const initialSelected = nodeIds.includes(serverSelected)
        ? serverSelected
        : nodeIds.includes(persisted)
          ? persisted
          : nodeIds[0];
      if (initialSelected) {
        setSelectedNode(initialSelected, { persist: false });
      }
      centerInitialDagViewport(serverSelected || persisted || "");
    </script>
  </body>
</html>`;
}

function renderRunControls(state: GraphRunPanelState, strings: GraphRunPanelStrings): string {
  const buttons: string[] = [];
  if (state.runControl.canContinue) {
    buttons.push(`<button class="button" type="button" data-action="continue">${escapeHtml(strings.continueRun)}</button>`);
  }
  if (state.runControl.canSupplement) {
    buttons.push(`<button class="button" type="button" data-action="supplement" title="${escapeHtml(strings.supplementRunTitle)}">${escapeHtml(strings.supplementRun)}</button>`);
  }
  if (state.runControl.canStop) {
    buttons.push(`<button class="button button-danger" type="button" data-action="stop" title="${escapeHtml(strings.stopRunTitle)}">${escapeHtml(strings.stopRun)}</button>`);
  }
  return buttons.join("");
}

function renderSupplementDialog(strings: GraphRunPanelStrings): string {
  return `<div id="supplementDialogBackdrop" class="dialog-backdrop" aria-hidden="true">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="supplementDialogTitle" aria-describedby="supplementDialogDescription">
      <div class="dialog-header">
        <h2 id="supplementDialogTitle" class="dialog-title">${escapeHtml(strings.supplementDialogTitle)}</h2>
        <p id="supplementDialogDescription" class="dialog-description">${escapeHtml(strings.supplementDialogDescription)}</p>
      </div>
      <div class="dialog-body">
        <label class="dialog-label" for="supplementDialogInput">${escapeHtml(strings.supplementPromptLabel)}</label>
        <textarea id="supplementDialogInput" class="dialog-textarea" spellcheck="true">${escapeHtml(strings.supplementPromptDefault)}</textarea>
        <div id="supplementDialogError" class="dialog-error" aria-live="polite"></div>
      </div>
      <div class="dialog-actions">
        <button id="supplementDialogCancel" class="button" type="button">${escapeHtml(strings.supplementCancel)}</button>
        <button id="supplementDialogConfirm" class="button" type="button">${escapeHtml(strings.supplementConfirm)}</button>
      </div>
    </div>
  </div>`;
}

function renderGraphDag(state: GraphRunPanelState, strings: GraphRunPanelStrings): string {
  if (!state.nodes.length) {
    return `<section class="section graph-dag" aria-labelledby="graph-dag-title">
      <h2 id="graph-dag-title" class="sr-only">${escapeHtml(strings.graphView)}</h2>
      ${renderGraphCanvasNotices(state, strings)}
      <div class="empty-card">${escapeHtml(strings.noNodes)}</div>
    </section>`;
  }
  const dagState = buildGraphDagRenderState(state);
  const layout = buildDagLayout(dagState, strings);
  const hasActiveEdges = dagState.edges.some((edge) => edge.active);
  return `<section class="section graph-dag" aria-labelledby="graph-dag-title">
    <h2 id="graph-dag-title" class="sr-only">${escapeHtml(strings.graphView)}</h2>
    <div class="graph-dag-toolbar" aria-label="${escapeHtml(strings.graphTools)}">
      <button class="button button-compact dag-icon-button" type="button" data-action="resetLayout" title="${escapeHtml(strings.resetLayoutTitle)}" aria-label="${escapeHtml(strings.resetLayoutTitle)}">↺</button>
      <label class="sr-only" for="dagZoomSelect">${escapeHtml(strings.zoomLevel)}</label>
      <select id="dagZoomSelect" class="dag-zoom-select" data-dag-zoom-select title="${escapeHtml(strings.zoomLevel)}" aria-label="${escapeHtml(strings.zoomLevel)}">
        ${renderDagZoomOptions()}
      </select>
    </div>
    ${renderGraphCanvasNotices(state, strings)}
    ${hasActiveEdges ? "" : `<div class="empty-card dag-empty">${escapeHtml(strings.noEdges)}</div>`}
    <div class="dag-viewport" data-dag-viewport role="group" aria-label="${escapeHtml(strings.graphView)}">
      <div class="dag-canvas-shell" data-dag-canvas-shell style="width: ${scaleDagSize(layout.width, DAG_DEFAULT_ZOOM_PERCENT)}px; height: ${scaleDagSize(layout.height, DAG_DEFAULT_ZOOM_PERCENT)}px;">
        <div class="dag-canvas" data-dag-canvas data-layout-engine="@dagrejs/dagre" data-auto-layout-direction="${layout.config.direction}" data-auto-ranksep="${layout.config.ranksep}" data-auto-nodesep="${layout.config.nodesep}" data-auto-edgesep="${layout.config.edgesep}" data-auto-margin-x="${layout.config.marginX}" data-auto-margin-y="${layout.config.marginY}" data-auto-width="${layout.width}" data-auto-height="${layout.height}" data-default-zoom="${DAG_DEFAULT_ZOOM_PERCENT}" data-zoom-percent="${DAG_DEFAULT_ZOOM_PERCENT}" data-zoom-scale="${DAG_DEFAULT_ZOOM_PERCENT / 100}" style="width: ${layout.width}px; height: ${layout.height}px; transform: scale(${DAG_DEFAULT_ZOOM_PERCENT / 100});">
          ${layout.edgeLayouts.length ? renderDagSvg(layout, strings) : ""}
          ${layout.nodeLayouts.map((nodeLayout) => renderDagNode(nodeLayout, dagState, strings)).join("")}
        </div>
      </div>
    </div>
    ${renderDagEdgeAccessibilityList(dagState.edges, strings)}
  </section>`;
}

function buildGraphDagRenderState(state: GraphRunPanelState): GraphRunPanelState {
  const edges = selectDagFlowEdges(state.edges);
  return edges.length === state.edges.length ? state : { ...state, edges };
}

function renderGraphCanvasNotices(state: GraphRunPanelState, strings: GraphRunPanelStrings): string {
  const notices: string[] = [];
  if (state.error) {
    notices.push(`<div class="error-card graph-notice">${escapeHtml(state.error)}</div>`);
  }
  if (state.run.supplementalRequirements.length) {
    notices.push(renderGraphNoticeCard(
      strings.supplementalRequirements,
      state.run.supplementalRequirements.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    ));
  }
  return notices.length ? `<div class="graph-notices">${notices.join("")}</div>` : "";
}

function renderGraphNoticeCard(label: string, value: string): string {
  return `<div class="empty-card graph-notice">
    <div class="label">${escapeHtml(label)}</div>
    <div class="pre-wrap">${escapeHtml(value)}</div>
  </div>`;
}

function renderDagZoomOptions(): string {
  return DAG_ZOOM_PERCENT_OPTIONS.map((option) => (
    `<option value="${option}"${option === DAG_DEFAULT_ZOOM_PERCENT ? " selected" : ""}>${option}%</option>`
  )).join("");
}

function scaleDagSize(value: number, zoomPercent: number): number {
  return Math.ceil(value * (zoomPercent / 100));
}

function renderDagSvg(layout: DagLayout, strings: GraphRunPanelStrings): string {
  return `<svg class="dag-edges" data-dag-svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true" focusable="false">
    <defs>
      <marker id="graph-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path class="dag-arrowhead" d="M 0 0 L 10 5 L 0 10 z"></path>
      </marker>
      <marker id="graph-arrowhead-visited" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path class="dag-arrowhead dag-arrowhead-visited" d="M 0 0 L 10 5 L 0 10 z"></path>
      </marker>
    </defs>
    ${layout.edgeLayouts.map(({ edge, path, label, displayLabel, fromPort, toPort, portHint, offset, labelX, labelY }) => {
      const activeClass = edge.active ? "active" : "inactive";
      const visited = edge.visited ? "true" : "false";
      const markerId = edge.visited ? "graph-arrowhead-visited" : "graph-arrowhead";
      const pathId = `dag-edge-${toSafeDomId(edge.id)}`;
      return `<path id="${escapeHtml(pathId)}" class="dag-edge-path ${activeClass} edge-kind-${escapeHtml(edge.kind)}" data-edge-id="${escapeHtml(edge.id)}" data-edge-from="${escapeHtml(edge.from)}" data-edge-to="${escapeHtml(edge.to)}" data-from-port="${escapeHtml(fromPort)}" data-to-port="${escapeHtml(toPort)}" data-edge-port-hint="${portHint}" data-edge-offset="${offset}" data-edge-label="${escapeHtml(label)}" data-edge-display-label="${escapeHtml(displayLabel)}" data-edge-visited="${visited}" d="${escapeHtml(path)}" marker-end="url(#${markerId})">
        <title>${escapeHtml(label || strings.none)}</title>
      </path>
      ${renderDagEdgeDisplayLabel(edge.id, displayLabel, activeClass, labelX, labelY)}`;
    }).join("")}
  </svg>`;
}

function renderDagEdgeDisplayLabel(
  edgeId: string,
  displayLabel: string,
  activeClass: string,
  labelX: number,
  labelY: number,
): string {
  if (!displayLabel) {
    return "";
  }
  return `<text class="dag-edge-label ${activeClass}" data-edge-label-for="${escapeHtml(edgeId)}" x="${formatPathCoordinate(labelX)}" y="${formatPathCoordinate(labelY)}" text-anchor="middle" dominant-baseline="central" aria-hidden="true">${escapeHtml(displayLabel)}</text>`;
}

function renderDagNode(
  layout: DagNodeLayout,
  state: GraphRunPanelState,
  strings: GraphRunPanelStrings,
): string {
  const node = layout.node;
  const selected = node.id === state.selectedNodeId ? " selected" : "";
  const semantic = getNodeSemantic(node, state.edges, strings);
  const tone = getNodeTone(node, semantic.kind);
  const ariaLabel = interpolateGraphRunPanelString(strings.graphNodeAria, {
    title: node.title,
    status: node.statusLabel,
    kind: node.kindLabel,
    attempts: `${node.attempts}/${node.maxAttempts}`,
    dependsCount: String(node.dependsOn.length),
    unlocksCount: String(node.unlocks.length),
  });
  return `<button
    class="dag-node node-select-target${selected} ${statusClassName(node.status)} kind-${escapeHtml(node.kind)} node-tone-${tone} semantic-${semantic.kind}"
    type="button"
    data-node-id="${escapeHtml(node.id)}"
    data-node-semantic="${semantic.kind}"
    data-node-tone="${tone}"
    data-node-kind-tone="${tone}"
    data-dag-order="${layout.order}"
    data-auto-x="${layout.x}"
    data-auto-y="${layout.y}"
    data-node-width="${layout.width}"
    data-node-height="${layout.height}"
    aria-label="${escapeHtml(ariaLabel)}"
    ${selected ? "aria-current=\"true\"" : ""}
    style="left: ${layout.x}px; top: ${layout.y}px; width: ${layout.width}px; height: ${layout.height}px;"
		  >
		    <span class="dag-tone-stripe" aria-hidden="true"></span>
		    <span class="dag-node-header">
		      <span class="dag-kind-chip">${escapeHtml(node.kindLabel)}</span>
		      <span class="semantic-chip semantic-${semantic.kind}">${escapeHtml(semantic.label)}</span>
		    </span>
	    <span class="dag-node-title" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</span>
	    <span class="dag-node-footer">
	      <span class="status-pill ${statusClassName(node.status)}">${escapeHtml(node.statusLabel)}</span>
	    </span>
	    ${renderDagNodePorts()}
	  </button>`;
	}

function renderDagNodePorts(): string {
  return DAG_PORT_RATIOS.flatMap((ratio) => {
    const label = String(Math.round(ratio * 100));
    const percent = `${ratio * 100}%`;
    return [
      `<span class="dag-port-dot port-top" data-port-id="top-${label}" aria-hidden="true" style="left: ${percent}; top: 0;"></span>`,
      `<span class="dag-port-dot port-right" data-port-id="right-${label}" aria-hidden="true" style="left: 100%; top: ${percent};"></span>`,
      `<span class="dag-port-dot port-bottom" data-port-id="bottom-${label}" aria-hidden="true" style="left: ${percent}; top: 100%;"></span>`,
      `<span class="dag-port-dot port-left" data-port-id="left-${label}" aria-hidden="true" style="left: 0; top: ${percent};"></span>`,
    ];
  }).join("");
}

function getNodeSemantic(
  node: GraphRunPanelNode,
  edges: readonly GraphRunPanelEdge[],
  strings: GraphRunPanelStrings,
): { kind: GraphNodeSemanticKind; label: string } {
  const incoming = edges.filter((edge) => edge.to === node.id && edge.active !== false);
  const outgoing = edges.filter((edge) => edge.from === node.id && edge.active !== false);
  const hasDecisionEdge = outgoing.some((edge) => (
    edge.kind === "if_pass"
    || edge.kind === "if_fail"
    || edge.kind === "human_approved"
    || edge.kind === "review_feedback"
  ));
  const hasConditionalBranch = outgoing.filter((edge) => (
    edge.kind === "if_pass"
    || edge.kind === "if_fail"
    || edge.condition
    || edge.conditionExpression
  )).length >= 2;
  if (hasDecisionEdge || hasConditionalBranch) {
    return { kind: "decision", label: strings.semanticDecision };
  }
  if (incoming.length === 0 || node.kind === "intake" || (node.kind === "plan" && node.dependsOn.length === 0)) {
    return { kind: "start", label: strings.semanticStart };
  }
  if (outgoing.length === 0 || node.kind === "summary") {
    return { kind: "end", label: strings.semanticEnd };
  }
  return { kind: "normal", label: strings.semanticStep };
}

function renderDagEdgeAccessibilityList(
  edges: readonly GraphRunPanelEdge[],
  strings: GraphRunPanelStrings,
): string {
  if (!edges.length) {
    return "";
  }
  const items = edges.map((edge) => {
    const label = formatEdgeAriaLabel(edge, strings);
    return `<li aria-label="${escapeHtml(label)}">${escapeHtml(label)}</li>`;
  }).join("");
  return `<ul class="sr-only">${items}</ul>`;
}

function renderNodeDetails(state: GraphRunPanelState, strings: GraphRunPanelStrings): string {
  const errorHtml = state.error ? `<div class="error-card">${escapeHtml(state.error)}</div>` : "";
  const supplementHtml = renderSupplementalRequirements(state, strings);
  let bodyHtml: string;
  if (!state.nodes.length) {
    const evidenceHtml = renderEvidencePanel(state.selectedEvidence, strings);
    bodyHtml = `${errorHtml}${supplementHtml}${evidenceHtml}<div class="empty-card">${escapeHtml(strings.noSelection)}</div>`;
  } else {
    bodyHtml = `${errorHtml}${supplementHtml}${state.nodes.map((node) => renderNodeDetailArticle(node, state, strings)).join("")}`;
  }
  return `<div id="nodeDetailDialogBackdrop" class="dialog-backdrop node-detail-backdrop" data-node-detail-dialog-backdrop aria-hidden="true">
    <div id="nodeDetailDialog" class="dialog node-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="nodeDetailDialogTitle">
      <div class="dialog-header node-detail-dialog-header">
        <div>
          <h2 id="nodeDetailDialogTitle" class="dialog-title">${escapeHtml(strings.details)}</h2>
          <p class="dialog-description">${escapeHtml(strings.selectedNode)}</p>
        </div>
        <svg id="nodeDetailDialogClose" class="node-detail-close-icon" data-node-detail-close role="button" tabindex="0" aria-label="${escapeHtml(strings.closeDetails)}" viewBox="0 0 16 16">
          <title>${escapeHtml(strings.closeDetails)}</title>
          <path d="M4 4l8 8M12 4 4 12" aria-hidden="true"></path>
        </svg>
      </div>
      <div class="dialog-body node-detail-dialog-body">
        ${bodyHtml}
      </div>
    </div>
  </div>`;
}

function renderSupplementalRequirements(state: GraphRunPanelState, strings: GraphRunPanelStrings): string {
  if (!state.run.supplementalRequirements.length) {
    return "";
  }
  return renderTextBlock(
    strings.supplementalRequirements,
    state.run.supplementalRequirements.map((item, index) => `${index + 1}. ${item}`).join("\n"),
  );
}

function renderNodeDetailArticle(
  node: GraphRunPanelNode,
  state: GraphRunPanelState,
  strings: GraphRunPanelStrings,
): string {
  const selected = node.id === state.selectedNodeId;
  return `<article class="detail-card" data-node-detail="${escapeHtml(node.id)}" ${selected ? "" : "hidden"}>
    <div class="detail-heading">
      <div>
        <div class="label">${escapeHtml(strings.selectedNode)}</div>
        <h3>${escapeHtml(node.title)}</h3>
      </div>
      <span class="status-pill ${statusClassName(node.status)}">${escapeHtml(node.statusLabel)}</span>
    </div>
    ${renderNodeControls(node, strings)}
    <div class="detail-grid">
      ${renderMetaCard(strings.nodeId, node.id)}
      ${renderMetaCard(strings.status, node.statusLabel, statusClassName(node.status))}
      ${renderMetaCard(strings.kind, node.kindLabel)}
      ${renderMetaCard(strings.ownerRole, node.ownerRoleLabel)}
      ${renderMetaCard(strings.attempts, `${node.attempts}/${node.maxAttempts}`)}
      ${renderMetaCard(strings.startedAt, formatDateTime(node.startedAt, strings))}
      ${renderMetaCard(strings.completedAt, formatDateTime(node.completedAt, strings))}
      ${renderMetaCard(strings.wakeAt, formatDateTime(node.wakeAt, strings))}
      ${renderMetaCard(strings.conflictGroup, node.conflictGroup || strings.none)}
      ${renderMetaCard(strings.promptRef, node.promptRef || strings.none)}
      ${renderMetaCard(strings.artifactRef, node.artifactRef || strings.none)}
      ${renderMetaCard(strings.communicationFile, node.communicationFile || strings.none)}
    </div>
    ${renderPathSection(strings.dependsOn, node.dependsOn, strings)}
    ${renderPathSection(strings.unlocks, node.unlocks, strings)}
    ${renderPathSection(strings.writeFiles, node.writeFiles, strings)}
    ${node.lastError ? renderTextBlock(strings.lastError, node.lastError) : ""}
    ${renderTextBlock(strings.acceptance, formatAcceptance(node, strings))}
    ${renderEvidencePanel(buildEvidenceForNode(node, state), strings)}
  </article>`;
}

function renderNodeControls(node: GraphRunPanelNode, strings: GraphRunPanelStrings): string {
  const buttons: string[] = [];
	  if (node.control.canRetry) {
	    buttons.push(`<button class="button" type="button" data-action="retry" data-control-node-id="${escapeHtml(node.id)}">${escapeHtml(strings.retryNode)}</button>`);
	  }
	  if (node.control.canFeedback) {
	    buttons.push(`<button class="button" type="button" data-action="feedback" data-control-node-id="${escapeHtml(node.id)}">${escapeHtml(strings.feedbackNode)}</button>`);
	  }
  if (!buttons.length) {
    return "";
  }
  return `<div class="detail-actions" aria-label="${escapeHtml(strings.nodeActions)}">${buttons.join("")}</div>`;
}

function renderEvidencePanel(
  evidence: readonly GraphRunPanelEvidenceItem[],
  strings: GraphRunPanelStrings,
): string {
  const body = evidence.length
    ? evidence.map((item) => formatEvidenceItem(item, strings)).join("\n")
    : strings.evidenceNone;
  return `<div class="path-list">
    <div class="label">${escapeHtml(strings.evidencePanel)}</div>
    <div>${escapeHtml(strings.evidenceDescription)}</div>
    <div class="pre-wrap">${escapeHtml(body)}</div>
  </div>`;
}

function buildEvidenceForNode(
  node: GraphRunPanelNode,
  state: GraphRunPanelState,
): GraphRunPanelEvidenceItem[] {
  const evidence: GraphRunPanelEvidenceItem[] = [];
  const seen = new Set<string>();
  const addEvidence = (item: GraphRunPanelEvidenceItem): void => {
    const value = String(item.value ?? "").trim();
    if (!value) {
      return;
    }
    const key = `${item.kind}:${value}:${item.detail ?? ""}:${item.timestamp ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    evidence.push({ ...item, value });
  };

  if (node.artifactRef) {
    addEvidence({ kind: "artifactRef", value: node.artifactRef, detail: node.title });
  }
  if (node.communicationFile) {
    addEvidence({ kind: "communicationFile", value: node.communicationFile, detail: node.title });
  }
  node.acceptance.forEach((item) => {
    if (item.evidenceRef) {
      addEvidence({ kind: "acceptanceEvidence", value: item.evidenceRef, detail: item.name });
    }
  });
  state.events
    .filter((event) => event.nodeId === node.id)
    .slice(0, 6)
    .forEach((event) => {
      addEvidence({
        kind: "event",
        value: event.type,
        detail: event.error || event.summary || event.eventId,
        timestamp: event.timestamp,
      });
    });
  (state.run.finalAnswer?.evidence ?? []).slice(0, 8).forEach((item) => {
    addEvidence({
      kind: "finalAnswer",
      value: item,
      detail: state.run.finalAnswer?.conclusion,
    });
  });
  return evidence;
}

function formatEvidenceItem(
  item: GraphRunPanelEvidenceItem,
  strings: GraphRunPanelStrings,
): string {
  const labelByKind: Record<GraphRunPanelEvidenceItem["kind"], string> = {
    artifactRef: strings.evidenceArtifactRef,
    communicationFile: strings.evidenceCommunicationFile,
    acceptanceEvidence: strings.evidenceAcceptanceRef,
    event: strings.evidenceEvent,
    finalAnswer: strings.evidenceFinalAnswer,
  };
  const label = labelByKind[item.kind] ?? strings.evidencePanel;
  const timestamp = formatEvidenceTimestamp(item.timestamp);
  const detail = item.detail ? ` - ${item.detail}` : "";
  const suffix = timestamp ? ` @ ${timestamp}` : "";
  return `- ${label}: ${item.value}${detail}${suffix}`;
}

function formatEvidenceTimestamp(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "";
  }
  return new Date(value).toLocaleString();
}

export function buildGraphRunPanelDagLayoutForTest(
  state: GraphRunPanelState,
  locale: AppLocale = "en",
  direction: DagAutoLayoutDirection = DAG_AUTO_LAYOUT_CONFIG.direction,
  engine: "dagre" | "fallback" = "dagre",
): DagLayout {
  return buildDagLayout(state, getGraphRunPanelStrings(locale), {
    ...DAG_AUTO_LAYOUT_CONFIG,
    direction,
  }, engine);
}

function buildDagLayout(
  state: GraphRunPanelState,
  strings: GraphRunPanelStrings,
  config: DagAutoLayoutConfig = DAG_AUTO_LAYOUT_CONFIG,
  engine: "dagre" | "fallback" = "dagre",
): DagLayout {
  const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  const validEdges = selectDagFlowEdges(state.edges).filter((edge) => (
    nodeIndexById.has(edge.from) && nodeIndexById.has(edge.to)
  ));
  const visibleEdges = selectDagVisibleEdges(validEdges);
  const layoutEdges = selectDagLayoutEdges(visibleEdges, state.nodes);
  const positionMap = (() => {
    if (engine === "fallback") {
      return buildFallbackDagLayoutPositions(state.nodes, layoutEdges, config);
    }
    try {
      return buildDagDagreLayoutPositions(state.nodes, layoutEdges, config);
    } catch {
      return buildFallbackDagLayoutPositions(state.nodes, layoutEdges, config);
    }
  })();
  const nodeLayouts = state.nodes.map((node, order) => {
    const size = estimateDagAutoLayoutNodeSize(node);
    const position = positionMap.get(node.id) ?? {
      x: config.marginX + order * (DAG_NODE_WIDTH + config.ranksep),
      y: config.marginY,
    };
    return {
      node,
      x: Math.max(0, Math.round(position.x)),
      y: Math.max(0, Math.round(position.y)),
      width: size.width,
      height: size.height,
      order,
    };
  });
  const positionById = new Map(nodeLayouts.map((layout) => [layout.node.id, layout]));
  const edgeLayouts = buildDagEdgeLayouts(visibleEdges, positionById, strings);
  const width = Math.max(
    config.marginX * 2 + DAG_NODE_WIDTH,
    ...nodeLayouts.map((layout) => layout.x + layout.width + config.marginX),
    ...edgeLayouts.map((layout) => layout.maxX + config.marginX),
  );
  const height = Math.max(
    config.marginY * 2 + DAG_NODE_HEIGHT,
    ...nodeLayouts.map((layout) => layout.y + layout.height + config.marginY),
    ...edgeLayouts.map((layout) => layout.maxY + config.marginY),
  );
  return { width, height, config, nodeLayouts, edgeLayouts };
}

function buildDagDagreLayoutPositions(
  nodes: readonly GraphRunPanelNode[],
  edges: readonly GraphRunPanelEdge[],
  config: DagAutoLayoutConfig,
): Map<string, { x: number; y: number }> {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const graph = new graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({
    directed: true,
    multigraph: true,
  });
  graph.setGraph({
    rankdir: config.direction,
    ranksep: config.ranksep,
    nodesep: config.nodesep,
    edgesep: config.edgesep,
    marginx: config.marginX,
    marginy: config.marginY,
    acyclicer: "greedy",
    ranker: "network-simplex",
  });
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    graph.setNode(node.id, estimateDagAutoLayoutNodeSize(node));
  });
  edges.forEach((edge, index) => {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      return;
    }
    graph.setEdge(edge.from, edge.to, {}, edge.id || `${edge.from}__${edge.to}__${index}`);
  });

  applyDagreLayout(graph);

  const boxes = nodes.map((node, order) => {
    const size = estimateDagAutoLayoutNodeSize(node);
    const label = graph.node(node.id);
    return {
      id: node.id,
      x: readFiniteNumber(label?.x, config.marginX + size.width / 2) - size.width / 2 + config.marginX,
      y: readFiniteNumber(label?.y, config.marginY + order * (size.height + config.nodesep) + size.height / 2) - size.height / 2 + config.marginY,
      width: readFiniteNumber(label?.width, size.width),
      height: readFiniteNumber(label?.height, size.height),
    };
  });

  return resolveDagAutoLayoutCollisions(boxes, config);
}

function buildFallbackDagLayoutPositions(
  nodes: readonly GraphRunPanelNode[],
  edges: readonly GraphRunPanelEdge[],
  config: DagAutoLayoutConfig,
): Map<string, { x: number; y: number }> {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const orderMap = new Map(nodes.map((node, index) => [node.id, index]));
  const levelMap = new Map<string, number>();
  const adjacencyMap = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const reachableNodeIds = new Set<string>();
  const incomingCountMap = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      return;
    }
    adjacencyMap.get(edge.from)?.push(edge.to);
    incomingCountMap.set(edge.to, Number(incomingCountMap.get(edge.to) || 0) + 1);
  });

  adjacencyMap.forEach((targetIds) => {
    targetIds.sort((leftId, rightId) => compareDagNodesForAutoLayout(nodeMap.get(leftId), nodeMap.get(rightId), orderMap));
  });

  const roots = nodes
    .filter((node) => Number(incomingCountMap.get(node.id) || 0) === 0)
    .sort((left, right) => compareDagNodesForAutoLayout(left, right, orderMap));
  const queue = (roots.length ? roots : [...nodes].sort((left, right) => compareDagNodesForAutoLayout(left, right, orderMap)))
    .map((node) => ({ id: node.id, level: 0 }));

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (reachableNodeIds.has(current.id)) {
      continue;
    }
    reachableNodeIds.add(current.id);
    levelMap.set(current.id, current.level);
    (adjacencyMap.get(current.id) || []).forEach((targetId) => {
      if (!reachableNodeIds.has(targetId)) {
        queue.push({ id: targetId, level: current.level + 1 });
      }
    });
  }

  const levelBuckets = new Map<number, GraphRunPanelNode[]>();
  nodes
    .filter((node) => reachableNodeIds.has(node.id))
    .forEach((node) => {
      const level = levelMap.get(node.id) || 0;
      const bucket = levelBuckets.get(level) || [];
      bucket.push(node);
      levelBuckets.set(level, bucket);
    });

  const horizontalLayout = isDagAutoLayoutHorizontal(config.direction);
  const maxLevel = Math.max(0, ...Array.from(levelBuckets.keys()));
  const boxes: DagAutoLayoutBox[] = [];
  Array.from(levelBuckets.entries())
    .sort((left, right) => left[0] - right[0])
    .forEach(([level, nodesAtLevel]) => {
      const sortedNodes = nodesAtLevel.sort((left, right) => compareDagNodesForAutoLayout(left, right, orderMap));
      sortedNodes.forEach((node, index) => {
        const size = estimateDagAutoLayoutNodeSize(node);
        const normalizedLevel = shouldReverseDagAutoLayoutLevel(config.direction) ? maxLevel - level : level;
        boxes.push({
          id: node.id,
          x: config.marginX + (horizontalLayout
            ? normalizedLevel * (DAG_NODE_WIDTH + config.ranksep)
            : index * (DAG_NODE_WIDTH + config.nodesep)),
          y: config.marginY + (horizontalLayout
            ? index * (DAG_NODE_HEIGHT + config.nodesep)
            : normalizedLevel * (DAG_NODE_HEIGHT + config.ranksep)),
          width: size.width,
          height: size.height,
        });
      });
    });

  const draftNodes = nodes
    .filter((node) => !reachableNodeIds.has(node.id))
    .sort((left, right) => compareDagNodesForAutoLayout(left, right, orderMap));
  draftNodes.forEach((node, index) => {
    const size = estimateDagAutoLayoutNodeSize(node);
    boxes.push({
      id: node.id,
      x: config.marginX + (horizontalLayout
        ? DAG_NODE_WIDTH + config.ranksep
        : index * (DAG_NODE_WIDTH + config.nodesep)),
      y: config.marginY + (horizontalLayout
        ? (DAG_NODE_HEIGHT + config.nodesep) * (index + 1) + DAG_FALLBACK_DRAFT_EXTRA_GAP
        : (maxLevel + 1) * (DAG_NODE_HEIGHT + config.ranksep) + DAG_FALLBACK_DRAFT_EXTRA_GAP),
      width: size.width,
      height: size.height,
    });
  });

  return resolveDagAutoLayoutCollisions(boxes, config);
}

function estimateDagAutoLayoutNodeSize(node: GraphRunPanelNode): DagNodeSize {
  const titleLength = Array.from((node.title || node.kindLabel || node.kind).trim()).length;
  const titleLineAllowance = titleLength > DAG_NODE_LONG_TITLE_THRESHOLD ? DAG_NODE_LONG_TITLE_EXTRA_HEIGHT : 0;
  const branchNodeAllowance = node.unlocks.length > 1 ? DAG_NODE_BRANCH_EXTRA_HEIGHT : 0;
  return {
    width: DAG_NODE_WIDTH,
    height: DAG_NODE_HEIGHT + titleLineAllowance + branchNodeAllowance,
  };
}

function resolveDagAutoLayoutCollisions(
  boxes: readonly DagAutoLayoutBox[],
  config: DagAutoLayoutConfig,
): Map<string, { x: number; y: number }> {
  const horizontalLayout = isDagAutoLayoutHorizontal(config.direction);
  const orderedBoxes = [...boxes].sort((left, right) => (
    horizontalLayout
      ? (left.x - right.x) || (left.y - right.y)
      : (left.y - right.y) || (left.x - right.x)
  ));
  const placedBoxes: DagAutoLayoutBox[] = [];

  orderedBoxes.forEach((box) => {
    const nextBox = { ...box };
    let guard = 0;
    while (guard < (boxes.length * boxes.length) + 8) {
      const overlapBox = placedBoxes.find((placedBox) => dagAutoLayoutBoxesOverlap(nextBox, placedBox));
      if (!overlapBox) {
        break;
      }
      if (horizontalLayout) {
        nextBox.y = overlapBox.y + overlapBox.height + config.nodesep;
      } else {
        nextBox.x = overlapBox.x + overlapBox.width + config.nodesep;
      }
      guard += 1;
    }
    placedBoxes.push(nextBox);
  });

  return new Map(placedBoxes.map((box) => [box.id, {
    x: Math.round(box.x),
    y: Math.round(box.y),
  }]));
}

function isDagAutoLayoutHorizontal(direction: DagAutoLayoutDirection): boolean {
  return direction === "LR" || direction === "RL";
}

function shouldReverseDagAutoLayoutLevel(direction: DagAutoLayoutDirection): boolean {
  return direction === "RL" || direction === "BT";
}

function dagAutoLayoutBoxesOverlap(left: DagAutoLayoutBox, right: DagAutoLayoutBox): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function compareDagNodesForAutoLayout(
  left: GraphRunPanelNode | undefined,
  right: GraphRunPanelNode | undefined,
  orderMap: ReadonlyMap<string, number>,
): number {
  if (!left || !right) {
    return left ? -1 : right ? 1 : 0;
  }
  const leftKindWeight = getDagNodeAutoLayoutKindWeight(left);
  const rightKindWeight = getDagNodeAutoLayoutKindWeight(right);
  if (leftKindWeight !== rightKindWeight) {
    return leftKindWeight - rightKindWeight;
  }
  return Number(orderMap.get(left.id) || 0) - Number(orderMap.get(right.id) || 0);
}

function getDagNodeAutoLayoutKindWeight(node: GraphRunPanelNode): number {
  if (node.kind === "intake") {
    return -2;
  }
  if (node.kind === "plan" && node.dependsOn.length === 0) {
    return -1;
  }
  if (node.kind === "summary") {
    return 2;
  }
  return 0;
}

function buildDagEdgeLayouts(
  edges: readonly GraphRunPanelEdge[],
  positionById: ReadonlyMap<string, DagNodeLayout>,
  strings: GraphRunPanelStrings,
): DagEdgeLayout[] {
  const edgeOffsets = buildEdgeOffsets(edges);
  const portHints = buildEdgePortHints(edges);
  return edges
    .map((edge, index) => {
      const from = positionById.get(edge.from);
      const to = positionById.get(edge.to);
      if (!from || !to) {
        return null;
      }
      const offset = edgeOffsets[index] ?? 0;
      const portHint = portHints[index] ?? "center";
      const geometry = buildEdgePath(from, to, offset, portHint);
      return {
        edge,
        path: geometry.path,
        label: formatEdgeAriaLabel(edge, strings),
        displayLabel: formatEdgeDisplayLabel(edge, strings),
        fromPort: geometry.fromPort.id,
        toPort: geometry.toPort.id,
        portHint,
        offset,
        labelX: geometry.labelX,
        labelY: geometry.labelY,
        maxX: geometry.maxX,
        maxY: geometry.maxY,
      };
    })
    .filter((edgeLayout): edgeLayout is DagEdgeLayout => Boolean(edgeLayout));
}

function selectDagVisibleEdges(edges: readonly GraphRunPanelEdge[]): GraphRunPanelEdge[] {
  const selectedByDirection = new Map<string, { edge: GraphRunPanelEdge; index: number }>();
  edges.forEach((edge, index) => {
    const key = buildDirectedEdgeKey(edge.from, edge.to);
    const current = selectedByDirection.get(key);
    if (!current || getDagVisibleEdgeScore(edge) > getDagVisibleEdgeScore(current.edge)) {
      selectedByDirection.set(key, { edge, index });
    }
  });
  return Array.from(selectedByDirection.values())
    .sort((left, right) => left.index - right.index)
    .map(({ edge }) => edge);
}

function selectDagFlowEdges(edges: readonly GraphRunPanelEdge[]): GraphRunPanelEdge[] {
  return edges.filter((edge) => DAG_FLOW_EDGE_KINDS.has(edge.kind));
}

function selectDagLayoutEdges(
  edges: readonly GraphRunPanelEdge[],
  nodes: readonly GraphRunPanelNode[],
): GraphRunPanelEdge[] {
  const orderMap = new Map(nodes.map((node, index) => [node.id, index]));
  const forwardAdjacency = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (edge.kind === "review_feedback" || edge.kind === "if_fail") {
      return;
    }
    forwardAdjacency.get(edge.from)?.push(edge.to);
  });
  return edges.filter((edge) => !isDagReturnEdge(edge, orderMap, forwardAdjacency));
}

function isDagReturnEdge(
  edge: GraphRunPanelEdge,
  orderMap: ReadonlyMap<string, number>,
  forwardAdjacency: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (edge.kind === "review_feedback") {
    return true;
  }
  if (edge.kind !== "if_fail") {
    return false;
  }
  if (edge.from === edge.to) {
    return true;
  }
  const fromOrder = orderMap.get(edge.from);
  const toOrder = orderMap.get(edge.to);
  if (fromOrder !== undefined && toOrder !== undefined && toOrder <= fromOrder) {
    return true;
  }
  return hasDagForwardPath(forwardAdjacency, edge.to, edge.from);
}

function hasDagForwardPath(
  adjacency: ReadonlyMap<string, readonly string[]>,
  fromId: string,
  toId: string,
): boolean {
  const queue = [fromId];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    if (current === toId) {
      return true;
    }
    visited.add(current);
    (adjacency.get(current) ?? []).forEach((nextId) => {
      if (!visited.has(nextId)) {
        queue.push(nextId);
      }
    });
  }
  return false;
}

function getDagVisibleEdgeScore(edge: GraphRunPanelEdge): number {
  return (edge.active ? DAG_VISIBLE_EDGE_ACTIVE_WEIGHT : 0)
    + (hasExplicitEdgePurpose(edge) ? DAG_VISIBLE_EDGE_PURPOSE_WEIGHT : 0)
    + (edge.kind === "depends_on" ? 0 : DAG_VISIBLE_EDGE_NON_DEFAULT_KIND_WEIGHT);
}

function buildEdgePortHints(edges: readonly GraphRunPanelEdge[]): DagPortHint[] {
  const directedPairs = new Set(edges.map((edge) => buildDirectedEdgeKey(edge.from, edge.to)));
  const hints: DagPortHint[] = edges.map(() => "center");
  const applyFanHints = (buckets: ReadonlyMap<string, number[]>): void => {
    buckets.forEach((bucket) => {
      if (bucket.length < 2) {
        return;
      }
      const midpoint = (bucket.length - 1) / 2;
      bucket.forEach((edgeIndex, order) => {
        hints[edgeIndex] = order < midpoint ? "start" : order > midpoint ? "end" : "center";
      });
    });
  };
  applyFanHints(buildEdgeIndexBuckets(edges, (edge) => `from:${edge.from}`));
  applyFanHints(buildEdgeIndexBuckets(edges, (edge) => `to:${edge.to}`));
  edges.forEach((edge, index) => {
    if (edge.from !== edge.to && directedPairs.has(buildDirectedEdgeKey(edge.to, edge.from))) {
      hints[index] = edge.from.localeCompare(edge.to) <= 0 ? "start" : "end";
    }
    if (edge.kind === "review_feedback" || edge.kind === "if_fail") {
      hints[index] = hints[index] === "start" ? "start" : "end";
    }
  });
  return hints;
}

function buildDirectedEdgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

function buildEdgeOffsets(edges: readonly GraphRunPanelEdge[]): number[] {
  const offsets = edges.map(() => 0);
  applyDagEdgeOffsetBuckets(offsets, buildEdgeIndexBuckets(edges, (edge) => [edge.from, edge.to].sort().join("<->")), false);
  applyDagEdgeOffsetBuckets(offsets, buildEdgeIndexBuckets(edges, (edge) => `from:${edge.from}`), true);
  applyDagEdgeOffsetBuckets(offsets, buildEdgeIndexBuckets(edges, (edge) => `to:${edge.to}`), true);
  edges.forEach((edge, index) => {
    if (edge.from === edge.to && offsets[index] === 0) {
      offsets[index] = DAG_EDGE_PARALLEL_OFFSET;
    }
    if (edge.kind === "review_feedback" || edge.kind === "if_fail") {
      if (Math.abs(offsets[index]) < DAG_EDGE_PARALLEL_OFFSET) {
        offsets[index] = offsets[index] < 0 ? -DAG_EDGE_PARALLEL_OFFSET : DAG_EDGE_PARALLEL_OFFSET;
      }
    }
  });
  return offsets;
}

function buildEdgeIndexBuckets(
  edges: readonly GraphRunPanelEdge[],
  buildKey: (edge: GraphRunPanelEdge) => string,
): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = buildKey(edge);
    const bucket = buckets.get(key) ?? [];
    bucket.push(index);
    buckets.set(key, bucket);
  });
  return buckets;
}

function applyDagEdgeOffsetBuckets(
  offsets: number[],
  indexBuckets: ReadonlyMap<string, readonly number[]>,
  onlyEmptyOffsets: boolean,
): void {
  indexBuckets.forEach((bucket) => {
    if (bucket.length < 2) {
      return;
    }
    const midpoint = (bucket.length - 1) / 2;
    bucket.forEach((edgeIndex, order) => {
      if (onlyEmptyOffsets && offsets[edgeIndex] !== 0) {
        return;
      }
      offsets[edgeIndex] = (order - midpoint) * DAG_EDGE_PARALLEL_OFFSET;
    });
  });
}

function buildEdgePath(
  from: DagNodeLayout,
  to: DagNodeLayout,
  offset = 0,
  portHint: DagPortHint = "center",
): DagEdgeGeometry {
  const pair = chooseEdgePortPair(from, to, portHint);
  const dx = pair.toPort.x - pair.fromPort.x;
  const dy = pair.toPort.y - pair.fromPort.y;
  const distance = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
  const curve = Math.max(DAG_EDGE_CURVE_MIN, Math.min(140, distance * 0.35));
  const fromNormal = getPortNormal(pair.fromPort.side);
  const toNormal = getPortNormal(pair.toPort.side);
  const offsetX = (-dy / distance) * offset;
  const offsetY = (dx / distance) * offset;
  const c1x = pair.fromPort.x + fromNormal.x * curve + offsetX;
  const c1y = pair.fromPort.y + fromNormal.y * curve + offsetY;
  const c2x = pair.toPort.x + toNormal.x * curve + offsetX;
  const c2y = pair.toPort.y + toNormal.y * curve + offsetY;
  const labelPoint = getCubicBezierPoint(
    { x: pair.fromPort.x, y: pair.fromPort.y },
    { x: c1x, y: c1y },
    { x: c2x, y: c2y },
    { x: pair.toPort.x, y: pair.toPort.y },
    0.5,
  );
  return {
    path: [
      "M", formatPathCoordinate(pair.fromPort.x), formatPathCoordinate(pair.fromPort.y),
      "C", formatPathCoordinate(c1x), `${formatPathCoordinate(c1y)},`,
      formatPathCoordinate(c2x), `${formatPathCoordinate(c2y)},`,
      formatPathCoordinate(pair.toPort.x), formatPathCoordinate(pair.toPort.y),
    ].join(" "),
    fromPort: pair.fromPort,
    toPort: pair.toPort,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    maxX: Math.max(pair.fromPort.x, pair.toPort.x, c1x, c2x),
    maxY: Math.max(pair.fromPort.y, pair.toPort.y, c1y, c2y),
  };
}

function getCubicBezierPoint(
  start: { x: number; y: number },
  controlA: { x: number; y: number },
  controlB: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const inverseT = 1 - t;
  return {
    x: (inverseT * inverseT * inverseT * start.x)
      + (3 * inverseT * inverseT * t * controlA.x)
      + (3 * inverseT * t * t * controlB.x)
      + (t * t * t * end.x),
    y: (inverseT * inverseT * inverseT * start.y)
      + (3 * inverseT * inverseT * t * controlA.y)
      + (3 * inverseT * t * t * controlB.y)
      + (t * t * t * end.y),
  };
}

function chooseEdgePortPair(
  from: DagNodeLayout,
  to: DagNodeLayout,
  portHint: DagPortHint = "center",
): { fromPort: DagPort; toPort: DagPort } {
  if (from.node.id === to.node.id) {
    return getFallbackEdgePortPair(from, to);
  }
  const preferred = getPreferredPortSides(from, to);
  const nearest = getNearestNodeBorderPoints(from, to, getPortHintRatioValue(portHint));
  if (!nearest) {
    return getFallbackEdgePortPair(from, to);
  }
  return {
    fromPort: buildNearestPort(from, nearest.fromPoint, preferred.fromSide),
    toPort: buildNearestPort(to, nearest.toPoint, preferred.toSide),
  };
}

function getNearestNodeBorderPoints(
  from: DagNodeLayout,
  to: DagNodeLayout,
  hintRatio: number,
): { fromPoint: DagPoint; toPoint: DagPoint } | null {
  const x = getNearestIntervalCoordinates(from.x, from.x + from.width, to.x, to.x + to.width, hintRatio);
  const y = getNearestIntervalCoordinates(from.y, from.y + from.height, to.y, to.y + to.height, hintRatio);
  if (x.overlaps && y.overlaps) {
    return null;
  }
  return {
    fromPoint: { x: x.from, y: y.from },
    toPoint: { x: x.to, y: y.to },
  };
}

function getNearestIntervalCoordinates(
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
  hintRatio: number,
): { from: number; to: number; overlaps: boolean } {
  if (fromMax <= toMin) {
    return { from: fromMax, to: toMin, overlaps: false };
  }
  if (toMax <= fromMin) {
    return { from: fromMin, to: toMax, overlaps: false };
  }
  const overlapMin = Math.max(fromMin, toMin);
  const overlapMax = Math.min(fromMax, toMax);
  const coordinate = overlapMin + (overlapMax - overlapMin) * hintRatio;
  return { from: coordinate, to: coordinate, overlaps: true };
}

function getPortHintRatioValue(portHint: DagPortHint): number {
  if (portHint === "start") {
    return 0.25;
  }
  if (portHint === "end") {
    return 0.75;
  }
  return 0.5;
}

function buildNearestPort(layout: DagNodeLayout, point: DagPoint, fallbackSide: DagPortSide): DagPort {
  const side = resolveNearestPortSide(layout, point, fallbackSide);
  const snappedPoint = snapPointToPortSide(layout, side, point);
  return {
    id: `${side}-${getPortCoordinateLabel(layout, side, snappedPoint)}`,
    side,
    x: snappedPoint.x,
    y: snappedPoint.y,
  };
}

function snapPointToPortSide(layout: DagNodeLayout, side: DagPortSide, point: DagPoint): DagPoint {
  const rawRatio = side === "left" || side === "right"
    ? (point.y - layout.y) / Math.max(1, layout.height)
    : (point.x - layout.x) / Math.max(1, layout.width);
  const ratio = getNearestPortRatio(rawRatio);
  if (side === "left" || side === "right") {
    return {
      x: side === "right" ? layout.x + layout.width : layout.x,
      y: layout.y + layout.height * ratio,
    };
  }
  return {
    x: layout.x + layout.width * ratio,
    y: side === "bottom" ? layout.y + layout.height : layout.y,
  };
}

function getNearestPortRatio(rawRatio: number): number {
  return DAG_PORT_RATIOS.reduce((nearest, ratio) => (
    Math.abs(rawRatio - ratio) < Math.abs(rawRatio - nearest) ? ratio : nearest
  ), DAG_PORT_RATIOS[0]);
}

function resolveNearestPortSide(layout: DagNodeLayout, point: DagPoint, fallbackSide: DagPortSide): DagPortSide {
  const epsilon = 0.01;
  const candidates: { side: DagPortSide; distance: number }[] = [
    { side: "top", distance: Math.abs(point.y - layout.y) },
    { side: "right", distance: Math.abs(point.x - (layout.x + layout.width)) },
    { side: "bottom", distance: Math.abs(point.y - (layout.y + layout.height)) },
    { side: "left", distance: Math.abs(point.x - layout.x) },
  ];
  const minDistance = Math.min(...candidates.map((candidate) => candidate.distance));
  if (candidates.some((candidate) => candidate.side === fallbackSide && candidate.distance <= minDistance + epsilon)) {
    return fallbackSide;
  }
  return candidates.sort((left, right) => left.distance - right.distance)[0]?.side ?? fallbackSide;
}

function getPortCoordinateLabel(layout: DagNodeLayout, side: DagPortSide, point: DagPoint): string {
  const ratio = side === "left" || side === "right"
    ? (point.y - layout.y) / Math.max(1, layout.height)
    : (point.x - layout.x) / Math.max(1, layout.width);
  return String(Math.max(0, Math.min(100, Math.round(ratio * 100))));
}

function getFallbackEdgePortPair(
  from: DagNodeLayout,
  to: DagNodeLayout,
): { fromPort: DagPort; toPort: DagPort } {
  return {
    fromPort: { id: "right-50", side: "right", x: from.x + from.width, y: from.y + from.height / 2 },
    toPort: { id: "left-50", side: "left", x: to.x, y: to.y + to.height / 2 },
  };
}

function getNodeCenter(layout: DagNodeLayout): { x: number; y: number } {
  return {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  };
}

function getPreferredPortSides(
  from: DagNodeLayout,
  to: DagNodeLayout,
): { fromSide: DagPortSide; toSide: DagPortSide } {
  const fromCenter = getNodeCenter(from);
  const toCenter = getNodeCenter(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { fromSide: "right", toSide: "left" }
      : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0
    ? { fromSide: "bottom", toSide: "top" }
    : { fromSide: "top", toSide: "bottom" };
}

function getPortNormal(side: DagPortSide): { x: number; y: number } {
  if (side === "top") {
    return { x: 0, y: -1 };
  }
  if (side === "right") {
    return { x: 1, y: 0 };
  }
  if (side === "bottom") {
    return { x: 0, y: 1 };
  }
  return { x: -1, y: 0 };
}

function formatPathCoordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatEdgeAriaLabel(edge: GraphRunPanelEdge, strings: GraphRunPanelStrings): string {
  const base = interpolateGraphRunPanelString(strings.graphEdgeAria, {
    from: edge.fromTitle,
    to: edge.toTitle,
    kind: edge.kindLabel,
  });
  const purpose = formatEdgePurposeLabel(edge);
  return purpose && purpose !== edge.kindLabel ? `${base}: ${purpose}` : base;
}

function formatEdgePurposeLabel(edge: GraphRunPanelEdge): string {
  return getExplicitEdgePurposeLabel(edge) ?? edge.kindLabel;
}

function hasExplicitEdgePurpose(edge: GraphRunPanelEdge): boolean {
  return Boolean(getExplicitEdgePurposeLabel(edge));
}

function getExplicitEdgePurposeLabel(edge: GraphRunPanelEdge): string | undefined {
  return normalizeOptionalLabel(edge.label)
    ?? normalizeOptionalLabel(edge.condition)
    ?? normalizeOptionalLabel(edge.conditionExpression?.description)
    ?? normalizeOptionalLabel(edge.metadata?.feedbackReason)
    ?? normalizeOptionalLabel(edge.metadata?.rationale);
}

function formatEdgeDisplayLabel(
  edge: GraphRunPanelEdge,
  strings: GraphRunPanelStrings,
): string {
  if (edge.kind === "depends_on") {
    return "";
  }
  const explicitPurpose = getExplicitEdgePurposeLabel(edge);
  const label = explicitPurpose ?? getShortEdgeKindLabel(edge.kind, strings);
  return splitShortEdgeLabelSegments(label).join(" / ");
}

function normalizeOptionalLabel(value: string | null | undefined): string | undefined {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function getShortEdgeKindLabel(edgeKind: string, strings: GraphRunPanelStrings): string {
  const isChinese = strings.semanticStart === "开始";
  const labelsByKind: Record<string, { en: string; zh: string }> = {
    depends_on: { en: "Deps", zh: "依赖" },
    if_pass: { en: "Pass", zh: "通过" },
    if_fail: { en: "Fail", zh: "失败" },
    review_feedback: { en: "Revw", zh: "评审" },
    conflicts_with: { en: "Conf", zh: "冲突" },
    evidence_for: { en: "Evid", zh: "证据" },
    human_approved: { en: "OK", zh: "批准" },
  };
  const shortLabel = labelsByKind[edgeKind];
  return shortLabel ? (isChinese ? shortLabel.zh : shortLabel.en) : edgeKind;
}

function splitShortEdgeLabelSegments(label: string): string[] {
  const normalized = normalizeOptionalLabel(label) ?? "";
  if (!normalized) {
    return [];
  }
  const words = normalized.split(" ").filter(Boolean);
  const rawSegments = words.length > 1 ? words : splitIntoCharacterSegments(normalized);
  return rawSegments
    .map((segment) => {
      const cleaned = segment.replace(/[^\p{L}\p{N}_-]/gu, "");
      return Array.from(cleaned || segment).slice(0, DAG_EDGE_LABEL_SEGMENT_LIMIT).join("");
    })
    .filter(Boolean)
    .slice(0, DAG_EDGE_LABEL_MAX_SEGMENTS);
}

function splitIntoCharacterSegments(label: string): string[] {
  return Array.from(label).reduce<string[]>((segments, character) => {
    const current = segments[segments.length - 1] ?? "";
    if (Array.from(current).length >= DAG_EDGE_LABEL_SEGMENT_LIMIT) {
      segments.push(character);
      return segments;
    }
    if (!segments.length) {
      segments.push(character);
      return segments;
    }
    segments[segments.length - 1] = current + character;
    return segments;
  }, []);
}

function getNodeTone(node: GraphRunPanelNode, semanticKind: GraphNodeSemanticKind): GraphNodeTone {
  if (semanticKind === "start") {
    return "start";
  }
  if (semanticKind === "decision") {
    return "decision";
  }
  return getNodeKindTone(node.kind);
}

function getNodeKindTone(kind: string): GraphNodeTone {
  switch (kind) {
    case "intake":
    case "plan":
    case "merge":
      return "info";
    case "implement":
    case "debate":
      return "accent";
    case "test":
    case "review":
      return "validation";
    case "human_gate":
      return "success";
    case "sleep":
      return "neutral";
    case "summary":
      return "danger";
    default:
      return "neutral";
  }
}

function toSafeDomId(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-") || "edge";
}

function renderMetaCard(label: string, value: string, className = ""): string {
  const status = className ? ` ${className}` : "";
  return `<div class="meta-card${status}">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${escapeHtml(value)}</div>
  </div>`;
}

function renderPathSection(label: string, values: readonly string[], strings: GraphRunPanelStrings): string {
  const content = values.length ? values.join("\n") : strings.none;
  return renderTextBlock(label, content);
}

function renderTextBlock(label: string, value: string): string {
  return `<div class="path-list">
    <div class="label">${escapeHtml(label)}</div>
    <div class="pre-wrap">${escapeHtml(value)}</div>
  </div>`;
}

function formatAcceptance(node: GraphRunPanelNode, strings: GraphRunPanelStrings): string {
  if (!node.acceptance.length) {
    return strings.none;
  }
  return node.acceptance
    .map((item) => {
      const required = item.required === false ? "" : "* ";
      const passed = item.passed === true ? " [passed]" : item.passed === false ? " [failed]" : "";
      const detail = item.detail ? ` - ${item.detail}` : "";
      const evidence = item.evidenceRef ? ` (${item.evidenceRef})` : "";
      return `${required}${item.name}${passed}${detail}${evidence}`;
    })
    .join("\n");
}

function statusClassName(status: string): string {
  return `status-${status.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function formatDateTime(value: number | undefined, strings: GraphRunPanelStrings): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return strings.unknownTime;
  }
  return new Date(value).toLocaleString();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsString(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\u003C");
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
