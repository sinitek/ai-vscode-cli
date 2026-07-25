import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../webview/viewContentHtml";
import { getWebviewStrings, WEBVIEW_I18N } from "../webview/viewContentI18n";
import { WEBVIEW_STYLES } from "../webview/viewContentStyles";
import { BASE_STYLES } from "../webview/viewContentStyles/base";
import { CHAT_AREA_STYLES } from "../webview/viewContentStyles/chatArea";
import { HEADER_TABS_STYLES } from "../webview/viewContentStyles/headerTabs";
import { INPUT_CONTROLS_STYLES } from "../webview/viewContentStyles/inputControls";
import { MARKDOWN_STYLES } from "../webview/viewContentStyles/markdown";
import { MESSAGE_BLOCK_STYLES } from "../webview/viewContentStyles/messages";
import { OVERLAYS_MODALS_STYLES } from "../webview/viewContentStyles/overlaysModals";
import { SYSTEM_TRACE_STYLES } from "../webview/viewContentStyles/systemTrace";
import { TASKLIST_STYLES } from "../webview/viewContentStyles/tasklist";
import { TOAST_MISC_STYLES } from "../webview/viewContentStyles/toastMisc";
import { TYPING_STATUS_STYLES } from "../webview/viewContentStyles/typingStatus";

type StaticHtmlInput = Parameters<typeof buildWebviewStaticHtml>[0];

const LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT = "main_sub_multi_agent";
const LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT = "debate_multi_agent";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(source: string, needle: string): number {
  return source.match(new RegExp(escapeRegExp(needle), "g"))?.length ?? 0;
}

function assertIncludesAll(source: string, snippets: string[]): void {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `Missing static page snippet: ${snippet}`);
  }
}

function buildHtml(overrides: Partial<StaticHtmlInput> = {}): string {
  const locale = overrides.locale ?? "en";
  const input: StaticHtmlInput = {
    locale,
    cspSource: "vscode-resource://test-authority",
    nonce: "static-test-nonce",
    i18n: getWebviewStrings(locale),
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent:
      LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT,
    loopExecutionModeDebateMultiAgent: LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT,
  };
  return buildWebviewStaticHtml({ ...input, ...overrides });
}

test("renders a nonce-protected static shell with supplied resource strings", () => {
  const nonce = "nonce-static-render";
  const cspSource = "vscode-resource://sinitek-cli-webview";
  const cliOptions =
    '<option value="codex" selected>codex</option><option value="opencode">opencode</option>';
  const markedScript = "window.__markedStaticRenderCoverage = true;";
  const webviewStyles =
    ".static-render-sentinel { color: var(--vscode-editor-foreground); }\n";
  const html = buildHtml({
    cspSource,
    nonce,
    cliOptions,
    markedScript,
    webviewStyles,
    loopExecutionModeMainSubMultiAgent: "main-mode",
    loopExecutionModeDebateMultiAgent: "debate-mode",
  });

  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Sinitek CLI Assistant<\/title>/);
  assert.match(
    html,
    new RegExp(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapeRegExp(cspSource)} https:; style-src ${escapeRegExp(cspSource)} 'unsafe-inline'; script-src 'nonce-${escapeRegExp(nonce)}';" />`,
    ),
  );
  assert.equal(countOccurrences(html, `<script nonce="${nonce}">`), 2);
  assert.doesNotMatch(html, /<script(?![^>]*nonce=)/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.ok(html.includes(webviewStyles));
  assert.ok(html.includes(markedScript));
  assert.match(
    html,
    new RegExp(`<select id="currentCli"[^>]*>${escapeRegExp(cliOptions)}</select>`),
  );
  assert.match(
    html,
    /<option value="main-mode" selected>Main\/Sub Multi-Agent<\/option>\s*<option value="debate-mode">Red\/Blue Debate Multi-Agent<\/option>/,
  );
  assert.ok(html.endsWith(`    <script nonce="${nonce}">`));
});

