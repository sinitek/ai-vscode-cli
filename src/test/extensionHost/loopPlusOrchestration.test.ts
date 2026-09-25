import test = require("node:test");
import assert = require("node:assert/strict");

import {
  createLoopPlusOrchestrationHost,
  resolveLoopPlusEntry,
  type LoopPlusAttemptRequest,
  type LoopPlusAttemptResult,
  type LoopPlusMainHandle,
  type LoopPlusMainRequest,
  type LoopPlusOrchestrationDeps,
  type LoopPlusPromptTarget,
} from "../../extensionHost/loopPlusOrchestration";
import { buildLoopPlusFinishEventId, createLoopPlusScheduler, type LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import type { LoopSubtaskDecision, LoopTaskRecord } from "../../loopTaskStore";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

type MainCall = {
  request: LoopPlusMainRequest;
  resolve: (value: string | null) => void;
  releaseAbort: (value?: string | null) => void;
};

type AttemptReport = {
  subtaskId: string;
  attemptId: string;
  outcome: string;
  detail: string | null;
};

type AttemptCall = {
  request: LoopPlusAttemptRequest;
  resolve: (value: LoopPlusAttemptResult) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function longPrompt(title: string, files: readonly string[]): string {
  return `Implement ${title} without editing the parent task record or scheduler snapshot. Write scope: ${files.join(", ")}. Report only the attempt result.`;
}

function subtask(id: string, files: string[], conflictGroup?: string): LoopSubtaskDecision {
  return {
    id,
    title: id,
    prompt: longPrompt(id, files),
    writeFiles: files,
    ...(conflictGroup ? { conflictGroup } : {}),
  };
}

function decisionJson(value: unknown): string {
  return JSON.stringify(value);
}

function baseTask(id: string, snapshot?: LoopPlusSchedulerSnapshot): LoopTaskRecord {
  return {
    id,
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: `/tmp/${id}/loop-tasks.json`,
    rootPrompt: "ship the feature",
    schedulingMode: "event_driven",
    loopPlus: snapshot,
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    maxRounds: 20,
    currentRound: 0,
    communicationDir: `/tmp/${id}`,
    mainCommunicationFile: `/tmp/${id}/main.md`,
    sessionId: "session",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    supplementalRequirements: ["keep the public API stable"],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

function harness(options: {
  maxConcurrency?: number;
  decisionSafetyLimit?: number;
  launchDelayMs?: (last: number | null, now: number) => number;
  delay?: (ms: number) => Promise<void>;
  deferMainAbort?: boolean;
  deferAttemptAbort?: boolean;
  throwOnStart?: boolean;
  prepareCommunication?: LoopPlusOrchestrationDeps["prepareCommunication"];
  recordAttempt?: LoopPlusOrchestrationDeps["recordAttempt"];
  beforeReadTask?: () => void;
  beforeUpdateTask?: (patch: Partial<LoopTaskRecord>) => void;
  adaptMain?: (request: LoopPlusMainRequest, callIndex: number) => LoopPlusMainHandle | undefined;
} = {}) {
  const tasks = new Map<string, LoopTaskRecord>();
  const mains: MainCall[] = [];
  const attempts: AttemptCall[] = [];
  const messages: string[] = [];
  const reports: AttemptReport[] = [];
  const logs: Array<{ event: string; payload?: unknown }> = [];
  let activeMains = 0;
  let maxMains = 0;
  let taskSeq = 0;
  let mainCalls = 0;
  const target: LoopPlusPromptTarget = { tabId: "tab-main", cli: "codex", sessionId: "session" };
  const deps: LoopPlusOrchestrationDeps = {
    maxConcurrency: options.maxConcurrency ?? 6,
    ...(options.decisionSafetyLimit !== undefined ? { decisionSafetyLimit: options.decisionSafetyLimit } : {}),
    launchDelayMs: options.launchDelayMs ?? (() => 0),
    delay: options.delay ?? (async () => undefined),
    prepareCommunication: options.prepareCommunication,
    readTask: (taskId) => {
      options.beforeReadTask?.();
      return tasks.get(taskId) ?? null;
    },
    createTask: (input) => {
      taskSeq += 1;
      const task = baseTask(`task-${taskSeq}`, input.snapshot);
      task.rootPrompt = input.rootPrompt;
      task.sessionId = input.sessionId;
      tasks.set(task.id, task);
      return task;
    },
    updateTask: (taskId, patch) => {
      options.beforeUpdateTask?.(patch);
      const existing = tasks.get(taskId);
      if (!existing) {
        return null;
      }
      const next = { ...existing, ...patch, id: existing.id };
      tasks.set(taskId, next);
      return next;
    },
    appendMessage: (_target, message) => {
      messages.push(message);
    },
    runMain: (request) => {
      mainCalls += 1;
      if (options.adaptMain) {
        const adapted = options.adaptMain(request, mainCalls);
        if (adapted) {
          return adapted;
        }
      }
      activeMains += 1;
      maxMains = Math.max(maxMains, activeMains);
      const gate = deferred<string | null>();
      const call: MainCall = {
        request,
        resolve: gate.resolve,
        releaseAbort: (value) => gate.resolve(value ?? null),
      };
      mains.push(call);
      return {
        promise: gate.promise.finally(() => {
          activeMains -= 1;
        }),
        abort: () => {
          if (options.deferMainAbort) {
            return;
          }
          gate.resolve(null);
        },
      };
    },
    startAttempt: (request) => {
      if (options.throwOnStart) {
        throw new Error("sync start adapter");
      }
      const gate = deferred<LoopPlusAttemptResult>();
      attempts.push({ request, resolve: gate.resolve });
      return {
        promise: gate.promise,
        abort: () => {
          if (options.deferAttemptAbort) {
            return;
          }
          gate.resolve({ outcome: "stopped", detail: "aborted" });
        },
      };
    },
    recordAttempt: (input) => {
      options.recordAttempt?.(input);
      reports.push({
        subtaskId: input.subtaskId,
        attemptId: input.attemptId,
        outcome: input.outcome,
        detail: input.detail,
      });
    },
    log: (event, payload) => {
      logs.push({ event, payload });
    },
  };
  return {
    host: createLoopPlusOrchestrationHost(deps),
    reloadHost: () => createLoopPlusOrchestrationHost(deps),
    tasks,
    mains,
    attempts,
    messages,
    reports,
    logs,
    target,
    maxMains: () => maxMains,
    activeMains: () => activeMains,
    mainCalls: () => mainCalls,
  };
}

function snapshotOf(task: LoopTaskRecord | undefined): LoopPlusSchedulerSnapshot {
  return task?.loopPlus as LoopPlusSchedulerSnapshot;
}

test("resolveLoopPlusEntry keeps the saved scheduling mode ahead of the current dropdown", () => {
  assert.equal(resolveLoopPlusEntry(null, "event_driven"), "event_driven");
  assert.equal(resolveLoopPlusEntry(null, "classic"), "classic");
  assert.equal(resolveLoopPlusEntry(null, undefined), "classic");
  assert.equal(resolveLoopPlusEntry({ schedulingMode: "event_driven" }, "classic"), "event_driven");
  assert.equal(resolveLoopPlusEntry({ schedulingMode: "classic" }, "event_driven"), "classic");
  assert.equal(resolveLoopPlusEntry({}, "event_driven"), "classic");
});

test("starts one main review when A finishes while B is still running", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains.length, 1);
  assert.equal(env.mains[0].request.kind, "initial");
  assert.match(env.mains[0].request.modelPrompt, /FIFO review queue count: 0/);
  assert.match(env.mains[0].request.modelPrompt, /keep the public API stable/);
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 2);
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const reviews = env.mains.filter((item) => item.request.kind === "review");
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].request.reviewEventId, buildLoopPlusFinishEventId("alpha", alpha.request.attemptId));
  assert.equal(env.maxMains(), 1);
  const task = env.tasks.get(run.taskId ?? "");
  assert.deepEqual(task?.activeSubtaskIds, ["beta"]);
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(task).running.map((item) => item.subtaskId), ["beta"]);
  assert.equal(beta.request.attemptId.length > 0, true);
});

