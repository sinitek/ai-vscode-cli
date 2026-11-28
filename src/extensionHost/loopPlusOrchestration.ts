import { createHash } from "crypto";
import { claimOrdinaryLaunch, projectLaunchReservations } from "../loopPlusLaunchReservation";
import { isDeepStrictEqual } from "util";
import type { FirstLoopMainExecution } from "./promptRunHandoff";
import {
  LoopPlusUpdateUnconfirmedError,
  classifyLoopPlusInterruption,
  readLoopPlusInterruptionSource,
  summarizeLoopPlusDispatchRejections,
  type LoopPlusInterruptionSource,
} from "./loopPlusDiagnostics";
import { RUNTIME_CONFIG_LOCK_TIMEOUT } from "../loopMainFailure";
import { applyLoopModelRoutingToPrompt } from "../loopModelSwitch";
import { appendLoopSubtaskFailureEvidence, getLoopSubtaskFailureLines, normalizeLoopSubtaskFailure } from "../loopSubtaskFailure";
import { getLoopSubtaskDisplayTitle } from "../loopConversationPresentation";
import { buildLoopSubtaskExecutionPlan } from "../loopParallel";
import { loopSubtaskAutoCompactions } from "../loopSubtaskAutoCompact";
import {
  buildNextLoopMainAiFailureState,
  buildLoopMainAiFailureSummary,
  buildResetLoopMainAiFailureState,
  isLoopMainAiFailureLimitReached,
  isLoopPlusMainFailureCode,
  loopPlusMainFailure,
} from "../loopMainFailure";
import { getErrorInfo, type ErrorInfo } from "../promptRetry";
import { isNonRetryableCodexThreadError } from "../interactive/codexThreadErrors";
import {
  buildLoopPlusAcceptanceFeedbackSection,
  listLoopPlusAcceptancePlanFeedbackItems,
} from "../loopPlusAcceptancePlan";
import { LOOP_PLUS_ACCEPTANCE_BATCH_MAX, parseLoopPlusDecisionForFrozenInput, resolveLoopPlusDecisionSubtaskMax, type LoopPlusControlDecision, type LoopPlusDecision, type LoopPlusDecisionFormatDiagnostic, type LoopPlusDecisionParseResult, type LoopPlusDecisionRejectionKind } from "../loopPlusDecision";
import type { LoopPlusNextStepPlan } from "../loopPlusNextStepPlan";
import {
  buildLoopPlusProtocolPauseSummary,
  buildLoopPlusProtocolContinuationPrompt,
  readLoopPlusProtocolRecoveryFromSummary,
  LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT,
  LOOP_PLUS_PROTOCOL_PAUSE_HEADING,
  readLoopPlusProtocolFailureFromSummary,
} from "../loopPlusProtocolRepair";
import {
  classifyLoopPlusResponse,
  loopPlusFrozenBatchKey,
  loopPlusInvocationKey,
  loopPlusProtocolBranchDiagnostic,
  loopPlusProtocolDiagnosticHint,
  loopPlusProtocolParseDiagnostic,
  readLoopPlusTerminalReasonCode,
  type LoopPlusProtocolBranchCode,
  type LoopPlusProtocolDiagnostic,
  type LoopPlusResponseShape,
} from "../loopPlusProtocolDiagnostics";
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
  type LoopPlusControlResult,
  type LoopPlusExecutionOutcome,
  type LoopPlusExecutionRecord,
  type LoopPlusFinishResult,
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
  OrdinaryUpdateIdentityLockBusy,
  OrdinaryUpdateVersionChanged,
  type OrdinaryLoopTaskVersion,
  resolveLoopSchedulingMode,
  type LoopPlusAttemptCompletionReceipt,
  type LoopSchedulingMode,
  type LoopSubtaskDecision,
  type LoopSubtaskRecord,
  type LoopTaskRecord,
  type LoopTaskStoreReadOptions,
  type LoopTaskStatus,
} from "../loopTaskStore";
import { sameLoopPlusMainParent } from "./loopPlusMainAdmission";
import {
  buildLoopPlusIdleSupplement,
  buildLoopPlusMainModelPrompt,
  buildLoopPlusSubtaskModelPrompt,
  loopPlusDecisionHelperArgv,
  resolveLoopPlusDecisionHelperScriptPath,
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
  loopPlusAcceptanceSteps,
  loopPlusDecisionStrategyFor,
  sameLoopPlusReportIds,
  sameLoopPlusReviewIds,
  type LoopPlusDecisionControlPlan,
  type LoopPlusDecisionWorkResult,
  type LoopPlusDecisionOutcome,
  type LoopPlusDecisionStrategyPort,
} from "./loopPlusDecisionStrategies";

import type { LoopPlusReviewItem } from "../loopPlusScheduler";

const MAIN_RECOVERY_FAILURE_LIMIT = 3;
const LOOP_PLUS_ATTEMPT_ROUND = 1;
const LAUNCH_PERSIST_ATTEMPTS = 3;
const LAUNCH_PERSIST_RETRY_DELAYS_MS = [100, 200];
const decisionCommitRetryDelaysMs = [100, 400, 1000];
const UNCONFIRMED_ATTEMPT_RESULT = "宿主重建后无法确认上次子任务执行结果。请核对已有产物，再显式续跑或由主任务处理此开放 attempt。";

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
  done: Promise<void | "ordinary-paused">;
  resumeSupplementCommitted?: true;
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
  reportOnly?: boolean;
  userMessageCount?: number;
  target: LoopPlusPromptTarget;
  firstMainExecution?: FirstLoopMainExecution;
  canSendAutoResumedMain?: () => boolean;
  interruptedNativeSessionId?: string;
};

export type LoopPlusMainHandle = {
  promise: Promise<string | null>;
  abort: () => void;
  hasStarted?: () => boolean;
  wasCancelled?: () => boolean;
  wasUnexpectedlyInterrupted?: () => boolean;
  getInterruptedNativeSessionId?: () => string | undefined;
};

export type LoopPlusAttemptRequest = {
  claimExecution?: (signal: AbortSignal) => Promise<boolean>;
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
  reservationUnconfirmed?: true;
  outcome: Exclude<LoopPlusExecutionOutcome, "unconfirmed">;
  detail: string | null;
};

export type LoopPlusAttemptAbortOptions = {
  closeTab?: boolean;
};

export type LoopPlusAttemptHandle = {
  promise: Promise<LoopPlusAttemptResult>;
  abort: (options?: LoopPlusAttemptAbortOptions) => void;
  /** Called after the successful finish event has been committed, before optional compaction. */
  onCompleted?: () => Promise<void>;
  /** 准备和收尾仍算活动；已启动调用则以宿主执行所有权为准。 */
  isActive?: () => boolean;
  readLostOutcome?: () => LoopPlusAttemptResult | undefined;
};

export type LoopPlusOrchestrationDeps = {
  submitDepartmentCollaboration?: (taskId: string, message: unknown) => { ok: boolean; reason?: string };
  maxConcurrency?: number;
  launchDelayMs?: (lastLaunchAt: number | null, now: number) => number;
  decisionSubtaskMax?: () => number;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
  hasActiveSubtasks?: (taskId: string) => boolean;
  hasActiveSubtask?: (taskId: string, subtaskId: string, attemptId: string) => boolean;
  readTask: (taskId: string, options?: LoopTaskStoreReadOptions) => LoopTaskRecord | null;
  /** Install directory of the extension that loaded this host. Not a workspace, task path, or scanned install. */
  loadedExtensionInstallPath?: () => string | null | undefined;
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
  commitOrdinaryRun?: (expected: LoopTaskRecord, patch: Partial<LoopTaskRecord>, retainedStatus?: OrdinaryLoopTaskVersion["retainedStatus"]) => LoopTaskRecord | null;
  commitConfigLockResume?: LoopPlusOrchestrationDeps["updateTask"];
  appendMessage: (target: LoopPlusPromptTarget, message: string, taskId: string) => void;
  removeClarificationResponse?: (target: LoopPlusPromptTarget, taskId: string, response: string) => void;
  appendCompletionMessages?: (target: LoopPlusPromptTarget, task: LoopTaskRecord) => void;
  onTaskCompleted?: (taskId: string) => void;
  runMain: (request: LoopPlusMainRequest) => LoopPlusMainHandle;
  readMainRecoveryTask?: (taskId: string) => LoopTaskRecord | null;
  canAutoResumeMain?: (task: LoopTaskRecord, target: LoopPlusPromptTarget, nativeSessionId: string | undefined) => boolean;
  startAttempt: (request: LoopPlusAttemptRequest, parent?: LoopTaskRecord) => LoopPlusAttemptHandle;
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
  appendSupplementalRequirementToCommunication?: (task: LoopTaskRecord, requirement: string) => void;
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
  interruptedAttempts?: ReadonlyMap<string, string>;
};

type SubtaskMeta = {
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
  readLostOutcome?: () => LoopPlusAttemptResult | undefined;
};

type AttemptFinish = LoopPlusAttemptCompletionReceipt & {
  outcome: LoopPlusExecutionOutcome;
  onCompleted?: () => Promise<void>;
};

type FinishDelivery = {
  input: AttemptFinish;
  parent: LoopTaskRecord | null;
  retries: number;
  reported: boolean;
  stage: "parent-read" | "receipt-write" | "event-write";
  startedAt: number;
  wake?: () => void;
};

type MainStep = {
  kind: LoopPlusMainKind;
  interruptedAttempts?: ReadonlyMap<string, string>;
  reportOnly?: true;
  allowDispatchBeforeReview?: boolean;
  eventId: string | null;
  eventIds: string[];
  reportEventIds: string[];
  userMessageCount: number;
  reviewDependencyBlocks?: LoopPlusDependencyBlock[];
  reviewSelection?: { scheduler: LoopPlusScheduler; seq: number };
  visibleReviewCount?: number;
};

type InterruptedMain = {
  step: MainStep;
  target: LoopPlusPromptTarget;
  request: LoopPlusMainRequest;
  acceptancePlanEpoch: number;
  nativeSessionId?: string;
  generation: number;
  sendAdmitted: boolean;
};

type Lifecycle = {
  promise: LoopPlusRunResult["done"];
  resolve: (result?: "ordinary-paused") => void;
  settled: boolean;
};

type ParentRuntime = {
  taskId: string;
  ordinary: boolean;
  cli: LoopPlusPromptTarget["cli"];
  target: LoopPlusPromptTarget;
  prompt: LoopPlusRunInput;
  scheduler: LoopPlusScheduler;
  createScheduler: (options: LoopPlusSchedulerOptions) => LoopPlusScheduler;
  meta: Map<string, SubtaskMeta>;
  attempts: Map<string, InFlightAttempt>;
  finishes: Map<string, FinishDelivery>;
  attemptSeq: number;
  lastLaunchAt: number | null;
  launchChain: Promise<void>;
  consumer: Promise<void> | null;
  autoPaused: boolean;
  supplementCommitBlocked: boolean;
  pauseStatus: Extract<LoopTaskStatus, "needs-review" | "error">;
  stopRequested: boolean;
  stopping: boolean;
  initialPromptDone: boolean;
  forcePrompt: boolean;
  closeoutBudget: number;
  protocolFailureCount: number;
  protocolFailureReason: string | null;
  protocolRecovery: ReturnType<typeof readLoopPlusProtocolRecoveryFromSummary>;
  currentMain: LoopPlusMainHandle | null;
  currentMainRequest: LoopPlusMainRequest | null;
  currentMainStep: MainStep | null;
  interruptedMain: InterruptedMain | null;
  claimedMainRecovery: InterruptedMain | null;
  preparingMain?: FirstLoopMainExecution;
  /** 未确认批次的请求快照；重试和暂停恢复不得混入后到事件或消息。 */
  reviewStep: MainStep | null;
  reportStep: MainStep | null;
  /** 宿主重建前已经存在的事件按冻结批次恢复，不重新开放派发优先机会。 */
  recoveredReviewEventIds: Set<string>;
  launching: Set<string>;
  /** Running reservations whose pending park could not be persisted. */
  unstartedLaunchRecovery: Set<string>;
  launchEpoch: Map<string, number>;
  mainGeneration: number;
  /** 群聊修改验收方案时递增；进行中的验收据此丢弃旧提示并重问。 */
  acceptancePlanEpoch: number;
  /** 最近一次身份匹配的父任务记录。续跑暂时读不到时，提示继续用它，不能当成可提交的权威状态。 */
  verifiedParentContext: LoopTaskRecord | null;
  pendingMainFailure?: { parent: LoopTaskRecord; code: string; message: string; at: number };
  wakeDecisionCommit?: () => void;
  retryCompletion?: { paused: LoopTaskRecord; decision: LoopPlusDecision; step: MainStep };
  authorityWithholdCount: number;
  pumpRequested: boolean;
  reviewDependencyWait: { scheduler: LoopPlusScheduler; seq: number } | null;
  recoveringWait: boolean;
  released: boolean;
  decomposing: boolean;
  completionPatch: Partial<LoopTaskRecord> | null;
  lifecycle: Lifecycle;
};

export const LOOP_PLUS_CONSUMER_FAILURE_SUMMARY = "主任务执行意外中断，已完成的子任务结果仍保留。请在群聊查看最近进展后点击“继续执行”；若再次中断，请先确认工作区可写且网络正常后再继续。";

export function resolveLoopPlusPauseFinalSummary(
  status: "needs-review" | "error",
  message: string,
  finalSummary?: string,
): string | undefined {
  const consumerFailure = status === "error" && message === "loop-plus-consumer-failed";
  return finalSummary ?? (consumerFailure ? LOOP_PLUS_CONSUMER_FAILURE_SUMMARY : undefined);
}

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

type DecisionTaskStore = Pick<LoopPlusOrchestrationDeps, "readTask" | "updateTask">;

