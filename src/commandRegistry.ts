import * as vscode from "vscode";
import { CLI_LIST, CliName } from "./cli/types";
import { t } from "./i18n";
import {
  LEGACY_LOOP_GROUP_CHAT_COMMAND_ID,
  LOOP_GROUP_CHAT_COMMAND_ID,
} from "./loopLegacyMigration";

export type ExtensionCommandRegistryDeps = {
  isCliName: (value: string) => value is CliName;
  getCurrentCli: () => CliName;
  setCurrentCli: (cli: CliName) => Promise<void>;
  runCli: (cli: CliName, options?: { thinkingMode?: "on" | "off" }) => Promise<void>;
  revealPanelView: () => Promise<void>;
  postPanelState: () => Promise<void>;
  openLoopGroupChatPanel: (arg?: unknown) => Promise<void>;
  showInformationMessage?: typeof vscode.window.showInformationMessage;
};

export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  deps: ExtensionCommandRegistryDeps
): void {
  const showInformationMessage = deps.showInformationMessage ?? vscode.window.showInformationMessage.bind(vscode.window);
  context.subscriptions.push(
    vscode.commands.registerCommand("sinitek-cli-tools.selectCli", async () => {
      const selection = await vscode.window.showQuickPick(CLI_LIST, {
        placeHolder: t("command.selectCliPlaceholder"),
      });

      if (!selection || !deps.isCliName(selection)) {
        return;
      }

      await deps.setCurrentCli(selection);
      showInformationMessage(
        t("command.currentCliInfo", { cli: deps.getCurrentCli() })
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sinitek-cli-tools.runCli", async () => {
      await deps.runCli(deps.getCurrentCli());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sinitek-cli-tools.runCliThinkingOn",
      async () => {
        await deps.runCli(deps.getCurrentCli(), { thinkingMode: "on" });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sinitek-cli-tools.runCliThinkingOff",
      async () => {
        await deps.runCli(deps.getCurrentCli(), { thinkingMode: "off" });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sinitek-cli-tools.openPanel", async () => {
      await deps.revealPanelView();
      await deps.postPanelState();
    })
  );

  const openLoopGroupChat = async (arg?: unknown): Promise<void> => {
    await deps.openLoopGroupChatPanel(arg);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(LOOP_GROUP_CHAT_COMMAND_ID, openLoopGroupChat),
    vscode.commands.registerCommand(LEGACY_LOOP_GROUP_CHAT_COMMAND_ID, openLoopGroupChat),
  );
}
