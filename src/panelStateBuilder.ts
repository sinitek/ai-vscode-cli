import * as vscode from "vscode";
import {
  getAutoAddEditorContextTags,
  getDebugLogging,
  getMacTaskShell,
} from "./cli/config";
import { isInteractiveSupported } from "./cli/config";
import { t } from "./i18n";
import { buildLoopBlockedPauseText } from "./loopBlockedSummary";
import { CLI_LIST, CliName, MacTaskShell } from "./cli/types";
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
  ScheduledTaskSummary,
  SessionSummary,
} from "./webview/types";
import {
  type LoopGroupChatPanelRound,
  type LoopGroupChatPanelState,
  type LoopPlusPanelProjection,
} from "./webview/loopGroupChatPanelTypes";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import { type WorkspaceMemoryPaths } from "./memory/memoryPaths";
import { type MemoryRuntimeGateSettings } from "./memory/runtimeGate";
import { resolveLoopTaskRunControlState } from "./loopGroupChat";
import {
  normalizeLoopProgressPercent,
  resolveLoopSchedulingMode,
  type LoopRoundRecord,
  type LoopSubtaskRecord,
  type LoopTaskRecord,
} from "./loopTaskStore";
import {
  LOOP_MAIN_AI_FAILURE_LIMIT,
  normalizeLoopMainAiFailureCount,
} from "./loopMainFailure";
import { isLoopAskChatMessage } from "./historySessionTaskRole";
import { getLoopMainSubChatMainTitle, getLoopSubtaskDisplayTitle, normalizeLoopTaskId } from "./loopConversationPresentation";
export { getLoopMainSubChatMainTitle, getLoopSubtaskDisplayTitle, normalizeLoopTaskId, normalizeLoopSubtaskId, normalizeLoopRound, resolveLoopSubtaskConversationContextFromMessages, type LoopSubtaskConversationContext } from "./loopConversationPresentation";
import {
  describeLoopExecutionPlan,
  type LoopSubtaskExecutionPlan,
} from "./loopParallel";
import {
  LOOP_PLUS_DECISION_SUBTASK_MAX,
  LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT,
  resolveLoopPlusDecisionSubtaskMax,
  resolveLoopPlusMaxAcceptances,
} from "./loopPlusDecision";
import { normalizeCliEnabledByName, resolveHumanInteractionTimeoutMinutes } from "./toolSettings";
import { LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT, normalizeChatMessageLimit } from "./chatMessageLimit";

type PanelConfiguration = Pick<vscode.WorkspaceConfiguration, "get">;

const SESSION_LABEL_LIMIT = 16;

export type LoopConversationTabContext = {
  taskRole: LoopTaskRole | null;
  loopTaskId: string | null;
};

export type PanelStateBuilderDeps = {
  currentCli: CliName;
  configState: PanelState["configState"];
  configStateByCli?: PanelState["configStateByCli"];
  workspaceSettings: WorkspaceSettings;
  workspaceHarnessInstalled?: boolean;
  codeGraphInstalled?: boolean;
  codeGraphInstalling?: boolean;
  processPlatform: NodeJS.Platform;
  cliRulePathsGlobal: Record<CliName, string>;
  getWorkspaceConfiguration: () => PanelConfiguration;
  getAutoAddEditorContextTags: typeof getAutoAddEditorContextTags;
  getEffectiveLongTermMemoryEnabled: () => boolean;
  getGlobalAutoCompactContextAfterRun: () => boolean;
  getGlobalHumanInteractionEnabled: () => boolean;
  getCliEnabledByName?: () => PanelState["cliEnabledByName"];
  getGlobalHumanInteractionTimeoutMinutes?: () => number;
  getGlobalHistoryRetentionDays?: () => number;
  getGlobalChatMessageLimit?: () => number;
  getGlobalLoopGroupChatMessageLimit?: () => number;
  getGlobalHideInstructionBubbles?: () => boolean;
  getGlobalLoopMaxRounds: () => number;
  getGlobalLoopPlusDecisionSubtaskMax?: () => number;
  getGlobalLoopPlusMaxAcceptances?: () => number;
  getDebugLogging: typeof getDebugLogging;
  getMacTaskShell: typeof getMacTaskShell;
  getEffectiveThinkingMode: (cli: CliName, model: string | null) => PanelState["thinkingMode"];
  openCodeThinking: PanelState["openCodeThinking"];
  openCodeSmallThinking?: PanelState["openCodeSmallThinking"];
  openCodeModels?: PanelState["openCodeModels"];
  loopSubtaskOpenCodeModels?: PanelState["loopSubtaskOpenCodeModels"];
  getWorkspaceInteractiveMode: (cli: CliName) => PanelState["interactiveMode"];
  isInteractiveSupported: typeof isInteractiveSupported;
  getProjectRulePaths: () => Record<CliName, string | null>;
  buildSessionState: (cli: CliName) => { currentSessionId: string | null; sessions: SessionSummary[] };
  buildConversationTabsState: () => { activeTabId: string | null; tabs: ConversationTabSummary[] };
  buildPromptHistoryState: () => PromptHistoryItem[];
  buildHumanInteractionHistoryState?: () => PanelState["humanInteractionHistory"];
  buildScheduledTasksState?: () => ScheduledTaskSummary[];
  buildLoopPlusAcceptancePlansState?: () => PanelState["loopPlusAcceptancePlans"];
  getLoopPlusAcceptancePlanSelection?: () => PanelState["loopPlusAcceptancePlanSelection"];
  buildModelState: (activeConfigIdByCli?: Partial<Record<CliName, string | null>>) => PanelState["modelState"];
  buildEditorContextState: () => EditorContextState;
  resolveModelConfigIdForCli: (cli: CliName, configState?: PanelState["configState"]) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
};

