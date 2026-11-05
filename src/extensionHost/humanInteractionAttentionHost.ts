import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createDesktopAttentionTransport } from "../desktopAttention";
import { createHumanInteractionAttentionController } from "../humanInteractionAttention";
import { CONFIG_NAMESPACE } from "../cli/config";
import type { DesktopNotificationAuthorization } from "../desktopNotificationAuthorization";

const WINDOWS_NOTIFICATION_GUIDANCE_KEY = "windowsNotificationSettingsOpened.v1";

export function createHumanInteractionAttentionHost(
  context: vscode.ExtensionContext,
  onError: (channel: "notification" | "window", error: unknown) => void,
) {
  let appUserModelId: string | undefined;
  if (process.platform === "win32") {
    try {
      const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, "product.json"), "utf8")) as {
        win32AppUserModelId?: unknown;
      };
      if (typeof product.win32AppUserModelId === "string") {
        appUserModelId = product.win32AppUserModelId;
      }
    } catch {
      appUserModelId = undefined;
    }
  }
  const isLocal = () => !vscode.env.remoteName || context.extension.extensionKind === vscode.ExtensionKind.UI;
  const transport = createDesktopAttentionTransport({
    platform: process.platform,
    appName: vscode.env.appName,
    appUserModelId,
    mainProcessId: Number(process.env.VSCODE_PID),
    storagePath: context.globalStorageUri.fsPath,
    env: process.env,
  });
  let windowsSettingsRequest: Promise<boolean> | undefined;
  const openWindowsNotificationSettings = (): Promise<boolean> => {
    if (!windowsSettingsRequest) {
      windowsSettingsRequest = (async () => {
        const opened = await vscode.env.openExternal(vscode.Uri.parse("ms-settings:notifications"));
        if (opened) {
          await context.globalState.update(WINDOWS_NOTIFICATION_GUIDANCE_KEY, true);
        }
        return opened;
      })().finally(() => { windowsSettingsRequest = undefined; });
    }
    return windowsSettingsRequest;
  };
  const notificationAuthorization = async (request = false): Promise<DesktopNotificationAuthorization> => {
    if (!isLocal()) {
      return { platform: process.platform, status: "unavailable", detail: "远程扩展宿主不申请本机通知权限，请在本机编辑器中操作。" };
    }
    try {
      const authorization = await transport.notificationAuthorization(false).catch((error: unknown): DesktopNotificationAuthorization => {
        onError("notification", error);
        return { platform: process.platform, status: "unavailable", detail: "通知状态读取失败，请刷新重试。" };
      });
      if (request && process.platform === "win32") {
        const opened = await openWindowsNotificationSettings();
        return { ...authorization, detail: opened
          ? `已打开 Windows 通知设置，请检查“${vscode.env.appName}”的通知、通知横幅及勿扰设置，然后返回刷新状态。`
          : "未能打开 Windows 通知设置，请手动前往“设置 → 系统 → 通知”，检查当前编辑器的通知和通知横幅。" };
      }
      if (request && process.platform === "darwin" && ["authorized", "denied", "disabled"].includes(authorization.status)) {
        const opened = await vscode.env.openExternal(vscode.Uri.parse("x-apple.systempreferences:com.apple.Notifications-Settings.extension"));
        return { ...authorization, detail: opened
          ? "已打开系统通知设置，请选择“携宁 CLI 提醒”并开启允许通知，然后返回刷新状态。"
          : "未能打开系统设置，请手动前往“系统设置 → 通知 → 携宁 CLI 提醒”开启允许通知。" };
      }
      return request && authorization.status === "not-determined"
        ? await transport.notificationAuthorization(true) : authorization;
    } catch (error) {
      onError("notification", error);
      return { platform: process.platform, status: "unavailable", detail: error instanceof Error ? error.message : "通知授权状态读取失败，请重试。" };
    }
  };
  const initializeAuthorization = () => {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    if (!isLocal() || (!config.get<boolean>("humanInteractionNotifications", true) && !config.get<boolean>("taskCompletionNotifications", true))) {
      return;
    }
    if (process.platform === "darwin") {
      void transport.notificationAuthorization(true).catch((error: unknown) => onError("notification", error));
    } else if (process.platform === "win32" && !context.globalState.get<boolean>(WINDOWS_NOTIFICATION_GUIDANCE_KEY, false)) {
      void openWindowsNotificationSettings().then((opened) => {
        if (!opened) onError("notification", new Error("未能打开 Windows 通知设置，可在工具设置的通知设置中重试。"));
      }).catch((error: unknown) => onError("notification", error));
    }
  };
  initializeAuthorization();
  const controller = createHumanInteractionAttentionController({
    isFocused: () => vscode.window.state.focused,
    isLocal,
    readSettings: () => {
      const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
      return {
        notifications: config.get<boolean>("humanInteractionNotifications", true),
        windowAttention: config.get<boolean>("humanInteractionWindowAttention", true),
        taskCompletion: {
          notifications: config.get<boolean>("taskCompletionNotifications", true),
          windowAttention: config.get<boolean>("taskCompletionWindowAttention", true),
        },
      };
    },
    transport,
    onError,
  });
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(() => { void controller.refresh(); }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_NAMESPACE}.humanInteractionNotifications`)
        || event.affectsConfiguration(`${CONFIG_NAMESPACE}.humanInteractionWindowAttention`)
        || event.affectsConfiguration(`${CONFIG_NAMESPACE}.taskCompletionNotifications`)
        || event.affectsConfiguration(`${CONFIG_NAMESPACE}.taskCompletionWindowAttention`)) {
        void controller.refresh();
        initializeAuthorization();
      }
    }),
    new vscode.Disposable(() => { void controller.dispose(); }),
  );
  return { ...controller, notificationAuthorization };
}
