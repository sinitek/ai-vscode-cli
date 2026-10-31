import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { getConfigViewHtml, type ConfigViewHostMode } from "./configView";
import {
  ConfigCloseMessage,
  ConfigRequestMessage,
  ConfigResponseMessage,
  ConfigOpenExternalMessage,
  ConfigOpenPathMessage,
  ConfigNavigationTarget,
  ConfigReadyMessage,
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

const CONFIG_MANAGER_VIEW_TYPE = "sinitek-cli-tools.configManager";
const CONFIG_MANAGER_URI = vscode.Uri.parse(
  "sinitek-config:/sinitek-cli-config.sinitek-cli-config",
);
const CONFIG_MODAL_EDITOR_GROUP = -4;
const CONFIG_INTERNAL_OPEN_COMMAND = "_workbench.openWith";
const CONFIG_MODAL_CAPABILITY_COMMAND = "workbench.action.closeModalEditor";
const CONFIG_NEW_WINDOW_COMMAND = "workbench.action.moveEditorToNewWindow";
const CONFIG_MODAL_WIDTH = 1600;
const CONFIG_MODAL_HEIGHT = 900;

export class ConfigManagerPanel implements vscode.CustomReadonlyEditorProvider {
  private panel: vscode.WebviewPanel | undefined;
  private viewReady = false;
  private pendingNavigation: ConfigNavigationTarget | undefined;
  private customEditorRegistration: vscode.Disposable | undefined;
  private nativeModalOpenTask: Promise<void> | undefined;
  private nativeModalUnavailable = false;
  private panelMode: ConfigViewHostMode = "window";

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: ConfigManagerHandlers = {}
  ) {}

  public registerCustomEditorProvider(): vscode.Disposable | undefined {
    if (this.customEditorRegistration) {
      return this.customEditorRegistration;
    }
    const registerCustomEditorProvider = vscode.window.registerCustomEditorProvider;
    if (typeof registerCustomEditorProvider !== "function") {
      return undefined;
    }
    this.customEditorRegistration = registerCustomEditorProvider.call(
      vscode.window,
      CONFIG_MANAGER_VIEW_TYPE,
      this,
      {
        webviewOptions: {
          enableFindWidget: true,
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      },
    );
    return this.customEditorRegistration;
  }

  public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return {
      uri,
      dispose: () => undefined,
    };
  }

  public resolveCustomEditor(
    _document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
  ): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    this.attachPanel(webviewPanel, "native-modal");
  }

  public show(target?: ConfigNavigationTarget): void {
    this.pendingNavigation = target;
    if (this.panel) {
      if (this.panelMode === "native-modal") {
        void this.openNativeModal();
      } else {
        this.panel.reveal(this.panel.viewColumn, false);
      }
      this.postCliEnabled();
      this.postPendingNavigation();
      return;
    }

    if (!this.nativeModalUnavailable && this.customEditorRegistration) {
      void this.openNativeModal();
      return;
    }
    this.openWindowPanel();
  }

  private async openNativeModal(): Promise<void> {
    if (this.nativeModalOpenTask) {
      return this.nativeModalOpenTask;
    }
    this.nativeModalOpenTask = (async () => {
      try {
        const commands = await vscode.commands.getCommands(true);
        const modalMode = vscode.workspace.getConfiguration("workbench.editor").get<string>("useModal");
        if (!commands.includes(CONFIG_MODAL_CAPABILITY_COMMAND) || modalMode === "off") {
          throw new Error("当前 VS Code 未启用原生模态编辑器");
        }
        await vscode.commands.executeCommand(
          CONFIG_INTERNAL_OPEN_COMMAND,
          CONFIG_MANAGER_URI,
          CONFIG_MANAGER_VIEW_TYPE,
          [CONFIG_MODAL_EDITOR_GROUP, {
            preserveFocus: false,
            pinned: true,
            modal: {
              maximized: false,
              size: { width: CONFIG_MODAL_WIDTH, height: CONFIG_MODAL_HEIGHT },
            },
          }],
        );
        if (!this.panel) {
          throw new Error("原生模态编辑器未加载配置页面");
        }
      } catch (error: unknown) {
        this.nativeModalUnavailable = true;
        void logInfo("config-native-modal-open-failed", {
          command: CONFIG_INTERNAL_OPEN_COMMAND,
          viewType: CONFIG_MANAGER_VIEW_TYPE,
          error: error instanceof Error ? error.message : String(error),
        });
        this.openWindowPanel();
      }
    })().finally(() => {
      this.nativeModalOpenTask = undefined;
    });
    return this.nativeModalOpenTask;
  }

  private openWindowPanel(): void {
    const panel = this.panel ?? vscode.window.createWebviewPanel(
      CONFIG_MANAGER_VIEW_TYPE,
      t("config.panelTitle"),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    );
    if (this.panel !== panel) {
      this.attachPanel(panel, "window");
    }
    if (this.panelMode !== "window") {
      this.panelMode = "window";
      this.reload();
    }
    void vscode.commands.executeCommand(CONFIG_NEW_WINDOW_COMMAND).then(undefined, (error: unknown) => {
      void logInfo("config-window-open-failed", {
        command: CONFIG_NEW_WINDOW_COMMAND,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private attachPanel(
    panel: vscode.WebviewPanel,
    mode: ConfigViewHostMode,
  ): void {
    this.panel = panel;
    this.panelMode = mode;
    this.viewReady = false;
    panel.title = t("config.panelTitle");
    panel.webview.html = getConfigViewHtml(panel.webview, this.extensionUri, mode);
    this.panel.webview.onDidReceiveMessage(
      (
        message:
          | ConfigRequestMessage
          | ConfigOpenPathMessage
          | ConfigOpenExternalMessage
          | ConfigCloseMessage
          | ConfigReadyMessage
          | { type: "config:debug"; payload?: unknown }
      ) => {
        if (message && message.type === "config:ready") {
          this.viewReady = true;
          this.postCliEnabled();
          this.postPendingNavigation();
          return;
        }
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

    panel.onDidDispose(() => {
      if (this.panel !== panel) {
        return;
      }
      this.panel = undefined;
      this.viewReady = false;
      this.pendingNavigation = undefined;
    });
  }

  private postPendingNavigation(): void {
    if (!this.panel || !this.viewReady || !this.pendingNavigation) {
      return;
    }
    const target = this.pendingNavigation;
    this.pendingNavigation = undefined;
    void this.panel.webview.postMessage({ type: "config:navigate", target });
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
    this.viewReady = false;
    this.panel.title = t("config.panelTitle");
    this.panel.webview.html = getConfigViewHtml(this.panel.webview, this.extensionUri, this.panelMode);
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
