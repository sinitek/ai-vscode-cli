import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../webview/viewContentHtml";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../webview/viewContentScript/settingsAndOverlays";

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in webview script`);
  const bodyStart = script.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    const char = script[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }
  throw new Error(`${name} body was not terminated`);
}

function buildHarness() {
  const functionSource = [
    "getActiveLobsterMainTaskId",
    "syncOpenCurrentLobsterGroupChatButton",
    "openCurrentLobsterGroupChat",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, name)).join("\n");
  const classes = new Set<string>();
  const state: any = {
    isRunning: false,
    conversationTabs: { activeTabId: null, tabs: [] },
  };
  const elements = {
    openCurrentLobsterGroupChat: { style: { display: "none" }, disabled: true },
    runWait: {
      classList: {
        toggle(name: string, enabled: boolean) {
          if (enabled) {
            classes.add(name);
          } else {
            classes.delete(name);
          }
        },
      },
    },
  };
  const messages: unknown[] = [];
  const vscode = { postMessage(message: unknown) { messages.push(message); } };
  const runtime = new Function(
    "state",
    "elements",
    "vscode",
    `${functionSource}; return { syncOpenCurrentLobsterGroupChatButton, openCurrentLobsterGroupChat };`,
  )(state, elements, vscode) as {
    syncOpenCurrentLobsterGroupChatButton(): void;
    openCurrentLobsterGroupChat(): void;
  };
  return { state, elements, classes, messages, ...runtime };
}

test("places the persistent group-chat button immediately after the prompt button", () => {
  const html = buildWebviewStaticHtml({
    locale: "zh-CN",
    cspSource: "self",
    nonce: "nonce",
    i18n: WEBVIEW_I18N["zh-CN"],
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    lobsterExecutionModeMainSubMultiAgent: "main-sub-multi-agent",
    lobsterExecutionModeDebateMultiAgent: "debate-multi-agent",
    finalAnswerPolicySuccessfulReplyFallback: "successful_reply_fallback",
    finalAnswerPolicyStrict: "strict_final_answer",
  });
  const promptIndex = html.indexOf('id="runPromptButton"');
  const groupChatIndex = html.indexOf('id="openCurrentLobsterGroupChat"');
  const queueIndex = html.indexOf('id="queueIndicator"');
  assert.ok(promptIndex >= 0);
  assert.ok(groupChatIndex > promptIndex);
  assert.ok(queueIndex > groupChatIndex);
  assert.match(html.slice(groupChatIndex, queueIndex), /打开群聊/);
});

test("shows only for the active Loop main tab and survives every task status", () => {
  const harness = buildHarness();
  harness.state.conversationTabs = {
    activeTabId: "main-tab",
    tabs: [
      { id: "main-tab", lobsterTaskRole: "main", lobsterTaskId: "task-123" },
      { id: "sub-tab", lobsterTaskRole: "subtask", lobsterTaskId: "task-123" },
      { id: "normal-tab" },
    ],
  };

  for (const status of ["running", "waiting", "completed", "failed"]) {
    harness.state.isRunning = status === "running";
    harness.state.taskStatus = status;
    harness.syncOpenCurrentLobsterGroupChatButton();
    assert.equal(harness.elements.openCurrentLobsterGroupChat.style.display, "inline-flex");
    assert.equal(harness.elements.openCurrentLobsterGroupChat.disabled, false);
    assert.equal(harness.classes.has("has-current-lobster-group-chat"), true);
  }

  harness.state.conversationTabs.activeTabId = "sub-tab";
  harness.syncOpenCurrentLobsterGroupChatButton();
  assert.equal(harness.elements.openCurrentLobsterGroupChat.style.display, "none");

  harness.state.conversationTabs.activeTabId = "normal-tab";
  harness.syncOpenCurrentLobsterGroupChatButton();
  assert.equal(harness.elements.openCurrentLobsterGroupChat.style.display, "none");
  assert.equal(harness.classes.has("has-current-lobster-group-chat"), false);
});

test("opens the existing Loop group chat with the active main task id", () => {
  const harness = buildHarness();
  harness.state.conversationTabs = {
    activeTabId: "main-tab",
    tabs: [{ id: "main-tab", lobsterTaskRole: "main", lobsterTaskId: " task-456 " }],
  };
  harness.openCurrentLobsterGroupChat();
  assert.deepEqual(harness.messages, [{ type: "openLobsterDebateChat", taskId: "task-456" }]);

  harness.state.conversationTabs.tabs[0].lobsterTaskRole = "subtask";
  harness.openCurrentLobsterGroupChat();
  assert.equal(harness.messages.length, 1);
});
