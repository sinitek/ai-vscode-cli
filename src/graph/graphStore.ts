import * as fs from "fs";
import * as path from "path";

import { CLI_LIST, type CliName } from "../cli/types";
import {
  GRAPH_DEFAULT_MAX_CONCURRENT_NODES,
  GRAPH_PENDING_SESSION_SEGMENT,
  GRAPH_SCHEMA_VERSION,
  GRAPH_WORKSPACE_KEY_FALLBACK,
  getGraphDataDir,
  isGraphEdgeConditionOperator,
  isGraphEdgeConditionType,
  isGraphEdgeKind,
  isGraphNodeKind,
  isGraphNodeStatus,
  isGraphOwnerRole,
  isGraphRunStatus,
  sanitizeGraphPathSegment,
  type GraphAcceptanceCheck,
  type GraphEdgeConditionExpression,
  type GraphEdgeMetadata,
  type GraphEdgeRecord,
  type GraphFinalAnswer,
  type GraphNodeRecord,
  type GraphNodeReworkRecord,
  type GraphNodeStatus,
  type GraphRunRecord,
  type GraphRunStatus,
  type GraphRunStore,
  type GraphRunWorktreeRecord,
} from "./types";
import {
  ensureGraphCommunicationFiles,
  getGraphCommunicationPaths,
} from "./graphCommunications";

export const GRAPH_RUN_STORE_DIR_NAME = "graph-runs";
export const GRAPH_RUN_STORE_FILENAME = "graph-runs.json";

export type GraphRunStorePathOptions = {
  baseDir?: string;
};

export type GraphRunStoreOptions = GraphRunStorePathOptions & {
  now?: () => number;
  storeFile?: string;
};

export type GraphRunDiscoveryOptions = GraphRunStorePathOptions & {
  storeFile?: string;
  workspaceKey?: string;
  cli?: CliName;
  status?: GraphRunStatus;
  statuses?: readonly GraphRunStatus[];
  limit?: number;
};

export type GraphRunStoreDiscoveryError = {
  storeFile: string;
  error: string;
};

export type GraphRunDiscoveryDiagnostics = {
  scannedStoreFiles: number;
  readableStoreFiles: number;
  unreadableStoreFiles: number;
  matchedRuns: number;
  returnedRuns: number;
};

export type GraphRunDiscoveryResult = {
  runs: GraphRunRecord[];
  errors: GraphRunStoreDiscoveryError[];
  diagnostics: GraphRunDiscoveryDiagnostics;
};

export type GraphRunLookupResult = {
  run: GraphRunRecord | null;
  errors: GraphRunStoreDiscoveryError[];
  diagnostics: GraphRunDiscoveryDiagnostics;
};

export type CreateGraphRunRecordInput = {
  id: string;
  workspaceKey: string;
  cli: CliName;
  sessionId?: string | null;
  rootPrompt: string;
  supplementalRequirements?: string[];
  status?: GraphRunStatus;
  createdAt?: number;
  updatedAt?: number;
  templateId?: string;
  templateVersion?: string;
  nodes?: GraphNodeRecord[];
  edges?: GraphEdgeRecord[];
  activeNodeIds?: string[];
  maxConcurrent?: number;
  worktree?: GraphRunWorktreeRecord;
  finalAnswer?: GraphFinalAnswer;
};

export function getGraphRunStoreRoot(options: GraphRunStorePathOptions = {}): string {
  return path.join(getGraphDataDir(options.baseDir), GRAPH_RUN_STORE_DIR_NAME);
}

export function buildGraphRunStoreFile(
  cli: CliName,
  workspaceKey: string,
  sessionId: string | null | undefined,
  graphRunId: string,
  options: GraphRunStorePathOptions = {},
): string {
  const workspaceSegment = sanitizeGraphPathSegment(workspaceKey, GRAPH_WORKSPACE_KEY_FALLBACK);
  const sessionSegment = sessionId && sessionId.trim()
    ? sanitizeGraphPathSegment(sessionId, "session")
    : GRAPH_PENDING_SESSION_SEGMENT;
  const runSegment = sanitizeGraphPathSegment(graphRunId, "graph-run");
  return path.join(
    getGraphRunStoreRoot(options),
    workspaceSegment,
    cli,
    sessionSegment,
    runSegment,
    GRAPH_RUN_STORE_FILENAME,
  );
}

