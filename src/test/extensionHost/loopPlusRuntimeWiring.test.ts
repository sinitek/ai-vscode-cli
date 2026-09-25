import test = require("node:test");
import assert = require("node:assert/strict");
import type {
  LoopPlusAttemptRequest,
  LoopPlusAttemptResult,
  LoopPlusMainRequest,
  LoopPlusOrchestrationDeps,
  LoopPlusPromptTarget,
} from "../../extensionHost/loopPlusOrchestration";
import type { LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import type { LoopSubtaskDecision, LoopTaskRecord } from "../../loopTaskStore";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  createLoopPlusPersistedTaskRefresher,
  loopPlusResumeRefusal,
  mergeLoopPlusResumeContinueInstruction,
  resolveLoopPlusAttemptOutcome,
  resolveLoopPlusPromptRoleBinding,
  shouldBindLoopPlusResumeTarget,
  shouldCloseLoopPlusParentGateBeforeAbort,
  withLoopPlusExecutionRoot,
} = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
const {
  createLoopPlusOrchestrationHost,
} = require("../../extensionHost/loopPlusOrchestration") as typeof import("../../extensionHost/loopPlusOrchestration");
const {
  createLoopPlusExtensionStopHarness,
  createLoopPlusRuntimeFixture,
  waitForLoopPlus,
} = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type MainCall = {
  request: LoopPlusMainRequest;
  resolve: (value: string | null) => void;
};

type AttemptCall = {
  request: LoopPlusAttemptRequest;
  resolve: (value: LoopPlusAttemptResult) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function subtask(id: string, file: string): LoopSubtaskDecision {
  return {
    id,
    title: id,
    prompt: `Implement ${id} without editing the parent task record. Write scope: ${file}. Report only the attempt result.`,
    writeFiles: [file],
  };
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

test("refreshes the open task surfaces only after the latest snapshot is stored", () => {
  const order: string[] = [];
  const refresh = createLoopPlusPersistedTaskRefresher({
    updateTask: () => {
      order.push("persist");
      return null;
    },
    refreshTaskSurfaces: () => {
      order.push("refresh");
    },
  });
  assert.equal(refresh("task-1", { status: "running" }), null);
  assert.deepEqual(order, ["persist", "refresh"]);
});

test("refreshes the queue when B finishes while A is still under review", async () => {
  const tasks = new Map<string, LoopTaskRecord>();
  const refreshes: LoopPlusSchedulerSnapshot[] = [];
  const mains: MainCall[] = [];
  const attempts: AttemptCall[] = [];
  let taskSeq = 0;
  const target: LoopPlusPromptTarget = { tabId: "tab-main", cli: "codex", sessionId: "session" };
  const persist = (taskId: string, patch: Partial<LoopTaskRecord>): LoopTaskRecord | null => {
    const existing = tasks.get(taskId);
    if (!existing) {
      return null;
    }
    const next = { ...existing, ...patch, id: existing.id };
    tasks.set(taskId, next);
    return next;
  };
  const deps: LoopPlusOrchestrationDeps = {
    maxConcurrency: 6,
    launchDelayMs: () => 0,
    delay: async () => undefined,
    readTask: (taskId) => tasks.get(taskId) ?? null,
    createTask: (input) => {
      taskSeq += 1;
      const task = baseTask(`task-${taskSeq}`, input.snapshot);
      task.rootPrompt = input.rootPrompt;
      task.sessionId = input.sessionId;
      tasks.set(task.id, task);
      return task;
    },
    updateTask: createLoopPlusPersistedTaskRefresher({
      updateTask: persist,
      refreshTaskSurfaces: (taskId) => {
        const snapshot = tasks.get(taskId)?.loopPlus as LoopPlusSchedulerSnapshot | undefined;
        if (snapshot) {
          refreshes.push(snapshot);
        }
      },
    }),
    appendMessage: () => undefined,
    runMain: (request) => {
      const gate = deferred<string | null>();
      mains.push({ request, resolve: gate.resolve });
      return { promise: gate.promise, abort: () => gate.resolve(null) };
    },
    startAttempt: (request) => {
      const gate = deferred<LoopPlusAttemptResult>();
      attempts.push({ request, resolve: gate.resolve });
      return {
        promise: gate.promise,
        abort: () => gate.resolve({ outcome: "stopped", detail: "aborted" }),
      };
    },
  };
  const host = createLoopPlusOrchestrationHost(deps);
  host.tryRun({ displayPrompt: "ship the feature" }, target, { schedulingMode: "event_driven" });
  await flush();
  mains[0].resolve(JSON.stringify({
    status: "dispatch",
    subtasks: [subtask("alpha", "src/alpha.ts"), subtask("beta", "src/beta.ts")],
  }));
  await flush();
  const alpha = attempts.find((item) => item.request.subtaskId === "alpha");
  const beta = attempts.find((item) => item.request.subtaskId === "beta");
  assert.ok(alpha && beta);
  alpha.resolve({ outcome: "completed", detail: "alpha done" });
  await flush();
  beta.resolve({ outcome: "completed", detail: "beta done" });
  await flush();

  const queued = refreshes.find((snapshot) => (
    snapshot.currentReview?.subtaskId === "alpha"
    && snapshot.reviewQueue.some((item) => item.subtaskId === "beta")
  ));
  assert.ok(queued);
  assert.equal(queued?.reviewQueue.find((item) => item.subtaskId === "beta")?.outcome, "completed");
});

test("does not treat a locally stopped subtask tab as completed and closes only the parent gate first", () => {
  assert.equal(resolveLoopPlusAttemptOutcome({
    aborted: false,
    thrown: false,
    runStatus: "stopped",
  }), "stopped");
  assert.equal(resolveLoopPlusAttemptOutcome({
    aborted: false,
    thrown: false,
    runStatus: "end",
  }), "completed");
  assert.equal(resolveLoopPlusAttemptOutcome({
    aborted: true,
    thrown: false,
    runStatus: "end",
  }), "stopped");
  assert.equal(resolveLoopPlusAttemptOutcome({
    aborted: false,
    thrown: true,
    runStatus: null,
  }), "failed");
  assert.equal(shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: "event_driven",
    taskRole: "main",
    gateAlreadyClosing: false,
  }), true);
  assert.equal(shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: "event_driven",
    taskRole: "main",
    gateAlreadyClosing: true,
  }), false);
  assert.equal(shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: "event_driven",
    taskRole: "subtask",
    gateAlreadyClosing: false,
  }), false);
  assert.equal(shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: "classic",
    taskRole: "main",
    gateAlreadyClosing: false,
  }), false);
  assert.equal(shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: undefined,
    taskRole: "main",
    gateAlreadyClosing: false,
  }), false);
});

