export const INPUT_CONTROLS_STYLES = `      /* Input Area */
      .input-area {
        padding: 8px var(--panel-content-padding);
        background: var(--vscode-editor-background);
      }

      /* Controls Row (CLI, Config) */
      .config-select-row {
        display: flex;
        gap: 4px;
        margin-bottom: 5px;
        align-items: center;
        flex-wrap: nowrap;
        overflow: hidden;
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
      
      .cli-select {
        flex: 0 1 88px;
        min-width: 88px;
      }
      .config-select-row .cli-select {
        flex-basis: calc(88px * 1.15);
        min-width: calc(88px * 1.15);
      }
      .config-select {
        flex: 1 1 165px;
        min-width: 120px;
      }
      .interactive-mode-select {
        flex: 0 1 69px;
        min-width: 69px;
      }
      .model-select {
        flex: 0 1 118px;
        min-width: 92px;
      }
      .lobster-execution-mode-select {
        flex: 0 1 142px;
        min-width: 122px;
        max-width: 190px;
      }
      .thinking-select {
        flex: 0 0 70px;
        width: 70px;
        min-width: 70px;
      }

      /* Input Box Container */
      .input-box {
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        background: var(--vscode-input-background);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 0.2s, box-shadow 0.2s;
        position: relative;
        box-shadow: 0 0 0 1px var(--vscode-widget-border, var(--vscode-input-border));
      }
      .input-box:focus-within {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      .prompt-context-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .prompt-context-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        border: 1px solid var(--vscode-inputOption-activeBorder, var(--vscode-input-border));
        background: var(--vscode-inputOption-activeBackground, var(--vscode-editorWidget-background));
        color: var(--vscode-inputOption-activeForeground, var(--vscode-input-foreground));
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
      }
      .prompt-context-tag-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .prompt-context-tag-remove {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
        width: 14px;
        height: 14px;
        font-size: 12px;
        line-height: 1;
        border-radius: 50%;
      }
      .prompt-context-tag-remove:hover {
        background: var(--vscode-toolbar-hoverBackground);
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
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
        margin-top: 6px;
      }

      .model-modal {
        width: 420px;
      }
      .model-modal-body {
        padding: 0 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .model-name-input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 8px;
        background: var(--vscode-input-background, var(--vscode-editor-background));
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        font-family: inherit;
        font-size: 12px;
        line-height: 1.5;
        padding: 8px 10px;
        outline: none;
      }
      .model-name-input:focus {
        border-color: var(--vscode-focusBorder);
      }
      .model-dialog-hint {
        min-height: 18px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .model-dialog-hint.error {
        color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
      }
      .model-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      
      .input-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        justify-content: flex-end;
        min-width: 0;
      }
      .input-actions .lobster-execution-mode-select {
        margin-right: auto;
      }
      .input-model-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .input-model-row .model-select {
        flex: 0 1 118px;
        min-width: 92px;
        max-width: 180px;
      }
      .input-model-row .thinking-select {
        flex: 0 0 70px;
        width: 70px;
        min-width: 70px;
      }
      .input-model-row .lobster-model-group {
        flex: 0 1 auto;
        min-width: 0;
      }
      .input-model-row .lobster-model-group .model-select {
        min-width: 92px;
      }
      .open-code-model-group {
        display: flex;
        flex: 1 1 100%;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .open-code-model-row {
        display: grid;
        grid-template-columns: minmax(52px, auto) minmax(92px, 1fr) 70px;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .open-code-model-label {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        line-height: 1;
        white-space: nowrap;
      }
      .open-code-model-row .model-select {
        width: 100%;
        min-width: 0;
        max-width: none;
      }
      .open-code-model-row .thinking-select {
        width: 70px;
        min-width: 70px;
      }
      .open-code-model-group .open-code-model-issue {
        align-self: flex-start;
      }
      .open-code-model-issue {
        color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
        font-size: 11px;
        max-width: 260px;
        line-height: 1.3;
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
        width: 32px;
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
      .action-button,
      button.secondary:not(.icon-button),
      button.ghost {
        min-height: 26px;
        height: auto;
        line-height: 1.3;
        white-space: normal;
        text-align: center;
        padding-top: 4px;
        padding-bottom: 4px;
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
        opacity: 1;
      }
      .stop-button:hover {
        background: var(--vscode-inputValidation-errorBackground, var(--vscode-errorForeground));
      }
      .stop-button:disabled {
        background: var(--vscode-errorForeground);
        color: var(--vscode-button-foreground);
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
      
`;
