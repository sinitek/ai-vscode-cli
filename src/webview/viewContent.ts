import { CLI_LIST } from "../cli/types";
import { logError } from "../logger";
import { readFileSync } from "fs";
import * as path from "path";

let cachedMarkedScript: string | undefined;

export function getWebviewHtml(webview: { cspSource: string }): string {
  const nonce = getNonce();
  const cliOptions = CLI_LIST.map((cli) => `<option value="${cli}">${cli}</option>`).join("");
  const markedScript = getMarkedScript();

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>携宁 CLI 配置</title>
    <style>
      :root {
        --radius-sm: 4px;
        --radius-md: 8px;
        --radius-lg: 12px;
        --gap-sm: 8px;
        --gap-md: 16px;
      }
      body {
        font-family: var(--vscode-font-family);
        font-size: 14px;
        line-height: 1.5;
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
      .app {
        display: flex;
        flex-direction: column;
        height: calc(var(--app-height, 100vh));
        box-sizing: border-box;
      }
      
      /* Header - Minimalist */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        border-bottom: 1px solid var(--vscode-widget-border);
        background: var(--vscode-editor-background);
        min-height: 36px;
      }
      .title {
        font-weight: 600;
        font-size: 13px;
        opacity: 0.9;
      }
      .header-actions {
        display: flex;
        gap: 6px;
      }
      .icon-button {
        background: transparent;
        border: none;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.8;
        transition: all 0.2s;
      }
      .icon-button:hover {
        background: var(--vscode-toolbar-hoverBackground);
        opacity: 1;
      }
      .icon {
        width: 16px;
        height: 16px;
      }
      #commonCommandButton span {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--vscode-editor-font-family);
        font-size: 13px;
        font-weight: 600;
        line-height: 16px;
      }
      #pathPickerButton span {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 600;
        line-height: 16px;
      }
      
      /* Chat Area */
      .chat-area {
        flex: 1;
        overflow-y: auto;
        padding: 20px 16px;
        background: var(--vscode-editor-background);
        min-height: 0;
        box-sizing: border-box;
      }
      .messages {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 100%;
        padding-bottom: 10px;
      }
      
      /* Message Blocks */
      .message {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-width: 100%;
        min-width: 0;
      }
      .message .bubble {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      /* User Message - Distinct Bubble */
      .message.user {
        align-items: flex-end;
      }
      .message.user .message-time {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        opacity: 0.7;
        margin-bottom: 4px;
      }
      .message.user .bubble {
        background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
        color: var(--vscode-button-secondaryForeground);
        padding: 10px 14px;
        border-radius: 16px 16px 4px 16px;
        max-width: 85%;
        box-sizing: border-box;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        white-space: pre-wrap;
      }

      /* Assistant Message - Clean, width-filling */
      .message.assistant {
        align-items: flex-start;
      }
      .message.assistant .bubble {
        background: transparent;
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius-md);
        padding: 12px;
        max-width: 100%;
        width: 100%;
        box-sizing: border-box;
      }
      
      /* Markdown Styles */
      .message.assistant .bubble p {
        margin: 0 0 8px 0;
        line-height: 1.6;
      }
      .message.assistant .bubble p:last-child {
        margin-bottom: 0;
      }
      .message.assistant .bubble pre {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius-md);
        padding: 12px;
        overflow-x: auto;
        margin: 12px 0;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        box-sizing: border-box;
        max-width: 100%;
        overflow-wrap: normal;
        word-break: normal;
      }
      .message.assistant .bubble code {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 5px;
        border-radius: 4px;
        color: var(--vscode-textPreformat-foreground);
      }
      .message.assistant .bubble pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }
      .message.assistant .bubble ul, .message.assistant .bubble ol {
        margin: 8px 0;
        padding-left: 24px;
      }
      .message.assistant .bubble li {
        margin-bottom: 4px;
      }
      .message.assistant .bubble blockquote {
        border-left: 3px solid var(--vscode-textBlockQuote-border);
        background: var(--vscode-textBlockQuote-background);
        margin: 8px 0;
        padding: 8px 12px;
      }

      /* System & Trace Messages */
      .message.system {
        align-self: center;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin: 8px 0;
        width: 100%;
      }
      .message.system .bubble {
        background: transparent;
        color: var(--vscode-descriptionForeground);
        padding: 4px 0;
        border-radius: 0;
        font-size: 12px;
        width: 100%;
        box-sizing: border-box;
      }
      .message.system .system-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .message.system .system-time {
        font-size: 11px;
        opacity: 0.6;
        white-space: nowrap;
      }
      
      .message.trace {
        font-size: 12px;
      }
      .message.trace .bubble {
        font-family: var(--vscode-editor-font-family);
        background: var(--vscode-editor-inactiveSelectionBackground);
        color: var(--vscode-editor-foreground);
        padding: 8px 12px;
        border-radius: var(--radius-md);
        white-space: pre-wrap;
        border-left: 3px solid var(--trace-accent, var(--vscode-minimap-findMatchHighlight));
        --trace-title-fg: var(--vscode-badge-foreground);
        --trace-title-bg: var(--vscode-badge-background);
        --trace-title-border: transparent;
        box-sizing: border-box;
      }
      .message.trace.trace-type-exec .bubble {
        --trace-accent: var(
          --vscode-notificationsWarningIcon-foreground,
          var(
            --vscode-editorWarning-foreground,
            var(
              --vscode-charts-orange,
              var(--vscode-editorWarning-border, var(--vscode-minimap-findMatchHighlight)))
          )
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-git-update .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-modifiedResourceForeground,
          var(--vscode-charts-blue, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-modifiedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-file-update .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-addedResourceForeground,
          var(--vscode-charts-green, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-apply-patch .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-stageModifiedResourceForeground,
          var(--vscode-charts-purple, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-editor-selectionHighlightBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-0 .bubble {
        --trace-accent: var(
          --vscode-notificationsWarningIcon-foreground,
          var(
            --vscode-editorWarning-foreground,
            var(
              --vscode-charts-orange,
              var(--vscode-editorWarning-border, var(--vscode-minimap-findMatchHighlight)))
          )
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-1 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-modifiedResourceForeground,
          var(--vscode-charts-blue, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-modifiedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-2 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-addedResourceForeground,
          var(--vscode-charts-green, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-3 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-stageModifiedResourceForeground,
          var(--vscode-charts-purple, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-editor-selectionHighlightBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-0 .trace-title,
      .message.trace.trace-type-tool-use-1 .trace-title,
      .message.trace.trace-type-tool-use-2 .trace-title,
      .message.trace.trace-type-tool-use-3 .trace-title {
        text-transform: none;
      }
      .message.trace.trace-type-tool-result .bubble {
        --trace-accent: var(
          --vscode-charts-green,
          var(--vscode-terminal-ansiGreen, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-warning .bubble {
        --trace-accent: var(
          --vscode-editorWarning-foreground,
          var(--vscode-notificationsWarningIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-warningBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-error .bubble {
        --trace-accent: var(
          --vscode-editorError-foreground,
          var(--vscode-notificationsErrorIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-errorBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-thinking .bubble {
        --trace-accent: var(
          --vscode-editorInfo-foreground,
          var(--vscode-notificationsInfoIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-infoBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-web-search .bubble {
        --trace-accent: var(
          --vscode-terminal-ansiMagenta,
          var(--vscode-charts-purple, #b48ead)
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: rgba(180, 142, 173, 0.15);
        --trace-title-border: var(--trace-accent);
      }
      .trace-header {
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 6px;
      }
      .trace-title {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.3px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--trace-title-bg, var(--vscode-badge-background));
        color: var(--trace-title-fg, var(--vscode-badge-foreground));
        border: 1px solid var(--trace-title-border, transparent);
        text-transform: uppercase;
      }
      .trace-detail {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family);
        width: 100%;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        text-align: left;
      }
      .trace-time {
        margin-top: 6px;
        font-size: 11px;
        opacity: 0.7;
        text-align: left;
        font-variant-numeric: tabular-nums;
      }
      .message.trace.trace-nonthinking .bubble {
        opacity: 1;
      }
      .trace-content {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .trace-line {
        white-space: pre-wrap;
      }
      .trace-line.line-numbered {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        color: var(--vscode-textPreformat-foreground);
        padding: 2px 6px;
        font-family: var(--vscode-editor-font-family);
      }
      .trace-line.diff-added {
        color: var(
          --vscode-diffEditor-insertedTextForeground,
          var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-terminal-ansiGreen, var(--vscode-charts-green)))
        );
      }
      .trace-line.diff-removed {
        color: var(
          --vscode-diffEditor-removedTextForeground,
          var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-terminal-ansiRed, var(--vscode-charts-red)))
        );
      }

      /* Typing Indicator */
      .run-wait {
        padding-left: 4px;
        align-items: center;
        gap: 8px;
      }
      .typing {
        display: inline-flex;
        gap: 4px;
        padding: 8px 12px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: 12px;
        align-items: center;
      }
      .typing-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--vscode-descriptionForeground);
        animation: typingPulse 1.4s infinite ease-in-out both;
      }
      .run-wait-time {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-variant-numeric: tabular-nums;
      }
      .typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .typing-dot:nth-child(2) { animation-delay: -0.16s; }
      @keyframes typingPulse {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
      }

      /* Empty State */
      .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        opacity: 0.7;
        padding-bottom: 40px;
      }

      /* Input Area */
      .input-area {
        padding: 16px;
        background: var(--vscode-editor-background);
      }
      
      /* Controls Row (CLI, Config) */
      .config-select-row {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
        align-items: center;
      }
      
      select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 4px;
        padding: 4px 8px;
        height: 28px;
        outline: none;
        font-size: 12px;
        cursor: pointer;
      }
      select:hover {
        border-color: var(--vscode-focusBorder);
      }
      
      .cli-select { min-width: 100px; }
      .config-select { flex: 1; }

      /* Input Box Container */
      .input-box {
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 0.2s, box-shadow 0.2s;
        position: relative;
      }
      .input-box:focus-within {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      
      .input-box textarea {
        background: transparent;
        border: none;
        color: var(--vscode-input-foreground);
        font-family: inherit;
        font-size: 13px;
        line-height: 1.5;
        resize: none;
        outline: none;
        width: 100%;
        height: calc(1.5em * 3);
        max-height: calc(1.5em * 3);
        overflow-y: auto;
        padding: 0;
      }
      
      .input-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 12px;
      }
      
      .input-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        justify-content: flex-end;
      }
      .debug-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--vscode-foreground);
        cursor: pointer;
        user-select: none;
        height: 26px;
      }
      .debug-toggle input {
        margin: 0;
      }

      .fixed-width-button {
        width: 60px;
        flex: 0 0 auto;
      }

      .icon-action-button {
        width: 40px;
        padding: 0;
        flex: 0 0 auto;
        height: 32px;
      }
      .icon-action-button .icon {
        width: 22px;
        height: 22px;
      }

      /* Buttons */
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        border-radius: 4px;
        border: 1px solid transparent;
        transition: all 0.2s;
        height: 26px;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      button:disabled:hover {
        background: inherit;
      }
      
      .action-button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        padding: 0 12px;
        font-weight: 500;
      }
      .action-button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .action-button:disabled {
        color: var(--vscode-disabledForeground);
      }
      
      .secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border-color: transparent;
        padding: 0 10px;
      }
      .secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      .secondary:disabled {
        color: var(--vscode-disabledForeground);
      }
      
      .stop-button {
        background: var(--vscode-errorForeground);
        color: var(--vscode-button-foreground);
        padding: 0 12px;
      }
      
      .ghost {
        background: transparent;
        color: var(--vscode-descriptionForeground);
      }
      .ghost:hover {
        color: var(--vscode-foreground);
        background: var(--vscode-toolbar-hoverBackground);
      }

      /* Helper Classes */
      .hidden-input { display: none; }
      
      /* Overlays / Modals */
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 100;
      }
      .overlay.visible { display: flex; animation: fadeIn 0.2s; }
      
      .modal {
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-widget-border);
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        border-radius: 12px;
        width: 500px;
        max-width: 90vw;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .run-conflict-modal {
        width: 420px;
      }
      .run-conflict-body {
        padding: 0 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .run-conflict-desc {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .run-conflict-preview {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 8px;
        font-size: 12px;
        color: var(--vscode-foreground);
        max-height: 120px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .run-conflict-actions {
        padding: 0 16px 16px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .run-queue-indicator {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        font-size: 12px;
        cursor: pointer;
      }
      .run-queue-indicator:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
      .run-queue-count {
        color: var(--vscode-descriptionForeground);
      }
      .queue-modal {
        width: 520px;
      }
      .queue-body {
        padding: 12px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .queue-empty {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .queue-item {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 10px;
        background: var(--vscode-editor-background);
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .queue-text {
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .queue-actions {
        display: flex;
        align-items: center;
      }
      
      .modal-header {
        padding: 16px;
        border-bottom: 1px solid var(--vscode-widget-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .rules-modal .modal-header {
        padding: 10px 16px;
      }

      .help-modal {
        height: 600px;
      }
      
      .session-list, .help-panel, .rules-modal {
        padding: 16px;
        overflow-y: auto;
      }

      .history-tabs {
        display: flex;
        gap: 12px;
        padding: 0 16px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .history-panel {
        display: none;
        flex: 1;
        min-height: 0;
      }
      .history-panel.active {
        display: flex;
        flex-direction: column;
      }
      .history-panel.prompts {
        padding: 16px;
        overflow-y: auto;
      }
      .history-panel.sessions {
        overflow: hidden;
      }

      .rules-modal {
        padding: 0 0 16px;
        gap: 12px;
      }
      .rules-modal > :not(.modal-header) {
        margin: 0 16px;
      }
      .rules-scope {
        display: flex;
        gap: 12px;
      }
      .rules-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rules-row .cli-select {
        flex: 1;
      }
      .rules-path {
        font-size: 12px;
        opacity: 0.7;
      }

      .help-panel {
        display: none;
        flex: 1;
        min-height: 0;
      }
      .help-panel.active {
        display: block;
      }
      
      .session-item {
        padding: 10px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--vscode-editor-background);
      }
      .session-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .session-label {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .session-subtitle {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .session-item:hover {
        border-color: var(--vscode-focusBorder);
      }

      .prompt-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .prompt-item {
        padding: 10px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        background: var(--vscode-editor-background);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .prompt-item:hover {
        border-color: var(--vscode-focusBorder);
      }
      .prompt-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }
      .prompt-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .prompt-preview {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }
      .prompt-meta {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .prompt-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .prompt-full {
        display: none;
        white-space: pre-wrap;
        border-top: 1px dashed var(--vscode-widget-border);
        padding-top: 8px;
        color: var(--vscode-editor-foreground);
      }
      .prompt-item.expanded .prompt-full {
        display: block;
      }
      
      /* Toast */
      .toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: var(--vscode-notifications-background);
        color: var(--vscode-notifications-foreground);
        padding: 10px 16px;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 200;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.3s;
        pointer-events: none;
      }
      .toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
      
      /* Misc for Rules/Help */
      .rules-textarea {
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        padding: 10px;
        border-radius: 6px;
        box-sizing: border-box;
        line-height: 1.5;
        height: calc(1.5em * 10);
        max-height: calc(1.5em * 10);
        overflow-y: auto;
        resize: none;
      }
      .rules-save-row {
        align-items: flex-start;
        gap: 12px;
      }
      .rules-checkboxes {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .rules-actions {
        display: flex;
        justify-content: flex-end;
      }
      .help-tab {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--vscode-foreground);
      }
      .help-tab.active {
        border-bottom: 2px solid var(--vscode-focusBorder);
        border-radius: 0;
        background: transparent;
        color: var(--vscode-foreground);
      }
      .help-tabs {
        padding: 0 16px;
      }

      .tool-settings-modal {
        width: 420px;
      }
      .tool-settings-body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .tool-settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .tool-settings-label {
        font-size: 12px;
        color: var(--vscode-foreground);
      }

      .common-commands-modal {
        width: 360px;
      }
      .common-commands-body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .common-command-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .common-command-button {
        width: 100%;
        justify-content: space-between;
      }
      .common-command-desc {
        font-size: 11px;
        opacity: 0.7;
      }

      /* Tasklist Panel */
      .tasklist-panel {
        padding: 8px 16px 12px;
        border-top: 1px solid var(--vscode-widget-border);
        background: var(--vscode-editor-background);
      }
      .tasklist-panel details {
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius-md);
        padding: 8px 12px;
        background: var(--vscode-editorWidget-background);
      }
      .tasklist-panel summary {
        cursor: pointer;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        list-style: none;
      }
      .tasklist-panel summary::-webkit-details-marker {
        display: none;
      }
      .tasklist-count {
        font-size: 12px;
        opacity: 0.7;
      }
      .tasklist-items {
        list-style: none;
        padding: 8px 0 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tasklist-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 13px;
      }
      .tasklist-checkbox {
        margin-top: 2px;
        appearance: none;
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border: 1px solid var(--vscode-checkbox-border);
        border-radius: 3px;
        background: var(--vscode-checkbox-background);
        position: relative;
        flex-shrink: 0;
      }
      .tasklist-checkbox:checked {
        background: var(--vscode-gitDecoration-addedResourceForeground);
        border-color: var(--vscode-gitDecoration-addedResourceForeground);
      }
      .tasklist-checkbox:checked::after {
        content: "";
        position: absolute;
        left: 4px;
        top: 1px;
        width: 4px;
        height: 8px;
        border: solid var(--vscode-checkbox-foreground);
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
    </style>
  </head>
  <body>
    <div class="app">
      <div class="header">
        <div class="title">AI 对话</div>
        <div class="header-actions">
          <button id="helpButton" class="secondary icon-button" title="使用说明" aria-label="使用说明">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.7-2.5 2-2.5 3.8" />
              <path d="M12 16.5h.01" />
            </svg>
          </button>
          <button id="toolSettingsButton" class="secondary icon-button" title="工具设置" aria-label="工具设置">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="9" cy="6" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="11" cy="18" r="2" />
            </svg>
          </button>
          <button id="rulesButton" class="secondary icon-button" title="规则配置" aria-label="规则配置">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
              <path d="M14 3v4h4" />
              <path d="M8 11h8" />
              <path d="M8 15h8" />
            </svg>
          </button>
          <button id="newSession" class="secondary icon-button" title="新建会话" aria-label="新建会话">＋</button>
        </div>
      </div>

      <div id="chatArea" class="chat-area">
        <div id="emptyState" class="empty-state">输入需求，开始对话。</div>
        <div id="messages" class="messages"></div>
      <div id="runWait" class="run-wait" style="display: none;">
        <span class="typing">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </span>
        <span id="runWaitTime" class="run-wait-time">00:00</span>
        <button id="queueIndicator" class="run-queue-indicator" style="display: none;" aria-label="查看队列">
          队列
          <span id="queueCount" class="run-queue-count">0</span>
        </button>
      </div>
      </div>

      <div id="taskListPanel" class="tasklist-panel" style="display: none;">
        <details id="taskListDetails">
          <summary>
            <span>任务列表</span>
            <span id="taskListCount" class="tasklist-count"></span>
          </summary>
          <div id="taskListBody"></div>
        </details>
      </div>

      <div class="input-area">
        <div class="config-select-row">
          <select id="currentCli" class="cli-select" aria-label="CLI 选择">${cliOptions}</select>
          <select id="configSelect" class="config-select" aria-label="配置选择"></select>
          <button id="openConfig" class="secondary action-button" title="配置">配置</button>
        </div>
        <div class="input-box">
          <textarea id="promptInput" rows="3" placeholder="Shift + Enter 换行，输入 @ 选择文件/目录，支持附件黏贴..."></textarea>
        </div>
        <input id="attachmentInput" class="hidden-input" type="file" multiple />
        <div class="input-footer">
          <div class="input-actions">
            <button id="commonCommandButton" class="secondary icon-button" title="常用指令" aria-label="常用指令">
              <span>&gt;_</span>
            </button>
            <button id="pathPickerButton" class="secondary icon-button" title="插入路径" aria-label="插入路径">
              <span>@</span>
            </button>
            <button id="attachmentButton" class="secondary icon-button" title="上传附件" aria-label="上传附件">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.5l-7.4 7.4a5 5 0 01-7.1-7.1l9.2-9.2a3 3 0 014.2 4.2l-9.2 9.2a1 1 0 01-1.4-1.4l8.5-8.5" />
              </svg>
            </button>
             <select id="thinkingMode" class="thinking-select" aria-label="思考模式">
               <option value="off">思考：关闭</option>
               <option value="low">思考：低</option>
               <option value="medium">思考：中</option>
               <option value="high">思考：高</option>
             </select>
             <button id="historyButton" class="secondary action-button icon-action-button" title="历史会话" aria-label="历史会话">
               <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M3 12a9 9 0 1 0 3-6.7" />
                 <path d="M3 5v4h4" />
                 <path d="M12 7v5l3 3" />
               </svg>
             </button>
             <button id="sendPrompt" class="action-button icon-action-button" title="发送" aria-label="发送">
               <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M22 2L11 13" />
                 <path d="M22 2L15 22L11 13L2 9L22 2Z" />
               </svg>
             </button>
             <button id="stopRun" class="action-button stop-button icon-action-button" title="停止" aria-label="停止" disabled style="display: none;">
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
            <div class="title">历史记录</div>
            <div class="session-actions">
              <button id="clearAllHistory" class="ghost">清空会话</button>
              <button id="closeHistory" class="secondary">关闭</button>
            </div>
          </div>
          <div class="history-tabs help-tabs" role="tablist" aria-label="历史记录">
            <button id="historyTabPrompts" class="help-tab" role="tab" aria-selected="false">历史提示词</button>
            <button id="historyTabSessions" class="help-tab active" role="tab" aria-selected="true">历史会话</button>
          </div>
          <div id="historyPanelPrompts" class="history-panel prompts" role="tabpanel">
            <div id="promptHistoryList" class="prompt-list"></div>
          </div>
          <div id="historyPanelSessions" class="history-panel sessions active" role="tabpanel">
            <div id="sessionList" class="session-list"></div>
          </div>
        </div>
      </div>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>

      <div id="rulesOverlay" class="overlay">
        <div class="modal rules-modal">
          <div class="modal-header">
            <div class="title">规则</div>
            <div class="session-actions">
              <button id="closeRules" class="secondary">关闭</button>
            </div>
          </div>
          <div class="rules-scope help-tabs" role="tablist" aria-label="规则范围">
            <button id="scopeGlobal" class="help-tab active" role="tab" aria-selected="true">全局规则</button>
            <button id="scopeProject" class="help-tab" role="tab" aria-selected="false">项目规则</button>
          </div>
          <div class="rules-row">
            <select id="rulesLoadCli" class="cli-select" aria-label="加载 CLI">
              <option value="codex">codex</option>
              <option value="claude">claude</option>
              <option value="gemini">gemini</option>
            </select>
            <button id="loadRules" class="secondary action-button">加载</button>
          </div>
          <div id="rulesPath" class="rules-path"></div>
          <textarea id="rulesInput" class="rules-textarea" rows="10" placeholder="输入规则内容..."></textarea>
          <div class="rules-row rules-save-row">
            <span>保存覆盖到：</span>
            <div class="rules-checkboxes" role="group" aria-label="保存覆盖到">
              <label><input type="checkbox" id="rulesSaveCodex" /> codex</label>
              <label><input type="checkbox" id="rulesSaveClaude" /> claude</label>
              <label><input type="checkbox" id="rulesSaveGemini" /> gemini</label>
            </div>
          </div>
          <div class="rules-hint" id="rulesHint"></div>
          <div class="rules-actions">
            <button id="saveRules" class="action-button">保存</button>
          </div>
        </div>
      </div>

      <div id="toolSettingsOverlay" class="overlay">
        <div class="modal tool-settings-modal">
          <div class="modal-header">
            <div class="title">工具设置</div>
            <button id="closeToolSettings" class="secondary">关闭</button>
          </div>
          <div class="tool-settings-body">
            <div id="interactiveRow" class="tool-settings-row">
              <div class="tool-settings-label">交互</div>
              <select id="interactiveMode" class="thinking-select" aria-label="交互模式">
                <option value="on">开启(Beta)</option>
                <option value="off">关闭</option>
              </select>
            </div>
            <div class="tool-settings-row">
              <div class="tool-settings-label">调试</div>
              <label class="debug-toggle" title="调试日志">
                <input type="checkbox" id="debugMode" />
                <span>开启</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div id="commonCommandsOverlay" class="overlay">
        <div class="modal common-commands-modal">
          <div class="modal-header">
            <div class="title">常用指令</div>
            <button id="closeCommonCommands" class="secondary">关闭</button>
          </div>
          <div class="common-commands-body">
            <div class="common-command-list">
              <button id="commandCompact" class="action-button common-command-button">
                <span>压缩上下文</span>
                <span class="common-command-desc">压缩后下一个任务节省 token 数消耗</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div id="runConflictOverlay" class="overlay">
        <div class="modal run-conflict-modal">
          <div class="modal-header">
            <div class="title">任务执行中</div>
            <button id="closeRunConflict" class="secondary">关闭</button>
          </div>
          <div class="run-conflict-body">
            <div>检测到当前任务仍在执行，要如何处理这条消息？</div>
            <div class="run-conflict-desc">选择“暂停并发送”将终止当前任务并立即发送。</div>
            <div id="runConflictPrompt" class="run-conflict-preview"></div>
          </div>
          <div class="run-conflict-actions">
            <button id="queuePrompt" class="secondary action-button">加入队列</button>
            <button id="pauseAndSend" class="action-button">暂停并发送</button>
          </div>
        </div>
      </div>

      <div id="queueOverlay" class="overlay">
        <div class="modal queue-modal">
          <div class="modal-header">
            <div class="title">队列提示词</div>
            <button id="closeQueue" class="secondary">关闭</button>
          </div>
          <div id="queueBody" class="queue-body"></div>
        </div>
      </div>

      <div id="helpOverlay" class="overlay">
        <div class="modal help-modal">
          <div class="modal-header">
            <div class="title">使用说明</div>
            <div class="session-actions">
              <button id="closeHelp" class="secondary">关闭</button>
            </div>
          </div>
          <div class="help-tabs" role="tablist" aria-label="使用说明">
            <button id="helpTabInstall" class="help-tab active" role="tab" aria-selected="true">安装</button>
            <button id="helpTabThinking" class="help-tab" role="tab" aria-selected="false">思考模式</button>
          </div>
          <div id="helpPanelInstall" class="help-panel active" role="tabpanel">
            <div class="help-section">
              <h4>Windows 安装</h4>
              <ul>
                <li>Codex：<code>npm i -g @openai/codex</code></li>
                <li>Claude：<code>npm -i -g @anthropic-ai/claude-code</code></li>
                <li>Gemini：<code>npm -i -g @google/gemini-cli</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>macOS 安装</h4>
              <ul>
                <li>Codex：<code>npm i -g @openai/codex</code></li>
                <li>Claude：<code>npm -i -g @anthropic-ai/claude-code</code></li>
                <li>Gemini：<code>npm -i -g @google/gemini-cli</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>安装加速（也许有效）</h4>
              <ul>
                <li>一次性加速：<code>npm --registry https://registry.npmmirror.com -i -g @openai/codex</code></li>
                <li>设置全局镜像：<code>npm config set registry https://registry.npmmirror.com</code></li>
                <li>恢复官方源：<code>npm config set registry https://registry.npmjs.org</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>移除系统环境变量配置</h4>
              <ul>
                <li>使用该工具前需清理对 CLI 的系统级环境变量修改，避免与配置文件冲突。</li>
                <li>macOS：检查并移除 <code>~/.zprofile</code>、<code>~/.zshrc</code> 或 <code>~/.bash_profile</code> 中相关设置。</li>
                <li>Windows：通过“系统属性 &gt; 高级 &gt; 环境变量”删除为 CLI 手动添加的相关设置。</li>
              </ul>
            </div>
          </div>
          <div id="helpPanelThinking" class="help-panel" role="tabpanel">
            <div class="help-section">
              <h4>通用说明</h4>
              <ul>
                <li>思考模式用于调节推理强度，越高通常更稳但更慢、成本更高。</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>Codex</h4>
              <ul>
                <li>通过配置 <code>model_reasoning_effort</code> 控制强度。</li>
                <li>可选值：<code>low</code> / <code>medium</code> / <code>high</code>（无显式关闭，<code>low</code> 近似最低）。</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>Gemini</h4>
              <ul>
                <li>通过配置文件的 <code>thinkingConfig</code> 控制。</li>
                <li>Gemini 2.5：暂不支持；Gemini 3：<code>thinkingLevel</code>。</li>
                <li>常见值：<code>minimal</code> / <code>low</code> / <code>medium</code> / <code>high</code>（随模型而异）。</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>Claude</h4>
              <ul>
                <li>使用 <code>--max-thinking-tokens</code> 控制思考 token 数。</li>
                <li><code>0</code> 视为关闭，数值越高推理越深入。</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

    </div>

    <script nonce="${nonce}">
      ${markedScript}
    </script>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      function postWebviewError(payload) {
        try {
          vscode.postMessage(Object.assign({ type: "webviewError" }, payload));
        } catch {
          // ignore
        }
      }
      function normalizeReason(reason) {
        if (!reason) {
          return "";
        }
        if (reason instanceof Error) {
          return reason.message || String(reason);
        }
        if (typeof reason === "string") {
          return reason;
        }
        try {
          return JSON.stringify(reason);
        } catch {
          return String(reason);
        }
      }
      window.addEventListener("error", (event) => {
        postWebviewError({
          message: event && event.message ? event.message : "webview-error",
          source: event && event.filename ? event.filename : undefined,
          lineno: event && typeof event.lineno === "number" ? event.lineno : undefined,
          colno: event && typeof event.colno === "number" ? event.colno : undefined,
          stack: event && event.error && event.error.stack ? String(event.error.stack) : undefined,
        });
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event ? normalizeReason(event.reason) : "";
        const stack = event && event.reason && event.reason.stack ? String(event.reason.stack) : undefined;
        postWebviewError({
          message: "webview-unhandledrejection",
          reason,
          stack,
        });
      });

      const state = {
        currentCli: "codex",
        messages: [],
        isRunning: false,
        configState: {
          configs: [],
          activeConfigId: null,
        },
        selectedConfigId: "",
        autoAppliedConfig: false,
        sessionState: {
          currentSessionId: null,
          sessions: [],
        },
        promptHistory: [],
        debug: false,
        thinkingMode: "medium",
        interactive: { supported: false, enabled: true },
        rulePaths: { global: {}, project: {} },
        ruleScope: "global",
        historyTab: "sessions",
        promptHistoryExpandedId: null,
        taskList: {
          items: [],
          open: false,
          source: "auto",
          startIndex: 0,
        },
      };

      const elements = {
        currentCli: document.getElementById("currentCli"),
        openConfig: document.getElementById("openConfig"),
        newSession: document.getElementById("newSession"),
        stopRun: document.getElementById("stopRun"),
        chatArea: document.getElementById("chatArea"),
        messages: document.getElementById("messages"),
        emptyState: document.getElementById("emptyState"),
        runWait: document.getElementById("runWait"),
        runWaitTime: document.getElementById("runWaitTime"),
        queueIndicator: document.getElementById("queueIndicator"),
        queueCount: document.getElementById("queueCount"),
        configSelect: document.getElementById("configSelect"),
        promptInput: document.getElementById("promptInput"),
        thinkingMode: document.getElementById("thinkingMode"),
        interactiveMode: document.getElementById("interactiveMode"),
        debugMode: document.getElementById("debugMode"),
        commonCommandButton: document.getElementById("commonCommandButton"),
        pathPickerButton: document.getElementById("pathPickerButton"),
        attachmentButton: document.getElementById("attachmentButton"),
        attachmentInput: document.getElementById("attachmentInput"),
        sendPrompt: document.getElementById("sendPrompt"),
        historyButton: document.getElementById("historyButton"),
        historyOverlay: document.getElementById("historyOverlay"),
        closeHistory: document.getElementById("closeHistory"),
        clearAllHistory: document.getElementById("clearAllHistory"),
        historyTabPrompts: document.getElementById("historyTabPrompts"),
        historyTabSessions: document.getElementById("historyTabSessions"),
        historyPanelPrompts: document.getElementById("historyPanelPrompts"),
        historyPanelSessions: document.getElementById("historyPanelSessions"),
        promptHistoryList: document.getElementById("promptHistoryList"),
        sessionList: document.getElementById("sessionList"),
        rulesButton: document.getElementById("rulesButton"),
        rulesOverlay: document.getElementById("rulesOverlay"),
        closeRules: document.getElementById("closeRules"),
        rulesLoadCli: document.getElementById("rulesLoadCli"),
        loadRules: document.getElementById("loadRules"),
        rulesInput: document.getElementById("rulesInput"),
        rulesSaveCodex: document.getElementById("rulesSaveCodex"),
        rulesSaveClaude: document.getElementById("rulesSaveClaude"),
        rulesSaveGemini: document.getElementById("rulesSaveGemini"),
        saveRules: document.getElementById("saveRules"),
        rulesHint: document.getElementById("rulesHint"),
        rulesPath: document.getElementById("rulesPath"),
        scopeGlobal: document.getElementById("scopeGlobal"),
        scopeProject: document.getElementById("scopeProject"),
        helpButton: document.getElementById("helpButton"),
        helpOverlay: document.getElementById("helpOverlay"),
        closeHelp: document.getElementById("closeHelp"),
        toolSettingsButton: document.getElementById("toolSettingsButton"),
        toolSettingsOverlay: document.getElementById("toolSettingsOverlay"),
        closeToolSettings: document.getElementById("closeToolSettings"),
        commonCommandsOverlay: document.getElementById("commonCommandsOverlay"),
        closeCommonCommands: document.getElementById("closeCommonCommands"),
        commandCompact: document.getElementById("commandCompact"),
        runConflictOverlay: document.getElementById("runConflictOverlay"),
        closeRunConflict: document.getElementById("closeRunConflict"),
        queuePrompt: document.getElementById("queuePrompt"),
        pauseAndSend: document.getElementById("pauseAndSend"),
        runConflictPrompt: document.getElementById("runConflictPrompt"),
        queueOverlay: document.getElementById("queueOverlay"),
        closeQueue: document.getElementById("closeQueue"),
        queueBody: document.getElementById("queueBody"),
        helpTabInstall: document.getElementById("helpTabInstall"),
        helpTabThinking: document.getElementById("helpTabThinking"),
        helpPanelInstall: document.getElementById("helpPanelInstall"),
        helpPanelThinking: document.getElementById("helpPanelThinking"),
        interactiveRow: document.getElementById("interactiveRow"),
        toast: document.getElementById("toast"),
        taskListPanel: document.getElementById("taskListPanel"),
        taskListDetails: document.getElementById("taskListDetails"),
        taskListCount: document.getElementById("taskListCount"),
        taskListBody: document.getElementById("taskListBody"),
      };
      let isComposing = false;
      let lastCompositionEndAt = 0;
      const compositionEnterGuardMs = 150;
      const assistantRedirects = {};
      let toastTimer = null;
      let resizeFrame = 0;
      const pendingPromptQueue = [];
      let pendingRunPrompt = "";
      let suppressQueueFlushOnce = false;
      let runWaitTimer = null;
      let runWaitStartAt = 0;

      function updateAppHeight() {
        document.documentElement.style.setProperty("--app-height", window.innerHeight + "px");
      }

      function scheduleAppHeightUpdate() {
        if (resizeFrame) {
          cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          updateAppHeight();
        });
      }

      function applyState(panelState) {
        const previousCli = state.currentCli;
        state.currentCli = panelState.currentCli;
        if (previousCli !== state.currentCli) {
          state.autoAppliedConfig = false;
        }
        state.sessionState = panelState.sessionState;
        state.promptHistory = Array.isArray(panelState.promptHistory) ? panelState.promptHistory : [];
        state.configState = panelState.configState || { configs: [], activeConfigId: null };
        const configs = Array.isArray(state.configState.configs)
          ? state.configState.configs
          : [];
        let nextSelected = state.configState.activeConfigId || "";

        // 如果后端返回的 activeConfigId 为 null，但前端已有有效选择，且该选择仍然在配置列表中，则保持前端选择
        if (!nextSelected && state.selectedConfigId) {
          const configExists = configs.some(c => c.id === state.selectedConfigId);
          if (configExists) {
            nextSelected = state.selectedConfigId;
          }
        }

        if (!nextSelected && configs.length > 0) {
          nextSelected = configs[0].id;
          if (!state.autoAppliedConfig) {
            state.autoAppliedConfig = true;
            vscode.postMessage({
              type: "applyConfig",
              cli: state.currentCli,
              configId: nextSelected,
            });
          }
        }
        state.selectedConfigId = nextSelected;
        state.thinkingMode = panelState.thinkingMode || "medium";
        state.debug = Boolean(panelState.debug);
        state.interactive = panelState.interactive || { supported: false, enabled: false };
        state.rulePaths = panelState.rulePaths || { global: {}, project: {} };
        elements.currentCli.value = panelState.currentCli;
        if (elements.rulesLoadCli) {
          elements.rulesLoadCli.value = panelState.currentCli;
        }
        updateRulesScope(state.ruleScope);
        syncThinkingOptions();
        elements.thinkingMode.value = state.thinkingMode;
        if (elements.debugMode) {
          elements.debugMode.checked = state.debug;
        }
        syncInteractiveOptions();
        if (elements.interactiveMode) {
          elements.interactiveMode.value = state.interactive && state.interactive.enabled ? "on" : "off";
        }
        renderConfigOptions();
        renderSessionList();
        renderPromptHistoryList();
      }

      function renderConfigOptions() {
        elements.configSelect.innerHTML = "";
        const configs = Array.isArray(state.configState.configs)
          ? state.configState.configs
          : [];
        if (configs.length === 0) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "暂无配置";
          elements.configSelect.appendChild(option);
          elements.configSelect.value = "";
          return;
        }
        configs.forEach((config) => {
          const option = document.createElement("option");
          option.value = config.id;
          option.textContent = config.name || config.id;
          elements.configSelect.appendChild(option);
        });
        elements.configSelect.value = state.selectedConfigId || "";
      }

      function syncThinkingOptions() {
        const isGemini = state.currentCli === "gemini";
        const isCodex = state.currentCli === "codex";
        const mediumOption = elements.thinkingMode.querySelector('option[value="medium"]');
        const xhighOption = elements.thinkingMode.querySelector('option[value="xhigh"]');
        if (isGemini && mediumOption) {
          mediumOption.remove();
        }
        if (!isGemini && !mediumOption) {
          const option = document.createElement("option");
          option.value = "medium";
          option.textContent = "思考：中";
          const highOption = elements.thinkingMode.querySelector('option[value="high"]');
          if (highOption && highOption.parentElement) {
            highOption.parentElement.insertBefore(option, highOption);
          } else {
            elements.thinkingMode.appendChild(option);
          }
        }
        const offOption = elements.thinkingMode.querySelector('option[value="off"]');
        if (isCodex && offOption) {
          offOption.remove();
        }
        if (!isCodex && !offOption) {
          const option = document.createElement("option");
          option.value = "off";
          option.textContent = "思考：关闭";
          const lowOption = elements.thinkingMode.querySelector('option[value="low"]');
          if (lowOption && lowOption.parentElement) {
            lowOption.parentElement.insertBefore(option, lowOption);
          } else {
            elements.thinkingMode.appendChild(option);
          }
        }
        if (!isCodex && xhighOption) {
          xhighOption.remove();
        }
        if (isCodex && !xhighOption) {
          const option = document.createElement("option");
          option.value = "xhigh";
          option.textContent = "思考：超高";
          elements.thinkingMode.appendChild(option);
        }
        if (isGemini && state.thinkingMode === "medium") {
          updateThinkingMode("low");
        }
        if (isCodex && state.thinkingMode === "off") {
          updateThinkingMode("low");
        }
        if (!isCodex && state.thinkingMode === "xhigh") {
          updateThinkingMode("high");
        }
      }

      function syncInteractiveOptions() {
        if (!elements.interactiveMode) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        if (elements.interactiveRow) {
          elements.interactiveRow.style.display = supported ? "flex" : "none";
        } else {
          elements.interactiveMode.style.display = supported ? "" : "none";
        }
        elements.interactiveMode.disabled = !supported || state.isRunning;
        syncCommonCommandOptions();
      }

      function syncCommonCommandOptions() {
        if (!elements.commonCommandButton) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        const enabled = Boolean(state.interactive && state.interactive.enabled);
        const visible = supported && enabled;
        elements.commonCommandButton.style.display = visible ? "inline-flex" : "none";
        elements.commonCommandButton.disabled = !visible || state.isRunning;
        if (elements.commandCompact) {
          elements.commandCompact.disabled = !visible || state.isRunning;
        }
      }

      function updateThinkingMode(nextMode) {
        state.thinkingMode = nextMode;
        elements.thinkingMode.value = nextMode;
        vscode.postMessage({
          type: "updateSetting",
          key: "thinkingMode",
          value: nextMode,
        });
      }

      function renderMessages() {
        elements.messages.innerHTML = "";
        state.messages.forEach((message) => {
          const wrapper = document.createElement("div");
          wrapper.className = "message " + message.role;
          if (message.role === "trace") {
            const traceClass = message.kind === "thinking" ? "trace-thinking" : "trace-nonthinking";
            wrapper.classList.add(traceClass);
            const tracePresentation = getTracePresentation(message.content || "");
            if (tracePresentation.type) {
              wrapper.classList.add("trace-type-" + tracePresentation.type);
            }
          }

          const bubble = document.createElement("div");
          bubble.className = "bubble";
          bubble.innerHTML = renderMessageContent(message);

          if (message.role === "user" && message.createdAt) {
            const time = document.createElement("div");
            time.className = "message-time";
            time.textContent = formatDateTime(message.createdAt);
            wrapper.appendChild(time);
          }
          wrapper.appendChild(bubble);
          elements.messages.appendChild(wrapper);
        });

        elements.emptyState.style.display = state.messages.length === 0 ? "block" : "none";
        updateRunWait();
        elements.chatArea.scrollTo({ top: elements.chatArea.scrollHeight, behavior: "smooth" });
        updateTaskList();
      }

      function normalizeMessageOrder(messages) {
        if (!Array.isArray(messages) || messages.length <= 1) {
          return Array.isArray(messages) ? messages : [];
        }
        const entries = messages.map((message, index) => ({ message, index }));
        const allHaveSequence = entries.every((entry) => typeof entry.message.sequence === "number");
        if (!allHaveSequence) {
          return messages;
        }
        return entries
          .slice()
          .sort((a, b) => (a.message.sequence - b.message.sequence) || (a.index - b.index))
          .map((entry) => entry.message);
      }

      function renderSessionList() {
        elements.sessionList.innerHTML = "";
        if (!state.sessionState.sessions.length) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = "暂无会话历史";
          elements.sessionList.appendChild(empty);
          return;
        }
        state.sessionState.sessions.forEach((session) => {
          const item = document.createElement("div");
          item.className = "session-item";

          const info = document.createElement("div");
          info.className = "session-info";

          const label = document.createElement("div");
          label.className = "session-label";
          const cliLabel = session.cli ? "[" + session.cli + "] " : "";
          label.textContent = cliLabel + (session.label || "未命名会话");
          if (session.firstPrompt) {
            label.title = session.firstPrompt;
          } else {
            label.title = session.label || "未命名会话";
          }

          const subtitle = document.createElement("div");
          subtitle.className = "session-subtitle";
          subtitle.textContent = session.createdAt ? formatDateTime(session.createdAt) : "";

          info.appendChild(label);
          info.appendChild(subtitle);

          const actions = document.createElement("div");
          actions.className = "session-actions";

          const loadButton = document.createElement("button");
          loadButton.className = "secondary";
          loadButton.textContent = "加载";
          loadButton.addEventListener("click", () => {
            state.messages = [];
            renderMessages();
            closeHistory();
            vscode.postMessage({ type: "selectSession", sessionId: session.id, cli: session.cli });
          });

          const deleteButton = document.createElement("button");
          deleteButton.className = "ghost";
          deleteButton.textContent = "删除";
          deleteButton.addEventListener("click", () => {
            vscode.postMessage({ type: "deleteSession", sessionId: session.id, cli: session.cli });
          });

          const copyButton = document.createElement("button");
          copyButton.className = "ghost";
          copyButton.textContent = "复制ID";
          copyButton.addEventListener("click", () => {
            copySessionId(session.id);
          });

          actions.appendChild(loadButton);
          actions.appendChild(copyButton);
          actions.appendChild(deleteButton);
          item.appendChild(info);
          item.appendChild(actions);
          elements.sessionList.appendChild(item);
        });
      }

      function renderPromptHistoryList() {
        if (!elements.promptHistoryList) {
          return;
        }
        elements.promptHistoryList.innerHTML = "";
        const items = Array.isArray(state.promptHistory) ? state.promptHistory : [];
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = "暂无历史提示词";
          elements.promptHistoryList.appendChild(empty);
          return;
        }
        const expandedId = state.promptHistoryExpandedId;
        if (expandedId && !items.some((item) => item.id === expandedId)) {
          state.promptHistoryExpandedId = null;
        }
        items.forEach((item) => {
          const wrapper = document.createElement("div");
          wrapper.className = "prompt-item";
          if (state.promptHistoryExpandedId === item.id) {
            wrapper.classList.add("expanded");
          }

          const header = document.createElement("div");
          header.className = "prompt-header";

          const info = document.createElement("div");
          info.className = "prompt-info";

          const preview = document.createElement("div");
          preview.className = "prompt-preview";
          preview.textContent = buildPromptPreview(item.prompt);
          preview.title = item.prompt || "";

          const meta = document.createElement("div");
          meta.className = "prompt-meta";
          const cliLabel = item.cli ? "[" + item.cli + "] " : "";
          const timeLabel = item.createdAt ? formatDateTime(item.createdAt) : "";
          meta.textContent = cliLabel + timeLabel;

          info.appendChild(preview);
          info.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "prompt-actions";

          const viewButton = document.createElement("button");
          viewButton.className = "ghost";
          viewButton.textContent = state.promptHistoryExpandedId === item.id ? "收起" : "查看";
          viewButton.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePromptHistoryExpanded(item.id);
          });

          const useButton = document.createElement("button");
          useButton.className = "secondary";
          useButton.textContent = "复用";
          useButton.addEventListener("click", (event) => {
            event.stopPropagation();
            applyPromptHistory(item.prompt || "");
          });

          actions.appendChild(viewButton);
          actions.appendChild(useButton);

          header.appendChild(info);
          header.appendChild(actions);

          const full = document.createElement("div");
          full.className = "prompt-full";
          full.textContent = item.prompt || "";

          wrapper.appendChild(header);
          wrapper.appendChild(full);

          wrapper.addEventListener("click", () => {
            togglePromptHistoryExpanded(item.id);
          });

          elements.promptHistoryList.appendChild(wrapper);
        });
      }

      function buildPromptPreview(prompt) {
        const normalized = String(prompt || "").replace(/\\s+/g, " ").trim();
        if (!normalized) {
          return "（空提示词）";
        }
        const limit = 60;
        if (normalized.length <= limit) {
          return normalized;
        }
        return normalized.slice(0, limit) + "…";
      }

      function togglePromptHistoryExpanded(id) {
        state.promptHistoryExpandedId = state.promptHistoryExpandedId === id ? null : id;
        renderPromptHistoryList();
      }

      function applyPromptHistory(prompt) {
        const content = String(prompt || "");
        elements.promptInput.value = content;
        const end = content.length;
        elements.promptInput.selectionStart = end;
        elements.promptInput.selectionEnd = end;
        elements.promptInput.focus();
        closeHistory();
      }

      function getFirstNonEmptyLine(text) {
        if (!text || typeof text !== "string") {
          return "";
        }
        const lines = text.split("\\n");
        for (let i = 0; i < lines.length; i += 1) {
          const trimmed = lines[i].trim();
          if (trimmed) {
            return trimmed;
          }
        }
        return "";
      }

      function isFileUpdateMessage(message) {
        if (!message) {
          return false;
        }
        const firstLine = getFirstNonEmptyLine(message.content || "");
        return firstLine.startsWith("file update");
      }

      function appendMessage(message) {
        if (!message) {
          return;
        }
        if ((message.role === "user" || message.role === "system" || message.role === "trace") && !message.createdAt) {
          message.createdAt = Date.now();
        }
        const last = state.messages[state.messages.length - 1];
        const isFileUpdate = isFileUpdateMessage(message);
        const lastIsFileUpdate = last && isFileUpdateMessage(last);
        if (message.role === "assistant") {
          if (last && last.role === "assistant" && !isFileUpdate && !lastIsFileUpdate) {
            assistantRedirects[message.id] = last.id;
            if (message.content) {
              const prefix = last.content ? "\\n" : "";
              last.content = last.content + prefix + message.content;
            }
            renderMessages();
            return;
          }
          state.messages.push(message);
          assistantRedirects[message.id] = message.id;
          renderMessages();
          return;
        }
        const sameRole = last && last.role === message.role;
        const sameTraceKind = message.role !== "trace" || last.kind === message.kind;
        const isToolUseTrace = message.role === "trace" && message.kind === "tool-use";
        const allowMerge = message.merge !== false && (!last || last.merge !== false) && !isToolUseTrace;
        if (sameRole && sameTraceKind && allowMerge) {
          const prefix = last.content ? "\\n" : "";
          last.content = last.content + prefix + (message.content || "");
          renderMessages();
          return;
        }
        state.messages.push(message);
        renderMessages();
      }

      function appendAssistantDelta(id, content) {
        const resolvedId = assistantRedirects[id] || id;
        let targetIndex = state.messages.findIndex((item) => item.id === resolvedId);
        const last = state.messages[state.messages.length - 1];
        const isLastAssistant = last && last.role === "assistant" && last.id === resolvedId;
        if (targetIndex === -1 || !isLastAssistant) {
          const newId = createMessageId();
          assistantRedirects[id] = newId;
          state.messages.push({ id: newId, role: "assistant", content: "" });
          targetIndex = state.messages.length - 1;
        }
        const target = state.messages[targetIndex];
        target.content += content;
        renderMessages();
      }

      function renderMessageContent(message) {
        if (message.role === "system") {
          const content = escapeHtml(message.content || "");
          const time = message.createdAt ? formatDateTime(message.createdAt) : "";
          if (time) {
            return (
              '<div class="system-line">' +
              '<span class="system-text">' +
              content +
              '</span>' +
              '<span class="system-time">' +
              time +
              "</span>" +
              "</div>"
            );
          }
          return content;
        }
        if (message.role === "user") {
          return escapeHtml(message.content || "");
        }
        if (message.role === "trace") {
          const content = renderTraceContent(message.content || "");
          const time = message.createdAt ? formatDateTimeWithMs(message.createdAt) : "";
          if (time) {
            return content + '<div class="trace-time">' + escapeHtml(time) + "</div>";
          }
          return content;
        }
        return renderMarkdown(message.content);
      }

      function renderTraceContent(content) {
        if (!content) {
          return "";
        }
        const presentation = getTracePresentation(content);
        const htmlLines = presentation.lines.map((line) => {
          const cleanLine = stripAnsi(line);
          const trimmed = cleanLine.trimStart();
          const kind = getDiffLineKind(trimmed);
          const prefixed = kind ? ensureDiffPrefix(cleanLine, trimmed, kind) : cleanLine;
          const safeText = escapeHtml(prefixed || "");
          const isLineNumbered = isLineNumberedLine(trimmed);
          const className = (kind ? "trace-line diff-" + kind : "trace-line") + (isLineNumbered ? " line-numbered" : "");
          return '<div class="' + className + '">' + (safeText || "&nbsp;") + "</div>";
        });
        const header = presentation.title
          ? '<div class="trace-header">' +
            '<span class="trace-title">' +
            escapeHtml(presentation.title) +
            "</span>" +
            (presentation.detail
              ? '<span class="trace-detail">' + escapeHtml(presentation.detail) + "</span>"
              : '<span class="trace-detail"></span>') +
            "</div>"
          : "";
        return header + '<div class="trace-content">' + htmlLines.join("") + "</div>";
      }

      function getTracePresentation(content) {
        const expanded = expandFileChangeTraceContent(String(content || ""));
        const lines = expanded.split(/\\r?\\n/);
        const normalizedLines = lines.slice();
        const firstIndex = normalizedLines.findIndex((line) => line.trim());
        if (firstIndex === -1) {
          return { type: "", title: "", detail: "", lines: normalizedLines };
        }
        const firstLine = normalizedLines[firstIndex].trim();
        const definition = getTraceTypeDefinition(firstLine);
        if (!definition) {
          return { type: "", title: "", detail: "", lines: normalizedLines };
        }
        const detail = definition.detail ? definition.detail(firstLine) : "";
        const bodyLines = normalizedLines.slice(0, firstIndex).concat(normalizedLines.slice(firstIndex + 1));
        return {
          type: definition.type,
          title: definition.title,
          detail,
          lines: stripLeadingEmptyLines(bodyLines),
        };
      }

      function stripLeadingEmptyLines(lines) {
        const next = lines.slice();
        while (next.length && !next[0].trim()) {
          next.shift();
        }
        return next;
      }

      function getToolStyleBucket(name) {
        if (!name) {
          return 0;
        }
        let hash = 0;
        for (let i = 0; i < name.length; i += 1) {
          hash = (hash + name.charCodeAt(i) * (i + 1)) % 1024;
        }
        return hash % 4;
      }

      function getTraceTypeDefinition(line) {
        const trimmed = line.trim();
        const toolMatch = trimmed.match(/^(?:tool|调用工具)[:：]?\s*(.+)?$/i);
        if (toolMatch) {
          const toolName = toolMatch[1] ? toolMatch[1].trim() : "";
          const bucket = getToolStyleBucket(toolName);
          return {
            type: "tool-use-" + bucket,
            title: toolName || "tool",
            match: /^(?:tool|调用工具)[:：]?\s*(.+)?$/i,
            detail: () => "",
          };
        }
        const definitions = [
          {
            type: "git-update",
            title: "Git 更新",
            match: /^git\\s+update\\b/i,
            detail: (value) => value.replace(/^git\\s+update\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "exec",
            title: "执行命令",
            match: /^(?:exec\\b|【执行命令】)/i,
            detail: (value) => value.replace(/^(?:exec\\b|【执行命令】)[:：]?\\s*/i, "").trim(),
          },
          {
            type: "file-update",
            title: "文件变更",
            match: /^file\\s+update\\b/i,
            detail: (value) => value.replace(/^file\\s+update\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "apply-patch",
            title: "应用补丁",
            match: /^apply_patch\\b/i,
            detail: (value) => value.replace(/^apply_patch\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "tool-result",
            title: "工具结果",
            match: /^工具结果\\b/i,
            detail: (value) => value.replace(/^工具结果[:：]?\\s*/i, "").trim(),
          },
          {
            type: "warning",
            title: "警告",
            match: /^warning\\b/i,
            detail: (value) => value.replace(/^warning\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "error",
            title: "错误",
            match: /^error\\b/i,
            detail: (value) => value.replace(/^error\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "thinking",
            title: "思考",
            match: /^thinking\\b/i,
            detail: (value) => value.replace(/^thinking\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "web-search",
            title: "网络查询",
            match: /^(?:web\\s*search\\b|【网络查询】)/i,
            detail: (value) => value.replace(/^(?:web\\s*search\\b|【网络查询】)[:：]?\\s*/i, "").trim(),
          },
        ];
        return definitions.find((definition) => definition.match.test(trimmed)) || null;
      }

      function expandFileChangeTraceContent(content) {
        const toolMatch = content.match(/^(?:tool|调用工具)[:：]\\s*(\\S+)/i);
        if (!toolMatch) {
          return content;
        }
        const toolName = toolMatch[1];
        const inputIndex = content.indexOf("\\n输入:\\n");
        if (inputIndex === -1) {
          return content;
        }
        const rawJson = content.slice(inputIndex + "\\n输入:\\n".length).trim();
        if (!rawJson) {
          return content;
        }
        let input;
        try {
          input = JSON.parse(rawJson);
        } catch {
          return content;
        }
        const diffLines = buildToolInputDiffLines(toolName, input);
        if (!diffLines.length) {
          return content;
        }
        return content + "\\n\\n文件变更:\\n" + diffLines.join("\\n");
      }

      function buildToolInputDiffLines(toolName, input) {
        const maxLines = 200;
        if (!input || typeof input !== "object") {
          return [];
        }
        const tool = String(toolName || "").toLowerCase();
        if (tool === "write" && typeof input.content === "string") {
          return formatDiffLines(input.content, "added", maxLines);
        }
        if (tool === "edit") {
          const oldText = typeof input.old_string === "string" ? input.old_string : "";
          const newText = typeof input.new_string === "string" ? input.new_string : "";
          return [
            ...formatDiffLines(oldText, "removed", maxLines),
            ...formatDiffLines(newText, "added", maxLines),
          ].filter((line) => line);
        }
        if (tool === "multiedit" && Array.isArray(input.edits)) {
          const lines = [];
          input.edits.forEach((edit) => {
            if (!edit || typeof edit !== "object") {
              return;
            }
            const oldText = typeof edit.old_string === "string" ? edit.old_string : "";
            const newText = typeof edit.new_string === "string" ? edit.new_string : "";
            lines.push(...formatDiffLines(oldText, "removed", maxLines));
            lines.push(...formatDiffLines(newText, "added", maxLines));
          });
          return lines.filter((line) => line);
        }
        return [];
      }

      function formatDiffLines(text, kind, maxLines) {
        if (!text) {
          return [];
        }
        const prefix = kind === "removed" ? "-" : "+";
        const lines = String(text).split(/\\r?\\n/);
        const limited = lines.slice(0, maxLines);
        const formatted = limited.map((line) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith("+") || trimmed.startsWith("-")) {
            return line;
          }
          return prefix + " " + line;
        });
        if (lines.length > maxLines) {
          formatted.push(prefix + " ...");
        }
        return formatted;
      }

      function stripAnsi(value) {
        if (!value) {
          return "";
        }
        return String(value).replace(/\\u001b\\[[0-9;]*m/g, "");
      }

      function getDiffLineKind(trimmed) {
        if (!trimmed) {
          return "";
        }
        if (trimmed.startsWith("+++") || trimmed.startsWith("---")) {
          return "";
        }
        if (trimmed.startsWith("+")) {
          return "added";
        }
        if (trimmed.startsWith("-")) {
          return "removed";
        }
        if (new RegExp("^(?:added|add|新增|添加)\\\\b[:：]?\\\\s+", "i").test(trimmed)) {
          return "added";
        }
        if (new RegExp("^(?:removed|remove|deleted|delete|删除|移除)\\\\b[:：]?\\\\s+", "i").test(trimmed)) {
          return "removed";
        }
        return "";
      }

      function ensureDiffPrefix(line, trimmed, kind) {
        if (!trimmed) {
          return line;
        }
        const prefix = kind === "added" ? "+" : "-";
        if (trimmed.startsWith(prefix)) {
          return line;
        }
        return prefix + " " + line;
      }

      function renderMarkdown(content) {
        if (!content) {
          return "";
        }
        const normalized = wrapLineNumberedBlocks(content);
        if (typeof marked === "undefined" || !marked.parse) {
          return escapeHtml(normalized);
        }
        const renderer = new marked.Renderer();
        renderer.html = (html) => escapeHtml(html);
        return marked.parse(normalized, { breaks: true, renderer });
      }

      function isLineNumberedLine(value) {
        return /^\\s*\\d+\\s*(?:→|->)\\s*/.test(value);
      }

      function wrapLineNumberedBlocks(content) {
        const lines = String(content).split(/\\r?\\n/);
        const output = [];
        let inFence = false;
        let inNumberBlock = false;
        let numberBlock = [];
        const flushNumberBlock = () => {
          if (!inNumberBlock) {
            return;
          }
          output.push("\`\`\`text", ...numberBlock, "\`\`\`");
          numberBlock = [];
          inNumberBlock = false;
        };
        lines.forEach((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("\`\`\`")) {
            flushNumberBlock();
            inFence = !inFence;
            output.push(line);
            return;
          }
          if (!inFence && isLineNumberedLine(line)) {
            inNumberBlock = true;
            numberBlock.push(line);
            return;
          }
          flushNumberBlock();
          output.push(line);
        });
        flushNumberBlock();
        return output.join("\\n");
      }

      function updateTaskList() {
        if (state.taskList.source === "external") {
          renderTaskList();
          return;
        }
        const items = extractTaskListFromMessages(state.messages, state.taskList.startIndex);
        state.taskList.items = items;
        if (items.length) {
          state.taskList.open = true;
        } else {
          state.taskList.open = false;
        }
        renderTaskList();
      }

      function renderTaskList() {
        if (!elements.taskListPanel || !elements.taskListDetails || !elements.taskListBody) {
          return;
        }
        const items = state.taskList.items;
        if (!items.length) {
          elements.taskListPanel.style.display = "none";
          elements.taskListDetails.open = false;
          if (elements.taskListCount) {
            elements.taskListCount.textContent = "";
          }
          elements.taskListBody.innerHTML = "";
          return;
        }
        elements.taskListPanel.style.display = "block";
        state.taskList.open = true;
        elements.taskListDetails.open = true;
        if (elements.taskListCount) {
          elements.taskListCount.textContent = "(" + items.length + ")";
        }
        const list = document.createElement("ul");
        list.className = "tasklist-items";
        items.forEach((item) => {
          const li = document.createElement("li");
          li.className = "tasklist-item";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "tasklist-checkbox";
          checkbox.checked = item.done;
          checkbox.disabled = true;
          const text = document.createElement("span");
          text.textContent = item.text;
          li.appendChild(checkbox);
          li.appendChild(text);
          list.appendChild(li);
        });
        elements.taskListBody.innerHTML = "";
        elements.taskListBody.appendChild(list);
      }

      function extractTaskListFromMessages(messages, startIndex = 0) {
        let lastItems = [];
        if (!Array.isArray(messages)) {
          return lastItems;
        }
        const start = Number.isInteger(startIndex) ? Math.max(0, startIndex) : 0;
        for (let i = start; i < messages.length; i += 1) {
          const message = messages[i];
          if (!message || message.role !== "assistant") {
            continue;
          }
          const items = parseTaskListFromText(message.content || "");
          if (items.length) {
            lastItems = items;
          }
        }
        return lastItems;
      }

      function parseTaskListFromText(text) {
        if (!text) {
          return [];
        }
        const lines = String(text).split(/\\r?\\n/);
        const headerRegex = /^\\s*(tasklist|todolist)\\s*:\\s*(.*)$/i;
        const itemRegex = /^\\s*(?:[-*]|\\d+\\.)?\\s*\\[(x|\\s)\\]\\s+(.*)$/i;
        let items = [];
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          const headerMatch = line.match(headerRegex);
          if (!headerMatch) {
            continue;
          }
          const sectionItems = [];
          const inlinePart = (headerMatch[2] || "").trim();
          if (inlinePart) {
            const inlineMatch = inlinePart.match(itemRegex);
            if (inlineMatch) {
              sectionItems.push({
                done: inlineMatch[1].toLowerCase() === "x",
                text: inlineMatch[2].trim(),
              });
            }
          }
          for (let j = i + 1; j < lines.length; j += 1) {
            const nextLine = lines[j];
            if (!nextLine.trim()) {
              break;
            }
            const itemMatch = nextLine.match(itemRegex);
            if (!itemMatch) {
              if (sectionItems.length) {
                break;
              }
              continue;
            }
            sectionItems.push({
              done: itemMatch[1].toLowerCase() === "x",
              text: itemMatch[2].trim(),
            });
          }
          if (sectionItems.length) {
            items = sectionItems;
          }
        }
        return items;
      }

      function normalizeTaskListItems(items) {
        if (!Array.isArray(items)) {
          return [];
        }
        return items
          .map((item) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const record = item;
            const text =
              typeof record.text === "string"
                ? record.text
                : typeof record.content === "string"
                  ? record.content
                  : "";
            if (!text.trim()) {
              return null;
            }
            const done =
              typeof record.done === "boolean"
                ? record.done
                : typeof record.completed === "boolean"
                  ? record.completed
                  : record.status === "completed";
            return { text: text.trim(), done: Boolean(done) };
          })
          .filter(Boolean);
      }

      function escapeHtml(value) {
        let text = "";
        if (typeof value === "string") {
          text = value;
        } else if (value && typeof value === "object" && "text" in value) {
          const tokenText = value.text;
          text = typeof tokenText === "string" ? tokenText : tokenText == null ? "" : String(tokenText);
        } else {
          text = value == null ? "" : String(value);
        }
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      function showToast(message) {
        if (!elements.toast) {
          return;
        }
        elements.toast.textContent = message;
        elements.toast.classList.add("visible");
        if (toastTimer) {
          clearTimeout(toastTimer);
        }
        toastTimer = setTimeout(() => {
          elements.toast.classList.remove("visible");
        }, 1600);
      }

      function copySessionId(sessionId) {
        if (!sessionId) {
          return;
        }
        const value = String(sessionId);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(
            () => showToast("已复制"),
            () => fallbackCopySessionId(value)
          );
          return;
        }
        fallbackCopySessionId(value);
      }

      function fallbackCopySessionId(value) {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand("copy");
          showToast("已复制");
        } catch (error) {
          showToast("复制失败");
        } finally {
          document.body.removeChild(textarea);
        }
      }

      function updateRunningState(isRunning) {
        state.isRunning = isRunning;
        elements.sendPrompt.disabled = false;
        elements.promptInput.disabled = false;
        elements.newSession.disabled = isRunning;
        elements.stopRun.disabled = !isRunning;
        elements.thinkingMode.disabled = false;
        if (elements.debugMode) {
          elements.debugMode.disabled = isRunning;
        }
        syncInteractiveOptions();
        elements.sendPrompt.style.display = "inline-flex";
        elements.stopRun.style.display = isRunning ? "inline-flex" : "none";
        elements.historyButton.disabled = false;
        if (isRunning) {
          startRunWaitTimer();
        } else {
          stopRunWaitTimer();
        }
        updateRunWait();
      }

      function updateRunWait() {
        if (!elements.runWait) {
          return;
        }
        elements.runWait.style.display = state.isRunning ? "flex" : "none";
      }

      function startRunWaitTimer() {
        if (!elements.runWaitTime) {
          return;
        }
        stopRunWaitTimer();
        runWaitStartAt = Date.now();
        updateRunWaitTime(0);
        runWaitTimer = window.setInterval(() => {
          updateRunWaitTime(Date.now() - runWaitStartAt);
        }, 1000);
      }

      function stopRunWaitTimer() {
        if (runWaitTimer) {
          clearInterval(runWaitTimer);
          runWaitTimer = null;
        }
        runWaitStartAt = 0;
        updateRunWaitTime(0);
      }

      function updateRunWaitTime(elapsedMs) {
        if (!elements.runWaitTime) {
          return;
        }
        elements.runWaitTime.textContent = formatElapsedTime(elapsedMs);
      }

      function formatElapsedTime(elapsedMs) {
        const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
      }

      function resetTaskListForRunStart() {
        state.taskList.startIndex = state.messages.length;
        state.taskList.items = [];
        state.taskList.open = false;
        state.taskList.source = "auto";
        renderTaskList();
      }

      function dispatchPrompt(prompt) {
        if (!prompt) {
          return false;
        }
        const shouldSuppressFlush = state.isRunning;
        // 优先检查前端选择的配置，如果没有则检查后端的 activeConfigId
        const hasConfig = state.selectedConfigId || state.configState.activeConfigId;
        if (!hasConfig) {
          appendMessage({
            id: createMessageId(),
            role: "system",
            content: "当前 CLI 未激活配置，请先在配置页激活后再发送。",
            createdAt: Date.now(),
          });
          return false;
        }
        if (shouldSuppressFlush) {
          suppressQueueFlushOnce = true;
        }
        resetTaskListForRunStart();
        appendMessage({ id: createMessageId(), role: "user", content: prompt, createdAt: Date.now() });
        vscode.postMessage({ type: "sendPrompt", prompt });
        return true;
      }

      function openRunConflictOverlay(prompt) {
        if (!elements.runConflictOverlay) {
          dispatchPrompt(prompt);
          return;
        }
        pendingRunPrompt = prompt;
        if (elements.runConflictPrompt) {
          elements.runConflictPrompt.textContent = prompt;
        }
        elements.runConflictOverlay.classList.add("visible");
      }

      function closeRunConflictOverlay() {
        if (!elements.runConflictOverlay) {
          return;
        }
        elements.runConflictOverlay.classList.remove("visible");
        pendingRunPrompt = "";
      }

      function updateQueueIndicator() {
        if (!elements.queueIndicator || !elements.queueCount) {
          return;
        }
        const count = pendingPromptQueue.length;
        elements.queueCount.textContent = String(count);
        elements.queueIndicator.style.display = count > 0 ? "inline-flex" : "none";
        if (elements.queueOverlay && elements.queueOverlay.classList.contains("visible")) {
          renderQueueOverlay();
        }
      }

      function renderQueueOverlay() {
        if (!elements.queueBody) {
          return;
        }
        elements.queueBody.innerHTML = "";
        if (!pendingPromptQueue.length) {
          const empty = document.createElement("div");
          empty.className = "queue-empty";
          empty.textContent = "当前没有待发送的提示词。";
          elements.queueBody.appendChild(empty);
          return;
        }
        pendingPromptQueue.forEach((prompt, index) => {
          const row = document.createElement("div");
          row.className = "queue-item";

          const text = document.createElement("div");
          text.className = "queue-text";
          text.textContent = prompt;

          const actions = document.createElement("div");
          actions.className = "queue-actions";

          const removeButton = document.createElement("button");
          removeButton.className = "secondary action-button";
          removeButton.textContent = "取消";
          removeButton.addEventListener("click", () => {
            clearQueuedPromptIndex(index);
          });

          actions.appendChild(removeButton);
          row.appendChild(text);
          row.appendChild(actions);
          elements.queueBody.appendChild(row);
        });
      }

      function openQueueOverlay() {
        if (!elements.queueOverlay) {
          return;
        }
        renderQueueOverlay();
        elements.queueOverlay.classList.add("visible");
      }

      function closeQueueOverlay() {
        if (!elements.queueOverlay) {
          return;
        }
        elements.queueOverlay.classList.remove("visible");
      }

      function queuePromptForLater(prompt) {
        if (!prompt) {
          return;
        }
        pendingPromptQueue.push(prompt);
        updateQueueIndicator();
        showToast("已加入队列");
      }

      function clearQueuedPromptIndex(index) {
        if (index < 0 || index >= pendingPromptQueue.length) {
          return;
        }
        pendingPromptQueue.splice(index, 1);
        updateQueueIndicator();
        renderQueueOverlay();
      }

      function flushPendingPromptQueue() {
        if (state.isRunning) {
          return;
        }
        if (!pendingPromptQueue.length) {
          return;
        }
        const nextPrompt = pendingPromptQueue.shift();
        updateQueueIndicator();
        const sent = dispatchPrompt(nextPrompt);
        if (!sent) {
          showToast("队列发送失败，请先激活配置");
        }
      }

      function sendPrompt() {
        const prompt = elements.promptInput.value.trim();
        if (!prompt) {
          return;
        }
        if (state.isRunning) {
          openRunConflictOverlay(prompt);
          return;
        }
        elements.promptInput.value = "";
        dispatchPrompt(prompt);
      }

      function insertPromptText(text) {
        const input = elements.promptInput;
        const value = input.value || "";
        const selectionStart = typeof input.selectionStart === "number" ? input.selectionStart : value.length;
        const selectionEnd = typeof input.selectionEnd === "number" ? input.selectionEnd : value.length;
        input.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
        const nextPos = selectionStart + text.length;
        input.selectionStart = nextPos;
        input.selectionEnd = nextPos;
        input.focus();
      }

      function buildInsertText(paths, prefix = "@") {
        if (!Array.isArray(paths) || paths.length === 0) {
          return "";
        }
        return paths.map((item) => prefix + item).join(" ") + " ";
      }

      function requestWorkspacePathPick() {
        vscode.postMessage({ type: "pickWorkspacePath" });
      }

      function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              resolve(reader.result);
              return;
            }
            reject(new Error("无法读取文件内容"));
          };
          reader.onerror = () => {
            reject(new Error("无法读取文件内容"));
          };
          reader.readAsDataURL(file);
        });
      }

      async function handleFileSelection(fileList) {
        if (!fileList || fileList.length === 0) {
          return;
        }
        const files = Array.from(fileList);
        try {
          const payloadFiles = [];
          for (const file of files) {
            const dataUrl = await readFileAsDataUrl(file);
            payloadFiles.push({ name: file.name, type: file.type || "", dataUrl });
          }
          vscode.postMessage({ type: "uploadFiles", files: payloadFiles });
        } catch (error) {
          appendMessage({
            id: createMessageId(),
            role: "system",
            content: "文件读取失败，请重试。",
          });
        }
      }

      function getClipboardFiles(event) {
        const items = event.clipboardData && event.clipboardData.items
          ? Array.from(event.clipboardData.items)
          : [];
        const files = items
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file) => file);
        return files;
      }

      function getDropUris(event) {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) {
          return [];
        }
        const uriLines = (dataTransfer.getData("text/uri-list") || "")
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        const uris = new Set(uriLines);
        const textData = (dataTransfer.getData("text/plain") || "").trim();
        if (textData.startsWith("file://")) {
          uris.add(textData);
        }
        return Array.from(uris);
      }

      function createMessageId() {
        return "web_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      }

      function formatDateTime(timestamp) {
        const date = new Date(timestamp);
        const pad = (value) => String(value).padStart(2, "0");
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
      }

      function formatDateTimeWithMs(timestamp) {
        const date = new Date(timestamp);
        const pad = (value) => String(value).padStart(2, "0");
        const padMs = (value) => String(value).padStart(3, "0");
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        const ms = padMs(date.getMilliseconds());
        return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds + "." + ms;
      }

      elements.currentCli.addEventListener("change", (event) => {
        vscode.postMessage({ type: "selectCli", cli: event.target.value });
      });

      elements.configSelect.addEventListener("change", (event) => {
        state.selectedConfigId = event.target.value || "";
        if (!state.selectedConfigId) {
          return;
        }
        vscode.postMessage({
          type: "applyConfig",
          cli: state.currentCli,
          configId: state.selectedConfigId,
        });
      });

      elements.newSession.addEventListener("click", () => {
        state.messages = [];
        state.taskList.items = [];
        state.taskList.open = false;
        state.taskList.source = "auto";
        state.taskList.startIndex = 0;
        renderMessages();
        renderTaskList();
        vscode.postMessage({ type: "newSession" });
      });

      if (elements.taskListDetails) {
        elements.taskListDetails.addEventListener("toggle", () => {
          if (state.taskList.items.length && !elements.taskListDetails.open) {
            elements.taskListDetails.open = true;
            state.taskList.open = true;
            return;
          }
          state.taskList.open = elements.taskListDetails.open;
        });
      }

      elements.thinkingMode.addEventListener("change", (event) => {
        const nextMode = event.target.value || "off";
        state.thinkingMode = nextMode;
        vscode.postMessage({
          type: "updateSetting",
          key: "thinkingMode",
          value: nextMode,
        });
      });

      if (elements.interactiveMode) {
        elements.interactiveMode.addEventListener("change", (event) => {
          const nextValue = event.target.value || "on";
          const enabled = nextValue === "on";
          state.interactive.enabled = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "interactive." + state.currentCli,
            value: enabled,
          });
        });
      }
      if (elements.debugMode) {
        elements.debugMode.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.debug = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "debug",
            value: enabled,
          });
        });
      }

      elements.openConfig.addEventListener("click", () => {
        vscode.postMessage({ type: "openConfig" });
      });

      elements.attachmentButton.addEventListener("click", () => {
        elements.attachmentInput.click();
      });

      elements.attachmentInput.addEventListener("change", (event) => {
        const input = event.target;
        if (!input || !input.files) {
          return;
        }
        handleFileSelection(input.files);
        input.value = "";
      });

      function openHistory() {
        renderSessionList();
        renderPromptHistoryList();
        setHistoryTab(state.historyTab);
        elements.historyOverlay.classList.add("visible");
      }

      function closeHistory() {
        elements.historyOverlay.classList.remove("visible");
      }

      function openRules() {
        elements.rulesOverlay.classList.add("visible");
      }

      function closeRules() {
        elements.rulesOverlay.classList.remove("visible");
      }

      function openHelp() {
        elements.helpOverlay.classList.add("visible");
      }

      function closeHelp() {
        elements.helpOverlay.classList.remove("visible");
      }

      function openToolSettings() {
        elements.toolSettingsOverlay.classList.add("visible");
      }

      function closeToolSettings() {
        elements.toolSettingsOverlay.classList.remove("visible");
      }

      function openCommonCommands() {
        elements.commonCommandsOverlay.classList.add("visible");
      }

      function closeCommonCommands() {
        elements.commonCommandsOverlay.classList.remove("visible");
      }

      function setHistoryTab(tab) {
        const isPrompts = tab === "prompts";
        state.historyTab = isPrompts ? "prompts" : "sessions";
        elements.historyTabPrompts.classList.toggle("active", isPrompts);
        elements.historyTabSessions.classList.toggle("active", !isPrompts);
        elements.historyTabPrompts.setAttribute("aria-selected", String(isPrompts));
        elements.historyTabSessions.setAttribute("aria-selected", String(!isPrompts));
        elements.historyPanelPrompts.classList.toggle("active", isPrompts);
        elements.historyPanelSessions.classList.toggle("active", !isPrompts);
        if (elements.clearAllHistory) {
          elements.clearAllHistory.textContent = isPrompts ? "清空提示词" : "清空会话";
        }
      }

      function setHelpTab(tab) {
        const isInstall = tab === "install";
        elements.helpTabInstall.classList.toggle("active", isInstall);
        elements.helpTabThinking.classList.toggle("active", !isInstall);
        elements.helpTabInstall.setAttribute("aria-selected", String(isInstall));
        elements.helpTabThinking.setAttribute("aria-selected", String(!isInstall));
        elements.helpPanelInstall.classList.toggle("active", isInstall);
        elements.helpPanelThinking.classList.toggle("active", !isInstall);
      }

      function setRulesHint(message) {
        elements.rulesHint.textContent = message || "";
      }

      function collectRuleTargets() {
        const targets = [];
        if (elements.rulesSaveCodex.checked) {
          targets.push("codex");
        }
        if (elements.rulesSaveClaude.checked) {
          targets.push("claude");
        }
        if (elements.rulesSaveGemini.checked) {
          targets.push("gemini");
        }
        return targets;
      }

      function updateRulesPath(cli) {
        if (!elements.rulesPath) {
          return;
        }
        const scopePaths = state.rulePaths ? state.rulePaths[state.ruleScope] : null;
        const pathText = scopePaths && scopePaths[cli] ? scopePaths[cli] : "";
        if (!pathText && state.ruleScope === "project") {
          elements.rulesPath.textContent = "路径：未检测到工作区";
          return;
        }
        elements.rulesPath.textContent = pathText ? "路径：" + pathText : "";
      }

      function updateRulesScope(scope) {
        state.ruleScope = scope;
        const isGlobal = scope === "global";
        elements.scopeGlobal.className = isGlobal ? "help-tab active" : "help-tab";
        elements.scopeProject.className = isGlobal ? "help-tab" : "help-tab active";
        elements.scopeGlobal.setAttribute("aria-selected", String(isGlobal));
        elements.scopeProject.setAttribute("aria-selected", String(!isGlobal));
        updateRulesPath(elements.rulesLoadCli.value);
      }

      elements.historyButton.addEventListener("click", () => {
        openHistory();
      });

      elements.closeHistory.addEventListener("click", () => {
        closeHistory();
      });

      elements.clearAllHistory.addEventListener("click", () => {
        if (state.historyTab === "prompts") {
          vscode.postMessage({ type: "clearPromptHistory" });
          return;
        }
        vscode.postMessage({ type: "clearAllSessions" });
      });

      elements.historyTabPrompts.addEventListener("click", () => {
        setHistoryTab("prompts");
      });

      elements.historyTabSessions.addEventListener("click", () => {
        setHistoryTab("sessions");
      });

      elements.historyOverlay.addEventListener("click", (event) => {
        if (event.target === elements.historyOverlay) {
          closeHistory();
        }
      });

      elements.rulesButton.addEventListener("click", () => {
        setRulesHint("");
        updateRulesScope(state.ruleScope);
        openRules();
      });

      elements.closeRules.addEventListener("click", () => {
        closeRules();
      });

      elements.rulesOverlay.addEventListener("click", (event) => {
        if (event.target === elements.rulesOverlay) {
          closeRules();
        }
      });

      elements.helpButton.addEventListener("click", () => {
        setHelpTab("install");
        openHelp();
      });

      elements.closeHelp.addEventListener("click", () => {
        closeHelp();
      });

      elements.helpOverlay.addEventListener("click", (event) => {
        if (event.target === elements.helpOverlay) {
          closeHelp();
        }
      });

      elements.toolSettingsButton.addEventListener("click", () => {
        openToolSettings();
      });

      elements.closeToolSettings.addEventListener("click", () => {
        closeToolSettings();
      });

      elements.toolSettingsOverlay.addEventListener("click", (event) => {
        if (event.target === elements.toolSettingsOverlay) {
          closeToolSettings();
        }
      });

      elements.commonCommandButton.addEventListener("click", () => {
        openCommonCommands();
      });

      elements.closeCommonCommands.addEventListener("click", () => {
        closeCommonCommands();
      });

      elements.commonCommandsOverlay.addEventListener("click", (event) => {
        if (event.target === elements.commonCommandsOverlay) {
          closeCommonCommands();
        }
      });

      elements.commandCompact.addEventListener("click", () => {
        closeCommonCommands();
        vscode.postMessage({ type: "runCommonCommand", command: "compactContext" });
      });

      elements.runConflictOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runConflictOverlay) {
          closeRunConflictOverlay();
        }
      });

      elements.closeRunConflict.addEventListener("click", () => {
        closeRunConflictOverlay();
      });

      elements.queuePrompt.addEventListener("click", () => {
        if (!pendingRunPrompt) {
          closeRunConflictOverlay();
          return;
        }
        queuePromptForLater(pendingRunPrompt);
        elements.promptInput.value = "";
        closeRunConflictOverlay();
      });

      elements.pauseAndSend.addEventListener("click", () => {
        if (!pendingRunPrompt) {
          closeRunConflictOverlay();
          return;
        }
        const prompt = pendingRunPrompt;
        elements.promptInput.value = "";
        closeRunConflictOverlay();
        dispatchPrompt(prompt);
      });

      elements.queueIndicator.addEventListener("click", () => {
        openQueueOverlay();
      });

      elements.queueOverlay.addEventListener("click", (event) => {
        if (event.target === elements.queueOverlay) {
          closeQueueOverlay();
        }
      });

      elements.closeQueue.addEventListener("click", () => {
        closeQueueOverlay();
      });

      elements.helpTabInstall.addEventListener("click", () => {
        setHelpTab("install");
      });

      elements.helpTabThinking.addEventListener("click", () => {
        setHelpTab("thinking");
      });

      elements.loadRules.addEventListener("click", () => {
        const cli = elements.rulesLoadCli.value;
        setRulesHint("正在加载...");
        vscode.postMessage({ type: "loadRules", cli, scope: state.ruleScope });
      });

      elements.rulesLoadCli.addEventListener("change", (event) => {
        updateRulesPath(event.target.value);
      });

      elements.scopeGlobal.addEventListener("click", () => {
        updateRulesScope("global");
        setRulesHint("");
      });

      elements.scopeProject.addEventListener("click", () => {
        updateRulesScope("project");
        setRulesHint("");
      });

      elements.saveRules.addEventListener("click", () => {
        const targets = collectRuleTargets();
        if (!targets.length) {
          setRulesHint("请选择至少一个 CLI 进行覆盖保存。");
          return;
        }
        const content = elements.rulesInput.value || "";
        setRulesHint("正在保存...");
        vscode.postMessage({ type: "saveRules", content, targets, scope: state.ruleScope });
      });

      elements.sendPrompt.addEventListener("click", () => {
        sendPrompt();
      });

      elements.pathPickerButton.addEventListener("click", () => {
        requestWorkspacePathPick();
      });

      elements.stopRun.addEventListener("click", () => {
        vscode.postMessage({ type: "stopRun" });
      });

      elements.promptInput.addEventListener("compositionstart", () => {
        isComposing = true;
      });

      elements.promptInput.addEventListener("compositionend", () => {
        isComposing = false;
        lastCompositionEndAt = Date.now();
      });

      elements.promptInput.addEventListener("keydown", (event) => {
        if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          requestWorkspacePathPick();
          return;
        }
        if (
          event.key === "Enter"
          && !event.shiftKey
          && !event.isComposing
          && !isComposing
          && event.keyCode !== 229
          && Date.now() - lastCompositionEndAt > compositionEnterGuardMs
        ) {
          event.preventDefault();
          sendPrompt();
        }
      });

      elements.promptInput.addEventListener("paste", (event) => {
        const files = getClipboardFiles(event);
        if (!files.length) {
          return;
        }
        event.preventDefault();
        handleFileSelection(files);
      });

      elements.promptInput.addEventListener("dragover", (event) => {
        event.preventDefault();
      });

      elements.promptInput.addEventListener("drop", (event) => {
        const uris = getDropUris(event);
        if (uris.length) {
          event.preventDefault();
          vscode.postMessage({ type: "resolveDropPaths", uris });
          return;
        }
        const files = event.dataTransfer && event.dataTransfer.files
          ? Array.from(event.dataTransfer.files)
          : [];
        if (files.length) {
          event.preventDefault();
          handleFileSelection(files);
        }
      });

      window.addEventListener("message", (event) => {
        const data = event.data;
        if (data.type === "state") {
          applyState(data.payload);
        }
        if (data.type === "setMessages") {
          const incoming = Array.isArray(data.messages) ? data.messages : [];
          state.messages = normalizeMessageOrder(incoming);
          state.taskList.source = "auto";
          state.taskList.startIndex = 0;
          renderMessages();
        }
        if (data.type === "appendMessage") {
          appendMessage(data.message);
        }
        if (data.type === "assistantDelta") {
          appendAssistantDelta(data.id, data.content);
        }
        if (data.type === "traceSegment") {
          appendMessage({
            id: createMessageId(),
            role: "trace",
            content: data.content,
            kind: data.kind,
            merge: data.merge,
          });
        }
        if (data.type === "runStatus") {
          updateRunningState(data.status === "start");
          if (data.status === "start") {
            Object.keys(assistantRedirects).forEach((key) => {
              delete assistantRedirects[key];
            });
            resetTaskListForRunStart();
          }
          if (data.message) {
            appendMessage({ id: createMessageId(), role: "system", content: data.message });
          }
          if (data.status !== "start") {
            if (suppressQueueFlushOnce) {
              suppressQueueFlushOnce = false;
            } else {
              flushPendingPromptQueue();
            }
          }
        }
        if (data.type === "removeMessage") {
          if (data.id) {
            state.messages = state.messages.filter((message) => message.id !== data.id);
            renderMessages();
          }
        }
        if (data.type === "uploadResult") {
          const insertText = buildInsertText(data.paths);
          if (insertText) {
            insertPromptText(insertText);
          }
          if (data.error) {
            appendMessage({ id: createMessageId(), role: "system", content: data.error });
          }
        }
        if (data.type === "dropPathsResult") {
          const insertText = buildInsertText(data.paths);
          if (insertText) {
            insertPromptText(insertText);
          }
          if (data.error) {
            appendMessage({ id: createMessageId(), role: "system", content: data.error });
          }
        }
        if (data.type === "pickWorkspacePathResult") {
          const insertText = buildInsertText(data.paths);
          if (insertText) {
            insertPromptText(insertText);
          } else if (data.canceled || data.error) {
            insertPromptText("@");
          }
          if (data.error) {
            appendMessage({ id: createMessageId(), role: "system", content: data.error });
          }
        }
        if (data.type === "taskListUpdate") {
          const normalized = normalizeTaskListItems(data.items);
          if (normalized.length) {
            state.taskList.items = normalized;
            state.taskList.open = true;
            state.taskList.source = "external";
            renderTaskList();
          } else {
            state.taskList.items = [];
            state.taskList.open = false;
            state.taskList.source = "auto";
            renderTaskList();
          }
        }
        if (data.type === "rulesContent") {
          if (data.error) {
            setRulesHint(data.error);
            return;
          }
          elements.rulesInput.value = typeof data.content === "string" ? data.content : "";
          const scopeLabel = data.scope === "project" ? "项目规则" : "全局规则";
          setRulesHint("已加载 " + scopeLabel + "：" + data.cli + "。");
        }
        if (data.type === "rulesSaved") {
          if (data.error) {
            setRulesHint(data.error);
            return;
          }
          const scopeLabel = data.scope === "project" ? "项目规则" : "全局规则";
          setRulesHint(
            scopeLabel + "已保存到：" + (Array.isArray(data.targets) ? data.targets.join(", ") : "")
          );
        }
      });

      updateAppHeight();
      window.addEventListener("resize", scheduleAppHeightUpdate);
      vscode.postMessage({ type: "requestState" });
    </script>
  </body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}

function getMarkedScript(): string {
  if (cachedMarkedScript !== undefined) {
    return cachedMarkedScript;
  }
  const candidates = [
    path.join(__dirname, "..", "..", "media", "marked.min.js"),
    path.join(__dirname, "..", "..", "node_modules", "marked", "marked.min.js"),
  ];
  for (const scriptPath of candidates) {
    try {
      cachedMarkedScript = readFileSync(scriptPath, "utf8");
      return cachedMarkedScript;
    } catch {
      // Keep checking next candidate.
    }
  }
  void logError("webview-marked-script-missing", { candidates });
  cachedMarkedScript = "";
  return cachedMarkedScript;
}
