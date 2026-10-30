import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createHash } from "crypto";
import { getCliArgs, getCliCommand, getThinkingMode } from "../cli/config";
import { inspectCodeGraphStatus } from "../cli/codegraphStatus";
import { getCodeGraphInstallCommand, getCodeGraphInstallSteps, type CodeGraphInstallStep } from "../cli/installer";
import { resolveOpenCodeModelForConfig, supportsCliManagedModelSelection } from "../cli/modelArgs";
import { CLI_LIST, DEFAULT_LOOP_EXECUTION_MODE, LOOP_PLUS_INTERACTIVE_MODE, normalizeLoopExecutionMode, type CliName, type InteractiveMode, type LoopExecutionMode, type OpenCodeThinkingMessageKey, type OpenCodeThinkingState, type ThinkingMode } from "../cli/types";
import { normalizeOpenCodeModelRole, parseOpenCodeConfigModels, toOpenCodeConfigFieldRole, validateOpenCodeModelOverride, type OpenCodeCanonicalModelRole, type OpenCodeModelRoleInput, type ParsedOpenCodeConfigModels } from "../cli/opencodeconfigmodels";
import { type OpenCodeThinkingCapability } from "../cli/openCodeModelCapabilities";
import { isOpenCodeThinkingEffort, normalizeOpenCodeThinkingEffort, OPENCODE_THINKING_EFFORTS } from "../cli/openCodeThinkingEffort";
import * as configService from "../config/configService";
import { parseDshConfigModels, readDshModelWireForRun, resolveDshConfigModel, type DshConfigModels, type DshReasoningOption } from "../cli/dshConfigModels";
import { parseGrokConfigModels, resolveGrokConfigModel, type GrokConfigModels } from "../cli/grokConfigModels";
import { changeKimiCodeConfigModelList, parseKimiCodeConfigModels, resolveKimiCodeConfigModel, type KimiCodeConfigModels, type KimiCodeModelListChange } from "../config/kimiCodeConfig";
import { readZcodeConfigModels, resolveZcodeModelWireForRun as resolveConfiguredZcodeModelWireForRun, type ZcodeConfigModels } from "../config/zcodeConfig";
import { LOOP_MAIN_AI_FAILURE_LIMIT } from "../loopMainFailure";
import { resolveLoopPlusDecisionSubtaskMax, resolveLoopPlusMaxAcceptances } from "../loopPlusDecision";
import { getEffectiveLoopSubtaskMaxThinkingMode } from "../loopSubtaskThinking";
import { getLongTermMemoryRuntimeDisableReason, isLongTermMemoryRuntimeEnabled, type MemoryRuntimeGateSettings } from "../memory/runtimeGate";
import { resolveWorkspaceMemoryPaths } from "../memory/memoryPaths";
import { ensureWorkspaceHarnessScaffold } from "../workspaceScaffold";
import { createCliModelSelectionStrategies } from "./cliModelSelectionStrategies";
import { buildModelState as buildModelSelectionState, countStoreModels, deleteCliModelFromStore, ensureCliModelStore as ensureCliModelSelectionStore, getEffectiveCliArgs as getEffectiveCliArgsFromStore, getOpenCodeRoleModelFromStore, getOpenCodeRoleVariantFromStore, getSelectedLoopSubtaskCliFromStore, getSelectedLoopThinkingModeFromStore, loadModelStore as loadModelSelectionStore, moveCliModelInStore, normalizeCliModelName, readModelStore as readModelSelectionStore, renameCliModelInStore, selectCliModelInStore, selectLoopSubtaskCliInStore, setOpenCodeRoleModelInStore, setOpenCodeRoleVariantInStore, setOpenCodeVariantInStore, setSelectedLoopThinkingModeInStore, writeModelStore as writeModelSelectionStore, type CliModelStore, type ModelSelectionStoreState } from "../modelSelectionStore";
import { isInteractiveMode, isThinkingMode, isLoopTaskBlockedByMainAiFailureLimit as isLoopTaskBlockedByMainAiFailureLimitWithLimit, normalizeVisibleInteractiveMode, resolveLoopTaskSessionId as resolveLoopTaskSessionIdWithDeps, resolvePromptRunTargetSessionId as resolvePromptRunTargetSessionIdWithDeps } from "../promptRunState";
import { buildPromptHistoryState as buildPromptHistoryStateFromStore, clearPromptHistoryStore, cleanupPromptHistoryRetentionAcrossWorkspaces as cleanupPromptHistoryStoreRetentionAcrossWorkspaces, collectWorkspaceKeysForPromptHistoryCleanup as collectWorkspaceKeysForPromptHistoryStoreCleanup, deletePromptHistoryFile as deletePromptHistoryStoreFile, ensurePromptHistoryStore as ensurePromptHistoryStoreState, getPromptHistoryFilePath as getPromptHistoryStoreFilePath, loadPromptHistoryStore as loadPromptHistoryStoreFromStore, readPromptHistoryFile as readPromptHistoryStoreFile, recordPromptHistoryInStore, setPromptHistoryFavoriteInStore, writePromptHistoryFile as writePromptHistoryStoreFile, type PromptHistoryStore } from "../promptHistoryStore";
import { readToolSettings, resolveGlobalAutoCompactContextAfterRun, resolveGlobalHumanInteractionEnabled } from "../toolSettings";
import { t } from "../i18n";
import { logInfo } from "../logger";
import { isTimestampWithinHistoryRetention } from "../historyRetention";
import { loadWorkspaceSettings as loadWorkspaceSettingsFromStore, saveWorkspaceSettings as saveWorkspaceSettingsToStore, trySaveWorkspaceSettings as trySaveWorkspaceSettingsToStore, type ConversationTabRecordForWorkspaceSettings, type SaveWorkspaceSettingsResult, type WorkspaceSettings } from "../workspaceSettingsStore";
import type { PanelState, PromptHistoryItem } from "../webview/types";
import type { ConfigHeartbeatSnapshot } from "../webviewCommandCoordinator";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import type { LoopTaskRecord } from "../loopTaskStore";
import { getConversationTabSessionIdForCli, type ConversationTabRecord } from "../sessionTabs";
import { isCliName } from "../panelStateBuilder";
import { resolveDshActivePatchPath, resolveGrokConfigPath, resolveKimiCodeConfigPath } from "../shared/userHomePaths";

export type ModelSettingsHostDeps = {
  getCurrentCli: () => CliName; setCurrentCli: (cli: CliName) => void;
  getModelStore: () => CliModelStore; setModelStore: (store: CliModelStore) => void;
  getWorkspaceSettings: () => WorkspaceSettings; setWorkspaceSettings: (settings: WorkspaceSettings) => void;
  getPromptHistoryStore: () => PromptHistoryStore; setPromptHistoryStore: (store: PromptHistoryStore) => void;
  getModelSelectionStoreState: () => ModelSelectionStoreState;
  getActiveWorkspaceKey: () => string;
  getConfigHeartbeatSnapshot: () => ConfigHeartbeatSnapshot | null;
  getOpenCodeThinkingState: () => OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant">; setOpenCodeThinkingState: (state: OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant">) => void;
  getOpenCodeSmallThinkingState: () => OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant">; setOpenCodeSmallThinkingState: (state: OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant">) => void;
  getOpenCodeModelsState: () => PanelState["openCodeModels"]; setOpenCodeModelsState: (state: PanelState["openCodeModels"]) => void;
  getOpenCodeThinkingContextKey: () => string; setOpenCodeThinkingContextKey: (value: string) => void;
  getOpenCodeThinkingConfigId: () => string | null; setOpenCodeThinkingConfigId: (value: string | null) => void;
  getOpenCodeThinkingExactModels: () => Record<OpenCodeCanonicalModelRole, string | null>; setOpenCodeThinkingExactModels: (value: Record<OpenCodeCanonicalModelRole, string | null>) => void;
  getOpenCodeThinkingRequestId: () => number; setOpenCodeThinkingRequestId: (value: number) => void;
  getWorkspacePreferredConfigIdForCli: (cli: CliName) => string | null;
  resolveModelConfigIdForCli: (cli: CliName, configState: PanelState["configState"]) => string | null;
  postPanelState: () => Promise<void>;
  resolveWorkspaceCwd: () => string | undefined;
  getExtensionUri: () => vscode.Uri;
  updateStatusBar: () => void;
  getActiveConversationTab: () => { id: string; cli: CliName } | null;
  getActiveConversationTabId: () => string | null;
  getConversationTabById: (tabId: string) => ConversationTabRecord | null;
  isTabRunActive: (tabId: string | null) => boolean;
  preloadUserMessageForPrompt: (input: PromptRunInput, target: PromptRunTarget) => PromptRunInput;
  resolvePromptRunTarget: (tabId: string | null) => PromptRunTarget | null;
  runPrompt: (input: PromptRunInput, options?: { targetTabId?: string | null }) => Promise<void>;
  sanitizeConversationTabRecord: (value: unknown) => ConversationTabRecordForWorkspaceSettings | null;
  logError: (event: string, payload?: unknown) => Promise<void> | void;
};

