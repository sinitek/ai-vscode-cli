import * as vscode from "vscode";
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

type DagEdgeLayout = {
  edge: GraphRunPanelEdge;
  path: string;
  label: string;
};

type DagLayout = {
  width: number;
  height: number;
  nodeLayouts: DagNodeLayout[];
  edgeLayouts: DagEdgeLayout[];
};

const DAG_NODE_WIDTH = 146;
const DAG_NODE_HEIGHT = 58;
const DAG_COLUMN_GAP = 72;
const DAG_ROW_GAP = 20;
const DAG_MARGIN = 24;

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
      <main class="content graph-split">
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

      function getSelectedNodeId() {
        return document.body.dataset.selectedNodeId || "";
      }

      function persistSelectedNode(nodeId) {
        const previous = vscode.getState() || {};
        vscode.setState({ ...previous, selectedGraphNodeId: nodeId });
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

      selectableNodes.forEach((element) => {
        element.addEventListener("click", () => {
          setSelectedNode(element.dataset.nodeId || "");
        });
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedNode(element.dataset.nodeId || "");
          }
        });
      });

      document.querySelectorAll("[data-action]").forEach((element) => {
        element.addEventListener("click", () => {
          const action = element.dataset.action || "";
          const selectedNodeId = getSelectedNodeId() || null;
          if (action === "refresh") {
            vscode.postMessage({ type: "graphRun:refresh", selectedNodeId });
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
	            return;
	          }
	          if (action === "approve") {
	            vscode.postMessage({
	              type: "graphRun:approveHumanGate",
              nodeId: element.dataset.controlNodeId || "",
              selectedNodeId,
            });
          }
        });
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

      const persisted = vscode.getState()?.selectedGraphNodeId;
      const serverSelected = getSelectedNodeId();
      const initialSelected = nodeIds.includes(serverSelected)
        ? serverSelected
        : nodeIds.includes(persisted)
          ? persisted
          : nodeIds[0];
      if (initialSelected) {
        setSelectedNode(initialSelected, { persist: false });
      }
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
    buttons.push(`<button class="button button-danger" type="button" data-action="stop">${escapeHtml(strings.stopRun)}</button>`);
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
      <div class="graph-dag-header">
        <div>
          <h2 id="graph-dag-title">${escapeHtml(strings.graphView)}</h2>
          <p>${escapeHtml(strings.graphViewDescription)}</p>
        </div>
      </div>
      <div class="empty-card">${escapeHtml(strings.noNodes)}</div>
    </section>`;
  }
  const layout = buildDagLayout(state, strings);
  const hasActiveEdges = state.edges.some((edge) => edge.active);
  return `<section class="section graph-dag" aria-labelledby="graph-dag-title">
    <div class="graph-dag-header">
      <div>
        <h2 id="graph-dag-title">${escapeHtml(strings.graphView)}</h2>
        <p>${escapeHtml(strings.graphViewDescription)}</p>
      </div>
      <p class="keyboard-hint">${escapeHtml(strings.keyboardHint)}</p>
    </div>
    ${hasActiveEdges ? "" : `<div class="empty-card dag-empty">${escapeHtml(strings.noEdges)}</div>`}
    <div class="dag-viewport" role="group" aria-label="${escapeHtml(strings.graphView)}">
      <div class="dag-canvas" style="width: ${layout.width}px; height: ${layout.height}px;">
        ${layout.edgeLayouts.length ? renderDagSvg(layout, strings) : ""}
        ${layout.nodeLayouts.map((nodeLayout) => renderDagNode(nodeLayout, state, strings)).join("")}
      </div>
    </div>
    ${renderDagEdgeAccessibilityList(state.edges, strings)}
  </section>`;
}

function renderDagSvg(layout: DagLayout, strings: GraphRunPanelStrings): string {
  return `<svg class="dag-edges" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true" focusable="false">
    <defs>
      <marker id="graph-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path class="dag-arrowhead" d="M 0 0 L 10 5 L 0 10 z"></path>
      </marker>
    </defs>
    ${layout.edgeLayouts.map(({ edge, path, label }) => {
      const activeClass = edge.active ? "active" : "inactive";
      return `<path class="dag-edge-path ${activeClass} edge-kind-${escapeHtml(edge.kind)}" d="${escapeHtml(path)}" marker-end="url(#graph-arrowhead)">
        <title>${escapeHtml(label || strings.none)}</title>
      </path>`;
    }).join("")}
  </svg>`;
}

function renderDagNode(
  layout: DagNodeLayout,
  state: GraphRunPanelState,
  strings: GraphRunPanelStrings,
): string {
  const node = layout.node;
  const selected = node.id === state.selectedNodeId ? " selected" : "";
  const ariaLabel = interpolateGraphRunPanelString(strings.graphNodeAria, {
    title: node.title,
    status: node.statusLabel,
    kind: node.kindLabel,
    attempts: `${node.attempts}/${node.maxAttempts}`,
    dependsCount: String(node.dependsOn.length),
    unlocksCount: String(node.unlocks.length),
  });
  return `<button
    class="dag-node node-select-target${selected} ${statusClassName(node.status)} kind-${escapeHtml(node.kind)}"
    type="button"
    data-node-id="${escapeHtml(node.id)}"
    data-dag-order="${layout.order}"
    aria-label="${escapeHtml(ariaLabel)}"
    ${selected ? "aria-current=\"true\"" : ""}
    style="left: ${layout.x}px; top: ${layout.y}px; width: ${layout.width}px; height: ${layout.height}px;"
	  >
	    <span class="dag-node-title">${escapeHtml(node.title)}</span>
	    <span class="status-pill ${statusClassName(node.status)}">${escapeHtml(node.statusLabel)}</span>
	  </button>`;
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
  if (!state.nodes.length) {
    return `<section class="section node-details-section"><h2>${escapeHtml(strings.details)}</h2>${errorHtml}${supplementHtml}<div class="empty-card">${escapeHtml(strings.noSelection)}</div></section>`;
  }
  const details = state.nodes.map((node) => renderNodeDetailArticle(node, state.selectedNodeId, strings)).join("");
  return `<section class="section node-details-section">
    <h2>${escapeHtml(strings.details)}</h2>
    ${errorHtml}
    ${supplementHtml}
    ${details}
  </section>`;
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
  selectedNodeId: string | null,
  strings: GraphRunPanelStrings,
): string {
  const selected = node.id === selectedNodeId;
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
	  if (node.control.canApprove) {
	    buttons.push(`<button class="button" type="button" data-action="approve" data-control-node-id="${escapeHtml(node.id)}">${escapeHtml(strings.approveHumanGate)}</button>`);
	  }
  if (!buttons.length) {
    return "";
  }
  return `<div class="detail-actions" aria-label="${escapeHtml(strings.nodeActions)}">${buttons.join("")}</div>`;
}

function buildDagLayout(state: GraphRunPanelState, strings: GraphRunPanelStrings): DagLayout {
  const nodeIndexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  const validEdges = state.edges.filter((edge) => (
    nodeIndexById.has(edge.from) && nodeIndexById.has(edge.to)
  ));
  const activeEdges = validEdges.filter((edge) => edge.active);
  const rankEdges = activeEdges.length ? activeEdges : validEdges;
  const ranks = new Map(state.nodes.map((node) => [node.id, 0]));
  const indegree = new Map(state.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, GraphRunPanelEdge[]>();
  rankEdges.forEach((edge) => {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  });

  const queue = state.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => (nodeIndexById.get(left.id) ?? 0) - (nodeIndexById.get(right.id) ?? 0));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || visited.has(node.id)) {
      continue;
    }
    visited.add(node.id);
    const nextEdges = (outgoing.get(node.id) ?? [])
      .slice()
      .sort((left, right) => (nodeIndexById.get(left.to) ?? 0) - (nodeIndexById.get(right.to) ?? 0));
    nextEdges.forEach((edge) => {
      ranks.set(edge.to, Math.max(ranks.get(edge.to) ?? 0, (ranks.get(edge.from) ?? 0) + 1));
      indegree.set(edge.to, Math.max(0, (indegree.get(edge.to) ?? 0) - 1));
      if ((indegree.get(edge.to) ?? 0) === 0) {
        const target = state.nodes[nodeIndexById.get(edge.to) ?? -1];
        if (target) {
          queue.push(target);
          queue.sort((left, right) => (nodeIndexById.get(left.id) ?? 0) - (nodeIndexById.get(right.id) ?? 0));
        }
      }
    });
  }

  if (visited.size < state.nodes.length) {
    const fallbackRank = Math.max(0, ...Array.from(ranks.values())) + 1;
    state.nodes.forEach((node) => {
      if (!visited.has(node.id)) {
        ranks.set(node.id, Math.max(ranks.get(node.id) ?? 0, fallbackRank));
      }
    });
  }

  const columns = new Map<number, GraphRunPanelNode[]>();
  state.nodes.forEach((node) => {
    const rank = ranks.get(node.id) ?? 0;
    columns.set(rank, [...(columns.get(rank) ?? []), node]);
  });
  columns.forEach((nodes) => {
    nodes.sort((left, right) => (nodeIndexById.get(left.id) ?? 0) - (nodeIndexById.get(right.id) ?? 0));
  });

  const positionById = new Map<string, DagNodeLayout>();
  const sortedRanks = Array.from(columns.keys()).sort((left, right) => left - right);
  let order = 0;
  sortedRanks.forEach((rank) => {
    const nodes = columns.get(rank) ?? [];
    nodes.forEach((node, rowIndex) => {
      positionById.set(node.id, {
        node,
        x: DAG_MARGIN + rank * (DAG_NODE_WIDTH + DAG_COLUMN_GAP),
        y: DAG_MARGIN + rowIndex * (DAG_NODE_HEIGHT + DAG_ROW_GAP),
        width: DAG_NODE_WIDTH,
        height: DAG_NODE_HEIGHT,
        order,
      });
      order += 1;
    });
  });

  const maxRank = Math.max(0, ...Array.from(columns.keys()));
  const maxRows = Math.max(1, ...Array.from(columns.values()).map((nodes) => nodes.length));
  const width = DAG_MARGIN * 2 + DAG_NODE_WIDTH + maxRank * (DAG_NODE_WIDTH + DAG_COLUMN_GAP);
  const height = DAG_MARGIN * 2 + DAG_NODE_HEIGHT + (maxRows - 1) * (DAG_NODE_HEIGHT + DAG_ROW_GAP);
  const nodeLayouts = Array.from(positionById.values()).sort((left, right) => left.order - right.order);
  const edgeLayouts = validEdges
    .map((edge) => {
      const from = positionById.get(edge.from);
      const to = positionById.get(edge.to);
      if (!from || !to) {
        return null;
      }
      return {
        edge,
        path: buildEdgePath(from, to),
        label: formatEdgeAriaLabel(edge, strings),
      };
    })
    .filter((edgeLayout): edgeLayout is DagEdgeLayout => Boolean(edgeLayout));

  return { width, height, nodeLayouts, edgeLayouts };
}

function buildEdgePath(from: DagNodeLayout, to: DagNodeLayout): string {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  if (endX > startX) {
    const mid = Math.max(42, (endX - startX) / 2);
    return `M ${startX} ${startY} C ${startX + mid} ${startY}, ${endX - mid} ${endY}, ${endX} ${endY}`;
  }
  const loopX = Math.max(startX, endX) + DAG_COLUMN_GAP / 2;
  return `M ${startX} ${startY} C ${loopX} ${startY}, ${loopX} ${endY}, ${endX} ${endY}`;
}

function formatEdgeAriaLabel(edge: GraphRunPanelEdge, strings: GraphRunPanelStrings): string {
  const base = interpolateGraphRunPanelString(strings.graphEdgeAria, {
    from: edge.fromTitle,
    to: edge.toTitle,
    kind: edge.kindLabel,
  });
  return edge.condition ? `${base}: ${edge.condition}` : base;
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
