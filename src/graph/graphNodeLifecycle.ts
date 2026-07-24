import {
  appendGraphEvent,
  type GraphEventAppendInput,
} from "./graphEvents";
import {
  type GraphAcceptanceCheck,
  type GraphEventRecord,
  type GraphFinalAnswer,
  type GraphNodeRecord,
  type GraphPlannedGraphSpec,
  type GraphRunRecord,
} from "./types";

export type GraphNodeExecutionResultStatus = "passed" | "failed" | "blocked" | "sleeping";

export type GraphNodeExecutionResult = {
  status: GraphNodeExecutionResultStatus;
  summary?: string;
  error?: string;
  artifactRef?: string;
  acceptance?: GraphAcceptanceCheck[];
  finalAnswer?: GraphFinalAnswer;
  plannedGraph?: GraphPlannedGraphSpec;
  wakeAt?: number;
  worktreeCwd?: string;
  baseCommit?: string;
  commit?: string;
};

export type GraphNodeLifecycleDeps = {
  now?: () => number;
  appendEvent?: (
    run: GraphRunRecord,
    event: GraphEventAppendInput,
  ) => GraphEventRecord | Promise<GraphEventRecord>;
};

export async function markGraphNodeStarted(
  run: GraphRunRecord,
  nodeId: string,
  deps: GraphNodeLifecycleDeps = {},
): Promise<GraphRunRecord> {
  const timestamp = resolveGraphLifecycleTimestamp(deps);
  const { run: nextRun, node } = updateGraphRunNode(run, nodeId, (current) => ({
    ...current,
    status: "running",
    attempts: current.attempts + 1,
    startedAt: timestamp,
    completedAt: undefined,
    lastError: undefined,
  }), {
    status: "running",
    updatedAt: timestamp,
    activeNodeIds: addGraphActiveNodeId(run.activeNodeIds, nodeId),
  });
  await appendGraphLifecycleEvent(nextRun, {
    runId: nextRun.id,
    type: "node.started",
    timestamp,
    nodeId,
    attempt: node.attempts,
    summary: `Graph node ${nodeId} started attempt ${node.attempts}.`,
  }, deps);
  return nextRun;
}

export async function markGraphNodeCompleted(
  run: GraphRunRecord,
  nodeId: string,
  result: Omit<GraphNodeExecutionResult, "status"> = {},
  deps: GraphNodeLifecycleDeps = {},
): Promise<GraphRunRecord> {
  const timestamp = resolveGraphLifecycleTimestamp(deps);
  const { run: nodeRun, node } = updateGraphRunNode(run, nodeId, (current) => ({
    ...current,
    status: "passed",
    ...(result.artifactRef ? { artifactRef: result.artifactRef } : {}),
    ...(result.acceptance ? { acceptance: result.acceptance } : {}),
    ...buildGraphNodeCheckpointPatch(result),
    completedAt: timestamp,
    lastError: undefined,
  }), {
    updatedAt: timestamp,
    activeNodeIds: removeGraphActiveNodeId(run.activeNodeIds, nodeId),
  });
  const completedRun = result.finalAnswer && node.kind === "summary"
    ? {
      ...nodeRun,
      status: "completed" as const,
      finalAnswer: {
        ...result.finalAnswer,
        completedAt: result.finalAnswer.completedAt ?? timestamp,
      },
      updatedAt: timestamp,
    }
    : nodeRun;

  await appendGraphLifecycleEvent(completedRun, {
    runId: completedRun.id,
    type: "node.completed",
    timestamp,
    nodeId,
    attempt: node.attempts,
    summary: result.summary ?? `Graph node ${nodeId} completed.`,
    data: {
      artifactRef: result.artifactRef,
      acceptance: result.acceptance,
      worktreeCwd: result.worktreeCwd,
      baseCommit: result.baseCommit,
      commit: result.commit,
    },
  }, deps);

  if (result.finalAnswer && node.kind === "summary") {
    await appendGraphLifecycleEvent(completedRun, {
      runId: completedRun.id,
      type: "run.completed",
      timestamp,
      summary: result.finalAnswer.conclusion,
      data: result.finalAnswer,
    }, deps);
  }

  return completedRun;
}

