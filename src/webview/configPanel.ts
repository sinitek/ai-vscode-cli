import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { getConfigViewHtml } from "./configView";
import {
  ConfigRequestMessage,
  ConfigResponseMessage,
  ConfigOpenPathMessage,
} from "./configProtocol";
import * as configService from "../config/configService";
import { logEssential, logInfo } from "../logger";

type ConfigManagerHandlers = {
  onConfigChanged?: () => void;
};

export class ConfigManagerPanel {
  private panel: vscode.WebviewPanel | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: ConfigManagerHandlers = {}
  ) {}

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, true);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "sinitek-cli-tools.configManager",
      "携宁 CLI 助手 - 配置",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }
    );

    this.panel.webview.html = getConfigViewHtml(this.panel.webview, this.extensionUri);

    this.panel.webview.onDidReceiveMessage(
      (
        message:
          | ConfigRequestMessage
          | ConfigOpenPathMessage
          | { type: "config:debug"; payload?: unknown }
      ) => {
      if (message && message.type === "config:debug") {
        void logInfo("config-view-debug", message.payload ?? {});
        return;
      }
      if (message && message.type === "config:openPath") {
        const target = message.path;
        if (target) {
          const uri = vscode.Uri.file(target);
          void vscode.commands.executeCommand("revealFileInOS", uri);
        }
        return;
      }
      void this.handleRequest(message as ConfigRequestMessage);
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  public syncActiveConfig(): void {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage({ type: "config:syncActive" });
  }

  private async handleRequest(message: ConfigRequestMessage): Promise<void> {
    const response: ConfigResponseMessage = {
      type: "config:response",
      requestId: message.requestId,
      success: true,
    };

    try {
      switch (message.action) {
        case "getList":
          response.data = await configService.getConfigList(message.platform);
          break;
        case "getById":
          response.data = await configService.getConfigById(message.platform, message.id);
          break;
        case "save":
          await configService.saveConfig(message.config);
          response.data = message.config;
          this.handlers.onConfigChanged?.();
          break;
        case "delete":
          await configService.deleteConfig(message.platform, message.id);
          response.data = true;
          this.handlers.onConfigChanged?.();
          break;
        case "getCurrent":
          response.data = await configService.getCurrentConfig(message.platform);
          break;
        case "apply":
          response.data = await configService.applyConfig(message.platform, message.payload);
          break;
        case "backup":
          response.data = await configService.backupConfig(message.platform);
          break;
        case "getBackups":
          response.data = await configService.getBackupList(message.platform);
          break;
        case "initDefault":
          response.data = await configService.initDefaultConfig(message.platform);
          this.handlers.onConfigChanged?.();
          break;
        case "getMcpMarketplaceList":
          response.data = await configService.getMcpMarketplaceList();
          break;
        case "getCodexSkillsList":
          response.data = await configService.getCodexSkillsList();
          break;
        case "exportConfigs": {
          const payload = message.payload;
          if (!payload || typeof payload.content !== "string") {
            throw new Error("导出内容不能为空");
          }
          const rawName = payload.fileName || "";
          const safeName = rawName
            ? path.basename(rawName).replace(/[\\/:*?"<>|]/g, "_")
            : `sinitek-cli-configs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
          const targetName = safeName.endsWith(".json") ? safeName : `${safeName}.json`;
          let downloadsDir = path.join(os.homedir(), "Downloads");
          try {
            await fs.promises.mkdir(downloadsDir, { recursive: true });
          } catch {
            downloadsDir = os.homedir();
          }
          const targetPath = path.join(downloadsDir, targetName);
          await fs.promises.writeFile(targetPath, payload.content, "utf8");
          response.data = { path: targetPath, fileName: targetName, downloadsDir };
          void logEssential("config-export", { path: targetPath });
          break;
        }
        default:
          response.success = false;
          response.error = "未知请求";
          break;
      }
    } catch (error) {
      response.success = false;
      response.error = error instanceof Error ? error.message : String(error);
    }

    if (this.panel) {
      void this.panel.webview.postMessage(response);
    }
  }
}
