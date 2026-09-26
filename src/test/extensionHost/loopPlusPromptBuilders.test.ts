import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildLoopPlusMainModelPrompt,
  buildLoopPlusSubtaskModelPrompt,
  type LoopPlusMainPromptContext,
} from "../../extensionHost/loopPlusPromptBuilders";
import { isHiddenLoopPlusProtocolPrompt } from "../../loopPlusProtocolPrompt";
import {
  LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH,
  LOOP_PLUS_DECISION_SUBTASK_MAX,
  parseLoopPlusDecision,
  type LoopPlusDecision,
} from "../../loopPlusDecision";
import type {
  LoopPlusExecutionRecord,
  LoopPlusReviewItem,
  LoopPlusSchedulerView,
} from "../../loopPlusScheduler";

const PROTOCOL_STATUSES = ["dispatch", "accept", "wait", "blocked", "completed"] as const;
const PLURAL_CONFIRMATION_KEYS = ["reviewEventIds", "confirmedEventIds", "acceptedEventIds"] as const;

function execution(subtaskId: string, state: LoopPlusExecutionRecord["state"]): LoopPlusExecutionRecord {
  return {
    subtaskId,
    attemptId: `${subtaskId}-attempt`,
    title: subtaskId,
    conflictGroup: null,
    writeFiles: [`src/${subtaskId}.ts`],
    state,
  };
}

function review(eventId: string, subtaskId: string): LoopPlusReviewItem {
  return {
    eventId,
    subtaskId,
    attemptId: `${subtaskId}-attempt`,
    outcome: "completed",
    detail: `${subtaskId}-detail`,
  };
}

function view(overrides: Partial<LoopPlusSchedulerView> = {}): LoopPlusSchedulerView {
  return {
    phase: "reviewing",
    seq: 4,
    wake: true,
    wakeSeq: 4,
    userMessageQueue: [],
    running: [],
    pending: [],
    reviewQueue: [],
    currentReview: null,
    visibleReviewCount: 0,
    canComplete: false,
    blockers: [],
    ...overrides,
  };
}

function mainContext(overrides: Partial<LoopPlusMainPromptContext> = {}): LoopPlusMainPromptContext {
  return {
    taskId: "task-token",
    rootPrompt: "ROOT_REQUEST_TOKEN",
    taskStoreFile: "TASK_RECORD_TOKEN",
    mainCommunicationFile: "MAIN_REPORT_TOKEN",
    kind: "review",
    view: view(),
    currentEventId: null,
    supplementalRequirements: [],
    ...overrides,
  };
}

function extractProtocolExamples(prompt: string): Map<string, string> {
  const examples = new Map<string, string>();
  const pattern = /LOOP_PLUS_PROTOCOL_EXAMPLE ([a-z]+)\n```json\n([\s\S]*?)\n```/g;
  for (const match of prompt.matchAll(pattern)) {
    examples.set(match[1], match[2]);
  }
  return examples;
}

function parseExample(examples: Map<string, string>, status: string): LoopPlusDecision {
  const jsonText = examples.get(status);
  assert.equal(typeof jsonText, "string", `missing generated ${status} example`);
  const decision = parseLoopPlusDecision(jsonText);
  assert.ok(decision, `generated ${status} example was rejected`);
  assert.equal(decision?.status, status);
  return decision as LoopPlusDecision;
}

