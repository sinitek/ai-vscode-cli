import test = require("node:test");
import assert = require("node:assert/strict");
import { readFileSync } from "fs";
import { join } from "path";

import {
  LOOP_PLUS_DECISION_STATUSES,
  type LoopPlusDecision,
  type LoopPlusDecisionStatus,
} from "../../loopPlusDecision";
import type { LoopSubtaskDecision } from "../../loopTaskStore";
import type { LoopPlusDispatchResult } from "../../loopPlusScheduler";
import {
  confirmedLoopPlusReviewIds,
  createLoopPlusDecisionStrategyRegistry,
  loopPlusDecisionStrategyFor,
  sameLoopPlusReviewIds,
  type LoopPlusDecisionControlPlan,
  type LoopPlusDecisionInFlightView,
  type LoopPlusDecisionOutcome,
  type LoopPlusDecisionQueueView,
  type LoopPlusDecisionStepView,
  type LoopPlusDecisionStrategy,
  type LoopPlusDecisionStrategyPort,
} from "../../extensionHost/loopPlusDecisionStrategies";

import { withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";

const subtask: LoopSubtaskDecision = {
  id: "child-1",
  title: "Document the decision strategy boundary",
  prompt: "Keep scheduler transitions behind the host port and preserve FIFO review checks.".padEnd(80, "."),
};

const closeControl = { id: "child-1", action: "close" as const };
const repromptControl = {
  id: "child-1",
  action: "reprompt" as const,
  title: "修正子任务实现",
  prompt: "Continue from the reviewed diff without opening a second confirmation path.".padEnd(80, "."),
};

type RecordedCall = { name: string; args: unknown[] };

type MainFailureState = {
  protocolRetries: number;
  mainAiFailureCount: number;
  mainAiFailureLimitReached: boolean;
};

function view(overrides: Partial<LoopPlusDecisionQueueView> = {}): LoopPlusDecisionQueueView {
  return {
    hasCurrentReview: false,
    hasReview: false,
    hasReports: false,
    hasUserMessages: false,
    runningCount: 0,
    pendingCount: 0,
    parentStopped: false,
    ...overrides,
  };
}

function decisionStep(overrides: Partial<LoopPlusDecisionStepView> = {}): LoopPlusDecisionStepView {
  return {
    kind: "initial",
    eventId: null,
    eventIds: [],
    userMessageCount: 0,
    ...overrides,
  };
}

function decision(status: LoopPlusDecisionStatus, extra: Partial<LoopPlusDecision> = {}): LoopPlusDecision {
  return withLoopPlusAcceptReviews({
    status,
    ...(status === "accept" && extra.progressPercent === undefined ? { progressPercent: 23 } : {}),
    ...extra,
  });
}

function names(calls: readonly RecordedCall[]): string[] {
  return calls.map((call) => call.name);
}

function createPort(options: {
  views?: LoopPlusDecisionQueueView[];
  inFlight?: LoopPlusDecisionInFlightView[];
  controlsApplied?: boolean;
  controlPlan?: LoopPlusDecisionControlPlan | null;
  preview?: boolean;
  commit?: boolean;
  submitOk?: boolean;
  tryFinish?: boolean;
  protocolMiss?: LoopPlusDecisionOutcome;
  finish?: LoopPlusDecisionOutcome;
  recordPromote?: boolean;
  dispatchResult?: Pick<LoopPlusDispatchResult, "decisions" | "rejected">;
  failure?: Partial<MainFailureState>;
} = {}) {
  const calls: RecordedCall[] = [];
  const failure: MainFailureState = {
    protocolRetries: options.failure?.protocolRetries ?? 0,
    mainAiFailureCount: options.failure?.mainAiFailureCount ?? 0,
    mainAiFailureLimitReached: options.failure?.mainAiFailureLimitReached ?? false,
  };
  const views = options.views ?? [view()];
  const inFlight = options.inFlight ?? [{ runningCount: 0, pendingCount: 0 }];
  let viewIndex = 0;
  let inFlightIndex = 0;
  const record = (name: string, args: unknown[] = []) => {
    calls.push({ name, args });
  };
  const next = <T>(items: readonly T[], index: number): T => items[Math.min(index, items.length - 1)];
  const defaultPlan = { sealed: true } as unknown as LoopPlusDecisionControlPlan;
  const controlPlan = options.controlPlan === undefined ? defaultPlan : options.controlPlan;
  const port: LoopPlusDecisionStrategyPort = {
    promoteDecisionWork() {
      if (options.recordPromote) record("promoteDecisionWork");
    },
    queueView() {
      const value = next(views, viewIndex);
      viewIndex += 1;
      record("queueView");
      return value;
    },
    waitForInFlightWork() {
      const value = next(inFlight, inFlightIndex);
      inFlightIndex += 1;
      record("waitForInFlightWork");
      return value;
    },
    protocolMiss(held, reason, diagnostic) {
      record("protocolMiss", [held, ...(reason === undefined ? [] : [reason]), ...(diagnostic ? [diagnostic] : [])]);
      return options.protocolMiss ?? "continue";
    },
    markDecisionAccepted() {
      record("markDecisionAccepted");
      failure.protocolRetries = 0;
      failure.mainAiFailureCount = 0;
      failure.mainAiFailureLimitReached = false;
    },
    clearProtocolFailure() {
      record("clearProtocolFailure");
      failure.protocolRetries = 0;
    },
    acknowledgeUserMessages(count) {
      record("acknowledgeUserMessages", [count]);
    },
    acknowledgeReports(eventIds) {
      record("acknowledgeReports", [eventIds]);
      return true;
    },
    captureRemainingUserMessagesForHeldReview() {
      record("captureRemainingUserMessagesForHeldReview");
    },
    applyControls(controls) {
      record("applyControls", [controls]);
      return options.controlsApplied ?? true;
    },
    planControls(controls) {
      record("planControls", [controls]);
      return controlPlan;
    },
    previewControls(plan) {
      record("previewControls", [plan]);
      return options.preview === false ? "控制预检失败" : null;
    },
    commitControls(controls, plan) {
      record("commitControls", [controls, plan]);
      return options.commit === false ? "控制提交失败" : null;
    },
    dispatchSubtasks(subtasks, plan) {
      record("dispatchSubtasks", plan ? [subtasks, plan] : [subtasks]);
      if (plan && options.commit === false) return { controlFailure: "控制提交失败", decisions: [], rejected: [] };
      return options.dispatchResult ?? { decisions: [], rejected: [] };
    },
    submitReviewBatch(eventIds, acceptance) {
      record("submitReviewBatch", [eventIds, acceptance]);
      return { ok: options.submitOk ?? true };
    },
    requeueCurrentReview() {
      record("requeueCurrentReview");
    },
    persistRunning() {
      record("persistRunning");
    },
    persistSnapshot() {
      record("persistSnapshot");
    },
    applyNextStepPlan(value) {
      record("applyNextStepPlan", [value]);
    },
    persistEstimatedRounds(value) {
      record("persistEstimatedRounds", [value.estimatedRemainingRounds]);
    },
    persistProgressPercent(value) {
      record("persistProgressPercent", [value.progressPercent]);
    },
    noteWaiting(runningCount) {
      record("noteWaiting", [runningCount]);
    },
    pauseForReview(message, summary) {
      record("pauseForReview", summary === undefined ? [message] : [message, summary]);
    },
    armCloseout() {
      record("armCloseout");
    },
    tryFinishParent() {
      record("tryFinishParent");
      return options.tryFinish ?? true;
    },
    finishParent(value) {
      record("finishParent", [value.status]);
      return options.finish ?? "stop";
    },
  };
  return { port, calls, failure };
}

test("registry routes every decision status to a distinct strategy", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const again = createLoopPlusDecisionStrategyRegistry();
  assert.deepEqual(Object.keys(registry), [...LOOP_PLUS_DECISION_STATUSES]);
  assert.notEqual(registry, again);
  const seen = new Set<LoopPlusDecisionStrategy>();
  for (const status of LOOP_PLUS_DECISION_STATUSES) {
    const strategy = loopPlusDecisionStrategyFor(status, registry);
    assert.equal(strategy, registry[status]);
    assert.equal(strategy, again[status]);
    assert.equal(loopPlusDecisionStrategyFor(status), strategy);
    seen.add(strategy);
  }
  assert.equal(seen.size, LOOP_PLUS_DECISION_STATUSES.length);
  const replacement = () => "stop" as const;
  assert.equal(loopPlusDecisionStrategyFor("dispatch", { ...registry, dispatch: replacement }), replacement);
  assert.throws(
    () => loopPlusDecisionStrategyFor("bogus" as LoopPlusDecisionStatus),
    /unhandled loop-plus decision status: bogus/,
  );
});

