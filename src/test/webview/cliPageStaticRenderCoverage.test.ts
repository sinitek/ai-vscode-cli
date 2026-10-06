import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings, WEBVIEW_I18N } from "../../webview/viewContentI18n";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { WEBVIEW_STYLES } from "../../webview/viewContentStyles";
import { BASE_STYLES } from "../../webview/viewContentStyles/base";
import { CHAT_AREA_STYLES } from "../../webview/viewContentStyles/chatArea";
import { HEADER_TABS_STYLES } from "../../webview/viewContentStyles/headerTabs";
import { INPUT_CONTROLS_STYLES } from "../../webview/viewContentStyles/inputControls";
import { MARKDOWN_STYLES } from "../../webview/viewContentStyles/markdown";
import { MESSAGE_BLOCK_STYLES } from "../../webview/viewContentStyles/messages";
import { CLARIFICATION_DIALOG_STYLES, DIALOG_SHELL_STYLES, renderChatModal, renderModalActions, renderModalCloseButton, renderPanelDialog } from "../../webview/modalComponents";
import { orchestratorClarificationDialogScript } from "../../webview/orchestratorClarificationDialog";
import { OVERLAYS_MODALS_STYLES } from "../../webview/viewContentStyles/overlaysModals";
import { SYSTEM_TRACE_STYLES } from "../../webview/viewContentStyles/systemTrace";
import { TASKLIST_STYLES } from "../../webview/viewContentStyles/tasklist";
import { TOAST_MISC_STYLES } from "../../webview/viewContentStyles/toastMisc";
import { TYPING_STATUS_STYLES } from "../../webview/viewContentStyles/typingStatus";

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
  assert.equal(countOccurrences(html, `<script nonce="${nonce}">`), 3);
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
    'id="newSessionConnectionTooltip"',
    'id="resetSession"',
    'id="chatSearchButton"',
    'id="chatSearchBar"',
    'id="chatSearchInput"',
    'id="chatSearchCount"',
    'id="chatSearchPrev"',
    'id="chatSearchNext"',
    'id="chatSearchClose"',
    'id="conversationTabs" class="conversation-tabs" role="tablist"',
    'id="chatArea" class="chat-area"',
    'id="emptyState"',
    'id="messages"',
    'id="runWait"',
    'id="runWaitTime"',
    'id="runStatusText"',
    'id="runStreamButton"',
    'id="runContextTokens"',
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
    'id="codexLoopModelGroup"',
    'id="codexLoopMainModelSelect"',
    'id="codexLoopSubtaskModelSelect"',
    'id="modelSelect"',
    'id="thinkingMode"',
    'id="loopExecutionModeSelect"',
    'id="commonCommandButton"',
    'id="pathPickerButton"',
    'id="attachmentButton"',
    'id="historyButton"',
    'id="sendPrompt"',
    'id="stopRun"',
    'id="scheduleTaskButton"',
    'id="scheduledTaskOverlay"',
    'id="scheduledTaskMode"',
  ]);
  assert.match(
    html,
    /<select id="interactiveModeSelect"[\s\S]*?<option value="coding">Vibe<\/option>\s*<option value="loop">Loop<\/option>\s*<option value="loop_plus" title="Accept each finished subtask immediately, and queue other completions\.">Loop\+<\/option>\s*<option value="graph">Graph<\/option>/,
  );
  assert.match(
    html,
    /<select id="scheduledTaskMode" class="interactive-mode-select"[\s\S]*?<option value="coding">Vibe<\/option>\s*<option value="loop">Loop<\/option>\s*<option value="loop_plus" title="Accept each finished subtask immediately, and queue other completions\.">Loop\+<\/option>\s*<option value="graph">Graph<\/option>/,
  );
  assert.match(
    html,
    /id="loopExecutionModeSelect"[\s\S]*?<option value="main_sub_multi_agent" selected>Main\/Sub Multi-Agent<\/option>\s*<option value="debate_multi_agent">Red\/Blue Debate Multi-Agent<\/option>/,
  );
});

