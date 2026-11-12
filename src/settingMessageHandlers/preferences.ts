import { getDebugLogging } from "../cli/config";
import { LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT, normalizeChatMessageLimit } from "../chatMessageLimit";
import { setDebugLogging } from "../logger";
import { resolveLoopPlusDecisionSubtaskMax, resolveLoopPlusMaxAcceptances } from "../loopPlusDecision";
import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import {
  normalizeHistoryRetentionDays,
  resolveHumanInteractionTimeoutMinutes,
  resolveNextEnabledCli,
  type CliEnabledByName,
} from "../toolSettings";
import { WEBVIEW_STRINGS } from "../webview/viewContentStrings";
import { prefixedSettingCommand, settingCommand, type SettingCommand } from "./types";

export type PreferenceSettingDeps = Pick<
  PanelMessageHandlerDeps,
  | "isCliName"
  | "isInteractiveMode"
  | "setWorkspaceInteractiveModeForCli"
  | "updateNotificationSetting"
  | "showWebviewError"
  | "updateStoredToolSettings"
  | "saveWorkspaceSettings"
  | "normalizeLoopMaxRounds"
  | "isMacTaskShell"
  | "readStoredToolSettings"
  | "getCurrentCli"
  | "setCurrentCli"
  | "retargetDisabledLoopSubtaskSelections"
  | "publishCliEnabled"
>;

const command = settingCommand<PreferenceSettingDeps>;
const prefixCommand = prefixedSettingCommand<PreferenceSettingDeps>;
const notificationSettingKeys = [
  "humanInteractionNotifications", "taskCompletionNotifications",
  "humanInteractionWindowAttention", "taskCompletionWindowAttention",
] as const;

export const preferenceSettingCommands: readonly SettingCommand<PreferenceSettingDeps>[] = [
  prefixCommand("interactiveMode.", (message, deps) => {
    const cliValue = message.key.slice("interactiveMode.".length);
    if (deps.isCliName(cliValue) && deps.isInteractiveMode(message.value)) {
      deps.setWorkspaceInteractiveModeForCli(cliValue, message.value);
    }
  }),
  command(notificationSettingKeys, async (message, deps) => {
    try {
      if (typeof message.value === "boolean" && deps.updateNotificationSetting) {
        const key = message.key as (typeof notificationSettingKeys)[number];
        await deps.updateNotificationSetting(key, message.value);
      }
    } catch (error) {
      deps.showWebviewError("通知设置", error instanceof Error ? `保存通知设置失败：${error.message}` : "保存通知设置失败，请重试。");
    }
  }),
  command("humanInteractionEnabled", (message, deps) => {
    deps.updateStoredToolSettings({ humanInteractionEnabled: Boolean(message.value) });
  }),
  command(["autoCompactContextAfterRun", "autoCompactContextBeforeRun"], (message, deps, { workspaceSettings }) => {
    const savedGlobally = deps.updateStoredToolSettings({
      autoCompactContextAfterRun: Boolean(message.value),
    });
    if (savedGlobally
      && ("autoCompactContextAfterRun" in workspaceSettings
        || "autoCompactContextBeforeRun" in workspaceSettings)) {
      delete workspaceSettings.autoCompactContextAfterRun;
      delete workspaceSettings.autoCompactContextBeforeRun;
      deps.saveWorkspaceSettings(workspaceSettings);
    }
  }),
  command("loopMaxRounds", (message, deps, { workspaceSettings }) => {
    deps.updateStoredToolSettings({ loopMaxRounds: deps.normalizeLoopMaxRounds(message.value) });
    if ("loopMaxRounds" in workspaceSettings) {
      delete workspaceSettings.loopMaxRounds;
      deps.saveWorkspaceSettings(workspaceSettings);
    }
  }),
  command("loopPlusDecisionSubtaskMax", (message, deps) => {
    deps.updateStoredToolSettings({
      loopPlusDecisionSubtaskMax: resolveLoopPlusDecisionSubtaskMax(message.value),
    });
  }),
  command("loopPlusMaxAcceptances", (message, deps) => {
    deps.updateStoredToolSettings({
      loopPlusMaxAcceptances: resolveLoopPlusMaxAcceptances(message.value),
    });
  }),
  command("humanInteractionTimeoutMinutes", (message, deps) => {
    deps.updateStoredToolSettings({
      humanInteractionTimeoutMinutes: resolveHumanInteractionTimeoutMinutes(message.value),
    });
  }),
  command("chatMessageLimit", (message, deps) => {
    const saved = deps.updateStoredToolSettings({ chatMessageLimit: normalizeChatMessageLimit(message.value) });
    if (!saved) {
      deps.showWebviewError(WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.toolSettingsChatMessageLimitSaveError);
    }
  }),
  command("loopGroupChatMessageLimit", (message, deps) => {
    const saved = deps.updateStoredToolSettings({
      loopGroupChatMessageLimit: normalizeChatMessageLimit(message.value, LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT),
    });
    if (!saved) {
      deps.showWebviewError(WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.toolSettingsLoopGroupChatMessageLimitSaveError);
    }
  }),
  command("hideInstructionBubbles", (message, deps) => {
    const saved = deps.updateStoredToolSettings({ hideInstructionBubbles: message.value === true });
    if (!saved) {
      deps.showWebviewError(WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.toolSettingsHideInstructionBubblesSaveError);
    }
  }),
  command("historyRetentionDays", (message, deps) => {
    deps.updateStoredToolSettings({ historyRetentionDays: normalizeHistoryRetentionDays(message.value) });
  }),
  command("debug", (message, deps) => {
    deps.updateStoredToolSettings({ debug: Boolean(message.value) });
    setDebugLogging(getDebugLogging());
  }),
  command("autoAddEditorContextTags", (message, deps) => {
    deps.updateStoredToolSettings({ autoAddEditorContextTags: Boolean(message.value) });
  }),
  command(["workspaceMemoryEnabled", "longTermMemoryEnabled"], (message, deps, { workspaceSettings }) => {
    workspaceSettings.workspaceMemoryEnabled = message.value === true;
    deps.saveWorkspaceSettings(workspaceSettings);
  }),
  command("macTaskShell", (message, deps) => {
    if (process.platform === "darwin" && deps.isMacTaskShell(message.value)) {
      deps.updateStoredToolSettings({ macTaskShell: message.value });
    }
  }),
  prefixCommand("cliEnabled.", async (message, deps) => {
    const cliValue = message.key.slice("cliEnabled.".length);
    if (!deps.isCliName(cliValue) || typeof message.value !== "boolean") {
      return;
    }
    const currentSettings = deps.readStoredToolSettings?.() ?? {};
    const nextMap: CliEnabledByName = {};
    const previous = currentSettings.cliEnabledByName;
    if (previous && typeof previous === "object") {
      for (const [key, value] of Object.entries(previous)) {
        if (deps.isCliName(key) && typeof value === "boolean") {
          nextMap[key] = value;
        }
      }
    }
    nextMap[cliValue] = message.value;
    const saved = deps.updateStoredToolSettings({ cliEnabledByName: nextMap });
    if (saved) {
      const nextCli = resolveNextEnabledCli(deps.getCurrentCli(), { cliEnabledByName: nextMap });
      if (nextCli && nextCli !== deps.getCurrentCli()) {
        await deps.setCurrentCli(nextCli);
      }
      deps.retargetDisabledLoopSubtaskSelections?.(nextCli);
      deps.publishCliEnabled?.(nextMap);
    }
  }),
];