export async function markGraphNodeFailed(
  run: GraphRunRecord,
  nodeId: string,
  error: string,
  deps: GraphNodeLifecycleDeps = {},
  result: Partial<GraphNodeExecutionResult> = {},
): Promise<GraphRunRecord> {
  const timestamp = resolveGraphLifecycleTimestamp(deps);
  const existingNode = getGraphRunNodeOrThrow(run, nodeId);
  const attemptsExhausted = existingNode.attempts >= existingNode.maxAttempts;
  const nextStatus = attemptsExhausted ? "blocked" : "failed";
  const { run: nextRun, node } = updateGraphRunNode(run, nodeId, (current) => ({
    ...current,
    status: nextStatus,
    ...buildGraphNodeCheckpointPatch(result),
    completedAt: timestamp,
    lastError: error,
  }), {
    status: attemptsExhausted ? "needs-review" : "running",
    updatedAt: timestamp,
    activeNodeIds: removeGraphActiveNodeId(run.activeNodeIds, nodeId),
  });

  await appendGraphLifecycleEvent(nextRun, {
    runId: nextRun.id,
    type: "node.failed",
    timestamp,
    nodeId,
    attempt: node.attempts,
    summary: error,
    error,
    data: {
      attempts: node.attempts,
      maxAttempts: node.maxAttempts,
      attemptsExhausted,
      worktreeCwd: result.worktreeCwd,
      baseCommit: result.baseCommit,
      commit: result.commit,
    },
  }, deps);

  if (attemptsExhausted) {
    await appendGraphLifecycleEvent(nextRun, {
      runId: nextRun.id,
      type: "node.blocked",
      timestamp,
      nodeId,
      attempt: node.attempts,
      summary: `Graph node ${nodeId} exhausted maxAttempts (${node.maxAttempts}).`,
      error,
    }, deps);
  }

  return nextRun;
}

export async function markGraphNodeBlocked(
  run: GraphRunRecord,
  nodeId: string,
  reason: string,
  deps: GraphNodeLifecycleDeps = {},
  result: Partial<GraphNodeExecutionResult> = {},
): Promise<GraphRunRecord> {
  const timestamp = resolveGraphLifecycleTimestamp(deps);
  const { run: nextRun, node } = updateGraphRunNode(run, nodeId, (current) => ({
    ...current,
    status: "blocked",
    ...buildGraphNodeCheckpointPatch(result),
    completedAt: timestamp,
    lastError: reason,
  }), {
    status: "needs-review",
    updatedAt: timestamp,
    activeNodeIds: removeGraphActiveNodeId(run.activeNodeIds, nodeId),
  });

  await appendGraphLifecycleEvent(nextRun, {
    runId: nextRun.id,
    type: "node.blocked",
    timestamp,
    nodeId,
    attempt: node.attempts,
    summary: reason,
    error: reason,
    data: {
      worktreeCwd: result.worktreeCwd,
      baseCommit: result.baseCommit,
      commit: result.commit,
    },
  }, deps);

  return nextRun;
}

export async function markGraphNodeSleeping(
  run: GraphRunRecord,
  nodeId: string,
  wakeAt: number | undefined,
  reason: string,
  deps: GraphNodeLifecycleDeps = {},
): Promise<GraphRunRecord> {
  const timestamp = resolveGraphLifecycleTimestamp(deps);
  const { run: nextRun, node } = updateGraphRunNode(run, nodeId, (current) => ({
    ...current,
    status: "sleeping",
    wakeAt,
    completedAt: undefined,
    lastError: reason,
  }), {
    status: "sleeping",
    updatedAt: timestamp,
    activeNodeIds: removeGraphActiveNodeId(run.activeNodeIds, nodeId),
  });

  await appendGraphLifecycleEvent(nextRun, {
    runId: nextRun.id,
    type: "node.sleeping",
    timestamp,
    nodeId,
    attempt: node.attempts,
    summary: reason,
    data: { wakeAt },
  }, deps);

  return nextRun;
}

export async function markGraphHumanGateWaiting(
  run: GraphRunRecord,
  nodeId: string,
  deps: GraphNodeLifecycleDeps = {},
): Promise<GraphRunRecord> {
  const timestamp = resolveGraphLifecycleTimestamp(deps);
  const currentNode = getGraphRunNodeOrThrow(run, nodeId);
  if (currentNode.kind !== "human_gate") {
    throw new Error(`Graph node ${nodeId} is not a human_gate node.`);
  }
  const shouldAppendWaitingEvent = currentNode.status !== "ready";
  const { run: nextRun, node } = updateGraphRunNode(run, nodeId, (current) => ({
    ...current,
    status: "ready",
    startedAt: current.startedAt ?? timestamp,
  }), {
    status: "needs-review",
    updatedAt: timestamp,
    activeNodeIds: removeGraphActiveNodeId(run.activeNodeIds, nodeId),
  });

  if (shouldAppendWaitingEvent) {
    await appendGraphLifecycleEvent(nextRun, {
      runId: nextRun.id,
      type: "human_gate.waiting",
      timestamp,
      nodeId,
      attempt: node.attempts,
      summary: `Graph human gate ${nodeId} is waiting for approval.`,
    }, deps);
  }

  return nextRun;
}

export async function approveGraphHumanGateNode(
  run: GraphRunRecord,
  nodeId: string,
  summary = "Human gate approved.",
  deps: GraphNodeLifecycleDeps = {},
): Promise<GraphRunRecord> {
  const timestamp = resolveGraphLifecycleTimestamp(deps);
  const currentNode = getGraphRunNodeOrThrow(run, nodeId);
  if (currentNode.kind !== "human_gate") {
    throw new Error(`Graph node ${nodeId} is not a human_gate node.`);
  }
  const { run: nextRun, node } = updateGraphRunNode(run, nodeId, (current) => ({
    ...current,
    status: "passed",
    completedAt: timestamp,
    lastError: undefined,
  }), {
    status: "running",
    updatedAt: timestamp,
    activeNodeIds: removeGraphActiveNodeId(run.activeNodeIds, nodeId),
  });

  await appendGraphLifecycleEvent(nextRun, {
    runId: nextRun.id,
    type: "human_gate.approved",
    timestamp,
    nodeId,
    attempt: node.attempts,
    summary,
  }, deps);

  return nextRun;
}

