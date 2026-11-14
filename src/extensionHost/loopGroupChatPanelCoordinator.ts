import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import type { CliName, ThinkingMode } from "../cli/types";
import {
  continueModelPairFromLoopRouting,
  promptModelsFromContinuePair,
  resolveCurrentLoopModelPair,
} from "../continueModelChoice";
import { applyLoopModelRoutingToPrompt, buildLoopModelSwitchState, resolveLoopModelSwitch, type LoopModelSwitchDeps } from "../loopModelSwitch";
import {
  formatOrchestratorClarificationAnswer,
  loopClarificationScope,
  normalizeClarificationSubmission,
  rejectOrchestratorClarification,
  submitOrchestratorClarification,
} from "../orchestratorClarification";
import { buildLoopMainSubChatTranscriptFile, resolveLoopTaskRunControlState } from "../loopGroupChat";
import {
  beginLoopAskTurn,
  createEmptyLoopAskThread,
  settleLoopAskTurn,
  setLoopAskDialogOpen,
  type LoopAskThread,
} from "../loopAskThread";
import type { LoopMainModelAnswerResult, LoopMainModelQuestionProgress } from "../loopMainQuestion";
import type { LoopPlusAcceptancePlan, LoopPlusAcceptancePlanSnapshot } from "../loopPlusAcceptancePlan";
import type { LoopPlusAcceptancePlanMutationResult } from "./loopPlusAcceptancePlanHost";
import type { ChatMessageAction } from "../webview/types";
import {
  LoopGroupChatPanel,
  type LoopGroupChatPanelMessage,
  type LoopGroupChatPanelState,
} from "../webview/loopGroupChatPanel";
import {
  buildLoopGroupChatMessageAction,
} from "../panelStateBuilder";
import { buildLoopGroupChatPanelStateWithDeps } from "../loopGroupChatPanelState";
import {
  collectLoopCommunicationPreviewRoots,
  readLoopCommunicationFilePreview,
} from "../loopCommunicationFilePreview";
import { resolveLoopSchedulingMode, type LoopTaskOriginProfile, type LoopTaskRecord } from "../loopTaskStore";

type LoopPromptRunInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
  loopSubtaskFrontendThinkingMode?: ThinkingMode;
  loopSubtaskFullstackThinkingMode?: ThinkingMode;
  loopContinuePrompt: string;
};

type LoopPromptRunOptions = {
  targetTabId: string | null;
  resumeTaskId: string;
  resumeRequested: boolean;
  preserveLoopOrigin?: boolean;
  schedulingMode?: "classic" | "event_driven";
};

type LoopOriginRestoreResult = {
  ok: boolean;
  target?: LoopPromptTarget;
  message?: string;
};

type LoopPromptTarget = {
  tabId: string | null;
  cli: CliName;
};

