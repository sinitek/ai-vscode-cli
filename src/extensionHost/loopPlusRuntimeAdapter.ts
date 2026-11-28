import type { LoopSubtaskCleanupResult } from "../loopSubtaskExecutionRoot";
import { randomUUID } from "crypto";
import { bindLoopSubtaskSession, resolveLoopSubtaskSession, withLoopSubtaskSession } from "../loopSubtaskSession";
import { LOOP_WAIT_WATCHDOG_TICK_MS, waitForLoopInvocation } from "../loopWaitWatchdog";
import { describeLoopSubtaskError } from "../loopSubtaskFailure";
import { getErrorInfo } from "../promptRetry";
import type { ThinkingMode } from "../cli/types";
import { createPerformanceTrace } from "../performanceLog";
import { applyLoopModelRoutingToPrompt, applyLoopPromptThinkingToOriginProfile } from "../loopModelSwitch";
import { loopModelRoutingFromPromptInput } from "../continueModelChoice";
import { retryLoopSubtaskTabClose } from "./loopSubtaskTabs";
import type { ChatMessage } from "../webview/types";
import type { LoopTaskRole, TaskRunRecord, TaskRunStatus } from "../promptRunState";
import type { LoopTaskRecord, LoopTaskStoreReadOptions } from "../loopTaskStore";
import { loopPlusMainFailure } from "../loopMainFailure";
import { withLoopPlusMainAdmission } from "./loopPlusMainAdmission";
import type { LoopSubtaskTabCloseOptions } from "../loopSubtaskLifecycle";
import { buildDepartmentRolePrompt } from "../departmentprompts";
import { activePromptRuleDelivery } from "../promptRuleIndex";
import type { DepartmentMetadata } from "../department";
import type { DepartmentEmployeeCapacity } from "../departmentcapacity";
import { isDepartmentExecutionCli, normalizeDepartmentMetadata, usesDepartmentOwner } from "../department";
import type { LoopPlusFinalAssistantHandoff, PromptRunInput, PromptRunTarget } from "../promptRunTypes";
import { FirstLoopMainExecution } from "./promptRunHandoff";
import type { ConfigLockResumeRequest } from "./loopGroupChatPanelCoordinator";
import { CodexUnexpectedTurnExitError } from "../interactive/codexRunner";
import { logError } from "../logger";
import {
  createLoopPlusOrchestrationHost,
  type LoopPlusAttemptHandle,
  type LoopPlusAttemptRequest,
  type LoopPlusAttemptResult,
  type LoopPlusMainHandle,
  type LoopPlusMainRequest,
  type LoopPlusOrchestrationDeps,
  type LoopPlusPromptTarget,
  type LoopPlusRunInput,
  type LoopPlusRunOptions,
  resolveLoopPlusEntry,
} from "./loopPlusOrchestration";
import {
  loopPlusResumeRefusal,
  mergeLoopPlusResumeContinueInstruction,
  resolveLoopPlusAttemptOutcome,
  resolveLoopPlusPromptRoleBinding,
  shouldBindLoopPlusResumeTarget,
  withLoopPlusExecutionRoot,
  type LoopPlusPromptRoleBinding,
} from "./promptRunRuntime";

export type LoopPlusInvocationBoundary = {
  messageIds: ReadonlySet<string>;
  runIds: ReadonlySet<string>;
  startedAt: number;
};

export type LoopPlusInvocationQuery = {
  taskId: string;
  round: number;
  role: LoopTaskRole;
  subtaskId?: string;
  displayPrompt: string;
  attemptId?: string;
};

export type LoopPlusAttemptExecutionLease = {
  release(): void;
  /** Quarantine retained occupancy when execution termination or required cleanup cannot be proved. */
  cleanupFailed?(error: unknown): void;
};

export type LoopPlusRuntimeAdapterDeps = {
  createPerformanceTrace?: typeof createPerformanceTrace;
  /** Live, read-only department balance supplied by the trusted host. */
  getDepartmentEmployeeCapacity?: (rootTaskId: string, leaderTaskId: string) => DepartmentEmployeeCapacity | null;
  /**
   * 所有子任务角色的执行准入，主审不调用。必须响应 signal 取消等待。
   * 租约由适配器在执行和目录清理结束后释放；null 表示未获准并停止。
   * 即使取消后迟到返回租约，适配器也会释放，且不会启动执行。
   */
  acquireAttemptExecution?: (
    request: LoopPlusAttemptRequest,
    signal: AbortSignal,
  ) => Promise<LoopPlusAttemptExecutionLease | null>;
  maxConcurrency?: number;
  getActiveConfigIdForCli?: (cli: LoopPlusPromptTarget["cli"]) => string | null;
  launchDelayMs?: LoopPlusOrchestrationDeps["launchDelayMs"];
  loadedExtensionInstallPath?: LoopPlusOrchestrationDeps["loadedExtensionInstallPath"];
  decisionSubtaskMax?: LoopPlusOrchestrationDeps["decisionSubtaskMax"];
  delay?: LoopPlusOrchestrationDeps["delay"];
  now?: () => number;
  isInvocationActive?: (tabId: string) => boolean;
  hasActiveSubtasks?: (taskId: string) => boolean;
  hasActiveSubtask?: LoopPlusOrchestrationDeps["hasActiveSubtask"];
  readTask: (taskId: string, options?: LoopTaskStoreReadOptions) => LoopTaskRecord | null;
  /** Host-only authority check immediately before a user Loop+ root is created. */
  assertNewTaskModeAvailable: () => void;
  createTask: (input: Parameters<LoopPlusOrchestrationDeps["createTask"]>[0] & { departmentMetadata?: DepartmentMetadata }) => LoopTaskRecord;
  updateTask: (taskId: string, patch: Partial<LoopTaskRecord>) => LoopTaskRecord | null;
  commitOrdinaryRun?: LoopPlusOrchestrationDeps["commitOrdinaryRun"];
  readMainRecoveryTask?: LoopPlusOrchestrationDeps["readMainRecoveryTask"];
  canAutoResumeMain?: LoopPlusOrchestrationDeps["canAutoResumeMain"];
  commitConfigLockResume?: LoopPlusRuntimeAdapterDeps["updateTask"];
  appendHostMessage: LoopPlusOrchestrationDeps["appendMessage"];
  removeClarificationResponse?: LoopPlusOrchestrationDeps["removeClarificationResponse"];
  appendCompletionMessages?: LoopPlusOrchestrationDeps["appendCompletionMessages"];
  onMainActivityChange?: (taskId: string) => void;
  onTaskCompleted?: LoopPlusOrchestrationDeps["onTaskCompleted"];
  appendSubtaskChat?: LoopPlusOrchestrationDeps["appendSubtaskChat"];
  appendAcceptancePlanChat?: LoopPlusOrchestrationDeps["appendAcceptancePlanChat"];
  appendSupplementalRequirementToCommunication?: LoopPlusOrchestrationDeps["appendSupplementalRequirementToCommunication"];
  recordPause?: LoopPlusOrchestrationDeps["recordPause"];
  prepareCommunication?: LoopPlusOrchestrationDeps["prepareCommunication"];
  appendAttemptReport: (filePath: string, content: string) => void;
  log?: LoopPlusOrchestrationDeps["log"];
  revealClarification?: (taskId: string) => void;
  recordInteractionHistory?: LoopPlusOrchestrationDeps["recordInteractionHistory"];
  waitForClarification?: LoopPlusOrchestrationDeps["waitForClarification"];
  runPrompt: (input: PromptRunInput, options?: {
    targetTabId?: string | null;
    isAborted?: () => boolean;
    signal?: AbortSignal;
    onStarted?: () => void;
    firstMainExecution?: FirstLoopMainExecution;
  }) => Promise<void>;
  /** Trusted production transport; department leaders never fall back to EH runners. */
  runDepartmentMain?: (input: PromptRunInput, options: { targetTabId: string; invocationId: string;
    isAborted: () => boolean; signal?: AbortSignal; onStarted?: () => void }) => Promise<void>;
  /** Called when the actual scheduler relinquishes this coordination lifecycle,
   * before idle waits. Must synchronously fence admission before its first await. */
  closeDepartmentCoordinator?: (taskId: string) => Promise<void>;
  getMessages: (target: LoopPlusPromptTarget) => ChatMessage[];
  readRuns: () => TaskRunRecord[];
  /** 本次宿主终态的直接发布；共享历史可能被其它窗口覆盖，不能作为唯一实时事实源。 */
  subscribeRunCompletion?: (listener: (run: TaskRunRecord) => void) => () => void;
  resolveThinkingMode: (
    input: PromptRunInput,
    cli: PromptRunTarget["cli"],
    role: "main" | "subtask",
    model: string | undefined,
  ) => ThinkingMode | undefined;
  createExecutionRoot: (grokExecutionRootId?: string, useWorkspaceCwd?: boolean, grokExecutionCwd?: string) => {
    cwd?: string;
    isolateProjectInstructions?: boolean;
    dispose: () => void | LoopSubtaskCleanupResult | Promise<void | LoopSubtaskCleanupResult>;
  } | null;
  findLegacyGrokExecutionCwd?: (sessionId: string) => Promise<string | null>;
  /** Trusted runner observation bound to this invocation, installed before execution.
   * done must prove actual termination (including runner cleanup), never task-end records or runPrompt settlement.
   * Missing observation quarantines department occupancy; ordinary Loop+ retains its legacy behavior.
   */
  /** True only when the trusted Owner owns root/links/tab; EH must not clean them again. */
  ownsDepartmentAttemptResources?: (request: LoopPlusAttemptRequest) => boolean;
  observeAttemptTermination?: (request: LoopPlusAttemptRequest, target: LoopPlusPromptTarget) => { done: Promise<void> } | null;
  createSubtaskTarget: (cli: LoopPlusPromptTarget["cli"], options?: { sessionId?: string | null; loopTaskId?: string; loopSubtaskId?: string }) => LoopPlusPromptTarget;
  recordDepartmentSubtaskTarget?: (target: LoopPlusPromptTarget) => void;
  onSubtaskPreparationFailed?: (tabId: string, status: "stopped" | "error") => void;
  closeSubtaskTab: (tabId: string) => Promise<void>;
  prepareSubtaskTabClose?: (tabId: string, options?: LoopSubtaskTabCloseOptions) => () => Promise<void>;
  closeSubtaskTabs?: LoopPlusOrchestrationDeps["closeSubtaskTabs"];
  cancelInvocation: (tabId: string) => void;
  resolveSessionId: (target: LoopPlusPromptTarget) => string | null;
  activeWorkspaceKey: () => string;
  isSubtaskConversation: (target: LoopPlusPromptTarget) => boolean;
  isTaskCompatible: (task: LoopTaskRecord, target: LoopPlusPromptTarget) => boolean;
  bindResumeTarget: (
    taskId: string,
    cli: LoopPlusPromptTarget["cli"],
    sessionId: string | null,
  ) => LoopTaskRecord | null;
  hiddenContinuePrompt: () => string;
  normalizeContinuePrompt: (prompt: string) => string | null;
  appendRefusal: (
    target: LoopPlusPromptTarget,
    kind: "nested" | "original-unavailable" | "incompatible",
  ) => void;
};