test("review id helpers keep FIFO order", () => {
  assert.deepEqual(confirmedLoopPlusReviewIds(decision("accept")), []);
  assert.deepEqual(confirmedLoopPlusReviewIds(decision("accept", { reviewEventId: "only" })), ["only"]);
  assert.deepEqual(confirmedLoopPlusReviewIds(decision("accept", {
    reviewEventId: "ignored",
    reviewEventIds: ["first", "second"],
  })), ["first", "second"]);
  assert.equal(sameLoopPlusReviewIds(["first", "second"], ["first", "second"]), true);
  assert.equal(sameLoopPlusReviewIds(["first", "second"], ["second", "first"]), false);
  assert.equal(sameLoopPlusReviewIds(["first"], ["first", "second"]), false);
});

test("strategy module stays free of runtime, deps, and scheduler value imports", () => {
  const source = readFileSync(join(__dirname, "../../../src/extensionHost/loopPlusDecisionStrategies.ts"), "utf8");
  assert.match(source, /import type \{[^}]*LoopPlusDispatchResult[^}]*\} from "..\/loopPlusScheduler"/);
  assert.doesNotMatch(source, /import(?! type)[^;]*from "..\/loopPlusScheduler"/);
  for (const forbidden of [
    "ParentRuntime",
    "LoopPlusOrchestrationDeps",
    "createLoopPlusScheduler",
    "waitForLoopPlusClarification",
    "waitForOrchestratorClarification",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("host keeps the review gate and routes strategies through the registry", () => {
  const source = readFileSync(join(__dirname, "../../../src/extensionHost/loopPlusOrchestration.ts"), "utf8");
  for (const removed of [
    "function applyDispatchDecision",
    "function applyAcceptDecision",
    "function applyWaitDecision",
    "function applySteerDecision",
    "function applyBlockedDecision",
    "function applyCompleted",
    "function applyClarifyDecision",
  ]) {
    assert.equal(source.includes(removed), false, removed);
  }
  assert.match(source, /createLoopPlusDecisionStrategyRegistry\(/);
  assert.match(source, /loopPlusDecisionStrategyFor\(/);
  assert.match(source, /createDecisionPort\(/);
  assert.match(source, /heldBatchIntact\(/);
  assert.match(source, /waitForLoopPlusClarification\(/);
  assert.match(source, /decision\?\.status === "clarify"/);
});

test("clarify strategy does not touch the port or clarification flow", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const port = new Proxy({}, {
    get() {
      throw new Error("clarify strategy used the port");
    },
  }) as LoopPlusDecisionStrategyPort;
  assert.equal(registry.clarify(port, decisionStep(), decision("clarify", {
    finalSummary: "need a choice",
  })), "stop");
});

test("dispatch refuses a held review before controls or launch", () => {
  const { port, calls } = createPort({ views: [view({ hasCurrentReview: true })] });
  const outcome = createLoopPlusDecisionStrategyRegistry().dispatch(
    port,
    decisionStep(),
    decision("dispatch", { subtasks: [subtask], controls: [closeControl] }),
  );
  assert.equal(outcome, "continue");
  assert.deepEqual(names(calls), ["queueView", "protocolMiss"]);
  assert.equal((calls[1].args[1] as { reasonCode: string }).reasonCode, "state.review_batch_open.dispatch_forbidden");
});

test("dispatch reports a control miss without launching subtasks", () => {
  const { port, calls } = createPort({ preview: false });
  const outcome = createLoopPlusDecisionStrategyRegistry().dispatch(
    port,
    decisionStep(),
    decision("dispatch", { subtasks: [subtask], controls: [closeControl] }),
  );
  assert.equal(outcome, "continue");
  assert.deepEqual(names(calls), ["queueView", "planControls", "previewControls", "protocolMiss"]);
  assert.equal((calls.at(-1)?.args[1] as { reasonCode: string }).reasonCode, "state.controls.unavailable");
});

test("dispatch waits on in-flight work and does not submit review or finish", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const { port, calls } = createPort({
    views: [view(), view(), view({ runningCount: 2, pendingCount: 1 })],
  });
  const outcome = registry.dispatch(
    port,
    decisionStep({ userMessageCount: 1 }),
    decision("dispatch", {
      subtasks: [subtask],
      controls: [closeControl],
      estimatedRemainingRounds: 4,
    }),
  );
  assert.equal(outcome, "wait");
  assert.deepEqual(names(calls), [
    "queueView",
    "planControls",
    "previewControls",
    "acknowledgeUserMessages",
    "dispatchSubtasks",
    "persistEstimatedRounds",
    "markDecisionAccepted",
    "applyNextStepPlan",
    "waitForInFlightWork",
    "queueView",
    "queueView",
  ]);
  assert.deepEqual(calls.find((c) => c.name === "acknowledgeUserMessages")?.args, [1]);
  assert.deepEqual(calls.find((c) => c.name === "dispatchSubtasks")?.args, [[subtask], calls.find((c) => c.name === "previewControls")?.args[0]]);
  assert.deepEqual(calls.find((c) => c.name === "persistEstimatedRounds")?.args, [4]);
  assert.equal(names(calls).includes("submitReviewBatch"), false);
  assert.equal(names(calls).includes("waitForInFlightWork"), true);
  assert.equal(names(calls).includes("planControls"), true);
  assert.equal(names(calls).includes("tryFinishParent"), false);
});

test("dispatch continues when review or a user message arrives after an empty launch", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const reviewed = createPort({ views: [view(), view({ hasReview: true })] });
  assert.equal(registry.dispatch(reviewed.port, decisionStep(), decision("dispatch", { subtasks: [subtask] })), "continue");
  assert.equal(names(reviewed.calls).includes("pauseForReview"), false);

  const queued = createPort({
    views: [view(), view(), view(), view({ hasUserMessages: true })],
  });
  assert.equal(registry.dispatch(queued.port, decisionStep(), decision("dispatch", { subtasks: [subtask] })), "continue");
  assert.equal(names(queued.calls).includes("pauseForReview"), false);
  assert.equal(names(queued.calls).at(-1), "queueView");
});

test("dispatch pauses only when the launch leaves no work and no user message", () => {
  const { port, calls } = createPort({
    views: [view(), view(), view(), view()],
  });
  const outcome = createLoopPlusDecisionStrategyRegistry().dispatch(
    port,
    decisionStep(),
    decision("dispatch", { subtasks: [subtask] }),
  );
  assert.equal(outcome, "stop");
  assert.equal(names(calls).at(-1), "pauseForReview");
  assert.deepEqual(calls.at(-1)?.args, ["loop-plus-no-work"]);
  assert.equal(names(calls).includes("armCloseout"), false);
});

test("steer rejects an open review, empty controls, and failed controls", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const held = createPort({ views: [view({ hasCurrentReview: true })] });
  assert.equal(registry.steer(held.port, decisionStep(), decision("steer", { controls: [closeControl] })), "continue");
  assert.equal((held.calls[1].args[1] as { reasonCode: string }).reasonCode, "state.review_batch_open.steer_forbidden");

  const empty = createPort();
  assert.equal(registry.steer(empty.port, decisionStep(), decision("steer")), "continue");
  assert.deepEqual(names(empty.calls), ["queueView", "protocolMiss"]);
  assert.deepEqual(empty.calls[1].args, [false]);

  const rejected = createPort({ preview: false });
  assert.equal(registry.steer(rejected.port, decisionStep(), decision("steer", { controls: [closeControl] })), "continue");
  assert.deepEqual(names(rejected.calls).at(-1), "protocolMiss");
  assert.equal(names(rejected.calls).includes("dispatchSubtasks"), false);
});

test("steer waits, continues into review, or arms closeout without dispatching", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const running = createPort({
    views: [view(), view(), view({ runningCount: 1 })],
  });
  assert.equal(registry.steer(running.port, decisionStep(), decision("steer", { controls: [closeControl] })), "wait");
  assert.deepEqual(names(running.calls).at(-1), "queueView");
  assert.equal(names(running.calls).includes("persistRunning"), false);
  assert.equal(names(running.calls).includes("dispatchSubtasks"), false);
  assert.equal(names(running.calls).includes("waitForInFlightWork"), true);

  const review = createPort({ views: [view(), view({ hasReview: true })] });
  assert.equal(registry.steer(review.port, decisionStep(), decision("steer", { controls: [closeControl] })), "continue");
  assert.equal(names(review.calls).includes("armCloseout"), false);

  const user = createPort({ views: [view(), view(), view(), view({ hasUserMessages: true })] });
  assert.equal(registry.steer(user.port, decisionStep(), decision("steer", { controls: [closeControl] })), "continue");
  assert.equal(names(user.calls).includes("armCloseout"), false);

  const idle = createPort({ views: [view(), view(), view(), view()] });
  assert.equal(registry.steer(idle.port, decisionStep(), decision("steer", { controls: [closeControl] })), "continue");
  assert.equal(names(idle.calls).at(-1), "armCloseout");
  assert.equal(names(idle.calls).includes("pauseForReview"), false);
});

test("accept misses unless the step is the same FIFO review batch", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const notReview = createPort();
  assert.equal(registry.accept(
    notReview.port,
    decisionStep({ kind: "continue", eventIds: ["evt-1"] }),
    decision("accept", { reviewEventId: "evt-1" }),
  ), "continue");
  assert.equal((notReview.calls[0].args[1] as { reasonCode: string }).reasonCode, "state.review_batch.mismatch");

  const empty = createPort();
  assert.equal(registry.accept(
    empty.port,
    decisionStep({ kind: "user" }),
    decision("accept"),
  ), "continue");
  assert.equal((empty.calls[0].args[1] as { reasonCode: string }).reasonCode, "state.review_batch.mismatch");

  const reversed = createPort();
  assert.equal(registry.accept(
    reversed.port,
    decisionStep({ kind: "review", eventId: "evt-2", eventIds: ["evt-2", "evt-1"] }),
    decision("accept", { reviewEventIds: ["evt-1", "evt-2"] }),
  ), "continue");
  assert.deepEqual(names(reversed.calls), ["protocolMiss"]);
  assert.equal(names(reversed.calls).includes("submitReviewBatch"), false);
});

test("host-state refusals expose stable codes without including snapshot identifiers", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const openBatch = createPort({ views: [view({ hasCurrentReview: true })] });
  assert.equal(registry.dispatch(openBatch.port, decisionStep(), decision("dispatch", { subtasks: [subtask] })), "continue");
  const dispatchDiagnostic = openBatch.calls.find((call) => call.name === "protocolMiss")?.args[1] as { reasonCode?: string };
  assert.equal(dispatchDiagnostic.reasonCode, "state.review_batch_open.dispatch_forbidden");
  assert.doesNotMatch(JSON.stringify(dispatchDiagnostic), /evt-|child-1/);
  assert.equal(names(openBatch.calls).includes("dispatchSubtasks"), false);

  const idle = createPort({ views: [view()] });
  assert.equal(registry.wait(idle.port, decisionStep(), decision("wait")), "continue");
  const waitDiagnostic = idle.calls.find((call) => call.name === "protocolMiss")?.args[1] as { reasonCode?: string };
  assert.equal(waitDiagnostic.reasonCode, "state.wait.no_work");
  assert.equal(names(idle.calls).includes("acknowledgeReports"), false);
});

