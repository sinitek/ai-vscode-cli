import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import {
  getAutoOpenPanel,
  getDefaultCli,
  getRememberSelectedCli,
  getAutoAddEditorContextTags,
  getDebugLogging,
  getMacTaskShell,
  getCliCommand,
  getCliArgs,
  isInteractiveSupported,
  getThinkingMode,
  getThinkingWorkspaceFiles,
} from "./cli/config";
import {
  buildCliArgs,
  buildOpenCodeRunFailureMessage,
  buildProcessLabel,
  captureCliOutput,
  createOpenCodeStreamActivityTracker,
  parseOpenCodeVisibleStreamEvents,
  parseOpenCodeRunOutput,
  resolveCliCommand,
  runCli,
  runCliStream,
  startOpenCodeServer,
  isCliCommandAvailable,
  type OpenCodeVisibleStreamEvent,
  type RunProcess,
} from "./cli/commandRunner";
import { resolveOpenCodeModelForConfig, supportsCliManagedModelSelection } from "./cli/modelArgs";
import {
  CliName,
  CLI_LIST,
  DEFAULT_LOOP_EXECUTION_MODE,
  InteractiveMode,
  LoopExecutionMode,
  MacTaskShell,
  OpenCodeThinkingMessageKey,
  OpenCodeThinkingState,
  ThinkingMode,
  ThinkingWorkspaceFile,
  normalizeLoopExecutionMode,
} from "./cli/types";
import {
  resolveOpenCodeThinkingCapability,
  type OpenCodeThinkingCapability,
} from "./cli/openCodeModelCapabilities";
import type { OpenCodeTaskListItem } from "./cli/openCodeTaskList";
import {
  resolveOpenCodeOneShotWatchdogTimeoutMs,
} from "./cli/opencodewatchdog";
import {
  createOpenCodeSubagentMonitor,
  OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
  resolveOpenCodeSubagentConnection,
  waitForOpenCodeServerReady,
  type OpenCodeSubagentConnection,
  type OpenCodeSubagentMonitor,
} from "./cli/openCodeSubagentMonitor";
import {
  appendOpenCodeFinalTextToTabStream,
  consumeOpenCodeTabStreamChunk,
  createOpenCodeTabStreamState,
  type OpenCodeTabStreamAction,
} from "./openCodeTabStream";
import {
  applyOpenCodeRuntimeMultiAgentEnvOverrides,
  applyOpenCodeRuntimeMultiAgentPermission,
  applyOpenCodeRuntimeModelOverlay,
  normalizeOpenCodeModelRole,
  parseOpenCodeConfigModels,
  toOpenCodeConfigFieldRole,
  validateOpenCodeModelOverride,
  type OpenCodeCanonicalModelRole,
  type OpenCodeModelRoleInput,
} from "./cli/opencodeconfigmodels";
import { getCliDisplayName, getCliInstallCommand, getCodeGraphInstallCommand } from "./cli/installer";
import { getLocaleSetting, resolveLocale, t } from "./i18n";
import { CliBridgeViewProvider } from "./webview/viewProvider";
import { GraphRunPanel } from "./webview/graphRunPanel";
import {
  buildWorkspacePathItems,
  buildTempFilePath,
  cleanupTempDir,
  ensureTempDir,
  exportRunStreamRecordsToTxt,
  exportSessionHistoryMessagesToTxt,
  saveUploadedFiles,
  startTempCleanup,
} from "./webview/panelFileActions";
import {
  ChatMessage,
  ChatMessageAction,
  EditorContextState,
  PanelMessage,
  PanelState,
  PromptContextOptions,
  ConversationTabSummary,
  PromptHistoryItem,
  SessionSummary,
} from "./webview/types";
import {
  initLogger,
  logCliRaw,
  logCliStream,
  logCliInteractiveStart,
  logCliInteractiveOutput,
  logDebug,
  logEssential,
  logError,
  logInfo,
  sanitizeEnv,
  scheduleLogRetentionCleanup,
  setDebugLogging,
} from "./logger";
import { buildErrorDetail, showErrorWithActions } from "./errorDisplay";
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
import {
  createSubagentProgressController,
  type SubagentProgressController,
  type SubagentProgressLabels,
} from "./subagentProgress";
import {
  createLoopSubtaskProgressMonitor,
  mapLoopRunStatusToSubagentStatus,
} from "./loopSubtaskProgress";
import {
  getEffectiveLoopSubtaskMaxThinkingMode,
  resolveLoopSubtaskThinkingMode,
} from "./loopSubtaskThinking";
import {
  buildNextLoopMainAiFailureState,
  buildResetLoopMainAiFailureState,
  isLoopMainAiFailureLimitReached,
  LOOP_MAIN_AI_FAILURE_LIMIT,
  normalizeLoopMainAiFailureCount,
} from "./loopMainFailure";
import {
  buildLoopAutoSleepProtocolLines,
  LOOP_AUTO_WAKE_MAX_SECONDS,
  LOOP_AUTO_WAKE_MIN_SECONDS,
  LoopAutoWakeScheduler,
  normalizeLoopSleepDecision,
  resolveLoopAutoWakeAt,
  type LoopAutoWakeAttemptResult,
} from "./loopAutoWake";
import { ConfigManagerPanel } from "./webview/configPanel";
import {
  LoopDebateChatPanel,
  type LoopDebateChatPanelRound,
} from "./webview/loopDebatePanel";
import * as configService from "./config/configService";
import { ConfigItem, ConfigPlatform, CurrentConfig } from "./config/types";
import { stripCodexSkillsBlock } from "./config/codexSkills";
import { stripManagedClaudeSkillRules } from "./config/claudeSkills";
import { stripManagedOpenCodeSkillRules } from "./config/geminiSkills";
import { InteractiveRunnerManager } from "./interactive/manager";
import { isClaudeNativeCompactUnsupportedError } from "./interactive/claudeCompaction";
import {
  decideCodexThreadForSelection,
  normalizeCodexRunSelection,
  type CodexRunSelection,
} from "./interactive/codexThreadSelection";
import { isCodexRetryProgressTraceKind } from "./interactive/codexRunnerRuntime";
import { extractTaskListItemsFromForwardedCodexEvent } from "./interactive/codexAppServerProtocol";
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
import { HISTORY_RETENTION_DAYS, isTimestampWithinHistoryRetention } from "./historyRetention";
import { isLocalSessionId } from "./interactive/sessionHistoryRepair";
import {
  buildLoopSubtaskExecutionPlan,
  describeLoopExecutionPlan,
  normalizeLoopWriteFiles,
  type LoopSubtaskExecutionPlan,
} from "./loopParallel";
import { createLoopSubtaskExecutionRoot } from "./loopSubtaskExecutionRoot";
import {
  buildLoopAnswerConclusionMarkdown,
  buildLoopDebateNeedsReviewSummary,
  buildLoopDebateModeratorArtifactFile,
  buildLoopFinalSummaryMarkdown,
  buildLoopGroupChatFinalStatusSection,
  buildLoopMainSubChatTranscriptFile,
  buildLoopMainSubSubtaskTurnBody,
  buildLoopDebateParticipantArtifactFile,
  buildLoopDebateParticipantTurnArtifactFile,
  buildLoopDebatePaths,
  formatLoopGroupChatMemberName,
  findLatestLoopDebateModeratorSessionId,
  findLatestLoopDebateParticipantSessionId,
  LOOP_MAIN_SUB_CHAT_ROUND_KEY,
  LOOP_DEBATE_MAX_DIALOGUE_TURNS,
  LOOP_DEBATE_MAX_BATCH_SPEAKERS,
  LOOP_DEBATE_MODERATOR_ID,
  LOOP_DEBATE_MODERATOR_TITLE,
  LOOP_DEBATE_BLUE_TEAM_ROLE,
  LOOP_DEBATE_PARTICIPANT_ROLES,
  LOOP_DEBATE_RED_TEAM_ROLE,
  isLoopDebateAdversarialParticipantRole,
  normalizeLoopDebateSessionId,
  normalizeLoopDebateModeratorAction,
  normalizeLoopDebateSpeakerIds,
  normalizeLoopDebateParticipantStance,
  parseLoopDebateChatTranscript,
  resolveLoopAnswerConclusion,
  isLoopTaskRunOrphaned,
  resolveLoopTaskRunControlState,
  selectDefaultLoopDebateOpeningSpeakerIds,
  validateLoopDebateConsensus,
  type LoopDebateActiveSpeakerRecord,
  type LoopDebateConsensusRecord,
  type LoopDebateDisagreementRecord,
  type LoopDebateModeratorDecisionRecord,
  type LoopDebateParticipantRecord,
  type LoopDebateParticipantRole,
  type LoopDebateParticipantStance,
  type LoopDebatePaths,
  type LoopDebateRoundRecord,
  type LoopDebateRoundStatus,
} from "./loopDebate";
import {
  LOOP_DEBATE_MAX_PARTICIPANTS,
  LOOP_DEBATE_MIN_PARTICIPANTS,
  buildLoopDebateBriefMarkdown,
  buildLoopDebateChatTurnMarkdown,
  buildLoopDebateDialogueClosedMarkdown,
  buildLoopDebateDialogueTurnChatEventMarkdown,
  buildLoopDebateFinalParticipantMarkdown,
  buildLoopDebateInitialChatMarkdown,
  buildLoopDebateModeratorTurnMarkdown,
  buildLoopDebateParticipantRosterChatMarkdown,
  buildLoopDebateRuntimeForcedFinalizeMarkdown,
  type LoopDebateParticipantDefinition,
} from "./loopPromptBuilders";
import {
  runLoopDebateConsensusSummary,
  runLoopDebateModerator,
  runLoopDebateParticipantBatch,
  runLoopDebateParticipantRoster,
  type LoopDebateParticipantBatchRunItem,
  type LoopDebateRunnerDeps,
  type LoopDebateSessionState,
} from "./loopDebateRunner";
import {
  appendLoopRound,
  bindLoopTaskToSession,
  bindLoopTaskToRuntimeTarget,
  buildLoopSessionIdsByCli,
  buildLoopTaskStoreFile,
  buildLoopSubtaskCommunicationFile,
  cleanupLoopCommunicationRetention,
  cleanupLoopTaskStoreRetention,
  ensureLoopCommunicationFiles,
  getLoopCommunicationPaths,
  getLoopTaskStoreSessionFile,
  listLoopTaskStoreFiles,
  prepareLoopSubtaskCommunicationFile,
  readLoopTaskRecord,
  readLoopTaskStore,
  updateLoopTaskRecord,
  writeLoopTaskStore,
  type LoopAcceptance,
  type LoopAcceptanceCheck,
  type LoopMainDecision,
  type LoopRoundRecord,
  type LoopRoundSummary,
  type LoopSubtaskDecision,
  type LoopSubtaskRecord,
  type LoopTaskRecord,
  type LoopTaskStore,
} from "./loopTaskStore";
import { createLoopOrchestrationOwnershipTracker } from "./loopOrchestrationOwnership";
import {
  finalizeLoopSubtaskRun as finalizeLoopSubtaskRunWithDeps,
  type LoopSubtaskCompletionOptions,
} from "./loopSubtaskLifecycle";
import { appendGraphEvent, readGraphEvents } from "./graph/graphEvents";
import {
  tickGraphRun,
  type GraphNodeExecutionRequest,
} from "./graph/graphKernel";
import {
  buildGraphRunIdsBySessionByCli,
  createGraphRunRecord,
  findLatestGraphRun,
  listGraphRuns,
  readGraphRunRecord,
  updateGraphRunRecord,
} from "./graph/graphStore";
import {
  feedbackGraphNodeForRun,
  resumeGraphRunRecord,
  retryGraphNodeForRun,
  skipGraphNodeForRun,
  stopGraphRunRecord,
  type GraphRunControlResult,
  type GraphRunControlSource,
} from "./graph/graphRunControl";
import {
  GraphAutoWakeScheduler,
  resolveGraphRunAutoWakeAt,
  type GraphAutoWakeAttemptResult,
} from "./graph/graphAutoWake";
import { readGraphNodeExecutionResultArtifact } from "./graph/graphNodeArtifact";
import {
  buildGraphPlanningRunEdges,
  buildGraphPlanningRunNodes,
  GRAPH_AI_PLANNER_NODE_ID,
  GRAPH_AI_PLANNER_TEMPLATE_ID,
  GRAPH_AI_PLANNER_TEMPLATE_VERSION,
  materializeGraphPlan,
} from "./graph/graphPlanner";
import { resolveGraphNodeCommunicationFile } from "./graph/graphPromptBuilders";
import {
  cleanupGraphRunWorktree,
  commitGraphNodeCheckpoint,
  createGraphRunExecutionSetup,
  getGraphWorktreeHeadCommit,
  mergeGraphRunWorktreeToWorkspace,
  type GraphWorktreeCleanupResult,
  type GraphWorktreeMergeBackResult,
} from "./graph/graphWorktree";
import {
  GRAPH_DEFAULT_MAX_CONCURRENT_NODES,
  type GraphFinalAnswer,
  type GraphModelRole,
  type GraphNodeRecord,
  type GraphRunModelRoutingRecord,
  type GraphRunRecord,
  type GraphRunStatus,
} from "./graph/types";
import {
  readToolSettings,
  resolveGlobalAutoCompactContextAfterRun,
  resolveGlobalMultiAgentEnabled,
  type ToolSettingsLocale,
  type ToolSettingsState,
  writeToolSettings,
} from "./toolSettings";
import { persistPromptRunSummary } from "./memory/memoryConsolidator";
import { resolveWorkspaceMemoryPaths } from "./memory/memoryPaths";
import {
  getLongTermMemoryRuntimeDisableReason,
  isLongTermMemoryRuntimeEnabled,
  isMemoryRuntimeOperationAllowed,
  type MemoryRuntimeGateSettings,
} from "./memory/runtimeGate";
import { ensureWorkspaceHarnessScaffold } from "./workspaceScaffold";
import {
  type ContextCompactionOptions,
  runContextCompactionWithDeps,
} from "./contextCompactionRunner";
import {
  buildHiddenRetryPrompt,
  buildRuntimeModelPrompt,
  buildThinkingPrompt,
  collectCodexImagePathsFromPrompt,
  normalizePromptContextTags,
  redactPromptArg,
} from "./promptRuntime";
import {
  createTraceLineFilterState,
  formatCodexExecSegmentForDisplay,
  formatTraceSegmentForDisplay,
  getTraceSegmentKind,
  isTraceSegmentStart,
  normalizeTraceContentForDisplay,
  resetTraceLineFilterState,
  resolveTraceKind,
  resolveTraceMerge,
  shouldIgnoreTraceLine,
  type TraceDisplayResult,
  type TraceMessageKind,
} from "./traceDisplay";
import {
  getLatestSessionIdFromRecords,
  getSessionKey,
  writeSessionFile,
  type SessionStore,
} from "./sessionStore";
import {
  buildConversationTabSessionLookupKey,
  createSessionTabsController,
  findConversationTabForLoopResume,
  getConversationTabSessionIdForCli,
  resolveAutoInteractiveModeForLoopTask,
  sanitizeConversationTabRecordForWorkspaceSettings,
  sanitizeConversationTabSessionIdMap,
  setConversationTabSessionIdForCli,
  switchConversationTabCli,
  type ConversationTabRecord,
  type ConversationTabsState,
  type PendingSessionDraft,
  type SessionTabsController,
} from "./sessionTabs";
import {
  createSessionLifecycleController,
  extractSessionId,
  resolveCliSessionIdForResume,
  type ProcessTitleState,
  type SessionLifecycleController,
} from "./sessionLifecycle";
import {
  buildModelState as buildModelSelectionState,
  countStoreModels,
  createEmptyModelSelectionStoreState,
  deleteCliModelFromStore,
  ensureCliModelStore as ensureCliModelSelectionStore,
  getEffectiveCliArgs as getEffectiveCliArgsFromStore,
  getManagedModelOptionsForCliFromStore,
  getManagedModelOptionsForConfigFromStore,
  getModelOptionsForCliFromStore,
  getModelOptionsForConfigFromStore,
  getOpenCodeRoleModelFromStore,
  getOpenCodeRoleVariantFromStore,
  getOpenCodeVariantFromStore,
  getSelectedCliModelFromStore,
  getSelectedLoopCliModelFromStore,
  getSelectedLoopThinkingModeFromStore,
  loadModelStore as loadModelSelectionStore,
  mergeUniqueModelNames,
  moveCliModelInStore,
  normalizeCliModelName,
  readModelStore as readModelSelectionStore,
  renameCliModelInStore,
  selectCliModelInStore,
  selectCliLoopModelInStore,
  setSelectedLoopThinkingModeInStore,
  setOpenCodeRoleModelInStore,
  setOpenCodeRoleVariantInStore,
  setOpenCodeVariantInStore,
  summarizeModelStoreByConfigId,
  writeModelStore as writeModelSelectionStore,
  type CliModelStore,
} from "./modelSelectionStore";
import { handleUpdateOpenCodeVariantMessage } from "./sessionMessageActions";
import {
  loadWorkspaceSettings as loadWorkspaceSettingsFromStore,
  saveWorkspaceSettings as saveWorkspaceSettingsToStore,
  type ConversationTabRecordForWorkspaceSettings,
  type WorkspaceSettings,
} from "./workspaceSettingsStore";
import { handlePanelMessageWithDeps } from "./sessionMessageHandlers";
import { registerExtensionCommands } from "./commandRegistry";
import {
  buildEditorContextState,
  isOpenCodeThinkingRequestCurrent,
  buildLoopMainResumeText,
  buildLoopSubtaskBatchCompletedText,
  buildLoopSubtaskBatchStartedText,
  buildLoopSubtaskExecutionGroupStartedText,
  buildLoopSubtaskRetryText as buildLoopSubtaskRetryTextWithLimit,
  buildLoopSubtaskStartedText,
  buildLoopTaskCompletedText,
  buildLoopTaskNeedsReviewText as buildLoopTaskNeedsReviewTextWithLimit,
  buildLoopTaskResumedText,
  buildLoopTaskStartedText,
  buildPanelStateWithDeps,
  buildSessionLabelFromPrompt,
  buildUserChatMessage,
  ensureLoopMainSubChatTranscriptWithDeps,
  formatLoopEstimatedRemainingRounds,
  formatLoopWriteFiles,
  buildPromptWithAutoContext as buildPromptWithAutoContextFromPanelStateBuilder,
  getLatestAssistantResponseForLongTermMemory,
  getLoopMainSubChatMainTitle,
  getLoopSubtaskDisplayTitle,
  isCliName,
  isLoopDebateGroupChatTask,
  maybeInjectLongTermMemoryForPromptWithEditorContext,
  normalizeLoopRound,
  normalizeLoopSubtaskId,
  normalizeLoopTaskId,
  resolveLoopConversationTabContextFromMessages,
  resolveLoopRunConversationTabContext,
  resolveLoopSubtaskConversationContextFromMessages,
  shouldUseFallbackSessionLabel as shouldUseFallbackSessionLabelWithSet,
  type LoopConversationTabContext,
  type LoopSubtaskConversationContext,
} from "./panelStateBuilder";
import {
  appendHiddenRetryErrorTraceMessage,
  buildHiddenRetryLimitMessage,
  buildHiddenRetryQueuedMessage,
  buildHiddenRetryStartedMessage,
  collectRecentLoopTaskIdsFromMessages,
  createHiddenRetryErrorTraceMessage,
  createGraphRunPanelCoordinator,
  createLoopDebateChatPanelCoordinator,
  createPanelDiagnosticsInspector,
  detectLoopVerificationSignals,
  formatLoopVerificationState,
  getAttemptFailureMessage,
  getErrorInfo,
  hasCompleteLoopCompletionMessages,
  HIDDEN_RETRY_MAX_RETRIES,
  isAbortErrorInfo,
  isCompleteLoopFinalSummaryContent,
  isHiddenRetryEligibleAttempt,
  isHiddenRetryEligibleErrorInfo,
  isLoopAnswerConclusionMessageForTask,
  isLoopFinalSummaryMessageForTask,
  isLoopResumePrompt,
  isLoopTaskResumable,
  isLoopTaskSessionCompatible,
  normalizeLoopResumePrompt,
  waitForHiddenRetryDelay,
  type ErrorInfo,
} from "./panelDiagnostics";
import {
  applyConfigOrder,
  buildCliCommandNotFoundMessage,
  buildCodexImageSupportWarningKey,
  buildLoopCompletedConclusionAndSummaryMarkdown,
  buildLoopDebateConsensusReachedText,
  buildLoopDebateConsensusStartedText,
  buildLoopDebateDialogueTurnStartedText,
  buildLoopDebateFinalStanceStartedText,
  buildLoopDebateModeratorFinishedText,
  buildLoopDebateModeratorStartedText,
  buildLoopDebateNeedsReviewText,
  buildLoopDebateParticipantFinishedText,
  buildLoopDebateParticipantRosterFailedText,
  buildLoopDebateParticipantRosterFinishedText,
  buildLoopDebateParticipantRosterStartedText,
  buildLoopDebateParticipantStartedText,
  buildLoopDebateParticipantsCollectedText,
  buildLoopDebateRerunText,
  buildLoopDebateReuseText,
  buildLoopDebateStartedText,
  buildLoopRoundSummary,
  buildLoopSupplementalRequirementsLines,
  createConfigHeartbeatCoordinator,
  getWorkspacePreferredConfigIdForCli as getWorkspacePreferredConfigIdForCliFromSettings,
  loadConfigStateWithDeps,
  matchesActiveConfig,
  normalizeCliInstallStatus,
  normalizeJson,
  normalizeLoopSupplementalRequirement,
  probeCodexImageSupportStatus,
  resolveLoopResumeRound,
  resolveModelConfigIdForCli as resolveModelConfigIdForCliFromConfigState,
  type CodexImageSupportStatus,
  type ConfigHeartbeatSnapshot,
} from "./webviewCommandCoordinator";
import {
  buildPromptHistoryState as buildPromptHistoryStateFromStore,
  clearPromptHistoryStore,
  cleanupPromptHistoryRetentionAcrossWorkspaces as cleanupPromptHistoryStoreRetentionAcrossWorkspaces,
  collectWorkspaceKeysForPromptHistoryCleanup as collectWorkspaceKeysForPromptHistoryStoreCleanup,
  deletePromptHistoryFile as deletePromptHistoryStoreFile,
  ensurePromptHistoryStore as ensurePromptHistoryStoreState,
  getPromptHistoryFilePath as getPromptHistoryStoreFilePath,
  loadPromptHistoryStore as loadPromptHistoryStoreFromStore,
  readPromptHistoryFile as readPromptHistoryStoreFile,
  recordPromptHistoryInStore,
  writePromptHistoryFile as writePromptHistoryStoreFile,
  type PromptHistoryStore,
} from "./promptHistoryStore";
import {
  appendAssistantChunkToStore,
  appendMessageToStore,
  buildTaskRunCompletionText as buildTaskRunCompletionTextWithLabels,
  cleanupTaskStoreRetention as cleanupTaskStoreRetentionWithDeps,
  getActiveAssistantContent as getActiveAssistantContentFromStore,
  isInteractiveMode,
  isLoopTaskRole,
  isMacTaskShell,
  isThinkingMode,
  isLoopTaskBlockedByMainAiFailureLimit as isLoopTaskBlockedByMainAiFailureLimitWithLimit,
  isLoopTaskCompleted,
  normalizeVisibleInteractiveMode,
  normalizeRawStreamContent,
  readTaskStore as readTaskStoreWithDeps,
  resolveLoopTaskSessionId as resolveLoopTaskSessionIdWithDeps,
  resolvePromptRunTargetSessionId as resolvePromptRunTargetSessionIdWithDeps,
  sendPanelMessageWithActiveTab,
  writeTaskStore as writeTaskStoreWithDeps,
  type LoopTaskRole,
  type LoopTaskStatus,
  type RunActivity,
  type TaskRunDraft,
  type TaskRunRecord,
  type TaskRunStatus,
  type TaskStore,
} from "./promptRunState";

let currentCli: CliName;
let statusBarItem: vscode.StatusBarItem | undefined;
let extensionUri: vscode.Uri;
let viewProvider: CliBridgeViewProvider | undefined;
let activeProcess: RunProcess | undefined;
let interactiveRunnerManager: InteractiveRunnerManager;
let activeInteractiveStop: (() => void) | null = null;
let activeAssistantMessageId: string | undefined;
let activeTraceMessageId: string | undefined;
let activeTraceBuffer = "";
let activeTraceSegmentLines: string[] = [];
let activeOpenCodeJsonlBuffer = "";
let activeOpenCodeDisplayedFinalText: string | null = null;
const activeTraceLineFilterState = createTraceLineFilterState();
let activeCompletionSent = false;
let activeRunId: string | undefined;
let activeTaskRun: TaskRunDraft | null = null;
let activeMessageTarget: ChatMessage[] | null = null;
let activeMessageIndex: number | null = null;
let activeSessionId: string | null = null;
let activeCliForRun: CliName | null = null;
let activeTabIdForRun: string | null = null;
let activeProcessTitleRunId: string | null = null;
let activeProcessTitleBase: string | null = null;
let extensionContext: vscode.ExtensionContext;
let sessionStore: SessionStore;
let promptHistoryStore: PromptHistoryStore;
let modelStore: CliModelStore;
let workspaceSettings: WorkspaceSettings = {};
let configManagerPanel: ConfigManagerPanel | undefined;
const loopDebateChatPanelsByTaskId = new Map<string, LoopDebateChatPanel>();
const graphRunPanelsByRunId = new Map<string, GraphRunPanel>();
let activeWorkspaceKey: string;
let pendingWorkspaceKey: string | null = null;
let lastResolvedWorkspaceCwd: string | undefined;
let updateCheckOverride: { autoCheckUpdates?: boolean; autoUpdate?: boolean } | null = null;
let configHeartbeatTimer: NodeJS.Timeout | null = null;
let configHeartbeatRunning = false;
let configHeartbeatSnapshot: ConfigHeartbeatSnapshot | null = null;
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
let isExtensionDeactivating = false;
const graphNodeRunTargetsByTabId = new Map<string, { graphRunId: string; graphNodeId: string }>();
const loopOrchestrationOwnership = createLoopOrchestrationOwnershipTracker();
let loopAutoWakeScheduler: LoopAutoWakeScheduler | null = null;
let graphAutoWakeScheduler: GraphAutoWakeScheduler | null = null;
const latestOpenCodeTaskListByTabId = new Map<string, OpenCodeTaskListItem[]>();
let sessionTabsController: SessionTabsController;
let sessionLifecycleController: SessionLifecycleController;
const SESSION_STORE_KEY = "sessionStore";
const SESSION_BUFFER_LIMIT = 4000;
const AI_TASK_RAW_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;
const OPENCODE_JSONL_PENDING_LINE_MAX_BYTES = 64 * 1024;
const LOCAL_SESSION_PREFIX = "local_";
const CONVERSATION_TAB_PREFIX = "tab_";
const DATA_DIR = path.join(os.homedir(), ".sinitek_cli");
const SESSION_DIR = path.join(DATA_DIR, "sessions");
const MESSAGE_DIR_ROOT = path.join(DATA_DIR, "messages");
const WORKSPACE_SETTINGS_DIR = path.join(DATA_DIR, "workspace-settings");
const PROMPT_HISTORY_DIR = path.join(DATA_DIR, "prompt-history");
const MODEL_STORE_FILE = path.join(DATA_DIR, "models.json");
const DEFAULT_MODEL_STORE_KEY = "__default__";
const WORKSPACE_KEY_FALLBACK = "no-workspace";
const WORKSPACE_KEY_HASH_LENGTH = 12;
const WORKSPACE_NAME_MAX_LENGTH = 32;
const AUTO_COMPACT_AFTER_RUN_MIN_DURATION_MS = 5 * 60 * 1000;
const LEGACY_SESSION_FILE = path.join(DATA_DIR, "sessions.json");
const LEGACY_MESSAGE_DIR = path.join(DATA_DIR, "messages");
const LEGACY_PROMPT_HISTORY_FILE = path.join(DATA_DIR, "prompt-history.json");
const TASK_STORE_FILE = path.join(DATA_DIR, "tasks.json");
const LOOP_DEFAULT_MAX_ROUNDS = 20;
const GRAPH_EXTENSION_INITIAL_PLANNER_MAX_CONCURRENT_NODES = 1;
const GRAPH_EXTENSION_EXECUTOR_MAX_CONCURRENT_NODES = GRAPH_DEFAULT_MAX_CONCURRENT_NODES;
const LOOP_MIN_MAX_ROUNDS = 1;
const LOOP_MAX_MAX_ROUNDS = 100;
const LOOP_PARALLEL_SUBTASK_MAX = 6;
const LOOP_SUBTASK_RETRY_MAX_RETRIES = 5;
const LOOP_SUBTASK_RETRY_DELAY_MS = 60 * 1000;
const LOOP_SUBTASK_PROMPT_MIN_LENGTH = 80;
const LOOP_DEBATE_DEFAULT_DEBATE_ROUND = 1;
const LOOP_DEBATE_ARTIFACT_SUMMARY_LIMIT = 1200;
const HISTORY_RETENTION_CLEAN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CODEX_IMAGE_MIN_VERSION = "0.2.0";
const CODEX_IMAGE_SUPPORT_CACHE_MS = 5 * 60 * 1000;
const CODEX_IMAGE_SUPPORT_TIMEOUT_MS = 5000;
const CONFIG_HEARTBEAT_INTERVAL_MS = 5000;
const COMMON_COMMAND_LABELS: Record<"compactContext", string> = {
  compactContext: t("common.compactContext"),
};
const CLI_INSTALL_TERMINAL_PREFIX = "CLI Install";
const CODEGRAPH_INSTALL_TERMINAL_NAME = "CodeGraph Install";
const WORKSPACE_HARNESS_TERMINAL_NAME = "Workspace Harness Setup";
const CODEGRAPH_SETUP_COMMAND = getCodeGraphInstallCommand({ initializeWorkspace: true });
const ARCHITECTURE_INITIALIZATION_DISPLAY_PROMPT = "初始化当前工作区 ARCHITECTURE.md";
const UNNAMED_SESSION_LABELS = new Set([
  t("session.unnamed", undefined, "zh-CN"),
  t("session.unnamed", undefined, "en"),
]);

function shouldUseFallbackSessionLabel(label: string | null | undefined): boolean {
  return shouldUseFallbackSessionLabelWithSet(label, UNNAMED_SESSION_LABELS);
}
const CLI_RULE_PATHS_GLOBAL: Record<CliName, string> = {
  codex: path.join(os.homedir(), ".codex", "AGENTS.md"),
  claude: path.join(os.homedir(), ".claude", "CLAUDE.md"),
  opencode: path.join(os.homedir(), ".opencode", "AGENTS.md"),
};
const CLI_RULE_FILENAMES_PROJECT: Record<CliName, string> = {
  codex: "AGENTS.md",
  claude: "CLAUDE.md",
  opencode: "AGENTS.md",
};

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

type InteractiveTabRun = {
  runId: string;
  tabId: string;
  cli: CliName;
  sessionId: string | null;
  prompt: string;
  startedAt: number;
  stop: () => void;
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
    getWorkspaceSettings: () => workspaceSettings,
    saveWorkspaceSettings,
    setCurrentSession,
    setWorkspaceInteractiveModeForCli,
    resolveAutoInteractiveModeForConversationTab,
    collectRunningLoopTaskIds,
    isLoopTaskRunning,
    getLoopTaskStatus: (taskId) => readLoopTaskRecord(taskId)?.status ?? null,
    resolveConversationTabLoopContext,
    buildSessionLabelFromPrompt,
  });
  sessionLifecycleController = createSessionLifecycleController({
    activeWorkspaceKey: () => activeWorkspaceKey,
    workspaceKeyFallback: WORKSPACE_KEY_FALLBACK,
    legacyMessageDir: LEGACY_MESSAGE_DIR,
    messageDirRoot: MESSAGE_DIR_ROOT,
    frozenThreadLimit: FROZEN_THREAD_LIMIT,
    historyRetentionDays: HISTORY_RETENTION_DAYS,
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
    persistSessionStore: (store) => void persistSessionStore(store),
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
      cli: activeCliForRun,
      sessionId: activeSessionId,
      tabId: activeTabIdForRun,
      messageTarget: activeMessageTarget,
    }),
    setPrimaryRunSessionState: (patch) => {
      if (patch.sessionId !== undefined) {
        activeSessionId = patch.sessionId;
      }
      if (patch.messageTarget !== undefined) {
        activeMessageTarget = patch.messageTarget;
      }
      if (patch.messageIndex !== undefined) {
        activeMessageIndex = patch.messageIndex;
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
      activeRunId,
      activeCliForRun,
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
  initializeSessionControllers();
  sessionStore = loadSessionStore();
  promptHistoryStore = loadPromptHistoryStore();
  workspaceSettings = loadWorkspaceSettings();
  migrateLegacyMultiAgentSettingFromWorkspace();
  migrateLegacyAutoCompactContextAfterRunFromWorkspace();
  // Restore currentCli from workspace settings, or use default
  currentCli = workspaceSettings.currentCli || getDefaultCli();
  modelStore = loadModelStore();
  initializeConversationTabsFromWorkspaceSettings();
  repairSupersededLocalSessions({ notifyPanel: false });
  syncCurrentSessionWithActiveTab();
  initializeLoopAutoWakeScheduler(context);
  initializeGraphAutoWakeScheduler(context);
  void initLogger().then(() => {
    scheduleLogRetentionCleanup();
  });
  setDebugLogging(getDebugLogging());
  configManagerPanel = new ConfigManagerPanel(extensionUri, {
    onConfigChanged: () => {
      void postPanelState();
    },
  });
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
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CliBridgeViewProvider.viewId, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  registerExtensionCommands(context, {
    isCliName,
    getCurrentCli: () => currentCli,
    setCurrentCli,
    runCli,
    revealPanelView,
    postPanelState,
    openLoopGroupChatPanel,
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
      restoreLoopAutoWakeSchedules();
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
  loopAutoWakeScheduler?.dispose();
  loopAutoWakeScheduler = null;
  graphAutoWakeScheduler?.dispose();
  graphAutoWakeScheduler = null;
  stopAllRuns();
}

function stopAllRuns(): void {
  isExtensionDeactivating = true;

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

  const activeStop = activeInteractiveStop;
  if (activeStop) {
    try {
      activeStop();
    } catch (error) {
      void logError("deactivate-stop-active-interactive-failed", {
        cli: activeCliForRun,
        runId: activeRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (activeInteractiveStop === activeStop) {
        activeInteractiveStop = null;
      }
    }
  }

  if (activeProcess) {
    try {
      stopActiveRun();
    } catch (error) {
      void logError("deactivate-stop-active-process-failed", {
        cli: activeCliForRun ?? currentCli,
        runId: activeRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        activeProcess.kill();
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

async function handlePanelMessage(message: PanelMessage): Promise<void> {
  if (message.type === "updateOpenCodeVariant") {
    await handleUpdateOpenCodeVariantMessage(message, {
      updateOpenCodeVariant: updateOpenCodeVariantForCurrentSelection,
      postPanelState,
    });
    return;
  }
  await handlePanelMessageWithDeps(message, {
    ensureWorkspaceSessionStore,
    postPanelState,
    sendSessionMessagesToPanel,
    getCurrentCli: () => currentCli,
    setCurrentCliValue: (cli) => { currentCli = cli; },
    getCurrentSessionId,
    showWebviewError: (title, detail, options) => void showErrorWithActions(title, detail, options),
    inspectModelManagerState,
    getActiveConversationTabBinding,
    setCurrentCli,
    disposeInteractiveRunnerIfUnused,
    syncCurrentSessionWithActiveTab,
    getActiveConfigIdForCli,
    selectCliModel,
    selectCliLoopModel,
    updateOpenCodeRoleModel: updateOpenCodeRoleModelForConfig,
    addCliModel,
    renameCliModel,
    deleteCliModel,
    moveCliModel,
    repairSupersededLocalSession,
    findConversationTabIdBySession,
    setActiveConversationTab,
    updateStatusBar,
    getWorkspaceSettings: () => workspaceSettings,
    saveWorkspaceSettings,
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
    setWorkspaceInteractiveModeForCli,
    resetConversationTabSession,
    getConfigManagerPanel: () => configManagerPanel,
    applyConfigById,
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
    setWorkspaceLoopExecutionModeForCli,
    loadModelStore: () => { modelStore = loadModelStore(); },
    normalizeLoopMaxRounds,
    normalizeToolSettingsLocale,
    isCliName,
    updateStoredToolSettings,
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
    getWorkspaceLoopExecutionMode,
    buildPromptWithAutoContext: buildPromptWithAutoContextFromPanelStateBuilder,
    maybeInjectLongTermMemoryForPrompt: (displayPrompt, modelPrompt, contextTags) => (
      maybeInjectLongTermMemoryForPromptWithEditorContext(displayPrompt, modelPrompt, contextTags, {
        runtimeSettings: buildLongTermMemoryRuntimeSettings(),
        memoryPaths: getActiveWorkspaceMemoryPaths(),
        locale: resolveLocale(),
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
  });
}

async function buildPanelState(): Promise<PanelState> {
  ensureWorkspaceSessionStore();
  const configState = await loadConfigState(currentCli);
  await refreshOpenCodeThinkingState(configState);
  return buildPanelStateFromConfigState(configState);
}

async function buildPanelStateWithConfigState(
  configState: PanelState["configState"]
): Promise<PanelState> {
  ensureWorkspaceSessionStore();
  await refreshOpenCodeThinkingState(configState);
  return buildPanelStateFromConfigState(configState);
}

function buildPanelStateFromConfigState(configState: PanelState["configState"]): PanelState {
  return buildPanelStateWithDeps({
    currentCli,
    configState,
    workspaceSettings,
    processPlatform: process.platform,
    cliRulePathsGlobal: CLI_RULE_PATHS_GLOBAL,
    getWorkspaceConfiguration: () => vscode.workspace.getConfiguration("sinitek-cli-tools"),
    getAutoAddEditorContextTags,
    getEffectiveLongTermMemoryEnabled,
    getGlobalAutoCompactContextAfterRun,
    getGlobalMultiAgentEnabled,
    getGlobalLoopMaxRounds,
    getGlobalLoopSubtaskMaxThinkingMode,
    buildWorkspaceLoopExecutionModeByCli,
    getDebugLogging,
    getLocaleSetting,
    getMacTaskShell,
    getEffectiveThinkingMode,
    openCodeThinking: openCodeThinkingState,
    openCodeSmallThinking: openCodeSmallThinkingState,
    openCodeModels: openCodeModelsState,
    getWorkspaceInteractiveMode,
    isInteractiveSupported,
    getProjectRulePaths,
    buildSessionState,
    buildConversationTabsState,
    buildPromptHistoryState,
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

  const configId = resolveModelConfigIdForCli("opencode", configState);
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

const inspectModelManagerState = createPanelDiagnosticsInspector({
  getWorkspaceKey: () => activeWorkspaceKey,
  getDataDir: () => DATA_DIR,
  getModelStoreFile: () => MODEL_STORE_FILE,
  getWorkspaceSettings: () => workspaceSettings,
  getActiveConfigIdForCli,
  normalizeCliModelName,
  ensureCliModelStore,
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
  getSnapshot: () => configHeartbeatSnapshot,
  setSnapshot: (snapshot) => { configHeartbeatSnapshot = snapshot; },
  isRunning: () => configHeartbeatRunning,
  setRunning: (running) => { configHeartbeatRunning = running; },
  getTimer: () => configHeartbeatTimer,
  setTimer: (timer) => { configHeartbeatTimer = timer; },
  loadConfigState,
  getLastConfigStateLoadError: (cli) => lastConfigStateLoadErrorByCli[cli] ?? null,
  readNormalizedModelStoreFromDisk,
  setModelStore: (store) => { modelStore = store; },
  resolveModelConfigIdForCli,
  ensureCliModelStore,
  normalizeCliModelName,
  mergeUniqueModelNames,
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
  migrateLegacyMultiAgentSettingFromWorkspace();
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
}

function normalizeToolSettingsLocale(value: unknown): ToolSettingsLocale | null {
  return value === "zh-CN" || value === "en" || value === "auto" ? value : null;
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

function migrateLegacyMultiAgentSettingFromWorkspace(): void {
  const hasLegacyWorkspaceValue = typeof workspaceSettings.multiAgentEnabled === "boolean"
    || typeof workspaceSettings.codexMultiAgentEnabled === "boolean";
  if (!hasLegacyWorkspaceValue) {
    return;
  }

  const globalSettings = readToolSettings();
  if (typeof globalSettings.multiAgentEnabled !== "boolean") {
    const migrated = saveStoredToolSettings({
      ...globalSettings,
      multiAgentEnabled: resolveGlobalMultiAgentEnabled(globalSettings, workspaceSettings),
    });
    if (!migrated) {
      return;
    }
  }

  delete workspaceSettings.multiAgentEnabled;
  delete workspaceSettings.codexMultiAgentEnabled;
  saveWorkspaceSettings(workspaceSettings);
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

  const locale = normalizeToolSettingsLocale(getExplicitGlobalConfigValue<unknown>("locale"));
  if (!current.locale && locale) {
    next.locale = locale;
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
    };
  }
  return {
    codex: path.join(root, CLI_RULE_FILENAMES_PROJECT.codex),
    claude: path.join(root, CLI_RULE_FILENAMES_PROJECT.claude),
    opencode: path.join(root, CLI_RULE_FILENAMES_PROJECT.opencode),
  };
}

async function readCliRules(cli: CliName, scope: "global" | "project"): Promise<string> {
  const targetPath = scope === "global"
    ? CLI_RULE_PATHS_GLOBAL[cli]
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
    ? CLI_RULE_PATHS_GLOBAL[cli]
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

async function applyConfigById(cli: CliName, configId: string): Promise<void> {
  if (!configId) {
    return;
  }
  const config = await configService.getConfigById(cli, configId);
  if (!config) {
    void vscode.window.showWarningMessage(t("config.notFound"));
    return;
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
  setWorkspaceActiveConfigId(cli, configId);
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
  const multiAgentEnabled = getGlobalMultiAgentEnabled();
  const runtimeConfig = applyOpenCodeRuntimeMultiAgentPermission(
    overlay.config,
    multiAgentEnabled,
  );
  const runtimeConfigContent = JSON.stringify(runtimeConfig);
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
    multiAgentEnabled,
    compatibilityFields: ["model", "small_model"],
  });
  return {
    envOverrides: applyOpenCodeRuntimeMultiAgentEnvOverrides(
      configService.parseEnvText(current.envContent ?? ""),
      multiAgentEnabled,
    ),
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
  const previousCli = currentCli;
  currentCli = cli;
  updateStatusBar();

  const syncActiveTab = options.syncActiveTab !== false;
  if (syncActiveTab) {
    const activeTab = getActiveConversationTab();
    if (activeTab && activeTab.cli !== cli) {
      switchConversationTabCli(activeTab, cli);
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

const loopDebateChatPanelCoordinator = createLoopDebateChatPanelCoordinator({
  getExtensionUri: () => extensionUri,
  panelsByTaskId: loopDebateChatPanelsByTaskId,
  defaultDebateRound: LOOP_DEBATE_DEFAULT_DEBATE_ROUND,
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
  runLoopPrompt,
  stopRunsForTask: stopLoopRunsForTask,
  markTaskStoppedByUser: markLoopTaskStoppedByUser,
  postPanelState,
  getActiveConversationTaskId: () => (
    normalizeLoopTaskId(activeTaskRun?.loopTaskId)
      ?? resolveActiveConversationLoopTaskId()
  ),
  showInformationMessage: (message) => { void vscode.window.showInformationMessage(message); },
  showWarningMessage: (message) => { void vscode.window.showWarningMessage(message); },
  pickTask: pickLoopDebateTask,
  t,
});

const graphRunPanelCoordinator = createGraphRunPanelCoordinator({
  getExtensionUri: () => extensionUri,
  panelsByRunId: graphRunPanelsByRunId,
  readRunRecord: (graphRunId) => readGraphRunRecord(graphRunId),
  findLatestRun: () => findLatestGraphRun({
    workspaceKey: activeWorkspaceKey,
    cli: currentCli,
  }),
  readEvents: readGraphEvents,
  continueRun: (graphRunId) => continueGraphRunFromPanel(graphRunId),
  supplementRun: (graphRunId, prompt) => supplementGraphRunFromPanel(graphRunId, prompt),
  retryNode: (graphRunId, nodeId) => retryGraphNodeFromPanel(graphRunId, nodeId),
  feedbackNode: (graphRunId, nodeId) => feedbackGraphNodeFromPanel(graphRunId, nodeId),
  stopRun: (graphRunId) => stopGraphRunFromPanel(graphRunId),
  showInformationMessage: (message) => { void vscode.window.showInformationMessage(message); },
  showWarningMessage: (message) => { void vscode.window.showWarningMessage(message); },
  t,
});

function initializeLoopAutoWakeScheduler(context: vscode.ExtensionContext): void {
  loopAutoWakeScheduler?.dispose();
  loopAutoWakeScheduler = new LoopAutoWakeScheduler({
    readTask: readLoopTaskRecord,
    onWake: attemptLoopTaskAutoWake,
    onError: (taskId, error) => {
      void logError("loop-auto-wake-scheduler-error", {
        taskId,
        error: errorToMessage(error),
      });
    },
  });
  context.subscriptions.push(loopAutoWakeScheduler);
  restoreLoopAutoWakeSchedules();
}

function restoreLoopAutoWakeSchedules(): void {
  if (!loopAutoWakeScheduler) {
    return;
  }
  const sleepingTasks = listLoopGroupChatTasks().filter((task) => (
    task.workspaceKey === activeWorkspaceKey
    && task.status === "sleeping"
  ));
  loopAutoWakeScheduler.restore(sleepingTasks);
}

function scheduleLoopTaskAutoWake(task: LoopTaskRecord): void {
  loopAutoWakeScheduler?.schedule(task);
  refreshOpenLoopGroupChatPanelForTask(task.id);
}

function cancelLoopTaskAutoWake(taskId: string): void {
  loopAutoWakeScheduler?.cancel(taskId);
}

function attemptLoopTaskAutoWake(taskId: string): LoopAutoWakeAttemptResult {
  const task = readLoopTaskRecord(taskId);
  if (!task || task.status !== "sleeping") {
    return "discard";
  }
  if (task.workspaceKey !== activeWorkspaceKey) {
    return "discard";
  }
  if (typeof task.autoWakeAt !== "number" || task.autoWakeAt > Date.now()) {
    return "retry";
  }

  const target = resolveLoopMainPromptTarget(task);
  if (!target || isTabRunActive(target.tabId) || collectRunningLoopTaskIds().has(task.id)) {
    return "retry";
  }

  const activeConfigId = getActiveConfigIdForCli(target.cli);
  const resumePrompt = t("run.loopAutoWakePrompt", { taskId: task.id });
  const claimedTask = updateLoopTaskRecord(task.id, {
    status: "running",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    autoSleepStartedAt: undefined,
    autoWakeAt: undefined,
    autoSleepReason: undefined,
    updatedAt: Date.now(),
  });
  if (!claimedTask || claimedTask.status !== "running") {
    return "retry";
  }

  refreshOpenLoopGroupChatPanelForTask(task.id);
  void logInfo("loop-auto-wake-started", {
    taskId: task.id,
    scheduledWakeAt: task.autoWakeAt,
    tabId: target.tabId,
    cli: target.cli,
  });
  void runLoopPrompt({
    displayPrompt: resumePrompt,
    modelPrompt: resumePrompt,
    contextTags: [],
    model: getSelectedCliModel(target.cli, activeConfigId) ?? undefined,
    loopExecutionMode: normalizeLoopExecutionMode(task.executionMode),
    loopContinuePrompt: resumePrompt,
  }, {
    targetTabId: target.tabId,
    resumeTaskId: task.id,
    resumeRequested: true,
  });
  return "started";
}

function initializeGraphAutoWakeScheduler(context: vscode.ExtensionContext): void {
  graphAutoWakeScheduler?.dispose();
  graphAutoWakeScheduler = new GraphAutoWakeScheduler({
    readRun: (graphRunId) => readGraphRunRecord(graphRunId).run,
    onWake: attemptGraphRunAutoWake,
    onError: (graphRunId, error) => {
      void logError("graph-auto-wake-scheduler-error", {
        graphRunId,
        error: errorToMessage(error),
      });
    },
  });
  context.subscriptions.push(graphAutoWakeScheduler);
  restoreGraphAutoWakeSchedules();
}

function restoreGraphAutoWakeSchedules(): void {
  if (!graphAutoWakeScheduler) {
    return;
  }
  const result = listGraphRuns({
    workspaceKey: activeWorkspaceKey,
    statuses: ["sleeping"],
  });
  if (result.errors.length > 0) {
    void logError("graph-auto-wake-restore-partial-read", {
      unreadableStoreFiles: result.diagnostics.unreadableStoreFiles,
      errors: result.errors.slice(0, 3),
    });
  }
  graphAutoWakeScheduler.restore(result.runs);
}

function scheduleGraphRunAutoWake(run: GraphRunRecord): void {
  if (run.status === "sleeping" && resolveGraphRunAutoWakeAt(run) !== null) {
    graphAutoWakeScheduler?.schedule(run);
  } else {
    graphAutoWakeScheduler?.cancel(run.id);
  }
  refreshOpenGraphRunPanelForRun(run.id);
}

function cancelGraphRunAutoWake(graphRunId: string): void {
  graphAutoWakeScheduler?.cancel(graphRunId);
}

function attemptGraphRunAutoWake(graphRunId: string): GraphAutoWakeAttemptResult {
  const lookup = readGraphRunRecord(graphRunId);
  const run = lookup.run;
  if (!run || run.status !== "sleeping") {
    return "discard";
  }
  if (run.workspaceKey !== activeWorkspaceKey) {
    return "discard";
  }
  const wakeAt = resolveGraphRunAutoWakeAt(run);
  if (wakeAt === null || wakeAt > Date.now()) {
    return "retry";
  }
  const target = resolveGraphRunExistingPromptTarget(run);
  if (target && isTabRunActive(target.tabId)) {
    return "retry";
  }
  void continueGraphRunFromStore(graphRunId, {
    source: "auto_wake",
    reason: "Graph sleep wakeAt is due.",
    preferredTargetTabId: target?.tabId ?? null,
  }).then((result) => {
    if (!result.ok) {
      void logError("graph-auto-wake-failed", {
        graphRunId,
        message: result.message,
      });
    }
  });
  return "started";
}

async function continueGraphRunFromPanel(graphRunId: string): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return continueGraphRunFromStore(graphRunId, {
    source: "panel",
    reason: "Panel requested Graph run continue.",
  });
}

async function supplementGraphRunFromPanel(
  graphRunId: string,
  prompt: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const supplementalRequirement = normalizeGraphSupplementalRequirement(prompt);
  if (!supplementalRequirement) {
    return {
      ok: false,
      changed: false,
      message: graphRuntimeMessage("controlRejected", { detail: graphRuntimeMessage("supplementEmpty") }),
      run: lookup.run,
    };
  }
  if (lookup.run.status === "completed" || lookup.run.status === "stopped") {
    return {
      ok: false,
      changed: false,
      message: graphRuntimeMessage("controlRejected", { detail: graphRuntimeMessage("supplementUnavailable") }),
      run: lookup.run,
    };
  }
  const nextRequirements = appendGraphSupplementalRequirement(
    lookup.run.supplementalRequirements,
    supplementalRequirement,
  );
  const timestamp = Date.now();
  const persisted = updateGraphRunRecord(lookup.run.id, {
    supplementalRequirements: nextRequirements,
    updatedAt: timestamp,
  }) ?? lookup.run;
  appendGraphSupplementalRequirementToCommunication(persisted, supplementalRequirement, timestamp);
  appendGraphEvent(persisted.eventsFile, {
    runId: persisted.id,
    type: "run.updated",
    timestamp,
    summary: "Graph supplemental requirement added from panel.",
    data: {
      source: "panel",
      supplementalRequirementCount: nextRequirements.length,
    },
  });
  refreshOpenGraphRunPanelForRun(persisted.id);
  await postPanelState();
  return {
    ok: true,
    changed: true,
    message: graphRuntimeMessage("supplementAccepted"),
    run: persisted,
  };
}

function normalizeGraphSupplementalRequirement(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function appendGraphSupplementalRequirement(
  existing: readonly string[] | undefined,
  nextItem: string,
): string[] {
  const normalizedExisting = Array.isArray(existing)
    ? existing.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return [...normalizedExisting, nextItem];
}

function appendGraphSupplementalRequirementToCommunication(
  run: GraphRunRecord,
  requirement: string,
  timestamp: number,
): void {
  const body = [
    `- 时间：${new Date(timestamp).toISOString()}`,
    `- Graph 运行：${run.id}`,
    requirement,
  ].join("\n");
  try {
    fs.mkdirSync(path.dirname(run.mainCommunicationFile), { recursive: true });
    fs.appendFileSync(run.mainCommunicationFile, `\n## 补充需求\n${body}\n`, "utf8");
  } catch (error) {
    void logError("graph-supplemental-requirement-write-error", {
      graphRunId: run.id,
      filePath: run.mainCommunicationFile,
      error: String(error),
    });
  }
}

async function retryGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const control = await retryGraphNodeForRun(lookup.run, nodeId, {
    source: "panel",
    reason: "Panel requested Graph node retry.",
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "retry");
  }
  const persisted = persistGraphRunControlResult(control);
  scheduleGraphRunAutoWake(persisted);
  return tickGraphRunToPauseFromControl(persisted, {
    source: "panel",
    reason: "Panel requested Graph node retry.",
    preferredTargetTabId: null,
    successKey: "retryStarted",
  });
}

async function skipGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const control = await skipGraphNodeForRun(lookup.run, nodeId, {
    source: "panel",
    reason: "Panel requested Graph node skip and downstream continue.",
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "skip");
  }
  const persisted = persistGraphRunControlResult(control);
  scheduleGraphRunAutoWake(persisted);
  return tickGraphRunToPauseFromControl(persisted, {
    source: "panel",
    reason: "Panel requested Graph node skip and downstream continue.",
    preferredTargetTabId: null,
    successKey: "skipStarted",
  });
}

async function feedbackGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const control = await feedbackGraphNodeForRun(lookup.run, nodeId, {
    source: "panel",
    reason: "Panel requested Graph upstream feedback rollback.",
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "feedback");
  }
  const persisted = persistGraphRunControlResult(control);
  scheduleGraphRunAutoWake(persisted);
  return tickGraphRunToPauseFromControl(persisted, {
    source: "panel",
    reason: "Panel requested Graph upstream feedback rollback.",
    preferredTargetTabId: null,
    successKey: "feedbackStarted",
  });
}

async function stopGraphRunFromPanel(graphRunId: string): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const target = resolveGraphRunExistingPromptTarget(lookup.run);
  const stoppedCliRuns = stopActiveCliRunsForGraphRun(graphRunId);
  const control = await stopGraphRunRecord(lookup.run, {
    source: "panel",
    reason: "Panel requested Graph run stop.",
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "stop");
  }
  const persisted = persistGraphRunControlResult(control);
  cancelGraphRunAutoWake(graphRunId);
  refreshOpenGraphRunPanelForRun(graphRunId);
  if (target) {
    sendGraphMainRunTerminalStatus(target, persisted);
  }
  await postPanelState();
  return {
    ok: true,
    changed: control.changed,
    message: graphRuntimeMessage(stoppedCliRuns > 0 ? "stopWithCli" : "stopStateOnly", {
      graphRunId,
      count: stoppedCliRuns,
    }),
    run: persisted,
  };
}

async function continueGraphRunFromStore(
  graphRunId: string,
  options: {
    source: GraphRunControlSource;
    reason: string;
    preferredTargetTabId?: string | null;
  },
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const control = await resumeGraphRunRecord(lookup.run, {
    source: options.source,
    reason: options.reason,
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "continue");
  }
  const persisted = control.changed
    ? persistGraphRunControlResult(control)
    : control.run;
  cancelGraphRunAutoWake(persisted.id);
  return tickGraphRunToPauseFromControl(persisted, {
    source: options.source,
    reason: options.reason,
    preferredTargetTabId: options.preferredTargetTabId ?? null,
    successKey: "continueStarted",
  });
}

async function tickGraphRunToPauseFromControl(
	  run: GraphRunRecord,
	  options: {
	    source: GraphRunControlSource;
	    reason: string;
	    preferredTargetTabId?: string | null;
	    successKey: "continueStarted" | "retryStarted" | "feedbackStarted" | "skipStarted";
	  },
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const target = await resolveGraphRunPromptTarget(run, options.preferredTargetTabId ?? null);
  if (!target) {
    return {
      ok: false,
      changed: false,
      message: graphRuntimeMessage("targetMissing", { graphRunId: run.id }),
      run,
    };
  }
  if (isTabRunActive(target.tabId)) {
    return {
      ok: false,
      changed: false,
      message: graphRuntimeMessage("targetBusy", { graphRunId: run.id }),
      run,
    };
  }

  const activeConfigId = getActiveConfigIdForCli(target.cli);
  const prompt = graphRuntimeMessage("resumePrompt", { graphRunId: run.id });
  const modelFields = resolveGraphResumePromptModels(run, target.cli, activeConfigId);
  const promptInput = await hydrateOpenCodePromptRoleModels({
    displayPrompt: prompt,
    modelPrompt: run.rootPrompt || prompt,
    contextTags: [],
    ...modelFields,
    graphRunId: run.id,
  }, target.cli);
  const outcome = await tickGraphRunToPause(run, promptInput, target);
  return {
    ok: true,
    changed: true,
    message: outcome.progressed
      ? graphRuntimeMessage(options.successKey, { graphRunId: outcome.run.id })
      : graphRuntimeMessage("noRunnableNode", { graphRunId: outcome.run.id }),
    run: outcome.run,
  };
}

function persistGraphRunControlResult(result: GraphRunControlResult): GraphRunRecord {
  return updateGraphRunRecord(result.run.id, result.run) ?? result.run;
}

function persistGraphRunTickState(nextRun: GraphRunRecord): GraphRunRecord {
  const latest = readGraphRunRecord(nextRun.id).run;
  if (latest?.status === "stopped" && nextRun.status !== "stopped") {
    refreshOpenGraphRunPanelForRun(latest.id);
    return latest;
  }
  const persisted = updateGraphRunRecord(nextRun.id, nextRun) ?? nextRun;
  refreshOpenGraphRunPanelForRun(persisted.id);
  return persisted;
}

function createGraphPanelMissingRunResult(
  graphRunId: string,
  errors: readonly { storeFile: string; error: string }[] = [],
): { ok: false; changed: false; message: string; run: null } {
  return {
    ok: false,
    changed: false,
    message: errors.length
      ? graphRuntimeMessage("runReadFailed", { graphRunId, detail: errors.slice(0, 3).map((error) => `${error.storeFile}: ${error.error}`).join("\n") })
      : graphRuntimeMessage("runMissing", { graphRunId }),
    run: null,
  };
}

function toGraphPanelControlResult(
  result: GraphRunControlResult,
  action: "continue" | "retry" | "feedback" | "skip" | "stop",
): { ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null } {
  if (result.ok) {
    const acceptedMessageKey: Record<typeof action, GraphRuntimeMessageKey> = {
      continue: "continueAccepted",
      feedback: "feedbackAccepted",
      retry: "retryAccepted",
      skip: "skipAccepted",
      stop: "stopAccepted",
    };
    return {
      ok: true,
      changed: result.changed,
      message: graphRuntimeMessage(acceptedMessageKey[action]),
      run: result.run,
    };
  }
  return {
    ok: false,
    changed: false,
    message: graphRuntimeMessage("controlRejected", {
      detail: formatGraphControlBlockedReason(result.reason, result.message),
    }),
    run: result.run,
  };
}

function refreshOpenGraphRunPanelForRun(graphRunId: string): void {
  graphRunPanelCoordinator.refreshOpenPanelForRun(graphRunId);
}

function resolveGraphRunExistingPromptTarget(run: GraphRunRecord): PromptRunTarget | null {
  if (run.sessionId) {
    const existingTabId = findConversationTabIdBySession(run.cli, run.sessionId);
    const existingTarget = resolveGraphRunPromptTargetByTabId(existingTabId, run.cli);
    if (existingTarget) {
      return existingTarget;
    }
  }
  const activeTab = getActiveConversationTab();
  if (activeTab?.cli === run.cli) {
    return resolveGraphRunPromptTargetByTabId(activeTab.id, run.cli);
  }
  return null;
}

async function resolveGraphRunPromptTarget(
  run: GraphRunRecord,
  preferredTabId: string | null,
): Promise<PromptRunTarget | null> {
  const preferredTarget = resolveGraphRunPromptTargetByTabId(preferredTabId, run.cli);
  if (preferredTarget) {
    await switchVisibleConversationTabForLoop(preferredTarget.tabId);
    return preferredTarget;
  }

  const existingTarget = resolveGraphRunExistingPromptTarget(run);
  if (existingTarget) {
    await switchVisibleConversationTabForLoop(existingTarget.tabId);
    return existingTarget;
  }

  const tabId = addConversationTab(run.cli, run.sessionId ?? null);
  if (!tabId) {
    return null;
  }
  await switchVisibleConversationTabForLoop(tabId);
  return resolveGraphRunPromptTargetByTabId(tabId, run.cli);
}

function resolveGraphRunPromptTargetByTabId(tabId: string | null, cli: CliName): PromptRunTarget | null {
  const target = resolvePromptRunTarget(tabId);
  return target?.cli === cli ? target : null;
}

function stopActiveCliRunsForGraphRun(graphRunId: string): number {
  let stoppedCount = 0;
  const parallelTabIds = Array.from(parallelRunsByTabId.entries())
    .filter(([, run]) => run.graphRunId === graphRunId)
    .map(([tabId]) => tabId);
  parallelTabIds.forEach((tabId) => {
    if (stopParallelRunForTab(tabId, graphRuntimeMessage("stopRequested"))) {
      stoppedCount += 1;
    }
  });

  const interactiveTabIds = Array.from(interactiveRunsByTabId.entries())
    .filter(([, run]) => run.graphRunId === graphRunId && !run.stopped)
    .map(([tabId]) => tabId);
  interactiveTabIds.forEach((tabId) => {
    const run = interactiveRunsByTabId.get(tabId);
    if (run && !run.stopped) {
      run.stop();
      stoppedCount += 1;
    }
  });

  if (isPrimaryRunActive() && activeTaskRun?.graphRunId === graphRunId) {
    stopActiveRun();
    stoppedCount += 1;
  }
  return stoppedCount;
}

function formatGraphControlBlockedReason(reason: string | undefined, fallback: string): string {
  const zh = resolveLocale() === "zh-CN";
  const messages: Record<string, string> = zh ? {
    already_running: "运行已在执行中",
    already_stopped: "运行已停止",
    completed_run: "已完成的运行不能继续操作",
	    terminal_run: "终态运行不能继续操作",
	    not_resumable: "当前状态不可继续",
	    node_not_found: "节点不存在",
	    node_not_retryable: "节点当前不可重试",
	    node_not_skippable: "节点当前不可跳过",
	    feedback_not_available: "该节点当前没有可回退的上游 checkpoint；direct 模式不支持 Feedback rollback",
	    passed_descendants: "该节点已有通过的下游节点，需要后续级联重置能力",
	    worktree_reset_failed: "Graph worktree 回退失败",
	  } : {
    already_running: "The run is already running.",
    already_stopped: "The run is already stopped.",
    completed_run: "Completed runs cannot be changed.",
	    terminal_run: "Terminal runs cannot be changed.",
	    not_resumable: "The run is not resumable from its current status.",
	    node_not_found: "The node was not found.",
	    node_not_retryable: "The node is not retryable from its current status.",
	    node_not_skippable: "The node is not skippable from its current status.",
	    feedback_not_available: "The node has no available upstream checkpoint; direct mode does not support Feedback rollback.",
	    passed_descendants: "The node has passed descendants and needs a later cascade reset flow.",
	    worktree_reset_failed: "The Graph worktree could not be reset.",
	  };
  return reason ? (messages[reason] ?? fallback) : fallback;
}

type GraphRuntimeMessageKey =
	  | "continueAccepted"
	  | "continueStarted"
	  | "controlRejected"
	  | "feedbackAccepted"
	  | "feedbackStarted"
	  | "noRunnableNode"
  | "resumePrompt"
  | "retryAccepted"
  | "retryStarted"
  | "runMissing"
  | "runReadFailed"
  | "skipAccepted"
  | "skipStarted"
  | "stopAccepted"
  | "stopRequested"
  | "stopStateOnly"
  | "stopWithCli"
  | "supplementAccepted"
  | "supplementEmpty"
  | "supplementUnavailable"
  | "targetBusy"
  | "targetMissing";

function graphRuntimeMessage(
  key: GraphRuntimeMessageKey,
  params: Record<string, string | number | undefined> = {},
): string {
  const zh = resolveLocale() === "zh-CN";
  const graphRunId = String(params.graphRunId ?? "");
  const detail = String(params.detail ?? "");
  const count = String(params.count ?? "");
	  const messages: Record<GraphRuntimeMessageKey, string> = zh ? {
	    continueAccepted: "Graph 继续请求已记录。",
	    continueStarted: `Graph 运行已继续：${graphRunId}`,
	    controlRejected: `Graph 操作未执行：${detail}`,
	    feedbackAccepted: "Graph 上游返工回退请求已记录。",
	    feedbackStarted: `Graph 已回退上游节点并继续运行：${graphRunId}`,
	    noRunnableNode: `Graph 运行没有可执行节点，已刷新面板：${graphRunId}`,
    resumePrompt: `继续 Graph 运行：${graphRunId}`,
    retryAccepted: "节点重试请求已记录。",
    retryStarted: `Graph 节点已重试并继续运行：${graphRunId}`,
    runMissing: `找不到 Graph 运行：${graphRunId}`,
    runReadFailed: `Graph 运行读取失败：${graphRunId}\n${detail}`.trim(),
    skipAccepted: "节点跳过请求已记录。",
    skipStarted: `Graph 已跳过阻塞节点并继续下游：${graphRunId}`,
    stopAccepted: "Graph 停止请求已记录。",
    stopRequested: "Graph 运行已由用户请求停止。",
    stopStateOnly: `Graph 运行状态已落盘为 stopped：${graphRunId}。未找到活动 CLI 进程映射；真实 CLI 进程未被确认停止。`,
    stopWithCli: `Graph 运行状态已落盘为 stopped：${graphRunId}。已向 ${count} 个已映射活动 CLI 运行发送停止请求；真实进程是否退出取决于底层 CLI 响应。`,
    supplementAccepted: "Graph 补充消息已记录，后续节点会读取。",
    supplementEmpty: "补充消息不能为空。",
    supplementUnavailable: "已完成或已停止的 Graph 运行不能补充消息。",
    targetBusy: `Graph 运行目标标签页当前有任务在执行：${graphRunId}`,
    targetMissing: `无法为 Graph 运行找到可用执行标签页：${graphRunId}`,
	  } : {
	    continueAccepted: "The Graph continue request was recorded.",
	    continueStarted: `Graph run continued: ${graphRunId}`,
	    controlRejected: `Graph action was not run: ${detail}`,
	    feedbackAccepted: "The Graph upstream feedback rollback request was recorded.",
	    feedbackStarted: `Graph upstream feedback rollback started and the run continued: ${graphRunId}`,
	    noRunnableNode: `Graph run has no executable node; the panel was refreshed: ${graphRunId}`,
    resumePrompt: `Continue Graph run: ${graphRunId}`,
    retryAccepted: "The node retry request was recorded.",
    retryStarted: `Graph node retry started and the run continued: ${graphRunId}`,
    runMissing: `Graph run was not found: ${graphRunId}`,
    runReadFailed: `Graph run could not be read: ${graphRunId}\n${detail}`.trim(),
    skipAccepted: "The node skip request was recorded.",
    skipStarted: `Graph skipped the blocked node and continued downstream: ${graphRunId}`,
    stopAccepted: "The Graph stop request was recorded.",
    stopRequested: "Graph run stop was requested by the user.",
    stopStateOnly: `Graph run state was persisted as stopped: ${graphRunId}. No active CLI process mapping was found; no real CLI process stop was confirmed.`,
    stopWithCli: `Graph run state was persisted as stopped: ${graphRunId}. Sent stop requests to ${count} mapped active CLI run(s); real process exit depends on the underlying CLI response.`,
    supplementAccepted: "The Graph supplemental message was recorded for later nodes.",
    supplementEmpty: "The supplemental message cannot be empty.",
    supplementUnavailable: "Completed or stopped Graph runs cannot accept supplemental messages.",
    targetBusy: `The Graph run target tab is currently busy: ${graphRunId}`,
    targetMissing: `No executable tab could be found for Graph run: ${graphRunId}`,
  };
  return messages[key];
}

async function openLoopGroupChatPanel(arg?: unknown): Promise<void> {
  await loopDebateChatPanelCoordinator.open(arg);
}

async function openGraphRunPanel(arg?: unknown): Promise<void> {
  await graphRunPanelCoordinator.open(arg);
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
  loopDebateChatPanelCoordinator.refreshOpenPanelForTask(taskId);
}

function resolveActiveConversationLoopTaskId(): string | null {
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    return null;
  }
  return resolveConversationTabLoopContext(activeTab).loopTaskId;
}

async function pickLoopDebateTask(tasks: LoopTaskRecord[]): Promise<LoopTaskRecord | null> {
  const items = tasks.map((task) => ({
    label: task.rootPrompt.split(/\r?\n/g)[0]?.slice(0, 80) || task.id,
    description: `${task.status} · ${task.cli} · ${task.id}`,
    detail: task.taskStoreFile,
    task,
  }));
  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: t("loopDebateChat.selectTask"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return selection?.task ?? null;
}

function listLoopGroupChatTasks(): LoopTaskRecord[] {
  return loopDebateChatPanelCoordinator.listGroupChatTasks();
}

function stopLoopRunsForTask(taskId: string): void {
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
  return normalizeLoopTaskId(activeTaskRun?.loopTaskId)
    ?? (Array.isArray(activeMessageTarget)
      ? resolveLoopConversationTabContextFromMessages(activeMessageTarget).loopTaskId
      : null);
}

function buildLoopDebateChatMessageAction(taskId: string, round?: number): ChatMessageAction {
  return loopDebateChatPanelCoordinator.buildMessageAction(taskId, round);
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

type PromptRunInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
  loopMainModelFallback?: string;
  loopSubtaskModelFallback?: string;
  loopExecutionMode?: LoopExecutionMode;
  loopContinuePrompt?: string;
  imagePaths?: string[];
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  graphRunId?: string;
  graphNodeId?: string;
  executionCwd?: string;
  isolateProjectInstructions?: boolean;
  skipLongTermMemoryPersist?: boolean;
  thinkingModeOverride?: ThinkingMode;
  throwOnError?: boolean;
};

type PromptRunTarget = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

function normalizePromptRunModel(value: string | undefined): string | undefined {
  return normalizeCliModelName(value) ?? undefined;
}

function resolvePromptRunModelForRole(input: PromptRunInput, role: GraphModelRole): string | undefined {
  const mainModel = normalizePromptRunModel(input.loopMainModel) ?? normalizePromptRunModel(input.model);
  const subtaskModel = normalizePromptRunModel(input.loopSubtaskModel)
    ?? normalizePromptRunModel(input.model)
    ?? mainModel;
  return role === "subtask"
    ? (subtaskModel ?? mainModel)
    : (mainModel ?? subtaskModel);
}

function resolvePromptRunThinkingModeForRole(
  input: PromptRunInput,
  cli: CliName,
  role: GraphModelRole,
  model: string | undefined,
  options: { applySubtaskCap?: boolean } = {}
): ThinkingMode | undefined {
  const roleModel = normalizePromptRunModel(model)
    ?? resolvePromptRunModelForRole(input, role)
    ?? getSelectedCliModel(cli)
    ?? undefined;
  const explicitThinkingMode = role === "subtask"
    ? input.loopSubtaskThinkingMode
    : input.loopMainThinkingMode;
  const roleThinkingMode = cli === "codex" && isThinkingMode(explicitThinkingMode)
    ? normalizeThinkingModeForCli(cli, explicitThinkingMode)
    : cli === "codex"
      ? getSelectedLoopThinkingMode(cli, role, roleModel) ?? undefined
      : undefined;
  const resolvedThinkingMode = roleThinkingMode
    ?? (options.applySubtaskCap && role === "subtask"
      ? getEffectiveThinkingMode(cli, roleModel ?? getSelectedCliModel(cli))
      : undefined);
  if (!resolvedThinkingMode) {
    return undefined;
  }
  return options.applySubtaskCap && role === "subtask"
    ? resolveLoopSubtaskThinkingMode(resolvedThinkingMode, getGlobalLoopSubtaskMaxThinkingMode())
    : resolvedThinkingMode;
}

function resolvePromptRunModelFallback(input: PromptRunInput, role: GraphModelRole): string {
  if (role === "main") {
    if (input.loopMainModelFallback) {
      return input.loopMainModelFallback;
    }
    if (normalizePromptRunModel(input.loopMainModel)) {
      return "none";
    }
    if (normalizePromptRunModel(input.model)) {
      return "loop main model missing; using selected single model";
    }
    if (normalizePromptRunModel(input.loopSubtaskModel)) {
      return "loop main model missing; using subtask model";
    }
    return "no explicit model selected; CLI default applies";
  }
  if (input.loopSubtaskModelFallback) {
    return input.loopSubtaskModelFallback;
  }
  if (normalizePromptRunModel(input.loopSubtaskModel)) {
    return "none";
  }
  if (normalizePromptRunModel(input.model)) {
    return "loop subtask model missing; using selected single model";
  }
  if (normalizePromptRunModel(input.loopMainModel)) {
    return "loop subtask model missing; using main model";
  }
  return "no explicit model selected; CLI default applies";
}

function buildGraphRunModelRouting(input: PromptRunInput): GraphRunModelRoutingRecord {
  const plannerModel = resolvePromptRunModelForRole(input, "main");
  const executorModel = resolvePromptRunModelForRole(input, "subtask");
  const plannerFallback = resolvePromptRunModelFallback(input, "main");
  const executorFallback = resolvePromptRunModelFallback(input, "subtask");
  return {
    planner: {
      role: "main",
      ...(plannerModel ? { model: plannerModel } : {}),
      ...(plannerFallback !== "none" ? { fallback: plannerFallback } : {}),
    },
    executor: {
      role: "subtask",
      ...(executorModel ? { model: executorModel } : {}),
      ...(executorFallback !== "none" ? { fallback: executorFallback } : {}),
    },
  };
}

function applyGraphNodeModelRoute(
  node: GraphNodeRecord,
  route: GraphRunModelRoutingRecord["planner"],
): GraphNodeRecord {
  const rest: GraphNodeRecord = { ...node };
  delete rest.modelRole;
  delete rest.model;
  delete rest.modelFallback;
  return {
    ...rest,
    modelRole: route.role,
    ...(route.model ? { model: route.model } : {}),
    ...(route.fallback ? { modelFallback: route.fallback } : {}),
  };
}

function applyGraphRunModelRouting(run: GraphRunRecord): GraphRunRecord {
  const routing = run.modelRouting;
  if (!routing) {
    return run;
  }
  return {
    ...run,
    nodes: run.nodes.map((node) => applyGraphNodeModelRoute(
      node,
      resolveGraphNodeModelRoute(node, routing),
    )),
  };
}

function resolveGraphNodeModelRoute(
  node: GraphNodeRecord,
  routing: GraphRunModelRoutingRecord,
): GraphRunModelRoutingRecord["planner"] {
  return node.id === GRAPH_AI_PLANNER_NODE_ID || node.kind === "summary"
    ? routing.planner
    : routing.executor;
}

function resolveGraphResumePromptModels(
  run: GraphRunRecord,
  cli: CliName,
  configId: string | null,
): Pick<PromptRunInput, "model" | "loopMainModel" | "loopSubtaskModel" | "loopMainModelFallback" | "loopSubtaskModelFallback"> {
  if (cli !== "codex" && cli !== "opencode") {
    const selectedModel = getSelectedCliModel(cli, configId) ?? undefined;
    return selectedModel ? { model: selectedModel } : {};
  }
  const loopMainModel = run.modelRouting?.planner.model
    ?? getSelectedLoopCliModel(cli, "main", configId)
    ?? getSelectedCliModel(cli, configId)
    ?? undefined;
  const loopSubtaskModel = run.modelRouting?.executor.model
    ?? getSelectedLoopCliModel(cli, "subtask", configId)
    ?? getSelectedCliModel(cli, configId)
    ?? loopMainModel
    ?? undefined;
  return {
    ...(loopMainModel ? { model: loopMainModel, loopMainModel } : {}),
    ...(loopSubtaskModel ? { loopSubtaskModel } : {}),
    ...(run.modelRouting?.planner.fallback ? { loopMainModelFallback: run.modelRouting.planner.fallback } : {}),
    ...(run.modelRouting?.executor.fallback ? { loopSubtaskModelFallback: run.modelRouting.executor.fallback } : {}),
  };
}

async function hydrateOpenCodePromptRoleModels(input: PromptRunInput, cli: CliName): Promise<PromptRunInput> {
  if (cli !== "opencode") {
    return input;
  }
  const configId = getActiveConfigIdForCli("opencode");
  const activeConfig = configId
    ? await configService.getConfigById("opencode", configId)
    : null;
  const current = activeConfig ?? await configService.getCurrentConfig("opencode");
  const roles = resolveOpenCodeRoleModelsForConfig(configId, current.content ?? "{}");
  const explicitMain = normalizePromptRunModel(input.loopMainModel);
  const explicitSubtask = normalizePromptRunModel(input.loopSubtaskModel);
  const explicitSingle = normalizePromptRunModel(input.model);
  const loopMainModel = explicitMain ?? explicitSingle ?? roles.main ?? undefined;
  const loopSubtaskModel = explicitSubtask ?? roles.subtask ?? explicitSingle ?? loopMainModel ?? undefined;
  return {
    ...input,
    ...(loopMainModel ? { model: loopMainModel, loopMainModel } : {}),
    ...(loopSubtaskModel ? { loopSubtaskModel } : {}),
    ...(roles.fallback.main ? { loopMainModelFallback: roles.fallback.main } : {}),
    ...(roles.fallback.subtask ? { loopSubtaskModelFallback: roles.fallback.subtask } : {}),
  };
}

function isClaudeSessionNotFoundErrorInfo(info: ErrorInfo): boolean {
  const combined = `${info.code ?? ""} ${info.message ?? ""}`.toLowerCase();
  return combined.includes("claude_session_not_found")
    || combined.includes("no conversation found with session id:");
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
  return Boolean(activeRunId && (activeProcess || activeInteractiveStop));
}

function getPrimaryRunTabId(): string | null {
  if (!isPrimaryRunActive()) {
    return null;
  }
  return activeTabIdForRun;
}

function hasAnyTaskRunning(): boolean {
  return isPrimaryRunActive() || parallelRunsByTabId.size > 0 || interactiveRunsByTabId.size > 0;
}

function isTabRunActive(tabId: string | null): boolean {
  if (!tabId) {
    return false;
  }
  if (parallelRunsByTabId.has(tabId) || interactiveRunsByTabId.has(tabId)) {
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
    const taskRole = activeTaskRun?.taskRole;
    const loopTaskId = normalizeLoopTaskId(activeTaskRun?.loopTaskId);
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
    const primaryTaskId = normalizeLoopTaskId(activeTaskRun?.loopTaskId)
      ?? (Array.isArray(activeMessageTarget)
        ? resolveLoopConversationTabContextFromMessages(activeMessageTarget).loopTaskId
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

function resolveAutoInteractiveModeForConversationTab(
  tab: ConversationTabRecord | null
): InteractiveMode {
  if (!tab) {
    return "coding";
  }
  if (resolveConversationTabGraphRunId(tab)) {
    return "graph";
  }
  const context = resolveConversationTabLoopContext(tab);
  return resolveAutoInteractiveModeForLoopTask(context.taskRole, context.loopTaskId);
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
  if (activeInteractiveStop && activeCliForRun && activeSessionId) {
    bindings.push({
      cli: activeCliForRun,
      sessionId: activeSessionId,
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

function resolvePromptRunTarget(tabId: string | null): PromptRunTarget | null {
  if (!tabId) {
    return null;
  }
  const tab = getConversationTabById(tabId);
  if (!tab) {
    return null;
  }
  return {
    tabId: tab.id,
    cli: tab.cli,
    sessionId: tab.sessionId,
  };
}

function collectRecentLoopTaskIdsForTarget(target: PromptRunTarget, limit = 12): string[] {
  return collectRecentLoopTaskIdsFromMessages(getLoopMessagesForTarget(target), limit);
}

function isLoopTaskCompatibleWithTarget(
  task: LoopTaskRecord,
  target: PromptRunTarget,
  options: { allowMissingTaskSessionId?: boolean } = {}
): boolean {
  if (task.cli !== target.cli || task.workspaceKey !== activeWorkspaceKey) {
    return false;
  }
  const targetSessionId = resolveLoopTaskSessionId(target);
  return isLoopTaskSessionCompatible(task, targetSessionId, options);
}

function findResumableLoopTaskForTarget(target: PromptRunTarget): LoopTaskRecord | null {
  const candidates: LoopTaskRecord[] = [];
  const seenTaskIds = new Set<string>();

  const appendCandidate = (
    task: LoopTaskRecord | null | undefined,
    options: { allowMissingTaskSessionId?: boolean } = {}
  ): void => {
    if (
      !task
      || seenTaskIds.has(task.id)
      || !isLoopTaskCompatibleWithTarget(task, target, {
        allowMissingTaskSessionId: options.allowMissingTaskSessionId,
      })
    ) {
      return;
    }
    seenTaskIds.add(task.id);
    candidates.push(task);
  };

  const recentTaskIds = collectRecentLoopTaskIdsForTarget(target);
  recentTaskIds.forEach((taskId) => {
    appendCandidate(readLoopTaskRecord(taskId), { allowMissingTaskSessionId: true });
  });

  const targetSessionId = resolveLoopTaskSessionId(target);
  if (targetSessionId) {
    const sessionStoreFile = getLoopTaskStoreSessionFile(activeWorkspaceKey, target.cli, targetSessionId);
    const sessionStore = readLoopTaskStore(sessionStoreFile);
    sessionStore.tasks
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .forEach((task) => {
        appendCandidate(
          task.taskStoreFile === sessionStoreFile ? task : { ...task, taskStoreFile: sessionStoreFile }
        );
      });
  }

  const resumable = candidates
    .filter((task) => isLoopTaskResumable(task) || (
      task.status === "completed" && !hasCompleteLoopCompletionMessagesForTask(target, task.id)
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return resumable[0] ?? null;
}

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
  const tabId = options.tabId ?? activeTabIdForRun ?? getActiveConversationTabId();
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
  if (getPrimaryRunTabId() === tabId && activeMessageTarget) {
    return activeMessageTarget;
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

function stopRunForTab(tabId: string | null): void {
  if (!tabId) {
    return;
  }
  const interactiveRun = interactiveRunsByTabId.get(tabId);
  if (interactiveRun) {
    interactiveRun.stop();
    return;
  }
  if (stopParallelRunForTab(tabId)) {
    return;
  }
  if (getPrimaryRunTabId() === tabId) {
    const graphRunId = activeTaskRun?.graphNodeId
      ? null
      : normalizeChatGraphRunId(activeTaskRun?.graphRunId);
    stopActiveRun();
    if (graphRunId) {
      void stopGraphRunFromConversationTab(graphRunId, tabId);
    }
    return;
  }
  if (stopGraphRunForConversationTab(tabId)) {
    return;
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
  return resolveLocale(getLocaleSetting()).startsWith("zh")
    ? (
        status
          ? `OpenCode 已成功退出，但没有返回助手回答。最后状态：${status}`
          : "OpenCode 已成功退出，但没有返回助手回答。请检查 OpenCode provider/model 配置，或运行 `opencode run --format json` 验证。"
      )
    : (
        status
          ? `OpenCode exited successfully, but did not return an assistant answer. Last status: ${status}`
          : "OpenCode exited successfully, but did not return an assistant answer. Check the OpenCode provider/model config or run `opencode run --format json` to verify it."
      );
}

function buildOpenCodeMissingFinalConclusionMessage(output: ReturnType<typeof parseOpenCodeRunOutput>): string {
  if (output.errorText) {
    return output.errorText;
  }
  if (output.finalText?.trim()) {
    return resolveLocale(getLocaleSetting()).startsWith("zh")
      ? "OpenCode 已返回助手答复，但正文未包含 `[final_answer]`，因此未通过严格最终答复判定。"
      : "OpenCode returned an assistant reply, but it did not contain `[final_answer]`, so strict final-reply detection rejected it.";
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

function buildOpenCodeOneShotStartupTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return resolveLocale(getLocaleSetting()).startsWith("zh")
    ? `OpenCode run --format json 已启动，但 ${seconds} 秒内没有返回助手回答、错误或状态输出。插件已终止本次尝试并进入错误收口；请检查 OpenCode provider/model/key 配置，或在终端运行 \`opencode run --format json '<你的任务>'\` 验证真实任务。`
    : `OpenCode run --format json started, but returned no assistant answer, error, or status output within ${seconds} seconds. The extension stopped this attempt and finalized it as an error; check the OpenCode provider/model/key config or run \`opencode run --format json '<your task>'\` in a terminal.`;
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

type PreparedOpenCodeSubagentRuntime = {
  connection: OpenCodeSubagentConnection | null;
  endpointSource: "managed-server" | "configured-attach" | "unavailable";
  error: Error | null;
  dispose: () => void;
};

function createDisabledOpenCodeSubagentMonitor(): OpenCodeSubagentMonitor {
  return {
    setParentSessionId: () => undefined,
    pollNow: async () => undefined,
    finish: () => undefined,
    dispose: () => undefined,
  };
}

async function prepareOpenCodeSubagentRuntime(options: {
  cwd: string | undefined;
  runId: string;
  runtime: OpenCodeRuntimePreparation;
  isolateProjectInstructions?: boolean;
}): Promise<PreparedOpenCodeSubagentRuntime> {
  const directory = options.cwd ?? process.cwd();
  let managedServerProcess: RunProcess | null = null;
  try {
    const connection = await resolveOpenCodeSubagentConnection(getCliArgs("opencode"), {
      env: options.runtime.envOverrides,
    });
    if (!connection.serverPort) {
      return {
        connection,
        endpointSource: "configured-attach",
        error: null,
        dispose: () => undefined,
      };
    }

    const managedServerEnvOverrides = { ...options.runtime.envOverrides };
    if (connection.authorization?.startsWith("Basic ")) {
      const credentials = Buffer.from(connection.authorization.slice("Basic ".length), "base64").toString("utf8");
      const separatorIndex = credentials.indexOf(":");
      if (separatorIndex >= 0) {
        managedServerEnvOverrides.OPENCODE_SERVER_USERNAME = credentials.slice(0, separatorIndex);
        managedServerEnvOverrides.OPENCODE_SERVER_PASSWORD = credentials.slice(separatorIndex + 1);
      }
    }

    let disposed = false;
    let serverReady = false;
    let rejectServerLifecycle: ((error: Error) => void) | null = null;
    const serverLifecycleFailure = new Promise<never>((_resolve, reject) => {
      rejectServerLifecycle = reject;
    });
    const serverProcess = startOpenCodeServer(connection.serverPort, {
      onStderr: (content) => {
        if (content.trim()) {
          void logDebug("opencode-subagent-server-stderr", {
            runId: options.runId,
            port: connection.serverPort,
            contentLength: content.length,
          });
        }
      },
      onError: (error) => {
        void logError("opencode-subagent-server-error", {
          runId: options.runId,
          port: connection.serverPort,
          error: error.message,
        });
        if (!serverReady) {
          rejectServerLifecycle?.(error);
        }
      },
      onExit: (code) => {
        void logInfo("opencode-subagent-server-exit", {
          runId: options.runId,
          port: connection.serverPort,
          code,
        });
        if (!serverReady) {
          rejectServerLifecycle?.(new Error(`OpenCode server exited before readiness with code ${code ?? "unknown"}.`));
        }
      },
    }, {
      cwd: options.cwd,
      model: options.runtime.effectiveModel,
      openCodeSmallModel: options.runtime.subtaskModel,
      openCodeVariant: options.runtime.effectiveVariant,
      openCodeSmallVariant: options.runtime.subtaskVariant,
      openCodeConfigContent: options.runtime.configContent,
      envOverrides: managedServerEnvOverrides,
      isolateProjectInstructions: options.isolateProjectInstructions,
      processLabel: `${buildProcessLabel("opencode", options.runId)}-server`,
    });
    managedServerProcess = serverProcess;
    if (!serverProcess.pid) {
      throw new Error("OpenCode server process did not start.");
    }

    await Promise.race([
      waitForOpenCodeServerReady(connection, directory),
      serverLifecycleFailure,
    ]);
    serverReady = true;
    void logInfo("opencode-subagent-server-ready", {
      runId: options.runId,
      port: connection.serverPort,
      pid: serverProcess.pid ?? null,
    });
    return {
      connection,
      endpointSource: "managed-server",
      error: null,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        serverProcess.kill();
      },
    };
  } catch (error) {
    managedServerProcess?.kill();
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    void logError("opencode-subagent-server-unavailable", {
      runId: options.runId,
      error: normalizedError.message,
    });
    return {
      connection: null,
      endpointSource: "unavailable",
      error: normalizedError,
      dispose: () => undefined,
    };
  }
}

async function runPromptParallel(
  input: PromptRunInput,
  target: PromptRunTarget,
  executionOptions: { cwd?: string; isolateProjectInstructions?: boolean } = {},
): Promise<void> {
  const prompt = input.displayPrompt;
  if (!prompt) {
    return;
  }
  const runCli = target.cli;
  if (runCli !== "opencode") {
    throw new Error(`parallel-run-unsupported:${runCli}`);
  }
  const modelPrompt = input.modelPrompt || prompt;
  const contextTags = Array.isArray(input.contextTags)
    ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  const cwd = executionOptions.cwd ?? resolveWorkspaceCwd();
  const runtimePreparation = await prepareOpenCodeRuntime({
    role: input.taskRole === "subtask" ? "subtask" : "main",
    model: input.model ?? null,
    requiresSubtaskModel: Boolean(input.loopTaskId || input.graphRunId),
  });
  const runtimeModel = runtimePreparation.effectiveModel;
  const thinkingMode = input.thinkingModeOverride ?? getEffectiveThinkingMode(runCli, runtimeModel);
  applyThinkingWorkspaceFiles(runCli, thinkingMode, cwd);
  const runtimeEnvOverrides = runtimePreparation.envOverrides;
  const runtimeOpenCodeConfigContent = runtimePreparation.configContent;
  const shouldAutoCompactAfterRun = shouldAutoCompactContextAfterRunForTarget(target);

  preparePendingLabel(runCli, target.tabId, prompt);
  let sessionId = target.sessionId;
  const includeFinalAnswerInstruction = !input.loopTaskId;
  const thinkingPrompt = buildThinkingPrompt(runCli, thinkingMode, modelPrompt, {
    includeFinalAnswerInstruction,
  });
  const hiddenRetryPrompt = buildHiddenRetryPrompt(runCli, thinkingMode, {
    includeFinalAnswerInstruction,
  });
  let messageTarget = sessionId
    ? loadSessionMessages(runCli, sessionId)
    : getPendingSessionDraft(target.tabId, runCli).messages;
  const userMessageId = input.preloadedUserMessageId ?? createMessageId();
  const userCreatedAt = Date.now();

  if (!input.preloadedUserMessageId) {
    const userMessage = buildUserChatMessage(input, userCreatedAt, userMessageId);
    appendMessageToStore(messageTarget, userMessage);
    sendPanelMessage({ type: "appendMessage", message: userMessage, tabId: target.tabId });
  }

  const runId = createMessageId();
  const startedAt = Date.now();
  let hiddenRetryCount = 0;
  const isLoopMainRun = Boolean(input.loopTaskId && input.taskRole === "main");
  let freshSessionRecoveryPending = false;
  let freshSessionRecoveryAttempted = false;
  let silentProgressNoticeShown = false;
  let monitorUnavailableNoticeShown = false;
  let openCodeTabStreamState = createOpenCodeTabStreamState();
  const openCodeTabStreamContext = {
    createMessageId,
    metadata: {
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
      graphRunId: input.graphRunId,
      graphNodeId: input.graphNodeId,
    },
  };
  void logInfo("runPrompt-parallel-start", {
    cli: runCli,
    cwd,
    tabId: target.tabId,
    sessionId,
    modelRole: runtimePreparation.role,
    mainModel: runtimePreparation.mainModel,
    subtaskModel: runtimePreparation.subtaskModel,
    effectiveModel: runtimePreparation.effectiveModel,
    modelFallback: runtimePreparation.modelFallback,
    mainVariant: runtimePreparation.mainVariant,
    subtaskVariant: runtimePreparation.subtaskVariant,
    effectiveVariant: runtimePreparation.effectiveVariant,
  });
  sendRunStatusForTab(target.tabId, "start", {
    prompt,
    startedAt,
    graphRunId: input.graphRunId,
    graphNodeId: input.graphNodeId,
  });

  const isParallelRunActive = (): boolean => {
    const current = parallelRunsByTabId.get(target.tabId);
    return Boolean(current && current.runId === runId && !current.stopped);
  };

  const resolveParallelMessageTarget = (): ChatMessage[] => {
    const current = parallelRunsByTabId.get(target.tabId);
    if (sessionId) {
      messageTarget = loadSessionMessages(runCli, sessionId);
      if (current && current.runId === runId) {
        current.sessionId = sessionId;
        current.messageTarget = messageTarget;
      }
      return messageTarget;
    }
    if (current && current.runId === runId && current.messageTarget) {
      messageTarget = current.messageTarget;
      return messageTarget;
    }
    return messageTarget;
  };

  const syncParallelRun = (process: RunProcess): void => {
    const currentMessageTarget = resolveParallelMessageTarget();
    parallelRunsByTabId.set(target.tabId, {
      runId,
      tabId: target.tabId,
      cli: runCli,
      sessionId,
      prompt,
      startedAt,
      process,
      messageTarget: currentMessageTarget,
      stopped: false,
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
      graphRunId: input.graphRunId,
      graphNodeId: input.graphNodeId,
    });
  };

  const appendParallelTrace = (
    content: string,
    taskListItems?: OpenCodeTaskListItem[],
  ): void => {
    if (!content.trim()) {
      return;
    }
    const { content: displayContent, shouldPersist } = normalizeTraceContentForDisplay(content, runCli);
    if (!displayContent.trim()) {
      return;
    }
    const resolvedKind = resolveTraceKind(displayContent, "tool-use");
    const shouldMerge = resolveTraceMerge(displayContent, false);
    const mergePayload = shouldMerge ? {} : { merge: false };
    const message: ChatMessage = {
      id: createMessageId(),
      role: "trace",
      content: displayContent,
      createdAt: Date.now(),
      kind: resolvedKind,
      ...mergePayload,
    };
    if (shouldPersist) {
      appendMessageToStore(resolveParallelMessageTarget(), message);
    }
    sendPanelMessage({
      type: "traceSegment",
      id: message.id,
      createdAt: message.createdAt,
      sequence: message.sequence,
      content: message.content,
      kind: resolvedKind,
      tabId: target.tabId,
      ...(Array.isArray(taskListItems) ? { taskListItems } : {}),
      ...mergePayload,
    });
  };

  const applyOpenCodeTabStreamActions = (actions: readonly OpenCodeTabStreamAction[]): void => {
    actions.forEach((action) => {
      if (action.type === "task-list-update") {
        sendOpenCodeTaskListUpdate(action.items, {
          source: "parallel-stream",
          tabId: target.tabId,
        });
        return;
      }
      if (action.type === "append-trace") {
        appendParallelTrace(action.content, action.taskListItems);
        return;
      }
      if (action.type === "append-assistant-message") {
        appendMessageToStore(resolveParallelMessageTarget(), action.message);
        sendPanelMessage({ type: "appendMessage", message: action.message, tabId: target.tabId });
        return;
      }

      const currentMessageTarget = resolveParallelMessageTarget();
      let message = currentMessageTarget.find((item) => item.id === action.id);
      if (!message) {
        message = {
          id: action.id,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          ...(action.kind === "thinking" ? { kind: "thinking" as const } : {}),
          ...openCodeTabStreamContext.metadata,
        };
        appendMessageToStore(currentMessageTarget, message);
        sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
      }
      if (message.role !== "assistant") {
        return;
      }
      message.content += action.content;
      if (action.kind === "thinking") {
        message.kind = "thinking";
      }
      sendPanelMessage({
        type: "assistantDelta",
        id: action.id,
        content: action.content,
        kind: action.kind,
        tabId: target.tabId,
      });
    });
  };

  const subagentProgress = createSubagentProgressController({
    labels: buildSubagentProgressLabels(),
    createMessageId,
    messageMetadata: openCodeTabStreamContext.metadata,
    appendMessage: (message) => {
      openCodeTabStreamState = {
        ...openCodeTabStreamState,
        activeAssistantMessageId: null,
        activeAssistantKind: null,
      };
      appendMessageToStore(resolveParallelMessageTarget(), message);
      sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
    },
    replaceMessage: (message) => {
      const currentMessageTarget = resolveParallelMessageTarget();
      const index = currentMessageTarget.findIndex((item) => item.id === message.id);
      if (index < 0) {
        appendMessageToStore(currentMessageTarget, message);
        sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
        return;
      }
      currentMessageTarget[index] = message;
      sendPanelMessage({ type: "replaceMessage", message, tabId: target.tabId });
    },
    appendDelta: (messageId, content) => {
      sendPanelMessage({
        type: "assistantDelta",
        id: messageId,
        content,
        tabId: target.tabId,
      });
    },
  });

  while (true) {
    const isFreshSessionRecoveryAttempt = freshSessionRecoveryPending;
    freshSessionRecoveryPending = false;
    if (isFreshSessionRecoveryAttempt) {
      freshSessionRecoveryAttempted = true;
    }
    const attemptNumber = hiddenRetryCount + 1;
    const attemptPrompt = isFreshSessionRecoveryAttempt || hiddenRetryCount === 0
      ? thinkingPrompt
      : hiddenRetryPrompt;
    const runtimeSessionId = isFreshSessionRecoveryAttempt
      ? null
      : resolveCliSessionIdForResume(runCli, sessionId);
    let attemptHadNormalReply = false;

    if (hiddenRetryCount > 0) {
      const retryNumber = hiddenRetryCount;
      const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
      const shouldContinue = await waitForHiddenRetryDelay(retryNumber, isParallelRunActive);
      if (!shouldContinue) {
        return;
      }
      openCodeTabStreamState = {
        ...openCodeTabStreamState,
        activeAssistantMessageId: null,
        activeAssistantKind: null,
      };
      if (isFreshSessionRecoveryAttempt) {
        const recoveryMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: t("run.openCodeLoopFreshSessionRecoveryStarted"),
          createdAt: Date.now(),
        };
        const recoveryMessageTarget = resolveParallelMessageTarget();
        appendMessageToStore(recoveryMessageTarget, recoveryMessage);
        sendPanelMessage({ type: "appendMessage", message: recoveryMessage, tabId: target.tabId });
      }
      const retryStartedMessage: ChatMessage = {
        id: createMessageId(),
        role: "system",
        content: buildHiddenRetryStartedMessage(retryNumber),
        createdAt: Date.now(),
      };
      const retryMessageTarget = resolveParallelMessageTarget();
      appendMessageToStore(retryMessageTarget, retryStartedMessage);
      sendPanelMessage({ type: "appendMessage", message: retryStartedMessage, tabId: target.tabId });
      void logInfo("runPrompt-parallel-hidden-retry", {
        cli: runCli,
        tabId: target.tabId,
        runId,
        sessionId,
        attempt: attemptNumber,
        retryCount: hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        retryDelayMs,
        freshSessionRecovery: isFreshSessionRecoveryAttempt,
      });
    }

    let rawStdout = "";
    let rawStderr = "";
    let sessionBuffer = "";
    const subagentRuntime = await prepareOpenCodeSubagentRuntime({
      cwd,
      runId,
      runtime: runtimePreparation,
      isolateProjectInstructions: executionOptions.isolateProjectInstructions,
    });
    if (subagentRuntime.error && !monitorUnavailableNoticeShown) {
      monitorUnavailableNoticeShown = true;
      const message: ChatMessage = {
        id: createMessageId(),
        role: "system",
        content: t("run.openCodeSubagentMonitorUnavailable"),
        createdAt: Date.now(),
      };
      appendMessageToStore(resolveParallelMessageTarget(), message);
      sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
    }
    void logInfo("runPrompt-parallel-subagent-monitor-start", {
      cli: runCli,
      runId,
      tabId: target.tabId,
      sessionId: runtimeSessionId,
      endpointSource: subagentRuntime.endpointSource,
      serverPort: subagentRuntime.connection?.serverPort ?? null,
      pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
    });
    const attemptResult = await new Promise<
      { type: "exit"; code: number | null }
      | { type: "error"; error: Error }
    >((resolve) => {
      let settled = false;
      const subagentMonitor = subagentRuntime.connection
        ? createOpenCodeSubagentMonitor({
            connection: subagentRuntime.connection,
            directory: cwd ?? process.cwd(),
            onUpdate: (update) => {
              const current = parallelRunsByTabId.get(target.tabId);
              if (!current || current.runId !== runId) {
                return;
              }
              subagentProgress.update(update);
            },
            onNoChildren: () => {
              if (silentProgressNoticeShown || !isParallelRunActive()) {
                return;
              }
              silentProgressNoticeShown = true;
              openCodeTabStreamState = {
                ...openCodeTabStreamState,
                activeAssistantMessageId: null,
                activeAssistantKind: null,
              };
              const message: ChatMessage = {
                id: createMessageId(),
                role: "system",
                content: t("run.openCodeSubagentPollEmpty"),
                createdAt: Date.now(),
              };
              appendMessageToStore(resolveParallelMessageTarget(), message);
              sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
              void logInfo("runPrompt-parallel-subagent-poll-empty", {
                cli: runCli,
                runId,
                tabId: target.tabId,
                sessionId,
                attempt: attemptNumber,
                pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
              });
            },
            onError: (error) => {
              void logDebug("runPrompt-parallel-subagent-monitor-error", {
                cli: runCli,
                runId,
                tabId: target.tabId,
                sessionId,
                attempt: attemptNumber,
                error: error.message,
              });
            },
          })
        : createDisabledOpenCodeSubagentMonitor();
      const settle = (result: { type: "exit"; code: number | null } | { type: "error"; error: Error }): void => {
        if (settled) {
          return;
        }
        settled = true;
        subagentMonitor.finish(
          result.type === "exit" && result.code === 0 ? "completed" : "failed",
        );
        subagentRuntime.dispose();
        resolve(result);
      };
      const runProcess = runCliStream(
        runCli,
        attemptPrompt,
        {
          onStdout: (chunk: string) => {
            if (!isParallelRunActive()) {
              return;
            }
            rawStdout = appendBoundedUtf8Text(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
            sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
            subagentMonitor.setParentSessionId(extractSessionId(runCli, sessionBuffer));
            sendPanelMessage({ type: "rawStreamDelta", content: chunk, stream: "stdout", tabId: target.tabId });
            const streamResult = consumeOpenCodeTabStreamChunk(
              openCodeTabStreamState,
              chunk,
              false,
              openCodeTabStreamContext,
            );
            openCodeTabStreamState = streamResult.state;
            applyOpenCodeTabStreamActions(streamResult.actions);
            if (streamResult.actions.some((action) => (
              action.type === "append-assistant-delta" && action.kind !== "thinking"
            ))) {
              attemptHadNormalReply = true;
            }
          },
          onStderr: (chunk: string) => {
            if (!isParallelRunActive()) {
              return;
            }
            rawStderr = appendBoundedUtf8Text(rawStderr, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
            sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
            sendPanelMessage({ type: "rawStreamDelta", content: chunk, stream: "stderr", tabId: target.tabId });
          },
          onExit: (code: number | null) => {
            settle({ type: "exit", code });
          },
          onError: (error: Error) => {
            settle({ type: "error", error });
          },
        },
        {
          cwd,
          sessionId: runtimeSessionId,
          thinkingMode,
          openCodeVariant: runtimePreparation.effectiveVariant,
          openCodeSmallVariant: runtimePreparation.subtaskVariant,
          model: runtimeModel,
          openCodeSmallModel: runtimePreparation.subtaskModel,
          openCodeConfigContent: runtimeOpenCodeConfigContent,
          envOverrides: runtimeEnvOverrides,
          isolateProjectInstructions: executionOptions.isolateProjectInstructions,
          openCodeServerUrl: subagentRuntime.connection?.serverUrl,
          processLabel: buildProcessLabel(runCli, runtimeSessionId ?? runId),
        }
      );
      syncParallelRun(runProcess);
      subagentMonitor.setParentSessionId(runtimeSessionId);
    });

    if (isParallelRunActive()) {
      const streamResult = consumeOpenCodeTabStreamChunk(
        openCodeTabStreamState,
        "",
        true,
        openCodeTabStreamContext,
      );
      openCodeTabStreamState = streamResult.state;
      applyOpenCodeTabStreamActions(streamResult.actions);
    }
    if (!isParallelRunActive()) {
      return;
    }

    const detectedSessionId = extractSessionId(runCli, sessionBuffer) ?? extractSessionId(runCli, `${rawStdout}
${rawStderr}`);
    if (
      isFreshSessionRecoveryAttempt
      && isLoopMainRun
      && detectedSessionId
      && detectedSessionId !== sessionId
      && input.loopTaskId
    ) {
      const previousSessionId = sessionId;
      messageTarget = adoptFreshOpenCodeLoopRecoverySession({
        sessionId: detectedSessionId,
        previousSessionId,
        tabId: target.tabId,
        messageTarget,
        loopTaskId: input.loopTaskId,
      });
      sessionId = detectedSessionId;
      const current = parallelRunsByTabId.get(target.tabId);
      if (current && current.runId === runId) {
        current.sessionId = sessionId;
        current.messageTarget = messageTarget;
      }
    } else if ((!sessionId || isLocalSessionId(sessionId)) && detectedSessionId) {
      adoptDetectedSessionId(runCli, detectedSessionId, target.tabId, sessionId);
      sessionId = detectedSessionId;
      messageTarget = loadSessionMessages(runCli, detectedSessionId);
    }

    if (attemptResult.type === "exit" && attemptResult.code === 0) {
      const currentMessageTarget = resolveParallelMessageTarget();
      const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
      if (openCodeOutput.finalText) {
        const finalTextResult = appendOpenCodeFinalTextToTabStream(
          openCodeTabStreamState,
          openCodeOutput.finalText,
          openCodeTabStreamContext,
        );
        openCodeTabStreamState = finalTextResult.state;
        applyOpenCodeTabStreamActions(finalTextResult.actions);
      }
      const conversationHasFinalConclusion = hasAssistantFinalConclusionAfterMessage(currentMessageTarget, userMessageId, {
        observedFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
        fallbackCreatedAt: userCreatedAt,
        requireExplicitFinalAnswer: shouldRequireExplicitFinalAnswerForRun(input),
      });
      const currentAttemptHasAssistantAnswer = attemptHadNormalReply || Boolean(openCodeOutput.finalText?.trim());
      const successfulExitOutcome = resolveOpenCodeSuccessfulExitOutcome({
        isLoopRun: Boolean(input.loopTaskId),
        currentAttemptHasAssistantAnswer,
        conversationHasFinalConclusion,
        hiddenRetryCount,
        maxHiddenRetries: HIDDEN_RETRY_MAX_RETRIES,
      });
      if (successfulExitOutcome !== "complete") {
        const missingConclusionMessage = buildOpenCodeMissingFinalConclusionMessage(openCodeOutput);
        if (successfulExitOutcome === "retry") {
          const shouldRecoverFreshSession = shouldRecoverOpenCodeLoopMainSessionInFreshSession({
            isLoopMainRun,
            hasResumableSession: Boolean(resolveCliSessionIdForResume(runCli, sessionId)),
            hasProviderError: Boolean(openCodeOutput.errorText),
            freshSessionRecoveryAttempted,
          });
          void logInfo("runPrompt-parallel-missing-final-conclusion-retry", {
            cli: runCli,
            runId,
            tabId: target.tabId,
            sessionId,
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            attempt: hiddenRetryCount + 1,
            retryCount: hiddenRetryCount,
            maxRetries: HIDDEN_RETRY_MAX_RETRIES,
            conversationHasFinalConclusion,
            currentAttemptHasAssistantAnswer,
            structuredFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
            stdoutLength: rawStdout.length,
            stderrLength: rawStderr.length,
            freshSessionRecoveryQueued: shouldRecoverFreshSession,
          });
          if (shouldRecoverFreshSession) {
            freshSessionRecoveryPending = true;
            const recoveryMessage: ChatMessage = {
              id: createMessageId(),
              role: "system",
              content: t("run.openCodeLoopFreshSessionRecoveryQueued"),
              createdAt: Date.now(),
            };
            appendMessageToStore(currentMessageTarget, recoveryMessage);
            sendPanelMessage({ type: "appendMessage", message: recoveryMessage, tabId: target.tabId });
          } else {
            appendHiddenRetryErrorTraceMessage(currentMessageTarget, missingConclusionMessage, {
              tabId: target.tabId,
              taskRole: input.taskRole,
              loopTaskId: input.loopTaskId,
              loopRound: input.loopRound,
              loopSubtaskId: input.loopSubtaskId,
            }, { createMessageId, sendPanelMessage });
          }
          const retryMessage = buildHiddenRetryQueuedMessage(hiddenRetryCount);
          const systemMessage: ChatMessage = {
            id: createMessageId(),
            role: "system",
            content: retryMessage,
            createdAt: Date.now(),
          };
          appendMessageToStore(currentMessageTarget, systemMessage);
          sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
          hiddenRetryCount += 1;
          continue;
        }
        void logError("runPrompt-parallel-missing-final-conclusion", {
          cli: runCli,
          runId,
          tabId: target.tabId,
          sessionId,
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          hiddenRetryCount,
          conversationHasFinalConclusion,
          currentAttemptHasAssistantAnswer,
          structuredFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
          stdoutLength: rawStdout.length,
          stderrLength: rawStderr.length,
        });
        parallelRunsByTabId.delete(target.tabId);
        const taskRecord: TaskRunRecord = {
          id: runId,
          cli: runCli,
          sessionId,
          prompt,
          startedAt,
          endedAt: Date.now(),
          durationMs: Math.max(0, Date.now() - startedAt),
          status: "error",
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
          graphRunId: input.graphRunId,
          graphNodeId: input.graphNodeId,
        };
        appendTaskRun(taskRecord);
        const userMessageText = buildHiddenRetryFailureMessage({
          hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryLimitMessage: buildHiddenRetryLimitMessage(),
          fallbackMessage: missingConclusionMessage,
          lastFailureMessage: missingConclusionMessage,
          lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
        });
        const systemMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: userMessageText,
          createdAt: Date.now(),
        };
        appendMessageToStore(currentMessageTarget, systemMessage);
        sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
        sendRunStatusForTab(target.tabId, "error", { message: userMessageText });
        const completionMessage: ChatMessage = {
          id: createMessageId(),
          role: "system",
          content: buildTaskRunCompletionText("error", taskRecord.durationMs),
          createdAt: Date.now(),
        };
        appendMessageToStore(currentMessageTarget, completionMessage);
        sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
        persistMessagesForTab(runCli, sessionId, target.tabId, currentMessageTarget);
        return;
      }
      parallelRunsByTabId.delete(target.tabId);
      const taskRecord: TaskRunRecord = {
        id: runId,
        cli: runCli,
        sessionId,
        prompt,
        startedAt,
        endedAt: Date.now(),
        durationMs: Math.max(0, Date.now() - startedAt),
        status: "end",
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        graphRunId: input.graphRunId,
        graphNodeId: input.graphNodeId,
      };
      appendTaskRun(taskRecord);
      sendRunStatusForTab(target.tabId, "end");
      const completionMessage: ChatMessage = {
        id: createMessageId(),
        role: "system",
        content: buildTaskRunCompletionText("end", taskRecord.durationMs),
        createdAt: Date.now(),
      };
      appendMessageToStore(currentMessageTarget, completionMessage);
      sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
      persistMessagesForTab(runCli, sessionId, target.tabId, currentMessageTarget);
      maybePersistLongTermMemoryFromRun({
        status: "end",
        cli: runCli,
        prompt,
        messages: currentMessageTarget,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        skip: input.skipLongTermMemoryPersist,
      });
      if (shouldAutoCompactAfterRun) {
        await maybeAutoCompactContextAfterPromptSuccess(target, sessionId, taskRecord.durationMs);
      }
      return;
    }

    const lastFailureMessage = getAttemptFailureMessage(attemptResult, rawStderr || null);
    hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
    const shouldRetry = hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
      && isHiddenRetryEligibleAttempt(attemptResult, lastFailureMessage);
    const failureMessageTarget = resolveParallelMessageTarget();
    if (shouldRetry) {
      appendHiddenRetryErrorTraceMessage(failureMessageTarget, lastFailureMessage, {
        tabId: target.tabId,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      }, { createMessageId, sendPanelMessage });
      const retryMessage = buildHiddenRetryQueuedMessage(hiddenRetryCount);
      const systemMessage: ChatMessage = {
        id: createMessageId(),
        role: "system",
        content: retryMessage,
        createdAt: Date.now(),
      };
      appendMessageToStore(failureMessageTarget, systemMessage);
      sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
      hiddenRetryCount += 1;
      continue;
    }

    parallelRunsByTabId.delete(target.tabId);
    const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
    if (openCodeOutput.finalText) {
      const finalTextResult = appendOpenCodeFinalTextToTabStream(
        openCodeTabStreamState,
        openCodeOutput.finalText,
        openCodeTabStreamContext,
      );
      openCodeTabStreamState = finalTextResult.state;
      applyOpenCodeTabStreamActions(finalTextResult.actions);
    }

    const taskRecord: TaskRunRecord = {
      id: runId,
      cli: runCli,
      sessionId,
      prompt,
      startedAt,
      endedAt: Date.now(),
      durationMs: Math.max(0, Date.now() - startedAt),
      status: "error",
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
    };
    appendTaskRun(taskRecord);

    const finalFailureMessage = buildOpenCodeFailureMessage(openCodeOutput, lastFailureMessage);
    const userMessageText = buildHiddenRetryFailureMessage({
      hiddenRetryCount,
      maxRetries: HIDDEN_RETRY_MAX_RETRIES,
      retryLimitMessage: buildHiddenRetryLimitMessage(),
      fallbackMessage: finalFailureMessage,
      lastFailureMessage: finalFailureMessage,
      lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
    });
    const systemMessage: ChatMessage = {
      id: createMessageId(),
      role: "system",
      content: userMessageText,
      createdAt: Date.now(),
    };
    appendMessageToStore(failureMessageTarget, systemMessage);
    sendPanelMessage({ type: "appendMessage", message: systemMessage, tabId: target.tabId });
    sendRunStatusForTab(target.tabId, "error", { message: userMessageText });
    const completionMessage: ChatMessage = {
      id: createMessageId(),
      role: "system",
      content: buildTaskRunCompletionText("error", taskRecord.durationMs),
      createdAt: Date.now(),
    };
    appendMessageToStore(failureMessageTarget, completionMessage);
    sendPanelMessage({ type: "appendMessage", message: completionMessage, tabId: target.tabId });
    persistMessagesForTab(runCli, sessionId, target.tabId, failureMessageTarget);
    return;
  }
}

async function runLoopPrompt(
  input: PromptRunInput,
  options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean } = {}
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
  const target = resolvePromptRunTarget(options.targetTabId ?? getActiveConversationTabId());
  if (!target || !input.displayPrompt.trim()) {
    return;
  }
  let run: GraphRunRecord | null = null;
  try {
    run = await runGraphPromptOrchestration(input, options);
  } catch (error) {
    const failureMessage = errorToMessage(error);
    void logError("graph-orchestration-unhandled-error", {
      graphRunId: run?.id ?? null,
      tabId: target.tabId,
      cli: target.cli,
      error: failureMessage,
    });
    if (run) {
      run = updateGraphRunRecord(run.id, {
        status: "error",
        updatedAt: Date.now(),
      }) ?? run;
      appendGraphEvent(run.eventsFile, {
        runId: run.id,
        type: "run.error",
        summary: failureMessage,
        error: failureMessage,
      });
      sendGraphMainRunTerminalStatus(target, run);
    }
    appendSystemMessageForGraph(target, buildGraphRunErrorText(run?.id ?? null, failureMessage), run?.id);
  } finally {
    await postPanelState();
  }
}

async function runGraphPromptOrchestration(
  input: PromptRunInput,
  options: { targetTabId?: string | null } = {}
): Promise<GraphRunRecord | null> {
  const target = resolvePromptRunTarget(options.targetTabId ?? getActiveConversationTabId());
  if (!target || !input.displayPrompt.trim()) {
    return null;
  }
  input = await hydrateOpenCodePromptRoleModels(input, target.cli);

  scheduleLogRetentionCleanup();
  const graphRunId = `graph_${createMessageId()}`;
  const workspaceCwd = resolveWorkspaceCwd();
  if (!workspaceCwd) {
    throw new Error("Graph mode requires an active workspace.");
  }
  const executionSetup = createGraphRunExecutionSetup(workspaceCwd, graphRunId);
  const modelRouting = buildGraphRunModelRouting(input);
  let run = createGraphRunRecord({
    id: graphRunId,
    workspaceKey: activeWorkspaceKey,
    cli: target.cli,
    sessionId: resolveGraphRunSessionId(target),
    rootPrompt: input.displayPrompt,
    status: "running",
    templateId: GRAPH_AI_PLANNER_TEMPLATE_ID,
    templateVersion: GRAPH_AI_PLANNER_TEMPLATE_VERSION,
    nodes: buildGraphPlanningRunNodes(graphRunId)
      .map((node) => applyGraphNodeModelRoute(node, modelRouting.planner)),
    edges: buildGraphPlanningRunEdges(),
    maxConcurrent: GRAPH_EXTENSION_INITIAL_PLANNER_MAX_CONCURRENT_NODES,
    executionMode: executionSetup.executionMode,
    ...(executionSetup.directExecution ? { directExecution: executionSetup.directExecution } : {}),
    ...(executionSetup.worktree ? { worktree: executionSetup.worktree } : {}),
    modelRouting,
  });
  appendGraphEvent(run.eventsFile, {
    runId: run.id,
    type: "run.created",
    summary: `Graph run ${run.id} created in direct workspace mode with ${run.nodes.length} nodes.`,
    data: {
      nodeIds: run.nodes.map((node) => node.id),
      plannerNodeId: GRAPH_AI_PLANNER_NODE_ID,
      maxConcurrent: run.maxConcurrent,
      executionMode: executionSetup.executionMode,
      worktree: executionSetup.worktree,
      directExecution: executionSetup.directExecution,
      fallbackReason: executionSetup.fallbackReason,
      modelRouting: run.modelRouting,
    },
  });
  appendSystemMessageForGraph(target, buildGraphRunStartedText(run), run.id);
  await postPanelState();

  const outcome = await tickGraphRunToPause(run, input, target);
  return outcome.run;
}

async function tickGraphRunToPause(
  initialRun: GraphRunRecord,
  input: PromptRunInput,
  target: PromptRunTarget,
): Promise<{ run: GraphRunRecord; progressed: boolean }> {
  let run = initialRun;
  sendGraphMainRunStarted(target, run, input.displayPrompt);
  const executor = {
    execute: async (request: GraphNodeExecutionRequest) => executeGraphNodeViaRunPrompt(request, input, target),
  };
  let madeProgress = false;
  let tickIndex = 0;
  while (tickIndex < Math.max(12, run.nodes.length * 6)) {
    tickIndex += 1;
    const tickResult = await tickGraphRun(run, {
      executor,
      appendEvent: (eventRun, event) => appendGraphEvent(eventRun.eventsFile, event),
      persistRun: persistGraphRunTickState,
    }, {
      maxConcurrent: resolveGraphExtensionExecutorMaxConcurrent(run),
    });
    run = tickResult.run;
    const planMaterialization = maybeMaterializeGraphPlanAfterTick(run);
    run = planMaterialization.run;
    await postPanelState();

    if (planMaterialization.changed && run.status === "running") {
      madeProgress = true;
      scheduleGraphRunAutoWake(run);
      continue;
    }

    if (run.status === "completed") {
      const mergeBack = finalizeCompletedGraphRunWorktreeMergeBack(run);
      run = mergeBack.run;
      scheduleGraphRunAutoWake(run);
      sendGraphMainRunTerminalStatus(target, run);
      if (run.status === "completed") {
        appendSystemMessageForGraph(target, buildGraphRunCompletedText(run, mergeBack), run.id);
        appendGraphFinalSummaryMessage(target, run);
      } else {
        appendSystemMessageForGraph(
          target,
          buildGraphRunNeedsAttentionText(run, mergeBack),
          run.id,
        );
      }
      return { run, progressed: true };
    }
    if (run.status === "needs-review" || run.status === "sleeping" || run.status === "error" || run.status === "stopped") {
      scheduleGraphRunAutoWake(run);
      sendGraphMainRunTerminalStatus(target, run);
      appendSystemMessageForGraph(
        target,
        buildGraphRunNeedsAttentionText(run),
        run.id,
      );
      return { run, progressed: true };
    }
    const progressed = tickResult.startedNodeIds.length > 0
      || tickResult.completedNodeIds.length > 0
      || tickResult.failedNodeIds.length > 0
      || tickResult.blockedNodeIds.length > 0
      || tickResult.sleepingNodeIds.length > 0
      || tickResult.systemActions.length > 0
      || tickResult.pendingActions.length > 0
      || planMaterialization.changed;
    madeProgress = madeProgress || progressed;
    scheduleGraphRunAutoWake(run);
    if (!progressed) {
      run = updateGraphRunRecord(run.id, {
        status: "needs-review",
        updatedAt: Date.now(),
      }) ?? run;
      scheduleGraphRunAutoWake(run);
      sendGraphMainRunTerminalStatus(target, run);
      appendSystemMessageForGraph(target, buildGraphRunIdleText(run), run.id);
      return { run, progressed: false };
    }
  }

  run = updateGraphRunRecord(run.id, {
    status: "error",
    updatedAt: Date.now(),
  }) ?? run;
  appendGraphEvent(run.eventsFile, {
    runId: run.id,
    type: "run.error",
    summary: `Graph run ${run.id} exceeded the extension runtime tick guard.`,
  });
  scheduleGraphRunAutoWake(run);
  sendGraphMainRunTerminalStatus(target, run);
  appendSystemMessageForGraph(target, buildGraphRunErrorText(run.id, "Graph run exceeded the extension runtime tick guard."), run.id);
  return { run, progressed: madeProgress };
}

function sendGraphMainRunStarted(target: PromptRunTarget, run: GraphRunRecord, prompt: string): void {
  sendRunStatusForTab(target.tabId, "start", {
    prompt,
    startedAt: run.createdAt,
    graphRunId: run.id,
  });
}

function isGraphRunBlockedForMainTab(run: GraphRunRecord): boolean {
  return run.status === "needs-review" && Boolean(selectGraphBlockedAttentionNode(run));
}

function resolveGraphMainRunStatusEvent(run: GraphRunRecord): "end" | "error" | "stopped" | null {
  if (run.status === "completed") {
    return "end";
  }
  if (run.status === "error" || isGraphRunBlockedForMainTab(run)) {
    return "error";
  }
  if (run.status === "stopped") {
    return "stopped";
  }
  return null;
}

function sendGraphMainRunTerminalStatus(target: PromptRunTarget, run: GraphRunRecord): void {
  const status = resolveGraphMainRunStatusEvent(run);
  if (!status) {
    return;
  }
  sendRunStatusForTab(target.tabId, status);
}

function selectGraphBlockedAttentionNode(run: GraphRunRecord): GraphNodeRecord | null {
  const blockedNodes = run.nodes
    .filter((node) => node.status === "blocked" || node.status === "failed")
    .sort((left, right) => {
      const leftTime = left.completedAt ?? left.startedAt ?? 0;
      const rightTime = right.completedAt ?? right.startedAt ?? 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return run.nodes.indexOf(right) - run.nodes.indexOf(left);
    });
  return blockedNodes[0] ?? null;
}

type GraphRunMergeBackOutcome = {
  run: GraphRunRecord;
  status: "merged" | "direct" | "failed";
  message: string;
  result?: GraphWorktreeMergeBackResult;
  cleanup?: GraphWorktreeCleanupResult;
  error?: string;
};

function finalizeCompletedGraphRunWorktreeMergeBack(run: GraphRunRecord): GraphRunMergeBackOutcome {
  const timestamp = Date.now();
  if (run.executionMode === "direct" && run.directExecution?.cwd) {
    const nextRun = updateGraphRunRecord(run.id, {
      updatedAt: timestamp,
    }) ?? { ...run, updatedAt: timestamp };
    appendGraphEvent(nextRun.eventsFile, {
      runId: nextRun.id,
      type: "run.updated",
      timestamp,
      summary: `Graph run completed in direct workspace mode without worktree merge-back: ${run.directExecution.cwd}`,
      data: {
        executionMode: "direct",
        directExecution: run.directExecution,
      },
    });
    return {
      run: nextRun,
      status: "direct",
      message: `- Direct workspace: executed directly in ${run.directExecution.cwd}; no git worktree, checkpoint, merge-back, or cleanup was used.`,
    };
  }
  const workspaceCwd = resolveWorkspaceCwd();
  if (!workspaceCwd || !run.worktree) {
    const error = !workspaceCwd
      ? "Graph run completed but no active workspace was available for merge-back."
      : "Graph run completed but has no worktree metadata for merge-back.";
    const nextRun = updateGraphRunRecord(run.id, {
      status: "needs-review",
      updatedAt: timestamp,
    }) ?? { ...run, status: "needs-review" as const, updatedAt: timestamp };
    appendGraphEvent(nextRun.eventsFile, {
      runId: nextRun.id,
      type: "run.updated",
      timestamp,
      summary: `Graph worktree merge-back failed: ${error}`,
      error,
      data: { workspaceCwd, worktree: run.worktree },
    });
    return {
      run: nextRun,
      status: "failed",
      message: `- Merge-back: failed; ${error}`,
      error,
    };
  }

  try {
    const result = mergeGraphRunWorktreeToWorkspace({ workspaceCwd, worktree: run.worktree });
    let cleanup: GraphWorktreeCleanupResult;
    try {
      cleanup = cleanupGraphRunWorktree({ workspaceCwd, worktree: run.worktree });
    } catch (cleanupError) {
      const cleanupMessage = errorToMessage(cleanupError);
      const nextRun = updateGraphRunRecord(run.id, {
        status: "needs-review",
        updatedAt: timestamp,
      }) ?? { ...run, status: "needs-review" as const, updatedAt: timestamp };
      appendGraphEvent(nextRun.eventsFile, {
        runId: nextRun.id,
        type: "run.updated",
        timestamp,
        summary: `Graph worktree cleanup failed after merge-back: ${cleanupMessage}`,
        error: cleanupMessage,
        data: {
          workspaceCwd,
          worktree: run.worktree,
          mergeBack: {
            repoRoot: result.repoRoot,
            worktreeCwd: result.worktreeCwd,
            sourceBranch: result.sourceBranch,
            sourceCommit: result.sourceCommit,
            statusAfter: result.statusAfter,
          },
        },
      });
      return {
        run: nextRun,
        status: "failed",
        message: `- Merge-back: applied Graph worktree changes to ${result.repoRoot} with git merge --squash; cleanup failed: ${cleanupMessage}`,
        result,
        error: cleanupMessage,
      };
    }
    const nextRun = updateGraphRunRecord(run.id, {
      updatedAt: timestamp,
      worktree: undefined,
    }) ?? { ...run, updatedAt: timestamp, worktree: undefined };
    appendGraphEvent(nextRun.eventsFile, {
      runId: nextRun.id,
      type: "run.updated",
      timestamp,
      summary: `Graph worktree merged back into workspace and cleaned up without committing: ${result.repoRoot}`,
      data: {
        workspaceCwd: result.workspaceCwd,
        repoRoot: result.repoRoot,
        worktreeCwd: result.worktreeCwd,
        sourceBranch: result.sourceBranch,
        sourceCommit: result.sourceCommit,
        targetHeadBefore: result.targetHeadBefore,
        targetHeadAfter: result.targetHeadAfter,
        statusAfter: result.statusAfter,
        mergeOutput: result.mergeOutput,
        cleanup,
      },
    });
    return {
      run: nextRun,
      status: "merged",
      message: `- Merge-back: applied Graph worktree changes to ${result.repoRoot} with git merge --squash; no commit was created. Cleaned up worktree ${cleanup.worktreeCwd} and branch ${cleanup.sourceBranch}.`,
      result,
      cleanup,
    };
  } catch (error) {
    const message = errorToMessage(error);
    const nextRun = updateGraphRunRecord(run.id, {
      status: "needs-review",
      updatedAt: timestamp,
    }) ?? { ...run, status: "needs-review" as const, updatedAt: timestamp };
    appendGraphEvent(nextRun.eventsFile, {
      runId: nextRun.id,
      type: "run.updated",
      timestamp,
      summary: `Graph worktree merge-back failed: ${message}`,
      error: message,
      data: { workspaceCwd, worktree: run.worktree },
    });
    return {
      run: nextRun,
      status: "failed",
      message: `- Merge-back: failed; ${message}`,
      error: message,
    };
  }
}

function resolveGraphExtensionExecutorMaxConcurrent(run: Pick<GraphRunRecord, "maxConcurrent">): number {
  return Math.max(1, Math.min(run.maxConcurrent, GRAPH_EXTENSION_EXECUTOR_MAX_CONCURRENT_NODES));
}

function maybeMaterializeGraphPlanAfterTick(run: GraphRunRecord): { run: GraphRunRecord; changed: boolean } {
  if (run.templateId !== GRAPH_AI_PLANNER_TEMPLATE_ID || run.nodes.some((node) => node.id !== GRAPH_AI_PLANNER_NODE_ID)) {
    return { run, changed: false };
  }
  const plannerNode = run.nodes.find((node) => node.id === GRAPH_AI_PLANNER_NODE_ID);
  if (!plannerNode || plannerNode.status !== "passed") {
    return { run, changed: false };
  }

  const artifact = readGraphNodeExecutionResultArtifact(resolveGraphNodeCommunicationFile(run, plannerNode));
  if (!artifact?.plannedGraph) {
    return {
      run: failGraphPlannerRun(run, "Graph planner passed without a valid plannedGraph DAG artifact."),
      changed: true,
    };
  }

  const materialized = materializeGraphPlan(run, artifact.plannedGraph);
  if (materialized.error) {
    return {
      run: failGraphPlannerRun(run, materialized.error),
      changed: true,
    };
  }
  if (!materialized.changed) {
    return { run, changed: false };
  }

  const routedRun = applyGraphRunModelRouting(materialized.run);
  const persisted = updateGraphRunRecord(routedRun.id, routedRun) ?? routedRun;
  appendGraphEvent(persisted.eventsFile, {
    runId: persisted.id,
    type: "run.updated",
    summary: `Graph planner materialized ${materialized.plannedNodeIds.length} execution nodes.`,
    data: {
      plannerNodeId: GRAPH_AI_PLANNER_NODE_ID,
      plannedNodeIds: materialized.plannedNodeIds,
      maxConcurrent: persisted.maxConcurrent,
      modelRouting: persisted.modelRouting,
    },
  });
  return { run: persisted, changed: true };
}

function failGraphPlannerRun(run: GraphRunRecord, reason: string): GraphRunRecord {
  const timestamp = Date.now();
  const nodes = run.nodes.map((node) => node.id === GRAPH_AI_PLANNER_NODE_ID
    ? {
      ...node,
      status: "failed" as const,
      completedAt: timestamp,
      lastError: reason,
    }
    : node);
  const nextRun = updateGraphRunRecord(run.id, {
    status: "running",
    updatedAt: timestamp,
    activeNodeIds: [],
    nodes,
  }) ?? {
    ...run,
    status: "running" as const,
    updatedAt: timestamp,
    activeNodeIds: [],
    nodes,
  };
  appendGraphEvent(nextRun.eventsFile, {
    runId: nextRun.id,
    type: "node.failed",
    timestamp,
    nodeId: GRAPH_AI_PLANNER_NODE_ID,
    attempt: nodes.find((node) => node.id === GRAPH_AI_PLANNER_NODE_ID)?.attempts,
    summary: reason,
    error: reason,
  });
  appendGraphEvent(nextRun.eventsFile, {
    runId: nextRun.id,
    type: "run.updated",
    timestamp,
    summary: `Graph run ${nextRun.id} paused because planner output could not be materialized.`,
    data: {
      plannerNodeId: GRAPH_AI_PLANNER_NODE_ID,
      reason,
    },
  });
  return nextRun;
}

type GraphNodeExecutionContext = {
  mode: "worktree";
  cwd: string;
  worktreeCwd: string;
} | {
  mode: "direct";
  cwd: string;
};

function resolveGraphNodeExecutionContext(run: GraphRunRecord): GraphNodeExecutionContext | null {
  if (run.directExecution?.cwd) {
    return {
      mode: "direct",
      cwd: run.directExecution.cwd,
    };
  }
  if (run.worktree?.cwd) {
    return {
      mode: "worktree",
      cwd: run.worktree.cwd,
      worktreeCwd: run.worktree.cwd,
    };
  }
  return null;
}

async function executeGraphNodeViaRunPrompt(
  request: GraphNodeExecutionRequest,
  rootInput: PromptRunInput,
  target: PromptRunTarget,
) {
  const executionContext = resolveGraphNodeExecutionContext(request.run);
  if (!executionContext) {
    return {
      status: "failed" as const,
      summary: `Graph node ${request.node.id} has no execution directory.`,
      error: "Graph run is missing both worktree and direct execution metadata.",
    };
  }

  let baseCommit: string | undefined;
  if (executionContext.mode === "worktree") {
    try {
      baseCommit = getGraphWorktreeHeadCommit(executionContext.worktreeCwd);
    } catch (error) {
      return {
        status: "failed" as const,
        summary: `Graph node ${request.node.id} could not read worktree HEAD.`,
        error: errorToMessage(error),
        executionCwd: executionContext.cwd,
        worktreeCwd: executionContext.worktreeCwd,
      };
    }
  }

  const communicationFile = resolveGraphNodeCommunicationFile(request.run, request.node);
  const graphNodeTarget = createGraphNodeRunTarget(target.cli, request.run.id, request.node.id);
  appendSystemMessageForGraph(
    target,
    buildGraphNodeDispatchedText(request.run, request.node, graphNodeTarget, communicationFile),
    request.run.id,
  );
  appendSystemMessageForGraph(
    graphNodeTarget,
    buildGraphNodeStartedText(request.run, request.node, communicationFile),
    request.run.id,
  );

  const modelRole = request.modelRole
    ?? request.node.modelRole
    ?? (request.node.id === GRAPH_AI_PLANNER_NODE_ID || request.node.kind === "summary" ? "main" : "subtask");
  const selectedModel = request.model ?? resolvePromptRunModelForRole(rootInput, modelRole);
  const modelFallback = request.modelFallback ?? resolvePromptRunModelFallback(rootInput, modelRole);
  const thinkingModeOverride = resolvePromptRunThinkingModeForRole(rootInput, target.cli, modelRole, selectedModel);
  appendGraphEvent(request.run.eventsFile, {
    runId: request.run.id,
    type: "run.updated",
    nodeId: request.node.id,
    attempt: request.attempt,
    summary: `Graph node ${request.node.id} dispatched with ${modelRole} model role.`,
    data: {
      nodeId: request.node.id,
      modelRole,
      model: selectedModel ?? null,
      modelFallback,
      thinkingMode: thinkingModeOverride ?? null,
      modelRouting: request.run.modelRouting,
    },
  });
  void logInfo("graph-node-model-routing", {
    graphRunId: request.run.id,
    nodeId: request.node.id,
    modelRole,
    model: selectedModel ?? null,
    modelFallback,
    thinkingMode: thinkingModeOverride ?? null,
  });

  let runPromptError: unknown;
  try {
    await runPrompt({
      displayPrompt: request.prompt,
      modelPrompt: request.prompt,
      contextTags: rootInput.contextTags,
      model: selectedModel,
      loopMainModel: rootInput.loopMainModel,
      loopSubtaskModel: rootInput.loopSubtaskModel,
      imagePaths: rootInput.imagePaths,
      taskRole: modelRole,
      thinkingModeOverride,
      graphRunId: request.run.id,
      graphNodeId: request.node.id,
      executionCwd: executionContext.cwd,
      isolateProjectInstructions: true,
      skipLongTermMemoryPersist: true,
      throwOnError: true,
    }, {
      targetTabId: graphNodeTarget.tabId,
    });
  } catch (error) {
    runPromptError = error;
  } finally {
    try {
      await closeConversationTabAndRefreshPanel(graphNodeTarget.tabId);
      void logInfo("graph-node-tab-auto-closed", {
        graphRunId: request.run.id,
        nodeId: request.node.id,
        tabId: graphNodeTarget.tabId,
      });
    } catch (error) {
      void logError("graph-node-tab-auto-close-error", {
        graphRunId: request.run.id,
        nodeId: request.node.id,
        tabId: graphNodeTarget.tabId,
        error: errorToMessage(error),
      });
    }
  }

  const artifactResult = readGraphNodeExecutionResultArtifact(communicationFile);
  const executionResult = artifactResult ?? {
    status: "failed" as const,
    summary: runPromptError
      ? `Graph node ${request.node.id} runner failed before a parseable JSON artifact was produced.`
      : `Graph node ${request.node.id} did not produce a parseable ## JSON artifact.`,
    error: runPromptError ? errorToMessage(runPromptError) : "Missing or invalid Graph node ## JSON artifact.",
    artifactRef: communicationFile,
  };
  const result = runPromptError && executionResult.status === "passed"
    ? {
      ...executionResult,
      status: "failed" as const,
      error: errorToMessage(runPromptError),
      summary: `Graph node ${request.node.id} runner failed despite a passed artifact.`,
    }
    : executionResult;

  let commit: string | undefined;
  if (executionContext.mode === "worktree") {
    try {
      const checkpoint = commitGraphNodeCheckpoint({
        worktreeCwd: executionContext.worktreeCwd,
        graphRunId: request.run.id,
        nodeId: request.node.id,
        status: result.status,
        baseCommit: baseCommit as string,
        summary: result.summary,
      });
      commit = checkpoint.commit;
    } catch (error) {
      return {
        status: "failed" as const,
        summary: `Graph node ${request.node.id} could not create a local checkpoint commit.`,
        error: errorToMessage(error),
        artifactRef: result.artifactRef ?? communicationFile,
        acceptance: result.acceptance,
        executionCwd: executionContext.cwd,
        worktreeCwd: executionContext.worktreeCwd,
        baseCommit,
      };
    }
  }

  const executionMetadata = {
    executionCwd: executionContext.cwd,
    ...(executionContext.mode === "worktree" ? { worktreeCwd: executionContext.worktreeCwd } : {}),
    ...(baseCommit ? { baseCommit } : {}),
    ...(commit ? { commit } : {}),
  };
  if (request.node.kind === "summary" && result.status === "passed" && !result.finalAnswer) {
    return {
      ...result,
      finalAnswer: buildGraphRunFinalAnswer(request.run),
      artifactRef: result.artifactRef ?? communicationFile,
      ...executionMetadata,
    };
  }
  return {
    ...result,
    artifactRef: result.artifactRef ?? communicationFile,
    ...executionMetadata,
  };
}

function buildGraphRunFinalAnswer(run: GraphRunRecord): GraphFinalAnswer {
  const completedNodes = run.nodes
    .filter((node) => node.status === "passed")
    .map((node) => `${node.id}:${node.title}`);
  const unresolved = run.nodes
    .filter((node) => node.kind !== "summary" && node.status !== "passed")
    .map((node) => `${node.id}:${node.status}`);
  return {
    conclusion: unresolved.length === 0
      ? "Graph run completed its AI-planned DAG runtime path."
      : "Graph run completed summary with unresolved node state.",
    summary: `Graph run ${run.id} executed an AI-planned Graph DAG through the existing CLI runner path.`,
    evidence: completedNodes,
    unresolved,
  };
}

function resolveGraphRunSessionId(target: PromptRunTarget): string | null {
  const tab = getConversationTabById(target.tabId);
  return tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
}

function buildGraphRunMessageAction(
  graphRunId: string,
  nodeId?: string | null,
  label?: string | null,
): ChatMessageAction {
  return {
    type: "openGraphRun",
    graphRunId,
    ...(nodeId ? { nodeId } : {}),
    ...(label ? { label } : {}),
  };
}

function isTargetedGraphMessageAction(nodeId?: string | null, actionLabel?: string | null): boolean {
  return Boolean(nodeId && actionLabel?.trim());
}

function isPlainGraphRunOpenAction(action: ChatMessageAction, graphRunId: string): boolean {
  return action.type === "openGraphRun"
    && action.graphRunId === graphRunId
    && !action.nodeId
    && !action.label;
}

function isGraphNodeRunTarget(
  target: PromptRunTarget,
  graphRunId: string,
  messages: readonly ChatMessage[],
): boolean {
  const nodeTarget = graphNodeRunTargetsByTabId.get(target.tabId);
  if (nodeTarget?.graphRunId === graphRunId) {
    return true;
  }
  return messages.some((message) => (
    message.graphRunId === graphRunId
    && Boolean(message.graphNodeId)
  ));
}

function hasVisibleGraphRunOpenActionForTarget(
  messages: readonly ChatMessage[],
  graphRunId: string,
): boolean {
  return messages.some((message) => (
    Array.isArray(message.actions)
    && message.actions.some((action) => isPlainGraphRunOpenAction(action, graphRunId))
  ));
}

function resolveGraphSystemMessageActions(
  target: PromptRunTarget,
  graphRunId?: string | null,
  nodeId?: string | null,
  actionLabel?: string | null,
): ChatMessageAction[] {
  if (!graphRunId) {
    return [];
  }
  if (isTargetedGraphMessageAction(nodeId, actionLabel)) {
    return [buildGraphRunMessageAction(graphRunId, nodeId, actionLabel)];
  }
  const messages = getLoopMessagesForTarget(target);
  if (
    isGraphNodeRunTarget(target, graphRunId, messages)
    || hasVisibleGraphRunOpenActionForTarget(messages, graphRunId)
  ) {
    return [];
  }
  return [buildGraphRunMessageAction(graphRunId)];
}

function appendSystemMessageForGraph(
  target: PromptRunTarget,
  content: string,
  graphRunId?: string | null,
  nodeId?: string | null,
  actionLabel?: string | null,
): void {
  const actions = resolveGraphSystemMessageActions(target, graphRunId, nodeId, actionLabel);
  appendSystemMessageForLoop(target, content, {
    merge: false,
    ...(actions.length ? { actions } : {}),
  });
}

function buildGraphNodeDispatchedText(
  run: GraphRunRecord,
  node: GraphNodeExecutionRequest["node"],
  graphNodeTarget: PromptRunTarget,
  communicationFile: string,
): string {
  return [
    `Graph 节点已派发：${node.id}`,
    "",
    `- 运行：${run.id}`,
    `- 节点：${node.title}`,
    `- 子任务 tab：${graphNodeTarget.tabId}`,
    `- 并行上限：${run.maxConcurrent}`,
    `- 执行模式：${formatGraphRunExecutionMode(run)}`,
    `- 执行目录：${formatGraphRunExecutionCwd(run)}`,
    `- 沟通文件：${communicationFile}`,
  ].join("\n");
}

function buildGraphNodeStartedText(
  run: GraphRunRecord,
  node: GraphNodeExecutionRequest["node"],
  communicationFile: string,
): string {
  return [
    `Graph 子节点开始执行：${node.id}`,
    "",
    `- 运行：${run.id}`,
    `- 节点标题：${node.title}`,
    `- 节点类型：${node.kind}`,
    `- 执行模式：${formatGraphRunExecutionMode(run)}`,
    `- 执行目录：${formatGraphRunExecutionCwd(run)}`,
    `- 授权文件：${node.writeFiles?.length ? node.writeFiles.join("、") : "未声明"}`,
    `- 沟通文件：${communicationFile}`,
  ].join("\n");
}

function formatGraphRunExecutionMode(run: GraphRunRecord): string {
  return run.executionMode === "direct" && run.directExecution?.cwd
    ? "direct project workspace"
    : "isolated git worktree";
}

function formatGraphRunExecutionCwd(run: GraphRunRecord): string {
  return run.executionMode === "direct" && run.directExecution?.cwd
    ? run.directExecution.cwd
    : (run.worktree?.cwd ?? "unavailable");
}

function buildGraphRunStartedText(run: GraphRunRecord): string {
  const executionLines = run.executionMode === "direct" && run.directExecution
    ? [
      `- Execution directory: ${run.directExecution.cwd}`,
      "- Worktree: not used; changes are written directly to the current project workspace.",
    ]
    : [
      `- Worktree: ${run.worktree?.cwd ?? "unavailable"}`,
    ];
  return [
    `Graph run created: ${run.id}`,
    "",
    `- Planner: ${GRAPH_AI_PLANNER_NODE_ID} will generate the executable DAG before work nodes run.`,
    `- Runtime: ${formatGraphRunExecutionMode(run)} via runPrompt, planner=main, execution=subtask`,
    ...executionLines,
    `- Scheduler: maxConcurrent=${run.maxConcurrent}`,
    `- Graph file: ${run.graphFile}`,
  ].join("\n");
}

function buildGraphRunCompletedText(run: GraphRunRecord, mergeBack?: GraphRunMergeBackOutcome): string {
  return [
    `Graph run completed: ${run.id}`,
    "",
    run.finalAnswer?.summary ?? "AI-planned Graph runtime path completed.",
    ...(mergeBack ? [mergeBack.message] : []),
  ].join("\n");
}

function buildGraphFinalSummaryMarkdown(run: GraphRunRecord): string {
  const finalAnswer = run.finalAnswer ?? buildGraphRunFinalAnswer(run);
  const evidence = finalAnswer.evidence.length
    ? finalAnswer.evidence
    : ["无可用证据引用。"];
  const unresolved = finalAnswer.unresolved.length
    ? finalAnswer.unresolved
    : ["无。"];
  const summarySource = run.finalAnswer
    ? "summary 节点 finalAnswer（主模型）"
    : "宿主 fallback（summary 节点未提供 finalAnswer）";
  const lines: string[] = [
    "# Graph 任务最终总结",
    "",
    `- Graph 运行 ID：${run.id}`,
    `- 会话 ID：${run.sessionId ?? "unknown"}`,
    `- 生成时间：${new Date().toISOString()}`,
    `- 总结来源：${summarySource}`,
    "",
    "## 问题回答结论",
    finalAnswer.conclusion,
    "",
    "## 任务总结",
    finalAnswer.summary,
    "",
    "## 验证证据",
    ...evidence.map((item) => `- ${item}`),
    "",
    "## 未完成事项",
    ...unresolved.map((item) => `- ${item}`),
  ];
  return `${lines.join("\n")}\n`;
}

function buildGraphRunNeedsAttentionText(run: GraphRunRecord, mergeBack?: GraphRunMergeBackOutcome): string {
  const blockedNodes = run.nodes
    .filter((node) => node.status === "blocked" || node.status === "failed" || node.status === "sleeping")
    .map((node) => `${node.id}:${node.status}${node.lastError ? ` (${node.lastError})` : ""}`);
  return [
    `Graph run needs attention: ${run.id}`,
    "",
    `- Status: ${run.status}`,
    `- Nodes: ${blockedNodes.length ? blockedNodes.join(", ") : "No blocked node details recorded."}`,
    `- Graph file: ${run.graphFile}`,
    ...(mergeBack ? [mergeBack.message] : []),
  ].join("\n");
}

function buildGraphRunIdleText(run: GraphRunRecord): string {
  return [
    `Graph run paused for review: ${run.id}`,
    "",
    "- Status: no runnable node remained while the run was still active.",
    `- Graph file: ${run.graphFile}`,
  ].join("\n");
}

function buildGraphRunErrorText(graphRunId: string | null, error: string): string {
  return [
    `Graph run error${graphRunId ? `: ${graphRunId}` : ""}`,
    "",
    error,
  ].join("\n");
}

async function runLoopPromptOrchestration(
  input: PromptRunInput,
  options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean } = {},
  onTaskOwnershipAcquired?: (taskId: string, target: PromptRunTarget) => void,
): Promise<void> {
  const target = resolvePromptRunTarget(options.targetTabId ?? getActiveConversationTabId());
  if (!target || !input.displayPrompt.trim()) {
    return;
  }
  input = await hydrateOpenCodePromptRoleModels(input, target.cli);

  const resumeTaskId = typeof options.resumeTaskId === "string" && options.resumeTaskId.trim()
    ? options.resumeTaskId.trim()
    : null;
  const resumeRequested = options.resumeRequested === true;

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
      cancelLoopTaskAutoWake(existingTask.id);
      task = updateLoopTaskRecord(existingTask.id, {
        status: "running",
        activeSubtaskId: null,
        activeSubtaskIds: [],
        autoSleepStartedAt: undefined,
        autoWakeAt: undefined,
        autoSleepReason: undefined,
        updatedAt: Date.now(),
      }, { allowCompletedToRunning: shouldResumeCompletedWithoutCompletionMessages }) ?? existingTask;
      round = resolveLoopResumeRound(task);
      appendSystemMessageForLoop(target, buildLoopTaskResumedText(task, round), (
        {
          taskRole: "main",
          loopTaskId: task.id,
          loopRound: round,
          merge: false,
          actions: [buildLoopDebateChatMessageAction(task.id, round)],
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
      appendSystemMessageForLoop(target, t("run.loopResumeUnavailableStartNew"));
      void logInfo("loop-task-resume-not-found", {
        tabId: target.tabId,
        cli: target.cli,
      });
    }
    const initialSessionId = resolveLoopTaskSessionId(target);
    task = createLoopTaskRecord(target.cli, input.displayPrompt, {
      sessionId: initialSessionId,
      executionMode: input.loopExecutionMode,
    });
    if (!isLoopDebateGroupChatTask(task)) {
      ensureLoopMainSubChatTranscript(task);
    }
    appendSystemMessageForLoop(target, buildLoopTaskStartedText(task), (
      {
        taskRole: "main",
        loopTaskId: task.id,
        merge: false,
        actions: [buildLoopDebateChatMessageAction(task.id)],
      }
    ));
  }

  if (!task) {
    return;
  }
  onTaskOwnershipAcquired?.(task.id, target);
  await postPanelState();

  while (round <= task.maxRounds) {
    const latest: LoopTaskRecord = readLoopTaskRecord(task.id) ?? task;
    task = latest;
    if (isLoopTaskBlockedByMainAiFailureLimit(latest)) {
      appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(latest));
      return;
    }
    if (latest.status === "needs-review" || latest.status === "error" || latest.status === "stopped") {
      return;
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
          actions: [buildLoopDebateChatMessageAction(resumed.id, round)],
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

    const executionMode = normalizeLoopExecutionMode(latest.executionMode);
    const shouldRunPlanningDebate = executionMode === "debate_multi_agent"
      && shouldRunLoopPlanningDebate(latest, round);
    let decisionRunResult: LoopMainDecisionRunResult;
    try {
      decisionRunResult = shouldRunPlanningDebate
        ? await runLoopDebateRound({
            input,
            target,
            task: latest,
            round,
          })
        : await runClassicLoopMainDecision({
            input,
            target,
            task: latest,
            round,
            moderatorLed: executionMode === "debate_multi_agent",
          });
    } catch (error) {
      void logError("loop-main-decision-run-error", {
        taskId: latest.id,
        round,
        executionMode,
        shouldRunPlanningDebate,
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
    if (decisionRunResult.status === "sleeping") {
      showLoopAutoSleepMessage(target, decisionRunResult.task, round, decisionRunResult.decision);
      scheduleLoopTaskAutoWake(decisionRunResult.task);
      void logInfo("loop-auto-sleep-scheduled", {
        taskId: decisionRunResult.task.id,
        round,
        autoWakeAt: decisionRunResult.task.autoWakeAt,
        wakeAfterSeconds: decisionRunResult.decision.wakeAfterSeconds,
      });
      return;
    }
    if (decisionRunResult.status === "needs-review") {
      appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(decisionRunResult.task));
      return;
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
      const interruptedStatus = interrupted.status === "stopped" ? "stopped" : "error";
      markLoopTaskInterrupted(decisionRunResult.task.id, interruptedStatus, target, {
        source: "subtask",
      });
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

async function runClassicLoopMainDecision(options: {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LoopTaskRecord;
  round: number;
  moderatorLed?: boolean;
}): Promise<LoopMainDecisionRunResult> {
  const { input, target, task, round } = options;
  const moderatorLed = options.moderatorLed === true;
  let mainStatus: TaskRunStatus;
  try {
    mainStatus = await runLoopRound({
      input,
      target,
      task,
      round,
      role: "main",
      displayPrompt: moderatorLed
        ? buildLoopModeratorMainDisplayPrompt(task.rootPrompt, round)
        : buildLoopMainDisplayPrompt(task.rootPrompt, round),
      modelPrompt: moderatorLed
        ? buildLoopModeratorMainModelPrompt(
            input.loopContinuePrompt ? task.rootPrompt : (input.modelPrompt || task.rootPrompt),
            task,
            round,
            input.loopContinuePrompt,
          )
        : buildLoopMainModelPrompt(
            input.loopContinuePrompt ? task.rootPrompt : (input.modelPrompt || task.rootPrompt),
            task,
            round,
            input.loopContinuePrompt,
          ),
    });
  } catch (error) {
    void logError("loop-main-round-run-error", {
      taskId: task.id,
      round,
      error: errorToMessage(error),
    });
    markLoopTaskInterrupted(task.id, "error", target, {
      source: "main",
      failureMessage: errorToMessage(error),
    });
    return { status: "interrupted", task: readLoopTaskRecord(task.id) ?? task, runStatus: "error" };
  }
  if (mainStatus === "error" || mainStatus === "stopped") {
    return { status: "interrupted", task, runStatus: mainStatus };
  }

  const mainContent = getLastLoopAssistantContent(target, task.id, round, "main");
  const decision = parseLoopMainDecision(mainContent);
  if (!decision) {
    void logError("loop-main-decision-invalid", {
      taskId: task.id,
      round,
      cli: target.cli,
      hasAssistantContent: Boolean(mainContent?.trim()),
      assistantContentLength: mainContent?.length ?? 0,
    });
    const failedRecord = updateLoopTaskRecord(task.id, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      updatedAt: Date.now(),
      finalSummary: "Main task did not return a valid loop decision JSON.",
    }) ?? task;
    return { status: "needs-review", task: failedRecord };
  }

  return applyLoopMainDecisionForRun(task.id, decision);
}

function applyLoopMainDecisionForRun(
  taskId: string,
  decision: LoopMainDecision,
): LoopMainDecisionRunResult {
  updateLoopTaskRecord(taskId, {
    ...buildResetLoopMainAiFailureState(),
    updatedAt: Date.now(),
  });
  const decisionResult = applyLoopMainDecision(taskId, decision);
  if (decisionResult.status === "completed") {
    return { status: "completed", task: decisionResult.task, decision };
  }
  if (decisionResult.status === "sleeping") {
    return { status: "sleeping", task: decisionResult.task, decision };
  }
  if (decisionResult.status === "blocked" || !decisionResult.subtasks?.length) {
    return { status: "needs-review", task: decisionResult.task, decision };
  }
  return {
    status: "continue",
    task: decisionResult.task,
    decision,
    subtasks: decisionResult.subtasks,
  };
}

type LoopDebateParticipantArtifactValidation = {
  valid: boolean;
  participants: LoopDebateParticipantRecord[];
  reasons: string[];
};

type LoopDebateReusableDecisionResult =
  | {
      status: "reusable";
      decision: LoopMainDecision;
      consensus: LoopDebateConsensusRecord<LoopMainDecision>;
      participants: LoopDebateParticipantRecord[];
    }
  | {
      status: "needs-review";
      reasons: string[];
      consensus?: LoopDebateConsensusRecord<LoopMainDecision>;
      participants: LoopDebateParticipantRecord[];
    }
  | { status: "rerun"; reasons: string[] };

type LoopDebateSpeakerBatch = {
  speakerIds: string[];
  speakers: LoopDebateParticipantDefinition[];
};

function shouldRunLoopPlanningDebate(task: LoopTaskRecord, round: number): boolean {
  if (normalizeLoopExecutionMode(task.executionMode) !== "debate_multi_agent") {
    return false;
  }
  void round;
  return !findReusableLoopPlanningDebateRound(task);
}

function findReusableLoopPlanningDebateRound(
  task: LoopTaskRecord,
): LoopDebateRoundRecord<LoopMainDecision> | null {
  const rounds = Array.isArray(task.debateRounds) ? task.debateRounds : [];
  const sortedRounds = rounds
    .filter((round) => round.status === "consensus" && Boolean(round.consensus))
    .slice()
    .sort((left, right) => (
      left.loopRound - right.loopRound
      || left.debateRound - right.debateRound
      || left.startedAt - right.startedAt
    ));

  for (const round of sortedRounds) {
    const paths = buildLoopDebatePaths(task.communicationDir, round.loopRound, round.debateRound);
    const participants = resolveExistingLoopDebateParticipantRecords(
      task,
      round.loopRound,
      round.debateRound,
      paths,
      undefined,
      buildLoopDebateSessionState(task, round.loopRound, round.debateRound),
    );
    const reusable = evaluateReusableLoopDebateDecision(
      task,
      round.loopRound,
      round.debateRound,
      paths,
      participants,
    );
    if (reusable.status === "reusable" && reusable.decision.status !== "blocked") {
      return round;
    }
  }

  return null;
}

function readLoopPlanningDebateDecision(
  task: LoopTaskRecord,
  round: Pick<LoopDebateRoundRecord<LoopMainDecision>, "loopRound" | "debateRound">,
): LoopMainDecision | null {
  const paths = buildLoopDebatePaths(task.communicationDir, round.loopRound, round.debateRound);
  return parseLoopMainDecision(readTextFileIfNonEmpty(paths.decisionFile));
}

async function runLoopDebateRound(options: {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LoopTaskRecord;
  round: number;
}): Promise<LoopMainDecisionRunResult> {
  const { input, target, task, round } = options;
  const debateRound = LOOP_DEBATE_DEFAULT_DEBATE_ROUND;
  const paths = buildLoopDebatePaths(task.communicationDir, round, debateRound);
  const model = resolveLoopDebateModel(input);
  const debateSessions = buildLoopDebateSessionState(task, round, debateRound);
  const reusableParticipants = resolveExistingLoopDebateParticipantRecords(
    task,
    round,
    debateRound,
    paths,
    model,
    debateSessions
  );
  const reusable = evaluateReusableLoopDebateDecision(task, round, debateRound, paths, reusableParticipants);
  if (reusable.status === "reusable") {
    upsertLoopDebateRoundRecord(task.id, {
      loopRound: round,
      debateRound,
      status: "consensus",
      startedAt: getExistingLoopDebateRoundStartedAt(task, round, debateRound) ?? Date.now(),
      completedAt: Date.now(),
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      participants: reusable.participants,
      consensus: reusable.consensus,
    });
    refreshOpenLoopGroupChatPanelForTask(task.id);
    appendSystemMessageForLoop(target, buildLoopDebateReuseText(task.id, round, paths));
    appendLoopDebateMainCommunicationLog(task, round, paths, "复用红蓝对抗共识", [
      `decision.json：${paths.decisionFile}`,
      `consensus.md：${paths.consensusFile}`,
    ]);
    return applyLoopMainDecisionForRun(task.id, reusable.decision);
  }
  if (reusable.status === "needs-review") {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: reusable.participants,
      consensus: reusable.consensus,
      reasons: reusable.reasons,
      status: "blocked",
    });
  }
  if (reusable.reasons.length > 0) {
    appendSystemMessageForLoop(target, buildLoopDebateRerunText(task.id, round, reusable.reasons));
  }

  const startedAt = Date.now();
  const briefWritten = writeTextFileEnsuringDir(
    paths.briefFile,
    buildLoopDebateBriefMarkdown(
      task,
      target,
      round,
      paths,
      input.loopContinuePrompt,
    )
  );
  if (!briefWritten) {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: [],
      reasons: [`无法写入辩论 brief：${paths.briefFile}`],
      status: "error",
    });
  }
  const chatWritten = writeTextFileEnsuringDir(paths.chatFile, buildLoopDebateInitialChatMarkdown(task, target, round, paths));
  if (!chatWritten) {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: [],
      reasons: [`无法写入红蓝对抗群聊记录：${paths.chatFile}`],
      status: "error",
    });
  }

  updateLoopTaskRecord(task.id, {
    status: "running",
    currentRound: round,
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: startedAt,
  });
  upsertLoopDebateRoundRecord(task.id, {
    loopRound: round,
    debateRound,
    status: "running",
    startedAt,
    briefFile: paths.briefFile,
    chatFile: paths.chatFile,
    participantRosterFile: paths.participantRosterFile,
    dialogueTurns: 0,
    participants: [],
    moderatorDecisions: [],
  });
  refreshOpenLoopGroupChatPanelForTask(task.id);

  const runnerDeps = getLoopDebateRunnerDeps();
  const debateTabIds: string[] = [];
  const rosterResult = await runLoopDebateParticipantRoster({
    deps: runnerDeps,
    input,
    mainTarget: target,
    task,
    round,
    debateRound,
    paths,
    sessionId: debateSessions.moderator,
    startedAt,
  });
  debateTabIds.push(rosterResult.tabId);
  if (rosterResult.sessionId) {
    debateSessions.moderator = rosterResult.sessionId;
  }
  await closeCompletedLoopDebateTabs([rosterResult.tabId]);
  if (!rosterResult.valid) {
    await closeCompletedLoopDebateTabs(debateTabIds);
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: [],
      reasons: rosterResult.reasons,
      status: "error",
    });
  }

  const participantDefinitions = rosterResult.participants;
  const participantRecords = buildLoopDebateParticipantRecords(
    paths,
    model,
    "pending",
    participantDefinitions
  ).map((participant) => ({
    ...participant,
    sessionId: debateSessions.participants[participant.id] ?? null,
  }));
  const rosterAppended = appendTextFileEnsuringDir(
    paths.chatFile,
    buildLoopDebateParticipantRosterChatMarkdown(
      participantDefinitions,
      rosterResult.summary,
      rosterResult.openingSpeakerIds,
    )
  );
  if (!rosterAppended) {
    await closeCompletedLoopDebateTabs(debateTabIds);
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: participantRecords,
      reasons: [`无法追加裁判主持人选定的红蓝参与者到群聊记录：${paths.chatFile}`],
      status: "error",
    });
  }

  upsertLoopDebateRoundRecord(task.id, {
    loopRound: round,
    debateRound,
    status: "running",
    startedAt,
    briefFile: paths.briefFile,
    chatFile: paths.chatFile,
    participantRosterFile: paths.participantRosterFile,
    dialogueTurns: 0,
    participants: participantRecords,
    moderatorDecisions: [],
  });
  refreshOpenLoopGroupChatPanelForTask(task.id);
  appendSystemMessageForLoop(target, buildLoopDebateStartedText(task.id, round, participantRecords, paths));

  let finalModeratorDecision: LoopDebateModeratorDecisionRecord | null = null;
  let completedDialogueTurns = 0;
  let currentSpeakerBatch = buildLoopDebateSpeakerBatch(participantDefinitions, rosterResult.openingSpeakerIds);
  if (currentSpeakerBatch.speakers.length === 0) {
    currentSpeakerBatch = buildLoopDebateSpeakerBatch(
      participantDefinitions,
      selectDefaultLoopDebateOpeningSpeakerIds(participantDefinitions),
    );
  }
  for (let dialogueTurn = 1; dialogueTurn <= LOOP_DEBATE_MAX_DIALOGUE_TURNS; dialogueTurn += 1) {
    completedDialogueTurns = dialogueTurn;
    if (currentSpeakerBatch.speakers.length === 0) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`裁判主持人未为第 ${dialogueTurn} 个发言批次指定有效发言者。`],
        status: "error",
      });
    }
    appendSystemMessageForLoop(
      target,
      buildLoopDebateDialogueTurnStartedText(
        task.id,
        round,
        dialogueTurn,
        LOOP_DEBATE_MAX_DIALOGUE_TURNS,
        currentSpeakerBatch.speakers,
        paths,
      )
    );
    const dialogueTurnEventAppended = appendTextFileEnsuringDir(
      paths.chatFile,
      buildLoopDebateDialogueTurnChatEventMarkdown(
        round,
        dialogueTurn,
        LOOP_DEBATE_MAX_DIALOGUE_TURNS,
        finalModeratorDecision,
        currentSpeakerBatch.speakers,
      )
    );
    if (!dialogueTurnEventAppended) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`无法追加辩论发言批次系统消息：${paths.chatFile}`],
        status: "error",
      });
    }
    refreshOpenLoopGroupChatPanelForTask(task.id);
    const participantBatch = await runLoopDebateParticipantBatch({
      deps: runnerDeps,
      input,
      mainTarget: target,
      task,
      round,
      debateRound,
      dialogueTurn,
      maxDialogueTurns: LOOP_DEBATE_MAX_DIALOGUE_TURNS,
      finalPass: false,
      paths,
      participants: currentSpeakerBatch.speakers,
      debateSessions,
      moderatorDecision: finalModeratorDecision,
      startedAt,
    });
    debateTabIds.push(...participantBatch.map((item) => item.result.tabId));
    participantBatch.forEach((item) => {
      if (item.result.sessionId) {
        debateSessions.participants[item.participant.id] = item.result.sessionId;
      }
    });
    await closeCompletedLoopDebateTabs(participantBatch.map((item) => item.result.tabId));
    const missingArtifacts = participantBatch.filter((item) => !item.artifactText);
    if (missingArtifacts.length > 0) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: missingArtifacts.map((item) => (
          `红蓝对抗发言批次 ${dialogueTurn} 参与者 ${item.participant.id} 未写入发言 artifact：${item.artifactFile}`
        )),
        status: "error",
      });
    }
    for (const item of participantBatch) {
      const appended = appendTextFileEnsuringDir(
        paths.chatFile,
        buildLoopDebateChatTurnMarkdown(
          dialogueTurn,
          item.participant.id,
          item.participant.title,
          item.artifactText ?? "",
        )
      );
	      if (!appended) {
	        await closeCompletedLoopDebateTabs(debateTabIds);
	        return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`无法追加红蓝对抗群聊记录：${paths.chatFile}`],
          status: "error",
        });
      }
      refreshOpenLoopGroupChatPanelForTask(task.id);
    }

    const moderatorResult = await runLoopDebateModerator({
      deps: runnerDeps,
      input,
      mainTarget: target,
      task,
      round,
      debateRound,
      dialogueTurn,
      maxDialogueTurns: LOOP_DEBATE_MAX_DIALOGUE_TURNS,
      paths,
      sessionId: debateSessions.moderator,
      participants: participantDefinitions,
      startedAt,
    });
    debateTabIds.push(moderatorResult.tabId);
    if (moderatorResult.sessionId) {
      debateSessions.moderator = moderatorResult.sessionId;
    }
    await closeCompletedLoopDebateTabs([moderatorResult.tabId]);
    const moderatorArtifactFile = buildLoopDebateModeratorArtifactFile(paths, dialogueTurn);
    const moderatorText = readTextFileIfNonEmpty(moderatorArtifactFile);
    if (!moderatorText || !moderatorResult.decision) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`裁判主持人第 ${dialogueTurn} 轮控场 artifact 缺失、为空或无法解析：${moderatorArtifactFile}`],
        status: "error",
      });
    }
    finalModeratorDecision = moderatorResult.decision;
    const nextSpeakerBatch = buildLoopDebateSpeakerBatch(participantDefinitions, moderatorResult.decision.nextSpeakerIds);
    const moderatorAppended = appendTextFileEnsuringDir(
      paths.chatFile,
      buildLoopDebateModeratorTurnMarkdown(dialogueTurn, moderatorText)
    );
	    if (!moderatorAppended) {
	      await closeCompletedLoopDebateTabs(debateTabIds);
	      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`无法追加裁判主持人控场记录：${paths.chatFile}`],
        status: "error",
      });
    }
    refreshOpenLoopGroupChatPanelForTask(task.id);
    if (moderatorResult.decision.action === "continue" && nextSpeakerBatch.speakers.length === 0) {
      await closeCompletedLoopDebateTabs(debateTabIds);
      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`裁判主持人第 ${dialogueTurn} 轮选择 continue，但未指定有效的下一批发言者。`],
        status: "error",
      });
    }
    if (moderatorResult.decision.action !== "continue") {
      break;
    }
    currentSpeakerBatch = nextSpeakerBatch;
    if (dialogueTurn === LOOP_DEBATE_MAX_DIALOGUE_TURNS) {
      finalModeratorDecision = {
        ...moderatorResult.decision,
        action: "finalize",
        reason: `已达到运行时最大安全上限 ${LOOP_DEBATE_MAX_DIALOGUE_TURNS} 个发言批次，强制进入最终立场收集。裁判主持人原始理由：${moderatorResult.decision.reason}`,
        nextSpeakerIds: [],
        updatedAt: Date.now(),
      };
      const capAppended = appendTextFileEnsuringDir(
        paths.chatFile,
        buildLoopDebateRuntimeForcedFinalizeMarkdown(finalModeratorDecision)
      );
	      if (!capAppended) {
	        await closeCompletedLoopDebateTabs(debateTabIds);
	        return markLoopDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`无法追加最大安全发言批次数收束记录：${paths.chatFile}`],
          status: "error",
        });
      }
      refreshOpenLoopGroupChatPanelForTask(task.id);
      break;
    }
  }

  if (!finalModeratorDecision) {
    await closeCompletedLoopDebateTabs(debateTabIds);
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
      reasons: ["裁判主持人未输出任何控场决策。"],
      status: "error",
    });
  }

  appendSystemMessageForLoop(
    target,
    buildLoopDebateFinalStanceStartedText(task.id, round, finalModeratorDecision, paths)
  );
  const finalStanceBatch = await runLoopDebateParticipantBatch({
    deps: runnerDeps,
    input,
    mainTarget: target,
    task,
    round,
    debateRound,
    dialogueTurn: completedDialogueTurns,
    maxDialogueTurns: LOOP_DEBATE_MAX_DIALOGUE_TURNS,
    finalPass: true,
    paths,
    participants: participantDefinitions,
    debateSessions,
    moderatorDecision: finalModeratorDecision,
    startedAt,
  });
  debateTabIds.push(...finalStanceBatch.map((item) => item.result.tabId));
  finalStanceBatch.forEach((item) => {
    if (item.result.sessionId) {
      debateSessions.participants[item.participant.id] = item.result.sessionId;
    }
  });
  await closeCompletedLoopDebateTabs(finalStanceBatch.map((item) => item.result.tabId));
  const missingFinalArtifacts = finalStanceBatch.filter((item) => !item.artifactText);
  if (missingFinalArtifacts.length > 0) {
    await closeCompletedLoopDebateTabs(debateTabIds);
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
      reasons: missingFinalArtifacts.map((item) => (
        `参与者 ${item.participant.id} 未写入最终立场 artifact：${item.artifactFile}`
      )),
      status: "error",
    });
  }
  for (const item of finalStanceBatch) {
    const appended = appendTextFileEnsuringDir(
      paths.chatFile,
      buildLoopDebateFinalParticipantMarkdown(
        item.participant.id,
        item.participant.title,
        item.artifactText ?? "",
      )
    );
	    if (!appended) {
	      await closeCompletedLoopDebateTabs(debateTabIds);
	      return markLoopDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`无法追加最终立场到红蓝对抗群聊记录：${paths.chatFile}`],
        status: "error",
      });
    }
    refreshOpenLoopGroupChatPanelForTask(task.id);
  }
  const chatClosed = appendTextFileEnsuringDir(
    paths.chatFile,
    buildLoopDebateDialogueClosedMarkdown(
      completedDialogueTurns,
      LOOP_DEBATE_MAX_DIALOGUE_TURNS,
      finalModeratorDecision
    )
  );
	  if (!chatClosed) {
	    await closeCompletedLoopDebateTabs(debateTabIds);
	    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
      reasons: [`无法写入红蓝对抗群聊收束标记：${paths.chatFile}`],
      status: "error",
    });
  }
  refreshOpenLoopGroupChatPanelForTask(task.id);
  await closeCompletedLoopDebateTabs(debateTabIds);
  await switchVisibleConversationTabForLoop(target.tabId);

  const participantValidation = validateLoopDebateParticipantArtifacts(paths, participantRecords, model, debateSessions);
  upsertLoopDebateRoundRecord(task.id, {
    loopRound: round,
    debateRound,
    status: "running",
    startedAt,
    briefFile: paths.briefFile,
    chatFile: paths.chatFile,
    participantRosterFile: paths.participantRosterFile,
    dialogueTurns: completedDialogueTurns,
    participants: participantValidation.participants,
  });

  if (!participantValidation.valid) {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: participantValidation.participants,
      reasons: participantValidation.reasons,
      status: "blocked",
    });
  }

  appendSystemMessageForLoop(target, buildLoopDebateParticipantsCollectedText(task.id, round, participantValidation.participants));

  if (finalModeratorDecision.action === "block") {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: participantValidation.participants,
      reasons: [`裁判主持人决定阻塞：${finalModeratorDecision.reason}`],
      status: "blocked",
    });
  }

  const consensusRun = await runLoopDebateConsensusSummary({
    deps: runnerDeps,
    input,
    target,
    task,
    round,
    debateRound,
    paths,
    participants: participantValidation.participants,
  });
  await closeCompletedLoopDebateTabs([consensusRun.tabId]);
  await switchVisibleConversationTabForLoop(target.tabId);

  const crossReviewText = readTextFileIfNonEmpty(paths.crossReviewFile);
  if (!crossReviewText) {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: participantValidation.participants,
      reasons: [`cross-review.md 缺失或为空：${paths.crossReviewFile}`],
      status: "error",
    });
  }

  const decisionText = readTextFileIfNonEmpty(paths.decisionFile);
  const decision = parseLoopMainDecision(decisionText);
  if (!decision) {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: participantValidation.participants,
      reasons: [`decision.json 缺失或不是合法 LoopMainDecision JSON：${paths.decisionFile}`],
      status: "error",
    });
  }

  const consensus = readLoopDebateConsensusRecord(paths.consensusFile, participantValidation.participants, decision);
  if (!consensus) {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: participantValidation.participants,
      reasons: [`consensus.md 缺失或不含合法共识 JSON：${paths.consensusFile}`],
      status: "error",
    });
  }
  const mergedConsensus = mergeLoopDebateConsensusWithParticipantArtifacts(consensus, participantValidation.participants, decision);
  const consensusValidation = validateLoopDebateConsensus(mergedConsensus);
  if (!consensusValidation.canProceed) {
    return markLoopDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: participantValidation.participants,
      consensus: mergedConsensus,
      reasons: consensusValidation.reasons,
      status: "blocked",
    });
  }

  upsertLoopDebateRoundRecord(task.id, {
    loopRound: round,
    debateRound,
    status: "consensus",
    startedAt,
    completedAt: Date.now(),
    briefFile: paths.briefFile,
    chatFile: paths.chatFile,
    participantRosterFile: paths.participantRosterFile,
    participants: participantValidation.participants,
    consensus: mergedConsensus,
  });
  refreshOpenLoopGroupChatPanelForTask(task.id);
  appendSystemMessageForLoop(
    target,
    buildLoopDebateConsensusReachedText(
      task.id,
      round,
      decision,
      paths,
      getLoopDecisionSubtasks,
      formatLoopEstimatedRemainingRounds,
    )
  );
  appendLoopDebateMainCommunicationLog(task, round, paths, "红蓝对抗共识已形成", [
    `共识摘要：${mergedConsensus.summary}`,
    `决策状态：${decision.status}`,
    `decision.json：${paths.decisionFile}`,
  ]);
  return applyLoopMainDecisionForRun(task.id, decision);
}

function resolveLoopDebateModel(input: PromptRunInput): string | undefined {
  return resolvePromptRunModelForRole(input, "main");
}

function getLoopDebateRunnerDeps(): LoopDebateRunnerDeps {
  return {
    appendSystemMessageForLoop,
    buildLoopDebateConsensusStartedText,
    buildLoopDebateModeratorFinishedText,
    buildLoopDebateModeratorStartedText,
    buildLoopDebateParticipantFinishedText,
    buildLoopDebateParticipantRosterFailedText,
    buildLoopDebateParticipantRosterFinishedText,
    buildLoopDebateParticipantRosterStartedText,
    buildLoopDebateParticipantStartedText,
    createLoopSubtaskRunTarget,
    errorToMessage,
    getExistingLoopDebateRoundStartedAt,
    logError: (event: string, payload?: unknown) => logError(event, payload),
    readLoopDebateModeratorDecisionArtifact,
    readLoopDebateParticipantArtifact,
    readLoopDebateParticipantRosterArtifact,
    readLoopDebateParticipantTurnArtifact,
    readTextFileIfNonEmpty,
    refreshOpenLoopGroupChatPanelForTask,
    resolvePromptRunTargetSessionId,
    runPrompt,
    updateLoopDebateActiveSpeakerRecord,
    updateLoopDebateModeratorDecisionRecord,
    updateLoopDebateParticipantRecord,
    updateLoopDebateParticipantRosterSessionRecord,
  };
}

function buildLoopDebateParticipantRecords(
  paths: LoopDebatePaths,
  model: string | undefined,
  status: LoopDebateParticipantRecord["status"],
  participants: readonly LoopDebateParticipantDefinition[],
): LoopDebateParticipantRecord[] {
  const now = Date.now();
  return participants.map((participant) => ({
    id: participant.id,
    role: participant.role,
    title: participant.title,
    model: model ?? null,
    status,
    artifactFile: buildLoopDebateParticipantArtifactFile(paths, participant.id),
    updatedAt: now,
  }));
}

function buildLoopDebateSessionState(
  task: LoopTaskRecord,
  round: number,
  debateRound: number,
): LoopDebateSessionState {
  const existingRound = task.debateRounds?.find((item) => (
    item.loopRound === round
    && item.debateRound === debateRound
  ));
  const participants: Partial<Record<string, string>> = {};
  (existingRound?.participants ?? []).forEach((participant) => {
    const sessionId = findLatestLoopDebateParticipantSessionId(existingRound?.participants, participant.id);
    if (sessionId) {
      participants[participant.id] = sessionId;
    }
  });
  return {
    participants,
    moderator: findLatestLoopDebateModeratorSessionId(existingRound?.moderatorDecisions)
      ?? normalizeLoopDebateSessionId(existingRound?.participantRosterSessionId),
  };
}

function resolveExistingLoopDebateParticipantRecords(
  task: LoopTaskRecord,
  round: number,
  debateRound: number,
  paths: LoopDebatePaths,
  model: string | undefined,
  sessionState?: LoopDebateSessionState,
): LoopDebateParticipantRecord[] {
  const existingRound = task.debateRounds?.find((item) => (
    item.loopRound === round
    && item.debateRound === debateRound
  ));
  const existingParticipants = existingRound?.participants?.filter((participant) => (
    typeof participant.id === "string"
    && Boolean(participant.id.trim())
    && typeof participant.title === "string"
    && Boolean(participant.title.trim())
  )) ?? [];
  if (existingParticipants.length === 0) {
    return [];
  }
  return existingParticipants.map((participant) => ({
    ...participant,
    model: participant.model ?? model ?? null,
    artifactFile: participant.artifactFile || buildLoopDebateParticipantArtifactFile(paths, participant.id),
    sessionId: sessionState?.participants[participant.id] ?? participant.sessionId ?? null,
    updatedAt: typeof participant.updatedAt === "number" ? participant.updatedAt : Date.now(),
  }));
}

function evaluateReusableLoopDebateDecision(
  task: LoopTaskRecord,
  round: number,
  debateRound: number,
  paths: LoopDebatePaths,
  participantRecords: LoopDebateParticipantRecord[],
): LoopDebateReusableDecisionResult {
  const decisionText = readTextFileIfNonEmpty(paths.decisionFile);
  if (!decisionText) {
    return { status: "rerun", reasons: [] };
  }
  const chatText = readTextFileIfNonEmpty(paths.chatFile);
  if (!chatText || !isCompleteLoopDebateChatTranscript(chatText)) {
    return { status: "rerun", reasons: [`已有 decision.json，但缺少完整群聊记录 chat.md，将重跑辩论：${paths.chatFile}`] };
  }
  const crossReviewText = readTextFileIfNonEmpty(paths.crossReviewFile);
  if (!crossReviewText) {
    return { status: "rerun", reasons: [`已有 decision.json，但缺少 cross-review.md 或文件为空：${paths.crossReviewFile}`] };
  }
  const consensusText = readTextFileIfNonEmpty(paths.consensusFile);
  if (!consensusText) {
    return { status: "rerun", reasons: [`已有 decision.json，但缺少 consensus.md：${paths.consensusFile}`] };
  }
  if (participantRecords.length === 0) {
    return { status: "rerun", reasons: [`已有 decision.json，但缺少裁判主持人红蓝参与者清单：${paths.participantRosterFile}`] };
  }
  const participantValidation = validateLoopDebateParticipantArtifacts(
    paths,
    participantRecords,
    participantRecords[0]?.model ?? undefined
  );
  if (!participantValidation.valid) {
    return { status: "rerun", reasons: participantValidation.reasons };
  }
  const decision = parseLoopMainDecision(decisionText);
  if (!decision) {
    return { status: "rerun", reasons: [`已有 decision.json 非法，将重跑辩论：${paths.decisionFile}`] };
  }

  const fileConsensus = readLoopDebateConsensusRecord(paths.consensusFile, participantValidation.participants, decision);
  if (!fileConsensus) {
    return { status: "rerun", reasons: [`已有 decision.json，但 consensus.md 不含合法共识 JSON：${paths.consensusFile}`] };
  }
  const consensus = mergeLoopDebateConsensusWithParticipantArtifacts(fileConsensus, participantValidation.participants, decision);
  const consensusValidation = validateLoopDebateConsensus(consensus);
  if (!consensusValidation.canProceed) {
    return {
      status: "needs-review",
      reasons: consensusValidation.reasons,
      consensus,
      participants: participantValidation.participants,
    };
  }
  return {
    status: "reusable",
    decision,
    consensus,
    participants: participantValidation.participants,
  };
}

function validateLoopDebateParticipantArtifacts(
  paths: LoopDebatePaths,
  participantRecords: readonly LoopDebateParticipantRecord[],
  model: string | null | undefined,
  sessionState?: LoopDebateSessionState,
): LoopDebateParticipantArtifactValidation {
  const participants = participantRecords.map((participant) => (
    {
      ...readLoopDebateParticipantArtifact(paths, {
        id: participant.id,
        role: participant.role,
        title: participant.title,
        focus: participant.summary ?? participant.title,
      }, model ?? undefined),
      sessionId: sessionState?.participants[participant.id] ?? participant.sessionId ?? null,
    }
  ));
  const reasons: string[] = [];
  participants.forEach((participant) => {
    if (participant.status !== "completed") {
      reasons.push(`参与者 ${participant.id} artifact 缺失或为空：${participant.artifactFile}`);
    }
    if (!participant.stance) {
      reasons.push(`参与者 ${participant.id} 未提供可解析立场（agree / agree_with_reservations / block）。`);
    }
  });
  return {
    valid: reasons.length === 0,
    participants,
    reasons,
  };
}

function readLoopDebateParticipantArtifact(
  paths: LoopDebatePaths,
  participant: LoopDebateParticipantDefinition,
  model: string | undefined,
): LoopDebateParticipantRecord {
  const artifactFile = buildLoopDebateParticipantArtifactFile(paths, participant.id);
  const content = readTextFileIfNonEmpty(artifactFile);
  const stance = content ? extractLoopDebateParticipantStance(content) : null;
  const status: LoopDebateParticipantRecord["status"] = content && stance ? "completed" : "error";
  return {
    id: participant.id,
    role: participant.role,
    title: participant.title,
    model: model ?? null,
    status,
    artifactFile,
    summary: content ? summarizeLoopDebateArtifact(content) : undefined,
    stance: stance ?? undefined,
    blockingIssues: content ? extractLoopDebateBlockingIssues(content, stance ?? undefined) : undefined,
    updatedAt: Date.now(),
  };
}

function readLoopDebateParticipantTurnArtifact(
  participant: LoopDebateParticipantDefinition,
  artifactFile: string,
  model: string | undefined,
): LoopDebateParticipantRecord {
  const content = readTextFileIfNonEmpty(artifactFile);
  return {
    id: participant.id,
    role: participant.role,
    title: participant.title,
    model: model ?? null,
    status: content ? "completed" : "error",
    artifactFile,
    summary: content ? summarizeLoopDebateArtifact(content) : undefined,
    updatedAt: Date.now(),
  };
}

function readLoopDebateParticipantRosterArtifact(
  artifactFile: string,
): { valid: true; participants: LoopDebateParticipantDefinition[]; summary: string; openingSpeakerIds: string[] } | { valid: false; reasons: string[] } {
  const content = readTextFileIfNonEmpty(artifactFile);
  if (!content) {
    return { valid: false, reasons: [`裁判主持人红蓝参与者清单 artifact 缺失或为空：${artifactFile}`] };
  }
  const jsonText = extractJsonObjectText(content);
  if (!jsonText) {
    return { valid: false, reasons: [`裁判主持人红蓝参与者清单缺少 JSON 对象：${artifactFile}`] };
  }
  try {
    const parsed = JSON.parse(jsonText);
    return normalizeLoopDebateParticipantRosterObject(parsed, artifactFile);
  } catch (error) {
    return { valid: false, reasons: [`裁判主持人红蓝参与者清单 JSON 无法解析：${errorToMessage(error)}`] };
  }
}

function normalizeLoopDebateParticipantRosterObject(
  value: unknown,
  artifactFile: string,
): { valid: true; participants: LoopDebateParticipantDefinition[]; summary: string; openingSpeakerIds: string[] } | { valid: false; reasons: string[] } {
  const reasons: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reasons: ["裁判主持人红蓝参与者清单必须是 JSON 对象。"] };
  }
  const raw = value as {
    artifactFile?: unknown;
    summary?: unknown;
    participants?: unknown;
    openingSpeakerIds?: unknown;
    initialSpeakerIds?: unknown;
  };
  if (typeof raw.artifactFile !== "string" || !raw.artifactFile.trim()) {
    reasons.push("裁判主持人红蓝参与者清单 JSON 必须包含 artifactFile。");
  }
  if (typeof raw.artifactFile === "string" && raw.artifactFile.trim() && raw.artifactFile.trim() !== artifactFile) {
    reasons.push(`裁判主持人红蓝参与者清单 artifactFile 与实际文件不一致：${raw.artifactFile}`);
  }
  const summary = typeof raw.summary === "string" && raw.summary.trim()
    ? raw.summary.trim()
    : "";
  if (!summary) {
    reasons.push("裁判主持人红蓝参与者清单 JSON 必须包含非空 summary。");
  }
  if (!Array.isArray(raw.participants)) {
    reasons.push("裁判主持人红蓝参与者清单 JSON 必须包含 participants 数组。");
    return { valid: false, reasons };
  }
  if (raw.participants.length < LOOP_DEBATE_MIN_PARTICIPANTS || raw.participants.length > LOOP_DEBATE_MAX_PARTICIPANTS) {
    reasons.push(`裁判主持人红蓝参与者数量必须在 ${LOOP_DEBATE_MIN_PARTICIPANTS}-${LOOP_DEBATE_MAX_PARTICIPANTS} 个之间。`);
  }

  const ids = new Set<string>();
  const participants = raw.participants
    .map((item, index): LoopDebateParticipantDefinition | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        reasons.push(`第 ${index + 1} 个参与者必须是对象。`);
        return null;
      }
      const participant = item as {
        id?: unknown;
        role?: unknown;
        title?: unknown;
        focus?: unknown;
      };
      const id = typeof participant.id === "string" ? participant.id.trim() : "";
      const title = typeof participant.title === "string" ? participant.title.trim() : "";
      const focus = typeof participant.focus === "string" ? participant.focus.trim() : "";
      const role = normalizeLoopDebateParticipantRole(participant.role);
      if (!id || !/^[a-z0-9][a-z0-9_.-]{1,48}$/u.test(id)) {
        reasons.push(`第 ${index + 1} 个参与者 id 非法：${id || "<empty>"}`);
      }
      if (id === LOOP_DEBATE_MODERATOR_ID || id === "consensus") {
        reasons.push(`参与者 id 不能使用保留值：${id}`);
      }
      if (id && ids.has(id)) {
        reasons.push(`参与者 id 重复：${id}`);
      }
      if (id) {
        ids.add(id);
      }
      if (!role) {
        reasons.push(`参与者 ${id || index + 1} role 非法。`);
      } else if (!isLoopDebateAdversarialParticipantRole(role)) {
        reasons.push(`参与者 ${id || index + 1} role 必须是 ${LOOP_DEBATE_BLUE_TEAM_ROLE} 或 ${LOOP_DEBATE_RED_TEAM_ROLE}；${role} 仅用于兼容旧任务记录，不允许新辩论清单使用。`);
      }
      if (!title) {
        reasons.push(`参与者 ${id || index + 1} title 不能为空。`);
      }
      if (!focus) {
        reasons.push(`参与者 ${id || index + 1} focus 不能为空。`);
      }
      if (!id || !role || !title || !focus) {
        return null;
      }
      return { id, role, title, focus };
    })
    .filter((participant): participant is LoopDebateParticipantDefinition => Boolean(participant));

  if (participants.length < LOOP_DEBATE_MIN_PARTICIPANTS) {
    reasons.push(`可用参与者不足 ${LOOP_DEBATE_MIN_PARTICIPANTS} 个。`);
  }
  const hasBlueTeam = participants.some((participant) => participant.role === LOOP_DEBATE_BLUE_TEAM_ROLE);
  const hasRedTeam = participants.some((participant) => participant.role === LOOP_DEBATE_RED_TEAM_ROLE);
  if (!hasBlueTeam) {
    reasons.push(`裁判主持人红蓝参与者清单必须至少包含 1 个蓝队参与者（role=${LOOP_DEBATE_BLUE_TEAM_ROLE}）。`);
  }
  if (!hasRedTeam) {
    reasons.push(`裁判主持人红蓝参与者清单必须至少包含 1 个红队参与者（role=${LOOP_DEBATE_RED_TEAM_ROLE}）。`);
  }
  if (reasons.length > 0) {
    return { valid: false, reasons };
  }
  const openingSpeakerIds = normalizeLoopDebateSpeakerIds(
    Array.isArray(raw.openingSpeakerIds) ? raw.openingSpeakerIds : raw.initialSpeakerIds,
    participants.map((participant) => participant.id),
    LOOP_DEBATE_MAX_BATCH_SPEAKERS,
  );
  return {
    valid: true,
    participants,
    summary,
    openingSpeakerIds: openingSpeakerIds.length > 0
      ? openingSpeakerIds
      : selectDefaultLoopDebateOpeningSpeakerIds(participants),
  };
}

function normalizeLoopDebateParticipantRole(value: unknown): LoopDebateParticipantRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return LOOP_DEBATE_PARTICIPANT_ROLES.some((role) => role === normalized)
    ? normalized as LoopDebateParticipantRole
    : null;
}

function readLoopDebateModeratorDecisionArtifact(
  artifactFile: string,
  dialogueTurn: number,
  allowedSpeakerIds: readonly string[] = [],
): LoopDebateModeratorDecisionRecord | null {
  const content = readTextFileIfNonEmpty(artifactFile);
  if (!content) {
    return null;
  }
  const jsonText = extractJsonObjectText(content);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      const decision = normalizeLoopDebateModeratorDecisionObject(parsed, artifactFile, dialogueTurn, allowedSpeakerIds);
      if (decision) {
        if (decision.action === "continue" && decision.nextSpeakerIds.length === 0) {
          return null;
        }
        return decision;
      }
    } catch {
      // Fall back to markdown parsing below.
    }
  }

  const decisionSection = extractMarkdownSection(content, "主持人决策") ?? content.slice(0, 1600);
  const action = extractLoopDebateModeratorAction(decisionSection);
  if (!action) {
    return null;
  }
  const reason = extractMarkdownSection(content, "理由")
    ?? extractMarkdownSection(content, "主持人理由")
    ?? extractMarkdownSection(content, "收束或继续理由")
    ?? summarizeLoopDebateArtifact(content);
  return {
    artifactFile,
    dialogueTurn,
    action,
    reason: reason.trim() || "裁判主持人未提供理由。",
    nextSpeakerIds: extractLoopDebateModeratorNextSpeakerIds(content, allowedSpeakerIds),
    nextFocus: extractLoopDebateModeratorNextFocus(content),
    updatedAt: Date.now(),
  };
}

function normalizeLoopDebateModeratorDecisionObject(
  value: unknown,
  artifactFile: string,
  dialogueTurn: number,
  allowedSpeakerIds: readonly string[] = [],
): LoopDebateModeratorDecisionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as {
    artifactFile?: unknown;
    dialogueTurn?: unknown;
    action?: unknown;
    reason?: unknown;
    nextFocus?: unknown;
    nextFocusQuestions?: unknown;
  };
  const action = extractLoopDebateModeratorAction(raw.action);
  if (!action) {
    return null;
  }
  const reason = typeof raw.reason === "string" && raw.reason.trim()
    ? raw.reason.trim()
    : "裁判主持人未提供理由。";
  const nextFocusValue = Array.isArray(raw.nextFocus) ? raw.nextFocus : raw.nextFocusQuestions;
  const nextFocus = Array.isArray(nextFocusValue)
    ? nextFocusValue
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim())
      .slice(0, 8)
    : [];
  const nextSpeakerIds = normalizeLoopDebateSpeakerIds(
    (value as { nextSpeakerIds?: unknown; nextSpeakers?: unknown; nextParticipants?: unknown }).nextSpeakerIds
      ?? (value as { nextSpeakers?: unknown }).nextSpeakers
      ?? (value as { nextParticipants?: unknown }).nextParticipants,
    allowedSpeakerIds,
    LOOP_DEBATE_MAX_BATCH_SPEAKERS,
  );
  return {
    artifactFile: typeof raw.artifactFile === "string" && raw.artifactFile.trim()
      ? raw.artifactFile.trim()
      : artifactFile,
    dialogueTurn: typeof raw.dialogueTurn === "number" && Number.isFinite(raw.dialogueTurn)
      ? Math.max(1, Math.trunc(raw.dialogueTurn))
      : dialogueTurn,
    action,
    reason,
    nextSpeakerIds,
    nextFocus,
    updatedAt: Date.now(),
  };
}

function extractLoopDebateModeratorAction(value: unknown): LoopDebateModeratorDecisionRecord["action"] | null {
  if (typeof value !== "string") {
    return null;
  }
  const explicit = value.match(/\b(continue|finalize|block)\b/i)?.[1];
  if (explicit) {
    return normalizeLoopDebateModeratorAction(explicit);
  }
  if (/阻塞|人工复核|无法继续|不能继续/u.test(value)) {
    return "block";
  }
  if (/收束|最终立场|进入共识|汇总|结束辩论/u.test(value)) {
    return "finalize";
  }
  if (/继续|下一轮|追问|再讨论/u.test(value)) {
    return "continue";
  }
  return null;
}

function extractLoopDebateModeratorNextFocus(content: string): string[] {
  const section = extractMarkdownSection(content, "下一轮关注点")
    ?? extractMarkdownSection(content, "继续关注点")
    ?? "";
  return section
    .split(/\r?\n/g)
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function extractLoopDebateModeratorNextSpeakerIds(
  content: string,
  allowedSpeakerIds: readonly string[],
): string[] {
  const section = extractMarkdownSection(content, "下一批发言者")
    ?? extractMarkdownSection(content, "下一轮发言者")
    ?? "";
  if (!section) {
    return [];
  }
  const items = section
    .split(/\r?\n/g)
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/[，,、；;]/g).map((item) => item.trim()).filter(Boolean));
  return normalizeLoopDebateSpeakerIds(items, allowedSpeakerIds, LOOP_DEBATE_MAX_BATCH_SPEAKERS);
}

function extractLoopDebateParticipantStance(content: string): LoopDebateParticipantStance | null {
  const stanceSection = extractMarkdownSection(content, "立场") ?? content.slice(0, 1200);
  const explicit = stanceSection.match(/\b(agree_with_reservations|agree|block)\b/i)?.[1];
  if (explicit) {
    return normalizeLoopDebateParticipantStance(explicit);
  }
  if (/阻塞|不同意|不能继续/u.test(stanceSection)) {
    return "block";
  }
  if (/保留|风险|reservation/i.test(stanceSection)) {
    return "agree_with_reservations";
  }
  if (/同意|通过|agree/i.test(stanceSection)) {
    return "agree";
  }
  return null;
}

function extractLoopDebateBlockingIssues(
  content: string,
  stance: LoopDebateParticipantStance | undefined,
): string[] | undefined {
  const section = extractMarkdownSection(content, "阻塞性异议");
  if (!section) {
    return stance === "block" ? ["参与者声明 block，但未写明阻塞性异议。"] : undefined;
  }
  const normalized = section.trim();
  if (!normalized || /^无(?:。|$)/u.test(normalized) || /^none$/i.test(normalized)) {
    return stance === "block" ? ["参与者声明 block，但阻塞性异议小节为空。"] : undefined;
  }
  const issues = normalized
    .split(/\r?\n/g)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  return issues.length > 0 ? issues : undefined;
}

function extractMarkdownSection(content: string, title: string): string | null {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)##\\s*${escapedTitle}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "u");
  const match = content.match(pattern);
  return match?.[1]?.trim() || null;
}

function summarizeLoopDebateArtifact(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ");
  return normalized.length > LOOP_DEBATE_ARTIFACT_SUMMARY_LIMIT
    ? `${normalized.slice(0, LOOP_DEBATE_ARTIFACT_SUMMARY_LIMIT)}...`
    : normalized;
}

function isCompleteLoopDebateChatTranscript(content: string): boolean {
  return /##\s*群聊收束/u.test(content)
    && /##\s*参与者加入：/u.test(content)
    && /(?:【裁判主持人】|裁判主持人|主持人)最终动作：(?:continue|finalize|block)/u.test(content)
    && /##\s*(?:第\s+\d+\s+轮)?主持人控场/u.test(content);
}

function readLoopDebateConsensusRecord(
  consensusFile: string,
  participants: LoopDebateParticipantRecord[],
  decision: LoopMainDecision,
): LoopDebateConsensusRecord<LoopMainDecision> | null {
  const content = readTextFileIfNonEmpty(consensusFile);
  if (!content) {
    return null;
  }
  const jsonText = extractJsonObjectText(content);
  if (!jsonText) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonText);
    return normalizeLoopDebateConsensusRecord(parsed, consensusFile, participants, decision);
  } catch {
    return null;
  }
}

function normalizeLoopDebateConsensusRecord(
  value: unknown,
  artifactFile: string,
  participants: LoopDebateParticipantRecord[],
  decision: LoopMainDecision,
): LoopDebateConsensusRecord<LoopMainDecision> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as {
    artifactFile?: unknown;
    reached?: unknown;
    summary?: unknown;
    participantStances?: unknown;
    resolvedDisagreements?: unknown;
    openDisagreements?: unknown;
  };
  const summary = typeof raw.summary === "string" && raw.summary.trim()
    ? raw.summary.trim()
    : "";
  if (
    typeof raw.artifactFile !== "string"
    || !raw.artifactFile.trim()
    || typeof raw.reached !== "boolean"
    || !summary
    || !hasValidLoopDebateConsensusStanceRecords(raw.participantStances)
    || !hasValidLoopDebateDisagreementRecords(raw.resolvedDisagreements)
    || !hasValidLoopDebateDisagreementRecords(raw.openDisagreements)
  ) {
    return null;
  }
  return {
    artifactFile: raw.artifactFile.trim() || artifactFile,
    reached: raw.reached === true,
    summary,
    participantStances: normalizeLoopDebateConsensusStances(raw.participantStances, participants),
    resolvedDisagreements: normalizeLoopDebateDisagreements(raw.resolvedDisagreements),
    openDisagreements: normalizeLoopDebateDisagreements(raw.openDisagreements),
    decision,
  };
}

function hasValidLoopDebateConsensusStanceRecords(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  return value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const raw = item as { participantId?: unknown; stance?: unknown };
    return (
      typeof raw.participantId === "string"
      && Boolean(raw.participantId.trim())
      && Boolean(normalizeLoopDebateParticipantStance(raw.stance))
    );
  });
}

function normalizeLoopDebateConsensusStances(
  value: unknown,
  participants: LoopDebateParticipantRecord[],
): LoopDebateConsensusRecord<LoopMainDecision>["participantStances"] {
  const stances = new Map<string, { participantId: string; stance: LoopDebateParticipantStance; note?: string }>();
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return;
      }
      const raw = item as { participantId?: unknown; stance?: unknown; note?: unknown };
      const participantId = typeof raw.participantId === "string" && raw.participantId.trim()
        ? raw.participantId.trim()
        : "";
      const stance = normalizeLoopDebateParticipantStance(raw.stance);
      if (!participantId || !stance) {
        return;
      }
      stances.set(participantId, {
        participantId,
        stance,
        note: typeof raw.note === "string" ? raw.note : undefined,
      });
    });
  }
  participants.forEach((participant) => {
    if (!participant.stance || stances.has(participant.id)) {
      return;
    }
    stances.set(participant.id, {
      participantId: participant.id,
      stance: participant.stance,
      note: participant.summary,
    });
  });
  return Array.from(stances.values());
}

function hasValidLoopDebateDisagreementRecords(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const raw = item as {
      id?: unknown;
      title?: unknown;
      participants?: unknown;
      severity?: unknown;
      resolution?: unknown;
    };
    return (
      typeof raw.id === "string"
      && Boolean(raw.id.trim())
      && typeof raw.title === "string"
      && Boolean(raw.title.trim())
      && Array.isArray(raw.participants)
      && raw.participants.every((participant) => typeof participant === "string" && Boolean(participant.trim()))
      && (raw.severity === "blocking" || raw.severity === "non_blocking")
      && (raw.resolution === undefined || typeof raw.resolution === "string")
    );
  });
}

function normalizeLoopDebateDisagreements(value: unknown): LoopDebateDisagreementRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index): LoopDebateDisagreementRecord | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const raw = item as {
        id?: unknown;
        title?: unknown;
        participants?: unknown;
        severity?: unknown;
        resolution?: unknown;
      };
      const id = typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : `disagreement-${index + 1}`;
      const title = typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : id;
      const participants = Array.isArray(raw.participants)
        ? raw.participants.filter((participant): participant is string => typeof participant === "string" && Boolean(participant.trim()))
        : [];
      return {
        id,
        title,
        participants,
        severity: raw.severity === "blocking" ? "blocking" : "non_blocking",
        resolution: typeof raw.resolution === "string" ? raw.resolution : undefined,
      };
    })
    .filter((item): item is LoopDebateDisagreementRecord => Boolean(item));
}

function mergeLoopDebateConsensusWithParticipantArtifacts(
  consensus: LoopDebateConsensusRecord<LoopMainDecision>,
  participants: LoopDebateParticipantRecord[],
  decision: LoopMainDecision,
): LoopDebateConsensusRecord<LoopMainDecision> {
  return {
    ...consensus,
    participantStances: normalizeLoopDebateConsensusStances(consensus.participantStances, participants),
    decision,
  };
}

function markLoopDebateNeedsReview(options: {
  task: LoopTaskRecord;
  target: PromptRunTarget;
  round: number;
  debateRound: number;
  paths: LoopDebatePaths;
  participants: LoopDebateParticipantRecord[];
  reasons: string[];
  consensus?: LoopDebateConsensusRecord<LoopMainDecision>;
  status: Exclude<LoopDebateRoundStatus, "running" | "consensus">;
}): LoopMainDecisionRunResult {
  const { task, target, round, debateRound, paths, participants, reasons, consensus, status } = options;
  const latestTask = readLoopTaskRecord(task.id);
  if (latestTask?.status === "stopped") {
    return { status: "interrupted", task: latestTask, runStatus: "stopped" };
  }
  const reviewSummary = buildLoopDebateNeedsReviewSummary({ reasons, consensus });
  const startedAt = getExistingLoopDebateRoundStartedAt(task, round, debateRound) ?? Date.now();
  upsertLoopDebateRoundRecord(task.id, {
    loopRound: round,
    debateRound,
    status,
    startedAt,
    completedAt: Date.now(),
    briefFile: paths.briefFile,
    chatFile: paths.chatFile,
    participantRosterFile: paths.participantRosterFile,
    participants,
    consensus,
  });
  const failedRecord = updateLoopTaskRecord(task.id, {
    status: "needs-review",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: Date.now(),
    finalSummary: reviewSummary.finalSummary,
    ...(typeof reviewSummary.estimatedRemainingRounds === "number"
      ? { estimatedRemainingRounds: reviewSummary.estimatedRemainingRounds }
      : {}),
  }) ?? task;
  refreshOpenLoopGroupChatPanelForTask(task.id);
  appendSystemMessageForLoop(target, buildLoopDebateNeedsReviewText(task.id, round, reviewSummary, paths));
  appendLoopDebateMainCommunicationLog(failedRecord, round, paths, reviewSummary.title, [
    ...reviewSummary.details,
    ...(consensus ? [`consensus.md：${paths.consensusFile}`] : []),
    ...(consensus?.decision ? [`decision.json：${paths.decisionFile}`] : []),
  ]);
  return { status: "needs-review", task: failedRecord };
}

function getExistingLoopDebateRoundStartedAt(
  task: LoopTaskRecord,
  round: number,
  debateRound: number,
): number | null {
  const record = task.debateRounds?.find((item) => item.loopRound === round && item.debateRound === debateRound);
  return typeof record?.startedAt === "number" ? record.startedAt : null;
}

function upsertLoopDebateRoundRecord(
  taskId: string,
  roundRecord: LoopDebateRoundRecord<LoopMainDecision>,
): void {
  const latest = readLoopTaskRecord(taskId);
  if (!latest) {
    return;
  }
  const debateRounds = Array.isArray(latest.debateRounds) ? [...latest.debateRounds] : [];
  const existingIndex = debateRounds.findIndex((item) => (
    item.loopRound === roundRecord.loopRound
    && item.debateRound === roundRecord.debateRound
  ));
	  if (existingIndex >= 0) {
	    debateRounds[existingIndex] = {
	      ...debateRounds[existingIndex],
	      ...roundRecord,
	      participants: roundRecord.participants,
	      participantRosterFile: roundRecord.participantRosterFile ?? debateRounds[existingIndex].participantRosterFile,
	      participantRosterSessionId: roundRecord.participantRosterSessionId ?? debateRounds[existingIndex].participantRosterSessionId,
	      activeSpeaker: roundRecord.activeSpeaker,
	      consensus: roundRecord.consensus,
	    };
  } else {
    debateRounds.push(roundRecord);
  }
  updateLoopTaskRecord(taskId, {
    debateRounds,
    updatedAt: Date.now(),
  });
}

function updateLoopDebateParticipantRecord(
  taskId: string,
  round: number,
  debateRound: number,
  participant: LoopDebateParticipantRecord,
  startedAt: number,
  briefFile: string,
  chatFile: string,
  activeSpeaker?: LoopDebateActiveSpeakerRecord,
): void {
  const latest = readLoopTaskRecord(taskId);
  const existingRound = latest?.debateRounds?.find((item) => item.loopRound === round && item.debateRound === debateRound);
  const participants = existingRound?.participants?.length
    ? [...existingRound.participants]
    : [];
  const index = participants.findIndex((item) => item.id === participant.id);
  if (index >= 0) {
    participants[index] = { ...participants[index], ...participant };
  } else {
    participants.push(participant);
  }
	  upsertLoopDebateRoundRecord(taskId, {
	    loopRound: round,
	    debateRound,
	    status: "running",
    startedAt,
    briefFile,
    chatFile,
    participantRosterFile: existingRound?.participantRosterFile,
    participants,
    activeSpeaker,
  });
}

function updateLoopDebateActiveSpeakerRecord(
  taskId: string,
  round: number,
  debateRound: number,
  startedAt: number,
  paths: LoopDebatePaths,
  activeSpeaker: LoopDebateActiveSpeakerRecord,
): void {
  const latest = readLoopTaskRecord(taskId);
  const existingRound = latest?.debateRounds?.find((item) => item.loopRound === round && item.debateRound === debateRound);
  const participants = existingRound?.participants?.length
    ? [...existingRound.participants]
    : [];
  upsertLoopDebateRoundRecord(taskId, {
    loopRound: round,
    debateRound,
    status: "running",
    startedAt,
    briefFile: paths.briefFile,
    chatFile: paths.chatFile,
    participantRosterFile: paths.participantRosterFile,
    dialogueTurns: existingRound?.dialogueTurns,
    participants,
    moderatorDecisions: existingRound?.moderatorDecisions,
    activeSpeaker,
  });
  refreshOpenLoopGroupChatPanelForTask(taskId);
}

function updateLoopDebateParticipantRosterSessionRecord(
  taskId: string,
  round: number,
  debateRound: number,
  sessionId: string | null,
  startedAt: number,
  paths: LoopDebatePaths,
): void {
  const latest = readLoopTaskRecord(taskId);
  const existingRound = latest?.debateRounds?.find((item) => item.loopRound === round && item.debateRound === debateRound);
  upsertLoopDebateRoundRecord(taskId, {
    loopRound: round,
    debateRound,
    status: "running",
    startedAt,
    briefFile: paths.briefFile,
    chatFile: paths.chatFile,
    participantRosterFile: paths.participantRosterFile,
    participantRosterSessionId: sessionId,
    dialogueTurns: existingRound?.dialogueTurns,
    participants: existingRound?.participants ?? [],
    moderatorDecisions: existingRound?.moderatorDecisions,
    activeSpeaker: existingRound?.activeSpeaker,
  });
}

function updateLoopDebateModeratorDecisionRecord(
  taskId: string,
  round: number,
  debateRound: number,
  decision: LoopDebateModeratorDecisionRecord,
  startedAt: number,
  paths: LoopDebatePaths,
): void {
  const latest = readLoopTaskRecord(taskId);
  const existingRound = latest?.debateRounds?.find((item) => item.loopRound === round && item.debateRound === debateRound);
  const participants = existingRound?.participants?.length
    ? [...existingRound.participants]
    : [];
  const moderatorDecisions = existingRound?.moderatorDecisions?.length
    ? [...existingRound.moderatorDecisions]
    : [];
  const index = moderatorDecisions.findIndex((item) => item.dialogueTurn === decision.dialogueTurn);
  if (index >= 0) {
    moderatorDecisions[index] = decision;
  } else {
    moderatorDecisions.push(decision);
  }
  upsertLoopDebateRoundRecord(taskId, {
    loopRound: round,
    debateRound,
    status: "running",
    startedAt,
    briefFile: paths.briefFile,
    chatFile: paths.chatFile,
    participantRosterFile: paths.participantRosterFile,
    dialogueTurns: decision.dialogueTurn,
    participants,
    moderatorDecisions,
  });
}

function buildLoopDebateSpeakerBatch(participants: readonly LoopDebateParticipantDefinition[], speakerIds: readonly string[]): LoopDebateSpeakerBatch {
  const participantById = new Map(participants.map((participant) => [participant.id, participant] as const));
  const normalizedSpeakerIds = speakerIds
    .filter((speakerId): speakerId is string => typeof speakerId === "string" && Boolean(speakerId.trim()))
    .map((speakerId) => speakerId.trim())
    .filter((speakerId, index, list) => list.indexOf(speakerId) === index)
    .slice(0, LOOP_DEBATE_MAX_BATCH_SPEAKERS)
    .filter((speakerId) => participantById.has(speakerId));
  const speakers = normalizedSpeakerIds
    .map((speakerId) => participantById.get(speakerId))
    .filter((participant): participant is LoopDebateParticipantDefinition => Boolean(participant));
  return {
    speakerIds: normalizedSpeakerIds,
    speakers,
  };
}

function readTextFileIfNonEmpty(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf8").trim();
    return content ? content : null;
  } catch (error) {
    void logError("read-text-file-error", { filePath, error: String(error) });
    return null;
  }
}

function writeTextFileEnsuringDir(filePath: string, content: string): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch (error) {
    void logError("write-text-file-error", { filePath, error: String(error) });
    return false;
  }
}

function appendTextFileEnsuringDir(filePath: string, content: string): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, content, "utf8");
    return true;
  } catch (error) {
    void logError("append-text-file-error", { filePath, error: String(error) });
    return false;
  }
}

async function closeCompletedLoopDebateTabs(tabIds: string[]): Promise<void> {
  for (const tabId of tabIds) {
    if (tabId) {
      await closeConversationTabAndRefreshPanel(tabId);
    }
  }
}

function appendLoopDebateMainCommunicationLog(
  task: LoopTaskRecord,
  round: number,
  paths: LoopDebatePaths,
  title: string,
  details: string[],
): void {
  try {
    fs.mkdirSync(path.dirname(task.mainCommunicationFile), { recursive: true });
    const lines = [
      "",
      `## ${title}`,
      `- 时间：${new Date().toISOString()}`,
      `- 轮次：${round}`,
      `- 辩论目录：${paths.roundDir}`,
      `- 群聊记录：${paths.chatFile}`,
      ...details.map((detail) => `- ${detail}`),
    ];
    fs.appendFileSync(task.mainCommunicationFile, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    void logError("loop-debate-main-communication-write-error", {
      taskId: task.id,
      filePath: task.mainCommunicationFile,
      error: String(error),
    });
  }
}

function appendLoopSupplementalRequirement(
  existing: readonly string[] | undefined,
  nextItem: string,
): string[] {
  const normalizedExisting = Array.isArray(existing)
    ? existing.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return [...normalizedExisting, nextItem];
}

function appendLoopSupplementalRequirementToCommunication(
  task: LoopTaskRecord,
  requirement: string,
): void {
  const body = [
    `- 时间：${new Date().toISOString()}`,
    `- 主任务轮次：${Math.max(1, task.currentRound || 1)}`,
    requirement,
  ].join("\n");
  try {
    fs.mkdirSync(path.dirname(task.mainCommunicationFile), { recursive: true });
    fs.appendFileSync(task.mainCommunicationFile, `\n## 补充需求\n${body}\n`, "utf8");
  } catch (error) {
    void logError("loop-supplemental-requirement-write-error", {
      taskId: task.id,
      filePath: task.mainCommunicationFile,
      error: String(error),
    });
  }
  appendLoopMainSubChatSection(task, "补充需求", body);
}

function appendLoopMainSubChatTaskEvent(task: LoopTaskRecord, body: string): void {
  appendLoopMainSubChatSection(task, "任务事件", body);
}

function formatLoopAutoWakeAtForRecord(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : "未记录";
}

function appendLoopMainSubChatMainDecision(
  task: LoopTaskRecord,
  decision: LoopMainDecision,
  subtasks: LoopSubtaskRecord[] = [],
): void {
  const round = Math.max(1, task.currentRound || 1);
  const bodyLines = [
    `- 时间：${new Date().toISOString()}`,
    `- 决策状态：${decision.status}`,
  ];
  const remainingRounds = formatLoopEstimatedRemainingRounds(decision.estimatedRemainingRounds);
  if (remainingRounds) {
    bodyLines.push(`- 预计剩余轮次：${remainingRounds}`);
  }
  if (decision.status === "sleep") {
    bodyLines.push(`- 自动睡眠原因：${task.autoSleepReason ?? decision.sleepReason ?? "未记录"}`);
    bodyLines.push(`- 计划唤醒时间：${formatLoopAutoWakeAtForRecord(task.autoWakeAt)}`);
    bodyLines.push(`- 唤醒间隔秒数：${decision.wakeAfterSeconds ?? "未记录"}`);
  }
  if (decision.acceptance?.summary) {
    bodyLines.push(`- 复核摘要：${decision.acceptance.summary}`);
  }
  if (decision.parallelReason) {
    bodyLines.push(`- 并发判断：${decision.parallelReason}`);
  }
  if (subtasks.length > 0) {
    bodyLines.push("");
    bodyLines.push("### 派发子任务");
    subtasks.forEach((subtask, index) => {
      bodyLines.push(`- ${getLoopSubtaskDisplayTitle(index, subtask)}（${subtask.id}）：${subtask.status}`);
    });
  }
  if (decision.status === "completed") {
    bodyLines.push("");
    bodyLines.push("### 问题回答结论");
    bodyLines.push(resolveLoopAnswerConclusion(task, decision));
  }
  if (decision.finalSummary) {
    bodyLines.push("");
    bodyLines.push("### 总结");
    bodyLines.push(decision.finalSummary);
  }
  bodyLines.unshift(`- 成员 ID：main`);
  const mainTitle = getLoopMainSubChatMainTitle(task);
  appendLoopMainSubChatSection(
    task,
    `主任务发言：第 ${round} 轮${formatLoopGroupChatMemberName(mainTitle)}`,
    bodyLines.join("\n"),
  );
  if (decision.status === "completed") {
    appendLoopMainSubChatSection(task, "群聊收束", buildLoopCompletedConclusionAndSummaryMarkdown(task, decision));
  }
}

function appendLoopMainSubChatSubtaskStarted(
  task: LoopTaskRecord,
  subtask: LoopSubtaskRecord,
  round: number,
  communicationFile: string,
  retryCount: number,
): void {
  const latest = readLoopTaskRecord(task.id) ?? task;
  const index = latest.subTasks.findIndex((item) => item.id === subtask.id);
  const title = getLoopSubtaskDisplayTitle(index, subtask);
  const retryLine = retryCount > 0 ? `- 重试：第 ${retryCount} 次` : null;
  appendLoopMainSubChatSection(latest, `子任务加入：${formatLoopGroupChatMemberName(title)}`, [
    `- 成员 ID：${subtask.id}`,
    `- 时间：${new Date().toISOString()}`,
    `- 轮次：${round}`,
    retryLine,
    `- 状态：running`,
    `- 沟通文件：${communicationFile}`,
  ].filter((line): line is string => Boolean(line)).join("\n"));
}

function appendLoopMainSubChatSubtaskFinished(
  task: LoopTaskRecord,
  subtask: LoopSubtaskRecord,
  runStatus: TaskRunStatus,
  assistantContent?: string | null,
): void {
  const latest = readLoopTaskRecord(task.id) ?? task;
  const index = latest.subTasks.findIndex((item) => item.id === subtask.id);
  const latestSubtask = latest.subTasks[index] ?? subtask;
  const title = getLoopSubtaskDisplayTitle(index, latestSubtask);
  appendLoopMainSubChatSection(
    latest,
    `子任务发言：${formatLoopGroupChatMemberName(title)}`,
    [
      `- 成员 ID：${latestSubtask.id}`,
      "",
      buildLoopMainSubSubtaskTurnBody({
        runStatus,
        assistantContent,
        communicationFile: latestSubtask.communicationFile,
      }),
    ].join("\n"),
  );
}

function appendLoopMainSubChatSection(
  task: LoopTaskRecord,
  heading: string,
  body: string,
): void {
  const chatFile = ensureLoopMainSubChatTranscript(task);
  appendTextFileEnsuringDir(chatFile, `\n## ${heading}\n${body.trim()}\n`);
  refreshOpenLoopGroupChatPanelForTask(task.id);
}

type LoopSubtaskRetryOptions = {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LoopTaskRecord;
  round: number;
  subtask: LoopSubtaskRecord;
  switchVisible?: boolean;
};

type LoopSubtaskBatchOptions = {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LoopTaskRecord;
  round: number;
  subtasks: LoopSubtaskRecord[];
};

type LoopSubtaskRunResult = {
  subtask: LoopSubtaskRecord;
  status: TaskRunStatus;
};

type LoopMainDecisionRunResult =
  | { status: "interrupted"; task: LoopTaskRecord; runStatus: "error" | "stopped" }
  | { status: "needs-review"; task: LoopTaskRecord; decision?: LoopMainDecision | null }
  | { status: "completed"; task: LoopTaskRecord; decision: LoopMainDecision }
  | { status: "sleeping"; task: LoopTaskRecord; decision: LoopMainDecision }
  | { status: "continue"; task: LoopTaskRecord; decision: LoopMainDecision; subtasks: LoopSubtaskRecord[] };

async function runLoopSubtasksBatchWithRetry(
  options: LoopSubtaskBatchOptions
): Promise<LoopSubtaskRunResult[]> {
  const { input, target, task, round, subtasks } = options;
  if (subtasks.length <= 1) {
    const subtask = subtasks[0];
    if (!subtask) {
      return [];
    }
    const status = await runLoopSubtaskWithRetry({
      input,
      target,
      task,
      round,
      subtask,
      switchVisible: true,
    });
    return [{ subtask, status }];
  }

  const executionPlan = buildLoopSubtaskExecutionPlan(subtasks);
  appendSystemMessageForLoop(target, buildLoopSubtaskBatchStartedText(task.id, round, subtasks, executionPlan));
  const results: LoopSubtaskRunResult[] = [];

  for (let groupIndex = 0; groupIndex < executionPlan.groups.length; groupIndex += 1) {
    const group = executionPlan.groups[groupIndex] ?? [];
    if (group.length === 0) {
      continue;
    }
    if (executionPlan.groups.length > 1) {
      appendSystemMessageForLoop(
        target,
        buildLoopSubtaskExecutionGroupStartedText(task.id, round, groupIndex, executionPlan.groups.length, group)
      );
    }

    const groupResults = await Promise.all(group.map(async (subtask): Promise<LoopSubtaskRunResult> => {
      try {
        const status = await runLoopSubtaskWithRetry({
          input,
          target,
          task,
          round,
          subtask,
          switchVisible: false,
        });
        return { subtask, status };
      } catch (error) {
        void logError("loop-subtask-batch-run-error", {
          taskId: task.id,
          round,
          subtaskId: subtask.id,
          error: error instanceof Error ? error.message : String(error),
        });
        markLoopSubtaskRunFinished(task.id, subtask.id, "error", null);
        return { subtask, status: "error" };
      }
    }));

    results.push(...groupResults);
    if (groupResults.some((result) => result.status === "error" || result.status === "stopped")) {
      await switchVisibleConversationTabForLoop(target.tabId);
      return results;
    }
  }

  await switchVisibleConversationTabForLoop(target.tabId);
  if (results.every((result) => result.status === "end")) {
    updateLoopTaskRecord(task.id, {
      activeSubtaskId: null,
      activeSubtaskIds: [],
      updatedAt: Date.now(),
    });
    refreshOpenLoopGroupChatPanelForTask(task.id);
    appendSystemMessageForLoop(target, buildLoopSubtaskBatchCompletedText(task.id, round, subtasks));
    const latest = readLoopTaskRecord(task.id) ?? task;
    appendLoopMainSubChatTaskEvent(
      latest,
      [
        `- 时间：${new Date().toISOString()}`,
        `- 轮次：${round}`,
        `- 子任务批次已全部完成：${subtasks.length} 个`,
        `- 子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
      ].join("\n"),
    );
  }
  return results;
}

async function runLoopSubtaskWithRetry(options: LoopSubtaskRetryOptions): Promise<TaskRunStatus> {
  const { input, target, task, round, subtask } = options;
  const shouldSwitchVisible = options.switchVisible !== false;
  const mainTabId = target.tabId;
  const progressId = `${task.id}:${round}:${subtask.id}`;
  let currentSubtaskTarget: PromptRunTarget | null = null;
  let terminalProgressStatus: "completed" | "failed" | "interrupted" | null = null;
  let parentProgress: SubagentProgressController | null = null;

  const persistParentProgressMessage = (message: ChatMessage): void => {
    const messages = getLoopMessagesForTarget(target);
    const index = messages.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      messages[index] = message;
    } else {
      appendMessageToStore(messages, message);
    }
    persistLoopMessagesForTarget(target, messages);
  };

  parentProgress = createSubagentProgressController({
    labels: buildSubagentProgressLabels(),
    createMessageId,
    messageMetadata: {
      taskRole: "main",
      loopTaskId: task.id,
      loopRound: round,
      loopSubtaskId: subtask.id,
    },
    appendMessage: (message) => {
      persistParentProgressMessage(message);
      sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
    },
    replaceMessage: (message) => {
      persistParentProgressMessage(message);
      sendPanelMessage({ type: "replaceMessage", message, tabId: target.tabId });
    },
    appendDelta: (messageId, content) => {
      const message = parentProgress?.getMessage("loop", progressId);
      if (message) {
        persistParentProgressMessage(message);
      }
      sendPanelMessage({
        type: "assistantDelta",
        id: messageId,
        content,
        tabId: target.tabId,
      });
    },
  });

  const progressMonitor = createLoopSubtaskProgressMonitor({
    taskId: task.id,
    round,
    subtaskId: subtask.id,
    subtaskTitle: subtask.title,
    waitingText: t("run.loopSubtaskWaiting"),
    readMessages: () => currentSubtaskTarget
      ? getLoopMessagesForTarget(currentSubtaskTarget)
      : [],
    onUpdate: (update) => parentProgress?.update(update),
  });
  progressMonitor.start();

  let retryCount = 0;
  try {
    while (true) {
      if (isLoopTaskExecutionInterrupted(task.id)) {
        terminalProgressStatus = "interrupted";
        return "stopped";
      }
      const communicationFile = prepareLoopSubtaskCommunicationFile(task, subtask, round, retryCount);
      const subtaskTarget = createLoopSubtaskRunTarget(target.cli);
      currentSubtaskTarget = subtaskTarget;
      appendSystemMessageForLoop(
        target,
        buildLoopSubtaskStartedText(task.id, subtask, round, communicationFile, retryCount)
      );
      appendSystemMessageForLoop(
        subtaskTarget,
        buildLoopSubtaskStartedText(task.id, subtask, round, communicationFile, retryCount)
      );
      appendLoopMainSubChatSubtaskStarted(task, subtask, round, communicationFile, retryCount);
      if (shouldSwitchVisible) {
        await switchVisibleConversationTabForLoop(subtaskTarget.tabId);
      }

      let status: TaskRunStatus = "error";
      try {
        status = await runLoopRound({
          input,
          target: subtaskTarget,
          task,
          round,
          role: "subtask",
          subtaskId: subtask.id,
          displayPrompt: buildLoopSubtaskDisplayPrompt(round, subtask, retryCount),
          modelPrompt: buildLoopSubtaskModelPrompt(
            input.modelPrompt || input.displayPrompt,
            task,
            round,
            subtask,
            retryCount,
            communicationFile
          ),
        });
      } catch (error) {
        status = "error";
        void logError("loop-subtask-run-error", {
          taskId: task.id,
          round,
          subtaskId: subtask.id,
          retryCount,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        progressMonitor.sync();
        if (shouldSwitchVisible) {
          await switchVisibleConversationTabForLoop(mainTabId);
        }
      }

      if (status !== "error") {
        const summary = getLastLoopAssistantContent(subtaskTarget, task.id, round, "subtask");
        await finalizeLoopSubtaskRun({
          taskId: task.id,
          round,
          subtaskId: subtask.id,
          runStatus: status,
          assistantContent: summary,
          tabId: subtaskTarget.tabId,
        });
        terminalProgressStatus = mapLoopRunStatusToSubagentStatus(status);
        return status;
      }
      if (retryCount >= LOOP_SUBTASK_RETRY_MAX_RETRIES) {
        const summary = getLastLoopAssistantContent(subtaskTarget, task.id, round, "subtask");
        await finalizeLoopSubtaskRun({
          taskId: task.id,
          round,
          subtaskId: subtask.id,
          runStatus: status,
          assistantContent: summary,
          tabId: subtaskTarget.tabId,
        });
        terminalProgressStatus = mapLoopRunStatusToSubagentStatus(status);
        return status;
      }

      retryCount += 1;
      appendSystemMessageForLoop(
        target,
        buildLoopSubtaskRetryText(task.id, subtask.id, retryCount)
      );
      await waitForLoopSubtaskRetryDelay();
    }
  } finally {
    progressMonitor.finish(terminalProgressStatus ?? "interrupted");
  }
}

async function waitForLoopSubtaskRetryDelay(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, LOOP_SUBTASK_RETRY_DELAY_MS));
}

type LoopRoundRunOptions = {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LoopTaskRecord;
  round: number;
  role: LoopTaskRole;
  displayPrompt: string;
  modelPrompt: string;
  subtaskId?: string;
};

async function runLoopRound(options: LoopRoundRunOptions): Promise<TaskRunStatus> {
  const { input, target, task, round, role, displayPrompt, modelPrompt, subtaskId } = options;
  if (isLoopTaskExecutionInterrupted(task.id)) {
    return "stopped";
  }
  const roundStartedAt = Date.now();
  const activeSubtaskPatch = role === "main"
    ? { activeSubtaskId: null, activeSubtaskIds: [] }
    : buildLoopActiveSubtaskPatch(task.id, subtaskId);
  updateLoopTaskRecord(task.id, {
    status: "running",
    currentRound: round,
    ...activeSubtaskPatch,
    updatedAt: roundStartedAt,
  });
  refreshOpenLoopGroupChatPanelForTask(task.id);

  const roleModel = resolvePromptRunModelForRole(input, role);
  const thinkingModeOverride = resolvePromptRunThinkingModeForRole(input, target.cli, role, roleModel, {
    applySubtaskCap: true,
  });
  await runPrompt({
    ...input,
    displayPrompt,
    modelPrompt,
    model: roleModel,
    taskRole: role,
    loopTaskId: task.id,
    loopRound: round,
    loopSubtaskId: subtaskId,
    thinkingModeOverride,
  }, { targetTabId: target.tabId });

  if (role === "main") {
    const mainSessionId = resolveLoopTaskSessionId(target);
    if (mainSessionId) {
      bindLoopTaskToSession(task.id, mainSessionId);
    }
  }

  const roundEndedAt = Date.now();
  const roundStatus = getLoopRoundRunStatus(task.id, round, role, subtaskId) ?? "end";
  appendLoopRound(task.id, {
    round,
    role,
    subtaskId,
    status: roundStatus,
    startedAt: roundStartedAt,
    endedAt: roundEndedAt,
    summary: buildLoopRoundSummary(round, role, subtaskId),
  });
  return roundStatus;
}

function buildLoopActiveSubtaskPatch(
  taskId: string,
  subtaskId?: string,
): { activeSubtaskId?: string | null; activeSubtaskIds?: string[] } {
  if (!subtaskId) {
    return {};
  }
  const latest = readLoopTaskRecord(taskId);
  const activeSubtaskIds = latest ? getActiveLoopSubtaskIds(latest) : [];
  if (!activeSubtaskIds.includes(subtaskId)) {
    activeSubtaskIds.push(subtaskId);
  }
  return {
    activeSubtaskId: activeSubtaskIds[0] ?? subtaskId,
    activeSubtaskIds,
  };
}

function buildLoopMainDisplayPrompt(rootPrompt: string, round: number): string {
  if (round === 1) {
    return [
      rootPrompt,
      "",
      "Loop 主任务：请拆分目标，优先并发派发互不冲突的子任务，返回 JSON 决策，由程序启动子任务。",
    ].join("\n");
  }
  return [
    `Loop 主任务第 ${round} 轮复核。`,
    "上一批子任务已结束（可能成功或中断），请读取任务记录判断整体是否完成；未完成则返回下一批子任务 JSON。",
    "本轮必须预判 estimatedRemainingRounds，说明当前决策之后预计还剩多少轮。",
  ].join("\n");
}

function buildLoopModeratorMainDisplayPrompt(rootPrompt: string, round: number): string {
  if (round === 1) {
    return [
      rootPrompt,
      "",
      "Loop 主持人主智能体：红蓝规划共识已形成，请基于共识进入主从多智能体执行，不再重复红蓝辩论。",
    ].join("\n");
  }
  return [
    `Loop 主持人主智能体第 ${round} 轮复核。`,
    "上一批子任务已结束，请读取首轮红蓝规划共识、任务记录和主从沟通文件；后续实现阶段使用主从多智能体模式继续派发或验收。",
    "本轮必须预判 estimatedRemainingRounds，说明当前决策之后预计还剩多少轮。",
  ].join("\n");
}

function buildLoopSubtaskDisplayPrompt(round: number, subtask: LoopSubtaskRecord, retryCount = 0): string {
  const retryLine = retryCount > 0
    ? `第 ${retryCount} 次重试（最多 ${LOOP_SUBTASK_RETRY_MAX_RETRIES} 次）。`
    : "";
  return [
    `Loop 子任务第 ${round} 轮执行：${subtask.title}`,
    retryLine,
    subtask.prompt ?? subtask.title,
  ].filter(Boolean).join("\n");
}

function buildLoopMainModelPrompt(
  rootPrompt: string,
  task: LoopTaskRecord,
  round: number,
  continuePrompt?: string,
): string {
  const taskId = task.id;
  const taskFile = task.taskStoreFile;
  const communication = getLoopCommunicationPaths(taskId);
  const normalizedContinuePrompt = normalizeLoopContinuePromptForPrompt(continuePrompt);
  return [
    "你正在执行 VS Code 插件的 Loop 模式主任务。",
    `Loop 任务 ID：${taskId}`,
    `当前轮次：${round}`,
    `任务记录文件：${taskFile}`,
    `沟通目录：${communication.dir}`,
    `主任务沟通文件：${communication.mainFile}`,
    `子任务沟通目录：${communication.subtasksDir}`,
    "",
    "Loop 模式原理（必须遵守）：",
    "1. 主任务每轮只输出一个 JSON 决策，不直接做具体实现。",
    `2. 当你返回 status=continue 时，程序会按 subtasks 数组启动 1~${LOOP_PARALLEL_SUBTASK_MAX} 个子任务新会话。`,
    "3. 只有同一批次所有子任务都结束后，程序才会回到当前主任务会话并唤醒你继续复核。",
    "4. 你需要基于任务记录 + 沟通文件再次决策，循环直到你返回 status=completed。",
    "5. 任务不会因为子任务都显示 completed 自动结束，只有你返回 completed 才结束；sleep 只会定时恢复，不代表完成。",
    "",
    "自动睡眠协议（适用于任何可解析任务决策）：",
    ...buildLoopAutoSleepProtocolLines().map((line) => `- ${line}`),
    "",
    "主任务职责：",
    "1. 读取任务记录文件中当前任务的 status、activeSubtaskId、activeSubtaskIds、subTasks 和 rounds 概要。",
    "2. 必须读取主任务沟通文件和子任务沟通目录中的最新执行报告，再做审核验收和下一步决策。",
    "3. 第 1 轮先给出整体阶段计划（建议 3~6 个阶段）并写入主任务沟通文件，然后优先派发首批互不冲突的最小可执行子任务；不要默认只派发 1 个。",
    "4. 后续轮次按计划滚动更新：完成一个子任务或一批子任务后复核一次，不满足就继续派发下一批尽可能并发的子任务。",
    "5. 并发优先：只要能确定多个子任务预计写入文件/目录互不重叠、没有先后依赖、不会争抢同一验证环境，就必须放入同一个 subtasks 批次。",
    "6. 串行兜底：只有共享写入同一文件/同一配置、需要基于另一个子任务产物继续修改、或必须独占同一验证环境时，才只返回 1 个子任务。",
    `7. 每批最多 ${LOOP_PARALLEL_SUBTASK_MAX} 个子任务；如果可并发项超过上限，优先选择当前阶段最独立、收益最高的一组。`,
    "8. 先做审核和验收：对照原始目标、已完成子任务 summary、沟通文件、代码/文档状态和验证结果逐项检查。",
    "9. 若子任务沟通文件已提供可核验的单测/编译命令与结果，主任务无需重复执行这些验证；优先复核逻辑正确性、改动范围和结果一致性，仅在证据缺失或结果可疑时补充验证。",
    "10. 子任务沟通文件的 `## 待主任务确认` 若标记为待确认，你必须先处理：能依据现有事实和规则自主确定时，把结论写入后续子任务 prompt；确实必须用户或人工确认时返回 blocked，不得把该子任务误判为已验收。",
    "11. 每次主任务复核都必须预判 estimatedRemainingRounds：从当前决策之后预计还需要多少个主任务复核轮/子任务批次才能 completed；completed 时必须为 0。",
    "12. 只有验收全部通过，才能返回 completed；有可执行补齐工作时必须返回 continue。只有明确等待外部结果且当前没有可执行子任务时，才可返回 sleep。",
    "13. 主任务只负责复核整体进度、拆分/维护 subTasks、选择下一批最小子任务。",
    "14. 主任务不要直接执行具体代码/文件修改；返回 JSON 后由程序启动子任务。",
    "15. 输出必须是一个 JSON 对象，不要包裹 markdown，不要输出额外解释。",
    "",
    "JSON 协议：",
    '{"status":"completed","estimatedRemainingRounds":0,"answerConclusion":"直接回答用户原始问题的简短结论","finalSummary":"整体完成说明","requirementCoverage":[{"name":"用户需求A","passed":true,"detail":"覆盖说明"}],"roundSummaries":[{"round":1,"subtaskId":"stable-id","title":"子任务标题","summary":"本轮完成内容摘要"}],"acceptance":{"passed":true,"summary":"验收通过说明","checks":[{"name":"目标覆盖","passed":true,"detail":"..."}]}}',
    '{"status":"continue","estimatedRemainingRounds":2,"acceptance":{"passed":false,"summary":"未通过原因","checks":[{"name":"缺口项","passed":false,"detail":"..."}]},"parallelReason":"这些子任务预计写入文件互不重叠、没有先后依赖，可以并发","subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src-a","writeFiles":["src/a.ts","src/a.test.ts"],"prompt":"给子任务A执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"},{"id":"stable-id-b","title":"子任务B标题","conflictGroup":"docs-b","writeFiles":["docs/b.md"],"prompt":"给子任务B执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"}]}',
    '{"status":"continue","estimatedRemainingRounds":1,"acceptance":{"passed":false,"summary":"存在同文件或依赖冲突，必须串行","checks":[{"name":"依赖关系","passed":false,"detail":"B 依赖 A 对 src/shared.ts 的修改结果"}]},"subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src/shared.ts","writeFiles":["src/shared.ts"],"prompt":"给子任务A执行的完整指令"}]}',
    '{"status":"sleep","wakeAfterSeconds":3600,"sleepReason":"等待外部构建完成后复核结果","estimatedRemainingRounds":1}',
    '{"status":"blocked","estimatedRemainingRounds":0,"finalSummary":"阻塞原因"}',
    "",
    "字段要求：",
    "- status 只能是 completed、continue、sleep、blocked。",
    "- 每次返回都必须提供 estimatedRemainingRounds；含义是从当前决策之后预计还需要多少个主任务复核轮/子任务批次才能 completed，必须是非负整数。",
    "- status=completed 时必须提供 estimatedRemainingRounds=0、acceptance.passed=true、answerConclusion、finalSummary、requirementCoverage 和 roundSummaries。",
    "- answerConclusion 用于直接回答用户原始问题，应尽量简短明确；finalSummary 用于整体完成说明和交付总结。",
    "- requirementCoverage 必须逐条覆盖用户原始需求，不可遗漏；所有项都必须 passed=true。",
    "- roundSummaries 需要按轮次汇总每轮子任务完成内容，至少包含 round、title、summary；如有 subtaskId 也应带上。",
    "- finalSummary 需要给出整体结果，并基于 roundSummaries 归纳所有轮次完成项与最终交付情况。",
    `- status=continue 时必须提供 acceptance.passed=false、subtasks 数组，数组长度 1~${LOOP_PARALLEL_SUBTASK_MAX}。`,
    `- status=sleep 时不得提供 subtasks；必须提供 ${LOOP_AUTO_WAKE_MIN_SECONDS}~${LOOP_AUTO_WAKE_MAX_SECONDS} 范围内的整数 wakeAfterSeconds，以及非空的简短 sleepReason。`,
    "- sleep 只能用于等待当前进程之外的可观察结果，不得用它替代可立即执行的调研、实现、验证或子任务派发；它是通用等待能力，但只有本 JSON 决策协议会被宿主解析。",
    "- subtasks 中每个对象都必须提供 title 和 prompt；prompt 必须自包含且足够详细，因为子任务每次都会在单独新会话中执行，看不到主任务对话上下文。",
    "- subtasks[*].prompt 至少包含：背景目标、具体范围、预计只读/写文件或目录、执行步骤、验收标准、必须更新任务记录文件和写入沟通文件的要求。",
    "- subtasks[*].id 应稳定可读；如果复用已有子任务，请使用已有 id。",
    "- subtasks[*].writeFiles 可选；但返回多个 subtasks 时，必须为每个会写文件的子任务列出预计写入文件或目录，用于证明文件不冲突；纯验证/调研子任务可省略并在 parallelReason 说明不会写文件。",
    "- subtasks[*].conflictGroup 可选，用于说明冲突域；同一批次内不应出现会互相覆盖的冲突域。",
    "- 返回多个 subtasks 前，必须确认它们的 writeFiles / conflictGroup 互不重叠；只要能确认文件不冲突，就优先并发，不要保守串行；无法判断写入范围的实现类子任务应串行。",
    "- 返回 continue 前，同时更新任务记录文件中的 subTasks、activeSubtaskId、activeSubtaskIds 和 estimatedRemainingRounds。",
    "- 返回 completed 前，同时更新任务记录文件 status=completed、estimatedRemainingRounds=0、answerConclusion、finalSummary、roundSummaries，并保证 acceptance.checks 全部 passed=true。",
    "",
    ...buildLoopSupplementalRequirementsLines(task),
    ...(normalizedContinuePrompt ? [
      "本次继续指令：",
      normalizedContinuePrompt,
      "",
    ] : []),
    "原始目标：",
    rootPrompt,
  ].join("\n");
}

function buildLoopModeratorMainModelPrompt(
  rootPrompt: string,
  task: LoopTaskRecord,
  round: number,
  continuePrompt?: string,
): string {
  const planningDebate = findReusableLoopPlanningDebateRound(task);
  const planningPaths = planningDebate
    ? buildLoopDebatePaths(task.communicationDir, planningDebate.loopRound, planningDebate.debateRound)
    : null;
  const planningDecision = planningDebate?.consensus?.decision
    ?? (planningDebate ? readLoopPlanningDebateDecision(task, planningDebate) : null);
  const planningConsensus = planningDebate?.consensus;
  const mainSubChatFile = buildLoopMainSubChatTranscriptFile(task.communicationDir);
  const basePrompt = buildLoopMainModelPrompt(
    rootPrompt,
    task,
    round,
    continuePrompt,
  );
  const planningLines = planningDebate && planningPaths
    ? [
        `- 红蓝规划轮次：主任务第 ${planningDebate.loopRound} 轮 / 辩论第 ${planningDebate.debateRound} 轮`,
        `- brief 文件：${planningPaths.briefFile}`,
        `- 红蓝群聊记录：${planningPaths.chatFile}`,
        `- 参与者清单：${planningPaths.participantRosterFile}`,
        `- cross-review 文件：${planningPaths.crossReviewFile}`,
        `- consensus 文件：${planningPaths.consensusFile}`,
        `- decision 文件：${planningPaths.decisionFile}`,
        planningConsensus?.summary ? `- 红蓝共识摘要：${planningConsensus.summary}` : "- 红蓝共识摘要：未记录",
        planningDecision?.status ? `- 红蓝规划初始决策状态：${planningDecision.status}` : "- 红蓝规划初始决策状态：未解析",
        typeof planningDecision?.estimatedRemainingRounds === "number"
          ? `- 红蓝规划预计剩余轮次：${planningDecision.estimatedRemainingRounds}`
          : "- 红蓝规划预计剩余轮次：未记录",
      ]
    : [
        "- 未找到可复用的红蓝规划共识；如果你无法确认规划基线，必须返回 blocked，说明需要先完成规划辩论。",
      ];

  return [
    "你正在执行 VS Code 插件的 Loop 红蓝辩论模式后续实现阶段。",
    "",
    "关键阶段规则（必须优先遵守）：",
    "1. 红蓝辩论只用于规划阶段；当前阶段不要再启动、要求或模拟新的红蓝辩论。",
    "2. 你现在是主持人主智能体，负责把首轮红蓝规划共识落到主从多智能体执行链路中。",
    "3. 后续实现、复核、继续派发和最终验收都由你主持；具体实现仍由程序根据你的 JSON 决策启动子任务。",
    "4. 你必须把首轮红蓝共识作为规划基线。只有执行反馈证明共识需要调整时，才可通过新的子任务、验收标准或 blocked 决策调整，不得忽略红队已识别的风险。",
    "5. 你仍然不能直接修改工作区内容；只能输出一个符合 LoopMainDecision 的 JSON，由程序派发子任务。",
    "",
    "必须读取的规划与执行上下文：",
    ...planningLines,
    `- 主从执行群聊：${mainSubChatFile}`,
    `- 主任务沟通文件：${task.mainCommunicationFile}`,
    `- 任务记录文件：${task.taskStoreFile}`,
    "",
    "主持人主智能体职责补充：",
    "- 第 1 次红蓝共识已经完成了规划审查；你应从主从执行视角拆分或复核子任务，不要重复组织蓝队/红队发言。",
    "- 派发子任务时，必须把相关红蓝共识、红队风险、蓝队修正方案和验收证据要求写入 subtasks[*].prompt。",
    "- 子任务完成后，优先依据子任务沟通文件和主从执行群聊做验收；证据不足时继续派发验证或修复子任务。",
    "- 如果执行阶段发现首轮共识存在无法自动化解决的阻塞问题，返回 status=blocked，并在 finalSummary 说明需要人工复核的原因。",
    "",
    "下面是通用主任务协议，除本节新增的红蓝规划阶段规则外，仍需完整遵守：",
    "",
    basePrompt,
  ].join("\n");
}

function buildLoopSubtaskModelPrompt(
  rootPrompt: string,
  task: LoopTaskRecord,
  round: number,
  subtask: LoopSubtaskRecord,
  retryCount = 0,
  communicationFile?: string
): string {
  const taskId = task.id;
  const taskFile = task.taskStoreFile;
  const communication = getLoopCommunicationPaths(taskId);
  const reportFile = communicationFile ?? buildLoopSubtaskCommunicationFile(taskId, subtask.id, round, retryCount);
  const writeFiles = Array.isArray(subtask.writeFiles) && subtask.writeFiles.length > 0
    ? subtask.writeFiles.join("、")
    : "未声明；以当前子任务指令明确授权的文件/范围为准";
  return [
    "你正在执行 VS Code 插件的 Loop 模式子任务。",
    "注意：这是单独新会话，不具备主任务对话上下文；只能依赖本提示词和任务记录文件。",
    "注意：同一轮可能存在其他子任务并发执行；必须严格限定在当前子任务授权范围内，发现写入范围冲突时先停止并在沟通文件中报告。",
    `Loop 任务 ID：${taskId}`,
    `当前轮次：${round}`,
    `当前子任务 ID：${subtask.id}`,
    `当前重试次数：${retryCount}`,
    `任务记录文件：${taskFile}`,
    `沟通目录：${communication.dir}`,
    `本子任务沟通文件：${reportFile}`,
    "",
    "子任务职责：",
    "1. 只执行当前子任务，不重新拆分主目标。",
    "2. 可以进行当前子任务范围内必要代码/文件修改和验证，不要修改未在指令或 writeFiles 中授权的范围。",
    "3. 完成后更新任务记录文件中对应 subTasks 项的 status、summary 和 communicationFile。",
    "4. 子任务结束前必须把执行情况写入本子任务沟通文件，主任务唤醒后一定会读取该文件。",
    "5. 涉及代码改动时，优先在子任务内完成必要单测/编译，并把命令与结果写入沟通文件，供主任务直接复核，不要留给主任务重复执行。",
    "6. 沟通文件必须写清：执行目标、实际修改/操作、涉及文件、验证命令与结果、遗留问题、给主任务的建议。",
    "7. 子任务结束后不要继续生成下一个子任务；程序会自动唤醒主任务复核。",
    "8. 在一个连续执行回合内完成当前授权范围；先实施，再只运行能直接证明本次改动的最小必要检查。不要为了可选调研、额外检查或无关重试增加轮次。",
    "",
    "疑问交接协议（强制）：",
    "1. 只有当需求不明、授权不足、依赖或写入冲突，或存在必须由主任务/用户确认后才能安全继续的问题时，立即停止实施；能依据现有事实和规则自行判断的问题不得上交。",
    "2. 在本子任务沟通文件的 `## 待主任务确认` 章节写明：待确认问题、已知事实、影响/阻塞步骤、可选方案、推荐方案；不要等待回复。",
    "3. 合并更新任务记录中当前 subTasks 项：status=completed，summary 明确“待主任务确认”，communicationFile 指向本文件；然后结束子任务。",
    "4. 严禁在 assistant 回复中向用户或主任务提问，也不得复述待确认问题；疑问只允许出现在沟通文件中。",
    "5. 疑问交接场景的最终 assistant 回复必须且只能是：`子任务已结束，待主任务确认事项已写入沟通文件。`",
    "",
    "当前子任务：",
    `标题：${subtask.title}`,
    `授权写入文件/范围：${writeFiles}`,
    `指令：${subtask.prompt ?? subtask.title}`,
    "",
    "原始目标：",
    rootPrompt,
  ].join("\n");
}

function getLoopMessagesForTarget(target: PromptRunTarget): ChatMessage[] {
  const tab = getConversationTabById(target.tabId);
  const sessionId = tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
  return sessionId
    ? loadSessionMessages(target.cli, sessionId)
    : getPendingSessionDraft(target.tabId, target.cli).messages;
}

function resolveLoopSubtaskConversationContext(
  cli: CliName,
  tabId: string | null | undefined
): LoopSubtaskConversationContext | null {
  if (!tabId) {
    return null;
  }
  const tab = getConversationTabById(tabId);
  if (!tab || tab.cli !== cli) {
    return null;
  }
  const sessionId = getConversationTabSessionIdForCli(tab, cli);
  const messages = sessionId
    ? loadSessionMessages(cli, sessionId)
    : getPendingSessionDraft(tabId, cli).messages;
  return resolveLoopSubtaskConversationContextFromMessages(messages);
}

function isLoopSubtaskConversationTarget(cli: CliName, tabId: string | null | undefined): boolean {
  return Boolean(resolveLoopSubtaskConversationContext(cli, tabId));
}

function getLastLoopAssistantContent(
  target: PromptRunTarget,
  taskId: string,
  round: number,
  role: LoopTaskRole
): string | null {
  const messages = getLoopMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === role
      && message.loopTaskId === taskId
      && message.loopRound === round
      && message.content.trim()
    ) {
      return message.content;
    }
  }
  return null;
}

function parseLoopMainDecision(content: string | null): LoopMainDecision | null {
  if (!content) {
    return null;
  }
  const jsonText = extractJsonObjectText(content);
  if (!jsonText) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonText);
    return normalizeLoopMainDecision(parsed);
  } catch {
    return null;
  }
}

function extractJsonObjectText(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = content.indexOf("{");
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index + 1).trim();
      }
    }
  }
  return null;
}

function normalizeLoopMainDecision(value: unknown): LoopMainDecision | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<LoopMainDecision>;
  const estimatedRemainingRounds = normalizeLoopEstimatedRemainingRounds(
    (raw as { estimatedRemainingRounds?: unknown }).estimatedRemainingRounds
  );
  if (raw.status === "sleep") {
    const sleepDecision = normalizeLoopSleepDecision(value);
    if (!sleepDecision) {
      return null;
    }
    return {
      ...sleepDecision,
      estimatedRemainingRounds,
    };
  }
  if (raw.status === "completed") {
    const acceptance = normalizeLoopAcceptance((raw as { acceptance?: unknown }).acceptance);
    const requirementCoverage = normalizeLoopAcceptanceChecks((raw as { requirementCoverage?: unknown }).requirementCoverage);
    const answerConclusion = typeof raw.answerConclusion === "string" && raw.answerConclusion.trim()
      ? raw.answerConclusion.trim()
      : undefined;
    const finalSummary = typeof raw.finalSummary === "string" && raw.finalSummary.trim()
      ? raw.finalSummary.trim()
      : "";
    const roundSummaries = normalizeLoopRoundSummaries((raw as { roundSummaries?: unknown }).roundSummaries);
    if (
      !acceptance?.passed
      || !acceptance.checks.every((check) => check.passed)
      || requirementCoverage.length === 0
      || !requirementCoverage.every((item) => item.passed)
      || !finalSummary
      || !roundSummaries
    ) {
      return null;
    }
    return {
      status: "completed",
      ...(answerConclusion ? { answerConclusion } : {}),
      finalSummary,
      requirementCoverage,
      roundSummaries,
      acceptance,
      estimatedRemainingRounds: 0,
    };
  }
  if (raw.status === "blocked") {
    return {
      status: "blocked",
      finalSummary: typeof raw.finalSummary === "string" ? raw.finalSummary : undefined,
      estimatedRemainingRounds,
    };
  }
  if (raw.status !== "continue") {
    return null;
  }
  const subtasks = normalizeLoopSubtaskDecisions(raw);
  if (!subtasks || subtasks.length === 0) {
    return null;
  }
  const acceptance = normalizeLoopAcceptance((raw as { acceptance?: unknown }).acceptance);
  return {
    status: "continue",
    acceptance: acceptance ?? { passed: false, checks: [] },
    subtask: subtasks[0],
    subtasks,
    parallelReason: typeof (raw as { parallelReason?: unknown }).parallelReason === "string"
      ? (raw as { parallelReason: string }).parallelReason.trim()
      : undefined,
    estimatedRemainingRounds,
  };
}

function normalizeLoopEstimatedRemainingRounds(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(numeric), 0), LOOP_MAX_MAX_ROUNDS);
}

function normalizeLoopSubtaskDecisions(raw: Partial<LoopMainDecision>): LoopSubtaskDecision[] | null {
  const rawSubtasks = Array.isArray((raw as { subtasks?: unknown }).subtasks)
    ? (raw as { subtasks: unknown[] }).subtasks
    : (raw.subtask ? [raw.subtask] : []);
  if (rawSubtasks.length === 0 || rawSubtasks.length > LOOP_PARALLEL_SUBTASK_MAX) {
    return null;
  }
  const normalized = rawSubtasks
    .map((item): LoopSubtaskDecision | null => normalizeSingleLoopSubtaskDecision(item))
    .filter((item): item is LoopSubtaskDecision => Boolean(item));
  if (normalized.length !== rawSubtasks.length) {
    return null;
  }
  const seenIds = new Set<string>();
  for (const subtask of normalized) {
    const id = subtask.id ?? buildLoopSubtaskId(subtask.title);
    if (seenIds.has(id)) {
      return null;
    }
    seenIds.add(id);
  }
  return normalized;
}

function normalizeSingleLoopSubtaskDecision(value: unknown): LoopSubtaskDecision | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const subtask = value as {
    id?: unknown;
    title?: unknown;
    prompt?: unknown;
    conflictGroup?: unknown;
    writeFiles?: unknown;
    skillIds?: unknown;
  };
  const title = typeof subtask.title === "string" ? subtask.title.trim() : "";
  const prompt = typeof subtask.prompt === "string" ? subtask.prompt.trim() : "";
  if (!title || !prompt || prompt.length < LOOP_SUBTASK_PROMPT_MIN_LENGTH) {
    return null;
  }
  const id = typeof subtask.id === "string" && subtask.id.trim()
    ? subtask.id.trim()
    : buildLoopSubtaskId(title);
  const conflictGroup = typeof subtask.conflictGroup === "string" && subtask.conflictGroup.trim()
    ? subtask.conflictGroup.trim()
    : undefined;
  const writeFiles = normalizeLoopWriteFiles(subtask.writeFiles);
  const skillIds = Array.isArray(subtask.skillIds)
    ? subtask.skillIds
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  return {
    id,
    title,
    prompt,
    conflictGroup,
    writeFiles: writeFiles.length > 0 ? writeFiles : undefined,
    ...(skillIds.length > 0 ? { skillIds } : {}),
  };
}

function normalizeLoopRoundSummaries(value: unknown): LoopRoundSummary[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .map((item): LoopRoundSummary | null => normalizeSingleLoopRoundSummary(item))
    .filter((item): item is LoopRoundSummary => Boolean(item));
}

function normalizeSingleLoopRoundSummary(value: unknown): LoopRoundSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const summary = value as {
    round?: unknown;
    subtaskId?: unknown;
    title?: unknown;
    summary?: unknown;
  };
  const round = typeof summary.round === "number" && summary.round > 0
    ? Math.floor(summary.round)
    : null;
  const title = typeof summary.title === "string" ? summary.title.trim() : "";
  const content = typeof summary.summary === "string" ? summary.summary.trim() : "";
  if (!round || !title || !content) {
    return null;
  }
  return {
    round,
    subtaskId: typeof summary.subtaskId === "string" && summary.subtaskId.trim()
      ? summary.subtaskId.trim()
      : undefined,
    title,
    summary: content,
  };
}

function normalizeLoopAcceptance(value: unknown): LoopAcceptance | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { passed?: unknown; summary?: unknown; checks?: unknown };
  const checks = normalizeLoopAcceptanceChecks(raw.checks);
  return {
    passed: raw.passed === true,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    checks,
  };
}

function normalizeLoopAcceptanceChecks(value: unknown): LoopAcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): LoopAcceptanceCheck | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const check = item as { name?: unknown; passed?: unknown; detail?: unknown };
      const name = typeof check.name === "string" && check.name.trim() ? check.name.trim() : "acceptance";
      return {
        name,
        passed: check.passed === true,
        detail: typeof check.detail === "string" ? check.detail : undefined,
      };
    })
    .filter((item): item is LoopAcceptanceCheck => Boolean(item));
}

function buildLoopSubtaskId(title: string): string {
  return `subtask_${createHash("sha1").update(title).digest("hex").slice(0, 10)}`;
}

function applyLoopMainDecision(
  taskId: string,
  decision: LoopMainDecision,
): { status: "completed" | "continue" | "sleeping" | "blocked"; task: LoopTaskRecord; subtasks?: LoopSubtaskRecord[] } {
  const existing = readLoopTaskRecord(taskId);
  if (!existing) {
    throw new Error(`loop-task-missing:${taskId}`);
  }
  if (decision.status === "completed") {
    const task = updateLoopTaskRecord(taskId, {
      status: "completed",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      answerConclusion: resolveLoopAnswerConclusion(existing, decision),
      finalSummary: decision.finalSummary,
      estimatedRemainingRounds: 0,
      completionRoundSummaries: decision.roundSummaries ?? existing.completionRoundSummaries,
      completionRequirementCoverage: decision.requirementCoverage ?? existing.completionRequirementCoverage,
      autoSleepStartedAt: undefined,
      autoWakeAt: undefined,
      autoSleepReason: undefined,
      updatedAt: Date.now(),
    }) ?? existing;
    appendLoopMainDecisionSummary(task, decision);
    appendLoopMainSubChatMainDecision(task, decision);
    return { status: "completed", task };
  }
  if (decision.status === "sleep") {
    const sleepDecision = normalizeLoopSleepDecision(decision);
    if (!sleepDecision) {
      throw new Error(`loop-task-invalid-sleep-decision:${taskId}`);
    }
    const autoSleepStartedAt = Date.now();
    const autoWakeAt = resolveLoopAutoWakeAt(autoSleepStartedAt, sleepDecision.wakeAfterSeconds);
    const task = updateLoopTaskRecord(taskId, {
      status: "sleeping",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      autoSleepStartedAt,
      autoWakeAt,
      autoSleepReason: sleepDecision.sleepReason,
      ...(typeof decision.estimatedRemainingRounds === "number" ? { estimatedRemainingRounds: decision.estimatedRemainingRounds } : {}),
      updatedAt: autoSleepStartedAt,
    }) ?? existing;
    appendLoopMainDecisionSummary(task, decision);
    appendLoopMainSubChatMainDecision(task, decision);
    return { status: "sleeping", task };
  }
  if (decision.status === "blocked") {
    const task = updateLoopTaskRecord(taskId, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      finalSummary: decision.finalSummary ?? "Main task reported blocked.",
      ...(typeof decision.estimatedRemainingRounds === "number" ? { estimatedRemainingRounds: decision.estimatedRemainingRounds } : {}),
      autoSleepStartedAt: undefined,
      autoWakeAt: undefined,
      autoSleepReason: undefined,
      updatedAt: Date.now(),
    }) ?? existing;
    appendLoopMainDecisionSummary(task, decision);
    appendLoopMainSubChatMainDecision(task, decision);
    return { status: "blocked", task };
  }

  const decisionSubtasks = getLoopDecisionSubtasks(decision);
  if (decisionSubtasks.length === 0) {
    const task = updateLoopTaskRecord(taskId, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      finalSummary: "Main task returned continue without subtasks.",
      autoSleepStartedAt: undefined,
      autoWakeAt: undefined,
      autoSleepReason: undefined,
      updatedAt: Date.now(),
    }) ?? existing;
    return { status: "blocked", task };
  }

  const subtaskBatch = upsertLoopSubtasks(existing, decisionSubtasks);
  const activeSubtaskIds = subtaskBatch.records.map((item) => item.id);
  const task = updateLoopTaskRecord(taskId, {
    status: "running",
    activeSubtaskId: activeSubtaskIds[0] ?? null,
    activeSubtaskIds,
    subTasks: subtaskBatch.nextSubtasks,
    ...(typeof decision.estimatedRemainingRounds === "number" ? { estimatedRemainingRounds: decision.estimatedRemainingRounds } : {}),
    autoSleepStartedAt: undefined,
    autoWakeAt: undefined,
    autoSleepReason: undefined,
    updatedAt: Date.now(),
  }) ?? existing;
  appendLoopMainDecisionSummary(task, decision);
  appendLoopMainSubChatMainDecision(task, decision, subtaskBatch.records);
  return { status: "continue", task, subtasks: subtaskBatch.records };
}

function getLoopDecisionSubtasks(decision: LoopMainDecision): LoopSubtaskDecision[] {
  if (Array.isArray(decision.subtasks) && decision.subtasks.length > 0) {
    return decision.subtasks;
  }
  return decision.subtask ? [decision.subtask] : [];
}

function appendLoopMainDecisionSummary(task: LoopTaskRecord, decision: LoopMainDecision): void {
  try {
    fs.mkdirSync(path.dirname(task.mainCommunicationFile), { recursive: true });
    const lines: string[] = [
      `## 主任务${decision.status === "completed" ? "最终验收" : "复核结论"}`,
      `- 时间：${new Date().toISOString()}`,
      `- 状态：${decision.status}`,
    ];
    if (decision.acceptance?.summary) {
      lines.push(`- 验收摘要：${decision.acceptance.summary}`);
    }
    const remainingRounds = formatLoopEstimatedRemainingRounds(decision.estimatedRemainingRounds);
    if (remainingRounds) {
      lines.push(`- 预计剩余轮次：${remainingRounds}`);
    }
    if (decision.status === "sleep") {
      lines.push(`- 自动睡眠原因：${task.autoSleepReason ?? decision.sleepReason ?? "未记录"}`);
      lines.push(`- 计划唤醒时间：${formatLoopAutoWakeAtForRecord(task.autoWakeAt)}`);
      lines.push(`- 唤醒间隔秒数：${decision.wakeAfterSeconds ?? "未记录"}`);
    }
    if (decision.status === "completed") {
      lines.push("");
      lines.push("### 问题回答结论");
      lines.push(resolveLoopAnswerConclusion(task, decision));
    }
    if (decision.finalSummary) {
      lines.push("");
      lines.push("### 整体总结");
      lines.push(decision.finalSummary);
    }
    const decisionSubtasks = getLoopDecisionSubtasks(decision);
    if (decisionSubtasks.length > 0) {
      lines.push("");
      lines.push(decisionSubtasks.length === 1 ? "### 下一步子任务" : "### 下一步并发子任务批次");
      if (decision.parallelReason) {
        lines.push(`- 并发判断：${decision.parallelReason}`);
      }
      decisionSubtasks.forEach((subtask, index) => {
        const prefix = decisionSubtasks.length === 1 ? "" : `${index + 1}. `;
        lines.push(`- ${prefix}子任务 ID：${subtask.id ?? buildLoopSubtaskId(subtask.title)}`);
        lines.push(`- ${prefix}标题：${subtask.title}`);
        if (subtask.conflictGroup) {
          lines.push(`- ${prefix}冲突组：${subtask.conflictGroup}`);
        }
        const writeFiles = formatLoopWriteFiles(subtask.writeFiles);
        if (writeFiles) {
          lines.push(`- ${prefix}预计写入：${writeFiles}`);
        }
        lines.push("");
        lines.push(`#### ${prefix}子任务指令`);
        lines.push(subtask.prompt);
      });
    }
    if (Array.isArray(decision.roundSummaries) && decision.roundSummaries.length > 0) {
      lines.push("");
      lines.push("### 各轮子任务摘要");
      decision.roundSummaries
        .slice()
        .sort((left, right) => left.round - right.round)
        .forEach((item) => {
          const subtaskSuffix = item.subtaskId ? `（${item.subtaskId}）` : "";
          lines.push(`- 第 ${item.round} 轮 ${item.title}${subtaskSuffix}：${item.summary}`);
        });
    }
    if (Array.isArray(decision.requirementCoverage) && decision.requirementCoverage.length > 0) {
      lines.push("");
      lines.push("### 用户需求覆盖清单");
      decision.requirementCoverage.forEach((item) => {
        const detail = item.detail ? `（${item.detail}）` : "";
        lines.push(`- ${item.name}：${item.passed ? "已覆盖" : "未覆盖"}${detail}`);
      });
    }
    fs.appendFileSync(task.mainCommunicationFile, `\n\n${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    void logError("loop-main-summary-write-error", {
      taskId: task.id,
      filePath: task.mainCommunicationFile,
      error: String(error),
    });
  }
}

function buildLoopSubtaskDecisionMarkdown(
  task: LoopTaskRecord,
  round: number,
  subtasks: LoopSubtaskRecord[],
  decision: LoopMainDecision,
): string {
  const acceptanceChecks = Array.isArray(decision.acceptance?.checks) ? decision.acceptance?.checks ?? [] : [];
  const lines: string[] = [
    subtasks.length === 1 ? "## Loop 子任务派发" : "## Loop 并发子任务派发",
    "",
    `- 任务 ID：${task.id}`,
    `- 轮次：${round}`,
    `- 子任务数量：${subtasks.length}`,
    `- 决策状态：${decision.status}`,
  ];

  if (decision.acceptance?.summary) {
    lines.push(`- 本轮复核：${decision.acceptance.summary}`);
  }
  const remainingRounds = formatLoopEstimatedRemainingRounds(decision.estimatedRemainingRounds);
  if (remainingRounds) {
    lines.push(`- 预计剩余轮次：${remainingRounds}`);
  }
  if (decision.parallelReason) {
    lines.push(`- 并发判断：${decision.parallelReason}`);
  }
  if (subtasks.length === 1 && subtasks[0]) {
    lines.push(`- 子任务 ID：${subtasks[0].id}`);
    lines.push(`- 子任务标题：${subtasks[0].title}`);
    if (subtasks[0].conflictGroup) {
      lines.push(`- 冲突组：${subtasks[0].conflictGroup}`);
    }
    const writeFiles = formatLoopWriteFiles(subtasks[0].writeFiles);
    if (writeFiles) {
      lines.push(`- 预计写入：${writeFiles}`);
    }
  }

  if (acceptanceChecks.length > 0) {
    lines.push("");
    lines.push("### 复核检查");
    acceptanceChecks.forEach((check) => {
      const detail = check.detail ? `（${check.detail}）` : "";
      lines.push(`- ${check.name}：${check.passed ? "通过" : "未通过"}${detail}`);
    });
  }

  lines.push("");
  lines.push(subtasks.length === 1 ? "### 子任务指令" : "### 子任务指令批次");
  subtasks.forEach((subtask, index) => {
    if (subtasks.length > 1) {
      lines.push("");
      lines.push(`#### ${index + 1}. ${subtask.title}`);
      lines.push(`- 子任务 ID：${subtask.id}`);
      if (subtask.conflictGroup) {
        lines.push(`- 冲突组：${subtask.conflictGroup}`);
      }
      const writeFiles = formatLoopWriteFiles(subtask.writeFiles);
      if (writeFiles) {
        lines.push(`- 预计写入：${writeFiles}`);
      }
    }
    lines.push(subtask.prompt ?? subtask.title);
  });

  return `${lines.join("\n")}\n`;
}

function upsertLoopSubtask(
  task: LoopTaskRecord,
  subtask: NonNullable<LoopMainDecision["subtask"]>,
): { record: LoopSubtaskRecord; nextSubtasks: LoopSubtaskRecord[] } {
  const now = Date.now();
  const id = subtask.id && subtask.id.trim() ? subtask.id.trim() : buildLoopSubtaskId(subtask.title);
  const nextSubtasks = [...task.subTasks];
  const existingIndex = nextSubtasks.findIndex((item) => item.id === id);
  const record: LoopSubtaskRecord = {
    id,
    title: subtask.title,
    prompt: subtask.prompt,
    conflictGroup: subtask.conflictGroup,
    writeFiles: subtask.writeFiles,
    status: "running",
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    const { skillIds: _skillIds, skillGuidance: _skillGuidance, ...existingRecord } = nextSubtasks[existingIndex];
    const nextRecord: LoopSubtaskRecord = {
      ...existingRecord,
      ...record,
      status: existingRecord.status === "completed" ? "completed" : "running",
    };
    nextSubtasks[existingIndex] = nextRecord;
    return { record: nextRecord, nextSubtasks };
  }
  nextSubtasks.push(record);
  return { record, nextSubtasks };
}

function upsertLoopSubtasks(
  task: LoopTaskRecord,
  subtasks: LoopSubtaskDecision[],
): { records: LoopSubtaskRecord[]; nextSubtasks: LoopSubtaskRecord[] } {
  let nextSubtasks = [...task.subTasks];
  const records: LoopSubtaskRecord[] = [];
  subtasks.forEach((subtask) => {
    const id = subtask.id && subtask.id.trim() ? subtask.id.trim() : buildLoopSubtaskId(subtask.title);
    const result = upsertLoopSubtask(
      { ...task, subTasks: nextSubtasks },
      subtask,
    );
    nextSubtasks = result.nextSubtasks;
    records.push(result.record);
  });
  return { records, nextSubtasks };
}

function getActiveLoopSubtaskIds(task: LoopTaskRecord): string[] {
  const ids = Array.isArray(task.activeSubtaskIds) ? task.activeSubtaskIds : [];
  const normalized = ids.filter((id) => typeof id === "string" && id.trim());
  if (task.activeSubtaskId && !normalized.includes(task.activeSubtaskId)) {
    normalized.unshift(task.activeSubtaskId);
  }
  return Array.from(new Set(normalized));
}

function markLoopSubtaskRunFinished(
  taskId: string,
  subtaskId: string,
  runStatus: TaskRunStatus,
  assistantContent: string | null,
): void {
  const task = readLoopTaskRecord(taskId);
  if (!task) {
    return;
  }
  const subtaskRecord = task.subTasks.find((item) => item.id === subtaskId);
  const now = Date.now();
  const summary = buildLoopSubtaskCompletionSummary(assistantContent);
  const nextStatus: LoopSubtaskRecord["status"] = runStatus === "end" ? "completed" : "blocked";
  const subTasks = task.subTasks.map((item) => {
    if (item.id !== subtaskId) {
      return item;
    }
    return {
      ...item,
      status: nextStatus,
      summary: summary ?? item.summary,
      updatedAt: now,
    };
  });
  const activeSubtaskIds = getActiveLoopSubtaskIds(task).filter((id) => id !== subtaskId);
  updateLoopTaskRecord(taskId, {
    subTasks,
    activeSubtaskId: activeSubtaskIds[0] ?? null,
    activeSubtaskIds,
    updatedAt: now,
  });
  appendLoopSubtaskCompletionAutoLog(task, subtaskRecord, runStatus, summary, assistantContent);
  if (subtaskRecord) {
    appendLoopMainSubChatSubtaskFinished(task, subtaskRecord, runStatus, assistantContent);
  } else {
    refreshOpenLoopGroupChatPanelForTask(taskId);
  }
}

async function finalizeLoopSubtaskRun(options: LoopSubtaskCompletionOptions): Promise<void> {
  await finalizeLoopSubtaskRunWithDeps(options, {
    markSubtaskRunFinished: markLoopSubtaskRunFinished,
    closeSubtaskTab: closeConversationTabAndRefreshPanel,
    logSubtaskTabAutoClosed: ({ taskId, round, subtaskId, tabId }) => {
      void logInfo("loop-subtask-tab-auto-closed", {
        taskId,
        round,
        subtaskId,
        tabId,
      });
    },
  });
}

function buildLoopSubtaskCompletionSummary(content: string | null): string | undefined {
  const normalized = String(content ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 1000 ? `${normalized.slice(0, 1000)}...` : normalized;
}

function appendLoopSubtaskCompletionAutoLog(
  task: LoopTaskRecord,
  subtask: LoopSubtaskRecord | undefined,
  runStatus: TaskRunStatus,
  summary?: string,
  assistantContent?: string | null,
): void {
  const filePath = typeof subtask?.communicationFile === "string" && subtask.communicationFile.trim()
    ? subtask.communicationFile
    : null;
  if (!filePath || !subtask) {
    return;
  }

  let existingContent = "";
  try {
    if (fs.existsSync(filePath)) {
      existingContent = fs.readFileSync(filePath, "utf8");
    }
  } catch (error) {
    void logError("loop-subtask-communication-read-error", {
      taskId: task.id,
      subtaskId: subtask.id,
      filePath,
      error: String(error),
    });
  }

  const verification = detectLoopVerificationSignals(`${existingContent}\n${assistantContent ?? ""}`);
  const lines = [
    "",
    `## 扩展自动记录（${new Date().toISOString()}）`,
    `- 子任务 ID：${subtask.id}`,
    `- 子任务标题：${subtask.title}`,
    `- 运行状态：${runStatus === "end" ? "completed" : runStatus}`,
    `- 单测状态：${formatLoopVerificationState(verification.unitTest)}`,
    `- 编译状态：${formatLoopVerificationState(verification.build)}`,
  ];
  if (verification.unitTestEvidence) {
    lines.push(`- 单测依据：${verification.unitTestEvidence}`);
  }
  if (verification.buildEvidence) {
    lines.push(`- 编译依据：${verification.buildEvidence}`);
  }
  if (summary) {
    lines.push(`- 输出摘要：${summary}`);
  }
  if (verification.unitTest === "unknown" || verification.build === "unknown") {
    lines.push("- 备注：当前记录未明确声明全部验证结果，主任务复核时需重点确认。");
  }

  try {
    fs.appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    void logError("loop-subtask-communication-append-error", {
      taskId: task.id,
      subtaskId: subtask.id,
      filePath,
      error: String(error),
    });
  }
}

function markLoopTaskInterrupted(
  taskId: string,
  status: "error" | "stopped",
  target: PromptRunTarget,
  options: { source: "main" | "subtask"; failureMessage?: string | null } = { source: "main" }
): void {
  const existing = readLoopTaskRecord(taskId);
  if (existing && existing.status !== "running") {
    return;
  }
  const now = Date.now();
  const patch: Partial<LoopTaskRecord> = {
    status,
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: now,
  };
  if (options.source === "main" && status === "error") {
    Object.assign(patch, buildNextLoopMainAiFailureState(existing ?? {}, {
      now,
      failureMessage: options.failureMessage,
    }));
    if (isLoopMainAiFailureLimitReached({
      mainAiFailureCount: patch.mainAiFailureCount,
      mainAiFailureLimitReached: patch.mainAiFailureLimitReached,
    })) {
      patch.status = "needs-review";
      patch.finalSummary = [
        `主任务 AI 调用已连续失败 ${patch.mainAiFailureCount}/${LOOP_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`,
        options.failureMessage ? `最近一次失败：${options.failureMessage}` : "",
      ].filter(Boolean).join("\n");
    }
  }
  const record = updateLoopTaskRecord(taskId, patch) ?? existing;
  if (record) {
    appendSystemMessageForLoop(target, buildLoopTaskNeedsReviewText(record));
  }
}

function isLoopTaskExecutionInterrupted(taskId: string): boolean {
  const status = readLoopTaskRecord(taskId)?.status;
  return status === "needs-review" || status === "error" || status === "stopped";
}

function markLoopTaskStopped(
  taskId: string,
  options: {
    finalSummary?: string;
    subtaskSummary?: string;
    participantSummary?: string;
  } = {},
): LoopTaskRecord | null {
  const task = readLoopTaskRecord(taskId);
  if (!task || isLoopTaskCompleted(task)) {
    return task;
  }

  const now = Date.now();
  const activeSubtaskIds = new Set(getActiveLoopSubtaskIds(task));
  const subTasks = task.subTasks.map((subtask) => {
    const shouldStopSubtask = activeSubtaskIds.has(subtask.id)
      || subtask.status === "running"
      || subtask.status === "pending";
    if (!shouldStopSubtask) {
      return subtask;
    }
    return {
      ...subtask,
      status: "blocked" as const,
      ...(subtask.summary || options.subtaskSummary
        ? { summary: subtask.summary || options.subtaskSummary }
        : {}),
      updatedAt: now,
    };
  });
  const debateRounds = task.debateRounds?.map((round) => {
    const participants = round.participants.map((participant) => {
      if (participant.status !== "running" && participant.status !== "pending") {
        return participant;
      }
      return {
        ...participant,
        status: "stopped" as const,
        ...(participant.summary || options.participantSummary
          ? { summary: participant.summary || options.participantSummary }
          : {}),
        updatedAt: now,
      };
    });
    const shouldStopRound = round.status === "running"
      || Boolean(round.activeSpeaker)
      || round.participants.some((participant) => participant.status === "running" || participant.status === "pending");
    if (!shouldStopRound) {
      return { ...round, participants };
    }
    return {
      ...round,
      status: "stopped" as const,
      completedAt: round.completedAt ?? now,
      activeSpeaker: undefined,
      participants,
    };
  });

  const record = updateLoopTaskRecord(taskId, {
    status: "stopped",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    autoSleepStartedAt: undefined,
    autoWakeAt: undefined,
    autoSleepReason: undefined,
    subTasks,
    ...(debateRounds ? { debateRounds } : {}),
    ...(options.finalSummary ? { finalSummary: options.finalSummary } : {}),
    updatedAt: now,
  });
  refreshOpenLoopGroupChatPanelForTask(taskId);
  return record;
}

function markLoopTaskStoppedByUser(taskId: string): LoopTaskRecord | null {
  cancelLoopTaskAutoWake(taskId);
  return markLoopTaskStopped(taskId, {
    finalSummary: "用户已从 Loop 群聊中止任务。",
    subtaskSummary: "用户已从 Loop 群聊中止该子任务。",
    participantSummary: "用户已从 Loop 群聊中止该参与者任务。",
  });
}

function markLoopTaskStoppedAfterRuntimeEnded(taskId: string): LoopTaskRecord | null {
  const record = markLoopTaskStopped(taskId);
  if (record) {
    void logInfo("loop-task-runtime-state-reconciled", {
      taskId,
      previousStatus: "running",
      nextStatus: record.status,
    });
  }
  return record;
}

function resolvePromptRunTargetFromConversationTab(tab: ConversationTabRecord): PromptRunTarget {
  return {
    tabId: tab.id,
    cli: tab.cli,
    sessionId: getConversationTabSessionIdForCli(tab, tab.cli),
  };
}

function resolveLoopMainPromptTarget(task: LoopTaskRecord): PromptRunTarget | null {
  const state = ensureConversationTabs();
  let sessionFallback: ConversationTabRecord | null = null;
  for (const tab of state.tabs) {
    if (tab.cli !== task.cli) {
      continue;
    }
    const context = resolveConversationTabLoopContext(tab);
    if (context.taskRole === "main" && context.loopTaskId === task.id) {
      return resolvePromptRunTargetFromConversationTab(tab);
    }
    if (
      !sessionFallback
      && task.sessionId
      && getConversationTabSessionIdForCli(tab, tab.cli) === task.sessionId
    ) {
      sessionFallback = tab;
    }
  }
  if (sessionFallback) {
    return resolvePromptRunTargetFromConversationTab(sessionFallback);
  }

  const newTab: ConversationTabRecord = {
    id: createConversationTabId(),
    cli: task.cli,
    sessionId: task.sessionId ?? null,
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, task.cli, task.sessionId ?? null),
    createdAt: Date.now(),
  };
  state.tabs.push(newTab);
  persistConversationTabsToWorkspaceSettings();
  void postPanelState();
  return resolvePromptRunTargetFromConversationTab(newTab);
}

async function maybeWakeLoopMainAfterSubtaskContinuation(
  context: LoopSubtaskConversationContext,
  options: {
    tabId: string;
    previousRunEndedAt: number;
    model?: string;
    loopMainModel?: string;
    loopSubtaskModel?: string;
    loopMainThinkingMode?: ThinkingMode;
    loopSubtaskThinkingMode?: ThinkingMode;
  }
): Promise<void> {
  const latestRun = getLatestLoopRoundRunRecord(
    context.taskId,
    context.round,
    "subtask",
    context.subtaskId
  );
  if (!latestRun || latestRun.endedAt <= options.previousRunEndedAt || latestRun.status !== "end") {
    return;
  }

  const subtaskTarget = resolvePromptRunTarget(options.tabId);
  const summary = subtaskTarget
    ? getLastLoopAssistantContent(subtaskTarget, context.taskId, context.round, "subtask")
    : null;
  await finalizeLoopSubtaskRun({
    taskId: context.taskId,
    round: context.round,
    subtaskId: context.subtaskId,
    runStatus: "end",
    assistantContent: summary,
    tabId: subtaskTarget?.tabId ?? null,
  });

  const latestTask = readLoopTaskRecord(context.taskId);
  if (
    !latestTask
    || isLoopTaskBlockedByMainAiFailureLimit(latestTask)
    || (latestTask.status !== "error" && latestTask.status !== "stopped")
  ) {
    return;
  }

  const mainTarget = resolveLoopMainPromptTarget(latestTask);
  if (!mainTarget || isTabRunActive(mainTarget.tabId)) {
    return;
  }

  const resumedSubtask = latestTask.subTasks.find((item) => item.id === context.subtaskId);
  appendSystemMessageForLoop(
    mainTarget,
    buildLoopMainResumeText(latestTask.id, resolveLoopResumeRound(latestTask), resumedSubtask ? [resumedSubtask] : [])
  );

  const resumePrompt = t("run.hiddenContinuePrompt");
  await runLoopPrompt({
    displayPrompt: resumePrompt,
    modelPrompt: resumePrompt,
    contextTags: [],
    model: options.model,
    loopMainModel: options.loopMainModel,
    loopSubtaskModel: options.loopSubtaskModel,
    loopMainThinkingMode: options.loopMainThinkingMode,
    loopSubtaskThinkingMode: options.loopSubtaskThinkingMode,
  }, {
    targetTabId: mainTarget.tabId,
    resumeTaskId: latestTask.id,
    resumeRequested: true,
  });
}

function getLoopTargetSessionId(target: PromptRunTarget): string | null {
  const tab = getConversationTabById(target.tabId);
  return tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
}

function persistLoopMessagesForTarget(target: PromptRunTarget, messages: ChatMessage[]): void {
  const sessionId = getLoopTargetSessionId(target);
  persistMessagesForTab(target.cli, sessionId, target.tabId, messages);
}

function removeLoopMainDecisionMessage(
  target: PromptRunTarget,
  taskId: string,
  round: number,
): void {
  const messages = getLoopMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === "main"
      && message.loopTaskId === taskId
      && message.loopRound === round
    ) {
      messages.splice(index, 1);
      persistLoopMessagesForTarget(target, messages);
      sendPanelMessage({ type: "removeMessage", id: message.id, tabId: target.tabId });
      return;
    }
  }
}

function replaceLoopMainDecisionMessageWithMarkdown(
  target: PromptRunTarget,
  taskId: string,
  round: number,
  content: string,
): boolean {
  const messages = getLoopMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === "main"
      && message.loopTaskId === taskId
      && message.loopRound === round
    ) {
      const nextMessage: ChatMessage = {
        ...message,
        content,
        merge: false,
      };
      messages[index] = nextMessage;
      persistLoopMessagesForTarget(target, messages);
      sendPanelMessage({ type: "replaceMessage", message: nextMessage, tabId: target.tabId });
      return true;
    }
  }
  return false;
}

function showLoopSubtaskDecisionMarkdown(
  target: PromptRunTarget,
  task: LoopTaskRecord,
  round: number,
  subtasks: LoopSubtaskRecord[],
  decision: LoopMainDecision,
): void {
  const content = buildLoopSubtaskDecisionMarkdown(task, round, subtasks, decision);
  if (replaceLoopMainDecisionMessageWithMarkdown(target, task.id, round, content)) {
    return;
  }

  const messages = getLoopMessagesForTarget(target);
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    loopTaskId: task.id,
    loopRound: round,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function showLoopAutoSleepMessage(
  target: PromptRunTarget,
  task: LoopTaskRecord,
  round: number,
  decision: LoopMainDecision,
): void {
  const content = buildLoopAutoSleepMessageMarkdown(task, decision);
  if (replaceLoopMainDecisionMessageWithMarkdown(target, task.id, round, content)) {
    return;
  }

  const messages = getLoopMessagesForTarget(target);
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    loopTaskId: task.id,
    loopRound: round,
    actions: [buildLoopDebateChatMessageAction(task.id, round)],
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function buildLoopAutoSleepMessageMarkdown(task: LoopTaskRecord, decision: LoopMainDecision): string {
  const locale = resolveLocale();
  const wakeAt = typeof task.autoWakeAt === "number"
    ? new Date(task.autoWakeAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")
    : t("run.loopAutoWakeTimeUnknown");
  const reason = task.autoSleepReason ?? decision.sleepReason ?? t("run.loopAutoSleepReasonUnknown");
  return [
    `## ${t("run.loopAutoSleepTitle")}`,
    t("run.loopAutoSleepReason", { reason }),
    t("run.loopAutoWakeAt", { time: wakeAt }),
  ].join("\n\n");
}

function hasCompleteLoopCompletionMessagesForTask(target: PromptRunTarget, taskId: string): boolean {
  return hasCompleteLoopCompletionMessages(getLoopMessagesForTarget(target), taskId);
}

function appendLoopAnswerConclusionMessage(
  target: PromptRunTarget,
  task: LoopTaskRecord,
  decision?: LoopMainDecision | null,
): void {
  const messages = getLoopMessagesForTarget(target);
  const content = buildLoopAnswerConclusionMarkdown(task, decision);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!existing || !isLoopAnswerConclusionMessageForTask(existing, task.id)) {
      continue;
    }
    if (existing.content.trim() === content.trim()) {
      return;
    }
    const replacement: ChatMessage = {
      ...existing,
      content,
      merge: false,
      taskRole: "main",
      loopTaskId: task.id,
      loopAnswerConclusion: true,
    };
    messages[index] = replacement;
    sendPanelMessage({ type: "replaceMessage", message: replacement, tabId: target.tabId });
    persistLoopMessagesForTarget(target, messages);
    return;
  }
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    loopTaskId: task.id,
    loopAnswerConclusion: true,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function appendLoopFinalSummaryMessage(
  target: PromptRunTarget,
  task: LoopTaskRecord,
  decision?: LoopMainDecision | null,
): void {
  const messages = getLoopMessagesForTarget(target);
  const content = buildLoopFinalSummaryMarkdown(task, decision);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!existing || !isLoopFinalSummaryMessageForTask(existing, task.id)) {
      continue;
    }
    if (isCompleteLoopFinalSummaryContent(existing.content)) {
      return;
    }
    const replacement: ChatMessage = {
      ...existing,
      content,
      merge: false,
      taskRole: "main",
      loopTaskId: task.id,
      loopFinalSummary: true,
    };
    messages[index] = replacement;
    sendPanelMessage({ type: "replaceMessage", message: replacement, tabId: target.tabId });
    persistLoopMessagesForTarget(target, messages);
    return;
  }
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    loopTaskId: task.id,
    loopFinalSummary: true,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function appendGraphFinalSummaryMessage(target: PromptRunTarget, run: GraphRunRecord): void {
  const messages = getLoopMessagesForTarget(target);
  const content = buildGraphFinalSummaryMarkdown(run);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!existing || !isGraphFinalSummaryMessageForRun(existing, run.id)) {
      continue;
    }
    if (existing.content.trim() === content.trim()) {
      return;
    }
    const replacement: ChatMessage = {
      ...existing,
      content,
      merge: false,
      taskRole: "main",
      graphRunId: run.id,
      graphFinalSummary: true,
    };
    messages[index] = replacement;
    sendPanelMessage({ type: "replaceMessage", message: replacement, tabId: target.tabId });
    persistLoopMessagesForTarget(target, messages);
    return;
  }

  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    graphRunId: run.id,
    graphFinalSummary: true,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLoopMessagesForTarget(target, messages);
}

function isGraphFinalSummaryMessageForRun(message: ChatMessage, graphRunId: string): boolean {
  return message.role === "assistant"
    && message.graphFinalSummary === true
    && message.graphRunId === graphRunId;
}

function appendSystemMessageForLoop(
  target: PromptRunTarget,
  content: string,
  options: {
    taskRole?: LoopTaskRole;
    loopTaskId?: string;
    loopRound?: number;
    loopSubtaskId?: string;
    actions?: ChatMessageAction[];
    merge?: boolean;
  } = {},
): void {
  const tab = getConversationTabById(target.tabId);
  const sessionId = tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
  const messages = sessionId
    ? loadSessionMessages(target.cli, sessionId)
    : getPendingSessionDraft(target.tabId, target.cli).messages;
  const message: ChatMessage = {
    id: createMessageId(),
    role: "system",
    content,
    createdAt: Date.now(),
    ...(options.merge === false ? { merge: false } : {}),
    ...(options.taskRole ? { taskRole: options.taskRole } : {}),
    ...(options.loopTaskId ? { loopTaskId: options.loopTaskId } : {}),
    ...(typeof options.loopRound === "number" ? { loopRound: options.loopRound } : {}),
    ...(options.loopSubtaskId ? { loopSubtaskId: options.loopSubtaskId } : {}),
    ...(options.actions?.length ? { actions: options.actions } : {}),
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  if (sessionId) {
    persistMessagesForTab(target.cli, sessionId, target.tabId, messages);
    return;
  }
  // Keep loop pre-run system messages in draft only, so the first real turn can
  // start a fresh remote session instead of being blocked by a local-only session id.
  updatePendingSessionDraft(target.tabId, { messages }, target.cli);
}

function getLoopRoundRunStatus(
  taskId: string,
  round: number,
  role: LoopTaskRole,
  subtaskId?: string,
): TaskRunStatus | null {
  const record = getLatestLoopRoundRunRecord(taskId, round, role, subtaskId);
  return record ? record.status : null;
}

function getLatestLoopRoundRunRecord(
  taskId: string,
  round: number,
  role: LoopTaskRole,
  subtaskId?: string,
): TaskRunRecord | null {
  const runs = readTaskStore().runs;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (
      run.loopTaskId === taskId
      && run.loopRound === round
      && run.taskRole === role
      && (role !== "subtask" || run.loopSubtaskId === subtaskId)
    ) {
      return run;
    }
  }
  return null;
}

function isAutoContextCompactionCli(cli: CliName): cli is "codex" | "claude" | "opencode" {
  return cli === "codex" || cli === "claude" || cli === "opencode";
}

function preloadUserMessageForPrompt(input: PromptRunInput, target: PromptRunTarget): PromptRunInput {
  if (input.preloadedUserMessageId) {
    return input;
  }
  const createdAt = Date.now();
  const messageId = createMessageId();
  const message = buildUserChatMessage(input, createdAt, messageId);
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

  if (isTabRunActive(target.tabId)) {
    stopRunForTab(target.tabId);
  }

  scheduleLogRetentionCleanup();
  let promptInput = input;

  if (target.cli === "opencode") {
    promptInput = preloadUserMessageForPrompt(promptInput, target);
    const preflightMessage = await getOpenCodeConfigPreflightMessage();
    if (preflightMessage) {
      void logError("opencode-config-preflight-failed", {
        cli: target.cli,
        tabId: target.tabId,
        error: preflightMessage,
      });
      appendSystemMessageForPromptTarget(target, preflightMessage);
      sendRunStatusForTab(target.tabId, "error", { message: preflightMessage });
      return;
    }
  }

  const subtaskExecutionRoot = input.taskRole === "subtask" && !input.executionCwd
    ? (() => {
        const workspaceCwd = resolveWorkspaceCwd();
        return workspaceCwd ? createLoopSubtaskExecutionRoot(workspaceCwd) : null;
      })()
    : null;
  const shouldUseInteractive = isInteractiveSupported(target.cli);
  try {
    const executionOptions = {
      cwd: input.executionCwd ?? subtaskExecutionRoot?.cwd,
      isolateProjectInstructions: input.isolateProjectInstructions ?? Boolean(subtaskExecutionRoot),
    };
    if (shouldUseInteractive) {
      try {
        await runPromptInteractive(promptInput, target, executionOptions);
        return;
      } catch (error) {
        const info = getErrorInfo(error);
        if (isAbortErrorInfo(info)) {
          void logInfo("runPrompt-interactive-abort-ignored", {
            cli: target.cli,
            error: info.message,
            errorName: info.name,
            errorCode: info.code,
            errorStack: info.stack,
          });
          return;
        }
        void logError("runPrompt-interactive-failed", {
          cli: target.cli,
          error: info.message,
          errorName: info.name,
          errorCode: info.code,
          errorStack: info.stack,
        });
        if (promptInput.throwOnError) {
          throw error;
        }
        return;
      }
    }

    if (hasOtherTabRun(target.tabId)) {
      await runPromptParallel(promptInput, target, executionOptions);
      return;
    }

    await runPromptOneShot(promptInput, target, executionOptions);
  } finally {
    subtaskExecutionRoot?.dispose();
  }
}

async function runPromptOneShot(
  input: PromptRunInput,
  target: PromptRunTarget,
  executionOptions: { cwd?: string; isolateProjectInstructions?: boolean } = {},
): Promise<void> {
  const prompt = input.displayPrompt;
  const runCli = target.cli;
  if (runCli !== "opencode") {
    throw new Error(`one-shot-run-unsupported:${runCli}`);
  }
  const modelPrompt = input.modelPrompt || prompt;
  const contextTags = Array.isArray(input.contextTags)
    ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  if (!prompt) {
    return;
  }
  const cwd = executionOptions.cwd ?? resolveWorkspaceCwd();
  if (!cwd) {
    void logInfo("runPrompt-no-workspace", { cli: runCli });
  }
  const runtimePreparation = await prepareOpenCodeRuntime({
    role: input.taskRole === "subtask" ? "subtask" : "main",
    model: input.model ?? null,
    requiresSubtaskModel: Boolean(input.loopTaskId || input.graphRunId),
  });
  const runtimeModel = runtimePreparation.effectiveModel;
  const thinkingMode = input.thinkingModeOverride ?? getEffectiveThinkingMode(runCli, runtimeModel);
  applyThinkingWorkspaceFiles(runCli, thinkingMode, cwd);
  const runtimeEnvOverrides = runtimePreparation.envOverrides;
  const runtimeOpenCodeConfigContent = runtimePreparation.configContent;
  const activeTabId = target.tabId;
  const shouldAutoCompactAfterRun = shouldAutoCompactContextAfterRunForTarget(target);
  preparePendingLabel(runCli, activeTabId, prompt);
  const initialSessionId = target.sessionId;
  const initialRuntimeSessionId = resolveCliSessionIdForResume(runCli, initialSessionId);
  const includeFinalAnswerInstruction = !input.loopTaskId;
  const thinkingPrompt = buildThinkingPrompt(runCli, thinkingMode, modelPrompt, {
    includeFinalAnswerInstruction,
  });
  const hiddenRetryPrompt = buildHiddenRetryPrompt(runCli, thinkingMode, {
    includeFinalAnswerInstruction,
  });
  const debugLogging = getDebugLogging();
  const messageTarget = initialSessionId
    ? loadSessionMessages(runCli, initialSessionId)
    : getPendingSessionDraft(activeTabId, runCli).messages;
  const args = buildCliArgs(
    runCli,
    {
      sessionId: initialRuntimeSessionId,
      thinkingMode,
      openCodeVariant: runtimePreparation.effectiveVariant,
      openCodeSmallVariant: runtimePreparation.subtaskVariant,
      model: runtimeModel,
      openCodeConfigContent: runtimeOpenCodeConfigContent,
      envOverrides: runtimeEnvOverrides,
      isolateProjectInstructions: executionOptions.isolateProjectInstructions,
    },
    thinkingPrompt,
  );
  const command = getCliCommand(runCli);
  logCliStartup({
    cli: runCli,
    cwd,
    command,
    args: redactPromptArg(args, thinkingPrompt),
    env: sanitizeEnv({
      ...process.env,
      ...(runtimeEnvOverrides ?? {}),
      ...(cwd ? { PWD: cwd } : {}),
    }),
    mode: "one-shot",
  });
  void logInfo("runPrompt-start", {
    cli: runCli,
    command: getCliCommand(runCli),
    args,
    cwd,
    sessionId: initialSessionId,
    thinkingMode,
    modelRole: runtimePreparation.role,
    mainModel: runtimePreparation.mainModel,
    subtaskModel: runtimePreparation.subtaskModel,
    effectiveModel: runtimePreparation.effectiveModel,
    modelFallback: runtimePreparation.modelFallback,
    mainVariant: runtimePreparation.mainVariant,
    subtaskVariant: runtimePreparation.subtaskVariant,
    effectiveVariant: runtimePreparation.effectiveVariant,
  });

  const userMessageId = input.preloadedUserMessageId ?? createMessageId();
  const userCreatedAt = Date.now();
  const runId = createMessageId();
  activeRunId = runId;
  applyProcessTitle(runId, runCli, initialSessionId);
  startTaskRun(runId, runCli, initialSessionId, prompt, {
    taskRole: input.taskRole,
    loopTaskId: input.loopTaskId,
    loopRound: input.loopRound,
    loopSubtaskId: input.loopSubtaskId,
    graphRunId: input.graphRunId,
    graphNodeId: input.graphNodeId,
  });
  activeMessageTarget = messageTarget;
  activeSessionId = initialSessionId;
  activeCliForRun = runCli;
  activeTabIdForRun = activeTabId;
  if (!input.preloadedUserMessageId) {
    const userMessage = buildUserChatMessage(input, userCreatedAt, userMessageId);
    appendMessageToStore(messageTarget, userMessage);
    sendPanelMessage({
      type: "appendMessage",
      message: userMessage,
    });
  }

  activeAssistantMessageId = undefined;
  activeMessageIndex = null;
  startTraceMessage(runCli);
  activeTraceBuffer = "";
  activeTraceSegmentLines = [];
  resetTraceLineFilterState(activeTraceLineFilterState);
  activeCompletionSent = false;

  sendRunStatus("start");
  let hiddenRetryCount = 0;
  const isLoopMainRun = Boolean(input.loopTaskId && input.taskRole === "main");
  let freshSessionRecoveryPending = false;
  let freshSessionRecoveryAttempted = false;
  let silentProgressNoticeShown = false;
  let monitorUnavailableNoticeShown = false;

  const isCurrentOneShotRunActive = (): boolean => activeRunId === runId;
  const subagentProgress = createSubagentProgressController({
    labels: buildSubagentProgressLabels(),
    createMessageId,
    messageMetadata: {
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
    },
    appendMessage: (message) => {
      if (!activeMessageTarget || !isCurrentOneShotRunActive()) {
        return;
      }
      activeAssistantMessageId = undefined;
      activeMessageIndex = null;
      appendMessageToStore(activeMessageTarget, message);
      sendPanelMessage({ type: "appendMessage", message, tabId: activeTabId });
    },
    replaceMessage: (message) => {
      if (!activeMessageTarget || !isCurrentOneShotRunActive()) {
        return;
      }
      const index = activeMessageTarget.findIndex((item) => item.id === message.id);
      if (index < 0) {
        appendMessageToStore(activeMessageTarget, message);
        sendPanelMessage({ type: "appendMessage", message, tabId: activeTabId });
        return;
      }
      activeMessageTarget[index] = message;
      sendPanelMessage({ type: "replaceMessage", message, tabId: activeTabId });
    },
    appendDelta: (messageId, content) => {
      if (!isCurrentOneShotRunActive()) {
        return;
      }
      sendPanelMessage({
        type: "assistantDelta",
        id: messageId,
        content,
        tabId: activeTabId,
      });
    },
  });

  while (true) {
    const isFreshSessionRecoveryAttempt = freshSessionRecoveryPending;
    freshSessionRecoveryPending = false;
    if (isFreshSessionRecoveryAttempt) {
      freshSessionRecoveryAttempted = true;
    }
    const attemptNumber = hiddenRetryCount + 1;
    const attemptPrompt = isFreshSessionRecoveryAttempt || hiddenRetryCount === 0
      ? thinkingPrompt
      : hiddenRetryPrompt;
    let attemptHadNormalReply = false;

    if (hiddenRetryCount > 0) {
      const retryNumber = hiddenRetryCount;
      const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
      const shouldContinue = await waitForHiddenRetryDelay(retryNumber, isCurrentOneShotRunActive);
      if (!shouldContinue) {
        return;
      }
      if (isFreshSessionRecoveryAttempt) {
        appendSystemMessage(t("run.openCodeLoopFreshSessionRecoveryStarted"));
      }
      appendSystemMessage(buildHiddenRetryStartedMessage(retryNumber));
      void logInfo("runPrompt-one-shot-hidden-retry", {
        cli: runCli,
        runId,
        tabId: activeTabId,
        sessionId: activeSessionId,
        attempt: attemptNumber,
        retryCount: hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        retryDelayMs,
        freshSessionRecovery: isFreshSessionRecoveryAttempt,
      });
    }

    let sessionBuffer = "";
    let rawStdout = "";
    let rawStderr = "";
    const openCodeActivityTracker = createOpenCodeStreamActivityTracker();
    const runtimeSessionId = isFreshSessionRecoveryAttempt
      ? null
      : resolveCliSessionIdForResume(runCli, activeSessionId);
    const subagentRuntime = await prepareOpenCodeSubagentRuntime({
      cwd,
      runId,
      runtime: runtimePreparation,
      isolateProjectInstructions: executionOptions.isolateProjectInstructions,
    });
    if (subagentRuntime.error && !monitorUnavailableNoticeShown && isCurrentOneShotRunActive()) {
      monitorUnavailableNoticeShown = true;
      activeAssistantMessageId = undefined;
      activeMessageIndex = null;
      appendSystemMessage(t("run.openCodeSubagentMonitorUnavailable"));
    }
    void logInfo("runPrompt-one-shot-subagent-monitor-start", {
      cli: runCli,
      runId,
      tabId: activeTabId,
      sessionId: runtimeSessionId,
      endpointSource: subagentRuntime.endpointSource,
      serverPort: subagentRuntime.connection?.serverPort ?? null,
      pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
    });
    const attemptResult = await new Promise<
      { type: "exit"; code: number | null }
      | { type: "error"; error: Error }
    >((resolve) => {
      let settled = false;
      let startupTimeoutHandle: NodeJS.Timeout | null = null;
      let sawOpenCodeActivity = false;
      const subagentMonitor = subagentRuntime.connection
        ? createOpenCodeSubagentMonitor({
            connection: subagentRuntime.connection,
            directory: cwd ?? process.cwd(),
            onUpdate: (update) => {
              if (isCurrentOneShotRunActive()) {
                sawOpenCodeActivity = true;
                refreshStartupTimeout();
                subagentProgress.update(update);
              }
            },
            onNoChildren: () => {
              if (silentProgressNoticeShown || !isCurrentOneShotRunActive()) {
                return;
              }
              silentProgressNoticeShown = true;
              activeAssistantMessageId = undefined;
              activeMessageIndex = null;
              appendSystemMessage(t("run.openCodeSubagentPollEmpty"));
              void logInfo("runPrompt-one-shot-subagent-poll-empty", {
                cli: runCli,
                runId,
                tabId: activeTabId,
                sessionId: activeSessionId,
                attempt: attemptNumber,
                pollIntervalMs: OPENCODE_SUBAGENT_POLL_INTERVAL_MS,
              });
            },
            onError: (error) => {
              void logDebug("runPrompt-one-shot-subagent-monitor-error", {
                cli: runCli,
                runId,
                tabId: activeTabId,
                sessionId: activeSessionId,
                attempt: attemptNumber,
                error: error.message,
              });
            },
          })
        : createDisabledOpenCodeSubagentMonitor();
      const settle = (result: { type: "exit"; code: number | null } | { type: "error"; error: Error }): void => {
        if (settled) {
          return;
        }
        settled = true;
        subagentMonitor.finish(
          result.type === "exit" && result.code === 0 ? "completed" : "failed",
        );
        subagentRuntime.dispose();
        if (startupTimeoutHandle) {
          clearTimeout(startupTimeoutHandle);
          startupTimeoutHandle = null;
        }
        resolve(result);
      };
      const refreshStartupTimeout = (): void => {
        if (startupTimeoutHandle) {
          clearTimeout(startupTimeoutHandle);
          startupTimeoutHandle = null;
        }
        const timeoutMs = resolveOpenCodeOneShotWatchdogTimeoutMs(sawOpenCodeActivity);
        if (timeoutMs === null) {
          return;
        }
        startupTimeoutHandle = setTimeout(() => {
          startupTimeoutHandle = null;
          const activity = openCodeActivityTracker.snapshot();
          const hasCurrentActivity = activity.hasAssistantAnswer
            || activity.hasError
            || activity.hasStatus
            || activity.hasProgress;
          if (hasCurrentActivity) {
            sawOpenCodeActivity = true;
            return;
          }
          const error = new Error(buildOpenCodeOneShotStartupTimeoutMessage(timeoutMs));
          if (!isCurrentOneShotRunActive()) {
            settle({ type: "error", error });
            return;
          }
          void logError("runPrompt-one-shot-idle-timeout", {
            cli: runCli,
            runId,
            tabId: activeTabId,
            sessionId: activeSessionId,
            attempt: attemptNumber,
            retryCount: hiddenRetryCount,
            timeoutMs,
            stdoutLength: rawStdout.length,
            stderrLength: rawStderr.length,
          });
          activeProcess?.kill();
          settle({ type: "error", error });
        }, timeoutMs);
      };
      refreshStartupTimeout();
      activeProcess = runCliStream(
        runCli,
        attemptPrompt,
        {
          onStdout: (chunk: string) => {
            if (!isCurrentOneShotRunActive()) {
              return;
            }
            rawStdout = appendBoundedUtf8Text(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
            const activity = openCodeActivityTracker.updateStdout(chunk);
            if (activity.hasAssistantAnswer || activity.hasError || activity.hasStatus || activity.hasProgress) {
              sawOpenCodeActivity = true;
            }
            refreshStartupTimeout();
            sendRawStreamDelta(chunk, { stream: "stdout" });
            appendOpenCodeJsonlEvents(chunk);
            sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
            captureSessionFromBuffer(runCli, sessionBuffer);
            subagentMonitor.setParentSessionId(extractSessionId(runCli, sessionBuffer));
            if (activity.hasAssistantAnswer) {
              attemptHadNormalReply = true;
            }
            if (debugLogging) {
              void logCliStream(runCli, activeSessionId, "stdout", chunk);
            }
          },
          onStderr: (chunk: string) => {
            if (!isCurrentOneShotRunActive()) {
              return;
            }
            rawStderr = appendBoundedUtf8Text(rawStderr, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
            const activity = openCodeActivityTracker.updateStderr(chunk);
            if (activity.hasAssistantAnswer || activity.hasError || activity.hasStatus || activity.hasProgress) {
              sawOpenCodeActivity = true;
            }
            refreshStartupTimeout();
            sendRawStreamDelta(chunk, { stream: "stderr" });
            sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
            captureSessionFromBuffer(runCli, sessionBuffer);
            subagentMonitor.setParentSessionId(extractSessionId(runCli, sessionBuffer));
            appendTraceLines(chunk);
            if (debugLogging) {
              void logCliStream(runCli, activeSessionId, "stderr", chunk);
            }
          },
          onExit: (code: number | null) => {
            settle({ type: "exit", code });
          },
          onError: (error: Error) => {
            settle({ type: "error", error });
          },
        },
        {
          cwd,
          sessionId: runtimeSessionId,
          thinkingMode,
          openCodeVariant: runtimePreparation.effectiveVariant,
          openCodeSmallVariant: runtimePreparation.subtaskVariant,
          model: runtimeModel,
          openCodeSmallModel: runtimePreparation.subtaskModel,
          openCodeConfigContent: runtimeOpenCodeConfigContent,
          envOverrides: runtimeEnvOverrides,
          isolateProjectInstructions: executionOptions.isolateProjectInstructions,
          openCodeServerUrl: subagentRuntime.connection?.serverUrl,
          processLabel: buildProcessLabel(runCli, runtimeSessionId ?? runId),
        }
      );
      subagentMonitor.setParentSessionId(runtimeSessionId);
    });

    if (activeRunId !== runId) {
      return;
    }
    const finalActivity = openCodeActivityTracker.flush();
    if (finalActivity.hasAssistantAnswer) {
      attemptHadNormalReply = true;
    }

    if (debugLogging) {
      void logCliRaw(runCli, activeSessionId, {
        command,
        args,
        cwd,
        exitCode: attemptResult.type === "exit" ? attemptResult.code : null,
        error: attemptResult.type === "error" ? attemptResult.error.message : undefined,
        stdin: attemptPrompt,
        stdout: rawStdout,
        raw: rawStdout,
        stderr: rawStderr,
      });
    }

    if (attemptResult.type === "exit" && attemptResult.code === 0) {
      const detectedSessionId = extractSessionId(runCli, `${rawStdout}
${rawStderr}`);
      if (
        isFreshSessionRecoveryAttempt
        && isLoopMainRun
        && detectedSessionId
        && detectedSessionId !== activeSessionId
        && input.loopTaskId
      ) {
        const previousSessionId = activeSessionId;
        activeMessageTarget = adoptFreshOpenCodeLoopRecoverySession({
          sessionId: detectedSessionId,
          previousSessionId,
          tabId: activeTabId,
          messageTarget: activeMessageTarget ?? messageTarget,
          loopTaskId: input.loopTaskId,
        });
        activeSessionId = detectedSessionId;
      }
      const finalSessionId = activeSessionId;
      const durationMs = activeTaskRun?.id === runId
        ? Math.max(0, Date.now() - activeTaskRun.startedAt)
        : null;
      void logInfo("runPrompt-exit", { cli: runCli, code: attemptResult.code });
      flushOpenCodeJsonlBuffer();
      flushTraceBuffer();
      const finalMessageTarget = activeMessageTarget ?? messageTarget;
      const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
      if (openCodeOutput.finalText) {
        appendOpenCodeFinalText(openCodeOutput.finalText);
      }
      const conversationHasFinalConclusion = hasAssistantFinalConclusionAfterMessage(finalMessageTarget, userMessageId, {
        observedFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
        fallbackCreatedAt: userCreatedAt,
        requireExplicitFinalAnswer: shouldRequireExplicitFinalAnswerForRun(input),
      });
      const currentAttemptHasAssistantAnswer = attemptHadNormalReply || Boolean(openCodeOutput.finalText?.trim());
      const successfulExitOutcome = resolveOpenCodeSuccessfulExitOutcome({
        isLoopRun: Boolean(input.loopTaskId),
        currentAttemptHasAssistantAnswer,
        conversationHasFinalConclusion,
        hiddenRetryCount,
        maxHiddenRetries: HIDDEN_RETRY_MAX_RETRIES,
      });
      if (successfulExitOutcome !== "complete") {
        const missingConclusionMessage = buildOpenCodeMissingFinalConclusionMessage(openCodeOutput);
        if (successfulExitOutcome === "retry") {
          const shouldRecoverFreshSession = shouldRecoverOpenCodeLoopMainSessionInFreshSession({
            isLoopMainRun,
            hasResumableSession: Boolean(resolveCliSessionIdForResume(runCli, activeSessionId)),
            hasProviderError: Boolean(openCodeOutput.errorText),
            freshSessionRecoveryAttempted,
          });
          void logInfo("runPrompt-one-shot-missing-final-conclusion-retry", {
            cli: runCli,
            runId,
            tabId: activeTabId,
            sessionId: activeSessionId,
            taskRole: input.taskRole,
            loopTaskId: input.loopTaskId,
            loopRound: input.loopRound,
            attempt: hiddenRetryCount + 1,
            retryCount: hiddenRetryCount,
            maxRetries: HIDDEN_RETRY_MAX_RETRIES,
            conversationHasFinalConclusion,
            currentAttemptHasAssistantAnswer,
            structuredFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
            stdoutLength: rawStdout.length,
            stderrLength: rawStderr.length,
            freshSessionRecoveryQueued: shouldRecoverFreshSession,
          });
          if (shouldRecoverFreshSession) {
            freshSessionRecoveryPending = true;
            appendSystemMessage(t("run.openCodeLoopFreshSessionRecoveryQueued"));
          } else {
            appendHiddenRetryErrorTraceMessage(finalMessageTarget, missingConclusionMessage, {
              taskRole: input.taskRole,
              loopTaskId: input.loopTaskId,
              loopRound: input.loopRound,
              loopSubtaskId: input.loopSubtaskId,
            }, { createMessageId, sendPanelMessage });
          }
          appendSystemMessage(buildHiddenRetryQueuedMessage(hiddenRetryCount));
          hiddenRetryCount += 1;
          continue;
        }
        void logError("runPrompt-one-shot-missing-final-conclusion", {
          cli: runCli,
          runId,
          tabId: activeTabId,
          sessionId: activeSessionId,
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          hiddenRetryCount,
          conversationHasFinalConclusion,
          currentAttemptHasAssistantAnswer,
          structuredFinalAnswer: openCodeOutput.hasStructuredFinalAnswer,
          stdoutLength: rawStdout.length,
          stderrLength: rawStderr.length,
        });
        const userMessageText = buildHiddenRetryFailureMessage({
          hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryLimitMessage: buildHiddenRetryLimitMessage(),
          fallbackMessage: missingConclusionMessage,
          lastFailureMessage: missingConclusionMessage,
          lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
        });
        sendRunStatus("error", userMessageText);
        appendSystemMessage(userMessageText);
        appendCompletionMessage("error");
        persistActiveMessages();
        clearActiveRun();
        return;
      }
      sendRunStatus("end");
      appendCompletionMessage("end");
      persistActiveMessages();
      maybePersistLongTermMemoryFromRun({
        status: "end",
        cli: runCli,
        prompt,
        messages: activeMessageTarget ?? messageTarget,
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
        skip: input.skipLongTermMemoryPersist,
      });
      clearActiveRun();
      if (shouldAutoCompactAfterRun) {
        await maybeAutoCompactContextAfterPromptSuccess(target, finalSessionId, durationMs);
      }
      return;
    }

    hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
    const openCodeOutput = parseOpenCodeRunOutput(rawStdout, rawStderr);
    const retryFailureMessage = buildOpenCodeFailureMessage(
      openCodeOutput,
      getAttemptFailureMessage(attemptResult, rawStderr || null),
    );
    const shouldRetry = hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
      && isHiddenRetryEligibleAttempt(attemptResult, retryFailureMessage);
    if (shouldRetry) {
      appendHiddenRetryErrorTraceMessage(activeMessageTarget, retryFailureMessage, {
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      }, { createMessageId, sendPanelMessage });
      appendSystemMessage(buildHiddenRetryQueuedMessage(hiddenRetryCount));
      hiddenRetryCount += 1;
      continue;
    }

    if (attemptResult.type === "error") {
      const error = attemptResult.error;
      const errnoError = error as NodeJS.ErrnoException;
      const isNotFound = errnoError?.code === "ENOENT";
      const rawUserMessage = isNotFound
        ? buildCliCommandNotFoundMessage(runCli, command, process.platform, t)
        : error.message;
      const userMessage = buildHiddenRetryFailureMessage({
        hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        retryLimitMessage: buildHiddenRetryLimitMessage(),
        fallbackMessage: rawUserMessage,
        lastFailureMessage: rawUserMessage,
        lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
      });
      if (isNotFound) {
        const openSettingsLabel = t("common.openSettings");
        void vscode.window.showErrorMessage(userMessage, openSettingsLabel).then((selection) => {
          if (selection === openSettingsLabel) {
            void vscode.commands.executeCommand(
              "workbench.action.openSettings",
              `sinitek-cli-tools.commands.${runCli}`
            );
          }
        });
      }
      void logError("runPrompt-error", {
        cli: runCli,
        error: isNotFound ? `${error.message} (ENOENT)` : error.message,
      });
      sendRunStatus("error", userMessage);
      appendSystemMessage(userMessage);
    } else {
      void logInfo("runPrompt-exit", { cli: runCli, code: attemptResult.code });
      const lastFailureMessage = rawStderr.trim()
        ? rawStderr.trim()
        : t("run.exitCode", { code: attemptResult.code ?? "unknown" });
      const finalFailureMessage = buildOpenCodeFailureMessage(openCodeOutput, lastFailureMessage);
      const userMessage = buildHiddenRetryFailureMessage({
        hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        retryLimitMessage: buildHiddenRetryLimitMessage(),
        fallbackMessage: finalFailureMessage,
        lastFailureMessage: finalFailureMessage,
        lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
      });
      void logError("runPrompt-opencode-final-failure", {
        cli: runCli,
        code: attemptResult.code,
        hiddenRetryCount,
        errorText: openCodeOutput.errorText,
        statusText: openCodeOutput.statusText,
        stdoutLength: rawStdout.length,
        stderrLength: rawStderr.length,
      });
      sendRunStatus("error", userMessage);
      appendSystemMessage(userMessage);
    }

    flushOpenCodeJsonlBuffer();
    flushTraceBuffer();
    appendCompletionMessage("error");
    persistActiveMessages();
    clearActiveRun();
    return;
  }
}

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
  if (!activeMessageTarget) {
    return;
  }
  if (!content.trim()) {
    return;
  }
  const { content: displayContent, shouldPersist } = normalizeTraceContentForDisplay(content, activeCliForRun);
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
    appendMessageToStore(activeMessageTarget, message);
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

function appendOpenCodeFinalText(finalText: string): void {
  const displayedText = activeOpenCodeDisplayedFinalText?.trim() ?? "";
  if (displayedText && finalText === displayedText) {
    activeOpenCodeDisplayedFinalText = finalText;
    return;
  }
  if (displayedText && finalText.startsWith(displayedText)) {
    const remainingText = finalText.slice(displayedText.length).trim();
    if (remainingText) {
      appendAssistantChunk(`${remainingText}\n`);
    }
    activeOpenCodeDisplayedFinalText = finalText;
    return;
  }
  appendAssistantChunk(`${finalText}\n`);
  activeOpenCodeDisplayedFinalText = finalText;
}

function appendOpenCodeJsonlEvents(chunk: string): boolean {
  let hasVisibleEvent = false;
  activeOpenCodeJsonlBuffer = consumeOpenCodeJsonlChunk(
    activeOpenCodeJsonlBuffer,
    chunk,
    false,
    (event) => {
      hasVisibleEvent = true;
      appendOpenCodeVisibleEvent(event);
    },
  );
  return hasVisibleEvent;
}

function flushOpenCodeJsonlBuffer(): void {
  activeOpenCodeJsonlBuffer = consumeOpenCodeJsonlChunk(
    activeOpenCodeJsonlBuffer,
    "",
    true,
    appendOpenCodeVisibleEvent,
  );
}

function consumeOpenCodeJsonlChunk(
  currentBuffer: string,
  chunk: string,
  flush: boolean,
  onEvent: (event: OpenCodeVisibleStreamEvent) => void,
): string {
  const combined = currentBuffer + chunk.replace(/\r\n/g, "\n");
  const lines = combined.split("\n");
  const pendingLine = flush ? "" : (lines.pop() ?? "");
  const nextBuffer = appendBoundedUtf8Text("", pendingLine, OPENCODE_JSONL_PENDING_LINE_MAX_BYTES).text;
  lines.forEach((line) => {
    parseOpenCodeVisibleStreamEvents(line).forEach(onEvent);
  });
  return nextBuffer;
}

function appendOpenCodeVisibleEvent(event: OpenCodeVisibleStreamEvent): void {
  if (Array.isArray(event.taskListItems)) {
    sendOpenCodeTaskListUpdate(event.taskListItems, { source: "primary-stream" });
  }
  if (event.kind === "assistant") {
    appendAssistantChunk(event.content);
    activeOpenCodeDisplayedFinalText = `${activeOpenCodeDisplayedFinalText ?? ""}${event.content}`;
    return;
  }
  if (event.kind === "thinking") {
    appendTraceMessage(event.content, "thinking");
    return;
  }
  appendTraceMessage(event.content, "tool-use", {
    merge: false,
    forceTraceBubble: true,
    taskListItems: event.taskListItems,
  });
}

function appendSystemMessage(content: string): void {
  if (!activeMessageTarget) {
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
  appendMessageToStore(activeMessageTarget, message);
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

async function runContextCompaction(options: ContextCompactionOptions = {}): Promise<boolean> {
  return runContextCompactionWithDeps({
    getCurrentCli: () => currentCli,
    getActiveConversationTabId,
    isInteractiveSupported,
    appendSystemMessageForCli,
    getCurrentSessionId,
    hasActiveProcessOrInteractiveStop: () => Boolean(activeProcess || activeInteractiveStop),
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
      activeRunId = runId;
      applyProcessTitle(runId, cli, sessionId);
      startTaskRun(runId, cli, sessionId, t("common.compactContext"));
      activeMessageTarget = messageTarget;
      activeSessionId = sessionId;
      activeCliForRun = cli;
      activeTabIdForRun = tabId;
    },
    getActiveRunId: () => activeRunId,
    setActiveInteractiveStop: (stop) => {
      activeInteractiveStop = stop;
    },
    isActiveInteractiveStop: (stop) => activeInteractiveStop === stop,
    appendStopMessageToStore,
    killActiveProcess: () => {
      activeProcess?.kill();
    },
    sendRunStatus,
    appendCompletionMessage,
    persistActiveMessages,
    clearActiveRun,
    interactiveRunnerManager,
    resolveInteractiveMappedId,
    appendSystemMessage,
    getGlobalMultiAgentEnabled,
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
      activeProcess = process;
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

async function maybeAutoCompactContextAfterPromptSuccess(
  target: PromptRunTarget,
  sessionId: string | null,
  durationMs: number | null | undefined,
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
  const compacted = await runContextCompaction({
    silent: true,
    cli: target.cli,
    tabId: target.tabId,
    sessionId,
  });
  void logInfo("auto-context-compact-after-run-finished", {
    cli: target.cli,
    tabId: target.tabId,
    sessionId,
    compacted,
  });
}

async function runContextCompactionCommand(): Promise<void> {
  await runContextCompaction();
}

async function runPromptInteractive(
  input: PromptRunInput,
  target: PromptRunTarget,
  executionOptions: { cwd?: string; isolateProjectInstructions?: boolean } = {},
): Promise<void> {
  const prompt = input.displayPrompt;
  const modelPrompt = input.modelPrompt || prompt;
  const contextTags = Array.isArray(input.contextTags)
    ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  if (!prompt) {
    return;
  }

  const cli = target.cli;
  const cwd = executionOptions.cwd ?? resolveWorkspaceCwd();
  const activeConfigId = getActiveConfigIdForCli(cli);
  const selectedModel = input.model || getSelectedCliModel(cli, activeConfigId);
  const thinkingMode = input.thinkingModeOverride ?? getEffectiveThinkingMode(cli, selectedModel);
  const interactiveMode = getWorkspaceInteractiveMode(cli);
  applyThinkingWorkspaceFiles(cli, thinkingMode, cwd);

  const tabId = target.tabId;
  const shouldAutoCompactAfterRun = shouldAutoCompactContextAfterRunForTarget(target);
  const resolvedSessionId = await resolveInteractiveSessionForResume(cli, target.sessionId, tabId);
  if (resolvedSessionId === undefined) {
    return;
  }
  preparePendingLabel(cli, tabId, prompt);

  let uiSessionId = resolvedSessionId;
  let messageTarget = uiSessionId
    ? loadSessionMessages(cli, uiSessionId)
    : getPendingSessionDraft(tabId, cli).messages;

  const includeFinalAnswerInstruction = !input.loopTaskId;
  const thinkingPrompt = buildThinkingPrompt(cli, thinkingMode, modelPrompt, {
    includeSuffix: false,
    includeFinalAnswerInstruction,
  });
  const hiddenRetryPrompt = buildHiddenRetryPrompt(cli, thinkingMode, {
    includeFinalAnswerInstruction,
  });
  const debugLogging = getDebugLogging();
  const args = cli === "codex" || executionOptions.isolateProjectInstructions
    ? buildCliArgs(cli, {
        thinkingMode,
        model: selectedModel,
        imagePaths: input.imagePaths,
        isolateProjectInstructions: executionOptions.isolateProjectInstructions,
      })
    : getEffectiveCliArgs(cli, selectedModel);
  const command = getCliCommand(cli);
  const resolvedCommand = cli === "claude" ? resolveCliCommand(command) : null;
  const commandForRunner = cli === "claude"
    ? (resolvedCommand?.command ?? "claude")
    : command;
  const claudeEntrypoint = cli === "claude"
    ? resolveClaudeInteractiveEntrypoint(resolvedCommand?.command ?? commandForRunner)
    : undefined;

  logCliStartup({
    cli,
    cwd,
    command: commandForRunner,
    args,
    env: sanitizeEnv(process.env),
    mode: "interactive",
  });
  void logInfo("runPrompt-interactive-start", {
    cli,
    sessionId: uiSessionId,
    thinkingMode,
    interactiveMode,
    model: selectedModel,
    configId: activeConfigId,
    cwd,
    promptLength: prompt.length,
    modelPromptLength: modelPrompt.length,
    imagePaths: input.imagePaths ?? [],
    tabId,
  });

  const userMessageId = input.preloadedUserMessageId ?? createMessageId();
  const userCreatedAt = Date.now();
  const runId = createMessageId();
  const startedAt = Date.now();
  const processSessionId = uiSessionId ?? runId;
  applyProcessTitle(runId, cli, processSessionId);

  let assistantMessageId: string | undefined;
  let assistantMessageIndex: number | null = null;
  let completionSent = false;
  let interactiveInput = thinkingPrompt;
  let rawStdout = "";
  let rawStderr = "";
  let didLogInteractiveIo = false;
  let didLogInteractiveStart = false;
  let stopCurrentTurn: (() => void) | null = null;
  let hiddenRetryCount = 0;
  let observedCodexFinalAnswer = false;

  const syncInteractiveRunEntry = (stop?: () => void): void => {
    const entry = interactiveRunsByTabId.get(tabId);
    if (!entry || entry.runId !== runId) {
      return;
    }
    entry.sessionId = uiSessionId;
    entry.messageTarget = messageTarget;
    if (stop) {
      entry.stop = stop;
    }
  };

  const isCurrentRunActive = (): boolean => {
    const entry = interactiveRunsByTabId.get(tabId);
    return Boolean(entry && entry.runId === runId && !entry.stopped);
  };

  const startInteractiveLog = (input: string): void => {
    if (!debugLogging || didLogInteractiveStart) {
      return;
    }
    didLogInteractiveStart = true;
    interactiveInput = input;
    rawStdout = "";
    rawStderr = "";
    void logCliInteractiveStart(cli, uiSessionId, {
      command: commandForRunner,
      args,
      cwd,
      stdin: input,
      resolvedCommand: cli === "claude" ? resolvedCommand?.command : undefined,
      resolvedFrom: cli === "claude" ? resolvedCommand?.resolvedFrom : undefined,
      execPath: cli === "claude" ? process.execPath : undefined,
      entrypoint: claudeEntrypoint,
    });
  };

  const appendDebugStdout = (chunk: string): void => {
    if (!debugLogging) {
      return;
    }
    rawStdout = appendBoundedUtf8Text(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
    startInteractiveLog(interactiveInput);
    void logCliInteractiveOutput(cli, uiSessionId, "stdout", chunk);
  };

  const appendTraceLog = (content: string): void => {
    if (!debugLogging || !content.trim()) {
      return;
    }
    const normalized = content.endsWith("\n") ? content : content + "\n";
    rawStderr = appendBoundedUtf8Text(rawStderr, normalized, AI_TASK_RAW_OUTPUT_MAX_BYTES).text;
    startInteractiveLog(interactiveInput);
    void logCliInteractiveOutput(cli, uiSessionId, "trace", normalized);
  };

  const appendDebugEvent = (event: unknown): void => {
    if (!debugLogging) {
      return;
    }
    let text = "";
    if (typeof event === "string") {
      text = event;
    } else {
      try {
        text = JSON.stringify(event);
      } catch {
        text = String(event);
      }
    }
    if (!text.trim()) {
      return;
    }
    startInteractiveLog(interactiveInput);
    void logCliInteractiveOutput(cli, uiSessionId, "event", text);
  };

  const logInteractiveIo = (status: TaskRunStatus, userMessage?: string): void => {
    if (!debugLogging || didLogInteractiveIo) {
      return;
    }
    didLogInteractiveIo = true;
    void logCliRaw(cli, uiSessionId, {
      command,
      args,
      cwd,
      exitCode: status === "end" ? 0 : null,
      error: status === "error" ? userMessage : undefined,
      stdin: interactiveInput,
      stdout: rawStdout,
      raw: rawStdout,
      stderr: rawStderr,
    });
  };

  const beginInteractiveAttempt = (input: string): void => {
    didLogInteractiveStart = false;
    didLogInteractiveIo = false;
    interactiveInput = input;
    rawStdout = "";
    rawStderr = "";
    startInteractiveLog(input);
  };

  const appendMessageForTab = (message: ChatMessage): void => {
    appendMessageToStore(messageTarget, message);
    sendPanelMessage({ type: "appendMessage", message, tabId });
    syncInteractiveRunEntry();
    schedulePersistForInteractiveRun();
  };

  let persistTimer: NodeJS.Timeout | null = null;

  const persistMessagesForInteractiveRun = (): void => {
    persistMessagesForTab(cli, uiSessionId, tabId, messageTarget);
    syncInteractiveRunEntry();
  };

  const flushPersistForInteractiveRun = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistMessagesForInteractiveRun();
  };

  const schedulePersistForInteractiveRun = (): void => {
    if (persistTimer) {
      return;
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistMessagesForInteractiveRun();
    }, 200);
  };

  const subagentProgress = createSubagentProgressController({
    labels: buildSubagentProgressLabels(),
    createMessageId,
    messageMetadata: {
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
    },
    appendMessage: appendMessageForTab,
    replaceMessage: (message) => {
      const index = messageTarget.findIndex((item) => item.id === message.id);
      if (index < 0) {
        appendMessageForTab(message);
        return;
      }
      messageTarget[index] = message;
      sendPanelMessage({ type: "replaceMessage", message, tabId });
      syncInteractiveRunEntry();
      schedulePersistForInteractiveRun();
    },
    appendDelta: (messageId, content) => {
      sendPanelMessage({
        type: "assistantDelta",
        id: messageId,
        content,
        tabId,
      });
      syncInteractiveRunEntry();
      schedulePersistForInteractiveRun();
    },
  });

  const refreshMessageTargetFromSession = (): void => {
    if (!uiSessionId) {
      return;
    }
    messageTarget = loadSessionMessages(cli, uiSessionId);
    if (assistantMessageId) {
      const nextIndex = messageTarget.findIndex((message) => message.id === assistantMessageId);
      assistantMessageIndex = nextIndex >= 0 ? nextIndex : null;
    }
    syncInteractiveRunEntry();
  };

  const normalizeAssistantKindForTab = (kind?: ChatMessage["kind"]): "thinking" | "normal" => (
    kind === "thinking" ? "thinking" : "normal"
  );

  const hasSameAssistantKindForTab = (message: ChatMessage | undefined, kind?: ChatMessage["kind"]): boolean => {
    return normalizeAssistantKindForTab(message?.kind) === normalizeAssistantKindForTab(kind);
  };

  const ensureAssistantMessage = (
    kind?: ChatMessage["kind"],
    options: { forceNew?: boolean; codexFinalAnswer?: boolean } = {}
  ): void => {
    const last = messageTarget[messageTarget.length - 1];
    if (
      options.forceNew !== true
      && assistantMessageId
      && last
      && last.role === "assistant"
      && last.id === assistantMessageId
      && hasSameAssistantKindForTab(last, kind)
    ) {
      return;
    }
    assistantMessageId = createMessageId();
    const message: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      ...(kind === "thinking" ? { kind: "thinking" } : {}),
      ...(options.codexFinalAnswer === true ? { codexFinalAnswer: true } : {}),
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
    };
    appendMessageToStore(messageTarget, message);
    assistantMessageIndex = messageTarget.length - 1;
    sendPanelMessage({ type: "appendMessage", message, tabId });
    syncInteractiveRunEntry();
  };

  const appendAssistantChunkForTab = (
    chunk: string,
    kind?: ChatMessage["kind"],
    options: { codexFinalAnswer?: boolean } = {}
  ): void => {
    const marksCodexFinalAnswer = options.codexFinalAnswer === true;
    if (!chunk && !marksCodexFinalAnswer) {
      return;
    }
    const last = messageTarget[messageTarget.length - 1];
    const forceNewFinalAnswer = Boolean(
      marksCodexFinalAnswer
      && chunk
      && last
      && last.role === "assistant"
      && last.id === assistantMessageId
      && last.codexFinalAnswer !== true
      && String(last.content || "").trim()
    );
    if (chunk) {
      ensureAssistantMessage(kind, {
        forceNew: forceNewFinalAnswer,
        codexFinalAnswer: marksCodexFinalAnswer,
      });
    }
    if (!assistantMessageId || assistantMessageIndex === null) {
      return;
    }
    const message = messageTarget[assistantMessageIndex];
    if (!message || message.role !== "assistant") {
      return;
    }
    if (marksCodexFinalAnswer) {
      message.codexFinalAnswer = true;
    }
    if (kind === "thinking") {
      message.kind = "thinking";
    }
    if (chunk) {
      message.content += chunk;
    }
    sendPanelMessage({
      type: "assistantDelta",
      id: assistantMessageId,
      content: chunk,
      kind,
      tabId,
      ...(marksCodexFinalAnswer ? { codexFinalAnswer: true } : {}),
    });
    syncInteractiveRunEntry();
    schedulePersistForInteractiveRun();
  };

  const removeAssistantPlaceholderForTab = (): boolean => {
    if (assistantMessageIndex === null) {
      return false;
    }
    const message = messageTarget[assistantMessageIndex];
    if (!message || message.role !== "assistant") {
      return false;
    }
    if (message.content.trim()) {
      return false;
    }
    messageTarget.splice(assistantMessageIndex, 1);
    assistantMessageIndex = null;
    return true;
  };

  const appendSystemMessageForTab = (content: string): void => {
    if (!content.trim()) {
      return;
    }
    appendMessageForTab({
      id: createMessageId(),
      role: "system",
      content,
      createdAt: Date.now(),
    });
  };

  const appendTraceMessageForTab = (
    content: string,
    kind: TraceMessageKind = "normal",
    options: TraceMessageOptions = {}
  ): void => {
    if (!content.trim()) {
      return;
    }
    const { content: displayContent, shouldPersist } = normalizeTraceContentForDisplay(content, cli);
    if (!displayContent.trim()) {
      return;
    }
    const resolvedKind = resolveTraceKind(displayContent, kind);
    if (resolvedKind === "thinking" && options.forceTraceBubble !== true) {
      appendAssistantChunkForTab(`${displayContent}\n`, "thinking");
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
      appendMessageToStore(messageTarget, message);
      schedulePersistForInteractiveRun();
    }
    sendPanelMessage({
      type: "traceSegment",
      id: message.id,
      createdAt: message.createdAt,
      sequence: message.sequence,
      content: message.content,
      kind: resolvedKind,
      tabId,
      ...(Array.isArray(options.taskListItems) ? { taskListItems: options.taskListItems } : {}),
      ...mergePayload,
    });
    syncInteractiveRunEntry();
  };

  const appendCompletionMessageForTab = (status: TaskRunStatus): TaskRunRecord | null => {
    if (completionSent) {
      return null;
    }
    completionSent = true;
    const endedAt = Date.now();
    const taskRecord: TaskRunRecord = {
      id: runId,
      cli,
      sessionId: uiSessionId,
      prompt,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      status,
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
      graphRunId: input.graphRunId,
      graphNodeId: input.graphNodeId,
    };
    appendTaskRun(taskRecord);
    appendSystemMessageForTab(
      buildTaskRunCompletionText(status, taskRecord.durationMs)
    );
    return taskRecord;
  };

  const cleanupAfterRun = async (status: TaskRunStatus, userMessage?: string): Promise<void> => {
    subagentProgress.finishRunning(status === "end" ? "completed" : "failed");
    void logInfo("runPrompt-interactive-end", {
      cli,
      sessionId: uiSessionId,
      runId,
      tabId,
      status,
      message: userMessage ?? null,
    });
    logInteractiveIo(status, userMessage);
    if (status === "error" && userMessage) {
      appendSystemMessageForTab(userMessage);
    }
    sendRunStatusForTab(tabId, status === "end" ? "end" : status);
    const taskRecord = appendCompletionMessageForTab(status);
    flushPersistForInteractiveRun();
    maybePersistLongTermMemoryFromRun({
      status,
      cli,
      prompt,
      messages: messageTarget,
      taskRole: input.taskRole,
      loopTaskId: input.loopTaskId,
      loopRound: input.loopRound,
      loopSubtaskId: input.loopSubtaskId,
      skip: input.skipLongTermMemoryPersist,
    });
    interactiveRunsByTabId.delete(tabId);
    if (status === "end" && shouldAutoCompactAfterRun) {
      await maybeAutoCompactContextAfterPromptSuccess(target, uiSessionId, taskRecord?.durationMs ?? null);
    }
  };

  const updateSessionForNewRun = (
    newId: string,
    options: { freezePrevious?: string | null; codexSelection?: CodexRunSelection | null } = {}
  ): void => {
    const localSessionIdToPromote = !uiSessionId
      ? (getConversationTabById(tabId)?.sessionId ?? null)
      : (isLocalSessionId(uiSessionId) ? uiSessionId : null);

    if (!uiSessionId || localSessionIdToPromote) {
      adoptSessionId(cli, newId, tabId);
      upsertInteractiveMapping(cli, newId, newId, {
        freezePrevious: options.freezePrevious ?? undefined,
        codexSelection: options.codexSelection,
      });
      if (localSessionIdToPromote && localSessionIdToPromote !== newId) {
        migrateLocalSessionToTargetSession(cli, localSessionIdToPromote, newId);
      }
      uiSessionId = newId;
      refreshMessageTargetFromSession();
      return;
    }
    upsertInteractiveMapping(cli, uiSessionId, newId, {
      freezePrevious: options.freezePrevious ?? undefined,
      codexSelection: options.codexSelection,
    });
  };

  const stopFn = (): void => {
    const entry = interactiveRunsByTabId.get(tabId);
    if (!entry || entry.runId !== runId || entry.stopped) {
      return;
    }
    entry.stopped = true;
    subagentProgress.finishRunning("interrupted");
    void logInfo("runPrompt-interactive-stop-requested", { cli, sessionId: uiSessionId, runId, tabId });
    const removedPlaceholder = removeAssistantPlaceholderForTab();
    appendSystemMessageForTab(t("run.stoppedByUser"));
    try {
      stopCurrentTurn?.();
    } catch {
      // ignore
    }
    logInteractiveIo("stopped", t("run.stoppedByUser"));
    sendRunStatusForTab(tabId, "stopped");
    appendCompletionMessageForTab("stopped");
    if (removedPlaceholder && assistantMessageId) {
      sendPanelMessage({ type: "removeMessage", id: assistantMessageId, tabId });
    }
    flushPersistForInteractiveRun();
    interactiveRunsByTabId.delete(tabId);
  };

  const handleMissingFinalConclusionForTab = (
    source: string
  ): { action: "ok" | "retry" | "error" | "stopped"; message?: string } => {
    if (!isCurrentRunActive()) {
      void logInfo("runPrompt-interactive-missing-final-conclusion-skip-inactive", {
        cli,
        tabId,
        runId,
        sessionId: uiSessionId,
        source,
      });
      return { action: "stopped" };
    }
    if (hasAssistantFinalConclusionAfterMessage(messageTarget, userMessageId, {
      observedFinalAnswer: source === "codex" && observedCodexFinalAnswer,
      fallbackCreatedAt: userCreatedAt,
      requireExplicitFinalAnswer: shouldRequireExplicitFinalAnswerForRun(input),
    })) {
      return { action: "ok" };
    }
    const missingConclusionMessage = t("run.missingFinalConclusionRetryReason");
    if (hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES) {
      appendMessageForTab(createHiddenRetryErrorTraceMessage(missingConclusionMessage, {
        taskRole: input.taskRole,
        loopTaskId: input.loopTaskId,
        loopRound: input.loopRound,
        loopSubtaskId: input.loopSubtaskId,
      }, { createMessageId }));
      appendSystemMessageForTab(buildHiddenRetryQueuedMessage(hiddenRetryCount));
      hiddenRetryCount += 1;
      void logInfo("runPrompt-interactive-missing-final-conclusion-retry", {
        cli,
        tabId,
        runId,
        sessionId: uiSessionId,
        source,
        retryCount: hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
      });
      return { action: "retry" };
    }
    return {
      action: "error",
      message: buildHiddenRetryFailureMessage({
        hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        retryLimitMessage: buildHiddenRetryLimitMessage(),
        fallbackMessage: missingConclusionMessage,
        lastFailureMessage: missingConclusionMessage,
        lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
      }),
    };
  };

  if (!input.preloadedUserMessageId) {
    appendMessageForTab(buildUserChatMessage(input, userCreatedAt, userMessageId));
  }
  sendRunStatusForTab(tabId, "start", {
    prompt,
    startedAt,
    graphRunId: input.graphRunId,
    graphNodeId: input.graphNodeId,
  });

  interactiveRunsByTabId.set(tabId, {
    runId,
    tabId,
    cli,
    sessionId: uiSessionId,
    prompt,
    startedAt,
    stop: stopFn,
    messageTarget,
    stopped: false,
    taskRole: input.taskRole,
    loopTaskId: input.loopTaskId,
    loopRound: input.loopRound,
    loopSubtaskId: input.loopSubtaskId,
    graphRunId: input.graphRunId,
    graphNodeId: input.graphNodeId,
  });

  while (true) {
    const attemptNumber = hiddenRetryCount + 1;
    const attemptPrompt = hiddenRetryCount === 0 ? thinkingPrompt : hiddenRetryPrompt;
    let attemptHadNormalReply = false;

    if (hiddenRetryCount > 0) {
      const retryNumber = hiddenRetryCount;
      const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
      const shouldContinue = await waitForHiddenRetryDelay(retryNumber, isCurrentRunActive);
      if (!shouldContinue) {
        return;
      }
      appendSystemMessageForTab(buildHiddenRetryStartedMessage(retryNumber));
      void logInfo("runPrompt-interactive-hidden-retry", {
        cli,
        tabId,
        runId,
        sessionId: uiSessionId,
        attempt: attemptNumber,
        retryCount: hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        retryDelayMs,
      });
    }

    beginInteractiveAttempt(attemptPrompt);

    try {
      if (cli === "codex") {
        const mappedThreadId = uiSessionId ? resolveInteractiveMappedId(cli, uiSessionId) : null;
        const nextSelection = normalizeCodexRunSelection({
          configId: activeConfigId,
          model: selectedModel,
        });
        const threadDecision = decideCodexThreadForSelection({
          mappedThreadId,
          previousSelection: uiSessionId
            ? interactiveRunnerManager.getCodexRunnerSelection(uiSessionId)
              ?? resolveCodexInteractiveSelection(uiSessionId)
            : null,
          nextSelection,
        });
        if (threadDecision.startedFreshForSelectionChange) {
          void logInfo("runPrompt-interactive-codex-selection-new-thread", {
            cli,
            sessionId: uiSessionId,
            previousThreadId: mappedThreadId,
            configId: nextSelection.configId,
            model: nextSelection.model,
            tabId,
          });
        }
        const runner = uiSessionId
          ? interactiveRunnerManager.getOrCreateCodexRunner({
              sessionId: uiSessionId,
              threadId: threadDecision.threadId,
              command,
              args,
              cwd: cwd ?? undefined,
              thinkingMode,
              interactiveMode,
              model: nextSelection.model,
              configId: nextSelection.configId,
              multiAgentEnabled: getGlobalMultiAgentEnabled(),
            })
          : new (await import("./interactive/codexRunner")).CodexInteractiveRunner({
              command,
              args,
              cwd: cwd ?? undefined,
              thinkingMode,
              interactiveMode,
              model: nextSelection.model,
              threadId: null,
              multiAgentEnabled: getGlobalMultiAgentEnabled(),
            });

        stopCurrentTurn = () => runner.stopAndRebuild();
        syncInteractiveRunEntry(stopFn);
        await runner.runStreamed(attemptPrompt, {
          onAssistantDelta: (chunk, meta) => {
            if (!isCurrentRunActive()) {
              return;
            }
            if (meta?.codexFinalAnswer === true) {
              observedCodexFinalAnswer = true;
            }
            if (chunk.trim().length > 0) {
              attemptHadNormalReply = true;
            }
            appendAssistantChunkForTab(chunk, undefined, {
              codexFinalAnswer: meta?.codexFinalAnswer === true,
            });
            appendDebugStdout(chunk);
          },
          onSubagentUpdate: (update) => {
            if (!isCurrentRunActive()) {
              return;
            }
            subagentProgress.update({
              provider: "codex",
              id: update.threadId,
              agentName: update.agentName,
              status: update.status,
              delta: update.delta,
              error: update.error,
            });
          },
          onTrace: (content, kind, meta) => {
            if (!isCurrentRunActive()) {
              return;
            }
            if (content.trim().length > 0 && isCodexRetryProgressTraceKind(kind)) {
              attemptHadNormalReply = true;
            }
            appendTraceMessageForTab(content, kind === "thinking" ? "thinking" : "normal", meta);
            appendTraceLog(content);
          },
          onEvent: (event) => {
            if (!isCurrentRunActive()) {
              return;
            }
            sendPanelMessage({ type: "rawStreamDelta", content: normalizeRawStreamContent(event) + (String(normalizeRawStreamContent(event)).endsWith("\n") ? "" : "\n"), stream: "event", tabId });
            const eventTaskListItems = extractTaskListItemsFromForwardedCodexEvent(event, runner.getThreadId());
            if (eventTaskListItems.length) {
              sendPanelMessage({ type: "taskListUpdate", items: eventTaskListItems, tabId });
            }
            appendDebugEvent(event);
          },
          onTaskListUpdate: (items) => {
            sendPanelMessage({ type: "taskListUpdate", items, tabId });
          },
          onThreadId: (threadId) => {
            updateProcessTitle(cli, threadId);
            updateSessionForNewRun(threadId, {
              freezePrevious: threadDecision.freezePrevious,
              codexSelection: nextSelection,
            });
            void logInfo("runPrompt-interactive-codex-thread", {
              cli,
              sessionId: uiSessionId,
              threadId,
              replacedThreadId: threadDecision.freezePrevious,
              configId: nextSelection.configId,
              model: nextSelection.model,
              originalSessionId: target.sessionId,
              tabId,
            });
            if (uiSessionId) {
              interactiveRunnerManager.setRunner("codex", uiSessionId, runner, thinkingMode, interactiveMode, nextSelection.model, {
                multiAgentEnabled: getGlobalMultiAgentEnabled(),
                configId: nextSelection.configId,
                command,
                args,
                cwd: cwd ?? undefined,
              });
            }
            syncInteractiveRunEntry();
          },
        });
        const finalConclusionState = handleMissingFinalConclusionForTab("codex");
        if (finalConclusionState.action === "stopped") {
          return;
        }
        if (finalConclusionState.action === "retry") {
          continue;
        }
        if (finalConclusionState.action === "error") {
          await cleanupAfterRun("error", finalConclusionState.message);
          return;
        }
        await cleanupAfterRun("end");
        return;
      }

      if (cli === "claude") {
        const mappedSessionId = uiSessionId ? resolveInteractiveMappedId(cli, uiSessionId) : null;
        let runner = uiSessionId
          ? interactiveRunnerManager.getOrCreateClaudeRunner({
              sessionId: uiSessionId,
              mappedSessionId,
              command: commandForRunner,
              args,
              cwd: cwd ?? undefined,
              thinkingMode,
              interactiveMode,
              model: selectedModel,
              entrypoint: claudeEntrypoint,
              isolateProjectInstructions: executionOptions.isolateProjectInstructions,
            })
          : new (await import("./interactive/claudeRunner")).ClaudeInteractiveRunner({
              command: commandForRunner,
              args,
              cwd: cwd ?? undefined,
              thinkingMode,
              interactiveMode,
              model: selectedModel,
              entrypoint: claudeEntrypoint,
              sessionId: null,
              isolateProjectInstructions: executionOptions.isolateProjectInstructions,
            });

        const runStreamHandlers = {
          onAssistantDelta: (chunk: string) => {
            if (!isCurrentRunActive()) {
              return;
            }
            if (chunk.trim().length > 0) {
              attemptHadNormalReply = true;
            }
            appendAssistantChunkForTab(chunk);
            appendDebugStdout(chunk);
          },
          onTrace: (content: string, kind?: "thinking" | "normal" | "tool-use", meta?: { merge?: boolean }) => {
            if (!isCurrentRunActive()) {
              return;
            }
            if (content.trim().length > 0 && kind !== "thinking") {
              attemptHadNormalReply = true;
            }
            appendTraceMessageForTab(content, kind ?? "normal", {
              ...meta,
              forceTraceBubble: kind === "thinking",
            });
            appendTraceLog(content);
          },
          onEvent: (event: unknown) => {
            if (!isCurrentRunActive()) {
              return;
            }
            sendPanelMessage({ type: "rawStreamDelta", content: normalizeRawStreamContent(event) + (String(normalizeRawStreamContent(event)).endsWith("\n") ? "" : "\n"), stream: "event", tabId });
            appendDebugEvent(event);
          },
          onTaskListUpdate: (items: { text: string; done: boolean }[]) => {
            sendPanelMessage({ type: "taskListUpdate", items, tabId });
          },
          onSessionId: (newSessionId: string) => {
            updateProcessTitle(cli, newSessionId);
            updateSessionForNewRun(newSessionId);
            void logInfo("runPrompt-interactive-claude-session", {
              cli,
              sessionId: uiSessionId,
              newSessionId,
              originalSessionId: target.sessionId,
              tabId,
            });
            if (uiSessionId) {
              interactiveRunnerManager.setRunner("claude", uiSessionId, runner, thinkingMode, interactiveMode, selectedModel);
            }
            syncInteractiveRunEntry();
          },
        };

        stopCurrentTurn = () => runner.stopAndRebuild();
        syncInteractiveRunEntry(stopFn);
        try {
          await runner.runStreamed(attemptPrompt, runStreamHandlers);
        } catch (error) {
          const info = getErrorInfo(error);
          if (uiSessionId && isClaudeSessionNotFoundErrorInfo(info)) {
            appendSystemMessageForTab(t("claude.sessionResetRetry"));
            void logInfo("runPrompt-interactive-claude-session-reset-retry", {
              cli,
              sessionId: uiSessionId,
              mappedSessionId,
              error: info.message,
              errorCode: info.code,
              tabId,
            });
            runner.dispose();
            runner = new (await import("./interactive/claudeRunner")).ClaudeInteractiveRunner({
              command: commandForRunner,
              args,
              cwd: cwd ?? undefined,
              thinkingMode,
              interactiveMode,
              model: selectedModel,
              entrypoint: claudeEntrypoint,
              sessionId: null,
              isolateProjectInstructions: executionOptions.isolateProjectInstructions,
            });
            stopCurrentTurn = () => runner.stopAndRebuild();
            syncInteractiveRunEntry(stopFn);
            await runner.runStreamed(attemptPrompt, runStreamHandlers);
          } else {
            throw error;
          }
        }
        const finalConclusionState = handleMissingFinalConclusionForTab("claude");
        if (finalConclusionState.action === "stopped") {
          return;
        }
        if (finalConclusionState.action === "retry") {
          continue;
        }
        if (finalConclusionState.action === "error") {
          await cleanupAfterRun("error", finalConclusionState.message);
          return;
        }
        await cleanupAfterRun("end");
        return;
      }

      throw new Error(`interactive-runner-unsupported:${cli}`);
    } catch (error) {
      const entry = interactiveRunsByTabId.get(tabId);
      if (!entry || entry.runId !== runId) {
        return;
      }
      const info = getErrorInfo(error);
      if (entry.stopped) {
        void logInfo("runPrompt-interactive-aborted", {
          cli,
          tabId,
          error: info.message,
          errorName: info.name,
          errorCode: info.code,
          errorStack: info.stack,
        });
        return;
      }
      subagentProgress.finishRunning("failed");

      const canContinueCurrentConversation = Boolean(uiSessionId);
      hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
      const shouldRetry = canContinueCurrentConversation
        && hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
        && isHiddenRetryEligibleErrorInfo(info);
      if (shouldRetry) {
        const retryDelayMs = getHiddenRetryDelayMs(hiddenRetryCount + 1);
        appendMessageForTab(createHiddenRetryErrorTraceMessage(info.message, {
          taskRole: input.taskRole,
          loopTaskId: input.loopTaskId,
          loopRound: input.loopRound,
          loopSubtaskId: input.loopSubtaskId,
        }, { createMessageId }));
        appendSystemMessageForTab(buildHiddenRetryQueuedMessage(hiddenRetryCount));
        hiddenRetryCount += 1;
        void logInfo("runPrompt-interactive-hidden-retry-queued", {
          cli,
          tabId,
          runId,
          sessionId: uiSessionId,
          failedAttempt: attemptNumber,
          nextAttempt: attemptNumber + 1,
          retryCount: hiddenRetryCount,
          maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          retryDelayMs,
          error: info.message,
          errorName: info.name,
          errorCode: info.code,
          errorStack: info.stack,
        });
        continue;
      }

      void logError("runPrompt-interactive-error", {
        cli,
        tabId,
        error: info.message,
        errorName: info.name,
        errorCode: info.code,
        errorStack: info.stack,
      });
      const rawUserMessage = error instanceof Error ? error.message : String(error);
      const userMessage = buildHiddenRetryFailureMessage({
        hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        retryLimitMessage: buildHiddenRetryLimitMessage(),
        fallbackMessage: rawUserMessage,
        lastFailureMessage: rawUserMessage,
        lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
      });
      await cleanupAfterRun("error", userMessage);
      throw error;
    }
  }
}

async function promptInstallMissingCli(cli: CliName, command: string): Promise<void> {
  const installLabel = t("cli.install.actionInstall");
  const openSettingsLabel = t("common.openSettings");
  const message = [
    t("cli.install.prompt", { cli: getCliDisplayName(cli), command }),
    buildCliCommandNotFoundMessage(cli, command, process.platform, t),
  ].join("\n\n");
  const selection = await vscode.window.showWarningMessage(
    message,
    installLabel,
    openSettingsLabel
  );
  if (selection === installLabel) {
    const installCommand = getCliInstallCommand(cli);
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
  if (activeInteractiveStop) {
    activeInteractiveStop();
    return;
  }
  if (!activeProcess) {
    return;
  }
  const removedPlaceholder = removeActiveAssistantPlaceholder();
  appendStopMessageToStore();
  activeProcess.kill();
  void logInfo("runPrompt-stopped", { cli: currentCli });
  sendRunStatus("stopped", t("run.stoppedByUser"));
  if (currentCli === "codex" || currentCli === "opencode") {
    flushTraceBuffer();
  }
  appendCompletionMessage("stopped");
  if (removedPlaceholder && activeAssistantMessageId) {
    sendPanelMessage({ type: "removeMessage", id: activeAssistantMessageId });
  }
  persistActiveMessages();
  clearActiveRun();
}

function clearActiveRun(): void {
  if (activeCliForRun === "opencode" && activeTabIdForRun) {
    latestOpenCodeTaskListByTabId.delete(activeTabIdForRun);
  }
  restoreProcessTitle();
  activeProcess = undefined;
  activeInteractiveStop = null;
  activeAssistantMessageId = undefined;
  activeTraceMessageId = undefined;
  activeTraceBuffer = "";
  activeTraceSegmentLines = [];
  activeOpenCodeJsonlBuffer = "";
  activeOpenCodeDisplayedFinalText = null;
  resetTraceLineFilterState(activeTraceLineFilterState);
  activeCompletionSent = false;
  activeRunId = undefined;
  activeTaskRun = null;
  activeMessageTarget = null;
  activeMessageIndex = null;
  activeSessionId = null;
  activeCliForRun = null;
  activeTabIdForRun = null;
  if (pendingWorkspaceKey && !hasAnyTaskRunning()) {
    const nextKey = pendingWorkspaceKey;
    pendingWorkspaceKey = null;
    applyWorkspaceSessionStore(nextKey);
    void postPanelState();
  }
}

function removeActiveAssistantPlaceholder(): boolean {
  if (!activeMessageTarget || activeMessageIndex === null) {
    return false;
  }
  const message = activeMessageTarget[activeMessageIndex];
  if (!message || message.role !== "assistant") {
    return false;
  }
  if (message.content.trim()) {
    return false;
  }
  activeMessageTarget.splice(activeMessageIndex, 1);
  activeMessageIndex = activeMessageTarget.length ? activeMessageTarget.length - 1 : null;
  return true;
}

function appendStopMessageToStore(): void {
  if (!activeMessageTarget) {
    return;
  }
  appendMessageToStore(activeMessageTarget, {
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
  if (!activeAssistantMessageId) {
    return;
  }
  void logDebug("assistant-chunk", {
    id: activeAssistantMessageId,
    size: chunk.length,
    kind: kind ?? "normal",
  });
  sendPanelMessage({
    type: "assistantDelta",
    id: activeAssistantMessageId,
    content: chunk,
    kind,
  });
  appendAssistantChunkToStore(activeMessageTarget, activeMessageIndex, chunk, kind);
}

function ensureAssistantMessage(kind?: ChatMessage["kind"]): void {
  if (!activeMessageTarget) {
    return;
  }
  const last = activeMessageTarget[activeMessageTarget.length - 1];
  if (
    activeAssistantMessageId &&
    last &&
    last.role === "assistant" &&
    last.id === activeAssistantMessageId &&
    hasSameAssistantKind(last, kind)
  ) {
    return;
  }
  const assistantId = createMessageId();
  activeAssistantMessageId = assistantId;
  const message: ChatMessage = {
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    ...(kind === "thinking" ? { kind: "thinking" } : {}),
    taskRole: activeTaskRun?.taskRole,
    loopTaskId: activeTaskRun?.loopTaskId,
    loopRound: activeTaskRun?.loopRound,
    loopSubtaskId: activeTaskRun?.loopSubtaskId,
    graphRunId: activeTaskRun?.graphRunId,
    graphNodeId: activeTaskRun?.graphNodeId,
  };
  appendMessageToStore(activeMessageTarget, message);
  activeMessageIndex = activeMessageTarget.length - 1;
  sendPanelMessage({
    type: "appendMessage",
    message,
  });
}

function startTraceMessage(cli: CliName): void {
  if (cli !== "codex" && cli !== "opencode") {
    activeTraceMessageId = undefined;
    return;
  }
  activeTraceMessageId = createMessageId();
}

function appendTraceLines(chunk: string): void {
  if (!activeTraceMessageId) {
    return;
  }
  if (activeCompletionSent) {
    return;
  }
  const normalized = chunk.replace(/\r\n/g, "\n");
  const combined = activeTraceBuffer + normalized;
  const lines = combined.split("\n");
  activeTraceBuffer = lines.pop() ?? "";
  lines.forEach((line) => {
    if (shouldIgnoreTraceLine(activeTraceLineFilterState, line, activeTraceSegmentLines.length > 0, activeCliForRun)) {
      return;
    }
    if (isTraceSegmentStart(line) && activeTraceSegmentLines.length) {
      flushTraceSegment();
    }
    activeTraceSegmentLines.push(line);
  });
}

function flushTraceBuffer(): void {
  if (!activeTraceMessageId) {
    return;
  }
  const line = activeTraceBuffer.trim();
  if (line && !shouldIgnoreTraceLine(activeTraceLineFilterState, line, activeTraceSegmentLines.length > 0, activeCliForRun)) {
    activeTraceSegmentLines.push(line);
  }
  flushTraceSegment();
  activeTraceBuffer = "";
}

function flushTraceSegment(): void {
  if (!activeTraceMessageId) {
    return;
  }
  if (!activeTraceSegmentLines.length) {
    return;
  }
  const content = activeTraceSegmentLines.join("\n");
  const { content: execDisplayContent, shouldPersist: execShouldPersist } =
    formatCodexExecSegmentForDisplay(content, activeCliForRun);
  const { content: displayContent, shouldPersist } = formatTraceSegmentForDisplay(
    execDisplayContent,
    activeCliForRun
  );
  const kind = getTraceSegmentKind(displayContent);
  if (kind === "thinking") {
    activeTraceSegmentLines = [];
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
  activeTraceSegmentLines = [];
  if (activeMessageTarget && shouldPersist && execShouldPersist) {
    appendMessageToStore(activeMessageTarget, message);
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
  activeTaskRun = {
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
  if (activeCompletionSent) {
    return;
  }
  const taskRecord = finalizeTaskRun(activeRunId, status);
  const message = {
    id: createMessageId(),
    role: "system" as const,
    content: buildTaskRunCompletionText(status, taskRecord?.durationMs ?? null),
    createdAt: Date.now(),
  };
  activeCompletionSent = true;
  if (!activeMessageTarget) {
    return;
  }
  appendMessageToStore(activeMessageTarget, message);
  sendPanelMessage({ type: "appendMessage", message });
}

function sendRunStatus(
  status: "start" | "end" | "error" | "stopped",
  message?: string,
  options: { activity?: RunActivity } = {}
): void {
  if (status === "start") {
    clearTaskListForRunStart(activeTabIdForRun);
  } else if (activeCliForRun === "opencode" && activeTabIdForRun) {
    latestOpenCodeTaskListByTabId.delete(activeTabIdForRun);
  }
  sendPanelMessage({
    type: "runStatus",
    status,
    message,
    prompt: status === "start" ? activeTaskRun?.prompt : undefined,
    startedAt: status === "start" ? activeTaskRun?.startedAt : undefined,
    activity: status === "start" ? options.activity : undefined,
    graphRunId: status === "start" ? activeTaskRun?.graphRunId : undefined,
    graphNodeId: status === "start" ? activeTaskRun?.graphNodeId : undefined,
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
  sendPanelMessageWithActiveTab(payload, activeTabIdForRun, (message) => viewProvider?.postMessage(message));
}

function finalizeTaskRun(runId: string | undefined, status: TaskRunStatus): TaskRunRecord | null {
  if (!runId || !activeTaskRun || activeTaskRun.id !== runId) {
    return null;
  }
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - activeTaskRun.startedAt);
  const record: TaskRunRecord = {
    ...activeTaskRun,
    endedAt,
    durationMs,
    status,
  };
  activeTaskRun = null;
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
    executionMode?: LoopExecutionMode;
  } = {}
): LoopTaskRecord {
  const now = Date.now();
  const id = createMessageId();
  const communication = getLoopCommunicationPaths(id);
  const sessionId = typeof options.sessionId === "string" && options.sessionId.trim()
    ? options.sessionId
    : null;
  const executionMode = normalizeLoopExecutionMode(options.executionMode);
  const taskStoreFile = buildLoopTaskStoreFile(cli, activeWorkspaceKey, sessionId, id);
  ensureLoopCommunicationFiles(id, rootPrompt);
  const record: LoopTaskRecord = {
    id,
    cli,
    workspaceKey: activeWorkspaceKey,
    taskStoreFile,
    rootPrompt,
    executionMode,
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
    ensureWorkspaceHarnessScaffold(extensionUri.fsPath, paths);
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
  return readModelSelectionStore(modelSelectionStoreState, getModelStoreOptions());
}

function writeModelStore(store: CliModelStore): void {
  writeModelSelectionStore(modelSelectionStoreState, store, getModelStoreOptions());
}

function loadModelStore(): CliModelStore {
  return loadModelSelectionStore(modelSelectionStoreState, getModelStoreOptions());
}

function getActiveConfigIdForCli(cli: CliName): string | null {
  const snapshot = configHeartbeatSnapshot;
  if (snapshot && snapshot.cli === cli && snapshot.activeConfigId) {
    return snapshot.activeConfigId;
  }
  return getWorkspacePreferredConfigIdForCli(cli);
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

function clearPromptHistory(): void {
  promptHistoryStore = clearPromptHistoryStore(getPromptHistoryStoreOptions());
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

function loadSessionStore(): SessionStore {
  return sessionLifecycleController.loadSessionStore();
}

async function cleanupSessionRetentionAcrossWorkspaces(): Promise<void> {
  await sessionLifecycleController.cleanupSessionRetentionAcrossWorkspaces();
}

function buildSessionState(cli: CliName): { currentSessionId: string | null; sessions: SessionSummary[] } {
  const allSessions: SessionSummary[] = [];
  const openConversationTabSessionMap = buildOpenConversationTabSessionMap();
  const loopSessionIdsByCli = buildLoopSessionIdsByCli(
    loopDebateChatPanelCoordinator.listGroupChatTasks()
  );
  const graphRunIdsBySessionByCli = buildGraphRunIdsBySessionByCli(
    listGraphRuns({ workspaceKey: activeWorkspaceKey }).runs
  );
  let shouldPersist = false;
  for (const item of CLI_LIST) {
    const records = sessionStore[item]?.sessions ?? [];
    records.forEach((record) => {
      let firstPrompt = record.firstPrompt;
      if (!firstPrompt) {
        const resolved = resolveSessionFirstPrompt(item, record.id);
        if (resolved) {
          record.firstPrompt = resolved;
          firstPrompt = resolved;
          shouldPersist = true;
        }
      }
      const fallbackLabel = buildSessionLabelFromPrompt(firstPrompt);
      if (fallbackLabel && shouldUseFallbackSessionLabel(record.label)) {
        record.label = fallbackLabel;
        shouldPersist = true;
      }
      const openConversationTabId = openConversationTabSessionMap.get(
        buildConversationTabSessionLookupKey(item, record.id)
      ) ?? null;
      const graphRunId = graphRunIdsBySessionByCli[item].get(record.id)
        ?? resolveSessionGraphRunIdFromMessages(item, record.id);
      allSessions.push({
        id: record.id,
        label: record.label,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt,
        cli: item,
        isLoopSession: loopSessionIdsByCli[item].has(record.id),
        isGraphSession: Boolean(graphRunId),
        graphRunId,
        isOpenInConversationTabs: Boolean(openConversationTabId),
        openConversationTabId,
        firstPrompt,
      });
    });
  }
  if (shouldPersist) {
    void persistSessionStore(sessionStore);
  }
  const sessions = allSessions.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return {
    currentSessionId: sessionStore[cli]?.currentId ?? null,
    sessions,
  };
}

function resolveSessionFirstPrompt(cli: CliName, sessionId: string): string | null {
  const messages = loadSessionMessages(cli, sessionId);
  const first = messages.find((message) => message.role === "user" && message.content.trim());
  return first ? first.content : null;
}

function normalizeChatGraphRunId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type GraphRunSessionLookupByCli = ReturnType<typeof buildGraphRunIdsBySessionByCli>;

function resolveGraphRunIdFromMessages(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const directGraphRunId = normalizeChatGraphRunId(message.graphRunId);
    if (directGraphRunId) {
      return directGraphRunId;
    }
    const actions = Array.isArray(message.actions) ? message.actions : [];
    for (let actionIndex = actions.length - 1; actionIndex >= 0; actionIndex -= 1) {
      const action = actions[actionIndex];
      if (action.type !== "openGraphRun") {
        continue;
      }
      const actionGraphRunId = normalizeChatGraphRunId(action.graphRunId);
      if (actionGraphRunId) {
        return actionGraphRunId;
      }
    }
  }
  return null;
}

function resolveSessionGraphRunIdFromMessages(cli: CliName, sessionId: string): string | null {
  return resolveGraphRunIdFromMessages(loadSessionMessages(cli, sessionId));
}

function resolveConversationTabGraphRunId(
  tab: ConversationTabRecord | null,
  graphRunIdsBySessionByCli?: GraphRunSessionLookupByCli,
): string | null {
  if (!tab) {
    return null;
  }
  const graphNodeTarget = graphNodeRunTargetsByTabId.get(tab.id);
  const graphNodeRunId = normalizeChatGraphRunId(graphNodeTarget?.graphRunId);
  if (graphNodeRunId) {
    return graphNodeRunId;
  }
  if (getPrimaryRunTabId() === tab.id) {
    const activeGraphRunId = normalizeChatGraphRunId(activeTaskRun?.graphRunId);
    if (activeGraphRunId) {
      return activeGraphRunId;
    }
  }
  const parallelGraphRunId = normalizeChatGraphRunId(parallelRunsByTabId.get(tab.id)?.graphRunId);
  if (parallelGraphRunId) {
    return parallelGraphRunId;
  }
  const interactiveGraphRunId = normalizeChatGraphRunId(interactiveRunsByTabId.get(tab.id)?.graphRunId);
  if (interactiveGraphRunId) {
    return interactiveGraphRunId;
  }
  const liveMessages = getLiveMessagesForTab(tab.id);
  const liveGraphRunId = liveMessages ? resolveGraphRunIdFromMessages(liveMessages) : null;
  if (liveGraphRunId) {
    return liveGraphRunId;
  }
  const sessionId = getConversationTabSessionIdForCli(tab, tab.cli);
  if (sessionId) {
    const storedGraphRunId = normalizeChatGraphRunId(graphRunIdsBySessionByCli?.[tab.cli]?.get(sessionId));
    return storedGraphRunId ?? resolveSessionGraphRunIdFromMessages(tab.cli, sessionId);
  }
  return resolveGraphRunIdFromMessages(getPendingSessionDraft(tab.id, tab.cli).messages);
}

function ensureLatestSessionForCli(cli: CliName): void {
  const latestSessionId = getLatestSessionId(cli);
  if (!latestSessionId) {
    return;
  }
  if (getCurrentSessionId(cli) === latestSessionId) {
    return;
  }
  setCurrentSession(cli, latestSessionId, { syncConversationTab: false });
}

function getLatestSessionId(cli: CliName): string | null {
  return getLatestSessionIdFromRecords(sessionStore[cli]?.sessions ?? []);
}

function getCurrentSessionId(cli: CliName): string | null {
  return sessionStore[cli]?.currentId ?? null;
}

function buildOpenConversationTabSessionMap(): Map<string, string> {
  return sessionTabsController.buildOpenConversationTabSessionMap();
}

function buildConversationTabsState(): {
  activeTabId: string | null;
  tabs: ConversationTabSummary[];
} {
  const tabState = sessionTabsController.buildConversationTabsState();
  const tabsById = new Map(ensureConversationTabs().tabs.map((tab) => [tab.id, tab]));
  const graphRuns = listGraphRuns({ workspaceKey: activeWorkspaceKey }).runs;
  const graphRunsById = new Map(graphRuns.map((run) => [run.id, run]));
  const graphRunIdsBySessionByCli = buildGraphRunIdsBySessionByCli(
    graphRuns,
  );
  return {
    ...tabState,
    tabs: tabState.tabs.map((summary) => {
      const graphRunId = normalizeChatGraphRunId(summary.graphRunId)
        ?? resolveConversationTabGraphRunId(tabsById.get(summary.id) ?? null, graphRunIdsBySessionByCli);
      if (!graphRunId) {
        return summary;
      }
      const graphRun = graphRunsById.get(graphRunId) ?? null;
      return {
        ...summary,
        graphRunId,
        graphRunStatus: graphRun?.status,
        graphRunBlocked: graphRun ? isGraphRunBlockedForMainTab(graphRun) : undefined,
      };
    }),
  };
}

function initializeConversationTabsFromWorkspaceSettings(): void {
  sessionTabsController.initializeConversationTabsFromWorkspaceSettings();
}

function sanitizeConversationTabRecord(value: unknown): ConversationTabRecord | null {
  return sessionTabsController.sanitizeConversationTabRecord(value);
}

function ensureConversationTabs(): ConversationTabsState {
  return sessionTabsController.ensureConversationTabs();
}

function persistConversationTabsToWorkspaceSettings(): void {
  sessionTabsController.persistConversationTabsToWorkspaceSettings();
}

function getConversationTabById(tabId: string): ConversationTabRecord | null {
  return sessionTabsController.getConversationTabById(tabId);
}

function getActiveConversationTabId(): string | null {
  return sessionTabsController.getActiveConversationTabId();
}

function getActiveConversationTab(): ConversationTabRecord | null {
  return sessionTabsController.getActiveConversationTab();
}

function getActiveConversationSessionId(cli: CliName): string | null {
  return sessionTabsController.getActiveConversationSessionId(cli);
}

function findConversationTabIdBySession(cli: CliName, sessionId: string): string | null {
  return sessionTabsController.findConversationTabIdBySession(cli, sessionId);
}

function updateActiveConversationTabSession(cli: CliName, sessionId: string | null): void {
  sessionTabsController.updateActiveConversationTabSession(cli, sessionId);
}

function setActiveConversationTab(tabId: string): { cli: CliName; sessionId: string | null } | null {
  return sessionTabsController.setActiveConversationTab(tabId);
}

async function switchVisibleConversationTabForLoop(
  tabId: string
): Promise<{ cli: CliName; sessionId: string | null } | null> {
  const previousCli = currentCli;
  const switched = setActiveConversationTab(tabId);
  if (!switched) {
    return null;
  }
  if (currentCli !== switched.cli) {
    currentCli = switched.cli;
    updateStatusBar();
    workspaceSettings.currentCli = currentCli;
    saveWorkspaceSettings(workspaceSettings);
  }
  if (previousCli !== switched.cli) {
    await maybePromptInstallOnCliGroupSwitch(switched.cli);
  }
  await postPanelState();
  sendSessionMessagesToPanel(switched.cli, switched.sessionId, tabId);
  return switched;
}

function createLoopSubtaskRunTarget(
  cli: CliName,
  options: { sessionId?: string | null } = {}
): PromptRunTarget {
  const sessionId = normalizeLoopDebateSessionId(options.sessionId);
  const state = ensureConversationTabs();
  const tab: ConversationTabRecord = {
    id: createConversationTabId(),
    cli,
    sessionId,
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, cli, sessionId),
    createdAt: Date.now(),
  };
  state.tabs.push(tab);
  persistConversationTabsToWorkspaceSettings();
  void logInfo("loop-subtask-session-created", { cli, tabId: tab.id });
  void postPanelState();
  return {
    tabId: tab.id,
    cli,
    sessionId,
  };
}

function createGraphNodeRunTarget(
  cli: CliName,
  graphRunId: string,
  graphNodeId: string,
): PromptRunTarget {
  const sessionId = null;
  const state = ensureConversationTabs();
  const tab: ConversationTabRecord = {
    id: createConversationTabId(),
    cli,
    sessionId,
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, cli, sessionId),
    createdAt: Date.now(),
  };
  state.tabs.push(tab);
  graphNodeRunTargetsByTabId.set(tab.id, { graphRunId, graphNodeId });
  persistConversationTabsToWorkspaceSettings();
  void logInfo("graph-node-session-created", { cli, tabId: tab.id, graphRunId, graphNodeId });
  void postPanelState();
  return {
    tabId: tab.id,
    cli,
    sessionId,
  };
}

function addConversationTab(
  cli: CliName,
  sessionId: string | null,
  options: { skipPersist?: boolean } = {}
): string | null {
  return sessionTabsController.addConversationTab(cli, sessionId, options);
}

function closeConversationTab(tabId: string): { cli: CliName; sessionId: string | null } | null {
  return sessionTabsController.closeConversationTab(tabId);
}

async function closeConversationTabAndRefreshPanel(tabId: string): Promise<void> {
  if (isTabRunActive(tabId) || isLoopMainTabCloseLocked(tabId)) {
    await postPanelState();
    return;
  }
  const closingTab = getConversationTabById(tabId);
  if (!closingTab) {
    return;
  }
  graphNodeRunTargetsByTabId.delete(tabId);
  const previousCli = currentCli;
  const closingBindings = getInteractiveSessionBindingsForTab(closingTab);
  const next = closeConversationTab(tabId);
  closingBindings.forEach((binding) => {
    disposeInteractiveRunnerIfUnused(binding);
  });
  if (next && currentCli !== next.cli) {
    currentCli = next.cli;
    updateStatusBar();
    workspaceSettings.currentCli = currentCli;
    saveWorkspaceSettings(workspaceSettings);
  }
  if (next && previousCli !== next.cli) {
    await maybePromptInstallOnCliGroupSwitch(next.cli);
  }
  await postPanelState();
  if (next) {
    sendSessionMessagesToPanel(next.cli, next.sessionId);
    return;
  }
  sendSessionMessagesToPanel(currentCli, null);
}

function detachConversationTabsFromSession(cli: CliName, sessionId: string): void {
  sessionTabsController.detachConversationTabsFromSession(cli, sessionId);
}

function syncCurrentSessionWithActiveTab(preferredCli?: CliName): string | null {
  return sessionTabsController.syncCurrentSessionWithActiveTab(preferredCli);
}

function setCurrentSession(
  cli: CliName,
  sessionId: string | null,
  options: { syncConversationTab?: boolean } = {}
): void {
  if (!sessionStore[cli]) {
    sessionStore[cli] = { currentId: null, sessions: [] };
  }
  sessionStore[cli].currentId = sessionId;
  if (sessionId) {
    touchSession(cli, sessionId);
  }
  if (options.syncConversationTab !== false) {
    updateActiveConversationTabSession(cli, sessionId);
  }
  void persistSessionStore(sessionStore);
  void logInfo("session-selected", { cli, sessionId });
}

function startNewSession(cli: CliName): void {
  const activeTab = getActiveConversationTab();
  sessionTabsController.startNewSession(cli);
  void logInfo("session-new", { cli, tabId: activeTab?.id ?? null });
}

async function resetConversationTabSession(): Promise<void> {
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    return;
  }
  if (isTabRunActive(activeTab.id) || isLoopMainTabCloseLocked(activeTab.id)) {
    await postPanelState();
    return;
  }
  const previousTabId = activeTab.id;
  const targetCli = activeTab.cli;
  addConversationTab(targetCli, null);
  setWorkspaceInteractiveModeForCli(targetCli, "coding");
  await closeConversationTabAndRefreshPanel(previousTabId);
  void logInfo("session-reset-to-new-tab", {
    cli: targetCli,
    previousTabId,
    activeTabId: getActiveConversationTabId(),
  });
}

function captureSessionFromBuffer(cli: CliName, buffer: string): void {
  const sessionId = extractSessionId(cli, buffer);
  if (!sessionId) {
    return;
  }
  adoptDetectedSessionId(cli, sessionId, activeTabIdForRun, activeSessionId);
}

function adoptDetectedSessionId(
  cli: CliName,
  sessionId: string,
  tabId: string | null,
  previousSessionId: string | null,
): void {
  if (previousSessionId === sessionId) {
    return;
  }
  if (previousSessionId && !isLocalSessionId(previousSessionId)) {
    return;
  }
  if (previousSessionId) {
    migrateLocalSessionToTargetSession(cli, previousSessionId, sessionId, { notifyPanel: false });
  }
  adoptSessionId(cli, sessionId, tabId);
}

function adoptFreshOpenCodeLoopRecoverySession(options: {
  sessionId: string;
  previousSessionId: string | null;
  tabId: string | null;
  messageTarget: ChatMessage[];
  loopTaskId: string;
}): ChatMessage[] {
  const sessionId = options.sessionId.trim();
  if (!sessionId) {
    return options.messageTarget;
  }

  // Preserve the UI transcript while the OpenCode provider starts a clean context.
  saveSessionMessages("opencode", sessionId, options.messageTarget);
  adoptSessionId("opencode", sessionId, options.tabId);
  bindLoopTaskToSession(options.loopTaskId, sessionId);
  if (activeTaskRun?.cli === "opencode" && activeTaskRun.loopTaskId === options.loopTaskId) {
    activeTaskRun.sessionId = sessionId;
  }
  void logInfo("opencode-loop-main-fresh-session-recovered", {
    taskId: options.loopTaskId,
    tabId: options.tabId,
    previousSessionId: options.previousSessionId,
    sessionId,
  });
  return loadSessionMessages("opencode", sessionId);
}

function touchSession(cli: CliName, sessionId: string): void {
  const now = Date.now();
  const sessions = sessionStore[cli].sessions;
  const existing = sessions.find((item) => item.id === sessionId);
  if (existing) {
    existing.lastUsedAt = now;
    return;
  }
  sessions.push({ id: sessionId, label: t("session.unnamed"), createdAt: now, lastUsedAt: now });
}

async function persistSessionStore(nextStore: SessionStore): Promise<void> {
  await extensionContext.globalState.update(getSessionStoreKey(), nextStore);
  writeSessionFile(nextStore, activeWorkspaceKey, {
    workspaceKeyFallback: WORKSPACE_KEY_FALLBACK,
    legacySessionFile: LEGACY_SESSION_FILE,
    sessionDir: SESSION_DIR,
    logError: (event, payload) => void logError(event, payload),
  });
}

function updateSessionBuffer(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  if (next.length <= SESSION_BUFFER_LIMIT) {
    return next;
  }
  return next.slice(next.length - SESSION_BUFFER_LIMIT);
}

function createConversationTabId(): string {
  return sessionTabsController.createConversationTabId();
}

function getPendingSessionDraft(tabId: string, cli?: CliName): PendingSessionDraft {
  return sessionTabsController.getPendingSessionDraft(tabId, cli);
}

function updatePendingSessionDraft(
  tabId: string,
  patch: Partial<PendingSessionDraft>,
  cli?: CliName,
): PendingSessionDraft {
  return sessionTabsController.updatePendingSessionDraft(tabId, patch, cli);
}

function clearPendingSessionDraft(tabId: string, cli?: CliName): void {
  sessionTabsController.clearPendingSessionDraft(tabId, cli);
}

function ensureLocalSession(cli: CliName, tabId: string): void {
  sessionLifecycleController.ensureLocalSession(cli, tabId);
}

function preparePendingLabel(cli: CliName, tabId: string, prompt: string): void {
  sessionTabsController.preparePendingLabel(cli, tabId, prompt);
}

function assignPendingLabel(cli: CliName, tabId: string, sessionId: string): void {
  sessionLifecycleController.assignPendingLabel(cli, tabId, sessionId);
}

function persistActiveMessages(): void {
  sessionLifecycleController.persistActiveMessages();
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
