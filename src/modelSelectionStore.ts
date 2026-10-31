import * as fs from "fs";
import * as path from "path";
import { applyModelArg, supportsCliManagedModelSelection } from "./cli/modelArgs";
import { getCliArgs } from "./cli/config";
import {
  CLI_LIST,
  type CliName,
  type ThinkingMode,
} from "./cli/types";
import type { PanelState } from "./webview/types";
import {
  normalizeOpenCodeModelRole,
  type OpenCodeCanonicalModelRole,
  type OpenCodeModelRoleInput,
} from "./cli/opencodeconfigmodels";
import { migrateLegacyLoopJson } from "./loopLegacyMigration";
import { readLoopSubtaskModeField, type LoopSubtaskMode } from "./loopPlusSubtaskMode";
import { parseCliName } from "./subtaskCliRoute";

export type LoopPlusConfigRole = "frontend" | "fullstack";

export type LoopTaskRoleForModelSelection = "main" | "subtask";

const OPEN_CODE_MODEL_ROLES = ["main", "subtask"] as const;
const OPEN_CODE_MODEL_ROLE_INPUTS = ["main", "subtask", "primary", "small"] as const;
const THINKING_MODE_VALUES = ["off", "on", "low", "medium", "high", "xhigh", "ultra", "max"] as const;

export type CliModelStore = {
  selectedByConfigId: Record<string, string>;
  optionsByConfigId: Record<string, string[]>;
  thinkingByCliAndModel: Partial<Record<CliName, Record<string, ThinkingMode>>>;
  loopThinkingByConfigId: Record<string, Partial<Record<LoopTaskRoleForModelSelection, Record<string, ThinkingMode>>>>;
  openCodeVariantByConfigAndModel: Record<string, Record<string, string>>;
  openCodeVariantByConfigModelAndRole: Record<string, Record<string, Partial<Record<OpenCodeCanonicalModelRole, string>>>>;
  selectedLoopByConfigId: Record<string, Partial<Record<LoopTaskRoleForModelSelection, string>>>;
  /** Loop+ 子-前端在目标档案上的模型。不写入 subtask 槽，避免覆盖子-后端。 */
  selectedLoopFrontendModelByConfigId: Record<string, string>;
  selectedLoopFrontendThinkingByConfigId: Record<string, Record<string, ThinkingMode>>;
  selectedLoopSubtaskCliByConfigId: Record<string, CliName>;
  /** Loop+ 子-前端 CLI，按主配置档案隔离。经典 Loop / Graph 不读取。 */
  selectedLoopFrontendCliByConfigId: Record<string, CliName>;
  /** Loop+ 子-全栈 CLI，按主配置档案隔离，不写入子-后端或子-前端槽。 */
  selectedLoopFullstackCliByConfigId: Record<string, CliName>;
  selectedLoopFullstackThinkingByConfigId: Record<string, Record<string, ThinkingMode>>;
  /** 显式模型值。空字符串表示用户选择了 CLI 默认模型，与整组配置缺失区分。 */
  loopRoleExplicitModelByConfigId: Record<string, Partial<Record<LoopPlusConfigRole, string>>>;
  /** Loop+ 子任务模式，按主配置档案隔离。缺省 fullstack，不覆盖其它档案。 */
  selectedLoopSubtaskModeByConfigId: Record<string, LoopSubtaskMode>;
  /** 全栈角色已从原子模型初始化过。再次切换模式不得重拷贝。 */
  loopFullstackRoleSeededByConfigId: Record<string, true>;
  loopRolesByConfigId: Record<string, Record<string, { main: boolean; subtask: boolean }>>;
  openCodeRoleModelsByConfigId: Record<string, Partial<Record<OpenCodeCanonicalModelRole, string>>>;
};

export type ModelSelectionStoreState = {
  store: CliModelStore;
  lastReadError: string | null;
  lastWriteError: string | null;
};

export type ModelSelectionStoreLogger = (event: string, payload?: unknown) => void;

export type ModelSelectionStoreOptions = {
  modelStoreFile: string;
  defaultModelStoreKey: string;
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  normalizeThinkingModeForCli: (cli: CliName, mode: ThinkingMode) => ThinkingMode;
  logError?: ModelSelectionStoreLogger;
};

export function createEmptyModelSelectionStoreState(): ModelSelectionStoreState {
  return {
    store: ensureCliModelStore(),
    lastReadError: null,
    lastWriteError: null,
  };
}

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

function isKnownThinkingMode(value: unknown): value is ThinkingMode {
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

function findCaseInsensitiveRecordKey<T>(
  record: Record<string, T> | undefined,
  key: string
): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const lowerKey = key.toLowerCase();
  return Object.keys(record).find((candidate) => candidate.toLowerCase() === lowerKey) ?? null;
}

function readOpenCodeRoleValue(
  value: Record<string, unknown>,
  role: OpenCodeCanonicalModelRole
): unknown {
  return role === "main"
    ? (value.main ?? value.primary)
    : (value.subtask ?? value.small);
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
  const storedFrontendThinkingByConfigId = store?.selectedLoopFrontendThinkingByConfigId;
  if (storedFrontendThinkingByConfigId && typeof storedFrontendThinkingByConfigId === "object") {
    for (const [configId, rawByModel] of Object.entries(storedFrontendThinkingByConfigId)) {
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
        normalized.selectedLoopFrontendThinkingByConfigId[configId] = nextByModel;
      }
    }
  }
  const storedSubtaskCliByConfigId = store?.selectedLoopSubtaskCliByConfigId;
  if (storedSubtaskCliByConfigId && typeof storedSubtaskCliByConfigId === "object") {
    for (const [configId, rawCli] of Object.entries(storedSubtaskCliByConfigId)) {
      const cli = parseCliName(rawCli);
      if (configId && cli) {
        normalized.selectedLoopSubtaskCliByConfigId[configId] = cli;
      }
    }
  }
  const storedFrontendCliByConfigId = store?.selectedLoopFrontendCliByConfigId;
  if (storedFrontendCliByConfigId && typeof storedFrontendCliByConfigId === "object") {
    for (const [configId, rawCli] of Object.entries(storedFrontendCliByConfigId)) {
      const cli = parseCliName(rawCli);
      if (configId && cli) {
        normalized.selectedLoopFrontendCliByConfigId[configId] = cli;
      }
    }
  }
  const storedFullstackCliByConfigId = store?.selectedLoopFullstackCliByConfigId;
  if (storedFullstackCliByConfigId && typeof storedFullstackCliByConfigId === "object") {
    for (const [configId, rawCli] of Object.entries(storedFullstackCliByConfigId)) {
      const cli = parseCliName(rawCli);
      if (configId && cli) {
        normalized.selectedLoopFullstackCliByConfigId[configId] = cli;
      }
    }
  }
  const storedFullstackThinkingByConfigId = store?.selectedLoopFullstackThinkingByConfigId;
  if (storedFullstackThinkingByConfigId && typeof storedFullstackThinkingByConfigId === "object") {
    for (const [configId, rawByModel] of Object.entries(storedFullstackThinkingByConfigId)) {
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
        normalized.selectedLoopFullstackThinkingByConfigId[configId] = nextByModel;
      }
    }
  }
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

