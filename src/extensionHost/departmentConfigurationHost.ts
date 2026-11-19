import { parse as parseToml } from "@iarna/toml";
import { createHash } from "crypto";
import type { CliName, ThinkingMode } from "../cli/types";
import type { ConfigItem } from "../config/types";
import type { DepartmentRoleCandidates } from "../departmentConfiguration";
import { parseCodexConfigModel } from "../cli/codexConfigModel";
import { parseDshConfigModels } from "../cli/dshConfigModels";
import { parseGrokConfigModels } from "../cli/grokConfigModels";
import { parseKimiCodeConfigModels, KIMI_CODE_EFFORTS } from "../config/kimiCodeConfig";
import { parseZcodeProviderConfig, readZcodeConfigModels } from "../config/zcodeConfig";
import { parseOpenCodeConfigModels, validateOpenCodeModelOverride } from "../cli/opencodeconfigmodels";
import { OPENCODE_THINKING_EFFORTS } from "../cli/openCodeThinkingEffort";
import { normalizeRouteThinkingMode } from "../subtaskCliRoute";

export type DepartmentCandidateReadPort = {
  getConfigs: (cli: CliName) => Promise<ConfigItem[]>;
  getConfig: (cli: CliName, id: string) => Promise<ConfigItem | null>;
  getStoredModels: (cli: CliName, id: string) => string[];
  normalizeThinkingMode: (cli: CliName, value: ThinkingMode) => ThinkingMode;
  getRevision?: (cli: CliName) => Promise<string>;
};

