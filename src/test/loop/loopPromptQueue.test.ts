import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");

import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "../../webview/viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in webview script`);
  const paramsStart = script.indexOf("(", start);
  assert.notEqual(paramsStart, -1, `${name} should have parameters`);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < script.length; index += 1) {
    if (script[index] === "(") {
      paramsDepth += 1;
    } else if (script[index] === ")") {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }
  assert.notEqual(paramsEnd, -1, `${name} parameters should terminate`);
  const bodyStart = script.indexOf("{", paramsEnd);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === "{") {
      depth += 1;
    } else if (script[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }
  throw new Error(`${name} body was not terminated`);
}

function createSendPromptHarness(options: {
  loopMainRunning?: boolean;
  tabBusy?: boolean;
  requiresAcceptancePlan?: boolean;
}) {
  const sources = ["clearPromptInputAfterSend", "dispatchPromptPayload", "sendPrompt"]
    .map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, name))
    .join("\n");
  const elements = { promptInput: { value: " next task " } };
  const queued: unknown[] = [];
  const conflicts: unknown[] = [];
  const dispatched: unknown[] = [];
  const opened: unknown[] = [];
  let resetCount = 0;
  const api = new Function(
    "elements",
    "buildPromptPayload",
    "getActiveConversationTabId",
    "isLoopMainConversationTabRunning",
    "queuePromptForLater",
    "resetPromptContextForNextPrompt",
    "isConversationTabBusy",
    "openRunConflictOverlay",
    "dispatchPrompt",
    "isAcceptancePlanRequiredForPayload",
    "openAcceptancePlanDialog",
    "showToast",
    "t",
    `function isCreatingConversationTab() { return false; }\n${sources}; return { sendPrompt: sendPrompt };`,
  )(
    elements,
    (prompt: string) => ({ prompt }),
    () => "tab-1",
    () => options.loopMainRunning === true,
    (payload: unknown) => queued.push(payload),
    () => { resetCount += 1; },
    () => options.tabBusy === true,
    (payload: unknown) => conflicts.push(payload),
    (payload: unknown) => {
      dispatched.push(payload);
      return true;
    },
    () => options.requiresAcceptancePlan === true,
    (payload: unknown) => opened.push(payload),
    () => undefined,
    (key: string) => key,
  ) as { sendPrompt: () => void };
  return {
    sendPrompt: api.sendPrompt,
    elements,
    queued,
    conflicts,
    dispatched,
    opened,
    getResetCount: () => resetCount,
  };
}

test("rejects a new prompt while the Loop main tab is still running and preserves input", () => {
  const harness = createSendPromptHarness({ loopMainRunning: true, tabBusy: true });

  harness.sendPrompt();

  assert.deepEqual(harness.queued, []);
  assert.equal(harness.conflicts.length, 0);
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.elements.promptInput.value, " next task ");
  assert.equal(harness.getResetCount(), 0);
});

test("keeps the existing conflict prompt for a busy non-Loop tab", () => {
  const harness = createSendPromptHarness({ tabBusy: true });

  harness.sendPrompt();

  assert.equal(harness.queued.length, 0);
  assert.deepEqual(harness.conflicts, [{ prompt: "next task" }]);
  assert.equal(harness.dispatched.length, 0);
  assert.equal(harness.elements.promptInput.value, " next task ");
});

test("dispatches directly when the active tab is idle", () => {
  const harness = createSendPromptHarness({});

  harness.sendPrompt();

  assert.equal(harness.queued.length, 0);
  assert.equal(harness.conflicts.length, 0);
  assert.deepEqual(harness.dispatched, [{ prompt: "next task" }]);
  assert.equal(harness.elements.promptInput.value, "");
  assert.equal(harness.getResetCount(), 1);
});

test("does not flush a queued prompt while the target tab is still busy", () => {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "flushPendingPromptQueue");
  const flushPendingPromptQueue = new Function(
    "getActiveConversationTabId",
    "isConversationTabBusy",
    `${functionSource}; return flushPendingPromptQueue;`,
  )(
    () => "tab-1",
    () => true,
  ) as (tabId?: string) => boolean;

  assert.equal(flushPendingPromptQueue("tab-1"), false);
});