export function readModelStore(
  state: ModelSelectionStoreState,
  options: ModelSelectionStoreOptions
): CliModelStore | undefined {
  try {
    if (!fs.existsSync(options.modelStoreFile)) {
      state.lastReadError = null;
      return undefined;
    }
    const raw = fs.readFileSync(options.modelStoreFile, "utf8");
    const parsed = JSON.parse(raw) as CliModelStore;
    state.lastReadError = null;
    return parsed;
  } catch (error) {
    state.lastReadError = errorToMessage(error);
    options.logError?.("model-store-read-error", {
      path: options.modelStoreFile,
      error: state.lastReadError,
    });
    return undefined;
  }
}

export function writeModelStore(
  state: ModelSelectionStoreState,
  store: CliModelStore,
  options: ModelSelectionStoreOptions
): void {
  try {
    fs.mkdirSync(path.dirname(options.modelStoreFile), { recursive: true });
    fs.writeFileSync(options.modelStoreFile, JSON.stringify(store, null, 2), "utf8");
    state.lastWriteError = null;
  } catch (error) {
    state.lastWriteError = errorToMessage(error);
    options.logError?.("model-store-write-error", {
      path: options.modelStoreFile,
      error: state.lastWriteError,
    });
  }
}

export function loadModelStore(
  state: ModelSelectionStoreState,
  options: ModelSelectionStoreOptions
): CliModelStore {
  const stored = readModelStore(state, options);
  if (state.lastReadError) {
    return ensureCliModelStore(undefined, options);
  }
  const normalized = ensureCliModelStore(stored, options);
  writeModelStore(state, normalized, options);
  return normalized;
}

function supportsConfigScopedCliModel(cli: CliName): boolean {
  return cli === "codex" || cli === "grok" || cli === "kimi-code";
}

function supportsLoopRoleModelStorage(cli: CliName): boolean {
  return cli === "codex" || cli === "grok" || cli === "kimi-code";
}

export function getSelectedCliModelFromStore(
  store: CliModelStore,
  cli: CliName,
  configId: string | null
): string | null {
  if (!configId || !supportsConfigScopedCliModel(cli)) {
    return null;
  }
  return normalizeCliModelName(store?.selectedByConfigId?.[configId]);
}

export function getOpenCodeVariantFromStore(
  store: CliModelStore,
  configId: string | null,
  model: string | null | undefined
): string | null {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel) {
    return null;
  }
  return normalizeCliModelName(store.openCodeVariantByConfigAndModel?.[configId]?.[normalizedModel]);
}

export function getOpenCodeRoleVariantFromStore(
  store: CliModelStore,
  configId: string | null,
  model: string | null | undefined,
  role: OpenCodeModelRoleInput
): string | null {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel) {
    return null;
  }
  const normalizedRole = normalizeOpenCodeModelRole(role);
  const roleVariant = normalizeCliModelName(
    store.openCodeVariantByConfigModelAndRole?.[configId]?.[normalizedModel]?.[normalizedRole]
  );
  if (roleVariant) {
    return roleVariant;
  }
  return normalizedRole === "main"
    ? getOpenCodeVariantFromStore(store, configId, normalizedModel)
    : null;
}

export function getOpenCodeRoleModelFromStore(
  store: CliModelStore,
  configId: string | null,
  role: OpenCodeModelRoleInput
): string | null {
  if (!configId) {
    return null;
  }
  const normalizedRole = normalizeOpenCodeModelRole(role);
  return normalizeCliModelName(ensureCliModelStore(store).openCodeRoleModelsByConfigId[configId]?.[normalizedRole]);
}

export function setOpenCodeRoleModelInStore(
  store: CliModelStore,
  configId: string | null,
  role: OpenCodeModelRoleInput,
  model: string | null
): CliModelStore {
  if (!configId) {
    return ensureCliModelStore(store);
  }
  const nextStore = ensureCliModelStore(store);
  const selection = { ...(nextStore.openCodeRoleModelsByConfigId[configId] ?? {}) };
  const normalizedRole = normalizeOpenCodeModelRole(role);
  const normalizedModel = normalizeCliModelName(model);
  if (normalizedModel) {
    selection[normalizedRole] = normalizedModel;
    nextStore.openCodeRoleModelsByConfigId[configId] = selection;
  } else {
    delete selection[normalizedRole];
    if (Object.keys(selection).length === 0) {
      delete nextStore.openCodeRoleModelsByConfigId[configId];
    } else {
      nextStore.openCodeRoleModelsByConfigId[configId] = selection;
    }
  }
  return ensureCliModelStore(nextStore);
}

export function setOpenCodeVariantInStore(
  store: CliModelStore,
  configId: string | null,
  model: string | null | undefined,
  variant: string | null | undefined
): CliModelStore {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel) {
    return store;
  }
  const normalizedVariant = normalizeCliModelName(variant);
  const currentVariant = getOpenCodeVariantFromStore(store, configId, normalizedModel);
  if (currentVariant === normalizedVariant) {
    return store;
  }
  const nextStore: CliModelStore = {
    ...store,
    openCodeVariantByConfigAndModel: {
      ...(store.openCodeVariantByConfigAndModel ?? {}),
    },
  };
  const nextByModel = {
    ...(nextStore.openCodeVariantByConfigAndModel[configId] ?? {}),
  };
  if (normalizedVariant) {
    nextByModel[normalizedModel] = normalizedVariant;
  } else {
    delete nextByModel[normalizedModel];
  }
  if (Object.keys(nextByModel).length > 0) {
    nextStore.openCodeVariantByConfigAndModel[configId] = nextByModel;
  } else {
    delete nextStore.openCodeVariantByConfigAndModel[configId];
  }
  return nextStore;
}

