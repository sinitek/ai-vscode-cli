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
import {
  confirmedLoopPlusReviewIds,
  createLoopPlusDecisionStrategyRegistry,
  loopPlusDecisionStrategyFor,
  plannedLoopPlusLaunchCount,
  sameLoopPlusReviewIds,
  type LoopPlusDecisionControlPlan,
  type LoopPlusDecisionInFlightView,
  type LoopPlusDecisionOutcome,
  type LoopPlusDecisionQueueView,
  type LoopPlusDecisionStepView,
  type LoopPlusDecisionStrategy,
  type LoopPlusDecisionStrategyPort,
} from "../../extensionHost/loopPlusDecisionStrategies";

const subtask: LoopSubtaskDecision = {
  id: "child-1",
  title: "Document the decision strategy boundary",
  prompt: "Keep scheduler transitions behind the host port and preserve FIFO review checks.".padEnd(80, "."),
};

const closeControl = { id: "child-1", action: "close" as const };
const repromptControl = {
  id: "child-1",
  action: "reprompt" as const,
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
  return { status, ...extra };
}

function names(calls: readonly RecordedCall[]): string[] {
  return calls.map((call) => call.name);
}

function createPort(options: {
  views?: LoopPlusDecisionQueueView[];
  inFlight?: LoopPlusDecisionInFlightView[];
  refuse?: boolean[];
  confirm?: boolean;
  controlsApplied?: boolean;
  controlPlan?: LoopPlusDecisionControlPlan | null;
  preview?: boolean;
  commit?: boolean;
  submitOk?: boolean;
  tryFinish?: boolean;
  protocolMiss?: LoopPlusDecisionOutcome;
  finish?: LoopPlusDecisionOutcome;
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
  const refuse = options.refuse ?? [false];
  let viewIndex = 0;
  let inFlightIndex = 0;
  let refuseIndex = 0;
  const record = (name: string, args: unknown[] = []) => {
    calls.push({ name, args });
  };
  const next = <T>(items: readonly T[], index: number): T => items[Math.min(index, items.length - 1)];
  const defaultPlan = { sealed: true } as unknown as LoopPlusDecisionControlPlan;
  const controlPlan = options.controlPlan === undefined ? defaultPlan : options.controlPlan;
  const port: LoopPlusDecisionStrategyPort = {
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
    protocolMiss(held) {
      record("protocolMiss", [held]);
      return options.protocolMiss ?? "continue";
    },
    markDecisionAccepted() {
      record("markDecisionAccepted");
      failure.protocolRetries = 0;
      failure.mainAiFailureCount = 0;
      failure.mainAiFailureLimitReached = false;
    },
    clearProtocolRetries() {
      record("clearProtocolRetries");
      failure.protocolRetries = 0;
    },
    acknowledgeUserMessages(count) {
      record("acknowledgeUserMessages", [count]);
    },
    refuseDispatchPastAcceptanceLimit(plannedLaunches) {
      record("refuseDispatchPastAcceptanceLimit", [plannedLaunches]);
      const refused = next(refuse, refuseIndex);
      refuseIndex += 1;
      return refused;
    },
    confirmReviewWithinAcceptanceLimit(eventIds) {
      record("confirmReviewWithinAcceptanceLimit", [eventIds]);
      return options.confirm ?? true;
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
      return options.preview ?? true;
    },
    commitControls(controls, plan) {
      record("commitControls", [controls, plan]);
      return options.commit ?? true;
    },
    dispatchSubtasks(subtasks) {
      record("dispatchSubtasks", [subtasks]);
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
    persistEstimatedRounds(value) {
      record("persistEstimatedRounds", [value.estimatedRemainingRounds]);
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

test("review id helpers keep FIFO order and reprompt launch counts", () => {
  assert.deepEqual(confirmedLoopPlusReviewIds(decision("accept")), []);
  assert.deepEqual(confirmedLoopPlusReviewIds(decision("accept", { reviewEventId: "only" })), ["only"]);
  assert.deepEqual(confirmedLoopPlusReviewIds(decision("accept", {
    reviewEventId: "ignored",
    reviewEventIds: ["first", "second"],
  })), ["first", "second"]);
  assert.equal(sameLoopPlusReviewIds(["first", "second"], ["first", "second"]), true);
  assert.equal(sameLoopPlusReviewIds(["first", "second"], ["second", "first"]), false);
  assert.equal(sameLoopPlusReviewIds(["first"], ["first", "second"]), false);
  assert.equal(plannedLoopPlusLaunchCount(decision("dispatch", {
    subtasks: [subtask, { ...subtask, id: "child-2" }],
    controls: [repromptControl, closeControl],
  })), 3);
  assert.equal(plannedLoopPlusLaunchCount(decision("steer", { controls: [closeControl] })), 0);
  assert.equal(plannedLoopPlusLaunchCount(decision("wait")), 0);
});

test("strategy module stays free of runtime, deps, and scheduler imports", () => {
  const source = readFileSync(join(__dirname, "../../../src/extensionHost/loopPlusDecisionStrategies.ts"), "utf8");
  for (const forbidden of [
    "ParentRuntime",
    "LoopPlusOrchestrationDeps",
    "loopPlusScheduler",
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
  assert.deepEqual(calls[1].args, [true]);
});

test("dispatch stops at the acceptance limit before applying controls", () => {
  const { port, calls } = createPort({ refuse: [true] });
  const outcome = createLoopPlusDecisionStrategyRegistry().dispatch(
    port,
    decisionStep({ userMessageCount: 2 }),
    decision("dispatch", { subtasks: [subtask], controls: [repromptControl] }),
  );
  assert.equal(outcome, "stop");
  assert.deepEqual(names(calls), ["queueView", "refuseDispatchPastAcceptanceLimit"]);
  assert.deepEqual(calls[1].args, [2]);
});

test("dispatch reports a control miss without launching subtasks", () => {
  const { port, calls } = createPort({ controlsApplied: false });
  const outcome = createLoopPlusDecisionStrategyRegistry().dispatch(
    port,
    decisionStep(),
    decision("dispatch", { subtasks: [subtask], controls: [closeControl] }),
  );
  assert.equal(outcome, "continue");
  assert.deepEqual(names(calls), ["queueView", "refuseDispatchPastAcceptanceLimit", "applyControls", "protocolMiss"]);
  assert.deepEqual(calls[3].args, [false]);
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
    "refuseDispatchPastAcceptanceLimit",
    "applyControls",
    "acknowledgeUserMessages",
    "markDecisionAccepted",
    "dispatchSubtasks",
    "persistEstimatedRounds",
    "queueView",
    "queueView",
  ]);
  assert.deepEqual(calls[3].args, [1]);
  assert.deepEqual(calls[5].args, [[subtask]]);
  assert.deepEqual(calls[6].args, [4]);
  assert.equal(names(calls).includes("submitReviewBatch"), false);
  assert.equal(names(calls).includes("waitForInFlightWork"), false);
  assert.equal(names(calls).includes("planControls"), false);
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

test("steer rejects an open review, empty controls, limit, and failed controls", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const held = createPort({ views: [view({ hasCurrentReview: true })] });
  assert.equal(registry.steer(held.port, decisionStep(), decision("steer", { controls: [closeControl] })), "continue");
  assert.deepEqual(held.calls[1].args, [true]);

  const empty = createPort();
  assert.equal(registry.steer(empty.port, decisionStep(), decision("steer")), "continue");
  assert.deepEqual(names(empty.calls), ["queueView", "protocolMiss"]);
  assert.deepEqual(empty.calls[1].args, [false]);

  const limited = createPort({ refuse: [true] });
  assert.equal(registry.steer(limited.port, decisionStep(), decision("steer", { controls: [repromptControl] })), "stop");
  assert.deepEqual(names(limited.calls), ["queueView", "refuseDispatchPastAcceptanceLimit"]);
  assert.equal(names(limited.calls).includes("applyControls"), false);

  const rejected = createPort({ controlsApplied: false });
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
  assert.equal(names(running.calls).includes("waitForInFlightWork"), false);

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
  assert.deepEqual(notReview.calls, [{ name: "protocolMiss", args: [true] }]);

  const empty = createPort();
  assert.equal(registry.accept(
    empty.port,
    decisionStep({ kind: "user" }),
    decision("accept"),
  ), "continue");
  assert.deepEqual(empty.calls, [{ name: "protocolMiss", args: [false] }]);

  const reversed = createPort();
  assert.equal(registry.accept(
    reversed.port,
    decisionStep({ kind: "review", eventId: "evt-2", eventIds: ["evt-2", "evt-1"] }),
    decision("accept", { reviewEventIds: ["evt-1", "evt-2"] }),
  ), "continue");
  assert.deepEqual(names(reversed.calls), ["protocolMiss"]);
  assert.equal(names(reversed.calls).includes("submitReviewBatch"), false);
});

test("accept stops before submit when the batch would exceed the acceptance limit", () => {
  const { port, calls } = createPort({ confirm: false });
  const outcome = createLoopPlusDecisionStrategyRegistry().accept(
    port,
    decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] }),
    decision("accept", { reviewEventId: "evt-1", controls: [closeControl] }),
  );
  assert.equal(outcome, "stop");
  assert.deepEqual(names(calls), ["confirmReviewWithinAcceptanceLimit"]);
  assert.deepEqual(calls[0].args, [["evt-1"]]);
});

test("accept previews controls before submit and does not commit a rejected plan", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const missing = createPort({ controlPlan: null });
  assert.equal(registry.accept(
    missing.port,
    decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] }),
    decision("accept", { reviewEventId: "evt-1", controls: [repromptControl] }),
  ), "continue");
  assert.deepEqual(names(missing.calls), ["confirmReviewWithinAcceptanceLimit", "planControls", "protocolMiss"]);
  assert.deepEqual(missing.calls.at(-1)?.args, [true]);

  const rejected = createPort({ preview: false });
  assert.equal(registry.accept(
    rejected.port,
    decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] }),
    decision("accept", { reviewEventId: "evt-1", controls: [closeControl] }),
  ), "continue");
  assert.deepEqual(names(rejected.calls), [
    "confirmReviewWithinAcceptanceLimit",
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
  assert.deepEqual(names(stopped.calls), ["confirmReviewWithinAcceptanceLimit", "submitReviewBatch", "persistSnapshot", "queueView"]);
  assert.equal(names(stopped.calls).includes("protocolMiss"), false);

  const retry = createPort({ submitOk: false, views: [view()] });
  assert.equal(registry.accept(retry.port, step, decision("accept", { reviewEventIds: ["evt-1", "evt-2"] })), "continue");
  assert.deepEqual(names(retry.calls).slice(-2), ["queueView", "protocolMiss"]);
  assert.deepEqual(retry.calls.at(-1)?.args, [true]);
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
      subtasks: [subtask],
      controls: [closeControl],
      estimatedRemainingRounds: 2,
    }),
  );
  assert.equal(outcome, "continue");
  assert.deepEqual(names(calls), [
    "confirmReviewWithinAcceptanceLimit",
    "planControls",
    "previewControls",
    "submitReviewBatch",
    "acknowledgeUserMessages",
    "markDecisionAccepted",
    "refuseDispatchPastAcceptanceLimit",
    "commitControls",
    "dispatchSubtasks",
    "persistEstimatedRounds",
    "queueView",
  ]);
  assert.deepEqual(calls[3].args, [["evt-1"], "failed"]);
  assert.deepEqual(calls[6].args, [1]);
  assert.equal(calls.find((call) => call.name === "commitControls")?.args[1], plan);
  assert.equal(names(calls).includes("applyControls"), false);
  assert.equal(names(calls).includes("waitForInFlightWork"), false);
});

