import {
  buildLoopSubtaskExecutionPlan,
  normalizeLoopWriteFiles,
  type LoopParallelCandidate,
  type LoopParallelConflictReason,
} from "./loopParallel";
import { readLoopPlusDependsOn } from "./loopPlusDependencies";

export const LOOP_PLUS_SCHEDULER_VERSION = 1;

export type LoopPlusSchedulerPhase =
  | "idle"
  | "waiting"
  | "review_ready"
  | "reviewing"
  | "stopped"
  | "completed";

export type LoopPlusExecutionOutcome = "completed" | "failed" | "stopped";
export type LoopPlusExecutionState = "pending" | "running";
export type LoopPlusAttemptDisposition = "open" | "finished" | "reviewed" | "reported" | "closed";
export type LoopPlusCompletionBlocker =
  | "running"
  | "pending"
  | "report_queue"
  | "review_queue"
  | "current_review"
  | "user_messages"
  | "parent_stopped"
  | "completed";
export type LoopPlusReviewFollowUp = "claim_next" | "wait" | "may_complete" | "stopped";
export type LoopPlusWaitAction = "review" | "wait" | "idle" | "stopped" | "completed";

export type LoopPlusSubtaskSpec = {
  subtaskId: string;
  attemptId: string;
  /** 缺省沿用完整验收；false 只要求主任务读取报告并继续。 */
  requiresAcceptance?: boolean;
  title?: string;
  conflictGroup?: string;
  writeFiles?: string[];
  dependsOn?: string[];
};

export type LoopPlusExecutionRecord = {
  subtaskId: string;
  attemptId: string;
  requiresAcceptance?: boolean;
  title: string | null;
  conflictGroup: string | null;
  writeFiles: string[];
  dependsOn?: string[];
  state: LoopPlusExecutionState;
};

export type LoopPlusReviewItem = {
  eventId: string;
  subtaskId: string;
  attemptId: string;
  outcome: LoopPlusExecutionOutcome;
  detail: string | null;
};

export type LoopPlusReviewAcceptance = "passed" | "failed" | "cancelled";

export type LoopPlusReviewVerdict = {
  eventId: string;
  acceptance: LoopPlusReviewAcceptance;
  reason?: string;
  noRepairReason?: string;
};

export type LoopPlusSeenAttempt = {
  subtaskId: string;
  attemptId: string;
  requiresAcceptance?: boolean;
  disposition: LoopPlusAttemptDisposition;
  outcome?: LoopPlusExecutionOutcome;
  acceptance?: LoopPlusReviewAcceptance;
  acceptanceReason?: string;
  noRepairReason?: string;
  dependsOn?: string[];
};

export type LoopPlusDependencyBlock = {
  subtaskId: string;
  attemptId: string;
  dependencyId: string;
  dependencyAttemptId: string | null;
  reason: "execution_pending" | "review_pending" | "report_pending" | "failed" | "closed";
};

export type LoopPlusSchedulerSnapshot = {
  version: typeof LOOP_PLUS_SCHEDULER_VERSION;
  maxConcurrency: number;
  phase: LoopPlusSchedulerPhase;
  parentStopped: boolean;
  completed: boolean;
  seq: number;
  wakeSeq: number;
  wakePending: boolean;
  userMessageQueue: string[];
  running: LoopPlusExecutionRecord[];
  pending: LoopPlusExecutionRecord[];
  /** 无需完整验收但仍等待主任务读取的完成报告。旧快照可省略。 */
  reportQueue?: LoopPlusReviewItem[];
  reviewQueue: LoopPlusReviewItem[];
  currentReview: LoopPlusReviewItem | null;
  seenAttempts: LoopPlusSeenAttempt[];
};

export type LoopPlusConflictBlock = {
  reason: LoopParallelConflictReason;
  value: string;
  otherSubtaskId: string;
  otherAttemptId: string;
};

export type LoopPlusSchedulerView = {
  phase: LoopPlusSchedulerPhase;
  seq: number;
  wake: boolean;
  wakeSeq: number;
  userMessageQueue: string[];
  running: LoopPlusExecutionRecord[];
  pending: LoopPlusExecutionRecord[];
  reportQueue?: LoopPlusReviewItem[];
  reviewQueue: LoopPlusReviewItem[];
  currentReview: LoopPlusReviewItem | null;
  visibleReviewCount: number;
  canComplete: boolean;
  blockers: LoopPlusCompletionBlocker[];
  dependencyBlocks?: LoopPlusDependencyBlock[];
};

/**
 * Host-owned integration contract. The scheduler never calls these methods and
 * never touches VS Code, a CLI, or disk. The host must launch only `started`,
 * wake the single main task on a new finish/report wake edge, and persist
 * snapshots itself. `maxConcurrency` is a required host policy; this kernel
 * does not invent a numeric cap or a launch delay. Write and conflict-group
 * overlap stay in loopParallel. A stopped parent stays stopped until
 * `resumeParent`; the host must not clear `snapshot.parentStopped` by hand.
 * `releaseUnstarted` returns reservations that have not actually started, and
 * `promotePending` is the only extra admission path. Hosts must not rewrite
 * `running`, `pending`, `seenAttempts`, or `parentStopped` on a snapshot.
 */
export type LoopPlusSchedulerHostContract = {
  maxConcurrency: number;
  launchAttempts: (attempts: readonly LoopPlusExecutionRecord[]) => void;
  wakeMainReviewer: (signal: { wakeSeq: number }) => void;
  persistSnapshot: (snapshot: LoopPlusSchedulerSnapshot) => void;
};

export type LoopPlusSchedulerOptions = {
  maxConcurrency?: number;
  snapshot?: unknown;
  requireAcceptedDependencies?: boolean;
};

export function requiresLoopPlusAcceptedDependencies(task: { department?: unknown; departmentInvalid?: boolean }): boolean {
  return task.department !== undefined || task.departmentInvalid === true;
}

export type LoopPlusDispatchRejectionReason =
  | "invalid_spec"
  | "duplicate_attempt"
  | "active_subtask"
  | "parent_stopped"
  | "completed"
  | "invalid_dependencies";

export type LoopPlusDispatchDecision = {
  subtaskId: string;
  attemptId: string;
  admission: "started" | "pending";
  block: LoopPlusConflictBlock | null;
  concurrencyBlocked: boolean;
  dependencyBlocks?: LoopPlusDependencyBlock[];
};

export type LoopPlusDispatchRejection = {
  subtaskId: string;
  attemptId: string;
  reason: LoopPlusDispatchRejectionReason;
  detail?: string;
};

export type LoopPlusDispatchResult = {
  decisions: LoopPlusDispatchDecision[];
  rejected: LoopPlusDispatchRejection[];
  started: LoopPlusExecutionRecord[];
  view: LoopPlusSchedulerView;
};

export type LoopPlusFinishReason =
  | "applied"
  | "duplicate"
  | "stale_attempt"
  | "unknown_attempt"
  | "invalid_spec";

export type LoopPlusFinishInput = {
  subtaskId: string;
  attemptId: string;
  outcome: LoopPlusExecutionOutcome;
  detail?: string | null;
};

export type LoopPlusFinishResult = {
  applied: boolean;
  reason: LoopPlusFinishReason;
  eventId: string | null;
  item: LoopPlusReviewItem | null;
  wake: boolean;
  started: LoopPlusExecutionRecord[];
  view: LoopPlusSchedulerView;
};

export type LoopPlusClaimReason =
  | "claimed"
  | "already_held"
  | "empty"
  | "parent_stopped"
  | "completed";

export type LoopPlusClaimResult = {
  ok: boolean;
  reason: LoopPlusClaimReason;
  item: LoopPlusReviewItem | null;
  view: LoopPlusSchedulerView;
};

export type LoopPlusSubmitReviewReason =
  | "submitted"
  | "mismatch"
  | "no_current"
  | "invalid_event"
  | "parent_stopped";

export type LoopPlusSubmitReviewResult = {
  ok: boolean;
  reason: LoopPlusSubmitReviewReason;
  followUp: LoopPlusReviewFollowUp;
  view: LoopPlusSchedulerView;
};

export type LoopPlusPrepareReviewBatchResult = {
  items: LoopPlusReviewItem[];
  dependencyBlocks: LoopPlusDependencyBlock[];
  view: LoopPlusSchedulerView;
};

export type LoopPlusWaitResult = {
  action: LoopPlusWaitAction;
  view: LoopPlusSchedulerView;
};

export type LoopPlusCompleteResult = {
  ok: boolean;
  alreadyCompleted: boolean;
  blockers: LoopPlusCompletionBlocker[];
  view: LoopPlusSchedulerView;
};

export type LoopPlusStopResult = {
  stopped: boolean;
  alreadyStopped: boolean;
  reason: "stopped" | "already_stopped" | "completed";
  view: LoopPlusSchedulerView;
};

export type LoopPlusRequeueResult = {
  requeued: boolean;
  item: LoopPlusReviewItem | null;
  view: LoopPlusSchedulerView;
};

