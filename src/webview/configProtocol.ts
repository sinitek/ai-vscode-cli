import { ApplyPayload, ConfigItem, ConfigOrder, ConfigPlatform, OfficialSkillPlatform } from "../config/types";

export type ConfigAction =
  | "getList"
  | "getOrder"
  | "setOrder"
  | "getById"
  | "save"
  | "delete"
  | "getCurrent"
  | "apply"
  | "backup"
  | "getBackups"
  | "initDefault"
  | "getMcpMarketplaceList"
  | "getClaudeSkillsList"
  | "getCodexSkillsList"
  | "getGeminiSkillsList"
  | "getOfficialSkillsCatalog"
  | "installOfficialSkill"
  | "updateOfficialSkill"
  | "uninstallOfficialSkill"
  | "getCodexMcpServerIds"
  | "getCodexMcpHealth"
  | "getMcpHealth"
  | "installMcp"
  | "installCodexMcp"
  | "uninstallMcp"
  | "exportConfigs";

export type ConfigRequestPayload =
  | { action: "getList"; platform: ConfigPlatform }
  | { action: "getOrder"; platform: ConfigPlatform }
  | { action: "setOrder"; platform: ConfigPlatform; order: ConfigOrder }
  | { action: "getById"; platform: ConfigPlatform; id: string }
  | { action: "save"; config: ConfigItem }
  | { action: "delete"; platform: ConfigPlatform; id: string }
  | { action: "getCurrent"; platform: ConfigPlatform }
  | { action: "apply"; platform: ConfigPlatform; payload: ApplyPayload }
  | { action: "backup"; platform: ConfigPlatform }
  | { action: "getBackups"; platform: ConfigPlatform }
  | { action: "initDefault"; platform: ConfigPlatform }
  | { action: "getMcpMarketplaceList" }
  | { action: "getClaudeSkillsList" }
  | { action: "getCodexSkillsList" }
  | { action: "getGeminiSkillsList" }
  | { action: "getOfficialSkillsCatalog"; platform: OfficialSkillPlatform }
  | { action: "installOfficialSkill"; platform: OfficialSkillPlatform; skillId: string }
  | { action: "updateOfficialSkill"; platform: OfficialSkillPlatform; skillId: string }
  | { action: "uninstallOfficialSkill"; platform: OfficialSkillPlatform; skillId: string }
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
