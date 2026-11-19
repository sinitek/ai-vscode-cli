import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("fs");
import os = require("os");
import path = require("path");
import type { LoopTaskRecord } from "../../loopTaskStore";
import { readCodexRuntimeConfigReadback } from "../../config/codexRuntimeConfigIdentity";
import type { LoopPlusAttemptRequest, LoopPlusAttemptResult, LoopPlusMainRequest } from "../../extensionHost/loopPlusOrchestration";
import { installVscodeMock } from "../vscodeMock";

// Modules capture the data directory at import time. Never touch the user's task store.
const previousHome = process.env.HOME;
const previousProfile = process.env.USERPROFILE;
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "loop-handoff-contracts-"));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
installVscodeMock();
const store = require("../../loopTaskStore") as typeof import("../../loopTaskStore");
const { createLoopPlusScheduler, buildLoopPlusFinishEventId } = require("../../loopPlusScheduler") as typeof import("../../loopPlusScheduler");
function snapshot(task: LoopTaskRecord) { return createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot(); }
const { createLoopPlusOrchestrationHost } = require("../../extensionHost/loopPlusOrchestration") as typeof import("../../extensionHost/loopPlusOrchestration");
const { createLoopPlusPersistedTaskRefresher } = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");
const { loopSubtaskAutoCompactions } = require("../../loopSubtaskAutoCompact") as typeof import("../../loopSubtaskAutoCompact");
const { withLoopPlusAcceptReviews, loopPlusAcceptanceChecksFixture } = require("../loopPlusAcceptFixture") as typeof import("../loopPlusAcceptFixture");
const { createLoopPlusRuntimeFixture, waitForLoopPlus } = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");
const { createCodexRuntimeConfigHandoffFixture } = require("./fixtures/codexruntimeconfighandofffixture") as typeof import("./fixtures/codexruntimeconfighandofffixture");
const { createLoopGroupChatPanelCoordinator, buildLoopGroupChatPanelState } = require("../../extensionHost/loopGroupChatPanelCoordinator") as typeof import("../../extensionHost/loopGroupChatPanelCoordinator");
const { RUNTIME_CONFIG_LOCK_TIMEOUT, RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE } = require("../../loopMainFailure") as typeof import("../../loopMainFailure");

test.after(() => {
  fs.rmSync(isolatedHome, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousProfile;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush() {
  for (let index = 0; index < 30; index += 1) await new Promise((resolve) => setImmediate(resolve));
}
function json(value: Record<string, unknown>) {
  return JSON.stringify(withLoopPlusAcceptReviews({ ...(value.status === "accept" ? { progressPercent: 23 } : {}), ...value }));
}
function child(id: string) {
  return { id, title: id, prompt: `Implement the independent ${id} delivery and report concrete changes and verification without editing task records.`, writeFiles: [`src/${id}.ts`] };
}
function completed(ids: string[] = []) {
  return json({ status: "completed", ...(ids.length ? { reviewEventIds: ids } : {}), answerConclusion: "完成", finalSummary: "全部完成",
    acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() }, requirementCoverage: [{ name: "范围", passed: true }] });
}
let sequence = 0;
function harness(options: { refresh?: () => void | Promise<void>; protocolRetryLimit?: number; maxConcurrency?: number } = {}) {
  const id = `handoff-${++sequence}`;
  const target = { cli: "codex" as const, tabId: `main-${id}`, sessionId: id };
  const input = { displayPrompt: "完成交接契约" };
  const mains: Array<ReturnType<typeof deferred<string | null>> & { request: LoopPlusMainRequest }> = [];
  const attempts: Array<ReturnType<typeof deferred<LoopPlusAttemptResult>> & { request: LoopPlusAttemptRequest }> = [];
  const messages: string[] = [];
  const completedNotices: string[] = [];
  const feedback: string[] = [];
  const aborted: string[] = [];
  const firstAttemptStarted = deferred<LoopPlusAttemptRequest>();
  const consumerFailed = deferred<void>();
  const events: string[] = [];
  let cleanups = 0;
  let missingUpdate = false;
  let refreshes = 0;
  const read = () => store.readLoopTaskRecord(id)!;
  const host = createLoopPlusOrchestrationHost({
    maxConcurrency: options.maxConcurrency ?? 4, launchDelayMs: () => 0, protocolRetryLimit: options.protocolRetryLimit,
    readTask: store.readLoopTaskRecord,
    createTask: ({ snapshot }) => {
      const communication = store.getLoopCommunicationPaths(id);
      const task: LoopTaskRecord = { id, cli: "codex", workspaceKey: "handoff-contracts", taskStoreFile: store.buildLoopTaskStoreFile("codex", "handoff-contracts", id, id),
        rootPrompt: input.displayPrompt, status: "running", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0,
        communicationDir: communication.dir, mainCommunicationFile: communication.mainFile, sessionId: id,
        activeSubtaskId: null, activeSubtaskIds: [], subTasks: [], rounds: [], supplementalRequirements: [], completionRoundSummaries: [], completionRequirementCoverage: [],
        schedulingMode: "event_driven", loopPlus: snapshot };
      assert.ok(task.taskStoreFile.startsWith(isolatedHome + path.sep));
      store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
      return read();
    },
    updateTask: createLoopPlusPersistedTaskRefresher({
      updateTask: (taskId, patch: Partial<LoopTaskRecord>) => store.updateLoopTaskRecord(missingUpdate ? "absent-contract-task" : taskId, patch),
      refreshTaskSurfaces: () => { refreshes += 1; return options.refresh?.(); },
    }),
    appendMessage: (_target, message) => { messages.push(message); },
    log: (event) => {
      if (event === "loop-plus-consumer-failed") {
        events.push(event);
        consumerFailed.resolve();
      }
    },
    appendAcceptancePlanChat: (_id, section) => { feedback.push(section.body); },
    onTaskCompleted: (taskId) => { assert.equal(read().status, "completed"); completedNotices.push(taskId); },
    runMain: (request) => {
      const gate = deferred<string | null>();
      mains.push({ request, ...gate });
      return { promise: gate.promise, abort: () => gate.resolve(null) };
    },
    startAttempt: (request) => {
      const gate = deferred<LoopPlusAttemptResult>();
      attempts.push({ request, ...gate });
      firstAttemptStarted.resolve(request);
      return { promise: gate.promise, abort: () => { aborted.push(request.attemptId); }, onCompleted: async () => { cleanups += 1; } };
    },
  });
  const run = host.tryRun(input, target, { schedulingMode: "event_driven" });
  return { id, host, run, mains, attempts, messages, feedback, completedNotices, aborted, read, events,
    firstAttemptStarted: firstAttemptStarted.promise, consumerFailed: consumerFailed.promise,
    cleanupCount: () => cleanups, refreshCount: () => refreshes, setMissing: (value: boolean) => { missingUpdate = value; },
    observe: () => host.tryRun(input, target, { resumeTaskId: id }),
    resume: () => host.tryRun(input, target, { resumeTaskId: id, resumeRequested: true }) };
}

// Inject below the actual updater/refresher/orchestrator boundary, including atomic rename.
function failDisk(t: import("node:test").TestContext, mode: "write" | "rename", storeFile: string, predicate: (task: LoopTaskRecord) => boolean) {
  let failures = 0;
  const shouldFail = (data: unknown) => {
    try { return predicate(JSON.parse(String(data)).tasks[0]); } catch { return false; }
  };
  if (mode === "write") {
    const original = fs.writeFileSync;
    t.mock.method(fs, "writeFileSync", (file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, ...args: unknown[]) => {
      if ((String(file) === storeFile || (path.dirname(String(file)) === path.dirname(storeFile) && path.basename(String(file)).startsWith(`.${path.basename(storeFile)}.`))) && shouldFail(data)) {
        failures += 1;
        throw Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" });
      }
      return (original as Function)(file, data, ...args);
    });
  } else {
    const original = fs.renameSync;
    t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === storeFile && shouldFail(fs.readFileSync(from, "utf8"))) {
        failures += 1;
        throw Object.assign(new Error("simulated rename EACCES"), { code: "EACCES" });
      }
      return original(from, to);
    });
  }
  return () => failures;
}