test("renders model-selection, Codex role-model, and OpenCode role-model anchors", () => {
  const html = buildHtml();

  assert.match(
    html,
    /<div id="codexLoopModelGroup" class="open-code-model-group codex-loop-model-group" style="display: none;">[\s\S]*?<\/div>/,
  );
  assert.match(
    html,
    /<div id="openCodeModelGroup" class="open-code-model-group" style="display: none;">[\s\S]*?<\/div>/,
  );
  assertIncludesAll(html, [
    'for="codexLoopMainModelSelect"',
    'id="codexLoopMainModelSelect" class="model-select"',
    'id="codexLoopMainThinkingMode" class="thinking-select"',
    'aria-label="Codex Loop/Graph main model selection"',
    'for="codexLoopSubtaskModelSelect"',
    'id="codexLoopSubtaskModelSelect" class="model-select"',
    'id="codexLoopSubtaskThinkingMode" class="thinking-select"',
    'aria-label="Codex Loop/Graph subtask model selection"',
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
  assert.match(
    html,
    /<div class="open-code-model-row codex-loop-model-row">[\s\S]*?<label class="open-code-model-label" for="codexLoopMainModelSelect">[\s\S]*?<\/label>[\s\S]*?<select id="codexLoopMainModelSelect" class="model-select"[\s\S]*?<select id="codexLoopMainThinkingMode" class="thinking-select"[\s\S]*?<\/div>/,
  );
  assert.match(
    html,
    /<div class="open-code-model-row codex-loop-model-row">[\s\S]*?<label class="open-code-model-label" for="codexLoopSubtaskModelSelect">[\s\S]*?<\/label>[\s\S]*?<select id="codexLoopSubtaskModelSelect" class="model-select"[\s\S]*?<select id="codexLoopSubtaskThinkingMode" class="thinking-select"[\s\S]*?<\/div>/,
  );
  assert.doesNotMatch(html, /<label class="open-code-model-row/);
  assert.match(
    INPUT_CONTROLS_STYLES,
    /\.codex-loop-model-row\s*\{\s*grid-template-columns:\s*minmax\(52px, auto\) minmax\(92px, 1fr\) calc\(70px \* 1\.15\);/,
  );
  assert.match(
    INPUT_CONTROLS_STYLES,
    /\.input-model-row > #modelSelect\s*\{\s*flex-basis:\s*calc\(118px \* 1\.33\);/,
  );
});

test("renders history, settings, run-status, queue, and help overlays", () => {
  const html = buildHtml();

  assertIncludesAll(html, [
    'id="historyOverlay"',
    'id="historyTabPrompts"',
    'id="historyTabSessions"',
    'id="historySearchInput"',
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
    'id="toolSettingsGeneralTab"',
    'id="toolSettingsAiTaskTab"',
    'id="toolSettingsWorkspaceTab"',
    'id="toolSettingsRepairTab"',
    'id="toolSettingsRepairPanel"',
    'id="toolSettingsRepairBody"',
    'id="toolSettingsGeneralPanel"',
    'id="toolSettingsAiTaskPanel"',
    'id="historyRetentionDays"',
    'id="codeGraphEnabled"',
    'id="humanInteractionTimeoutMinutes"',
    'id="loopMaxRounds"',
    'id="loopPlusDecisionSubtaskMax"',
    'id="loopPlusMaxAcceptances"',
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
    'id="helpTabInstall"',
    'id="helpTabModes"',
    'id="helpPanelInstall"',
    'id="helpPanelModes"',
    'id="helpPanelInstall" class="help-panel active"',
  ]);
  assert.doesNotMatch(html, /toolSettingsGlobal(?:Tab|Panel)|toolSettingsCleanup(?:Tab|Panel)/u);
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
    "Type your request to start chatting.",
    "Results only",
    "Task List",
    "Open group chat",
    "History",
    "Tool Settings",
    "CodeGraph",
    "Rules",
    "How to Choose",
    "Loop+",
    "visible queue",
    "Accept each finished subtask immediately, and queue other completions.",
    "Vibe",
    "Loop",
    "Graph",
    "Execution mode",
    "Pros: fastest startup",
    "Workspace Harness Scaffold",
    "Main/Sub Multi-Agent",
    "Red/Blue Debate Multi-Agent",
    "Codex Loop/Graph main model selection",
    "Codex Loop/Graph subtask model selection",
    "Replay",
    "Export JSONL",
    "Waiting for replay output...",
  ]);
  assertIncludesAll(chineseHtml, [
    '<html lang="zh-CN">',
    "携宁 CLI 助手",
    "输入需求，开始对话。",
    "仅看结果",
    "任务列表",
    "打开群聊",
    "历史记录",
    "工具设置",
    "规则配置",
    "如何选择",
    "Loop+",
    "可见队列",
    "单个子任务执行结束后立即验收，其它完成进入队列。",
    "Vibe",
    "Loop",
    "Graph",
    "执行模式",
    "优点：启动最快",
    "工作区 Harness 骨架",
    "主从多智能体",
    "红蓝辩论多智能体",
    "Codex Loop/Graph 主模型选择",
    "Codex Loop/Graph 子模型选择",
    "回放",
    "导出 JSONL",
    "等待回放内容...",
  ]);
  assert.doesNotMatch(englishHtml, /AI Chat/u);
  assert.doesNotMatch(chineseHtml, /AI 对话/u);
  assert.doesNotMatch(englishHtml, /automatic conflict resolution|没有自动解冲突/);
  assert.doesNotMatch(chineseHtml, /自动解冲突|不能自动解冲突/);
  assert.match(englishHtml, /id="helpTabInstall"/);
  assert.match(chineseHtml, /id="helpPanelInstall" class="help-panel active"/);
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
    "mark.chat-search-hit",
    ".chat-search-bar {",
    ".chat-search-bar[hidden]",
    ".message.assistant .bubble p",
    ".message.trace",
    ".run-wait {",
    ".run-wait.has-current-loop-group-chat",
    ".run-wait.has-current-graph-run",
    ".run-context-tokens {",
    ".run-prompt-button {",
    ".input-area {",
    ".open-code-model-group {",
    ".codex-loop-model-row {",
    ".interactive-mode-select {",
    ".loop-execution-mode-select {",
    ".overlay,",
    ".toast {",
    ".tasklist-panel {",
    ".tasklist-panel details[open] .tasklist-toggle-icon",
  ]);
});

