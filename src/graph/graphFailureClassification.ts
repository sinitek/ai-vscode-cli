import {
  isGraphEdgeKind,
  isGraphFailureCategory,
  isGraphFailureRecoveryAction,
  isGraphNodeKind,
  isGraphOwnerRole,
  type GraphAcceptanceCheck,
  type GraphEdgeConditionExpression,
  type GraphEdgeMetadata,
  type GraphFailureCategory,
  type GraphFailureClassification,
  type GraphFailureConfidence,
  type GraphFailureRecoveryRecommendation,
  type GraphNodeRecord,
  type GraphPlannedEdgeSpec,
  type GraphPlannedNodeSpec,
  type GraphRunRecord,
} from "./types";

const TEST_FILE_PATH_PATTERN = /(?:^|[\s`"'([{<])((?:[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+)(?:\.test|\.spec)\.[A-Za-z0-9]+)(?=$|[\s`"',.;:)\]}>])/gu;
const PATH_WITH_EXTENSION_PATTERN = /(?:^|[\s`"'([{<])((?:[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+)\.[A-Za-z0-9]+)(?=$|[\s`"',.;:)\]}>])/gu;
const GLOB_SPECIAL_CHARS_PATTERN = /[.+^${}()|[\]\\]/gu;

const STALE_TEST_CONTRACT_SIGNALS = [
  "stale_test_contract: failure references an outdated test/source contract",
  "stale_test_contract: implementation appears to have moved while the test still checks the old source",
] as const;

const MISSING_WRITE_SCOPE_SIGNAL = "missing_write_scope: candidate fix files are outside this node writeFiles";
const ENVIRONMENT_SIGNAL = "environment_failure: failure text points to tooling, filesystem, process, network, or workspace setup";
const IMPLEMENTATION_SIGNAL = "implementation_bug: failure appears to be a product or test assertion regression";

export type GraphFailureClassificationExecutorResult = {
  summary?: string;
  error?: string;
  artifactRef?: string;
  artifactSummary?: string;
  acceptance?: GraphAcceptanceCheck[];
  failure?: GraphFailureClassification;
};

export type ClassifyGraphNodeFailureInput = {
  run?: Pick<GraphRunRecord, "nodes" | "edges">;
  node: GraphNodeRecord;
  error?: string;
  result?: GraphFailureClassificationExecutorResult;
  artifactSummary?: string;
  attemptsExhausted?: boolean;
};

type FailureTextContext = {
  text: string;
  candidateWriteFiles: string[];
  uncoveredWriteFiles: string[];
  hasStaleTestContract: boolean;
  hasMissingWriteScope: boolean;
  hasEnvironmentFailure: boolean;
};

export function classifyGraphNodeFailure(
  input: ClassifyGraphNodeFailureInput,
): GraphFailureClassification {
  const context = buildFailureTextContext(input);
  const signals = extractGraphFailureSignals(input, context);
  const { category, confidence } = selectGraphFailureCategory(context);
  const summary = buildFailureSummary(category, context);
  const recommendedRecovery = buildGraphFailureRecoveryRecommendation({
    ...input,
    category,
    candidateWriteFiles: context.candidateWriteFiles,
    uncoveredWriteFiles: context.uncoveredWriteFiles,
    sourceText: context.text,
  });

  return {
    category,
    confidence,
    summary,
    signals,
    ...(typeof input.attemptsExhausted === "boolean" ? { attemptsExhausted: input.attemptsExhausted } : {}),
    ...(recommendedRecovery ? { recommendedRecovery } : {}),
  };
}

export function extractGraphFailureSignals(
  input: ClassifyGraphNodeFailureInput,
  context = buildFailureTextContext(input),
): string[] {
  const signals: string[] = [];
  if (context.hasStaleTestContract) {
    signals.push(...STALE_TEST_CONTRACT_SIGNALS);
  }
  if (context.hasMissingWriteScope) {
    signals.push(MISSING_WRITE_SCOPE_SIGNAL);
  }
  if (context.hasEnvironmentFailure) {
    signals.push(ENVIRONMENT_SIGNAL);
  }
  if (signals.length === 0) {
    signals.push(IMPLEMENTATION_SIGNAL);
  }
  context.candidateWriteFiles.forEach((file) => signals.push(`candidate_write_file: ${file}`));
  return uniqueStrings(signals);
}

export function extractCandidateWriteFiles(source: string | readonly string[]): string[] {
  const text = typeof source === "string" ? source : source.join("\n");
  const testPathMatches = extractPathMatchRecords(text, TEST_FILE_PATH_PATTERN);
  if (testPathMatches.length > 0) {
    const relevantTestPaths = testPathMatches
      .filter((match) => hasCandidateWriteFileContext(text, match.index))
      .flatMap((match) => expandCandidateWriteFilePath(match.path));
    if (relevantTestPaths.length > 0) {
      const frequentRelevantTestPaths = selectMostFrequentPaths(relevantTestPaths);
      if (frequentRelevantTestPaths.length > 0) {
        return frequentRelevantTestPaths;
      }
      return uniqueStrings(relevantTestPaths);
    }
    const frequentTestPaths = selectMostFrequentPaths(testPathMatches.flatMap((match) => expandCandidateWriteFilePath(match.path)));
    if (frequentTestPaths.length > 0) {
      return frequentTestPaths;
    }
    return uniqueStrings(testPathMatches.flatMap((match) => expandCandidateWriteFilePath(match.path)));
  }
  return uniqueStrings(extractPathMatches(text, PATH_WITH_EXTENSION_PATTERN)
    .filter(isLikelyWritablePath)
    .flatMap(expandCandidateWriteFilePath));
}

export function buildGraphFailureRecoveryRecommendation(input: ClassifyGraphNodeFailureInput & {
  category: GraphFailureCategory;
  candidateWriteFiles?: readonly string[];
  uncoveredWriteFiles?: readonly string[];
  sourceText?: string;
}): GraphFailureRecoveryRecommendation | undefined {
  const recommendedWriteFiles = uniqueStrings([
    ...(input.uncoveredWriteFiles ?? []),
    ...(input.candidateWriteFiles ?? []),
  ]);

  if (
    (input.category === "missing_write_scope" || input.category === "stale_test_contract")
    && recommendedWriteFiles.length > 0
  ) {
    const nodeDraft = buildReworkNodeDraft(input.node, recommendedWriteFiles, input.sourceText ?? "");
    const edgeDrafts = buildReworkEdgeDrafts(input, nodeDraft.id);
    return {
      action: "add_rework_node",
      summary: `Add a rework node with writeFiles for ${recommendedWriteFiles.join(", ")} before retrying ${input.node.id}.`,
      targetNodeId: nodeDraft.id,
      recommendedWriteFiles,
      nodeDraft,
      edgeDrafts,
    };
  }

  if (input.category === "missing_write_scope") {
    return {
      action: "add_write_scope",
      summary: `Expand writeFiles for ${input.node.id} before retrying; retry alone cannot grant file access.`,
    };
  }

  if (input.category === "environment_failure") {
    return input.attemptsExhausted
      ? {
        action: "manual_review",
        summary: "Inspect the execution environment before adding more attempts.",
      }
      : {
        action: "retry_node",
        summary: "Retry after confirming the environment issue is transient.",
        targetNodeId: input.node.id,
      };
  }

  const feedbackTargetNodeId = findFeedbackTargetNodeId(input.run, input.node.id);
  if (feedbackTargetNodeId) {
    return {
      action: "feedback_rollback",
      summary: `Route the failure back to ${feedbackTargetNodeId} using the existing feedback edge.`,
      targetNodeId: feedbackTargetNodeId,
    };
  }

  return input.attemptsExhausted
    ? {
      action: "manual_review",
      summary: "Review the implementation failure before adding further attempts.",
    }
    : {
      action: "retry_node",
      summary: "Retry this node if the failure was caused by incomplete local changes.",
      targetNodeId: input.node.id,
    };
}

export function normalizeGraphFailureClassification(value: unknown): GraphFailureClassification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphFailureClassification>;
  if (
    !isGraphFailureCategory(raw.category)
    || !isGraphFailureConfidence(raw.confidence)
    || typeof raw.summary !== "string"
    || !raw.summary.trim()
  ) {
    return null;
  }
  const recommendedRecovery = normalizeGraphFailureRecoveryRecommendation(raw.recommendedRecovery);
  return {
    category: raw.category,
    confidence: raw.confidence,
    summary: raw.summary.trim(),
    signals: normalizeStringArray(raw.signals),
    ...(typeof raw.attemptsExhausted === "boolean" ? { attemptsExhausted: raw.attemptsExhausted } : {}),
    ...(recommendedRecovery ? { recommendedRecovery } : {}),
  };
}

export function normalizeGraphFailureRecoveryRecommendation(
  value: unknown,
): GraphFailureRecoveryRecommendation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphFailureRecoveryRecommendation>;
  if (
    !isGraphFailureRecoveryAction(raw.action)
    || typeof raw.summary !== "string"
    || !raw.summary.trim()
  ) {
    return null;
  }
  const nodeDraft = normalizeGraphFailurePlannedNodeSpec(raw.nodeDraft);
  const edgeDrafts = normalizeGraphFailurePlannedEdgeSpecs(raw.edgeDrafts);
  return {
    action: raw.action,
    summary: raw.summary.trim(),
    ...(typeof raw.targetNodeId === "string" && raw.targetNodeId.trim() ? { targetNodeId: raw.targetNodeId.trim() } : {}),
    ...(normalizeStringArray(raw.recommendedWriteFiles).length > 0 ? { recommendedWriteFiles: normalizeStringArray(raw.recommendedWriteFiles) } : {}),
    ...(nodeDraft ? { nodeDraft } : {}),
    ...(edgeDrafts.length > 0 ? { edgeDrafts } : {}),
  };
}

function buildFailureTextContext(input: ClassifyGraphNodeFailureInput): FailureTextContext {
  const text = buildFailureSourceText(input);
  const candidateWriteFiles = extractCandidateWriteFiles(text);
  const uncoveredWriteFiles = candidateWriteFiles
    .filter((candidate) => !isPathCoveredByWriteFiles(candidate, input.node.writeFiles));
  const hasStaleTestContract = detectStaleTestContract(text, input.node);
  const hasExplicitMissingWriteScope = detectExplicitMissingWriteScope(text);
  const hasMissingWriteScope = hasExplicitMissingWriteScope
    || (hasStaleTestContract && candidateWriteFiles.length > 0 && uncoveredWriteFiles.length > 0);
  return {
    text,
    candidateWriteFiles,
    uncoveredWriteFiles,
    hasStaleTestContract,
    hasMissingWriteScope,
    hasEnvironmentFailure: detectEnvironmentFailure(text),
  };
}

function buildFailureSourceText(input: ClassifyGraphNodeFailureInput): string {
  const parts = [
    input.error,
    input.result?.error,
    input.result?.summary,
    input.result?.artifactRef,
    input.result?.artifactSummary,
    input.artifactSummary,
    ...normalizeAcceptanceText(input.result?.acceptance),
  ];
  return parts
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join("\n");
}

function normalizeAcceptanceText(acceptance: readonly GraphAcceptanceCheck[] | undefined): string[] {
  if (!Array.isArray(acceptance)) {
    return [];
  }
  return acceptance.flatMap((check) => [
    check.name,
    check.detail,
    check.evidenceRef,
  ]).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function selectGraphFailureCategory(context: FailureTextContext): {
  category: GraphFailureCategory;
  confidence: GraphFailureConfidence;
} {
  if (context.hasMissingWriteScope) {
    return {
      category: "missing_write_scope",
      confidence: context.candidateWriteFiles.length > 0 ? "high" : "medium",
    };
  }
  if (context.hasStaleTestContract) {
    return { category: "stale_test_contract", confidence: "high" };
  }
  if (context.hasEnvironmentFailure) {
    return { category: "environment_failure", confidence: "medium" };
  }
  return { category: "implementation_bug", confidence: "medium" };
}

function buildFailureSummary(category: GraphFailureCategory, context: FailureTextContext): string {
  if (category === "missing_write_scope") {
    const files = context.uncoveredWriteFiles.length > 0
      ? context.uncoveredWriteFiles.join(", ")
      : "the required repair files";
    return `Failure needs write scope that this node does not have: ${files}.`;
  }
  if (category === "stale_test_contract") {
    return "Failure likely comes from a stale test contract after implementation files moved.";
  }
  if (category === "environment_failure") {
    return "Failure likely comes from the execution environment rather than the planned code change.";
  }
  return "Failure likely comes from an implementation or assertion bug.";
}

function detectStaleTestContract(text: string, node: GraphNodeRecord): boolean {
  const lower = text.toLowerCase();
  const isValidationNode = node.kind === "test" || node.kind === "review";
  const hasOldContractTerm = includesAny(lower, [
    "source-contract",
    "canonical source",
    "stale contract",
    "old assertion",
    "old text assertion",
    "db.js text",
    "still reads",
    "still reading",
    "仍读取",
    "仍依赖",
    "旧断言",
    "文本断言",
  ]);
  const hasMovedImplementationTerm = includesAny(lower, [
    "migrated",
    "moved",
    "split",
    "relocated",
    "db/schema",
    "observability.js",
    "已迁入",
    "迁入",
    "拆分",
  ]);
  return isValidationNode && hasOldContractTerm && hasMovedImplementationTerm;
}

function detectExplicitMissingWriteScope(text: string): boolean {
  const lower = text.toLowerCase();
  return includesAny(lower, [
    "missing writefiles",
    "writefiles missing",
    "write scope",
    "writefiles 未声明",
    "无 writefiles",
    "无权写",
    "不得写",
    "授权缺口",
    "未纳入写入授权",
  ]);
}

function detectEnvironmentFailure(text: string): boolean {
  const lower = text.toLowerCase();
  return includesAny(lower, [
    "enoent",
    "eacces",
    "eperm",
    "econnreset",
    "etimedout",
    "permission denied",
    "command not found",
    "spawn ",
    "timed out",
    "timeout",
    "network",
    "worktree",
    "git reset",
    "no such file or directory",
    "cannot find module",
  ]);
}

function buildReworkNodeDraft(
  failedNode: GraphNodeRecord,
  recommendedWriteFiles: readonly string[],
  sourceText: string,
): GraphPlannedNodeSpec {
  const nodeId = detectSchemaContractFailure(sourceText, recommendedWriteFiles)
    ? "adapt-schema-contract-tests"
    : `adapt-${sanitizeGraphDraftId(failedNode.id)}-write-scope`;
  return {
    id: nodeId,
    title: detectSchemaContractFailure(sourceText, recommendedWriteFiles)
      ? "Adapt schema contract tests"
      : `Adapt write scope for ${failedNode.title}`,
    kind: failedNode.kind === "review" ? "review" : "test",
    ownerRole: "subtask",
    writeFiles: [...recommendedWriteFiles],
    conflictGroup: buildConflictGroup(recommendedWriteFiles),
    maxAttempts: 2,
    dependsOn: [...failedNode.dependsOn],
    acceptance: [{
      name: "Update the stale contract or missing write scope file and keep the downstream validation focused.",
      required: true,
    }],
  };
}

function buildReworkEdgeDrafts(
  input: ClassifyGraphNodeFailureInput,
  reworkNodeId: string,
): GraphPlannedEdgeSpec[] {
  const dependencyIds = input.node.dependsOn.length > 0 ? input.node.dependsOn : [];
  const dependencyEdges = dependencyIds.map((dependencyId) => ({
    from: dependencyId,
    to: reworkNodeId,
    kind: "depends_on" as const,
  }));
  return [
    ...dependencyEdges,
    {
      from: reworkNodeId,
      to: input.node.id,
      kind: "depends_on",
    },
    {
      from: input.node.id,
      to: reworkNodeId,
      kind: "if_fail",
      label: "Rework stale contract or missing write scope",
      metadata: {
        feedbackReason: "Failure classification recommends adding an authorized rework node instead of retrying the same node.",
        reworkTargetNodeId: reworkNodeId,
        reworkScopeNodeIds: uniqueStrings([reworkNodeId, input.node.id]),
      },
    },
  ];
}

function findFeedbackTargetNodeId(
  run: Pick<GraphRunRecord, "edges"> | undefined,
  failedNodeId: string,
): string | undefined {
  const edge = run?.edges.find((candidate) => candidate.from === failedNodeId
    && candidate.active !== false
    && (candidate.kind === "if_fail" || candidate.kind === "review_feedback"));
  return edge?.metadata?.reworkTargetNodeId ?? edge?.to;
}

function extractPathMatches(text: string, pattern: RegExp): string[] {
  return extractPathMatchRecords(text, pattern)
    .map((match) => match.path)
    .filter(Boolean);
}

function extractPathMatchRecords(text: string, pattern: RegExp): Array<{ path: string; index: number }> {
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern))
    .map((match) => ({
      path: trimPathToken(match[1] ?? ""),
      index: match.index ?? 0,
    }))
    .filter((match) => Boolean(match.path));
}

function hasCandidateWriteFileContext(text: string, index: number): boolean {
  const start = Math.max(0, index - 240);
  const end = Math.min(text.length, index + 320);
  const context = text.slice(start, end).toLowerCase();
  return includesAny(context, [
    "failed",
    "failure",
    "source-contract",
    "stale",
    "old assertion",
    "still reads",
    "still depends",
    "migrated",
    "moved",
    "失败",
    "失败项",
    "失败断言",
    "旧断言",
    "仍读取",
    "仍依赖",
    "已迁入",
    "迁入",
  ]);
}

function selectMostFrequentPaths(paths: readonly string[]): string[] {
  const counts = new Map<string, number>();
  paths.forEach((pathName) => counts.set(pathName, (counts.get(pathName) ?? 0) + 1));
  const maxCount = Math.max(0, ...Array.from(counts.values()));
  if (maxCount <= 1) {
    return [];
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count === maxCount)
    .map(([pathName]) => pathName);
}

function trimPathToken(value: string): string {
  return value.trim().replace(/[),.;:]+$/u, "");
}