test("accept previews controls before submit and does not commit a rejected plan", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const missing = createPort({ controlPlan: null });
  assert.equal(registry.accept(
    missing.port,
    decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] }),
    decision("accept", { reviewEventId: "evt-1", controls: [repromptControl] }),
  ), "continue");
  assert.deepEqual(names(missing.calls), ["planControls", "protocolMiss"]);
  assert.equal((missing.calls.at(-1)?.args[1] as { reasonCode: string }).reasonCode, "state.controls.unavailable");

  const rejected = createPort({ preview: false });
  assert.equal(registry.accept(
    rejected.port,
    decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] }),
    decision("accept", { reviewEventId: "evt-1", controls: [closeControl] }),
  ), "continue");
  assert.deepEqual(names(rejected.calls), [
    "planControls",
    "previewControls",
    "protocolMiss",
  ]);
  assert.equal(names(rejected.calls).includes("submitReviewBatch"), false);
  assert.equal(names(rejected.calls).includes("applyControls"), false);
});

test("accept preserves the queue when submit fails and distinguishes a stopped parent", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1", "evt-2"] });
  const stopped = createPort({
    submitOk: false,
    views: [view({ parentStopped: true })],
  });
  assert.equal(registry.accept(stopped.port, step, decision("accept", { reviewEventIds: ["evt-1", "evt-2"] })), "stop");
  assert.deepEqual(names(stopped.calls), ["submitReviewBatch", "persistSnapshot", "queueView"]);
  assert.equal(names(stopped.calls).includes("protocolMiss"), false);

  const retry = createPort({ submitOk: false, views: [view()] });
  assert.equal(registry.accept(retry.port, step, decision("accept", { reviewEventIds: ["evt-1", "evt-2"] })), "continue");
  assert.deepEqual(names(retry.calls).slice(-2), ["queueView", "protocolMiss"]);
  assert.deepEqual(retry.calls.at(-1)?.args, [true]);
});