export function setOpenCodeRoleVariantInStore(
  store: CliModelStore,
  configId: string | null,
  model: string | null | undefined,
  role: OpenCodeModelRoleInput,
  variant: string | null | undefined
): CliModelStore {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel) {
    return store;
  }
  const normalizedRole = normalizeOpenCodeModelRole(role);
  const normalizedVariant = normalizeCliModelName(variant);
  const currentVariant = getOpenCodeRoleVariantFromStore(store, configId, normalizedModel, normalizedRole);
  if (currentVariant === normalizedVariant) {
    return store;
  }
  const nextStore: CliModelStore = {
    ...store,
    openCodeVariantByConfigModelAndRole: {
      ...(store.openCodeVariantByConfigModelAndRole ?? {}),
    },
  };
  const nextByModel = {
    ...(nextStore.openCodeVariantByConfigModelAndRole[configId] ?? {}),
  };
  const nextByRole = {
    ...(nextByModel[normalizedModel] ?? {}),
  };
  if (normalizedVariant) {
    nextByRole[normalizedRole] = normalizedVariant;
  } else {
    delete nextByRole[normalizedRole];
  }
  if (Object.keys(nextByRole).length > 0) {
    nextByModel[normalizedModel] = nextByRole;
  } else {
    delete nextByModel[normalizedModel];
  }
  if (Object.keys(nextByModel).length > 0) {
    nextStore.openCodeVariantByConfigModelAndRole[configId] = nextByModel;
  } else {
    delete nextStore.openCodeVariantByConfigModelAndRole[configId];
  }
  return ensureCliModelStore(nextStore);
}

export function getManagedModelOptionsForCliFromStore(
  store: CliModelStore,
  cli: CliName,
  configId: string | null
): string[] {
  if (!configId || !supportsConfigScopedCliModel(cli)) {
    return [];
  }
  const storedOptions = Array.isArray(store?.optionsByConfigId?.[configId])
    ? store.optionsByConfigId[configId] ?? []
    : [];
  return mergeUniqueModelNames(storedOptions);
}

export function getCliModelLoopRoleFlagsFromStore(
  store: CliModelStore,
  cli: CliName,
  model: string,
  configId: string | null
): { main: boolean; subtask: boolean } {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel || !supportsLoopRoleModelStorage(cli)) {
    return { main: true, subtask: true };
  }
  const rolesByModel = store?.loopRolesByConfigId?.[configId];
  if (!rolesByModel || typeof rolesByModel !== "object") {
    return { main: true, subtask: true };
  }
  const matchedKey = Object.keys(rolesByModel).find((key) => key.toLowerCase() === normalizedModel.toLowerCase());
  if (!matchedKey) {
    return { main: true, subtask: true };
  }
  return normalizeLoopModelRoleFlags(rolesByModel[matchedKey]);
}

export function getModelOptionsForCliFromStore(
  store: CliModelStore,
  cli: CliName,
  configId: string | null
): string[] {
  if (!configId || !supportsConfigScopedCliModel(cli)) {
    return [];
  }
  const storedOptions = Array.isArray(store?.optionsByConfigId?.[configId])
    ? store.optionsByConfigId[configId] ?? []
    : [];
  const selectedModel = getSelectedCliModelFromStore(store, cli, configId);
  return mergeUniqueModelNames(
    storedOptions,
    selectedModel ? [selectedModel] : []
  );
}

export function getLoopModelOptionsForCliFromStore(
  store: CliModelStore,
  cli: CliName,
  role: LoopTaskRoleForModelSelection,
  configId: string | null
): string[] {
  if (!configId || !supportsLoopRoleModelStorage(cli)) {
    return [];
  }
  const options = getModelOptionsForCliFromStore(store, cli, configId);
  return options.filter((modelName) => {
    const roleFlags = getCliModelLoopRoleFlagsFromStore(store, cli, modelName, configId);
    return role === "main" ? roleFlags.main : roleFlags.subtask;
  });
}

export function getSelectedLoopCliModelFromStore(
  store: CliModelStore,
  cli: CliName,
  role: LoopTaskRoleForModelSelection,
  configId: string | null
): string | null {
  if (cli === "opencode") {
    return getOpenCodeRoleModelFromStore(store, configId, role);
  }
  if (!configId || !supportsLoopRoleModelStorage(cli)) {
    return null;
  }
  const optionsForRole = getLoopModelOptionsForCliFromStore(store, cli, role, configId);
  if (optionsForRole.length === 0) {
    return null;
  }
  const selectedByRole = store?.selectedLoopByConfigId?.[configId]?.[role];
  const normalizedSelectedByRole = normalizeCliModelName(selectedByRole);
  if (
    normalizedSelectedByRole
    && optionsForRole.some((modelName) => modelName.toLowerCase() === normalizedSelectedByRole.toLowerCase())
  ) {
    return normalizedSelectedByRole;
  }
  const selectedModel = getSelectedCliModelFromStore(store, cli, configId);
  if (
    selectedModel
    && optionsForRole.some((modelName) => modelName.toLowerCase() === selectedModel.toLowerCase())
  ) {
    return selectedModel;
  }
  return optionsForRole[0] ?? null;
}

function loopThinkingStorageKey(cli: CliName, model: string | null | undefined): string | null {
  return normalizeCliModelName(model) ?? (cli === "claude" ? "__default__" : null);
}

function supportsLoopRoleThinkingStorage(cli: CliName): boolean {
  return supportsLoopRoleModelStorage(cli) || cli === "claude" || cli === "dsh";
}