export function createModelSettingsHost(deps: ModelSettingsHostDeps) {
const DATA_DIR = path.join(os.homedir(), ".sinitek_cli");
const WORKSPACE_SETTINGS_DIR = path.join(DATA_DIR, "workspace-settings");
const PROMPT_HISTORY_DIR = path.join(DATA_DIR, "prompt-history");
const MODEL_STORE_FILE = path.join(DATA_DIR, "models.json");
const LEGACY_PROMPT_HISTORY_FILE = path.join(DATA_DIR, "prompt-history.json");
const DEFAULT_MODEL_STORE_KEY = "__default__";
const WORKSPACE_KEY_FALLBACK = "no-workspace";
const PROMPT_HISTORY_LIMIT = 200;
const LOOP_DEFAULT_MAX_ROUNDS = 20;
const LOOP_MIN_MAX_ROUNDS = 1;
const LOOP_MAX_MAX_ROUNDS = 100;
const CODEGRAPH_INSTALL_TERMINAL_NAME = "CodeGraph Install";
const CODEGRAPH_INSTALL_POLL_MS = 2000;
const CODEGRAPH_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const ARCHITECTURE_INITIALIZATION_DISPLAY_PROMPT = "初始化当前工作区 ARCHITECTURE.md";
let codeGraphInstalling = false;
let codeGraphInstallPollTimer: ReturnType<typeof setInterval> | null = null;
let codeGraphInstallPollStartedAt = 0;
const grokModelsByConfigId = new Map<string | null, GrokConfigModels>();
const dshModelsByConfigId = new Map<string | null, DshConfigModels>();
const kimiCodeModelsByConfigId = new Map<string | null, KimiCodeConfigModels>();
const zcodeModelsByConfigId = new Map<string | null, ZcodeConfigModels>();
let loadedConfigStates: {
  workspaceKey: string;
  states: NonNullable<PanelState["configStateByCli"]>;
  preferredIds: Partial<Record<CliName, string | null>>;
} | null = null;
const cliModelSelectionStrategies = createCliModelSelectionStrategies({
  getGrokConfigModels(configId) {
    if (configId === undefined) {
      return undefined;
    }
    return grokModelsByConfigId.get(configId);
  },
  resolveDefaultGrokStoreKey() {
    return `grok:${resolveGrokConfigPath()}`;
  },
  getDshConfigModels(configId) {
    if (configId === undefined) {
      return undefined;
    }
    return dshModelsByConfigId.get(configId);
  },
  resolveDefaultDshStoreKey() {
    return `dsh:${resolveDshActivePatchPath()}`;
  },
  getKimiCodeConfigModels(configId) {
    if (configId === undefined) {
      return undefined;
    }
    return kimiCodeModelsByConfigId.get(configId);
  },
  resolveDefaultKimiCodeStoreKey() {
    return `kimi-code:${resolveKimiCodeConfigPath()}`;
  },
  getZcodeConfigModels(configId) {
    if (configId === undefined) {
      return undefined;
    }
    return zcodeModelsByConfigId.get(configId);
  },
  resolveDefaultZcodeStoreKey() {
    return "zcode:provider_config.json";
  },
});
let currentCli = deps.getCurrentCli();
let modelStore = deps.getModelStore();
let workspaceSettings = deps.getWorkspaceSettings();
let promptHistoryStore = deps.getPromptHistoryStore();
let openCodeThinkingState = deps.getOpenCodeThinkingState();
let openCodeSmallThinkingState = deps.getOpenCodeSmallThinkingState();
let openCodeModelsState = deps.getOpenCodeModelsState();
let openCodeThinkingContextKey = deps.getOpenCodeThinkingContextKey();
let openCodeThinkingConfigId = deps.getOpenCodeThinkingConfigId();
let openCodeThinkingExactModels = deps.getOpenCodeThinkingExactModels();
let openCodeThinkingRequestId = deps.getOpenCodeThinkingRequestId();
let activeWorkspaceKey = deps.getActiveWorkspaceKey();
const postPanelState = deps.postPanelState;
const resolveWorkspaceCwd = deps.resolveWorkspaceCwd;
const getConversationTabById = deps.getConversationTabById;
const updateStatusBar = deps.updateStatusBar;
const getActiveConversationTab = deps.getActiveConversationTab;
const getActiveConversationTabId = deps.getActiveConversationTabId;
const isTabRunActive = deps.isTabRunActive;
const preloadUserMessageForPrompt = deps.preloadUserMessageForPrompt;
const resolvePromptRunTarget = deps.resolvePromptRunTarget;
const runPrompt = deps.runPrompt;
const sanitizeConversationTabRecord = deps.sanitizeConversationTabRecord;
const logError = deps.logError;
function syncFromDeps(): void { currentCli = deps.getCurrentCli(); modelStore = deps.getModelStore(); workspaceSettings = deps.getWorkspaceSettings(); promptHistoryStore = deps.getPromptHistoryStore(); openCodeThinkingState = deps.getOpenCodeThinkingState(); openCodeSmallThinkingState = deps.getOpenCodeSmallThinkingState(); openCodeModelsState = deps.getOpenCodeModelsState(); openCodeThinkingContextKey = deps.getOpenCodeThinkingContextKey(); openCodeThinkingConfigId = deps.getOpenCodeThinkingConfigId(); openCodeThinkingExactModels = deps.getOpenCodeThinkingExactModels(); openCodeThinkingRequestId = deps.getOpenCodeThinkingRequestId(); activeWorkspaceKey = deps.getActiveWorkspaceKey(); }
function syncToDeps(): void { deps.setCurrentCli(currentCli); deps.setModelStore(modelStore); deps.setWorkspaceSettings(workspaceSettings); deps.setPromptHistoryStore(promptHistoryStore); deps.setOpenCodeThinkingState(openCodeThinkingState); deps.setOpenCodeSmallThinkingState(openCodeSmallThinkingState); deps.setOpenCodeModelsState(openCodeModelsState); deps.setOpenCodeThinkingContextKey(openCodeThinkingContextKey); deps.setOpenCodeThinkingConfigId(openCodeThinkingConfigId); deps.setOpenCodeThinkingExactModels(openCodeThinkingExactModels); deps.setOpenCodeThinkingRequestId(openCodeThinkingRequestId); }
function wrap<T extends (...args: any[]) => any>(fn: T): T { return ((...args: Parameters<T>) => { syncFromDeps(); const result = fn(...args); if (result && typeof (result as Promise<unknown>).then === "function") { return (result as Promise<unknown>).finally(syncToDeps) as ReturnType<T>; } syncToDeps(); return result; }) as T; }

function buildDefaultOpenCodeThinkingState(
  messageKey: OpenCodeThinkingMessageKey = "follow-default",
  exactModel: string | null = null
): OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant"> {
  const separatorIndex = exactModel?.indexOf("/") ?? -1;
  return {
    providerId: separatorIndex > 0 ? exactModel!.slice(0, separatorIndex) : null,
    modelId: separatorIndex > 0 ? exactModel!.slice(separatorIndex + 1) : null,
    reasoning: "unknown",
    options: [],
    configuredDefaultVariant: null,
    selectedVariant: null,
    status: "unknown",
    source: "fallback",
    disabled: true,
    messageKey,
  };
}

function getOpenCodeThinkingStateForRole(
  role: OpenCodeModelRoleInput
): OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant"> {
  return normalizeOpenCodeModelRole(role) === "subtask" ? openCodeSmallThinkingState : openCodeThinkingState;
}

function setOpenCodeThinkingStateForRole(
  role: OpenCodeModelRoleInput,
  state: OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant">
): void {
  if (normalizeOpenCodeModelRole(role) === "subtask") {
    openCodeSmallThinkingState = state;
    return;
  }
  openCodeThinkingState = state;
}

function persistOpenCodeVariant(
  configId: string | null,
  exactModel: string | null,
  role: OpenCodeModelRoleInput,
  variant: string | null
): void {
  const normalizedRole = normalizeOpenCodeModelRole(role);
  let nextStore = setOpenCodeRoleVariantInStore(modelStore, configId, exactModel, normalizedRole, variant);
  if (normalizedRole === "main") {
    nextStore = setOpenCodeVariantInStore(nextStore, configId, exactModel, variant);
  }
  if (nextStore === modelStore) {
    return;
  }
  modelStore = nextStore;
  writeModelStore(modelStore);
}

function updateOpenCodeVariantForCurrentSelection(role: OpenCodeModelRoleInput, value: string | null): void {
  const normalizedRole = normalizeOpenCodeModelRole(role);
  if (currentCli !== "opencode" || !openCodeThinkingConfigId) {
    return;
  }
  const exactModel = openCodeThinkingExactModels[normalizedRole];
  if (!exactModel) {
    return;
  }
  const currentState = getOpenCodeThinkingStateForRole(normalizedRole);
  const trimmedValue = typeof value === "string" ? value.trim() : "";
  const nextVariant = isOpenCodeThinkingEffort(trimmedValue) ? trimmedValue : null;
  persistOpenCodeVariant(openCodeThinkingConfigId, exactModel, normalizedRole, nextVariant);
  setOpenCodeThinkingStateForRole(normalizedRole, {
    ...currentState,
    selectedVariant: nextVariant,
  });
}

function updateOpenCodeVariantForConfig(
  role: OpenCodeModelRoleInput,
  value: string | null,
  configId: string | null,
  model: string | null,
): void {
  const normalizedRole = normalizeOpenCodeModelRole(role);
  const exactModel = normalizeCliModelName(model);
  if (!configId || !exactModel) {
    return;
  }
  const trimmedValue = typeof value === "string" ? value.trim() : "";
  const nextVariant = isOpenCodeThinkingEffort(trimmedValue) ? trimmedValue : null;
  persistOpenCodeVariant(configId, exactModel, normalizedRole, nextVariant);
}

type ResolvedOpenCodeRoleModels = {
  main: string | null;
  subtask: string | null;
  fallback: Partial<Record<OpenCodeCanonicalModelRole, string>>;
};

function shouldClearOpenCodeRoleOverrideMirroringOppositeDefault(
  parsed: ParsedOpenCodeConfigModels,
  role: OpenCodeCanonicalModelRole,
  override: string
): boolean {
  const mainRef = normalizeCliModelName(parsed.mainModelRef);
  const subtaskRef = normalizeCliModelName(parsed.subtaskModelRef);
  if (!mainRef || !subtaskRef || mainRef === subtaskRef) {
    return false;
  }
  return role === "main"
    ? override === subtaskRef
    : override === mainRef;
}

function resolveOpenCodeRoleModelsForConfig(
  configId: string | null,
  configContent: string
): ResolvedOpenCodeRoleModels {
  const parsed = parseOpenCodeConfigModels(configContent);
  const issues = [...parsed.issues];
  let nextStore = modelStore;

  if (configId) {
    const legacyMain = normalizeCliModelName(modelStore.selectedByConfigId?.[configId]);
    const legacyLoopMain = normalizeCliModelName(modelStore.selectedLoopByConfigId?.[configId]?.main);
    const legacyLoopSubtask = normalizeCliModelName(modelStore.selectedLoopByConfigId?.[configId]?.subtask);
    const storedMain = getOpenCodeRoleModelFromStore(modelStore, configId, "main");
    const storedSubtask = getOpenCodeRoleModelFromStore(modelStore, configId, "subtask");
    if (!storedMain) {
      const legacyCandidate = legacyLoopMain ?? legacyMain;
      if (legacyCandidate) {
        const legacyValidation = validateOpenCodeModelOverride(parsed, "main", legacyCandidate);
        if (legacyValidation.ok && legacyValidation.modelRef) {
          nextStore = setOpenCodeRoleModelInStore(nextStore, configId, "main", legacyValidation.modelRef);
        }
      }
    }
    if (!storedSubtask && legacyLoopSubtask) {
      const legacyValidation = validateOpenCodeModelOverride(parsed, "subtask", legacyLoopSubtask);
      if (legacyValidation.ok && legacyValidation.modelRef) {
        nextStore = setOpenCodeRoleModelInStore(nextStore, configId, "subtask", legacyValidation.modelRef);
      }
    }
    if (
      modelStore.selectedByConfigId?.[configId]
      || modelStore.optionsByConfigId?.[configId]
      || modelStore.selectedLoopByConfigId?.[configId]
      || modelStore.loopRolesByConfigId?.[configId]
    ) {
      nextStore = ensureCliModelSelectionStore(nextStore);
      delete nextStore.selectedByConfigId[configId];
      delete nextStore.optionsByConfigId[configId];
      delete nextStore.selectedLoopByConfigId[configId];
      delete nextStore.loopRolesByConfigId[configId];
    }
  }

  const resolveRole = (role: OpenCodeCanonicalModelRole): string | null => {
    const override = getOpenCodeRoleModelFromStore(nextStore, configId, role);
    if (override) {
      if (shouldClearOpenCodeRoleOverrideMirroringOppositeDefault(parsed, role, override)) {
        nextStore = setOpenCodeRoleModelInStore(nextStore, configId, role, null);
        return role === "main"
          ? parsed.mainModel?.ref ?? null
          : parsed.subtaskModel?.ref ?? null;
      }
      const validation = validateOpenCodeModelOverride(parsed, role, override);
      if (validation.ok && validation.modelRef) {
        return validation.modelRef;
      }
      if (validation.issue) {
        issues.push(validation.issue);
      }
      nextStore = setOpenCodeRoleModelInStore(nextStore, configId, role, null);
    }
    return role === "main"
      ? parsed.mainModel?.ref ?? null
      : parsed.subtaskModel?.ref ?? null;
  };

  const main = resolveRole("main");
  const configuredSubtask = resolveRole("subtask");
  const fallback: Partial<Record<OpenCodeCanonicalModelRole, string>> = {};
  const subtask = configuredSubtask ?? main;
  if (!configuredSubtask && main) {
    fallback.subtask = "subtask model missing; using main model";
  }
  if (nextStore !== modelStore) {
    modelStore = nextStore;
    writeModelStore(modelStore);
  }
  openCodeModelsState = {
    models: parsed.candidates.map((candidate) => ({
      ref: candidate.ref,
      label: candidate.label,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
    })),
    configPrimaryRef: parsed.mainModelRef,
    configSmallRef: parsed.subtaskModelRef,
    selectedPrimaryRef: main,
    selectedSmallRef: subtask,
    issues: issues.map((issue) => ({
      ...(issue.role ? { role: toOpenCodeConfigFieldRole(issue.role) } : {}),
      code: issue.code,
      messageKey: `opencodeModels.issue.${issue.code}`,
    })),
  };
  return { main, subtask, fallback };
}

