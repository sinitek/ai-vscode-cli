import { normalizeConfigPlatform } from "./configPaths";
import { MODEL_IMPORT_PLATFORM_STRATEGIES } from "./modelimportplatformstrategies";
import { discover } from "./modelimportdiscovery";
import {
  CLAUDE_FIELD_KEYS,
  cloneDraft,
  CLOSED_DRAFT_KEYS,
  containsCredential,
  safeFieldKey,
  safeIdentifier,
  safeModelId,
  stringValue,
  visibleModelId,
  record,
} from "./modelimportshared";
import type {
  ApplyModelImportPayload,
  ApplyModelImportResult,
  DiscoverImportModelsPayload,
  DiscoverImportModelsResult,
  InternalProvider,
  ModelImportDraft,
  ModelImportOptions,
  ModelImportPayload,
  ModelImportPlatform,
  ModelImportProvidersResult,
} from "./modelimporttypes";

export type {
  ApplyModelImportPayload,
  ApplyModelImportResult,
  DiscoverImportModelsPayload,
  DiscoverImportModelsResult,
  ModelImportDraft,
  ModelImportFetch,
  ModelImportField,
  ModelImportModel,
  ModelImportOptions,
  ModelImportPayload,
  ModelImportPlatform,
  ModelImportProvider,
  ModelImportProvidersResult,
} from "./modelimporttypes";

const MODEL_IMPORT_PLATFORMS: readonly ModelImportPlatform[] = Object.keys(MODEL_IMPORT_PLATFORM_STRATEGIES) as ModelImportPlatform[];

function assertPayload(payload: unknown, action: string, allowedKeys = ["platform", "draft"]): ModelImportPayload {
  const input = record(payload);
  if (!input) throw new Error(`${action} payload must be an object.`);
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`${action} payload contains an unsupported field.`);
  }
  const platform = input.platform;
  if (typeof platform !== "string" || !MODEL_IMPORT_PLATFORMS.includes(platform as ModelImportPlatform)) {
    throw new Error(`${action} platform is unsupported.`);
  }
  let normalized: ModelImportPlatform;
  try {
    normalized = normalizeConfigPlatform(platform as ModelImportPlatform) as ModelImportPlatform;
  } catch {
    throw new Error(`${action} platform is unsupported.`);
  }
  const draft = record(input.draft);
  if (!draft) throw new Error(`${action} draft is required.`);
  for (const key of Object.keys(draft)) {
    if (!CLOSED_DRAFT_KEYS.includes(key)) {
      throw new Error(`${action} draft contains an unsupported field.`);
    }
    if (draft[key] !== undefined && typeof draft[key] !== "string") {
      throw new Error(`${action} draft.${key} must be a string.`);
    }
    if (typeof draft[key] === "string" && (draft[key] as string).length > 2 * 1024 * 1024) {
      throw new Error(`${action} draft exceeds the maximum size.`);
    }
  }
  return {
    platform: normalized,
    draft: cloneDraft(draft as ModelImportDraft),
  };
}

function assertProviderPayload(payload: unknown, action: string, extraKeys: string[] = []): DiscoverImportModelsPayload {
  const base = assertPayload(payload, action, ["platform", "draft", "providerId", ...extraKeys]);
  const input = record(payload);
  const providerId = stringValue(input?.providerId);
  if (!providerId || !safeIdentifier(providerId)) throw new Error(`${action} providerId is invalid.`);
  return { ...base, providerId };
}

