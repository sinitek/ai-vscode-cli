import { createHash } from "crypto";
import { isDeepStrictEqual } from "util";
import type { FirstLoopMainExecution } from "./promptRunHandoff";
import { RUNTIME_CONFIG_LOCK_TIMEOUT } from "../loopMainFailure";
import { applyLoopModelRoutingToPrompt } from "../loopModelSwitch";
import { buildLoopBlockerDiagnosticFailure } from "../loopBlocker";
import { appendLoopSubtaskFailureEvidence, getLoopSubtaskFailureLines, normalizeLoopSubtaskFailure } from "../loopSubtaskFailure";
import { getLoopSubtaskDisplayTitle } from "../loopConversationPresentation";
import { buildLoopSubtaskExecutionPlan } from "../loopParallel";
import { loopSubtaskAutoCompactions } from "../loopSubtaskAutoCompact";
import {
  buildNextLoopMainAiFailureState,
  buildLoopMainAiFailureSummary,
  buildResetLoopMainAiFailureState,
  isLoopMainAiFailureLimitReached,
} from "../loopMainFailure";
import { getErrorInfo, type ErrorInfo } from "../promptRetry";
import { isNonRetryableCodexThreadError } from "../interactive/codexThreadErrors";
import {
  buildLoopPlusAcceptanceFeedbackSection,
  listLoopPlusAcceptancePlanFeedbackItems,
} from "../loopPlusAcceptancePlan";
import { LOOP_PLUS_ACCEPTANCE_BATCH_MAX, parseLoopPlusDecisionWithFeedback, resolveLoopPlusDecisionSubtaskMax, resolveLoopPlusSubtaskMaxRounds, type LoopPlusControlDecision, type LoopPlusDecision } from "../loopPlusDecision";
import type { LoopPlusNextStepPlan } from "../loopPlusNextStepPlan";
import {
  buildLoopPlusProtocolPauseSummary,
  buildLoopPlusProtocolRepairPrompt,
  LOOP_PLUS_PROTOCOL_PAUSE_HEADING,
  type LoopPlusProtocolRepair,
} from "../loopPlusProtocolRepair";
import {
  ORCHESTRATOR_CLARIFICATION_LIMIT,
  abortOrchestratorClarification,
  formatOrchestratorClarificationAnswer,
  loopClarificationScope,
  waitForOrchestratorClarification,
} from "../orchestratorClarification";
import type { HumanInteractionHistoryRecorder } from "../humanInteraction";
import {
  buildLoopPlusFinishEventId,
  createLoopPlusScheduler,
  requiresLoopPlusAcceptedDependencies,
  type LoopPlusDependencyBlock,
  type LoopPlusControlCommand,
  type LoopPlusExecutionOutcome,
  type LoopPlusExecutionRecord,
  type LoopPlusScheduler,
  type LoopPlusSchedulerOptions,
  type LoopPlusSchedulerSnapshot,
} from "../loopPlusScheduler";
import type { CliName, ThinkingMode } from "../cli/types";
import { formatSubtaskRouteSummary, resolveLoopPlusRoleExecution } from "../subtaskCliRoute";
import { resolveStoredLoopSubtaskMode, type LoopSubtaskMode } from "../loopPlusSubtaskMode";
import type { LoopPlusTaskType } from "../loopTaskStore";
import { normalizeDepartmentMetadata } from "../department";
import { readHumanInteractionTimeoutMs } from "../toolSettings";
import {
  normalizeLoopPlusProgressPercent,
  resolveLoopSchedulingMode,
  type LoopSchedulingMode,
  type LoopSubtaskDecision,
  type LoopSubtaskRecord,
  type LoopTaskRecord,
  type LoopTaskStatus,
} from "../loopTaskStore";
import {
  buildLoopPlusMainModelPrompt,
  buildLoopPlusSubtaskModelPrompt,
  type LoopPlusDepartmentEmployeeCapacitySnapshot,
} from "./loopPlusPromptBuilders";
import type { LoopPlusSubtaskChatNotice } from "./loopPlusSubtaskChat";
import {
  normalizeLoopPlusAcceptancePlanSnapshotForStorage,
  type LoopPlusAcceptancePlanSnapshot,
} from "../loopPlusAcceptancePlan";
import {
  confirmedLoopPlusReviewIds,
  createLoopPlusDecisionStrategyRegistry,
  loopPlusDecisionStrategyFor,
  sameLoopPlusReportIds,
  type LoopPlusDecisionControlPlan,
  type LoopPlusDecisionOutcome,
  type LoopPlusDecisionStrategyPort,
} from "./loopPlusDecisionStrategies";

import { inheritLoopPlusRepairSessions } from "../loopSubtaskSession";
import type { LoopPlusReviewItem } from "../loopPlusScheduler";

const DECISION_SAFETY_LIMIT = 200;
// Each subtask can require dispatch, review and a separate closeout decision.
const MAIN_DECISIONS_PER_SUBTASK_ROUND = 3;
const PROTOCOL_RETRY_LIMIT = 2;
const LOOP_PLUS_ATTEMPT_ROUND = 1;
const LOOP_PLUS_SUBTASK_ROUND_LIMIT_SUMMARY = "Loop+ 子任务轮次不足，请提高“Loop/Loop+ 子任务轮次上限”后继续派发。";

export type LoopPlusPromptTarget = {
  tabId: string;
  cli: LoopTaskRecord["cli"];
  sessionId: string | null;
  loopTaskId?: string;
  loopSubtaskId?: string;
};

export type LoopPlusRunInput = {
  displayPrompt: string;
  modelPrompt?: string;
  /** 启动时确认的验收方案快照，写入任务记录后不再随模板编辑变化。 */
  loopPlusAcceptancePlan?: LoopPlusAcceptancePlanSnapshot;
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopSubtaskCli?: CliName;
  loopSubtaskConfigId?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
  loopSubtaskFrontendCli?: CliName;
  loopSubtaskFrontendConfigId?: string;
  loopSubtaskFrontendModel?: string;
  loopSubtaskFrontendThinkingMode?: ThinkingMode;
  loopSubtaskFullstackCli?: CliName;
  loopSubtaskFullstackConfigId?: string;
  loopSubtaskFullstackModel?: string;
  loopSubtaskFullstackThinkingMode?: ThinkingMode;
  loopSubtaskMode?: import("../loopPlusSubtaskMode").LoopSubtaskMode;
};

export type LoopPlusRunOptions = {
  resumeTaskId?: string | null;
  resumeRequested?: boolean;
  resumeUserMessage?: string;
  preserveLoopOrigin?: boolean;
  schedulingMode?: LoopSchedulingMode;
  sessionId?: string | null;
  firstMainExecution?: FirstLoopMainExecution;
  /** Internal creation fence. New tasks are durable before this resolves, and
   * the scheduler must not pump until trusted ownership setup has completed. */
  beforeInitialPump?: (taskId: string) => Promise<void>;
};

export type LoopPlusRunResult = {
  handled: boolean;
  taskId: string | null;
  done: Promise<void>;
};

export type LoopPlusMainKind = "initial" | "review" | "closeout" | "continue" | "user";

export type LoopPlusMainRequest = {
  taskId: string;
  kind: LoopPlusMainKind;
  prompt: string;
  modelPrompt: string;
  reviewEventId: string | null;
  reviewEventIds?: string[];
  reportEventIds?: string[];
  userMessageCount?: number;
  target: LoopPlusPromptTarget;
  firstMainExecution?: FirstLoopMainExecution;
};

export type LoopPlusMainHandle = {
  promise: Promise<string | null>;
  abort: () => void;
  hasStarted?: () => boolean;
};

export type LoopPlusAttemptRequest = {
  dependsOn?: string[];
  continueFromSubtaskId?: string;
  taskId: string;
  subtaskId: string;
  attemptId: string;
  title: string;
  prompt: string;
  modelPrompt: string;
  writeFiles: string[];
  conflictGroup?: string;
  communicationFile?: string;
  round: number;
  targetCli: LoopPlusPromptTarget["cli"];
  /** 本次实际执行使用的角色配置。general 使用主模型配置，仍是独立子任务。 */
  execution?: {
    role: "backend" | "frontend" | "general";
    configId: string | null;
    model?: string;
    thinkingMode?: ThinkingMode;
  };
};

export type LoopPlusAttemptResult = {
  outcome: LoopPlusExecutionOutcome;
  detail: string | null;
};

export type LoopPlusAttemptAbortOptions = {
  closeTab?: boolean;
};

export type LoopPlusAttemptHandle = {
  promise: Promise<LoopPlusAttemptResult>;
  abort: (options?: LoopPlusAttemptAbortOptions) => void;
  /** Successful report acknowledged and optional session compaction settled. */
  onCompleted?: () => Promise<void>;
  /** 准备和收尾仍算活动；已启动调用则以宿主执行所有权为准。 */
  isActive?: () => boolean;
};

export type LoopPlusOrchestrationDeps = {
  submitDepartmentCollaboration?: (taskId: string, message: unknown) => { ok: boolean; reason?: string };
  maxConcurrency?: number;
  decisionSafetyLimit?: number;
  protocolRetryLimit?: number;
  launchDelayMs?: (lastLaunchAt: number | null, now: number) => number;
  decisionSubtaskMax?: () => number;
  subtaskRoundLimit?: () => number;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
  hasActiveSubtasks?: (taskId: string) => boolean;
  readTask: (taskId: string) => LoopTaskRecord | null;
  /** Read-only live capacity snapshot. Called afresh for each leader main prompt build. */
  getDepartmentEmployeeCapacity?: (
    rootTaskId: string,
    leaderTaskId: string,
  ) => LoopPlusDepartmentEmployeeCapacitySnapshot | null;
  createTask: (input: {
    cli: LoopPlusPromptTarget["cli"];
    rootPrompt: string;
    sessionId: string | null;
    snapshot: LoopPlusSchedulerSnapshot;
    prompt: LoopPlusRunInput;
  }) => LoopTaskRecord;
  updateTask: (taskId: string, patch: Partial<LoopTaskRecord>) => LoopTaskRecord | null;
  commitConfigLockResume?: LoopPlusOrchestrationDeps["updateTask"];
  appendMessage: (target: LoopPlusPromptTarget, message: string, taskId: string) => void;
  appendCompletionMessages?: (target: LoopPlusPromptTarget, task: LoopTaskRecord) => void;
  onTaskCompleted?: (taskId: string) => void;
  runMain: (request: LoopPlusMainRequest) => LoopPlusMainHandle;
  startAttempt: (request: LoopPlusAttemptRequest) => LoopPlusAttemptHandle;
  closeSubtaskTabs?: (taskId: string, subtaskId: string, attemptId?: string) => Promise<void>;
  prepareCommunication?: (task: LoopTaskRecord, subtask: LoopSubtaskRecord, round: number) => string | null;
  recordAttempt?: (input: {
    task: LoopTaskRecord;
    subtaskId: string;
    attemptId: string;
    outcome: LoopPlusExecutionOutcome;
    detail: string | null;
    communicationFile?: string;
  }) => void;
  appendSubtaskChat?: (target: LoopPlusPromptTarget, notice: LoopPlusSubtaskChatNotice) => void;
  appendAcceptancePlanChat?: (taskId: string, section: { heading: string; body: string }) => void;
  recordPause?: (task: LoopTaskRecord, message: string) => void;
  log?: (event: string, payload?: unknown) => void;
  revealClarification?: (taskId: string) => void;
  waitForClarification?: typeof waitForOrchestratorClarification;
  clarificationTimeoutMs?: () => number;
  recordInteractionHistory?: HumanInteractionHistoryRecorder;
};

type ControlPlan = {
  commands: LoopPlusControlCommand[];
  nextSeq: number;
};

type SubtaskMeta = {
  repairSource?: LoopSubtaskRecord["repairSource"];
  decision: LoopSubtaskDecision;
  communicationFile?: string;
  summary?: string;
  executionFailure?: string;
  executionStatus?: LoopSubtaskRecord["status"];
  lastStartedAt?: number;
};

type InFlightAttempt = {
  subtaskId: string;
  attemptId: string;
  abort: (options?: LoopPlusAttemptAbortOptions) => void;
  settled: boolean;
  isActive?: () => boolean;
};

type MainStep = {
  kind: LoopPlusMainKind;
  allowDispatchBeforeReview?: boolean;
  eventId: string | null;
  eventIds: string[];
  reportEventIds: string[];
  userMessageCount: number;
  reviewDependencyBlocks?: LoopPlusDependencyBlock[];
  reviewSelection?: { scheduler: LoopPlusScheduler; seq: number };
};

type Lifecycle = {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
};

type ParentRuntime = {
  taskId: string;
  cli: LoopPlusPromptTarget["cli"];
  target: LoopPlusPromptTarget;
  prompt: LoopPlusRunInput;
  scheduler: LoopPlusScheduler;
  createScheduler: (options: LoopPlusSchedulerOptions) => LoopPlusScheduler;
  meta: Map<string, SubtaskMeta>;
  attempts: Map<string, InFlightAttempt>;
  attemptSeq: number;
  lastLaunchAt: number | null;
  launchChain: Promise<void>;
  consumer: Promise<void> | null;
  autoPaused: boolean;
  pauseStatus: Extract<LoopTaskStatus, "needs-review" | "error">;
  stopRequested: boolean;
  stopping: boolean;
  initialPromptDone: boolean;
  forcePrompt: boolean;
  closeoutBudget: number;
  decisionCount: number;
  protocolRetries: number;
  protocolRepair: LoopPlusProtocolRepair | null;
  currentMain: LoopPlusMainHandle | null;
  currentMainRequest: LoopPlusMainRequest | null;
  currentMainStep: MainStep | null;
  preparingMain?: FirstLoopMainExecution;
  /** 未确认批次的请求快照；重试和暂停恢复不得混入后到事件或消息。 */
  reviewStep: MainStep | null;
  /** 宿主重建前已经存在的事件按冻结批次恢复，不重新开放派发优先机会。 */
  recoveredReviewEventIds: Set<string>;
  launching: Set<string>;
  launchEpoch: Map<string, number>;
  mainGeneration: number;
  /** 群聊修改验收方案时递增；进行中的验收据此丢弃旧提示并重问。 */
  acceptancePlanEpoch: number;
  pumpRequested: boolean;
  /** Consumer parked on review dependencies; a real wake invalidates this observation. */
  waitingForReviewDependencies: boolean;
  recoveringWait: boolean;
  released: boolean;
  decomposing: boolean;
  completionPatch: Partial<LoopTaskRecord> | null;
  lifecycle: Lifecycle;
};

export function resolveLoopPlusEntry(
  existing: { schedulingMode?: unknown } | null | undefined,
  requested: unknown,
): "event_driven" | "classic" {
  if (existing) {
    return resolveLoopSchedulingMode(existing.schedulingMode) === "event_driven"
      ? "event_driven"
      : "classic";
  }
  return requested === "event_driven" ? "event_driven" : "classic";
}

