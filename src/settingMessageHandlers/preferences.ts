import { getDebugLogging } from "../cli/config";
import { LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT, normalizeChatMessageLimit } from "../chatMessageLimit";
import { setDebugLogging } from "../logger";
import { normalizeDepartmentMaxEmployees, normalizeDepartmentMaxLeaders, normalizeWorkspaceDepartmentCapacity } from "../departmentSettings";
import { assertDepartmentConfigBindingsCurrent, captureDepartmentConfigBindings, normalizeDepartmentRolePreference, validateDepartmentRoleCandidate } from "../departmentConfiguration";
import { departmentRoleCliIssue } from "../department";
import { resolveLoopPlusDecisionSubtaskMax, resolveLoopPlusSubtaskMaxRounds } from "../loopPlusDecision";
import { normalizePromptInputHeight } from "../promptInputHeight";
import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import { normalizeWorkspaceLoopPlusDecisionSubtaskMax } from "../workspaceSettingsStore";
import {
  normalizeHistoryRetentionDays,
  resolveHumanInteractionTimeoutMinutes,
  resolveNewTaskInteractiveMode,
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
  | "isMacTaskShell"
  | "readStoredToolSettings"
  | "getCurrentCli"
  | "setCurrentCli"
  | "retargetDisabledLoopSubtaskSelections"
  | "publishCliEnabled"
  | "saveWorkspaceSettingsWithResult"
  | "setWorkspaceSettings"
  | "getActiveConfigIdForCli"
  | "getDepartmentConfigurationScope"
  | "getDepartmentSelectionContextRevision"
  | "readDepartmentConfigBinding"
  | "beginDepartmentConfigurationSave"
  | "getDepartmentRoleCandidates"
  | "getWorkspaceSettings"
  | "postWebviewMessage"
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
  command(["loopEnabled", "loopPlusEnabled", "departmentEnabled"], (message, deps) => {
    if (typeof message.value !== "boolean") return;
    const saved = deps.updateStoredToolSettings({ [message.key]: message.value });
    if (!saved) deps.showWebviewError(WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.taskModesSaveError);
  }),
  command("newTaskInteractiveMode", (message, deps) => {
    const mode = resolveNewTaskInteractiveMode(message.value);
    if (message.value === mode && !deps.updateStoredToolSettings({ newTaskInteractiveMode: mode })) {
      deps.showWebviewError(WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.toolSettingsNewTaskInteractiveModeSaveError);
    }
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
  command("loopPlusSubtaskMaxRounds", (message, deps) => {
    const saved = deps.updateStoredToolSettings({ loopPlusSubtaskMaxRounds: resolveLoopPlusSubtaskMaxRounds(message.value) });
    if (!saved) deps.showWebviewError(WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.taskModesSaveError);
  }),
  command("loopPlusDecisionSubtaskMax", (message, deps) => {
    deps.updateStoredToolSettings({
      loopPlusDecisionSubtaskMax: resolveLoopPlusDecisionSubtaskMax(message.value),
    });
  }),
  command("workspaceLoopPlusDecisionSubtaskMax", (message, deps, { workspaceSettings }) => {
    if (message.value === null || (typeof message.value === "string" && !message.value.trim())) {
      delete workspaceSettings.loopPlusDecisionSubtaskMax;
    } else {
      const value = normalizeWorkspaceLoopPlusDecisionSubtaskMax(message.value);
      if (value === undefined) return;
      workspaceSettings.loopPlusDecisionSubtaskMax = value;
    }
    deps.saveWorkspaceSettings(workspaceSettings);
  }),
  command("departmentMaxLeaders", (message, deps) => {
    const saved = deps.updateStoredToolSettings({ departmentMaxLeaders: normalizeDepartmentMaxLeaders(message.value) });
    if (!saved) deps.showWebviewError(WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.departmentMaxLeadersSaveError);
  }),
  command("departmentMaxEmployees", (message, deps) => {
    const saved = deps.updateStoredToolSettings({ departmentMaxEmployees: normalizeDepartmentMaxEmployees(message.value) });
    if (!saved) deps.showWebviewError(WEBVIEW_STRINGS.toolSettingsTitle, WEBVIEW_STRINGS.departmentMaxEmployeesSaveError);
  }),
  command(["workspaceDepartmentMaxLeaders", "workspaceDepartmentMaxEmployees"], (message, deps) => {
    const raw = message.value as { scope?: unknown; requestId?: unknown; value?: unknown } | null;
    const scope = deps.getDepartmentConfigurationScope?.();
    if (!raw || typeof raw !== "object" || typeof raw.requestId !== "string") return;
    const key = message.key === "workspaceDepartmentMaxLeaders" ? "departmentMaxLeaders" : "departmentMaxEmployees";
    const respond = (ok: boolean, error?: string): void => {
      // Stale requests receive a scoped reply, never an error in the replacement workspace.
      deps.postWebviewMessage({ type: "workspaceDepartmentCapacitySaved", scope: raw.scope, requestId: raw.requestId, key: message.key, ok, error });
      if (error && raw.scope === deps.getDepartmentConfigurationScope?.()) deps.showWebviewError("产研部配置", error);
    };
    if (!scope || raw.scope !== scope) { respond(false, "工作区作用域已变化，请在当前工作区重试。"); return; }
    const clear = raw.value === null || (typeof raw.value === "string" && !raw.value.trim());
    const value = normalizeWorkspaceDepartmentCapacity(raw.value);
    if (!clear && value === undefined) { respond(false, "人数必须为取整后大于零的安全数字，留空继承全局。"); return; }
    const next = { ...deps.getWorkspaceSettings() };
    if (clear) delete next[key];
    else next[key] = value;
    try {
      if (!deps.setWorkspaceSettings || !deps.saveWorkspaceSettingsWithResult?.(next).ok) {
        respond(false, "工作区人数设置保存失败，请重试。"); return;
      }
    } catch { respond(false, "工作区人数设置保存失败，请重试。"); return; }
    if (scope !== deps.getDepartmentConfigurationScope?.()) { respond(false, "工作区作用域已变化，请重新加载设置。"); return; }
    deps.setWorkspaceSettings(next);
    respond(true);
  }),
  command("departmentRolePreference", async (message, deps, { currentCli, workspaceSettings }) => {
    const value = message.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const raw = value as Record<string, unknown>;
    const scope = deps.getDepartmentConfigurationScope?.();
    const contextRevision = deps.getDepartmentSelectionContextRevision?.();
    let finish: ((ok: boolean) => void) | undefined;
    let bindingSnapshot: Awaited<ReturnType<typeof captureDepartmentConfigBindings>> | undefined;
    const respond = (ok: boolean, error?: string): void => {
      finish?.(ok);
      if (error && scope === deps.getDepartmentConfigurationScope?.()) deps.showWebviewError("产研部配置", error);
      deps.postWebviewMessage({ scope, type: "departmentRolePreferenceSaved", requestId: raw.requestId, role: raw.role, directorConfigId: raw.directorConfigId, ok, error });
    };
    if (scope !== raw.scope) { respond(false, "工作区或配置作用域已变化，请重新选择角色配置。"); return; }
    const role = raw.role === "leader" || raw.role === "employee" ? raw.role : null;
    const preference = normalizeDepartmentRolePreference(raw.preference);
    const directorConfigId = deps.getActiveConfigIdForCli(currentCli);
    if (!role || !preference || !directorConfigId || raw.directorConfigId !== directorConfigId) {
      respond(false, "角色配置或总监当前档案无效，请重新选择后重试。");
      return;
    }
    const cliIssue = departmentRoleCliIssue(role, preference.cli);
    if (cliIssue) { respond(false, cliIssue); return; }
    if (deps.readStoredToolSettings?.().cliEnabledByName?.[preference.cli] === false) {
      respond(false, "所选 CLI 已关闭，请选择可用 CLI。");
      return;
    }
    const targetConfigId = deps.getActiveConfigIdForCli(preference.cli);
    if (!targetConfigId || preference.configId !== targetConfigId) {
      respond(false, "所选 CLI 当前没有该激活档案，请重新选择角色配置。");
      return;
    }
    try {
      finish = deps.beginDepartmentConfigurationSave?.(scope ?? "", role);
      if (!deps.readDepartmentConfigBinding) throw new Error("角色 CLI 绑定校验接口不可用，请稍后重试。");
      bindingSnapshot = await captureDepartmentConfigBindings([
        { cli: currentCli, configId: directorConfigId },
        { cli: preference.cli, configId: preference.configId },
      ], deps.readDepartmentConfigBinding);
      if (scope !== deps.getDepartmentConfigurationScope?.() || contextRevision !== deps.getDepartmentSelectionContextRevision?.()) {
        throw new Error("CLI、模式或配置作用域已变化，请重新选择角色配置。");
      }
      if (!deps.getDepartmentRoleCandidates) throw new Error("角色候选读取接口不可用，请稍后重试。");
      validateDepartmentRoleCandidate(preference, await deps.getDepartmentRoleCandidates(preference.cli, preference.configId));
      if (scope !== deps.getDepartmentConfigurationScope?.() || contextRevision !== deps.getDepartmentSelectionContextRevision?.()) {
        throw new Error("CLI、模式或模型选择已变化，请重新选择角色配置。");
      }
      await assertDepartmentConfigBindingsCurrent(bindingSnapshot, deps.readDepartmentConfigBinding);
    } catch (error) {
      respond(false, error instanceof Error ? error.message : "角色配置校验失败，请重试。");
      return;
    }
    // Candidate reads may be asynchronous: never save into a director scope that changed while loading.
    if (scope !== deps.getDepartmentConfigurationScope?.() || contextRevision !== deps.getDepartmentSelectionContextRevision?.() || deps.getActiveConfigIdForCli(currentCli) !== directorConfigId || deps.getCurrentCli() !== currentCli
      || deps.getActiveConfigIdForCli(preference.cli) !== targetConfigId) {
      respond(false, "总监或所选 CLI 激活档案已变化，请在当前档案重新选择角色配置。");
      return;
    }
    if (deps.readStoredToolSettings?.().cliEnabledByName?.[preference.cli] === false) {
      respond(false, "所选 CLI 已关闭，请选择可用 CLI。");
      return;
    }
    try {
      if (!bindingSnapshot || !deps.readDepartmentConfigBinding) throw new Error("角色 CLI 绑定校验接口不可用，请重试。");
      await assertDepartmentConfigBindingsCurrent(bindingSnapshot, deps.readDepartmentConfigBinding);
    } catch (error) {
      respond(false, error instanceof Error ? error.message : "角色 CLI 配置已变化，请重新选择后重试。");
      return;
    }
    if (scope !== deps.getDepartmentConfigurationScope?.() || contextRevision !== deps.getDepartmentSelectionContextRevision?.()
      || deps.getCurrentCli() !== currentCli || deps.getActiveConfigIdForCli(currentCli) !== directorConfigId
      || deps.getActiveConfigIdForCli(preference.cli) !== targetConfigId) {
      respond(false, "总监或所选 CLI 配置上下文已变化，请重新选择角色配置。");
      return;
    }
    const latest = deps.getWorkspaceSettings();
    const current = latest.departmentRoleRoutesByDirectorConfig?.[directorConfigId];
    const next: typeof workspaceSettings = {
      ...latest,
      departmentRoleRoutesByDirectorConfig: {
        ...latest.departmentRoleRoutesByDirectorConfig,
        [directorConfigId]: {
          ...current,
          [role]: preference,
        },
      },
    };
    let result: ReturnType<NonNullable<PreferenceSettingDeps["saveWorkspaceSettingsWithResult"]>> | undefined;
    try { result = deps.setWorkspaceSettings ? deps.saveWorkspaceSettingsWithResult?.(next) : undefined; }
    catch { respond(false, "角色配置保存失败，请重试。"); return; }
    if (result && !result.ok) {
      respond(false, "角色配置保存失败，请重试。");
      return;
    }
    if (!result) {
      respond(false, "角色配置保存接口暂不可用，请重试。");
      return;
    }
    deps.setWorkspaceSettings?.(next);
    respond(true);
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
  command("promptInputHeight", (message, deps) => {
    const height = normalizePromptInputHeight(message.value);
    if (height !== undefined && !deps.updateStoredToolSettings({ promptInputHeight: height })) {
      deps.showWebviewError(WEBVIEW_STRINGS.appTitle, WEBVIEW_STRINGS.promptInputHeightSaveError);
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
