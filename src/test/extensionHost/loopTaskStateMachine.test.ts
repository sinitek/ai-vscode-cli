import test = require("node:test");
import assert = require("node:assert/strict");
import { readFileSync } from "fs";
import { join } from "path";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import {
  LOOP_EVENT_DRIVEN_INTERRUPT_SUMMARY,
  buildLoopSubtaskId,
  getActiveLoopSubtaskIds,
  getLoopDecisionSubtasks,
  loopInterruptFailureLimitPatch,
  loopTaskTransitionStrategies,
  transitionLoopMainDecision,
  transitionLoopTaskInterrupt,
  transitionLoopTaskStop,
} from "../../extensionHost/loopTaskStateMachine";
import { buildNextLoopMainAiFailureState, LOOP_MAIN_AI_FAILURE_LIMIT } from "../../loopMainFailure";
import {
  ORCHESTRATOR_CLARIFICATION_LIMIT,
  type OrchestratorClarification,
} from "../../orchestratorClarification";
import type {
  LoopMainDecision,
  LoopSchedulingMode,
  LoopSubtaskRecord,
  LoopTaskRecord,
} from "../../loopTaskStore";

const { createPromptRunRuntimeHost } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");

const NOW = 1_711_000_000_000;
const FILESYSTEM_METHODS = [
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
] as const;

type FilesystemMethodName = (typeof FILESYSTEM_METHODS)[number];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function withoutFilesystemSideEffects<T>(run: () => T): T {
  const fsModule = require("fs") as typeof import("fs");
  const original = new Map<FilesystemMethodName, typeof fsModule[FilesystemMethodName]>();
  const events: string[] = [];
  for (const name of FILESYSTEM_METHODS) {
    original.set(name, fsModule[name]);
    const replacement = () => {
      events.push(name);
      throw new Error(`unexpected filesystem side effect: ${name}`);
    };
    (fsModule as unknown as Record<string, unknown>)[name] = replacement;
  }
  try {
    const result = run();
    assert.deepEqual(events, []);
    return result;
  } finally {
    for (const name of FILESYSTEM_METHODS) {
      (fsModule as unknown as Record<string, unknown>)[name] = original.get(name);
    }
  }
}

function createClarification(): OrchestratorClarification {
  return {
    interactionId: "clarify-1",
    title: "确认范围",
    instruction: "选择要继续的范围",
    formFields: [{
      id: "scope",
      label: "范围",
      type: "radio",
      required: true,
      options: [
        { label: "只改状态机", value: "state" },
        { label: "连同宿主", value: "host" },
      ],
    }],
    submitLabel: "提交",
    cancelLabel: "取消",
  };
}

function createSubtask(overrides: Partial<LoopSubtaskRecord> = {}): LoopSubtaskRecord {
  return {
    id: "sub-a",
    title: "现有子任务",
    prompt: "保持既有子任务",
    status: "running",
    updatedAt: 10,
    ...overrides,
  };
}

function createDebateRound(): NonNullable<LoopTaskRecord["debateRounds"]>[number] {
  return {
    loopRound: 2,
    debateRound: 1,
    status: "running",
    startedAt: 10,
    briefFile: "/tmp/loop-1/brief.md",
    activeSpeaker: {
      kind: "participant",
      id: "blue",
      title: "蓝队",
      updatedAt: 10,
    },
    participants: [
      {
        id: "blue",
        role: "blue_team",
        title: "蓝队",
        status: "running",
        artifactFile: "/tmp/loop-1/blue.md",
        updatedAt: 10,
      },
      {
        id: "red",
        role: "red_team",
        title: "红队",
        status: "pending",
        artifactFile: "/tmp/loop-1/red.md",
        summary: "已有结论",
        updatedAt: 11,
      },
      {
        id: "tester",
        role: "testing",
        title: "测试",
        status: "completed",
        artifactFile: "/tmp/loop-1/tester.md",
        updatedAt: 9,
      },
    ],
  };
}

