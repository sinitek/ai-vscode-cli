import type { CapturedCliOutput } from "./commandRunner";
import { parseOpenCodeModelVariants } from "../config/configService";
import type { OpenCodeThinkingMessageKey } from "./types";
import {
  parseOpenCodeConfigModels,
  parseOpenCodeModelReference,
  validateOpenCodeModelOverride,
} from "./opencodeconfigmodels";
import type { ParsedOpenCodeConfigModels } from "./opencodeconfigmodels";

export type OpenCodeVariantOption = {
  value: string;
  label: string;
  source: "resolved-cli" | "config";
};

export type OpenCodeThinkingCapability = {
  providerId: string | null;
  modelId: string | null;
  reasoning: boolean | "unknown";
  options: OpenCodeVariantOption[];
  configuredDefaultVariant: string | null;
  selectedVariant: string | null;
  status: "ready" | "unknown" | "error";
  source: "resolved-cli" | "config" | "fallback";
  messageKey?: OpenCodeThinkingMessageKey;
};

export type OpenCodeModelReference = {
  providerId: string;
  modelId: string;
};

export type OpenCodeCapabilityCommandResult = Pick<CapturedCliOutput, "stdout" | "stderr" | "exitCode">;

export type OpenCodeCapabilityCommandExecutor = (request: {
  command: string;
  args: string[];
  timeoutMs: number;
}) => Promise<OpenCodeCapabilityCommandResult>;

export type ResolveOpenCodeThinkingCapabilityOptions = {
  command?: string;
  version?: string;
  configIdentity?: string;
  configContent?: string;
  model: string | null | undefined;
  selectedVariant?: string | null;
  timeoutMs?: number;
  executor?: OpenCodeCapabilityCommandExecutor;
};

type ParsedOpenCodeModelMetadata = {
  reasoning: boolean | "unknown";
  options: OpenCodeVariantOption[];
};

type OpenCodeThinkingCapabilityBase = Omit<
  OpenCodeThinkingCapability,
  "configuredDefaultVariant" | "selectedVariant"
>;

type JsonObjectBlock = {
  start: number;
  value: Record<string, unknown>;
};

const DEFAULT_COMMAND = "opencode";
const DEFAULT_TIMEOUT_MS = 5_000;
const ANSI_ESCAPE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const MODEL_HEADING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/\S+$/;
const capabilityCache = new Map<string, Promise<OpenCodeThinkingCapabilityBase>>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeCommand(command: string | undefined): string {
  const trimmed = command?.trim();
  return trimmed || DEFAULT_COMMAND;
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  return typeof timeoutMs === "number" && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;
}

function getConfigIdentity(configIdentity: string | undefined, configContent: string | undefined): string {
  const explicitIdentity = configIdentity?.trim();
  if (explicitIdentity) {
    return explicitIdentity;
  }
  return `content:${hashText(configContent ?? "")}`;
}

function getVersionIdentity(version: string | undefined): string | null {
  const normalized = version?.trim();
  return normalized ? normalized : null;
}

function getBalancedObjectEnd(value: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function extractJsonObjectBlocks(value: string): JsonObjectBlock[] {
  const blocks: JsonObjectBlock[] = [];
  let searchIndex = 0;

  while (searchIndex < value.length) {
    const start = value.indexOf("{", searchIndex);
    if (start < 0) {
      break;
    }
    const end = getBalancedObjectEnd(value, start);
    if (end === null) {
      searchIndex = start + 1;
      continue;
    }

    try {
      const parsed = JSON.parse(value.slice(start, end + 1));
      if (isPlainObject(parsed)) {
        blocks.push({ start, value: parsed });
        searchIndex = end + 1;
        continue;
      }
    } catch {}
    searchIndex = start + 1;
  }

  return blocks;
}

function findNearestModelHeading(value: string, position: number): string | null {
  const lines = value.slice(0, position).split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (MODEL_HEADING_PATTERN.test(line)) {
      return line;
    }
  }
  return null;
}

function hasModelMetadataShape(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, "variants")
    || Object.prototype.hasOwnProperty.call(value, "capabilities")
    || Object.prototype.hasOwnProperty.call(value, "reasoning");
}

