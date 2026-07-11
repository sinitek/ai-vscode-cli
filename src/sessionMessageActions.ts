import { supportsCliManagedModelSelection } from "./cli/modelArgs";
import { normalizeLobsterExecutionMode } from "./cli/types";
import { getDebugLogging } from "./cli/config";
import { logInfo, setDebugLogging } from "./logger";
import { PanelMessage } from "./webview/types";
import {
  type PanelMessageHandlerDeps,
  type PromptRunInputForPanel,
} from "./sessionMessageHandlers";

export async function handleUpdateOpenCodeVariantMessage(
  message: Extract<PanelMessage, { type: "updateOpenCodeVariant" }>,
  deps: {
    updateOpenCodeVariant: (role: "primary" | "small", value: string | null) => void;
    postPanelState: () => Promise<void>;
  }
): Promise<void> {
  const value = typeof message.value === "string" && message.value.trim()
    ? message.value.trim()
    : null;
  const role = message.role === "small" ? "small" : "primary";
  deps.updateOpenCodeVariant(role, value);
  await deps.postPanelState();
}

export async function handleUpdateSettingMessage(
  message: Extract<PanelMessage, { type: "updateSetting" }>,
  deps: PanelMessageHandlerDeps
): Promise<void> {
  const currentCli = deps.getCurrentCli();
  const workspaceSettings = deps.getWorkspaceSettings();

  if (message.key === "thinkingMode") {
    if (deps.isThinkingMode(message.value)) {
      const normalizedThinkingMode = deps.normalizeThinkingModeForCli(currentCli, message.value);
      workspaceSettings.thinkingMode = normalizedThinkingMode;
      deps.saveWorkspaceSettings(workspaceSettings);
      deps.setCliModelThinkingMode(currentCli, deps.getSelectedCliModel(currentCli) ?? "", normalizedThinkingMode);
    }
    await deps.postPanelState();
    return;
  }
  if (message.key.startsWith("interactiveMode.")) {
    const cliValue = message.key.slice("interactiveMode.".length);
    if (deps.isCliName(cliValue) && deps.isInteractiveMode(message.value)) {
      deps.setWorkspaceInteractiveModeForCli(cliValue, message.value);
    }
    await deps.postPanelState();
    return;
  }
  if (message.key.startsWith("lobsterExecutionMode.")) {
    const cliValue = message.key.slice("lobsterExecutionMode.".length);
    if (deps.isCliName(cliValue)) {
      deps.setWorkspaceLobsterExecutionModeForCli(cliValue, normalizeLobsterExecutionMode(message.value));
    }
    await deps.postPanelState();
    return;
  }
  if (message.key.startsWith("selectedModel.")) {
    const cliValue = message.key.slice("selectedModel.".length);
    if (deps.isCliName(cliValue)) {
      const modelValue = typeof message.value === "string" ? message.value : null;
      deps.selectCliModel(cliValue, modelValue, deps.getActiveConfigIdForCli(cliValue));
      deps.loadModelStore();
    }
    await deps.postPanelState();
    return;
  }
  if (message.key === "codexMultiAgentEnabled") {
    workspaceSettings.codexMultiAgentEnabled = Boolean(message.value);
    deps.saveWorkspaceSettings(workspaceSettings);
    await deps.postPanelState();
    return;
  }
  if (message.key === "autoCompactContextAfterRun" || message.key === "autoCompactContextBeforeRun") {
    workspaceSettings.autoCompactContextAfterRun = Boolean(message.value);
    delete workspaceSettings.autoCompactContextBeforeRun;
    deps.saveWorkspaceSettings(workspaceSettings);
    await deps.postPanelState();
    return;
  }
  if (message.key === "lobsterMaxRounds") {
    deps.updateStoredToolSettings({ lobsterMaxRounds: deps.normalizeLobsterMaxRounds(message.value) });
    if ("lobsterMaxRounds" in workspaceSettings) {
      delete workspaceSettings.lobsterMaxRounds;
      deps.saveWorkspaceSettings(workspaceSettings);
    }
    await deps.postPanelState();
    return;
  }
  if (message.key === "lobsterAutoCloseSubtaskTabs") {
    deps.updateStoredToolSettings({ lobsterAutoCloseSubtaskTabs: Boolean(message.value) });
    if ("lobsterAutoCloseSubtaskTabs" in workspaceSettings) {
      delete workspaceSettings.lobsterAutoCloseSubtaskTabs;
      deps.saveWorkspaceSettings(workspaceSettings);
    }
    await deps.postPanelState();
    return;
  }
  if (message.key === "debug") {
    deps.updateStoredToolSettings({ debug: Boolean(message.value) });
    setDebugLogging(getDebugLogging());
    await deps.postPanelState();
    return;
  }
  if (message.key === "autoAddEditorContextTags") {
    deps.updateStoredToolSettings({ autoAddEditorContextTags: Boolean(message.value) });
    await deps.postPanelState();
    return;
  }
  if (message.key === "finalAnswerPolicy") {
    deps.updateStoredToolSettings({
      finalAnswerPolicy: deps.normalizeFinalAnswerPolicy(message.value),
    });
    await deps.postPanelState();
    return;
  }
  if (message.key === "workspaceMemoryEnabled" || message.key === "longTermMemoryEnabled") {
    workspaceSettings.workspaceMemoryEnabled = message.value === true;
    deps.saveWorkspaceSettings(workspaceSettings);
    await deps.postPanelState();
    return;
  }
  if (message.key === "locale") {
    const resolved = deps.normalizeToolSettingsLocale(message.value) ?? "auto";
    deps.updateStoredToolSettings({ locale: resolved });
    deps.updateStatusBar();
    deps.postWebviewMessage({ type: "reload" });
    deps.getConfigManagerPanel()?.reload();
    return;
  }
  if (message.key === "macTaskShell") {
    if (process.platform === "darwin" && deps.isMacTaskShell(message.value)) {
      deps.updateStoredToolSettings({ macTaskShell: message.value });
    }
    await deps.postPanelState();
    return;
  }
}

