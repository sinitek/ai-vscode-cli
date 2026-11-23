import { createDepartmentInteractiveRuntime, usesDepartmentInteractiveRuntime } from "./extensionHost/departmentinteractiveruntime";
import { readDepartmentOrganizationStopFeedback } from "./extensionHost/departmentGroupChatProjection";
import { createDepartmentProductionCleanup } from "./extensionHost/departmentproductioncleanup";
import { fingerprintDepartmentExecutionSelection } from "./runtime/departmentexecutionidentity";
import { createDepartmentCodexPreparation } from "./extensionHost/departmentcodexpreparation";
import { createDepartmentExecutionProducer } from "./extensionHost/departmentexecutionproducer";
import { leaderExecutionScopeKey } from "./extensionHost/departmentleaderexecutionledger";
import { createDepartmentLeaderProductionHost } from "./extensionHost/departmentleaderproductionhost";
import { createDepartmentLeaderNativeSessionValidator } from "./extensionHost/departmentleadernativesessionvalidation";
import { createDepartmentExecutionResources } from "./extensionHost/departmentexecutionresources";
import { sameExecution as sameDepartmentExecution } from "./runtime/departmentexecutionidentity";
import { buildCliArgs as buildDepartmentProcessArgs } from "./cli/cliRunArgStrategies";
import { createDepartmentProcessPreparation, startDepartmentProcessInvocation } from "./extensionHost/departmentprocesspreparation";
import { splitConfiguredCliCommand } from "./cli/commandResolution";
import { CONFIG_PATHS as DEPARTMENT_CONFIG_PATHS } from "./config/configPaths";
import type { CodexRuntimeConfigEvidence } from "./config/codexRuntimeConfigIdentity";
import * as vscode from "vscode";
import { startLoopWaitWatchdog } from "./loopWaitWatchdog";
import { closeLoopSubtaskConversationTabs, createCompletedLoopSubtaskTabCleanup, findRunningLoopSubtaskConversationTabId, prepareLoopSubtaskConversationTabClose, retryLoopSubtaskTabClose, usesCompletedLoopSubtaskTabCleanup } from "./extensionHost/loopSubtaskTabs";
import type { LoopSubtaskTabCloseOptions } from "./loopSubtaskLifecycle";
import { createConversationTaskSummaryCoordinator, createConversationTaskSummarySubmissions } from "./conversationTaskSummary";
import { captureConversationTaskSummaryExecution } from "./extensionHost/conversationTaskSummary";
import { normalizeOpenCodeThinkingEffort } from "./cli/openCodeThinkingEffort";
import { LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT, normalizeChatMessageLimit } from "./chatMessageLimit";
import { createHumanInteractionAttentionHost } from "./extensionHost/humanInteractionAttentionHost";
import { withHumanInteractionAttention } from "./humanInteractionAttention";
import { notifyLoopTaskCompletion, notifyTaskRunCompletion } from "./taskCompletionAttention";
import { abortOrchestratorClarification, formatOrchestratorClarificationAnswer, loopClarificationScope, waitForOrchestratorClarification } from "./orchestratorClarification";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import { PromptRunHandoff, type FirstLoopMainExecution } from "./extensionHost/promptRunHandoff";
import {
  cleanupHumanInteractionHistory,
  cleanupHumanInteractionHistoryAcrossWorkspaces,
  getHumanInteractionHistoryFilePath,
  readHumanInteractionHistory,
  recordHumanInteractionHistory,
} from "./humanInteractionHistory";
import { CONFIG_NAMESPACE, getAutoOpenPanel, getDefaultCli, getAutoAddEditorContextTags, getDebugLogging, getMacTaskShell, getCliCommand, getCliArgs, isInteractiveSupported, getThinkingWorkspaceFiles } from "./cli/config";
import { buildOpenCodeRunFailureMessage, buildProcessLabel, captureCliOutput, parseOpenCodeRunOutput, runCli, runCliStream, startOpenCodeServer, isCliCommandAvailable, type RunProcess } from "./cli/commandRunner";
import {
  beginCliCommandAutoRepair,
  buildRepairedCliCommand,
  inspectUnresolvedCliCommands,
  isCliShellCommandNotFoundError,
  locateCliExecutableForRepair,
  planUnresolvedCliCommandRepairs,
  shouldAwaitCliCommandAutoRepair,
  waitForCliCommandAutoRepair,
} from "./cli/cliCommandRepair";
import { createPromptAutoRepairController } from "./extensionHost/promptAutoRepair";
import { CliName, CLI_LIST, InteractiveMode, OpenCodeThinkingMessageKey, OpenCodeThinkingState, ThinkingMode, ThinkingWorkspaceFile } from "./cli/types";
import { type OpenCodeThinkingCapability } from "./cli/openCodeModelCapabilities";
import type { OpenCodeTaskListItem } from "./cli/openCodeTaskList";
import {
  createOpenCodeSubagentMonitor,
  OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
  resolveOpenCodeSubagentConnection,
  waitForOpenCodeServerReady,
} from "./cli/openCodeSubagentMonitor";
import { appendOpenCodeFinalTextToTabStream, consumeOpenCodeTabStreamChunk, createOpenCodeTabStreamState } from "./openCodeTabStream";
import { applyOpenCodeRuntimeModelOverlay, normalizeOpenCodeModelRole, parseOpenCodeConfigModels, validateOpenCodeModelOverride, type OpenCodeCanonicalModelRole, type OpenCodeModelRoleInput } from "./cli/opencodeconfigmodels";
import { isCodeGraphWorkspaceIndexed } from "./cli/codegraphStatus";
import { isOpenCodeThinkingEffort } from "./cli/openCodeThinkingEffort";
import { parseGrokConfigModels } from "./cli/grokConfigModels";
import { parseKimiCodeConfigModels } from "./config/kimiCodeConfig";
import {
  buildConversationExecutionProfile,
  createConversationTabConfigurationRestorer,
  resolveConversationTabConfiguration,
} from "./conversationTabConfiguration";
import { getCliDisplayName, getCliInstallCommand } from "./cli/installer";
import { t } from "./i18n";
import { CliBridgeViewProvider } from "./webview/viewProvider";
import { buildWorkspacePathItems, removeScheduledTaskAttachments, saveScheduledTaskAttachments, startTempCleanup } from "./webview/panelFileActions";
import { ChatMessage, ChatMessageAction, PanelMessage, PanelState, ScheduledTaskRecord } from "./webview/types";
import { initLogger, logDebug, logEssential, logError, logInfo, scheduleLogRetentionCleanup, setDebugLogging } from "./logger";
import { createPerformanceTrace, type PerformanceTrace } from "./performanceLog";
import { showErrorWithActions } from "./errorDisplay";
import { appendBoundedUtf8Text } from "./boundedText";
import {
  buildHiddenRetryFailureMessage,
  getHiddenRetryDelayMs,
  resetHiddenRetryCountOnRecoveredReply,
} from "./hiddenRetry";
import { hasAssistantFinalConclusionAfterMessage } from "./finalConclusion";
import {
  resolveOpenCodeSuccessfulExitOutcome,
  shouldRecoverOpenCodeLoopMainSessionInFreshSession,
} from "./openCodeRunCompletion";
import { createSubagentProgressController, type SubagentProgressLabels } from "./subagentProgress";
import {
  createLoopSubtaskProgressMonitor,
  mapLoopRunStatusToSubagentStatus,
} from "./loopSubtaskProgress";
import { buildResetLoopMainAiFailureState, isLoopMainStartupConfigLockTimeout } from "./loopMainFailure";
import { normalizeLoopSubtaskFailure } from "./loopSubtaskFailure";
import { ConfigManagerPanel } from "./webview/configPanel";
import { LoopGroupChatPanel } from "./webview/loopGroupChatPanel";
import * as configService from "./config/configService";
import { createConfigApplyQueue, type ConfigApplyResult } from "./config/configApplyQueue";
import { InteractiveRunnerManager } from "./interactive/manager";
import { type CodexRunSelection } from "./interactive/codexThreadSelection";
import {
  collectInteractiveSessionKeys,
  collectReferencedInteractiveSessionKeys,
  shouldDisposeInteractiveSession,
  type InteractiveSessionBinding,
} from "./interactive/runnerRetention";
import { recoverClaudeMessagesFromTranscript } from "./interactive/claudeTranscript";
import {
  readSessionMeta,
  writeSessionMeta,
} from "./interactive/metaStore";
import { getHistoryRetentionDays, isTimestampWithinHistoryRetention } from "./historyRetention";
import { isLocalSessionId } from "./interactive/sessionHistoryRepair";
import { buildLoopSubtaskExecutionPlan } from "./loopParallel";
import {
  createLoopSubtaskExecutionRoot,
  isLoopSubtaskLinkFailedError,
  resolveGrokLoopExecutionCwd,
} from "./loopSubtaskExecutionRoot";
import { findLegacyGrokLoopCwd } from "./legacyGrokLoopSession";
import {
  DSH_WORKSPACE_RULES_FILE_NAME,
  KIMI_CODE_WORKSPACE_RULES_FILE_NAME,
  resolveClaudeHomeDir,
  resolveCodexHomeDir,
  resolveDshGlobalRulesPath,
  resolveGrokHomeDir,
  resolveKimiCodeGlobalRulesPath,
  resolveOpenCodeHomeDir,
  resolveZcodeGlobalRulesPath,
} from "./shared/userHomePaths";
import { buildLoopMainSubChatTranscriptFile, buildLoopMainSubSubtaskTurnBody, formatLoopGroupChatMemberName, resolveLoopAnswerConclusion, isLoopTaskRunOrphaned, resolveLoopTaskRunControlState } from "./loopGroupChat";
import {
  readConversationTabRunningFlowLoopPlus,
  selectActiveConversationTabRunningFlowIds,
  selectStaleConversationTabRunningFlowIds,
  type ConversationTabRunningFlowCheck,
} from "./conversationTabRunningFlow";
import {
  createEmptyLoopAskThread,
  loopAskThreadPath,
  readLoopAskThreadFile,
  writeLoopAskThreadFile,
} from "./loopAskThread";
import { askLoopMainModelSession } from "./loopMainQuestion";
import { createLoopMainQuestionQueue } from "./loopMainQuestionQueue";
import { appendLoopRound, appendLoopTaskRecord, bindLoopTaskToSession, bindLoopTaskToRuntimeTarget, buildLoopTaskStoreFile, buildLoopSubtaskCommunicationFile, cleanupLoopCommunicationRetention, cleanupLoopTaskStoreRetention, ensureLoopCommunicationFiles, getLoopCommunicationPaths, listLoopTaskStoreFiles, prepareLoopSubtaskCommunicationFile, readLoopTaskRecord, readLoopTaskStore, normalizeLoopTaskOriginProfile, updateLoopTaskRecord, type LoopTaskRecord } from "./loopTaskStore";
import { createLoopPlusScheduler } from "./loopPlusScheduler";
import { loopModelRoutingFromPromptInput } from "./continueModelChoice";
import { getSelectedLoopFrontendThinkingFromStore, getSelectedLoopFullstackThinkingFromStore } from "./modelSelectionStore";
import { readLoopSubtaskModeField } from "./loopPlusSubtaskMode";
import { parseCliName, planBoundSubtaskConfigApply } from "./subtaskCliRoute";
import { createLoopOrchestrationOwnershipTracker } from "./loopOrchestrationOwnership";
import {
  LoopMainAutoCompactFlights,
  mergeCompactTranscriptIntoLive,
  settleAutoCompactAfterPrompt,
  type LoopMainAutoCompactRequest,
  type LoopMainAutoCompactReservation,
} from "./loopMainAutoCompact";
import { loopSubtaskAutoCompactions } from "./loopSubtaskAutoCompact";
import { createIsolatedContextCompactionDeps } from "./extensionHost/isolatedContextCompaction";
import {
  isCliEnabled,
  listEnabledClis,
  readHumanInteractionTimeoutMs,
  readToolSettings,
  reloadToolSettings,
  resolveNotificationSettings,
  resolveGlobalAutoCompactContextAfterRun,
  resolveGlobalHumanInteractionEnabled,
  resolveHumanInteractionTimeoutMinutes,
  resolveNextEnabledCli,
  type ToolSettingsState,
  updateToolSettings,
} from "./toolSettings";
import { DepartmentConfigurationSaveBarrier, getDepartmentSelectionContextRevision, invalidateDepartmentSelectionContext, validateDepartmentRoleCandidate } from "./departmentConfiguration";
import { departmentRoleCliIssue, normalizeDepartmentMetadata, usesDepartmentOwner, type DepartmentMetadata } from "./department";
import { createDepartmentRuntimeComposition, freezeDepartmentThinkingDefaults } from "./extensionHost/departmentruntimecomposition";
import { DepartmentColdGenerationRecovery, describeDepartmentColdStopFailure } from "./extensionHost/departmentcoldgenerationrecovery";
import { createDepartmentStoredLeaderIdentityReader } from "./extensionHost/departmentleaderstoredidentity";
import { canPromoteDepartmentLeaderSession, commitDepartmentLeaderSessionPromotion, isDepartmentLeaderMainContext, repairStoppedDepartmentLeaderSession } from "./extensionHost/departmentLeaderSessionPromotion";
import { DepartmentRuntimeStore } from "./extensionHost/departmentruntimestore";
import { DepartmentExecutionRecovery } from "./extensionHost/departmentexecutionrecovery";
import { createDepartmentProductionTaskStoreForHost } from "./extensionHost/departmentProductionTaskStore";
import { prepareDepartmentTaskRecord } from "./extensionHost/departmentOwnedTaskRepository";
import { readKnownOrdinaryLoopTaskRecord, type LoopTaskUserStopSource } from "./loopTaskStore";
import { normalizeDepartmentMaxEmployees, normalizeDepartmentMaxLeaders } from "./departmentSettings";
import { assertModeAvailable } from "./modeAvailability";
import {
  buildTimedOutHumanInteractionSubmission,
  createHumanInteractionRejectedError,
  createInteractionTimeout,
  type HumanInteractionRequest,
  type HumanInteractionSubmission,
} from "./humanInteraction";
import { persistPromptRunSummary } from "./memory/memoryConsolidator";
import { isMemoryRuntimeOperationAllowed } from "./memory/runtimeGate";
import { isWorkspaceHarnessInstalled } from "./workspaceScaffold";
import {
  type ContextCompactionOptions,
  type ContextCompactionRunDeps,
  isAutoContextCompactionCli,
  runContextCompactionWithDeps,
} from "./contextCompactionRunner";
import { buildHiddenRetryPrompt, buildThinkingPrompt, collectCodexImagePathsFromPrompt, resolveRecordedExecutionModel } from "./promptRuntime";
import { createTraceLineFilterState, formatCodexExecSegmentForDisplay, formatTraceSegmentForDisplay, getTraceSegmentKind, isTraceSegmentStart, normalizeTraceContentForDisplay, resetTraceLineFilterState, resolveTraceKind, resolveTraceMerge, shouldIgnoreTraceLine, type TraceMessageKind } from "./traceDisplay";
import { getSessionKey, writeSessionFile, type SessionStore } from "./sessionStore";
import { createSessionTabsController, getConversationTabSessionIdForCli, isConversationTabExecutionLocked, resolveConversationTabAutoInteractiveMode, switchConversationTabCli, type ConversationTabRecord, type ConversationTabsState, type PendingSessionDraft, type SessionTabsController } from "./sessionTabs";
import {
  createSessionLifecycleController,
  extractSessionId,
  resolveCliSessionIdForResume,
  type ProcessTitleState,
  type SessionLifecycleController,
  type SessionPromotionOptions,
} from "./sessionLifecycle";
import { countStoreModels, createEmptyModelSelectionStoreState, getManagedModelOptionsForConfigFromStore, getLoopModelOptionsForCliFromStore, getModelOptionsForConfigFromStore, getOpenCodeRoleVariantFromStore, normalizeCliModelName, summarizeModelStoreByConfigId, type CliModelStore } from "./modelSelectionStore";
import {
  createLoopPlusPersistedTaskRefresher,
  createPromptRunRuntimeHost,
  shouldCloseLoopPlusParentGateBeforeAbort,
} from "./extensionHost/promptRunRuntime";
import { createPromptParallelRuntimeHost } from "./extensionHost/promptParallelRuntime";
import { createPromptInteractiveRuntimeHost } from "./extensionHost/promptInteractiveRuntime";
import { takeOverSessionTab } from "./extensionHost/sessionTabOwnership";
import { createPromptOneShotRuntimeHost } from "./extensionHost/promptOneShotRuntime";
import {
  createDisabledOpenCodeSubagentMonitor,
  createOpenCodeSubagentRuntimePreparer,
} from "./extensionHost/openCodeSubagentRuntime";
import { bindLoopSubtaskSession } from "./loopSubtaskSession";
import { shouldUseClassicLoopProjectInstructions, type InteractiveTabRun } from "./extensionHost/promptExecutionShared";
import {
  createLoopOrchestrationHost,
  getLoopSubtaskLaunchDelayMs,
  LOOP_SUBTASK_RETRY_MAX_RETRIES,
  resolveLoopTaskAtCreationBoundary,
} from "./extensionHost/loopOrchestration";
import { createLoopPlusRuntimeAdapter, selectLoopPlusContinuationDetail } from "./extensionHost/loopPlusRuntimeAdapter";
import type { LoopPlusPromptTarget } from "./extensionHost/loopPlusOrchestration";
import { logLoopPlusRuntimeEvent } from "./extensionHost/loopPlusDiagnostics";
import {
  buildLoopPlusGroupChatSection,
  buildLoopPlusSubtaskParentMessage,
  type LoopPlusSubtaskChatNotice,
} from "./extensionHost/loopPlusSubtaskChat";
import { createModelSettingsHost, schedulingModeForInteractiveMode } from "./extensionHost/modelSettings";
import { createExtensionSessionTabsHost } from "./extensionHost/sessionTabs";
import type { PromptRunInput, PromptRunTarget } from "./promptRunTypes";
import { buildLoopPlusPauseText, recordLoopPlusPause } from "./loopPlusPause";
import { createPromptRunModelsHost } from "./extensionHost/promptRunModels";
import { createPrimaryPromptRunController } from "./extensionHost/primaryPromptRunController";
import { trySaveWorkspaceSettings as trySaveWorkspaceSettingsToStore, tryUpdateWorkspaceSettings as tryUpdateWorkspaceSettingsToStore, type WorkspaceSettings } from "./workspaceSettingsStore";
import { normalizeLoopPlusAcceptancePlanSnapshot, normalizeLoopPlusAcceptancePlanSnapshotForStorage } from "./loopPlusAcceptancePlan";
import {
  buildLoopPlusAcceptancePlanSelectionPanelValue,
  buildLoopPlusAcceptancePlansPanelValue,
  deleteLoopPlusAcceptancePlan,
  saveLoopPlusAcceptancePlan,
  selectLoopPlusAcceptancePlan,
} from "./extensionHost/loopPlusAcceptancePlanHost";
import { handlePanelMessageWithDeps } from "./sessionMessageHandlers";
import {
  buildScheduledTaskSummaries,
  createScheduledTaskRecord,
  readScheduledTaskStore,
  removeScheduledTask,
  resolveScheduledTaskExecutionConfigForTask,
  ScheduledTaskScheduler,
  SCHEDULED_TASK_MAX_COUNT,
  upsertScheduledTask,
  writeScheduledTaskStore,
} from "./scheduledTaskStore";
import { registerExtensionCommands } from "./commandRegistry";
import { buildEditorContextState, buildLoopMainResumeText, buildLoopSubtaskBatchCompletedText, buildLoopSubtaskBatchStartedText, buildLoopSubtaskExecutionGroupStartedText, buildLoopSubtaskRetryText as buildLoopSubtaskRetryTextWithLimit, buildLoopSubtaskStartedText, buildLoopTaskCompletedText, buildLoopTaskNeedsReviewText as buildLoopTaskNeedsReviewTextWithLimit, buildLoopTaskResumedText, buildLoopTaskStartedText, buildPanelStateWithDeps, buildSessionLabelFromPrompt, buildUserChatMessage, buildVibeModeTransitionPrompt, ensureLoopMainSubChatTranscriptWithDeps, formatLoopEstimatedRemainingRounds, buildPromptWithAutoContext as buildPromptWithAutoContextFromPanelStateBuilder, getLatestAssistantResponseForLongTermMemory, getLoopMainSubChatMainTitle, getLoopSubtaskDisplayTitle, isCliName, maybeInjectLongTermMemoryForPromptWithEditorContext, normalizeLoopTaskId, resolveLoopConversationTabContextFromMessages, resolveLoopRunConversationTabContext, shouldUseFallbackSessionLabel as shouldUseFallbackSessionLabelWithSet, type LoopConversationTabContext } from "./panelStateBuilder";
import { appendHiddenRetryErrorTraceMessage, buildHiddenRetryLimitMessage, buildHiddenRetryQueuedMessage, buildHiddenRetryStartedMessage, getAttemptFailureMessage, getErrorInfo, HIDDEN_RETRY_MAX_RETRIES, isAbortErrorInfo, isHiddenRetryEligibleAttempt, waitForHiddenRetryDelay } from "./promptRetry";
import { isLoopResumePrompt, normalizeLoopResumePrompt } from "./loopTaskMessagePolicy";
import { createLoopGroupChatPanelCoordinator, type ConfigLockResumeRequest } from "./extensionHost/loopGroupChatPanelCoordinator";
import { readLoopTaskStoreResult } from "./loopTaskStore";
import { applyLoopInvocationModelRouting, applyLoopModelRoutingToPrompt, applyLoopPromptThinkingToOriginProfile, getLoopModelSwitchThinkingOptions, type LoopModelSwitchOption } from "./loopModelSwitch";
import { createLoopModelSwitchResumeCoordinator } from "./extensionHost/loopModelSwitchResume";
import { createPanelDiagnosticsInspector } from "./panelDiagnostics";
import { buildCliCommandNotFoundMessage, buildCodexImageSupportWarningKey, buildLoopCompletedConclusionAndSummaryMarkdown, buildLoopRoundSummary, buildLoopSupplementalRequirementsLines, createConfigHeartbeatCoordinator, getWorkspacePreferredConfigIdForCli as getWorkspacePreferredConfigIdForCliFromSettings, loadConfigStateWithDeps, loadConfigStateByCli, normalizeCliInstallStatus, normalizeLoopSupplementalRequirement, probeCodexImageSupportStatus, resolveLoopResumeRound, resolveModelConfigIdForCli as resolveModelConfigIdForCliFromConfigState, type CodexImageSupportStatus } from "./webviewCommandCoordinator";
import { type PromptHistoryStore } from "./promptHistoryStore";
import { appendAssistantChunkToStore, appendMessageToStore, buildTaskRunCompletionText as buildTaskRunCompletionTextWithLabels, cleanupTaskStoreRetention as cleanupTaskStoreRetentionWithDeps, isInteractiveMode, isLoopTaskRole, isMacTaskShell, isThinkingMode, isLoopTaskCompleted, normalizeVisibleInteractiveMode, normalizeRawStreamContent, readTaskStore as readTaskStoreWithDeps, sendPanelMessageWithActiveTab, writeTaskStore as writeTaskStoreWithDeps, type LoopTaskRole, type RunActivity, type TaskRunRecord, type TaskRunStatus, type TaskStore } from "./promptRunState";
let currentCli: CliName;
let conversationTabSelectionRevision = 0;
let statusBarItem: vscode.StatusBarItem | undefined;
let extensionUri: vscode.Uri;
let viewProvider: CliBridgeViewProvider | undefined;
let interactiveRunnerManager: InteractiveRunnerManager;
const promptRunHandoff = new PromptRunHandoff();
const activeTraceLineFilterState = createTraceLineFilterState();
const primaryPromptRunController = createPrimaryPromptRunController();
let activeProcessTitleRunId: string | null = null;
let activeProcessTitleBase: string | null = null;
let extensionContext: vscode.ExtensionContext;
let sessionStore: SessionStore;
let promptHistoryStore: PromptHistoryStore;
let modelStore: CliModelStore;
let workspaceSettings: WorkspaceSettings = {};
let configManagerPanel: ConfigManagerPanel | undefined;
const loopGroupChatChatPanelsByTaskId = new Map<string, LoopGroupChatPanel>();
let activeWorkspaceKey: string;
let departmentWorkspaceGeneration = 0;
const departmentSaveBarrier = new DepartmentConfigurationSaveBarrier();
function getDepartmentConfigurationScope(): string {
  return JSON.stringify([activeWorkspaceKey, departmentWorkspaceGeneration]);
}
function getDepartmentConfigurationIssue(): string | null {
  return departmentSaveBarrier.issue(getDepartmentConfigurationScope());
}
let pendingWorkspaceKey: string | null = null;
let lastResolvedWorkspaceCwd: string | undefined;
let updateCheckOverride: { autoCheckUpdates?: boolean; autoUpdate?: boolean } | null = null;
const configApplyQueue = createConfigApplyQueue<CliName>();
const modelSelectionStoreState = createEmptyModelSelectionStoreState();
const lastConfigStateLoadErrorByCli: Partial<Record<CliName, string>> = {};
const conversationTabStore: ConversationTabsState = {
  activeTabId: null,
  tabs: [],
};
const pendingSessionDrafts: Record<string, PendingSessionDraft> = {};
const pendingConversationTaskSummarySubmissions = createConversationTaskSummarySubmissions<ConversationTabRecord, {
  workspace: string;
  draft: PendingSessionDraft;
  requirement: string;
  model: string | null;
  thinkingMode: ThinkingMode;
  command: string;
  args: string[];
  openCodeVariant: string | null;
}>();
const conversationTaskSummaries = createConversationTaskSummaryCoordinator({
  workspace: () => activeWorkspaceKey,
  getTab: (tabId) => conversationTabStore.tabs.find((tab) => tab.id === tabId) ?? null,
  getDraft: (tabId) => getPendingSessionDraft(tabId, getConversationTabById(tabId)?.cli),
  getSession: (tab) => sessionStore[tab.cli]?.sessions.find((session) => session.id === getConversationTabSessionIdForCli(tab, tab.cli)),
  persist: () => {
    sessionTabsController.persistConversationTabsToWorkspaceSettings();
    void persistSessionStoreToStorage(sessionStore).catch(() => undefined);
  },
  publish: () => { void postPanelState().catch(() => undefined); },
});
const sessionMessageCache = new Map<string, ChatMessage[]>();
const sessionMessageLoadErrors = new Map<string, string>();
const parallelRunsByTabId = new Map<string, ParallelTabRun>();
const interactiveRunsByTabId = new Map<string, InteractiveTabRun>();
const conversationTabRunRevisions = new WeakMap<ConversationTabRecord, object>();
const promptAutoRepairController = createPromptAutoRepairController();
let isExtensionDeactivating = false;
const loopOrchestrationOwnership = createLoopOrchestrationOwnershipTracker();
const loopMainQuestionQueue = createLoopMainQuestionQueue();
const latestOpenCodeTaskListByTabId = new Map<string, OpenCodeTaskListItem[]>();
let sessionTabsController: SessionTabsController;
let sessionLifecycleController: SessionLifecycleController;
let scheduledTaskScheduler: ScheduledTaskScheduler | null = null;
const SESSION_STORE_KEY = "sessionStore";
const SESSION_BUFFER_LIMIT = 4000;
const AI_TASK_RAW_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;
const LOCAL_SESSION_PREFIX = "local_";
const CONVERSATION_TAB_PREFIX = "tab_";
const DATA_DIR = path.join(os.homedir(), ".sinitek_cli");
const SESSION_DIR = path.join(DATA_DIR, "sessions");
const MESSAGE_DIR_ROOT = path.join(DATA_DIR, "messages");
const WORKSPACE_SETTINGS_DIR = path.join(DATA_DIR, "workspace-settings");
const PROMPT_HISTORY_DIR = path.join(DATA_DIR, "prompt-history");
const HUMAN_INTERACTION_HISTORY_DIR = path.join(DATA_DIR, "human-interaction-history");
const MODEL_STORE_FILE = path.join(DATA_DIR, "models.json");
const DEFAULT_MODEL_STORE_KEY = "__default__";
const WORKSPACE_KEY_FALLBACK = "no-workspace";
const WORKSPACE_KEY_HASH_LENGTH = 12;
const WORKSPACE_NAME_MAX_LENGTH = 32;
const AUTO_COMPACT_AFTER_RUN_MIN_DURATION_MS = 5 * 60 * 1000;
const loopMainAutoCompactFlights = new LoopMainAutoCompactFlights();
const AUTO_COMPACT_AFTER_RUN_TIMEOUT_MS = 3 * 60 * 1000;
const LEGACY_SESSION_FILE = path.join(DATA_DIR, "sessions.json");
const LEGACY_MESSAGE_DIR = path.join(DATA_DIR, "messages");
const LEGACY_PROMPT_HISTORY_FILE = path.join(DATA_DIR, "prompt-history.json");
const LEGACY_HUMAN_INTERACTION_HISTORY_FILE = path.join(DATA_DIR, "human-interaction-history.json");
const TASK_STORE_FILE = path.join(DATA_DIR, "tasks.json");
const taskRunCompletionEmitter = new vscode.EventEmitter<TaskRunRecord>();
const LOOP_DEFAULT_MAX_ROUNDS = 20;
const LOOP_MIN_MAX_ROUNDS = 1;
const LOOP_MAX_MAX_ROUNDS = 100;
const LOOP_SUBTASK_PROMPT_MIN_LENGTH = 80;
const HISTORY_RETENTION_CLEAN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CODEX_IMAGE_MIN_VERSION = "0.2.0";
const CODEX_IMAGE_SUPPORT_CACHE_MS = 5 * 60 * 1000;
const CODEX_IMAGE_SUPPORT_TIMEOUT_MS = 5000;
const CONFIG_HEARTBEAT_INTERVAL_MS = 5000;
const COMMON_COMMAND_LABELS: Record<"compactContext", string> = {
  compactContext: t("common.compactContext"),
};
type LoopOrchestrationHost = ReturnType<typeof createLoopOrchestrationHost>;
let loopOrchestrationHost: LoopOrchestrationHost | null = null;
const CLI_INSTALL_TERMINAL_PREFIX = "CLI Install";
const CODEGRAPH_INSTALL_TERMINAL_NAME = "CodeGraph Install";
const ARCHITECTURE_INITIALIZATION_DISPLAY_PROMPT = "初始化当前工作区 ARCHITECTURE.md";
const UNNAMED_SESSION_LABELS = new Set([
  t("session.unnamed"),
]);
const prepareOpenCodeSubagentRuntime = createOpenCodeSubagentRuntimePreparer({
  getOpenCodeCliArgs: () => getCliArgs("opencode"),
  resolveConnection: resolveOpenCodeSubagentConnection,
  startServer: (port, handlers, options) => startOpenCodeServer(port, handlers, options),
  waitForServerReady: waitForOpenCodeServerReady,
  buildServerProcessLabel: (runId) => `${buildProcessLabel("opencode", runId)}-server`,
  getDefaultDirectory: () => process.cwd(),
  logDebug: (event, payload) => void logDebug(event, payload),
  logInfo: (event, payload) => void logInfo(event, payload),
  logError: (event, payload) => void logError(event, payload),
});
function shouldUseFallbackSessionLabel(label: string | null | undefined): boolean {
  return shouldUseFallbackSessionLabelWithSet(label, UNNAMED_SESSION_LABELS);
}
async function persistSessionStoreToStorage(store: SessionStore): Promise<void> {
  sessionStore = store;
  writeSessionFile(store, activeWorkspaceKey, {
    workspaceKeyFallback: WORKSPACE_KEY_FALLBACK,
    legacySessionFile: LEGACY_SESSION_FILE,
    sessionDir: SESSION_DIR,
    logError: (event, payload) => logError(event, payload),
  });
  await extensionContext.globalState.update(getSessionStoreKey(), store);
}
const CLI_RULE_PATHS_GLOBAL: Record<CliName, string> = {
  codex: path.join(resolveCodexHomeDir(), "AGENTS.md"),
  claude: path.join(resolveClaudeHomeDir(), "CLAUDE.md"),
  opencode: path.join(resolveOpenCodeHomeDir(), "AGENTS.md"),
  grok: path.join(resolveGrokHomeDir(), "AGENTS.md"),
  dsh: resolveDshGlobalRulesPath(),
  // Kimi Code 全局指令文件：<KIMI_CODE_HOME>/AGENTS.md（默认 ~/.kimi-code/AGENTS.md）。
  "kimi-code": resolveKimiCodeGlobalRulesPath(),
  zcode: resolveZcodeGlobalRulesPath(),
};
const CLI_RULE_FILENAMES_PROJECT: Record<CliName, string> = {
  codex: "AGENTS.md",
  claude: "CLAUDE.md",
  opencode: "AGENTS.md",
  grok: "AGENTS.md",
  dsh: DSH_WORKSPACE_RULES_FILE_NAME,
  "kimi-code": KIMI_CODE_WORKSPACE_RULES_FILE_NAME,
  zcode: "AGENTS.md",
};

function currentGlobalRulePaths(): Record<CliName, string> {
  return {
    ...CLI_RULE_PATHS_GLOBAL,
    dsh: resolveDshGlobalRulesPath(),
    "kimi-code": resolveKimiCodeGlobalRulesPath(),
    zcode: resolveZcodeGlobalRulesPath(),
  };
}
const PROMPT_HISTORY_LIMIT = 200;
const CONTEXT_COMPACT_TURN_THRESHOLD = 30;
const CONTEXT_COMPACT_CHAR_THRESHOLD = 24000;
const FROZEN_THREAD_LIMIT = 5;
const KEEP_RECENT_TURNS = 3;
const suppressCompactPrompt = new Set<string>();
type ParallelTabRun = {
  runId: string;
  tabId: string;
  cli: CliName;
  sessionId: string | null;
  prompt: string;
  startedAt: number;
  process: RunProcess;
  messageTarget: ChatMessage[];
  stopped: boolean;
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  loopAttemptId?: string;
};
type InspectModelManagerMessage = Extract<PanelMessage, { type: "inspectModelManager" }>;
type CliInstallStatus = {
  command: string;
  installed: boolean;
  checkedAt: number;
};
const cliInstallStatuses: Record<CliName, CliInstallStatus | null> = {
  codex: null,
  claude: null,
  opencode: null,
  grok: null,
  dsh: null,
  "kimi-code": null,
  zcode: null,
};
let openCodeThinkingState = buildDefaultOpenCodeThinkingState();
let openCodeSmallThinkingState = buildDefaultOpenCodeThinkingState();
let openCodeModelsState: PanelState["openCodeModels"] = undefined;
let openCodeThinkingContextKey = "";
let openCodeThinkingConfigId: string | null = null;
let openCodeThinkingExactModels: Record<OpenCodeCanonicalModelRole, string | null> = { main: null, subtask: null };
let openCodeThinkingRequestId = 0;
let codexImageSupportStatus: CodexImageSupportStatus | null = null;
const codexImageSupportWarningKeys = new Set<string>();
let historyArtifactRetentionCleanupPromise: Promise<void> | null = null;
function initializeSessionControllers(loggerReady: Promise<void>): void {
  sessionTabsController = createSessionTabsController({
    state: conversationTabStore,
    pendingDrafts: pendingSessionDrafts,
    conversationTabPrefix: CONVERSATION_TAB_PREFIX,
    getCurrentCli: () => isCliName(currentCli as string) ? currentCli : getDefaultCli(),
    setCurrentCli: (cli) => {
      currentCli = cli;
      updateStatusBar();
    },
    getDefaultCli,
    isCliName,
    getLatestSessionId,
    getSessionStore: () => sessionStore,
    getSessionMessages: (cli, sessionId) => loadSessionMessages(cli, sessionId),
    getWorkspaceSettings: () => workspaceSettings,
    saveWorkspaceSettings,
    setCurrentSession,
    setWorkspaceInteractiveModeForCli,
    resolveAutoInteractiveModeForConversationTab,
    collectRunningLoopTaskIds,
    isLoopTaskRunning,
    getLoopTaskStatus: (taskId) => readLoopTaskRecord(taskId)?.status ?? null,
    getLoopTaskSchedulingMode: (taskId) => readLoopTaskRecord(taskId)?.schedulingMode,
    resolveConversationTabLoopContext,
    buildSessionLabelFromPrompt,
  });
  sessionLifecycleController = createSessionLifecycleController({
    activeWorkspaceKey: () => activeWorkspaceKey,
    workspaceKeyFallback: WORKSPACE_KEY_FALLBACK,
    legacyMessageDir: LEGACY_MESSAGE_DIR,
    messageDirRoot: MESSAGE_DIR_ROOT,
    frozenThreadLimit: FROZEN_THREAD_LIMIT,
    historyRetentionDays: getHistoryRetentionDays,
    legacySessionFile: LEGACY_SESSION_FILE,
    localSessionPrefix: LOCAL_SESSION_PREFIX,
    sessionDir: SESSION_DIR,
    sessionStoreKey: SESSION_STORE_KEY,
    sessionStore: () => sessionStore,
    globalStateGet: <T>(key: string) => extensionContext.globalState.get<T>(key),
    globalStateKeys: () => extensionContext.globalState.keys(),
    globalStateUpdate: (key, value) => extensionContext.globalState.update(key, value),
    sessionMessageCache,
    sessionMessageLoadErrors,
    readSessionMetaStore,
    writeSessionMetaStore,
    getSessionMetaFilePath,
    getSessionStoreKey,
    getCurrentSessionId,
    setCurrentSession,
    persistSessionStore: (store) => { void persistSessionStoreToStorage(store); },
    postPanelState,
    sendPanelMessage,
    showSessionLoadError: (detail) => void showErrorWithActions(t("session.loadFailedTitle"), detail),
    getActiveConversationTabId,
    getConversationTabById,
    getConversationTabs: () => ensureConversationTabs().tabs,
    persistConversationTabsToWorkspaceSettings,
    getPendingSessionDraft,
    updatePendingSessionDraft,
    clearPendingSessionDraft,
    clearAllPendingSessionDrafts: () => {
      Object.keys(pendingSessionDrafts).forEach((key) => {
        delete pendingSessionDrafts[key];
      });
    },
    getLiveMessagesForTab,
    recoverClaudeMessagesFromTranscript,
    isTimestampWithinHistoryRetention,
    buildSessionLabelFromPrompt,
    shouldUseFallbackSessionLabel,
    getPrimaryRunTabId,
    getPrimaryRunSessionState: () => ({
      cli: primaryPromptRunController.activeCliForRun,
      sessionId: primaryPromptRunController.activeSessionId,
      tabId: primaryPromptRunController.activeTabIdForRun,
      messageTarget: primaryPromptRunController.activeMessageTarget,
      messageIndex: primaryPromptRunController.activeMessageIndex,
    }),
    setPrimaryRunSessionState: (patch) => {
      if (patch.sessionId !== undefined) {
        primaryPromptRunController.activeSessionId = patch.sessionId;
      }
      if (patch.messageTarget !== undefined) {
        primaryPromptRunController.activeMessageTarget = patch.messageTarget;
      }
      if (patch.messageIndex !== undefined) {
        primaryPromptRunController.activeMessageIndex = patch.messageIndex;
      }
    },
    getRuntimeSessionReferences: (tabId) => {
      const references: Array<{ cli: CliName; sessionId: string | null; messageTarget: ChatMessage[] }> = [];
      const parallelRun = tabId ? parallelRunsByTabId.get(tabId) : undefined;
      if (parallelRun) {
        references.push(parallelRun);
      } else if (!tabId) {
        parallelRunsByTabId.forEach((run) => references.push(run));
      }
      const interactiveRun = tabId ? interactiveRunsByTabId.get(tabId) : undefined;
      if (interactiveRun) {
        references.push(interactiveRun);
      } else if (!tabId) {
        interactiveRunsByTabId.forEach((run) => references.push(run));
      }
      return references;
    },
    getProcessTitleState: (): ProcessTitleState => ({
      activeRunId: primaryPromptRunController.activeRunId,
      activeCliForRun: primaryPromptRunController.activeCliForRun,
      activeProcessTitleRunId,
      activeProcessTitleBase,
    }),
    setProcessTitleState: (patch) => {
      if (patch.activeProcessTitleRunId !== undefined) {
        activeProcessTitleRunId = patch.activeProcessTitleRunId;
      }
      if (patch.activeProcessTitleBase !== undefined) {
        activeProcessTitleBase = patch.activeProcessTitleBase;
      }
    },
    t,
    logDebug: (event, payload) => void logDebug(event, payload),
    logInfo: (event, payload) => void logInfo(event, payload),
    logEssential: (event, payload) => loggerReady.then(() => logEssential(event, payload)),
    logError: (event, payload) => void logError(event, payload),
  });
}
export function activate(context: vscode.ExtensionContext): void {
  const loggerReady = initLogger();
  try { getDepartmentOwnershipIndex(); }
  catch (error) { void logError("department-source-initialization-refused", { error: errorToMessage(error) }); }
  context.subscriptions.push({ dispose: () => { void departmentOwnershipIndex?.close().catch((error) => logError("department-owner-dispose-failed", { error: errorToMessage(error) })); } });
  isExtensionDeactivating = false;
  extensionContext = context;
  extensionUri = context.extensionUri;
  humanInteractionAttention = createHumanInteractionAttentionHost(context, (channel, error) => {
    void logError("humanInteraction-desktop-attention", {
      channel,
      error: error instanceof Error ? error.message : String(error),
    });
  }, resolveWorkspaceCwd, () => resolveNotificationSettings(readToolSettings()));
  interactiveRunnerManager = new InteractiveRunnerManager();
  void maybeDisableMarketplaceUpdateCheckInDev(context);
  activeWorkspaceKey = buildWorkspaceKey(resolveWorkspaceCwd());
  migrateLegacyToolSettingsFromVsCodeConfig();
  beginCliCommandAutoRepair(autoRepairUnresolvedCliCommands());
  initializeSessionControllers(loggerReady);
  sessionStore = loadSessionStore();
  promptHistoryStore = loadPromptHistoryStore();
  workspaceSettings = loadWorkspaceSettings();
  migrateLegacyAutoCompactContextAfterRunFromWorkspace();
  // Restore currentCli from workspace settings, or use default
  currentCli = workspaceSettings.currentCli || getDefaultCli();
  modelStore = loadModelStore();
  initializeConversationTabsFromWorkspaceSettings();
  completedLoopSubtaskTabs.rememberRestoredTabs(ensureConversationTabs().tabs);
  repairSupersededLocalSessions({ notifyPanel: false, source: "activation" });
  syncCurrentSessionWithActiveTab();
  ensureCurrentCliIsEnabled();
  void loggerReady.then(() => {
    scheduleLogRetentionCleanup();
  }).catch(() => undefined);
  setDebugLogging(getDebugLogging());
  configManagerPanel = new ConfigManagerPanel(extensionUri, {
    onConfigChanged: () => postPanelState(),
    getActiveConfigId: async (cli) => (await loadConfigState(cli)).activeConfigId,
  });
  const configEditorRegistration = configManagerPanel.registerCustomEditorProvider();
  if (configEditorRegistration) {
    context.subscriptions.push(configEditorRegistration);
  }
  startTempCleanup(context);
  startHistoryArtifactRetentionCleanup(context);
  context.subscriptions.push(new vscode.Disposable(startLoopWaitWatchdog([
    () => { if (!isExtensionDeactivating) loopOrchestrationHost?.checkWaitingTasks(); },
    () => { if (!isExtensionDeactivating) loopPlusRuntimeAdapter?.host().checkWaitingTasks(); },
  ], (error) => { void logError("loop-wait-watchdog-failed", { error: errorToMessage(error) }); }, () => {
    if (!isExtensionDeactivating) loopPlusRuntimeAdapter?.host().checkInterruptedMainTasks();
  })));
  startConfigHeartbeat(context);
  void refreshCliInstallStatuses();
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "sinitek-cli-tools.openPanel";
  updateStatusBar();
  statusBarItem.show();
  viewProvider = new CliBridgeViewProvider(extensionUri, {
    onResetRuntimeState: () => { hasPendingPromptQueue = false; },
    onMessage: async (message) => {
      await handlePanelMessage(message);
    },
    onRequestHumanInteractionHistory: () => readHumanInteractionHistory(getHumanInteractionHistoryOptions()),
    onNotificationAuthorization: (request) => humanInteractionAttention!.notificationAuthorization(request),
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CliBridgeViewProvider.viewId, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
  scheduledTaskScheduler = new ScheduledTaskScheduler({
    readStore: readScheduledTasks,
    writeStore: writeScheduledTasks,
    getWorkspaceKey: () => activeWorkspaceKey,
    executeTask: executeScheduledTask,
    onChanged: () => { void postPanelState(); },
  });
  scheduledTaskScheduler.start();
  context.subscriptions.push(new vscode.Disposable(() => {
    scheduledTaskScheduler?.stop();
    scheduledTaskScheduler = null;
  }));
  registerExtensionCommands(context, {
    isCliName,
    getCurrentCli: () => currentCli,
    setCurrentCli,
    runCli,
    revealPanelView,
    postPanelState,
    openLoopGroupChatPanel,
    insertPromptPaths: (paths) => viewProvider?.insertPromptPaths(paths),
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("sinitek-cli-tools")) {
        if (!hasAnyTaskRunning()) {
          interactiveRunnerManager?.disposeAll();
        }
        setDebugLogging(getDebugLogging());
        currentCli = getDefaultCli();
        void refreshCliInstallStatuses();
        updateStatusBar();
        void postPanelState();
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      ensureWorkspaceSessionStore();
      void postPanelState();
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      postEditorContextState();
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === vscode.window.activeTextEditor) {
        postEditorContextState();
      }
    })
  );
  if (getAutoOpenPanel()) {
    void vscode.commands.executeCommand("sinitek-cli-tools.openPanel");
  }
}
export async function deactivate(): Promise<void> {
  departmentExecutionProducer?.closeAll();
  isExtensionDeactivating = true;
  departmentRuntimeComposition?.dispose();
  // Revokes the sole synchronous writer before draining it; a failed handoff retains its marker.
  const ownerClosed = departmentOwnershipIndex?.close();
  conversationTaskSummaries.dispose();
  void humanInteractionAttention?.dispose();
  humanInteractionAttention = undefined;
  void restoreMarketplaceUpdateCheck();
  scheduledTaskScheduler?.stop();
  scheduledTaskScheduler = null;
  stopAllRuns();
  if (ownerClosed && !await ownerClosed) await logError("department-owner-close-blocked", { reason: "写者静止或事务恢复尚未确认，保留 owner marker" });
}
function stopAllRuns(): void {
  isExtensionDeactivating = true;
  promptAutoRepairController.cancelAll();
  for (const [tabId, run] of Array.from(interactiveRunsByTabId.entries())) {
    try {
      run.stop();
    } catch (error) {
      void logError("deactivate-stop-interactive-run-failed", {
        tabId,
        runId: run.runId,
        cli: run.cli,
        error: error instanceof Error ? error.message : String(error),
      });
      interactiveRunsByTabId.delete(tabId);
    }
  }
  for (const [tabId, run] of Array.from(parallelRunsByTabId.entries())) {
    try {
      stopParallelRunForTab(tabId, t("run.stoppedByUser"));
    } catch (error) {
      void logError("deactivate-stop-parallel-run-failed", {
        tabId,
        runId: run.runId,
        cli: run.cli,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        run.process.kill();
      } catch {
        // ignore shutdown cleanup errors
      }
      parallelRunsByTabId.delete(tabId);
    }
  }
  const activeStop = primaryPromptRunController.activeInteractiveStop;
  if (activeStop) {
    try {
      activeStop();
    } catch (error) {
      void logError("deactivate-stop-active-interactive-failed", {
        cli: primaryPromptRunController.activeCliForRun,
        runId: primaryPromptRunController.activeRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (primaryPromptRunController.activeInteractiveStop === activeStop) {
        primaryPromptRunController.activeInteractiveStop = null;
      }
    }
  }
  if (primaryPromptRunController.activeProcess) {
    try {
      stopActiveRun();
    } catch (error) {
      void logError("deactivate-stop-active-process-failed", {
        cli: primaryPromptRunController.activeCliForRun ?? currentCli,
        runId: primaryPromptRunController.activeRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        primaryPromptRunController.activeProcess?.kill();
      } catch {
        // ignore shutdown cleanup errors
      }
      clearActiveRun();
    }
  }

  interactiveRunnerManager?.disposeAll();
}

async function maybeDisableMarketplaceUpdateCheckInDev(
  context: vscode.ExtensionContext
): Promise<void> {
  if (context.extensionMode !== vscode.ExtensionMode.Development) {
    return;
  }

  const config = vscode.workspace.getConfiguration("sinitek-cli-tools");
  const shouldDisable = config.get<boolean>("disableMarketplaceUpdateCheckInDev", true);
  if (!shouldDisable) {
    return;
  }

  const extensionsConfig = vscode.workspace.getConfiguration("extensions");
  const autoCheckUpdates = extensionsConfig.get<boolean>("autoCheckUpdates");
  const autoUpdate = extensionsConfig.get<boolean>("autoUpdate");
  const needsUpdate = autoCheckUpdates !== false || autoUpdate !== false;

  if (!needsUpdate) {
    return;
  }

  updateCheckOverride = { autoCheckUpdates, autoUpdate };
  await Promise.all([
    extensionsConfig.update("autoCheckUpdates", false, vscode.ConfigurationTarget.Global),
    extensionsConfig.update("autoUpdate", false, vscode.ConfigurationTarget.Global),
  ]);
}

async function restoreMarketplaceUpdateCheck(): Promise<void> {
  if (!updateCheckOverride) {
    return;
  }

  const { autoCheckUpdates, autoUpdate } = updateCheckOverride;
  updateCheckOverride = null;
  const extensionsConfig = vscode.workspace.getConfiguration("extensions");
  await Promise.all([
    extensionsConfig.update("autoCheckUpdates", autoCheckUpdates, vscode.ConfigurationTarget.Global),
    extensionsConfig.update("autoUpdate", autoUpdate, vscode.ConfigurationTarget.Global),
  ]);
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function createWorkspaceLoopSubtaskExecutionRoot(workspaceCwd: string, grokExecutionRootId?: string, grokExecutionCwd?: string) {
  try {
    return createLoopSubtaskExecutionRoot(workspaceCwd, grokExecutionRootId
      ? { persistentCwd: resolveGrokLoopExecutionCwd(workspaceCwd, grokExecutionRootId, DATA_DIR, grokExecutionCwd) }
      : {});
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failure = new Error(t("run.loopSubtaskExecutionRootFailed", {
      name: isLoopSubtaskLinkFailedError(error) ? error.entryName : "workspace",
      detail,
    }));
    throw isLoopSubtaskLinkFailedError(error) ? Object.assign(failure, { cleanupResult: error.cleanupResult }) : failure;
  }
}


function isWindowsCmdCommand(command: string | undefined): boolean {
  if (!command || process.platform !== "win32") {
    return false;
  }
  const lower = command.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

function resolveBundledClaudeCliPath(): string | undefined {
  try {
    return require.resolve("@anthropic-ai/claude-agent-sdk/cli.js");
  } catch {
    return undefined;
  }
}

function resolveClaudeInteractiveEntrypoint(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }
  if (isWindowsCmdCommand(command)) {
    return resolveBundledClaudeCliPath();
  }
  return command;
}

function getScheduledTaskStoreDeps() {
  return {
    storeFile: path.join(DATA_DIR, "scheduled-tasks.json"),
    isCliName,
    isInteractiveMode,
    isThinkingMode,
    isTimestampWithinHistoryRetention,
    logError: (event: string, payload?: unknown) => { void logError(event, payload); },
  };
}

function readScheduledTasks() {
  return readScheduledTaskStore(getScheduledTaskStoreDeps());
}

function writeScheduledTasks(store: ReturnType<typeof readScheduledTasks>): void {
  writeScheduledTaskStore(store, {
    storeFile: getScheduledTaskStoreDeps().storeFile,
    logError: (event: string, payload?: unknown) => { void logError(event, payload); },
  });
}

function buildScheduledTasksState() {
  const store = readScheduledTasks();
  return buildScheduledTaskSummaries({
    tasks: store.tasks.filter((task) => task.workspaceKey === activeWorkspaceKey),
  });
}

async function schedulePromptTask(
  message: Extract<PanelMessage, { type: "scheduleTask" }>,
): Promise<{ task?: import("./webview/types").ScheduledTaskSummary; error?: string }> {
  const prompt = typeof message.prompt === "string" ? message.prompt.trim() : "";
  if (!prompt) {
    return { error: t("scheduledTaskPromptRequired") };
  }
  const scheduledAt = typeof message.scheduledAt === "number" ? message.scheduledAt : Number(message.scheduledAt);
  if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
    return { error: t("scheduledTaskTimeInvalid") };
  }
  const cli = typeof message.cli === "string" && isCliName(message.cli) ? message.cli : currentCli;
  const interactiveMode = isInteractiveMode(message.interactiveMode)
    ? normalizeVisibleInteractiveMode(message.interactiveMode)
    : getWorkspaceInteractiveMode(cli);
  if (interactiveMode === "department") {
    return { error: "产研部定时任务入口尚未接入，任务未创建。" };
  }
  const store = readScheduledTasks();
  const activeTaskCount = store.tasks.filter((task) => task.status === "pending" || task.status === "running").length;
  if (activeTaskCount >= SCHEDULED_TASK_MAX_COUNT) {
    return { error: t("scheduledTaskLimitReached", { max: SCHEDULED_TASK_MAX_COUNT }) };
  }
  const taskId = `scheduled_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const attachmentResult = await saveScheduledTaskAttachments(taskId, message.files ?? []);
  if (attachmentResult.error) {
    removeScheduledTaskAttachments(taskId);
    return { error: attachmentResult.error };
  }
  try {
    const task = createScheduledTaskRecord({
      id: taskId,
      prompt,
      scheduledAt,
      cli,
      tabId: typeof message.tabId === "string" && message.tabId.trim()
        ? message.tabId.trim()
        : getActiveConversationTabId(),
      workspaceKey: activeWorkspaceKey,
      interactiveMode,
      contextOptions: message.contextOptions,
      model: message.model,
      loopMainModel: message.loopMainModel,
      loopSubtaskModel: message.loopSubtaskModel,
      loopSubtaskCli: message.loopSubtaskCli,
      loopSubtaskConfigId: message.loopSubtaskConfigId,
      loopMainThinkingMode: isThinkingMode(message.loopMainThinkingMode)
        ? normalizeThinkingModeForCli(cli, message.loopMainThinkingMode)
        : undefined,
      loopSubtaskThinkingMode: isThinkingMode(message.loopSubtaskThinkingMode)
        ? normalizeThinkingModeForCli(message.loopSubtaskCli ?? cli, message.loopSubtaskThinkingMode)
        : undefined,
      attachments: attachmentResult.attachments,
    });
    upsertScheduledTask(store, task, Date.now());
    writeScheduledTasks(store);
    scheduledTaskScheduler?.notifyChanged();
    void logInfo("scheduled-task-created", {
      id: task.id,
      cli: task.cli,
      scheduledAt: task.scheduledAt,
      workspaceKey: task.workspaceKey,
      attachmentCount: task.attachments.length,
    });
    return { task: buildScheduledTaskSummaries({ tasks: [task] })[0] };
  } catch (error) {
    removeScheduledTaskAttachments(taskId);
    void logError("scheduled-task-create-failed", { error: String(error) });
    return { error: t("scheduledTaskSaveFailed") };
  }
}

function deleteScheduledTask(id: string): boolean {
  const store = readScheduledTasks();
  const task = store.tasks.find((candidate) => candidate.id === id && candidate.workspaceKey === activeWorkspaceKey);
  if (!task || task.status === "running") {
    return false;
  }
  const removed = removeScheduledTask(store, id);
  if (!removed) {
    return false;
  }
  writeScheduledTasks(store);
  removeScheduledTaskAttachments(id);
  scheduledTaskScheduler?.notifyChanged();
  void logInfo("scheduled-task-deleted", { id, workspaceKey: activeWorkspaceKey });
  return true;
}

function ensureScheduledTaskTargetTab(task: ScheduledTaskRecord): string | null {
  const existing = task.tabId ? getConversationTabById(task.tabId) : null;
  if (existing && existing.cli === task.cli) {
    return existing.id;
  }
  const previousTabId = getActiveConversationTabId();
  const previousCli = currentCli;
  addConversationTab(task.cli, null);
  const created = getActiveConversationTab();
  const targetTabId = created?.id ?? null;
  if (previousTabId && previousTabId !== targetTabId) {
    setActiveConversationTab(previousTabId);
  }
  currentCli = previousCli;
  updateStatusBar();
  return targetTabId;
}

function buildScheduledAttachmentPrompt(task: ScheduledTaskRecord): string {
  const references = task.attachments
    .map((attachment) => attachment.path.replace(/\\/g, "/").replace(/"/g, '\\"'))
    .map((filePath) => `@"${filePath}"`)
    .join(" ");
  return references ? `${task.prompt}\n\n${references}` : task.prompt;
}

async function executeScheduledTask(task: ScheduledTaskRecord): Promise<void> {
  if (task.workspaceKey !== activeWorkspaceKey) {
    throw new Error("Scheduled task workspace is no longer active.");
  }
  const executionConfig = resolveScheduledTaskExecutionConfigForTask(
    task,
    getWorkspaceInteractiveMode(task.cli),
  );
  try {
    assertModeAvailable(executionConfig.interactiveMode, readToolSettings());
  } catch (error) {
    throw error instanceof Error ? error : new Error("定时任务模式已关闭，任务未执行。");
  }
  if (executionConfig.interactiveMode === "department") {
    throw new Error("产研部定时任务入口尚未接入，任务未执行。");
  }
  const targetTabId = ensureScheduledTaskTargetTab(task);
  if (!targetTabId) {
    throw new Error("No conversation tab is available for the scheduled task.");
  }
  if (!await configApplyQueue.waitForIdle(task.cli)) {
    throw new Error("配置应用失败，定时任务未启动。");
  }
  assertModeAvailable(executionConfig.interactiveMode, readToolSettings());
  const displayPrompt = buildScheduledAttachmentPrompt(task);
  const contextBuild = buildPromptWithAutoContextFromPanelStateBuilder(displayPrompt, task.contextOptions);
  const modelPrompt = maybeInjectLongTermMemoryForPromptWithEditorContext(
    displayPrompt,
    contextBuild.modelPrompt,
    contextBuild.contextTags,
    {
      runtimeSettings: buildLongTermMemoryRuntimeSettings(),
      memoryPaths: getActiveWorkspaceMemoryPaths(),
      logError: (event, payload) => { void logError(event, payload); },
    },
  );
  const imagePaths = task.cli === "codex"
    ? await resolveCodexImagePathsForPrompt(displayPrompt)
    : [];
  const mainConfigId = getActiveConfigIdForCli(task.cli);
  const subtaskCli = task.loopSubtaskCli ?? task.cli;
  const subtaskConfigId = getActiveConfigIdForCli(subtaskCli);
  const mainModel = getSelectedLoopCliModel(task.cli, "main", mainConfigId)
    ?? getSelectedCliModel(task.cli, mainConfigId);
  const subtaskModel = getSelectedLoopCliModel(subtaskCli, "subtask", subtaskConfigId)
    ?? getSelectedCliModel(subtaskCli, subtaskConfigId);
  const input: PromptRunInput = {
    displayPrompt,
    modelPrompt,
    contextTags: contextBuild.contextTags,
    model: getSelectedCliModel(task.cli, mainConfigId) ?? undefined,
    loopMainModel: mainModel ?? undefined,
    loopSubtaskModel: subtaskModel ?? undefined,
    ...(task.loopSubtaskCli ? { loopSubtaskCli: task.loopSubtaskCli } : {}),
    loopSubtaskConfigId: subtaskConfigId ?? undefined,
    ...(imagePaths.length ? { imagePaths } : {}),
    throwOnError: true,
  };
  const target = resolvePromptRunTarget(targetTabId);
  if (!target) {
    throw new Error("Scheduled task conversation target is unavailable.");
  }
  const preparedInput = preloadUserMessageForPrompt(input, target);
  assertModeAvailable(executionConfig.interactiveMode, readToolSettings());
  if (executionConfig.interactiveMode === "loop" || executionConfig.interactiveMode === "loop_plus") {
    const loopPlusSchedulingMode = schedulingModeForInteractiveMode(executionConfig.interactiveMode);
    await runLoopPrompt(preparedInput, {
      targetTabId,
      resumeTaskId: null,
      resumeRequested: false,
      ...(loopPlusSchedulingMode ? { schedulingMode: loopPlusSchedulingMode } : {}),
    });
  } else {
    await runPrompt(preparedInput, { targetTabId });
  }
}

async function handlePanelMessage(message: PanelMessage): Promise<void> {
  await handlePanelMessageWithDeps(message, {
    updatePendingPromptQueueState: (hasPendingPrompts) => { hasPendingPromptQueue = hasPendingPrompts; },
    ensureWorkspaceSessionStore,
    postPanelState,
    reconcileRunningConversationTabs,
    sendSessionMessagesToPanel,
    getCurrentCli: () => currentCli,
    setCurrentCliValue: (cli) => { currentCli = cli; },
    getCurrentSessionId,
    showWebviewError: (title, detail, options) => void showErrorWithActions(title, detail, options),
    inspectModelManagerState,
    getActiveConversationTabBinding,
    setCurrentCli,
    setCurrentCliFromPanelSelection,
    disposeInteractiveRunnerIfUnused,
    syncCurrentSessionWithActiveTab,
    getActiveConfigIdForCli,
    getDepartmentConfigurationScope,
    getDepartmentSelectionContextRevision,
    invalidateDepartmentSelectionContext,
    readDepartmentConfigBinding: (cli) => configService.readSharedConfigSelection(cli),
    getDepartmentConfigurationIssue,
    beginDepartmentConfigurationSave: (scope, role) => departmentSaveBarrier.begin(scope, role),
    getDepartmentRoleCandidates: (cli, configId) => modelSettingsHost.getDepartmentRoleCandidates(cli, configId),
    startDepartmentPrompt: (request) => createPerformanceTrace("department", request.cli, "director").measure("organization-start",
      () => getDepartmentRuntimeComposition().startDepartmentPrompt(request)),
    isDepartmentContinuation: (tabId) => getDepartmentRuntimeComposition().isDepartmentContinuation(tabId),
    continueDepartmentPrompt: (request) => createPerformanceTrace("department", request.cli).measure("organization-continue",
      () => getDepartmentRuntimeComposition().continueDepartmentPrompt(request)),
    resolveDepartmentPromptConfiguration: async (request) => freezeDepartmentThinkingDefaults(
      await modelSettingsHost.resolveDepartmentPromptConfiguration(request.cli, request.acceptancePlanSelectionId), getEffectiveThinkingMode),
    selectCliModel,
    selectCliLoopModel,
    selectLoopSubtaskCli,
    selectLoopFrontendCli,
    selectLoopFullstackCli,
    selectLoopSubtaskMode,
    setLoopRoleExplicitModel,
    setLoopRoleThinking,
    seedLoopFullstackRole,
    updateOpenCodeRoleModel: updateOpenCodeRoleModelForConfig,
    manageKimiCodeModelList,
    cacheKimiCodeConfigModels: modelSettingsHost.cacheKimiCodeConfigModels,
    addCliModel,
    renameCliModel,
    deleteCliModel,
    moveCliModel,
    repairSupersededLocalSession,
    findConversationTabIdBySession,
    setActiveConversationTab,
    getConversationTabSelectionRevision: () => conversationTabSelectionRevision,
    setConversationTabSelectionRevision: (revision) => { conversationTabSelectionRevision = revision; },
    restoreConversationTabConfiguration,
    updateStatusBar,
    getWorkspaceSettings: () => workspaceSettings,
    saveWorkspaceSettings,
    setWorkspaceSettings: (settings) => { workspaceSettings = settings; },
    saveWorkspaceSettingsWithResult: (settings) => trySaveWorkspaceSettingsToStore(settings, getWorkspaceSettingsStoreOptions()),
    addConversationTab,
    startNewSession,
    getConversationTabById,
    hasAnyTaskRunning,
    disposeAllInteractiveRunners: () => interactiveRunnerManager?.disposeAll(),
    maybePromptInstallOnCliGroupSwitch,
    closeConversationTabAndRefreshPanel: (tabId, options) => closeConversationTabAndRefreshPanel(tabId, options),
    confirm: async (messageText, confirmLabel) => {
      const confirmed = await vscode.window.showWarningMessage(messageText, { modal: true }, confirmLabel);
      return confirmed === confirmLabel;
    },
    disposeInteractiveRunnerSession: (cli, sessionId) => interactiveRunnerManager?.disposeIfMatches(cli, sessionId),
    deleteSession,
    detachConversationTabsFromSession,
    loadSessionMessages,
    pruneChatMessages: (request) => sessionLifecycleController.pruneChatMessages(request),
    getSessionLoadError: (cli, sessionId) => sessionMessageLoadErrors.get(getSessionKey(activeWorkspaceKey, cli, sessionId)),
    postWebviewMessage: (payload) => viewProvider?.postMessage(payload),
    clearAllSessions,
    clearPromptHistory,
    setPromptHistoryFavorite,
    setPromptHistoryGlobal: (id, global) => modelSettingsHost.setPromptHistoryGlobal(id, global),
    setWorkspaceInteractiveModeForCli,
    resetConversationTabSession,
    getConfigManagerPanel: () => configManagerPanel,
    applyConfigById,
    waitForConfigApply: (cli) => configApplyQueue.waitForIdle(cli),
    pausePromptForTab: async (tabId) => {
      const workspaceKey = activeWorkspaceKey;
      const tab = getConversationTabById(tabId);
      const cli = tab?.cli;
      const sessionId = tab && cli ? getConversationTabSessionIdForCli(tab, cli) : null;
      const isCurrent = (): boolean => {
        const current = getConversationTabById(tabId);
        return !isExtensionDeactivating && workspaceKey === activeWorkspaceKey && !!tab && current === tab
          && current.cli === cli && getConversationTabSessionIdForCli(current, current.cli) === sessionId;
      };
      await promptRunHandoff.pause(tabId, () => stopRunForTab(tabId, null), isCurrent, async (isStillCurrent) => {
        if (cli === "codex") await interactiveRunnerManager?.waitForCodexSessionStopped(sessionId, isStillCurrent);
      });
    },
    readCliRules,
    writeCliRules,
    normalizeRuleTargets,
    isThinkingMode,
    normalizeThinkingModeForCli,
    setCliModelThinkingMode,
    getSelectedCliModel,
    getSelectedLoopCliModel,
    getSelectedLoopThinkingMode,
    setSelectedLoopThinkingMode,
    isInteractiveMode,
    normalizeVisibleInteractiveMode,

    loadModelStore: () => { modelStore = loadModelStore(); },
    isCliName,
    reloadStoredToolSettings: () => {
      reloadToolSettings();
      humanInteractionAttention?.refreshPreferences();
    },
    reloadWorkspaceSettings: () => { workspaceSettings = loadWorkspaceSettings(); },
    updateWorkspaceSettings: (update) => {
      let updated: WorkspaceSettings | undefined;
      const result = tryUpdateWorkspaceSettingsToStore((current) => {
        updated = update(current);
        return updated;
      }, getWorkspaceSettingsStoreOptions());
      if (!result.ok || !updated) return false;
      workspaceSettings = updated;
      return true;
    },
    updateStoredToolSettings,
    readStoredToolSettings: () => readToolSettings(),
    publishCliEnabled: () => {
      configManagerPanel?.postCliEnabled();
    },
    retargetDisabledLoopSubtaskSelections: (fallbackCli) => {
      retargetDisabledLoopSubtaskSelections(fallbackCli);
    },
    isMacTaskShell,
    confirmAndInitializeWorkspaceHarness,
    installCodeGraphForWorkspace,
    appendUserMessageForCli,
    runContextCompactionCommand,
    openLoopGroupChatPanel,
    getActiveConversationTabId,
    getActiveConversationTab,
    resolveLoopSubtaskConversationContext,

    buildPromptWithAutoContext: buildPromptWithAutoContextFromPanelStateBuilder,
    maybeInjectLongTermMemoryForPrompt: (displayPrompt, modelPrompt, contextTags) => (
      maybeInjectLongTermMemoryForPromptWithEditorContext(displayPrompt, modelPrompt, contextTags, {
        runtimeSettings: buildLongTermMemoryRuntimeSettings(),
        memoryPaths: getActiveWorkspaceMemoryPaths(),
        logError: (event, payload) => void logError(event, payload),
      })
    ),
    resolveCodexImagePathsForPrompt,
    getLatestLoopRoundRunRecord,
    recordPromptHistory,
    resolvePromptRunTarget,
    preloadUserMessageForPrompt: (input, target, options) => preloadUserMessageForPrompt(input, target, {
      captureTaskSummary: true,
      messageId: options?.messageId,
    }),
    runLoopPrompt,
    runPrompt,
    maybeWakeLoopMainAfterSubtaskContinuation,
    resolveLoopResumeTaskFromPrompt,
    isLoopResumePrompt,
    stopRunForTab,
    schedulePromptTask,
    deleteScheduledTask,
    resolveWorkspaceDropPaths: (uris) => Array.from(new Set(uris
      .map((uri) => vscode.Uri.parse(uri))
      .map((uri) => normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false))))),
    hasWorkspaceFolder: () => Boolean(vscode.workspace.workspaceFolders?.length),
    pickWorkspacePaths: async () => {
      const items = await buildWorkspacePathItems();
      const selections = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        matchOnDescription: true,
        ignoreFocusOut: true,
        placeHolder: t("pathPicker.placeholder"),
      });
      return selections?.map((item) => item.value);
    },
    persistCliCommand: persistCliCommand,
    updateOpenCodeVariant: updateOpenCodeVariantForCurrentSelection,
    updateOpenCodeVariantForConfig,
    resolveHumanInteractionResponse,
  });
}

async function manageKimiCodeModelList(
  change: import("./config/kimiCodeConfig").KimiCodeModelListChange,
  configId: string,
): Promise<{ applied: boolean; model: string | null; config: import("./config/kimiCodeConfig").KimiCodeConfigModels }> {
  let managed: { applied: boolean; model: string | null; config: import("./config/kimiCodeConfig").KimiCodeConfigModels } | null = null;
  const result = await configApplyQueue.request("kimi-code", {
    apply: async () => {
      managed = await modelSettingsHost.manageKimiCodeModelList(change, configId);
    },
    commit: () => undefined,
  });
  if (!managed) throw new Error("Kimi 模型配置未保存。");
  const saved = managed as { applied: boolean; model: string | null; config: import("./config/kimiCodeConfig").KimiCodeConfigModels };
  return { ...saved, applied: result === "applied" };
}

async function autoRepairUnresolvedCliCommands(): Promise<void> {
  try {
    const plans = await planUnresolvedCliCommandRepairs(
      Object.fromEntries(CLI_LIST.map((cli) => [cli, getCliCommand(cli)])),
      { onlyBareCommands: true },
    );
    let repairedCount = 0;
    for (const plan of plans) {
      if (plan.status !== "repaired" || !plan.nextCommand) {
        continue;
      }
      await persistCliCommand(plan.cli, plan.nextCommand);
      repairedCount += 1;
      void logInfo("cli-command-auto-repair", {
        cli: plan.cli,
        command: plan.nextCommand,
      });
    }
    if (repairedCount > 0) {
      void refreshCliInstallStatuses();
      void postPanelState();
    }
  } catch (error) {
    void logError("cli-command-auto-repair-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function persistCliCommand(cli: CliName, command: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const key = `commands.${cli}`;
  await config.update(key, command, vscode.ConfigurationTarget.Global);
  const inspected = config.inspect<string>(key);
  if (inspected?.workspaceFolderValue !== undefined) {
    await config.update(key, command, vscode.ConfigurationTarget.WorkspaceFolder);
  }
  if (inspected?.workspaceValue !== undefined) {
    await config.update(key, command, vscode.ConfigurationTarget.Workspace);
  }
}

async function buildPanelState(): Promise<PanelState> {
  return buildPanelStateWithConfigState();
}

async function buildPanelStateWithConfigState(
  configState?: PanelState["configState"]
): Promise<PanelState> {
  const selectionRevision = conversationTabSelectionRevision;
  ensureWorkspaceSessionStore();
  const states = await loadConfigStateByCli(
    loadConfigState,
    configState ? { cli: currentCli, state: configState } : undefined,
    (cli, error) => logError("panel-cli-config-state", { cli, error: errorToMessage(error) }),
  );
  await modelSettingsHost.refreshConfigModels(states);
  await refreshOpenCodeThinkingState(states[currentCli]);
  await refreshLoopSubtaskOpenCodeModels(states.opencode);
  return buildPanelStateFromConfigState(states[currentCli], states, selectionRevision);
}

function buildPanelStateFromConfigState(
  configState: PanelState["configState"],
  configStateByCli: PanelState["configStateByCli"],
  selectionRevision: number,
): PanelState {
  return buildPanelStateWithDeps({
    currentCli,
    configState,
    configStateByCli,
    workspaceSettings,
    workspaceHarnessInstalled: isWorkspaceHarnessInstalled(resolveWorkspaceCwd() ?? null),
    codeGraphInstalled: isCodeGraphWorkspaceIndexed(resolveWorkspaceCwd() ?? null),
    codeGraphInstalling: isCodeGraphInstalling(),
    processPlatform: process.platform,
    cliRulePathsGlobal: currentGlobalRulePaths(),
    getWorkspaceConfiguration: () => vscode.workspace.getConfiguration("sinitek-cli-tools"),
    getAutoAddEditorContextTags,
    getEffectiveLongTermMemoryEnabled,
    getGlobalAutoCompactContextAfterRun,
    getGlobalHumanInteractionEnabled,
    getGlobalNotificationSettings: () => resolveNotificationSettings(readToolSettings()),
    getGlobalLoopEnabled: () => readToolSettings().loopEnabled !== false,
    getGlobalLoopPlusEnabled: () => readToolSettings().loopPlusEnabled !== false,
    getGlobalDepartmentEnabled: () => readToolSettings().departmentEnabled === true,
    getGlobalHumanInteractionTimeoutMinutes,
    getGlobalHistoryRetentionDays: getHistoryRetentionDays,
    getGlobalChatMessageLimit: () => normalizeChatMessageLimit(readToolSettings().chatMessageLimit),
    getGlobalLoopGroupChatMessageLimit: () => normalizeChatMessageLimit(readToolSettings().loopGroupChatMessageLimit, LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT),
    getGlobalHideInstructionBubbles: () => readToolSettings().hideInstructionBubbles === true,
    getGlobalLoopPlusDecisionSubtaskMax,
    getDepartmentConfigurationScope,
    getDepartmentConfigurationIssue,
    getDepartmentDirector: () => modelSettingsHost.getDepartmentDirectorForPanel(),
    getGlobalDepartmentMaxLeaders: () => normalizeDepartmentMaxLeaders(readToolSettings().departmentMaxLeaders),
    getGlobalDepartmentMaxEmployees: () => normalizeDepartmentMaxEmployees(readToolSettings().departmentMaxEmployees),

    getDebugLogging,
    getCliEnabledByName: () => readToolSettings().cliEnabledByName,
    getMacTaskShell,
    getEffectiveThinkingMode,
    openCodeThinking: openCodeThinkingState,
    openCodeSmallThinking: openCodeSmallThinkingState,
    openCodeModels: openCodeModelsState,
    loopSubtaskOpenCodeModels: getLoopSubtaskOpenCodeModels(),
    getWorkspaceInteractiveMode,
    isInteractiveSupported,
    getProjectRulePaths,
    buildSessionState,
    buildConversationTabsState: () => ({ ...buildConversationTabsState(), selectionRevision }),
    buildPromptHistoryState,
    buildHumanInteractionHistoryState: () => readHumanInteractionHistory(getHumanInteractionHistoryOptions()),
    buildScheduledTasksState,
    buildLoopPlusAcceptancePlansState: () => buildLoopPlusAcceptancePlansPanelValue(workspaceSettings),
    getLoopPlusAcceptancePlanSelection: () => buildLoopPlusAcceptancePlanSelectionPanelValue(workspaceSettings),
    buildModelState,
    buildEditorContextState,
    resolveModelConfigIdForCli,
    getSelectedCliModel,
  });
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


async function postPanelState(): Promise<void> {
  const state = await buildPanelState();
  updateConfigHeartbeatSnapshot(state.currentCli, state.configState);
  viewProvider?.postState(state);
  replayOpenCodeTaskLists();
  reconcileRunningConversationTabs();
}

function postEditorContextState(): void {
  viewProvider?.postMessage({
    type: "editorContext",
    payload: buildEditorContextState(),
  });
}

type PendingHumanInteraction = {
  request: HumanInteractionRequest;
  resolve: (submission: HumanInteractionSubmission) => void;
  reject: (error: Error) => void;
};

const pendingHumanInteractionsById = new Map<string, PendingHumanInteraction>();
const pendingHumanInteractionIdsByTabId = new Map<string, Set<string>>();
let humanInteractionAttention: ReturnType<typeof createHumanInteractionAttentionHost> | undefined;
let hasPendingPromptQueue = false;

function waitForOrchestratorClarificationWithAttention(
  ...args: Parameters<typeof waitForOrchestratorClarification>
): ReturnType<typeof waitForOrchestratorClarification> {
  const [scopeId, request] = args;
  return withHumanInteractionAttention(humanInteractionAttention, `${scopeId}:${request.interactionId}`,
    () => waitForOrchestratorClarification(...args));
}

function getHumanInteractionHistoryOptions() {
  return {
    filePath: getHumanInteractionHistoryFilePath(HUMAN_INTERACTION_HISTORY_DIR, activeWorkspaceKey),
  };
}

function recordHumanInteractionResponse(
  request: HumanInteractionRequest,
  submission: HumanInteractionSubmission,
): void {
  recordHumanInteractionHistory(request, submission, getHumanInteractionHistoryOptions());
}

function recordOrchestratorInteractionResponse(
  request: HumanInteractionRequest,
  submission: HumanInteractionSubmission,
): void {
  recordHumanInteractionHistory(request, submission, getHumanInteractionHistoryOptions(), "orchestrator");
}

function cleanupHumanInteractionHistoryRetention(): void {
  cleanupHumanInteractionHistoryAcrossWorkspaces(HUMAN_INTERACTION_HISTORY_DIR);
  cleanupHumanInteractionHistory({ filePath: LEGACY_HUMAN_INTERACTION_HISTORY_FILE });
}

function rememberPendingHumanInteraction(entry: PendingHumanInteraction): void {
  pendingHumanInteractionsById.set(entry.request.interactionId, entry);
  const ids = pendingHumanInteractionIdsByTabId.get(entry.request.tabId) ?? new Set<string>();
  ids.add(entry.request.interactionId);
  pendingHumanInteractionIdsByTabId.set(entry.request.tabId, ids);
  void humanInteractionAttention?.request(entry.request.interactionId);
}

function forgetPendingHumanInteraction(interactionId: string): PendingHumanInteraction | null {
  const entry = pendingHumanInteractionsById.get(interactionId);
  if (!entry) {
    return null;
  }
  pendingHumanInteractionsById.delete(interactionId);
  void humanInteractionAttention?.complete(interactionId);
  const ids = pendingHumanInteractionIdsByTabId.get(entry.request.tabId);
  if (ids) {
    ids.delete(interactionId);
    if (ids.size === 0) {
      pendingHumanInteractionIdsByTabId.delete(entry.request.tabId);
    }
  }
  return entry;
}

function getGlobalHumanInteractionTimeoutMinutes(): number {
  return resolveHumanInteractionTimeoutMinutes(readToolSettings().humanInteractionTimeoutMinutes);
}

function requestHumanInteraction(request: HumanInteractionRequest): Promise<HumanInteractionSubmission> {
  if (!viewProvider) {
    recordHumanInteractionResponse(request, {
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "aborted",
      values: {},
    });
    return Promise.resolve({
      interactionId: request.interactionId,
      tabId: request.tabId,
      status: "aborted",
      values: {},
    });
  }
  const existing = forgetPendingHumanInteraction(request.interactionId);
  if (existing) {
    existing.reject(createHumanInteractionRejectedError());
  }
  return new Promise((resolve, reject) => {
    const timeout = createInteractionTimeout(readHumanInteractionTimeoutMs(), () => {
      const entry = forgetPendingHumanInteraction(request.interactionId);
      if (!entry) {
        return;
      }
      viewProvider?.postMessage({
        type: "humanInteractionCancel",
        tabId: request.tabId,
      });
      entry.resolve(buildTimedOutHumanInteractionSubmission(request));
    });
    const resolveOnce = (submission: HumanInteractionSubmission): void => {
      timeout.clear();
      recordHumanInteractionResponse(request, submission);
      resolve(submission);
    };
    const rejectOnce = (error: Error): void => {
      timeout.clear();
      recordHumanInteractionResponse(request, {
        interactionId: request.interactionId,
        tabId: request.tabId,
        status: 'aborted',
        values: {},
      });
      reject(error);
    };
    rememberPendingHumanInteraction({ request, resolve: resolveOnce, reject: rejectOnce });
    void logInfo("humanInteraction-request", {
      tabId: request.tabId,
      interactionId: request.interactionId,
      fields: request.formFields.length,
      timeoutMs: readHumanInteractionTimeoutMs(),
    });
    viewProvider?.postMessage({ type: "humanInteractionRequest", request });
  });
}

function resolveHumanInteractionResponse(submission: HumanInteractionSubmission): void {
  const entry = forgetPendingHumanInteraction(submission.interactionId);
  if (!entry) {
    return;
  }
  if (submission.tabId && submission.tabId !== entry.request.tabId) {
    entry.reject(createHumanInteractionRejectedError());
    return;
  }
  entry.resolve({
    interactionId: entry.request.interactionId,
    tabId: entry.request.tabId,
    status: submission.status === "completed" ? "completed" : "aborted",
    values: submission.values && typeof submission.values === "object" && !Array.isArray(submission.values)
      ? submission.values
      : {},
  });
}

function cancelHumanInteractionForTab(tabId: string, statusText?: string): void {
  const ids = Array.from(pendingHumanInteractionIdsByTabId.get(tabId) ?? []);
  ids.forEach((interactionId) => {
    const entry = forgetPendingHumanInteraction(interactionId);
    if (!entry) {
      return;
    }
    recordHumanInteractionResponse(entry.request, {
      interactionId: entry.request.interactionId,
      tabId: entry.request.tabId,
      status: "aborted",
      values: {},
    });
    entry.reject(createHumanInteractionRejectedError());
  });
  viewProvider?.postMessage({
    type: "humanInteractionCancel",
    tabId,
    ...(statusText ? { statusText } : {}),
  });
}

const promptRunRuntimeHost = createPromptRunRuntimeHost({
  isDepartmentOrganizationTask: (task) => readDepartmentRootControl(task) !== null,
  resumeWaitingClassicBatch: (taskId) => requireLoopOrchestrationHost().resumeWaitingBatch(taskId)
    || loopOrchestrationOwnership.getCount(taskId) > 0,
  decisionSubtaskMax: () => getEffectiveLoopPlusDecisionSubtaskMax(),
  getActiveWorkspaceKey: () => activeWorkspaceKey, getConversationTabById: (tabId) => getConversationTabById(tabId), getConversationTabs: () => ensureConversationTabs().tabs, createConversationTabId: () => createConversationTabId(), persistConversationTabsToWorkspaceSettings: () => persistConversationTabsToWorkspaceSettings(), postPanelState: () => postPanelState(), loadSessionMessages: (cli, sessionId) => loadSessionMessages(cli, sessionId), persistMessagesForTab: (cli, sessionId, tabId, messages) => persistMessagesForTab(cli, sessionId, tabId, messages), getPendingSessionDraft: (tabId, cli) => getPendingSessionDraft(tabId, cli), updatePendingSessionDraft: (tabId, patch, cli) => updatePendingSessionDraft(tabId, patch, cli), sendPanelMessage: (payload) => sendPanelMessage(payload), createMessageId: () => createMessageId(), readTaskStore: () => readTaskStore(), writeTaskStore: (store) => writeTaskStore(store), appendLoopMainSubChatMainDecision: (task, decision, subtasks) => appendLoopMainSubChatMainDecision(task, decision, subtasks), buildLoopGroupChatMessageAction: (taskId, round) => buildLoopGroupChatMessageAction(taskId, round), runLoopPrompt: (input, options) => runLoopPrompt(input, options), isTabRunActive: (tabId) => isTabRunActive(tabId), refreshOpenLoopGroupChatPanelForTask: (taskId) => refreshOpenLoopGroupChatPanelForTask(taskId), resolveConversationTabLoopContext: (tab) => resolveConversationTabLoopContext(tab), resolveLoopTaskSessionId: (target) => resolveLoopTaskSessionId(target), isLoopTaskBlockedByMainAiFailureLimit: (task) => isLoopTaskBlockedByMainAiFailureLimit(task), appendLoopMainSubChatSubtaskFinished: (task, subtask, runStatus, assistantContent) => appendLoopMainSubChatSubtaskFinished(task, subtask, runStatus, assistantContent), closeConversationTabAndRefreshPanel: (tabId) => closeLoopSubtaskTabAndRefreshPanel(tabId), prepareSubtaskTabClose: prepareLoopSubtaskTabClose, handleLoopPlusSubtaskContinuation: (context, tabId) => handleLoopPlusSubtaskContinuation(context, tabId), stopLoopPlusParent: (taskId) => stopLoopPlusParent(taskId) });
const { resolvePromptRunTarget, collectRecentLoopTaskIdsForTarget, isLoopTaskCompatibleWithTarget, findResumableLoopTaskForTarget, getLoopMessagesForTarget, resolveLoopSubtaskConversationContext, isLoopSubtaskConversationTarget, getLastLoopAssistantContent, parseLoopMainDecision, extractJsonObjectText, normalizeLoopMainDecision, normalizeLoopEstimatedRemainingRounds, normalizeLoopSubtaskDecisions, normalizeSingleLoopSubtaskDecision, normalizeLoopRoundSummaries, normalizeSingleLoopRoundSummary, normalizeLoopAcceptance, normalizeLoopAcceptanceChecks, buildLoopSubtaskId, applyLoopMainDecision, getLoopDecisionSubtasks, appendLoopMainDecisionSummary, buildLoopSubtaskDecisionMarkdown, upsertLoopSubtask, upsertLoopSubtasks, getActiveLoopSubtaskIds, markLoopSubtaskRunFinished, finalizeLoopSubtaskRun, buildLoopSubtaskCompletionSummary, appendLoopSubtaskCompletionAutoLog, markLoopTaskInterrupted, isLoopTaskExecutionInterrupted, markLoopTaskStopped, markLoopTaskStoppedByUser, markLoopTaskStoppedAfterRuntimeEnded, resolvePromptRunTargetFromConversationTab, prepareLoopOriginContinuationTarget, resolveLoopMainPromptTarget, maybeWakeLoopMainAfterSubtaskContinuation, getLoopTargetSessionId, persistLoopMessagesForTarget, removeLoopMainDecisionMessage, replaceLoopMainDecisionMessageWithMarkdown, showLoopSubtaskDecisionMarkdown, hasCompleteLoopCompletionMessagesForTask, appendLoopAnswerConclusionMessage, appendLoopFinalSummaryMessage, appendSystemMessageForLoop, getLoopRoundRunStatus, getLatestLoopRoundRunRecord } = promptRunRuntimeHost;
const { removeLoopPlusClarificationResponse } = promptRunRuntimeHost;
const modelSettingsHost = createModelSettingsHost({ getDepartmentConfigurationScope, getDepartmentConfigurationIssue, getCurrentCli: () => currentCli, setCurrentCli: (cli) => { currentCli = cli; }, getModelStore: () => modelStore, setModelStore: (store) => { modelStore = store; }, getWorkspaceSettings: () => workspaceSettings, setWorkspaceSettings: (settings) => { workspaceSettings = settings; }, getPromptHistoryStore: () => promptHistoryStore, setPromptHistoryStore: (store) => { promptHistoryStore = store; }, getModelSelectionStoreState: () => modelSelectionStoreState, getActiveWorkspaceKey: () => activeWorkspaceKey, getConfigHeartbeatSnapshot: () => configHeartbeatCoordinator.getSnapshot(), getOpenCodeThinkingState: () => openCodeThinkingState, setOpenCodeThinkingState: (state) => { openCodeThinkingState = state; }, getOpenCodeSmallThinkingState: () => openCodeSmallThinkingState, setOpenCodeSmallThinkingState: (state) => { openCodeSmallThinkingState = state; }, getOpenCodeModelsState: () => openCodeModelsState, setOpenCodeModelsState: (state) => { openCodeModelsState = state; }, getOpenCodeThinkingContextKey: () => openCodeThinkingContextKey, setOpenCodeThinkingContextKey: (value) => { openCodeThinkingContextKey = value; }, getOpenCodeThinkingConfigId: () => openCodeThinkingConfigId, setOpenCodeThinkingConfigId: (value) => { openCodeThinkingConfigId = value; }, getOpenCodeThinkingExactModels: () => openCodeThinkingExactModels, setOpenCodeThinkingExactModels: (value) => { openCodeThinkingExactModels = value; }, getOpenCodeThinkingRequestId: () => openCodeThinkingRequestId, setOpenCodeThinkingRequestId: (value) => { openCodeThinkingRequestId = value; }, getWorkspacePreferredConfigIdForCli: (cli) => getWorkspacePreferredConfigIdForCli(cli), resolveModelConfigIdForCli: (cli, configState) => resolveModelConfigIdForCli(cli, configState), postPanelState: () => postPanelState(), resolveWorkspaceCwd: () => resolveWorkspaceCwd(), getExtensionUri: () => extensionUri, updateStatusBar: () => updateStatusBar(), getActiveConversationTab: () => getActiveConversationTab(), getActiveConversationTabId: () => getActiveConversationTabId(), getConversationTabById: (tabId) => getConversationTabById(tabId), isTabRunActive: (tabId) => isTabRunActive(tabId), preloadUserMessageForPrompt: (input, target) => preloadUserMessageForPrompt(input, target), resolvePromptRunTarget: (tabId) => resolvePromptRunTarget(tabId), runPrompt: (input, options) => runPrompt(input, options), sanitizeConversationTabRecord: (value) => sanitizeConversationTabRecord(value), logError: (event, payload) => logError(event, payload) });
const { getOpenCodeThinkingStateForRole, setOpenCodeThinkingStateForRole, persistOpenCodeVariant, updateOpenCodeVariantForCurrentSelection, updateOpenCodeVariantForConfig, resolveOpenCodeRoleModelsForConfig, refreshOpenCodeThinkingState, getOpenCodeVariantForRun, resolvePromptRunTargetSessionId, resolveLoopTaskSessionId, isLoopTaskBlockedByMainAiFailureLimit, normalizeThinkingModeForCli, getWorkspaceThinkingMode, getCliModelThinkingKey, getStoredCliModelThinkingMode, setCliModelThinkingMode, getEffectiveThinkingMode, getWorkspaceInteractiveMode, setWorkspaceInteractiveModeForCli, getGlobalHumanInteractionEnabled, shouldRequireExplicitFinalAnswerForRun, buildLongTermMemoryRuntimeSettings, getLongTermMemoryDisabledReason, getEffectiveLongTermMemoryEnabled, getActiveWorkspaceMemoryPaths, ensureActiveWorkspaceHarnessScaffold, confirmAndInitializeWorkspaceHarness, createCodeGraphTerminal, installCodeGraphForWorkspace, isCodeGraphInstalling, buildArchitectureInitializationModelPrompt, maybePromptInitializeArchitectureWithAi, getGlobalAutoCompactContextAfterRun, getGlobalLoopPlusDecisionSubtaskMax, getModelStoreOptions, getWorkspaceSettingsStoreOptions, getPromptHistoryStoreOptions, errorToMessage, ensureCliModelStore, readModelStore, writeModelStore, loadModelStore, getActiveConfigIdForCli, getSelectedCliModel, getSelectedLoopCliModel, getSelectedLoopThinkingMode, getSelectedLoopSubtaskCli, getSelectedLoopFrontendCli, selectLoopSubtaskCli, selectLoopFrontendCli, selectLoopFullstackCli, getSelectedLoopFullstackCli, selectLoopSubtaskMode, getSelectedLoopSubtaskMode, setLoopRoleExplicitModel, setLoopRoleThinking, seedLoopFullstackRole, getLoopRoleExplicitModel, refreshLoopSubtaskOpenCodeModels, getLoopSubtaskOpenCodeModels, getManagedModelOptionsForCli, getModelOptionsForCli, selectCliModel: selectCliModelFromStore, selectCliLoopModel: selectCliLoopModelFromStore, setSelectedLoopThinkingMode, updateOpenCodeRoleModelForConfig: updateOpenCodeRoleModelForConfigFromStore, addCliModel, renameCliModel, deleteCliModel, moveCliModel, getEffectiveCliArgs, buildModelState, loadWorkspaceSettings, saveWorkspaceSettings, loadPromptHistoryStore, ensurePromptHistoryStore, buildPromptHistoryState, recordPromptHistory, setPromptHistoryFavorite, clearPromptHistory, setPromptHistoryGlobal, getPromptHistoryFilePath, readPromptHistoryFile, writePromptHistoryFile, deletePromptHistoryFile, cleanupPromptHistoryRetentionAcrossWorkspaces, collectWorkspaceKeysForPromptHistoryCleanup } = modelSettingsHost;
const getEffectiveLoopPlusDecisionSubtaskMax = modelSettingsHost.getEffectiveLoopPlusDecisionSubtaskMax;

function selectCliModel(cli: CliName, model: string | null, configId: string | null = getActiveConfigIdForCli(cli)): void {
  selectCliModelFromStore(cli, model, configId);
}

function selectCliLoopModel(
  cli: CliName,
  role: "main" | "subtask",
  model: string | null,
  configId: string | null = getActiveConfigIdForCli(cli),
): void {
  selectCliLoopModelFromStore(cli, role, model, configId);
}

async function updateOpenCodeRoleModelForConfig(
  role: OpenCodeModelRoleInput,
  model: string | null,
  configId: string | null,
): Promise<string | null> {
  return updateOpenCodeRoleModelForConfigFromStore(role, model, configId);
}
const sessionTabsHost = createExtensionSessionTabsHost({
  readOrdinaryConversationTabTaskRecord: readKnownOrdinaryLoopTaskRecord,
  readDepartmentTaskRecord: (taskId) => departmentOwnershipIndex?.readTaskRecord(taskId) ?? null,
  readDepartmentLeaderTaskIds: (rootTaskId, leaderSubtaskId) => departmentOwnershipIndex?.readDepartmentLeaderTaskIds(rootTaskId, leaderSubtaskId) ?? null,
  onSubtaskTabCreated: (tabId) => sendRunStatusForTab(tabId, "start"),

  postConversationTabClosed: (tabId, activeTabId) => sendPanelMessage({ type: "conversationTabClosed", tabId, activeTabId }),
  getSessionTabsController: () => sessionTabsController, getSessionLifecycleController: () => sessionLifecycleController, getSessionStore: () => sessionStore, setSessionStore: (store) => { sessionStore = store; }, getCurrentCli: () => currentCli, setCurrentCli: (cli) => { currentCli = cli; }, getActiveWorkspaceKey: () => activeWorkspaceKey, getWorkspaceSettings: () => workspaceSettings, saveWorkspaceSettings: (settings) => saveWorkspaceSettings(settings), getLoopGroupChatTasks: () => loopGroupChatChatPanelCoordinator.listGroupChatTasks(), getPrimaryRunTabId: () => getPrimaryRunTabId(), getActiveTaskRun: () => primaryPromptRunController.activeTaskRun, getLiveMessagesForTab: (tabId) => getLiveMessagesForTab(tabId), getPendingSessionDraft: (tabId, cli) => getPendingSessionDraft(tabId, cli), getActiveTabIdForRun: () => primaryPromptRunController.activeTabIdForRun, getActiveSessionId: () => primaryPromptRunController.activeSessionId, persistSessionStore: persistSessionStoreToStorage, getSessionStoreKey: (workspaceKey) => getSessionStoreKey(workspaceKey), loadSessionMessages: (cli, sessionId) => loadSessionMessages(cli, sessionId), saveSessionMessages: (cli, sessionId, messages) => saveSessionMessages(cli, sessionId, messages), buildSessionLabelFromPrompt: (prompt) => buildSessionLabelFromPrompt(prompt), shouldUseFallbackSessionLabel: (label) => shouldUseFallbackSessionLabel(label), isTabRunActive: (tabId) => isTabRunActive(tabId), isLoopMainTabCloseLocked: (tabId) => isLoopMainTabCloseLocked(tabId), postPanelState: () => postPanelState(), updateStatusBar: () => updateStatusBar(), maybePromptInstallOnCliGroupSwitch: (cli) => maybePromptInstallOnCliGroupSwitch(cli), sendSessionMessagesToPanel: (cli, sessionId, tabId) => sendSessionMessagesToPanel(cli, sessionId, tabId), restoreConversationTabConfiguration: (tabId) => restoreConversationTabConfiguration(tabId), getInteractiveSessionBindingsForTab: (tab) => getInteractiveSessionBindingsForTab(tab), disposeInteractiveRunnerIfUnused: (binding) => disposeInteractiveRunnerIfUnused(binding as InteractiveSessionBinding), setWorkspaceInteractiveModeForCli: (cli, mode) => setWorkspaceInteractiveModeForCli(cli, mode), resolveAutoInteractiveModeForConversationTab, extractSessionId: (cli, buffer) => extractSessionId(cli, buffer) ?? null, isLocalSessionId: (sessionId) => isLocalSessionId(sessionId), migrateLocalSessionToTargetSession: (cli, from, to, options) => migrateLocalSessionToTargetSession(cli, from, to, options), adoptSessionId: (cli, sessionId, tabId) => adoptSessionId(cli, sessionId, tabId), getActiveTaskRunMutable: () => primaryPromptRunController.activeTaskRun, logInfo: (event, payload) => { void logInfo(event, payload); }, activeData: { WORKSPACE_KEY_FALLBACK, LEGACY_SESSION_FILE, SESSION_DIR, SESSION_BUFFER_LIMIT } });
const { loadSessionStore, cleanupSessionRetentionAcrossWorkspaces, buildSessionState, resolveSessionFirstPrompt, ensureLatestSessionForCli, getLatestSessionId, getCurrentSessionId, buildOpenConversationTabSessionMap, buildConversationTabsState, initializeConversationTabsFromWorkspaceSettings, sanitizeConversationTabRecord, ensureConversationTabs, persistConversationTabsToWorkspaceSettings, getConversationTabById, getActiveConversationTabId, getActiveConversationTab, getActiveConversationSessionId, findConversationTabIdBySession, updateActiveConversationTabSession, setActiveConversationTab, switchVisibleConversationTabForLoop, createLoopSubtaskRunTarget, addConversationTab, closeConversationTab, closeConversationTabAndRefreshPanel, detachConversationTabsFromSession, syncCurrentSessionWithActiveTab, setCurrentSession, startNewSession, markConversationTabExecutionLocked, resetConversationTabSession, captureSessionFromBuffer, adoptDetectedSessionId, adoptFreshOpenCodeLoopRecoverySession, touchSession, updateSessionBuffer, createConversationTabId, getPendingSessionDraft, updatePendingSessionDraft, clearPendingSessionDraft, ensureLocalSession, preparePendingLabel, assignPendingLabel, persistActiveMessages } = sessionTabsHost;

loopOrchestrationHost = createLoopOrchestrationHost({
  handleDepartmentDecision: (request) => getDepartmentRuntimeComposition().handleDirectorDecision(request),
  isTabRunActive,
  getActiveConversationTabId,
  hasActiveSubtasks: hasActiveLoopSubtasks,
  cancelSubtaskInvocation: (tabId) => cancelLoopPlusInvocation(tabId),
  decisionSubtaskMax: () => getEffectiveLoopPlusDecisionSubtaskMax(),
  getActiveConfigIdForCli,
  appendLoopRound,
  appendMessageToStore,
  appendSystemMessageForLoop,
  applyLoopMainDecision,
  bindLoopTaskToSession,
  buildLoopCompletedConclusionAndSummaryMarkdown,
  buildLoopMainSubSubtaskTurnBody,
  buildLoopRoundSummary,
  buildLoopSubtaskBatchCompletedText,
  buildLoopSubtaskBatchStartedText,
  buildLoopSubtaskCommunicationFile,
  buildLoopSubtaskExecutionGroupStartedText,
  buildLoopSubtaskExecutionPlan,
  buildLoopSubtaskRetryText,
  buildLoopSubtaskStartedText,
  buildLoopSupplementalRequirementsLines,
  buildResetLoopMainAiFailureState,
  buildSubagentProgressLabels,
  closeConversationTabAndRefreshPanel,
  createLoopSubtaskProgressMonitor,
  createLoopSubtaskRunTarget,
  createMessageId,
  createSubagentProgressController,
  ensureLoopMainSubChatTranscript,
  errorToMessage,
  finalizeLoopSubtaskRun,
  formatLoopEstimatedRemainingRounds,
  formatLoopGroupChatMemberName,
  getActiveLoopSubtaskIds,
  getLastLoopAssistantContent,
  getLoopCommunicationPaths,
  getLoopMainSubChatMainTitle,
  getLoopMessagesForTarget,
  getLoopRoundRunStatus,
  getLatestLoopRoundRunRecord,
  getLoopSubtaskDisplayTitle,
  isLoopTaskExecutionInterrupted,
  logError,
  mapLoopRunStatusToSubagentStatus,
  markLoopSubtaskRunFinished,
  markLoopTaskInterrupted,
  normalizeLoopContinuePromptForPrompt,
  parseLoopMainDecision,
  removeLoopMainDecisionMessage,
  persistLoopMessagesForTarget,
  prepareLoopSubtaskCommunicationFile,
  readLoopTaskRecord,
  refreshOpenLoopGroupChatPanelForTask,
  resolveLoopAnswerConclusion,
  resolveLoopTaskSessionId,
  resolvePromptRunModelForRole,
  resolvePromptRunTargetSessionId,
  resolvePromptRunThinkingModeForRole,
  runPrompt,
  sendPanelMessage,
  switchVisibleConversationTabForLoop,
  t,
  updateLoopTaskRecord,
});

const { runPromptParallel, stopParallelRunForTab } = createPromptParallelRuntimeHost({
  AI_TASK_RAW_OUTPUT_MAX_BYTES,
  HIDDEN_RETRY_MAX_RETRIES,
  OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
  adoptDetectedSessionId,
  adoptFreshOpenCodeLoopRecoverySession,
  appendBoundedUtf8Text,
  appendHiddenRetryErrorTraceMessage,
  appendMessageToStore,
  appendOpenCodeFinalTextToTabStream,
  appendTaskRun,
  applyThinkingWorkspaceFiles,
  buildHiddenRetryFailureMessage,
  buildHiddenRetryLimitMessage,
  buildHiddenRetryPrompt,
  buildHiddenRetryQueuedMessage,
  buildHiddenRetryStartedMessage,
  buildOpenCodeFailureMessage,
  buildOpenCodeMissingFinalConclusionMessage,
  buildProcessLabel,
  buildSubagentProgressLabels,
  buildTaskRunCompletionText,
  buildThinkingPrompt,
  buildUserChatMessage,
  consumeOpenCodeTabStreamChunk,
  createDisabledOpenCodeSubagentMonitor,
  createMessageId,
  createOpenCodeSubagentMonitor,
  createOpenCodeTabStreamState,
  createSubagentProgressController,
  extractSessionId,
  getAttemptFailureMessage,
  getEffectiveThinkingMode,
  getGlobalHumanInteractionEnabled,
  getHiddenRetryDelayMs,
  getPendingSessionDraft,
  hasAssistantFinalConclusionAfterMessage,
  isHiddenRetryEligibleAttempt,
  isLocalSessionId,
  loadSessionMessages,
  logDebug,
  logError,
  logInfo,
  maybeAutoCompactContextAfterPromptSuccess,
  maybePersistLongTermMemoryFromRun,
  normalizeTraceContentForDisplay,
  parallelRunsByTabId,
  parseOpenCodeRunOutput,
  persistMessagesForTab,
  prepareOpenCodeRuntime,
  prepareOpenCodeSubagentRuntime,
  preparePendingLabel,
  requestHumanInteraction,
  cancelHumanInteractionForTab,
  resetHiddenRetryCountOnRecoveredReply,
  resolveCliSessionIdForResume,
  resolveOpenCodeSuccessfulExitOutcome,
  resolveTraceKind,
  resolveTraceMerge,
  resolveWorkspaceCwd,
  runCliStream,
  sendOpenCodeTaskListUpdate,
  sendPanelMessage,
  sendRunStatusForTab,
  shouldAutoCompactContextAfterRunForTarget,
  shouldRecoverOpenCodeLoopMainSessionInFreshSession,
  shouldRequireExplicitFinalAnswerForRun,
  t,
  updateSessionBuffer,
  waitForHiddenRetryDelay,
});
const { runPromptInteractive } = createPromptInteractiveRuntimeHost({
  readRuntimeConfigFingerprint: configService.readRuntimeConfigFingerprint,
  AI_TASK_RAW_OUTPUT_MAX_BYTES,
  activeRunsByTabId: interactiveRunsByTabId,
  takeOverSessionForTab,
  getWorkspaceKey: () => activeWorkspaceKey,
  adoptSessionId,
  applyProcessTitle,
  applyThinkingWorkspaceFiles,
  appendTaskRun,
  buildSubagentProgressLabels,
  buildTaskRunCompletionText,
  createMessageId,
  getActiveConfigIdForCli,
  getConversationTabById,
  getEffectiveCliArgs,
  getEffectiveThinkingMode,
  getGlobalHumanInteractionEnabled,
  getPendingSessionDraft,
  getSelectedCliModel,
  getWorkspaceInteractiveMode,
  getInteractiveRunnerManager: () => interactiveRunnerManager,
  resolveGrokModelForRun: (model) => modelSettingsHost.resolveGrokModelForRun(model),
  resolveDshModelWireForRun: (model) => modelSettingsHost.resolveDshModelWireForRun(model),
  resolveKimiModelWireForRun: (model) => modelSettingsHost.resolveKimiModelWireForRun(model),
  resolveZcodeModelWireForRun: (model) => modelSettingsHost.resolveZcodeModelWireForRun(model),
  getModelDisplayName: (cli, model) => modelSettingsHost.getModelDisplayName(cli, model),
  loadSessionMessages,
  logCliStartup,
  maybeAutoCompactContextAfterPromptSuccess,
  maybePersistLongTermMemoryFromRun,
  migrateLocalSessionToTargetSession,
  persistMessagesForTab,
  preparePendingLabel,
  resolveClaudeInteractiveEntrypoint,
  resolveCodexInteractiveSelection,
  resolveInteractiveMappedId,
  resolveInteractiveSessionForResume,
  resolveWorkspaceCwd,
  requestHumanInteraction,
  cancelHumanInteractionForTab,
  sendPanelMessage,
  sendRunStatusForTab,
  shouldAutoCompactContextAfterRunForTarget,
  shouldRequireExplicitFinalAnswerForRun,
  t,
  updateProcessTitle,
  upsertInteractiveMapping,
});
const { runPromptOneShot } = createPromptOneShotRuntimeHost({
  AI_TASK_RAW_OUTPUT_MAX_BYTES,
  adoptFreshOpenCodeLoopRecoverySession,
  appendAssistantChunk,
  appendCompletionMessage: (status, failureDetail) => appendCompletionMessage(status, { failureDetail }),
  appendMessageToStore,
  appendSystemMessage,
  appendTraceLines,
  appendTraceMessage,
  applyProcessTitle,
  applyThinkingWorkspaceFiles,
  buildOpenCodeFailureMessage,
  buildOpenCodeMissingFinalConclusionMessage,
  buildSubagentProgressLabels,
  buildUserChatMessage,
  captureSessionFromBuffer,
  cancelHumanInteractionForTab,
  sendRunStatusForTab,
  clearActiveRun,
  createDisabledOpenCodeSubagentMonitor,
  createMessageId,
  flushTraceBuffer,
  getActiveRunId: () => primaryPromptRunController.activeRunId,
  getActiveTaskRun: () => primaryPromptRunController.activeTaskRun,
  getEffectiveThinkingMode,
  getGlobalHumanInteractionEnabled,
  getPendingSessionDraft,
  killActiveProcess: () => {
    primaryPromptRunController.activeProcess?.kill();
  },
  loadSessionMessages,
  logCliStartup,
  maybeAutoCompactContextAfterPromptSuccess,
  maybePersistLongTermMemoryFromRun,
  persistActiveMessages,
  prepareOpenCodeRuntime,
  prepareOpenCodeSubagentRuntime,
  preparePendingLabel,
  requestHumanInteraction,
  resetActiveAssistantMessage: () => {
    primaryPromptRunController.activeAssistantMessageId = undefined;
    primaryPromptRunController.activeMessageIndex = null;
  },
  resetTraceState: () => {
    primaryPromptRunController.activeTraceBuffer = "";
    primaryPromptRunController.activeTraceSegmentLines = [];
    resetTraceLineFilterState(activeTraceLineFilterState);
    primaryPromptRunController.activeCompletionSent = false;
  },
  resolveCliSessionIdForResume,
  resolveWorkspaceCwd,
  sendOpenCodeTaskListUpdate,
  sendPanelMessage,
  sendRawStreamDelta,
  sendRunStatus,
  setActiveCliForRun: (cli) => {
    primaryPromptRunController.activeCliForRun = cli;
  },
  setActiveMessageTarget: (target) => {
    primaryPromptRunController.activeMessageTarget = target;
  },
  setActiveProcess: (process) => {
    primaryPromptRunController.activeProcess = process;
  },
  setActiveRunId: (runId) => {
    primaryPromptRunController.activeRunId = runId;
  },
  setActiveSessionId: (sessionId) => {
    primaryPromptRunController.activeSessionId = sessionId;
  },
  setActiveTabIdForRun: (tabId) => {
    primaryPromptRunController.activeTabIdForRun = tabId;
  },
  shouldAutoCompactContextAfterRunForTarget,
  shouldRequireExplicitFinalAnswerForRun,
  showCliCommandNotFoundError: (message, cli) => {
    const openSettingsLabel = t("common.openSettings");
    void vscode.window.showErrorMessage(message, openSettingsLabel).then((selection) => {
      if (selection === openSettingsLabel) {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          `sinitek-cli-tools.commands.${cli}`
        );
      }
    });
  },
  startTaskRun,
  startTraceMessage,
  t,
  updateSessionBuffer,
});


const inspectModelManagerState = createPanelDiagnosticsInspector({
  getWorkspaceKey: () => activeWorkspaceKey,
  getDataDir: () => DATA_DIR,
  getModelStoreFile: () => MODEL_STORE_FILE,
  getWorkspaceSettings: () => workspaceSettings,
  getActiveConfigIdForCli,
  ensureCliModelStore,
  normalizeCliModelName,
  readModelStore,
  getMemoryModelStore: () => modelStore,
  getModelSelectionStoreErrors: () => ({
    lastReadError: modelSelectionStoreState.lastReadError,
    lastWriteError: modelSelectionStoreState.lastWriteError,
  }),
  setLastConfigStateLoadError: (cli, message) => { lastConfigStateLoadErrorByCli[cli] = message; },
  getLastConfigStateLoadError: (cli) => lastConfigStateLoadErrorByCli[cli] ?? null,
  getConfigList: (cli) => configService.getConfigList(cli),
  getModelOptionsForConfigFromStore,
  getManagedModelOptionsForConfigFromStore,
  summarizeModelStoreByConfigId,
  countStoreModels,
  t,
  logDebug: (event, payload) => void logDebug(event, payload),
  logEssential: (event, payload) => void logEssential(event, payload),
  logError: (event, payload) => void logError(event, payload),
  showErrorWithActions,
  errorToMessage,
});

const configHeartbeatCoordinator = createConfigHeartbeatCoordinator({
  intervalMs: CONFIG_HEARTBEAT_INTERVAL_MS,
  getCurrentCli: () => currentCli,
  getWorkspaceKey: () => activeWorkspaceKey,
  loadConfigState,
  getLastConfigStateLoadError: (cli) => lastConfigStateLoadErrorByCli[cli] ?? null,
  readNormalizedModelStoreFromDisk,
  setModelStore: (store) => { modelStore = store; },
  resolveModelConfigIdForCli,
  buildPanelStateWithConfigState,
  postState: (state) => viewProvider?.postState(state),
  syncConfigManagerPanel: () => configManagerPanel?.syncActiveConfig(),
  logDebug: (event, payload) => void logDebug(event, payload),
  logEssential: (event, payload) => void logEssential(event, payload),
  logError: (event, payload) => void logError(event, payload),
  createDisposable: (dispose) => new vscode.Disposable(dispose),
});

function readNormalizedModelStoreFromDisk(): CliModelStore {
  const diskStore = readModelStore();
  if (modelSelectionStoreState.lastReadError) {
    void logError("model-store-read-fallback-memory", {
      path: MODEL_STORE_FILE,
      error: modelSelectionStoreState.lastReadError,
    });
    return ensureCliModelStore(modelStore);
  }
  return ensureCliModelStore(diskStore);
}

function updateConfigHeartbeatSnapshot(
  cli: CliName,
  configState: PanelState["configState"],
  store: CliModelStore = modelStore
): void {
  configHeartbeatCoordinator.updateSnapshot(cli, configState, store);
}

async function pollConfigHeartbeat(): Promise<void> {
  await configHeartbeatCoordinator.poll();
}

function startConfigHeartbeat(context: vscode.ExtensionContext): void {
  configHeartbeatCoordinator.start(context);
}


function ensureWorkspaceSessionStore(): void {
  const workspaceKey = buildWorkspaceKey(resolveWorkspaceCwd());
  if (workspaceKey === activeWorkspaceKey) {
    return;
  }
  if (hasAnyTaskRunning()) {
    pendingWorkspaceKey = workspaceKey;
    return;
  }
  applyWorkspaceSessionStore(workspaceKey);
}

function applyWorkspaceSessionStore(workspaceKey: string): void {
  conversationTaskSummaries.clear();
  activeWorkspaceKey = workspaceKey;
  departmentWorkspaceGeneration += 1;
  sessionStore = loadSessionStore();
  promptHistoryStore = loadPromptHistoryStore();
  workspaceSettings = loadWorkspaceSettings();
  migrateLegacyAutoCompactContextAfterRunFromWorkspace();
  // Restore currentCli from workspace settings, or keep current if not set
  if (workspaceSettings.currentCli) {
    currentCli = workspaceSettings.currentCli;
  }
  sessionMessageCache.clear();
  interactiveRunnerManager?.disposeAll();
  suppressCompactPrompt.clear();
  Object.keys(pendingSessionDrafts).forEach((tabId) => {
    delete pendingSessionDrafts[tabId];
  });
  conversationTabStore.activeTabId = null;
  conversationTabStore.tabs = [];
  initializeConversationTabsFromWorkspaceSettings();
  completedLoopSubtaskTabs.rememberRestoredTabs(ensureConversationTabs().tabs);
  repairSupersededLocalSessions({ notifyPanel: false, source: "workspace-switch" });
  syncCurrentSessionWithActiveTab();
  ensureCurrentCliIsEnabled();
  scheduledTaskScheduler?.notifyChanged();
}

function getExplicitGlobalConfigValue<T>(key: string): T | undefined {
  const config = vscode.workspace.getConfiguration("sinitek-cli-tools");
  const inspected = config.inspect<T>(key);
  return inspected?.globalValue;
}

function updateStoredToolSettings(patch: Partial<ToolSettingsState>): boolean {
  try {
    updateToolSettings(patch);
    if (Object.keys(patch).some((key) => [
      "humanInteractionNotifications", "taskCompletionNotifications",
      "humanInteractionWindowAttention", "taskCompletionWindowAttention",
    ].includes(key))) {
      humanInteractionAttention?.refreshPreferences();
    }
    if ("loopGroupChatMessageLimit" in patch) {
      for (const taskId of loopGroupChatChatPanelsByTaskId.keys()) {
        refreshOpenLoopGroupChatPanelForTask(taskId);
      }
    }
    return true;
  } catch (error) {
    void logError("tool-settings-write-error", { error: String(error) });
    return false;
  }
}

function retargetDisabledLoopSubtaskSelections(fallbackCli: CliName | null): void {
  const selections = modelStore?.selectedLoopSubtaskCliByConfigId;
  if (!selections) {
    return;
  }
  const settings = readToolSettings();
  const nextFallback = fallbackCli && isCliEnabled(fallbackCli, settings) ? fallbackCli : null;
  for (const [configId, cli] of Object.entries(selections)) {
    if (!isCliEnabled(cli, settings)) {
      selectLoopSubtaskCli(configId, nextFallback);
    }
  }
}

function ensureCurrentCliIsEnabled(): void {
  const settings = readToolSettings();
  const nextCli = resolveNextEnabledCli(currentCli, settings);
  if (nextCli && nextCli !== currentCli) {
    void setCurrentCli(nextCli);
  }
  retargetDisabledLoopSubtaskSelections(nextCli ?? listEnabledClis(settings)[0] ?? null);
}

function migrateLegacyAutoCompactContextAfterRunFromWorkspace(): void {
  const hasLegacyWorkspaceValue = typeof workspaceSettings.autoCompactContextAfterRun === "boolean"
    || typeof workspaceSettings.autoCompactContextBeforeRun === "boolean";
  if (!hasLegacyWorkspaceValue) {
    return;
  }

  const globalSettings = readToolSettings();
  if (typeof globalSettings.autoCompactContextAfterRun !== "boolean") {
    let migrated = true;
    try {
      updateToolSettings({
        autoCompactContextAfterRun: resolveGlobalAutoCompactContextAfterRun(globalSettings, workspaceSettings),
      }, true);
    } catch (error) {
      migrated = false;
      void logError("tool-settings-write-error", { error: String(error) });
    }
    if (!migrated) {
      return;
    }
  }

  const result = tryUpdateWorkspaceSettingsToStore((settings) => {
    delete settings.autoCompactContextAfterRun;
    delete settings.autoCompactContextBeforeRun;
    return settings;
  }, getWorkspaceSettingsStoreOptions());
  if (result.ok) workspaceSettings = loadWorkspaceSettings();
}

function migrateLegacyToolSettingsFromVsCodeConfig(): void {
  const current = readToolSettings();
  const missing: Partial<ToolSettingsState> = {};

  const debug = getExplicitGlobalConfigValue<unknown>("debug");
  if (typeof current.debug !== "boolean" && typeof debug === "boolean") {
    missing.debug = debug;
  }

  const autoAddEditorContextTags = getExplicitGlobalConfigValue<unknown>("autoAddEditorContextTags");
  if (
    typeof current.autoAddEditorContextTags !== "boolean"
    && typeof autoAddEditorContextTags === "boolean"
  ) {
    missing.autoAddEditorContextTags = autoAddEditorContextTags;
  }

  const humanInteractionEnabled = getExplicitGlobalConfigValue<unknown>("humanInteractionEnabled");
  if (
    typeof current.humanInteractionEnabled !== "boolean"
    && typeof humanInteractionEnabled === "boolean"
  ) {
    missing.humanInteractionEnabled = resolveGlobalHumanInteractionEnabled({ humanInteractionEnabled });
  }

  const macTaskShell = getExplicitGlobalConfigValue<unknown>("macTaskShell");
  if (!current.macTaskShell && isMacTaskShell(macTaskShell)) {
    missing.macTaskShell = macTaskShell;
  }

  for (const key of [
    "humanInteractionNotifications", "taskCompletionNotifications",
    "humanInteractionWindowAttention", "taskCompletionWindowAttention",
  ] as const) {
    const legacy = getExplicitGlobalConfigValue<unknown>(key);
    if (typeof current[key] !== "boolean" && typeof legacy === "boolean") missing[key] = legacy;
  }

  if (Object.keys(missing).length > 0) {
    try {
      updateToolSettings(missing, true);
      if (Object.keys(missing).some((key) => [
        "humanInteractionNotifications", "taskCompletionNotifications",
        "humanInteractionWindowAttention", "taskCompletionWindowAttention",
      ].includes(key))) humanInteractionAttention?.refreshPreferences();
    }
    catch (error) { void logError("tool-settings-write-error", { error: String(error) }); }
  }
}

function buildWorkspaceKey(root: string | undefined): string {
  if (!root) {
    return WORKSPACE_KEY_FALLBACK;
  }
  const baseName = sanitizeWorkspaceName(path.basename(root) || "workspace");
  const hash = createHash("sha256").update(root).digest("hex").slice(0, WORKSPACE_KEY_HASH_LENGTH);
  return `${baseName}_${hash}`;
}

function sanitizeWorkspaceName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, WORKSPACE_NAME_MAX_LENGTH);
}

function getWorkspaceRoot(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? folder.uri.fsPath : null;
}

function getProjectRulePaths(): Record<CliName, string | null> {
  const root = getWorkspaceRoot();
  if (!root) {
    return {
      codex: null,
      claude: null,
      opencode: null,
      grok: null,
      dsh: null,
      "kimi-code": null,
      zcode: null,
    };
  }
  return {
    codex: path.join(root, CLI_RULE_FILENAMES_PROJECT.codex),
    claude: path.join(root, CLI_RULE_FILENAMES_PROJECT.claude),
    opencode: path.join(root, CLI_RULE_FILENAMES_PROJECT.opencode),
    grok: path.join(root, CLI_RULE_FILENAMES_PROJECT.grok),
    dsh: path.join(root, CLI_RULE_FILENAMES_PROJECT.dsh),
    "kimi-code": path.join(root, CLI_RULE_FILENAMES_PROJECT["kimi-code"]),
    zcode: path.join(root, CLI_RULE_FILENAMES_PROJECT.zcode),
  };
}

async function readCliRules(cli: CliName, scope: "global" | "project"): Promise<string> {
  const targetPath = scope === "global"
    ? currentGlobalRulePaths()[cli]
    : getProjectRulePaths()[cli];
  if (!targetPath) {
    throw new Error("no-workspace");
  }
  try {
    return await fs.promises.readFile(targetPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function writeCliRules(
  cli: CliName,
  scope: "global" | "project",
  content: string
): Promise<void> {
  const targetPath = scope === "global"
    ? currentGlobalRulePaths()[cli]
    : getProjectRulePaths()[cli];
  if (!targetPath) {
    throw new Error("no-workspace");
  }
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, content, "utf8");
}

function normalizeRuleTargets(targets: CliName[] | undefined): CliName[] {
  if (!Array.isArray(targets)) {
    return [];
  }
  return targets.filter((target): target is CliName => (CLI_LIST as readonly string[]).includes(target));
}

function normalizeLineEndings(value: string | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeThinkingWorkspaceFiles(files: ThinkingWorkspaceFile[]): ThinkingWorkspaceFile[] {
  if (!Array.isArray(files)) {
    return [];
  }
  return files.filter((file) => Boolean(file?.path));
}

function resolveWorkspaceFilePath(cwd: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(cwd, filePath);
}

function applyThinkingWorkspaceFiles(
  cli: CliName,
  mode: ThinkingMode,
  cwd: string | undefined
): void {
  if (!cwd) {
    return;
  }
  const files = normalizeThinkingWorkspaceFiles(getThinkingWorkspaceFiles(cli, mode));
  if (files.length === 0) {
    return;
  }
  files.forEach((file) => {
    const targetPath = resolveWorkspaceFilePath(cwd, file.path);
    try {
      const content = file.content ?? "";
      if (fs.existsSync(targetPath)) {
        const existing = fs.readFileSync(targetPath, "utf8");
        if (existing === content) {
          return;
        }
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      }
      fs.writeFileSync(targetPath, content, "utf8");
    } catch (error) {
      void logError("thinking-workspace-file-write-failed", {
        cli,
        targetPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function startHistoryArtifactRetentionCleanup(context: vscode.ExtensionContext): void {
  scheduleHistoryArtifactRetentionCleanup();
  const timer = setInterval(() => {
    scheduleHistoryArtifactRetentionCleanup();
  }, HISTORY_RETENTION_CLEAN_INTERVAL_MS);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(timer)));
}

function scheduleHistoryArtifactRetentionCleanup(): void {
  if (historyArtifactRetentionCleanupPromise) {
    return;
  }
  historyArtifactRetentionCleanupPromise = Promise.resolve()
    .then(async () => {
      scheduleLogRetentionCleanup();
      cleanupTaskStoreRetention();
      cleanupLoopTaskStoreRetention();
      cleanupLoopCommunicationRetention();
      cleanupPromptHistoryRetentionAcrossWorkspaces();
      cleanupHumanInteractionHistoryRetention();
      await cleanupSessionRetentionAcrossWorkspaces();
    })
    .catch((error) => {
      void logError("history-artifact-retention-cleanup-failed", {
        error: String(error),
      });
    })
    .finally(() => {
      historyArtifactRetentionCleanupPromise = null;
    });
}

async function getCodexImageSupportStatus(forceRefresh = false): Promise<CodexImageSupportStatus> {
  const command = getCliCommand("codex");
  const cached = codexImageSupportStatus;
  if (
    !forceRefresh
    && cached
    && cached.command === command
    && Date.now() - cached.checkedAt < CODEX_IMAGE_SUPPORT_CACHE_MS
  ) {
    return cached;
  }
  const nextStatus = await probeCodexImageSupportStatus(command, {
    minVersion: CODEX_IMAGE_MIN_VERSION,
    timeoutMs: CODEX_IMAGE_SUPPORT_TIMEOUT_MS,
    captureCliOutput: (targetCommand, args, options) => captureCliOutput(targetCommand, args, options),
  });
  codexImageSupportStatus = nextStatus;
  return nextStatus;
}

async function resolveCodexImagePathsForPrompt(prompt: string): Promise<string[]> {
  if (!prompt.trim()) {
    return [];
  }
  const supportStatus = await getCodexImageSupportStatus();
  if (!supportStatus.supported) {
    return [];
  }
  return collectCodexImagePathsFromPrompt(prompt, resolveWorkspaceCwd());
}

function setWorkspaceActiveConfigId(cli: CliName, configId: string | null): void {
  const nextActiveConfigIdByCli = {
    ...(workspaceSettings.activeConfigIdByCli ?? {}),
  };
  if (configId) {
    nextActiveConfigIdByCli[cli] = configId;
  } else {
    delete nextActiveConfigIdByCli[cli];
  }
  if (Object.keys(nextActiveConfigIdByCli).length > 0) {
    workspaceSettings.activeConfigIdByCli = nextActiveConfigIdByCli;
  } else {
    delete workspaceSettings.activeConfigIdByCli;
  }
  saveWorkspaceSettings(workspaceSettings);
}

function getWorkspacePreferredConfigIdForCli(cli: CliName): string | null {
  return getWorkspacePreferredConfigIdForCliFromSettings(workspaceSettings, cli);
}

function resolveModelConfigIdForCli(
  cli: CliName,
  configState?: PanelState["configState"]
): string | null {
  return resolveModelConfigIdForCliFromConfigState(
    cli,
    configState,
    () => getActiveConfigIdForCli(cli),
    () => getWorkspacePreferredConfigIdForCli(cli)
  );
}

async function applyConfigById(
  cli: CliName,
  configId: string,
  options: configService.ApplyConfigOptions = {},
): Promise<ConfigApplyResult> {
  if (!configId) {
    return "applied";
  }
  return configApplyQueue.request(cli, {
    apply: async () => {
      const config = await configService.getConfigById(cli, configId);
      if (!config) {
        throw new Error(t("config.notFound"));
      }
      void logEssential("apply-config", {
        workspaceKey: activeWorkspaceKey,
        cli,
        configId,
      });
      await configService.applyConfig(cli, {
        profileId: configId,
        content: config.content,
        mcpContent: config.mcpContent,
        envContent: cli === "codex" ? undefined : config.envContent,
        configContent: config.configContent,
        authContent: config.authContent,
        codexSkills: config.codexSkills,
        claudeSkills: config.claudeSkills,
        openCodeSkills: config.openCodeSkills,
      }, options);
    },
    commit: () => {
      setWorkspaceActiveConfigId(cli, configId);
    },
  });
}

async function loadConfigState(cli: CliName): Promise<PanelState["configState"]> {
  return loadConfigStateWithDeps(cli, {
    workspaceSettings,
    getConfigList: (targetCli) => configService.getConfigList(targetCli),
    getConfigOrder: (targetCli) => configService.getConfigOrder(targetCli),
    getCurrentConfig: (targetCli) => configService.getCurrentConfig(targetCli),
    readSharedConfigSelection: configService.readSharedConfigSelection,
    setWorkspaceActiveConfigId,
    setLastConfigStateLoadError: (targetCli, message) => {
      if (message) {
        lastConfigStateLoadErrorByCli[targetCli] = message;
      } else {
        delete lastConfigStateLoadErrorByCli[targetCli];
      }
    },
    logInfo: (event, payload) => void logInfo(event, payload),
    logError: (event, payload) => void logError(event, payload),
    errorToMessage,
  });
}

type OpenCodeRuntimePreparation = {
  configId?: string | null;
  envOverrides: Record<string, string>;
  configContent: string;
  role: OpenCodeCanonicalModelRole;
  mainModel: string;
  subtaskModel: string | null;
  effectiveModel: string;
  mainVariant: string | null;
  subtaskVariant: string | null;
  effectiveVariant: string | null;
  modelFallback: string;
  /** @deprecated Adapter alias for OpenCode CLI config `model`. */
  primaryModel: string;
  /** @deprecated Adapter alias for OpenCode CLI config `small_model`. */
  smallModel: string | null;
  /** @deprecated Adapter alias for the main role variant. */
  primaryVariant: string | null;
  /** @deprecated Adapter alias for the subtask role variant. */
  smallVariant: string | null;
};

type OpenCodeRuntimePreparationInput = {
  configId?: string | null;
  role?: OpenCodeModelRoleInput;
  model?: string | null;
  variant?: string | null;
  requiresSubtaskModel?: boolean;
};

function normalizeOpenCodeRuntimePreparationInput(
  input?: string | null | OpenCodeRuntimePreparationInput
): Required<Pick<OpenCodeRuntimePreparationInput, "configId">> & {
  role: OpenCodeCanonicalModelRole;
  model: string | null;
  variant: string | null;
  requiresSubtaskModel: boolean;
  variantSpecified: boolean;
} {
  if (typeof input === "string" || input === null) {
    return {
      configId: input ?? getActiveConfigIdForCli("opencode"),
      role: "main",
      model: null,
      variant: null,
      requiresSubtaskModel: false,
      variantSpecified: false,
    };
  }
  const role = normalizeOpenCodeModelRole(input?.role ?? "main");
  return {
    configId: input?.configId ?? getActiveConfigIdForCli("opencode"),
    role,
    model: normalizeCliModelName(input?.model) ?? null,
    variant: isOpenCodeThinkingEffort(input?.variant) ? input.variant.trim() : null,
    requiresSubtaskModel: role === "subtask" || input?.requiresSubtaskModel === true,
    variantSpecified: input?.variant !== undefined,
  };
}

async function prepareOpenCodeRuntime(
  input?: string | null | OpenCodeRuntimePreparationInput
): Promise<OpenCodeRuntimePreparation> {
  const runtimeInput = normalizeOpenCodeRuntimePreparationInput(input);
  const configId = runtimeInput.configId;
  const activeConfig = configId
    ? await configService.getConfigById("opencode", configId)
    : null;
  const current = activeConfig ?? await configService.getCurrentConfig("opencode");
  const configContent = current.content ?? "{}";
  const roles = resolveOpenCodeRoleModelsForConfig(configId, configContent);
  if (!roles.main) {
    throw new Error("OpenCode main model is unavailable; select a valid main model from the active config.");
  }
  const parsedModels = parseOpenCodeConfigModels(configContent);
  if (!parsedModels.config) {
    throw new Error("OpenCode config JSON is invalid.");
  }
  const subtaskModel = runtimeInput.requiresSubtaskModel ? roles.subtask : null;
  let effectiveModel = runtimeInput.role === "subtask"
    ? roles.subtask ?? roles.main
    : roles.main;
  let modelFallback = runtimeInput.role === "subtask"
    ? roles.fallback.subtask ?? "none"
    : roles.fallback.main ?? "none";
  if (runtimeInput.model) {
    const validation = validateOpenCodeModelOverride(parsedModels, runtimeInput.role, runtimeInput.model);
    if (!validation.ok || !validation.modelRef) {
      throw new Error(validation.issue?.message ?? `OpenCode ${runtimeInput.role} model selection is invalid.`);
    }
    effectiveModel = validation.modelRef;
    modelFallback = "none";
  }
  const mainVariant = getOpenCodeVariantForRun(
    "opencode",
    roles.main,
    configId,
    configContent,
    "main",
  );
  const subtaskVariant = getOpenCodeVariantForRun(
    "opencode",
    subtaskModel,
    configId,
    configContent,
    "subtask",
  );
  const effectiveVariant = runtimeInput.variantSpecified ? runtimeInput.variant : getOpenCodeVariantForRun(
    "opencode",
    effectiveModel,
    configId,
    configContent,
    runtimeInput.role,
  );
  const overlay = applyOpenCodeRuntimeModelOverlay(parsedModels.config, {
    main: roles.main,
    subtask: subtaskModel,
    mainVariant,
    subtaskVariant,
  });
  if (!overlay.ok || !overlay.config) {
    throw new Error(overlay.issues.map((issue) => issue.message).join("\n"));
  }
  const runtimeConfigContent = JSON.stringify(overlay.config);
  const validation = configService.validateOpenCodeConfigForRun(
    runtimeConfigContent,
    current.envContent
  );
  if (!validation.ok) {
    throw new Error(validation.issues.map((issue) => issue.message).join("\n"));
  }
  void logInfo("opencode-runtime-profile", {
    configId,
    role: runtimeInput.role,
    mainModel: roles.main,
    subtaskModel,
    effectiveModel,
    modelFallback,
    mainVariant,
    subtaskVariant,
    effectiveVariant,
    compatibilityFields: ["model", "small_model"],
  });
  return {
    configId,
    envOverrides: configService.parseEnvText(current.envContent ?? ""),
    configContent: runtimeConfigContent,
    role: runtimeInput.role,
    mainModel: roles.main,
    subtaskModel,
    effectiveModel,
    mainVariant,
    subtaskVariant,
    effectiveVariant,
    modelFallback,
    primaryModel: roles.main,
    smallModel: subtaskModel,
    primaryVariant: mainVariant,
    smallVariant: subtaskVariant,
  };
}
async function refreshCliInstallStatuses(): Promise<void> {
  await Promise.all(CLI_LIST.map(async (cli) => {
    await refreshCliInstallStatus(cli);
  }));
}

async function refreshCliInstallStatus(cli: CliName): Promise<CliInstallStatus> {
  const command = getCliCommand(cli);
  const status = await normalizeCliInstallStatus(cli, command, {
    isCliCommandAvailable,
    logError: (event, payload) => void logError(event, payload),
  });
  cliInstallStatuses[cli] = status;
  return status;
}

async function getCliInstallStatus(cli: CliName): Promise<CliInstallStatus> {
  const command = getCliCommand(cli);
  const cached = cliInstallStatuses[cli];
  if (cached && cached.command === command) {
    return cached;
  }
  return refreshCliInstallStatus(cli);
}

async function maybePromptInstallOnCliGroupSwitch(cli: CliName): Promise<void> {
  const status = await getCliInstallStatus(cli);
  if (!status.installed) {
    await promptInstallMissingCli(cli, status.command);
    return;
  }
  if (cli === "codex") {
    await maybePromptUpgradeCodexForImageSupport();
  }
}

async function maybePromptUpgradeCodexForImageSupport(): Promise<void> {
  const status = await getCodexImageSupportStatus();
  if (status.supported) {
    return;
  }
  const warningKey = buildCodexImageSupportWarningKey(status);
  if (codexImageSupportWarningKeys.has(warningKey)) {
    return;
  }
  codexImageSupportWarningKeys.add(warningKey);

  const upgradeLabel = t("cli.codexImage.upgradeAction");
  const openSettingsLabel = t("common.openSettings");
  const versionLabel = status.versionLabel ?? status.version ?? t("cli.codexImage.versionUnknown");
  const message = [
    t("cli.codexImage.unsupported", {
      version: versionLabel,
      minVersion: CODEX_IMAGE_MIN_VERSION,
      command: status.command,
    }),
    t("cli.codexImage.upgradeHint"),
  ].join("\n\n");

  const selection = await vscode.window.showWarningMessage(
    message,
    upgradeLabel,
    openSettingsLabel
  );

  if (selection === upgradeLabel) {
    const installCommand = getCliInstallCommand("codex");
    const terminal = vscode.window.createTerminal({
      name: `${CLI_INSTALL_TERMINAL_PREFIX}: codex`,
    });
    terminal.show();
    terminal.sendText(installCommand);
    codexImageSupportStatus = null;
    void logInfo("codex-image-upgrade-triggered", {
      command: status.command,
      version: status.version,
      installCommand,
    });
    void vscode.window.showInformationMessage(
      t("cli.install.started", { command: installCommand })
    );
    return;
  }

  if (selection === openSettingsLabel) {
    void vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "sinitek-cli-tools.commands.codex"
    );
  }
}
async function setCurrentCli(
  cli: CliName,
  options: { syncActiveTab?: boolean } = {}
): Promise<void> {
  await applyCurrentCli(cli, options, false);
}

async function setCurrentCliFromPanelSelection(cli: CliName): Promise<void> {
  if (cli !== currentCli) invalidateDepartmentSelectionContext();
  await applyCurrentCli(cli, {}, true);
}

async function applyCurrentCli(
  cli: CliName,
  options: { syncActiveTab?: boolean },
  allowLockedTabCliSwitch: boolean,
): Promise<void> {
  const syncActiveTab = options.syncActiveTab !== false;
  const activeTab = getActiveConversationTab();
  if (
    activeTab
    && isConversationTabExecutionLocked(activeTab)
    && activeTab.cli !== cli
    && !allowLockedTabCliSwitch
  ) {
    return;
  }
  const previousCli = currentCli;
  if (previousCli !== cli) invalidateDepartmentSelectionContext();
  currentCli = cli;
  updateStatusBar();

  if (syncActiveTab) {
    if (activeTab && activeTab.cli !== cli) {
      switchConversationTabCli(activeTab, cli, {
        allowExecutionLocked: allowLockedTabCliSwitch,
      });
      persistConversationTabsToWorkspaceSettings();
    }
  }

  const refreshedActiveTab = getActiveConversationTab();
  let sessionId: string | null = null;
  if (syncActiveTab && refreshedActiveTab && refreshedActiveTab.cli === cli) {
    sessionId = getConversationTabSessionIdForCli(refreshedActiveTab, cli);
  } else {
    sessionId = getCurrentSessionId(cli) ?? getLatestSessionId(cli);
  }
  setCurrentSession(cli, sessionId, { syncConversationTab: false });

  // Save to workspace settings instead of global config
  workspaceSettings.currentCli = cli;
  saveWorkspaceSettings(workspaceSettings);

  if (previousCli !== cli) {
    await maybePromptInstallOnCliGroupSwitch(cli);
  }
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  statusBarItem.text = t("statusBar.text", { cli: currentCli });
  statusBarItem.tooltip = t("statusBar.tooltip");
}

async function revealPanelView(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.sinitekCliBridgePanel");
  viewProvider?.reveal();
}

function captureLoopOriginProfile(input: {
  cli: CliName;
  configId: string | null;
  mainModel?: string | null;
  subtaskModel?: string | null;
  subtaskCli?: CliName | null;
  subtaskConfigId?: string | null;
  frontendModel?: string | null;
  frontendCli?: CliName | null;
  frontendConfigId?: string | null;
  fullstackModel?: string | null;
  fullstackCli?: CliName | null;
  fullstackConfigId?: string | null;
  mainThinkingMode?: ThinkingMode;
  subtaskThinkingMode?: ThinkingMode;
  subtaskFrontendThinkingMode?: ThinkingMode;
  subtaskFullstackThinkingMode?: ThinkingMode;
}): ReturnType<typeof normalizeLoopTaskOriginProfile> {
  const subtaskCli = input.subtaskCli && input.subtaskCli !== input.cli ? input.subtaskCli : input.cli;
  const subtaskConfigId = subtaskCli === input.cli ? input.configId : (input.subtaskConfigId ?? null);
  const mainThinkingMode = input.mainThinkingMode
    ?? getSelectedLoopThinkingMode(input.cli, "main", input.mainModel, input.configId)
    ?? undefined;
  const subtaskThinkingMode = input.subtaskThinkingMode
    ?? getSelectedLoopThinkingMode(subtaskCli, "subtask", input.subtaskModel, subtaskConfigId)
    ?? (subtaskCli === input.cli && subtaskCli === "claude" ? getEffectiveThinkingMode("claude", null) : undefined);
  const frontendCli = input.frontendCli && input.frontendCli !== input.cli ? input.frontendCli : input.cli;
  const frontendConfigId = frontendCli === input.cli ? input.configId : (input.frontendConfigId ?? null);
  const subtaskFrontendThinkingMode = input.subtaskFrontendThinkingMode
    ?? ((input.frontendCli || input.frontendModel)
      ? getSelectedLoopFrontendThinkingFromStore(modelStore, frontendConfigId, input.frontendModel) ?? undefined
      : undefined);
  const fullstackCli = input.fullstackCli && input.fullstackCli !== input.cli ? input.fullstackCli : input.cli;
  const fullstackConfigId = fullstackCli === input.cli ? input.configId : (input.fullstackConfigId ?? null);
  const subtaskFullstackThinkingMode = input.subtaskFullstackThinkingMode
    ?? ((input.fullstackCli || input.fullstackModel)
      ? getSelectedLoopFullstackThinkingFromStore(modelStore, fullstackConfigId, input.fullstackModel) ?? undefined
      : undefined);
  const mainOpenCodeVariant = input.cli === "opencode"
    ? getOpenCodeRoleVariantFromStore(modelStore, input.configId, input.mainModel, "main")
    : undefined;
  const subtaskOpenCodeVariant = subtaskCli === "opencode"
    ? getOpenCodeRoleVariantFromStore(modelStore, subtaskConfigId, input.subtaskModel, "subtask")
    : undefined;
  return normalizeLoopTaskOriginProfile({
    configId: input.configId,
    mainThinkingMode,
    subtaskThinkingMode,
    subtaskFrontendThinkingMode,
    subtaskFullstackThinkingMode,
    mainOpenCodeVariant,
    subtaskOpenCodeVariant,
  });
}

function isConfigLockResumeSessionAvailable(task: LoopTaskRecord, restoredTabId?: string): boolean {
  if (isExtensionDeactivating || task.workspaceKey !== activeWorkspaceKey || !task.sessionId) return false;
  const nativeSessionId = resolveInteractiveMappedId(task.cli, task.sessionId)
    ?? (isLocalSessionId(task.sessionId) ? null : task.sessionId);
  if (!nativeSessionId || (task.executionSession && task.executionSession.sessionId !== nativeSessionId)) return false;
  const bound = restoredTabId ? resolvePromptRunTarget(restoredTabId) : resolveLoopMainPromptTarget(task, { createIfMissing: false });
  const busy = (tabId: string) => isTabRunActive(tabId) || promptRunHandoff.isBusy(tabId)
    || loopMainQuestionQueue.isBusy(tabId) || loopMainAutoCompactFlights.has(tabId);
  const isOriginalSession = (sessionId: string | null) => sessionId !== null && (sessionId === task.sessionId
    || sessionId === nativeSessionId || resolveInteractiveMappedId(task.cli, sessionId) === nativeSessionId);
  if ((!bound && restoredTabId) || (bound && (bound.cli !== task.cli || !bound.tabId
    || bound.sessionId !== task.sessionId || busy(bound.tabId)))) return false;
  if (ensureConversationTabs().tabs.some((tab) => busy(tab.id) && (
    isOriginalSession(getConversationTabSessionIdForCli(tab, task.cli))
    || resolveConversationTabLoopContext(tab).loopTaskId === task.id))) return false;
  if (loopSubtaskAutoCompactions.has(task.cli, task.sessionId) || loopSubtaskAutoCompactions.has(task.cli, nativeSessionId)) return false;
  return ![...interactiveRunsByTabId.values()].some((run) => run.cli === task.cli && !run.stopped
    && isOriginalSession(run.sessionId));
}

async function restoreOriginalLoopRuntime(task: LoopTaskRecord, options?: { configLockRecovery: true; originalTabId?: string }): Promise<{
  ok: boolean;
  target?: { tabId: string | null; cli: CliName };
  isOriginalTargetCurrent?: () => boolean;
  codexConfigEvidence?: CodexRuntimeConfigEvidence;
  message?: string;
}> {
  const profile = normalizeLoopTaskOriginProfile(task.originProfile);
  const originalTab = options?.originalTabId ? getConversationTabById(options.originalTabId) : undefined;
  if (!profile) {
    return { ok: false, message: t("loopGroupChatChat.originalRuntimeUnavailable") };
  }
  try {
    const config = await configService.getConfigById(task.cli, profile.configId);
    if (!config) {
      return { ok: false, message: t("loopGroupChatChat.originalConfigMissing", { configId: profile.configId }) };
    }
    let isRestoredApplicationCurrent: (() => boolean) | undefined;
    let codexConfigEvidence: CodexRuntimeConfigEvidence | undefined;
    const applied = await applyConfigById(task.cli, profile.configId, options?.configLockRecovery
      ? { codexReadback: {
          workingDirectory: resolveWorkspaceCwd(),
          onApplied: (isCurrent, evidence) => {
            isRestoredApplicationCurrent = isCurrent;
            codexConfigEvidence = evidence;
          },
        } }
      : { reuseActiveProfile: true });
    if (applied !== "applied") {
      return { ok: false, message: t("loopGroupChatChat.originalConfigMissing", { configId: profile.configId }) };
    }
    if (options?.configLockRecovery && !isConfigLockResumeSessionAvailable(task, options.originalTabId)) {
      return { ok: false, message: t("loopGroupChatChat.originalRuntimeUnavailable") };
    }
    const prepared = options?.configLockRecovery
      ? options.originalTabId ? resolvePromptRunTarget(options.originalTabId) : resolveLoopMainPromptTarget(task, { createIfMissing: true })
      : prepareLoopOriginContinuationTarget(task);
    if (!prepared?.tabId) {
      return { ok: false, message: t("loopGroupChatChat.continueUnavailable") };
    }
    const preparedTab = originalTab ?? getConversationTabById(prepared.tabId);
    const mappedSessionId = task.sessionId ? resolveInteractiveMappedId(task.cli, task.sessionId) : null;
    const isOriginalTargetCurrent = options?.configLockRecovery ? () => {
      if (!isRestoredApplicationCurrent?.() || configApplyQueue.isApplying(task.cli)
        || isExtensionDeactivating || task.workspaceKey !== activeWorkspaceKey || !preparedTab
        || getConversationTabById(prepared.tabId) !== preparedTab || preparedTab.cli !== task.cli
        || getConversationTabSessionIdForCli(preparedTab, task.cli) !== task.sessionId
        || (task.sessionId && resolveInteractiveMappedId(task.cli, task.sessionId) !== mappedSessionId)) return false;
      const context = resolveConversationTabLoopContext(preparedTab);
      return context.taskRole !== "subtask" && (!context.loopTaskId || context.loopTaskId === task.id);
    } : undefined;
    await switchVisibleConversationTabForLoop(prepared.tabId);
    const routes = task.schedulingMode === "event_driven"
      ? task.loopSubtaskMode === "split" || (!task.loopSubtaskMode && task.modelRouting?.subtaskFrontend)
        ? [task.modelRouting?.subtask, task.modelRouting?.subtaskFrontend]
        : [task.modelRouting?.subtaskFullstack ?? task.modelRouting?.subtask]
      : [task.modelRouting?.subtask];
    for (const route of routes) {
      if (!route?.cli || route.cli === task.cli) continue;
      if (!route.configId) {
        return { ok: false, message: "目标 CLI 没有可用配置，不能派发子任务。" };
      }
      const childConfig = await configService.getConfigById(route.cli, route.configId);
      if (!childConfig || await applyConfigById(route.cli, route.configId, { reuseActiveProfile: true }) !== "applied") {
        return { ok: false, message: t("loopGroupChatChat.originalConfigMissing", { configId: route.configId }) };
      }
    }
    return { ok: true, target: { tabId: prepared.tabId, cli: task.cli }, isOriginalTargetCurrent, codexConfigEvidence };
  } catch (error) {
    return { ok: false, message: errorToMessage(error) };
  }
}

const loopModelSwitchOpenCodeOptions = new Map<string, LoopModelSwitchOption[]>();
const loopModelSwitchResumeCoordinator = createLoopModelSwitchResumeCoordinator({
  readTask: readLoopTaskRecord,
  updateTask: updateLoopTaskRecord,
  resumeEventDrivenSubtasks: (taskId) => getLoopPlusOrchestrationHost().resumeInterruptedSubtasks(taskId),
  hasClassicController: (taskId) => loopOrchestrationOwnership.getCount(taskId) > 0,
  waitForClassicIdle: async (taskId) => {
    if (!requireLoopOrchestrationHost().resumeWaitingBatch(taskId)) await loopOrchestrationOwnership.waitForIdle(taskId);
  },
  isSubtaskRunning: (taskId, subtaskId) => {
    if (requireLoopOrchestrationHost().isSubtaskRunning(taskId, subtaskId)) return true;
    return ensureConversationTabs().tabs.some((tab) => {
      const context = resolveLoopSubtaskConversationContext(tab.cli, tab.id);
      return context?.taskId === taskId && context.subtaskId === subtaskId && isTabRunActive(tab.id);
    });
  },
  runClassicSubtask: async (task, subtask) => {
    const target = resolveLoopMainPromptTarget(task, { createIfMissing: true });
    if (!target) throw new Error("无法恢复主任务会话，请重新打开任务后重试。");
    const profile = task.originProfile;
    return requireLoopOrchestrationHost().runLoopSubtaskWithRetry({
      input: applyLoopModelRoutingToPrompt({
        displayPrompt: t("run.hiddenContinuePrompt"),
        modelPrompt: task.rootPrompt,
        contextTags: [],
        loopMainThinkingMode: profile?.mainThinkingMode,
        loopSubtaskThinkingMode: profile?.subtaskThinkingMode,
      }, task.modelRouting, task.originProfile),
      target,
      task,
      round: task.currentRound,
      subtask,
      switchVisible: false,
    });
  },
  onError: (error) => { void vscode.window.showWarningMessage(errorToMessage(error)); },
});
const loopGroupChatChatPanelCoordinator = createLoopGroupChatPanelCoordinator({
  prepareModelSwitchOptions: async (task) => {
    if (task.cli !== "opencode" && !Object.values(task.modelRouting ?? {}).some((route) => route?.cli === "opencode")) return;
    const configId = getActiveConfigIdForCli("opencode");
    if (!configId) return;
    try {
      const config = await configService.getConfigById("opencode", configId);
      const parsed = parseOpenCodeConfigModels(config?.content ?? "{}");
      loopModelSwitchOpenCodeOptions.set(configId, parsed.candidates.map((candidate) => ({ value: candidate.value, label: candidate.label })));
    } catch {
      loopModelSwitchOpenCodeOptions.set(configId, []);
    }
  },
  getExtensionUri: () => extensionUri,
  getMessageLimit: () => normalizeChatMessageLimit(readToolSettings().loopGroupChatMessageLimit, LOOP_GROUP_CHAT_MESSAGE_LIMIT_DEFAULT),
  panelsByTaskId: loopGroupChatChatPanelsByTaskId,
  normalizeTaskId: normalizeLoopTaskId,
  normalizeSupplementalRequirement: normalizeLoopSupplementalRequirement,
  appendSupplementalRequirement: appendLoopSupplementalRequirement,
  appendSupplementalRequirementToCommunication: appendLoopSupplementalRequirementToCommunication,
  readTaskRecord: readDepartmentAwareGroupChatTask,
  readDepartmentCapacity: (root) => getDepartmentRuntimeComposition().readCapacity(root),
  readDepartmentOrganizationControlState: readDepartmentRootControl,
  hasLocalDepartmentDirectorActivity: (root) => departmentRuntimeComposition?.hasLocalDirectorActivity(root) ?? false,
  readDepartmentEmployeeAllocation: (root) => getDepartmentRuntimeComposition().readDepartmentEmployeeAllocation(root),
  updateDepartmentEmployeeLimit: async (root, request) => getDepartmentRuntimeComposition().updateDepartmentEmployeeLimit(root, request),
  readDepartmentLeaderTaskIds: (root, module) => departmentOwnershipIndex?.readDepartmentLeaderTaskIds(root, module) ?? null,
  departmentOrganizationControl: {
    continue: (root, prompt) => getDepartmentRuntimeComposition().organizationControl.continue(root, prompt),
    stop: (root) => getDepartmentRuntimeComposition().organizationControl.stop(root),
    complete: (root) => getDepartmentRuntimeComposition().organizationControl.complete(root),
  },
  continueDepartmentLeader: (task, prompt, assertCurrent) => {
    const target = resolveLoopMainPromptTarget(task, { createIfMissing: false });
    if (!target || departmentTaskForTab(target.tabId)?.id !== task.id) {
      throw new Error("组长执行会话当前不可用，请从总监继续产研部。");
    }
    return getDepartmentRuntimeComposition().continueDepartmentPrompt({
      targetTabId: target.tabId, cli: target.cli, displayPrompt: prompt, modelPrompt: prompt, contextTags: [], assertCurrent,
    });
  },
  recordPromptHistory,

  updateTaskRecord: updateLoopTaskRecord,
  listTaskStoreFiles: () => [...listLoopTaskStoreFiles(), ...(departmentOwnershipIndex?.listTaskStoreFiles() ?? [])],
  readTaskStoreTasks: (filePath) => readLoopTaskStore(filePath).tasks,
  collectRunningTaskIds: collectRunningLoopTaskIds,
  readTextFileIfNonEmpty,
  fileExists: (filePath) => fs.existsSync(filePath),
  writeTextFileEnsuringDir,
  getActiveSubtaskIds: getActiveLoopSubtaskIds,
  getActiveReviewEventIds: (taskId) => loopPlusRuntimeAdapter?.host().getActiveReviewEventIds(taskId) ?? [],
  buildCompletedConclusionAndSummaryMarkdown: buildLoopCompletedConclusionAndSummaryMarkdown,
  resolveMainPromptTarget: resolveLoopMainPromptTarget,
  resolveSubtaskConversationTabId: (task, subtaskId) => findRunningLoopSubtaskConversationTabId(
    { taskId: task.id, subtaskId },
    {
      getTabs: () => ensureConversationTabs().tabs,
      resolveContext: (tab) => resolveLoopSubtaskConversationContext(tab.cli, tab.id),
      isTabRunActive,
    },
  ),
  revealPanelView,
  switchVisibleConversationTabForLoop: async (tabId) => {
    if (tabId) {
      await switchVisibleConversationTabForLoop(tabId);
    }
  },
  isTabRunActive,
  getActiveConfigIdForCli,
  getSelectedCliModel,
  getSelectedLoopCliModel,
  getSelectedLoopSubtaskCli,
  getSelectedLoopFrontendCli,
  getSelectedLoopFullstackCli,
  getSelectedLoopSubtaskMode,
  getLoopRoleExplicitModel,
  getLoopModelSwitchOptions: (cli, role, configId) => {
    if (cli === "opencode") {
      return configId ? loopModelSwitchOpenCodeOptions.get(configId) ?? [] : [];
    }
    const state = buildModelState({ [cli]: configId });
    const options = state.loopOptionsByCli?.[cli]?.[role] ?? [];
    const labels = state.labelsByCli?.[cli] ?? {};
    const result = options.map((model) => ({ value: model, label: labels[model] || model }));
    return cli === "claude" || (cli === "codex" && !state.configuredDefaultByCli?.codex)
      ? [{ value: "", label: "默认" }, ...result] : result;
  },
  getSelectedLoopThinkingMode,
  getLoopModelSwitchThinkingOptions: (cli, model, configId) => {
    if (cli === "dsh") {
      return (buildModelState({ [cli]: configId }).dshReasoningOptionsByModel?.[model] ?? [])
        .map((value) => ({ value, label: value }));
    }
    return getLoopModelSwitchThinkingOptions(cli);
  },
  captureCurrentLoopOriginProfile: ({ cli, configId, mainModel, subtaskModel, subtaskCli, subtaskConfigId, subtaskThinkingMode, frontendModel, frontendCli, frontendConfigId, fullstackModel, fullstackCli, fullstackConfigId, subtaskFrontendThinkingMode, subtaskFullstackThinkingMode }) => captureLoopOriginProfile({
    cli,
    configId,
    mainModel,
    subtaskModel,
    subtaskCli,
    subtaskConfigId,
    subtaskThinkingMode,
    frontendModel,
    frontendCli,
    frontendConfigId,
    fullstackModel,
    fullstackCli,
    fullstackConfigId,
    subtaskFrontendThinkingMode,
    subtaskFullstackThinkingMode,
  }) ?? null,
  restoreOriginalLoopRuntime,
  isConfigLockResumeSessionAvailable,
  readConfigLockResumeTask: (taskId, taskStoreFile) => {
    if (readLoopTaskRecord(taskId)?.taskStoreFile !== taskStoreFile) return null;
    const read = readLoopTaskStoreResult(taskStoreFile, true, true);
    if (!read.ok) return null;
    const matches = read.store.tasks.filter((task) => task.id === taskId);
    return matches.length === 1 && matches[0].taskStoreFile === taskStoreFile ? matches[0] : null;
  },
  resumeLoopSubtasks: (taskId, resumeMain) => loopModelSwitchResumeCoordinator.resume(taskId, resumeMain),
  runLoopPrompt,
  stopRunsForTask: stopLoopRunsForTask,
  markTaskStoppedByUser: markLoopTaskStoppedByUser,
  notifyLoopPlusUserMessage: (taskId, text) => getLoopPlusOrchestrationHost().submitUserMessage(taskId, text),
  cancelClassicSubtask: (taskId, subtaskId) => requireLoopOrchestrationHost().cancelClassicSubtask(taskId, subtaskId),
  wakeClassicLoop: (taskId) => {
    const task = readLoopTaskRecord(taskId);
    if (task?.department?.role === "director") getDepartmentRuntimeComposition().wakeDirector(taskId);
    else requireLoopOrchestrationHost().wakeClassicLoop(taskId);
  },
  readLoopPlusAcceptancePlans: () => buildLoopPlusAcceptancePlansPanelValue(workspaceSettings),
  readLoopPlusAcceptancePlanSelection: () => buildLoopPlusAcceptancePlanSelectionPanelValue(workspaceSettings),
  saveLoopPlusAcceptancePlan: (input) => saveLoopPlusAcceptancePlan(createAcceptancePlanSettingsHost(), input),
  selectLoopPlusAcceptancePlan: (planId) => selectLoopPlusAcceptancePlan(createAcceptancePlanSettingsHost(), planId),
  deleteLoopPlusAcceptancePlan: (planId) => deleteLoopPlusAcceptancePlan(createAcceptancePlanSettingsHost(), planId),
  applyLoopPlusAcceptancePlan: (taskId, plan) => getLoopPlusOrchestrationHost().applyAcceptancePlan(taskId, plan),
  askMainModel: async (task, question, hooks) => {
    const signal = hooks?.signal;
    const isAborted = () => isExtensionDeactivating || signal?.aborted === true || hooks?.isAborted?.() === true;
    if (isAborted()) return { status: "stopped" };
    let target = resolveLoopMainPromptTarget(task, { createIfMissing: false });
    if (!target && task.sessionId) {
      target = resolveLoopMainPromptTarget(task, { createIfMissing: true });
    }
    const ask = () => askLoopMainModelSession({
      question,
      modelPrompt: t("loopGroupChatChat.askModelPrompt", { question }),
      target,
      isTabRunActive,
      readMessages: (promptTarget) => {
        const tab = getConversationTabById(promptTarget.tabId);
        const sessionId = tab
          ? getConversationTabSessionIdForCli(tab, promptTarget.cli)
          : promptTarget.sessionId;
        if (sessionId) {
          return loadSessionMessages(promptTarget.cli, sessionId);
        }
        return getPendingSessionDraft(promptTarget.tabId, promptTarget.cli).messages;
      },
      runPrompt: async (input, options) => {
        const execute = (runOptions: RunPromptOptions) => {
          if (task.departmentInvalid) throw new Error("部门任务关联无效，无法提问。");
          if (!usesDepartmentOwner(task.department)) return runPrompt(input, runOptions);
          return runDepartmentLeaderPrompt({ ...input, taskRole: "main", loopTaskId: task.id }, {
            targetTabId: options.targetTabId, invocationId: createMessageId(), isAborted, signal,
            registerQuestionRun: runOptions.registerQuestionRun,
          });
        };
        if (!signal) return execute(options);
        let stop: (() => void) | undefined;
        const abort = () => stop?.();
        signal.addEventListener("abort", abort, { once: true });
        try {
          await execute({
            ...options,
            registerQuestionRun: (runId) => {
              const tabId = options.targetTabId;
              stop = () => {
                const interactive = interactiveRunsByTabId.get(tabId);
                if (interactive?.runId === runId) interactive.stop();
                else if (parallelRunsByTabId.get(tabId)?.runId === runId) stopParallelRunForTab(tabId);
                else if (getPrimaryRunTabId() === tabId && primaryPromptRunController.activeRunId === runId) stopActiveRun();
              };
              if (signal.aborted) stop();
            },
          });
        } finally { signal.removeEventListener("abort", abort); }
      },
      onProgress: hooks?.onProgress,
      onStarted: hooks?.onStarted,
      isAborted,
      unavailableMessage: t("loopGroupChatChat.askUnavailable"),
      busyMessage: t("loopGroupChatChat.askBusy"),
      emptyMessage: t("loopGroupChatChat.askEmpty"),
      failedMessage: (detail) => t("loopGroupChatChat.askFailed", { detail }),
    });
    if (!target) {
      return ask();
    }
    return await loopMainQuestionQueue.runQuestion(target.tabId, {
      isAborted,
      signal,
      canRun: () => {
        if (isAborted() || isTabRunActive(target.tabId) || promptRunHandoff.isBusy(target.tabId)) return false;
        const latest = readLoopTaskRecord(task.id);
        const currentTarget = latest ? resolveLoopMainPromptTarget(latest, { createIfMissing: false }) : null;
        if (!latest || latest.id !== task.id || latest.workspaceKey !== task.workspaceKey || latest.taskStoreFile !== task.taskStoreFile
          || latest.department?.role !== task.department?.role || latest.departmentInvalid !== task.departmentInvalid
          || !currentTarget || currentTarget.tabId !== target.tabId || currentTarget.cli !== target.cli
          || (target.sessionId && currentTarget.sessionId !== target.sessionId)) {
          throw new Error(t("loopGroupChatChat.askUnavailable"));
        }
        return true;
      },
    }, ask) ?? { status: "stopped" };
  },
  readAskThread: (task) => {
    const dir = task.communicationDir.trim();
    if (!dir) {
      return createEmptyLoopAskThread();
    }
    return readLoopAskThreadFile(loopAskThreadPath(dir));
  },
  writeAskThread: (task, thread) => {
    const dir = task.communicationDir.trim();
    if (!dir) {
      return;
    }
    writeLoopAskThreadFile(loopAskThreadPath(dir), thread);
  },
  postPanelState,
  getActiveConversationTaskId: () => (
    normalizeLoopTaskId(primaryPromptRunController.activeTaskRun?.loopTaskId)
      ?? resolveActiveConversationLoopTaskId()
  ),
  showInformationMessage: (message) => { void vscode.window.showInformationMessage(message); },
  showWarningMessage: (message) => { void vscode.window.showWarningMessage(message); },
  pickTask: pickLoopGroupChatTask,
  t,
});

async function openLoopGroupChatPanel(arg?: unknown, options?: { focus?: boolean }): Promise<void> {
  await loopGroupChatChatPanelCoordinator.open(arg, options);
}

function normalizeLoopContinuePrompt(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || t("run.hiddenContinuePrompt");
}

function normalizeLoopContinuePromptForPrompt(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function refreshOpenLoopGroupChatPanelForTask(taskId: string): void {
  loopGroupChatChatPanelCoordinator.refreshOpenPanelForTask(taskId);
}

function resolveActiveConversationLoopTaskId(): string | null {
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    return null;
  }
  return resolveConversationTabLoopContext(activeTab).loopTaskId;
}

async function pickLoopGroupChatTask(tasks: LoopTaskRecord[]): Promise<LoopTaskRecord | null> {
  const items = tasks.map((task) => ({
    label: task.rootPrompt.split(/\r?\n/g)[0]?.slice(0, 80) || task.id,
    description: `${task.status} · ${task.cli} · ${task.id}`,
    detail: task.taskStoreFile,
    task,
  }));
  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: t("loopGroupChatChat.selectTask"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return selection?.task ?? null;
}

function listLoopGroupChatTasks(): LoopTaskRecord[] {
  return loopGroupChatChatPanelCoordinator.listGroupChatTasks();
}

function stopLoopRunsForTask(taskId: string): void {
  if (loopPlusRuntimeAdapter?.host().hasController(taskId) || readLoopTaskRecord(taskId)?.schedulingMode === "event_driven") {
    stopLoopPlusParent(taskId);
  }
  const runningTaskIds = collectRunningLoopTaskIds();
  if (!runningTaskIds.has(taskId)) {
    return;
  }

  const parallelTabIds = Array.from(parallelRunsByTabId.entries())
    .filter(([, run]) => resolveLoopConversationTabContextFromParallelRun(run).loopTaskId === taskId)
    .map(([tabId]) => tabId);
  parallelTabIds.forEach((tabId) => {
    stopParallelRunForTab(tabId);
  });

  const interactiveTabIds = Array.from(interactiveRunsByTabId.entries())
    .filter(([, run]) => resolveLoopConversationTabContextFromInteractiveRun(run).loopTaskId === taskId)
    .map(([tabId]) => tabId);
  interactiveTabIds.forEach((tabId) => {
    const run = interactiveRunsByTabId.get(tabId);
    run?.stop();
  });

  const primaryTaskId = resolvePrimaryLoopTaskId();
  if (primaryTaskId === taskId) {
    stopActiveRun();
  }
}

function resolvePrimaryLoopTaskId(): string | null {
  if (!isPrimaryRunActive()) {
    return null;
  }
  return normalizeLoopTaskId(primaryPromptRunController.activeTaskRun?.loopTaskId)
    ?? (Array.isArray(primaryPromptRunController.activeMessageTarget)
      ? resolveLoopConversationTabContextFromMessages(primaryPromptRunController.activeMessageTarget).loopTaskId
      : null);
}

function buildLoopGroupChatMessageAction(taskId: string, round?: number): ChatMessageAction {
  return loopGroupChatChatPanelCoordinator.buildMessageAction(taskId, round);
}

function buildLoopTaskNeedsReviewText(task: LoopTaskRecord): string {
  return buildLoopTaskNeedsReviewTextWithLimit(task, isLoopTaskBlockedByMainAiFailureLimit);
}

function buildLoopSubtaskRetryText(taskId: string, subtaskId: string, retryCount: number): string {
  return buildLoopSubtaskRetryTextWithLimit(
    taskId,
    subtaskId,
    retryCount,
    LOOP_SUBTASK_RETRY_MAX_RETRIES,
  );
}

function ensureLoopMainSubChatTranscript(task: LoopTaskRecord): string {
  return ensureLoopMainSubChatTranscriptWithDeps(task, {
    collectRunningLoopTaskIds,
    readTextFileIfNonEmpty,
    fileExists: (filePath) => fs.existsSync(filePath),
    writeTextFileEnsuringDir,
    getActiveLoopSubtaskIds,
    buildLoopCompletedConclusionAndSummaryMarkdown,
    t,
  });
}

const promptRunModelsHost = createPromptRunModelsHost({
  getActiveConfigIdForCli,
  getSelectedCliModel,
  getSelectedLoopCliModel,
  getSelectedLoopThinkingMode,
  normalizeThinkingModeForCli,
  getEffectiveThinkingMode,
  isThinkingMode,
  resolveOpenCodeRoleModelsForConfig,
});

function resolvePromptRunModelForRole(input: PromptRunInput, role: LoopTaskRole): string | undefined {
  return promptRunModelsHost.resolvePromptRunModelForRole(input, role);
}

function resolvePromptRunThinkingModeForRole(
  input: PromptRunInput,
  cli: CliName,
  role: LoopTaskRole,
  model: string | undefined,
  options: { configId?: string | null } = {},
): ThinkingMode | undefined {
  return promptRunModelsHost.resolvePromptRunThinkingModeForRole(input, cli, role, model, options);
}

async function hydrateOpenCodePromptRoleModels(input: PromptRunInput, cli: CliName): Promise<PromptRunInput> {
  return promptRunModelsHost.hydrateOpenCodePromptRoleModels(input, cli);
}

function logCliStartup(payload: {
  cli: CliName;
  cwd?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  mode: "one-shot" | "interactive";
}): void {
  void logEssential("cli-startup", payload);
}

function isPrimaryRunActive(): boolean {
  return Boolean(primaryPromptRunController.activeRunId && (primaryPromptRunController.activeProcess || primaryPromptRunController.activeInteractiveStop));
}

function getPrimaryRunTabId(): string | null {
  if (!isPrimaryRunActive()) {
    return null;
  }
  return primaryPromptRunController.activeTabIdForRun;
}

function hasAnyTaskRunning(): boolean {
  return isPrimaryRunActive() || parallelRunsByTabId.size > 0 || interactiveRunsByTabId.size > 0
    || promptAutoRepairController.hasRepairingRuns();
}

function isTabRunActive(tabId: string | null): boolean {
  if (!tabId) {
    return false;
  }
  if (parallelRunsByTabId.has(tabId) || interactiveRunsByTabId.has(tabId) || promptAutoRepairController.isRepairing(tabId)) {
    return true;
  }
  return getPrimaryRunTabId() === tabId;
}

function hasActiveLoopSubtasks(taskId: string): boolean {
  return ensureConversationTabs().tabs.some((tab) => {
    if (!isTabRunActive(tab.id)) return false;
    const context = resolveConversationTabLoopContext(tab);
    return context.taskRole === "subtask" && context.loopTaskId === taskId;
  });
}

function resolveLoopConversationTabContextFromParallelRun(
  run?: ParallelTabRun
): LoopConversationTabContext {
  return resolveLoopRunConversationTabContext(run);
}

function resolveLoopConversationTabContextFromInteractiveRun(
  run?: InteractiveTabRun
): LoopConversationTabContext {
  return resolveLoopRunConversationTabContext(run);
}

function resolveConversationTabLoopContextForCli(
  tab: ConversationTabRecord,
  cli: CliName,
): LoopConversationTabContext {
  const sessionId = getConversationTabSessionIdForCli(tab, cli);
  const messages = sessionId
    ? loadSessionMessages(cli, sessionId)
    : getPendingSessionDraft(tab.id, cli).messages;
  return resolveLoopConversationTabContextFromMessages(messages);
}

function resolveConversationTabLoopContext(tab: ConversationTabRecord): LoopConversationTabContext {
  const primaryTabId = getPrimaryRunTabId();
  if (primaryTabId === tab.id) {
    const taskRole = primaryPromptRunController.activeTaskRun?.taskRole;
    const loopTaskId = normalizeLoopTaskId(primaryPromptRunController.activeTaskRun?.loopTaskId);
    if ((taskRole === "main" || taskRole === "subtask") && loopTaskId) {
      return {
        taskRole,
        loopTaskId,
      };
    }
  }

  const parallelContext = resolveLoopConversationTabContextFromParallelRun(parallelRunsByTabId.get(tab.id));
  if (parallelContext.taskRole && parallelContext.loopTaskId) {
    return parallelContext;
  }

  const interactiveContext = resolveLoopConversationTabContextFromInteractiveRun(interactiveRunsByTabId.get(tab.id));
  if (interactiveContext.taskRole && interactiveContext.loopTaskId) {
    return interactiveContext;
  }

  const liveMessages = getLiveMessagesForTab(tab.id);
  if (liveMessages) {
    const liveContext = resolveLoopConversationTabContextFromMessages(liveMessages);
    if (liveContext.taskRole && liveContext.loopTaskId) {
      return liveContext;
    }
  }

  return resolveConversationTabLoopContextForCli(tab, tab.cli);
}

function collectRunningLoopTaskIds(): Set<string> {
  const runningTaskIds = new Set<string>();
  const addTaskId = (value: unknown): void => {
    const taskId = normalizeLoopTaskId(value);
    if (taskId) {
      runningTaskIds.add(taskId);
    }
  };

  loopOrchestrationOwnership.collectTaskIds().forEach(addTaskId);
  loopPlusRuntimeAdapter?.host().collectRunningTaskIds().forEach(addTaskId);

  if (isPrimaryRunActive()) {
    const primaryTaskId = normalizeLoopTaskId(primaryPromptRunController.activeTaskRun?.loopTaskId)
      ?? (Array.isArray(primaryPromptRunController.activeMessageTarget)
        ? resolveLoopConversationTabContextFromMessages(primaryPromptRunController.activeMessageTarget).loopTaskId
        : null);
    addTaskId(primaryTaskId);
  }

  parallelRunsByTabId.forEach((run) => {
    const taskId = normalizeLoopTaskId(run.loopTaskId)
      ?? resolveLoopConversationTabContextFromMessages(run.messageTarget).loopTaskId;
    addTaskId(taskId);
  });

  interactiveRunsByTabId.forEach((run) => {
    const taskId = normalizeLoopTaskId(run.loopTaskId)
      ?? resolveLoopConversationTabContextFromMessages(run.messageTarget).loopTaskId;
    addTaskId(taskId);
  });

  return runningTaskIds;
}

function isLoopTaskRunning(
  taskId: string,
  runningTaskIds: ReadonlySet<string> = collectRunningLoopTaskIds(),
): boolean {
  const task = readLoopTaskRecord(taskId);
  if (!task) {
    return runningTaskIds.has(taskId);
  }
  if (isLoopTaskRunOrphaned(task, runningTaskIds) && readDepartmentRootControl(task) === null) {
    markLoopTaskStoppedAfterRuntimeEnded(taskId);
    return false;
  }
  return resolveLoopTaskRunControlState(task, runningTaskIds).isRunning;
}

function readActiveRunForConversationTabFlow(tabId: string): { loopTaskId?: string | null } | null {
  if (!isTabRunActive(tabId)) {
    return null;
  }
  const interactiveRun = interactiveRunsByTabId.get(tabId);
  if (interactiveRun) {
    return { loopTaskId: interactiveRun.loopTaskId ?? null };
  }
  const parallelRun = parallelRunsByTabId.get(tabId);
  if (parallelRun) {
    return { loopTaskId: parallelRun.loopTaskId ?? null };
  }
  if (getPrimaryRunTabId() === tabId) {
    return { loopTaskId: primaryPromptRunController.activeTaskRun?.loopTaskId ?? null };
  }
  return { loopTaskId: null };
}

function reconcileRunningConversationTabs(): void {
  const checks: ConversationTabRunningFlowCheck[] = ensureConversationTabs().tabs.map((tab) => {
    const taskId = resolveConversationTabLoopContext(tab).loopTaskId;
    const task = taskId ? readLoopTaskRecord(taskId) : null;
    return {
      tabId: tab.id,
      task: task
        ? {
          id: task.id,
          status: task.status,
          loopPlus: readConversationTabRunningFlowLoopPlus(task.loopPlus),
        }
        : null,
      activeRun: readActiveRunForConversationTabFlow(tab.id),
    };
  });
  sendPanelMessage({
    type: "runningConversationTabsReconciled",
    startTabIds: selectActiveConversationTabRunningFlowIds(checks),
    stopTabIds: selectStaleConversationTabRunningFlowIds(checks),
  });
}

const restoreConversationTabConfiguration = createConversationTabConfigurationRestorer({
  getActiveTabId: getActiveConversationTabId,
  getWorkspaceKey: () => activeWorkspaceKey,
  getConfiguration: (tabId) => {
    const tab = getConversationTabById(tabId);
    if (!tab) {
      return null;
    }
    const context = resolveConversationTabLoopContext(tab);
    const sessionId = getConversationTabSessionIdForCli(tab, tab.cli);
    return resolveConversationTabConfiguration({
      cli: tab.cli,
      taskRole: context.taskRole,
      task: context.loopTaskId ? readLoopTaskRecord(context.loopTaskId) : null,
      messages: getLiveMessagesForTab(tabId)
        ?? (sessionId ? loadSessionMessages(tab.cli, sessionId) : getPendingSessionDraft(tabId, tab.cli).messages),
    });
  },
  configExists: async (cli, configId) => Boolean(await configService.getConfigById(cli, configId)),
  waitForConfigApply: (cli) => configApplyQueue.waitForIdle(cli),
  getActiveConfigId: getActiveConfigIdForCli,
  applyConfig: applyConfigById,
  getModelOptions: async (cli, configId, role) => {
    if (cli === "opencode") {
      const config = await configService.getConfigById(cli, configId);
      const parsed = parseOpenCodeConfigModels(config?.content ?? "{}");
      return parsed.candidates
        .filter((candidate) => validateOpenCodeModelOverride(parsed, role === "subtask" ? "subtask" : "main", candidate.value).ok)
        .map((candidate) => candidate.value);
    }
    if (cli === "grok") {
      const config = await configService.getConfigById(cli, configId);
      const parsed = parseGrokConfigModels(config?.content ?? "");
      modelSettingsHost.cacheGrokConfigModels(configId, parsed);
      return parsed.models;
    }
    if (cli === "kimi-code") {
      const config = await configService.getConfigById(cli, configId);
      const parsed = parseKimiCodeConfigModels(config?.configContent ?? config?.content ?? "");
      modelSettingsHost.cacheKimiCodeConfigModels(configId, parsed);
      return parsed.models;
    }
    return role === "vibe"
      ? getModelOptionsForCli(cli, configId)
      : getLoopModelOptionsForCliFromStore(modelStore, cli, role, configId);
  },
  selectModel: (route, role) => {
    if (route.cli === "opencode") {
      selectCliLoopModel(route.cli, role === "subtask" ? "subtask" : "main", route.model ?? null, route.configId);
    } else if (role === "vibe") {
      selectCliModel(route.cli, route.model ?? null, route.configId);
    } else {
      selectCliLoopModel(route.cli, role, route.model ?? null, route.configId);
    }
  },
  restoreThinking: (route, role) => {
    if (route.cli === "opencode") {
      if (route.openCodeVariant === null || isOpenCodeThinkingEffort(route.openCodeVariant)) {
        updateOpenCodeVariantForConfig(role === "subtask" ? "subtask" : "main", route.openCodeVariant, route.configId, route.model ?? null);
      }
    } else if (route.thinkingMode && isThinkingMode(route.thinkingMode)
      && normalizeThinkingModeForCli(route.cli, route.thinkingMode) === route.thinkingMode) {
      if (role === "vibe" || (route.cli === "claude" && role === "main")) {
        setCliModelThinkingMode(route.cli, route.model ?? null, route.thinkingMode);
      } else {
        setSelectedLoopThinkingMode(route.cli, role, route.model, route.thinkingMode, route.configId);
      }
    }
  },
  selectSubtaskCli: selectLoopSubtaskCli,
  onError: (error) => { void logError("conversation-tab-configuration-restore-failed", { error: String(error) }); },
});

function resolveAutoInteractiveModeForConversationTab(
  tab: ConversationTabRecord | null
): InteractiveMode {
  if (!tab) {
    return readToolSettings().newTaskInteractiveMode ?? "coding";
  }
  const context = resolveConversationTabLoopContext(tab);
  const actual = context.loopTaskId ? readLoopTaskRecord(context.loopTaskId) : null;
  const department = actual && !actual.departmentInvalid ? normalizeDepartmentMetadata(actual.department) : null;
  if (context.taskRole === "main" && department?.role === "director" && actual
    && department.rootTaskId === actual.id && actual.workspaceKey === activeWorkspaceKey && actual.cli === tab.cli
    && actual.sessionId === getConversationTabSessionIdForCli(tab, tab.cli)) return "department";
  return resolveConversationTabAutoInteractiveMode({
    taskRole: context.taskRole,
    loopTaskId: context.loopTaskId,
    schedulingMode: context.loopTaskId
      ? readLoopTaskRecord(context.loopTaskId)?.schedulingMode
      : undefined,
  });
}

function isLoopMainTabCloseLocked(tabId: string | null): boolean {
  if (!tabId) {
    return false;
  }
  const tab = getConversationTabById(tabId);
  if (!tab) {
    return false;
  }
  const context = resolveConversationTabLoopContext(tab);
  if (context.taskRole !== "main" || !context.loopTaskId) {
    return false;
  }
  const runningTaskIds = collectRunningLoopTaskIds();
  return isLoopTaskRunning(context.loopTaskId, runningTaskIds);
}

function hasOtherTabRun(activeTabId: string | null): boolean {
  if (!activeTabId) {
    return hasAnyTaskRunning();
  }
  if (parallelRunsByTabId.size > 0) {
    for (const tabId of parallelRunsByTabId.keys()) {
      if (tabId !== activeTabId) {
        return true;
      }
    }
  }
  if (interactiveRunsByTabId.size > 0) {
    for (const tabId of interactiveRunsByTabId.keys()) {
      if (tabId !== activeTabId) {
        return true;
      }
    }
  }
  const primaryTabId = getPrimaryRunTabId();
  return Boolean(primaryTabId && primaryTabId !== activeTabId);
}

function getActiveConversationTabBinding(cli?: CliName): InteractiveSessionBinding | null {
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    return null;
  }
  const targetCli = cli ?? activeTab.cli;
  return {
    cli: targetCli,
    sessionId: getConversationTabSessionIdForCli(activeTab, targetCli),
  };
}

function getInteractiveSessionBindingsForTab(tab: ConversationTabRecord): InteractiveSessionBinding[] {
  return (["codex", "claude"] as const).map((cli) => ({
    cli,
    sessionId: getConversationTabSessionIdForCli(tab, cli),
  }));
}

function buildActiveInteractiveSessionKeys(): Set<string> {
  const bindings: InteractiveSessionBinding[] = [];
  interactiveRunsByTabId.forEach((run) => {
    bindings.push({
      cli: run.cli,
      sessionId: run.sessionId,
    });
  });
  if (primaryPromptRunController.activeInteractiveStop && primaryPromptRunController.activeCliForRun && primaryPromptRunController.activeSessionId) {
    bindings.push({
      cli: primaryPromptRunController.activeCliForRun,
      sessionId: primaryPromptRunController.activeSessionId,
    });
  }
  return collectInteractiveSessionKeys(bindings);
}

function buildReferencedInteractiveSessionKeys(): Set<string> {
  const state = ensureConversationTabs();
  return collectReferencedInteractiveSessionKeys(state.tabs.map((tab) => tab.sessionIdByCli));
}

function disposeInteractiveRunnerIfUnused(binding: InteractiveSessionBinding | null): void {
  if (!binding || !interactiveRunnerManager) {
    return;
  }
  if (loopSubtaskAutoCompactions.has(binding.cli, binding.sessionId ?? null)) {
    return;
  }
  if (!shouldDisposeInteractiveSession(binding, {
    referencedSessionKeys: buildReferencedInteractiveSessionKeys(),
    activeSessionKeys: buildActiveInteractiveSessionKeys(),
  })) {
    return;
  }
  interactiveRunnerManager.disposeIfMatches(binding.cli, binding.sessionId ?? null);
}

// Prompt run target helpers moved to extensionHost/promptRunRuntime.ts.

function resolveLoopResumeTaskFromPrompt(
  prompt: string,
  targetTabId: string | null | undefined
): LoopTaskRecord | null {
  if (!normalizeLoopResumePrompt(prompt)) {
    return null;
  }
  const target = resolvePromptRunTarget(targetTabId ?? null);
  if (!target) {
    return null;
  }
  return findResumableLoopTaskForTarget(target);
}

function sendRunStatusForTab(
  tabId: string,
  status: "start" | "end" | "error" | "stopped",
  options: {
    message?: string;
    prompt?: string;
    startedAt?: number;
  } = {}
): void {
  if (status === "start") {
    markConversationTabRunStarted(tabId);
    clearTaskListForRunStart(tabId);
  } else {
    latestOpenCodeTaskListByTabId.delete(tabId);
  }
  sendPanelMessage({
    type: "runStatus",
    status,
    message: options.message,
    prompt: status === "start" ? options.prompt : undefined,
    startedAt: status === "start" ? options.startedAt : undefined,
    tabId,
  });
}

function markConversationTabRunStarted(tabId: string | null): void {
  const tab = tabId ? getConversationTabById(tabId) : null;
  if (tab) conversationTabRunRevisions.set(tab, {});
}

function clearTaskListForRunStart(tabId: string | null | undefined): void {
  const normalizedTabId = typeof tabId === "string" && tabId.trim() ? tabId : null;
  if (!normalizedTabId) {
    return;
  }
  latestOpenCodeTaskListByTabId.delete(normalizedTabId);
  sendPanelMessage({
    type: "taskListUpdate",
    items: [],
    tabId: normalizedTabId,
  });
}

function sendOpenCodeTaskListUpdate(
  items: readonly OpenCodeTaskListItem[],
  options: {
    source: "primary-stream" | "parallel-stream";
    tabId?: string | null;
  }
): void {
  const normalizedItems = items.map((item) => ({
    text: item.text,
    done: item.done,
  }));
  const tabId = options.tabId ?? primaryPromptRunController.activeTabIdForRun ?? getActiveConversationTabId();
  if (tabId) {
    latestOpenCodeTaskListByTabId.set(tabId, normalizedItems);
  }
  sendPanelMessage({
    type: "taskListUpdate",
    items: normalizedItems,
    ...(tabId ? { tabId } : {}),
  });
  void logDebug("opencode-task-list-forwarded", {
    source: options.source,
    tabId: tabId ?? null,
    itemCount: normalizedItems.length,
    completedCount: normalizedItems.filter((item) => item.done).length,
  });
}

function replayOpenCodeTaskLists(): void {
  if (!viewProvider) {
    return;
  }
  const tabIds = new Set(conversationTabStore.tabs.map((tab) => tab.id));
  for (const [tabId, items] of latestOpenCodeTaskListByTabId.entries()) {
    if (!tabIds.has(tabId)) {
      latestOpenCodeTaskListByTabId.delete(tabId);
      continue;
    }
    viewProvider.postMessage({
      type: "taskListUpdate",
      items,
      tabId,
    });
  }
}

function persistMessagesForTab(cli: CliName, sessionId: string | null, tabId: string, messages: ChatMessage[]): void {
  if (sessionId) {
    saveSessionMessages(cli, sessionId, messages);
    return;
  }
  updatePendingSessionDraft(tabId, { messages }, cli);
  ensureLocalSession(cli, tabId);
}

function getLiveMessagesForTab(tabId: string): ChatMessage[] | null {
  const parallelRun = parallelRunsByTabId.get(tabId);
  if (parallelRun?.messageTarget) {
    return parallelRun.messageTarget;
  }
  const interactiveRun = interactiveRunsByTabId.get(tabId);
  if (interactiveRun?.messageTarget) {
    return interactiveRun.messageTarget;
  }
  if (getPrimaryRunTabId() === tabId && primaryPromptRunController.activeMessageTarget) {
    return primaryPromptRunController.activeMessageTarget;
  }
  return null;
}


function stopLoopPlusInvocationRunner(tabId: string): boolean {
  const interactiveRun = interactiveRunsByTabId.get(tabId);
  if (interactiveRun) {
    interactiveRun.stop();
    return true;
  }
  if (stopParallelRunForTab(tabId)) {
    return true;
  }
  if (getPrimaryRunTabId() === tabId) {
    stopActiveRun();
    return true;
  }
  return false;
}

function cancelLoopPlusInvocation(tabId: string | null): boolean {
  if (!tabId) {
    return false;
  }
  return stopLoopPlusInvocationRunner(tabId);
}

function stopRunForTab(tabId: string | null, source: LoopTaskUserStopSource | null = "ai-panel"): void {
  if (!tabId) {
    return;
  }
  const departmentTask = typeof departmentTaskForTab === "function" ? departmentTaskForTab(tabId) : null;
  if (departmentTask?.department?.role === "director") {
    void getDepartmentRuntimeComposition().organizationControl.stop(departmentTask).catch((error) => {
      appendSystemMessageForLoop(resolvePromptRunTarget(tabId)!, `部门停止未完成：${errorToMessage(error)}`);
    });
    return;
  }
  const parentStop = resolveLoopPlusParentStopContext(tabId);
  const closeParentGate = parentStop && shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: parentStop.schedulingMode,
    taskRole: parentStop.taskRole,
    gateAlreadyClosing: loopPlusParentGateDepth > 0,
  }) && (parentStop.running || parentStop.hasController);
  const loopTaskId = parentStop?.taskRole === "main" && (closeParentGate || parentStop.running) ? parentStop.taskId : null;
  try {
    if (closeParentGate) stopLoopPlusParent(parentStop.taskId);
    const wasRepairing = promptAutoRepairController.isRepairing(tabId);
    promptAutoRepairController.cancel(tabId);
    if (wasRepairing) sendRunStatusForTab(tabId, "stopped");
    if (loopTaskId && !closeParentGate) stopLoopRunsForTask(loopTaskId);
    else stopLoopPlusInvocationRunner(tabId);
  } finally {
    if (loopTaskId) {
      if (source) markLoopTaskStoppedByUser(loopTaskId, source);
      else if (!closeParentGate) markLoopTaskStopped(loopTaskId);
      void postPanelState();
    }
  }
}

function stopOtherRunsExceptTab(tabId: string | null): void {
  const parallelTabIds = Array.from(parallelRunsByTabId.keys());
  parallelTabIds.forEach((parallelTabId) => {
    if (parallelTabId !== tabId) {
      stopParallelRunForTab(parallelTabId);
    }
  });

  for (const [interactiveTabId, interactiveRun] of interactiveRunsByTabId.entries()) {
    if (interactiveTabId !== tabId) {
      interactiveRun.stop();
    }
  }

  const primaryTabId = getPrimaryRunTabId();
  if (primaryTabId && primaryTabId !== tabId) {
    stopActiveRun();
  }
}

function buildOpenCodeMissingFinalOutputMessage(statusText?: string | null): string {
  const status = statusText && statusText.trim() ? statusText.trim() : null;
  return status
    ? `OpenCode 已成功退出，但没有返回助手回答。最后状态：${status}`
    : "OpenCode 已成功退出，但没有返回助手回答。请检查 OpenCode provider/model 配置，或运行 `opencode run --format json` 验证。";
}

function buildOpenCodeMissingFinalConclusionMessage(output: ReturnType<typeof parseOpenCodeRunOutput>): string {
  if (output.errorText) {
    return output.errorText;
  }
  if (output.finalText?.trim()) {
    return "OpenCode 已返回助手答复，但正文未包含 `[final_answer]`，因此未通过严格最终答复判定。";
  }
  return buildOpenCodeMissingFinalOutputMessage(output.statusText);
}

function buildOpenCodeFailureMessage(
  output: ReturnType<typeof parseOpenCodeRunOutput>,
  fallbackMessage: string,
): string {
  return buildOpenCodeRunFailureMessage(output, fallbackMessage, {
    missingFinalOutputMessage: buildOpenCodeMissingFinalOutputMessage(),
    missingFinalOutputWithStatusMessage: buildOpenCodeMissingFinalOutputMessage,
  });
}

function buildSubagentProgressLabels(): SubagentProgressLabels {
  return {
    provider: {
      opencode: "OpenCode",
      codex: "Codex",
      loop: "Loop",
    },
    subagent: t("run.subagent.label"),
    status: {
      running: t("run.subagent.running"),
      completed: t("run.subagent.completed"),
      failed: t("run.subagent.failed"),
      interrupted: t("run.subagent.interrupted"),
    },
    errorPrefix: t("run.subagent.errorPrefix"),
  };
}

// Parallel prompt runtime moved to extensionHost/promptParallelRuntime.ts.


let departmentExecutionStore: DepartmentRuntimeStore | null = null;
function getDepartmentExecutionStore() {
  return departmentExecutionStore ??= new DepartmentRuntimeStore(path.join(DATA_DIR, "department-runtime"));
}
let departmentExecutionProducer: ReturnType<typeof createDepartmentExecutionProducer> | null = null;
function getDepartmentExecutionProducer() {
  return departmentExecutionProducer ??= createDepartmentExecutionProducer({
    store: getDepartmentExecutionStore(), workspaceKey: () => activeWorkspaceKey, readTask: readLoopTaskRecord,
    authorityDirectory: path.join(DATA_DIR, "department-generation-authorities"),
    ownerDirectory: path.join(DATA_DIR, "department-execution-owners"),
    validateRoutes: validateDepartmentRoutes,
    logError,
    // Existing OpenCode runtime preparation always builds a private config overlay
    // for its fixed model. A missing model is unsupported before any builder.
    processOverlay: (selection) => {
      if (!selection.model) throw new Error("部门 OpenCode 员工缺少固化模型，不能确认配置 overlay 策略。");
      return true;
    },
  });
}
let departmentLeaderProductionHost: ReturnType<typeof createDepartmentLeaderProductionHost> | null = null;
let departmentExecutionResources: ReturnType<typeof createDepartmentExecutionResources> | null = null;
function getDepartmentExecutionResources() {
  return departmentExecutionResources ??= createDepartmentExecutionResources({
    workspace: () => activeWorkspaceKey, readTab: getConversationTabById, isActive: isTabRunActive,
    owns(identity) {
      const read = getDepartmentExecutionStore().read(identity.rootTaskId, identity.workspace);
      return read.ok && !!read.value && activeWorkspaceKey === identity.workspace
        && read.value.runtime.leaders.some((l) => l.taskId === identity.leaderTaskId && l.leaderSubtaskId === identity.moduleId && l.generation === identity.generation)
        && (read.value.executionBindings ?? []).some((b) => sameDepartmentExecution(b.identity, identity));
    },
    close: (tab) => sessionTabsHost.closeOwnedConversationTabAndRefreshPanel(tab as import("./sessionTabs").ConversationTabRecord),
  });
}
function getDepartmentLeaderProductionHost() {
  return departmentLeaderProductionHost ??= createDepartmentLeaderProductionHost({
    producer: getDepartmentExecutionProducer(), store: getDepartmentExecutionStore(),
    ownerDirectory: path.join(DATA_DIR, "department-execution-owners"),
    readTask: readLoopTaskRecord, updateTask: updateLoopTaskRecord, logInfo, logError,
  });
}

let departmentProcessPreparation: ReturnType<typeof createDepartmentProcessPreparation> | null = null;
function getDepartmentProcessPreparation() {
  return departmentProcessPreparation ??= createDepartmentProcessPreparation({
    store: getDepartmentExecutionStore(), employeeAdmission: getDepartmentExecutionProducer().employeeAdmission,
    retainOriginalClient: (binding, client, directory) => getDepartmentExecutionProducer().retainOriginalClient(binding, client, directory),
    prepareNativeContinuation: (...args) => getDepartmentExecutionProducer().prepareNativeContinuation(...args),
    nativeStopped: (binding) => getDepartmentExecutionProducer().nativeStopped(binding),
    ownerDirectory: path.join(DATA_DIR, "department-execution-owners"),
    workspaceKey: () => activeWorkspaceKey, readTask: readLoopTaskRecord, updateTask: updateLoopTaskRecord,
    prepareLaunch: async () => { throw new Error("部门进程缺少本次可信 CLI 准备能力。"); },
  });
}
let departmentCodexPreparation: ReturnType<typeof createDepartmentCodexPreparation> | null = null;
function getDepartmentCodexPreparation() {
  return departmentCodexPreparation ??= createDepartmentCodexPreparation({
    logInfo, logError,
    retainOriginalClient: (binding, client) => getDepartmentExecutionProducer().retainOriginalClient(binding, client),
    store: getDepartmentExecutionStore(), employeeAdmission: getDepartmentExecutionProducer().employeeAdmission,
    ownerDirectory: path.join(DATA_DIR, "department-execution-owners"),
    workspaceKey: () => activeWorkspaceKey, readTask: readLoopTaskRecord, updateTask: updateLoopTaskRecord,
  });
}
let departmentInteractiveRuntime: ReturnType<typeof createDepartmentInteractiveRuntime> | null = null;
function getDepartmentInteractiveRuntime() {
  return departmentInteractiveRuntime ??= createDepartmentInteractiveRuntime({
    producer: getDepartmentExecutionProducer(), store: getDepartmentExecutionStore(),
    ownerDirectory: path.join(DATA_DIR, "department-execution-owners"),
    readTask: readLoopTaskRecord, updateTask: updateLoopTaskRecord,
    log: (event, payload) => { void logInfo(event, payload); },
  });
}
function departmentOwnerPreparation(cli: CliName) {
  return cli === "codex" ? getDepartmentCodexPreparation() : getDepartmentProcessPreparation();
}
function departmentOwnerResources(taskId: string, cli: CliName): boolean {
  const task = readLoopTaskRecord(taskId);
  return (cli === "opencode" || cli === "codex") && usesDepartmentOwner(normalizeDepartmentMetadata(task?.department) ?? undefined);
}
let departmentRuntimeComposition: ReturnType<typeof createDepartmentRuntimeComposition> | null = null;
let departmentOwnershipIndex: ReturnType<typeof createDepartmentProductionTaskStoreForHost> | null = null;
const departmentValidatedRoutes = new Set<string>();
const departmentRouteRejections = new Map<string, string>();

function departmentTaskForTab(tabId: string | null): LoopTaskRecord | null {
  const tab = tabId ? getConversationTabById(tabId) : null;
  if (!tab) return null;
  const context = resolveConversationTabLoopContext(tab);
  const task = context.taskRole === "main" && context.loopTaskId ? readLoopTaskRecord(context.loopTaskId) : null;
  if (!task) return null;
  const tabSessionId = getConversationTabSessionIdForCli(tab, tab.cli);
  const workspaceMatches = task.workspaceKey === activeWorkspaceKey;
  const cliMatches = task.cli === tab.cli;
  const sessionMatches = task.sessionId === tabSessionId;
  const rejectionKey = `${task.id}\0${tab.id}`;
  if (workspaceMatches && cliMatches && sessionMatches) {
    departmentRouteRejections.delete(rejectionKey);
    return task;
  }
  if (task.department || task.departmentInvalid) {
    const rejection = JSON.stringify([tab.cli, task.cli, tabSessionId, task.sessionId, workspaceMatches, cliMatches, sessionMatches]);
    if (departmentRouteRejections.get(rejectionKey) !== rejection) {
      departmentRouteRejections.set(rejectionKey, rejection);
      void logEssential("department-session-route-rejected", {
        tabId: tab.id,
        loopTaskId: task.id,
        departmentRole: task.department?.role ?? null,
        cli: tab.cli,
        taskCli: task.cli,
        tabSessionId,
        taskSessionId: task.sessionId,
        workspaceMatches,
        cliMatches,
        sessionMatches,
      }).catch(() => undefined);
    }
  }
  return null;
}
function validateDepartmentRoutes(routes: DepartmentMetadata["routes"]): boolean {
  if (departmentRoleCliIssue("leader", routes.leader.cli) || departmentRoleCliIssue("employee", routes.employee.cli)) return false;
  return departmentValidatedRoutes.has(JSON.stringify(routes)) && Object.values(routes).every((route) => route.cli
    && readToolSettings().cliEnabledByName?.[route.cli] !== false);
}
async function prepareDepartmentRoutes(routes: DepartmentMetadata["routes"]): Promise<void> {
  for (const role of ["leader", "employee"] as const) {
    const issue = departmentRoleCliIssue(role, routes[role].cli);
    if (issue) throw new Error(issue);
  }
  const workspace = activeWorkspaceKey;
  await Promise.all(Object.values(routes).map(async (route) => {
    if (!route.cli) throw new Error("部门角色 CLI 缺失。");
    const candidates = await modelSettingsHost.getDepartmentRoleCandidates(route.cli, route.configId ?? null);
    validateDepartmentRoleCandidate({ cli: route.cli, configId: route.configId ?? null, model: route.model ?? null,
      thinkingMode: route.thinkingMode ?? null, openCodeVariant: route.openCodeVariant ?? null }, candidates);
    if (route.configId && !await configService.getConfigById(route.cli, route.configId)) {
      throw new Error("部门角色固化档案已不存在，拒绝启动。");
    }
  }));
  if (workspace !== activeWorkspaceKey) throw new Error("部门工作区已切换。");
  departmentValidatedRoutes.add(JSON.stringify(routes));
  if (!validateDepartmentRoutes(routes)) throw new Error("部门角色配置在核验期间发生变化。");
}
async function prepareDepartmentInvocation(input: PromptRunInput, tabId: string | null): Promise<PromptRunInput> {
  const task = input.loopTaskId ? readLoopTaskRecord(input.loopTaskId) : null;
  if (!task || (task.department === undefined && !task.departmentInvalid)) return input;
  const m = task.departmentInvalid ? null : normalizeDepartmentMetadata(task.department);
  if (!m) throw new Error("部门执行归属无效：固化角色元数据缺失或无效，拒绝启动。");
  if (task.workspaceKey !== activeWorkspaceKey) throw new Error("部门执行归属无效：任务工作区与当前工作区不一致，拒绝启动。");
  if (task.status !== "running") throw new Error(`部门执行归属无效：任务当前状态为 ${task.status}，仅 running 可启动。`);
  const route = input.taskRole === "subtask" ? m.routes.employee : m.role === "director" ? m.routes.director : m.routes.leader;
  if (!route.thinkingMode && route.cli !== "opencode") throw new Error("部门旧路由尚未固化思考力度，不能借当前界面选择替代执行。");
  const target = resolvePromptRunTarget(tabId);
  if (!route.cli || target?.cli !== route.cli) throw new Error("部门执行 CLI 与固化角色不匹配。");
  const before = JSON.stringify(task.department), workspace = activeWorkspaceKey, targetIdentity = JSON.stringify(target);
  if (m.executionMode !== "loop-plus") await prepareDepartmentRoutes(m.routes);
  const current = readLoopTaskRecord(task.id);
  if (current?.status !== "running"
    || current.departmentInvalid || JSON.stringify(current.department) !== before || workspace !== activeWorkspaceKey
    || JSON.stringify(resolvePromptRunTarget(tabId)) !== targetIdentity) throw new Error("部门角色或执行归属已变化，执行未启动。");
  return { ...input, model: route.model, thinkingModeOverride: route.thinkingMode ?? "off",
    ...(input.taskRole === "subtask" ? { loopSubtaskModel: route.model, loopSubtaskCli: route.cli, loopSubtaskConfigId: route.configId,
      loopSubtaskThinkingMode: route.thinkingMode } : { loopMainModel: route.model, loopMainThinkingMode: route.thinkingMode }),
    executionProfile: route.configId ? { configId: route.configId, model: route.model ?? null,
      thinkingMode: route.thinkingMode, openCodeVariant: route.openCodeVariant ?? null } : undefined };
}
function departmentLeaderSessionPromotionDeps() {
  return {
    workspaceKey: activeWorkspaceKey,
    readTask: readLoopTaskRecord,
    bindTask: bindLoopTaskToSession,
    readContext: (cli: CliName, sessionId: string) => resolveLoopConversationTabContextFromMessages(loadSessionMessages(cli, sessionId)),
  };
}

function getDepartmentRuntimeComposition(): ReturnType<typeof createDepartmentRuntimeComposition> {
  if (departmentRuntimeComposition) return departmentRuntimeComposition;
  const runtime = getLoopPlusRuntimeAdapter();
  const runtimeStore = getDepartmentExecutionStore();
  const executionRecovery = new DepartmentExecutionRecovery(runtimeStore, path.join(DATA_DIR, "department-execution-owners"), async () => true);
  const groupCleanup = createDepartmentProductionCleanup({
    store: runtimeStore, producer: getDepartmentExecutionProducer(),
    ownerDirectory: path.join(DATA_DIR, "department-execution-owners"),
    workspaceKey: () => activeWorkspaceKey, readTask: readLoopTaskRecord,
  });
  const storedLeaderIdentity = createDepartmentStoredLeaderIdentityReader({
    store: runtimeStore, workspaceKey: () => activeWorkspaceKey,
    readSessionContext: (cli, sessionId) => resolveLoopConversationTabContextFromMessages(loadSessionMessages(cli, sessionId)),
  });
  const coldRecovery = new DepartmentColdGenerationRecovery({
    store: runtimeStore, authorityDirectory: path.join(DATA_DIR, "department-generation-authorities"),
    ownerDirectory: path.join(DATA_DIR, "department-execution-owners"),
    workspaceKey: () => activeWorkspaceKey, readTask: readLoopTaskRecord, verifyStoredIdentity: storedLeaderIdentity,
    restoreTarget(task) {
      // Existing session manager restores the verified local transcript, never a new task/native session.
      const target = resolveLoopMainPromptTarget(task, { createIfMissing: true });
      const tab = target?.tabId && getConversationTabById(target.tabId);
      if (!tab || isTabRunActive(tab.id) || getConversationTabSessionIdForCli(tab, task.cli) !== task.sessionId) return null;
      const context = resolveConversationTabLoopContext(tab);
      return context.taskRole === "main" && context.loopTaskId === task.id
        ? { tabId: tab.id, cli: task.cli, sessionId: task.sessionId, restoredTab: tab } : null;
    },
    registerRestoredTarget: capability => getDepartmentExecutionResources().recordRestored(capability),
    acceptRetirement: capability => getDepartmentExecutionProducer().acceptColdRetirement(capability),
    logMemberStop: event => { void logEssential("department-cold-member-stop", event).catch(() => undefined); },
  });
  departmentRuntimeComposition = createDepartmentRuntimeComposition({
    runtime,
    async prepareColdRecovery(root, assertCurrent) {
      if (root.department?.executionMode === "loop-plus") return;
      try { await coldRecovery.prepare(root, assertCurrent); }
      catch (error) {
        const { reasons, message } = describeDepartmentColdStopFailure(error);
        void logEssential("department-cold-stop-unconfirmed", { rootTaskId: root.id, reasons }).catch(() => undefined);
        throw new Error(message);
      }
    },
    logOrganizationStop: (event) => { void logEssential("department-organization-stop", event).catch(() => undefined); },
    store: runtimeStore,
    readOrganizationRoot: (id) => getDepartmentOwnershipIndex().readTaskRecord(id),
    readLeaderTaskIds: (root, module) => getDepartmentOwnershipIndex().readDepartmentLeaderTaskIds(root, module),
    workspaceKey: () => activeWorkspaceKey,
    readTask: readLoopTaskRecord,
    updateTask: updateLoopTaskRecord,
    beginLeaderExecution: (taskId, generation) => getDepartmentExecutionProducer().openNewLeader(taskId, generation),
    resumeLeaderExecution: (taskId, generation) => getDepartmentExecutionProducer().openContinuedLeader(taskId, generation),
    prepareLeaderContinuation: (task, expected) => {
      // Retirement is a same-host capability issued after the original complete
      // Owner aggregate and durable capacity return, never a disk cleaned flag.
      const ownerExecution = usesDepartmentOwner(task.department);
      if ((ownerExecution && !getDepartmentExecutionProducer().canContinueLeader(task.id)) || task.workspaceKey !== activeWorkspaceKey
        || !validateDepartmentRoutes(expected.routes) || task.cli !== expected.routes.leader.cli
        || task.originProfile?.configId !== expected.routes.leader.configId) return null;
      if (!ownerExecution && task.sessionId && isLocalSessionId(task.sessionId)) {
        const repaired = repairStoppedDepartmentLeaderSession(task, {
          ...departmentLeaderSessionPromotionDeps(), readRuns: () => readTaskStore().runs,
          isTargetAvailable: (cli, sessionId, taskId) => {
            const tabs = ensureConversationTabs().tabs.filter((tab) => tab.cli === cli
              && (getConversationTabSessionIdForCli(tab, cli) === sessionId
                || isDepartmentLeaderMainContext(resolveConversationTabLoopContext(tab), taskId)));
            if (tabs.length === 0) return true;
            const [tab] = tabs;
            return tabs.length === 1 && !isTabRunActive(tab.id) && getConversationTabSessionIdForCli(tab, cli) === sessionId
              && isDepartmentLeaderMainContext(resolveConversationTabLoopContext(tab), taskId);
          },
        });
        if (!repaired) return null;
        task = repaired;
      }
      const existing = task.sessionId && findConversationTabIdBySession(task.cli, task.sessionId);
      if (existing) {
        const tab = getConversationTabById(existing);
        if (!tab || isTabRunActive(existing)) return null;
        const context = resolveConversationTabLoopContext(tab);
        if (context.loopTaskId && (context.loopTaskId !== task.id || context.taskRole !== "main")) return null;
      }
      const target = resolveLoopMainPromptTarget(task, { createIfMissing: true });
      const tab = target?.tabId ? getConversationTabById(target.tabId) : null;
      if (!target?.tabId || !tab || tab.cli !== task.cli || target.cli !== task.cli
        || getConversationTabSessionIdForCli(tab, task.cli) !== task.sessionId || isTabRunActive(tab.id)) return null;
      const context = resolveConversationTabLoopContext(tab);
      if (context.loopTaskId && (context.loopTaskId !== task.id || context.taskRole !== "main")) return null;
      // The existing trusted API creates the actual session tab; establish its
      // main-task transcript through the normal host writer before inspection.
      if (!existing && ownerExecution) getDepartmentExecutionResources().recordCreated(tab.id);
      appendSystemMessageForLoop(target, ownerExecution ? "原代次已完成清理，显式继续同一组长会话。" : "继续同一组长会话。", { taskRole: "main", loopTaskId: task.id, merge: false });
      const bound = resolveConversationTabLoopContext(tab);
      return bound.taskRole === "main" && bound.loopTaskId === task.id
        ? { tabId: tab.id, cli: task.cli, sessionId: task.sessionId! } : null;
    },
    createMessageId,
    prepareRoutes: (routes) => createPerformanceTrace("department", routes.director.cli ?? undefined).measure("route-validation",
      () => prepareDepartmentRoutes(routes)),
    validateRoutes: validateDepartmentRoutes,
    resolveTarget: (tabId) => resolvePromptRunTarget(tabId),
    taskForTarget: departmentTaskForTab,
    resolveTargetForRoot: (root) => {
      const target = resolveLoopMainPromptTarget(root, { createIfMissing: true });
      return target?.tabId ? { ...target, tabId: target.tabId, sessionId: root.sessionId ?? null } : null;
    },
    createRoot: (input, target, configuration) => {
      // The first department prompt has not yet entered the session draft at
      // root creation time. Allocate a lifecycle-owned local key for this tab;
      // the Codex Owner later binds the real native thread independently.
      ensureLocalSession(target.cli, target.tabId, true);
      const sessionId = resolveLoopTaskSessionId(target);
      if (!sessionId) throw new Error("总监独立会话创建失败。");
      const source = getDepartmentOwnershipIndex();
      const task = createLoopTaskRecord(target.cli, input.displayPrompt, { sessionId, buildOnly: true });
      const updated = source.create(prepareDepartmentTaskRecord(task, {
        version: 1, rootTaskId: task.id, parentTaskId: null, leaderSubtaskId: null, role: "director", executionMode: "loop-plus",
        moduleTitle: input.displayPrompt, routes: structuredClone(configuration.routes), limits: { ...configuration.limits },
      }, configuration.loopPlusAcceptancePlan));
      ensureLoopCommunicationFiles(updated.id, updated.rootPrompt);
      ensureLoopMainSubChatTranscript(updated);
      appendSystemMessageForLoop({ ...target, sessionId }, "产研部总监任务已创建。", { taskRole: "main", loopTaskId: task.id,
        merge: false, actions: [buildLoopGroupChatMessageAction(task.id)] });
      return updated;
    },
    createLeaderTarget: (route, root) => {
      if (!route.cli) throw new Error("组长 CLI 缺失。");
      const target = createLoopSubtaskRunTarget(route.cli);
      ensureLocalSession(route.cli, target.tabId, true);
      const sessionId = resolveLoopTaskSessionId(target);
      if (!sessionId) throw new Error("组长独立会话创建失败。");
      if (root.department?.executionMode !== "loop-plus" && (route.cli === "codex" || route.cli === "opencode")) getDepartmentExecutionResources().recordCreated(target.tabId);
      return { ...target, sessionId };
    },
    verifyStoredLeaderIdentity: storedLeaderIdentity,
    inspectLeaderSession: (task, expected) => {
      const recovered = coldRecovery.inspect(task); if (recovered) return recovered;
      const sessionId = task.sessionId;
      if (typeof sessionId !== "string" || !sessionId.trim()) return null;
      const tabId = findConversationTabIdBySession(task.cli, sessionId)
        ?? (task.department?.executionMode === "loop-plus" && task.status !== "running"
          ? resolveLoopMainPromptTarget(task, { createIfMissing: true })?.tabId : undefined);
      if (!tabId || task.cli !== expected.routes.leader.cli || task.originProfile?.configId !== expected.routes.leader.configId) return null;
      const tab = getConversationTabById(tabId);
      if (!tab || getConversationTabSessionIdForCli(tab, task.cli) !== sessionId) return null;
      const context = resolveConversationTabLoopContext(tab);
      if (context.taskRole !== "main" || context.loopTaskId !== task.id) return null;
      // EH memory cannot certify a restored coordination lifecycle. An
      // independent whole-group Owner producer/aggregate is still required.
      return { target: { tabId, cli: task.cli, sessionId }, live: null };
    },
    observeRestoredExecution: (task, attempt) => coldRecovery.owns(task.id)
      ? coldRecovery.observeAttempt(task, attempt) : executionRecovery.observeAttempt(task, attempt),
    observeLeaderCleanup: (task, generation) => coldRecovery.owns(task.id) ? coldRecovery.observation(task.id, generation) : groupCleanup.observe(task, generation),
    leaderReleased: async (taskId, generation) => {
      if (coldRecovery.owns(taskId)) { await coldRecovery.released(taskId, generation); return; }
      getDepartmentLeaderProductionHost().release(taskId);
      departmentCodexPreparation?.releaseTask(taskId);
      departmentInteractiveRuntime?.releaseTask(taskId);
      await getDepartmentExecutionProducer().retire(taskId, generation);
    },
    stopLeader: async (taskId) => {
      if (readLoopTaskRecord(taskId)?.department?.executionMode === "loop-plus") {
        runtime.host().stopParent(taskId); stopLoopRunsForTask(taskId);
        await runtime.waitForTaskIdle(taskId);
        return;
      }
      if (coldRecovery.owns(taskId)) { await coldRecovery.stop(taskId); return; }
      const closure = getDepartmentExecutionProducer().close(taskId); // fences grants synchronously
      runtime.host().stopParent(taskId); stopLoopRunsForTask(taskId);
      const result = await closure; if (!result.ok) throw new Error(result.error);
      await runtime.waitForTaskIdle(taskId);
    },
    stopDirector: (taskId) => { abortOrchestratorClarification(loopClarificationScope(taskId)); stopLoopRunsForTask(taskId); },
    waitForDirectorClarification: waitForLoopTaskClarification,
    runDirectorDecision: (request) => createPerformanceTrace("department", request.target.cli, "director").measure("main-decision",
      () => requireLoopOrchestrationHost().runClassicLoopMainDecision(request),
      (result) => result.status === "interrupted" ? (result.runStatus === "stopped" ? "stopped" : "failed") : "returned"),
    captureDirectorTaskSummary: (input, target) => { rememberConversationTaskSummarySubmission(input, target, true); },
    openGroupChat: async (taskId) => openLoopGroupChatPanel(taskId),
    acquireDirectorOwnership: (taskId) => loopOrchestrationOwnership.acquire(taskId),
    acquireLeaderOwnership: (taskId) => loopOrchestrationOwnership.acquire(taskId),
    applyClassicDecision: (taskId, decision) => applyLoopMainDecision(taskId, decision),
    report: (taskId, message) => {
      const task = readLoopTaskRecord(taskId), target = task && resolveLoopMainPromptTarget(task, { createIfMissing: false });
      if (target) appendSystemMessageForLoop(target, message, { taskRole: "main", loopTaskId: taskId, merge: false });
      refreshOpenLoopGroupChatPanelForTask(taskId); void postPanelState();
    },
    completed: (task, decision, target) => {
      appendLoopAnswerConclusionMessage(target, task, decision); appendLoopFinalSummaryMessage(target, task, decision);
      notifyLoopTaskCompletion(humanInteractionAttention, task); void postPanelState();
    },
    log: (event, error) => { void logError(event, { error: errorToMessage(error) }); },
  });
  return departmentRuntimeComposition;
}
function getDepartmentOwnershipIndex(): ReturnType<typeof createDepartmentProductionTaskStoreForHost> {
  if (!departmentOwnershipIndex) {
    departmentOwnershipIndex = createDepartmentProductionTaskStoreForHost(DATA_DIR);
  }
  return departmentOwnershipIndex;
}
function readDepartmentRootControl(task: LoopTaskRecord): { needsCleanup: boolean; stopState: "stopping" | "unconfirmed" | "confirmed" | undefined } | null {
  return readDepartmentOrganizationStopFeedback(task, activeWorkspaceKey, {
    readTaskRecord: (id) => departmentOwnershipIndex?.readTaskRecord(id) ?? null,
    readCapacity: (id) => {
      if (departmentRuntimeComposition) return departmentRuntimeComposition.readCapacity(id);
      const current = departmentOwnershipIndex?.readTaskRecord(id);
      if (!current) return null;
      const stored = getDepartmentExecutionStore().read(id, current.workspaceKey);
      return stored.ok ? stored.value?.capacity ?? null : null;
    },
  }, departmentRuntimeComposition?.readOrganizationStopState(task.id));
}
function readDepartmentAwareGroupChatTask(taskId: string): LoopTaskRecord | null {
  const indexed = departmentOwnershipIndex?.readTaskRecord(taskId) ?? null;
  if (indexed) return indexed;
  return readKnownOrdinaryLoopTaskRecord(taskId);
}


let loopPlusRuntimeAdapter: ReturnType<typeof createLoopPlusRuntimeAdapter> | null = null;
let loopPlusParentGateDepth = 0;

function persistLoopPlusTaskUpdate(taskId: string, patch: Partial<LoopTaskRecord>, deferRefresh?: boolean): LoopTaskRecord | null {
  const refresh = (id: string) => {
    refreshOpenLoopGroupChatPanelForTask(id);
    return postPanelState();
  };
  return createLoopPlusPersistedTaskRefresher<Partial<LoopTaskRecord>>({
    updateTask: (id, nextPatch) => updateLoopTaskRecord(id, nextPatch),
    refreshTaskSurfaces: (id) => deferRefresh ? Promise.resolve().then(() => refresh(id)) : refresh(id),
  })(taskId, patch);
}

function canAutoResumeLoopPlusMain(task: LoopTaskRecord, target: LoopPlusPromptTarget, nativeSessionId: string | undefined): boolean {
  if (isExtensionDeactivating || task.workspaceKey !== activeWorkspaceKey || target.cli !== "codex"
    || !target.sessionId || !nativeSessionId || task.executionSessionInvalid) return false;
  const tab = getConversationTabById(target.tabId);
  if (!tab || tab.cli !== target.cli || tab.sessionId !== target.sessionId) return false;
  const context = resolveConversationTabLoopContext(tab);
  if (context.taskRole !== "main" || context.loopTaskId !== task.id) return false;
  const thread = resolveInteractiveMappedId(target.cli, target.sessionId)
    ?? (isLocalSessionId(target.sessionId) ? null : target.sessionId);
  return thread === nativeSessionId && (!task.executionSession || task.executionSession.sessionId === thread);
}

function getLoopPlusRuntimeAdapter(): ReturnType<typeof createLoopPlusRuntimeAdapter> {
  if (!loopPlusRuntimeAdapter) {
    loopPlusRuntimeAdapter = createLoopPlusRuntimeAdapter({
      createPerformanceTrace,
      isInvocationActive: (tabId) => isTabRunActive(tabId),
      hasActiveSubtasks: hasActiveLoopSubtasks,
      getActiveConfigIdForCli,
      assertNewTaskModeAvailable: () => assertModeAvailable("loop_plus", readToolSettings()),
      decisionSubtaskMax: () => getEffectiveLoopPlusDecisionSubtaskMax(),
      launchDelayMs: (lastLaunchAt) => getLoopSubtaskLaunchDelayMs(lastLaunchAt),
      readTask: (taskId) => readLoopTaskRecord(taskId),
      readMainRecoveryTask: readKnownOrdinaryLoopTaskRecord,
      canAutoResumeMain: canAutoResumeLoopPlusMain,
      createTask: ({ cli, rootPrompt, sessionId, snapshot, prompt, departmentMetadata }) => {
        let task = createLoopTaskRecord(cli, rootPrompt, { sessionId, buildOnly: Boolean(departmentMetadata) });
        const modeField = readLoopSubtaskModeField(prompt.loopSubtaskMode);
        if (modeField === null) {
          throw new Error("子任务模式无效，不能创建 Loop+ 任务。");
        }
        const loopSubtaskMode = modeField ?? "fullstack";
        const modelRouting = loopModelRoutingFromPromptInput(prompt, { mainCli: cli });
        const originProfile = captureLoopOriginProfile({
          cli,
          configId: getActiveConfigIdForCli(cli),
          mainModel: modelRouting?.main.model,
          subtaskModel: modelRouting?.subtask.model,
          subtaskCli: modelRouting?.subtask.cli ?? prompt.loopSubtaskCli,
          subtaskConfigId: modelRouting?.subtask.configId ?? prompt.loopSubtaskConfigId,
          frontendModel: modelRouting?.subtaskFrontend?.model ?? prompt.loopSubtaskFrontendModel,
          frontendCli: modelRouting?.subtaskFrontend?.cli ?? prompt.loopSubtaskFrontendCli,
          frontendConfigId: modelRouting?.subtaskFrontend?.configId ?? prompt.loopSubtaskFrontendConfigId,
          mainThinkingMode: prompt.loopMainThinkingMode,
          subtaskThinkingMode: prompt.loopSubtaskThinkingMode,
          subtaskFrontendThinkingMode: prompt.loopSubtaskFrontendThinkingMode,
          fullstackModel: modelRouting?.subtaskFullstack?.model ?? prompt.loopSubtaskFullstackModel,
          fullstackCli: modelRouting?.subtaskFullstack?.cli ?? prompt.loopSubtaskFullstackCli,
          fullstackConfigId: modelRouting?.subtaskFullstack?.configId ?? prompt.loopSubtaskFullstackConfigId,
          subtaskFullstackThinkingMode: prompt.loopSubtaskFullstackThinkingMode,
        });
        const acceptancePlan = departmentMetadata ? normalizeLoopPlusAcceptancePlanSnapshot(prompt.loopPlusAcceptancePlan)
          : normalizeLoopPlusAcceptancePlanSnapshotForStorage(prompt.loopPlusAcceptancePlan);
        if (departmentMetadata) {
          if (!acceptancePlan) throw new Error("组长统一验收方案缺失，任务未创建。");
          task = getDepartmentOwnershipIndex().create(prepareDepartmentTaskRecord({ ...task,
            schedulingMode: "event_driven", loopPlus: snapshot, loopPlusMainPhase: "decomposing",
            loopSubtaskMode,
          }, departmentMetadata, acceptancePlan));
          if (usesDepartmentOwner(task.department)) getDepartmentExecutionProducer().recordNewLeader(task);
          ensureLoopCommunicationFiles(task.id, task.rootPrompt);
          ensureLoopMainSubChatTranscript(task);
          return task;
        }
        task = persistLoopPlusTaskUpdate(task.id, {
          schedulingMode: "event_driven",
          loopPlus: snapshot,
          loopPlusMainPhase: "decomposing",
          loopSubtaskMode,
          ...(acceptancePlan ? { loopPlusAcceptancePlan: acceptancePlan } : {}),
          ...(modelRouting ? { modelRouting } : {}),
          ...(originProfile ? { originProfile } : {}),
          updatedAt: Date.now(),
        }) ?? {
          ...task,
          schedulingMode: "event_driven",
          loopPlus: snapshot,
          loopPlusMainPhase: "decomposing",
          loopSubtaskMode,
          ...(acceptancePlan ? { loopPlusAcceptancePlan: acceptancePlan } : {}),
          ...(modelRouting ? { modelRouting } : {}),
          ...(originProfile ? { originProfile } : {}),
        };
        ensureLoopMainSubChatTranscript(task);
        return readLoopTaskRecord(task.id) ?? task;
      },
      updateTask: (taskId, patch) => persistLoopPlusTaskUpdate(taskId, patch),
      commitConfigLockResume: (taskId, patch) => persistLoopPlusTaskUpdate(taskId, patch, true),
      appendHostMessage: (target, message, taskId) => {
        appendSystemMessageForLoop(target, loopPlusHostMessage(message, taskId), {
          taskRole: "main",
          loopTaskId: taskId,
          merge: false,
          actions: [buildLoopGroupChatMessageAction(taskId)],
        });
      },
      appendCompletionMessages: (target, task) => {
        appendLoopAnswerConclusionMessage(target, task);
        appendLoopFinalSummaryMessage(target, task);
      },
      onTaskCompleted: (taskId) => {
        const task = readLoopTaskRecord(taskId);
        if (task) {
          notifyLoopTaskCompletion(humanInteractionAttention, task);
        }
      },
      onMainActivityChange: refreshOpenLoopGroupChatPanelForTask,
      appendSubtaskChat: (target, notice) => {
        appendLoopPlusSubtaskChat(target, notice);
      },
      appendAcceptancePlanChat: (taskId, section) => {
        const task = readLoopTaskRecord(taskId);
        if (!task) {
          return;
        }
        const chatFile = ensureLoopMainSubChatTranscript(task);
        appendTextFileEnsuringDir(chatFile, `\n## ${section.heading}\n${section.body.trim()}\n`);
        refreshOpenLoopGroupChatPanelForTask(task.id);
      },
      recordPause: (task, message) => {
        recordLoopPlusPause(task, message);
        refreshOpenLoopGroupChatPanelForTask(task.id);
      },
      prepareCommunication: (task, subtask, round) => prepareLoopSubtaskCommunicationFile(task, subtask, round, 0),
      appendAttemptReport: (filePath, content) => {
        appendTextFileEnsuringDir(filePath, content);
      },
      log: (event, payload) => {
        logLoopPlusRuntimeEvent(event, payload);
      },
      revealClarification: (taskId) => { void openLoopGroupChatPanel(taskId, { focus: true }); },
      removeClarificationResponse: (target, taskId, response) => {
        removeLoopPlusClarificationResponse(target, taskId, response);
      },
      waitForClarification: waitForOrchestratorClarificationWithAttention,
      recordInteractionHistory: recordOrchestratorInteractionResponse,
      runPrompt: (input, options) => runPrompt(input, options),
      runDepartmentMain: runDepartmentLeaderPrompt,
      closeDepartmentCoordinator: async (taskId) => {
        const result = await getDepartmentExecutionProducer().close(taskId);
        if (!result.ok) throw new Error(result.error);
      },
      getMessages: (target) => getLoopMessagesForTarget(target),
      readRuns: () => readTaskStore().runs,
      subscribeRunCompletion: (listener) => {
        const subscription = taskRunCompletionEmitter.event(listener);
        return () => subscription.dispose();
      },
      resolveThinkingMode: (input, cli, role, model) => resolvePromptRunThinkingModeForRole(
        input,
        cli,
        role,
        model,
        {
          configId: role === "subtask" ? input.loopSubtaskConfigId : undefined,
        },
      ),
      findLegacyGrokExecutionCwd: async (sessionId) => {
        const workspaceCwd = resolveWorkspaceCwd();
        return workspaceCwd ? findLegacyGrokLoopCwd(workspaceCwd, sessionId) : null;
      },
      ownsDepartmentAttemptResources: (request) => {
        if (usesDepartmentInteractiveRuntime(request.targetCli) && usesDepartmentOwner(readLoopTaskRecord(request.taskId)?.department)) {
          getDepartmentInteractiveRuntime().authorizeAttempt(request.taskId, request.subtaskId, request.attemptId);
          return false; // The existing Loop+ adapter owns its root and tab.
        }
        if (!departmentOwnerResources(request.taskId, request.targetCli)) return false;
        departmentOwnerPreparation(request.targetCli).authorizeAttempt(request.taskId, request.subtaskId, request.attemptId);
        return true;
      },
      observeAttemptTermination: (request) => usesDepartmentInteractiveRuntime(request.targetCli) && usesDepartmentOwner(readLoopTaskRecord(request.taskId)?.department)
        ? getDepartmentInteractiveRuntime().observe(request.taskId, request.attemptId)
        : departmentOwnerResources(request.taskId, request.targetCli)
          ? departmentOwnerPreparation(request.targetCli).observe(request.taskId, request.attemptId, request.subtaskId) : null,
      createExecutionRoot: (grokExecutionRootId, useWorkspaceCwd, grokExecutionCwd) => {
        const workspaceCwd = resolveWorkspaceCwd();
        if (!workspaceCwd) return null;
        return useWorkspaceCwd
          ? { cwd: workspaceCwd, isolateProjectInstructions: false, dispose: () => undefined }
          : createWorkspaceLoopSubtaskExecutionRoot(workspaceCwd, grokExecutionRootId, grokExecutionCwd);
      },
      createSubtaskTarget: (cli, options) => createLoopSubtaskRunTarget(cli, options),
      recordDepartmentSubtaskTarget: (target) => {
        // The adapter calls this only for a Department leader's freshly created
        // employee target, before its first prompt installs any tab loop context.
        // This records creation, not execution authority; native admission still
        // validates the task, attempt, route, binding and original capability.
        if (target.cli === "codex" || target.cli === "opencode") {
          getDepartmentExecutionResources().recordCreated(target.tabId);
        }
      },
      onSubtaskPreparationFailed: (tabId, status) => sendRunStatusForTab(tabId, status),

      closeSubtaskTab: (tabId) => closeLoopSubtaskTabAndRefreshPanel(tabId),
      prepareSubtaskTabClose: prepareLoopSubtaskTabClose,
      closeSubtaskTabs: (taskId, subtaskId, attemptId) => closeLoopSubtaskTabs(taskId, subtaskId, undefined, attemptId),
      cancelInvocation: (tabId) => {
        cancelLoopPlusInvocation(tabId);
      },
      resolveSessionId: (target) => resolveLoopTaskSessionId(target),
      activeWorkspaceKey: () => activeWorkspaceKey,
      isSubtaskConversation: (target) => Boolean(resolveLoopSubtaskConversationContext(target.cli, target.tabId)),
      isTaskCompatible: (task, target) => isLoopTaskCompatibleWithTarget(task, target, { allowMissingTaskSessionId: true }),
      bindResumeTarget: (taskId, cli, sessionId) => bindLoopTaskToRuntimeTarget(taskId, cli, sessionId),
      hiddenContinuePrompt: () => t("run.hiddenContinuePrompt"),
      normalizeContinuePrompt: (prompt) => normalizeLoopContinuePromptForPrompt(prompt),
      appendRefusal: (target, kind) => {
        const content = kind === "nested"
          ? t("run.loopPlusNestedRefused")
          : kind === "original-unavailable"
            ? t("loopGroupChatChat.originalRuntimeUnavailable")
            : t("run.loopResumeUnavailableStartNew");
        appendSystemMessageForLoop(target, content);
      },
    });
  }
  return loopPlusRuntimeAdapter;
}

function getLoopPlusOrchestrationHost(): ReturnType<ReturnType<typeof createLoopPlusRuntimeAdapter>["host"]> {
  return getLoopPlusRuntimeAdapter().host();
}

function createAcceptancePlanSettingsHost() {
  return {
    getWorkspaceSettings: () => workspaceSettings,
    setWorkspaceSettings: (settings: WorkspaceSettings) => {
      workspaceSettings = settings;
    },
    saveWorkspaceSettings: (settings: WorkspaceSettings) => {
      const result = trySaveWorkspaceSettingsToStore(settings, getWorkspaceSettingsStoreOptions());
      return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
    },
  };
}

function stopLoopPlusParent(taskId: string): void {
  loopPlusParentGateDepth += 1;
  try {
    getLoopPlusOrchestrationHost().stopParent(taskId);
  } finally {
    loopPlusParentGateDepth -= 1;
  }
}

function resolveLoopPlusParentStopContext(tabId: string): {
  taskId: string;
  taskRole: "main" | "subtask";
  schedulingMode: unknown;
  running: boolean;
  hasController: boolean;
} | null {
  const tab = getConversationTabById(tabId);
  if (!tab) {
    return null;
  }
  const context = resolveConversationTabLoopContext(tab);
  if ((context.taskRole !== "main" && context.taskRole !== "subtask") || !context.loopTaskId) {
    return null;
  }
  const hasController = loopPlusRuntimeAdapter?.host().hasController(context.loopTaskId) ?? false;
  const task = readLoopTaskRecord(context.loopTaskId);
  return {
    taskId: context.loopTaskId,
    taskRole: context.taskRole,
    schedulingMode: hasController ? "event_driven" : task?.schedulingMode,
    running: task?.status === "running",
    hasController,
  };
}

async function handleLoopPlusSubtaskContinuation(context: { taskId: string; subtaskId: string; round: number; attemptId?: string }, tabId: string): Promise<void> {
  const target = resolvePromptRunTarget(tabId);
  if (!target) {
    return;
  }
  const run = getLatestLoopRoundRunRecord(context.taskId, context.round, "subtask", context.subtaskId, context.attemptId);
  if (!run || run.status !== "end") {
    return;
  }
  const summary = selectLoopPlusContinuationDetail(getLoopMessagesForTarget(target), run, {
    taskId: context.taskId,
    round: context.round,
    role: "subtask",
    subtaskId: context.subtaskId,
    attemptId: context.attemptId,
  });
  const task = readLoopTaskRecord(context.taskId);
  if (!task || task.workspaceKey !== activeWorkspaceKey) return;
  const host = getLoopPlusOrchestrationHost();
  let closeTab: () => Promise<void>;
  try {
    closeTab = prepareLoopSubtaskTabClose(tabId, { completed: true, expected: context });
  } catch (error) {
    closeTab = async () => { throw error; };
  }
  const mainTarget = host.hasController(task.id) ? null : resolveLoopMainPromptTarget(task, { createIfMissing: true });
  host.notifySubtaskContinuation(context.taskId, context.subtaskId, "completed", summary,
    mainTarget?.tabId ? {
      target: { ...mainTarget, tabId: mainTarget.tabId },
      input: applyLoopModelRoutingToPrompt({
        displayPrompt: task.rootPrompt,
        modelPrompt: task.rootPrompt,
        contextTags: [],
      }, task.modelRouting, task.originProfile),
  } : undefined, () => closeLoopPlusSubtaskTab(tabId, {
      ...context, attemptId: context.attemptId, source: "continuation",
    }, closeTab), context.attemptId);
}

async function closeLoopPlusSubtaskTab(
  tabId: string,
  event: { taskId: string; round: number; subtaskId: string; attemptId?: string; source: "continuation" },
  closeTab: () => Promise<void>,
): Promise<void> {
  const closeAttempt = await retryLoopSubtaskTabClose(closeTab, (error, attempt, retrying) => {
    logLoopPlusRuntimeEvent("loop-plus-subtask-tab-auto-close-error", {
      ...event,
      tabId,
      closeAttempt: attempt,
      retrying,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  logLoopPlusRuntimeEvent("loop-plus-subtask-tab-auto-closed", { ...event, tabId, closeAttempt });
}

function appendLoopPlusSubtaskChat(
  target: Parameters<typeof appendSystemMessageForLoop>[0],
  notice: LoopPlusSubtaskChatNotice,
): void {
  const task = readLoopTaskRecord(notice.taskId);
  if (task) {
    const index = task.subTasks.findIndex((subtask) => subtask.id === notice.subtaskId);
    const recorded = index >= 0 ? task.subTasks[index] : undefined;
    const displayTitle = getLoopSubtaskDisplayTitle(index, {
      title: recorded?.title || notice.title,
    });
    const section = buildLoopPlusGroupChatSection(notice, displayTitle);
    const chatFile = ensureLoopMainSubChatTranscript(task);
    appendTextFileEnsuringDir(chatFile, `\n## ${section.heading}\n${section.body.trim()}\n`);
    refreshOpenLoopGroupChatPanelForTask(task.id);
  }
  appendSystemMessageForLoop(target, buildLoopPlusSubtaskParentMessage(notice), {
    taskRole: "main",
    loopTaskId: notice.taskId,
    loopRound: notice.round,
    loopSubtaskId: notice.subtaskId,
    merge: false,
    actions: [buildLoopGroupChatMessageAction(notice.taskId)],
  });
}

function loopPlusHostMessage(message: string, taskId: string): string {
  const task = readLoopTaskRecord(taskId);
  const file = task?.taskStoreFile ?? "";
  if (message === "loop-plus-started") {
    return t("run.loopPlusStarted", { taskId, file });
  }
  if (message === "loop-plus-resumed") {
    return t("run.loopPlusResumed", { taskId, file });
  }
  if (message === "loop-plus-waiting") {
    return t("run.loopPlusWaiting");
  }
  if (message === "loop-plus-user-messages") {
    return t("run.loopPlusUserMessages");
  }
  if (message === "loop-plus-stopped") {
    return t("run.loopPlusStopped");
  }
  if (message === "loop-plus-completed") {
    return t("run.loopPlusCompleted", { taskId });
  }
  if (message === "loop-plus-block-review") {
    return "Loop+ 正在复核剩余要求，检查是否还有可独立推进的工作；本次复核不会放宽安全门槛。";
  }
  if (["loop-plus-blocked", "loop-plus-main-failure-limit", "loop-plus-main-non-retryable", "loop-plus-main-recovery-exhausted", "loop-plus-protocol-paused"].includes(message) && task) {
    return buildLoopPlusPauseText(task, message);
  }
  if (message === "loop-plus-resume-blocked") {
    return t("run.loopPlusPaused", { detail: "上次停止的子任务仍在结束执行或等待资源释放。请等待收尾完成后再次继续；当前不会重复派发这些子任务。" });
  }
  return t("run.loopPlusPaused", { detail: message });
}

type LoopPromptOptions = { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean;
  resumeUserMessage?: string; preserveLoopOrigin?: boolean; schedulingMode?: "classic" | "event_driven";
  configLockRecovery?: ConfigLockResumeRequest; onTaskStarted?: () => void };

async function runEventDrivenLoopPrompt(
  input: PromptRunInput,
  options: LoopPromptOptions,
  target: PromptRunTarget,
  onTaskOwnershipAcquired?: (taskId: string, target: PromptRunTarget) => void | Promise<void>,
): Promise<boolean> {
  return getLoopPlusRuntimeAdapter().runEventDriven(input, options, target, onTaskOwnershipAcquired);
}

async function runLoopPrompt(
  input: PromptRunInput,
  options: LoopPromptOptions = {}
): Promise<void> {
  const ownership: {
    taskId: string | null;
    target: PromptRunTarget | null;
    release: (() => void) | null;
  } = {
    taskId: null,
    target: null,
    release: null,
  };
  try {
    await runLoopPromptOrchestration(input, options, (taskId, target) => {
      ownership.taskId = taskId;
      ownership.target = target;
      ownership.release = loopOrchestrationOwnership.acquire(taskId);
      options.onTaskStarted?.();
    });
  } catch (error) {
    if (options.configLockRecovery && !ownership.taskId) throw error;
    const failureMessage = errorToMessage(error);
    void logError("loop-orchestration-unhandled-error", {
      taskId: ownership.taskId,
      tabId: ownership.target?.tabId ?? null,
      error: failureMessage,
    });
    if (ownership.taskId && ownership.target && readLoopTaskRecord(ownership.taskId)?.status === "running") {
      markLoopTaskInterrupted(ownership.taskId, "error", ownership.target, {
        source: "main",
        failureMessage,
      });
    }
  } finally {
    ownership.release?.();
    if (ownership.taskId && loopOrchestrationOwnership.getCount(ownership.taskId) === 0) {
      const task = readLoopTaskRecord(ownership.taskId);
      if (task?.schedulingMode === "event_driven" && task.cli === "codex" && task.status === "needs-review"
        && !task.department && !task.departmentInvalid && isLoopTaskBlockedByMainAiFailureLimit(task)
        && isLoopMainStartupConfigLockTimeout(task)) refreshOpenLoopGroupChatPanelForTask(task.id);
    }
    await postPanelState();
  }
}

async function waitForLoopTaskClarification(task: LoopTaskRecord, target: PromptRunTarget): Promise<boolean> {
  const request = task.pendingClarification;
  if (!request) {
    return true;
  }
  void openLoopGroupChatPanel(task.id, { focus: true });
  const submission = await waitForOrchestratorClarificationWithAttention(loopClarificationScope(task.id), request, {
    timeoutMs: readHumanInteractionTimeoutMs(),
    recordHistory: recordOrchestratorInteractionResponse,
  });
  const latest = readLoopTaskRecord(task.id) ?? task;
  if (latest.status === "stopped" || latest.status === "error") {
    return false;
  }
  if (submission.status !== "completed") {
    const paused = updateLoopTaskRecord(task.id, {
      status: "needs-review",
      pendingClarification: undefined,
      activeSubtaskId: null,
      activeSubtaskIds: [],
      finalSummary: "用户拒绝了主任务澄清，任务已暂停。",
      updatedAt: Date.now(),
    }) ?? latest;
    appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(paused));
    refreshOpenLoopGroupChatPanelForTask(task.id);
    return false;
  }
  const answer = formatOrchestratorClarificationAnswer(submission, request.formFields);
  const nextRequirements = appendLoopSupplementalRequirement(latest.supplementalRequirements, answer);
  updateLoopTaskRecord(task.id, {
    supplementalRequirements: nextRequirements,
    pendingClarification: undefined,
    updatedAt: Date.now(),
  });
  appendLoopSupplementalRequirementToCommunication(latest, answer);
  appendTextFileEnsuringDir(
    buildLoopMainSubChatTranscriptFile(latest.communicationDir),
    `\n## 用户补充澄清\n${answer}\n`,
  );
  refreshOpenLoopGroupChatPanelForTask(task.id);
  return true;
}

async function runLoopPromptOrchestration(
  input: PromptRunInput,
  options: LoopPromptOptions = {},
  onTaskOwnershipAcquired?: (taskId: string, target: PromptRunTarget) => void | Promise<void>,
): Promise<void> {
  const target = resolvePromptRunTarget(options.targetTabId ?? getActiveConversationTabId());
  if (!target || !input.displayPrompt.trim()) {
    if (options.configLockRecovery) throw new Error(options.configLockRecovery.unavailableMessage);
    return;
  }
  if (target.cli === "opencode") input = await hydrateOpenCodePromptRoleModels(input, target.cli);
  if (await runEventDrivenLoopPrompt(input, options, target, onTaskOwnershipAcquired)) {
    return;
  }
  if (options.configLockRecovery) throw new Error(options.configLockRecovery.unavailableMessage);

  const resumeTaskId = typeof options.resumeTaskId === "string" && options.resumeTaskId.trim()
    ? options.resumeTaskId.trim()
    : null;
  const resumeRequested = options.resumeRequested === true;
  const preserveLoopOrigin = options.preserveLoopOrigin === true;

  let task: LoopTaskRecord | null = null;
  let round = 1;

  if (resumeTaskId) {
    let existingTask = readLoopTaskRecord(resumeTaskId);
    if (existingTask && isLoopTaskBlockedByMainAiFailureLimit(existingTask)) {
      appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(existingTask));
      return;
    }
    const targetSessionId = resolveLoopTaskSessionId(target);
    if (
      existingTask
      && resumeRequested
      && !preserveLoopOrigin
      && existingTask.workspaceKey === activeWorkspaceKey
      && (existingTask.cli !== target.cli || existingTask.sessionId !== targetSessionId)
    ) {
      existingTask = bindLoopTaskToRuntimeTarget(
        existingTask.id,
        target.cli,
        targetSessionId,
      ) ?? existingTask;
    }
    const shouldResumeCompletedWithoutCompletionMessages = Boolean(
      existingTask
      && existingTask.status === "completed"
      && !hasCompleteLoopCompletionMessagesForTask(target, existingTask.id)
    );
    if (
      existingTask
      && isLoopTaskCompatibleWithTarget(existingTask, target, { allowMissingTaskSessionId: true })
      && (!isLoopTaskCompleted(existingTask) || shouldResumeCompletedWithoutCompletionMessages)
    ) {
      const resumeConfigId = getActiveConfigIdForCli(target.cli);
      task = updateLoopTaskRecord(existingTask.id, {
        status: "running",
        runtimeInterrupted: undefined,
        userStopSource: undefined,
        activeSubtaskId: null,
        activeSubtaskIds: [],
        ...(resumeRequested && !preserveLoopOrigin ? {
          modelRouting: loopModelRoutingFromPromptInput(input, { mainCli: target.cli }) ?? undefined,
          ...(resumeConfigId ? { originProfile: applyLoopPromptThinkingToOriginProfile({ ...existingTask.originProfile, configId: resumeConfigId }, input) } : {}),
        } : {}),
        updatedAt: Date.now(),
      }, { allowCompletedToRunning: shouldResumeCompletedWithoutCompletionMessages }) ?? existingTask;
      round = resolveLoopResumeRound(task);
      appendSystemMessageForLoop(target, buildLoopTaskResumedText(task, round), (
        {
          taskRole: "main",
          loopTaskId: task.id,
          loopRound: round,
          merge: false,
          actions: [buildLoopGroupChatMessageAction(task.id, round)],
        }
      ));
      void logInfo("loop-task-resumed", {
        taskId: task.id,
        round,
        tabId: target.tabId,
        cli: target.cli,
        completedWithoutCompletionMessages: shouldResumeCompletedWithoutCompletionMessages,
      });
      if (!input.loopContinuePrompt) {
        input = {
          ...input,
          loopContinuePrompt: normalizeLoopContinuePrompt(input.displayPrompt || input.modelPrompt),
        };
      }
    }
  }

  if (!task && resumeRequested && preserveLoopOrigin) {
    appendSystemMessageForLoop(target, t("loopGroupChatChat.originalRuntimeUnavailable"));
    void logInfo("loop-task-resume-not-found", { tabId: target.tabId, cli: target.cli, preserveLoopOrigin });
    return;
  }

  const loopTaskEntry = await resolveLoopTaskAtCreationBoundary<LoopTaskRecord>({
    candidateId: task?.id ?? null,
    prepareRunner: async () => {
      if (!await configApplyQueue.waitForIdle(target.cli)) {
        throw new Error("配置应用失败，循环任务未启动。");
      }
    },
    readTask: (taskId) => readLoopTaskRecord(taskId),
    isReusableContinuation: (candidate) => (
      isLoopTaskCompatibleWithTarget(candidate, target, { allowMissingTaskSessionId: true })
      && !isLoopTaskBlockedByMainAiFailureLimit(candidate)
      && (!isLoopTaskCompleted(candidate)
        || (candidate.status === "completed" && !hasCompleteLoopCompletionMessagesForTask(target, candidate.id)))
    ),
    allowFallbackCreation: !preserveLoopOrigin,
    assertNewTaskAvailable: () => assertModeAvailable(
      options.schedulingMode === "event_driven" ? "loop_plus" : "loop",
      readToolSettings(),
    ),
    beforeFallbackCreation: () => {
      if (resumeRequested) {
        appendSystemMessageForLoop(target, t("run.loopResumeUnavailableStartNew"));
        void logInfo("loop-task-resume-not-found", { tabId: target.tabId, cli: target.cli, preserveLoopOrigin });
      }
    },
    createTask: () => {
      const initialSessionId = resolveLoopTaskSessionId(target);
      let createdTask = createLoopTaskRecord(target.cli, input.displayPrompt, { sessionId: initialSessionId });
      const modelRouting = loopModelRoutingFromPromptInput(input, { mainCli: target.cli });
      const originProfile = captureLoopOriginProfile({
        cli: target.cli,
        configId: getActiveConfigIdForCli(target.cli),
        mainModel: modelRouting?.main.model,
        subtaskModel: modelRouting?.subtask.model,
        subtaskCli: modelRouting?.subtask.cli ?? input.loopSubtaskCli,
        subtaskConfigId: modelRouting?.subtask.configId ?? input.loopSubtaskConfigId,
        frontendModel: modelRouting?.subtaskFrontend?.model ?? input.loopSubtaskFrontendModel,
        frontendCli: modelRouting?.subtaskFrontend?.cli ?? input.loopSubtaskFrontendCli,
        frontendConfigId: modelRouting?.subtaskFrontend?.configId ?? input.loopSubtaskFrontendConfigId,
        mainThinkingMode: input.loopMainThinkingMode,
        subtaskThinkingMode: input.loopSubtaskThinkingMode,
        subtaskFrontendThinkingMode: input.loopSubtaskFrontendThinkingMode,
      });
      if (modelRouting || originProfile) {
        createdTask = updateLoopTaskRecord(createdTask.id, {
          ...(modelRouting ? { modelRouting } : {}),
          ...(originProfile ? { originProfile } : {}),
          updatedAt: Date.now(),
        }) ?? {
          ...createdTask,
          ...(modelRouting ? { modelRouting } : {}),
          ...(originProfile ? { originProfile } : {}),
        };
      }
      ensureLoopMainSubChatTranscript(createdTask);
      appendSystemMessageForLoop(target, buildLoopTaskStartedText(createdTask), (
        {
          taskRole: "main",
          loopTaskId: createdTask.id,
          merge: false,
          actions: [buildLoopGroupChatMessageAction(createdTask.id)],
        }
      ));
      return createdTask;
    },
  });
  task = loopTaskEntry.task;
  if (!task) {
    appendSystemMessageForLoop(target, t("loopGroupChatChat.originalRuntimeUnavailable"));
    return;
  }
  if (!loopTaskEntry.created) {
    round = resolveLoopResumeRound(task);
  }

  if (!task) {
    return;
  }
  onTaskOwnershipAcquired?.(task.id, target);
  await postPanelState();
  void openLoopGroupChatPanel(task.id);

  const orchestration = requireLoopOrchestrationHost();
  const observation = orchestration.observeClassicLoop(task.id);
  const settledBatches: Array<Awaited<ReturnType<typeof runLoopSubtasksBatchWithRetry>>> = [];
  const taskId = task.id;
  try {
  while (true) {
    const latest: LoopTaskRecord = readLoopTaskRecord(task.id) ?? task;
    task = latest;
    if (isLoopTaskBlockedByMainAiFailureLimit(latest)) {
      appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(latest));
      return;
    }
    if (latest.status === "needs-review" || latest.status === "error" || latest.status === "stopped") {
      return;
    }
    for (const subtaskResults of settledBatches.splice(0)) {
      const interrupted = subtaskResults.find((result) => (result.status === "error" || result.status === "stopped")
        && !result.watchdogRecovered && latest.subTasks.find((item) => item.id === result.subtask.id)?.status !== "skipped");
      if (interrupted) {
        appendSystemMessageForLoop(target, interrupted.status === "stopped"
          ? t("run.loopSubtaskStoppedAwaitingCompletion", { title: interrupted.subtask.title })
          : t("run.loopSubtaskFailedAwaitingCompletion", { title: interrupted.subtask.title }));
        return;
      }
      const finished = subtaskResults.filter((result) => result.status === "end").map((result) => result.subtask);
      if (finished.length) appendSystemMessageForLoop(target, buildLoopMainResumeText(taskId, round, finished));
    }
    if (latest.pendingClarification) {
      const continued = await waitForLoopTaskClarification(latest, target);
      if (!continued) {
        return;
      }
      continue;
    }
    if (isLoopTaskCompleted(latest)) {
      if (hasCompleteLoopCompletionMessagesForTask(target, latest.id)) {
        return;
      }
      const resumed = updateLoopTaskRecord(latest.id, {
        status: "running",
        activeSubtaskId: null,
        activeSubtaskIds: [],
        updatedAt: Date.now(),
      }, { allowCompletedToRunning: true }) ?? latest;
      task = resumed;
      round = resolveLoopResumeRound(resumed);
      appendSystemMessageForLoop(target, buildLoopTaskResumedText(resumed, round), (
        {
          taskRole: "main",
          loopTaskId: resumed.id,
          loopRound: round,
          merge: false,
          actions: [buildLoopGroupChatMessageAction(resumed.id, round)],
        }
      ));
      void logInfo("loop-task-completed-without-final-summary-resumed", {
        taskId: resumed.id,
        round,
        tabId: target.tabId,
        cli: target.cli,
      });
      continue;
    }

    const revision = observation.revision();
    let decisionRunResult: Awaited<ReturnType<LoopOrchestrationHost["runClassicLoopMainDecision"]>>;
    try {
      decisionRunResult = await runClassicLoopMainDecision({
            input,
            target,
            task: latest,
            round,
          });
    } catch (error) {
      void logError("loop-main-decision-run-error", {
        taskId: latest.id,
        round,
        error: errorToMessage(error),
      });
      markLoopTaskInterrupted(latest.id, "error", target, {
        source: "main",
        failureMessage: errorToMessage(error),
      });
      return;
    }

    if (decisionRunResult.status === "interrupted") {
      markLoopTaskInterrupted(decisionRunResult.task.id, decisionRunResult.runStatus, target, {
        source: "main",
      });
      return;
    }
    if (decisionRunResult.status === "completed") {
      removeLoopMainDecisionMessage(target, decisionRunResult.task.id, round);
      appendSystemMessageForLoop(target, buildLoopTaskCompletedText(decisionRunResult.task));
      appendLoopAnswerConclusionMessage(target, decisionRunResult.task, decisionRunResult.decision);
      appendLoopFinalSummaryMessage(target, decisionRunResult.task, decisionRunResult.decision);
      notifyLoopTaskCompletion(humanInteractionAttention, decisionRunResult.task);
      return;
    }
    if (decisionRunResult.status === "needs-review") {
      if (decisionRunResult.decision?.status === "blocked") {
        removeLoopMainDecisionMessage(target, decisionRunResult.task.id, round);
      }
      appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(decisionRunResult.task));
      return;
    }
    if (decisionRunResult.status === "pending-requirements") {
      removeLoopMainDecisionMessage(target, decisionRunResult.task.id, round);
      continue;
    }
    if (decisionRunResult.status === "awaiting-input") {
      removeLoopMainDecisionMessage(target, decisionRunResult.task.id, round);
      continue;
    }
    if (decisionRunResult.status === "waiting") {
      removeLoopMainDecisionMessage(target, taskId, round);
      round += 1;
      await observation.wait(revision);
      continue;
    }

    const subtasks = decisionRunResult.subtasks;
    showLoopSubtaskDecisionMarkdown(target, decisionRunResult.task, round, subtasks, decisionRunResult.decision);
    void runLoopSubtasksBatchWithRetry({
      input,
      target,
      task: decisionRunResult.task,
      round,
      subtasks,
    }).then((results) => {
      settledBatches.push(results);
    }, (error) => {
      void logError("loop-subtask-batch-error", { taskId, error: errorToMessage(error) });
      settledBatches.push(subtasks.map((subtask) => ({ subtask, status: "error" })));
    }).finally(() => {
      orchestration.wakeClassicLoop(taskId);
    });
    round += 1;
    await observation.wait(revision);
  }
  } finally {
    observation.dispose();
  }

}

function requireLoopOrchestrationHost(): LoopOrchestrationHost {
  if (!loopOrchestrationHost) {
    throw new Error("loop-orchestration-host-not-initialized");
  }
  return loopOrchestrationHost;
}

function appendLoopMainSubChatMainDecision(...args: Parameters<LoopOrchestrationHost["appendLoopMainSubChatMainDecision"]>): ReturnType<LoopOrchestrationHost["appendLoopMainSubChatMainDecision"]> {
  return requireLoopOrchestrationHost().appendLoopMainSubChatMainDecision(...args);
}

function appendLoopMainSubChatSubtaskFinished(...args: Parameters<LoopOrchestrationHost["appendLoopMainSubChatSubtaskFinished"]>): ReturnType<LoopOrchestrationHost["appendLoopMainSubChatSubtaskFinished"]> {
  return requireLoopOrchestrationHost().appendLoopMainSubChatSubtaskFinished(...args);
}

function appendLoopSupplementalRequirement(...args: Parameters<LoopOrchestrationHost["appendLoopSupplementalRequirement"]>): ReturnType<LoopOrchestrationHost["appendLoopSupplementalRequirement"]> {
  return requireLoopOrchestrationHost().appendLoopSupplementalRequirement(...args);
}

function appendLoopSupplementalRequirementToCommunication(...args: Parameters<LoopOrchestrationHost["appendLoopSupplementalRequirementToCommunication"]>): ReturnType<LoopOrchestrationHost["appendLoopSupplementalRequirementToCommunication"]> {
  return requireLoopOrchestrationHost().appendLoopSupplementalRequirementToCommunication(...args);
}

function appendTextFileEnsuringDir(...args: Parameters<LoopOrchestrationHost["appendTextFileEnsuringDir"]>): ReturnType<LoopOrchestrationHost["appendTextFileEnsuringDir"]> {
  return requireLoopOrchestrationHost().appendTextFileEnsuringDir(...args);
}

function readTextFileIfNonEmpty(...args: Parameters<LoopOrchestrationHost["readTextFileIfNonEmpty"]>): ReturnType<LoopOrchestrationHost["readTextFileIfNonEmpty"]> {
  return requireLoopOrchestrationHost().readTextFileIfNonEmpty(...args);
}

function runClassicLoopMainDecision(...args: Parameters<LoopOrchestrationHost["runClassicLoopMainDecision"]>): ReturnType<LoopOrchestrationHost["runClassicLoopMainDecision"]> {
  return createPerformanceTrace("loop", args[0].target.cli, "main").measure("main-decision",
    () => requireLoopOrchestrationHost().runClassicLoopMainDecision(...args),
    (result) => result.status === "interrupted" ? (result.runStatus === "stopped" ? "stopped" : "failed") : "returned");
}

function runLoopSubtasksBatchWithRetry(...args: Parameters<LoopOrchestrationHost["runLoopSubtasksBatchWithRetry"]>): ReturnType<LoopOrchestrationHost["runLoopSubtasksBatchWithRetry"]> {
  return createPerformanceTrace("loop", args[0].target.cli, "subtask").measure("subtask-batch",
    () => requireLoopOrchestrationHost().runLoopSubtasksBatchWithRetry(...args));
}

function writeTextFileEnsuringDir(...args: Parameters<LoopOrchestrationHost["writeTextFileEnsuringDir"]>): ReturnType<LoopOrchestrationHost["writeTextFileEnsuringDir"]> {
  return requireLoopOrchestrationHost().writeTextFileEnsuringDir(...args);
}

// Loop prompt run runtime helpers moved to extensionHost/promptRunRuntime.ts.

function resolvePreloadedExecutionModel(input: PromptRunInput, cli: CliName): string | null {
  const loopSubtaskCli = input.taskRole === "subtask" ? parseCliName(input.loopSubtaskCli) : undefined;
  const lookupCli = loopSubtaskCli ?? cli;
  const explicitConfigId = input.taskRole === "subtask" && typeof input.loopSubtaskConfigId === "string"
    ? input.loopSubtaskConfigId.trim()
    : "";
  const configId = explicitConfigId || getActiveConfigIdForCli(lookupCli);
  const recorded = resolveRecordedExecutionModel(input, getSelectedCliModel(lookupCli, configId));
  if (!recorded) {
    return null;
  }
  const displayName = modelSettingsHost.getModelDisplayName(lookupCli, recorded);
  return typeof displayName === "string" && displayName.trim() ? displayName.trim() : recorded;
}

function preloadUserMessageForPrompt(input: PromptRunInput, target: PromptRunTarget, options: { captureTaskSummary?: boolean; messageId?: string } = {}): PromptRunInput {
  if (input.preloadedUserMessageId) {
    return input;
  }
  const tab = getConversationTabById(target.tabId);
  if (options.captureTaskSummary !== false) {
    rememberConversationTaskSummarySubmission(input, target, true);
  }
  const firstExecutionModel = resolveRecordedExecutionModel(input, getSelectedCliModel(target.cli));
  const firstExecutionDisplayModel = resolvePreloadedExecutionModel(input, target.cli);
  const newlyLocked = markConversationTabExecutionLocked(target.tabId, firstExecutionModel);
  if (newlyLocked) {
    void postPanelState();
  }
  const executionModel = newlyLocked
    ? firstExecutionDisplayModel
    : firstExecutionDisplayModel;
  const createdAt = Date.now();
  const messageId = options.messageId ?? createMessageId();
  const message = buildUserChatMessage({
    ...input,
    executionModel,
    executionProfile: buildConversationExecutionProfile(
      input.taskRole === "subtask" ? input.loopSubtaskConfigId ?? getActiveConfigIdForCli(target.cli) : getActiveConfigIdForCli(target.cli),
      firstExecutionModel,
      input.thinkingModeOverride ?? getEffectiveThinkingMode(target.cli, input.model ?? getSelectedCliModel(target.cli)),
    ),
  }, createdAt, messageId);
  if (tab) completedLoopSubtaskTabs.forgetRestoredTab(tab);
  const messageTarget = target.sessionId
    ? loadSessionMessages(target.cli, target.sessionId)
    : getPendingSessionDraft(target.tabId, target.cli).messages;
  appendMessageToStore(messageTarget, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  if (!target.sessionId) {
    updatePendingSessionDraft(target.tabId, { messages: messageTarget }, target.cli);
  }
  return {
    ...input,
    preloadedUserMessageId: messageId,
  };
}

function rememberConversationTaskSummarySubmission(input: PromptRunInput, target: PromptRunTarget, newSubmission = false) {
  if (input.taskRole === "subtask") return undefined;
  const tab = getConversationTabById(target.tabId);
  if (!tab) return undefined;
  const draft = getPendingSessionDraft(target.tabId, target.cli);
  return pendingConversationTaskSummarySubmissions.remember(tab, activeWorkspaceKey, draft, () => {
    const task = input.loopTaskId ? readLoopTaskRecord(input.loopTaskId) : null;
    const requirement = newSubmission ? input.displayPrompt : task?.rootPrompt ?? input.displayPrompt;
    if (!requirement?.trim()) return undefined;
    const configId = getActiveConfigIdForCli(target.cli);
    const model = input.model ?? getSelectedCliModel(target.cli, configId);
    return {
      workspace: activeWorkspaceKey, draft, requirement, model,
      thinkingMode: input.thinkingModeOverride ?? getEffectiveThinkingMode(target.cli, model),
      command: getCliCommand(target.cli),
      args: [...getCliArgs(target.cli)],
      openCodeVariant: target.cli === "opencode" ? normalizeOpenCodeThinkingEffort(
        input.executionProfile?.openCodeVariant ?? input.thinkingModeOverride
          ?? input.loopMainThinkingMode
          ?? getOpenCodeRoleVariantFromStore(modelStore, configId, model, "main"),
      ) : null,
    };
  }, newSubmission);
}

function appendSystemMessageForPromptTarget(target: PromptRunTarget, content: string): void {
  if (!content.trim()) {
    return;
  }
  const messageTarget = target.sessionId
    ? loadSessionMessages(target.cli, target.sessionId)
    : getPendingSessionDraft(target.tabId, target.cli).messages;
  const message: ChatMessage = {
    id: createMessageId(),
    role: "system",
    content,
    createdAt: Date.now(),
  };
  appendMessageToStore(messageTarget, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistMessagesForTab(target.cli, target.sessionId, target.tabId, messageTarget);
}

async function getOpenCodeConfigPreflightMessage(): Promise<string | null> {
  try {
    await prepareOpenCodeRuntime();
    return null;
  } catch (error) {
    return errorToMessage(error);
  }
}

function maybePersistLongTermMemoryFromRun(options: {
  status: TaskRunStatus;
  cli: CliName;
  prompt: string;
  messages: readonly ChatMessage[];
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  skip?: boolean;
}): void {
  if (options.skip) {
    return;
  }
  const runtimeSettings = buildLongTermMemoryRuntimeSettings();
  if (!isMemoryRuntimeOperationAllowed("update", runtimeSettings)) {
    return;
  }
  const paths = getActiveWorkspaceMemoryPaths();
  if (!paths) {
    return;
  }
  const assistantResponse = getLatestAssistantResponseForLongTermMemory(options.messages);
  if (!assistantResponse) {
    return;
  }
  try {
    const result = persistPromptRunSummary(paths, {
      prompt: options.prompt,
      assistantResponse,
      cli: options.cli,
      status: options.status,
      taskRole: options.taskRole,
      loopTaskId: options.loopTaskId,
      loopRound: options.loopRound,
      loopSubtaskId: options.loopSubtaskId,
    });
    if (!result.skipped) {
      void logInfo("long-term-memory-persisted", {
        workspace: paths.workspaceRoot,
        cli: options.cli,
        updatedFiles: result.updatedFiles,
      });
    }
  } catch (error) {
    void logError("long-term-memory-persist-error", {
      error: String(error),
      workspace: paths.workspaceRoot,
      cli: options.cli,
    });
  }
}


function preemptActivePromptRun(tabId: string): void {
  if (resolveLoopPlusParentStopContext(tabId)?.schedulingMode === "event_driven") {
    cancelLoopPlusInvocation(tabId);
    return;
  }
  if (stopLoopPlusInvocationRunner(tabId)) {
    return;
  }
  stopRunForTab(tabId, null);
}

async function takeOverSessionForTab(target: PromptRunTarget, isAborted?: () => boolean): Promise<boolean> {
  return takeOverSessionTab(target, {
    getWorkspaceKey: () => activeWorkspaceKey,
    getTabs: () => ensureConversationTabs().tabs,
    getActiveRuns: () => {
      const runs: PromptRunTarget[] = [...interactiveRunsByTabId.values(), ...parallelRunsByTabId.values()];
      const primaryTabId = getPrimaryRunTabId();
      if (primaryTabId && primaryPromptRunController.activeCliForRun) {
        runs.push({ tabId: primaryTabId, cli: primaryPromptRunController.activeCliForRun,
          sessionId: primaryPromptRunController.activeSessionId });
      }
      return runs;
    },
    stopTab: (tabId) => stopRunForTab(tabId, null),
    isTabRunActive,
    closeTab: closeConversationTabAndRefreshPanel,
  }, () => isExtensionDeactivating || isAborted?.() === true);
}

async function closeLoopSubtaskTabs(taskId: string, subtaskId: string, tabId?: string, attemptId?: string): Promise<void> {
  await closeLoopSubtaskConversationTabs({ taskId, subtaskId, tabId, attemptId }, {
    getTabs: () => ensureConversationTabs().tabs,
    resolveContext: (tab) => resolveLoopSubtaskConversationContext(tab.cli, tab.id),
    isTabRunActive,
    closeTab: closeConversationTabAndRefreshPanel,
  });
}

const completedLoopSubtaskTabs = createCompletedLoopSubtaskTabCleanup({
  getWorkspaceKey: () => activeWorkspaceKey,
  getTabs: () => ensureConversationTabs().tabs,
  isTabRunActive: (tabId) => isTabRunActive(tabId) || promptRunHandoff.isBusy(tabId),
  restoredEvidence: {
    readMessages: (cli, sessionId, workspace) => workspace === activeWorkspaceKey
      ? loadSessionMessages(cli, sessionId)
      : [],
    readRuns: () => readTaskStore().runs,
    readRunsRevision: () => {
      const { dev, ino, size, mtimeNs, ctimeNs } = fs.statSync(TASK_STORE_FILE, { bigint: true });
      return `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`;
    },
    readTask: (taskId) => readLoopTaskRecord(taskId),
  },
  closeTab: async (tab) => {
    const bindings = getInteractiveSessionBindingsForTab(tab);
    const workspace = activeWorkspaceKey;
    try {
      await sessionTabsHost.closeCompletedSubtaskTabAndRefreshPanel(tab);
    } finally {
      if (workspace === activeWorkspaceKey && getConversationTabById(tab.id) !== tab) {
        releaseClosedSubtaskTabBindings(bindings);
      }
    }
  },
});

function releaseClosedSubtaskTabBindings(bindings: InteractiveSessionBinding[]): void {
  for (const binding of bindings) {
    void loopSubtaskAutoCompactions.wait(binding.cli, binding.sessionId ?? null)
      .then(() => disposeInteractiveRunnerIfUnused(binding)).catch(() => undefined);
  }
}

function prepareLoopSubtaskTabClose(tabId: string, options?: LoopSubtaskTabCloseOptions): () => Promise<void> {
  const replaceLastTab = options?.completed === true;
  if (replaceLastTab && options.expected) return completedLoopSubtaskTabs.prepareClose(tabId, options.expected);
  const workspaceKey = activeWorkspaceKey;
  const tab = getConversationTabById(tabId);
  if (!tab && !replaceLastTab) return async () => {};
  if (!tab) return async () => { throw new Error("未找到捕获的子任务标签，未执行自动关闭。"); };
  const cli = tab.cli;
  const sessionId = getConversationTabSessionIdForCli(tab, cli);
  const context = resolveLoopSubtaskConversationContext(cli, tabId);
  const bindings = getInteractiveSessionBindingsForTab(tab);
  if (replaceLastTab && !context) {
    return async () => { throw new Error("子任务标签身份无法核验，未执行自动关闭。"); };
  }
  const close = context ? prepareLoopSubtaskConversationTabClose({ ...context, tabId }, {
    getTabs: () => ensureConversationTabs().tabs,
    resolveContext: (candidate) => resolveLoopSubtaskConversationContext(candidate.cli, candidate.id),
    isTabRunActive,
    closeTab: (candidateTabId) => replaceLastTab
      ? sessionTabsHost.closeCompletedSubtaskTabAndRefreshPanel(getConversationTabById(candidateTabId)!)
      : closeConversationTabAndRefreshPanel(candidateTabId),
    }) : () => closeConversationTabAndRefreshPanel(tabId);
  return async () => {
    if (workspaceKey !== activeWorkspaceKey) throw new Error("工作区已切换，忽略原子任务标签清理。");
    const current = getConversationTabById(tabId);
    if (current && (current !== tab || current.cli !== cli || getConversationTabSessionIdForCli(current, cli) !== sessionId)) {
      throw new Error("子任务标签已被替代或换绑，保留新任务标签。");
    }
    if (replaceLastTab) {
      const currentContext = current ? resolveLoopSubtaskConversationContext(current.cli, current.id) : null;
      if (!currentContext || currentContext.taskId !== context?.taskId || currentContext.subtaskId !== context?.subtaskId
        || currentContext.round !== context.round) {
        throw new Error("子任务或 attempt 身份已变化，保留当前标签。");
      }
    }
    await close();
    if (getConversationTabById(tabId) === tab) throw new Error("子任务标签仍存在，尚未自动关闭。");
    releaseClosedSubtaskTabBindings(bindings);
  };
}

async function closeLoopSubtaskTabAndRefreshPanel(tabId: string): Promise<void> {
  await prepareLoopSubtaskTabClose(tabId)();
}

/** The scheduler's trusted main path reuses the existing interactive consumers
 * and run records, while its transport is the independent multi-turn Owner. */
async function runDepartmentLeaderPrompt(input: PromptRunInput, options: {
  targetTabId: string; invocationId: string; isAborted: () => boolean; signal?: AbortSignal; onStarted?: () => void;
  registerQuestionRun?: RunPromptOptions["registerQuestionRun"];
}): Promise<void> {
  const taskId = input.loopTaskId;
  if (!taskId || input.taskRole !== "main") throw new Error("部门组长调用身份缺失。");
  const originalTask = readLoopTaskRecord(taskId);
  if (input.loopAsk && (originalTask?.status !== "running" || originalTask.departmentInvalid
    || originalTask.department?.role !== "leader" || !originalTask.executionSession || originalTask.executionSessionInvalid)) {
    throw new Error("组长当前没有可提问的原生会话，请在组长运行后重试。");
  }
  if (usesDepartmentInteractiveRuntime(originalTask?.cli)) {
    return getDepartmentExecutionProducer().track(taskId, () => runDepartmentInteractivePrompt(input, options));
  }
  const isAborted = () => isExtensionDeactivating || options.isAborted() || options.signal?.aborted === true;
  if (isAborted()) return;
  const leaderCli = originalTask?.department?.routes.leader.cli;
  if ((leaderCli !== "codex" && leaderCli !== "opencode") || originalTask?.cli !== leaderCli
    || originalTask.departmentInvalid || originalTask.department?.role !== "leader") throw new Error("部门组长执行 CLI 或归属无效。");
  const tabId = options.targetTabId;
  const tab = getConversationTabById(tabId);
  const originalTarget = resolvePromptRunTarget(tabId);
  const workspace = activeWorkspaceKey;
  if (!tab || !originalTarget?.sessionId || originalTarget.cli !== leaderCli
    || originalTarget.sessionId !== originalTask.sessionId || originalTask.workspaceKey !== workspace) {
    throw new Error("部门组长执行 Tab 或会话无效。");
  }
  const producer = getDepartmentExecutionProducer();
  const scopeKey = leaderExecutionScopeKey(producer.scope(taskId));
  const department = JSON.stringify(originalTask.department);
  const assertCurrent = () => {
    if (isAborted()) throw new Error("部门组长准备已取消。");
    const task = readLoopTaskRecord(taskId);
    const target = task && resolveLoopMainPromptTarget(task, { createIfMissing: false });
    const current = resolvePromptRunTarget(tabId);
    if (workspace !== activeWorkspaceKey || getConversationTabById(tabId) !== tab
      || task?.id !== taskId || task.workspaceKey !== workspace || task.taskStoreFile !== originalTask.taskStoreFile
      || task.status !== "running" || task.cli !== leaderCli || task.sessionId !== originalTarget.sessionId
      || task.departmentInvalid || JSON.stringify(task.department) !== department
      || current?.cli !== leaderCli || current.sessionId !== originalTarget.sessionId
      || target?.tabId !== tabId || target.cli !== leaderCli || target.sessionId !== originalTarget.sessionId
      || leaderExecutionScopeKey(producer.scope(taskId)) !== scopeKey) {
      throw new Error("部门组长执行归属或会话已变化，任务未启动。");
    }
  };
  const execute = () => producer.track(taskId, async () => {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const assert = () => {
      if (abort.signal.aborted) throw new Error("部门组长准备已取消。");
      assertCurrent();
    };
    try {
      assert();
      if (!await configApplyQueue.waitForIdle(leaderCli)) throw new Error("配置应用失败，组长任务未启动。");
      assert();
      const fixed = await prepareDepartmentInvocation(input, options.targetTabId); assert();
      const target = resolvePromptRunTarget(options.targetTabId);
      const expected = { configId: fixed.executionProfile?.configId ?? null, revision: "department-role" };
      const mode = fixed.thinkingModeOverride;
      if (!target || target.cli !== leaderCli || !mode) throw new Error("部门组长原生执行配置未支持，任务未启动。");
      if (leaderCli === "opencode") {
        if (normalizeThinkingWorkspaceFiles(getThinkingWorkspaceFiles("opencode", mode)).length > 0) {
          throw new Error("部门 OpenCode 组长暂不支持自定义思考工作区文件，任务未启动。");
        }
        const workspaceDirectory = resolveWorkspaceCwd();
        if (!workspaceDirectory) throw new Error("部门组长缺少执行工作区。");
        const targetConfig = DEPARTMENT_CONFIG_PATHS.opencode.config;
        let invoked = false;
        const tabConsumer = getDepartmentExecutionResources().beginConsumer(target.tabId);
        let consumed = false;
        options.onStarted?.();
        try {
          // Each leader owns its tab-scoped consumer; primary state is shared.
          await runPromptParallel(fixed, target, {
            isAborted: options.isAborted, cwd: workspaceDirectory, isolateProjectInstructions: true,
            registerQuestionRun: options.registerQuestionRun,
            departmentLeaderNativeSession: createDepartmentLeaderNativeSessionValidator({
              localSessionId: target.sessionId, configId: expected.configId,
              readExecutionSession: () => readLoopTaskRecord(taskId)?.executionSession,
            }),
            departmentProcessStream: (cli, prompt, handlers, streamOptions = {}) => {
              const currentRoute = readLoopTaskRecord(taskId)?.department?.routes.leader;
              if (invoked || cli !== "opencode" || streamOptions.commandOverride || streamOptions.argsOverride
                || streamOptions.openCodeServerUrl || !currentRoute || streamOptions.model !== currentRoute.model
                || (streamOptions.openCodeVariant ?? null) !== (currentRoute.openCodeVariant ?? null)
                || !streamOptions.openCodeConfigContent) throw new Error("部门组长 OpenCode 执行不能重试或替换 Owner。");
              invoked = true; assert();
              const command = splitConfiguredCliCommand(getCliCommand("opencode"));
              // The multi-round builder owns the run/session argv. Configured
              // executable prefixes are outside this initial production scope.
              if (command.length !== 1) throw new Error("部门 OpenCode 组长暂不支持命令预置参数。");
              const args = buildDepartmentProcessArgs("opencode", { ...streamOptions, isolateProjectInstructions: true });
              return getDepartmentLeaderProductionHost().runOpenCode(taskId, options.invocationId, prompt, handlers, expected,
                path.join(path.dirname(targetConfig), ".sinitek-runtime-coordination", path.basename(targetConfig)), {
                  command: command[0] ?? "opencode", baseArgs: [...command.slice(1), ...args], cwd: workspaceDirectory,
                  baseEnvironment: streamOptions.environment ? { ...streamOptions.environment } : getDepartmentLeaderProductionHost().captureOpenCodeEnvironment(taskId),
                  envOverrides: streamOptions.envOverrides ? { ...streamOptions.envOverrides } : undefined,
                  macTaskShell: getMacTaskShell(), processLabel: streamOptions.processLabel,
                  openCodeVariant: streamOptions.openCodeVariant,
                  overlay: streamOptions.openCodeConfigContent && streamOptions.model ? {
                    configContent: streamOptions.openCodeConfigContent, primaryModel: streamOptions.model,
                    smallModel: streamOptions.openCodeSmallModel ?? null, primaryVariant: streamOptions.openCodeVariant,
                    smallVariant: streamOptions.openCodeSmallVariant,
                  } : null,
                }, abort.signal, tabConsumer.target);
            },
          });
          consumed = true;
        } finally { tabConsumer.finish(consumed); }
        return;
      }
      if (!mode || normalizeThinkingWorkspaceFiles(getThinkingWorkspaceFiles("codex", mode)).length > 0) {
        throw new Error("部门组长原生执行配置未支持，任务未启动。");
      }
      const workspaceDirectory = resolveWorkspaceCwd(), command = getCliCommand("codex"), shell = getMacTaskShell();
      const model = fixed.model ?? null, environment = { ...process.env };
      if (!workspaceDirectory) throw new Error("部门组长缺少执行工作区。");
      const args = buildDepartmentProcessArgs("codex", { thinkingMode: mode, model, isolateProjectInstructions: true });
      const targetConfig = DEPARTMENT_CONFIG_PATHS.codex.config;
      let invoked = false;
      options.onStarted?.();
      const tabConsumer = getDepartmentExecutionResources().beginConsumer(target.tabId);
      let consumed = false;
      try {
      await runPromptInteractive(fixed, target, {
        isAborted: options.isAborted, isolateProjectInstructions: true,
        registerQuestionRun: options.registerQuestionRun,
        cancelDepartmentCodexPreparation: cancel,
        departmentCodexRun: async (prompt, handlers) => {
          if (invoked) throw new Error("部门组长本次调用不能重试或重放。");
          invoked = true; assert();
          await getDepartmentLeaderProductionHost().run(taskId, options.invocationId, prompt, handlers, expected, async (selection) => {
            assert();
            if (selection.model !== model || selection.thinkingMode !== mode) throw new Error("部门组长固化选择冲突。");
            return { configurationDirectory: path.join(path.dirname(targetConfig), ".sinitek-runtime-coordination", path.basename(targetConfig)),
              workspaceDirectory, macTaskShell: shell, requestUserInputEnabled: handlers.requestUserInputEnabled === true,
              runner: { command, args, env: environment, model, thinkingMode: mode, interactiveMode: "coding", threadId: null,
                configFingerprint: fingerprintDepartmentExecutionSelection(selection).configFingerprint } };
          }, abort.signal, tabConsumer.target);
        },
      });
      consumed = true;
      } finally { tabConsumer.finish(consumed); }
    } finally { options.signal?.removeEventListener("abort", cancel); }
  });
  if (input.loopAsk) return execute();
  await loopMainQuestionQueue.runMain(tabId, execute, {
    isAborted,
    signal: options.signal,
    canRun: () => {
      if (isTabRunActive(tabId) || promptRunHandoff.isBusy(tabId)) return false;
      assertCurrent();
      return true;
    },
  });
}

async function runDepartmentInteractivePrompt(input: PromptRunInput, options: {
  targetTabId?: string | null; invocationId?: string; isAborted?: () => boolean; signal?: AbortSignal; onStarted?: () => void;
}): Promise<void> {
  let failure: unknown;
  try {
    const fixed = await prepareDepartmentInvocation(input, options.targetTabId ?? null);
    const target = resolvePromptRunTarget(options.targetTabId ?? null);
    const expected = target && { configId: fixed.executionProfile?.configId ?? null, revision: "department-role" };
    if (!fixed.loopTaskId || !target || !expected) throw new Error("部门任务执行配置或会话缺失。");
    const interactiveRuntime = getDepartmentInteractiveRuntime();
    const departmentLeaderNativeSessionId = fixed.taskRole === "main"
      ? interactiveRuntime.resolveLeaderResumeSession(fixed.loopTaskId, target.sessionId) : undefined;
    await interactiveRuntime.run({
      taskId: fixed.loopTaskId, role: fixed.taskRole === "subtask" ? "employee" : "leader",
      invocationId: options.invocationId ?? fixed.loopAttemptId ?? "", sessionId: target.sessionId,
      ...(fixed.taskRole === "subtask" && !target.sessionId ? { initializeLocalSession: () => {
        const before = resolvePromptRunTarget(target.tabId);
        if (before?.cli !== target.cli || before.sessionId !== null) return null;
        ensureLocalSession(target.cli, target.tabId, true);
        const initialized = resolvePromptRunTarget(target.tabId);
        return initialized?.cli === target.cli && initialized.sessionId && getConversationTabById(target.tabId)
          ? initialized.sessionId : null;
      } } : {}),
      subtaskId: fixed.loopSubtaskId, attemptId: fixed.loopAttemptId, expected,
      grokExecutionRootId: fixed.grokLoopExecutionRootId,
      grokExecutionCwd: fixed.grokLoopExecutionCwd,
      grokRecoveredLegacySessionId: fixed.grokLoopRecoveredLegacySessionId,
      grokLegacySessionFallbackFromSessionId: fixed.grokLoopLegacySessionFallbackFromSessionId,
      cancel: () => cancelLoopPlusInvocation(target.tabId),
      execute: (capture) => runPromptWithDepartmentAdmission(fixed, { ...options, departmentInteractiveRunner: capture,
        ...(fixed.taskRole === "main" ? { departmentLeaderSession: {
          localSessionId: target.sessionId!, nativeSessionId: departmentLeaderNativeSessionId ?? null,
        } } : {}) }),
    });
  } catch (error) { failure = error; throw error; }
  finally {
    if (input.loopTaskId && input.loopAttemptId) departmentInteractiveRuntime?.rejectUnstarted(input.loopTaskId, input.loopAttemptId, failure);
  }
}

type RunPromptOptions = { targetTabId?: string | null; isAborted?: () => boolean; signal?: AbortSignal; onStarted?: () => void;
  onLoopSubtaskSessionSettled?: (sessionId: string | null) => void;
  performanceMode?: "vibe" | "loop" | "loop_plus" | "department";
  performanceTrace?: PerformanceTrace;
  registerQuestionRun?: (runId: string) => void;
  departmentInteractiveRunner?: import("./extensionHost/promptExecutionShared").PromptRunExecutionOptions["departmentInteractiveRunner"];
  departmentLeaderSession?: import("./extensionHost/promptExecutionShared").PromptRunExecutionOptions["departmentLeaderSession"];
  firstMainExecution?: FirstLoopMainExecution };

async function runPrompt(
  input: PromptRunInput,
  options: RunPromptOptions = {},
): Promise<void> {
  const task = input.loopTaskId ? readLoopTaskRecord(input.loopTaskId) : null;
  const department = task?.department;
  const mode = options.performanceMode ?? (department || task?.departmentInvalid ? "department"
    : task?.schedulingMode === "event_driven" ? "loop_plus" : input.loopTaskId ? "loop" : "vibe");
  const role = department?.role === "leader" && input.taskRole === "subtask" ? "employee" : department?.role ?? input.taskRole;
  const tabId = options.targetTabId ?? getActiveConversationTabId();
  const tab = tabId ? getConversationTabById(tabId) : null;
  const subtask = task && task.workspaceKey === activeWorkspaceKey && usesCompletedLoopSubtaskTabCleanup(task)
    && input.taskRole === "subtask" && input.loopSubtaskId && input.loopRound
    ? { taskId: task.id, subtaskId: input.loopSubtaskId, round: input.loopRound, attemptId: input.loopAttemptId }
    : null;
  const settleBinding = tab && completedLoopSubtaskTabs.bindPrompt(tab, subtask);
  let settledSession: string | null | undefined;
  const trace = createPerformanceTrace(mode, tab?.cli, role);
  const dispatch = trace.start("runner-dispatch");
  let runnerStarted = false;
  const onStarted = options.onStarted;
  options = { ...options, performanceTrace: trace,
    onLoopSubtaskSessionSettled: settleBinding ? (sessionId) => { settledSession = sessionId; } : undefined,
    onStarted: () => { runnerStarted = true; dispatch(); onStarted?.(); } };
  const invocation = trace.measure("invocation", async () => {
    if (options.firstMainExecution && (!task || task.department || task.departmentInvalid || input.taskRole !== "main")) {
      throw new Error(t("loopGroupChatChat.originalRuntimeUnavailable"));
    }
    if (department && usesDepartmentOwner(department)) {
      if (!task) throw new Error("部门运行任务缺失。");
      if (input.taskRole !== "subtask") throw new Error("部门组长必须经真实 Loop+ 原生 Owner 调用，禁止普通执行回退。");
      return getDepartmentExecutionProducer().track(task.id, () => usesDepartmentInteractiveRuntime(department.routes.employee.cli)
        ? runDepartmentInteractivePrompt(input, options) : runPromptWithDepartmentAdmission(input, options));
    }
    return runPromptWithDepartmentAdmission(input, options);
  });
  void invocation.then(
    () => { if (!runnerStarted) dispatch("stopped"); },
    () => { if (!runnerStarted) dispatch("threw"); },
  ).catch(() => undefined);
  try {
    await invocation;
  } finally {
    if (settleBinding && settledSession !== undefined) settleBinding(settledSession);
  }
}

async function runPromptWithDepartmentAdmission(
  input: PromptRunInput,
  options: RunPromptOptions = {},
): Promise<void> {
  const tabId = options.targetTabId ?? getActiveConversationTabId();
  try {
    if (options.firstMainExecution) return await runPromptNow(input, options);
    if (input.loopTaskId) input = await prepareDepartmentInvocation(input, tabId);
    if (input.taskRole === "main" && input.loopTaskId && !input.loopAsk && tabId) {
      const taskId = input.loopTaskId;
      return loopMainQuestionQueue.runMain(tabId, () => promptRunHandoff.run(tabId, (isAborted) => runPromptNow(input, {
        ...options,
        targetTabId: tabId,
        isAborted: () => isAborted() || options.isAborted?.() === true || readLoopTaskRecord(taskId)?.status !== "running",
      })));
    }
    if (tabId) {
      await promptRunHandoff.run(tabId, (isAborted) => runPromptNow(input, {
        ...options, targetTabId: tabId, isAborted: () => isAborted() || options.isAborted?.() === true,
      }));
    } else {
      await runPromptNow(input, options);
    }
  }
  finally {
    if (input.loopTaskId && input.loopSubtaskId && input.taskRole === "subtask") {
      departmentProcessPreparation?.rejectUnstarted(input.loopTaskId, input.loopSubtaskId);
      departmentCodexPreparation?.rejectUnstarted(input.loopTaskId, input.loopSubtaskId);
    }
  }
}

async function runPromptNow(
  input: PromptRunInput,
  options: RunPromptOptions = {},
): Promise<void> {
  if (isExtensionDeactivating || options.isAborted?.()) {
    return;
  }

  const prompt = input.displayPrompt;
  if (!prompt) {
    return;
  }

  const firstMainExecution = options.firstMainExecution;
  const mainRecovery = input.loopPlusMainRuntime?.recovery;
  const requiresOriginalTarget = Boolean(firstMainExecution || mainRecovery);
  const target = firstMainExecution ? { ...firstMainExecution.target } : resolvePromptRunTarget(options.targetTabId ?? getActiveConversationTabId());
  if (!target) {
    return;
  }
  const targetTab = getConversationTabById(target.tabId);
  const executionWorkspaceKey = activeWorkspaceKey;
  let preparingSessionId = targetTab ? getConversationTabSessionIdForCli(targetTab, target.cli) : null;
  const isPreparationAborted = (): boolean => isExtensionDeactivating || options.isAborted?.() === true
    || (firstMainExecution !== undefined && !firstMainExecution.isTargetCurrent())
    || (mainRecovery !== undefined && (target.tabId !== mainRecovery.target.tabId || target.cli !== mainRecovery.target.cli
      || target.sessionId !== mainRecovery.target.sessionId))
    || activeWorkspaceKey !== executionWorkspaceKey
    || !targetTab || getConversationTabById(target.tabId) !== targetTab
    || targetTab.cli !== target.cli
    || getConversationTabSessionIdForCli(targetTab, target.cli) !== preparingSessionId;
  if ((!requiresOriginalTarget && !await takeOverSessionForTab(target, isPreparationAborted)) || isPreparationAborted()
    || (mainRecovery && isTabRunActive(target.tabId))) {
    return;
  }
  const summarySubmissionTab = getConversationTabById(target.tabId);
  const summarySubmission = requiresOriginalTarget ? undefined : rememberConversationTaskSummarySubmission(input, target);
  if (!requiresOriginalTarget) promptAutoRepairController.cancel(target.tabId);
  if (!requiresOriginalTarget && shouldAwaitCliCommandAutoRepair(target.cli, {
    [target.cli]: getCliCommand(target.cli),
  })) {
    await waitForCliCommandAutoRepair();
    if (isExtensionDeactivating) {
      return;
    }
  }

  if (!firstMainExecution) {
    await loopMainAutoCompactFlights.wait(target.tabId);
    if (isPreparationAborted()) return;
    const compactWaitTab = getConversationTabById(target.tabId);
    await loopSubtaskAutoCompactions.wait(target.cli, compactWaitTab ? getConversationTabSessionIdForCli(compactWaitTab, target.cli) : null);
  }

  if (isPreparationAborted()) {
    return;
  }
  if (isTabRunActive(target.tabId)) {
    if (requiresOriginalTarget) return;
    preemptActivePromptRun(target.tabId);
  }

  const currentTab = getConversationTabById(target.tabId);
  if (!currentTab || currentTab !== targetTab || currentTab.cli !== target.cli) {
    return;
  }
  const previousSessionId = getConversationTabSessionIdForCli(currentTab, target.cli);
  const currentSummaryTask = Boolean(summarySubmission && activeWorkspaceKey === summarySubmission.workspace
    && currentTab === summarySubmissionTab);
  if (!requiresOriginalTarget) target.sessionId = sessionLifecycleController.prepareSessionForPromptRun(target.cli, previousSessionId, target.tabId);
  if (["codex", "opencode"].includes(target.cli) && input.taskRole === "subtask" && input.loopTaskId
    && usesDepartmentOwner(readLoopTaskRecord(input.loopTaskId)?.department)) {
    getDepartmentExecutionResources().confirmSessionTransition(target.tabId, previousSessionId, target.sessionId);
  }
  preparingSessionId = getConversationTabSessionIdForCli(currentTab, target.cli);

  if (previousSessionId && target.sessionId !== previousSessionId) {
    disposeInteractiveRunnerIfUnused({ cli: target.cli, sessionId: previousSessionId });
    await postPanelState();
  }

  scheduleLogRetentionCleanup();
  let promptInput = input;

  if (target.sessionId && !input.taskRole && !input.loopTaskId && !input.loopAsk) {
    const modelPrompt = buildVibeModeTransitionPrompt(input, loadSessionMessages(target.cli, target.sessionId));
    if (modelPrompt !== input.modelPrompt) {
      promptInput = { ...input, modelPrompt };
    }
  }

  if (target.cli === "opencode") {
    promptInput = preloadUserMessageForPrompt(promptInput, target, { captureTaskSummary: false });
  }

  if (input.taskRole === "subtask") {
    const boundConfigId = getActiveConfigIdForCli(target.cli) ?? "";
    const configExists = boundConfigId
      ? Boolean(await configService.getConfigById(target.cli, boundConfigId))
      : false;
    const configPlan = planBoundSubtaskConfigApply({
      taskRole: input.taskRole,
      targetCli: target.cli,
      loopSubtaskCli: input.loopSubtaskCli,
      loopSubtaskConfigId: boundConfigId,
      activeConfigId: getActiveConfigIdForCli(target.cli),
      configExists,
    });
    if (configPlan.action === "fail") {
      appendSystemMessageForPromptTarget(target, configPlan.message);
      sendRunStatusForTab(target.tabId, "error", { message: configPlan.message });
      if (input.throwOnError) {
        throw new Error(configPlan.message);
      }
      return;
    }
  }

  if (isPreparationAborted()) return;
  const useClassicLoopProjectInstructions = shouldUseClassicLoopProjectInstructions(
    input,
    input.taskRole === "subtask" && input.loopTaskId ? readLoopTaskRecord(input.loopTaskId) : null,
  );
  const departmentProcess = input.taskRole === "subtask" && !!input.loopTaskId && departmentOwnerResources(input.loopTaskId, target.cli);
  const subtaskExecutionRoot = input.taskRole === "subtask" && !departmentProcess && !useClassicLoopProjectInstructions && !input.executionCwd
    ? (() => {
        const workspaceCwd = resolveWorkspaceCwd();
        return workspaceCwd ? createWorkspaceLoopSubtaskExecutionRoot(workspaceCwd) : null;
      })()
    : null;
  const shouldUseInteractive = isInteractiveSupported(target.cli);
  try {
    const executionOptions = {
      departmentInteractiveRunner: options.departmentInteractiveRunner,
      departmentLeaderSession: options.departmentLeaderSession,
      registerQuestionRun: options.registerQuestionRun,
      requireOriginalSession: requiresOriginalTarget,
      isAborted: () => firstMainExecution?.admitted
        ? isExtensionDeactivating || options.isAborted?.() === true : isPreparationAborted(),
      cwd: useClassicLoopProjectInstructions ? resolveWorkspaceCwd() : input.executionCwd ?? subtaskExecutionRoot?.cwd,
      isolateProjectInstructions: useClassicLoopProjectInstructions
        ? false
        : input.isolateProjectInstructions ?? Boolean(subtaskExecutionRoot),
    };
    const workspaceKey = activeWorkspaceKey;
    const startupCommand = getCliCommand(target.cli);
    await promptAutoRepairController.run(promptInput, target, {
      disableRepair: requiresOriginalTarget,
      execute: async (attemptInput, attemptTarget) => {
        let appliedExecutionConfigId: string | null = null;
        let currentAttemptInput = attemptInput;
        let ownerStream: typeof runCliStream | undefined;
        let departmentCodexRun: import("./extensionHost/promptExecutionShared").PromptRunExecutionOptions["departmentCodexRun"];
        let departmentTabConsumer: ReturnType<ReturnType<typeof getDepartmentExecutionResources>["beginConsumer"]> | undefined;
        const codexPreparationAbort = new AbortController();
        const abortCodexPreparation = () => codexPreparationAbort.abort();
        options.signal?.addEventListener("abort", abortCodexPreparation, { once: true });
        if (options.signal?.aborted) abortCodexPreparation();
        try {
          const waitForConfiguration = () => configApplyQueue.waitForIdle(attemptTarget.cli);
          const ready = await (options.performanceTrace?.measure("config-queue", waitForConfiguration, (value) => value ? "returned" : "denied")
            ?? waitForConfiguration());
          if (!ready) {
            throw new Error("配置应用失败，任务未启动，请重新选择配置后重试。");
          }
          if (attemptInput.loopTaskId) {
            const invocationTask = readLoopTaskRecord(attemptInput.loopTaskId);
            attemptInput = applyLoopInvocationModelRouting(attemptInput, invocationTask);
            if (invocationTask?.department || invocationTask?.departmentInvalid) {
              if (firstMainExecution) throw new Error(t("loopGroupChatChat.originalRuntimeUnavailable"));
              attemptInput = await prepareDepartmentInvocation(attemptInput, attemptTarget.tabId);
            }
            currentAttemptInput = attemptInput;
          }
          if (firstMainExecution && (!firstMainExecution.isTargetCurrent()
            || !await configService.getConfigById(attemptTarget.cli, firstMainExecution.configId)
            || !firstMainExecution.isTargetCurrent())) {
            throw new Error(firstMainExecution.unavailableMessage);
          }
          const configState = firstMainExecution ? undefined : await loadConfigState(attemptTarget.cli);
          const previousConfigId = attemptInput.taskRole === "subtask"
            ? attemptInput.loopSubtaskConfigId
            : attemptInput.executionProfile?.configId
              ?? (attemptInput.loopTaskId ? readLoopTaskRecord(attemptInput.loopTaskId)?.originProfile?.configId : undefined);
          const departmentTask = Boolean(attemptInput.loopTaskId && readLoopTaskRecord(attemptInput.loopTaskId)?.department);
          const executionConfigId = firstMainExecution?.configId ?? (departmentTask
            ? previousConfigId ?? configState?.activeConfigId ?? null
            : configState?.activeConfigId ?? getActiveConfigIdForCli(attemptTarget.cli));
          if (configState?.configurationError && !departmentTask) throw new Error("当前 CLI 配置读取失败，任务未启动。");
          if (departmentTask && executionConfigId) {
            if (!await configService.getConfigById(attemptTarget.cli, executionConfigId)) {
              throw new Error("部门固化角色档案已不存在，拒绝启动。");
            }
            if (executionConfigId !== configState?.activeConfigId
              && await applyConfigById(attemptTarget.cli, executionConfigId) !== "applied") {
              throw new Error("部门固化角色档案应用失败，任务未启动。");
            }
          }
          if (!firstMainExecution && !departmentTask && previousConfigId && previousConfigId !== executionConfigId) {
            if (mainRecovery) return;
            const role = attemptInput.taskRole === "subtask" ? "subtask" : "main";
            const model = attemptInput.taskRole
              ? getSelectedLoopCliModel(attemptTarget.cli, role, executionConfigId)
                ?? getSelectedCliModel(attemptTarget.cli, executionConfigId)
              : getSelectedCliModel(attemptTarget.cli, executionConfigId);
            currentAttemptInput = {
              ...attemptInput,
              model: model ?? undefined,
              ...(attemptInput.taskRole === "main" ? { loopMainModel: model ?? undefined, loopMainThinkingMode: undefined } : {}),
              thinkingModeOverride: undefined,
              executionProfile: undefined,
              ...(attemptInput.taskRole === "subtask" ? { loopSubtaskConfigId: executionConfigId ?? undefined } : {}),
            };
          }
          appliedExecutionConfigId = executionConfigId;
          if (departmentProcess && attemptTarget.cli === "opencode") {
            const mode = currentAttemptInput.thinkingModeOverride;
            if (!mode || normalizeThinkingWorkspaceFiles(getThinkingWorkspaceFiles("opencode", mode)).length > 0) {
              throw new Error("部门独立进程尚不支持自定义思考工作区文件；未改写原工作区或启动任务。");
            }
            // Per-invocation closure: raw model input never becomes a launch descriptor.
            let invoked = false;
            departmentTabConsumer = getDepartmentExecutionResources().beginConsumer(attemptTarget.tabId);
            ownerStream = (cli, prompt, handlers, streamOptions = {}) => {
              if (invoked || cli !== "opencode" || !currentAttemptInput.loopTaskId || !currentAttemptInput.loopSubtaskId) {
                throw new Error("部门原执行不能重试或替换 Owner。");
              }
              invoked = true;
              return startDepartmentProcessInvocation(getDepartmentProcessPreparation(), currentAttemptInput.loopTaskId,
                currentAttemptInput.loopSubtaskId, handlers,
                { configId: executionConfigId, revision: "department-role" }, async (selection, sessionId) => {
                  if ((streamOptions.sessionId && streamOptions.sessionId !== sessionId) || streamOptions.commandOverride || streamOptions.argsOverride
                    || (selection.model !== null && streamOptions.model !== selection.model)) throw new Error("部门原生会话或角色参数冲突。");
                  const command = splitConfiguredCliCommand(getCliCommand(cli));
                  const workspaceDirectory = resolveWorkspaceCwd();
                  if (streamOptions.openCodeServerUrl || getCliArgs(cli).some((arg) => /^(--attach|--port)(=|$)/.test(arg))) {
                    throw new Error("部门独立进程暂不支持外部或 EH 持有的 OpenCode server。");
                  }
                  if (!command[0] || !workspaceDirectory) throw new Error("部门执行缺少工作区或 CLI。");
                  const targetConfig = DEPARTMENT_CONFIG_PATHS.opencode.config;
            return {
              configurationDirectory: path.join(path.dirname(targetConfig), ".sinitek-runtime-coordination", path.basename(targetConfig)),
                    workspaceDirectory,
                    launch: { command: command[0], args: [...command.slice(1), ...buildDepartmentProcessArgs(cli, { ...streamOptions, sessionId }, prompt)],
                      baseEnvironment: { ...(streamOptions.environment ?? process.env) }, envOverrides: streamOptions.envOverrides ? { ...streamOptions.envOverrides } : undefined,
                      macTaskShell: getMacTaskShell(), processLabel: streamOptions.processLabel },
                    overlay: streamOptions.openCodeConfigContent && streamOptions.model ? {
                      configContent: streamOptions.openCodeConfigContent, primaryModel: streamOptions.model,
                      smallModel: streamOptions.openCodeSmallModel ?? null, primaryVariant: streamOptions.openCodeVariant,
                      smallVariant: streamOptions.openCodeSmallVariant } : null,
                  };
                }, { signal: options.signal, isAborted: () => isExtensionDeactivating || options.isAborted?.() === true,
                  tabTarget: departmentTabConsumer!.target });
            };
          }
          if (departmentProcess && attemptTarget.cli === "codex") {
            const mode = currentAttemptInput.thinkingModeOverride;
            if (!mode || normalizeThinkingWorkspaceFiles(getThinkingWorkspaceFiles("codex", mode)).length > 0) {
              throw new Error("部门独立 Codex 暂不支持自定义思考工作区文件，任务未启动。");
            }
            const expectedSelection = { configId: executionConfigId, revision: "department-role" };
            const command = getCliCommand("codex"), workspaceDirectory = resolveWorkspaceCwd();
            const shell = getMacTaskShell(), environment = { ...process.env };
            const model = currentAttemptInput.model ?? null;
            const args = buildDepartmentProcessArgs("codex", { thinkingMode: mode, model, isolateProjectInstructions: true, imagePaths: currentAttemptInput.imagePaths });
            if (!workspaceDirectory) throw new Error("部门执行缺少工作区。");
            const targetConfig = DEPARTMENT_CONFIG_PATHS.codex.config;
            let invoked = false;
            departmentTabConsumer = getDepartmentExecutionResources().beginConsumer(attemptTarget.tabId);
            departmentCodexRun = async (prompt, handlers) => {
              if (invoked || !currentAttemptInput.loopTaskId || !currentAttemptInput.loopSubtaskId) throw new Error("部门原执行不能重试或替换 Owner。");
              invoked = true;
              await getDepartmentCodexPreparation().run(currentAttemptInput.loopTaskId, currentAttemptInput.loopSubtaskId, handlers,
                expectedSelection, async (fixed, threadId) => {
                  if (fixed.model !== model || fixed.thinkingMode !== mode) throw new Error("部门 Codex 角色参数冲突。");
                  return { configurationDirectory: path.join(path.dirname(targetConfig), ".sinitek-runtime-coordination", path.basename(targetConfig)),
                    workspaceDirectory, macTaskShell: shell, prompt, requestUserInputEnabled: handlers.requestUserInputEnabled === true,
                    runner: { command, args, env: environment, model, thinkingMode: mode, interactiveMode: "coding", threadId, configFingerprint: fingerprintDepartmentExecutionSelection(fixed).configFingerprint } };
                }, { signal: codexPreparationAbort.signal, isAborted: () => isExtensionDeactivating || options.isAborted?.() === true,
                  tabTarget: departmentTabConsumer!.target });
            };
          }
          if (attemptTarget.cli === "opencode") {
            const preflightMessage = await getOpenCodeConfigPreflightMessage();
            if (preflightMessage) {
              void logError("opencode-config-preflight-failed", {
                cli: attemptTarget.cli,
                tabId: attemptTarget.tabId,
                error: preflightMessage,
              });
              throw new Error(preflightMessage);
            }
          }
        } catch (error) {
          departmentTabConsumer?.finish(false);
          options.signal?.removeEventListener("abort", abortCodexPreparation);
          appendSystemMessageForPromptTarget(attemptTarget, getErrorInfo(error).message);
          throw error;
        }
        let departmentConsumed = false;
        let finishFirstMainQueue: (() => void) | undefined;
        let finishRunner: ReturnType<PerformanceTrace["start"]> | undefined;
        try {
          if (executionOptions.isAborted()) {
            return;
          }
          if (!firstMainExecution) options.onStarted?.();
          if (summarySubmission) {
            conversationTaskSummaries.request({
              tabId: attemptTarget.tabId,
              eligible: currentSummaryTask && pendingConversationTaskSummarySubmissions.isCurrent(currentTab, summarySubmission),
              submission: summarySubmission,
              capture: () => {
                const model = currentAttemptInput.model ?? summarySubmission.model;
                return captureConversationTaskSummaryExecution({
                  cli: attemptTarget.cli, requirement: summarySubmission.requirement, model,
                  thinkingMode: currentAttemptInput.thinkingModeOverride ?? summarySubmission.thinkingMode,
                  command: summarySubmission.command,
                  args: summarySubmission.args,
                  openCodeVariant: currentAttemptInput.thinkingModeOverride ?? summarySubmission.openCodeVariant,
                  claudeEntrypoint: attemptTarget.cli === "claude" ? resolveClaudeInteractiveEntrypoint(summarySubmission.command) : undefined,
                });
              },
            });
          }
          if (!firstMainExecution && !shouldUseInteractive && !await takeOverSessionForTab(attemptTarget, executionOptions.isAborted)) {
            return;
          }
          finishRunner = options.performanceTrace?.start("runner");
          if (firstMainExecution) {
            if (!shouldUseInteractive) throw new Error(firstMainExecution.unavailableMessage);
            await runPromptInteractive(currentAttemptInput, attemptTarget, {
              ...executionOptions,
              originalSessionPreparationSignal: options.signal,
              onOriginalTurnStartRejected: () => { firstMainExecution.startRejected = true; },
              prepareOriginalSession: {
                configId: firstMainExecution.configId,
                codexConfigEvidence: firstMainExecution.codexConfigEvidence,
                isConfigCurrent: () => firstMainExecution.isTargetCurrent(),
                prepare: () => {
                  const verifyNotAborted = () => {
                    if (isPreparationAborted()) {
                      throw new Error(firstMainExecution.unavailableMessage);
                    }
                  };
                  verifyNotAborted();
                  const prepared = firstMainExecution.prepare();
                  return {
                    ...prepared,
                    commit: () => { verifyNotAborted(); prepared.commit(); },
                    afterSend: () => {
                      void loopMainQuestionQueue.runMain(attemptTarget.tabId, () => new Promise<void>((resolve) => {
                        finishFirstMainQueue = resolve;
                      }));
                      try { prepared.afterSend(); }
                      finally { options.onStarted?.(); }
                    },
                  };
                },
              },
            });
          } else if (shouldUseInteractive) {
            await runPromptInteractive(currentAttemptInput, attemptTarget, { ...executionOptions, departmentCodexRun, cancelDepartmentCodexPreparation: abortCodexPreparation });
          } else if (hasOtherTabRun(attemptTarget.tabId)) {
            await runPromptParallel(currentAttemptInput, attemptTarget, { ...executionOptions, departmentProcessStream: ownerStream });
          } else {
            await runPromptOneShot(currentAttemptInput, attemptTarget, { ...executionOptions, departmentProcessStream: ownerStream });
          }
          departmentConsumed = true;
        } catch (error) {
          finishRunner?.("threw");
          throw error;
        } finally {
          finishRunner?.();
          finishFirstMainQueue?.();
          departmentTabConsumer?.finish(departmentConsumed);
          options.signal?.removeEventListener("abort", abortCodexPreparation);
        }
        if (!departmentCodexRun && attemptInput.taskRole === "subtask" && attemptInput.loopTaskId && attemptInput.loopSubtaskId) {
          const task = readLoopTaskRecord(attemptInput.loopTaskId);
          const current = getConversationTabById(attemptTarget.tabId);
          const currentSession = resolvePromptRunTargetSessionId(attemptTarget);
          if (activeWorkspaceKey === workspaceKey && current === targetTab && current?.cli === attemptTarget.cli) {
            options.onLoopSubtaskSessionSettled?.(currentSession);
          }
          const sessionId = currentSession
            ?? getLatestLoopRoundRunRecord(attemptInput.loopTaskId, attemptInput.loopRound ?? 1, "subtask", attemptInput.loopSubtaskId, attemptInput.loopAttemptId)?.sessionId;
          if (task && sessionId) {
            updateLoopTaskRecord(task.id, { subTasks: bindLoopSubtaskSession(task.subTasks, attemptInput.loopSubtaskId, { cli: attemptTarget.cli, sessionId, configId: appliedExecutionConfigId }) });
          }
        }
      },
      isTargetCurrent: () => !isPreparationAborted() && activeWorkspaceKey === workspaceKey,
      onRepairStarted: () => {
        const tab = getConversationTabById(target.tabId);
        appendSystemMessageForPromptTarget({
          ...target,
          sessionId: tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId,
        }, t("cliRepair.taskRepairStarted", { cli: target.cli }));
        sendRunStatusForTab(target.tabId, "start", { prompt });
      },
      repairCommand: async (error) => {
        await waitForCliCommandAutoRepair();
        const command = getCliCommand(target.cli);
        if (!inspectUnresolvedCliCommands({ [target.cli]: command }).some((issue) => issue.cli === target.cli)
          && !isCliShellCommandNotFoundError(error)) {
          return command !== startupCommand;
        }
        if (command !== startupCommand) {
          return !inspectUnresolvedCliCommands({ [target.cli]: command }).some((issue) => issue.cli === target.cli);
        }
        // A login shell can lose a bare command even when the host PATH resolves
        // it. Pin the discovered executable for the single repair attempt.
        const executablePath = await locateCliExecutableForRepair(command, target.cli);
        if (!executablePath) {
          return false;
        }
        if (getCliCommand(target.cli) !== command) {
          return !inspectUnresolvedCliCommands({ [target.cli]: getCliCommand(target.cli) })
            .some((issue) => issue.cli === target.cli);
        }
        const repairedCommand = buildRepairedCliCommand(command, target.cli, executablePath);
        if (repairedCommand === command) {
          return false;
        }
        await persistCliCommand(target.cli, repairedCommand);
        void logInfo("task-cli-command-auto-repaired", { cli: target.cli, tabId: target.tabId });
        return true;
      },
      startFreshSession: async () => {
        const tab = getConversationTabById(target.tabId);
        if (!tab) {
          return;
        }
        const failedSessionId = getConversationTabSessionIdForCli(tab, target.cli);
        sessionLifecycleController.prepareSessionForPromptRun(target.cli, failedSessionId, target.tabId, { forceNewSession: true });
        preparingSessionId = getConversationTabSessionIdForCli(tab, target.cli);
        if (failedSessionId) {
          disposeInteractiveRunnerIfUnused({ cli: target.cli, sessionId: failedSessionId });
        }
        target.sessionId = null;
        appendSystemMessageForPromptTarget(target, t("cliRepair.taskRetryStarted", { cli: target.cli }));
        await postPanelState();
      },
      onRepairFailed: (error) => {
        void logError("task-cli-command-auto-repair-failed", { cli: target.cli, error: getErrorInfo(error).message });
      },
    });
  } catch (error) {
    if (firstMainExecution && (!firstMainExecution.admitted || firstMainExecution.startRejected)) throw error;
    const info = getErrorInfo(error);
    if (isAbortErrorInfo(info) && (!firstMainExecution || options.isAborted?.())) {
      void logInfo("runPrompt-abort-ignored", { cli: target.cli, error: info.message });
      return;
    }
    void logError("runPrompt-failed", {
      cli: target.cli,
      tabId: target.tabId,
      taskRole: promptInput.taskRole,
      loopTaskId: promptInput.loopTaskId,
      loopSubtaskId: promptInput.loopSubtaskId,
      loopAttemptId: promptInput.loopAttemptId,
      error: info.message,
      errorCode: info.code,
    });
    if (!isTabRunActive(target.tabId)) {
      if (info.code === "SESSION_RUN_ACTIVE") {
        appendSystemMessageForPromptTarget(target, info.message);
      }
      sendRunStatusForTab(target.tabId, "error", { message: info.message });
    }
    if (promptInput.throwOnError) {
      throw error;
    }
  } finally {
    subtaskExecutionRoot?.dispose();
  }
}
// One-shot prompt runtime moved to extensionHost/promptOneShotRuntime.ts.


type TraceMessageOptions = {
  merge?: boolean;
  persist?: boolean;
  forceTraceBubble?: boolean;
  taskListItems?: OpenCodeTaskListItem[];
};

function appendTraceMessage(
  content: string,
  kind: TraceMessageKind = "normal",
  options: TraceMessageOptions = {}
): void {
  if (!primaryPromptRunController.activeMessageTarget) {
    return;
  }
  if (!content.trim()) {
    return;
  }
  const { content: displayContent, shouldPersist } = normalizeTraceContentForDisplay(content, primaryPromptRunController.activeCliForRun);
  if (!displayContent.trim()) {
    return;
  }
  const resolvedKind = resolveTraceKind(displayContent, kind);
  if (resolvedKind === "thinking" && options.forceTraceBubble !== true) {
    appendAssistantChunk(`${displayContent}\n`, "thinking");
    return;
  }
  const shouldMerge = resolveTraceMerge(displayContent, options.merge);
  const mergePayload = shouldMerge ? {} : { merge: false };
  const message: ChatMessage = {
    id: createMessageId(),
    role: "trace",
    content: displayContent,
    createdAt: Date.now(),
    kind: resolvedKind,
    ...mergePayload,
  };
  if (shouldPersist && options.persist !== false) {
    appendMessageToStore(primaryPromptRunController.activeMessageTarget, message);
  }
  sendPanelMessage({
    type: "traceSegment",
    id: message.id,
    createdAt: message.createdAt,
    sequence: message.sequence,
    content: message.content,
    kind: resolvedKind,
    ...(Array.isArray(options.taskListItems) ? { taskListItems: options.taskListItems } : {}),
    ...mergePayload,
  });
}

function appendSystemMessage(content: string): void {
  if (!primaryPromptRunController.activeMessageTarget) {
    return;
  }
  if (!content.trim()) {
    return;
  }
  const message: ChatMessage = {
    id: createMessageId(),
    role: "system",
    content,
    createdAt: Date.now(),
  };
  appendMessageToStore(primaryPromptRunController.activeMessageTarget, message);
  sendPanelMessage({ type: "appendMessage", message });
}

function appendSystemMessageForCli(cli: CliName, sessionId: string | null, content: string): void {
  const message: ChatMessage = {
    id: createMessageId(),
    role: "system",
    content,
    createdAt: Date.now(),
  };
  if (sessionId) {
    const target = loadSessionMessages(cli, sessionId);
    appendMessageToStore(target, message);
    saveSessionMessages(cli, sessionId, target);
  } else {
    const tabId = getActiveConversationTabId();
    if (!tabId) {
      return;
    }
    getPendingSessionDraft(tabId, cli).messages.push(message);
  }
  sendPanelMessage({ type: "appendMessage", message });
}

function appendUserMessageForCli(
  cli: CliName,
  sessionId: string | null,
  content: string,
  options: { merge?: boolean } = {}
): void {
  const message: ChatMessage = {
    id: createMessageId(),
    role: "user",
    content,
    createdAt: Date.now(),
    ...(options.merge === false ? { merge: false } : {}),
  };
  if (sessionId) {
    const target = loadSessionMessages(cli, sessionId);
    appendMessageToStore(target, message);
    saveSessionMessages(cli, sessionId, target);
  } else {
    const tabId = getActiveConversationTabId();
    if (!tabId) {
      return;
    }
    getPendingSessionDraft(tabId, cli).messages.push(message);
  }
  sendPanelMessage({ type: "appendMessage", message });
}

async function resolveInteractiveSessionForResume(
  cli: CliName,
  sessionId: string | null,
  tabId: string | null,
): Promise<string | null | undefined> {
  if (!sessionId) {
    return sessionId;
  }
  const repairedSessionId = repairSupersededLocalSession(cli, sessionId, { source: "resume" });
  if (repairedSessionId !== sessionId) {
    return repairedSessionId;
  }
  const mappedId = resolveInteractiveMappedId(cli, repairedSessionId);
  if (isLocalSessionId(repairedSessionId) && !mappedId) {
    const detail = t("session.resumeUnavailableNoRemote");
    void logEssential("interactive-session-resume-blocked", {
      cli,
      sessionId: repairedSessionId,
      tabId,
      reason: "missing-remote-id",
    }).catch(() => undefined);
    await showErrorWithActions(t("session.resumeUnavailableTitle"), detail);
    return undefined;
  }
  return repairedSessionId;
}

function persistAutoCompactMessagesPreservingConcurrentTranscript(): void {
  if (!primaryPromptRunController.activeCliForRun || !primaryPromptRunController.activeMessageTarget || !primaryPromptRunController.activeSessionId) {
    persistActiveMessages();
    return;
  }
  const live = sessionMessageCache.get(getSessionKey(activeWorkspaceKey, primaryPromptRunController.activeCliForRun, primaryPromptRunController.activeSessionId));
  if (!live || live === primaryPromptRunController.activeMessageTarget) {
    persistActiveMessages();
    return;
  }
  saveSessionMessages(
    primaryPromptRunController.activeCliForRun,
    primaryPromptRunController.activeSessionId,
    mergeCompactTranscriptIntoLive(live, primaryPromptRunController.activeMessageTarget),
  );
}

async function runContextCompaction(
  options: ContextCompactionOptions = {},
  isolatedRun = false,
): Promise<boolean> {
  const tabId = options.tabId ?? getActiveConversationTabId();
  const departmentTask = departmentTaskForTab(tabId);
  if (usesDepartmentOwner(departmentTask?.department) && departmentTask) {
    if (!options.silent) appendSystemMessageForCli(departmentTask.cli, departmentTask.sessionId ?? null, "组长会话由产研部管理，不支持手动压缩。");
    return false;
  }
  const deps: ContextCompactionRunDeps = {
    getCurrentCli: () => currentCli,
    getActiveConversationTabId,
    isInteractiveSupported,
    appendSystemMessageForCli,
    getCurrentSessionId,
    hasActiveProcessOrInteractiveStop: () => Boolean(primaryPromptRunController.activeProcess || primaryPromptRunController.activeInteractiveStop),
    resolveInteractiveSessionForResume,
    resolveWorkspaceCwd,
    getActiveConfigIdForCli,
    getSelectedCliModel,
    getEffectiveThinkingMode,
    getWorkspaceInteractiveMode,
    applyThinkingWorkspaceFiles,
    getEffectiveCliArgs,
    getCliCommand,
    resolveClaudeInteractiveEntrypoint,
    logCliStartup,
    loadSessionMessages,
    createMessageId,
    beginActiveRunState: ({ runId, cli, sessionId, tabId, messageTarget }) => {
      primaryPromptRunController.begin({
        runId,
        cli,
        sessionId,
        tabId,
        messageTarget,
      });
      applyProcessTitle(runId, cli, sessionId);
      startTaskRun(runId, cli, sessionId, t("common.compactContext"));
    },
    getActiveRunId: () => primaryPromptRunController.activeRunId,
    getContextCompactionTabState: (tabId) => {
      const tab = getConversationTabById(tabId);
      if (!tab) return undefined;
      return {
        cli: tab.cli,
        sessionId: tab.sessionId,
        runId: interactiveRunsByTabId.get(tabId)?.runId
          ?? parallelRunsByTabId.get(tabId)?.runId
          ?? (primaryPromptRunController.activeTabIdForRun === tabId ? primaryPromptRunController.activeRunId : undefined),
        runRevision: conversationTabRunRevisions.get(tab) ?? tab,
      };
    },
    setActiveInteractiveStop: (stop) => {
      primaryPromptRunController.activeInteractiveStop = stop;
    },
    isActiveInteractiveStop: (stop) => primaryPromptRunController.activeInteractiveStop === stop,
    appendStopMessageToStore,
    killActiveProcess: () => {
      primaryPromptRunController.activeProcess?.kill();
    },
    sendRunStatus,
    appendCompletionMessage: (status) => appendCompletionMessage(status, { notifyCompletion: false }),
    persistActiveMessages: options.allowActiveRun === true
      ? persistAutoCompactMessagesPreservingConcurrentTranscript
      : persistActiveMessages,
    clearActiveRun,
    interactiveRunnerManager,
    resolveInteractiveMappedId,
    appendSystemMessage,
    upsertInteractiveMapping,
    sendRawStreamDelta,
    sendPanelMessage: (message) => sendPanelMessage(message),
    updateProcessTitle,
    appendTraceMessage,
    resolveKimiModelWireForRun: (model) => modelSettingsHost.resolveKimiModelWireForRun(model),
    readRuntimeConfigFingerprint: configService.readRuntimeConfigFingerprint,
    prepareOpenCodeRunProfile: async (selectedModel, _cwd, cli) => {
      if (cli !== "opencode") {
        return { model: selectedModel };
      }
      const configId = getActiveConfigIdForCli("opencode");
      const runtimePreparation = await prepareOpenCodeRuntime({
        configId,
        role: "main",
        model: selectedModel ?? null,
      });
      return {
        openCodeVariant: runtimePreparation.effectiveVariant,
        openCodeSmallVariant: runtimePreparation.subtaskVariant,
        model: runtimePreparation.effectiveModel,
        openCodeSmallModel: runtimePreparation.subtaskModel,
        openCodeConfigContent: runtimePreparation.configContent,
        envOverrides: runtimePreparation.envOverrides,
      };
    },
    setActiveProcess: (process) => {
      primaryPromptRunController.activeProcess = process;
    },
    appendAssistantChunk,
    adoptSessionId,
  };
  return runContextCompactionWithDeps(isolatedRun ? createIsolatedContextCompactionDeps(deps, {
    saveMessages: saveSessionMessages,
    publishMessage: (message, tabId) => sendPanelMessage({ type: "appendMessage", message, tabId: tabId ?? undefined }),
    publishPanelMessage: sendPanelMessage,
    sendRunStatus: (tabId, status, message, runOptions) => {
      if (status === "start") markConversationTabRunStarted(tabId);
      sendPanelMessage({
        type: "runStatus",
        tabId: tabId ?? undefined,
        status,
        message,
        activity: status === "start" ? runOptions?.activity : undefined,
      });
    },
  }) : deps, options);
}

function shouldAutoCompactContextAfterRunForTarget(target: PromptRunTarget): boolean {
  if (!getGlobalAutoCompactContextAfterRun()) {
    return false;
  }
  if (!isAutoContextCompactionCli(target.cli)) {
    return false;
  }
  if (!target.sessionId) {
    return false;
  }
  return true;
}

function reserveLoopMainAutoCompactRun(
  target: PromptRunTarget,
  sessionId: string,
): LoopMainAutoCompactReservation {
  const runId = createMessageId();
  let released = false;
  let adoptedStop: (() => void) | null = null;
  let stopRequested = false;
  const placeholder = (): void => {
    stopRequested = true;
    adoptedStop?.();
  };
  primaryPromptRunController.activeRunId = runId;
  primaryPromptRunController.activeTabIdForRun = target.tabId;
  primaryPromptRunController.activeCliForRun = target.cli;
  primaryPromptRunController.activeSessionId = sessionId;
  primaryPromptRunController.activeInteractiveStop = placeholder;
  return {
    adoptStop: (stop) => {
      adoptedStop = stop;
      if (primaryPromptRunController.activeInteractiveStop === placeholder) {
        primaryPromptRunController.activeInteractiveStop = stop;
      }
      if (stopRequested) {
        stop();
      }
    },
    release: () => {
      if (released) {
        return;
      }
      released = true;
      if (primaryPromptRunController.activeInteractiveStop === placeholder && primaryPromptRunController.activeRunId === runId) {
        clearActiveRun();
      }
    },
  };
}

async function runAutoCompactContextAfterPromptSuccess(
  target: PromptRunTarget,
  sessionId: string,
  request: { allowActiveRun: boolean; onStopReady?: (stop: () => void) => void; isolatedRun?: boolean },
): Promise<void> {
  const compacted = await runContextCompaction({
    silent: true,
    cli: target.cli,
    tabId: target.tabId,
    sessionId,
    timeoutMs: AUTO_COMPACT_AFTER_RUN_TIMEOUT_MS,
    allowActiveRun: request.allowActiveRun,
    onStopReady: request.onStopReady,
  }, request.isolatedRun);
  void logInfo("auto-context-compact-after-run-finished", {
    cli: target.cli,
    tabId: target.tabId,
    sessionId,
    compacted,
    overlappedLoopDispatch: request.allowActiveRun,
  });
}

async function maybeAutoCompactContextAfterPromptSuccess(
  target: PromptRunTarget,
  sessionId: string | null,
  durationMs: number | null | undefined,
  options: LoopMainAutoCompactRequest = {},
): Promise<void> {
  if (!shouldAutoCompactContextAfterRunForTarget(target) || !sessionId) {
    return;
  }
  if (typeof durationMs !== "number" || durationMs <= AUTO_COMPACT_AFTER_RUN_MIN_DURATION_MS) {
    void logInfo("auto-context-compact-after-run-skipped-short-task", {
      cli: target.cli,
      tabId: target.tabId,
      sessionId,
      durationMs: typeof durationMs === "number" ? durationMs : null,
      minDurationMs: AUTO_COMPACT_AFTER_RUN_MIN_DURATION_MS,
    });
    return;
  }
  if (options.isolatedRun) {
    await runAutoCompactContextAfterPromptSuccess(target, sessionId, { ...options, allowActiveRun: false });
    return;
  }
  const overlapLoopDispatch = options.overlapLoopDispatch === true;
  if (overlapLoopDispatch) {
    void logInfo("auto-context-compact-after-run-overlap-loop-dispatch", {
      cli: target.cli,
      tabId: target.tabId,
      sessionId,
    });
  }
  await settleAutoCompactAfterPrompt({
    overlapLoopDispatch,
    canOverlap: overlapLoopDispatch && !isPrimaryRunActive(),
    run: (request) => runAutoCompactContextAfterPromptSuccess(target, sessionId, request),
    reserve: () => reserveLoopMainAutoCompactRun(target, sessionId),
    track: (flight) => {
      loopMainAutoCompactFlights.track(target.tabId, flight);
    },
  });
}

async function runContextCompactionCommand(): Promise<void> {
  await runContextCompaction();
}

// Interactive prompt runtime moved to extensionHost/promptInteractiveRuntime.ts.
async function promptInstallMissingCli(cli: CliName, command: string): Promise<void> {
  const installLabel = t("cli.install.actionInstall");
  const openSettingsLabel = t("common.openSettings");
  const message = [
    t("cli.install.prompt", { cli: getCliDisplayName(cli), command }),
    buildCliCommandNotFoundMessage(cli, command, process.platform, t),
  ].join("\n\n");
  const selection = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    installLabel,
    openSettingsLabel
  );
  if (selection === installLabel) {
    const installCommand = getCliInstallCommand(cli);
    if (!installCommand.trim()) {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `sinitek-cli-tools.commands.${cli}`
      );
      return;
    }
    const terminal = vscode.window.createTerminal({
      name: `${CLI_INSTALL_TERMINAL_PREFIX}: ${cli}`,
    });
    terminal.show();
    terminal.sendText(installCommand);
    cliInstallStatuses[cli] = null;
    void logInfo("cli-install-triggered", { cli, command, installCommand });
    void vscode.window.showInformationMessage(
      t("cli.install.started", { command: installCommand })
    );
    return;
  }
  if (selection === openSettingsLabel) {
    void vscode.commands.executeCommand(
      "workbench.action.openSettings",
      `sinitek-cli-tools.commands.${cli}`
    );
  }
}

function stopActiveRun(): void {
  if (primaryPromptRunController.activeInteractiveStop) {
    primaryPromptRunController.activeInteractiveStop();
    return;
  }
  if (!primaryPromptRunController.activeProcess) {
    return;
  }
  const removedPlaceholder = removeActiveAssistantPlaceholder();
  appendStopMessageToStore();
  primaryPromptRunController.activeProcess.kill();
  void logInfo("runPrompt-stopped", { cli: currentCli });
  sendRunStatus("stopped", t("run.stoppedByUser"));
  if (currentCli === "codex" || currentCli === "opencode") {
    flushTraceBuffer();
  }
  appendCompletionMessage("stopped");
  if (removedPlaceholder && primaryPromptRunController.activeAssistantMessageId) {
    sendPanelMessage({ type: "removeMessage", id: primaryPromptRunController.activeAssistantMessageId });
  }
  persistActiveMessages();
  clearActiveRun();
}

function clearActiveRun(): void {
  if (primaryPromptRunController.activeCliForRun === "opencode" && primaryPromptRunController.activeTabIdForRun) {
    latestOpenCodeTaskListByTabId.delete(primaryPromptRunController.activeTabIdForRun);
  }
  restoreProcessTitle();
  primaryPromptRunController.clear();
  resetTraceLineFilterState(activeTraceLineFilterState);
  if (pendingWorkspaceKey && !hasAnyTaskRunning()) {
    const nextKey = pendingWorkspaceKey;
    pendingWorkspaceKey = null;
    applyWorkspaceSessionStore(nextKey);
    void postPanelState();
  }
}

function removeActiveAssistantPlaceholder(): boolean {
  if (!primaryPromptRunController.activeMessageTarget || primaryPromptRunController.activeMessageIndex === null) {
    return false;
  }
  const message = primaryPromptRunController.activeMessageTarget[primaryPromptRunController.activeMessageIndex];
  if (!message || message.role !== "assistant") {
    return false;
  }
  if (message.content.trim()) {
    return false;
  }
  primaryPromptRunController.activeMessageTarget.splice(primaryPromptRunController.activeMessageIndex, 1);
  primaryPromptRunController.activeMessageIndex = primaryPromptRunController.activeMessageTarget.length ? primaryPromptRunController.activeMessageTarget.length - 1 : null;
  return true;
}

function appendStopMessageToStore(): void {
  if (!primaryPromptRunController.activeMessageTarget) {
    return;
  }
  appendMessageToStore(primaryPromptRunController.activeMessageTarget, {
    id: createMessageId(),
    role: "system",
    content: t("run.stoppedByUser"),
    createdAt: Date.now(),
  });
}

function normalizeAssistantKind(kind?: ChatMessage["kind"]): "thinking" | "normal" {
  return kind === "thinking" ? "thinking" : "normal";
}

function hasSameAssistantKind(message: ChatMessage | undefined, kind?: ChatMessage["kind"]): boolean {
  return normalizeAssistantKind(message?.kind) === normalizeAssistantKind(kind);
}

function appendAssistantChunk(chunk: string, kind?: ChatMessage["kind"]): void {
  ensureAssistantMessage(kind);
  if (!primaryPromptRunController.activeAssistantMessageId) {
    return;
  }
  void logDebug("assistant-chunk", {
    id: primaryPromptRunController.activeAssistantMessageId,
    size: chunk.length,
    kind: kind ?? "normal",
  });
  sendPanelMessage({
    type: "assistantDelta",
    id: primaryPromptRunController.activeAssistantMessageId,
    content: chunk,
    kind,
  });
  appendAssistantChunkToStore(primaryPromptRunController.activeMessageTarget, primaryPromptRunController.activeMessageIndex, chunk, kind);
}

function ensureAssistantMessage(kind?: ChatMessage["kind"]): void {
  if (!primaryPromptRunController.activeMessageTarget) {
    return;
  }
  const last = primaryPromptRunController.activeMessageTarget[primaryPromptRunController.activeMessageTarget.length - 1];
  if (
    primaryPromptRunController.activeAssistantMessageId &&
    last &&
    last.role === "assistant" &&
    last.id === primaryPromptRunController.activeAssistantMessageId &&
    hasSameAssistantKind(last, kind)
  ) {
    return;
  }
  const assistantId = createMessageId();
  primaryPromptRunController.activeAssistantMessageId = assistantId;
  const message: ChatMessage = {
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    ...(kind === "thinking" ? { kind: "thinking" } : {}),
    taskRole: primaryPromptRunController.activeTaskRun?.taskRole,
    loopTaskId: primaryPromptRunController.activeTaskRun?.loopTaskId,
    loopRound: primaryPromptRunController.activeTaskRun?.loopRound,
    loopSubtaskId: primaryPromptRunController.activeTaskRun?.loopSubtaskId,
    loopAttemptId: primaryPromptRunController.activeTaskRun?.loopAttemptId,
  };
  appendMessageToStore(primaryPromptRunController.activeMessageTarget, message);
  primaryPromptRunController.activeMessageIndex = primaryPromptRunController.activeMessageTarget.length - 1;
  sendPanelMessage({
    type: "appendMessage",
    message,
  });
}

function startTraceMessage(cli: CliName): void {
  if (cli !== "codex" && cli !== "opencode") {
    primaryPromptRunController.activeTraceMessageId = undefined;
    return;
  }
  primaryPromptRunController.activeTraceMessageId = createMessageId();
}

function appendTraceLines(chunk: string): void {
  if (!primaryPromptRunController.activeTraceMessageId) {
    return;
  }
  if (primaryPromptRunController.activeCompletionSent) {
    return;
  }
  const normalized = chunk.replace(/\r\n/g, "\n");
  const combined = primaryPromptRunController.activeTraceBuffer + normalized;
  const lines = combined.split("\n");
  primaryPromptRunController.activeTraceBuffer = lines.pop() ?? "";
  lines.forEach((line) => {
    if (shouldIgnoreTraceLine(activeTraceLineFilterState, line, primaryPromptRunController.activeTraceSegmentLines.length > 0, primaryPromptRunController.activeCliForRun)) {
      return;
    }
    if (isTraceSegmentStart(line) && primaryPromptRunController.activeTraceSegmentLines.length) {
      flushTraceSegment();
    }
    primaryPromptRunController.activeTraceSegmentLines.push(line);
  });
}

function flushTraceBuffer(): void {
  if (!primaryPromptRunController.activeTraceMessageId) {
    return;
  }
  const line = primaryPromptRunController.activeTraceBuffer.trim();
  if (line && !shouldIgnoreTraceLine(activeTraceLineFilterState, line, primaryPromptRunController.activeTraceSegmentLines.length > 0, primaryPromptRunController.activeCliForRun)) {
    primaryPromptRunController.activeTraceSegmentLines.push(line);
  }
  flushTraceSegment();
  primaryPromptRunController.activeTraceBuffer = "";
}

function flushTraceSegment(): void {
  if (!primaryPromptRunController.activeTraceMessageId) {
    return;
  }
  if (!primaryPromptRunController.activeTraceSegmentLines.length) {
    return;
  }
  const content = primaryPromptRunController.activeTraceSegmentLines.join("\n");
  const { content: execDisplayContent, shouldPersist: execShouldPersist } =
    formatCodexExecSegmentForDisplay(content, primaryPromptRunController.activeCliForRun);
  const { content: displayContent, shouldPersist } = formatTraceSegmentForDisplay(
    execDisplayContent,
    primaryPromptRunController.activeCliForRun
  );
  const kind = getTraceSegmentKind(displayContent);
  if (kind === "thinking") {
    primaryPromptRunController.activeTraceSegmentLines = [];
    appendAssistantChunk(`${displayContent}\n`, "thinking");
    return;
  }
  const shouldMerge = resolveTraceMerge(displayContent);
  const mergePayload = shouldMerge ? {} : { merge: false };
  const message: ChatMessage = {
    id: createMessageId(),
    role: "trace",
    content: displayContent,
    createdAt: Date.now(),
    kind,
    ...mergePayload,
  };
  primaryPromptRunController.activeTraceSegmentLines = [];
  if (primaryPromptRunController.activeMessageTarget && shouldPersist && execShouldPersist) {
    appendMessageToStore(primaryPromptRunController.activeMessageTarget, message);
  }
  sendPanelMessage({
    type: "traceSegment",
    id: message.id,
    createdAt: message.createdAt,
    sequence: message.sequence,
    content: message.content,
    kind,
    ...mergePayload,
  });
}

function startTaskRun(
  runId: string,
  cli: CliName,
  sessionId: string | null,
  prompt: string,
  options: { taskRole?: LoopTaskRole; loopTaskId?: string; loopRound?: number; loopSubtaskId?: string; loopAttemptId?: string } = {}
): void {
  primaryPromptRunController.activeTaskRun = {
    id: runId,
    cli,
    sessionId,
    prompt,
    startedAt: Date.now(),
    taskRole: options.taskRole,
    loopTaskId: options.loopTaskId,
    loopRound: options.loopRound,
    loopSubtaskId: options.loopSubtaskId,
    loopAttemptId: options.loopAttemptId,
  };
}

function appendCompletionMessage(status: TaskRunStatus, options: { notifyCompletion?: boolean; failureDetail?: string } = {}): void {
  if (primaryPromptRunController.activeCompletionSent) {
    return;
  }
  const taskRecord = finalizeTaskRun(primaryPromptRunController.activeRunId, status, options);
  const message = {
    id: createMessageId(),
    role: "system" as const,
    content: buildTaskRunCompletionText(status, taskRecord?.durationMs ?? null, taskRecord ?? undefined),
    createdAt: Date.now(),
  };
  primaryPromptRunController.activeCompletionSent = true;
  if (!primaryPromptRunController.activeMessageTarget) {
    return;
  }
  appendMessageToStore(primaryPromptRunController.activeMessageTarget, message);
  sendPanelMessage({ type: "appendMessage", message });
}

function sendRunStatus(
  status: "start" | "end" | "error" | "stopped",
  message?: string,
  options: { activity?: RunActivity } = {}
): void {
  if (status === "start") {
    markConversationTabRunStarted(primaryPromptRunController.activeTabIdForRun);
    clearTaskListForRunStart(primaryPromptRunController.activeTabIdForRun);
  } else if (primaryPromptRunController.activeCliForRun === "opencode" && primaryPromptRunController.activeTabIdForRun) {
    latestOpenCodeTaskListByTabId.delete(primaryPromptRunController.activeTabIdForRun);
  }
  sendPanelMessage({
    type: "runStatus",
    status,
    message,
    prompt: status === "start" ? primaryPromptRunController.activeTaskRun?.prompt : undefined,
    startedAt: status === "start" ? primaryPromptRunController.activeTaskRun?.startedAt : undefined,
    activity: status === "start" ? options.activity : undefined,
  });
}

function buildTaskRunCompletionText(status: TaskRunStatus, durationMs?: number | null, record?: TaskRunRecord): string {
  const task = record?.loopTaskId ? readLoopTaskRecord(record.loopTaskId) : undefined;
  const loopPlus = task?.schedulingMode === "event_driven";
  const activeMessageTarget = primaryPromptRunController.activeMessageTarget;
  const isLoopPlusSubtaskEnd = loopPlus && record?.taskRole === "subtask" && record.status === "end";
  const hasFinalResponse = isLoopPlusSubtaskEnd
    ? Boolean(activeMessageTarget && selectLoopPlusContinuationDetail(activeMessageTarget, record!, {
      taskId: record.loopTaskId!,
      round: record.loopRound ?? 1,
      role: "subtask",
      subtaskId: record.loopSubtaskId ?? "",
      attemptId: record.loopAttemptId,
    })?.trim())
    : true;
  let requiresAcceptance: boolean | undefined;
  if (loopPlus && record?.taskRole === "subtask" && record.loopAttemptId) {
    try {
      requiresAcceptance = createLoopPlusScheduler({ snapshot: task.loopPlus }).snapshot().seenAttempts
        .find((attempt) => attempt.attemptId === record.loopAttemptId && attempt.subtaskId === record.loopSubtaskId)
        ?.requiresAcceptance;
    } catch {
      // 无法核对本次 attempt 时保留默认验收文案，不沿用其它 attempt 的免验收标记。
    }
  }
  const displayStatus = loopPlus && record?.taskRole === "subtask" && status === "end" && !hasFinalResponse
    ? "error"
    : status;
  return buildTaskRunCompletionTextWithLabels(displayStatus, durationMs, {
    failed: t("run.failed"),
    stopped: t("run.stopped"),
    completed: t("run.completed"),
    failedWithDuration: (duration) => t("run.failedWithDuration", { duration }),
    stoppedWithDuration: (duration) => t("run.stoppedWithDuration", { duration }),
    completedWithDuration: (duration) => t("run.completedWithDuration", { duration }),
    loopMain: "本轮调度已结束，整体任务状态以 Loop+ 主任务为准。",
    loopMainWithDuration: (duration) => `本轮调度已结束，用时 ${duration}；整体任务状态以 Loop+ 主任务为准。`,
    loopSubtask: "子任务执行结束，等待主任务验收。",
    loopSubtaskWithDuration: (duration) => `子任务执行结束，用时 ${duration}，等待主任务验收。`,
    loopSubtaskNoAcceptance: "子任务执行结束，无需验收。",
    loopSubtaskNoAcceptanceWithDuration: (duration) => `子任务执行结束，用时 ${duration}，无需验收。`,
    loopSubtaskInterrupted: "任务中断，等待主任务重新派发。",
    loopSubtaskInterruptedWithDuration: (duration) => `任务中断，用时 ${duration}，等待主任务重新派发。`,
  }, { loopPlus, taskRole: record?.taskRole, requiresAcceptance });
}

function sendRawStreamDelta(
  content: unknown,
  options: { stream?: "stdout" | "stderr" | "event"; appendNewline?: boolean } = {}
): void {
  let normalized = normalizeRawStreamContent(content);
  if (!normalized) {
    return;
  }
  if (options.appendNewline && !normalized.endsWith("\n")) {
    normalized += "\n";
  }
  sendPanelMessage({
    type: "rawStreamDelta",
    content: normalized,
    stream: options.stream ?? "stdout",
  });
}

function sendPanelMessage(payload: Record<string, unknown>): void {
  sendPanelMessageWithActiveTab(payload, primaryPromptRunController.activeTabIdForRun, (message) => viewProvider?.postMessage(message));
}

function finalizeTaskRun(runId: string | undefined, status: TaskRunStatus, options: { notifyCompletion?: boolean; failureDetail?: string } = {}): TaskRunRecord | null {
  if (!runId || !primaryPromptRunController.activeTaskRun || primaryPromptRunController.activeTaskRun.id !== runId) {
    return null;
  }
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - primaryPromptRunController.activeTaskRun.startedAt);
  const record: TaskRunRecord = {
    ...primaryPromptRunController.activeTaskRun,
    endedAt,
    durationMs,
    status,
    ...(status === "error" && primaryPromptRunController.activeTaskRun.taskRole === "subtask" && options.failureDetail
      ? { failureDetail: normalizeLoopSubtaskFailure(options.failureDetail) } : {}),
  };
  primaryPromptRunController.activeTaskRun = null;
  appendTaskRun(record, options);
  return record;
}

function appendTaskRun(record: TaskRunRecord, options: { notifyCompletion?: boolean } = {}): void {
  taskRunCompletionEmitter.fire(record);
  const store = readTaskStore();
  store.runs.push(record);
  writeTaskStore(store);
  if (options.notifyCompletion !== false) {
    notifyTaskRunCompletion(humanInteractionAttention, record, hasPendingPromptQueue);
  }
}

function getTaskStoreDeps() {
  return {
    taskStoreFile: TASK_STORE_FILE,
    isCliName,
    isLoopTaskRole,
    isTimestampWithinHistoryRetention,
    logError: (event: string, payload?: unknown) => void logError(event, payload),
  };
}

function readTaskStore(): TaskStore {
  return readTaskStoreWithDeps(getTaskStoreDeps());
}

function writeTaskStore(store: TaskStore): void {
  writeTaskStoreWithDeps(store, getTaskStoreDeps());
}

function cleanupTaskStoreRetention(): void {
  cleanupTaskStoreRetentionWithDeps(getTaskStoreDeps());
}

function createLoopTaskRecord(
  cli: CliName,
  rootPrompt: string,
  options: {
    sessionId?: string | null;
    /** Assemble a complete owned record without publishing an ordinary intermediate task. */
    buildOnly?: boolean;
  } = {}
): LoopTaskRecord {
  const now = Date.now();
  const id = createMessageId();
  const communication = getLoopCommunicationPaths(id);
  const sessionId = typeof options.sessionId === "string" && options.sessionId.trim()
    ? options.sessionId
    : null;
  const taskStoreFile = buildLoopTaskStoreFile(cli, activeWorkspaceKey, sessionId, id);
  if (!options.buildOnly) ensureLoopCommunicationFiles(id, rootPrompt);
  const record: LoopTaskRecord = {
    id,
    cli,
    workspaceKey: activeWorkspaceKey,
    taskStoreFile,
    rootPrompt,
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: LOOP_DEFAULT_MAX_ROUNDS,
    currentRound: 0,
    communicationDir: communication.dir,
    mainCommunicationFile: communication.mainFile,
    sessionId,
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    ...buildResetLoopMainAiFailureState(),
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
  if (options.buildOnly) return record;
  appendLoopTaskRecord(taskStoreFile, record);
  return record;
}


function attachPendingMessages(cli: CliName, tabId: string, sessionId: string): void {
  sessionLifecycleController.attachPendingMessages(cli, tabId, sessionId);
}

function getSessionStoreKey(workspaceKey: string = activeWorkspaceKey): string {
  return `${SESSION_STORE_KEY}:${workspaceKey}`;
}

function getSessionMetaFilePath(workspaceKey: string = activeWorkspaceKey): string {
  if (workspaceKey === WORKSPACE_KEY_FALLBACK) {
    return path.join(DATA_DIR, "sessions.meta.json");
  }
  return path.join(SESSION_DIR, `${workspaceKey}.meta.json`);
}

function readSessionMetaStore(workspaceKey: string = activeWorkspaceKey): ReturnType<typeof readSessionMeta> {
  return readSessionMeta(getSessionMetaFilePath(workspaceKey));
}

function writeSessionMetaStore(
  meta: ReturnType<typeof readSessionMeta>,
  workspaceKey: string = activeWorkspaceKey
): void {
  writeSessionMeta(getSessionMetaFilePath(workspaceKey), meta);
}

function replaceConversationTabSessionReferences(
  cli: CliName,
  fromSessionId: string,
  toSessionId: string,
): void {
  sessionLifecycleController.replaceConversationTabSessionReferences(cli, fromSessionId, toSessionId);
}

function deleteSessionMessageArtifacts(cli: CliName, sessionId: string): void {
  sessionLifecycleController.deleteSessionMessageArtifacts(cli, sessionId);
}

function migrateLocalSessionToTargetSession(
  cli: CliName,
  localSessionId: string,
  targetSessionId: string,
  options: { notifyPanel?: boolean } = {}
): void {
  const promotion = departmentLeaderSessionPromotionDeps();
  const context = promotion.readContext(cli, localSessionId);
  const task = context.taskRole === "main" && context.loopTaskId ? readLoopTaskRecord(context.loopTaskId) : null;
  const leader = task?.status === "running" && task.cli === cli && task.sessionId === localSessionId
    && canPromoteDepartmentLeaderSession(task, targetSessionId, promotion.workspaceKey) ? task : null;
  const targetContext = leader && promotion.readContext(cli, targetSessionId);
  sessionLifecycleController.migrateLocalSessionToTargetSession(cli, localSessionId, targetSessionId, options);
  if (leader && targetContext && ((targetContext.loopTaskId && !isDepartmentLeaderMainContext(targetContext, leader.id))
    || !commitDepartmentLeaderSessionPromotion(leader, targetSessionId, promotion))) {
    void logError("department-leader-session-promotion-unconfirmed", { taskId: leader.id });
  }
}

function findSupersedingLocalSessionTarget(cli: CliName, sessionId: string): string | null {
  return sessionLifecycleController.findSupersedingLocalSessionTarget(cli, sessionId);
}

function repairSupersededLocalSession(cli: CliName, sessionId: string, options: SessionPromotionOptions = {}): string {
  return sessionLifecycleController.repairSupersededLocalSession(cli, sessionId, options);
}

function repairSupersededLocalSessions(options: SessionPromotionOptions = {}): void {
  sessionLifecycleController.repairSupersededLocalSessions(options);
}

function resolveInteractiveMappedId(cli: CliName, sessionId: string): string | null {
  return sessionLifecycleController.resolveInteractiveMappedId(cli, sessionId);
}

function resolveCodexInteractiveSelection(sessionId: string): CodexRunSelection | null {
  return sessionLifecycleController.resolveCodexInteractiveSelection(sessionId);
}

function upsertInteractiveMapping(
  cli: CliName,
  sessionId: string,
  mappedId: string,
  options: { freezePrevious?: string; codexSelection?: CodexRunSelection | null } = {}
): void {
  sessionLifecycleController.upsertInteractiveMapping(cli, sessionId, mappedId, options);
}

function deleteInteractiveMapping(cli: CliName, sessionId: string): void {
  sessionLifecycleController.deleteInteractiveMapping(cli, sessionId);
}

function loadSessionMessages(cli: CliName, sessionId: string): ChatMessage[] {
  return sessionLifecycleController.loadSessionMessages(cli, sessionId);
}

function saveSessionMessages(cli: CliName, sessionId: string, messages: ChatMessage[]): void {
  sessionLifecycleController.saveSessionMessages(cli, sessionId, messages);
}

function sendSessionLoadErrorToPanel(
  cli: CliName,
  sessionId: string | null,
  detail: string,
  tabId: string | null
): void {
  sessionLifecycleController.sendSessionLoadErrorToPanel(cli, sessionId, detail, tabId);
}

function sendSessionMessagesToPanel(
  cli: CliName,
  sessionId: string | null,
  tabId: string | null = getActiveConversationTabId()
): void {
  sessionLifecycleController.sendSessionMessagesToPanel(cli, sessionId, tabId);
}

function deleteSession(cli: CliName, sessionId: string): void {
  sessionLifecycleController.deleteSession(cli, sessionId);
}

function clearAllSessions(): void {
  sessionLifecycleController.clearAllSessions();
}

function applyProcessTitle(runId: string, cli: CliName, sessionId: string | null): void {
  sessionLifecycleController.applyProcessTitle(runId, cli, sessionId);
}

function updateProcessTitle(cli: CliName, sessionId: string): void {
  sessionLifecycleController.updateProcessTitle(cli, sessionId);
}

function restoreProcessTitle(): void {
  sessionLifecycleController.restoreProcessTitle();
}

function syncPendingDraftMessagesForSessionAdoption(cli: CliName, tabId: string | null): void {
  sessionLifecycleController.syncPendingDraftMessagesForSessionAdoption(cli, tabId);
}

function adoptSessionId(cli: CliName, sessionId: string, tabId: string | null = null): void {
  sessionLifecycleController.adoptSessionId(cli, sessionId, tabId);
}

function isPathWithinWorkspace(targetPath: string, workspacePath: string): boolean {
  if (!targetPath || !workspacePath) {
    return false;
  }
  const relativePath = path.relative(workspacePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveWorkspaceCwd(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const folderPaths = workspaceFolders
    .map((folder) => folder?.uri?.fsPath)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const activeEditorPath = (() => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      return "";
    }
    return editor.document.uri.fsPath;
  })();

  if (activeEditorPath) {
    const matchedWorkspace = folderPaths.find((workspacePath) =>
      isPathWithinWorkspace(activeEditorPath, workspacePath)
    );
    if (matchedWorkspace) {
      lastResolvedWorkspaceCwd = matchedWorkspace;
      return matchedWorkspace;
    }
  }

  if (folderPaths.length > 0) {
    lastResolvedWorkspaceCwd = folderPaths[0];
    return folderPaths[0];
  }

  if (activeEditorPath) {
    const activeEditorDir = path.dirname(activeEditorPath);
    lastResolvedWorkspaceCwd = activeEditorDir;
    return activeEditorDir;
  }

  if (lastResolvedWorkspaceCwd) {
    return lastResolvedWorkspaceCwd;
  }

  return undefined;
}

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
