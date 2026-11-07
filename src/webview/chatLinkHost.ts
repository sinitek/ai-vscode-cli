import * as vscode from "vscode";
import * as path from "node:path";
import { logError } from "../logger";
import { normalizeChatLinkSource, resolveChatLocalLink } from "./chatLink";

export type ChatLinkMessage = { type: "openChatLink"; source: unknown };

export function isChatLinkMessage(message: unknown): message is ChatLinkMessage {
  return !!message && typeof message === "object" && (message as { type?: unknown }).type === "openChatLink";
}

function getDocumentPreviewEditor(extension: string): string | undefined {
  const suffix = extension.slice(1);
  const pattern = new RegExp("[.,{]" + suffix + "(?:$|[,}])", "i");
  for (const installed of vscode.extensions.all) {
    const editors = installed.packageJSON?.contributes?.customEditors;
    if (!Array.isArray(editors)) {
      continue;
    }
    for (const editor of editors) {
      if (typeof editor.viewType === "string" && Array.isArray(editor.selector)
        && editor.selector.some((selector: { filenamePattern?: unknown }) => typeof selector.filenamePattern === "string"
          && pattern.test(selector.filenamePattern))) {
        return editor.viewType;
      }
    }
  }
  return undefined;
}

async function offerDocumentOpenOptions(uri: vscode.Uri, extension: string): Promise<void> {
  const action = await vscode.window.showWarningMessage(
    "VS Code 无法直接预览此文件。PDF、PPTX 等格式需要相应的预览扩展，也可以使用系统应用打开。",
    "选择打开方式", "使用系统应用打开", "查找预览扩展",
  );
  if (action === "选择打开方式") {
    await vscode.commands.executeCommand("vscode.openWith", uri, "");
  } else if (action === "使用系统应用打开" && !await vscode.env.openExternal(uri)) {
    throw new Error("系统应用未能打开文件");
  } else if (action === "查找预览扩展") {
    await vscode.commands.executeCommand("workbench.extensions.search", extension.slice(1));
  }
}

export async function openChatLink(source: unknown, previewImage: (source: string) => Promise<void>): Promise<void> {
  const normalized = normalizeChatLinkSource(source);
  if (!normalized) {
    void vscode.window.showErrorMessage("无法打开链接：地址为空或使用了不受支持的协议。");
    return;
  }
  try {
    if (/^https?:/i.test(normalized)) {
      if (!await vscode.env.openExternal(vscode.Uri.parse(normalized))) {
        throw new Error("浏览器未能打开链接");
      }
      return;
    }
    const target = resolveChatLocalLink(normalized, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
    const uri = vscode.Uri.file(target.path);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) {
        await vscode.commands.executeCommand("revealInExplorer", uri);
        return;
      }
    } catch {
      void vscode.window.showErrorMessage("无法打开文件：文件不存在或无法访问，请确认链接路径及当前工作区。路径：" + target.path);
      return;
    }
    const extension = path.extname(target.path).toLowerCase();
    if (/^\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/.test(extension)) {
      await previewImage(uri.toString());
      return;
    }
    if (/^\.(?:md|markdown)$/.test(extension) && !target.line) {
      await vscode.commands.executeCommand("markdown.showPreview", target.fragment ? uri.with({ fragment: target.fragment }) : uri);
      return;
    }
    const binaryDocument = /^\.(?:pdf|pptx?|docx?|xlsx?|od[pts])$/.test(extension);
    const previewEditor = binaryDocument ? getDocumentPreviewEditor(extension) : undefined;
    if (binaryDocument && !previewEditor) {
      await offerDocumentOpenOptions(uri, extension);
      return;
    }
    try {
      const position = target.line ? new vscode.Position(target.line - 1, (target.column || 1) - 1) : undefined;
      const resource = target.fragment ? uri.with({ fragment: target.fragment }) : uri;
      const options = {
        preview: true,
        ...(position ? { selection: new vscode.Range(position, position) } : {}),
      };
      if (previewEditor) {
        await vscode.commands.executeCommand("vscode.openWith", resource, previewEditor, options);
      } else {
        await vscode.commands.executeCommand("vscode.open", resource, options);
      }
    } catch {
      await offerDocumentOpenOptions(uri, extension);
    }
  } catch (error) {
    void logError("chat-link-open-failed", { error: String(error) });
    void vscode.window.showErrorMessage("链接打开失败，请检查文件访问权限、默认打开方式或网络连接。");
  }
}
