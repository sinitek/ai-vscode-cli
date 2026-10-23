import { resolveGrokConfigModel, type GrokConfigModels } from "../cli/grokConfigModels";
import type { CliName } from "../cli/types";
import {
  getManagedModelOptionsForCliFromStore,
  getModelOptionsForCliFromStore,
  getSelectedCliModelFromStore,
  getSelectedLoopCliModelFromStore,
  selectCliLoopModelInStore,
  selectCliModelInStore,
  type CliModelStore,
  type LoopTaskRoleForModelSelection,
} from "../modelSelectionStore";

export type CliModelSelectionStrategyDeps = {
  getGrokConfigModels: (configId: string | null | undefined) => GrokConfigModels | undefined;
  resolveDefaultGrokStoreKey: () => string;
};

export type CliModelSelectionStrategy = {
  getSelectedModel: (store: CliModelStore, configId: string | null) => string | null;
  getSelectedLoopModel: (
    store: CliModelStore,
    role: LoopTaskRoleForModelSelection,
    configId: string | null,
  ) => string | null;
  getModelOptions: (store: CliModelStore, configId: string | null) => string[];
  getManagedModelOptions: (store: CliModelStore, configId: string | null) => string[];
  selectModel: (store: CliModelStore, model: string | null, configId: string | null) => CliModelStore;
  selectLoopModel: (
    store: CliModelStore,
    role: LoopTaskRoleForModelSelection,
    model: string | null,
    configId: string | null,
  ) => CliModelStore;
  resolveStoreConfigKey: (configId: string | null | undefined) => string | null;
  getModelDisplayName: (model: string | null, configId: string | null) => string | null;
};

type StoreBackedCliName = Exclude<CliName, "grok">;

function createStoreBackedCliModelSelectionStrategy(cli: StoreBackedCliName): CliModelSelectionStrategy {
  return {
    getSelectedModel(store, configId) {
      return getSelectedCliModelFromStore(store, cli, configId);
    },
    getSelectedLoopModel(store, role, configId) {
      return getSelectedLoopCliModelFromStore(store, cli, role, configId);
    },
    getModelOptions(store, configId) {
      return getModelOptionsForCliFromStore(store, cli, configId);
    },
    getManagedModelOptions(store, configId) {
      return getManagedModelOptionsForCliFromStore(store, cli, configId);
    },
    selectModel(store, model, configId) {
      return selectCliModelInStore(store, cli, model, configId);
    },
    selectLoopModel(store, role, model, configId) {
      return selectCliLoopModelInStore(store, cli, role, model, configId);
    },
    resolveStoreConfigKey(configId) {
      return configId ?? null;
    },
    getModelDisplayName(model) {
      return model;
    },
  };
}

function createGrokCliModelSelectionStrategy(deps: CliModelSelectionStrategyDeps): CliModelSelectionStrategy {
  function resolveStoreConfigKey(configId: string | null | undefined): string {
    return configId ?? deps.resolveDefaultGrokStoreKey();
  }

  function getSelectedModel(store: CliModelStore, configId: string | null): string | null {
    const selectedModel = getSelectedCliModelFromStore(store, "grok", resolveStoreConfigKey(configId));
    return resolveGrokConfigModel(deps.getGrokConfigModels(configId), selectedModel);
  }

  return {
    getSelectedModel,
    getSelectedLoopModel(store, role, configId) {
      const storedRoleModel = store.selectedLoopByConfigId?.[resolveStoreConfigKey(configId)]?.[role];
      return resolveGrokConfigModel(
        deps.getGrokConfigModels(configId),
        storedRoleModel ?? getSelectedModel(store, configId),
      );
    },
    getModelOptions(_store, configId) {
      return [...(deps.getGrokConfigModels(configId)?.models ?? [])];
    },
    getManagedModelOptions() {
      return [];
    },
    selectModel(store, model, configId) {
      const resolved = resolveGrokConfigModel(deps.getGrokConfigModels(configId), model);
      const storeKey = resolveStoreConfigKey(configId);
      return {
        ...store,
        selectedByConfigId: {
          ...store.selectedByConfigId,
          [storeKey]: resolved ?? "",
        },
      };
    },
    selectLoopModel(store, role, model, configId) {
      const resolved = resolveGrokConfigModel(deps.getGrokConfigModels(configId), model);
      const storeKey = resolveStoreConfigKey(configId);
      const selection = { ...store.selectedLoopByConfigId[storeKey] };
      if (resolved) {
        selection[role] = resolved;
      } else {
        delete selection[role];
      }
      return {
        ...store,
        selectedLoopByConfigId: {
          ...store.selectedLoopByConfigId,
          [storeKey]: selection,
        },
      };
    },
    resolveStoreConfigKey,
    getModelDisplayName(model, configId) {
      if (model) {
        return deps.getGrokConfigModels(configId)?.labels[model] ?? model;
      }
      return model;
    },
  };
}

export function createCliModelSelectionStrategies(
  deps: CliModelSelectionStrategyDeps,
): Record<CliName, CliModelSelectionStrategy> {
  return {
    codex: createStoreBackedCliModelSelectionStrategy("codex"),
    claude: createStoreBackedCliModelSelectionStrategy("claude"),
    opencode: createStoreBackedCliModelSelectionStrategy("opencode"),
    grok: createGrokCliModelSelectionStrategy(deps),
  };
}