export function getSelectedLoopThinkingModeFromStore(
  store: CliModelStore,
  cli: CliName,
  role: LoopTaskRoleForModelSelection,
  model: string | null | undefined,
  configId: string | null
): ThinkingMode | null {
  const normalizedModel = loopThinkingStorageKey(cli, model);
  if (!configId || !supportsLoopRoleThinkingStorage(cli) || !normalizedModel) {
    return null;
  }
  const roleThinking = store?.loopThinkingByConfigId?.[configId]?.[role];
  const matchedKey = findCaseInsensitiveRecordKey(roleThinking, normalizedModel);
  if (!matchedKey) {
    return null;
  }
  const stored = roleThinking?.[matchedKey];
  return isKnownThinkingMode(stored) ? stored : null;
}

export function setSelectedLoopThinkingModeInStore(
  store: CliModelStore,
  cli: CliName,
  role: LoopTaskRoleForModelSelection,
  model: string | null | undefined,
  thinkingMode: ThinkingMode | null,
  configId: string | null
): CliModelStore {
  const normalizedModel = loopThinkingStorageKey(cli, model);
  if (!configId || !supportsLoopRoleThinkingStorage(cli) || !normalizedModel) {
    return ensureCliModelStore(store);
  }
  const nextStore = ensureCliModelStore(store);
  const currentByRole = nextStore.loopThinkingByConfigId[configId] ?? {};
  const nextByRole: Partial<Record<LoopTaskRoleForModelSelection, Record<string, ThinkingMode>>> = { ...currentByRole };
  const currentByModel = nextByRole[role] ?? {};
  const nextByModel = { ...currentByModel };
  const matchedKey = findCaseInsensitiveRecordKey(nextByModel, normalizedModel);
  const targetKey = matchedKey ?? normalizedModel;
  if (thinkingMode && isKnownThinkingMode(thinkingMode)) {
    nextByModel[targetKey] = thinkingMode;
  } else {
    delete nextByModel[targetKey];
  }
  if (Object.keys(nextByModel).length > 0) {
    nextByRole[role] = nextByModel;
  } else {
    delete nextByRole[role];
  }
  if (Object.keys(nextByRole).length > 0) {
    nextStore.loopThinkingByConfigId[configId] = nextByRole;
  } else {
    delete nextStore.loopThinkingByConfigId[configId];
  }
  return ensureCliModelStore(nextStore);
}

export function selectCliModelInStore(
  store: CliModelStore,
  cli: CliName,
  model: string | null,
  configId: string | null,
): CliModelStore {
  if (!configId || !supportsConfigScopedCliModel(cli)) {
    return ensureCliModelStore(store);
  }
  const normalized = normalizeCliModelName(model);
  const nextStore = ensureCliModelStore(store);
  if (normalized) {
    nextStore.optionsByConfigId[configId] = mergeUniqueModelNames(nextStore.optionsByConfigId[configId] ?? [], [normalized]);
    nextStore.selectedByConfigId[configId] = normalized;
  } else {
    delete nextStore.selectedByConfigId[configId];
  }
  return ensureCliModelStore(nextStore);
}

export function selectCliLoopModelInStore(
  store: CliModelStore,
  cli: CliName,
  role: LoopTaskRoleForModelSelection,
  model: string | null,
  configId: string | null,
): CliModelStore {
  if (cli === "opencode") {
    return setOpenCodeRoleModelInStore(store, configId, role, model);
  }
  if (!configId || !supportsLoopRoleModelStorage(cli)) {
    return ensureCliModelStore(store);
  }
  const nextStore = ensureCliModelStore(store);
  const existingSelection = nextStore.selectedLoopByConfigId[configId] ?? {};
  const nextSelection: Partial<Record<LoopTaskRoleForModelSelection, string>> = { ...existingSelection };
  const normalizedModel = normalizeCliModelName(model);
  if (!normalizedModel) {
    delete nextSelection[role];
    if (Object.keys(nextSelection).length === 0) {
      delete nextStore.selectedLoopByConfigId[configId];
    } else {
      nextStore.selectedLoopByConfigId[configId] = nextSelection;
    }
    return ensureCliModelStore(nextStore);
  }
  const roleOptions = getLoopModelOptionsForCliFromStore(store, cli, role, configId);
  const existsInRoleOptions = roleOptions.some((option) => option.toLowerCase() === normalizedModel.toLowerCase());
  if (!existsInRoleOptions) {
    return ensureCliModelStore(store);
  }
  nextSelection[role] = normalizedModel;
  nextStore.selectedLoopByConfigId[configId] = nextSelection;
  return ensureCliModelStore(nextStore);
}

export function getSelectedLoopSubtaskCliFromStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
): CliName | null {
  if (!mainConfigId) {
    return null;
  }
  const normalized = ensureCliModelStore(store);
  return normalized.selectedLoopSubtaskCliByConfigId[mainConfigId] ?? null;
}

export function selectLoopSubtaskCliInStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
  cli: CliName | null,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!mainConfigId) {
    return nextStore;
  }
  if (!cli) {
    delete nextStore.selectedLoopSubtaskCliByConfigId[mainConfigId];
    return nextStore;
  }
  nextStore.selectedLoopSubtaskCliByConfigId[mainConfigId] = cli;
  return nextStore;
}

export function getSelectedLoopFrontendModelFromStore(
  store: CliModelStore | undefined,
  configId: string | null | undefined,
): string | null {
  if (!configId) {
    return null;
  }
  const normalized = ensureCliModelStore(store);
  return normalized.selectedLoopFrontendModelByConfigId[configId] ?? null;
}

export function selectLoopFrontendModelInStore(
  store: CliModelStore | undefined,
  configId: string | null | undefined,
  model: string | null,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!configId) {
    return nextStore;
  }
  const normalizedModel = normalizeCliModelName(model);
  if (!normalizedModel) {
    delete nextStore.selectedLoopFrontendModelByConfigId[configId];
    return nextStore;
  }
  nextStore.selectedLoopFrontendModelByConfigId[configId] = normalizedModel;
  return nextStore;
}

export function getSelectedLoopFrontendThinkingFromStore(
  store: CliModelStore | undefined,
  configId: string | null | undefined,
  model: string | null | undefined,
): ThinkingMode | null {
  if (!configId) {
    return null;
  }
  const normalized = ensureCliModelStore(store);
  const key = normalizeCliModelName(model) ?? "__default__";
  return normalized.selectedLoopFrontendThinkingByConfigId[configId]?.[key] ?? null;
}