test("generated five-state examples satisfy the current parser and live event id", () => {
  const current = review("event-live-42", "sub-current");
  const queued = review("event-queued-7", "sub-queued");
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    view: view({
      currentReview: current,
      reviewQueue: [queued],
      visibleReviewCount: 2,
      running: [execution("sub-running", "running")],
      pending: [execution("sub-pending", "pending")],
      blockers: ["running", "pending", "review_queue"],
      canComplete: false,
    }),
    supplementalRequirements: ["SUPPLEMENTAL_TOKEN"],
  }));
  const examples = extractProtocolExamples(prompt);
  assert.deepEqual([...examples.keys()], [...PROTOCOL_STATUSES]);

  const dispatch = parseExample(examples, "dispatch");
  assert.equal(Object.prototype.hasOwnProperty.call(dispatch, "reviewEventId"), false);
  assert.ok(dispatch.subtasks);
  assert.ok(dispatch.subtasks.length >= 1 && dispatch.subtasks.length <= LOOP_PLUS_DECISION_SUBTASK_MAX);
  dispatch.subtasks.forEach((subtask) => {
    assert.ok(subtask.title.trim());
    assert.ok(subtask.prompt.length >= LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH);
    assert.match(subtask.prompt, /write scope/i);
    assert.ok(subtask.writeFiles && subtask.writeFiles.length > 0);
    subtask.writeFiles?.forEach((file) => {
      assert.equal(file.startsWith("/"), false);
      assert.equal(file.includes("Users"), false);
    });
  });

  const accept = parseExample(examples, "accept");
  assert.equal(accept.reviewEventId, "event-live-42");
  assert.ok(!accept.subtasks || accept.subtasks.length <= LOOP_PLUS_DECISION_SUBTASK_MAX);

  const waiting = parseExample(examples, "wait");
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "reviewEventId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "subtasks"), false);

  const blocked = parseExample(examples, "blocked");
  assert.equal(Object.prototype.hasOwnProperty.call(blocked, "reviewEventId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(blocked, "subtasks"), false);
  assert.equal(typeof blocked.finalSummary, "string");
  assert.ok((blocked.finalSummary ?? "").trim());

  const completed = parseExample(examples, "completed");
  assert.equal(completed.reviewEventId, "event-live-42");
  assert.ok(completed.answerConclusion && completed.answerConclusion.trim());
  assert.ok(completed.finalSummary && completed.finalSummary.trim());
  assert.equal(completed.acceptance?.passed, true);
  assert.ok(completed.acceptance && completed.acceptance.checks.length > 0);
  assert.equal(completed.acceptance?.checks.every((check) => check.passed === true), true);
  assert.ok(completed.requirementCoverage && completed.requirementCoverage.length > 0);
  assert.equal(completed.requirementCoverage?.every((check) => check.passed === true), true);
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "subtasks"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "estimatedRemainingRounds"), false);
  assert.equal(JSON.stringify(completed).includes("roundSummaries"), false);

  PROTOCOL_STATUSES.forEach((status) => {
    const raw = JSON.parse(examples.get(status) ?? "{}") as Record<string, unknown>;
    PLURAL_CONFIRMATION_KEYS.forEach((key) => {
      assert.equal(Object.prototype.hasOwnProperty.call(raw, key), false);
    });
    assert.notEqual(raw.status, "continue");
  });
  assert.equal(parseLoopPlusDecision(prompt)?.status, "dispatch");
});

test("stripping required completed fields from the generated example is rejected", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    view: view({
      currentReview: review("event-live-42", "sub-current"),
      visibleReviewCount: 1,
    }),
  }));
  const completedJson = extractProtocolExamples(prompt).get("completed");
  assert.equal(typeof completedJson, "string");
  const base = JSON.parse(completedJson ?? "{}") as Record<string, unknown>;
  const cases: Array<Record<string, unknown>> = [];
  const withoutConclusion = { ...base };
  delete withoutConclusion.answerConclusion;
  cases.push(withoutConclusion);
  const withoutSummary = { ...base };
  delete withoutSummary.finalSummary;
  cases.push(withoutSummary);
  const acceptance = base.acceptance as Record<string, unknown>;
  cases.push({ ...base, acceptance: { ...acceptance, passed: false } });
  cases.push({ ...base, acceptance: { ...acceptance, checks: [] } });
  const checks = (acceptance.checks as Array<Record<string, unknown>>).map((check, index) => (
    index === 0 ? { ...check, passed: false } : check
  ));
  cases.push({ ...base, acceptance: { ...acceptance, checks } });
  cases.push({ ...base, requirementCoverage: [] });
  const coverage = (base.requirementCoverage as Array<Record<string, unknown>>).map((check, index) => (
    index === 0 ? { ...check, passed: false } : check
  ));
  cases.push({ ...base, requirementCoverage: coverage });
  cases.push({ ...base, reviewEventId: " " });
  cases.push({
    ...base,
    subtasks: [{
      id: "extra-completed-subtask",
      title: "Extra subtask",
      prompt: "x".repeat(LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH),
    }],
  });
  cases.forEach((value) => {
    assert.equal(parseLoopPlusDecision(JSON.stringify(value)), null);
  });
});

