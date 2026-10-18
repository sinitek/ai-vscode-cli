import * as assert from "node:assert/strict";
import { test } from "node:test";

import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "../../webview/viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "../../webview/viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { HEADER_TABS_STYLES } from "../../webview/viewContentStyles/headerTabs";
import { OVERLAYS_MODALS_STYLES } from "../../webview/viewContentStyles/overlaysModals";

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

function buildPromptHistory(messages: unknown[], currentRunPrompt = "") {
  const helperSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "isHiddenLoopPlusProtocolPrompt");
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "getRunPromptHistory");
  const runtimeState = { messages, currentRunPrompt };
  return new Function(
    "getConversationRuntimeState",
    "ensureRuntimeStateMessages",
    `${helperSource}\n${functionSource}; return getRunPromptHistory("tab-1");`,
  )(
    () => runtimeState,
    (state: typeof runtimeState) => state.messages,
  ) as Array<{ content: string; createdAt: number; index: number; executionModel?: string | null }>;
}

test("collects all user prompts in reverse chronological order", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "first prompt", createdAt: 100 },
    { role: "assistant", content: "ignored", createdAt: 200 },
    { role: "user", content: " latest prompt ", createdAt: 300 },
    { role: "system", content: "ignored", createdAt: 400 },
    { role: "user", content: "middle prompt", createdAt: 200 },
  ]);

  assert.deepEqual(prompts.map((item) => item.content), [
    "latest prompt",
    "middle prompt",
    "first prompt",
  ]);
});

test("uses message order when prompt timestamps are unavailable", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "older" },
    { role: "user", content: "newer" },
  ]);

  assert.deepEqual(prompts.map((item) => item.content), ["newer", "older"]);
});

test("keeps the current run prompt when it is not in restored messages", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "previous", createdAt: 100 },
  ], "current");

  assert.deepEqual(prompts.map((item) => item.content), ["current", "previous"]);
});

test("keeps a repeated current prompt when only an older duplicate was restored", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "repeat", createdAt: 100 },
    { role: "user", content: "different", createdAt: 200 },
  ], "repeat");

  assert.deepEqual(prompts.map((item) => item.content), ["repeat", "different", "repeat"]);
});

test("omits Loop+ protocol prompts from prompt history", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "real goal", createdAt: 100 },
    { role: "user", content: "You are the Loop+ main reviewer.\nsecret", createdAt: 200 },
    { role: "user", content: "  You are one independent Loop+ execution attempt. secret", createdAt: 300 },
  ], "You are the Loop+ main reviewer. current");

  assert.deepEqual(prompts.map((item) => item.content), ["real goal"]);
});

test("does not replace the visible run prompt with a Loop+ protocol prompt", () => {
  const helperSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE, "isHiddenLoopPlusProtocolPrompt");
  const updateSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE, "updateCurrentRunPrompt");
  const runtimeState = { currentRunPrompt: "real goal" };
  const calls: string[] = [];
  const protocolPrompt = "You are the Loop+ main reviewer.\nsecret";
  new Function(
    "getConversationRuntimeState",
    "isRuntimeStateForActiveTab",
    "updateRunPromptButton",
    "syncRunPromptOverlay",
    "protocolPrompt",
    `${helperSource}\n${updateSource}; updateCurrentRunPrompt(protocolPrompt, "tab-1"); updateCurrentRunPrompt("next goal", "tab-1");`,
  )(
    () => runtimeState,
    () => true,
    () => calls.push("button"),
    () => calls.push("overlay"),
    protocolPrompt,
  );
  assert.equal(runtimeState.currentRunPrompt, "next goal");
  assert.deepEqual(calls, ["button", "overlay"]);
});

test("sets loading animation state on historyButton and removes it after modal render", () => {
  assert.match(HEADER_TABS_STYLES, /\.icon-action\.is-loading\s*\{[\s\S]*animation:\s*spin/);
  assert.match(HEADER_TABS_STYLES, /@keyframes spin/);

  const openHistorySource = extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, "openHistory");
  const classListSet = new Set<string>();
  const attributes = new Map<string, string>();
  const historyButton = {
    classList: {
      add: (cls: string) => classListSet.add(cls),
      remove: (cls: string) => classListSet.delete(cls),
      contains: (cls: string) => classListSet.has(cls),
    },
    setAttribute: (k: string, v: string) => attributes.set(k, v),
    removeAttribute: (k: string) => attributes.delete(k),
  };
  const overlayClassList = new Set<string>();
  const historyOverlay = {
    classList: {
      add: (cls: string) => overlayClassList.add(cls),
      remove: (cls: string) => overlayClassList.delete(cls),
    },
  };
  let renderSessionListCalled = false;
  let renderPromptHistoryListCalled = false;
  let setHistoryTabCalled = false;
  let stateDuringRenderIsLoading = false;

  const runOpenHistory = new Function(
    "elements",
    "state",
    "renderSessionList",
    "renderPromptHistoryList",
    "setHistoryTab",
    "setTimeout",
    "requestAnimationFrame",
    `${openHistorySource}; return openHistory;`,
  )(
    { historyButton, historyOverlay },
    { historyTab: "sessions" },
    () => {
      renderSessionListCalled = true;
      stateDuringRenderIsLoading = historyButton.classList.contains("is-loading");
    },
    () => {
      renderPromptHistoryListCalled = true;
    },
    () => {
      setHistoryTabCalled = true;
    },
    (cb: () => void) => cb(),
    (cb: () => void) => cb(),
  );

  runOpenHistory();

  assert.equal(renderSessionListCalled, true);
  assert.equal(renderPromptHistoryListCalled, true);
  assert.equal(setHistoryTabCalled, true);
  assert.equal(stateDuringRenderIsLoading, true);
  assert.equal(overlayClassList.has("visible"), true);
  assert.equal(historyButton.classList.contains("is-loading"), false);
  assert.equal(attributes.has("aria-busy"), false);
});