test("accept keeps an already submitted batch when a later launch is refused or controls fail", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "review", eventId: "evt-1", eventIds: ["evt-1"] });
  const limited = createPort({ refuse: [true] });
  assert.equal(registry.accept(limited.port, step, decision("accept", {
    reviewEventId: "evt-1",
    subtasks: [subtask],
  })), "stop");
  assert.deepEqual(names(limited.calls).slice(0, 5), [
    "confirmReviewWithinAcceptanceLimit",
    "submitReviewBatch",
    "acknowledgeUserMessages",
    "markDecisionAccepted",
    "refuseDispatchPastAcceptanceLimit",
  ]);
  assert.equal(names(limited.calls).includes("dispatchSubtasks"), false);

  const rejected = createPort({ commit: false, controlPlan: { sealed: "later" } as unknown as LoopPlusDecisionControlPlan });
  assert.equal(registry.accept(rejected.port, step, decision("accept", {
    reviewEventId: "evt-1",
    controls: [closeControl],
  })), "continue");
  assert.equal(names(rejected.calls).at(-1), "protocolMiss");
  assert.deepEqual(rejected.calls.at(-1)?.args, [false]);
  assert.equal(names(rejected.calls).includes("dispatchSubtasks"), false);
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
  assert.deepEqual(names(busy.calls).slice(-3), ["queueView", "waitForInFlightWork", "persistRunning"]);
  assert.deepEqual(busy.calls.find((call) => call.name === "submitReviewBatch")?.args, [["evt-1"], "passed"]);
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

