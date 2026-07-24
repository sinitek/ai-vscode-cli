import {
  GRAPH_DEFAULT_MAX_CONCURRENT_NODES,
  type GraphEdgeRecord,
  type GraphNodeKind,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "./types";

export const GRAPH_UNSCOPED_WRITE_CONFLICT_GROUP = "__graph_unscoped_write__";

export const GRAPH_SCHEDULER_BLOCKER_REASONS = [
  "terminal_status",
  "already_running",
  "already_sleeping",
  "attempts_exhausted",
  "missing_dependency",
  "dependency_not_passed",
  "edge_source_missing",
  "conditional_edge_inactive",
  "if_pass_not_satisfied",
  "if_fail_not_satisfied",
  "sleep_not_due",
  "running_conflict",
  "batch_conflict",
  "max_concurrent",
] as const;
export type GraphSchedulerBlockerReason = (typeof GRAPH_SCHEDULER_BLOCKER_REASONS)[number];

export const GRAPH_NODE_CONFLICT_REASONS = [
  "conflictGroup",
  "writeFiles",
  "unscopedWrite",
] as const;
export type GraphNodeConflictReason = (typeof GRAPH_NODE_CONFLICT_REASONS)[number];

export type GraphNodeBlocker = {
  nodeId: string;
  reason: GraphSchedulerBlockerReason;
  message: string;
  dependencyNodeId?: string;
  edgeId?: string;
  conflict?: GraphNodeConflict;
  value?: string;
};

export type GraphNodeConflict = {
  leftNodeId: string;
  rightNodeId: string;
  reason: GraphNodeConflictReason;
  value: string;
};

export type GraphReadyNodeExecutionKind = "cli" | "human_gate" | "sleep_due";

export type GraphReadyNode = {
  node: GraphNodeRecord;
  nodeId: string;
  executionKind: GraphReadyNodeExecutionKind;
};

export type GraphBlockedNode = {
  node: GraphNodeRecord;
  nodeId: string;
  blockers: GraphNodeBlocker[];
};

export type GraphReadySet = {
  readyNodes: GraphReadyNode[];
  blockedNodes: GraphBlockedNode[];
};

export type GraphSchedulerOptions = {
  now?: number;
  maxConcurrent?: number;
};

export type GraphExecutionBatch = {
  selectedNodes: GraphNodeRecord[];
  selectedNodeIds: string[];
  deferredNodes: GraphBlockedNode[];
  humanGateNodes: GraphReadyNode[];
  sleepReadyNodes: GraphReadyNode[];
  readyNodes: GraphReadyNode[];
  runningNodes: GraphNodeRecord[];
  maxConcurrent: number;
  availableSlots: number;
};

const GRAPH_CLI_EXECUTABLE_NODE_KINDS: readonly GraphNodeKind[] = [
  "intake",
  "plan",
  "implement",
  "test",
  "review",
  "debate",
  "merge",
  "summary",
];

const GRAPH_WRITE_CLASS_NODE_KINDS: readonly GraphNodeKind[] = [
  "implement",
  "test",
  "review",
  "merge",
];

export function computeGraphReadyNodeIds(
  run: GraphRunRecord,
  options: GraphSchedulerOptions = {},
): string[] {
  return computeGraphReadyNodes(run, options).readyNodes.map((item) => item.nodeId);
}

export function computeGraphReadyNodes(
  run: GraphRunRecord,
  options: GraphSchedulerOptions = {},
): GraphReadySet {
  const readyNodes: GraphReadyNode[] = [];
  const blockedNodes: GraphBlockedNode[] = [];

  run.nodes.forEach((node) => {
    const blockers = getGraphNodeBlockers(run, node.id, options);
    if (blockers.length > 0) {
      blockedNodes.push({ node, nodeId: node.id, blockers });
      return;
    }

    const executionKind = getGraphReadyNodeExecutionKind(node);
    if (!executionKind) {
      blockedNodes.push({
        node,
        nodeId: node.id,
        blockers: [{
          nodeId: node.id,
          reason: "terminal_status",
          message: `Graph node ${node.id} is not executable from status ${node.status}.`,
          value: node.status,
        }],
      });
      return;
    }

    readyNodes.push({ node, nodeId: node.id, executionKind });
  });

  return { readyNodes, blockedNodes };
}

export function buildGraphNodeExecutionBatch(
  run: GraphRunRecord,
  options: GraphSchedulerOptions = {},
): GraphExecutionBatch {
  return selectGraphRunnableBatch(run, options);
}

export function selectGraphRunnableBatch(
  run: GraphRunRecord,
  options: GraphSchedulerOptions = {},
): GraphExecutionBatch {
  const maxConcurrent = resolveGraphMaxConcurrent(run, options);
  const runningNodes = getGraphRunningNodes(run);
  const availableSlots = Math.max(0, maxConcurrent - runningNodes.length);
  const readySet = computeGraphReadyNodes(run, options);
  const humanGateNodes = readySet.readyNodes.filter((item) => item.executionKind === "human_gate");
  const sleepReadyNodes = readySet.readyNodes.filter((item) => item.executionKind === "sleep_due");
  const cliReadyNodes = readySet.readyNodes.filter((item) => item.executionKind === "cli");
  const selectedNodes: GraphNodeRecord[] = [];
  const deferredNodes: GraphBlockedNode[] = [...readySet.blockedNodes];

  cliReadyNodes.forEach((candidate) => {
    if (selectedNodes.length >= availableSlots) {
      deferredNodes.push({
        node: candidate.node,
        nodeId: candidate.nodeId,
        blockers: [{
          nodeId: candidate.nodeId,
          reason: "max_concurrent",
          message: `Graph node ${candidate.nodeId} is deferred because maxConcurrent is ${maxConcurrent}.`,
          value: String(maxConcurrent),
        }],
      });
      return;
    }

    const runningConflict = findFirstGraphNodeConflict(candidate.node, runningNodes);
    if (runningConflict) {
      deferredNodes.push({
        node: candidate.node,
        nodeId: candidate.nodeId,
        blockers: [{
          nodeId: candidate.nodeId,
          reason: "running_conflict",
          message: `Graph node ${candidate.nodeId} conflicts with running node ${runningConflict.rightNodeId}.`,
          conflict: runningConflict,
          value: runningConflict.value,
        }],
      });
      return;
    }

    const batchConflict = findFirstGraphNodeConflict(candidate.node, selectedNodes);
    if (batchConflict) {
      deferredNodes.push({
        node: candidate.node,
        nodeId: candidate.nodeId,
        blockers: [{
          nodeId: candidate.nodeId,
          reason: "batch_conflict",
          message: `Graph node ${candidate.nodeId} conflicts with selected node ${batchConflict.rightNodeId}.`,
          conflict: batchConflict,
          value: batchConflict.value,
        }],
      });
      return;
    }

    selectedNodes.push(candidate.node);
  });

  return {
    selectedNodes,
    selectedNodeIds: selectedNodes.map((node) => node.id),
    deferredNodes,
    humanGateNodes,
    sleepReadyNodes,
    readyNodes: readySet.readyNodes,
    runningNodes,
    maxConcurrent,
    availableSlots,
  };
}

export function getGraphNodeBlockers(
  run: GraphRunRecord,
  nodeId: string,
  options: GraphSchedulerOptions = {},
): GraphNodeBlocker[] {
  const node = run.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return [{
      nodeId,
      reason: "missing_dependency",
      message: `Graph node ${nodeId} does not exist.`,
      dependencyNodeId: nodeId,
    }];
  }

  const statusBlockers = getGraphNodeStatusBlockers(node, options);
  if (statusBlockers.length > 0) {
    return statusBlockers;
  }

  const nodeById = new Map(run.nodes.map((item) => [item.id, item]));
  const blockers: GraphNodeBlocker[] = [];
  const dependencyIds = collectGraphDependencyNodeIds(run, node);

  dependencyIds.forEach((dependencyNodeId) => {
    const dependency = nodeById.get(dependencyNodeId);
    if (!dependency) {
      blockers.push({
        nodeId: node.id,
        reason: "missing_dependency",
        message: `Graph node ${node.id} depends on missing node ${dependencyNodeId}.`,
        dependencyNodeId,
      });
      return;
    }
    if (dependency.status !== "passed") {
      blockers.push({
        nodeId: node.id,
        reason: "dependency_not_passed",
        message: `Graph node ${node.id} waits for dependency ${dependencyNodeId} to pass.`,
        dependencyNodeId,
        value: dependency.status,
      });
    }
  });

  getGraphConditionalInboundEdges(run, node.id).forEach((edge) => {
    const source = nodeById.get(edge.from);
    if (!source) {
      blockers.push({
        nodeId: node.id,
        reason: "edge_source_missing",
        message: `Graph node ${node.id} has conditional edge ${edge.id} from missing node ${edge.from}.`,
        dependencyNodeId: edge.from,
        edgeId: edge.id,
      });
      return;
    }
    if (!edge.active) {
      blockers.push({
        nodeId: node.id,
        reason: "conditional_edge_inactive",
        message: `Graph node ${node.id} waits because conditional edge ${edge.id} is inactive.`,
        dependencyNodeId: edge.from,
        edgeId: edge.id,
      });
      return;
    }
    if (edge.kind === "if_pass" && source.status !== "passed") {
      blockers.push({
        nodeId: node.id,
        reason: "if_pass_not_satisfied",
        message: `Graph node ${node.id} waits for ${edge.from} to pass.`,
        dependencyNodeId: edge.from,
        edgeId: edge.id,
        value: source.status,
      });
      return;
    }
    if (edge.kind === "if_fail" && source.status !== "failed" && source.status !== "blocked") {
      blockers.push({
        nodeId: node.id,
        reason: "if_fail_not_satisfied",
        message: `Graph node ${node.id} waits for ${edge.from} to fail or block.`,
        dependencyNodeId: edge.from,
        edgeId: edge.id,
        value: source.status,
      });
    }
  });

  return blockers;
}

