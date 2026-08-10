import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createHash } from "crypto";
import { getCliArgs, getCliCommand, getThinkingMode } from "../cli/config";
import { getCodeGraphInstallCommand } from "../cli/installer";
import { resolveOpenCodeModelForConfig, supportsCliManagedModelSelection } from "../cli/modelArgs";
import { CLI_LIST, DEFAULT_LOOP_EXECUTION_MODE, normalizeLoopExecutionMode, type CliName, type InteractiveMode, type LoopExecutionMode, type OpenCodeThinkingMessageKey, type OpenCodeThinkingState, type ThinkingMode } from "../cli/types";
import { normalizeOpenCodeModelRole, parseOpenCodeConfigModels, toOpenCodeConfigFieldRole, validateOpenCodeModelOverride, type OpenCodeCanonicalModelRole, type OpenCodeModelRoleInput, type ParsedOpenCodeConfigModels } from "../cli/opencodeconfigmodels";
import { resolveOpenCodeThinkingCapability, type OpenCodeThinkingCapability } from "../cli/openCodeModelCapabilities";
import * as configService from "../config/configService";
import { LOOP_MAIN_AI_FAILURE_LIMIT } from "../loopMainFailure";
import { getEffectiveLoopSubtaskMaxThinkingMode } from "../loopSubtaskThinking";
import { getLongTermMemoryRuntimeDisableReason, isLongTermMemoryRuntimeEnabled, type MemoryRuntimeGateSettings } from "../memory/runtimeGate";
import { resolveWorkspaceMemoryPaths } from "../memory/memoryPaths";
import { ensureWorkspaceHarnessScaffold } from "../workspaceScaffold";
import { buildModelState as buildModelSelectionState, countStoreModels, deleteCliModelFromStore, ensureCliModelStore as ensureCliModelSelectionStore, getEffectiveCliArgs as getEffectiveCliArgsFromStore, getManagedModelOptionsForCliFromStore, getModelOptionsForCliFromStore, getOpenCodeRoleModelFromStore, getOpenCodeRoleVariantFromStore, getSelectedCliModelFromStore, getSelectedLoopCliModelFromStore, getSelectedLoopThinkingModeFromStore, loadModelStore as loadModelSelectionStore, moveCliModelInStore, normalizeCliModelName, readModelStore as readModelSelectionStore, renameCliModelInStore, selectCliModelInStore, selectCliLoopModelInStore, setOpenCodeRoleModelInStore, setOpenCodeRoleVariantInStore, setOpenCodeVariantInStore, setSelectedLoopThinkingModeInStore, writeModelStore as writeModelSelectionStore, type CliModelStore, type ModelSelectionStoreState } from "../modelSelectionStore";
import { isInteractiveMode, isThinkingMode, isLoopTaskBlockedByMainAiFailureLimit as isLoopTaskBlockedByMainAiFailureLimitWithLimit, normalizeVisibleInteractiveMode, resolveLoopTaskSessionId as resolveLoopTaskSessionIdWithDeps, resolvePromptRunTargetSessionId as resolvePromptRunTargetSessionIdWithDeps } from "../promptRunState";
import { buildPromptHistoryState as buildPromptHistoryStateFromStore, clearPromptHistoryStore, cleanupPromptHistoryRetentionAcrossWorkspaces as cleanupPromptHistoryStoreRetentionAcrossWorkspaces, collectWorkspaceKeysForPromptHistoryCleanup as collectWorkspaceKeysForPromptHistoryStoreCleanup, deletePromptHistoryFile as deletePromptHistoryStoreFile, ensurePromptHistoryStore as ensurePromptHistoryStoreState, getPromptHistoryFilePath as getPromptHistoryStoreFilePath, loadPromptHistoryStore as loadPromptHistoryStoreFromStore, readPromptHistoryFile as readPromptHistoryStoreFile, recordPromptHistoryInStore, setPromptHistoryFavoriteInStore, writePromptHistoryFile as writePromptHistoryStoreFile, type PromptHistoryStore } from "../promptHistoryStore";
import { readToolSettings, resolveGlobalAutoCompactContextAfterRun, resolveGlobalHumanInteractionEnabled, resolveGlobalMultiAgentEnabled, type ToolSettingsLocale } from "../toolSettings";
import { t } from "../i18n";
import { logInfo } from "../logger";
import { isTimestampWithinHistoryRetention } from "../historyRetention";
import { loadWorkspaceSettings as loadWorkspaceSettingsFromStore, saveWorkspaceSettings as saveWorkspaceSettingsToStore, type ConversationTabRecordForWorkspaceSettings, type WorkspaceSettings } from "../workspaceSettingsStore";
import type { PanelState, PromptHistoryItem } from "../webview/types";
import type { ConfigHeartbeatSnapshot } from "../webviewCommandCoordinator";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import type { LoopTaskRecord } from "../loopTaskStore";
import { getConversationTabSessionIdForCli, type ConversationTabRecord } from "../sessionTabs";
import { isCliName, isOpenCodeThinkingRequestCurrent } from "../panelStateBuilder";

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
const WORKSPACE_HARNESS_TERMINAL_NAME = "Workspace Harness Setup";
const CODEGRAPH_SETUP_COMMAND = getCodeGraphInstallCommand({ initializeWorkspace: true });
const ARCHITECTURE_INITIALIZATION_DISPLAY_PROMPT = "初始化当前工作区 ARCHITECTURE.md";
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

