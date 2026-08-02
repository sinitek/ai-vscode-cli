import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { CliName, ThinkingMode } from "../cli/types";
import type { ChatMessage, ChatMessageAction } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import { t, resolveLocale } from "../i18n";
import { logError, logInfo } from "../logger";
import { normalizeLoopSleepDecision, resolveLoopAutoWakeAt } from "../loopAutoWake";
import { normalizeLoopWriteFiles } from "../loopParallel";
import { buildNextLoopMainAiFailureState, isLoopMainAiFailureLimitReached, LOOP_MAIN_AI_FAILURE_LIMIT } from "../loopMainFailure";
import { resolveLoopAnswerConclusion } from "../loopDebate";
import { buildLoopAnswerConclusionMarkdown, buildLoopFinalSummaryMarkdown } from "../loopDebateFinalSummary";
import { finalizeLoopSubtaskRun as finalizeLoopSubtaskRunWithDeps, type LoopSubtaskCompletionOptions } from "../loopSubtaskLifecycle";
import { appendLoopRound, bindLoopTaskToSession, buildLoopSubtaskCommunicationFile, getLoopCommunicationPaths, getLoopTaskStoreSessionFile, readLoopTaskRecord, readLoopTaskStore, updateLoopTaskRecord, type LoopAcceptance, type LoopAcceptanceCheck, type LoopMainDecision, type LoopRoundSummary, type LoopSubtaskDecision, type LoopSubtaskRecord, type LoopTaskRecord } from "../loopTaskStore";
import { appendMessageToStore, isLoopTaskCompleted, type LoopTaskRole, type TaskRunRecord, type TaskRunStatus, type TaskStore } from "../promptRunState";
import { buildLoopMainResumeText, buildLoopSubtaskBatchCompletedText, buildLoopTaskNeedsReviewText as buildLoopTaskNeedsReviewTextWithLimit, formatLoopEstimatedRemainingRounds, formatLoopWriteFiles, resolveLoopSubtaskConversationContextFromMessages, type LoopSubtaskConversationContext } from "../panelStateBuilder";
import { resolveLoopResumeRound } from "../webviewCommandCoordinator";
import { collectRecentLoopTaskIdsFromMessages, detectLoopVerificationSignals, formatLoopVerificationState, hasCompleteLoopCompletionMessages, isCompleteLoopFinalSummaryContent, isLoopAnswerConclusionMessageForTask, isLoopFinalSummaryMessageForTask, isLoopTaskResumable, isLoopTaskSessionCompatible } from "../panelDiagnostics";
import { getConversationTabSessionIdForCli, sanitizeConversationTabSessionIdMap, type ConversationTabRecord } from "../sessionTabs";

export type PromptRunRuntimeHostDeps = {
  getActiveWorkspaceKey: () => string;
  getConversationTabById: (tabId: string) => ConversationTabRecord | null;
  getConversationTabs: () => ConversationTabRecord[];
  createConversationTabId: () => string;
  persistConversationTabsToWorkspaceSettings: () => void;
  postPanelState: () => Promise<void>;
  loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[];
  persistMessagesForTab: (cli: CliName, sessionId: string | null, tabId: string, messages: ChatMessage[]) => void;
  getPendingSessionDraft: (tabId: string, cli?: CliName) => { messages: ChatMessage[] };
  updatePendingSessionDraft: (tabId: string, patch: { messages?: ChatMessage[] }, cli?: CliName) => unknown;
  sendPanelMessage: (payload: Record<string, unknown>) => void;
  createMessageId: () => string;
  readTaskStore: () => TaskStore;
  writeTaskStore: (store: TaskStore) => void;
  appendLoopMainSubChatMainDecision: (task: LoopTaskRecord, decision: LoopMainDecision, subtasks?: LoopSubtaskRecord[]) => void;
  buildLoopDebateChatMessageAction: (taskId: string, round?: number) => ChatMessageAction;
  runLoopPrompt: (input: PromptRunInput, options?: { targetTabId?: string | null; resumeTaskId?: string; resumeRequested?: boolean }) => Promise<void>;
  isTabRunActive: (tabId: string | null) => boolean;
  refreshOpenLoopGroupChatPanelForTask: (taskId: string) => void;
  cancelLoopTaskAutoWake: (taskId: string) => void;
  resolveConversationTabLoopContext: (tab: ConversationTabRecord) => { taskRole?: string | null; loopTaskId?: string | null };
  resolveLoopTaskSessionId: (target: PromptRunTarget) => string | null;
  isLoopTaskBlockedByMainAiFailureLimit: (task: Pick<LoopTaskRecord, "mainAiFailureCount" | "mainAiFailureLimitReached">) => boolean;
  formatLoopAutoWakeAtForRecord: (value: number | undefined) => string;
  appendLoopMainSubChatSubtaskFinished: (task: LoopTaskRecord, subtask: LoopSubtaskRecord, runStatus: TaskRunStatus, assistantContent: string | null) => void;
  closeConversationTabAndRefreshPanel: (tabId: string) => Promise<void>;
};

