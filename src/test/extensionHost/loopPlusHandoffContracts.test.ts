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
function harness(options: { refresh?: () => void | Promise<void>; maxConcurrency?: number; temporaryRequirement?: string;
  recordAttempt?: (attemptId: string) => void;
  beforeOrdinaryCommit?: (patch: Partial<LoopTaskRecord>, expected: LoopTaskRecord) => void;
  beforeCompletionCommit?: () => void; retryDelay?: (ms: number) => Promise<void> } = {}) {
  const id = `handoff-${++sequence}`;
  const target = { cli: "codex" as const, tabId: `main-${id}`, sessionId: id };
  const input = { displayPrompt: options.temporaryRequirement ?? "完成交接契约" };
  const mains: Array<ReturnType<typeof deferred<string | null>> & { request: LoopPlusMainRequest }> = [];
  const attempts: Array<ReturnType<typeof deferred<LoopPlusAttemptResult>> & { request: LoopPlusAttemptRequest }> = [];
  const messages: string[] = [];
  const completedNotices: string[] = [];
  const feedback: string[] = [];
  const aborted: string[] = [];
  const firstAttemptStarted = deferred<LoopPlusAttemptRequest>();
  const consumerFailed = deferred<void>();
  const events: string[] = [];
  const finishedChats: string[] = [];
  const completionDiagnostics: Array<{ result: string; stage: string }> = [];
  const finishDiagnostics: Array<{ result: string; stage: string }> = [];
  let cleanups = 0;
  let missingUpdate = false;
  let refreshes = 0;
  const read = () => store.readLoopTaskRecord(id)!;
  const createHost = () => createLoopPlusOrchestrationHost({
    maxConcurrency: options.maxConcurrency ?? 4, launchDelayMs: () => 0,
    readTask: store.readLoopTaskRecord,
    createTask: ({ snapshot }) => {
      const communication = store.getLoopCommunicationPaths(id);
      const task: LoopTaskRecord = { id, cli: "codex", workspaceKey: "handoff-contracts", taskStoreFile: store.buildLoopTaskStoreFile("codex", "handoff-contracts", id, id),
        rootPrompt: input.displayPrompt, status: "running", createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 20, currentRound: 0,
        communicationDir: communication.dir, mainCommunicationFile: communication.mainFile, sessionId: id,
        activeSubtaskId: null, activeSubtaskIds: [], subTasks: [], rounds: [], supplementalRequirements: [], completionRoundSummaries: [], completionRequirementCoverage: [],
        schedulingMode: "event_driven", loopPlus: snapshot,
        ...(options.temporaryRequirement ? {
          loopSubtaskMode: "fullstack" as const,
          modelRouting: { main: { model: "review-model" }, subtask: {},
            subtaskFullstack: { cli: "codex" as const, configId: "fullstack-fixture", model: "coding-model" } },
        } : {}) };
      assert.ok(task.taskStoreFile.startsWith(isolatedHome + path.sep));
      store.writeLoopTaskStore(task.taskStoreFile, { tasks: [task] });
      return read();
    },
    updateTask: createLoopPlusPersistedTaskRefresher({
      updateTask: (taskId, patch: Partial<LoopTaskRecord>) => store.updateLoopTaskRecord(missingUpdate ? "absent-contract-task" : taskId, patch),
      refreshTaskSurfaces: () => { refreshes += 1; return options.refresh?.(); },
    }),
    delay: options.retryDelay,
    commitOrdinaryRun: (expected, patch, retainedStatus) => {
      options.beforeOrdinaryCommit?.(patch, expected);
      if (patch.status === "completed") options.beforeCompletionCommit?.();
      return createLoopPlusPersistedTaskRefresher<Partial<LoopTaskRecord>>({
        updateTask: (taskId, proposed) => store.updateLoopTaskRecord(taskId, proposed, {
          expectedOrdinaryRun: { ...expected, retainedStatus }, throwOnIdentityLock: true,
        }),
        refreshTaskSurfaces: () => undefined,
      })(missingUpdate ? "absent-contract-task" : id, patch);
    },
    appendMessage: (_target, message) => { messages.push(message); },
    recordAttempt: ({ attemptId }) => options.recordAttempt?.(attemptId),
    log: (event, payload) => {
      if (event === "loop-plus-finish-contention") finishDiagnostics.push(payload as { result: string; stage: string });
      if (event === "loop-plus-completion-commit") completionDiagnostics.push(payload as { result: string; stage: string });
      if (event === "loop-plus-persist-failed" && payload && typeof payload === "object" && "stage" in payload) {
        events.push(String(payload.stage));
      }
      if (event === "loop-plus-consumer-failed") {
        events.push(event);
        consumerFailed.resolve();
      }
    },
    prepareCommunication: options.temporaryRequirement
      ? (task, subtask, seq) => store.prepareLoopSubtaskCommunicationFile(task, subtask, 1, seq)
      : undefined,
    appendAcceptancePlanChat: (_id, section) => { feedback.push(section.body); },
    appendSubtaskChat: (_target, notice) => { if (notice.phase === "finished") finishedChats.push(notice.subtaskId); },
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
  const host = createHost();
  const run = host.tryRun(input, target, { schedulingMode: "event_driven" });
  return { id, host, run, mains, attempts, messages, feedback, completedNotices, aborted, read, events, finishedChats, completionDiagnostics, finishDiagnostics,
    firstAttemptStarted: firstAttemptStarted.promise, consumerFailed: consumerFailed.promise,
    cleanupCount: () => cleanups, refreshCount: () => refreshes, setMissing: (value: boolean) => { missingUpdate = value; },
    observe: () => host.tryRun(input, target, { resumeTaskId: id }),
    resume: () => host.tryRun(input, target, { resumeTaskId: id, resumeRequested: true }),
    rebuild: () => {
      const cold = createHost();
      return { host: cold, observe: () => cold.tryRun(input, target, { resumeTaskId: id }),
        resume: () => cold.tryRun(input, target, { resumeTaskId: id, resumeRequested: true }) };
    } };
}

for (const lockedAt of ["parent-read", "receipt-write", "event-write", "watchdog"] as const) {
  test(`an ordinary attempt retains its finish during an active review and identity lock: ${lockedAt}`, { timeout: 6000 }, async (context) => {
    const lock = path.join(isolatedHome, ".sinitek_cli", "loop-task-identities", "transaction.lock");
    const backoff = deferred<void>();
    const reports: string[] = [];
    let armLock = false;
    const env = harness({ retryDelay: () => lockedAt === "watchdog" ? Promise.resolve() : backoff.promise,
      recordAttempt: attemptId => { reports.push(attemptId); }, beforeOrdinaryCommit: patch => {
        if (!armLock || !(lockedAt === "receipt-write" ? patch.loopPlusAttemptCompletionReceipts : patch.loopPlus)) return;
        armLock = false;
        fs.writeFileSync(lock, "fixture", { flag: "wx" });
      } });
    context.after(() => { fs.rmSync(lock, { force: true }); backoff.resolve(); });
    await flush();
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A"), child("B")] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "first" });
    await flush();
    const review = env.mains.at(-1)!;
    assert.equal(review.request.kind, "review");
    const attempt = env.attempts[1].request;
    const event = buildLoopPlusFinishEventId("B", attempt.attemptId);
    if (lockedAt === "event-write" || lockedAt === "receipt-write") armLock = true;
    else fs.writeFileSync(lock, "fixture", { flag: "wx" });
    env.attempts[1].resolve({ outcome: "completed", detail: "original finish" });
    await flush();
    assert.ok(!env.messages.includes("loop-plus-persist-failed"));
    assert.ok(env.finishDiagnostics.some(entry => entry.stage === (lockedAt === "watchdog" ? "parent-read" : lockedAt)
      && entry.result === (lockedAt === "watchdog" ? "waiting-for-watchdog" : "retry")));
    assert.equal(env.cleanupCount(), 1);
    assert.deepEqual(env.finishedChats, ["A"]);
    env.host.reportAttempt(env.id, { ...attempt, outcome: "failed", detail: "duplicate" });
    fs.unlinkSync(lock);
    backoff.resolve();
    if (lockedAt === "watchdog") env.host.checkWaitingMainTasks();
    await flush();
    assert.equal(env.read().status, "running");
    assert.deepEqual(snapshot(env.read()).reviewQueue.map(item => [item.eventId, item.detail]), [[event, "original finish"]]);
    assert.equal(env.mains.length, 2);
    assert.deepEqual(reports, env.attempts.map(item => item.request.attemptId));
    assert.deepEqual(env.finishedChats, ["A", "B"]);
    assert.equal(env.cleanupCount(), 2);
    assert.ok(!env.messages.includes("loop-plus-persist-failed"));
    review.resolve(json({ status: "accept", reviewEventIds: review.request.reviewEventIds }));
    await flush();
    const finalReview = env.mains.at(-1)!;
    assert.deepEqual(finalReview.request.reviewEventIds, [event]);
    finalReview.resolve(completed([event]));
    await env.run.done;
    assert.equal(env.read().status, "completed");
    assert.equal(env.attempts.length, 2);
  });
}

for (const change of ["local-stop", "external-stop", "moved-source", "metadata-at-write", "parallel-finishes"] as const) {
  test(`ordinary finish rechecks the open attempt and parent after contention: ${change}`, { timeout: 6000 }, async (context) => {
    const lock = path.join(isolatedHome, ".sinitek_cli", "loop-task-identities", "transaction.lock");
    const backoff = deferred<void>();
    const reports: string[] = [];
    let updateVersion = false;
    const env = harness({ maxConcurrency: 2, retryDelay: () => backoff.promise,
      recordAttempt: attemptId => { reports.push(attemptId); }, beforeOrdinaryCommit: (patch, expected) => {
        if (updateVersion && patch.loopPlus) {
          updateVersion = false;
          assert.ok(store.updateLoopTaskRecord(expected.id, { loopPlusProgressPercent: 42 }));
        }
      } });
    context.after(() => { fs.rmSync(lock, { force: true }); backoff.resolve(); });
    await flush();
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [
      { ...child("A"), requiresAcceptance: false }, { ...child("B"), requiresAcceptance: false }, child("C"),
    ] }));
    await flush();
    const attempt = env.attempts[0].request;
    fs.writeFileSync(lock, "fixture", { flag: "wx" });
    env.attempts[0].resolve({ outcome: "completed", detail: "A original" });
    if (change === "parallel-finishes") env.attempts[1].resolve({ outcome: "failed", detail: "B failed" });
    await flush();
    fs.unlinkSync(lock);
    env.host.checkWaitingTasks();
    assert.deepEqual(snapshot(env.read()).running.map(item => item.subtaskId), ["A", "B"]);
    if (change === "local-stop") env.host.stopParent(env.id);
    if (change === "external-stop") store.updateLoopTaskRecord(env.id, { status: "stopped", finalSummary: "外部中止" });
    if (change === "moved-source") store.updateLoopTaskRecord(env.id, { workspaceKey: "changed-origin" });
    updateVersion = change === "metadata-at-write";
    const before = env.read();
    backoff.resolve();
    await flush();
    const saved = env.read();
    if (change === "external-stop" || change === "moved-source") {
      assert.deepEqual(saved, before);
      assert.deepEqual(reports, []);
      assert.equal(env.cleanupCount(), 0);
      assert.equal(env.attempts.length, 2);
      return;
    }
    assert.equal(saved.status, change === "local-stop" ? "stopped" : "running");
    assert.deepEqual(snapshot(saved).reportQueue?.filter(item => item.attemptId === attempt.attemptId).map(item => item.detail), ["A original"]);
    assert.equal(env.cleanupCount(), 1);
    if (change === "local-stop") {
      assert.equal(snapshot(saved).parentStopped, true);
      assert.deepEqual(snapshot(saved).pending.map(item => item.subtaskId), ["C"]);
      assert.equal(env.attempts.length, 2);
      assert.equal(store.updateLoopTaskRecord(env.id, { status: "running" }, {
        expectedOrdinaryRun: { ...saved, retainedStatus: "stopped" },
      }), null);
    } else {
      assert.deepEqual(env.attempts.map(item => item.request.subtaskId), ["A", "B", "C"]);
      if (change === "metadata-at-write") {
        assert.equal(saved.loopPlusProgressPercent, 42);
        assert.equal(reports.length, 1);
      } else {
        assert.deepEqual(reports, env.attempts.slice(0, 2).map(item => item.request.attemptId));
        assert.equal(snapshot(saved).seenAttempts.find(item => item.subtaskId === "B")?.outcome, "failed");
      }
    }
    assert.ok(!env.messages.includes("loop-plus-persist-failed"));
  });
}