const OPENCODE_STANDARD_THINKING_OPTIONS = OPENCODE_THINKING_EFFORTS.map((value) => ({
  value,
  label: value,
  source: "resolved-cli" as const,
}));

function buildStandardOpenCodeThinkingState(
  exactModel: string | null,
  selectedVariant: string | null,
): OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant"> {
  const separatorIndex = exactModel?.indexOf("/") ?? -1;
  const normalizedSelection = isOpenCodeThinkingEffort(selectedVariant) ? selectedVariant.trim() : null;
  return {
    providerId: separatorIndex > 0 ? exactModel!.slice(0, separatorIndex) : null,
    modelId: separatorIndex > 0 ? exactModel!.slice(separatorIndex + 1) : null,
    reasoning: "unknown",
    options: exactModel ? [...OPENCODE_STANDARD_THINKING_OPTIONS] : [],
    configuredDefaultVariant: null,
    selectedVariant: normalizedSelection,
    status: exactModel ? "ready" : "unknown",
    source: "fallback",
    disabled: !exactModel,
    messageKey: exactModel ? undefined : "select-model",
  };
}

async function refreshOpenCodeThinkingState(configState: PanelState["configState"]): Promise<void> {
  if (currentCli !== "opencode") {
    openCodeThinkingRequestId += 1;
    openCodeThinkingContextKey = `inactive:${currentCli}`;
    openCodeThinkingConfigId = null;
    openCodeThinkingExactModels = { main: null, subtask: null };
    openCodeThinkingState = buildDefaultOpenCodeThinkingState();
    openCodeSmallThinkingState = buildDefaultOpenCodeThinkingState();
    openCodeModelsState = undefined;
    return;
  }

  const configId = deps.resolveModelConfigIdForCli("opencode", configState);
  const activeConfig = configId
    ? await configService.getConfigById("opencode", configId)
    : await configService.getCurrentConfig("opencode");
  const configContent = activeConfig?.content ?? "{}";
  const roleModels = resolveOpenCodeRoleModelsForConfig(configId, configContent);
  const command = getCliCommand("opencode");
  const configHash = createHash("sha256").update(configContent).digest("hex");
  const contextKey = [
    command,
    configId ?? "current",
    configHash,
    roleModels.main ?? "",
    roleModels.subtask ?? "",
  ].join("\u0000");
  if (contextKey === openCodeThinkingContextKey) {
    return;
  }

  openCodeThinkingContextKey = contextKey;
  openCodeThinkingConfigId = configId;
  openCodeThinkingExactModels = {
    main: roleModels.main,
    subtask: roleModels.subtask,
  };
  openCodeThinkingRequestId += 1;
  const refreshRoleThinking = (role: OpenCodeCanonicalModelRole, exactModel: string | null): void => {
    const persistedVariant = exactModel
      ? getOpenCodeRoleVariantFromStore(modelStore, configId, exactModel, role)
      : null;
    const selectedVariant = isOpenCodeThinkingEffort(persistedVariant) ? persistedVariant.trim() : null;
    if (exactModel && persistedVariant && !selectedVariant) {
      persistOpenCodeVariant(configId, exactModel, role, null);
    }
    setOpenCodeThinkingStateForRole(role, buildStandardOpenCodeThinkingState(exactModel, selectedVariant));
  };
  refreshRoleThinking("main", roleModels.main);
  refreshRoleThinking("subtask", roleModels.subtask);
  syncToDeps();
  void postPanelState();
}

function getOpenCodeVariantForRun(
  cli: CliName,
  model: string | null | undefined,
  configId: string | null,
  configContent: string | null | undefined,
  role: OpenCodeModelRoleInput = "main"
): string | null {
  const normalizedRole = normalizeOpenCodeModelRole(role);
  if (cli !== "opencode") {
    return null;
  }
  const resolution = resolveOpenCodeModelForConfig(model, configContent);
  const exactModel = resolution.error ? null : resolution.model;
  if (!exactModel) {
    return null;
  }
  const storedVariant = configId
    ? getOpenCodeRoleVariantFromStore(modelStore, configId, exactModel, normalizedRole)
    : null;
  return normalizeOpenCodeThinkingEffort(storedVariant);
}

function resolvePromptRunTargetSessionId(target: PromptRunTarget): string | null {
  return resolvePromptRunTargetSessionIdWithDeps(target, (candidate) => {
    const tab = getConversationTabById(candidate.tabId);
    return tab ? getConversationTabSessionIdForCli(tab, candidate.cli) : null;
  });
}

function resolveLoopTaskSessionId(target: PromptRunTarget): string | null {
  return resolveLoopTaskSessionIdWithDeps(target, (candidate) => {
    const tab = getConversationTabById(candidate.tabId);
    return tab ? getConversationTabSessionIdForCli(tab, candidate.cli) : null;
  });
}

function isLoopTaskBlockedByMainAiFailureLimit(task: Pick<LoopTaskRecord, "mainAiFailureCount" | "mainAiFailureLimitReached">): boolean {
  return isLoopTaskBlockedByMainAiFailureLimitWithLimit(task, LOOP_MAIN_AI_FAILURE_LIMIT);
}

function normalizeThinkingModeForCli(cli: CliName, mode: ThinkingMode): ThinkingMode {
  if (cli === "dsh" && (mode === "off" || mode === "medium")) {
    return "high";
  }
  if (cli === "grok" || cli === "dsh" || cli === "zcode") {
    return mode;
  }
  if (cli === "kimi-code") {
    // kimi-code 支持 max，且不使用 codex 风格的 off→low 归一。
    // 非超集取值不在此处改写：真实可用档位由 ACP 会话公布，运行期只应用公布值。
    return mode;
  }
  if (cli !== "codex" && cli !== "claude" && mode === "max") {
    return "high";
  }
  if (cli !== "codex" && cli !== "claude" && mode === "xhigh") {
    return "high";
  }
  if (cli === "codex" && mode === "off") {
    return "low";
  }
  return mode;
}

function getWorkspaceThinkingMode(cli: CliName): ThinkingMode {
  if (workspaceSettings.thinkingMode && isThinkingMode(workspaceSettings.thinkingMode)) {
    return normalizeThinkingModeForCli(cli, workspaceSettings.thinkingMode);
  }
  return getThinkingMode(cli);
}

function getCliModelThinkingKey(model: string | null): string {
  return normalizeCliModelName(model) ?? DEFAULT_MODEL_STORE_KEY;
}

function getStoredCliModelThinkingMode(cli: CliName, model: string | null): ThinkingMode | null {
  const cliThinking = modelStore?.thinkingByCliAndModel?.[cli];
  if (!cliThinking || typeof cliThinking !== "object") {
    return null;
  }
  const stored = cliThinking[getCliModelThinkingKey(model)];
  if (!isThinkingMode(stored)) {
    return null;
  }
  return normalizeThinkingModeForCli(cli, stored);
}

function setCliModelThinkingMode(cli: CliName, model: string | null, thinkingMode: ThinkingMode): void {
  const normalizedThinkingMode = normalizeThinkingModeForCli(cli, thinkingMode);
  const nextStore = ensureCliModelStore(modelStore);
  const nextThinkingByCliAndModel = {
    ...nextStore.thinkingByCliAndModel,
  };
  nextThinkingByCliAndModel[cli] = {
    ...(nextThinkingByCliAndModel[cli] ?? {}),
    [getCliModelThinkingKey(model)]: normalizedThinkingMode,
  };
  nextStore.thinkingByCliAndModel = nextThinkingByCliAndModel;
  modelStore = ensureCliModelStore(nextStore);
  writeModelStore(modelStore);
}

function getEffectiveThinkingMode(cli: CliName, model: string | null = getSelectedCliModel(cli)): ThinkingMode {
  if (cli === "opencode") {
    return "off";
  }
  return getStoredCliModelThinkingMode(cli, model) ?? getWorkspaceThinkingMode(cli);
}

function getWorkspaceInteractiveMode(cli: CliName): InteractiveMode {
  const perCli = workspaceSettings.interactiveModeByCli;
  if (!perCli) {
    return "coding";
  }
  const mode = perCli[cli];
  return normalizeVisibleInteractiveMode(mode);
}

function setWorkspaceInteractiveModeForCli(cli: CliName, mode: InteractiveMode): boolean {
  const normalizedMode = normalizeVisibleInteractiveMode(mode);
  if (!workspaceSettings.interactiveModeByCli) {
    workspaceSettings.interactiveModeByCli = {};
  }
  if (workspaceSettings.interactiveModeByCli[cli] === normalizedMode) {
    return false;
  }
  workspaceSettings.interactiveModeByCli[cli] = normalizedMode;
  saveWorkspaceSettings(workspaceSettings);
  return true;
}

function getWorkspaceLoopExecutionMode(cli: CliName): LoopExecutionMode {
  const perCli = workspaceSettings.loopExecutionModeByCli;
  if (!perCli) {
    return DEFAULT_LOOP_EXECUTION_MODE;
  }
  return normalizeLoopExecutionMode(perCli[cli]);
}

