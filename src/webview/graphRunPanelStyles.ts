export const GRAPH_RUN_PANEL_STYLES = `      :root {
        --radius: 8px;
        --gap: 12px;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        width: 100%;
        height: 100%;
      }
      body {
        margin: 0;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        line-height: 1.5;
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editor-background);
      }
      button {
        font: inherit;
      }
      [hidden] {
        display: none !important;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .shell {
        width: 100%;
        height: 100vh;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--gap);
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-widget-border);
        background: var(--vscode-editor-background);
      }
      .title {
        min-width: 0;
      }
      .title h1 {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0;
      }
      .title p {
        margin: 2px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      .button {
        border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
        border-radius: 4px;
        padding: 5px 10px;
        color: var(--vscode-button-secondaryForeground);
        background: var(--vscode-button-secondaryBackground);
        cursor: pointer;
      }
      .button:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      .button-danger {
        color: var(--vscode-errorForeground);
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      }
      .dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: var(--vscode-widget-shadow, var(--vscode-editor-background));
      }
      .dialog-backdrop.visible {
        display: flex;
      }
      .dialog {
        width: min(520px, 100%);
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        color: var(--vscode-editor-foreground);
        box-shadow: 0 12px 32px var(--vscode-widget-shadow);
      }
      .dialog-header,
      .dialog-body,
      .dialog-actions {
        padding: 12px;
      }
      .dialog-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .dialog-description {
        margin: 4px 0 0;
        color: var(--vscode-descriptionForeground);
      }
      .dialog-label {
        display: block;
        margin-bottom: 6px;
        color: var(--vscode-descriptionForeground);
      }
      .dialog-textarea {
        width: 100%;
        min-height: 112px;
        resize: vertical;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 4px;
        padding: 8px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        font: inherit;
      }
      .dialog-error {
        min-height: 18px;
        margin-top: 6px;
        color: var(--vscode-errorForeground);
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        border-top: 1px solid var(--vscode-widget-border);
      }
      .content {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1;
        overflow: hidden;
      }
      .section {
        margin-bottom: 16px;
      }
      .section h2 {
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0;
      }
      .meta-card,
      .detail-card,
      .empty-card,
      .error-card {
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      }
      .meta-card {
        padding: 8px 10px;
      }
      .label {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        text-transform: uppercase;
      }
      .value {
        margin-top: 2px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .dag-node:hover {
        border-color: var(--vscode-focusBorder);
      }
      .dag-node.selected {
        border-color: var(--vscode-focusBorder);
      }
      .dag-node:focus-visible,
      .button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .path-list {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 20px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 1px 7px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-badge-background);
      }
      .status-pill {
        color: var(--vscode-badge-foreground);
      }
      .dag-node .status-pill {
        flex: 0 0 auto;
      }
      .status-passed {
        border-color: var(--vscode-testing-iconPassed, var(--vscode-widget-border));
      }
      .status-failed,
      .status-error,
      .status-stopped {
        border-color: var(--vscode-errorForeground, var(--vscode-widget-border));
      }
      .status-blocked,
      .status-needs-review,
      .status-sleeping {
        border-color: var(--vscode-editorWarning-foreground, var(--vscode-widget-border));
      }
      .status-running,
      .status-ready {
        border-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
      }
      .detail-card,
      .empty-card,
      .error-card {
        padding: 12px;
      }
      .path-list {
        margin-top: 10px;
      }
      .graph-dag {
        display: flex;
        flex: 0 0 50%;
        flex-direction: column;
        min-height: 180px;
        margin: 0;
        border: 0;
        border-bottom: 1px solid var(--vscode-widget-border);
        border-radius: 0;
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        padding: 12px;
        overflow: hidden;
      }
      .graph-dag-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--gap);
        margin-bottom: 10px;
      }
      .graph-dag-header h2,
      .graph-dag-header p {
        margin: 0;
      }
	      .graph-dag-header p,
	      .keyboard-hint {
	        color: var(--vscode-descriptionForeground);
	        font-size: 12px;
	      }
      .dag-empty {
        margin-bottom: 10px;
      }
      .dag-viewport {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editor-background);
      }
      .dag-canvas {
        position: relative;
        min-width: 100%;
        min-height: 100%;
      }
      .dag-edges {
        position: absolute;
        inset: 0;
        color: var(--vscode-descriptionForeground);
        pointer-events: none;
      }
      .dag-edge-path {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
      }
      .dag-edge-path.inactive {
        stroke-dasharray: 5 4;
      }
      .dag-arrowhead {
        fill: currentColor;
      }
      .dag-node {
        position: absolute;
	        display: flex;
	        flex-direction: column;
	        align-items: flex-start;
	        justify-content: space-between;
	        gap: 4px;
	        padding: 7px 8px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        cursor: pointer;
        overflow: hidden;
      }
      .dag-node.status-running {
        border-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
      }
      .dag-node.status-running::before {
        content: "";
        position: absolute;
        inset: 0;
        border: 2px solid transparent;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--vscode-progressBar-background, var(--vscode-focusBorder)), var(--vscode-focusBorder), var(--vscode-progressBar-background, var(--vscode-focusBorder))) border-box;
        background-size: 220% 100%;
        pointer-events: none;
        animation: graph-running-border-flow 1.1s linear infinite;
        -webkit-mask: linear-gradient(var(--vscode-editor-foreground) 0 0) padding-box, linear-gradient(var(--vscode-editor-foreground) 0 0);
        -webkit-mask-composite: xor;
        mask: linear-gradient(var(--vscode-editor-foreground) 0 0) padding-box, linear-gradient(var(--vscode-editor-foreground) 0 0);
        mask-composite: exclude;
      }
      @keyframes graph-running-border-flow {
        from {
          background-position: 220% 0;
        }
        to {
          background-position: 0 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .dag-node.status-running::before {
          animation: none;
        }
      }
      .dag-node-title {
	        width: 100%;
	        font-weight: 600;
	        line-height: 1.2;
	        overflow: hidden;
	        text-overflow: ellipsis;
	        white-space: normal;
	        display: -webkit-box;
	        -webkit-line-clamp: 1;
	        -webkit-box-orient: vertical;
	      }
      .detail-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--gap);
        margin-bottom: 10px;
      }
      .detail-heading h3 {
        margin: 2px 0 0;
        font-size: 14px;
        font-weight: 600;
      }
      .detail-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
      }
      .node-details-section {
        flex: 1 1 50%;
        min-height: 0;
        margin: 0;
        padding: 14px 16px 24px;
        overflow: auto;
      }
      .pre-wrap {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .error-card {
        color: var(--vscode-errorForeground);
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      }
      @media (max-width: 760px) {
        .graph-dag-header {
          display: block;
        }
        .keyboard-hint {
          margin-top: 6px;
        }
      }
`;