test("wait uses the pre-ack snapshot for in-flight work and a later read for messages", () => {
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
  });
  assert.equal(registry.wait(running.port, decisionStep({ userMessageCount: 2 }), decision("wait")), "wait");
  assert.deepEqual(names(running.calls), [
    "queueView",
    "acknowledgeUserMessages",
    "queueView",
    "markDecisionAccepted",
    "persistRunning",
    "noteWaiting",
  ]);
  assert.deepEqual(running.calls.at(-1)?.args, [4]);

  const idleMessage = createPort({
    views: [view({ hasUserMessages: false }), view(), view({ hasUserMessages: true })],
  });
  assert.equal(registry.wait(idleMessage.port, decisionStep(), decision("wait")), "continue");
  assert.equal(names(idleMessage.calls).includes("pauseForReview"), false);

  const idle = createPort({
    views: [view({ hasUserMessages: true }), view(), view({ hasUserMessages: false })],
  });
  assert.equal(registry.wait(idle.port, decisionStep(), decision("wait")), "stop");
  assert.deepEqual(idle.calls.at(-1)?.args, ["loop-plus-idle-wait"]);
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
    "clearProtocolRetries",
    "queueView",
    "pauseForReview",
  ]);
  assert.deepEqual(held.calls.at(-1)?.args, ["loop-plus-blocked", "needs a product choice"]);
  assert.equal(names(held.calls).includes("markDecisionAccepted"), false);

  const queued = createPort({ views: [view(), view({ hasUserMessages: true })] });
  assert.equal(registry.blocked(queued.port, decisionStep(), decision("blocked")), "continue");
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
  assert.deepEqual(reversed.calls, [{ name: "protocolMiss", args: [true] }]);

  const limited = createPort({ confirm: false });
  assert.equal(registry.completed(
    limited.port,
    decisionStep({ kind: "review", eventIds: ["evt-1"] }),
    decision("completed", { reviewEventId: "evt-1" }),
  ), "stop");
  assert.deepEqual(names(limited.calls), ["confirmReviewWithinAcceptanceLimit"]);

  const unexpected = createPort();
  assert.equal(registry.completed(
    unexpected.port,
    decisionStep(),
    decision("completed", { reviewEventId: "evt-1" }),
  ), "continue");
  assert.deepEqual(unexpected.calls, [{ name: "protocolMiss", args: [false] }]);
});