export async function completeGraphSleepNodeDue(
  run: GraphRunRecord,
  nodeId: string,
  deps: GraphNodeLifecycleDeps = {},
): Promise<GraphRunRecord> {
  const timestamp = resolveGraphLifecycleTimestamp(deps);
  const currentNode = getGraphRunNodeOrThrow(run, nodeId);
  if (currentNode.kind !== "sleep") {
    throw new Error(`Graph node ${nodeId} is not a sleep node.`);
  }
  if (typeof currentNode.wakeAt === "number" && Number.isFinite(currentNode.wakeAt) && currentNode.wakeAt > timestamp) {
    throw new Error(`Graph sleep node ${nodeId} is not due until ${currentNode.wakeAt}.`);
  }
  const { run: nextRun, node } = updateGraphRunNode(run, nodeId, (current) => ({
    ...current,
    status: "passed",
    completedAt: timestamp,
    lastError: undefined,
  }), {
    status: "running",
    updatedAt: timestamp,
    activeNodeIds: removeGraphActiveNodeId(run.activeNodeIds, nodeId),
  });

  await appendGraphLifecycleEvent(nextRun, {
    runId: nextRun.id,
    type: "node.completed",
    timestamp,
    nodeId,
    attempt: node.attempts,
    summary: `Graph sleep node ${nodeId} reached wakeAt and was completed by the system.`,
    data: { wakeAt: node.wakeAt },
  }, deps);

  return nextRun;
}

export async function finalizeGraphNodeResult(
  run: GraphRunRecord,
  nodeId: string,
  result: GraphNodeExecutionResult,
  deps: GraphNodeLifecycleDeps = {},
): Promise<GraphRunRecord> {
  if (result.status === "passed") {
    return markGraphNodeCompleted(run, nodeId, result, deps);
  }
  if (result.status === "failed") {
    return markGraphNodeFailed(run, nodeId, result.error ?? result.summary ?? "Graph node failed.", deps, result);
  }
  if (result.status === "blocked") {
    return markGraphNodeBlocked(run, nodeId, result.error ?? result.summary ?? "Graph node blocked.", deps, result);
  }
  return markGraphNodeSleeping(
    run,
    nodeId,
    result.wakeAt,
    result.summary ?? result.error ?? "Graph node is sleeping.",
    deps,
  );
}

function buildGraphNodeCheckpointPatch(result: Partial<GraphNodeExecutionResult>): Partial<GraphNodeRecord> {
  return {
    ...(typeof result.worktreeCwd === "string" && result.worktreeCwd.trim() ? { worktreeCwd: result.worktreeCwd.trim() } : {}),
    ...(typeof result.baseCommit === "string" && result.baseCommit.trim() ? { baseCommit: result.baseCommit.trim() } : {}),
    ...(typeof result.commit === "string" && result.commit.trim() ? { commit: result.commit.trim() } : {}),
  };
}

function updateGraphRunNode(
  run: GraphRunRecord,
  nodeId: string,
  updateNode: (node: GraphNodeRecord) => GraphNodeRecord,
  runPatch: Partial<GraphRunRecord>,
): { run: GraphRunRecord; node: GraphNodeRecord } {
  let updatedNode: GraphNodeRecord | null = null;
  const nodes = run.nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }
    updatedNode = updateNode(node);
    return updatedNode;
  });
  if (!updatedNode) {
    throw new Error(`Graph node ${nodeId} does not exist in run ${run.id}.`);
  }
  return {
    run: {
      ...run,
      ...runPatch,
      nodes,
    },
    node: updatedNode,
  };
}

function getGraphRunNodeOrThrow(run: GraphRunRecord, nodeId: string): GraphNodeRecord {
  const node = run.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new Error(`Graph node ${nodeId} does not exist in run ${run.id}.`);
  }
  return node;
}

function addGraphActiveNodeId(activeNodeIds: readonly string[], nodeId: string): string[] {
  return Array.from(new Set([...activeNodeIds, nodeId]));
}

function removeGraphActiveNodeId(activeNodeIds: readonly string[], nodeId: string): string[] {
  return activeNodeIds.filter((activeNodeId) => activeNodeId !== nodeId);
}

function resolveGraphLifecycleTimestamp(deps: GraphNodeLifecycleDeps): number {
  return deps.now?.() ?? Date.now();
}

async function appendGraphLifecycleEvent(
  run: GraphRunRecord,
  event: GraphEventAppendInput,
  deps: GraphNodeLifecycleDeps,
): Promise<GraphEventRecord> {
  if (deps.appendEvent) {
    return deps.appendEvent(run, event);
  }
  return appendGraphEvent(run.eventsFile, event);
}
