import {
  GRAPH_DEFAULT_MAX_CONCURRENT_NODES,
  isGraphEdgeConditionOperator,
  isGraphEdgeConditionType,
  isGraphEdgeKind,
  isGraphNodeKind,
  isGraphNodeStatus,
  isGraphOwnerRole,
  sanitizeGraphPathSegment,
  type GraphAcceptanceCheck,
  type GraphEdgeConditionExpression,
  type GraphEdgeMetadata,
  type GraphEdgeKind,
  type GraphEdgeRecord,
  type GraphNodeKind,
  type GraphNodeRecord,
  type GraphNodeStatus,
  type GraphOwnerRole,
  type GraphPlannedEdgeSpec,
  type GraphPlannedGraphSpec,
  type GraphPlannedNodeSpec,
  type GraphRunRecord,
} from "./types";
import { formatGraphNodeTitleInChinese } from "./graphNodeTitles";
import {
  getGraphNodeConflictReason,
  isGraphCliExecutableNode,
} from "./graphScheduler";

export const GRAPH_AI_PLANNER_TEMPLATE_ID = "ai-planned-dag";
export const GRAPH_AI_PLANNER_TEMPLATE_VERSION = "1";
export const GRAPH_AI_PLANNER_NODE_ID = "plan";
export const GRAPH_AI_PLANNER_SUMMARY_NODE_ID = "summary";
export const GRAPH_AI_REPLANNER_NODE_ID_PREFIX = "replan";

const GRAPH_PLANNER_MAX_NODE_COUNT = 40;
const GRAPH_PLANNER_MAX_ATTEMPTS = 3;
const GRAPH_PLANNER_MAX_CONCURRENT = GRAPH_DEFAULT_MAX_CONCURRENT_NODES;
const GRAPH_PLANNER_NODE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/u;

export type GraphPlanMaterializationResult = {
  run: GraphRunRecord;
  changed: boolean;
  plannedNodeIds: string[];
  error?: string;
};

export type GraphPlanMaterializationOptions = {
  now?: () => number;
  plannerNodeId?: string;
  mode?: "initial" | "append";
};

export type GraphReplanningNodeAppendResult = {
  run: GraphRunRecord;
  changed: boolean;
  nodeId?: string;
  triggerNodeIds: string[];
};

type MaterializedGraphBuildResult = {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  materializedNodes: GraphNodeRecord[];
  plannedNodeIds: string[];
  error?: string;
};

export function buildGraphPlanningRunNodes(graphRunId: string): GraphNodeRecord[] {
  return [{
    id: GRAPH_AI_PLANNER_NODE_ID,
    title: "规划 Graph DAG 执行",
    kind: "plan",
    status: "pending",
    ownerRole: "main",
    conflictGroup: `graph:${graphRunId}:planning`,
    maxAttempts: 1,
    attempts: 0,
    dependsOn: [],
    unlocks: [],
    acceptance: [{
      name: "Planner 在执行节点运行前输出已校验的 plannedGraph DAG。",
      required: true,
    }],
  }];
}

export function buildGraphPlanningRunEdges(): GraphEdgeRecord[] {
  return [];
}

export function isGraphAiReplannerNode(node: Pick<GraphNodeRecord, "id" | "kind" | "ownerRole">): boolean {
  return node.kind === "plan"
    && node.ownerRole === "main"
    && node.id.startsWith(`${GRAPH_AI_REPLANNER_NODE_ID_PREFIX}-`);
}

