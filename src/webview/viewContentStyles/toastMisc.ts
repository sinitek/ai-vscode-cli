export const TOAST_MISC_STYLES = `      /* Toast */
      .toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: var(--vscode-notifications-background);
        color: var(--vscode-notifications-foreground);
        padding: 10px 16px;
        border-radius: 6px;
        box-shadow: 0 4px 12px color-mix(in srgb, var(--vscode-editor-foreground) 20%, transparent);
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
        width: min(680px, 92vw);
      }
      .tool-settings-body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .tool-settings-tabs {
        display: flex;
        gap: 4px;
        padding: 0 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .tool-settings-tab {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        color: var(--vscode-foreground);
        padding: 8px 10px;
      }
      .tool-settings-tab.active {
        border-bottom-color: var(--vscode-focusBorder);
        color: var(--vscode-foreground);
      }
      .tool-settings-panel {
        display: none;
      }
      .tool-settings-panel.active {
        display: block;
        column-count: 2;
        column-gap: 12px;
      }
      .tool-settings-card {
        display: inline-flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        box-sizing: border-box;
        margin: 0 0 12px;
        padding: 10px;
        break-inside: avoid;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        background: var(--vscode-editor-background);
      }
      .tool-settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .tool-settings-row.tool-settings-card {
        flex-direction: row;
      }
      .tool-settings-label {
        font-size: 12px;
        color: var(--vscode-foreground);
      }
      .tool-settings-note {
        font-size: 11px;
        line-height: 1.4;
        color: var(--vscode-descriptionForeground);
      }
      .tool-settings-card > .tool-settings-note {
        margin-top: -2px;
      }
      .tool-settings-number {
        width: 92px;
        padding: 4px 6px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font: inherit;
        font-size: 12px;
      }
      .tool-settings-number:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
      }
      @media (max-width: 560px) {
        .tool-settings-modal {
          width: 420px;
        }
        .tool-settings-panel.active {
          column-count: 1;
        }
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

`;
