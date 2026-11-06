import { CLI_LIST, type CliName, type ThinkingMode } from "./cli/types";
import {
  normalizeOpenCodeModelRole,
  type OpenCodeCanonicalModelRole,
  type OpenCodeModelRoleInput,
} from "./cli/opencodeconfigmodels";
import { migrateLegacyLoopJson } from "./loopLegacyMigration";
import { readLoopSubtaskModeField } from "./loopPlusSubtaskMode";
import { parseCliName } from "./subtaskCliRoute";
import type {
  CliModelStore,
  LoopPlusConfigRole,
  LoopTaskRoleForModelSelection,
  ModelSelectionStoreOptions,
} from "./modelSelectionStoreTypes";

const OPEN_CODE_MODEL_ROLES = ["main", "subtask"] as const;
const OPEN_CODE_MODEL_ROLE_INPUTS = ["main", "subtask", "primary", "small"] as const;
const THINKING_MODE_VALUES = ["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"] as const;

export function normalizeCliModelName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function mergeUniqueModelNames(...groups: Array<readonly string[]>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      const normalized = normalizeCliModelName(item);
      if (!normalized) {
        continue;
      }
      const dedupeKey = normalized.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      result.push(normalized);
    }
  }
  return result;
}

export function normalizeLoopModelRoleFlags(value: unknown): { main: boolean; subtask: boolean } {
  if (!value || typeof value !== "object") {
    return { main: true, subtask: true };
  }
  const raw = value as { main?: unknown; subtask?: unknown };
  const main = raw.main !== false;
  const subtask = raw.subtask !== false;
  if (!main && !subtask) {
    return { main: true, subtask: true };
  }
  return { main, subtask };
}

export function isLoopTaskRoleValue(value: unknown): value is LoopTaskRoleForModelSelection {
  return value === "main" || value === "subtask";
}

export function isKnownThinkingMode(value: unknown): value is ThinkingMode {
  return typeof value === "string" && THINKING_MODE_VALUES.includes(value as ThinkingMode);
}

function normalizeThinkingModeForStore(
  cli: CliName,
  mode: unknown,
  options?: Pick<ModelSelectionStoreOptions, "isThinkingMode" | "normalizeThinkingModeForCli">
): ThinkingMode | null {
  if (options) {
    return options.isThinkingMode(mode)
      ? options.normalizeThinkingModeForCli(cli, mode)
      : null;
  }
  return isKnownThinkingMode(mode) ? mode : null;
}

function normalizeThinkingModelKey(
  rawKey: string,
  options?: Pick<ModelSelectionStoreOptions, "defaultModelStoreKey">
): string | null {
  if (options && rawKey === options.defaultModelStoreKey) {
    return options.defaultModelStoreKey;
  }
  return normalizeCliModelName(rawKey);
}

function readOpenCodeRoleValue(
  value: Record<string, unknown>,
  role: OpenCodeCanonicalModelRole
): unknown {
  return role === "main"
    ? (value.main ?? value.primary)
    : (value.subtask ?? value.small);
}

function normalizeConfigCliSelections(value: unknown): Record<string, CliName> {
  const selections: Record<string, CliName> = {};
  if (value && typeof value === "object") {
    for (const [configId, rawCli] of Object.entries(value)) {
      const cli = parseCliName(rawCli);
      if (configId && cli) {
        selections[configId] = cli;
      }
    }
  }
  return selections;
}

function normalizeIndependentRoleThinking(value: unknown): Record<string, Record<string, ThinkingMode>> {
  const thinkingByConfigId: Record<string, Record<string, ThinkingMode>> = {};
  if (value && typeof value === "object") {
    for (const [configId, rawByModel] of Object.entries(value)) {
      if (!configId || !rawByModel || typeof rawByModel !== "object") {
        continue;
      }
      const nextByModel: Record<string, ThinkingMode> = {};
      for (const [rawModel, rawMode] of Object.entries(rawByModel)) {
        const model = normalizeCliModelName(rawModel) ?? (rawModel === "__default__" ? "__default__" : null);
        if (model && isKnownThinkingMode(rawMode)) {
          nextByModel[model] = rawMode;
        }
      }
      if (Object.keys(nextByModel).length > 0) {
        thinkingByConfigId[configId] = nextByModel;
      }
    }
  }
  return thinkingByConfigId;
}

