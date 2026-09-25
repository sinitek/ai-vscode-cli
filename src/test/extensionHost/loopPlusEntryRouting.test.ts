import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
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
  const asyncStart = source.indexOf(`async function ${name}`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}`);
  assert.equal(start >= 0, true, name);
  const parenAt = source.indexOf("(", start);
  let cursor = parenAt;
  let depthParen = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let paramsClosedAt = -1;
  while (cursor < source.length) {
    const char = source[cursor];
    const previous = source[cursor - 1];
    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      cursor += 1;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      cursor += 1;
      continue;
    }
    if (char === "(") {
      depthParen += 1;
    } else if (char === ")") {
      depthParen -= 1;
      if (depthParen === 0) {
        paramsClosedAt = cursor;
        break;
      }
    }
    cursor += 1;
  }
  assert.equal(paramsClosedAt >= 0, true, name);
  cursor = paramsClosedAt + 1;
  depthParen = 0;
  let depthBrace = 0;
  let depthAngle = 0;
  quote = null;
  let bodyOpen = -1;
  while (cursor < source.length) {
    const char = source[cursor];
    const previous = source[cursor - 1];
    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      cursor += 1;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      cursor += 1;
      continue;
    }
    if (char === "<") {
      depthAngle += 1;
    } else if (char === ">" && depthAngle > 0) {
      depthAngle -= 1;
    } else if (char === "(") {
      depthParen += 1;
    } else if (char === ")") {
      depthParen -= 1;
    } else if (char === "{") {
      if (depthParen === 0 && depthBrace === 0 && depthAngle === 0) {
        const groupEnd = matchingBrace(source, cursor);
        let next = groupEnd + 1;
        while (next < source.length && /\s/.test(source[next])) {
          next += 1;
        }
        if (source[next] === "{") {
          cursor = next;
          continue;
        }
        bodyOpen = cursor;
        break;
      }
      depthBrace += 1;
    } else if (char === "}") {
      depthBrace -= 1;
    }
    cursor += 1;
  }
  assert.equal(bodyOpen >= 0, true, name);
  return source.slice(bodyOpen, matchingBrace(source, bodyOpen) + 1);
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("Unclosed brace");
}

test("calls Loop+ before classic initialization and the round loop", () => {
  const extensionSource = readSource("src", "extension.ts");
  const orchestration = functionBody(extensionSource, "runLoopPromptOrchestration");
  const call = orchestration.indexOf("await runEventDrivenLoopPrompt(");
  const classicInit = orchestration.indexOf("createLoopTaskRecord(");
  const roundLoop = orchestration.indexOf("while (round <= task.maxRounds)");
  assert.equal(call >= 0, true);
  assert.equal(classicInit >= 0, true);
  assert.equal(roundLoop >= 0, true);
  assert.equal(call < classicInit, true);
  assert.equal(call < roundLoop, true);
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
  assert.equal(cancel.includes("includeGraph: false"), true);
  assert.equal(cancel.includes("stopLoopPlusParent("), false);
  assert.equal(cancel.includes("markLoopTaskStoppedByUser("), false);
  assert.equal(cancel.includes("stopGraphRunForConversationTab("), false);
  const preempt = functionBody(extensionSource, "preemptActivePromptRun");
  assert.equal(preempt.includes("cancelLoopPlusInvocation("), true);
  assert.equal(preempt.indexOf("cancelLoopPlusInvocation(") < preempt.indexOf("stopRunForTab("), true);
  const promptRun = functionBody(extensionSource, "runPrompt");
  assert.equal(promptRun.includes("preemptActivePromptRun("), true);
  assert.equal(promptRun.includes("stopRunForTab("), false);

  const adapterSource = readSource("src", "extensionHost", "loopPlusRuntimeAdapter.ts");
  assert.equal(adapterSource.includes("export function createLoopPlusRuntimeAdapter("), true);
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
  assert.equal(wiring.includes("cancelInvocation: (tabId) => {"), true);
  assert.equal(wiring.includes("cancelLoopPlusInvocation(tabId)"), true);
  assert.equal(wiring.includes("stopRunForTab"), false);
  const eventDriven = functionBody(extensionSource, "runEventDrivenLoopPrompt");
  assert.equal(eventDriven.includes("getLoopPlusRuntimeAdapter().runEventDriven("), true);
  const orchestrationHost = functionBody(extensionSource, "getLoopPlusOrchestrationHost");
  assert.equal(orchestrationHost.includes("getLoopPlusRuntimeAdapter().host()"), true);
  const continuation = functionBody(extensionSource, "handleLoopPlusSubtaskContinuation");
  assert.equal(continuation.includes("selectLoopPlusContinuationDetail("), true);
  assert.equal(continuation.includes("getLastLoopAssistantContent("), false);
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
