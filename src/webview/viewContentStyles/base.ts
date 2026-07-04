export const BASE_STYLES = `      :root {
        --radius-sm: 4px;
        --radius-md: 8px;
        --radius-lg: 12px;
        --gap-sm: 8px;
        --gap-md: 16px;
        --panel-content-padding: 16px;
      }
      body {
        font-family: var(--vscode-font-family);
        font-size: 14px;
        line-height: 1.5;
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
      .app {
        display: flex;
        flex-direction: column;
        height: calc(var(--app-height, 100vh));
        box-sizing: border-box;
      }
      
`;
