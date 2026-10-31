import * as fs from "fs";
import * as path from "path";
import type { CliName, ThinkingMode } from "../cli/types";
import type { GraphModelRole } from "../graph/types";
import type { I18nKey } from "../i18n";
import type { ChatMessage } from "../webview/types";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import { resolveStoredSubtaskExecution } from "../subtaskCliRoute";
import type { SubagentProgressController, SubagentProgressLabels, SubagentProgressUpdate } from "../subagentProgress";
import type { LoopTaskRole, TaskRunStatus } from "../promptRunState";
import type { LoopMainDecision, LoopSubtaskRecord, LoopTaskRecord } from "../loopTaskStore";
import { bindLoopSubtaskSession, resolveLoopSubtaskSession, withLoopSubtaskSession } from "../loopSubtaskSession";
import { LOOP_MAIN_STALE_TASK_LIST_RULE_ZH } from "../loopMainTaskListPolicy";
import { buildStructuredSvgSummaryPromptInstruction } from "../finalAnswerProtocol";

export const LOOP_PARALLEL_SUBTASK_MAX = 6;
export const LOOP_SUBTASK_LAUNCH_INTERVAL_MS = 3 * 1000;
export const LOOP_SUBTASK_RETRY_MAX_RETRIES = 5;
export const LOOP_SUBTASK_RETRY_DELAY_MS = 60 * 1000;

export function getLoopSubtaskLaunchDelayMs(
  lastLaunchAt: number | null,
  now = Date.now(),
): number {
  if (lastLaunchAt === null) {
    return 0;
  }
  return Math.max(0, LOOP_SUBTASK_LAUNCH_INTERVAL_MS - (now - lastLaunchAt));
}

type PromptRunRuntimeHostApi = ReturnType<typeof import("./promptRunRuntime").createPromptRunRuntimeHost>;
type LoopTaskStoreApi = typeof import("../loopTaskStore");
type PromptRunStateApi = typeof import("../promptRunState");
type LoopSubtaskProgressApi = typeof import("../loopSubtaskProgress");
type LoopParallelApi = typeof import("../loopParallel");
type LoopMainFailureApi = typeof import("../loopMainFailure");
type PanelStateBuilderApi = typeof import("../panelStateBuilder");
type WebviewCommandCoordinatorApi = typeof import("../webviewCommandCoordinator");

type LoopOrchestrationPromptRunDeps = Pick<
  PromptRunRuntimeHostApi,
  | "appendSystemMessageForLoop"
  | "applyLoopMainDecision"
  | "finalizeLoopSubtaskRun"
  | "getActiveLoopSubtaskIds"
  | "getLastLoopAssistantContent"
  | "getLoopMessagesForTarget"
  | "getLoopRoundRunStatus"
  | "isLoopTaskExecutionInterrupted"
  | "markLoopSubtaskRunFinished"
  | "markLoopTaskInterrupted"
  | "parseLoopMainDecision"
  | "persistLoopMessagesForTarget"
>;

type LoopOrchestrationTaskStoreDeps = Pick<
  LoopTaskStoreApi,
  | "appendLoopRound"
  | "bindLoopTaskToSession"
  | "buildLoopSubtaskCommunicationFile"
  | "getLoopCommunicationPaths"
  | "prepareLoopSubtaskCommunicationFile"
  | "readLoopTaskRecord"
  | "updateLoopTaskRecord"
>;

type LoopOrchestrationGroupChatDeps = Pick<
  typeof import("../loopGroupChat"),
  | "buildLoopMainSubSubtaskTurnBody"
  | "formatLoopGroupChatMemberName"
  | "resolveLoopAnswerConclusion"
>;

type LoopOrchestrationTextDeps = Pick<
  WebviewCommandCoordinatorApi,
  | "buildLoopCompletedConclusionAndSummaryMarkdown"
  | "buildLoopRoundSummary"
  | "buildLoopSupplementalRequirementsLines"
>;

type LoopOrchestrationRequiredHostDeps =
  & LoopOrchestrationPromptRunDeps
  & LoopOrchestrationTaskStoreDeps
  & LoopOrchestrationGroupChatDeps
  & LoopOrchestrationTextDeps
  & Pick<PromptRunStateApi, "appendMessageToStore">
  & Pick<LoopSubtaskProgressApi, "createLoopSubtaskProgressMonitor" | "mapLoopRunStatusToSubagentStatus">
  & Pick<LoopParallelApi, "buildLoopSubtaskExecutionPlan">
  & Pick<LoopMainFailureApi, "buildResetLoopMainAiFailureState">
  & Pick<
    PanelStateBuilderApi,
    | "buildLoopSubtaskBatchCompletedText"
    | "buildLoopSubtaskBatchStartedText"
    | "buildLoopSubtaskExecutionGroupStartedText"
    | "buildLoopSubtaskStartedText"
    | "formatLoopEstimatedRemainingRounds"
    | "getLoopMainSubChatMainTitle"
    | "getLoopSubtaskDisplayTitle"
  >
  & {
    buildSubagentProgressLabels: () => SubagentProgressLabels;
    buildLoopSubtaskRetryText: (taskId: string, subtaskId: string, retryCount: number) => string;
    closeConversationTabAndRefreshPanel: (tabId: string) => Promise<void>;
    createLoopSubtaskRunTarget: (cli: CliName, options?: { sessionId?: string | null }) => PromptRunTarget;
    createMessageId: () => string;
    createSubagentProgressController: typeof import("../subagentProgress").createSubagentProgressController;
    ensureLoopMainSubChatTranscript: (task: LoopTaskRecord) => string;
    errorToMessage: (error: unknown) => string;
    getActiveConfigIdForCli: (cli: CliName) => string | null;
    logError: (event: string, payload?: unknown) => void | Promise<void>;
    normalizeLoopContinuePromptForPrompt: (value: unknown) => string | null;
    refreshOpenLoopGroupChatPanelForTask: (taskId: string) => void;
    resolveLoopTaskSessionId: (target: PromptRunTarget) => string | null;
    resolvePromptRunModelForRole: (input: PromptRunInput, role: GraphModelRole) => string | undefined;
    resolvePromptRunTargetSessionId: (target: PromptRunTarget) => string | null;
    resolvePromptRunThinkingModeForRole: (
      input: PromptRunInput,
      cli: CliName,
      role: GraphModelRole,
      model: string | undefined,
      options?: { applySubtaskCap?: boolean; configId?: string | null },
    ) => ThinkingMode | undefined;
    runPrompt: (
      input: PromptRunInput,
      options?: { targetTabId?: string | null; resumeTaskId?: string; resumeRequested?: boolean },
    ) => Promise<void>;
    sendPanelMessage: (payload: Record<string, unknown>) => void;
    switchVisibleConversationTabForLoop: (tabId: string) => Promise<{ cli: CliName; sessionId: string | null } | null>;
    t: (key: I18nKey, params?: Record<string, string | number | boolean>) => string;
  };