test("original group chat resume atomically commits after exact thread receipt and before first turn", { timeout: 5000 }, async (context) => {
  const taskId = "config-lock-atomic-resume";
  const threadId = "original-native-thread";
  const instruction = "保留报告，先验收原任务。";
  const configId = "original-profile";
  const oldCodexHome = process.env.CODEX_HOME;
  const oldCodexHomeDir = process.env.CODEX_HOME_DIR;
  const cwd = fs.realpathSync(isolatedHome);
  const codexHome = path.join(cwd, "codex-home");
  fs.mkdirSync(codexHome);
  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_HOME_DIR = codexHome;
  const { evidence } = await readCodexRuntimeConfigReadback(cwd, codexHome);
  const native = createCodexRuntimeConfigHandoffFixture(context, codexHome, cwd);
  const run = native.runner("session", threadId, "original-revision");
  const mainEntered = deferred<void>();
  const finishMain = deferred<void>();
  const write = (task: LoopTaskRecord) => store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
  const fixture = createLoopPlusRuntimeFixture({ configId,
    taskPersistence: { create: (task) => { write(task); return task; }, read: store.readLoopTaskRecord, save: write,
      update: (id, patch) => store.updateLoopTaskRecord(id, patch), remove: () => undefined },
    runConfigLockResume: async (execution, notifyStarted, signal) => {
      await run.runStreamed("uncommitted", {
        onAssistantDelta: () => undefined, onTrace: () => undefined, onTaskListUpdate: () => undefined,
        onThreadId: () => assert.fail("must not rebind the original thread"),
      }, undefined, { threadId, codexConfigEvidence: execution.codexConfigEvidence, signal, preparePrompt: () => {
        assert.equal(native.wire.filter(({ message }) => message.method === "thread/resume").length, 1);
        const prepared = execution.prepare();
        return { prompt: prepared.modelPrompt ?? prepared.displayPrompt, commit: prepared.commit,
          afterSend: () => { prepared.afterSend(); notifyStarted(); } };
      } });
    },
  });
  let retry: Promise<void> | undefined;
  try {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
    const opened = [{ subtaskId: "P", attemptId: "review-first" }, { subtaskId: "Q", attemptId: "review-next" },
      { subtaskId: "R", attemptId: "report", requiresAcceptance: false }];
    scheduler.dispatch(opened);
    for (const attempt of opened) scheduler.finish({ ...attempt, outcome: "completed", detail: attempt.attemptId });
    const ready = { subtaskId: "X", attemptId: "independent" };
    const blocked = { subtaskId: "B", attemptId: "dependent", dependsOn: ["P"] };
    scheduler.dispatch([ready, blocked], { deferPromotion: true });
    const paused = scheduler.snapshot();
    const taskStoreFile = store.buildLoopTaskStoreFile("codex", "workspace", "session", taskId);
    const task: LoopTaskRecord = {
      id: taskId, taskStoreFile, workspaceKey: "workspace", cli: "codex", sessionId: fixture.target.sessionId,
      status: "needs-review", rootPrompt: "synthetic task", schedulingMode: "event_driven", loopPlus: paused,
      mainAiFailureCount: 5, mainAiFailureLimitReached: true, mainAiLastFailureCode: RUNTIME_CONFIG_LOCK_TIMEOUT,
      mainAiLastFailureMessage: RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE, finalSummary: "原暂停",
      originProfile: { configId }, modelRouting: { main: { cli: "codex", model: "main-model" }, subtask: { model: "sub-model" } },
      createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 4, currentRound: 1, activeSubtaskId: null, activeSubtaskIds: [],
      subTasks: [...opened, ready, blocked].map((attempt) => ({ id: attempt.subtaskId, title: attempt.subtaskId,
        status: opened.some((item) => item.subtaskId === attempt.subtaskId) ? "completed" : "pending", updatedAt: Date.now() })),
      communicationDir: fixture.rootDir, mainCommunicationFile: path.join(fixture.rootDir, "main.md"),
      rounds: [], supplementalRequirements: ["原说明"], completionRoundSummaries: [], completionRequirementCoverage: [],
    };
    write(task);
    const originalRead = fixture.readTask(taskId)!;
    const originalBytes = fs.readFileSync(taskStoreFile);
    const warnings: string[] = [];
    type Deps = Parameters<typeof createLoopGroupChatPanelCoordinator>[0];
    type Panel = NonNullable<ReturnType<Deps["panelsByTaskId"]["get"]>>;
    let state: ReturnType<typeof buildLoopGroupChatPanelState>;
    const panel = { getState: () => state, setAskThread: () => undefined, post: () => undefined,
      update: (value: typeof state) => { state = value; } } as unknown as Panel;
    const deps: Deps = {
      getExtensionUri: () => ({ fsPath: fixture.rootDir } as ReturnType<Deps["getExtensionUri"]>),
      panelsByTaskId: new Map([[taskId, panel]]), normalizeTaskId: () => taskId,
      normalizeSupplementalRequirement: () => null, appendSupplementalRequirement: () => [],
      appendSupplementalRequirementToCommunication: () => undefined, recordPromptHistory: () => undefined,
      readTaskRecord: fixture.readTask, updateTaskRecord: () => assert.fail("must use the original task's recovery commit"),
      listTaskStoreFiles: () => [], readTaskStoreTasks: () => [], collectRunningTaskIds: () => new Set(),
      resolveMainPromptTarget: () => fixture.target, isTabRunActive: () => false,
      isConfigLockResumeSessionAvailable: () => true, getActiveConfigIdForCli: () => configId, getSelectedCliModel: () => "main-model",
      restoreOriginalLoopRuntime: async () => ({ ok: true, target: fixture.target,
        isOriginalTargetCurrent: () => true, codexConfigEvidence: evidence }),
      revealPanelView: async () => undefined, switchVisibleConversationTabForLoop: async () => undefined,
      runLoopPrompt: async (input, options) => { await fixture.adapter.runEventDriven(input, options, fixture.target); },
      getActiveSubtaskIds: () => [], stopRunsForTask: () => undefined, markTaskStoppedByUser: () => null,
      getActiveConversationTaskId: () => taskId, postPanelState: async () => undefined,
      pickTask: async () => null, readTextFileIfNonEmpty: () => null, fileExists: () => false, writeTextFileEnsuringDir: () => true,
      buildCompletedConclusionAndSummaryMarkdown: () => "", showInformationMessage: () => undefined,
      showWarningMessage: (message) => { warnings.push(message); }, t: (key) => key,
    };
    const coordinator = createLoopGroupChatPanelCoordinator(deps);
    state = buildLoopGroupChatPanelState(originalRead, deps);
    assert.equal(state.task.canContinue, true);
    let rejectRename = true;
    const staged: LoopTaskRecord[] = [];
    const rename = fs.renameSync;
    context.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === taskStoreFile) {
        staged.push(JSON.parse(fs.readFileSync(from, "utf8")).tasks[0]);
        if (rejectRename) throw Object.assign(new Error("synthetic atomic replacement denied"), { code: "EACCES" });
      }
      return rename(from, to);
    });
    const click = () => coordinator.handleMessage(taskId, { type: "loopGroupChatChat:continueTask", prompt: instruction }, panel);
    await click();
    assert.match(warnings.at(-1) ?? "", /synthetic atomic replacement denied/u);
    assert.deepEqual(fs.readFileSync(taskStoreFile), originalBytes);
    assert.equal(staged.length, 1);
    assert.equal(fixture.mainCalls.length, 0);
    assert.equal(fixture.attemptCalls.length, 0);
    assert.deepEqual(fixture.hostMessages, []);
    const turns = () => native.wire.filter(({ message }) => message.method === "turn/start");
    assert.equal(turns().length, 0);
    assert.equal(fs.readdirSync(path.dirname(taskStoreFile)).some((entry) => entry.endsWith(".stage")), false);

    rejectRename = false;
    fixture.queueMain(async () => { mainEntered.resolve(); await finishMain.promise; });
    retry = click();
    await Promise.race([mainEntered.promise, retry.then(() => assert.fail(`retry did not start: ${warnings.at(-1)}`))]);
    await waitForLoopPlus(() => fixture.attemptCalls.length === 1, "independent committed reservation");
    assert.equal(turns().length, 1);
    const firstTurn = turns()[0].message.params!;
    assert.equal(firstTurn.threadId, threadId);
    assert.ok((firstTurn.input as Array<{ text?: string }>).some(({ text }) => text?.includes(instruction)));
    assert.equal(native.wire.some(({ message }) => message.method === "thread/start"), false);
    assert.deepEqual(fixture.attemptCalls.map((input) => input.loopSubtaskId), [ready.subtaskId]);
    const commit = staged[1];
    assert.equal(commit.status, "running");
    assert.equal(commit.mainAiFailureCount, 0);
    assert.deepEqual(commit.supplementalRequirements, ["原说明", instruction]);
    const resumed = snapshot(commit);
    assert.deepEqual(resumed.currentReview, paused.currentReview);
    assert.deepEqual(resumed.reviewQueue, paused.reviewQueue);
    assert.deepEqual(resumed.reportQueue, paused.reportQueue);
    assert.deepEqual(resumed.pending, paused.pending.filter((item) => item.subtaskId === blocked.subtaskId));
    assert.equal(resumed.running[0]?.attemptId, ready.attemptId);
    assert.equal(fixture.mainCalls[0].loopTaskId, taskId);
  } finally {
    fixture.adapter.host().stopParent(taskId);
    finishMain.resolve();
    await retry;
    await native.cleanup();
    fixture.dispose();
    if (oldCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldCodexHome;
    if (oldCodexHomeDir === undefined) delete process.env.CODEX_HOME_DIR;
    else process.env.CODEX_HOME_DIR = oldCodexHomeDir;
  }
});

