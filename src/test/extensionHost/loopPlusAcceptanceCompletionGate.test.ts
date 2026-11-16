import test = require("node:test");
import assert = require("node:assert/strict");
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
import type { LoopTaskRecord } from "../../loopTaskStore";

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
  assert.match(mains[2].request.prompt, /Loop\+ protocol correction required/);
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