export function createPromptRunRuntimeHost(deps: PromptRunRuntimeHostDeps) {
let activeWorkspaceKey = deps.getActiveWorkspaceKey();
const { getConversationTabById, createConversationTabId, persistConversationTabsToWorkspaceSettings, postPanelState, loadSessionMessages, persistMessagesForTab, getPendingSessionDraft, updatePendingSessionDraft, sendPanelMessage, createMessageId, appendLoopMainSubChatMainDecision, buildLoopDebateChatMessageAction, runLoopPrompt, isTabRunActive, refreshOpenLoopGroupChatPanelForTask, cancelLoopTaskAutoWake, resolveConversationTabLoopContext } = deps;
const LOOP_MAX_MAX_ROUNDS = 100;
const LOOP_PARALLEL_SUBTASK_MAX = 6;
const LOOP_SUBTASK_PROMPT_MIN_LENGTH = 80;
const readTaskStore = deps.readTaskStore;
const writeTaskStore = deps.writeTaskStore;
const resolveLoopTaskSessionId = deps.resolveLoopTaskSessionId;
const isLoopTaskBlockedByMainAiFailureLimit = deps.isLoopTaskBlockedByMainAiFailureLimit;
const formatLoopAutoWakeAtForRecord = deps.formatLoopAutoWakeAtForRecord;
const appendLoopMainSubChatSubtaskFinished = deps.appendLoopMainSubChatSubtaskFinished;
const closeConversationTabAndRefreshPanel = deps.closeConversationTabAndRefreshPanel;
const ensureConversationTabs = () => ({ tabs: deps.getConversationTabs() });
const buildLoopTaskNeedsReviewText = (task: LoopTaskRecord): string => buildLoopTaskNeedsReviewTextWithLimit(task, isLoopTaskBlockedByMainAiFailureLimit);
function syncFromDeps(): void { activeWorkspaceKey = deps.getActiveWorkspaceKey(); }
function wrap<T extends (...args: any[]) => any>(fn: T): T { return ((...args: Parameters<T>) => { syncFromDeps(); return fn(...args); }) as T; }

function resolvePromptRunTarget(tabId: string | null): PromptRunTarget | null {
  if (!tabId) {
    return null;
  }
  const tab = getConversationTabById(tabId);
  if (!tab) {
    return null;
  }
  return {
    tabId: tab.id,
    cli: tab.cli,
    sessionId: tab.sessionId,
  };
}

function collectRecentLoopTaskIdsForTarget(target: PromptRunTarget, limit = 12): string[] {
  return collectRecentLoopTaskIdsFromMessages(getLoopMessagesForTarget(target), limit);
}

function isLoopTaskCompatibleWithTarget(
  task: LoopTaskRecord,
  target: PromptRunTarget,
  options: { allowMissingTaskSessionId?: boolean } = {}
): boolean {
  if (task.cli !== target.cli || task.workspaceKey !== activeWorkspaceKey) {
    return false;
  }
  const targetSessionId = resolveLoopTaskSessionId(target);
  return isLoopTaskSessionCompatible(task, targetSessionId, options);
}

function findResumableLoopTaskForTarget(target: PromptRunTarget): LoopTaskRecord | null {
  const candidates: LoopTaskRecord[] = [];
  const seenTaskIds = new Set<string>();

  const appendCandidate = (
    task: LoopTaskRecord | null | undefined,
    options: { allowMissingTaskSessionId?: boolean } = {}
  ): void => {
    if (
      !task
      || seenTaskIds.has(task.id)
      || !isLoopTaskCompatibleWithTarget(task, target, {
        allowMissingTaskSessionId: options.allowMissingTaskSessionId,
      })
    ) {
      return;
    }
    seenTaskIds.add(task.id);
    candidates.push(task);
  };

  const recentTaskIds = collectRecentLoopTaskIdsForTarget(target);
  recentTaskIds.forEach((taskId) => {
    appendCandidate(readLoopTaskRecord(taskId), { allowMissingTaskSessionId: true });
  });

  const targetSessionId = resolveLoopTaskSessionId(target);
  if (targetSessionId) {
    const sessionStoreFile = getLoopTaskStoreSessionFile(activeWorkspaceKey, target.cli, targetSessionId);
    const sessionStore = readLoopTaskStore(sessionStoreFile);
    sessionStore.tasks
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .forEach((task) => {
        appendCandidate(
          task.taskStoreFile === sessionStoreFile ? task : { ...task, taskStoreFile: sessionStoreFile }
        );
      });
  }

  const resumable = candidates
    .filter((task) => isLoopTaskResumable(task) || (
      task.status === "completed" && !hasCompleteLoopCompletionMessagesForTask(target, task.id)
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return resumable[0] ?? null;
}

function getLoopMessagesForTarget(target: PromptRunTarget): ChatMessage[] {
  const tab = getConversationTabById(target.tabId);
  const sessionId = tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
  return sessionId
    ? loadSessionMessages(target.cli, sessionId)
    : getPendingSessionDraft(target.tabId, target.cli).messages;
}

function resolveLoopSubtaskConversationContext(
  cli: CliName,
  tabId: string | null | undefined
): LoopSubtaskConversationContext | null {
  if (!tabId) {
    return null;
  }
  const tab = getConversationTabById(tabId);
  if (!tab || tab.cli !== cli) {
    return null;
  }
  const sessionId = getConversationTabSessionIdForCli(tab, cli);
  const messages = sessionId
    ? loadSessionMessages(cli, sessionId)
    : getPendingSessionDraft(tabId, cli).messages;
  return resolveLoopSubtaskConversationContextFromMessages(messages);
}

function isLoopSubtaskConversationTarget(cli: CliName, tabId: string | null | undefined): boolean {
  return Boolean(resolveLoopSubtaskConversationContext(cli, tabId));
}

function getLastLoopAssistantContent(
  target: PromptRunTarget,
  taskId: string,
  round: number,
  role: LoopTaskRole
): string | null {
  const messages = getLoopMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === role
      && message.loopTaskId === taskId
      && message.loopRound === round
      && message.content.trim()
    ) {
      return message.content;
    }
  }
  return null;
}

function parseLoopMainDecision(content: string | null): LoopMainDecision | null {
  if (!content) {
    return null;
  }
  const jsonText = extractJsonObjectText(content);
  if (!jsonText) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonText);
    return normalizeLoopMainDecision(parsed);
  } catch {
    return null;
  }
}

function extractJsonObjectText(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = content.indexOf("{");
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index + 1).trim();
      }
    }
  }
  return null;
}

function normalizeLoopMainDecision(value: unknown): LoopMainDecision | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<LoopMainDecision>;
  const estimatedRemainingRounds = normalizeLoopEstimatedRemainingRounds(
    (raw as { estimatedRemainingRounds?: unknown }).estimatedRemainingRounds
  );
  if (raw.status === "sleep") {
    const sleepDecision = normalizeLoopSleepDecision(value);
    if (!sleepDecision) {
      return null;
    }
    return {
      ...sleepDecision,
      estimatedRemainingRounds,
    };
  }
  if (raw.status === "completed") {
    const acceptance = normalizeLoopAcceptance((raw as { acceptance?: unknown }).acceptance);
    const requirementCoverage = normalizeLoopAcceptanceChecks((raw as { requirementCoverage?: unknown }).requirementCoverage);
    const answerConclusion = typeof raw.answerConclusion === "string" && raw.answerConclusion.trim()
      ? raw.answerConclusion.trim()
      : undefined;
    const finalSummary = typeof raw.finalSummary === "string" && raw.finalSummary.trim()
      ? raw.finalSummary.trim()
      : "";
    const roundSummaries = normalizeLoopRoundSummaries((raw as { roundSummaries?: unknown }).roundSummaries);
    if (
      !acceptance?.passed
      || !acceptance.checks.every((check) => check.passed)
      || requirementCoverage.length === 0
      || !requirementCoverage.every((item) => item.passed)
      || !finalSummary
      || !roundSummaries
    ) {
      return null;
    }
    return {
      status: "completed",
      ...(answerConclusion ? { answerConclusion } : {}),
      finalSummary,
      requirementCoverage,
      roundSummaries,
      acceptance,
      estimatedRemainingRounds: 0,
    };
  }
  if (raw.status === "blocked") {
    return {
      status: "blocked",
      finalSummary: typeof raw.finalSummary === "string" ? raw.finalSummary : undefined,
      estimatedRemainingRounds,
    };
  }
  if (raw.status !== "continue") {
    return null;
  }
  const subtasks = normalizeLoopSubtaskDecisions(raw);
  if (!subtasks || subtasks.length === 0) {
    return null;
  }
  const acceptance = normalizeLoopAcceptance((raw as { acceptance?: unknown }).acceptance);
  return {
    status: "continue",
    acceptance: acceptance ?? { passed: false, checks: [] },
    subtask: subtasks[0],
    subtasks,
    parallelReason: typeof (raw as { parallelReason?: unknown }).parallelReason === "string"
      ? (raw as { parallelReason: string }).parallelReason.trim()
      : undefined,
    estimatedRemainingRounds,
  };
}

