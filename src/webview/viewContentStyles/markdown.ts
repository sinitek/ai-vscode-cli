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

`;