function createTask(overrides: Partial<LoopTaskRecord> = {}): LoopTaskRecord {
  return {
    id: "loop-1",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/loop-1/loop-tasks.json",
    rootPrompt: "收口 Loop 状态机",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    maxRounds: 20,
    currentRound: 2,
    communicationDir: "/tmp/loop-1",
    mainCommunicationFile: "/tmp/loop-1/main-task.md",
    activeSubtaskId: "sub-a",
    activeSubtaskIds: ["sub-a"],
    subTasks: [createSubtask()],
    rounds: [],
    answerConclusion: "旧结论",
    finalSummary: "旧总结",
    estimatedRemainingRounds: 4,
    completionRoundSummaries: [{ round: 0, title: "历史", summary: "旧摘要" }],
    completionRequirementCoverage: [{ name: "历史覆盖", passed: false }],
    ...overrides,
  };
}

function createStopTask(status: LoopTaskRecord["status"] = "running"): LoopTaskRecord {
  return createTask({
    status,
    activeSubtaskId: "legacy-active",
    activeSubtaskIds: ["batch-active", " "],
    pendingClarification: createClarification(),
    subTasks: [
      createSubtask({ id: "legacy-active", title: "遗留活动", status: "completed" }),
      createSubtask({ id: "batch-active", title: "批次活动", status: "running" }),
      createSubtask({ id: "pending-one", title: "等待", status: "pending" }),
      createSubtask({ id: "done-one", title: "完成", status: "completed", summary: "保持完成" }),
      createSubtask({ id: "skipped-one", title: "跳过", status: "skipped" }),
    ],
    debateRounds: [createDebateRound()],
  });
}

function decide(task: LoopTaskRecord, decision: LoopMainDecision, now = NOW) {
  const before = clone(task);
  const result = withoutFilesystemSideEffects(() => transitionLoopMainDecision({ task, decision, now }));
  assert.deepEqual(task, before);
  return result;
}

function stop(
  schedulingMode: LoopSchedulingMode | undefined,
  task: LoopTaskRecord,
  options: { finalSummary?: string; subtaskSummary?: string; participantSummary?: string } = {},
) {
  const before = clone(task);
  const result = withoutFilesystemSideEffects(() => transitionLoopTaskStop(schedulingMode, {
    task,
    now: NOW,
    ...options,
  }));
  assert.deepEqual(task, before);
  return result;
}

function interrupt(
  schedulingMode: LoopSchedulingMode | undefined,
  input: {
    task: LoopTaskRecord | null;
    status: "error" | "stopped";
    source: "main" | "subtask";
    failureMessage?: string | null;
  },
) {
  const before = input.task ? clone(input.task) : null;
  const result = withoutFilesystemSideEffects(() => transitionLoopTaskInterrupt(schedulingMode, {
    ...input,
    now: NOW,
  }));
  if (input.task && before) {
    assert.deepEqual(input.task, before);
  }
  return result;
}

function createRuntimeHost(sideEffects: string[]) {
  const deps: Parameters<typeof createPromptRunRuntimeHost>[0] = {
    getActiveWorkspaceKey: () => "workspace",
    getConversationTabById: () => null,
    getConversationTabs: () => [],
    createConversationTabId: () => "tab-1",
    persistConversationTabsToWorkspaceSettings: () => undefined,
    postPanelState: async () => {
      sideEffects.push("postPanelState");
    },
    loadSessionMessages: () => [],
    persistMessagesForTab: () => {
      sideEffects.push("persistMessagesForTab");
    },
    getPendingSessionDraft: () => ({ messages: [] }),
    updatePendingSessionDraft: () => {
      sideEffects.push("updatePendingSessionDraft");
    },
    sendPanelMessage: () => {
      sideEffects.push("sendPanelMessage");
    },
    createMessageId: () => "message-1",
    readTaskStore: () => ({ runs: [] }),
    writeTaskStore: () => {
      sideEffects.push("writeTaskStore");
    },
    appendLoopMainSubChatMainDecision: () => {
      sideEffects.push("appendLoopMainSubChatMainDecision");
    },
    buildLoopDebateChatMessageAction: () => ({ type: "openLoopGroupChat", taskId: "loop-1" }),
    runLoopPrompt: async () => undefined,
    isTabRunActive: () => false,
    refreshOpenLoopGroupChatPanelForTask: () => {
      sideEffects.push("refreshOpenLoopGroupChatPanelForTask");
    },
    resolveConversationTabLoopContext: () => ({}),
    resolveLoopTaskSessionId: () => null,
    isLoopTaskBlockedByMainAiFailureLimit: () => false,
    appendLoopMainSubChatSubtaskFinished: () => {
      sideEffects.push("appendLoopMainSubChatSubtaskFinished");
    },
    closeConversationTabAndRefreshPanel: async () => {
      sideEffects.push("closeConversationTabAndRefreshPanel");
    },
  };
  return createPromptRunRuntimeHost(deps);
}