type LoopGroupChatPanelDeps = LoopModelSwitchDeps & {
  prepareModelSwitchOptions?: (task: LoopTaskRecord) => Promise<void>;
  getExtensionUri: () => vscode.Uri;
  getMessageLimit?: () => number;
  panelsByTaskId: Map<string, LoopGroupChatPanel>;
  normalizeTaskId: (value: unknown) => string | null;
  normalizeSupplementalRequirement: (value: unknown) => string | null;
  appendSupplementalRequirement: (existing: readonly string[] | undefined, nextItem: string) => string[];
  appendSupplementalRequirementToCommunication: (task: LoopTaskRecord, requirement: string) => void;
  readTaskRecord: (taskId: string) => LoopTaskRecord | null;
  updateTaskRecord: (taskId: string, patch: Partial<LoopTaskRecord>) => LoopTaskRecord | null;
  listTaskStoreFiles: () => string[];
  readTaskStoreTasks: (filePath: string) => LoopTaskRecord[];
  collectRunningTaskIds: () => Set<string>;
  readTextFileIfNonEmpty: (filePath: string) => string | null;
  fileExists: (filePath: string) => boolean;
  writeTextFileEnsuringDir: (filePath: string, content: string) => boolean;
  getActiveSubtaskIds: (task: LoopTaskRecord) => string[];
  buildCompletedConclusionAndSummaryMarkdown: (task: LoopTaskRecord) => string;
  resolveMainPromptTarget: (
    task: LoopTaskRecord,
    options?: { createIfMissing?: boolean },
  ) => LoopPromptTarget | null;
  revealPanelView: () => Promise<void>;
  switchVisibleConversationTabForLoop: (tabId: string | null) => Promise<void>;
  isTabRunActive: (tabId: string | null) => boolean;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  getSelectedLoopCliModel?: (cli: CliName, role: "main" | "subtask", configId?: string | null) => string | null;
  getSelectedLoopSubtaskCli?: (configId: string | null) => CliName | null;
  getSelectedLoopFrontendCli?: (configId: string | null) => CliName | null;
  getSelectedLoopFullstackCli?: (configId: string | null) => CliName | null;
  getSelectedLoopSubtaskMode?: (configId: string | null) => "fullstack" | "split" | null;
  getLoopRoleExplicitModel?: (configId: string | null, role: "frontend" | "fullstack") => { configured: boolean; model: string };
  captureCurrentLoopOriginProfile?: (input: {
    cli: CliName;
    configId: string | null;
    mainModel: string | null;
    subtaskModel: string | null;
    subtaskCli?: CliName | null;
    subtaskConfigId?: string | null;
    subtaskThinkingMode?: ThinkingMode;
    frontendModel?: string | null;
    frontendCli?: CliName | null;
    frontendConfigId?: string | null;
    fullstackModel?: string | null;
    fullstackCli?: CliName | null;
    fullstackConfigId?: string | null;
    subtaskFrontendThinkingMode?: ThinkingMode;
    subtaskFullstackThinkingMode?: ThinkingMode;
  }) => LoopTaskOriginProfile | null;
  restoreOriginalLoopRuntime?: (task: LoopTaskRecord) => Promise<LoopOriginRestoreResult>;
  runLoopPrompt: (input: LoopPromptRunInput, options: LoopPromptRunOptions) => Promise<void>;
  stopRunsForTask: (taskId: string) => void;
  markTaskStoppedByUser: (taskId: string) => LoopTaskRecord | null;
  postPanelState: () => Promise<void>;
  getActiveConversationTaskId: () => string | null;
  showInformationMessage: (message: string) => void;
  showWarningMessage: (message: string) => void;
  pickTask: (tasks: LoopTaskRecord[]) => Promise<LoopTaskRecord | null>;
  notifyLoopPlusUserMessage?: (taskId: string, text: string) => void;
  resumeLoopSubtasks?: (taskId: string, resumeMain: () => void) => boolean | void;
  readLoopPlusAcceptancePlans?: () => LoopPlusAcceptancePlan[];
  readLoopPlusAcceptancePlanSelection?: () => string;
  saveLoopPlusAcceptancePlan?: (input: {
    planId?: string | null;
    name: unknown;
    checks: unknown;
    otherText?: unknown;
    select?: boolean;
  }) => LoopPlusAcceptancePlanMutationResult;
  selectLoopPlusAcceptancePlan?: (planId: unknown) => { ok: true; selection: string } | { ok: false; error: string };
  deleteLoopPlusAcceptancePlan?: (planId: unknown) => LoopPlusAcceptancePlanMutationResult;
  applyLoopPlusAcceptancePlan?: (
    taskId: string,
    plan: unknown,
  ) => { ok: true; plan?: LoopPlusAcceptancePlanSnapshot } | { ok: false; error: string };
  askMainModel?: (
    task: LoopTaskRecord,
    question: string,
    hooks?: {
      onProgress?: (progress: LoopMainModelQuestionProgress) => void;
      onStarted?: () => void;
      isAborted?: () => boolean;
    },
  ) => Promise<LoopMainModelAnswerResult>;
  abortMainModelRun?: (task: LoopTaskRecord) => void;
  readAskThread?: (task: LoopTaskRecord) => LoopAskThread;
  writeAskThread?: (task: LoopTaskRecord, thread: LoopAskThread) => void;
  t: typeof import("../i18n").t;
};

export function buildLoopGroupChatPanelState(
  task: LoopTaskRecord,
  deps: LoopGroupChatPanelDeps,
): LoopGroupChatPanelState {
  const state = buildLoopGroupChatPanelStateWithDeps(task, {
    collectRunningLoopTaskIds: deps.collectRunningTaskIds,
    readTextFileIfNonEmpty: deps.readTextFileIfNonEmpty,
    fileExists: deps.fileExists,
    writeTextFileEnsuringDir: deps.writeTextFileEnsuringDir,
    getActiveLoopSubtaskIds: deps.getActiveSubtaskIds,
    buildLoopCompletedConclusionAndSummaryMarkdown: deps.buildCompletedConclusionAndSummaryMarkdown,
    t: deps.t,
  });
  const target = deps.resolveMainPromptTarget(task, { createIfMissing: false });
  const acceptancePlanState = resolveLoopSchedulingMode(task.schedulingMode) === "event_driven"
    ? {
      acceptancePlans: deps.readLoopPlusAcceptancePlans?.() ?? [],
      acceptancePlanSelection: deps.readLoopPlusAcceptancePlanSelection?.() ?? "system_default",
      acceptancePlan: task.loopPlusAcceptancePlan ?? null,
    }
    : {};
  return {
    ...state,
    ...acceptancePlanState,
    messageLimit: deps.getMessageLimit?.(),
    mainModelBusy: Boolean(target && deps.isTabRunActive(target.tabId)),
    modelSwitch: buildLoopModelSwitchState(task, deps),
  };
}

function extractLoopGroupChatPanelTaskId(
  arg: unknown,
  deps: LoopGroupChatPanelDeps,
): string | null {
  if (typeof arg === "string") {
    return deps.normalizeTaskId(arg);
  }
  if (arg && typeof arg === "object" && !Array.isArray(arg)) {
    return deps.normalizeTaskId((arg as { taskId?: unknown }).taskId);
  }
  return null;
}