function setWorkspaceLoopExecutionModeForCli(cli: CliName, mode: LoopExecutionMode): boolean {
  const normalizedMode = normalizeLoopExecutionMode(mode);
  if (!workspaceSettings.loopExecutionModeByCli) {
    workspaceSettings.loopExecutionModeByCli = {};
  }
  if (workspaceSettings.loopExecutionModeByCli[cli] === normalizedMode) {
    return false;
  }
  workspaceSettings.loopExecutionModeByCli[cli] = normalizedMode;
  saveWorkspaceSettings(workspaceSettings);
  return true;
}

function buildWorkspaceLoopExecutionModeByCli(): Record<CliName, LoopExecutionMode> {
  const result = {} as Record<CliName, LoopExecutionMode>;
  CLI_LIST.forEach((cli) => {
    result[cli] = getWorkspaceLoopExecutionMode(cli);
  });
  return result;
}

function getGlobalHumanInteractionEnabled(): boolean {
  return resolveGlobalHumanInteractionEnabled(readToolSettings());
}

function shouldRequireExplicitFinalAnswerForRun(input: { loopTaskId?: string }): boolean {
  return !input.loopTaskId;
}

function buildLongTermMemoryRuntimeSettings(): MemoryRuntimeGateSettings {
  const toolSettings = readToolSettings();
  return {
    memoryEnabled: toolSettings.memoryEnabled,
    globalMemoryEnabled: toolSettings.globalMemoryEnabled,
    memoryAutoExtractAfterCompact: toolSettings.memoryAutoExtractAfterCompact,
    memoryAutoExtractAfterLoopTask: toolSettings.memoryAutoExtractAfterLoopTask,
    workspaceSettings: {
      longTermMemoryEnabled: workspaceSettings.workspaceMemoryEnabled,
      workspaceMemoryEnabled: workspaceSettings.workspaceMemoryEnabled,
    },
  };
}

function getLongTermMemoryDisabledReason(): "disabled-by-setting" | null {
  return getLongTermMemoryRuntimeDisableReason(buildLongTermMemoryRuntimeSettings());
}

function getEffectiveLongTermMemoryEnabled(): boolean {
  return isLongTermMemoryRuntimeEnabled(buildLongTermMemoryRuntimeSettings());
}

function getActiveWorkspaceMemoryPaths() {
  return resolveWorkspaceMemoryPaths(resolveWorkspaceCwd() ?? null);
}

function ensureActiveWorkspaceHarnessScaffold(): boolean {
  const paths = getActiveWorkspaceMemoryPaths();
  if (!paths) {
    return false;
  }
  try {
    ensureWorkspaceHarnessScaffold(deps.getExtensionUri().fsPath, paths);
    return true;
  } catch (error) {
    void logError("workspace-harness-scaffold-error", {
      error: String(error),
      workspace: paths.workspaceRoot,
    });
    return false;
  }
}

async function confirmAndInitializeWorkspaceHarness(): Promise<boolean> {
  const workspaceRoot = resolveWorkspaceCwd();
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage(t("workspaceHarness.noWorkspace"));
    return false;
  }
  const confirmLabel = t("workspaceHarness.confirmInitializeAction");
  const selection = await vscode.window.showWarningMessage(
    t("workspaceHarness.confirmInitialize", { workspace: workspaceRoot }),
    { modal: true },
    confirmLabel,
  );
  if (selection !== confirmLabel) {
    return false;
  }
  const scaffoldReady = ensureActiveWorkspaceHarnessScaffold();
  if (!scaffoldReady) {
    void vscode.window.showWarningMessage(t("workspaceHarness.initFailed"));
    return false;
  }
  void vscode.window.showInformationMessage(t("workspaceHarness.initStarted"));
  void maybePromptInitializeArchitectureWithAi(workspaceRoot);
  return true;
}

function inspectActiveCodeGraphStatus() {
  return inspectCodeGraphStatus({
    workspaceRoot: resolveWorkspaceCwd() ?? null,
  });
}

function isCodeGraphInstalling(): boolean {
  return codeGraphInstalling;
}

function stopCodeGraphInstallCompletionWatch(): void {
  if (codeGraphInstallPollTimer) {
    clearInterval(codeGraphInstallPollTimer);
    codeGraphInstallPollTimer = null;
  }
  codeGraphInstallPollStartedAt = 0;
}

function isCodeGraphInstallComplete(status = inspectActiveCodeGraphStatus()): boolean {
  if (status.ready) {
    return true;
  }
  return !resolveWorkspaceCwd() && status.cliInstalled && status.mcpConfigured;
}

async function refreshCodeGraphInstallWatch(): Promise<void> {
  const status = inspectActiveCodeGraphStatus();
  if (isCodeGraphInstallComplete(status)) {
    const becameReady = status.ready;
    stopCodeGraphInstallCompletionWatch();
    codeGraphInstalling = false;
    if (becameReady) {
      void vscode.window.showInformationMessage(t("codegraph.installReady"));
    }
    await postPanelState();
    return;
  }
  if (codeGraphInstallPollStartedAt > 0 && Date.now() - codeGraphInstallPollStartedAt >= CODEGRAPH_INSTALL_TIMEOUT_MS) {
    stopCodeGraphInstallCompletionWatch();
    codeGraphInstalling = false;
    void vscode.window.showWarningMessage(t("codegraph.installTimeout"));
    await postPanelState();
  }
}

function startCodeGraphInstallCompletionWatch(): void {
  stopCodeGraphInstallCompletionWatch();
  codeGraphInstalling = true;
  codeGraphInstallPollStartedAt = Date.now();
  codeGraphInstallPollTimer = setInterval(() => {
    void refreshCodeGraphInstallWatch();
  }, CODEGRAPH_INSTALL_POLL_MS);
  void postPanelState();
  void refreshCodeGraphInstallWatch();
}

function createCodeGraphTerminal(name: string, cwd: string): vscode.Terminal {
  const terminalOptions: vscode.TerminalOptions = {
    name,
    cwd,
  };
  if (process.platform === "win32") {
    terminalOptions.shellPath = process.env.ComSpec || "cmd.exe";
  }
  return vscode.window.createTerminal(terminalOptions);
}

function describeCodeGraphInstallPrompt(
  steps: CodeGraphInstallStep[],
  workspaceRoot: string | undefined,
  command: string,
): { actionLabel: string; confirmMessage: string } {
  const hasInit = steps.includes("initWorkspace");
  const hasInstall = steps.includes("installCli");
  const hasRegister = steps.includes("registerMcp");
  if (hasInstall && hasInit) {
    return {
      actionLabel: t("codegraph.installAction"),
      confirmMessage: t("codegraph.installConfirm", { workspace: workspaceRoot ?? "", command }),
    };
  }
  if (hasInstall) {
    return {
      actionLabel: t("codegraph.installAction"),
      confirmMessage: t("codegraph.installConfirmNoWorkspace", { command }),
    };
  }
  if (hasRegister && hasInit) {
    return {
      actionLabel: t("codegraph.registerAction"),
      confirmMessage: t("codegraph.registerAndInitConfirm", { workspace: workspaceRoot ?? "", command }),
    };
  }
  if (hasRegister) {
    return {
      actionLabel: t("codegraph.registerAction"),
      confirmMessage: t("codegraph.registerConfirm", { command }),
    };
  }
  return {
    actionLabel: t("codegraph.initAction"),
    confirmMessage: t("codegraph.initConfirm", { workspace: workspaceRoot ?? "", command }),
  };
}

async function installCodeGraphForWorkspace(): Promise<void> {
  if (codeGraphInstalling) {
    return;
  }
  const status = inspectActiveCodeGraphStatus();
  if (status.ready) {
    await postPanelState();
    return;
  }
  const workspaceRoot = resolveWorkspaceCwd();
  const initializeWorkspace = Boolean(workspaceRoot) && !status.workspaceIndexed;
  const commandOptions = {
    cliInstalled: status.cliInstalled,
    mcpConfigured: status.mcpConfigured,
    initializeWorkspace,
  };
  const steps = getCodeGraphInstallSteps(commandOptions);
  const installCommand = getCodeGraphInstallCommand(commandOptions);
  if (!installCommand) {
    void vscode.window.showInformationMessage(t("codegraph.installNeedsWorkspace"));
    await postPanelState();
    return;
  }
  const { actionLabel: confirmLabel, confirmMessage } = describeCodeGraphInstallPrompt(steps, workspaceRoot, installCommand);
  const selection = await vscode.window.showWarningMessage(
    confirmMessage,
    { modal: true },
    confirmLabel,
  );
  if (selection !== confirmLabel) {
    return;
  }

  const terminal = createCodeGraphTerminal(
    CODEGRAPH_INSTALL_TERMINAL_NAME,
    workspaceRoot ?? os.homedir(),
  );
  terminal.show();
  terminal.sendText(installCommand);
  startCodeGraphInstallCompletionWatch();
  void logInfo("codegraph-install-triggered", {
    workspace: workspaceRoot ?? null,
    command: installCommand,
    initializeWorkspace,
    cliInstalled: status.cliInstalled,
    mcpConfigured: status.mcpConfigured,
    steps,
    platform: process.platform,
  });
  void vscode.window.showInformationMessage(
    t("codegraph.installStarted", { command: installCommand }),
  );
}

function buildArchitectureInitializationModelPrompt(workspaceRoot: string): string {
  return [
    "你正在当前 VS Code 工作区执行 Harness 骨架初始化后的 ARCHITECTURE.md 初始化任务。",
    "",
    "目标：",
    "- 阅读当前项目的真实目录、README、package/config、现有文档和关键源码入口。",
    "- 按当前项目实际架构更新根级 ARCHITECTURE.md。",
    "- 保留 Harness 模板要求的结构化、可导航、AI 友好风格，但不要写成通用模板或安装说明。",
    "- 内容应覆盖项目使命、运行边界、主要模块、数据/配置存储、关键流程、扩展点、验证方式和维护注意事项。",
    "",
    "范围与约束：",
    "- 只修改当前工作区根级 ARCHITECTURE.md；除非发现事实来源文档必须同步，否则不要改其他文件。",
    "- 不要替换技术栈，不要做无关重构，不要提交密钥、账号或机器私有信息。",
    "- 如果现有 ARCHITECTURE.md 已有项目特有内容，先保留有价值事实，再补齐缺失结构。",
    "- 如果某些架构事实无法自动确认，在 ARCHITECTURE.md 中明确标为待确认，不要编造。",
    "",
    "执行步骤：",
    "1. 快速读取 README.md、package.json、src/、media/、docs/、.ch/docs/ 中与插件运行相关的事实来源。",
    "2. 识别这是 VS Code 插件项目，并归纳 UI webview、extension host、CLI 调用、配置/历史/任务数据、Harness/记忆骨架等边界。",
    "3. 更新 ARCHITECTURE.md，使后续 AI 进入仓库时可以据此理解项目结构和修改边界。",
    "4. 运行最小相关验证；Node/TypeScript 项目至少执行 npm run build，若失败需说明原因和影响。",
    "",
    `工作区：${workspaceRoot}`,
  ].join("\n");
}