test("keeps history modal height stable and lists scrollable inside panels", () => {
  assert.match(
    OVERLAYS_MODALS_STYLES,
    /\.history-modal\s*\{[\s\S]*height:\s*min\(85vh,\s*640px\)/,
  );
  assert.match(
    OVERLAYS_MODALS_STYLES,
    /\.history-panel\.prompts\s*\{[\s\S]*overflow:\s*hidden/,
  );
  assert.match(
    OVERLAYS_MODALS_STYLES,
    /\.prompt-list\s*\{[\s\S]*overflow-y:\s*auto/,
  );
  assert.match(
    OVERLAYS_MODALS_STYLES,
    /\.prompt-history-toolbar\s*\{[\s\S]*flex-shrink:\s*0/,
  );
  assert.match(
    OVERLAYS_MODALS_STYLES,
    /\.session-list\s*\{[\s\S]*flex:\s*1 1 auto[\s\S]*min-height:\s*0/,
  );
});


test("keeps model snapshots with their prompt, including default and legacy records", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "legacy", createdAt: 100 },
    { role: "user", content: "default", createdAt: 200, executionModel: null },
    { role: "user", content: "first model", createdAt: 300, executionModel: "gpt-5.5" },
    { role: "user", content: "second model", createdAt: 400, executionModel: "gpt-6.1-sol" },
  ]);
  assert.deepEqual(prompts.map(({ content, executionModel }) => [content, executionModel]), [
    ["second model", "gpt-6.1-sol"], ["first model", "gpt-5.5"], ["default", null], ["legacy", undefined],
  ]);
});


test("prefixes each prompt body with its model while keeping the date metadata separate", () => {
  type Element = { className: string; textContent: string; dateTime?: string; children: Element[]; appendChild: (child: Element) => void; replaceChildren: () => void };
  const createElement = (): Element => ({
    className: "", textContent: "", children: [],
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
  });
  const runPromptContent = createElement();
  const prompts = [
    { content: "正文\n第二行 <tag>", createdAt: 100, executionModel: " gpt-6.1-sol " },
    { content: "默认模型正文", createdAt: 90, executionModel: null },
    { content: "旧正文", createdAt: 80 },
  ];
  const renderSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "renderRunPromptHistory");
  new Function("elements", "document", "getRunPromptHistory", "t", `${renderSource}; renderRunPromptHistory("tab-1");`)(
    { runPromptContent }, { createElement }, () => prompts,
    (key: string) => ({ runPromptDefaultModel: "CLI 默认模型", runPromptUnknownModel: "模型未记录", runPromptLatestLabel: "最新" })[key],
  );
  assert.deepEqual(runPromptContent.children.map((item) => item.children[1]?.textContent), [
    "[gpt-6.1-sol] 正文\n第二行 <tag>", "[CLI 默认模型] 默认模型正文", "[模型未记录] 旧正文",
  ]);
  assert.equal(runPromptContent.children[0]?.children[0]?.children[0]?.dateTime, new Date(100).toISOString());
  assert.equal(runPromptContent.children[0]?.children[0]?.children.length, 2);
  assert.equal(prompts[0].content, "正文\n第二行 <tag>");
});


test("refreshes an open prompt after its model arrives and retains background replacements", () => {
  const runtimeByTab: Record<string, { messages: Array<{ id: string; executionModel?: string }> }> = {
    "tab-1": { messages: [{ id: "front" }] },
    "tab-2": { messages: [{ id: "back" }] },
  };
  const calls: string[] = [];
  let dispatch: (event: { data: unknown }) => void = () => undefined;
  new Function("window", "vscode", "updateAppHeight", "scheduleAppHeightUpdate", "getActiveConversationTabId",
    "syncTabErrorFromMessage", "getConversationRuntimeState", "ensureRuntimeStateMessages", "setMessagesForTab",
    "isRuntimeStateForActiveTab", "updateRunPromptButton", "syncRunPromptOverlay", "reportWebviewFailure",
    VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH)(
    { addEventListener: (name: string, listener: typeof dispatch) => { if (name === "message") dispatch = listener; } },
    { postMessage: () => undefined }, () => undefined, () => undefined, () => "tab-1", () => undefined,
    (tabId: string) => runtimeByTab[tabId], (runtime: typeof runtimeByTab[string]) => runtime.messages,
    (tabId: string, messages: typeof runtimeByTab[string]["messages"]) => { runtimeByTab[tabId].messages = messages; },
    (tabId: string) => tabId === "tab-1", () => calls.push("button"), () => calls.push("overlay"),
    (_message: string, error: Error) => { throw error; },
  );
  dispatch({ data: { type: "replaceMessage", tabId: "tab-1", message: { id: "front", executionModel: "gpt-6.1-sol" } } });
  dispatch({ data: { type: "replaceMessage", tabId: "tab-2", message: { id: "back", executionModel: "background-model" } } });
  assert.equal(runtimeByTab["tab-1"].messages[0]?.executionModel, "gpt-6.1-sol");
  assert.equal(runtimeByTab["tab-2"].messages[0]?.executionModel, "background-model");
  assert.deepEqual(calls, ["button", "overlay"]);
});
