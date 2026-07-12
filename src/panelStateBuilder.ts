import * as vscode from "vscode";
import {
  getAutoAddEditorContextTags,
  getDebugLogging,
  getMacTaskShell,
} from "./cli/config";
import { isInteractiveSupported } from "./cli/config";
import { getLocaleSetting, t, type AppLocale } from "./i18n";
import { CLI_LIST, CliName, MacTaskShell, normalizeLobsterExecutionMode } from "./cli/types";
import { type LobsterTaskRole } from "./promptRunState";
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
  type LobsterDebateChatPanelRound,
  type LobsterDebateChatPanelState,
} from "./webview/lobsterDebatePanel";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import { type WorkspaceMemoryPaths } from "./memory/memoryPaths";
import { type MemoryRuntimeGateSettings } from "./memory/runtimeGate";
import {
  buildLobsterGroupChatFinalStatusSection,
  buildLobsterMainSubChatTranscriptFile,
  buildLobsterMainSubSubtaskTurnBody,
  formatLobsterGroupChatMemberName,
  LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
  LOBSTER_MAIN_SUB_CHAT_ROUND_KEY,
  parseLobsterDebateChatTranscript,
  resolveLobsterTaskRunControlState,
} from "./lobsterDebate";
import {
  type LobsterRoundRecord,
  type LobsterSubtaskRecord,
  type LobsterTaskRecord,
} from "./lobsterTaskStore";
import {
  LOBSTER_MAIN_AI_FAILURE_LIMIT,
  normalizeLobsterMainAiFailureCount,
} from "./lobsterMainFailure";
import {
  describeLobsterExecutionPlan,
  type LobsterSubtaskExecutionPlan,
} from "./lobsterParallel";

type PanelConfiguration = Pick<vscode.WorkspaceConfiguration, "get">;

const SESSION_LABEL_LIMIT = 16;

export type LobsterConversationTabContext = {
  taskRole: LobsterTaskRole | null;
  lobsterTaskId: string | null;
};

export type LobsterSubtaskConversationContext = {
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
  getWorkspaceAutoCompactContextAfterRun: () => boolean;
  getWorkspaceCodexMultiAgentEnabled: () => boolean;
  getGlobalFinalAnswerPolicy: () => PanelState["finalAnswerPolicy"];
  getGlobalLobsterMaxRounds: () => number;
  getGlobalLobsterAutoCloseSubtaskTabs: () => boolean;
  buildWorkspaceLobsterExecutionModeByCli: () => PanelState["lobsterExecutionModeByCli"];
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
    autoCompactContextAfterRun: deps.getWorkspaceAutoCompactContextAfterRun(),
    codexMultiAgentEnabled: deps.getWorkspaceCodexMultiAgentEnabled(),
    finalAnswerPolicy: deps.getGlobalFinalAnswerPolicy(),
    lobsterMaxRounds: deps.getGlobalLobsterMaxRounds(),
    lobsterAutoCloseSubtaskTabs: deps.getGlobalLobsterAutoCloseSubtaskTabs(),
    lobsterExecutionModeByCli: deps.buildWorkspaceLobsterExecutionModeByCli(),
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

export type LobsterDebateChatPanelStateBuilderDeps = {
  collectRunningLobsterTaskIds: () => ReadonlySet<string>;
  readTextFileIfNonEmpty: (filePath: string) => string | null;
  fileExists: (filePath: string) => boolean;
  writeTextFileEnsuringDir: (filePath: string, content: string) => boolean;
  getActiveLobsterSubtaskIds: (task: LobsterTaskRecord) => string[];
  buildLobsterCompletedConclusionAndSummaryMarkdown: (task: LobsterTaskRecord) => string;
  t: (key: any, params?: any) => string;
};

export function buildLobsterDebateChatPanelStateWithDeps(
  task: LobsterTaskRecord,
  deps: LobsterDebateChatPanelStateBuilderDeps,
): LobsterDebateChatPanelState {
  const runningTaskIds = deps.collectRunningLobsterTaskIds();
  const controlState = resolveLobsterTaskRunControlState(task, runningTaskIds);
  const mode = isLobsterDebateGroupChatTask(task) ? "debate" : "main_sub";
  const rounds = mode === "debate"
    ? buildLobsterDebateWithExecutionChatPanelRounds(task, deps)
    : buildLobsterMainSubChatPanelRounds(task, deps);
  const chatMarkdown = buildLobsterCombinedGroupChatMarkdown(task, rounds, mode, deps);
  const missingChatFiles = rounds
    .map((round) => round.chatFile)
    .filter((filePath): filePath is string => Boolean(filePath && !deps.readTextFileIfNonEmpty(filePath)));
  const error = missingChatFiles.length > 0 && !chatMarkdown.trim()
    ? deps.t("lobsterDebateChat.transcriptMissing", { path: missingChatFiles[0] ?? "" })
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
      canSupplement: controlState.canSupplement,
      canContinue: controlState.canContinue,
      canStop: controlState.canStop,
    },
    rounds,
    chatMarkdown,
    error,
  };
}