for (const mode of ["write", "rename"] as const) {
  test(`real ${mode} failure prevents final notification/release; retry completes exactly once`, async (t) => {
    const env = harness();
    await flush();
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "A done" });
    await flush();
    const review = env.mains.at(-1)!;
    const failures = failDisk(t, mode, env.read().taskStoreFile, (task) => task.status === "completed");
    review.resolve(completed(review.request.reviewEventIds));
    await env.run.done;
    assert.ok(failures() > 0, `${mode} injection was exercised`);
    assert.notEqual(env.read().status, "completed");
    assert.equal(env.host.hasController(env.id), true);
    assert.equal(env.messages.includes("loop-plus-completed"), false);
    assert.deepEqual(env.completedNotices, []);
    const calls = env.mains.length;
    const feedback = env.feedback.length;
    t.mock.restoreAll();
    await env.resume().done;
    assert.equal(env.read().status, "completed");
    assert.equal(env.host.hasController(env.id), false);
    assert.equal(env.mains.length, calls);
    assert.equal(env.feedback.length, feedback);
    assert.equal(env.attempts.length, 1);
    assert.equal(snapshot(env.read()).seenAttempts.filter((attempt) => attempt.disposition === "reviewed").length, 1);
    await env.resume().done;
    assert.deepEqual(env.completedNotices, [env.id]);
    assert.equal(env.messages.filter((message) => message === "loop-plus-completed").length, 1);
  });
}