export function appendGraphReplanningNode(
  run: GraphRunRecord,
  options: {
    triggerNodeIds?: readonly string[];
    reason?: string;
    now?: () => number;
  } = {},
): GraphReplanningNodeAppendResult {
  const existingReplanner = run.nodes.find((node) => isGraphAiReplannerNode(node)
    && (node.status === "pending" || node.status === "running" || node.status === "ready"));
  const triggerNodeIds = normalizeStringArray(options.triggerNodeIds)
    .filter((nodeId) => run.nodes.some((node) => node.id === nodeId));
  if (existingReplanner) {
    return { run, changed: false, nodeId: existingReplanner.id, triggerNodeIds };
  }

  const timestamp = options.now?.() ?? Date.now();
  const nodeId = buildNextGraphReplannerNodeId(run);
  const replannerNode: GraphNodeRecord = {
    id: nodeId,
    title: "重新规划 Graph 续跑",
    kind: "plan",
    status: "pending",
    ownerRole: "main",
    conflictGroup: `graph:${run.id}:replanning`,
    maxAttempts: 1,
    attempts: 0,
    dependsOn: [],
    unlocks: [],
    acceptance: [{
      name: "主模型基于当前失败或卡住状态输出 plannedGraph 增量，且只新增当前图的后续节点。",
      required: true,
    }],
    ...(options.reason?.trim() ? { lastError: options.reason.trim() } : {}),
  };
  const triggerEdges = triggerNodeIds.map((triggerNodeId, index): GraphEdgeRecord => ({
    id: buildGraphEdgeId(triggerNodeId, nodeId, "if_fail", run.edges.length + index),
    from: triggerNodeId,
    to: nodeId,
    kind: "if_fail",
    label: "失败后主模型扩图",
    condition: `${triggerNodeId} failed or blocked triggers replanning`,
    conditionExpression: {
      type: "source_status",
      operator: "one_of",
      statuses: ["failed", "blocked"],
      description: "失败或阻塞节点触发当前 Graph run 的增量续跑规划。",
    },
    active: true,
  }));
  const nextEdges = [...run.edges, ...triggerEdges];
  const nextNodes = [...run.nodes, replannerNode];
  const unlocksByNodeId = buildUnlocksByNodeId(nextNodes, nextEdges);
  const nextRun: GraphRunRecord = {
    ...run,
    status: "running",
    updatedAt: timestamp,
    nodes: nextNodes.map((node) => ({
      ...node,
      unlocks: unlocksByNodeId.get(node.id) ?? [],
    })),
    edges: nextEdges,
  };
  return {
    run: nextRun,
    changed: true,
    nodeId,
    triggerNodeIds,
  };
}

export function normalizeGraphPlannedGraphSpec(value: unknown): GraphPlannedGraphSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphPlannedGraphSpec>;
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0 || raw.nodes.length > GRAPH_PLANNER_MAX_NODE_COUNT) {
    return null;
  }
  const nodes = raw.nodes
    .map(normalizeGraphPlannedNodeSpec)
    .filter((node): node is GraphPlannedNodeSpec => Boolean(node));
  if (nodes.length !== raw.nodes.length) {
    return null;
  }
  const edges = Array.isArray(raw.edges)
    ? raw.edges.map(normalizeGraphPlannedEdgeSpec).filter((edge): edge is GraphPlannedEdgeSpec => Boolean(edge))
    : [];
  if (Array.isArray(raw.edges) && edges.length !== raw.edges.length) {
    return null;
  }
  return {
    ...(normalizePositiveInteger(raw.maxConcurrent, 0, GRAPH_PLANNER_MAX_CONCURRENT) > 0
      ? { maxConcurrent: normalizePositiveInteger(raw.maxConcurrent, GRAPH_DEFAULT_MAX_CONCURRENT_NODES, GRAPH_PLANNER_MAX_CONCURRENT) }
      : {}),
    nodes,
    ...(edges.length > 0 ? { edges } : {}),
  };
}

export function materializeGraphPlan(
  run: GraphRunRecord,
  plannedGraph: GraphPlannedGraphSpec,
  options: GraphPlanMaterializationOptions = {},
): GraphPlanMaterializationResult {
  const plannerNodeId = options.plannerNodeId ?? GRAPH_AI_PLANNER_NODE_ID;
  const appendMode = options.mode === "append" || plannerNodeId !== GRAPH_AI_PLANNER_NODE_ID;
  const plannerNode = run.nodes.find((node) => node.id === plannerNodeId);
  if (!plannerNode) {
    return unchangedGraphPlanResult(run, `Graph planner node ${plannerNodeId} does not exist.`);
  }
  if (plannerNode.status !== "passed") {
    return unchangedGraphPlanResult(run, `Graph planner node ${plannerNodeId} must pass before materialization; current status is ${plannerNode.status}.`);
  }
  if (!appendMode && run.nodes.some((node) => node.id !== GRAPH_AI_PLANNER_NODE_ID)) {
    return {
      run,
      changed: false,
      plannedNodeIds: run.nodes.filter((node) => node.id !== GRAPH_AI_PLANNER_NODE_ID).map((node) => node.id),
    };
  }

  const graph = normalizeGraphPlannedGraphSpec(plannedGraph);
  if (!graph) {
    return unchangedGraphPlanResult(run, "Planner output plannedGraph is missing or invalid.");
  }

  const normalized = appendMode
    ? buildAppendedMaterializedGraph(run, plannerNode, graph)
    : buildMaterializedGraph(run, plannerNode, graph);
  if (normalized.error) {
    return unchangedGraphPlanResult(run, normalized.error);
  }

  const timestamp = options.now?.() ?? Date.now();
  const nextRun: GraphRunRecord = {
    ...run,
    status: "running",
    updatedAt: timestamp,
    activeNodeIds: run.activeNodeIds.filter((nodeId) => nodeId !== plannerNodeId),
    maxConcurrent: appendMode
      ? Math.max(run.maxConcurrent, resolveMaterializedGraphMaxConcurrent(graph, normalized.materializedNodes))
      : resolveMaterializedGraphMaxConcurrent(graph, normalized.materializedNodes),
    nodes: normalized.nodes,
    edges: normalized.edges,
  };
  return {
    run: nextRun,
    changed: true,
    plannedNodeIds: normalized.plannedNodeIds,
  };
}