test("prompt forbids plural confirmation keys, classic continue, and round gates", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    view: view({
      currentReview: review("event-live-42", "sub-current"),
      visibleReviewCount: 1,
    }),
  }));
  assert.match(prompt, new RegExp(`1 to ${LOOP_PLUS_DECISION_SUBTASK_MAX}`));
  assert.match(prompt, new RegExp(`0 to ${LOOP_PLUS_DECISION_SUBTASK_MAX}`));
  const limited = buildLoopPlusMainModelPrompt(mainContext({ subtaskMax: 3 }));
  assert.match(limited, /1 to 3 new self-contained subtasks/);
  assert.match(limited, /0 to 3 new subtasks/);
  const clamped = buildLoopPlusMainModelPrompt(mainContext({ subtaskMax: 99 }));
  assert.match(clamped, /1 to 20 new self-contained subtasks/);
  assert.match(prompt, new RegExp(String(LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH)));
  PLURAL_CONFIRMATION_KEYS.forEach((key) => {
    assert.match(prompt, new RegExp(key));
  });
  assert.match(prompt, /classic Loop status continue/);
  assert.match(prompt, /roundSummaries/);
  assert.match(prompt, /estimatedRemainingRounds is optional/);
  assert.match(prompt, /snapshot captured when the CLI started/);
  assert.match(prompt, /host re-reads that record and is the final gate/);
  assert.match(prompt, /Do not implement that work yourself/);
  assert.match(prompt, /loopPlus snapshot/);

  const examples = extractProtocolExamples(prompt);
  const accept = JSON.parse(examples.get("accept") ?? "{}") as Record<string, unknown>;
  PLURAL_CONFIRMATION_KEYS.forEach((key) => {
    assert.equal(parseLoopPlusDecision(JSON.stringify({ ...accept, [key]: ["event-live-42"] })), null);
  });
  const dispatch = JSON.parse(examples.get("dispatch") ?? "{}") as Record<string, unknown>;
  assert.equal(parseLoopPlusDecision(JSON.stringify({ ...dispatch, status: "continue" })), null);
  const completed = JSON.parse(examples.get("completed") ?? "{}") as Record<string, unknown>;
  const withRounds = parseLoopPlusDecision(JSON.stringify({
    ...completed,
    roundSummaries: [{ round: 1, title: "ignored", summary: "not a gate" }],
    estimatedRemainingRounds: 4,
  }));
  assert.equal(withRounds?.status, "completed");
  assert.equal(withRounds?.estimatedRemainingRounds, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(withRounds, "roundSummaries"), false);
  const waiting = JSON.parse(examples.get("wait") ?? "{}") as Record<string, unknown>;
  const optionalWait = parseLoopPlusDecision(JSON.stringify({ ...waiting, estimatedRemainingRounds: "2" }));
  assert.equal(optionalWait?.status, "wait");
  assert.equal(optionalWait?.estimatedRemainingRounds, 2);
});

test("main prompt shows the current item, queue, visible count, work in flight, and report paths", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    taskStoreFile: "TASK_RECORD_TOKEN",
    mainCommunicationFile: "MAIN_REPORT_TOKEN",
    rootPrompt: "ROOT_REQUEST_TOKEN",
    view: view({
      phase: "reviewing",
      currentReview: review("event-live-42", "sub-current"),
      reviewQueue: [review("event-queued-7", "sub-queued")],
      visibleReviewCount: 2,
      running: [execution("sub-running", "running")],
      pending: [execution("sub-pending", "pending")],
      blockers: ["running"],
      canComplete: false,
    }),
    supplementalRequirements: ["SUPPLEMENTAL_TOKEN"],
  }));
  assert.match(prompt, /Current review eventId: event-live-42/);
  assert.match(prompt, /current eventId=event-live-42 subtask=sub-current/);
  assert.match(prompt, /FIFO review queue count: 1/);
  assert.match(prompt, /Visible review count including the current item: 2/);
  assert.match(prompt, /queued#1 eventId=event-queued-7 subtask=sub-queued/);
  assert.match(prompt, /Still running count: 1/);
  assert.match(prompt, /sub-running attempt=sub-running-attempt state=running/);
  assert.match(prompt, /Still pending count: 1/);
  assert.match(prompt, /sub-pending attempt=sub-pending-attempt state=pending/);
  assert.match(prompt, /1\. SUPPLEMENTAL_TOKEN/);
  assert.match(prompt, /Main communication report path: MAIN_REPORT_TOKEN/);
  assert.match(prompt, /Latest task record path: TASK_RECORD_TOKEN/);
  assert.match(prompt, /Current attempt report path: communicationFile of subtask sub-current/);
  assert.match(prompt, /ROOT_REQUEST_TOKEN/);
  assert.doesNotMatch(prompt, /\/Users\//);
  assert.doesNotMatch(prompt, /example-review-event-id/);
});

