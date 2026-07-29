import * as path from "path";

import {
  GRAPH_NODE_COMMUNICATIONS_DIR_NAME,
} from "./graphCommunications";
import { GRAPH_AI_PLANNER_NODE_ID } from "./graphPlanner";
import {
  sanitizeGraphPathSegment,
  type GraphAcceptanceCheck,
  type GraphEdgeConditionExpression,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "./types";

export type GraphNodePromptOptions = {
  validationRequirements?: readonly string[];
  extraInstructions?: readonly string[];
  generatedAt?: string;
};

export type BuildGraphNodePromptInput = {
  run: GraphRunRecord;
  node: GraphNodeRecord;
  options?: GraphNodePromptOptions;
};

const GRAPH_PROMPT_EMPTY_VALUE = "未声明";
const GRAPH_TOPOLOGY_REFERENCE_LIMIT = 16;

const GRAPH_TERMINAL_NODE_STATUSES = new Set<GraphNodeRecord["status"]>([
  "passed",
  "blocked",
  "skipped",
  "stopped",
]);

const GRAPH_NODE_ROLE_GUIDANCE: Record<GraphNodeRecord["kind"], string[]> = {
  intake: [
    "澄清目标、边界、输入资料和可验收产出；只在明确授权时才修改文件。",
  ],
  plan: [
    "产出可执行计划、依赖顺序、风险和验证口径；不要直接替代后续 implement/test/review 节点完成工作。",
  ],
  implement: [
    "在授权写入范围内完成实现改动，并保留清晰、可搜索、可复用的代码结构。",
  ],
  test: [
    "验证目标能力，优先补或运行最小相关自动化测试；仅在授权写入范围内修改测试或必要夹具。",
  ],
  review: [
    "按代码审查视角检查正确性、越权写入、遗漏验证和回归风险；只在授权时写修复。",
  ],
  debate: [
    "围绕方案、实现、验证和阻塞风险做结构化攻防；结论必须可追溯到证据。",
  ],
  human_gate: [
    "这是人工关卡节点；普通 CLI executor 不应执行它，只能由宿主或用户批准后推进。",
  ],
  merge: [
    "汇总已通过节点的改动和证据，处理授权范围内的合并冲突或收束工作。",
  ],
  sleep: [
    "这是系统等待节点；普通 CLI executor 不应执行它，到期后由宿主推进。",
  ],
  summary: [
    "读取 Graph events、graph.json 和节点 artifacts，生成最终结论、验证证据与未完成事项。",
    "不得把 failed、blocked、stopped、skipped 或未验证节点描述为成功完成。",
  ],
};

export function buildGraphNodePrompt(input: BuildGraphNodePromptInput): string {
  const { run, node, options = {} } = input;
  const communicationFile = resolveGraphNodeCommunicationFile(run, node);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const lines: string[] = [
    "# Graph 节点执行任务",
    "",
    "你正在执行 VS Code 插件 Graph 模式中的单个节点任务。",
    "注意：这是单独新会话，不具备主任务对话上下文；只能依赖本提示词、Graph run 文件、events、节点 artifacts 和授权沟通文件。",
    "注意：同一 Graph run 可能存在其他节点并发执行；必须严格限定在当前节点授权范围内，发现写入范围冲突或越权需求时立即停止并写入节点沟通文件。",
    "",
    "## 长期记忆边界",
    "- Graph 模式默认不触发长期记忆写入；本节点不得主动生成、刷新或修改 generated recall 产物。",
    "- 如需长期记忆上下文，只能读取已有仓库记忆或运行态 recall；没有可用内容时完全跳过 recall，不要把 recall 缺失视为失败。",
    "- Graph 任务完成后的长期记忆沉淀只由主智能体在收束后专门处理；本节点不得写入 `.ch/docs/memory/`、`.ch/docs/runbooks/PITFALLS.md` 或运行态 memory-generated 目录。",
    "",
    "## Graph Run",
    `- Graph run id：${run.id}`,
    `- CLI：${run.cli}`,
    ...formatGraphRunModelRoutingLines(run),
    `- Workspace key：${run.workspaceKey}`,
    `- Session id：${run.sessionId ?? GRAPH_PROMPT_EMPTY_VALUE}`,
    `- Run status：${run.status}`,
    `- Graph file：${run.graphFile}`,
    `- Events file：${run.eventsFile}`,
    `- Communication dir：${run.communicationDir}`,
    `- Main communication file：${run.mainCommunicationFile}`,
    `- Execution mode：${formatGraphExecutionMode(run)}`,
    `- Execution cwd：${formatGraphExecutionCwd(run)}`,
    `- Direct execution note：${formatValue(run.directExecution?.reason)}`,
    `- Worktree cwd：${formatValue(run.worktree?.cwd)}`,
    `- Worktree branch：${formatValue(run.worktree?.branch)}`,
    `- Worktree base commit：${formatValue(run.worktree?.baseCommit)}`,
    `- Prompt generated at：${generatedAt}`,
    "",
    "## 当前节点",
    `- Node id：${node.id}`,
    `- Title：${node.title}`,
    `- Kind：${node.kind}`,
    `- Owner role：${node.ownerRole}`,
    `- Model role：${formatValue(node.modelRole)}`,
    `- Model used：${formatValue(node.model)}`,
    `- Model fallback：${formatValue(node.modelFallback)}`,
    `- Status at dispatch：${node.status}`,
    `- Attempts：${node.attempts}/${node.maxAttempts}`,
    `- Depends on：${formatList(node.dependsOn)}`,
    `- Unlocks：${formatList(node.unlocks)}`,
    `- Prompt ref：${formatValue(node.promptRef)}`,
    `- Artifact ref：${formatValue(node.artifactRef)}`,
    `- Communication file：${communicationFile}`,
    `- Node execution cwd：${formatValue(node.executionCwd)}`,
    `- Node base commit：${formatValue(node.baseCommit)}`,
    `- Node checkpoint commit：${formatValue(node.commit)}`,
    `- Last error：${formatValue(node.lastError)}`,
    ...formatGraphNodeReworkLines(node),
    "",
    "## 全图拓扑与当前位置",
    ...formatGraphTopologyLines(run, node),
    "",
    "## 原始目标",
    run.rootPrompt,
    "",
    "## 用户补充消息",
    ...formatSupplementalRequirementLines(run.supplementalRequirements),
    "",
    "## 授权范围",
    `- writeFiles：${formatWriteFiles(node.writeFiles, run)}`,
    `- conflictGroup：${formatValue(node.conflictGroup)}`,
    ...formatGraphExecutionBoundaryLines(run),
    "- 不得修改未授权文件、任务记录、Graph store、其他节点 artifact 或其他节点沟通文件。",
    "- 如果正确完成任务必须修改未授权范围，停止实施，在本节点沟通文件写明待确认事项，并返回 blocked。",
    "",
    "## 依赖与输入",
    ...formatDependencyLines(run, node),
    "",
    "## 节点职责",
    ...GRAPH_NODE_ROLE_GUIDANCE[node.kind].map((item) => `- ${item}`),
    ...formatGraphNodeBoundaryLines(run, node),
    "",
    "## Acceptance",
    ...formatAcceptanceLines(node.acceptance),
    "",
    "## 验证要求",
    ...formatValidationRequirementLines(options.validationRequirements),
    "",
    "## 输出格式",
    "- 必须把执行记录写入上方 Communication file。",
    "- 回复和 artifact 必须包含以下固定小节：",
    "  - `## 执行摘要`：说明完成、失败或阻塞的结论。",
    "  - `## 实际修改/操作`：列出实际读写与关键判断。",
    "  - `## 验证命令与结果`：列出命令、结果、退出码；未运行需说明原因。",
    "  - `## 遗留问题`：没有则写“无”。",
    "  - `## JSON`：提供一个 JSON 代码块，供宿主解析节点结果。",
    "- JSON 结构必须是：",
    '{"status":"passed|failed|blocked","summary":"一句话结果","artifactRef":"可选 artifact 路径","acceptance":[{"name":"检查项","passed":true,"required":true,"detail":"证据"}]}',
    "",
    "## 禁止越权",
    "- 禁止扩大技术栈、改动未授权文件、绕开 Graph 调度器、启动未指定的长期后台任务或声称未验证能力已经完成。",
    "- 禁止把未通过的 acceptance、失败的测试、blocked 节点或未读取的 artifact 写成成功完成。",
    ...formatExtraInstructionLines(options.extraInstructions),
  ];

  if (node.kind === "summary") {
    lines.push("", ...buildGraphSummaryPromptTail(run));
  }
  if (isAiPlannerNode(run, node)) {
    lines.push("", ...buildGraphAiPlannerPromptTail());
  }

  return `${lines.join("\n")}\n`;
}

export function buildGraphSummaryNodePrompt(
  run: GraphRunRecord,
  node: GraphNodeRecord,
  options: GraphNodePromptOptions = {},
): string {
  return buildGraphNodePrompt({ run, node, options });
}

export function resolveGraphNodeCommunicationFile(
  run: Pick<GraphRunRecord, "communicationDir">,
  node: Pick<GraphNodeRecord, "id" | "communicationFile">,
): string {
  if (node.communicationFile?.trim()) {
    return node.communicationFile.trim();
  }
  return path.join(
    run.communicationDir,
    GRAPH_NODE_COMMUNICATIONS_DIR_NAME,
    `${sanitizeGraphPathSegment(node.id, "node")}.md`,
  );
}

function buildGraphSummaryPromptTail(run: GraphRunRecord): string[] {
  return [
    "## Summary 节点专用要求",
    `- 必须读取 events file：${run.eventsFile}`,
    `- 必须读取 graph snapshot：${run.graphFile}`,
    "- 必须按需要读取所有节点 communicationFile / artifactRef，不能只依赖本提示词中的摘要。",
    "- 最终结论必须区分已完成、未完成、失败、阻塞和未验证事项；不得把未通过节点写成成功完成。",
    "- 如果任何必要节点 failed、blocked、stopped、skipped 或缺少验证证据，finalAnswer.unresolved 必须列出具体节点和原因。",
    "- Summary JSON 必须额外包含 finalAnswer：",
    '{"status":"passed|blocked","summary":"最终摘要","finalAnswer":{"conclusion":"最终结论","summary":"用户可读总结","evidence":["验证证据或 artifact"],"unresolved":["未完成事项"],"completedAt":1234567890}}',
    "",
    "## 节点与 artifact 清单",
    ...run.nodes.map((item) => {
      const communicationFile = resolveGraphNodeCommunicationFile(run, item);
      return [
        `- ${item.id}｜${item.kind}｜${item.status}｜${item.title}`,
        `  - communicationFile：${communicationFile}`,
        `  - artifactRef：${formatValue(item.artifactRef)}`,
        `  - attempts：${item.attempts}/${item.maxAttempts}`,
        `  - baseCommit：${formatValue(item.baseCommit)}`,
        `  - commit：${formatValue(item.commit)}`,
        `  - lastError：${formatValue(item.lastError)}`,
        `  - rework：${formatGraphNodeReworkSummary(item)}`,
      ].join("\n");
    }),
  ];
}

type GraphTopologyRelationships = {
  directDependencyIds: string[];
  directUnlockIds: string[];
  ancestorIds: string[];
  descendantIds: string[];
};

function formatGraphTopologyLines(run: GraphRunRecord, node: GraphNodeRecord): string[] {
  const relationships = collectGraphTopologyRelationships(run, node);
  const currentIndex = Math.max(run.nodes.findIndex((item) => item.id === node.id), 0);
  const nodeById = new Map(run.nodes.map((item) => [item.id, item]));
  return [
    "- Graph 模式按已规划的 Realized Graph 执行；宿主调度器依据节点、边、状态、依赖、冲突组和人工/系统关卡推进。",
    "- 本节点不是 Loop 主智能体，也不要自行创建或调度子智能体；当前会话只完成本节点在图中的职责。",
    `- 当前节点位置：${currentIndex + 1}/${run.nodes.length}；${node.id}（${node.title}）`,
    `- Graph maxConcurrent：${run.maxConcurrent}`,
    `- 当前 active nodes：${formatList(run.activeNodeIds)}`,
    `- 直接前置节点：${formatNodeReferences(resolveGraphNodes(nodeById, relationships.directDependencyIds))}`,
    `- 直接后续节点：${formatNodeReferences(resolveGraphNodes(nodeById, relationships.directUnlockIds))}`,
    `- 上游链路：${formatNodeReferences(resolveGraphNodes(nodeById, relationships.ancestorIds))}`,
    `- 下游链路：${formatNodeReferences(resolveGraphNodes(nodeById, relationships.descendantIds))}`,
    "",
    "### 节点清单",
    ...formatGraphNodeTopologyLines(run, node),
    "",
    "### 边语义",
    ...formatGraphEdgeSemanticsLines(),
    "",
    "### 边清单",
    ...formatGraphEdgeTopologyLines(run, node),
    "",
    "### 并发与冲突",
    ...formatGraphConcurrencyLines(run, node),
  ];
}

function formatGraphNodeTopologyLines(run: GraphRunRecord, currentNode: GraphNodeRecord): string[] {
  if (run.nodes.length === 0) {
    return ["- Graph nodes 为空；本节点应返回 blocked 并说明 graph.json 不完整。"];
  }
  return run.nodes.map((item) => {
    const marker = item.id === currentNode.id ? "[当前]" : "[全图]";
    return [
      `- ${marker} ${item.id}｜${item.title}`,
      `kind=${item.kind}`,
      `status=${item.status}`,
      `owner=${item.ownerRole}`,
      `modelRole=${formatValue(item.modelRole)}`,
      `model=${formatValue(item.model)}`,
      `modelFallback=${formatValue(item.modelFallback)}`,
      `dependsOn=${formatList(item.dependsOn)}`,
      `unlocks=${formatList(item.unlocks)}`,
      `writeFiles=${formatWriteFiles(item.writeFiles, run)}`,
      `conflictGroup=${formatValue(item.conflictGroup)}`,
      `attempts=${item.attempts}/${item.maxAttempts}`,
      `rework=${formatGraphNodeReworkSummary(item)}`,
      `acceptance=${formatAcceptanceSummary(item.acceptance)}`,
    ].join("；");
  });
}

function formatGraphEdgeTopologyLines(run: GraphRunRecord, currentNode: GraphNodeRecord): string[] {
  if (run.edges.length === 0) {
    return ["- Graph edges 未声明；以 nodes.dependsOn / unlocks 推导的依赖为准。"];
  }
  return run.edges.map((edge) => {
    const marker = edge.from === currentNode.id || edge.to === currentNode.id ? "；关联当前节点" : "";
    return [
      `- ${edge.id}｜${edge.from} -> ${edge.to}`,
      `kind=${edge.kind}`,
      `active=${edge.active}`,
      `label=${formatGraphEdgeLabel(edge)}`,
      `condition=${formatValue(edge.condition)}`,
      `conditionExpression=${formatGraphEdgeConditionExpression(edge.conditionExpression)}`,
      `metadata=${formatGraphEdgeMetadata(edge)}`,
    ].join("；") + marker;
  });
}

function formatGraphEdgeSemanticsLines(): string[] {
  return [
    "- depends_on / human_approved 是结构性前置；上游未 passed 时目标节点不可执行。",
    "- if_pass / if_fail 是条件路径；scheduler 会按上游状态和受支持的 conditionExpression 判定是否可通行，inactive edge 会阻塞并提示需要重规划或人工处理。",
    "- review_feedback / if_fail 可作为返工路径；只有历史 worktree run 且存在 checkpoint 时，Feedback rollback 才能回退到上游节点；direct run 需要在当前工作区手动控制返工范围。",
    "- evidence_for 是证据追踪边，不单独解锁调度；summary/review 节点应引用其 metadata.evidenceRef 或相关 artifact。",
    "- custom conditionExpression 当前只会保守阻塞并说明不可求值，不能伪装为已自动重算复杂谓词。",
  ];
}

function formatGraphConcurrencyLines(run: GraphRunRecord, node: GraphNodeRecord): string[] {
  const nodeById = new Map(run.nodes.map((item) => [item.id, item]));
  const activePeers = run.activeNodeIds
    .filter((nodeId) => nodeId !== node.id)
    .map((nodeId) => nodeById.get(nodeId))
    .filter((item): item is GraphNodeRecord => Boolean(item));
  const sameConflictGroup = node.conflictGroup
    ? run.nodes.filter((item) => item.id !== node.id && item.conflictGroup === node.conflictGroup)
    : [];
  const sameWriteScope = run.nodes.filter((item) => item.id !== node.id && haveSharedWriteFile(item.writeFiles, node.writeFiles));
  return [
    activePeers.length > 0
      ? `- 同批/并发中的其他节点：${formatNodeReferences(activePeers)}`
      : "- 当前快照未显示其他同批 active 节点；仍需按 writeFiles/conflictGroup 防止越权。",
    sameConflictGroup.length > 0
      ? `- 同 conflictGroup 节点：${formatNodeReferences(sameConflictGroup)}`
      : "- 未发现同 conflictGroup 节点。",
    sameWriteScope.length > 0
      ? `- 共享 writeFiles 线索的节点：${formatNodeReferences(sameWriteScope)}`
      : "- 未发现明显共享 writeFiles 的其他节点。",
    "- 即使 scheduler 已尽量避免同批冲突，执行中发现实际路径冲突、锁冲突或语义冲突时，也必须停止扩大写入并返回 blocked。",
  ];
}

function formatGraphNodeBoundaryLines(run: GraphRunRecord, node: GraphNodeRecord): string[] {
  const relationships = collectGraphTopologyRelationships(run, node);
  const nodeById = new Map(run.nodes.map((item) => [item.id, item]));
  const downstreamNodes = resolveGraphNodes(nodeById, relationships.descendantIds)
    .filter((item) => !isTerminalGraphNodeStatus(item.status));
  const downstreamTests = downstreamNodes.filter((item) => item.kind === "test");
  const downstreamReviews = downstreamNodes.filter((item) => item.kind === "review");
  const downstreamMerges = downstreamNodes.filter((item) => item.kind === "merge");
  const downstreamSummaries = downstreamNodes.filter((item) => item.kind === "summary");
  const boundaryLines = [
    "",
    "## Graph 节点边界",
    "- 只完成当前节点的 title、kind、acceptance 和授权写入范围；不要把下游节点的职责提前吞并。",
    "- 如果发现图缺少必要测试、评审、人工批准或返工路径，应在本节点沟通文件写明缺口；只有该缺口使本节点无法安全完成时才返回 blocked。",
    "- 条件边以 graph.json 中的 edge.kind、condition、active 和上游节点状态为准；不要自行发明未在图中声明的新路径。",
  ];
  if (downstreamTests.length > 0) {
    boundaryLines.push(`- 图中已有后续 test 节点：${formatNodeReferences(downstreamTests)}；当前节点只运行满足自身 acceptance 的最小必要检查，不替代这些测试节点完成完整验证。`);
  }
  if (downstreamReviews.length > 0) {
    boundaryLines.push(`- 图中已有后续 review 节点：${formatNodeReferences(downstreamReviews)}；当前节点不要把实现结果包装成最终审查结论。`);
  }
  if (downstreamMerges.length > 0) {
    boundaryLines.push(`- 图中已有后续 merge 节点：${formatNodeReferences(downstreamMerges)}；当前节点不要擅自做跨分支/跨节点收束。`);
  }
  if (downstreamSummaries.length > 0) {
    boundaryLines.push(`- 图中已有后续 summary 节点：${formatNodeReferences(downstreamSummaries)}；当前节点不要生成最终用户结论，只产出本节点证据。`);
  }
  if (downstreamNodes.length === 0) {
    boundaryLines.push("- 当前节点没有未完成下游节点；仍只产出本节点执行证据，Graph 是否完成由宿主根据全图状态判断。");
  }
  return boundaryLines;
}

function collectGraphTopologyRelationships(run: GraphRunRecord, node: GraphNodeRecord): GraphTopologyRelationships {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const item of run.nodes) {
    for (const dependencyId of item.dependsOn) {
      connectGraphTopology(forward, dependencyId, item.id);
      connectGraphTopology(reverse, item.id, dependencyId);
    }
    for (const unlockId of item.unlocks) {
      connectGraphTopology(forward, item.id, unlockId);
      connectGraphTopology(reverse, unlockId, item.id);
    }
  }
  for (const edge of run.edges) {
    connectGraphTopology(forward, edge.from, edge.to);
    connectGraphTopology(reverse, edge.to, edge.from);
  }
  return {
    directDependencyIds: Array.from(reverse.get(node.id) ?? []),
    directUnlockIds: Array.from(forward.get(node.id) ?? []),
    ancestorIds: collectReachableGraphNodeIds(node.id, reverse),
    descendantIds: collectReachableGraphNodeIds(node.id, forward),
  };
}