test("keeps resume bindings, compatibility, and supplemental continue instructions", () => {
  assert.equal(shouldBindLoopPlusResumeTarget({
    resumeRequested: true,
    preserveLoopOrigin: false,
    sameWorkspace: true,
    runtimeTargetDiffers: true,
  }), true);
  assert.equal(shouldBindLoopPlusResumeTarget({
    resumeRequested: true,
    preserveLoopOrigin: true,
    sameWorkspace: true,
    runtimeTargetDiffers: true,
  }), false);
  assert.equal(loopPlusResumeRefusal({
    hasExistingTask: true,
    resumeRequested: true,
    preserveLoopOrigin: false,
    compatible: false,
  }), "incompatible");
  assert.equal(loopPlusResumeRefusal({
    hasExistingTask: false,
    resumeRequested: true,
    preserveLoopOrigin: true,
    compatible: false,
  }), "original-unavailable");
  assert.equal(loopPlusResumeRefusal({
    hasExistingTask: true,
    resumeRequested: true,
    preserveLoopOrigin: false,
    compatible: true,
  }), null);

  assert.deepEqual(mergeLoopPlusResumeContinueInstruction(
    ["keep the public API stable"],
    "also cover the queue refresh",
    "continue",
  ), ["keep the public API stable", "also cover the queue refresh"]);
  assert.equal(mergeLoopPlusResumeContinueInstruction(
    ["keep the public API stable"],
    "continue",
    "continue",
  ), null);
  assert.equal(mergeLoopPlusResumeContinueInstruction(
    ["also cover the queue refresh"],
    "also cover the queue refresh",
    "continue",
  ), null);

  const saved = {
    modelRouting: {
      main: { model: "origin-main" },
      subtask: { model: "origin-sub" },
    },
    originProfile: {
      configId: "origin",
      mainThinkingMode: "low" as const,
      subtaskThinkingMode: "low" as const,
    },
  };
  assert.equal(resolveLoopPlusPromptRoleBinding({ role: "main", task: saved, live: null }).model, "origin-main");
  assert.equal(resolveLoopPlusPromptRoleBinding({ role: "subtask", task: saved, live: null }).model, "origin-sub");
  assert.equal(resolveLoopPlusPromptRoleBinding({ role: "subtask", task: saved, live: null }).loopSubtaskThinkingMode, "low");
  const rebound = resolveLoopPlusPromptRoleBinding({
    role: "main",
    task: saved,
    live: {
      loopMainModel: "new-main",
      loopSubtaskModel: "new-sub",
      loopMainThinkingMode: "high",
      loopSubtaskThinkingMode: "medium",
    },
  });
  assert.equal(rebound.model, "new-main");
  assert.equal(rebound.loopSubtaskModel, "new-sub");
  assert.equal(rebound.loopMainThinkingMode, "high");
  assert.equal(rebound.loopSubtaskThinkingMode, "medium");
  assert.equal(saved.modelRouting.main.model, "origin-main");
});