async function maybePromptInitializeArchitectureWithAi(workspaceRoot: string): Promise<void> {
  const confirmLabel = t("workspaceHarness.confirmArchitectureInitializeAction");
  const selection = await vscode.window.showWarningMessage(
    t("workspaceHarness.confirmArchitectureInitialize"),
    { modal: true },
    confirmLabel,
  );
  if (selection !== confirmLabel) {
    return;
  }

  const targetTab = getActiveConversationTab();
  const targetCli = targetTab?.cli ?? currentCli;
  const targetTabId = targetTab?.id ?? getActiveConversationTabId();
  if (!targetTabId || isTabRunActive(targetTabId)) {
    void vscode.window.showWarningMessage(t("workspaceHarness.architectureInitBusy"));
    return;
  }

  if (currentCli !== targetCli) {
    currentCli = targetCli;
    updateStatusBar();
    workspaceSettings.currentCli = currentCli;
  }
  setWorkspaceInteractiveModeForCli(targetCli, "coding");
  workspaceSettings.currentCli = targetCli;
  saveWorkspaceSettings(workspaceSettings);
  await postPanelState();

  const activeConfigId = getActiveConfigIdForCli(targetCli);
  const selectedModel = getSelectedCliModel(targetCli, activeConfigId) ?? undefined;
  const promptInput: PromptRunInput = {
    displayPrompt: ARCHITECTURE_INITIALIZATION_DISPLAY_PROMPT,
    modelPrompt: buildArchitectureInitializationModelPrompt(workspaceRoot),
    contextTags: [],
    model: selectedModel,
  };
  const target = resolvePromptRunTarget(targetTabId);
  const preparedInput = target ? preloadUserMessageForPrompt(promptInput, target) : promptInput;
  recordPromptHistory(ARCHITECTURE_INITIALIZATION_DISPLAY_PROMPT, targetCli);
  void vscode.window.showInformationMessage(t("workspaceHarness.architectureInitStarted"));
  void runPrompt(preparedInput, { targetTabId });
}

function getGlobalAutoCompactContextAfterRun(): boolean {
  return resolveGlobalAutoCompactContextAfterRun(readToolSettings(), workspaceSettings);
}

function normalizeLoopMaxRounds(value: unknown): number {
  const rawValue = parseLoopMaxRoundsValue(value);
  if (!Number.isFinite(rawValue)) {
    return LOOP_DEFAULT_MAX_ROUNDS;
  }
  const integerValue = Math.floor(rawValue);
  return Math.min(Math.max(integerValue, LOOP_MIN_MAX_ROUNDS), LOOP_MAX_MAX_ROUNDS);
}

function normalizeStoredLoopMaxRounds(value: unknown): number {
  const rawValue = parseLoopMaxRoundsValue(value);
  if (!Number.isFinite(rawValue)) {
    return LOOP_DEFAULT_MAX_ROUNDS;
  }
  return Math.max(Math.floor(rawValue), LOOP_MIN_MAX_ROUNDS);
}

function parseLoopMaxRoundsValue(value: unknown): number {
  const rawValue = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  return rawValue;
}

function getGlobalLoopMaxRounds(): number {
  const toolSettings = readToolSettings();
  if (typeof toolSettings.loopMaxRounds === "number") {
    return normalizeLoopMaxRounds(toolSettings.loopMaxRounds);
  }
  return normalizeLoopMaxRounds(workspaceSettings.loopMaxRounds);
}

function getGlobalLoopPlusDecisionSubtaskMax(): number {
  return resolveLoopPlusDecisionSubtaskMax(readToolSettings().loopPlusDecisionSubtaskMax);
}

function getGlobalLoopPlusMaxAcceptances(): number {
  return resolveLoopPlusMaxAcceptances(readToolSettings().loopPlusMaxAcceptances);
}

function getGlobalLoopSubtaskMaxThinkingMode() {
  return getEffectiveLoopSubtaskMaxThinkingMode(readToolSettings().loopSubtaskMaxThinkingMode);
}

function getModelStoreOptions() {
  return {
    modelStoreFile: MODEL_STORE_FILE,
    defaultModelStoreKey: DEFAULT_MODEL_STORE_KEY,
    isThinkingMode,
    normalizeThinkingModeForCli,
    logError: (event: string, payload?: unknown) => void logError(event, payload),
  };
}

function getWorkspaceSettingsStoreOptions() {
  return {
    workspaceSettingsDir: WORKSPACE_SETTINGS_DIR,
    workspaceKey: activeWorkspaceKey,
    isCliName,
    isThinkingMode,
    isInteractiveMode,
    normalizeVisibleInteractiveMode,
    normalizeLoopMaxRounds,
    sanitizeConversationTabRecord: (value: unknown): ConversationTabRecordForWorkspaceSettings | null => sanitizeConversationTabRecord(value),
    logError: (event: string, payload?: unknown) => void logError(event, payload),
  };
}

function getPromptHistoryStoreOptions() {
  return {
    promptHistoryDir: PROMPT_HISTORY_DIR,
    legacyPromptHistoryFile: LEGACY_PROMPT_HISTORY_FILE,
    workspaceKey: activeWorkspaceKey,
    workspaceKeyFallback: WORKSPACE_KEY_FALLBACK,
    promptHistoryLimit: PROMPT_HISTORY_LIMIT,
    currentCli,
    isCliName,
    isTimestampWithinHistoryRetention,
    logInfo: (event: string, payload?: unknown) => void logInfo(event, payload),
    logError: (event: string, payload?: unknown) => void logError(event, payload),
  };
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? (error.message || String(error)) : String(error);
}

function ensureCliModelStore(store?: CliModelStore): CliModelStore {
  return ensureCliModelSelectionStore(store, getModelStoreOptions());
}

function readModelStore(): CliModelStore | undefined {
  return readModelSelectionStore(deps.getModelSelectionStoreState(), getModelStoreOptions());
}

function writeModelStore(store: CliModelStore): void {
  writeModelSelectionStore(deps.getModelSelectionStoreState(), store, getModelStoreOptions());
}

function loadModelStore(): CliModelStore {
  return loadModelSelectionStore(deps.getModelSelectionStoreState(), getModelStoreOptions());
}

function getActiveConfigIdForCli(cli: CliName): string | null {
  const workspacePreferredConfigId = deps.getWorkspacePreferredConfigIdForCli(cli);
  const loaded = loadedConfigStates?.workspaceKey === activeWorkspaceKey ? loadedConfigStates : null;
  const loadedState = loaded?.states[cli];
  if (loadedState) {
    return workspacePreferredConfigId !== loaded?.preferredIds[cli]
      ? workspacePreferredConfigId
      : loadedState.activeConfigId;
  }
  if (workspacePreferredConfigId) {
    return workspacePreferredConfigId;
  }
  const snapshot = deps.getConfigHeartbeatSnapshot();
  if (snapshot && snapshot.cli === cli && snapshot.activeConfigId) {
    return snapshot.activeConfigId;
  }
  return null;
}

function resolveConfigModelId(cli: CliName, configState: PanelState["configState"]): string | null {
  if (loadedConfigStates?.workspaceKey === activeWorkspaceKey && loadedConfigStates.states[cli]) {
    return getActiveConfigIdForCli(cli);
  }
  return currentCli === cli ? deps.resolveModelConfigIdForCli(cli, configState) : getActiveConfigIdForCli(cli);
}

async function refreshConfigModels(states: Record<CliName, PanelState["configState"]>): Promise<void> {
  loadedConfigStates = {
    workspaceKey: activeWorkspaceKey,
    states,
    preferredIds: Object.fromEntries(CLI_LIST.map((cli) => [cli, deps.getWorkspacePreferredConfigIdForCli(cli)])),
  };
  const currentState = states[currentCli];
  await Promise.all([
    refreshGrokConfigModels(currentState),
    refreshKimiCodeConfigModels(currentState),
    refreshZcodeConfigModels(currentState),
    refreshDshConfigModels(currentState),
  ]);
}

function getSelectedCliModel(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  return cliModelSelectionStrategies[cli].getSelectedModel(modelStore, configId);
}

function cacheGrokConfigModels(configId: string, config: GrokConfigModels): void {
  grokModelsByConfigId.set(configId, config);
}

async function refreshGrokConfigModels(configState: PanelState["configState"]): Promise<void> {
  const configId = resolveConfigModelId("grok", configState);
  try {
    grokModelsByConfigId.set(configId, parseGrokConfigModels(await configService.readGrokConfigText()));
  } catch (error) {
    grokModelsByConfigId.set(configId, { models: [], labels: {}, defaultModel: null, error: errorToMessage(error) });
    void logError("grok-config-models-read-failed", { error: errorToMessage(error) });
  }
}

function cacheDshConfigModels(configId: string, config: DshConfigModels): void {
  dshModelsByConfigId.set(configId, config);
}

async function refreshDshConfigModels(configState: PanelState["configState"]): Promise<void> {
  const configId = resolveConfigModelId("dsh", configState);
  try {
    const profile = configId
      ? await configService.getConfigById("dsh", configId)
      : await configService.getCurrentConfig("dsh");
    if (!profile) {
      dshModelsByConfigId.set(configId, emptyDshModels("DSH profile was not found."));
      return;
    }
    dshModelsByConfigId.set(configId, parseDshConfigModels(profile.content ?? profile.configContent ?? ""));
  } catch (error) {
    dshModelsByConfigId.set(configId, emptyDshModels(errorToMessage(error)));
    void logError("dsh-config-models-read-failed", { error: errorToMessage(error) });
  }
}

function cacheKimiCodeConfigModels(configId: string, config: KimiCodeConfigModels): void {
  kimiCodeModelsByConfigId.set(configId, config);
}

async function refreshKimiCodeConfigModels(configState: PanelState["configState"]): Promise<void> {
  const configId = resolveConfigModelId("kimi-code", configState);
  try {
    const current = await configService.getCurrentConfig("kimi-code");
    kimiCodeModelsByConfigId.set(configId, parseKimiCodeConfigModels(current.content ?? ""));
  } catch (error) {
    kimiCodeModelsByConfigId.set(configId, {
      models: [],
      labels: {},
      defaultModel: null,
      thinkingEffort: null,
      permissionMode: null,
      error: errorToMessage(error),
    });
    void logError("kimi-code-config-models-read-failed", { error: errorToMessage(error) });
  }
}

async function resolveKimiCodeModelForRun(selectedModel: string | null): Promise<string> {
  const config = parseKimiCodeConfigModels((await configService.getCurrentConfig("kimi-code")).content ?? "");
  if (config.error) {
    throw new Error(t("kimi.invalidConfig"));
  }
  kimiCodeModelsByConfigId.set(getActiveConfigIdForCli("kimi-code"), config);
  const model = resolveKimiCodeConfigModel(config, selectedModel);
  if (!model) {
    throw new Error(t("kimi.noConfiguredModels"));
  }
  return model;
}