function connectGraphTopology(adjacency: Map<string, Set<string>>, from: string, to: string): void {
  if (!from.trim() || !to.trim() || from === to) {
    return;
  }
  const existing = adjacency.get(from);
  if (existing) {
    existing.add(to);
    return;
  }
  adjacency.set(from, new Set([to]));
}

function collectReachableGraphNodeIds(startNodeId: string, adjacency: Map<string, Set<string>>): string[] {
  const visited = new Set<string>();
  const queue = Array.from(adjacency.get(startNodeId) ?? []);
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next)) {
      continue;
    }
    visited.add(next);
    for (const child of adjacency.get(next) ?? []) {
      if (!visited.has(child)) {
        queue.push(child);
      }
    }
  }
  return Array.from(visited);
}

function resolveGraphNodes(nodeById: Map<string, GraphNodeRecord>, nodeIds: readonly string[]): GraphNodeRecord[] {
  return nodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((item): item is GraphNodeRecord => Boolean(item));
}

function formatNodeReferences(nodes: readonly GraphNodeRecord[]): string {
  if (nodes.length === 0) {
    return "无";
  }
  const limited = nodes.slice(0, GRAPH_TOPOLOGY_REFERENCE_LIMIT);
  const suffix = nodes.length > limited.length ? ` 等 ${nodes.length} 个节点` : "";
  return `${limited.map((item) => `${item.id}（${item.title}｜${item.kind}｜${item.status}）`).join("、")}${suffix}`;
}