export function getGraphNodeConflictReason(
  left: GraphNodeRecord,
  right: GraphNodeRecord,
): GraphNodeConflict | null {
  const leftConflictGroup = getGraphNodeNormalizedConflictGroup(left);
  const rightConflictGroup = getGraphNodeNormalizedConflictGroup(right);
  if (leftConflictGroup && rightConflictGroup && leftConflictGroup === rightConflictGroup) {
    return {
      leftNodeId: left.id,
      rightNodeId: right.id,
      reason: "conflictGroup",
      value: leftConflictGroup,
    };
  }

  const leftFiles = normalizeGraphWriteFiles(left.writeFiles);
  const rightFiles = normalizeGraphWriteFiles(right.writeFiles);
  for (const leftFile of leftFiles) {
    for (const rightFile of rightFiles) {
      if (graphWriteFilePathsOverlap(leftFile, rightFile)) {
        return {
          leftNodeId: left.id,
          rightNodeId: right.id,
          reason: "writeFiles",
          value: leftFile === rightFile ? leftFile : `${leftFile} <-> ${rightFile}`,
        };
      }
    }
  }

  if (isGraphUnscopedWriteNode(left) && isGraphWriteClassNode(right)) {
    return {
      leftNodeId: left.id,
      rightNodeId: right.id,
      reason: "unscopedWrite",
      value: GRAPH_UNSCOPED_WRITE_CONFLICT_GROUP,
    };
  }
  if (isGraphWriteClassNode(left) && isGraphUnscopedWriteNode(right)) {
    return {
      leftNodeId: left.id,
      rightNodeId: right.id,
      reason: "unscopedWrite",
      value: GRAPH_UNSCOPED_WRITE_CONFLICT_GROUP,
    };
  }

  return null;
}

