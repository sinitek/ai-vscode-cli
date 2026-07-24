import {
  appendGraphEvent,
  type GraphEventAppendInput,
} from "./graphEvents";
import {
  approveGraphHumanGateNode,
  type GraphNodeLifecycleDeps,
} from "./graphNodeLifecycle";
import { resetGraphWorktreeToCommit } from "./graphWorktree";
import type {
  GraphEventRecord,
  GraphNodeKind,
  GraphNodeRecord,
  GraphRunRecord,
  GraphRunStatus,
} from "./types";

export const GRAPH_RUN_RESUMABLE_STATUSES = [
  "sleeping",
  "needs-review",
  "error",
] as const satisfies readonly GraphRunStatus[];

export const GRAPH_RUN_TERMINAL_STATUSES = [
  "completed",
  "stopped",
] as const satisfies readonly GraphRunStatus[];

export const GRAPH_RUN_CONTROL_SOURCES = [
  "panel",
  "message",
  "auto_wake",
  "system",
] as const;
export type GraphRunControlSource = (typeof GRAPH_RUN_CONTROL_SOURCES)[number];

export const GRAPH_RUN_CONTROL_BLOCKED_REASONS = [
  "already_running",
  "already_stopped",
  "completed_run",
  "terminal_run",
  "not_resumable",
  "node_not_found",
  "node_not_retryable",
  "feedback_not_available",
  "passed_descendants",
  "worktree_reset_failed",
  "not_human_gate",
  "human_gate_not_waiting",
] as const;
export type GraphRunControlBlockedReason = (typeof GRAPH_RUN_CONTROL_BLOCKED_REASONS)[number];

export type GraphRunControlOptions = GraphNodeLifecycleDeps & {
  source?: GraphRunControlSource;
  reason?: string;
  summary?: string;
};

export type GraphRunControlResult = {
  run: GraphRunRecord;
  ok: boolean;
  changed: boolean;
  message: string;
  reason?: GraphRunControlBlockedReason;
  nodeId?: string;
  changedNodeIds?: string[];
  blockedNodeIds?: string[];
};

export type GraphRunControlState = {
  canContinue: boolean;
  canSupplement: boolean;
  canStop: boolean;
  retryableNodeIds: string[];
  feedbackableNodeIds: string[];
  approvableNodeIds: string[];
};

const GRAPH_FEEDBACK_SOURCE_NODE_KINDS: readonly GraphNodeKind[] = [
  "test",
  "review",
  "merge",
  "human_gate",
  "summary",
];

const GRAPH_FEEDBACK_EDGE_KINDS = [
  "review_feedback",
  "if_fail",
] as const;

const GRAPH_REWORK_TARGET_NODE_KINDS: readonly GraphNodeKind[] = [
  "implement",
  "merge",
  "debate",
  "plan",
  "intake",
];

const GRAPH_REWORK_TARGET_KIND_PRIORITY: Record<GraphNodeKind, number> = {
  implement: 0,
  merge: 1,
  intake: 2,
  plan: 3,
  debate: 4,
  test: 5,
  review: 6,
  human_gate: 7,
  sleep: 8,
  summary: 9,
};

export async function resumeGraphRunRecord(
  run: GraphRunRecord,
  options: GraphRunControlOptions = {},
): Promise<GraphRunControlResult> {
  if (run.status === "running") {
    return unchangedControlResult(run, true, "already_running", "Graph run is already running.");
  }
  if (run.status === "completed") {
    return unchangedControlResult(run, false, "completed_run", "Completed Graph runs cannot be resumed.");
  }
  if (run.status === "stopped") {
    return unchangedControlResult(run, false, "already_stopped", "Stopped Graph runs cannot be resumed.");
  }
  if (!isGraphRunResumableStatus(run.status)) {
    return unchangedControlResult(run, false, "not_resumable", `Graph run cannot resume from status ${run.status}.`);
  }

  const timestamp = resolveGraphRunControlTimestamp(options);
  const nextRun: GraphRunRecord = {
    ...run,
    status: "running",
    updatedAt: timestamp,
  };
  await appendGraphRunControlEvent(nextRun, {
    runId: nextRun.id,
    type: "run.resumed",
    timestamp,
    summary: options.summary ?? options.reason ?? `Graph run resumed from ${run.status}.`,
    data: {
      source: options.source ?? "system",
      previousStatus: run.status,
      reason: options.reason,
    },
  }, options);
  return {
    run: nextRun,
    ok: true,
    changed: true,
    message: `Graph run resumed from ${run.status}.`,
  };
}

