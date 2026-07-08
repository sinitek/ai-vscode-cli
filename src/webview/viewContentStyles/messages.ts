export const MESSAGE_BLOCK_STYLES = `      /* Message Blocks */
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
      .message-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      .message-action-link {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
        font: inherit;
        line-height: 1.4;
        padding: 0;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .message-action-link:hover {
        color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
      }
      .message-action-link:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .message-task-role {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--vscode-badge-background, var(--vscode-widget-border));
        background: var(--vscode-badge-background, var(--vscode-editorWidget-background));
        color: var(--vscode-badge-foreground, var(--vscode-foreground));
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11px;
        line-height: 18px;
      }
      .message.user .message-task-role {
        align-self: flex-end;
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
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
        box-shadow: 0 1px 2px color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent);
        white-space: pre-wrap;
      }
      .message.user .user-context-tags {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .message.user .user-context-tag {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        border: 1px solid var(--vscode-inputOption-activeBorder, var(--vscode-input-border));
        background: var(--vscode-inputOption-activeBackground, var(--vscode-editorWidget-background));
        color: var(--vscode-inputOption-activeForeground, var(--vscode-input-foreground));
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Assistant Message - Clean, width-filling */
      .message.assistant {
        align-items: flex-start;
        --assistant-final-accent: var(
          --vscode-focusBorder,
          var(--vscode-textLink-foreground, var(--vscode-charts-blue))
        );
      }
      .message.assistant .bubble {
        background: transparent;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
        border-radius: var(--radius-md);
        padding: 12px;
        max-width: 100%;
        width: 100%;
        box-sizing: border-box;
      }
      .message.assistant.message-final-summary .bubble {
        background: var(--vscode-editorWidget-background, transparent);
      }
      .message.assistant .assistant-message-content-final {
        border: 1px solid var(--assistant-final-accent);
        border-left-width: 4px;
        border-radius: var(--radius-md);
        padding: 12px 14px;
        background: var(
          --vscode-editorHoverWidget-background,
          var(--vscode-editorWidget-background, transparent)
        );
        box-sizing: border-box;
      }
      .message.assistant .assistant-message-content-final > :first-child {
        margin-top: 0;
      }
      .message.assistant .assistant-message-content-final > :last-child {
        margin-bottom: 0;
      }
      
`;
