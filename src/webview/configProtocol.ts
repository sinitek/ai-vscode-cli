import { ApplyPayload, ConfigItem, ConfigPlatform } from "../config/types";

export type ConfigAction =
  | "getList"
  | "getById"
  | "save"
  | "delete"
  | "getCurrent"
  | "apply"
  | "backup"
  | "getBackups"
  | "initDefault"
  | "getMcpMarketplaceList"
  | "getCodexSkillsList"
  | "exportConfigs";

export type ConfigRequestPayload =
  | { action: "getList"; platform: ConfigPlatform }
  | { action: "getById"; platform: ConfigPlatform; id: string }
  | { action: "save"; config: ConfigItem }
  | { action: "delete"; platform: ConfigPlatform; id: string }
  | { action: "getCurrent"; platform: ConfigPlatform }
  | { action: "apply"; platform: ConfigPlatform; payload: ApplyPayload }
  | { action: "backup"; platform: ConfigPlatform }
  | { action: "getBackups"; platform: ConfigPlatform }
  | { action: "initDefault"; platform: ConfigPlatform }
  | { action: "getMcpMarketplaceList" }
  | { action: "getCodexSkillsList" }
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