test("renders the main conversation, Loop, task-list, and input DOM anchors", () => {
  const html = buildHtml({
    cliOptions: '<option value="codex">codex</option>',
  });

  assertIncludesAll(html, [
    '<div class="app">',
    '<div class="header">',
    'id="resultOnlyToggle"',
    'id="helpButton"',
    'id="toolSettingsButton"',
    'id="rulesButton"',
    'id="newSession"',
    'id="resetSession"',
    'id="conversationTabs" class="conversation-tabs" role="tablist"',
    'id="chatArea" class="chat-area"',
    'id="emptyState"',
    'id="messages"',
    'id="runWait"',
    'id="runWaitTime"',
    'id="runStatusText"',
    'id="runStreamButton"',
    'id="runPromptButton"',
    'id="openCurrentLoopGroupChat"',
    'id="openCurrentGraphRun"',
    'id="queueIndicator"',
    'id="queueCount"',
    'id="scrollToBottomButton"',
    'id="taskListPanel"',
    'id="taskListDetails"',
    'id="taskListCount"',
    'id="taskListBody"',
    'id="openConfig"',
    'id="currentCli"',
    'id="configSelect"',
    'id="interactiveModeSelect"',
    'id="promptContextTags"',
    'id="promptInput"',
    'id="attachmentInput"',
    'id="modelSelect"',
    'id="thinkingMode"',
    'id="loopExecutionModeSelect"',
    'id="commonCommandButton"',
    'id="pathPickerButton"',
    'id="attachmentButton"',
    'id="historyButton"',
    'id="sendPrompt"',
    'id="stopRun"',
  ]);
  assert.match(
    html,
    /<select id="interactiveModeSelect"[\s\S]*?<option value="coding">Vibe<\/option>\s*<option value="loop">Loop<\/option>\s*<option value="graph">Graph<\/option>/,
  );
  assert.match(
    html,
    /id="loopExecutionModeSelect"[\s\S]*?<option value="main_sub_multi_agent" selected>Main\/Sub Multi-Agent<\/option>\s*<option value="debate_multi_agent">Red\/Blue Debate Multi-Agent<\/option>/,
  );
});

test("renders model-selection and OpenCode role-model anchors", () => {
  const html = buildHtml();

  assert.match(
    html,
    /<div id="openCodeModelGroup" class="open-code-model-group" style="display: none;">[\s\S]*?<\/div>/,
  );
  assertIncludesAll(html, [
    'for="openCodePrimaryModelSelect"',
    'id="openCodePrimaryModelSelect" class="model-select"',
    'id="openCodePrimaryThinkingMode" class="thinking-select"',
    'for="openCodeSmallModelSelect"',
    'id="openCodeSmallModelSelect" class="model-select"',
    'id="openCodeSmallThinkingMode" class="thinking-select"',
    'id="openCodeModelIssue"',
    '<option value="">Model: Follow Config</option>',
    '<option value="__manage__">Manage</option>',
    '<option value="off">off</option>',
    '<option value="low">low</option>',
    '<option value="medium">medium</option>',
    '<option value="high">high</option>',
    '<option value="xhigh">xhigh</option>',
    '<option value="max">max</option>',
    '<option value="ultra">ultra</option>',
  ]);
});

test("renders history, settings, run-status, queue, and help overlays", () => {
  const html = buildHtml();

  assertIncludesAll(html, [
    'id="historyOverlay"',
    'id="historyTabPrompts"',
    'id="historyTabSessions"',
    'id="historyPanelPrompts"',
    'id="historyPanelSessions"',
    'id="historyMessagesOverlay"',
    'id="historyMessagesContent"',
    'id="toast" class="toast" role="status" aria-live="polite"',
    'id="rulesOverlay"',
    'id="scopeGlobal"',
    'id="scopeProject"',
    'id="rulesLoadCli"',
    'id="rulesInput"',
    'id="toolSettingsOverlay"',
    'id="toolSettingsGlobalTab"',
    'id="toolSettingsWorkspaceTab"',
    'id="installCodeGraph"',
    'id="loopMaxRounds"',
    'id="loopSubtaskMaxThinkingMode"',
    'id="languageSelect"',
    'id="commonCommandsOverlay"',
    'id="addModelOverlay"',
    'id="modelManagerList"',
    'id="runConflictOverlay"',
    'id="queueOverlay"',
    'id="queueBody"',
    'id="runPromptOverlay"',
    'id="runPromptContent"',
    'id="runStreamOverlay"',
    'id="runStreamContent"',
    'id="configApplyErrorOverlay"',
    'id="configApplyErrorContent"',
    'id="helpOverlay"',
    'id="helpTabModes"',
    'id="helpTabInstall"',
    'id="helpTabThinking"',
    'id="helpPanelModes"',
    'id="helpPanelInstall"',
    'id="helpPanelThinking"',
    'id="helpPanelModes" class="help-panel active"',
  ]);
});

