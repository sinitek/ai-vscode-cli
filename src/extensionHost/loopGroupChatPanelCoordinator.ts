import * as fs from "fs";
import type { CodexRuntimeConfigEvidence } from "../config/codexRuntimeConfigIdentity";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import type { DepartmentCapacitySnapshot } from "../departmentcapacity";
import { assertDepartmentOrganizationContinuation, buildDepartmentGroupChatProjection, normalizeDepartmentEmployeeAllocation, departmentMetadata, resolveDepartmentRoot, authorizeDepartmentLeader, type DepartmentLeaderOwnershipReader } from "./departmentGroupChatProjection";
import { DEPARTMENT_GROUP_CHAT_TASK_MESSAGE_TYPES, type DepartmentGroupChatModalTarget, type DepartmentEmployeeAllocationProjection, type DepartmentEmployeeLimitRequest, type DepartmentOrganizationStopState } from "../webview/loopGroupChatPanelTypes";
import * as path from "path";
import { ChatImageHost, isChatImageMessage } from "../webview/chatImageHost";
import { isChatLinkMessage, openChatLink } from "../webview/chatLinkHost";
import { normalizeChatImageSource } from "../webview/chatImagePreview";
import { normalizeChatLinkSource, resolveChatLocalLink } from "../webview/chatLink";
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
import { isLoopMainAiFailureLimitReached, isLoopMainStartupConfigLockTimeout } from "../loopMainFailure";
import { createLoopPlusScheduler } from "../loopPlusScheduler";
import type { PromptRunInput } from "../promptRunTypes";
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
import { departmentLifecycleDiagnostic } from "./departmentlifecyclediagnostics";
import {
  collectLoopCommunicationPreviewRoots,
  readLoopCommunicationFilePreview,
} from "../loopCommunicationFilePreview";
import { resolveLoopSchedulingMode, type LoopTaskOriginProfile, type LoopTaskRecord, type LoopTaskUserStopSource } from "../loopTaskStore";
import { normalizeLoopSubtaskId } from "../loopConversationPresentation";

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
  resumeUserMessage?: string;
  preserveLoopOrigin?: boolean;
  configLockRecovery?: ConfigLockResumeRequest;
  schedulingMode?: "classic" | "event_driven";
  onTaskStarted?: () => void;
};

export type ConfigLockResumeRequest = {
  readTask: () => LoopTaskRecord | null;
  isTargetCurrent: () => boolean;
  codexConfigEvidence: CodexRuntimeConfigEvidence;
  unavailableMessage: string;
};

type LoopOriginRestoreResult = {
  ok: boolean;
  target?: LoopPromptTarget;
  isOriginalTargetCurrent?: () => boolean;
  codexConfigEvidence?: CodexRuntimeConfigEvidence;
  message?: string;
};

type LoopPromptTarget = {
  tabId: string | null;
  cli: CliName;
};

export type DepartmentOrganizationControl = {
  /** Central composition owns subtree lifecycle; this port never falls back to a single-task run. */
  continue(root: LoopTaskRecord, prompt?: string): Promise<void>;
  stop(root: LoopTaskRecord): Promise<void>;
  complete(root: LoopTaskRecord): Promise<void>;
};

/** Integration installs a durable CAS writer. This seam never writes a task or starts work. */
export type DepartmentEmployeeAllocationWritePort = (root: LoopTaskRecord, request: DepartmentEmployeeLimitRequest) => Promise<
  { ok: true; allocation: DepartmentEmployeeAllocationProjection } | { ok: false; error: string }>;

type LoopGroupChatPanelDeps = LoopModelSwitchDeps & {
  readDepartmentEmployeeAllocation?: (rootTaskId: string) => DepartmentEmployeeAllocationProjection | null;
  updateDepartmentEmployeeLimit?: DepartmentEmployeeAllocationWritePort;
  readDepartmentCapacity?: (rootTaskId: string) => DepartmentCapacitySnapshot | null;
  readDepartmentLeaderTaskIds?: DepartmentLeaderOwnershipReader;
  departmentOrganizationControl?: DepartmentOrganizationControl;
  continueDepartmentLeader?: (task: LoopTaskRecord, prompt: string, assertCurrent: () => void) => Promise<void>;
  /** Validates the fresh root against the trusted source and active workspace. */
  readDepartmentOrganizationControlState?(task: LoopTaskRecord): { needsCleanup: boolean; stopState?: DepartmentOrganizationStopState } | null;
  hasLocalDepartmentDirectorActivity?(rootTaskId: string): boolean;
  observeDepartmentColdProjection?(rootTaskId: string, interrupted: boolean): void;
  prepareModelSwitchOptions?: (task: LoopTaskRecord) => Promise<void>;
  getExtensionUri: () => vscode.Uri;
  getMessageLimit?: () => number;
  panelsByTaskId: Map<string, LoopGroupChatPanel>;
  normalizeTaskId: (value: unknown) => string | null;
  normalizeSupplementalRequirement: (value: unknown) => string | null;
  appendSupplementalRequirement: (existing: readonly string[] | undefined, nextItem: string) => string[];
  appendSupplementalRequirementToCommunication: (task: LoopTaskRecord, requirement: string) => void;
  recordPromptHistory: (prompt: string, cli: CliName) => void;
  readTaskRecord: (taskId: string) => LoopTaskRecord | null;
  readConfigLockResumeTask?: (taskId: string, taskStoreFile: string) => LoopTaskRecord | null;
  updateTaskRecord: (taskId: string, patch: Partial<LoopTaskRecord>) => LoopTaskRecord | null;
  listTaskStoreFiles: () => string[];
  readTaskStoreTasks: (filePath: string) => LoopTaskRecord[];
  collectRunningTaskIds: () => Set<string>;
  readTextFileIfNonEmpty: (filePath: string) => string | null;
  fileExists: (filePath: string) => boolean;
  writeTextFileEnsuringDir: (filePath: string, content: string) => boolean;
  getActiveSubtaskIds: (task: LoopTaskRecord) => string[];
  getActiveReviewEventIds?: (taskId: string) => readonly string[];
  buildCompletedConclusionAndSummaryMarkdown: (task: LoopTaskRecord) => string;
  resolveMainPromptTarget: (
    task: LoopTaskRecord,
    options?: { createIfMissing?: boolean },
  ) => LoopPromptTarget | null;
  revealPanelView: () => Promise<void>;
  resolveSubtaskConversationTabId?: (task: LoopTaskRecord, subtaskId: string) => string | null;
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
  restoreOriginalLoopRuntime?: (task: LoopTaskRecord, options?: { configLockRecovery: true; originalTabId?: string }) => Promise<LoopOriginRestoreResult>;
  isConfigLockResumeSessionAvailable?: (task: LoopTaskRecord, restoredTabId?: string) => boolean;
  runLoopPrompt: (input: LoopPromptRunInput, options: LoopPromptRunOptions) => Promise<void>;
  stopRunsForTask: (taskId: string) => void;
  markTaskStoppedByUser: (taskId: string, source: LoopTaskUserStopSource) => LoopTaskRecord | null;
  postPanelState: () => Promise<void>;
  getActiveConversationTaskId: () => string | null;
  showInformationMessage: (message: string) => void;
  showWarningMessage: (message: string) => void;
  logEvent?: (event: string, payload: Record<string, unknown>) => void;
  pickTask: (tasks: LoopTaskRecord[]) => Promise<LoopTaskRecord | null>;
  notifyLoopPlusUserMessage?: (taskId: string, text: string) => void;
  cancelClassicSubtask?: (taskId: string, subtaskId: string) => Promise<boolean>;
  wakeClassicLoop?: (taskId: string) => void;
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
      signal?: AbortSignal;
    },
  ) => Promise<LoopMainModelAnswerResult>;
  readAskThread?: (task: LoopTaskRecord) => LoopAskThread;
  writeAskThread?: (task: LoopTaskRecord, thread: LoopAskThread) => void;
  t: typeof import("../i18n").t;
};

