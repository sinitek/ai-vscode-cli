import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("fs");
import path = require("path");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { schedulingModeForInteractiveMode } = require("../../extensionHost/modelSettings") as typeof import("../../extensionHost/modelSettings");
const { createLoopPlusScheduler } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
const {
  createLoopPlusRuntimeFixture,
  createLoopPlusExtensionStopHarness,
  waitForLoopPlus,
} = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const {
  selectLoopPlusContinuationDetail,
  selectLoopPlusInvocationAssistant,
  selectLoopPlusInvocationRun,
} = require("../../extensionHost/loopPlusRuntimeAdapter") as typeof import("../../extensionHost/loopPlusRuntimeAdapter");

function longPrompt(id: string, file: string): string {
  return `Implement ${id} without editing the parent task record or scheduler snapshot. Write scope: ${file}. Report only the attempt result.`;
}

function decision(value: unknown): string {
  return JSON.stringify(value);
}

function subtask(id: string, file: string, conflictGroup?: string) {
  return {
    id,
    title: id,
    prompt: longPrompt(id, file),
    writeFiles: [file],
    ...(conflictGroup ? { conflictGroup } : {}),
  };
}

function completedDecision(reviewEventId?: string | null): string {
  return decision({
    status: "completed",
    ...(reviewEventId ? { reviewEventId } : {}),
    answerConclusion: "finished",
    finalSummary: "everything passed",
    acceptance: { passed: true, checks: [{ name: "scope", passed: true }] },
    requirementCoverage: [{ name: "scope", passed: true }],
  });
}


function currentEventId(promptText: string): string {
  const match = promptText.match(/Current review eventId: (\S+)/);
  if (!match || match[1] === "(none)") {
    throw new Error("missing current review event id");
  }
  return match[1];
}

function prompt(text = "ship the feature") {
  return {
    displayPrompt: text,
    modelPrompt: text,
    contextTags: [] as string[],
    model: "main-model",
    loopMainModel: "main-model",
    loopSubtaskModel: "sub-model",
    loopMainThinkingMode: "low" as const,
    loopSubtaskThinkingMode: "low" as const,
  };
}

function reportText(rootDir: string): string {
  const commDir = path.join(rootDir, "comm");
  if (!fs.existsSync(commDir)) {
    return "";
  }
  const chunks: string[] = [];
  const stack = [commDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        chunks.push(fs.readFileSync(fullPath, "utf8"));
      }
    }
  }
  return chunks.join("\n");
}

test("adapter runs A review while B is live, then refreshes current and queued finishes", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    let reviewPrompt = "";
    fixture.queueMain(async (input, tabId) => {
      reviewPrompt = input.displayPrompt;
      await fixture.holdMain();
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "wait", subtasks: [] }) });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 2, "both attempts");
    fixture.finishParked("A", { status: "end", content: "A attempt result" });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "one review");
    assert.equal(fixture.mainCalls.length, 2);
    assert.equal(fixture.parkedSubtaskIds().includes("B"), true);
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    const duringReview = fixture.readTask(taskId);
    assert.equal(duringReview?.loopPlus && (duringReview.loopPlus as { currentReview?: { subtaskId?: string } }).currentReview?.subtaskId, "A");
    fixture.finishParked("B", { status: "end", content: "B attempt result" });
    await waitForLoopPlus(() => fixture.refreshes.some((item) => {
      const snapshot = item.snapshot;
      return item.taskId === taskId
        && snapshot?.currentReview?.subtaskId === "A"
        && snapshot.reviewQueue.some((queued) => queued.subtaskId === "B");
    }), "refresh current and queue");
    const stored = fixture.readTask(taskId);
    const snapshot = stored?.loopPlus as { currentReview?: { subtaskId?: string }; reviewQueue?: Array<{ subtaskId?: string }> };
    assert.equal(snapshot.currentReview?.subtaskId, "A");
    assert.equal(snapshot.reviewQueue?.some((item) => item.subtaskId === "B"), true);
    assert.equal(reviewPrompt.includes("subtask=A"), true);
    const report = reportText(fixture.rootDir);
    assert.equal(report.includes("## Attempt result"), true);
    assert.equal(report.includes("outcome: completed"), true);
    assert.equal(report.includes("A attempt result"), true);
    assert.equal(stored?.schedulingMode, "event_driven");
    assert.equal(fixture.adapter.getLivePrompt(taskId)?.displayPrompt, "ship the feature");
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("adapter accepts A by adding C while B keeps running and does not call main again", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [subtask("C", "src/c.ts")],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A started");
    fixture.finishParked("A", { status: "end", content: "A done" });
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("C"), "C started");
    assert.deepEqual(fixture.parkedSubtaskIds().sort(), ["B", "C"]);
    assert.equal(fixture.mainCalls.length, 2);
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    const snapshot = fixture.readTask(taskId)?.loopPlus as { running?: Array<{ subtaskId?: string }> };
    assert.equal(snapshot.running?.some((item) => item.subtaskId === "B"), true);
    assert.equal(snapshot.running?.some((item) => item.subtaskId === "C"), true);
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("adapter accept without new work does not call the main AI while another attempt is running", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A started");
    fixture.finishParked("A", { status: "end", content: "A done" });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "review returned");
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 1, "only B remains");
    assert.deepEqual(fixture.parkedSubtaskIds(), ["B"]);
    assert.equal(fixture.mainCalls.length, 2);
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("adapter enforces write conflicts and the supplied concurrency limit", async () => {
  const conflict = createLoopPlusRuntimeFixture();
  const limited = createLoopPlusRuntimeFixture({ maxConcurrency: 1 });
  try {
    conflict.queueMain(async (input, tabId) => {
      conflict.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src\\shared.ts", "shared"), subtask("B", "src/shared.ts", "shared")],
        }),
      });
    });
    const conflictRun = conflict.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, conflict.target);
    await waitForLoopPlus(() => conflict.parkedSubtaskIds().length === 1, "conflict started one");
    assert.deepEqual(conflict.parkedSubtaskIds(), ["A"]);
    const conflictTask = conflict.readTask(conflict.mainCalls[0].loopTaskId ?? "");
    const conflictSnapshot = conflictTask?.loopPlus as { pending?: Array<{ subtaskId?: string }> };
    assert.equal(conflictSnapshot.pending?.some((item) => item.subtaskId === "B"), true);
    conflictRun.catch(() => undefined);

    limited.queueMain(async (input, tabId) => {
      limited.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    const limitedRun = limited.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, limited.target);
    await waitForLoopPlus(() => limited.parkedSubtaskIds().length === 1, "concurrency started one");
    assert.deepEqual(limited.parkedSubtaskIds(), ["A"]);
    const limitedSnapshot = limited.readTask(limited.mainCalls[0].loopTaskId ?? "")?.loopPlus as { pending?: Array<{ subtaskId?: string }>; running?: unknown[] };
    assert.equal(limitedSnapshot.running?.length, 1);
    assert.equal(limitedSnapshot.pending?.some((item) => item.subtaskId === "B"), true);
    limitedRun.catch(() => undefined);
  } finally {
    conflict.dispose();
    limited.dispose();
  }
});