test("real subtask commit failure retains the review and tab without compaction; explicit recovery does not restart it", async (t) => {
  const env = harness();
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
  await flush();
  const attempt = env.attempts[0].request;
  let compactions = 0;
  loopSubtaskAutoCompactions.defer({ displayPrompt: "A", modelPrompt: "A", contextTags: [], taskRole: "subtask", loopTaskId: env.id, loopSubtaskId: "A", loopAttemptId: attempt.attemptId },
    { cli: "codex", tabId: "child-A", sessionId: env.id }, async () => { compactions += 1; });
  const failures = failDisk(t, "write", env.read().taskStoreFile, (task) => Boolean(snapshot(task).currentReview || snapshot(task).reviewQueue.length));
  env.attempts[0].resolve({ outcome: "completed", detail: "A result retained" });
  await flush();
  await env.run.done;
  await flush();
  assert.ok(failures() > 0);
  assert.equal(compactions, 0);
  assert.equal(env.cleanupCount(), 0);
  assert.equal(env.host.hasController(env.id), true);
  t.mock.restoreAll();
  const resumed = env.resume();
  await flush();
  assert.equal(env.attempts.length, 1);
  assert.equal(env.read().subTasks[0].summary, "A result retained");
  assert.deepEqual(env.mains.at(-1)!.request.reviewEventIds, [buildLoopPlusFinishEventId("A", attempt.attemptId)]);
  const review = env.mains.at(-1)!;
  review.resolve(completed(review.request.reviewEventIds));
  await flush();
  await resumed.done;
  assert.equal(env.read().status, "completed");
});

