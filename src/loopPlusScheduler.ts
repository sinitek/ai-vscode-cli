import {
  buildLoopSubtaskExecutionPlan,
  normalizeLoopWriteFiles,
  type LoopParallelCandidate,
  type LoopParallelConflictReason,
} from "./loopParallel";

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
export type LoopPlusAttemptDisposition = "open" | "finished" | "reviewed";
export type LoopPlusCompletionBlocker =
  | "running"
  | "pending"
  | "review_queue"
  | "current_review"
  | "parent_stopped"
  | "completed";
export type LoopPlusReviewFollowUp = "claim_next" | "wait" | "may_complete" | "stopped";
export type LoopPlusWaitAction = "review" | "wait" | "idle" | "stopped" | "completed";

export type LoopPlusSubtaskSpec = {
  subtaskId: string;
  attemptId: string;
  title?: string;
  conflictGroup?: string;
  writeFiles?: string[];
};

export type LoopPlusExecutionRecord = {
  subtaskId: string;
  attemptId: string;
  title: string | null;
  conflictGroup: string | null;
  writeFiles: string[];
  state: LoopPlusExecutionState;
};

export type LoopPlusReviewItem = {
  eventId: string;
  subtaskId: string;
  attemptId: string;
  outcome: LoopPlusExecutionOutcome;
  detail: string | null;
};

export type LoopPlusSeenAttempt = {
  subtaskId: string;
  attemptId: string;
  disposition: LoopPlusAttemptDisposition;
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
  running: LoopPlusExecutionRecord[];
  pending: LoopPlusExecutionRecord[];
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
  running: LoopPlusExecutionRecord[];
  pending: LoopPlusExecutionRecord[];
  reviewQueue: LoopPlusReviewItem[];
  currentReview: LoopPlusReviewItem | null;
  visibleReviewCount: number;
  canComplete: boolean;
  blockers: LoopPlusCompletionBlocker[];
};

