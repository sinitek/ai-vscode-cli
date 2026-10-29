import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { getConfigViewHtml } from "./configView";
import {
  ConfigCloseMessage,
  ConfigRequestMessage,
  ConfigResponseMessage,
  ConfigOpenExternalMessage,
  ConfigOpenPathMessage,
} from "./configProtocol";
import * as configService from "../config/configService";
import { normalizeConfigPlatform } from "../config/configPaths";
import { logEssential, logInfo } from "../logger";
import { t } from "../i18n";
import { buildErrorDetail, showErrorWithActions } from "../errorDisplay";
import { expandHomePath } from "../shared/userHomePaths";
import { normalizeCliEnabledByName, readToolSettings } from "../toolSettings";
import type { CliName } from "../cli/types";

type ConfigManagerHandlers = {
  onConfigChanged?: () => void | Promise<void>;
  getActiveConfigId?: (cli: CliName) => Promise<string | null>;
};

const CONFIG_MAXIMIZE_EDITOR_COMMAND = "workbench.action.maximizeEditorHideSidebar";
const CONFIG_RESTORE_EDITOR_GROUP_COMMAND = "workbench.action.toggleMaximizeEditorGroup";
const CONFIG_TOGGLE_PRIMARY_SIDE_BAR_COMMAND = "workbench.action.toggleSidebarVisibility";
const CONFIG_TOGGLE_SECONDARY_SIDE_BAR_COMMAND = "workbench.action.toggleAuxiliaryBar";

