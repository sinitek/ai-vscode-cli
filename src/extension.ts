import * as vscode from "vscode";
import { formatOrchestratorClarificationAnswer, loopClarificationScope, waitForOrchestratorClarification } from "./orchestratorClarification";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
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
import { GraphRunPanel } from "./webview/graphRunPanel";
import { buildWorkspacePathItems, removeScheduledTaskAttachments, saveScheduledTaskAttachments, startTempCleanup } from "./webview/panelFileActions";
import { ChatMessage, ChatMessageAction, PanelMessage, PanelState, ScheduledTaskRecord } from "./webview/types";
import { initLogger, logDebug, logEssential, logError, logInfo, scheduleLogRetentionCleanup, setDebugLogging } from "./logger";
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
import { buildResetLoopMainAiFailureState } from "./loopMainFailure";
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
} from "./loopSubtaskExecutionRoot";
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
import { appendLoopRound, bindLoopTaskToSession, bindLoopTaskToRuntimeTarget, buildLoopTaskStoreFile, buildLoopSubtaskCommunicationFile, cleanupLoopCommunicationRetention, cleanupLoopTaskStoreRetention, ensureLoopCommunicationFiles, ensureLoopTaskMaxRoundsAtLeast, getLoopCommunicationPaths, listLoopTaskStoreFiles, prepareLoopSubtaskCommunicationFile, readLoopTaskRecord, readLoopTaskStore, normalizeLoopTaskOriginProfile, updateLoopTaskRecord, writeLoopTaskStore, type LoopTaskRecord } from "./loopTaskStore";
import { resolveLoopPlusMaxAcceptances } from "./loopPlusDecision";
import { loopModelRoutingFromPromptInput } from "./continueModelChoice";
import { getSelectedLoopFrontendThinkingFromStore, getSelectedLoopFullstackThinkingFromStore } from "./modelSelectionStore";
import { readLoopSubtaskModeField } from "./loopPlusSubtaskMode";
import { parseCliName, planBoundSubtaskConfigApply } from "./subtaskCliRoute";
import { createLoopOrchestrationOwnershipTracker } from "./loopOrchestrationOwnership";
import {
  LoopMainAutoCompactFlights,
  mergeCompactTranscriptIntoLive,
  settleAutoCompactAfterPrompt,
  type LoopMainAutoCompactReservation,
} from "./loopMainAutoCompact";
import { readGraphRunRecord } from "./graph/graphStore";
import type { GraphRunControlSource } from "./graph/graphRunControl";
import type { GraphAutoWakeAttemptResult } from "./graph/graphAutoWake";
import {
  type GraphModelRole,
  type GraphNodeRecord,
  type GraphRunModelRoutingRecord,
  type GraphRunRecord,
} from "./graph/types";
import {
  isCliEnabled,
  listEnabledClis,
  readHumanInteractionTimeoutMs,
  readToolSettings,
  resolveGlobalAutoCompactContextAfterRun,
  resolveGlobalHumanInteractionEnabled,
  resolveHumanInteractionTimeoutMinutes,
  resolveNextEnabledCli,
  type ToolSettingsState,
  writeToolSettings,
} from "./toolSettings";
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
} from "./sessionLifecycle";
import { countStoreModels, createEmptyModelSelectionStoreState, getManagedModelOptionsForConfigFromStore, getLoopModelOptionsForCliFromStore, getModelOptionsForConfigFromStore, getOpenCodeRoleVariantFromStore, normalizeCliModelName, summarizeModelStoreByConfigId, type CliModelStore } from "./modelSelectionStore";
import { createGraphControlsHost, type GraphControlsHost } from "./extensionHost/graphControls";
import {
  createLoopPlusPersistedTaskRefresher,
  createPromptRunRuntimeHost,
  shouldCloseLoopPlusParentGateBeforeAbort,
} from "./extensionHost/promptRunRuntime";
import { createPromptParallelRuntimeHost } from "./extensionHost/promptParallelRuntime";
import { createPromptInteractiveRuntimeHost } from "./extensionHost/promptInteractiveRuntime";
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
  LOOP_PARALLEL_SUBTASK_MAX,
  LOOP_SUBTASK_RETRY_MAX_RETRIES,
} from "./extensionHost/loopOrchestration";
import { createLoopPlusRuntimeAdapter, selectLoopPlusContinuationDetail } from "./extensionHost/loopPlusRuntimeAdapter";
import {
  buildLoopPlusGroupChatSection,
  buildLoopPlusSubtaskParentMessage,
  type LoopPlusSubtaskChatNotice,
} from "./extensionHost/loopPlusSubtaskChat";
import { createModelSettingsHost, schedulingModeForInteractiveMode } from "./extensionHost/modelSettings";
import { createExtensionSessionTabsHost } from "./extensionHost/sessionTabs";
import { createGraphMessagesHost, type GraphRuntimeMessageKey } from "./extensionHost/graphMessages";
import {
  createGraphRuntimeHost,
  type GraphRuntimeHost,
  type PromptRunInput,
  type PromptRunTarget,
} from "./extensionHost/graphRuntime";
import { createPrimaryPromptRunController } from "./extensionHost/primaryPromptRunController";
import { trySaveWorkspaceSettings as trySaveWorkspaceSettingsToStore, type WorkspaceSettings } from "./workspaceSettingsStore";
import { normalizeLoopPlusAcceptancePlanSnapshotForStorage } from "./loopPlusAcceptancePlan";
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
import { buildEditorContextState, buildLoopMainResumeText, buildLoopSubtaskBatchCompletedText, buildLoopSubtaskBatchStartedText, buildLoopSubtaskExecutionGroupStartedText, buildLoopSubtaskRetryText as buildLoopSubtaskRetryTextWithLimit, buildLoopSubtaskStartedText, buildLoopTaskCompletedText, buildLoopTaskNeedsReviewText as buildLoopTaskNeedsReviewTextWithLimit, buildLoopTaskResumedText, buildLoopTaskStartedText, buildPanelStateWithDeps, buildSessionLabelFromPrompt, buildUserChatMessage, ensureLoopMainSubChatTranscriptWithDeps, formatLoopEstimatedRemainingRounds, buildPromptWithAutoContext as buildPromptWithAutoContextFromPanelStateBuilder, getLatestAssistantResponseForLongTermMemory, getLoopMainSubChatMainTitle, getLoopSubtaskDisplayTitle, isCliName, maybeInjectLongTermMemoryForPromptWithEditorContext, normalizeLoopTaskId, resolveLoopConversationTabContextFromMessages, resolveLoopRunConversationTabContext, shouldUseFallbackSessionLabel as shouldUseFallbackSessionLabelWithSet, type LoopConversationTabContext } from "./panelStateBuilder";
import { appendHiddenRetryErrorTraceMessage, buildHiddenRetryLimitMessage, buildHiddenRetryQueuedMessage, buildHiddenRetryStartedMessage, createLoopGroupChatPanelCoordinator, createPanelDiagnosticsInspector, getAttemptFailureMessage, getErrorInfo, HIDDEN_RETRY_MAX_RETRIES, isAbortErrorInfo, isHiddenRetryEligibleAttempt, isLoopResumePrompt, normalizeLoopResumePrompt, waitForHiddenRetryDelay } from "./panelDiagnostics";
import { buildCliCommandNotFoundMessage, buildCodexImageSupportWarningKey, buildLoopCompletedConclusionAndSummaryMarkdown, buildLoopRoundSummary, buildLoopSupplementalRequirementsLines, createConfigHeartbeatCoordinator, getWorkspacePreferredConfigIdForCli as getWorkspacePreferredConfigIdForCliFromSettings, loadConfigStateWithDeps, loadConfigStateByCli, normalizeCliInstallStatus, normalizeLoopSupplementalRequirement, probeCodexImageSupportStatus, resolveLoopResumeRound, resolveModelConfigIdForCli as resolveModelConfigIdForCliFromConfigState, type CodexImageSupportStatus } from "./webviewCommandCoordinator";
import { type PromptHistoryStore } from "./promptHistoryStore";
import { appendAssistantChunkToStore, appendMessageToStore, buildTaskRunCompletionText as buildTaskRunCompletionTextWithLabels, cleanupTaskStoreRetention as cleanupTaskStoreRetentionWithDeps, isInteractiveMode, isLoopTaskRole, isMacTaskShell, isThinkingMode, isLoopTaskCompleted, normalizeVisibleInteractiveMode, normalizeRawStreamContent, readTaskStore as readTaskStoreWithDeps, sendPanelMessageWithActiveTab, writeTaskStore as writeTaskStoreWithDeps, type LoopTaskRole, type RunActivity, type TaskRunRecord, type TaskRunStatus, type TaskStore } from "./promptRunState";
let currentCli: CliName;
let statusBarItem: vscode.StatusBarItem | undefined;
let extensionUri: vscode.Uri;
let viewProvider: CliBridgeViewProvider | undefined;
let interactiveRunnerManager: InteractiveRunnerManager;
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
const graphRunPanelsByRunId = new Map<string, GraphRunPanel>();
let activeWorkspaceKey: string;
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
const sessionMessageCache = new Map<string, ChatMessage[]>();
const sessionMessageLoadErrors = new Map<string, string>();
const parallelRunsByTabId = new Map<string, ParallelTabRun>();
const interactiveRunsByTabId = new Map<string, InteractiveTabRun>();
const promptAutoRepairController = createPromptAutoRepairController();
let isExtensionDeactivating = false;
const graphNodeRunTargetsByTabId = new Map<string, { graphRunId: string; graphNodeId: string }>();
const loopOrchestrationOwnership = createLoopOrchestrationOwnershipTracker();
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
  graphRunId?: string;
  graphNodeId?: string;
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
function initializeSessionControllers(): void {
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
    logError: (event, payload) => void logError(event, payload),
  });
}
export function activate(context: vscode.ExtensionContext): void {
  isExtensionDeactivating = false;
  extensionContext = context;
  extensionUri = context.extensionUri;
  interactiveRunnerManager = new InteractiveRunnerManager();
  void maybeDisableMarketplaceUpdateCheckInDev(context);
  activeWorkspaceKey = buildWorkspaceKey(resolveWorkspaceCwd());
  migrateLegacyToolSettingsFromVsCodeConfig();
  beginCliCommandAutoRepair(autoRepairUnresolvedCliCommands());
  initializeSessionControllers();
  sessionStore = loadSessionStore();
  promptHistoryStore = loadPromptHistoryStore();
  workspaceSettings = loadWorkspaceSettings();
  migrateLegacyAutoCompactContextAfterRunFromWorkspace();
  // Restore currentCli from workspace settings, or use default
  currentCli = workspaceSettings.currentCli || getDefaultCli();
  modelStore = loadModelStore();
  initializeConversationTabsFromWorkspaceSettings();
  repairSupersededLocalSessions({ notifyPanel: false });
  syncCurrentSessionWithActiveTab();
  ensureCurrentCliIsEnabled();
  initializeGraphAutoWakeScheduler(context);
  void initLogger().then(() => {
    scheduleLogRetentionCleanup();
  });
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
  startConfigHeartbeat(context);
  void refreshCliInstallStatuses();
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "sinitek-cli-tools.openPanel";
  updateStatusBar();
  statusBarItem.show();
  viewProvider = new CliBridgeViewProvider(extensionUri, {
    onMessage: async (message) => {
      await handlePanelMessage(message);
    },
    onRequestHumanInteractionHistory: () => readHumanInteractionHistory(getHumanInteractionHistoryOptions()),
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
      restoreGraphAutoWakeSchedules();
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
export function deactivate(): void {
  isExtensionDeactivating = true;
  void restoreMarketplaceUpdateCheck();
  scheduledTaskScheduler?.stop();
  scheduledTaskScheduler = null;
  graphControlsHost.disposeGraphAutoWakeScheduler();
  stopAllRuns();
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

function createWorkspaceLoopSubtaskExecutionRoot(workspaceCwd: string) {
  try {
    return createLoopSubtaskExecutionRoot(workspaceCwd);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(t("run.loopSubtaskExecutionRootFailed", {
      name: isLoopSubtaskLinkFailedError(error) ? error.entryName : "workspace",
      detail,
    }));
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
  const store = readScheduledTasks();
  const activeTaskCount = store.tasks.filter((task) => task.status === "pending" || task.status === "running").length;
  if (activeTaskCount >= SCHEDULED_TASK_MAX_COUNT) {
    return { error: t("scheduledTaskLimitReached", { max: SCHEDULED_TASK_MAX_COUNT }) };
  }
  const cli = typeof message.cli === "string" && isCliName(message.cli) ? message.cli : currentCli;
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
      interactiveMode: isInteractiveMode(message.interactiveMode)
        ? normalizeVisibleInteractiveMode(message.interactiveMode)
        : getWorkspaceInteractiveMode(cli),
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
  const targetTabId = ensureScheduledTaskTargetTab(task);
  if (!targetTabId) {
    throw new Error("No conversation tab is available for the scheduled task.");
  }
  await configApplyQueue.waitForIdle(task.cli);
  const executionConfig = resolveScheduledTaskExecutionConfigForTask(
    task,
    getWorkspaceInteractiveMode(task.cli),
  );
  const displayPrompt = buildScheduledAttachmentPrompt(task);
  const contextBuild = buildPromptWithAutoContextFromPanelStateBuilder(displayPrompt, task.contextOptions);
  const modelPrompt = executionConfig.interactiveMode === "graph"
    ? contextBuild.modelPrompt
    : maybeInjectLongTermMemoryForPromptWithEditorContext(
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
  const input: PromptRunInput = {
    displayPrompt,
    modelPrompt,
    contextTags: contextBuild.contextTags,
    ...(task.model ? { model: task.model } : {}),
    ...(task.loopMainModel ? { loopMainModel: task.loopMainModel } : {}),
    ...(task.loopSubtaskModel ? { loopSubtaskModel: task.loopSubtaskModel } : {}),
    ...(task.loopSubtaskCli ? { loopSubtaskCli: task.loopSubtaskCli } : {}),
    ...(task.loopSubtaskConfigId ? { loopSubtaskConfigId: task.loopSubtaskConfigId } : {}),
    ...(task.loopMainThinkingMode ? { loopMainThinkingMode: task.loopMainThinkingMode } : {}),
    ...(task.loopSubtaskThinkingMode ? { loopSubtaskThinkingMode: task.loopSubtaskThinkingMode } : {}),
    ...(imagePaths.length ? { imagePaths } : {}),
    ...(executionConfig.interactiveMode === "graph" ? { skipLongTermMemoryPersist: true } : {}),
    throwOnError: true,
  };
  const target = resolvePromptRunTarget(targetTabId);
  if (!target) {
    throw new Error("Scheduled task conversation target is unavailable.");
  }
  const preparedInput = preloadUserMessageForPrompt(input, target);
  if (executionConfig.interactiveMode === "loop" || executionConfig.interactiveMode === "loop_plus") {
    const loopPlusSchedulingMode = schedulingModeForInteractiveMode(executionConfig.interactiveMode);
    await runLoopPrompt(preparedInput, {
      targetTabId,
      resumeTaskId: null,
      resumeRequested: false,
      ...(loopPlusSchedulingMode ? { schedulingMode: loopPlusSchedulingMode } : {}),
    });
  } else if (executionConfig.interactiveMode === "graph") {
    await runGraphPrompt(preparedInput, { targetTabId });
  } else {
    await runPrompt(preparedInput, { targetTabId });
  }
}

async function handlePanelMessage(message: PanelMessage): Promise<void> {
  await handlePanelMessageWithDeps(message, {
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
    closeConversationTabAndRefreshPanel,
    confirm: async (messageText, confirmLabel) => {
      const confirmed = await vscode.window.showWarningMessage(messageText, { modal: true }, confirmLabel);
      return confirmed === confirmLabel;
    },
    disposeInteractiveRunnerSession: (cli, sessionId) => interactiveRunnerManager?.disposeIfMatches(cli, sessionId),
    deleteSession,
    detachConversationTabsFromSession,
    loadSessionMessages,
    getSessionLoadError: (cli, sessionId) => sessionMessageLoadErrors.get(getSessionKey(activeWorkspaceKey, cli, sessionId)),
    postWebviewMessage: (payload) => viewProvider?.postMessage(payload),
    clearAllSessions,
    clearPromptHistory,
    setPromptHistoryFavorite,
    setWorkspaceInteractiveModeForCli,
    resetConversationTabSession,
    getConfigManagerPanel: () => configManagerPanel,
    applyConfigById,
    waitForConfigApply: (cli) => configApplyQueue.waitForIdle(cli),
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
    normalizeLoopMaxRounds,
    isCliName,
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
    openGraphRunPanel,
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
    preloadUserMessageForPrompt,
    runLoopPrompt,
    runGraphPrompt,
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
      const config = await configService.getConfigById("kimi-code", configId);
      if (!config) throw new Error(t("config.notFound"));
      await configService.applyConfig("kimi-code", {
        content: config.content,
        envContent: config.envContent,
        configContent: config.configContent,
        authContent: config.authContent,
      });
    },
    commit: () => { setWorkspaceActiveConfigId("kimi-code", configId); },
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
  ensureWorkspaceSessionStore();
  const states = await loadConfigStateByCli(
    loadConfigState,
    configState ? { cli: currentCli, state: configState } : undefined,
    (cli, error) => logError("panel-cli-config-state", { cli, error: errorToMessage(error) }),
  );
  await modelSettingsHost.refreshConfigModels(states);
  await refreshOpenCodeThinkingState(states[currentCli]);
  await refreshLoopSubtaskOpenCodeModels(states.opencode);
  return buildPanelStateFromConfigState(states[currentCli], states);
}

function buildPanelStateFromConfigState(
  configState: PanelState["configState"],
  configStateByCli: PanelState["configStateByCli"],
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
    getGlobalHumanInteractionTimeoutMinutes,
    getGlobalHistoryRetentionDays: getHistoryRetentionDays,
    getGlobalLoopMaxRounds,
    getGlobalLoopPlusDecisionSubtaskMax,
    getGlobalLoopPlusMaxAcceptances,
    getGlobalLoopSubtaskMaxThinkingMode,

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
    buildConversationTabsState,
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
}

function forgetPendingHumanInteraction(interactionId: string): PendingHumanInteraction | null {
  const entry = pendingHumanInteractionsById.get(interactionId);
  if (!entry) {
    return null;
  }
  pendingHumanInteractionsById.delete(interactionId);
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

const promptRunRuntimeHost = createPromptRunRuntimeHost({ getActiveWorkspaceKey: () => activeWorkspaceKey, getConversationTabById: (tabId) => getConversationTabById(tabId), getConversationTabs: () => ensureConversationTabs().tabs, createConversationTabId: () => createConversationTabId(), persistConversationTabsToWorkspaceSettings: () => persistConversationTabsToWorkspaceSettings(), postPanelState: () => postPanelState(), loadSessionMessages: (cli, sessionId) => loadSessionMessages(cli, sessionId), persistMessagesForTab: (cli, sessionId, tabId, messages) => persistMessagesForTab(cli, sessionId, tabId, messages), getPendingSessionDraft: (tabId, cli) => getPendingSessionDraft(tabId, cli), updatePendingSessionDraft: (tabId, patch, cli) => updatePendingSessionDraft(tabId, patch, cli), sendPanelMessage: (payload) => sendPanelMessage(payload), createMessageId: () => createMessageId(), readTaskStore: () => readTaskStore(), writeTaskStore: (store) => writeTaskStore(store), appendLoopMainSubChatMainDecision: (task, decision, subtasks) => appendLoopMainSubChatMainDecision(task, decision, subtasks), buildLoopGroupChatMessageAction: (taskId, round) => buildLoopGroupChatMessageAction(taskId, round), runLoopPrompt: (input, options) => runLoopPrompt(input, options), isTabRunActive: (tabId) => isTabRunActive(tabId), refreshOpenLoopGroupChatPanelForTask: (taskId) => refreshOpenLoopGroupChatPanelForTask(taskId), resolveConversationTabLoopContext: (tab) => resolveConversationTabLoopContext(tab), resolveLoopTaskSessionId: (target) => resolveLoopTaskSessionId(target), isLoopTaskBlockedByMainAiFailureLimit: (task) => isLoopTaskBlockedByMainAiFailureLimit(task), appendLoopMainSubChatSubtaskFinished: (task, subtask, runStatus, assistantContent) => appendLoopMainSubChatSubtaskFinished(task, subtask, runStatus, assistantContent), closeConversationTabAndRefreshPanel: (tabId) => closeConversationTabAndRefreshPanel(tabId), handleLoopPlusSubtaskContinuation: (context, tabId) => handleLoopPlusSubtaskContinuation(context, tabId), stopLoopPlusParent: (taskId) => stopLoopPlusParent(taskId) });
const { resolvePromptRunTarget, collectRecentLoopTaskIdsForTarget, isLoopTaskCompatibleWithTarget, findResumableLoopTaskForTarget, getLoopMessagesForTarget, resolveLoopSubtaskConversationContext, isLoopSubtaskConversationTarget, getLastLoopAssistantContent, parseLoopMainDecision, extractJsonObjectText, normalizeLoopMainDecision, normalizeLoopEstimatedRemainingRounds, normalizeLoopSubtaskDecisions, normalizeSingleLoopSubtaskDecision, normalizeLoopRoundSummaries, normalizeSingleLoopRoundSummary, normalizeLoopAcceptance, normalizeLoopAcceptanceChecks, buildLoopSubtaskId, applyLoopMainDecision, getLoopDecisionSubtasks, appendLoopMainDecisionSummary, buildLoopSubtaskDecisionMarkdown, upsertLoopSubtask, upsertLoopSubtasks, getActiveLoopSubtaskIds, markLoopSubtaskRunFinished, finalizeLoopSubtaskRun, buildLoopSubtaskCompletionSummary, appendLoopSubtaskCompletionAutoLog, markLoopTaskInterrupted, isLoopTaskExecutionInterrupted, markLoopTaskStopped, markLoopTaskStoppedByUser, markLoopTaskStoppedAfterRuntimeEnded, resolvePromptRunTargetFromConversationTab, prepareLoopOriginContinuationTarget, resolveLoopMainPromptTarget, maybeWakeLoopMainAfterSubtaskContinuation, getLoopTargetSessionId, persistLoopMessagesForTarget, removeLoopMainDecisionMessage, replaceLoopMainDecisionMessageWithMarkdown, showLoopSubtaskDecisionMarkdown, hasCompleteLoopCompletionMessagesForTask, appendLoopAnswerConclusionMessage, appendLoopFinalSummaryMessage, appendSystemMessageForLoop, getLoopRoundRunStatus, getLatestLoopRoundRunRecord } = promptRunRuntimeHost;
const modelSettingsHost = createModelSettingsHost({ getCurrentCli: () => currentCli, setCurrentCli: (cli) => { currentCli = cli; }, getModelStore: () => modelStore, setModelStore: (store) => { modelStore = store; }, getWorkspaceSettings: () => workspaceSettings, setWorkspaceSettings: (settings) => { workspaceSettings = settings; }, getPromptHistoryStore: () => promptHistoryStore, setPromptHistoryStore: (store) => { promptHistoryStore = store; }, getModelSelectionStoreState: () => modelSelectionStoreState, getActiveWorkspaceKey: () => activeWorkspaceKey, getConfigHeartbeatSnapshot: () => configHeartbeatCoordinator.getSnapshot(), getOpenCodeThinkingState: () => openCodeThinkingState, setOpenCodeThinkingState: (state) => { openCodeThinkingState = state; }, getOpenCodeSmallThinkingState: () => openCodeSmallThinkingState, setOpenCodeSmallThinkingState: (state) => { openCodeSmallThinkingState = state; }, getOpenCodeModelsState: () => openCodeModelsState, setOpenCodeModelsState: (state) => { openCodeModelsState = state; }, getOpenCodeThinkingContextKey: () => openCodeThinkingContextKey, setOpenCodeThinkingContextKey: (value) => { openCodeThinkingContextKey = value; }, getOpenCodeThinkingConfigId: () => openCodeThinkingConfigId, setOpenCodeThinkingConfigId: (value) => { openCodeThinkingConfigId = value; }, getOpenCodeThinkingExactModels: () => openCodeThinkingExactModels, setOpenCodeThinkingExactModels: (value) => { openCodeThinkingExactModels = value; }, getOpenCodeThinkingRequestId: () => openCodeThinkingRequestId, setOpenCodeThinkingRequestId: (value) => { openCodeThinkingRequestId = value; }, getWorkspacePreferredConfigIdForCli: (cli) => getWorkspacePreferredConfigIdForCli(cli), resolveModelConfigIdForCli: (cli, configState) => resolveModelConfigIdForCli(cli, configState), postPanelState: () => postPanelState(), resolveWorkspaceCwd: () => resolveWorkspaceCwd(), getExtensionUri: () => extensionUri, updateStatusBar: () => updateStatusBar(), getActiveConversationTab: () => getActiveConversationTab(), getActiveConversationTabId: () => getActiveConversationTabId(), getConversationTabById: (tabId) => getConversationTabById(tabId), isTabRunActive: (tabId) => isTabRunActive(tabId), preloadUserMessageForPrompt: (input, target) => preloadUserMessageForPrompt(input, target), resolvePromptRunTarget: (tabId) => resolvePromptRunTarget(tabId), runPrompt: (input, options) => runPrompt(input, options), sanitizeConversationTabRecord: (value) => sanitizeConversationTabRecord(value), logError: (event, payload) => logError(event, payload) });
const { getOpenCodeThinkingStateForRole, setOpenCodeThinkingStateForRole, persistOpenCodeVariant, updateOpenCodeVariantForCurrentSelection, updateOpenCodeVariantForConfig, resolveOpenCodeRoleModelsForConfig, refreshOpenCodeThinkingState, getOpenCodeVariantForRun, resolvePromptRunTargetSessionId, resolveLoopTaskSessionId, isLoopTaskBlockedByMainAiFailureLimit, normalizeThinkingModeForCli, getWorkspaceThinkingMode, getCliModelThinkingKey, getStoredCliModelThinkingMode, setCliModelThinkingMode, getEffectiveThinkingMode, getWorkspaceInteractiveMode, setWorkspaceInteractiveModeForCli, getGlobalHumanInteractionEnabled, shouldRequireExplicitFinalAnswerForRun, buildLongTermMemoryRuntimeSettings, getLongTermMemoryDisabledReason, getEffectiveLongTermMemoryEnabled, getActiveWorkspaceMemoryPaths, ensureActiveWorkspaceHarnessScaffold, confirmAndInitializeWorkspaceHarness, createCodeGraphTerminal, installCodeGraphForWorkspace, isCodeGraphInstalling, buildArchitectureInitializationModelPrompt, maybePromptInitializeArchitectureWithAi, getGlobalAutoCompactContextAfterRun, normalizeLoopMaxRounds, normalizeStoredLoopMaxRounds, parseLoopMaxRoundsValue, getGlobalLoopMaxRounds, getGlobalLoopPlusDecisionSubtaskMax, getGlobalLoopPlusMaxAcceptances, getGlobalLoopSubtaskMaxThinkingMode, getModelStoreOptions, getWorkspaceSettingsStoreOptions, getPromptHistoryStoreOptions, errorToMessage, ensureCliModelStore, readModelStore, writeModelStore, loadModelStore, getActiveConfigIdForCli, getSelectedCliModel, getSelectedLoopCliModel, getSelectedLoopThinkingMode, getSelectedLoopSubtaskCli, getSelectedLoopFrontendCli, selectLoopSubtaskCli, selectLoopFrontendCli, selectLoopFullstackCli, getSelectedLoopFullstackCli, selectLoopSubtaskMode, getSelectedLoopSubtaskMode, setLoopRoleExplicitModel, setLoopRoleThinking, seedLoopFullstackRole, getLoopRoleExplicitModel, refreshLoopSubtaskOpenCodeModels, getLoopSubtaskOpenCodeModels, getManagedModelOptionsForCli, getModelOptionsForCli, selectCliModel: selectCliModelFromStore, selectCliLoopModel: selectCliLoopModelFromStore, setSelectedLoopThinkingMode, updateOpenCodeRoleModelForConfig: updateOpenCodeRoleModelForConfigFromStore, addCliModel, renameCliModel, deleteCliModel, moveCliModel, getEffectiveCliArgs, buildModelState, loadWorkspaceSettings, saveWorkspaceSettings, loadPromptHistoryStore, ensurePromptHistoryStore, buildPromptHistoryState, recordPromptHistory, setPromptHistoryFavorite, clearPromptHistory, getPromptHistoryFilePath, readPromptHistoryFile, writePromptHistoryFile, deletePromptHistoryFile, cleanupPromptHistoryRetentionAcrossWorkspaces, collectWorkspaceKeysForPromptHistoryCleanup } = modelSettingsHost;

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
const sessionTabsHost = createExtensionSessionTabsHost({ getSessionTabsController: () => sessionTabsController, getSessionLifecycleController: () => sessionLifecycleController, getSessionStore: () => sessionStore, setSessionStore: (store) => { sessionStore = store; }, getCurrentCli: () => currentCli, setCurrentCli: (cli) => { currentCli = cli; }, getActiveWorkspaceKey: () => activeWorkspaceKey, getWorkspaceSettings: () => workspaceSettings, saveWorkspaceSettings: (settings) => saveWorkspaceSettings(settings), getLoopGroupChatTasks: () => loopGroupChatChatPanelCoordinator.listGroupChatTasks(), getGraphNodeRunTarget: (tabId) => graphNodeRunTargetsByTabId.get(tabId), deleteGraphNodeRunTarget: (tabId) => { graphNodeRunTargetsByTabId.delete(tabId); }, setGraphNodeRunTarget: (tabId, value) => { graphNodeRunTargetsByTabId.set(tabId, value); }, getPrimaryRunTabId: () => getPrimaryRunTabId(), getActiveTaskRun: () => primaryPromptRunController.activeTaskRun, getParallelGraphRunId: (tabId) => parallelRunsByTabId.get(tabId)?.graphRunId, getInteractiveGraphRunId: (tabId) => interactiveRunsByTabId.get(tabId)?.graphRunId, getLiveMessagesForTab: (tabId) => getLiveMessagesForTab(tabId), getPendingSessionDraft: (tabId, cli) => getPendingSessionDraft(tabId, cli), getActiveTabIdForRun: () => primaryPromptRunController.activeTabIdForRun, getActiveSessionId: () => primaryPromptRunController.activeSessionId, persistSessionStore: persistSessionStoreToStorage, getSessionStoreKey: (workspaceKey) => getSessionStoreKey(workspaceKey), loadSessionMessages: (cli, sessionId) => loadSessionMessages(cli, sessionId), saveSessionMessages: (cli, sessionId, messages) => saveSessionMessages(cli, sessionId, messages), buildSessionLabelFromPrompt: (prompt) => buildSessionLabelFromPrompt(prompt), shouldUseFallbackSessionLabel: (label) => shouldUseFallbackSessionLabel(label), isGraphRunBlockedForMainTab: (run) => isGraphRunBlockedForMainTab(run), isTabRunActive: (tabId) => isTabRunActive(tabId), isLoopMainTabCloseLocked: (tabId) => isLoopMainTabCloseLocked(tabId), postPanelState: () => postPanelState(), updateStatusBar: () => updateStatusBar(), maybePromptInstallOnCliGroupSwitch: (cli) => maybePromptInstallOnCliGroupSwitch(cli), sendSessionMessagesToPanel: (cli, sessionId, tabId) => sendSessionMessagesToPanel(cli, sessionId, tabId), restoreConversationTabConfiguration: (tabId) => restoreConversationTabConfiguration(tabId), getInteractiveSessionBindingsForTab: (tab) => getInteractiveSessionBindingsForTab(tab), disposeInteractiveRunnerIfUnused: (binding) => disposeInteractiveRunnerIfUnused(binding as InteractiveSessionBinding), setWorkspaceInteractiveModeForCli: (cli, mode) => setWorkspaceInteractiveModeForCli(cli, mode), resolveAutoInteractiveModeForConversationTab, extractSessionId: (cli, buffer) => extractSessionId(cli, buffer) ?? null, isLocalSessionId: (sessionId) => isLocalSessionId(sessionId), migrateLocalSessionToTargetSession: (cli, from, to, options) => migrateLocalSessionToTargetSession(cli, from, to, options), adoptSessionId: (cli, sessionId, tabId) => adoptSessionId(cli, sessionId, tabId), getActiveTaskRunMutable: () => primaryPromptRunController.activeTaskRun, logInfo: (event, payload) => { void logInfo(event, payload); }, activeData: { WORKSPACE_KEY_FALLBACK, LEGACY_SESSION_FILE, SESSION_DIR, SESSION_BUFFER_LIMIT } });
const { loadSessionStore, cleanupSessionRetentionAcrossWorkspaces, buildSessionState, resolveSessionFirstPrompt, normalizeChatGraphRunId, resolveGraphRunIdFromMessages, resolveSessionGraphRunIdFromMessages, resolveConversationTabGraphRunId, ensureLatestSessionForCli, getLatestSessionId, getCurrentSessionId, buildOpenConversationTabSessionMap, buildConversationTabsState, initializeConversationTabsFromWorkspaceSettings, sanitizeConversationTabRecord, ensureConversationTabs, persistConversationTabsToWorkspaceSettings, getConversationTabById, getActiveConversationTabId, getActiveConversationTab, getActiveConversationSessionId, findConversationTabIdBySession, updateActiveConversationTabSession, setActiveConversationTab, switchVisibleConversationTabForLoop, createLoopSubtaskRunTarget, createGraphNodeRunTarget, addConversationTab, closeConversationTab, closeConversationTabAndRefreshPanel, detachConversationTabsFromSession, syncCurrentSessionWithActiveTab, setCurrentSession, startNewSession, markConversationTabExecutionLocked, resetConversationTabSession, captureSessionFromBuffer, adoptDetectedSessionId, adoptFreshOpenCodeLoopRecoverySession, touchSession, updateSessionBuffer, createConversationTabId, getPendingSessionDraft, updatePendingSessionDraft, clearPendingSessionDraft, ensureLocalSession, preparePendingLabel, assignPendingLabel, persistActiveMessages } = sessionTabsHost;

loopOrchestrationHost = createLoopOrchestrationHost({
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
  getLoopSubtaskDisplayTitle,
  isLoopTaskExecutionInterrupted,
  logError,
  mapLoopRunStatusToSubagentStatus,
  markLoopSubtaskRunFinished,
  markLoopTaskInterrupted,
  normalizeLoopContinuePromptForPrompt,
  parseLoopMainDecision,
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

const { runPromptParallel } = createPromptParallelRuntimeHost({
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
  AI_TASK_RAW_OUTPUT_MAX_BYTES,
  activeRunsByTabId: interactiveRunsByTabId,
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
  appendCompletionMessage,
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
  activeWorkspaceKey = workspaceKey;
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
  repairSupersededLocalSessions({ notifyPanel: false });
  syncCurrentSessionWithActiveTab();
  ensureCurrentCliIsEnabled();
  scheduledTaskScheduler?.notifyChanged();
}

function getExplicitGlobalConfigValue<T>(key: string): T | undefined {
  const config = vscode.workspace.getConfiguration("sinitek-cli-tools");
  const inspected = config.inspect<T>(key);
  return inspected?.globalValue;
}

function saveStoredToolSettings(next: ToolSettingsState): boolean {
  try {
    writeToolSettings(next);
    return true;
  } catch (error) {
    void logError("tool-settings-write-error", { error: String(error) });
    return false;
  }
}

function updateStoredToolSettings(patch: Partial<ToolSettingsState>): boolean {
  return saveStoredToolSettings({
    ...readToolSettings(),
    ...patch,
  });
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
    const migrated = saveStoredToolSettings({
      ...globalSettings,
      autoCompactContextAfterRun: resolveGlobalAutoCompactContextAfterRun(
        globalSettings,
        workspaceSettings,
      ),
    });
    if (!migrated) {
      return;
    }
  }

  delete workspaceSettings.autoCompactContextAfterRun;
  delete workspaceSettings.autoCompactContextBeforeRun;
  saveWorkspaceSettings(workspaceSettings);
}

function migrateLegacyToolSettingsFromVsCodeConfig(): void {
  const current = readToolSettings();
  const next: ToolSettingsState = { ...current };
  let changed = false;

  const debug = getExplicitGlobalConfigValue<unknown>("debug");
  if (typeof current.debug !== "boolean" && typeof debug === "boolean") {
    next.debug = debug;
    changed = true;
  }

  const autoAddEditorContextTags = getExplicitGlobalConfigValue<unknown>("autoAddEditorContextTags");
  if (
    typeof current.autoAddEditorContextTags !== "boolean"
    && typeof autoAddEditorContextTags === "boolean"
  ) {
    next.autoAddEditorContextTags = autoAddEditorContextTags;
    changed = true;
  }

  const humanInteractionEnabled = getExplicitGlobalConfigValue<unknown>("humanInteractionEnabled");
  if (
    typeof current.humanInteractionEnabled !== "boolean"
    && typeof humanInteractionEnabled === "boolean"
  ) {
    next.humanInteractionEnabled = resolveGlobalHumanInteractionEnabled({ humanInteractionEnabled });
    changed = true;
  }

  const macTaskShell = getExplicitGlobalConfigValue<unknown>("macTaskShell");
  if (!current.macTaskShell && isMacTaskShell(macTaskShell)) {
    next.macTaskShell = macTaskShell;
    changed = true;
  }

  if (changed) {
    saveStoredToolSettings(next);
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

async function applyConfigById(cli: CliName, configId: string): Promise<ConfigApplyResult> {
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
        content: config.content,
        mcpContent: config.mcpContent,
        envContent: cli === "codex" ? undefined : config.envContent,
        configContent: config.configContent,
        authContent: config.authContent,
        codexSkills: config.codexSkills,
        claudeSkills: config.claudeSkills,
        openCodeSkills: config.openCodeSkills,
      });
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
  requiresSubtaskModel?: boolean;
};

function normalizeOpenCodeRuntimePreparationInput(
  input?: string | null | OpenCodeRuntimePreparationInput
): Required<Pick<OpenCodeRuntimePreparationInput, "configId">> & {
  role: OpenCodeCanonicalModelRole;
  model: string | null;
  requiresSubtaskModel: boolean;
} {
  if (typeof input === "string" || input === null) {
    return {
      configId: input ?? getActiveConfigIdForCli("opencode"),
      role: "main",
      model: null,
      requiresSubtaskModel: false,
    };
  }
  const role = normalizeOpenCodeModelRole(input?.role ?? "main");
  return {
    configId: input?.configId ?? getActiveConfigIdForCli("opencode"),
    role,
    model: normalizeCliModelName(input?.model) ?? null,
    requiresSubtaskModel: role === "subtask" || input?.requiresSubtaskModel === true,
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
  const effectiveVariant = getOpenCodeVariantForRun(
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

async function restoreOriginalLoopRuntime(task: LoopTaskRecord): Promise<{
  ok: boolean;
  target?: { tabId: string | null; cli: CliName };
  message?: string;
}> {
  const profile = normalizeLoopTaskOriginProfile(task.originProfile);
  if (!profile) {
    return { ok: false, message: t("loopGroupChatChat.originalRuntimeUnavailable") };
  }
  try {
    const config = await configService.getConfigById(task.cli, profile.configId);
    if (!config) {
      return { ok: false, message: t("loopGroupChatChat.originalConfigMissing", { configId: profile.configId }) };
    }
    const applied = await applyConfigById(task.cli, profile.configId);
    if (applied !== "applied") {
      return { ok: false, message: t("loopGroupChatChat.originalConfigMissing", { configId: profile.configId }) };
    }
    const prepared = prepareLoopOriginContinuationTarget(task);
    if (!prepared?.tabId) {
      return { ok: false, message: t("loopGroupChatChat.continueUnavailable") };
    }
    await switchVisibleConversationTabForLoop(prepared.tabId);
    const mainModel = task.modelRouting?.main.model ?? null;
    const subtaskModel = task.modelRouting?.subtask.model ?? null;
    const sameCliSubtask = !parseCliName(task.modelRouting?.subtask.cli) || parseCliName(task.modelRouting?.subtask.cli) === task.cli;
    if (task.cli === "opencode") {
      if (mainModel) {
        const mainError = await updateOpenCodeRoleModelForConfig("main", mainModel, profile.configId);
        if (mainError) {
          return { ok: false, message: mainError };
        }
      }
      if (sameCliSubtask && subtaskModel) {
        const subtaskError = await updateOpenCodeRoleModelForConfig("subtask", subtaskModel, profile.configId);
        if (subtaskError) {
          return { ok: false, message: subtaskError };
        }
      }
      if (profile.mainOpenCodeVariant && mainModel) {
        persistOpenCodeVariant(profile.configId, mainModel, "main", profile.mainOpenCodeVariant);
      }
      if (sameCliSubtask && profile.subtaskOpenCodeVariant && subtaskModel) {
        persistOpenCodeVariant(profile.configId, subtaskModel, "subtask", profile.subtaskOpenCodeVariant);
      }
      await refreshOpenCodeThinkingState(await loadConfigState("opencode"));
    } else if (task.cli === "codex" || task.cli === "grok" || task.cli === "kimi-code") {
      if (mainModel) {
        selectCliLoopModel(task.cli, "main", mainModel, profile.configId);
      }
      if (sameCliSubtask && subtaskModel) {
        selectCliLoopModel(task.cli, "subtask", subtaskModel, profile.configId);
      }
      if (profile.mainThinkingMode && mainModel) {
        setSelectedLoopThinkingMode(task.cli, "main", mainModel, profile.mainThinkingMode, profile.configId);
      }
      if (sameCliSubtask && profile.subtaskThinkingMode && subtaskModel) {
        setSelectedLoopThinkingMode(task.cli, "subtask", subtaskModel, profile.subtaskThinkingMode, profile.configId);
      }
    } else if (task.cli === "claude" && profile.mainThinkingMode) {
      setCliModelThinkingMode(task.cli, mainModel, profile.mainThinkingMode);
    }
    const boundSubtaskCli = parseCliName(task.modelRouting?.subtask.cli);
    if (boundSubtaskCli) {
      selectLoopSubtaskCli(profile.configId, boundSubtaskCli);
    }
    if (boundSubtaskCli && boundSubtaskCli !== task.cli) {
      const subtaskConfigId = task.modelRouting?.subtask.configId?.trim() || "";
      if (!subtaskConfigId) {
        return { ok: false, message: "目标 CLI 没有可用配置，不能派发子任务。" };
      }
      const subtaskConfig = await configService.getConfigById(boundSubtaskCli, subtaskConfigId);
      if (!subtaskConfig) {
        return { ok: false, message: t("loopGroupChatChat.originalConfigMissing", { configId: subtaskConfigId }) };
      }
      const subtaskApplied = await applyConfigById(boundSubtaskCli, subtaskConfigId);
      if (subtaskApplied !== "applied") {
        return { ok: false, message: t("loopGroupChatChat.originalConfigMissing", { configId: subtaskConfigId }) };
      }
      if (boundSubtaskCli === "opencode") {
        if (subtaskModel) {
          const subtaskError = await updateOpenCodeRoleModelForConfig("subtask", subtaskModel, subtaskConfigId);
          if (subtaskError) {
            return { ok: false, message: subtaskError };
          }
        }
        if (profile.subtaskOpenCodeVariant && subtaskModel) {
          persistOpenCodeVariant(subtaskConfigId, subtaskModel, "subtask", profile.subtaskOpenCodeVariant);
        }
      } else if (boundSubtaskCli === "claude") {
        if (profile.subtaskThinkingMode) {
          setSelectedLoopThinkingMode(boundSubtaskCli, "subtask", null, profile.subtaskThinkingMode, subtaskConfigId);
          setCliModelThinkingMode(boundSubtaskCli, null, profile.subtaskThinkingMode);
        }
      } else if (subtaskModel) {
        selectCliLoopModel(boundSubtaskCli, "subtask", subtaskModel, subtaskConfigId);
        if (profile.subtaskThinkingMode) {
          setSelectedLoopThinkingMode(boundSubtaskCli, "subtask", subtaskModel, profile.subtaskThinkingMode, subtaskConfigId);
        }
      }
    }
    await postPanelState();
    return { ok: true, target: { tabId: prepared.tabId, cli: task.cli } };
  } catch (error) {
    return { ok: false, message: errorToMessage(error) };
  }
}

const loopGroupChatChatPanelCoordinator = createLoopGroupChatPanelCoordinator({
  getExtensionUri: () => extensionUri,
  panelsByTaskId: loopGroupChatChatPanelsByTaskId,
  normalizeTaskId: normalizeLoopTaskId,
  normalizeSupplementalRequirement: normalizeLoopSupplementalRequirement,
  appendSupplementalRequirement: appendLoopSupplementalRequirement,
  appendSupplementalRequirementToCommunication: appendLoopSupplementalRequirementToCommunication,
  readTaskRecord: readLoopTaskRecord,
  updateTaskRecord: updateLoopTaskRecord,
  listTaskStoreFiles: listLoopTaskStoreFiles,
  readTaskStoreTasks: (filePath) => readLoopTaskStore(filePath).tasks,
  collectRunningTaskIds: collectRunningLoopTaskIds,
  readTextFileIfNonEmpty,
  fileExists: (filePath) => fs.existsSync(filePath),
  writeTextFileEnsuringDir,
  getActiveSubtaskIds: getActiveLoopSubtaskIds,
  buildCompletedConclusionAndSummaryMarkdown: buildLoopCompletedConclusionAndSummaryMarkdown,
  resolveMainPromptTarget: resolveLoopMainPromptTarget,
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
  runLoopPrompt,
  stopRunsForTask: stopLoopRunsForTask,
  markTaskStoppedByUser: markLoopTaskStoppedByUser,
  notifyLoopPlusUserMessage: (taskId, text) => {
    getLoopPlusOrchestrationHost().submitUserMessage(taskId, text);
  },
  readLoopPlusAcceptancePlans: () => buildLoopPlusAcceptancePlansPanelValue(workspaceSettings),
  readLoopPlusAcceptancePlanSelection: () => buildLoopPlusAcceptancePlanSelectionPanelValue(workspaceSettings),
  saveLoopPlusAcceptancePlan: (input) => saveLoopPlusAcceptancePlan(createAcceptancePlanSettingsHost(), input),
  selectLoopPlusAcceptancePlan: (planId) => selectLoopPlusAcceptancePlan(createAcceptancePlanSettingsHost(), planId),
  deleteLoopPlusAcceptancePlan: (planId) => deleteLoopPlusAcceptancePlan(createAcceptancePlanSettingsHost(), planId),
  applyLoopPlusAcceptancePlan: (taskId, plan) => getLoopPlusOrchestrationHost().applyAcceptancePlan(taskId, plan),
  askMainModel: async (task, question, hooks) => {
    let target = resolveLoopMainPromptTarget(task, { createIfMissing: false });
    if (!target && task.sessionId) {
      target = resolveLoopMainPromptTarget(task, { createIfMissing: true });
    }
    return askLoopMainModelSession({
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
      runPrompt,
      onProgress: hooks?.onProgress,
      isAborted: hooks?.isAborted,
      unavailableMessage: t("loopGroupChatChat.askUnavailable"),
      busyMessage: t("loopGroupChatChat.askBusy"),
      emptyMessage: t("loopGroupChatChat.askEmpty"),
      failedMessage: (detail) => t("loopGroupChatChat.askFailed", { detail }),
    });
  },
  abortMainModelRun: (task) => {
    const target = resolveLoopMainPromptTarget(task, { createIfMissing: false });
    if (!target?.tabId) {
      return;
    }
    stopLoopPlusInvocationRunner(target.tabId, { includeGraph: false });
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


const graphMessagesHost = createGraphMessagesHost({
  getGraphNodeRunTarget: (tabId) => graphNodeRunTargetsByTabId.get(tabId),
  getLoopMessagesForTarget,
  appendSystemMessageForLoop,
  appendMessageToStore,
  sendPanelMessage,
  persistLoopMessagesForTarget,
  createMessageId,
});

let graphRuntimeHost: GraphRuntimeHost;

const graphControlsHost: GraphControlsHost = createGraphControlsHost({
  getExtensionUri: () => extensionUri,
  panelsByRunId: graphRunPanelsByRunId,
  getActiveWorkspaceKey: () => activeWorkspaceKey,
  getCurrentCli: () => currentCli,
  postPanelState,
  resolvePromptRunTarget,
  findConversationTabIdBySession,
  getActiveConversationTab,
  addConversationTab,
  switchVisibleConversationTabForLoop,
  isTabRunActive,
  getActiveConfigIdForCli,
  stopParallelRunForTab,
  getParallelRunsByTabId: () => parallelRunsByTabId,
  getInteractiveRunsByTabId: () => interactiveRunsByTabId,
  isPrimaryRunActive,
  getActiveTaskRun: () => primaryPromptRunController.activeTaskRun,
  stopActiveRun,
  showInformationMessage: (message) => { void vscode.window.showInformationMessage(message); },
  showWarningMessage: (message) => { void vscode.window.showWarningMessage(message); },
  errorToMessage,
  messages: graphMessagesHost,
  runtime: {
    resolveGraphResumePromptModels: (run, cli, configId) => graphRuntimeHost.resolveGraphResumePromptModels(run, cli, configId),
    resolveCurrentLoopModelPair: (cli, configId) => graphRuntimeHost.resolveCurrentLoopModelPair(cli, configId),
    buildCurrentGraphModelRouting: (cli, configId) => graphRuntimeHost.buildCurrentGraphModelRouting(cli, configId),
    applyGraphRunModelRouting: (run) => graphRuntimeHost.applyGraphRunModelRouting(run),
    hydrateOpenCodePromptRoleModels: (input, cli) => graphRuntimeHost.hydrateOpenCodePromptRoleModels(input, cli),
    tickGraphRunToPause: (run, input, target) => graphRuntimeHost.tickGraphRunToPause(run, input, target),
    sendGraphMainRunTerminalStatus: (target, run) => graphRuntimeHost.sendGraphMainRunTerminalStatus(target, run),
  },
  t,
});

graphRuntimeHost = createGraphRuntimeHost({
  getActiveWorkspaceKey: () => activeWorkspaceKey,
  getActiveConversationTabId,
  resolvePromptRunTarget,
  resolveGraphRunSessionId: (target) => {
    const tab = getConversationTabById(target.tabId);
    return tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
  },
  getActiveConfigIdForCli,
  getSelectedCliModel,
  getSelectedLoopCliModel,
  getSelectedLoopThinkingMode,
  getSelectedLoopSubtaskCli,
  normalizeThinkingModeForCli,
  getEffectiveThinkingMode,
  getGlobalLoopSubtaskMaxThinkingMode,
  isThinkingMode,
  resolveOpenCodeRoleModelsForConfig,
  createMessageId,
  resolveWorkspaceCwd,
  postPanelState,
  persistGraphRunTickState: graphControlsHost.persistGraphRunTickState,
  scheduleGraphRunAutoWake: graphControlsHost.scheduleGraphRunAutoWake,
  sendRunStatusForTab,
  createGraphNodeRunTarget,
  runPrompt,
  closeConversationTabAndRefreshPanel,
  errorToMessage,
  messages: graphMessagesHost,
  revealClarification: (graphRunId) => { void openGraphRunPanel(graphRunId); },
  recordInteractionHistory: recordOrchestratorInteractionResponse,
});

function initializeGraphAutoWakeScheduler(context: vscode.ExtensionContext): void {
  graphControlsHost.initializeGraphAutoWakeScheduler(context);
}

function restoreGraphAutoWakeSchedules(): void {
  graphControlsHost.restoreGraphAutoWakeSchedules();
}

function scheduleGraphRunAutoWake(run: GraphRunRecord): void {
  graphControlsHost.scheduleGraphRunAutoWake(run);
}

function cancelGraphRunAutoWake(graphRunId: string): void {
  graphControlsHost.cancelGraphRunAutoWake(graphRunId);
}

function attemptGraphRunAutoWake(graphRunId: string): GraphAutoWakeAttemptResult {
  return graphControlsHost.attemptGraphRunAutoWake(graphRunId);
}

async function continueGraphRunFromPanel(graphRunId: string): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return graphControlsHost.continueGraphRunFromPanel(graphRunId);
}

async function supplementGraphRunFromPanel(
  graphRunId: string,
  prompt: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return graphControlsHost.supplementGraphRunFromPanel(graphRunId, prompt);
}

async function retryGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return graphControlsHost.retryGraphNodeFromPanel(graphRunId, nodeId);
}

async function skipGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return graphControlsHost.skipGraphNodeFromPanel(graphRunId, nodeId);
}

async function feedbackGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return graphControlsHost.feedbackGraphNodeFromPanel(graphRunId, nodeId);
}

async function stopGraphRunFromPanel(graphRunId: string): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return graphControlsHost.stopGraphRunFromPanel(graphRunId);
}

async function continueGraphRunFromStore(
  graphRunId: string,
  options: {
    source: GraphRunControlSource;
    reason: string;
    preferredTargetTabId?: string | null;
  },
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return graphControlsHost.continueGraphRunFromStore(graphRunId, options);
}

function persistGraphRunTickState(nextRun: GraphRunRecord): GraphRunRecord {
  return graphControlsHost.persistGraphRunTickState(nextRun);
}

function refreshOpenGraphRunPanelForRun(graphRunId: string): void {
  graphControlsHost.refreshOpenGraphRunPanelForRun(graphRunId);
}

function resolveGraphRunExistingPromptTarget(run: GraphRunRecord): PromptRunTarget | null {
  return graphControlsHost.resolveGraphRunExistingPromptTarget(run);
}

function stopActiveCliRunsForGraphRun(graphRunId: string): number {
  return graphControlsHost.stopActiveCliRunsForGraphRun(graphRunId);
}

function graphRuntimeMessage(
  key: GraphRuntimeMessageKey,
  params: Record<string, string | number | undefined> = {},
): string {
  return graphMessagesHost.graphRuntimeMessage(key, params);
}

async function openGraphRunPanel(arg?: unknown): Promise<void> {
  await graphControlsHost.openGraphRunPanel(arg);
}

async function openLoopGroupChatPanel(arg?: unknown): Promise<void> {
  await loopGroupChatChatPanelCoordinator.open(arg);
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
  if (readLoopTaskRecord(taskId)?.schedulingMode === "event_driven") {
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

function resolvePromptRunModelForRole(input: PromptRunInput, role: GraphModelRole): string | undefined {
  return graphRuntimeHost.resolvePromptRunModelForRole(input, role);
}

function resolvePromptRunThinkingModeForRole(
  input: PromptRunInput,
  cli: CliName,
  role: GraphModelRole,
  model: string | undefined,
  options: { applySubtaskCap?: boolean; configId?: string | null } = {},
): ThinkingMode | undefined {
  return graphRuntimeHost.resolvePromptRunThinkingModeForRole(input, cli, role, model, options);
}

function resolvePromptRunModelFallback(input: PromptRunInput, role: GraphModelRole): string {
  return graphRuntimeHost.resolvePromptRunModelFallback(input, role);
}

function buildGraphRunModelRouting(input: PromptRunInput): GraphRunModelRoutingRecord {
  return graphRuntimeHost.buildGraphRunModelRouting(input);
}

function applyGraphNodeModelRoute(
  node: GraphNodeRecord,
  route: GraphRunModelRoutingRecord["planner"],
): GraphNodeRecord {
  return graphRuntimeHost.applyGraphNodeModelRoute(node, route);
}

function applyGraphRunModelRouting(run: GraphRunRecord): GraphRunRecord {
  return graphRuntimeHost.applyGraphRunModelRouting(run);
}

function resolveGraphResumePromptModels(
  run: GraphRunRecord,
  cli: CliName,
  configId: string | null,
): Pick<PromptRunInput, "model" | "loopMainModel" | "loopSubtaskModel" | "loopMainModelFallback" | "loopSubtaskModelFallback"> {
  return graphRuntimeHost.resolveGraphResumePromptModels(run, cli, configId);
}

async function hydrateOpenCodePromptRoleModels(input: PromptRunInput, cli: CliName): Promise<PromptRunInput> {
  return graphRuntimeHost.hydrateOpenCodePromptRoleModels(input, cli);
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
  if (isLoopTaskRunOrphaned(task, runningTaskIds)) {
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
    return "coding";
  }
  const context = resolveConversationTabLoopContext(tab);
  return resolveConversationTabAutoInteractiveMode({
    hasGraphRun: Boolean(resolveConversationTabGraphRunId(tab)),
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
    graphRunId?: string;
    graphNodeId?: string;
  } = {}
): void {
  if (status === "start") {
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
    graphRunId: status === "start" ? options.graphRunId : undefined,
    graphNodeId: status === "start" ? options.graphNodeId : undefined,
    tabId,
  });
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

function stopParallelRunForTab(tabId: string, message?: string): boolean {
  const run = parallelRunsByTabId.get(tabId);
  if (!run) {
    return false;
  }
  run.stopped = true;
  run.process.kill();
  const stopMessage = message || t("run.stoppedByUser");
  const systemMessage: ChatMessage = {
    id: createMessageId(),
    role: "system",
    content: stopMessage,
    createdAt: Date.now(),
  };
  appendMessageToStore(run.messageTarget, systemMessage);
  sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: run.tabId });
  const taskRecord: TaskRunRecord = {
    id: run.runId,
    cli: run.cli,
    sessionId: run.sessionId,
    prompt: run.prompt,
    startedAt: run.startedAt,
    endedAt: Date.now(),
    durationMs: Math.max(0, Date.now() - run.startedAt),
    status: "stopped",
    taskRole: run.taskRole,
    loopTaskId: run.loopTaskId,
    loopRound: run.loopRound,
    loopSubtaskId: run.loopSubtaskId,
    graphRunId: run.graphRunId,
    graphNodeId: run.graphNodeId,
  };
  appendTaskRun(taskRecord);
  sendRunStatusForTab(run.tabId, "stopped", { message: stopMessage });
  parallelRunsByTabId.delete(tabId);
  persistMessagesForTab(run.cli, run.sessionId, run.tabId, run.messageTarget);
  return true;
}

function stopLoopPlusInvocationRunner(tabId: string, options: { includeGraph: boolean }): boolean {
  const interactiveRun = interactiveRunsByTabId.get(tabId);
  if (interactiveRun) {
    interactiveRun.stop();
    return true;
  }
  if (stopParallelRunForTab(tabId)) {
    return true;
  }
  if (getPrimaryRunTabId() === tabId) {
    const graphRunId = options.includeGraph && !primaryPromptRunController.activeTaskRun?.graphNodeId
      ? normalizeChatGraphRunId(primaryPromptRunController.activeTaskRun?.graphRunId)
      : null;
    stopActiveRun();
    if (graphRunId) {
      void stopGraphRunFromConversationTab(graphRunId, tabId);
    }
    return true;
  }
  if (options.includeGraph && stopGraphRunForConversationTab(tabId)) {
    return true;
  }
  return false;
}

function cancelLoopPlusInvocation(tabId: string | null): boolean {
  if (!tabId) {
    return false;
  }
  return stopLoopPlusInvocationRunner(tabId, { includeGraph: false });
}

function stopRunForTab(tabId: string | null): void {
  if (!tabId) {
    return;
  }
  const wasRepairing = promptAutoRepairController.isRepairing(tabId);
  promptAutoRepairController.cancel(tabId);
  if (wasRepairing) {
    sendRunStatusForTab(tabId, "stopped");
  }
  const parentStop = resolveLoopPlusParentStopContext(tabId);
  if (parentStop && shouldCloseLoopPlusParentGateBeforeAbort({
    schedulingMode: parentStop.schedulingMode,
    taskRole: parentStop.taskRole,
    gateAlreadyClosing: loopPlusParentGateDepth > 0,
  })) {
    stopLoopPlusParent(parentStop.taskId);
  }
  if (stopLoopPlusInvocationRunner(tabId, { includeGraph: true })) {
    return;
  }

  // A Loop main task can remain persisted as running while its direct CLI
  // process has already ended (for example, after all subtasks were
  // interrupted). In that state there is no tab-local runner to stop, but the
  // user must still be able to terminate the task from the main tab.
  const tab = getConversationTabById(tabId);
  const loopContext = tab ? resolveConversationTabLoopContext(tab) : null;
  const loopTaskId = loopContext?.taskRole === "main"
    ? normalizeLoopTaskId(loopContext.loopTaskId)
    : null;
  if (loopTaskId && readLoopTaskRecord(loopTaskId)?.status === "running") {
    stopLoopRunsForTask(loopTaskId);
    markLoopTaskStoppedByUser(loopTaskId);
    void postPanelState();
  }
}

function stopGraphRunForConversationTab(tabId: string): boolean {
  if (graphNodeRunTargetsByTabId.has(tabId)) {
    return false;
  }
  const tab = getConversationTabById(tabId);
  const graphRunId = resolveConversationTabGraphRunId(tab);
  if (!graphRunId) {
    return false;
  }
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run || lookup.run.status === "completed" || lookup.run.status === "stopped") {
    return false;
  }
  void stopGraphRunFromConversationTab(graphRunId, tabId);
  return true;
}

async function stopGraphRunFromConversationTab(graphRunId: string, tabId: string): Promise<void> {
  const result = await stopGraphRunFromPanel(graphRunId);
  if (!result.ok) {
    void vscode.window.showWarningMessage(result.message);
    return;
  }
  void logInfo("graph-run-stopped-from-conversation-tab", {
    graphRunId,
    tabId,
    changed: result.changed,
  });
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


let loopPlusRuntimeAdapter: ReturnType<typeof createLoopPlusRuntimeAdapter> | null = null;
let loopPlusParentGateDepth = 0;

function persistLoopPlusTaskUpdate(taskId: string, patch: Partial<LoopTaskRecord>): LoopTaskRecord | null {
  return createLoopPlusPersistedTaskRefresher<Partial<LoopTaskRecord>>({
    updateTask: (id, nextPatch) => updateLoopTaskRecord(id, nextPatch),
    refreshTaskSurfaces: (id) => {
      refreshOpenLoopGroupChatPanelForTask(id);
      void postPanelState();
    },
  })(taskId, patch);
}

function getLoopPlusRuntimeAdapter(): ReturnType<typeof createLoopPlusRuntimeAdapter> {
  if (!loopPlusRuntimeAdapter) {
    loopPlusRuntimeAdapter = createLoopPlusRuntimeAdapter({
      getActiveConfigIdForCli,
      maxConcurrency: LOOP_PARALLEL_SUBTASK_MAX,
      decisionSubtaskMax: () => getGlobalLoopPlusDecisionSubtaskMax(),
      acceptanceLimit: () => getGlobalLoopPlusMaxAcceptances(),
      launchDelayMs: (lastLaunchAt) => getLoopSubtaskLaunchDelayMs(lastLaunchAt),
      readTask: (taskId) => readLoopTaskRecord(taskId),
      createTask: ({ cli, rootPrompt, sessionId, snapshot, prompt }) => {
        let task = createLoopTaskRecord(cli, rootPrompt, { sessionId });
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
        const acceptancePlan = normalizeLoopPlusAcceptancePlanSnapshotForStorage(prompt.loopPlusAcceptancePlan);
        task = persistLoopPlusTaskUpdate(task.id, {
          schedulingMode: "event_driven",
          loopPlus: snapshot,
          loopPlusMainPhase: "decomposing",
          loopPlusMaxAcceptances: getGlobalLoopPlusMaxAcceptances(),
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
          loopPlusMaxAcceptances: getGlobalLoopPlusMaxAcceptances(),
          loopSubtaskMode,
          ...(acceptancePlan ? { loopPlusAcceptancePlan: acceptancePlan } : {}),
          ...(modelRouting ? { modelRouting } : {}),
          ...(originProfile ? { originProfile } : {}),
        };
        ensureLoopMainSubChatTranscript(task);
        return readLoopTaskRecord(task.id) ?? task;
      },
      updateTask: (taskId, patch) => persistLoopPlusTaskUpdate(taskId, patch),
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
      prepareCommunication: (task, subtask, round) => prepareLoopSubtaskCommunicationFile(task, subtask, round, 0),
      appendAttemptReport: (filePath, content) => {
        appendTextFileEnsuringDir(filePath, content);
      },
      log: (event, payload) => {
        void logInfo(event, payload);
      },
      revealClarification: (taskId) => { void openLoopGroupChatPanel(taskId); },
      recordInteractionHistory: recordOrchestratorInteractionResponse,
      runPrompt: (input, options) => runPrompt(input, options),
      getMessages: (target) => getLoopMessagesForTarget(target),
      readRuns: () => readTaskStore().runs,
      resolveThinkingMode: (input, cli, role, model) => resolvePromptRunThinkingModeForRole(
        input,
        cli,
        role,
        model,
        {
          applySubtaskCap: role === "subtask",
          configId: role === "subtask" ? input.loopSubtaskConfigId : undefined,
        },
      ),
      createExecutionRoot: () => {
        const workspaceCwd = resolveWorkspaceCwd();
        return workspaceCwd ? createWorkspaceLoopSubtaskExecutionRoot(workspaceCwd) : null;
      },
      createSubtaskTarget: (cli, options) => createLoopSubtaskRunTarget(cli, options),
      closeSubtaskTab: (tabId) => closeConversationTabAndRefreshPanel(tabId),
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
} | null {
  const tab = getConversationTabById(tabId);
  if (!tab) {
    return null;
  }
  const context = resolveConversationTabLoopContext(tab);
  if ((context.taskRole !== "main" && context.taskRole !== "subtask") || !context.loopTaskId) {
    return null;
  }
  return {
    taskId: context.loopTaskId,
    taskRole: context.taskRole,
    schedulingMode: readLoopTaskRecord(context.loopTaskId)?.schedulingMode,
  };
}

async function handleLoopPlusSubtaskContinuation(context: { taskId: string; subtaskId: string; round: number }, tabId: string): Promise<void> {
  const target = resolvePromptRunTarget(tabId);
  if (!target) {
    return;
  }
  const run = getLatestLoopRoundRunRecord(context.taskId, context.round, "subtask", context.subtaskId);
  if (!run || run.status !== "end") {
    return;
  }
  const summary = selectLoopPlusContinuationDetail(getLoopMessagesForTarget(target), run, {
    taskId: context.taskId,
    round: context.round,
    role: "subtask",
    subtaskId: context.subtaskId,
  });
  await closeLoopPlusSubtaskTab(tabId, {
    taskId: context.taskId,
    round: context.round,
    subtaskId: context.subtaskId,
    source: "continuation",
  });
  getLoopPlusOrchestrationHost().notifySubtaskContinuation(context.taskId, context.subtaskId, "completed", summary);
}

async function closeLoopPlusSubtaskTab(
  tabId: string,
  event: { taskId: string; round: number; subtaskId: string; source: "continuation" },
): Promise<void> {
  try {
    await closeConversationTabAndRefreshPanel(tabId);
    void logInfo("loop-plus-subtask-tab-auto-closed", { ...event, tabId });
  } catch (error) {
    void logError("loop-plus-subtask-tab-auto-close-error", {
      ...event,
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
  if (message === "loop-plus-resume-blocked") {
    return t("run.loopPlusPaused", { detail: "running executions are still live" });
  }
  if (message === "loop-plus-acceptance-limit") {
    return t("run.loopPlusAcceptanceLimit", loopPlusAcceptanceLimitDetail(task));
  }
  return t("run.loopPlusPaused", { detail: message });
}

function loopPlusAcceptanceLimitDetail(task: LoopTaskRecord | null): {
  accepted: number;
  limit: number;
  pending: number;
} {
  const limit = resolveLoopPlusMaxAcceptances(task?.loopPlusMaxAcceptances);
  const snapshot = task?.loopPlus;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { accepted: 0, limit, pending: 0 };
  }
  const raw = snapshot as {
    seenAttempts?: unknown;
    reviewQueue?: unknown;
    currentReview?: unknown;
  };
  const accepted = Array.isArray(raw.seenAttempts)
    ? raw.seenAttempts.filter((item) => (
      Boolean(item)
      && typeof item === "object"
      && (item as { disposition?: unknown }).disposition === "reviewed"
    )).length
    : 0;
  const queued = Array.isArray(raw.reviewQueue) ? raw.reviewQueue.length : 0;
  return {
    accepted,
    limit,
    pending: queued + (raw.currentReview ? 1 : 0),
  };
}

async function runEventDrivenLoopPrompt(
  input: PromptRunInput,
  options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean; preserveLoopOrigin?: boolean; schedulingMode?: "classic" | "event_driven" },
  target: PromptRunTarget,
  onTaskOwnershipAcquired?: (taskId: string, target: PromptRunTarget) => void,
): Promise<boolean> {
  return getLoopPlusRuntimeAdapter().runEventDriven(input, options, target, onTaskOwnershipAcquired);
}

async function runLoopPrompt(
  input: PromptRunInput,
  options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean; preserveLoopOrigin?: boolean; schedulingMode?: "classic" | "event_driven" } = {}
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
    });
  } catch (error) {
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
    await postPanelState();
  }
}

async function runGraphPrompt(
  input: PromptRunInput,
  options: { targetTabId?: string | null } = {}
): Promise<void> {
  return graphRuntimeHost.runGraphPrompt(input, options);
}

async function runGraphPromptOrchestration(
  input: PromptRunInput,
  options: { targetTabId?: string | null } = {}
): Promise<GraphRunRecord | null> {
  return graphRuntimeHost.runGraphPromptOrchestration(input, options);
}

async function tickGraphRunToPause(
  initialRun: GraphRunRecord,
  input: PromptRunInput,
  target: PromptRunTarget,
): Promise<{ run: GraphRunRecord; progressed: boolean }> {
  return graphRuntimeHost.tickGraphRunToPause(initialRun, input, target);
}

function sendGraphMainRunTerminalStatus(target: PromptRunTarget, run: GraphRunRecord): void {
  graphRuntimeHost.sendGraphMainRunTerminalStatus(target, run);
}

function isGraphRunBlockedForMainTab(run: GraphRunRecord): boolean {
  return graphRuntimeHost.isGraphRunBlockedForMainTab(run);
}

function selectGraphBlockedAttentionNode(run: GraphRunRecord): GraphNodeRecord | null {
  return graphRuntimeHost.selectGraphBlockedAttentionNode(run);
}

async function waitForLoopTaskClarification(task: LoopTaskRecord, target: PromptRunTarget): Promise<boolean> {
  const request = task.pendingClarification;
  if (!request) {
    return true;
  }
  void openLoopGroupChatPanel(task.id);
  const submission = await waitForOrchestratorClarification(loopClarificationScope(task.id), request, {
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
  options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean; preserveLoopOrigin?: boolean; schedulingMode?: "classic" | "event_driven" } = {},
  onTaskOwnershipAcquired?: (taskId: string, target: PromptRunTarget) => void,
): Promise<void> {
  const target = resolvePromptRunTarget(options.targetTabId ?? getActiveConversationTabId());
  if (!target || !input.displayPrompt.trim()) {
    return;
  }
  input = await hydrateOpenCodePromptRoleModels(input, target.cli);
  if (await runEventDrivenLoopPrompt(input, options, target, onTaskOwnershipAcquired)) {
    return;
  }

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
      task = updateLoopTaskRecord(existingTask.id, {
        status: "running",
        activeSubtaskId: null,
        activeSubtaskIds: [],
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

  if (!task) {
    if (resumeRequested) {
      appendSystemMessageForLoop(target, preserveLoopOrigin
        ? t("loopGroupChatChat.originalRuntimeUnavailable")
        : t("run.loopResumeUnavailableStartNew"));
      void logInfo("loop-task-resume-not-found", {
        tabId: target.tabId,
        cli: target.cli,
        preserveLoopOrigin,
      });
      if (preserveLoopOrigin) {
        return;
      }
    }
    const initialSessionId = resolveLoopTaskSessionId(target);
    task = createLoopTaskRecord(target.cli, input.displayPrompt, {
      sessionId: initialSessionId,
    });
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
      task = updateLoopTaskRecord(task.id, {
        ...(modelRouting ? { modelRouting } : {}),
        ...(originProfile ? { originProfile } : {}),
        updatedAt: Date.now(),
      }) ?? {
        ...task,
        ...(modelRouting ? { modelRouting } : {}),
        ...(originProfile ? { originProfile } : {}),
      };
    }
    ensureLoopMainSubChatTranscript(task);
    appendSystemMessageForLoop(target, buildLoopTaskStartedText(task), (
      {
        taskRole: "main",
        loopTaskId: task.id,
        merge: false,
        actions: [buildLoopGroupChatMessageAction(task.id)],
      }
    ));
  }

  if (!task) {
    return;
  }
  task = ensureLoopTaskMaxRoundsAtLeast(task, getGlobalLoopMaxRounds());
  onTaskOwnershipAcquired?.(task.id, target);
  await postPanelState();
  void openLoopGroupChatPanel(task.id);

  while (round <= task.maxRounds) {
    const latestRecord: LoopTaskRecord = readLoopTaskRecord(task.id) ?? task;
    const latest: LoopTaskRecord = ensureLoopTaskMaxRoundsAtLeast(latestRecord, getGlobalLoopMaxRounds());
    task = latest;
    if (isLoopTaskBlockedByMainAiFailureLimit(latest)) {
      appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(latest));
      return;
    }
    if (latest.status === "needs-review" || latest.status === "error" || latest.status === "stopped") {
      return;
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
      return;
    }
    if (decisionRunResult.status === "needs-review") {
      appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(decisionRunResult.task));
      return;
    }
    if (decisionRunResult.status === "awaiting-input") {
      continue;
    }

    const subtasks = decisionRunResult.subtasks;
    showLoopSubtaskDecisionMarkdown(target, decisionRunResult.task, round, subtasks, decisionRunResult.decision);
    const subtaskResults = await runLoopSubtasksBatchWithRetry({
      input,
      target,
      task: decisionRunResult.task,
      round,
      subtasks,
    });
    const interrupted = subtaskResults.find((result) => result.status === "error" || result.status === "stopped");
    if (interrupted) {
      appendSystemMessageForLoop(
        target,
        interrupted.status === "stopped"
          ? t("run.loopSubtaskStoppedAwaitingCompletion", { title: interrupted.subtask.title })
          : t("run.loopSubtaskFailedAwaitingCompletion", { title: interrupted.subtask.title }),
      );
      return;
    }

    const nextMainRound = round + 1;
    if (nextMainRound <= decisionRunResult.task.maxRounds) {
      appendSystemMessageForLoop(
        target,
        buildLoopMainResumeText(decisionRunResult.task.id, nextMainRound, subtasks)
      );
    }
    round = nextMainRound;
  }

  if (!task) {
    return;
  }
  const finalRecord = updateLoopTaskRecord(task.id, {
    status: "needs-review",
    updatedAt: Date.now(),
    finalSummary: "Reached the maximum automatic loop rounds. Manual review is required.",
  });
  appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(finalRecord ?? task));
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
  return requireLoopOrchestrationHost().runClassicLoopMainDecision(...args);
}

function runLoopSubtasksBatchWithRetry(...args: Parameters<LoopOrchestrationHost["runLoopSubtasksBatchWithRetry"]>): ReturnType<LoopOrchestrationHost["runLoopSubtasksBatchWithRetry"]> {
  return requireLoopOrchestrationHost().runLoopSubtasksBatchWithRetry(...args);
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

function preloadUserMessageForPrompt(input: PromptRunInput, target: PromptRunTarget): PromptRunInput {
  if (input.preloadedUserMessageId) {
    return input;
  }
  const tab = getConversationTabById(target.tabId);
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
  const messageId = createMessageId();
  const message = buildUserChatMessage({
    ...input,
    executionModel,
    executionProfile: buildConversationExecutionProfile(
      input.taskRole === "subtask" ? input.loopSubtaskConfigId ?? getActiveConfigIdForCli(target.cli) : getActiveConfigIdForCli(target.cli),
      firstExecutionModel,
      input.thinkingModeOverride ?? getEffectiveThinkingMode(target.cli, input.model ?? getSelectedCliModel(target.cli)),
    ),
  }, createdAt, messageId);
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
  stopRunForTab(tabId);
}

async function runPrompt(
  input: PromptRunInput,
  options: { targetTabId?: string | null } = {}
): Promise<void> {
  if (isExtensionDeactivating) {
    return;
  }

  const prompt = input.displayPrompt;
  if (!prompt) {
    return;
  }

  const target = resolvePromptRunTarget(options.targetTabId ?? getActiveConversationTabId());
  if (!target) {
    return;
  }
  promptAutoRepairController.cancel(target.tabId);
  if (shouldAwaitCliCommandAutoRepair(target.cli, {
    [target.cli]: getCliCommand(target.cli),
  })) {
    await waitForCliCommandAutoRepair();
    if (isExtensionDeactivating) {
      return;
    }
  }

  await loopMainAutoCompactFlights.wait(target.tabId);

  if (isTabRunActive(target.tabId)) {
    preemptActivePromptRun(target.tabId);
  }

  const currentTab = getConversationTabById(target.tabId);
  if (!currentTab) {
    return;
  }
  const previousSessionId = getConversationTabSessionIdForCli(currentTab, target.cli);
  target.sessionId = sessionLifecycleController.prepareSessionForPromptRun(target.cli, previousSessionId, target.tabId);
  if (previousSessionId && target.sessionId !== previousSessionId) {
    disposeInteractiveRunnerIfUnused({ cli: target.cli, sessionId: previousSessionId });
    await postPanelState();
  }

  scheduleLogRetentionCleanup();
  let promptInput = input;

  if (target.cli === "opencode") {
    promptInput = preloadUserMessageForPrompt(promptInput, target);
  }

  if (input.taskRole === "subtask") {
    const boundConfigId = typeof input.loopSubtaskConfigId === "string" ? input.loopSubtaskConfigId.trim() : "";
    const configExists = boundConfigId
      ? Boolean(await configService.getConfigById(target.cli, boundConfigId))
      : false;
    const configPlan = planBoundSubtaskConfigApply({
      taskRole: input.taskRole,
      targetCli: target.cli,
      loopSubtaskCli: input.loopSubtaskCli,
      loopSubtaskConfigId: input.loopSubtaskConfigId,
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

  const useClassicLoopProjectInstructions = shouldUseClassicLoopProjectInstructions(
    input,
    input.taskRole === "subtask" && input.loopTaskId ? readLoopTaskRecord(input.loopTaskId) : null,
  );
  const subtaskExecutionRoot = input.taskRole === "subtask" && !useClassicLoopProjectInstructions && !input.executionCwd
    ? (() => {
        const workspaceCwd = resolveWorkspaceCwd();
        return workspaceCwd ? createWorkspaceLoopSubtaskExecutionRoot(workspaceCwd) : null;
      })()
    : null;
  const shouldUseInteractive = isInteractiveSupported(target.cli);
  try {
    const executionOptions = {
      cwd: useClassicLoopProjectInstructions ? resolveWorkspaceCwd() : input.executionCwd ?? subtaskExecutionRoot?.cwd,
      isolateProjectInstructions: useClassicLoopProjectInstructions
        ? false
        : input.isolateProjectInstructions ?? Boolean(subtaskExecutionRoot),
    };
    const workspaceKey = activeWorkspaceKey;
    const startupCommand = getCliCommand(target.cli);
    let executionConfigId: string | null | undefined;
    await promptAutoRepairController.run(promptInput, target, {
      execute: async (attemptInput, attemptTarget) => {
        try {
          if (!await configApplyQueue.waitForIdle(attemptTarget.cli)) {
            throw new Error("配置应用失败，任务未启动，请重新激活配置后重试。");
          }
          if (executionConfigId === undefined) {
            const boundConfigId = attemptInput.taskRole === "subtask"
              ? attemptInput.loopSubtaskConfigId?.trim()
              : undefined;
            executionConfigId = boundConfigId
              || attemptInput.executionProfile?.configId
              || getActiveConfigIdForCli(attemptTarget.cli)
              || null;
            if (!executionConfigId) {
              const configState = await loadConfigState(attemptTarget.cli);
              executionConfigId = configState.activeConfigId || configState.configs[0]?.id || null;
            }
          }
          if (executionConfigId) {
            const applied = await applyConfigById(attemptTarget.cli, executionConfigId);
            if (applied !== "applied") {
              throw new Error("任务配置已被新的切换请求替代，任务未启动，请重试。");
            }
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
          appendSystemMessageForPromptTarget(attemptTarget, getErrorInfo(error).message);
          throw error;
        }
        if (shouldUseInteractive) {
          await runPromptInteractive(attemptInput, attemptTarget, executionOptions);
        } else if (hasOtherTabRun(attemptTarget.tabId)) {
          await runPromptParallel(attemptInput, attemptTarget, executionOptions);
        } else {
          await runPromptOneShot(attemptInput, attemptTarget, executionOptions);
        }
        if (attemptInput.taskRole === "subtask" && attemptInput.loopTaskId && attemptInput.loopSubtaskId && !attemptInput.graphRunId) {
          const task = readLoopTaskRecord(attemptInput.loopTaskId);
          const sessionId = resolvePromptRunTargetSessionId(attemptTarget)
            ?? getLatestLoopRoundRunRecord(attemptInput.loopTaskId, attemptInput.loopRound ?? 1, "subtask", attemptInput.loopSubtaskId)?.sessionId;
          if (task && sessionId) {
            updateLoopTaskRecord(task.id, { subTasks: bindLoopSubtaskSession(task.subTasks, attemptInput.loopSubtaskId, { cli: attemptTarget.cli, sessionId, configId: executionConfigId ?? null }) });
          }
        }
      },
      isTargetCurrent: () => !isExtensionDeactivating
        && activeWorkspaceKey === workspaceKey
        && getConversationTabById(target.tabId)?.cli === target.cli,
      onRepairStarted: () => {
        const tab = getConversationTabById(target.tabId);
        appendSystemMessageForPromptTarget({
          ...target,
          sessionId: tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId,
        }, t("cliRepair.taskRepairStarted", { cli: target.cli }));
        sendRunStatusForTab(target.tabId, "start", { prompt });
      },
      repairCommand: async () => {
        await waitForCliCommandAutoRepair();
        const command = getCliCommand(target.cli);
        if (!inspectUnresolvedCliCommands({ [target.cli]: command }).some((issue) => issue.cli === target.cli)) {
          return command !== startupCommand;
        }
        if (command !== startupCommand) {
          return false;
        }
        const executablePath = await locateCliExecutableForRepair(command, target.cli);
        if (!executablePath) {
          return false;
        }
        if (getCliCommand(target.cli) !== command) {
          return !inspectUnresolvedCliCommands({ [target.cli]: getCliCommand(target.cli) })
            .some((issue) => issue.cli === target.cli);
        }
        const repairedCommand = buildRepairedCliCommand(command, target.cli, executablePath);
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
    const info = getErrorInfo(error);
    if (isAbortErrorInfo(info)) {
      void logInfo("runPrompt-abort-ignored", { cli: target.cli, error: info.message });
      return;
    }
    void logError("runPrompt-failed", { cli: target.cli, error: info.message, errorCode: info.code });
    sendRunStatusForTab(target.tabId, "error", { message: info.message });
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
  const repairedSessionId = repairSupersededLocalSession(cli, sessionId);
  if (repairedSessionId !== sessionId) {
    return repairedSessionId;
  }
  const mappedId = resolveInteractiveMappedId(cli, repairedSessionId);
  if (isLocalSessionId(repairedSessionId) && !mappedId) {
    const detail = t("session.resumeUnavailableNoRemote");
    await showErrorWithActions(t("session.resumeUnavailableTitle"), detail);
    void logInfo("interactive-session-resume-blocked", {
      cli,
      sessionId: repairedSessionId,
      tabId,
      reason: "missing-remote-id",
    });
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

async function runContextCompaction(options: ContextCompactionOptions = {}): Promise<boolean> {
  return runContextCompactionWithDeps({
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
    setActiveInteractiveStop: (stop) => {
      primaryPromptRunController.activeInteractiveStop = stop;
    },
    isActiveInteractiveStop: (stop) => primaryPromptRunController.activeInteractiveStop === stop,
    appendStopMessageToStore,
    killActiveProcess: () => {
      primaryPromptRunController.activeProcess?.kill();
    },
    sendRunStatus,
    appendCompletionMessage,
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
  }, options);
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
  request: { allowActiveRun: boolean; onStopReady?: (stop: () => void) => void },
): Promise<void> {
  const compacted = await runContextCompaction({
    silent: true,
    cli: target.cli,
    tabId: target.tabId,
    sessionId,
    timeoutMs: AUTO_COMPACT_AFTER_RUN_TIMEOUT_MS,
    allowActiveRun: request.allowActiveRun,
    onStopReady: request.onStopReady,
  });
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
  options: { overlapLoopDispatch?: boolean } = {},
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
    graphRunId: primaryPromptRunController.activeTaskRun?.graphRunId,
    graphNodeId: primaryPromptRunController.activeTaskRun?.graphNodeId,
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
  options: { taskRole?: LoopTaskRole; loopTaskId?: string; loopRound?: number; loopSubtaskId?: string; graphRunId?: string; graphNodeId?: string } = {}
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
    graphRunId: options.graphRunId,
    graphNodeId: options.graphNodeId,
  };
}

function appendCompletionMessage(status: TaskRunStatus): void {
  if (primaryPromptRunController.activeCompletionSent) {
    return;
  }
  const taskRecord = finalizeTaskRun(primaryPromptRunController.activeRunId, status);
  const message = {
    id: createMessageId(),
    role: "system" as const,
    content: buildTaskRunCompletionText(status, taskRecord?.durationMs ?? null),
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
    graphRunId: status === "start" ? primaryPromptRunController.activeTaskRun?.graphRunId : undefined,
    graphNodeId: status === "start" ? primaryPromptRunController.activeTaskRun?.graphNodeId : undefined,
  });
}

function buildTaskRunCompletionText(status: TaskRunStatus, durationMs?: number | null): string {
  return buildTaskRunCompletionTextWithLabels(status, durationMs, {
    failed: t("run.failed"),
    stopped: t("run.stopped"),
    completed: t("run.completed"),
    failedWithDuration: (duration) => t("run.failedWithDuration", { duration }),
    stoppedWithDuration: (duration) => t("run.stoppedWithDuration", { duration }),
    completedWithDuration: (duration) => t("run.completedWithDuration", { duration }),
  });
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

function finalizeTaskRun(runId: string | undefined, status: TaskRunStatus): TaskRunRecord | null {
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
  };
  primaryPromptRunController.activeTaskRun = null;
  appendTaskRun(record);
  return record;
}

function appendTaskRun(record: TaskRunRecord): void {
  const store = readTaskStore();
  store.runs.push(record);
  writeTaskStore(store);
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
  } = {}
): LoopTaskRecord {
  const now = Date.now();
  const id = createMessageId();
  const communication = getLoopCommunicationPaths(id);
  const sessionId = typeof options.sessionId === "string" && options.sessionId.trim()
    ? options.sessionId
    : null;
  const taskStoreFile = buildLoopTaskStoreFile(cli, activeWorkspaceKey, sessionId, id);
  ensureLoopCommunicationFiles(id, rootPrompt);
  const record: LoopTaskRecord = {
    id,
    cli,
    workspaceKey: activeWorkspaceKey,
    taskStoreFile,
    rootPrompt,
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: getGlobalLoopMaxRounds(),
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
  const store = readLoopTaskStore(taskStoreFile);
  store.tasks.push(record);
  writeLoopTaskStore(taskStoreFile, store);
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
  sessionLifecycleController.migrateLocalSessionToTargetSession(cli, localSessionId, targetSessionId, options);
}

function findSupersedingLocalSessionTarget(cli: CliName, sessionId: string): string | null {
  return sessionLifecycleController.findSupersedingLocalSessionTarget(cli, sessionId);
}

function repairSupersededLocalSession(cli: CliName, sessionId: string, options: { notifyPanel?: boolean } = {}): string {
  return sessionLifecycleController.repairSupersededLocalSession(cli, sessionId, options);
}

function repairSupersededLocalSessions(options: { notifyPanel?: boolean } = {}): void {
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