export function setSelectedLoopFrontendThinkingInStore(
  store: CliModelStore | undefined,
  configId: string | null | undefined,
  model: string | null | undefined,
  thinkingMode: ThinkingMode | null,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!configId) {
    return nextStore;
  }
  const key = normalizeCliModelName(model) ?? "__default__";
  const current = { ...(nextStore.selectedLoopFrontendThinkingByConfigId[configId] ?? {}) };
  if (thinkingMode && isKnownThinkingMode(thinkingMode)) {
    current[key] = thinkingMode;
  } else {
    delete current[key];
  }
  if (Object.keys(current).length > 0) {
    nextStore.selectedLoopFrontendThinkingByConfigId[configId] = current;
  } else {
    delete nextStore.selectedLoopFrontendThinkingByConfigId[configId];
  }
  return nextStore;
}

export function getSelectedLoopFrontendCliFromStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
): CliName | null {
  if (!mainConfigId) {
    return null;
  }
  const normalized = ensureCliModelStore(store);
  return normalized.selectedLoopFrontendCliByConfigId[mainConfigId] ?? null;
}

export function selectLoopFrontendCliInStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
  cli: CliName | null,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!mainConfigId) {
    return nextStore;
  }
  if (!cli) {
    delete nextStore.selectedLoopFrontendCliByConfigId[mainConfigId];
    return nextStore;
  }
  nextStore.selectedLoopFrontendCliByConfigId[mainConfigId] = cli;
  return nextStore;
}

export function getSelectedLoopFullstackCliFromStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
): CliName | null {
  if (!mainConfigId) {
    return null;
  }
  return ensureCliModelStore(store).selectedLoopFullstackCliByConfigId[mainConfigId] ?? null;
}

export function selectLoopFullstackCliInStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
  cli: CliName | null,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!mainConfigId) {
    return nextStore;
  }
  if (!cli) {
    delete nextStore.selectedLoopFullstackCliByConfigId[mainConfigId];
    return nextStore;
  }
  nextStore.selectedLoopFullstackCliByConfigId[mainConfigId] = cli;
  return nextStore;
}

export function getSelectedLoopSubtaskModeFromStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
): LoopSubtaskMode {
  if (!mainConfigId) {
    return "fullstack";
  }
  return ensureCliModelStore(store).selectedLoopSubtaskModeByConfigId[mainConfigId] ?? "fullstack";
}

export function selectLoopSubtaskModeInStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
  mode: LoopSubtaskMode,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!mainConfigId) {
    return nextStore;
  }
  nextStore.selectedLoopSubtaskModeByConfigId[mainConfigId] = mode;
  return nextStore;
}

export function getLoopRoleExplicitModelFromStore(
  store: CliModelStore | undefined,
  configId: string | null | undefined,
  role: LoopPlusConfigRole,
): { configured: boolean; model: string } {
  if (!configId) {
    return { configured: false, model: "" };
  }
  const bucket = ensureCliModelStore(store).loopRoleExplicitModelByConfigId[configId];
  if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, role)) {
    return { configured: false, model: "" };
  }
  return { configured: true, model: bucket[role] ?? "" };
}

export function setLoopRoleExplicitModelInStore(
  store: CliModelStore | undefined,
  configId: string | null | undefined,
  role: LoopPlusConfigRole,
  model: string,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!configId) {
    return nextStore;
  }
  const current = { ...(nextStore.loopRoleExplicitModelByConfigId[configId] ?? {}) };
  current[role] = model.trim();
  nextStore.loopRoleExplicitModelByConfigId[configId] = current;
  if (role === "frontend") {
    if (current.frontend) {
      nextStore.selectedLoopFrontendModelByConfigId[configId] = current.frontend;
    } else {
      delete nextStore.selectedLoopFrontendModelByConfigId[configId];
    }
  }
  return nextStore;
}

export function getSelectedLoopFullstackThinkingFromStore(
  store: CliModelStore | undefined,
  configId: string | null | undefined,
  model: string | null | undefined,
): ThinkingMode | null {
  if (!configId) {
    return null;
  }
  const key = normalizeCliModelName(model) ?? "__default__";
  return ensureCliModelStore(store).selectedLoopFullstackThinkingByConfigId[configId]?.[key] ?? null;
}

export function setSelectedLoopFullstackThinkingInStore(
  store: CliModelStore | undefined,
  configId: string | null | undefined,
  model: string | null | undefined,
  thinkingMode: ThinkingMode | null,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!configId) {
    return nextStore;
  }
  const key = normalizeCliModelName(model) ?? "__default__";
  const current = { ...(nextStore.selectedLoopFullstackThinkingByConfigId[configId] ?? {}) };
  if (thinkingMode && isKnownThinkingMode(thinkingMode)) {
    current[key] = thinkingMode;
  } else {
    delete current[key];
  }
  if (Object.keys(current).length > 0) {
    nextStore.selectedLoopFullstackThinkingByConfigId[configId] = current;
  } else {
    delete nextStore.selectedLoopFullstackThinkingByConfigId[configId];
  }
  return nextStore;
}

export function markLoopFullstackRoleSeededInStore(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
): CliModelStore {
  const nextStore = ensureCliModelStore(store);
  if (!mainConfigId) {
    return nextStore;
  }
  nextStore.loopFullstackRoleSeededByConfigId[mainConfigId] = true;
  return nextStore;
}

export function loopFullstackRoleNeedsSeed(
  store: CliModelStore | undefined,
  mainConfigId: string | null | undefined,
): boolean {
  if (!mainConfigId) {
    return false;
  }
  const normalized = ensureCliModelStore(store);
  if (normalized.loopFullstackRoleSeededByConfigId[mainConfigId]) {
    return false;
  }
  if (normalized.selectedLoopFullstackCliByConfigId[mainConfigId]) {
    return false;
  }
  return true;
}

