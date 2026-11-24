import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import {
  createLoopPlusOrchestrationHost,
  type LoopPlusAttemptRequest,
  type LoopPlusAttemptResult,
  type LoopPlusMainHandle,
  type LoopPlusMainRequest,
  type LoopPlusOrchestrationDeps,
  type LoopPlusPromptTarget,
} from "../../extensionHost/loopPlusOrchestration";
import { loopPlusAcceptanceChecksFixture } from "../loopPlusAcceptFixture";
import { loopSubtaskAutoCompactions } from "../../loopSubtaskAutoCompact";
import { buildLoopPlusFinishEventId, type LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import type { LoopTaskRecord } from "../../loopTaskStore";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();
const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function taskRecord(id: string, snapshot: LoopTaskRecord["loopPlus"]): LoopTaskRecord {
  return {
    id, cli: "codex", workspaceKey: "workspace", taskStoreFile: `/tmp/${id}/loop-tasks.json`,
    rootPrompt: "complete the feature", schedulingMode: "event_driven", loopPlus: snapshot,
    status: "running", createdAt: 1, updatedAt: 1, maxRounds: 20, currentRound: 0,
    communicationDir: `/tmp/${id}`, mainCommunicationFile: `/tmp/${id}/main.md`, sessionId: "session",
    activeSubtaskId: null, activeSubtaskIds: [], subTasks: [], rounds: [],
    supplementalRequirements: [], completionRoundSummaries: [], completionRequirementCoverage: [],
    loopPlusAcceptancePlan: {
      id: "selected", name: "Security", checks: ["security"], otherText: "", systemDefault: false,
    },
  };
}

function acceptance(passed: boolean, reason: string) {
  return {
    status: "completed",
    answerConclusion: "Feature complete",
    finalSummary: "Feature and repair complete",
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    requirementCoverage: [{ name: "requested behavior", passed: true, detail: "implemented" }],
    acceptancePlanResults: [{ key: "security", passed, reason }],
  };
}

test("failed supplemental completion is corrected, repaired, and remains behind host completion gates", { timeout: 5000 }, async () => {
  const tasks = new Map<string, LoopTaskRecord>();
  const mains: Array<{ request: LoopPlusMainRequest; gate: Deferred<string | null> }> = [];
  const attempts: Array<{ request: LoopPlusAttemptRequest; gate: Deferred<LoopPlusAttemptResult> }> = [];
  const messages: string[] = [];
  const completed: string[] = [];
  const target: LoopPlusPromptTarget = { tabId: "main", cli: "codex", sessionId: "session" };
  const deps: LoopPlusOrchestrationDeps = {
    launchDelayMs: () => 0,
    delay: async () => undefined,
    readTask: (id) => tasks.get(id) ?? null,
    createTask: ({ snapshot, prompt }) => {
      const task = taskRecord("completion-gate", snapshot);
      task.rootPrompt = prompt.displayPrompt;
      tasks.set(task.id, task);
      return task;
    },
    updateTask: (id, patch) => {
      const current = tasks.get(id);
      if (!current) return null;
      const next = { ...current, ...patch, id };
      tasks.set(id, next);
      return next;
    },
    appendMessage: (_target, message) => { messages.push(message); },
    onTaskCompleted: (id) => { completed.push(id); },
    runMain: (request): LoopPlusMainHandle => {
      const gate = deferred<string | null>();
      mains.push({ request, gate });
      return { promise: gate.promise, abort: () => gate.resolve(null) };
    },
    startAttempt: (request) => {
      const gate = deferred<LoopPlusAttemptResult>();
      attempts.push({ request, gate });
      return { promise: gate.promise, abort: () => gate.resolve({ outcome: "stopped", detail: "aborted" }) };
    },
  };
  const host = createLoopPlusOrchestrationHost(deps);
  const run = host.tryRun({ displayPrompt: "Implement and verify the feature" }, target, { schedulingMode: "event_driven" });
  const id = run.taskId ?? "";
  await flush();
  mains[0].gate.resolve(JSON.stringify({
    status: "dispatch",
    subtasks: [{
      id: "feature", title: "Feature", prompt: "Implement the feature, run the relevant checks, and report evidence with enough context for the parent task to review the actual result.",
      writeFiles: ["src/feature.ts"],
    }],
  }));
  await flush();
  attempts[0].gate.resolve({ outcome: "completed", detail: "feature implemented" });
  await flush();

  const firstReview = mains[1];
  firstReview.gate.resolve(JSON.stringify({
    ...acceptance(false, "security failure remains"),
    reviewEventId: firstReview.request.reviewEventId,
  }));
  await flush();
  assert.equal(tasks.get(id)?.status, "running");
  assert.equal(completed.length, 0);
  assert.equal(messages.includes("loop-plus-completed"), false);
  assert.match(mains[2].request.prompt, /Loop\+ 继续执行/);
  assert.match(mains[2].request.prompt, /附加验收失败/);
  assert.equal(mains[2].request.reviewEventId, firstReview.request.reviewEventId);

  mains[2].gate.resolve(JSON.stringify({
    status: "accept",
    progressPercent: 23,
    reviewEventId: firstReview.request.reviewEventId,
    reviews: [{ reviewEventId: firstReview.request.reviewEventId, acceptance: "failed", reason: "security check failed", subtaskIds: ["repair"] }],
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
    acceptancePlanResults: [{ key: "security", passed: false, reason: "security check failed" }],
    subtasks: [{
      id: "repair", title: "Repair security issue", prompt: "Fix the failed security check and verify it with sufficient context in the intended environment.",
      writeFiles: ["src/feature.ts"],
    }],
  }));
  await flush();
  assert.equal(attempts.length, 2);
  attempts[1].gate.resolve({ outcome: "completed", detail: "security issue fixed" });
  await flush();

  const repairReview = mains[3];
  host.submitUserMessage(id, "late requirement");
  repairReview.gate.resolve(JSON.stringify({
    ...acceptance(true, "security check passed"),
    reviewEventId: repairReview.request.reviewEventId,
  }));
  await flush();
  assert.equal(tasks.get(id)?.status, "running");
  assert.equal(completed.length, 0);
  assert.equal(messages.includes("loop-plus-completed"), false);
  const firstUserDecision = mains[4];
  assert.equal(firstUserDecision.request.kind, "user");
  assert.match(firstUserDecision.request.prompt, /late requirement/);
  host.submitUserMessage(id, "message during user decision");
  firstUserDecision.gate.resolve(JSON.stringify(acceptance(true, "security check passed")));
  await flush();
  assert.equal(tasks.get(id)?.status, "running");
  assert.equal(completed.length, 0);
  assert.equal(messages.includes("loop-plus-completed"), false);
  const finalUserDecision = mains[5];
  assert.equal(finalUserDecision.request.kind, "user");
  assert.match(finalUserDecision.request.prompt, /message during user decision/);
  finalUserDecision.gate.resolve(JSON.stringify(acceptance(true, "security check passed")));
  await flush();
  assert.equal(tasks.get(id)?.status, "completed", JSON.stringify({
    mains: mains.map((main) => ({ kind: main.request.kind, reviewEventId: main.request.reviewEventId, prompt: main.request.prompt.slice(-700) })),
    snapshot: tasks.get(id)?.loopPlus,
  }));
  await run.done;
  assert.equal(tasks.get(id)?.status, "completed");
  assert.deepEqual(completed, [id]);
  assert.equal(messages.filter((message) => message === "loop-plus-completed").length, 1);
});

for (const outcome of ["failed", "stopped"] as const) {
  test(`Loop+ rejects passed accept and completed for a frozen ${outcome} attempt`, { timeout: 5000 }, async () => {
    const fixture = createLoopPlusRuntimeFixture();
    const subtaskId = "write-note";
    const prompt = "Write a one-line note and report the result";
    let running: Promise<boolean> | undefined;
    try {
      fixture.queueMain((input, tabId) => fixture.publish(input, tabId, { status: "end", content: JSON.stringify({
        status: "dispatch",
        subtasks: [{
          id: subtaskId, title: "Write a note", writeFiles: ["note.txt"],
          prompt: "Write a one-line note to note.txt in the isolated workspace and report the content for review.",
        }],
      }) }));
      for (const stage of ["review", "accept correction", "completed correction", "closeout"]) {
        fixture.queueMain((_input, tabId) => {
          assert.equal(tabId, fixture.target.tabId, stage);
          return fixture.holdMain();
        });
      }
      running = fixture.adapter.runEventDriven({
        displayPrompt: prompt, modelPrompt: prompt, contextTags: [],
        loopMainModel: "main-model", loopSubtaskModel: "sub-model",
      }, { schedulingMode: "event_driven" }, fixture.target);

      await waitForLoopPlus(() => fixture.peekParked(subtaskId) !== null, "subtask invocation parked");
      const [taskId] = fixture.createdTaskIds;
      const attemptId = fixture.peekParked(subtaskId)?.input.loopAttemptId;
      assert.ok(attemptId);
      const reviewEventId = buildLoopPlusFinishEventId(subtaskId, attemptId);
      const detail = outcome === "failed" ? "could not write note.txt" : "lost-process";
      fixture.finishParked(subtaskId, outcome === "failed"
        ? { attemptId, status: "error", failureDetail: detail }
        : { attemptId, status: "stopped" });

      const readRunningSnapshot = () => {
        const task = fixture.readTask(taskId);
        const snapshot = task?.loopPlus as LoopPlusSchedulerSnapshot | undefined;
        assert.ok(snapshot);
        assert.equal(task?.status, "running");
        assert.equal(snapshot.parentStopped, false);
        assert.equal(snapshot.completed, false);
        assert.equal(task?.subTasks.find((item) => item.id === subtaskId)?.status, "blocked");
        assert.equal(fixture.hostMessages.includes("loop-plus-completed"), false);
        assert.deepEqual(fixture.completionMessages, []);
        return snapshot;
      };
      if (outcome === "stopped") {
        await waitForLoopPlus(() => fixture.logs.some(({ event }) => event === "loop-plus-subtask-interrupted"), "stopped execution parked for continuation");
        const interrupted = readRunningSnapshot();
        assert.equal(interrupted.currentReview, null);
        assert.deepEqual(interrupted.running.map((attempt) => attempt.attemptId), [attemptId]);
        assert.equal(fixture.adapter.host().notifySubtaskContinuation(
          taskId, subtaskId, outcome, detail, undefined, undefined, attemptId,
        ), true);
      }
      const assertFrozenReview = (mainIndex: number) => {
        const snapshot = readRunningSnapshot();
        assert.deepEqual(snapshot.currentReview, { eventId: reviewEventId, subtaskId, attemptId, outcome, detail });
        assert.deepEqual(snapshot.running, []);
        assert.deepEqual(snapshot.reviewQueue, []);
        assert.deepEqual(snapshot.reportQueue ?? [], []);
        const attempt = snapshot.seenAttempts.find((item) => item.attemptId === attemptId);
        assert.equal(attempt?.outcome, outcome);
        assert.equal(attempt.disposition, "finished");
        assert.equal(attempt.acceptance, undefined);
        const input = fixture.mainCalls[mainIndex];
        assert.equal(input.displayPrompt.match(/Current review eventId: (\S+)/)?.[1], reviewEventId);
        return input;
      };
      const reply = (input: (typeof fixture.mainCalls)[number], response: object) => {
        fixture.publish(input, fixture.target.tabId, { status: "end", content: JSON.stringify(response) });
        fixture.releaseHeldMain();
      };
      const { acceptancePlanResults: _unused, ...completion } = acceptance(true, "note verified");
      const accept = { status: "accept", reviewEventId, progressPercent: 25, acceptance: completion.acceptance };

      await waitForLoopPlus(() => fixture.mainCalls.length === 2, "initial review requested");
      reply(assertFrozenReview(1), {
        ...accept,
        reviews: [{ reviewEventId, acceptance: "passed", reason: "claimed the note was written" }],
      });
      await waitForLoopPlus(() => fixture.mainCalls.length === 3, "passed accept rejected");
      const acceptCorrection = assertFrozenReview(2);
      assert.match(acceptCorrection.modelPrompt, /执行失败或停止的事件不能验收通过/);
      reply(acceptCorrection, { ...completion, reviewEventId });

      await running;
      assert.equal(fixture.readTask(taskId)?.status, "needs-review");
      assert.match(fixture.readTask(taskId)?.finalSummary ?? "", /执行失败或停止的事件不能验收通过/);
      assert.equal(fixture.mainCalls.length, 3);
      assert.equal((fixture.readTask(taskId)?.loopPlus as LoopPlusSchedulerSnapshot).currentReview?.eventId, reviewEventId);
      running = fixture.adapter.runEventDriven({ displayPrompt: "继续", modelPrompt: "继续", contextTags: [] }, {
        schedulingMode: "event_driven", resumeTaskId: taskId, resumeRequested: true,
      }, fixture.target);
      await waitForLoopPlus(() => fixture.mainCalls.length === 4, "manual continuation retained the review");
      const completedCorrection = assertFrozenReview(3);
      assert.match(completedCorrection.modelPrompt, /执行失败或停止的事件不能验收通过/);
      const reason = "the execution did not write the note";
      const noRepairReason = "record the failure without retrying this attempt";
      reply(completedCorrection, {
        ...accept,
        reviews: [{ reviewEventId, acceptance: "failed", reason, noRepairReason }],
        acceptance: {
          passed: false,
          checks: loopPlusAcceptanceChecksFixture().map((check, index) => index === 0
            ? { ...check, passed: false, detail: reason } : check),
        },
      });

      await waitForLoopPlus(() => fixture.mainCalls.length === 5, "failed review consumed and closeout held");
      const reviewed = readRunningSnapshot();
      assert.equal(reviewed.currentReview, null);
      assert.deepEqual(reviewed.reviewQueue, []);
      assert.deepEqual(reviewed.reportQueue ?? [], []);
      const attempt = reviewed.seenAttempts.find((item) => item.attemptId === attemptId);
      assert.equal(attempt?.outcome, outcome);
      assert.equal(attempt.disposition, "reviewed");
      assert.equal(attempt.acceptance, "failed");
      assert.equal(attempt.noRepairReason, noRepairReason);
      assert.deepEqual(fixture.attemptCalls.map((input) => input.loopAttemptId), [attemptId]);
    } finally {
      fixture.adapter.host().stopParent(fixture.createdTaskIds[0] ?? "");
      fixture.releaseHeldMain();
      try {
        await running;
      } finally {
        fixture.dispose();
      }
    }
  });
}

for (const scenario of ["success", "compact-failure", "compact-skipped", "report-failure", "commit-failure"] as const) {
  test(`Loop+ closes the completed attempt's tab only after committing its event: ${scenario}`, { timeout: 5000 }, async (t) => {
    const sessionId = `close-before-compact-${scenario}`;
    const compactGate = deferred<void>();
    const compactErrors: string[] = [];
    const logger = require("../../logger") as typeof import("../../logger");
    t.mock.method(logger, "logError", async (event: string) => { compactErrors.push(event); });
    let taskId = "";
    let savedEventId: string | undefined;
    let tabsAtCommit: string[] | undefined;
    let commitRejected = false;
    let observedAtCompact: { eventId: string | undefined; closedTabs: string[] } | undefined;
    const fixture = createLoopPlusRuntimeFixture({
      taskPersistenceFactory: (rootDir) => {
        const storeFile = path.join(rootDir, "isolated-task.json");
        const read = (): LoopTaskRecord => JSON.parse(fs.readFileSync(storeFile, "utf8"));
        const save = (task: LoopTaskRecord): void => fs.writeFileSync(storeFile, JSON.stringify(task));
        return {
          create: (task) => { save(task); return task; },
          read: () => fs.existsSync(storeFile) ? read() : null,
          save,
          remove: () => fs.rmSync(storeFile, { force: true }),
          update: (_taskId, patch) => {
            const next = { ...read(), ...patch };
            const eventId = (next.loopPlus as LoopPlusSchedulerSnapshot | undefined)?.currentReview?.eventId;
            if (eventId && !savedEventId && next.status !== "error") {
              if (scenario === "commit-failure") {
                commitRejected = true;
                throw new Error("controlled finish event write failure");
              }
              tabsAtCommit = [...fixture.closedSubtaskTabs];
              save(next);
              savedEventId = (read().loopPlus as LoopPlusSchedulerSnapshot | undefined)?.currentReview?.eventId;
            } else {
              save(next);
            }
            return read();
          },
        };
      },
    });

    try {
      if (scenario === "report-failure") fixture.setReportFailure("controlled report write failure");
      fixture.queueMain((input, tabId) => {
        taskId = input.loopTaskId!;
        fixture.publish(input, tabId, { status: "end", content: JSON.stringify({
          status: "dispatch",
          subtasks: [{
            id: "write-note", title: "Write a note", writeFiles: ["note.txt"],
            prompt: "Write a one-line note to note.txt in the isolated workspace and report the content for review.",
          }],
        }) });
      });
      fixture.queueMain((input, tabId) => {
        const reviewEventId = (fixture.readTask(taskId)?.loopPlus as LoopPlusSchedulerSnapshot | undefined)?.currentReview?.eventId;
        const { acceptancePlanResults: _unused, ...response } = acceptance(true, "note verified");
        fixture.publish(input, tabId, { status: "end", content: JSON.stringify({ ...response, reviewEventId }) });
      });
      fixture.setAttemptAction((input, tabId) => {
        fixture.publish(input, tabId, { status: "end", content: "note.txt written" });
        loopSubtaskAutoCompactions.defer(input, { cli: "codex", tabId, sessionId }, async () => {
          observedAtCompact = {
            eventId: savedEventId,
            closedTabs: [...fixture.closedSubtaskTabs],
          };
          if (scenario === "compact-skipped") return;
          await compactGate.promise;
          if (scenario === "compact-failure") throw new Error("controlled compaction failure");
        });
      });
      await fixture.adapter.runEventDriven({
        displayPrompt: "Write a one-line note", modelPrompt: "Write a one-line note", contextTags: [],
        loopMainModel: "main-model", loopSubtaskModel: "sub-model",
      }, { schedulingMode: "event_driven" }, fixture.target);

      if (scenario === "report-failure" || scenario === "commit-failure") {
        assert.equal(fixture.readTask(taskId)?.status, "error");
        assert.equal(commitRejected, scenario === "commit-failure");
        assert.equal(savedEventId, undefined);
        assert.equal(observedAtCompact, undefined);
        assert.deepEqual(fixture.closedSubtaskTabs, []);
      } else {
        assert.equal(fixture.readTask(taskId)?.status, "completed");
        const completedTabs = [fixture.createdSubtaskTargets[0].tabId];
        assert.ok(savedEventId);
        assert.deepEqual(tabsAtCommit, []);
        assert.deepEqual(observedAtCompact, { eventId: savedEventId, closedTabs: completedTabs });
        assert.deepEqual(fixture.closedSubtaskTabs, completedTabs);
        assert.equal(loopSubtaskAutoCompactions.has("codex", sessionId), scenario !== "compact-skipped");
      }
      compactGate.resolve();
      await loopSubtaskAutoCompactions.wait("codex", sessionId);
      assert.deepEqual(compactErrors, scenario === "compact-failure" ? ["loop-subtask-auto-compact-failed"] : []);
    } finally {
      compactGate.resolve();
      await loopSubtaskAutoCompactions.wait("codex", sessionId);
      fixture.dispose();
    }
  });
}