test("disposes a Loop+ execution root after success or failure and reports creation failure", async () => {
  let disposed = 0;
  const succeeded = await withLoopPlusExecutionRoot(
    () => ({ dispose: () => { disposed += 1; } }),
    async (root) => {
      assert.ok(root);
      return "ran";
    },
  );
  assert.equal(succeeded.ok, true);
  if (succeeded.ok) {
    assert.equal(succeeded.value, "ran");
  }
  assert.equal(disposed, 1);

  let failedDisposed = 0;
  await assert.rejects(withLoopPlusExecutionRoot(
    () => ({ dispose: () => { failedDisposed += 1; } }),
    async () => {
      throw new Error("prompt failed");
    },
  ));
  assert.equal(failedDisposed, 1);

  let unexpectedDispose = 0;
  const failedCreate = await withLoopPlusExecutionRoot(
    () => {
      unexpectedDispose += 1;
      throw new Error("root failed");
    },
    async () => "unused",
  );
  assert.equal(failedCreate.ok, false);
  if (!failedCreate.ok) {
    assert.equal(failedCreate.error instanceof Error && failedCreate.error.message, "root failed");
  }
  assert.equal(unexpectedDispose, 1);
});

function dispatchPrompt() {
  return {
    displayPrompt: "ship the feature",
    modelPrompt: "ship the feature",
    contextTags: [] as string[],
    model: "main-model",
    loopMainModel: "main-model",
    loopSubtaskModel: "sub-model",
    loopMainThinkingMode: "low" as const,
    loopSubtaskThinkingMode: "low" as const,
  };
}

function wiringSubtask(id: string, file: string) {
  return {
    id,
    title: id,
    prompt: `Implement ${id} without editing the parent task record or scheduler snapshot. Write scope: ${file}. Report only the attempt result.`,
    writeFiles: [file],
  };
}