export async function retryGraphNodeForRun(
  run: GraphRunRecord,
  nodeId: string,
  options: GraphRunControlOptions = {},
): Promise<GraphRunControlResult> {
  if (isGraphRunTerminalStatus(run.status)) {
    return unchangedControlResult(run, false, "terminal_run", `Graph run ${run.id} is ${run.status}.`, nodeId);
  }

  const node = run.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return unchangedControlResult(run, false, "node_not_found", `Graph node ${nodeId} does not exist.`, nodeId);
  }
  if (node.status !== "failed" && node.status !== "blocked") {
    return unchangedControlResult(run, false, "node_not_retryable", `Graph node ${nodeId} is not retryable from status ${node.status}.`, nodeId);
  }

  const passedDescendantNodeIds = findGraphPassedDescendantNodeIds(run, nodeId);
  if (passedDescendantNodeIds.length > 0) {
    return {
      run,
      ok: false,
      changed: false,
      message: `Graph node ${nodeId} has passed descendants and requires explicit cascade reset confirmation.`,
      reason: "passed_descendants",
      nodeId,
      blockedNodeIds: passedDescendantNodeIds,
    };
  }

  let worktreeReset: { headCommit: string; resetTo: string; worktreeCwd: string } | null = null;
  if (run.worktree?.cwd && node.baseCommit) {
    try {
      worktreeReset = resetGraphWorktreeToCommit(run.worktree.cwd, node.baseCommit);
    } catch (error) {
      return {
        run,
        ok: false,
        changed: false,
        message: `Graph node ${nodeId} retry could not reset worktree: ${errorToMessage(error)}`,
        reason: "worktree_reset_failed",
        nodeId,
      };
    }
  }

  const timestamp = resolveGraphRunControlTimestamp(options);
  const nextMaxAttempts = node.attempts >= node.maxAttempts
    ? node.attempts + 1
    : node.maxAttempts;
  const nextRun: GraphRunRecord = {
    ...run,
    status: "running",
    updatedAt: timestamp,
    activeNodeIds: run.activeNodeIds.filter((activeNodeId) => activeNodeId !== nodeId),
    nodes: run.nodes.map((item) => item.id === nodeId
      ? {
        ...item,
        status: "pending",
        maxAttempts: nextMaxAttempts,
        startedAt: undefined,
        completedAt: undefined,
        lastError: undefined,
        worktreeCwd: undefined,
        baseCommit: undefined,
        commit: undefined,
      }
      : item),
  };
  await appendGraphRunControlEvent(nextRun, {
    runId: nextRun.id,
    type: "node.retry_requested",
    timestamp,
    nodeId,
    attempt: node.attempts,
    summary: options.summary ?? options.reason ?? `Graph node ${nodeId} retry requested.`,
    data: {
      source: options.source ?? "system",
      previousStatus: node.status,
      attempts: node.attempts,
      previousMaxAttempts: node.maxAttempts,
      maxAttempts: nextMaxAttempts,
      reason: options.reason,
      worktreeReset,
    },
  }, options);
  return {
    run: nextRun,
    ok: true,
    changed: true,
    message: `Graph node ${nodeId} retry requested.`,
    nodeId,
    changedNodeIds: [nodeId],
  };
}