function buildMaterializedGraph(
  run: GraphRunRecord,
  plannerNode: GraphNodeRecord,
  graph: GraphPlannedGraphSpec,
): MaterializedGraphBuildResult {
  const duplicateNodeId = findDuplicate(graph.nodes.map((node) => node.id));
  if (duplicateNodeId) {
    return emptyMaterializedGraphResult(`Planner output contains duplicate node id ${duplicateNodeId}.`);
  }
  if (graph.nodes.some((node) => node.id === GRAPH_AI_PLANNER_NODE_ID)) {
    return emptyMaterializedGraphResult(`Planner output must not redefine reserved node id ${GRAPH_AI_PLANNER_NODE_ID}.`);
  }
  const safetyError = validatePlannerGraphSafety(graph);
  if (safetyError) {
    return emptyMaterializedGraphResult(safetyError);
  }

  const plannedNodeIds = new Set(graph.nodes.map((node) => node.id));
  const materializedNodes = graph.nodes.map((node) => buildGraphNodeRecordFromPlan(node));
  const edgeRecords: GraphEdgeRecord[] = [];
  const dependencyByNodeId = new Map<string, Set<string>>();

  materializedNodes.forEach((node) => {
    dependencyByNodeId.set(node.id, new Set(node.dependsOn));
  });

  const appendDependency = (from: string, to: string): void => {
    const dependencies = dependencyByNodeId.get(to) ?? new Set<string>();
    dependencies.add(from);
    dependencyByNodeId.set(to, dependencies);
  };

  for (const edge of graph.edges ?? []) {
    const normalizedEdge = buildGraphEdgeRecordFromPlan(edge, edgeRecords.length);
    if (!normalizedEdge) {
      return emptyMaterializedGraphResult(`Planner output contains invalid edge from ${String(edge.from)} to ${String(edge.to)}.`);
    }
    if (!isKnownMaterializedNode(normalizedEdge.from, plannedNodeIds) || !isKnownMaterializedNode(normalizedEdge.to, plannedNodeIds)) {
      return emptyMaterializedGraphResult(`Planner edge ${normalizedEdge.id} references an unknown node.`);
    }
    if (normalizedEdge.to === GRAPH_AI_PLANNER_NODE_ID) {
      return emptyMaterializedGraphResult(`Planner edge ${normalizedEdge.id} must not target the reserved planner node.`);
    }
    if (normalizedEdge.kind === "depends_on") {
      appendDependency(normalizedEdge.from, normalizedEdge.to);
    }
    edgeRecords.push(normalizedEdge);
  }

  materializedNodes.forEach((node) => {
    const dependencies = dependencyByNodeId.get(node.id) ?? new Set<string>();
    if (dependencies.size === 0) {
      dependencies.add(GRAPH_AI_PLANNER_NODE_ID);
    }
    dependencyByNodeId.set(node.id, dependencies);
  });

  for (const node of materializedNodes) {
    for (const dependencyId of dependencyByNodeId.get(node.id) ?? []) {
      if (!isKnownMaterializedNode(dependencyId, plannedNodeIds)) {
        return emptyMaterializedGraphResult(`Planner node ${node.id} depends on unknown node ${dependencyId}.`);
      }
      ensureGraphEdge(edgeRecords, {
        from: dependencyId,
        to: node.id,
        kind: "depends_on",
      });
    }
  }

  const withSummary = ensureSummaryNode(materializedNodes, edgeRecords, dependencyByNodeId);
  if (hasDependencyCycle(withSummary.nodes, withSummary.edges)) {
    return emptyMaterializedGraphResult("Planner output contains a dependency cycle.");
  }

  const unlocksByNodeId = buildUnlocksByNodeId([plannerNode, ...withSummary.nodes], withSummary.edges);
  const nextPlannerNode: GraphNodeRecord = {
    ...plannerNode,
    unlocks: unlocksByNodeId.get(plannerNode.id) ?? [],
  };
  const nextMaterializedNodes = withSummary.nodes.map((node) => ({
    ...node,
    dependsOn: Array.from(dependencyByNodeId.get(node.id) ?? new Set(node.dependsOn)).sort(),
    unlocks: unlocksByNodeId.get(node.id) ?? [],
  }));
  const nextNodes = [
    nextPlannerNode,
    ...nextMaterializedNodes,
  ];

  return {
    nodes: nextNodes,
    edges: withSummary.edges,
    materializedNodes: nextMaterializedNodes,
    plannedNodeIds: nextMaterializedNodes
      .filter((node) => node.id !== GRAPH_AI_PLANNER_NODE_ID)
      .map((node) => node.id),
  };
}