function haveSharedWriteFile(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const leftValues = normalizeStringList(left);
  const rightValues = normalizeStringList(right);
  if (leftValues.length === 0 || rightValues.length === 0) {
    return false;
  }
  if (leftValues.includes("**") || rightValues.includes("**")) {
    return true;
  }
  return leftValues.some((leftValue) => rightValues.some((rightValue) => {
    const leftPrefix = trimGlobSuffix(leftValue);
    const rightPrefix = trimGlobSuffix(rightValue);
    return leftPrefix === rightPrefix || leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
  }));
}

function trimGlobSuffix(value: string): string {
  return value.replace(/\/?\*\*.*$/u, "").replace(/\/?\*.*$/u, "");
}

function formatAcceptanceSummary(acceptance: readonly GraphAcceptanceCheck[] | undefined): string {
  if (!acceptance || acceptance.length === 0) {
    return GRAPH_PROMPT_EMPTY_VALUE;
  }
  return acceptance.map((item) => {
    const required = item.required === false ? "optional" : "required";
    return `${item.name}(${required})`;
  }).join("；");
}

function isTerminalGraphNodeStatus(status: GraphNodeRecord["status"]): boolean {
  return GRAPH_TERMINAL_NODE_STATUSES.has(status);
}

function formatSupplementalRequirementLines(requirements: readonly string[] | undefined): string[] {
  const normalized = Array.isArray(requirements)
    ? requirements.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (normalized.length === 0) {
    return ["- 无"];
  }
  return [
    "- 以下内容是用户在 Graph 运行中补充的最新要求；后续节点必须纳入判断和验收。",
    ...normalized.map((item, index) => `${index + 1}. ${item}`),
  ];
}