export type LoopPlusResumeReason =
  | "resumed"
  | "not_stopped"
  | "completed"
  | "running_outstanding";

export type LoopPlusResumeResult = {
  ok: boolean;
  reason: LoopPlusResumeReason;
  started: LoopPlusExecutionRecord[];
  wake: boolean;
  view: LoopPlusSchedulerView;
};

export type LoopPlusReleaseResult = {
  released: LoopPlusExecutionRecord[];
  view: LoopPlusSchedulerView;
};

export type LoopPlusPromoteResult = {
  started: LoopPlusExecutionRecord[];
  view: LoopPlusSchedulerView;
};

export type LoopPlusUserMessageResult = {
  queued: boolean;
  depth: number;
  view: LoopPlusSchedulerView;
};

export type LoopPlusAckUserMessagesResult = {
  acked: string[];
  view: LoopPlusSchedulerView;
};

export type LoopPlusControlAction = "close" | "reprompt";

export type LoopPlusControlCommand = {
  subtaskId: string;
  action: LoopPlusControlAction;
  replacement?: unknown;
};

export type LoopPlusControlReason =
  | "applied"
  | "invalid"
  | "not_open"
  | "conflict"
  | "parent_stopped"
  | "completed"
  | "duplicate_subtask"
  | "duplicate_attempt";

export type LoopPlusControlResult = {
  ok: boolean;
  reason: LoopPlusControlReason;
  closed: LoopPlusExecutionRecord[];
  started: LoopPlusExecutionRecord[];
  block: LoopPlusConflictBlock | null;
  view: LoopPlusSchedulerView;
};

export type LoopPlusScheduler = {
  readonly requireAcceptedDependencies: boolean;
  /** 更新准入容量；不取消已有预留，也不自行启动排队任务。 */
  updateMaxConcurrency: (value: number) => void;
  dispatch: (specs: readonly unknown[], options?: { deferPromotion?: boolean }) => LoopPlusDispatchResult;
  applyControls: (
    commands: readonly LoopPlusControlCommand[],
    options?: { dryRun?: boolean; deferPromotion?: boolean },
  ) => LoopPlusControlResult;
  finish: (input: LoopPlusFinishInput) => LoopPlusFinishResult;
  acknowledgeReports: (eventIds: readonly string[]) => boolean;
  claimNextReview: () => LoopPlusClaimResult;
  submitReview: (eventId: string) => LoopPlusSubmitReviewResult;
  submitReviewBatch: (
    eventIds: readonly string[],
    acceptance?: LoopPlusReviewAcceptance | readonly LoopPlusReviewVerdict[],
  ) => LoopPlusSubmitReviewResult;
  prepareReviewBatch: (maxItems: number) => LoopPlusPrepareReviewBatchResult;
  wait: () => LoopPlusWaitResult;
  complete: () => LoopPlusCompleteResult;
  stopParent: () => LoopPlusStopResult;
  resumeParent: () => LoopPlusResumeResult;
  requeueCurrentReview: () => LoopPlusRequeueResult;
  enqueueUserMessage: (text: string) => LoopPlusUserMessageResult;
  ackUserMessages: (count: number) => LoopPlusAckUserMessagesResult;
  releaseUnstarted: (attemptIds: readonly string[]) => LoopPlusReleaseResult;
  promotePending: () => LoopPlusPromoteResult;
  getCompletionBlockers: () => LoopPlusCompletionBlocker[];
  snapshot: () => LoopPlusSchedulerSnapshot;
  getDependencyBlocks: () => LoopPlusDependencyBlock[];
};

type ParsedSpec = {
  subtaskId: string;
  attemptId: string;
  requiresAcceptance?: boolean;
  title: string | null;
  conflictGroup: string | null;
  writeFiles: string[];
  dependsOn?: string[];
};

const EXECUTION_OUTCOMES: readonly LoopPlusExecutionOutcome[] = ["completed", "failed", "stopped"];

const LOOP_PLUS_FINISH_EVENT_PREFIX = "loop-plus-finish#";

/**
 * Unpublished snapshots used `loop-plus-finish:${subtaskId}:${attemptId}`.
 * Those ids were never released and are ambiguous when either part contains
 * a colon. Current ids use a different prefix plus length prefixes, so an old
 * confirmation cannot address a different tuple. Restore rejects any event id
 * that is not the canonical encoding of its stored subtask and attempt.
 */
export function buildLoopPlusFinishEventId(subtaskId: string, attemptId: string): string {
  return `${LOOP_PLUS_FINISH_EVENT_PREFIX}${encodeLoopPlusIdPart(subtaskId)}${encodeLoopPlusIdPart(attemptId)}`;
}