/**
 * Kimi Code 的 ACP `model` 配置项取值就是 `[models.<alias>]` 的别名本身，
 * 没有 DSH 那样的 JSON wire 编码，因此这里只做别名解析与空值校验。
 */
async function resolveKimiModelWireForRun(selectedModel: string | null): Promise<string> {
  return resolveKimiCodeModelForRun(selectedModel);
}

async function refreshZcodeConfigModels(configState: PanelState["configState"]): Promise<void> {
  const configId = resolveConfigModelId("zcode", configState);
  try {
    const current = await configService.getCurrentConfig("zcode");
    zcodeModelsByConfigId.set(configId, readZcodeConfigModels(current.content ?? ""));
  } catch (error) {
    zcodeModelsByConfigId.set(configId, {
      models: [],
      labels: {},
      defaultModel: null,
      error: errorToMessage(error),
    });
    void logError("zcode-config-models-read-failed", { error: errorToMessage(error) });
  }
}

async function resolveZcodeModelWireForRun(selectedModel: string | null): Promise<string> {
  const content = (await configService.getCurrentConfig("zcode")).content ?? "";
  const config = readZcodeConfigModels(content);
  zcodeModelsByConfigId.set(getActiveConfigIdForCli("zcode"), config);
  return resolveConfiguredZcodeModelWireForRun(content, selectedModel);
}

async function resolveDshModelForRun(selectedModel: string | null): Promise<string> {
  const configId = getActiveConfigIdForCli("dsh");
  if (!configId) {
    throw new Error("DSH profile is not active.");
  }
  const profile = await configService.getConfigById("dsh", configId);
  if (!profile) {
    throw new Error("DSH profile was not found.");
  }
  const config = parseDshConfigModels(profile.content ?? profile.configContent ?? "");
  dshModelsByConfigId.set(configId, config);
  if (config.error) {
    throw new Error(config.error);
  }
  const model = resolveDshConfigModel(config, selectedModel);
  if (!model) {
    throw new Error("DSH has no configured executable model.");
  }
  return model;
}

async function resolveDshModelWireForRun(selectedModel: string | null): Promise<string> {
  const configId = getActiveConfigIdForCli("dsh");
  if (!configId) {
    throw new Error("DSH profile is not active.");
  }
  const profile = await configService.getConfigById("dsh", configId);
  if (!profile) {
    throw new Error("DSH profile was not found.");
  }
  const config = parseDshConfigModels(profile.content ?? profile.configContent ?? "");
  dshModelsByConfigId.set(configId, config);
  return readDshModelWireForRun(config, selectedModel);
}

function emptyDshModels(error: string): DshConfigModels {
  return { models: [], labels: {}, defaultModel: null, wireByModelId: {}, reasoningOptionsByModelId: {}, error };
}

async function resolveGrokModelForRun(selectedModel: string | null): Promise<string> {
  const config = parseGrokConfigModels(await configService.readGrokConfigText());
  if (config.error) {
    throw new Error(t("grok.invalidConfig"));
  }
  grokModelsByConfigId.set(getActiveConfigIdForCli("grok"), config);
  const model = resolveGrokConfigModel(config, selectedModel);
  if (!model) {
    throw new Error(t("grok.noConfiguredModels"));
  }
  return model;
}

function getModelDisplayName(cli: CliName, model: string | null): string | null {
  return cliModelSelectionStrategies[cli].getModelDisplayName(model, getActiveConfigIdForCli(cli));
}

function getSelectedLoopCliModel(
  cli: CliName,
  role: "main" | "subtask",
  configId: string | null = getActiveConfigIdForCli(cli),
): string | null {
  return cliModelSelectionStrategies[cli].getSelectedLoopModel(modelStore, role, configId);
}

function getSelectedLoopThinkingMode(
  cli: CliName,
  role: "main" | "subtask",
  model: string | null | undefined,
  configId: string | null = getActiveConfigIdForCli(cli),
): ThinkingMode | null {
  const selected = getSelectedLoopThinkingModeFromStore(
    modelStore,
    cli,
    role,
    model,
    cliModelSelectionStrategies[cli].resolveStoreConfigKey(configId),
  );
  if (cli !== "dsh" || !selected) {
    return selected;
  }
  const reasoningOptions = dshModelsByConfigId.get(configId)?.reasoningOptionsByModelId;
  const modelKey = Object.keys(reasoningOptions ?? {}).find((candidate) => (
    candidate.toLowerCase() === (normalizeCliModelName(model) ?? "").toLowerCase()
  ));
  return modelKey && reasoningOptions?.[modelKey]?.includes(selected as DshReasoningOption) ? selected : null;
}

