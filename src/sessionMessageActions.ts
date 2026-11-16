
import { type CliName, type ThinkingMode } from "./cli/types";
import { schedulingModeForInteractiveMode } from "./extensionHost/modelSettings";
import { logError, logInfo } from "./logger";
import { assertModeAvailable, resolveModeAvailability } from "./modeAvailability";
import { normalizeLoopPlusAcceptancePlanSnapshot } from "./loopPlusAcceptancePlan";
import { routeSettingMessage } from "./settingMessageRouter";
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
  await routeSettingMessage(message, deps);
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
    || targetCli === "kimi-code" || targetCli === "zcode";
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
  loopSubtaskFrontendCli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
  loopSubtaskFrontendConfigId?: string;
  loopSubtaskFrontendModel?: string;
  loopSubtaskFullstackCli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
  loopSubtaskFullstackConfigId?: string;
  loopSubtaskFullstackModel?: string;
  loopSubtaskMode?: "fullstack" | "split";
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
    ...readFrontendPromptRoute(message),
    ...readFullstackPromptRoute(message),
  };
}

function readRoleRouteFields(
  cliValue: unknown,
  configValue: unknown,
  modelValue: unknown,
): { cli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>; configId?: string; model?: string } {
  const cli = parseCliName(cliValue);
  const configId = typeof configValue === "string" && configValue.trim() ? configValue.trim() : undefined;
  const model = normalizePromptModel(modelValue);
  return {
    ...(cli ? { cli } : {}),
    ...(configId ? { configId } : {}),
    ...(model ? { model } : {}),
  };
}

function readFrontendPromptRoute(
  message: Extract<PanelMessage, { type: "sendPrompt" }>,
): {
  loopSubtaskFrontendCli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
  loopSubtaskFrontendConfigId?: string;
  loopSubtaskFrontendModel?: string;
} {
  const route = readRoleRouteFields(message.loopSubtaskFrontendCli, message.loopSubtaskFrontendConfigId, message.loopSubtaskFrontendModel);
  return {
    ...(route.cli ? { loopSubtaskFrontendCli: route.cli } : {}),
    ...(route.configId ? { loopSubtaskFrontendConfigId: route.configId } : {}),
    ...(route.model ? { loopSubtaskFrontendModel: route.model } : {}),
  };
}

function readFullstackPromptRoute(
  message: Extract<PanelMessage, { type: "sendPrompt" }>,
): {
  loopSubtaskFullstackCli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
  loopSubtaskFullstackConfigId?: string;
  loopSubtaskFullstackModel?: string;
  loopSubtaskMode?: "fullstack" | "split";
} {
  const route = readRoleRouteFields(message.loopSubtaskFullstackCli, message.loopSubtaskFullstackConfigId, message.loopSubtaskFullstackModel);
  const mode = message.loopSubtaskMode === "split" || message.loopSubtaskMode === "fullstack"
    ? message.loopSubtaskMode
    : undefined;
  return {
    ...(route.cli ? { loopSubtaskFullstackCli: route.cli } : {}),
    ...(route.configId ? { loopSubtaskFullstackConfigId: route.configId } : {}),
    ...(route.model ? { loopSubtaskFullstackModel: route.model } : {}),
    ...(mode ? { loopSubtaskMode: mode } : {}),
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
    loopSubtaskFrontendCli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
    loopSubtaskFrontendConfigId?: string;
    loopSubtaskFrontendModel?: string;
    loopSubtaskFullstackCli?: ReturnType<PanelMessageHandlerDeps["getCurrentCli"]>;
    loopSubtaskFullstackModel?: string;
  }
): { loopMainThinkingMode?: ThinkingMode; loopSubtaskThinkingMode?: ThinkingMode; loopSubtaskFrontendThinkingMode?: ThinkingMode; loopSubtaskFullstackThinkingMode?: ThinkingMode } {
  const thinkingSubtaskCli = promptModels.loopSubtaskCli ?? targetCli;
  const includeSubtaskThinking = thinkingSubtaskCli === "codex"
    || thinkingSubtaskCli === "grok"
    || thinkingSubtaskCli === "claude"
    || thinkingSubtaskCli === "dsh"
    || thinkingSubtaskCli === "kimi-code"
    || thinkingSubtaskCli === "zcode";
  if ((!supportsMainSubtaskPromptModels(targetCli) && !includeSubtaskThinking) || !options.includeLoopModels) {
    return {};
  }
  const mainModel = promptModels.loopMainModel ?? promptModels.model ?? deps.getSelectedCliModel(targetCli, configId);
  const subtaskModel = promptModels.loopSubtaskCli
    ? promptModels.loopSubtaskModel
    : promptModels.loopSubtaskModel ?? promptModels.model ?? mainModel;
  const loopMainThinkingMode = (targetCli === "codex" || targetCli === "grok" || targetCli === "dsh" || targetCli === "kimi-code" || targetCli === "zcode")
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
  const frontendCli = promptModels.loopSubtaskFrontendCli;
  const frontendThinking = frontendCli
    && (frontendCli === "codex" || frontendCli === "grok" || frontendCli === "claude" || frontendCli === "dsh" || frontendCli === "kimi-code" || frontendCli === "zcode")
    ? normalizePromptThinkingMode(message.loopSubtaskFrontendThinkingMode, frontendCli, deps)
      ?? deps.getSelectedLoopThinkingMode?.(frontendCli, "subtask", promptModels.loopSubtaskFrontendModel, promptModels.loopSubtaskFrontendConfigId ?? null)
      ?? undefined
    : normalizePromptThinkingMode(message.loopSubtaskFrontendThinkingMode, targetCli, deps);
  const fullstackCli = promptModels.loopSubtaskFullstackCli ?? targetCli;
  const fullstackThinking = normalizePromptThinkingMode(message.loopSubtaskFullstackThinkingMode, fullstackCli, deps);
  return {
    ...(loopMainThinkingMode ? { loopMainThinkingMode } : {}),
    ...(loopSubtaskThinkingMode ? { loopSubtaskThinkingMode } : {}),
    ...(frontendThinking ? { loopSubtaskFrontendThinkingMode: frontendThinking } : {}),
    ...(fullstackThinking ? { loopSubtaskFullstackThinkingMode: fullstackThinking } : {}),
  };
}