export function createLoopPlusScheduler(options: LoopPlusSchedulerOptions = {}): LoopPlusScheduler {
  const restored = options.snapshot === undefined ? null : readSnapshot(options.snapshot);
  let maxConcurrency: number;
  if (isPositiveInteger(options.maxConcurrency)) {
    maxConcurrency = options.maxConcurrency;
  } else if (restored) {
    maxConcurrency = restored.maxConcurrency;
  } else {
    throw new Error("Invalid Loop+ maxConcurrency");
  }
  let parentStopped = restored?.parentStopped ?? false;
  let completed = restored?.completed ?? false;
  let seq = restored?.seq ?? 0;
  let wakeSeq = restored?.wakeSeq ?? 0;
  let wakePending = restored?.wakePending ?? false;
  let running = restored?.running.map(copyExecution) ?? [];
  let pending = restored?.pending.map(copyExecution) ?? [];
  let reportQueue = restored?.reportQueue?.map(copyReview) ?? [];
  let reviewQueue = restored?.reviewQueue.map(copyReview) ?? [];
  let currentReview = restored?.currentReview ? copyReview(restored.currentReview) : null;
  let seenAttempts = restored?.seenAttempts.map(copySeen) ?? [];
  let userMessageQueue = restored?.userMessageQueue.slice() ?? [];
  normalizeWake();

  function updateMaxConcurrency(value: number): void {
    if (!isPositiveInteger(value)) {
      throw new Error("Invalid Loop+ maxConcurrency");
    }
    if (maxConcurrency !== value) {
      maxConcurrency = value;
      commit();
    }
  }

  function snapshot(): LoopPlusSchedulerSnapshot {
    return {
      version: LOOP_PLUS_SCHEDULER_VERSION,
      // 快照必须能容纳已有预留；新准入仍使用配置容量，随运行结束逐步收敛。
      maxConcurrency: Math.max(maxConcurrency, running.length),
      phase: phase(),
      parentStopped,
      completed,
      seq,
      wakeSeq,
      wakePending,
      userMessageQueue: userMessageQueue.slice(),
      running: running.map(copyExecution),
      pending: pending.map(copyExecution),
      ...(reportQueue.length > 0 ? { reportQueue: reportQueue.map(copyReview) } : {}),
      reviewQueue: reviewQueue.map(copyReview),
      currentReview: currentReview ? copyReview(currentReview) : null,
      seenAttempts: seenAttempts.map(copySeen),
    };
  }

  function view(): LoopPlusSchedulerView {
    const blockers = completionBlockers();
    const current = currentReview ? copyReview(currentReview) : null;
    const queue = reviewQueue.map(copyReview);
    const dependencyBlocks = collectDependencyBlocks(pending);
    return {
      phase: phase(),
      seq,
      wake: visibleWake(),
      wakeSeq,
      userMessageQueue: userMessageQueue.slice(),
      running: running.map(copyExecution),
      pending: pending.map(copyExecution),
      ...(reportQueue.length > 0 ? { reportQueue: reportQueue.map(copyReview) } : {}),
      reviewQueue: queue,
      currentReview: current,
      visibleReviewCount: queue.length + (current ? 1 : 0),
      canComplete: blockers.length === 0,
      blockers,
      ...(dependencyBlocks.length > 0 ? { dependencyBlocks } : {}),
    };
  }

  function dispatch(specs: readonly unknown[], options?: { deferPromotion?: boolean }): LoopPlusDispatchResult {
    if (!Array.isArray(specs)) {
      throw new Error("Invalid Loop+ dispatch specs");
    }
    const decisions: LoopPlusDispatchDecision[] = [];
    const rejected: LoopPlusDispatchRejection[] = [];
    const accepted: Array<{ parsed: ParsedSpec; record: LoopPlusExecutionRecord }> = [];
    const candidateAttempts = new Set<string>();
    const candidateSubtasks = new Set<string>();
    for (const spec of specs) {
      const ids = rejectionIds(spec);
      const parsed = parseSpec(spec);
      if (!parsed) {
        rejected.push({ ...ids, reason: "invalid_spec" });
        continue;
      }
      const duplicate = seenAttempts.find((item) => item.attemptId === parsed.attemptId);
      if (duplicate || candidateAttempts.has(parsed.attemptId)) {
        rejected.push({ ...ids, reason: "duplicate_attempt" });
        continue;
      }
      const active = seenAttempts.find((item) => (
        item.subtaskId === parsed.subtaskId && !isSettledLoopPlusAttempt(item.disposition)
      ));
      if (active || candidateSubtasks.has(parsed.subtaskId)) {
        rejected.push({ ...ids, reason: "active_subtask" });
        continue;
      }
      if (parentStopped) {
        rejected.push({ ...ids, reason: "parent_stopped" });
        continue;
      }
      if (completed) {
        rejected.push({ ...ids, reason: "completed" });
        continue;
      }
      candidateAttempts.add(parsed.attemptId);
      candidateSubtasks.add(parsed.subtaskId);
      accepted.push({ parsed, record: createExecution(parsed, "pending") });
    }
    if (accepted.length === 0) {
      return { decisions, rejected, started: [], view: view() };
    }
    const latestAttempts = knownLatestAttempts(seenAttempts);
    const graphError = validateDependencyGraph(latestAttempts, accepted.map(({ parsed }) => parsed));
    if (graphError) {
      for (const { parsed } of accepted) {
        rejected.push({ subtaskId: parsed.subtaskId, attemptId: parsed.attemptId, reason: "invalid_dependencies", detail: graphError });
      }
      return { decisions, rejected, started: [], view: view() };
    }
    for (const { parsed, record } of accepted) {
      pending.push(record);
      seenAttempts.push({
        subtaskId: parsed.subtaskId,
        attemptId: parsed.attemptId,
        disposition: "open",
        ...(parsed.requiresAcceptance !== undefined ? { requiresAcceptance: parsed.requiresAcceptance } : {}),
        ...(parsed.dependsOn !== undefined ? { dependsOn: parsed.dependsOn.slice() } : {}),
      });
      latestAttempts.set(parsed.subtaskId, seenAttempts[seenAttempts.length - 1]);
    }
    const started = options?.deferPromotion ? [] : promote(latestAttempts);
    const startedIds = new Set(started.map((item) => item.attemptId));
    for (const { record } of accepted) {
      if (startedIds.has(record.attemptId)) {
        decisions.push({
          subtaskId: record.subtaskId,
          attemptId: record.attemptId,
          admission: "started",
          block: null,
          concurrencyBlocked: false,
        });
        continue;
      }
      const explanation = explainPending(record.attemptId, latestAttempts);
      decisions.push({
        subtaskId: record.subtaskId,
        attemptId: record.attemptId,
        admission: "pending",
        block: explanation.block,
        concurrencyBlocked: explanation.concurrencyBlocked,
        ...(explanation.dependencyBlocks.length > 0 ? { dependencyBlocks: explanation.dependencyBlocks } : {}),
      });
    }
    commit();
    return { decisions, rejected, started, view: view() };
  }

  function finish(input: LoopPlusFinishInput): LoopPlusFinishResult {
    const subtaskId = typeof input?.subtaskId === "string" ? input.subtaskId.trim() : "";
    const attemptId = typeof input?.attemptId === "string" ? input.attemptId.trim() : "";
    const detailValid = input?.detail === undefined || input.detail === null || typeof input.detail === "string";
    if (!subtaskId || !attemptId || !isOutcome(input?.outcome) || !detailValid) {
      return finishResult("invalid_spec", false, null, null, false, []);
    }
    const eventId = buildLoopPlusFinishEventId(subtaskId, attemptId);
    const seen = seenAttempts.find((item) => item.attemptId === attemptId);
    if (!seen || seen.subtaskId !== subtaskId) {
      const subtaskKnown = seenAttempts.some((item) => item.subtaskId === subtaskId);
      return finishResult(subtaskKnown || seen ? "stale_attempt" : "unknown_attempt", false, eventId, null, false, []);
    }
    if (seen.disposition !== "open") {
      const newerOpen = seenAttempts.some((item) => (
        item.subtaskId === subtaskId && item.disposition === "open" && item.attemptId !== attemptId
      ));
      return finishResult(newerOpen ? "stale_attempt" : "duplicate", false, eventId, null, false, []);
    }
    running = running.filter((item) => item.attemptId !== attemptId);
    pending = pending.filter((item) => item.attemptId !== attemptId);
    seen.disposition = "finished";
    seen.outcome = input.outcome;
    const item: LoopPlusReviewItem = {
      eventId,
      subtaskId,
      attemptId,
      outcome: input.outcome,
      detail: typeof input.detail === "string" && input.detail.trim() ? input.detail.trim() : null,
    };
    if (seen.requiresAcceptance === false && input.outcome === "completed") {
      reportQueue.push(item);
      const wake = latchWake();
      const started = promote();
      commit();
      return finishResult("applied", true, eventId, item, wake, started);
    }
    reviewQueue.push(item);
    const openedReview = !currentReview && !parentStopped && !completed;
    if (openedReview) {
      currentReview = reviewQueue.shift() ?? null;
    }
    const wake = openedReview ? latchWake() : false;
    const started = promote();
    commit();
    return finishResult("applied", true, eventId, item, wake, started);
  }

  function acknowledgeReports(eventIds: readonly string[]): boolean {
    if (parentStopped || completed || eventIds.length > reportQueue.length
      || !eventIds.every((id, index) => reportQueue[index].eventId === id)) return false;
    if (eventIds.length === 0) return true;
    const consumed = reportQueue.splice(0, eventIds.length);
    for (const item of consumed) {
      const seen = seenAttempts.find((entry) => entry.attemptId === item.attemptId);
      if (seen) seen.disposition = "reported";
    }
    normalizeWake();
    commit();
    return true;
  }

  function claimNextReview(): LoopPlusClaimResult {
    if (completed) {
      return { ok: false, reason: "completed", item: null, view: view() };
    }
    if (parentStopped) {
      return { ok: false, reason: "parent_stopped", item: null, view: view() };
    }
    if (currentReview) {
      const item = copyReview(currentReview);
      clearWake();
      return { ok: true, reason: "already_held", item, view: view() };
    }
    const next = reviewQueue.shift();
    if (!next) {
      return { ok: false, reason: "empty", item: null, view: view() };
    }
    currentReview = next;
    wakePending = false;
    commit();
    return { ok: true, reason: "claimed", item: copyReview(next), view: view() };
  }

  function submitReview(eventId: string): LoopPlusSubmitReviewResult {
    return submitReviewBatch([eventId]);
  }

  function submitReviewBatch(
    eventIds: readonly string[],
    acceptance?: LoopPlusReviewAcceptance | readonly LoopPlusReviewVerdict[],
  ): LoopPlusSubmitReviewResult {
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return { ok: false, reason: "invalid_event", followUp: followUp(), view: view() };
    }
    const ids: string[] = [];
    const seenIds = new Set<string>();
    for (const eventId of eventIds) {
      if (typeof eventId !== "string" || !eventId.trim()) {
        return { ok: false, reason: "invalid_event", followUp: followUp(), view: view() };
      }
      const normalized = eventId.trim();
      if (seenIds.has(normalized)) {
        return { ok: false, reason: "invalid_event", followUp: followUp(), view: view() };
      }
      seenIds.add(normalized);
      ids.push(normalized);
    }
    const alreadyReviewed = (eventId: string) => seenAttempts.some((item) => (
      item.disposition === "reviewed"
      && buildLoopPlusFinishEventId(item.subtaskId, item.attemptId) === eventId
    ));
    if (ids.every(alreadyReviewed)) {
      return { ok: true, reason: "submitted", followUp: followUp(), view: view() };
    }
    if (parentStopped) {
      return { ok: false, reason: "parent_stopped", followUp: followUp(), view: view() };
    }
    if (!currentReview || currentReview.eventId !== ids[0]) {
      return {
        ok: false,
        reason: currentReview ? "mismatch" : "no_current",
        followUp: followUp(),
        view: view(),
      };
    }
    const queued = ids.slice(1);
    for (let index = 0; index < queued.length; index += 1) {
      if (reviewQueue[index]?.eventId !== queued[index]) {
        return { ok: false, reason: "mismatch", followUp: followUp(), view: view() };
      }
    }
    const verdicts = acceptanceByEvent(ids, acceptance);
    if (verdicts === null) {
      return { ok: false, reason: "invalid_event", followUp: followUp(), view: view() };
    }
    const accepted = [currentReview, ...reviewQueue.slice(0, queued.length)];
    for (const item of accepted) {
      const seen = seenAttempts.find((entry) => entry.attemptId === item.attemptId);
      if (seen) {
        seen.disposition = "reviewed";
        recordReviewedAcceptance(seen, verdicts?.get(item.eventId));
      }
    }
    currentReview = null;
    reviewQueue = reviewQueue.slice(queued.length);
    wakePending = false;
    if (reportQueue.length > 0) latchWake();
    commit();
    return { ok: true, reason: "submitted", followUp: followUp(), view: view() };
  }

  function prepareReviewBatch(maxItems: number): LoopPlusPrepareReviewBatchResult {
    if (!Number.isSafeInteger(maxItems) || maxItems <= 0) {
      throw new RangeError("Invalid Loop+ review batch size");
    }
    const candidates = currentReview ? [currentReview, ...reviewQueue] : reviewQueue.slice();
    const plan = planReviewBatch(candidates, seenAttempts, maxItems);
    const selected = parentStopped || completed ? [] : plan.items;
    if (!parentStopped && !completed) {
      const remainder = candidates.filter((item) => !plan.selectedEvents.has(item.eventId));
      const nextCurrent = selected[0] ?? null;
      const nextQueue = selected.slice(1).concat(remainder);
      const changed = currentReview?.eventId !== nextCurrent?.eventId
        || !sameReviewEventOrder(reviewQueue, nextQueue);
      if (changed) {
        currentReview = nextCurrent ? copyReview(nextCurrent) : null;
        reviewQueue = nextQueue.map(copyReview);
        wakePending = false;
        if (reportQueue.length > 0) latchWake();
        commit();
      }
    }
    return {
      items: selected.map(copyReview),
      dependencyBlocks: plan.dependencyBlocks.map((block) => ({ ...block })),
      view: view(),
    };
  }

  function wait(): LoopPlusWaitResult {
    return { action: waitAction(phase()), view: view() };
  }

  function complete(): LoopPlusCompleteResult {
    if (completed) {
      return { ok: true, alreadyCompleted: true, blockers: [], view: view() };
    }
    const blockers = completionBlockers();
    if (blockers.length > 0) {
      return { ok: false, alreadyCompleted: false, blockers, view: view() };
    }
    completed = true;
    wakePending = false;
    commit();
    return { ok: true, alreadyCompleted: false, blockers: [], view: view() };
  }

  function stopParent(): LoopPlusStopResult {
    if (completed) {
      return { stopped: false, alreadyStopped: false, reason: "completed", view: view() };
    }
    if (parentStopped) {
      return { stopped: true, alreadyStopped: true, reason: "already_stopped", view: view() };
    }
    parentStopped = true;
    wakePending = false;
    commit();
    return { stopped: true, alreadyStopped: false, reason: "stopped", view: view() };
  }

  function resumeParent(): LoopPlusResumeResult {
    if (completed) {
      return { ok: false, reason: "completed", started: [], wake: false, view: view() };
    }
    if (!parentStopped) {
      return { ok: false, reason: "not_stopped", started: [], wake: false, view: view() };
    }
    if (running.length > 0) {
      return { ok: false, reason: "running_outstanding", started: [], wake: false, view: view() };
    }
    parentStopped = false;
    if (currentReview) {
      const held = currentReview;
      currentReview = null;
      if (!reviewQueue.some((queued) => queued.eventId === held.eventId)) {
        reviewQueue.unshift(held);
      }
    }
    const started = promote();
    wakePending = false;
    const wake = latchWake();
    commit();
    return { ok: true, reason: "resumed", started, wake, view: view() };
  }

  function releaseUnstarted(attemptIds: readonly string[]): LoopPlusReleaseResult {
    if (completed || parentStopped) {
      return { released: [], view: view() };
    }
    const wanted = new Set<string>();
    for (const attemptId of attemptIds) {
      if (typeof attemptId !== "string") {
        continue;
      }
      const normalized = attemptId.trim();
      if (normalized) {
        wanted.add(normalized);
      }
    }
    if (wanted.size === 0) {
      return { released: [], view: view() };
    }
    const parked: LoopPlusExecutionRecord[] = [];
    const stillRunning: LoopPlusExecutionRecord[] = [];
    for (const record of running) {
      if (!wanted.has(record.attemptId)) {
        stillRunning.push(record);
        continue;
      }
      const pendingRecord = copyExecution(record);
      pendingRecord.state = "pending";
      parked.push(pendingRecord);
    }
    if (parked.length === 0) {
      return { released: [], view: view() };
    }
    running = stillRunning;
    pending = parked.concat(pending);
    commit();
    return { released: parked.map(copyExecution), view: view() };
  }

  function promotePending(): LoopPlusPromoteResult {
    const started = promote();
    if (started.length > 0) {
      commit();
    }
    return { started, view: view() };
  }

  function enqueueUserMessage(text: string): LoopPlusUserMessageResult {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed || parentStopped || completed) {
      return { queued: false, depth: userMessageQueue.length, view: view() };
    }
    userMessageQueue.push(trimmed);
    commit();
    return { queued: true, depth: userMessageQueue.length, view: view() };
  }

  function ackUserMessages(count: number): LoopPlusAckUserMessagesResult {
    if (!isNonNegativeInteger(count) || count <= 0 || userMessageQueue.length === 0) {
      return { acked: [], view: view() };
    }
    const acked = userMessageQueue.slice(0, count);
    userMessageQueue = userMessageQueue.slice(acked.length);
    if (acked.length > 0) {
      commit();
    }
    return { acked, view: view() };
  }

  function requeueCurrentReview(): LoopPlusRequeueResult {
    if (!currentReview) {
      return { requeued: false, item: null, view: view() };
    }
    const item = currentReview;
    currentReview = null;
    if (!reviewQueue.some((queued) => queued.eventId === item.eventId)) {
      reviewQueue.unshift(item);
    }
    latchWake();
    commit();
    return { requeued: true, item: copyReview(item), view: view() };
  }

  function promote(latestAttempts?: ReadonlyMap<string, LoopPlusSeenAttempt> | null): LoopPlusExecutionRecord[] {
    if (parentStopped || completed) {
      return [];
    }
    const started: LoopPlusExecutionRecord[] = [];
    const active = running.map(copyExecution);
    const nextPending: LoopPlusExecutionRecord[] = [];
    let dependencyIndex = latestAttempts;
    for (const candidate of pending) {
      const dependencies = candidate.dependsOn ?? [];
      if (dependencies.length > 0 && !dependencySatisfied(
        dependencies,
        dependencyIndex ?? (dependencyIndex = knownLatestAttempts(seenAttempts)),
      )) {
        nextPending.push(candidate);
        continue;
      }
      const conflict = findConflict(candidate, active);
      const capacityLeft = running.length + started.length < maxConcurrency;
      if (!conflict && capacityLeft) {
        const runningRecord = copyExecution(candidate);
        runningRecord.state = "running";
        started.push(runningRecord);
        active.push(copyExecution(runningRecord));
        continue;
      }
      nextPending.push(candidate);
      // Pending 保留候选顺序；只有 running 项占用写范围，后续安全项可回填。
    }
    if (started.length === 0) {
      return [];
    }
    running = running.concat(started);
    pending = nextPending;
    return started.map(copyExecution);
  }

  function explainPending(
    attemptId: string,
    latestAttempts?: ReadonlyMap<string, LoopPlusSeenAttempt> | null,
  ): { block: LoopPlusConflictBlock | null; concurrencyBlocked: boolean; dependencyBlocks: LoopPlusDependencyBlock[] } {
    const candidate = pending.find((item) => item.attemptId === attemptId);
    if (!candidate) {
      return { block: null, concurrencyBlocked: false, dependencyBlocks: [] };
    }
    const dependencyBlocks = dependencyBlocksFor(candidate, latestAttempts);
    const runningConflict = findConflict(candidate, running);
    if (runningConflict) {
      return { block: runningConflict, concurrencyBlocked: false, dependencyBlocks };
    }
    return { block: null, concurrencyBlocked: running.length >= maxConcurrency, dependencyBlocks };
  }

  function getDependencyBlocks(): LoopPlusDependencyBlock[] {
    return collectDependencyBlocks(pending);
  }

  function collectDependencyBlocks(candidates: readonly LoopPlusExecutionRecord[]): LoopPlusDependencyBlock[] {
    const latest = dependencyIndexFor(candidates);
    return candidates.flatMap((candidate) => dependencyBlocksFor(candidate, latest));
  }

  function dependencyIndexFor(candidates: readonly LoopPlusExecutionRecord[]): ReadonlyMap<string, LoopPlusSeenAttempt> | null {
    return candidates.some((candidate) => (candidate.dependsOn?.length ?? 0) > 0)
      ? knownLatestAttempts(seenAttempts)
      : null;
  }

  function dependencyBlocksFor(
    candidate: LoopPlusExecutionRecord,
    latest: ReadonlyMap<string, LoopPlusSeenAttempt> | null = null,
  ): LoopPlusDependencyBlock[] {
    const blocks: LoopPlusDependencyBlock[] = [];
    const latestIndex = latest ?? (candidate.dependsOn?.length ? knownLatestAttempts(seenAttempts) : null);
    for (const dependencyId of candidate.dependsOn ?? []) {
      const dependency = latestIndex?.get(dependencyId);
      if (dependency && isDependencySatisfied(dependency)) continue;
      blocks.push({
        subtaskId: candidate.subtaskId,
        attemptId: candidate.attemptId,
        dependencyId,
        dependencyAttemptId: dependency?.attemptId ?? null,
        reason: dependency ? dependencyBlockReason(dependency) : "execution_pending",
      });
    }
    return blocks;
  }

  function dependencySatisfied(
    dependencies: readonly string[],
    latest: ReadonlyMap<string, LoopPlusSeenAttempt>,
  ): boolean {
    return dependencies.every((id) => {
      const attempt = latest.get(id);
      return !!attempt && isDependencySatisfied(attempt);
    });
  }

  function isDependencySatisfied(attempt: LoopPlusSeenAttempt): boolean {
    if (attempt.outcome !== "completed" || attempt.disposition === "closed") return false;
    if (!options.requireAcceptedDependencies) return true;
    return (attempt.disposition === "reviewed" && attempt.acceptance === "passed")
      || (attempt.requiresAcceptance === false && attempt.disposition === "reported");
  }

  function latchWake(): boolean {
    if (parentStopped || completed || wakePending || (!currentReview && reviewQueue.length === 0 && reportQueue.length === 0)) {
      return false;
    }
    wakePending = true;
    wakeSeq += 1;
    return true;
  }

  function clearWake(): void {
    if (!wakePending) {
      return;
    }
    wakePending = false;
    commit();
  }

  function normalizeWake(): void {
    if (parentStopped || completed || (!currentReview && reviewQueue.length === 0 && reportQueue.length === 0)) {
      wakePending = false;
    }
  }

  function visibleWake(): boolean {
    return wakePending
      && !parentStopped
      && !completed
      && (currentReview !== null || reviewQueue.length > 0 || reportQueue.length > 0);
  }

  function phase(): LoopPlusSchedulerPhase {
    if (completed) {
      return "completed";
    }
    if (parentStopped) {
      return "stopped";
    }
    if (currentReview) {
      return "reviewing";
    }
    if (reviewQueue.length > 0) {
      return "review_ready";
    }
    if (reportQueue.length > 0 || running.length > 0 || pending.length > 0) {
      return "waiting";
    }
    return "idle";
  }

  function completionBlockers(): LoopPlusCompletionBlocker[] {
    const blockers: LoopPlusCompletionBlocker[] = [];
    if (completed) {
      blockers.push("completed");
    }
    if (parentStopped) {
      blockers.push("parent_stopped");
    }
    if (running.length > 0) {
      blockers.push("running");
    }
    if (pending.length > 0) {
      blockers.push("pending");
    }
    if (reportQueue.length > 0) {
      blockers.push("report_queue");
    }
    if (reviewQueue.length > 0) {
      blockers.push("review_queue");
    }
    if (currentReview) {
      blockers.push("current_review");
    }
    if (userMessageQueue.length > 0) {
      blockers.push("user_messages");
    }
    return blockers;
  }

  function followUp(): LoopPlusReviewFollowUp {
    if (completed) {
      return "may_complete";
    }
    if (parentStopped) {
      return "stopped";
    }
    if (currentReview || reviewQueue.length > 0) {
      return "claim_next";
    }
    if (running.length > 0 || pending.length > 0) {
      return "wait";
    }
    return "may_complete";
  }

  function commit(): void {
    seq += 1;
  }

  function finishResult(
    reason: LoopPlusFinishReason,
    applied: boolean,
    eventId: string | null,
    item: LoopPlusReviewItem | null,
    wake: boolean,
    started: LoopPlusExecutionRecord[],
  ): LoopPlusFinishResult {
    return {
      applied,
      reason,
      eventId,
      item: item ? copyReview(item) : null,
      wake,
      started,
      view: view(),
    };
  }

  function applyControls(
    commands: readonly LoopPlusControlCommand[],
    options?: { dryRun?: boolean; deferPromotion?: boolean },
  ): LoopPlusControlResult {
    const dryRun = options?.dryRun === true;
    const rejected = (
      reason: LoopPlusControlReason,
      block: LoopPlusConflictBlock | null = null,
    ): LoopPlusControlResult => ({
      ok: false,
      reason,
      closed: [],
      started: [],
      block,
      view: view(),
    });
    if (completed) {
      return rejected("completed");
    }
    if (parentStopped) {
      return rejected("parent_stopped");
    }
    if (!Array.isArray(commands) || commands.length === 0) {
      return rejected("invalid");
    }
    const seenSubtasks = new Set<string>();
    const planned: Array<{
      attemptId: string;
      replacement: ParsedSpec | null;
    }> = [];
    for (const command of commands) {
      const subtaskId = typeof command?.subtaskId === "string" ? command.subtaskId.trim() : "";
      if (!subtaskId || seenSubtasks.has(subtaskId)) {
        return rejected(subtaskId ? "duplicate_subtask" : "invalid");
      }
      if (command.action !== "close" && command.action !== "reprompt") {
        return rejected("invalid");
      }
      seenSubtasks.add(subtaskId);
      const open = seenAttempts.find((item) => item.subtaskId === subtaskId && item.disposition === "open");
      const record = running.concat(pending).find((item) => (
        item.subtaskId === subtaskId && item.attemptId === open?.attemptId
      ));
      if (!open || !record) {
        return rejected("not_open");
      }
      let replacement: ParsedSpec | null = null;
      if (command.action === "reprompt") {
        replacement = parseSpec(command.replacement);
        if (!replacement || replacement.subtaskId !== subtaskId) {
          return rejected("invalid");
        }
        if (isRecord(command.replacement) && command.replacement.dependsOn === undefined) {
          replacement.dependsOn = open.dependsOn?.slice();
        }
        const duplicate = seenAttempts.some((item) => item.attemptId === replacement?.attemptId)
          || planned.some((item) => item.replacement?.attemptId === replacement?.attemptId);
        if (duplicate) {
          return rejected("duplicate_attempt");
        }
      }
      planned.push({ attemptId: open.attemptId, replacement });
    }
    const removed = new Set(planned.map((item) => item.attemptId));
    const survivors = running.concat(pending).filter((item) => !removed.has(item.attemptId));
    const admitted: ParsedSpec[] = [];
    for (const item of planned) {
      if (!item.replacement) {
        continue;
      }
      const candidate = createExecution(item.replacement, "pending");
      const others = survivors.concat(admitted.map((spec) => createExecution(spec, "pending")));
      const block = findConflict(candidate, others);
      if (block) {
        return rejected("conflict", block);
      }
      admitted.push(item.replacement);
    }
    const dependencyError = validateDependencyGraph(knownLatestAttempts(seenAttempts), admitted);
    if (dependencyError) {
      return rejected("invalid");
    }
    if (dryRun) {
      return {
        ok: true,
        reason: "applied",
        closed: [],
        started: [],
        block: null,
        view: view(),
      };
    }
    const closed = running.concat(pending)
      .filter((item) => removed.has(item.attemptId))
      .map(copyExecution);
    running = running.filter((item) => !removed.has(item.attemptId));
    pending = pending.filter((item) => !removed.has(item.attemptId));
    for (const item of planned) {
      const seen = seenAttempts.find((entry) => entry.attemptId === item.attemptId);
      if (seen) {
        seen.disposition = "closed";
        seen.outcome = "stopped";
      }
    }
    for (const spec of admitted) {
      pending.push(createExecution(spec, "pending"));
      seenAttempts.push({
        subtaskId: spec.subtaskId,
        attemptId: spec.attemptId,
        disposition: "open",
        ...(spec.requiresAcceptance !== undefined ? { requiresAcceptance: spec.requiresAcceptance } : {}),
        ...(spec.dependsOn !== undefined ? { dependsOn: spec.dependsOn.slice() } : {}),
      });
    }
    const started = options?.deferPromotion ? [] : promote();
    commit();
    return {
      ok: true,
      reason: "applied",
      closed,
      started,
      block: null,
      view: view(),
    };
  }

  return {
    get requireAcceptedDependencies() { return Boolean(options.requireAcceptedDependencies); },
    updateMaxConcurrency,
    dispatch,
    applyControls,
    finish,
    claimNextReview,
    submitReview,
    submitReviewBatch,
    prepareReviewBatch,
    wait,
    complete,
    stopParent,
    resumeParent,
    requeueCurrentReview,
    enqueueUserMessage,
    ackUserMessages,
    releaseUnstarted,
    promotePending,
    acknowledgeReports,
    getCompletionBlockers: completionBlockers,
    getDependencyBlocks,
    snapshot,
  };
}


