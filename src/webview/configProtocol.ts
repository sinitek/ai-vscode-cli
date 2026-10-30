import type {
  ApplyPayload,
  ConfigItem,
  ConfigOrder,
  ConfigPlatform,
  CopyConfigPayload,
} from "../config/types";
import type { CliName } from "../cli/types";

export type ConfigNavigationTarget = {
  cli: CliName;
  configId: string;
};

export type ConfigReadyMessage = {
  type: "config:ready";
};

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
  "getCliSkillsList",
  "openCliSkillsDirectory",
  "deleteCliSkill",
  "copyCliSkill",
  "searchLobehubSkills",
  "installLobehubSkill",
  "pickAndInstallLocalSkillZip",
  "exportConfigs",
  "getCliEnabled",
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
  | { action: "getCliSkillsList"; platform: string }
  | { action: "openCliSkillsDirectory"; platform: string }
  | { action: "deleteCliSkill"; platform: string; name: string }
  | { action: "copyCliSkill"; platform: string; name: string; targetPlatform: string }
  | { action: "searchLobehubSkills"; payload?: { query?: string; page?: number } }
  | { action: "installLobehubSkill"; payload?: { identifier?: string; platforms?: string[] } }
  | { action: "pickAndInstallLocalSkillZip" }
  | { action: "exportConfigs"; payload: { fileName?: string; content: string } }
  | { action: "getCliEnabled" };

export type ConfigCliEnabledMessage = {
  type: "config:cliEnabled";
  cliEnabledByName: Partial<Record<string, boolean>>;
};

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

export type ConfigCloseMessage = {
  type: "config:close";
};
