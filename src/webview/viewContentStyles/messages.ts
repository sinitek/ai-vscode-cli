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
      mark.chat-search-hit {
        background: #fff2a8;
        color: #000000;
        border-radius: 2px;
        padding: 0;
      }
      mark.chat-search-hit.is-active {
        background: #fff2a8;
        color: #000000;
        outline: 1px solid var(--vscode-editor-findMatchBorder, transparent);
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
        border: 0;
        background: transparent;
        color: var(--vscode-descriptionForeground, var(--vscode-foreground));
        border-radius: 0;
        padding: 0;
        font-size: 11px;
        line-height: 18px;
        font-weight: 600;
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
        padding: 0;
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
      .message.assistant .assistant-message-content-streaming {
        display: block;
        font: inherit;
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .thinking-bubble {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 24px;
        align-items: start;
        gap: 6px;
        min-width: 0;
      }
      .thinking-bubble-viewport {
        min-width: 0;
        line-height: 1.6;
        max-height: 8em;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
        overflow-wrap: anywhere;
      }
      .thinking-bubble-viewport > :first-child {
        margin-top: 0;
      }
      .thinking-bubble-viewport > :last-child {
        margin-bottom: 0;
      }
      .thinking-bubble.is-expanded .thinking-bubble-viewport {
        max-height: none;
        overflow-y: visible;
      }
      .thinking-bubble-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 4px;
        border: 0;
        border-radius: var(--radius-sm, 4px);
        background: transparent;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
      }
      .thinking-bubble-toggle[hidden] {
        display: none;
      }
      .thinking-bubble-toggle:hover {
        background: var(--vscode-toolbar-hoverBackground);
        color: var(--vscode-foreground);
      }
      .thinking-bubble-toggle:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .thinking-bubble-toggle svg {
        width: 16px;
        height: 16px;
      }
      .thinking-collapse-icon,
      .thinking-bubble.is-expanded .thinking-expand-icon {
        display: none;
      }
      .thinking-bubble.is-expanded .thinking-collapse-icon {
        display: initial;
      }
      .instruction-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
        max-width: 100%;
      }
      .instruction-group-summary {
        cursor: pointer;
        list-style: none;
        width: fit-content;
        max-width: 100%;
        padding: 4px 2px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        line-height: 1.4;
        user-select: none;
      }
      .instruction-group-summary::-webkit-details-marker {
        display: none;
      }
      .instruction-group-summary::before {
        content: "▸";
        margin-right: 6px;
      }
      .instruction-group[open] > .instruction-group-summary::before {
        content: "▾";
      }
      .instruction-group-summary:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .instruction-group-body {
        display: flex;
        flex-direction: column;
        gap: 20px;
        min-width: 0;
      }
      .instruction-group:not([open]) > .instruction-group-body {
        display: none;
      }

`;
