export const MARKDOWN_STYLES = `      /* Markdown Styles */
      .message.assistant .bubble p {
        margin: 0 0 8px 0;
        line-height: 1.6;
      }
      .message.assistant .bubble p:last-child {
        margin-bottom: 0;
      }
      .message.assistant .bubble pre {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius-md);
        padding: 12px;
        overflow-x: auto;
        margin: 12px 0;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        box-sizing: border-box;
        max-width: 100%;
        overflow-wrap: normal;
        word-break: normal;
      }
      .message.assistant .bubble code {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 5px;
        border-radius: 4px;
        color: var(--vscode-textPreformat-foreground);
      }
      .message.assistant .bubble pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }
      .message.assistant .bubble ul, .message.assistant .bubble ol {
        margin: 8px 0;
        padding-left: 24px;
      }
      .message.assistant .bubble li {
        margin-bottom: 4px;
      }
      .message.assistant .bubble blockquote {
        border-left: 3px solid var(--vscode-textBlockQuote-border);
        background: var(--vscode-textBlockQuote-background);
        margin: 8px 0;
        padding: 8px 12px;
      }
      .json-tree-host {
        max-width: 100%;
        overflow-x: auto;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        line-height: 1.5;
      }
      .json-tree-host .json-formatter-row,
      .json-tree-host .json-formatter-row a,
      .json-tree-host .json-formatter-row a:hover {
        color: var(--vscode-editor-foreground, var(--vscode-foreground));
        font-family: var(--vscode-editor-font-family);
        text-decoration: none;
      }
      .json-tree-host .json-formatter-row .json-formatter-key {
        color: var(--vscode-debugTokenExpression-name, var(--vscode-symbolIcon-fieldForeground, var(--vscode-foreground)));
      }
      .json-tree-host .json-formatter-row .json-formatter-string,
      .json-tree-host .json-formatter-row .json-formatter-stringifiable {
        color: var(--vscode-debugTokenExpression-string, var(--vscode-symbolIcon-stringForeground, var(--vscode-foreground)));
        white-space: pre-wrap;
      }
      .json-tree-host .json-formatter-row .json-formatter-number,
      .json-tree-host .json-formatter-row .json-formatter-bracket {
        color: var(--vscode-debugTokenExpression-number, var(--vscode-symbolIcon-numberForeground, var(--vscode-foreground)));
      }
      .json-tree-host .json-formatter-row .json-formatter-boolean {
        color: var(--vscode-debugTokenExpression-boolean, var(--vscode-symbolIcon-booleanForeground, var(--vscode-foreground)));
      }
      .json-tree-host .json-formatter-row .json-formatter-null,
      .json-tree-host .json-formatter-row .json-formatter-undefined {
        color: var(--vscode-debugTokenExpression-type, var(--vscode-descriptionForeground));
      }
      .json-tree-host .json-formatter-row .json-formatter-url {
        color: var(--vscode-textLink-foreground);
      }
      .json-tree-host .json-formatter-row .json-formatter-children.json-formatter-empty.json-formatter-object:after {
        content: var(--json-tree-empty-object-label);
      }
      .json-tree-host .json-tree-fallback {
        margin: 0;
        white-space: pre-wrap;
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-editor-foreground, var(--vscode-foreground));
        background: var(--vscode-textCodeBlock-background);
      }

`;
