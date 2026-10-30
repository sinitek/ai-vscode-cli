import { supportsCliManagedModelSelection } from "./cli/modelArgs";
import { normalizeLoopExecutionMode, type CliName, type ThinkingMode } from "./cli/types";
import { schedulingModeForInteractiveMode } from "./extensionHost/modelSettings";
import { getDebugLogging } from "./cli/config";
import { logInfo, setDebugLogging } from "./logger";
import { resolveLoopPlusDecisionSubtaskMax, resolveLoopPlusMaxAcceptances } from "./loopPlusDecision";
import { normalizeLoopPlusAcceptancePlanSnapshot } from "./loopPlusAcceptancePlan";
import { normalizeLoopSubtaskMaxThinkingMode } from "./loopSubtaskThinking";
import {
  normalizeHistoryRetentionDays,
  resolveHumanInteractionTimeoutMinutes,
  resolveNextEnabledCli,
  type CliEnabledByName,
} from "./toolSettings";
import { PanelMessage } from "./webview/types";
import {
  parseCliName,
  parseCliNameField,
  resolveSubtaskRouteConfigId,
  SUBTASK_ROUTE_CONFIG_MAX_RETRIES,
} from "./subtaskCliRoute";
import {
  type PanelMessageHandlerDeps,
  type PromptRunInputForPanel,
} from "./sessionMessageHandlers";