export function createLoopPlusOrchestrationHost(deps: LoopPlusOrchestrationDeps) {
  function updateTask(taskId: string, patch: Partial<LoopTaskRecord>, write = deps.updateTask): LoopTaskRecord {
    const updated = write(taskId, patch);
    if (!updated) {
      throw new LoopPlusUpdateUnconfirmedError(taskId);
    }
    return updated;
  }

  function logPersistenceFailure(taskId: string, stage: string, error: unknown, runtime?: ParentRuntime, attemptId?: string): void {
    const snapshot = runtime?.scheduler.snapshot();
    deps.log?.("loop-plus-persist-failed", {
      taskId, attemptId, stage,
      reason: error instanceof LoopPlusUpdateUnconfirmedError ? "update-unconfirmed" : "exception",
      phase: snapshot?.phase,
      schedulerSeq: snapshot?.seq,
      runningCount: snapshot?.running.length,
      pendingCount: snapshot?.pending.length,
      reviewCount: snapshot ? snapshot.reviewQueue.length + Number(snapshot.currentReview !== null) : undefined,
    });
  }

  const runtimes = new Map<string, ParentRuntime>();
  const interruptedSubtaskResumeRequests = new Set<string>();
  const decisionStrategies = createLoopPlusDecisionStrategyRegistry();
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const launchDelayMs = deps.launchDelayMs ?? (() => 0);
  const decisionSubtaskMax = () => resolveLoopPlusDecisionSubtaskMax(deps.decisionSubtaskMax?.());
  const maxConcurrency = () => deps.maxConcurrency ?? decisionSubtaskMax();

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
        supersedeMainRecovery(runtime);
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
            logPersistenceFailure(runtime.taskId, "completion-retry", error, runtime);
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
      let resumeSupplementCommitted: true | undefined;
      if (options.resumeRequested === true) {
        const resumeMessage = options.resumeUserMessage?.trim();
        const retained = runtime.retryCompletion?.paused;
        if (retained && (resumeMessage || existing.status !== "error" || retained.updatedAt !== existing.updatedAt
          || !sameLoopPlusMainParent(retained, existing))) runtime.retryCompletion = undefined;
        if (resumeMessage) {
          try {
            commitResumeWithSupplement(runtime, resumeMessage);
            resumeSupplementCommitted = true;
          } catch (error) {
            blockSupplementCommit(runtime);
            logPersistenceFailure(runtime.taskId, "resume-supplement", error, runtime);
            return { handled: true, taskId: runtime.taskId, done: runtime.lifecycle.promise };
          }
        } else {
          continueParent(runtime);
        }
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
      return { handled: true, taskId: runtime.taskId, done: runtime.lifecycle.promise, resumeSupplementCommitted };
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
          persist(created, {
            status: "error",
            finalSummary: `Loop+ 执行所有权初始化失败：${errorText(error)}`,
            loopPlusInterruption: {
              phase: created.scheduler.snapshot().phase,
              reason: "execution-error",
            },
          });
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
      const recovered = new Map<string, LoopPlusAttemptCompletionReceipt>();
      replayCompletionReceipts(scheduler, task, (receipt) => recovered.set(receipt.subtaskId, receipt));
      const lostAttempts = scheduler.snapshot().running.slice();
      for (const attempt of lostAttempts) {
        const result = scheduler.finish({ subtaskId: attempt.subtaskId, attemptId: attempt.attemptId,
          outcome: "stopped", detail: "lost-process" });
        if (!result.applied) throw new Error(`Loop+ stopped attempt reconciliation failed: ${result.reason}`);
      }
      const snapshot = scheduler.snapshot();
      const lostSubtasks = new Set(lostAttempts.map((attempt) => attempt.subtaskId));
      const subTasks = task.subTasks.map((subtask) => {
        const receipt = recovered.get(subtask.id);
        if (receipt) return { ...subtask, status: "completed" as const,
          summary: receipt.detail ?? subtask.summary, executionFailure: undefined, updatedAt: now() };
        return lostSubtasks.has(subtask.id) ? { ...subtask, status: "blocked" as const, updatedAt: now() } : subtask;
      });
      const updatedTask = updateTask(task.id, {
        status: "stopped",
        runtimeInterrupted: undefined,
        loopPlusNextStepPlan: undefined,
        finalSummary: "Loop+ parent scheduling is stopped.",
        schedulingMode: "event_driven",
        loopPlus: snapshot,
        activeSubtaskId: snapshot.running[0]?.subtaskId ?? null,
        activeSubtaskIds: snapshot.running.map((attempt) => attempt.subtaskId),
        subTasks,
        ...(task.loopPlusAttemptCompletionReceipts ? {
          loopPlusAttemptCompletionReceipts: undefined,
        } : {}),
        updatedAt: now(),
      });
      for (const attempt of lostAttempts) {
        const subtask = task.subTasks.find((item) => item.id === attempt.subtaskId);
        if (!subtask || !deps.recordAttempt) continue;
        try {
          deps.recordAttempt({ task: updatedTask, subtaskId: attempt.subtaskId, attemptId: attempt.attemptId,
            outcome: "stopped", detail: "lost-process", communicationFile: subtask.communicationFile });
        } catch (error) {
          deps.log?.("loop-plus-report-failed", { taskId: task.id, attemptId: attempt.attemptId, error: errorText(error) });
        }
      }
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
      persist(runtime, { status: runtime.autoPaused ? runtime.pauseStatus : "running", runtimeInterrupted: undefined });
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

  function sameMainBinding(left: LoopPlusPromptTarget, right: LoopPlusPromptTarget): boolean {
    return left.tabId === right.tabId && left.cli === right.cli && left.sessionId === right.sessionId
      && left.loopTaskId === right.loopTaskId && left.loopSubtaskId === right.loopSubtaskId;
  }

  function isLiveMainRecovery(runtime: ParentRuntime, interrupted: InterruptedMain): boolean {
    const snapshot = runtime.scheduler.snapshot();
    return runtimes.get(runtime.taskId) === runtime && !runtime.released && !runtime.autoPaused
      && !runtime.stopRequested && !runtime.stopping && !runtime.lifecycle.settled
      && !snapshot.parentStopped && !snapshot.completed && !runtime.recoveringWait
      && interrupted.generation === runtime.mainGeneration
      && sameMainBinding(runtime.target, interrupted.target);
  }

  function isRecoverableMainTask(task: LoopTaskRecord | null, target: LoopPlusPromptTarget, taskId: string): task is LoopTaskRecord {
    const snapshot = task?.loopPlus as Partial<LoopPlusSchedulerSnapshot> | undefined;
    return !!task && task.id === taskId && task.status === "running" && task.schedulingMode === "event_driven"
      && task.department === undefined && !task.departmentInvalid && !task.runtimeInterrupted && !task.userStopSource
      && !task.pendingClarification && !task.loopPlusBlockReview && !isLoopMainAiFailureLimitReached(task)
      && !!snapshot && !snapshot.parentStopped && !snapshot.completed
      && !!target.tabId && !!target.sessionId && target.cli === "codex" && task.cli === target.cli && task.sessionId === target.sessionId
      && !target.loopSubtaskId && (!target.loopTaskId || target.loopTaskId === task.id);
  }

  function canSendMainRecovery(runtime: ParentRuntime, interrupted: InterruptedMain): boolean {
    const stillClaimed = () => runtime.claimedMainRecovery === interrupted && isLiveMainRecovery(runtime, interrupted);
    if (!stillClaimed()) return false;
    try {
      const task = (deps.readMainRecoveryTask ?? deps.readTask)(runtime.taskId);
      return isRecoverableMainTask(task, interrupted.target, runtime.taskId)
        && (task.loopPlusMainRecoveryFailureCount ?? 0) < MAIN_RECOVERY_FAILURE_LIMIT
        && deps.canAutoResumeMain?.(task, { ...interrupted.target }, interrupted.nativeSessionId) === true && stillClaimed();
    } catch (error) {
      deps.log?.("loop-plus-main-recovery-check-failed", { taskId: runtime.taskId, error: errorText(error) });
      return false;
    }
  }

  function abandonMainRecovery(runtime: ParentRuntime, interrupted: InterruptedMain): void {
    if (runtime.claimedMainRecovery !== interrupted) return;
    runtime.claimedMainRecovery = null;
    if (interrupted.generation !== runtime.mainGeneration || runtime.stopRequested || runtime.released) return;
    runtime.autoPaused = true;
    settle(runtime);
    deps.log?.("loop-plus-main-recovery-denied", { taskId: runtime.taskId });
  }

  function checkInterruptedMainTasks(): void {
    for (const runtime of runtimes.values()) {
      const interrupted = runtime.interruptedMain;
      if (!interrupted || runtime.claimedMainRecovery || runtime.consumer || runtime.currentMain || runtime.preparingMain || runtime.recoveringWait) continue;
      runtime.interruptedMain = null;
      runtime.claimedMainRecovery = interrupted;
      if (!canSendMainRecovery(runtime, interrupted)) {
        abandonMainRecovery(runtime, interrupted);
        continue;
      }
      pump(runtime, undefined, undefined, interrupted);
    }
  }

  function supersedeMainRecovery(runtime: ParentRuntime): void {
    runtime.interruptedMain = null;
    const claimed = runtime.claimedMainRecovery;
    if (!claimed || claimed.sendAdmitted) return;
    runtime.claimedMainRecovery = null;
    runtime.mainGeneration += 1;
    runtime.currentMain?.abort();
  }

  function checkWaitingMainTasks(): void {
    for (const runtime of runtimes.values()) {
      for (const delivery of [...runtime.finishes.values()]) delivery.wake?.();
      if (runtime.wakeDecisionCommit) {
        runtime.wakeDecisionCommit();
        continue;
      }
      if (runtime.released || runtime.autoPaused || runtime.supplementCommitBlocked || runtime.lifecycle.settled
        || runtime.stopRequested || runtime.stopping || runtime.recoveringWait || runtime.consumer
        || runtime.currentMain || runtime.preparingMain || runtime.interruptedMain || runtime.claimedMainRecovery) continue;
      try {
        const snapshot = runtime.scheduler.snapshot();
        if (snapshot.completed || snapshot.parentStopped) continue;
        const reviewDue = Boolean(snapshot.currentReview || snapshot.reviewQueue.length)
          && !waitingForReviewDependency(runtime, snapshot);
        const idle = runtime.ordinary && runtime.initialPromptDone && !runtime.pendingMainFailure
          && hasNoExecutingSubtasks(runtime, snapshot.running);
        if (!idle && !reviewDue) continue;
        const task = deps.readTask(runtime.taskId);
        if (!task || task.status !== "running" || task.userStopSource
          || task.pendingClarification || task.loopPlusBlockReview || isLoopMainAiFailureLimitReached(task)) continue;
        if (idle) submitIdleSupplement(runtime, task, snapshot);
        else if (!task.runtimeInterrupted) requestPump(runtime);
      } catch (error) {
        deps.log?.("loop-plus-main-watchdog-check-failed", { taskId: runtime.taskId, error: errorText(error) });
      }
    }
  }

  function checkWaitingTasks(recoverIdle = true): void {
    for (const runtime of runtimes.values()) {
      try {
        if (runtime.pendingMainFailure) {
          commitPendingMainFailure(runtime);
          continue;
        }
        const snapshot = runtime.scheduler.snapshot();
        const task = deps.readTask(runtime.taskId);
        if (!task || task.status !== "running" || task.pendingClarification || task.userStopSource || task.runtimeInterrupted
          || task.loopPlusBlockReview || isLoopMainAiFailureLimitReached(task)
          || runtime.released || runtime.autoPaused || runtime.stopRequested || runtime.stopping
          || snapshot.completed || snapshot.parentStopped
          || runtime.interruptedMain || runtime.claimedMainRecovery
          || (!deps.hasActiveSubtask && deps.hasActiveSubtasks?.(runtime.taskId))) continue;
        const busy = Boolean(runtime.currentMain || runtime.consumer || runtime.launching.size);
        if (!busy && relaunchUnstartedLaunchRecovery(runtime)) continue;
        const lost = snapshot.running.filter((record) => {
          if ((!runtime.ordinary && runtime.meta.has(record.subtaskId)) || runtime.launching.has(record.attemptId)
            || runtime.unstartedLaunchRecovery.has(record.attemptId) || runtime.finishes.has(record.attemptId)
            || deps.hasActiveSubtask?.(runtime.taskId, record.subtaskId, record.attemptId)) return false;
          const attempt = runtime.attempts.get(record.attemptId);
          if (attempt && !attempt.settled) return attempt.isActive?.() === false;
          return !attempt && runtime.meta.get(record.subtaskId)?.executionStatus !== "blocked";
        });
        if (!lost.length && (busy || !recoverIdle || snapshot.running.length)) continue;
        runtime.recoveringWait = true;
        try {
          for (const record of lost) {
            if (runtime.autoPaused || runtime.stopRequested || runtime.released) break;
            const receipts = task.loopPlusAttemptCompletionReceipts?.filter(receipt => receipt.attemptId === record.attemptId);
            const receipt = receipts?.length === 1 && receipts[0].subtaskId === record.subtaskId ? receipts[0] : undefined;
            const observed = runtime.attempts.get(record.attemptId)?.readLostOutcome?.();
            discardLostAttempt(runtime, record);
            safeApplyFinish(runtime, {
              subtaskId: record.subtaskId,
              attemptId: record.attemptId,
              ...(receipt ? { outcome: "completed", detail: receipt.detail } : observed ?? {
                outcome: "unconfirmed",
                detail: "定时检查发现子任务已失联，完成状态未确认。请检查已有报告和产物，确认是否可以验收，或续接未完成的工作。",
              }),
            });
          }
        } finally {
          runtime.recoveringWait = false;
        }
        if (runtime.autoPaused || runtime.stopRequested || runtime.released) continue;
        if (!lost.length) promotePendingAndLaunch(runtime);
        const current = runtime.scheduler.snapshot();
        if (current.running.length === 0 && current.pending.length === 0) {
          runtime.closeoutBudget = Math.max(runtime.closeoutBudget, 1);
        }
        if (!lost.length) persist(runtime);
        deps.log?.("loop-plus-wait-watchdog-recovered", { taskId: runtime.taskId, lostAttempts: lost.length });
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
    const snapshot = createLoopPlusScheduler({ maxConcurrency: maxConcurrency() }).snapshot();
    const task = deps.createTask({
      cli: target.cli,
      rootPrompt: input.displayPrompt,
      sessionId,
      snapshot,
      prompt: input,
    });
    const runtime = buildRuntime(task, target, input, { snapshot });
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
    const runtime = buildRuntime(task, target, input, {
      snapshot: task.loopPlus,
      maxConcurrency: maxConcurrency(),
    });
    const { scheduler } = runtime;
    if (!scheduler.snapshot().parentStopped) parkUnconfirmedColdAttempts(runtime, task);
    const hadRunning = scheduler.snapshot().running.length > 0;
    const recoveredFinish = !preparingResume && restoreCompletionReceipts(runtime, task);
    if (recoveredFinish && !runtime.stopRequested && !runtime.autoPaused) {
      runtime.autoPaused = true;
      runtime.pauseStatus = "error";
    }
    runtime.initialPromptDone = runtime.protocolFailureReason !== null
      || scheduler.snapshot().seenAttempts.length > 0
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
    if (!preparingResume && ((task.loopPlusMainPhase === "decomposing") !== runtime.decomposing || hadRunning)) {
      persist(runtime, recoveredFinish && !runtime.stopRequested && !task.finalSummary ? {
        finalSummary: "已恢复子任务执行回执，继续主任务以进行验收或确认报告。",
      } : {});
    }
    if (recoveredFinish && runtime.autoPaused) settle(runtime);
    runtimes.set(task.id, runtime);
    return runtime;
  }

  function parkUnconfirmedColdAttempts(runtime: ParentRuntime, task: LoopTaskRecord): void {
    for (const attempt of runtime.scheduler.snapshot().running) {
      const meta = runtime.meta.get(attempt.subtaskId);
      if (!meta) continue;
      meta.executionStatus = "blocked";
      const proof = task.subTasks.find(subtask => subtask.id === attempt.subtaskId)?.launchReservation;
      if (runtime.ordinary && deps.commitOrdinaryRun && proof?.attemptId === attempt.attemptId && proof.state === "waiting") {
        meta.executionFailure = undefined;
        runtime.unstartedLaunchRecovery.add(attempt.attemptId);
        continue;
      }
      meta.executionFailure ??= UNCONFIRMED_ATTEMPT_RESULT;
    }
  }

  function restoreCompletionReceipts(runtime: ParentRuntime, task: LoopTaskRecord): boolean {
    return replayCompletionReceipts(runtime.scheduler, task, (receipt, result) => {
      setFinishMetadata(runtime, { ...receipt, outcome: "completed" });
      releaseUnstartedReservations(runtime, result.started);
      if (result.eventId) runtime.recoveredReviewEventIds.add(result.eventId);
    });
  }

  function replayCompletionReceipts(
    scheduler: LoopPlusScheduler,
    task: LoopTaskRecord,
    onRestored: (receipt: LoopPlusAttemptCompletionReceipt, result: LoopPlusFinishResult) => void = () => undefined,
  ): boolean {
    const receipts = task.loopPlusAttemptCompletionReceipts;
    if (!receipts?.length || task.status === "completed") return false;
    const uniqueReceipts = new Map<string, LoopPlusAttemptCompletionReceipt | null>();
    for (const receipt of receipts) {
      uniqueReceipts.set(receipt.attemptId, uniqueReceipts.has(receipt.attemptId) ? null : receipt);
    }
    const running = new Map(scheduler.snapshot().running.map((attempt) => [attempt.attemptId, attempt.subtaskId]));
    let restored = false;
    for (const receipt of uniqueReceipts.values()) {
      if (!receipt || running.get(receipt.attemptId) !== receipt.subtaskId) continue;
      const result = scheduler.finish({ ...receipt, outcome: "completed" });
      if (!result.applied) continue;
      onRestored(receipt, result);
      restored = true;
    }
    return restored;
  }

  function buildRuntime(
    task: LoopTaskRecord,
    target: LoopPlusPromptTarget,
    input: LoopPlusRunInput,
    schedulerOptions: LoopPlusSchedulerOptions,
  ): ParentRuntime {
    const requireAcceptedDependencies = requiresLoopPlusAcceptedDependencies(task);
    const createScheduler = (options: LoopPlusSchedulerOptions) =>
      createLoopPlusScheduler({ ...options, requireAcceptedDependencies });
    const scheduler = createScheduler(schedulerOptions);
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
    return {
      taskId: task.id,
      ordinary: !task.department && !task.departmentInvalid,
      cli: task.cli,
      target,
      prompt: input,
      scheduler,
      createScheduler,
      meta,
      attempts: new Map(),
      finishes: new Map(),
      attemptSeq: nextAttemptSequence(scheduler.snapshot()),
      lastLaunchAt: null,
      launchChain: Promise.resolve(),
      consumer: null,
      autoPaused: task.status === "needs-review" || task.status === "error",
      supplementCommitBlocked: false,
      pauseStatus: task.status === "error" ? "error" : "needs-review",
      stopRequested: scheduler.snapshot().parentStopped,
      stopping: false,
      initialPromptDone: false,
      forcePrompt: false,
      closeoutBudget: 0,
      protocolFailureCount: 0,
      protocolFailureReason: readLoopPlusProtocolFailureFromSummary(task.finalSummary),
      protocolRecovery: readLoopPlusProtocolRecoveryFromSummary(task.finalSummary),
      currentMain: null,
      currentMainRequest: null,
      currentMainStep: null,
      interruptedMain: null,
      claimedMainRecovery: null,
      reviewStep: null,
      reportStep: null,
      recoveredReviewEventIds: new Set(snapshot.currentReview
        ? [snapshot.currentReview, ...snapshot.reviewQueue]
          .slice(0, LOOP_PLUS_ACCEPTANCE_BATCH_MAX)
          .map((item) => item.eventId)
        : []),
      launching: new Set<string>(),
      unstartedLaunchRecovery: new Set<string>(),
      launchEpoch: new Map(),
      mainGeneration: 0,
      acceptancePlanEpoch: 0,
      verifiedParentContext: { ...task, id: task.id },
      authorityWithholdCount: 0,
      pumpRequested: false,
      reviewDependencyWait: null,
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

  function continueParent(runtime: ParentRuntime): void {
    supersedeMainRecovery(runtime);
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
          logPersistenceFailure(runtime.taskId, "resume-blocked", error, runtime);
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
    if (runtime.protocolFailureCount > 0) {
      deps.log?.("loop-plus-protocol-recovery", {
        taskId: runtime.taskId,
        attemptState: "explicit_resume",
        protocolFailureCount: runtime.protocolFailureCount,
        automaticRetryLimit: LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT,
        result: "manual_resume",
      });
    }
    runtime.protocolFailureCount = 0;
    runtime.forcePrompt = false;
    armLifecycle(runtime);
    const task = deps.readTask(runtime.taskId);
    if (task?.finalSummary?.startsWith(LOOP_PLUS_PROTOCOL_PAUSE_HEADING)) {
      runtime.protocolFailureReason ??= readLoopPlusProtocolFailureFromSummary(task.finalSummary);
      runtime.protocolRecovery ??= readLoopPlusProtocolRecoveryFromSummary(task.finalSummary);
      updateTask(runtime.taskId, { finalSummary: undefined });
    } else if (task?.finalSummary && (task.loopPlusInterruption || task.loopPlusBlockReview)) {
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

  function commitResumeWithSupplement(runtime: ParentRuntime, text: string): void {
    const before = runtime.scheduler.snapshot();
    const staged = runtime.createScheduler({ snapshot: before, maxConcurrency: maxConcurrency() });
    let started: readonly LoopPlusExecutionRecord[] = [];
    if (staged.snapshot().parentStopped) {
      const resumed = staged.resumeParent();
      if (!resumed.ok) {
        throw new Error(`Loop+ resume blocked: ${resumed.reason}`);
      }
      started = resumed.started;
    }
    const queued = staged.enqueueUserMessage(text);
    if (!queued.queued) {
      throw new Error("Loop+ supplemental requirement could not be queued");
    }
    const task = deps.readTask(runtime.taskId);
    const patch: Partial<LoopTaskRecord> = {
      status: "running",
      runtimeInterrupted: undefined,
      userStopSource: undefined,
      loopPlusBlockReview: undefined,
      loopPlus: staged.snapshot(),
      ...(task?.finalSummary && (task.loopPlusInterruption || task.loopPlusBlockReview || task.finalSummary.startsWith(LOOP_PLUS_PROTOCOL_PAUSE_HEADING)) ? { finalSummary: undefined } : {}),
      ...buildResetLoopMainAiFailureState(),
      mainAiLastFailureCode: undefined,
      updatedAt: now(),
    };
    const updated = deps.updateTask(runtime.taskId, patch);
    if (!updated) throw new LoopPlusUpdateUnconfirmedError(runtime.taskId);

    runtime.scheduler = staged;
    runtime.supplementCommitBlocked = false;
    runtime.autoPaused = false;
    runtime.stopRequested = false;
    if (runtime.protocolFailureCount > 0) {
      deps.log?.("loop-plus-protocol-recovery", {
        taskId: runtime.taskId,
        attemptState: "explicit_resume",
        protocolFailureCount: runtime.protocolFailureCount,
        automaticRetryLimit: LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT,
        result: "manual_resume",
      });
    }
    runtime.protocolFailureCount = 0;
    runtime.forcePrompt = false;
    armLifecycle(runtime);
    supersedeMainRecovery(runtime);
    launchAll(runtime, started);
    try {
      deps.appendMessage(runtime.target, "loop-plus-resumed", runtime.taskId);
    } catch (error) {
      deps.log?.("loop-plus-resumed-message-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    if (runtime.currentMain) return;
    requestPump(runtime);
  }

  function persistResumeTransition(
    runtime: ParentRuntime,
    before: LoopPlusSchedulerSnapshot,
    status: "running" | "stopped",
    store: DecisionTaskStore = deps,
  ): void {
    try {
      persist(runtime, { status, runtimeInterrupted: undefined, ...(status === "running" ? { userStopSource: undefined } : {}) }, store);
    } catch (error) {
      // These reservations have not launched. Preserve pending attempts and the
      // parent gate instead of later reconciling them as lost running processes.
      // The snapshot is taken after reconciliation, retaining earlier finishes.
      runtime.scheduler = runtime.createScheduler({ snapshot: before });
      if (store !== deps) throw error;
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
    const restarted = relaunchInterruptedSubtasks(runtime) || relaunchUnstartedLaunchRecovery(runtime);
    if (restarted) requestPump(runtime);
    return restarted;
  }

  function relaunchInterruptedSubtasks(runtime: ParentRuntime): boolean {
    const interrupted = runtime.scheduler.snapshot().running.filter(record => isInterruptedReservation(runtime, record));
    interrupted.forEach((record) => runtime.attempts.delete(record.attemptId));
    launchAll(runtime, interrupted);
    return interrupted.length > 0;
  }

  function isInterruptedReservation(runtime: ParentRuntime, record: LoopPlusExecutionRecord): boolean {
    if (runtime.meta.get(record.subtaskId)?.executionStatus !== "blocked" || runtime.launching.has(record.attemptId)
      || runtime.unstartedLaunchRecovery.has(record.attemptId) || runtime.finishes.has(record.attemptId)) return false;
    const attempt = runtime.attempts.get(record.attemptId);
    if (attempt && !attempt.settled) return false;
    return !(deps.hasActiveSubtask
      ? deps.hasActiveSubtask(runtime.taskId, record.subtaskId, record.attemptId)
      : deps.hasActiveSubtasks?.(runtime.taskId));
  }

  function hasNoExecutingSubtasks(runtime: ParentRuntime, running: readonly LoopPlusExecutionRecord[]): boolean {
    return !runtime.launching.size && !runtime.unstartedLaunchRecovery.size && !runtime.finishes.size
      && running.every(record => isInterruptedReservation(runtime, record)) && !deps.hasActiveSubtasks?.(runtime.taskId);
  }

  function hasInterruptedWork(runtime: ParentRuntime, snapshot: LoopPlusSchedulerSnapshot): boolean {
    return runtime.ordinary && snapshot.running.some(record => isInterruptedReservation(runtime, record));
  }

  function waitingForReviewDependency(runtime: ParentRuntime, snapshot: LoopPlusSchedulerSnapshot): boolean {
    const deferred = runtime.reviewDependencyWait;
    return deferred?.scheduler === runtime.scheduler && deferred.seq === snapshot.seq && !hasInterruptedWork(runtime, snapshot);
  }

  function relaunchUnstartedLaunchRecovery(runtime: ParentRuntime): boolean {
    if (runtime.released || runtime.autoPaused || runtime.stopRequested
      || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
      return false;
    }
    const ready = runtime.scheduler.snapshot().running.filter((record) => {
      if (!runtime.unstartedLaunchRecovery.has(record.attemptId) || runtime.launching.has(record.attemptId)) return false;
      if (runtime.finishes.has(record.attemptId)) return false;
      const attempt = runtime.attempts.get(record.attemptId);
      return !attempt || attempt.settled;
    });
    if (ready.length === 0) return false;
    for (const record of ready) {
      runtime.unstartedLaunchRecovery.delete(record.attemptId);
      const meta = runtime.meta.get(record.subtaskId);
      if (meta?.executionStatus === "blocked" && !meta.executionFailure) meta.executionStatus = "pending";
    }
    launchAll(runtime, ready);
    return true;
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
      if (!parentStopping && (runtime.meta.get(record.subtaskId)?.executionStatus === "blocked" || runtime.unstartedLaunchRecovery.has(record.attemptId))) {
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
    runtime.pendingMainFailure = undefined;
    runtime.retryCompletion = undefined;
    runtime.stopRequested = true;
    runtime.autoPaused = false;
    runtime.decomposing = false;
    runtime.mainGeneration += 1;
    runtime.interruptedMain = null;
    runtime.claimedMainRecovery = null;
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
      logPersistenceFailure(runtime.taskId, "parent-stop", error, runtime);
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
    if (runtime.supplementCommitBlocked) return;
    runtime.reviewDependencyWait = null;
    if (runtime.consumer) {
      runtime.pumpRequested = true;
      return;
    }
    pump(runtime);
  }

  function pump(runtime: ParentRuntime, firstMainExecution?: FirstLoopMainExecution, resumeUserMessage?: string, recovery?: InterruptedMain): void {
    if (runtime.released || runtime.consumer || runtime.interruptedMain || runtime.claimedMainRecovery !== (recovery ?? null)
      || runtime.recoveringWait || (runtime.autoPaused && !firstMainExecution) || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
      return;
    }
    runtime.pumpRequested = false;
    runtime.preparingMain = firstMainExecution;
    let ownedLifecycle = runtime.lifecycle;
    const consumer: Promise<void> = runConsumer(runtime, () => {
      ownedLifecycle = runtime.lifecycle;
    }, firstMainExecution, resumeUserMessage, recovery).catch((error: unknown) => {
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
      if (recovery && runtime.claimedMainRecovery === recovery) runtime.claimedMainRecovery = null;
      const followUp = runtime.pumpRequested || runtime.forcePrompt;
      runtime.pumpRequested = false;
      if (!followUp || runtime.autoPaused || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
        return;
      }
      pump(runtime);
    });
    runtime.consumer = consumer;
  }

  async function runConsumer(runtime: ParentRuntime, adoptCommittedLifecycle: () => void, firstMainExecution?: FirstLoopMainExecution, resumeUserMessage?: string, recovery?: InterruptedMain): Promise<void> {
    if (recovery) await Promise.resolve();
    while ((firstMainExecution || !runtime.autoPaused) && !runtime.stopRequested && !runtime.scheduler.snapshot().parentStopped) {
      const execution = firstMainExecution;
      firstMainExecution = undefined;
      const recovering = recovery;
      recovery = undefined;
      if (recovering && runtime.claimedMainRecovery !== recovering) return;
      let step = recovering?.step ?? (execution ? null : planStep(runtime));
      if (!step && !execution) return;
      const retained = runtime.retryCompletion;
      runtime.retryCompletion = undefined;
      if (retained && step && !execution && !recovering && deps.commitOrdinaryRun
        && sameLoopPlusReportIds(retained.step.reportEventIds, step.reportEventIds)
        && retained.step.userMessageCount === step.userMessageCount) {
        const staged = readyCompletion(runtime, step, retained.decision);
        if (staged) {
          const outcome = await commitReadyCompletion(runtime, step, retained.decision, staged, retained.paused, deps.commitOrdinaryRun);
          if (outcome === "stop") return;
          continue;
        }
      }
      const generation = runtime.mainGeneration;
      const acceptancePlanEpoch = runtime.acceptancePlanEpoch;
      const request = recovering ? {
        ...(recovering.acceptancePlanEpoch === acceptancePlanEpoch ? recovering.request : buildMainRequest(runtime, recovering.step)),
        target: { ...recovering.target },
      } : step ? buildMainRequest(runtime, step) : {
        taskId: runtime.taskId, kind: "continue" as const, target: runtime.target,
        prompt: runtime.prompt.displayPrompt, modelPrompt: runtime.prompt.modelPrompt ?? runtime.prompt.displayPrompt,
        reviewEventId: null, firstMainExecution: execution,
      };
      let originalParent = runtime.verifiedParentContext;
      if (execution) {
        execution.prepareMain = (task) => {
          const draft: ParentRuntime = {
            ...runtime,
            scheduler: runtime.createScheduler({ snapshot: task.loopPlus, maxConcurrency: maxConcurrency() }),
            meta: new Map([...runtime.meta].map(([id, meta]) => [id, { ...meta }])),
            recoveredReviewEventIds: new Set(runtime.recoveredReviewEventIds),
            launchEpoch: new Map(runtime.launchEpoch),
            launching: new Set(runtime.launching),
            unstartedLaunchRecovery: new Set(runtime.unstartedLaunchRecovery),
            autoPaused: false,
            protocolFailureCount: 0,
            forcePrompt: true,
          };
          restoreCompletionReceipts(draft, task);
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
            userStopSource: undefined,
            status: "running",
            supplementalRequirements: execution.resumeRequirements?.(task) ?? task.supplementalRequirements,
          };
          const projectedTask = { ...task, ...patch };
          const preparedRequest = buildMainRequest(draft, preparedStep, projectedTask);
          const persistedPatch = buildPersistencePatch(draft, task, patch);
          return {
            displayPrompt: preparedRequest.prompt,
            modelPrompt: preparedRequest.modelPrompt,
            commit: () => {
              originalParent = updateTask(runtime.taskId, persistedPatch, deps.commitConfigLockResume);
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
      }
      let handle: LoopPlusMainHandle | null = null;
      let content: string | null = null;
      let failed = false;
      let failureMessage = "";
      let failureInfo: ErrorInfo | undefined;
      let recoverySendDenied = false;
      const originalTarget = { ...request.target };
      const startedAt = Date.now();
      try {
        if (recovering) {
          if (!canSendMainRecovery(runtime, recovering)) {
            abandonMainRecovery(runtime, recovering);
            return;
          }
          request.interruptedNativeSessionId = recovering.nativeSessionId;
          request.canSendAutoResumedMain = () => {
            if (recovering.sendAdmitted || recoverySendDenied) return false;
            const allowed = canSendMainRecovery(runtime, recovering);
            recovering.sendAdmitted = allowed;
            recoverySendDenied = !allowed;
            return allowed;
          };
        }
        if (step?.kind === "user" && !recovering) {
          deps.appendMessage(runtime.target, "loop-plus-user-messages", runtime.taskId);
        }
        handle = deps.runMain(request);
        runtime.currentMainRequest = request;
        runtime.currentMainStep = step;
        runtime.currentMain = handle;
        content = await handle.promise;
        if (content === null && acceptancePlanEpoch === runtime.acceptancePlanEpoch && !runtime.stopRequested && !runtime.released && !runtime.autoPaused
          && (!execution || execution.admitted) && !recovering && !handle.wasCancelled?.() && !wasMainInterrupted(handle)) {
          throw loopPlusMainFailure("LOOP_PLUS_RUN_UNCONFIRMED");
        }
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
      if (step) recordMainTerminal(runtime, step, content, Date.now() - startedAt, failed, failureInfo?.code);
      const executionCode = failureInfo?.code;
      const admissionFailed = isLoopPlusMainFailureCode(executionCode);
      const supersededByPlan = acceptancePlanEpoch !== runtime.acceptancePlanEpoch && !admissionFailed;
      if (recovering && !recovering.sendAdmitted && (!supersededByPlan || recoverySendDenied)) {
        abandonMainRecovery(runtime, recovering);
        return;
      }
      if (recovering && !supersededByPlan && runtime.claimedMainRecovery === recovering) runtime.claimedMainRecovery = null;
      if (!step || (execution && !execution.admitted) || runtime.released || runtime.autoPaused || generation !== runtime.mainGeneration || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
        return;
      }
      if (supersededByPlan) {
        if (recovering) {
          recovering.sendAdmitted = false;
          recovery = recovering;
        }
        continue;
      }
      if (admissionFailed && originalParent && !originalParent.department && !originalParent.departmentInvalid) {
        runtime.autoPaused = true;
        runtime.pauseStatus = "needs-review";
        runtime.decomposing = false;
        runtime.pendingMainFailure = { parent: originalParent, code: executionCode, message: failureMessage, at: now() };
        commitPendingMainFailure(runtime);
        settle(runtime);
        return;
      }
      if (!admissionFailed && handle?.wasCancelled?.()) {
        stopRuntime(runtime);
        return;
      }
      const task = deps.readTask(runtime.taskId);
      if (!execution && !admissionFailed && wasMainInterrupted(handle)) {
        const boundTarget = { ...originalTarget, sessionId: originalTarget.sessionId ?? request.target.sessionId };
        const interrupted: InterruptedMain = {
          step, target: boundTarget, request: { ...request, target: boundTarget }, generation, acceptancePlanEpoch, sendAdmitted: false,
          nativeSessionId: handle?.getInterruptedNativeSessionId?.(),
        };
        if (!isLiveMainRecovery(runtime, interrupted) || !isRecoverableMainTask(task, boundTarget, runtime.taskId)) {
          runtime.autoPaused = true;
          settle(runtime);
          return;
        }
        const failureCount = (task.loopPlusMainRecoveryFailureCount ?? 0) + Number(!!recovering);
        if (failureCount >= MAIN_RECOVERY_FAILURE_LIMIT) {
          pause(runtime, "needs-review", "loop-plus-main-recovery-exhausted",
            `主任务自动续跑已连续意外中断 ${failureCount} 次，自动续跑已停止。`, true,
            { loopPlusMainRecoveryFailureCount: failureCount });
          return;
        }
        if (recovering) {
          updateTask(runtime.taskId, { loopPlusMainRecoveryFailureCount: failureCount, updatedAt: now() });
        }
        runtime.interruptedMain = interrupted;
        deps.log?.("loop-plus-main-interrupted", { taskId: runtime.taskId, kind: step.kind, failureCount });
        return;
      }
      const unknownRecoveryExit = !!recovering && (failed || content === null);
      const failure = failed || unknownRecoveryExit ? buildNextLoopMainAiFailureState(task ?? {}, {
        failureMessage: failureMessage || (unknownRecoveryExit ? "无法确认主任务自动续跑的退出原因。" : ""), now: now(),
      }) : null;
      const nonRetryable = unknownRecoveryExit || execution?.startRejected || admissionFailed || failureInfo?.code === "DEPARTMENT_NATIVE_UNKNOWN"
        || failureInfo?.code === "SESSION_RUN_ACTIVE" || isNonRetryableCodexThreadError(failureInfo?.code, failureMessage);
      if (failure) {
        const code = failureInfo?.code;
        updateTask(runtime.taskId, {
          ...failure,
          mainAiLastFailureCode: code === RUNTIME_CONFIG_LOCK_TIMEOUT && handle?.hasStarted?.() !== false ? null : code ?? null,
          schedulingMode: "event_driven",
          updatedAt: now(),
        });
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
      const parent = resolveParentContext(runtime, "decision-validation", step);
      const guardedParent = deps.commitOrdinaryRun && originalParent && !originalParent.department && !originalParent.departmentInvalid
        ? originalParent : null;
      const acceptancePlanKeys = listLoopPlusAcceptancePlanFeedbackItems(parent.record?.loopPlusAcceptancePlan)
        .map((item) => item.key);
      // 用户可在主模型执行期间改设置，提交决策前同步准入容量。
      runtime.scheduler.updateMaxConcurrency(maxConcurrency());
      const parsed = parseLoopPlusDecisionForFrozenInput(content, {
        subtaskMax: decisionSubtaskMax(),
        acceptancePlanKeys,
        requireAcceptanceFeedback: true,
        requireProgressPercent: true,
        allowDirectCompletion: canCompleteDirectly(runtime, parent.authoritative ? parent.record : guardedParent),
        frozenReviewEventIds: step.eventIds.slice(),
      });
      const decision = parsed.decision;
      if (decision?.status === "clarify") {
        const outcome = await waitForLoopPlusClarification(runtime, step, decision, content ?? "");
        if (outcome === "stop") {
          return;
        }
        continue;
      }
      const application = applyDecision(runtime, step, parsed, guardedParent);
      const applied = typeof application === "string" ? application : await application;
      if (applied === "stop") {
        return;
      }
      if (applied === "wait") {
        const interrupted = step.interruptedAttempts;
        if (interrupted?.size && runtime.scheduler.snapshot().running.some(record =>
          interrupted.get(record.subtaskId) === record.attemptId && isInterruptedReservation(runtime, record))) {
          runtime.forcePrompt = true;
          runtime.reviewDependencyWait = null;
          continue;
        }
        if (hasUserMessages(runtime) || hasReview(runtime) || hasReports(runtime)) {
          continue;
        }
        return;
      }
    }
  }

  function wasMainInterrupted(handle: LoopPlusMainHandle | null): boolean {
    try {
      return handle?.wasUnexpectedlyInterrupted?.() === true && handle.hasStarted?.() === true;
    } catch {
      return false;
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
    if (runtime.reportStep) return runtime.reportStep;
    if (!preparingTask && waitingForReviewDependency(runtime, snapshot)) return null;
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
    if (runtime.forcePrompt || runtime.protocolFailureReason) {
      runtime.forcePrompt = false;
      return plain("continue");
    }
    if (reviewDependencyBlocks.length > 0) {
      if (!current.running.length || hasInterruptedWork(runtime, current)) return plain("continue");
      runtime.reviewDependencyWait = { scheduler: runtime.scheduler, seq: current.seq };
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
        && !runtime.protocolFailureReason && !deps.readTask(runtime.taskId)?.loopPlusBlockReview
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

  function createDecisionPort(runtime: ParentRuntime, step: MainStep, decision: LoopPlusDecision, store: DecisionTaskStore = deps): LoopPlusDecisionStrategyPort {
    const controlPlans = new WeakMap<LoopPlusDecisionControlPlan, ControlPlan>();
    let collaborationSubmitted = false;
    const submitCollaboration = () => {
      if (collaborationSubmitted) return;
      collaborationSubmitted = true;
      if (!decision.departmentCollaborations?.length && !decision.departmentCollaborationIssue) return;
      const task = deps.readTask(runtime.taskId);
      if (task?.departmentInvalid || task?.department?.role !== "leader") return;
      const logRejected = (reason: string) => deps.log?.("department-leader-collaboration-rejected", { taskId: runtime.taskId, reason });
      if (decision.departmentCollaborationIssue) logRejected(decision.departmentCollaborationIssue);
      for (const message of decision.departmentCollaborations ?? []) {
        try {
          const result = deps.submitDepartmentCollaboration?.(runtime.taskId, message);
          if (!result?.ok) logRejected(result?.reason ?? "unavailable");
        } catch {
          logRejected("submission-failed");
        }
      }
    };
    return {
      queueView() {
        const snapshot = runtime.scheduler.snapshot();
        return {
          hasCurrentReview: Boolean(snapshot.currentReview),
          hasReview: Boolean(snapshot.currentReview) || snapshot.reviewQueue.length > 0,
          hasReports: (snapshot.reportQueue?.length ?? 0) > 0,
          hasUserMessages: snapshot.userMessageQueue.length > 0,
          runningCount: snapshot.running.length,
          hasInterruptedWork: hasInterruptedWork(runtime, snapshot),
          pendingCount: snapshot.pending.length,
          parentStopped: snapshot.parentStopped,
          reviewDependencyBlocks: currentReviewDependencyBlocks(runtime, step, snapshot.seq),
          requiredRepairIds: snapshot.seenAttempts.filter((item) => item.repairRequired).map((item) => item.subtaskId),
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
      protocolMiss(held: boolean, reason?: string, diagnostic?: LoopPlusProtocolDiagnostic): LoopPlusDecisionOutcome {
        const decisionStatus = diagnostic?.reasonCode === "state.dispatch.rejected"
          && (decision.status === "dispatch" || decision.status === "accept")
          ? decision.status : undefined;
        return protocolMiss(runtime, held, reason, diagnostic?.rejectionKind ?? "validation", undefined, undefined, diagnostic, step.allowDispatchBeforeReview === true, decisionStatus);
      },
      markDecisionAccepted() {
        submitCollaboration();
        clearProtocolFailure(runtime);
        runtime.decomposing = false;
        resetMainFailure(runtime, store);
      },
      clearProtocolFailure() {
        submitCollaboration();
        clearProtocolFailure(runtime);
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
      acknowledgeReports(eventIds: readonly string[], preserveRecoveryFailures = false) {
        if (eventIds.length === 0) return true;
        const before = runtime.scheduler.snapshot();
        if (!runtime.scheduler.acknowledgeReports(eventIds)) return false;
        try {
          persist(runtime, preserveRecoveryFailures ? {} : { loopPlusMainRecoveryFailureCount: 0 }, store);
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
      applyControls(controls: readonly LoopPlusControlDecision[]) {
        return applyLoopPlusControls(runtime, controls);
      },
      planControls(controls: readonly LoopPlusControlDecision[]) {
        const planned = planControlCommands(runtime, controls);
        if (!planned) {
          return null;
        }
        const token = {} as LoopPlusDecisionControlPlan;
        planned.interruptedAttempts = step.interruptedAttempts;
        controlPlans.set(token, planned);
        return token;
      },
      previewControls(plan: LoopPlusDecisionControlPlan) {
        const planned = controlPlans.get(plan);
        if (!planned) {
          return "controls 预检缺少控制计划，请按当前运行中或排队的任务重新生成。";
        }
        return previewControlPlan(runtime, planned);
      },
      commitControls(controls: readonly LoopPlusControlDecision[], plan: LoopPlusDecisionControlPlan) {
        const planned = controlPlans.get(plan);
        if (!planned) {
          return "controls 提交缺少控制计划，请按当前运行中或排队的任务重新生成。";
        }
        return commitControlPlan(runtime, controls, planned, [], store).controlFailure ?? null;
      },
      dispatchSubtasks(subtasks, controlPlan) {
        if (!controlPlan) return dispatchDecisions(runtime, subtasks, { store });
        const planned = controlPlans.get(controlPlan);
        if (!planned) return { decisions: [], rejected: [], controlFailure: "控制计划已失效，请核对当前 attempt。" };
        return commitControlPlan(runtime, decision.controls ?? [], planned, subtasks, store);
      },
      promoteDecisionWork() {
        promotePendingAndLaunch(runtime, store);
      },
      submitReviewBatch(
        eventIds: readonly string[],
        acceptance: Parameters<LoopPlusScheduler["submitReviewBatch"]>[1],
      ) {
        const before = runtime.scheduler.snapshot();
        const result = runtime.scheduler.submitReviewBatch(eventIds, acceptance);
        if (result.ok) {
          try {
            const openAttemptIds = new Set([before.currentReview, ...before.reviewQueue].map((item) => item?.attemptId));
            const newlyPassed = runtime.scheduler.snapshot().seenAttempts.some((item) =>
              openAttemptIds.has(item.attemptId) && item.disposition === "reviewed" && item.acceptance === "passed");
            const committed = persist(runtime, {
              loopPlusBlockReview: undefined,
              ...(newlyPassed ? { loopPlusMainRecoveryFailureCount: 0 } : {}),
            }, store);
            if (Array.isArray(acceptance) && acceptance.some((item) => item.repairRequired)) {
              const written = committed.loopPlus as LoopPlusSchedulerSnapshot | undefined;
              const savedRepairs = new Set(written?.seenAttempts.filter((item) => item.repairRequired && item.acceptance === "failed")
                .map((item) => buildLoopPlusFinishEventId(item.subtaskId, item.attemptId)));
              if (acceptance.some((item) => item.repairRequired && !savedRepairs.has(item.eventId))) {
                throw new Error("Failed review and repair obligation persistence not confirmed");
              }
            }
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
        persist(runtime, { status: "running" }, store);
      },
      persistSnapshot() {
        persist(runtime, {}, store);
      },
      applyNextStepPlan(plan: LoopPlusNextStepPlan | undefined) {
        persist(runtime, { loopPlusNextStepPlan: plan }, store);
      },
      persistEstimatedRounds(decision: LoopPlusDecision) {
        persistEstimatedRounds(runtime, decision, store);
      },
      persistProgressPercent(decision: LoopPlusDecision) {
        const progressPercent = normalizeLoopPlusProgressPercent(decision.progressPercent);
        if (progressPercent !== undefined && progressPercent < 100) {
          updateTask(runtime.taskId, { loopPlusProgressPercent: progressPercent, updatedAt: now() }, store.updateTask);
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
        recordAcceptancePlanFeedback(runtime, decision, store);
      },
      tryFinishParent() {
        // Check the gate without marking memory completed before the remaining decision writes.
        return createLoopPlusScheduler({ snapshot: runtime.scheduler.snapshot() }).complete().ok;
      },
      finishParent(decision: LoopPlusDecision): LoopPlusDecisionOutcome {
        const patch = completionFields(decision);
        try {
          if (!runtime.scheduler.complete().ok) {
            return hasReview(runtime) || hasReports(runtime) || hasUserMessages(runtime) ? "continue" : "wait";
          }
          persist(runtime, patch);
        } catch (error) {
          runtime.completionPatch = patch;
          logPersistenceFailure(runtime.taskId, "parent-completion", error, runtime);
          settle(runtime);
          return "stop";
        }
        publishCompletion(runtime);
        return "stop";
      },
    };
  }

  function recordAcceptancePlanFeedback(runtime: ParentRuntime, decision: LoopPlusDecision, store: Pick<DecisionTaskStore, "readTask">): void {
    if (!deps.appendAcceptancePlanChat) {
      return;
    }
    const eventIds = confirmedLoopPlusReviewIds(decision);
    if (eventIds.length === 0) {
      return;
    }
    const attempts = runtime.scheduler.snapshot().seenAttempts;
    const task = store.readTask(runtime.taskId);
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
        noRepairReason: review.noRepairReason,
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

  function appendCompletionMessages(runtime: ParentRuntime, committed?: LoopTaskRecord): void {
    if (!deps.appendCompletionMessages) {
      return;
    }
    const task = committed ?? deps.readTask(runtime.taskId);
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

  function completionFields(decision: LoopPlusDecision): Partial<LoopTaskRecord> {
    return { status: "completed", loopPlusProgressPercent: 100, answerConclusion: decision.answerConclusion,
      finalSummary: decision.finalSummary, completionRequirementCoverage: decision.requirementCoverage,
      estimatedRemainingRounds: 0, loopPlusNextStepPlan: undefined };
  }

  function publishCompletion(runtime: ParentRuntime, committed?: LoopTaskRecord): void {
    try {
      deps.appendMessage(runtime.target, "loop-plus-completed", runtime.taskId);
    } catch (error) {
      deps.log?.("loop-plus-completion-message-failed", { taskId: runtime.taskId, error: errorText(error) });
    }
    appendCompletionMessages(runtime, committed);
    notifyTaskCompleted(runtime);
    releaseCompleted(runtime);
  }

  function readyCompletion(runtime: ParentRuntime, step: MainStep, decision: LoopPlusDecision): LoopPlusScheduler | null {
    if (step.reportOnly || !sameLoopPlusReviewIds(confirmedLoopPlusReviewIds(decision), step.eventIds)) return null;
    const staged = runtime.createScheduler({ snapshot: runtime.scheduler.snapshot() });
    if (step.eventIds.length && !staged.submitReviewBatch(step.eventIds, "passed").ok) return null;
    if (step.reportEventIds.length && !staged.acknowledgeReports(step.reportEventIds)) return null;
    staged.ackUserMessages(step.userMessageCount);
    return staged.complete().ok ? staged : null;
  }

  async function commitReadyCompletion(runtime: ParentRuntime, step: MainStep, decision: LoopPlusDecision,
    staged: LoopPlusScheduler, original: LoopTaskRecord,
    commit: NonNullable<LoopPlusOrchestrationDeps["commitOrdinaryRun"]>): Promise<LoopPlusDecisionOutcome> {
    const before = runtime.scheduler.snapshot();
    const generation = runtime.mainGeneration;
    const lifecycle = runtime.lifecycle;
    const batchKey = loopPlusFrozenBatchKey(step.eventIds, step.reportEventIds);
    const startedAt = now();
    const diagnostic = (result: string, stage: string, attempt: number) => deps.log?.("loop-plus-completion-commit", {
      taskId: runtime.taskId, batchKey, result, stage, attempt, elapsedMs: Math.max(0, now() - startedAt),
    });
    for (let attempt = 0; ; attempt++) {
      if (runtime.released || runtime.stopRequested || runtime.autoPaused || lifecycle.settled || runtime.lifecycle !== lifecycle
        || generation !== runtime.mainGeneration) return "stop";
      if (runtime.scheduler.snapshot().seq !== before.seq) {
        diagnostic("replan", "snapshot-check", attempt);
        runtime.forcePrompt = true;
        return "continue";
      }
      let stage = "parent-read";
      let expected: LoopTaskRecord | null = null;
      let saved: LoopTaskRecord;
      try {
        let busy = false;
        expected = deps.readTask(runtime.taskId, { onUnavailable: reason => { busy = reason === "identity-lock-present"; } });
        if (!expected && busy) throw new OrdinaryUpdateIdentityLockBusy(stage);
        if (!expected || !sameLoopPlusMainParent(original, expected) || expected.status !== "running" || expected.userStopSource
          || expected.runtimeInterrupted || expected.pendingClarification || isLoopMainAiFailureLimitReached(expected)
          || invalidSnapshotReason(expected)) {
          diagnostic("superseded", stage, attempt);
          runtime.autoPaused = true;
          settle(runtime);
          return "stop";
        }
        if (!isDeepStrictEqual(original.loopPlusAcceptancePlan, expected.loopPlusAcceptancePlan)
          || !isDeepStrictEqual(original.supplementalRequirements, expected.supplementalRequirements)
          || !isDeepStrictEqual(original.loopPlusBlockReview, expected.loopPlusBlockReview)) {
          diagnostic("replan", "parent-read", attempt);
          runtime.forcePrompt = true;
          return "continue";
        }
        const durable = runtime.createScheduler({ snapshot: expected.loopPlus });
        durable.updateMaxConcurrency(before.maxConcurrency);
        if (!isDeepStrictEqual(durable.snapshot(), before)) {
          diagnostic("superseded", "snapshot-check", attempt);
          runtime.autoPaused = true;
          settle(runtime);
          return "stop";
        }
        stage = "final-write";
        const patch = buildPersistencePatch({ ...runtime, scheduler: staged, decomposing: false }, expected, {
          ...completionFields(decision), ...buildResetLoopMainAiFailureState(), mainAiLastFailureCode: undefined,
          loopPlusBlockReview: undefined,
          ...(step.eventIds.length || step.reportEventIds.length ? { loopPlusMainRecoveryFailureCount: 0 } : {}),
        });
        const updated = commit(expected, patch);
        if (!updated) throw new LoopPlusUpdateUnconfirmedError(runtime.taskId);
        saved = updated;
      } catch (error) {
        if (!(error instanceof OrdinaryUpdateIdentityLockBusy)) {
          diagnostic("unconfirmed", stage, attempt);
          runtime.autoPaused = true;
          runtime.pauseStatus = "error";
          if (expected) {
            try {
              const paused = commit(expected, { status: "error", loopPlusInterruption: { phase: before.phase, reason: "persistence-failure" },
                finalSummary: "主任务已返回完成结果，保存时未能确认提交。请核对群聊中的任务记录后继续执行。" });
              if (paused) {
                runtime.retryCompletion = { paused, decision, step };
                notifyPause(runtime, "error", "loop-plus-persist-failed");
              }
            } catch (pauseError) { logPersistenceFailure(runtime.taskId, "completion-pause", pauseError, runtime); }
          }
          settle(runtime);
          return "stop";
        }
        if (attempt <= decisionCommitRetryDelaysMs.length) diagnostic(attempt < decisionCommitRetryDelaysMs.length ? "retry" : "waiting-for-watchdog", error.stage, attempt);
        await waitForDecisionCommit(runtime, attempt);
        continue;
      }
      runtime.scheduler = staged;
      runtime.decomposing = false;
      clearProtocolFailure(runtime);
      diagnostic("committed", stage, attempt);
      try {
        recordAcceptancePlanFeedback(runtime, decision, { readTask: () => saved });
      } finally {
        publishCompletion(runtime, saved);
      }
      return "stop";
    }
  }

  async function waitForDecisionCommit(runtime: ParentRuntime, attempt: number): Promise<void> {
    if (attempt < decisionCommitRetryDelaysMs.length) return delay(decisionCommitRetryDelaysMs[attempt]);
    await new Promise<void>(resolve => { runtime.wakeDecisionCommit = resolve; });
    runtime.wakeDecisionCommit = undefined;
  }

  async function commitOrdinaryAcceptance(runtime: ParentRuntime, step: MainStep, decision: LoopPlusDecision,
    original: LoopTaskRecord, commit: NonNullable<LoopPlusOrchestrationDeps["commitOrdinaryRun"]>): Promise<LoopPlusDecisionOutcome> {
    const lifecycle = runtime.lifecycle;
    const generation = runtime.mainGeneration;
    const planEpoch = runtime.acceptancePlanEpoch;
    let receipt = original;
    let verified = false;
    const store: DecisionTaskStore = {
      readTask: taskId => taskId === receipt.id ? receipt : null,
      updateTask: (taskId, patch) => {
        if (taskId !== receipt.id) return null;
        const saved = commit(receipt, patch);
        if (saved) receipt = saved;
        return saved;
      },
    };
    const isCurrent = () => runtime.lifecycle === lifecycle && !lifecycle.settled && generation === runtime.mainGeneration
      && !runtime.released && !runtime.stopRequested && !runtime.autoPaused;
    const superseded = (): "stop" => {
      runtime.autoPaused = true;
      settle(runtime);
      return "stop";
    };
    let steps: ReturnType<typeof loopPlusAcceptanceSteps> | undefined;
    let pending: IteratorResult<() => void, LoopPlusDecisionOutcome> | undefined;
    for (let attempt = 0; ; attempt++) {
      if (!isCurrent()) return "stop";
      let retryable = true;
      try {
        let busy = false;
        const parent = deps.readTask(runtime.taskId, { onUnavailable: reason => { busy = reason === "identity-lock-present"; } });
        if (!parent && busy) throw new OrdinaryUpdateIdentityLockBusy("acceptance-read");
        if (!parent || !sameLoopPlusMainParent(original, parent) || parent.status !== "running" || parent.runtimeInterrupted
          || parent.userStopSource || parent.pendingClarification || isLoopMainAiFailureLimitReached(parent)
          || invalidSnapshotReason(parent)) return superseded();
        if (!verified || !isDeepStrictEqual(parent.loopPlus, receipt.loopPlus)) {
          const current = runtime.scheduler.snapshot();
          const durable = runtime.createScheduler({ snapshot: parent.loopPlus });
          durable.updateMaxConcurrency(current.maxConcurrency);
          if (!isDeepStrictEqual(durable.snapshot(), current)) return superseded();
        }
        if (runtime.acceptancePlanEpoch !== planEpoch || !isDeepStrictEqual(parent.loopPlusAcceptancePlan, original.loopPlusAcceptancePlan)
          || !isDeepStrictEqual(parent.supplementalRequirements, original.supplementalRequirements)
          || !isDeepStrictEqual(parent.loopPlusBlockReview, receipt.loopPlusBlockReview)) {
          runtime.forcePrompt = true;
          return "continue";
        }
        receipt = parent;
        verified = true;
        if (!steps) {
          const snapshot = runtime.scheduler.snapshot();
          if (!heldBatchIntact(snapshot, step)) return "continue";
          if (parent.loopPlusBlockReview?.state === "pending") {
            updateTask(runtime.taskId, { loopPlusBlockReview: { ...parent.loopPlusBlockReview, state: "reviewed" } }, store.updateTask);
          }
          const repaired = resolveAcceptanceRepairDecision(runtime, decision, snapshot, store);
          retryable = false;
          if (typeof repaired === "string") return rejectRepairDecision(runtime, step, repaired);
          runtime.authorityWithholdCount = 0;
          steps = loopPlusAcceptanceSteps(createDecisionPort(runtime, step, repaired, store), step, repaired);
          pending = steps.next();
        }
        while (pending && !pending.done) {
          if (!isCurrent()) return "stop";
          if (runtime.acceptancePlanEpoch !== planEpoch) {
            runtime.forcePrompt = true;
            return "continue";
          }
          retryable = true;
          pending.value();
          retryable = false;
          pending = steps.next();
        }
        return pending!.value;
      } catch (error) {
        if (!isCurrent()) return "stop";
        if (!retryable || !(error instanceof OrdinaryUpdateIdentityLockBusy)) {
          logPersistenceFailure(runtime.taskId, "acceptance-commit", error, runtime);
          const latest = deps.readTask(runtime.taskId);
          if (!verified || !latest || latest.updatedAt !== receipt.updatedAt || !sameLoopPlusMainParent(receipt, latest)
            || latest.status !== "running") return superseded();
          pause(runtime, "error", "loop-plus-consumer-failed", undefined, false, {}, store);
          return "stop";
        }
        if (attempt <= decisionCommitRetryDelaysMs.length) deps.log?.("loop-plus-acceptance-commit-busy", {
          taskId: runtime.taskId, stage: error.stage, attempt,
        });
      }
      await waitForDecisionCommit(runtime, attempt);
    }
  }

  // 部门组长的 blocked 把真实 cause 交给总监。缺少 constraintSource 不能再自动重试模型。
  function departmentLeaderDeliversBlocker(task: LoopTaskRecord | null | undefined, decision: LoopPlusDecision): boolean {
    return task?.departmentInvalid !== true
      && normalizeDepartmentMetadata(task?.department)?.role === "leader"
      && Boolean(decision.blocker?.cause)
      && !(decision.blocker?.recoveryOptions?.length);
  }

  function applyDecision(
    runtime: ParentRuntime,
    step: MainStep,
    parsed: LoopPlusDecisionParseResult,
    guardedParent: LoopTaskRecord | null,
  ): LoopPlusDecisionOutcome | Promise<LoopPlusDecisionOutcome> {
    const snapshot = runtime.scheduler.snapshot();
    const held = snapshot.currentReview;
    if (step.kind === "review" && !heldBatchIntact(snapshot, step)) {
      if (hasReview(runtime)) {
        return "continue";
      }
      return "wait";
    }
    if (!parsed.decision) {
      return protocolMiss(runtime, Boolean(held), parsed.rejectionReason ?? undefined, parsed.rejectionKind, parsed.formatDiagnostic, parsed.validationDiagnostic, loopPlusProtocolParseDiagnostic(parsed), step.allowDispatchBeforeReview === true);
    }
    const decision = parsed.decision;
    if (step.kind === "review" && (decision.status === "accept" || decision.status === "completed")) {
      const failedEvents = [snapshot.currentReview, ...snapshot.reviewQueue].filter((event) => event
        && step.eventIds.includes(event.eventId) && (event.outcome === "failed" || event.outcome === "stopped"));
      if (failedEvents.some((event) => decision.status === "completed"
        || decision.reviews?.find((review) => review.reviewEventId === event?.eventId)?.acceptance === "passed")) {
        return protocolMiss(runtime, Boolean(held), undefined, "state", undefined, undefined,
          loopPlusProtocolBranchDiagnostic("state.review_batch.failed_cannot_pass"), step.allowDispatchBeforeReview === true);
      }
    }
    if (step.allowDispatchBeforeReview && decision.status === "dispatch") {
      return applyDispatchBeforeReview(runtime, step, decision);
    }
    if (!sameLoopPlusReportIds(decision.reportEventIds ?? [], step.reportEventIds)) {
      return protocolMiss(runtime, Boolean(held), undefined, "state", undefined, undefined,
        loopPlusProtocolBranchDiagnostic("state.report_batch.mismatch"), step.allowDispatchBeforeReview === true);
    }
    if (step.reportOnly) {
      const port = createDecisionPort(runtime, step, decision);
      if (decision.status !== "wait" || !port.acknowledgeReports(step.reportEventIds, true)) {
        return port.protocolMiss(true, undefined, loopPlusProtocolBranchDiagnostic("state.report_batch.wait_required"));
      }
      runtime.reportStep = planReportOnlyStep(runtime);
      if (!runtime.reportStep) runtime.forcePrompt = !hasReview(runtime);
      clearProtocolFailure(runtime);
      return "continue";
    }
    if (decision.status === "blocked" && (snapshot.reportQueue?.length ?? 0) > step.reportEventIds.length) {
      runtime.reportStep = planReportOnlyStep(runtime);
      return "continue";
    }
    if (decision.status === "blocked" && snapshot.userMessageQueue.length > step.userMessageCount) {
      const port = createDecisionPort(runtime, step, decision);
      if (!port.acknowledgeReports(step.reportEventIds, true)) return port.protocolMiss(Boolean(held));
      port.acknowledgeUserMessages(step.userMessageCount);
      port.captureRemainingUserMessagesForHeldReview();
      clearProtocolFailure(runtime);
      persist(runtime, { status: "running", loopPlusBlockReview: undefined });
      return "continue";
    }
    if (decision.status === "blocked" && step.visibleReviewCount !== undefined
      && snapshot.reviewQueue.length + Number(Boolean(held)) > step.visibleReviewCount) {
      persist(runtime, { status: "running", loopPlusBlockReview: undefined });
      return "continue";
    }
    if (decision.status === "completed" && guardedParent && deps.commitOrdinaryRun) {
      const staged = readyCompletion(runtime, step, decision);
      if (staged) return commitReadyCompletion(runtime, step, decision, staged, guardedParent, deps.commitOrdinaryRun);
    }
    if (step.kind === "review" && decision.status === "accept" && guardedParent && deps.commitOrdinaryRun) {
      return commitOrdinaryAcceptance(runtime, step, decision, guardedParent, deps.commitOrdinaryRun);
    }
    if (step.kind === "review" && step.eventIds.length > 0
      && (decision.status === "accept" || decision.status === "completed")) {
      const authority = resolveParentContext(runtime, "acceptance-submit", step);
      if (!authority.authoritative) {
        return withholdParentAcceptance(runtime);
      }
      runtime.authorityWithholdCount = 0;
    }
    const task = deps.readTask(runtime.taskId);
    const blockReview = task?.loopPlusBlockReview;
    if (blockReview?.state === "pending") {
      updateTask(runtime.taskId, {
        loopPlusBlockReview: { ...blockReview, state: "reviewed" },
      });
    }
    const reviewRecoveryOptions = decision.blocker?.recoveryOptions;
    if (decision.status === "blocked" && (!blockReview || (reviewRecoveryOptions?.length && !blockReview.recoveryOptions))) {
      const port = createDecisionPort(runtime, step, decision);
      if (!port.acknowledgeReports(step.reportEventIds, true)) return port.protocolMiss(Boolean(held));
      port.acknowledgeUserMessages(step.userMessageCount);
      clearProtocolFailure(runtime);
      if (held) {
        runtime.scheduler.requeueCurrentReview();
      }
      runtime.forcePrompt = !held;
      persist(runtime, {
        status: "running",
        loopPlusBlockReview: {
          state: "pending",
          summary: decision.finalSummary,
          ...(reviewRecoveryOptions ? { recoveryOptions: reviewRecoveryOptions } : {}),
        },
      });
      deps.appendMessage(runtime.target, "loop-plus-block-review", runtime.taskId);
      deps.log?.("loop-plus-block-review", { taskId: runtime.taskId });
      return "continue";
    }
    if (decision.status === "blocked") {
      const port = createDecisionPort(runtime, step, decision);
      promotePendingAndLaunch(runtime);
      const current = runtime.scheduler.snapshot();
      const live = current.running.filter((item) => runtime.meta.get(item.subtaskId)?.executionStatus !== "blocked");
      if (live.length > 0) {
        if (!port.acknowledgeReports(step.reportEventIds, true)) return port.protocolMiss(Boolean(held));
        port.acknowledgeUserMessages(step.userMessageCount);
        clearProtocolFailure(runtime);
        persist(runtime, { status: "running", loopPlusBlockReview: undefined });
        runtime.forcePrompt = false;
        runtime.reviewDependencyWait = { scheduler: runtime.scheduler, seq: runtime.scheduler.snapshot().seq };
        port.noteWaiting(live.length);
        return "wait";
      }
      if ((!decision.blocker?.constraintSource && !departmentLeaderDeliversBlocker(task, decision)) || reviewRecoveryOptions?.length) {
        return port.protocolMiss(Boolean(held), decision.blockerIssue, loopPlusProtocolBranchDiagnostic("validation.blocked.invalid_blocker"));
      }
    }
    const repairDecision = resolveAcceptanceRepairDecision(runtime, decision, snapshot);
    if (typeof repairDecision === "string") return rejectRepairDecision(runtime, step, repairDecision);
    return loopPlusDecisionStrategyFor(repairDecision.status, decisionStrategies)(
      createDecisionPort(runtime, step, repairDecision), step, repairDecision,
    );
  }

  function rejectRepairDecision(runtime: ParentRuntime, step: MainStep, repairDecision: string): LoopPlusDecisionOutcome {
    const reasonCode: LoopPlusProtocolBranchCode = repairDecision.includes("缺少原任务记录")
      ? "state.repair.source_unavailable"
      : repairDecision.includes("只能关联") || repairDecision.includes("重复派发")
        ? "state.repair.linkage_conflict"
        : repairDecision.includes("未关联") ? "validation.accept.unlinked_subtasks" : "validation.invalid_decision";
    return protocolMiss(runtime, Boolean(runtime.scheduler.snapshot().currentReview), undefined, reasonCode.startsWith("state.") ? "state" : "validation",
      undefined, undefined, loopPlusProtocolBranchDiagnostic(reasonCode), step.allowDispatchBeforeReview === true);
  }

  function planReportOnlyStep(runtime: ParentRuntime): MainStep | null {
    const ids = runtime.scheduler.snapshot().reportQueue?.map((item) => item.eventId) ?? [];
    return ids.length > 0 ? { ...plainStep("continue", 0, ids), reportOnly: true } : null;
  }

  function resolveAcceptanceRepairDecision(
    runtime: ParentRuntime,
    decision: LoopPlusDecision,
    snapshot: LoopPlusSchedulerSnapshot,
    store: DecisionTaskStore = deps,
  ): LoopPlusDecision | string {
    if ((decision.status !== "accept" && decision.status !== "dispatch") || !decision.subtasks?.length) return decision;
    const existing = new Map(store.readTask(runtime.taskId)?.subTasks.map((item) => [item.id, item]));
    const events = [snapshot.currentReview, ...snapshot.reviewQueue];
    const repairs = new Map<string, LoopSubtaskRecord>();
    for (const item of snapshot.seenAttempts) {
      if (!item.repairRequired || !decision.subtasks.some((subtask) => subtask.id === item.subtaskId)) continue;
      const source = existing.get(item.subtaskId);
      if (!source) return `欠下返工的子任务 ${item.subtaskId} 缺少原任务记录，不能替换为其它 ID。`;
      repairs.set(item.subtaskId, source);
    }
    for (const review of decision.reviews ?? []) {
      if (review.acceptance !== "failed" || !review.subtaskIds?.length) continue;
      const event = events.find((item) => item?.eventId === review.reviewEventId);
      const source = event && existing.get(event.subtaskId);
      if (!source) return "修复必须关联当前验收批次中的原子任务。";
      const [proposedId] = review.subtaskIds;
      if (review.subtaskIds.length !== 1 || proposedId !== source.id) {
        return `验收失败的子任务 ${source.id} 只能关联一项修复，且不能覆盖其它已有子任务 ID。`;
      }
      repairs.set(proposedId, source);
    }
    if (repairs.size === 0) return decision;
    const canonicalId = (id: string) => repairs.get(id)?.id ?? id;
    const resolvedIds = decision.subtasks.map((item) => canonicalId(item.id ?? ""));
    if (new Set(resolvedIds).size !== resolvedIds.length) {
      return "修复使用原子任务 ID，不能在同一决策中重复派发该 ID。";
    }
    return {
      ...decision,
      reviews: decision.reviews?.map((review) => review.subtaskIds
        ? { ...review, subtaskIds: review.subtaskIds.map(canonicalId) } : review),
      subtasks: decision.subtasks.map((item) => {
        const source = item.id ? repairs.get(item.id) : undefined;
        const dependsOn = item.dependsOn ?? source?.dependsOn;
        const continuation = source?.id ?? item.continueFromSubtaskId;
        return {
          ...item,
          ...(source ? {
            id: source.id,
            title: source.title,
            requiresAcceptance: true,
            taskType: item.taskType ?? source.taskType,
            codingDelivery: item.codingDelivery ?? source.codingDelivery,
            writeFiles: item.writeFiles ?? source.writeFiles,
            conflictGroup: item.conflictGroup ?? source.conflictGroup,
          } : {}),
          ...(continuation ? { continueFromSubtaskId: canonicalId(continuation) } : {}),
          ...(dependsOn ? { dependsOn: [...new Set(dependsOn.map(canonicalId))] } : {}),
        };
      }),
    };
  }

  function applyDispatchBeforeReview(
    runtime: ParentRuntime,
    step: MainStep,
    decision: LoopPlusDecision,
  ): LoopPlusDecisionOutcome {
    const subtasks = decision.subtasks ?? [];
    if (!decision.nextStepPlan || decision.controls?.length
      || !sameLoopPlusReportIds(decision.reportEventIds ?? [], step.reportEventIds)) {
      const reasonCode = !decision.nextStepPlan ? "state.dispatch_window.plan_required"
        : decision.controls?.length ? "state.dispatch_window.controls_forbidden" : "state.report_batch.mismatch";
      return protocolMiss(runtime, true, undefined, "state", undefined, undefined,
        loopPlusProtocolBranchDiagnostic(reasonCode), step.allowDispatchBeforeReview === true);
    }
    const dispatched = dispatchDecisions(runtime, subtasks, { reviewPlan: decision.nextStepPlan, reportEventIds: step.reportEventIds });
    if (dispatched.decisions.length === 0) {
      return protocolMiss(runtime, true, undefined, "state", undefined, undefined,
        loopPlusProtocolBranchDiagnostic("state.dispatch_window.preflight_failed"), step.allowDispatchBeforeReview === true);
    }
    const port = createDecisionPort(runtime, step, decision);
    port.persistEstimatedRounds(decision);
    port.markDecisionAccepted();
    promotePendingAndLaunch(runtime);
    return "continue";
  }


  async function waitForLoopPlusClarification(
    runtime: ParentRuntime,
    step: MainStep,
    decision: LoopPlusDecision,
    response: string,
  ): Promise<LoopPlusDecisionOutcome> {
    const request = decision.clarification;
    const task = deps.readTask(runtime.taskId);
    const count = task?.clarificationCount ?? 0;
    const port = createDecisionPort(runtime, step, decision);
    const snapshot = runtime.scheduler.snapshot();
    if (snapshot.userMessageQueue.length > step.userMessageCount) {
      port.acknowledgeUserMessages(step.userMessageCount);
      port.captureRemainingUserMessagesForHeldReview();
      persist(runtime, { status: "running", loopPlusBlockReview: undefined });
      return "continue";
    }
    if (!request || count >= ORCHESTRATOR_CLARIFICATION_LIMIT) {
      const reason = request ? "state.clarification.limit_reached" : "validation.invalid_decision";
      return port.protocolMiss(Boolean(snapshot.currentReview), undefined, loopPlusProtocolBranchDiagnostic(reason));
    }
    clearProtocolFailure(runtime);
    deps.removeClarificationResponse?.(runtime.target, runtime.taskId, response);
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
    const answeredFields = submission.timedOut ? [] : request.formFields;
    const answer = formatOrchestratorClarificationAnswer(submission, answeredFields);
    const requirements = [...(latest.supplementalRequirements ?? []), answer];
    updateTask(runtime.taskId, {
      supplementalRequirements: requirements,
      pendingClarification: undefined,
      ...(submission.timedOut ? {} : { loopPlusBlockReview: undefined }),
      schedulingMode: "event_driven",
      updatedAt: now(),
    });
    clearProtocolFailure(runtime);
    resetMainFailure(runtime);
    if (runtime.scheduler.snapshot().currentReview || runtime.scheduler.snapshot().reviewQueue.length > 0) {
      return "continue";
    }
    runtime.forcePrompt = true;
    return "continue";
  }

  function clearProtocolFailure(runtime: ParentRuntime): void {
    if (runtime.protocolFailureCount > 0) {
      logProtocolRecovery(runtime, "recovered");
    }
    runtime.protocolFailureCount = 0;
    runtime.protocolFailureReason = null;
    runtime.protocolRecovery = null;
  }

  function logProtocolRecovery(runtime: ParentRuntime, result: "continuation_requested" | "paused" | "recovered"): void {
    deps.log?.("loop-plus-protocol-recovery", {
      taskId: runtime.taskId,
      attemptState: runtime.protocolFailureCount === 1 ? "first" : "retry",
      protocolFailureCount: runtime.protocolFailureCount,
      automaticRetryLimit: LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT,
      result,
    });
  }

  const dispatchCollisionCounts = new WeakMap<ParentRuntime, { active_subtask: number; duplicate_subtask: number }>();
  const terminalAttempts = new WeakMap<ParentRuntime, number>();
  const terminalObservations = new WeakMap<ParentRuntime, {
    batchKey: string;
    batchEvidence: "frozen_id_sequence";
    invocationKey: string;
    requestPhase: MainStep["kind"];
    responseShape: LoopPlusResponseShape;
    charCount: number;
    elapsedMs: number;
    attempt: number;
  }>();

  function recordMainTerminal(
    runtime: ParentRuntime,
    step: MainStep,
    content: string | null,
    elapsedMs: number,
    failed: boolean,
    failureCode: string | undefined,
  ): void {
    const classified = failed
      ? { responseShape: "execution_failed" as const, charCount: 0 }
      : classifyLoopPlusResponse(content);
    const elapsed = Math.max(0, Math.min(Math.trunc(elapsedMs), 604_800_000));
    const attempt = (terminalAttempts.get(runtime) ?? 0) + 1;
    terminalAttempts.set(runtime, attempt);
    const reasonCode = failed ? readLoopPlusTerminalReasonCode(failureCode) : undefined;
    const observation = {
      phase: "main_terminal" as const,
      requestPhase: step.kind,
      batchKey: loopPlusFrozenBatchKey(step.eventIds, step.reportEventIds),
      batchEvidence: "frozen_id_sequence" as const,
      invocationKey: loopPlusInvocationKey(),
      attempt,
      responseShape: classified.responseShape,
      charCount: classified.charCount,
      elapsedMs: elapsed,
      ...(reasonCode ? { reasonCode } : {}),
    };
    terminalObservations.set(runtime, observation);
    deps.log?.("loop-plus-main-terminal", observation);
  }

  function protocolAssociation(runtime: ParentRuntime): {
    phase: "protocol_recovery";
    batchKey: string;
    batchEvidence: "frozen_id_sequence";
    invocationKey: string;
    requestPhase: MainStep["kind"];
    responseShape: Exclude<LoopPlusResponseShape, "execution_failed">;
    charCount: number;
    elapsedMs: number;
    attempt: number;
  } | Record<string, never> {
    const observed = terminalObservations.get(runtime);
    if (!observed || observed.responseShape === "execution_failed") return {};
    return {
      phase: "protocol_recovery",
      batchKey: observed.batchKey,
      batchEvidence: observed.batchEvidence,
      invocationKey: observed.invocationKey,
      requestPhase: observed.requestPhase,
      responseShape: observed.responseShape,
      charCount: observed.charCount,
      elapsedMs: observed.elapsedMs,
      attempt: observed.attempt,
    };
  }

  function countDispatchCollisions(
    rejected: readonly { reason?: unknown }[] | null | undefined,
  ): { active_subtask: number; duplicate_subtask: number } | null {
    const counts = { active_subtask: 0, duplicate_subtask: 0 };
    for (const item of rejected ?? []) {
      if (item?.reason === "active_subtask") counts.active_subtask += 1;
      else if (item?.reason === "duplicate_subtask") counts.duplicate_subtask += 1;
    }
    return counts.active_subtask + counts.duplicate_subtask > 0 ? counts : null;
  }

  function dispatchCollisionNote(
    decisionStatus: "dispatch" | "accept" | undefined,
    counts: { active_subtask: number; duplicate_subtask: number } | null,
  ): string {
    if (!decisionStatus && !counts) return "";
    return `受控来源：${decisionStatus ?? "unknown"}。碰撞计数：active_subtask=${counts?.active_subtask ?? 0}，duplicate_subtask=${counts?.duplicate_subtask ?? 0}。`;
  }

  function protocolMiss(
    runtime: ParentRuntime,
    held: boolean,
    reason = "决策与当前调度状态不一致，请核对当前验收批次、运行中及排队任务，并重新返回合法决策。",
    rejectionKind: LoopPlusDecisionRejectionKind = "validation",
    formatDiagnostic?: LoopPlusDecisionFormatDiagnostic,
    validationDiagnostic?: LoopPlusDecisionParseResult["validationDiagnostic"],
    suppliedDiagnostic?: LoopPlusProtocolDiagnostic,
    allowDispatchBeforeReview = false,
    suppliedDecisionStatus?: "dispatch" | "accept",
  ): "continue" | "stop" {
    const diagnostic = suppliedDiagnostic ?? (formatDiagnostic
      ? loopPlusProtocolParseDiagnostic({ decision: null, rejectionKind: "format", formatDiagnostic, rejectionReason: "" })
      : validationDiagnostic
        ? loopPlusProtocolParseDiagnostic({ decision: null, rejectionKind: "validation", validationDiagnostic, rejectionReason: "" })
        : loopPlusProtocolBranchDiagnostic("validation.invalid_decision"));
    const decisionStatus = diagnostic.reasonCode === "state.dispatch.rejected"
      && (suppliedDecisionStatus === "dispatch" || suppliedDecisionStatus === "accept")
      ? suppliedDecisionStatus : undefined;
    const collisionCounts = diagnostic.reasonCode === "state.dispatch.rejected"
      ? dispatchCollisionCounts.get(runtime) : undefined;
    dispatchCollisionCounts.delete(runtime);
    const collisionNote = diagnostic.reasonCode === "state.dispatch.rejected"
      ? dispatchCollisionNote(decisionStatus, collisionCounts ?? null) : "";
    const category = diagnostic.rejectionKind === "format" ? "决策 JSON 格式错误"
      : diagnostic.rejectionKind === "state" ? "宿主状态拒绝" : "决策协议校验失败";
    const diagnosticReason = `${category}（${diagnostic.rejectionKind}）。原因码：${diagnostic.reasonCode}。`
      + `${diagnostic.fieldPath ? `字段：${diagnostic.fieldPath}。` : ""}${loopPlusProtocolDiagnosticHint(diagnostic)}${collisionNote}`;
    runtime.protocolFailureCount += 1;
    runtime.protocolFailureReason = diagnosticReason;
    runtime.protocolRecovery = { diagnostic, hint: `${loopPlusProtocolDiagnosticHint(diagnostic)}${collisionNote}` };
    deps.log?.("loop-plus-protocol-miss", {
      taskId: runtime.taskId,
      held,
      protocolFailureCount: runtime.protocolFailureCount,
      rejectionKind: diagnostic.rejectionKind,
      reasonCode: diagnostic.reasonCode,
      ...(diagnostic.fieldPath ? { fieldPath: diagnostic.fieldPath } : {}),
      dispatchWindow: allowDispatchBeforeReview ? "open" : "closed",
      attemptState: runtime.protocolFailureCount === 1 ? "first" : "retry",
    });
    const snapshot = runtime.scheduler.snapshot();
    const terminal = runtime.released || runtime.stopRequested || runtime.autoPaused || snapshot.parentStopped || snapshot.completed;
    const recoveryStage = terminal ? "stopped"
      : runtime.protocolFailureCount > LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT ? "paused"
      : "continuation_requested";
    deps.log?.("loop-plus-protocol-rejection", {
      rejectionKind: diagnostic.rejectionKind,
      reasonCode: diagnostic.reasonCode,
      ...(diagnostic.fieldPath ? { fieldPath: diagnostic.fieldPath } : {}),
      protocolFailureCount: runtime.protocolFailureCount,
      recoveryStage,
      dispatchWindow: allowDispatchBeforeReview ? "open" : "closed",
      ...(decisionStatus ? { decisionStatus } : {}),
      ...(collisionCounts ? { collisionCounts } : {}),
      ...protocolAssociation(runtime),
    });
    if (terminal) {
      return "stop";
    }
    if (runtime.protocolFailureCount > LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT) {
      logProtocolRecovery(runtime, "paused");
      pause(runtime, "needs-review", "loop-plus-protocol-paused",
        buildLoopPlusProtocolPauseSummary(diagnosticReason, "continuation-rejected", diagnostic), true);
      return "stop";
    }
    logProtocolRecovery(runtime, "continuation_requested");
    return "continue";
  }

  function recordDispatchRejections(
    runtime: ParentRuntime,
    rejected: readonly { reason?: unknown }[] | null | undefined,
  ): void {
    const dispatchRejection = summarizeLoopPlusDispatchRejections(rejected);
    if (dispatchRejection) deps.log?.("loop-plus-dispatch-rejected", dispatchRejection);
    const counts = countDispatchCollisions(rejected);
    if (counts) dispatchCollisionCounts.set(runtime, counts);
    else dispatchCollisionCounts.delete(runtime);
  }

  function dispatchDecisions(
    runtime: ParentRuntime,
    subtasks: readonly LoopSubtaskDecision[],
    options: {
      reviewPlan?: LoopPlusNextStepPlan;
      reportEventIds?: readonly string[];
      store?: DecisionTaskStore;
      requireAll?: boolean;
    } = {},
  ) {
    const { reviewPlan, reportEventIds = [], store = deps } = options;
    if (subtasks.length === 0) {
      persist(runtime, { status: "running" }, store);
      return { decisions: [], rejected: [] };
    }
    const before = runtime.scheduler.snapshot();
    const previousMeta = new Map(runtime.meta);
    const repairIds = new Set(before.seenAttempts.filter((item) => item.repairRequired).map((item) => item.subtaskId));
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
        recordDispatchRejections(runtime, preview.rejected);
        return { decisions: [], rejected: [] };
      }
      if (reportEventIds.length > 0 && !runtime.scheduler.acknowledgeReports(reportEventIds)) {
        return { decisions: [], rejected: [] };
      }
    }
    const dispatched = runtime.scheduler.dispatch(specs, { deferPromotion: !reviewPlan });
    if (options.requireAll && dispatched.rejected.length) {
      recordDispatchRejections(runtime, dispatched.rejected);
      return { decisions: [], rejected: dispatched.rejected };
    }
    if (reviewPlan && (dispatched.rejected.length > 0 || dispatched.decisions.length !== specs.length
      || dispatched.decisions.some((item) => item.admission !== "started"))) {
      runtime.scheduler = runtime.createScheduler({ snapshot: before });
      recordDispatchRejections(runtime, dispatched.rejected);
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
        executionStatus: "pending",
      });
    });
    try {
      const saved = persist(runtime, {
        status: "running",
        ...(accepted.size > 0 ? { loopPlusBlockReview: undefined } : {}),
        ...(reviewPlan ? { loopPlusNextStepPlan: reviewPlan } : {}),
        ...(reviewPlan && reportEventIds.length > 0 ? { loopPlusMainRecoveryFailureCount: 0 } : {}),
      }, store);
      if (repairIds.size) {
        const savedSnapshot = saved?.loopPlus as LoopPlusSchedulerSnapshot | undefined;
        for (const item of built) {
          if (!repairIds.has(item.spec.subtaskId) || !accepted.has(item.spec.attemptId)) continue;
          if (!saved?.subTasks.some((subtask) => subtask.id === item.spec.subtaskId)
            || savedSnapshot?.seenAttempts.some((attempt) => attempt.subtaskId === item.spec.subtaskId && attempt.repairRequired)
            || !savedSnapshot?.seenAttempts.some((attempt) => attempt.subtaskId === item.spec.subtaskId
              && attempt.attemptId === item.spec.attemptId && attempt.disposition === "open")
            || ![...(savedSnapshot?.pending ?? []), ...(savedSnapshot?.running ?? [])]
              .some((attempt) => attempt.attemptId === item.spec.attemptId && attempt.subtaskId === item.spec.subtaskId)) {
            throw new Error("Repair dispatch persistence not confirmed");
          }
        }
      }
    } catch (error) {
      runtime.meta = previousMeta;
      runtime.scheduler = runtime.createScheduler({ snapshot: before });
      runtime.attemptSeq = seqBefore;
      throw error;
    }
    recordDispatchRejections(runtime, dispatched.rejected);
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

  function promotePendingAndLaunch(runtime: ParentRuntime, store: DecisionTaskStore = deps): void {
    if (runtime.autoPaused || runtime.stopRequested || runtime.released) return;
    const before = runtime.scheduler.snapshot();
    runtime.scheduler.updateMaxConcurrency(maxConcurrency());
    const promoted = runtime.scheduler.promotePending();
    if (promoted.started.length === 0) return;
    // A running reservation must be durable before any process can observe it.
    persistResumeTransition(runtime, before, "running", store);
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
    if (runtime.supplementCommitBlocked) return;
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

  type LaunchPersistResult = "committed" | "retry" | "contended" | "unconfirmed" | "cancelled";
  type LaunchPersistReason = "identity-lock-present" | "update-unconfirmed" | "write-unconfirmed" | "read-unavailable" | "reservation-absent" | "snapshot-diverged" | "stale-generation" | "stopped" | "paused";

  function logLaunchPersist(
    runtime: ParentRuntime,
    attemptId: string,
    stage: "launch-read" | "launch-commit",
    result: LaunchPersistResult,
    reason?: LaunchPersistReason,
    attempt?: number,
  ): void {
    deps.log?.("loop-plus-launch-persist", {
      taskId: runtime.taskId,
      attemptId,
      stage,
      result,
      ...(reason ? { reason } : {}),
      ...(attempt ? { attempt } : {}),
    });
  }

  type LaunchTask = LoopTaskRecord & { loopPlus: LoopPlusSchedulerSnapshot };

  function readLaunchTask(runtime: ParentRuntime): { task: LaunchTask | null; busy: boolean; failed: boolean } {
    let busy = false;
    try {
      const task = deps.readTask(runtime.taskId, {
        onUnavailable: (reason) => { busy = reason === "identity-lock-present"; },
      });
      if (!task) return { task: null, busy, failed: false };
      if (!task.loopPlus) return { task: null, busy, failed: true };
      const snapshot = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot();
      return { task: { ...task, loopPlus: snapshot }, busy, failed: false };
    } catch {
      return { task: null, busy, failed: true };
    }
  }

  function launchReservationDurable(task: LaunchTask, record: LoopPlusExecutionRecord): boolean {
    return task.loopPlus.running.some((item) => item.attemptId === record.attemptId && item.subtaskId === record.subtaskId);
  }

  function authoritativeLaunchBlocked(task: LaunchTask): "stopped" | null {
    if (task.status === "stopped" || task.status === "completed" || task.loopPlus.parentStopped || task.loopPlus.completed) {
      return "stopped";
    }
    return null;
  }

  function launchStartCommitted(
    runtime: ParentRuntime,
    task: LaunchTask,
    record: LoopPlusExecutionRecord,
    launchedAt: number,
  ): boolean | "stale-generation" {
    if (authoritativeLaunchBlocked(task)) return false;
    const subtask = task.subTasks.find((item) => item.id === record.subtaskId);
    const marked = launchReservationDurable(task, record) && subtask?.status === "running" && subtask.lastStartedAt === launchedAt;
    if (!marked) return false;
    if (task.loopPlus.seq !== runtime.scheduler.snapshot().seq) return "stale-generation";
    return true;
  }

  function sameExecutionIds(left: readonly { attemptId: string }[], right: readonly { attemptId: string }[]): boolean {
    return left.length === right.length && left.every((item, index) => item.attemptId === right[index]?.attemptId);
  }

  function sameReviewIds(left: readonly { eventId: string }[], right: readonly { eventId: string }[]): boolean {
    return left.length === right.length && left.every((item, index) => item.eventId === right[index]?.eventId);
  }

  function launchSnapshotAligned(runtime: ParentRuntime, task: LaunchTask): boolean {
    const disk = task.loopPlus;
    const memory = runtime.scheduler.snapshot();
    if (disk.seq !== memory.seq || disk.phase !== memory.phase || disk.parentStopped !== memory.parentStopped || disk.completed !== memory.completed) return false;
    if (disk.userMessageQueue.length !== memory.userMessageQueue.length
      || disk.userMessageQueue.some((item, index) => item !== memory.userMessageQueue[index])) return false;
    if ((disk.currentReview?.eventId ?? null) !== (memory.currentReview?.eventId ?? null)) return false;
    if (!sameReviewIds(disk.reviewQueue, memory.reviewQueue) || !sameReviewIds(disk.reportQueue ?? [], memory.reportQueue ?? [])) return false;
    if (!sameExecutionIds(disk.running, memory.running) || !sameExecutionIds(disk.pending, memory.pending)) return false;
    if (disk.seenAttempts.length !== memory.seenAttempts.length) return false;
    return disk.seenAttempts.every((item, index) => {
      const current = memory.seenAttempts[index];
      return current?.attemptId === item.attemptId
        && current.disposition === item.disposition
        && current.outcome === item.outcome
        && current.acceptance === item.acceptance
        && current.acceptanceReason === item.acceptanceReason;
    });
  }

  function launchGate(runtime: ParentRuntime, record: LoopPlusExecutionRecord, epoch: number, mainGeneration: number): "ready" | "stop" | "pause" | "stale" {
    if (runtime.stopRequested || runtime.scheduler.snapshot().parentStopped) return "stop";
    if (runtime.autoPaused) return "pause";
    if (runtime.launchEpoch.get(record.attemptId) !== epoch || runtime.mainGeneration !== mainGeneration) return "stale";
    if (runtime.released || runtime.scheduler.snapshot().completed) return "stale";
    if (!runtime.scheduler.snapshot().running.some((item) => item.attemptId === record.attemptId) || runtime.attempts.has(record.attemptId)) return "stale";
    return "ready";
  }

  async function commitQueuedLaunch(
    runtime: ParentRuntime,
    record: LoopPlusExecutionRecord,
    epoch: number,
    launchedAt: number,
    communicationFile: string | undefined,
  ): Promise<boolean> {
    const mainGeneration = runtime.mainGeneration;
    const meta = runtime.meta.get(record.subtaskId);
    const saved = meta ? {
      communicationFile: meta.communicationFile,
      executionStatus: meta.executionStatus,
      executionFailure: meta.executionFailure,
      lastStartedAt: meta.lastStartedAt,
    } : undefined;
    const applyMeta = (): void => {
      if (!meta) return;
      meta.communicationFile = communicationFile;
      meta.executionStatus = "running";
      if (meta.executionFailure === UNCONFIRMED_ATTEMPT_RESULT) meta.executionFailure = undefined;
      if (Number.isFinite(launchedAt)) meta.lastStartedAt = launchedAt;
    };
    const restoreMeta = (): void => {
      if (!meta || !saved) return;
      meta.communicationFile = saved.communicationFile;
      meta.executionStatus = saved.executionStatus;
      meta.executionFailure = saved.executionFailure;
      meta.lastStartedAt = saved.lastStartedAt;
    };
    let started = false;
    const cancel = (reason: LaunchPersistReason, attempt?: number): false => {
      restoreMeta();
      logLaunchPersist(runtime, record.attemptId, "launch-commit", "cancelled", reason, attempt);
      return false;
    };
    const refuseAuthoritative = (task: LaunchTask, attempt: number): false | null => {
      const blocked = authoritativeLaunchBlocked(task);
      if (!blocked) return null;
      // The disk parent is already stopped. Leave its messages and review order
      // untouched; rewriting from memory would publish a newer acceptance.
      return cancel("stopped", attempt);
    };
    const parkAfterContention = (attempt: number, reason: LaunchPersistReason): false => {
      restoreMeta();
      const before = runtime.scheduler.snapshot();
      const stillReserved = before.running.some((item) => item.attemptId === record.attemptId)
        && !runtime.attempts.has(record.attemptId);
      const released = stillReserved && !runtime.released && !runtime.stopRequested
        && !before.parentStopped
        && !before.completed
        ? releaseUnstartedReservations(runtime, [record])
        : 0;
      let parked = runtime.scheduler.snapshot().pending.some((item) => item.attemptId === record.attemptId);
      if (released > 0) {
        try {
          persist(runtime);
          const durable = readLaunchTask(runtime);
          parked = parked && Boolean(durable.task?.loopPlus.pending.some((item) => (
            item.attemptId === record.attemptId && item.subtaskId === record.subtaskId
          )));
          if (!parked) runtime.scheduler = runtime.createScheduler({ snapshot: before });
        } catch (error) {
          parked = false;
          runtime.scheduler = runtime.createScheduler({ snapshot: before });
          logPersistenceFailure(runtime.taskId, "release-reservation", error, runtime, record.attemptId);
        }
      }
      logLaunchPersist(runtime, record.attemptId, "launch-commit", "contended", reason, attempt);
      const running = runtime.scheduler.snapshot().running.some((item) => item.attemptId === record.attemptId);
      const slot = parked ? "pending" : running ? "running" : "missing";
      const recovery = parked ? "promote-pending" : running ? "resume-interrupted" : "none";
      if (running && !parked) runtime.unstartedLaunchRecovery.add(record.attemptId);
      deps.log?.("loop-plus-launch-reservation", {
        taskId: runtime.taskId,
        attemptId: record.attemptId,
        slot,
        recovery,
      });
      return false;
    };
    try {
      for (let attempt = 1; attempt <= LAUNCH_PERSIST_ATTEMPTS; attempt += 1) {
        const gate = launchGate(runtime, record, epoch, mainGeneration);
        if (gate === "stop") {
          restoreMeta();
          abandonUnstarted(runtime, record);
          logLaunchPersist(runtime, record.attemptId, "launch-commit", "cancelled", "stopped", attempt);
          return false;
        }
        if (gate === "pause") {
          restoreMeta();
          if (releaseUnstartedReservations(runtime, [record]) > 0) {
            try {
              persist(runtime);
            } catch (error) {
              logPersistenceFailure(runtime.taskId, "release-reservation", error, runtime, record.attemptId);
            }
          }
          logLaunchPersist(runtime, record.attemptId, "launch-commit", "cancelled", "paused", attempt);
          return false;
        }
        if (gate === "stale") return cancel("stale-generation", attempt);
        const read = readLaunchTask(runtime);
        if (read.failed) {
          logLaunchPersist(runtime, record.attemptId, "launch-read", "unconfirmed", "read-unavailable", attempt);
          return false;
        }
        if (read.task) {
          const refused = refuseAuthoritative(read.task, attempt);
          if (refused !== null) return refused;
        }
        const readCommitted = read.task ? launchStartCommitted(runtime, read.task, record, launchedAt) : false;
        if (readCommitted === "stale-generation") return cancel("stale-generation", attempt);
        if (readCommitted) {
          applyMeta();
          started = true;
          logLaunchPersist(runtime, record.attemptId, "launch-commit", "committed", undefined, attempt);
          return true;
        }
        if (read.task && !launchReservationDurable(read.task, record)) return cancel("reservation-absent", attempt);
        if (read.task && !launchSnapshotAligned(runtime, read.task)) {
          logLaunchPersist(runtime, record.attemptId, "launch-commit", "unconfirmed", "snapshot-diverged", attempt);
          return false;
        }
        if (!read.task) {
          const reason: LaunchPersistReason = read.busy ? "identity-lock-present" : "read-unavailable";
          if (read.busy && attempt < LAUNCH_PERSIST_ATTEMPTS) {
            logLaunchPersist(runtime, record.attemptId, "launch-read", "retry", reason, attempt);
            await delay(LAUNCH_PERSIST_RETRY_DELAYS_MS[attempt - 1]);
            continue;
          }
          if (read.busy) {
            return parkAfterContention(attempt, reason);
          }
          logLaunchPersist(runtime, record.attemptId, "launch-read", "unconfirmed", reason, attempt);
          return false;
        }
        const updatedAt = read.task.updatedAt;
        applyMeta();
        try {
          const parent = read.task;
          const commit = runtime.ordinary && parent.status === "running" ? deps.commitOrdinaryRun : undefined;
          persist(runtime, { status: runtime.scheduler.snapshot().parentStopped ? "stopped" : "running" }, commit ? {
            readTask: () => parent,
            updateTask: (_id, patch) => commit(parent, patch),
          } : deps);
          started = true;
          logLaunchPersist(runtime, record.attemptId, "launch-commit", "committed", undefined, attempt);
          return true;
        } catch (error) {
          restoreMeta();
          const provenUnpublished = error instanceof OrdinaryUpdateIdentityLockBusy || error instanceof LoopPlusUpdateUnconfirmedError;
          const after = readLaunchTask(runtime);
          if ((error instanceof OrdinaryUpdateIdentityLockBusy || error instanceof OrdinaryUpdateVersionChanged) && (after.busy || after.task)) {
            const reason: LaunchPersistReason = after.busy || error instanceof OrdinaryUpdateIdentityLockBusy ? "identity-lock-present" : "update-unconfirmed";
            if (attempt >= LAUNCH_PERSIST_ATTEMPTS) return parkAfterContention(attempt, reason);
            logLaunchPersist(runtime, record.attemptId, "launch-commit", "retry", reason, attempt);
            await delay(LAUNCH_PERSIST_RETRY_DELAYS_MS[attempt - 1]);
            continue;
          }
          if (after.task) {
            const refused = refuseAuthoritative(after.task, attempt);
            if (refused !== null) return refused;
          }
          const afterCommitted = after.task ? launchStartCommitted(runtime, after.task, record, launchedAt) : false;
          if (afterCommitted === "stale-generation") return cancel("stale-generation", attempt);
          if (afterCommitted) {
            applyMeta();
            started = true;
            logLaunchPersist(runtime, record.attemptId, "launch-commit", "committed", undefined, attempt);
            return true;
          }
          const aligned = Boolean(after.task && launchSnapshotAligned(runtime, after.task) && launchReservationDurable(after.task, record));
          const unchanged = Boolean(after.task && after.task.updatedAt === updatedAt);
          if (!provenUnpublished || after.failed || !aligned || (!unchanged && !after.busy)) {
            const reason: LaunchPersistReason = !provenUnpublished ? "write-unconfirmed"
              : after.task && !launchReservationDurable(after.task, record) ? "reservation-absent"
              : after.task && !launchSnapshotAligned(runtime, after.task) ? "snapshot-diverged"
              : "read-unavailable";
            logLaunchPersist(runtime, record.attemptId, "launch-commit", reason === "reservation-absent" ? "cancelled" : "unconfirmed", reason, attempt);
            return false;
          }
          const reason: LaunchPersistReason = error instanceof OrdinaryUpdateIdentityLockBusy || after.busy ? "identity-lock-present" : "update-unconfirmed";
          if (attempt < LAUNCH_PERSIST_ATTEMPTS) {
            logLaunchPersist(runtime, record.attemptId, "launch-commit", "retry", reason, attempt);
            await delay(LAUNCH_PERSIST_RETRY_DELAYS_MS[attempt - 1]);
            continue;
          }
          return parkAfterContention(attempt, reason);
        }
      }
      return false;
    } finally {
      if (!started) restoreMeta();
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
            logPersistenceFailure(runtime.taskId, "release-reservation", error, runtime, record.attemptId);
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
              logPersistenceFailure(runtime.taskId, "release-reservation", error, runtime, record.attemptId);
            }
          }
        } else if (runtime.stopRequested || runtime.scheduler.snapshot().parentStopped) {
          abandonUnstarted(runtime, record);
        }
        return;
      }
      const launchedAt = runtime.lastLaunchAt;
      if (typeof launchedAt !== "number" || !Number.isFinite(launchedAt)) {
        return;
      }
      const committed = await commitQueuedLaunch(runtime, record, epoch, launchedAt, communicationFile);
      if (!committed || launchGate(runtime, record, epoch, runtime.mainGeneration) !== "ready") {
        return;
      }
      const visible = readLaunchTask(runtime);
      // Start only when this same generation still has the committed running
      // reservation. An empty reread, a pending park, or a moved seq is not
      // confirmation, and this return does not rewrite disk.
      if (!visible.task || launchStartCommitted(runtime, visible.task, record, launchedAt) !== true) {
        if (visible.busy) runtime.unstartedLaunchRecovery.add(record.attemptId);
        return;
      }
      const notifyStarted = () => notifySubtaskChat(runtime, {
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
      const confirmed = visible.task;
      const reservation = confirmed.subTasks.find(item => item.id === record.subtaskId)?.launchReservation;
      const guardedCommit = runtime.ordinary && reservation?.attemptId === record.attemptId ? deps.commitOrdinaryRun : undefined;
      if (!guardedCommit) notifyStarted();
      const request: LoopPlusAttemptRequest = {
        ...(guardedCommit ? { claimExecution: async (signal: AbortSignal) => {
          const claimed = await claimOrdinaryLaunch(confirmed, record.subtaskId, record.attemptId, signal, deps.readTask, guardedCommit);
          if (claimed && !signal.aborted) notifyStarted();
          return claimed;
        } } : {}),
        taskId: runtime.taskId,
        subtaskId: record.subtaskId,
        continueFromSubtaskId: decision.continueFromSubtaskId,
        dependsOn: [...(decision.dependsOn ?? [])],
        attemptId: record.attemptId,
        title: decision.title,
        prompt: decision.prompt,
        modelPrompt: buildLoopPlusSubtaskModelPrompt({
          subtask: decision,
          departmentEmployee: !confirmed.departmentInvalid && confirmed.department?.role === "leader",
          communicationFile: communicationFile ?? "",
          executionRole,
          loopSubtaskMode: subtaskExecution.mode,
          requireAcceptedDependencies: runtime.scheduler.requireAcceptedDependencies,
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
        handle = deps.startAttempt(request, confirmed);
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
        readLostOutcome: handle.readLostOutcome,
      };
      runtime.attempts.set(record.attemptId, inFlight);
      void handle.promise.then((result) => {
        if (inFlight.settled) {
          return;
        }
        inFlight.settled = true;
        if (result.reservationUnconfirmed) {
          if (meta) { meta.executionStatus = "blocked"; meta.executionFailure = UNCONFIRMED_ATTEMPT_RESULT; }
          return;
        }
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

  function safeApplyFinish(runtime: ParentRuntime, input: AttemptFinish): void {
    try {
      applyFinish(runtime, input);
    } catch (error) {
      handleFinishError(runtime, input, error);
    }
  }

  function handleFinishError(runtime: ParentRuntime, input: AttemptFinish, error: unknown): void {
    const detail = errorText(error);
    deps.log?.("loop-plus-finish-failed", { taskId: runtime.taskId, attemptId: input.attemptId, error: detail });
    if (!runtime.released && !runtime.scheduler.snapshot().completed) {
      retainFinishFailure(runtime, "loop-plus-finish-failed", `Loop+ finish handling failed: ${detail}`);
    } else {
      settle(runtime);
    }
  }

  function applyFinish(runtime: ParentRuntime, input: AttemptFinish): void {
    if (runtime.finishes.has(input.attemptId)) return;
    if (input.outcome === "failed") {
      input = { ...input, detail: normalizeLoopSubtaskFailure(input.detail) ?? "CLI 调用失败，未捕获具体错误。" };
    }
    const delivery: FinishDelivery = { input, parent: runtime.verifiedParentContext, retries: 0, reported: false,
      stage: "parent-read", startedAt: now() };
    runtime.finishes.set(input.attemptId, delivery);
    deliverFinish(runtime, delivery);
  }

  function deliverFinish(runtime: ParentRuntime, delivery: FinishDelivery): void {
    const { input } = delivery;
    if (runtime.finishes.get(input.attemptId) !== delivery) return;
    delivery.wake = undefined;
    const currentAttempt = runtime.scheduler.snapshot().running.find((item) => item.subtaskId === input.subtaskId);
    let completed = false;
    let deferred = false;
    try {
      const applied = applyFinishResult(runtime, delivery);
      completed = applied && input.outcome === "completed";
      if (delivery.retries) logFinishContention(runtime, delivery, applied ? "committed" : "withheld");
    } catch (error) {
      if (!runtime.ordinary || !deps.commitOrdinaryRun
        || (!(error instanceof OrdinaryUpdateIdentityLockBusy) && !(error instanceof OrdinaryUpdateVersionChanged))) throw error;
      deferred = true;
      const retry = () => {
        try { deliverFinish(runtime, delivery); }
        catch (failure) { handleFinishError(runtime, input, failure); }
      };
      const wait = decisionCommitRetryDelaysMs[delivery.retries++];
      if (wait !== undefined) {
        logFinishContention(runtime, delivery, "retry", error);
        void delay(wait).then(retry, () => { delivery.wake = retry; });
      } else {
        if (delivery.retries === decisionCommitRetryDelaysMs.length + 1) logFinishContention(runtime, delivery, "waiting-for-watchdog", error);
        delivery.wake = retry;
      }
    } finally {
      if (!deferred) runtime.finishes.delete(input.attemptId);
      if (!deferred && (!currentAttempt || currentAttempt.attemptId === input.attemptId)) {
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

  function logFinishContention(runtime: ParentRuntime, delivery: FinishDelivery, result: string,
    cause?: OrdinaryUpdateIdentityLockBusy | OrdinaryUpdateVersionChanged): void {
    const { subtaskId, attemptId } = delivery.input;
    deps.log?.("loop-plus-finish-contention", {
      batchKey: loopPlusFrozenBatchKey([buildLoopPlusFinishEventId(subtaskId, attemptId)]),
      stage: delivery.stage, result, retry: delivery.retries, schedulerSeq: runtime.scheduler.snapshot().seq,
      elapsedMs: Math.max(0, now() - delivery.startedAt),
      ...(cause ? { reason: cause instanceof OrdinaryUpdateIdentityLockBusy ? "identity-lock-present" : "record-version-changed" } : {}),
    });
  }

  function readFinishParent(taskId: string): LoopTaskRecord | null {
    let busy = false;
    const parent = deps.readTask(taskId, { onUnavailable: reason => { busy = reason === "identity-lock-present"; } });
    if (!parent && busy) throw new OrdinaryUpdateIdentityLockBusy("parent-read");
    return parent;
  }

  function applyFinishResult(runtime: ParentRuntime, delivery: FinishDelivery): boolean {
    const { input } = delivery;
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
    const guardedCommit = runtime.ordinary && openAttempt ? deps.commitOrdinaryRun : undefined;
    const retainedStatus = runtime.stopRequested || snapshot.parentStopped ? "stopped" : runtime.autoPaused ? runtime.pauseStatus : undefined;
    let task: LoopTaskRecord | null = null;
    let readError: { error: unknown } | undefined;
    if (guardedCommit) {
      delivery.stage = "parent-read";
      try {
        task = readFinishParent(runtime.taskId);
      } catch (error) {
        if (error instanceof OrdinaryUpdateIdentityLockBusy) throw error;
        readError = { error };
      }
      if (task && (task.id !== runtime.taskId || task.department || task.departmentInvalid || task.status !== (retainedStatus ?? "running")
        || (task.userStopSource && retainedStatus !== "stopped") || task.runtimeInterrupted || !task.loopPlus || invalidSnapshotReason(task)
        || (delivery.retries && delivery.parent && !sameLoopPlusMainParent(delivery.parent, task))
        || !launchSnapshotAligned(runtime, { ...task, loopPlus: runtime.createScheduler({ snapshot: task.loopPlus }).snapshot() }))) {
        deps.log?.("loop-plus-finish-ignored", { taskId: runtime.taskId, attemptId: input.attemptId, reason: "parent-superseded" });
        return false;
      }
      if (task) delivery.parent = task;
    }
    const staged = guardedCommit ? { ...runtime, scheduler: runtime.createScheduler({ snapshot }), meta: new Map(runtime.meta),
      launching: runtime.autoPaused ? new Set(runtime.launching) : runtime.launching,
      launchEpoch: runtime.autoPaused ? new Map(runtime.launchEpoch) : runtime.launchEpoch } : runtime;
    const originalMeta = runtime.meta.get(input.subtaskId);
    if (guardedCommit && originalMeta) staged.meta.set(input.subtaskId, { ...originalMeta });
    const adopt = () => {
      runtime.scheduler = staged.scheduler;
      runtime.meta = staged.meta;
      runtime.launching = staged.launching;
      runtime.launchEpoch = staged.launchEpoch;
    };
    const store: DecisionTaskStore = guardedCommit ? {
      readTask: () => task,
      updateTask: (_id, patch) => {
        if (!task) return null;
        try {
          const updated = guardedCommit(task, patch, retainedStatus);
          if (!updated) throw new LoopPlusUpdateUnconfirmedError(task.id);
          return updated;
        } catch (error) {
          if (error instanceof LoopPlusUpdateUnconfirmedError) {
            const current = readFinishParent(task.id);
            if (current && current.updatedAt !== task.updatedAt) throw new OrdinaryUpdateVersionChanged("Loop+ parent version changed before finish commit");
          }
          throw error;
        }
      },
    } : deps;
    if (input.outcome === "stopped" && input.detail !== "lost-process"
      && !runtime.stopRequested && !snapshot.parentStopped && openAttempt) {
      // Keep the reservation until the subtask continuation reports a result.
      const meta = staged.meta.get(input.subtaskId);
      if (meta) {
        meta.executionStatus = "blocked";
      }
      delivery.stage = "event-write";
      persist(staged, {}, store);
      adopt();
      deps.log?.("loop-plus-subtask-interrupted", {
        taskId: runtime.taskId,
        subtaskId: input.subtaskId,
        attemptId: input.attemptId,
      });
      return false;
    }
    staged.scheduler.updateMaxConcurrency(maxConcurrency());
    const result = staged.scheduler.finish({
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
    const meta = setFinishMetadata(staged, input);
    try {
      if (readError) throw readError.error;
      if (!guardedCommit) task = deps.readTask(runtime.taskId);
    } catch (error) {
      adopt();
      const detail = errorText(error);
      logPersistenceFailure(runtime.taskId, "finish-read", error, runtime, input.attemptId);
      releaseUnstartedReservations(runtime, result.started);
      const retained = retainFinishFailure(runtime, "loop-plus-persist-failed", `Loop+ state persistence failed: ${detail}`, store);
      if (retained || input.outcome !== "completed") notifySubtaskChat(runtime, finishedChatNotice(input, meta));
      return false;
    }
    if (task && openAttempt && input.outcome === "completed") {
      delivery.stage = "receipt-write";
      task = checkpointAttemptCompletion(runtime, task, input, store.updateTask, Boolean(guardedCommit));
    }
    if (task && deps.recordAttempt && !delivery.reported) {
      try {
        deps.recordAttempt({
          task,
          subtaskId: input.subtaskId,
          attemptId: input.attemptId,
          outcome: input.outcome,
          detail: input.detail,
          communicationFile: meta?.communicationFile,
        });
        delivery.reported = true;
      } catch (error) {
        adopt();
        const detail = errorText(error);
        deps.log?.("loop-plus-report-failed", {
          taskId: runtime.taskId,
          subtaskId: input.subtaskId,
          attemptId: input.attemptId,
          error: detail,
        });
        releaseUnstartedReservations(runtime, result.started);
        const retained = retainFinishFailure(runtime, "loop-plus-report-failed", `Loop+ attempt report failed: ${detail}`, store);
        if (retained || input.outcome !== "completed") notifySubtaskChat(runtime, finishedChatNotice(input, meta));
        return false;
      }
    }
    if (runtime.autoPaused) {
      releaseUnstartedReservations(staged, result.started);
    }
    delivery.stage = "event-write";
    try {
      persist(staged, {}, store);
    } catch (error) {
      if (guardedCommit && (error instanceof OrdinaryUpdateIdentityLockBusy || error instanceof OrdinaryUpdateVersionChanged)) throw error;
      adopt();
      const detail = errorText(error);
      logPersistenceFailure(runtime.taskId, "finish-commit", error, runtime, input.attemptId);
      releaseUnstartedReservations(runtime, result.started);
      const retained = retainFinishFailure(runtime, "loop-plus-persist-failed", `Loop+ state persistence failed: ${detail}`, store);
      if (retained || input.outcome !== "completed") notifySubtaskChat(runtime, finishedChatNotice(input, meta));
      return false;
    }
    adopt();
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
    relaunchUnstartedLaunchRecovery(runtime);
    // Every applied finish can unblock review selection, even when the kernel
    // wake was already latched by an earlier deferred successor.
    requestPump(runtime);
    return true;
  }

  function setFinishMetadata(runtime: ParentRuntime, input: LoopPlusAttemptCompletionReceipt & { outcome: LoopPlusExecutionOutcome }): SubtaskMeta | undefined {
    const meta = runtime.meta.get(input.subtaskId);
    if (meta) {
      meta.summary = input.detail ?? meta.summary;
      meta.executionStatus = input.outcome === "completed" ? "completed" : "blocked";
      meta.executionFailure = input.outcome === "failed" || input.outcome === "unconfirmed" ? input.detail ?? undefined : undefined;
    }
    return meta;
  }

  function checkpointAttemptCompletion(runtime: ParentRuntime, task: LoopTaskRecord, receipt: LoopPlusAttemptCompletionReceipt,
    write: DecisionTaskStore["updateTask"], guarded: boolean): LoopTaskRecord {
    if (task.status === "completed" || invalidSnapshotReason(task)) return task;
    const durable = runtime.createScheduler({ snapshot: task.loopPlus }).snapshot();
    if (!durable.running.some((attempt) => attempt.subtaskId === receipt.subtaskId && attempt.attemptId === receipt.attemptId)) return task;
    const previous = task.loopPlusAttemptCompletionReceipts ?? [];
    if (previous.some((item) => item.attemptId === receipt.attemptId)) return task;
    try {
      return updateTask(task.id, { loopPlusAttemptCompletionReceipts: [...previous, {
        subtaskId: receipt.subtaskId, attemptId: receipt.attemptId, detail: receipt.detail,
      }] }, write);
    } catch (error) {
      if (guarded && (error instanceof OrdinaryUpdateIdentityLockBusy || error instanceof OrdinaryUpdateVersionChanged)) throw error;
      logPersistenceFailure(runtime.taskId, "finish-receipt-commit", error, runtime, receipt.attemptId);
      return task;
    }
  }

  function retainFinishFailure(runtime: ParentRuntime, message: string, finalSummary: string, store: DecisionTaskStore = deps): boolean {
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
    let retained = false;
    try {
      persist(runtime, {
        status,
        finalSummary,
        ...((status === "error" || status === "stopped") ? {
          loopPlusInterruption: {
            phase: snapshot.phase,
            reason: classifyLoopPlusInterruption({
              status,
              persistenceFailure: status === "error",
            }),
          },
        } : {}),
      }, store);
      retained = true;
    } catch (error) {
      logPersistenceFailure(runtime.taskId, "finish-pause-commit", error, runtime);
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
    return retained;
  }

  function canCompleteDirectly(runtime: ParentRuntime, task: LoopTaskRecord | null): boolean {
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

  function rememberVerifiedParent(runtime: ParentRuntime, task: LoopTaskRecord): void {
    runtime.verifiedParentContext = { ...task, id: task.id };
  }

  function resolveParentContext(
    runtime: ParentRuntime,
    stage: "parent-context" | "decision-validation" | "acceptance-submit",
    step: MainStep | null = null,
  ): { record: LoopTaskRecord | null; authoritative: boolean } {
    const task = deps.readTask(runtime.taskId);
    const identityMatched = !!task && task.id === runtime.taskId;
    if (identityMatched && task) {
      rememberVerifiedParent(runtime, task);
      return { record: task, authoritative: true };
    }
    const verified = runtime.verifiedParentContext?.id === runtime.taskId ? runtime.verifiedParentContext : null;
    const progress = normalizeLoopPlusProgressPercent(verified?.loopPlusProgressPercent);
    deps.log?.("loop-plus-parent-context", {
      taskId: runtime.taskId,
      stage,
      code: task ? "identity-mismatch" : "record-unreadable",
      taskPresent: task !== null,
      identityMatched: false,
      frozenContextPresent: verified !== null,
      frozenPrefixIntact: !!step && (step.eventIds.length === 0 || heldBatchIntact(runtime.scheduler.snapshot(), step)),
      acceptancePlanPresent: listLoopPlusAcceptancePlanFeedbackItems(verified?.loopPlusAcceptancePlan).length > 0,
      routePresent: Boolean(verified?.loopSubtaskMode || verified?.modelRouting),
      progressPresent: progress !== undefined,
      rootPresent: Boolean(verified?.rootPrompt?.trim()),
      authoritative: false,
      acceptanceSubmitted: false,
      fieldKnown: false,
    });
    return { record: verified, authoritative: false };
  }

  function withholdParentAcceptance(runtime: ParentRuntime): "continue" | "stop" {
    runtime.authorityWithholdCount += 1;
    if (runtime.authorityWithholdCount > LOOP_PLUS_PROTOCOL_AUTOMATIC_RETRY_LIMIT) {
      pause(runtime, "needs-review", "loop-plus-protocol-paused",
        "宿主状态拒绝（state）。原因码：state.parent_context.unauthoritative。当前权威任务记录不可用，验收未提交。冻结批次保留。决策拒绝字段未知。");
      return "stop";
    }
    return "continue";
  }

  function loadedDecisionHelperScriptPath(): string | null {
    let install: string | null | undefined;
    try {
      install = deps.loadedExtensionInstallPath?.();
    } catch (error) {
      deps.log?.("loop-plus-decision-helper-path-unavailable", { error: errorText(error) });
      return null;
    }
    return resolveLoopPlusDecisionHelperScriptPath(install);
  }

  function protocolCorrectionHelperLine(scriptPath: string | null): string {
    if (!scriptPath) {
      return "Protocol correction has no loaded-extension helper path. Do not invent a script path.";
    }
    return `Protocol correction uses this same helper argv: ${JSON.stringify(loopPlusDecisionHelperArgv(scriptPath, "template"))}`;
  }

  function buildMainRequest(runtime: ParentRuntime, step: MainStep, preparingTask?: LoopTaskRecord): LoopPlusMainRequest {
    runtime.scheduler.updateMaxConcurrency(maxConcurrency());
    const prepared = preparingTask?.id === runtime.taskId ? preparingTask : null;
    if (prepared) {
      rememberVerifiedParent(runtime, prepared);
    }
    const task = prepared ?? resolveParentContext(runtime, "parent-context", step).record;
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
    const interrupted = view.running.filter(record => isInterruptedReservation(runtime, record));
    if (runtime.currentMainStep !== step) {
      step.visibleReviewCount = view.visibleReviewCount;
      step.interruptedAttempts = runtime.ordinary ? new Map(interrupted.map(record => [record.subtaskId, record.attemptId])) : undefined;
    }
    const helperScriptPath = loadedDecisionHelperScriptPath();
    const basePrompt = buildLoopPlusMainModelPrompt({
      taskId: runtime.taskId,
      rootPrompt: task?.rootPrompt ?? runtime.prompt.displayPrompt,
      taskStoreFile: task?.taskStoreFile ?? "",
      mainCommunicationFile: task?.mainCommunicationFile ?? "",
      kind: step.kind,
      allowDispatchBeforeReview: step.allowDispatchBeforeReview,
      requireAcceptedDependencies: runtime.scheduler.requireAcceptedDependencies,
      acceptancePlan: task?.loopPlusAcceptancePlan ?? null,
      allowDirectCompletion: canCompleteDirectly(runtime, task),
      inlineRules: runtime.protocolFailureCount > 0,
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
      reportOnly: step.reportOnly,
      requiredRepairIds: runtime.scheduler.snapshot().seenAttempts.filter((item) => item.repairRequired).map((item) => item.subtaskId),
      reportQueue: (runtime.scheduler.snapshot().reportQueue ?? [])
        .filter((item) => frozenReportIds.has(item.eventId)),
      priorSubtaskFailures: getLoopPlusFailureLines(runtime, step, false),
      interruptedSubtaskIds: interrupted.map(record => record.subtaskId),
      pendingUserMessages: step.userMessageCount > 0
        ? runtime.scheduler.snapshot().userMessageQueue.slice(0, step.userMessageCount)
        : [],
      maxConcurrency: runtime.scheduler.snapshot().maxConcurrency,
      subtaskMax: decisionSubtaskMax(),
      nextStepPlan: task?.loopPlusNextStepPlan,
      progressPercent: normalizeLoopPlusProgressPercent(task?.loopPlusProgressPercent) ?? 0,
      ...(routing.mode ? { loopSubtaskMode: routing.mode } : {}),
      routingSummary: routing.summary,
      ...(departmentEmployeeCapacity ? { departmentEmployeeCapacity } : {}),
      ...(task?.loopPlusBlockReview?.state === "pending"
        ? { blockedReviewSummary: task.loopPlusBlockReview.summary ?? "" }
        : {}),
      recoveryOptions: task?.loopPlusBlockReview?.recoveryOptions,
      decisionHelperScriptPath: helperScriptPath,
    });
    const prompt = runtime.protocolFailureReason
      ? `${basePrompt}\n\n${buildLoopPlusProtocolContinuationPrompt(runtime.protocolFailureReason, runtime.protocolRecovery ?? undefined)}\n${protocolCorrectionHelperLine(helperScriptPath)}`
      : basePrompt;
    return {
      taskId: runtime.taskId,
      kind: step.kind,
      prompt,
      modelPrompt: prompt,
      reviewEventId: step.eventId,
      reviewEventIds: step.eventIds.slice(),
      reportEventIds: step.reportEventIds.slice(),
      reportOnly: step.reportOnly,
      userMessageCount: step.userMessageCount,
      target: runtime.target,
    };
  }

  function interruptionForPersist(
    runtime: ParentRuntime,
    task: LoopTaskRecord | null,
    patch: Partial<LoopTaskRecord>,
    status: LoopTaskStatus,
    phase: LoopPlusInterruptionSource["phase"],
  ): { source: LoopPlusInterruptionSource | undefined; carried: boolean } {
    if (status !== "error" && status !== "stopped") return { source: undefined, carried: false };
    const explicit = readLoopPlusInterruptionSource(patch.loopPlusInterruption);
    if (explicit) return { source: explicit, carried: false };
    const existing = readLoopPlusInterruptionSource(task?.loopPlusInterruption);
    if (existing && task && (task.status === "error" || task.status === "stopped") && task.status === status) {
      return { source: existing, carried: true };
    }
    const backgroundSubtaskFailure = status === "error"
      && !(runtime.autoPaused && runtime.pauseStatus === "error")
      && !runtime.stopRequested
      && [...runtime.meta.values()].some((meta) => meta.executionStatus === "blocked" && Boolean(meta.executionFailure));
    return {
      source: {
        phase,
        reason: classifyLoopPlusInterruption({
          status,
          userStopSource: task?.userStopSource,
          backgroundSubtaskFailure,
        }),
      },
      carried: false,
    };
  }

  function buildPersistencePatch(runtime: ParentRuntime, task: LoopTaskRecord | null, patch: Partial<LoopTaskRecord>): Partial<LoopTaskRecord> {
    const snapshot = runtime.scheduler.snapshot();
    const subTasks = mergeSubtasks(runtime, task?.subTasks ?? [], snapshot);
    if (runtime.ordinary && task && deps.commitOrdinaryRun) projectLaunchReservations(task, snapshot, subTasks);
    const runningIds = snapshot.running.map((item) => item.subtaskId);
    const status = patch.status ?? statusFor(runtime, snapshot, task);
    const receipts = task?.loopPlusAttemptCompletionReceipts;
    const openReceipts = receipts?.filter((receipt) => snapshot.running.some((attempt) =>
      attempt.subtaskId === receipt.subtaskId && attempt.attemptId === receipt.attemptId));
    const interruption = interruptionForPersist(runtime, task, patch, status, snapshot.phase);
    if (interruption.source) {
      deps.log?.("loop-plus-interruption-source", {
        phase: snapshot.phase,
        reason: interruption.source.reason,
        carried: interruption.carried,
      });
    }
    return {
      ...patch,
      ...(receipts && openReceipts?.length !== receipts.length ? {
        loopPlusAttemptCompletionReceipts: openReceipts?.length ? openReceipts : undefined,
      } : {}),
      status,
      schedulingMode: "event_driven",
      loopPlus: snapshot,
      loopPlusMainPhase: runtime.decomposing ? "decomposing" : undefined,
      activeSubtaskId: runningIds[0] ?? null,
      activeSubtaskIds: runningIds,
      subTasks,
      ...(interruption.source
        ? { loopPlusInterruption: interruption.source }
        : task?.loopPlusInterruption ? { loopPlusInterruption: undefined } : {}),
      updatedAt: now(),
    };
  }

  function persist(runtime: ParentRuntime, patch: Partial<LoopTaskRecord> = {}, store: DecisionTaskStore = deps): LoopTaskRecord {
    const parent = store.readTask(runtime.taskId);
    if (!parent || parent.id !== runtime.taskId) throw new LoopPlusUpdateUnconfirmedError(runtime.taskId);
    const committed = updateTask(runtime.taskId, buildPersistencePatch(runtime, parent, patch), store.updateTask);
    try {
      refreshCurrentMainPrompt(runtime);
    } catch (error) {
      deps.log?.("loop-plus-refresh-failed", {
        taskId: runtime.taskId,
        error: errorText(error),
      });
    }
    return committed;
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

  function mergeSubtasks(runtime: ParentRuntime, existing: readonly LoopSubtaskRecord[], snapshot = runtime.scheduler.snapshot()): LoopSubtaskRecord[] {
    const byId = new Map(existing.map((subtask) => [subtask.id, subtask]));
    const running = new Set(snapshot.running.map(item => item.subtaskId));
    const pending = new Set(snapshot.pending.map(item => item.subtaskId));
    const latest = new Map(snapshot.seenAttempts.map(attempt => [attempt.subtaskId, attempt]));
    runtime.meta.forEach((meta, subtaskId) => {
      const previous = byId.get(subtaskId);
      const attempt = latest.get(subtaskId);
      const active = running.has(subtaskId)
        ? meta.executionStatus === "blocked" ? "blocked" : "running"
        : pending.has(subtaskId)
          ? "pending"
          : attempt?.disposition === "reviewed" && attempt.outcome === "completed" && attempt.acceptance === "passed"
            ? "completed"
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
        ...(previous?.repairSource ? { repairSource: previous.repairSource } : {}),
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
    preserveReservations = false,
    patch: Pick<LoopTaskRecord, "loopPlusMainRecoveryFailureCount"> = {},
    store: DecisionTaskStore = deps,
  ): void {
    runtime.autoPaused = true;
    runtime.pauseStatus = status;
    runtime.decomposing = false;
    if (!preserveReservations) releaseLaunchingReservations(runtime);
    const consumerFailure = status === "error" && message === "loop-plus-consumer-failed";
    const interruption = consumerFailure ? {
      phase: runtime.scheduler.snapshot().phase,
      reason: "execution-error" as const,
    } : undefined;
    const resolvedSummary = resolveLoopPlusPauseFinalSummary(status, message, finalSummary);
    try {
      persist(runtime, {
        ...patch,
        status,
        ...(resolvedSummary ? { finalSummary: resolvedSummary } : {}),
        ...(interruption ? { loopPlusInterruption: interruption } : {}),
      }, store);
    } catch (error) {
      logPersistenceFailure(runtime.taskId, "pause-commit", error, runtime);
    }
    notifyPause(runtime, status, message);
    settle(runtime);
  }

  function commitPendingMainFailure(runtime: ParentRuntime): void {
    const pending = runtime.pendingMainFailure;
    if (!pending) return;
    let busy = false;
    try {
      const task = deps.readTask(runtime.taskId, { onUnavailable: (reason) => { busy = reason === "identity-lock-present"; } });
      if (!task && busy) return;
      if (task?.status === "running" && sameLoopPlusMainParent(pending.parent, task) && runtime.autoPaused && !runtime.released && !runtime.stopRequested) {
        const failure = buildNextLoopMainAiFailureState(task, { failureMessage: pending.message, now: pending.at });
        const patch: Partial<LoopTaskRecord> = { ...failure, mainAiLastFailureCode: pending.code,
          status: "needs-review", loopPlusMainPhase: undefined, updatedAt: now(),
          finalSummary: buildLoopMainAiFailureSummary(failure, { nonRetryable: true, code: pending.code }) };
        const updated = deps.commitOrdinaryRun ? deps.commitOrdinaryRun(task, patch) : updateTask(task.id, patch);
        if (!updated) throw new LoopPlusUpdateUnconfirmedError(task.id);
        runtime.pendingMainFailure = undefined;
        notifyPause(runtime, "needs-review", "loop-plus-main-non-retryable");
      }
      runtime.pendingMainFailure = undefined;
    } catch (error) {
      logPersistenceFailure(runtime.taskId, "main-failure-commit", error, runtime);
    }
  }

  function notifyPause(runtime: ParentRuntime, status: LoopTaskStatus, message: string): void {
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
  }

  function resetMainFailure(runtime: ParentRuntime, store: DecisionTaskStore = deps): void {
    const task = store.readTask(runtime.taskId);
    if (!task || (!task.mainAiFailureCount && !task.mainAiFailureLimitReached)) {
      return;
    }
    updateTask(runtime.taskId, {
      ...buildResetLoopMainAiFailureState(),
      mainAiLastFailureCode: undefined,
      schedulingMode: "event_driven",
      updatedAt: now(),
    }, store.updateTask);
  }

  function persistEstimatedRounds(runtime: ParentRuntime, decision: LoopPlusDecision, store: DecisionTaskStore = deps): void {
    if (typeof decision.estimatedRemainingRounds !== "number") {
      return;
    }
    updateTask(runtime.taskId, {
      estimatedRemainingRounds: decision.estimatedRemainingRounds,
      schedulingMode: "event_driven",
      updatedAt: now(),
    }, store.updateTask);
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

  function applyLoopPlusControls(
    runtime: ParentRuntime,
    controls: readonly LoopPlusControlDecision[],
  ): boolean {
    const planned = planControlCommands(runtime, controls);
    if (!planned) {
      return false;
    }
    return !commitControlPlan(runtime, controls, planned, []).controlFailure;
  }

  function controlRejectionReason(result: LoopPlusControlResult): string | null {
    if (result.ok) return null;
    const target = result.rejectedSubtaskId ? `目标 ${JSON.stringify(result.rejectedSubtaskId)}` : "目标任务";
    switch (result.reason) {
      case "not_open":
        return `controls 的${target} 已不在运行或排队，可能在本轮主模型调用期间结束。请移除该控制项，保留当前冻结验收批次，并在该任务的验收事件或报告可见时处理其结果。仍需修改时再用原子任务 ID 派发新的执行尝试。`;
      case "conflict":
        return `controls 为${target}安排的新执行与 ${result.block ? JSON.stringify(result.block.otherSubtaskId) : "其他任务"} 存在写入或冲突组冲突，请调整范围或等待冲突任务结束。`;
      case "duplicate_subtask":
      case "duplicate_attempt":
        return `controls 的${target}重复，请为同一任务只提交一项控制并核对当前执行尝试。`;
      case "parent_stopped":
      case "completed":
        return "当前父任务已停止或完成，无法提交 controls。";
      default:
        return `controls 无法应用，请核对${target}的动作、替换任务字段和依赖关系。`;
    }
  }

  function previewControlPlan(
    runtime: ParentRuntime,
    planned: ControlPlan,
  ): string | null {
    return staleInterruptionReason(runtime, planned) ?? controlRejectionReason(runtime.scheduler.applyControls(planned.commands, { dryRun: true }));
  }

  function staleInterruptionReason(runtime: ParentRuntime, planned: ControlPlan): string | null {
    if (!planned.interruptedAttempts?.size) return null;
    const { running } = runtime.scheduler.snapshot();
    for (const { subtaskId } of planned.commands) {
      const offered = planned.interruptedAttempts.get(subtaskId);
      if (offered && !running.some(record => record.attemptId === offered && record.subtaskId === subtaskId && isInterruptedReservation(runtime, record))) {
        return `子任务 ${subtaskId} 的中断状态已变化。请按最新 attempt 重新判断。`;
      }
    }
    return null;
  }

  function commitControlPlan(
    runtime: ParentRuntime,
    controls: readonly LoopPlusControlDecision[],
    planned: ControlPlan,
    subtasks: readonly LoopSubtaskDecision[],
    store: DecisionTaskStore = deps,
  ): LoopPlusDecisionWorkResult {
    const stale = staleInterruptionReason(runtime, planned);
    if (stale) return { decisions: [], rejected: [], controlFailure: stale };
    const before = runtime.scheduler.snapshot();
    const staged = { ...runtime, scheduler: runtime.createScheduler({ snapshot: before }), meta: new Map(runtime.meta), attemptSeq: planned.nextSeq };
    const result = staged.scheduler.applyControls(planned.commands, { deferPromotion: true });
    if (!result.ok) {
      deps.log?.("loop-plus-control-rejected", {
        taskId: runtime.taskId,
        reason: result.reason,
      });
      return { decisions: [], rejected: [], controlFailure: controlRejectionReason(result)! };
    }
    staged.scheduler.releaseUnstarted(result.started.map((item) => item.attemptId));
    result.closed.forEach((closed) => {
      recordControlledSubtask(staged, closed, controls.find((item) => item.id === closed.subtaskId));
    });
    const interruptedClosures = runtime.ordinary && subtasks.length ? result.closed.filter(record =>
      controls.some(control => control.id === record.subtaskId && control.action === "close") && isInterruptedReservation(runtime, record)) : [];
    if (interruptedClosures.length) {
      const outstanding = staged.scheduler.snapshot().seenAttempts.filter(item => item.disposition === "open" || item.disposition === "finished");
      const dependencies = new Set([...outstanding, ...subtasks].flatMap(item => item.dependsOn ?? []));
      const needed = interruptedClosures.find(record => dependencies.has(record.subtaskId));
      if (needed) return { decisions: [], rejected: [], controlFailure: `后继仍依赖 ${needed.subtaskId}。请用 controls.reprompt 沿原 ID 续派，保留依赖关系。` };
    }
    const dispatched = dispatchDecisions(staged, subtasks, { store, requireAll: interruptedClosures.length > 0 });
    const collisions = dispatchCollisionCounts.get(staged);
    if (collisions) dispatchCollisionCounts.set(runtime, collisions);
    else dispatchCollisionCounts.delete(runtime);
    if (interruptedClosures.length && dispatched.rejected.length) return dispatched;
    runtime.scheduler = staged.scheduler;
    runtime.meta = staged.meta;
    runtime.attemptSeq = staged.attemptSeq;
    result.closed.forEach((closed) => {
      retireControlledAttempt(runtime, closed);
      notifyControlledSubtask(runtime, closed, controls.find((item) => item.id === closed.subtaskId));
    });
    return dispatched;
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
      logPersistenceFailure(taskId, "acceptance-plan-edit", error, runtimes.get(taskId));
      return { ok: false, error: "验收方案更新失败，请稍后重试。" };
    }
    const runtime = runtimes.get(taskId);
    const recovery = runtime?.claimedMainRecovery ?? runtime?.interruptedMain;
    const kind = runtime?.currentMainRequest?.kind ?? recovery?.step.kind;
    const main = runtime?.currentMain;
    const previous = normalizeLoopPlusAcceptancePlanSnapshotForStorage(task.loopPlusAcceptancePlan);
    const unchanged = JSON.stringify(previous ?? null) === JSON.stringify(plan ?? null);
    if (runtime && !unchanged && (kind === "review" || kind === "closeout")) {
      if (kind === "closeout" && main && !recovery) {
        runtime.closeoutBudget = Math.max(runtime.closeoutBudget, 1);
      }
      runtime.acceptancePlanEpoch += 1;
      try {
        main?.abort();
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

  function submitIdleSupplement(runtime: ParentRuntime, task: LoopTaskRecord, snapshot: LoopPlusSchedulerSnapshot): void {
    const parent = runtime.verifiedParentContext;
    if (!parent || !sameLoopPlusMainParent(parent, task) || task.department || task.departmentInvalid
      || !task.loopPlus || task.loopPlusAttemptCompletionReceipts?.length
      || snapshot.running.some(record => !task.subTasks.some(member => member.id === record.subtaskId && member.status === "blocked"))) return;
    const stored = runtime.createScheduler({ snapshot: task.loopPlus, maxConcurrency: snapshot.maxConcurrency });
    if (!isDeepStrictEqual(stored.snapshot(), snapshot)) return;

    const text = buildLoopPlusIdleSupplement(snapshot.running);
    const alreadyQueued = snapshot.userMessageQueue.includes(text);
    const requirements = task.supplementalRequirements ?? [];
    const alreadyRecorded = requirements.includes(text);
    if (alreadyQueued && alreadyRecorded && !task.runtimeInterrupted) {
      requestPump(runtime);
      return;
    }
    const delivered = deliverLiveUserMessage(runtime, text, next => {
      const patch: Partial<LoopTaskRecord> = { loopPlus: next, supplementalRequirements: alreadyRecorded ? requirements : [...requirements, text],
        runtimeInterrupted: undefined, updatedAt: now() };
      return deps.commitOrdinaryRun ? deps.commitOrdinaryRun(task, patch) : deps.updateTask(task.id, patch);
    }, alreadyQueued);
    if (!delivered) return;
    if (!alreadyRecorded) deps.appendSupplementalRequirementToCommunication?.(task, text);
    deps.log?.("loop-plus-idle-supplement", { taskId: task.id, interruptedCount: snapshot.running.length });
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
    return deliverLiveUserMessage(runtime, text, next => {
      try {
        return updateTask(runtime.taskId, { status: "running", loopPlus: next, loopPlusBlockReview: undefined,
          ...(deliveryId ? { departmentDeliveries: { ...task?.departmentDeliveries, [deliveryId]: text } } : {}), updatedAt: now() });
      } catch (error) {
        blockSupplementCommit(runtime);
        throw error;
      }
    });
  }

  function deliverLiveUserMessage(runtime: ParentRuntime, text: string,
    commit: (snapshot: LoopPlusSchedulerSnapshot) => LoopTaskRecord | null, alreadyQueued = false): boolean {
    const staged = runtime.createScheduler({ snapshot: runtime.scheduler.snapshot(), maxConcurrency: maxConcurrency() });
    if (!alreadyQueued && !staged.enqueueUserMessage(text).queued) return false;
    if (!commit(staged.snapshot())) return false;
    runtime.scheduler = staged;
    runtime.supplementCommitBlocked = false;
    if (runtime.autoPaused) {
      runtime.autoPaused = false;
      armLifecycle(runtime);
    }
    if (runtime.interruptedMain || runtime.claimedMainRecovery) {
      supersedeMainRecovery(runtime);
    }
    if (runtime.currentMain) {
      return true;
    }
    requestPump(runtime);
    return true;
  }

  function blockSupplementCommit(runtime: ParentRuntime): void {
    runtime.supplementCommitBlocked = true;
    if (!runtime.stopRequested && !runtime.scheduler.snapshot().parentStopped && !runtime.autoPaused) {
      runtime.autoPaused = true;
      runtime.pauseStatus = "error";
    }
    runtime.forcePrompt = false;
    runtime.pumpRequested = false;
    deps.log?.("loop-plus-supplement-persist-blocked", {
      taskId: runtime.taskId,
      parentStopped: runtime.scheduler.snapshot().parentStopped,
      autoPaused: runtime.autoPaused,
    });
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
    runtime.pendingMainFailure = undefined;
    if (runtime.lifecycle.settled) {
      runtime.lifecycle = createLifecycle();
    }
  }

  function settle(runtime: ParentRuntime): void {
    runtime.wakeDecisionCommit?.();
    if (runtime.lifecycle.settled) {
      return;
    }
    runtime.lifecycle.settled = true;
    runtime.lifecycle.resolve(runtime.ordinary && runtime.autoPaused && !runtime.stopRequested ? "ordinary-paused" : undefined);
  }

  function releaseCompleted(runtime: ParentRuntime): void {
    runtime.released = true;
    runtime.mainGeneration += 1;
    runtime.interruptedMain = null;
    runtime.claimedMainRecovery = null;
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
    checkInterruptedMainTasks,
    checkWaitingMainTasks,
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
  let resolve: Lifecycle["resolve"] = () => undefined;
  const promise = new Promise<void | "ordinary-paused">((done) => {
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