test("a compact direct completion waits for an authoritative read without requesting another model turn", { timeout: 5000 }, async (context) => {
  const lock = path.join(isolatedHome, ".sinitek_cli", "loop-task-identities", "transaction.lock");
  context.after(() => fs.rmSync(lock, { force: true }));
  const backoff = deferred<void>();
  const env = harness({ retryDelay: () => backoff.promise });
  await flush();
  const file = env.read().taskStoreFile;
  const before = fs.readFileSync(file);
  fs.writeFileSync(lock, "fixture", { flag: "wx" });
  env.mains[0].resolve(json({ status: "completed", directCompletion: true,
    answerConclusion: "已完成简单任务", finalSummary: "原始回复" }));
  await flush();
  assert.deepEqual(env.completionDiagnostics.map(({ result, stage }) => [result, stage]), [["retry", "parent-read"]]);
  assert.deepEqual(fs.readFileSync(file), before);
  fs.unlinkSync(lock);
  backoff.resolve();
  await env.run.done;
  assert.equal(env.read().status, "completed");
  assert.equal(env.read().finalSummary, "原始回复");
  assert.deepEqual(env.completedNotices, [env.id]);
  assert.equal(env.mains.length, 1);
  assert.equal(env.attempts.length, 0);
});

for (const failureAt of ["parent-read", "final-write", "watchdog", "user-stop", "late-message", "changed-plan", "changed-owner"] as const) {
  test(`ordinary completed JSON retains its final review across identity contention: ${failureAt}`, { timeout: 5000 }, async (t) => {
    const lock = path.join(isolatedHome, ".sinitek_cli", "loop-task-identities", "transaction.lock");
    t.after(() => fs.rmSync(lock, { force: true }));
    const backoff = deferred<void>();
    let firstWrite = true;
    const env = harness({ retryDelay: () => failureAt === "watchdog" ? Promise.resolve() : backoff.promise,
      beforeCompletionCommit: () => {
        if (failureAt === "final-write" && firstWrite) fs.writeFileSync(lock, "fixture", { flag: "wx" });
        firstWrite = false;
      } });
    await flush();
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "A delivered" });
    await flush();
    const review = env.mains.at(-1)!;
    const before = env.read();
    const originalBytes = fs.readFileSync(before.taskStoreFile, "utf8");
    if (failureAt !== "final-write") fs.writeFileSync(lock, "fixture", { flag: "wx" });
    review.resolve(completed(review.request.reviewEventIds));
    await flush();
    assert.ok(env.completionDiagnostics.some(entry => entry.result === "retry"), JSON.stringify(env.completionDiagnostics));
    assert.equal(fs.readFileSync(before.taskStoreFile, "utf8"), originalBytes);
    assert.deepEqual(env.completedNotices, []);
    assert.deepEqual(env.feedback, []);
    fs.unlinkSync(lock);
    if (failureAt === "user-stop") env.host.stopParent(env.id);
    if (failureAt === "late-message") env.host.submitUserMessage(env.id, "还需要补充验证");
    if (failureAt === "changed-plan") {
      assert.equal(env.host.applyAcceptancePlan(env.id, { id: "performance", name: "性能", checks: ["performance"] }).ok, true);
    }
    if (failureAt === "changed-owner") store.updateLoopTaskRecord(env.id, { workspaceKey: "another-workspace" });
    backoff.resolve();
    if (failureAt === "watchdog") {
      assert.equal(env.completionDiagnostics.at(-1)?.result, "waiting-for-watchdog");
      env.host.checkWaitingMainTasks();
      env.host.checkWaitingMainTasks();
    }
    await flush();
    if (failureAt === "late-message") {
      assert.equal(env.read().status, "running");
      assert.ok(snapshot(env.read()).userMessageQueue.includes("还需要补充验证"));
      env.host.stopParent(env.id);
    }
    if (failureAt === "changed-plan") {
      assert.equal(env.read().status, "running");
      assert.equal(env.completionDiagnostics.at(-1)?.result, "replan");
      assert.equal(env.mains.length, 3);
      assert.deepEqual(env.mains[2].request.reviewEventIds, review.request.reviewEventIds);
      assert.match(env.mains[2].request.modelPrompt, /performance/i);
      assert.deepEqual(env.feedback, []);
      env.host.stopParent(env.id);
    }
    await env.run.done;
    if (failureAt === "user-stop" || failureAt === "late-message" || failureAt === "changed-plan" || failureAt === "changed-owner") {
      assert.notEqual(env.read().status, "completed");
      assert.deepEqual(env.completedNotices, []);
    } else {
      const final = env.read();
      assert.equal(final.status, "completed");
      assert.equal(final.finalSummary, "全部完成");
      assert.equal(final.loopPlusProgressPercent, 100);
      assert.equal(snapshot(final).seenAttempts[0].acceptance, "passed");
      assert.deepEqual(env.completedNotices, [env.id]);
      assert.equal(env.feedback.length, 1);
      assert.equal(env.mains.length, 2);
      assert.equal(env.completionDiagnostics.at(-1)?.result, "committed");
    }
    assert.equal(env.attempts.length, 1);
  });
}

