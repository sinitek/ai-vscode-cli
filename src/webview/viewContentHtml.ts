import { AppLocale } from "../i18n";
import { WebviewI18nKey } from "./viewContentI18n";

type WebviewHtmlStrings = Record<WebviewI18nKey, string>;

export type BuildWebviewStaticHtmlInput = {
  locale: AppLocale;
  cspSource: string;
  nonce: string;
  i18n: WebviewHtmlStrings;
  cliOptions: string;
  markedScript: string;
  webviewStyles: string;
  loopExecutionModeMainSubMultiAgent: string;
  loopExecutionModeDebateMultiAgent: string;
};

export function buildWebviewStaticHtml(
  input: BuildWebviewStaticHtmlInput,
): string {
  const {
    locale,
    cspSource,
    nonce,
    i18n,
    cliOptions,
    markedScript,
    webviewStyles,
    loopExecutionModeMainSubMultiAgent,
    loopExecutionModeDebateMultiAgent,
  } = input;
  const LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT =
    loopExecutionModeMainSubMultiAgent;
  const LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT =
    loopExecutionModeDebateMultiAgent;

  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${i18n.appTitle}</title>
    <style>
${webviewStyles}    </style>
  </head>
  <body>
    <div class="app">
      <div class="header">
        <div class="title">${i18n.panelTitle}</div>
        <div class="header-actions">
          <label class="chat-filter-toggle" for="resultOnlyToggle" title="${i18n.resultOnlyAria}">
            <input id="resultOnlyToggle" type="checkbox" aria-label="${i18n.resultOnlyAria}" />
            <span>${i18n.resultOnlyLabel}</span>
          </label>
          <svg id="helpButton" class="icon icon-action" role="button" tabindex="0" title="${i18n.headerHelp}" aria-label="${i18n.headerHelp}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.7-2.5 2-2.5 3.8" />
            <path d="M12 16.5h.01" />
          </svg>
          <svg id="toolSettingsButton" class="icon icon-action" role="button" tabindex="0" title="${i18n.headerToolSettings}" aria-label="${i18n.headerToolSettings}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
            <circle cx="9" cy="6" r="2" />
            <circle cx="15" cy="12" r="2" />
            <circle cx="11" cy="18" r="2" />
          </svg>
          <svg id="rulesButton" class="icon icon-action" role="button" tabindex="0" title="${i18n.headerRules}" aria-label="${i18n.headerRules}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
            <path d="M14 3v4h4" />
            <path d="M8 11h8" />
            <path d="M8 15h8" />
          </svg>
          <svg id="newSession" class="icon icon-action" role="button" tabindex="0" title="${i18n.headerNewSession}" aria-label="${i18n.headerNewSession}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <svg id="resetSession" class="icon icon-action" role="button" tabindex="0" title="${i18n.headerResetSession}" aria-label="${i18n.headerResetSession}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 12a8 8 0 1 1-2.34-5.66" />
            <polyline points="20 4 20 10 14 10" />
          </svg>
        </div>
      </div>

      <div id="conversationTabs" class="conversation-tabs" role="tablist" aria-label="${i18n.conversationTabsAria}"></div>


      <div id="chatArea" class="chat-area">
        <div id="emptyState" class="empty-state">${i18n.emptyState}</div>
        <div id="messages" class="messages"></div>
      <div id="runWait" class="run-wait" style="display: none;">
        <span class="typing">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span id="runWaitTime" class="run-wait-time">00:00</span>
        </span>
        <span id="runStatusText" class="run-status-text" style="display: none;"></span>
        <button id="runStreamButton" class="run-stream-button" style="display: none;" aria-label="${i18n.runStreamViewAria}" title="${i18n.runStreamViewAria}">
          ${i18n.runStreamViewLabel}
        </button>
        <span id="runStreamStaleBadge" class="run-stream-stale-badge" style="display: none;"></span>
        <button id="runPromptButton" class="run-prompt-button" style="display: none;" aria-label="${i18n.runPromptViewAria}" title="${i18n.runPromptViewAria}">
          ${i18n.runPromptViewLabel}
        </button>
        <button id="openCurrentLoopGroupChat" class="run-prompt-button" style="display: none;" aria-label="${i18n.openCurrentLoopGroupChatAria}" title="${i18n.openCurrentLoopGroupChatAria}">
          ${i18n.openCurrentLoopGroupChatLabel}
        </button>
        <button id="queueIndicator" class="run-queue-indicator" style="display: none;" aria-label="${i18n.queueIndicatorAria}">
          ${i18n.queueIndicatorLabel}
          <span id="queueCount" class="run-queue-count">0</span>
        </button>
      </div>
        <div id="scrollToBottomWrap" class="scroll-to-bottom-wrap" aria-hidden="true">
          <button id="scrollToBottomButton" class="scroll-to-bottom-button" aria-label="${i18n.scrollToBottomAria}" title="${i18n.scrollToBottomAria}" aria-hidden="true">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="6" x2="12" y2="18" />
              <polyline points="7 13 12 18 17 13" />
            </svg>
          </button>
        </div>
      </div>

      <div id="taskListPanel" class="tasklist-panel" style="display: none;">
        <details id="taskListDetails">
          <summary>
            <span class="tasklist-summary-title">
              <span class="tasklist-toggle-icon" aria-hidden="true"></span>
              <span>${i18n.taskListTitle}</span>
            </span>
            <span id="taskListCount" class="tasklist-count"></span>
          </summary>
          <div id="taskListBody"></div>
        </details>
      </div>

      <div class="input-area">
        <div class="config-select-row">
          <button id="openConfig" class="secondary icon-button" title="${i18n.openConfigButton}" aria-label="${i18n.openConfigButton}">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3.5" />
              <path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.03.03a2 2 0 0 1-2.83 2.83l-.03-.03a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1 1.63V21a2 2 0 0 1-4 0v-.05a1.8 1.8 0 0 0-1-1.63 1.8 1.8 0 0 0-2 .36l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.63-1H3a2 2 0 0 1 0-4h.05a1.8 1.8 0 0 0 1.63-1 1.8 1.8 0 0 0-.36-2l-.03-.03A2 2 0 1 1 7.12 3.9l.03.03a1.8 1.8 0 0 0 2 .36 1.8 1.8 0 0 0 1-1.63V2a2 2 0 0 1 4 0v.05a1.8 1.8 0 0 0 1 1.63 1.8 1.8 0 0 0 2-.36l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.63 1H22a2 2 0 0 1 0 4h-.05a1.8 1.8 0 0 0-1.63 1Z" />
            </svg>
          </button>
          <select id="currentCli" class="cli-select" aria-label="${i18n.cliSelectAria}">${cliOptions}</select>
          <select id="configSelect" class="config-select" aria-label="${i18n.configSelectAria}"></select>
          <select id="interactiveModeSelect" class="interactive-mode-select" aria-label="${i18n.interactiveModeSelectAria}">
            <option value="coding">${i18n.interactiveModeCoding}</option>
            <option value="loop">${i18n.interactiveModeLoop}</option>
          </select>
        </div>
        <div class="input-box">
          <div id="promptContextTags" class="prompt-context-tags" style="display: none;"></div>
          <textarea id="promptInput" rows="3" placeholder="${i18n.promptPlaceholder}"></textarea>
        </div>
        <input id="attachmentInput" class="hidden-input" type="file" multiple />
        <div class="input-footer">
          <div class="input-model-row">
            <div id="openCodeModelGroup" class="open-code-model-group" style="display: none;">
              <label class="open-code-model-row" for="openCodePrimaryModelSelect">
                <span class="open-code-model-label">${i18n.openCodePrimaryModelLabel}</span>
                <select id="openCodePrimaryModelSelect" class="model-select" aria-label="${i18n.openCodePrimaryModelSelectAria}" aria-describedby="openCodeModelIssue" title="${i18n.openCodePrimaryModelSelectAria}"></select>
                <select id="openCodePrimaryThinkingMode" class="thinking-select" aria-label="${i18n.openCodePrimaryThinkingModeAria}" title="${i18n.openCodePrimaryThinkingModeAria}">
                  <option value="off">${i18n.thinkingOptionOff}</option>
                  <option value="low">${i18n.thinkingOptionLow}</option>
                  <option value="medium">${i18n.thinkingOptionMedium}</option>
                  <option value="high">${i18n.thinkingOptionHigh}</option>
                  <option value="xhigh">${i18n.thinkingOptionXHigh}</option>
                  <option value="max">${i18n.thinkingOptionMax}</option>
                  <option value="ultra">${i18n.thinkingOptionUltra}</option>
                </select>
              </label>
              <label class="open-code-model-row" for="openCodeSmallModelSelect">
                <span class="open-code-model-label">${i18n.openCodeSmallModelLabel}</span>
                <select id="openCodeSmallModelSelect" class="model-select" aria-label="${i18n.openCodeSmallModelSelectAria}" aria-describedby="openCodeModelIssue" title="${i18n.openCodeSmallModelSelectAria}"></select>
                <select id="openCodeSmallThinkingMode" class="thinking-select" aria-label="${i18n.openCodeSmallThinkingModeAria}" title="${i18n.openCodeSmallThinkingModeAria}" style="display: none;"></select>
              </label>
              <span id="openCodeModelIssue" class="open-code-model-issue" role="status" aria-live="polite" style="display: none;"></span>
            </div>
            <select id="modelSelect" class="model-select" aria-label="${i18n.modelSelectAria}">
              <option value="">${i18n.modelOptionDefault}</option>
              <option value="__manage__">${i18n.modelOptionManage}</option>
            </select>
            <select id="thinkingMode" class="thinking-select" aria-label="${i18n.thinkingModeAria}" title="${i18n.thinkingModeAria}">
              <option value="off">${i18n.thinkingOptionOff}</option>
              <option value="low">${i18n.thinkingOptionLow}</option>
              <option value="medium">${i18n.thinkingOptionMedium}</option>
              <option value="high">${i18n.thinkingOptionHigh}</option>
              <option value="xhigh">${i18n.thinkingOptionXHigh}</option>
              <option value="max">${i18n.thinkingOptionMax}</option>
              <option value="ultra">${i18n.thinkingOptionUltra}</option>
            </select>
          </div>
          <div class="input-actions">
            <select
              id="loopExecutionModeSelect"
              class="loop-execution-mode-select"
              aria-label="${i18n.loopExecutionModeSelectAria}"
              title="${i18n.loopExecutionModeSelectAria}"
              style="display: none;"
            >
              <option value="${LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}" selected>${i18n.loopExecutionModeOptionMainSubMultiAgent}</option>
              <option value="${LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT}">${i18n.loopExecutionModeOptionDebateMultiAgent}</option>
            </select>
            <svg id="commonCommandButton" class="icon icon-action" role="button" tabindex="0" title="${i18n.commonCommandButton}" aria-label="${i18n.commonCommandButton}" viewBox="0 0 24 24" fill="currentColor">
              <text x="12" y="17" text-anchor="middle" font-size="15.6" font-family="monospace" font-weight="700">&gt;_</text>
            </svg>
            <svg id="pathPickerButton" class="icon icon-action" role="button" tabindex="0" title="${i18n.pathPickerButton}" aria-label="${i18n.pathPickerButton}" viewBox="0 0 24 24" fill="currentColor">
              <text x="12" y="18" text-anchor="middle" font-size="20.4" font-family="monospace" font-weight="700">@</text>
            </svg>
            <svg id="attachmentButton" class="icon icon-action" role="button" tabindex="0" title="${i18n.attachmentButton}" aria-label="${i18n.attachmentButton}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.5l-7.4 7.4a5 5 0 01-7.1-7.1l9.2-9.2a3 3 0 014.2 4.2l-9.2 9.2a1 1 0 01-1.4-1.4l8.5-8.5" />
            </svg>
            <svg id="historyButton" class="icon icon-action" role="button" tabindex="0" title="${i18n.historyButton}" aria-label="${i18n.historyButton}" viewBox="2 2 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 6v4h4" />
              <path d="M5.6 14.5a7.4 7.4 0 1 0 .2-5.7" />
              <path d="M12 8.2v4.2l2.8 1.9" />
            </svg>
            <button id="sendPrompt" class="icon-button send-icon-button" title="${i18n.sendButton}" aria-label="${i18n.sendButton}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
            <button id="stopRun" class="icon-button stop-button" title="${i18n.stopButton}" aria-label="${i18n.stopButton}" disabled style="display: none;">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div id="historyOverlay" class="overlay">
        <div class="modal history-modal">
          <div class="modal-header">
            <div class="title">${i18n.historyTitle}</div>
            <div class="session-actions">
              <button id="closeHistory" class="secondary icon-button" title="${i18n.historyClose}" aria-label="${i18n.historyClose}">
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div class="history-tabs help-tabs" role="tablist" aria-label="${i18n.historyTabsLabel}">
            <button id="historyTabPrompts" class="help-tab" role="tab" aria-selected="false">${i18n.historyTabPrompts}</button>
            <button id="historyTabSessions" class="help-tab active" role="tab" aria-selected="true">${i18n.historyTabSessions}</button>
          </div>
          <div id="historyPanelPrompts" class="history-panel prompts" role="tabpanel">
            <div id="promptHistoryList" class="prompt-list"></div>
          </div>
          <div id="historyPanelSessions" class="history-panel sessions active" role="tabpanel">
            <div id="sessionList" class="session-list"></div>
          </div>
        </div>
      </div>
      <div id="historyMessagesOverlay" class="overlay">
        <div class="modal history-messages-modal">
          <div class="modal-header">
            <div class="history-messages-title">
              <div class="title" id="historyMessagesTitle">${i18n.historySessionMessagesTitle}</div>
              <div id="historyMessagesSubtitle" class="history-messages-subtitle"></div>
            </div>
            <button id="closeHistoryMessages" class="secondary icon-button" title="${i18n.historySessionMessagesClose}" aria-label="${i18n.historySessionMessagesClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="history-messages-body">
            <div class="history-messages-toolbar">
              <div id="historyMessagesStatus" class="history-messages-status"></div>
              <button id="exportHistoryMessages" class="secondary action-button">${i18n.historySessionExportLabel}</button>
            </div>
            <div id="historyMessagesContent" class="history-messages-content history-messages-empty">${i18n.historySessionMessagesEmpty}</div>
          </div>
        </div>
      </div>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>

      <div id="rulesOverlay" class="overlay">
        <div class="modal rules-modal">
          <div class="modal-header">
            <div class="title">${i18n.rulesTitle}</div>
            <div class="session-actions">
              <button id="closeRules" class="secondary icon-button" title="${i18n.rulesClose}" aria-label="${i18n.rulesClose}">
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div class="rules-scope help-tabs" role="tablist" aria-label="${i18n.rulesScopeLabel}">
            <button id="scopeGlobal" class="help-tab active" role="tab" aria-selected="true">${i18n.rulesScopeGlobal}</button>
            <button id="scopeProject" class="help-tab" role="tab" aria-selected="false">${i18n.rulesScopeProject}</button>
          </div>
          <div class="rules-row">
            <select id="rulesLoadCli" class="cli-select" aria-label="${i18n.rulesLoadCliAria}">
              <option value="codex">codex</option>
              <option value="claude">claude</option>
              <option value="opencode">opencode</option>
            </select>
            <button id="loadRules" class="secondary action-button">${i18n.rulesLoadButton}</button>
          </div>
          <div id="rulesPath" class="rules-path"></div>
          <textarea id="rulesInput" class="rules-textarea" rows="10" placeholder="${i18n.rulesInputPlaceholder}"></textarea>
          <div class="rules-row rules-save-row">
            <span>${i18n.rulesSaveLabel}</span>
            <div class="rules-checkboxes" role="group" aria-label="${i18n.rulesSaveGroupLabel}">
              <label id="rulesSaveCodexOption"><input type="checkbox" id="rulesSaveCodex" /> <span id="rulesSaveCodexLabel">codex</span></label>
              <label id="rulesSaveClaudeOption"><input type="checkbox" id="rulesSaveClaude" /> claude</label>
              <label id="rulesSaveOpenCodeOption"><input type="checkbox" id="rulesSaveOpenCode" /> opencode</label>
            </div>
          </div>
          <div class="rules-hint" id="rulesHint"></div>
          <div class="rules-actions">
            <button id="saveRules" class="action-button">${i18n.rulesSaveButton}</button>
          </div>
        </div>
      </div>

      <div id="toolSettingsOverlay" class="overlay">
        <div class="modal tool-settings-modal">
          <div class="modal-header">
            <div class="title">${i18n.toolSettingsTitle}</div>
            <button id="closeToolSettings" class="secondary icon-button" title="${i18n.toolSettingsClose}" aria-label="${i18n.toolSettingsClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="tool-settings-tabs" role="tablist" aria-label="${i18n.toolSettingsTitle}">
            <button id="toolSettingsGlobalTab" class="tool-settings-tab active" type="button" role="tab" aria-selected="true" aria-controls="toolSettingsGlobalPanel">${i18n.toolSettingsGlobalTab}</button>
            <button id="toolSettingsWorkspaceTab" class="tool-settings-tab" type="button" role="tab" aria-selected="false" aria-controls="toolSettingsWorkspacePanel">${i18n.toolSettingsWorkspaceTab}</button>
          </div>
          <div class="tool-settings-body">
            <div id="toolSettingsGlobalPanel" class="tool-settings-panel active" role="tabpanel" aria-labelledby="toolSettingsGlobalTab">
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsDebugLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsDebugTitle}">
                  <input type="checkbox" id="debugMode" />
                  <span>${i18n.toolSettingsDebugToggle}</span>
                </label>
              </div>
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsAutoContextLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsAutoContextTitle}">
                  <input type="checkbox" id="autoAddEditorContextTags" />
                  <span>${i18n.toolSettingsAutoContextToggle}</span>
                </label>
              </div>
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsImplicitSubagentsLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsImplicitSubagentsTitle}">
                  <input type="checkbox" id="multiAgentEnabled" />
                  <span>${i18n.toolSettingsImplicitSubagentsToggle}</span>
                </label>
              </div>
              <div class="tool-settings-note">${i18n.toolSettingsImplicitSubagentsHint}</div>
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsAutoCompactAfterRunLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsAutoCompactAfterRunTitle}">
                  <input type="checkbox" id="autoCompactContextAfterRun" />
                  <span>${i18n.toolSettingsAutoCompactAfterRunToggle}</span>
                </label>
              </div>
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsLoopMaxRoundsLabel}</div>
                <input
                  type="number"
                  id="loopMaxRounds"
                  class="tool-settings-number"
                  min="1"
                  max="100"
                  step="1"
                  title="${i18n.toolSettingsLoopMaxRoundsTitle}"
                  aria-label="${i18n.toolSettingsLoopMaxRoundsLabel}"
                />
              </div>
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsLoopAutoCloseSubtaskTabsLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsLoopAutoCloseSubtaskTabsTitle}">
                  <input type="checkbox" id="loopAutoCloseSubtaskTabs" />
                  <span>${i18n.toolSettingsLoopAutoCloseSubtaskTabsToggle}</span>
                </label>
              </div>
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsLanguageLabel}</div>
                <select id="languageSelect" class="thinking-select" aria-label="${i18n.toolSettingsLanguageAria}">
                  <option value="auto">${i18n.toolSettingsLanguageAuto}</option>
                  <option value="zh-CN">${i18n.toolSettingsLanguageZh}</option>
                  <option value="en">${i18n.toolSettingsLanguageEn}</option>
                </select>
              </div>
              <div id="macTaskShellRow" class="tool-settings-row" style="display: none;">
                <div class="tool-settings-label">${i18n.toolSettingsMacShellLabel}</div>
                <select id="macTaskShell" class="thinking-select" aria-label="${i18n.toolSettingsMacShellAria}">
                  <option value="zsh">${i18n.toolSettingsMacShellZsh}</option>
                  <option value="bash">${i18n.toolSettingsMacShellBash}</option>
                </select>
              </div>
            </div>
            <div id="toolSettingsWorkspacePanel" class="tool-settings-panel" role="tabpanel" aria-labelledby="toolSettingsWorkspaceTab">
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsLongTermMemoryLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsLongTermMemoryTitle}">
                  <input type="checkbox" id="longTermMemoryEnabled" />
                  <span>${i18n.toolSettingsLongTermMemoryToggle}</span>
                </label>
              </div>
              <div id="longTermMemoryNote" class="tool-settings-note">${i18n.toolSettingsLongTermMemoryHint}</div>
            </div>
          </div>
        </div>
      </div>

      <div id="commonCommandsOverlay" class="overlay">
        <div class="modal common-commands-modal">
          <div class="modal-header">
            <div class="title">${i18n.commonCommandsTitle}</div>
            <button id="closeCommonCommands" class="secondary icon-button" title="${i18n.commonCommandsClose}" aria-label="${i18n.commonCommandsClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="common-commands-body">
            <div class="common-command-list">
              <button id="commandCompact" class="action-button common-command-button">
                <span>${i18n.commonCommandCompactTitle}</span>
                <span class="common-command-desc">${i18n.commonCommandCompactDesc}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div id="addModelOverlay" class="overlay">
        <div class="modal add-model-modal">
          <div class="modal-header">
            <div class="title">${i18n.modelAddTitle}</div>
            <button id="closeAddModel" class="secondary icon-button" title="${i18n.rulesClose}" aria-label="${i18n.rulesClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="add-model-body">
            <div id="modelManagerList" class="model-manager-list"></div>
            <div class="add-model-row">
              <label for="modelInput">${i18n.modelAddLabel}</label>
              <input id="modelInput" type="text" class="model-input" placeholder="${i18n.modelAddPlaceholder}" />
              <div id="modelEditHint" class="model-edit-hint" style="display: none;"></div>
            </div>
            <div id="modelAddError" class="add-model-error" style="display: none;"></div>
          </div>
          <div class="add-model-actions">
            <button id="cancelAddModel" class="secondary action-button">${i18n.historyClose}</button>
            <button id="clearModelEdit" class="secondary action-button" style="display: none;">${i18n.modelManageCancelEdit}</button>
            <button id="confirmAddModel" class="action-button">${i18n.modelAddButton}</button>
          </div>
        </div>
      </div>

      <div id="runConflictOverlay" class="overlay">
        <div class="modal run-conflict-modal">
          <div class="modal-header">
            <div class="title">${i18n.runConflictTitle}</div>
            <button id="closeRunConflict" class="secondary icon-button" title="${i18n.runConflictClose}" aria-label="${i18n.runConflictClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="run-conflict-body">
            <div>${i18n.runConflictBody}</div>
            <div class="run-conflict-desc">${i18n.runConflictDesc}</div>
            <div id="runConflictPrompt" class="run-conflict-preview"></div>
          </div>
          <div class="run-conflict-actions">
            <button id="queuePrompt" class="secondary action-button">${i18n.runConflictQueueButton}</button>
            <button id="pauseAndSend" class="action-button">${i18n.runConflictPauseButton}</button>
          </div>
        </div>
      </div>

      <div id="queueOverlay" class="overlay">
        <div class="modal queue-modal">
          <div class="modal-header">
            <div class="title">${i18n.queueTitle}</div>
            <button id="closeQueue" class="secondary icon-button" title="${i18n.queueCloseLabel}" aria-label="${i18n.queueCloseLabel}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div id="queueBody" class="queue-body"></div>
          <div class="queue-footer">
            <button id="continueQueue" class="action-button">${i18n.queueContinueLabel}</button>
          </div>
        </div>
      </div>

      <div id="runPromptOverlay" class="overlay">
        <div class="modal run-prompt-modal">
          <div class="modal-header">
            <div class="title">${i18n.runPromptTitle}</div>
            <button id="closeRunPrompt" class="secondary icon-button" title="${i18n.runPromptClose}" aria-label="${i18n.runPromptClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="run-prompt-body">
            <div id="runPromptContent" class="run-prompt-preview"></div>
          </div>
        </div>
      </div>

      <div id="runStreamOverlay" class="overlay">
        <div class="modal run-stream-modal">
          <div class="modal-header">
            <div class="title">${i18n.runStreamTitle}</div>
            <button id="closeRunStream" class="secondary icon-button" title="${i18n.runStreamClose}" aria-label="${i18n.runStreamClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="run-stream-body">
            <div class="run-stream-toolbar">
              <button id="exportRunStream" class="secondary action-button" title="${i18n.runStreamExportAria}" aria-label="${i18n.runStreamExportAria}">${i18n.runStreamExportLabel}</button>
            </div>
            <div id="runStreamContent" class="run-stream-preview run-stream-empty">${i18n.runStreamEmpty}</div>
          </div>
        </div>
      </div>

      <div id="configApplyErrorOverlay" class="overlay">
        <div class="modal config-error-modal">
          <div class="modal-header">
            <div class="title">${i18n.configApplyErrorTitle}</div>
            <button id="closeConfigApplyError" class="secondary icon-button" title="${i18n.configApplyErrorClose}" aria-label="${i18n.configApplyErrorClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="config-error-body">
            <pre id="configApplyErrorContent" class="config-error-detail"></pre>
            <div class="config-error-actions">
              <button id="copyConfigApplyError" class="secondary action-button">${i18n.configApplyErrorCopy}</button>
            </div>
          </div>
        </div>
      </div>

      <div id="helpOverlay" class="overlay">
        <div class="modal help-modal">
          <div class="modal-header">
            <div class="title">${i18n.helpTitle}</div>
            <div class="session-actions">
              <button id="closeHelp" class="secondary icon-button" title="${i18n.helpClose}" aria-label="${i18n.helpClose}">
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div class="help-tabs" role="tablist" aria-label="${i18n.helpTabsLabel}">
            <button id="helpTabInstall" class="help-tab active" role="tab" aria-selected="true">${i18n.helpTabInstall}</button>
            <button id="helpTabThinking" class="help-tab" role="tab" aria-selected="false">${i18n.helpTabThinking}</button>
          </div>
          <div id="helpPanelInstall" class="help-panel active" role="tabpanel">
            <div class="help-section">
              <h4>${i18n.helpInstallWindows}</h4>
              <ul>
                <li>Codex：<code>npm i -g @openai/codex</code></li>
                <li>Claude：<code>npm install -g @anthropic-ai/claude-code</code></li>
                <li>OpenCode：<code>npm install -g opencode-ai</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpInstallMac}</h4>
              <ul>
                <li>Codex：<code>npm i -g @openai/codex</code></li>
                <li>Claude：<code>npm install -g @anthropic-ai/claude-code</code></li>
                <li>OpenCode：<code>npm install -g opencode-ai</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpInstallAccel}</h4>
              <ul>
                <li>${i18n.helpInstallAccelOnce}<code>npm --registry https://registry.npmmirror.com -i -g @openai/codex</code></li>
                <li>${i18n.helpInstallAccelSet}<code>npm config set registry https://registry.npmmirror.com</code></li>
                <li>${i18n.helpInstallAccelReset}<code>npm config set registry https://registry.npmjs.org</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpRemoveEnvTitle}</h4>
              <ul>
                <li>${i18n.helpRemoveEnvItem1}</li>
                <li>${i18n.helpRemoveEnvItemMac}</li>
                <li>${i18n.helpRemoveEnvItemWin}</li>
              </ul>
            </div>
          </div>
          <div id="helpPanelThinking" class="help-panel" role="tabpanel">
            <div class="help-section">
              <h4>${i18n.helpThinkingGeneralTitle}</h4>
              <ul>
                <li>${i18n.helpThinkingGeneralItem}</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpThinkingCodexTitle}</h4>
              <ul>
                <li>${i18n.helpThinkingCodexItem1}</li>
                <li>${i18n.helpThinkingCodexItem2}</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpThinkingOpenCodeTitle}</h4>
              <ul>
                <li>${i18n.helpThinkingOpenCodeItem1}</li>
                <li>${i18n.helpThinkingOpenCodeItem2}</li>
                <li>${i18n.helpThinkingOpenCodeItem3}</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpThinkingClaudeTitle}</h4>
              <ul>
                <li>${i18n.helpThinkingClaudeItem1}</li>
                <li>${i18n.helpThinkingClaudeItem2}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

    </div>

    <script nonce="${nonce}">
      ${markedScript}
    </script>
    <script nonce="${nonce}">`;
}