function normalizeOpenCodePanelModelRef(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOpenCodePanelModelRole(
  role: "main" | "subtask" | "primary" | "small" | undefined,
): "main" | "subtask" | undefined {
  if (role === "subtask" || role === "small") {
    return "subtask";
  }
  if (role === "main" || role === "primary") {
    return "main";
  }
  return undefined;
}

function normalizeOpenCodeModelsForPanelState(
  modelsState: PanelState["openCodeModels"],
): PanelState["openCodeModels"] {
  if (!modelsState) {
    return modelsState;
  }
  const configMainRef = normalizeOpenCodePanelModelRef(
    modelsState.configMainRef ?? modelsState.configPrimaryRef,
  );
  const configSubtaskRef = normalizeOpenCodePanelModelRef(
    modelsState.configSubtaskRef ?? modelsState.configSmallRef,
  );
  const selectedMainRef = normalizeOpenCodePanelModelRef(
    modelsState.selectedMainRef ?? modelsState.selectedPrimaryRef,
  );
  const selectedSubtaskRef = normalizeOpenCodePanelModelRef(
    modelsState.selectedSubtaskRef ?? modelsState.selectedSmallRef,
  );
  return {
    ...modelsState,
    configMainRef,
    configSubtaskRef,
    selectedMainRef,
    selectedSubtaskRef,
    configPrimaryRef: configMainRef,
    configSmallRef: configSubtaskRef,
    selectedPrimaryRef: selectedMainRef,
    selectedSmallRef: selectedSubtaskRef,
    issues: modelsState.issues.map((issue) => {
      const role = normalizeOpenCodePanelModelRole(issue.role);
      return role ? { ...issue, role } : { ...issue, role: undefined };
    }),
  };
}

export function buildPanelStateWithDeps(deps: PanelStateBuilderDeps): PanelState {
  const config = deps.getWorkspaceConfiguration();
  const currentConfigState = deps.configStateByCli?.[deps.currentCli];
  const modelConfigId = currentConfigState
    ? currentConfigState.activeConfigId
    : deps.resolveModelConfigIdForCli(deps.currentCli, deps.configState);
  const activeConfigIdByCli: Partial<Record<CliName, string | null>> = {
    [deps.currentCli]: modelConfigId,
  };
  for (const cli of CLI_LIST) {
    const cliState = deps.configStateByCli?.[cli];
    if (cliState) {
      activeConfigIdByCli[cli] = cliState.activeConfigId;
    }
  }
  const selectedModel = deps.getSelectedCliModel(deps.currentCli, modelConfigId);

  return {
    currentCli: deps.currentCli,
    autoOpenPanel: config.get<boolean>("autoOpenPanel", false),
    rememberSelectedCli: config.get<boolean>("rememberSelectedCli", true),
    autoAddEditorContextTags: deps.getAutoAddEditorContextTags(),
    longTermMemoryEnabled: deps.getEffectiveLongTermMemoryEnabled(),
    workspaceMemoryEnabled: deps.workspaceSettings.workspaceMemoryEnabled === true,
    workspaceHarnessInstalled: deps.workspaceHarnessInstalled === true,
    codeGraphInstalled: deps.codeGraphInstalled === true,
    codeGraphInstalling: deps.codeGraphInstalling === true,
    autoCompactContextAfterRun: deps.getGlobalAutoCompactContextAfterRun(),
    humanInteractionEnabled: deps.getGlobalHumanInteractionEnabled(),
    humanInteractionNotifications: config.get<boolean>("humanInteractionNotifications", true),
    taskCompletionNotifications: config.get<boolean>("taskCompletionNotifications", true),
    humanInteractionWindowAttention: config.get<boolean>("humanInteractionWindowAttention", true),
    taskCompletionWindowAttention: config.get<boolean>("taskCompletionWindowAttention", true),
    cliEnabledByName: normalizeCliEnabledByName(deps.getCliEnabledByName?.()) ?? {},
    humanInteractionTimeoutMinutes: resolveHumanInteractionTimeoutMinutes(
      deps.getGlobalHumanInteractionTimeoutMinutes?.(),
    ),
    historyRetentionDays: deps.getGlobalHistoryRetentionDays?.() ?? 30,
    chatMessageLimit: normalizeChatMessageLimit(deps.getGlobalChatMessageLimit?.()),
    loopGroupChatMessageLimit: normalizeChatMessageLimit(deps.getGlobalLoopGroupChatMessageLimit?.(), LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT),
    hideInstructionBubbles: deps.getGlobalHideInstructionBubbles?.() === true,
    loopMaxRounds: deps.getGlobalLoopMaxRounds(),
    loopPlusDecisionSubtaskMax: resolveLoopPlusDecisionSubtaskMax(
      deps.getGlobalLoopPlusDecisionSubtaskMax?.() ?? LOOP_PLUS_DECISION_SUBTASK_MAX,
    ),
    loopPlusMaxAcceptances: resolveLoopPlusMaxAcceptances(
      deps.getGlobalLoopPlusMaxAcceptances?.() ?? LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT,
    ),
    debug: deps.getDebugLogging(),
    isMac: deps.processPlatform === "darwin",
    macTaskShell: deps.getMacTaskShell() as MacTaskShell,
    thinkingMode: deps.getEffectiveThinkingMode(deps.currentCli, selectedModel),
    openCodeThinking: deps.openCodeThinking,
    openCodeSmallThinking: deps.openCodeSmallThinking ?? deps.openCodeThinking,
    openCodeModels: normalizeOpenCodeModelsForPanelState(deps.openCodeModels),
    loopSubtaskOpenCodeModels: normalizeOpenCodeModelsForPanelState(deps.loopSubtaskOpenCodeModels),
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
    humanInteractionHistory: deps.buildHumanInteractionHistoryState?.() ?? [],
    scheduledTasks: deps.buildScheduledTasksState?.() ?? [],
    loopPlusAcceptancePlans: deps.buildLoopPlusAcceptancePlansState?.() ?? [],
    loopPlusAcceptancePlanSelection: deps.getLoopPlusAcceptancePlanSelection?.(),
    configState: deps.configState,
    configStateByCli: deps.configStateByCli,
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
    getActiveEditorPromptContext,
    onError: (error, paths) => deps.logError("long-term-memory-inject-error", {
      error: String(error),
      workspace: paths.workspaceRoot,
    }),
  });
}

