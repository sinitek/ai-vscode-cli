import { createHash } from "crypto";
import {
  buildNextLoopMainAiFailureState,
  buildResetLoopMainAiFailureState,
  isLoopMainAiFailureLimitReached,
} from "../loopMainFailure";
import { parseLoopPlusDecision, resolveLoopPlusDecisionSubtaskMax, type LoopPlusDecision } from "../loopPlusDecision";
import {
  createLoopPlusScheduler,
  type LoopPlusExecutionOutcome,
  type LoopPlusExecutionRecord,
  type LoopPlusScheduler,
  type LoopPlusSchedulerSnapshot,
} from "../loopPlusScheduler";
import type { ThinkingMode } from "../cli/types";
import {
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
} from "./loopPlusPromptBuilders";
import type { LoopPlusSubtaskChatNotice } from "./loopPlusSubtaskChat";

export const LOOP_PLUS_MAX_CONCURRENCY = 6;
const DECISION_SAFETY_LIMIT = 200;
const PROTOCOL_RETRY_LIMIT = 2;
const LOOP_PLUS_ATTEMPT_ROUND = 1;

export type LoopPlusPromptTarget = {
  tabId: string;
  cli: LoopTaskRecord["cli"];
  sessionId: string | null;
};

export type LoopPlusRunInput = {
  displayPrompt: string;
  modelPrompt?: string;
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
};

export type LoopPlusRunOptions = {
  resumeTaskId?: string | null;
  resumeRequested?: boolean;
  preserveLoopOrigin?: boolean;
  schedulingMode?: LoopSchedulingMode;
  sessionId?: string | null;
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
  userMessageCount?: number;
  target: LoopPlusPromptTarget;
};

export type LoopPlusMainHandle = {
  promise: Promise<string | null>;
  abort: () => void;
};

export type LoopPlusAttemptRequest = {
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
};

export type LoopPlusAttemptResult = {
  outcome: LoopPlusExecutionOutcome;
  detail: string | null;
};

export type LoopPlusAttemptHandle = {
  promise: Promise<LoopPlusAttemptResult>;
  abort: () => void;
};

export type LoopPlusOrchestrationDeps = {
  maxConcurrency?: number;
  decisionSafetyLimit?: number;
  protocolRetryLimit?: number;
  launchDelayMs?: (lastLaunchAt: number | null, now: number) => number;
  decisionSubtaskMax?: () => number;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
  readTask: (taskId: string) => LoopTaskRecord | null;
  createTask: (input: {
    cli: LoopPlusPromptTarget["cli"];
    rootPrompt: string;
    sessionId: string | null;
    snapshot: LoopPlusSchedulerSnapshot;
    prompt: LoopPlusRunInput;
  }) => LoopTaskRecord;
  updateTask: (taskId: string, patch: Partial<LoopTaskRecord>) => LoopTaskRecord | null;
  appendMessage: (target: LoopPlusPromptTarget, message: string, taskId: string) => void;
  runMain: (request: LoopPlusMainRequest) => LoopPlusMainHandle;
  startAttempt: (request: LoopPlusAttemptRequest) => LoopPlusAttemptHandle;
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
  log?: (event: string, payload?: unknown) => void;
};

type SubtaskMeta = {
  decision: LoopSubtaskDecision;
  communicationFile?: string;
  summary?: string;
  executionStatus?: LoopSubtaskRecord["status"];
};

type InFlightAttempt = {
  subtaskId: string;
  attemptId: string;
  abort: () => void;
  settled: boolean;
};

