import * as vscode from "vscode";
import { getWebviewHtml } from "./viewContent";
import { PanelMessage, PanelState } from "./types";

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
    webviewView.webview.html = getWebviewHtml(webviewView.webview);

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

  public reveal(): void {
    if (!this.view) {
      return;
    }
    this.view.show(true);
  }
}