test("forwards queued prompt history skip flag when dispatching", () => {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "dispatchPrompt");
  const configApplyHelperSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI,
    "isConfigApplyPendingForCli",
  );
  const posted: unknown[] = [];
  const runtimeState = { promptSubmission: null as { requestId: string; prompt: string } | null };
  const dispatchPrompt = new Function(
    "normalizePromptPayloadWithModelFields",
    "getActiveConversationTabId",
    "getConversationTabSummary",
    "state",
    "resolveDispatchInteractiveMode",
    "applyCodexLoopRoleModelsToPromptPayload",
    "getConversationRuntimeState",
    "isTabRunning",
    "appendMessage",
    "createMessageId",
    "t",
    "resetTaskListForRunStart",
    "cliSupportsModelSelection",
    "vscode",
    "isRuntimeStateForActiveTab",
    "syncPromptSubmissionWait",
    "stickChatToBottom",
    `function isCreatingConversationTab() { return false; }\n${configApplyHelperSource}\n${functionSource}; return dispatchPrompt;`,
  )(
    (payload: Record<string, unknown>) => payload && typeof payload.prompt === "string"
      ? {
          prompt: payload.prompt,
          contextOptions: payload.contextOptions || {},
          skipPromptHistory: payload.skipPromptHistory === true,
        }
      : null,
    () => "tab-loop",
    () => ({ cli: "opencode" }),
    {
      currentCli: "opencode",
      selectedConfigId: "config-opencode",
      configState: { activeConfigId: "config-opencode", revision: "visible-revision" },
      selectedModelsByCli: {},
    },
    (mode: unknown) => mode || "coding",
    (payload: unknown) => payload,
    () => runtimeState,
    () => false,
    () => undefined,
    () => "message-1",
    (key: string) => key,
    () => undefined,
    () => false,
    { postMessage: (message: unknown) => posted.push(message) },
    () => true,
    () => undefined,
    () => undefined,
  ) as (payload: unknown) => boolean;

  assert.equal(dispatchPrompt({ prompt: "queued task", contextOptions: {}, skipPromptHistory: true }), true);
  assert.deepEqual(posted, [{
    type: "sendPrompt",
    prompt: "queued task",
    interactiveMode: "coding",
    contextOptions: {},
    tabId: "tab-loop",
    cli: "opencode",
    model: undefined,
    preserveActiveTab: false,
    skipPromptHistory: true,
    requestId: "message-1",
  }]);
  assert.equal(runtimeState.promptSubmission?.requestId, "message-1");
  assert.equal(runtimeState.promptSubmission?.prompt, "queued task");
});

test("prevents the conflict overlay from bypassing a running Loop main tab", () => {
  assert.match(
    VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS,
    /isLoopMainConversationTabRunning\(getActiveConversationTabId\(\)\)[\s\S]*toastLoopMainBusy[\s\S]*return false;[\s\S]*dispatchPrompt\(promptPayload, \{ pauseBeforeSend: true \}\)/,
  );
});

test("auto-continues only a Loop queue that transitions from running to completed", () => {
  const functionSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE,
    "getNewlyCompletedLoopTabIds",
  );
  const getNewlyCompletedLoopTabIds = new Function(
    `${functionSource}; return getNewlyCompletedLoopTabIds;`,
  )() as (
    previous: { tabs: Array<Record<string, unknown>> },
    next: { tabs: Array<Record<string, unknown>> },
  ) => string[];
  const previous = {
    tabs: [
      { id: "completed-task", loopTaskStatus: "running", loopTaskRunning: true },
      { id: "failed-task", loopTaskStatus: "running", loopTaskRunning: true },
      { id: "already-completed", loopTaskStatus: "completed" },
    ],
  };
  const next = {
    tabs: [
      { id: "completed-task", loopTaskStatus: "completed", loopTaskRunning: false },
      { id: "failed-task", loopTaskStatus: "error", loopTaskRunning: false },
      { id: "already-completed", loopTaskStatus: "completed", loopTaskRunning: false },
    ],
  };

  assert.deepEqual(getNewlyCompletedLoopTabIds(previous, next), ["completed-task"]);
  assert.match(
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, "applyState"),
    /newlyCompletedLoopTabIds\.forEach[\s\S]*flushPendingPromptQueue\(tabId\)/,
  );
});

test("refreshes the panel task status whenever Loop orchestration exits", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const wrapperStart = extensionSource.indexOf("async function runLoopPrompt(");
  const orchestrationStart = extensionSource.indexOf("async function runLoopPromptOrchestration(");
  assert.ok(wrapperStart >= 0);
  assert.ok(orchestrationStart > wrapperStart);
  const functionSource = extensionSource.slice(wrapperStart, orchestrationStart);

  assert.match(
    functionSource,
    /try\s*{[\s\S]*runLoopPromptOrchestration\(input,\s*options,\s*\(taskId,\s*target\)\s*=>/,
  );
  assert.match(functionSource, /finally\s*{[\s\S]*await postPanelState\(\)/);
});