/** Reads saved profiles only. Never applies a profile, reads credentials into a DTO, or starts a CLI. */
export async function readDepartmentRoleCandidates(
  cli: CliName, configId: string | null, port: DepartmentCandidateReadPort,
): Promise<DepartmentRoleCandidates> {
  const revision = cli === "opencode" ? await port.getRevision?.(cli) : undefined;
  const configs = (await port.getConfigs(cli)).filter((config) => config.platform === cli)
    .map(({ id, name }) => ({ id, name }));
  const result: DepartmentRoleCandidates = {
    cli, configId, configs, models: [], defaultModel: null, supportsDefaultModel: false,
    thinkingByModel: {}, variantsByModel: {},
  };
  if (!configId) return result;
  if (!configs.some((config) => config.id === configId)) throw new Error("所选 CLI 档案已失效，请重新选择。");
  const config = await port.getConfig(cli, configId);
  if (!config || config.id !== configId || config.platform !== cli) throw new Error("读取所选 CLI 档案失败，请重新选择后重试。");
  const content = config.configContent ?? config.content ?? "";
  // Match the existing model selectors: on/off are not generic effort levels.
  const modes: ThinkingMode[] = [...((cli === "grok" || cli === "claude") ? ["off" as const] : []), "low", "medium", "high", "xhigh", "max", "ultra"];
  let thinking = modes.filter((mode) => port.normalizeThinkingMode(cli, mode) === mode);
  let parsedReasoning: Record<string, readonly string[]> = {};
  if (cli === "codex") {
    parseToml(content); // A malformed profile must not masquerade as a supported default.
    result.defaultModel = parseCodexConfigModel(content);
    result.models = [...new Set([...(result.defaultModel ? [result.defaultModel] : []), ...port.getStoredModels(cli, configId)])];
    result.supportsDefaultModel = true;
  } else if (cli === "claude") {
    JSON.parse(content || "{}");
    result.models = port.getStoredModels(cli, configId);
    result.supportsDefaultModel = true;
  } else if (cli === "opencode") {
    if (await port.getRevision?.(cli) !== revision) throw new Error("OpenCode 配置修订在加载期间发生变化，请重试。");
    result.sourceRevision = createHash("sha256").update(JSON.stringify([
      cli, configId, config.updatedAt, config.content, config.configContent, revision,
    ])).digest("hex");
    const parsed = parseOpenCodeConfigModels(config.content ?? config.configContent);
    if (!parsed.config) throw new Error("OpenCode 档案读取失败，请检查配置格式。");
    result.models = parsed.candidates.filter((model) => validateOpenCodeModelOverride(parsed, "main", model.ref).ok).map((model) => model.ref);
    result.defaultModel = parsed.mainModelRef;
    result.supportsDefaultModel = Boolean(parsed.mainModel && result.models.includes(parsed.mainModel.ref));
    thinking = [];
    // Match the existing OpenCode effort selector; config variants remain available by exact profile/model.
    for (const model of result.models) {
      const candidate = parsed.candidates.find((entry) => entry.ref === model)!;
      const providers = parsed.config.provider as Record<string, { models?: Record<string, { variants?: Record<string, unknown> }> }> | undefined;
      const variants = providers?.[candidate.providerId]?.models?.[candidate.modelId]?.variants;
      result.variantsByModel[model] = [...new Set([...OPENCODE_THINKING_EFFORTS,
        ...Object.entries(variants ?? {}).filter(([, value]) => !(value && typeof value === "object" && (value as { disabled?: unknown }).disabled === true)).map(([name]) => name)])];
    }
  } else {
    const parsed = cli === "grok" ? parseGrokConfigModels(content)
      : cli === "dsh" ? parseDshConfigModels(content)
      : cli === "kimi-code" ? parseKimiCodeConfigModels(content) : readZcodeConfigModels(content);
    if (parsed.error) throw new Error("所选 CLI 档案模型读取失败，请检查配置后重试。");
    result.models = [...parsed.models];
    result.defaultModel = parsed.defaultModel;
    result.supportsDefaultModel = Boolean(parsed.defaultModel && parsed.models.includes(parsed.defaultModel));
    if (cli === "dsh") parsedReasoning = parseDshConfigModels(content).reasoningOptionsByModelId;
    if (cli === "kimi-code") {
      const root = parseToml(content) as unknown as { models?: Record<string, { capabilities?: string[]; support_efforts?: string[] }> };
      parsedReasoning = Object.fromEntries(result.models.map((model) => {
        const capability = root.models?.[model];
        const enabled = capability?.capabilities?.some((value) => value === "thinking" || value === "always_thinking");
        return [model, enabled ? (capability?.support_efforts ?? []).filter((value) => (KIMI_CODE_EFFORTS as readonly string[]).includes(value)) : []];
      }));
    }
    if (cli === "zcode") {
      const view = parseZcodeProviderConfig(content);
      parsedReasoning = Object.fromEntries((view?.models ?? []).map((model) => [`${view?.providerId}/${model.id}`, model.reasoningLevels]));
    }
  }
  for (const model of [...result.models, ...(result.defaultModel ? [] : [""])]) {
    result.thinkingByModel[model] = cli === "dsh" || cli === "kimi-code" || cli === "zcode"
      ? (parsedReasoning[model] ?? []).map((mode) => normalizeRouteThinkingMode(mode)).filter((mode): mode is ThinkingMode => Boolean(mode))
      : [...thinking];
  }
  return result;
}

/** Exact-profile, read-only OpenCode director selection. null preserves CLI default semantics. */
export function resolveDepartmentOpenCodeDirector(
  configId: string, content: string, model: string | null,
  getVariant: (exactModel: string) => string | null,
): import("../departmentConfiguration").DepartmentConfiguredRoleRoute {
  const parsed = parseOpenCodeConfigModels(content);
  if (!parsed.config) throw new Error("OpenCode 总监档案读取失败，请检查配置。");
  const selected = validateOpenCodeModelOverride(parsed, "main", model);
  if (!selected.ok) throw new Error("OpenCode 总监所选模型不可用，请重新选择。");
  const exactModel = model ?? parsed.mainModelRef;
  if (!exactModel) throw new Error("OpenCode 总监档案没有可用默认模型，请明确选择模型。");
  return { cli: "opencode", configId, model, thinkingMode: null, openCodeVariant: getVariant(exactModel) };
}