test("reviews completions that arrive during review one at a time in FIFO order", async () => {
  const env = harness({ maxConcurrency: 3 });
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [
      subtask("alpha", ["src/alpha.ts"]),
      subtask("beta", ["src/beta.ts"]),
      subtask("gamma", ["src/gamma.ts"]),
    ],
  }));
  await flush();
  assert.equal(env.attempts.length, 3);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  env.attempts[1].resolve({ outcome: "completed", detail: "beta" });
  env.attempts[2].resolve({ outcome: "failed", detail: "gamma" });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(env.activeMains(), 1);
  const firstReview = env.mains[1];
  assert.equal(firstReview.request.reviewEventId, buildLoopPlusFinishEventId("alpha", env.attempts[0].request.attemptId));
  assert.match(firstReview.request.modelPrompt, /FIFO review queue count: 2/);
  firstReview.resolve(decisionJson({ status: "accept", reviewEventId: firstReview.request.reviewEventId }));
  await flush();
  const second = env.mains.filter((item) => item.request.kind === "review")[1];
  assert.equal(second.request.reviewEventId, buildLoopPlusFinishEventId("beta", env.attempts[1].request.attemptId));
  second.resolve(decisionJson({ status: "accept", reviewEventId: second.request.reviewEventId }));
  await flush();
  const third = env.mains.filter((item) => item.request.kind === "review")[2];
  assert.equal(third.request.reviewEventId, buildLoopPlusFinishEventId("gamma", env.attempts[2].request.attemptId));
  assert.equal(env.maxMains(), 1);
});

test("waits without a new dispatch or another main prompt while work is still running", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = env.mains[1];
  const before = env.mains.length;
  review.resolve(decisionJson({ status: "accept", reviewEventId: review.request.reviewEventId }));
  await flush();
  assert.equal(env.mains.length, before);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.deepEqual(env.tasks.get(run.taskId ?? "")?.activeSubtaskIds, ["beta"]);
  assert.equal(env.messages.includes("loop-plus-waiting") || env.tasks.get(run.taskId ?? "")?.status === "running", true);
  assert.equal(env.tasks.get(run.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.currentRound ?? 0, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.rounds.length ?? 0, 0);
});

test("keeps conflict and concurrency limits when new work is added beside a running attempt", async () => {
  const env = harness({ maxConcurrency: 2 });
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src\\shared.ts"]), subtask("beta", ["src/shared.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.attempts[0].request.subtaskId, "alpha");
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = env.mains[1];
  review.resolve(decisionJson({
    status: "accept",
    reviewEventId: review.request.reviewEventId,
    subtasks: [subtask("gamma", ["src/gamma.ts"]), subtask("delta", ["src/delta.ts"]), subtask("epsilon", ["src/epsilon.ts"])],
  }));
  await flush();
  const started = env.attempts.map((item) => item.request.subtaskId);
  assert.deepEqual(started, ["alpha", "beta", "gamma"]);
  assert.equal(env.attempts.length, 3);
  const task = Array.from(env.tasks.values())[0];
  assert.equal(snapshotOf(task).running.length <= 2, true);
  assert.equal(snapshotOf(task).pending.length >= 1, true);
});

test("does not complete when a new finish arrives during the completion decision", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = env.mains[1];
  env.attempts[1].resolve({ outcome: "completed", detail: "beta" });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  review.resolve(decisionJson({
    status: "completed",
    reviewEventId: review.request.reviewEventId,
    answerConclusion: "finished",
    finalSummary: "everything passed",
    acceptance: { passed: true, checks: [{ name: "scope", passed: true }] },
    requirementCoverage: [{ name: "scope", passed: true }],
  }));
  await flush();
  assert.notEqual(env.tasks.get(run.taskId ?? "")?.status, "completed");
  const next = env.mains.filter((item) => item.request.kind === "review")[1];
  assert.equal(next.request.reviewEventId, buildLoopPlusFinishEventId("beta", env.attempts[1].request.attemptId));
});