export function buildLoopGroupChatPanelState(
  task: LoopTaskRecord,
  deps: LoopGroupChatPanelDeps,
): LoopGroupChatPanelState {
  const departmentRoot = resolveDepartmentRoot(task, deps);
  const isDirector = departmentRoot?.id === task.id;
  const rootControl = departmentRoot && deps.readDepartmentOrganizationControlState?.(departmentRoot);
  const organization = isDirector ? rootControl ?? undefined : undefined;
  const localDirectorActivity = departmentRoot && rootControl ? deps.hasLocalDepartmentDirectorActivity?.(departmentRoot.id) : undefined;
  const runningTaskIds = deps.collectRunningTaskIds();
  const isLocalExecutionInactive = (record: LoopTaskRecord): boolean => {
    if (localDirectorActivity === undefined) return false;
    if (record.id === departmentRoot?.id) return !localDirectorActivity && !runningTaskIds.has(record.id);
    return !runningTaskIds.has(record.id);
  };
  const locallyInactive = isLocalExecutionInactive(task);
  const interruptedInHost = locallyInactive && task.status === "running";
  if (isDirector && localDirectorActivity !== undefined) {
    deps.observeDepartmentColdProjection?.(task.id, interruptedInHost);
  }
  const displayTask = interruptedInHost ? { ...task, status: "stopped" as const }
    : isDirector ? projectInterruptedDirector(task) : task;
  const stopState = organization?.stopState
    ?? (organization?.needsCleanup && displayTask.status !== "running" ? "unconfirmed" : undefined);
  const isMainModelRunning = (record: LoopTaskRecord): boolean => {
    const target = deps.resolveMainPromptTarget(record, { createIfMissing: false });
    return Boolean(target && deps.isTabRunActive(target.tabId));
  };
  const mainModelBusy = !locallyInactive && isMainModelRunning(task);
  const department = buildDepartmentGroupChatProjection(task, {
    readTaskRecord: deps.readTaskRecord, readLeaderTaskIds: deps.readDepartmentLeaderTaskIds, readCapacity: deps.readDepartmentCapacity,
    readEmployeeAllocation: deps.readDepartmentEmployeeAllocation, employeeAllocationWritable: typeof deps.updateDepartmentEmployeeLimit === "function",
    getActiveReviewEventIds: deps.getActiveReviewEventIds,
    isLocalExecutionInactive,
    ...(isDirector ? { isMainModelRunning } : {}),
  });
  const panelTask = department?.role === "director" && department.overallProgressPercent !== undefined
    ? { ...displayTask, loopProgressPercent: department.overallProgressPercent }
    : displayTask;
  const state = buildLoopGroupChatPanelStateWithDeps(panelTask, {
    collectRunningLoopTaskIds: () => runningTaskIds,
    readTextFileIfNonEmpty: deps.readTextFileIfNonEmpty,
    fileExists: deps.fileExists,
    writeTextFileEnsuringDir: deps.writeTextFileEnsuringDir,
    getActiveLoopSubtaskIds: deps.getActiveSubtaskIds,
    getActiveReviewEventIds: deps.getActiveReviewEventIds ?? (() => []),
    mainModelRunning: mainModelBusy,
    localExecutionInactive: locallyInactive,
    buildLoopCompletedConclusionAndSummaryMarkdown: deps.buildCompletedConclusionAndSummaryMarkdown,
    t: deps.t,
  });
  const acceptancePlanState = resolveLoopSchedulingMode(task.schedulingMode) === "event_driven"
    ? {
      acceptancePlans: deps.readLoopPlusAcceptancePlans?.() ?? [],
      acceptancePlanSelection: deps.readLoopPlusAcceptancePlanSelection?.() ?? "system_default",
      acceptancePlan: task.loopPlusAcceptancePlan ?? null,
    }
    : {};
  const loopPlusActiveSubtasks = resolveLoopSchedulingMode(task.schedulingMode) === "event_driven"
    && hasLoopPlusRunningSubtasks(task, "active");
  return {
    ...state,
    task: {
      ...state.task,
      canContinue: !interruptedInHost && canContinueLoopTaskWithDeps(displayTask, deps, organization),
      ...(task.status === "running" && resolveLoopSchedulingMode(task.schedulingMode) === "event_driven"
        ? { canStop: mainModelBusy || loopPlusActiveSubtasks } : {}),
      ...(interruptedInHost ? { departmentExecutionInterrupted: true } : {}),
      ...(departmentRoot ? {
        departmentStopState: stopState,
        canStop: stopState === "stopping" || displayTask.status === "running" || interruptedInHost
          || (locallyInactive && task.status === "stopped" && stopState === "unconfirmed"),
      } : {}),
    },
    ...acceptancePlanState,
    ...(departmentRoot ? { ...(department ? { department } : {}), acceptancePlan: departmentRoot?.loopPlusAcceptancePlan ?? null, acceptancePlans: [], acceptancePlanReadOnly: true } : {}),
    messageLimit: deps.getMessageLimit?.(),
    mainModelBusy,
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

function projectInterruptedDirector(task: LoopTaskRecord): LoopTaskRecord {
  return task.status === "running" && task.runtimeInterrupted ? { ...task, status: "stopped" } : task;
}

function canContinueLoopTaskWithDeps(task: LoopTaskRecord, deps: LoopGroupChatPanelDeps,
  organization = deps.readDepartmentOrganizationControlState?.(task)): boolean {
  if (organization?.needsCleanup || organization?.stopState === "stopping" || organization?.stopState === "unconfirmed") return false;
  if (departmentMetadata(task)?.role === "director") task = projectInterruptedDirector(task);
  if (isLoopMainAiFailureLimitReached(task)) return canResumeLoopPlusConfigLockPause(task, deps);
  if (resolveLoopSchedulingMode(task.schedulingMode) === "event_driven"
    && task.status === "running" && hasLoopPlusRunningSubtasks(task, "active")) return false;
  if (resolveLoopTaskRunControlState(task, deps.collectRunningTaskIds()).canContinue) {
    return true;
  }
  if (resolveLoopSchedulingMode(task.schedulingMode) !== "event_driven"
    || task.status === "completed") {
    return false;
  }
  const target = deps.resolveMainPromptTarget(task, { createIfMissing: false });
  return !(target && deps.isTabRunActive(target.tabId));
}

function hasLoopPlusRunningSubtasks(task: LoopTaskRecord, kind: "active" | "interrupted"): boolean {
  if (!task.loopPlus) return false;
  try {
    const running = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot().running;
    return running.some((attempt) => {
      const interrupted = task.subTasks.find((subtask) => subtask.id === attempt.subtaskId)?.status === "blocked";
      return kind === "interrupted" ? interrupted : !interrupted;
    });
  } catch {
    return kind === "active";
  }
}

function canResumeLoopPlusConfigLockPause(task: LoopTaskRecord, deps: LoopGroupChatPanelDeps, restoredTabId?: string): boolean {
  const configId = task.originProfile?.configId;
  const mainRoute = task.modelRouting?.main;
  if (task.cli !== "codex" || task.schedulingMode !== "event_driven" || task.status !== "needs-review"
    || task.department || task.departmentInvalid || task.pendingClarification || task.executionSessionInvalid
    || task.loopSubtaskModeInvalid || !task.sessionId || !configId || !mainRoute
    || (mainRoute.cli && mainRoute.cli !== task.cli) || (mainRoute.configId && mainRoute.configId !== configId)
    || (task.executionSession && (task.executionSession.cli !== task.cli || task.executionSession.configId !== configId))
    || !isLoopMainAiFailureLimitReached(task) || !isLoopMainStartupConfigLockTimeout(task)
    || !deps.restoreOriginalLoopRuntime || deps.collectRunningTaskIds().has(task.id)
    || !deps.isConfigLockResumeSessionAvailable?.(task, restoredTabId) || !task.loopPlus) return false;
  try {
    const snapshot = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
    return !snapshot.completed && !snapshot.parentStopped && snapshot.running.length === 0;
  } catch {
    return false;
  }
}

function configLockResumeIdentity(task: LoopTaskRecord) {
  return {
    id: task.id, workspaceKey: task.workspaceKey, taskStoreFile: task.taskStoreFile, createdAt: task.createdAt,
    cli: task.cli, sessionId: task.sessionId, executionSession: task.executionSession, originProfile: task.originProfile,
    modelRouting: task.modelRouting, loopSubtaskMode: task.loopSubtaskMode, mainAiFailureCount: task.mainAiFailureCount,
    loopPlus: task.loopPlus,
    mainAiLastFailureAt: task.mainAiLastFailureAt, mainAiLastFailureCode: task.mainAiLastFailureCode,
    mainAiLastFailureMessage: task.mainAiLastFailureMessage,
  };
}

export function createLoopGroupChatPanelCoordinator(originalDeps: LoopGroupChatPanelDeps) {
  const interruptedDepartmentProjections = new Set<string>();
  type ModalBinding = DepartmentGroupChatModalTarget & { rootTaskId: string; panel: LoopGroupChatPanel; images?: ChatImageHost };
  const bindings = new Map<string, ModalBinding>();
  const requestScope = new AsyncLocalStorage<ModalBinding>();
  // Page requests share one root fence, independent of view close/reopen.
  const organizationStops = new Map<string, { identity: string; state: DepartmentOrganizationStopState }>();
  const stopIdentity = (task: LoopTaskRecord) => JSON.stringify([task.id, task.workspaceKey, task.taskStoreFile, task.cli, task.sessionId, task.department]);
  const validBinding = (binding: ModalBinding): boolean => {
    const target = binding.panel.getDepartmentModalTarget();
    if (bindings.get(binding.rootTaskId) !== binding || originalDeps.panelsByTaskId.get(binding.rootTaskId) !== binding.panel
      || target?.taskId !== binding.taskId || target.instanceId !== binding.instanceId) return false;
    const root = originalDeps.readTaskRecord(binding.rootTaskId), leader = originalDeps.readTaskRecord(binding.taskId);
    return Boolean(root && root.id === binding.rootTaskId && leader && leader.id === binding.taskId
      && authorizeDepartmentLeader(root, leader, originalDeps, originalDeps.readDepartmentLeaderTaskIds));
  };
  const scopeValid = (): boolean => !requestScope.getStore() || validBinding(requestScope.getStore()!);
  const obsoleteRequest = new Error("组长群聊请求已失效");
  // Existing action implementations keep their validation. Guard their side-effect ports
  // again after every await, without registering the director panel under a leader ID.
  const guardedPorts = new Set<keyof LoopGroupChatPanelDeps>([
    "updateTaskRecord", "appendSupplementalRequirementToCommunication", "notifyLoopPlusUserMessage", "runLoopPrompt",
    "stopRunsForTask", "markTaskStoppedByUser", "resumeLoopSubtasks", "restoreOriginalLoopRuntime",
    "revealPanelView", "switchVisibleConversationTabForLoop", "resolveMainPromptTarget",
  ]);
  const deps = new Proxy(originalDeps, {
    get(target, key: keyof LoopGroupChatPanelDeps) {
      if (key === "observeDepartmentColdProjection") return (rootTaskId: string, interrupted: boolean) => {
        if (!interrupted) { interruptedDepartmentProjections.delete(rootTaskId); return; }
        if (interruptedDepartmentProjections.has(rootTaskId)) return;
        if (interruptedDepartmentProjections.size >= 256) {
          const oldest = interruptedDepartmentProjections.values().next();
          if (!oldest.done) interruptedDepartmentProjections.delete(oldest.value);
        }
        interruptedDepartmentProjections.add(rootTaskId);
        departmentLifecycleDiagnostic("department-cold-projection", { rootTaskId, stage: "projection",
          result: "confirmed", reason: "evidence-missing" });
      };
      const value = target[key];
      if (key === "readDepartmentOrganizationControlState") return (task: LoopTaskRecord) => {
        const trusted = target.readDepartmentOrganizationControlState?.(task);
        if (target.readDepartmentOrganizationControlState && !trusted) return trusted;
        const local = organizationStops.get(task.id);
        if (!local || local.identity !== stopIdentity(task) || !resolveDepartmentRoot(task, target)) return trusted;
        // Production owns the lifetime of settled receipts. The page fence only
        // supplies immediate, in-flight feedback while the request is dispatched.
        if (local.state !== "stopping" && trusted && "stopState" in trusted) return trusted;
        if (local.state === "confirmed" && task.status === "running" && !task.runtimeInterrupted && trusted?.stopState === undefined) {
          organizationStops.delete(task.id);
          return trusted;
        }
        const result = trusted?.stopState === "stopping" ? "stopping"
          : local.state === "stopping" ? "stopping" : trusted?.stopState ?? local.state;
        const stopState = result === "confirmed" && trusted?.needsCleanup !== false ? "unconfirmed" : result;
        return { needsCleanup: trusted?.needsCleanup !== false, stopState };
      };
      if (typeof value !== "function" || !guardedPorts.has(key)) return value;
      return (...args: unknown[]) => {
        if (!scopeValid()) throw obsoleteRequest;
        // A delayed ordinary/leader continuation must not become a director single-task run.
        if (key === "runLoopPrompt") {
          const taskId = (args[1] as LoopPromptRunOptions).resumeTaskId;
          const current = taskId ? target.readTaskRecord(taskId) : null;
          if (current?.department || current?.departmentInvalid) {
            const root = resolveDepartmentRoot(current, target);
            if (!root || root.id === current.id) throw new Error("部门任务关联已变化，拒绝单任务恢复，请从产研部继续。");
          }
        }
        return (value as (...input: unknown[]) => unknown)(...args);
      };
    },
  });
  const readContinuableDirector = (root: LoopTaskRecord): LoopTaskRecord => {
    const current = deps.readTaskRecord(root.id);
    if (!current || stopIdentity(current) !== stopIdentity(root) || resolveDepartmentRoot(current, deps)?.id !== root.id) {
      throw new Error("部门续接归属已变化。");
    }
    assertDepartmentOrganizationContinuation(current, deps.readDepartmentOrganizationControlState?.(current));
    return current;
  };
  const continueDirector = async (root: LoopTaskRecord, prompt?: string): Promise<void> => {
    const current = readContinuableDirector(root);
    const receipt = organizationStops.get(current.id);
    await deps.departmentOrganizationControl!.continue(current, prompt);
    if (receipt?.state === "confirmed" && organizationStops.get(current.id) === receipt) organizationStops.delete(current.id);
  };

  const openingPanels = new WeakMap<LoopGroupChatPanel, Promise<void>>();
  const askThreads = new Map<string, LoopAskThread>();
  const askRuns = new Map<string, {
    owner?: ModalBinding;
    controller: AbortController;
    pendingTurnIds: Set<string>;
    startedTurnId?: string;
  }>();
  const continuingTaskIds = new Set<string>();
  let askSerial = 0;

  const syncAskThread = (
    task: LoopTaskRecord,
    thread: LoopAskThread,
    mode: "remember" | "publish" | "render",
  ): void => {
    if (!scopeValid()) return;
    const run = askRuns.get(task.id);
    thread = {
      ...thread,
      ...(run ? { running: true, queued: !run.startedTurnId } : {}),
      messages: thread.messages.map((message) => {
        const { queued: _queued, ...bubble } = message;
        return message.role === "user" && run?.pendingTurnIds.has(message.id)
          ? { ...bubble, queued: true }
          : bubble;
      }),
    };

    askThreads.set(task.id, thread);
    for (const binding of bindings.values()) {
      if (binding.taskId === task.id && validBinding(binding) && (!requestScope.getStore() || requestScope.getStore() === binding)) {
        binding.panel.publishDepartmentModalAskThread(binding, thread);
        if (mode === "render") binding.panel.setDepartmentModalState(binding, buildLoopGroupChatPanelState(deps.readTaskRecord(task.id) ?? task, deps), thread);
      }
    }
    try {
      deps.writeAskThread?.(task, thread);
    } catch {
      // Persistence is best-effort. The in-memory thread still drives the open panel.
    }
    const panel = deps.panelsByTaskId.get(task.id);
    if (!panel) {
      return;
    }
    panel.update(buildLoopGroupChatPanelState(deps.readTaskRecord(task.id) ?? task, deps));
    panel.setAskThread(thread);
    if (mode === "publish") {
      panel.publishAskThread();
      return;
    }
    if (mode === "render") {
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

  const warnRefreshFailure = () => deps.showWarningMessage("群聊刷新失败，请重试。");
  const refresh = async (taskId: string, { refreshDirector = false, refreshModals = true } = {}): Promise<void> => {
    if (!scopeValid()) return;
    const normalizedTaskId = deps.normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      return;
    }
    const panel = deps.panelsByTaskId.get(normalizedTaskId);
    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task || task.id !== normalizedTaskId) return;
    const root = task.department || task.departmentInvalid ? resolveDepartmentRoot(task, deps) : null;
    if ((task.department || task.departmentInvalid) && !root) {
      const known = panel?.getState();
      if (known) panel?.update({ ...known, error: "部门任务关联无效，请刷新任务记录后重试。",
        task: { ...known.task, canContinue: false, canStop: false, canSupplement: false } });
      for (const binding of [...bindings.values()]) {
        if (binding.taskId === task.id || binding.rootTaskId === task.id) {
          binding.panel.setDepartmentModalError(binding, "组长群聊关联已失效，请关闭后重试。");
          releaseBinding(binding);
        }
      }
      return;
    }
    const subscribers = refreshModals
      ? [...bindings.values()].filter((binding) => binding.taskId === task.id || binding.rootTaskId === task.id)
      : [];
    const refreshDirectorPanel = refreshDirector && root && root.id !== task.id && deps.panelsByTaskId.has(root.id);
    if (!panel && !subscribers.length && !refreshDirectorPanel) return;
    if (refreshDirectorPanel) void refresh(root.id, { refreshModals: false }).catch(warnRefreshFailure);
    if (panel && openingPanels.has(panel)) return;
    try {
      await deps.prepareModelSwitchOptions?.(task);
    } catch (error) {
      panel?.showLoadingError(error);
      if (panel?.getState()) deps.showWarningMessage(String(error));
      return;
    }
    if (!scopeValid()) return;
    const current = deps.readTaskRecord(task.id);
    if (!current || current.id !== task.id) return;
    if ((current.department || current.departmentInvalid) && !resolveDepartmentRoot(current, deps)) { await refresh(current.id); return; }
    if (panel && deps.panelsByTaskId.get(task.id) === panel) {
      panel.setAskThread(ensureAskThread(current));
      panel.update(buildLoopGroupChatPanelState(current, deps));
    }
    for (const binding of subscribers) {
      if (bindings.get(binding.rootTaskId) !== binding || (requestScope.getStore() && requestScope.getStore() !== binding)) continue;
      if (!validBinding(binding)) {
        binding.panel.setDepartmentModalError(binding, "组长群聊关联已失效，请关闭后重试。");
        releaseBinding(binding);
        continue;
      }
      const leader = deps.readTaskRecord(binding.taskId)!;
      binding.panel.setDepartmentModalState(binding, buildLoopGroupChatPanelState(leader, deps), ensureAskThread(leader));
    }
  };

  type ContinuationOptions = {
    resumeIdle?: boolean;
    resumeSubtasks?: boolean;
    panel?: LoopGroupChatPanel;
    requestId?: string;
    onTaskStarted?: () => void;
  };
  const runContinuation = async (taskId: string, prompt: unknown, options: ContinuationOptions): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    if (!normalizedTaskId) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.noTask"));
      return;
    }

    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      deps.logEvent?.("loop-group-chat-continue-rejected", { taskId: normalizedTaskId, requestId: options.requestId, reason: "task_missing" });
      deps.showWarningMessage(deps.t("loopGroupChatChat.taskMissing", { taskId: normalizedTaskId }));
      return;
    }
    deps.logEvent?.("loop-group-chat-continue-evaluated", {
      taskId: task.id,
      requestId: options.requestId,
      status: task.status,
      schedulingMode: task.schedulingMode,
      runningTask: deps.collectRunningTaskIds().has(task.id),
    });
    if (task.department || task.departmentInvalid) {
      const root = resolveDepartmentRoot(task, deps);
      if (!root) throw new Error("部门任务关联无效，无法继续。");
      if (root.id === task.id) {
        if (!deps.departmentOrganizationControl) throw new Error("部门组织控制尚未接入，无法继续产研部。");
        await continueDirector(root, typeof prompt === "string" ? prompt : undefined);
        return;
      }
      if (!deps.continueDepartmentLeader) throw new Error("组长继续入口不可用，请从总监继续产研部。");
      const assertCurrent = () => {
        if (!scopeValid()) throw obsoleteRequest;
        const current = deps.readTaskRecord(task.id);
        if (!current || resolveDepartmentRoot(current, deps)?.id !== root.id) throw obsoleteRequest;
      };
      assertCurrent();
      await deps.continueDepartmentLeader(task, deps.normalizeSupplementalRequirement(prompt) ?? "继续组长任务", assertCurrent);
      options.onTaskStarted?.();
      return;
    }
    const runningTaskIds = deps.collectRunningTaskIds();
    const controlState = resolveLoopTaskRunControlState(task, runningTaskIds);
    const availabilityTarget = deps.resolveMainPromptTarget(task, { createIfMissing: false });
    const isLoopPlus = resolveLoopSchedulingMode(task.schedulingMode) === "event_driven";
    const failureLimited = isLoopMainAiFailureLimitReached(task);
    const configLockRecovery = failureLimited && Boolean(options.panel) && canResumeLoopPlusConfigLockPause(task, deps);
    const activeSubtasksBlockContinuation = options.resumeSubtasks !== false && isLoopPlus
      && task.status === "running" && hasLoopPlusRunningSubtasks(task, "active");
    const canResumeIdle = task.status !== "completed"
      && (isLoopPlus || (options.resumeIdle && !runningTaskIds.has(task.id)))
      && (options.resumeSubtasks === false || task.status !== "running" || !hasLoopPlusRunningSubtasks(task, "active"))
      && !(availabilityTarget && deps.isTabRunActive(availabilityTarget.tabId));
    if (activeSubtasksBlockContinuation || (failureLimited ? !configLockRecovery : !controlState.canContinue && !canResumeIdle)) {
      deps.logEvent?.("loop-group-chat-continue-rejected", {
        taskId: task.id,
        requestId: options.requestId,
        reason: activeSubtasksBlockContinuation ? "active_subtasks" : failureLimited ? "failure_limit" : "control_state",
        taskStatus: task.status,
        isRunning: controlState.isRunning,
        canContinue: controlState.canContinue,
        canResumeIdle,
        failureLimited,
        configLockRecovery,
      });
      await refresh(normalizedTaskId);
      deps.showInformationMessage(
        controlState.isRunning
          ? deps.t("loopGroupChatChat.continueAlreadyRunning")
          : deps.t("loopGroupChatChat.continueUnavailable")
      );
      return;
    }

    const recoveryIdentity = configLockRecovery ? structuredClone(configLockResumeIdentity(task)) : null;
    const originalTabId = availabilityTarget?.tabId ?? undefined;
    const readRecoveryTask = (restoredTabId?: string): LoopTaskRecord | null => {
      const latest = deps.readConfigLockResumeTask
        ? task.taskStoreFile ? deps.readConfigLockResumeTask(normalizedTaskId, task.taskStoreFile) : null
        : deps.readTaskRecord(normalizedTaskId);
      if (!latest || deps.panelsByTaskId.get(normalizedTaskId) !== options.panel
        || options.panel?.getState()?.task.id !== normalizedTaskId
        || (restoredTabId && originalTabId && restoredTabId !== originalTabId)
        || !isDeepStrictEqual(configLockResumeIdentity(latest), recoveryIdentity)
        || !canResumeLoopPlusConfigLockPause(latest, deps, restoredTabId ?? originalTabId)) return null;
      return latest;
    };
    await deps.revealPanelView();
    const resumePrompt = normalizeLoopContinuePrompt(prompt, deps);
    const resumeSubtasks = (): boolean => {
      if (options.resumeSubtasks === false) return false;
      const resumeMain = () => {
        void continueTask(task.id, resumePrompt, undefined, { resumeIdle: true, resumeSubtasks: false });
      };
      if (deps.resumeLoopSubtasks?.(task.id, resumeMain) !== true) return false;
      if (isLoopPlus) deps.notifyLoopPlusUserMessage?.(task.id, resumePrompt);
      return true;
    };
    if (task.originProfile?.configId && task.modelRouting && deps.restoreOriginalLoopRuntime) {
      const original = configLockRecovery ? readRecoveryTask() : task;
      if (!original) {
        deps.showWarningMessage(deps.t("loopGroupChatChat.originalRuntimeUnavailable"));
        return;
      }
      const restored = await deps.restoreOriginalLoopRuntime(original, configLockRecovery ? { configLockRecovery: true, originalTabId } : undefined);
      if (!restored.ok || !restored.target?.tabId) {
        deps.logEvent?.("loop-group-chat-continue-rejected", { taskId: task.id, requestId: options.requestId, reason: "original_runtime_unavailable" });
        deps.showWarningMessage(restored.message || deps.t("loopGroupChatChat.originalRuntimeUnavailable"));
        return;
      }
      const recoveryBinding = restored.isOriginalTargetCurrent && restored.codexConfigEvidence
        ? { isTargetCurrent: restored.isOriginalTargetCurrent, codexConfigEvidence: restored.codexConfigEvidence }
        : undefined;
      if (configLockRecovery && !recoveryBinding) {
        deps.showWarningMessage(deps.t("loopGroupChatChat.originalRuntimeUnavailable"));
        return;
      }
      if (deps.isTabRunActive(restored.target.tabId)) {
        deps.logEvent?.("loop-group-chat-continue-rejected", { taskId: task.id, requestId: options.requestId, reason: "restored_tab_active" });
        deps.showInformationMessage(deps.t("loopGroupChatChat.continueAlreadyRunning"));
        return;
      }
      const resumeTask = configLockRecovery ? readRecoveryTask(restored.target.tabId) : task;
      if (!resumeTask?.originProfile || !resumeTask.modelRouting || (configLockRecovery && restored.target.cli !== resumeTask.cli)) {
        deps.logEvent?.("loop-group-chat-continue-rejected", { taskId: task.id, requestId: options.requestId, reason: "resume_routing_unavailable" });
        deps.showWarningMessage(deps.t("loopGroupChatChat.originalRuntimeUnavailable"));
        return;
      }
      if (!configLockRecovery && resumeSubtasks()) {
        deps.logEvent?.("loop-group-chat-continue-subtasks-resumed", { taskId: task.id, requestId: options.requestId, path: "original_runtime" });
        return;
      }
      if (!configLockRecovery) deps.logEvent?.("loop-group-chat-continue-subtasks-fallback", { taskId: task.id, requestId: options.requestId, path: "original_runtime" });
      const profile = resumeTask.originProfile;
      deps.logEvent?.("loop-group-chat-continue-dispatch", { taskId: task.id, requestId: options.requestId, path: "original_runtime", cli: restored.target.cli });
      await deps.runLoopPrompt(applyLoopModelRoutingToPrompt({
        displayPrompt: resumePrompt,
        modelPrompt: resumePrompt,
        contextTags: [],
        ...(resumeTask.loopSubtaskMode ? { loopSubtaskMode: resumeTask.loopSubtaskMode } : {}),
        ...(profile.mainThinkingMode ? { loopMainThinkingMode: profile.mainThinkingMode } : {}),
        ...(profile.subtaskThinkingMode ? { loopSubtaskThinkingMode: profile.subtaskThinkingMode } : {}),
        ...(profile.subtaskFrontendThinkingMode ? { loopSubtaskFrontendThinkingMode: profile.subtaskFrontendThinkingMode } : {}),
        ...(profile.subtaskFullstackThinkingMode ? { loopSubtaskFullstackThinkingMode: profile.subtaskFullstackThinkingMode } : {}),
        loopContinuePrompt: resumePrompt,
      }, resumeTask.modelRouting, profile), {
        targetTabId: restored.target.tabId,
        resumeTaskId: task.id,
        resumeRequested: true,
        onTaskStarted: options.onTaskStarted,
        ...(task.schedulingMode === "event_driven" ? { resumeUserMessage: resumePrompt } : {}),
        preserveLoopOrigin: true,
        ...(configLockRecovery && recoveryBinding ? { configLockRecovery: {
          readTask: () => readRecoveryTask(restored.target!.tabId!),
          ...recoveryBinding,
          unavailableMessage: deps.t("loopGroupChatChat.originalRuntimeUnavailable"),
        } } : {}),
        ...(task.schedulingMode === "event_driven" ? { schedulingMode: "event_driven" as const } : {}),
      });
      await refresh(normalizedTaskId);
      return;
    }

    const target = deps.resolveMainPromptTarget(task, { createIfMissing: true });
    if (!target) {
      deps.logEvent?.("loop-group-chat-continue-rejected", { taskId: task.id, requestId: options.requestId, reason: "main_prompt_target_unavailable" });
      deps.showWarningMessage(deps.t("loopGroupChatChat.continueUnavailable"));
      return;
    }

    await deps.switchVisibleConversationTabForLoop(target.tabId);
    if (deps.isTabRunActive(target.tabId)) {
      deps.logEvent?.("loop-group-chat-continue-rejected", { taskId: task.id, requestId: options.requestId, reason: "main_tab_active" });
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
      deps.logEvent?.("loop-group-chat-continue-rejected", { taskId: task.id, requestId: options.requestId, reason: "model_unavailable", cli: target.cli });
      deps.showWarningMessage(currentModels.unavailableReason);
      return;
    }
    if (resumeSubtasks()) {
      deps.logEvent?.("loop-group-chat-continue-subtasks-resumed", { taskId: task.id, requestId: options.requestId, path: "main_target" });
      return;
    }
    deps.logEvent?.("loop-group-chat-continue-subtasks-fallback", { taskId: task.id, requestId: options.requestId, path: "main_target" });
    deps.logEvent?.("loop-group-chat-continue-dispatch", { taskId: task.id, requestId: options.requestId, path: "main_target", cli: target.cli });
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
      onTaskStarted: options.onTaskStarted,
      ...(task.schedulingMode === "event_driven" ? { resumeUserMessage: resumePrompt } : {}),
      ...(task.schedulingMode === "event_driven" ? { schedulingMode: "event_driven" as const } : {}),
    });
    await refresh(normalizedTaskId);
  };

  const continueTask = async (taskId: string, prompt?: unknown, _legacySource?: unknown, options: ContinuationOptions = {}): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id)
      ?? taskId;
    if (continuingTaskIds.has(normalizedTaskId)) {
      deps.logEvent?.("loop-group-chat-continue-rejected", { taskId: normalizedTaskId, requestId: options.requestId, reason: "continuation_already_active" });
      if (options.requestId) postToPanel(normalizedTaskId, {
        type: "loopGroupChatChat:continueTaskSettled", requestId: options.requestId, canContinue: false,
      });
      return;
    }
    deps.logEvent?.("loop-group-chat-continue-started", { taskId: normalizedTaskId, requestId: options.requestId, source: "coordinator" });
    continuingTaskIds.add(normalizedTaskId);
    try {
      await runContinuation(normalizedTaskId, prompt, {
        ...options,
        ...(options.requestId ? { onTaskStarted: () => {
          deps.logEvent?.("loop-group-chat-continue-task-started", { taskId: normalizedTaskId, requestId: options.requestId });
          postToPanel(normalizedTaskId, { type: "loopGroupChatChat:continueTaskStarted", requestId: options.requestId });
          void refresh(normalizedTaskId).catch(warnRefreshFailure);
        } } : {}),
      });
    } catch (error) {
      deps.logEvent?.("loop-group-chat-continue-failed", { taskId: normalizedTaskId, requestId: options.requestId, errorName: error instanceof Error ? error.name : "UnknownError" });
      if (error !== obsoleteRequest) deps.showWarningMessage(error instanceof Error ? error.message : String(error));
    } finally {
      continuingTaskIds.delete(normalizedTaskId);
      try {
        await refresh(normalizedTaskId);
      } finally {
        const task = deps.readTaskRecord(normalizedTaskId);
        deps.logEvent?.("loop-group-chat-continue-settled", {
          taskId: normalizedTaskId,
          requestId: options.requestId,
          taskStatus: task?.status ?? "missing",
          canContinue: task ? canContinueLoopTaskWithDeps(task, deps) : false,
        });
        postToPanel(normalizedTaskId, {
          type: "loopGroupChatChat:continueTaskSettled",
          ...(options.requestId ? { requestId: options.requestId } : {}),
          canContinue: task ? canContinueLoopTaskWithDeps(task, deps) : false,
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
      if ((task.department || task.departmentInvalid) && !resolveDepartmentRoot(task, deps)) throw new Error("部门任务关联无效，无法切换模型。");
      await deps.prepareModelSwitchOptions?.(task);
      if (!scopeValid()) return;
      task = deps.readTaskRecord(taskId);
      if (!task) {
        throw new Error(deps.t("loopGroupChatChat.taskMissing", { taskId }));
      }
      if ((task.department || task.departmentInvalid) && !resolveDepartmentRoot(task, deps)) throw new Error("部门任务关联无效，无法切换模型。");
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
      if (departmentMetadata(updated)?.role === "director") {
        postToPanel(taskId, { type: "loopGroupChatChat:switchModelsSettled", ok: true });
        return;
      }
      const owner = requestScope.getStore();
      const resumeMain = () => {
        if (owner) {
          if (validBinding(owner)) requestScope.run(owner, () => { void continueTask(taskId, undefined, undefined, { resumeIdle: true, resumeSubtasks: false }); });
        } else void continueTask(taskId, undefined, undefined, { resumeIdle: true, resumeSubtasks: false });
      };
      const handled = deps.resumeLoopSubtasks?.(taskId, resumeMain);
      postToPanel(taskId, { type: "loopGroupChatChat:switchModelsSettled", ok: true });
      if (handled === false || (handled !== true && resolveLoopTaskRunControlState(updated, deps.collectRunningTaskIds()).canContinue)) {
        resumeMain();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      postToPanel(taskId, { type: "loopGroupChatChat:switchModelsSettled", ok: false, error: message });
      if (error !== obsoleteRequest) deps.showWarningMessage(message);
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
    deps.recordPromptHistory(supplementalRequirement, task.cli);
    if (resolveLoopSchedulingMode(task.schedulingMode) === "event_driven") {
      deps.notifyLoopPlusUserMessage?.(task.id, supplementalRequirement);
    } else if (task.status === "running") {
      deps.wakeClassicLoop?.(task.id);
    }
    await deps.postPanelState();
    await refresh(normalizedTaskId);
  };

  const askMainModel = async (taskId: string, prompt?: unknown, requestId?: string): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId)
      ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
    const rejectSubmission = (error: string): void => {
      if (requestId) postToPanel(normalizedTaskId ?? taskId, {
        type: "loopGroupChatChat:askSubmissionRejected", requestId, error,
      });
    };
    if (!normalizedTaskId) {
      const error = deps.t("loopGroupChatChat.noTask");
      rejectSubmission(error);
      deps.showInformationMessage(error);
      return;
    }
    const task = deps.readTaskRecord(normalizedTaskId);
    if (!task) {
      const error = deps.t("loopGroupChatChat.taskMissing", { taskId: normalizedTaskId });
      rejectSubmission(error);
      deps.showWarningMessage(error);
      return;
    }
    const question = deps.normalizeSupplementalRequirement(prompt);
    const current = ensureAskThread(task);
    if (!question || !deps.askMainModel) {
      const error = deps.t("loopGroupChatChat.askUnavailable");
      if (requestId) {
        rejectSubmission(error);
        return;
      }
      if (!deps.panelsByTaskId.get(task.id) && !requestScope.getStore()) {
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
    const turnId = requestId ?? `ask-${Date.now().toString(36)}-${askSerial += 1}`;
    const existingRun = askRuns.get(task.id);
    if (existingRun && existingRun.owner !== requestScope.getStore()) {
      const error = "该组长已有其他窗口提问正在处理，请稍后重试。";
      rejectSubmission(error);
      if (!requestId) deps.showInformationMessage(error);
      return;
    }
    if (current.messages.some((message) => message.id === turnId)) {
      syncAskThread(task, current, "publish");
      return;
    }
    const run = existingRun ?? { owner: requestScope.getStore(), controller: new AbortController(), pendingTurnIds: new Set<string>() };
    run.pendingTurnIds.add(turnId);
    askRuns.set(task.id, run);
    syncAskThread(task, beginLoopAskTurn(current, question, Date.now(), turnId), "publish");

    const isAborted = () => askRuns.get(task.id) !== run || Boolean(run.owner && !validBinding(run.owner));
    let result: LoopMainModelAnswerResult;
    try {
      result = await deps.askMainModel(task, question, {
        isAborted,
        signal: run.controller.signal,
        onStarted: () => {
          if (isAborted() || !run.pendingTurnIds.delete(turnId)) return;
          run.startedTurnId = turnId;
          const publish = () => syncAskThread(task, ensureAskThread(task), "publish");
          if (run.owner) requestScope.run(run.owner, publish);
          else requestScope.exit(publish);
        },
      });
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() ? error.message.trim() : String(error);
      result = { status: "error", error: deps.t("loopGroupChatChat.askFailed", { detail }) };
    }
    if (isAborted()) return;
    run.pendingTurnIds.delete(turnId);
    if (run.startedTurnId === turnId) run.startedTurnId = undefined;
    if (!run.startedTurnId && run.pendingTurnIds.size === 0) {
      askRuns.delete(task.id);
    }
    syncAskThread(task, settleLoopAskTurn(ensureAskThread(task), {
      ...(result.status === "ready" ? { answer: result.answer } : {}),
      notice: result.status === "stopped"
        ? deps.t("loopGroupChatChat.askStopped")
        : result.status === "error" ? result.error : deps.t("loopGroupChatChat.askEmpty"),
      now: Date.now(),
      noticeId: `${turnId}:result`,
    }), "render");
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

    if (task.department || task.departmentInvalid) {
      const root = resolveDepartmentRoot(task, deps);
      if (!root) throw new Error("部门任务关联无效，无法停止。");
      if (root.id === task.id) {
        if (!deps.departmentOrganizationControl) throw new Error("部门组织控制尚未接入，无法停止产研部。");
        const trusted = originalDeps.readDepartmentOrganizationControlState?.(root);
        if (originalDeps.readDepartmentOrganizationControlState && !trusted) return;
        const identity = stopIdentity(root);
        const previous = organizationStops.get(root.id);
        if ((previous?.identity === identity && previous.state === "stopping")
          || trusted?.stopState === "stopping") return;
        const state = buildLoopGroupChatPanelState(root, deps);
        if (!state.task.canStop) { await refresh(root.id); return; }
        const request = { identity, state: "stopping" as DepartmentOrganizationStopState };
        organizationStops.set(root.id, request);
        const refreshStop = async () => {
          try {
            const current = deps.readTaskRecord(root.id);
            if (!current || stopIdentity(current) !== identity || !resolveDepartmentRoot(current, deps)) return;
            if (originalDeps.readDepartmentOrganizationControlState && !originalDeps.readDepartmentOrganizationControlState(current)) return;
            await refresh(root.id);
          } catch { deps.showWarningMessage("群聊刷新失败，请重试。"); }
        };
        // Publish immediately; refresh failure never changes the stop outcome.
        const startedRefresh = refreshStop();
        try {
          const current = deps.readTaskRecord(root.id);
          if (!current || stopIdentity(current) !== identity || !resolveDepartmentRoot(current, deps)
            || (originalDeps.readDepartmentOrganizationControlState && !originalDeps.readDepartmentOrganizationControlState(current))) throw new Error("部门停止归属已变化。");
          await deps.departmentOrganizationControl.stop(current);
          if (organizationStops.get(root.id) === request) request.state = "confirmed";
        } catch (error) {
          if (organizationStops.get(root.id) === request) request.state = "unconfirmed";
          throw error;
        } finally {
          await startedRefresh;
          await refreshStop();
        }
        return;
      }
    }
    if (!canStopLoopTaskWithRunningTaskIds(task, deps.collectRunningTaskIds())) {
      await refresh(normalizedTaskId);
      deps.showInformationMessage(deps.t("loopGroupChatChat.stopUnavailable"));
      return;
    }

    try {
      deps.stopRunsForTask(task.id);
    } finally {
      deps.markTaskStoppedByUser(task.id, "group-chat");
    }
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
    if ((task.department || task.departmentInvalid) && !resolveDepartmentRoot(task, deps)) {
      throw new Error("部门任务关联无效，无法提交澄清。");
    }
    const departmentAtSubmit = departmentMetadata(task);
    const normalized = normalizeClarificationSubmission(request, values);
    if (!normalized.ok) {
      deps.showWarningMessage(clarificationIssueMessage(normalized.issue));
      await refresh(task.id);
      return;
    }
    let deliverToWaiter = true;
    if (departmentAtSubmit?.role === "director") {
      try { readContinuableDirector(task); } catch { deliverToWaiter = false; }
    }
    if (deliverToWaiter) {
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
    }
    const answer = formatOrchestratorClarificationAnswer({
      interactionId: safeInteractionId,
      status: "completed",
      values: normalized.values,
    }, request.formFields);
    const nextRequirements = deps.appendSupplementalRequirement(task.supplementalRequirements, answer);
    const saved = deps.updateTaskRecord(task.id, {
      supplementalRequirements: nextRequirements,
      pendingClarification: undefined,
      updatedAt: Date.now(),
    });
    if (departmentAtSubmit && (!saved || saved.id !== task.id)) throw new Error("部门澄清保存失败，无法继续产研部，请重试。");
    deps.appendSupplementalRequirementToCommunication(task, answer);
    try {
      const chatFile = buildLoopMainSubChatTranscriptFile(task.communicationDir);
      fs.mkdirSync(path.dirname(chatFile), { recursive: true });
      fs.appendFileSync(chatFile, `\n## 用户补充澄清\n${answer}\n`, "utf8");
    } catch {
      // The supplemental requirement is already persisted for the next main turn.
    }
    if (departmentAtSubmit) {
      // Answers are persisted first. Resume only from a fresh, still-related record.
      const current = deps.readTaskRecord(task.id);
      const root = current && current.id === task.id ? resolveDepartmentRoot(current, deps) : null;
      if (!root || departmentMetadata(current!)?.role !== departmentAtSubmit.role
        || root.id !== departmentAtSubmit.rootTaskId) throw new Error("部门任务关联无效，无法恢复澄清。");
      if (root.id === task.id) {
        if (!deps.departmentOrganizationControl) throw new Error("部门组织控制尚未接入，澄清已保存，无法继续产研部。");
        await continueDirector(root);
        await refresh(root.id);
        return;
      }
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
    if ((task.department || task.departmentInvalid) && !resolveDepartmentRoot(task, deps)) {
      throw new Error("部门任务关联无效，无法拒绝澄清。");
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

  const allocationRequests = new Map<string, { panel: LoopGroupChatPanel; requestId: string }>();
  const allocationRequestIds = new WeakMap<LoopGroupChatPanel, Set<string>>();
  const updateDepartmentEmployeeLimit = async (taskId: string, request: DepartmentEmployeeLimitRequest): Promise<void> => {
    // This message is deliberately absent from both iframe forwarding allowlists.
    if (requestScope.getStore()) return;
    const panel = deps.panelsByTaskId.get(taskId);
    if (!panel || typeof request.requestId !== "string" || !request.requestId.trim() || request.requestId.length > 160) return;
    const reply = (result: object) => panel.post({ type: "loopGroupChatChat:departmentEmployeeLimitSettled",
      rootTaskId: taskId, leaderTaskId: request.leaderTaskId, requestId: request.requestId, ...result });
    const authorize = () => {
      const root = deps.readTaskRecord(taskId), leader = typeof request.leaderTaskId === "string" ? deps.readTaskRecord(request.leaderTaskId) : null;
      const state = panel.getState();
      if (deps.panelsByTaskId.get(taskId) !== panel || state?.task.id !== taskId || state.department?.role !== "director"
        || state.department.rootTaskId !== taskId || !root || root.id !== taskId || !root.workspaceKey
        || resolveDepartmentRoot(root, deps)?.id !== taskId || departmentMetadata(root)?.role !== "director"
        || !leader || leader.id !== request.leaderTaskId
        || !authorizeDepartmentLeader(root, leader, deps, deps.readDepartmentLeaderTaskIds)) return null;
      return root;
    };
    const root = authorize();
    if (!root) { reply({ ok: false, error: "仅当前产研部总监可调整本部门有效组长额度。" }); return; }
    const workspaceKey = root.workspaceKey;
    const key = JSON.stringify([taskId, request.leaderTaskId]);
    const seen = allocationRequestIds.get(panel) ?? new Set<string>();
    // Another group's save can advance the shared revision while this writer is awaiting.
    // A duplicate must not settle the original request early with a stale-version error.
    if (allocationRequests.get(key)?.panel === panel || seen.has(request.requestId)) return;
    if (!deps.updateDepartmentEmployeeLimit || !deps.readDepartmentEmployeeAllocation) {
      reply({ ok: false, error: "额度服务不可用，暂不可编辑。" }); return;
    }
    const projection = buildLoopGroupChatPanelState(root, deps).department;
    const snapshot = projection?.employeeAllocation;
    if (!snapshot || !snapshot.leaders.some((row) => row.leaderTaskId === request.leaderTaskId)) {
      reply({ ok: false, error: "员工额度未知，请刷新后重试。" }); return;
    }
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0
      || request.expectedRevision >= Number.MAX_SAFE_INTEGER || request.expectedRevision !== snapshot.revision
      || (request.employeeLimit !== null && (!Number.isSafeInteger(request.employeeLimit)
        || request.employeeLimit < 0 || request.employeeLimit > projection!.maxEmployees))) {
      reply({ ok: false, error: "额度或版本无效，请刷新后输入有效整数重试。" }); return;
    }
    allocationRequestIds.set(panel, seen);
    seen.add(request.requestId);
    const token = { panel, requestId: request.requestId };
    allocationRequests.set(key, token);
    const current = () => allocationRequests.get(key) === token && authorize()?.workspaceKey === workspaceKey;
    try {
      // Copy exact validated fields; extra browser properties cannot become authority.
      const result = await deps.updateDepartmentEmployeeLimit(root, { requestId: request.requestId, leaderTaskId: request.leaderTaskId,
        employeeLimit: request.employeeLimit, expectedRevision: request.expectedRevision });
      if (!current()) return;
      if (!result.ok) { reply({ ok: false, error: result.error || "保存失败，请重试。" }); return; }
      const latest = buildLoopGroupChatPanelState(deps.readTaskRecord(taskId)!, deps);
      const department = latest.department;
      const confirmed = department && normalizeDepartmentEmployeeAllocation(result.allocation, taskId,
        department.leaders.map((leader) => leader.taskId), department.maxEmployees);
      const row = confirmed?.leaders.find((item) => item.leaderTaskId === request.leaderTaskId);
      if (!confirmed || !row || confirmed.revision < request.expectedRevision
        || (department?.employeeAllocation && department.employeeAllocation.revision > confirmed.revision)
        || (request.employeeLimit === null ? row.source !== "default" : row.source !== "manual" || row.desiredLimit !== request.employeeLimit)) {
        reply({ ok: false, error: "宿主确认额度或版本无效，请刷新后重试。" }); return;
      }
      if (!current()) return;
      // Install only a durable host confirmation, never an optimistic browser value.
      panel.update({ ...latest, department: { ...department!, employeeAllocation: confirmed } });
      reply({ ok: true, revision: confirmed.revision, desiredLimit: row.desiredLimit });
    } catch (error) {
      if (current()) reply({ ok: false, error: error instanceof Error ? error.message : "保存失败，请重试。" });
    } finally { if (allocationRequests.get(key) === token) allocationRequests.delete(key); }
  };

  const openSubtaskConversation = async (taskId: string, requestedSubtaskId: unknown): Promise<void> => {
    const normalizedTaskId = deps.normalizeTaskId(taskId);
    const subtaskId = normalizeLoopSubtaskId(requestedSubtaskId);
    const task = normalizedTaskId ? deps.readTaskRecord(normalizedTaskId) : null;
    if (!task || !subtaskId || !task.subTasks.some((subtask) => subtask.id === subtaskId)) return;
    try {
      const tabId = deps.resolveSubtaskConversationTabId?.(task, subtaskId);
      if (!tabId || !deps.isTabRunActive(tabId)) {
        deps.showInformationMessage("该子任务当前没有运行中的对话标签页，请刷新群聊后重试。");
        return;
      }
      await deps.revealPanelView();
      if (!deps.isTabRunActive(tabId)) {
        deps.showInformationMessage("该子任务已结束，请刷新群聊查看最新状态。");
        return;
      }
      await deps.switchVisibleConversationTabForLoop(tabId);
    } catch (error) {
      deps.showWarningMessage(`打开子任务对话失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMessage = async (taskId: string, message: LoopGroupChatPanelMessage, sourcePanel?: LoopGroupChatPanel): Promise<void> => {
    if (!message || typeof message.type !== "string") {
      return;
    }
    if (message.type === "loopGroupChatChat:updateDepartmentEmployeeLimit") {
      await updateDepartmentEmployeeLimit(taskId, message); return;
    }
    if (message.type === "loopGroupChatChat:departmentModal") {
      const panel = deps.panelsByTaskId.get(taskId);
      if (!panel || typeof message.taskId !== "string" || typeof message.instanceId !== "string" || !message.instanceId || message.instanceId.length > 160) return;
      const previous = bindings.get(taskId);
      if (message.action === "close") {
        if (previous?.taskId === message.taskId && previous.instanceId === message.instanceId) releaseBinding(previous);
        return;
      }
      if (message.action !== "load" && message.action !== "retry") return;
      if (previous) releaseBinding(previous);
      const binding: ModalBinding = { rootTaskId: taskId, taskId: message.taskId, instanceId: message.instanceId, panel };
      bindings.set(taskId, binding);
      if (!validBinding(binding)) {
        bindings.delete(taskId);
        panel.setDepartmentModalError(binding, "无法打开组长群聊：任务不属于当前产研部或关联无效。");
        return;
      }
      await requestScope.run(binding, async () => {
        try { await refresh(binding.taskId); }
        catch { if (validBinding(binding)) panel.setDepartmentModalError(binding, "组长群聊加载失败，请重试。"); }
      });
      return;
    }
    if (message.type === "loopGroupChatChat:departmentTaskMessage") {
      const binding = bindings.get(taskId);
      if (!binding || binding.taskId !== message.taskId || binding.instanceId !== message.instanceId || !validBinding(binding)
        || !message.message || !DEPARTMENT_GROUP_CHAT_TASK_MESSAGE_TYPES.has(message.message.type)) return;
      // Nested taskId, rootTaskId and instanceId are never consulted by action handlers.
      await requestScope.run(binding, async () => {
        try { await handleMessage(binding.taskId, message.message); }
        catch (error) { if (error !== obsoleteRequest && validBinding(binding)) deps.showWarningMessage(error instanceof Error ? error.message : String(error)); }
      });
      return;
    }
    if (message.type === "loopGroupChatChat:openDepartmentTask") {
      // Browser already opened the in-page container. Only a bound validated load may populate it.
      const binding = bindings.get(taskId);
      if (binding && message.taskId === binding.taskId && validBinding(binding)) return;
      // A standalone leader's return button reveals its verified director page.
      const task = deps.readTaskRecord(taskId);
      const root = task && resolveDepartmentRoot(task, deps);
      if (task && root && root.id !== task.id && message.taskId === root.id) await open(root.id);
      return;
    }
    if (requestScope.getStore() && (isChatImageMessage(message) || isChatLinkMessage(message))) {
      const task = deps.readTaskRecord(taskId);
      if (!task || !scopeValid()) return;
      const source = isChatImageMessage(message) ? normalizeChatImageSource(message.source) : normalizeChatLinkSource(message.source);
      if (!source) return;
      if (!/^https?:|^data:/i.test(source)) {
        // Local media/link access uses the same task-scoped roots and canonical
        // path containment as communication previews, including symlink checks.
        let allowed = false;
        try {
          const file = fs.realpathSync(resolveChatLocalLink(source, task.communicationDir).path);
          allowed = collectLoopCommunicationPreviewRoots(task).some((root) => {
            try {
              const relative = path.relative(fs.realpathSync(root), file);
              return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
            } catch { return false; }
          });
        } catch { /* Missing/invalid local resource is refused. */ }
        if (!allowed) {
          postToPanel(taskId, { type: "chatImageResolved", source: message.source, error: "文件不在当前组长的许可目录内。" });
          return;
        }
      }
      const binding = requestScope.getStore()!;
      const isCurrent = () => validBinding(binding);
      const responseWebview: Pick<vscode.Webview, "postMessage"> = { postMessage: (response: unknown) => {
        if (!isCurrent()) return Promise.resolve(false);
        binding.panel.postDepartmentModalMessage(binding, response as { type: string; [key: string]: unknown });
        return Promise.resolve(true);
      } };
      const context = { isCurrent, get baseDirectory() { return deps.readTaskRecord(binding.taskId)?.communicationDir ?? task.communicationDir; } };
      const images = binding.images ??= new ChatImageHost(() => isCurrent() ? responseWebview : undefined, context);
      if (isChatImageMessage(message)) await images.handleMessage(message);
      else await openChatLink(message.source, (value) => images.handleMessage({ type: "previewChatImage", source: value }), context);
      return;
    }
    const record = deps.readTaskRecord(taskId);
    if (record?.department || record?.departmentInvalid) {
      if (!resolveDepartmentRoot(record, deps)) {
        deps.showWarningMessage("部门任务关联无效，操作已拒绝。");
        return;
      }
      if (["saveLoopPlusAcceptancePlan", "selectLoopPlusAcceptancePlan", "deleteLoopPlusAcceptancePlan", "loopGroupChatChat:updateAcceptancePlan"].includes(message.type)) {
        postToPanel(taskId, { type: "loopGroupChatChat:acceptancePlanUpdated", error: "运行中的产研部统一验收方案只读，组长不可覆盖。" });
        deps.showWarningMessage("产研部统一验收方案只读，不能从群聊覆盖。");
        return;
      }
    }
    if (message.type === "loopGroupChatChat:refresh") {
      await refresh(taskId);
      return;
    }
    if (message.type === "loopGroupChatChat:openSubtaskConversation") {
      await openSubtaskConversation(taskId, message.subtaskId);
      return;
    }
    if (message.type === "loopGroupChatChat:cancelSubtask") {
      const task = deps.readTaskRecord(taskId);
      const subtaskId = typeof message.subtaskId === "string" ? message.subtaskId : "";
      if (!task || task.department || task.departmentInvalid || task.schedulingMode === "event_driven"
        || !(deps.getActiveSubtaskIds?.(task) ?? []).includes(subtaskId)
        || !task.subTasks.some((item) => item.id === subtaskId && ["running", "blocked"].includes(item.status))) return;
      if (!await deps.cancelClassicSubtask?.(taskId, subtaskId)) {
        deps.showInformationMessage("该子任务当前无法取消，请刷新群聊后重试。");
      }
      await refresh(taskId);
      return;
    }
    if (message.type === "loopGroupChatChat:continueTask") {
      deps.logEvent?.("loop-group-chat-continue-received", { taskId, requestId: message.requestId, panelMatchesTask: deps.panelsByTaskId.get(taskId) === sourcePanel });
      const panel = !requestScope.getStore() && deps.panelsByTaskId.get(taskId) === sourcePanel ? sourcePanel : undefined;
      await continueTask(taskId, message.prompt, undefined, {
        panel: panel?.getState()?.task.id === taskId ? panel : undefined,
        requestId: message.requestId,
      });
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
      const requestId = typeof message.requestId === "string" && /^ask-client-[a-z0-9-]{1,80}$/u.test(message.requestId)
        ? message.requestId : undefined;
      await askMainModel(taskId, message.prompt, requestId);
      return;
    }
    if (message.type === "loopGroupChatChat:abortMainModelQuestion") {
      const normalizedTaskId = deps.normalizeTaskId(taskId)
        ?? deps.normalizeTaskId(deps.panelsByTaskId.get(taskId)?.getState()?.task.id);
      const run = normalizedTaskId ? askRuns.get(normalizedTaskId) : undefined;
      if (!normalizedTaskId || !run || run.owner !== requestScope.getStore()) return;
      askRuns.delete(normalizedTaskId);
      run.controller.abort();
      const task = deps.readTaskRecord(normalizedTaskId);
      if (task) {
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
    if (!scopeValid()) return;
    const scoped = requestScope.getStore();
    if (scoped) {
      if (scoped.taskId === taskId) scoped.panel.postDepartmentModalMessage(scoped, message as { type: string; [key: string]: unknown });
      return;
    }
    deps.panelsByTaskId.get(taskId)?.post(message);
    for (const binding of bindings.values()) {
      if (binding.taskId === taskId && validBinding(binding)) binding.panel.postDepartmentModalMessage(binding, message as { type: string; [key: string]: unknown });
    }
  };

  const releaseBinding = (binding: ModalBinding): void => {
    if (bindings.get(binding.rootTaskId) !== binding) return;
    bindings.delete(binding.rootTaskId);
    binding.images?.dispose();
    binding.images = undefined;
    // Cancel this display's pending question subscription; never stop the task.
    const run = askRuns.get(binding.taskId);
    if (run?.owner === binding) askRuns.delete(binding.taskId);
    const thread = askThreads.get(binding.taskId);
    if (run?.owner === binding && thread?.running) askThreads.set(binding.taskId, settleLoopAskTurn(thread, { now: Date.now(), noticeId: `modal-closed-${askSerial += 1}` }));
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
    const binding = requestScope.getStore();
    const safeRequestId = typeof requestId === "string" ? requestId.trim() : "";
    if ((!panel && !binding) || !scopeValid() || !normalizedTaskId || !safeRequestId || safeRequestId.length > 80) {
      return;
    }
    const task = deps.readTaskRecord(normalizedTaskId);
    const preview = task
      ? readLoopCommunicationFilePreview(requestedPath, collectLoopCommunicationPreviewRoots(task))
      : { ok: false as const, path: typeof requestedPath === "string" ? requestedPath : "", error: "missing" as const };
    postToPanel(normalizedTaskId, {
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

  const open = async (arg?: unknown, options: { focus?: boolean } = {}): Promise<void> => {
    const task = await resolveTask(arg);
    if (!task) {
      deps.showInformationMessage(deps.t("loopGroupChatChat.noTask"));
      return;
    }
    if ((task.department || task.departmentInvalid) && !resolveDepartmentRoot(task, deps)) {
      deps.showWarningMessage("部门任务关联无效，无法打开群聊。");
      return;
    }
    let panel = deps.panelsByTaskId.get(task.id);
    if (!panel) {
      const taskId = task.id;
      panel = new LoopGroupChatPanel(deps.getExtensionUri(), {
        onMessage: (message) => {
          void handleMessage(taskId, message, panel).catch((error) => { if (error !== obsoleteRequest) deps.showWarningMessage(error instanceof Error ? error.message : String(error)); });
        },
        onDispose: () => {
          for (const [key, token] of allocationRequests) if (token.panel === panel) allocationRequests.delete(key);
          const binding = bindings.get(taskId);
          if (binding) releaseBinding(binding);
          const currentPanel = deps.panelsByTaskId.get(taskId);
          if (currentPanel === panel) {
            deps.panelsByTaskId.delete(taskId);
          }
        },
      });
      deps.panelsByTaskId.set(task.id, panel);
    }
    const targetPanel = panel;
    const ready = targetPanel.showLoading(
      task.id,
      resolveLoopSchedulingMode(task.schedulingMode) === "event_driven",
      options.focus !== true,
    );
    const pending = openingPanels.get(targetPanel);
    if (pending) return pending;
    const loading = (async () => {
      if (!await ready || deps.panelsByTaskId.get(task.id) !== targetPanel) return;
      try {
        await deps.prepareModelSwitchOptions?.(task);
        if (deps.panelsByTaskId.get(task.id) !== targetPanel) return;
        const latestTask = deps.readTaskRecord(task.id);
        if (!latestTask || latestTask.id !== task.id
          || ((latestTask.department || latestTask.departmentInvalid) && !resolveDepartmentRoot(latestTask, deps))) return;
        targetPanel.setAskThread(ensureAskThread(latestTask));
        targetPanel.show(buildLoopGroupChatPanelState(latestTask, deps));
      } catch (error) {
        if (deps.panelsByTaskId.get(task.id) === targetPanel) {
          targetPanel.showLoadingError(error);
          if (targetPanel.getState()) deps.showWarningMessage(String(error));
        }
      }
    })();
    openingPanels.set(targetPanel, loading);
    try {
      await loading;
    } finally {
      if (openingPanels.get(targetPanel) === loading) openingPanels.delete(targetPanel);
    }
  };

  const refreshOpenPanelForTask = (taskId: string): void => {
    if (!deps.panelsByTaskId.has(taskId) && ![...bindings.values()].some((binding) => binding.taskId === taskId || binding.rootTaskId === taskId)
      && ![...deps.panelsByTaskId.values()].some((panel) => panel.getState()?.department?.role === "director")) return;
    void refresh(taskId, { refreshDirector: true }).catch(warnRefreshFailure);
  };

  const buildMessageAction = (taskId: string, round?: number): ChatMessageAction => {
    return buildLoopGroupChatMessageAction(taskId);
  };

  const completeDepartment = async (rootTaskId: string): Promise<void> => {
    const task = deps.readTaskRecord(rootTaskId);
    const root = task && resolveDepartmentRoot(task, deps);
    if (!root || root.id !== rootTaskId) throw new Error("部门根任务关联无效，无法完成。");
    if (!deps.departmentOrganizationControl) throw new Error("部门组织控制尚未接入，无法完成产研部。");
    await deps.departmentOrganizationControl.complete(root);
    await refresh(root.id);
  };

  return {
    open,
    completeDepartment,
    handleMessage,

    continueTask,
    switchModels,
    refresh,
    refreshOpenPanelForTask,
    buildMessageAction,
    listGroupChatTasks: () => listLoopGroupChatTasks(deps),
  };
}
