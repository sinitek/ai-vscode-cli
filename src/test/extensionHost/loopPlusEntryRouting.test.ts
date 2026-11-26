import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import vm = require("node:vm");
import * as ts from "typescript";
import { installVscodeMock } from "../vscodeMock";
import { createLoopMainQuestionQueue } from "../../loopMainQuestionQueue";
import { askLoopMainModelSession } from "../../loopMainQuestion";
import { PromptRunHandoff } from "../../extensionHost/promptRunHandoff";
import { leaderExecutionScopeKey } from "../../extensionHost/departmentleaderexecutionledger";
import { usesDepartmentOwner } from "../../department";
import { usesCompletedLoopSubtaskTabCleanup } from "../../extensionHost/loopSubtaskTabs";
import type { PromptRunInput } from "../../promptRunTypes";
import type { ChatMessage } from "../../webview/types";

installVscodeMock();

const { resolveLoopPlusEntry } = require("../../extensionHost/loopPlusOrchestration") as typeof import("../../extensionHost/loopPlusOrchestration");
const { schedulingModeForInteractiveMode } = require("../../extensionHost/modelSettings") as typeof import("../../extensionHost/modelSettings");
const {
  resolveLoopPlusAttemptOutcome,
  shouldCloseLoopPlusParentGateBeforeAbort,
} = require("../../extensionHost/promptRunRuntime") as typeof import("../../extensionHost/promptRunRuntime");

function readSource(...relativePath: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...relativePath), "utf8");
}

function functionBody(source: string, name: string): string {
  const file = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration?.body, `${name} should have a function body`);
  return declaration.body.getText(file);
}