test("completed stops after a failed submit without asking whether the parent stopped", () => {
  const { port, calls } = createPort({ submitOk: false, views: [view({ parentStopped: false })] });
  const outcome = createLoopPlusDecisionStrategyRegistry().completed(
    port,
    decisionStep({ kind: "review", eventIds: ["evt-1", "evt-2"] }),
    decision("completed", { reviewEventIds: ["evt-1", "evt-2"] }),
  );
  assert.equal(outcome, "stop");
  assert.deepEqual(names(calls), ["confirmReviewWithinAcceptanceLimit", "submitReviewBatch", "persistSnapshot"]);
  assert.deepEqual(calls[1].args, [["evt-1", "evt-2"], "passed"]);
  assert.equal(names(calls).includes("protocolMiss"), false);
  assert.equal(names(calls).includes("queueView"), false);
});

test("completed keeps running work instead of finishing the parent", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "review", eventIds: ["evt-1"], userMessageCount: 1 });
  const accepted = decision("completed", { reviewEventId: "evt-1", subtasks: [subtask] });
  const review = createPort({ views: [view({ hasReview: true }), view({ hasReview: true })] });
  assert.equal(registry.completed(review.port, step, accepted), "continue");
  assert.deepEqual(names(review.calls).slice(-3), ["queueView", "markDecisionAccepted", "queueView"]);
  assert.equal(names(review.calls).includes("tryFinishParent"), false);
  assert.equal(names(review.calls).includes("dispatchSubtasks"), false);
  assert.equal(names(review.calls).includes("clearProtocolRetries"), false);

  const running = createPort({
    views: [view({ runningCount: 1 }), view()],
  });
  assert.equal(registry.completed(running.port, step, accepted), "wait");
  assert.deepEqual(names(running.calls).slice(-3), ["markDecisionAccepted", "queueView", "persistRunning"]);
  assert.equal(names(running.calls).includes("clearProtocolRetries"), false);
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
  assert.equal(names(running.calls).includes("clearProtocolRetries"), false);
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
  assert.equal(names(failedSubmit.calls).includes("clearProtocolRetries"), false);
  assert.deepEqual(names(failedSubmit.calls), ["confirmReviewWithinAcceptanceLimit", "submitReviewBatch", "persistSnapshot"]);

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
  assert.equal(names(withoutSubmit.calls).includes("clearProtocolRetries"), true);
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
  assert.equal(names(schedulerRefused.calls).includes("clearProtocolRetries"), false);
  assert.equal(names(schedulerRefused.calls).includes("submitReviewBatch"), false);
  assert.equal(names(schedulerRefused.calls).at(-1), "persistRunning");
});

