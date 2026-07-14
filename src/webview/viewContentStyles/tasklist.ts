export const TASKLIST_STYLES = `      /* Tasklist Panel */
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
      .tasklist-summary-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .tasklist-toggle-icon {
        width: 7px;
        height: 7px;
        border: solid currentColor;
        border-width: 0 1px 1px 0;
        flex-shrink: 0;
        transform: rotate(-45deg);
        transition: transform 120ms ease;
      }
      .tasklist-panel details[open] .tasklist-toggle-icon {
        transform: rotate(45deg);
      }
      .tasklist-count {
        font-size: 12px;
        opacity: 0.7;
        flex-shrink: 0;
        white-space: nowrap;
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
        margin-top: 6px;
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
`;