export async function handleSendPromptMessage(
  message: Extract<PanelMessage, { type: "sendPrompt" }>,
  deps: PanelMessageHandlerDeps
): Promise<void> {
  // A submission can exit before a runtime emits runStatus (for example stale config).
  // Always settle its local waiting bubble, including exceptions and early returns.
  if (typeof message.requestId !== "string" || !message.requestId) {
    return executeSendPromptMessage(message, deps);
  }
  const tabId = message.tabId || deps.getActiveConversationTabId();
  try {
    await executeSendPromptMessage(message, deps);
  } finally {
    if (typeof message.requestId === "string" && message.requestId) {
      deps.postWebviewMessage({ type: "promptSubmissionSettled", requestId: message.requestId, tabId });
    }
  }
}

async function executeSendPromptMessage(
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
  const requestedSubtaskRouteMode = requestedLoopFamily;

  const requestedTabId = typeof message.tabId === "string" && message.tabId
    ? message.tabId
    : null;
  const preserveActiveTab = Boolean(message.preserveActiveTab && requestedTabId);
  const requestedTab = requestedTabId ? deps.getConversationTabById(requestedTabId) : null;

  if (message.pauseBeforeSend && requestedTabId && !requestedTab) {
    deps.showWebviewError("暂停并发送失败", "目标会话已关闭，补充任务未发送，输入已保留。");
    return;
  }

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

  const departmentMode = deps.isDepartmentContinuation?.(targetTab?.id ?? requestedTabId ?? deps.getActiveConversationTabId()) === true
    || requestedInteractiveMode === "department"
    || (!requestedInteractiveMode && deps.getWorkspaceSettings().interactiveModeByCli?.[targetCli] === "department");
  const requestedMode = requestedInteractiveMode ?? deps.getWorkspaceSettings().interactiveModeByCli?.[targetCli] ?? "coding";
  const modeSettings = deps.readStoredToolSettings?.() ?? {};
  const modeAvailability = resolveModeAvailability(modeSettings);
  const promptTargetIdForMode = targetTab?.id ?? requestedTabId ?? deps.getActiveConversationTabId();
  const existingLoopContext = deps.resolveLoopSubtaskConversationContext(targetCli, promptTargetIdForMode);
  const loopResumeCandidate = (requestedMode === "loop" || requestedMode === "loop_plus")
    ? deps.resolveLoopResumeTaskFromPrompt(trimmed, promptTargetIdForMode)
    : null;
  const isExistingLoopContinuation = Boolean(existingLoopContext || loopResumeCandidate);
  if (!isExistingLoopContinuation && (requestedMode === "loop" && !modeAvailability.loopEnabled
    || requestedMode === "loop_plus" && !modeAvailability.loopPlusEnabled
    || requestedMode === "department" && !modeAvailability.departmentEnabled && !deps.isDepartmentContinuation?.(promptTargetIdForMode))) {
    const label = requestedMode === "loop" ? "Loop" : requestedMode === "loop_plus" ? "Loop+" : "产研部";
    deps.showWebviewError?.("任务模式不可用", `${label}已在工具设置中关闭，未发送任务。`);
    return;
  }
  if (departmentMode) {
    const scope = deps.getDepartmentConfigurationScope?.();
    const selection = JSON.stringify([deps.getCurrentCli(), deps.getActiveConfigIdForCli(targetCli), requestedInteractiveMode ?? deps.getWorkspaceSettings().interactiveModeByCli?.[targetCli]]);
    const targetId = targetTab?.id ?? requestedTabId ?? deps.getActiveConversationTabId();
    const readTarget = () => targetId ? deps.getConversationTabById(targetId) : deps.getActiveConversationTab();
    const targetIdentity = JSON.stringify(readTarget());
    const continuation = deps.isDepartmentContinuation?.(targetId) === true;
    const assertCurrent = (): void => {
      if (!continuation) assertModeAvailable("department", deps.readStoredToolSettings?.());
      if ((!continuation && scope !== message.departmentConfigurationScope) || scope !== deps.getDepartmentConfigurationScope?.() || targetIdentity !== JSON.stringify(readTarget())
        || (!preserveActiveTab && deps.getActiveConversationTabId() !== targetId)
        || selection !== JSON.stringify([deps.getCurrentCli(), deps.getActiveConfigIdForCli(targetCli), requestedInteractiveMode ?? deps.getWorkspaceSettings().interactiveModeByCli?.[targetCli]])) {
        throw new Error("工作区、目标会话或有效配置已变化，请在当前会话重新发送。");
      }
      const issue = !continuation && deps.getDepartmentConfigurationIssue?.();
      if (issue) throw new Error(issue);
    };
    const contextBuild = deps.buildPromptWithAutoContext(trimmed, message.contextOptions);
    const modelPrompt = deps.maybeInjectLongTermMemoryForPrompt(
      trimmed,
      contextBuild.modelPrompt,
      contextBuild.contextTags,
    );
    const startRequest = {
      assertCurrent,
      displayPrompt: trimmed,
      modelPrompt,
      contextTags: contextBuild.contextTags,
      targetTabId: targetTab?.id ?? requestedTabId ?? deps.getActiveConversationTabId(),
      cli: targetCli,
      ...(typeof message.loopPlusAcceptancePlan?.id === "string" ? { acceptancePlanSelectionId: message.loopPlusAcceptancePlan.id } : {}),
    };
    if (!continuation && (!deps.startDepartmentPrompt || !deps.resolveDepartmentPromptConfiguration)) {
      deps.showWebviewError("产研部配置", "产研部组织启动入口尚未接入；当前设置不会退化为普通 Loop 或编码任务。");
      return;
    }
    try {
      assertCurrent();
      if (continuation) {
        if (!deps.continueDepartmentPrompt) throw new Error("产研部补充需求入口尚未接入，请稍后重试。");
        await deps.continueDepartmentPrompt(startRequest);
        return;
      }
      if (deps.waitForConfigApply && !await deps.waitForConfigApply(targetCli)) throw new Error("配置应用失败，产研部任务未启动。");
      assertCurrent();
      await deps.validateVisibleConfigSelections?.(targetCli, message.configSelections);
      assertCurrent();
      const departmentConfiguration = await deps.resolveDepartmentPromptConfiguration!(startRequest);
      assertCurrent();
      await deps.startDepartmentPrompt!({ ...startRequest, departmentConfiguration });
    } catch (error) {
      deps.showWebviewError("产研部任务未启动", error instanceof Error ? error.message : "产研部任务启动失败，请检查配置后重试。");
    }
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
  if (message.pauseBeforeSend) {
    try {
      if (!promptTargetTabId || !deps.pausePromptForTab) throw new Error("当前无法确认任务已完全暂停，补充任务未发送，输入已保留。");
      await deps.pausePromptForTab(promptTargetTabId);
    } catch (error) {
      deps.showWebviewError("暂停并发送失败", error instanceof Error ? error.message : String(error));
      return;
    }
    deps.postWebviewMessage({ type: "promptPauseReady", tabId: promptTargetTabId, requestId: message.requestId, prompt: message.prompt });
  }
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
  const contextBuild = deps.buildPromptWithAutoContext(trimmed, message.contextOptions);
  const modelPromptWithMemory = deps.maybeInjectLongTermMemoryForPrompt(
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
  if (!isExistingLoopContinuation) {
    try {
      assertModeAvailable(requestedMode, deps.readStoredToolSettings?.());
    } catch (error) {
      deps.showWebviewError("任务模式不可用", error instanceof Error ? error.message : String(error));
      await deps.postPanelState();
      return;
    }
  }
  try {
    await deps.validateVisibleConfigSelections?.(targetCli, message.configSelections);
  } catch (error) {
    deps.showWebviewError("配置已变化", error instanceof Error ? error.message : String(error));
    await deps.postPanelState();
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
  if (!isExistingLoopContinuation) {
    try {
      assertModeAvailable(requestedMode, deps.readStoredToolSettings?.());
    } catch (error) {
      deps.showWebviewError("任务模式不可用", error instanceof Error ? error.message : String(error));
      await deps.postPanelState();
      return;
    }
  }
  const activeConfigId = deps.getActiveConfigIdForCli(targetCli);
  const loopPlusSchedulingMode = schedulingModeForInteractiveMode(effectiveInteractiveMode);
  const shouldRunLoop = effectiveInteractiveMode === "loop" || loopPlusSchedulingMode === "event_driven";
  const includeLoopModels = shouldRunLoop || isLoopSubtaskContinuation;
  const promptModels = resolvePromptRoleModels(promptMessage, targetCli, activeConfigId, deps, {
    includeLoopModels,
    subtaskContinuation: isLoopSubtaskContinuation,
  });
  const promptThinkingModes = resolvePromptRoleThinkingModes(promptMessage, targetCli, activeConfigId, deps, {
    includeLoopModels,
  }, promptModels);
  const promptInput: PromptRunInputForPanel = {
    ...(message.configSelections ? { configSelections: message.configSelections } : {}),
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
  if (promptModels.loopSubtaskFrontendCli) {
    promptInput.loopSubtaskFrontendCli = promptModels.loopSubtaskFrontendCli;
  }
  if (promptModels.loopSubtaskFrontendConfigId) {
    promptInput.loopSubtaskFrontendConfigId = promptModels.loopSubtaskFrontendConfigId;
  }
  if (promptModels.loopSubtaskFrontendModel) {
    promptInput.loopSubtaskFrontendModel = promptModels.loopSubtaskFrontendModel;
  }
  if (promptThinkingModes.loopSubtaskFrontendThinkingMode) {
    promptInput.loopSubtaskFrontendThinkingMode = promptThinkingModes.loopSubtaskFrontendThinkingMode;
  }
  if (promptModels.loopSubtaskFullstackCli) {
    promptInput.loopSubtaskFullstackCli = promptModels.loopSubtaskFullstackCli;
  }
  if (promptModels.loopSubtaskFullstackConfigId) {
    promptInput.loopSubtaskFullstackConfigId = promptModels.loopSubtaskFullstackConfigId;
  }
  if (promptModels.loopSubtaskFullstackModel) {
    promptInput.loopSubtaskFullstackModel = promptModels.loopSubtaskFullstackModel;
  }
  if (promptThinkingModes.loopSubtaskFullstackThinkingMode) {
    promptInput.loopSubtaskFullstackThinkingMode = promptThinkingModes.loopSubtaskFullstackThinkingMode;
  }
  if (promptModels.loopSubtaskMode) {
    promptInput.loopSubtaskMode = promptModels.loopSubtaskMode;
  }
  if (loopPlusSchedulingMode === "event_driven" && message.loopPlusAcceptancePlan) {
    promptInput.loopPlusAcceptancePlan = normalizeLoopPlusAcceptancePlanSnapshot(
      message.loopPlusAcceptancePlan,
    );
  }
  if (loopSubtaskContext) {
    promptInput.taskRole = "subtask";
    promptInput.loopTaskId = loopSubtaskContext.taskId;
    promptInput.loopRound = loopSubtaskContext.round;
    promptInput.loopSubtaskId = loopSubtaskContext.subtaskId;
    if (loopSubtaskContext.attemptId) {
      promptInput.loopAttemptId = loopSubtaskContext.attemptId;
    }
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
        loopSubtaskContext.subtaskId,
        loopSubtaskContext.attemptId,
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
  if (loopPlusSchedulingMode === "event_driven") {
    // This refresh reads every CLI's configuration/models. It is a UI projection,
    // not a prerequisite for execution; visible config validation already ran.
    const reportRefreshFailure = (error: unknown) => {
      void logError("loop-plus-submit-panel-refresh", { error: String(error) }).catch(() => undefined);
    };
    try {
      void deps.postPanelState().catch(reportRefreshFailure);
    } catch (error) {
      reportRefreshFailure(error);
    }
  } else {
    await deps.postPanelState();
  }
  // Refresh can outlive the earlier checks; authorize new work from current settings
  // before preloading or dispatching, without waiting for the Loop+ UI projection.
  if (!isExistingLoopContinuation) {
    try {
      assertModeAvailable(requestedMode, deps.readStoredToolSettings?.());
    } catch (error) {
      deps.showWebviewError("任务模式不可用", error instanceof Error ? error.message : String(error));
      return;
    }
  }
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
