import * as vscode from "vscode";
import {
  getAutoAddEditorContextTags,
  getDebugLogging,
  getMacTaskShell,
} from "./cli/config";
import { isInteractiveSupported } from "./cli/config";
import { getLocaleSetting, t, type AppLocale } from "./i18n";
import { CLI_LIST, CliName, MacTaskShell, normalizeLoopExecutionMode } from "./cli/types";
import { type LoopTaskRole } from "./promptRunState";
import {
  buildPromptWithAutoContextFromEditor,
  maybeInjectLongTermMemoryForPromptWithDeps,
  type ActiveEditorPromptContext,
  type PromptContextBuildResult,
} from "./promptRuntime";
import {
  ChatMessage,
  ChatMessageAction,
  PanelState,
  EditorContextState,
  ConversationTabSummary,
  PromptContextOptions,
  PromptHistoryItem,
  SessionSummary,
} from "./webview/types";
import {
  type LoopDebateChatPanelRound,
  type LoopDebateChatPanelState,
} from "./webview/loopDebatePanel";
import {
  formatGraphEdgeKind,
  formatGraphNodeKind,
  formatGraphNodeStatus,
  formatGraphOwnerRole,
  formatGraphRunStatus,
  type GraphRunPanelStrings,
} from "./webview/graphRunPanelRenderer";
import type {
  GraphRunPanelEvent,
  GraphRunPanelEdge,
  GraphRunPanelNode,
  GraphRunPanelState,
} from "./webview/graphRunPanelTypes";
import {
  GRAPH_NODE_STATUSES,
  type GraphEdgeRecord,
  type GraphEventRecord,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "./graph/types";
import { formatGraphNodeTitleInChinese } from "./graph/graphNodeTitles";
import { getGraphRunControlState } from "./graph/graphRunControl";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import { type WorkspaceMemoryPaths } from "./memory/memoryPaths";
import { type MemoryRuntimeGateSettings } from "./memory/runtimeGate";
import {
  buildLoopGroupChatFinalStatusSection,
  buildLoopMainSubChatTranscriptFile,
  buildLoopMainSubSubtaskTurnBody,
  formatLoopGroupChatMemberName,
  LOOP_DEBATE_MAX_DIALOGUE_TURNS,
  LOOP_MAIN_SUB_CHAT_ROUND_KEY,
  parseLoopDebateChatTranscript,
  resolveLoopTaskRunControlState,
} from "./loopDebate";
import {
  type LoopRoundRecord,
  type LoopSubtaskRecord,
  type LoopTaskRecord,
} from "./loopTaskStore";
import {
  LOOP_MAIN_AI_FAILURE_LIMIT,
  normalizeLoopMainAiFailureCount,
} from "./loopMainFailure";
import {
  describeLoopExecutionPlan,
  type LoopSubtaskExecutionPlan,
} from "./loopParallel";

type PanelConfiguration = Pick<vscode.WorkspaceConfiguration, "get">;

const SESSION_LABEL_LIMIT = 16;

export type LoopConversationTabContext = {
  taskRole: LoopTaskRole | null;
  loopTaskId: string | null;
};

export type LoopSubtaskConversationContext = {
  taskId: string;
  subtaskId: string;
  round: number;
};

export type PanelStateBuilderDeps = {
  currentCli: CliName;
  configState: PanelState["configState"];
  workspaceSettings: WorkspaceSettings;
  processPlatform: NodeJS.Platform;
  cliRulePathsGlobal: Record<CliName, string>;
  getWorkspaceConfiguration: () => PanelConfiguration;
  getAutoAddEditorContextTags: typeof getAutoAddEditorContextTags;
  getEffectiveLongTermMemoryEnabled: () => boolean;
  getGlobalAutoCompactContextAfterRun: () => boolean;
  getGlobalMultiAgentEnabled: () => boolean;
  getGlobalLoopMaxRounds: () => number;
  getGlobalLoopSubtaskMaxThinkingMode: () => PanelState["loopSubtaskMaxThinkingMode"];
  buildWorkspaceLoopExecutionModeByCli: () => PanelState["loopExecutionModeByCli"];
  getDebugLogging: typeof getDebugLogging;
  getLocaleSetting: typeof getLocaleSetting;
  getMacTaskShell: typeof getMacTaskShell;
  getEffectiveThinkingMode: (cli: CliName, model: string | null) => PanelState["thinkingMode"];
  openCodeThinking: PanelState["openCodeThinking"];
  openCodeSmallThinking?: PanelState["openCodeSmallThinking"];
  openCodeModels?: PanelState["openCodeModels"];
  getWorkspaceInteractiveMode: (cli: CliName) => PanelState["interactiveMode"];
  isInteractiveSupported: typeof isInteractiveSupported;
  getProjectRulePaths: () => Record<CliName, string | null>;
  buildSessionState: (cli: CliName) => { currentSessionId: string | null; sessions: SessionSummary[] };
  buildConversationTabsState: () => { activeTabId: string | null; tabs: ConversationTabSummary[] };
  buildPromptHistoryState: () => PromptHistoryItem[];
  buildModelState: (activeConfigIdByCli?: Partial<Record<CliName, string | null>>) => PanelState["modelState"];
  buildEditorContextState: () => EditorContextState;
  resolveModelConfigIdForCli: (cli: CliName, configState?: PanelState["configState"]) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
};

export function buildPanelStateWithDeps(deps: PanelStateBuilderDeps): PanelState {
  const config = deps.getWorkspaceConfiguration();
  const modelConfigId = deps.resolveModelConfigIdForCli(deps.currentCli, deps.configState);
  const activeConfigIdByCli: Partial<Record<CliName, string | null>> = {
    [deps.currentCli]: modelConfigId,
  };
  const selectedModel = deps.getSelectedCliModel(deps.currentCli, modelConfigId);

  return {
    currentCli: deps.currentCli,
    autoOpenPanel: config.get<boolean>("autoOpenPanel", false),
    rememberSelectedCli: config.get<boolean>("rememberSelectedCli", true),
    autoAddEditorContextTags: deps.getAutoAddEditorContextTags(),
    longTermMemoryEnabled: deps.getEffectiveLongTermMemoryEnabled(),
    workspaceMemoryEnabled: deps.workspaceSettings.workspaceMemoryEnabled === true,
    autoCompactContextAfterRun: deps.getGlobalAutoCompactContextAfterRun(),
    multiAgentEnabled: deps.getGlobalMultiAgentEnabled(),
    loopMaxRounds: deps.getGlobalLoopMaxRounds(),
    loopSubtaskMaxThinkingMode: deps.getGlobalLoopSubtaskMaxThinkingMode(),
    loopExecutionModeByCli: deps.buildWorkspaceLoopExecutionModeByCli(),
    debug: deps.getDebugLogging(),
    locale: deps.getLocaleSetting(),
    isMac: deps.processPlatform === "darwin",
    macTaskShell: deps.getMacTaskShell() as MacTaskShell,
    thinkingMode: deps.getEffectiveThinkingMode(deps.currentCli, selectedModel),
    openCodeThinking: deps.openCodeThinking,
    openCodeSmallThinking: deps.openCodeSmallThinking ?? deps.openCodeThinking,
    openCodeModels: deps.openCodeModels,
    interactiveMode: deps.getWorkspaceInteractiveMode(deps.currentCli),
    interactive: {
      supported: deps.isInteractiveSupported(deps.currentCli),
      enabled: deps.isInteractiveSupported(deps.currentCli),
    },
    rulePaths: {
      global: deps.cliRulePathsGlobal,
      project: deps.getProjectRulePaths(),
    },
    sessionState: deps.buildSessionState(deps.currentCli),
    conversationTabs: deps.buildConversationTabsState(),
    promptHistory: deps.buildPromptHistoryState(),
    configState: deps.configState,
    modelState: deps.buildModelState(activeConfigIdByCli),
    editorContext: deps.buildEditorContextState(),
  };
}

export function isOpenCodeThinkingRequestCurrent(
  requestId: number,
  contextKey: string,
  currentRequestId: number,
  currentContextKey: string
): boolean {
  return requestId === currentRequestId && contextKey === currentContextKey;
}

function getEditorDisplayPath(document: vscode.TextDocument): string {
  const relativePath = vscode.workspace.asRelativePath(document.uri, false);
  if (relativePath) {
    return relativePath.replace(/\\/g, "/");
  }
  if (document.fileName) {
    return document.fileName.replace(/\\/g, "/");
  }
  return document.uri.toString(true);
}

function getPrimaryNonEmptySelection(editor: vscode.TextEditor): vscode.Selection | null {
  const selections = Array.isArray(editor.selections) && editor.selections.length
    ? editor.selections
    : [editor.selection];
  for (const selection of selections) {
    if (!selection.isEmpty) {
      return selection;
    }
  }
  return null;
}

function formatSelectionLabel(selection: vscode.Selection): string {
  const startLine = selection.start.line + 1;
  const startChar = selection.start.character + 1;
  const endLine = selection.end.line + 1;
  const endChar = selection.end.character + 1;
  if (startLine === endLine) {
    return `L${startLine}:${startChar}-${endChar}`;
  }
  return `L${startLine}:${startChar}-L${endLine}:${endChar}`;
}

export function buildEditorContextState(): EditorContextState {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return {
      filePath: null,
      fileLabel: null,
      hasSelection: false,
      selectionLabel: null,
    };
  }
  const fileLabel = getEditorDisplayPath(editor.document);
  const selection = getPrimaryNonEmptySelection(editor);
  return {
    filePath: fileLabel,
    fileLabel,
    hasSelection: Boolean(selection),
    selectionLabel: selection ? formatSelectionLabel(selection) : null,
  };
}

