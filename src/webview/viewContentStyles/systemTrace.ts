export const SYSTEM_TRACE_STYLES = `      /* System & Trace Messages */
      .message.system {
        align-self: center;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin: 8px 0;
        width: 100%;
      }
      .message.system .bubble {
        background: transparent;
        color: var(--vscode-descriptionForeground);
        padding: 4px 0;
        border-radius: 0;
        font-size: 12px;
        width: 100%;
        box-sizing: border-box;
      }
      .message.system .system-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .message.system .system-time {
        font-size: 11px;
        opacity: 0.6;
        white-space: nowrap;
      }

      .message.trace {
        font-size: 12px;
      }
      .message.trace .bubble {
        font-family: var(--vscode-editor-font-family);
        background: var(--vscode-editor-inactiveSelectionBackground);
        color: var(--vscode-editor-foreground);
        padding: 8px 12px;
        border-radius: var(--radius-md);
        white-space: pre-wrap;
        border-left: 3px solid var(--trace-accent, var(--vscode-minimap-findMatchHighlight));
        --trace-title-fg: var(--vscode-badge-foreground);
        --trace-title-bg: var(--vscode-badge-background);
        --trace-title-border: transparent;
        box-sizing: border-box;
      }
      .message.trace.trace-type-exec .bubble {
        --trace-accent: var(
          --vscode-notificationsWarningIcon-foreground,
          var(
            --vscode-editorWarning-foreground,
            var(
              --vscode-charts-orange,
              var(--vscode-editorWarning-border, var(--vscode-minimap-findMatchHighlight)))
          )
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-git-update .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-modifiedResourceForeground,
          var(--vscode-charts-blue, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-modifiedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-file-update .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-addedResourceForeground,
          var(--vscode-charts-green, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-apply-patch .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-stageModifiedResourceForeground,
          var(--vscode-charts-purple, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-editor-selectionHighlightBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-0 .bubble {
        --trace-accent: var(
          --vscode-notificationsWarningIcon-foreground,
          var(
            --vscode-editorWarning-foreground,
            var(
              --vscode-charts-orange,
              var(--vscode-editorWarning-border, var(--vscode-minimap-findMatchHighlight)))
          )
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-1 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-modifiedResourceForeground,
          var(--vscode-charts-blue, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-modifiedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-2 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-addedResourceForeground,
          var(--vscode-charts-green, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-3 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-stageModifiedResourceForeground,
          var(--vscode-charts-purple, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-editor-selectionHighlightBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-0 .trace-title,
      .message.trace.trace-type-tool-use-1 .trace-title,
      .message.trace.trace-type-tool-use-2 .trace-title,
      .message.trace.trace-type-tool-use-3 .trace-title {
        text-transform: none;
      }
      .message.trace.trace-type-tool-result .bubble {
        --trace-accent: var(
          --vscode-charts-green,
          var(--vscode-terminal-ansiGreen, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-warning .bubble {
        --trace-accent: var(
          --vscode-editorWarning-foreground,
          var(--vscode-notificationsWarningIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-warningBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-error .bubble {
        --trace-accent: var(
          --vscode-editorError-foreground,
          var(--vscode-notificationsErrorIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-errorBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-thinking .bubble {
        --trace-accent: var(
          --vscode-editorInfo-foreground,
          var(--vscode-notificationsInfoIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-infoBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-web-search .bubble {
        --trace-accent: var(
          --vscode-terminal-ansiMagenta,
          var(--vscode-charts-purple, var(--vscode-textLink-foreground))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: color-mix(in srgb, var(--trace-accent) 15%, transparent);
        --trace-title-border: var(--trace-accent);
      }
      .trace-header {
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 6px;
      }
      .trace-tag-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .trace-title {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.3px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--trace-title-bg, var(--vscode-badge-background));
        color: var(--trace-title-fg, var(--vscode-badge-foreground));
        border: 1px solid var(--trace-title-border, transparent);
        text-transform: uppercase;
      }
      .trace-command-tag {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.2px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--vscode-widget-border);
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-descriptionForeground);
      }
      .trace-command-tag.cmd-purpose-test,
      .trace-command-tag.cmd-purpose-typecheck,
      .trace-command-tag.cmd-purpose-lint {
        color: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen));
      }
      .trace-command-tag.cmd-purpose-build,
      .trace-command-tag.cmd-purpose-install {
        color: var(--vscode-terminal-ansiYellow, var(--vscode-charts-yellow));
      }
      .trace-command-tag.cmd-purpose-git-read,
      .trace-command-tag.cmd-purpose-search,
      .trace-command-tag.cmd-purpose-file-read {
        color: var(--vscode-charts-blue, var(--vscode-terminal-ansiBlue));
      }
      .trace-command-tag.cmd-purpose-git-write,
      .trace-command-tag.cmd-purpose-file-write {
        color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-terminal-ansiMagenta));
      }
      .trace-command-tag.cmd-purpose-python {
        color: var(--vscode-terminal-ansiBlue, var(--vscode-charts-blue));
      }
      .trace-command-tag.cmd-purpose-run {
        color: var(--vscode-terminal-ansiCyan, var(--vscode-charts-foreground));
      }
      .trace-detail {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family);
        width: 100%;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        text-align: left;
      }
      .trace-time {
        margin-top: 6px;
        font-size: 11px;
        opacity: 0.7;
        text-align: left;
        font-variant-numeric: tabular-nums;
      }
      .message.trace.trace-thinking .bubble {
        background: transparent;
        border-left: none;
        padding: 4px 0;
      }
      .message.trace.trace-nonthinking .bubble {
        opacity: 1;
      }
      .trace-content {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .trace-collapsible {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        background: var(--vscode-editorWidget-background);
      }
      .trace-collapsible summary {
        cursor: pointer;
        list-style: none;
        padding: 6px 10px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        user-select: none;
      }
      .trace-collapsible summary::-webkit-details-marker {
        display: none;
      }
      .trace-collapsible summary::before {
        content: "▸";
        margin-right: 6px;
      }
      .trace-collapsible[open] summary::before {
        content: "▾";
      }
      .trace-collapsible .trace-content {
        border-top: 1px solid var(--vscode-widget-border);
        padding: 6px 10px 8px;
      }
      .trace-collapsible:not([open]) .trace-content {
        display: none;
      }
      .trace-collapsible.trace-collapsible-tool-result:not([open]) .trace-content {
        display: none !important;
        max-height: 0;
        overflow: hidden;
      }
      .trace-line {
        white-space: pre-wrap;
      }
      .trace-line.line-numbered {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        color: var(--vscode-textPreformat-foreground);
        padding: 2px 6px;
        font-family: var(--vscode-editor-font-family);
      }
      .trace-line.diff-added {
        color: var(
          --vscode-diffEditor-insertedTextForeground,
          var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-terminal-ansiGreen, var(--vscode-charts-green)))
        );
      }
      .trace-line.diff-removed {
        color: var(
          --vscode-diffEditor-removedTextForeground,
          var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-terminal-ansiRed, var(--vscode-charts-red)))
        );
      }

`;
