import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import { logError } from "../logger";
import { buildChatImagePreviewHtml, normalizeChatImageSource } from "./chatImagePreview";
import { loadChatImageResource } from "./chatImageResource";

export type ChatImageMessage = {
  type: "previewChatImage" | "resolveChatImage" | "downloadChatImage";
  source?: unknown;
  alt?: unknown;
};

export function isChatImageMessage(message: unknown): message is ChatImageMessage {
  if (!message || typeof message !== "object") {
    return false;
  }
  const type = (message as { type?: unknown }).type;
  return type === "previewChatImage" || type === "resolveChatImage" || type === "downloadChatImage";
}

export class ChatImageHost {
  private imagePreviewPanel: vscode.WebviewPanel | undefined;
  private imagePreviewRequest = 0;

  public constructor(private readonly getWebview: () => vscode.Webview | undefined) {}

  public invalidate(): void {
    this.imagePreviewRequest += 1;
  }

  public async handleMessage(message: ChatImageMessage): Promise<void> {
    if (message.type === "previewChatImage") {
      return this.previewChatImage(message.source, message.alt);
    }
    if (message.type === "resolveChatImage") {
      return this.resolveChatImage(message.source);
    }
    return this.downloadChatImage(message.source);
  }

  private getImageBaseDirectory(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  }

  private async resolveChatImage(source: unknown): Promise<void> {
    const webview = this.getWebview();
    if (!webview) {
      return;
    }
    try {
      const normalized = normalizeChatImageSource(source);
      if (!normalized || /^https?:|^data:/i.test(normalized)) {
        throw new Error("不支持的本地图片地址");
      }
      const resource = await loadChatImageResource(normalized, this.getImageBaseDirectory());
      if (this.getWebview() === webview) {
        await webview.postMessage({ type: "chatImageResolved", source, resolvedSource: resource.source });
      }
    } catch {
      if (this.getWebview() === webview) {
        await webview.postMessage({ type: "chatImageResolved", source, error: "无法加载本地图片，请确认文件存在、格式受支持且未超过大小限制。" });
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
}