function encodeLoopPlusIdPart(value: string): string {
  return `${value.length}:${value}`;
}

function parseLoopPlusFinishEventId(eventId: string): { subtaskId: string; attemptId: string } | null {
  if (!eventId.startsWith(LOOP_PLUS_FINISH_EVENT_PREFIX)) {
    return null;
  }
  const first = readEncodedLoopPlusIdPart(eventId, LOOP_PLUS_FINISH_EVENT_PREFIX.length);
  if (!first) {
    return null;
  }
  const second = readEncodedLoopPlusIdPart(eventId, first.next);
  if (!second || second.next !== eventId.length) {
    return null;
  }
  return { subtaskId: first.value, attemptId: second.value };
}

function readEncodedLoopPlusIdPart(value: string, start: number): { value: string; next: number } | null {
  const separator = value.indexOf(":", start);
  if (separator <= start) {
    return null;
  }
  const lengthText = value.slice(start, separator);
  if (!/^[1-9][0-9]*$/.test(lengthText)) {
    return null;
  }
  const length = Number(lengthText);
  if (!Number.isSafeInteger(length)) {
    return null;
  }
  const valueStart = separator + 1;
  const valueEnd = valueStart + length;
  if (valueEnd > value.length) {
    return null;
  }
  return { value: value.slice(valueStart, valueEnd), next: valueEnd };
}