function buildAppendedMaterializedGraph(
  run: GraphRunRecord,
  plannerNode: GraphNodeRecord,
  graph: GraphPlannedGraphSpec,
): MaterializedGraphBuildResult {
  const duplicateNodeId = findDuplicate(graph.nodes.map((node) => node.id));
  if (duplicateNodeId) {
    return emptyMaterializedGraphResult(`Planner output contains duplicate node id ${duplicateNodeId}.`);
  }
  const existingNodeIds = new Set(run.nodes.map((node) => node.id));
  const collidingNode = graph.nodes.find((node) => existingNodeIds.has(node.id));
  if (collidingNode) {
    return emptyMaterializedGraphResult(`Planner output for ${plannerNode.id} must only add new node ids; ${collidingNode.id} already exists.`);
  }
  const safetyError = validatePlannerGraphSafety(graph);
  if (safetyError) {
    return emptyMaterializedGraphResult(safetyError);
  }

  const plannedNodeIds = new Set(graph.nodes.map((node) => node.id));
  const knownNodeIds = new Set([...existingNodeIds, ...plannedNodeIds]);
  const materializedNodes = graph.nodes.map((node) => buildGraphNodeRecordFromPlan(node));
  const edgeRecords: GraphEdgeRecord[] = [...run.edges];
  const dependencyByNodeId = new Map<string, Set<string>>();

  materializedNodes.forEach((node) => {
    dependencyByNodeId.set(node.id, new Set(node.dependsOn));
  });

  const appendDependency = (from: string, to: string): void => {
    const dependencies = dependencyByNodeId.get(to);
    if (dependencies) {
      dependencies.add(from);
    }
  };

  for (const edge of graph.edges ?? []) {
    const normalizedEdge = buildGraphEdgeRecordFromPlan(edge, edgeRecords.length);
    if (!normalizedEdge) {
      return emptyMaterializedGraphResult(`Planner output contains invalid edge from ${String(edge.from)} to ${String(edge.to)}.`);
    }
    if (edgeRecords.some((existingEdge) => existingEdge.id === normalizedEdge.id)) {
      return emptyMaterializedGraphResult(`Planner edge ${normalizedEdge.id} already exists in the current Graph run.`);
    }
    if (!knownNodeIds.has(normalizedEdge.from) || !knownNodeIds.has(normalizedEdge.to)) {
      return emptyMaterializedGraphResult(`Planner edge ${normalizedEdge.id} references an unknown node.`);
    }
    if (existingNodeIds.has(normalizedEdge.to)) {
      return emptyMaterializedGraphResult(`Planner edge ${normalizedEdge.id} must not target existing node ${normalizedEdge.to}; append new continuation nodes instead.`);
    }
    if (normalizedEdge.kind === "depends_on") {
      appendDependency(normalizedEdge.from, normalizedEdge.to);
    }
    edgeRecords.push(normalizedEdge);
  }

  materializedNodes.forEach((node) => {
    const dependencies = dependencyByNodeId.get(node.id) ?? new Set<string>();
    dependencies.add(plannerNode.id);
    dependencyByNodeId.set(node.id, dependencies);
  });

  for (const node of materializedNodes) {
    for (const dependencyId of dependencyByNodeId.get(node.id) ?? []) {
      if (!knownNodeIds.has(dependencyId)) {
        return emptyMaterializedGraphResult(`Planner node ${node.id} depends on unknown node ${dependencyId}.`);
      }
      ensureGraphEdge(edgeRecords, {
        from: dependencyId,
        to: node.id,
        kind: "depends_on",
      });
    }
  }

  const withSummary = ensureSummaryNode(materializedNodes, edgeRecords, dependencyByNodeId, {
    summaryId: buildGraphReplanSummaryNodeId(plannerNode.id, knownNodeIds),
    summaryTitle: "总结 Graph 续跑结果",
  });
  const allNodesBeforeUnlocks = [...run.nodes, ...withSummary.nodes];
  if (hasDependencyCycle(allNodesBeforeUnlocks, edgeRecords)) {
    return emptyMaterializedGraphResult("Planner output contains a dependency cycle.");
  }

  const unlocksByNodeId = buildUnlocksByNodeId(allNodesBeforeUnlocks, edgeRecords);
  const nextExistingNodes = run.nodes.map((node) => ({
    ...node,
    unlocks: unlocksByNodeId.get(node.id) ?? [],
  }));
  const nextMaterializedNodes = withSummary.nodes.map((node) => ({
    ...node,
    dependsOn: Array.from(dependencyByNodeId.get(node.id) ?? new Set(node.dependsOn)).sort(),
    unlocks: unlocksByNodeId.get(node.id) ?? [],
  }));
  return {
    nodes: [
      ...nextExistingNodes,
      ...nextMaterializedNodes,
    ],
    edges: edgeRecords,
    materializedNodes: nextMaterializedNodes,
    plannedNodeIds: nextMaterializedNodes.map((node) => node.id),
  };
}

