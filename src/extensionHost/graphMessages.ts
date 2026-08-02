import type { LoopTaskRole } from "../promptRunState";
import type { ChatMessage, ChatMessageAction } from "../webview/types";
import type { GraphNodeExecutionRequest } from "../graph/graphKernel";
import { GRAPH_AI_PLANNER_NODE_ID } from "../graph/graphPlanner";
import type { GraphFinalAnswer, GraphNodeRecord, GraphRunRecord } from "../graph/types";
import type { PromptRunTarget } from "./graphRuntime";

export type GraphRuntimeMessageKey =
	  | "continueAccepted"
	  | "continueStarted"
	  | "controlRejected"
	  | "feedbackAccepted"
	  | "feedbackStarted"
	  | "noRunnableNode"
  | "resumePrompt"
  | "retryAccepted"
  | "retryStarted"
  | "runMissing"
  | "runReadFailed"
  | "skipAccepted"
  | "skipStarted"
  | "stopAccepted"
  | "stopRequested"
  | "stopStateOnly"
  | "stopWithCli"
  | "supplementAccepted"
  | "supplementEmpty"
  | "supplementUnavailable"
  | "targetBusy"
  | "targetMissing";



export type GraphRunMergeBackMessageOutcome = {
  run: GraphRunRecord;
  status: "merged" | "direct" | "failed";
  message: string;
};

export type GraphMessagesHostDeps = {
  resolveLocale: () => string;
  getGraphNodeRunTarget: (tabId: string) => { graphRunId: string; graphNodeId: string } | undefined;
  getLoopMessagesForTarget: (target: PromptRunTarget) => ChatMessage[];
  appendSystemMessageForLoop: (
    target: PromptRunTarget,
    content: string,
    options?: {
      taskRole?: LoopTaskRole;
      loopTaskId?: string;
      loopRound?: number;
      loopSubtaskId?: string;
      actions?: ChatMessageAction[];
      merge?: boolean;
    },
  ) => void;
  appendMessageToStore: (messages: ChatMessage[], message: ChatMessage) => void;
  sendPanelMessage: (payload: Record<string, unknown>) => void;
  persistLoopMessagesForTarget: (target: PromptRunTarget, messages: ChatMessage[]) => void;
  createMessageId: () => string;
};