test("adapter keeps a late sibling finish from turning the parent completed", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts")],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.finishParked("B", { status: "end", content: "B late result" });
      await waitForLoopPlus(() => !fixture.parkedSubtaskIds().includes("B"), "B finished during review");
      fixture.publish(input, tabId, {
        status: "end",
        content: completedDecision(currentEventId(input.displayPrompt)),
      });
    });
    fixture.queueMain(async () => {
      await fixture.holdMain();
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A started");
    fixture.finishParked("A", { status: "end", content: "A result" });
    await waitForLoopPlus(() => fixture.mainCalls.length >= 3, "B review started");
    const task = fixture.readTask(fixture.mainCalls[0].loopTaskId ?? "");
    assert.notEqual(task?.status, "completed");
    assert.equal(fixture.mainCalls[2].displayPrompt.includes("subtask=B"), true);
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("adapter stop keeps resume state, blocks continue while cancellation is live, then reviews explicitly", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.setHoldAbort(true);
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({ status: "dispatch", subtasks: [subtask("A", "src/a.ts")] }),
      });
    });
    const first = fixture.adapter.runEventDriven(prompt("keep the saved prompt"), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().includes("A"), "A parked");
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    fixture.adapter.host().stopParent(taskId);
    await first;
    assert.equal(fixture.readTask(taskId)?.status, "stopped");
    assert.equal(fixture.adapter.getLivePrompt(taskId)?.displayPrompt, "keep the saved prompt");
    assert.equal(fixture.parkedSubtaskIds().includes("A"), true);
    const blocked = fixture.adapter.runEventDriven(prompt("keep the saved prompt"), {
      schedulingMode: undefined,
      resumeTaskId: taskId,
      resumeRequested: true,
    }, fixture.target);
    await waitForLoopPlus(() => fixture.hostMessages.includes("loop-plus-resume-blocked"), "resume blocked");
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(fixture.readTask(taskId)?.status, "stopped");
    blocked.catch(() => undefined);
    fixture.setHoldAbort(false);
    fixture.releaseParked("A");
    await waitForLoopPlus(() => {
      const snapshot = fixture.readTask(taskId)?.loopPlus as { running?: unknown[] } | undefined;
      return Array.isArray(snapshot?.running) && snapshot.running.length === 0;
    }, "cancelled attempt left the scheduler");
    fixture.queueMain(async (input, tabId) => {
      assert.equal(input.displayPrompt.includes("Prompt kind: review"), true);
      assert.equal(input.displayPrompt.includes("subtask=A"), true);
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      assert.equal(input.displayPrompt.includes("Prompt kind: closeout"), true);
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "blocked",
          subtasks: [],
          finalSummary: "stopped attempt reviewed; waiting for a person",
        }),
      });
    });
    await fixture.adapter.runEventDriven(prompt("keep the saved prompt"), {
      resumeTaskId: taskId,
      resumeRequested: true,
    }, fixture.target);
    assert.equal(fixture.mainCalls.length, 3);
    assert.equal(fixture.attemptCalls.length, 1);
    assert.equal(fixture.parkedSubtaskIds().includes("A"), false);
    const resumed = fixture.readTask(taskId);
    const resumedSnapshot = resumed?.loopPlus as { running?: unknown[]; pending?: unknown[]; reviewQueue?: unknown[] } | undefined;
    assert.equal(resumed?.status, "needs-review");
    assert.equal(resumed?.schedulingMode, "event_driven");
    assert.equal(resumedSnapshot?.running?.length, 0);
    assert.equal(resumedSnapshot?.pending?.length, 0);
    assert.equal(resumedSnapshot?.reviewQueue?.length, 0);
    assert.equal(fixture.adapter.getLivePrompt(taskId)?.displayPrompt, "keep the saved prompt");
  } finally {
    fixture.dispose();
  }
});