export async function handleSendPromptMessage(
  message: Extract<PanelMessage, { type: "sendPrompt" }>,
  deps: PanelMessageHandlerDeps
): Promise<void> {
  const trimmed = message.prompt.trim();
  if (!trimmed) {
    return;
  }

  const requestedTabId = typeof message.tabId === "string" && message.tabId
    ? message.tabId
    : null;
  const preserveActiveTab = Boolean(message.preserveActiveTab && requestedTabId);
  const requestedTab = requestedTabId ? deps.getConversationTabById(requestedTabId) : null;

  if (requestedTabId && requestedTab && !preserveActiveTab) {
    const switched = deps.setActiveConversationTab(requestedTabId);
    if (switched && deps.getCurrentCli() !== switched.cli) {
      deps.setCurrentCliValue(switched.cli);
      deps.updateStatusBar();
      const workspaceSettings = deps.getWorkspaceSettings();
      workspaceSettings.currentCli = deps.getCurrentCli();
      deps.saveWorkspaceSettings(workspaceSettings);
    }
  }

  const targetTab = requestedTab ?? deps.getActiveConversationTab();
  const currentCli = deps.getCurrentCli();
  const targetCli = targetTab?.cli
    ?? (deps.isCliName(message.cli ?? "") ? message.cli : currentCli)
    ?? currentCli;

  if (!preserveActiveTab && deps.getCurrentCli() !== targetCli) {
    deps.setCurrentCliValue(targetCli);
    deps.updateStatusBar();
    const workspaceSettings = deps.getWorkspaceSettings();
    workspaceSettings.currentCli = deps.getCurrentCli();
    deps.saveWorkspaceSettings(workspaceSettings);
  }

  const promptTargetTabId = targetTab?.id ?? requestedTabId ?? deps.getActiveConversationTabId();
  const lobsterSubtaskContext = deps.resolveLobsterSubtaskConversationContext(targetCli, promptTargetTabId);
  const isLobsterSubtaskContinuation = Boolean(lobsterSubtaskContext);
  const requestedInteractiveMode = deps.isInteractiveMode(message.interactiveMode)
    ? deps.normalizeVisibleInteractiveMode(message.interactiveMode)
    : undefined;
  const effectiveInteractiveMode = isLobsterSubtaskContinuation && requestedInteractiveMode === "lobster"
    ? "coding"
    : requestedInteractiveMode;

  if (deps.isInteractiveMode(effectiveInteractiveMode)) {
    deps.setWorkspaceInteractiveModeForCli(targetCli, effectiveInteractiveMode);
  }
  const lobsterExecutionMode = effectiveInteractiveMode === "lobster"
    ? normalizeLobsterExecutionMode(
        Object.prototype.hasOwnProperty.call(message, "lobsterExecutionMode")
          ? message.lobsterExecutionMode
          : deps.getWorkspaceLobsterExecutionMode(targetCli)
      )
    : undefined;
  const contextBuild = deps.buildPromptWithAutoContext(trimmed, message.contextOptions);
  const modelPromptWithMemory = deps.maybeInjectLongTermMemoryForPrompt(
    trimmed,
    contextBuild.modelPrompt,
    contextBuild.contextTags,
  );
  const imagePaths = targetCli === "codex"
    ? await deps.resolveCodexImagePathsForPrompt(trimmed)
    : [];
  const activeConfigId = deps.getActiveConfigIdForCli(targetCli);
  const lobsterMainModel = targetCli === "codex"
    ? (typeof message.lobsterMainModel === "string" && message.lobsterMainModel.trim()
        ? message.lobsterMainModel.trim()
        : (deps.getSelectedLobsterCliModel(targetCli, "main", activeConfigId) ?? undefined))
    : undefined;
  const lobsterSubtaskModel = targetCli === "codex"
    ? (typeof message.lobsterSubtaskModel === "string" && message.lobsterSubtaskModel.trim()
        ? message.lobsterSubtaskModel.trim()
        : (deps.getSelectedLobsterCliModel(targetCli, "subtask", activeConfigId) ?? undefined))
    : undefined;
  const promptInput: PromptRunInputForPanel = {
    displayPrompt: trimmed,
    modelPrompt: modelPromptWithMemory,
    contextTags: contextBuild.contextTags,
    model: targetCli === "codex" && typeof message.model === "string" && message.model
      ? message.model
      : undefined,
    lobsterMainModel,
    lobsterSubtaskModel,
    imagePaths: imagePaths.length ? imagePaths : undefined,
  };
  if (lobsterExecutionMode) {
    promptInput.lobsterExecutionMode = lobsterExecutionMode;
  }
  if (lobsterSubtaskContext) {
    promptInput.taskRole = "subtask";
    promptInput.lobsterTaskId = lobsterSubtaskContext.taskId;
    promptInput.lobsterRound = lobsterSubtaskContext.round;
    promptInput.lobsterSubtaskId = lobsterSubtaskContext.subtaskId;
  }
  const shouldRunLobster = effectiveInteractiveMode === "lobster";
  const lobsterResumeTask = shouldRunLobster
    ? deps.resolveLobsterResumeTaskFromPrompt(trimmed, promptTargetTabId)
    : null;
  const lobsterResumeRequested = shouldRunLobster && deps.isLobsterResumePrompt(trimmed);
  const previousSubtaskRunEndedAt = lobsterSubtaskContext
    ? (deps.getLatestLobsterRoundRunRecord(
        lobsterSubtaskContext.taskId,
        lobsterSubtaskContext.round,
        "subtask",
        lobsterSubtaskContext.subtaskId
      )?.endedAt ?? 0)
    : 0;
  if (isLobsterSubtaskContinuation && requestedInteractiveMode === "lobster") {
    void logInfo("lobster-subtask-manual-continue-forced-coding", {
      cli: targetCli,
      tabId: promptTargetTabId,
    });
  }
  deps.recordPromptHistory(trimmed, targetCli);
  await deps.postPanelState();
  const promptRunTarget = deps.resolvePromptRunTarget(promptTargetTabId);
  const preparedPromptInput = promptRunTarget
    ? deps.preloadUserMessageForPrompt(promptInput, promptRunTarget)
    : promptInput;
  if (shouldRunLobster) {
    await deps.runLobsterPrompt(preparedPromptInput, {
      targetTabId: promptTargetTabId,
      resumeTaskId: lobsterResumeTask?.id ?? null,
      resumeRequested: lobsterResumeRequested,
    });
  } else {
    await deps.runPrompt(preparedPromptInput, { targetTabId: promptTargetTabId });
    if (lobsterSubtaskContext && promptTargetTabId) {
      await deps.maybeWakeLobsterMainAfterSubtaskContinuation(lobsterSubtaskContext, {
        tabId: promptTargetTabId,
        previousRunEndedAt: previousSubtaskRunEndedAt,
        model: preparedPromptInput.model,
        lobsterMainModel: preparedPromptInput.lobsterMainModel,
        lobsterSubtaskModel: preparedPromptInput.lobsterSubtaskModel,
      });
    }
  }
}