function expandCandidateWriteFilePath(pathName: string): string[] {
  const normalized = pathName.trim();
  const sourceTestPath = mapCompiledDistTestToSourceTest(normalized);
  if (!sourceTestPath || sourceTestPath === normalized) {
    return [normalized];
  }
  return [sourceTestPath, normalized];
}

function mapCompiledDistTestToSourceTest(pathName: string): string | null {
  const match = /^dist\/test\/(.+)\.test\.js$/u.exec(pathName);
  if (!match) {
    return null;
  }
  return `src/test/${match[1]}.test.ts`;
}

function isLikelyWritablePath(value: string): boolean {
  return value.includes("/")
    && !value.startsWith("/")
    && !value.includes("node_modules/")
    && !value.includes(".sinitek_cli/");
}

function isPathCoveredByWriteFiles(pathName: string, writeFiles: readonly string[] | undefined): boolean {
  const scopes = normalizeStringArray(writeFiles);
  if (scopes.length === 0) {
    return false;
  }
  return scopes.some((scope) => isPathCoveredByWriteScope(pathName, scope));
}

function isPathCoveredByWriteScope(pathName: string, scope: string): boolean {
  if (scope === pathName) {
    return true;
  }
  if (scope.endsWith("/")) {
    return pathName.startsWith(scope);
  }
  if (scope.endsWith("/**")) {
    return pathName.startsWith(scope.slice(0, -2));
  }
  if (!scope.includes("*")) {
    return pathName.startsWith(`${scope}/`);
  }
  const pattern = `^${scope.replace(GLOB_SPECIAL_CHARS_PATTERN, "\\$&").replace(/\*/gu, ".*")}$`;
  return new RegExp(pattern, "u").test(pathName);
}