test("adapter rejects corrupt snapshots, clears live prompts after completion, and keeps pause state", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const now = Date.now();
    fixture.saveTask({
      id: "corrupt",
      cli: "codex",
      workspaceKey: "workspace",
      taskStoreFile: fixture.storeFile,
      rootPrompt: "corrupt",
      executionMode: "main_sub_multi_agent",
      schedulingMode: "event_driven",
      loopPlus: { nope: true },
      status: "running",
      createdAt: now,
      updatedAt: now,
      maxRounds: 20,
      currentRound: 0,
      communicationDir: path.join(fixture.rootDir, "comm", "corrupt"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "corrupt", "main.md"),
      sessionId: "session",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      subTasks: [],
      rounds: [],
      supplementalRequirements: [],
      completionRoundSummaries: [],
      completionRequirementCoverage: [],
    });
    const corruptHandled = await fixture.adapter.runEventDriven(prompt("corrupt"), {
      resumeTaskId: "corrupt",
      resumeRequested: true,
    }, fixture.target);
    assert.equal(corruptHandled, true);
    assert.equal(fixture.readTask("corrupt")?.status, "error");
    assert.equal(fixture.readTask("corrupt")?.schedulingMode, "event_driven");
    assert.equal(fixture.mainCalls.length, 0);

    const scheduler = createLoopPlusScheduler({ maxConcurrency: 1 });
    assert.equal(scheduler.complete().ok, true);
    fixture.saveTask({
      ...(fixture.readTask("corrupt") as NonNullable<ReturnType<typeof fixture.readTask>>),
      id: "done",
      rootPrompt: "done",
      status: "completed",
      schedulingMode: "event_driven",
      loopPlus: scheduler.snapshot(),
      communicationDir: path.join(fixture.rootDir, "comm", "done"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "done", "main.md"),
      updatedAt: Date.now(),
    });
    await fixture.adapter.runEventDriven(prompt("done"), { resumeTaskId: "done", resumeRequested: true }, fixture.target);
    assert.equal(fixture.adapter.getLivePrompt("done"), null);
    assert.equal(fixture.adapter.host().hasController("done"), false);

    const idle = createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot();
    fixture.saveTask({
      ...(fixture.readTask("done") as NonNullable<ReturnType<typeof fixture.readTask>>),
      id: "paused",
      rootPrompt: "paused",
      status: "running",
      schedulingMode: "event_driven",
      loopPlus: idle,
      finalSummary: undefined,
      communicationDir: path.join(fixture.rootDir, "comm", "paused"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "paused", "main.md"),
      updatedAt: Date.now(),
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "wait", subtasks: [] }) });
    });
    await fixture.adapter.runEventDriven(prompt("hold for resume"), {
      resumeTaskId: "paused",
      resumeRequested: true,
    }, fixture.target);
    assert.equal(fixture.readTask("paused")?.status, "needs-review");
    assert.equal(fixture.adapter.getLivePrompt("paused")?.displayPrompt, "hold for resume");
    assert.equal(fixture.readTask("paused")?.supplementalRequirements?.includes("hold for resume"), true);
  } finally {
    fixture.dispose();
  }
});