function normalizeLoopEstimatedRemainingRounds(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(numeric), 0), LOOP_MAX_MAX_ROUNDS);
}

function normalizeLoopSubtaskDecisions(raw: Partial<LoopMainDecision>): LoopSubtaskDecision[] | null {
  const rawSubtasks = Array.isArray((raw as { subtasks?: unknown }).subtasks)
    ? (raw as { subtasks: unknown[] }).subtasks
    : (raw.subtask ? [raw.subtask] : []);
  if (rawSubtasks.length === 0 || rawSubtasks.length > LOOP_PARALLEL_SUBTASK_MAX) {
    return null;
  }
  const normalized = rawSubtasks
    .map((item): LoopSubtaskDecision | null => normalizeSingleLoopSubtaskDecision(item))
    .filter((item): item is LoopSubtaskDecision => Boolean(item));
  if (normalized.length !== rawSubtasks.length) {
    return null;
  }
  const seenIds = new Set<string>();
  for (const subtask of normalized) {
    const id = subtask.id ?? buildLoopSubtaskId(subtask.title);
    if (seenIds.has(id)) {
      return null;
    }
    seenIds.add(id);
  }
  return normalized;
}

function normalizeSingleLoopSubtaskDecision(value: unknown): LoopSubtaskDecision | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const subtask = value as {
    id?: unknown;
    title?: unknown;
    prompt?: unknown;
    conflictGroup?: unknown;
    writeFiles?: unknown;
    skillIds?: unknown;
  };
  const title = typeof subtask.title === "string" ? subtask.title.trim() : "";
  const prompt = typeof subtask.prompt === "string" ? subtask.prompt.trim() : "";
  if (!title || !prompt || prompt.length < LOOP_SUBTASK_PROMPT_MIN_LENGTH) {
    return null;
  }
  const id = typeof subtask.id === "string" && subtask.id.trim()
    ? subtask.id.trim()
    : buildLoopSubtaskId(title);
  const conflictGroup = typeof subtask.conflictGroup === "string" && subtask.conflictGroup.trim()
    ? subtask.conflictGroup.trim()
    : undefined;
  const writeFiles = normalizeLoopWriteFiles(subtask.writeFiles);
  const skillIds = Array.isArray(subtask.skillIds)
    ? subtask.skillIds
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  return {
    id,
    title,
    prompt,
    conflictGroup,
    writeFiles: writeFiles.length > 0 ? writeFiles : undefined,
    ...(skillIds.length > 0 ? { skillIds } : {}),
  };
}

function normalizeLoopRoundSummaries(value: unknown): LoopRoundSummary[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .map((item): LoopRoundSummary | null => normalizeSingleLoopRoundSummary(item))
    .filter((item): item is LoopRoundSummary => Boolean(item));
}

function normalizeSingleLoopRoundSummary(value: unknown): LoopRoundSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const summary = value as {
    round?: unknown;
    subtaskId?: unknown;
    title?: unknown;
    summary?: unknown;
  };
  const round = typeof summary.round === "number" && summary.round > 0
    ? Math.floor(summary.round)
    : null;
  const title = typeof summary.title === "string" ? summary.title.trim() : "";
  const content = typeof summary.summary === "string" ? summary.summary.trim() : "";
  if (!round || !title || !content) {
    return null;
  }
  return {
    round,
    subtaskId: typeof summary.subtaskId === "string" && summary.subtaskId.trim()
      ? summary.subtaskId.trim()
      : undefined,
    title,
    summary: content,
  };
}

function normalizeLoopAcceptance(value: unknown): LoopAcceptance | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { passed?: unknown; summary?: unknown; checks?: unknown };
  const checks = normalizeLoopAcceptanceChecks(raw.checks);
  return {
    passed: raw.passed === true,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    checks,
  };
}

function normalizeLoopAcceptanceChecks(value: unknown): LoopAcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): LoopAcceptanceCheck | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const check = item as { name?: unknown; passed?: unknown; detail?: unknown };
      const name = typeof check.name === "string" && check.name.trim() ? check.name.trim() : "acceptance";
      return {
        name,
        passed: check.passed === true,
        detail: typeof check.detail === "string" ? check.detail : undefined,
      };
    })
    .filter((item): item is LoopAcceptanceCheck => Boolean(item));
}

function buildLoopSubtaskId(title: string): string {
  return `subtask_${createHash("sha1").update(title).digest("hex").slice(0, 10)}`;
}

function applyLoopMainDecision(
  taskId: string,
  decision: LoopMainDecision,
): { status: "completed" | "continue" | "sleeping" | "blocked"; task: LoopTaskRecord; subtasks?: LoopSubtaskRecord[] } {
  const existing = readLoopTaskRecord(taskId);
  if (!existing) {
    throw new Error(`loop-task-missing:${taskId}`);
  }
  if (decision.status === "completed") {
    const task = updateLoopTaskRecord(taskId, {
      status: "completed",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      answerConclusion: resolveLoopAnswerConclusion(existing, decision),
      finalSummary: decision.finalSummary,
      estimatedRemainingRounds: 0,
      completionRoundSummaries: decision.roundSummaries ?? existing.completionRoundSummaries,
      completionRequirementCoverage: decision.requirementCoverage ?? existing.completionRequirementCoverage,
      autoSleepStartedAt: undefined,
      autoWakeAt: undefined,
      autoSleepReason: undefined,
      updatedAt: Date.now(),
    }) ?? existing;
    appendLoopMainDecisionSummary(task, decision);
    appendLoopMainSubChatMainDecision(task, decision);
    return { status: "completed", task };
  }
  if (decision.status === "sleep") {
    const sleepDecision = normalizeLoopSleepDecision(decision);
    if (!sleepDecision) {
      throw new Error(`loop-task-invalid-sleep-decision:${taskId}`);
    }
    const autoSleepStartedAt = Date.now();
    const autoWakeAt = resolveLoopAutoWakeAt(autoSleepStartedAt, sleepDecision.wakeAfterSeconds);
    const task = updateLoopTaskRecord(taskId, {
      status: "sleeping",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      autoSleepStartedAt,
      autoWakeAt,
      autoSleepReason: sleepDecision.sleepReason,
      ...(typeof decision.estimatedRemainingRounds === "number" ? { estimatedRemainingRounds: decision.estimatedRemainingRounds } : {}),
      updatedAt: autoSleepStartedAt,
    }) ?? existing;
    appendLoopMainDecisionSummary(task, decision);
    appendLoopMainSubChatMainDecision(task, decision);
    return { status: "sleeping", task };
  }
  if (decision.status === "blocked") {
    const task = updateLoopTaskRecord(taskId, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      finalSummary: decision.finalSummary ?? "Main task reported blocked.",
      ...(typeof decision.estimatedRemainingRounds === "number" ? { estimatedRemainingRounds: decision.estimatedRemainingRounds } : {}),
      autoSleepStartedAt: undefined,
      autoWakeAt: undefined,
      autoSleepReason: undefined,
      updatedAt: Date.now(),
    }) ?? existing;
    appendLoopMainDecisionSummary(task, decision);
    appendLoopMainSubChatMainDecision(task, decision);
    return { status: "blocked", task };
  }

  const decisionSubtasks = getLoopDecisionSubtasks(decision);
  if (decisionSubtasks.length === 0) {
    const task = updateLoopTaskRecord(taskId, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      finalSummary: "Main task returned continue without subtasks.",
      autoSleepStartedAt: undefined,
      autoWakeAt: undefined,
      autoSleepReason: undefined,
      updatedAt: Date.now(),
    }) ?? existing;
    return { status: "blocked", task };
  }

  const subtaskBatch = upsertLoopSubtasks(existing, decisionSubtasks);
  const activeSubtaskIds = subtaskBatch.records.map((item) => item.id);
  const task = updateLoopTaskRecord(taskId, {
    status: "running",
    activeSubtaskId: activeSubtaskIds[0] ?? null,
    activeSubtaskIds,
    subTasks: subtaskBatch.nextSubtasks,
    ...(typeof decision.estimatedRemainingRounds === "number" ? { estimatedRemainingRounds: decision.estimatedRemainingRounds } : {}),
    autoSleepStartedAt: undefined,
    autoWakeAt: undefined,
    autoSleepReason: undefined,
    updatedAt: Date.now(),
  }) ?? existing;
  appendLoopMainDecisionSummary(task, decision);
  appendLoopMainSubChatMainDecision(task, decision, subtaskBatch.records);
  return { status: "continue", task, subtasks: subtaskBatch.records };
}

