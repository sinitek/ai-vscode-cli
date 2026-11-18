import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import * as ts from "typescript";
import { installVscodeMock } from "../vscodeMock";

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
  const revealed = adapterSource.indexOf("deps.revealClarification?.(result.taskId)", tried);
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