function parseSpec(value: unknown): ParsedSpec | null {
  if (!isRecord(value)) {
    return null;
  }
  const subtaskId = typeof value.subtaskId === "string" ? value.subtaskId.trim() : "";
  const attemptId = typeof value.attemptId === "string" ? value.attemptId.trim() : "";
  if (!subtaskId || !attemptId) {
    return null;
  }
  if (value.requiresAcceptance !== undefined && typeof value.requiresAcceptance !== "boolean") return null;
  const dependsOn = readLoopPlusDependsOn(value.dependsOn, subtaskId);
  if (dependsOn === null) return null;
  return {
    subtaskId,
    attemptId,
    ...(value.requiresAcceptance !== undefined ? { requiresAcceptance: value.requiresAcceptance } : {}),
    title: cleanText(value.title),
    conflictGroup: cleanText(value.conflictGroup),
    writeFiles: normalizeLoopWriteFiles(value.writeFiles),
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  };
}

function rejectionIds(value: unknown): { subtaskId: string; attemptId: string } {
  if (!isRecord(value)) {
    return { subtaskId: "", attemptId: "" };
  }
  return {
    subtaskId: typeof value.subtaskId === "string" ? value.subtaskId.trim() : "",
    attemptId: typeof value.attemptId === "string" ? value.attemptId.trim() : "",
  };
}