test("reuses the AI chat interactive mode select for scheduled tasks", () => {
  const html = buildHtml();
  assert.match(
    html,
    /<select id="interactiveModeSelect" class="interactive-mode-select"/,
  );
  assert.match(
    html,
    /<select id="scheduledTaskMode" class="interactive-mode-select"/,
  );
  assert.equal(
    (html.match(/class="interactive-mode-select"/g) || []).length,
    2,
  );
});

test("saves scheduled tasks with the selected Vibe/Loop/Graph mode", () => {
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /function getScheduledTaskSelectedMode\(/);
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /const selectedMode = getScheduledTaskSelectedMode\(\);/);
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /interactiveMode: selectedMode,/);
  assert.match(
    VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS,
    /loopExecutionMode: selectedMode === "loop" \? getLoopExecutionModeForCli\(targetCli\) : undefined,/,
  );
});

test("shares one modal shell across chat overlays and panel dialogs", () => {
  const html = buildHtml();
  assert.match(html, /id="historyOverlay" class="overlay"/);
  assert.match(html, /class="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="historyTitle"/);
  assert.match(html, /id="closeHistory" class="secondary icon-button" type="button"[^>]*aria-label="Close"/);
  assert.match(html, /id="toolSettingsOverlay"[\s\S]*id="closeToolSettings"/);
  assert.match(html, /id="humanInteractionReject"[\s\S]*id="humanInteractionSubmit"/);
  assert.match(html, /id="queuePrompt"[\s\S]*id="pauseAndSend"/);
  assert.match(html, /id="commonCommandsOverlay"[\s\S]*id="commandCompact"/);
  assert.ok(OVERLAYS_MODALS_STYLES.includes(DIALOG_SHELL_STYLES));
  assert.match(DIALOG_SHELL_STYLES, /\.overlay,\s*\.dialog-backdrop\s*\{/);
  assert.match(DIALOG_SHELL_STYLES, /\.modal,\s*\.dialog\s*\{[\s\S]*max-width:\s*90vw;[\s\S]*max-height:\s*85vh;[\s\S]*border-radius:\s*var\(--radius-lg, 12px\);/);
  assert.match(DIALOG_SHELL_STYLES, /box-shadow:\s*0 8px 32px color-mix\(in srgb, var\(--vscode-editor-foreground\) 24%, transparent\)/);
  assert.match(DIALOG_SHELL_STYLES, /\.modal-header,\s*\.dialog-header\s*\{[\s\S]*padding:\s*16px 16px 12px;/);
  assert.match(DIALOG_SHELL_STYLES, /\.modal-body,\s*\.dialog-body\s*\{[\s\S]*overflow:\s*auto;/);
  assert.match(DIALOG_SHELL_STYLES, /\.modal-actions,\s*\.dialog-actions\s*\{[\s\S]*justify-content:\s*flex-end;[\s\S]*gap:\s*8px;/);
  assert.match(DIALOG_SHELL_STYLES, /:focus-visible[\s\S]*var\(--vscode-focusBorder\)/);
  assert.match(DIALOG_SHELL_STYLES, /:disabled[\s\S]*cursor:\s*not-allowed/);
  assert.match(DIALOG_SHELL_STYLES, /\.is-loading[\s\S]*cursor:\s*wait/);
  assert.match(DIALOG_SHELL_STYLES, /\.dialog-error[\s\S]*var\(--vscode-errorForeground\)/);
  assert.match(DIALOG_SHELL_STYLES, /\.ask-chat-empty[\s\S]*var\(--vscode-descriptionForeground\)/);
  assert.match(DIALOG_SHELL_STYLES, /@media \(max-width:\s*560px\)/);
  assert.doesNotMatch(DIALOG_SHELL_STYLES, /#[0-9a-fA-F]{3,8}/);
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /elements\.humanInteractionOverlay\.addEventListener\("click"/);
  assert.match(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /elements\.runConflictOverlay\.addEventListener\("click"/);
  assert.match(orchestratorClarificationDialogScript(), /function lock\(\)/);
  assert.match(orchestratorClarificationDialogScript(), /submitButton\.disabled = true/);
  assert.match(orchestratorClarificationDialogScript(), /rejectButton\.disabled = true/);
  assert.doesNotMatch(orchestratorClarificationDialogScript(), /Escape|backdrop\.addEventListener\("click"/);

  const shell = renderChatModal({
    id: "exampleOverlay",
    className: "example-modal",
    labelledBy: "exampleTitle",
    describedBy: "exampleDescription",
    titleHtml: `<div id="exampleTitle" class="title">Title</div>`,
    close: { id: "closeExample", label: `Close "dialog"`, wrapperClassName: "session-actions" },
    contentHtml: `<div id="exampleBody" class="example-body"></div>`,
    actionsHtml: `<div class="example-actions"><button id="cancelExample">Cancel</button><button id="confirmExample">OK</button></div>`,
  });
  assert.match(shell, /id="exampleOverlay" class="overlay"/);
  assert.match(shell, /class="modal example-modal" role="dialog" aria-modal="true" aria-labelledby="exampleTitle" aria-describedby="exampleDescription"/);
  assert.match(shell, /class="session-actions"[\s\S]*aria-label="Close &quot;dialog&quot;"/);
  assert.match(shell, /id="cancelExample"[\s\S]*id="confirmExample"/);

  const panel = renderPanelDialog({
    backdropId: "sampleBackdrop",
    backdropAttributes: [["data-sample", null], ["aria-hidden", "true"]],
    dialogId: "sampleDialog",
    labelledBy: "sampleTitle",
    describedBy: "sampleDescription",
    wrapTitle: true,
    titleHtml: `<h2 id="sampleTitle" class="dialog-title">Title</h2>`,
    descriptionHtml: `<p id="sampleDescription" class="dialog-description">Details</p>`,
    closeHtml: renderModalCloseButton({ id: "sampleClose", label: "Close", className: "icon-button sample-close" }),
    bodyHtml: `<div class="dialog-body"></div>`,
    actionsHtml: renderModalActions("dialog-actions", `<button id="sampleCancel"></button><button id="sampleConfirm"></button>`),
  });
  assert.match(panel, /id="sampleBackdrop" class="dialog-backdrop" data-sample aria-hidden="true"/);
  assert.match(panel, /id="sampleDialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="sampleTitle" aria-describedby="sampleDescription"/);
  assert.match(panel, /id="sampleClose" class="icon-button sample-close"/);
  assert.match(panel, /class="modal-heading"[\s\S]*id="sampleTitle"[\s\S]*id="sampleDescription"/);
  assert.match(panel, /class="dialog-actions"[\s\S]*id="sampleCancel"[\s\S]*id="sampleConfirm"/);
  assert.match(shell, /class="modal-body"[\s\S]*id="exampleBody"/);
  assert.match(shell, /class="modal-actions example-actions"|class="example-actions"/);
  assert.match(DIALOG_SHELL_STYLES, /max-width:\s*90vw/);
  assert.match(DIALOG_SHELL_STYLES, /max-height:\s*85vh/);
  assert.match(DIALOG_SHELL_STYLES, /padding:\s*16px 16px 12px/);
  assert.match(DIALOG_SHELL_STYLES, /gap:\s*8px/);
  assert.match(CLARIFICATION_DIALOG_STYLES, /max-height:\s*min\(85vh,\s*760px\)/);
});