export async function feedbackGraphNodeForRun(
  run: GraphRunRecord,
  nodeId: string,
  options: GraphRunControlOptions = {},
): Promise<GraphRunControlResult> {
  if (isGraphRunTerminalStatus(run.status)) {
    return unchangedControlResult(run, false, "terminal_run", `Graph run ${run.id} is ${run.status}.`, nodeId);
  }

  const sourceNode = run.nodes.find((item) => item.id === nodeId);
  if (!sourceNode) {
    return unchangedControlResult(run, false, "node_not_found", `Graph node ${nodeId} does not exist.`, nodeId);
  }
  if (!isGraphFeedbackSourceNode(sourceNode)) {
    return unchangedControlResult(run, false, "feedback_not_available", `Graph node ${nodeId} cannot trigger upstream feedback from status ${sourceNode.status}.`, nodeId);
  }

  const targetNode = findGraphFeedbackTargetNode(run, nodeId);
  if (!targetNode || !run.worktree?.cwd || !targetNode.baseCommit) {
    return unchangedControlResult(run, false, "feedback_not_available", `Graph node ${nodeId} has no upstream checkpoint node available for feedback rollback.`, nodeId);
  }

  let worktreeReset: { headCommit: string; resetTo: string; worktreeCwd: string } | null = null;
  try {
    worktreeReset = resetGraphWorktreeToCommit(run.worktree.cwd, targetNode.baseCommit);
  } catch (error) {
    return {
      run,
      ok: false,
      changed: false,
      message: `Graph node ${nodeId} feedback rollback could not reset worktree: ${errorToMessage(error)}`,
      reason: "worktree_reset_failed",
      nodeId,
    };
  }

  const timestamp = resolveGraphRunControlTimestamp(options);
  const resetNodeIds = new Set([targetNode.id, ...findGraphDescendantNodeIds(run, targetNode.id)]);
  const previousStatuses = run.nodes
    .filter((node) => resetNodeIds.has(node.id))
    .map((node) => ({ nodeId: node.id, status: node.status }));
  const nextRun: GraphRunRecord = {
    ...run,
    status: "running",
    updatedAt: timestamp,
    activeNodeIds: run.activeNodeIds.filter((activeNodeId) => !resetNodeIds.has(activeNodeId)),
    nodes: run.nodes.map((node) => resetNodeIds.has(node.id)
      ? resetGraphNodeForRework(node)
      : node),
  };
  await appendGraphRunControlEvent(nextRun, {
    runId: nextRun.id,
    type: "node.feedback_requested",
    timestamp,
    nodeId,
    attempt: sourceNode.attempts,
    summary: options.summary ?? options.reason ?? `Graph node ${nodeId} requested upstream rework at ${targetNode.id}.`,
    data: {
      source: options.source ?? "system",
      feedbackNodeId: nodeId,
      reworkNodeId: targetNode.id,
      changedNodeIds: Array.from(resetNodeIds).sort(),
      previousStatuses,
      reason: options.reason,
      worktreeReset,
    },
  }, options);
  return {
    run: nextRun,
    ok: true,
    changed: true,
    message: `Graph node ${nodeId} feedback requested upstream rework at ${targetNode.id}.`,
    nodeId,
    changedNodeIds: Array.from(resetNodeIds).sort(),
  };
}

export async function approveGraphHumanGateForRun(
  run: GraphRunRecord,
  nodeId: string,
  options: GraphRunControlOptions = {},
): Promise<GraphRunControlResult> {
  if (isGraphRunTerminalStatus(run.status)) {
    return unchangedControlResult(run, false, "terminal_run", `Graph run ${run.id} is ${run.status}.`, nodeId);
  }
  const node = run.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return unchangedControlResult(run, false, "node_not_found", `Graph node ${nodeId} does not exist.`, nodeId);
  }
  if (node.kind !== "human_gate") {
    return unchangedControlResult(run, false, "not_human_gate", `Graph node ${nodeId} is not a human gate.`, nodeId);
  }
  if (node.status === "passed") {
    return {
      run,
      ok: true,
      changed: false,
      message: `Graph human gate ${nodeId} is already approved.`,
      nodeId,
    };
  }
  if (node.status !== "ready" && node.status !== "pending") {
    return unchangedControlResult(run, false, "human_gate_not_waiting", `Graph human gate ${nodeId} is not waiting from status ${node.status}.`, nodeId);
  }

  const nextRun = await approveGraphHumanGateNode(
    run,
    nodeId,
    options.summary ?? options.reason ?? "Human gate approved.",
    options,
  );
  return {
    run: nextRun,
    ok: true,
    changed: true,
    message: `Graph human gate ${nodeId} approved.`,
    nodeId,
    changedNodeIds: [nodeId],
  };
}