function detectSchemaContractFailure(sourceText: string, writeFiles: readonly string[]): boolean {
  const lower = sourceText.toLowerCase();
  return writeFiles.some((file) => file.endsWith("performance-observation-schema.test.js"))
    || (lower.includes("schema") && lower.includes("db.js"));
}

function buildConflictGroup(writeFiles: readonly string[]): string {
  const firstFile = writeFiles[0];
  if (!firstFile) {
    return "graph-rework";
  }
  if (firstFile.includes("/test/") || firstFile.includes(".test.")) {
    return "graph-rework-tests";
  }
  return "graph-rework";
}

function sanitizeGraphDraftId(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return sanitized || "node";
}

function normalizeGraphFailurePlannedNodeSpec(value: unknown): GraphPlannedNodeSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphPlannedNodeSpec>;
  if (
    typeof raw.id !== "string"
    || !raw.id.trim()
    || typeof raw.title !== "string"
    || !raw.title.trim()
    || !isGraphNodeKind(raw.kind)
  ) {
    return null;
  }
  return {
    id: raw.id.trim(),
    title: raw.title.trim(),
    kind: raw.kind,
    ...(isGraphOwnerRole(raw.ownerRole) ? { ownerRole: raw.ownerRole } : {}),
    ...(typeof raw.promptRef === "string" && raw.promptRef.trim() ? { promptRef: raw.promptRef.trim() } : {}),
    ...(normalizeStringArray(raw.writeFiles).length > 0 ? { writeFiles: normalizeStringArray(raw.writeFiles) } : {}),
    ...(typeof raw.conflictGroup === "string" && raw.conflictGroup.trim() ? { conflictGroup: raw.conflictGroup.trim() } : {}),
    ...(normalizePositiveInteger(raw.maxAttempts) ? { maxAttempts: normalizePositiveInteger(raw.maxAttempts) as number } : {}),
    ...(normalizeStringArray(raw.dependsOn).length > 0 ? { dependsOn: normalizeStringArray(raw.dependsOn) } : {}),
    ...(normalizeAcceptance(raw.acceptance).length > 0 ? { acceptance: normalizeAcceptance(raw.acceptance) } : {}),
    ...(typeof raw.wakeAt === "number" && Number.isFinite(raw.wakeAt) ? { wakeAt: raw.wakeAt } : {}),
  };
}

