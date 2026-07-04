export const CHAT_AREA_STYLES = `      /* Chat Area */
      .chat-area {
        flex: 1;
        overflow-y: auto;
        padding: 20px 16px;
        margin: 0 var(--panel-content-padding);
        background: var(--vscode-editor-background);
        min-height: 0;
        box-sizing: border-box;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, rgba(128, 128, 128, 0.45)));
        border-radius: 10px;
        position: relative;
      }
      .chat-filter-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        line-height: 1.4;
        user-select: none;
        cursor: pointer;
        padding: 0 2px;
      }
      .chat-filter-toggle input {
        margin: 0;
        cursor: pointer;
      }
      .scroll-to-bottom-wrap {
        position: sticky;
        bottom: 16px;
        height: 0;
        display: flex;
        justify-content: flex-end;
        pointer-events: none;
        z-index: 3;
      }
      .scroll-to-bottom-button {
        width: 34px;
        height: 34px;
        border-radius: 999px;
        border: 1px solid var(--vscode-button-border, var(--vscode-button-background));
        background: var(--vscode-button-background, var(--vscode-focusBorder));
        color: var(--vscode-button-foreground, var(--vscode-editor-background));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        transform: translateY(6px);
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
        box-shadow: 0 1px 3px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
      }
      .scroll-to-bottom-button.visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .scroll-to-bottom-button:hover {
        background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
      }
      .scroll-to-bottom-button .icon {
        width: 14px;
        height: 14px;
      }
      .messages {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 100%;
        padding-bottom: 10px;
      }
      
`;