export type LoopPlusRuntimeAdapter = {
  host: () => ReturnType<typeof createLoopPlusOrchestrationHost>;
  /** Includes main invocations, admission waits, attempts and their final cleanup. */
  waitForTaskIdle: (taskId: string) => Promise<void>;
  hasTaskExecution: (taskId: string) => boolean;
  observeTask?: (taskId: string) => { done: Promise<void> } | null;
  observeAttempt?: (taskId: string, subtaskId: string, attemptId: string) => { done: Promise<void> } | null;
  setDepartmentCollaborationHandler?: (handler: (taskId: string, message: unknown) => { ok: boolean; reason?: string }) => void;
  setDepartmentExecutionAdmission?: (handler: (
    request: LoopPlusAttemptRequest,
    signal: AbortSignal,
  ) => Promise<LoopPlusAttemptExecutionLease | null | undefined>) => void;
  setDepartmentEmployeeCapacityReader?: (reader: NonNullable<LoopPlusRuntimeAdapterDeps["getDepartmentEmployeeCapacity"]>) => void;
  runEventDriven: (
    input: PromptRunInput,
    options: LoopPlusAdapterRunOptions,
    target: LoopPlusPromptTarget,
    onTaskOwnershipAcquired?: (taskId: string, target: LoopPlusPromptTarget) => void | Promise<void>,
  ) => Promise<boolean>;
  runMain: (request: LoopPlusMainRequest) => LoopPlusMainHandle;
  startAttempt: (request: LoopPlusAttemptRequest) => LoopPlusAttemptHandle;
  getLivePrompt: (taskId: string) => PromptRunInput | null;
};

type LoopPlusAdapterRunOptions = LoopPlusRunOptions & {
  targetTabId?: string | null;
  departmentMetadata?: DepartmentMetadata;
  onResumeSupplementCommitted?: (done: Promise<void>) => void;
};

type AttemptExecution = {
  thrown: boolean;
  error: unknown;
  completedRun: TaskRunRecord | null;
  boundary: LoopPlusInvocationBoundary;
  promptInput: PromptRunInput;
  target: LoopPlusPromptTarget;
  finalHandoff: LoopPlusFinalAssistantHandoff | null;
  nativeFinalObserved: boolean;
};

export function selectLoopPlusInvocationRun(
  runs: readonly TaskRunRecord[],
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
): TaskRunRecord | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!isInvocationRun(run, boundary, query)) {
      continue;
    }
    return run;
  }
  return null;
}

export function selectLoopPlusInvocationAssistant(
  messages: readonly ChatMessage[],
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
  run: TaskRunRecord,
): string | null {
  if (!hasUsableInvocationWindow(run)) {
    return null;
  }
  const duplicates = duplicatedMessageIds(messages);
  const userAnchor = findInvocationUserAnchor(messages, boundary, query, run, duplicates);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (userAnchor !== null && index <= userAnchor) {
      break;
    }
    const message = messages[index];
    if (!isInvocationAssistant(message, boundary, query, run, duplicates)) {
      continue;
    }
    if (message.kind === "thinking" || message.subagentId) {
      continue;
    }
    return message.content;
  }
  return null;
}

export function selectLoopPlusContinuationDetail(
  messages: readonly ChatMessage[],
  run: TaskRunRecord | null,
  query: Omit<LoopPlusInvocationQuery, "displayPrompt">,
): string | null {
  if (
    !run
    || run.status !== "end"
    || run.loopTaskId !== query.taskId
    || run.loopRound !== query.round
    || run.taskRole !== query.role
    || (query.attemptId !== undefined && run.loopAttemptId !== query.attemptId)
    || (query.role === "subtask" && run.loopSubtaskId !== query.subtaskId)
  ) {
    return null;
  }
  return selectLoopPlusInvocationAssistant(messages, {
    messageIds: new Set<string>(),
    runIds: new Set<string>(),
    startedAt: run.startedAt,
  }, {
    ...query,
    displayPrompt: run.prompt,
  }, run);
}