function normalizeGraphFailurePlannedEdgeSpecs(value: unknown): GraphPlannedEdgeSpec[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeGraphFailurePlannedEdgeSpec)
    .filter((item): item is GraphPlannedEdgeSpec => Boolean(item));
}

function normalizeGraphFailurePlannedEdgeSpec(value: unknown): GraphPlannedEdgeSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphPlannedEdgeSpec>;
  const kind = raw.kind ?? "depends_on";
  if (
    typeof raw.from !== "string"
    || !raw.from.trim()
    || typeof raw.to !== "string"
    || !raw.to.trim()
    || !isGraphEdgeKind(kind)
  ) {
    return null;
  }
  return {
    ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
    from: raw.from.trim(),
    to: raw.to.trim(),
    kind,
    ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
    ...(typeof raw.condition === "string" && raw.condition.trim() ? { condition: raw.condition.trim() } : {}),
    ...(normalizeGraphFailureEdgeConditionExpression(raw.conditionExpression) ? { conditionExpression: normalizeGraphFailureEdgeConditionExpression(raw.conditionExpression) as GraphEdgeConditionExpression } : {}),
    ...(normalizeGraphFailureEdgeMetadata(raw.metadata) ? { metadata: normalizeGraphFailureEdgeMetadata(raw.metadata) as GraphEdgeMetadata } : {}),
    ...(typeof raw.active === "boolean" ? { active: raw.active } : {}),
  };
}

