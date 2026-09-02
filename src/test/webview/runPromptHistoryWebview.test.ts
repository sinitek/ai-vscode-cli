import * as assert from "node:assert/strict";
import { test } from "node:test";

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
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "getRunPromptHistory");
  const runtimeState = { messages, currentRunPrompt };
  return new Function(
    "getConversationRuntimeState",
    "ensureRuntimeStateMessages",
    `${functionSource}; return getRunPromptHistory("tab-1");`,
  )(
    () => runtimeState,
    (state: typeof runtimeState) => state.messages,
  ) as Array<{ content: string; createdAt: number; index: number }>;
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

test("keeps prompt history toolbar fixed and list scrollable inside prompt panel", () => {
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
});