test("accept rejects a batch whose reviews do not label every event", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1", "evt-2"] });
  const missing = createPort();
  assert.equal(registry.accept(missing.port, step, decision("accept", {
    reviewEventIds: ["evt-1", "evt-2"],
    reviews: [],
  })), "continue");
  assert.equal((missing.calls[0].args[1] as { reasonCode: string }).reasonCode, "validation.accept.invalid_reviews");

  const reversed = createPort();
  assert.equal(registry.accept(reversed.port, step, decision("accept", {
    reviewEventIds: ["evt-1", "evt-2"],
    reviews: [
      { reviewEventId: "evt-2", acceptance: "failed" },
      { reviewEventId: "evt-1", acceptance: "passed" },
    ],
  })), "continue");
  assert.equal((reversed.calls[0].args[1] as { reasonCode: string }).reasonCode, "validation.accept.invalid_reviews");

  const passedWithSubtask = createPort();
  assert.equal(registry.accept(
    passedWithSubtask.port,
    decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] }),
    decision("accept", {
      reviewEventId: "evt-1",
      reviews: [{ reviewEventId: "evt-1", acceptance: "passed", subtaskIds: ["child-1"] }],
      subtasks: [subtask],
    }),
  ), "continue");
  assert.deepEqual(
    passedWithSubtask.calls.find((call) => call.name === "submitReviewBatch")?.args,
    [["evt-1"], [{ eventId: "evt-1", acceptance: "passed" }]],
  );
  assert.equal(passedWithSubtask.calls.some((call) => call.name === "dispatchSubtasks"), true);
});