function getManagedModelOptionsForCli(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string[] {
  return cliModelSelectionStrategies[cli].getManagedModelOptions(modelStore, configId);
}

function getModelOptionsForCli(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string[] {
  return cliModelSelectionStrategies[cli].getModelOptions(modelStore, configId);
}

function selectCliModel(cli: CliName, model: string | null, configId: string | null = getActiveConfigIdForCli(cli)): void {
  modelStore = cliModelSelectionStrategies[cli].selectModel(modelStore, model, configId);
  writeModelStore(modelStore);
}

function selectCliLoopModel(
  cli: CliName,
  role: "main" | "subtask",
  model: string | null,
  configId: string | null = getActiveConfigIdForCli(cli),
): void {
  modelStore = cliModelSelectionStrategies[cli].selectLoopModel(modelStore, role, model, configId);
  writeModelStore(modelStore);
}

function setSelectedLoopThinkingMode(
  cli: CliName,
  role: "main" | "subtask",
  model: string | null | undefined,
  thinkingMode: ThinkingMode | null,
  configId: string | null = getActiveConfigIdForCli(cli),
): void {
  const dshOptions = cli === "dsh"
    ? dshModelsByConfigId.get(configId)?.reasoningOptionsByModelId
    : undefined;
  const dshModelKey = Object.keys(dshOptions ?? {}).find((candidate) => (
    candidate.toLowerCase() === (normalizeCliModelName(model) ?? "").toLowerCase()
  ));
  const canStoreDshMode = cli !== "dsh"
    || Boolean(thinkingMode && dshModelKey && dshOptions?.[dshModelKey]?.includes(thinkingMode as DshReasoningOption));
  const normalizedThinkingMode = thinkingMode && canStoreDshMode
    ? normalizeThinkingModeForCli(cli, thinkingMode)
    : null;
  modelStore = setSelectedLoopThinkingModeInStore(
    modelStore,
    cli,
    role,
    model,
    normalizedThinkingMode,
    cliModelSelectionStrategies[cli].resolveStoreConfigKey(configId),
  );
  writeModelStore(modelStore);
}

async function updateOpenCodeRoleModelForConfig(
  role: OpenCodeModelRoleInput,
  value: string | null,
  configId: string | null
): Promise<string | null> {
  const normalizedRole = normalizeOpenCodeModelRole(role);
  if (!configId) {
    return `OpenCode ${normalizedRole} model cannot be changed because there is no active config.`;
  }
  const activeConfig = await configService.getConfigById("opencode", configId);
  if (!activeConfig) {
    return `OpenCode ${normalizedRole} model cannot be changed because active config "${configId}" was not found.`;
  }
  const parsed = parseOpenCodeConfigModels(activeConfig.content);
  const validation = validateOpenCodeModelOverride(parsed, normalizedRole, value);
  if (!validation.ok) {
    return validation.issue?.message ?? `OpenCode ${normalizedRole} model selection is invalid.`;
  }
  const nextStore = setOpenCodeRoleModelInStore(modelStore, configId, normalizedRole, validation.modelRef);
  if (nextStore !== modelStore) {
    modelStore = nextStore;
    writeModelStore(modelStore);
  }
  return null;
}

function addCliModel(cli: CliName, model: string, configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  const normalized = normalizeCliModelName(model);
  if (!normalized) {
    return null;
  }
  const nextStore = selectCliModelInStore(modelStore, cli, normalized, configId);
  if (nextStore === modelStore) {
    return null;
  }
  modelStore = nextStore;
  writeModelStore(modelStore);
  return normalized;
}

function renameCliModel(cli: CliName, previousModel: string, nextModel: string, configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  const result = renameCliModelInStore(modelStore, cli, previousModel, nextModel, configId);
  if (!result.renamedModel) {
    return null;
  }
  modelStore = result.store;
  writeModelStore(modelStore);
  return result.renamedModel;
}

function deleteCliModel(cli: CliName, model: string, configId: string | null = getActiveConfigIdForCli(cli)): void {
  modelStore = deleteCliModelFromStore(modelStore, cli, model, configId);
  writeModelStore(modelStore);
}

function moveCliModel(cli: CliName, model: string, direction: "up" | "down", configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  const result = moveCliModelInStore(modelStore, cli, model, direction, configId);
  if (!result.movedModel) {
    return null;
  }
  modelStore = result.store;
  writeModelStore(modelStore);
  return result.movedModel;
}

async function manageKimiCodeModelList(
  change: KimiCodeModelListChange,
  configId: string,
): Promise<{ applied: boolean; model: string | null; config: KimiCodeConfigModels }> {
  let content = "";
  const config = await configService.getConfigById("kimi-code", configId);
  if (!config) throw new Error("Kimi 配置档案不存在，请刷新后重试。");
  const changed = changeKimiCodeConfigModelList(config.configContent ?? config.content ?? "", change);
  if (!changed.ok) throw new Error(changed.error);
  content = changed.content;
  await configService.saveConfig({
    ...config,
    platform: "kimi-code",
    content,
    configContent: content,
    updatedAt: Date.now(),
  });
  const parsed = parseKimiCodeConfigModels(content);
  kimiCodeModelsByConfigId.set(configId, parsed);
  if (change.type === "add") selectCliModel("kimi-code", change.model, configId);
  return { applied: true, model: change.type === "delete" ? parsed.defaultModel : change.type === "rename" ? change.nextModel : change.model, config: parsed };
}

function getEffectiveCliArgs(cli: CliName, model: string | null = getSelectedCliModel(cli)): string[] {
  return getEffectiveCliArgsFromStore(cli, model);
}

let loopSubtaskOpenCodeModelsState: PanelState["openCodeModels"];

function getSelectedLoopSubtaskCli(configId: string | null | undefined): CliName | null {
  return getSelectedLoopSubtaskCliFromStore(modelStore, configId);
}

function selectLoopSubtaskCli(configId: string | null | undefined, cli: CliName | null): void {
  modelStore = selectLoopSubtaskCliInStore(modelStore, configId, cli);
  writeModelStore(modelStore);
}

function openCodeModelsFromParsed(
  parsed: ReturnType<typeof parseOpenCodeConfigModels>,
  configId: string | null,
): PanelState["openCodeModels"] {
  const storedMain = getOpenCodeRoleModelFromStore(modelStore, configId, "main");
  const storedSubtask = getOpenCodeRoleModelFromStore(modelStore, configId, "subtask");
  const main = storedMain ?? parsed.mainModel?.ref ?? null;
  const subtask = storedSubtask ?? parsed.subtaskModel?.ref ?? null;
  return {
    models: parsed.candidates.map((candidate) => ({
      ref: candidate.ref,
      label: candidate.label,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
    })),
    configPrimaryRef: parsed.mainModelRef,
    configSmallRef: parsed.subtaskModelRef,
    configMainRef: parsed.mainModelRef,
    configSubtaskRef: parsed.subtaskModelRef,
    selectedPrimaryRef: main,
    selectedSmallRef: subtask ?? main,
    selectedMainRef: main,
    selectedSubtaskRef: subtask ?? main,
    issues: parsed.issues.map((issue) => ({
      ...(issue.role ? { role: toOpenCodeConfigFieldRole(issue.role) } : {}),
      code: issue.code,
      messageKey: `opencodeModels.issue.${issue.code}`,
    })),
  };
}

async function refreshLoopSubtaskOpenCodeModels(configState?: PanelState["configState"]): Promise<void> {
  if (currentCli === "opencode" && openCodeModelsState) {
    loopSubtaskOpenCodeModelsState = openCodeModelsState;
    return;
  }
  const configId = configState ? configState.activeConfigId : getActiveConfigIdForCli("opencode");
  try {
    const activeConfig = configId
      ? await configService.getConfigById("opencode", configId)
      : await configService.getCurrentConfig("opencode");
    if (!activeConfig) {
      loopSubtaskOpenCodeModelsState = {
        models: [],
        issues: [{ code: "provider-not-found", messageKey: "opencodeModels.issue.provider-not-found" }],
      };
      return;
    }
    loopSubtaskOpenCodeModelsState = openCodeModelsFromParsed(
      parseOpenCodeConfigModels(activeConfig.content ?? "{}"),
      configId,
    );
  } catch {
    loopSubtaskOpenCodeModelsState = {
      models: [],
      issues: [{ code: "metadata-unavailable", messageKey: "opencodeModels.issue.metadata-unavailable" }],
    };
  }
}

function getLoopSubtaskOpenCodeModels(): PanelState["openCodeModels"] {
  const models = currentCli === "opencode" ? openCodeModelsState : loopSubtaskOpenCodeModelsState;
  if (!models) {
    return models;
  }
  const configId = currentCli === "opencode"
    ? openCodeThinkingConfigId
    : getActiveConfigIdForCli("opencode");
  const modelRef = models.selectedSubtaskRef ?? models.selectedSmallRef ?? null;
  const selectedSubtaskVariant = modelRef
    ? getOpenCodeRoleVariantFromStore(modelStore, configId, modelRef, "subtask")
    : null;
  return {
    ...models,
    ...(selectedSubtaskVariant ? { selectedSubtaskVariant } : {}),
  };
}

function buildModelState(
  activeConfigIdByCli: Partial<Record<CliName, string | null>> = {}
): PanelState["modelState"] {
  const state = buildModelSelectionState(modelStore, getActiveConfigIdForCli, activeConfigIdByCli);
  const resolvedIds = state.activeConfigIdByCli ?? {};
  const configId = resolvedIds.grok ?? null;
  const models = getModelOptionsForCli("grok", configId);
  state.optionsByCli.grok = models;
  state.labelsByCli = { grok: { ...(grokModelsByConfigId.get(configId)?.labels ?? {}) } };
  state.managedByCli.grok = [];
  state.selectedByCli.grok = getSelectedCliModel("grok", configId);
  state.loopOptionsByCli = { ...state.loopOptionsByCli, grok: { main: models, subtask: models } };
  const main = getSelectedLoopCliModel("grok", "main", configId);
  const subtask = getSelectedLoopCliModel("grok", "subtask", configId);
  state.selectedLoopByCli = { ...state.selectedLoopByCli, grok: { main, subtask } };
  const kimiCodeConfigId = resolvedIds["kimi-code"] ?? null;
  const kimiCodeModels = getModelOptionsForCli("kimi-code", kimiCodeConfigId);
  state.optionsByCli["kimi-code"] = kimiCodeModels;
  state.labelsByCli = {
    ...state.labelsByCli,
    "kimi-code": { ...(kimiCodeModelsByConfigId.get(kimiCodeConfigId)?.labels ?? {}) },
  };
  state.managedByCli["kimi-code"] = [...kimiCodeModels];
  state.selectedByCli["kimi-code"] = getSelectedCliModel("kimi-code", kimiCodeConfigId);
  state.loopOptionsByCli = {
    ...state.loopOptionsByCli,
    "kimi-code": { main: kimiCodeModels, subtask: kimiCodeModels },
  };
  const zcodeConfigId = resolvedIds.zcode ?? null;
  const zcodeModels = getModelOptionsForCli("zcode", zcodeConfigId);
  state.optionsByCli.zcode = zcodeModels;
  state.labelsByCli = {
    ...state.labelsByCli,
    zcode: { ...(zcodeModelsByConfigId.get(zcodeConfigId)?.labels ?? {}) },
  };
  state.managedByCli.zcode = [...zcodeModels];
  state.selectedByCli.zcode = getSelectedCliModel("zcode", zcodeConfigId);
  state.loopOptionsByCli = {
    ...state.loopOptionsByCli,
    zcode: { main: zcodeModels, subtask: zcodeModels },
  };
  const zcodeMain = getSelectedLoopCliModel("zcode", "main", zcodeConfigId);
  const zcodeSubtask = getSelectedLoopCliModel("zcode", "subtask", zcodeConfigId);
  state.selectedLoopByCli = {
    ...state.selectedLoopByCli,
    zcode: { main: zcodeMain, subtask: zcodeSubtask },
  };
  const kimiCodeMain = getSelectedLoopCliModel("kimi-code", "main", kimiCodeConfigId);
  const kimiCodeSubtask = getSelectedLoopCliModel("kimi-code", "subtask", kimiCodeConfigId);
  state.selectedLoopByCli = {
    ...state.selectedLoopByCli,
    "kimi-code": { main: kimiCodeMain, subtask: kimiCodeSubtask },
  };
  const dshConfigId = resolvedIds.dsh ?? null;
  const dshModels = getModelOptionsForCli("dsh", dshConfigId);
  state.optionsByCli.dsh = dshModels;
  state.labelsByCli = {
    ...state.labelsByCli,
    dsh: { ...(dshModelsByConfigId.get(dshConfigId)?.labels ?? {}) },
  };
  state.managedByCli.dsh = [];
  state.selectedByCli.dsh = getSelectedCliModel("dsh", dshConfigId);
  state.loopOptionsByCli = { ...state.loopOptionsByCli, dsh: { main: dshModels, subtask: dshModels } };
  const dshMain = getSelectedLoopCliModel("dsh", "main", dshConfigId);
  const dshSubtask = getSelectedLoopCliModel("dsh", "subtask", dshConfigId);
  state.selectedLoopByCli = { ...state.selectedLoopByCli, dsh: { main: dshMain, subtask: dshSubtask } };
  const dshSelectedModel = state.selectedByCli.dsh;
  state.dshReasoningOptions = dshSelectedModel
    ? [...(dshModelsByConfigId.get(dshConfigId)?.reasoningOptionsByModelId[dshSelectedModel] ?? [])]
    : [];
  state.dshReasoningOptionsByModel = Object.fromEntries(
    Object.entries(dshModelsByConfigId.get(dshConfigId)?.reasoningOptionsByModelId ?? {})
      .map(([model, options]) => [model, [...options]]),
  );
  state.selectedLoopThinkingByCli = {
    ...state.selectedLoopThinkingByCli,
    grok: {
      main: getSelectedLoopThinkingMode("grok", "main", main, configId),
      subtask: getSelectedLoopThinkingMode("grok", "subtask", subtask, configId),
    },
    claude: {
      main: getSelectedLoopThinkingMode("claude", "main", null, resolvedIds.claude ?? null),
      subtask: getSelectedLoopThinkingMode("claude", "subtask", null, resolvedIds.claude ?? null),
    },
    dsh: {
      main: getSelectedLoopThinkingMode("dsh", "main", dshMain, dshConfigId),
      subtask: getSelectedLoopThinkingMode("dsh", "subtask", dshSubtask, dshConfigId),
    },
    "kimi-code": {
      main: getSelectedLoopThinkingMode("kimi-code", "main", kimiCodeMain, kimiCodeConfigId),
      subtask: getSelectedLoopThinkingMode("kimi-code", "subtask", kimiCodeSubtask, kimiCodeConfigId),
    },
    zcode: {
      main: getSelectedLoopThinkingMode("zcode", "main", zcodeMain, zcodeConfigId),
      subtask: getSelectedLoopThinkingMode("zcode", "subtask", zcodeSubtask, zcodeConfigId),
    },
  };
  state.thinkingModeByCli = {
    codex: getEffectiveThinkingMode("codex", state.selectedByCli.codex),
    claude: getEffectiveThinkingMode("claude", null),
    opencode: "off",
    grok: getEffectiveThinkingMode("grok", state.selectedByCli.grok),
    dsh: getEffectiveThinkingMode("dsh", state.selectedByCli.dsh),
    "kimi-code": getEffectiveThinkingMode("kimi-code", state.selectedByCli["kimi-code"]),
    zcode: getEffectiveThinkingMode("zcode", state.selectedByCli.zcode),
  };
  const issues = { ...(state.issuesByCli ?? {}) };
  if (grokModelsByConfigId.get(configId)?.error) {
    issues.grok = "目标 CLI 配置读取失败，不能派发子任务。";
  }
  if (dshModelsByConfigId.get(dshConfigId)?.error) {
    issues.dsh = "目标 CLI 配置读取失败，不能派发子任务。";
  }
  if (kimiCodeModelsByConfigId.get(kimiCodeConfigId)?.error) {
    issues["kimi-code"] = "目标 CLI 配置读取失败，不能派发子任务。";
  }
  if (zcodeModelsByConfigId.get(zcodeConfigId)?.error) {
    issues.zcode = "目标 CLI 配置读取失败，不能派发子任务。";
  }
  if (Object.keys(issues).length > 0) {
    state.issuesByCli = issues;
  }
  return state;
}

function loadWorkspaceSettings(): WorkspaceSettings {
  return loadWorkspaceSettingsFromStore(getWorkspaceSettingsStoreOptions());
}

function saveWorkspaceSettings(next: WorkspaceSettings): void {
  saveWorkspaceSettingsToStore(next, getWorkspaceSettingsStoreOptions());
}

function trySaveWorkspaceSettings(next: WorkspaceSettings): SaveWorkspaceSettingsResult {
  return trySaveWorkspaceSettingsToStore(next, getWorkspaceSettingsStoreOptions());
}

function loadPromptHistoryStore(): PromptHistoryStore {
  return loadPromptHistoryStoreFromStore(getPromptHistoryStoreOptions());
}

function ensurePromptHistoryStore(store?: PromptHistoryStore): PromptHistoryStore {
  return ensurePromptHistoryStoreState(store, getPromptHistoryStoreOptions());
}

function buildPromptHistoryState(): PromptHistoryItem[] {
  return buildPromptHistoryStateFromStore(promptHistoryStore);
}

function recordPromptHistory(prompt: string, cli: CliName): void {
  promptHistoryStore = recordPromptHistoryInStore(promptHistoryStore, prompt, cli, getPromptHistoryStoreOptions());
}

function setPromptHistoryFavorite(id: string, favorite?: boolean): void {
  promptHistoryStore = setPromptHistoryFavoriteInStore(promptHistoryStore, id, favorite, getPromptHistoryStoreOptions());
}

function clearPromptHistory(): void {
  promptHistoryStore = clearPromptHistoryStore(promptHistoryStore, getPromptHistoryStoreOptions());
}

function getPromptHistoryFilePath(workspaceKey: string = activeWorkspaceKey): string {
  return getPromptHistoryStoreFilePath(getPromptHistoryStoreOptions(), workspaceKey);
}

function readPromptHistoryFile(workspaceKey: string = activeWorkspaceKey): PromptHistoryStore | undefined {
  return readPromptHistoryStoreFile(getPromptHistoryStoreOptions(), workspaceKey);
}

function writePromptHistoryFile(store: PromptHistoryStore, workspaceKey: string = activeWorkspaceKey): void {
  writePromptHistoryStoreFile(store, getPromptHistoryStoreOptions(), workspaceKey);
}

function deletePromptHistoryFile(workspaceKey: string): void {
  deletePromptHistoryStoreFile(getPromptHistoryStoreOptions(), workspaceKey);
}

function cleanupPromptHistoryRetentionAcrossWorkspaces(): void {
  cleanupPromptHistoryStoreRetentionAcrossWorkspaces(getPromptHistoryStoreOptions());
}

function collectWorkspaceKeysForPromptHistoryCleanup(): string[] {
  return collectWorkspaceKeysForPromptHistoryStoreCleanup(getPromptHistoryStoreOptions());
}

return {
  getOpenCodeThinkingStateForRole: wrap(getOpenCodeThinkingStateForRole),
  setOpenCodeThinkingStateForRole: wrap(setOpenCodeThinkingStateForRole),
  persistOpenCodeVariant: wrap(persistOpenCodeVariant),
  updateOpenCodeVariantForCurrentSelection: wrap(updateOpenCodeVariantForCurrentSelection),
  updateOpenCodeVariantForConfig: wrap(updateOpenCodeVariantForConfig),
  resolveOpenCodeRoleModelsForConfig: wrap(resolveOpenCodeRoleModelsForConfig),
  refreshOpenCodeThinkingState: wrap(refreshOpenCodeThinkingState),
  getOpenCodeVariantForRun: wrap(getOpenCodeVariantForRun),
  resolvePromptRunTargetSessionId: wrap(resolvePromptRunTargetSessionId),
  resolveLoopTaskSessionId: wrap(resolveLoopTaskSessionId),
  isLoopTaskBlockedByMainAiFailureLimit: wrap(isLoopTaskBlockedByMainAiFailureLimit),
  normalizeThinkingModeForCli: wrap(normalizeThinkingModeForCli),
  getWorkspaceThinkingMode: wrap(getWorkspaceThinkingMode),
  getCliModelThinkingKey: wrap(getCliModelThinkingKey),
  getStoredCliModelThinkingMode: wrap(getStoredCliModelThinkingMode),
  setCliModelThinkingMode: wrap(setCliModelThinkingMode),
  getEffectiveThinkingMode: wrap(getEffectiveThinkingMode),
  getWorkspaceInteractiveMode: wrap(getWorkspaceInteractiveMode),
  setWorkspaceInteractiveModeForCli: wrap(setWorkspaceInteractiveModeForCli),
  getWorkspaceLoopExecutionMode: wrap(getWorkspaceLoopExecutionMode),
  setWorkspaceLoopExecutionModeForCli: wrap(setWorkspaceLoopExecutionModeForCli),
  buildWorkspaceLoopExecutionModeByCli: wrap(buildWorkspaceLoopExecutionModeByCli),
  getGlobalHumanInteractionEnabled: wrap(getGlobalHumanInteractionEnabled),
  shouldRequireExplicitFinalAnswerForRun: wrap(shouldRequireExplicitFinalAnswerForRun),
  buildLongTermMemoryRuntimeSettings: wrap(buildLongTermMemoryRuntimeSettings),
  getLongTermMemoryDisabledReason: wrap(getLongTermMemoryDisabledReason),
  getEffectiveLongTermMemoryEnabled: wrap(getEffectiveLongTermMemoryEnabled),
  getActiveWorkspaceMemoryPaths: wrap(getActiveWorkspaceMemoryPaths),
  ensureActiveWorkspaceHarnessScaffold: wrap(ensureActiveWorkspaceHarnessScaffold),
  confirmAndInitializeWorkspaceHarness: wrap(confirmAndInitializeWorkspaceHarness),
  createCodeGraphTerminal: wrap(createCodeGraphTerminal),
  installCodeGraphForWorkspace: wrap(installCodeGraphForWorkspace),
  isCodeGraphInstalling: wrap(isCodeGraphInstalling),
  buildArchitectureInitializationModelPrompt: wrap(buildArchitectureInitializationModelPrompt),
  maybePromptInitializeArchitectureWithAi: wrap(maybePromptInitializeArchitectureWithAi),
  getGlobalAutoCompactContextAfterRun: wrap(getGlobalAutoCompactContextAfterRun),
  normalizeLoopMaxRounds: wrap(normalizeLoopMaxRounds),
  normalizeStoredLoopMaxRounds: wrap(normalizeStoredLoopMaxRounds),
  parseLoopMaxRoundsValue: wrap(parseLoopMaxRoundsValue),
  getGlobalLoopMaxRounds: wrap(getGlobalLoopMaxRounds),
  getGlobalLoopPlusDecisionSubtaskMax: wrap(getGlobalLoopPlusDecisionSubtaskMax),
  getGlobalLoopPlusMaxAcceptances: wrap(getGlobalLoopPlusMaxAcceptances),
  getGlobalLoopSubtaskMaxThinkingMode: wrap(getGlobalLoopSubtaskMaxThinkingMode),
  getModelStoreOptions: wrap(getModelStoreOptions),
  getWorkspaceSettingsStoreOptions: wrap(getWorkspaceSettingsStoreOptions),
  getPromptHistoryStoreOptions: wrap(getPromptHistoryStoreOptions),
  errorToMessage: wrap(errorToMessage),
  ensureCliModelStore: wrap(ensureCliModelStore),
  readModelStore: wrap(readModelStore),
  writeModelStore: wrap(writeModelStore),
  loadModelStore: wrap(loadModelStore),
  getActiveConfigIdForCli: wrap(getActiveConfigIdForCli),
  refreshConfigModels: wrap(refreshConfigModels),
  getSelectedCliModel: wrap(getSelectedCliModel),
  getSelectedLoopCliModel: wrap(getSelectedLoopCliModel),
  getSelectedLoopThinkingMode: wrap(getSelectedLoopThinkingMode),
  getSelectedLoopSubtaskCli: wrap(getSelectedLoopSubtaskCli),
  selectLoopSubtaskCli: wrap(selectLoopSubtaskCli),
  refreshLoopSubtaskOpenCodeModels: wrap(refreshLoopSubtaskOpenCodeModels),
  getLoopSubtaskOpenCodeModels: wrap(getLoopSubtaskOpenCodeModels),
  getManagedModelOptionsForCli: wrap(getManagedModelOptionsForCli),
  getModelOptionsForCli: wrap(getModelOptionsForCli),
  cacheGrokConfigModels: wrap(cacheGrokConfigModels),
  refreshGrokConfigModels: wrap(refreshGrokConfigModels),
  resolveGrokModelForRun: wrap(resolveGrokModelForRun),
  cacheKimiCodeConfigModels: wrap(cacheKimiCodeConfigModels),
  refreshKimiCodeConfigModels: wrap(refreshKimiCodeConfigModels),
  resolveKimiCodeModelForRun: wrap(resolveKimiCodeModelForRun),
  resolveKimiModelWireForRun: wrap(resolveKimiModelWireForRun),
  refreshZcodeConfigModels: wrap(refreshZcodeConfigModels),
  resolveZcodeModelWireForRun: wrap(resolveZcodeModelWireForRun),
  cacheDshConfigModels: wrap(cacheDshConfigModels),
  refreshDshConfigModels: wrap(refreshDshConfigModels),
  resolveDshModelForRun: wrap(resolveDshModelForRun),
  resolveDshModelWireForRun: wrap(resolveDshModelWireForRun),
  getModelDisplayName: wrap(getModelDisplayName),
  selectCliModel: wrap(selectCliModel),
  selectCliLoopModel: wrap(selectCliLoopModel),
  setSelectedLoopThinkingMode: wrap(setSelectedLoopThinkingMode),
  updateOpenCodeRoleModelForConfig: wrap(updateOpenCodeRoleModelForConfig),
  addCliModel: wrap(addCliModel),
  renameCliModel: wrap(renameCliModel),
  deleteCliModel: wrap(deleteCliModel),
  moveCliModel: wrap(moveCliModel),
  manageKimiCodeModelList: wrap(manageKimiCodeModelList),
  getEffectiveCliArgs: wrap(getEffectiveCliArgs),
  buildModelState: wrap(buildModelState),
  loadWorkspaceSettings: wrap(loadWorkspaceSettings),
  saveWorkspaceSettings: wrap(saveWorkspaceSettings),
  trySaveWorkspaceSettings: wrap(trySaveWorkspaceSettings),
  loadPromptHistoryStore: wrap(loadPromptHistoryStore),
  ensurePromptHistoryStore: wrap(ensurePromptHistoryStore),
  buildPromptHistoryState: wrap(buildPromptHistoryState),
  recordPromptHistory: wrap(recordPromptHistory),
  setPromptHistoryFavorite: wrap(setPromptHistoryFavorite),
  clearPromptHistory: wrap(clearPromptHistory),
  getPromptHistoryFilePath: wrap(getPromptHistoryFilePath),
  readPromptHistoryFile: wrap(readPromptHistoryFile),
  writePromptHistoryFile: wrap(writePromptHistoryFile),
  deletePromptHistoryFile: wrap(deletePromptHistoryFile),
  cleanupPromptHistoryRetentionAcrossWorkspaces: wrap(cleanupPromptHistoryRetentionAcrossWorkspaces),
  collectWorkspaceKeysForPromptHistoryCleanup: wrap(collectWorkspaceKeysForPromptHistoryCleanup),
};
}

export function schedulingModeForInteractiveMode(mode: unknown): "event_driven" | undefined {
  return mode === LOOP_PLUS_INTERACTIVE_MODE ? "event_driven" : undefined;
}