function normalizeToolSettingsLocale(value: unknown): ToolSettingsLocale | null {
  return value === "zh-CN" || value === "en" || value === "auto" ? value : null;
}

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
  const nextVariant = value && currentState.options.some((option) => option.value === value)
    ? value
    : null;
  persistOpenCodeVariant(openCodeThinkingConfigId, exactModel, normalizedRole, nextVariant);
  setOpenCodeThinkingStateForRole(normalizedRole, {
    ...currentState,
    selectedVariant: nextVariant,
  });
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
  const requestId = ++openCodeThinkingRequestId;
  const refreshRoleThinking = (role: OpenCodeCanonicalModelRole, exactModel: string | null): void => {
    setOpenCodeThinkingStateForRole(role, buildDefaultOpenCodeThinkingState(
      exactModel ? "loading" : "select-model",
      exactModel
    ));
    if (!exactModel) {
      return;
    }

    const persistedVariant = getOpenCodeRoleVariantFromStore(modelStore, configId, exactModel, role);
    void resolveOpenCodeThinkingCapability({
      command,
      configIdentity: `${configId ?? "current"}:${configHash}:${role}`,
      configContent,
      model: exactModel,
      selectedVariant: persistedVariant,
    }).then((capability) => {
      if (!isOpenCodeThinkingRequestCurrent(requestId, contextKey, openCodeThinkingRequestId, openCodeThinkingContextKey)) {
        return;
      }
      const selectedVariant = persistedVariant
        && capability.options.some((option) => option.value === persistedVariant)
        ? persistedVariant
        : null;
      if (persistedVariant && !selectedVariant) {
        persistOpenCodeVariant(configId, exactModel, role, null);
      }
      setOpenCodeThinkingStateForRole(role, {
        ...capability,
        selectedVariant,
        disabled: capability.options.length === 0,
      });
      syncToDeps();
      void postPanelState();
    }).catch(() => {
      if (!isOpenCodeThinkingRequestCurrent(requestId, contextKey, openCodeThinkingRequestId, openCodeThinkingContextKey)) {
        return;
      }
      if (persistedVariant) {
        persistOpenCodeVariant(configId, exactModel, role, null);
      }
      setOpenCodeThinkingStateForRole(role, buildDefaultOpenCodeThinkingState(
        "metadata-error",
        exactModel
      ));
      syncToDeps();
      void postPanelState();
    });
  };
  refreshRoleThinking("main", roleModels.main);
  refreshRoleThinking("subtask", roleModels.subtask);
}