function createExecution(spec: ParsedSpec, state: LoopPlusExecutionState): LoopPlusExecutionRecord {
  return {
    subtaskId: spec.subtaskId,
    attemptId: spec.attemptId,
    ...(spec.requiresAcceptance !== undefined ? { requiresAcceptance: spec.requiresAcceptance } : {}),
    title: spec.title,
    conflictGroup: spec.conflictGroup,
    writeFiles: spec.writeFiles.slice(),
    ...(spec.dependsOn !== undefined ? { dependsOn: spec.dependsOn.slice() } : {}),
    state,
  };
}

function findConflict(
  candidate: LoopPlusExecutionRecord,
  others: readonly LoopPlusExecutionRecord[],
): LoopPlusConflictBlock | null {
  for (const other of others) {
    const plan = buildLoopSubtaskExecutionPlan([toCandidate(other), toCandidate(candidate)]);
    const conflict = plan.conflicts[0];
    if (!conflict) {
      continue;
    }
    return {
      reason: conflict.reason,
      value: conflict.value,
      otherSubtaskId: other.subtaskId,
      otherAttemptId: other.attemptId,
    };
  }
  return null;
}

function toCandidate(record: LoopPlusExecutionRecord): LoopParallelCandidate {
  return {
    id: record.attemptId,
    ...(record.title ? { title: record.title } : {}),
    ...(record.conflictGroup ? { conflictGroup: record.conflictGroup } : {}),
    writeFiles: record.writeFiles,
  };
}

function waitAction(current: LoopPlusSchedulerPhase): LoopPlusWaitAction {
  switch (current) {
    case "reviewing":
    case "review_ready":
      return "review";
    case "waiting":
      return "wait";
    case "idle":
      return "idle";
    case "stopped":
      return "stopped";
    case "completed":
      return "completed";
    default: {
      const unexpected: never = current;
      throw new Error(`Unexpected Loop+ phase: ${unexpected}`);
    }
  }
}

function readSnapshot(value: unknown): LoopPlusSchedulerSnapshot {
  if (!isRecord(value)) {
    invalidSnapshot("snapshot");
  }
  if (value.version !== LOOP_PLUS_SCHEDULER_VERSION) {
    invalidSnapshot("version");
  }
  if (!isPositiveInteger(value.maxConcurrency)) {
    invalidSnapshot("maxConcurrency");
  }
  if (typeof value.parentStopped !== "boolean" || typeof value.completed !== "boolean") {
    invalidSnapshot("flags");
  }
  if (typeof value.wakePending !== "boolean") {
    invalidSnapshot("wakePending");
  }
  if (!isNonNegativeInteger(value.seq) || !isNonNegativeInteger(value.wakeSeq)) {
    invalidSnapshot("seq");
  }
  const running = readExecutions(value.running, "running");
  const pending = readExecutions(value.pending, "pending");
  const reportQueue = value.reportQueue === undefined ? [] : readReviews(value.reportQueue, "reportQueue");
  const reviewQueue = readReviews(value.reviewQueue, "reviewQueue");
  const currentReview = value.currentReview === null ? null : readReview(value.currentReview, "currentReview");
  const seenAttempts = readSeenAttempts(value.seenAttempts);
  validateAttemptGraph({
    maxConcurrency: value.maxConcurrency,
    running,
    pending,
    reportQueue,
    reviewQueue,
    currentReview,
    seenAttempts,
    parentStopped: value.parentStopped,
    completed: value.completed,
  });
  return {
    version: LOOP_PLUS_SCHEDULER_VERSION,
    maxConcurrency: value.maxConcurrency,
    phase: "idle",
    parentStopped: value.parentStopped,
    completed: value.completed,
    seq: value.seq,
    wakeSeq: value.wakeSeq,
    wakePending: value.wakePending,
    userMessageQueue: readUserMessages(value.userMessageQueue),
    running,
    pending,
    ...(reportQueue.length > 0 ? { reportQueue } : {}),
    reviewQueue,
    currentReview,
    seenAttempts,
  };
}

function readUserMessages(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    invalidSnapshot("userMessageQueue");
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim() || item.trim() !== item) {
      invalidSnapshot(`userMessageQueue[${index}]`);
    }
    return item;
  });
}

function readExecutions(value: unknown, field: string): LoopPlusExecutionRecord[] {
  if (!Array.isArray(value)) {
    invalidSnapshot(field);
  }
  return value.map((item, index) => readExecution(item, `${field}[${index}]`, field === "running" ? "running" : "pending"));
}

function readExecution(value: unknown, field: string, state: LoopPlusExecutionState): LoopPlusExecutionRecord {
  if (!isRecord(value) || value.state !== state) {
    invalidSnapshot(field);
  }
  const subtaskId = readRequiredId(value.subtaskId, field);
  const dependsOn = readSnapshotDependsOn(value.dependsOn, subtaskId, field);
  return {
    subtaskId,
    attemptId: readRequiredId(value.attemptId, field),
    ...readOptionalBoolean(value.requiresAcceptance, `${field}.requiresAcceptance`),
    title: readNullableString(value.title, field),
    conflictGroup: readNullableString(value.conflictGroup, field),
    writeFiles: readWriteFiles(value.writeFiles, field),
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    state,
  };
}

function readReviews(value: unknown, field: string): LoopPlusReviewItem[] {
  if (!Array.isArray(value)) {
    invalidSnapshot(field);
  }
  return value.map((item, index) => readReview(item, `${field}[${index}]`));
}

function readReview(value: unknown, field: string): LoopPlusReviewItem {
  if (!isRecord(value) || !isOutcome(value.outcome)) {
    invalidSnapshot(field);
  }
  const subtaskId = readRequiredId(value.subtaskId, field);
  const attemptId = readRequiredId(value.attemptId, field);
  const eventId = readRequiredId(value.eventId, field);
  const parsedEventId = parseLoopPlusFinishEventId(eventId);
  if (
    eventId !== buildLoopPlusFinishEventId(subtaskId, attemptId)
    || !parsedEventId
    || parsedEventId.subtaskId !== subtaskId
    || parsedEventId.attemptId !== attemptId
  ) {
    invalidSnapshot(field);
  }
  return {
    eventId,
    subtaskId,
    attemptId,
    outcome: value.outcome,
    detail: readNullableString(value.detail, field),
  };
}