function buildLobsterCombinedGroupChatMarkdown(
  task: LobsterTaskRecord,
  rounds: LobsterDebateChatPanelRound[],
  mode: "main_sub" | "debate",
  deps: LobsterDebateChatPanelStateBuilderDeps,
): string {
  const sources = rounds
    .map((round) => {
      const content = round.chatFile ? deps.readTextFileIfNonEmpty(round.chatFile) : null;
      return content ? { round, content } : null;
    })
    .filter((source): source is { round: LobsterDebateChatPanelRound; content: string } => Boolean(source));
  if (sources.length === 0) {
    return renderLobsterGroupChatFinalStatusMarkdown(task);
  }
  if (mode === "main_sub" && sources.length === 1) {
    return appendLobsterGroupChatFinalStatusMarkdown(sources[0]?.content ?? "", task);
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
    lines.push("", "## 任务事件", buildLobsterCombinedChatSourceEvent(round));
    const transcript = parseLobsterDebateChatTranscript(content);
    transcript.segments.forEach((segment) => {
      if (segment.kind === "preamble") {
        const preamble = stripLobsterChatPreambleTitle(segment.body);
        if (preamble) {
          lines.push("", "## 任务事件", preamble);
        }
        return;
      }
      lines.push("", `## ${segment.heading}`, segment.body.trim());
    });
  });

  const finalStatusSection = buildLobsterGroupChatFinalStatusSection(task);
  if (finalStatusSection) {
    lines.push("", `## ${finalStatusSection.heading}`, finalStatusSection.body);
  }

  return `${lines.join("\n")}\n`;
}

function renderLobsterGroupChatFinalStatusMarkdown(task: LobsterTaskRecord): string {
  const finalStatusSection = buildLobsterGroupChatFinalStatusSection(task);
  if (!finalStatusSection) {
    return "";
  }
  return `## ${finalStatusSection.heading}\n${finalStatusSection.body}\n`;
}

function appendLobsterGroupChatFinalStatusMarkdown(markdown: string, task: LobsterTaskRecord): string {
  const finalStatusSection = buildLobsterGroupChatFinalStatusSection(task);
  if (!finalStatusSection) {
    return markdown;
  }
  if (hasLobsterGroupChatFinalStatusSection(markdown, finalStatusSection.heading)) {
    return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  }
  const prefix = markdown.trimEnd();
  const section = `## ${finalStatusSection.heading}\n${finalStatusSection.body}`;
  return prefix ? `${prefix}\n\n${section}\n` : `${section}\n`;
}

function hasLobsterGroupChatFinalStatusSection(markdown: string, heading: string): boolean {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)##\\s+${escapedHeading}\\s*(?:\\n|$)`, "u").test(markdown);
}