test("accept marks a follow-up batch failed and commits controls only after submit", () => {
  const plan = { sealed: "accept-plan" } as unknown as LoopPlusDecisionControlPlan;
  const { port, calls } = createPort({
    controlPlan: plan,
    views: [view({ hasReview: true })],
  });
  const outcome = createLoopPlusDecisionStrategyRegistry().accept(
    port,
    decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"], userMessageCount: 3 }),
    decision("accept", {
      reviewEventId: "evt-1",
      reviews: [{ reviewEventId: "evt-1", acceptance: "failed", noRepairReason: "已确认无需返工" }],
      subtasks: [subtask],
      controls: [closeControl],
      estimatedRemainingRounds: 2,
    }),
  );
  assert.equal(outcome, "continue");
  assert.deepEqual(names(calls), [
    "planControls",
    "previewControls",
    "submitReviewBatch",
    "acknowledgeUserMessages",
    "persistProgressPercent",
    "dispatchSubtasks",
    "persistEstimatedRounds",
    "markDecisionAccepted",
    "applyNextStepPlan",
    "waitForInFlightWork",
    "queueView",
  ]);
  assert.deepEqual(calls.find((call) => call.name === "submitReviewBatch")?.args, [["evt-1"], [{ eventId: "evt-1", acceptance: "failed", noRepairReason: "已确认无需返工" }]]);
  assert.deepEqual(calls.find((call) => call.name === "persistProgressPercent")?.args, [23]);
  assert.deepEqual(calls.find((call) => call.name === "persistEstimatedRounds")?.args, [2]);
  assert.deepEqual(calls.find((call) => call.name === "dispatchSubtasks")?.args, [[subtask], plan]);
  assert.equal(names(calls).includes("applyControls"), false);
  assert.equal(names(calls).includes("waitForInFlightWork"), true);
});

test("accept keeps an already submitted batch when controls fail", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] });
  const rejected = createPort({ commit: false, controlPlan: { sealed: "later" } as unknown as LoopPlusDecisionControlPlan });
  assert.equal(registry.accept(rejected.port, step, decision("accept", {
    reviewEventId: "evt-1",
    controls: [closeControl],
  })), "continue");
  assert.equal(names(rejected.calls).at(-1), "protocolMiss");
  assert.deepEqual(rejected.calls.at(-1)?.args, [false, "控制提交失败"]);
  assert.deepEqual(rejected.calls.find(call => call.name === "dispatchSubtasks")?.args[0], []);
  assert.equal(names(rejected.calls).includes("submitReviewBatch"), true);
});

test("accept waits on the scheduler view and arms closeout only when that view is idle", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] });
  const accepted = decision("accept", { reviewEventId: "evt-1" });
  const busy = createPort({
    views: [view({ runningCount: 0 })],
    inFlight: [{ runningCount: 1, pendingCount: 0 }],
  });
  assert.equal(registry.accept(busy.port, step, accepted), "wait");
  assert.deepEqual(names(busy.calls).slice(-3), ["waitForInFlightWork", "queueView", "persistRunning"]);
  assert.deepEqual(busy.calls.find((call) => call.name === "submitReviewBatch")?.args, [["evt-1"], [{ eventId: "evt-1", acceptance: "passed" }]]);
  assert.equal(names(busy.calls).includes("armCloseout"), false);

  const idle = createPort({
    views: [view({ runningCount: 4, pendingCount: 3 })],
    inFlight: [{ runningCount: 0, pendingCount: 0 }],
  });
  assert.equal(registry.accept(idle.port, step, accepted), "continue");
  assert.equal(names(idle.calls).at(-1), "armCloseout");
  assert.equal(names(idle.calls).includes("persistRunning"), false);
  assert.equal(names(idle.calls).includes("pauseForReview"), false);
});

test("wait uses the post-ack admission view for in-flight work and a later read for messages", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const held = createPort({ views: [view({ hasCurrentReview: true, runningCount: 3 })] });
  assert.equal(registry.wait(held.port, decisionStep({ userMessageCount: 2 }), decision("wait")), "continue");
  assert.deepEqual(names(held.calls), ["queueView", "protocolMiss"]);

  const review = createPort({ views: [view({ runningCount: 1 }), view({ hasReview: true })] });
  assert.equal(registry.wait(review.port, decisionStep(), decision("wait")), "continue");
  assert.deepEqual(names(review.calls), ["queueView", "acknowledgeUserMessages", "queueView"]);
  assert.equal(names(review.calls).includes("markDecisionAccepted"), false);

  const running = createPort({
    views: [view({ runningCount: 4, pendingCount: 1 }), view({ runningCount: 0 })],
    inFlight: [{ runningCount: 3, pendingCount: 1 }],
  });
  assert.equal(registry.wait(running.port, decisionStep({ userMessageCount: 2 }), decision("wait")), "wait");
  assert.deepEqual(names(running.calls), [
    "queueView",
    "acknowledgeUserMessages",
    "queueView",
    "waitForInFlightWork",
    "markDecisionAccepted",
    "applyNextStepPlan",
    "persistRunning",
    "noteWaiting",
  ]);
  assert.deepEqual(running.calls.at(-1)?.args, [3]);

  const idleMessage = createPort({
    views: [view({ hasUserMessages: false }), view(), view({ hasUserMessages: true })],
  });
  assert.equal(registry.wait(idleMessage.port, decisionStep(), decision("wait")), "continue");
  assert.equal(names(idleMessage.calls).includes("pauseForReview"), false);
  assert.equal(names(idleMessage.calls).includes("markDecisionAccepted"), false);
  assert.equal(names(idleMessage.calls).includes("acknowledgeUserMessages"), false);

  const idle = createPort({
    views: [view({ hasUserMessages: true }), view(), view({ hasUserMessages: false })],
  });
  assert.equal(registry.wait(idle.port, decisionStep(), decision("wait")), "continue");
  assert.equal((idle.calls.at(-1)?.args[1] as { reasonCode: string }).reasonCode, "state.wait.no_work");
  assert.equal(names(idle.calls).includes("markDecisionAccepted"), false);
  assert.equal(names(idle.calls).includes("acknowledgeUserMessages"), false);
  assert.equal(names(idle.calls).includes("persistRunning"), false);
  assert.equal(names(idle.calls).includes("submitReviewBatch"), false);
});

