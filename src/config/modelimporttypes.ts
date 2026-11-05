import type { CurrentConfigPlatform } from "./types";

export type ModelImportPlatform = CurrentConfigPlatform;

export type ModelImportDraft = {
  content?: string;
  configContent?: string;
  authContent?: string;
};

export type ModelImportProvider = {
  id: string;
  label: string;
  baseUrl: string;
  protocol: string;
  mode: "multi" | "single" | "claude";
  disabledReason?: string;
};

export type ModelImportModel = { id: string; label: string };

export type ModelImportField = { key: string; label: string; value: string };

export type ModelImportPayload = {
  platform: ModelImportPlatform;
  draft: ModelImportDraft;
};

export type DiscoverImportModelsPayload = ModelImportPayload & { providerId: string };

export type ApplyModelImportPayload = DiscoverImportModelsPayload & {
  selectedModelIds: string[];
  fields?: Record<string, string>;
};

export type ModelImportProvidersResult = { providers: ModelImportProvider[] };
export type DiscoverImportModelsResult = {
  models: ModelImportModel[];
  existingModelIds: string[];
  fields?: ModelImportField[];
};
export type ApplyModelImportResult = { draft: ModelImportDraft };

export type ModelImportFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ModelImportOptions = {
  fetch?: ModelImportFetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxPages?: number;
  maxModels?: number;
};

export type WireProtocol = "openai-chat-completions" | "openai-responses" | "anthropic-messages" | "google-genai" | "ollama-native";
export type ProviderMode = ModelImportProvider["mode"];

export type InternalProvider = ModelImportProvider & {
  protocolKind: WireProtocol | null;
  requestBaseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  anthropicAuthToken?: boolean;
  sourceId: string;
  existingModelIds: string[];
  config: Record<string, unknown>;
};

export type ModelImportPlatformStrategy = {
  providers: (draft: ModelImportDraft, env: NodeJS.ProcessEnv) => InternalProvider[];
  writeDraft: (payload: ApplyModelImportPayload, provider: InternalProvider) => ModelImportDraft | Promise<ModelImportDraft>;
  discoveryFields?: (draft: ModelImportDraft, models: ModelImportModel[]) => ModelImportField[];
};