export function createLoopPlusRuntimeAdapter(deps: LoopPlusRuntimeAdapterDeps): LoopPlusRuntimeAdapter {
  const now = deps.now ?? (() => Date.now());
  let departmentExecutionAdmission: ((request: LoopPlusAttemptRequest, signal: AbortSignal) => Promise<LoopPlusAttemptExecutionLease | null | undefined>) | undefined;
  const livePrompts = new Map<string, PromptRunInput>();
  const lifecycles = new Map<string, Promise<void>>();
  let departmentCollaboration: ((taskId: string, message: unknown) => { ok: boolean; reason?: string }) | undefined;
  const executions = new Map<string, Set<Promise<unknown>>>();
  const attemptHandles = new Map<string, { subtaskId: string; handle: LoopPlusAttemptHandle; done: Promise<void> }>();
  const cleanupFailures = new Map<string, unknown>();
  let creatingDepartment: DepartmentMetadata | undefined;
  let departmentCapacityReader = deps.getDepartmentEmployeeCapacity;
  let departmentOwnership: ((taskId: string, target: LoopPlusPromptTarget) => void | Promise<void>) | undefined;
  let departmentTarget: LoopPlusPromptTarget | undefined;
  let departmentOwnershipReady: Promise<void> | undefined;
  let departmentOwnershipTaskId: string | undefined;
  let hostInstance: ReturnType<typeof createLoopPlusOrchestrationHost> | null = null;

  function trackExecution(taskId: string, promise: Promise<unknown>): void {
    let pending = executions.get(taskId);
    if (!pending) { pending = new Set(); executions.set(taskId, pending); }
    pending.add(promise);
    const remove = () => { pending!.delete(promise); if (!pending!.size) executions.delete(taskId); };
    void promise.then(remove, remove);
  }

  async function waitForTaskIdle(taskId: string): Promise<void> {
    while (executions.get(taskId)?.size) await Promise.allSettled([...executions.get(taskId)!]);
    if (cleanupFailures.has(taskId)) throw cleanupFailures.get(taskId);
  }

  function rememberLivePrompt(taskId: string, input: PromptRunInput): void {
    livePrompts.set(taskId, input);
  }

  function rememberRunInput(taskId: string, prompt: LoopPlusRunInput): void {
    rememberLivePrompt(taskId, {
      displayPrompt: prompt.displayPrompt,
      modelPrompt: prompt.modelPrompt ?? prompt.displayPrompt,
      contextTags: [],
      model: prompt.model,
      loopMainModel: prompt.loopMainModel,
      loopSubtaskModel: prompt.loopSubtaskModel,
      loopSubtaskCli: prompt.loopSubtaskCli,
      loopSubtaskConfigId: prompt.loopSubtaskConfigId,
      loopMainThinkingMode: prompt.loopMainThinkingMode,
      loopSubtaskThinkingMode: prompt.loopSubtaskThinkingMode,
      loopSubtaskFrontendCli: prompt.loopSubtaskFrontendCli,
      loopSubtaskFrontendConfigId: prompt.loopSubtaskFrontendConfigId,
      loopSubtaskFrontendModel: prompt.loopSubtaskFrontendModel,
      loopSubtaskFrontendThinkingMode: prompt.loopSubtaskFrontendThinkingMode,
      loopSubtaskFullstackCli: prompt.loopSubtaskFullstackCli,
      loopSubtaskFullstackConfigId: prompt.loopSubtaskFullstackConfigId,
      loopSubtaskFullstackModel: prompt.loopSubtaskFullstackModel,
      loopSubtaskFullstackThinkingMode: prompt.loopSubtaskFullstackThinkingMode,
      loopSubtaskMode: prompt.loopSubtaskMode,
    });
  }

  function releaseLivePromptIfCompleted(taskId: string | null): void {
    if (!taskId) {
      return;
    }
    const task = deps.readTask(taskId);
    if (task?.status === "completed") {
      livePrompts.delete(taskId);
    }
  }

  function promptForRole(
    taskId: string,
    role: "main" | "subtask",
    displayPrompt: string,
    modelPrompt: string,
    cli: PromptRunTarget["cli"],
    executionRole?: "backend" | "frontend" | "general",
    execution?: { configId: string | null; model?: string; thinkingMode?: ThinkingMode },
    attemptId?: string,
    task = deps.readTask(taskId),
  ): PromptRunInput {
    const live = livePrompts.get(taskId) ?? null;
    const binding: LoopPlusPromptRoleBinding = resolveLoopPlusPromptRoleBinding({
      role,
      task,
      executionRole,
      live: task?.modelRouting ? applyLoopModelRoutingToPrompt(live ?? {}, task.modelRouting, task.originProfile) : live,
    });
    const promptInput: PromptRunInput = {
      displayPrompt,
      modelPrompt: task?.department?.role === "leader" && activePromptRuleDelivery() === "full"
        ? `${buildDepartmentRolePrompt(role === "main" ? "leader" : "employee")}\n\n${modelPrompt}` : modelPrompt,
      contextTags: [],
      model: binding.model,
      loopMainModel: binding.loopMainModel,
      loopSubtaskModel: binding.loopSubtaskModel,
      ...(binding.loopSubtaskCli ? { loopSubtaskCli: binding.loopSubtaskCli } : {}),
      ...(binding.loopSubtaskConfigId ? { loopSubtaskConfigId: binding.loopSubtaskConfigId } : {}),
      ...(binding.loopSubtaskFrontendCli ? { loopSubtaskFrontendCli: binding.loopSubtaskFrontendCli } : {}),
      ...(binding.loopSubtaskFrontendConfigId ? { loopSubtaskFrontendConfigId: binding.loopSubtaskFrontendConfigId } : {}),
      ...(binding.loopSubtaskFrontendModel ? { loopSubtaskFrontendModel: binding.loopSubtaskFrontendModel } : {}),
      ...(binding.loopSubtaskFullstackCli ? { loopSubtaskFullstackCli: binding.loopSubtaskFullstackCli } : {}),
      ...(binding.loopSubtaskFullstackConfigId ? { loopSubtaskFullstackConfigId: binding.loopSubtaskFullstackConfigId } : {}),
      ...(binding.loopSubtaskFullstackModel ? { loopSubtaskFullstackModel: binding.loopSubtaskFullstackModel } : {}),
      loopMainThinkingMode: binding.loopMainThinkingMode,
      loopSubtaskThinkingMode: binding.loopSubtaskThinkingMode,
      loopSubtaskFrontendThinkingMode: binding.loopSubtaskFrontendThinkingMode,
      loopSubtaskFullstackThinkingMode: binding.loopSubtaskFullstackThinkingMode,
      taskRole: role,
      loopTaskId: taskId,
      loopRound: 1,
      ...(attemptId !== undefined ? { loopAttemptId: attemptId } : {}),
      throwOnError: true,
    };
    promptInput.thinkingModeOverride = deps.resolveThinkingMode(
      promptInput,
      cli,
      role,
      role === "subtask"
        ? (executionRole === "general" ? binding.loopMainModel : binding.model)
        : binding.model,
    );
    if (role === "subtask" && execution && executionRole !== "general") {
      if (execution.model) {
        promptInput.model = execution.model;
        promptInput.loopSubtaskModel = execution.model;
      }
      if (execution.configId) {
        promptInput.loopSubtaskConfigId = execution.configId;
      }
      if (execution.thinkingMode) {
        promptInput.thinkingModeOverride = execution.thinkingMode;
      }
    } else if (role === "subtask" && execution?.thinkingMode && executionRole === "general") {
      promptInput.thinkingModeOverride = execution.thinkingMode;
    }
    return promptInput;
  }

  function captureBoundary(target: LoopPlusPromptTarget): LoopPlusInvocationBoundary {
    return {
      messageIds: new Set(deps.getMessages(target).map((message) => message.id)),
      runIds: new Set(deps.readRuns().map((run) => run.id)),
      startedAt: now(),
    };
  }

  function readInvocation(
    target: LoopPlusPromptTarget,
    boundary: LoopPlusInvocationBoundary,
    promptInput: PromptRunInput,
    role: "main" | "subtask",
    subtaskId?: string,
    completedRun?: TaskRunRecord | null,
    finalHandoff?: LoopPlusFinalAssistantHandoff | null,
    nativeFinalObserved = false,
  ): { run: TaskRunRecord | null; content: string | null } {
    const query: LoopPlusInvocationQuery = {
      taskId: promptInput.loopTaskId ?? "",
      round: promptInput.loopRound ?? 1,
      role,
      subtaskId,
      displayPrompt: promptInput.displayPrompt,
      attemptId: promptInput.loopAttemptId,
    };
    const run = completedRun ?? selectLoopPlusInvocationRun(deps.readRuns(), boundary, query);
    if (!run) {
      deps.log?.("loop-plus-invocation-diagnostic", {
        stage: "run", code: finalHandoff ? "terminal-produced-run-missing" : "unknown",
      });
      return { run: null, content: null };
    }
    const handoff = finalHandoff;
    const handoffContent = handoff && handoff.runId === run.id && handoff.sessionId === run.sessionId
      && handoff.taskId === query.taskId && handoff.round === query.round && handoff.role === "main"
      && query.role === "main" && handoff.attemptId === query.attemptId
      && handoff.content.trim().length > 0 ? handoff.content : null;
    const projectedContent = handoff || nativeFinalObserved ? null : selectLoopPlusInvocationAssistant(deps.getMessages(target), boundary, query, run);
    if (handoff && handoffContent === null) {
      deps.log?.("loop-plus-invocation-diagnostic", { stage: "handoff", code: "identity-rejected" });
    }
    if (handoffContent !== null) {
      deps.log?.("loop-plus-invocation-diagnostic", { stage: "projection", code: "authoritative-handoff-used" });
    } else if (run.status === "end" && projectedContent === null) {
      deps.log?.("loop-plus-invocation-diagnostic", { stage: "projection", code: "terminal-content-unknown" });
    }
    if (run.status !== "end") {
      deps.log?.("loop-plus-invocation-diagnostic", {
        stage: "run", code: run.status === "stopped" ? "cancelled" : "run-error-unknown",
      });
    }
    return { run, content: nativeFinalObserved ? handoffContent : handoff ? handoffContent : projectedContent };
  }

  async function runInvocation(
    promptInput: PromptRunInput,
    target: LoopPlusPromptTarget,
    role: "main" | "subtask",
    options: { isAborted: () => boolean; onStarted?: () => void; signal?: AbortSignal; lostInvocationSignal?: AbortSignal; firstMainExecution?: FirstLoopMainExecution;
      onObserve?: (read: () => ReturnType<typeof readInvocation>) => void },
    mainParent?: LoopTaskRecord,
  ): Promise<AttemptExecution> {
    const boundary = captureBoundary(target);
    const query: LoopPlusInvocationQuery = {
      taskId: promptInput.loopTaskId ?? "",
      round: promptInput.loopRound ?? 1,
      role,
      subtaskId: promptInput.loopSubtaskId,
      displayPrompt: promptInput.displayPrompt,
      attemptId: promptInput.loopAttemptId,
    };
    let completedRun: TaskRunRecord | null = null;
    let finalHandoff: LoopPlusFinalAssistantHandoff | null = null;
    let nativeFinalObserved = false;
    promptInput.loopPlusNativeFinalObserved = () => {
      if (!options.isAborted()) nativeFinalObserved = true;
    };
    if (role === "main" && promptInput.taskRole === "main" && promptInput.loopTaskId && !promptInput.loopAsk) {
      promptInput.loopPlusFinalAssistantHandoff = (value) => {
        if (options.isAborted() || value.taskId !== query.taskId || value.round !== query.round
          || value.role !== query.role || value.attemptId !== query.attemptId || !value.content.trim()) return;
        finalHandoff = value;
      };
    }
    const unsubscribe = deps.subscribeRunCompletion?.((run) => {
      if (isInvocationRun(run, boundary, { ...query, displayPrompt: promptInput.displayPrompt })) {
        completedRun = run;
      }
    });
    options.onObserve?.(() => readInvocation(target, boundary, promptInput, role, query.subtaskId, completedRun, finalHandoff, nativeFinalObserved));
    let removePreparationAbort: (() => void) | undefined;
    try {
      const task = mainParent ?? deps.readTask(promptInput.loopTaskId ?? "");
      if (options.firstMainExecution && (!task || task.department || task.departmentInvalid)) {
        throw new Error("原 Loop+ 执行归属已变化，任务未启动。");
      }
      if (options.firstMainExecution) {
        await deps.runPrompt(promptInput, { ...options, targetTabId: target.tabId });
      } else if (role === "main" && (usesDepartmentOwner(task?.department) || task?.departmentInvalid)) {
        if (!task) throw new Error("部门执行任务不存在。");
        if (!deps.runDepartmentMain || !isDepartmentExecutionCli(task.cli)) throw new Error("部门组长原生 Owner 路径未支持，拒绝普通执行回退。");
        await deps.runDepartmentMain(promptInput, { ...options, targetTabId: target.tabId, invocationId: randomUUID() });
      } else if (task?.department?.executionMode === "loop-plus"
        || (role === "subtask" && (usesDepartmentOwner(task?.department) || task?.departmentInvalid))) {
        await deps.runPrompt(promptInput, { ...options, targetTabId: target.tabId });
      } else if (options.signal) {
        const signal = options.signal;
        signal.throwIfAborted();
        await waitForLoopInvocation(new Promise<void>((resolve, reject) => {
          const onAbort = (): void => { reject(signal.reason); };
          removePreparationAbort = () => signal.removeEventListener("abort", onAbort);
          signal.addEventListener("abort", onAbort, { once: true });
          // Preparation may outlive a closed tab. Its late return must still
          // observe isAborted before dispatching; an actual runner must settle.
          Promise.resolve().then(() => {
            signal.throwIfAborted();
            return deps.runPrompt(promptInput, {
              targetTabId: target.tabId,
              signal: options.signal,
              isAborted: options.isAborted,
              onStarted: () => {
                removePreparationAbort?.();
                options.onStarted?.();
              },
            });
          }).then(resolve, reject);
        }), options.lostInvocationSignal);
      } else {
        await deps.runPrompt(promptInput, { ...options, targetTabId: target.tabId });
      }
      return { thrown: false, error: null, completedRun, boundary, promptInput, target, finalHandoff, nativeFinalObserved };
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "") : "";
      const diagnosticCode = options.isAborted() ? "cancelled"
        : error instanceof CodexUnexpectedTurnExitError ? "early-exit"
          : ["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(errorCode) ? "transport-interrupted" : "unknown";
      deps.log?.("loop-plus-invocation-diagnostic", {
        stage: "execution", code: diagnosticCode,
      });
      if (role === "main" && !options.firstMainExecution && usesDepartmentOwner(mainParent?.department)) {
        const unknown = new Error(error instanceof Error ? error.message : String(error)) as Error & { code: string; cause: unknown };
        unknown.code = "DEPARTMENT_NATIVE_UNKNOWN"; unknown.cause = error;
        return { thrown: true, error: unknown, completedRun, boundary, promptInput, target, finalHandoff, nativeFinalObserved };
      }
      return { thrown: true, error, completedRun, boundary, promptInput, target, finalHandoff, nativeFinalObserved };
    } finally {
      delete promptInput.loopPlusFinalAssistantHandoff;
      delete promptInput.loopPlusNativeFinalObserved;
      removePreparationAbort?.();
      unsubscribe?.();
    }
  }

  function runMain(request: LoopPlusMainRequest): LoopPlusMainHandle {
    const trace = deps.createPerformanceTrace?.("loop_plus", request.target.cli, "main");
    const firstMainExecution = request.firstMainExecution;
    let aborted = false;
    let cancelled = false;
    let departmentMain = false;
    const controller = new AbortController();
    let invocationStarted = false;
    let runnerActive = false;
    let interruptedNativeSessionId: string | undefined;
    if (firstMainExecution) firstMainExecution.claimed = true;
    const invocation = withLoopPlusMainAdmission(request.taskId, deps.readTask, controller.signal, async (task, admission) => {
      departmentMain = usesDepartmentOwner(task.department);
      if ((!firstMainExecution && task.status !== "running") || task.workspaceKey !== deps.activeWorkspaceKey()
        || task.cli !== request.target.cli || (!departmentMain && !deps.isTaskCompatible(task, request.target))) {
        throw loopPlusMainFailure("LOOP_PLUS_PARENT_UNAVAILABLE");
      }
      const promptInput = promptForRole(
        request.taskId,
        "main",
        request.prompt,
        request.modelPrompt,
        request.target.cli,
        undefined, undefined, undefined, task,
      );
      if (!departmentMain && !task.departmentInvalid && !firstMainExecution) {
        promptInput.loopPlusMainAdmission = admission;
      }
      const observedMain = !firstMainExecution && promptInput.taskRole === "main" && !promptInput.loopSubtaskId
        && task?.schedulingMode === "event_driven"
        && !task.department && !task.departmentInvalid && request.target.cli === "codex";
      if (request.canSendAutoResumedMain && (!observedMain || !request.interruptedNativeSessionId)) return null;
      if (observedMain) {
        const canSend = request.canSendAutoResumedMain;
        const nativeSessionId = request.interruptedNativeSessionId;
        promptInput.loopPlusMainRuntime = {
          onUnexpectedExit: (threadId) => { if (!aborted) interruptedNativeSessionId = threadId; },
          recovery: canSend && nativeSessionId ? { target: { ...request.target }, nativeSessionId, canSend } : undefined,
        };
      }
      if (firstMainExecution?.prepareMain) {
        const prepare = firstMainExecution.prepareMain;
        firstMainExecution.prepareMain = (task) => {
          const prepared = prepare(task);
          return {
            ...prepared,
            afterSend: () => {
              promptInput.displayPrompt = prepared.displayPrompt;
              promptInput.modelPrompt = prepared.modelPrompt ?? prepared.displayPrompt;
              prepared.afterSend();
            },
          };
        };
      }
      const execution = await runInvocation(promptInput, request.target, "main", {
        isAborted: () => aborted,
        firstMainExecution,
        ...(task.department || firstMainExecution || request.canSendAutoResumedMain ? { signal: controller.signal } : {}),
        onStarted: () => {
          invocationStarted = true;
          runnerActive = true;
          deps.onMainActivityChange?.(request.taskId);
        },
      }, task);
      try {
        if (firstMainExecution && !firstMainExecution.admitted) {
          firstMainExecution.finishBeforeAdmission(aborted, execution.thrown ? execution.error : undefined);
          return null;
        }
        const invocation = readInvocation(request.target, execution.boundary, promptInput, "main", undefined, execution.completedRun, execution.finalHandoff, execution.nativeFinalObserved);
        cancelled = invocation.run?.status === "stopped";
        if (execution.thrown) {
          if (aborted || cancelled) {
            return null;
          }
          throw execution.error;
        }
        if (aborted || cancelled || interruptedNativeSessionId) return null;
        if (!invocation.run) throw loopPlusMainFailure(admission.hasOpened() || invocationStarted || execution.finalHandoff || execution.nativeFinalObserved
          ? "LOOP_PLUS_RUN_UNCONFIRMED" : "LOOP_PLUS_RUN_NOT_STARTED");
        if (invocation.run.status === "error") throw new Error(invocation.run.failureDetail || "本次主任务的 CLI 执行失败。");
        if (invocation.content === null) throw loopPlusMainFailure("LOOP_PLUS_FINAL_UNCONFIRMED");
        return invocation.content;
      } finally {
        runnerActive = false;
        if (invocationStarted && !firstMainExecution) {
          deps.onMainActivityChange?.(request.taskId);
        }
      }
    }).catch((error) => {
      if (aborted) return null;
      throw error;
    });
    const measuredInvocation = trace?.measure("main-turn", () => invocation,
      (result) => result === null ? (aborted || cancelled ? "stopped" : "failed") : "returned") ?? invocation;
    const promise = firstMainExecution ? measuredInvocation.catch(async (error) => {
      if (firstMainExecution.admitted) throw error;
      firstMainExecution.finishBeforeAdmission(aborted, error);
      return null;
    }).finally(async () => {
      if (invocationStarted) {
        try { deps.onMainActivityChange?.(request.taskId); } catch { /* Projection only. */ }
      }
    }) : measuredInvocation;
    trackExecution(request.taskId, promise);
    return {
      promise,
      hasStarted: () => invocationStarted,
      wasCancelled: () => aborted || cancelled,
      wasUnexpectedlyInterrupted: () => !aborted && interruptedNativeSessionId !== undefined,
      getInterruptedNativeSessionId: () => aborted ? undefined : interruptedNativeSessionId,
      abort: () => {
        if (aborted) {
          return;
        }
        aborted = true;
        controller.abort();
        if (runnerActive && !departmentMain) {
          deps.cancelInvocation(request.target.tabId);
        }
      },
    };
  }

  function startAttempt(request: LoopPlusAttemptRequest, confirmedParent?: LoopTaskRecord): LoopPlusAttemptHandle {
    const attemptKey = JSON.stringify([request.taskId, request.attemptId]);
    const existingHandle = attemptHandles.get(attemptKey);
    if (existingHandle) {
      if (existingHandle.subtaskId !== request.subtaskId) throw new Error("Attempt identity conflict");
      return existingHandle.handle;
    }
    const task = confirmedParent?.id === request.taskId ? confirmedParent : deps.readTask(request.taskId);
    const configId = request.execution?.configId ?? deps.getActiveConfigIdForCli?.(request.targetCli) ?? null;
    const continuation = resolveLoopSubtaskSession(task ?? { subTasks: [] }, { id: request.subtaskId, continueFromSubtaskId: request.continueFromSubtaskId }, request.targetCli, configId);
    const grokExecutionRootId = request.targetCli === "grok"
      ? continuation.sessionId ? continuation.grokExecutionRootId ?? randomUUID() : randomUUID()
      : undefined;
    let grokExecutionCwd = continuation.grokExecutionCwd;
    const sourceSessionSnapshot = JSON.stringify(task?.subTasks.find((v) => v.id === continuation.sourceSubtaskId)?.executionSession ?? null);
    const trace = deps.createPerformanceTrace?.("loop_plus", request.targetCli, "subtask");
    const finishAttempt = trace?.start("attempt");
    let subtaskTarget = departmentExecutionAdmission || deps.acquireAttemptExecution || request.claimExecution ? null : createTarget();
    deps.log?.("loop-subtask-session-selection", { taskId: request.taskId, subtaskId: request.subtaskId, sourceSubtaskId: continuation.sourceSubtaskId, reused: Boolean(continuation.sessionId), reason: continuation.reason });
    let aborted = false;
    const controller = new AbortController();
    let invocationStarted = false;
    let closeTabAfterAbort = false;
    const lostInvocationAbort = new AbortController();
    const departmentLoopPlus = task?.department?.executionMode === "loop-plus";
    let settled = false;
    let departmentLease = false;
    let departmentAdmissionDenied = false;
    const ownerResources = task?.department?.executionMode !== "loop-plus" && deps.ownsDepartmentAttemptResources?.(request) === true;
    let cleanupFailure: unknown;
    let cleanupFailed = false;
    let resolveCleaned!: () => void;
    let rejectCleaned!: (error: unknown) => void;
    const cleaned = new Promise<void>((resolve, reject) => { resolveCleaned = resolve; rejectCleaned = reject; });
    // Observation is independent from the business outcome and may reject before a recovery subscriber exists.
    void cleaned.catch(() => undefined);
    function failCleanup(error: unknown): void { cleanupFailed = true; cleanupFailure = error; }
    let invocationFinished = false;
    let invocationStartedAt: number | null = null;
    let readInvocationEvidence: (() => ReturnType<typeof readInvocation>) | undefined;
    let tabClosePromise: Promise<void> | null = null;
    let preparedClose: (() => Promise<void>) | undefined;
    let preparedCompletedClose: (() => Promise<void>) | undefined;
    const closeTab = (reason: "completed" | "main-abort"): Promise<void> => {
      if (!subtaskTarget || ownerResources) {
        return Promise.resolve();
      }
      if (!tabClosePromise) {
        const closePromise = closeLoopPlusSubtaskTab(
          deps, request, subtaskTarget.tabId, reason,
          reason === "completed" ? preparedCompletedClose : preparedClose,
        );
        tabClosePromise = closePromise;
        void closePromise.catch(() => {
          if (tabClosePromise === closePromise) {
            tabClosePromise = null;
          }
        });
      }
      return tabClosePromise;
    };
    const promise = (async (): Promise<LoopPlusAttemptResult> => {
      let lease: LoopPlusAttemptExecutionLease | null | undefined;
      let result: LoopPlusAttemptResult = { outcome: "stopped", detail: "stopped" };
      try {
        const admissionConfigured = Boolean(departmentExecutionAdmission || deps.acquireAttemptExecution);
        const acquire = () => admissionConfigured ? acquireExecution() : Promise.resolve(null);
        lease = trace && admissionConfigured
          ? await trace.measure("attempt-admission", acquire, (value) => value === null ? (aborted ? "stopped" : "denied") : "returned")
          : await acquire();
        if (!aborted && (!(departmentExecutionAdmission || deps.acquireAttemptExecution) || lease !== null)) {
          if (request.claimExecution && !await request.claimExecution(controller.signal)) {
            return { outcome: "stopped", detail: "启动预留待核对", reservationUnconfirmed: true };
          }
          if (controller.signal.aborted) return { outcome: "stopped", detail: "stopped" };
          subtaskTarget ??= createTarget();
          const execute = () => withLoopSubtaskSession(request.targetCli, continuation.sessionId, runStartedAttempt, {
            taskId: request.taskId, subtaskId: request.subtaskId, sourceSubtaskId: continuation.sourceSubtaskId, signal: controller.signal,
          });
          result = trace
            ? await trace.measure("attempt-execution", execute, (value) => value.outcome)
            : await execute();
          if (result.outcome === "completed") {
            try { preparedClose = deps.prepareSubtaskTabClose?.(subtaskTarget.tabId); }
            catch (error) { preparedClose = async () => { throw error; }; }
            try {
              preparedCompletedClose = deps.prepareSubtaskTabClose?.(subtaskTarget.tabId, {
                completed: true,
                ...(!departmentLease ? { expected: request } : {}),
              });
            }
            catch (error) { preparedCompletedClose = async () => { throw error; }; }
          }
        } else if (!aborted && departmentAdmissionDenied) {
          // Explicit refusal is terminal for this unstarted attempt. A generic stopped result
          // means resumable interruption to the orchestration host and would retain running.
          result = { outcome: "failed", detail: "部门执行准入被拒绝，子任务未启动" };
        }
      } catch (error) {
        result = aborted ? { outcome: "stopped", detail: "stopped" } : { outcome: "failed", detail: errorDetail(error) };
      } finally {
        const finishCleanup = trace?.start("attempt-cleanup");
        if (!invocationStarted && subtaskTarget) {
          deps.onSubtaskPreparationFailed?.(subtaskTarget.tabId, aborted ? "stopped" : "error");
        }
        try {
          // Department tabs are required resources even when the business result failed/stopped.
          if (!cleanupFailed && (departmentLease || closeTabAfterAbort)) {
            await closeTab(closeTabAfterAbort ? "main-abort" : "completed");
          }
        } catch (error) { failCleanup(error); }
        if (cleanupFailed) {
          if (departmentLease) {
            result = { outcome: "failed",
              detail: [result.detail, `执行清理未核验：${errorDetail(cleanupFailure)}`].filter(Boolean).join("\n") };
          }
          if (departmentLease) {
            cleanupFailures.set(request.taskId, cleanupFailure);
            try { lease?.cleanupFailed?.(cleanupFailure); } catch (error) { observeLateFailure("loop-attempt-cleanup-quarantine-failed", error); }
          }
          rejectCleaned(cleanupFailure);
        } else {
          try { lease?.release(); resolveCleaned(); }
          catch (error) {
            if (departmentLease) {
              cleanupFailures.set(request.taskId, error);
              try { lease?.cleanupFailed?.(error); } catch { /* retain the original observation failure */ }
            }
            rejectCleaned(error);
            result = { outcome: "failed", detail: [result.detail, `执行准入租约释放失败：${errorDetail(error)}`].filter(Boolean).join("\n") };
          }

        }
        // Legacy leases retain their old release behavior; department leases require all proofs above.
        if (cleanupFailed && !departmentLease) {
          let releaseDetail: string | undefined;
          try { lease?.release(); } catch (error) {
            observeLateFailure("loop-attempt-lease-release-failed", error);
            releaseDetail = `执行准入租约释放失败：${errorDetail(error)}`;
          }
          if (result.outcome === "failed" || releaseDetail !== undefined) {
            result = { outcome: "failed", detail: [result.detail, `执行清理未核验：${errorDetail(cleanupFailure)}`, releaseDetail]
              .filter(Boolean).join("\n") };
          }
        }
        settled = true;
        finishCleanup?.(cleanupFailed ? "failed" : "completed");
      }
      return result;
    })();
    void promise.then((value) => finishAttempt?.(value.outcome), () => finishAttempt?.("threw"));
    const handle: LoopPlusAttemptHandle = {
      promise,
      isActive: () => !settled && (departmentLoopPlus || departmentLease || invocationStartedAt === null || now() - invocationStartedAt < LOOP_WAIT_WATCHDOG_TICK_MS
        || invocationFinished || (!subtaskTarget || deps.isInvocationActive?.(subtaskTarget.tabId)) !== false),
      readLostOutcome: () => {
        const evidence = readInvocationEvidence?.();
        if (evidence?.run?.status === "stopped") return { outcome: "stopped", detail: "stopped" };
        if (evidence?.run?.status === "end" && evidence.content?.trim()) return { outcome: "completed", detail: evidence.content };
        if (evidence?.run?.failureDetail) return { outcome: "failed", detail: evidence.run.failureDetail };
        return undefined;
      },
      onCompleted: async () => {
        try { await closeTab("completed"); }
        catch (error) {
          // Ordinary transcript cleanup is best effort after the report;
          // Department cleanup already failed closed before release.
          if (departmentLease) throw error;
        }
      },
      abort: (options) => {
        if (!departmentLoopPlus && !departmentLease && invocationStarted && !invocationFinished && subtaskTarget && deps.isInvocationActive?.(subtaskTarget.tabId) === false) {
          lostInvocationAbort.abort();
        }
        closeTabAfterAbort ||= options?.closeTab === true;
        if (aborted) {
          if (settled && closeTabAfterAbort) {
            void closeTab("main-abort").catch((error) => observeLateFailure("loop-attempt-late-tab-close-failed", error));
          }
          return;
        }
        if (invocationStarted && !invocationFinished) {
          try { persistSession(); } catch (error) { failCleanup(error); }
        }
        aborted = true;
        controller.abort();
        if (invocationStarted && !invocationFinished && subtaskTarget) {
          deps.cancelInvocation(subtaskTarget.tabId);
        }

        if (settled && closeTabAfterAbort) {
          void closeTab("main-abort").catch((error) => observeLateFailure("loop-attempt-late-tab-close-failed", error));
        }
      },
    };
    attemptHandles.set(attemptKey, { subtaskId: request.subtaskId, handle, done: cleaned });
    trackExecution(request.taskId, promise);
    const removeHandle = () => { if (!cleanupFailed && attemptHandles.get(attemptKey)?.handle === handle) attemptHandles.delete(attemptKey); };
    void promise.then(removeHandle, removeHandle);
    return handle;

    function createTarget(): LoopPlusPromptTarget {
      const target = deps.createSubtaskTarget(request.targetCli, {
        sessionId: continuation.sessionId,
        loopTaskId: request.taskId,
        loopSubtaskId: request.subtaskId,
      });
      if (usesDepartmentOwner(task?.department)) deps.recordDepartmentSubtaskTarget?.(target);
      return target;
    }

    function observeLateFailure(kind: string, error: unknown): void {
      const detail = { taskId: request.taskId, attemptId: request.attemptId, error: errorDetail(error) };
      try {
        if (deps.log) {
          deps.log(kind, detail);
          return;
        }
      } catch (loggingError) {
        void logError("loop-attempt-admission-log-failed", {
          taskId: request.taskId,
          attemptId: request.attemptId,
          error: errorDetail(loggingError),
        }).catch(() => undefined);
        return;
      }
      void logError(kind, detail).catch(() => undefined);
    }

    function acquireExecution(): Promise<LoopPlusAttemptExecutionLease | null | undefined> {
      const acquisition = departmentExecutionAdmission
        ? departmentExecutionAdmission(request, controller.signal).then((acquired) => {
          departmentAdmissionDenied = acquired === null;
          departmentLease = task?.department?.executionMode !== "loop-plus" && acquired !== null && acquired !== undefined;
          return acquired !== undefined ? acquired
            : controller.signal.aborted ? null : deps.acquireAttemptExecution ? deps.acquireAttemptExecution(request, controller.signal) : undefined;
        })
        : deps.acquireAttemptExecution ? deps.acquireAttemptExecution(request, controller.signal) : Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const onAbort = (): void => { resolve(null); };
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) {
          onAbort();
        }
        void acquisition.then((lease) => {
          controller.signal.removeEventListener("abort", onAbort);
          if (controller.signal.aborted) {
            try {
              lease?.release();
            } catch (error) {
              observeLateFailure("loop-attempt-late-lease-release-failed", error);
            }
            resolve(null);
          } else {
            resolve(lease);
          }
        }, (error: unknown) => {
          controller.signal.removeEventListener("abort", onAbort);
          if (controller.signal.aborted) {
            observeLateFailure("loop-attempt-cancelled-admission-failed", error);
          }
          reject(error);
        });
      });
    }

    function continuationSourceChanged(): boolean {
      if (!usesDepartmentOwner(task?.department) || request.targetCli !== "codex"
        || continuation.sourceSubtaskId === request.subtaskId) return false;
      const latest = deps.readTask(request.taskId);
      return !latest || latest.status !== "running"
        || latest.subTasks.find((v) => v.id === request.subtaskId)?.continueFromSubtaskId !== request.continueFromSubtaskId
        || JSON.stringify(latest.subTasks.find((v) => v.id === continuation.sourceSubtaskId)?.executionSession ?? null) !== sourceSessionSnapshot;
    }

    function persistSession(sessionId = subtaskTarget ? deps.resolveSessionId(subtaskTarget) : null): void {
      if (usesDepartmentOwner(task?.department) && request.targetCli === "grok") return;
      const latest = deps.readTask(request.taskId);
      if (!sessionId || !latest) {
        return;
      }
      const recorded = latest.subTasks.find((item) => item.id === request.subtaskId)?.executionSession;
      // The native Owner coordinator is the sole Department Codex binding writer.
      // A tab target is only a transcript key and must never replace that record.
      if (usesDepartmentOwner(task?.department) && request.targetCli === "codex") {
        if (!recorded || recorded.cli !== "codex" || recorded.configId !== configId
          || recorded.sessionId !== sessionId || (continuation.sessionId && recorded.sessionId !== continuation.sessionId)) {
          const error = new Error("department-codex-session-writeback-conflict");
          failCleanup(error); throw error;
        }
        return;
      }
      const recordedConfigId = recorded?.cli === request.targetCli && recorded.sessionId === sessionId ? recorded.configId : configId;
      deps.updateTask(latest.id, { subTasks: bindLoopSubtaskSession(latest.subTasks, request.subtaskId, {
        cli: request.targetCli, sessionId, configId: recordedConfigId,
        ...(grokExecutionRootId ? { grokExecutionRootId } : {}),
        ...(grokExecutionCwd ? { grokExecutionCwd } : {}),
      }) });
    }

    async function runStartedAttempt(): Promise<LoopPlusAttemptResult> {
      const target = subtaskTarget;
      if (aborted || !target) {
        return { outcome: "stopped", detail: "stopped" };
      }
      let grokResumeSessionId = continuation.sessionId;
      let grokRecoveredLegacySessionId: string | undefined;
      let grokLegacySessionFallbackFromSessionId: string | undefined;
      if (request.targetCli === "grok" && continuation.sessionId && !continuation.grokExecutionRootId && !grokExecutionCwd) {
        grokExecutionCwd = (await deps.findLegacyGrokExecutionCwd?.(continuation.sessionId)) ?? undefined;
        if (grokExecutionCwd) {
          grokRecoveredLegacySessionId = continuation.sessionId;
        } else {
          grokResumeSessionId = null;
          grokLegacySessionFallbackFromSessionId = continuation.sessionId;
          deps.log?.("loop-subtask-grok-legacy-session-unavailable", {
            taskId: request.taskId, subtaskId: request.subtaskId, sourceSubtaskId: continuation.sourceSubtaskId,
          });
        }
      }
      if (usesDepartmentOwner(task?.department) && request.targetCli === "codex") {
        const current = deps.readTask(request.taskId);
        const selected = resolveLoopSubtaskSession(current ?? { subTasks: [] },
          { id: request.subtaskId, continueFromSubtaskId: request.continueFromSubtaskId }, request.targetCli, configId);
        if (!current || current.status !== "running" || JSON.stringify(selected) !== JSON.stringify(continuation)
          || JSON.stringify(current.subTasks.find((v) => v.id === continuation.sourceSubtaskId)?.executionSession ?? null) !== sourceSessionSnapshot) {
          throw new Error("department-codex-continuation-source-changed");
        }
      }
      let termination: Promise<{ ok: true } | { ok: false; error: unknown }> | null = null;
      let invocationIssued = false;
      let runnerStarted = false;
      let executionFailure: unknown;
      const useWorkspaceCwd = task?.department?.executionMode === "loop-plus" && request.targetCli !== "grok" && request.targetCli !== "dsh";
      const rootResult = await withLoopPlusExecutionRoot(
        () => {
          if (ownerResources) return { cwd: undefined, dispose: () => ({ ok: true as const, retainedDirectory: false }) };
          let root: ReturnType<LoopPlusRuntimeAdapterDeps["createExecutionRoot"]>;
          try { root = deps.createExecutionRoot(grokExecutionRootId, useWorkspaceCwd, grokExecutionCwd); }
          catch (error) {
            if ((error as { cleanupResult?: LoopSubtaskCleanupResult })?.cleanupResult?.ok === false) failCleanup(error);
            throw error;
          }
          return {
            cwd: root?.cwd,
            isolateProjectInstructions: root?.isolateProjectInstructions ?? Boolean(root),
            dispose: async () => {
              try {
                if (departmentLease && invocationIssued && !(aborted && !runnerStarted)) {
                  if (!termination) throw new Error("执行终止缺少可信 runner 观察，保留执行现场与容量");
                  const ended = await termination;
                  if (!ended.ok) throw ended.error;
                }
                const disposed = await root?.dispose();
                if (disposed?.ok === false) throw new Error(disposed.reason);
                if (departmentLease && root && !disposed) throw new Error("执行目录清理未返回可核验结果");
                return disposed;
              } catch (error) { failCleanup(error); throw error; }
            },
          };
        },
        async (executionRoot): Promise<AttemptExecution> => {
          try {
            const promptInput = promptForRole(
              request.taskId,
              "subtask",
              request.prompt,
              request.modelPrompt,
              request.targetCli,
              request.execution?.role,
              request.execution,
              request.attemptId,
            );
            if (grokResumeSessionId) {
              promptInput.modelPrompt += "\n本次续接此前子任务会话。只完成本轮新指令并写入本轮沟通文件，不重复旧任务；执行目录以本轮宿主提供的 cwd 为准，不继续使用历史临时目录。";
            }
            if (configId) {
              promptInput.loopSubtaskConfigId = configId;
            }
            promptInput.loopRound = request.round;
            promptInput.loopSubtaskId = request.subtaskId;
            const root = executionRoot;
            promptInput.executionCwd = root?.cwd;
            promptInput.isolateProjectInstructions = root && "isolateProjectInstructions" in root
              ? root.isolateProjectInstructions
              : Boolean(root);
            if (grokExecutionRootId) {
              if (!root?.cwd) throw new Error("Grok 子任务缺少隔离执行目录。");
              promptInput.grokLoopExecutionRootId = grokExecutionRootId;
              promptInput.grokLoopExecutionCwd = grokExecutionCwd;
              promptInput.grokLoopResumeSessionId = grokResumeSessionId;
              if (grokRecoveredLegacySessionId) promptInput.grokLoopRecoveredLegacySessionId = grokRecoveredLegacySessionId;
              if (grokLegacySessionFallbackFromSessionId) {
                promptInput.grokLoopLegacySessionFallbackFromSessionId = grokLegacySessionFallbackFromSessionId;
                const compatibilityNotice = "【升级兼容】旧版 Grok CLI 会话仍保留，但未能安全找回原执行目录。本轮将使用新会话继续；请以本轮指令和工作区实际状态为准，不要假定已继承旧对话，若缺少必要上下文请先说明。\n\n";
                promptInput.displayPrompt = compatibilityNotice + promptInput.displayPrompt;
                promptInput.modelPrompt = compatibilityNotice + promptInput.modelPrompt;
              }
            }
            try {
              if (departmentLease) {
                const observation = deps.observeAttemptTermination?.(request, target);
                termination = observation ? observation.done.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error })) : null;
              }
              invocationIssued = true;
              const execution = await runInvocation(promptInput, target, "subtask", {
                isAborted: () => aborted || continuationSourceChanged(),
                signal: controller.signal,
                lostInvocationSignal: departmentLease ? undefined : lostInvocationAbort.signal,
                onObserve: (read) => { readInvocationEvidence = read; },
                onStarted: () => { invocationStarted = true; runnerStarted = true; invocationStartedAt = now(); },
              });
              if (execution.thrown) executionFailure = execution.error;
              return execution;
            } finally {
              invocationFinished = true;
            }
          } catch (error) { executionFailure = error; throw error; }
        },
      ).catch((error: unknown) => ({ ok: false as const, error }));
      const readOwnerTermination = (): Promise<{ ok: true } | { ok: false; error: unknown }> | null => termination;
      const ownerTermination = readOwnerTermination();
      if (departmentLease && invocationIssued && ownerTermination) {
        const ended = await ownerTermination;
        if (!ended.ok) {
          failCleanup(ended.error);
          const detail = executionFailure === undefined ? undefined : describeLoopSubtaskError(getErrorInfo(executionFailure));
          return { outcome: "failed", detail: detail ?? errorDetail(ended.error) };
        }
      }
      if (ownerResources && departmentLease && invocationIssued && !ownerTermination) {
        const error = new Error("Owner 执行缺少完整清理观察"); failCleanup(error);
        return { outcome: "failed", detail: error.message };
      }
      const rootCleanupError = "cleanupError" in rootResult ? rootResult.cleanupError : undefined;
      if (rootCleanupError !== undefined) {
        failCleanup(rootCleanupError);
        deps.log?.("loop-plus-execution-root-cleanup-failed", {
          taskId: request.taskId,
          subtaskId: request.subtaskId,
          attemptId: request.attemptId,
          error: errorDetail(rootCleanupError),
        });
      }
      if (!rootResult.ok) {
        return { outcome: "failed", detail: [...new Set([executionFailure, rootResult.error].filter((error) => error !== undefined)
          .map((error) => describeLoopSubtaskError(getErrorInfo(error))).filter(Boolean))].join("\n") };
      }
      const invocation = readInvocation(
        rootResult.value.target,
        rootResult.value.boundary,
        rootResult.value.promptInput,
        "subtask",
        request.subtaskId,
        rootResult.value.completedRun,
        rootResult.value.finalHandoff,
        rootResult.value.nativeFinalObserved,
      );
      if (!aborted) {
        persistSession();
      }
      const outcome = resolveAttemptOutcome({
        aborted,
        thrown: rootResult.value.thrown,
        run: invocation.run,
        hasFinalResponse: Boolean(invocation.content?.trim()),
      });
      if (outcome === "completed") {
        return { outcome, detail: invocation.content };
      }
      if (outcome === "stopped") {
        return {
          outcome,
          detail: rootResult.value.thrown ? errorDetail(rootResult.value.error) : "stopped",
        };
      }
      return {
        outcome,
        detail: (!invocation.content?.trim() && invocation.run?.status === "end"
          ? "任务中断，等待主任务重新派发。"
          : undefined)
          ?? (rootResult.value.thrown ? describeLoopSubtaskError(getErrorInfo(rootResult.value.error)) : undefined)
          ?? invocation.run?.failureDetail
          ?? (invocation.run ? "CLI 调用失败，未捕获具体错误。" : "未找到本次 CLI 调用的终态。"),
      };
    }
  }

  function revealStandaloneGroupChat(taskId: string): void {
    const task = deps.readTask(taskId);
    if (task && task.department === undefined && !task.departmentInvalid) {
      deps.revealClarification?.(taskId);
    }
  }

  function host(): ReturnType<typeof createLoopPlusOrchestrationHost> {
    if (!hostInstance) {
      hostInstance = createLoopPlusOrchestrationHost({
        maxConcurrency: deps.maxConcurrency,
        launchDelayMs: deps.launchDelayMs,
        loadedExtensionInstallPath: deps.loadedExtensionInstallPath,
        decisionSubtaskMax: deps.decisionSubtaskMax,
        delay: deps.delay,
        now,
        hasActiveSubtasks: deps.hasActiveSubtasks,
        hasActiveSubtask: deps.hasActiveSubtask,
        readTask: deps.readTask,
        readMainRecoveryTask: deps.readMainRecoveryTask,
        canAutoResumeMain: deps.canAutoResumeMain,
        submitDepartmentCollaboration: (taskId, message) => departmentCollaboration?.(taskId, message) ?? { ok: false, reason: "部门协作入口未安装。" },
        getDepartmentEmployeeCapacity: (rootTaskId, leaderTaskId) => departmentCapacityReader?.(rootTaskId, leaderTaskId) ?? null,
        createTask: (input) => {
          if (!creatingDepartment) deps.assertNewTaskModeAvailable();
          const task = deps.createTask({ ...input, ...(creatingDepartment ? { departmentMetadata: structuredClone(creatingDepartment) } : {}) });
          // The host must atomically persist a complete owned record; never promote a
          // previously published ordinary task by adding metadata afterward.
          if (creatingDepartment && (task.departmentInvalid || JSON.stringify(normalizeDepartmentMetadata(task.department)) !== JSON.stringify(creatingDepartment))) {
            throw new Error("部门完整记录未由受控创建端口持久化");
          }
          if (creatingDepartment && departmentTarget && departmentOwnership) {
            departmentOwnershipTaskId = task.id;
            departmentOwnershipReady = Promise.resolve(departmentOwnership(task.id, departmentTarget));
          }
          rememberRunInput(task.id, input.prompt);
          return deps.readTask(task.id) ?? task;
        },
        updateTask: (taskId, patch) => deps.updateTask(taskId, patch),
        commitOrdinaryRun: deps.commitOrdinaryRun,
        commitConfigLockResume: deps.commitConfigLockResume,
        appendMessage: deps.appendHostMessage,
        removeClarificationResponse: deps.removeClarificationResponse,
        appendCompletionMessages: deps.appendCompletionMessages,
        onTaskCompleted: deps.onTaskCompleted,
        appendSubtaskChat: deps.appendSubtaskChat,
        appendAcceptancePlanChat: deps.appendAcceptancePlanChat,
        appendSupplementalRequirementToCommunication: deps.appendSupplementalRequirementToCommunication,
        recordPause: deps.recordPause,
        runMain,
        startAttempt,
        closeSubtaskTabs: deps.closeSubtaskTabs,
        prepareCommunication: deps.prepareCommunication,
        recordAttempt: (input) => {
          if (!input.communicationFile) {
            return;
          }
          deps.appendAttemptReport(input.communicationFile, [
            "",
            "## Attempt result",
            `- attempt: ${input.attemptId}`,
            `- outcome: ${input.outcome}`,
            input.detail ?? "",
            "",
          ].join("\n"));
        },
        log: deps.log,
        revealClarification: revealStandaloneGroupChat,
        recordInteractionHistory: deps.recordInteractionHistory,
        waitForClarification: deps.waitForClarification,
      });
    }
    return hostInstance;
  }

  async function runEventDriven(
    input: PromptRunInput,
    options: LoopPlusAdapterRunOptions & { configLockRecovery?: ConfigLockResumeRequest } = {},
    target: LoopPlusPromptTarget,
    onTaskOwnershipAcquired?: (taskId: string, target: LoopPlusPromptTarget) => void | Promise<void>,
  ): Promise<boolean> {
    const resumeTaskId = typeof options.resumeTaskId === "string" && options.resumeTaskId.trim()
      ? options.resumeTaskId.trim()
      : null;
    const resumeRequested = options.resumeRequested === true;
    const preserveLoopOrigin = options.preserveLoopOrigin === true;
    const requestedDepartment = options.departmentMetadata === undefined
      ? undefined
      : normalizeDepartmentMetadata(options.departmentMetadata);
    if (options.departmentMetadata !== undefined
      && (!requestedDepartment || requestedDepartment.role !== "leader" || requestedDepartment.parentTaskId === null)) {
      return false;
    }
    let existing = resumeTaskId ? deps.readTask(resumeTaskId) : null;
    const recovery = options.configLockRecovery;
    const originalConfigId = existing?.originProfile?.configId;
    if (recovery && (!existing || !resumeRequested || !preserveLoopOrigin || options.departmentMetadata !== undefined
      || existing.schedulingMode !== "event_driven" || target.cli !== "codex" || !originalConfigId
      || !recovery.isTargetCurrent())) {
      throw new Error(recovery.unavailableMessage);
    }
    if (resolveLoopPlusEntry(existing, options.schedulingMode) !== "event_driven") {
      return false;
    }
    if (deps.isSubtaskConversation(target)) {
      if (recovery) throw new Error(recovery.unavailableMessage);
      deps.appendRefusal(target, "nested");
      return true;
    }
    const targetSessionId = deps.resolveSessionId(target);
    if (existing && shouldBindLoopPlusResumeTarget({
      resumeRequested,
      preserveLoopOrigin,
      sameWorkspace: existing.workspaceKey === deps.activeWorkspaceKey(),
      runtimeTargetDiffers: existing.cli !== target.cli || existing.sessionId !== targetSessionId,
    })) {
      existing = deps.bindResumeTarget(existing.id, target.cli, targetSessionId) ?? existing;
    }
    const refusal = loopPlusResumeRefusal({
      hasExistingTask: Boolean(existing),
      resumeRequested,
      preserveLoopOrigin,
      compatible: existing ? deps.isTaskCompatible(existing, target) : false,
    });
    if (refusal) {
      if (recovery) throw new Error(recovery.unavailableMessage);
      deps.appendRefusal(target, refusal);
      return true;
    }
    const firstMainExecution = recovery && originalConfigId
      ? new FirstLoopMainExecution(target, originalConfigId, recovery.isTargetCurrent, recovery.unavailableMessage, recovery.codexConfigEvidence)
      : undefined;
    let result: ReturnType<ReturnType<typeof host>["tryRun"]>;
    try {
    if (recovery && firstMainExecution) {
      const verify = (preparing?: FirstLoopMainExecution) => {
        const original = recovery.readTask();
        if (!original || original.id !== resumeTaskId || original.workspaceKey !== deps.activeWorkspaceKey()
          || original.cli !== target.cli || !targetSessionId || original.sessionId !== targetSessionId
          || original.originProfile?.configId !== firstMainExecution.configId || !recovery.isTargetCurrent()
          || (executions.get(original.id)?.size ?? 0) > (preparing ? 1 : 0) || cleanupFailures.has(original.id)
          || !host().canAdmitConfigLockResume(original, preparing)) throw new Error(recovery.unavailableMessage);
        return original;
      };
      existing = verify();
      firstMainExecution.readResumeTask = () => verify(firstMainExecution);
      firstMainExecution.resumeRequirements = (task) => continueRequirements(task, input);
    }
    if (existing && resumeRequested && !firstMainExecution) {
      if (!preserveLoopOrigin) {
        const configId = deps.getActiveConfigIdForCli?.(target.cli);
        const modelRouting = loopModelRoutingFromPromptInput(input, { mainCli: target.cli });
        existing = deps.updateTask(existing.id, {
          modelRouting: modelRouting ?? undefined,
          ...(configId ? { originProfile: applyLoopPromptThinkingToOriginProfile({ ...existing.originProfile, configId }, input) } : {}),
          updatedAt: now(),
        }) ?? existing;
      }
      rememberLivePrompt(existing.id, input);
      existing = saveContinueInstruction(existing, input);
    }
    creatingDepartment = requestedDepartment ?? undefined;
    departmentOwnership = onTaskOwnershipAcquired;
    departmentTarget = target;
    result = host().tryRun({
      displayPrompt: input.displayPrompt,
      modelPrompt: input.modelPrompt,
      ...(input.loopPlusAcceptancePlan ? { loopPlusAcceptancePlan: input.loopPlusAcceptancePlan } : {}),
      model: input.model,
      loopMainModel: input.loopMainModel,
      loopSubtaskModel: input.loopSubtaskModel,
      loopSubtaskCli: input.loopSubtaskCli,
      loopSubtaskConfigId: input.loopSubtaskConfigId,
      loopMainThinkingMode: input.loopMainThinkingMode,
      loopSubtaskThinkingMode: input.loopSubtaskThinkingMode,
      loopSubtaskFrontendCli: input.loopSubtaskFrontendCli,
      loopSubtaskFrontendConfigId: input.loopSubtaskFrontendConfigId,
      loopSubtaskFrontendModel: input.loopSubtaskFrontendModel,
      loopSubtaskFrontendThinkingMode: input.loopSubtaskFrontendThinkingMode,
      loopSubtaskFullstackCli: input.loopSubtaskFullstackCli,
      loopSubtaskFullstackConfigId: input.loopSubtaskFullstackConfigId,
      loopSubtaskFullstackModel: input.loopSubtaskFullstackModel,
      loopSubtaskFullstackThinkingMode: input.loopSubtaskFullstackThinkingMode,
      loopSubtaskMode: input.loopSubtaskMode,
    }, target, {
      resumeTaskId,
      resumeRequested,
      ...(typeof options.resumeUserMessage === "string" ? { resumeUserMessage: options.resumeUserMessage } : {}),
      preserveLoopOrigin,
      firstMainExecution,
      schedulingMode: options.schedulingMode,
      sessionId: targetSessionId,
      ...(requestedDepartment && onTaskOwnershipAcquired ? { beforeInitialPump: async (taskId: string) => {
        if (departmentOwnershipTaskId !== taskId || !departmentOwnershipReady) throw new Error("department-owner-setup-not-registered");
        await departmentOwnershipReady;
      } } : {}),
    });
    } finally {
      creatingDepartment = undefined; departmentOwnership = undefined; departmentTarget = undefined;
      departmentOwnershipReady = undefined; departmentOwnershipTaskId = undefined;
    }
    if (options.onResumeSupplementCommitted && (!result.resumeSupplementCommitted || result.taskId !== resumeTaskId)) {
      throw new Error("leader-supplement-delivery-failed");
    }
    if (firstMainExecution) {
      if (!firstMainExecution.claimed) throw new Error(firstMainExecution.unavailableMessage);
      const admission = await firstMainExecution.admission;
      if (admission.kind !== "admitted") {
        await result.done;
        if (admission.kind === "refused") throw admission.error;
        return true;
      }
    }
    if (!resumeTaskId && options.departmentMetadata && result.taskId) {
      const current = deps.readTask(result.taskId);
      if (!current || current.departmentInvalid === true || current.workspaceKey !== deps.activeWorkspaceKey()) {
        host().stopParent(result.taskId);
        return true;
      }
      if (JSON.stringify(normalizeDepartmentMetadata(current.department)) !== JSON.stringify(requestedDepartment)) {
        host().stopParent(result.taskId);
        return true;
      }
    }
    if (result.taskId) {
      rememberLivePrompt(result.taskId, input);
      if (!requestedDepartment) onTaskOwnershipAcquired?.(result.taskId, target);
      revealStandaloneGroupChat(result.taskId);
    }
    if (result.handled) {
      const id = result.taskId;
      const department = usesDepartmentOwner(requestedDepartment ?? existing?.department);
      const fence = async () => {
        if (id && department) {
          if (!deps.closeDepartmentCoordinator) throw new Error("部门协调代次缺少生产封闭端口。");
          await deps.closeDepartmentCoordinator(id);
        }
      };
      const lifecycle = result.done.then(async () => { await fence(); if (id) await waitForTaskIdle(id); }, async (error) => {
        await fence(); throw error;
      });
      if (id) lifecycles.set(id, lifecycle);
      const releaseObservation = () => {
        if (id && lifecycles.get(id) === lifecycle) lifecycles.delete(id);
      };
      void lifecycle.then(releaseObservation, releaseObservation);
      options.onResumeSupplementCommitted?.(lifecycle);
      if (await result.done === "ordinary-paused") return true;
      await lifecycle;
    }
    releaseLivePromptIfCompleted(result.taskId);
    return true;
  }

  function continueRequirements(task: LoopTaskRecord, input: PromptRunInput) {
    return mergeLoopPlusResumeContinueInstruction(
      task.supplementalRequirements,
      input.loopContinuePrompt ?? deps.normalizeContinuePrompt(input.displayPrompt || input.modelPrompt),
      deps.hiddenContinuePrompt(),
    );
  }

  function saveContinueInstruction(task: LoopTaskRecord, input: PromptRunInput): LoopTaskRecord {
    const mergedRequirements = continueRequirements(task, input);
    return mergedRequirements ? deps.updateTask(task.id, {
      supplementalRequirements: mergedRequirements, updatedAt: now(),
    }) ?? task : task;
  }

  return {
    host,
    observeTask: (taskId) => { const done = lifecycles.get(taskId); return done ? { done } : null; },
    observeAttempt: (taskId, subtaskId, attemptId) => {
      const item = attemptHandles.get(JSON.stringify([taskId, attemptId]));
      return item?.subtaskId === subtaskId ? { done: item.done } : null;
    },
    setDepartmentCollaborationHandler: (handler) => { departmentCollaboration = handler; },
    waitForTaskIdle,
    hasTaskExecution: (taskId) => Boolean(executions.get(taskId)?.size) || cleanupFailures.has(taskId),
    setDepartmentExecutionAdmission: (handler) => { departmentExecutionAdmission = handler; },
    setDepartmentEmployeeCapacityReader: (reader) => { departmentCapacityReader = reader; },
    runEventDriven,
    runMain,
    startAttempt,
    getLivePrompt: (taskId) => livePrompts.get(taskId) ?? null,
  };
}

