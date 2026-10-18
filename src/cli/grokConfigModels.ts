import { isGrokTomlTable, parseGrokToml } from "../config/grokToml";

export type GrokConfigModels = {
  models: string[];
  labels: Record<string, string>;
  defaultModel: string | null;
  error: string | null;
};

export function parseGrokConfigModels(content: string): GrokConfigModels {
  const parsed = parseGrokToml(content);
  if (!parsed.ok) {
    return { models: [], labels: {}, defaultModel: null, error: parsed.error };
  }
  const modelTable = parsed.value.model;
  if (modelTable !== undefined && !isGrokTomlTable(modelTable)) {
    return { models: [], labels: {}, defaultModel: null, error: "Grok model must be a TOML table." };
  }
  const modelEntries = Object.entries(modelTable ?? {})
    .filter(([modelId, model]) => modelId.trim() && isGrokTomlTable(model));
  const models = modelEntries.map(([modelId]) => modelId);
  const labels = Object.fromEntries(modelEntries.map(([modelId, model]) => [
    modelId,
    isGrokTomlTable(model) && typeof model.model === "string" && model.model.trim()
      ? model.model.trim()
      : modelId,
  ]));
  const configuredDefault = isGrokTomlTable(parsed.value.models)
    ? parsed.value.models.default
    : null;
  return {
    models,
    labels,
    defaultModel: typeof configuredDefault === "string" && models.includes(configuredDefault)
      ? configuredDefault
      : models[0] ?? null,
    error: null,
  };
}

export function resolveGrokConfigModel(
  config: GrokConfigModels | undefined,
  selectedModel: string | null | undefined,
): string | null {
  const selected = selectedModel?.trim();
  return selected && config?.models.includes(selected) ? selected : config?.defaultModel ?? null;
}
