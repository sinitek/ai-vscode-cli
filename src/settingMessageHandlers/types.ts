import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import type { PanelMessage } from "../webview/types";

export type SettingMessage = Extract<PanelMessage, { type: "updateSetting" }>;

export type SettingMessageContext = {
  currentCli: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
  workspaceSettings: ReturnType<PanelMessageHandlerDeps["getWorkspaceSettings"]>;
};

export type SettingCommand<Deps> = {
  matches: (message: SettingMessage) => boolean;
  execute: (message: SettingMessage, deps: Deps, context: SettingMessageContext) => void | Promise<void>;
};

export function settingCommand<Deps>(
  keys: string | readonly string[],
  execute: SettingCommand<Deps>["execute"]
): SettingCommand<Deps> {
  return {
    matches: ({ key }) => typeof keys === "string" ? key === keys : keys.includes(key),
    execute,
  };
}

export function prefixedSettingCommand<Deps>(
  prefix: string,
  execute: SettingCommand<Deps>["execute"]
): SettingCommand<Deps> {
  return { matches: ({ key }) => key.startsWith(prefix), execute };
}
