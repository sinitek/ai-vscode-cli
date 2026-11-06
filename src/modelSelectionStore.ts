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
import type { LoopSubtaskMode } from "./loopPlusSubtaskMode";
import type {
  LoopPlusConfigRole,
  LoopTaskRoleForModelSelection,
  CliModelStore,
  ModelSelectionStoreState,
  ModelSelectionStoreOptions,
} from "./modelSelectionStoreTypes";

import {
  ensureCliModelStore,
  normalizeCliModelName,
  mergeUniqueModelNames,
  normalizeLoopModelRoleFlags,
  isLoopTaskRoleValue,
  isKnownThinkingMode,
} from "./modelSelectionStoreNormalization";

export type {
  LoopPlusConfigRole,
  LoopTaskRoleForModelSelection,
  CliModelStore,
  ModelSelectionStoreState,
  ModelSelectionStoreLogger,
  ModelSelectionStoreOptions,
} from "./modelSelectionStoreTypes";

export {
  ensureCliModelStore,
  normalizeCliModelName,
  mergeUniqueModelNames,
  normalizeLoopModelRoleFlags,
  isLoopTaskRoleValue,
} from "./modelSelectionStoreNormalization";

export function createEmptyModelSelectionStoreState(): ModelSelectionStoreState {
  return {
    store: ensureCliModelStore(),
    lastReadError: null,
    lastWriteError: null,
  };
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