export function setCliModelLoopRoleInStore(
  store: CliModelStore,
  cli: CliName,
  model: string,
  role: LoopTaskRoleForModelSelection,
  enabled: boolean,
  configId: string | null
): { store: CliModelStore; updated: boolean } {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel || !supportsLoopRoleModelStorage(cli)) {
    return { store: ensureCliModelStore(store), updated: false };
  }
  const managedModels = getManagedModelOptionsForCliFromStore(store, cli, configId);
  const exists = managedModels.some((item) => item.toLowerCase() === normalizedModel.toLowerCase());
  if (!exists) {
    return { store: ensureCliModelStore(store), updated: false };
  }
  const nextStore = ensureCliModelStore(store);
  const existingFlags = getCliModelLoopRoleFlagsFromStore(store, cli, normalizedModel, configId);
  const nextFlags = {
    main: existingFlags.main,
    subtask: existingFlags.subtask,
  };
  if (role === "main") {
    nextFlags.main = enabled;
  } else {
    nextFlags.subtask = enabled;
  }
  if (!nextFlags.main && !nextFlags.subtask) {
    return { store: nextStore, updated: false };
  }
  const rolesByModel = {
    ...(nextStore.loopRolesByConfigId[configId] ?? {}),
  };
  rolesByModel[normalizedModel] = nextFlags;
  nextStore.loopRolesByConfigId[configId] = rolesByModel;

  const selectedByRole = nextStore.selectedLoopByConfigId[configId];
  if (selectedByRole) {
    const selectedModel = selectedByRole[role];
    if (selectedModel && selectedModel.toLowerCase() === normalizedModel.toLowerCase() && !enabled) {
      delete selectedByRole[role];
      if (Object.keys(selectedByRole).length === 0) {
        delete nextStore.selectedLoopByConfigId[configId];
      }
    }
  }

  return { store: ensureCliModelStore(nextStore), updated: true };
}

export function renameCliModelInStore(
  store: CliModelStore,
  cli: CliName,
  previousModel: string,
  nextModel: string,
  configId: string | null
): { store: CliModelStore; renamedModel: string | null } {
  const previousNormalized = normalizeCliModelName(previousModel);
  const nextNormalized = normalizeCliModelName(nextModel);
  if (!previousNormalized || !nextNormalized || !configId || !supportsConfigScopedCliModel(cli)) {
    return { store: ensureCliModelStore(store), renamedModel: null };
  }
  const previousKey = previousNormalized.toLowerCase();
  const nextKey = nextNormalized.toLowerCase();
  const nextStore = ensureCliModelStore(store);
  const currentOptions = nextStore.optionsByConfigId[configId] ?? [];
  const duplicateExists = currentOptions.some((modelName) => {
    const normalized = normalizeCliModelName(modelName);
    if (!normalized) {
      return false;
    }
    const currentKey = normalized.toLowerCase();
    return currentKey === nextKey && currentKey !== previousKey;
  });
  if (duplicateExists) {
    return { store: nextStore, renamedModel: null };
  }

  const renamedOptions = currentOptions.map((modelName) => {
    const normalized = normalizeCliModelName(modelName);
    return normalized && normalized.toLowerCase() === previousKey ? nextNormalized : modelName;
  });
  nextStore.optionsByConfigId[configId] = mergeUniqueModelNames(renamedOptions);

  if (normalizeCliModelName(nextStore.selectedByConfigId[configId])?.toLowerCase() === previousKey) {
    nextStore.selectedByConfigId[configId] = nextNormalized;
  }

  const cliThinking = nextStore.thinkingByCliAndModel?.[cli];
  if (cliThinking) {
    const matchedThinkingKey = Object.keys(cliThinking).find((key) => key.toLowerCase() === previousKey);
    if (matchedThinkingKey) {
      const nextThinking = { ...cliThinking };
      nextThinking[nextNormalized] = nextThinking[matchedThinkingKey];
      nextStore.thinkingByCliAndModel[cli] = nextThinking;
    }
  }

  if (supportsLoopRoleModelStorage(cli)) {
    const rolesByModel = nextStore.loopRolesByConfigId[configId];
    if (rolesByModel) {
      const matchedRoleKey = Object.keys(rolesByModel).find((key) => key.toLowerCase() === previousKey);
      if (matchedRoleKey) {
        const nextRolesByModel = { ...rolesByModel };
        nextRolesByModel[nextNormalized] = normalizeLoopModelRoleFlags(nextRolesByModel[matchedRoleKey]);
        delete nextRolesByModel[matchedRoleKey];
        nextStore.loopRolesByConfigId[configId] = nextRolesByModel;
      }
    }
    const selectedByRole = nextStore.selectedLoopByConfigId[configId];
    if (selectedByRole) {
      const nextSelectedByRole: Partial<Record<LoopTaskRoleForModelSelection, string>> = { ...selectedByRole };
      let changed = false;
      (["main", "subtask"] as LoopTaskRoleForModelSelection[]).forEach((role) => {
        const roleModel = normalizeCliModelName(nextSelectedByRole[role]);
        if (roleModel && roleModel.toLowerCase() === previousKey) {
          nextSelectedByRole[role] = nextNormalized;
          changed = true;
        }
      });
      if (changed) {
        nextStore.selectedLoopByConfigId[configId] = nextSelectedByRole;
      }
    }
    const loopThinkingByRole = nextStore.loopThinkingByConfigId[configId];
    if (loopThinkingByRole) {
      const nextLoopThinkingByRole: Partial<Record<LoopTaskRoleForModelSelection, Record<string, ThinkingMode>>> = {
        ...loopThinkingByRole,
      };
      let changed = false;
      (["main", "subtask"] as LoopTaskRoleForModelSelection[]).forEach((role) => {
        const thinkingByModel = nextLoopThinkingByRole[role];
        const matchedThinkingKey = findCaseInsensitiveRecordKey(thinkingByModel, previousNormalized);
        if (!thinkingByModel || !matchedThinkingKey) {
          return;
        }
        const nextThinkingByModel = { ...thinkingByModel };
        nextThinkingByModel[nextNormalized] = nextThinkingByModel[matchedThinkingKey];
        delete nextThinkingByModel[matchedThinkingKey];
        nextLoopThinkingByRole[role] = nextThinkingByModel;
        changed = true;
      });
      if (changed) {
        nextStore.loopThinkingByConfigId[configId] = nextLoopThinkingByRole;
      }
    }
  }

  return { store: ensureCliModelStore(nextStore), renamedModel: nextNormalized };
}

