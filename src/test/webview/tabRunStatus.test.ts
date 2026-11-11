import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";

function functionSource(source: string, name: string): string {
  const start = source.indexOf(`      function ${name}(`);
  const end = source.indexOf("\n      function ", start + 1);
  assert.ok(start >= 0 && end > start, `Missing function ${name}`);
  return source.slice(start, end);
}

function createErrorSync() {
  const source = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING;
  const start = source.indexOf("      function syncTabErrorFromMessage(");
  const end = source.indexOf("\n      function ", start + 1);
  assert.ok(start >= 0 && end > start);
  const tabs = new Map([
    ["active", { id: "active", running: true }],
    ["background", { id: "background", running: true }],
    ["idle", { id: "idle", running: false }],
  ]);
  const errored = new Set<string>();
  const sync = new Function(
    "isErrorMessage", "getConversationTabSummary", "isConversationTabRunning", "setTabErrored", "getConversationRuntimeState",
    `${source.slice(start, end)}; return syncTabErrorFromMessage;`,
  )(
    (message: { role?: string; error?: boolean } | null) => Boolean(message?.error),
    (tabId: string) => tabs.get(tabId) ?? null,
    (tab: { running: boolean } | null) => Boolean(tab?.running),
    (tabId: string, value: boolean) => { if (value) errored.add(tabId); else errored.delete(tabId); },
    () => null,
  ) as (tabId: string, message: unknown) => void;
  return { tabs, errored, sync };
}

test("intermediate trace and system errors do not fail active or background running tabs", () => {
  const { errored, sync } = createErrorSync();
  for (const tabId of ["active", "background"]) {
    for (const role of ["trace", "system"]) {
      sync(tabId, { role, error: true });
      assert.equal(errored.has(tabId), false);
    }
  }
});

function createRunStatusHarness() {
  let listener: ((event: { data: Record<string, unknown> }) => void) | undefined;
  let activeTabId = "active";
  const erroredTabIds = new Set<string>();
  const noop = () => {};
  const sandbox = {
    ...Object.fromEntries([
      "resetRunRawStream", "updateCurrentRunPrompt", "resetTaskListForRunStart", "closeTaskListForRunCompletion",
      "flushPendingPromptQueue", "syncConversationControlsForActiveTab", "appendMessage", "applyTraceSegment",
      "updateAppHeight", "scheduleAppHeightUpdate", "renderConversationTabs", "updateRunPromptButton",
      "syncRunPromptOverlay", "pruneRenderedConversationViews", "syncActiveMessagesFromRuntime", "resetTaskListState",
    ].map((name) => [name, noop])),
    window: {
      addEventListener(type: string, handler: typeof listener) {
        if (type === "message") { listener = handler; }
      },
    },
    vscode: { postMessage: noop },
    conversationRuntimeByTabId: Object.create(null),
    TAB_RUNTIME_DEFAULT_KEY: "default",
    erroredTabIds,
    loopMetaByTabId: Object.create(null),
    runningTabStartedAtById: Object.create(null),
    runningFlowStoppedTabIds: new Set<string>(),
    assistantRedirects: Object.create(null),
    getActiveConversationTabId: () => activeTabId,
    getConversationTabSummary: (tabId: string) => ({ id: tabId }),
    isLoopMainTab: () => false,
    updateLoopMetaForTabFromMessage: () => false,
    normalizeRunActivity: () => "",
    isRunStatusSummaryText: () => false,
    shouldHandleTabScopedEvent: (data: { tabId?: string }) => !data.tabId || data.tabId === activeTabId,
    updateRunningState: noop,
    ensureRuntimeStateMessages: (runtime: { messages: unknown[] }) => runtime.messages,
    ensureRuntimeTaskList: (runtime: { taskList: unknown }) => runtime.taskList,
    setMessagesForTab: noop,
    isRuntimeStateForActiveTab: (tabId: string) => tabId === activeTabId,
    getTracePresentation: (content: string) => ({ type: content.startsWith("error:") ? "error" : "info" }),
    reportWebviewFailure: (_label: string, error: unknown) => { throw error; },
  };
  const context = vm.createContext(sandbox);
  for (const name of [
    "createTaskListState", "createConversationRuntimeState", "resolveConversationRuntimeKey", "getConversationRuntimeState",
    "pruneConversationRuntimeStates", "resetConversationRuntimeState",
  ]) {
    vm.runInContext(functionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, name), context);
  }
  for (const name of [
    "isErrorMessage", "syncTabErrorFromMessage", "isTabRunning", "isConversationTabRunning", "setTabErrored",
    "isHiddenRetryQueuedMessage", "isHiddenRetryStartedMessage", "getTabRunStartedAt",
  ]) {
    vm.runInContext(functionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, name), context);
  }
  vm.runInContext(VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH, context);
  const send = (data: Record<string, unknown>) => {
    assert.ok(listener);
    listener({ data });
  };
  const run = (tabId: string, status: string) => send({ type: "runStatus", tabId, status });
  const message = (tabId: string, type = "appendMessage", role = "trace", content = "error: 可恢复工具错误") => {
    send({ type, tabId, message: { id: "message", role, content } });
  };
  return {
    context, erroredTabIds, send, run, message,
    activate: (tabId: string) => { activeTabId = tabId; },
    reset: (tabId: string) => vm.runInContext(`resetConversationRuntimeState(${JSON.stringify(tabId)})`, context),
    prune: (tabIds: string[]) => vm.runInContext(`pruneConversationRuntimeStates(${JSON.stringify(tabIds)})`, context),
  };
}