import { buildLoopGroupChatPanelStateWithDeps, ensureLoopMainSubChatTranscriptWithDeps } from "./loopGroupChatPanelState";
import { projectLoopPlusPanel } from "./loopPlusPanelProjection";
export { buildLoopGroupChatPanelStateWithDeps, ensureLoopMainSubChatTranscriptWithDeps, type LoopGroupChatPanelStateBuilderDeps } from "./loopGroupChatPanelState";
export { projectLoopPlusPanel } from "./loopPlusPanelProjection";

export function buildLoopGroupChatMessageAction(taskId: string): ChatMessageAction {
  return { type: "openLoopGroupChat", taskId, label: "打开 Loop 群聊" };
}

export type UserChatMessageInput = {
  displayPrompt: string;
  executionModel?: string | null;
  executionProfile?: ChatMessage["executionProfile"];
  contextTags: string[];
  taskRole?: ChatMessage["taskRole"];
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  loopAsk?: boolean;
};

export function buildUserChatMessage(input: UserChatMessageInput, createdAt: number, messageId: string): ChatMessage {
  return {
    id: messageId,
    role: "user",
    content: input.displayPrompt,
    createdAt,
    merge: false,
    contextTags: input.contextTags,
    ...(input.executionModel !== undefined ? { executionModel: input.executionModel } : {}),
    ...(input.executionProfile ? { executionProfile: input.executionProfile } : {}),
    taskRole: input.taskRole,
    loopTaskId: input.loopTaskId,
    loopRound: input.loopRound,
    loopSubtaskId: input.loopSubtaskId,
    ...(input.loopAsk === true ? { loopAsk: true } : {}),
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
  return `${buildLoopBlockedPauseText(task)}${failureSuffix}\n\nLoop 任务：${task.id}\n记录文件：${task.taskStoreFile}`;
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

export function isCliName(value: string): value is CliName {
  return (CLI_LIST as readonly string[]).includes(value);
}

export function resolveLoopConversationTabContextFromMessages(
  messages: readonly ChatMessage[],
): LoopConversationTabContext {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isLoopAskChatMessage(message)) {
      continue;
    }
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