export function getActiveEditorPromptContext(): ActiveEditorPromptContext | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }
  const fileLabel = getEditorDisplayPath(editor.document);
  const selection = getPrimaryNonEmptySelection(editor);
  return {
    fileLabel,
    hasSelection: Boolean(selection),
    selectionLabel: selection ? formatSelectionLabel(selection) : null,
  };
}

export function buildPromptWithAutoContext(
  prompt: string,
  options?: PromptContextOptions
): PromptContextBuildResult {
  return buildPromptWithAutoContextFromEditor(prompt, options, {
    autoAddEditorContextTags: getAutoAddEditorContextTags(),
    getActiveEditorPromptContext,
  });
}

export type LongTermMemoryPromptDeps = {
  runtimeSettings: MemoryRuntimeGateSettings;
  memoryPaths: WorkspaceMemoryPaths | null;
  locale: AppLocale;
  logError: (event: string, payload?: unknown) => void;
};

export function maybeInjectLongTermMemoryForPromptWithEditorContext(
  prompt: string,
  modelPrompt: string,
  contextTags: readonly string[],
  deps: LongTermMemoryPromptDeps,
): string {
  return maybeInjectLongTermMemoryForPromptWithDeps(prompt, modelPrompt, contextTags, {
    runtimeSettings: deps.runtimeSettings,
    memoryPaths: deps.memoryPaths,
    locale: deps.locale,
    getActiveEditorPromptContext,
    onError: (error, paths) => deps.logError("long-term-memory-inject-error", {
      error: String(error),
      workspace: paths.workspaceRoot,
    }),
  });
}