function normalizeGraphFailureEdgeConditionExpression(value: unknown): GraphEdgeConditionExpression | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as GraphEdgeConditionExpression;
}

function normalizeGraphFailureEdgeMetadata(value: unknown): GraphEdgeMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphEdgeMetadata>;
  const metadata: GraphEdgeMetadata = {
    ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
    ...(typeof raw.rationale === "string" && raw.rationale.trim() ? { rationale: raw.rationale.trim() } : {}),
    ...(typeof raw.evidenceRef === "string" && raw.evidenceRef.trim() ? { evidenceRef: raw.evidenceRef.trim() } : {}),
    ...(typeof raw.feedbackReason === "string" && raw.feedbackReason.trim() ? { feedbackReason: raw.feedbackReason.trim() } : {}),
    ...(typeof raw.reworkTargetNodeId === "string" && raw.reworkTargetNodeId.trim() ? { reworkTargetNodeId: raw.reworkTargetNodeId.trim() } : {}),
    ...(normalizeStringArray(raw.reworkScopeNodeIds).length > 0 ? { reworkScopeNodeIds: normalizeStringArray(raw.reworkScopeNodeIds) } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : null;
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

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function isGraphFailureConfidence(value: unknown): value is GraphFailureConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function includesAny(source: string, needles: readonly string[]): boolean {
  return needles.some((needle) => source.includes(needle));
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