export function listGraphRunStoreFiles(options: GraphRunStorePathOptions = {}): string[] {
  const root = getGraphRunStoreRoot(options);
  if (!fs.existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        return;
      }
      if (entry.isFile() && entry.name === GRAPH_RUN_STORE_FILENAME) {
        files.push(fullPath);
      }
    });
  }
  return Array.from(new Set(files)).sort();
}

export function readGraphRunStore(
  filePath: string,
  options: GraphRunStorePathOptions = {},
): GraphRunStore {
  if (!fs.existsSync(filePath)) {
    return { runs: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid Graph run store JSON at ${filePath}: ${String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { runs?: unknown }).runs)) {
    return { runs: [] };
  }
  return ensureGraphRunStore(parsed as GraphRunStore, { ...options, sourceFile: filePath });
}

export function listGraphRuns(
  options: GraphRunDiscoveryOptions = {},
): GraphRunDiscoveryResult {
  const storeFiles = getGraphDiscoveryStoreFiles(options);
  const statusFilter = new Set<GraphRunStatus>([
    ...(options.status ? [options.status] : []),
    ...(options.statuses ?? []),
  ]);
  const runs: GraphRunRecord[] = [];
  const errors: GraphRunStoreDiscoveryError[] = [];
  let readableStoreFiles = 0;

  storeFiles.forEach((storeFile) => {
    try {
      const store = readGraphRunStore(storeFile, options);
      readableStoreFiles += 1;
      store.runs.forEach((run) => {
        if (options.workspaceKey !== undefined && run.workspaceKey !== options.workspaceKey) {
          return;
        }
        if (options.cli !== undefined && run.cli !== options.cli) {
          return;
        }
        if (statusFilter.size > 0 && !statusFilter.has(run.status)) {
          return;
        }
        runs.push(run);
      });
    } catch (error) {
      errors.push({
        storeFile,
        error: errorToGraphStoreDiscoveryMessage(error),
      });
    }
  });

  const sortedRuns = sortGraphRunsByRecentActivity(runs);
  const limit = normalizeDiscoveryLimit(options.limit);
  const returnedRuns = limit === null ? sortedRuns : sortedRuns.slice(0, limit);
  return {
    runs: returnedRuns,
    errors,
    diagnostics: {
      scannedStoreFiles: storeFiles.length,
      readableStoreFiles,
      unreadableStoreFiles: errors.length,
      matchedRuns: sortedRuns.length,
      returnedRuns: returnedRuns.length,
    },
  };
}

export function readGraphRunRecord(
  graphRunId: string,
  options: GraphRunDiscoveryOptions = {},
): GraphRunLookupResult {
  const result = listGraphRuns({ ...options, limit: undefined });
  return {
    run: result.runs.find((run) => run.id === graphRunId) ?? null,
    errors: result.errors,
    diagnostics: result.diagnostics,
  };
}

export function findLatestGraphRun(
  options: GraphRunDiscoveryOptions = {},
): GraphRunLookupResult {
  const result = listGraphRuns({ ...options, limit: 1 });
  return {
    run: result.runs[0] ?? null,
    errors: result.errors,
    diagnostics: result.diagnostics,
  };
}