export type LoopDebateChatPanelStateBuilderDeps = {
  collectRunningLoopTaskIds: () => ReadonlySet<string>;
  readTextFileIfNonEmpty: (filePath: string) => string | null;
  fileExists: (filePath: string) => boolean;
  writeTextFileEnsuringDir: (filePath: string, content: string) => boolean;
  getActiveLoopSubtaskIds: (task: LoopTaskRecord) => string[];
  buildLoopCompletedConclusionAndSummaryMarkdown: (task: LoopTaskRecord) => string;
  t: (key: any, params?: any) => string;
};

export type GraphRunPanelStateBuilderDeps = {
  strings: GraphRunPanelStrings;
  error?: string | null;
  eventLimit?: number;
  selectedNodeId?: string | null;
  controls?: {
    continueRun?: boolean;
	    supplementRun?: boolean;
	    retryNode?: boolean;
	    feedbackNode?: boolean;
	    approveHumanGate?: boolean;
	    stopRun?: boolean;
	  };
};

export function buildGraphRunPanelStateWithDeps(
  run: GraphRunRecord,
  events: readonly GraphEventRecord[],
  deps: GraphRunPanelStateBuilderDeps,
): GraphRunPanelState {
  const strings = deps.strings;
	  const controlState = getGraphRunControlState(run);
	  const retryableNodeIds = new Set(controlState.retryableNodeIds);
	  const feedbackableNodeIds = new Set(controlState.feedbackableNodeIds);
	  const approvableNodeIds = new Set(controlState.approvableNodeIds);
	  const nodes = run.nodes.map((node) => buildGraphRunPanelNode(node, strings, {
	    canRetry: Boolean(deps.controls?.retryNode) && retryableNodeIds.has(node.id),
	    canFeedback: Boolean(deps.controls?.feedbackNode) && feedbackableNodeIds.has(node.id),
	    canApprove: Boolean(deps.controls?.approveHumanGate) && approvableNodeIds.has(node.id),
	  }));
  const edges = buildGraphRunPanelEdges(run, nodes, strings);
  const selectedNode = selectGraphRunPanelNode(nodes, deps.selectedNodeId);
  return {
    run: {
      id: run.id,
      cli: run.cli,
      status: run.status,
      statusLabel: formatGraphRunStatus(run.status, strings),
      rootPrompt: run.rootPrompt,
      supplementalRequirements: Array.isArray(run.supplementalRequirements)
        ? run.supplementalRequirements.map((item) => String(item).trim()).filter(Boolean)
        : [],
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      runStoreFile: run.runStoreFile,
      graphFile: run.graphFile,
      eventsFile: run.eventsFile,
      communicationDir: run.communicationDir,
      mainCommunicationFile: run.mainCommunicationFile,
      ...(run.finalAnswer ? { finalAnswer: run.finalAnswer } : {}),
    },
    runControl: {
      canContinue: Boolean(deps.controls?.continueRun) && controlState.canContinue,
      canSupplement: Boolean(deps.controls?.supplementRun) && controlState.canSupplement,
      canStop: Boolean(deps.controls?.stopRun) && controlState.canStop,
    },
    stats: {
      total: nodes.length,
      statusCounts: GRAPH_NODE_STATUSES.map((status) => ({
        status,
        label: formatGraphNodeStatus(status, strings),
        count: nodes.filter((node) => node.status === status).length,
      })).filter((item) => item.count > 0),
    },
    nodes,
    edges,
    selectedNodeId: selectedNode?.id ?? null,
    selectedNode: selectedNode ?? null,
    events: buildGraphRunPanelEvents(events, deps.eventLimit ?? 30),
    error: deps.error ?? null,
  };
}

function buildGraphRunPanelNode(
	  node: GraphNodeRecord,
	  strings: GraphRunPanelStrings,
	  control: GraphRunPanelNode["control"] = { canRetry: false, canFeedback: false, canApprove: false },
	): GraphRunPanelNode {
  return {
    id: node.id,
    title: formatGraphNodeTitleInChinese(node),
    kind: node.kind,
    kindLabel: formatGraphNodeKind(node.kind, strings),
    status: node.status,
    statusLabel: formatGraphNodeStatus(node.status, strings),
    ownerRole: node.ownerRole,
    ownerRoleLabel: formatGraphOwnerRole(node.ownerRole, strings),
    attempts: node.attempts,
    maxAttempts: node.maxAttempts,
    dependsOn: node.dependsOn,
    unlocks: node.unlocks,
    writeFiles: node.writeFiles ?? [],
    ...(node.conflictGroup ? { conflictGroup: node.conflictGroup } : {}),
    ...(node.promptRef ? { promptRef: node.promptRef } : {}),
    ...(node.artifactRef ? { artifactRef: node.artifactRef } : {}),
    ...(node.communicationFile ? { communicationFile: node.communicationFile } : {}),
    ...(node.startedAt ? { startedAt: node.startedAt } : {}),
    ...(node.completedAt ? { completedAt: node.completedAt } : {}),
    ...(node.wakeAt ? { wakeAt: node.wakeAt } : {}),
    ...(node.lastError ? { lastError: node.lastError } : {}),
    acceptance: node.acceptance ?? [],
    control,
  };
}

function buildGraphRunPanelEdges(
  run: GraphRunRecord,
  nodes: readonly GraphRunPanelNode[],
  strings: GraphRunPanelStrings,
): GraphRunPanelEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const sourceEdges = Array.isArray(run.edges) && run.edges.length > 0
    ? run.edges
    : buildDependsOnFallbackEdges(nodes);
  return sourceEdges
    .map((edge, index) => buildGraphRunPanelEdge(edge, index, nodesById, strings))
    .filter((edge): edge is GraphRunPanelEdge => Boolean(edge));
}