export type LoopOrchestrationHostDeps = Partial<LoopOrchestrationRequiredHostDeps>;

export function createLoopOrchestrationHost(deps: LoopOrchestrationHostDeps) {
  const requiredDeps = deps as LoopOrchestrationRequiredHostDeps;
  const {
    appendLoopRound,
    appendMessageToStore,
    appendSystemMessageForLoop,
    applyLoopMainDecision,
    bindLoopTaskToSession,
    buildLoopCompletedConclusionAndSummaryMarkdown,
    buildLoopMainSubSubtaskTurnBody,
    buildLoopRoundSummary,
    buildLoopSubtaskBatchCompletedText,
    buildLoopSubtaskBatchStartedText,
    buildLoopSubtaskCommunicationFile,
    buildLoopSubtaskExecutionGroupStartedText,
    buildLoopSubtaskExecutionPlan,
    buildLoopSubtaskRetryText,
    buildLoopSubtaskStartedText,
    buildLoopSupplementalRequirementsLines,
    buildResetLoopMainAiFailureState,
    buildSubagentProgressLabels,
    closeConversationTabAndRefreshPanel,
    createLoopSubtaskProgressMonitor,
    createLoopSubtaskRunTarget,
    createMessageId,
    createSubagentProgressController,
    ensureLoopMainSubChatTranscript,
    errorToMessage,
    finalizeLoopSubtaskRun,
    formatLoopEstimatedRemainingRounds,
    formatLoopGroupChatMemberName,
    getActiveLoopSubtaskIds,
    getLastLoopAssistantContent,
    getLoopCommunicationPaths,
    getLoopMainSubChatMainTitle,
    getLoopMessagesForTarget,
    getLoopRoundRunStatus,
    getLoopSubtaskDisplayTitle,
    isLoopTaskExecutionInterrupted,
    logError,
    mapLoopRunStatusToSubagentStatus,
    markLoopSubtaskRunFinished,
    markLoopTaskInterrupted,
    normalizeLoopContinuePromptForPrompt,
    parseLoopMainDecision,
    persistLoopMessagesForTarget,
    prepareLoopSubtaskCommunicationFile,
    readLoopTaskRecord,
    refreshOpenLoopGroupChatPanelForTask,
    resolveLoopAnswerConclusion,
    resolveLoopTaskSessionId,
    resolvePromptRunModelForRole,
    resolvePromptRunTargetSessionId,
    resolvePromptRunThinkingModeForRole,
    runPrompt,
    sendPanelMessage,
    switchVisibleConversationTabForLoop,
    t,
    updateLoopTaskRecord,
  } = requiredDeps;

  async function runClassicLoopMainDecision(options: {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
  }): Promise<LoopMainDecisionRunResult> {
    const { input, target, task, round } = options;
    let mainStatus: TaskRunStatus;
    try {
      mainStatus = await runLoopRound({
        input,
        target,
        task,
        round,
        role: "main",
        displayPrompt: buildLoopMainDisplayPrompt(task.rootPrompt, round),
        modelPrompt: buildLoopMainModelPrompt(
          input.loopContinuePrompt ? task.rootPrompt : (input.modelPrompt || task.rootPrompt),
          task,
          round,
          input.loopContinuePrompt,
        ),
      });
    } catch (error) {
      void logError("loop-main-round-run-error", {
        taskId: task.id,
        round,
        error: errorToMessage(error),
      });
      markLoopTaskInterrupted(task.id, "error", target, {
        source: "main",
        failureMessage: errorToMessage(error),
      });
      return { status: "interrupted", task: readLoopTaskRecord(task.id) ?? task, runStatus: "error" };
    }
    if (mainStatus === "error" || mainStatus === "stopped") {
      return { status: "interrupted", task, runStatus: mainStatus };
    }

    const mainContent = getLastLoopAssistantContent(target, task.id, round, "main");
    const decision = parseLoopMainDecision(mainContent);
    if (!decision) {
      void logError("loop-main-decision-invalid", {
        taskId: task.id,
        round,
        cli: target.cli,
        hasAssistantContent: Boolean(mainContent?.trim()),
        assistantContentLength: mainContent?.length ?? 0,
      });
      const failedRecord = updateLoopTaskRecord(task.id, {
        status: "needs-review",
        activeSubtaskId: null,
        activeSubtaskIds: [],
        updatedAt: Date.now(),
        finalSummary: "Main task did not return a valid loop decision JSON.",
      }) ?? task;
      return { status: "needs-review", task: failedRecord };
    }

    return applyLoopMainDecisionForRun(task.id, decision);
  }

  function applyLoopMainDecisionForRun(
    taskId: string,
    decision: LoopMainDecision,
  ): LoopMainDecisionRunResult {
    updateLoopTaskRecord(taskId, {
      ...buildResetLoopMainAiFailureState(),
      updatedAt: Date.now(),
    });
    const decisionResult = applyLoopMainDecision(taskId, decision);
    if (decisionResult.status === "completed") {
      return { status: "completed", task: decisionResult.task, decision };
    }
    if (decisionResult.status === "clarify") {
      return { status: "awaiting-input", task: decisionResult.task, decision };
    }
    if (decisionResult.status === "blocked" || !decisionResult.subtasks?.length) {
      return { status: "needs-review", task: decisionResult.task, decision };
    }
    return {
      status: "continue",
      task: decisionResult.task,
      decision,
      subtasks: decisionResult.subtasks,
    };
  }

  function readTextFileIfNonEmpty(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, "utf8").trim();
      return content ? content : null;
    } catch (error) {
      void logError("read-text-file-error", { filePath, error: String(error) });
      return null;
    }
  }

  function writeTextFileEnsuringDir(filePath: string, content: string): boolean {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf8");
      return true;
    } catch (error) {
      void logError("write-text-file-error", { filePath, error: String(error) });
      return false;
    }
  }

  function appendTextFileEnsuringDir(filePath: string, content: string): boolean {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, content, "utf8");
      return true;
    } catch (error) {
      void logError("append-text-file-error", { filePath, error: String(error) });
      return false;
    }
  }

  function appendLoopSupplementalRequirement(
    existing: readonly string[] | undefined,
    nextItem: string,
  ): string[] {
    const normalizedExisting = Array.isArray(existing)
      ? existing.map((item) => String(item).trim()).filter(Boolean)
      : [];
    return [...normalizedExisting, nextItem];
  }

  function appendLoopSupplementalRequirementToCommunication(
    task: LoopTaskRecord,
    requirement: string,
  ): void {
    const body = [
      `- 时间：${new Date().toISOString()}`,
      `- 主任务轮次：${Math.max(1, task.currentRound || 1)}`,
      requirement,
    ].join("\n");
    try {
      fs.mkdirSync(path.dirname(task.mainCommunicationFile), { recursive: true });
      fs.appendFileSync(task.mainCommunicationFile, `\n## 补充需求\n${body}\n`, "utf8");
    } catch (error) {
      void logError("loop-supplemental-requirement-write-error", {
        taskId: task.id,
        filePath: task.mainCommunicationFile,
        error: String(error),
      });
    }
    appendLoopMainSubChatSection(task, "补充需求", body);
  }

  function appendLoopMainSubChatTaskEvent(task: LoopTaskRecord, body: string): void {
    appendLoopMainSubChatSection(task, "任务事件", body);
  }

  function appendLoopMainSubChatMainDecision(
    task: LoopTaskRecord,
    decision: LoopMainDecision,
    subtasks: LoopSubtaskRecord[] = [],
  ): void {
    const round = Math.max(1, task.currentRound || 1);
    const bodyLines = [
      `- 时间：${new Date().toISOString()}`,
      `- 决策状态：${decision.status}`,
    ];
    const remainingRounds = formatLoopEstimatedRemainingRounds(decision.estimatedRemainingRounds);
    if (remainingRounds) {
      bodyLines.push(`- 预计剩余轮次：${remainingRounds}`);
    }
    if (decision.acceptance?.summary) {
      bodyLines.push(`- 复核摘要：${decision.acceptance.summary}`);
    }
    if (decision.parallelReason) {
      bodyLines.push(`- 并发判断：${decision.parallelReason}`);
    }
    if (subtasks.length > 0) {
      bodyLines.push("");
      bodyLines.push("### 派发子任务");
      subtasks.forEach((subtask, index) => {
        bodyLines.push(`- ${getLoopSubtaskDisplayTitle(index, subtask)}（${subtask.id}）：${subtask.status}`);
      });
    }
    if (decision.status === "completed") {
      bodyLines.push("");
      bodyLines.push("### 问题回答结论");
      bodyLines.push(resolveLoopAnswerConclusion(task, decision));
    }
    if (decision.status === "clarify" && decision.clarification) {
      bodyLines.push("");
      bodyLines.push("### 需要用户补充");
      bodyLines.push(decision.clarification.instruction);
      decision.clarification.formFields.forEach((field) => {
        bodyLines.push(`- ${field.label}`);
      });
    }
    if (decision.finalSummary) {
      bodyLines.push("");
      bodyLines.push("### 总结");
      bodyLines.push(decision.finalSummary);
    }
    bodyLines.unshift(`- 成员 ID：main`);
    const mainTitle = getLoopMainSubChatMainTitle();
    appendLoopMainSubChatSection(
      task,
      `主任务发言：第 ${round} 轮${formatLoopGroupChatMemberName(mainTitle)}`,
      bodyLines.join("\n"),
    );
    if (decision.status === "completed") {
      appendLoopMainSubChatSection(task, "群聊收束", buildLoopCompletedConclusionAndSummaryMarkdown(task, decision));
    }
  }

  function appendLoopMainSubChatSubtaskStarted(
    task: LoopTaskRecord,
    subtask: LoopSubtaskRecord,
    round: number,
    communicationFile: string,
    retryCount: number,
  ): void {
    const latest = (readLoopTaskRecord(task.id) as LoopTaskRecord | null) ?? task;
    const index = latest.subTasks.findIndex((item: LoopSubtaskRecord) => item.id === subtask.id);
    const title = getLoopSubtaskDisplayTitle(index, subtask);
    const retryLine = retryCount > 0 ? `- 重试：第 ${retryCount} 次` : null;
    appendLoopMainSubChatSection(latest, `子任务加入：${formatLoopGroupChatMemberName(title)}`, [
      `- 成员 ID：${subtask.id}`,
      `- 时间：${new Date().toISOString()}`,
      `- 轮次：${round}`,
      retryLine,
      `- 状态：running`,
      `- 沟通文件：${communicationFile}`,
    ].filter((line): line is string => Boolean(line)).join("\n"));
  }

  function appendLoopMainSubChatSubtaskFinished(
    task: LoopTaskRecord,
    subtask: LoopSubtaskRecord,
    runStatus: TaskRunStatus,
    assistantContent?: string | null,
  ): void {
    const latest = (readLoopTaskRecord(task.id) as LoopTaskRecord | null) ?? task;
    const index = latest.subTasks.findIndex((item: LoopSubtaskRecord) => item.id === subtask.id);
    const latestSubtask = latest.subTasks[index] ?? subtask;
    const title = getLoopSubtaskDisplayTitle(index, latestSubtask);
    appendLoopMainSubChatSection(
      latest,
      `子任务发言：${formatLoopGroupChatMemberName(title)}`,
      [
        `- 成员 ID：${latestSubtask.id}`,
        "",
        buildLoopMainSubSubtaskTurnBody({
          runStatus,
          assistantContent,
          communicationFile: latestSubtask.communicationFile,
        }),
      ].join("\n"),
    );
  }

  function appendLoopMainSubChatSection(
    task: LoopTaskRecord,
    heading: string,
    body: string,
  ): void {
    const chatFile = ensureLoopMainSubChatTranscript(task);
    appendTextFileEnsuringDir(chatFile, `\n## ${heading}\n${body.trim()}\n`);
    refreshOpenLoopGroupChatPanelForTask(task.id);
  }

  type LoopSubtaskRetryOptions = {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
    subtask: LoopSubtaskRecord;
    switchVisible?: boolean;
  };

  type LoopSubtaskBatchOptions = {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
    subtasks: LoopSubtaskRecord[];
  };

  type LoopSubtaskRunResult = {
    subtask: LoopSubtaskRecord;
    status: TaskRunStatus;
  };

  type LoopMainDecisionRunResult =
    | { status: "interrupted"; task: LoopTaskRecord; runStatus: "error" | "stopped" }
    | { status: "needs-review"; task: LoopTaskRecord; decision?: LoopMainDecision | null }
    | { status: "completed"; task: LoopTaskRecord; decision: LoopMainDecision }
    | { status: "awaiting-input"; task: LoopTaskRecord; decision: LoopMainDecision }
    | { status: "continue"; task: LoopTaskRecord; decision: LoopMainDecision; subtasks: LoopSubtaskRecord[] };

  async function runLoopSubtasksBatchWithRetry(
    options: LoopSubtaskBatchOptions
  ): Promise<LoopSubtaskRunResult[]> {
    const { input, target, task, round, subtasks } = options;
    if (subtasks.length <= 1) {
      const subtask = subtasks[0];
      if (!subtask) {
        return [];
      }
      const status = await runLoopSubtaskWithRetry({
        input,
        target,
        task,
        round,
        subtask,
        switchVisible: true,
      });
      return [{ subtask, status }];
    }

    const executionPlan = buildLoopSubtaskExecutionPlan(subtasks);
    appendSystemMessageForLoop(target, buildLoopSubtaskBatchStartedText(task.id, round, subtasks, executionPlan));
    const results: LoopSubtaskRunResult[] = [];
    let lastSubtaskLaunchAt: number | null = null;

    for (let groupIndex = 0; groupIndex < executionPlan.groups.length; groupIndex += 1) {
      const group = executionPlan.groups[groupIndex] ?? [];
      if (group.length === 0) {
        continue;
      }
      if (executionPlan.groups.length > 1) {
        appendSystemMessageForLoop(
          target,
          buildLoopSubtaskExecutionGroupStartedText(task.id, round, groupIndex, executionPlan.groups.length, group)
        );
      }

      const groupRuns: Array<Promise<LoopSubtaskRunResult>> = [];
      let undispatchedGroups: LoopSubtaskRecord[][] | null = null;
      for (let subtaskIndex = 0; subtaskIndex < group.length; subtaskIndex += 1) {
        const subtask = group[subtaskIndex];
        if (!subtask) {
          continue;
        }
        if (isLoopTaskExecutionInterrupted(task.id)) {
          undispatchedGroups = [
            group.slice(subtaskIndex),
            ...executionPlan.groups.slice(groupIndex + 1),
          ];
          break;
        }
        const launchDelayMs = getLoopSubtaskLaunchDelayMs(lastSubtaskLaunchAt);
        if (launchDelayMs > 0) {
          await waitForLoopSubtaskLaunchDelay(launchDelayMs);
          if (isLoopTaskExecutionInterrupted(task.id)) {
            undispatchedGroups = [
              group.slice(subtaskIndex),
              ...executionPlan.groups.slice(groupIndex + 1),
            ];
            break;
          }
        }
        lastSubtaskLaunchAt = Date.now();
        groupRuns.push((async (): Promise<LoopSubtaskRunResult> => {
          try {
            const status = await runLoopSubtaskWithRetry({
              input,
              target,
              task,
              round,
              subtask,
              switchVisible: false,
            });
            return { subtask, status };
          } catch (error) {
            void logError("loop-subtask-batch-run-error", {
              taskId: task.id,
              round,
              subtaskId: subtask.id,
              error: error instanceof Error ? error.message : String(error),
            });
            markLoopSubtaskRunFinished(task.id, subtask.id, "error", null);
            return { subtask, status: "error" };
          }
        })());
      }

      const groupResults = await Promise.all(groupRuns);
      results.push(...groupResults);
      if (undispatchedGroups) {
        markUndispatchedLoopSubtasksSkipped(task, undispatchedGroups);
        await switchVisibleConversationTabForLoop(target.tabId);
        return results;
      }
      if (groupResults.some((result) => result.status === "error" || result.status === "stopped")) {
        markUndispatchedLoopSubtasksSkipped(task, executionPlan.groups.slice(groupIndex + 1));
        await switchVisibleConversationTabForLoop(target.tabId);
        return results;
      }
    }

    await switchVisibleConversationTabForLoop(target.tabId);
    if (results.every((result) => result.status === "end")) {
      updateLoopTaskRecord(task.id, {
        activeSubtaskId: null,
        activeSubtaskIds: [],
        updatedAt: Date.now(),
      });
      refreshOpenLoopGroupChatPanelForTask(task.id);
      appendSystemMessageForLoop(target, buildLoopSubtaskBatchCompletedText(task.id, round, subtasks));
      const latest = (readLoopTaskRecord(task.id) as LoopTaskRecord | null) ?? task;
      appendLoopMainSubChatTaskEvent(
        latest,
        [
          `- 时间：${new Date().toISOString()}`,
          `- 轮次：${round}`,
          `- 子任务批次已全部完成：${subtasks.length} 个`,
          `- 子任务：${subtasks.map((subtask: LoopSubtaskRecord) => subtask.title).join("、")}`,
        ].join("\n"),
      );
    }
    return results;
  }

  function markUndispatchedLoopSubtasksSkipped(
    task: LoopTaskRecord,
    remainingGroups: readonly LoopSubtaskRecord[][],
  ): void {
    const skippedIds = new Set(remainingGroups.flatMap((group) => group.map((subtask) => subtask.id)));
    if (skippedIds.size === 0) {
      return;
    }

    const latest = readLoopTaskRecord(task.id) ?? task;
    const activeSubtaskIds = getActiveLoopSubtaskIds(latest).filter((id: string) => !skippedIds.has(id));
    const now = Date.now();
    updateLoopTaskRecord(task.id, {
      activeSubtaskId: activeSubtaskIds[0] ?? null,
      activeSubtaskIds,
      subTasks: latest.subTasks.map((subtask: LoopSubtaskRecord) => (
        skippedIds.has(subtask.id)
          ? {
              ...subtask,
              status: "skipped" as const,
              summary: subtask.summary ?? "该子任务尚未启动；等待主任务在下一轮重新评估。",
              updatedAt: now,
            }
          : subtask
      )),
      updatedAt: now,
    });
  }

  async function runLoopSubtaskWithRetry(options: LoopSubtaskRetryOptions): Promise<TaskRunStatus> {
    const { input, target, task, round, subtask } = options;
    const execution = resolveStoredSubtaskExecution({
      mainCli: target.cli,
      route: task.modelRouting?.subtask,
      routeFallback: task.modelRouting?.subtask.fallback,
      prompt: input,
      originThinkingMode: task.originProfile?.subtaskThinkingMode,
    });
    execution.configId ??= deps.getActiveConfigIdForCli?.(execution.cli) ?? null;
    if (execution.unavailableReason) {
      appendSystemMessageForLoop(target, execution.unavailableReason);
      markLoopSubtaskRunFinished(task.id, subtask.id, "error", null);
      return "error";
    }
    const shouldSwitchVisible = options.switchVisible !== false;
    const mainTabId = target.tabId;
    const progressId = `${task.id}:${round}:${subtask.id}`;
    let currentSubtaskTarget: PromptRunTarget | null = null;
    let terminalProgressStatus: "completed" | "failed" | "interrupted" | null = null;
    let parentProgress: SubagentProgressController | null = null;

    const persistParentProgressMessage = (message: ChatMessage): void => {
      const messages = getLoopMessagesForTarget(target) as ChatMessage[];
      const index = messages.findIndex((item: ChatMessage) => item.id === message.id);
      if (index >= 0) {
        messages[index] = message;
      } else {
        appendMessageToStore(messages, message);
      }
      persistLoopMessagesForTarget(target, messages);
    };

    parentProgress = createSubagentProgressController({
      labels: buildSubagentProgressLabels(),
      createMessageId,
      messageMetadata: {
        taskRole: "main",
        loopTaskId: task.id,
        loopRound: round,
        loopSubtaskId: subtask.id,
      },
      appendMessage: (message: ChatMessage) => {
        persistParentProgressMessage(message);
        sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
      },
      replaceMessage: (message: ChatMessage) => {
        persistParentProgressMessage(message);
        sendPanelMessage({ type: "replaceMessage", message, tabId: target.tabId });
      },
      appendDelta: (messageId: string, content: string) => {
        const message = parentProgress?.getMessage("loop", progressId);
        if (message) {
          persistParentProgressMessage(message);
        }
        sendPanelMessage({
          type: "assistantDelta",
          id: messageId,
          content,
          tabId: target.tabId,
        });
      },
    });

    const progressMonitor = createLoopSubtaskProgressMonitor({
      taskId: task.id,
      round,
      subtaskId: subtask.id,
      subtaskTitle: subtask.title,
      waitingText: t("run.loopSubtaskWaiting"),
      readMessages: () => currentSubtaskTarget
        ? getLoopMessagesForTarget(currentSubtaskTarget)
        : [],
      onUpdate: (update: SubagentProgressUpdate) => parentProgress?.update(update),
    });
    progressMonitor.start();

    let retryCount = 0;
    let subtaskTarget: PromptRunTarget | null = null;
    try {
      while (true) {
        if (isLoopTaskExecutionInterrupted(task.id)) {
          terminalProgressStatus = "interrupted";
          return "stopped";
        }
        if (!subtaskTarget) {
          const continuation = resolveLoopSubtaskSession(readLoopTaskRecord(task.id) ?? task, subtask, execution.cli, execution.configId);
          subtaskTarget = createLoopSubtaskRunTarget(execution.cli, { sessionId: continuation.sessionId });
          if (subtask.continueFromSubtaskId || continuation.sessionId) {
            appendSystemMessageForLoop(target, `子任务 ${subtask.id}：${continuation.reason}（来源：${continuation.sourceSubtaskId}）。`);
          }
          currentSubtaskTarget = subtaskTarget;
        } else {
          const refreshedSessionId = resolvePromptRunTargetSessionId(subtaskTarget);
          if (refreshedSessionId) {
            subtaskTarget.sessionId = refreshedSessionId;
          }
        }
        const communicationFile = prepareLoopSubtaskCommunicationFile(task, subtask, round, retryCount);
        appendSystemMessageForLoop(
          target,
          buildLoopSubtaskStartedText(task.id, subtask, round, communicationFile, retryCount)
        );
        appendLoopMainSubChatSubtaskStarted(task, subtask, round, communicationFile, retryCount);
        if (shouldSwitchVisible) {
          await switchVisibleConversationTabForLoop(subtaskTarget.tabId);
        }

        let status: TaskRunStatus = "error";
        try {
          status = await withLoopSubtaskSession(subtaskTarget.cli, subtaskTarget.sessionId, async () => {
            if (isLoopTaskExecutionInterrupted(task.id)) {
              return "stopped";
            }
            return runLoopRound({
              input,
              target: subtaskTarget!,
              task,
              round,
              role: "subtask",
              subtaskId: subtask.id,
              displayPrompt: buildLoopSubtaskDisplayPrompt(round, subtask, retryCount),
              modelPrompt: buildLoopSubtaskModelPrompt(
                task,
                round,
                subtask,
                retryCount,
                communicationFile
              ),
              executionCli: execution.cli,
              executionConfigId: execution.configId,
              boundSubtaskModel: execution.model,
              boundThinkingMode: execution.thinkingMode,
              crossCli: execution.crossCli,
            });
          }, { taskId: task.id, subtaskId: subtask.id, sourceSubtaskId: subtask.continueFromSubtaskId });
          const sessionId = resolvePromptRunTargetSessionId(subtaskTarget);
          if (sessionId) {
            const latest = readLoopTaskRecord(task.id) ?? task;
            const recorded = latest.subTasks.find((item) => item.id === subtask.id)?.executionSession;
            const configId = recorded?.cli === execution.cli && recorded.sessionId === sessionId ? recorded.configId : execution.configId ?? null;
            updateLoopTaskRecord(task.id, { subTasks: bindLoopSubtaskSession(latest.subTasks, subtask.id, { cli: execution.cli, sessionId, configId }) });
          }
        } catch (error) {
          status = "error";
          void logError("loop-subtask-run-error", {
            taskId: task.id,
            round,
            subtaskId: subtask.id,
            retryCount,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          progressMonitor.sync();
          if (shouldSwitchVisible) {
            await switchVisibleConversationTabForLoop(mainTabId);
          }
        }

        if (status !== "error") {
          const summary = getLastLoopAssistantContent(subtaskTarget, task.id, round, "subtask");
          await finalizeLoopSubtaskRun({
            taskId: task.id,
            round,
            subtaskId: subtask.id,
            runStatus: status,
            assistantContent: summary,
            tabId: subtaskTarget.tabId,
          });
          terminalProgressStatus = mapLoopRunStatusToSubagentStatus(status);
          return status;
        }
        if (retryCount >= LOOP_SUBTASK_RETRY_MAX_RETRIES) {
          const summary = getLastLoopAssistantContent(subtaskTarget, task.id, round, "subtask");
          await finalizeLoopSubtaskRun({
            taskId: task.id,
            round,
            subtaskId: subtask.id,
            runStatus: status,
            assistantContent: summary,
            tabId: subtaskTarget.tabId,
          });
          terminalProgressStatus = mapLoopRunStatusToSubagentStatus(status);
          return status;
        }

        retryCount += 1;
        appendSystemMessageForLoop(
          target,
          buildLoopSubtaskRetryText(task.id, subtask.id, retryCount)
        );
        await waitForLoopSubtaskRetryDelay();
      }
    } finally {
      progressMonitor.finish(terminalProgressStatus ?? "interrupted");
    }
  }

  async function waitForLoopSubtaskRetryDelay(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, LOOP_SUBTASK_RETRY_DELAY_MS));
  }

  async function waitForLoopSubtaskLaunchDelay(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  type LoopRoundRunOptions = {
    input: PromptRunInput;
    target: PromptRunTarget;
    task: LoopTaskRecord;
    round: number;
    role: LoopTaskRole;
    displayPrompt: string;
    modelPrompt: string;
    subtaskId?: string;
    executionCli?: CliName;
    executionConfigId?: string | null;
    boundSubtaskModel?: string;
    boundThinkingMode?: ThinkingMode;
    crossCli?: boolean;
  };

  async function runLoopRound(options: LoopRoundRunOptions): Promise<TaskRunStatus> {
    const { input, target, task, round, role, displayPrompt, modelPrompt, subtaskId } = options;
    if (isLoopTaskExecutionInterrupted(task.id)) {
      return "stopped";
    }
    const roundStartedAt = Date.now();
    const activeSubtaskPatch = role === "main"
      ? { activeSubtaskId: null, activeSubtaskIds: [] }
      : buildLoopActiveSubtaskPatch(task.id, subtaskId);
    const latestTask = readLoopTaskRecord(task.id) ?? task;
    const subTasks = role === "subtask" && subtaskId
      ? latestTask.subTasks.map((item) => (
        item.id === subtaskId ? { ...item, lastStartedAt: roundStartedAt } : item
      ))
      : undefined;
    updateLoopTaskRecord(task.id, {
      status: "running",
      currentRound: round,
      ...activeSubtaskPatch,
      ...(subTasks ? { subTasks } : {}),
      updatedAt: roundStartedAt,
    });
    refreshOpenLoopGroupChatPanelForTask(task.id);

    const routedInput: PromptRunInput = role === "subtask"
      ? {
        ...input,
        ...(options.crossCli ? {
          loopSubtaskCli: options.executionCli,
          loopSubtaskModel: options.boundSubtaskModel,
          ...(options.boundThinkingMode ? { loopSubtaskThinkingMode: options.boundThinkingMode } : {}),
        } : {}),
        ...(options.executionConfigId ? { loopSubtaskConfigId: options.executionConfigId } : {}),
      }
      : input;
    const roleModel = resolvePromptRunModelForRole(routedInput, role);
    const thinkingCli = role === "subtask" ? (options.executionCli ?? target.cli) : target.cli;
    const thinkingModeOverride = resolvePromptRunThinkingModeForRole(routedInput, thinkingCli, role, roleModel, {
      applySubtaskCap: true,
      configId: role === "subtask" ? options.executionConfigId : undefined,
    });
    await runPrompt({
      ...routedInput,
      displayPrompt,
      modelPrompt,
      model: roleModel,
      taskRole: role,
      loopTaskId: task.id,
      loopRound: round,
      loopSubtaskId: subtaskId,
      thinkingModeOverride,
    }, { targetTabId: target.tabId });

    if (role === "main") {
      const mainSessionId = resolveLoopTaskSessionId(target);
      if (mainSessionId) {
        bindLoopTaskToSession(task.id, mainSessionId);
      }
    }

    const roundEndedAt = Date.now();
    const roundStatus = getLoopRoundRunStatus(task.id, round, role, subtaskId) ?? "end";
    appendLoopRound(task.id, {
      round,
      role,
      subtaskId,
      status: roundStatus,
      startedAt: roundStartedAt,
      endedAt: roundEndedAt,
      summary: buildLoopRoundSummary(round, role, subtaskId),
    });
    return roundStatus;
  }

  function buildLoopActiveSubtaskPatch(
    taskId: string,
    subtaskId?: string,
  ): { activeSubtaskId?: string | null; activeSubtaskIds?: string[] } {
    if (!subtaskId) {
      return {};
    }
    const latest = readLoopTaskRecord(taskId);
    const activeSubtaskIds = latest ? getActiveLoopSubtaskIds(latest) : [];
    if (!activeSubtaskIds.includes(subtaskId)) {
      activeSubtaskIds.push(subtaskId);
    }
    return {
      activeSubtaskId: activeSubtaskIds[0] ?? subtaskId,
      activeSubtaskIds,
    };
  }

  function buildLoopMainDisplayPrompt(rootPrompt: string, round: number): string {
    if (round === 1) {
      return [
        rootPrompt,
        "",
        "Loop 主任务：请拆分目标，优先并发派发互不冲突的子任务，返回 JSON 决策，由程序启动子任务。",
      ].join("\n");
    }
    return [
      `Loop 主任务第 ${round} 轮进度判断。`,
      "上一批子任务已结束，请根据任务记录与子任务汇报判断整体是否完成；不要自行验收或运行测试，未完成则返回下一批子任务 JSON。",
      "本轮必须预判 estimatedRemainingRounds，说明当前决策之后预计还剩多少轮。",
    ].join("\n");
  }

  function buildLoopSubtaskDisplayPrompt(round: number, subtask: LoopSubtaskRecord, retryCount = 0): string {
    const retryLine = retryCount > 0
      ? `第 ${retryCount} 次重试（最多 ${LOOP_SUBTASK_RETRY_MAX_RETRIES} 次）。`
      : "";
    return [
      `Loop 子任务第 ${round} 轮执行：${subtask.title}`,
      retryLine,
      subtask.prompt ?? subtask.title,
    ].filter(Boolean).join("\n");
  }

  function buildLoopMainModelPrompt(
    rootPrompt: string,
    task: LoopTaskRecord,
    round: number,
    continuePrompt?: string,
  ): string {
    const taskId = task.id;
    const taskFile = task.taskStoreFile;
    const communication = getLoopCommunicationPaths(taskId);
    const normalizedContinuePrompt = normalizeLoopContinuePromptForPrompt(continuePrompt);
    return [
      "你正在执行 VS Code 插件的 Loop 模式主任务。",
      `Loop 任务 ID：${taskId}`,
      `当前轮次：${round}`,
      `任务记录文件：${taskFile}`,
      `沟通目录：${communication.dir}`,
      `主任务沟通文件：${communication.mainFile}`,
      `子任务沟通目录：${communication.subtasksDir}`,
      "",
      "Loop 模式原理（必须遵守）：",
      "1. 主任务每轮只输出一个 JSON 决策，不直接做具体实现。",
      `2. 当你返回 status=continue 时，程序会按 subtasks 数组启动 1~${LOOP_PARALLEL_SUBTASK_MAX} 个子任务；独立任务新建会话，连续任务续接来源会话。`,
      "3. 只有同一批次所有子任务都结束后，程序才会回到当前主任务会话并唤醒你根据汇报继续决策。",
      "4. 你需要基于任务记录 + 沟通文件再次决策，循环直到你返回 status=completed。",
      "5. 任务不会因为子任务都显示 completed 自动结束，只有你返回 completed 才结束；当前没有可执行子任务且需要人工或外部结果时必须返回 blocked。",
      `6. ${LOOP_MAIN_STALE_TASK_LIST_RULE_ZH}`,
      "",
      "主任务职责：",
      "1. 读取任务记录文件中当前任务的 status、activeSubtaskId、activeSubtaskIds、subTasks 和 rounds 概要。",
      "2. 读取主任务沟通文件和最新子任务汇报，相信子任务汇报的结果，只判断用户目标和项目规则要求的工作是否已完成。",
      "3. 第 1 轮按需求拆分任务并写入主任务沟通文件，优先派发互不冲突的可执行子任务。",
      "4. 后续轮次根据汇报推进：有未完成工作则派发下一批子任务，不因缺少验收证据或未运行未要求的测试而增加任务。",
      "5. 并发优先：只要能确定多个子任务预计写入文件/目录互不重叠、没有先后依赖、不会争抢同一验证环境，就必须放入同一个 subtasks 批次。",
      "6. 串行兜底：只有共享写入同一文件/同一配置、需要基于另一个子任务产物继续修改、或必须独占同一验证环境时，才只返回 1 个子任务。",
      `7. 每批最多 ${LOOP_PARALLEL_SUBTASK_MAX} 个子任务；如果可并发项超过上限，优先选择当前阶段最独立、收益最高的一组。`,
      "8. 主任务不验收子任务产物，不检查代码、文档或实现细节，不运行或重复运行测试、构建、启动和其它验证；完成判断以子任务汇报为依据。",
      "9. 只有用户明确要求或项目既有规则要求验收、测试、构建等验证时，才安排独立的验收或测试子任务，由子模型执行并汇报；两者都未要求时默认不做，不增加固定验收清单。用户未提但项目规则要求的任务完成后测试同样必须独立派发，不能遗漏。",
      "10. 子任务沟通文件的 `## 待主任务确认` 若标记为待确认，你必须先处理：能依据现有事实和规则自主确定时，把结论写入后续子任务 prompt；如果缺口是用户需求含糊，或当前方案明显不合理、缺关键取舍，返回 status=clarify 和 clarification 表单，不要猜测，也不要派发子任务；只是等待外部结果且当前没有可执行子任务时返回 blocked。",
      "11. 每次决策预判 estimatedRemainingRounds：从当前决策之后预计还需要多少个子任务批次才能 completed；completed 时为 0。",
      "12. 根据汇报，原始目标以及用户或项目规则要求的独立验收、测试任务都已完成时，返回 completed；有可执行工作时返回 continue，只等待外部结果时返回 blocked。",
      "13. 主任务只负责拆分、派发、协调和根据汇报判断进度。子任务遵循项目既有规则自主完成工作，不额外强制实施步骤、设计流程或测试流程。",
      "14. 主任务不要直接执行具体代码/文件修改；返回 JSON 后由程序启动子任务。",
      "15. 输出必须是一个 JSON 对象，不要包裹 markdown，不要输出额外解释。",
      "",
      "JSON 协议：",
      '{"status":"completed","estimatedRemainingRounds":0,"answerConclusion":"根据子任务汇报直接回答用户原始问题","finalSummary":"根据全部子任务汇报归纳完成内容与交付结果"}',
      '{"status":"continue","estimatedRemainingRounds":2,"parallelReason":"写入范围互不重叠且没有先后依赖，可以并发","subtasks":[{"id":"stable-id-a","title":"子任务A标题","writeFiles":["src/a.ts"],"prompt":"背景与目标：完成 A。遵循项目既有规则，自主选择实施方式并汇报完成情况。"},{"id":"stable-id-b","title":"子任务B标题","writeFiles":["docs/b.md"],"prompt":"背景与目标：完成 B。遵循项目既有规则，自主选择实施方式并汇报完成情况。"}]}',
      '{"status":"continue","estimatedRemainingRounds":1,"subtasks":[{"id":"required-tests","title":"执行用户或项目规则要求的测试","prompt":"用户要求或项目规则要求任务完成后运行相关测试。请作为独立测试子任务按该要求执行，并汇报结果、失败或阻塞；不要扩大到未要求的检查。"}]}',
      '{"status":"blocked","estimatedRemainingRounds":0,"finalSummary":"阻塞原因"}',
      '{"status":"clarify","estimatedRemainingRounds":2,"finalSummary":"需要用户确认范围后再拆分","clarification":{"title":"需要确认需求","instruction":"以下选择会改变后续拆分，请补充后继续。","submitLabel":"提交","cancelLabel":"拒绝","formFields":[{"id":"scope","label":"本次范围","type":"radio","required":true,"options":[{"label":"只改接口","value":"api"},{"label":"接口和调用方一起改","value":"api-and-callers"}]}]}}',
      "",
      "字段要求：",
      "- status 只能是 completed、continue、blocked、clarify。",
      "- 每次返回都必须提供 estimatedRemainingRounds；含义是从当前决策之后预计还需要多少个主任务进度判断轮/子任务批次才能 completed，必须是非负整数。",
      "- status=completed 时提供 estimatedRemainingRounds=0、answerConclusion 和 finalSummary；不要求 acceptance、requirementCoverage 或 roundSummaries，不进行主模型验收。",
      "- answerConclusion 用于直接回答用户原始问题，应尽量简短明确；finalSummary 用于整体完成说明和交付总结。",
      "- finalSummary 根据子任务汇报归纳整体结果、完成内容和最终交付；遗留问题如实说明，不编造验收结论。",
      buildStructuredSvgSummaryPromptInstruction("finalSummary"),
      `- status=continue 时提供 subtasks 数组，数组长度 1~${LOOP_PARALLEL_SUBTASK_MAX}，不要求 acceptance。`,
      "- 当前没有可执行子任务、需要等待外部结果时，必须返回 blocked，并在 finalSummary 说明等待对象。",
      "- 如果对用户需求有疑惑，或者当前方案明显不合理、缺少必须由用户决定的关键信息，返回 clarify。clarification.formFields 必须有 1 到 8 个字段，字段 type 可以是 text、textarea、password、radio、checkbox、select、multiselect。不要同时返回 subtasks。宿主会在群聊弹出表单，用户提交后再唤醒你；用户拒绝则任务暂停。",
      "- subtasks 中每个对象都必须提供 title 和 prompt；prompt 必须自包含且足够详细，因为子任务每次都会在单独新会话中执行，看不到主任务对话上下文。",
      "- subtasks[*].prompt 说明背景、目标、范围以及用户或项目规则已有的要求即可，不额外强制执行步骤、设计方法或验收流程。writeFiles 是并发冲突提示，不是硬性写入白名单。不要把任务记录、调度状态、轮次或父任务协议写进 prompt；沟通文件和禁止修改的调度文件由宿主附加。",
      "- 用户或项目规则要求的验收、测试必须单独派发子任务，说明要求来源和范围；不要让主模型亲自执行，也不要把未要求的验证作为完成门槛。",
      "- subtasks[*].id 应稳定可读；如果复用已有子任务，请使用已有 id。",
      "- 判断新任务是否是此前子任务的连续工作或修补；是则设置 continueFromSubtaskId 为来源子任务 id，宿主将恢复其会话。独立任务不要设置。不要并发派发共享同一来源会话的任务；CLI 或配置不兼容、历史会话不可用时宿主会说明原因并使用新会话。",
      "- subtasks[*].writeFiles 可选，表示建议写入范围；但返回多个 subtasks 时，必须为每个会写文件的子任务列出预计写入文件或目录，用于证明文件不冲突。它不是执行时的硬性写入白名单。纯验证/调研子任务可省略并在 parallelReason 说明不会写文件。",
      "- subtasks[*].conflictGroup 可选，用于说明冲突域；同一批次内不应出现会互相覆盖的冲突域。",
      "- 返回多个 subtasks 前，必须确认它们的 writeFiles / conflictGroup 互不重叠；只要能确认文件不冲突，就优先并发，不要保守串行；无法判断写入范围的实现类子任务应串行。",
      "- 返回 continue 前，同时更新任务记录文件中的 subTasks、activeSubtaskId、activeSubtaskIds 和 estimatedRemainingRounds。",
      "- 根据汇报确认目标与必需的独立验收、测试任务已完成后返回 completed，任务记录和最终总结由宿主落地。",
      "",
      ...buildLoopSupplementalRequirementsLines(task),
      ...(normalizedContinuePrompt ? [
        "本次继续指令：",
        normalizedContinuePrompt,
        "",
      ] : []),
      "原始目标：",
      rootPrompt,
    ].join("\n");
  }

  function buildLoopSubtaskModelPrompt(
    task: LoopTaskRecord,
    round: number,
    subtask: LoopSubtaskRecord,
    retryCount = 0,
    communicationFile?: string
  ): string {
    const reportFile = communicationFile ?? buildLoopSubtaskCommunicationFile(task.id, subtask.id, round, retryCount);
    const writeFiles = Array.isArray(subtask.writeFiles) && subtask.writeFiles.length > 0
      ? subtask.writeFiles.join("、")
      : "未声明；按当前子任务指令修改完成任务所需的工作区文件";
    return [
      "你正在执行一个独立的经典 Loop 子任务。遵循用户要求和项目既有规则，自主选择完成任务的方法，不需要理解或维护父任务调度。",
      `子任务沟通文件：${reportFile}`,
      `建议写入范围：${writeFiles}`,
      "建议写入范围只是提示，不是硬限制。完成当前任务确实需要时，可以修改建议范围之外的工作区文件，并在沟通文件说明原因。",
      "不要修改任务记录、调度状态、active ids、snapshot，或其他子任务的沟通文件。",
      "结束前把完成情况、实际修改或操作、结果和遗留问题写入上面的沟通文件，主任务将信任你的汇报判断整体进度。",
      "实现方法和必要工作按项目规则自主决定，Loop 不额外强制实施流程。用户或项目规则要求的验收、测试由主任务另行安排独立子任务；若本次就是该验证任务，按要求执行并如实汇报，否则报告相关要求，供主任务安排。没有相关要求时不额外增加验收或测试。",
      "只有必须由父任务或用户确认才能安全继续时，停止实施并填写沟通文件的“待主任务确认”；能自行判断的问题不要上交。",
      "不要在回复中提问或复述待确认问题。有待确认事项时，最终回复只能是：`子任务已结束，待主任务确认事项已写入沟通文件。`",
      "",
      "当前子任务：",
      subtask.prompt ?? subtask.title,
    ].join("\n");
  }

  return {
    appendLoopMainSubChatMainDecision,
    appendLoopMainSubChatSubtaskFinished,
    appendLoopSupplementalRequirement,
    appendLoopSupplementalRequirementToCommunication,
    appendTextFileEnsuringDir,
    readTextFileIfNonEmpty,
    runClassicLoopMainDecision,
    runLoopSubtasksBatchWithRetry,
    writeTextFileEnsuringDir,
  };
}