function resolveMaterializedGraphMaxConcurrent(
  graph: GraphPlannedGraphSpec,
  nodes: readonly GraphNodeRecord[],
): number {
  const explicitMaxConcurrent = normalizePositiveInteger(graph.maxConcurrent, 0, GRAPH_PLANNER_MAX_CONCURRENT);
  if (explicitMaxConcurrent > 0) {
    return explicitMaxConcurrent;
  }
  return inferInitialRunnableParallelism(nodes);
}

function inferInitialRunnableParallelism(nodes: readonly GraphNodeRecord[]): number {
  const rootCandidates = nodes.filter(isPlannerRootCliNode);
  const selected: GraphNodeRecord[] = [];
  for (const candidate of rootCandidates) {
    if (selected.length >= GRAPH_PLANNER_MAX_CONCURRENT) {
      break;
    }
    if (selected.some((selectedNode) => getGraphNodeConflictReason(candidate, selectedNode))) {
      continue;
    }
    selected.push(candidate);
  }
  return Math.max(1, selected.length);
}

function isPlannerRootCliNode(node: GraphNodeRecord): boolean {
  return node.id !== GRAPH_AI_PLANNER_NODE_ID
    && node.kind !== "summary"
    && isGraphCliExecutableNode(node)
    && node.dependsOn.length === 1
    && isGraphPlannerDependencyNodeId(node.dependsOn[0] as string);
}

function isGraphPlannerDependencyNodeId(nodeId: string): boolean {
  return nodeId === GRAPH_AI_PLANNER_NODE_ID
    || nodeId.startsWith(`${GRAPH_AI_REPLANNER_NODE_ID_PREFIX}-`);
}

function buildGraphNodeRecordFromPlan(node: GraphPlannedNodeSpec): GraphNodeRecord {
  const ownerRole = resolvePlannedNodeOwnerRole(node);
  const dependsOn = normalizeStringArray(node.dependsOn);
  return {
    id: node.id.trim(),
    title: formatGraphNodeTitleInChinese(node),
    kind: node.kind,
    status: "pending",
    ownerRole,
    ...(typeof node.blocking === "boolean" ? { blocking: node.blocking } : {}),
    ...(typeof node.promptRef === "string" && node.promptRef.trim() ? { promptRef: node.promptRef.trim() } : {}),
    ...(normalizeStringArray(node.writeFiles).length > 0 ? { writeFiles: normalizeStringArray(node.writeFiles) } : {}),
    ...(typeof node.conflictGroup === "string" && node.conflictGroup.trim() ? { conflictGroup: node.conflictGroup.trim() } : {}),
    maxAttempts: normalizePositiveInteger(node.maxAttempts, 1, GRAPH_PLANNER_MAX_ATTEMPTS),
    attempts: 0,
    dependsOn,
    unlocks: [],
    ...(normalizeAcceptance(node.acceptance).length > 0 ? { acceptance: normalizeAcceptance(node.acceptance) } : {}),
    ...(typeof node.wakeAt === "number" && Number.isFinite(node.wakeAt) ? { wakeAt: node.wakeAt } : {}),
  };
}

function buildGraphEdgeRecordFromPlan(edge: GraphPlannedEdgeSpec, index: number): GraphEdgeRecord | null {
  const from = typeof edge.from === "string" ? edge.from.trim() : "";
  const to = typeof edge.to === "string" ? edge.to.trim() : "";
  const kind = edge.kind ?? "depends_on";
  if (!from || !to || from === to || !isGraphEdgeKind(kind)) {
    return null;
  }
  return {
    id: typeof edge.id === "string" && edge.id.trim()
      ? edge.id.trim()
      : buildGraphEdgeId(from, to, kind, index),
    from,
    to,
    kind,
    ...(typeof edge.label === "string" && edge.label.trim() ? { label: edge.label.trim() } : {}),
    ...(typeof edge.condition === "string" && edge.condition.trim() ? { condition: edge.condition.trim() } : {}),
    ...(edge.conditionExpression ? { conditionExpression: edge.conditionExpression } : {}),
    ...(edge.metadata ? { metadata: edge.metadata } : {}),
    active: typeof edge.active === "boolean" ? edge.active : true,
  };
}