test("ignores duplicate and stale attempt callbacks", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  const first = env.attempts[0];
  first.resolve({ outcome: "completed", detail: "first" });
  await flush();
  const reviewCount = env.mains.filter((item) => item.request.kind === "review").length;
  env.host.reportAttempt(run.taskId ?? "", {
    subtaskId: "alpha",
    attemptId: first.request.attemptId,
    outcome: "failed",
    detail: "duplicate",
  });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, reviewCount);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.attemptId, first.request.attemptId);
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: env.mains[1].request.reviewEventId }));
  await flush();
  const closeout = env.mains.find((item) => item.request.kind === "closeout");
  assert.ok(closeout);
  closeout.resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha-next.ts"])],
  }));
  await flush();
  const second = env.attempts[1];
  assert.notEqual(second.request.attemptId, first.request.attemptId);
  const runningBefore = snapshotOf(env.tasks.get(run.taskId ?? "")).running.map((item) => item.attemptId);
  env.host.reportAttempt(run.taskId ?? "", {
    subtaskId: "alpha",
    attemptId: first.request.attemptId,
    outcome: "stopped",
    detail: "stale",
  });
  await flush();
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).running.map((item) => item.attemptId), runningBefore);
});

test("stops the parent gate before cancelling attempts and resumes without reviving them", async () => {
  const env = harness({ maxConcurrency: 2 });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 2);
  const beforeStop = env.attempts.map((item) => item.request.attemptId);
  env.host.stopParent(run.taskId ?? "");
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).parentStopped, true);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "stopped");
  assert.equal(env.tasks.get(run.taskId ?? "")?.schedulingMode, "event_driven");
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    schedulingMode: "classic",
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).parentStopped, false);
  const revived = env.attempts.filter((item) => !beforeStop.includes(item.request.attemptId));
  assert.deepEqual(revived, []);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length > 0, true);
});

test("does not block an immediate review behind the launch throttle", async () => {
  let releaseDelay: (() => void) | null = null;
  const env = harness({
    maxConcurrency: 1,
    launchDelayMs: (last) => last === null ? 0 : 60_000,
    delay: () => new Promise((resolve) => {
      releaseDelay = resolve;
    }),
  });
  env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(env.attempts.length, 1);
  assert.equal(typeof releaseDelay, "function");
});

test("rejects a damaged event_driven snapshot without downgrading or clearing it", async () => {
  const env = harness();
  const damaged = baseTask("damaged");
  damaged.loopPlus = { version: 1, broken: true };
  env.tasks.set(damaged.id, damaged);
  const run = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    schedulingMode: "classic",
    resumeTaskId: damaged.id,
    resumeRequested: true,
  });
  await flush();
  assert.equal(run.handled, true);
  assert.equal(env.tasks.get(damaged.id)?.status, "error");
  assert.equal(env.tasks.get(damaged.id)?.schedulingMode, "event_driven");
  assert.deepEqual(env.tasks.get(damaged.id)?.loopPlus, damaged.loopPlus);
  assert.equal(env.attempts.length, 0);
  assert.equal(env.mains.length, 0);
  const missing = baseTask("missing");
  delete missing.loopPlus;
  env.tasks.set(missing.id, missing);
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: missing.id,
    resumeRequested: true,
    schedulingMode: "event_driven",
  });
  await flush();
  assert.equal(env.tasks.get(missing.id)?.status, "error");
  assert.equal(Object.prototype.hasOwnProperty.call(env.tasks.get(missing.id), "loopPlus"), false);
  assert.equal(env.tasks.get(missing.id)?.schedulingMode, "event_driven");
});

test("does not let a subtask continuation revive a finished attempt", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.host.notifySubtaskContinuation(run.taskId ?? "", "alpha", "completed", "from subtab");
  await flush();
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview, null);
  assert.equal(env.attempts.length, 1);
  env.attempts[0].resolve({ outcome: "completed", detail: "runner" });
  await flush();
  const attemptId = env.attempts[0].request.attemptId;
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.attemptId, attemptId);
  env.host.notifySubtaskContinuation(run.taskId ?? "", "alpha", "completed", "again");
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).running.length, 0);
});

async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await flush();
  return settled;
}

test("resume after stopping the unanswered initial main issues exactly one executable main", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(env.mains.length, 1);
  env.host.stopParent(run.taskId ?? "");
  await flush();
  assert.equal(await isSettled(run.done), true);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    schedulingMode: "classic",
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(env.mains.length, 2);
  assert.equal(env.mains[1].request.kind, "continue");
  assert.equal(task?.status, "running");
  assert.equal(snapshotOf(task).phase, "idle");
  assert.equal(snapshotOf(task).parentStopped, false);
  assert.equal(env.attempts.length, 0);
  assert.equal(await isSettled(continued.done), false);
  await flush();
  assert.equal(env.mains.length, 2);
  env.mains[1].resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "hold" }));
  await flush();
  assert.equal(await isSettled(continued.done), true);
  assert.equal(env.attempts.length, 0);
});

test("ignores a late initial decision that returns after stop and explicit resume", async () => {
  const env = harness({ deferMainAbort: true });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.host.stopParent(run.taskId ?? "");
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  env.mains[0].releaseAbort(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 0);
  assert.equal(env.mains.length, 2);
  assert.equal(env.mains[1].request.kind, "continue");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).running.length, 0);
  assert.equal(await isSettled(continued.done), false);
  await flush();
  assert.equal(env.mains.length, 2);
});

test("does not confirm a review when its old main result arrives after resume", async () => {
  const env = harness({ deferMainAbort: true });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "real result" });
  await flush();
  const review = env.mains[1];
  const eventId = review.request.reviewEventId;
  env.host.stopParent(run.taskId ?? "");
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  review.releaseAbort(decisionJson({ status: "accept", reviewEventId: eventId, subtasks: [] }));
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "closeout").length, 0);
  assert.equal(env.attempts.length, 1);
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(snapshotOf(task).currentReview?.eventId, eventId);
  assert.equal(snapshotOf(task).currentReview?.outcome, "completed");
  assert.notEqual(task?.status, "completed");
});