function buildGraphAiPlannerPromptTail(): string[] {
  return [
    "## AI Planner 节点专用要求",
    "- 你不是在直接实现任务；你必须先把原始目标编译成一个可执行 Graph DAG。",
    "- Graph 不能固定输出线形 `plan -> implement -> test -> review -> summary`；复杂需求必须拆出并行分支、依赖边、验证节点、评审节点，必要时加入 debate、human_gate、sleep 或 merge 节点。",
    "- 节点粒度要按可独立执行、可验证、可回退来拆；同一文件或同一风险域的写入节点要声明相同 conflictGroup 或重叠 writeFiles，避免并发冲突。",
    "- 每个会写文件的 implement/test/review/merge 节点必须声明 writeFiles；如果无法精确判断路径，用 `[\"**\"]` 并设置保守 conflictGroup。",
    "- 如果任务很小，也至少输出一个非 planner 的 implement/test/review/summary 执行图；如果任务复杂，优先输出多根分支或 fan-out/fan-in 结构。",
    "- plannedGraph.nodes[].title 必须使用简洁中文，禁止英文整句标题；API、HTML、Graph、DAG 等技术缩写可以保留，但业务含义必须中文表达。",
    "- plannedGraph.nodes 不得包含保留 ID `plan`；宿主会保留当前 planner 节点，并自动让无依赖节点依赖 `plan`。",
    "- 如果 plannedGraph 没有 summary 节点，宿主会自动补一个 summary 节点收束叶子节点。",
    "",
    "## plannedGraph JSON Schema",
    "- Plan JSON 必须额外包含 `plannedGraph`：",
    JSON.stringify({
      status: "passed",
      summary: "规划完成，生成可执行 Graph DAG。",
      plannedGraph: {
        maxConcurrent: 4,
        nodes: [{
          id: "implement-api",
          title: "实现 API 改动",
          kind: "implement",
          ownerRole: "subtask",
          writeFiles: ["src/api/**"],
          conflictGroup: "api",
          maxAttempts: 2,
          dependsOn: [],
          acceptance: [{ name: "API 改动已实现且范围受控。", required: true }],
        }, {
          id: "test-api",
          title: "验证 API 行为",
          kind: "test",
          ownerRole: "subtask",
          writeFiles: ["src/test/**"],
          dependsOn: ["implement-api"],
          acceptance: [{ name: "相关 API 测试通过，或失败原因已记录。", required: true }],
        }, {
          id: "review-api",
          title: "评审 API 结果",
          kind: "review",
          ownerRole: "reviewer",
          dependsOn: ["test-api"],
          acceptance: [{ name: "评审覆盖正确性、范围和残余风险。", required: true }],
        }],
        edges: [{
          from: "implement-api",
          to: "test-api",
          kind: "depends_on",
        }, {
          from: "test-api",
          to: "review-api",
          kind: "if_pass",
          label: "测试通过后评审",
          condition: "test-api 必须通过",
          conditionExpression: {
            type: "source_status",
            operator: "equals",
            status: "passed",
            description: "测试节点 passed 后才进入评审。",
          },
        }, {
          from: "review-api",
          to: "implement-api",
          kind: "review_feedback",
          label: "评审失败返工实现",
          metadata: {
            feedbackReason: "评审或验证失败时只返工 API 实现分支。",
            reworkTargetNodeId: "implement-api",
            reworkScopeNodeIds: ["implement-api", "test-api", "review-api"],
          },
        }, {
          from: "test-api",
          to: "review-api",
          kind: "evidence_for",
          metadata: {
            evidenceRef: "test-api artifact",
            rationale: "测试结果作为评审和 summary 的证据来源。",
          },
        }],
      },
      acceptance: [{ name: "plannedGraph 可执行；复杂需求已按需拆成非线形 DAG；结构符合 schema。", passed: true, required: true }],
    }),
    "- 允许的 node.kind：intake、plan、implement、test、review、debate、human_gate、merge、sleep、summary。",
    "- 允许的 edge.kind：depends_on、if_pass、if_fail、review_feedback、conflicts_with、evidence_for、human_approved。",
    "- edge.condition 可写人类可读说明；edge.conditionExpression 当前支持 source_status、source_acceptance、manual 的有限求值；custom 表达式会保守阻塞，需后续重规划或人工处理。",
    "- review_feedback / if_fail 返工边可用 metadata.feedbackReason、metadata.reworkTargetNodeId、metadata.reworkScopeNodeIds 说明返工目标与预期影响范围。",
    "- evidence_for 边可用 metadata.evidenceRef、metadata.rationale 说明证据来源；它是追踪信号，不替代 depends_on。",
  ];
}