function metadataMatchesTarget(
  metadata: Record<string, unknown>,
  heading: string | null,
  target: OpenCodeModelReference
): boolean {
  if (!hasModelMetadataShape(metadata)) {
    return false;
  }
  const targetReference = `${target.providerId}/${target.modelId}`;
  const providerId = firstString(metadata.providerID, metadata.providerId);
  const rawModelId = firstString(metadata.id, metadata.modelID, metadata.modelId);
  const modelId = rawModelId === targetReference ? target.modelId : rawModelId;

  if (providerId !== null && providerId !== target.providerId) {
    return false;
  }
  if (modelId !== null && modelId !== target.modelId) {
    return false;
  }
  if (providerId !== null && modelId !== null) {
    return true;
  }
  return heading === targetReference;
}

function parseReasoning(metadata: Record<string, unknown>): boolean | "unknown" {
  const capabilities = isPlainObject(metadata.capabilities) ? metadata.capabilities : null;
  if (capabilities && typeof capabilities.reasoning === "boolean") {
    return capabilities.reasoning;
  }
  return typeof metadata.reasoning === "boolean" ? metadata.reasoning : "unknown";
}

function parseVariantOptions(
  variants: unknown,
  source: OpenCodeVariantOption["source"]
): OpenCodeVariantOption[] {
  if (!isPlainObject(variants)) {
    return [];
  }

  return Object.entries(variants)
    .filter(([variantName, variantConfig]) => (
      variantName.length > 0
      && !(isPlainObject(variantConfig) && variantConfig.disabled === true)
    ))
    .map(([variantName]) => ({
      value: variantName,
      label: variantName,
      source,
    }));
}

export function splitOpenCodeModelReference(value: string | null | undefined): OpenCodeModelReference | null {
  const target = parseOpenCodeModelReference(value);
  return target ? { providerId: target.providerId, modelId: target.modelId } : null;
}

export function parseOpenCodeModelsVerboseOutput(
  output: string,
  providerId: string,
  modelId: string
): ParsedOpenCodeModelMetadata | null {
  if (!providerId || !modelId) {
    return null;
  }

  const normalizedOutput = output.replace(ANSI_ESCAPE_PATTERN, "");
  const target = { providerId, modelId };
  for (const block of extractJsonObjectBlocks(normalizedOutput)) {
    const heading = findNearestModelHeading(normalizedOutput, block.start);
    if (!metadataMatchesTarget(block.value, heading, target)) {
      continue;
    }
    return {
      reasoning: parseReasoning(block.value),
      options: parseVariantOptions(block.value.variants, "resolved-cli"),
    };
  }
  return null;
}

async function defaultCommandExecutor(request: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<OpenCodeCapabilityCommandResult> {
  const { captureCliOutput } = require("./commandRunner") as typeof import("./commandRunner");
  return captureCliOutput(request.command, request.args, { timeoutMs: request.timeoutMs });
}

function executeWithTimeout(
  executor: OpenCodeCapabilityCommandExecutor,
  request: { command: string; args: string[]; timeoutMs: number }
): Promise<OpenCodeCapabilityCommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("opencode-capability-timeout"));
      }
    }, request.timeoutMs);

    executor(request).then(
      (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          resolve(result);
        }
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          reject(error);
        }
      }
    );
  });
}

async function readVersionIdentity(
  command: string,
  timeoutMs: number,
  executor: OpenCodeCapabilityCommandExecutor,
  requestedVersion: string | undefined
): Promise<string> {
  const explicitVersion = getVersionIdentity(requestedVersion);
  if (explicitVersion !== null) {
    return explicitVersion;
  }

  try {
    const result = await executeWithTimeout(executor, {
      command,
      args: ["--version"],
      timeoutMs,
    });
    if (result.exitCode === 0) {
      const reportedVersion = getVersionIdentity(result.stdout);
      if (reportedVersion !== null) {
        return reportedVersion;
      }
    }
  } catch {}
  return "unknown";
}

function readConfiguredDefaultVariant(
  parsedConfig: ParsedOpenCodeConfigModels,
  target: OpenCodeModelReference
): string | null {
  const providers = parsedConfig.config?.provider;
  if (!isPlainObject(providers)) {
    return null;
  }
  const provider = providers[target.providerId];
  if (!isPlainObject(provider) || !isPlainObject(provider.models)) {
    return null;
  }
  const model = provider.models[target.modelId];
  if (!isPlainObject(model) || !isPlainObject(model.options)) {
    return null;
  }
  const reasoningEffort = model.options.reasoningEffort;
  if (typeof reasoningEffort !== "string") {
    return null;
  }
  const normalized = reasoningEffort.trim();
  return normalized || null;
}