test("a real acceptance commit failure restores the frozen event and does not launch repair", async (t) => {
  const env = harness();
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
  await flush();
  env.host.submitUserMessage(env.id, "这条消息只确认一次");
  await flush();
  // Leave the message invocation open; the finish must remain an independently queued review.
  env.attempts[0].resolve({ outcome: "completed", detail: "A" });
  await flush();
  env.mains.at(-1)!.resolve(json({ status: "wait" }));
  await flush();
  const review = env.mains.at(-1)!;
  const ids = review.request.reviewEventIds?.slice() ?? [];
  const failures = failDisk(t, "write", env.read().taskStoreFile,
    (task) => snapshot(task).seenAttempts.some((item) => item.disposition === "reviewed"));
  review.resolve(json({ status: "accept", reviewEventIds: ids, subtasks: [child("repair")] }));
  await env.run.done;
  assert.ok(failures() > 0);
  assert.equal(env.attempts.length, 1);
  assert.equal(env.feedback.length, 0);
  assert.equal(snapshot(env.read()).currentReview?.eventId, ids[0]);
  assert.equal(snapshot(env.read()).seenAttempts.some((item) => item.disposition === "reviewed"), false);
  t.mock.restoreAll();
  const resumed = env.resume();
  await flush();
  const retried = env.mains.at(-1)!;
  assert.deepEqual(retried.request.reviewEventIds, ids);
  retried.resolve(completed(ids));
  await resumed.done;
  assert.equal(env.read().status, "completed");
  assert.equal(snapshot(env.read()).seenAttempts.filter((item) => item.disposition === "reviewed").length, 1);
  assert.deepEqual(snapshot(env.read()).userMessageQueue, []);
});

test("a failed decision metadata write cannot leave memory completed before the final commit", async (t) => {
  const env = harness();
  await flush();
  store.updateLoopTaskRecord(env.id, { mainAiFailureCount: 1 });
  const failures = failDisk(t, "write", env.read().taskStoreFile,
    (task) => task.status === "running" && task.mainAiFailureCount === 0);
  env.mains[0].resolve(completed());
  await env.run.done;
  assert.ok(failures() > 0);
  assert.equal(env.host.hasController(env.id), true);
  assert.deepEqual(env.completedNotices, []);
  assert.equal(snapshot(env.read()).completed, false);
  t.mock.restoreAll();
  const resumed = env.resume();
  await flush();
  assert.equal(env.host.hasController(env.id), true);
  assert.deepEqual(env.completedNotices, []);
  env.mains.at(-1)!.resolve(completed());
  await resumed.done;
  assert.equal(env.read().status, "completed");
  assert.deepEqual(env.completedNotices, [env.id]);
});

test("actual missing store updates are failures and never refresh, finish or release", async () => {
  const env = harness();
  await flush();
  const refreshes = env.refreshCount();
  env.setMissing(true);
  assert.deepEqual(env.host.applyAcceptancePlan(env.id, null), {
    ok: false, error: "验收方案更新失败，请稍后重试。",
  });
  env.mains[0].resolve(completed());
  await env.run.done;
  assert.equal(env.refreshCount(), refreshes);
  assert.notEqual(env.read().status, "completed");
  assert.equal(env.host.hasController(env.id), true);
  assert.deepEqual(env.completedNotices, []);
  env.setMissing(false);
  const resumed = env.resume();
  await flush();
  env.mains.at(-1)!.resolve(completed());
  await resumed.done;
  assert.equal(env.read().status, "completed");
});

for (const asyncRefresh of [false, true]) {
  test(`surface ${asyncRefresh ? "rejection" : "exception"} cannot revoke a real commit`, async () => {
    const env = harness({ refresh: () => {
      if (asyncRefresh) return Promise.reject(new Error("surface unavailable"));
      throw new Error("surface unavailable");
    } });
    await flush();
    env.mains[0].resolve(completed());
    await env.run.done;
    await flush();
    assert.equal(env.read().status, "completed");
    assert.deepEqual(env.completedNotices, [env.id]);
    assert.equal(env.host.hasController(env.id), false);
  });
}

test("partial accept/dispatch rejection repairs only remaining work with bounded retries and no repeated acceptance", async () => {
  const env = harness({ protocolRetryLimit: 2 });
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A"), child("B"), { ...child("report"), requiresAcceptance: false }] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "A" });
  await flush();
  const review = env.mains.at(-1)!;
  env.host.submitUserMessage(env.id, "只确认一次");
  env.attempts[2].resolve({ outcome: "completed", detail: "免验收报告" });
  await flush();
  review.resolve(json({ status: "accept", reviewEventIds: review.request.reviewEventIds,
    reviews: [{ reviewEventId: review.request.reviewEventIds![0], acceptance: "failed", reason: "A needs repair", subtaskIds: ["repair-C"] }],
    independentSubtaskIds: ["B"], subtasks: [child("repair-C"), child("B")] }));
  await flush();
  assert.deepEqual(env.attempts.map(({ request }) => request.subtaskId), ["A", "B", "report", "repair-C"]);
  assert.equal(env.feedback.length, 1);
  const reviewed = () => snapshot(env.read()).seenAttempts.filter((item) => item.disposition === "reviewed");
  assert.equal(reviewed().length, 1);
  assert.equal(reviewed()[0].acceptance, "failed");
  assert.match(env.mains.at(-1)!.request.prompt, /active_subtask/);
  assert.match(env.mains.at(-1)!.request.prompt, /不得重复 accept/);
  assert.equal(env.read().subTasks.find((item) => item.id === "B")?.title, "B");
  // A second partially accepted response must not reset the retry counter.
  const reportEventIds = env.mains.at(-1)!.request.reportEventIds;
  assert.equal(reportEventIds?.length, 1);
  env.mains.at(-1)!.resolve(json({ status: "dispatch", reportEventIds, subtasks: [child("repair-D"), child("B")] }));
  await flush();
  assert.deepEqual(env.attempts.map(({ request }) => request.subtaskId), ["A", "B", "report", "repair-C", "repair-D"]);
  assert.deepEqual(snapshot(env.read()).reportQueue ?? [], []);
  assert.deepEqual(env.mains.at(-1)!.request.reportEventIds, []);
  env.mains.at(-1)!.resolve(json({ status: "dispatch", subtasks: [child("B")] }));
  await flush();
  await env.run.done;
  assert.equal(env.read().status, "needs-review");
  assert.equal(reviewed().length, 1);
  assert.equal(reviewed()[0].acceptance, "failed");
  assert.equal(env.feedback.length, 1);
  assert.equal(env.attempts.filter((item) => item.request.subtaskId === "B").length, 1);
  assert.deepEqual(snapshot(env.read()).userMessageQueue, []);
});

