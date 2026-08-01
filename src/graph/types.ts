import * as os from "os";
import * as path from "path";

import type { CliName } from "../cli/types";
import {
  PATH_SEGMENT_REPLACEMENT_PATTERN,
  sanitizePathSegment,
} from "../shared/pathSegments";

export const GRAPH_SCHEMA_VERSION = 1;
export type GraphSchemaVersion = typeof GRAPH_SCHEMA_VERSION;

export const GRAPH_DEFAULT_MAX_CONCURRENT_NODES = 6;
export const GRAPH_DATA_DIR_NAME = ".sinitek_cli";
export const GRAPH_PATH_SEGMENT_REPLACEMENT_PATTERN = PATH_SEGMENT_REPLACEMENT_PATTERN;
export const GRAPH_WORKSPACE_KEY_FALLBACK = "no-workspace";
export const GRAPH_PENDING_SESSION_SEGMENT = "__pending__";

export const GRAPH_RUN_STATUSES = [
  "draft",
  "running",
  "sleeping",
  "needs-review",
  "completed",
  "error",
  "stopped",
] as const;
export type GraphRunStatus = (typeof GRAPH_RUN_STATUSES)[number];

export const GRAPH_RUN_EXECUTION_MODES = [
  "worktree",
  "direct",
] as const;
export type GraphRunExecutionMode = (typeof GRAPH_RUN_EXECUTION_MODES)[number];

export const GRAPH_NODE_KINDS = [
  "intake",
  "plan",
  "implement",
  "test",
  "review",
  "debate",
  "human_gate",
  "merge",
  "sleep",
  "summary",
] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const GRAPH_NODE_STATUSES = [
  "pending",
  "ready",
  "running",
  "sleeping",
  "passed",
  "failed",
  "blocked",
  "skipped",
  "stopped",
] as const;
export type GraphNodeStatus = (typeof GRAPH_NODE_STATUSES)[number];

export const GRAPH_EDGE_KINDS = [
  "depends_on",
  "if_pass",
  "if_fail",
  "review_feedback",
  "conflicts_with",
  "evidence_for",
  "human_approved",
] as const;
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

export const GRAPH_EDGE_CONDITION_TYPES = [
  "source_status",
  "source_acceptance",
  "manual",
  "custom",
] as const;
export type GraphEdgeConditionType = (typeof GRAPH_EDGE_CONDITION_TYPES)[number];

export const GRAPH_EDGE_CONDITION_OPERATORS = [
  "equals",
  "one_of",
  "all_required_passed",
  "any_required_failed",
  "has_evidence",
] as const;
export type GraphEdgeConditionOperator = (typeof GRAPH_EDGE_CONDITION_OPERATORS)[number];

export const GRAPH_OWNER_ROLES = [
  "main",
  "subtask",
  "reviewer",
  "moderator",
  "human",
  "system",
] as const;
export type GraphOwnerRole = (typeof GRAPH_OWNER_ROLES)[number];

export const GRAPH_MODEL_ROLES = [
  "main",
  "subtask",
] as const;
export type GraphModelRole = (typeof GRAPH_MODEL_ROLES)[number];

export const GRAPH_EVENT_TYPES = [
  "run.created",
  "run.updated",
  "node.started",
  "node.completed",
  "node.failed",
  "node.blocked",
  "node.skipped",
  "node.sleeping",
  "human_gate.waiting",
  "human_gate.approved",
  "run.resumed",
  "node.retry_requested",
  "node.feedback_requested",
  "node.stopped",
  "run.completed",
  "run.error",
  "run.stopped",
] as const;
export type GraphEventType = (typeof GRAPH_EVENT_TYPES)[number];

export type GraphAcceptanceCheck = {
  id?: string;
  name: string;
  passed?: boolean;
  required?: boolean;
  detail?: string;
  evidenceRef?: string;
};

export type GraphFinalAnswer = {
  conclusion: string;
  summary: string;
  evidence: string[];
  unresolved: string[];
  completedAt?: number;
};

export type GraphEdgeConditionExpression = {
  type: GraphEdgeConditionType;
  operator?: GraphEdgeConditionOperator;
  status?: GraphNodeStatus;
  statuses?: GraphNodeStatus[];
  acceptanceId?: string;
  expected?: boolean | string | number;
  description?: string;
};

export type GraphEdgeMetadata = {
  label?: string;
  rationale?: string;
  evidenceRef?: string;
  feedbackReason?: string;
  reworkTargetNodeId?: string;
  reworkScopeNodeIds?: string[];
};

export type GraphNodeReworkRecord = {
  sourceNodeId: string;
  targetNodeId: string;
  resetAt: number;
  resetScopeNodeIds: string[];
  reason?: string;
  edgeId?: string;
  edgeKind?: GraphEdgeKind;
};

export type GraphPlannedNodeSpec = {
  id: string;
  title: string;
  kind: GraphNodeKind;
  ownerRole?: GraphOwnerRole;
  promptRef?: string;
  writeFiles?: string[];
  conflictGroup?: string;
  maxAttempts?: number;
  dependsOn?: string[];
  acceptance?: GraphAcceptanceCheck[];
  wakeAt?: number;
};