function normalizeLoopContinuePrompt(value: unknown, deps: LoopGroupChatPanelDeps): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || deps.t("run.hiddenContinuePrompt");
}

function listLoopGroupChatTasks(deps: LoopGroupChatPanelDeps): LoopTaskRecord[] {
  const tasksById = new Map<string, LoopTaskRecord>();
  deps.listTaskStoreFiles().forEach((filePath) => {
    deps.readTaskStoreTasks(filePath).forEach((task) => {
      const existing = tasksById.get(task.id);
      if (!existing || task.updatedAt > existing.updatedAt) {
        tasksById.set(task.id, task.taskStoreFile === filePath ? task : { ...task, taskStoreFile: filePath });
      }
    });
  });
  return Array.from(tasksById.values());
}

function listRecentLoopGroupChatTasks(limit: number, deps: LoopGroupChatPanelDeps): LoopTaskRecord[] {
  return listLoopGroupChatTasks(deps)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(1, limit));
}

function canStopLoopTaskWithRunningTaskIds(
  task: LoopTaskRecord,
  runningTaskIds: ReadonlySet<string>,
): boolean {
  return resolveLoopTaskRunControlState(task, runningTaskIds).canStop;
}

export function createLoopGroupChatPanelCoordinator(deps: LoopGroupChatPanelDeps) {
  const askThreads = new Map<string, LoopAskThread>();
  const askRuns = new Map<string, {
    aborted: boolean;
    started: boolean;
    activeTurnId?: string;
    questions: Array<{ question: string; turnId: string }>;
  }>();
  const continuingTaskIds = new Set<string>();
  let askSerial = 0;

  const syncAskThread = (
    task: LoopTaskRecord,
    thread: LoopAskThread,
    mode: "remember" | "publish" | "render",
  ): void => {
    const run = askRuns.get(task.id);
    const queuedIds = new Set(run?.questions.map((question) => question.turnId));
    if (run?.activeTurnId && !run.started) {
      queuedIds.add(run.activeTurnId);
    }
    thread = {
      ...thread,
      messages: thread.messages.map((message) => {
        const { queued: _queued, ...bubble } = message;
        return thread.running && message.role === "user" && queuedIds.has(message.id)
          ? { ...bubble, queued: true }
          : bubble;
      }),
    };
    askThreads.set(task.id, thread);
    try {
      deps.writeAskThread?.(task, thread);
    } catch {
      // Persistence is best-effort. The in-memory thread still drives the open panel.
    }
    const panel = deps.panelsByTaskId.get(task.id);
    if (!panel) {
      return;
    }
    panel.setAskThread(thread);
    if (mode === "publish") {
      panel.publishAskThread();
      return;
    }
    if (mode === "render") {
      panel.update(buildLoopGroupChatPanelState(deps.readTaskRecord(task.id) ?? task, deps));
      panel.publishAskThread();
    }
  };

  const ensureAskThread = (task: LoopTaskRecord): LoopAskThread => {
    const cached = askThreads.get(task.id);
    if (cached) {
      return cached;
    }
    let loaded = deps.readAskThread?.(task) ?? createEmptyLoopAskThread();
    if (loaded.running) {
      loaded = settleLoopAskTurn(loaded, {
        notice: deps.t("loopGroupChatChat.askStopped"),
        now: Date.now(),
        noticeId: `ask-stopped-${task.id}`,
      });
      askThreads.set(task.id, loaded);
      try {
        deps.writeAskThread?.(task, loaded);
      } catch {
        // A stale running snapshot can stay in memory if the file cannot be rewritten.
      }
      return loaded;
    }
    askThreads.set(task.id, loaded);
    return loaded;
  };

  const refresh = async (taskId: string): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      return;
    }
    const panel = deps.panelsByTaskId.get(normalizedTaskId);
    if (!panel) {
      return;
    }
    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopGroupChatChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }
    await deps.prepareModelSwitchOptions?.(task);
    panel.setAskThread(ensureAskThread(task));
    panel.update(buildLoopGroupChatPanelState(deps.readTaskRecord(task.id) ?? task, deps));
  };

  const runContinuation = async (taskId: string, prompt?: unknown, resumeIdle = false): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.noTask"));
      return;
    }

    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopGroupChatChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }
    const runningTaskIds = deps.collectRunningTaskIds();
    const controlState = resolveLoopTaskRunControlState(task, runningTaskIds);
    const canResumeIdle = resumeIdle && task.status !== "completed"
      && (task.schedulingMode === "event_driven" || !runningTaskIds.has(task.id));
    if (!controlState.canContinue && !canResumeIdle) {
      await refresh(normalizedTaskId);
      deps.showInformationMessage(
        controlState.isRunning
          ? deps.t("loopGroupChatChat.continueAlreadyRunning")
          : deps.t("loopGroupChatChat.continueUnavailable")
      );
      return;
    }

    await deps.revealPanelView();
    const resumePrompt = normalizeLoopContinuePrompt(prompt, deps);
    if (task.originProfile?.configId && task.modelRouting && deps.restoreOriginalLoopRuntime) {
      const restored = await deps.restoreOriginalLoopRuntime(task);
      if (!restored.ok || !restored.target?.tabId) {
        deps.showWarningMessage(restored.message || deps.t("loopGroupChatChat.originalRuntimeUnavailable"));
        return;
      }
      if (deps.isTabRunActive(restored.target.tabId)) {
        deps.showInformationMessage(deps.t("loopGroupChatChat.continueAlreadyRunning"));
        return;
      }
      const profile = task.originProfile;
      await deps.runLoopPrompt(applyLoopModelRoutingToPrompt({
        displayPrompt: resumePrompt,
        modelPrompt: resumePrompt,
        contextTags: [],
        ...(task.loopSubtaskMode ? { loopSubtaskMode: task.loopSubtaskMode } : {}),
        ...(profile.mainThinkingMode ? { loopMainThinkingMode: profile.mainThinkingMode } : {}),
        ...(profile.subtaskThinkingMode ? { loopSubtaskThinkingMode: profile.subtaskThinkingMode } : {}),
        ...(profile.subtaskFrontendThinkingMode ? { loopSubtaskFrontendThinkingMode: profile.subtaskFrontendThinkingMode } : {}),
        ...(profile.subtaskFullstackThinkingMode ? { loopSubtaskFullstackThinkingMode: profile.subtaskFullstackThinkingMode } : {}),
        loopContinuePrompt: resumePrompt,
      }, task.modelRouting, task.originProfile), {
        targetTabId: restored.target.tabId,
        resumeTaskId: task.id,
        resumeRequested: true,
        preserveLoopOrigin: true,
        ...(task.schedulingMode === "event_driven" ? { schedulingMode: "event_driven" as const } : {}),
      });
      await refresh(normalizedTaskId);
      return;
    }

    const target = deps.resolveMainPromptTarget(task, { createIfMissing: true });
    if (!target) {
      deps.showWarningMessage(deps.t("loopGroupChatChat.continueUnavailable"));
      return;
    }

    await deps.switchVisibleConversationTabForLoop(target.tabId);
    if (deps.isTabRunActive(target.tabId)) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.continueAlreadyRunning"));
      return;
    }

    const activeConfigId = deps.getActiveConfigIdForCli(target.cli);
    const currentModels = resolveCurrentLoopModelPair({
      cli: target.cli,
      configId: activeConfigId,
      getSelectedCliModel: deps.getSelectedCliModel,
      getSelectedLoopCliModel: deps.getSelectedLoopCliModel,
      getSelectedLoopSubtaskCli: deps.getSelectedLoopSubtaskCli,
      getSelectedLoopFrontendCli: deps.getSelectedLoopFrontendCli,
      getSelectedLoopFullstackCli: deps.getSelectedLoopFullstackCli,
      getSelectedLoopSubtaskMode: deps.getSelectedLoopSubtaskMode,
      getLoopRoleExplicitModel: deps.getLoopRoleExplicitModel,
      getActiveConfigIdForCli: deps.getActiveConfigIdForCli,
    });
    if (currentModels.unavailableReason) {
      deps.showWarningMessage(currentModels.unavailableReason);
      return;
    }
    await deps.runLoopPrompt({
      displayPrompt: resumePrompt,
      modelPrompt: resumePrompt,
      contextTags: [],
      ...promptModelsFromContinuePair(currentModels),
      loopContinuePrompt: resumePrompt,
    }, {
      targetTabId: target.tabId,
      resumeTaskId: task.id,
      resumeRequested: true,
      ...(task.schedulingMode === "event_driven" ? { schedulingMode: "event_driven" as const } : {}),
    });
    await refresh(normalizedTaskId);
  };

  const continueTask = async (taskId: string, prompt?: unknown, _legacySource?: unknown, resumeIdle = false): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id)
      ?? taskId;
    if (continuingTaskIds.has(normalizedTaskId)) {
      return;
    }
    continuingTaskIds.add(normalizedTaskId);
    try {
      await runContinuation(normalizedTaskId, prompt, resumeIdle);
    } catch (error) {
      deps.showWarningMessage(error instanceof Error ? error.message : String(error));
    } finally {
      continuingTaskIds.delete(normalizedTaskId);
      try {
        await refresh(normalizedTaskId);
      } finally {
        const task = deps.readTaskRecord(normalizedTaskId);
        postToPanel(normalizedTaskId, {
          type: "loopGroupChatChat:continueTaskSettled",
          canContinue: task ? resolveLoopTaskRunControlState(task, deps.collectRunningTaskIds()).canContinue : false,
        });
      }
    }
  };

  const switchingTaskIds = new Set<string>();
  const switchModels = async (taskId: string, models: unknown, thinkingModes?: unknown): Promise<void> => {
    if (switchingTaskIds.has(taskId)) {
      return;
    }
    switchingTaskIds.add(taskId);
    try {
      let task = deps.readTaskRecord(taskId);
      if (!task) {
        throw new Error(deps.t("loopGroupChatChat.taskMissing", { taskId }));
      }
      await deps.prepareModelSwitchOptions?.(task);
      task = deps.readTaskRecord(taskId);
      if (!task) {
        throw new Error(deps.t("loopGroupChatChat.taskMissing", { taskId }));
      }
      const result = resolveLoopModelSwitch(task, buildLoopModelSwitchState(task, deps), models, thinkingModes);
      if (!result.ok) {
        throw new Error(result.error);
      }
      const updated = deps.updateTaskRecord(task.id, {
        modelRouting: result.modelRouting,
        originProfile: result.originProfile,
        updatedAt: Date.now(),
      });
      if (!updated) {
        throw new Error("模型保存失败，请刷新后重试。");
      }
      await refresh(taskId);
      const resumeMain = () => { void continueTask(taskId, undefined, undefined, true); };
      const handled = deps.resumeLoopSubtasks?.(taskId, resumeMain);
      postToPanel(taskId, { type: "loopGroupChatChat:switchModelsSettled", ok: true });
      if (handled === false || (handled !== true && resolveLoopTaskRunControlState(updated, deps.collectRunningTaskIds()).canContinue)) {
        resumeMain();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      postToPanel(taskId, { type: "loopGroupChatChat:switchModelsSettled", ok: false, error: message });
      deps.showWarningMessage(message);
    } finally {
      switchingTaskIds.delete(taskId);
    }
  };

  const supplementTask = async (taskId: string, prompt?: unknown): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.noTask"));
      return;
    }

    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopGroupChatChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }

    const supplementalRequirement = deps.normalizeSupplementalRequirement(prompt);
    if (!supplementalRequirement) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.continueUnavailable"));
      return;
    }

    const nextRequirements = deps.appendSupplementalRequirement(task.supplementalRequirements, supplementalRequirement);
    deps.updateTaskRecord(task.id, {
      supplementalRequirements: nextRequirements,
      updatedAt: Date.now(),
    });
    deps.appendSupplementalRequirementToCommunication(task, supplementalRequirement);
    if (resolveLoopSchedulingMode(task.schedulingMode) === "event_driven") {
      deps.notifyLoopPlusUserMessage?.(task.id, supplementalRequirement);
    }
    await refresh(normalizedTaskId);
  };

  const askMainModel = async (taskId: string, prompt?: unknown): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.noTask"));
      return;
    }
    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopGroupChatChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }
    const question = deps.normalizeSupplementalRequirement(prompt);
    const current = ensureAskThread(task);
    if (!question || !deps.askMainModel) {
      const error = deps.t("loopGroupChatChat.askUnavailable");
      if (!deps.panelsByTaskId.get(task.id)) {
        deps.showInformationMessage(error);
        return;
      }
      syncAskThread(task, settleLoopAskTurn(setLoopAskDialogOpen(current, true, Date.now()), {
        notice: error,
        now: Date.now(),
        noticeId: `ask-unavailable-${askSerial += 1}`,
      }), "render");
      return;
    }
    const turnId = `ask-${Date.now().toString(36)}-${askSerial += 1}`;
    const existingRun = askRuns.get(task.id);
    const run: NonNullable<ReturnType<typeof askRuns.get>> = existingRun ?? { aborted: false, started: false, questions: [] };
    run.questions.push({ question, turnId });
    askRuns.set(task.id, run);
    const started = {
      ...beginLoopAskTurn(current, question, Date.now(), turnId),
      queued: !run.started,
    };
    syncAskThread(task, started, "publish");
    if (existingRun) {
      return;
    }
    while (run.questions.length > 0 && !run.aborted && askRuns.get(task.id) === run) {
      const next = run.questions.shift()!;
      run.activeTurnId = next.turnId;
      let result: LoopMainModelAnswerResult;
      try {
        result = await deps.askMainModel(deps.readTaskRecord(task.id) ?? task, next.question, {
          isAborted: () => run.aborted,
          onStarted: () => {
            if (run.aborted || askRuns.get(task.id) !== run) {
              return;
            }
            run.started = true;
            syncAskThread(task, { ...(askThreads.get(task.id) ?? started), queued: false }, "publish");
          },
        });
      } catch (error) {
        const detail = error instanceof Error && error.message.trim() ? error.message.trim() : String(error);
        result = { status: "error", error: deps.t("loopGroupChatChat.askFailed", { detail }) };
      }
      if (askRuns.get(task.id) !== run) {
        return;
      }
      run.started = false;
      run.activeTurnId = undefined;
      const thread = askThreads.get(task.id) ?? started;
      const settled = settleLoopAskTurn(thread, {
        ...(result.status === "ready" ? { answer: result.answer } : {}),
        notice: result.status === "stopped"
          ? deps.t("loopGroupChatChat.askStopped")
          : result.status === "error" ? result.error : deps.t("loopGroupChatChat.askEmpty"),
        now: Date.now(),
        noticeId: `${next.turnId}:result`,
      });
      const pending = run.questions.length > 0 && !run.aborted;
      syncAskThread(task, { ...settled, running: pending, queued: pending }, "render");
    }
    if (askRuns.get(task.id) === run) {
      askRuns.delete(task.id);
    }
  };

  const stopTask = async (taskId: string): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.noTask"));
      return;
    }

    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.showWarningMessage(deps.t("loopGroupChatChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }

    if (!canStopLoopTaskWithRunningTaskIds(task, deps.collectRunningTaskIds())) {
      await refresh(normalizedTaskId);
      deps.showInformationMessage(deps.t("loopGroupChatChat.stopUnavailable"));
      return;
    }

    deps.stopRunsForTask(task.id);
    deps.markTaskStoppedByUser(task.id);
    await deps.postPanelState();
    await refresh(normalizedTaskId);
  };


  const clarificationIssueMessage = (issue: { code: "required" | "invalid-option"; label: string }): string => (
    deps.t(issue.code === "required" ? "loopGroupChatChat.clarificationRequired" : "loopGroupChatChat.clarificationInvalid", {
      label: issue.label,
    })
  );

  const submitClarification = async (taskId: string, interactionId: unknown, values: unknown): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    const safeInteractionId = typeof interactionId === "string" ? interactionId.trim() : "";
    const task = normalizedTaskId ? deps.readTaskRecord(normalizedTaskId) : null;
    const request = task?.pendingClarification;
    if (!task || !request || !safeInteractionId || request.interactionId !== safeInteractionId) {
      deps.showWarningMessage(deps.t("loopGroupChatChat.clarificationUnavailable"));
      return;
    }
    const normalized = normalizeClarificationSubmission(request, values);
    if (!normalized.ok) {
      deps.showWarningMessage(clarificationIssueMessage(normalized.issue));
      await refresh(task.id);
      return;
    }
    const delivered = submitOrchestratorClarification(loopClarificationScope(task.id), safeInteractionId, normalized.values);
    if (delivered.ok) {
      await refresh(task.id);
      return;
    }
    if (delivered.reason === "invalid" && delivered.issue) {
      deps.showWarningMessage(clarificationIssueMessage(delivered.issue));
      await refresh(task.id);
      return;
    }
    const answer = formatOrchestratorClarificationAnswer({
      interactionId: safeInteractionId,
      status: "completed",
      values: normalized.values,
    }, request.formFields);
    const nextRequirements = deps.appendSupplementalRequirement(task.supplementalRequirements, answer);
    deps.updateTaskRecord(task.id, {
      supplementalRequirements: nextRequirements,
      pendingClarification: undefined,
      updatedAt: Date.now(),
    });
    deps.appendSupplementalRequirementToCommunication(task, answer);
    try {
      const chatFile = buildLoopMainSubChatTranscriptFile(task.communicationDir);
      fs.mkdirSync(path.dirname(chatFile), { recursive: true });
      fs.appendFileSync(chatFile, `\n## 用户补充澄清\n${answer}\n`, "utf8");
    } catch {
      // The supplemental requirement is already persisted for the next main turn.
    }
    const target = deps.resolveMainPromptTarget(task, { createIfMissing: true });
    if (!target || deps.isTabRunActive(target.tabId)) {
      await refresh(task.id);
      deps.showInformationMessage(deps.t("loopGroupChatChat.clarificationSubmitted"));
      return;
    }
    await deps.revealPanelView();
    await deps.switchVisibleConversationTabForLoop(target.tabId);
    await deps.runLoopPrompt({
      displayPrompt: deps.t("run.hiddenContinuePrompt"),
      modelPrompt: task.rootPrompt,
      contextTags: [],
      loopContinuePrompt: deps.t("run.hiddenContinuePrompt"),
    }, {
      targetTabId: target.tabId,
      resumeTaskId: task.id,
      resumeRequested: true,
      preserveLoopOrigin: true,
      ...(task.schedulingMode === "event_driven" ? { schedulingMode: "event_driven" as const } : {}),
    });
    await refresh(task.id);
  };

  const rejectClarification = async (taskId: string, interactionId: unknown): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    const safeInteractionId = typeof interactionId === "string" ? interactionId.trim() : "";
    const task = normalizedTaskId ? deps.readTaskRecord(normalizedTaskId) : null;
    const request = task?.pendingClarification;
    if (!task || !request || request.interactionId !== safeInteractionId) {
      deps.showWarningMessage(deps.t("loopGroupChatChat.clarificationUnavailable"));
      return;
    }
    if (rejectOrchestratorClarification(loopClarificationScope(task.id), safeInteractionId)) {
      await refresh(task.id);
      return;
    }
    deps.updateTaskRecord(task.id, {
      status: "needs-review",
      pendingClarification: undefined,
      activeSubtaskId: null,
      activeSubtaskIds: [],
      finalSummary: "用户拒绝了主任务澄清，任务已暂停。",
      updatedAt: Date.now(),
    });
    await refresh(task.id);
    deps.showInformationMessage(deps.t("loopGroupChatChat.clarificationRejected"));
  };

  const handleMessage = async (taskId: string, message: LoopGroupChatPanelMessage): Promise<void> => {
    if (!message || typeof message.type !== "string") {
      return;
    }
    if (message.type === "loopGroupChatChat:refresh") {
      await refresh(taskId);
      return;
    }
    if (message.type === "loopGroupChatChat:continueTask") {
      await continueTask(taskId, message.prompt);
      return;
    }
    if (message.type === "loopGroupChatChat:switchModels") {
      await switchModels(taskId, message.models, message.thinkingModes);
      return;
    }
    if (message.type === "loopGroupChatChat:supplementTask") {
      await supplementTask(taskId, message.prompt);
      return;
    }
    if (message.type === "loopGroupChatChat:askMainModel") {
      await askMainModel(taskId, message.prompt);
      return;
    }
    if (message.type === "loopGroupChatChat:abortMainModelQuestion") {
      const normalizedTaskId = deps.normalizeTaskId(taskId)
        ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
      const run = normalizedTaskId ? askRuns.get(normalizedTaskId) : undefined;
      if (run) {
        run.aborted = true;
        run.questions.length = 0;
      }
      const task = normalizedTaskId ? deps.readTaskRecord(normalizedTaskId) : null;
      if (task && run) {
        if (run.started) {
          deps.abortMainModelRun?.(task);
        }
        askRuns.delete(task.id);
        syncAskThread(task, settleLoopAskTurn(ensureAskThread(task), {
          notice: deps.t("loopGroupChatChat.askStopped"),
          now: Date.now(),
          noticeId: `ask-stopped-${askSerial += 1}`,
        }), "render");
      }
      return;
    }
    if (
      message.type === "loopGroupChatChat:openAskDialog"
      || message.type === "loopGroupChatChat:closeAskDialog"
      || message.type === "loopGroupChatChat:dismissMainModelAnswer"
    ) {
      const normalizedTaskId = deps.normalizeTaskId(taskId)
        ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
      const task = normalizedTaskId ? deps.readTaskRecord(normalizedTaskId) : null;
      if (!task) {
        return;
      }
      syncAskThread(task, setLoopAskDialogOpen(
        ensureAskThread(task),
        message.type === "loopGroupChatChat:openAskDialog",
        Date.now(),
      ), "remember");
      if (message.type === "loopGroupChatChat:openAskDialog") {
        await refresh(task.id);
      }
      return;
    }
    if (message.type === "loopGroupChatChat:stopTask") {
      await stopTask(taskId);
      return;
    }
    if (message.type === "loopGroupChatChat:submitClarification") {
      await submitClarification(taskId, message.interactionId, message.values);
      return;
    }
    if (message.type === "loopGroupChatChat:rejectClarification") {
      await rejectClarification(taskId, message.interactionId);
      return;
    }
    if (message.type === "loopGroupChatChat:openCommunicationFile") {
      openCommunicationFile(taskId, message.requestId, message.path);
      return;
    }
    if (
      message.type === "saveLoopPlusAcceptancePlan"
      || message.type === "selectLoopPlusAcceptancePlan"
      || message.type === "deleteLoopPlusAcceptancePlan"
    ) {
      await saveAcceptancePlanMessage(taskId, message);
      return;
    }
    if (message.type === "loopGroupChatChat:updateAcceptancePlan") {
      await updateAcceptancePlan(taskId, message.plan);
    }
  };

  const postToPanel = (taskId: string, message: unknown): void => {
    const normalizedTaskId = deps.normalizeTaskId(taskId);
    const panel = normalizedTaskId ? deps.panelsByTaskId.get(normalizedTaskId) : undefined;
    panel?.post(message);
  };

  const saveAcceptancePlanMessage = async (
    taskId: string,
    message: Extract<LoopGroupChatPanelMessage, { type: "saveLoopPlusAcceptancePlan" | "selectLoopPlusAcceptancePlan" | "deleteLoopPlusAcceptancePlan" }>,
  ): Promise<void> => {
    if (message.type === "deleteLoopPlusAcceptancePlan") {
      const result = deps.deleteLoopPlusAcceptancePlan?.(message.planId) ?? {
        ok: false as const,
        error: "验收方案保存失败，请稍后重试。",
      };
      postToPanel(taskId, result.ok
        ? { type: "loopPlusAcceptancePlanSaved", plan: result.plan, plans: result.plans, selection: result.selection }
        : { type: "loopPlusAcceptancePlanSaved", error: result.error });
      if (result.ok) {
        await deps.postPanelState();
      }
      return;
    }
    if (message.type === "selectLoopPlusAcceptancePlan") {
      const result = deps.selectLoopPlusAcceptancePlan?.(message.planId) ?? {
        ok: false as const,
        error: "验收方案保存失败，请稍后重试。",
      };
      postToPanel(taskId, result.ok
        ? { type: "loopPlusAcceptancePlanSelected", selection: result.selection }
        : { type: "loopPlusAcceptancePlanSelected", error: result.error });
      if (result.ok) {
        await deps.postPanelState();
      }
      return;
    }
    const result = deps.saveLoopPlusAcceptancePlan?.({
      planId: message.planId,
      name: message.name,
      checks: message.checks,
      otherText: message.otherText,
      select: message.select,
    }) ?? { ok: false as const, error: "验收方案保存失败，请稍后重试。" };
    postToPanel(taskId, result.ok
      ? { type: "loopPlusAcceptancePlanSaved", plan: result.plan, plans: result.plans, selection: result.selection }
      : { type: "loopPlusAcceptancePlanSaved", error: result.error });
    if (result.ok) {
      await deps.postPanelState();
    }
  };

  const updateAcceptancePlan = async (taskId: string, plan: unknown): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      return;
    }
    const result = deps.applyLoopPlusAcceptancePlan?.(normalizedTaskId, plan) ?? {
      ok: false as const,
      error: "验收方案更新失败，请稍后重试。",
    };
    postToPanel(normalizedTaskId, {
      type: "loopGroupChatChat:acceptancePlanUpdated",
      ...(result.ok ? { plan: result.plan ?? null } : { error: result.error }),
    });
    if (result.ok) {
      await refresh(normalizedTaskId);
    }
  };

  const openCommunicationFile = (taskId: string, requestId: unknown, requestedPath: unknown): void => {
    const normalizedTaskId = deps.normalizeTaskId(taskId);
    const panel = normalizedTaskId ? deps.panelsByTaskId.get(normalizedTaskId) : undefined;
    const safeRequestId = typeof requestId === "string" ? requestId.trim() : "";
    if (!panel || !normalizedTaskId || !safeRequestId || safeRequestId.length > 80) {
      return;
    }
    const task = deps.readTaskRecord(normalizedTaskId);
    const preview = task
      ? readLoopCommunicationFilePreview(requestedPath, collectLoopCommunicationPreviewRoots(task))
      : { ok: false as const, path: typeof requestedPath === "string" ? requestedPath : "", error: "missing" as const };
    panel.postCommunicationFilePreview({
      type: "loopGroupChatChat:communicationFile",
      requestId: safeRequestId,
      path: preview.path,
      ok: preview.ok,
      ...(preview.ok ? { html: preview.html } : { error: preview.error }),
    });
  };

  const resolveTask = async (arg?: unknown): Promise<LoopTaskRecord | null> => {
    const explicitTaskId = extractLoopGroupChatPanelTaskId(arg, deps);
    if (explicitTaskId) {
      const task = deps.readTaskRecord(explicitTaskId);
      if (task) {
        return task;
      }
      deps.showWarningMessage(deps.t("loopGroupChatChat.taskMissing", { taskId: explicitTaskId }));
    }

    const activeTaskId = deps.getActiveConversationTaskId();
    if (activeTaskId) {
      const activeTask = deps.readTaskRecord(activeTaskId);
      if (activeTask) {
        return activeTask;
      }
    }

    const recentTasks = listRecentLoopGroupChatTasks(24, deps);
    if (recentTasks.length === 0) {
      return null;
    }
    if (recentTasks.length === 1) {
      return recentTasks[0] ?? null;
    }
    return deps.pickTask(recentTasks);
  };

  const open = async (arg?: unknown): Promise<void> => {
    const task = await resolveTask(arg);
    if (!task) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.noTask"));
      return;
    }
    await deps.prepareModelSwitchOptions?.(task);
    const state = buildLoopGroupChatPanelState(task, deps);
    let panel = deps.panelsByTaskId.get(task.id);
    if (!panel) {
      const taskId = task.id;
      panel = new LoopGroupChatPanel(deps.getExtensionUri(), {
        onMessage: (message) => {
          void handleMessage(taskId, message);
        },
        onDispose: () => {
          const currentPanel = deps.panelsByTaskId.get(taskId);
          if (currentPanel === panel) {
            deps.panelsByTaskId.delete(taskId);
          }
        },
      });
      deps.panelsByTaskId.set(task.id, panel);
    }
    panel.setAskThread(ensureAskThread(task));
    panel.show(state);
  };

  const refreshOpenPanelForTask = (taskId: string): void => {
    if (!deps.panelsByTaskId.has(taskId)) {
      return;
    }
    void refresh(taskId);
  };

  const buildMessageAction = (taskId: string, round?: number): ChatMessageAction => {
    return buildLoopGroupChatMessageAction(taskId);
  };

  return {
    open,
    continueTask,
    switchModels,
    refresh,
    refreshOpenPanelForTask,
    buildMessageAction,
    listGroupChatTasks: () => listLoopGroupChatTasks(deps),
  };
}