async function closeLoopPlusSubtaskTab(
  deps: LoopPlusRuntimeAdapterDeps,
  request: Pick<LoopPlusAttemptRequest, "taskId" | "round" | "subtaskId" | "attemptId">,
  tabId: string,
  reason: "completed" | "main-abort",
  preparedClose?: () => Promise<void>,
): Promise<void> {
  const closeAttempt = await retryLoopSubtaskTabClose(
    () => preparedClose ? preparedClose() : deps.closeSubtaskTab(tabId),
    (error, attempt, retrying) => deps.log?.("loop-plus-subtask-tab-auto-close-error", {
      taskId: request.taskId,
      round: request.round,
      subtaskId: request.subtaskId,
      attemptId: request.attemptId,
      tabId,
      reason,
      closeAttempt: attempt,
      retrying,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  deps.log?.("loop-plus-subtask-tab-auto-closed", {
    taskId: request.taskId,
    round: request.round,
    subtaskId: request.subtaskId,
    attemptId: request.attemptId,
    tabId,
    reason,
    closeAttempt,
  });
}

function resolveAttemptOutcome(input: {
  aborted: boolean;
  thrown: boolean;
  run: TaskRunRecord | null;
  hasFinalResponse: boolean;
}): LoopPlusAttemptResult["outcome"] {
  if (!input.run) {
    return input.aborted ? "stopped" : "failed";
  }
  return resolveLoopPlusAttemptOutcome({
    aborted: input.aborted,
    thrown: input.thrown,
    runStatus: input.run.status,
    hasFinalResponse: input.hasFinalResponse,
  });
}

function hasUsableInvocationWindow(run: TaskRunRecord): boolean {
  return Number.isFinite(run.startedAt)
    && Number.isFinite(run.endedAt)
    && run.endedAt >= run.startedAt;
}

function isInvocationRun(
  run: TaskRunRecord,
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
): boolean {
  return hasUsableInvocationWindow(run)
    && !boundary.runIds.has(run.id)
    && run.startedAt >= boundary.startedAt
    && run.prompt === query.displayPrompt
    && run.loopTaskId === query.taskId
    && run.loopRound === query.round
    && run.taskRole === query.role
    && (query.attemptId === undefined || run.loopAttemptId === query.attemptId)
    && (query.role !== "subtask" || run.loopSubtaskId === query.subtaskId);
}

function invocationAssistantEarliestAt(boundary: LoopPlusInvocationBoundary, run: TaskRunRecord): number {
  return Math.max(boundary.startedAt, run.startedAt);
}

function isInvocationAssistant(
  message: ChatMessage,
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
  run: TaskRunRecord,
  duplicates: ReadonlySet<string>,
): boolean {
  return message.role === "assistant"
    && !boundary.messageIds.has(message.id)
    && !duplicates.has(message.id)
    && typeof message.createdAt === "number"
    && Number.isFinite(message.createdAt)
    && message.createdAt >= invocationAssistantEarliestAt(boundary, run)
    && message.createdAt <= run.endedAt
    && message.taskRole === query.role
    && (query.attemptId === undefined || message.loopAttemptId === query.attemptId)
    && message.loopTaskId === query.taskId
    && message.loopRound === query.round
    && (query.role !== "subtask" || message.loopSubtaskId === query.subtaskId)
    && (query.role === "main" || Boolean(message.content.trim()));
}

function findInvocationUserAnchor(
  messages: readonly ChatMessage[],
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
  run: TaskRunRecord,
  duplicates: ReadonlySet<string>,
): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isInvocationUserAnchor(message, boundary, query, run, duplicates)) {
      continue;
    }
    return index;
  }
  return null;
}

function isInvocationUserAnchor(
  message: ChatMessage,
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
  run: TaskRunRecord,
  duplicates: ReadonlySet<string>,
): boolean {
  return message.role === "user"
    && !boundary.messageIds.has(message.id)
    && !duplicates.has(message.id)
    && typeof message.createdAt === "number"
    && Number.isFinite(message.createdAt)
    && message.createdAt >= boundary.startedAt
    && message.createdAt <= run.endedAt
    && message.content === query.displayPrompt
    && message.loopTaskId === query.taskId
    && message.taskRole === query.role
    && (query.attemptId === undefined || message.loopAttemptId === query.attemptId)
    && message.loopRound === query.round
    && (query.role !== "subtask" || message.loopSubtaskId === query.subtaskId);
}

function duplicatedMessageIds(messages: readonly ChatMessage[]): Set<string> {
  const counts = new Map<string, number>();
  const duplicates = new Set<string>();
  for (const message of messages) {
    const count = (counts.get(message.id) ?? 0) + 1;
    counts.set(message.id, count);
    if (count > 1) {
      duplicates.add(message.id);
    }
  }
  return duplicates;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
