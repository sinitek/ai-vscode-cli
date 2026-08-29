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
      .button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .button:disabled:hover {
        background: var(--vscode-button-secondaryBackground);
      }
      .button-compact {
        padding: 3px 8px;
        font-size: 12px;
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
        max-height: calc(100vh - 36px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
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
      .node-detail-backdrop {
        z-index: 30;
      }
      .node-detail-dialog {
        width: min(860px, 100%);
      }
      .node-detail-dialog-header {
        position: relative;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--gap);
        padding-right: 42px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .node-detail-close-icon {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 18px;
        height: 18px;
        padding: 3px;
        color: var(--vscode-icon-foreground, var(--vscode-foreground));
        border-radius: 4px;
        cursor: pointer;
        outline: none;
      }
      .node-detail-close-icon:hover {
        color: var(--vscode-toolbar-hoverForeground, var(--vscode-foreground));
        background: var(--vscode-toolbar-hoverBackground, transparent);
      }
      .node-detail-close-icon:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .node-detail-close-icon path {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
      }
      .node-detail-dialog-body {
        min-height: 0;
        overflow: auto;
      }
      .node-detail-dialog .detail-card {
        margin: 0;
      }
      .content {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1;
        overflow: hidden;
      }
      .graph-canvas-content {
        height: 100%;
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
      .button:focus-visible,
      .dag-zoom-select:focus-visible {
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
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        padding: 12px;
        overflow: hidden;
      }
      .graph-dag-toolbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      .dag-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        padding: 3px 7px;
        line-height: 18px;
      }
      .dag-icon {
        width: 14px;
        height: 14px;
        display: block;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.8;
      }
      .dag-zoom-select {
        min-width: 76px;
        min-height: 26px;
        border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-widget-border)));
        border-radius: 4px;
        padding: 3px 24px 3px 8px;
        color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
        background: var(--vscode-dropdown-background, var(--vscode-input-background));
        font: inherit;
      }
      .dag-empty {
        margin-bottom: 10px;
      }
      .graph-notices {
        display: grid;
        gap: 8px;
        max-height: 96px;
        margin-bottom: 8px;
        overflow: auto;
      }
      .graph-notice {
        padding: 8px 10px;
      }
      .dag-viewport {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editor-background);
        cursor: grab;
        user-select: none;
      }
      .dag-viewport.panning {
        cursor: grabbing;
      }
      .dag-canvas {
        position: relative;
        min-width: 100%;
        min-height: 100%;
        transform-origin: top left;
      }
      .dag-canvas-shell {
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
      .dag-edge-path[data-edge-visited="true"] {
        stroke: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
        stroke-width: 2;
      }
      .dag-edge-path[data-edge-visited="true"].edge-kind-if_pass {
        stroke: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen, var(--vscode-focusBorder)));
      }
      .dag-edge-path[data-edge-visited="true"].edge-kind-if_fail {
        stroke: var(--vscode-testing-iconFailed, var(--vscode-errorForeground, var(--vscode-focusBorder)));
      }
      .dag-edge-path[data-edge-visited="true"].edge-kind-review_feedback {
        stroke: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, var(--vscode-focusBorder)));
      }
      .dag-edge-path[data-edge-visited="true"].edge-kind-human_approved {
        stroke: var(--vscode-charts-orange, var(--vscode-editorWarning-foreground, var(--vscode-focusBorder)));
      }
      .dag-edge-path.inactive {
        stroke-dasharray: 5 4;
      }
      .dag-edge-label {
        fill: var(--vscode-editor-foreground);
        stroke: var(--vscode-editor-background);
        stroke-width: 3px;
        paint-order: stroke;
        font-size: 10px;
        font-weight: 600;
        pointer-events: none;
      }
      .dag-edge-label.inactive {
        opacity: 0.7;
      }
      .dag-arrowhead {
        fill: currentColor;
      }
      .dag-arrowhead-visited {
        fill: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
      }
      .dag-arrowhead-visited-if-pass {
        fill: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen, var(--vscode-focusBorder)));
      }
      .dag-arrowhead-visited-if-fail {
        fill: var(--vscode-testing-iconFailed, var(--vscode-errorForeground, var(--vscode-focusBorder)));
      }
      .dag-arrowhead-visited-review-feedback {
        fill: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, var(--vscode-focusBorder)));
      }
      .dag-arrowhead-visited-human-approved {
        fill: var(--vscode-charts-orange, var(--vscode-editorWarning-foreground, var(--vscode-focusBorder)));
      }
      .dag-node {
        position: absolute;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        gap: 4px;
        padding: 7px 9px 7px 14px;
        --node-tone: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        cursor: grab;
        overflow: hidden;
        touch-action: none;
        user-select: none;
      }
      .dag-node.node-tone-info {
        --node-tone: var(--vscode-focusBorder);
      }
      .dag-node.node-tone-accent {
        --node-tone: var(--vscode-progressBar-background, var(--vscode-focusBorder));
      }
      .dag-node.node-tone-start {
        --node-tone: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen, var(--vscode-focusBorder)));
      }
      .dag-node.node-tone-decision {
        --node-tone: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground, var(--vscode-focusBorder)));
      }
      .dag-node.node-tone-validation {
        --node-tone: var(--vscode-charts-orange, var(--vscode-editorWarning-foreground, var(--vscode-focusBorder)));
      }
      .dag-node.node-tone-warning {
        --node-tone: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground, var(--vscode-focusBorder)));
      }
      .dag-node.node-tone-success {
        --node-tone: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen, var(--vscode-focusBorder)));
      }
      .dag-node.node-tone-neutral {
        --node-tone: var(--vscode-descriptionForeground);
      }
      .dag-node.node-tone-danger {
        --node-tone: var(--vscode-errorForeground);
      }
      .dag-tone-stripe {
        position: absolute;
        inset: 0 auto 0 0;
        width: 4px;
        background: var(--node-tone);
        pointer-events: none;
      }
      .dag-node-header {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        min-width: 0;
      }
      .dag-kind-chip,
      .semantic-chip {
        border: 1px solid var(--node-tone);
        border-radius: 4px;
        background: var(--vscode-editor-background);
        color: var(--node-tone);
        font-size: 10px;
        line-height: 16px;
      }
      .dag-kind-chip,
      .semantic-chip {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 5px;
      }
      .dag-kind-chip {
        max-width: 76px;
        font-weight: 600;
      }
      .semantic-chip {
        flex: 0 1 auto;
        max-width: 64px;
        color: var(--vscode-descriptionForeground);
        border-color: var(--vscode-widget-border);
      }
      .semantic-chip.semantic-normal {
        opacity: 0.8;
      }
      .dag-node.dragging {
        cursor: grabbing;
        z-index: 3;
        box-shadow: 0 8px 20px var(--vscode-widget-shadow);
      }
      .dag-node:hover,
      .dag-node.selected {
        border-color: var(--node-tone);
      }
      .dag-node.selected {
        box-shadow: 0 0 0 1px var(--node-tone);
      }
      .dag-node.status-blocked {
        border-color: var(--vscode-errorForeground, var(--vscode-widget-border));
        border-width: 2px;
      }
      .dag-node.status-running {
        border-color: var(--node-tone);
      }
      .dag-node.status-running::before {
        content: "";
        position: absolute;
        inset: 2px;
        border-radius: inherit;
        border: 1px solid var(--node-tone);
        opacity: 0.85;
        pointer-events: none;
        animation: graph-running-border-pulse 1200ms ease-in-out infinite;
      }
      @keyframes graph-running-border-pulse {
        0%,
        100% {
          opacity: 0.9;
        }
        50% {
          opacity: 0.35;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .dag-node.status-running::before {
          animation: none;
        }
      }
      .dag-node-title {
        width: 100%;
        min-width: 0;
        font-weight: 600;
        line-height: 1.15;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .dag-node-footer {
        display: flex;
        justify-content: flex-end;
        width: 100%;
        min-width: 0;
      }
      .dag-node .status-pill {
        max-width: 100%;
        min-height: 18px;
        padding: 0 6px;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dag-port-dot {
        position: absolute;
        z-index: 2;
        width: 5px;
        height: 5px;
        border: 1px solid var(--node-tone);
        border-radius: 999px;
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        opacity: 0.3;
        pointer-events: none;
        transform: translate(-50%, -50%);
      }
      .dag-node:hover .dag-port-dot,
      .dag-node.selected .dag-port-dot,
      .dag-node.dragging .dag-port-dot {
        opacity: 0.9;
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
      .pre-wrap {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .error-card {
        color: var(--vscode-errorForeground);
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      }
      @media (max-width: 760px) {
        .topbar {
          align-items: flex-start;
          flex-direction: column;
        }
        .actions {
          justify-content: flex-start;
        }
        .graph-dag-toolbar {
          justify-content: flex-end;
        }
        .node-detail-dialog {
          max-height: calc(100vh - 24px);
        }
        .node-detail-dialog-header {
          flex-direction: column;
        }
      }
`;