function getOpenCodeVariantForRun(
  cli: CliName,
  model: string | null | undefined,
  configId: string | null,
  configContent: string | null | undefined,
  role: OpenCodeModelRoleInput = "main"
): string | null {
  const normalizedRole = normalizeOpenCodeModelRole(role);
  if (cli !== "opencode" || !configId) {
    return null;
  }
  const resolution = resolveOpenCodeModelForConfig(model, configContent);
  const exactModel = resolution.error ? null : resolution.model;
  if (!exactModel || exactModel !== openCodeThinkingExactModels[normalizedRole] || configId !== openCodeThinkingConfigId) {
    return null;
  }
  const state = getOpenCodeThinkingStateForRole(normalizedRole);
  const variant = getOpenCodeRoleVariantFromStore(modelStore, configId, exactModel, normalizedRole);
  return variant && state.options.some((option) => option.value === variant)
    ? variant
    : null;
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

function getGlobalMultiAgentEnabled(): boolean {
  return resolveGlobalMultiAgentEnabled(readToolSettings(), workspaceSettings);
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
  startCodeGraphWorkspaceSetup(workspaceRoot);
  void vscode.window.showInformationMessage(t("workspaceHarness.initStarted"));
  void maybePromptInitializeArchitectureWithAi(workspaceRoot);
  return true;
}

function startCodeGraphWorkspaceSetup(workspaceRoot: string): void {
  const terminal = createCodeGraphTerminal(WORKSPACE_HARNESS_TERMINAL_NAME, workspaceRoot);
  terminal.show();
  terminal.sendText(CODEGRAPH_SETUP_COMMAND);
  void logInfo("workspace-harness-codegraph-setup-triggered", {
    workspace: workspaceRoot,
    command: CODEGRAPH_SETUP_COMMAND,
  });
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

async function installCodeGraphForWorkspace(): Promise<void> {
  const workspaceRoot = resolveWorkspaceCwd();
  const initializeWorkspace = Boolean(workspaceRoot);
  const installCommand = getCodeGraphInstallCommand({ initializeWorkspace });
  const confirmLabel = t("codegraph.installAction");
  const confirmMessage = workspaceRoot
    ? t("codegraph.installConfirm", { workspace: workspaceRoot, command: installCommand })
    : t("codegraph.installConfirmNoWorkspace", { command: installCommand });
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
  void logInfo("codegraph-install-triggered", {
    workspace: workspaceRoot ?? null,
    command: installCommand,
    initializeWorkspace,
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
    normalizeToolSettingsLocale,
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
  const snapshot = deps.getConfigHeartbeatSnapshot();
  if (snapshot && snapshot.cli === cli && snapshot.activeConfigId) {
    return snapshot.activeConfigId;
  }
  return deps.getWorkspacePreferredConfigIdForCli(cli);
}

function getSelectedCliModel(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  return getSelectedCliModelFromStore(modelStore, cli, configId);
}

function getSelectedLoopCliModel(
  cli: CliName,
  role: "main" | "subtask",
  configId: string | null = getActiveConfigIdForCli(cli),
): string | null {
  return getSelectedLoopCliModelFromStore(modelStore, cli, role, configId);
}

function getSelectedLoopThinkingMode(
  cli: CliName,
  role: "main" | "subtask",
  model: string | null | undefined,
  configId: string | null = getActiveConfigIdForCli(cli),
): ThinkingMode | null {
  return getSelectedLoopThinkingModeFromStore(modelStore, cli, role, model, configId);
}

function getManagedModelOptionsForCli(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string[] {
  return getManagedModelOptionsForCliFromStore(modelStore, cli, configId);
}

function getModelOptionsForCli(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string[] {
  return getModelOptionsForCliFromStore(modelStore, cli, configId);
}

function selectCliModel(cli: CliName, model: string | null, configId: string | null = getActiveConfigIdForCli(cli)): void {
  modelStore = selectCliModelInStore(modelStore, cli, model, configId);
  writeModelStore(modelStore);
}

function selectCliLoopModel(
  cli: CliName,
  role: "main" | "subtask",
  model: string | null,
  configId: string | null = getActiveConfigIdForCli(cli),
): void {
  modelStore = selectCliLoopModelInStore(modelStore, cli, role, model, configId);
  writeModelStore(modelStore);
}

function setSelectedLoopThinkingMode(
  cli: CliName,
  role: "main" | "subtask",
  model: string | null | undefined,
  thinkingMode: ThinkingMode | null,
  configId: string | null = getActiveConfigIdForCli(cli),
): void {
  const normalizedThinkingMode = thinkingMode ? normalizeThinkingModeForCli(cli, thinkingMode) : null;
  modelStore = setSelectedLoopThinkingModeInStore(modelStore, cli, role, model, normalizedThinkingMode, configId);
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

function getEffectiveCliArgs(cli: CliName, model: string | null = getSelectedCliModel(cli)): string[] {
  return getEffectiveCliArgsFromStore(cli, model);
}

function buildModelState(
  activeConfigIdByCli: Partial<Record<CliName, string | null>> = {}
): PanelState["modelState"] {
  return buildModelSelectionState(modelStore, getActiveConfigIdForCli, activeConfigIdByCli);
}

function loadWorkspaceSettings(): WorkspaceSettings {
  return loadWorkspaceSettingsFromStore(getWorkspaceSettingsStoreOptions());
}

function saveWorkspaceSettings(next: WorkspaceSettings): void {
  saveWorkspaceSettingsToStore(next, getWorkspaceSettingsStoreOptions());
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
  getGlobalMultiAgentEnabled: wrap(getGlobalMultiAgentEnabled),
  getGlobalHumanInteractionEnabled: wrap(getGlobalHumanInteractionEnabled),
  shouldRequireExplicitFinalAnswerForRun: wrap(shouldRequireExplicitFinalAnswerForRun),
  buildLongTermMemoryRuntimeSettings: wrap(buildLongTermMemoryRuntimeSettings),
  getLongTermMemoryDisabledReason: wrap(getLongTermMemoryDisabledReason),
  getEffectiveLongTermMemoryEnabled: wrap(getEffectiveLongTermMemoryEnabled),
  getActiveWorkspaceMemoryPaths: wrap(getActiveWorkspaceMemoryPaths),
  ensureActiveWorkspaceHarnessScaffold: wrap(ensureActiveWorkspaceHarnessScaffold),
  confirmAndInitializeWorkspaceHarness: wrap(confirmAndInitializeWorkspaceHarness),
  startCodeGraphWorkspaceSetup: wrap(startCodeGraphWorkspaceSetup),
  createCodeGraphTerminal: wrap(createCodeGraphTerminal),
  installCodeGraphForWorkspace: wrap(installCodeGraphForWorkspace),
  buildArchitectureInitializationModelPrompt: wrap(buildArchitectureInitializationModelPrompt),
  maybePromptInitializeArchitectureWithAi: wrap(maybePromptInitializeArchitectureWithAi),
  getGlobalAutoCompactContextAfterRun: wrap(getGlobalAutoCompactContextAfterRun),
  normalizeLoopMaxRounds: wrap(normalizeLoopMaxRounds),
  normalizeStoredLoopMaxRounds: wrap(normalizeStoredLoopMaxRounds),
  parseLoopMaxRoundsValue: wrap(parseLoopMaxRoundsValue),
  getGlobalLoopMaxRounds: wrap(getGlobalLoopMaxRounds),
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
  getSelectedCliModel: wrap(getSelectedCliModel),
  getSelectedLoopCliModel: wrap(getSelectedLoopCliModel),
  getSelectedLoopThinkingMode: wrap(getSelectedLoopThinkingMode),
  getManagedModelOptionsForCli: wrap(getManagedModelOptionsForCli),
  getModelOptionsForCli: wrap(getModelOptionsForCli),
  selectCliModel: wrap(selectCliModel),
  selectCliLoopModel: wrap(selectCliLoopModel),
  setSelectedLoopThinkingMode: wrap(setSelectedLoopThinkingMode),
  updateOpenCodeRoleModelForConfig: wrap(updateOpenCodeRoleModelForConfig),
  addCliModel: wrap(addCliModel),
  renameCliModel: wrap(renameCliModel),
  deleteCliModel: wrap(deleteCliModel),
  moveCliModel: wrap(moveCliModel),
  getEffectiveCliArgs: wrap(getEffectiveCliArgs),
  buildModelState: wrap(buildModelState),
  loadWorkspaceSettings: wrap(loadWorkspaceSettings),
  saveWorkspaceSettings: wrap(saveWorkspaceSettings),
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