export function deleteCliModelFromStore(
  store: CliModelStore,
  cli: CliName,
  model: string,
  configId: string | null
): CliModelStore {
  const normalized = normalizeCliModelName(model);
  if (!normalized || !configId || !supportsConfigScopedCliModel(cli)) {
    return ensureCliModelStore(store);
  }
  const targetKey = normalized.toLowerCase();
  const nextStore = ensureCliModelStore(store);
  const currentOptions = nextStore.optionsByConfigId[configId] ?? [];
  nextStore.optionsByConfigId[configId] = currentOptions.filter((modelName) => {
    const currentNormalized = normalizeCliModelName(modelName);
    return !(currentNormalized && currentNormalized.toLowerCase() === targetKey);
  });

  if (normalizeCliModelName(nextStore.selectedByConfigId[configId])?.toLowerCase() === targetKey) {
    delete nextStore.selectedByConfigId[configId];
  }

  if (!supportsLoopRoleModelStorage(cli)) {
    return ensureCliModelStore(nextStore);
  }

  const rolesByModel = nextStore.loopRolesByConfigId[configId];
  if (rolesByModel) {
    const nextRolesByModel = { ...rolesByModel };
    Object.keys(nextRolesByModel).forEach((key) => {
      if (key.toLowerCase() === targetKey) {
        delete nextRolesByModel[key];
      }
    });
    if (Object.keys(nextRolesByModel).length > 0) {
      nextStore.loopRolesByConfigId[configId] = nextRolesByModel;
    } else {
      delete nextStore.loopRolesByConfigId[configId];
    }
  }
  const selectedByRole = nextStore.selectedLoopByConfigId[configId];
  if (selectedByRole) {
    const nextSelectedByRole: Partial<Record<LoopTaskRoleForModelSelection, string>> = { ...selectedByRole };
    (["main", "subtask"] as LoopTaskRoleForModelSelection[]).forEach((role) => {
      const roleModel = normalizeCliModelName(nextSelectedByRole[role]);
      if (roleModel && roleModel.toLowerCase() === targetKey) {
        delete nextSelectedByRole[role];
      }
    });
    if (Object.keys(nextSelectedByRole).length > 0) {
      nextStore.selectedLoopByConfigId[configId] = nextSelectedByRole;
    } else {
      delete nextStore.selectedLoopByConfigId[configId];
    }
  }
  const loopThinkingByRole = nextStore.loopThinkingByConfigId[configId];
  if (loopThinkingByRole) {
    const nextLoopThinkingByRole: Partial<Record<LoopTaskRoleForModelSelection, Record<string, ThinkingMode>>> = {
      ...loopThinkingByRole,
    };
    (["main", "subtask"] as LoopTaskRoleForModelSelection[]).forEach((role) => {
      const thinkingByModel = nextLoopThinkingByRole[role];
      if (!thinkingByModel) {
        return;
      }
      const nextThinkingByModel = { ...thinkingByModel };
      Object.keys(nextThinkingByModel).forEach((key) => {
        if (key.toLowerCase() === targetKey) {
          delete nextThinkingByModel[key];
        }
      });
      if (Object.keys(nextThinkingByModel).length > 0) {
        nextLoopThinkingByRole[role] = nextThinkingByModel;
      } else {
        delete nextLoopThinkingByRole[role];
      }
    });
    if (Object.keys(nextLoopThinkingByRole).length > 0) {
      nextStore.loopThinkingByConfigId[configId] = nextLoopThinkingByRole;
    } else {
      delete nextStore.loopThinkingByConfigId[configId];
    }
  }

  return ensureCliModelStore(nextStore);
}

export function moveCliModelInStore(
  store: CliModelStore,
  cli: CliName,
  model: string,
  direction: "up" | "down",
  configId: string | null
): { store: CliModelStore; movedModel: string | null } {
  const normalized = normalizeCliModelName(model);
  if (!normalized || !configId || !supportsConfigScopedCliModel(cli)) {
    return { store: ensureCliModelStore(store), movedModel: null };
  }
  const targetKey = normalized.toLowerCase();
  const nextStore = ensureCliModelStore(store);
  const currentOptions = [...(nextStore.optionsByConfigId[configId] ?? [])];
  const currentIndex = currentOptions.findIndex((modelName) => {
    const currentNormalized = normalizeCliModelName(modelName);
    return Boolean(currentNormalized && currentNormalized.toLowerCase() === targetKey);
  });
  if (currentIndex < 0) {
    return { store: nextStore, movedModel: null };
  }
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= currentOptions.length) {
    return { store: nextStore, movedModel: normalized };
  }
  const swapped = currentOptions[currentIndex];
  currentOptions[currentIndex] = currentOptions[nextIndex];
  currentOptions[nextIndex] = swapped;
  nextStore.optionsByConfigId[configId] = mergeUniqueModelNames(currentOptions);
  return { store: ensureCliModelStore(nextStore), movedModel: normalized };
}

export function getModelOptionsForConfigFromStore(store: CliModelStore, configId: string | null): string[] {
  if (!configId) {
    return [];
  }
  const normalizedStore = ensureCliModelStore(store);
  const storedOptions = normalizedStore.optionsByConfigId[configId] ?? [];
  const selectedModel = normalizeCliModelName(normalizedStore.selectedByConfigId[configId]);
  return mergeUniqueModelNames(
    storedOptions,
    selectedModel ? [selectedModel] : []
  );
}

export function getManagedModelOptionsForConfigFromStore(store: CliModelStore, configId: string | null): string[] {
  if (!configId) {
    return [];
  }
  const normalizedStore = ensureCliModelStore(store);
  return mergeUniqueModelNames(normalizedStore.optionsByConfigId[configId] ?? []);
}

export function summarizeModelStoreByConfigId(store: CliModelStore): Record<string, number> {
  const normalizedStore = ensureCliModelStore(store);
  const configIds = new Set<string>([
    ...Object.keys(normalizedStore.optionsByConfigId),
    ...Object.keys(normalizedStore.selectedByConfigId),
  ]);
  const summary: Record<string, number> = {};
  Array.from(configIds)
    .sort((left, right) => left.localeCompare(right))
    .forEach((configId) => {
      summary[configId] = getModelOptionsForConfigFromStore(normalizedStore, configId).length;
    });
  return summary;
}

