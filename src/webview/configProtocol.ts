import type {
  ApplyPayload,
  ConfigItem,
  ConfigOrder,
  ConfigPlatform,
  CopyConfigPayload,
  OfficialSkillPlatform,
} from "../config/types";

export const CONFIG_ACTIONS = [
  "getList",
  "getOrder",
  "setOrder",
  "getById",
  "save",
  "copy",
  "delete",
  "getCurrent",
  "apply",
  "backup",
  "getBackups",
  "initDefault",
  "getMcpMarketplaceList",
  "getClaudeSkillsList",
  "getCodexSkillsList",
  "getOpenCodeSkillsList",
  "getOfficialSkillsCatalog",
  "installOfficialSkill",
  "updateOfficialSkill",
  "uninstallOfficialSkill",
  "getMcpInstalledServerIds",
  "getCodexMcpServerIds",
  "getCodexMcpHealth",
  "getMcpHealth",
  "installMcp",
  "installCodexMcp",
  "uninstallMcp",
  "exportConfigs",
] as const;

export type ConfigAction = typeof CONFIG_ACTIONS[number];

export type ConfigRequestPayload =
  | { action: "getList"; platform: ConfigPlatform }
  | { action: "getOrder"; platform: ConfigPlatform }
  | { action: "setOrder"; platform: ConfigPlatform; order: ConfigOrder }
  | { action: "getById"; platform: ConfigPlatform; id: string }
  | { action: "save"; config: ConfigItem }
  | { action: "copy"; payload: CopyConfigPayload }
  | { action: "delete"; platform: ConfigPlatform; id: string }
  | { action: "getCurrent"; platform: ConfigPlatform }
  | { action: "apply"; platform: ConfigPlatform; payload: ApplyPayload }
  | { action: "backup"; platform: ConfigPlatform }
  | { action: "getBackups"; platform: ConfigPlatform }
  | { action: "initDefault"; platform: ConfigPlatform }
  | { action: "getMcpMarketplaceList" }
  | { action: "getClaudeSkillsList" }
  | { action: "getCodexSkillsList" }
  | { action: "getOpenCodeSkillsList" }
  | { action: "getOfficialSkillsCatalog"; platform: OfficialSkillPlatform }
  | { action: "installOfficialSkill"; platform: OfficialSkillPlatform; skillId: string }
  | { action: "updateOfficialSkill"; platform: OfficialSkillPlatform; skillId: string }
  | { action: "uninstallOfficialSkill"; platform: OfficialSkillPlatform; skillId: string }
  | { action: "getMcpInstalledServerIds"; platform: ConfigPlatform }
  | { action: "getCodexMcpServerIds" }
  | { action: "getCodexMcpHealth" }
  | { action: "getMcpHealth"; platform: ConfigPlatform }
  | {
      action: "installMcp";
      platform: ConfigPlatform;
      mcpId: string;
      envOverrides?: Record<string, string>;
    }
  | { action: "installCodexMcp"; mcpId: string }
  | { action: "uninstallMcp"; platform: ConfigPlatform; mcpId: string }
  | { action: "exportConfigs"; payload: { fileName?: string; content: string } };

export type ConfigRequestMessage = {
  type: "config:request";
  requestId: string;
} & ConfigRequestPayload;

export type ConfigResponseMessage = {
  type: "config:response";
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

export type ConfigOpenPathMessage = {
  type: "config:openPath";
  path: string;
};

export type ConfigOpenExternalMessage = {
  type: "config:openExternal";
  url: string;
};