test("adapter gives saved Loop+ mode priority and does not capture classic, debate, vibe, or graph entry", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const now = Date.now();
    const base = {
      cli: "codex" as const,
      workspaceKey: "workspace",
      taskStoreFile: fixture.storeFile,
      executionMode: "main_sub_multi_agent" as const,
      status: "running" as const,
      createdAt: now,
      updatedAt: now,
      maxRounds: 20,
      currentRound: 0,
      sessionId: "session",
      activeSubtaskId: null,
      activeSubtaskIds: [] as string[],
      subTasks: [],
      rounds: [],
      supplementalRequirements: [] as string[],
      completionRoundSummaries: [],
      completionRequirementCoverage: [],
    };
    fixture.saveTask({
      ...base,
      id: "saved-plus",
      rootPrompt: "saved plus",
      schedulingMode: "event_driven",
      loopPlus: createLoopPlusScheduler({ maxConcurrency: 1 }).snapshot(),
      communicationDir: path.join(fixture.rootDir, "comm", "saved-plus"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "saved-plus", "main.md"),
    });
    fixture.saveTask({
      ...base,
      id: "saved-classic",
      rootPrompt: "saved classic",
      schedulingMode: "classic",
      communicationDir: path.join(fixture.rootDir, "comm", "saved-classic"),
      mainCommunicationFile: path.join(fixture.rootDir, "comm", "saved-classic", "main.md"),
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: decision({ status: "wait", subtasks: [] }) });
    });
    assert.equal(await fixture.adapter.runEventDriven(prompt("manual without mode"), {
      resumeTaskId: "saved-plus",
    }, fixture.target), true);
    assert.equal(fixture.mainCalls.length, 1);
    assert.equal(await fixture.adapter.runEventDriven(prompt("timer asks plus"), {
      schedulingMode: schedulingModeForInteractiveMode("loop_plus"),
      resumeTaskId: "saved-classic",
    }, fixture.target), false);
    assert.equal(fixture.readTask("saved-classic")?.status, "running");
    assert.equal(fixture.readTask("saved-classic")?.schedulingMode, "classic");
    fixture.adapter.host().stopParent("saved-classic");
    assert.equal(fixture.readTask("saved-classic")?.status, "running");
    assert.equal(await fixture.adapter.runEventDriven(prompt("classic manual"), {
      schedulingMode: schedulingModeForInteractiveMode("loop"),
    }, fixture.target), false);
    assert.equal(await fixture.adapter.runEventDriven({
      ...prompt("graph"),
      graphRunId: "graph-1",
    }, { schedulingMode: schedulingModeForInteractiveMode("graph") }, fixture.target), false);
    assert.equal(await fixture.adapter.runEventDriven({
      ...prompt("debate"),
      loopExecutionMode: "debate_multi_agent",
    }, {}, fixture.target), false);
    assert.equal(await fixture.adapter.runEventDriven(prompt("vibe"), {}, fixture.target), false);
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: completedDecision(null) });
    });
    assert.equal(await fixture.adapter.runEventDriven(prompt("timer plus"), {
      schedulingMode: schedulingModeForInteractiveMode("loop_plus"),
    }, fixture.target), true);
    const created = fixture.readTask(fixture.mainCalls[1].loopTaskId ?? "");
    assert.equal(created?.schedulingMode, "event_driven");
    assert.equal(created?.executionMode, "main_sub_multi_agent");
    assert.equal(created?.status, "completed");
    assert.equal(fixture.adapter.getLivePrompt(created?.id ?? ""), null);
    fixture.setSubtaskConversation(true);
    assert.equal(await fixture.adapter.runEventDriven(prompt("nested"), {
      schedulingMode: "event_driven",
    }, fixture.target), true);
    assert.deepEqual(fixture.refusals, ["nested"]);
  } finally {
    fixture.dispose();
  }
});

test("adapter isolates this invocation from old, missing, failed, retried, and late results", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const mainTarget = fixture.target;
    const oldMain = {
      ...prompt("previous main decision"),
      taskRole: "main" as const,
      loopTaskId: "task-main",
      loopRound: 1,
    };
    fixture.seedHistory(oldMain, mainTarget.tabId, {
      content: decision({ status: "dispatch", subtasks: [subtask("OLD", "src/old.ts")] }),
      status: "end",
      prompt: "previous main decision",
    });
    fixture.queueMain(async () => undefined);
    const early = await fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review the new event",
      modelPrompt: "review the new event",
      reviewEventId: "event-new",
      target: mainTarget,
    }).promise;
    assert.equal(early, null);

    fixture.queueMain(async () => {
      throw new Error("main failed");
    });
    await assert.rejects(fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review after failure",
      modelPrompt: "review after failure",
      reviewEventId: "event-fail",
      target: mainTarget,
    }).promise, /main failed/);

    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "stopped" });
    });
    const stopped = await fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review after stop",
      modelPrompt: "review after stop",
      reviewEventId: "event-stop",
      target: mainTarget,
    }).promise;
    assert.equal(stopped, null);

    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        late: true,
        status: "end",
        content: decision({ status: "dispatch", subtasks: [subtask("LATE", "src/late.ts")] }),
        prompt: input.displayPrompt,
      });
    });
    const late = await fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review while old output arrives",
      modelPrompt: "review while old output arrives",
      reviewEventId: "event-late",
      target: mainTarget,
    }).promise;
    assert.equal(late, null);

    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "NEW_MAIN_DECISION" });
    });
    const fresh = await fixture.adapter.runMain({
      taskId: "task-main",
      kind: "review",
      prompt: "review with a new answer",
      modelPrompt: "review with a new answer",
      reviewEventId: "event-fresh",
      target: mainTarget,
    }).promise;
    assert.equal(fresh, "NEW_MAIN_DECISION");

    fixture.setSubtaskTab("seed-sub");
    fixture.seedHistory({
      ...prompt("old subtask prompt"),
      taskRole: "subtask",
      loopTaskId: "task-main",
      loopRound: 1,
      loopSubtaskId: "A",
    }, "seed-sub", {
      content: "OLD_SUBTASK_RESULT",
      status: "end",
      prompt: "old subtask prompt",
    });
    fixture.setAttemptAction(async () => undefined);
    const retried = await fixture.adapter.startAttempt({
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "retry-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(retried.outcome, "failed");
    assert.equal(retried.detail === "OLD_SUBTASK_RESULT", false);

    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, {
        late: true,
        status: "end",
        content: "OLD_SUBTASK_RESULT",
        prompt: input.displayPrompt,
      });
    });
    const lateAttempt = await fixture.adapter.startAttempt({
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "late-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.notEqual(lateAttempt.outcome, "completed");
    assert.equal(lateAttempt.detail === "OLD_SUBTASK_RESULT", false);

    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "stopped", content: "OLD_SUBTASK_RESULT" });
    });
    const stoppedAttempt = await fixture.adapter.startAttempt({
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "stop-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(stoppedAttempt.outcome, "stopped");
    assert.equal(stoppedAttempt.detail === "OLD_SUBTASK_RESULT", false);

    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "NEW_SUBTASK_RESULT" });
    });
    const succeeded = await fixture.adapter.startAttempt({
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "new-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(succeeded.outcome, "completed");
    assert.equal(succeeded.detail, "NEW_SUBTASK_RESULT");
    assert.equal(fixture.executionCwds.filter((cwd) => typeof cwd === "string" && cwd.startsWith(fixture.rootDir)).length > 0, true);
    assert.equal(fixture.rootsDisposed.length >= 4, true);
  } finally {
    fixture.dispose();
  }
});