function getLoopDecisionSubtasks(decision: LoopMainDecision): LoopSubtaskDecision[] {
  if (Array.isArray(decision.subtasks) && decision.subtasks.length > 0) {
    return decision.subtasks;
  }
  return decision.subtask ? [decision.subtask] : [];
}

function appendLoopMainDecisionSummary(task: LoopTaskRecord, decision: LoopMainDecision): void {
  try {
    fs.mkdirSync(path.dirname(task.mainCommunicationFile), { recursive: true });
    const lines: string[] = [
      `## 主任务${decision.status === "completed" ? "最终验收" : "复核结论"}`,
      `- 时间：${new Date().toISOString()}`,
      `- 状态：${decision.status}`,
    ];
    if (decision.acceptance?.summary) {
      lines.push(`- 验收摘要：${decision.acceptance.summary}`);
    }
    const remainingRounds = formatLoopEstimatedRemainingRounds(decision.estimatedRemainingRounds);
    if (remainingRounds) {
      lines.push(`- 预计剩余轮次：${remainingRounds}`);
    }
    if (decision.status === "sleep") {
      lines.push(`- 自动睡眠原因：${task.autoSleepReason ?? decision.sleepReason ?? "未记录"}`);
      lines.push(`- 计划唤醒时间：${formatLoopAutoWakeAtForRecord(task.autoWakeAt)}`);
      lines.push(`- 唤醒间隔秒数：${decision.wakeAfterSeconds ?? "未记录"}`);
    }
    if (decision.status === "completed") {
      lines.push("");
      lines.push("### 问题回答结论");
      lines.push(resolveLoopAnswerConclusion(task, decision));
    }
    if (decision.finalSummary) {
      lines.push("");
      lines.push("### 整体总结");
      lines.push(decision.finalSummary);
    }
    const decisionSubtasks = getLoopDecisionSubtasks(decision);
    if (decisionSubtasks.length > 0) {
      lines.push("");
      lines.push(decisionSubtasks.length === 1 ? "### 下一步子任务" : "### 下一步并发子任务批次");
      if (decision.parallelReason) {
        lines.push(`- 并发判断：${decision.parallelReason}`);
      }
      decisionSubtasks.forEach((subtask, index) => {
        const prefix = decisionSubtasks.length === 1 ? "" : `${index + 1}. `;
        lines.push(`- ${prefix}子任务 ID：${subtask.id ?? buildLoopSubtaskId(subtask.title)}`);
        lines.push(`- ${prefix}标题：${subtask.title}`);
        if (subtask.conflictGroup) {
          lines.push(`- ${prefix}冲突组：${subtask.conflictGroup}`);
        }
        const writeFiles = formatLoopWriteFiles(subtask.writeFiles);
        if (writeFiles) {
          lines.push(`- ${prefix}预计写入：${writeFiles}`);
        }
        lines.push("");
        lines.push(`#### ${prefix}子任务指令`);
        lines.push(subtask.prompt);
      });
    }
    if (Array.isArray(decision.roundSummaries) && decision.roundSummaries.length > 0) {
      lines.push("");
      lines.push("### 各轮子任务摘要");
      decision.roundSummaries
        .slice()
        .sort((left, right) => left.round - right.round)
        .forEach((item) => {
          const subtaskSuffix = item.subtaskId ? `（${item.subtaskId}）` : "";
          lines.push(`- 第 ${item.round} 轮 ${item.title}${subtaskSuffix}：${item.summary}`);
        });
    }
    if (Array.isArray(decision.requirementCoverage) && decision.requirementCoverage.length > 0) {
      lines.push("");
      lines.push("### 用户需求覆盖清单");
      decision.requirementCoverage.forEach((item) => {
        const detail = item.detail ? `（${item.detail}）` : "";
        lines.push(`- ${item.name}：${item.passed ? "已覆盖" : "未覆盖"}${detail}`);
      });
    }
    fs.appendFileSync(task.mainCommunicationFile, `\n\n${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    void logError("loop-main-summary-write-error", {
      taskId: task.id,
      filePath: task.mainCommunicationFile,
      error: String(error),
    });
  }
}

function buildLoopSubtaskDecisionMarkdown(
  task: LoopTaskRecord,
  round: number,
  subtasks: LoopSubtaskRecord[],
  decision: LoopMainDecision,
): string {
  const acceptanceChecks = Array.isArray(decision.acceptance?.checks) ? decision.acceptance?.checks ?? [] : [];
  const lines: string[] = [
    subtasks.length === 1 ? "## Loop 子任务派发" : "## Loop 并发子任务派发",
    "",
    `- 任务 ID：${task.id}`,
    `- 轮次：${round}`,
    `- 子任务数量：${subtasks.length}`,
    `- 决策状态：${decision.status}`,
  ];

  if (decision.acceptance?.summary) {
    lines.push(`- 本轮复核：${decision.acceptance.summary}`);
  }
  const remainingRounds = formatLoopEstimatedRemainingRounds(decision.estimatedRemainingRounds);
  if (remainingRounds) {
    lines.push(`- 预计剩余轮次：${remainingRounds}`);
  }
  if (decision.parallelReason) {
    lines.push(`- 并发判断：${decision.parallelReason}`);
  }
  if (subtasks.length === 1 && subtasks[0]) {
    lines.push(`- 子任务 ID：${subtasks[0].id}`);
    lines.push(`- 子任务标题：${subtasks[0].title}`);
    if (subtasks[0].conflictGroup) {
      lines.push(`- 冲突组：${subtasks[0].conflictGroup}`);
    }
    const writeFiles = formatLoopWriteFiles(subtasks[0].writeFiles);
    if (writeFiles) {
      lines.push(`- 预计写入：${writeFiles}`);
    }
  }

  if (acceptanceChecks.length > 0) {
    lines.push("");
    lines.push("### 复核检查");
    acceptanceChecks.forEach((check) => {
      const detail = check.detail ? `（${check.detail}）` : "";
      lines.push(`- ${check.name}：${check.passed ? "通过" : "未通过"}${detail}`);
    });
  }

  lines.push("");
  lines.push(subtasks.length === 1 ? "### 子任务指令" : "### 子任务指令批次");
  subtasks.forEach((subtask, index) => {
    if (subtasks.length > 1) {
      lines.push("");
      lines.push(`#### ${index + 1}. ${subtask.title}`);
      lines.push(`- 子任务 ID：${subtask.id}`);
      if (subtask.conflictGroup) {
        lines.push(`- 冲突组：${subtask.conflictGroup}`);
      }
      const writeFiles = formatLoopWriteFiles(subtask.writeFiles);
      if (writeFiles) {
        lines.push(`- 预计写入：${writeFiles}`);
      }
    }
    lines.push(subtask.prompt ?? subtask.title);
  });

  return `${lines.join("\n")}\n`;
}