test("rejected repair dispatch is corrected successfully from the latest snapshot without re-accepting A", async () => {
  const env = harness();
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A"), child("B")] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "A needs repair" });
  await flush();
  const review = env.mains.at(-1)!;
  review.resolve(json({ status: "accept", reviewEventIds: review.request.reviewEventIds,
    reviews: [{ reviewEventId: review.request.reviewEventIds![0], acceptance: "failed", reason: "A needs repair", subtaskIds: [] }],
    independentSubtaskIds: ["B"], subtasks: [child("B")] }));
  await flush();
  const correction = env.mains.at(-1)!;
  assert.notEqual(correction.request.kind, "review");
  assert.match(correction.request.prompt, /active_subtask/);
  assert.match(correction.request.prompt, /failed/);
  correction.resolve(json({ status: "dispatch", subtasks: [child("repair")] }));
  await flush();
  assert.equal(env.attempts.length, 3);
  assert.equal(env.feedback.length, 1);
  const accepted = snapshot(env.read()).seenAttempts.filter((item) => item.disposition === "reviewed");
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].acceptance, "failed");
  assert.deepEqual(snapshot(env.read()).running.map((item) => item.subtaskId).sort(), ["B", "repair"]);
  env.host.stopParent(env.id);
  await env.run.done;
});

for (const mode of ["write", "rename"] as const) {
  test(`dispatch pending ${mode} commit failure leaves no candidate; immediate resume can dispatch once`, async (t) => {
    const env = harness();
    await flush();
    const failures = failDisk(t, mode, env.read().taskStoreFile, (task) => Boolean(snapshot(task).pending.length));
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
    await env.run.done;
    assert.ok(failures() > 0);
    assert.equal(env.attempts.length, 0);
    assert.deepEqual(snapshot(env.read()).pending, []);
    assert.deepEqual(snapshot(env.read()).running, []);
    assert.deepEqual(snapshot(env.read()).seenAttempts, []);
    assert.deepEqual(env.read().subTasks, []);
    t.mock.restoreAll();
    // Resume directly from done: no drain of the old consumer before recovery.
    const resumed = env.resume();
    await flush();
    assert.equal(env.mains.length, 2);
    env.mains[1].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
    await flush();
    assert.equal(env.attempts.length, 1);
    assert.equal(snapshot(env.read()).seenAttempts.length, 1);
    env.host.stopParent(env.id);
    await resumed.done;
  });

  test(`dispatch promotion ${mode} commit failure retains original pending attempt; immediate resume starts it once`, async (t) => {
    const env = harness();
    await flush();
    const failures = failDisk(t, mode, env.read().taskStoreFile, (task) => Boolean(snapshot(task).running.length));
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
    await env.run.done;
    assert.ok(failures() > 0);
    assert.equal(env.attempts.length, 0);
    const saved = snapshot(env.read());
    assert.deepEqual(saved.running, []);
    assert.equal(saved.pending.length, 1);
    const originalId = saved.pending[0].attemptId;
    assert.equal(saved.pending[0].subtaskId, "A");
    t.mock.restoreAll();
    // The candidate is already committed: recover it without another dispatch.
    const resumed = env.resume();
    let resumedSettled = false;
    void resumed.done.then(() => { resumedSettled = true; });
    await flush();
    assert.equal(env.attempts.length, 1);
    assert.equal(env.attempts[0].request.attemptId, originalId);
    assert.equal(env.mains.length, 1);
    assert.deepEqual(snapshot(env.read()).pending, []);
    assert.deepEqual(snapshot(env.read()).running.map((item) => item.attemptId), [originalId]);
    assert.deepEqual(snapshot(env.read()).seenAttempts, saved.seenAttempts);
    assert.equal(env.read().status, "running");
    assert.equal(resumedSettled, false);
    env.host.stopParent(env.id);
    await resumed.done;
  });
}
test("dispatch commit failure leaves no started or reserved attempt; recovery starts it once", { timeout: 5000 }, async (t) => {
  const env = harness();
  const failures = failDisk(t, "write", env.read().taskStoreFile, (task) => Boolean(snapshot(task).running.length));
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
  await env.run.done;
  assert.equal(failures(), 1);
  assert.equal(env.attempts.length, 0);
  const registered = snapshot(env.read());
  assert.deepEqual(registered.running, []);
  assert.deepEqual(registered.pending.map((item) => item.subtaskId), ["A"]);
  assert.deepEqual(env.events, []);
  t.mock.restoreAll();
  const resumed = env.resume();
  const reserved = snapshot(env.read());
  assert.deepEqual(reserved.pending, []);
  assert.deepEqual(reserved.running.map((item) => item.attemptId), [registered.pending[0].attemptId]);
  await env.consumerFailed;
  assert.deepEqual(env.events, ["loop-plus-consumer-failed"]);
  assert.equal(env.read().status, "running");
  assert.deepEqual(snapshot(env.read()).running, reserved.running);
  const started = await env.firstAttemptStarted;
  assert.equal(started.attemptId, registered.pending[0].attemptId);
  assert.equal(env.attempts.length, 1);
  assert.equal(env.mains.length, 1);
  env.host.stopParent(env.id);
  await resumed.done;
});