test("adapter releases execution roots after success, failure, and creation failure", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, { status: "end", content: "root ran" });
    });
    const succeeded = await fixture.adapter.startAttempt({
      taskId: "task-root",
      subtaskId: "root",
      attemptId: "root-1",
      title: "root",
      prompt: longPrompt("root", "src/root.ts"),
      modelPrompt: "model",
      writeFiles: ["src/root.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(succeeded.outcome, "completed");
    assert.deepEqual(fixture.rootsDisposed, [1]);

    fixture.setAttemptAction(async () => {
      throw new Error("prompt failed");
    });
    const failed = await fixture.adapter.startAttempt({
      taskId: "task-root",
      subtaskId: "root",
      attemptId: "root-2",
      title: "root",
      prompt: longPrompt("root", "src/root.ts"),
      modelPrompt: "model",
      writeFiles: ["src/root.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(failed.outcome, "failed");
    assert.equal(failed.detail, "prompt failed");
    assert.deepEqual(fixture.rootsDisposed, [1, 2]);

    fixture.setRootFailure("root failed");
    const unavailable = await fixture.adapter.startAttempt({
      taskId: "task-root",
      subtaskId: "root",
      attemptId: "root-3",
      title: "root",
      prompt: longPrompt("root", "src/root.ts"),
      modelPrompt: "model",
      writeFiles: ["src/root.ts"],
      round: 1,
      targetCli: "codex",
    }).promise;
    assert.equal(unavailable.outcome, "failed");
    assert.equal(unavailable.detail, "root failed");
    assert.deepEqual(fixture.rootsDisposed, [1, 2]);
  } finally {
    fixture.dispose();
  }
});

test("continuation detail uses only the assistant inside the qualifying run", () => {
  const query = {
    taskId: "task-main",
    round: 1,
    role: "subtask" as const,
    subtaskId: "A",
  };
  const run = {
    id: "run-new",
    cli: "codex" as const,
    sessionId: "session",
    prompt: longPrompt("A", "src/a.ts"),
    startedAt: 2_000,
    endedAt: 3_000,
    durationMs: 1_000,
    status: "end" as const,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const oldMessage = {
    id: "old",
    role: "assistant" as const,
    content: "OLD_SUBTASK_RESULT",
    createdAt: 1_000,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const freshMessage = {
    ...oldMessage,
    id: "fresh",
    content: "NEW_SUBTASK_RESULT",
    createdAt: 2_500,
  };
  assert.equal(selectLoopPlusContinuationDetail([oldMessage, freshMessage], run, query), "NEW_SUBTASK_RESULT");
  assert.equal(selectLoopPlusContinuationDetail([oldMessage], run, query), null);
  assert.equal(selectLoopPlusContinuationDetail([oldMessage, freshMessage], { ...run, status: "stopped" }, query), null);
  assert.equal(selectLoopPlusContinuationDetail([oldMessage, freshMessage], { ...run, loopSubtaskId: "B" }, query), null);
  assert.equal(selectLoopPlusContinuationDetail([{
    ...freshMessage,
    loopSubtaskId: "B",
  }], run, query), null);
});

test("report failure pauses without simulating a user parent stop", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  const harness = createLoopPlusExtensionStopHarness({
    getHost: () => fixture.adapter.host(),
    readTask: (taskId) => fixture.readTask(taskId),
  });
  fixture.setCancelInvocation((tabId) => {
    harness.cancelInvocation(tabId);
  });
  try {
    assert.equal(harness.wiredCancelSource.includes("cancelLoopPlusInvocation("), true);
    assert.equal(harness.wiredCancelSource.includes("stopRunForTab("), false);
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "dispatch",
          subtasks: [subtask("A", "src/a.ts"), subtask("B", "src/b.ts"), subtask("C", "src/c.ts")],
        }),
      });
    });
    fixture.queueMain(async (input, tabId) => {
      await fixture.holdMain();
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [subtask("D", "src/d.ts")],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(prompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 3, "A B C running");
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    harness.noteTab(fixture.target.tabId, { taskRole: "main", loopTaskId: taskId });
    for (const parked of fixture.parkedAttempts()) {
      harness.noteTab(parked.tabId, { taskRole: "subtask", loopTaskId: taskId });
      harness.attachParallel(parked.tabId, {
        loopTaskId: taskId,
        taskRole: "subtask",
        onStop: () => {
          if (fixture.parkedSubtaskIds().includes(parked.subtaskId)) {
            fixture.releaseParked(parked.subtaskId);
          }
        },
      });
    }
    fixture.finishParked("A", { status: "end", content: "A attempt result" });
    await waitForLoopPlus(() => fixture.mainCalls.length === 2, "review A");
    harness.attachInteractive(fixture.target.tabId, {
      loopTaskId: taskId,
      taskRole: "main",
      onStop: () => fixture.releaseHeldMain(),
    });
    fixture.setReportFailure("report failure");
    fixture.finishParked("B", { status: "end", content: "B attempt result" });
    await waitForLoopPlus(() => fixture.readTask(taskId)?.status === "error", "error pause");
    const paused = fixture.readTask(taskId);
    const snapshot = paused?.loopPlus as {
      parentStopped?: boolean;
      running?: Array<{ subtaskId: string }>;
      pending?: Array<{ subtaskId: string }>;
      currentReview?: { subtaskId?: string } | null;
    };
    assert.equal(paused?.status, "error");
    assert.equal(snapshot.parentStopped, false);
    assert.equal(snapshot.currentReview?.subtaskId, "A");
    assert.equal(snapshot.running?.some((item) => item.subtaskId === "C"), true);
    assert.equal(snapshot.running?.some((item) => item.subtaskId === "D"), false);
    assert.equal(snapshot.pending?.some((item) => item.subtaskId === "D"), false);
    assert.equal(fixture.parkedSubtaskIds().includes("C"), true);
    assert.deepEqual(fixture.cancelledTabs, [fixture.target.tabId]);
    assert.deepEqual(harness.parentStopIds, []);
    assert.deepEqual(harness.fallbackTaskIds, []);
    assert.deepEqual(harness.stoppedTabs, [fixture.target.tabId]);
    assert.equal(harness.graphStops.length, 0);
    assert.equal(fixture.hostMessages.includes("loop-plus-report-failed"), true);
    assert.equal(fixture.hostMessages.includes("loop-plus-stopped"), false);
    assert.equal((paused?.subTasks ?? []).some((item) => item.id === "D"), false);
    assert.equal(fixture.mainCalls.length, 2);

    fixture.queueMain(async (input, tabId) => {
      assert.equal(input.displayPrompt.includes("subtask=A"), true);
      fixture.publish(input, tabId, {
        status: "end",
        content: decision({
          status: "accept",
          reviewEventId: currentEventId(input.displayPrompt),
          subtasks: [],
        }),
      });
    });
    fixture.queueMain(async (input) => {
      assert.equal(input.displayPrompt.includes("subtask=B"), true);
      await fixture.holdMain();
    });
    const resumed = fixture.adapter.runEventDriven(prompt(), {
      resumeTaskId: taskId,
      resumeRequested: true,
    }, fixture.target);
    await waitForLoopPlus(() => (
      fixture.mainCalls.length >= 4 && fixture.readTask(taskId)?.status === "running"
    ), "explicit resume");
    const resumedTask = fixture.readTask(taskId);
    const resumedSnapshot = resumedTask?.loopPlus as {
      parentStopped?: boolean;
      running?: Array<{ subtaskId: string }>;
    };
    assert.equal(resumedTask?.status, "running");
    assert.equal(resumedSnapshot.parentStopped, false);
    assert.equal(resumedSnapshot.running?.some((item) => item.subtaskId === "C"), true);
    assert.equal(fixture.parkedSubtaskIds().includes("C"), true);
    assert.equal(fixture.attemptCalls.some((call) => call.loopSubtaskId === "D"), false);
    assert.equal((resumedTask?.subTasks ?? []).some((item) => item.id === "D"), false);
    assert.deepEqual(harness.parentStopIds, []);
    running.catch(() => undefined);
    resumed.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("assistant text must fall inside the actual run window and invocation anchor", () => {
  const boundary = {
    messageIds: new Set(["old-assistant", "old-user"]),
    runIds: new Set(["old-run"]),
    startedAt: 100,
  };
  const subtaskQuery = {
    taskId: "task-main",
    round: 1,
    role: "subtask" as const,
    subtaskId: "A",
    displayPrompt: "PROMPT_A",
  };
  const mainQuery = {
    taskId: "task-main",
    round: 1,
    role: "main" as const,
    displayPrompt: "PROMPT_MAIN",
  };
  const run = {
    id: "run-new",
    cli: "codex" as const,
    sessionId: "session",
    prompt: "PROMPT_A",
    startedAt: 200,
    endedAt: 300,
    durationMs: 100,
    status: "end" as const,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const mainRun = {
    ...run,
    id: "run-main",
    prompt: "PROMPT_MAIN",
    taskRole: "main" as const,
    loopSubtaskId: undefined,
  };
  const assistant = {
    role: "assistant" as const,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const mainAssistant = {
    role: "assistant" as const,
    taskRole: "main" as const,
    loopTaskId: "task-main",
    loopRound: 1,
  };
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "stale",
    content: "STALE_BEFORE_ACTUAL_RUN",
    createdAt: 150,
  }], boundary, subtaskQuery, run), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "after",
    content: "AFTER_END",
    createdAt: 350,
  }], boundary, subtaskQuery, run), null);
  assert.equal(selectLoopPlusInvocationAssistant([], boundary, subtaskQuery, run), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "fresh",
    content: "FRESH",
    createdAt: 250,
  }], boundary, subtaskQuery, run), "FRESH");
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "old-assistant",
    content: "REUSED_ID",
    createdAt: 250,
  }], boundary, subtaskQuery, run), null);
  assert.equal(selectLoopPlusInvocationAssistant([
    { ...assistant, id: "dup", content: "FIRST", createdAt: 240 },
    { ...assistant, id: "dup", content: "SECOND", createdAt: 260 },
  ], boundary, subtaskQuery, run), null);
  const invalidRun = { ...run, startedAt: 300, endedAt: 200 };
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...assistant,
    id: "fresh",
    content: "FRESH",
    createdAt: 250,
  }], boundary, subtaskQuery, invalidRun), null);
  assert.equal(selectLoopPlusInvocationRun([invalidRun], boundary, subtaskQuery), null);
  const preloadedUser = {
    id: "user-preload",
    role: "user" as const,
    content: "PROMPT_A",
    createdAt: 120,
    taskRole: "subtask" as const,
    loopTaskId: "task-main",
    loopRound: 1,
    loopSubtaskId: "A",
  };
  const fresh = { ...assistant, id: "fresh", content: "FRESH", createdAt: 250 };
  assert.equal(selectLoopPlusInvocationAssistant([
    preloadedUser,
    fresh,
    {
      id: "user-other",
      role: "user" as const,
      content: "OTHER_PROMPT",
      createdAt: 280,
      taskRole: "subtask" as const,
      loopTaskId: "task-main",
      loopRound: 1,
      loopSubtaskId: "A",
    },
  ], boundary, subtaskQuery, run), "FRESH");
  assert.equal(selectLoopPlusInvocationAssistant([
    preloadedUser,
    fresh,
    { ...preloadedUser, id: "user-b", createdAt: 280, loopSubtaskId: "B" },
  ], boundary, subtaskQuery, run), "FRESH");
  assert.equal(selectLoopPlusInvocationAssistant([
    { ...preloadedUser, id: "old-user", createdAt: 50 },
    fresh,
  ], boundary, subtaskQuery, run), "FRESH");
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...mainAssistant,
    id: "main-stale",
    content: "STALE_BEFORE_ACTUAL_RUN",
    createdAt: 150,
  }], boundary, mainQuery, mainRun), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...mainAssistant,
    id: "main-after",
    content: "AFTER_END",
    createdAt: 350,
  }], boundary, mainQuery, mainRun), null);
  assert.equal(selectLoopPlusInvocationAssistant([], boundary, mainQuery, mainRun), null);
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...mainAssistant,
    id: "main-fresh",
    content: "FRESH_MAIN",
    createdAt: 250,
  }], boundary, mainQuery, mainRun), "FRESH_MAIN");
  assert.equal(selectLoopPlusInvocationAssistant([{
    ...mainAssistant,
    id: "old-assistant",
    content: "REUSED_ID",
    createdAt: 250,
  }], boundary, mainQuery, mainRun), null);

  const continuationQuery = {
    taskId: "task-main",
    round: 1,
    role: "subtask" as const,
    subtaskId: "A",
  };
  assert.equal(selectLoopPlusContinuationDetail([fresh], run, continuationQuery), "FRESH");
  assert.equal(selectLoopPlusContinuationDetail([{
    ...fresh,
    createdAt: 150,
    content: "STALE_BEFORE_ACTUAL_RUN",
  }], run, continuationQuery), null);
  assert.equal(selectLoopPlusContinuationDetail([{
    ...fresh,
    createdAt: 350,
    content: "AFTER_END",
  }], run, continuationQuery), null);
  assert.equal(selectLoopPlusContinuationDetail([], run, continuationQuery), null);
  assert.equal(selectLoopPlusContinuationDetail([
    { ...fresh, id: "dup", createdAt: 150, content: "OLD" },
    { ...fresh, id: "dup", createdAt: 250, content: "NEW" },
  ], run, continuationQuery), null);
});