function upsertLoopSubtask(
  task: LoopTaskRecord,
  subtask: NonNullable<LoopMainDecision["subtask"]>,
): { record: LoopSubtaskRecord; nextSubtasks: LoopSubtaskRecord[] } {
  const now = Date.now();
  const id = subtask.id && subtask.id.trim() ? subtask.id.trim() : buildLoopSubtaskId(subtask.title);
  const nextSubtasks = [...task.subTasks];
  const existingIndex = nextSubtasks.findIndex((item) => item.id === id);
  const record: LoopSubtaskRecord = {
    id,
    title: subtask.title,
    prompt: subtask.prompt,
    conflictGroup: subtask.conflictGroup,
    writeFiles: subtask.writeFiles,
    status: "running",
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    const { skillIds: _skillIds, skillGuidance: _skillGuidance, ...existingRecord } = nextSubtasks[existingIndex];
    const nextRecord: LoopSubtaskRecord = {
      ...existingRecord,
      ...record,
      status: existingRecord.status === "completed" ? "completed" : "running",
    };
    nextSubtasks[existingIndex] = nextRecord;
    return { record: nextRecord, nextSubtasks };
  }
  nextSubtasks.push(record);
  return { record, nextSubtasks };
}

function upsertLoopSubtasks(
  task: LoopTaskRecord,
  subtasks: LoopSubtaskDecision[],
): { records: LoopSubtaskRecord[]; nextSubtasks: LoopSubtaskRecord[] } {
  let nextSubtasks = [...task.subTasks];
  const records: LoopSubtaskRecord[] = [];
  subtasks.forEach((subtask) => {
    const id = subtask.id && subtask.id.trim() ? subtask.id.trim() : buildLoopSubtaskId(subtask.title);
    const result = upsertLoopSubtask(
      { ...task, subTasks: nextSubtasks },
      subtask,
    );
    nextSubtasks = result.nextSubtasks;
    records.push(result.record);
  });
  return { records, nextSubtasks };
}

function getActiveLoopSubtaskIds(task: LoopTaskRecord): string[] {
  const ids = Array.isArray(task.activeSubtaskIds) ? task.activeSubtaskIds : [];
  const normalized = ids.filter((id) => typeof id === "string" && id.trim());
  if (task.activeSubtaskId && !normalized.includes(task.activeSubtaskId)) {
    normalized.unshift(task.activeSubtaskId);
  }
  return Array.from(new Set(normalized));
}

function markLoopSubtaskRunFinished(
  taskId: string,
  subtaskId: string,
  runStatus: TaskRunStatus,
  assistantContent: string | null,
): void {
  const task = readLoopTaskRecord(taskId);
  if (!task) {
    return;
  }
  const subtaskRecord = task.subTasks.find((item) => item.id === subtaskId);
  const now = Date.now();
  const summary = buildLoopSubtaskCompletionSummary(assistantContent);
  const nextStatus: LoopSubtaskRecord["status"] = runStatus === "end" ? "completed" : "blocked";
  const subTasks = task.subTasks.map((item) => {
    if (item.id !== subtaskId) {
      return item;
    }
    return {
      ...item,
      status: nextStatus,
      summary: summary ?? item.summary,
      updatedAt: now,
    };
  });
  const activeSubtaskIds = getActiveLoopSubtaskIds(task).filter((id) => id !== subtaskId);
  updateLoopTaskRecord(taskId, {
    subTasks,
    activeSubtaskId: activeSubtaskIds[0] ?? null,
    activeSubtaskIds,
    updatedAt: now,
  });
  appendLoopSubtaskCompletionAutoLog(task, subtaskRecord, runStatus, summary, assistantContent);
  if (subtaskRecord) {
    appendLoopMainSubChatSubtaskFinished(task, subtaskRecord, runStatus, assistantContent);
  } else {
    refreshOpenLoopGroupChatPanelForTask(taskId);
  }
}

async function finalizeLoopSubtaskRun(options: LoopSubtaskCompletionOptions): Promise<void> {
  await finalizeLoopSubtaskRunWithDeps(options, {
    markSubtaskRunFinished: markLoopSubtaskRunFinished,
    closeSubtaskTab: closeConversationTabAndRefreshPanel,
    logSubtaskTabAutoClosed: ({ taskId, round, subtaskId, tabId }) => {
      void logInfo("loop-subtask-tab-auto-closed", {
        taskId,
        round,
        subtaskId,
        tabId,
      });
    },
  });
}