test("blocked requeues a held review and does not reset the main failure state", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const held = createPort({
    views: [view({ hasCurrentReview: true }), view()],
  });
  assert.equal(registry.blocked(held.port, decisionStep({ userMessageCount: 1 }), decision("blocked", {
    finalSummary: "needs a product choice",
  })), "stop");
  assert.deepEqual(names(held.calls), [
    "queueView",
    "requeueCurrentReview",
    "acknowledgeUserMessages",
    "clearProtocolFailure",
    "queueView",
    "applyNextStepPlan",
    "pauseForReview",
  ]);
  assert.deepEqual(held.calls.at(-1)?.args, ["loop-plus-blocked", "needs a product choice"]);
  assert.equal(names(held.calls).includes("markDecisionAccepted"), false);

  const queued = createPort({ views: [view(), view({ hasUserMessages: true })] });
  assert.equal(registry.blocked(queued.port, decisionStep(), decision("blocked")), "continue");
  assert.equal(names(queued.calls).includes("captureRemainingUserMessagesForHeldReview"), true);
  assert.equal(names(queued.calls).includes("requeueCurrentReview"), false);
  assert.equal(names(queued.calls).includes("pauseForReview"), false);
  assert.equal(names(queued.calls).includes("dispatchSubtasks"), false);
});

test("completed misses mismatched or unexpected event ids before submit", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const reversed = createPort();
  assert.equal(registry.completed(
    reversed.port,
    decisionStep({ kind: "review", eventIds: ["evt-1", "evt-2"] }),
    decision("completed", { reviewEventIds: ["evt-2", "evt-1"] }),
  ), "continue");
  assert.equal((reversed.calls[0].args[1] as { reasonCode: string }).reasonCode, "state.review_batch.mismatch");

  const unexpected = createPort();
  assert.equal(registry.completed(
    unexpected.port,
    decisionStep(),
    decision("completed", { reviewEventId: "evt-1" }),
  ), "continue");
  assert.equal((unexpected.calls[0].args[1] as { reasonCode: string }).reasonCode, "state.review_batch.mismatch");
});

test("completed stops after a failed submit without asking whether the parent stopped", () => {
  const { port, calls } = createPort({ submitOk: false, views: [view({ parentStopped: false })] });
  const outcome = createLoopPlusDecisionStrategyRegistry().completed(
    port,
    decisionStep({ kind: "review", eventIds: ["evt-1", "evt-2"] }),
    decision("completed", { reviewEventIds: ["evt-1", "evt-2"] }),
  );
  assert.equal(outcome, "stop");
  assert.deepEqual(names(calls), ["submitReviewBatch", "persistSnapshot"]);
  assert.deepEqual(calls.find((call) => call.name === "submitReviewBatch")?.args, [["evt-1", "evt-2"], "passed"]);
  assert.equal(names(calls).includes("protocolMiss"), false);
  assert.equal(names(calls).includes("queueView"), false);
});

test("completed keeps running work instead of finishing the parent", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "review", eventIds: ["evt-1"], userMessageCount: 1 });
  const accepted = decision("completed", { reviewEventId: "evt-1", subtasks: [subtask] });
  const review = createPort({ views: [view({ hasReview: true }), view({ hasReview: true })] });
  assert.equal(registry.completed(review.port, step, accepted), "continue");
  assert.deepEqual(names(review.calls).slice(-3), ["markDecisionAccepted", "applyNextStepPlan", "queueView"]);
  assert.equal(names(review.calls).includes("tryFinishParent"), false);
  assert.equal(names(review.calls).includes("dispatchSubtasks"), false);
  assert.equal(names(review.calls).includes("clearProtocolFailure"), false);

  const running = createPort({
    views: [view({ runningCount: 1 }), view()],
  });
  assert.equal(registry.completed(running.port, step, accepted), "wait");
  assert.deepEqual(names(running.calls).slice(-4), ["markDecisionAccepted", "applyNextStepPlan", "queueView", "persistRunning"]);
  assert.equal(names(running.calls).includes("clearProtocolFailure"), false);
  assert.equal(names(running.calls).includes("finishParent"), false);

  const message = createPort({
    views: [view({ hasUserMessages: true }), view({ hasUserMessages: true })],
  });
  assert.equal(registry.completed(message.port, step, accepted), "continue");
  assert.equal(names(message.calls).includes("markDecisionAccepted"), true);
  assert.equal(names(message.calls).includes("persistRunning"), false);
});