test("settles an already completed snapshot without occupying the controller", async () => {
  const env = harness();
  const scheduler = createLoopPlusScheduler({ maxConcurrency: 6 });
  assert.equal(scheduler.complete().ok, true);
  const task = baseTask("completed-task", scheduler.snapshot());
  task.status = "completed";
  task.finalSummary = "already done";
  env.tasks.set(task.id, task);
  const first = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    schedulingMode: "classic",
    resumeTaskId: task.id,
    resumeRequested: true,
  });
  const second = env.host.tryRun({ displayPrompt: "continue again" }, env.target, {
    resumeTaskId: task.id,
    resumeRequested: true,
  });
  assert.equal(await isSettled(first.done), true);
  assert.equal(await isSettled(second.done), true);
  assert.equal(env.host.hasController(task.id), false);
  assert.equal(env.mains.length, 0);
  assert.equal(env.attempts.length, 0);
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  assert.equal(env.tasks.get(task.id)?.finalSummary, "already done");
  assert.equal(snapshotOf(env.tasks.get(task.id)).phase, "completed");
  env.host.stopParent(task.id);
  assert.equal(env.tasks.get(task.id)?.status, "completed");
  assert.equal(snapshotOf(env.tasks.get(task.id)).completed, true);
});

test("does not let a rejected duplicate or stale finish rewrite records or reports", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "real result" });
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  const alpha = () => stored()?.subTasks.find((item) => item.id === "alpha");
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0].detail, "real result");
  assert.equal(alpha()?.summary, "real result");
  assert.equal(alpha()?.status, "completed");
  assert.equal(snapshotOf(stored()).currentReview?.outcome, "completed");
  assert.equal(snapshotOf(stored()).currentReview?.detail, "real result");
  const updatedAt = stored()?.updatedAt;
  env.host.reportAttempt(taskId, {
    subtaskId: "alpha",
    attemptId: env.attempts[0].request.attemptId,
    outcome: "failed",
    detail: "stale overwrite",
  });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(alpha()?.summary, "real result");
  assert.equal(alpha()?.status, "completed");
  assert.notEqual(stored()?.status, "blocked");
  assert.equal(snapshotOf(stored()).currentReview?.outcome, "completed");
  assert.equal(snapshotOf(stored()).currentReview?.detail, "real result");
  assert.equal(stored()?.updatedAt, updatedAt);
  env.host.reportAttempt(taskId, {
    subtaskId: "missing",
    attemptId: "unknown-attempt",
    outcome: "failed",
    detail: "unknown",
  });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(stored()?.subTasks.some((item) => item.id === "missing"), false);
  env.mains[1].resolve(decisionJson({ status: "accept", reviewEventId: env.mains[1].request.reviewEventId, subtasks: [] }));
  await flush();
  const closeout = env.mains.find((item) => item.request.kind === "closeout");
  assert.ok(closeout);
  closeout.resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha-next.ts"])],
  }));
  await flush();
  const retry = env.attempts[1];
  assert.notEqual(retry.request.attemptId, env.attempts[0].request.attemptId);
  const runningBefore = snapshotOf(stored()).running.map((item) => item.attemptId);
  const reportsBefore = env.reports.length;
  const summaryBefore = alpha()?.summary;
  env.host.reportAttempt(taskId, {
    subtaskId: "alpha",
    attemptId: env.attempts[0].request.attemptId,
    outcome: "failed",
    detail: "stale overwrite",
  });
  await flush();
  assert.deepEqual(snapshotOf(stored()).running.map((item) => item.attemptId), runningBefore);
  assert.equal(env.reports.length, reportsBefore);
  assert.equal(alpha()?.summary, summaryBefore);
  assert.notEqual(alpha()?.status, "blocked");
  assert.equal(alpha()?.summary === "stale overwrite", false);
});

test("keeps the running task meta when a same-id dispatch is rejected", async () => {
  const env = harness({
    prepareCommunication: (_task, subtask) => `/reports/${subtask.id}.md`,
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"], "beta-group")],
  }));
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  const beta = stored()?.subTasks.find((item) => item.id === "beta");
  assert.ok(beta);
  beta.summary = "beta summary";
  env.attempts.find((item) => item.request.subtaskId === "alpha")?.resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  review.resolve(decisionJson({
    status: "accept",
    reviewEventId: review.request.reviewEventId,
    subtasks: [{
      id: "beta",
      title: "REJECTED replacement B",
      prompt: longPrompt("REJECTED replacement B", ["src/evil.ts"]),
      writeFiles: ["src/evil.ts"],
      conflictGroup: "evil-group",
    }],
  }));
  await flush();
  const nextBeta = stored()?.subTasks.find((item) => item.id === "beta");
  assert.equal(nextBeta?.title, "beta");
  assert.equal(nextBeta?.prompt, longPrompt("beta", ["src/beta.ts"]));
  assert.deepEqual(nextBeta?.writeFiles, ["src/beta.ts"]);
  assert.equal(nextBeta?.conflictGroup, "beta-group");
  assert.equal(nextBeta?.communicationFile, "/reports/beta.md");
  assert.equal(nextBeta?.summary, "beta summary");
  assert.equal(nextBeta?.status, "running");
  assert.equal(snapshotOf(stored()).running.find((item) => item.subtaskId === "beta")?.title, "beta");
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "beta").length, 1);
  assert.equal(env.logs.some((item) => {
    const rejected = (item.payload as { rejected?: Array<{ subtaskId?: string; reason?: string }> } | undefined)?.rejected;
    return item.event === "loop-plus-dispatched" && rejected?.some((entry) => entry.subtaskId === "beta" && entry.reason === "active_subtask");
  }), true);
});

test("does not treat a delayed launch as a lost process", async () => {
  const delayed: { release: (() => void) | null } = { release: null };
  const env = harness({
    maxConcurrency: 2,
    launchDelayMs: (last) => last === null ? 0 : 60_000,
    delay: () => new Promise((resolve) => {
      delayed.release = () => resolve();
    }),
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(typeof delayed.release, "function");
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.deepEqual(snapshotOf(task).running.map((item) => item.subtaskId).sort(), ["alpha", "beta"]);
  assert.equal(snapshotOf(task).currentReview, null);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 0);
  assert.equal(env.attempts.length, 1);
  delayed.release?.();
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId).sort(), ["alpha", "beta"]);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview, null);
});

test("resumes after the decision safety gate instead of pausing again immediately", async () => {
  const env = harness({ decisionSafetyLimit: 1 });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 0);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "needs-review");
  assert.equal(env.messages.filter((item) => item === "loop-plus-safety-limit").length, 1);
  env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-safety-limit").length, 1);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.equal(env.tasks.get(run.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
});

