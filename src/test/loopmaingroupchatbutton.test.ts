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
    "getActiveLoopMainTaskId",
    "syncOpenCurrentLoopGroupChatButton",
    "openCurrentLoopGroupChat",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, name)).join("\n");
  const classes = new Set<string>();
  const state: any = {
    isRunning: false,
    conversationTabs: { activeTabId: null, tabs: [] },
  };
  const elements = {
    openCurrentLoopGroupChat: { style: { display: "none" }, disabled: true },
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
    `${functionSource}; return { syncOpenCurrentLoopGroupChatButton, openCurrentLoopGroupChat };`,
  )(state, elements, vscode) as {
    syncOpenCurrentLoopGroupChatButton(): void;
    openCurrentLoopGroupChat(): void;
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
    loopExecutionModeMainSubMultiAgent: "main-sub-multi-agent",
    loopExecutionModeDebateMultiAgent: "debate-multi-agent",
  });
  const promptIndex = html.indexOf('id="runPromptButton"');
  const groupChatIndex = html.indexOf('id="openCurrentLoopGroupChat"');
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
      { id: "main-tab", loopTaskRole: "main", loopTaskId: "task-123" },
      { id: "sub-tab", loopTaskRole: "subtask", loopTaskId: "task-123" },
      { id: "normal-tab" },
    ],
  };

  for (const status of ["running", "waiting", "completed", "failed"]) {
    harness.state.isRunning = status === "running";
    harness.state.taskStatus = status;
    harness.syncOpenCurrentLoopGroupChatButton();
    assert.equal(harness.elements.openCurrentLoopGroupChat.style.display, "inline-flex");
    assert.equal(harness.elements.openCurrentLoopGroupChat.disabled, false);
    assert.equal(harness.classes.has("has-current-loop-group-chat"), true);
  }

  harness.state.conversationTabs.activeTabId = "sub-tab";
  harness.syncOpenCurrentLoopGroupChatButton();
  assert.equal(harness.elements.openCurrentLoopGroupChat.style.display, "none");

  harness.state.conversationTabs.activeTabId = "normal-tab";
  harness.syncOpenCurrentLoopGroupChatButton();
  assert.equal(harness.elements.openCurrentLoopGroupChat.style.display, "none");
  assert.equal(harness.classes.has("has-current-loop-group-chat"), false);
});

test("opens the existing Loop group chat with the active main task id", () => {
  const harness = buildHarness();
  harness.state.conversationTabs = {
    activeTabId: "main-tab",
    tabs: [{ id: "main-tab", loopTaskRole: "main", loopTaskId: " task-456 " }],
  };
  harness.openCurrentLoopGroupChat();
  assert.deepEqual(harness.messages, [{ type: "openLoopGroupChat", taskId: "task-456" }]);

  harness.state.conversationTabs.tabs[0].loopTaskRole = "subtask";
  harness.openCurrentLoopGroupChat();
  assert.equal(harness.messages.length, 1);
});