function isAiPlannerNode(run: GraphRunRecord, node: GraphNodeRecord): boolean {
  return node.id === GRAPH_AI_PLANNER_NODE_ID && node.kind === "plan" && run.nodes.length === 1;
}

function formatDependencyLines(run: GraphRunRecord, node: GraphNodeRecord): string[] {
  if (node.dependsOn.length === 0) {
    return ["- dependsOn 未声明；本节点无显式前置节点。"];
  }
  const nodeById = new Map(run.nodes.map((item) => [item.id, item]));
  return node.dependsOn.map((dependencyId) => {
    const dependency = nodeById.get(dependencyId);
    if (!dependency) {
      return `- ${dependencyId}：未在 Graph nodes 中找到；如该依赖是必需项，应返回 blocked。`;
    }
    return `- ${dependency.id}：${dependency.title}｜kind=${dependency.kind}｜status=${dependency.status}｜artifactRef=${formatValue(dependency.artifactRef)}`;
  });
}

function formatAcceptanceLines(acceptance: readonly GraphAcceptanceCheck[] | undefined): string[] {
  if (!acceptance || acceptance.length === 0) {
    return ["- 未声明 acceptance；仍必须给出可验证的执行结果、证据和遗留问题。"];
  }
  return acceptance.map((item, index) => {
    const required = item.required === false ? "optional" : "required";
    const evidence = item.evidenceRef ? `；evidenceRef=${item.evidenceRef}` : "";
    const detail = item.detail ? `；detail=${item.detail}` : "";
    return `- ${index + 1}. ${item.name}（${required}）${detail}${evidence}`;
  });
}

