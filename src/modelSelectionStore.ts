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

export type LobsterTaskRoleForModelSelection = "main" | "subtask";

export type CliModelStore = {
  selectedByConfigId: Record<string, string>;
  optionsByConfigId: Record<string, string[]>;
  thinkingByCliAndModel: Partial<Record<CliName, Record<string, ThinkingMode>>>;
  selectedLobsterByConfigId: Record<string, Partial<Record<LobsterTaskRoleForModelSelection, string>>>;
  lobsterRolesByConfigId: Record<string, Record<string, { main: boolean; subtask: boolean }>>;
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

export function normalizeLobsterModelRoleFlags(value: unknown): { main: boolean; subtask: boolean } {
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

export function isLobsterTaskRoleValue(value: unknown): value is LobsterTaskRoleForModelSelection {
  return value === "main" || value === "subtask";
}

export function ensureCliModelStore(
  store?: CliModelStore,
  options?: Pick<ModelSelectionStoreOptions, "defaultModelStoreKey" | "isThinkingMode" | "normalizeThinkingModeForCli">
): CliModelStore {
  const normalized: CliModelStore = {
    selectedByConfigId: {},
    optionsByConfigId: {},
    thinkingByCliAndModel: {},
    selectedLobsterByConfigId: {},
    lobsterRolesByConfigId: {},
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
  const storedSelectedLobsterByConfigId = store?.selectedLobsterByConfigId;
  if (storedSelectedLobsterByConfigId && typeof storedSelectedLobsterByConfigId === "object") {
    for (const [configId, rawSelection] of Object.entries(storedSelectedLobsterByConfigId)) {
      if (!configId || !rawSelection || typeof rawSelection !== "object") {
        continue;
      }
      const nextSelection: Partial<Record<LobsterTaskRoleForModelSelection, string>> = {};
      for (const [rawRole, rawModel] of Object.entries(rawSelection)) {
        if (!isLobsterTaskRoleValue(rawRole)) {
          continue;
        }
        const normalizedModel = normalizeCliModelName(rawModel);
        if (!normalizedModel) {
          continue;
        }
        nextSelection[rawRole] = normalizedModel;
      }
      if (Object.keys(nextSelection).length > 0) {
        normalized.selectedLobsterByConfigId[configId] = nextSelection;
      }
    }
  }
  const storedLobsterRolesByConfigId = store?.lobsterRolesByConfigId;
  if (storedLobsterRolesByConfigId && typeof storedLobsterRolesByConfigId === "object") {
    for (const [configId, rawRolesByModel] of Object.entries(storedLobsterRolesByConfigId)) {
      if (!configId || !rawRolesByModel || typeof rawRolesByModel !== "object") {
        continue;
      }
      const nextRolesByModel: Record<string, { main: boolean; subtask: boolean }> = {};
      for (const [rawModel, rawRoleFlags] of Object.entries(rawRolesByModel)) {
        const normalizedModel = normalizeCliModelName(rawModel);
        if (!normalizedModel) {
          continue;
        }
        nextRolesByModel[normalizedModel] = normalizeLobsterModelRoleFlags(rawRoleFlags);
      }
      if (Object.keys(nextRolesByModel).length > 0) {
        normalized.lobsterRolesByConfigId[configId] = nextRolesByModel;
      }
    }
  }
  if (options) {
    for (const cli of CLI_LIST) {
      const storedThinkingByModel = store?.thinkingByCliAndModel?.[cli];
      if (storedThinkingByModel && typeof storedThinkingByModel === "object") {
        const normalizedThinkingByModel: Record<string, ThinkingMode> = {};
        for (const [rawModelKey, rawThinkingMode] of Object.entries(storedThinkingByModel)) {
          const normalizedModelKey = rawModelKey === options.defaultModelStoreKey
            ? options.defaultModelStoreKey
            : normalizeCliModelName(rawModelKey);
          if (!normalizedModelKey || !options.isThinkingMode(rawThinkingMode)) {
            continue;
          }
          normalizedThinkingByModel[normalizedModelKey] = options.normalizeThinkingModeForCli(cli, rawThinkingMode);
        }
        if (Object.keys(normalizedThinkingByModel).length > 0) {
          normalized.thinkingByCliAndModel[cli] = normalizedThinkingByModel;
        }
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

export function getSelectedCliModelFromStore(
  store: CliModelStore,
  cli: CliName,
  configId: string | null
): string | null {
  if (!configId || !supportsCliManagedModelSelection(cli)) {
    return null;
  }
  return normalizeCliModelName(store?.selectedByConfigId?.[configId]);
}

export function getManagedModelOptionsForCliFromStore(
  store: CliModelStore,
  cli: CliName,
  configId: string | null
): string[] {
  if (!configId || !supportsCliManagedModelSelection(cli)) {
    return [];
  }
  const storedOptions = Array.isArray(store?.optionsByConfigId?.[configId])
    ? store.optionsByConfigId[configId] ?? []
    : [];
  return mergeUniqueModelNames(storedOptions);
}

export function getCliModelLobsterRoleFlagsFromStore(
  store: CliModelStore,
  cli: CliName,
  model: string,
  configId: string | null
): { main: boolean; subtask: boolean } {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel || !supportsCliManagedModelSelection(cli)) {
    return { main: true, subtask: true };
  }
  const rolesByModel = store?.lobsterRolesByConfigId?.[configId];
  if (!rolesByModel || typeof rolesByModel !== "object") {
    return { main: true, subtask: true };
  }
  const matchedKey = Object.keys(rolesByModel).find((key) => key.toLowerCase() === normalizedModel.toLowerCase());
  if (!matchedKey) {
    return { main: true, subtask: true };
  }
  return normalizeLobsterModelRoleFlags(rolesByModel[matchedKey]);
}

export function getModelOptionsForCliFromStore(
  store: CliModelStore,
  cli: CliName,
  configId: string | null
): string[] {
  if (!configId || !supportsCliManagedModelSelection(cli)) {
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

export function getLobsterModelOptionsForCliFromStore(
  store: CliModelStore,
  cli: CliName,
  role: LobsterTaskRoleForModelSelection,
  configId: string | null
): string[] {
  if (!configId || !supportsCliManagedModelSelection(cli)) {
    return [];
  }
  const options = getModelOptionsForCliFromStore(store, cli, configId);
  return options.filter((modelName) => {
    const roleFlags = getCliModelLobsterRoleFlagsFromStore(store, cli, modelName, configId);
    return role === "main" ? roleFlags.main : roleFlags.subtask;
  });
}

export function getSelectedLobsterCliModelFromStore(
  store: CliModelStore,
  cli: CliName,
  role: LobsterTaskRoleForModelSelection,
  configId: string | null
): string | null {
  if (!configId || !supportsCliManagedModelSelection(cli)) {
    return null;
  }
  const optionsForRole = getLobsterModelOptionsForCliFromStore(store, cli, role, configId);
  if (optionsForRole.length === 0) {
    return null;
  }
  const selectedByRole = store?.selectedLobsterByConfigId?.[configId]?.[role];
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

export function selectCliModelInStore(
  store: CliModelStore,
  cli: CliName,
  model: string | null,
  configId: string | null,
): CliModelStore {
  if (!configId || !supportsCliManagedModelSelection(cli)) {
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

export function selectCliLobsterModelInStore(
  store: CliModelStore,
  cli: CliName,
  role: LobsterTaskRoleForModelSelection,
  model: string | null,
  configId: string | null,
): CliModelStore {
  if (!configId || !supportsCliManagedModelSelection(cli)) {
    return ensureCliModelStore(store);
  }
  const nextStore = ensureCliModelStore(store);
  const existingSelection = nextStore.selectedLobsterByConfigId[configId] ?? {};
  const nextSelection: Partial<Record<LobsterTaskRoleForModelSelection, string>> = { ...existingSelection };
  const normalizedModel = normalizeCliModelName(model);
  if (!normalizedModel) {
    delete nextSelection[role];
    if (Object.keys(nextSelection).length === 0) {
      delete nextStore.selectedLobsterByConfigId[configId];
    } else {
      nextStore.selectedLobsterByConfigId[configId] = nextSelection;
    }
    return ensureCliModelStore(nextStore);
  }
  const roleOptions = getLobsterModelOptionsForCliFromStore(store, cli, role, configId);
  const existsInRoleOptions = roleOptions.some((option) => option.toLowerCase() === normalizedModel.toLowerCase());
  if (!existsInRoleOptions) {
    return ensureCliModelStore(store);
  }
  nextSelection[role] = normalizedModel;
  nextStore.selectedLobsterByConfigId[configId] = nextSelection;
  return ensureCliModelStore(nextStore);
}

export function setCliModelLobsterRoleInStore(
  store: CliModelStore,
  cli: CliName,
  model: string,
  role: LobsterTaskRoleForModelSelection,
  enabled: boolean,
  configId: string | null
): { store: CliModelStore; updated: boolean } {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel || !supportsCliManagedModelSelection(cli)) {
    return { store: ensureCliModelStore(store), updated: false };
  }
  const managedModels = getManagedModelOptionsForCliFromStore(store, cli, configId);
  const exists = managedModels.some((item) => item.toLowerCase() === normalizedModel.toLowerCase());
  if (!exists) {
    return { store: ensureCliModelStore(store), updated: false };
  }
  const nextStore = ensureCliModelStore(store);
  const existingFlags = getCliModelLobsterRoleFlagsFromStore(store, cli, normalizedModel, configId);
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
    ...(nextStore.lobsterRolesByConfigId[configId] ?? {}),
  };
  rolesByModel[normalizedModel] = nextFlags;
  nextStore.lobsterRolesByConfigId[configId] = rolesByModel;

  const selectedByRole = nextStore.selectedLobsterByConfigId[configId];
  if (selectedByRole) {
    const selectedModel = selectedByRole[role];
    if (selectedModel && selectedModel.toLowerCase() === normalizedModel.toLowerCase() && !enabled) {
      delete selectedByRole[role];
      if (Object.keys(selectedByRole).length === 0) {
        delete nextStore.selectedLobsterByConfigId[configId];
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
  if (!previousNormalized || !nextNormalized || !configId || !supportsCliManagedModelSelection(cli)) {
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

  const rolesByModel = nextStore.lobsterRolesByConfigId[configId];
  if (rolesByModel) {
    const matchedRoleKey = Object.keys(rolesByModel).find((key) => key.toLowerCase() === previousKey);
    if (matchedRoleKey) {
      const nextRolesByModel = { ...rolesByModel };
      nextRolesByModel[nextNormalized] = normalizeLobsterModelRoleFlags(nextRolesByModel[matchedRoleKey]);
      delete nextRolesByModel[matchedRoleKey];
      nextStore.lobsterRolesByConfigId[configId] = nextRolesByModel;
    }
  }
  const selectedByRole = nextStore.selectedLobsterByConfigId[configId];
  if (selectedByRole) {
    const nextSelectedByRole: Partial<Record<LobsterTaskRoleForModelSelection, string>> = { ...selectedByRole };
    let changed = false;
    (["main", "subtask"] as LobsterTaskRoleForModelSelection[]).forEach((role) => {
      const roleModel = normalizeCliModelName(nextSelectedByRole[role]);
      if (roleModel && roleModel.toLowerCase() === previousKey) {
        nextSelectedByRole[role] = nextNormalized;
        changed = true;
      }
    });
    if (changed) {
      nextStore.selectedLobsterByConfigId[configId] = nextSelectedByRole;
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
  if (!normalized || !configId || !supportsCliManagedModelSelection(cli)) {
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

  const rolesByModel = nextStore.lobsterRolesByConfigId[configId];
  if (rolesByModel) {
    const nextRolesByModel = { ...rolesByModel };
    Object.keys(nextRolesByModel).forEach((key) => {
      if (key.toLowerCase() === targetKey) {
        delete nextRolesByModel[key];
      }
    });
    if (Object.keys(nextRolesByModel).length > 0) {
      nextStore.lobsterRolesByConfigId[configId] = nextRolesByModel;
    } else {
      delete nextStore.lobsterRolesByConfigId[configId];
    }
  }
  const selectedByRole = nextStore.selectedLobsterByConfigId[configId];
  if (selectedByRole) {
    const nextSelectedByRole: Partial<Record<LobsterTaskRoleForModelSelection, string>> = { ...selectedByRole };
    (["main", "subtask"] as LobsterTaskRoleForModelSelection[]).forEach((role) => {
      const roleModel = normalizeCliModelName(nextSelectedByRole[role]);
      if (roleModel && roleModel.toLowerCase() === targetKey) {
        delete nextSelectedByRole[role];
      }
    });
    if (Object.keys(nextSelectedByRole).length > 0) {
      nextStore.selectedLobsterByConfigId[configId] = nextSelectedByRole;
    } else {
      delete nextStore.selectedLobsterByConfigId[configId];
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
  if (!normalized || !configId || !supportsCliManagedModelSelection(cli)) {
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
  const selectedLobsterByCli = {} as Record<CliName, { main: string | null; subtask: string | null }>;
  const lobsterOptionsByCli = {} as Record<CliName, { main: string[]; subtask: string[] }>;
  const managedLobsterRolesByCli = {} as Record<CliName, Record<string, { main: boolean; subtask: boolean }>>;
  for (const cli of CLI_LIST) {
    const activeConfigId = activeConfigIdByCli[cli] ?? getActiveConfigIdForCli(cli);
    const managedModels = getManagedModelOptionsForCliFromStore(store, cli, activeConfigId);
    selectedByCli[cli] = getSelectedCliModelFromStore(store, cli, activeConfigId);
    optionsByCli[cli] = getModelOptionsForCliFromStore(store, cli, activeConfigId);
    managedByCli[cli] = managedModels;
    lobsterOptionsByCli[cli] = {
      main: getLobsterModelOptionsForCliFromStore(store, cli, "main", activeConfigId),
      subtask: getLobsterModelOptionsForCliFromStore(store, cli, "subtask", activeConfigId),
    };
    selectedLobsterByCli[cli] = {
      main: getSelectedLobsterCliModelFromStore(store, cli, "main", activeConfigId),
      subtask: getSelectedLobsterCliModelFromStore(store, cli, "subtask", activeConfigId),
    };
    managedLobsterRolesByCli[cli] = {};
    managedModels.forEach((modelName) => {
      managedLobsterRolesByCli[cli][modelName] = getCliModelLobsterRoleFlagsFromStore(store, cli, modelName, activeConfigId);
    });
  }
  return {
    selectedByCli,
    optionsByCli,
    managedByCli,
    selectedLobsterByCli,
    lobsterOptionsByCli,
    managedLobsterRolesByCli,
  };
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? (error.message || String(error)) : String(error);
}