function buildLoopSubtaskCompletionSummary(content: string | null): string | undefined {
  const normalized = String(content ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 1000 ? `${normalized.slice(0, 1000)}...` : normalized;
}

function appendLoopSubtaskCompletionAutoLog(
  task: LoopTaskRecord,
  subtask: LoopSubtaskRecord | undefined,
  runStatus: TaskRunStatus,
  summary?: string,
  assistantContent?: string | null,
): void {
  const filePath = typeof subtask?.communicationFile === "string" && subtask.communicationFile.trim()
    ? subtask.communicationFile
    : null;
  if (!filePath || !subtask) {
    return;
  }

  let existingContent = "";
  try {
    if (fs.existsSync(filePath)) {
      existingContent = fs.readFileSync(filePath, "utf8");
    }
  } catch (error) {
    void logError("loop-subtask-communication-read-error", {
      taskId: task.id,
      subtaskId: subtask.id,
      filePath,
      error: String(error),
    });
  }

  const verification = detectLoopVerificationSignals(`${existingContent}\n${assistantContent ?? ""}`);
  const lines = [
    "",
    `## 扩展自动记录（${new Date().toISOString()}）`,
    `- 子任务 ID：${subtask.id}`,
    `- 子任务标题：${subtask.title}`,
    `- 运行状态：${runStatus === "end" ? "completed" : runStatus}`,
    `- 单测状态：${formatLoopVerificationState(verification.unitTest)}`,
    `- 编译状态：${formatLoopVerificationState(verification.build)}`,
  ];
  if (verification.unitTestEvidence) {
    lines.push(`- 单测依据：${verification.unitTestEvidence}`);
  }
  if (verification.buildEvidence) {
    lines.push(`- 编译依据：${verification.buildEvidence}`);
  }
  if (summary) {
    lines.push(`- 输出摘要：${summary}`);
  }
  if (verification.unitTest === "unknown" || verification.build === "unknown") {
    lines.push("- 备注：当前记录未明确声明全部验证结果，主任务复核时需重点确认。");
  }

  try {
    fs.appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    void logError("loop-subtask-communication-append-error", {
      taskId: task.id,
      subtaskId: subtask.id,
      filePath,
      error: String(error),
    });
  }
}

function markLoopTaskInterrupted(
  taskId: string,
  status: "error" | "stopped",
  target: PromptRunTarget,
  options: { source: "main" | "subtask"; failureMessage?: string | null } = { source: "main" }
): void {
  const existing = readLoopTaskRecord(taskId);
  if (existing && existing.status !== "running") {
    return;
  }
  const now = Date.now();
  const patch: Partial<LoopTaskRecord> = {
    status,
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: now,
  };
  if (options.source === "main" && status === "error") {
    Object.assign(patch, buildNextLoopMainAiFailureState(existing ?? {}, {
      now,
      failureMessage: options.failureMessage,
    }));
    if (isLoopMainAiFailureLimitReached({
      mainAiFailureCount: patch.mainAiFailureCount,
      mainAiFailureLimitReached: patch.mainAiFailureLimitReached,
    })) {
      patch.status = "needs-review";
      patch.finalSummary = [
        `主任务 AI 调用已连续失败 ${patch.mainAiFailureCount}/${LOOP_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`,
        options.failureMessage ? `最近一次失败：${options.failureMessage}` : "",
      ].filter(Boolean).join("\n");
    }
  }
  const record = updateLoopTaskRecord(taskId, patch) ?? existing;
  if (record) {
    appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(record));
  }
}

function isLoopTaskExecutionInterrupted(taskId: string): boolean {
  const status = readLoopTaskRecord(taskId)?.status;
  return status === "needs-review" || status === "error" || status === "stopped";
}

function markLoopTaskStopped(
  taskId: string,
  options: {
    finalSummary?: string;
    subtaskSummary?: string;
    participantSummary?: string;
  } = {},
): LoopTaskRecord | null {
  const task = readLoopTaskRecord(taskId);
  if (!task || isLoopTaskCompleted(task)) {
    return task;
  }

  const now = Date.now();
  const activeSubtaskIds = new Set(getActiveLoopSubtaskIds(task));
  const subTasks = task.subTasks.map((subtask) => {
    const shouldStopSubtask = activeSubtaskIds.has(subtask.id)
      || subtask.status === "running"
      || subtask.status === "pending";
    if (!shouldStopSubtask) {
      return subtask;
    }
    return {
      ...subtask,
      status: "blocked" as const,
      ...(subtask.summary || options.subtaskSummary
        ? { summary: subtask.summary || options.subtaskSummary }
        : {}),
      updatedAt: now,
    };
  });
  const debateRounds = task.debateRounds?.map((round) => {
    const participants = round.participants.map((participant) => {
      if (participant.status !== "running" && participant.status !== "pending") {
        return participant;
      }
      return {
        ...participant,
        status: "stopped" as const,
        ...(participant.summary || options.participantSummary
          ? { summary: participant.summary || options.participantSummary }
          : {}),
        updatedAt: now,
      };
    });
    const shouldStopRound = round.status === "running"
      || Boolean(round.activeSpeaker)
      || round.participants.some((participant) => participant.status === "running" || participant.status === "pending");
    if (!shouldStopRound) {
      return { ...round, participants };
    }
    return {
      ...round,
      status: "stopped" as const,
      completedAt: round.completedAt ?? now,
      activeSpeaker: undefined,
      participants,
    };
  });

  const record = updateLoopTaskRecord(taskId, {
    status: "stopped",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    autoSleepStartedAt: undefined,
    autoWakeAt: undefined,
    autoSleepReason: undefined,
    subTasks,
    ...(debateRounds ? { debateRounds } : {}),
    ...(options.finalSummary ? { finalSummary: options.finalSummary } : {}),
    updatedAt: now,
  });
  refreshOpenLoopGroupChatPanelForTask(taskId);
  return record;
}

function markLoopTaskStoppedByUser(taskId: string): LoopTaskRecord | null {
  cancelLoopTaskAutoWake(taskId);
  return markLoopTaskStopped(taskId, {
    finalSummary: "用户已从 Loop 群聊中止任务。",
    subtaskSummary: "用户已从 Loop 群聊中止该子任务。",
    participantSummary: "用户已从 Loop 群聊中止该参与者任务。",
  });
}

function markLoopTaskStoppedAfterRuntimeEnded(taskId: string): LoopTaskRecord | null {
  const record = markLoopTaskStopped(taskId);
  if (record) {
    void logInfo("loop-task-runtime-state-reconciled", {
      taskId,
      previousStatus: "running",
      nextStatus: record.status,
    });
  }
  return record;
}

function resolvePromptRunTargetFromConversationTab(tab: ConversationTabRecord): PromptRunTarget {
  return {
    tabId: tab.id,
    cli: tab.cli,
    sessionId: getConversationTabSessionIdForCli(tab, tab.cli),
  };
}

function resolveLoopMainPromptTarget(task: LoopTaskRecord): PromptRunTarget | null {
  const state = ensureConversationTabs();
  let sessionFallback: ConversationTabRecord | null = null;
  for (const tab of state.tabs) {
    if (tab.cli !== task.cli) {
      continue;
    }
    const context = resolveConversationTabLoopContext(tab);
    if (context.taskRole === "main" && context.loopTaskId === task.id) {
      return resolvePromptRunTargetFromConversationTab(tab);
    }
    if (
      !sessionFallback
      && task.sessionId
      && getConversationTabSessionIdForCli(tab, tab.cli) === task.sessionId
    ) {
      sessionFallback = tab;
    }
  }
  if (sessionFallback) {
    return resolvePromptRunTargetFromConversationTab(sessionFallback);
  }

  const newTab: ConversationTabRecord = {
    id: createConversationTabId(),
    cli: task.cli,
    sessionId: task.sessionId ?? null,
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, task.cli, task.sessionId ?? null),
    createdAt: Date.now(),
  };
  state.tabs.push(newTab);
  persistConversationTabsToWorkspaceSettings();
  void postPanelState();
  return resolvePromptRunTargetFromConversationTab(newTab);
}