function assertApplyPayload(payload: unknown): ApplyModelImportPayload {
  const base = assertProviderPayload(payload, "applyModelImport", ["selectedModelIds", "fields"]);
  const input = record(payload);
  const selected = input?.selectedModelIds;
  if (!Array.isArray(selected) || selected.length > 1000 || selected.some((value) => typeof value !== "string")) {
    throw new Error("applyModelImport selectedModelIds must be a string array.");
  }
  const selectedModelIds = selected.map((value) => value.trim());
  if (selectedModelIds.some((value) => !safeModelId(value))) {
    throw new Error("applyModelImport contains an invalid model id.");
  }
  if (new Set(selectedModelIds).size !== selectedModelIds.length) {
    throw new Error("applyModelImport selectedModelIds contains duplicates.");
  }
  const fields = input?.fields;
  if (fields !== undefined) {
    const fieldRecord = record(fields);
    if (base.platform !== "claude" || !fieldRecord || Object.entries(fieldRecord).some(([key, value]) => (
      !safeFieldKey(key) || !(CLAUDE_FIELD_KEYS as readonly string[]).includes(key)
      || typeof value !== "string" || (value.trim() !== "" && !safeModelId(value.trim()))
    ))) {
      throw new Error("applyModelImport fields are invalid.");
    }
    return { ...base, selectedModelIds, fields: Object.fromEntries(
      Object.entries(fieldRecord).map(([key, value]) => [key, String(value).trim()]),
    ) };
  }
  return { ...base, selectedModelIds };
}

function publicProvider(item: InternalProvider) {
  const {
    protocolKind: _protocolKind,
    requestBaseUrl: _requestBaseUrl,
    apiKey: _apiKey,
    apiKeyEnv: _apiKeyEnv,
    sourceId: _sourceId,
    existingModelIds: _existing,
    config: _config,
    ...publicValue
  } = item;
  return publicValue;
}

function assertSafeImportIds(payload: ApplyModelImportPayload, providerValue: InternalProvider): void {
  if (payload.selectedModelIds.some((modelId) => !visibleModelId(modelId, providerValue))) {
    throw new Error("Selected model id is not safe to import.");
  }
  if (payload.fields && Object.values(payload.fields).some((modelId) => containsCredential(modelId, providerValue))) {
    throw new Error("Claude model mapping contains credential material.");
  }
}

function providersFor(payload: ModelImportPayload, options: ModelImportOptions): InternalProvider[] {
  const env = options.env ?? process.env;
  return MODEL_IMPORT_PLATFORM_STRATEGIES[payload.platform].providers(payload.draft, env);
}

export function getModelImportProviders(
  payload: ModelImportPayload,
  options: ModelImportOptions = {},
): ModelImportProvidersResult {
  const validated = assertPayload(payload, "getModelImportProviders");
  return { providers: providersFor(validated, options).map(publicProvider) };
}

export async function discoverImportModels(
  payload: DiscoverImportModelsPayload,
  options: ModelImportOptions = {},
): Promise<DiscoverImportModelsResult> {
  const validated = assertProviderPayload(payload, "discoverImportModels");
  const providers = providersFor(validated, options);
  const item = providers.find((candidate) => candidate.id === validated.providerId);
  if (!item) throw new Error("Provider is not present in the current draft.");
  const models = await discover(item, options);
  const result: DiscoverImportModelsResult = {
    models,
    existingModelIds: Array.from(new Set(item.existingModelIds)),
  };
  const fields = MODEL_IMPORT_PLATFORM_STRATEGIES[validated.platform].discoveryFields;
  if (fields) result.fields = fields(validated.draft, models);
  return result;
}

export async function applyModelImport(
  payload: ApplyModelImportPayload,
  options: ModelImportOptions = {},
): Promise<ApplyModelImportResult> {
  const validated = assertApplyPayload(payload);
  const providers = providersFor(validated, options);
  const item = providers.find((candidate) => candidate.id === validated.providerId);
  if (!item) throw new Error("Provider is not present in the current draft.");
  if (item.disabledReason) throw new Error(item.disabledReason);
  if (validated.selectedModelIds.length === 0) throw new Error("Select at least one model to import.");
  assertSafeImportIds(validated, item);
  return { draft: await MODEL_IMPORT_PLATFORM_STRATEGIES[validated.platform].writeDraft(validated, item) };
}