export function countStoreModels(summary: Record<string, number>): number {
  return Object.values(summary).reduce((total, count) => total + count, 0);
}

export function getEffectiveCliArgs(cli: CliName, model: string | null): string[] {
  return applyModelArg(cli, getCliArgs(cli), model);
}

export function buildModelState(
  store: CliModelStore,
  getActiveConfigIdForCli: (cli: CliName) => string | null,
  activeConfigIdByCli: Partial<Record<CliName, string | null>> = {}
): PanelState["modelState"] {
  const selectedByCli = {} as Record<CliName, string | null>;
  const optionsByCli = {} as Record<CliName, string[]>;
  const managedByCli = {} as Record<CliName, string[]>;
  const selectedLoopByCli: NonNullable<PanelState["modelState"]["selectedLoopByCli"]> = {};
  const selectedLoopThinkingByCli: NonNullable<PanelState["modelState"]["selectedLoopThinkingByCli"]> = {};
  const loopOptionsByCli: NonNullable<PanelState["modelState"]["loopOptionsByCli"]> = {};
  const resolvedActiveConfigIdByCli: Partial<Record<CliName, string | null>> = {};
  for (const cli of CLI_LIST) {
    const providedConfigId = activeConfigIdByCli[cli];
    const activeConfigId = providedConfigId !== undefined ? providedConfigId : getActiveConfigIdForCli(cli);
    resolvedActiveConfigIdByCli[cli] = activeConfigId;
    const managedModels = getManagedModelOptionsForCliFromStore(store, cli, activeConfigId);
    selectedByCli[cli] = getSelectedCliModelFromStore(store, cli, activeConfigId);
    optionsByCli[cli] = getModelOptionsForCliFromStore(store, cli, activeConfigId);
    managedByCli[cli] = managedModels;
    if (supportsLoopRoleModelStorage(cli)) {
      const loopMainModel = getSelectedLoopCliModelFromStore(store, cli, "main", activeConfigId);
      const loopSubtaskModel = getSelectedLoopCliModelFromStore(store, cli, "subtask", activeConfigId);
      const loopMainThinkingMode = getSelectedLoopThinkingModeFromStore(store, cli, "main", loopMainModel, activeConfigId);
      const loopSubtaskThinkingMode = getSelectedLoopThinkingModeFromStore(store, cli, "subtask", loopSubtaskModel, activeConfigId);
      loopOptionsByCli[cli] = {
        main: getLoopModelOptionsForCliFromStore(store, cli, "main", activeConfigId),
        subtask: getLoopModelOptionsForCliFromStore(store, cli, "subtask", activeConfigId),
      };
      selectedLoopByCli[cli] = {
        main: loopMainModel,
        subtask: loopSubtaskModel,
      };
      if (loopMainThinkingMode || loopSubtaskThinkingMode) {
        selectedLoopThinkingByCli[cli] = {
          main: loopMainThinkingMode,
          subtask: loopSubtaskThinkingMode,
        };
      }
    } else if (cli === "opencode") {
      const openCodeMain = getSelectedLoopCliModelFromStore(store, cli, "main", activeConfigId);
      const openCodeSubtask = getSelectedLoopCliModelFromStore(store, cli, "subtask", activeConfigId);
      if (openCodeMain || openCodeSubtask) {
        selectedLoopByCli[cli] = {
          main: openCodeMain,
          subtask: openCodeSubtask,
        };
      }
    }
  }
  return {
    selectedByCli,
    optionsByCli,
    managedByCli,
    ...(Object.keys(ensureCliModelStore(store).selectedLoopSubtaskCliByConfigId).length > 0
      ? { selectedLoopSubtaskCliByConfigId: { ...ensureCliModelStore(store).selectedLoopSubtaskCliByConfigId } }
      : {}),
    ...(Object.keys(ensureCliModelStore(store).selectedLoopFrontendCliByConfigId).length > 0
      ? { selectedLoopFrontendCliByConfigId: { ...ensureCliModelStore(store).selectedLoopFrontendCliByConfigId } }
      : {}),
    ...(Object.keys(ensureCliModelStore(store).selectedLoopFullstackCliByConfigId).length > 0
      ? { selectedLoopFullstackCliByConfigId: { ...ensureCliModelStore(store).selectedLoopFullstackCliByConfigId } }
      : {}),
    ...(Object.keys(ensureCliModelStore(store).selectedLoopSubtaskModeByConfigId).length > 0
      ? { selectedLoopSubtaskModeByConfigId: { ...ensureCliModelStore(store).selectedLoopSubtaskModeByConfigId } }
      : {}),
    ...(Object.keys(ensureCliModelStore(store).loopRoleExplicitModelByConfigId).length > 0
      ? { loopRoleExplicitModelByConfigId: { ...ensureCliModelStore(store).loopRoleExplicitModelByConfigId } }
      : {}),
    ...(Object.keys(ensureCliModelStore(store).selectedLoopFullstackThinkingByConfigId).length > 0
      ? { selectedLoopFullstackThinkingByConfigId: { ...ensureCliModelStore(store).selectedLoopFullstackThinkingByConfigId } }
      : {}),
    ...(Object.keys(ensureCliModelStore(store).selectedLoopFrontendThinkingByConfigId).length > 0
      ? { selectedLoopFrontendThinkingByConfigId: { ...ensureCliModelStore(store).selectedLoopFrontendThinkingByConfigId } }
      : {}),
    ...(Object.keys(ensureCliModelStore(store).loopFullstackRoleSeededByConfigId).length > 0
      ? { loopFullstackRoleSeededByConfigId: { ...ensureCliModelStore(store).loopFullstackRoleSeededByConfigId } }
      : {}),
    activeConfigIdByCli: resolvedActiveConfigIdByCli,
    ...(Object.keys(selectedLoopByCli).length > 0 ? { selectedLoopByCli } : {}),
    ...(Object.keys(selectedLoopThinkingByCli).length > 0 ? { selectedLoopThinkingByCli } : {}),
    ...(Object.keys(loopOptionsByCli).length > 0 ? { loopOptionsByCli } : {}),
  };
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? (error.message || String(error)) : String(error);
}
