import type * as ConfigService from "./configService";
import { parseCodexConfigModel } from "../cli/codexConfigModel";
import { parseGrokConfigModels, resolveGrokConfigModel, type GrokConfigModels } from "../cli/grokConfigModels";
import { parseDshConfigModels, readDshModelWireForRun, resolveDshConfigModel, type DshConfigModels } from "../cli/dshConfigModels";
import { parseKimiCodeConfigModels, resolveKimiCodeConfigModel, type KimiCodeConfigModels } from "./kimiCodeConfig";
import { readZcodeConfigModels, resolveZcodeModelWireForRun, type ZcodeConfigModels } from "./zcodeConfig";
import { t } from "../i18n";

type ConfiguredModelCli = "codex" | "grok" | "dsh" | "kimi-code" | "zcode";
type ConfigContent = Pick<Awaited<ReturnType<typeof ConfigService.getCurrentConfig>>, "content" | "configContent">;
type ProfileContent = Pick<NonNullable<Awaited<ReturnType<typeof ConfigService.getConfigById>>>, "content" | "configContent">;

export interface ConfiguredModelReadPort {
  getCurrentConfig(cli: ConfiguredModelCli): Promise<ConfigContent>;
  getConfigById(cli: "dsh", configId: string): Promise<ProfileContent | null>;
  readGrokConfigText(): ReturnType<typeof ConfigService.readGrokConfigText>;
}

export type ConfiguredModelErrorPort = (event: string, payload: { error: string }) => Promise<void> | void;

function errorToMessage(error: unknown): string {
  return error instanceof Error ? (error.message || String(error)) : String(error);
}

function emptyDshModels(error: string): DshConfigModels {
  return { models: [], labels: {}, defaultModel: null, wireByModelId: {}, reasoningOptionsByModelId: {}, error };
}

export class ConfiguredModelRepository {
  private readonly codexModelByConfigId = new Map<string | null, string | null>();
  private readonly grokModelsByConfigId = new Map<string | null, GrokConfigModels>();
  private readonly dshModelsByConfigId = new Map<string | null, DshConfigModels>();
  private readonly kimiCodeModelsByConfigId = new Map<string | null, KimiCodeConfigModels>();
  private readonly zcodeModelsByConfigId = new Map<string | null, ZcodeConfigModels>();

  constructor(private readonly reader: ConfiguredModelReadPort, private readonly logError: ConfiguredModelErrorPort) {}

  getCodexConfigModel(configId: string | null | undefined): string | null | undefined {
    return configId === undefined ? undefined : this.codexModelByConfigId.get(configId);
  }

  getGrokConfigModels(configId: string | null | undefined): GrokConfigModels | undefined {
    return configId === undefined ? undefined : this.grokModelsByConfigId.get(configId);
  }

  getDshConfigModels(configId: string | null | undefined): DshConfigModels | undefined {
    return configId === undefined ? undefined : this.dshModelsByConfigId.get(configId);
  }

  getKimiCodeConfigModels(configId: string | null | undefined): KimiCodeConfigModels | undefined {
    return configId === undefined ? undefined : this.kimiCodeModelsByConfigId.get(configId);
  }

  getZcodeConfigModels(configId: string | null | undefined): ZcodeConfigModels | undefined {
    return configId === undefined ? undefined : this.zcodeModelsByConfigId.get(configId);
  }

  cacheGrokConfigModels(configId: string | null, config: GrokConfigModels): void {
    this.grokModelsByConfigId.set(configId, config);
  }

  cacheDshConfigModels(configId: string | null, config: DshConfigModels): void {
    this.dshModelsByConfigId.set(configId, config);
  }

  cacheKimiCodeConfigModels(configId: string | null, config: KimiCodeConfigModels): void {
    this.kimiCodeModelsByConfigId.set(configId, config);
  }

  cacheKimiCodeConfigContent(configId: string | null, content: string): KimiCodeConfigModels {
    const config = parseKimiCodeConfigModels(content);
    this.cacheKimiCodeConfigModels(configId, config);
    return config;
  }

  async refreshCodexConfigModel(configId: string | null): Promise<void> {
    try {
      const current = await this.reader.getCurrentConfig("codex");
      this.codexModelByConfigId.set(configId, parseCodexConfigModel(current.configContent ?? current.content ?? ""));
    } catch (error) {
      this.codexModelByConfigId.set(configId, null);
      void this.logError("codex-config-model-read-failed", { error: errorToMessage(error) });
    }
  }

