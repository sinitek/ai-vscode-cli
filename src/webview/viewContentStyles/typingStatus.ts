export const TYPING_STATUS_STYLES = `      /* Typing Indicator */
      .run-wait {
        padding-left: 4px;
        align-items: center;
        gap: 8px;
      }
      .run-wait.has-current-loop-group-chat {
        display: flex !important;
      }
      .typing {
        display: inline-flex;
        gap: 4px;
        padding: 6px 8px;
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
        margin-left: 2px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-variant-numeric: tabular-nums;
        line-height: 1;
      }
      .run-status-text {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .run-status-text.compacting {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        padding: 2px 9px;
        border: 1px solid var(--vscode-focusBorder);
        border-radius: 999px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        animation: compactStatusPulse 1.6s ease-in-out infinite;
      }
      .run-status-text.compacting::after {
        content: "...";
        display: inline-block;
        width: 0;
        overflow: hidden;
        animation: compactStatusDots 1.2s steps(4, end) infinite;
      }
      .run-prompt-button {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        font-size: 12px;
        height: 24px;
      }
      .run-prompt-button:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
      .run-stream-button {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        font-size: 12px;
        height: 24px;
      }
      .run-stream-button:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
      .run-stream-stale-badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 0 8px;
        font-size: 11px;
        line-height: 1;
        height: 18px;
        white-space: nowrap;
      }
      .run-stream-stale-badge.run-stream-stale-badge-warning {
        border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
        background: var(--vscode-inputValidation-warningBackground, var(--vscode-editor-inactiveSelectionBackground));
        color: var(--vscode-editorWarning-foreground);
      }
      .run-stream-stale-badge.run-stream-stale-badge-critical {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        background: var(--vscode-inputValidation-errorBackground, var(--vscode-editor-inactiveSelectionBackground));
        color: var(--vscode-errorForeground);
      }
      .typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .typing-dot:nth-child(2) { animation-delay: -0.16s; }
      @keyframes typingPulse {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
      }
      @keyframes compactStatusPulse {
        0%, 100% {
          border-color: var(--vscode-widget-border);
          box-shadow: 0 0 0 0 transparent;
        }
        50% {
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 0 0 2px var(--vscode-editor-inactiveSelectionBackground);
        }
      }
      @keyframes compactStatusDots {
        0% { width: 0; }
        100% { width: 1.5em; }
      }
      @media (prefers-reduced-motion: reduce) {
        .run-status-text.compacting {
          animation: none;
        }
        .run-status-text.compacting::after {
          width: 1.5em;
          animation: none;
        }
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

`;