export async function stopGraphRunRecord(
  run: GraphRunRecord,
  options: GraphRunControlOptions = {},
): Promise<GraphRunControlResult> {
  if (run.status === "stopped") {
    return unchangedControlResult(run, true, "already_stopped", "Graph run is already stopped.");
  }
  if (run.status === "completed") {
    return unchangedControlResult(run, false, "completed_run", "Completed Graph runs cannot be stopped.");
  }

  const timestamp = resolveGraphRunControlTimestamp(options);
  const activeNodeIds = new Set(run.activeNodeIds);
  const stoppedNodeIds: string[] = [];
  const nodes = run.nodes.map((node) => {
    if (node.status !== "running" && !activeNodeIds.has(node.id)) {
      return node;
    }
    stoppedNodeIds.push(node.id);
    return {
      ...node,
      status: "stopped" as const,
      completedAt: timestamp,
      lastError: options.reason ?? "Graph run stopped.",
    };
  });
  const nextRun: GraphRunRecord = {
    ...run,
    status: "stopped",
    updatedAt: timestamp,
    activeNodeIds: [],
    nodes,
  };

  for (const stoppedNodeId of stoppedNodeIds) {
    await appendGraphRunControlEvent(nextRun, {
      runId: nextRun.id,
      type: "node.stopped",
      timestamp,
      nodeId: stoppedNodeId,
      summary: options.reason ?? `Graph node ${stoppedNodeId} stopped with run ${nextRun.id}.`,
      data: {
        source: options.source ?? "system",
        reason: options.reason,
      },
    }, options);
  }
  await appendGraphRunControlEvent(nextRun, {
    runId: nextRun.id,
    type: "run.stopped",
    timestamp,
    summary: options.summary ?? options.reason ?? `Graph run ${nextRun.id} stopped.`,
    data: {
      source: options.source ?? "system",
      reason: options.reason,
      stoppedNodeIds,
    },
  }, options);

  return {
    run: nextRun,
    ok: true,
    changed: true,
    message: `Graph run ${nextRun.id} stopped.`,
    changedNodeIds: stoppedNodeIds,
  };
}

export function getGraphRunControlState(run: GraphRunRecord): GraphRunControlState {
  const runIsTerminal = isGraphRunTerminalStatus(run.status);
  return {
	    canContinue: isGraphRunResumableStatus(run.status),
	    canSupplement: !runIsTerminal,
	    canStop: !runIsTerminal,
	    retryableNodeIds: runIsTerminal
	      ? []
	      : run.nodes
	        .filter((node) => (node.status === "failed" || node.status === "blocked")
	          && findGraphPassedDescendantNodeIds(run, node.id).length === 0)
	        .map((node) => node.id),
	    feedbackableNodeIds: runIsTerminal
	      ? []
	      : run.nodes
	        .filter((node) => isGraphFeedbackSourceNode(node) && Boolean(findGraphFeedbackTargetNode(run, node.id)))
	        .map((node) => node.id),
	    approvableNodeIds: runIsTerminal
	      ? []
	      : run.nodes
	        .filter((node) => node.kind === "human_gate" && (node.status === "ready" || node.status === "pending"))
	        .map((node) => node.id),
	  };
}

