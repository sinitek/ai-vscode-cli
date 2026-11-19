import * as path from "node:path";
import type { LoopTaskRecord } from "../../../loopTaskStore";
import type { DepartmentMetadata } from "../../../department";
import type { LoopPlusReviewItem } from "../../../loopPlusScheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, label: string, diagnostic: () => unknown = () => null): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`bounded fixture wait expired: ${label}; pending=${JSON.stringify(diagnostic())}`);
}

async function settleWithin<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`bounded fixture settlement expired: ${label}`)), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function runDepartmentAdmissionRegression(): Promise<void> {
  // Resolve environment-sensitive identity paths only after the caller isolates HOME.
  const { installVscodeMock } = require("../../vscodeMock") as typeof import("../../vscodeMock");
  installVscodeMock();
  const { createDepartmentProductionTaskStore } = require("../../../extensionHost/departmentProductionTaskStore") as typeof import("../../../extensionHost/departmentProductionTaskStore");
  const { prepareDepartmentTaskRecord } = require("../../../extensionHost/departmentOwnedTaskRepository") as typeof import("../../../extensionHost/departmentOwnedTaskRepository");
  const taskStore = require("../../../loopTaskStore") as typeof import("../../../loopTaskStore");
  const { DepartmentCapacityPool } = require("../../../departmentcapacity") as typeof import("../../../departmentcapacity");
  const { createLoopPlusScheduler, buildLoopPlusFinishEventId } = require("../../../loopPlusScheduler") as typeof import("../../../loopPlusScheduler");
  const { buildSystemLoopPlusAcceptancePlanSnapshot } = require("../../../loopPlusAcceptancePlan") as typeof import("../../../loopPlusAcceptancePlan");
  const { createLoopPlusRuntimeFixture } = require("./loopPlusRuntimeFixture") as typeof import("./loopPlusRuntimeFixture");
  const { createDepartmentOrchestrationHost } = require("../../../extensionHost/departmentorchestration") as typeof import("../../../extensionHost/departmentorchestration");

  const plan = buildSystemLoopPlusAcceptancePlanSnapshot();
  const metadata: DepartmentMetadata = {
    version: 1, rootTaskId: "root", parentTaskId: null, leaderSubtaskId: null, role: "director", moduleTitle: "部门",
    routes: {
      director: { cli: "codex", configId: "profile", model: "director" },
      leader: { cli: "codex", configId: "profile", model: "leader" },
      employee: { cli: "codex", configId: "profile", model: "employee" },
    },
    limits: { maxLeaders: 4, maxEmployees: 1 },
  };
  const now = Date.now();
  const rawRoot = {
    id: "root", cli: "codex" as const, workspaceKey: "workspace", taskStoreFile: "", rootPrompt: "部门根任务",
    schedulingMode: "classic" as const, status: "running" as const, createdAt: now, updatedAt: now,
    maxRounds: 20, currentRound: 0, communicationDir: "/fixture", mainCommunicationFile: "/fixture/main",
    sessionId: "director-session", activeSubtaskId: null, activeSubtaskIds: [], subTasks: ["accounts", "reports"].map((id) => ({
      id, title: id, prompt: `实施完整 ${id} 模块并汇报。`, status: "pending" as const,
    })), rounds: [], completionRoundSummaries: [], completionRequirementCoverage: [],
  } as LoopTaskRecord;
  const home = process.env.HOME;
  if (!home || home !== process.env.USERPROFILE || process.env.CODEX_HOME !== path.join(home, ".codex")) {
    throw new Error("department admission fixture requires isolated HOME, USERPROFILE and CODEX_HOME");
  }
  const source = createDepartmentProductionTaskStore(path.join(home, ".sinitek_cli", "department-tasks-v1"));
  const root = source.create(prepareDepartmentTaskRecord(rawRoot, metadata, plan));
  if (taskStore.readLoopTaskRecord(root.id)?.id !== root.id) throw new Error("registered root is not readable through the task-store router");

  const fixture = createLoopPlusRuntimeFixture({ configId: "profile", taskPersistence: {
    create: (task) => source.create(task),
    read: taskStore.readLoopTaskRecord,
    save: (task) => { if (!taskStore.updateLoopTaskRecord(task.id, task)) throw new Error(`owned task update failed: ${task.id}`); },
    remove: (taskId) => { if (!source.deleteTaskRecord(taskId)) throw new Error(`owned task delete failed: ${taskId}`); },
  } });
  const capacity = new DepartmentCapacityPool({ maxLeaders: 4, maxEmployees: 1 });
  const sessions = new Map<string, { tabId: string; cli: "codex"; sessionId: string }>();
  let targetSequence = 0;
  const host = createDepartmentOrchestrationHost({
    capacity,
    readTask: taskStore.readLoopTaskRecord,
    updateTask: taskStore.updateLoopTaskRecord,
    runtime: fixture.adapter,
    createLeaderTarget: () => {
      const target = { tabId: `leader-${++targetSequence}`, cli: "codex" as const, sessionId: `leader-session-${targetSequence}` };
      sessions.set(target.sessionId, target);
      return target;
    },
    buildLeaderInput: (_route: unknown, request: { prompt: string }) => ({
      displayPrompt: request.prompt, modelPrompt: request.prompt, contextTags: [], loopSubtaskMode: "fullstack" as const,
    }),
    validateRoutes: () => true,
    inspectLeaderSession: (task: LoopTaskRecord) => {
      const target = sessions.get(task.sessionId ?? "");
      return target ? { target, live: null } : null;
    },
    observeRestoredExecution: () => null,
    stopLeader: () => undefined,
    persistRuntime: () => undefined,
    notifyDirector: () => undefined,
    createMessageId: (() => { let id = 0; return () => `message-${++id}`; })(),
  });
  const registration = host.registerRoot(taskStore.readLoopTaskRecord(root.id)!, metadata, plan);
  if (!registration.ok) throw new Error(`controlled root registration failed: ${registration.reason}`);

  const initialDecision = deferred<void>();
  const releaseInitialDecision = deferred<void>();
  fixture.queueMain(async (input, tabId) => {
    if (!input.displayPrompt.includes("Available regular employee balance: 1")) {
      throw new Error("first leader did not receive the positive decision-time balance");
    }
    initialDecision.resolve();
    await releaseInitialDecision.promise;
    fixture.publish(input, tabId, { status: "end", content: JSON.stringify({ status: "dispatch", subtasks: [{
      id: "first-employee", title: "first employee", prompt: "Implement this complete module, verify its behavior, and report concrete results and any remaining risks to the leader.", writeFiles: [], taskType: "general",
    }] }) });
  });
  let taskId: string | null = null;
  const lifecycles: Promise<void>[] = [];
  const releaseReview = deferred<void>();
  let failure: unknown;
  try {
    const first = await settleWithin(host.startLeader("root", {
      leaderSubtaskId: "accounts", moduleTitle: "accounts", prompt: "负责完整 accounts 模块并汇报。",
    }), "first legal leader start");
    if (!first.ok) throw new Error(`first legal leader failed to start: ${first.reason}`);
    if (!first.taskId) throw new Error("first legal leader returned no task identity");
    taskId = first.taskId;
    lifecycles.push(first.done);
    void first.done.catch(() => undefined); // Settlement is required and checked during bounded teardown.
    await settleWithin(initialDecision.promise, "first positive decision boundary");
    const issuedPrompt = fixture.mainCalls[0].displayPrompt;

    fixture.queueMain((input, tabId) => fixture.publish(input, tabId, { status: "end", content: JSON.stringify({ status: "dispatch", subtasks: [{
      id: "last-regular-employee", title: "last regular employee", prompt: "Implement this complete module, verify its behavior, and report concrete results and any remaining risks to the leader.", writeFiles: [], taskType: "general",
    }] }) }));
    const second = await settleWithin(host.startLeader("root", {
      leaderSubtaskId: "reports", moduleTitle: "reports", prompt: "负责完整 reports 模块并汇报。",
    }), "second legal leader start");
    if (!second.ok) throw new Error("second legal leader failed to start");
    lifecycles.push(second.done);
    void second.done.catch(() => undefined);
    try { await waitFor(() => fixture.parkedSubtaskIds().includes("last-regular-employee"), "second leader consumes final regular capacity"); }
    catch (error) {
      throw new Error(`${String(error)}; tasks=${JSON.stringify(fixture.createdTaskIds)}; prompts=${JSON.stringify(fixture.mainCalls.map((call) => call.displayPrompt.slice(0, 180)))}; attempts=${JSON.stringify(fixture.attemptCalls.map((call) => call.loopSubtaskId))}; logs=${JSON.stringify(fixture.logs)}`);
    }
    if (capacity.getEmployeeCapacity("root", taskId)?.availableEmployees !== 0) throw new Error("host did not publish the exhausted current balance");

    releaseInitialDecision.resolve();
    await waitFor(() => fixture.parkedSubtaskIds().includes("first-employee"), "first leader rechecked against current occupancy");
    const overflow = capacity.snapshot("root")[0].employeeOverflow ?? [];
    if (overflow.length !== 1 || JSON.parse(overflow[0])[0] !== taskId) {
      throw new Error("host did not atomically recheck the stale positive prompt and issue the leader's single overflow lease");
    }

    if (fixture.mainCalls[0].displayPrompt !== issuedPrompt) throw new Error("issued positive prompt was mutated");
    const rootsBefore = fixture.rootsCreated.length;
    const tabsBefore = fixture.createdSubtaskTargets.length;
    const attemptsBefore = fixture.attemptCalls.length;
    fixture.queueMain((input, tabId) => fixture.publish(input, tabId, { status: "end", content: JSON.stringify({ status: "dispatch", subtasks: [{
      id: "second-overflow", title: "second overflow", prompt: "Implement this additional employee task completely, verify its behavior, and report concrete results and remaining risks to the leader.", writeFiles: [], taskType: "general",
    }] }) }));
    let review: LoopPlusReviewItem | undefined;
    let reviewStarted = false;
    fixture.queueMain(async (input) => {
      const snapshot = createLoopPlusScheduler({ snapshot: taskStore.readLoopTaskRecord(taskId!)?.loopPlus }).snapshot();
      const exactReview = [snapshot?.currentReview, ...(snapshot?.reviewQueue ?? [])].find((item) => item?.subtaskId === "second-overflow");
      if (!exactReview || !input.displayPrompt.includes(exactReview.eventId)) throw new Error("denial review did not receive the exact finish event");
      reviewStarted = true;
      await releaseReview.promise;
    });
    if (!fixture.adapter.host().submitUserMessage(taskId, "增加一个补充员工")) throw new Error("fresh same-group decision was rejected");
    await waitFor(() => {
      const snapshot = createLoopPlusScheduler({ snapshot: taskStore.readLoopTaskRecord(taskId!)?.loopPlus }).snapshot();
      review = [snapshot?.currentReview, ...(snapshot?.reviewQueue ?? [])].find((item): item is LoopPlusReviewItem => !!item && item.subtaskId === "second-overflow");
      return !!review;
    }, "exact second-overflow finish event", () => ({ snapshot: taskStore.readLoopTaskRecord(taskId!)?.loopPlus, logs: fixture.logs }));
    const current = taskStore.readLoopTaskRecord(taskId)!;
    const state = createLoopPlusScheduler({ snapshot: current.loopPlus }).snapshot();
    const seen = state.seenAttempts.find((item) => item.subtaskId === "second-overflow" && item.attemptId === review!.attemptId);
    if (!review || review.outcome !== "failed" || review.eventId !== buildLoopPlusFinishEventId("second-overflow", review.attemptId)
      || !seen || seen.outcome !== "failed" || seen.disposition !== "finished"
      || state.running.some((item) => item.attemptId === review!.attemptId)
      || state.pending.some((item) => item.attemptId === review!.attemptId)) {
      throw new Error(`second overflow did not settle precisely into failed review: ${JSON.stringify({ review, seen, state })}`);
    }
    await waitFor(() => reviewStarted, "exact denial review invocation");
    if (JSON.stringify(capacity.snapshot("root")[0].employeeOverflow ?? []) !== JSON.stringify(overflow)
      || fixture.rootsCreated.length !== rootsBefore || fixture.createdSubtaskTargets.length !== tabsBefore
      || fixture.attemptCalls.length !== attemptsBefore) {
      throw new Error("a second overflow created an execution root, tab or worker, or changed the outstanding overflow lease");
    }
  } catch (error) { failure = error;
  } finally {
    const cleanupFailures: string[] = [];
    releaseInitialDecision.resolve();
    releaseReview.resolve();
    for (const id of fixture.parkedSubtaskIds()) fixture.finishParked(id, { status: "stopped" });
    try { if (!await settleWithin(host.stopRoot("root"), "bounded controlled host teardown")) throw new Error("controlled host teardown refused"); }
    catch (error) { cleanupFailures.push(String(error)); }
    for (const [index, lifecycle] of lifecycles.entries()) {
      try { await settleWithin(lifecycle, `leader ${index} scheduler lifecycle settlement`); }
      catch (error) { cleanupFailures.push(String(error)); }
    }
    fixture.dispose();
    try { await settleWithin(source.close(), "bounded controlled task-store close"); }
    catch (error) { cleanupFailures.push(String(error)); }
    if (cleanupFailures.length) throw new Error(`fixture failed: ${String(failure ?? "no scenario failure")}; recovery failures: ${cleanupFailures.join("; ")}`);
  }
  if (failure !== undefined) throw failure;
}