test("completed clears main failure after a passed review while work remains", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "review", eventIds: ["evt-1", "evt-2"] });
  const accepted = decision("completed", { reviewEventIds: ["evt-1", "evt-2"] });

  const running = createPort({
    views: [view({ runningCount: 1, pendingCount: 2 }), view()],
    failure: { protocolRetries: 3, mainAiFailureCount: 4, mainAiFailureLimitReached: false },
  });
  assert.equal(registry.completed(running.port, step, accepted), "wait");
  assert.equal(running.failure.protocolRetries, 0);
  assert.equal(running.failure.mainAiFailureCount, 0);
  assert.equal(running.failure.mainAiFailureLimitReached, false);
  assert.deepEqual(running.calls.find((call) => call.name === "submitReviewBatch")?.args, [["evt-1", "evt-2"], "passed"]);
  assert.equal(names(running.calls).includes("markDecisionAccepted"), true);
  assert.equal(names(running.calls).includes("clearProtocolFailure"), false);
  assert.equal(names(running.calls).includes("tryFinishParent"), false);
  assert.equal(names(running.calls).includes("finishParent"), false);
  assert.equal(names(running.calls).includes("dispatchSubtasks"), false);

  const pending = createPort({
    views: [view({ pendingCount: 1 }), view()],
    failure: { protocolRetries: 1, mainAiFailureCount: 0, mainAiFailureLimitReached: true },
  });
  assert.equal(registry.completed(pending.port, step, accepted), "wait");
  assert.equal(pending.failure.protocolRetries, 0);
  assert.equal(pending.failure.mainAiFailureCount, 0);
  assert.equal(pending.failure.mainAiFailureLimitReached, false);
  assert.equal(names(pending.calls).includes("finishParent"), false);

  const queuedReview = createPort({
    views: [view({ hasReview: true }), view({ hasReview: true })],
    failure: { protocolRetries: 2, mainAiFailureCount: 5, mainAiFailureLimitReached: true },
  });
  assert.equal(registry.completed(queuedReview.port, step, accepted), "continue");
  assert.equal(queuedReview.failure.protocolRetries, 0);
  assert.equal(queuedReview.failure.mainAiFailureCount, 0);
  assert.equal(queuedReview.failure.mainAiFailureLimitReached, false);

  const failedSubmit = createPort({
    submitOk: false,
    failure: { protocolRetries: 4, mainAiFailureCount: 2, mainAiFailureLimitReached: true },
  });
  assert.equal(registry.completed(failedSubmit.port, step, accepted), "stop");
  assert.equal(failedSubmit.failure.protocolRetries, 4);
  assert.equal(failedSubmit.failure.mainAiFailureCount, 2);
  assert.equal(failedSubmit.failure.mainAiFailureLimitReached, true);
  assert.equal(names(failedSubmit.calls).includes("markDecisionAccepted"), false);
  assert.equal(names(failedSubmit.calls).includes("clearProtocolFailure"), false);
  assert.deepEqual(names(failedSubmit.calls), ["submitReviewBatch", "persistSnapshot"]);

  const withoutSubmit = createPort({
    views: [view({ runningCount: 1, pendingCount: 1 }), view()],
    failure: { protocolRetries: 2, mainAiFailureCount: 4, mainAiFailureLimitReached: true },
  });
  assert.equal(registry.completed(
    withoutSubmit.port,
    decisionStep({ kind: "closeout" }),
    decision("completed", { answerConclusion: "done", finalSummary: "done" }),
  ), "wait");
  assert.equal(withoutSubmit.failure.protocolRetries, 0);
  assert.equal(withoutSubmit.failure.mainAiFailureCount, 4);
  assert.equal(withoutSubmit.failure.mainAiFailureLimitReached, true);
  assert.equal(names(withoutSubmit.calls).includes("submitReviewBatch"), false);
  assert.equal(names(withoutSubmit.calls).includes("markDecisionAccepted"), false);
  assert.equal(names(withoutSubmit.calls).includes("clearProtocolFailure"), true);
  assert.equal(names(withoutSubmit.calls).includes("tryFinishParent"), false);

  const schedulerRefused = createPort({
    tryFinish: false,
    views: [view(), view()],
    failure: { protocolRetries: 2, mainAiFailureCount: 3, mainAiFailureLimitReached: true },
  });
  assert.equal(registry.completed(
    schedulerRefused.port,
    decisionStep({ kind: "closeout" }),
    decision("completed", { answerConclusion: "done", finalSummary: "done" }),
  ), "wait");
  assert.equal(schedulerRefused.failure.protocolRetries, 2);
  assert.equal(schedulerRefused.failure.mainAiFailureCount, 3);
  assert.equal(schedulerRefused.failure.mainAiFailureLimitReached, true);
  assert.equal(names(schedulerRefused.calls).includes("markDecisionAccepted"), false);
  assert.equal(names(schedulerRefused.calls).includes("clearProtocolFailure"), false);
  assert.equal(names(schedulerRefused.calls).includes("submitReviewBatch"), false);
  assert.equal(names(schedulerRefused.calls).at(-1), "persistRunning");
});

test("completed finishes only after the scheduler accepts an idle parent", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "closeout" });
  const accepted = decision("completed", { answerConclusion: "done", finalSummary: "done" });
  const blocked = createPort({ tryFinish: false, views: [view(), view({ hasReview: true })] });
  blocked.port.promoteDecisionWork = () => blocked.calls.push({ name: "promoteDecisionWork", args: [] });
  assert.equal(registry.completed(blocked.port, step, accepted), "continue");
  assert.deepEqual(names(blocked.calls), [
    "acknowledgeUserMessages",
    "persistSnapshot",
    "promoteDecisionWork",
    "waitForInFlightWork",
    "queueView",
    "tryFinishParent",
    "queueView",
  ]);
  assert.equal(names(blocked.calls).includes("finishParent"), false);
  assert.equal(names(blocked.calls).includes("markDecisionAccepted"), false);

  const waiting = createPort({ tryFinish: false, views: [view(), view()] });
  assert.equal(registry.completed(waiting.port, step, accepted), "wait");
  assert.deepEqual(names(waiting.calls).slice(1, 3), ["persistSnapshot", "waitForInFlightWork"]);
  assert.equal(names(waiting.calls).at(-1), "persistRunning");

  const done = createPort({ finish: "stop", views: [view()] });
  assert.equal(registry.completed(done.port, step, accepted), "stop");
  assert.deepEqual(names(done.calls).slice(1, 3), ["persistSnapshot", "waitForInFlightWork"]);
  assert.deepEqual(names(done.calls).slice(-2), ["markDecisionAccepted", "finishParent"]);
  assert.equal(names(done.calls).includes("dispatchSubtasks"), false);
  assert.equal(names(done.calls).includes("armCloseout"), false);
});