export function hasGraphNodeWriteConflict(
  left: GraphNodeRecord,
  right: GraphNodeRecord,
): boolean {
  return Boolean(getGraphNodeConflictReason(left, right));
}

export function normalizeGraphWriteFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => normalizeGraphWriteFilePath(item))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(normalized));
}

export function normalizeGraphConflictGroup(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}

export function resolveGraphMaxConcurrent(
  run: Pick<GraphRunRecord, "maxConcurrent">,
  options: GraphSchedulerOptions = {},
): number {
  return normalizePositiveInteger(
    options.maxConcurrent,
    normalizePositiveInteger(run.maxConcurrent, GRAPH_DEFAULT_MAX_CONCURRENT_NODES),
  );
}

export function isGraphCliExecutableNode(node: GraphNodeRecord): boolean {
  return (GRAPH_CLI_EXECUTABLE_NODE_KINDS as readonly string[]).includes(node.kind);
}

export function isGraphWriteClassNode(node: GraphNodeRecord): boolean {
  return (GRAPH_WRITE_CLASS_NODE_KINDS as readonly string[]).includes(node.kind);
}

function getGraphReadyNodeExecutionKind(node: GraphNodeRecord): GraphReadyNodeExecutionKind | null {
  if (node.kind === "human_gate") {
    return "human_gate";
  }
  if (node.kind === "sleep") {
    return "sleep_due";
  }
  if (isGraphCliExecutableNode(node)) {
    return "cli";
  }
  return null;
}