export function createLoopPlusOrchestrationHost(deps: LoopPlusOrchestrationDeps) {
  function updateTask(taskId: string, patch: Partial<LoopTaskRecord>, configLockResume = false): LoopTaskRecord {
    const write = configLockResume ? deps.commitConfigLockResume ?? deps.updateTask : deps.updateTask;
    const updated = write(taskId, patch);
    if (!updated) {
      throw new Error(`Loop+ task update did not commit: ${taskId}`);
    }
    return updated;
  }

  const runtimes = new Map<string, ParentRuntime>();
  const interruptedSubtaskResumeRequests = new Set<string>();
  const protocolRetryLimit = deps.protocolRetryLimit ?? PROTOCOL_RETRY_LIMIT;
  const decisionStrategies = createLoopPlusDecisionStrategyRegistry();
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const launchDelayMs = deps.launchDelayMs ?? (() => 0);
  const decisionSubtaskMax = () => resolveLoopPlusDecisionSubtaskMax(deps.decisionSubtaskMax?.());
  const maxConcurrency = () => deps.maxConcurrency ?? decisionSubtaskMax();
  const configuredSubtaskRoundLimit = () => resolveLoopPlusSubtaskMaxRounds(
    deps.subtaskRoundLimit?.(),
  );

  function tryRun(input: LoopPlusRunInput, target: LoopPlusPromptTarget, options: LoopPlusRunOptions = {}): LoopPlusRunResult {
    const resumeTaskId = normalizeId(options.resumeTaskId);
    const existing = resumeTaskId ? deps.readTask(resumeTaskId) : null;
    if (resolveLoopPlusEntry(existing, options.schedulingMode) !== "event_driven") {
      return { handled: false, taskId: null, done: Promise.resolve() };
    }
    if (existing) {
      const invalid = invalidSnapshotReason(existing);
      if (invalid) {
        if (!options.firstMainExecution) rejectSnapshot(existing, invalid);
        return { handled: true, taskId: existing.id, done: Promise.resolve() };
      }
      const runtime = ensureRuntime(existing, target, input, Boolean(options.firstMainExecution));
      if (options.firstMainExecution) {
        const execution = options.firstMainExecution;
        pump(runtime, execution, options.resumeUserMessage);
        const preparingConsumer = runtime.consumer;
        return { handled: true, taskId: runtime.taskId, done: execution.admission.then(({ kind }) =>
          kind === "admitted" ? runtime.lifecycle.promise : preparingConsumer ?? undefined) };
      }
      if (runtime.scheduler.snapshot().completed) {
        if (runtime.completionPatch) {
          try {
            persist(runtime, runtime.completionPatch);
            runtime.completionPatch = null;
          } catch (error) {
            deps.log?.("loop-plus-persist-failed", {
              taskId: runtime.taskId,
              error: errorText(error),
            });
            settle(runtime);
            return { handled: true, taskId: runtime.taskId, done: runtime.lifecycle.promise };
          }
          try {
            deps.appendMessage(runtime.target, "loop-plus-completed", runtime.taskId);
          } catch (error) {
            deps.log?.("loop-plus-completion-message-failed", {
              taskId: runtime.taskId,
              error: errorText(error),
            });
          }
          appendCompletionMessages(runtime);
          notifyTaskCompleted(runtime);
        }
        const done = runtime.lifecycle.promise;
        releaseCompleted(runtime);
        return { handled: true, taskId: runtime.taskId, done };
      }
      if (options.resumeRequested === true) {
        if (typeof options.resumeUserMessage === "string" && options.resumeUserMessage.trim()) {
          runtime.scheduler.enqueueUserMessage(options.resumeUserMessage.trim());
        }
        continueExplicitly(runtime);
        if (interruptedSubtaskResumeRequests.has(runtime.taskId)) {
          resumeInterruptedSubtasks(runtime.taskId);
        }
      } else if (!runtime.lifecycle.settled) {
        if (
          runtime.autoPaused
          && !runtime.stopRequested
          && !runtime.scheduler.snapshot().parentStopped
          && runtime.scheduler.snapshot().running.length === 0
        ) {
          settle(runtime);
        } else {
          pump(runtime);
        }
      }
      return { handled: true, taskId: runtime.taskId, done: runtime.lifecycle.promise };
    }
    if (options.resumeRequested === true && options.preserveLoopOrigin === true) {
      return { handled: false, taskId: null, done: Promise.resolve() };
    }
    const created = createParent(input, target, options.sessionId ?? target.sessionId);
    if (options.beforeInitialPump) {
      let readiness: Promise<void>;
      try { readiness = Promise.resolve(options.beforeInitialPump(created.taskId)); }
      catch (error) { readiness = Promise.reject(error); }
      void readiness.then(() => {
        if (!created.released && !created.scheduler.snapshot().parentStopped) pump(created);
      }, error => {
        created.decomposing = false;
        created.scheduler.stopParent();
        try {
          persist(created, { status: "error", finalSummary: `Loop+ 执行所有权初始化失败：${errorText(error)}` });
        } catch (persistError) {
          deps.log?.("loop-plus-initial-ownership-persist-failed", { taskId: created.taskId, error: errorText(persistError) });
        }
        deps.log?.("loop-plus-initial-ownership-failed", { taskId: created.taskId, error: errorText(error) });
        settle(created);
      });
    } else {
      pump(created);
    }
    return { handled: true, taskId: created.taskId, done: created.lifecycle.promise };
  }

  function stopParent(taskId: string): void {
    const normalized = normalizeId(taskId);
    if (!normalized) {
      return;
    }
    const runtime = runtimes.get(normalized);
    if (!runtime) {
      const task = deps.readTask(normalized);
      if (!task || resolveLoopSchedulingMode(task.schedulingMode) !== "event_driven") {
        return;
      }
      const invalid = invalidSnapshotReason(task);
      if (invalid) {
        rejectSnapshot(task, invalid);
        return;
      }
      const scheduler = createLoopPlusScheduler({ snapshot: task.loopPlus });
      const stopped = scheduler.stopParent();
      if (!stopped.stopped) {
        return;
      }
      updateTask(task.id, {
        status: "stopped",
        runtimeInterrupted: undefined,
        loopPlusNextStepPlan: undefined,
        schedulingMode: "event_driven",
        loopPlus: scheduler.snapshot(),
        updatedAt: now(),
      });
      return;
    }
    stopRuntime(runtime);
  }

  function notifySubtaskContinuation(
    taskId: string,
    subtaskId: string,
    outcome: LoopPlusExecutionOutcome,
    detail?: string | null,
    recovery?: { target: LoopPlusPromptTarget; input: LoopPlusRunInput },
    onCompleted?: () => Promise<void>,
    attemptId?: string,
  ): boolean {
    let runtime = runtimes.get(taskId);
    if (!runtime && recovery) {
      const task = deps.readTask(taskId);
      if (!task || task.schedulingMode !== "event_driven"
        || (task.status !== "running" && !(task.status === "stopped" && task.runtimeInterrupted === true))
        || isLoopMainAiFailureLimitReached(task)) {
        return false;
      }
      const invalid = invalidSnapshotReason(task);
      if (invalid) {
        rejectSnapshot(task, invalid);
        return false;
      }
      const snapshot = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
      const openAttempt = snapshot.running.find((item) => item.subtaskId === subtaskId);
      if (snapshot.completed || snapshot.parentStopped || !openAttempt
        || (attemptId !== undefined && openAttempt.attemptId !== attemptId)) {
        return false;
      }
      // The old host's runners no longer belong to this controller. Keep every
      // other reservation open for manual continuation instead of emitting a
      // synthetic stopped result and allowing the parent to finish without it.
      const runningIds = new Set(snapshot.running.map((item) => item.subtaskId));
      const recovered: LoopTaskRecord = {
        ...task,
        status: "running",
        runtimeInterrupted: undefined,
        subTasks: task.subTasks.map((item) => runningIds.has(item.id)
          ? { ...item, status: "blocked", updatedAt: now() }
          : item),
        updatedAt: now(),
      };
      runtime = ensureRuntime(recovered, recovery.target, recovery.input);
      persist(runtime, { status: "running", runtimeInterrupted: undefined });
    }
    if (!runtime || runtime.released || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
      return false;
    }
    const running = runtime.scheduler.snapshot().running.find((item) => item.subtaskId === subtaskId);
    if (!running || (attemptId !== undefined && running.attemptId !== attemptId)) {
      return false;
    }
    const inFlight = runtime.attempts.get(running.attemptId);
    if (inFlight && !inFlight.settled) {
      return false;
    }
    applyFinish(runtime, {
      subtaskId: running.subtaskId,
      attemptId: running.attemptId,
      outcome,
      detail: detail ?? null,
      onCompleted,
    });
    const snapshot = runtime.scheduler.snapshot();
    return !runtime.autoPaused && !snapshot.running.some((item) => item.attemptId === running.attemptId);
  }

  function hasController(taskId: string): boolean {
    return runtimes.has(taskId);
  }

  function collectRunningTaskIds(): string[] {
    return [...runtimes.values()].filter((runtime) => !runtime.released && !runtime.autoPaused
      && !runtime.stopRequested && !runtime.scheduler.snapshot().completed
      && !runtime.scheduler.snapshot().parentStopped).map((runtime) => runtime.taskId);
  }

  function checkWaitingTasks(): void {
    for (const runtime of runtimes.values()) {
      try {
        const snapshot = runtime.scheduler.snapshot();
        const task = deps.readTask(runtime.taskId);
        if (!task || task.status !== "running" || task.pendingClarification || isLoopMainAiFailureLimitReached(task)
          || runtime.released || runtime.autoPaused || runtime.stopRequested || runtime.stopping
          || snapshot.completed || snapshot.parentStopped || runtime.currentMain || runtime.consumer
          || runtime.launching.size > 0 || deps.hasActiveSubtasks?.(runtime.taskId)) continue;
        if (snapshot.running.some((record) => {
          const attempt = runtime.attempts.get(record.attemptId);
          return attempt && !attempt.settled && (attempt.isActive?.() ?? true);
        })) continue;
        runtime.recoveringWait = true;
        let changed = snapshot.running.length === 0;
        try {
          for (const record of snapshot.running) {
            const meta = runtime.meta.get(record.subtaskId);
            if (meta) {
              if (parkInterruptedAttempt(runtime, record, meta)) changed = true;
              continue;
            }
            changed = true;
            discardLostAttempt(runtime, record);
            safeApplyFinish(runtime, {
              subtaskId: record.subtaskId,
              attemptId: record.attemptId,
              outcome: "failed",
              detail: "定时检查发现子任务已无执行进程或完成回报，现有产物需要主任务验收，不能视为成功。",
            });
          }
        } finally {
          runtime.recoveringWait = false;
        }
        if (!changed || runtime.autoPaused || runtime.stopRequested || runtime.released) continue;
        promotePendingAndLaunch(runtime);
        const current = runtime.scheduler.snapshot();
        if (current.running.length === 0 && current.pending.length === 0) {
          runtime.closeoutBudget = Math.max(runtime.closeoutBudget, 1);
        }
        persist(runtime);
        deps.log?.("loop-plus-wait-watchdog-recovered", { taskId: runtime.taskId, lostAttempts: snapshot.running.length });
        if (hasReview(runtime) || hasReports(runtime) || hasUserMessages(runtime) || runtime.closeoutBudget > 0 || isDependencyBlocked(runtime)) requestPump(runtime);
      } catch (error) {
        deps.log?.("loop-plus-wait-watchdog-check-failed", { taskId: runtime.taskId, error: errorText(error) });
      }
    }
  }

  function reportAttempt(
    taskId: string,
    input: { subtaskId: string; attemptId: string; outcome: LoopPlusExecutionOutcome; detail?: string | null },
  ): void {
    const runtime = runtimes.get(taskId);
    if (!runtime || runtime.released || runtime.scheduler.snapshot().completed) {
      return;
    }
    applyFinish(runtime, {
      subtaskId: input.subtaskId,
      attemptId: input.attemptId,
      outcome: input.outcome,
      detail: input.detail ?? null,
    });
  }

  function createParent(input: LoopPlusRunInput, target: LoopPlusPromptTarget, sessionId: string | null): ParentRuntime {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: maxConcurrency() });
    const task = deps.createTask({
      cli: target.cli,
      rootPrompt: input.displayPrompt,
      sessionId,
      snapshot: scheduler.snapshot(),
      prompt: input,
    });
    const runtime = buildRuntime(task, target, input, scheduler);
    runtime.decomposing = true;
    runtimes.set(task.id, runtime);
    persist(runtime, { loopPlusProgressPercent: 0 });
    deps.appendMessage(target, "loop-plus-started", task.id);
    deps.log?.("loop-plus-started", { taskId: task.id });
    return runtime;
  }

  function ensureRuntime(task: LoopTaskRecord, target: LoopPlusPromptTarget, input: LoopPlusRunInput, preparingResume = false): ParentRuntime {
    const existing = runtimes.get(task.id);
    if (existing) {
      existing.target = target;
      existing.prompt = input;
      existing.scheduler = existing.createScheduler({
        snapshot: existing.scheduler.snapshot(),
        maxConcurrency: maxConcurrency(),
      });
      return existing;
    }
    const scheduler = createLoopPlusScheduler({
      snapshot: task.loopPlus,
      maxConcurrency: maxConcurrency(),
      requireAcceptedDependencies: requiresLoopPlusAcceptedDependencies(task),
    });
    const runtime = buildRuntime(task, target, input, scheduler);
    if (!scheduler.snapshot().parentStopped) {
      scheduler.snapshot().running.forEach((attempt) => {
        const meta = runtime.meta.get(attempt.subtaskId);
        if (meta) meta.executionStatus = "blocked";
      });
    }
    runtime.initialPromptDone = scheduler.snapshot().seenAttempts.length > 0
      || scheduler.snapshot().running.length > 0
      || scheduler.snapshot().pending.length > 0
      || scheduler.snapshot().reviewQueue.length > 0
      || scheduler.snapshot().currentReview !== null;
    runtime.decomposing = !runtime.initialPromptDone
      && task.status === "running"
      && !runtime.autoPaused
      && !runtime.stopRequested
      && !scheduler.snapshot().completed
      && !scheduler.snapshot().parentStopped;
    runtimes.set(task.id, runtime);
    if (!preparingResume && ((task.loopPlusMainPhase === "decomposing") !== runtime.decomposing || scheduler.snapshot().running.length > 0)) {
      persist(runtime);
    }
    return runtime;
  }

  function buildRuntime(
    task: LoopTaskRecord,
    target: LoopPlusPromptTarget,
    input: LoopPlusRunInput,
    scheduler: LoopPlusScheduler,
  ): ParentRuntime {
    const snapshot = scheduler.snapshot();
    const meta = new Map<string, SubtaskMeta>();
    const latestDependencies = new Map(snapshot.seenAttempts.map((item) => [item.subtaskId, item.dependsOn ?? []]));
    task.subTasks.forEach((subtask) => {
      meta.set(subtask.id, {
        decision: {
          id: subtask.id,
          title: subtask.title,
          prompt: subtask.prompt ?? subtask.title,
          continueFromSubtaskId: subtask.continueFromSubtaskId,
          conflictGroup: subtask.conflictGroup,
          writeFiles: subtask.writeFiles,
          taskType: subtask.taskType,
          codingDelivery: subtask.codingDelivery,
          requiresAcceptance: subtask.requiresAcceptance,
          dependsOn: [...(latestDependencies.get(subtask.id) ?? subtask.dependsOn ?? [])],
        },
        communicationFile: subtask.communicationFile,
        summary: subtask.summary,
        executionFailure: subtask.executionFailure,
        executionStatus: subtask.status,
        ...(typeof subtask.lastStartedAt === "number" && Number.isFinite(subtask.lastStartedAt)
          ? { lastStartedAt: subtask.lastStartedAt }
          : {}),
      });
    });
    const requireAcceptedDependencies = requiresLoopPlusAcceptedDependencies(task);
    return {
      taskId: task.id,
      cli: task.cli,
      target,
      prompt: input,
      scheduler,
      createScheduler: (options) => createLoopPlusScheduler({ ...options, requireAcceptedDependencies }),
      meta,
      attempts: new Map(),
      attemptSeq: nextAttemptSequence(scheduler.snapshot()),
      lastLaunchAt: null,
      launchChain: Promise.resolve(),
      consumer: null,
      autoPaused: task.status === "needs-review" || task.status === "error",
      pauseStatus: task.status === "error" ? "error" : "needs-review",
      stopRequested: scheduler.snapshot().parentStopped,
      stopping: false,
      initialPromptDone: false,
      forcePrompt: false,
      closeoutBudget: 0,
      decisionCount: 0,
      protocolRetries: 0,
      protocolRepair: null,
      currentMain: null,
      currentMainRequest: null,
      currentMainStep: null,
      reviewStep: null,
      recoveredReviewEventIds: new Set(snapshot.currentReview
        ? [snapshot.currentReview, ...snapshot.reviewQueue]
          .slice(0, LOOP_PLUS_ACCEPTANCE_BATCH_MAX)
          .map((item) => item.eventId)
        : []),
      launching: new Set<string>(),
      launchEpoch: new Map(),
      mainGeneration: 0,
      acceptancePlanEpoch: 0,
      pumpRequested: false,
      waitingForReviewDependencies: false,
      recoveringWait: false,
      released: false,
      decomposing: false,
      completionPatch: null,
      lifecycle: createLifecycle(),
    };
  }

  function canAdmitConfigLockResume(task: LoopTaskRecord, execution?: FirstLoopMainExecution): boolean {
    const runtime = runtimes.get(task.id);
    if (!runtime) return !execution;
    return !runtime.released && runtime.autoPaused && !runtime.stopRequested && !runtime.recoveringWait
      && (execution ? runtime.preparingMain === execution : !runtime.consumer && !runtime.currentMain)
      && isDeepStrictEqual(runtime.scheduler.snapshot(), createLoopPlusScheduler({
        snapshot: task.loopPlus, maxConcurrency: runtime.scheduler.snapshot().maxConcurrency,
      }).snapshot());
  }

  function continueExplicitly(runtime: ParentRuntime): void {
    if (runtime.released || runtime.scheduler.snapshot().completed) {
      releaseCompleted(runtime);
      return;
    }
    if (runtime.scheduler.snapshot().parentStopped || runtime.stopRequested) {
      const pausedBefore = runtime.autoPaused;
      reconcileLostRunning(runtime);
      if (!pausedBefore && runtime.autoPaused) {
        settle(runtime);
        return;
      }
      if (runtime.scheduler.snapshot().running.length > 0) {
        try {
          persist(runtime, { status: "stopped" });
        } catch (error) {
          deps.log?.("loop-plus-persist-failed", {
            taskId: runtime.taskId,
            error: errorText(error),
          });
        }
        try {
          deps.appendMessage(runtime.target, "loop-plus-resume-blocked", runtime.taskId);
        } catch (error) {
          deps.log?.("loop-plus-resume-blocked-failed", {
            taskId: runtime.taskId,
            error: errorText(error),
          });
        }
        settle(runtime);
        return;
      }
    }
    runtime.autoPaused = false;
    runtime.protocolRetries = 0;
    runtime.decisionCount = 0;
    runtime.forcePrompt = false;
    armLifecycle(runtime);
    const task = deps.readTask(runtime.taskId);
    if (task?.finalSummary?.startsWith(LOOP_PLUS_PROTOCOL_PAUSE_HEADING)) {
      // A reloaded host can recover the reason even though the rejected response is ephemeral.
      runtime.protocolRepair ??= { reason: task.finalSummary, response: null };
      updateTask(runtime.taskId, { finalSummary: undefined });
    }
    if (task?.loopPlusBlockReview) {
      updateTask(runtime.taskId, { loopPlusBlockReview: undefined });
    }
    if (task && (task.mainAiFailureCount || isLoopMainAiFailureLimitReached(task))) {
      updateTask(runtime.taskId, {
        ...buildResetLoopMainAiFailureState(),
        mainAiLastFailureCode: undefined,
        finalSummary: undefined,
        status: "running",
        schedulingMode: "event_driven",
        updatedAt: now(),
      });
    }
    if (runtime.scheduler.snapshot().parentStopped || runtime.stopRequested) {
      const before = runtime.scheduler.snapshot();
      const resumed = runtime.scheduler.resumeParent();
      persistResumeTransition(runtime, before, resumed.ok ? "running" : "stopped");
      runtime.stopRequested = false;
      launchAll(runtime, resumed.started);
      deps.appendMessage(runtime.target, "loop-plus-resumed", runtime.taskId);
      if (resumed.ok && isIdle(runtime)) {
        runtime.forcePrompt = true;
      }
      if (resumed.wake || hasReview(runtime) || hasReports(runtime) || runtime.forcePrompt || isDependencyBlocked(runtime)) {
        requestPump(runtime);
      }
      return;
    }
    reconcileLostRunning(runtime);
    if (runtime.autoPaused || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped) {
      return;
    }
    const before = runtime.scheduler.snapshot();
    const promoted = runtime.scheduler.promotePending();
    if (runtime.autoPaused || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped) {
      return;
    }
    persistResumeTransition(runtime, before, "running");
    runtime.forcePrompt = isIdle(runtime);
    launchAll(runtime, promoted.started);
    deps.appendMessage(runtime.target, "loop-plus-resumed", runtime.taskId);
    requestPump(runtime);
  }

  function persistResumeTransition(
    runtime: ParentRuntime,
    before: LoopPlusSchedulerSnapshot,
    status: "running" | "stopped",
  ): void {
    try {
      persist(runtime, { status, runtimeInterrupted: undefined });
    } catch (error) {
      // These reservations have not launched. Preserve pending attempts and the
      // parent gate instead of later reconciling them as lost running processes.
      // The snapshot is taken after reconciliation, retaining earlier finishes.
      runtime.scheduler = runtime.createScheduler({ snapshot: before });
      runtime.autoPaused = true;
      runtime.pauseStatus = "error";
      runtime.forcePrompt = false;
      settle(runtime);
      throw error;
    }
  }

  function isIdle(runtime: ParentRuntime): boolean {
    const snapshot = runtime.scheduler.snapshot();
    return !snapshot.completed
      && !snapshot.parentStopped
      && !runtime.stopRequested
      && !hasReview(runtime)
      && snapshot.running.length === 0
      && snapshot.pending.length === 0;
  }

  function resumeInterruptedSubtasks(taskId: string): boolean {
    const runtime = runtimes.get(taskId);
    if (!runtime || runtime.autoPaused || runtime.stopRequested || runtime.released
      || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
      if (deps.readTask(taskId)?.schedulingMode === "event_driven") interruptedSubtaskResumeRequests.add(taskId);
      return false;
    }
    interruptedSubtaskResumeRequests.delete(taskId);
    const restarted = relaunchInterruptedSubtasks(runtime);
    if (restarted) requestPump(runtime);
    return restarted;
  }

  function relaunchInterruptedSubtasks(runtime: ParentRuntime): boolean {
    const interrupted = runtime.scheduler.snapshot().running.filter((record) => {
      const meta = runtime.meta.get(record.subtaskId);
      if (!meta || runtime.launching.has(record.attemptId)) return false;
      const attempt = runtime.attempts.get(record.attemptId);
      if (attempt && !attempt.settled) return false;
      if (meta.executionStatus !== "blocked") return false;
      return true;
    });
    interrupted.forEach((record) => runtime.attempts.delete(record.attemptId));
    launchAll(runtime, interrupted);
    return interrupted.length > 0;
  }

  function parkInterruptedAttempt(runtime: ParentRuntime, record: LoopPlusExecutionRecord, meta: SubtaskMeta): boolean {
    const changed = meta.executionStatus !== "blocked";
    discardLostAttempt(runtime, record);
    meta.executionStatus = "blocked";
    return changed;
  }

  function discardLostAttempt(runtime: ParentRuntime, record: LoopPlusExecutionRecord): void {
    const attempt = runtime.attempts.get(record.attemptId);
    if (!attempt || attempt.settled) return;
    attempt.settled = true;
    try {
      attempt.abort();
    } catch (error) {
      deps.log?.("loop-plus-wait-watchdog-abort-failed", { taskId: runtime.taskId, attemptId: record.attemptId, error: errorText(error) });
    }
  }

  function reconcileLostRunning(runtime: ParentRuntime): void {
    const parentStopping = runtime.stopRequested || runtime.scheduler.snapshot().parentStopped;
    const running = runtime.scheduler.snapshot().running.slice();
    running.forEach((record) => {
      const inFlight = runtime.attempts.get(record.attemptId);
      if (inFlight && !inFlight.settled) {
        return;
      }
      if (!parentStopping && runtime.meta.get(record.subtaskId)?.executionStatus === "blocked") {
        return;
      }
      if (runtime.launching.has(record.attemptId) && !parentStopping) {
        return;
      }
      applyFinish(runtime, {
        subtaskId: record.subtaskId,
        attemptId: record.attemptId,
        outcome: "stopped",
        detail: "lost-process",
      });
    });
  }

  function stopRuntime(runtime: ParentRuntime): void {
    if (runtime.stopping || runtime.scheduler.snapshot().completed) {
      return;
    }
    runtime.stopping = true;
    runtime.stopRequested = true;
    runtime.autoPaused = false;
    runtime.decomposing = false;
    runtime.mainGeneration += 1;
    runtime.scheduler.stopParent();
    abortOrchestratorClarification(loopClarificationScope(runtime.taskId));
    const main = runtime.currentMain;
    runtime.currentMain = null;
    runtime.currentMainRequest = null;
    runtime.currentMainStep = null;
    main?.abort();
    Array.from(runtime.attempts.values()).forEach((attempt) => {
      if (!attempt.settled) {
        attempt.abort();
      }
    });
    try {
      persist(runtime, {
        status: "stopped",
        runtimeInterrupted: undefined,
        loopPlusNextStepPlan: undefined,
        finalSummary: "Loop+ parent scheduling is stopped.",
        pendingClarification: undefined,
      });
    } catch (error) {
      deps.log?.("loop-plus-persist-failed", { taskId: runtime.taskId, error: errorText(error) });
    } finally {
      runtime.stopping = false;
      settle(runtime);
    }
    deps.appendMessage(runtime.target, "loop-plus-stopped", runtime.taskId);
    deps.log?.("loop-plus-stopped", { taskId: runtime.taskId });
  }

  function rejectSnapshot(task: LoopTaskRecord, reason: string): void {
    updateTask(task.id, {
      status: "error",
      schedulingMode: "event_driven",
      finalSummary: `Loop+ event_driven snapshot is ${reason} and was not downgraded to classic Loop or cleared.`,
      updatedAt: now(),
    });
    deps.log?.("loop-plus-snapshot-rejected", { taskId: task.id, reason });
  }

  function requestPump(runtime: ParentRuntime): void {
    runtime.waitingForReviewDependencies = false;
    if (runtime.consumer) {
      runtime.pumpRequested = true;
      return;
    }
    pump(runtime);
  }

  function pump(runtime: ParentRuntime, firstMainExecution?: FirstLoopMainExecution, resumeUserMessage?: string): void {
    if (runtime.released || runtime.consumer || runtime.recoveringWait || (runtime.autoPaused && !firstMainExecution) || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
      return;
    }
    runtime.pumpRequested = false;
    runtime.preparingMain = firstMainExecution;
    let ownedLifecycle = runtime.lifecycle;
    const consumer: Promise<void> = runConsumer(runtime, () => {
      ownedLifecycle = runtime.lifecycle;
    }, firstMainExecution, resumeUserMessage).catch((error: unknown) => {
      deps.log?.("loop-plus-consumer-failed", {
        taskId: runtime.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      if ((!firstMainExecution || firstMainExecution.admitted) && runtime.lifecycle === ownedLifecycle
        && !ownedLifecycle.settled && !runtime.scheduler.snapshot().completed) {
        pause(runtime, "error", "loop-plus-consumer-failed");
      }
    }).finally(() => {
      if (runtime.consumer !== consumer) {
        return;
      }
      runtime.consumer = null;
      runtime.preparingMain = undefined;
      const followUp = runtime.pumpRequested || runtime.forcePrompt;
      runtime.pumpRequested = false;
      if (!followUp || runtime.autoPaused || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
        return;
      }
      pump(runtime);
    });
    runtime.consumer = consumer;
  }

  async function runConsumer(runtime: ParentRuntime, adoptCommittedLifecycle: () => void, firstMainExecution?: FirstLoopMainExecution, resumeUserMessage?: string): Promise<void> {
    while ((firstMainExecution || !runtime.autoPaused) && !runtime.stopRequested && !runtime.scheduler.snapshot().parentStopped) {
      const decisionSafetyLimit = firstMainExecution ? Infinity : deps.decisionSafetyLimit ?? Math.max(
        DECISION_SAFETY_LIMIT,
        Math.max(subtaskRoundLimitFor(runtime), runtime.scheduler.snapshot().seenAttempts.length) * MAIN_DECISIONS_PER_SUBTASK_ROUND,
      );
      if (runtime.decisionCount >= decisionSafetyLimit) {
        pause(runtime, "needs-review", "loop-plus-safety-limit");
        return;
      }
      const execution = firstMainExecution;
      firstMainExecution = undefined;
      let step = execution ? null : planStep(runtime);
      if (!step && !execution) return;
      const generation = runtime.mainGeneration;
      const acceptancePlanEpoch = runtime.acceptancePlanEpoch;
      const request = step ? buildMainRequest(runtime, step) : {
        taskId: runtime.taskId, kind: "continue" as const, target: runtime.target,
        prompt: runtime.prompt.displayPrompt, modelPrompt: runtime.prompt.modelPrompt ?? runtime.prompt.displayPrompt,
        reviewEventId: null, firstMainExecution: execution,
      };
      if (execution) {
        execution.prepareMain = (task) => {
          const draft: ParentRuntime = {
            ...runtime,
            scheduler: runtime.createScheduler({ snapshot: task.loopPlus, maxConcurrency: maxConcurrency() }),
            autoPaused: false,
            protocolRetries: 0,
            decisionCount: 1,
            forcePrompt: true,
          };
          const message = resumeUserMessage?.trim();
          if (message) draft.scheduler.enqueueUserMessage(message);
          const promoted = draft.scheduler.promotePending();
          const preparedStep = planStep(draft, task);
          if (!preparedStep) throw new Error(execution.unavailableMessage);
          const patch: Partial<LoopTaskRecord> = {
            ...buildResetLoopMainAiFailureState(),
            mainAiLastFailureCode: undefined,
            finalSummary: undefined,
            loopPlusBlockReview: undefined,
            runtimeInterrupted: undefined,
            status: "running",
            loopPlusSubtaskMaxRounds: configuredSubtaskRoundLimit(),
            supplementalRequirements: execution.resumeRequirements?.(task) ?? task.supplementalRequirements,
          };
          const projectedTask = { ...task, ...patch };
          const preparedRequest = buildMainRequest(draft, preparedStep, projectedTask);
          const persistedPatch = buildPersistencePatch(draft, task, patch);
          return {
            displayPrompt: preparedRequest.prompt,
            modelPrompt: preparedRequest.modelPrompt,
            commit: () => {
              updateTask(runtime.taskId, persistedPatch, true);
              armLifecycle(draft);
              Object.assign(request, preparedRequest);
              Object.assign(runtime, draft, { currentMainRequest: request, currentMainStep: preparedStep });
              adoptCommittedLifecycle();
              step = preparedStep;
            },
            afterSend: () => {
              launchAll(runtime, promoted.started);
              deps.appendMessage(runtime.target, "loop-plus-resumed", runtime.taskId);
              if (preparedStep.kind === "user") deps.appendMessage(runtime.target, "loop-plus-user-messages", runtime.taskId);
            },
          };
        };
      } else {
        runtime.decisionCount += 1;
      }
      let handle: LoopPlusMainHandle | null = null;
      let content: string | null = null;
      let failed = false;
      let failureMessage = "";
      let failureInfo: ErrorInfo | undefined;
      try {
        if (step?.kind === "user") {
          deps.appendMessage(runtime.target, "loop-plus-user-messages", runtime.taskId);
        }
        handle = deps.runMain(request);
        runtime.currentMainRequest = request;
        runtime.currentMainStep = step;
        runtime.currentMain = handle;
        content = await handle.promise;
      } catch (error) {
        failed = true;
        failureInfo = getErrorInfo(error);
        failureMessage = failureInfo.message;
      } finally {
        if (handle && runtime.currentMain === handle) {
          runtime.currentMain = null;
          runtime.currentMainRequest = null;
          runtime.currentMainStep = null;
        }
      }
      if (!step || (execution && !execution.admitted) || runtime.released || runtime.autoPaused || generation !== runtime.mainGeneration || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
        return;
      }
      if (acceptancePlanEpoch !== runtime.acceptancePlanEpoch) {
        runtime.decisionCount -= 1;
        continue;
      }
      if (failed) {
        const task = deps.readTask(runtime.taskId);
        const failure = buildNextLoopMainAiFailureState(task ?? {}, { failureMessage, now: now() });
        const code = failureInfo?.code;
        updateTask(runtime.taskId, {
          ...failure,
          mainAiLastFailureCode: code === RUNTIME_CONFIG_LOCK_TIMEOUT && handle?.hasStarted?.() !== false ? null : code ?? null,
          schedulingMode: "event_driven",
          updatedAt: now(),
        });
        const nonRetryable = execution?.startRejected || failureInfo?.code === "DEPARTMENT_NATIVE_UNKNOWN" || failureInfo?.code === "SESSION_RUN_ACTIVE"
          || isNonRetryableCodexThreadError(failureInfo?.code, failureMessage);
        if (nonRetryable || isLoopMainAiFailureLimitReached(failure)) {
          pause(runtime, "needs-review", nonRetryable ? "loop-plus-main-non-retryable" : "loop-plus-main-failure-limit",
            buildLoopMainAiFailureSummary(failure, { nonRetryable, code: failureInfo?.code }));
          return;
        }
        if (step.kind !== "review") {
          runtime.forcePrompt = true;
        }
        continue;
      }
      const task = deps.readTask(runtime.taskId);
      const acceptancePlanKeys = listLoopPlusAcceptancePlanFeedbackItems(task?.loopPlusAcceptancePlan)
        .map((item) => item.key);
      // 用户可在主模型执行期间改设置，提交决策前同步准入容量。
      runtime.scheduler.updateMaxConcurrency(maxConcurrency());
      const parsed = parseLoopPlusDecisionWithFeedback(content, {
        subtaskMax: decisionSubtaskMax(),
        acceptancePlanKeys,
        requireAcceptanceFeedback: true,
        requireProgressPercent: true,
        allowDirectCompletion: canCompleteDirectly(runtime),
      });
      const decision = parsed.decision;
      if (decision?.status === "clarify") {
        runtime.protocolRepair = null;
        const outcome = await waitForLoopPlusClarification(runtime, decision);
        if (outcome === "stop") {
          return;
        }
        continue;
      }
      const applied = applyDecision(runtime, step, decision, content, parsed.rejectionReason);
      if (applied === "stop") {
        return;
      }
      if (applied === "wait") {
        if (hasUserMessages(runtime) || hasReview(runtime) || hasReports(runtime)) {
          continue;
        }
        return;
      }
    }
  }

  function heldBatchIntact(snapshot: LoopPlusSchedulerSnapshot, step: MainStep): boolean {
    const current = snapshot.currentReview;
    if (step.eventIds.length === 0) {
      return false;
    }
    const live = current
      ? [current.eventId, ...snapshot.reviewQueue.map((item) => item.eventId)]
      : snapshot.reviewQueue.map((item) => item.eventId);
    return step.eventIds.every((eventId, index) => live[index] === eventId);
  }

  function getActiveReviewEventIds(taskId: string): readonly string[] {
    const runtime = runtimes.get(taskId);
    if (!runtime || runtime.released || runtime.autoPaused || runtime.stopRequested
      || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed
      || !runtime.reviewStep || runtime.reviewStep.kind !== "review") {
      return [];
    }
    const snapshot = runtime.scheduler.snapshot();
    if (!heldBatchIntact(snapshot, runtime.reviewStep)) {
      return [];
    }
    return [...runtime.reviewStep.eventIds];
  }

  function planStep(runtime: ParentRuntime, preparingTask?: LoopTaskRecord): MainStep | null {
    const snapshot = runtime.scheduler.snapshot();
    if (runtime.released || snapshot.completed || snapshot.parentStopped || runtime.stopRequested || runtime.autoPaused) {
      return null;
    }
    let reviewDependencyBlocks: LoopPlusDependencyBlock[] = [];
    if (snapshot.currentReview || snapshot.reviewQueue.length > 0) {
      const review = planReview(runtime, !preparingTask);
      if (review.step) return review.step;
      reviewDependencyBlocks = review.dependencyBlocks;
    }
    const current = runtime.scheduler.snapshot();
    const reportEventIds = (current.reportQueue ?? []).map((item) => item.eventId);
    const plain = (kind: Exclude<LoopPlusMainKind, "review">, messages = 0): MainStep => ({
      ...plainStep(kind, messages, reportEventIds), reviewDependencyBlocks,
      reviewSelection: { scheduler: runtime.scheduler, seq: current.seq },
    });
    if (reportEventIds.length > 0) {
      runtime.forcePrompt = false;
      return plain("continue", current.userMessageQueue.length);
    }
    if (!runtime.initialPromptDone) {
      runtime.initialPromptDone = true;
      return plain("initial");
    }
    if (current.userMessageQueue.length > 0) {
      runtime.forcePrompt = false;
      return plain("user", current.userMessageQueue.length);
    }
    if (runtime.forcePrompt) {
      runtime.forcePrompt = false;
      return plain("continue");
    }
    if (reviewDependencyBlocks.length > 0) {
      if (current.running.length === 0) return plain("continue");
      runtime.waitingForReviewDependencies = true;
      return null;
    }
    if (isDependencyBlocked(runtime)) return plain("continue");
    if (current.running.length === 0 && current.pending.length === 0
      && deps.readTask(runtime.taskId)?.loopPlusNextStepPlan) {
      if (runtime.closeoutBudget > 0) runtime.closeoutBudget -= 1;
      return plain("continue");
    }
    if (runtime.closeoutBudget > 0 && current.running.length === 0 && current.pending.length === 0) {
      runtime.closeoutBudget -= 1;
      return plain("closeout");
    }
    return null;
  }

  function planReview(runtime: ParentRuntime, persistClaim: boolean): { step: MainStep | null; dependencyBlocks: LoopPlusDependencyBlock[] } {
    const before = runtime.scheduler.snapshot();
    const previousStep = runtime.reviewStep;
    try {
      // Frozen event/message/report prefixes always take precedence over selection.
      if (previousStep && heldBatchIntact(before, previousStep)) {
        if (!before.currentReview) {
          runtime.scheduler.claimNextReview();
          if (persistClaim) persist(runtime);
        }
        return { step: previousStep, dependencyBlocks: [] };
      }
      const prepared = runtime.scheduler.prepareReviewBatch(LOOP_PLUS_ACCEPTANCE_BATCH_MAX);
      runtime.reviewStep = prepared.items.length > 0 ? {
        kind: "review",
        eventId: prepared.items[0].eventId,
        eventIds: prepared.items.map((item) => item.eventId),
        reportEventIds: (prepared.view.reportQueue ?? []).map((item) => item.eventId),
        userMessageCount: prepared.view.userMessageQueue.length,
        reviewDependencyBlocks: prepared.dependencyBlocks,
        reviewSelection: { scheduler: runtime.scheduler, seq: prepared.view.seq },
      } : null;
      // Persist the actual submission prefix before exposing it to the main model.
      if (persistClaim) persist(runtime);
      const allowDispatchBeforeReview = !previousStep
        && before.running.length < maxConcurrency()
        && before.seenAttempts.length < configuredSubtaskRoundLimit()
        && !runtime.protocolRepair && !deps.readTask(runtime.taskId)?.loopPlusBlockReview
        && prepared.items.every((item) => !runtime.recoveredReviewEventIds.has(item.eventId));
      const step = runtime.reviewStep && allowDispatchBeforeReview
        ? { ...runtime.reviewStep, allowDispatchBeforeReview: true }
        : runtime.reviewStep;
      return { step, dependencyBlocks: prepared.dependencyBlocks };
    } catch (error) {
      runtime.scheduler = runtime.createScheduler({ snapshot: before });
      runtime.reviewStep = previousStep;
      throw error;
    }
  }

  function plainStep(
    kind: Exclude<LoopPlusMainKind, "review">,
    userMessageCount = 0,
    reportEventIds: string[] = [],
  ): MainStep {
    return { kind, eventId: null, eventIds: [], reportEventIds, userMessageCount };
  }

  function createDecisionPort(runtime: ParentRuntime, response: string | null, step: MainStep): LoopPlusDecisionStrategyPort {
    const controlPlans = new WeakMap<LoopPlusDecisionControlPlan, ControlPlan>();
    return {
      queueView() {
        const snapshot = runtime.scheduler.snapshot();
        return {
          hasCurrentReview: Boolean(snapshot.currentReview),
          hasReview: Boolean(snapshot.currentReview) || snapshot.reviewQueue.length > 0,
          hasReports: (snapshot.reportQueue?.length ?? 0) > 0,
          hasUserMessages: snapshot.userMessageQueue.length > 0,
          runningCount: snapshot.running.length,
          pendingCount: snapshot.pending.length,
          parentStopped: snapshot.parentStopped,
          reviewDependencyBlocks: currentReviewDependencyBlocks(runtime, step, snapshot.seq),
        };
      },
      waitForInFlightWork() {
        const waited = runtime.scheduler.wait().view;
        return {
          runningCount: waited.running.length,
          pendingCount: waited.pending.length,
          ...(waited.dependencyBlocks?.length ? { dependencyBlocks: waited.dependencyBlocks } : {}),
        };
      },
      protocolMiss(held: boolean, reason?: string): LoopPlusDecisionOutcome {
        return protocolMiss(runtime, held, reason, response);
      },
      markDecisionAccepted() {
        runtime.protocolRetries = 0;
        runtime.protocolRepair = null;
        runtime.decomposing = false;
        resetMainFailure(runtime);
      },
      clearProtocolRetries() {
        runtime.protocolRetries = 0;
        runtime.protocolRepair = null;
      },
      acknowledgeUserMessages(count: number) {
        if (count <= 0) {
          return;
        }
        runtime.scheduler.ackUserMessages(count);
        if (runtime.reviewStep) {
          // blocked 可消费消息但不确认事件；后续复核不能消费后到的新消息。
          runtime.reviewStep = {
            ...runtime.reviewStep,
            userMessageCount: Math.max(0, runtime.reviewStep.userMessageCount - count),
          };
        }
      },
      acknowledgeReports(eventIds: readonly string[]) {
        const before = runtime.scheduler.snapshot();
        if (!runtime.scheduler.acknowledgeReports(eventIds)) return false;
        try {
          persist(runtime);
          if (runtime.reviewStep) {
            runtime.reviewStep = {
              ...runtime.reviewStep,
              reportEventIds: runtime.reviewStep.reportEventIds.filter((id) => !eventIds.includes(id)),
            };
          }
          return true;
        } catch (error) {
          runtime.scheduler = runtime.createScheduler({ snapshot: before });
          throw error;
        }
      },
      captureRemainingUserMessagesForHeldReview() {
        if (!runtime.reviewStep) {
          return;
        }
        const pendingCount = runtime.scheduler.snapshot().userMessageQueue.length;
        runtime.reviewStep = {
          ...runtime.reviewStep,
          userMessageCount: pendingCount,
        };
      },
      refuseDispatchPastSubtaskRoundLimit(plannedLaunches: number) {
        return refuseDispatchPastSubtaskRoundLimit(runtime, plannedLaunches);
      },
      applyControls(controls: readonly LoopPlusControlDecision[]) {
        return applyLoopPlusControls(runtime, controls);
      },
      planControls(controls: readonly LoopPlusControlDecision[]) {
        const planned = planControlCommands(runtime, controls);
        if (!planned) {
          return null;
        }
        const token = {} as LoopPlusDecisionControlPlan;
        controlPlans.set(token, planned);
        return token;
      },
      previewControls(plan: LoopPlusDecisionControlPlan) {
        const planned = controlPlans.get(plan);
        if (!planned) {
          return false;
        }
        return previewControlPlan(runtime, planned);
      },
      commitControls(controls: readonly LoopPlusControlDecision[], plan: LoopPlusDecisionControlPlan) {
        const planned = controlPlans.get(plan);
        if (!planned) {
          return false;
        }
        return commitControlPlan(runtime, controls, planned);
      },
      dispatchSubtasks(subtasks: readonly LoopSubtaskDecision[], reviews?: LoopPlusDecision["reviews"]) {
        return dispatchDecisions(runtime, subtasks, { reviews });
      },
      promoteDecisionWork() {
        promotePendingAndLaunch(runtime);
      },
      submitReviewBatch(
        eventIds: readonly string[],
        acceptance: "passed" | "failed" | readonly { eventId: string; acceptance: "passed" | "failed" | "cancelled"; reason?: string }[],
      ) {
        const before = runtime.scheduler.snapshot();
        const result = runtime.scheduler.submitReviewBatch(eventIds, acceptance);
        if (result.ok) {
          try {
            persist(runtime, { loopPlusBlockReview: undefined });
          } catch (error) {
            runtime.scheduler = runtime.createScheduler({ snapshot: before });
            throw error;
          }
          runtime.reviewStep = null;
        }
        return { ok: result.ok };
      },
      requeueCurrentReview() {
        runtime.scheduler.requeueCurrentReview();
      },
      persistRunning() {
        persist(runtime, { status: "running" });
      },
      persistSnapshot() {
        persist(runtime);
      },
      applyNextStepPlan(plan: LoopPlusNextStepPlan | undefined) {
        persist(runtime, { loopPlusNextStepPlan: plan });
      },
      persistEstimatedRounds(decision: LoopPlusDecision) {
        persistEstimatedRounds(runtime, decision);
      },
      persistProgressPercent(decision: LoopPlusDecision) {
        const progressPercent = normalizeLoopPlusProgressPercent(decision.progressPercent);
        if (progressPercent !== undefined && progressPercent < 100) {
          updateTask(runtime.taskId, { loopPlusProgressPercent: progressPercent, updatedAt: now() });
        }
      },
      noteWaiting(runningCount: number) {
        deps.appendMessage(runtime.target, "loop-plus-waiting", runtime.taskId);
        deps.log?.("loop-plus-waiting", {
          taskId: runtime.taskId,
          running: runningCount,
        });
      },
      pauseForReview(message: string, finalSummary?: string) {
        pause(runtime, "needs-review", message, message === "loop-plus-blocked"
          ? appendLoopSubtaskFailureEvidence(finalSummary, getLoopPlusFailureLines(runtime, step)) : finalSummary);
      },
      armCloseout() {
        runtime.closeoutBudget = 1;
      },
      recordAcceptancePlanFeedback(decision: LoopPlusDecision) {
        recordAcceptancePlanFeedback(runtime, decision);
      },
      tryFinishParent() {
        // Check the gate without marking memory completed before the remaining decision writes.
        return createLoopPlusScheduler({ snapshot: runtime.scheduler.snapshot() }).complete().ok;
      },
      finishParent(decision: LoopPlusDecision): LoopPlusDecisionOutcome {
        const patch: Partial<LoopTaskRecord> = {
          status: "completed",
          loopPlusProgressPercent: 100,
          answerConclusion: decision.answerConclusion,
          finalSummary: decision.finalSummary,
          completionRequirementCoverage: decision.requirementCoverage,
          estimatedRemainingRounds: 0,
          loopPlusNextStepPlan: undefined,
        };
        try {
          if (!runtime.scheduler.complete().ok) {
            return hasReview(runtime) || hasReports(runtime) || hasUserMessages(runtime) ? "continue" : "wait";
          }
          persist(runtime, patch);
        } catch (error) {
          runtime.completionPatch = patch;
          deps.log?.("loop-plus-persist-failed", {
            taskId: runtime.taskId,
            error: errorText(error),
          });
          settle(runtime);
          return "stop";
        }
        try {
          deps.appendMessage(runtime.target, "loop-plus-completed", runtime.taskId);
        } catch (error) {
          deps.log?.("loop-plus-completion-message-failed", {
            taskId: runtime.taskId,
            error: errorText(error),
          });
        }
        appendCompletionMessages(runtime);
        notifyTaskCompleted(runtime);
        releaseCompleted(runtime);
        return "stop";
      },
    };
  }

  function recordAcceptancePlanFeedback(runtime: ParentRuntime, decision: LoopPlusDecision): void {
    if (!deps.appendAcceptancePlanChat) {
      return;
    }
    const eventIds = confirmedLoopPlusReviewIds(decision);
    if (eventIds.length === 0) {
      return;
    }
    const attempts = runtime.scheduler.snapshot().seenAttempts;
    const task = deps.readTask(runtime.taskId);
    const subtaskTitles = eventIds.map((eventId) => {
      const attempt = attempts.find((item) => buildLoopPlusFinishEventId(item.subtaskId, item.attemptId) === eventId);
      const subtaskIndex = task?.subTasks.findIndex((subtask) => subtask.id === attempt?.subtaskId) ?? -1;
      const subtask = task?.subTasks[subtaskIndex];
      return subtask ? getLoopSubtaskDisplayTitle(subtaskIndex, subtask) : attempt?.subtaskId ?? eventId;
    });
    const section = buildLoopPlusAcceptanceFeedbackSection({
      snapshot: task?.loopPlusAcceptancePlan,
      subtaskTitles,
      reviews: (decision.reviews ?? []).map((review) => ({
        eventId: review.reviewEventId,
        acceptance: review.acceptance,
        reason: review.reason,
      })),
      checks: decision.acceptance?.checks,
      planResults: decision.acceptancePlanResults,
    });
    if (!section) {
      return;
    }
    try {
      deps.appendAcceptancePlanChat(runtime.taskId, section);
    } catch (error) {
      deps.log?.("loop-plus-acceptance-feedback-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
  }

  function notifyTaskCompleted(runtime: ParentRuntime): void {
    try {
      deps.onTaskCompleted?.(runtime.taskId);
    } catch (error) {
      deps.log?.("loop-plus-completion-notification-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
  }

  function appendCompletionMessages(runtime: ParentRuntime): void {
    if (!deps.appendCompletionMessages) {
      return;
    }
    const task = deps.readTask(runtime.taskId);
    if (!task || task.status !== "completed") {
      return;
    }
    try {
      deps.appendCompletionMessages(runtime.target, task);
    } catch (error) {
      deps.log?.("loop-plus-completion-summary-message-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
  }

  function applyDecision(
    runtime: ParentRuntime,
    step: MainStep,
    decision: LoopPlusDecision | null,
    response: string | null,
    rejectionReason: string | null,
  ): LoopPlusDecisionOutcome {
    const snapshot = runtime.scheduler.snapshot();
    const held = snapshot.currentReview;
    if (step.kind === "review" && !heldBatchIntact(snapshot, step)) {
      if (hasReview(runtime)) {
        return "continue";
      }
      return "wait";
    }
    if (!decision) {
      return protocolMiss(runtime, Boolean(held), rejectionReason ?? undefined, response);
    }
    if (step.allowDispatchBeforeReview && decision.status === "dispatch") {
      return applyDispatchBeforeReview(runtime, step, decision, response);
    }
    if (!sameLoopPlusReportIds(decision.reportEventIds ?? [], step.reportEventIds)) {
      return protocolMiss(runtime, Boolean(held), "reportEventIds 必须逐项确认当前提示中的无需验收报告，且不能跳过或重排。");
    }
    if (decision.departmentCollaborations?.length) {
      const task = deps.readTask(runtime.taskId);
      if (held || snapshot.reviewQueue.length || step.eventIds.length || task?.departmentInvalid || task?.department?.role !== "leader") {
        return protocolMiss(runtime, Boolean(held), "协作请求必须在处理整批待审事件后由部门组长提交。", response);
      }
      for (const message of decision.departmentCollaborations) {
        const result = deps.submitDepartmentCollaboration?.(runtime.taskId, message);
        if (!result?.ok) return protocolMiss(runtime, false, result?.reason ?? "部门协作入口不可用。", response);
      }
    }
    const blockReview = deps.readTask(runtime.taskId)?.loopPlusBlockReview;
    if (blockReview?.state === "pending") {
      updateTask(runtime.taskId, {
        loopPlusBlockReview: { ...blockReview, state: "reviewed" },
      });
    }
    if (decision.status === "blocked" && !blockReview
      && snapshot.userMessageQueue.length <= step.userMessageCount) {
      acknowledgeSeenUserMessages(runtime, step);
      if (step.kind === "review" && runtime.reviewStep) {
        runtime.reviewStep = {
          ...runtime.reviewStep,
          userMessageCount: Math.max(0, runtime.reviewStep.userMessageCount - step.userMessageCount),
        };
      }
      runtime.protocolRetries = 0;
      runtime.protocolRepair = null;
      if (held) {
        runtime.scheduler.requeueCurrentReview();
      }
      runtime.forcePrompt = true;
      persist(runtime, {
        status: "running",
        loopPlusBlockReview: { state: "pending", summary: decision.finalSummary },
      });
      deps.appendMessage(runtime.target, "loop-plus-block-review", runtime.taskId);
      deps.log?.("loop-plus-block-review", { taskId: runtime.taskId });
      return "continue";
    }
    if (decision.status === "blocked" && !decision.blocker) {
      return protocolMiss(runtime, Boolean(held), buildLoopBlockerDiagnosticFailure(
        appendLoopSubtaskFailureEvidence(decision.finalSummary || blockReview?.summary, getLoopPlusFailureLines(runtime, step)), decision.blockerIssue,
      ), response);
    }
    const outcome = loopPlusDecisionStrategyFor(decision.status, decisionStrategies)(
      createDecisionPort(runtime, response, step),
      step,
      inheritLoopPlusRepairSessions(decision, [snapshot.currentReview, ...snapshot.reviewQueue].filter((event): event is LoopPlusReviewItem => event !== null)),
    );
    return outcome;
  }

  function applyDispatchBeforeReview(
    runtime: ParentRuntime,
    step: MainStep,
    decision: LoopPlusDecision,
    response: string | null,
  ): LoopPlusDecisionOutcome {
    const subtasks = decision.subtasks ?? [];
    if (!decision.nextStepPlan || decision.controls?.length
      || !sameLoopPlusReportIds(decision.reportEventIds ?? [], step.reportEventIds)) {
      return protocolMiss(runtime, true, "验收前派发须提供用于续跑本批验收的 nextStepPlan，并按原顺序确认报告；不能带 controls。请继续验收冻结批次。", response);
    }
    const dispatched = dispatchDecisions(runtime, subtasks, { reviewPlan: decision.nextStepPlan, reportEventIds: step.reportEventIds });
    if (dispatched.decisions.length === 0) {
      return protocolMiss(runtime, true, "验收前只允许在剩余轮次和空槽内立即启动独立任务，不能依赖待确认结果、复用已有任务或与待验收交付冲突。请继续验收冻结批次。", response);
    }
    const port = createDecisionPort(runtime, response, step);
    port.persistEstimatedRounds(decision);
    port.markDecisionAccepted();
    promotePendingAndLaunch(runtime);
    return "continue";
  }


  async function waitForLoopPlusClarification(runtime: ParentRuntime, decision: LoopPlusDecision): Promise<LoopPlusDecisionOutcome> {
    const request = decision.clarification;
    const task = deps.readTask(runtime.taskId);
    const count = task?.clarificationCount ?? 0;
    if (!request || count >= ORCHESTRATOR_CLARIFICATION_LIMIT) {
      pause(runtime, "needs-review", "loop-plus-clarification-limit", decision.finalSummary);
      return "stop";
    }
    updateTask(runtime.taskId, {
      pendingClarification: request,
      clarificationCount: count + 1,
      ...(decision.finalSummary ? { finalSummary: decision.finalSummary } : {}),
      schedulingMode: "event_driven",
      updatedAt: now(),
    });
    deps.revealClarification?.(runtime.taskId);
    const submission = await (deps.waitForClarification ?? waitForOrchestratorClarification)(loopClarificationScope(runtime.taskId), request, {
      timeoutMs: deps.clarificationTimeoutMs?.() ?? readHumanInteractionTimeoutMs(),
      recordHistory: deps.recordInteractionHistory,
    });
    if (runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.released) {
      return "stop";
    }
    const latest = deps.readTask(runtime.taskId);
    if (!latest || latest.status === "stopped" || latest.status === "error") {
      return "stop";
    }
    if (submission.status !== "completed") {
      updateTask(runtime.taskId, {
        pendingClarification: undefined,
        updatedAt: now(),
      });
      pause(runtime, "needs-review", "loop-plus-clarification-rejected", "用户拒绝了主任务澄清，任务已暂停。");
      return "stop";
    }
    const answer = formatOrchestratorClarificationAnswer(submission, request.formFields);
    const requirements = [...(latest.supplementalRequirements ?? []), answer];
    updateTask(runtime.taskId, {
      supplementalRequirements: requirements,
      pendingClarification: undefined,
      schedulingMode: "event_driven",
      updatedAt: now(),
    });
    runtime.protocolRetries = 0;
    runtime.protocolRepair = null;
    resetMainFailure(runtime);
    if (runtime.scheduler.snapshot().currentReview || runtime.scheduler.snapshot().reviewQueue.length > 0) {
      return "continue";
    }
    runtime.forcePrompt = true;
    return "continue";
  }

  function protocolMiss(
    runtime: ParentRuntime,
    held: boolean,
    reason = "决策与当前调度状态不一致，请核对当前验收批次、运行中及排队任务，并重新返回合法决策。",
    response: string | null = null,
  ): "continue" | "stop" {
    runtime.protocolRetries += 1;
    runtime.protocolRepair = { reason, response };
    deps.log?.("loop-plus-protocol-miss", {
      taskId: runtime.taskId,
      held,
      protocolRetries: runtime.protocolRetries,
      reason,
    });
    if (runtime.protocolRetries > protocolRetryLimit) {
      pause(runtime, "needs-review", "loop-plus-protocol-paused",
        buildLoopPlusProtocolPauseSummary(reason, runtime.protocolRetries - 1));
      return "stop";
    }
    if (!hasReview(runtime)) {
      runtime.forcePrompt = true;
    }
    return "continue";
  }

  function dispatchDecisions(
    runtime: ParentRuntime,
    subtasks: readonly LoopSubtaskDecision[],
    options: {
      reviews?: LoopPlusDecision["reviews"];
      reviewPlan?: LoopPlusNextStepPlan;
      reportEventIds?: readonly string[];
    } = {},
  ) {
    const { reviews, reviewPlan, reportEventIds = [] } = options;
    if (subtasks.length === 0) {
      persist(runtime, { status: "running" });
      return { decisions: [], rejected: [] };
    }
    const before = runtime.scheduler.snapshot();
    const previousMeta = new Map(runtime.meta);
    const existing = deps.readTask(runtime.taskId)?.subTasks ?? [];
    const repairSources = new Map<string, NonNullable<LoopSubtaskRecord["repairSource"]>>();
    for (const review of reviews ?? []) {
      if (review.acceptance !== "failed") continue;
      const source = before.seenAttempts.find((item) => buildLoopPlusFinishEventId(item.subtaskId, item.attemptId) === review.reviewEventId);
      if (!source || source.disposition !== "reviewed" || source.acceptance !== "failed") throw new Error("Unconfirmed repair review");
      for (const id of review.subtaskIds ?? []) {
        // An ordinary retry of the same subtask is settled by its latest attempt, not a replacement edge.
        if (id === source.subtaskId) continue;
        if (repairSources.has(id) || existing.some((item) => item.id === id)) throw new Error("Ambiguous repair dispatch");
        repairSources.set(id, { subtaskId: source.subtaskId, attemptId: source.attemptId, finishEventId: review.reviewEventId });
      }
    }
    const seqBefore = runtime.attemptSeq;
    const built = subtasks.map((subtask, index) => toSpec(subtask, seqBefore + index + 1));
    const specs = built.map((item) => item.spec);
    if (reviewPlan && !canDispatchBeforeReview(runtime, before, built.map((item) => item.decision))) {
      return { decisions: [], rejected: [] };
    }
    if (reviewPlan) {
      const preflight = runtime.createScheduler({ snapshot: before });
      if (reportEventIds.length > 0 && !preflight.acknowledgeReports(reportEventIds)) {
        return { decisions: [], rejected: [] };
      }
      const preview = preflight.dispatch(specs);
      if (preview.rejected.length > 0 || preview.decisions.length !== specs.length
        || preview.decisions.some((item) => item.admission !== "started")) {
        return { decisions: [], rejected: [] };
      }
      if (reportEventIds.length > 0 && !runtime.scheduler.acknowledgeReports(reportEventIds)) {
        return { decisions: [], rejected: [] };
      }
    }
    const dispatched = runtime.scheduler.dispatch(specs, { deferPromotion: !reviewPlan });
    if (reviewPlan && (dispatched.rejected.length > 0 || dispatched.decisions.length !== specs.length
      || dispatched.decisions.some((item) => item.admission !== "started"))) {
      runtime.scheduler = runtime.createScheduler({ snapshot: before });
      return { decisions: [], rejected: [] };
    }
    runtime.attemptSeq += built.length;
    const accepted = new Set(dispatched.decisions.map((item) => item.attemptId));
    runtime.scheduler.releaseUnstarted(dispatched.started.map((item) => item.attemptId));
    built.forEach((item) => {
      if (!accepted.has(item.spec.attemptId)) {
        return;
      }
      runtime.meta.set(item.spec.subtaskId, {
        decision: item.decision,
        repairSource: repairSources.get(item.spec.subtaskId),
        executionStatus: "pending",
      });
    });
    try {
      persist(runtime, {
        status: "running",
        ...(accepted.size > 0 ? { loopPlusBlockReview: undefined } : {}),
        ...(reviewPlan ? { loopPlusNextStepPlan: reviewPlan } : {}),
      });
      if (repairSources.size) {
        const saved = deps.readTask(runtime.taskId);
        for (const item of built) {
          const source = repairSources.get(item.spec.subtaskId);
          if (!source) continue;
          const actual = saved?.subTasks.find((subtask) => subtask.id === item.spec.subtaskId)?.repairSource;
          if (!accepted.has(item.spec.attemptId) || !actual || actual.subtaskId !== source.subtaskId
            || actual.attemptId !== source.attemptId || actual.finishEventId !== source.finishEventId
            || !((saved?.loopPlus as LoopPlusSchedulerSnapshot | undefined)?.seenAttempts.some((attempt) => attempt.attemptId === item.spec.attemptId && attempt.subtaskId === item.spec.subtaskId))) {
            throw new Error("Repair dispatch persistence not confirmed");
          }
        }
      }
    } catch (error) {
      runtime.meta = previousMeta;
      runtime.scheduler = runtime.createScheduler({ snapshot: before });
      // No work launches after an unconfirmed commit. Remove only this request's provenance;
      // preserve the reservation/history if storage remains unavailable.
      if (repairSources.size) {
        const saved = deps.readTask(runtime.taskId);
        if (saved) deps.updateTask(runtime.taskId, { subTasks: saved.subTasks.map((item) => {
          if (!repairSources.has(item.id)) return item;
          const { repairSource: _source, ...rest } = item; return rest;
        }) });
      }
      runtime.attemptSeq = seqBefore;
      throw error;
    }
    deps.log?.("loop-plus-dispatched", {
      taskId: runtime.taskId,
      started: [],
      pending: runtime.scheduler.snapshot().pending.map((item) => item.attemptId),
      dependencyBlocks: runtime.scheduler.getDependencyBlocks(),
      rejected: dispatched.rejected.map((item) => ({
        subtaskId: item.subtaskId,
        attemptId: item.attemptId,
        reason: item.reason,
      })),
    });
    return { decisions: dispatched.decisions, rejected: dispatched.rejected };
  }

  function canDispatchBeforeReview(
    runtime: ParentRuntime,
    snapshot: LoopPlusSchedulerSnapshot,
    subtasks: readonly LoopSubtaskDecision[],
  ): boolean {
    if (subtasks.length === 0 || snapshot.running.length >= maxConcurrency()) return false;
    if (snapshot.seenAttempts.length + subtasks.length > subtaskRoundLimitFor(runtime)) return false;
    const existingIds = new Set(snapshot.seenAttempts.map((attempt) => attempt.subtaskId));
    const unreviewedEvents = [snapshot.currentReview, ...snapshot.reviewQueue]
      .filter((event): event is LoopPlusReviewItem => event !== null);
    const unreviewed = unreviewedEvents.map((event) => runtime.meta.get(event.subtaskId)?.decision);
    const knownUnreviewed = unreviewed.filter((decision): decision is LoopSubtaskDecision => Boolean(decision));
    if (knownUnreviewed.length !== unreviewedEvents.length) return false;
    const unreviewedIds = new Set(unreviewedEvents.map((event) => event.subtaskId));
    return subtasks.every((subtask) => {
      const subtaskId = subtask.id ?? buildSubtaskId(subtask.title);
      const candidate = {
        id: subtaskId,
        title: subtask.title,
        conflictGroup: subtask.conflictGroup,
        writeFiles: subtask.writeFiles,
      };
      return !existingIds.has(subtaskId) && !subtask.continueFromSubtaskId
      && !(subtask.dependsOn ?? []).some((dependencyId) => unreviewedIds.has(dependencyId))
      && knownUnreviewed.every((other) => buildLoopSubtaskExecutionPlan([
        {
          id: other.id ?? buildSubtaskId(other.title),
          title: other.title,
          conflictGroup: other.conflictGroup,
          writeFiles: other.writeFiles,
        },
        candidate,
      ]).conflicts.length === 0);
    });
  }

  function toSpec(subtask: LoopSubtaskDecision, attemptSeq: number): {
    spec: {
      subtaskId: string;
      attemptId: string;
      title: string;
      dependsOn?: string[];
      requiresAcceptance?: boolean;
      conflictGroup?: string;
      writeFiles?: string[];
    };
    decision: LoopSubtaskDecision;
  } {
    const subtaskId = subtask.id?.trim() || buildSubtaskId(subtask.title);
    const attemptId = `lp${attemptSeq}-${subtaskId}`;
    return {
      spec: {
        subtaskId,
        attemptId,
        title: subtask.title,
        ...(subtask.requiresAcceptance !== undefined ? { requiresAcceptance: subtask.requiresAcceptance } : {}),
        dependsOn: [...(subtask.dependsOn ?? [])],
        conflictGroup: subtask.conflictGroup,
        writeFiles: subtask.writeFiles,
      },
      decision: { ...subtask, id: subtaskId, dependsOn: [...(subtask.dependsOn ?? [])] },
    };
  }

  function promotePendingAndLaunch(runtime: ParentRuntime): void {
    if (runtime.autoPaused || runtime.stopRequested || runtime.released) return;
    const before = runtime.scheduler.snapshot();
    runtime.scheduler.updateMaxConcurrency(maxConcurrency());
    const promoted = runtime.scheduler.promotePending();
    if (promoted.started.length === 0) return;
    // A running reservation must be durable before any process can observe it.
    persistResumeTransition(runtime, before, "running");
    launchAll(runtime, promoted.started);
  }

  function isDependencyBlocked(runtime: ParentRuntime): boolean {
    const snapshot = runtime.scheduler.snapshot();
    return snapshot.running.length === 0 && snapshot.pending.length > 0
      && !snapshot.currentReview && snapshot.reviewQueue.length === 0
      && (snapshot.reportQueue?.length ?? 0) === 0
      && runtime.scheduler.getDependencyBlocks().length > 0;
  }

  function nextLaunchEpoch(runtime: ParentRuntime, attemptId: string): number {
    const epoch = (runtime.launchEpoch.get(attemptId) ?? 0) + 1;
    runtime.launchEpoch.set(attemptId, epoch);
    return epoch;
  }

  function releaseUnstartedReservations(
    runtime: ParentRuntime,
    records: readonly LoopPlusExecutionRecord[],
  ): number {
    if (
      runtime.released
      || runtime.stopRequested
      || runtime.scheduler.snapshot().parentStopped
      || runtime.scheduler.snapshot().completed
    ) {
      return 0;
    }
    const attemptIds: string[] = [];
    for (const record of records) {
      if (runtime.attempts.has(record.attemptId)) {
        continue;
      }
      if (!runtime.scheduler.snapshot().running.some((item) => item.attemptId === record.attemptId)) {
        continue;
      }
      attemptIds.push(record.attemptId);
    }
    if (attemptIds.length === 0) {
      return 0;
    }
    const released = runtime.scheduler.releaseUnstarted(attemptIds);
    released.released.forEach((record) => {
      nextLaunchEpoch(runtime, record.attemptId);
      runtime.launching.delete(record.attemptId);
    });
    return released.released.length;
  }

  function releaseLaunchingReservations(runtime: ParentRuntime): void {
    const reserved = runtime.scheduler.snapshot().running.filter((item) => (
      runtime.launching.has(item.attemptId) && !runtime.attempts.has(item.attemptId)
    ));
    releaseUnstartedReservations(runtime, reserved);
  }

  function launchAll(runtime: ParentRuntime, records: readonly LoopPlusExecutionRecord[]): void {
    records.forEach((record) => {
      const epoch = nextLaunchEpoch(runtime, record.attemptId);
      runtime.launching.add(record.attemptId);
      runtime.launchChain = runtime.launchChain.then(() => startQueuedAttempt(runtime, record, epoch)).catch((error: unknown) => {
        if (runtime.launchEpoch.get(record.attemptId) !== epoch) {
          return;
        }
        runtime.launching.delete(record.attemptId);
        const detail = errorText(error);
        deps.log?.("loop-plus-launch-failed", {
          taskId: runtime.taskId,
          attemptId: record.attemptId,
          error: detail,
        });
        if (runtime.released || runtime.scheduler.snapshot().completed || runtime.attempts.has(record.attemptId)) {
          return;
        }
        const stillRunning = runtime.scheduler.snapshot().running.some((item) => item.attemptId === record.attemptId);
        if (!stillRunning) {
          return;
        }
        safeApplyFinish(runtime, {
          subtaskId: record.subtaskId,
          attemptId: record.attemptId,
          outcome: "failed",
          detail,
        });
      });
    });
  }


  function finishedChatNotice(
    input: {
      subtaskId: string;
      outcome: LoopPlusExecutionOutcome;
      detail: string | null;
    },
    meta: SubtaskMeta | undefined,
  ): LoopPlusSubtaskChatNotice {
    return {
      taskId: "",
      subtaskId: input.subtaskId,
      title: meta?.decision.title ?? input.subtaskId,
      phase: "finished",
      round: LOOP_PLUS_ATTEMPT_ROUND,
      communicationFile: meta?.communicationFile,
      runStatus: input.outcome === "completed" ? "end" : input.outcome === "stopped" ? "stopped" : "error",
      assistantContent: input.detail,
    };
  }

  function notifySubtaskChat(runtime: ParentRuntime, notice: Omit<LoopPlusSubtaskChatNotice, "taskId">): void {
    if (!deps.appendSubtaskChat) {
      return;
    }
    try {
      deps.appendSubtaskChat(runtime.target, {
        ...notice,
        taskId: runtime.taskId,
      });
    } catch (error) {
      deps.log?.("loop-plus-chat-failed", {
        taskId: runtime.taskId,
        subtaskId: notice.subtaskId,
        phase: notice.phase,
        error: errorText(error),
      });
    }
  }

  async function startQueuedAttempt(
    runtime: ParentRuntime,
    record: LoopPlusExecutionRecord,
    epoch: number,
  ): Promise<void> {
    try {
      const waitMs = launchDelayMs(runtime.lastLaunchAt, now());
      if (waitMs > 0) {
        await delay(waitMs);
      }
      if (runtime.launchEpoch.get(record.attemptId) !== epoch) {
        return;
      }
      if (runtime.released || runtime.scheduler.snapshot().completed) {
        return;
      }
      if (runtime.stopRequested || runtime.scheduler.snapshot().parentStopped) {
        abandonUnstarted(runtime, record);
        return;
      }
      if (runtime.autoPaused) {
        if (releaseUnstartedReservations(runtime, [record]) > 0) {
          try {
            persist(runtime);
          } catch (error) {
            deps.log?.("loop-plus-persist-failed", {
              taskId: runtime.taskId,
              attemptId: record.attemptId,
              error: errorText(error),
            });
          }
        }
        return;
      }
      const stillRunning = runtime.scheduler.snapshot().running.some((item) => item.attemptId === record.attemptId);
      if (!stillRunning || runtime.attempts.has(record.attemptId)) {
        return;
      }
      runtime.lastLaunchAt = now();
      const task = deps.readTask(runtime.taskId);
      const meta = runtime.meta.get(record.subtaskId);
      const decision = meta?.decision ?? {
        id: record.subtaskId,
        title: record.title ?? record.subtaskId,
        prompt: record.title ?? record.subtaskId,
        writeFiles: record.writeFiles,
      };
      const subtask = projectSubtask(runtime, record.subtaskId, task?.subTasks ?? []);
      const communicationFile = task && deps.prepareCommunication
        ? deps.prepareCommunication(task, subtask, runtime.attemptSeq) ?? undefined
        : meta?.communicationFile;
      if (
        runtime.launchEpoch.get(record.attemptId) !== epoch
        || runtime.autoPaused
        || runtime.stopRequested
        || runtime.scheduler.snapshot().parentStopped
        || runtime.released
        || runtime.scheduler.snapshot().completed
      ) {
        if (runtime.autoPaused) {
          if (releaseUnstartedReservations(runtime, [record]) > 0) {
            try {
              persist(runtime);
            } catch (error) {
              deps.log?.("loop-plus-persist-failed", {
                taskId: runtime.taskId,
                attemptId: record.attemptId,
                error: errorText(error),
              });
            }
          }
        } else if (runtime.stopRequested || runtime.scheduler.snapshot().parentStopped) {
          abandonUnstarted(runtime, record);
        }
        return;
      }
      const launchedAt = runtime.lastLaunchAt;
      if (meta) {
        meta.communicationFile = communicationFile;
        meta.executionStatus = "running";
        if (typeof launchedAt === "number" && Number.isFinite(launchedAt)) {
          meta.lastStartedAt = launchedAt;
        }
      }
      persist(runtime, { status: runtime.scheduler.snapshot().parentStopped ? "stopped" : "running" });
      notifySubtaskChat(runtime, {
        phase: "started",
        subtaskId: record.subtaskId,
        title: decision.title,
        round: LOOP_PLUS_ATTEMPT_ROUND,
        communicationFile,
      });
      const subtaskExecution = resolveLoopPlusAttemptExecution(runtime, decision);
      if (subtaskExecution.unavailableReason) {
        applyFinish(runtime, {
          subtaskId: record.subtaskId,
          attemptId: record.attemptId,
          outcome: "failed",
          detail: subtaskExecution.unavailableReason,
        });
        return;
      }
      const executionRole = subtaskExecution.role ?? "backend";
      const request: LoopPlusAttemptRequest = {
        taskId: runtime.taskId,
        subtaskId: record.subtaskId,
        continueFromSubtaskId: decision.continueFromSubtaskId,
        dependsOn: [...(decision.dependsOn ?? [])],
        attemptId: record.attemptId,
        title: decision.title,
        prompt: decision.prompt,
        modelPrompt: buildLoopPlusSubtaskModelPrompt({
          subtask: decision,
          communicationFile: communicationFile ?? "",
          executionRole,
          loopSubtaskMode: subtaskExecution.mode,
        }),
        writeFiles: record.writeFiles,
        conflictGroup: record.conflictGroup ?? undefined,
        communicationFile,
        round: LOOP_PLUS_ATTEMPT_ROUND,
        targetCli: subtaskExecution.cli,
        execution: {
          role: executionRole,
          configId: subtaskExecution.configId,
          ...(subtaskExecution.model ? { model: subtaskExecution.model } : {}),
          ...(subtaskExecution.thinkingMode ? { thinkingMode: subtaskExecution.thinkingMode } : {}),
        },
      };
      let handle: LoopPlusAttemptHandle;
      try {
        handle = deps.startAttempt(request);
      } catch (error) {
        applyFinish(runtime, {
          subtaskId: record.subtaskId,
          attemptId: record.attemptId,
          outcome: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const inFlight: InFlightAttempt = {
        subtaskId: record.subtaskId,
        attemptId: record.attemptId,
        abort: handle.abort,
        settled: false,
        isActive: handle.isActive,
      };
      runtime.attempts.set(record.attemptId, inFlight);
      void handle.promise.then((result) => {
        if (inFlight.settled) {
          return;
        }
        inFlight.settled = true;
        safeApplyFinish(runtime, {
          subtaskId: record.subtaskId,
          attemptId: record.attemptId,
          outcome: result.outcome,
          detail: result.detail,
          onCompleted: handle.onCompleted,
        });
      }, (error: unknown) => {
        if (inFlight.settled) {
          return;
        }
        inFlight.settled = true;
        safeApplyFinish(runtime, {
          subtaskId: record.subtaskId,
          attemptId: record.attemptId,
          outcome: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      });
    } finally {
      if (runtime.launchEpoch.get(record.attemptId) === epoch) {
        runtime.launching.delete(record.attemptId);
      }
    }
  }


  function resolveLoopPlusAttemptExecution(
    runtime: ParentRuntime,
    decision: { taskType?: LoopPlusTaskType; writeFiles?: string[]; codingDelivery?: boolean },
  ) {
    const task = deps.readTask(runtime.taskId);
    const department = task?.departmentInvalid ? null : normalizeDepartmentMetadata(task?.department);
    if (task?.departmentInvalid || (task?.department !== undefined && department?.role !== "leader")) {
      return { role: "backend" as const, cli: runtime.cli, configId: null, crossCli: false, unavailableReason: "Invalid department execution identity" };
    }
    if (department?.role === "leader") {
      // Every employee, including analysis/general work, uses the frozen employee route.
      return resolveLoopPlusRoleExecution({ mainCli: runtime.cli, taskType: "backend", loopSubtaskMode: "fullstack",
        mainRoute: task?.modelRouting?.main, fullstackRoute: department.routes.employee,
        originProfile: task?.originProfile, prompt: runtime.prompt });
    }
    return resolveLoopPlusRoleExecution({
      mainCli: runtime.cli,
      taskType: decision.taskType,
      writeFiles: decision.writeFiles,
      codingDelivery: decision.codingDelivery,
      loopSubtaskMode: task?.loopSubtaskMode,
      loopSubtaskModeInvalid: task?.loopSubtaskModeInvalid,
      mainRoute: task?.modelRouting?.main,
      backendRoute: task?.modelRouting?.subtask,
      frontendRoute: task?.modelRouting?.subtaskFrontend,
      fullstackRoute: task?.modelRouting?.subtaskFullstack,
      originProfile: task?.originProfile,
      prompt: applyLoopModelRoutingToPrompt(runtime.prompt, task?.modelRouting, task?.originProfile),
    });
  }

  function describeLoopPlusRouting(task: LoopTaskRecord | null): { mode?: LoopSubtaskMode; summary: string } {
    const mode = resolveStoredLoopSubtaskMode({
      loopSubtaskMode: task?.loopSubtaskMode,
      loopSubtaskModeInvalid: task?.loopSubtaskModeInvalid,
      frontendRoute: task?.modelRouting?.subtaskFrontend,
    });
    if (!mode) {
      return { summary: "stored loopSubtaskMode is invalid; do not dispatch coding" };
    }
    const analysis = formatSubtaskRouteSummary(task?.modelRouting?.main, "main unrecorded");
    if (mode === "fullstack") {
      const legacyAtomic = !task?.loopSubtaskMode && !task?.modelRouting?.subtaskFullstack;
      const coding = formatSubtaskRouteSummary(
        legacyAtomic ? task?.modelRouting?.subtask : task?.modelRouting?.subtaskFullstack,
        legacyAtomic ? "legacy subtask unrecorded" : "fullstack unrecorded",
      );
      return {
        mode,
        summary: `mode=fullstack coding=${coding} analysis=${analysis}${legacyAtomic ? " legacyAtomic=yes" : ""}`,
      };
    }
    return {
      mode,
      summary: `mode=split backend=${formatSubtaskRouteSummary(task?.modelRouting?.subtask, "backend unrecorded")} frontend=${formatSubtaskRouteSummary(task?.modelRouting?.subtaskFrontend, "frontend unrecorded")} analysis=${analysis}`,
    };
  }

  function abandonUnstarted(runtime: ParentRuntime, record: LoopPlusExecutionRecord): void {
    if (runtime.attempts.has(record.attemptId)) {
      return;
    }
    const stillRunning = runtime.scheduler.snapshot().running.some((item) => item.attemptId === record.attemptId);
    if (!stillRunning) {
      return;
    }
    applyFinish(runtime, {
      subtaskId: record.subtaskId,
      attemptId: record.attemptId,
      outcome: "stopped",
      detail: "lost-process",
    });
  }

  function safeApplyFinish(runtime: ParentRuntime, input: {
    subtaskId: string;
    attemptId: string;
    outcome: LoopPlusExecutionOutcome;
    detail: string | null;
    onCompleted?: () => Promise<void>;
  }): void {
    try {
      applyFinish(runtime, input);
    } catch (error) {
      const detail = errorText(error);
      deps.log?.("loop-plus-finish-failed", {
        taskId: runtime.taskId,
        attemptId: input.attemptId,
        error: detail,
      });
      if (!runtime.released && !runtime.scheduler.snapshot().completed) {
        retainFinishFailure(runtime, "loop-plus-finish-failed", `Loop+ finish handling failed: ${detail}`);
      } else {
        settle(runtime);
      }
    }
  }

  function applyFinish(runtime: ParentRuntime, input: {
    subtaskId: string;
    attemptId: string;
    outcome: LoopPlusExecutionOutcome;
    detail: string | null;
    onCompleted?: () => Promise<void>;
  }): void {
    if (input.outcome === "failed") {
      input = { ...input, detail: normalizeLoopSubtaskFailure(input.detail) ?? "CLI 调用失败，未捕获具体错误。" };
    }
    const currentAttempt = runtime.scheduler.snapshot().running.find((item) => item.subtaskId === input.subtaskId);
    let completed = false;
    try {
      completed = applyFinishResult(runtime, input) && input.outcome === "completed";
    } finally {
      if (!currentAttempt || currentAttempt.attemptId === input.attemptId) {
        const cleanup = completed ? input.onCompleted : undefined;
        const flight = loopSubtaskAutoCompactions.notify(runtime.taskId, input.subtaskId, completed, cleanup, input.attemptId);
        if (!flight && cleanup) {
          void cleanup().catch((error: unknown) => {
            deps.log?.("loop-plus-subtask-tab-auto-close-error", {
              taskId: runtime.taskId, subtaskId: input.subtaskId, attemptId: input.attemptId, error: errorText(error),
            });
          });
        }
      }
    }
  }

  function applyFinishResult(runtime: ParentRuntime, input: {
    subtaskId: string;
    attemptId: string;
    outcome: LoopPlusExecutionOutcome;
    detail: string | null;
  }): boolean {
    if (runtime.released || runtime.scheduler.snapshot().completed) {
      deps.log?.("loop-plus-finish-ignored", {
        taskId: runtime.taskId,
        subtaskId: input.subtaskId,
        attemptId: input.attemptId,
        reason: "completed",
      });
      return false;
    }
    const snapshot = runtime.scheduler.snapshot();
    const openAttempt = snapshot.running.find((item) => item.subtaskId === input.subtaskId && item.attemptId === input.attemptId);
    if (input.outcome === "stopped" && input.detail !== "lost-process"
      && !runtime.stopRequested && !snapshot.parentStopped && openAttempt) {
      // Keep the reservation until the subtask continuation reports a result.
      const meta = runtime.meta.get(input.subtaskId);
      if (meta) {
        meta.executionStatus = "blocked";
      }
      persist(runtime);
      deps.log?.("loop-plus-subtask-interrupted", {
        taskId: runtime.taskId,
        subtaskId: input.subtaskId,
        attemptId: input.attemptId,
      });
      return false;
    }
    runtime.scheduler.updateMaxConcurrency(maxConcurrency());
    const result = runtime.scheduler.finish({
      subtaskId: input.subtaskId,
      attemptId: input.attemptId,
      outcome: input.outcome,
      detail: input.detail,
    });
    if (!result.applied) {
      deps.log?.("loop-plus-finish-ignored", {
        taskId: runtime.taskId,
        subtaskId: input.subtaskId,
        attemptId: input.attemptId,
        reason: result.reason,
      });
      return false;
    }
    const meta = runtime.meta.get(input.subtaskId);
    if (meta) {
      meta.summary = input.detail ?? meta.summary;
      meta.executionStatus = input.outcome === "completed" ? "completed" : "blocked";
      meta.executionFailure = input.outcome === "failed" ? input.detail ?? undefined : undefined;
    }
    let task: LoopTaskRecord | null = null;
    try {
      task = deps.readTask(runtime.taskId);
    } catch (error) {
      const detail = errorText(error);
      deps.log?.("loop-plus-persist-failed", {
        taskId: runtime.taskId,
        attemptId: input.attemptId,
        error: detail,
      });
      releaseUnstartedReservations(runtime, result.started);
      retainFinishFailure(runtime, "loop-plus-persist-failed", `Loop+ state persistence failed: ${detail}`);
      notifySubtaskChat(runtime, finishedChatNotice(input, meta));
      return false;
    }
    if (task && deps.recordAttempt) {
      try {
        deps.recordAttempt({
          task,
          subtaskId: input.subtaskId,
          attemptId: input.attemptId,
          outcome: input.outcome,
          detail: input.detail,
          communicationFile: meta?.communicationFile,
        });
      } catch (error) {
        const detail = errorText(error);
        deps.log?.("loop-plus-report-failed", {
          taskId: runtime.taskId,
          subtaskId: input.subtaskId,
          attemptId: input.attemptId,
          error: detail,
        });
        releaseUnstartedReservations(runtime, result.started);
        retainFinishFailure(runtime, "loop-plus-report-failed", `Loop+ attempt report failed: ${detail}`);
        notifySubtaskChat(runtime, finishedChatNotice(input, meta));
        return false;
      }
    }
    if (runtime.autoPaused) {
      releaseUnstartedReservations(runtime, result.started);
    }
    try {
      persist(runtime);
    } catch (error) {
      const detail = errorText(error);
      deps.log?.("loop-plus-persist-failed", {
        taskId: runtime.taskId,
        attemptId: input.attemptId,
        error: detail,
      });
      releaseUnstartedReservations(runtime, result.started);
      retainFinishFailure(runtime, "loop-plus-persist-failed", `Loop+ state persistence failed: ${detail}`);
      notifySubtaskChat(runtime, finishedChatNotice(input, meta));
      return false;
    }
    notifySubtaskChat(runtime, finishedChatNotice(input, meta));
    if (
      runtime.autoPaused
      || runtime.released
      || runtime.stopRequested
      || runtime.scheduler.snapshot().parentStopped
      || runtime.scheduler.snapshot().completed
    ) {
      return true;
    }
    launchAll(runtime, result.started);
    // Every applied finish can unblock review selection, even when the kernel
    // wake was already latched by an earlier deferred successor.
    requestPump(runtime);
    return true;
  }

  function retainFinishFailure(runtime: ParentRuntime, message: string, finalSummary: string): void {
    runtime.autoPaused = true;
    runtime.pauseStatus = "error";
    runtime.decomposing = false;
    releaseLaunchingReservations(runtime);
    runtime.mainGeneration += 1;
    const main = runtime.currentMain;
    runtime.currentMain = null;
    runtime.currentMainRequest = null;
    runtime.currentMainStep = null;
    try {
      main?.abort();
    } catch (error) {
      deps.log?.("loop-plus-main-abort-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    const snapshot = runtime.scheduler.snapshot();
    const status: LoopTaskStatus = snapshot.completed
      ? "completed"
      : snapshot.parentStopped || runtime.stopRequested
        ? "stopped"
        : "error";
    try {
      persist(runtime, { status, finalSummary });
    } catch (error) {
      deps.log?.("loop-plus-persist-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    try {
      deps.appendMessage(runtime.target, message, runtime.taskId);
    } catch (error) {
      deps.log?.("loop-plus-failure-message-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    settle(runtime);
  }

  function canCompleteDirectly(runtime: ParentRuntime): boolean {
    const task = deps.readTask(runtime.taskId);
    const snapshot = runtime.scheduler.snapshot();
    return !!task
      && snapshot.running.length === 0
      && snapshot.pending.length === 0
      && snapshot.reviewQueue.length === 0
      && (snapshot.reportQueue?.length ?? 0) === 0
      && snapshot.currentReview === null
      && listLoopPlusAcceptancePlanFeedbackItems(task.loopPlusAcceptancePlan).length === 0;
  }

  function currentReviewDependencyBlocks(runtime: ParentRuntime, step: MainStep, seq: number): LoopPlusDependencyBlock[] | undefined {
    return step.reviewSelection?.scheduler === runtime.scheduler
      && step.reviewSelection.seq === seq ? step.reviewDependencyBlocks : undefined;
  }

  function buildMainRequest(runtime: ParentRuntime, step: MainStep, preparingTask?: LoopTaskRecord): LoopPlusMainRequest {
    runtime.scheduler.updateMaxConcurrency(maxConcurrency());
    const task = preparingTask ?? deps.readTask(runtime.taskId);
    const routing = describeLoopPlusRouting(task);
    const department = task?.departmentInvalid === true
      ? null
      : normalizeDepartmentMetadata(task?.department);
    const departmentEmployeeCapacity = department?.role === "leader"
      ? {
          rootTaskId: department.rootTaskId,
          leaderTaskId: task?.id ?? runtime.taskId,
          maxEmployees: department.limits.maxEmployees,
          snapshot: (() => {
            try {
              return deps.getDepartmentEmployeeCapacity?.(department.rootTaskId, task?.id ?? runtime.taskId) ?? null;
            } catch (error) {
              try {
                deps.log?.("loop-plus-department-capacity-read-failed", {
                  taskId: runtime.taskId,
                  error: errorText(error),
                });
              } catch {
                // Capacity read failures must not break prompt generation.
              }
              return null;
            }
          })(),
        }
      : undefined;
    const frozenReportIds = new Set(step.reportEventIds);
    const view = runtime.scheduler.wait().view;
    const basePrompt = buildLoopPlusMainModelPrompt({
      taskId: runtime.taskId,
      rootPrompt: task?.rootPrompt ?? runtime.prompt.displayPrompt,
      taskStoreFile: task?.taskStoreFile ?? "",
      mainCommunicationFile: task?.mainCommunicationFile ?? "",
      kind: step.kind,
      allowDispatchBeforeReview: step.allowDispatchBeforeReview,
      acceptancePlan: task?.loopPlusAcceptancePlan ?? null,
      allowDirectCompletion: canCompleteDirectly(runtime),
      view: {
        ...view,
        dependencyBlocks: [
          ...(view.dependencyBlocks ?? []),
          ...(currentReviewDependencyBlocks(runtime, step, view.seq) ?? []),
        ],
      },
      currentEventId: step.eventId,
      supplementalRequirements: task?.supplementalRequirements ?? [],
      acceptanceEventIds: step.eventIds,
      reportEventIds: step.reportEventIds,
      reportQueue: (runtime.scheduler.snapshot().reportQueue ?? [])
        .filter((item) => frozenReportIds.has(item.eventId)),
      priorSubtaskFailures: getLoopPlusFailureLines(runtime, step, false),
      interruptedSubtaskIds: runtime.scheduler.snapshot().running
        .filter((item) => runtime.meta.get(item.subtaskId)?.executionStatus === "blocked")
        .map((item) => item.subtaskId),
      pendingUserMessages: step.userMessageCount > 0
        ? runtime.scheduler.snapshot().userMessageQueue.slice(0, step.userMessageCount)
        : [],
      maxConcurrency: runtime.scheduler.snapshot().maxConcurrency,
      subtaskMax: decisionSubtaskMax(),
      subtaskRounds: runtime.scheduler.snapshot().seenAttempts.length,
      nextStepPlan: task?.loopPlusNextStepPlan,
      subtaskRoundLimit: preparingTask ? configuredSubtaskRoundLimit() : subtaskRoundLimitFor(runtime),
      progressPercent: normalizeLoopPlusProgressPercent(task?.loopPlusProgressPercent) ?? 0,
      ...(routing.mode ? { loopSubtaskMode: routing.mode } : {}),
      routingSummary: routing.summary,
      ...(departmentEmployeeCapacity ? { departmentEmployeeCapacity } : {}),
      ...(task?.loopPlusBlockReview?.state === "pending"
        ? { blockedReviewSummary: task.loopPlusBlockReview.summary ?? "" }
        : {}),
    });
    const prompt = runtime.protocolRepair
      ? `${basePrompt}\n\n${buildLoopPlusProtocolRepairPrompt(runtime.protocolRepair)}`
      : basePrompt;
    return {
      taskId: runtime.taskId,
      kind: step.kind,
      prompt,
      modelPrompt: prompt,
      reviewEventId: step.eventId,
      reviewEventIds: step.eventIds.slice(),
      reportEventIds: step.reportEventIds.slice(),
      userMessageCount: step.userMessageCount,
      target: runtime.target,
    };
  }

  function buildPersistencePatch(runtime: ParentRuntime, task: LoopTaskRecord | null, patch: Partial<LoopTaskRecord>): Partial<LoopTaskRecord> {
    const snapshot = runtime.scheduler.snapshot();
    const runningIds = snapshot.running.map((item) => item.subtaskId);
    const status = patch.status ?? statusFor(runtime, snapshot, task);
    return {
      ...patch,
      status,
      schedulingMode: "event_driven",
      loopPlus: snapshot,
      loopPlusMainPhase: runtime.decomposing ? "decomposing" : undefined,
      activeSubtaskId: runningIds[0] ?? null,
      activeSubtaskIds: runningIds,
      subTasks: mergeSubtasks(runtime, task?.subTasks ?? []),
      updatedAt: now(),
    };
  }

  function persist(runtime: ParentRuntime, patch: Partial<LoopTaskRecord> = {}): void {
    updateTask(runtime.taskId, buildPersistencePatch(runtime, deps.readTask(runtime.taskId), patch));
    try {
      refreshCurrentMainPrompt(runtime);
    } catch (error) {
      deps.log?.("loop-plus-refresh-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
  }

  function refreshCurrentMainPrompt(runtime: ParentRuntime): void {
    const request = runtime.currentMainRequest;
    const step = runtime.currentMainStep;
    if (!request || !step) {
      return;
    }
    const refreshed = buildMainRequest(runtime, step);
    request.prompt = refreshed.prompt;
    request.modelPrompt = refreshed.modelPrompt;
  }

  function statusFor(
    runtime: ParentRuntime,
    snapshot: LoopPlusSchedulerSnapshot,
    task: LoopTaskRecord | null,
  ): LoopTaskStatus {
    if (snapshot.completed) {
      return "completed";
    }
    if (snapshot.parentStopped || runtime.stopRequested) {
      return "stopped";
    }
    if (runtime.autoPaused) {
      return runtime.pauseStatus;
    }
    if (task?.status === "error" || task?.status === "needs-review") {
      return task.status;
    }
    return "running";
  }

  function getLoopPlusFailureLines(runtime: ParentRuntime, step: MainStep, includeCurrent = true): string[] {
    const snapshot = runtime.scheduler.snapshot();
    const latest = new Map(snapshot.seenAttempts.map((attempt) => [attempt.subtaskId, attempt]));
    const events = new Map([snapshot.currentReview, ...snapshot.reviewQueue, ...(snapshot.reportQueue ?? [])]
      .filter((item): item is LoopPlusReviewItem => item !== null).map((item) => [item.attemptId, item.eventId]));
    const visible = new Set([...step.eventIds, ...step.reportEventIds]);
    const subtasks = [...runtime.meta].map(([id, meta]) => ({ id, title: meta.decision.title,
      status: meta.executionStatus ?? "pending", executionFailure: meta.executionFailure } as const));
    return getLoopSubtaskFailureLines(subtasks.filter(({ id }) => {
      const attempt = latest.get(id);
      if (attempt?.outcome !== "failed" || attempt.disposition === "closed" || attempt.acceptance === "cancelled") return false;
      const eventId = events.get(attempt.attemptId);
      return eventId === undefined || (includeCurrent && visible.has(eventId));
    }));
  }

  function mergeSubtasks(runtime: ParentRuntime, existing: readonly LoopSubtaskRecord[]): LoopSubtaskRecord[] {
    const byId = new Map(existing.map((subtask) => [subtask.id, subtask]));
    runtime.meta.forEach((meta, subtaskId) => {
      const previous = byId.get(subtaskId);
      const active = runtime.scheduler.snapshot().running.some((item) => item.subtaskId === subtaskId)
        ? meta.executionStatus === "blocked" ? "blocked" : "running"
        : runtime.scheduler.snapshot().pending.some((item) => item.subtaskId === subtaskId)
          ? "pending"
          : meta.executionStatus ?? previous?.status ?? "pending";
      const lastStartedAt = typeof meta.lastStartedAt === "number" && Number.isFinite(meta.lastStartedAt)
        ? meta.lastStartedAt
        : previous?.lastStartedAt;
      byId.set(subtaskId, {
        id: subtaskId,
        title: meta.decision.title,
        prompt: meta.decision.prompt,
        continueFromSubtaskId: meta.decision.continueFromSubtaskId,
        dependsOn: [...(meta.decision.dependsOn ?? [])],
        ...(previous?.executionSession ? { executionSession: previous.executionSession } : {}),
        ...((meta.repairSource ?? previous?.repairSource) ? { repairSource: meta.repairSource ?? previous?.repairSource } : {}),
        conflictGroup: meta.decision.conflictGroup,
        writeFiles: meta.decision.writeFiles,
        ...(meta.decision.taskType ? { taskType: meta.decision.taskType } : {}),
        ...(meta.decision.codingDelivery ? { codingDelivery: true } : {}),
        ...(meta.decision.requiresAcceptance !== undefined
          ? { requiresAcceptance: meta.decision.requiresAcceptance }
          : {}),
        status: active,
        summary: meta.summary ?? previous?.summary,
        ...(active === "blocked" && meta.executionFailure ? { executionFailure: meta.executionFailure } : {}),
        communicationFile: meta.communicationFile ?? previous?.communicationFile,
        ...(typeof lastStartedAt === "number" && Number.isFinite(lastStartedAt) ? { lastStartedAt } : {}),
        updatedAt: now(),
      });
    });
    return Array.from(byId.values());
  }

  function projectSubtask(runtime: ParentRuntime, subtaskId: string, existing: readonly LoopSubtaskRecord[]): LoopSubtaskRecord {
    return mergeSubtasks(runtime, existing).find((item) => item.id === subtaskId) ?? {
      id: subtaskId,
      title: subtaskId,
      status: "running",
      updatedAt: now(),
    };
  }

  function pause(
    runtime: ParentRuntime,
    status: Extract<LoopTaskStatus, "needs-review" | "error">,
    message: string,
    finalSummary?: string,
  ): void {
    runtime.autoPaused = true;
    runtime.pauseStatus = status;
    runtime.decomposing = false;
    releaseLaunchingReservations(runtime);
    try {
      persist(runtime, {
        status,
        ...(finalSummary ? { finalSummary } : {}),
      });
    } catch (error) {
      deps.log?.("loop-plus-persist-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    try {
      deps.appendMessage(runtime.target, message, runtime.taskId);
    } catch (error) {
      deps.log?.("loop-plus-pause-message-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    try {
      const task = deps.readTask(runtime.taskId);
      if (task?.status === status) {
        deps.recordPause?.(task, message);
      }
    } catch (error) {
      deps.log?.("loop-plus-pause-record-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    settle(runtime);
  }

  function resetMainFailure(runtime: ParentRuntime): void {
    const task = deps.readTask(runtime.taskId);
    if (!task || (!task.mainAiFailureCount && !task.mainAiFailureLimitReached)) {
      return;
    }
    updateTask(runtime.taskId, {
      ...buildResetLoopMainAiFailureState(),
      mainAiLastFailureCode: undefined,
      schedulingMode: "event_driven",
      updatedAt: now(),
    });
  }

  function persistEstimatedRounds(runtime: ParentRuntime, decision: LoopPlusDecision): void {
    if (typeof decision.estimatedRemainingRounds !== "number") {
      return;
    }
    updateTask(runtime.taskId, {
      estimatedRemainingRounds: decision.estimatedRemainingRounds,
      schedulingMode: "event_driven",
      updatedAt: now(),
    });
  }

  function subtaskRoundLimitFor(runtime: ParentRuntime): number {
    const globalLimit = configuredSubtaskRoundLimit();
    const task = deps.readTask(runtime.taskId);
    if (task && task.loopPlusSubtaskMaxRounds !== globalLimit) {
      updateTask(runtime.taskId, {
        loopPlusSubtaskMaxRounds: globalLimit,
        schedulingMode: "event_driven",
        updatedAt: now(),
      });
    }
    return globalLimit;
  }

  function liveAcceptanceEventIds(snapshot: LoopPlusSchedulerSnapshot): string[] {
    const ids: string[] = [];
    if (snapshot.currentReview) {
      ids.push(snapshot.currentReview.eventId);
    }
    snapshot.reviewQueue.forEach((item) => {
      ids.push(item.eventId);
    });
    return ids;
  }

  function pauseForSubtaskRoundLimit(runtime: ParentRuntime): void {
    pause(runtime, "needs-review", "loop-plus-subtask-round-limit", LOOP_PLUS_SUBTASK_ROUND_LIMIT_SUMMARY);
  }

  function applyLoopPlusControls(
    runtime: ParentRuntime,
    controls: readonly LoopPlusControlDecision[],
  ): boolean {
    const planned = planControlCommands(runtime, controls);
    if (!planned) {
      return false;
    }
    return commitControlPlan(runtime, controls, planned);
  }

  function previewControlPlan(
    runtime: ParentRuntime,
    planned: ControlPlan,
  ): boolean {
    return runtime.scheduler.applyControls(planned.commands, { dryRun: true }).ok;
  }

  function commitControlPlan(
    runtime: ParentRuntime,
    controls: readonly LoopPlusControlDecision[],
    planned: ControlPlan,
  ): boolean {
    const before = runtime.scheduler.snapshot();
    const metaBefore = new Map(runtime.meta);
    const seqBefore = runtime.attemptSeq;
    const result = runtime.scheduler.applyControls(planned.commands, { deferPromotion: true });
    if (!result.ok) {
      deps.log?.("loop-plus-control-rejected", {
        taskId: runtime.taskId,
        reason: result.reason,
      });
      return false;
    }
    runtime.scheduler.releaseUnstarted(result.started.map((item) => item.attemptId));
    runtime.attemptSeq = planned.nextSeq;
    result.closed.forEach((closed) => {
      recordControlledSubtask(runtime, closed, controls.find((item) => item.id === closed.subtaskId));
    });
    try {
      persist(runtime, { status: runtime.scheduler.snapshot().parentStopped ? "stopped" : "running" });
    } catch (error) {
      runtime.scheduler = runtime.createScheduler({ snapshot: before });
      runtime.meta = metaBefore;
      runtime.attemptSeq = seqBefore;
      throw error;
    }
    result.closed.forEach((closed) => {
      retireControlledAttempt(runtime, closed);
      notifyControlledSubtask(runtime, closed, controls.find((item) => item.id === closed.subtaskId));
    });
    return true;
  }

  function planControlCommands(
    runtime: ParentRuntime,
    controls: readonly LoopPlusControlDecision[],
  ): ControlPlan | null {
    let seq = runtime.attemptSeq;
    const commands: LoopPlusControlCommand[] = [];
    for (const control of controls) {
      if (control.action === "close") {
        commands.push({ subtaskId: control.id, action: "close" });
        continue;
      }
      const prompt = control.prompt.trim();
      const title = control.title.trim();
      if (!prompt || !title) {
        return null;
      }
      seq += 1;
      const meta = runtime.meta.get(control.id);
      const writeFiles = control.writeFiles ?? meta?.decision.writeFiles ?? [];
      const conflictGroup = control.conflictGroup ?? meta?.decision.conflictGroup;
      const taskType = control.taskType ?? meta?.decision.taskType;
      const codingDelivery = control.taskType ? control.codingDelivery : (control.codingDelivery ?? meta?.decision.codingDelivery);
      const requiresAcceptance = control.requiresAcceptance;
      commands.push({
        subtaskId: control.id,
        action: "reprompt",
        replacement: {
          subtaskId: control.id,
          attemptId: `lp${seq}-${control.id}`,
          title,
          writeFiles,
          dependsOn: [...(control.dependsOn ?? meta?.decision.dependsOn ?? [])],
          ...(conflictGroup ? { conflictGroup } : {}),
          ...(taskType ? { taskType } : {}),
          ...(codingDelivery ? { codingDelivery } : {}),
          ...(requiresAcceptance !== undefined ? { requiresAcceptance } : {}),
        },
      });
    }
    return { commands, nextSeq: seq };
  }

  function retireControlledAttempt(runtime: ParentRuntime, record: LoopPlusExecutionRecord): void {
    loopSubtaskAutoCompactions.notify(runtime.taskId, record.subtaskId, false, undefined, record.attemptId);
    nextLaunchEpoch(runtime, record.attemptId);
    runtime.launching.delete(record.attemptId);
    const inFlight = runtime.attempts.get(record.attemptId);
    if (!inFlight) {
      void deps.closeSubtaskTabs?.(runtime.taskId, record.subtaskId, record.attemptId).catch((error: unknown) => {
        deps.log?.("loop-plus-subtask-tab-auto-close-error", {
          taskId: runtime.taskId,
          subtaskId: record.subtaskId,
          attemptId: record.attemptId,
          reason: "main-abort",
          error: errorText(error),
        });
      });
      return;
    }
    inFlight.settled = true;
    inFlight.abort({ closeTab: true });
  }

  function recordControlledSubtask(
    runtime: ParentRuntime,
    closed: LoopPlusExecutionRecord,
    control: LoopPlusControlDecision | undefined,
  ): void {
    const previous = runtime.meta.get(closed.subtaskId);
    const action = control?.action ?? "close";
    const title = control?.title ?? previous?.decision.title ?? closed.title ?? closed.subtaskId;
    const prompt = action === "reprompt"
      ? (control?.prompt ?? previous?.decision.prompt ?? title)
      : (previous?.decision.prompt ?? title);
    const requiresAcceptance = action === "reprompt"
      ? control?.requiresAcceptance
      : previous?.decision.requiresAcceptance;
    const dependsOn = action === "reprompt"
      ? control?.dependsOn ?? previous?.decision.dependsOn ?? closed.dependsOn ?? []
      : previous?.decision.dependsOn ?? closed.dependsOn ?? [];
    const meta: SubtaskMeta = {
      decision: {
        id: closed.subtaskId,
        dependsOn: [...dependsOn],
        title,
        prompt,
        ...(requiresAcceptance !== undefined
          ? { requiresAcceptance }
          : {}),
        continueFromSubtaskId: closed.subtaskId,
        conflictGroup: control?.conflictGroup ?? previous?.decision.conflictGroup,
        writeFiles: control?.writeFiles ?? previous?.decision.writeFiles,
        ...(control?.taskType || (!control?.taskType && previous?.decision.taskType)
          ? { taskType: control?.taskType ?? previous?.decision.taskType }
          : {}),
        ...((control?.taskType ? control.codingDelivery : (control?.codingDelivery ?? previous?.decision.codingDelivery))
          ? { codingDelivery: true }
          : {}),
      },
      communicationFile: previous?.communicationFile,
      summary: action === "close"
        ? `主任务已中断并关闭该子任务。${control?.reason ? `原因：${control.reason}` : ""}`
        : previous?.summary,
      executionStatus: action === "close" ? "blocked" : "pending",
      ...(typeof previous?.lastStartedAt === "number" ? { lastStartedAt: previous.lastStartedAt } : {}),
    };
    runtime.meta.set(closed.subtaskId, meta);
  }

  function notifyControlledSubtask(runtime: ParentRuntime, closed: LoopPlusExecutionRecord, control: LoopPlusControlDecision | undefined): void {
    const meta = runtime.meta.get(closed.subtaskId);
    const action = control?.action ?? "close";
    notifySubtaskChat(runtime, {
      phase: "finished",
      subtaskId: closed.subtaskId,
      title: meta?.decision.title ?? closed.subtaskId,
      round: LOOP_PLUS_ATTEMPT_ROUND,
      communicationFile: meta?.communicationFile,
      runStatus: "stopped",
      assistantContent: action === "close"
        ? `主任务已中断并关闭该子任务。${control?.reason ? `原因：${control.reason}` : ""}`
        : "主任务已中断该子任务，并改用新的提示词继续执行。",
    });
    deps.log?.("loop-plus-subtask-controlled", {
      taskId: runtime.taskId,
      subtaskId: closed.subtaskId,
      attemptId: closed.attemptId,
      action,
    });
  }

  function refuseDispatchPastSubtaskRoundLimit(
    runtime: ParentRuntime,
    subtaskCount: number,
  ): boolean {
    if (subtaskCount <= 0 || runtime.scheduler.snapshot().seenAttempts.length + subtaskCount <= subtaskRoundLimitFor(runtime)) {
      return false;
    }
    pauseForSubtaskRoundLimit(runtime);
    return true;
  }

  function hasReview(runtime: ParentRuntime): boolean {
    const snapshot = runtime.scheduler.snapshot();
    return Boolean(snapshot.currentReview) || snapshot.reviewQueue.length > 0;
  }

  function hasReports(runtime: ParentRuntime): boolean {
    return (runtime.scheduler.snapshot().reportQueue?.length ?? 0) > 0;
  }

  function hasUserMessages(runtime: ParentRuntime): boolean {
    return runtime.scheduler.snapshot().userMessageQueue.length > 0;
  }

  function acknowledgeSeenUserMessages(runtime: ParentRuntime, step: MainStep): void {
    if (step.userMessageCount <= 0) {
      return;
    }
    runtime.scheduler.ackUserMessages(step.userMessageCount);
  }

  function applyAcceptancePlan(taskId: string, value: unknown): { ok: true; plan?: LoopPlusAcceptancePlanSnapshot } | { ok: false; error: string } {
    const task = deps.readTask(taskId);
    if (task?.department !== undefined || task?.departmentInvalid) {
      return { ok: false, error: "产研部成员继承根任务固化验收方案，运行中不能单独修改。" };
    }
    if (!task || resolveLoopSchedulingMode(task.schedulingMode) !== "event_driven") {
      return { ok: false, error: "只有 Loop+ 任务可以修改验收方案。" };
    }
    const plan = normalizeLoopPlusAcceptancePlanSnapshotForStorage(value);
    try {
      updateTask(taskId, {
        loopPlusAcceptancePlan: plan,
        updatedAt: now(),
      });
    } catch (error) {
      deps.log?.("loop-plus-persist-failed", { taskId, error: errorText(error) });
      return { ok: false, error: "验收方案更新失败，请稍后重试。" };
    }
    const runtime = runtimes.get(taskId);
    const request = runtime?.currentMainRequest;
    const main = runtime?.currentMain;
    const previous = normalizeLoopPlusAcceptancePlanSnapshotForStorage(task.loopPlusAcceptancePlan);
    const unchanged = JSON.stringify(previous ?? null) === JSON.stringify(plan ?? null);
    if (runtime && !unchanged && request && main && (request.kind === "review" || request.kind === "closeout")) {
      if (request.kind === "closeout") {
        runtime.closeoutBudget = Math.max(runtime.closeoutBudget, 1);
      }
      runtime.acceptancePlanEpoch += 1;
      try {
        main.abort();
      } catch (error) {
        deps.log?.("loop-plus-main-abort-failed", {
          taskId: runtime.taskId,
          error: errorText(error),
        });
      }
    }
    return plan ? { ok: true, plan } : { ok: true };
  }

  function submitUserMessage(taskId: string, text: string, deliveryId?: string): boolean {
    const normalized = normalizeId(taskId);
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!normalized || !trimmed) {
      return false;
    }
    if (deliveryId !== undefined) {
      if (!normalizeId(deliveryId)) return false;
      const task = deps.readTask(normalized);
      const receipt = task?.departmentDeliveries?.[deliveryId];
      if (receipt !== undefined) return receipt === trimmed;
    }
    const runtime = runtimes.get(normalized);
    if (!runtime) {
      return enqueueStoredUserMessage(normalized, trimmed, deliveryId);
    }
    return enqueueLiveUserMessage(runtime, trimmed, deliveryId);
  }

  function enqueueLiveUserMessage(runtime: ParentRuntime, text: string, deliveryId?: string): boolean {
    if (runtime.released || runtime.stopRequested || runtime.stopping) {
      return false;
    }
    const snapshot = runtime.scheduler.snapshot();
    if (snapshot.parentStopped || snapshot.completed) {
      return false;
    }
    const task = deps.readTask(runtime.taskId);
    if (task && isLoopMainAiFailureLimitReached(task)) {
      return false;
    }
    const queued = runtime.scheduler.enqueueUserMessage(text);
    if (!queued.queued) {
      return false;
    }
    if (runtime.autoPaused) {
      runtime.autoPaused = false;
      armLifecycle(runtime);
    }
    try {
      const updated = deps.updateTask(runtime.taskId, { status: "running", loopPlus: runtime.scheduler.snapshot(), loopPlusBlockReview: undefined,
        ...(deliveryId ? { departmentDeliveries: { ...task?.departmentDeliveries, [deliveryId]: text } } : {}), updatedAt: now() });
      if (!updated) throw new Error("Loop+ supplemental requirement persistence failed");
    } catch (error) {
      // Roll back the uncommitted queue append. It has not been exposed to the consumer yet.
      runtime.scheduler = runtime.createScheduler({ snapshot });
      throw error;
    }
    if (runtime.currentMain) {
      return true;
    }
    requestPump(runtime);
    return true;
  }

  function enqueueStoredUserMessage(taskId: string, text: string, deliveryId?: string): boolean {
    const task = deps.readTask(taskId);
    if (!task || resolveLoopSchedulingMode(task.schedulingMode) !== "event_driven" || task.loopPlus == null) {
      return false;
    }
    if (isLoopMainAiFailureLimitReached(task)) {
      return false;
    }
    let scheduler: LoopPlusScheduler;
    try {
      scheduler = createLoopPlusScheduler({ snapshot: task.loopPlus });
    } catch {
      return false;
    }
    if (scheduler.snapshot().parentStopped || scheduler.snapshot().completed) {
      return false;
    }
    const queued = scheduler.enqueueUserMessage(text);
    if (!queued.queued) {
      return false;
    }
    const updated = updateTask(task.id, {
      schedulingMode: "event_driven",
      loopPlus: scheduler.snapshot(),
      loopPlusBlockReview: undefined,
      ...(deliveryId ? { departmentDeliveries: { ...task.departmentDeliveries, [deliveryId]: text } } : {}),
      updatedAt: now(),
    });
    return !!updated;
  }

  function armLifecycle(runtime: ParentRuntime): void {
    if (runtime.lifecycle.settled) {
      runtime.lifecycle = createLifecycle();
    }
  }

  function settle(runtime: ParentRuntime): void {
    if (runtime.lifecycle.settled) {
      return;
    }
    runtime.lifecycle.settled = true;
    runtime.lifecycle.resolve();
  }

  function releaseCompleted(runtime: ParentRuntime): void {
    runtime.released = true;
    runtime.mainGeneration += 1;
    const main = runtime.currentMain;
    runtime.currentMain = null;
    runtime.currentMainRequest = null;
    runtime.currentMainStep = null;
    try {
      main?.abort();
    } catch (error) {
      deps.log?.("loop-plus-main-abort-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    settle(runtime);
    runtimes.delete(runtime.taskId);
  }

  return {
    canAdmitConfigLockResume,
    checkWaitingTasks,
    tryRun,
    stopParent,
    notifySubtaskContinuation,
    hasController,
    collectRunningTaskIds,
    getActiveReviewEventIds,
    reportAttempt,
    submitUserMessage,
    applyAcceptancePlan,
    resumeInterruptedSubtasks,
  };
}


function nextAttemptSequence(snapshot: LoopPlusSchedulerSnapshot): number {
  let sequence = snapshot.seq;
  for (const attempt of snapshot.seenAttempts) {
    const matched = /^lp(\d+)-/.exec(attempt.attemptId);
    if (!matched) {
      continue;
    }
    const value = Number(matched[1]);
    if (Number.isSafeInteger(value) && value > sequence) {
      sequence = value;
    }
  }
  return sequence;
}

function invalidSnapshotReason(task: LoopTaskRecord): string | null {
  if (task.loopPlus === undefined || task.loopPlus === null) {
    return "missing";
  }
  try {
    createLoopPlusScheduler({ snapshot: task.loopPlus });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "invalid";
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createLifecycle(): Lifecycle {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve, settled: false };
}

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function buildSubtaskId(title: string): string {
  return `subtask_${createHash("sha1").update(title).digest("hex").slice(0, 10)}`;
}