test("omits a live event id when nothing is under review and still parses every example", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    kind: "initial",
    currentEventId: "   ",
    view: view({
      phase: "waiting",
      running: [execution("sub-running", "running")],
      visibleReviewCount: 0,
      blockers: ["running"],
    }),
  }));
  assert.match(prompt, /Current review eventId: \(none\)/);
  assert.match(prompt, /Current review item: \(none\)/);
  assert.match(prompt, /FIFO review queue count: 0/);
  assert.match(prompt, /Visible review count including the current item: 0/);
  assert.match(prompt, /Current attempt report path: \(no current item\)/);
  assert.match(prompt, /must not be emitted/);
  const examples = extractProtocolExamples(prompt);
  assert.deepEqual([...examples.keys()], [...PROTOCOL_STATUSES]);
  const completed = parseExample(examples, "completed");
  assert.equal(Object.prototype.hasOwnProperty.call(completed, "reviewEventId"), false);
  const accept = parseExample(examples, "accept");
  assert.ok(accept.reviewEventId && accept.reviewEventId.trim());
  assert.equal(prompt.includes(`Current review eventId: ${accept.reviewEventId}`), false);
  assert.equal(parseExample(examples, "wait").status, "wait");
  assert.equal(parseExample(examples, "blocked").status, "blocked");
  assert.equal(parseExample(examples, "dispatch").subtasks?.length, 1);
});

test("a multi-event acceptance batch is confirmed in order and includes the user messages", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    currentEventId: "event-live-42",
    acceptanceEventIds: ["event-live-42", "event-queued-7"],
    pendingUserMessages: ["cover the queued failure"],
    view: view({
      currentReview: review("event-live-42", "sub-current"),
      reviewQueue: [review("event-queued-7", "sub-queued")],
      visibleReviewCount: 2,
    }),
  }));
  assert.match(prompt, /Acceptance batch count: 2/);
  assert.match(prompt, /1\. event-live-42/);
  assert.match(prompt, /2\. event-queued-7/);
  assert.match(prompt, /1\. cover the queued failure/);
  assert.match(prompt, /read those messages in the same decision/);
  const examples = extractProtocolExamples(prompt);
  const accept = JSON.parse(examples.get("accept") ?? "{}") as Record<string, unknown>;
  assert.deepEqual(accept.reviewEventIds, ["event-live-42", "event-queued-7"]);
  assert.equal(Object.prototype.hasOwnProperty.call(accept, "reviewEventId"), false);
  const parsed = parseLoopPlusDecision(JSON.stringify(accept));
  assert.deepEqual(parsed?.reviewEventIds, ["event-live-42", "event-queued-7"]);
  assert.equal(parseLoopPlusDecision(JSON.stringify({
    ...accept,
    reviewEventId: "event-live-42",
  })), null);
});

