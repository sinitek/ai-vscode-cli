import type {
  GraphEdgeKind,
  GraphEdgeRecord,
} from "./types";

const GRAPH_BLOCKING_EDGE_KINDS: readonly GraphEdgeKind[] = [
  "if_pass",
  "if_fail",
  "human_approved",
];

type GraphEdgeSemanticsInput = Pick<
  GraphEdgeRecord,
  "active" | "conditionExpression" | "kind" | "metadata"
>;

export function isGraphBlockingEdgeKind(kind: GraphEdgeKind): boolean {
  return (GRAPH_BLOCKING_EDGE_KINDS as readonly string[]).includes(kind);
}

export function isGraphReworkTriggerEdge(edge: Pick<GraphEdgeRecord, "kind" | "metadata">): boolean {
  if (edge.kind === "review_feedback") {
    return true;
  }
  if (edge.kind !== "if_fail") {
    return false;
  }
  return Boolean(
    edge.metadata?.reworkTargetNodeId
    || edge.metadata?.feedbackReason
    || (edge.metadata?.reworkScopeNodeIds && edge.metadata.reworkScopeNodeIds.length > 0),
  );
}

export function isGraphActiveStructuralOrBlockingEdge(edge: GraphEdgeSemanticsInput): boolean {
  if (!edge.active) {
    return false;
  }
  if (edge.kind === "depends_on") {
    return true;
  }
  if (isGraphReworkTriggerEdge(edge)) {
    return false;
  }
  return isGraphBlockingEdgeKind(edge.kind) || Boolean(edge.conditionExpression);
}