export function findGraphPassedDescendantNodeIds(
  run: GraphRunRecord,
  nodeId: string,
): string[] {
  const nodeById = new Map(run.nodes.map((node) => [node.id, node]));
  const adjacency = buildGraphRunAdjacency(run);
  const visited = new Set<string>();
  const queue = [...(adjacency.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const currentNodeId = queue.shift() as string;
    if (visited.has(currentNodeId)) {
      continue;
    }
    visited.add(currentNodeId);
    queue.push(...(adjacency.get(currentNodeId) ?? []));
  }
  return Array.from(visited)
    .filter((descendantNodeId) => nodeById.get(descendantNodeId)?.status === "passed")
    .sort();
}

function isGraphFeedbackSourceNode(node: GraphNodeRecord): boolean {
  return (node.status === "failed" || node.status === "blocked")
    && (GRAPH_FEEDBACK_SOURCE_NODE_KINDS as readonly string[]).includes(node.kind);
}

function findGraphFeedbackTargetNode(run: GraphRunRecord, nodeId: string): GraphNodeRecord | null {
  const sourceNode = run.nodes.find((node) => node.id === nodeId);
  if (!sourceNode || !run.worktree?.cwd) {
    return null;
  }

  const nodeById = new Map(run.nodes.map((node, index) => [node.id, { node, index }]));
  const explicitFeedbackTargets = run.edges
    .filter((edge) => edge.active
      && edge.from === nodeId
      && (GRAPH_FEEDBACK_EDGE_KINDS as readonly string[]).includes(edge.kind))
    .map((edge) => nodeById.get(edge.to))
    .filter((entry): entry is { node: GraphNodeRecord; index: number } => Boolean(entry?.node.baseCommit));
  if (explicitFeedbackTargets.length > 0) {
    return selectGraphReworkTarget(explicitFeedbackTargets.map((entry) => ({
      node: entry.node,
      index: entry.index,
      distance: 0,
    })));
  }

  const reverseAdjacency = buildGraphRunReverseStructuralAdjacency(run);
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; distance: number }> = (reverseAdjacency.get(nodeId) ?? [])
    .map((upstreamNodeId) => ({ nodeId: upstreamNodeId, distance: 1 }));
  const candidates: Array<{ node: GraphNodeRecord; index: number; distance: number }> = [];
  const fallbackCandidates: Array<{ node: GraphNodeRecord; index: number; distance: number }> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.nodeId)) {
      continue;
    }
    visited.add(current.nodeId);
    const entry = nodeById.get(current.nodeId);
    if (entry?.node.baseCommit) {
      const candidate = {
        node: entry.node,
        index: entry.index,
        distance: current.distance,
      };
      if (isGraphReworkTargetNode(entry.node)) {
        candidates.push(candidate);
      } else {
        fallbackCandidates.push(candidate);
      }
    }
    (reverseAdjacency.get(current.nodeId) ?? []).forEach((upstreamNodeId) => {
      if (!visited.has(upstreamNodeId)) {
        queue.push({ nodeId: upstreamNodeId, distance: current.distance + 1 });
      }
    });
  }

  return selectGraphReworkTarget(candidates.length > 0 ? candidates : fallbackCandidates);
}

function selectGraphReworkTarget(
  candidates: ReadonlyArray<{ node: GraphNodeRecord; index: number; distance: number }>,
): GraphNodeRecord | null {
  const [target] = [...candidates].sort((left, right) => {
    const distanceDelta = left.distance - right.distance;
    if (distanceDelta !== 0) {
      return distanceDelta;
    }
    const kindDelta = GRAPH_REWORK_TARGET_KIND_PRIORITY[left.node.kind] - GRAPH_REWORK_TARGET_KIND_PRIORITY[right.node.kind];
    if (kindDelta !== 0) {
      return kindDelta;
    }
    return left.index - right.index;
  });
  return target?.node ?? null;
}

function isGraphReworkTargetNode(node: GraphNodeRecord): boolean {
  return (GRAPH_REWORK_TARGET_NODE_KINDS as readonly string[]).includes(node.kind);
}