function readSeenAttempts(value: unknown): LoopPlusSeenAttempt[] {
  if (!Array.isArray(value)) {
    invalidSnapshot("seenAttempts");
  }
  return value.map((item, index) => {
    if (!isRecord(item) || !isDisposition(item.disposition)) {
      invalidSnapshot(`seenAttempts[${index}]`);
    }
    const outcome = readSeenOutcome(item.outcome, `seenAttempts[${index}]`);
    const acceptance = readSeenAcceptance(item.acceptance, `seenAttempts[${index}]`);
    if (item.disposition === "open" && outcome) {
      invalidSnapshot(`seenAttempts[${index}]`);
    }
    if (item.disposition !== "reviewed" && acceptance) {
      invalidSnapshot(`seenAttempts[${index}]`);
    }
    const acceptanceReason = typeof item.acceptanceReason === "string" ? item.acceptanceReason.trim() : undefined;
    if (acceptance === "cancelled" && (!acceptanceReason || Array.from(acceptanceReason).length > 50)) {
      invalidSnapshot(`seenAttempts[${index}].acceptanceReason`);
    }
    const noRepairReason = typeof item.noRepairReason === "string" ? item.noRepairReason.trim() : undefined;
    if (item.noRepairReason !== undefined && (acceptance !== "failed" || !noRepairReason || Array.from(noRepairReason).length > 50)) {
      invalidSnapshot(`seenAttempts[${index}].noRepairReason`);
    }
    const subtaskId = readRequiredId(item.subtaskId, `seenAttempts[${index}]`);
    const dependsOn = readSnapshotDependsOn(item.dependsOn, subtaskId, `seenAttempts[${index}]`);
    return {
      subtaskId,
      attemptId: readRequiredId(item.attemptId, `seenAttempts[${index}]`),
      disposition: item.disposition,
      ...readOptionalBoolean(item.requiresAcceptance, `seenAttempts[${index}].requiresAcceptance`),
      ...(outcome ? { outcome } : {}),
      ...(acceptance ? { acceptance } : {}),
      ...(acceptanceReason ? { acceptanceReason } : {}),
      ...(noRepairReason ? { noRepairReason } : {}),
      ...(dependsOn !== undefined ? { dependsOn } : {}),
    };
  });
}

function validateAttemptGraph(input: {
  maxConcurrency: number;
  running: LoopPlusExecutionRecord[];
  pending: LoopPlusExecutionRecord[];
  reviewQueue: LoopPlusReviewItem[];
  reportQueue?: LoopPlusReviewItem[];
  currentReview: LoopPlusReviewItem | null;
  seenAttempts: LoopPlusSeenAttempt[];
  parentStopped: boolean;
  completed: boolean;
}): void {
  if (input.running.length > input.maxConcurrency) {
    invalidSnapshot("maxConcurrency");
  }
  const acceptedRunning: LoopPlusExecutionRecord[] = [];
  for (const record of input.running) {
    if (findConflict(record, acceptedRunning)) {
      invalidSnapshot("running");
    }
    acceptedRunning.push(record);
  }
  const placed = new Map<string, { subtaskId: string; kind: LoopPlusAttemptDisposition }>();
  for (const record of input.running) {
    placeAttempt(placed, record.attemptId, record.subtaskId, "open");
  }
  for (const record of input.pending) {
    placeAttempt(placed, record.attemptId, record.subtaskId, "open");
  }
  for (const item of input.reportQueue ?? []) {
    placeAttempt(placed, item.attemptId, item.subtaskId, "finished");
    const seen = input.seenAttempts.find((entry) => entry.attemptId === item.attemptId);
    if (item.outcome !== "completed" || seen?.requiresAcceptance !== false || seen.outcome !== item.outcome) {
      invalidSnapshot("reportQueue");
    }
  }
  for (const item of input.reviewQueue) {
    if (item.outcome === "completed"
      && input.seenAttempts.some((seen) => seen.attemptId === item.attemptId && seen.requiresAcceptance === false)) {
      invalidSnapshot("reviewQueue");
    }
    placeAttempt(placed, item.attemptId, item.subtaskId, "finished");
  }
  if (input.currentReview) {
    if (input.currentReview.outcome === "completed"
      && input.seenAttempts.some((seen) => seen.attemptId === input.currentReview?.attemptId && seen.requiresAcceptance === false)) {
      invalidSnapshot("currentReview");
    }
    placeAttempt(placed, input.currentReview.attemptId, input.currentReview.subtaskId, "finished");
  }
  const unreviewedSubtasks = new Set<string>();
  for (const actual of placed.values()) {
    if (unreviewedSubtasks.has(actual.subtaskId)) {
      invalidSnapshot("active_subtask");
    }
    unreviewedSubtasks.add(actual.subtaskId);
  }
  const seenIds = new Set<string>();
  for (const seen of input.seenAttempts) {
    if (seenIds.has(seen.attemptId)) {
      invalidSnapshot("seenAttempts");
    }
    seenIds.add(seen.attemptId);
    const actual = placed.get(seen.attemptId);
    if (isSettledLoopPlusAttempt(seen.disposition)) {
      if (actual) {
        invalidSnapshot("seenAttempts");
      }
      if (seen.disposition === "reported" && (seen.requiresAcceptance !== false || seen.outcome !== "completed")) {
        invalidSnapshot("seenAttempts");
      }
      continue;
    }
    if (!actual || actual.kind !== seen.disposition || actual.subtaskId !== seen.subtaskId) {
      invalidSnapshot("seenAttempts");
    }
    const execution = input.running.concat(input.pending).find((item) => item.attemptId === seen.attemptId);
    if (execution) {
      if ((execution.requiresAcceptance !== false) !== (seen.requiresAcceptance !== false)) {
        invalidSnapshot("requiresAcceptance");
      }
      if (!sameStringArray(execution.dependsOn ?? [], seen.dependsOn ?? [])) {
        invalidSnapshot("dependsOn");
      }
    }
  }
  for (const attemptId of placed.keys()) {
    if (!seenIds.has(attemptId)) {
      invalidSnapshot("seenAttempts");
    }
  }
  if (validateDependencyGraph(knownLatestAttempts(input.seenAttempts), [])) {
    invalidSnapshot("dependsOn");
  }
  const workLeft = input.running.length > 0
    || input.pending.length > 0
    || (input.reportQueue?.length ?? 0) > 0
    || input.reviewQueue.length > 0
    || input.currentReview !== null;
  if (input.completed && (workLeft || input.parentStopped)) {
    invalidSnapshot("completed");
  }
}

function placeAttempt(
  placed: Map<string, { subtaskId: string; kind: LoopPlusAttemptDisposition }>,
  attemptId: string,
  subtaskId: string,
  kind: LoopPlusAttemptDisposition,
): void {
  if (placed.has(attemptId)) {
    invalidSnapshot("attemptId");
  }
  placed.set(attemptId, { subtaskId, kind });
}

function readWriteFiles(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalidSnapshot(field);
  }
  return normalizeLoopWriteFiles(value);
}

function readSnapshotDependsOn(value: unknown, subtaskId: string, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  const parsed = readLoopPlusDependsOn(value, subtaskId);
  if (parsed === null) invalidSnapshot(`${field}.dependsOn`);
  return parsed.length > 0 ? parsed : undefined;
}

function knownLatestAttempts(attempts: readonly LoopPlusSeenAttempt[]): Map<string, LoopPlusSeenAttempt> {
  const latest = new Map<string, LoopPlusSeenAttempt>();
  for (const attempt of attempts) latest.set(attempt.subtaskId, attempt);
  return latest;
}

function planReviewBatch(
  candidates: readonly LoopPlusReviewItem[],
  seenAttempts: readonly LoopPlusSeenAttempt[],
  maxItems: number,
): { items: LoopPlusReviewItem[]; selectedEvents: Set<string>; dependencyBlocks: LoopPlusDependencyBlock[] } {
  const latest = knownLatestAttempts(seenAttempts);
  const seenByAttempt = new Map<string, LoopPlusSeenAttempt>();
  for (const attempt of seenAttempts) seenByAttempt.set(attempt.attemptId, attempt);
  const candidateIndex = new Map<string, number>();
  for (let index = 0; index < candidates.length; index += 1) {
    candidateIndex.set(candidates[index].attemptId, index);
  }

  const outgoing = candidates.map(() => [] as number[]);
  const incoming = candidates.map(() => [] as number[]);
  const indegree = candidates.map(() => 0);
  const directBlocks: LoopPlusDependencyBlock[][] = candidates.map(() => []);
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index];
    const eventAttempt = seenByAttempt.get(item.attemptId);
    for (const dependencyId of eventAttempt?.dependsOn ?? []) {
      const dependency = latest.get(dependencyId);
      if (dependency && isReviewDependencyProcessed(dependency)) continue;
      if (dependency?.disposition === "finished") {
        const prerequisiteIndex = candidateIndex.get(dependency.attemptId);
        if (prerequisiteIndex !== undefined) {
          outgoing[prerequisiteIndex].push(index);
          incoming[index].push(prerequisiteIndex);
          indegree[index] += 1;
          continue;
        }
      }
      directBlocks[index].push({
        subtaskId: item.subtaskId,
        attemptId: item.attemptId,
        dependencyId,
        dependencyAttemptId: dependency?.attemptId ?? null,
        reason: dependency ? dependencyReviewBlockReason(dependency) : "execution_pending",
      });
    }
  }

  const ready = new StableIndexHeap();
  for (let index = 0; index < candidates.length; index += 1) {
    if (indegree[index] === 0 && directBlocks[index].length === 0) ready.push(index);
  }
  const selectedIndexes: number[] = [];
  const selectedEvents = new Set<string>();
  while (ready.size > 0 && selectedIndexes.length < maxItems) {
    const index = ready.pop();
    selectedIndexes.push(index);
    selectedEvents.add(candidates[index].eventId);
    for (const dependent of outgoing[index]) {
      indegree[dependent] -= 1;
      if (indegree[dependent] === 0 && directBlocks[dependent].length === 0) ready.push(dependent);
    }
  }

  const dependencyBlocks: LoopPlusDependencyBlock[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (selectedEvents.has(candidates[index].eventId)) continue;
    dependencyBlocks.push(...directBlocks[index]);
    for (const dependencyIndex of incoming[index]) {
      if (selectedEvents.has(candidates[dependencyIndex].eventId)) continue;
      const prerequisite = candidates[dependencyIndex];
      dependencyBlocks.push({
        subtaskId: candidates[index].subtaskId,
        attemptId: candidates[index].attemptId,
        dependencyId: prerequisite.subtaskId,
        dependencyAttemptId: prerequisite.attemptId,
        reason: dependencyReviewBlockReason(latest.get(prerequisite.subtaskId)!),
      });
    }
  }
  return {
    items: selectedIndexes.map((index) => candidates[index]),
    selectedEvents,
    dependencyBlocks,
  };
}