test("resumes a blocked review and a main-failure pause without reviving attempts", async () => {
  const blocked = harness();
  const blockedRun = blocked.host.tryRun({ displayPrompt: "ship the feature" }, blocked.target, { schedulingMode: "event_driven" });
  await flush();
  blocked.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  blocked.attempts[0].resolve({ outcome: "completed", detail: "alpha" });
  await flush();
  const review = blocked.mains[1];
  review.resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "need a person" }));
  await flush();
  assert.equal(blocked.tasks.get(blockedRun.taskId ?? "")?.status, "needs-review");
  assert.equal(snapshotOf(blocked.tasks.get(blockedRun.taskId ?? "")).currentReview, null);
  assert.equal(snapshotOf(blocked.tasks.get(blockedRun.taskId ?? "")).reviewQueue.length, 1);
  blocked.host.tryRun({ displayPrompt: "continue" }, blocked.target, {
    resumeTaskId: blockedRun.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(blocked.mains.filter((item) => item.request.kind === "review").length, 2);
  assert.equal(blocked.attempts.length, 1);
  assert.equal(blocked.tasks.get(blockedRun.taskId ?? "")?.status, "running");
  assert.equal(blocked.tasks.get(blockedRun.taskId ?? "")?.mainAiFailureCount ?? 0, 0);

  let mainCalls = 0;
  const failed = harness({
    adaptMain: () => {
      mainCalls += 1;
      if (mainCalls <= 5) {
        throw new Error(`sync down ${mainCalls}`);
      }
      return undefined;
    },
  });
  const failedRun = failed.host.tryRun({ displayPrompt: "ship the feature" }, failed.target, { schedulingMode: "event_driven" });
  await flush();
  assert.equal(mainCalls, 5);
  assert.equal(failed.mainCalls(), 5);
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.status, "needs-review");
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.mainAiFailureCount, 5);
  assert.equal(await isSettled(failedRun.done), true);
  failed.host.tryRun({ displayPrompt: "continue" }, failed.target, {
    resumeTaskId: failedRun.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(mainCalls, 6);
  assert.equal(failed.mains.length, 1);
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.mainAiFailureLimitReached, false);
  assert.equal(failed.tasks.get(failedRun.taskId ?? "")?.status, "running");
  assert.equal(failed.messages.filter((item) => item === "loop-plus-main-failure-limit").length, 1);
});

test("finishes a synchronously thrown attempt without hanging the controller", async () => {
  const env = harness({ throwOnStart: true });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 0);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0].outcome, "failed");
  assert.equal(await isSettled(run.done), false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
});

