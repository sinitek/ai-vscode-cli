import test = require("node:test");
import assert = require("node:assert/strict");
import * as vm from "node:vm";

import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";

function createHarness(activeTabId = "active-tab") {
  const tabs = ["active-tab", "background-tab", "selected-tab"].map((id) => ({ id, cli: "codex" }));
  const messages = ["当前对话"];
  const state = { conversationTabs: { activeTabId, tabs }, messages };
  const runtimeMessages = new Map(tabs.map((tab) => [tab.id, [tab.id]]));
  const calls: string[] = [];
  let onMessage!: (event: { data: unknown }) => void;
  const sandbox = vm.createContext({
    state,
    window: { addEventListener: (type: string, listener: typeof onMessage) => { if (type === "message") onMessage = listener; } },
    vscode: { postMessage: () => undefined },
    updateAppHeight: () => undefined,
    scheduleAppHeightUpdate: () => undefined,
    getActiveConversationTabId: () => state.conversationTabs.activeTabId,
    pruneConversationRuntimeStates: (tabIds: string[]) => {
      for (const tabId of runtimeMessages.keys()) {
        if (!tabIds.includes(tabId)) runtimeMessages.delete(tabId);
      }
    },
    applyAutoInteractiveModeForTab: () => { calls.push("mode"); },
    syncActiveMessagesFromRuntime: () => {
      state.messages = runtimeMessages.get(state.conversationTabs.activeTabId) ?? [];
      calls.push("messages");
    },
    syncRunningStateForActiveTab: () => { calls.push("running"); },
    updateContextTokenUsage: () => { calls.push("tokens"); },
    armPromptContextForConversationStart: () => { calls.push("prompt"); },
    renderConversationTabs: () => { calls.push("tabs"); },
    reportWebviewFailure: (_event: string, error: unknown) => { throw error; },
  });
  const start = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf("      function applyConversationTabClosed(");
  const end = VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.indexOf("      function renderConversationTabs(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING.slice(start, end), sandbox);
  vm.runInContext(VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH, sandbox);
  const close = (tabId: unknown, nextActiveTabId: unknown = "active-tab") => {
    onMessage({ data: { type: "conversationTabClosed", tabId, activeTabId: nextActiveTabId } });
  };
  return { state, messages, runtimeMessages, calls, close };
}

test("background close only removes its tab and cache without rerendering current messages", () => {
  const env = createHarness();
  env.close("background-tab");
  assert.deepEqual(Array.from(env.state.conversationTabs.tabs, (tab) => tab.id), ["active-tab", "selected-tab"]);
  assert.equal(env.state.conversationTabs.activeTabId, "active-tab");
  assert.equal(env.state.messages, env.messages);
  assert.equal(env.runtimeMessages.has("background-tab"), false);
  assert.equal(env.runtimeMessages.has("active-tab"), true);
  assert.deepEqual(env.calls, ["tabs"]);
});

test("active close immediately switches to cached fallback messages", () => {
  const env = createHarness("background-tab");
  env.close("background-tab");
  assert.equal(env.state.conversationTabs.activeTabId, "active-tab");
  assert.deepEqual(env.state.messages, ["active-tab"]);
  assert.deepEqual(env.calls, ["mode", "messages", "running", "tokens", "prompt", "tabs"]);
});

test("late close acknowledgement preserves a newer local tab selection", () => {
  const env = createHarness("selected-tab");
  env.close("background-tab", "active-tab");
  assert.equal(env.state.conversationTabs.activeTabId, "selected-tab");
  assert.equal(env.state.messages, env.messages);
  assert.deepEqual(env.calls, ["tabs"]);
});

test("duplicate, missing and malformed close acknowledgements are harmless", () => {
  const env = createHarness();
  env.close("background-tab");
  env.calls.length = 0;
  env.close("background-tab");
  env.close("missing-tab");
  env.close(null);
  env.close(undefined);
  assert.deepEqual(env.calls, []);
  assert.equal(env.state.messages, env.messages);
});

test("missing fallback uses a remaining tab and never removes the last tab", () => {
  const env = createHarness("background-tab");
  env.close("background-tab", "missing-tab");
  env.close("selected-tab");
  env.calls.length = 0;
  env.close("active-tab");
  assert.deepEqual(Array.from(env.state.conversationTabs.tabs, (tab) => tab.id), ["active-tab"]);
  assert.deepEqual(env.calls, []);
});