// Inject below the actual updater/refresher/orchestrator boundary, including atomic rename.
function failDisk(t: import("node:test").TestContext, mode: "write" | "rename", storeFile: string, predicate: (task: LoopTaskRecord) => boolean) {
  let failures = 0;
  const shouldFail = (data: unknown) => {
    try { return predicate(JSON.parse(String(data)).tasks[0]); } catch { return false; }
  };
  if (mode === "write") {
    const isTaskFile = (file: fs.PathLike) => String(file) === storeFile
      || (path.dirname(String(file)) === path.dirname(storeFile) && path.basename(String(file)).startsWith(`.${path.basename(storeFile)}.`));
    const taskDescriptors = new Set<number>();
    const open = fs.openSync;
    t.mock.method(fs, "openSync", (...args: Parameters<typeof open>) => {
      const descriptor = open(...args);
      if (isTaskFile(args[0])) taskDescriptors.add(descriptor);
      else taskDescriptors.delete(descriptor);
      return descriptor;
    });
    const original = fs.writeFileSync;
    t.mock.method(fs, "writeFileSync", (file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, ...args: unknown[]) => {
      const writingTask = typeof file === "number" ? taskDescriptors.delete(file) : isTaskFile(file);
      if (writingTask && shouldFail(data)) {
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

test("分钟补充需求写入失败时保持原队列，下次巡检提交后才发给主任务", async (context) => {
  const env = harness();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("parked")] }));
  const original = await env.firstAttemptStarted;
  env.attempts[0].resolve({ outcome: "stopped", detail: "等待续跑" });
  await flush();
  const parent = env.read();
  const failures = failDisk(context, "write", parent.taskStoreFile, task => Boolean(task.supplementalRequirements?.length));
  env.host.checkWaitingMainTasks();
  assert.equal(failures(), 1);
  assert.deepEqual(env.read(), parent);
  assert.equal(env.mains.length, 1);
  context.mock.restoreAll();
  env.host.checkWaitingMainTasks();
  env.host.checkWaitingMainTasks();
  await flush();
  const saved = env.read();
  const queued = snapshot(saved).userMessageQueue;
  assert.equal(queued.length, 1);
  assert.ok(queued[0].includes(original.attemptId));
  assert.deepEqual(saved.supplementalRequirements, queued);
  assert.equal(env.mains.length, 2);
  assert.ok(env.mains[1].request.modelPrompt.includes(queued[0]));
  env.host.stopParent(env.id);
  await env.run.done;
});

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
  const continueEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
  try {
    const scheduler = createLoopPlusScheduler({ maxConcurrency: 4 });
    const opened = [{ subtaskId: "P", attemptId: "review-first" }, { subtaskId: "Q", attemptId: "review-next" },
      { subtaskId: "R", attemptId: "report", requiresAcceptance: false }];
    scheduler.dispatch(opened);
    for (const attempt of opened) scheduler.finish({ ...attempt, outcome: "completed", detail: attempt.attemptId });
    const ready = { subtaskId: "X", attemptId: "independent" };
    const successor = { subtaskId: "B", attemptId: "dependent", dependsOn: ["P"] };
    scheduler.dispatch([ready, successor], { deferPromotion: true });
    const paused = scheduler.snapshot();
    const taskStoreFile = store.buildLoopTaskStoreFile("codex", "workspace", "session", taskId);
    const task: LoopTaskRecord = {
      id: taskId, taskStoreFile, workspaceKey: "workspace", cli: "codex", sessionId: fixture.target.sessionId,
      status: "needs-review", rootPrompt: "synthetic task", schedulingMode: "event_driven", loopPlus: paused,
      mainAiFailureCount: 5, mainAiFailureLimitReached: true, mainAiLastFailureCode: RUNTIME_CONFIG_LOCK_TIMEOUT,
      mainAiLastFailureMessage: RUNTIME_CONFIG_LOCK_TIMEOUT_MESSAGE, finalSummary: "原暂停",
      originProfile: { configId }, modelRouting: { main: { cli: "codex", model: "main-model" }, subtask: { model: "sub-model" } },
      createdAt: Date.now(), updatedAt: Date.now(), maxRounds: 4, currentRound: 1, activeSubtaskId: null, activeSubtaskIds: [],
      subTasks: [...opened, ready, successor].map((attempt) => ({ id: attempt.subtaskId, title: attempt.subtaskId,
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
      showWarningMessage: (message) => { warnings.push(message); },
      logEvent: (event, payload) => continueEvents.push({ event, payload }),
      t: (key) => key,
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
    let clickNumber = 0;
    const click = () => coordinator.handleMessage(taskId, {
      type: "loopGroupChatChat:continueTask", prompt: instruction, requestId: `continue-test-${++clickNumber}`,
    }, panel);
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
    await waitForLoopPlus(() => fixture.attemptCalls.length === 2, "committed independent and dependent reservations");
    assert.equal(turns().length, 1);
    const firstTurn = turns()[0].message.params!;
    assert.equal(firstTurn.threadId, threadId);
    assert.ok((firstTurn.input as Array<{ text?: string }>).some(({ text }) => text?.includes(instruction)));
    assert.equal(native.wire.some(({ message }) => message.method === "thread/start"), false);
    assert.deepEqual(fixture.attemptCalls.map((input) => input.loopSubtaskId), [ready.subtaskId, successor.subtaskId]);
    const commit = staged[1];
    assert.equal(commit.status, "running");
    assert.equal(commit.mainAiFailureCount, 0);
    assert.deepEqual(commit.supplementalRequirements, ["原说明", instruction]);
    const resumed = snapshot(commit);
    assert.deepEqual(resumed.currentReview, paused.currentReview);
    assert.deepEqual(resumed.reviewQueue, paused.reviewQueue);
    assert.deepEqual(resumed.reportQueue, paused.reportQueue);
    assert.deepEqual(resumed.pending, []);
    assert.deepEqual(resumed.running.map((item) => item.attemptId), [ready.attemptId, successor.attemptId]);
    assert.equal(fixture.mainCalls[0].loopTaskId, taskId);
    assert.ok(continueEvents.some(({ event, payload }) => event === "loop-group-chat-continue-received" && payload.requestId === "continue-test-2"));
    assert.ok(continueEvents.some(({ event, payload }) => event === "loop-group-chat-continue-dispatch" && payload.requestId === "continue-test-2"));
    const openStages = continueEvents.filter(({ event, payload }) => event === "loop-group-chat-continue-stage" && payload.requestId === "continue-test-2");
    assert.equal(openStages.some(({ payload }) => payload.stage === "run_loop_prompt" && payload.boundary === "start"), true);
    assert.equal(openStages.some(({ payload }) => payload.stage === "run_loop_prompt" && payload.boundary === "end"), false);
    assert.equal(JSON.stringify(openStages).includes(instruction), false);
  } finally {
    fixture.adapter.host().stopParent(taskId);
    finishMain.resolve();
    await retry;
    assert.ok(continueEvents.some(({ event, payload }) => event === "loop-group-chat-continue-settled" && payload.requestId === "continue-test-2"));
    assert.ok(continueEvents.some(({ event, payload }) => event === "loop-group-chat-continue-stage" && payload.requestId === "continue-test-2" && payload.stage === "run_loop_prompt" && payload.boundary === "end"));
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
    assert.equal(env.feedback.length, 0);
    t.mock.restoreAll();
    await env.resume().done;
    assert.equal(env.read().status, "completed");
    assert.equal(env.host.hasController(env.id), false);
    assert.equal(env.mains.length, calls);
    assert.equal(env.feedback.length, 1);
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

for (const receiptSurvives of [true, false]) {
  test(`cold finish recovery ${receiptSurvives ? "replays a host receipt into main acceptance" : "parks an unconfirmed attempt despite a success claim"}`, { timeout: 5000 }, async (context) => {
    const artifactDir = fs.mkdtempSync(path.join(isolatedHome, "temporary-requirement-"));
    const artifact = path.join(artifactDir, "release-note.txt");
    const env = harness({ temporaryRequirement: `创建 ${artifact}，内容为 ready。` });
    await flush();
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [{ ...child("note"), writeFiles: ["release-note.txt"] }] }));
    const attempt = await env.firstAttemptStarted;
    assert.equal(attempt.execution?.configId, "fullstack-fixture");
    assert.equal(attempt.execution?.model, "coding-model");
    assert.ok(attempt.communicationFile);
    fs.writeFileSync(artifact, "ready\n");
    fs.appendFileSync(attempt.communicationFile, `\n## Attempt result\n- attempt: ${attempt.attemptId}\n- outcome: completed\n不可信的沟通文件内容\n`);
    const failures = failDisk(context, "write", env.read().taskStoreFile, (task) => {
      const scheduler = snapshot(task);
      return !!scheduler.currentReview || !!scheduler.reviewQueue.length
        || (!receiptSurvives && !!task.loopPlusAttemptCompletionReceipts?.length);
    });
    const detail = "已写入 release-note.txt，内容为 ready。";
    env.attempts[0].resolve({ outcome: "completed", detail });
    await env.run.done;
    assert.equal(failures(), receiptSurvives ? 2 : 3);
    assert.deepEqual(env.events, receiptSurvives
      ? ["finish-commit", "finish-pause-commit"] : ["finish-receipt-commit", "finish-commit", "finish-pause-commit"]);
    assert.equal(snapshot(env.read()).currentReview, null);
    assert.equal(snapshot(env.read()).running[0]?.attemptId, attempt.attemptId);
    assert.deepEqual(env.read().loopPlusAttemptCompletionReceipts, receiptSurvives ? [
      { subtaskId: "note", attemptId: attempt.attemptId, detail },
    ] : undefined);
    assert.equal(env.cleanupCount(), 0);
    assert.deepEqual(env.finishedChats, []);
    context.mock.restoreAll();

    const cold = env.rebuild();
    const mainCallsBeforeRecovery = env.mains.length;
    cold.observe();
    await flush();
    assert.equal(env.attempts.length, 1);
    assert.equal(env.mains.length, mainCallsBeforeRecovery);
    assert.deepEqual(env.completedNotices, []);
    const eventId = buildLoopPlusFinishEventId("note", attempt.attemptId);
    if (!receiptSurvives) {
      assert.equal(env.read().subTasks[0].status, "blocked");
      assert.match(env.read().subTasks[0].executionFailure ?? "", /无法确认上次子任务执行结果/);
      assert.equal(snapshot(env.read()).running[0]?.attemptId, attempt.attemptId);
      assert.equal(snapshot(env.read()).currentReview, null);
      assert.deepEqual(snapshot(env.read()).reviewQueue, []);
      assert.equal(snapshot(env.read()).completed, false);
    } else {
      assert.equal(env.read().status, "error");
      assert.equal(snapshot(env.read()).currentReview?.eventId, eventId);
      assert.equal(snapshot(env.read()).currentReview?.detail, detail);
      assert.equal(env.read().loopPlusAttemptCompletionReceipts, undefined);
    }

    const resumed = cold.resume();
    await flush();
    if (!receiptSurvives) {
      assert.equal(env.attempts.length, 1);
      assert.equal(env.mains.length, mainCallsBeforeRecovery);
      assert.equal(cold.host.resumeInterruptedSubtasks(env.id), true);
      await flush();
      assert.equal(env.attempts[1]?.request.attemptId, attempt.attemptId);
      env.attempts[1].resolve({ outcome: "completed", detail });
      await flush();
    }
    assert.equal(env.mains.length, mainCallsBeforeRecovery + 1);
    const review = env.mains.at(-1)!;
    assert.equal(review.request.kind, "review");
    assert.deepEqual(review.request.reviewEventIds, [eventId]);
    assert.equal(fs.readFileSync(artifact, "utf8"), "ready\n");
    assert.equal(env.read().status, "running");
    cold.host.reportAttempt(env.id, { subtaskId: "note", attemptId: attempt.attemptId, outcome: "completed", detail: "重复回调" });
    review.resolve(completed([eventId]));
    await resumed.done;
    assert.equal(env.read().status, "completed");
    assert.equal(snapshot(env.read()).seenAttempts.find((item) => item.attemptId === attempt.attemptId)?.acceptance, "passed");
    assert.deepEqual(env.completedNotices, [env.id]);
    assert.equal(env.attempts.length, receiptSurvives ? 1 : 2);
    assert.equal(env.cleanupCount(), receiptSurvives ? 0 : 1);
    assert.deepEqual(env.finishedChats, receiptSurvives ? [] : ["note"]);
  });
}

for (const contention of ["parent-read", "verdict", "progress", "repair", "promotion", "watchdog", "user-stop", "changed-source"] as const) {
  test(`ordinary acceptance resumes its uncommitted step across identity contention: ${contention}`, { timeout: 6000 }, async (context) => {
    const lock = path.join(isolatedHome, ".sinitek_cli", "loop-task-identities", "transaction.lock");
    const entered = deferred<void>();
    const release = deferred<void>();
    let armed = false;
    let verdictWrites = 0;
    const delays: number[] = [];
    const env = harness({ retryDelay: async (ms) => {
      delays.push(ms);
      entered.resolve();
      if (contention !== "watchdog") await release.promise;
    },
      beforeOrdinaryCommit: (patch, expected) => {
        const next = patch.loopPlus ? createLoopPlusScheduler({ snapshot: patch.loopPlus }).snapshot() : undefined;
        const verdict = next?.seenAttempts.some(item => item.subtaskId === "A" && item.repairRequired)
          && !snapshot(expected).seenAttempts.some(item => item.subtaskId === "A" && item.repairRequired);
        const progress = patch.loopPlusProgressPercent === 23;
        const repair = next?.pending.some(item => item.subtaskId === "A");
        const promotion = next?.running.some(item => item.subtaskId === "A");
        const trigger = { verdict, repair, promotion, progress, "user-stop": progress, "changed-source": progress,
          watchdog: false, "parent-read": false }[contention];
        if (armed && trigger) {
          fs.writeFileSync(lock, "fixture", { flag: "wx" });
          armed = false;
        } else if (verdict) verdictWrites++;
      } });
    context.after(() => { fs.rmSync(lock, { force: true }); release.resolve(); env.host.stopParent(env.id); });
    await flush();
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A"), child("B")] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "A" });
    await flush();
    const review = env.mains.at(-1)!;
    const ids = review.request.reviewEventIds!;
    assert.equal(ids.length, 1);
    if (contention === "parent-read" || contention === "watchdog") fs.writeFileSync(lock, "fixture", { flag: "wx" });
    else armed = true;
    review.resolve(json({ status: "accept", reviewEventIds: ids, subtasks: [child("A")] }));
    await entered.promise;
    if (contention === "watchdog") {
      await flush();
      assert.deepEqual(delays, [100, 400, 1000]);
    }
    fs.unlinkSync(lock);
    const wasSubmitted = !["parent-read", "verdict", "watchdog"].includes(contention);
    assert.equal(snapshot(env.read()).seenAttempts.some(item => item.subtaskId === "A" && item.acceptance === "failed"), wasSubmitted);
    if (contention === "user-stop") env.host.stopParent(env.id);
    else if (contention === "changed-source") store.updateLoopTaskRecord(env.id, { workspaceKey: "different-workspace" });
    else {
      env.attempts[1].resolve({ outcome: "completed", detail: "B during contention" });
      await flush();
      const duringWait = snapshot(env.read());
      assert.ok([duringWait.currentReview, ...duringWait.reviewQueue].some(item => item?.subtaskId === "B"));
    }
    release.resolve();
    if (contention === "watchdog") env.host.checkWaitingMainTasks();
    await flush();
    if (contention === "user-stop" || contention === "changed-source") {
      assert.equal(env.attempts.length, 2);
      assert.ok(snapshot(env.read()).seenAttempts.some(item => item.subtaskId === "A" && item.repairRequired));
      if (contention === "user-stop") assert.equal(env.read().status, "stopped");
      else assert.equal(env.read().workspaceKey, "different-workspace");
    } else {
      assert.equal(env.read().status, "running");
      assert.equal(verdictWrites, 1);
      assert.deepEqual(env.attempts.map(item => item.request.subtaskId), ["A", "B", "A"]);
      assert.equal(env.mains.filter(item => item.request.reviewEventIds?.includes(ids[0])).length, 1);
      assert.equal(snapshot(env.read()).currentReview?.subtaskId, "B");
      assert.equal(env.feedback.length, 1);
    }
    assert.ok(!env.events.includes("loop-plus-consumer-failed"));
  });
}

for (const changed of ["plan", "durable-batch", "version-at-write"] as const) {
  test(`ordinary acceptance discards an obsolete reply after the first locked read: ${changed}`, { timeout: 6000 }, async (context) => {
    const lock = path.join(isolatedHome, ".sinitek_cli", "loop-task-identities", "transaction.lock");
    const release = deferred<void>();
    const entered = deferred<void>();
    let changeAtWrite = false;
    const env = harness({ retryDelay: async () => { entered.resolve(); await release.promise; }, beforeOrdinaryCommit: () => {
      if (!changeAtWrite) return;
      changeAtWrite = false;
      store.updateLoopTaskRecord(env.id, { status: "stopped", finalSummary: "外部已停止" });
    } });
    context.after(() => { fs.rmSync(lock, { force: true }); release.resolve(); env.host.stopParent(env.id); });
    await flush();
    env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
    await flush();
    env.attempts[0].resolve({ outcome: "completed", detail: "A" });
    await flush();
    const review = env.mains.at(-1)!;
    const ids = review.request.reviewEventIds!;
    fs.writeFileSync(lock, "fixture", { flag: "wx" });
    review.resolve(json({ status: "accept", reviewEventIds: ids, subtasks: [child("A")] }));
    await entered.promise;
    fs.unlinkSync(lock);
    if (changed === "durable-batch") {
      const authoritative = createLoopPlusScheduler({ snapshot: env.read().loopPlus });
      assert.ok(authoritative.submitReviewBatch(ids, "passed").ok);
      store.updateLoopTaskRecord(env.id, { loopPlus: authoritative.snapshot() });
    } else if (changed === "plan") {
      assert.ok(env.host.applyAcceptancePlan(env.id, { id: "performance", name: "性能", checks: ["performance"] }).ok);
    } else {
      changeAtWrite = true;
    }
    release.resolve();
    await flush();
    const saved = env.read();
    if (changed === "plan") {
      assert.deepEqual(env.mains.at(-1)?.request.reviewEventIds, ids);
      assert.equal(env.mains.length, 3);
      assert.equal(snapshot(saved).currentReview?.eventId, ids[0]);
    } else if (changed === "durable-batch") {
      assert.equal(snapshot(saved).seenAttempts.find(item => item.subtaskId === "A")?.acceptance, "passed");
    } else {
      assert.equal(saved.status, "stopped");
      assert.equal(saved.finalSummary, "外部已停止");
    }
    assert.equal(env.feedback.length, 0);
    assert.equal(env.attempts.length, 1);
    assert.ok(!env.messages.includes("loop-plus-consumer-failed"));
  });
}

test("a real acceptance commit failure restores the frozen event and does not launch repair", { timeout: 5000 }, async (t) => {
  const env = harness();
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A")] }));
  await flush();
  const original = env.attempts[0]?.request;
  assert.ok(original);
  assert.equal(original.subtaskId, "A");
  const expectedEventId = buildLoopPlusFinishEventId("A", original.attemptId);
  env.host.submitUserMessage(env.id, "这条消息只确认一次");
  await flush();
  // Leave the message invocation open; the finish must remain an independently queued review.
  env.attempts[0].resolve({ outcome: "completed", detail: "A" });
  await flush();
  const userTurn = [...env.mains].reverse().find((item) => item.request.kind === "user");
  assert.ok(userTurn);
  userTurn.resolve(json({ status: "wait" }));
  await flush();
  const matchesFrozenReview = (item: (typeof env.mains)[number]) => item.request.kind === "review"
    && item.request.reviewEventId === expectedEventId
    && item.request.reviewEventIds?.length === 1
    && item.request.reviewEventIds[0] === expectedEventId;
  const openingReviews = env.mains.filter(matchesFrozenReview);
  assert.equal(openingReviews.length, 1);
  const review = openingReviews[0];
  assert.equal(review.request.kind, "review");
  assert.deepEqual(review.request.reviewEventIds, [expectedEventId]);
  const acceptPayload = { status: "accept", reviewEventIds: [expectedEventId], subtasks: [child("A")] };
  const generated = JSON.parse(json(acceptPayload)) as {
    reviews?: Array<{ reviewEventId?: string; acceptance?: string; reason?: string; subtaskIds?: string[] }>;
  };
  assert.deepEqual(generated.reviews, [{
    reviewEventId: expectedEventId, acceptance: "failed", reason: "需要修复失败项", subtaskIds: ["A"],
  }]);
  assert.equal(env.attempts.length, 1);
  const failures = failDisk(t, "write", env.read().taskStoreFile,
    (task) => snapshot(task).seenAttempts.some((item) => item.disposition === "reviewed"));
  const mainsBeforeAccept = env.mains.length;
  review.resolve(json(acceptPayload));
  let firstDone = "pending";
  await env.run.done.then(() => { firstDone = "settled"; }, () => { firstDone = "rejected"; });
  const failureCount = failures();
  const requestsAfterAccept = env.mains.slice(mainsBeforeAccept).map((item) => item.request.kind);
  const frozenEventId = snapshot(env.read()).currentReview?.eventId ?? null;
  console.log(`LP516 ${JSON.stringify({
    expectedEventId, frozenEventId, failureCount, firstDone,
    attempts: env.attempts.length, events: env.events, requestsAfterAccept,
  })}`);
  assert.deepEqual(requestsAfterAccept, []);
  assert.equal(firstDone, "settled");
  assert.ok(failureCount > 0);
  assert.equal(env.attempts.length, 1);
  assert.equal(env.feedback.length, 0);
  assert.equal(frozenEventId, expectedEventId);
  assert.equal(snapshot(env.read()).seenAttempts.some((item) => item.disposition === "reviewed"), false);
  t.mock.restoreAll();
  const mainsBeforeResume = env.mains.length;
  const resumed = env.resume();
  await flush();
  const recovered = env.mains.slice(mainsBeforeResume).filter(matchesFrozenReview);
  assert.equal(recovered.length, 1);
  const retried = recovered[0];
  assert.ok(env.mains.indexOf(retried) >= mainsBeforeResume);
  assert.equal(retried.request.kind, "review");
  assert.deepEqual(retried.request.reviewEventIds, [expectedEventId]);
  const mainsWhenRecoveryOpened = env.mains.length;
  retried.resolve(completed([expectedEventId]));
  let restoredDone = "pending";
  await resumed.done.then(() => { restoredDone = "settled"; }, () => { restoredDone = "rejected"; });
  const requestsAfterRecovery = env.mains.slice(mainsWhenRecoveryOpened).map((item) => item.request.kind);
  const reviewedCount = snapshot(env.read()).seenAttempts.filter((item) => item.disposition === "reviewed").length;
  console.log(`LP516 ${JSON.stringify({
    restoredDone, reviewedCount, requestsAfterRecovery,
    userMessageQueue: snapshot(env.read()).userMessageQueue,
  })}`);
  assert.deepEqual(requestsAfterRecovery, []);
  assert.equal(restoredDone, "settled");
  assert.equal(env.read().status, "completed");
  assert.equal(reviewedCount, 1);
  assert.deepEqual(snapshot(env.read()).userMessageQueue, []);
});

test("decision metadata and the final status share the same commit", async (t) => {
  const env = harness();
  await flush();
  store.updateLoopTaskRecord(env.id, { mainAiFailureCount: 1 });
  const failures = failDisk(t, "write", env.read().taskStoreFile,
    (task) => task.status === "running" && task.mainAiFailureCount === 0);
  env.mains[0].resolve(completed());
  await env.run.done;
  assert.equal(failures(), 0);
  assert.equal(env.read().mainAiFailureCount, 0);
  assert.equal(snapshot(env.read()).completed, true);
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

test("partial accept/dispatch rejection keeps the failed verdict and advances only legitimate remaining work", async () => {
  const env = harness();
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A"), child("B"), { ...child("report"), requiresAcceptance: false }] }));
  await flush();
  const [original, active, report] = env.attempts.map(({ request }) => request);
  const reviewEventId = buildLoopPlusFinishEventId("A", original.attemptId);
  const reportEventId = buildLoopPlusFinishEventId("report", report.attemptId);
  env.attempts[0].resolve({ outcome: "completed", detail: "A" });
  await flush();
  const review = env.mains.at(-1)!;
  assert.deepEqual(review.request.reviewEventIds, [reviewEventId]);
  env.host.submitUserMessage(env.id, "只确认一次");
  env.attempts[2].resolve({ outcome: "completed", detail: "免验收报告" });
  await flush();
  review.resolve(json({ status: "accept", reviewEventIds: review.request.reviewEventIds,
    reviews: [{ reviewEventId, acceptance: "failed", reason: "A needs repair", subtaskIds: ["A"] }],
    independentSubtaskIds: ["B"], subtasks: [child("A"), child("B")] }));
  await flush();
  assert.deepEqual(env.attempts.map(({ request }) => request.subtaskId), ["A", "B", "report", "A"]);
  const repair = env.attempts[3].request;
  assert.notEqual(repair.attemptId, original.attemptId);
  assert.deepEqual(snapshot(env.read()).running.map((item) => [item.subtaskId, item.attemptId]), [["B", active.attemptId], ["A", repair.attemptId]]);
  assert.equal(env.feedback.length, 1);
  const reviewed = () => snapshot(env.read()).seenAttempts.filter((item) => item.disposition === "reviewed")
    .map(({ subtaskId, attemptId, acceptance }) => ({ subtaskId, attemptId, acceptance }));
  const failedReview = [{ subtaskId: "A", attemptId: original.attemptId, acceptance: "failed" }];
  assert.deepEqual(reviewed(), failedReview);
  const firstCorrection = env.mains.at(-1)!;
  assert.notEqual(firstCorrection, review);
  assert.match(firstCorrection.request.prompt, /active_subtask/);
  assert.match(firstCorrection.request.prompt, /不得重复 accept/);
  assert.equal(env.read().subTasks.find((item) => item.id === "B")?.title, "B");
  assert.deepEqual(firstCorrection.request.reportEventIds, [reportEventId]);
  firstCorrection.resolve(json({ status: "dispatch", reportEventIds: [reportEventId], subtasks: [child("remaining"), child("B")] }));
  await flush();
  const launchedIds = ["A", "B", "report", "A", "remaining"];
  assert.deepEqual(env.attempts.map(({ request }) => request.subtaskId), launchedIds);
  assert.equal(env.attempts.filter(({ request }) => request.subtaskId === "B").length, 1);
  assert.equal(env.attempts.filter(({ request }) => request.subtaskId === "A").length, 2);
  const remainingAttempt = env.attempts[4].request;
  assert.equal(remainingAttempt.subtaskId, "remaining");
  assert.notEqual(remainingAttempt.attemptId, active.attemptId);
  assert.notEqual(remainingAttempt.attemptId, repair.attemptId);
  assert.deepEqual(snapshot(env.read()).running.map((item) => [item.subtaskId, item.attemptId]).sort(), [
    ["A", repair.attemptId],
    ["B", active.attemptId],
    ["remaining", remainingAttempt.attemptId],
  ].sort());
  assert.deepEqual(snapshot(env.read()).pending, []);
  assert.deepEqual(snapshot(env.read()).reportQueue ?? [], []);
  assert.deepEqual(reviewed(), failedReview);
  assert.equal(env.feedback.length, 1);
  assert.deepEqual(snapshot(env.read()).seenAttempts.filter((item) => item.disposition === "reported").map((item) => item.attemptId), [report.attemptId]);
  assert.deepEqual(snapshot(env.read()).userMessageQueue, []);
  const progress = env.mains.at(-1)!;
  assert.notEqual(progress, firstCorrection);
  assert.equal(env.read().status, "running");
  assert.match(progress.request.prompt, /state\.dispatch\.rejected/);
  assert.match(progress.request.prompt, /不得重复 accept/);
  assert.deepEqual(progress.request.reportEventIds, []);
  env.host.stopParent(env.id);
  await env.run.done;
  assert.deepEqual(env.attempts.map(({ request }) => request.subtaskId), launchedIds);
  assert.deepEqual(reviewed(), failedReview);
  assert.equal(env.feedback.length, 1);
  assert.deepEqual(snapshot(env.read()).seenAttempts.filter((item) => item.disposition === "reported").map((item) => item.attemptId), [report.attemptId]);
  assert.deepEqual(snapshot(env.read()).userMessageQueue, []);
});

test("rejected independent dispatch is corrected successfully without re-accepting A", async () => {
  const env = harness();
  await flush();
  env.mains[0].resolve(json({ status: "dispatch", subtasks: [child("A"), child("B")] }));
  await flush();
  env.attempts[0].resolve({ outcome: "completed", detail: "A needs repair" });
  await flush();
  const review = env.mains.at(-1)!;
  review.resolve(json({ status: "accept", reviewEventIds: review.request.reviewEventIds,
    reviews: [{ reviewEventId: review.request.reviewEventIds![0], acceptance: "failed", reason: "A failed", noRepairReason: "该验证不需重新执行来源任务", subtaskIds: [] }],
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