export type GraphPlannedEdgeSpec = {
  id?: string;
  from: string;
  to: string;
  kind?: GraphEdgeKind;
  label?: string;
  condition?: string;
  conditionExpression?: GraphEdgeConditionExpression;
  metadata?: GraphEdgeMetadata;
  active?: boolean;
};

export type GraphPlannedGraphSpec = {
  maxConcurrent?: number;
  nodes: GraphPlannedNodeSpec[];
  edges?: GraphPlannedEdgeSpec[];
};

export type GraphRunWorktreeRecord = {
  cwd: string;
  branch: string;
  baseCommit: string;
  createdAt?: number;
};

export type GraphRunDirectExecutionRecord = {
  cwd: string;
  reason?: string;
  createdAt?: number;
};

export type GraphModelRouteRecord = {
  role: GraphModelRole;
  model?: string;
  fallback?: string;
};

export type GraphRunModelRoutingRecord = {
  planner: GraphModelRouteRecord;
  executor: GraphModelRouteRecord;
};

export type GraphNodeRecord = {
  id: string;
  title: string;
  kind: GraphNodeKind;
  status: GraphNodeStatus;
  ownerRole: GraphOwnerRole;
  modelRole?: GraphModelRole;
  model?: string;
  modelFallback?: string;
  promptRef?: string;
  artifactRef?: string;
  communicationFile?: string;
  writeFiles?: string[];
  conflictGroup?: string;
  maxAttempts: number;
  attempts: number;
  dependsOn: string[];
  unlocks: string[];
  acceptance?: GraphAcceptanceCheck[];
  startedAt?: number;
  completedAt?: number;
  wakeAt?: number;
  lastError?: string;
  rework?: GraphNodeReworkRecord;
  executionCwd?: string;
  worktreeCwd?: string;
  baseCommit?: string;
  commit?: string;
};

export type GraphEdgeRecord = {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  label?: string;
  condition?: string;
  conditionExpression?: GraphEdgeConditionExpression;
  metadata?: GraphEdgeMetadata;
  active: boolean;
};

export type GraphRunRecord = {
  id: string;
  workspaceKey: string;
  cli: CliName;
  sessionId: string | null;
  rootPrompt: string;
  supplementalRequirements?: string[];
  status: GraphRunStatus;
  createdAt: number;
  updatedAt: number;
  templateId?: string;
  templateVersion?: string;
  graphVersion: GraphSchemaVersion;
  runStoreFile: string;
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  activeNodeIds: string[];
  maxConcurrent: number;
  eventsFile: string;
  communicationDir: string;
  mainCommunicationFile: string;
  graphFile: string;
  executionMode?: GraphRunExecutionMode;
  directExecution?: GraphRunDirectExecutionRecord;
  worktree?: GraphRunWorktreeRecord;
  modelRouting?: GraphRunModelRoutingRecord;
  finalAnswer?: GraphFinalAnswer;
};

export type GraphRunStore = {
  runs: GraphRunRecord[];
};

export type GraphEventRecord = {
  eventId: string;
  runId: string;
  type: GraphEventType;
  timestamp: number;
  nodeId?: string;
  attempt?: number;
  summary?: string;
  error?: string;
  data?: unknown;
};

export function getGraphDataDir(baseDir?: string): string {
  return baseDir ?? path.join(os.homedir(), GRAPH_DATA_DIR_NAME);
}

export function sanitizeGraphPathSegment(value: unknown, fallback: string): string {
  return sanitizePathSegment(value, fallback);
}

export function isGraphRunStatus(value: unknown): value is GraphRunStatus {
  return isGraphValue(GRAPH_RUN_STATUSES, value);
}

export function isGraphRunExecutionMode(value: unknown): value is GraphRunExecutionMode {
  return isGraphValue(GRAPH_RUN_EXECUTION_MODES, value);
}

export function isGraphNodeKind(value: unknown): value is GraphNodeKind {
  return isGraphValue(GRAPH_NODE_KINDS, value);
}

export function isGraphNodeStatus(value: unknown): value is GraphNodeStatus {
  return isGraphValue(GRAPH_NODE_STATUSES, value);
}

export function isGraphEdgeKind(value: unknown): value is GraphEdgeKind {
  return isGraphValue(GRAPH_EDGE_KINDS, value);
}

export function isGraphEdgeConditionType(value: unknown): value is GraphEdgeConditionType {
  return isGraphValue(GRAPH_EDGE_CONDITION_TYPES, value);
}

export function isGraphEdgeConditionOperator(value: unknown): value is GraphEdgeConditionOperator {
  return isGraphValue(GRAPH_EDGE_CONDITION_OPERATORS, value);
}

export function isGraphOwnerRole(value: unknown): value is GraphOwnerRole {
  return isGraphValue(GRAPH_OWNER_ROLES, value);
}

export function isGraphModelRole(value: unknown): value is GraphModelRole {
  return isGraphValue(GRAPH_MODEL_ROLES, value);
}

export function isGraphEventType(value: unknown): value is GraphEventType {
  return isGraphValue(GRAPH_EVENT_TYPES, value);
}

function isGraphValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}
