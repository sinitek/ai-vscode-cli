import type { CliName } from "./cli/types";
import {
  ensureCliModelStore,
  mergeUniqueModelNames,
  normalizeCliModelName,
  type CliModelStore,
} from "./modelSelectionStore";
import type { PanelState } from "./webview/types";

export type ConfigHeartbeatSnapshot = {
  cli: CliName;
  activeConfigId: string | null;
  configIds: string[];
  modelSelected: string | null;
  managedModelOptions: string[];
  openCodeMainModelSelected: string | null;
  openCodeSubtaskModelSelected: string | null;
  /** @deprecated Compatibility alias for the OpenCode main role. */
  openCodePrimaryModelSelected?: string | null;
  /** @deprecated Compatibility alias for the OpenCode subtask role. */
  openCodeSmallModelSelected?: string | null;
};

export type ConfigHeartbeatSnapshotDeps = {
  resolveModelConfigIdForCli: (cli: CliName, configState?: PanelState["configState"]) => string | null;
};

export function buildConfigHeartbeatSnapshot(
  cli: CliName,
  configState: PanelState["configState"],
  store: CliModelStore,
  deps: ConfigHeartbeatSnapshotDeps,
): ConfigHeartbeatSnapshot {
  const modelConfigId = deps.resolveModelConfigIdForCli(cli, configState);
  const normalizedStore = ensureCliModelStore(store);
  const modelSelected = modelConfigId
    ? normalizeCliModelName(normalizedStore.selectedByConfigId[modelConfigId])
    : null;
  const managedModelOptions = modelConfigId
    ? mergeUniqueModelNames(normalizedStore.optionsByConfigId[modelConfigId] ?? [])
    : [];
  const openCodeRoleSelection = cli === "opencode" && modelConfigId
    ? (normalizedStore.openCodeRoleModelsByConfigId[modelConfigId] ?? {})
    : {};
  const openCodeMainModelSelected = normalizeCliModelName(openCodeRoleSelection.main);
  const openCodeSubtaskModelSelected = normalizeCliModelName(openCodeRoleSelection.subtask);
  return {
    cli,
    activeConfigId: configState.activeConfigId,
    configIds: configState.configs.map((config) => config.id),
    modelSelected,
    managedModelOptions,
    openCodeMainModelSelected,
    openCodeSubtaskModelSelected,
    openCodePrimaryModelSelected: openCodeMainModelSelected,
    openCodeSmallModelSelected: openCodeSubtaskModelSelected,
  };
}

export function shouldRefreshConfigHeartbeat(
  previous: ConfigHeartbeatSnapshot | null,
  next: ConfigHeartbeatSnapshot,
): boolean {
  if (!previous || previous.cli !== next.cli) {
    return true;
  }
  if (previous.activeConfigId !== next.activeConfigId) {
    return true;
  }
  if (!areStringListsEqual(previous.configIds, next.configIds)) {
    return true;
  }
  if (previous.modelSelected !== next.modelSelected) {
    return true;
  }
  if (!areStringListsEqual(previous.managedModelOptions, next.managedModelOptions)) {
    return true;
  }
  if (previous.openCodeMainModelSelected !== next.openCodeMainModelSelected) {
    return true;
  }
  return previous.openCodeSubtaskModelSelected !== next.openCodeSubtaskModelSelected;
}

function areStringListsEqual(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}
