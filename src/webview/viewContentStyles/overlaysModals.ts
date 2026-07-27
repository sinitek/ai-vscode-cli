export const OVERLAYS_MODALS_STYLES = `      /* Overlays / Modals */
      .overlay {
        position: fixed;
        inset: 0;
        background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
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
        box-shadow: 0 8px 32px color-mix(in srgb, var(--vscode-editor-foreground) 24%, transparent);
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
        flex-wrap: wrap;
      }

      .add-model-modal {
        width: 400px;
      }
      .add-model-body {
        padding: 0 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .add-model-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .add-model-row label {
        font-size: 13px;
        color: var(--vscode-foreground);
      }
      .model-input {
        width: 100%;
        padding: 6px 8px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-size: 13px;
        font-family: inherit;
      }
      .model-input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
      }
      .add-model-error {
        color: var(--vscode-errorForeground);
        font-size: 12px;
        padding: 4px 0;
      }
      .add-model-actions {
        padding: 0 16px 16px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
      .model-manager-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 220px;
        overflow: auto;
      }
      .model-manager-empty {
        padding: 10px 12px;
        border: 1px dashed var(--vscode-widget-border);
        border-radius: 8px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .model-manager-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        background: var(--vscode-editor-background);
      }
      .model-manager-meta {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .model-manager-name {
        min-width: 0;
        color: var(--vscode-foreground);
        font-size: 12px;
        word-break: break-all;
      }
      .model-manager-actions {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        flex: 0 0 auto;
        flex-wrap: wrap;
        max-width: 180px;
      }
      .model-manager-button {
        height: 24px;
        padding: 0 8px;
        font-size: 12px;
      }
      .model-edit-hint {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
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
      .queue-footer {
        padding: 0 16px 16px;
        display: flex;
        justify-content: flex-end;
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
        flex-direction: column;
        gap: 10px;
      }
      .queue-text {
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        min-width: 0;
      }
      .queue-edit-input {
        width: 100%;
        min-height: 88px;
        max-height: 220px;
        resize: vertical;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 8px;
        background: var(--vscode-input-background, var(--vscode-editor-background));
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        font-family: inherit;
        font-size: 12px;
        line-height: 1.5;
        padding: 8px;
      }
      .queue-edit-input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      .queue-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
      .queue-edit-button {
        padding: 0 10px;
      }
      .queue-order-button {
        width: 26px;
        height: 26px;
        padding: 0;
        border-radius: 6px;
      }
      .queue-remove-button {
        width: 26px;
        height: 26px;
        padding: 0;
        border-radius: 6px;
      }
      .queue-remove-button .icon {
        width: 14px;
        height: 14px;
      }
      .run-prompt-modal {
        width: 560px;
      }
      .run-prompt-body {
        padding: 12px 16px 16px;
      }
      .run-prompt-preview {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 10px;
        max-height: 360px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .run-prompt-item {
        padding: 10px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        background: var(--vscode-editorWidget-background);
      }
      .run-prompt-item-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 18px;
        margin-bottom: 6px;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }
      .run-prompt-latest-badge {
        flex: 0 0 auto;
        padding: 1px 7px;
        border: 1px solid var(--vscode-focusBorder);
        border-radius: 999px;
        color: var(--vscode-foreground);
      }
      .run-prompt-item-content {
        color: var(--vscode-foreground);
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .run-prompt-empty {
        padding: 16px 8px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        text-align: center;
      }
      .run-stream-modal {
        width: 760px;
      }
      .run-stream-body {
        padding: 12px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .run-stream-toolbar {
        display: flex;
        justify-content: flex-end;
      }
      .run-stream-preview {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 8px;
        font-size: 12px;
        color: var(--vscode-foreground);
        height: min(56vh, 520px);
        overflow: auto;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      }
      .run-stream-preview.run-stream-empty {
        color: var(--vscode-descriptionForeground);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .run-stream-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .run-stream-truncation {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        padding: 6px 8px;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-editorWidget-background);
      }
      .run-stream-item {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        background: var(--vscode-editorWidget-background);
      }
      .run-stream-item summary {
        list-style: none;
      }
      .run-stream-item summary::-webkit-details-marker {
        display: none;
      }
      .run-stream-item-summary {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        cursor: pointer;
      }
      .run-stream-item-summary:hover {
        background: var(--vscode-list-hoverBackground);
      }
      .run-stream-item-index {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .run-stream-item-source {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 0 6px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .run-stream-item-time {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .run-stream-item-preview {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .run-stream-item-content {
        margin: 0;
        padding: 0 8px 8px;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--vscode-foreground);
        border-top: 1px solid var(--vscode-widget-border);
      }
      .run-stream-bottom-gap {
        height: 72px;
      }
      .config-error-modal {
        width: 720px;
      }
      .config-error-body {
        padding: 12px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .config-error-detail {
        margin: 0;
        padding: 12px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        color: var(--vscode-foreground);
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 360px;
        overflow: auto;
      }
      .config-error-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
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
      .history-panel.loop {
        overflow: hidden;
      }
      .history-modal {
        width: 620px;
      }
      .history-messages-modal {
        width: 760px;
        height: min(85vh, 720px);
      }
      .history-messages-title {
        min-width: 0;
      }
      .history-messages-subtitle {
        margin-top: 4px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        font-weight: 400;
        overflow-wrap: anywhere;
      }
      .history-messages-body {
        padding: 12px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      .history-messages-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .history-messages-status {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .history-messages-content {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        color: var(--vscode-foreground);
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding: 8px;
      }
      .history-messages-content.history-messages-empty {
        color: var(--vscode-descriptionForeground);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .history-message-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .history-message-item {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        background: var(--vscode-editorWidget-background);
        overflow: hidden;
        min-width: 0;
      }
      .history-message-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--vscode-widget-border);
        flex-wrap: wrap;
      }
      .history-message-role {
        font-weight: 600;
      }
      .history-message-kind,
      .history-message-time {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .history-message-content {
        margin: 0;
        padding: 8px;
        max-width: 100%;
        max-height: 50vh;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 12px;
        line-height: 1.5;
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
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        background: var(--vscode-editor-background);
      }
      .session-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-width: 0;
      }
      .session-label {
        font-weight: 600;
        flex: 1;
        min-width: 0;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.35;
      }
      .session-title-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
      }
      .session-status-badge {
        flex: 0 0 auto;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--vscode-widget-border);
        background: var(--vscode-badge-background, var(--vscode-editorWidget-background));
        color: var(--vscode-badge-foreground, var(--vscode-foreground));
        font-size: 11px;
        line-height: 1.2;
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
      .session-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
        flex-wrap: wrap;
        justify-content: flex-end;
        max-width: 180px;
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
        flex: 1;
        min-width: 0;
      }
      .prompt-preview {
        font-weight: 600;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.35;
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
        flex-wrap: wrap;
        justify-content: flex-end;
        max-width: 180px;
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
      
`;
