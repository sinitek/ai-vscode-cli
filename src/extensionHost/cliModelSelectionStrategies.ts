import { resolveDshConfigModel, type DshConfigModels } from "../cli/dshConfigModels";
import { resolveGrokConfigModel, type GrokConfigModels } from "../cli/grokConfigModels";
import { resolveKimiCodeConfigModel, type KimiCodeConfigModels } from "../config/kimiCodeConfig";
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
  getDshConfigModels?: (configId: string | null | undefined) => DshConfigModels | undefined;
  resolveDefaultDshStoreKey?: () => string;
  getKimiCodeConfigModels?: (configId: string | null | undefined) => KimiCodeConfigModels | undefined;
  resolveDefaultKimiCodeStoreKey?: () => string;
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

type StoreBackedCliName = Exclude<CliName, "grok" | "dsh" | "kimi-code">;

const UNCONFIGURED_DSH_STORE_KEY = "dsh:unconfigured";
const UNCONFIGURED_KIMI_CODE_STORE_KEY = "kimi-code:unconfigured";

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
    getManagedModelOptions(_store, configId) {
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

function createDshCliModelSelectionStrategy(deps: CliModelSelectionStrategyDeps): CliModelSelectionStrategy {
  function resolveStoreConfigKey(configId: string | null | undefined): string {
    return configId ?? deps.resolveDefaultDshStoreKey?.() ?? UNCONFIGURED_DSH_STORE_KEY;
  }

  function configuredModels(configId: string | null | undefined): DshConfigModels | undefined {
    return deps.getDshConfigModels?.(configId);
  }

  function getSelectedModel(store: CliModelStore, configId: string | null): string | null {
    const storedModel = store.selectedByConfigId?.[resolveStoreConfigKey(configId)];
    const selectedModel = typeof storedModel === "string" ? storedModel : null;
    return resolveDshConfigModel(configuredModels(configId), selectedModel);
  }

  return {
    getSelectedModel,
    getSelectedLoopModel(store, role, configId) {
      const storedRoleModel = store.selectedLoopByConfigId?.[resolveStoreConfigKey(configId)]?.[role];
      return resolveDshConfigModel(
        configuredModels(configId),
        storedRoleModel ?? getSelectedModel(store, configId),
      );
    },
    getModelOptions(_store, configId) {
      return [...(configuredModels(configId)?.models ?? [])];
    },
    getManagedModelOptions(_store, configId) {
      return [...(configuredModels(configId)?.models ?? [])];
    },
    selectModel(store, model, configId) {
      const resolved = resolveDshConfigModel(configuredModels(configId), model);
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
      const resolved = resolveDshConfigModel(configuredModels(configId), model);
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
      if (!model) {
        return model;
      }
      const config = configuredModels(configId);
      if (!config || config.error || !config.models.includes(model)) {
        return null;
      }
      return config.labels[model] ?? model;
    },
  };
}

function createKimiCodeCliModelSelectionStrategy(deps: CliModelSelectionStrategyDeps): CliModelSelectionStrategy {
  function resolveStoreConfigKey(configId: string | null | undefined): string {
    return configId ?? deps.resolveDefaultKimiCodeStoreKey?.() ?? UNCONFIGURED_KIMI_CODE_STORE_KEY;
  }

  function configuredModels(configId: string | null | undefined): KimiCodeConfigModels | undefined {
    return deps.getKimiCodeConfigModels?.(configId);
  }

  function getSelectedModel(store: CliModelStore, configId: string | null): string | null {
    const storedModel = store.selectedByConfigId?.[resolveStoreConfigKey(configId)];
    const selectedModel = typeof storedModel === "string" ? storedModel : null;
    return resolveKimiCodeConfigModel(configuredModels(configId), selectedModel);
  }

  return {
    getSelectedModel,
    getSelectedLoopModel(store, role, configId) {
      const storedRoleModel = store.selectedLoopByConfigId?.[resolveStoreConfigKey(configId)]?.[role];
      return resolveKimiCodeConfigModel(
        configuredModels(configId),
        storedRoleModel ?? getSelectedModel(store, configId),
      );
    },
    getModelOptions(_store, configId) {
      return [...(configuredModels(configId)?.models ?? [])];
    },
    getManagedModelOptions(_store, configId) {
      return [...(configuredModels(configId)?.models ?? [])];
    },
    selectModel(store, model, configId) {
      const resolved = resolveKimiCodeConfigModel(configuredModels(configId), model);
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
      const resolved = resolveKimiCodeConfigModel(configuredModels(configId), model);
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
      if (!model) {
        return model;
      }
      const config = configuredModels(configId);
      return config?.labels[model] ?? model;
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
    dsh: createDshCliModelSelectionStrategy(deps),
    "kimi-code": createKimiCodeCliModelSelectionStrategy(deps),
  };
}