function ensureSummaryNode(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  dependencyByNodeId: Map<string, Set<string>>,
  options: { summaryId?: string; summaryTitle?: string } = {},
): { nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] } {
  const existingSummary = nodes.find((node) => node.kind === "summary");
  const summaryNode = existingSummary ?? buildDefaultSummaryNode(nodes, options);
  const nextNodes = existingSummary ? nodes : [...nodes, summaryNode];
  if (!dependencyByNodeId.has(summaryNode.id)) {
    dependencyByNodeId.set(summaryNode.id, new Set<string>());
  }
  const dependencies = dependencyByNodeId.get(summaryNode.id) as Set<string>;
  if (dependencies.size === 0) {
    getDependencyLeafNodeIds(nextNodes, edges, summaryNode.id).forEach((nodeId) => dependencies.add(nodeId));
  }
  dependencyByNodeId.set(summaryNode.id, dependencies);
  dependencies.forEach((dependencyId) => ensureGraphEdge(edges, {
    from: dependencyId,
    to: summaryNode.id,
    kind: "depends_on",
  }));
  return { nodes: nextNodes, edges };
}

function buildDefaultSummaryNode(
  nodes: readonly GraphNodeRecord[],
  options: { summaryId?: string; summaryTitle?: string } = {},
): GraphNodeRecord {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const id = options.summaryId
    ?? (nodeIds.has(GRAPH_AI_PLANNER_SUMMARY_NODE_ID) ? "final-summary" : GRAPH_AI_PLANNER_SUMMARY_NODE_ID);
  return {
    id,
    title: options.summaryTitle ?? "总结 AI 规划的 Graph 运行",
    kind: "summary",
    status: "pending",
    ownerRole: "main",
    maxAttempts: 1,
    attempts: 0,
    dependsOn: [],
    unlocks: [],
    acceptance: [{
      name: "最终回答总结已完成节点、验证证据、未解决事项和 Graph DAG 结果。",
      required: true,
    }],
  };
}

function getDependencyLeafNodeIds(
  nodes: readonly GraphNodeRecord[],
  edges: readonly GraphEdgeRecord[],
  summaryNodeId: string,
): string[] {
  const outgoing = new Set(edges
    .filter((edge) => edge.active && edge.kind === "depends_on")
    .map((edge) => edge.from));
  const leaves = nodes
    .filter((node) => node.id !== summaryNodeId && node.kind !== "summary" && !outgoing.has(node.id))
    .map((node) => node.id);
  return leaves.length > 0
    ? leaves
    : nodes.filter((node) => node.id !== summaryNodeId && node.kind !== "summary").map((node) => node.id);
}

function ensureGraphEdge(
  edges: GraphEdgeRecord[],
  input: { from: string; to: string; kind: GraphEdgeKind },
): void {
  if (edges.some((edge) => edge.from === input.from && edge.to === input.to && edge.kind === input.kind && edge.active)) {
    return;
  }
  edges.push({
    id: buildGraphEdgeId(input.from, input.to, input.kind, edges.length),
    from: input.from,
    to: input.to,
    kind: input.kind,
    active: true,
  });
}

function buildUnlocksByNodeId(
  nodes: readonly GraphNodeRecord[],
  edges: readonly GraphEdgeRecord[],
): Map<string, string[]> {
  const known = new Set(nodes.map((node) => node.id));
  const unlocks = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    if (!edge.active || edge.kind === "conflicts_with" || edge.kind === "evidence_for") {
      return;
    }
    if (!known.has(edge.from) || !known.has(edge.to)) {
      return;
    }
    const values = unlocks.get(edge.from) ?? new Set<string>();
    values.add(edge.to);
    unlocks.set(edge.from, values);
  });
  return new Map(Array.from(unlocks.entries()).map(([nodeId, values]) => [nodeId, Array.from(values).sort()]));
}

function hasDependencyCycle(nodes: readonly GraphNodeRecord[], edges: readonly GraphEdgeRecord[]): boolean {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!edge.active || edge.kind !== "depends_on" || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return;
    }
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return Array.from(nodeIds).some(visit);
}