function buildDependsOnFallbackEdges(nodes: readonly GraphRunPanelNode[]): GraphEdgeRecord[] {
  const edges: GraphEdgeRecord[] = [];
  nodes.forEach((node) => {
    node.dependsOn.forEach((from) => {
      edges.push({
        id: `depends_on:${from}->${node.id}`,
        from,
        to: node.id,
        kind: "depends_on",
        active: true,
      });
    });
  });
  return edges;
}

function buildGraphRunPanelEdge(
  edge: GraphEdgeRecord,
  index: number,
  nodesById: ReadonlyMap<string, GraphRunPanelNode>,
  strings: GraphRunPanelStrings,
): GraphRunPanelEdge | null {
  const fromNode = nodesById.get(edge.from);
  const toNode = nodesById.get(edge.to);
  if (!fromNode || !toNode) {
    return null;
  }
  return {
    id: edge.id || `${edge.kind}:${edge.from}->${edge.to}:${index}`,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    kindLabel: formatGraphEdgeKind(edge.kind, strings),
    active: edge.active !== false,
    fromTitle: fromNode.title,
    toTitle: toNode.title,
    ...(edge.condition ? { condition: edge.condition } : {}),
  };
}

function selectGraphRunPanelNode(
  nodes: readonly GraphRunPanelNode[],
  requestedNodeId?: string | null,
): GraphRunPanelNode | null {
  if (requestedNodeId) {
    const requestedNode = nodes.find((node) => node.id === requestedNodeId);
    if (requestedNode) {
      return requestedNode;
    }
  }
  return nodes.find((node) => (
    node.status === "running"
    || node.status === "failed"
    || node.status === "blocked"
    || node.status === "sleeping"
    || node.status === "ready"
  )) ?? nodes[0] ?? null;
}

function buildGraphRunPanelEvents(
  events: readonly GraphEventRecord[],
  limit: number,
): GraphRunPanelEvent[] {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  return events
    .slice()
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, normalizedLimit)
    .map((event) => ({
      eventId: event.eventId,
      runId: event.runId,
      type: event.type,
      timestamp: event.timestamp,
      ...(event.nodeId ? { nodeId: event.nodeId } : {}),
      ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.error ? { error: event.error } : {}),
    }));
}

export function buildLoopDebateChatPanelStateWithDeps(
  task: LoopTaskRecord,
  deps: LoopDebateChatPanelStateBuilderDeps,
): LoopDebateChatPanelState {
  const runningTaskIds = deps.collectRunningLoopTaskIds();
  const controlState = resolveLoopTaskRunControlState(task, runningTaskIds);
  const mode = isLoopDebateGroupChatTask(task) ? "debate" : "main_sub";
  const rounds = mode === "debate"
    ? buildLoopDebateWithExecutionChatPanelRounds(task, deps)
    : buildLoopMainSubChatPanelRounds(task, deps);
  const chatMarkdown = buildLoopCombinedGroupChatMarkdown(task, rounds, mode, deps);
  const missingChatFiles = rounds
    .map((round) => round.chatFile)
    .filter((filePath): filePath is string => Boolean(filePath && !deps.readTextFileIfNonEmpty(filePath)));
  const error = missingChatFiles.length > 0 && !chatMarkdown.trim()
    ? deps.t("loopDebateChat.transcriptMissing", { path: missingChatFiles[0] ?? "" })
    : null;
  return {
    mode,
    task: {
      id: task.id,
      cli: task.cli,
      status: task.status,
      rootPrompt: task.rootPrompt,
      taskStoreFile: task.taskStoreFile,
      mainCommunicationFile: task.mainCommunicationFile,
      currentRound: task.currentRound,
      updatedAt: task.updatedAt,
      autoSleepStartedAt: task.autoSleepStartedAt,
      autoWakeAt: task.autoWakeAt,
      autoSleepReason: task.autoSleepReason,
      canSupplement: controlState.canSupplement,
      canContinue: controlState.canContinue,
      canStop: controlState.canStop,
    },
    rounds,
    chatMarkdown,
    error,
  };
}

function buildLoopCombinedGroupChatMarkdown(
  task: LoopTaskRecord,
  rounds: LoopDebateChatPanelRound[],
  mode: "main_sub" | "debate",
  deps: LoopDebateChatPanelStateBuilderDeps,
): string {
  const sources = rounds
    .map((round) => {
      const content = round.chatFile ? deps.readTextFileIfNonEmpty(round.chatFile) : null;
      return content ? { round, content } : null;
    })
    .filter((source): source is { round: LoopDebateChatPanelRound; content: string } => Boolean(source));
  if (sources.length === 0) {
    return renderLoopGroupChatFinalStatusMarkdown(task);
  }
  if (mode === "main_sub" && sources.length === 1) {
    return appendLoopGroupChatFinalStatusMarkdown(sources[0]?.content ?? "", task);
  }

  const lines: string[] = [
    "# Loop 群聊记录",
    "",
    `- 任务 ID：${task.id}`,
    `- CLI：${task.cli}`,
    `- 任务状态：${task.status}`,
    `- 当前主任务轮次：${task.currentRound || 0}`,
    `- 更新时间：${new Date(task.updatedAt).toISOString()}`,
    "",
    "## 群聊规则",
    "- 本页面按群聊消息追加顺序连续展示红蓝对抗和后续任务执行消息。",
    "- 红蓝对抗不按 UI 轮次分区；主任务轮次、发言批次和执行阶段以系统消息说明。",
    "- 最大发言批次数只作为防无限循环安全上限，是否追加发言批次由裁判主持人控场决定。",
  ];

  sources.forEach(({ round, content }) => {
    lines.push("", "## 任务事件", buildLoopCombinedChatSourceEvent(round));
    const transcript = parseLoopDebateChatTranscript(content);
    transcript.segments.forEach((segment) => {
      if (segment.kind === "preamble") {
        const preamble = stripLoopChatPreambleTitle(segment.body);
        if (preamble) {
          lines.push("", "## 任务事件", preamble);
        }
        return;
      }
      lines.push("", `## ${segment.heading}`, segment.body.trim());
    });
  });

  const finalStatusSection = buildLoopGroupChatFinalStatusSection(task);
  if (finalStatusSection) {
    lines.push("", `## ${finalStatusSection.heading}`, finalStatusSection.body);
  }

  return `${lines.join("\n")}\n`;
}