type MainStep = {
  kind: LoopPlusMainKind;
  eventId: string | null;
  eventIds: string[];
  userMessageCount: number;
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
  currentMain: LoopPlusMainHandle | null;
  currentMainRequest: LoopPlusMainRequest | null;
  launching: Set<string>;
  launchEpoch: Map<string, number>;
  mainGeneration: number;
  pumpRequested: boolean;
  released: boolean;
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
  const runtimes = new Map<string, ParentRuntime>();
  const maxConcurrency = deps.maxConcurrency ?? LOOP_PLUS_MAX_CONCURRENCY;
  const decisionSafetyLimit = deps.decisionSafetyLimit ?? DECISION_SAFETY_LIMIT;
  const protocolRetryLimit = deps.protocolRetryLimit ?? PROTOCOL_RETRY_LIMIT;
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const launchDelayMs = deps.launchDelayMs ?? (() => 0);
  const decisionSubtaskMax = () => resolveLoopPlusDecisionSubtaskMax(deps.decisionSubtaskMax?.());

  function tryRun(input: LoopPlusRunInput, target: LoopPlusPromptTarget, options: LoopPlusRunOptions = {}): LoopPlusRunResult {
    const resumeTaskId = normalizeId(options.resumeTaskId);
    const existing = resumeTaskId ? deps.readTask(resumeTaskId) : null;
    if (resolveLoopPlusEntry(existing, options.schedulingMode) !== "event_driven") {
      return { handled: false, taskId: null, done: Promise.resolve() };
    }
    if (existing) {
      const invalid = invalidSnapshotReason(existing);
      if (invalid) {
        rejectSnapshot(existing, invalid);
        return { handled: true, taskId: existing.id, done: Promise.resolve() };
      }
      const runtime = ensureRuntime(existing, target, input);
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
        }
        const done = runtime.lifecycle.promise;
        releaseCompleted(runtime);
        return { handled: true, taskId: runtime.taskId, done };
      }
      if (options.resumeRequested === true) {
        continueExplicitly(runtime);
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
    pump(created);
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
      deps.updateTask(task.id, {
        status: "stopped",
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
  ): void {
    const runtime = runtimes.get(taskId);
    if (!runtime || runtime.released || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
      return;
    }
    const running = runtime.scheduler.snapshot().running.find((item) => item.subtaskId === subtaskId);
    if (!running) {
      return;
    }
    const inFlight = runtime.attempts.get(running.attemptId);
    if (inFlight && !inFlight.settled) {
      return;
    }
    applyFinish(runtime, {
      subtaskId: running.subtaskId,
      attemptId: running.attemptId,
      outcome,
      detail: detail ?? null,
    });
  }

  function hasController(taskId: string): boolean {
    return runtimes.has(taskId);
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
    const scheduler = createLoopPlusScheduler({ maxConcurrency });
    const task = deps.createTask({
      cli: target.cli,
      rootPrompt: input.displayPrompt,
      sessionId,
      snapshot: scheduler.snapshot(),
      prompt: input,
    });
    const runtime = buildRuntime(task, target, input, scheduler);
    runtimes.set(task.id, runtime);
    deps.appendMessage(target, "loop-plus-started", task.id);
    deps.log?.("loop-plus-started", { taskId: task.id });
    return runtime;
  }

  function ensureRuntime(task: LoopTaskRecord, target: LoopPlusPromptTarget, input: LoopPlusRunInput): ParentRuntime {
    const existing = runtimes.get(task.id);
    if (existing) {
      existing.target = target;
      existing.prompt = input;
      return existing;
    }
    const scheduler = createLoopPlusScheduler({ snapshot: task.loopPlus });
    const runtime = buildRuntime(task, target, input, scheduler);
    runtime.initialPromptDone = scheduler.snapshot().seenAttempts.length > 0
      || scheduler.snapshot().running.length > 0
      || scheduler.snapshot().pending.length > 0
      || scheduler.snapshot().reviewQueue.length > 0
      || scheduler.snapshot().currentReview !== null;
    runtimes.set(task.id, runtime);
    return runtime;
  }

  function buildRuntime(
    task: LoopTaskRecord,
    target: LoopPlusPromptTarget,
    input: LoopPlusRunInput,
    scheduler: LoopPlusScheduler,
  ): ParentRuntime {
    const meta = new Map<string, SubtaskMeta>();
    task.subTasks.forEach((subtask) => {
      meta.set(subtask.id, {
        decision: {
          id: subtask.id,
          title: subtask.title,
          prompt: subtask.prompt ?? subtask.title,
          conflictGroup: subtask.conflictGroup,
          writeFiles: subtask.writeFiles,
        },
        communicationFile: subtask.communicationFile,
        summary: subtask.summary,
        executionStatus: subtask.status,
      });
    });
    return {
      taskId: task.id,
      cli: task.cli,
      target,
      prompt: input,
      scheduler,
      meta,
      attempts: new Map(),
      attemptSeq: scheduler.snapshot().seq,
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
      currentMain: null,
      currentMainRequest: null,
      launching: new Set<string>(),
      launchEpoch: new Map(),
      mainGeneration: 0,
      pumpRequested: false,
      released: false,
      completionPatch: null,
      lifecycle: createLifecycle(),
    };
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
    if (task && isLoopMainAiFailureLimitReached(task)) {
      deps.updateTask(runtime.taskId, {
        ...buildResetLoopMainAiFailureState(),
        status: "running",
        schedulingMode: "event_driven",
        updatedAt: now(),
      });
    }
    if (runtime.scheduler.snapshot().parentStopped || runtime.stopRequested) {
      const resumed = runtime.scheduler.resumeParent();
      runtime.stopRequested = false;
      persist(runtime, { status: resumed.ok ? "running" : "stopped" });
      launchAll(runtime, resumed.started);
      deps.appendMessage(runtime.target, "loop-plus-resumed", runtime.taskId);
      if (resumed.ok && isIdle(runtime)) {
        runtime.forcePrompt = true;
      }
      if (resumed.wake || hasReview(runtime) || runtime.forcePrompt) {
        requestPump(runtime);
      }
      return;
    }
    reconcileLostRunning(runtime);
    if (runtime.autoPaused || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped) {
      return;
    }
    const promoted = runtime.scheduler.promotePending();
    launchAll(runtime, promoted.started);
    if (runtime.autoPaused || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped) {
      return;
    }
    runtime.forcePrompt = isIdle(runtime);
    persist(runtime, { status: "running" });
    deps.appendMessage(runtime.target, "loop-plus-resumed", runtime.taskId);
    requestPump(runtime);
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

  function reconcileLostRunning(runtime: ParentRuntime): void {
    const parentStopping = runtime.stopRequested || runtime.scheduler.snapshot().parentStopped;
    const running = runtime.scheduler.snapshot().running.slice();
    running.forEach((record) => {
      const inFlight = runtime.attempts.get(record.attemptId);
      if (inFlight && !inFlight.settled) {
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
    runtime.mainGeneration += 1;
    runtime.scheduler.stopParent();
    persist(runtime, { status: "stopped", finalSummary: "Loop+ parent scheduling is stopped." });
    const main = runtime.currentMain;
    runtime.currentMain = null;
    runtime.currentMainRequest = null;
    main?.abort();
    Array.from(runtime.attempts.values()).forEach((attempt) => {
      if (!attempt.settled) {
        attempt.abort();
      }
    });
    runtime.stopping = false;
    settle(runtime);
    deps.appendMessage(runtime.target, "loop-plus-stopped", runtime.taskId);
    deps.log?.("loop-plus-stopped", { taskId: runtime.taskId });
  }

  function rejectSnapshot(task: LoopTaskRecord, reason: string): void {
    deps.updateTask(task.id, {
      status: "error",
      schedulingMode: "event_driven",
      finalSummary: `Loop+ event_driven snapshot is ${reason} and was not downgraded to classic Loop or cleared.`,
      updatedAt: now(),
    });
    deps.log?.("loop-plus-snapshot-rejected", { taskId: task.id, reason });
  }

  function requestPump(runtime: ParentRuntime): void {
    if (runtime.consumer) {
      runtime.pumpRequested = true;
      return;
    }
    pump(runtime);
  }

  function pump(runtime: ParentRuntime): void {
    if (runtime.released || runtime.consumer || runtime.autoPaused || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
      return;
    }
    runtime.pumpRequested = false;
    runtime.consumer = runConsumer(runtime).catch((error: unknown) => {
      deps.log?.("loop-plus-consumer-failed", {
        taskId: runtime.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!runtime.lifecycle.settled && !runtime.scheduler.snapshot().completed) {
        pause(runtime, "error", "loop-plus-consumer-failed");
      }
    }).finally(() => {
      runtime.consumer = null;
      const followUp = runtime.pumpRequested || runtime.forcePrompt || hasReview(runtime);
      runtime.pumpRequested = false;
      if (!followUp || runtime.autoPaused || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
        return;
      }
      pump(runtime);
    });
  }

  async function runConsumer(runtime: ParentRuntime): Promise<void> {
    while (!runtime.autoPaused && !runtime.stopRequested && !runtime.scheduler.snapshot().parentStopped) {
      if (runtime.decisionCount >= decisionSafetyLimit) {
        pause(runtime, "needs-review", "loop-plus-safety-limit");
        return;
      }
      const step = planStep(runtime);
      if (!step) {
        return;
      }
      runtime.decisionCount += 1;
      const generation = runtime.mainGeneration;
      const request = buildMainRequest(runtime, step);
      let handle: LoopPlusMainHandle | null = null;
      let content: string | null = null;
      let failed = false;
      let failureMessage = "";
      try {
        if (step.kind === "user") {
          deps.appendMessage(runtime.target, "loop-plus-user-messages", runtime.taskId);
        }
        handle = deps.runMain(request);
        runtime.currentMainRequest = request;
        runtime.currentMain = handle;
        content = await handle.promise;
      } catch (error) {
        failed = true;
        failureMessage = error instanceof Error ? error.message : String(error);
      } finally {
        if (handle && runtime.currentMain === handle) {
          runtime.currentMain = null;
          runtime.currentMainRequest = null;
        }
      }
      if (runtime.released || runtime.autoPaused || generation !== runtime.mainGeneration || runtime.stopRequested || runtime.scheduler.snapshot().parentStopped || runtime.scheduler.snapshot().completed) {
        return;
      }
      if (failed) {
        const task = deps.readTask(runtime.taskId);
        const failure = buildNextLoopMainAiFailureState(task ?? {}, { failureMessage, now: now() });
        deps.updateTask(runtime.taskId, {
          ...failure,
          schedulingMode: "event_driven",
          updatedAt: now(),
        });
        if (isLoopMainAiFailureLimitReached(failure)) {
          pause(runtime, "needs-review", "loop-plus-main-failure-limit");
          return;
        }
        if (!hasReview(runtime)) {
          runtime.forcePrompt = true;
        }
        continue;
      }
      const decision = parseLoopPlusDecision(content, { subtaskMax: decisionSubtaskMax() });
      const applied = applyDecision(runtime, step, decision);
      if (applied === "stop") {
        return;
      }
      if (applied === "wait") {
        if (hasUserMessages(runtime) || hasReview(runtime)) {
          continue;
        }
        return;
      }
    }
  }

  function heldBatchIntact(snapshot: LoopPlusSchedulerSnapshot, step: MainStep): boolean {
    const current = snapshot.currentReview;
    if (!current || step.eventIds.length === 0 || current.eventId !== step.eventIds[0]) {
      return false;
    }
    return step.eventIds.slice(1).every((eventId, index) => snapshot.reviewQueue[index]?.eventId === eventId);
  }

  function planStep(runtime: ParentRuntime): MainStep | null {
    const snapshot = runtime.scheduler.snapshot();
    if (runtime.released || snapshot.completed || snapshot.parentStopped || runtime.stopRequested || runtime.autoPaused) {
      return null;
    }
    if (snapshot.currentReview || snapshot.reviewQueue.length > 0) {
      return planReview(runtime);
    }
    if (!runtime.initialPromptDone) {
      runtime.initialPromptDone = true;
      return plainStep("initial");
    }
    const pendingUserMessages = runtime.scheduler.snapshot().userMessageQueue.length;
    if (pendingUserMessages > 0) {
      runtime.forcePrompt = false;
      return plainStep("user", pendingUserMessages);
    }
    if (runtime.forcePrompt) {
      runtime.forcePrompt = false;
      return plainStep("continue");
    }
    if (runtime.closeoutBudget > 0 && snapshot.running.length === 0 && snapshot.pending.length === 0) {
      runtime.closeoutBudget -= 1;
      return plainStep("closeout");
    }
    return null;
  }

  function planReview(runtime: ParentRuntime): MainStep | null {
    const claimed = runtime.scheduler.claimNextReview();
    persist(runtime);
    if (!claimed.ok || !claimed.item) {
      return null;
    }
    const eventIds = [
      claimed.item.eventId,
      ...claimed.view.reviewQueue.map((item) => item.eventId),
    ];
    return {
      kind: "review",
      eventId: claimed.item.eventId,
      eventIds,
      userMessageCount: claimed.view.userMessageQueue.length,
    };
  }

  function plainStep(kind: Exclude<LoopPlusMainKind, "review">, userMessageCount = 0): MainStep {
    return { kind, eventId: null, eventIds: [], userMessageCount };
  }

  function applyDecision(runtime: ParentRuntime, step: MainStep, decision: LoopPlusDecision | null): "continue" | "wait" | "stop" {
    const snapshot = runtime.scheduler.snapshot();
    const held = snapshot.currentReview;
    if (step.kind === "review" && !heldBatchIntact(snapshot, step)) {
      if (hasReview(runtime)) {
        return "continue";
      }
      return "wait";
    }
    if (!decision) {
      return protocolMiss(runtime, Boolean(held));
    }
    if (decision.status === "wait") {
      if (held) {
        return protocolMiss(runtime, true);
      }
      acknowledgeSeenUserMessages(runtime, step);
      if (hasReview(runtime)) {
        return "continue";
      }
      runtime.protocolRetries = 0;
      resetMainFailure(runtime);
      if (snapshot.running.length === 0 && snapshot.pending.length === 0) {
        if (hasUserMessages(runtime)) {
          return "continue";
        }
        pause(runtime, "needs-review", "loop-plus-idle-wait");
        return "stop";
      }
      persist(runtime, { status: "running" });
      deps.appendMessage(runtime.target, "loop-plus-waiting", runtime.taskId);
      deps.log?.("loop-plus-waiting", { taskId: runtime.taskId, running: snapshot.running.length });
      return "wait";
    }
    if (decision.status === "dispatch") {
      if (held) {
        return protocolMiss(runtime, true);
      }
      acknowledgeSeenUserMessages(runtime, step);
      runtime.protocolRetries = 0;
      resetMainFailure(runtime);
      dispatchDecisions(runtime, decision.subtasks ?? []);
      persistEstimatedRounds(runtime, decision);
      if (hasReview(runtime)) {
        return "continue";
      }
      const after = runtime.scheduler.snapshot();
      if (after.running.length === 0 && after.pending.length === 0) {
        if (hasUserMessages(runtime)) {
          return "continue";
        }
        pause(runtime, "needs-review", "loop-plus-no-work");
        return "stop";
      }
      return "wait";
    }
    if (decision.status === "accept") {
      if (step.kind !== "review" || !sameIds(confirmedReviewIds(decision), step.eventIds)) {
        return protocolMiss(runtime, step.eventIds.length > 0);
      }
      const submitted = runtime.scheduler.submitReviewBatch(step.eventIds);
      if (!submitted.ok) {
        persist(runtime);
        return runtime.scheduler.snapshot().parentStopped ? "stop" : protocolMiss(runtime, true);
      }
      acknowledgeSeenUserMessages(runtime, step);
      runtime.protocolRetries = 0;
      resetMainFailure(runtime);
      dispatchDecisions(runtime, decision.subtasks ?? []);
      persistEstimatedRounds(runtime, decision);
      if (hasReview(runtime)) {
        return "continue";
      }
      const view = runtime.scheduler.wait().view;
      if (view.running.length > 0 || view.pending.length > 0) {
        persist(runtime, { status: "running" });
        return "wait";
      }
      runtime.closeoutBudget = 1;
      return "continue";
    }
    if (decision.status === "blocked") {
      if (runtime.scheduler.snapshot().currentReview) {
        runtime.scheduler.requeueCurrentReview();
      }
      acknowledgeSeenUserMessages(runtime, step);
      runtime.protocolRetries = 0;
      if (hasUserMessages(runtime)) {
        return "continue";
      }
      pause(runtime, "needs-review", "loop-plus-blocked", decision.finalSummary);
      return "stop";
    }
    return applyCompleted(runtime, decision, step);
  }

  function applyCompleted(
    runtime: ParentRuntime,
    decision: LoopPlusDecision,
    step: MainStep,
  ): "continue" | "wait" | "stop" {
    const confirmed = confirmedReviewIds(decision);
    if (step.eventIds.length > 0) {
      if (!sameIds(confirmed, step.eventIds)) {
        return protocolMiss(runtime, true);
      }
      const submitted = runtime.scheduler.submitReviewBatch(step.eventIds);
      if (!submitted.ok) {
        persist(runtime);
        return "stop";
      }
    } else if (confirmed.length > 0) {
      return protocolMiss(runtime, false);
    }
    acknowledgeSeenUserMessages(runtime, step);
    if (hasReview(runtime) || hasUserMessages(runtime) || runtime.scheduler.snapshot().running.length > 0 || runtime.scheduler.snapshot().pending.length > 0) {
      runtime.protocolRetries = 0;
      if (hasReview(runtime) || hasUserMessages(runtime)) {
        return "continue";
      }
      persist(runtime, { status: "running" });
      return "wait";
    }
    const completed = runtime.scheduler.complete();
    if (!completed.ok) {
      if (hasReview(runtime) || hasUserMessages(runtime)) {
        return "continue";
      }
      persist(runtime, { status: "running" });
      return "wait";
    }
    runtime.protocolRetries = 0;
    resetMainFailure(runtime);
    const patch: Partial<LoopTaskRecord> = {
      status: "completed",
      answerConclusion: decision.answerConclusion,
      finalSummary: decision.finalSummary,
      completionRequirementCoverage: decision.requirementCoverage,
      estimatedRemainingRounds: 0,
    };
    try {
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
    releaseCompleted(runtime);
    return "stop";
  }

  function protocolMiss(runtime: ParentRuntime, held: boolean): "continue" | "stop" {
    runtime.protocolRetries += 1;
    deps.log?.("loop-plus-protocol-miss", {
      taskId: runtime.taskId,
      held,
      protocolRetries: runtime.protocolRetries,
    });
    if (runtime.protocolRetries > protocolRetryLimit) {
      pause(runtime, "needs-review", "loop-plus-protocol-paused");
      return "stop";
    }
    if (!hasReview(runtime)) {
      runtime.forcePrompt = true;
    }
    return "continue";
  }

  function dispatchDecisions(runtime: ParentRuntime, subtasks: readonly LoopSubtaskDecision[]): void {
    if (subtasks.length === 0) {
      persist(runtime, { status: "running" });
      return;
    }
    const built = subtasks.map((subtask) => toSpec(runtime, subtask));
    const dispatched = runtime.scheduler.dispatch(built.map((item) => item.spec));
    const accepted = new Set(dispatched.decisions.map((item) => item.attemptId));
    built.forEach((item) => {
      if (!accepted.has(item.spec.attemptId)) {
        return;
      }
      runtime.meta.set(item.spec.subtaskId, {
        decision: item.decision,
        executionStatus: "pending",
      });
    });
    persist(runtime, { status: "running" });
    launchAll(runtime, dispatched.started);
    deps.log?.("loop-plus-dispatched", {
      taskId: runtime.taskId,
      started: dispatched.started.map((item) => item.attemptId),
      pending: dispatched.view.pending.map((item) => item.attemptId),
      rejected: dispatched.rejected.map((item) => ({
        subtaskId: item.subtaskId,
        attemptId: item.attemptId,
        reason: item.reason,
      })),
    });
  }

  function toSpec(runtime: ParentRuntime, subtask: LoopSubtaskDecision): {
    spec: {
      subtaskId: string;
      attemptId: string;
      title: string;
      conflictGroup?: string;
      writeFiles?: string[];
    };
    decision: LoopSubtaskDecision;
  } {
    const subtaskId = subtask.id?.trim() || buildSubtaskId(subtask.title);
    runtime.attemptSeq += 1;
    const attemptId = `lp${runtime.attemptSeq}-${subtaskId}`;
    return {
      spec: {
        subtaskId,
        attemptId,
        title: subtask.title,
        conflictGroup: subtask.conflictGroup,
        writeFiles: subtask.writeFiles,
      },
      decision: { ...subtask, id: subtaskId },
    };
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
      if (meta) {
        meta.communicationFile = communicationFile;
        meta.executionStatus = "running";
      }
      persist(runtime, { status: runtime.scheduler.snapshot().parentStopped ? "stopped" : "running" });
      notifySubtaskChat(runtime, {
        phase: "started",
        subtaskId: record.subtaskId,
        title: decision.title,
        round: LOOP_PLUS_ATTEMPT_ROUND,
        communicationFile,
      });
      const request: LoopPlusAttemptRequest = {
        taskId: runtime.taskId,
        subtaskId: record.subtaskId,
        attemptId: record.attemptId,
        title: decision.title,
        prompt: decision.prompt,
        modelPrompt: buildLoopPlusSubtaskModelPrompt({
          taskId: runtime.taskId,
          rootPrompt: task?.rootPrompt ?? runtime.prompt.displayPrompt,
          subtask: decision,
          attemptId: record.attemptId,
          communicationFile: communicationFile ?? "",
          taskStoreFile: task?.taskStoreFile ?? "",
        }),
        writeFiles: record.writeFiles,
        conflictGroup: record.conflictGroup ?? undefined,
        communicationFile,
        round: LOOP_PLUS_ATTEMPT_ROUND,
        targetCli: runtime.cli,
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
  }): void {
    if (runtime.released || runtime.scheduler.snapshot().completed) {
      deps.log?.("loop-plus-finish-ignored", {
        taskId: runtime.taskId,
        subtaskId: input.subtaskId,
        attemptId: input.attemptId,
        reason: "completed",
      });
      return;
    }
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
      return;
    }
    const meta = runtime.meta.get(input.subtaskId);
    if (meta) {
      meta.summary = input.detail ?? meta.summary;
      meta.executionStatus = input.outcome === "completed" ? "completed" : "blocked";
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
      return;
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
        return;
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
      return;
    }
    notifySubtaskChat(runtime, finishedChatNotice(input, meta));
    if (
      runtime.autoPaused
      || runtime.released
      || runtime.stopRequested
      || runtime.scheduler.snapshot().parentStopped
      || runtime.scheduler.snapshot().completed
    ) {
      return;
    }
    launchAll(runtime, result.started);
    if (result.wake && !runtime.autoPaused && !runtime.released && !runtime.stopRequested && !runtime.scheduler.snapshot().parentStopped && !runtime.scheduler.snapshot().completed) {
      pump(runtime);
    }
  }

  function retainFinishFailure(runtime: ParentRuntime, message: string, finalSummary: string): void {
    runtime.autoPaused = true;
    runtime.pauseStatus = "error";
    releaseLaunchingReservations(runtime);
    runtime.mainGeneration += 1;
    const main = runtime.currentMain;
    runtime.currentMain = null;
    runtime.currentMainRequest = null;
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

  function buildMainRequest(runtime: ParentRuntime, step: MainStep): LoopPlusMainRequest {
    const task = deps.readTask(runtime.taskId);
    const prompt = buildLoopPlusMainModelPrompt({
      taskId: runtime.taskId,
      rootPrompt: task?.rootPrompt ?? runtime.prompt.displayPrompt,
      taskStoreFile: task?.taskStoreFile ?? "",
      mainCommunicationFile: task?.mainCommunicationFile ?? "",
      kind: step.kind,
      view: runtime.scheduler.wait().view,
      currentEventId: step.eventId,
      supplementalRequirements: task?.supplementalRequirements ?? [],
      acceptanceEventIds: step.eventIds,
      pendingUserMessages: step.userMessageCount > 0
        ? runtime.scheduler.snapshot().userMessageQueue.slice(0, step.userMessageCount)
        : [],
      subtaskMax: decisionSubtaskMax(),
    });
    return {
      taskId: runtime.taskId,
      kind: step.kind,
      prompt,
      modelPrompt: prompt,
      reviewEventId: step.eventId,
      reviewEventIds: step.eventIds.slice(),
      userMessageCount: step.userMessageCount,
      target: runtime.target,
    };
  }

  function persist(runtime: ParentRuntime, patch: Partial<LoopTaskRecord> = {}): void {
    const task = deps.readTask(runtime.taskId);
    const snapshot = runtime.scheduler.snapshot();
    const runningIds = snapshot.running.map((item) => item.subtaskId);
    const status = patch.status ?? statusFor(runtime, snapshot, task);
    deps.updateTask(runtime.taskId, {
      ...patch,
      status,
      schedulingMode: "event_driven",
      loopPlus: snapshot,
      activeSubtaskId: runningIds[0] ?? null,
      activeSubtaskIds: runningIds,
      subTasks: mergeSubtasks(runtime, task?.subTasks ?? []),
      updatedAt: now(),
    });
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
    if (!request) {
      return;
    }
    const refreshed = buildMainRequest(runtime, {
      kind: request.kind,
      eventId: request.reviewEventId,
      eventIds: request.reviewEventIds ?? (request.reviewEventId ? [request.reviewEventId] : []),
      userMessageCount: request.userMessageCount ?? 0,
    });
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

  function mergeSubtasks(runtime: ParentRuntime, existing: readonly LoopSubtaskRecord[]): LoopSubtaskRecord[] {
    const byId = new Map(existing.map((subtask) => [subtask.id, subtask]));
    runtime.meta.forEach((meta, subtaskId) => {
      const previous = byId.get(subtaskId);
      const active = runtime.scheduler.snapshot().running.some((item) => item.subtaskId === subtaskId)
        ? "running"
        : runtime.scheduler.snapshot().pending.some((item) => item.subtaskId === subtaskId)
          ? "pending"
          : meta.executionStatus ?? previous?.status ?? "pending";
      byId.set(subtaskId, {
        id: subtaskId,
        title: meta.decision.title,
        prompt: meta.decision.prompt,
        conflictGroup: meta.decision.conflictGroup,
        writeFiles: meta.decision.writeFiles,
        status: active,
        summary: meta.summary ?? previous?.summary,
        communicationFile: meta.communicationFile ?? previous?.communicationFile,
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
      deps.log?.("loop-plus-failure-message-failed", {
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
    deps.updateTask(runtime.taskId, {
      ...buildResetLoopMainAiFailureState(),
      schedulingMode: "event_driven",
      updatedAt: now(),
    });
  }

  function persistEstimatedRounds(runtime: ParentRuntime, decision: LoopPlusDecision): void {
    if (typeof decision.estimatedRemainingRounds !== "number") {
      return;
    }
    deps.updateTask(runtime.taskId, {
      estimatedRemainingRounds: decision.estimatedRemainingRounds,
      schedulingMode: "event_driven",
      updatedAt: now(),
    });
  }

  function hasReview(runtime: ParentRuntime): boolean {
    const snapshot = runtime.scheduler.snapshot();
    return Boolean(snapshot.currentReview) || snapshot.reviewQueue.length > 0;
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

  function submitUserMessage(taskId: string, text: string): boolean {
    const normalized = normalizeId(taskId);
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!normalized || !trimmed) {
      return false;
    }
    const runtime = runtimes.get(normalized);
    if (!runtime) {
      return enqueueStoredUserMessage(normalized, trimmed);
    }
    return enqueueLiveUserMessage(runtime, trimmed);
  }

  function enqueueLiveUserMessage(runtime: ParentRuntime, text: string): boolean {
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
    persist(runtime, { status: "running" });
    if (runtime.currentMain) {
      return true;
    }
    requestPump(runtime);
    return true;
  }

  function enqueueStoredUserMessage(taskId: string, text: string): boolean {
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
    deps.updateTask(task.id, {
      schedulingMode: "event_driven",
      loopPlus: scheduler.snapshot(),
      updatedAt: now(),
    });
    return true;
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
    tryRun,
    stopParent,
    notifySubtaskContinuation,
    hasController,
    reportAttempt,
    submitUserMessage,
  };
}

function confirmedReviewIds(decision: LoopPlusDecision): string[] {
  if (decision.reviewEventIds && decision.reviewEventIds.length > 0) {
    return decision.reviewEventIds;
  }
  if (decision.reviewEventId) {
    return [decision.reviewEventId];
  }
  return [];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
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