test("control commit failure preserves the old active attempt and does not abort, close or start its replacement", async (t) => {
  const env = harness();
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
  await flush();
  env.host.submitUserMessage(env.id, "修改 A 提示词");
  await flush();
  const failures = failDisk(t, "rename", env.read().taskStoreFile, (task) => task.subTasks.some((item) => item.title === "replacement"));
  env.mains.at(-1)!.resolve(json({ status: "steer", controls: [{ id: "A", action: "reprompt", title: "replacement", prompt: child("A").prompt }] }));
  await env.run.done;
  assert.ok(failures() > 0);
  assert.deepEqual(env.aborted, []);
  assert.equal(env.cleanupCount(), 0);
  assert.equal(env.attempts.length, 1);
  assert.equal(env.read().subTasks[0].title, "A");
  assert.equal(snapshot(env.read()).running[0].attemptId, env.attempts[0].request.attemptId);
  t.mock.restoreAll();
  env.host.stopParent(env.id);
});

test("user stop cancels running attempts even when storing stop fails", async (t) => {
  const env = harness();
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
  await flush();
  const failures = failDisk(t, "write", env.read().taskStoreFile, (task) => task.status === "stopped");
  assert.doesNotThrow(() => env.host.stopParent(env.id));
  await env.run.done;
  assert.ok(failures() > 0);
  assert.deepEqual(env.aborted, [env.attempts[0].request.attemptId]);
  assert.notEqual(env.read().status, "completed");
});

for (const parentStopped of [false, true]) {
  for (const mode of ["write", "rename", "null"] as const) {
    test(`${parentStopped ? "stopped parent" : "paused parent"} resume ${mode} failure retains pending attempt until commit`, async (t) => {
      const env = harness({ maxConcurrency: parentStopped ? 1 : 2 });
      await flush();
      env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A"), ...(parentStopped ? [] : [child("sibling")]), child("B")] }));
      await flush();
      assert.deepEqual(env.attempts.map((item) => item.request.subtaskId), parentStopped ? ["A"] : ["A", "sibling"]);
      env.host.submitUserMessage(env.id, "保留这条尚未确认的用户消息");
      await flush();
      if (parentStopped) {
        env.host.stopParent(env.id);
        env.attempts[0].resolve({ outcome: "stopped", detail: "A cancelled by user" });
      } else {
        // A real finish-commit failure pauses the parent and parks its unstarted
        // successor, while retaining A's event and the actual live sibling.
        const initialFailures = failDisk(t, "write", env.read().taskStoreFile,
          (task) => snapshot(task).running.some((item) => item.subtaskId === "B"));
        env.attempts[0].resolve({ outcome: "completed", detail: "A result awaiting acceptance" });
        await flush();
        assert.equal(initialFailures(), 1);
        t.mock.restoreAll();
      }
      await flush();
      await env.run.done;
      const before = snapshot(env.read());
      const pending = before.pending.find((item) => item.subtaskId === "B")!;
      assert.ok(pending);
      assert.equal(before.parentStopped, parentStopped);
      const eventsBefore = [...(before.currentReview ? [before.currentReview] : []), ...before.reviewQueue];
      assert.equal(eventsBefore.length, 1);
      assert.equal(eventsBefore[0].subtaskId, "A");
      assert.equal(eventsBefore[0].attemptId, env.attempts[0].request.attemptId);
      assert.equal(before.userMessageQueue.length, 1);
      assert.deepEqual(before.running.map((item) => item.subtaskId), parentStopped ? [] : ["sibling"]);
      const messages = env.messages.slice();
      const mains = env.mains.length;
      const cleanups = env.cleanupCount();
      const aborted = env.aborted.slice();
      const failures = mode === "null" ? () => 0 : failDisk(t, mode, env.read().taskStoreFile,
        (task) => snapshot(task).running.some((item) => item.attemptId === pending.attemptId));
      env.setMissing(mode === "null");
      for (let retry = 0; retry < 2; retry += 1) {
        assert.throws(() => env.resume(), mode === "null" ? /did not commit/ : { code: mode === "write" ? "ENOSPC" : "EACCES" });
        let settled = false;
        void env.observe().done.then(() => { settled = true; });
        await flush();
        assert.equal(settled, true, "failed resume lifecycle settles even with a live sibling");
        assert.deepEqual(snapshot(env.read()), before, "disk keeps all previously committed scheduler facts");
        assert.equal(env.attempts.length, parentStopped ? 1 : 2);
        assert.equal(env.mains.length, mains);
        assert.deepEqual(env.messages, messages, "no success notification on a failed resume");
        assert.equal(env.cleanupCount(), cleanups);
        assert.deepEqual(env.aborted, aborted);
        assert.deepEqual(env.completedNotices, []);
        assert.deepEqual(env.feedback, []);
        assert.equal(env.host.hasController(env.id), true);
        assert.deepEqual(env.host.collectRunningTaskIds(), []);
      }
      if (mode !== "null") assert.equal(failures(), 2, "both resume attempts reach the underlying disk fault");
      t.mock.restoreAll();
      env.setMissing(false);
      env.resume();
      await flush();
      const resumed = snapshot(env.read());
      assert.deepEqual(env.attempts.filter((item) => item.request.subtaskId === "B").map((item) => item.request.attemptId), [pending.attemptId]);
      assert.equal(resumed.parentStopped, false);
      assert.deepEqual(resumed.pending, []);
      assert.deepEqual(resumed.seenAttempts, before.seenAttempts, "resume does not finish or consume any attempt");
      assert.deepEqual([...(resumed.currentReview ? [resumed.currentReview] : []), ...resumed.reviewQueue], eventsBefore);
      assert.deepEqual(resumed.userMessageQueue, before.userMessageQueue);
      assert.deepEqual(resumed.running, [...before.running, { ...pending, state: "running" }]);
      assert.equal(env.read().subTasks.find((item) => item.id === "B")?.status, "running");
      assert.deepEqual(env.aborted, aborted, "the active sibling is untouched");
      assert.equal(env.cleanupCount(), cleanups);
      assert.deepEqual(env.completedNotices, []);
      assert.deepEqual(env.feedback, []);
      assert.deepEqual(env.mains.at(-1)!.request.reviewEventIds, [eventsBefore[0].eventId]);
      env.resume();
      await flush();
      assert.equal(env.attempts.filter((item) => item.request.subtaskId === "B").length, 1);
      assert.deepEqual(snapshot(env.read()).seenAttempts, before.seenAttempts);
      assert.equal(env.cleanupCount(), cleanups);
      env.host.stopParent(env.id);
    });
  }
}