export class ConfigManagerPanel {
  private panel: vscode.WebviewPanel | undefined;
  private editorWidthExpanded = false;
  private editorWidthRequest = 0;
  private editorWidthTask: Promise<boolean> | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: ConfigManagerHandlers = {}
  ) {}

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      this.expandEditorToMaximumWidth();
      this.postCliEnabled();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "sinitek-cli-tools.configManager",
      t("config.panelTitle"),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }
    );

    this.panel.webview.html = getConfigViewHtml(this.panel.webview, this.extensionUri);
    this.expandEditorToMaximumWidth();

    this.panel.webview.onDidReceiveMessage(
      (
        message:
          | ConfigRequestMessage
          | ConfigOpenPathMessage
          | ConfigOpenExternalMessage
          | ConfigCloseMessage
          | { type: "config:debug"; payload?: unknown }
      ) => {
        if (message && message.type === "config:close") {
          this.panel?.dispose();
          return;
        }
        if (message && message.type === "config:debug") {
          void logInfo("config-view-debug", message.payload ?? {});
          return;
        }
        if (message && message.type === "config:openPath") {
          const target = expandHomePath(message.path);
          if (target) {
            const uri = vscode.Uri.file(path.resolve(target));
            void vscode.commands.executeCommand("revealFileInOS", uri);
          }
          return;
        }
        if (message && message.type === "config:openExternal") {
          const target = message.url;
          if (target) {
            void vscode.env.openExternal(vscode.Uri.parse(target));
          }
          return;
        }
        void this.handleRequest(message as ConfigRequestMessage);
      });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.restoreEditorWidth();
    });
  }

  private expandEditorToMaximumWidth(): void {
    if (!this.panel) {
      return;
    }
    const request = ++this.editorWidthRequest;
    this.editorWidthTask = this.applyMaximumEditorWidth(request);
  }

  private async applyMaximumEditorWidth(request: number): Promise<boolean> {
    if (!this.panel || request !== this.editorWidthRequest) {
      return false;
    }
    try {
      await vscode.commands.executeCommand(CONFIG_MAXIMIZE_EDITOR_COMMAND);
    } catch (error: unknown) {
      void logInfo("config-editor-width-expand-failed", {
        command: CONFIG_MAXIMIZE_EDITOR_COMMAND,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    if (!this.panel || request !== this.editorWidthRequest) {
      return true;
    }
    this.editorWidthExpanded = true;
    return true;
  }

  private restoreEditorWidth(): void {
    const request = ++this.editorWidthRequest;
    const pending = this.editorWidthTask ?? Promise.resolve(false);
    const alreadyExpanded = this.editorWidthExpanded;
    this.editorWidthExpanded = false;
    void this.finishEditorWidthRestore(request, pending, alreadyExpanded);
  }

  private async finishEditorWidthRestore(
    request: number,
    pending: Promise<boolean>,
    alreadyExpanded: boolean,
  ): Promise<void> {
    const hidSideBars = await pending;
    if (request !== this.editorWidthRequest || (!alreadyExpanded && !hidSideBars)) {
      return;
    }
    await this.runEditorWidthRestore();
  }

  private async runEditorWidthRestore(): Promise<void> {
    const commands = [
      CONFIG_RESTORE_EDITOR_GROUP_COMMAND,
      CONFIG_TOGGLE_PRIMARY_SIDE_BAR_COMMAND,
      CONFIG_TOGGLE_SECONDARY_SIDE_BAR_COMMAND,
    ];
    for (const command of commands) {
      try {
        await vscode.commands.executeCommand(command);
      } catch (error: unknown) {
        void logInfo("config-editor-width-restore-failed", {
          command,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  public syncActiveConfig(): void {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage({ type: "config:syncActive" });
  }

  public postCliEnabled(): void {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage({
      type: "config:cliEnabled",
      cliEnabledByName: normalizeCliEnabledByName(readToolSettings().cliEnabledByName) ?? {},
    });
  }

  public reload(): void {
    if (!this.panel) {
      return;
    }
    this.panel.title = t("config.panelTitle");
    this.panel.webview.html = getConfigViewHtml(this.panel.webview, this.extensionUri);
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
        case "getOrder":
          response.data = await configService.getConfigOrder(message.platform);
          break;
        case "setOrder":
          await configService.setConfigOrder(message.platform, message.order);
          response.data = true;
          await this.handlers.onConfigChanged?.();
          break;
        case "getById":
          response.data = await configService.getConfigById(message.platform, message.id);
          break;
        case "save":
          await configService.saveConfig(message.config);
          response.data = message.config;
          await this.handlers.onConfigChanged?.();
          break;
        case "copy":
          response.data = await configService.copyConfig(message.payload);
          await this.handlers.onConfigChanged?.();
          break;
        case "delete":
          await configService.deleteConfig(message.platform, message.id);
          response.data = true;
          await this.handlers.onConfigChanged?.();
          break;
        case "getCurrent": {
          const current = await configService.getCurrentConfig(message.platform);
          response.data = {
            ...current,
            activeConfigId: await this.handlers.getActiveConfigId?.(normalizeConfigPlatform(message.platform)) ?? null,
          };
          break;
        }
        case "apply":
          response.data = await configService.applyConfig(message.platform, message.payload);
          await this.handlers.onConfigChanged?.();
          break;
        case "backup":
          response.data = await configService.backupConfig(message.platform);
          break;
        case "getBackups":
          response.data = await configService.getBackupList(message.platform);
          break;
        case "initDefault":
          response.data = await configService.initDefaultConfig(message.platform);
          await this.handlers.onConfigChanged?.();
          break;
        case "getCliSkillsList":
          response.data = await configService.getCliSkillsList(message.platform);
          break;
        case "openCliSkillsDirectory":
          response.data = await configService.openCliSkillsDirectory(message.platform);
          break;
        case "deleteCliSkill":
          response.data = await configService.deleteCliSkill(message.platform, message.name);
          break;
        case "copyCliSkill":
          response.data = await configService.copyCliSkill(
            message.platform,
            message.name,
            message.targetPlatform,
          );
          break;
        case "searchLobehubSkills":
          response.data = await configService.searchLobehubSkills(message.payload);
          break;
        case "installLobehubSkill":
          response.data = await configService.installLobehubSkill(message.payload);
          break;
        case "pickAndInstallLocalSkillZip": {
          const selectedFiles = await vscode.window.showOpenDialog({
            title: "选择 Skills ZIP 包",
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { "ZIP 压缩包": ["zip"] },
          });
          if (!selectedFiles?.[0]) {
            response.data = null;
            break;
          }
          const selectedPlatforms = await vscode.window.showQuickPick(
            [
              { label: "Claude", platform: "claude" },
              { label: "Codex", platform: "codex" },
              { label: "OpenCode", platform: "opencode" },
              { label: "Grok", platform: "grok" },
              { label: "DSH", platform: "dsh" },
              { label: "Kimi Code", platform: "kimi-code" },
              { label: "ZCode", platform: "zcode" },
            ],
            {
              canPickMany: true,
              title: "选择安装目标 CLI",
              placeHolder: "可多选 Skills 安装位置",
            },
          );
          if (!selectedPlatforms?.length) {
            response.data = null;
            break;
          }
          response.data = await configService.installLocalSkillZipFromPath(
            { platforms: selectedPlatforms.map((platform) => platform.platform) },
            selectedFiles[0].fsPath,
          );
          break;
        }
        case "getCliEnabled":
          response.data = {
            cliEnabledByName: normalizeCliEnabledByName(readToolSettings().cliEnabledByName) ?? {},
          };
          break;
        case "exportConfigs": {
          const payload = message.payload;
          if (!payload || typeof payload.content !== "string") {
            throw new Error(t("config.exportContentEmpty"));
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
          response.error = t("config.unknownRequest");
          break;
      }
    } catch (error) {
      response.success = false;
      response.error = buildErrorDetail(error);
      if (message.action === "apply") {
        void showErrorWithActions(
          t("config.applyFailedTitle"),
          error,
          { detailTitle: t("config.applyFailedTitle") }
        );
      }
    }

    if (this.panel) {
      void this.panel.webview.postMessage(response);
    }
  }
}
