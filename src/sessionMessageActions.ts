import { supportsCliManagedModelSelection } from "./cli/modelArgs";
import { normalizeLoopExecutionMode } from "./cli/types";
import { getDebugLogging } from "./cli/config";
import { logInfo, setDebugLogging } from "./logger";
import { normalizeLoopSubtaskMaxThinkingMode } from "./loopSubtaskThinking";
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
  if (message.key.startsWith("loopExecutionMode.")) {
    const cliValue = message.key.slice("loopExecutionMode.".length);
    if (deps.isCliName(cliValue)) {
      deps.setWorkspaceLoopExecutionModeForCli(cliValue, normalizeLoopExecutionMode(message.value));
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
  if (message.key.startsWith("selectedLoopModel.")) {
    const [, cliValue, roleValue] = message.key.split(".");
    const cli = typeof cliValue === "string" && deps.isCliName(cliValue) ? cliValue : null;
    if (
      cli
      && (roleValue === "main" || roleValue === "subtask")
    ) {
      const modelValue = typeof message.value === "string" ? message.value : null;
      deps.selectCliLoopModel?.(cli, roleValue, modelValue, deps.getActiveConfigIdForCli(cli));
      deps.loadModelStore();
    }
    await deps.postPanelState();
    return;
  }
  if (message.key === "multiAgentEnabled" || message.key === "codexMultiAgentEnabled") {
    const savedGlobally = deps.updateStoredToolSettings({ multiAgentEnabled: Boolean(message.value) });
    if (savedGlobally
      && ("multiAgentEnabled" in workspaceSettings || "codexMultiAgentEnabled" in workspaceSettings)) {
      delete workspaceSettings.multiAgentEnabled;
      delete workspaceSettings.codexMultiAgentEnabled;
      deps.saveWorkspaceSettings(workspaceSettings);
    }
    await deps.postPanelState();
    return;
  }
  if (message.key === "autoCompactContextAfterRun" || message.key === "autoCompactContextBeforeRun") {
    const savedGlobally = deps.updateStoredToolSettings({
      autoCompactContextAfterRun: Boolean(message.value),
    });
    if (savedGlobally
      && ("autoCompactContextAfterRun" in workspaceSettings
        || "autoCompactContextBeforeRun" in workspaceSettings)) {
      delete workspaceSettings.autoCompactContextAfterRun;
      delete workspaceSettings.autoCompactContextBeforeRun;
      deps.saveWorkspaceSettings(workspaceSettings);
    }
    await deps.postPanelState();
    return;
  }
  if (message.key === "loopMaxRounds") {
    deps.updateStoredToolSettings({ loopMaxRounds: deps.normalizeLoopMaxRounds(message.value) });
    if ("loopMaxRounds" in workspaceSettings) {
      delete workspaceSettings.loopMaxRounds;
      deps.saveWorkspaceSettings(workspaceSettings);
    }
    await deps.postPanelState();
    return;
  }
  if (message.key === "loopSubtaskMaxThinkingMode") {
    const loopSubtaskMaxThinkingMode = normalizeLoopSubtaskMaxThinkingMode(message.value);
    if (loopSubtaskMaxThinkingMode) {
      deps.updateStoredToolSettings({ loopSubtaskMaxThinkingMode });
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

function normalizePromptModel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveCodexPromptModels(
  message: Extract<PanelMessage, { type: "sendPrompt" }>,
  targetCli: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>,
  configId: string | null,
  deps: PanelMessageHandlerDeps,
  options: { includeLoopModels: boolean; subtaskContinuation: boolean },
): { model?: string; loopMainModel?: string; loopSubtaskModel?: string } {
  if (targetCli !== "codex") {
    return {};
  }
  const explicitModel = normalizePromptModel(message.model);
  const selectedModel = deps.getSelectedCliModel(targetCli, configId) ?? undefined;
  const fallbackModel = explicitModel ?? selectedModel;
  if (!options.includeLoopModels) {
    return { model: explicitModel };
  }

  const loopMainModel = normalizePromptModel(message.loopMainModel)
    ?? normalizePromptModel(message.lobsterMainModel)
    ?? deps.getSelectedLoopCliModel?.(targetCli, "main", configId)
    ?? fallbackModel;
  const loopSubtaskModel = normalizePromptModel(message.loopSubtaskModel)
    ?? normalizePromptModel(message.lobsterSubtaskModel)
    ?? deps.getSelectedLoopCliModel?.(targetCli, "subtask", configId)
    ?? fallbackModel
    ?? loopMainModel;
  return {
    model: options.subtaskContinuation ? loopSubtaskModel : (loopMainModel ?? explicitModel),
    loopMainModel,
    loopSubtaskModel,
  };
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
  const loopSubtaskContext = deps.resolveLoopSubtaskConversationContext(targetCli, promptTargetTabId);
  const isLoopSubtaskContinuation = Boolean(loopSubtaskContext);
  const requestedInteractiveMode = deps.isInteractiveMode(message.interactiveMode)
    ? deps.normalizeVisibleInteractiveMode(message.interactiveMode)
    : undefined;
  const effectiveInteractiveMode = isLoopSubtaskContinuation && requestedInteractiveMode === "loop"
    ? "coding"
    : requestedInteractiveMode;

  if (deps.isInteractiveMode(effectiveInteractiveMode)) {
    deps.setWorkspaceInteractiveModeForCli(targetCli, effectiveInteractiveMode);
  }
  const loopExecutionMode = effectiveInteractiveMode === "loop"
    ? normalizeLoopExecutionMode(
        Object.prototype.hasOwnProperty.call(message, "loopExecutionMode")
          ? message.loopExecutionMode
          : deps.getWorkspaceLoopExecutionMode(targetCli)
      )
    : undefined;
  const contextBuild = deps.buildPromptWithAutoContext(trimmed, message.contextOptions);
  const shouldRunGraph = effectiveInteractiveMode === "graph";
  const modelPromptWithMemory = shouldRunGraph
    ? contextBuild.modelPrompt
    : deps.maybeInjectLongTermMemoryForPrompt(
        trimmed,
        contextBuild.modelPrompt,
        contextBuild.contextTags,
      );
  const imagePaths = targetCli === "codex"
    ? await deps.resolveCodexImagePathsForPrompt(trimmed)
    : [];
  const activeConfigId = deps.getActiveConfigIdForCli(targetCli);
  const shouldRunLoop = effectiveInteractiveMode === "loop";
  const includeLoopModels = shouldRunLoop || shouldRunGraph || isLoopSubtaskContinuation;
  const codexModels = resolveCodexPromptModels(message, targetCli, activeConfigId, deps, {
    includeLoopModels,
    subtaskContinuation: isLoopSubtaskContinuation && !shouldRunGraph,
  });
  const promptInput: PromptRunInputForPanel = {
    displayPrompt: trimmed,
    modelPrompt: modelPromptWithMemory,
    contextTags: contextBuild.contextTags,
    model: codexModels.model,
    imagePaths: imagePaths.length ? imagePaths : undefined,
  };
  if (codexModels.loopMainModel) {
    promptInput.loopMainModel = codexModels.loopMainModel;
  }
  if (codexModels.loopSubtaskModel) {
    promptInput.loopSubtaskModel = codexModels.loopSubtaskModel;
  }
  if (shouldRunGraph) {
    promptInput.skipLongTermMemoryPersist = true;
  }
  if (loopExecutionMode) {
    promptInput.loopExecutionMode = loopExecutionMode;
  }
  if (loopSubtaskContext && !shouldRunGraph) {
    promptInput.taskRole = "subtask";
    promptInput.loopTaskId = loopSubtaskContext.taskId;
    promptInput.loopRound = loopSubtaskContext.round;
    promptInput.loopSubtaskId = loopSubtaskContext.subtaskId;
  }
  const loopResumeTask = shouldRunLoop
    ? deps.resolveLoopResumeTaskFromPrompt(trimmed, promptTargetTabId)
    : null;
  const loopResumeRequested = shouldRunLoop && (
    Boolean(loopResumeTask)
    || deps.isLoopResumePrompt(trimmed)
  );
  const previousSubtaskRunEndedAt = loopSubtaskContext
    ? (deps.getLatestLoopRoundRunRecord(
        loopSubtaskContext.taskId,
        loopSubtaskContext.round,
        "subtask",
        loopSubtaskContext.subtaskId
      )?.endedAt ?? 0)
    : 0;
  if (isLoopSubtaskContinuation && requestedInteractiveMode === "loop") {
    void logInfo("loop-subtask-manual-continue-forced-coding", {
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
  if (shouldRunLoop) {
    await deps.runLoopPrompt(preparedPromptInput, {
      targetTabId: promptTargetTabId,
      resumeTaskId: loopResumeTask?.id ?? null,
      resumeRequested: loopResumeRequested,
    });
  } else if (shouldRunGraph) {
    if (!deps.runGraphPrompt) {
      throw new Error("Graph prompt runner is not available.");
    }
    await deps.runGraphPrompt(preparedPromptInput, { targetTabId: promptTargetTabId });
  } else {
    await deps.runPrompt(preparedPromptInput, { targetTabId: promptTargetTabId });
    if (loopSubtaskContext && promptTargetTabId) {
      await deps.maybeWakeLoopMainAfterSubtaskContinuation(loopSubtaskContext, {
        tabId: promptTargetTabId,
        previousRunEndedAt: previousSubtaskRunEndedAt,
        model: preparedPromptInput.loopMainModel ?? preparedPromptInput.model,
        loopMainModel: preparedPromptInput.loopMainModel,
        loopSubtaskModel: preparedPromptInput.loopSubtaskModel,
      });
    }
  }
}
