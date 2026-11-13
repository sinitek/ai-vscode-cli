import * as assert from "node:assert/strict";
import * as vm from "node:vm";
import { isHiddenLoopPlusProtocolPrompt } from "../../loopPlusProtocolPrompt";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";

function functionSource(source: string, name: string): string {
  const start = source.indexOf(`      function ${name}(`);
  const end = source.indexOf("\n      function ", start + 1);
  assert.ok(start >= 0 && end > start, `Missing function ${name}`);
  return source.slice(start, end);
}

function element() {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  return {
    disabled: false, style: { display: "" }, textContent: "", classes, attributes,
    classList: { toggle: (name: string, enabled: boolean) => { if (enabled) classes.add(name); else classes.delete(name); } },
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
    querySelector: () => null,
  };
}

/** Runs production dispatch, status, error classification and activity logic; DOM/timers stay inert. */
export function createRunStatusHarness() {
  let listener: ((event: { data: Record<string, unknown> }) => void) | undefined;
  let activeTabId = "active";
  const erroredTabIds = new Set<string>();
  const renderedMessages: unknown[] = [];
  const renderedTraces: unknown[] = [];
  const noop = () => {};
  const elements = {
    sendPrompt: element(), promptInput: element(), newSession: element(), stopRun: element(),
    thinkingMode: element(), historyButton: element(), runWait: element(), runWaitTime: element(), runStatusText: element(),
  };
  const sandbox = {
    ...Object.fromEntries([
      "resetRunRawStream", "updateCurrentRunPrompt", "resetTaskListForRunStart", "closeTaskListForRunCompletion",
      "flushPendingPromptQueue", "syncConversationControlsForActiveTab",
      "updateAppHeight", "scheduleAppHeightUpdate", "renderConversationTabs", "updateRunPromptButton",
      "syncRunPromptOverlay", "pruneRenderedConversationViews", "syncActiveMessagesFromRuntime", "resetTaskListState",
      "setMessagesForTab",
      "syncResetSessionAvailability", "syncLongTermMemoryWorkspaceControl", "syncCodeGraphWorkspaceControl",
      "syncInteractiveOptions", "stopRunWaitTimer", "closeRunPromptOverlay", "closeRunStreamOverlay",
      "updateRunWaitTime", "updateRunStreamButton",
      "syncConversationTabRunningFlowWatch",
    ].map((name) => [name, noop])),
    state: { isRunning: false, conversationTabs: { activeTabId: "active" } }, elements, runWaitStartAt: 0,
    startRunWaitTimer: (startedAt: number) => { sandbox.runWaitStartAt = startedAt; },
    appendMessage: (message: unknown) => { renderedMessages.push(message); },
    applyTraceSegment: (segment: unknown) => { renderedTraces.push(segment); },
    window: {
      addEventListener(type: string, handler: typeof listener) {
        if (type === "message") { listener = handler; }
      },
    },
    vscode: { postMessage: noop },
    conversationRuntimeByTabId: Object.create(null),
    hydrationMessages: [] as Array<{ role: string; content: string }>,
    isHiddenLoopPlusProtocolPrompt,
    TAB_RUNTIME_DEFAULT_KEY: "default",
    erroredTabIds,
    loopMetaByTabId: Object.create(null),
    runningTabStartedAtById: Object.create(null),
    runningFlowStoppedTabIds: new Set<string>(),
    assistantRedirects: Object.create(null),
    getActiveConversationTabId: () => activeTabId,
    getConversationTabSummary: (tabId: string) => ({ id: tabId }),
    updateLoopMetaForTabFromMessage: () => false,
    t: (key: string) => key,
    reportWebviewFailure: (_label: string, error: unknown) => { throw error; },
  };
  const context = vm.createContext(sandbox);
  for (const [source, names] of [
    [VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, [
      "createTaskListState", "createConversationRuntimeState", "resolveConversationRuntimeKey", "getConversationRuntimeState",
      "pruneConversationRuntimeStates", "resetConversationRuntimeState", "normalizeRunActivity", "isRunStatusSummaryText",
      "getActiveConversationRuntimeState", "ensureRuntimeStateMessages", "ensureRuntimeTaskList", "isRuntimeStateForActiveTab",
      "deriveLatestRunPromptFromMessages", "deriveLatestRunStatusMessageFromMessages", "hydrateRunArtifactsFromMessages",
    ]],
    [VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, [
      "isErrorMessage", "syncTabErrorFromMessage", "isTabRunning", "isConversationTabRunning", "setTabErrored", "isTabErrored",
      "isHiddenRetryQueuedMessage", "isHiddenRetryStartedMessage", "getTabRunStartedAt", "shouldHandleTabScopedEvent",
      "normalizeLoopTaskRole", "normalizeLoopTaskId", "getLoopMetaForTabSummary", "isLoopMainTab",
      "startConversationTabRunningFlow", "syncRunningStateForActiveTab",
    ]],
    [VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, ["updateRunningState", "updateRunWait"]],
    [VIEW_CONTENT_SCRIPT_TRACE_RENDERING, [
      "getTracePresentation", "getTraceTypeDefinition", "expandFileChangeTraceContent", "stripLeadingEmptyLines",
    ]],
  ] as const) {
    for (const name of names) vm.runInContext(functionSource(source, name), context);
  }
  vm.runInContext(VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH, context);
  const send = (data: Record<string, unknown>) => {
    assert.ok(listener);
    listener({ data });
  };
  const run = (tabId: string, status: string, activity?: "contextCompaction") => send({ type: "runStatus", tabId, status, activity });
  const message = (tabId: string, type = "appendMessage", role = "trace", content = "error: 可恢复工具错误") => {
    send({ type, tabId, message: { id: "message", role, content } });
  };
  const tabState = (tabId: string): { running: boolean; errored: boolean; activity: string; lastRunStatus: string } => {
    context.inspectTabId = tabId;
    return JSON.parse(vm.runInContext(`JSON.stringify({
      running: isConversationTabRunning(getConversationTabSummary(inspectTabId)),
      errored: isTabErrored(inspectTabId),
      activity: getConversationRuntimeState(inspectTabId).activeRunActivity,
      lastRunStatus: getConversationRuntimeState(inspectTabId).lastRunStatus,
    })`, context));
  };
  return {
    context, erroredTabIds, send, run, message, tabState, elements, renderedMessages, renderedTraces,
    runtime: (tabId: string) => sandbox.conversationRuntimeByTabId[tabId] as {
      activeRunActivity: string; lastRunStatus: string; tokensInContextWindow: number | null; modelContextWindow: number | null;
      lastRunStatusMessage: string;
    },
    hydrate: (tabId: string, messages: Array<{ role: string; content: string }>) => {
      sandbox.hydrationMessages = messages;
      vm.runInContext(`getConversationRuntimeState(${JSON.stringify(tabId)}); hydrateRunArtifactsFromMessages(${JSON.stringify(tabId)}, hydrationMessages)`, context);
    },
    activate: (tabId: string) => {
      activeTabId = tabId;
      sandbox.state.conversationTabs.activeTabId = tabId;
      vm.runInContext("updateRunningState(isTabRunning(getActiveConversationTabId()), { preserveRunArtifacts: true })", context);
    },
    reset: (tabId: string) => vm.runInContext(`resetConversationRuntimeState(${JSON.stringify(tabId)})`, context),
    prune: (tabIds: string[]) => vm.runInContext(`pruneConversationRuntimeStates(${JSON.stringify(tabIds)})`, context),
  };
}