for (const tabId of ["active", "background"]) {
  test(`successful ${tabId} tab ignores late error messages and retry notices`, () => {
    const harness = createRunStatusHarness();
    harness.run(tabId, "start");
    harness.run(tabId, "end");
    harness.message(tabId, "replaceMessage", "user", "历史用户消息元信息补齐");
    for (const type of ["appendMessage", "replaceMessage"]) {
      for (const role of ["trace", "system"]) {
        harness.message(tabId, type, role);
        assert.equal(harness.erroredTabIds.has(tabId), false, `${type}:${role}`);
      }
    }
    harness.send({ type: "traceSegment", tabId, content: "error: 迟到的流式错误" });
    assert.equal(harness.erroredTabIds.has(tabId), false);
    harness.message(tabId, "appendMessage", "system", "任务已中断，将在 1 秒后开始第 1 / 2 次自动重试。");
    assert.equal(harness.erroredTabIds.has(tabId), false);
  });
}

test("explicit errors still fail completed tabs and do not affect another tab", () => {
  const harness = createRunStatusHarness();
  harness.run("active", "end");
  harness.run("background", "end");
  harness.run("background", "error");
  assert.equal(harness.erroredTabIds.has("background"), true);
  assert.equal(harness.erroredTabIds.has("active"), false);
  harness.activate("background");
  harness.send({ type: "runStatus", status: "end" });
  harness.message("background");
  assert.equal(harness.erroredTabIds.has("background"), false);
});

test("a new user message or a reset releases the previous completion protection", () => {
  for (const tabId of ["active", "background"]) {
    for (const action of ["user", "reset", "prune"]) {
      const harness = createRunStatusHarness();
      harness.run(tabId, "end");
      if (action === "user") {
        harness.message(tabId, "appendMessage", "user", "开始下一项任务");
      } else if (action === "reset") {
        harness.reset(tabId);
      } else {
        harness.prune([]);
      }
      harness.message(tabId, "appendMessage", "system");
      assert.equal(harness.erroredTabIds.has(tabId), true, `${tabId}:${action}`);
    }
  }
});

test("stopping the next run does not retain an older success protection", () => {
  const harness = createRunStatusHarness();
  harness.run("active", "end");
  harness.run("active", "start");
  harness.run("active", "stopped");
  assert.equal(harness.erroredTabIds.has("active"), false);
  harness.message("active", "appendMessage", "system");
  assert.equal(harness.erroredTabIds.has("active"), true);
});

test("new runs clear old failures but later real failures remain visible", () => {
  const harness = createRunStatusHarness();
  harness.run("active", "end");
  harness.run("active", "start");
  harness.message("active");
  assert.equal(harness.erroredTabIds.has("active"), false);
  harness.run("active", "error");
  assert.equal(harness.erroredTabIds.has("active"), true);
  harness.run("active", "start");
  assert.equal(harness.erroredTabIds.has("active"), false);
});

test("an idle failure stays visible without letting unrelated or empty messages clear it", () => {
  const { errored, sync } = createErrorSync();
  sync("idle", { role: "system", error: true });
  assert.equal(errored.has("idle"), true);
  sync("idle", null);
  sync("idle", { role: "trace", error: false });
  assert.equal(errored.has("idle"), true);
  assert.equal(errored.has("active"), false);
});
