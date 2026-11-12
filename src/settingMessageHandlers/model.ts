import { parseCliName } from "../subtaskCliRoute";
import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import { prefixedSettingCommand, settingCommand, type SettingCommand } from "./types";

export type ModelSettingDeps = Pick<
  PanelMessageHandlerDeps,
  | "isThinkingMode"
  | "normalizeThinkingModeForCli"
  | "saveWorkspaceSettings"
  | "setCliModelThinkingMode"
  | "getSelectedCliModel"
  | "isCliName"
  | "selectCliModel"
  | "getActiveConfigIdForCli"
  | "loadModelStore"
  | "selectLoopSubtaskMode"
  | "showWebviewError"
  | "seedLoopFullstackRole"
  | "selectLoopFullstackCli"
  | "setLoopRoleExplicitModel"
  | "setLoopRoleThinking"
  | "selectLoopFrontendCli"
  | "selectCliLoopModel"
  | "getSelectedLoopCliModel"
  | "setSelectedLoopThinkingMode"
>;

const command = settingCommand<ModelSettingDeps>;
const prefixCommand = prefixedSettingCommand<ModelSettingDeps>;

export const modelSettingCommands: readonly SettingCommand<ModelSettingDeps>[] = [
  command("thinkingMode", (message, deps, { currentCli, workspaceSettings }) => {
    if (deps.isThinkingMode(message.value)) {
      const normalizedThinkingMode = deps.normalizeThinkingModeForCli(currentCli, message.value);
      workspaceSettings.thinkingMode = normalizedThinkingMode;
      deps.saveWorkspaceSettings(workspaceSettings);
      deps.setCliModelThinkingMode(currentCli, deps.getSelectedCliModel(currentCli) ?? "", normalizedThinkingMode);
    }
  }),
  prefixCommand("selectedModel.", (message, deps) => {
    const cliValue = message.key.slice("selectedModel.".length);
    if (deps.isCliName(cliValue)) {
      const modelValue = typeof message.value === "string" ? message.value : null;
      deps.selectCliModel(cliValue, modelValue, deps.getActiveConfigIdForCli(cliValue));
      deps.loadModelStore();
    }
  }),
  prefixCommand("loopSubtaskMode.", (message, deps) => {
    const configId = message.key.slice("loopSubtaskMode.".length).trim();
    const mode = message.value === "split" ? "split" : message.value === "fullstack" ? "fullstack" : null;
    if (!configId || !mode || !deps.selectLoopSubtaskMode) {
      return;
    }
    const saved = deps.selectLoopSubtaskMode(configId, mode);
    deps.loadModelStore();
    if (!saved) {
      deps.showWebviewError?.("模型配置", "全栈模式保存失败，已恢复原来的选择。");
    }
  }),
  prefixCommand("seedLoopFullstackRole.", (message, deps) => {
    const configId = message.key.slice("seedLoopFullstackRole.".length).trim();
    if (configId && deps.seedLoopFullstackRole) {
      const saved = deps.seedLoopFullstackRole(configId);
      deps.loadModelStore();
      if (!saved) {
        deps.showWebviewError?.("模型配置", "子-全栈配置初始化失败，已恢复原来的选择。");
      }
    }
  }),
  prefixCommand("selectedLoopFullstackCli.", (message, deps) => {
    const configId = message.key.slice("selectedLoopFullstackCli.".length).trim();
    const cli = typeof message.value === "string" ? parseCliName(message.value) : null;
    if (configId && cli && deps.selectLoopFullstackCli) {
      const saved = deps.selectLoopFullstackCli(configId, cli);
      deps.loadModelStore();
      if (!saved) {
        deps.showWebviewError?.("模型配置", "子-全栈 CLI 保存失败，已恢复原来的选择。");
      }
    }
  }),
  {
    matches: ({ key, value }) => key === "loopRoleExplicitModel" && Boolean(value) && typeof value === "object",
    execute: (message, deps) => {
      const payload = message.value as { configId?: unknown; role?: unknown; model?: unknown };
      const role = payload.role === "frontend" || payload.role === "fullstack" ? payload.role : null;
      const configId = typeof payload.configId === "string" ? payload.configId.trim() : "";
      if (configId && role && deps.setLoopRoleExplicitModel && typeof payload.model === "string") {
        const saved = deps.setLoopRoleExplicitModel(configId, role, payload.model);
        deps.loadModelStore();
        if (!saved) {
          deps.showWebviewError?.("模型配置", "子模型保存失败，已恢复原来的选择。");
        }
      }
    },
  },
  {
    matches: ({ key, value }) => key === "loopRoleThinking" && Boolean(value) && typeof value === "object",
    execute: (message, deps) => {
      const payload = message.value as { configId?: unknown; role?: unknown; model?: unknown; thinkingMode?: unknown };
      const role = payload.role === "frontend" || payload.role === "fullstack" ? payload.role : null;
      const configId = typeof payload.configId === "string" ? payload.configId.trim() : "";
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : null;
      if (configId && role && deps.setLoopRoleThinking && deps.isThinkingMode(payload.thinkingMode)) {
        const saved = deps.setLoopRoleThinking(configId, role, model, payload.thinkingMode);
        deps.loadModelStore();
        if (!saved) {
          deps.showWebviewError?.("模型配置", "思考力度保存失败，已恢复原来的选择。");
        }
      }
    },
  },
  prefixCommand("selectedLoopFrontendCli.", (message, deps) => {
    const configId = message.key.slice("selectedLoopFrontendCli.".length).trim();
    const cli = typeof message.value === "string" ? parseCliName(message.value) : null;
    if (configId && cli) {
      deps.selectLoopFrontendCli?.(configId, cli);
      deps.loadModelStore();
    }
  }),
  prefixCommand("selectedLoopFrontendModel.", (message, deps) => {
    const configId = message.key.slice("selectedLoopFrontendModel.".length).trim();
    if (configId && deps.setLoopRoleExplicitModel && typeof message.value === "string") {
      const saved = deps.setLoopRoleExplicitModel(configId, "frontend", message.value);
      deps.loadModelStore();
      if (!saved) {
        deps.showWebviewError?.("模型配置", "子-前端模型保存失败，已恢复原来的选择。");
      }
    }
  }),
  prefixCommand("selectedLoopModel.", (message, deps) => {
    const [, cliValue, roleValue] = message.key.split(".");
    const cli = typeof cliValue === "string" && deps.isCliName(cliValue) ? cliValue : null;
    if (cli && (roleValue === "main" || roleValue === "subtask")) {
      const modelValue = typeof message.value === "string" ? message.value : null;
      deps.selectCliLoopModel?.(cli, roleValue, modelValue, deps.getActiveConfigIdForCli(cli));
      deps.loadModelStore();
    }
  }),
  prefixCommand("selectedLoopThinkingMode.", (message, deps) => {
    const [, cliValue, roleValue] = message.key.split(".");
    const cli = typeof cliValue === "string" && deps.isCliName(cliValue) ? cliValue : null;
    if (
      (cli === "codex" || cli === "grok" || cli === "claude" || cli === "dsh" || cli === "kimi-code")
      && (roleValue === "main" || roleValue === "subtask")
    ) {
      const configId = deps.getActiveConfigIdForCli(cli);
      const roleModel = deps.getSelectedLoopCliModel?.(cli, roleValue, configId)
        ?? deps.getSelectedCliModel(cli, configId);
      const thinkingMode = deps.isThinkingMode(message.value)
        ? deps.normalizeThinkingModeForCli(cli, message.value)
        : null;
      deps.setSelectedLoopThinkingMode?.(cli, roleValue, roleModel, thinkingMode, configId);
      deps.loadModelStore();
    }
  }),
];