  async refreshGrokConfigModels(configId: string | null): Promise<void> {
    try {
      this.cacheGrokConfigModels(configId, parseGrokConfigModels(await this.reader.readGrokConfigText()));
    } catch (error) {
      this.cacheGrokConfigModels(configId, { models: [], labels: {}, defaultModel: null, error: errorToMessage(error) });
      void this.logError("grok-config-models-read-failed", { error: errorToMessage(error) });
    }
  }

  async refreshDshConfigModels(configId: string | null): Promise<void> {
    try {
      const profile = configId
        ? await this.reader.getConfigById("dsh", configId)
        : await this.reader.getCurrentConfig("dsh");
      this.cacheDshConfigModels(configId, profile
        ? parseDshConfigModels(profile.content ?? profile.configContent ?? "")
        : emptyDshModels("DSH profile was not found."));
    } catch (error) {
      this.cacheDshConfigModels(configId, emptyDshModels(errorToMessage(error)));
      void this.logError("dsh-config-models-read-failed", { error: errorToMessage(error) });
    }
  }

  async refreshKimiCodeConfigModels(configId: string | null): Promise<void> {
    try {
      const current = await this.reader.getCurrentConfig("kimi-code");
      this.cacheKimiCodeConfigContent(configId, current.content ?? "");
    } catch (error) {
      this.cacheKimiCodeConfigModels(configId, {
        models: [], labels: {}, defaultModel: null, thinkingEffort: null, permissionMode: null, error: errorToMessage(error),
      });
      void this.logError("kimi-code-config-models-read-failed", { error: errorToMessage(error) });
    }
  }

  async refreshZcodeConfigModels(configId: string | null): Promise<void> {
    try {
      const current = await this.reader.getCurrentConfig("zcode");
      this.zcodeModelsByConfigId.set(configId, readZcodeConfigModels(current.content ?? ""));
    } catch (error) {
      this.zcodeModelsByConfigId.set(configId, { models: [], labels: {}, defaultModel: null, error: errorToMessage(error) });
      void this.logError("zcode-config-models-read-failed", { error: errorToMessage(error) });
    }
  }

  async resolveGrokModelForRun(selectedModel: string | null, getActiveConfigId: () => string | null): Promise<string> {
    const config = parseGrokConfigModels(await this.reader.readGrokConfigText());
    if (config.error) throw new Error(t("grok.invalidConfig"));
    this.cacheGrokConfigModels(getActiveConfigId(), config);
    const model = resolveGrokConfigModel(config, selectedModel);
    if (!model) throw new Error(t("grok.noConfiguredModels"));
    return model;
  }

  async resolveKimiCodeModelForRun(selectedModel: string | null, getActiveConfigId: () => string | null): Promise<string> {
    const config = parseKimiCodeConfigModels((await this.reader.getCurrentConfig("kimi-code")).content ?? "");
    if (config.error) throw new Error(t("kimi.invalidConfig"));
    this.cacheKimiCodeConfigModels(getActiveConfigId(), config);
    const model = resolveKimiCodeConfigModel(config, selectedModel);
    if (!model) throw new Error(t("kimi.noConfiguredModels"));
    return model;
  }

  async resolveZcodeModelWireForRun(selectedModel: string | null, getActiveConfigId: () => string | null): Promise<string> {
    const content = (await this.reader.getCurrentConfig("zcode")).content ?? "";
    this.zcodeModelsByConfigId.set(getActiveConfigId(), readZcodeConfigModels(content));
    return resolveZcodeModelWireForRun(content, selectedModel);
  }

  private async readDshConfigForRun(configId: string | null): Promise<DshConfigModels> {
    if (!configId) throw new Error("DSH profile is not active.");
    const profile = await this.reader.getConfigById("dsh", configId);
    if (!profile) throw new Error("DSH profile was not found.");
    const config = parseDshConfigModels(profile.content ?? profile.configContent ?? "");
    this.cacheDshConfigModels(configId, config);
    return config;
  }

  async resolveDshModelForRun(selectedModel: string | null, configId: string | null): Promise<string> {
    const config = await this.readDshConfigForRun(configId);
    if (config.error) throw new Error(config.error);
    const model = resolveDshConfigModel(config, selectedModel);
    if (!model) throw new Error("DSH has no configured executable model.");
    return model;
  }

  async resolveDshModelWireForRun(selectedModel: string | null, configId: string | null): Promise<string> {
    return readDshModelWireForRun(await this.readDshConfigForRun(configId), selectedModel);
  }
}