function getGraphNodeStatusBlockers(
  node: GraphNodeRecord,
  options: GraphSchedulerOptions,
): GraphNodeBlocker[] {
  if (node.status === "running") {
    return [{
      nodeId: node.id,
      reason: "already_running",
      message: `Graph node ${node.id} is already running.`,
      value: node.status,
    }];
  }

  if (node.status === "sleeping") {
    if (node.kind === "sleep" && isGraphSleepNodeDue(node, options)) {
      return [];
    }
    return [{
      nodeId: node.id,
      reason: "already_sleeping",
      message: `Graph node ${node.id} is sleeping.`,
      value: node.status,
    }];
  }

  if (node.status === "failed") {
    if (node.attempts < node.maxAttempts) {
      return getGraphSleepBlockers(node, options);
    }
    return [{
      nodeId: node.id,
      reason: "attempts_exhausted",
      message: `Graph node ${node.id} exhausted ${node.maxAttempts} attempts.`,
      value: `${node.attempts}/${node.maxAttempts}`,
    }];
  }

  if (node.status !== "pending" && node.status !== "ready") {
    return [{
      nodeId: node.id,
      reason: "terminal_status",
      message: `Graph node ${node.id} is not schedulable from status ${node.status}.`,
      value: node.status,
    }];
  }

  return getGraphSleepBlockers(node, options);
}

function getGraphSleepBlockers(
  node: GraphNodeRecord,
  options: GraphSchedulerOptions,
): GraphNodeBlocker[] {
  if (node.kind !== "sleep" || isGraphSleepNodeDue(node, options)) {
    return [];
  }
  return [{
    nodeId: node.id,
    reason: "sleep_not_due",
    message: `Graph sleep node ${node.id} is waiting for wakeAt.`,
    value: String(node.wakeAt),
  }];
}

function isGraphSleepNodeDue(node: GraphNodeRecord, options: GraphSchedulerOptions): boolean {
  if (typeof node.wakeAt !== "number" || !Number.isFinite(node.wakeAt)) {
    return true;
  }
  return (options.now ?? Date.now()) >= node.wakeAt;
}

function collectGraphDependencyNodeIds(run: GraphRunRecord, node: GraphNodeRecord): string[] {
  const ids = new Set<string>();
  node.dependsOn.forEach((dependencyNodeId) => ids.add(dependencyNodeId));
  run.edges.forEach((edge) => {
    if (edge.to === node.id && edge.kind === "depends_on" && edge.active) {
      ids.add(edge.from);
    }
  });
  return Array.from(ids);
}

function getGraphConditionalInboundEdges(
  run: GraphRunRecord,
  nodeId: string,
): GraphEdgeRecord[] {
  return run.edges.filter((edge) => edge.to === nodeId && (edge.kind === "if_pass" || edge.kind === "if_fail"));
}

function getGraphRunningNodes(run: GraphRunRecord): GraphNodeRecord[] {
  const activeNodeIds = new Set(run.activeNodeIds);
  return run.nodes.filter((node) => node.status === "running" || activeNodeIds.has(node.id));
}

function findFirstGraphNodeConflict(
  node: GraphNodeRecord,
  existingNodes: GraphNodeRecord[],
): GraphNodeConflict | null {
  for (const existingNode of existingNodes) {
    const conflict = getGraphNodeConflictReason(node, existingNode);
    if (conflict) {
      return conflict;
    }
  }
  return null;
}

function getGraphNodeNormalizedConflictGroup(node: GraphNodeRecord): string | null {
  return normalizeGraphConflictGroup(node.conflictGroup);
}

function isGraphUnscopedWriteNode(node: GraphNodeRecord): boolean {
  return isGraphWriteClassNode(node)
    && normalizeGraphWriteFiles(node.writeFiles).length === 0
    && !getGraphNodeNormalizedConflictGroup(node);
}

function normalizeGraphWriteFilePath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/\.\//g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
  return normalized || null;
}

function graphWriteFilePathsOverlap(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  return isGraphPathAncestor(left, right) || isGraphPathAncestor(right, left);
}

function isGraphPathAncestor(parent: string, child: string): boolean {
  return Boolean(parent && child.startsWith(`${parent}/`));
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}