function applyConfiguredAndSelectedVariants(
  capability: OpenCodeThinkingCapabilityBase,
  configuredDefaultVariant: string | null,
  selectedVariant: string | null | undefined
): OpenCodeThinkingCapability {
  const configuredDefault = configuredDefaultVariant !== null
    && capability.options.some((option) => option.value === configuredDefaultVariant)
    ? configuredDefaultVariant
    : null;
  const selected = typeof selectedVariant === "string"
    && capability.options.some((option) => option.value === selectedVariant)
    ? selectedVariant
    : null;
  return {
    ...capability,
    configuredDefaultVariant: configuredDefault,
    selectedVariant: selected,
  };
}

function buildFallbackCapability(
  target: OpenCodeModelReference,
  configContent: string | undefined,
  metadataFailed: boolean
): OpenCodeThinkingCapabilityBase {
  const configuredVariants = parseOpenCodeModelVariants(
    configContent,
    target.providerId,
    target.modelId
  );
  if (configuredVariants.length > 0) {
    return {
      providerId: target.providerId,
      modelId: target.modelId,
      reasoning: "unknown",
      options: configuredVariants.map((variantName) => ({
        value: variantName,
        label: variantName,
        source: "config",
      })),
      status: "ready",
      source: "config",
      messageKey: "config-variants",
    };
  }

  return {
    providerId: target.providerId,
    modelId: target.modelId,
    reasoning: "unknown",
    options: [],
    status: metadataFailed ? "error" : "unknown",
    source: "fallback",
    messageKey: metadataFailed ? "metadata-error" : "no-variants",
  };
}

async function resolveCapabilityBase(
  command: string,
  target: OpenCodeModelReference,
  configContent: string | undefined,
  timeoutMs: number,
  executor: OpenCodeCapabilityCommandExecutor
): Promise<OpenCodeThinkingCapabilityBase> {
  let metadataFailed = false;
  try {
    const result = await executeWithTimeout(executor, {
      command,
      args: ["models", target.providerId, "--verbose"],
      timeoutMs,
    });
    if (result.exitCode === 0) {
      const metadata = parseOpenCodeModelsVerboseOutput(
        `${result.stdout}\n${result.stderr}`,
        target.providerId,
        target.modelId
      );
      if (metadata !== null) {
        return {
          providerId: target.providerId,
          modelId: target.modelId,
          reasoning: metadata.reasoning,
          options: metadata.options,
          status: "ready",
          source: "resolved-cli",
          ...(metadata.options.length === 0 ? { messageKey: "no-variants" as const } : {}),
        };
      }
    } else {
      metadataFailed = true;
    }
  } catch {
    metadataFailed = true;
  }

  return buildFallbackCapability(target, configContent, metadataFailed);
}

export async function resolveOpenCodeThinkingCapability(
  options: ResolveOpenCodeThinkingCapabilityOptions
): Promise<OpenCodeThinkingCapability> {
  const parsedConfig = parseOpenCodeConfigModels(options.configContent);
  const validatedModel = validateOpenCodeModelOverride(parsedConfig, "primary", options.model);
  const target = validatedModel.ok
    ? splitOpenCodeModelReference(validatedModel.modelRef)
    : null;
  if (target === null) {
    return {
      providerId: null,
      modelId: null,
      reasoning: "unknown",
      options: [],
      configuredDefaultVariant: null,
      selectedVariant: null,
      status: "unknown",
      source: "fallback",
      messageKey: "select-model",
    };
  }

  const command = normalizeCommand(options.command);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const executor = options.executor ?? defaultCommandExecutor;
  const versionIdentity = await readVersionIdentity(
    command,
    timeoutMs,
    executor,
    options.version
  );
  const cacheKey = [
    command,
    versionIdentity,
    getConfigIdentity(options.configIdentity, options.configContent),
    target.providerId,
    target.modelId,
  ].map((part) => `${part.length}:${part}`).join("|");

  let pendingCapability = capabilityCache.get(cacheKey);
  if (!pendingCapability) {
    pendingCapability = resolveCapabilityBase(
      command,
      target,
      options.configContent,
      timeoutMs,
      executor
    );
    capabilityCache.set(cacheKey, pendingCapability);
  }

  const capability = await pendingCapability;
  return applyConfiguredAndSelectedVariants(
    capability,
    readConfiguredDefaultVariant(parsedConfig, target),
    options.selectedVariant
  );
}

export function clearOpenCodeThinkingCapabilityCache(): void {
  capabilityCache.clear();
}