export function ensureCliModelStore(
  store?: Partial<CliModelStore> | null,
  options?: Pick<ModelSelectionStoreOptions, "defaultModelStoreKey" | "isThinkingMode" | "normalizeThinkingModeForCli">
): CliModelStore {
  store = store ? migrateLegacyLoopJson(store).value : store;
  const normalized: CliModelStore = {
    selectedByConfigId: {},
    optionsByConfigId: {},
    thinkingByCliAndModel: {},
    loopThinkingByConfigId: {},
    openCodeVariantByConfigAndModel: {},
    openCodeVariantByConfigModelAndRole: {},
    selectedLoopByConfigId: {},
    selectedLoopFrontendModelByConfigId: {},
    selectedLoopFrontendThinkingByConfigId: {},
    selectedLoopSubtaskCliByConfigId: {},
    selectedLoopFrontendCliByConfigId: {},
    selectedLoopFullstackCliByConfigId: {},
    selectedLoopFullstackThinkingByConfigId: {},
    loopRoleExplicitModelByConfigId: {},
    selectedLoopSubtaskModeByConfigId: {},
    loopFullstackRoleSeededByConfigId: {},
    loopRolesByConfigId: {},
    openCodeRoleModelsByConfigId: {},
  };
  const storedOptionsByConfigId = store?.optionsByConfigId;
  if (storedOptionsByConfigId && typeof storedOptionsByConfigId === "object") {
    for (const [configId, rawOptions] of Object.entries(storedOptionsByConfigId)) {
      if (!configId || !Array.isArray(rawOptions)) {
        continue;
      }
      normalized.optionsByConfigId[configId] = mergeUniqueModelNames(rawOptions);
    }
  }
  const storedSelectedByConfigId = store?.selectedByConfigId;
  if (storedSelectedByConfigId && typeof storedSelectedByConfigId === "object") {
    for (const [configId, rawModel] of Object.entries(storedSelectedByConfigId)) {
      const normalizedModel = normalizeCliModelName(rawModel);
      if (configId && normalizedModel) {
        normalized.selectedByConfigId[configId] = normalizedModel;
      }
    }
  }
  const storedSelectedLoopByConfigId = store?.selectedLoopByConfigId;
  if (storedSelectedLoopByConfigId && typeof storedSelectedLoopByConfigId === "object") {
    for (const [configId, rawSelection] of Object.entries(storedSelectedLoopByConfigId)) {
      if (!configId || !rawSelection || typeof rawSelection !== "object") {
        continue;
      }
      const nextSelection: Partial<Record<LoopTaskRoleForModelSelection, string>> = {};
      for (const [rawRole, rawModel] of Object.entries(rawSelection)) {
        if (!isLoopTaskRoleValue(rawRole)) {
          continue;
        }
        const normalizedModel = normalizeCliModelName(rawModel);
        if (!normalizedModel) {
          continue;
        }
        nextSelection[rawRole] = normalizedModel;
      }
      if (Object.keys(nextSelection).length > 0) {
        normalized.selectedLoopByConfigId[configId] = nextSelection;
      }
    }
  }
  const storedFrontendModelByConfigId = store?.selectedLoopFrontendModelByConfigId;
  if (storedFrontendModelByConfigId && typeof storedFrontendModelByConfigId === "object") {
    for (const [configId, rawModel] of Object.entries(storedFrontendModelByConfigId)) {
      const model = normalizeCliModelName(rawModel);
      if (configId && model) {
        normalized.selectedLoopFrontendModelByConfigId[configId] = model;
      }
    }
  }
  normalized.selectedLoopFrontendThinkingByConfigId = normalizeIndependentRoleThinking(store?.selectedLoopFrontendThinkingByConfigId);
  normalized.selectedLoopSubtaskCliByConfigId = normalizeConfigCliSelections(store?.selectedLoopSubtaskCliByConfigId);
  normalized.selectedLoopFrontendCliByConfigId = normalizeConfigCliSelections(store?.selectedLoopFrontendCliByConfigId);
  normalized.selectedLoopFullstackCliByConfigId = normalizeConfigCliSelections(store?.selectedLoopFullstackCliByConfigId);
  normalized.selectedLoopFullstackThinkingByConfigId = normalizeIndependentRoleThinking(store?.selectedLoopFullstackThinkingByConfigId);
  const storedExplicitModels = store?.loopRoleExplicitModelByConfigId;
  if (storedExplicitModels && typeof storedExplicitModels === "object") {
    for (const [configId, rawRoles] of Object.entries(storedExplicitModels)) {
      if (!configId || !rawRoles || typeof rawRoles !== "object") {
        continue;
      }
      const nextRoles: Partial<Record<LoopPlusConfigRole, string>> = {};
      for (const role of ["frontend", "fullstack"] as const) {
        if (!Object.prototype.hasOwnProperty.call(rawRoles, role)) {
          continue;
        }
        const rawModel = rawRoles[role];
        if (typeof rawModel !== "string") {
          continue;
        }
        nextRoles[role] = rawModel.trim();
      }
      if (Object.keys(nextRoles).length > 0) {
        normalized.loopRoleExplicitModelByConfigId[configId] = nextRoles;
      }
    }
  }
  const storedModes = store?.selectedLoopSubtaskModeByConfigId;
  if (storedModes && typeof storedModes === "object") {
    for (const [configId, rawMode] of Object.entries(storedModes)) {
      const mode = readLoopSubtaskModeField(rawMode);
      if (configId && mode) {
        normalized.selectedLoopSubtaskModeByConfigId[configId] = mode;
      }
    }
  }
  const storedSeeded = store?.loopFullstackRoleSeededByConfigId;
  if (storedSeeded && typeof storedSeeded === "object") {
    for (const [configId, rawSeeded] of Object.entries(storedSeeded)) {
      if (configId && rawSeeded === true) {
        normalized.loopFullstackRoleSeededByConfigId[configId] = true;
      }
    }
  }
  const storedOpenCodeVariants = store?.openCodeVariantByConfigAndModel;
  if (storedOpenCodeVariants && typeof storedOpenCodeVariants === "object") {
    for (const [configId, rawVariantsByModel] of Object.entries(storedOpenCodeVariants)) {
      if (!configId || !rawVariantsByModel || typeof rawVariantsByModel !== "object") {
        continue;
      }
      const variantsByModel: Record<string, string> = {};
      for (const [rawModel, rawVariant] of Object.entries(rawVariantsByModel)) {
        const model = normalizeCliModelName(rawModel);
        const variant = normalizeCliModelName(rawVariant);
        if (model && variant) {
          variantsByModel[model] = variant;
        }
      }
      if (Object.keys(variantsByModel).length > 0) {
        normalized.openCodeVariantByConfigAndModel[configId] = variantsByModel;
      }
    }
  }
  const storedOpenCodeRoleVariants = store?.openCodeVariantByConfigModelAndRole;
  if (storedOpenCodeRoleVariants && typeof storedOpenCodeRoleVariants === "object") {
    for (const [configId, rawVariantsByModel] of Object.entries(storedOpenCodeRoleVariants)) {
      if (!configId || !rawVariantsByModel || typeof rawVariantsByModel !== "object") {
        continue;
      }
      const variantsByModel: Record<string, Partial<Record<OpenCodeCanonicalModelRole, string>>> = {};
      for (const [rawModel, rawVariantsByRole] of Object.entries(rawVariantsByModel)) {
        const model = normalizeCliModelName(rawModel);
        if (!model || !rawVariantsByRole || typeof rawVariantsByRole !== "object") {
          continue;
        }
        const variantsByRole: Partial<Record<OpenCodeCanonicalModelRole, string>> = {};
        for (const rawRole of OPEN_CODE_MODEL_ROLE_INPUTS) {
          const role = normalizeOpenCodeModelRole(rawRole);
          if (variantsByRole[role]) {
            continue;
          }
          const variant = normalizeCliModelName((rawVariantsByRole as Partial<Record<OpenCodeModelRoleInput, unknown>>)[rawRole]);
          if (variant) {
            variantsByRole[role] = variant;
          }
        }
        if (Object.keys(variantsByRole).length > 0) {
          variantsByModel[model] = variantsByRole;
        }
      }
      if (Object.keys(variantsByModel).length > 0) {
        normalized.openCodeVariantByConfigModelAndRole[configId] = variantsByModel;
      }
    }
  }
  const storedOpenCodeRoleModels = store?.openCodeRoleModelsByConfigId;
  if (storedOpenCodeRoleModels && typeof storedOpenCodeRoleModels === "object") {
    for (const [configId, rawSelection] of Object.entries(storedOpenCodeRoleModels)) {
      if (!configId || !rawSelection || typeof rawSelection !== "object") {
        continue;
      }
      const selection: Partial<Record<OpenCodeCanonicalModelRole, string>> = {};
      for (const role of OPEN_CODE_MODEL_ROLES) {
        const model = normalizeCliModelName(readOpenCodeRoleValue(rawSelection as Record<string, unknown>, role));
        if (model) {
          selection[role] = model;
        }
      }
      if (Object.keys(selection).length > 0) {
        normalized.openCodeRoleModelsByConfigId[configId] = selection;
      }
    }
  }
  const storedLoopRolesByConfigId = store?.loopRolesByConfigId;
  if (storedLoopRolesByConfigId && typeof storedLoopRolesByConfigId === "object") {
    for (const [configId, rawRolesByModel] of Object.entries(storedLoopRolesByConfigId)) {
      if (!configId || !rawRolesByModel || typeof rawRolesByModel !== "object") {
        continue;
      }
      const nextRolesByModel: Record<string, { main: boolean; subtask: boolean }> = {};
      for (const [rawModel, rawRoleFlags] of Object.entries(rawRolesByModel)) {
        const normalizedModel = normalizeCliModelName(rawModel);
        if (!normalizedModel) {
          continue;
        }
        nextRolesByModel[normalizedModel] = normalizeLoopModelRoleFlags(rawRoleFlags);
      }
      if (Object.keys(nextRolesByModel).length > 0) {
        normalized.loopRolesByConfigId[configId] = nextRolesByModel;
      }
    }
  }
  for (const cli of CLI_LIST) {
    const storedThinkingByModel = store?.thinkingByCliAndModel?.[cli];
    if (storedThinkingByModel && typeof storedThinkingByModel === "object") {
      const normalizedThinkingByModel: Record<string, ThinkingMode> = {};
      for (const [rawModelKey, rawThinkingMode] of Object.entries(storedThinkingByModel)) {
        const normalizedModelKey = normalizeThinkingModelKey(rawModelKey, options);
        const normalizedThinkingMode = normalizeThinkingModeForStore(cli, rawThinkingMode, options);
        if (!normalizedModelKey || !normalizedThinkingMode) {
          continue;
        }
        normalizedThinkingByModel[normalizedModelKey] = normalizedThinkingMode;
      }
      if (Object.keys(normalizedThinkingByModel).length > 0) {
        normalized.thinkingByCliAndModel[cli] = normalizedThinkingByModel;
      }
    }
  }
  const storedLoopThinkingByConfigId = store?.loopThinkingByConfigId;
  if (storedLoopThinkingByConfigId && typeof storedLoopThinkingByConfigId === "object") {
    for (const [configId, rawThinkingByRole] of Object.entries(storedLoopThinkingByConfigId)) {
      if (!configId || !rawThinkingByRole || typeof rawThinkingByRole !== "object") {
        continue;
      }
      const normalizedThinkingByRole: Partial<Record<LoopTaskRoleForModelSelection, Record<string, ThinkingMode>>> = {};
      for (const role of ["main", "subtask"] as LoopTaskRoleForModelSelection[]) {
        const rawThinkingByModel = (rawThinkingByRole as Partial<Record<LoopTaskRoleForModelSelection, unknown>>)[role];
        if (!rawThinkingByModel || typeof rawThinkingByModel !== "object") {
          continue;
        }
        const normalizedThinkingByModel: Record<string, ThinkingMode> = {};
        for (const [rawModelKey, rawThinkingMode] of Object.entries(rawThinkingByModel as Record<string, unknown>)) {
          const normalizedModelKey = normalizeThinkingModelKey(rawModelKey, options);
          const normalizedThinkingMode = normalizeThinkingModeForStore("codex", rawThinkingMode, options);
          if (!normalizedModelKey || !normalizedThinkingMode) {
            continue;
          }
          normalizedThinkingByModel[normalizedModelKey] = normalizedThinkingMode;
        }
        if (Object.keys(normalizedThinkingByModel).length > 0) {
          normalizedThinkingByRole[role] = normalizedThinkingByModel;
        }
      }
      if (Object.keys(normalizedThinkingByRole).length > 0) {
        normalized.loopThinkingByConfigId[configId] = normalizedThinkingByRole;
      }
    }
  }
  return normalized;
}
