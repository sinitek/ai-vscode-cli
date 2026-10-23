import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import { logError } from "../logger";
import { getWebviewHtml } from "./viewContent";
import { PanelMessage, PanelState } from "./types";
import { t } from "../i18n";
import { formatHomeDisplayPath } from "../shared/userHomePaths";
import { buildChatImagePreviewHtml, normalizeChatImageSource } from "./chatImagePreview";
import { loadChatImageResource } from "./chatImageResource";

type ViewHandlers = {
  onMessage: (message: PanelMessage) => void;
};

export class CliBridgeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "sinitek-cli-tools.panelView";
  private view: vscode.WebviewView | undefined;
  private webviewReady = false;
  private pendingPromptPaths: string[] = [];
  private imagePreviewPanel: vscode.WebviewPanel | undefined;
  private imagePreviewRequest = 0;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: ViewHandlers
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.imagePreviewRequest += 1;
    this.view = webviewView;
    this.webviewReady = false;
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.imagePreviewRequest += 1;
        this.view = undefined;
        this.webviewReady = false;
      }
    });
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

    webviewView.webview.onDidReceiveMessage(async (message: PanelMessage): Promise<void> => {
      if (this.view !== webviewView) {
        return;
      }
      if (message.type === "previewChatImage") {
        return this.previewChatImage(message.source, message.alt);
      }
      if (message.type === "resolveChatImage") {
        return this.resolveChatImage(webviewView, message.source);
      }
      if (message.type === "downloadChatImage") {
        return this.downloadChatImage(message.source);
      }
      this.handlers.onMessage(message);
      if (message.type === "requestState") {
        this.webviewReady = true;
        this.flushPromptPaths();
      }
    });
  }

  private getImageBaseDirectory(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  }

  private async resolveChatImage(view: vscode.WebviewView, source: unknown): Promise<void> {
    try {
      const normalized = normalizeChatImageSource(source);
      if (!normalized || /^https?:|^data:/i.test(normalized)) {
        throw new Error("不支持的本地图片地址");
      }
      const resource = await loadChatImageResource(normalized, this.getImageBaseDirectory());
      if (this.view === view) {
        await view.webview.postMessage({ type: "chatImageResolved", source, resolvedSource: resource.source });
      }
    } catch {
      if (this.view === view) {
        await view.webview.postMessage({ type: "chatImageResolved", source, error: "无法加载本地图片，请确认文件存在、格式受支持且未超过大小限制。" });
      }
    }
  }

  private async downloadChatImage(source: unknown): Promise<void> {
    try {
      const resource = await loadChatImageResource(source, this.getImageBaseDirectory());
      const extension = resource.filename.split(".").pop()!;
      const destination = await vscode.window.showSaveDialog({
        title: "下载图片",
        saveLabel: "保存图片",
        defaultUri: vscode.Uri.file(path.join(os.homedir(), resource.filename)),
        filters: { [resource.mime === "image/svg+xml" ? "SVG 图片" : "图片"]: [extension] },
      });
      if (destination) {
        await vscode.workspace.fs.writeFile(destination, resource.bytes);
      }
    } catch (error) {
      void logError("chat-image-download-failed", { error: String(error) });
      void vscode.window.showErrorMessage("图片下载失败，请检查图片是否存在、网络连接及保存权限。");
    }
  }

  private async previewChatImage(source: unknown, alt: unknown): Promise<void> {
    const request = ++this.imagePreviewRequest;
    const normalized = normalizeChatImageSource(source);
    if (!normalized) {
      void vscode.window.showErrorMessage("图片预览失败：不支持的图片地址。");
      return;
    }
    try {
      const displaySource = /^https?:|^data:/i.test(normalized) ? normalized
        : (await loadChatImageResource(normalized, this.getImageBaseDirectory())).source;
      if (request !== this.imagePreviewRequest) {
        return;
      }
      if (!this.imagePreviewPanel) {
        const panel = vscode.window.createWebviewPanel(
          "sinitek-cli-tools.chatImagePreview",
          "图片预览",
          vscode.ViewColumn.Active,
          { enableScripts: false, localResourceRoots: [] },
        );
        this.imagePreviewPanel = panel;
        panel.onDidDispose(() => {
          if (this.imagePreviewPanel === panel) {
            this.imagePreviewPanel = undefined;
          }
        });
      }
      this.imagePreviewPanel.webview.html = buildChatImagePreviewHtml(displaySource, typeof alt === "string" ? alt : "图片");
      this.imagePreviewPanel.reveal(vscode.ViewColumn.Active);
    } catch (error) {
      void logError("chat-image-preview-failed", { error: String(error) });
      if (request === this.imagePreviewRequest) {
        void vscode.window.showErrorMessage("图片预览失败，请确认本地图片存在且格式受支持。");
      }
    }
  }

  public insertPromptPaths(paths: string[]): void {
    this.pendingPromptPaths.push(...paths);
    this.flushPromptPaths();
  }

  private flushPromptPaths(): void {
    if (!this.view || !this.webviewReady || !this.pendingPromptPaths.length) {
      return;
    }
    const paths = this.pendingPromptPaths;
    this.pendingPromptPaths = [];
    void this.view.webview.postMessage({ type: "insertPromptPaths", paths });
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
    this.webviewReady = false;
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
  return `<!DOCTYPE html>
<html lang="zh-CN">
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
    <div class="hint">${t("panel.logPath", { path: formatHomeDisplayPath(".sinitek_cli", "logs") })}</div>
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