function normalizeGraphPlannedNodeSpec(value: unknown): GraphPlannedNodeSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphPlannedNodeSpec>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!GRAPH_PLANNER_NODE_ID_PATTERN.test(id) || !title || !isGraphNodeKind(raw.kind)) {
    return null;
  }
  const ownerRole = typeof raw.ownerRole === "string" && isGraphOwnerRole(raw.ownerRole) ? raw.ownerRole : undefined;
  return {
    id,
    title,
    kind: raw.kind,
    ...(ownerRole ? { ownerRole } : {}),
    ...(typeof raw.blocking === "boolean" ? { blocking: raw.blocking } : {}),
    ...(typeof raw.promptRef === "string" && raw.promptRef.trim() ? { promptRef: raw.promptRef.trim() } : {}),
    ...(normalizeStringArray(raw.writeFiles).length > 0 ? { writeFiles: normalizeStringArray(raw.writeFiles) } : {}),
    ...(typeof raw.conflictGroup === "string" && raw.conflictGroup.trim() ? { conflictGroup: raw.conflictGroup.trim() } : {}),
    ...(normalizePositiveInteger(raw.maxAttempts, 0, GRAPH_PLANNER_MAX_ATTEMPTS) > 0
      ? { maxAttempts: normalizePositiveInteger(raw.maxAttempts, 1, GRAPH_PLANNER_MAX_ATTEMPTS) }
      : {}),
    ...(normalizeStringArray(raw.dependsOn).length > 0 ? { dependsOn: normalizeStringArray(raw.dependsOn) } : {}),
    ...(normalizeAcceptance(raw.acceptance).length > 0 ? { acceptance: normalizeAcceptance(raw.acceptance) } : {}),
    ...(typeof raw.wakeAt === "number" && Number.isFinite(raw.wakeAt) ? { wakeAt: raw.wakeAt } : {}),
  };
}

function normalizeGraphPlannedEdgeSpec(value: unknown): GraphPlannedEdgeSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphPlannedEdgeSpec>;
  const from = typeof raw.from === "string" ? raw.from.trim() : "";
  const to = typeof raw.to === "string" ? raw.to.trim() : "";
  const kind = raw.kind ?? "depends_on";
  if (!from || !to || from === to || !isGraphEdgeKind(kind)) {
    return null;
  }
  const conditionExpression = normalizeGraphEdgeConditionExpression(raw.conditionExpression);
  if (raw.conditionExpression !== undefined && !conditionExpression) {
    return null;
  }
  const metadata = normalizeGraphEdgeMetadata(raw.metadata);
  if (raw.metadata !== undefined) {
    if (!raw.metadata || typeof raw.metadata !== "object" || Array.isArray(raw.metadata)) {
      return null;
    }
    if (!metadata && Object.keys(raw.metadata).length > 0) {
      return null;
    }
  }
  return {
    ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
    from,
    to,
    kind,
    ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
    ...(typeof raw.condition === "string" && raw.condition.trim() ? { condition: raw.condition.trim() } : {}),
    ...(conditionExpression ? { conditionExpression } : {}),
    ...(metadata ? { metadata } : {}),
    ...(typeof raw.active === "boolean" ? { active: raw.active } : {}),
  };
}

function normalizeGraphEdgeConditionExpression(value: unknown): GraphEdgeConditionExpression | null {
  if (value === undefined) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphEdgeConditionExpression>;
  if (!isGraphEdgeConditionType(raw.type)) {
    return null;
  }
  const operator = raw.operator === undefined
    ? undefined
    : isGraphEdgeConditionOperator(raw.operator) ? raw.operator : null;
  if (operator === null) {
    return null;
  }
  const statuses = normalizeGraphNodeStatuses(raw.statuses);
  if (Array.isArray(raw.statuses) && statuses.length !== raw.statuses.length) {
    return null;
  }
  if (raw.status !== undefined && !isGraphNodeStatus(raw.status)) {
    return null;
  }
  const expected = normalizeGraphConditionExpected(raw.expected);
  if (raw.expected !== undefined && expected === undefined) {
    return null;
  }
  return {
    type: raw.type,
    ...(operator ? { operator } : {}),
    ...(raw.status ? { status: raw.status } : {}),
    ...(statuses.length > 0 ? { statuses } : {}),
    ...(typeof raw.acceptanceId === "string" && raw.acceptanceId.trim() ? { acceptanceId: raw.acceptanceId.trim() } : {}),
    ...(expected !== undefined ? { expected } : {}),
    ...(typeof raw.description === "string" && raw.description.trim() ? { description: raw.description.trim() } : {}),
  };
}