function formatGraphNodeReworkLines(node: GraphNodeRecord): string[] {
  if (!node.rework) {
    return [
      `- Rework source：${GRAPH_PROMPT_EMPTY_VALUE}`,
      `- Rework reason：${GRAPH_PROMPT_EMPTY_VALUE}`,
      `- Rework scope：${GRAPH_PROMPT_EMPTY_VALUE}`,
    ];
  }
  return [
    `- Rework source：${node.rework.sourceNodeId}`,
    `- Rework target：${node.rework.targetNodeId}`,
    `- Rework reset at：${node.rework.resetAt}`,
    `- Rework scope：${formatList(node.rework.resetScopeNodeIds)}`,
    `- Rework reason：${formatValue(node.rework.reason)}`,
    `- Rework edge：${formatValue(node.rework.edgeId)}${node.rework.edgeKind ? `｜${node.rework.edgeKind}` : ""}`,
  ];
}

function formatGraphNodeReworkSummary(node: GraphNodeRecord): string {
  if (!node.rework) {
    return GRAPH_PROMPT_EMPTY_VALUE;
  }
  return [
    `source=${node.rework.sourceNodeId}`,
    `target=${node.rework.targetNodeId}`,
    `scope=${node.rework.resetScopeNodeIds.join(",")}`,
    `reason=${node.rework.reason ?? GRAPH_PROMPT_EMPTY_VALUE}`,
  ].join("；");
}

