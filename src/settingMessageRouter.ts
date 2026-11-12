import type { PanelMessageHandlerDeps } from "./sessionMessageHandlers";
import { modelSettingCommands, type ModelSettingDeps } from "./settingMessageHandlers/model";
import { preferenceSettingCommands, type PreferenceSettingDeps } from "./settingMessageHandlers/preferences";
import type { SettingMessage } from "./settingMessageHandlers/types";

type SettingMessageRouterDeps = Pick<
  PanelMessageHandlerDeps,
  keyof ModelSettingDeps | keyof PreferenceSettingDeps | "getWorkspaceSettings" | "postPanelState"
>;

export async function routeSettingMessage(
  message: SettingMessage,
  deps: SettingMessageRouterDeps
): Promise<void> {
  const currentCli = deps.getCurrentCli();
  const workspaceSettings = deps.getWorkspaceSettings();
  const context = { currentCli, workspaceSettings };
  const modelCommand = modelSettingCommands.find((command) => command.matches(message));
  if (modelCommand) {
    await modelCommand.execute(message, {
      isThinkingMode: deps.isThinkingMode,
      normalizeThinkingModeForCli: deps.normalizeThinkingModeForCli,
      saveWorkspaceSettings: deps.saveWorkspaceSettings,
      setCliModelThinkingMode: deps.setCliModelThinkingMode,
      getSelectedCliModel: deps.getSelectedCliModel,
      isCliName: deps.isCliName,
      selectCliModel: deps.selectCliModel,
      getActiveConfigIdForCli: deps.getActiveConfigIdForCli,
      loadModelStore: deps.loadModelStore,
      selectLoopSubtaskMode: deps.selectLoopSubtaskMode,
      showWebviewError: deps.showWebviewError,
      seedLoopFullstackRole: deps.seedLoopFullstackRole,
      selectLoopFullstackCli: deps.selectLoopFullstackCli,
      setLoopRoleExplicitModel: deps.setLoopRoleExplicitModel,
      setLoopRoleThinking: deps.setLoopRoleThinking,
      selectLoopFrontendCli: deps.selectLoopFrontendCli,
      selectCliLoopModel: deps.selectCliLoopModel,
      getSelectedLoopCliModel: deps.getSelectedLoopCliModel,
      setSelectedLoopThinkingMode: deps.setSelectedLoopThinkingMode,
    }, context);
  } else {
    const preferenceCommand = preferenceSettingCommands.find((command) => command.matches(message));
    if (!preferenceCommand) {
      return;
    }
    await preferenceCommand.execute(message, {
      isCliName: deps.isCliName,
      isInteractiveMode: deps.isInteractiveMode,
      setWorkspaceInteractiveModeForCli: deps.setWorkspaceInteractiveModeForCli,
      updateNotificationSetting: deps.updateNotificationSetting,
      showWebviewError: deps.showWebviewError,
      updateStoredToolSettings: deps.updateStoredToolSettings,
      saveWorkspaceSettings: deps.saveWorkspaceSettings,
      normalizeLoopMaxRounds: deps.normalizeLoopMaxRounds,
      isMacTaskShell: deps.isMacTaskShell,
      readStoredToolSettings: deps.readStoredToolSettings,
      getCurrentCli: deps.getCurrentCli,
      setCurrentCli: deps.setCurrentCli,
      retargetDisabledLoopSubtaskSelections: deps.retargetDisabledLoopSubtaskSelections,
      publishCliEnabled: deps.publishCliEnabled,
    }, context);
  }
  await deps.postPanelState();
}
