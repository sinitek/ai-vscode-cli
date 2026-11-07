import type { CliName } from "../../cli/types";
import { normalizeConfigPlatform } from "../../config/configPaths";
import type * as configService from "../../config/configService";
import type { ConfigRequestMessage, ConfigResponseMessage } from "../configProtocol";

export type ConfigProfileRequestServices = Pick<
  typeof configService,
  | "getConfigList"
  | "getConfigOrder"
  | "setConfigOrder"
  | "getConfigById"
  | "saveConfig"
  | "copyConfig"
  | "deleteConfig"
  | "getCurrentConfig"
  | "applyConfig"
  | "backupConfig"
  | "getBackupList"
  | "initDefaultConfig"
>;

export type ConfigProfileRequestHost = {
  onConfigChanged?: () => void | Promise<void>;
  getActiveConfigId?: (cli: CliName) => Promise<string | null>;
};

export function createConfigProfileRequestHandlers(
  services: ConfigProfileRequestServices,
  host: ConfigProfileRequestHost = {},
) {
  return {
    async getList(request: Extract<ConfigRequestMessage, { action: "getList" }>, response: ConfigResponseMessage) {
      response.data = await services.getConfigList(request.platform);
    },
    async getOrder(request: Extract<ConfigRequestMessage, { action: "getOrder" }>, response: ConfigResponseMessage) {
      response.data = await services.getConfigOrder(request.platform);
    },
    async setOrder(request: Extract<ConfigRequestMessage, { action: "setOrder" }>, response: ConfigResponseMessage) {
      await services.setConfigOrder(request.platform, request.order);
      response.data = true;
      await host.onConfigChanged?.();
    },
    async getById(request: Extract<ConfigRequestMessage, { action: "getById" }>, response: ConfigResponseMessage) {
      response.data = await services.getConfigById(request.platform, request.id);
    },
    async save(request: Extract<ConfigRequestMessage, { action: "save" }>, response: ConfigResponseMessage) {
      await services.saveConfig(request.config);
      response.data = request.config;
      await host.onConfigChanged?.();
    },
    async copy(request: Extract<ConfigRequestMessage, { action: "copy" }>, response: ConfigResponseMessage) {
      response.data = await services.copyConfig(request.payload);
      await host.onConfigChanged?.();
    },
    async delete(request: Extract<ConfigRequestMessage, { action: "delete" }>, response: ConfigResponseMessage) {
      await services.deleteConfig(request.platform, request.id);
      response.data = true;
      await host.onConfigChanged?.();
    },
    async getCurrent(request: Extract<ConfigRequestMessage, { action: "getCurrent" }>, response: ConfigResponseMessage) {
      const current = await services.getCurrentConfig(request.platform);
      response.data = {
        ...current,
        activeConfigId: await host.getActiveConfigId?.(normalizeConfigPlatform(request.platform)) ?? null,
      };
    },
    async apply(request: Extract<ConfigRequestMessage, { action: "apply" }>, response: ConfigResponseMessage) {
      response.data = await services.applyConfig(request.platform, request.payload);
      await host.onConfigChanged?.();
    },
    async backup(request: Extract<ConfigRequestMessage, { action: "backup" }>, response: ConfigResponseMessage) {
      response.data = await services.backupConfig(request.platform);
    },
    async getBackups(request: Extract<ConfigRequestMessage, { action: "getBackups" }>, response: ConfigResponseMessage) {
      response.data = await services.getBackupList(request.platform);
    },
    async initDefault(request: Extract<ConfigRequestMessage, { action: "initDefault" }>, response: ConfigResponseMessage) {
      response.data = await services.initDefaultConfig(request.platform);
      await host.onConfigChanged?.();
    },
  };
}