test("main and attempt reads reject text outside the run, missing text, and reused ids", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    const mainTarget = fixture.target;
    const mainRequest = {
      taskId: "task-main",
      kind: "review" as const,
      prompt: "review the bounded run",
      modelPrompt: "review the bounded run",
      reviewEventId: "event-window",
      target: mainTarget,
    };
    fixture.queueMain(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "STALE_BEFORE_ACTUAL_RUN",
        createdAt: now,
        userCreatedAt: now,
        runStartedAt: now + 1_000,
        runEndedAt: now + 2_000,
      });
    });
    assert.equal(await fixture.adapter.runMain(mainRequest).promise, null);

    fixture.queueMain(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "AFTER_END",
        createdAt: now + 3_000,
        userCreatedAt: now,
        runStartedAt: now,
        runEndedAt: now + 1_000,
      });
    });
    assert.equal(await fixture.adapter.runMain({ ...mainRequest, prompt: "review after the run" }).promise, null);

    fixture.queueMain(async () => undefined);
    assert.equal(await fixture.adapter.runMain({ ...mainRequest, prompt: "review without text" }).promise, null);

    fixture.queueMain(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "FRESH_MAIN",
        createdAt: now + 40,
        userCreatedAt: now,
        runStartedAt: now + 20,
        runEndedAt: now + 80,
      });
    });
    assert.equal(await fixture.adapter.runMain({ ...mainRequest, prompt: "review with fresh text" }).promise, "FRESH_MAIN");

    fixture.seedHistory({
      ...prompt("old main"),
      taskRole: "main",
      loopTaskId: "task-main",
      loopRound: 1,
    }, mainTarget.tabId, {
      content: "OLD_MAIN",
      status: "end",
      prompt: "old main",
      assistantId: "reused-main",
    });
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: "REUSED_MAIN",
        assistantId: "reused-main",
      });
    });
    assert.equal(await fixture.adapter.runMain({ ...mainRequest, prompt: "review with a reused id" }).promise, null);

    const attempt = {
      taskId: "task-main",
      subtaskId: "A",
      attemptId: "window-a",
      title: "A",
      prompt: longPrompt("A", "src/a.ts"),
      modelPrompt: "model",
      writeFiles: ["src/a.ts"],
      round: 1,
      targetCli: "codex" as const,
    };
    fixture.setAttemptAction(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "STALE_BEFORE_ACTUAL_RUN",
        createdAt: now,
        userCreatedAt: now,
        runStartedAt: now + 1_000,
        runEndedAt: now + 2_000,
      });
    });
    const staleAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "stale-a" }).promise;
    assert.notEqual(staleAttempt.detail, "STALE_BEFORE_ACTUAL_RUN");

    fixture.setAttemptAction(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "AFTER_END",
        createdAt: now + 3_000,
        userCreatedAt: now,
        runStartedAt: now,
        runEndedAt: now + 1_000,
      });
    });
    const lateAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "late-window-a" }).promise;
    assert.notEqual(lateAttempt.detail, "AFTER_END");

    fixture.setAttemptAction(async () => undefined);
    const missingAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "missing-a" }).promise;
    assert.equal(missingAttempt.outcome, "failed");

    fixture.setAttemptAction(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "FRESH_ATTEMPT",
        createdAt: now + 40,
        userCreatedAt: now,
        runStartedAt: now + 20,
        runEndedAt: now + 80,
      });
    });
    const freshAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "fresh-a" }).promise;
    assert.equal(freshAttempt.outcome, "completed");
    assert.equal(freshAttempt.detail, "FRESH_ATTEMPT");

    fixture.setSubtaskTab("dup-sub");
    fixture.seedHistory({
      ...prompt("old subtask"),
      taskRole: "subtask",
      loopTaskId: "task-main",
      loopRound: 1,
      loopSubtaskId: "A",
    }, "dup-sub", {
      content: "OLD_SUBTASK_RESULT",
      status: "end",
      prompt: "old subtask",
      assistantId: "reused-attempt",
    });
    fixture.setAttemptAction(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: "REUSED_ATTEMPT",
        assistantId: "reused-attempt",
      });
    });
    const reusedAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "reused-a" }).promise;
    assert.notEqual(reusedAttempt.detail, "REUSED_ATTEMPT");
    assert.notEqual(reusedAttempt.detail, "OLD_SUBTASK_RESULT");

    fixture.setSubtaskTab(null);
    fixture.setAttemptAction(async (input, tabId) => {
      const now = Date.now();
      fixture.publish(input, tabId, {
        status: "end",
        content: "INVALID_WINDOW",
        createdAt: now + 50,
        runStartedAt: now + 200,
        runEndedAt: now + 100,
      });
    });
    const invalidAttempt = await fixture.adapter.startAttempt({ ...attempt, attemptId: "invalid-a" }).promise;
    assert.equal(invalidAttempt.outcome, "failed");
    assert.notEqual(invalidAttempt.detail, "INVALID_WINDOW");
  } finally {
    fixture.dispose();
  }
});
