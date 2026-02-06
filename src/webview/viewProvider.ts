import * as vscode from "vscode";
import { logError } from "../logger";
import { getWebviewHtml } from "./viewContent";
import { PanelMessage, PanelState } from "./types";
import { resolveLocale, t } from "../i18n";

type ViewHandlers = {
  onMessage: (message: PanelMessage) => void;
};

export class CliBridgeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "sinitek-cli-tools.panelView";
  private view: vscode.WebviewView | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: ViewHandlers
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    try {
      webviewView.webview.html = getWebviewHtml(webviewView.webview);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void logError("webview-html-render-failed", {
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      webviewView.webview.html = buildFallbackHtml(webviewView.webview, message);
    }

    webviewView.webview.onDidReceiveMessage((message: PanelMessage) => {
      this.handlers.onMessage(message);
    });
  }

  public postState(state: PanelState): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage({ type: "state", payload: state });
  }

  public postMessage(payload: Record<string, unknown>): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage(payload);
  }

  public reload(): void {
    if (!this.view) {
      return;
    }
    try {
      this.view.webview.html = getWebviewHtml(this.view.webview);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void logError("webview-html-reload-failed", {
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.view.webview.html = buildFallbackHtml(this.view.webview, message);
    }
  }

  public reveal(): void {
    if (!this.view) {
      return;
    }
    this.view.show(true);
  }
}

function buildFallbackHtml(webview: vscode.Webview, errorMessage: string): string {
  const safeMessage = escapeHtml(errorMessage);
  const locale = resolveLocale();
  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t("panel.appTitle")}</title>
    <style>
      body {
        font-family: var(--vscode-font-family);
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        padding: 16px;
      }
      .error {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 12px;
        background: var(--vscode-editorWidget-background);
        white-space: pre-wrap;
      }
      .hint {
        margin-top: 10px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
    </style>
  </head>
  <body>
    <div class="error">${t("panel.renderFailed", { error: safeMessage })}</div>
    <div class="hint">${t("panel.logPath", { path: "~/.sinitek_cli/logs" })}</div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
