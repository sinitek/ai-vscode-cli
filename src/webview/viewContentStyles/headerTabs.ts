export const HEADER_TABS_STYLES = `      /* Header - Minimalist */
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
        gap: 10px;
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
      .icon-action {
        display: block;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        flex: 0 0 auto;
        opacity: 0.8;
        transition: opacity 0.2s, color 0.2s;
      }
      .icon-action:hover,
      .icon-action:focus-visible {
        opacity: 1;
      }
      .icon-action:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .icon-action[aria-disabled="true"] {
        cursor: not-allowed;
        opacity: 0.45;
        pointer-events: none;
      }
      .send-icon-button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        opacity: 1;
      }
      .send-icon-button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .send-icon-button:disabled {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .conversation-tabs {
        display: none;
        align-items: flex-end;
        gap: 0;
        padding: 8px 16px 0;
        overflow: hidden;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
      }
      .conversation-tabs.visible {
        display: flex;
      }
      .conversation-tabs-track {
        display: flex;
        align-items: flex-end;
        gap: 0;
        flex: 1;
        min-width: 0;
      }
      .conversation-tabs-nav {
        width: 22px;
        height: 22px;
        margin-bottom: 4px;
        padding: 0;
        border-radius: 999px;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        line-height: 1;
        font-size: 12px;
      }
      .conversation-tabs-nav:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .conversation-tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 22px;
        margin-bottom: -1px;
        margin-left: -1px;
        padding: 2.5px 10px;
        border-radius: 0;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
        background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editorWidget-background));
        color: var(--vscode-editor-foreground);
        cursor: pointer;
        position: relative;
        white-space: nowrap;
        min-width: 0;
        z-index: 0;
      }
      .conversation-tab:first-child {
        margin-left: 0;
        border-top-left-radius: 6px;
      }
      .conversation-tab:last-child {
        border-top-right-radius: 6px;
      }
      .conversation-tab:hover {
        background: var(--vscode-tab-hoverBackground, var(--vscode-toolbar-hoverBackground));
      }
      .conversation-tab.active {
        background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
        color: var(
          --vscode-textLink-foreground,
          var(--vscode-charts-blue, var(--vscode-tab-activeForeground, var(--vscode-editor-foreground)))
        );
        font-weight: 700;
        border-radius: 6px 6px 0 0;
        border-bottom-color: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
        z-index: 2;
      }
      .conversation-tab.disabled {
        cursor: default;
        opacity: 0.6;
      }
      .conversation-tab.running {
        border-color: transparent;
        z-index: 3;
      }
      .conversation-tab.running::after {
        content: "";
        position: absolute;
        inset: -1px;
        border-radius: inherit;
        pointer-events: none;
        background:
          repeating-linear-gradient(90deg, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 0 8px, transparent 8px 14px) top left / 200% 2px repeat-x,
          repeating-linear-gradient(90deg, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 0 8px, transparent 8px 14px) bottom left / 200% 2px repeat-x,
          repeating-linear-gradient(0deg, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 0 8px, transparent 8px 14px) left top / 2px 200% repeat-y,
          repeating-linear-gradient(0deg, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 0 8px, transparent 8px 14px) right top / 2px 200% repeat-y;
        animation: conversationTabRunningFlow 900ms linear infinite;
      }
      .conversation-tab.errored {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        box-shadow: 0 0 0 1px var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        z-index: 3;
      }
      .conversation-tab-label {
        font-size: 12px;
      }
      .conversation-tab-close {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 0;
        width: 14px;
        height: 14px;
      }
      .conversation-tab-close:disabled {
        cursor: default;
      }
      @keyframes conversationTabRunningFlow {
        /* Layer order: top, bottom, left, right. Clockwise flow: top →, bottom ←, left ↑, right ↓. */
        from {
          background-position: 0 0, 0 100%, 0 0, 100% 0;
        }
        to {
          background-position: 28px 0, -28px 100%, 0 -28px, 100% 28px;
        }
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
      
`;
