export const LOOP_DEBATE_PANEL_STYLES = `      :root {
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
      .shell {
        width: 100%;
        height: 100vh;
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
      .auto-wake-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--vscode-editorWarning-foreground, var(--vscode-widget-border));
        color: var(--vscode-statusBarItem-warningForeground, var(--vscode-editor-foreground));
        background: var(--vscode-statusBarItem-warningBackground, var(--vscode-editorWidget-background));
      }
      .auto-wake-primary,
      .auto-wake-details {
        min-width: 0;
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 6px 10px;
      }
      .auto-wake-title,
      .auto-wake-countdown {
        font-weight: 600;
      }
      .auto-wake-countdown-label,
      .auto-wake-details {
        font-size: 12px;
      }
      .auto-wake-countdown {
        min-width: 8ch;
        font-variant-numeric: tabular-nums;
      }
      .auto-wake-details {
        justify-content: flex-end;
        overflow-wrap: anywhere;
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
      .button.primary {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
      }
      .button.primary:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .button.danger {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        color: var(--vscode-statusBarItem-errorForeground, var(--vscode-button-foreground));
        background: var(--vscode-statusBarItem-errorBackground, var(--vscode-errorForeground));
      }
      .button.danger:hover {
        background: color-mix(
          in srgb,
          var(--vscode-statusBarItem-errorBackground, var(--vscode-errorForeground)) 88%,
          var(--vscode-statusBarItem-errorForeground, var(--vscode-button-foreground)) 12%
        );
      }
      .dialog-backdrop {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
        z-index: 20;
      }
      .dialog-backdrop.visible {
        display: flex;
      }
      .dialog {
        width: min(560px, 100%);
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background);
        box-shadow: 0 12px 30px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
        overflow: hidden;
      }
      .dialog-header {
        padding: 14px 16px 10px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .dialog-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .dialog-description {
        margin: 6px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .dialog-body {
        padding: 14px 16px 0;
      }
      .dialog-label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 600;
      }
      .dialog-textarea {
        width: 100%;
        min-height: 120px;
        resize: vertical;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 4px;
        padding: 10px 12px;
        box-sizing: border-box;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        font: inherit;
        line-height: 1.5;
      }
      .dialog-textarea:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 0;
      }
      .dialog-error {
        min-height: 18px;
        padding-top: 8px;
        color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
        font-size: 12px;
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px 16px;
      }
      .layout {
        width: 100%;
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
        min-height: 0;
        flex: 1 1 auto;
        overflow: hidden;
      }
      .sidebar {
        min-width: 0;
        border-right: 1px solid var(--vscode-widget-border);
        background: var(--vscode-sideBar-background);
        padding: 14px;
        overflow: auto;
      }
	      .main {
	        min-width: 0;
	        width: 100%;
	        position: relative;
	        overflow: auto;
	        padding: 18px;
	      }
	      .scroll-to-bottom-wrap {
	        position: sticky;
	        bottom: 16px;
	        width: 100%;
	        max-width: 960px;
	        height: 0;
	        margin: 0 auto;
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
      .panel {
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background);
        padding: 12px;
        margin-bottom: 12px;
      }
      .panel h2 {
        margin: 0 0 10px;
        font-size: 13px;
        font-weight: 600;
      }
      .meta-grid {
        display: grid;
        gap: 8px;
      }
      .meta-row {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 8px;
        font-size: 12px;
      }
      .meta-label {
        color: var(--vscode-descriptionForeground);
      }
      .meta-value {
        overflow-wrap: anywhere;
      }
      .roster {
        display: grid;
        gap: 8px;
      }
      .member {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
      }
      .avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--vscode-badge-foreground);
        background: var(--vscode-badge-background);
        font-size: 12px;
        font-weight: 600;
        flex: 0 0 auto;
      }
      .member-name {
        font-weight: 600;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .member-meta {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        overflow-wrap: anywhere;
      }
      .timeline {
        width: 100%;
        max-width: 960px;
        margin: 0 auto;
        display: grid;
        gap: 12px;
      }
      .notice {
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-descriptionForeground);
        padding: 14px;
      }
      .message {
        width: 100%;
        min-width: 0;
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
      }
      .message.no-avatar {
        grid-template-columns: minmax(0, 1fr);
      }
      .message.user-message {
        display: flex;
        justify-content: flex-end;
      }
      .message.user-message .bubble {
        width: min(85%, 760px);
        border-color: var(--vscode-charts-green, var(--vscode-testing-iconPassed, var(--vscode-focusBorder)));
        background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
      }
      .bubble {
        min-width: 0;
        width: 100%;
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background);
        overflow: hidden;
      }
      .message.moderator-turn .bubble,
      .message.main-turn .bubble,
      .message.closed .bubble,
      .message.forced-finalize .bubble {
        border-color: var(--vscode-focusBorder);
        background: var(--vscode-peekViewResult-background, var(--vscode-editorWidget-background));
      }
      .message.subtask-joined .bubble {
        background: var(--vscode-sideBar-background);
      }
      .message.final-stance .bubble {
        border-color: var(--vscode-charts-green, var(--vscode-focusBorder));
      }
      .message.error .bubble {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        background: var(--vscode-inputValidation-errorBackground, var(--vscode-editorWidget-background));
      }
      .message.error .bubble-header {
        color: var(--vscode-errorForeground);
      }
      .message.auto-sleep .bubble {
        border-color: var(--vscode-editorWarning-foreground, var(--vscode-widget-border));
        background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background));
      }
      .auto-sleep-content {
        display: grid;
        gap: 6px;
      }
      .auto-sleep-label {
        color: var(--vscode-descriptionForeground);
        font-weight: 600;
      }
      .message.system .bubble,
      .message.task-event .bubble,
      .message.rules .bubble {
        background: var(--vscode-sideBar-background);
      }
      .bubble-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .speaker {
        font-weight: 600;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .tag {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        white-space: nowrap;
      }
	      .message-text {
	        min-width: 0;
	        margin: 0;
	        padding: 10px;
	        white-space: pre-wrap;
	        word-break: break-word;
	        overflow-wrap: anywhere;
	        font-family: var(--vscode-font-family);
	      }
	      .thinking-text {
	        display: flex;
	        align-items: center;
	        gap: 6px;
	        color: var(--vscode-descriptionForeground);
	      }
	      .typing-dots {
	        display: inline-flex;
	        align-items: center;
	        gap: 3px;
	      }
	      .typing-dots span {
	        width: 4px;
	        height: 4px;
	        border-radius: 50%;
	        background: currentColor;
	        animation: typingPulse 1.2s ease-in-out infinite;
	      }
	      .typing-dots span:nth-child(2) {
	        animation-delay: 0.16s;
	      }
	      .typing-dots span:nth-child(3) {
	        animation-delay: 0.32s;
	      }
	      @keyframes typingPulse {
	        0%,
	        80%,
	        100% {
	          opacity: 0.35;
	          transform: translateY(0);
	        }
	        40% {
	          opacity: 1;
	          transform: translateY(-2px);
	        }
	      }
	      .empty {
	        color: var(--vscode-descriptionForeground);
	        font-style: italic;
	      }
      @media (max-width: 780px) {
        .topbar {
          align-items: stretch;
          flex-direction: column;
        }
        .actions {
          justify-content: flex-start;
        }
        .auto-wake-banner {
          align-items: flex-start;
          flex-direction: column;
          gap: 6px;
        }
        .auto-wake-details {
          justify-content: flex-start;
        }
        .layout {
          grid-template-columns: 1fr;
        }
        .sidebar {
          border-right: 0;
          border-bottom: 1px solid var(--vscode-widget-border);
          max-height: 45vh;
        }
        .main {
          padding: 12px;
        }
      }
`;