async function maybeWakeLoopMainAfterSubtaskContinuation(
  context: LoopSubtaskConversationContext,
  options: {
    tabId: string;
    previousRunEndedAt: number;
    model?: string;
    loopMainModel?: string;
    loopSubtaskModel?: string;
    loopMainThinkingMode?: ThinkingMode;
    loopSubtaskThinkingMode?: ThinkingMode;
  }
): Promise<void> {
  const latestRun = getLatestLoopRoundRunRecord(
    context.taskId,
    context.round,
    "subtask",
    context.subtaskId
  );
  if (!latestRun || latestRun.endedAt <= options.previousRunEndedAt || latestRun.status !== "end") {
    return;
  }

  const subtaskTarget = resolvePromptRunTarget(options.tabId);
  const summary = subtaskTarget
    ? getLastLoopAssistantContent(subtaskTarget, context.taskId, context.round, "subtask")
    : null;
  await finalizeLoopSubtaskRun({
    taskId: context.taskId,
    round: context.round,
    subtaskId: context.subtaskId,
    runStatus: "end",
    assistantContent: summary,
    tabId: subtaskTarget?.tabId ?? null,
  });

  const latestTask = readLoopTaskRecord(context.taskId);
  if (
    !latestTask
    || isLoopTaskBlockedByMainAiFailureLimit(latestTask)
    || (latestTask.status !== "error" && latestTask.status !== "stopped")
  ) {
    return;
  }

  const mainTarget = resolveLoopMainPromptTarget(latestTask);
  if (!mainTarget || isTabRunActive(mainTarget.tabId)) {
    return;
  }

  const resumedSubtask = latestTask.subTasks.find((item) => item.id === context.subtaskId);
  appendSystemMessageForLoop(
    mainTarget,
    buildLoopMainResumeText(latestTask.id, resolveLoopResumeRound(latestTask), resumedSubtask ? [resumedSubtask] : [])
  );

  const resumePrompt = t("run.hiddenContinuePrompt");
  await runLoopPrompt({
    displayPrompt: resumePrompt,
    modelPrompt: resumePrompt,
    contextTags: [],
    model: options.model,
    loopMainModel: options.loopMainModel,
    loopSubtaskModel: options.loopSubtaskModel,
    loopMainThinkingMode: options.loopMainThinkingMode,
    loopSubtaskThinkingMode: options.loopSubtaskThinkingMode,
  }, {
    targetTabId: mainTarget.tabId,
    resumeTaskId: latestTask.id,
    resumeRequested: true,
  });
}

function getLoopTargetSessionId(target: PromptRunTarget): string | null {
  const tab = getConversationTabById(target.tabId);
  return tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
}

function persistLoopMessagesForTarget(target: PromptRunTarget, messages: ChatMessage[]): void {
  const sessionId = getLoopTargetSessionId(target);
  persistMessagesForTab(target.cli, sessionId, target.tabId, messages);
}

function removeLoopMainDecisionMessage(
  target: PromptRunTarget,
  taskId: string,
  round: number,
): void {
  const messages = getLoopMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === "main"
      && message.loopTaskId === taskId
      && message.loopRound === round
    ) {
      messages.splice(index, 1);
      persistLoopMessagesForTarget(target, messages);
      sendPanelMessage({ type: "removeMessage", id: message.id, tabId: target.tabId });
      return;
    }
  }
}

function replaceLoopMainDecisionMessageWithMarkdown(
  target: PromptRunTarget,
  taskId: string,
  round: number,
  content: string,
): boolean {
  const messages = getLoopMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === "main"
      && message.loopTaskId === taskId
      && message.loopRound === round
    ) {
      const nextMessage: ChatMessage = {
        ...message,
        content,
        merge: false,
      };
      messages[index] = nextMessage;
      persistLoopMessagesForTarget(target, messages);
      sendPanelMessage({ type: "replaceMessage", message: nextMessage, tabId: target.tabId });
      return true;
    }
  }
  return false;
}

