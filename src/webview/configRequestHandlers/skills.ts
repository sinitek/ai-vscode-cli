import type * as ConfigService from "../../config/configService";
import type { ConfigRequestMessage, ConfigResponseMessage } from "../configProtocol";

export type ConfigSkillRequestServices = Pick<typeof ConfigService,
  | "getCliSkillsList"
  | "openCliSkillsDirectory"
  | "deleteCliSkill"
  | "copyCliSkill"
  | "searchLobehubSkills"
  | "installLobehubSkill"
  | "installLocalSkillZipFromPath"
>;

export type ConfigSkillRequestInteraction = {
  pickLocalSkillZip: () => Promise<string | null>;
  pickSkillPlatforms: () => Promise<string[] | null>;
};

type SkillRequest<Action extends ConfigRequestMessage["action"]> = Extract<ConfigRequestMessage, { action: Action }>;

export function createConfigSkillRequestHandlers(
  services: ConfigSkillRequestServices,
  interaction: ConfigSkillRequestInteraction,
) {
  return {
    async getCliSkillsList(request: SkillRequest<"getCliSkillsList">, response: ConfigResponseMessage): Promise<void> {
      response.data = await services.getCliSkillsList(request.platform);
    },
    async openCliSkillsDirectory(request: SkillRequest<"openCliSkillsDirectory">, response: ConfigResponseMessage): Promise<void> {
      response.data = await services.openCliSkillsDirectory(request.platform);
    },
    async deleteCliSkill(request: SkillRequest<"deleteCliSkill">, response: ConfigResponseMessage): Promise<void> {
      response.data = await services.deleteCliSkill(request.platform, request.name);
    },
    async copyCliSkill(request: SkillRequest<"copyCliSkill">, response: ConfigResponseMessage): Promise<void> {
      response.data = await services.copyCliSkill(request.platform, request.name, request.targetPlatform);
    },
    async searchLobehubSkills(request: SkillRequest<"searchLobehubSkills">, response: ConfigResponseMessage): Promise<void> {
      response.data = await services.searchLobehubSkills(request.payload);
    },
    async installLobehubSkill(request: SkillRequest<"installLobehubSkill">, response: ConfigResponseMessage): Promise<void> {
      response.data = await services.installLobehubSkill(request.payload);
    },
    async pickAndInstallLocalSkillZip(
      _request: SkillRequest<"pickAndInstallLocalSkillZip">,
      response: ConfigResponseMessage,
    ): Promise<void> {
      const filePath = await interaction.pickLocalSkillZip();
      if (filePath === null) {
        response.data = null;
        return;
      }
      const platforms = await interaction.pickSkillPlatforms();
      if (!platforms?.length) {
        response.data = null;
        return;
      }
      response.data = await services.installLocalSkillZipFromPath({ platforms }, filePath);
    },
  };
}