function formatGraphEdgeLabel(edge: GraphEdgeRecord): string {
  return formatValue(edge.label ?? edge.metadata?.label);
}

function formatGraphEdgeConditionExpression(expression: GraphEdgeConditionExpression | undefined): string {
  if (!expression) {
    return GRAPH_PROMPT_EMPTY_VALUE;
  }
  const parts = [
    `type=${expression.type}`,
    expression.operator ? `operator=${expression.operator}` : "",
    expression.status ? `status=${expression.status}` : "",
    expression.statuses && expression.statuses.length > 0 ? `statuses=${expression.statuses.join(",")}` : "",
    expression.acceptanceId ? `acceptanceId=${expression.acceptanceId}` : "",
    expression.expected !== undefined ? `expected=${String(expression.expected)}` : "",
    expression.description ? `description=${expression.description}` : "",
  ].filter(Boolean);
  return parts.join("；");
}

function formatGraphEdgeMetadata(edge: GraphEdgeRecord): string {
  const metadata = edge.metadata;
  if (!metadata) {
    return GRAPH_PROMPT_EMPTY_VALUE;
  }
  const parts = [
    metadata.rationale ? `rationale=${metadata.rationale}` : "",
    metadata.evidenceRef ? `evidenceRef=${metadata.evidenceRef}` : "",
    metadata.feedbackReason ? `feedbackReason=${metadata.feedbackReason}` : "",
    metadata.reworkTargetNodeId ? `reworkTargetNodeId=${metadata.reworkTargetNodeId}` : "",
    metadata.reworkScopeNodeIds && metadata.reworkScopeNodeIds.length > 0 ? `reworkScopeNodeIds=${metadata.reworkScopeNodeIds.join(",")}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("；") : GRAPH_PROMPT_EMPTY_VALUE;
}

function formatValidationRequirementLines(requirements: readonly string[] | undefined): string[] {
  const normalized = (requirements ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    return [
      "- 运行能直接证明本节点结果的最小必要检查；涉及代码改动时优先运行相关 build/test。",
      "- 如果验证无法运行，必须记录命令、失败原因、影响范围和后续最小恢复动作。",
    ];
  }
  return normalized.map((item) => `- ${item}`);
}

function formatExtraInstructionLines(instructions: readonly string[] | undefined): string[] {
  const normalized = (instructions ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    return [];
  }
  return [
    "",
    "## 额外指令",
    ...normalized.map((item) => `- ${item}`),
  ];
}

function formatList(values: readonly string[] | undefined): string {
  const normalized = normalizeStringList(values);
  return normalized.length > 0 ? normalized.join("、") : GRAPH_PROMPT_EMPTY_VALUE;
}

function formatGraphRunModelRoutingLines(run: GraphRunRecord): string[] {
  const planner = run.modelRouting?.planner;
  const executor = run.modelRouting?.executor;
  return [
    `- Planner model role：${formatValue(planner?.role)}`,
    `- Planner model used：${formatValue(planner?.model)}`,
    `- Planner model fallback：${formatValue(planner?.fallback)}`,
    `- Execution node model role：${formatValue(executor?.role)}`,
    `- Execution node model used：${formatValue(executor?.model)}`,
    `- Execution node model fallback：${formatValue(executor?.fallback)}`,
  ];
}

function formatGraphExecutionMode(run: GraphRunRecord): string {
  return run.executionMode === "direct" && run.directExecution?.cwd
    ? "direct project workspace"
    : "isolated git worktree";
}

function formatGraphExecutionCwd(run: GraphRunRecord): string {
  return run.executionMode === "direct" && run.directExecution?.cwd
    ? run.directExecution.cwd
    : formatValue(run.worktree?.cwd);
}

function formatGraphExecutionBoundaryLines(run: GraphRunRecord): string[] {
  if (run.executionMode === "direct" && run.directExecution?.cwd) {
    return [
      "- 当前 Graph run 在项目工作区直接执行，行为与 Loop 主任务一样落在当前 workspace。",
      "- 只能在当前工作区中修改 writeFiles 明确列出的路径；如果 writeFiles 未声明，本节点默认不得修改工作区文件。",
      "- direct 模式没有 Graph worktree 隔离、checkpoint commit、自动 merge-back 或 rollback；必须格外控制改动范围并记录验证结果。",
    ];
  }
  return [
    "- 这是历史 worktree Graph run；只能在 Graph worktree 中修改 writeFiles 明确列出的路径。",
    "- 不要直接修改主工作区；宿主会在节点结束后为当前 worktree 创建本地 git checkpoint commit。",
  ];
}

function formatWriteFiles(values: readonly string[] | undefined, run?: GraphRunRecord): string {
  const normalized = normalizeStringList(values);
  if (normalized.includes("**")) {
    return run?.executionMode === "direct" && run.directExecution?.cwd
      ? "整个当前工作区"
      : "整个 Graph worktree";
  }
  return normalized.length > 0 ? normalized.join("、") : GRAPH_PROMPT_EMPTY_VALUE;
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  return (values ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatValue(value: string | undefined): string {
  return value?.trim() ? value.trim() : GRAPH_PROMPT_EMPTY_VALUE;
}