test("rejects continue while a cancelled attempt is still aborting, then reviews it on the next explicit continue", async () => {
  const env = harness({ deferMainAbort: true, deferAttemptAbort: true, maxConcurrency: 2 });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  const alphaEventId = review.request.reviewEventId;
  assert.equal(env.mainCalls(), 2);
  env.host.stopParent(run.taskId ?? "");
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "stopped");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).parentStopped, true);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).running.some((item) => item.subtaskId === "beta"), true);
  assert.equal(await isSettled(run.done), true);
  assert.equal(await isSettled(continued.done), true);
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.messages.filter((item) => item === "loop-plus-resume-blocked").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-resumed").length, 0);
  review.releaseAbort(decisionJson({
    status: "accept",
    reviewEventId: alphaEventId,
    subtasks: [subtask("gamma", ["src/gamma.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.some((item) => item.request.subtaskId === "gamma"), false);
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "stopped");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.eventId, alphaEventId);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.outcome, "completed");
  beta.resolve({ outcome: "stopped", detail: "aborted late" });
  await flush();
  const queued = snapshotOf(env.tasks.get(run.taskId ?? ""));
  assert.equal(queued.running.length, 0);
  assert.equal(queued.parentStopped, true);
  assert.equal(queued.currentReview?.eventId, alphaEventId);
  assert.equal(queued.reviewQueue.length, 1);
  assert.equal(queued.reviewQueue[0]?.subtaskId, "beta");
  assert.equal(queued.reviewQueue[0]?.outcome, "stopped");
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.attempts.length, 2);
  assert.equal(await isSettled(continued.done), true);
  assert.equal(env.tasks.get(run.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
  const again = env.host.tryRun({ displayPrompt: "continue again" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  const resumed = snapshotOf(env.tasks.get(run.taskId ?? ""));
  assert.equal(resumed.parentStopped, false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.equal(env.mainCalls(), 3);
  assert.equal(env.mains[2]?.request.kind, "review");
  assert.equal(env.mains[2]?.request.reviewEventId, alphaEventId);
  assert.equal(env.attempts.length, 2);
  assert.equal(env.attempts.some((item) => item.request.subtaskId === "gamma"), false);
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "beta").length, 1);
  assert.equal(await isSettled(again.done), false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.currentRound ?? 0, 0);
  assert.equal(env.host.hasController(run.taskId ?? ""), true);
});

test("retains a finished attempt when report writing fails and reviews the queue on explicit continue", async () => {
  let alphaReports = 0;
  const env = harness({
    maxConcurrency: 2,
    recordAttempt: (input) => {
      if (input.subtaskId === "alpha") {
        alphaReports += 1;
        throw new Error("report disk full");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  assert.equal(alphaReports, 1);
  assert.equal(env.reports.length, 0);
  assert.equal(stored()?.status, "error");
  assert.match(stored()?.finalSummary ?? "", /report disk full/);
  assert.equal(env.messages.filter((item) => item === "loop-plus-report-failed").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
  assert.equal(env.mainCalls(), 1);
  assert.deepEqual(snapshotOf(stored()).running.map((item) => item.subtaskId), ["beta"]);
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.equal(snapshotOf(stored()).currentReview?.outcome, "completed");
  assert.equal(snapshotOf(stored()).currentReview?.detail, "alpha done");
  assert.equal(snapshotOf(stored()).reviewQueue.length, 0);
  assert.equal(stored()?.subTasks.find((item) => item.id === "alpha")?.summary, "alpha done");
  assert.equal(await isSettled(run.done), true);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  const updatedAt = stored()?.updatedAt;
  env.host.reportAttempt(taskId, {
    subtaskId: "alpha",
    attemptId: alpha.request.attemptId,
    outcome: "failed",
    detail: "duplicate report",
  });
  await flush();
  assert.equal(alphaReports, 1);
  assert.equal(env.reports.length, 0);
  assert.equal(env.mainCalls(), 1);
  assert.equal(snapshotOf(stored()).currentReview?.detail, "alpha done");
  assert.equal(snapshotOf(stored()).reviewQueue.length, 0);
  assert.equal(stored()?.updatedAt, updatedAt);
  assert.equal(stored()?.status, "error");
  beta.resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0]?.subtaskId, "beta");
  assert.equal(snapshotOf(stored()).running.length, 0);
  assert.deepEqual(snapshotOf(stored()).reviewQueue.map((item) => item.subtaskId), ["beta"]);
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.equal(stored()?.status, "error");
  assert.equal(env.mainCalls(), 1);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(stored()?.status, "running");
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.mains[1]?.request.kind, "review");
  assert.equal(env.mains[1]?.request.reviewEventId, snapshotOf(stored()).currentReview?.eventId);
  assert.equal(env.mains[1]?.request.reviewEventId, buildLoopPlusFinishEventId("alpha", alpha.request.attemptId));
  assert.equal(env.attempts.length, 2);
  assert.equal(await isSettled(continued.done), false);
  env.mains[1]?.resolve(decisionJson({
    status: "accept",
    reviewEventId: env.mains[1]?.request.reviewEventId,
    subtasks: [],
  }));
  await flush();
  assert.equal(env.mains[2]?.request.kind, "review");
  assert.equal(env.mains[2]?.request.reviewEventId, buildLoopPlusFinishEventId("beta", beta.request.attemptId));
  assert.equal(env.attempts.length, 2);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  assert.equal(stored()?.currentRound ?? 0, 0);
});

test("turns a communication preparation failure into one visible failed finish", async () => {
  const env = harness({
    prepareCommunication: () => {
      throw new Error("prepare failed");
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(env.attempts.length, 0);
  assert.equal(snapshotOf(task).running.length, 0);
  assert.equal(snapshotOf(task).currentReview?.outcome, "failed");
  assert.equal(snapshotOf(task).currentReview?.detail, "prepare failed");
  assert.equal(env.reports.length, 1);
  assert.equal(env.reports[0]?.outcome, "failed");
  assert.equal(env.reports[0]?.detail, "prepare failed");
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(task?.status, "running");
  assert.equal(task?.mainAiFailureCount ?? 0, 0);
  assert.equal(await isSettled(run.done), false);
  const attemptId = snapshotOf(task).currentReview?.attemptId ?? "";
  env.host.reportAttempt(run.taskId ?? "", {
    subtaskId: "alpha",
    attemptId,
    outcome: "completed",
    detail: "duplicate prepare",
  });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.detail, "prepare failed");
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).reviewQueue.length, 0);
});

test("pauses recoverably when persisting a finish fails and keeps the completion queue", async () => {
  let persistFailures = 0;
  const env = harness({
    beforeUpdateTask: (patch) => {
      const snapshot = patch.loopPlus as LoopPlusSchedulerSnapshot | undefined;
      if (persistFailures === 0 && snapshot?.currentReview?.subtaskId === "alpha") {
        persistFailures += 1;
        throw new Error("persist failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(persistFailures, 1);
  assert.equal(task?.status, "error");
  assert.match(task?.finalSummary ?? "", /persist failed/);
  assert.equal(snapshotOf(task).running.length, 0);
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.equal(snapshotOf(task).currentReview?.detail, "alpha done");
  assert.equal(env.mainCalls(), 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-persist-failed").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.logs.some((item) => item.event === "loop-plus-persist-failed"), true);
  env.host.reportAttempt(run.taskId ?? "", {
    subtaskId: "alpha",
    attemptId: env.attempts[0].request.attemptId,
    outcome: "failed",
    detail: "second event",
  });
  await flush();
  assert.equal(env.reports.length, 1);
  assert.equal(snapshotOf(env.tasks.get(run.taskId ?? "")).currentReview?.detail, "alpha done");
  assert.equal(env.mainCalls(), 1);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.equal(env.mains[1]?.request.kind, "review");
  assert.equal(env.mains[1]?.request.reviewEventId, buildLoopPlusFinishEventId("alpha", env.attempts[0].request.attemptId));
  assert.equal(env.attempts.length, 1);
  assert.equal(await isSettled(continued.done), false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.mainAiFailureCount ?? 0, 0);
});

test("keeps the persisted finish queue when refreshing an in-flight main prompt fails", async () => {
  let failRefresh = false;
  const env = harness({
    maxConcurrency: 2,
    beforeUpdateTask: (patch) => {
      const snapshot = patch.loopPlus as LoopPlusSchedulerSnapshot | undefined;
      if (snapshot?.reviewQueue.some((item) => item.subtaskId === "beta")) {
        failRefresh = true;
      }
    },
    beforeReadTask: () => {
      if (failRefresh) {
        failRefresh = false;
        throw new Error("refresh failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  beta.resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(task?.status, "running");
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(task).reviewQueue.map((item) => item.subtaskId), ["beta"]);
  assert.equal(env.mains.filter((item) => item.request.kind === "review").length, 1);
  assert.equal(env.logs.some((item) => item.event === "loop-plus-refresh-failed"), true);
  assert.equal(await isSettled(run.done), false);
  assert.equal(task?.mainAiFailureCount ?? 0, 0);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
});

test("releases the controller when loop plus completes and ignores late callbacks", async () => {
  const env = harness();
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  env.mains[1].resolve(decisionJson({
    status: "accept",
    reviewEventId: env.mains[1].request.reviewEventId,
    subtasks: [],
  }));
  await flush();
  const closeout = env.mains.find((item) => item.request.kind === "closeout");
  assert.ok(closeout);
  closeout.resolve(decisionJson({
    status: "completed",
    answerConclusion: "finished",
    finalSummary: "everything passed",
    acceptance: { passed: true, checks: [{ name: "scope", passed: true }] },
    requirementCoverage: [{ name: "scope", passed: true }],
  }));
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  assert.equal(stored()?.status, "completed");
  assert.equal(stored()?.finalSummary, "everything passed");
  assert.equal(snapshotOf(stored()).completed, true);
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.host.hasController(taskId), false);
  assert.equal(env.mainCalls(), 3);
  const updatedAt = stored()?.updatedAt;
  const reportsBefore = env.reports.length;
  env.host.reportAttempt(taskId, {
    subtaskId: "alpha",
    attemptId: env.attempts[0].request.attemptId,
    outcome: "failed",
    detail: "late callback",
  });
  await flush();
  assert.equal(env.host.hasController(taskId), false);
  assert.equal(stored()?.status, "completed");
  assert.equal(stored()?.finalSummary, "everything passed");
  assert.equal(stored()?.updatedAt, updatedAt);
  assert.equal(env.reports.length, reportsBefore);
  assert.equal(snapshotOf(stored()).completed, true);
  assert.equal(snapshotOf(stored()).reviewQueue.length, 0);
  assert.equal(snapshotOf(stored()).currentReview, null);
  const again = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(await isSettled(again.done), true);
  assert.equal(env.host.hasController(taskId), false);
  assert.equal(stored()?.status, "completed");
  assert.equal(stored()?.finalSummary, "everything passed");
  assert.equal(stored()?.updatedAt, updatedAt);
  assert.equal(env.mainCalls(), 3);
  assert.equal(env.attempts.length, 1);
  env.host.stopParent(taskId);
  assert.equal(stored()?.status, "completed");
  assert.equal(snapshotOf(stored()).completed, true);
});

test("parks a pending successor when report writing fails and starts it once after reload", async () => {
  const env = harness({
    maxConcurrency: 1,
    recordAttempt: (input) => {
      if (input.subtaskId === "alpha") {
        throw new Error("report failure");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha"]);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).running.map((item) => item.subtaskId), ["alpha"]);
  assert.deepEqual(snapshotOf(env.tasks.get(run.taskId ?? "")).pending.map((item) => item.subtaskId), ["beta"]);
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  const parkedId = snapshotOf(stored()).pending[0]?.attemptId ?? "";
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.mainCalls(), 1);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha"]);
  assert.equal(stored()?.status, "error");
  assert.match(stored()?.finalSummary ?? "", /report failure/);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  assert.equal(stored()?.currentRound ?? 0, 0);
  assert.deepEqual(stored()?.activeSubtaskIds, []);
  assert.equal(stored()?.subTasks.find((item) => item.id === "beta")?.status, "pending");
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.equal(snapshotOf(stored()).currentReview?.detail, "alpha done");
  assert.deepEqual(snapshotOf(stored()).running.map((item) => item.subtaskId), []);
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.equal(env.messages.filter((item) => item === "loop-plus-report-failed").length, 1);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
  assert.equal(env.reports.length, 0);

  const reloaded = env.reloadHost();
  const observed = reloaded.tryRun({ displayPrompt: "continue" }, env.target, { resumeTaskId: taskId });
  await flush();
  assert.equal(await isSettled(observed.done), true);
  assert.equal(reloaded.hasController(taskId), true);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha"]);
  assert.equal(stored()?.status, "error");
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.deepEqual(snapshotOf(stored()).running, []);

  const continued = reloaded.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(stored()?.status, "running");
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.mains[1]?.request.kind, "review");
  const alphaEventId = buildLoopPlusFinishEventId("alpha", env.attempts[0].request.attemptId);
  assert.equal(env.mains[1]?.request.reviewEventId, alphaEventId);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  assert.equal(env.attempts[1]?.request.attemptId, parkedId);
  assert.equal(await isSettled(continued.done), false);
  env.mains[1]?.resolve(decisionJson({
    status: "accept",
    reviewEventId: alphaEventId,
    subtasks: [],
  }));
  await flush();
  assert.equal(env.mainCalls(), 2);
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "beta").length, 1);
  env.attempts[1]?.resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  assert.equal(env.mainCalls(), 3);
  assert.equal(env.mains[2]?.request.kind, "review");
  assert.equal(env.mains[2]?.request.reviewEventId, buildLoopPlusFinishEventId("beta", parkedId));
  assert.equal(env.reports.filter((item) => item.subtaskId === "beta").length, 1);
  assert.equal(env.reports.filter((item) => item.subtaskId === "alpha").length, 0);
  assert.equal(env.attempts.length, 2);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  assert.equal(stored()?.currentRound ?? 0, 0);
});

test("parks a pending successor when persisting a finish fails", async () => {
  let persistFailures = 0;
  const env = harness({
    maxConcurrency: 1,
    beforeUpdateTask: (patch) => {
      const snapshot = patch.loopPlus as LoopPlusSchedulerSnapshot | undefined;
      if (
        persistFailures === 0
        && snapshot?.currentReview?.subtaskId === "alpha"
        && snapshot.running.some((item) => item.subtaskId === "beta")
      ) {
        persistFailures += 1;
        throw new Error("persist failed");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const task = env.tasks.get(run.taskId ?? "");
  assert.equal(persistFailures, 1);
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.mainCalls(), 1);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha"]);
  assert.equal(task?.status, "error");
  assert.match(task?.finalSummary ?? "", /persist failed/);
  assert.equal(task?.mainAiFailureCount ?? 0, 0);
  assert.deepEqual(task?.activeSubtaskIds, []);
  assert.equal(task?.subTasks.find((item) => item.id === "beta")?.status, "pending");
  assert.equal(snapshotOf(task).currentReview?.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(task).running, []);
  assert.deepEqual(snapshotOf(task).pending.map((item) => item.subtaskId), ["beta"]);
  assert.equal(env.messages.filter((item) => item === "loop-plus-completed").length, 0);
});

test("does not let a delayed reservation cross a needs-review pause", async () => {
  const gates: Array<() => void> = [];
  const env = harness({
    maxConcurrency: 2,
    launchDelayMs: (last) => last === null ? 0 : 1,
    delay: () => new Promise((resolve) => {
      gates.push(resolve);
    }),
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(gates.length, 1);
  const parkedId = snapshotOf(env.tasks.get(run.taskId ?? "")).running.find((item) => item.subtaskId === "beta")?.attemptId ?? "";
  assert.notEqual(parkedId, "");
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  review.resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "need a person" }));
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  assert.equal(await isSettled(run.done), true);
  assert.equal(stored()?.status, "needs-review");
  assert.equal(env.attempts.length, 1);
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.deepEqual(snapshotOf(stored()).running, []);
  gates.shift()?.();
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(stored()?.status, "needs-review");
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(gates.length, 1);
  gates.shift()?.();
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  assert.equal(env.attempts[1]?.request.attemptId, parkedId);
  assert.equal(stored()?.status, "running");
  const resumedReview = env.mains.filter((item) => item.request.kind === "review");
  assert.equal(resumedReview.length, 2);
  assert.equal(resumedReview[1]?.request.reviewEventId, review.request.reviewEventId);
  assert.equal(await isSettled(continued.done), false);
  resumedReview[1]?.resolve(decisionJson({
    status: "accept",
    reviewEventId: resumedReview[1]?.request.reviewEventId,
    subtasks: [],
  }));
  await flush();
  assert.equal(env.mains.filter((item) => item.request.reviewEventId === review.request.reviewEventId).length, 2);
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "beta").length, 1);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
});

test("does not start a paused reservation when continue races its launch delay", async () => {
  const gates: Array<() => void> = [];
  const env = harness({
    maxConcurrency: 2,
    launchDelayMs: (last) => last === null ? 0 : 1,
    delay: () => new Promise((resolve) => {
      gates.push(resolve);
    }),
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [subtask("alpha", ["src/alpha.ts"]), subtask("beta", ["src/beta.ts"])],
  }));
  await flush();
  const parkedId = snapshotOf(env.tasks.get(run.taskId ?? "")).running.find((item) => item.subtaskId === "beta")?.attemptId ?? "";
  env.attempts[0].resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const review = env.mains.find((item) => item.request.kind === "review");
  assert.ok(review);
  review.resolve(decisionJson({ status: "blocked", subtasks: [], finalSummary: "need a person" }));
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(gates.length, 1);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: run.taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.attempts.length, 1);
  for (let guard = 0; guard < 5 && gates.length > 0; guard += 1) {
    gates.shift()?.();
    await flush();
  }
  assert.equal(gates.length, 0);
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  assert.equal(env.attempts[1]?.request.attemptId, parkedId);
  assert.equal(env.mains.filter((item) => item.request.reviewEventId === review.request.reviewEventId).length, 2);
  assert.equal(await isSettled(continued.done), false);
  assert.equal(env.tasks.get(run.taskId ?? "")?.status, "running");
});

test("keeps an in-flight completion queued while paused without starting the successor", async () => {
  const env = harness({
    maxConcurrency: 2,
    recordAttempt: (input) => {
      if (input.subtaskId === "alpha") {
        throw new Error("report failure");
      }
    },
  });
  const run = env.host.tryRun({ displayPrompt: "ship the feature" }, env.target, { schedulingMode: "event_driven" });
  await flush();
  env.mains[0].resolve(decisionJson({
    status: "dispatch",
    subtasks: [
      subtask("alpha", ["src/alpha.ts"]),
      subtask("beta", ["src/beta.ts"]),
      subtask("gamma", ["src/gamma.ts"]),
    ],
  }));
  await flush();
  assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), ["alpha", "beta"]);
  const alpha = env.attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = env.attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  const taskId = run.taskId ?? "";
  const stored = () => env.tasks.get(taskId);
  const parkedId = snapshotOf(stored()).pending[0]?.attemptId ?? "";
  assert.equal(await isSettled(run.done), true);
  assert.equal(env.mainCalls(), 1);
  assert.equal(stored()?.status, "error");
  assert.deepEqual(snapshotOf(stored()).running.map((item) => item.subtaskId), ["beta"]);
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.equal(env.attempts.length, 2);
  beta.resolve({ outcome: "completed", detail: "beta done" });
  await flush();
  assert.equal(env.attempts.length, 2);
  assert.equal(env.mainCalls(), 1);
  assert.equal(stored()?.status, "error");
  assert.deepEqual(stored()?.activeSubtaskIds, []);
  assert.equal(stored()?.subTasks.find((item) => item.id === "gamma")?.status, "pending");
  assert.deepEqual(snapshotOf(stored()).running, []);
  assert.deepEqual(snapshotOf(stored()).pending.map((item) => item.attemptId), [parkedId]);
  assert.equal(snapshotOf(stored()).currentReview?.subtaskId, "alpha");
  assert.deepEqual(snapshotOf(stored()).reviewQueue.map((item) => item.subtaskId), ["beta"]);
  assert.equal(env.reports.filter((item) => item.subtaskId === "beta").length, 1);
  const continued = env.host.tryRun({ displayPrompt: "continue" }, env.target, {
    resumeTaskId: taskId,
    resumeRequested: true,
  });
  await flush();
  assert.equal(env.attempts.filter((item) => item.request.attemptId === parkedId).length, 1);
  assert.equal(env.attempts.length, 3);
  const alphaEventId = buildLoopPlusFinishEventId("alpha", alpha.request.attemptId);
  assert.equal(env.mains[1]?.request.reviewEventId, alphaEventId);
  env.mains[1]?.resolve(decisionJson({
    status: "accept",
    reviewEventId: alphaEventId,
    subtasks: [],
  }));
  await flush();
  const betaEventId = buildLoopPlusFinishEventId("beta", beta.request.attemptId);
  assert.equal(env.mains[2]?.request.reviewEventId, betaEventId);
  assert.equal(env.mains.filter((item) => item.request.reviewEventId === alphaEventId).length, 1);
  env.mains[2]?.resolve(decisionJson({
    status: "accept",
    reviewEventId: betaEventId,
    subtasks: [],
  }));
  await flush();
  assert.equal(env.mains.filter((item) => item.request.reviewEventId === betaEventId).length, 1);
  const gamma = env.attempts.find((item) => item.request.attemptId === parkedId);
  assert.ok(gamma);
  gamma.resolve({ outcome: "completed", detail: "gamma done" });
  await flush();
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "gamma").length, 1);
  assert.equal(env.reports.filter((item) => item.subtaskId === "gamma").length, 1);
  assert.equal(env.mains.filter((item) => item.request.reviewEventId === buildLoopPlusFinishEventId("gamma", parkedId)).length, 1);
  assert.equal(await isSettled(continued.done), false);
  assert.equal(stored()?.mainAiFailureCount ?? 0, 0);
  assert.equal(stored()?.status, "running");
});