function buildLobsterCombinedChatSourceEvent(round: LobsterDebateChatPanelRound): string {
  const lines = [
    `- 来源：${round.label || (round.kind === "debate" ? "红蓝对抗群聊" : "任务执行群聊")}`,
    `- 状态：${round.status}`,
    round.chatFile ? `- transcript：${round.chatFile}` : null,
  ];
  if (round.kind === "debate") {
    lines.push(
      `- 主任务复核轮次：${round.lobsterRound}`,
      `- 已完成发言批次数：${round.dialogueTurns ?? 0}`,
      `- 最大安全发言批次数：${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS}`,
      "- 裁判主持人会在每轮发言后决定 continue / finalize / block。",
    );
  }
  if (round.kind === "execution") {
    lines.push(`- 当前主任务轮次：${round.lobsterRound}`);
  }
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function stripLobsterChatPreambleTitle(body: string): string {
  return body
    .split(/\r?\n/g)
    .filter((line, index) => !(index === 0 && /^#\s+/u.test(line.trim())))
    .join("\n")
    .trim();
}

export function isLobsterDebateGroupChatTask(task: LobsterTaskRecord): boolean {
  return normalizeLobsterExecutionMode(task.executionMode) === "debate_multi_agent"
    || Boolean(task.debateRounds?.length);
}

function buildLobsterDebateChatPanelRounds(task: LobsterTaskRecord): LobsterDebateChatPanelRound[] {
  const debateRounds = Array.isArray(task.debateRounds) ? task.debateRounds : [];
  return debateRounds
    .map((round): LobsterDebateChatPanelRound => ({
      key: buildLobsterDebateChatRoundKey(round.lobsterRound, round.debateRound),
      kind: "debate",
      lobsterRound: round.lobsterRound,
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
      || left.lobsterRound - right.lobsterRound
      || left.debateRound - right.debateRound
    ));
}

function buildLobsterDebateWithExecutionChatPanelRounds(
  task: LobsterTaskRecord,
  deps: LobsterDebateChatPanelStateBuilderDeps,
): LobsterDebateChatPanelRound[] {
  const debateRounds = buildLobsterDebateChatPanelRounds(task);
  const executionChatFile = buildLobsterMainSubChatTranscriptFile(task.communicationDir);
  const shouldIncludeExecution = deps.fileExists(executionChatFile)
    || shouldPrioritizeLobsterExecutionChatRound(task, deps);
  if (!shouldIncludeExecution) {
    return debateRounds;
  }
  return [...debateRounds, buildLobsterMainSubChatPanelRound(task, "任务执行群聊", deps)];
}

function shouldPrioritizeLobsterExecutionChatRound(
  task: LobsterTaskRecord,
  deps: LobsterDebateChatPanelStateBuilderDeps,
): boolean {
  return task.subTasks.length > 0
    || deps.getActiveLobsterSubtaskIds(task).length > 0
    || task.rounds.some((round) => round.role === "subtask");
}

function buildLobsterMainSubChatPanelRounds(
  task: LobsterTaskRecord,
  deps: LobsterDebateChatPanelStateBuilderDeps,
): LobsterDebateChatPanelRound[] {
  return [buildLobsterMainSubChatPanelRound(task, "主从群聊", deps)];
}

function buildLobsterMainSubChatPanelRound(
  task: LobsterTaskRecord,
  label: string,
  deps: LobsterDebateChatPanelStateBuilderDeps,
): LobsterDebateChatPanelRound {
  const chatFile = ensureLobsterMainSubChatTranscriptWithDeps(task, deps);
  const activeSubtaskIds = deps.getActiveLobsterSubtaskIds(task);
  const mainRunning = task.status === "running" && activeSubtaskIds.length === 0;
  const mainTitle = getLobsterMainSubChatMainTitle(task);
  const mainParticipant: LobsterDebateChatPanelRound["participants"][number] = {
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
    title: getLobsterSubtaskDisplayTitle(index, subtask),
    role: "subtask",
    status: subtask.status,
    sessionId: null,
    summary: subtask.summary,
    updatedAt: subtask.updatedAt,
  }));
  return {
    key: LOBSTER_MAIN_SUB_CHAT_ROUND_KEY,
    kind: "execution",
    label,
    lobsterRound: Math.max(1, task.currentRound || 1),
    debateRound: 0,
    status: task.status,
    chatFile,
    activeSpeaker: buildLobsterMainSubChatActiveSpeaker(task, deps),
    startedAt: task.createdAt,
    completedAt: task.status === "completed" ? task.updatedAt : undefined,
    participants: [mainParticipant, ...subtaskParticipants],
    moderatorDecisions: [],
  };
}

function buildLobsterMainSubChatActiveSpeaker(
  task: LobsterTaskRecord,
  deps: LobsterDebateChatPanelStateBuilderDeps,
): LobsterDebateChatPanelRound["activeSpeaker"] {
  if (task.status !== "running") {
    return undefined;
  }
  const activeSubtaskIds = deps.getActiveLobsterSubtaskIds(task);
  const activeSubtask = task.subTasks.find((subtask) => (
    activeSubtaskIds.includes(subtask.id)
    && subtask.status === "running"
  ));
  if (activeSubtask) {
    const index = task.subTasks.findIndex((subtask) => subtask.id === activeSubtask.id);
    return {
      kind: "subtask",
      id: activeSubtask.id,
      title: getLobsterSubtaskDisplayTitle(index, activeSubtask),
      dialogueTurn: Math.max(1, task.currentRound || 1),
      updatedAt: activeSubtask.updatedAt ?? task.updatedAt,
    };
  }
  if (activeSubtaskIds.length === 0) {
    return {
      kind: "main",
      id: "main",
      title: getLobsterMainSubChatMainTitle(task),
      dialogueTurn: Math.max(1, task.currentRound || 1),
      updatedAt: task.updatedAt,
    };
  }
  return undefined;
}

export function getLobsterMainSubChatMainTitle(task: Pick<LobsterTaskRecord, "executionMode">): string {
  return normalizeLobsterExecutionMode(task.executionMode) === "debate_multi_agent"
    ? "主持人主智能体"
    : "主任务";
}

export function ensureLobsterMainSubChatTranscriptWithDeps(
  task: LobsterTaskRecord,
  deps: LobsterDebateChatPanelStateBuilderDeps,
): string {
  const chatFile = buildLobsterMainSubChatTranscriptFile(task.communicationDir);
  if (deps.fileExists(chatFile)) {
    return chatFile;
  }
  deps.writeTextFileEnsuringDir(chatFile, buildInitialLobsterMainSubChatTranscript(task, deps));
  return chatFile;
}

function buildInitialLobsterMainSubChatTranscript(
  task: LobsterTaskRecord,
  deps: LobsterDebateChatPanelStateBuilderDeps,
): string {
  const mainTitle = getLobsterMainSubChatMainTitle(task);
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
    normalizeLobsterExecutionMode(task.executionMode) === "debate_multi_agent"
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
          `## 主任务发言：第 ${round.round} 轮${formatLobsterGroupChatMemberName(mainTitle)}`,
          ["- 成员 ID：main", "", formatLobsterRoundRecordForChat(round)].join("\n"),
        );
        return;
      }
      const subtask = task.subTasks.find((item) => item.id === round.subtaskId);
      const index = subtask ? task.subTasks.findIndex((item) => item.id === subtask.id) : -1;
      const title = subtask ? getLobsterSubtaskDisplayTitle(index, subtask) : `子任务 ${round.subtaskId ?? "unknown"}`;
      lines.push(
        "",
        `## 子任务发言：${formatLobsterGroupChatMemberName(title)}`,
        [
          `- 成员 ID：${round.subtaskId ?? "unknown"}`,
          "",
          buildLobsterMainSubSubtaskTurnBody({
            runStatus: round.status,
            assistantContent: subtask?.summary,
            communicationFile: subtask?.communicationFile,
          }),
        ].join("\n"),
      );
    });

  if (task.status === "completed") {
    lines.push("", "## 群聊收束", deps.buildLobsterCompletedConclusionAndSummaryMarkdown(task));
  }
  return `${lines.join("\n")}\n`;
}