export async function handleUpdateOpenCodeVariantMessage(
  message: Extract<PanelMessage, { type: "updateOpenCodeVariant" }>,
  deps: {
    updateOpenCodeVariant: (role: "primary" | "small", value: string | null) => void;
    updateOpenCodeVariantForConfig?: (
      role: "primary" | "small",
      value: string | null,
      configId: string,
      model: string,
    ) => void;
    postPanelState: () => Promise<void>;
  }
): Promise<void> {
  const value = typeof message.value === "string" && message.value.trim()
    ? message.value.trim()
    : null;
  const role = message.role === "small" ? "small" : "primary";
  const configId = typeof message.configId === "string" ? message.configId.trim() : "";
  const model = typeof message.model === "string" ? message.model.trim() : "";
  if (configId && model && deps.updateOpenCodeVariantForConfig) {
    deps.updateOpenCodeVariantForConfig(role, value, configId, model);
  } else {
    deps.updateOpenCodeVariant(role, value);
  }
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
  if (message.key.startsWith("selectedLoopThinkingMode.")) {
    const [, cliValue, roleValue] = message.key.split(".");
    const cli = typeof cliValue === "string" && deps.isCliName(cliValue) ? cliValue : null;
    if (
      (cli === "codex" || cli === "grok" || cli === "claude" || cli === "dsh" || cli === "kimi-code")
      && (roleValue === "main" || roleValue === "subtask")
    ) {
      const configId = deps.getActiveConfigIdForCli(cli);
      const roleModel = deps.getSelectedLoopCliModel?.(cli, roleValue, configId)
        ?? deps.getSelectedCliModel(cli, configId);
      const thinkingMode = deps.isThinkingMode(message.value)
        ? deps.normalizeThinkingModeForCli(cli, message.value)
        : null;
      deps.setSelectedLoopThinkingMode?.(cli, roleValue, roleModel, thinkingMode, configId);
      deps.loadModelStore();
    }
    await deps.postPanelState();
    return;
  }
  if (message.key === "humanInteractionEnabled") {
    deps.updateStoredToolSettings({ humanInteractionEnabled: Boolean(message.value) });
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
  if (message.key === "loopPlusDecisionSubtaskMax") {
    deps.updateStoredToolSettings({
      loopPlusDecisionSubtaskMax: resolveLoopPlusDecisionSubtaskMax(message.value),
    });
    await deps.postPanelState();
    return;
  }
  if (message.key === "loopPlusMaxAcceptances") {
    deps.updateStoredToolSettings({
      loopPlusMaxAcceptances: resolveLoopPlusMaxAcceptances(message.value),
    });
    await deps.postPanelState();
    return;
  }
  if (message.key === "humanInteractionTimeoutMinutes") {
    deps.updateStoredToolSettings({
      humanInteractionTimeoutMinutes: resolveHumanInteractionTimeoutMinutes(message.value),
    });
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
  if (message.key === "historyRetentionDays") {
    deps.updateStoredToolSettings({ historyRetentionDays: normalizeHistoryRetentionDays(message.value) });
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
  if (message.key === "macTaskShell") {
    if (process.platform === "darwin" && deps.isMacTaskShell(message.value)) {
      deps.updateStoredToolSettings({ macTaskShell: message.value });
    }
    await deps.postPanelState();
    return;
  }
  if (message.key.startsWith("cliEnabled.")) {
    const cliValue = message.key.slice("cliEnabled.".length);
    if (!deps.isCliName(cliValue) || typeof message.value !== "boolean") {
      await deps.postPanelState();
      return;
    }
    const currentSettings = deps.readStoredToolSettings?.() ?? {};
    const nextMap: CliEnabledByName = {};
    const previous = currentSettings.cliEnabledByName;
    if (previous && typeof previous === "object") {
      for (const [key, value] of Object.entries(previous)) {
        if (deps.isCliName(key) && typeof value === "boolean") {
          nextMap[key] = value;
        }
      }
    }
    nextMap[cliValue] = message.value;
    const saved = deps.updateStoredToolSettings({ cliEnabledByName: nextMap });
    if (saved) {
      const nextCli = resolveNextEnabledCli(deps.getCurrentCli(), { cliEnabledByName: nextMap });
      if (nextCli && nextCli !== deps.getCurrentCli()) {
        await deps.setCurrentCli(nextCli);
      }
      deps.retargetDisabledLoopSubtaskSelections?.(nextCli);
      deps.publishCliEnabled?.(nextMap);
    }
    await deps.postPanelState();
    return;
  }
}

function normalizePromptModel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePromptThinkingMode(
  value: unknown,
  targetCli: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>,
  deps: PanelMessageHandlerDeps
): ThinkingMode | undefined {
  if (typeof deps.isThinkingMode !== "function" || typeof deps.normalizeThinkingModeForCli !== "function") {
    return undefined;
  }
  return deps.isThinkingMode(value)
    ? deps.normalizeThinkingModeForCli(targetCli, value)
    : undefined;
}

function supportsMainSubtaskPromptModels(
  targetCli: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>,
): boolean {
  return targetCli === "codex" || targetCli === "opencode" || targetCli === "grok" || targetCli === "dsh"
    || targetCli === "kimi-code";
}

function resolvePromptRoleModels(
  message: Extract<PanelMessage, { type: "sendPrompt" }>,
  targetCli: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>,
  configId: string | null,
  deps: PanelMessageHandlerDeps,
  options: {
    includeLoopModels: boolean;
    subtaskContinuation: boolean;
  },
): {
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopSubtaskCli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
  loopSubtaskConfigId?: string;
} {
  const subtaskCli = parseCliName(message.loopSubtaskCli);
  const crossCli = Boolean(subtaskCli && subtaskCli !== targetCli);
  const subtaskConfigId = typeof message.loopSubtaskConfigId === "string" && message.loopSubtaskConfigId.trim()
    ? message.loopSubtaskConfigId.trim()
    : undefined;
  if (!supportsMainSubtaskPromptModels(targetCli) && !crossCli && !subtaskCli) {
    return {};
  }
  const explicitModel = normalizePromptModel(message.model);
  const selectedModel = supportsMainSubtaskPromptModels(targetCli)
    ? deps.getSelectedCliModel(targetCli, configId) ?? undefined
    : undefined;
  const fallbackModel = explicitModel ?? selectedModel;
  if (!options.includeLoopModels) {
    return {
      ...(explicitModel ? { model: explicitModel } : {}),
      ...(crossCli && subtaskCli ? { loopSubtaskCli: subtaskCli } : {}),
      ...(subtaskConfigId ? { loopSubtaskConfigId: subtaskConfigId } : {}),
    };
  }

  const loopMainModel = supportsMainSubtaskPromptModels(targetCli)
      ? normalizePromptModel(message.loopMainModel)
        ?? normalizePromptModel(message.lobsterMainModel)
        ?? deps.getSelectedLoopCliModel?.(targetCli, "main", configId)
        ?? fallbackModel
    : normalizePromptModel(message.loopMainModel) ?? explicitModel;
  const subtaskLookupCli = crossCli && subtaskCli ? subtaskCli : targetCli;
  const subtaskLookupConfigId = crossCli ? (subtaskConfigId ?? null) : configId;
  const loopSubtaskModel = normalizePromptModel(message.loopSubtaskModel)
    ?? normalizePromptModel(message.lobsterSubtaskModel)
    ?? (crossCli
      ? deps.getSelectedLoopCliModel?.(subtaskLookupCli, "subtask", subtaskLookupConfigId)
        ?? deps.getSelectedCliModel(subtaskLookupCli, subtaskLookupConfigId)
        ?? undefined
      : deps.getSelectedLoopCliModel?.(targetCli, "subtask", configId)
        ?? fallbackModel
        ?? loopMainModel);
  return {
    model: options.subtaskContinuation ? loopSubtaskModel : (loopMainModel ?? explicitModel),
    ...(loopMainModel ? { loopMainModel } : {}),
    ...(loopSubtaskModel ? { loopSubtaskModel } : {}),
    ...(crossCli && subtaskCli ? { loopSubtaskCli: subtaskCli } : {}),
    ...(subtaskConfigId ? { loopSubtaskConfigId: subtaskConfigId } : {}),
  };
}

function resolvePromptRoleThinkingModes(
  message: Extract<PanelMessage, { type: "sendPrompt" }>,
  targetCli: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>,
  configId: string | null,
  deps: PanelMessageHandlerDeps,
  options: { includeLoopModels: boolean },
  promptModels: {
    model?: string;
    loopMainModel?: string;
    loopSubtaskModel?: string;
    loopSubtaskCli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
    loopSubtaskConfigId?: string;
  }
): { loopMainThinkingMode?: ThinkingMode; loopSubtaskThinkingMode?: ThinkingMode } {
  const thinkingSubtaskCli = promptModels.loopSubtaskCli ?? targetCli;
  const includeSubtaskThinking = thinkingSubtaskCli === "codex"
    || thinkingSubtaskCli === "grok"
    || thinkingSubtaskCli === "claude"
    || thinkingSubtaskCli === "dsh"
    || thinkingSubtaskCli === "kimi-code";
  if ((!supportsMainSubtaskPromptModels(targetCli) && !includeSubtaskThinking) || !options.includeLoopModels) {
    return {};
  }
  const mainModel = promptModels.loopMainModel ?? promptModels.model ?? deps.getSelectedCliModel(targetCli, configId);
  const subtaskModel = promptModels.loopSubtaskCli
    ? promptModels.loopSubtaskModel
    : promptModels.loopSubtaskModel ?? promptModels.model ?? mainModel;
  const loopMainThinkingMode = (targetCli === "codex" || targetCli === "grok" || targetCli === "dsh" || targetCli === "kimi-code")
    ? normalizePromptThinkingMode(message.loopMainThinkingMode, targetCli, deps)
      ?? deps.getSelectedLoopThinkingMode?.(targetCli, "main", mainModel, configId)
      ?? undefined
    : undefined;
  const subtaskThinkingConfigId = promptModels.loopSubtaskConfigId ?? (promptModels.loopSubtaskCli ? null : configId);
  const loopSubtaskThinkingMode = includeSubtaskThinking
    ? normalizePromptThinkingMode(message.loopSubtaskThinkingMode, thinkingSubtaskCli, deps)
      ?? deps.getSelectedLoopThinkingMode?.(thinkingSubtaskCli, "subtask", subtaskModel, subtaskThinkingConfigId)
      ?? undefined
    : undefined;
  return {
    ...(loopMainThinkingMode ? { loopMainThinkingMode } : {}),
    ...(loopSubtaskThinkingMode ? { loopSubtaskThinkingMode } : {}),
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
  const requestedInteractiveMode = deps.isInteractiveMode(message.interactiveMode)
    ? deps.normalizeVisibleInteractiveMode(message.interactiveMode)
    : undefined;
  const requestedLoopFamily = requestedInteractiveMode === "loop" || requestedInteractiveMode === "loop_plus";
  const requestedSubtaskRouteMode = requestedLoopFamily || requestedInteractiveMode === "graph";

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
  const cliEnabledSettings = deps.readStoredToolSettings?.() ?? {};
  const cliExplicitlyDisabled = (cli: string | null | undefined): boolean => (
    typeof cli === "string" && cliEnabledSettings.cliEnabledByName?.[cli as CliName] === false
  );
  if (cliExplicitlyDisabled(targetCli)) {
    deps.showWebviewError?.("CLI", "该 CLI 已关闭，不能作为新的执行目标。");
    return;
  }

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
  const effectiveInteractiveMode = isLoopSubtaskContinuation && requestedLoopFamily
    ? "coding"
    : requestedInteractiveMode;
  const requiresSubtaskRoute = requestedSubtaskRouteMode || isLoopSubtaskContinuation;
  const parsedSubtaskCli = requiresSubtaskRoute
    ? parseCliNameField(message.loopSubtaskCli)
    : { ok: true as const };
  if (!parsedSubtaskCli.ok) {
    deps.showWebviewError("子任务路由", "子模型 CLI 分组无效，不能派发子任务。");
    return;
  }
  const requestedSubtaskCli = parsedSubtaskCli.cli;
  if (requestedSubtaskCli && cliExplicitlyDisabled(requestedSubtaskCli)) {
    deps.showWebviewError?.("子任务路由", "目标 CLI 已关闭，不能派发子任务。");
    return;
  }
  let promptMessage = message;
  if (!requiresSubtaskRoute) {
    const {
      loopSubtaskCli: _loopSubtaskCli,
      loopSubtaskConfigId: _loopSubtaskConfigId,
      loopSubtaskModel: _loopSubtaskModel,
      loopSubtaskThinkingMode: _loopSubtaskThinkingMode,
      lobsterSubtaskModel: _lobsterSubtaskModel,
      ...messageWithoutSubtaskRoute
    } = message;
    promptMessage = messageWithoutSubtaskRoute;
  }

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
  const configReady = deps.waitForConfigApply
    ? await deps.waitForConfigApply(targetCli)
    : true;
  if (!configReady) {
    return;
  }
  if (requestedSubtaskCli && requestedSubtaskCli !== targetCli) {
    const resolvedConfigId = await resolveSubtaskRouteConfigId({
      cli: requestedSubtaskCli,
      configId: message.loopSubtaskConfigId,
      getActiveConfigId: (cli) => deps.getActiveConfigIdForCli(cli),
      waitForConfigApply: deps.waitForConfigApply,
      refreshPanelState: () => deps.postPanelState(),
      delay: deps.waitForConfigRetryDelay,
    });
    if (!resolvedConfigId) {
      deps.showWebviewError(
        "子任务路由",
        `目标 CLI 配置同步失败（已重试 ${SUBTASK_ROUTE_CONFIG_MAX_RETRIES} 次），暂不能派发子任务；请确认配置可用后重试。`,
      );
      return;
    }
    promptMessage = { ...message, loopSubtaskConfigId: resolvedConfigId };
  }
  const activeConfigId = deps.getActiveConfigIdForCli(targetCli);
  const loopPlusSchedulingMode = schedulingModeForInteractiveMode(effectiveInteractiveMode);
  const shouldRunLoop = effectiveInteractiveMode === "loop" || loopPlusSchedulingMode === "event_driven";
  const includeLoopModels = shouldRunLoop || shouldRunGraph || isLoopSubtaskContinuation;
  const promptModels = resolvePromptRoleModels(promptMessage, targetCli, activeConfigId, deps, {
    includeLoopModels,
    subtaskContinuation: isLoopSubtaskContinuation && !shouldRunGraph,
  });
  const promptThinkingModes = resolvePromptRoleThinkingModes(promptMessage, targetCli, activeConfigId, deps, {
    includeLoopModels,
  }, promptModels);
  const promptInput: PromptRunInputForPanel = {
    displayPrompt: trimmed,
    modelPrompt: modelPromptWithMemory,
    contextTags: contextBuild.contextTags,
    model: promptModels.model,
    imagePaths: imagePaths.length ? imagePaths : undefined,
  };
  if (promptModels.loopMainModel) {
    promptInput.loopMainModel = promptModels.loopMainModel;
  }
  if (promptModels.loopSubtaskModel) {
    promptInput.loopSubtaskModel = promptModels.loopSubtaskModel;
  }
  if (promptModels.loopSubtaskCli) {
    promptInput.loopSubtaskCli = promptModels.loopSubtaskCli;
  }
  if (promptModels.loopSubtaskConfigId) {
    promptInput.loopSubtaskConfigId = promptModels.loopSubtaskConfigId;
  }
  if (promptThinkingModes.loopMainThinkingMode) {
    promptInput.loopMainThinkingMode = promptThinkingModes.loopMainThinkingMode;
  }
  if (promptThinkingModes.loopSubtaskThinkingMode) {
    promptInput.loopSubtaskThinkingMode = promptThinkingModes.loopSubtaskThinkingMode;
  }
  if (shouldRunGraph) {
    promptInput.skipLongTermMemoryPersist = true;
  }
  if (loopExecutionMode) {
    promptInput.loopExecutionMode = loopExecutionMode;
  }
  if (loopPlusSchedulingMode === "event_driven" && message.loopPlusAcceptancePlan) {
    promptInput.loopPlusAcceptancePlan = normalizeLoopPlusAcceptancePlanSnapshot(
      message.loopPlusAcceptancePlan,
    );
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
  if (isLoopSubtaskContinuation && requestedLoopFamily) {
    void logInfo("loop-subtask-manual-continue-forced-coding", {
      cli: targetCli,
      tabId: promptTargetTabId,
    });
  }
  if (message.skipPromptHistory !== true) {
    deps.recordPromptHistory(trimmed, targetCli);
  }
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
      ...(loopPlusSchedulingMode ? { schedulingMode: loopPlusSchedulingMode } : {}),
    });
  } else if (shouldRunGraph) {
    if (!deps.runGraphPrompt) {
      throw new Error("Graph prompt runner is not available.");
    }
    await deps.runGraphPrompt(preparedPromptInput, { targetTabId: promptTargetTabId });
  } else {
    await deps.runPrompt(preparedPromptInput, { targetTabId: promptTargetTabId });
    if (loopSubtaskContext && promptTargetTabId) {
      const wakeOptions = {
        tabId: promptTargetTabId,
        previousRunEndedAt: previousSubtaskRunEndedAt,
        model: preparedPromptInput.loopMainModel ?? preparedPromptInput.model,
        loopMainModel: preparedPromptInput.loopMainModel,
        loopSubtaskModel: preparedPromptInput.loopSubtaskModel,
        ...(preparedPromptInput.loopSubtaskCli ? { loopSubtaskCli: preparedPromptInput.loopSubtaskCli } : {}),
        ...(preparedPromptInput.loopSubtaskConfigId ? { loopSubtaskConfigId: preparedPromptInput.loopSubtaskConfigId } : {}),
        ...(preparedPromptInput.loopMainThinkingMode ? { loopMainThinkingMode: preparedPromptInput.loopMainThinkingMode } : {}),
        ...(preparedPromptInput.loopSubtaskThinkingMode ? { loopSubtaskThinkingMode: preparedPromptInput.loopSubtaskThinkingMode } : {}),
      };
      await deps.maybeWakeLoopMainAfterSubtaskContinuation(loopSubtaskContext, wakeOptions);
    }
  }
}