export function createGraphMessagesHost(deps: GraphMessagesHostDeps) {
function formatGraphControlBlockedReason(reason: string | undefined, fallback: string): string {
  const zh = deps.resolveLocale() === "zh-CN";
  const messages: Record<string, string> = zh ? {
    already_running: "运行已在执行中",
    already_stopped: "运行已停止",
    completed_run: "已完成的运行不能继续操作",
	    terminal_run: "终态运行不能继续操作",
	    not_resumable: "当前状态不可继续",
	    node_not_found: "节点不存在",
	    node_not_retryable: "节点当前不可重试",
	    node_not_skippable: "节点当前不可跳过",
	    feedback_not_available: "该节点当前没有可回退的上游 checkpoint；direct 模式不支持 Feedback rollback",
	    passed_descendants: "该节点已有通过的下游节点，需要后续级联重置能力",
	    worktree_reset_failed: "Graph worktree 回退失败",
	  } : {
    already_running: "The run is already running.",
    already_stopped: "The run is already stopped.",
    completed_run: "Completed runs cannot be changed.",
	    terminal_run: "Terminal runs cannot be changed.",
	    not_resumable: "The run is not resumable from its current status.",
	    node_not_found: "The node was not found.",
	    node_not_retryable: "The node is not retryable from its current status.",
	    node_not_skippable: "The node is not skippable from its current status.",
	    feedback_not_available: "The node has no available upstream checkpoint; direct mode does not support Feedback rollback.",
	    passed_descendants: "The node has passed descendants and needs a later cascade reset flow.",
	    worktree_reset_failed: "The Graph worktree could not be reset.",
	  };
  return reason ? (messages[reason] ?? fallback) : fallback;
}


function graphRuntimeMessage(
  key: GraphRuntimeMessageKey,
  params: Record<string, string | number | undefined> = {},
): string {
  const zh = deps.resolveLocale() === "zh-CN";
  const graphRunId = String(params.graphRunId ?? "");
  const detail = String(params.detail ?? "");
  const count = String(params.count ?? "");
	  const messages: Record<GraphRuntimeMessageKey, string> = zh ? {
	    continueAccepted: "Graph 继续请求已记录。",
	    continueStarted: `Graph 运行已继续：${graphRunId}`,
	    controlRejected: `Graph 操作未执行：${detail}`,
	    feedbackAccepted: "Graph 上游返工回退请求已记录。",
	    feedbackStarted: `Graph 已回退上游节点并继续运行：${graphRunId}`,
	    noRunnableNode: `Graph 运行没有可执行节点，已刷新面板：${graphRunId}`,
    resumePrompt: `继续 Graph 运行：${graphRunId}`,
    retryAccepted: "节点重试请求已记录。",
    retryStarted: `Graph 节点已重试并继续运行：${graphRunId}`,
    runMissing: `找不到 Graph 运行：${graphRunId}`,
    runReadFailed: `Graph 运行读取失败：${graphRunId}\n${detail}`.trim(),
    skipAccepted: "节点跳过请求已记录。",
    skipStarted: `Graph 已跳过阻塞节点并继续下游：${graphRunId}`,
    stopAccepted: "Graph 停止请求已记录。",
    stopRequested: "Graph 运行已由用户请求停止。",
    stopStateOnly: `Graph 运行状态已落盘为 stopped：${graphRunId}。未找到活动 CLI 进程映射；真实 CLI 进程未被确认停止。`,
    stopWithCli: `Graph 运行状态已落盘为 stopped：${graphRunId}。已向 ${count} 个已映射活动 CLI 运行发送停止请求；真实进程是否退出取决于底层 CLI 响应。`,
    supplementAccepted: "Graph 补充消息已记录，后续节点会读取。",
    supplementEmpty: "补充消息不能为空。",
    supplementUnavailable: "已完成或已停止的 Graph 运行不能补充消息。",
    targetBusy: `Graph 运行目标标签页当前有任务在执行：${graphRunId}`,
    targetMissing: `无法为 Graph 运行找到可用执行标签页：${graphRunId}`,
	  } : {
	    continueAccepted: "The Graph continue request was recorded.",
	    continueStarted: `Graph run continued: ${graphRunId}`,
	    controlRejected: `Graph action was not run: ${detail}`,
	    feedbackAccepted: "The Graph upstream feedback rollback request was recorded.",
	    feedbackStarted: `Graph upstream feedback rollback started and the run continued: ${graphRunId}`,
	    noRunnableNode: `Graph run has no executable node; the panel was refreshed: ${graphRunId}`,
    resumePrompt: `Continue Graph run: ${graphRunId}`,
    retryAccepted: "The node retry request was recorded.",
    retryStarted: `Graph node retry started and the run continued: ${graphRunId}`,
    runMissing: `Graph run was not found: ${graphRunId}`,
    runReadFailed: `Graph run could not be read: ${graphRunId}\n${detail}`.trim(),
    skipAccepted: "The node skip request was recorded.",
    skipStarted: `Graph skipped the blocked node and continued downstream: ${graphRunId}`,
    stopAccepted: "The Graph stop request was recorded.",
    stopRequested: "Graph run stop was requested by the user.",
    stopStateOnly: `Graph run state was persisted as stopped: ${graphRunId}. No active CLI process mapping was found; no real CLI process stop was confirmed.`,
    stopWithCli: `Graph run state was persisted as stopped: ${graphRunId}. Sent stop requests to ${count} mapped active CLI run(s); real process exit depends on the underlying CLI response.`,
    supplementAccepted: "The Graph supplemental message was recorded for later nodes.",
    supplementEmpty: "The supplemental message cannot be empty.",
    supplementUnavailable: "Completed or stopped Graph runs cannot accept supplemental messages.",
    targetBusy: `The Graph run target tab is currently busy: ${graphRunId}`,
    targetMissing: `No executable tab could be found for Graph run: ${graphRunId}`,
  };
  return messages[key];
}


function buildGraphRunFinalAnswer(run: GraphRunRecord): GraphFinalAnswer {
  const completedNodes = run.nodes
    .filter((node) => node.status === "passed")
    .map((node) => `${node.id}:${node.title}`);
  const unresolved = run.nodes
    .filter((node) => node.kind !== "summary" && node.status !== "passed")
    .map((node) => `${node.id}:${node.status}`);
  return {
    conclusion: unresolved.length === 0
      ? "Graph run completed its AI-planned DAG runtime path."
      : "Graph run completed summary with unresolved node state.",
    summary: `Graph run ${run.id} executed an AI-planned Graph DAG through the existing CLI runner path.`,
    evidence: completedNodes,
    unresolved,
  };
}

function buildGraphRunMessageAction(
  graphRunId: string,
  nodeId?: string | null,
  label?: string | null,
): ChatMessageAction {
  return {
    type: "openGraphRun",
    graphRunId,
    ...(nodeId ? { nodeId } : {}),
    ...(label ? { label } : {}),
  };
}

function isTargetedGraphMessageAction(nodeId?: string | null, actionLabel?: string | null): boolean {
  return Boolean(nodeId && actionLabel?.trim());
}

function isPlainGraphRunOpenAction(action: ChatMessageAction, graphRunId: string): boolean {
  return action.type === "openGraphRun"
    && action.graphRunId === graphRunId
    && !action.nodeId
    && !action.label;
}

function isGraphNodeRunTarget(
  target: PromptRunTarget,
  graphRunId: string,
  messages: readonly ChatMessage[],
): boolean {
  const nodeTarget = deps.getGraphNodeRunTarget(target.tabId);
  if (nodeTarget?.graphRunId === graphRunId) {
    return true;
  }
  return messages.some((message) => (
    message.graphRunId === graphRunId
    && Boolean(message.graphNodeId)
  ));
}

function hasVisibleGraphRunOpenActionForTarget(
  messages: readonly ChatMessage[],
  graphRunId: string,
): boolean {
  return messages.some((message) => (
    Array.isArray(message.actions)
    && message.actions.some((action) => isPlainGraphRunOpenAction(action, graphRunId))
  ));
}

function resolveGraphSystemMessageActions(
  target: PromptRunTarget,
  graphRunId?: string | null,
  nodeId?: string | null,
  actionLabel?: string | null,
): ChatMessageAction[] {
  if (!graphRunId) {
    return [];
  }
  if (isTargetedGraphMessageAction(nodeId, actionLabel)) {
    return [buildGraphRunMessageAction(graphRunId, nodeId, actionLabel)];
  }
  const messages = deps.getLoopMessagesForTarget(target);
  if (
    isGraphNodeRunTarget(target, graphRunId, messages)
    || hasVisibleGraphRunOpenActionForTarget(messages, graphRunId)
  ) {
    return [];
  }
  return [buildGraphRunMessageAction(graphRunId)];
}

function appendSystemMessageForGraph(
  target: PromptRunTarget,
  content: string,
  graphRunId?: string | null,
  nodeId?: string | null,
  actionLabel?: string | null,
): void {
  const actions = resolveGraphSystemMessageActions(target, graphRunId, nodeId, actionLabel);
  deps.appendSystemMessageForLoop(target, content, {
    merge: false,
    ...(actions.length ? { actions } : {}),
  });
}

function buildGraphNodeDispatchedText(
  run: GraphRunRecord,
  node: GraphNodeExecutionRequest["node"],
  graphNodeTarget: PromptRunTarget,
  communicationFile: string,
): string {
  return [
    `Graph 节点已派发：${node.id}`,
    "",
    `- 运行：${run.id}`,
    `- 节点：${node.title}`,
    `- 子任务 tab：${graphNodeTarget.tabId}`,
    `- 并行上限：${run.maxConcurrent}`,
    `- 执行模式：${formatGraphRunExecutionMode(run)}`,
    `- 执行目录：${formatGraphRunExecutionCwd(run)}`,
    `- 沟通文件：${communicationFile}`,
  ].join("\n");
}

function buildGraphNodeStartedText(
  run: GraphRunRecord,
  node: GraphNodeExecutionRequest["node"],
  communicationFile: string,
): string {
  return [
    `Graph 子节点开始执行：${node.id}`,
    "",
    `- 运行：${run.id}`,
    `- 节点标题：${node.title}`,
    `- 节点类型：${node.kind}`,
    `- 执行模式：${formatGraphRunExecutionMode(run)}`,
    `- 执行目录：${formatGraphRunExecutionCwd(run)}`,
    `- 授权文件：${node.writeFiles?.length ? node.writeFiles.join("、") : "未声明"}`,
    `- 沟通文件：${communicationFile}`,
  ].join("\n");
}

function formatGraphRunExecutionMode(run: GraphRunRecord): string {
  return run.executionMode === "direct" && run.directExecution?.cwd
    ? "direct project workspace"
    : "isolated git worktree";
}

function formatGraphRunExecutionCwd(run: GraphRunRecord): string {
  return run.executionMode === "direct" && run.directExecution?.cwd
    ? run.directExecution.cwd
    : (run.worktree?.cwd ?? "unavailable");
}

function buildGraphRunStartedText(run: GraphRunRecord): string {
  const executionLines = run.executionMode === "direct" && run.directExecution
    ? [
      `- Execution directory: ${run.directExecution.cwd}`,
      "- Worktree: not used; changes are written directly to the current project workspace.",
    ]
    : [
      `- Worktree: ${run.worktree?.cwd ?? "unavailable"}`,
    ];
  return [
    `Graph run created: ${run.id}`,
    "",
    `- Planner: ${GRAPH_AI_PLANNER_NODE_ID} will generate the executable DAG before work nodes run.`,
    `- Runtime: ${formatGraphRunExecutionMode(run)} via runPrompt, planner=main, execution=subtask`,
    ...executionLines,
    `- Scheduler: maxConcurrent=${run.maxConcurrent}`,
    `- Graph file: ${run.graphFile}`,
  ].join("\n");
}

function buildGraphRunCompletedText(run: GraphRunRecord, mergeBack?: GraphRunMergeBackMessageOutcome): string {
  return [
    `Graph run completed: ${run.id}`,
    "",
    run.finalAnswer?.summary ?? "AI-planned Graph runtime path completed.",
    ...(mergeBack ? [mergeBack.message] : []),
  ].join("\n");
}

function buildGraphFinalSummaryMarkdown(run: GraphRunRecord): string {
  const finalAnswer = run.finalAnswer ?? buildGraphRunFinalAnswer(run);
  const evidence = finalAnswer.evidence.length
    ? finalAnswer.evidence
    : ["无可用证据引用。"];
  const unresolved = finalAnswer.unresolved.length
    ? finalAnswer.unresolved
    : ["无。"];
  const summarySource = run.finalAnswer
    ? "summary 节点 finalAnswer（主模型）"
    : "宿主 fallback（summary 节点未提供 finalAnswer）";
  const lines: string[] = [
    "# Graph 任务最终总结",
    "",
    `- Graph 运行 ID：${run.id}`,
    `- 会话 ID：${run.sessionId ?? "unknown"}`,
    `- 生成时间：${new Date().toISOString()}`,
    `- 总结来源：${summarySource}`,
    "",
    "## 问题回答结论",
    finalAnswer.conclusion,
    "",
    "## 任务总结",
    finalAnswer.summary,
    "",
    "## 验证证据",
    ...evidence.map((item) => `- ${item}`),
    "",
    "## 未完成事项",
    ...unresolved.map((item) => `- ${item}`),
  ];
  return `${lines.join("\n")}\n`;
}

function buildGraphRunNeedsAttentionText(run: GraphRunRecord, mergeBack?: GraphRunMergeBackMessageOutcome): string {
  const blockedNodes = run.nodes
    .filter((node) => node.status === "blocked" || node.status === "failed" || node.status === "sleeping")
    .map(formatGraphNodeAttentionSummary);
  return [
    `Graph run needs attention: ${run.id}`,
    "",
    `- Status: ${run.status}`,
    `- Nodes: ${blockedNodes.length ? blockedNodes.join(", ") : "No blocked node details recorded."}`,
    `- Graph file: ${run.graphFile}`,
    ...(mergeBack ? [mergeBack.message] : []),
  ].join("\n");
}

function buildGraphRunIdleText(run: GraphRunRecord): string {
  const baseLines = [
    `Graph run paused for review: ${run.id}`,
    "",
    "- Status: no runnable node remained while the run was still active.",
    `- Graph file: ${run.graphFile}`,
  ];
  const attentionNodes = run.nodes
    .filter((node) => node.status === "blocked" || node.status === "failed" || node.status === "sleeping");
  if (!attentionNodes.some((node) => Boolean(node.failure))) {
    return baseLines.join("\n");
  }
  return [
    ...baseLines,
    `- Nodes: ${attentionNodes.map(formatGraphNodeAttentionSummary).join(", ")}`,
  ].join("\n");
}

function formatGraphNodeAttentionSummary(node: GraphNodeRecord): string {
  const failure = formatGraphFailureClassificationForAttention(node);
  return `${node.id}:${node.status}${failure ? ` ${failure}` : ""}${node.lastError ? ` (${node.lastError})` : ""}`;
}

function formatGraphFailureClassificationForAttention(node: GraphNodeRecord): string | null {
  const failure = node.failure;
  if (!failure) {
    return null;
  }
  const parts = [
    `[${failure.category}/${failure.confidence}]`,
    failure.summary,
  ];
  if (failure.signals.length > 0) {
    parts.push(`signals=${formatGraphAttentionList(failure.signals)}`);
  }
  if (typeof failure.attemptsExhausted === "boolean") {
    parts.push(`attemptsExhausted=${failure.attemptsExhausted}`);
  }
  const recovery = failure.recommendedRecovery;
  if (recovery) {
    const recoveryParts = [
      `recommendedRecovery=${recovery.action}`,
      recovery.summary,
    ];
    if (recovery.targetNodeId) {
      recoveryParts.push(`targetNode=${recovery.targetNodeId}`);
    }
    if (recovery.recommendedWriteFiles?.length) {
      recoveryParts.push(`recommendedWriteFiles=${formatGraphAttentionList(recovery.recommendedWriteFiles)}`);
    }
    if (recovery.nodeDraft?.id) {
      recoveryParts.push(`nodeDraft=${recovery.nodeDraft.id}`);
    }
    parts.push(recoveryParts.join("; "));
  }
  return parts.filter(Boolean).join("; ");
}

function formatGraphAttentionList(values: readonly string[], limit = 3): string {
  const visible = values.slice(0, limit);
  const suffix = values.length > visible.length ? ` +${values.length - visible.length} more` : "";
  return `${visible.join(", ")}${suffix}`;
}

function buildGraphRunErrorText(graphRunId: string | null, error: string): string {
  return [
    `Graph run error${graphRunId ? `: ${graphRunId}` : ""}`,
    "",
    error,
  ].join("\n");
}


function appendGraphFinalSummaryMessage(target: PromptRunTarget, run: GraphRunRecord): void {
  const messages = deps.getLoopMessagesForTarget(target);
  const content = buildGraphFinalSummaryMarkdown(run);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!existing || !isGraphFinalSummaryMessageForRun(existing, run.id)) {
      continue;
    }
    if (existing.content.trim() === content.trim()) {
      return;
    }
    const replacement: ChatMessage = {
      ...existing,
      content,
      merge: false,
      taskRole: "main",
      graphRunId: run.id,
      graphFinalSummary: true,
    };
    messages[index] = replacement;
    deps.sendPanelMessage({ type: "replaceMessage", message: replacement, tabId: target.tabId });
    deps.persistLoopMessagesForTarget(target, messages);
    return;
  }

  const message: ChatMessage = {
    id: deps.createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    graphRunId: run.id,
    graphFinalSummary: true,
  };
  deps.appendMessageToStore(messages, message);
  deps.sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  deps.persistLoopMessagesForTarget(target, messages);
}

function isGraphFinalSummaryMessageForRun(message: ChatMessage, graphRunId: string): boolean {
  return message.role === "assistant"
    && message.graphFinalSummary === true
    && message.graphRunId === graphRunId;
}



  return {
    graphRuntimeMessage,
    formatGraphControlBlockedReason,
    buildGraphRunFinalAnswer,
    buildGraphRunMessageAction,
    appendSystemMessageForGraph,
    buildGraphNodeDispatchedText,
    buildGraphNodeStartedText,
    formatGraphRunExecutionMode,
    formatGraphRunExecutionCwd,
    buildGraphRunStartedText,
    buildGraphRunCompletedText,
    buildGraphFinalSummaryMarkdown,
    buildGraphRunNeedsAttentionText,
    buildGraphRunIdleText,
    buildGraphRunErrorText,
    appendGraphFinalSummaryMessage,
  };
}

export type GraphMessagesHost = ReturnType<typeof createGraphMessagesHost>;