function renderLoopGroupChatFinalStatusMarkdown(task: LoopTaskRecord): string {
  const finalStatusSection = buildLoopGroupChatFinalStatusSection(task);
  if (!finalStatusSection) {
    return "";
  }
  return `## ${finalStatusSection.heading}\n${finalStatusSection.body}\n`;
}

function appendLoopGroupChatFinalStatusMarkdown(markdown: string, task: LoopTaskRecord): string {
  const finalStatusSection = buildLoopGroupChatFinalStatusSection(task);
  if (!finalStatusSection) {
    return markdown;
  }
  if (hasLoopGroupChatFinalStatusSection(markdown, finalStatusSection.heading)) {
    return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  }
  const prefix = markdown.trimEnd();
  const section = `## ${finalStatusSection.heading}\n${finalStatusSection.body}`;
  return prefix ? `${prefix}\n\n${section}\n` : `${section}\n`;
}

function hasLoopGroupChatFinalStatusSection(markdown: string, heading: string): boolean {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)##\\s+${escapedHeading}\\s*(?:\\n|$)`, "u").test(markdown);
}

function buildLoopCombinedChatSourceEvent(round: LoopDebateChatPanelRound): string {
  const lines = [
    `- 来源：${round.label || (round.kind === "debate" ? "红蓝对抗群聊" : "任务执行群聊")}`,
    `- 状态：${round.status}`,
    round.chatFile ? `- transcript：${round.chatFile}` : null,
  ];
  if (round.kind === "debate") {
    lines.push(
      `- 主任务复核轮次：${round.loopRound}`,
      `- 已完成发言批次数：${round.dialogueTurns ?? 0}`,
      `- 最大安全发言批次数：${LOOP_DEBATE_MAX_DIALOGUE_TURNS}`,
      "- 裁判主持人会在每轮发言后决定 continue / finalize / block。",
    );
  }
  if (round.kind === "execution") {
    lines.push(`- 当前主任务轮次：${round.loopRound}`);
  }
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function stripLoopChatPreambleTitle(body: string): string {
  return body
    .split(/\r?\n/g)
    .filter((line, index) => !(index === 0 && /^#\s+/u.test(line.trim())))
    .join("\n")
    .trim();
}

export function isLoopDebateGroupChatTask(task: LoopTaskRecord): boolean {
  return normalizeLoopExecutionMode(task.executionMode) === "debate_multi_agent"
    || Boolean(task.debateRounds?.length);
}

function buildLoopDebateChatPanelRounds(task: LoopTaskRecord): LoopDebateChatPanelRound[] {
  const debateRounds = Array.isArray(task.debateRounds) ? task.debateRounds : [];
  return debateRounds
    .map((round): LoopDebateChatPanelRound => ({
      key: buildLoopDebateChatRoundKey(round.loopRound, round.debateRound),
      kind: "debate",
      loopRound: round.loopRound,
      debateRound: round.debateRound,
      status: round.status,
      chatFile: round.chatFile,
      participantRosterSessionId: round.participantRosterSessionId,
      dialogueTurns: round.dialogueTurns,
      activeSpeaker: round.activeSpeaker ? {
        kind: round.activeSpeaker.kind,
        id: round.activeSpeaker.id,
        title: round.activeSpeaker.title,
        dialogueTurn: round.activeSpeaker.dialogueTurn,
        finalPass: round.activeSpeaker.finalPass,
        updatedAt: round.activeSpeaker.updatedAt,
      } : undefined,
      startedAt: round.startedAt,
      completedAt: round.completedAt,
      participants: round.participants.map((participant) => ({
        id: participant.id,
        title: participant.title,
        role: participant.role,
        status: participant.status,
        stance: participant.stance,
        sessionId: participant.sessionId,
        summary: participant.summary,
        updatedAt: participant.updatedAt,
      })),
      moderatorDecisions: (round.moderatorDecisions ?? []).map((decision) => ({
        dialogueTurn: decision.dialogueTurn,
        action: decision.action,
        reason: decision.reason,
        sessionId: decision.sessionId,
        updatedAt: decision.updatedAt,
      })),
      consensusSummary: round.consensus?.summary,
      consensusReached: round.consensus?.reached,
      openDisagreementCount: round.consensus?.openDisagreements?.length,
    }))
    .sort((left, right) => (
      (left.startedAt || 0) - (right.startedAt || 0)
      || left.loopRound - right.loopRound
      || left.debateRound - right.debateRound
    ));
}

function buildLoopDebateWithExecutionChatPanelRounds(
  task: LoopTaskRecord,
  deps: LoopDebateChatPanelStateBuilderDeps,
): LoopDebateChatPanelRound[] {
  const debateRounds = buildLoopDebateChatPanelRounds(task);
  const executionChatFile = buildLoopMainSubChatTranscriptFile(task.communicationDir);
  const shouldIncludeExecution = deps.fileExists(executionChatFile)
    || shouldPrioritizeLoopExecutionChatRound(task, deps);
  if (!shouldIncludeExecution) {
    return debateRounds;
  }
  return [...debateRounds, buildLoopMainSubChatPanelRound(task, "任务执行群聊", deps)];
}

function shouldPrioritizeLoopExecutionChatRound(
  task: LoopTaskRecord,
  deps: LoopDebateChatPanelStateBuilderDeps,
): boolean {
  return task.subTasks.length > 0
    || deps.getActiveLoopSubtaskIds(task).length > 0
    || task.rounds.some((round) => round.role === "subtask");
}

function buildLoopMainSubChatPanelRounds(
  task: LoopTaskRecord,
  deps: LoopDebateChatPanelStateBuilderDeps,
): LoopDebateChatPanelRound[] {
  return [buildLoopMainSubChatPanelRound(task, "主从群聊", deps)];
}

function buildLoopMainSubChatPanelRound(
  task: LoopTaskRecord,
  label: string,
  deps: LoopDebateChatPanelStateBuilderDeps,
): LoopDebateChatPanelRound {
  const chatFile = ensureLoopMainSubChatTranscriptWithDeps(task, deps);
  const activeSubtaskIds = deps.getActiveLoopSubtaskIds(task);
  const mainRunning = task.status === "running" && activeSubtaskIds.length === 0;
  const mainTitle = getLoopMainSubChatMainTitle(task);
  const mainParticipant: LoopDebateChatPanelRound["participants"][number] = {
    id: "main",
    title: mainTitle,
    role: "main",
    status: mainRunning ? "running" : task.status,
    sessionId: task.sessionId ?? null,
    summary: task.finalSummary,
    updatedAt: task.updatedAt,
  };
  const subtaskParticipants = task.subTasks.map((subtask, index) => ({
    id: subtask.id,
    title: getLoopSubtaskDisplayTitle(index, subtask),
    role: "subtask",
    status: subtask.status,
    sessionId: null,
    summary: subtask.summary,
    updatedAt: subtask.updatedAt,
  }));
  return {
    key: LOOP_MAIN_SUB_CHAT_ROUND_KEY,
    kind: "execution",
    label,
    loopRound: Math.max(1, task.currentRound || 1),
    debateRound: 0,
    status: task.status,
    chatFile,
    activeSpeaker: buildLoopMainSubChatActiveSpeaker(task, deps),
    startedAt: task.createdAt,
    completedAt: task.status === "completed" ? task.updatedAt : undefined,
    participants: [mainParticipant, ...subtaskParticipants],
    moderatorDecisions: [],
  };
}

function buildLoopMainSubChatActiveSpeaker(
  task: LoopTaskRecord,
  deps: LoopDebateChatPanelStateBuilderDeps,
): LoopDebateChatPanelRound["activeSpeaker"] {
  if (task.status !== "running") {
    return undefined;
  }
  const activeSubtaskIds = deps.getActiveLoopSubtaskIds(task);
  const activeSubtask = task.subTasks.find((subtask) => (
    activeSubtaskIds.includes(subtask.id)
    && subtask.status === "running"
  ));
  if (activeSubtask) {
    const index = task.subTasks.findIndex((subtask) => subtask.id === activeSubtask.id);
    return {
      kind: "subtask",
      id: activeSubtask.id,
      title: getLoopSubtaskDisplayTitle(index, activeSubtask),
      dialogueTurn: Math.max(1, task.currentRound || 1),
      updatedAt: activeSubtask.updatedAt ?? task.updatedAt,
    };
  }
  if (activeSubtaskIds.length === 0) {
    return {
      kind: "main",
      id: "main",
      title: getLoopMainSubChatMainTitle(task),
      dialogueTurn: Math.max(1, task.currentRound || 1),
      updatedAt: task.updatedAt,
    };
  }
  return undefined;
}

export function getLoopMainSubChatMainTitle(task: Pick<LoopTaskRecord, "executionMode">): string {
  return normalizeLoopExecutionMode(task.executionMode) === "debate_multi_agent"
    ? "主持人主智能体"
    : "主任务";
}

export function ensureLoopMainSubChatTranscriptWithDeps(
  task: LoopTaskRecord,
  deps: LoopDebateChatPanelStateBuilderDeps,
): string {
  const chatFile = buildLoopMainSubChatTranscriptFile(task.communicationDir);
  if (deps.fileExists(chatFile)) {
    return chatFile;
  }
  deps.writeTextFileEnsuringDir(chatFile, buildInitialLoopMainSubChatTranscript(task, deps));
  return chatFile;
}

function buildInitialLoopMainSubChatTranscript(
  task: LoopTaskRecord,
  deps: LoopDebateChatPanelStateBuilderDeps,
): string {
  const mainTitle = getLoopMainSubChatMainTitle(task);
  const lines: string[] = [
    "# Loop 主从群聊记录",
    "",
    `- 任务 ID：${task.id}`,
    `- CLI：${task.cli}`,
    `- 任务状态：${task.status}`,
    `- 创建时间：${new Date(task.createdAt).toISOString()}`,
    `- 任务记录：${task.taskStoreFile}`,
    `- 主任务沟通文件：${task.mainCommunicationFile}`,
    "",
    "## 群聊规则",
    normalizeLoopExecutionMode(task.executionMode) === "debate_multi_agent"
      ? "- 主持人主智能体负责继承红蓝规划共识，拆分、派发、复核和最终验收。"
      : "- 主任务负责拆分、派发、复核和最终验收。",
    "- 子任务会在派发和执行时动态加入群聊，并以“子任务 1~N”标记。",
    "- 本页面只读，真实执行仍以任务记录、主任务沟通文件和子任务沟通文件为准。",
    "",
    "## 任务事件",
    `Loop 主从任务已创建。当前轮次：${task.currentRound || 0}。`,
  ];

  task.rounds
    .slice()
    .sort((left, right) => left.startedAt - right.startedAt)
    .forEach((round) => {
      if (round.role === "main") {
        lines.push(
          "",
          `## 主任务发言：第 ${round.round} 轮${formatLoopGroupChatMemberName(mainTitle)}`,
          ["- 成员 ID：main", "", formatLoopRoundRecordForChat(round)].join("\n"),
        );
        return;
      }
      const subtask = task.subTasks.find((item) => item.id === round.subtaskId);
      const index = subtask ? task.subTasks.findIndex((item) => item.id === subtask.id) : -1;
      const title = subtask ? getLoopSubtaskDisplayTitle(index, subtask) : `子任务 ${round.subtaskId ?? "unknown"}`;
      lines.push(
        "",
        `## 子任务发言：${formatLoopGroupChatMemberName(title)}`,
        [
          `- 成员 ID：${round.subtaskId ?? "unknown"}`,
          "",
          buildLoopMainSubSubtaskTurnBody({
            runStatus: round.status,
            assistantContent: subtask?.summary,
            communicationFile: subtask?.communicationFile,
          }),
        ].join("\n"),
      );
    });

  if (task.status === "completed") {
    lines.push("", "## 群聊收束", deps.buildLoopCompletedConclusionAndSummaryMarkdown(task));
  }
  return `${lines.join("\n")}\n`;
}

function formatLoopRoundRecordForChat(round: LoopRoundRecord): string {
  return [
    `- 状态：${round.status}`,
    `- 开始：${new Date(round.startedAt).toISOString()}`,
    `- 结束：${new Date(round.endedAt).toISOString()}`,
    round.summary ? `- 摘要：${round.summary}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function buildLoopDebateChatRoundKey(loopRound: number, debateRound: number): string {
  return `${loopRound}:${debateRound}`;
}

export function buildLoopDebateChatMessageActionWithRoundKey(
  taskId: string,
  defaultDebateRound: number,
  round?: number,
): ChatMessageAction {
  const action: ChatMessageAction = {
    type: "openLoopGroupChat",
    taskId,
    label: "打开 Loop 群聊",
  };
  if (typeof round === "number" && Number.isFinite(round)) {
    action.roundKey = buildLoopDebateChatRoundKey(round, defaultDebateRound);
  }
  return action;
}

export type UserChatMessageInput = {
  displayPrompt: string;
  contextTags: string[];
  taskRole?: ChatMessage["taskRole"];
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
};

export function buildUserChatMessage(input: UserChatMessageInput, createdAt: number, messageId: string): ChatMessage {
  return {
    id: messageId,
    role: "user",
    content: input.displayPrompt,
    createdAt,
    merge: false,
    contextTags: input.contextTags,
    taskRole: input.taskRole,
    loopTaskId: input.loopTaskId,
    loopRound: input.loopRound,
    loopSubtaskId: input.loopSubtaskId,
  };
}

export function getLatestAssistantResponseForLongTermMemory(messages: readonly ChatMessage[]): string | null {
  let fallback: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    const content = String(message.content ?? "").trim();
    if (!content || message.kind === "thinking") {
      continue;
    }
    if (message.codexFinalAnswer === true) {
      return content;
    }
    if (!fallback) {
      fallback = content;
    }
  }
  return fallback;
}

export function getLoopSubtaskDisplayTitle(index: number, subtask: Pick<LoopSubtaskRecord, "title">): string {
  const displayIndex = Number.isFinite(index) && index >= 0 ? index + 1 : 0;
  const prefix = displayIndex > 0 ? `子任务 ${displayIndex}` : "子任务";
  return subtask.title ? `${prefix}：${subtask.title}` : prefix;
}

export function buildLoopTaskStartedText(task: LoopTaskRecord): string {
  return `Loop 任务已启动：${task.id}\n记录文件：${task.taskStoreFile}`;
}

export function buildLoopTaskResumedText(task: LoopTaskRecord, round: number): string {
  return t("run.loopResumed", { taskId: task.id, round, file: task.taskStoreFile });
}

export function buildLoopTaskCompletedText(task: LoopTaskRecord): string {
  return [
    `Loop 任务已完成：${task.id}`,
    `记录文件：${task.taskStoreFile}`,
  ].join("\n");
}

export function buildLoopTaskNeedsReviewText(
  task: LoopTaskRecord,
  isBlockedByMainAiFailureLimit: (task: Pick<LoopTaskRecord, "mainAiFailureCount" | "mainAiFailureLimitReached">) => boolean,
): string {
  const failureSuffix = isBlockedByMainAiFailureLimit(task)
    ? `\n主任务 AI 调用已连续失败 ${normalizeLoopMainAiFailureCount(task.mainAiFailureCount)}/${LOOP_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`
    : "";
  return `Loop 任务需要人工复核：${task.id}\n记录文件：${task.taskStoreFile}${failureSuffix}`;
}

export function buildLoopMainResumeText(
  taskId: string,
  round: number,
  subtasks: LoopSubtaskRecord[],
): string {
  const subtaskTitles = subtasks.map((subtask) => subtask.title).join("、");
  return [
    `正在唤醒 Loop 主任务复核：第 ${round} 轮`,
    `Loop 任务：${taskId}`,
    `已完成子任务：${subtaskTitles || "无"}`,
  ].join("\n");
}

export function buildLoopSubtaskBatchStartedText(
  taskId: string,
  round: number,
  subtasks: LoopSubtaskRecord[],
  executionPlan: LoopSubtaskExecutionPlan<LoopSubtaskRecord>,
): string {
  const isSingleParallelGroup = executionPlan.groups.length <= 1;
  const lines = [
    isSingleParallelGroup
      ? `Loop 并发子任务批次已启动：${subtasks.length} 个`
      : `Loop 子任务批次已规划：${subtasks.length} 个，将按 ${executionPlan.groups.length} 组执行（组内并发、组间串行）`,
    `Loop 任务：${taskId}`,
    `轮次：${round}`,
    `子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
  ];
  if (!isSingleParallelGroup) {
    lines.push(`执行计划：${describeLoopExecutionPlan(executionPlan).join("；")}`);
  }
  if (executionPlan.conflicts.length > 0) {
    const conflictSummaries = executionPlan.conflicts.slice(0, 3).map((conflict) => {
      const reason = conflict.reason === "writeFiles" ? "写入文件" : "冲突组";
      return `${conflict.leftId} ↔ ${conflict.rightId}（${reason}: ${conflict.value}）`;
    });
    lines.push(`串行兜底：检测到 ${executionPlan.conflicts.length} 个声明冲突，${conflictSummaries.join("；")}`);
  }
  return lines.join("\n");
}

export function buildLoopSubtaskExecutionGroupStartedText(
  taskId: string,
  round: number,
  groupIndex: number,
  groupCount: number,
  subtasks: LoopSubtaskRecord[],
): string {
  return [
    `Loop 子任务执行组已启动：第 ${groupIndex + 1}/${groupCount} 组，${subtasks.length} 个`,
    `Loop 任务：${taskId}`,
    `轮次：${round}`,
    `组内子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
  ].join("\n");
}

export function buildLoopSubtaskBatchCompletedText(
  taskId: string,
  round: number,
  subtasks: LoopSubtaskRecord[],
): string {
  return [
    `Loop 子任务批次已全部完成：${subtasks.length} 个`,
    `Loop 任务：${taskId}`,
    `轮次：${round}`,
    `子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
  ].join("\n");
}

export function buildLoopSubtaskRetryText(
  taskId: string,
  subtaskId: string,
  retryCount: number,
  maxRetries: number,
): string {
  return [
    `Loop 子任务执行出错，1 分钟后自动重试（${retryCount}/${maxRetries}）。`,
    `Loop 任务：${taskId}`,
    `子任务：${subtaskId}`,
  ].join("\n");
}

export function buildLoopSubtaskStartedText(
  taskId: string,
  subtask: LoopSubtaskRecord,
  round: number,
  communicationFile: string,
  retryCount: number,
): string {
  const retryText = retryCount > 0 ? `（第 ${retryCount} 次重试）` : "";
  return [
    `Loop 子任务已启动${retryText}：${subtask.title}`,
    `Loop 任务：${taskId}`,
    `轮次：${round}`,
    `沟通文件：${communicationFile}`,
  ].join("\n");
}

export function formatLoopEstimatedRemainingRounds(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return `${Math.max(0, Math.floor(value))} 轮`;
}

export function formatLoopWriteFiles(writeFiles?: string[]): string | null {
  if (!Array.isArray(writeFiles) || writeFiles.length === 0) {
    return null;
  }
  return writeFiles.join("、");
}

export function buildSessionLabelFromPrompt(prompt: string | null | undefined): string | null {
  const trimmed = String(prompt ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, SESSION_LABEL_LIMIT);
}

export function shouldUseFallbackSessionLabel(
  label: string | null | undefined,
  unnamedSessionLabels: ReadonlySet<string>,
): boolean {
  if (typeof label !== "string") {
    return true;
  }
  const trimmed = label.trim();
  return !trimmed || unnamedSessionLabels.has(trimmed);
}

export function normalizeLoopTaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function isCliName(value: string): value is CliName {
  return (CLI_LIST as readonly string[]).includes(value);
}

export function normalizeLoopSubtaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeLoopRound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const round = Math.floor(value);
  return round > 0 ? round : null;
}

export function resolveLoopConversationTabContextFromMessages(
  messages: readonly ChatMessage[],
): LoopConversationTabContext {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const taskRole = message?.taskRole;
    const loopTaskId = normalizeLoopTaskId(message?.loopTaskId);
    if (!loopTaskId || (taskRole !== "main" && taskRole !== "subtask")) {
      if (message?.role === "user" && String(message.content || "").trim()) {
        return {
          taskRole: null,
          loopTaskId: null,
        };
      }
      continue;
    }
    return {
      taskRole,
      loopTaskId,
    };
  }
  return {
    taskRole: null,
    loopTaskId: null,
  };
}

export function resolveLoopRunConversationTabContext(
  run: { taskRole?: LoopTaskRole; loopTaskId?: string; messageTarget: ChatMessage[] } | undefined,
): LoopConversationTabContext {
  if (!run) {
    return { taskRole: null, loopTaskId: null };
  }
  const taskRole = run.taskRole === "main" || run.taskRole === "subtask"
    ? run.taskRole
    : null;
  const loopTaskId = normalizeLoopTaskId(run.loopTaskId);
  if (taskRole && loopTaskId) {
    return { taskRole, loopTaskId };
  }
  return resolveLoopConversationTabContextFromMessages(run.messageTarget);
}

export function resolveLoopSubtaskConversationContextFromMessages(
  messages: readonly ChatMessage[],
): LoopSubtaskConversationContext | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const taskId = normalizeLoopTaskId(message?.loopTaskId);
    const subtaskId = normalizeLoopSubtaskId(message?.loopSubtaskId);
    const round = normalizeLoopRound(message?.loopRound);
    if (message?.taskRole === "subtask" && taskId && subtaskId && round) {
      return {
        taskId,
        subtaskId,
        round,
      };
    }
    if (message?.role === "user" && String(message.content || "").trim()) {
      return null;
    }
  }
  return null;
}