function isReviewDependencyProcessed(attempt: LoopPlusSeenAttempt): boolean {
  return attempt.disposition === "reviewed" || attempt.disposition === "reported" || attempt.disposition === "closed";
}

function dependencyReviewBlockReason(attempt: LoopPlusSeenAttempt): LoopPlusDependencyBlock["reason"] {
  if (attempt.disposition === "closed" || attempt.acceptance === "cancelled") return "closed";
  if (attempt.disposition === "open") return "execution_pending";
  if (attempt.requiresAcceptance === false && attempt.outcome === "completed") return "report_pending";
  if (attempt.outcome === "failed" || attempt.outcome === "stopped") return "failed";
  return "review_pending";
}

function sameReviewEventOrder(left: readonly LoopPlusReviewItem[], right: readonly LoopPlusReviewItem[]): boolean {
  return left.length === right.length && left.every((item, index) => item.eventId === right[index].eventId);
}

class StableIndexHeap {
  private readonly values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  push(value: number): void {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent] <= value) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): number {
    const first = this.values[0];
    const last = this.values.pop() as number;
    if (this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      const child = right < this.values.length && this.values[right] < this.values[left] ? right : left;
      if (this.values[child] >= last) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function dependencyBlockReason(attempt: LoopPlusSeenAttempt): LoopPlusDependencyBlock["reason"] {
  if (attempt.disposition === "closed" || attempt.acceptance === "cancelled") return "closed";
  if (attempt.outcome === "failed" || attempt.outcome === "stopped"
    || (attempt.disposition === "reviewed" && attempt.acceptance === "failed")) return "failed";
  if (attempt.disposition === "open") return "execution_pending";
  if (attempt.requiresAcceptance === false) return "report_pending";
  return "review_pending";
}

function validateDependencyGraph(
  historical: Map<string, LoopPlusSeenAttempt>,
  candidates: readonly ParsedSpec[],
): string | null {
  const graph = new Map<string, readonly string[]>();
  for (const [id, attempt] of historical) {
    graph.set(id, attempt.dependsOn ?? []);
  }
  for (const candidate of candidates) graph.set(candidate.subtaskId, candidate.dependsOn ?? []);
  for (const [id, dependencies] of graph) {
    for (const dependency of dependencies) {
      if (!graph.has(dependency)) return `Unknown dependency "${dependency}" referenced by "${id}".`;
    }
  }
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of graph.keys()) indegree.set(id, 0);
  for (const [id, dependencies] of graph) {
    indegree.set(id, dependencies.length);
    for (const dependency of dependencies) {
      const list = dependents.get(dependency) ?? [];
      list.push(id);
      dependents.set(dependency, list);
    }
  }
  const ready: string[] = [];
  for (const [id, count] of indegree) if (count === 0) ready.push(id);
  let visited = 0;
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const id = ready[cursor];
    visited += 1;
    for (const dependent of dependents.get(id) ?? []) {
      const count = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, count);
      if (count === 0) ready.push(dependent);
    }
  }
  return visited === graph.size ? null : "Dependency graph contains a cycle.";
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readRequiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalidSnapshot(field);
  }
  return value.trim();
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    invalidSnapshot(field);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function copyExecution(record: LoopPlusExecutionRecord): LoopPlusExecutionRecord {
  return {
    subtaskId: record.subtaskId,
    attemptId: record.attemptId,
    ...(record.requiresAcceptance !== undefined ? { requiresAcceptance: record.requiresAcceptance } : {}),
    title: record.title,
    conflictGroup: record.conflictGroup,
    writeFiles: record.writeFiles.slice(),
    ...(record.dependsOn !== undefined ? { dependsOn: record.dependsOn.slice() } : {}),
    state: record.state,
  };
}

function copyReview(record: LoopPlusReviewItem): LoopPlusReviewItem {
  return {
    eventId: record.eventId,
    subtaskId: record.subtaskId,
    attemptId: record.attemptId,
    outcome: record.outcome,
    detail: record.detail,
  };
}

function copySeen(record: LoopPlusSeenAttempt): LoopPlusSeenAttempt {
  return {
    subtaskId: record.subtaskId,
    attemptId: record.attemptId,
    disposition: record.disposition,
    ...(record.requiresAcceptance !== undefined ? { requiresAcceptance: record.requiresAcceptance } : {}),
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.acceptance ? { acceptance: record.acceptance } : {}),
    ...(record.acceptanceReason ? { acceptanceReason: record.acceptanceReason } : {}),
    ...(record.noRepairReason ? { noRepairReason: record.noRepairReason } : {}),
    ...(record.dependsOn !== undefined ? { dependsOn: record.dependsOn.slice() } : {}),
  };
}

function acceptanceByEvent(
  eventIds: readonly string[],
  acceptance: LoopPlusReviewAcceptance | readonly LoopPlusReviewVerdict[] | undefined,
): Map<string, LoopPlusReviewVerdict> | undefined | null {
  if (acceptance === undefined) {
    return undefined;
  }
  if (acceptance === "passed" || acceptance === "failed") {
    return new Map(eventIds.map((eventId) => [eventId, { eventId, acceptance }]));
  }
  if (!Array.isArray(acceptance) || acceptance.length !== eventIds.length) {
    return null;
  }
  const verdicts = new Map<string, LoopPlusReviewVerdict>();
  for (let index = 0; index < eventIds.length; index += 1) {
    const verdict = acceptance[index];
    const eventId = eventIds[index];
    if (!verdict || verdict.eventId !== eventId) {
      return null;
    }
    if (verdict.acceptance !== "passed" && verdict.acceptance !== "failed" && verdict.acceptance !== "cancelled") {
      return null;
    }
    if (verdict.acceptance === "cancelled" && (typeof verdict.reason !== "string"
      || !verdict.reason.trim() || Array.from(verdict.reason.trim()).length > 50)) return null;
    if (verdict.noRepairReason !== undefined && (verdict.acceptance !== "failed" || typeof verdict.noRepairReason !== "string"
      || !verdict.noRepairReason.trim() || Array.from(verdict.noRepairReason.trim()).length > 50)) return null;
    verdicts.set(eventId, verdict);
  }
  return verdicts;
}

function recordReviewedAcceptance(
  seen: LoopPlusSeenAttempt,
  verdict: LoopPlusReviewVerdict | undefined,
): void {
  if (!verdict) return;
  const { acceptance } = verdict;
  if (acceptance === "cancelled") {
    seen.acceptance = acceptance;
    seen.acceptanceReason = verdict.reason!.trim();
    return;
  }
  if (acceptance !== "passed" && acceptance !== "failed") {
    return;
  }
  const outcomeFailed = seen.outcome === "failed" || seen.outcome === "stopped";
  seen.acceptance = acceptance === "failed" || outcomeFailed ? "failed" : "passed";
  if (verdict.noRepairReason) seen.noRepairReason = verdict.noRepairReason.trim();
}

function readSeenAcceptance(value: unknown, field: string): LoopPlusReviewAcceptance | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "passed" && value !== "failed" && value !== "cancelled") {
    invalidSnapshot(field);
  }
  return value;
}

function readSeenOutcome(value: unknown, field: string): LoopPlusExecutionOutcome | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isOutcome(value)) {
    invalidSnapshot(field);
  }
  return value;
}

function isOutcome(value: unknown): value is LoopPlusExecutionOutcome {
  return typeof value === "string" && EXECUTION_OUTCOMES.some((outcome) => outcome === value);
}

function isDisposition(value: unknown): value is LoopPlusAttemptDisposition {
  return value === "open" || value === "finished" || value === "reviewed" || value === "reported" || value === "closed";
}

function isSettledLoopPlusAttempt(disposition: LoopPlusAttemptDisposition): boolean {
  return disposition === "reviewed" || disposition === "reported" || disposition === "closed";
}

function readOptionalBoolean(value: unknown, field: string): { requiresAcceptance?: boolean } {
  if (value === undefined) return {};
  if (typeof value !== "boolean") invalidSnapshot(field);
  return { requiresAcceptance: value };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidSnapshot(reason: string): never {
  throw new Error(`Invalid Loop+ scheduler snapshot: ${reason}`);
}