function normalizeGraphEdgeMetadata(value: unknown): GraphEdgeMetadata | null {
  if (value === undefined) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphEdgeMetadata>;
  const reworkScopeNodeIds = normalizeStringArray(raw.reworkScopeNodeIds);
  if (Array.isArray(raw.reworkScopeNodeIds) && reworkScopeNodeIds.length !== raw.reworkScopeNodeIds.length) {
    return null;
  }
  const metadata: GraphEdgeMetadata = {
    ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
    ...(typeof raw.rationale === "string" && raw.rationale.trim() ? { rationale: raw.rationale.trim() } : {}),
    ...(typeof raw.evidenceRef === "string" && raw.evidenceRef.trim() ? { evidenceRef: raw.evidenceRef.trim() } : {}),
    ...(typeof raw.feedbackReason === "string" && raw.feedbackReason.trim() ? { feedbackReason: raw.feedbackReason.trim() } : {}),
    ...(typeof raw.reworkTargetNodeId === "string" && raw.reworkTargetNodeId.trim() ? { reworkTargetNodeId: raw.reworkTargetNodeId.trim() } : {}),
    ...(reworkScopeNodeIds.length > 0 ? { reworkScopeNodeIds } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function normalizeGraphNodeStatuses(value: unknown): GraphNodeStatus[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is GraphNodeStatus => isGraphNodeStatus(item));
}

function normalizeGraphConditionExpected(value: unknown): GraphEdgeConditionExpression["expected"] | undefined {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number"
    ? value
    : undefined;
}

function resolvePlannedNodeOwnerRole(node: GraphPlannedNodeSpec): GraphOwnerRole {
  if (node.ownerRole && isGraphOwnerRole(node.ownerRole)) {
    return node.ownerRole;
  }
  if (node.kind === "human_gate") {
    return "human";
  }
  if (node.kind === "sleep" || node.kind === "summary") {
    return "system";
  }
  if (node.kind === "review") {
    return "reviewer";
  }
  if (node.kind === "debate") {
    return "moderator";
  }
  if (node.kind === "plan" || node.kind === "intake") {
    return "main";
  }
  return "subtask";
}

function normalizeAcceptance(value: unknown): GraphAcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const raw = item as Partial<GraphAcceptanceCheck>;
      if (typeof raw.name !== "string" || !raw.name.trim()) {
        return null;
      }
      return {
        ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
        name: raw.name.trim(),
        ...(typeof raw.passed === "boolean" ? { passed: raw.passed } : {}),
        ...(typeof raw.required === "boolean" ? { required: raw.required } : {}),
        ...(typeof raw.detail === "string" ? { detail: raw.detail } : {}),
        ...(typeof raw.evidenceRef === "string" && raw.evidenceRef.trim() ? { evidenceRef: raw.evidenceRef.trim() } : {}),
      };
    })
    .filter((item): item is GraphAcceptanceCheck => Boolean(item));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePositiveInteger(value: unknown, fallback: number, maxValue = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, maxValue);
}

function isKnownMaterializedNode(nodeId: string, plannedNodeIds: ReadonlySet<string>): boolean {
  return nodeId === GRAPH_AI_PLANNER_NODE_ID || plannedNodeIds.has(nodeId);
}

function validatePlannerGraphSafety(graph: GraphPlannedGraphSpec): string | null {
  const humanGateNode = graph.nodes.find((node) => node.kind === "human_gate");
  if (humanGateNode) {
    return `Planner output must not include human_gate node ${humanGateNode.id}; model failed branches with failed/if_fail flow instead.`;
  }
  const humanEdge = (graph.edges ?? []).find((edge) => edge.kind === "human_approved" || edge.conditionExpression?.type === "manual");
  if (humanEdge) {
    return `Planner edge ${humanEdge.id ?? `${humanEdge.from}->${humanEdge.to}`} must not require human approval or manual conditions; model failures with if_fail flow instead.`;
  }
  return null;
}

function buildNextGraphReplannerNodeId(run: Pick<GraphRunRecord, "nodes">): string {
  const existingNodeIds = new Set(run.nodes.map((node) => node.id));
  let index = run.nodes.filter(isGraphAiReplannerNode).length + 1;
  while (existingNodeIds.has(`${GRAPH_AI_REPLANNER_NODE_ID_PREFIX}-${index}`)) {
    index += 1;
  }
  return `${GRAPH_AI_REPLANNER_NODE_ID_PREFIX}-${index}`;
}

function buildGraphReplanSummaryNodeId(
  plannerNodeId: string,
  knownNodeIds: ReadonlySet<string>,
): string {
  const base = `${plannerNodeId}-summary`;
  if (!knownNodeIds.has(base)) {
    return base;
  }
  let index = 2;
  while (knownNodeIds.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function emptyMaterializedGraphResult(error: string): MaterializedGraphBuildResult {
  return {
    nodes: [],
    edges: [],
    materializedNodes: [],
    plannedNodeIds: [],
    error,
  };
}

function findDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}

function buildGraphEdgeId(from: string, to: string, kind: GraphEdgeKind, index: number): string {
  return `edge-${sanitizeGraphPathSegment(from, "from")}-${sanitizeGraphPathSegment(to, "to")}-${kind}-${index + 1}`;
}

function unchangedGraphPlanResult(run: GraphRunRecord, error: string): GraphPlanMaterializationResult {
  return {
    run,
    changed: false,
    plannedNodeIds: [],
    error,
  };
}