function findGraphDescendantNodeIds(run: GraphRunRecord, nodeId: string): string[] {
  const adjacency = buildGraphRunAdjacency(run);
  const visited = new Set<string>();
  const queue = [...(adjacency.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const currentNodeId = queue.shift() as string;
    if (currentNodeId === nodeId || visited.has(currentNodeId)) {
      continue;
    }
    visited.add(currentNodeId);
    queue.push(...(adjacency.get(currentNodeId) ?? []));
  }
  return Array.from(visited).sort();
}

function resetGraphNodeForRework(node: GraphNodeRecord): GraphNodeRecord {
  const nextMaxAttempts = node.attempts >= node.maxAttempts
    ? node.attempts + 1
    : node.maxAttempts;
  return {
    ...node,
    status: "pending",
    maxAttempts: nextMaxAttempts,
    startedAt: undefined,
    completedAt: undefined,
    lastError: undefined,
    artifactRef: undefined,
    worktreeCwd: undefined,
    baseCommit: undefined,
    commit: undefined,
    acceptance: resetGraphAcceptanceForRework(node),
  };
}

function resetGraphAcceptanceForRework(node: GraphNodeRecord): GraphNodeRecord["acceptance"] {
  if (!node.acceptance) {
    return undefined;
  }
  return node.acceptance.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    name: item.name,
    ...(item.required === false ? { required: false } : item.required === true ? { required: true } : {}),
    ...(item.detail ? { detail: item.detail } : {}),
  }));
}

function buildGraphRunReverseStructuralAdjacency(run: GraphRunRecord): Map<string, string[]> {
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string): void => {
    if (!from || !to || from === to) {
      return;
    }
    const next = adjacency.get(to) ?? new Set<string>();
    next.add(from);
    adjacency.set(to, next);
  };

  run.nodes.forEach((node) => {
    node.dependsOn.forEach((dependencyNodeId) => addEdge(dependencyNodeId, node.id));
    node.unlocks.forEach((unlockedNodeId) => addEdge(node.id, unlockedNodeId));
  });
  run.edges.forEach((edge) => {
    if (edge.active && edge.kind !== "conflicts_with" && edge.kind !== "review_feedback") {
      addEdge(edge.from, edge.to);
    }
  });

  return new Map(Array.from(adjacency.entries()).map(([from, to]) => [from, Array.from(to)]));
}

function buildGraphRunAdjacency(run: GraphRunRecord): Map<string, string[]> {
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string): void => {
    if (!from || !to || from === to) {
      return;
    }
    const next = adjacency.get(from) ?? new Set<string>();
    next.add(to);
    adjacency.set(from, next);
  };

  run.nodes.forEach((node) => {
    node.dependsOn.forEach((dependencyNodeId) => addEdge(dependencyNodeId, node.id));
    node.unlocks.forEach((unlockedNodeId) => addEdge(node.id, unlockedNodeId));
  });
  run.edges.forEach((edge) => {
    if (edge.active && edge.kind !== "conflicts_with") {
      addEdge(edge.from, edge.to);
    }
  });

  return new Map(Array.from(adjacency.entries()).map(([from, to]) => [from, Array.from(to)]));
}

function isGraphRunResumableStatus(status: GraphRunStatus): boolean {
  return (GRAPH_RUN_RESUMABLE_STATUSES as readonly string[]).includes(status);
}

function isGraphRunTerminalStatus(status: GraphRunStatus): boolean {
  return (GRAPH_RUN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

function resolveGraphRunControlTimestamp(options: GraphRunControlOptions): number {
  return options.now?.() ?? Date.now();
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? (error.message || String(error)) : String(error);
}

function unchangedControlResult(
  run: GraphRunRecord,
  ok: boolean,
  reason: GraphRunControlBlockedReason,
  message: string,
  nodeId?: string,
): GraphRunControlResult {
  return {
    run,
    ok,
    changed: false,
    message,
    reason,
    ...(nodeId ? { nodeId } : {}),
  };
}

async function appendGraphRunControlEvent(
  run: GraphRunRecord,
  event: GraphEventAppendInput,
  options: GraphRunControlOptions,
): Promise<GraphEventRecord> {
  if (options.appendEvent) {
    return options.appendEvent(run, event);
  }
  return appendGraphEvent(run.eventsFile, event);
}