/**
 * Host-owned integration contract. The scheduler never calls these methods and
 * never touches VS Code, a CLI, or disk. The host must launch only `started`,
 * wake the single main reviewer only on a new finish wake edge, and persist
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
};

export type LoopPlusDispatchRejectionReason =
  | "invalid_spec"
  | "duplicate_attempt"
  | "active_subtask"
  | "parent_stopped"
  | "completed";

export type LoopPlusDispatchDecision = {
  subtaskId: string;
  attemptId: string;
  admission: "started" | "pending";
  block: LoopPlusConflictBlock | null;
  concurrencyBlocked: boolean;
};

export type LoopPlusDispatchRejection = {
  subtaskId: string;
  attemptId: string;
  reason: LoopPlusDispatchRejectionReason;
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

export type LoopPlusScheduler = {
  dispatch: (specs: readonly unknown[]) => LoopPlusDispatchResult;
  finish: (input: LoopPlusFinishInput) => LoopPlusFinishResult;
  claimNextReview: () => LoopPlusClaimResult;
  submitReview: (eventId: string) => LoopPlusSubmitReviewResult;
  wait: () => LoopPlusWaitResult;
  complete: () => LoopPlusCompleteResult;
  stopParent: () => LoopPlusStopResult;
  resumeParent: () => LoopPlusResumeResult;
  requeueCurrentReview: () => LoopPlusRequeueResult;
  releaseUnstarted: (attemptIds: readonly string[]) => LoopPlusReleaseResult;
  promotePending: () => LoopPlusPromoteResult;
  getCompletionBlockers: () => LoopPlusCompletionBlocker[];
  snapshot: () => LoopPlusSchedulerSnapshot;
};

type ParsedSpec = {
  subtaskId: string;
  attemptId: string;
  title: string | null;
  conflictGroup: string | null;
  writeFiles: string[];
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
  if (restored) {
    maxConcurrency = restored.maxConcurrency;
  } else if (isPositiveInteger(options.maxConcurrency)) {
    maxConcurrency = options.maxConcurrency;
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
  let reviewQueue = restored?.reviewQueue.map(copyReview) ?? [];
  let currentReview = restored?.currentReview ? copyReview(restored.currentReview) : null;
  let seenAttempts = restored?.seenAttempts.map(copySeen) ?? [];
  normalizeWake();

  function snapshot(): LoopPlusSchedulerSnapshot {
    return {
      version: LOOP_PLUS_SCHEDULER_VERSION,
      maxConcurrency,
      phase: phase(),
      parentStopped,
      completed,
      seq,
      wakeSeq,
      wakePending,
      running: running.map(copyExecution),
      pending: pending.map(copyExecution),
      reviewQueue: reviewQueue.map(copyReview),
      currentReview: currentReview ? copyReview(currentReview) : null,
      seenAttempts: seenAttempts.map(copySeen),
    };
  }

  function view(): LoopPlusSchedulerView {
    const blockers = completionBlockers();
    const current = currentReview ? copyReview(currentReview) : null;
    const queue = reviewQueue.map(copyReview);
    return {
      phase: phase(),
      seq,
      wake: visibleWake(),
      wakeSeq,
      running: running.map(copyExecution),
      pending: pending.map(copyExecution),
      reviewQueue: queue,
      currentReview: current,
      visibleReviewCount: queue.length + (current ? 1 : 0),
      canComplete: blockers.length === 0,
      blockers,
    };
  }

  function dispatch(specs: readonly unknown[]): LoopPlusDispatchResult {
    if (!Array.isArray(specs)) {
      throw new Error("Invalid Loop+ dispatch specs");
    }
    const decisions: LoopPlusDispatchDecision[] = [];
    const rejected: LoopPlusDispatchRejection[] = [];
    const accepted: LoopPlusExecutionRecord[] = [];
    for (const spec of specs) {
      const ids = rejectionIds(spec);
      const parsed = parseSpec(spec);
      if (!parsed) {
        rejected.push({ ...ids, reason: "invalid_spec" });
        continue;
      }
      const duplicate = seenAttempts.find((item) => item.attemptId === parsed.attemptId);
      if (duplicate) {
        rejected.push({ ...ids, reason: "duplicate_attempt" });
        continue;
      }
      const active = seenAttempts.find((item) => (
        item.subtaskId === parsed.subtaskId && item.disposition !== "reviewed"
      ));
      if (active) {
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
      const record = createExecution(parsed, "pending");
      pending.push(record);
      seenAttempts.push({
        subtaskId: parsed.subtaskId,
        attemptId: parsed.attemptId,
        disposition: "open",
      });
      accepted.push(record);
    }
    if (accepted.length === 0) {
      return { decisions, rejected, started: [], view: view() };
    }
    const started = promote();
    const startedIds = new Set(started.map((item) => item.attemptId));
    for (const record of accepted) {
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
      const explanation = explainPending(record.attemptId);
      decisions.push({
        subtaskId: record.subtaskId,
        attemptId: record.attemptId,
        admission: "pending",
        block: explanation.block,
        concurrencyBlocked: explanation.concurrencyBlocked,
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
    const item: LoopPlusReviewItem = {
      eventId,
      subtaskId,
      attemptId,
      outcome: input.outcome,
      detail: typeof input.detail === "string" && input.detail.trim() ? input.detail.trim() : null,
    };
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
    if (typeof eventId !== "string" || !eventId.trim()) {
      return { ok: false, reason: "invalid_event", followUp: followUp(), view: view() };
    }
    const normalizedEventId = eventId.trim();
    const reviewed = seenAttempts.find((item) => (
      item.disposition === "reviewed"
      && buildLoopPlusFinishEventId(item.subtaskId, item.attemptId) === normalizedEventId
    ));
    if (reviewed) {
      return { ok: true, reason: "submitted", followUp: followUp(), view: view() };
    }
    if (parentStopped) {
      return { ok: false, reason: "parent_stopped", followUp: followUp(), view: view() };
    }
    if (currentReview?.eventId === normalizedEventId) {
      const seen = seenAttempts.find((item) => item.attemptId === currentReview?.attemptId);
      if (seen) {
        seen.disposition = "reviewed";
      }
      currentReview = null;
      wakePending = false;
      commit();
      return { ok: true, reason: "submitted", followUp: followUp(), view: view() };
    }
    if (!currentReview) {
      return { ok: false, reason: "no_current", followUp: followUp(), view: view() };
    }
    return { ok: false, reason: "mismatch", followUp: followUp(), view: view() };
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

  function promote(): LoopPlusExecutionRecord[] {
    if (parentStopped || completed) {
      return [];
    }
    const started: LoopPlusExecutionRecord[] = [];
    const reserved = running.map(copyExecution);
    const nextPending: LoopPlusExecutionRecord[] = [];
    for (const candidate of pending) {
      const conflict = findConflict(candidate, reserved);
      const capacityLeft = running.length + started.length < maxConcurrency;
      if (!conflict && capacityLeft) {
        const runningRecord = copyExecution(candidate);
        runningRecord.state = "running";
        started.push(runningRecord);
        reserved.push(copyExecution(runningRecord));
        continue;
      }
      nextPending.push(candidate);
      reserved.push(copyExecution(candidate));
    }
    if (started.length === 0) {
      return [];
    }
    running = running.concat(started);
    pending = nextPending;
    return started.map(copyExecution);
  }

  function explainPending(attemptId: string): { block: LoopPlusConflictBlock | null; concurrencyBlocked: boolean } {
    const index = pending.findIndex((item) => item.attemptId === attemptId);
    const candidate = index >= 0 ? pending[index] : undefined;
    if (!candidate) {
      return { block: null, concurrencyBlocked: false };
    }
    const runningConflict = findConflict(candidate, running);
    if (runningConflict) {
      return { block: runningConflict, concurrencyBlocked: false };
    }
    const earlierPending = pending.slice(0, index);
    const pendingConflict = findConflict(candidate, earlierPending);
    if (pendingConflict) {
      return { block: pendingConflict, concurrencyBlocked: false };
    }
    return { block: null, concurrencyBlocked: true };
  }

  function latchWake(): boolean {
    if (parentStopped || completed || wakePending || (!currentReview && reviewQueue.length === 0)) {
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
    if (parentStopped || completed || (!currentReview && reviewQueue.length === 0)) {
      wakePending = false;
    }
  }

  function visibleWake(): boolean {
    return wakePending
      && !parentStopped
      && !completed
      && (currentReview !== null || reviewQueue.length > 0);
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
    if (running.length > 0 || pending.length > 0) {
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
    if (reviewQueue.length > 0) {
      blockers.push("review_queue");
    }
    if (currentReview) {
      blockers.push("current_review");
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

  return {
    dispatch,
    finish,
    claimNextReview,
    submitReview,
    wait,
    complete,
    stopParent,
    resumeParent,
    requeueCurrentReview,
    releaseUnstarted,
    promotePending,
    getCompletionBlockers: completionBlockers,
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
  return {
    subtaskId,
    attemptId,
    title: cleanText(value.title),
    conflictGroup: cleanText(value.conflictGroup),
    writeFiles: normalizeLoopWriteFiles(value.writeFiles),
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
    title: spec.title,
    conflictGroup: spec.conflictGroup,
    writeFiles: spec.writeFiles.slice(),
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
  const reviewQueue = readReviews(value.reviewQueue, "reviewQueue");
  const currentReview = value.currentReview === null ? null : readReview(value.currentReview, "currentReview");
  const seenAttempts = readSeenAttempts(value.seenAttempts);
  validateAttemptGraph({
    maxConcurrency: value.maxConcurrency,
    running,
    pending,
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
    running,
    pending,
    reviewQueue,
    currentReview,
    seenAttempts,
  };
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
  return {
    subtaskId: readRequiredId(value.subtaskId, field),
    attemptId: readRequiredId(value.attemptId, field),
    title: readNullableString(value.title, field),
    conflictGroup: readNullableString(value.conflictGroup, field),
    writeFiles: readWriteFiles(value.writeFiles, field),
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
    return {
      subtaskId: readRequiredId(item.subtaskId, `seenAttempts[${index}]`),
      attemptId: readRequiredId(item.attemptId, `seenAttempts[${index}]`),
      disposition: item.disposition,
    };
  });
}

function validateAttemptGraph(input: {
  maxConcurrency: number;
  running: LoopPlusExecutionRecord[];
  pending: LoopPlusExecutionRecord[];
  reviewQueue: LoopPlusReviewItem[];
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
  for (const item of input.reviewQueue) {
    placeAttempt(placed, item.attemptId, item.subtaskId, "finished");
  }
  if (input.currentReview) {
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
    if (seen.disposition === "reviewed") {
      if (actual) {
        invalidSnapshot("seenAttempts");
      }
      continue;
    }
    if (!actual || actual.kind !== seen.disposition || actual.subtaskId !== seen.subtaskId) {
      invalidSnapshot("seenAttempts");
    }
  }
  for (const attemptId of placed.keys()) {
    if (!seenIds.has(attemptId)) {
      invalidSnapshot("seenAttempts");
    }
  }
  const workLeft = input.running.length > 0
    || input.pending.length > 0
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
    title: record.title,
    conflictGroup: record.conflictGroup,
    writeFiles: record.writeFiles.slice(),
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
  };
}

function isOutcome(value: unknown): value is LoopPlusExecutionOutcome {
  return typeof value === "string" && EXECUTION_OUTCOMES.some((outcome) => outcome === value);
}

function isDisposition(value: unknown): value is LoopPlusAttemptDisposition {
  return value === "open" || value === "finished" || value === "reviewed";
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