function showLoopSubtaskDecisionMarkdown(
  target: PromptRunTarget,
  task: LoopTaskRecord,
  round: number,
  subtasks: LoopSubtaskRecord[],
  decision: LoopMainDecision,
): void {
  const content = buildLoopSubtaskDecisionMarkdown(task, round, subtasks, decision);
  if (replaceLoopMainDecisionMessageWithMarkdown(target, task.id, round, content)) {
    return;
  }

  const messages = getLoopMessagesForTarget(target);
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    loopTaskId: task.id,
    loopRound: round,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function showLoopAutoSleepMessage(
  target: PromptRunTarget,
  task: LoopTaskRecord,
  round: number,
  decision: LoopMainDecision,
): void {
  const content = buildLoopAutoSleepMessageMarkdown(task, decision);
  if (replaceLoopMainDecisionMessageWithMarkdown(target, task.id, round, content)) {
    return;
  }

  const messages = getLoopMessagesForTarget(target);
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    loopTaskId: task.id,
    loopRound: round,
    actions: [buildLoopDebateChatMessageAction(task.id, round)],
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function buildLoopAutoSleepMessageMarkdown(task: LoopTaskRecord, decision: LoopMainDecision): string {
  const locale = resolveLocale();
  const wakeAt = typeof task.autoWakeAt === "number"
    ? new Date(task.autoWakeAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")
    : t("run.loopAutoWakeTimeUnknown");
  const reason = task.autoSleepReason ?? decision.sleepReason ?? t("run.loopAutoSleepReasonUnknown");
  return [
    `## ${t("run.loopAutoSleepTitle")}`,
    t("run.loopAutoSleepReason", { reason }),
    t("run.loopAutoWakeAt", { time: wakeAt }),
  ].join("\n\n");
}

function hasCompleteLoopCompletionMessagesForTask(target: PromptRunTarget, taskId: string): boolean {
  return hasCompleteLoopCompletionMessages(getLoopMessagesForTarget(target), taskId);
}

function appendLoopAnswerConclusionMessage(
  target: PromptRunTarget,
  task: LoopTaskRecord,
  decision?: LoopMainDecision | null,
): void {
  const messages = getLoopMessagesForTarget(target);
  const content = buildLoopAnswerConclusionMarkdown(task, decision);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!existing || !isLoopAnswerConclusionMessageForTask(existing, task.id)) {
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
      loopTaskId: task.id,
      loopAnswerConclusion: true,
    };
    messages[index] = replacement;
    sendPanelMessage({ type: "replaceMessage", message: replacement, tabId: target.tabId });
    persistLoopMessagesForTarget(target, messages);
    return;
  }
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    loopTaskId: task.id,
    loopAnswerConclusion: true,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function appendLoopFinalSummaryMessage(
  target: PromptRunTarget,
  task: LoopTaskRecord,
  decision?: LoopMainDecision | null,
): void {
  const messages = getLoopMessagesForTarget(target);
  const content = buildLoopFinalSummaryMarkdown(task, decision);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!existing || !isLoopFinalSummaryMessageForTask(existing, task.id)) {
      continue;
    }
    if (isCompleteLoopFinalSummaryContent(existing.content)) {
      return;
    }
    const replacement: ChatMessage = {
      ...existing,
      content,
      merge: false,
      taskRole: "main",
      loopTaskId: task.id,
      loopFinalSummary: true,
    };
    messages[index] = replacement;
    sendPanelMessage({ type: "replaceMessage", message: replacement, tabId: target.tabId });
    persistLoopMessagesForTarget(target, messages);
    return;
  }
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    loopTaskId: task.id,
    loopFinalSummary: true,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function appendSystemMessageForLoop(
  target: PromptRunTarget,
  content: string,
  options: {
    taskRole?: LoopTaskRole;
    loopTaskId?: string;
    loopRound?: number;
    loopSubtaskId?: string;
    actions?: ChatMessageAction[];
    merge?: boolean;
  } = {},
): void {
  const tab = getConversationTabById(target.tabId);
  const sessionId = tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
  const messages = sessionId
    ? loadSessionMessages(target.cli, sessionId)
    : getPendingSessionDraft(target.tabId, target.cli).messages;
  const message: ChatMessage = {
    id: createMessageId(),
    role: "system",
    content,
    createdAt: Date.now(),
    ...(options.merge === false ? { merge: false } : {}),
    ...(options.taskRole ? { taskRole: options.taskRole } : {}),
    ...(options.loopTaskId ? { loopTaskId: options.loopTaskId } : {}),
    ...(typeof options.loopRound === "number" ? { loopRound: options.loopRound } : {}),
    ...(options.loopSubtaskId ? { loopSubtaskId: options.loopSubtaskId } : {}),
    ...(options.actions?.length ? { actions: options.actions } : {}),
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  if (sessionId) {
    persistMessagesForTab(target.cli, sessionId, target.tabId, messages);
    return;
  }
  // Keep loop pre-run system messages in draft only, so the first real turn can
  // start a fresh remote session instead of being blocked by a local-only session id.
  updatePendingSessionDraft(target.tabId, { messages }, target.cli);
}

function getLoopRoundRunStatus(
  taskId: string,
  round: number,
  role: LoopTaskRole,
  subtaskId?: string,
): TaskRunStatus | null {
  const record = getLatestLoopRoundRunRecord(taskId, round, role, subtaskId);
  return record ? record.status : null;
}

function getLatestLoopRoundRunRecord(
  taskId: string,
  round: number,
  role: LoopTaskRole,
  subtaskId?: string,
): TaskRunRecord | null {
  const runs = readTaskStore().runs;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (
      run.loopTaskId === taskId
      && run.loopRound === round
      && run.taskRole === role
      && (role !== "subtask" || run.loopSubtaskId === subtaskId)
    ) {
      return run;
    }
  }
  return null;
}

return {
  resolvePromptRunTarget: wrap(resolvePromptRunTarget),
  collectRecentLoopTaskIdsForTarget: wrap(collectRecentLoopTaskIdsForTarget),
  isLoopTaskCompatibleWithTarget: wrap(isLoopTaskCompatibleWithTarget),
  findResumableLoopTaskForTarget: wrap(findResumableLoopTaskForTarget),
  getLoopMessagesForTarget: wrap(getLoopMessagesForTarget),
  resolveLoopSubtaskConversationContext: wrap(resolveLoopSubtaskConversationContext),
  isLoopSubtaskConversationTarget: wrap(isLoopSubtaskConversationTarget),
  getLastLoopAssistantContent: wrap(getLastLoopAssistantContent),
  parseLoopMainDecision: wrap(parseLoopMainDecision),
  extractJsonObjectText: wrap(extractJsonObjectText),
  normalizeLoopMainDecision: wrap(normalizeLoopMainDecision),
  normalizeLoopEstimatedRemainingRounds: wrap(normalizeLoopEstimatedRemainingRounds),
  normalizeLoopSubtaskDecisions: wrap(normalizeLoopSubtaskDecisions),
  normalizeSingleLoopSubtaskDecision: wrap(normalizeSingleLoopSubtaskDecision),
  normalizeLoopRoundSummaries: wrap(normalizeLoopRoundSummaries),
  normalizeSingleLoopRoundSummary: wrap(normalizeSingleLoopRoundSummary),
  normalizeLoopAcceptance: wrap(normalizeLoopAcceptance),
  normalizeLoopAcceptanceChecks: wrap(normalizeLoopAcceptanceChecks),
  buildLoopSubtaskId: wrap(buildLoopSubtaskId),
  applyLoopMainDecision: wrap(applyLoopMainDecision),
  getLoopDecisionSubtasks: wrap(getLoopDecisionSubtasks),
  appendLoopMainDecisionSummary: wrap(appendLoopMainDecisionSummary),
  buildLoopSubtaskDecisionMarkdown: wrap(buildLoopSubtaskDecisionMarkdown),
  upsertLoopSubtask: wrap(upsertLoopSubtask),
  upsertLoopSubtasks: wrap(upsertLoopSubtasks),
  getActiveLoopSubtaskIds: wrap(getActiveLoopSubtaskIds),
  markLoopSubtaskRunFinished: wrap(markLoopSubtaskRunFinished),
  finalizeLoopSubtaskRun: wrap(finalizeLoopSubtaskRun),
  buildLoopSubtaskCompletionSummary: wrap(buildLoopSubtaskCompletionSummary),
  appendLoopSubtaskCompletionAutoLog: wrap(appendLoopSubtaskCompletionAutoLog),
  markLoopTaskInterrupted: wrap(markLoopTaskInterrupted),
  isLoopTaskExecutionInterrupted: wrap(isLoopTaskExecutionInterrupted),
  markLoopTaskStopped: wrap(markLoopTaskStopped),
  markLoopTaskStoppedByUser: wrap(markLoopTaskStoppedByUser),
  markLoopTaskStoppedAfterRuntimeEnded: wrap(markLoopTaskStoppedAfterRuntimeEnded),
  resolvePromptRunTargetFromConversationTab: wrap(resolvePromptRunTargetFromConversationTab),
  resolveLoopMainPromptTarget: wrap(resolveLoopMainPromptTarget),
  maybeWakeLoopMainAfterSubtaskContinuation: wrap(maybeWakeLoopMainAfterSubtaskContinuation),
  getLoopTargetSessionId: wrap(getLoopTargetSessionId),
  persistLoopMessagesForTarget: wrap(persistLoopMessagesForTarget),
  removeLoopMainDecisionMessage: wrap(removeLoopMainDecisionMessage),
  replaceLoopMainDecisionMessageWithMarkdown: wrap(replaceLoopMainDecisionMessageWithMarkdown),
  showLoopSubtaskDecisionMarkdown: wrap(showLoopSubtaskDecisionMarkdown),
  showLoopAutoSleepMessage: wrap(showLoopAutoSleepMessage),
  buildLoopAutoSleepMessageMarkdown: wrap(buildLoopAutoSleepMessageMarkdown),
  hasCompleteLoopCompletionMessagesForTask: wrap(hasCompleteLoopCompletionMessagesForTask),
  appendLoopAnswerConclusionMessage: wrap(appendLoopAnswerConclusionMessage),
  appendLoopFinalSummaryMessage: wrap(appendLoopFinalSummaryMessage),
  appendSystemMessageForLoop: wrap(appendSystemMessageForLoop),
  getLoopRoundRunStatus: wrap(getLoopRoundRunStatus),
  getLatestLoopRoundRunRecord: wrap(getLatestLoopRoundRunRecord),
};
}
