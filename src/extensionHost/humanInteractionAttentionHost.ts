import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createDesktopAttentionTransport } from "../desktopAttention";
import { createHumanInteractionAttentionController } from "../humanInteractionAttention";
import { CONFIG_NAMESPACE } from "../cli/config";

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
  const controller = createHumanInteractionAttentionController({
    isFocused: () => vscode.window.state.focused,
    isLocal: () => !vscode.env.remoteName || context.extension.extensionKind === vscode.ExtensionKind.UI,
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
    transport: createDesktopAttentionTransport({
      platform: process.platform,
      appName: vscode.env.appName,
      appUserModelId,
      mainProcessId: Number(process.env.VSCODE_PID),
      storagePath: context.globalStorageUri.fsPath,
      env: process.env,
    }),
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
      }
    }),
    new vscode.Disposable(() => { void controller.dispose(); }),
  );
  return controller;
}