test("completes a loop task by clearing active subtasks and publishing the final summary", () => {
  const roundSummaries = [{ round: 2, subtaskId: "sub-a", title: "实现", summary: "已落地" }];
  const requirementCoverage = [{ name: "状态机", passed: true, detail: "覆盖收口" }];
  const task = createTask();
  const result = decide(task, {
    status: "completed",
    answerConclusion: "新结论",
    finalSummary: "新总结",
    roundSummaries,
    requirementCoverage,
    estimatedRemainingRounds: 6,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.appendDecisionMessages, true);
  assert.equal(result.subtasks, undefined);
  assert.equal(result.patch.status, "completed");
  assert.equal(result.patch.activeSubtaskId, null);
  assert.deepEqual(result.patch.activeSubtaskIds, []);
  assert.equal(result.patch.answerConclusion, "新结论");
  assert.equal(result.patch.finalSummary, "新总结");
  assert.equal(result.patch.estimatedRemainingRounds, 0);
  assert.equal(result.patch.completionRoundSummaries, roundSummaries);
  assert.equal(result.patch.completionRequirementCoverage, requirementCoverage);
  assert.equal(result.patch.updatedAt, NOW);
  assert.equal(hasOwn(result.patch, "pendingClarification"), false);

  const fallbackTask = createTask();
  const fallback = decide(fallbackTask, { status: "completed", finalSummary: "只有总结" });
  assert.equal(fallback.patch.answerConclusion, fallbackTask.answerConclusion);
  assert.equal(fallback.patch.finalSummary, "只有总结");
  assert.equal(fallback.patch.completionRoundSummaries, fallbackTask.completionRoundSummaries);
  assert.equal(fallback.patch.completionRequirementCoverage, fallbackTask.completionRequirementCoverage);
});

test("keeps clarify open under the limit and blocks once the limit is reached", () => {
  const clarification = createClarification();
  const underLimitTask = createTask({ clarificationCount: ORCHESTRATOR_CLARIFICATION_LIMIT - 1 });
  const underLimit = decide(underLimitTask, {
    status: "clarify",
    clarification,
    finalSummary: "还差一个选择",
    estimatedRemainingRounds: 2,
  });

  assert.equal(underLimit.status, "clarify");
  assert.equal(underLimit.appendDecisionMessages, true);
  assert.equal(underLimit.patch.status, "running");
  assert.equal(underLimit.patch.pendingClarification, clarification);
  assert.equal(underLimit.patch.clarificationCount, ORCHESTRATOR_CLARIFICATION_LIMIT);
  assert.equal(underLimit.patch.finalSummary, "还差一个选择");
  assert.equal(underLimit.patch.estimatedRemainingRounds, 2);
  assert.equal(underLimit.patch.activeSubtaskId, null);
  assert.deepEqual(underLimit.patch.activeSubtaskIds, []);

  const fresh = decide(createTask(), {
    status: "clarify",
    clarification: createClarification(),
  });
  assert.equal(fresh.status, "clarify");
  assert.equal(fresh.patch.clarificationCount, 1);
  assert.equal(hasOwn(fresh.patch, "finalSummary"), false);
  assert.equal(hasOwn(fresh.patch, "estimatedRemainingRounds"), false);

  const limited = decide(createTask({
    clarificationCount: ORCHESTRATOR_CLARIFICATION_LIMIT,
    pendingClarification: clarification,
  }), {
    status: "clarify",
    clarification,
    finalSummary: "澄清次数已经用完",
  });
  assert.equal(limited.status, "blocked");
  assert.equal(limited.appendDecisionMessages, true);
  assert.equal(limited.patch.status, "needs-review");
  assert.equal(limited.patch.pendingClarification, undefined);
  assert.equal(hasOwn(limited.patch, "pendingClarification"), true);
  assert.equal(limited.patch.finalSummary, "澄清次数已经用完");
  assert.equal(limited.patch.activeSubtaskId, null);
  assert.deepEqual(limited.patch.activeSubtaskIds, []);
  assert.equal(hasOwn(limited.patch, "clarificationCount"), false);
});

test("blocks a clarify decision that does not include a clarification payload", () => {
  const result = decide(createTask({ clarificationCount: 0 }), { status: "clarify" });

  assert.equal(result.status, "blocked");
  assert.equal(result.appendDecisionMessages, true);
  assert.equal(result.patch.status, "needs-review");
  assert.equal(result.patch.pendingClarification, undefined);
  assert.equal(result.patch.finalSummary, "Main task asked for clarification too many times.");
  assert.deepEqual(result.patch.activeSubtaskIds, []);
});

test("blocks a main decision and keeps the supplied final summary", () => {
  const result = decide(createTask(), {
    status: "blocked",
    finalSummary: "需求冲突",
    estimatedRemainingRounds: 1,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.appendDecisionMessages, true);
  assert.equal(result.patch.status, "needs-review");
  assert.equal(result.patch.finalSummary, "需求冲突");
  assert.equal(result.patch.estimatedRemainingRounds, 1);
  assert.equal(result.patch.activeSubtaskId, null);
  assert.deepEqual(result.patch.activeSubtaskIds, []);
  assert.equal(hasOwn(result.patch, "pendingClarification"), false);

  const fallback = decide(createTask(), { status: "blocked" });
  assert.equal(fallback.patch.finalSummary, "Main task reported blocked.");
  assert.equal(hasOwn(fallback.patch, "estimatedRemainingRounds"), false);
});

test("continues a single legacy subtask and replaces the active subtask ids", () => {
  const task = createTask({
    activeSubtaskId: "old",
    activeSubtaskIds: ["old"],
    subTasks: [createSubtask({ id: "old", title: "旧子任务", status: "running" })],
  });
  const result = decide(task, {
    status: "continue",
    subtasks: [],
    subtask: { id: "new", title: "新子任务", prompt: "继续这一项" },
    estimatedRemainingRounds: 3,
  });

  assert.equal(result.status, "continue");
  assert.equal(result.appendDecisionMessages, true);
  assert.equal(result.patch.status, "running");
  assert.equal(result.patch.activeSubtaskId, "new");
  assert.deepEqual(result.patch.activeSubtaskIds, ["new"]);
  assert.equal(result.patch.estimatedRemainingRounds, 3);
  assert.deepEqual(result.subtasks?.map((item) => item.id), ["new"]);
  assert.equal(result.patch.subTasks?.find((item) => item.id === "old")?.status, "running");
  assert.equal(result.patch.subTasks?.find((item) => item.id === "new")?.status, "running");
  assert.deepEqual(getLoopDecisionSubtasks({
    status: "continue",
    subtasks: [],
    subtask: { id: "new", title: "新子任务", prompt: "继续这一项" },
  }).map((item) => item.id), ["new"]);
});

test("continues a batch with duplicate ids and a generated id for a missing subtask id", () => {
  const task = createTask({
    subTasks: [
      createSubtask({ id: "keep", title: "保留", status: "completed" }),
      createSubtask({ id: "dup", title: "旧重复", status: "completed", summary: "旧摘要" }),
    ],
  });
  const result = decide(task, {
    status: "continue",
    subtasks: [
      { id: "dup", title: "第一遍", prompt: "first" },
      { id: " dup ", title: "空白编号", prompt: "trimmed" },
      { id: "dup", title: "第二遍", prompt: "second" },
      { title: "缺失编号", prompt: "generated" },
    ],
  });
  const generatedId = buildLoopSubtaskId("缺失编号");
  const stored = result.patch.subTasks ?? [];
  const duplicate = stored.find((item) => item.id === "dup");

  assert.equal(result.status, "continue");
  assert.deepEqual(result.subtasks?.map((item) => item.id), ["dup", "dup", "dup", generatedId]);
  assert.deepEqual(result.subtasks?.map((item) => item.title), ["第一遍", "空白编号", "第二遍", "缺失编号"]);
  assert.equal(result.patch.activeSubtaskId, "dup");
  assert.deepEqual(result.patch.activeSubtaskIds, ["dup", "dup", "dup", generatedId]);
  assert.deepEqual(stored.map((item) => item.id), ["keep", "dup", generatedId]);
  assert.equal(duplicate?.status, "completed");
  assert.equal(duplicate?.title, "第二遍");
  assert.equal(duplicate?.prompt, "second");
  assert.equal(duplicate?.summary, "旧摘要");
  assert.equal(stored.find((item) => item.id === generatedId)?.status, "running");
  assert.match(generatedId, /^subtask_[0-9a-f]{10}$/);
  assert.deepEqual(getActiveLoopSubtaskIds({
    activeSubtaskId: result.patch.activeSubtaskId,
    activeSubtaskIds: result.patch.activeSubtaskIds,
  }), ["dup", generatedId]);
});

test("blocks continue when subtasks are missing and does not ask the host to append messages", () => {
  for (const decision of [
    { status: "continue" as const },
    { status: "continue" as const, subtasks: [] as [] },
  ]) {
    const result = decide(createTask(), decision);
    assert.equal(result.status, "blocked");
    assert.equal(result.appendDecisionMessages, false);
    assert.equal(result.subtasks, undefined);
    assert.equal(result.patch.status, "needs-review");
    assert.equal(result.patch.finalSummary, "Main task returned continue without subtasks.");
    assert.equal(result.patch.activeSubtaskId, null);
    assert.deepEqual(result.patch.activeSubtaskIds, []);
  }
});

test("routes an unknown main decision status through the continue strategy", () => {
  const task = createTask({ subTasks: [] });
  const result = decide(task, {
    status: "unknown" as LoopMainDecision["status"],
    subtask: { title: "未知状态回退", prompt: "继续" },
  });

  assert.equal(result.status, "continue");
  assert.equal(result.patch.activeSubtaskId, buildLoopSubtaskId("未知状态回退"));
  assert.deepEqual(
    result,
    loopTaskTransitionStrategies.mainDecision.continue({
      task,
      decision: {
        status: "unknown" as LoopMainDecision["status"],
        subtask: { title: "未知状态回退", prompt: "继续" },
      },
      now: NOW,
    }),
  );
});

test("asks the host to count only a classic main error and stops dispatch at the failure limit", () => {
  const running = createTask({ mainAiFailureCount: LOOP_MAIN_AI_FAILURE_LIMIT - 1 });
  const counted = interrupt("classic", {
    task: running,
    status: "error",
    source: "main",
    failureMessage: "boom",
  });
  const failureState = buildNextLoopMainAiFailureState(running, { now: NOW, failureMessage: "boom" });
  const limitPatch = loopInterruptFailureLimitPatch(failureState, "boom");
  const composed = { ...counted.patch, ...failureState, ...limitPatch };

  assert.equal(counted.idempotent, false);
  assert.equal(counted.applyMainAiFailureCount, true);
  assert.equal(counted.appendNeedsReviewMessage, true);
  assert.equal(counted.preserveActivitySnapshot, false);
  assert.equal(counted.patch.status, "error");
  assert.equal(counted.patch.activeSubtaskId, null);
  assert.deepEqual(counted.patch.activeSubtaskIds, []);
  assert.equal(counted.patch.pendingClarification, undefined);
  assert.equal(hasOwn(counted.patch, "mainAiFailureCount"), false);
  assert.equal(hasOwn(counted.patch, "finalSummary"), false);
  assert.equal(failureState.mainAiFailureCount, LOOP_MAIN_AI_FAILURE_LIMIT);
  assert.equal(failureState.mainAiFailureLimitReached, true);
  assert.equal(limitPatch.status, "needs-review");
  assert.equal(limitPatch.finalSummary, [
    `主任务 AI 调用已连续失败 ${LOOP_MAIN_AI_FAILURE_LIMIT}/${LOOP_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`,
    "最近一次失败：boom",
  ].join("\n"));
  assert.equal(composed.status, "needs-review");
  assert.equal(composed.mainAiFailureCount, LOOP_MAIN_AI_FAILURE_LIMIT);

  const below = createTask({ mainAiFailureCount: LOOP_MAIN_AI_FAILURE_LIMIT - 2 });
  const belowFailure = buildNextLoopMainAiFailureState(below, { now: NOW, failureMessage: "temporary" });
  assert.equal(belowFailure.mainAiFailureLimitReached, false);
  assert.deepEqual(loopInterruptFailureLimitPatch(belowFailure, "temporary"), {});
  assert.equal(loopInterruptFailureLimitPatch({
    mainAiFailureCount: 1,
    mainAiFailureLimitReached: true,
  }, null).finalSummary, `主任务 AI 调用已连续失败 1/${LOOP_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`);
  assert.equal(loopInterruptFailureLimitPatch({
    mainAiFailureCount: LOOP_MAIN_AI_FAILURE_LIMIT,
    mainAiFailureLimitReached: false,
  }, "").finalSummary, `主任务 AI 调用已连续失败 ${LOOP_MAIN_AI_FAILURE_LIMIT}/${LOOP_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`);

  const atLimit = createTask({
    mainAiFailureCount: LOOP_MAIN_AI_FAILURE_LIMIT,
    mainAiFailureLimitReached: true,
  });
  const subtaskError = interrupt("classic", {
    task: atLimit,
    status: "error",
    source: "subtask",
    failureMessage: "child failed",
  });
  const mainStopped = interrupt("classic", {
    task: atLimit,
    status: "stopped",
    source: "main",
    failureMessage: "stopped by runtime",
  });
  assert.equal(subtaskError.applyMainAiFailureCount, false);
  assert.equal(subtaskError.patch.status, "error");
  assert.equal(hasOwn(subtaskError.patch, "finalSummary"), false);
  assert.equal(mainStopped.applyMainAiFailureCount, false);
  assert.equal(mainStopped.patch.status, "stopped");
});

test("preserves the event-driven snapshot when an interrupt forces error", () => {
  const task = createTask({
    schedulingMode: "event_driven",
    pendingClarification: createClarification(),
    activeSubtaskId: "sub-a",
    activeSubtaskIds: ["sub-a", "sub-b"],
    mainAiFailureCount: LOOP_MAIN_AI_FAILURE_LIMIT,
    mainAiFailureLimitReached: true,
  });
  const blankMessage = interrupt("event_driven", {
    task,
    status: "stopped",
    source: "main",
    failureMessage: "   ",
  });
  const explicitMessage = interrupt("event_driven", {
    task,
    status: "error",
    source: "main",
    failureMessage: "scheduler exploded",
  });

  assert.equal(blankMessage.idempotent, false);
  assert.equal(blankMessage.preserveActivitySnapshot, true);
  assert.equal(blankMessage.applyMainAiFailureCount, false);
  assert.equal(blankMessage.appendNeedsReviewMessage, true);
  assert.equal(blankMessage.patch.status, "error");
  assert.equal(blankMessage.patch.schedulingMode, "event_driven");
  assert.equal(blankMessage.patch.finalSummary, LOOP_EVENT_DRIVEN_INTERRUPT_SUMMARY);
  assert.equal(hasOwn(blankMessage.patch, "activeSubtaskId"), false);
  assert.equal(hasOwn(blankMessage.patch, "activeSubtaskIds"), false);
  assert.equal(hasOwn(blankMessage.patch, "pendingClarification"), false);
  assert.equal(explicitMessage.patch.finalSummary, "scheduler exploded");
  assert.equal(explicitMessage.applyMainAiFailureCount, false);

  const missingTask = interrupt("event_driven", {
    task: null,
    status: "error",
    source: "main",
    failureMessage: "missing",
  });
  assert.equal(missingTask.idempotent, true);
  assert.equal(missingTask.applyMainAiFailureCount, false);
  assert.deepEqual(missingTask.patch, {});

  const classicMissingTask = interrupt("classic", {
    task: null,
    status: "error",
    source: "main",
  });
  assert.equal(classicMissingTask.idempotent, false);
  assert.equal(classicMissingTask.applyMainAiFailureCount, true);
  assert.equal(classicMissingTask.patch.status, "error");
});

test("ignores a classic or event-driven interrupt when the task is no longer running", () => {
  for (const schedulingMode of [undefined, "classic", "event_driven"] as const) {
    for (const status of ["completed", "needs-review", "error", "stopped"] as const) {
      const ignored = interrupt(schedulingMode, {
        task: createTask({ status }),
        status: "error",
        source: "main",
        failureMessage: "late failure",
      });
      assert.equal(ignored.idempotent, true, `${schedulingMode ?? "classic"}:${status}`);
      assert.equal(ignored.applyMainAiFailureCount, false);
      assert.equal(ignored.appendNeedsReviewMessage, false);
      assert.deepEqual(ignored.patch, {});
    }
  }
});

test("stops classic and event-driven runs differently across subtasks, clarification, and debate participants", () => {
  const options = {
    finalSummary: "用户已停止",
    subtaskSummary: "子任务已停止",
    participantSummary: "参与者已停止",
  };
  const classic = stop("classic", createStopTask(), options);
  const eventDriven = stop("event_driven", createStopTask(), options);
  const classicByDefault = stop(undefined, createTask(), options);
  const participants = classic.patch.debateRounds?.[0].participants ?? [];
  const subtasks = classic.patch.subTasks ?? [];

  assert.equal(classic.idempotent, false);
  assert.equal(classic.preserveActivitySnapshot, false);
  assert.equal(classic.abortClarification, true);
  assert.equal(classic.refreshGroupChat, true);
  assert.equal(classic.activity.persist, true);
  assert.equal(classic.patch.status, "stopped");
  assert.equal(classic.patch.pendingClarification, undefined);
  assert.equal(classic.patch.finalSummary, "用户已停止");
  assert.equal(classic.patch.activeSubtaskId, null);
  assert.deepEqual(classic.patch.activeSubtaskIds, []);
  assert.equal(hasOwn(classic.patch, "schedulingMode"), false);
  assert.equal(classic.patch.subTasks, classic.activity.subTasks);
  assert.equal(classic.patch.debateRounds, classic.activity.debateRounds);
  assert.equal(classicByDefault.preserveActivitySnapshot, false);
  assert.equal(classicByDefault.patch.status, "stopped");

  assert.deepEqual(subtasks.map((item) => [item.id, item.status, item.summary ?? ""]), [
    ["legacy-active", "blocked", "子任务已停止"],
    ["batch-active", "blocked", "子任务已停止"],
    ["pending-one", "blocked", "子任务已停止"],
    ["done-one", "completed", "保持完成"],
    ["skipped-one", "skipped", ""],
  ]);
  assert.equal(subtasks.find((item) => item.id === "done-one")?.updatedAt, 10);
  assert.equal(subtasks.find((item) => item.id === "skipped-one")?.updatedAt, 10);
  assert.equal(participants.find((item) => item.id === "blue")?.status, "stopped");
  assert.equal(participants.find((item) => item.id === "blue")?.summary, "参与者已停止");
  assert.equal(participants.find((item) => item.id === "red")?.status, "stopped");
  assert.equal(participants.find((item) => item.id === "red")?.summary, "已有结论");
  assert.equal(participants.find((item) => item.id === "tester")?.status, "completed");
  assert.equal(participants.find((item) => item.id === "tester")?.updatedAt, 9);
  assert.equal(classic.patch.debateRounds?.[0].status, "stopped");
  assert.equal(classic.patch.debateRounds?.[0].activeSpeaker, undefined);
  assert.equal(classic.patch.debateRounds?.[0].completedAt, NOW);

  assert.equal(eventDriven.idempotent, false);
  assert.equal(eventDriven.preserveActivitySnapshot, true);
  assert.equal(eventDriven.abortClarification, true);
  assert.equal(eventDriven.refreshGroupChat, true);
  assert.equal(eventDriven.activity.persist, false);
  assert.equal(eventDriven.patch.status, "stopped");
  assert.equal(eventDriven.patch.schedulingMode, "event_driven");
  assert.equal(eventDriven.patch.pendingClarification, undefined);
  assert.equal(eventDriven.patch.finalSummary, "用户已停止");
  assert.equal(hasOwn(eventDriven.patch, "activeSubtaskId"), false);
  assert.equal(hasOwn(eventDriven.patch, "activeSubtaskIds"), false);
  assert.equal(hasOwn(eventDriven.patch, "subTasks"), false);
  assert.equal(hasOwn(eventDriven.patch, "debateRounds"), false);
  assert.equal(eventDriven.activity.subTasks.find((item) => item.id === "batch-active")?.status, "blocked");
  assert.equal(eventDriven.activity.debateRounds?.[0].participants.find((item) => item.id === "blue")?.status, "stopped");
  assert.deepEqual(getActiveLoopSubtaskIds(createStopTask()), ["legacy-active", "batch-active"]);
});

test("ignores a second stop once the task is already completed", () => {
  for (const schedulingMode of ["classic", "event_driven"] as const) {
    const task = createStopTask("completed");
    const result = stop(schedulingMode, task, {
      finalSummary: "不应覆盖",
      subtaskSummary: "不应改子任务",
      participantSummary: "不应改参与者",
    });

    assert.equal(result.idempotent, true, schedulingMode);
    assert.equal(result.preserveActivitySnapshot, true);
    assert.equal(result.abortClarification, false);
    assert.equal(result.refreshGroupChat, false);
    assert.equal(result.activity.persist, false);
    assert.deepEqual(result.patch, {});
    assert.equal(result.activity.subTasks, task.subTasks);
    assert.equal(result.activity.debateRounds, task.debateRounds);
    assert.equal(result.activity.debateRounds?.[0].participants.find((item) => item.id === "blue")?.status, "running");
    assert.equal(result.activity.subTasks.find((item) => item.id === "batch-active")?.status, "running");
  }
});

test("dispatches the public stop helpers through the strategy registry", () => {
  const task = createTask();
  assert.deepEqual(
    stop("classic", task),
    loopTaskTransitionStrategies.stop.classic({ task, now: NOW }),
  );
  assert.deepEqual(
    stop("event_driven", task),
    loopTaskTransitionStrategies.stop.event_driven({ task, now: NOW }),
  );
});

test("keeps transition side effects out of the pure state module", () => {
  const source = readFileSync(join(__dirname, "../../../src/extensionHost/loopTaskStateMachine.ts"), "utf8");
  for (const forbidden of [
    "updateLoopTaskRecord",
    "abortOrchestratorClarification",
    "refreshOpenLoopGroupChatPanelForTask",
    "appendLoopMainDecisionSummary",
    "appendSystemMessageForLoop",
    "writeFileSync",
    "appendFileSync",
    "mkdirSync",
    "stopLoopPlusParent",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }

  const hostSource = readFileSync(join(__dirname, "../../../src/extensionHost/promptRunRuntime.ts"), "utf8");
  for (const required of [
    "transitionLoopMainDecision(",
    "transitionLoopTaskStop(",
    "transitionLoopTaskInterrupt(",
    "loopInterruptFailureLimitPatch(",
    "updateLoopTaskRecord(",
    "abortOrchestratorClarification(",
    "appendLoopMainDecisionSummary(",
    "refreshOpenLoopGroupChatPanelForTask(",
  ]) {
    assert.equal(hostSource.includes(required), true, required);
  }
});

test("keeps host loop entry points callable while persistence side effects stay on the host", () => {
  const sideEffects: string[] = [];
  const host = createRuntimeHost(sideEffects);
  const activeView = { activeSubtaskId: "legacy", activeSubtaskIds: [" ", "batch", "legacy"] };
  const decision: LoopMainDecision = {
    status: "continue",
    subtasks: [],
    subtask: { title: "宿主入口", prompt: "只验证公开方法" },
  };

  assert.deepEqual(host.getActiveLoopSubtaskIds(activeView), getActiveLoopSubtaskIds(activeView));
  assert.deepEqual(host.getActiveLoopSubtaskIds(activeView), ["batch", "legacy"]);
  assert.deepEqual(host.getLoopDecisionSubtasks(decision), getLoopDecisionSubtasks(decision));
  assert.equal(host.buildLoopSubtaskId("宿主入口"), buildLoopSubtaskId("宿主入口"));
  assert.equal(host.normalizeLoopMainDecision({
    status: "blocked",
    finalSummary: "需要复核",
  })?.status, "blocked");
  assert.equal(host.normalizeLoopMainDecision({
    status: "blocked",
    finalSummary: "需要复核",
  })?.finalSummary, "需要复核");
  assert.equal(typeof host.applyLoopMainDecision, "function");
  assert.equal(typeof host.markLoopTaskInterrupted, "function");
  assert.equal(typeof host.markLoopTaskStopped, "function");
  assert.equal(typeof host.markLoopTaskStoppedByUser, "function");
  assert.deepEqual(sideEffects, []);
});