function formatLobsterRoundRecordForChat(round: LobsterRoundRecord): string {
  return [
    `- 状态：${round.status}`,
    `- 开始：${new Date(round.startedAt).toISOString()}`,
    `- 结束：${new Date(round.endedAt).toISOString()}`,
    round.summary ? `- 摘要：${round.summary}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function buildLobsterDebateChatRoundKey(lobsterRound: number, debateRound: number): string {
  return `${lobsterRound}:${debateRound}`;
}

export function buildLobsterDebateChatMessageActionWithRoundKey(
  taskId: string,
  defaultDebateRound: number,
  round?: number,
): ChatMessageAction {
  const action: ChatMessageAction = {
    type: "openLobsterDebateChat",
    taskId,
    label: "打开 Loop 群聊",
  };
  if (typeof round === "number" && Number.isFinite(round)) {
    action.roundKey = buildLobsterDebateChatRoundKey(round, defaultDebateRound);
  }
  return action;
}

export type UserChatMessageInput = {
  displayPrompt: string;
  contextTags: string[];
  taskRole?: ChatMessage["taskRole"];
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
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
    lobsterTaskId: input.lobsterTaskId,
    lobsterRound: input.lobsterRound,
    lobsterSubtaskId: input.lobsterSubtaskId,
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

export function getLobsterSubtaskDisplayTitle(index: number, subtask: Pick<LobsterSubtaskRecord, "title">): string {
  const displayIndex = Number.isFinite(index) && index >= 0 ? index + 1 : 0;
  const prefix = displayIndex > 0 ? `子任务 ${displayIndex}` : "子任务";
  return subtask.title ? `${prefix}：${subtask.title}` : prefix;
}

export function buildLobsterTaskStartedText(task: LobsterTaskRecord): string {
  return `Loop 任务已启动：${task.id}\n记录文件：${task.taskStoreFile}`;
}

export function buildLobsterTaskResumedText(task: LobsterTaskRecord, round: number): string {
  return t("run.lobsterResumed", { taskId: task.id, round, file: task.taskStoreFile });
}

export function buildLobsterTaskCompletedText(task: LobsterTaskRecord): string {
  return [
    `Loop 任务已完成：${task.id}`,
    `记录文件：${task.taskStoreFile}`,
  ].join("\n");
}

export function buildLobsterTaskNeedsReviewText(
  task: LobsterTaskRecord,
  isBlockedByMainAiFailureLimit: (task: Pick<LobsterTaskRecord, "mainAiFailureCount" | "mainAiFailureLimitReached">) => boolean,
): string {
  const failureSuffix = isBlockedByMainAiFailureLimit(task)
    ? `\n主任务 AI 调用已连续失败 ${normalizeLobsterMainAiFailureCount(task.mainAiFailureCount)}/${LOBSTER_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`
    : "";
  return `Loop 任务需要人工复核：${task.id}\n记录文件：${task.taskStoreFile}${failureSuffix}`;
}

export function buildLobsterMainResumeText(
  taskId: string,
  round: number,
  subtasks: LobsterSubtaskRecord[],
): string {
  const subtaskTitles = subtasks.map((subtask) => subtask.title).join("、");
  return [
    `正在唤醒 Loop 主任务复核：第 ${round} 轮`,
    `Loop 任务：${taskId}`,
    `已完成子任务：${subtaskTitles || "无"}`,
  ].join("\n");
}

export function buildLobsterSubtaskBatchStartedText(
  taskId: string,
  round: number,
  subtasks: LobsterSubtaskRecord[],
  executionPlan: LobsterSubtaskExecutionPlan<LobsterSubtaskRecord>,
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
    lines.push(`执行计划：${describeLobsterExecutionPlan(executionPlan).join("；")}`);
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

export function buildLobsterSubtaskExecutionGroupStartedText(
  taskId: string,
  round: number,
  groupIndex: number,
  groupCount: number,
  subtasks: LobsterSubtaskRecord[],
): string {
  return [
    `Loop 子任务执行组已启动：第 ${groupIndex + 1}/${groupCount} 组，${subtasks.length} 个`,
    `Loop 任务：${taskId}`,
    `轮次：${round}`,
    `组内子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
  ].join("\n");
}

export function buildLobsterSubtaskBatchCompletedText(
  taskId: string,
  round: number,
  subtasks: LobsterSubtaskRecord[],
): string {
  return [
    `Loop 子任务批次已全部完成：${subtasks.length} 个`,
    `Loop 任务：${taskId}`,
    `轮次：${round}`,
    `子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
  ].join("\n");
}

export function buildLobsterSubtaskRetryText(
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

export function buildLobsterSubtaskStartedText(
  taskId: string,
  subtask: LobsterSubtaskRecord,
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

export function formatLobsterEstimatedRemainingRounds(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return `${Math.max(0, Math.floor(value))} 轮`;
}

export function formatLobsterWriteFiles(writeFiles?: string[]): string | null {
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

export function normalizeLobsterTaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function isCliName(value: string): value is CliName {
  return (CLI_LIST as readonly string[]).includes(value);
}

export function normalizeLobsterSubtaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeLobsterRound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const round = Math.floor(value);
  return round > 0 ? round : null;
}

export function resolveLobsterConversationTabContextFromMessages(
  messages: readonly ChatMessage[],
): LobsterConversationTabContext {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const taskRole = message?.taskRole;
    const lobsterTaskId = normalizeLobsterTaskId(message?.lobsterTaskId);
    if (!lobsterTaskId || (taskRole !== "main" && taskRole !== "subtask")) {
      if (message?.role === "user" && String(message.content || "").trim()) {
        return {
          taskRole: null,
          lobsterTaskId: null,
        };
      }
      continue;
    }
    return {
      taskRole,
      lobsterTaskId,
    };
  }
  return {
    taskRole: null,
    lobsterTaskId: null,
  };
}

export function resolveLobsterRunConversationTabContext(
  run: { taskRole?: LobsterTaskRole; lobsterTaskId?: string; messageTarget: ChatMessage[] } | undefined,
): LobsterConversationTabContext {
  if (!run) {
    return { taskRole: null, lobsterTaskId: null };
  }
  const taskRole = run.taskRole === "main" || run.taskRole === "subtask"
    ? run.taskRole
    : null;
  const lobsterTaskId = normalizeLobsterTaskId(run.lobsterTaskId);
  if (taskRole && lobsterTaskId) {
    return { taskRole, lobsterTaskId };
  }
  return resolveLobsterConversationTabContextFromMessages(run.messageTarget);
}

export function resolveLobsterSubtaskConversationContextFromMessages(
  messages: readonly ChatMessage[],
): LobsterSubtaskConversationContext | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const taskId = normalizeLobsterTaskId(message?.lobsterTaskId);
    const subtaskId = normalizeLobsterSubtaskId(message?.lobsterSubtaskId);
    const round = normalizeLobsterRound(message?.lobsterRound);
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