test("renders English and Chinese static page copy through shared i18n strings", () => {
  const englishStrings = getWebviewStrings("en");
  const chineseStrings = getWebviewStrings("zh-CN");
  const englishHtml = buildHtml({ locale: "en", i18n: WEBVIEW_I18N.en });
  const chineseHtml = buildHtml({
    locale: "zh-CN",
    i18n: WEBVIEW_I18N["zh-CN"],
  });

  assert.equal(englishStrings.appTitle, "Sinitek CLI Assistant");
  assert.equal(chineseStrings.appTitle, "携宁 CLI 助手");
  assertIncludesAll(englishHtml, [
    '<html lang="en">',
    "AI Chat",
    "Type your request to start chatting.",
    "Results only",
    "Task List",
    "Open group chat",
    "History",
    "Tool Settings",
    "Install CodeGraph",
    "Rules",
    "How to Choose",
    "Vibe",
    "Loop",
    "Graph",
    "Pros: fastest startup",
    "Cons: no explicit subtask orchestration",
    "Workspace Harness Scaffold",
    "Main/Sub Multi-Agent",
    "Red/Blue Debate Multi-Agent",
  ]);
  assertIncludesAll(chineseHtml, [
    '<html lang="zh-CN">',
    "携宁 CLI 助手",
    "AI 对话",
    "输入需求，开始对话。",
    "仅看结果",
    "任务列表",
    "打开群聊",
    "历史记录",
    "工具设置",
    "规则配置",
    "如何选择",
    "Vibe",
    "Loop",
    "Graph",
    "优点：启动最快",
    "缺点：没有显式子任务编排",
    "工作区 Harness 骨架",
    "主从多智能体",
    "红蓝辩论多智能体",
  ]);
});

test("keeps required anchors when optional resource inputs are empty", () => {
  const html = buildHtml({
    cspSource: "",
    nonce: "",
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "",
    loopExecutionModeDebateMultiAgent: "",
  });

  assert.match(
    html,
    /Content-Security-Policy" content="default-src 'none'; img-src  https:; style-src  'unsafe-inline'; script-src 'nonce-';"/,
  );
  assert.match(html, /<select id="currentCli" class="cli-select" aria-label="CLI selection"><\/select>/);
  assert.match(
    html,
    /<option value="" selected>Main\/Sub Multi-Agent<\/option>\s*<option value="">Red\/Blue Debate Multi-Agent<\/option>/,
  );
  assert.match(html, /<script nonce="">\s*<\/script>\s*<script nonce="">$/);
  assert.doesNotMatch(html, /undefined|null/);
  assertIncludesAll(html, [
    'id="chatArea"',
    'id="promptInput"',
    'id="taskListPanel"',
    'id="historyOverlay"',
    'id="toolSettingsOverlay"',
    'id="helpOverlay"',
  ]);
});

test("concatenates all static style modules and keeps key selectors available", () => {
  const expectedStyles = [
    BASE_STYLES,
    HEADER_TABS_STYLES,
    CHAT_AREA_STYLES,
    MESSAGE_BLOCK_STYLES,
    MARKDOWN_STYLES,
    SYSTEM_TRACE_STYLES,
    TYPING_STATUS_STYLES,
    INPUT_CONTROLS_STYLES,
    OVERLAYS_MODALS_STYLES,
    TOAST_MISC_STYLES,
    TASKLIST_STYLES,
  ].join("");
  const html = buildHtml({ webviewStyles: WEBVIEW_STYLES });

  assert.equal(WEBVIEW_STYLES, expectedStyles);
  assert.ok(html.includes(WEBVIEW_STYLES));
  assertIncludesAll(WEBVIEW_STYLES, [
    ":root {",
    ".header {",
    ".conversation-tabs {",
    ".chat-area {",
    ".messages {",
    ".message {",
    ".message.assistant .bubble p",
    ".message.trace",
    ".run-wait {",
    ".run-wait.has-current-loop-group-chat",
    ".run-wait.has-current-graph-run",
    ".input-area {",
    ".open-code-model-group {",
    ".loop-execution-mode-select {",
    ".overlay {",
    ".toast {",
    ".tasklist-panel {",
    ".tasklist-panel details[open] .tasklist-toggle-icon",
  ]);
});