test("subtask prompt limits itself to the supplied attempt report and write scope", () => {
  const prompt = buildLoopPlusSubtaskModelPrompt({
    taskId: "task-token",
    rootPrompt: "ROOT_REQUEST_TOKEN",
    subtask: {
      id: "sub-token",
      title: "title-token",
      prompt: "INSTRUCTION_TOKEN",
      writeFiles: ["src/authorized-scope.ts"],
      conflictGroup: "group-token",
    },
    attemptId: "attempt-token",
    communicationFile: "ATTEMPT_REPORT_TOKEN",
    taskStoreFile: "TASK_RECORD_TOKEN",
  });
  assert.match(prompt, /independent Loop\+ execution attempt/);
  assert.match(prompt, /only writes your attempt report/);
  assert.match(prompt, /Authorized write scope: src\/authorized-scope\.ts/);
  assert.match(prompt, /Attempt report file: ATTEMPT_REPORT_TOKEN/);
  assert.match(prompt, /Task record file, read only: TASK_RECORD_TOKEN/);
  assert.match(prompt, /Do not modify scheduling state, active ids, the loopPlus snapshot, or the task record/);
  assert.match(prompt, /INSTRUCTION_TOKEN/);
  assert.match(prompt, /group-token/);
  assert.equal(prompt.includes("LOOP_PLUS_PROTOCOL_EXAMPLE"), false);
  assert.equal(prompt.toLowerCase().includes("round"), false);
  assert.equal(prompt.includes("roundSummaries"), false);
  assert.equal(prompt.includes("continue"), false);
  assert.doesNotMatch(prompt, /\/Users\//);
  assert.doesNotMatch(prompt, /sinitek_cli/);

  const emptyPaths = buildLoopPlusSubtaskModelPrompt({
    taskId: "task-token",
    rootPrompt: "ROOT_REQUEST_TOKEN",
    subtask: {
      title: "title-token",
      prompt: "INSTRUCTION_TOKEN",
    },
    attemptId: "attempt-token",
    communicationFile: "",
    taskStoreFile: "",
  });
  assert.match(emptyPaths, /Attempt report file: \n/);
  assert.match(emptyPaths, /Task record file, read only: \n/);
  assert.match(emptyPaths, /Authorized write scope: \(not declared; follow the subtask instructions\)/);
  assert.doesNotMatch(emptyPaths, /\/Users\//);
  assert.equal(emptyPaths.toLowerCase().includes("round"), false);
});

test("asks the main task to judge a batch of new user messages before launching", () => {
  const prompt = buildLoopPlusMainModelPrompt(mainContext({
    kind: "user",
    pendingUserMessages: ["FIRST_USER_MESSAGE", "SECOND_USER_MESSAGE"],
    view: view({
      phase: "waiting",
      running: [execution("sub-running", "running")],
      blockers: ["running", "user_messages"],
      canComplete: false,
    }),
  }));
  assert.match(prompt, /Prompt kind: user/);
  assert.match(prompt, /1\. FIRST_USER_MESSAGE/);
  assert.match(prompt, /2\. SECOND_USER_MESSAGE/);
  assert.match(prompt, /judge the whole list together/);
  assert.match(prompt, /wait instead when a still-running or pending execution must finish/);
  assert.match(prompt, /Do not dispatch a placeholder just to wait/);
});

test("hides generated Loop+ protocol prompts but not ordinary or mid-sentence text", () => {
  const mainPrompt = buildLoopPlusMainModelPrompt(mainContext());
  const subtaskPrompt = buildLoopPlusSubtaskModelPrompt({
    taskId: "task-token",
    rootPrompt: "ROOT_REQUEST_TOKEN",
    subtask: {
      title: "title-token",
      prompt: "INSTRUCTION_TOKEN",
    },
    attemptId: "attempt-token",
    communicationFile: "attempt-report",
    taskStoreFile: "task-record",
  });
  assert.equal(isHiddenLoopPlusProtocolPrompt(mainPrompt), true);
  assert.match(mainPrompt, /Any earlier task list in this thread is stale/);
  assert.doesNotMatch(subtaskPrompt, /Any earlier task list in this thread is stale/);
  assert.equal(isHiddenLoopPlusProtocolPrompt(`\n${subtaskPrompt}`), true);
  assert.equal(isHiddenLoopPlusProtocolPrompt("fix the bubble"), false);
  assert.equal(isHiddenLoopPlusProtocolPrompt("请看 You are the Loop+ main reviewer."), false);
  assert.equal(isHiddenLoopPlusProtocolPrompt(""), false);
  assert.equal(isHiddenLoopPlusProtocolPrompt(null), false);
});