test("completed finishes only after the scheduler accepts an idle parent", () => {
  const registry = createLoopPlusDecisionStrategyRegistry();
  const step = decisionStep({ kind: "closeout" });
  const accepted = decision("completed", { answerConclusion: "done", finalSummary: "done" });
  const blocked = createPort({ tryFinish: false, views: [view(), view({ hasReview: true })] });
  assert.equal(registry.completed(blocked.port, step, accepted), "continue");
  assert.deepEqual(names(blocked.calls), [
    "acknowledgeUserMessages",
    "queueView",
    "tryFinishParent",
    "queueView",
  ]);
  assert.equal(names(blocked.calls).includes("finishParent"), false);
  assert.equal(names(blocked.calls).includes("markDecisionAccepted"), false);

  const waiting = createPort({ tryFinish: false, views: [view(), view()] });
  assert.equal(registry.completed(waiting.port, step, accepted), "wait");
  assert.equal(names(waiting.calls).at(-1), "persistRunning");

  const done = createPort({ finish: "stop", views: [view()] });
  assert.equal(registry.completed(done.port, step, accepted), "stop");
  assert.deepEqual(names(done.calls).slice(-2), ["markDecisionAccepted", "finishParent"]);
  assert.equal(names(done.calls).includes("dispatchSubtasks"), false);
  assert.equal(names(done.calls).includes("armCloseout"), false);
});