for (const mode of ["write", "rename"] as const) {
  test(`review preparation ${mode} commit failure restores the previous prefix and sends no main request until immediate resume`, async (t) => {
    const env = harness();
    await flush();
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("select-a"), { ...child("select-b"), dependsOn: ["select-a"] }] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "original prerequisite" });
    await flush();
    const originalReview = env.mains.at(-1)!;
    originalReview.resolve(json({ status: "accept", reviewEventIds: originalReview.request.reviewEventIds, subtasks: [] }));
    await flush();
    assert.equal(env.attempts[1].request.subtaskId, "select-b");
    env.host.submitUserMessage(env.id, "重新执行前置");
    await flush();
    env.mains.at(-1)!.resolve(json({ status: "dispatch", subtasks: [child("select-a")] }));
    await flush();
    assert.equal(env.attempts[2].request.subtaskId, "select-a");
    assert.equal(env.host.submitUserMessage(env.id, "先记录全部交付，再生成验收批次"), true);
    await flush();
    const user = env.mains.at(-1)!;
    assert.equal(user.request.kind, "user");
    env.attempts[1].resolve({ outcome: "completed", detail: "successor first" });
    await flush();
    env.attempts[2].resolve({ outcome: "completed", detail: "prerequisite later" });
    await flush();
    const before = snapshot(env.read());
    assert.equal(before.currentReview?.subtaskId, "select-b");
    assert.equal(before.reviewQueue[0].subtaskId, "select-a");
    const ids = [before.reviewQueue[0].eventId, before.currentReview!.eventId];
    const calls = env.mains.length;
    const failures = failDisk(t, mode, env.read().taskStoreFile, (task) => snapshot(task).currentReview?.subtaskId === "select-a");
    user.resolve(json({ status: "wait" }));
    await env.run.done;
    assert.ok(failures() > 0);
    assert.equal(env.mains.length, calls, "uncommitted review selection must never reach the main model");
    assert.equal(env.attempts.length, 3);
    assert.deepEqual(snapshot(env.read()).currentReview, before.currentReview);
    assert.deepEqual(snapshot(env.read()).reviewQueue, before.reviewQueue);
    assert.equal(snapshot(env.read()).seenAttempts.filter((item) => item.disposition === "reviewed").length, 1);
    t.mock.restoreAll();
    const resumed = env.resume();
    await flush();
    assert.equal(env.mains.length, calls + 1);
    const review = env.mains.at(-1)!;
    assert.deepEqual(review.request.reviewEventIds, ids, "failed new MainStep metadata was rolled back");
    assert.equal(snapshot(env.read()).currentReview?.eventId, ids[0], "selection is durable before the request");
    review.resolve(completed(ids));
    await resumed.done;
    assert.equal(env.read().status, "completed");
    assert.equal(env.attempts.length, 3);
    assert.equal(env.completedNotices.length, 1);
  });
}