test("dependency-only wait is a protocol miss before resetting retries; a valid failed accept returns to planning", () => {
  const dependencyBlocks = [{ subtaskId: "child", attemptId: "child-1", dependencyId: "source", dependencyAttemptId: "source-2", reason: "failed" as const }];
  const registry = createLoopPlusDecisionStrategyRegistry();
  const blocked = createPort({ views: [view({ pendingCount: 1 })], inFlight: [{ runningCount: 0, pendingCount: 1, dependencyBlocks }], failure: { protocolRetries: 2 } });
  assert.equal(registry.wait(blocked.port, decisionStep(), decision("wait")), "continue");
  assert.equal(blocked.calls.at(-1)?.name, "protocolMiss");
  assert.equal(blocked.failure.protocolRetries, 2);
  assert.equal(names(blocked.calls).includes("markDecisionAccepted"), false);
  assert.equal(names(blocked.calls).includes("noteWaiting"), false);
  const accepted = createPort({ views: [view({ pendingCount: 1 })], inFlight: [{ runningCount: 0, pendingCount: 1, dependencyBlocks }] });
  assert.equal(registry.accept(accepted.port, decisionStep({ kind: "review", eventIds: ["failed-event"] }), decision("accept", {
    reviewEventId: "failed-event", reviews: [{ reviewEventId: "failed-event", acceptance: "failed", reason: "failed validation", noRepairReason: "验证发现无需重新执行交付" }],
  })), "continue");
  assert.equal(names(accepted.calls).includes("protocolMiss"), false);
  assert.equal(names(accepted.calls).includes("persistRunning"), false);
});

test("report confirmation precedes the combined control and dispatch commit and final dependency admission", () => {
  const { port, calls } = createPort({ views: [view({ runningCount: 1 })] });
  createLoopPlusDecisionStrategyRegistry().dispatch(port, decisionStep(), decision("dispatch", {
    controls: [repromptControl], reportEventIds: ["report"], subtasks: [subtask],
  }));
  const ordered = names(calls);
  for (const [before, after] of [["previewControls", "acknowledgeReports"], ["acknowledgeReports", "dispatchSubtasks"], ["dispatchSubtasks", "waitForInFlightWork"]]) {
    assert.ok(ordered.indexOf(before) < ordered.indexOf(after), `${before} precedes ${after}`);
  }
  assert.equal(calls.find(call => call.name === "dispatchSubtasks")?.args[1], calls.find(call => call.name === "previewControls")?.args[0]);
});

test("deferred raw review events keep wait and completed in bounded correction before accepting a no-progress decision", () => {
  const blocked = { subtaskId: "successor", attemptId: "successor-1", dependencyId: "source", dependencyAttemptId: "source-2", reason: "execution_pending" as const };
  for (const status of ["wait", "completed"] as const) {
    const env = createPort({ views: [view({ hasReview: true, reviewDependencyBlocks: [blocked] })], failure: { protocolRetries: 1 } });
    const outcome = loopPlusDecisionStrategyFor(status)(env.port, decisionStep({ kind: "continue" }), decision(status));
    assert.equal(outcome, "continue");
    assert.ok(names(env.calls).includes("protocolMiss"));
    assert.equal(names(env.calls).includes("markDecisionAccepted"), false);
    assert.equal(names(env.calls).includes("clearProtocolFailure"), false);
    assert.equal(names(env.calls).includes("tryFinishParent"), false);
    assert.equal(env.failure.protocolRetries, 1);
  }
});

test("deferred raw review events can wait on a live prerequisite without requesting an empty review", () => {
  const env = createPort({ views: [view({ hasReview: true, runningCount: 1, reviewDependencyBlocks: [
    { subtaskId: "successor", attemptId: "child", dependencyId: "source", dependencyAttemptId: "source-new", reason: "execution_pending" },
  ] })], inFlight: [{ runningCount: 1, pendingCount: 0 }] });
  assert.equal(loopPlusDecisionStrategyFor("wait")(env.port, decisionStep({ kind: "continue" }), decision("wait")), "wait");
  assert.ok(names(env.calls).includes("markDecisionAccepted"));
  assert.equal(names(env.calls).includes("protocolMiss"), false);
});

test("partial dispatch rejection keeps accepted work and does not mark the decision accepted", () => {
  const dispatchResult: Pick<LoopPlusDispatchResult, "decisions" | "rejected"> = {
    decisions: [{
      subtaskId: "fresh-child",
      attemptId: "fresh-1",
      admission: "started",
      block: null,
      concurrencyBlocked: false,
    }],
    rejected: [
      { subtaskId: "open-child", attemptId: "open-2", reason: "active_subtask" },
      { subtaskId: "fresh-child", attemptId: "fresh-2", reason: "duplicate_subtask" },
    ],
  };
  const plain = createPort({ recordPromote: true, dispatchResult });
  assert.equal(createLoopPlusDecisionStrategyRegistry().dispatch(
    plain.port,
    decisionStep(),
    decision("dispatch", { subtasks: [subtask] }),
  ), "continue");
  assert.equal(names(plain.calls).includes("promoteDecisionWork"), true);
  assert.equal(names(plain.calls).includes("markDecisionAccepted"), false);
  assert.equal((plain.calls.at(-1)?.args[1] as { reasonCode?: string } | undefined)?.reasonCode, "state.dispatch.rejected");

  const accepted = createPort({
    recordPromote: true,
    dispatchResult,
    views: [view({ hasReview: true })],
  });
  assert.equal(createLoopPlusDecisionStrategyRegistry().accept(
    accepted.port,
    decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] }),
    decision("accept", {
      reviewEventId: "evt-1",
      reviews: [{ reviewEventId: "evt-1", acceptance: "passed" }],
      subtasks: [subtask],
    }),
  ), "continue");
  assert.equal(names(accepted.calls).includes("submitReviewBatch"), true);
  assert.equal(names(accepted.calls).includes("promoteDecisionWork"), true);
  assert.equal(names(accepted.calls).includes("markDecisionAccepted"), false);
  assert.equal((accepted.calls.at(-1)?.args[1] as { reasonCode?: string } | undefined)?.reasonCode, "state.dispatch.rejected");
});