test("production stop closures keep internal cancel off the parent gate", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  const harness = createLoopPlusExtensionStopHarness({
    getHost: () => fixture.adapter.host(),
    readTask: (taskId) => fixture.readTask(taskId),
  });
  fixture.setCancelInvocation((tabId) => {
    harness.cancelInvocation(tabId);
  });
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: JSON.stringify({
          status: "dispatch",
          subtasks: [wiringSubtask("A", "src/a.ts"), wiringSubtask("B", "src/b.ts")],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(dispatchPrompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 2, "A and B running");
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    harness.noteTab(fixture.target.tabId, { taskRole: "main", loopTaskId: taskId });
    harness.noteTask({ id: "classic-task", schedulingMode: "classic", status: "running" });
    harness.noteTab("classic-tab", { taskRole: "main", loopTaskId: "classic-task" });
    harness.attachGraph("graph-tab", "graph-1");
    let classicStops = 0;
    harness.attachInteractive("classic-tab", {
      loopTaskId: "classic-task",
      taskRole: "main",
      onStop: () => {
        classicStops += 1;
      },
    });
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
    const subtaskA = fixture.parkedAttempts().find((item) => item.subtaskId === "A");
    assert.ok(subtaskA);
    fixture.queueMain(async () => {
      await fixture.holdMain();
    });
    harness.stopRunForTab(subtaskA.tabId);
    await waitForLoopPlus(() => !fixture.parkedSubtaskIds().includes("A"), "A stopped locally");
    assert.equal(fixture.parkedSubtaskIds().includes("B"), true);
    assert.equal(fixture.readTask(taskId)?.status, "running");
    assert.equal((fixture.readTask(taskId)?.loopPlus as { parentStopped?: boolean }).parentStopped, false);
    assert.deepEqual(harness.parentStopIds, []);
    assert.equal(classicStops, 0);
    assert.deepEqual(harness.graphStops, []);

    harness.cancelInvocation(fixture.target.tabId);
    harness.cancelInvocation(fixture.target.tabId);
    assert.deepEqual(harness.parentStopIds, []);
    assert.deepEqual(harness.fallbackTaskIds, []);
    assert.equal(fixture.parkedSubtaskIds().includes("B"), true);
    assert.equal(fixture.readTask(taskId)?.status, "running");

    harness.preemptActivePromptRun("classic-tab");
    assert.equal(classicStops, 1);
    assert.deepEqual(harness.parentStopIds, []);
    assert.equal(fixture.parkedSubtaskIds().includes("B"), true);

    harness.preemptActivePromptRun("graph-tab");
    assert.deepEqual(harness.graphStops, ["graph-tab"]);
    harness.preemptActivePromptRun("graph-tab");
    assert.deepEqual(harness.graphStops, ["graph-tab"]);
    assert.equal((fixture.readTask(taskId)?.loopPlus as { parentStopped?: boolean }).parentStopped, false);

    harness.stopRunForTab("classic-tab");
    assert.deepEqual(harness.fallbackTaskIds, ["classic-task"]);
    assert.deepEqual(harness.parentStopIds, []);
    assert.equal(fixture.readTask(taskId)?.status, "running");

    harness.attachInteractive(fixture.target.tabId, {
      loopTaskId: taskId,
      taskRole: "main",
      onStop: () => undefined,
    });
    harness.preemptActivePromptRun(fixture.target.tabId);
    harness.preemptActivePromptRun(fixture.target.tabId);
    assert.equal(harness.stoppedTabs.filter((tabId) => tabId === fixture.target.tabId).length, 1);
    assert.deepEqual(harness.parentStopIds, []);
    assert.equal(fixture.parkedSubtaskIds().includes("B"), true);

    let primaryStops = 0;
    harness.noteTab("primary-tab", { taskRole: "main", loopTaskId: taskId });
    harness.attachPrimary("primary-tab", {
      loopTaskId: taskId,
      taskRole: "main",
      onStop: () => {
        primaryStops += 1;
      },
    });
    harness.cancelInvocation("primary-tab");
    harness.cancelInvocation("primary-tab");
    assert.equal(primaryStops, 1);
    assert.deepEqual(harness.parentStopIds, []);
    assert.equal(fixture.parkedSubtaskIds().includes("B"), true);
    harness.attachPrimary("graph-primary", {
      loopTaskId: taskId,
      taskRole: "main",
      graphRunId: "graph-primary-run",
      onStop: () => {
        primaryStops += 1;
      },
    });
    harness.stopRunForTab("graph-primary");
    assert.equal(primaryStops, 2);
    assert.deepEqual(harness.parentStopIds, []);
    assert.equal(fixture.readTask(taskId)?.status, "running");

    harness.stopLoopRunsForTask(taskId);
    await waitForLoopPlus(() => fixture.readTask(taskId)?.status === "stopped", "group stop");
    assert.deepEqual(harness.parentStopIds, [taskId]);
    assert.equal(fixture.parkedSubtaskIds().includes("B"), false);
    assert.equal((fixture.readTask(taskId)?.loopPlus as { parentStopped?: boolean }).parentStopped, true);
    assert.equal(classicStops, 1);
    assert.deepEqual(harness.graphStops, ["graph-tab", "graph-primary:graph-primary-run"]);
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("user main-tab stop closes the gate before aborting every Loop+ runner", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  const harness = createLoopPlusExtensionStopHarness({
    getHost: () => fixture.adapter.host(),
    readTask: (taskId) => fixture.readTask(taskId),
  });
  fixture.setCancelInvocation((tabId) => {
    harness.cancelInvocation(tabId);
  });
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: JSON.stringify({
          status: "dispatch",
          subtasks: [wiringSubtask("A", "src/a.ts"), wiringSubtask("B", "src/b.ts")],
        }),
      });
    });
    const running = fixture.adapter.runEventDriven(dispatchPrompt(), { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.parkedSubtaskIds().length === 2, "both running");
    const taskId = fixture.mainCalls[0].loopTaskId ?? "";
    harness.noteTab(fixture.target.tabId, { taskRole: "main", loopTaskId: taskId });
    harness.attachGraph("graph-tab", "graph-2");
    harness.noteTask({ id: "classic-task", schedulingMode: undefined, status: "running" });
    harness.noteTab("classic-tab", { taskRole: "main", loopTaskId: "classic-task" });
    harness.attachParallel("classic-tab", {
      loopTaskId: "classic-task",
      taskRole: "main",
      onStop: () => undefined,
    });
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
    harness.stopRunForTab(fixture.target.tabId);
    await waitForLoopPlus(() => fixture.readTask(taskId)?.status === "stopped", "user stop");
    assert.deepEqual(harness.parentStopIds, [taskId]);
    assert.equal((fixture.readTask(taskId)?.loopPlus as { parentStopped?: boolean }).parentStopped, true);
    assert.deepEqual(fixture.parkedSubtaskIds(), []);
    assert.equal(harness.stoppedTabs.includes("classic-tab"), false);
    assert.deepEqual(harness.graphStops, []);
    assert.equal(fixture.hostMessages.includes("loop-plus-stopped"), true);
    harness.stopRunForTab(fixture.target.tabId);
    assert.equal(harness.stoppedTabs.includes("classic-tab"), false);
    assert.deepEqual(harness.graphStops, []);
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});