test("production main watchdog checks the open original tab and its native thread", () => {
  const source = readSource("src", "extension.ts");
  const activation = functionBody(source, "activate");
  assert.match(activation, /startLoopWaitWatchdog\(\[[\s\S]*checkWaitingTasks\(\)[\s\S]*\], [\s\S]*checkInterruptedMainTasks\(\)[\s\S]*checkWaitingReviews\(\)/);
  const sandbox = {
    isExtensionDeactivating: false,
    activeWorkspaceKey: "workspace",
    tab: { id: "tab-main", cli: "codex", sessionId: "local-session" } as object | null,
    role: "main",
    loopTaskId: "task",
    thread: "thread-1",
    getConversationTabById: (tabId: string) => tabId === "tab-main" ? sandbox.tab : null,
    resolveConversationTabLoopContext: () => ({ taskRole: sandbox.role, loopTaskId: sandbox.loopTaskId }),
    resolveInteractiveMappedId: () => sandbox.thread,
    isLocalSessionId: () => true,
  };
  const check = vm.runInNewContext(`(function (task, target, nativeSessionId) ${functionBody(source, "canAutoResumeLoopPlusMain")})`, sandbox);
  const task = { id: "task", workspaceKey: "workspace" };
  const target = { tabId: "tab-main", cli: "codex", sessionId: "local-session" };
  assert.equal(check(task, target, "thread-1"), true);
  assert.equal(check(task, target, undefined), false);
  assert.equal(check(task, { ...target, sessionId: "another-session" }, "thread-1"), false);
  assert.equal(check(task, target, "old-thread"), false);
  assert.equal(check({ ...task, workspaceKey: "another-workspace" }, target, "thread-1"), false);
  sandbox.role = "subtask";
  assert.equal(check(task, target, "thread-1"), false);
  sandbox.role = "main";
  sandbox.loopTaskId = "other-task";
  assert.equal(check(task, target, "thread-1"), false);
  sandbox.loopTaskId = "task";
  sandbox.tab = null;
  assert.equal(check(task, target, "thread-1"), false);
});

function productionLoopMainEntries() {
  const source = readSource("src", "extension.ts");
  const file = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.Latest, true);
  const coordinator = file.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((declaration) => declaration.name.getText(file) === "loopGroupChatChatPanelCoordinator");
  const initializer = coordinator?.initializer;
  assert.ok(initializer && ts.isCallExpression(initializer));
  const ports = initializer.arguments[0];
  assert.ok(ts.isObjectLiteralExpression(ports));
  const questionPort = ports.properties.find((property) => property.name?.getText(file) === "askMainModel");
  assert.ok(questionPort && ts.isPropertyAssignment(questionPort));
  return ts.transpileModule(`
    async function runPromptWithDepartmentAdmission(input, options = {}) ${functionBody(source, "runPromptWithDepartmentAdmission")}
    async function runPrompt(input, options = {}) ${functionBody(source, "runPrompt")}
    async function runDepartmentLeaderPrompt(input, options) ${functionBody(source, "runDepartmentLeaderPrompt")}
    ({ ask: ${questionPort.initializer.getText(file)}, runPrompt, runDepartmentLeaderPrompt });
  `, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}

for (const department of [undefined, { role: "leader", executionMode: "loop-plus" }] as const) test(`production ask uses Tab occupancy and shared FIFO (${department ? "department Loop+" : "ordinary Loop+"})`, async () => {
  const task = { id: "task", cli: "codex", status: "running", sessionId: "original-session", schedulingMode: "event_driven",
    workspaceKey: "workspace", taskStoreFile: "/fixture/tasks.json", supplementalRequirements: ["待处理补充需求"], department };
  const target = { tabId: "main-tab", cli: task.cli, sessionId: task.sessionId };
  let latestTask = task;
  const events: string[] = [];
  const messages: ChatMessage[] = [];
  let active = false;
  let taskReads = 0;
  let pendingReviewReads = 0;
  let contextTaskId: string | null = null;
  let releaseMain!: () => void;
  let mainGate = new Promise<void>((resolve) => { releaseMain = resolve; });
  const queue = createLoopMainQuestionQueue({ pollIntervalMs: 1 });
  const runtime = vm.runInNewContext(productionLoopMainEntries(), {
    usesDepartmentOwner,
    usesCompletedLoopSubtaskTabCleanup,
    isExtensionDeactivating: false,
    activeWorkspaceKey: task.workspaceKey,
    readLoopTaskRecord: () => { taskReads += 1; return latestTask; },
    resolveLoopMainPromptTarget: () => ({ ...target }),
    resolveConversationTabLoopContext: () => ({ taskRole: "main", loopTaskId: contextTaskId }),
    isTabRunActive: () => active,
    loopMainQuestionQueue: queue,
    promptRunHandoff: new PromptRunHandoff(),
    completedLoopSubtaskTabs: { bindPrompt: () => undefined },
    getLoopPlusOrchestrationHost: () => ({ hasPendingMainWork: () => { pendingReviewReads += 1; return true; } }),
    askLoopMainModelSession,
    getConversationTabById: () => ({ id: target.tabId, cli: target.cli }),
    getConversationTabSessionIdForCli: () => target.sessionId,
    loadSessionMessages: () => messages,
    getActiveConversationTabId: () => target.tabId,
    createPerformanceTrace: () => ({ start: () => () => undefined, measure: (_phase: string, work: () => unknown) => work() }),
    prepareDepartmentInvocation: async (input: unknown) => input,
    runPromptNow: async (input: { displayPrompt: string; loopAsk?: boolean }) => {
      events.push(input.displayPrompt);
      if (input.loopAsk) {
        messages.push({ id: input.displayPrompt, role: "assistant", content: "已回答", createdAt: 1 });
      } else {
        await mainGate;
      }
    },
    t: (key: string, values?: { detail?: string }) => values?.detail ?? key,
  }) as {
    ask: (input: typeof task, question: string, hooks?: { isAborted: () => boolean }) => Promise<Awaited<ReturnType<typeof askLoopMainModelSession>>>;
    runPrompt: (input: { displayPrompt: string; taskRole: string; loopTaskId: string }) => Promise<void>;
  };

  const first = runtime.ask(task, "已有待验收，先提问");
  assert.deepEqual(await first, { status: "ready", answer: "已回答" });
  assert.deepEqual(events, ["已有待验收，先提问"]);
  assert.equal(pendingReviewReads, 0);

  const main = runtime.runPrompt({ displayPrompt: "先入队的验收", taskRole: "main", loopTaskId: task.id });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = runtime.ask(task, "后入队问题");
  assert.deepEqual(events, ["已有待验收，先提问", "先入队的验收"]);
  releaseMain();
  await main;
  assert.equal((await second).status, "ready");
  assert.deepEqual(events, ["已有待验收，先提问", "先入队的验收", "后入队问题"]);

  mainGate = new Promise<void>((resolve) => { releaseMain = resolve; });
  const resumeMain = runtime.runPrompt({ displayPrompt: "原标签合法续跑", taskRole: "main", loopTaskId: task.id });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const resumed = runtime.ask(task, "续跑后排队提问");
  await new Promise<void>((resolve) => setImmediate(resolve));
  target.sessionId = "resumed-session";
  task.sessionId = target.sessionId;
  task.taskStoreFile = "/fixture/resumed-session/tasks.json";
  latestTask = { ...task };
  contextTaskId = task.id;
  releaseMain();
  await resumeMain;
  assert.equal((await resumed).status, "ready");
  assert.deepEqual(events.slice(-2), ["原标签合法续跑", "续跑后排队提问"]);

  target.sessionId = task.sessionId;
  task.sessionId = "original-session";
  task.taskStoreFile = "/fixture/tasks.json";
  latestTask = task;
  contextTaskId = null;
  events.length = 0;
  active = true;
  const wrongSession = runtime.ask(task, "不同会话拒绝");
  await new Promise<void>((resolve) => setImmediate(resolve));
  target.sessionId = "unrelated-session";
  active = false;
  const unrelatedDrain = queue.runMain(target.tabId, async () => undefined);
  await assert.rejects(wrongSession, /loopGroupChatChat\.askUnavailable/u);
  await unrelatedDrain;
  assert.deepEqual(events, []);

  active = true;
  const wrongWorkspace = runtime.ask(task, "异工作区拒绝");
  await new Promise<void>((resolve) => setImmediate(resolve));
  latestTask = { ...task, workspaceKey: "another-workspace" };
  active = false;
  const workspaceDrain = queue.runMain(target.tabId, async () => undefined);
  await assert.rejects(wrongWorkspace, /loopGroupChatChat\.askUnavailable/u);
  await workspaceDrain;
  latestTask = task;

  active = true;
  const readsBefore = taskReads;
  const stale = runtime.ask(task, "过期会话的问题");
  assert.equal(queue.isBusy(target.tabId), true);
  target.sessionId = "replacement-session";
  const drained = queue.runMain(target.tabId, async () => undefined);
  assert.equal(taskReads, readsBefore);
  active = false;
  const tick = setTimeout(() => undefined, 20);
  await assert.rejects(stale, /loopGroupChatChat\.askUnavailable/u);
  clearTimeout(tick);
  await drained;
  assert.equal(events.length, 0);
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

for (const cli of ["codex", "opencode"] as const) {
  test(`production ${cli} leader and ask share FIFO through preparation and consumer cleanup`, async () => {
    const task = { id: "leader", status: "running", cli, workspaceKey: "fixture", taskStoreFile: "/fixture/tasks.json",
      sessionId: "local_leader-session", executionSession: { cli, sessionId: "native-leader", configId: null },
      department: { role: "leader", routes: { leader: { cli, model: "fixture-model" } } } };
    const tab = { id: "leader-tab" };
    const target = { tabId: tab.id, cli, sessionId: task.sessionId };
    const scope = { rootTaskId: "director", workspace: task.workspaceKey, leaderTaskId: task.id, moduleId: "module", generation: 1 };
    const events: string[] = [];
    const messages: ChatMessage[] = [];
    const interactiveRunsByTabId = new Map<string, { runId: string; stop: () => void }>();
    const parallelRunsByTabId = new Map<string, { runId: string; stop: () => void }>();
    const runs = cli === "codex" ? interactiveRunsByTabId : parallelRunsByTabId;
    const prep = gate(), consumer = gate();
    let answerGate = gate();
    let invocationId = 0;
    const native = async (taskId: string, _id: string, prompt: string) => {
      assert.equal(taskId, task.id);
      events.push(`owner:${prompt}`);
    };
    const consume = async (input: PromptRunInput, runOptions: { registerQuestionRun?: (id: string) => void }) => {
      if (!input.loopAsk) return consumer.promise;
      const questionGate = answerGate;
      runs.set(tab.id, { runId: input.displayPrompt, stop: () => { events.push(`stop:${input.displayPrompt}`); questionGate.release(); } });
      runOptions.registerQuestionRun?.(input.displayPrompt);
      await questionGate.promise;
      runs.delete(tab.id);
      messages.push({ id: input.displayPrompt, role: "assistant", content: "已回答", createdAt: 1 });
    };
    const runtime = vm.runInNewContext(productionLoopMainEntries(), {
      usesDepartmentOwner,
      AbortController,
      isExtensionDeactivating: false,
      activeWorkspaceKey: task.workspaceKey,
      readLoopTaskRecord: () => task,
      resolvePromptRunTarget: () => ({ ...target }),
      resolveLoopMainPromptTarget: () => ({ ...target }),
      resolveConversationTabLoopContext: () => ({ taskRole: "main", loopTaskId: task.id }),
      getConversationTabById: () => tab,
      getConversationTabSessionIdForCli: () => target.sessionId,
      getActiveConversationTabId: () => tab.id,
      createMessageId: () => `question-${++invocationId}`,
      loadSessionMessages: () => messages,
      isTabRunActive: () => runs.has(tab.id),
      loopMainQuestionQueue: createLoopMainQuestionQueue({ pollIntervalMs: 1 }),
      promptRunHandoff: new PromptRunHandoff(),
      askLoopMainModelSession,
      usesDepartmentInteractiveRuntime: () => false,
      leaderExecutionScopeKey,
      getDepartmentExecutionProducer: () => ({ scope: () => ({ ...scope }), track: async (_taskId: string, work: () => Promise<void>) => work() }),
      configApplyQueue: { waitForIdle: async () => { events.push("prepare"); await prep.promise; return true; } },
      prepareDepartmentInvocation: async (input: PromptRunInput) => ({ ...input, model: "fixture-model", thinkingModeOverride: "off" }),
      normalizeThinkingWorkspaceFiles: () => [],
      getThinkingWorkspaceFiles: () => [],
      getCliCommand: () => cli,
      getMacTaskShell: () => "bash",
      resolveWorkspaceCwd: () => "/fixture",
      buildDepartmentProcessArgs: () => [],
      splitConfiguredCliCommand: () => [cli],
      DEPARTMENT_CONFIG_PATHS: { [cli]: { config: "/fixture/config" } },
      getDepartmentExecutionResources: () => ({ beginConsumer: () => ({ target, finish: () => events.push("cleanup") }) }),
      runPromptInteractive: async (input: PromptRunInput, _target: unknown, options: {
        departmentCodexRun: (prompt: string, handlers: object) => Promise<void>; registerQuestionRun?: (id: string) => void;
      }) => {
        await options.departmentCodexRun(input.modelPrompt, {});
        await consume(input, options);
      },
      runPromptParallel: async (input: PromptRunInput, _target: unknown, options: {
        departmentProcessStream: (cli: string, prompt: string, handlers: object, settings: object) => unknown;
        registerQuestionRun?: (id: string) => void;
      }) => {
        await options.departmentProcessStream(cli, input.modelPrompt, {}, { model: "fixture-model", openCodeConfigContent: "{}", environment: {} });
        await consume(input, options);
      },
      createDepartmentLeaderNativeSessionValidator: () => undefined,
      getDepartmentLeaderProductionHost: () => ({ run: native, runOpenCode: native }),
      path,
      process: { env: {} },
      interactiveRunsByTabId,
      parallelRunsByTabId,
      stopParallelRunForTab: (tabId: string) => parallelRunsByTabId.get(tabId)?.stop(),
      getPrimaryRunTabId: () => null,
      runPromptNow: async () => assert.fail("department asks must not use ordinary prompt execution"),
      t: (key: string, values?: { question?: string }) => values?.question ?? key,
    }) as {
      ask: (record: typeof task, question: string, hooks?: { signal?: AbortSignal }) => ReturnType<typeof askLoopMainModelSession>;
      runDepartmentLeaderPrompt: (input: PromptRunInput, options: { targetTabId: string; invocationId: string; signal?: AbortSignal; isAborted: () => boolean }) => Promise<void>;
    };
    const startLeader = (signal?: AbortSignal) => runtime.runDepartmentLeaderPrompt({ displayPrompt: "leader", modelPrompt: "leader",
      contextTags: [], taskRole: "main", loopTaskId: task.id },
      { targetTabId: tab.id, invocationId: "invocation", signal, isAborted: () => false });
    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

    const leader = startLeader();
    const cancelledQuestion = new AbortController();
    const cancelled = runtime.ask(task, "cancelled", { signal: cancelledQuestion.signal });
    const queuedQuestion = runtime.ask(task, "after leader");
    assert.deepEqual(events, ["prepare"]);
    cancelledQuestion.abort();
    assert.equal((await cancelled).status, "stopped");
    prep.release();
    await tick();
    assert.deepEqual(events, ["prepare", "owner:leader"]);
    consumer.release();
    await leader;
    await tick();
    assert.deepEqual(events, ["prepare", "owner:leader", "cleanup", "prepare", "owner:after leader"]);
    answerGate.release();
    assert.equal((await queuedQuestion).status, "ready");
    await tick();

    events.length = 0;
    answerGate = gate();
    const questionAbort = new AbortController();
    const first = runtime.ask(task, "before leader", { signal: questionAbort.signal });
    await tick();
    const queuedAbort = new AbortController();
    const cancelledLeader = startLeader(queuedAbort.signal);
    const laterLeader = startLeader();
    assert.deepEqual(events, ["prepare", "owner:before leader"]);
    queuedAbort.abort();
    await cancelledLeader;
    assert.deepEqual(events, ["prepare", "owner:before leader"]);
    questionAbort.abort();
    assert.equal((await first).status, "stopped");
    await laterLeader;
    assert.deepEqual(events, ["prepare", "owner:before leader", "stop:before leader", "cleanup", "prepare", "owner:leader", "cleanup"]);

    events.length = 0;
    answerGate = gate();
    const staleAbort = new AbortController();
    const active = runtime.ask(task, "original question", { signal: staleAbort.signal });
    await tick();
    const staleLeader = startLeader();
    target.sessionId = "replacement-session";
    runs.set(tab.id, { runId: "replacement", stop: () => events.push("unexpected stop") });
    staleAbort.abort();
    assert.deepEqual(events, ["prepare", "owner:original question"]);
    answerGate.release();
    assert.equal((await active).status, "stopped");
    await assert.rejects(staleLeader, /会话已变化/u);
    assert.deepEqual(events, ["prepare", "owner:original question", "cleanup"]);

    target.sessionId = task.sessionId;
    answerGate = gate();
    const beforeReplacement = runtime.ask(task, "before generation change");
    await tick();
    const staleGeneration = startLeader();
    scope.generation += 1;
    answerGate.release();
    await beforeReplacement;
    await assert.rejects(staleGeneration, /归属或会话已变化/u);
    assert.deepEqual(events, ["prepare", "owner:original question", "cleanup", "prepare", "owner:before generation change", "cleanup"]);
    const eventCount = events.length;
    task.status = "stopped";
    assert.equal((await runtime.ask(task, "stopped leader")).status, "error");
    assert.equal(events.length, eventCount);
  });
}

test("calls Loop+ before classic initialization and the round loop", () => {
  const extensionSource = readSource("src", "extension.ts");
  const orchestration = functionBody(extensionSource, "runLoopPromptOrchestration");
  const call = orchestration.indexOf("await runEventDrivenLoopPrompt(");
  const classicInit = orchestration.indexOf("createLoopTaskRecord(");
  const roundLoop = orchestration.indexOf("while (true)");
  assert.equal(call >= 0, true);
  assert.equal(classicInit >= 0, true);
  assert.equal(roundLoop >= 0, true);
  assert.equal(call < classicInit, true);
  assert.equal(call < roundLoop, true);
  const openedGroupChat = orchestration.indexOf("void openLoopGroupChatPanel(task.id)");
  assert.equal(openedGroupChat > classicInit, true);
  assert.equal(openedGroupChat < roundLoop, true);
  assert.doesNotMatch(orchestration, /\.maxRounds\b/);
  assert.equal(orchestration.slice(call, classicInit).includes("return;"), true);

  const stopTab = functionBody(extensionSource, "stopRunForTab");
  const closeGate = stopTab.indexOf("shouldCloseLoopPlusParentGateBeforeAbort(");
  const stopRunner = stopTab.indexOf("stopLoopPlusInvocationRunner(");
  assert.equal(closeGate >= 0, true);
  assert.equal(stopRunner >= 0, true);
  assert.equal(closeGate < stopRunner, true);
  const runner = functionBody(extensionSource, "stopLoopPlusInvocationRunner");
  assert.equal(runner.includes("interactiveRun.stop()"), true);
  assert.equal(runner.includes("stopParallelRunForTab("), true);
  assert.equal(runner.includes("stopActiveRun()"), true);
  const cancel = functionBody(extensionSource, "cancelLoopPlusInvocation");
  assert.equal(cancel.includes("stopLoopPlusParent("), false);
  assert.equal(cancel.includes("markLoopTaskStoppedByUser("), false);
  const preempt = functionBody(extensionSource, "preemptActivePromptRun");
  assert.equal(preempt.includes("cancelLoopPlusInvocation("), true);
  assert.equal(preempt.indexOf("cancelLoopPlusInvocation(") < preempt.indexOf("stopRunForTab("), true);
  const promptEntry = functionBody(extensionSource, "runPromptWithDepartmentAdmission");
  assert.equal(promptEntry.includes("loopMainQuestionQueue.runMain("), true);
  const promptRun = functionBody(extensionSource, "runPromptNow");
  assert.equal(promptRun.includes("preemptActivePromptRun("), true);
  assert.equal(promptRun.includes("stopRunForTab("), false);

  const adapterSource = readSource("src", "extensionHost", "loopPlusRuntimeAdapter.ts");
  assert.equal(adapterSource.includes("export function createLoopPlusRuntimeAdapter("), true);
  const tried = adapterSource.indexOf("result = host().tryRun(");
  const revealed = adapterSource.indexOf("revealStandaloneGroupChat(result.taskId)", tried);
  const awaited = adapterSource.indexOf("await lifecycle", revealed);
  assert.equal(tried >= 0 && revealed > tried && awaited > revealed, true);
  assert.equal(adapterSource.includes("withLoopPlusExecutionRoot("), true);
  assert.equal(adapterSource.includes("resolveLoopPlusAttemptOutcome("), true);
  assert.equal(adapterSource.includes("selectLoopPlusInvocationRun("), true);
  assert.equal(adapterSource.includes("deps.cancelInvocation("), true);
  assert.equal(adapterSource.includes("stopRunForTab"), false);

  const wiring = functionBody(extensionSource, "getLoopPlusRuntimeAdapter");
  assert.equal(wiring.includes("createLoopPlusRuntimeAdapter("), true);
  assert.equal(wiring.includes("runPrompt: (input, options) => runPrompt(input, options)"), true);
  assert.equal(wiring.includes("persistLoopPlusTaskUpdate(taskId, patch)"), true);
  assert.equal(wiring.includes("updateLoopTaskRecord(taskId, patch),"), false);
  assert.equal(wiring.includes("appendCompletionMessages: (target, task) => {"), true);
  assert.equal(wiring.includes("appendLoopAnswerConclusionMessage(target, task);"), true);
  assert.equal(wiring.includes("appendLoopFinalSummaryMessage(target, task);"), true);
  assert.equal(wiring.includes("cancelInvocation: (tabId) => {"), true);
  assert.equal(wiring.includes("cancelLoopPlusInvocation(tabId)"), true);
  assert.equal(wiring.includes("closeSubtaskTab: (tabId) => closeLoopSubtaskTabAndRefreshPanel(tabId)"), true);
  assert.equal(wiring.includes("closeSubtaskTabs: (taskId, subtaskId, attemptId) => closeLoopSubtaskTabs(taskId, subtaskId, undefined, attemptId)"), true);
  assert.equal(wiring.includes("stopRunForTab"), false);
  const eventDriven = functionBody(extensionSource, "runEventDrivenLoopPrompt");
  assert.equal(eventDriven.includes("getLoopPlusRuntimeAdapter().runEventDriven("), true);
  const orchestrationHost = functionBody(extensionSource, "getLoopPlusOrchestrationHost");
  assert.equal(orchestrationHost.includes("getLoopPlusRuntimeAdapter().host()"), true);
  const continuation = functionBody(extensionSource, "handleLoopPlusSubtaskContinuation");
  assert.equal(continuation.includes("selectLoopPlusContinuationDetail("), true);
  assert.equal(continuation.includes("getLastLoopAssistantContent("), false);
  const notifyCall = extensionSource.indexOf("host.notifySubtaskContinuation(context.taskId, context.subtaskId, \"completed\", summary,");
  const completionCallback = extensionSource.indexOf("undefined, () => closeLoopPlusSubtaskTab(tabId,", notifyCall);
  const attemptArgument = extensionSource.indexOf("}, closeTab), context.attemptId);", completionCallback);
  assert.equal(notifyCall >= 0, true);
  assert.equal(completionCallback > notifyCall, true);
  assert.equal(attemptArgument > completionCallback, true);
  assert.equal(continuation.includes("closeLoopPlusSubtaskTab(tabId,"), true);
  assert.equal(
    continuation.indexOf("selectLoopPlusContinuationDetail(") < continuation.indexOf("closeLoopPlusSubtaskTab(tabId,"),
    true,
  );
  assert.equal(
    continuation.indexOf("notifySubtaskContinuation(") < continuation.indexOf("closeLoopPlusSubtaskTab(tabId,"),
    true,
  );
  assert.equal(
    continuation.indexOf("() => closeLoopPlusSubtaskTab(tabId,") > continuation.indexOf("notifySubtaskContinuation("),
    true,
  );
});

test("classic Loop root creation uses the awaited host authority boundary", () => {
  const extensionSource = readSource("src", "extension.ts");
  const orchestration = functionBody(extensionSource, "runLoopPromptOrchestration");
  assert.equal(orchestration.includes("resolveLoopTaskAtCreationBoundary<LoopTaskRecord>("), true);
  assert.equal(orchestration.includes("configApplyQueue.waitForIdle(target.cli)"), true);
  assert.equal(orchestration.includes("readTask: (taskId) => readLoopTaskRecord(taskId)"), true);
  assert.equal(orchestration.includes("readToolSettings(),"), true);
  assert.equal(orchestration.includes("createTask: () => {"), true);
});

test("maps only loop_plus to event_driven and resumes from the saved mode", () => {
  assert.equal(schedulingModeForInteractiveMode("loop_plus"), "event_driven");
  assert.equal(schedulingModeForInteractiveMode("loop"), undefined);
  assert.equal(schedulingModeForInteractiveMode("graph"), undefined);
  assert.equal(resolveLoopPlusEntry({ schedulingMode: "event_driven" }, undefined), "event_driven");
  assert.equal(resolveLoopPlusEntry({ schedulingMode: "classic" }, "event_driven"), "classic");
  assert.equal(resolveLoopPlusAttemptOutcome({
    aborted: false,
    thrown: false,
    runStatus: "stopped",
    hasFinalResponse: false,
  }), "stopped");
  assert.equal(shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: "event_driven",
    taskRole: "subtask",
    gateAlreadyClosing: false,
  }), false);
  assert.equal(shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: "event_driven",
    taskRole: "main",
    gateAlreadyClosing: false,
  }), true);
});
