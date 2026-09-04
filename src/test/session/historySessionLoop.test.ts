import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildLoopSessionIdsByCli } from "../../loopTaskStore";
import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { WEBVIEW_I18N } from "../../webview/viewContentI18n";
import { VIEW_CONTENT_SCRIPT_HISTORY_PANELS } from "../../webview/viewContentScript/historyPanels";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";

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

function createElement(): any {
  return {
    children: [] as any[],
    className: "",
    textContent: "",
    title: "",
    disabled: false,
    appendChild(child: any) {
      this.children.push(child);
      return child;
    },
    addEventListener() {
      return undefined;
    },
  };
}

function renderSessionTitleBadges(isLoopSession: boolean, isGraphSession: boolean, isOpenInConversationTabs: boolean): string[] {
  const renderSessionListSource = [
    "getHistorySearchQuery",
    "historySearchMatches",
    "renderSessionList",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_HISTORY_PANELS, name)).join("\n");
  const sessionList = createElement();
  const state = {
    historySearchQuery: "",
    sessionState: {
      sessions: [{
        id: "session-1",
        label: "Loop task",
        firstPrompt: "Build the feature",
        createdAt: 1,
        cli: "codex",
        isLoopSession,
        isGraphSession,
        graphRunId: isGraphSession ? "graph-1" : null,
        isOpenInConversationTabs,
        openConversationTabId: isOpenInConversationTabs ? "tab-1" : null,
      }],
    },
  };
  const runtime = new Function(
    "elements",
    "state",
    "document",
    "t",
    "buildPromptPreview",
    "formatDateTime",
    "openHistorySessionMessages",
    "closeHistory",
    "armPromptContextForConversationStart",
    "vscode",
    "isHistorySessionExportPending",
    "historySessionExportPendingKey",
    "requestHistorySessionExport",
    `${renderSessionListSource}; return renderSessionList;`,
  )(
    { sessionList },
    state,
    { createElement },
    (key: string) => ({ sessionLoopLabel: "Loop", sessionGraphLabel: "Graph", sessionOpenInTabsLabel: "Open" } as Record<string, string>)[key] || key,
    (value: string) => value,
    () => "time",
    () => undefined,
    () => undefined,
    () => undefined,
    { postMessage: () => undefined },
    () => false,
    "",
    () => undefined,
  ) as () => void;

  runtime();
  const titleRow = sessionList.children[0].children[0].children[0];
  return titleRow.children.map((child: any) => child.textContent);
}

test("collects bound Loop session ids by CLI and ignores pending tasks", () => {
  const sessionIdsByCli = buildLoopSessionIdsByCli([
    { cli: "codex", sessionId: " session-codex " },
    { cli: "claude", sessionId: "session-claude" },
    { cli: "opencode", sessionId: null },
    { cli: "opencode", sessionId: "   " },
  ]);

  assert.deepEqual(Array.from(sessionIdsByCli.codex), ["session-codex"]);
  assert.deepEqual(Array.from(sessionIdsByCli.claude), ["session-claude"]);
  assert.deepEqual(Array.from(sessionIdsByCli.opencode), []);
});

test("renders Loop, Graph, and open badges together in history sessions", () => {
  assert.deepEqual(renderSessionTitleBadges(true, true, true), ["[codex] Build the feature", "Loop", "Graph", "Open"]);
  assert.deepEqual(renderSessionTitleBadges(false, false, false), ["[codex] Build the feature"]);
});

test("removes the standalone Loop group chat recovery tab", () => {
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

  assert.doesNotMatch(html, /historyTabLoopGroupChats/);
  assert.doesNotMatch(html, /historyPanelLoopGroupChats/);
  assert.doesNotMatch(html, /loopGroupChatHistoryList/);
  assert.doesNotMatch(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, /renderLoopGroupChatHistoryList/);
});
