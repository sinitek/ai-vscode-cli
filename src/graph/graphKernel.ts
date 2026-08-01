import {
  buildGraphNodePrompt,
  type BuildGraphNodePromptInput,
} from "./graphPromptBuilders";
import {
  completeGraphSleepNodeDue,
  finalizeGraphNodeResult,
  markGraphNodeSleeping,
  markGraphNodeStarted,
  type GraphNodeExecutionResult,
  type GraphNodeLifecycleDeps,
} from "./graphNodeLifecycle";
import {
  selectGraphRunnableBatch,
  type GraphBlockedNode,
  type GraphExecutionBatch,
} from "./graphScheduler";
import type { GraphModelRole, GraphNodeRecord, GraphRunRecord } from "./types";

export type GraphNodeExecutionRequest = {
  run: GraphRunRecord;
  node: GraphNodeRecord;
  prompt: string;
  attempt: number;
  modelRole?: GraphModelRole;
  model?: string;
  modelFallback?: string;
};

export type GraphNodeExecutor = {
  execute: (request: GraphNodeExecutionRequest) => Promise<GraphNodeExecutionResult>;
};

export type GraphKernelPendingAction = never;

export type GraphKernelSystemAction =
  | {
    type: "sleep_due_completed";
    nodeId: string;
    title: string;
    wakeAt?: number;
  }
  | {
    type: "sleep_waiting";
    nodeId: string;
    title: string;
    wakeAt?: number;
  };

export type GraphKernelTickOptions = {
  maxConcurrent?: number;
};

export type GraphKernelDeps = GraphNodeLifecycleDeps & {
  executor: GraphNodeExecutor;
  persistRun?: (run: GraphRunRecord) => GraphRunRecord | Promise<GraphRunRecord>;
  buildPrompt?: (input: BuildGraphNodePromptInput) => string;
};

export type GraphKernelTickResult = {
  run: GraphRunRecord;
  batch: GraphExecutionBatch;
  startedNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  blockedNodeIds: string[];
  sleepingNodeIds: string[];
  pendingActions: GraphKernelPendingAction[];
  systemActions: GraphKernelSystemAction[];
};

export async function tickGraphRun(
  run: GraphRunRecord,
  deps: GraphKernelDeps,
  options: GraphKernelTickOptions = {},
): Promise<GraphKernelTickResult> {
  const now = deps.now?.() ?? Date.now();
  const lifecycleDeps: GraphNodeLifecycleDeps = {
    now: () => now,
    appendEvent: deps.appendEvent,
  };
  const batch = selectGraphRunnableBatch(run, {
    now,
    maxConcurrent: options.maxConcurrent,
  });

  let currentRun = run;
  const pendingActions: GraphKernelPendingAction[] = [];
  const systemActions: GraphKernelSystemAction[] = [];
  const startedNodeIds: string[] = [];
  const completedNodeIds: string[] = [];
  const failedNodeIds: string[] = [];
  const blockedNodeIds: string[] = [];
  const sleepingNodeIds: string[] = [];

  for (const waitingSleep of getGraphKernelSleepWaitingNodes(batch)) {
    const beforeSleepNode = getGraphKernelNode(currentRun, waitingSleep.nodeId);
    currentRun = await commitGraphKernelRun(
      await markGraphNodeSleeping(
        currentRun,
        waitingSleep.nodeId,
        beforeSleepNode.wakeAt,
        `Graph sleep node ${waitingSleep.nodeId} is waiting for wakeAt.`,
        lifecycleDeps,
      ),
      deps,
    );
    const node = getGraphKernelNode(currentRun, waitingSleep.nodeId);
    sleepingNodeIds.push(node.id);
    systemActions.push({
      type: "sleep_waiting",
      nodeId: node.id,
      title: node.title,
      ...(typeof node.wakeAt === "number" ? { wakeAt: node.wakeAt } : {}),
    });
  }

  for (const readySleep of batch.sleepReadyNodes) {
    currentRun = await commitGraphKernelRun(
      await completeGraphSleepNodeDue(currentRun, readySleep.nodeId, lifecycleDeps),
      deps,
    );
    const node = getGraphKernelNode(currentRun, readySleep.nodeId);
    systemActions.push({
      type: "sleep_due_completed",
      nodeId: node.id,
      title: node.title,
      ...(typeof node.wakeAt === "number" ? { wakeAt: node.wakeAt } : {}),
    });
  }

  for (const node of batch.selectedNodes) {
    currentRun = await commitGraphKernelRun(
      await markGraphNodeStarted(currentRun, node.id, lifecycleDeps),
      deps,
    );
    startedNodeIds.push(node.id);
  }

  const executionRun = currentRun;
  const executionResults = await Promise.all(batch.selectedNodes.map(async (selectedNode) => {
    const node = getGraphKernelNode(executionRun, selectedNode.id);
    const prompt = (deps.buildPrompt ?? buildGraphNodePrompt)({
      run: executionRun,
      node,
    });
    try {
      const result = await deps.executor.execute({
        run: executionRun,
        node,
        prompt,
        attempt: node.attempts,
        ...(node.modelRole ? { modelRole: node.modelRole } : {}),
        ...(node.model ? { model: node.model } : {}),
        ...(node.modelFallback ? { modelFallback: node.modelFallback } : {}),
      });
      return { nodeId: node.id, result };
    } catch (error) {
      return {
        nodeId: node.id,
        result: {
          status: "failed" as const,
          error: errorToGraphKernelMessage(error),
          summary: errorToGraphKernelMessage(error),
        },
      };
    }
  }));

  for (const execution of executionResults) {
    currentRun = await commitGraphKernelRun(
      await finalizeGraphNodeResult(currentRun, execution.nodeId, execution.result, lifecycleDeps),
      deps,
    );
    if (execution.result.status === "passed") {
      completedNodeIds.push(execution.nodeId);
    } else if (execution.result.status === "failed" || execution.result.status === "blocked") {
      const node = getGraphKernelNode(currentRun, execution.nodeId);
      if (node.status === "blocked") {
        blockedNodeIds.push(execution.nodeId);
      } else {
        failedNodeIds.push(execution.nodeId);
      }
    } else {
      sleepingNodeIds.push(execution.nodeId);
    }
  }

  return {
    run: currentRun,
    batch,
    startedNodeIds,
    completedNodeIds,
    failedNodeIds,
    blockedNodeIds,
    sleepingNodeIds,
    pendingActions,
    systemActions,
  };
}

export const runGraphSchedulerTick = tickGraphRun;

function getGraphKernelSleepWaitingNodes(batch: GraphExecutionBatch): GraphBlockedNode[] {
  return batch.deferredNodes.filter((blockedNode) => blockedNode.node.kind === "sleep"
    && blockedNode.node.status !== "sleeping"
    && blockedNode.blockers.some((blocker) => blocker.reason === "sleep_not_due"));
}

async function commitGraphKernelRun(
  run: GraphRunRecord,
  deps: GraphKernelDeps,
): Promise<GraphRunRecord> {
  if (!deps.persistRun) {
    return run;
  }
  return deps.persistRun(run);
}

function getGraphKernelNode(run: GraphRunRecord, nodeId: string): GraphNodeRecord {
  const node = run.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new Error(`Graph node ${nodeId} does not exist in run ${run.id}.`);
  }
  return node;
}

function errorToGraphKernelMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "Graph node executor failed.";
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