export function writeGraphRunStore(
  filePath: string,
  store: GraphRunStore,
  options: GraphRunStorePathOptions = {},
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(ensureGraphRunStore(store, { ...options, sourceFile: filePath }), null, 2)}\n`,
    "utf8",
  );
}

export function createGraphRunRecord(
  input: CreateGraphRunRecordInput,
  options: GraphRunStoreOptions = {},
): GraphRunRecord {
  const now = options.now?.() ?? Date.now();
  const sessionId = typeof input.sessionId === "string" && input.sessionId.trim()
    ? input.sessionId.trim()
    : null;
  const storeFile = options.storeFile ?? buildGraphRunStoreFile(
    input.cli,
    input.workspaceKey,
    sessionId,
    input.id,
    options,
  );
  const communication = getGraphCommunicationPaths(input.id, options);
  const record: GraphRunRecord = {
    id: input.id,
    workspaceKey: input.workspaceKey,
    cli: input.cli,
    sessionId,
    rootPrompt: input.rootPrompt,
    ...(normalizeStringArray(input.supplementalRequirements).length > 0
      ? { supplementalRequirements: normalizeStringArray(input.supplementalRequirements) }
      : {}),
    status: input.status ?? "draft",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    ...(typeof input.templateId === "string" ? { templateId: input.templateId } : {}),
    ...(typeof input.templateVersion === "string" ? { templateVersion: input.templateVersion } : {}),
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: storeFile,
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    activeNodeIds: input.activeNodeIds ?? [],
    maxConcurrent: normalizePositiveInteger(input.maxConcurrent, GRAPH_DEFAULT_MAX_CONCURRENT_NODES),
    eventsFile: communication.eventsFile,
    communicationDir: communication.dir,
    mainCommunicationFile: communication.mainFile,
    graphFile: communication.graphFile,
    ...(input.worktree ? { worktree: input.worktree } : {}),
    ...(input.finalAnswer ? { finalAnswer: input.finalAnswer } : {}),
  };
  const normalized = normalizeGraphRunRecord(record, { ...options, sourceFile: storeFile });
  if (!normalized) {
    throw new Error(`Invalid Graph run record: ${input.id}`);
  }
  const store = readGraphRunStore(storeFile, options);
  const existingIndex = store.runs.findIndex((run) => run.id === normalized.id);
  if (existingIndex >= 0) {
    store.runs[existingIndex] = normalized;
  } else {
    store.runs.push(normalized);
  }
  writeGraphRunStore(storeFile, store, options);
  ensureGraphCommunicationFiles(normalized, options);
  return normalized;
}

export function updateGraphRunRecord(
  graphRunId: string,
  patch: Partial<GraphRunRecord>,
  options: GraphRunStoreOptions = {},
): GraphRunRecord | null {
  const storeFile = resolveGraphRunStoreFileForRun(graphRunId, options);
  if (!storeFile) {
    return null;
  }
  const store = readGraphRunStore(storeFile, options);
  const index = store.runs.findIndex((run) => run.id === graphRunId);
  if (index < 0) {
    return null;
  }
  const existing = store.runs[index];
  const nextStoreFile = typeof patch.runStoreFile === "string" && patch.runStoreFile.trim()
    ? patch.runStoreFile
    : existing.runStoreFile;
  const next = normalizeGraphRunRecord({
    ...existing,
    ...patch,
    id: existing.id,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: nextStoreFile,
    nodes: Array.isArray(patch.nodes) ? patch.nodes : existing.nodes,
    edges: Array.isArray(patch.edges) ? patch.edges : existing.edges,
    activeNodeIds: Array.isArray(patch.activeNodeIds) ? patch.activeNodeIds : existing.activeNodeIds,
    updatedAt: patch.updatedAt ?? (options.now?.() ?? Date.now()),
  }, { ...options, sourceFile: nextStoreFile });
  if (!next) {
    throw new Error(`Invalid Graph run update: ${graphRunId}`);
  }
  if (next.runStoreFile !== storeFile) {
    store.runs.splice(index, 1);
    if (store.runs.length > 0) {
      writeGraphRunStore(storeFile, store, options);
    } else if (fs.existsSync(storeFile)) {
      fs.unlinkSync(storeFile);
    }
    const targetStore = readGraphRunStore(next.runStoreFile, options);
    const targetIndex = targetStore.runs.findIndex((run) => run.id === graphRunId);
    if (targetIndex >= 0) {
      targetStore.runs[targetIndex] = next;
    } else {
      targetStore.runs.push(next);
    }
    writeGraphRunStore(next.runStoreFile, targetStore, options);
  } else {
    store.runs[index] = next;
    writeGraphRunStore(storeFile, store, options);
  }
  ensureGraphCommunicationFiles(next, options);
  return next;
}

export function normalizeGraphRunRecord(
  record: unknown,
  options: GraphRunStorePathOptions & { sourceFile?: string } = {},
): GraphRunRecord | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const raw = record as Partial<GraphRunRecord>;
  if (
    typeof raw.id !== "string"
    || !raw.id.trim()
    || typeof raw.rootPrompt !== "string"
    || !isCliName(raw.cli)
    || !isGraphRunStatus(raw.status)
  ) {
    return null;
  }
  if (raw.graphVersion !== undefined && raw.graphVersion !== GRAPH_SCHEMA_VERSION) {
    return null;
  }
  const workspaceKey = typeof raw.workspaceKey === "string" && raw.workspaceKey.trim()
    ? raw.workspaceKey
    : GRAPH_WORKSPACE_KEY_FALLBACK;
  const sessionId = typeof raw.sessionId === "string" && raw.sessionId.trim()
    ? raw.sessionId.trim()
    : null;
  const communication = getGraphCommunicationPaths(raw.id, options);
  const nodes = normalizeGraphNodes(raw.nodes);
  const edges = normalizeGraphEdges(raw.edges);
  if (!nodes || !edges) {
    return null;
  }
  const createdAt = normalizeFiniteTimestamp(raw.createdAt, Date.now());
  const updatedAt = normalizeFiniteTimestamp(raw.updatedAt, createdAt);
  return {
    id: raw.id,
    workspaceKey,
    cli: raw.cli,
    sessionId,
    rootPrompt: raw.rootPrompt,
    ...(normalizeStringArray(raw.supplementalRequirements).length > 0
      ? { supplementalRequirements: normalizeStringArray(raw.supplementalRequirements) }
      : {}),
    status: raw.status,
    createdAt,
    updatedAt,
    ...(typeof raw.templateId === "string" ? { templateId: raw.templateId } : {}),
    ...(typeof raw.templateVersion === "string" ? { templateVersion: raw.templateVersion } : {}),
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: typeof raw.runStoreFile === "string" && raw.runStoreFile.trim()
      ? raw.runStoreFile
      : (options.sourceFile ?? buildGraphRunStoreFile(raw.cli, workspaceKey, sessionId, raw.id, options)),
    nodes,
    edges,
    activeNodeIds: normalizeStringArray(raw.activeNodeIds),
    maxConcurrent: normalizePositiveInteger(raw.maxConcurrent, GRAPH_DEFAULT_MAX_CONCURRENT_NODES),
    eventsFile: typeof raw.eventsFile === "string" && raw.eventsFile.trim()
      ? raw.eventsFile
      : communication.eventsFile,
    communicationDir: typeof raw.communicationDir === "string" && raw.communicationDir.trim()
      ? raw.communicationDir
      : communication.dir,
    mainCommunicationFile: typeof raw.mainCommunicationFile === "string" && raw.mainCommunicationFile.trim()
      ? raw.mainCommunicationFile
      : communication.mainFile,
    graphFile: typeof raw.graphFile === "string" && raw.graphFile.trim()
      ? raw.graphFile
      : communication.graphFile,
    ...(normalizeGraphRunWorktree(raw.worktree) ? { worktree: normalizeGraphRunWorktree(raw.worktree) as GraphRunWorktreeRecord } : {}),
    ...(normalizeGraphFinalAnswer(raw.finalAnswer) ? { finalAnswer: normalizeGraphFinalAnswer(raw.finalAnswer) as GraphFinalAnswer } : {}),
  };
}

export function ensureGraphRunStore(
  store?: GraphRunStore,
  options: GraphRunStorePathOptions & { sourceFile?: string } = {},
): GraphRunStore {
  const runs = Array.isArray(store?.runs)
    ? store.runs
      .map((record) => normalizeGraphRunRecord(record, options))
      .filter((record): record is GraphRunRecord => Boolean(record))
    : [];
  return { runs };
}

function resolveGraphRunStoreFileForRun(graphRunId: string, options: GraphRunStoreOptions): string | null {
  if (options.storeFile && options.storeFile.trim()) {
    return options.storeFile;
  }
  const files = listGraphRunStoreFiles(options);
  for (const filePath of files) {
    try {
      const store = readGraphRunStore(filePath, options);
      if (store.runs.some((run) => run.id === graphRunId)) {
        return filePath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function getGraphDiscoveryStoreFiles(options: GraphRunDiscoveryOptions): string[] {
  if (options.storeFile && options.storeFile.trim()) {
    return [options.storeFile];
  }
  return listGraphRunStoreFiles(options);
}

function sortGraphRunsByRecentActivity(runs: readonly GraphRunRecord[]): GraphRunRecord[] {
  return [...runs].sort((left, right) => {
    const rightActivity = getGraphRunRecentActivityTimestamp(right);
    const leftActivity = getGraphRunRecentActivityTimestamp(left);
    if (rightActivity !== leftActivity) {
      return rightActivity - leftActivity;
    }
    if (right.createdAt !== left.createdAt) {
      return right.createdAt - left.createdAt;
    }
    return right.id.localeCompare(left.id);
  });
}

function getGraphRunRecentActivityTimestamp(run: Pick<GraphRunRecord, "createdAt" | "updatedAt">): number {
  return Math.max(run.createdAt, run.updatedAt);
}

function normalizeDiscoveryLimit(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function errorToGraphStoreDiscoveryMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
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

function normalizeGraphNodes(value: unknown): GraphNodeRecord[] | null {
  if (!Array.isArray(value)) {
    return [];
  }
  const nodes: GraphNodeRecord[] = [];
  for (const item of value) {
    const normalized = normalizeGraphNodeRecord(item);
    if (!normalized) {
      return null;
    }
    nodes.push(normalized);
  }
  return nodes;
}

function normalizeGraphNodeRecord(record: unknown): GraphNodeRecord | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const raw = record as Partial<GraphNodeRecord>;
  if (
    typeof raw.id !== "string"
    || !raw.id.trim()
    || typeof raw.title !== "string"
    || !raw.title.trim()
    || !isGraphNodeKind(raw.kind)
    || !isGraphNodeStatus(raw.status)
    || !isGraphOwnerRole(raw.ownerRole)
  ) {
    return null;
  }
  const rework = normalizeGraphNodeRework(raw.rework);
  if (raw.rework !== undefined && !rework) {
    return null;
  }
  return {
    id: raw.id,
    title: raw.title,
    kind: raw.kind,
    status: raw.status,
    ownerRole: raw.ownerRole,
    ...(typeof raw.promptRef === "string" && raw.promptRef.trim() ? { promptRef: raw.promptRef } : {}),
    ...(typeof raw.artifactRef === "string" && raw.artifactRef.trim() ? { artifactRef: raw.artifactRef } : {}),
    ...(typeof raw.communicationFile === "string" && raw.communicationFile.trim() ? { communicationFile: raw.communicationFile } : {}),
    ...(normalizeStringArray(raw.writeFiles).length > 0 ? { writeFiles: normalizeStringArray(raw.writeFiles) } : {}),
    ...(typeof raw.conflictGroup === "string" && raw.conflictGroup.trim() ? { conflictGroup: raw.conflictGroup.trim() } : {}),
    maxAttempts: normalizePositiveInteger(raw.maxAttempts, 1),
    attempts: normalizeNonNegativeInteger(raw.attempts, 0),
    dependsOn: normalizeStringArray(raw.dependsOn),
    unlocks: normalizeStringArray(raw.unlocks),
    ...(normalizeGraphAcceptanceChecks(raw.acceptance).length > 0 ? { acceptance: normalizeGraphAcceptanceChecks(raw.acceptance) } : {}),
    ...(normalizeOptionalTimestamp(raw.startedAt) !== undefined ? { startedAt: normalizeOptionalTimestamp(raw.startedAt) } : {}),
    ...(normalizeOptionalTimestamp(raw.completedAt) !== undefined ? { completedAt: normalizeOptionalTimestamp(raw.completedAt) } : {}),
    ...(normalizeOptionalTimestamp(raw.wakeAt) !== undefined ? { wakeAt: normalizeOptionalTimestamp(raw.wakeAt) } : {}),
    ...(typeof raw.lastError === "string" ? { lastError: raw.lastError } : {}),
    ...(rework ? { rework } : {}),
    ...(typeof raw.worktreeCwd === "string" && raw.worktreeCwd.trim() ? { worktreeCwd: raw.worktreeCwd.trim() } : {}),
    ...(typeof raw.baseCommit === "string" && raw.baseCommit.trim() ? { baseCommit: raw.baseCommit.trim() } : {}),
    ...(typeof raw.commit === "string" && raw.commit.trim() ? { commit: raw.commit.trim() } : {}),
  };
}

function normalizeGraphNodeRework(value: unknown): GraphNodeReworkRecord | null {
  if (value === undefined) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphNodeReworkRecord>;
  const resetAt = normalizeOptionalTimestamp(raw.resetAt);
  const resetScopeNodeIds = normalizeStringArray(raw.resetScopeNodeIds);
  if (
    typeof raw.sourceNodeId !== "string"
    || !raw.sourceNodeId.trim()
    || typeof raw.targetNodeId !== "string"
    || !raw.targetNodeId.trim()
    || resetAt === undefined
    || resetScopeNodeIds.length === 0
    || (raw.edgeKind !== undefined && !isGraphEdgeKind(raw.edgeKind))
  ) {
    return null;
  }
  return {
    sourceNodeId: raw.sourceNodeId.trim(),
    targetNodeId: raw.targetNodeId.trim(),
    resetAt,
    resetScopeNodeIds,
    ...(typeof raw.reason === "string" && raw.reason.trim() ? { reason: raw.reason.trim() } : {}),
    ...(typeof raw.edgeId === "string" && raw.edgeId.trim() ? { edgeId: raw.edgeId.trim() } : {}),
    ...(raw.edgeKind ? { edgeKind: raw.edgeKind } : {}),
  };
}

function normalizeGraphRunWorktree(value: unknown): GraphRunWorktreeRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphRunWorktreeRecord>;
  if (
    typeof raw.cwd !== "string"
    || !raw.cwd.trim()
    || typeof raw.branch !== "string"
    || !raw.branch.trim()
    || typeof raw.baseCommit !== "string"
    || !raw.baseCommit.trim()
  ) {
    return null;
  }
  return {
    cwd: raw.cwd.trim(),
    branch: raw.branch.trim(),
    baseCommit: raw.baseCommit.trim(),
    ...(normalizeOptionalTimestamp(raw.createdAt) !== undefined ? { createdAt: normalizeOptionalTimestamp(raw.createdAt) } : {}),
  };
}

function normalizeGraphEdges(value: unknown): GraphEdgeRecord[] | null {
  if (!Array.isArray(value)) {
    return [];
  }
  const edges: GraphEdgeRecord[] = [];
  for (const item of value) {
    const normalized = normalizeGraphEdgeRecord(item);
    if (!normalized) {
      return null;
    }
    edges.push(normalized);
  }
  return edges;
}

function normalizeGraphEdgeRecord(record: unknown): GraphEdgeRecord | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const raw = record as Partial<GraphEdgeRecord>;
  if (
    typeof raw.id !== "string"
    || !raw.id.trim()
    || typeof raw.from !== "string"
    || !raw.from.trim()
    || typeof raw.to !== "string"
    || !raw.to.trim()
    || !isGraphEdgeKind(raw.kind)
  ) {
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
    id: raw.id.trim(),
    from: raw.from.trim(),
    to: raw.to.trim(),
    kind: raw.kind,
    ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
    ...(typeof raw.condition === "string" && raw.condition.trim() ? { condition: raw.condition.trim() } : {}),
    ...(conditionExpression ? { conditionExpression } : {}),
    ...(metadata ? { metadata } : {}),
    active: typeof raw.active === "boolean" ? raw.active : true,
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

function normalizeGraphAcceptanceChecks(value: unknown): GraphAcceptanceCheck[] {
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

function normalizeGraphFinalAnswer(value: unknown): GraphFinalAnswer | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Partial<GraphFinalAnswer>;
  if (typeof raw.conclusion !== "string" || typeof raw.summary !== "string") {
    return undefined;
  }
  return {
    conclusion: raw.conclusion,
    summary: raw.summary,
    evidence: normalizeStringArray(raw.evidence),
    unresolved: normalizeStringArray(raw.unresolved),
    ...(normalizeOptionalTimestamp(raw.completedAt) !== undefined ? { completedAt: normalizeOptionalTimestamp(raw.completedAt) } : {}),
  };
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

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function normalizeFiniteTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isCliName(value: unknown): value is CliName {
  return typeof value === "string" && (CLI_LIST as readonly string[]).includes(value);
}
