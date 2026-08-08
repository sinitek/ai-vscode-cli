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
  parseOpenCodeRunOutput,
  resolveCliCommand,
  runCli,
  runCliStream,
  startOpenCodeServer,
  isCliCommandAvailable,
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
  ensureLoopTaskMaxRoundsAtLeast,
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
import {
  buildGraphRunIdsBySessionByCli,
  listGraphRuns,
  readGraphRunRecord,
} from "./graph/graphStore";
import type { GraphRunControlSource } from "./graph/graphRunControl";
import type { GraphAutoWakeAttemptResult } from "./graph/graphAutoWake";
import {
  type GraphModelRole,
  type GraphNodeRecord,
  type GraphRunModelRoutingRecord,
  type GraphRunRecord,
} from "./graph/types";
import {
  readToolSettings,
  resolveGlobalAutoCompactContextAfterRun,
  resolveGlobalHumanInteractionEnabled,
  resolveGlobalMultiAgentEnabled,
  type ToolSettingsLocale,
  type ToolSettingsState,
  writeToolSettings,
} from "./toolSettings";
import {
  createHumanInteractionRejectedError,
  type HumanInteractionRequest,
  type HumanInteractionSubmission,
} from "./humanInteraction";
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
import { createGraphControlsHost, type GraphControlsHost } from "./extensionHost/graphControls";
import { createPromptRunRuntimeHost } from "./extensionHost/promptRunRuntime";
import { createPromptParallelRuntimeHost } from "./extensionHost/promptParallelRuntime";
import { createPromptInteractiveRuntimeHost } from "./extensionHost/promptInteractiveRuntime";
import { createPromptOneShotRuntimeHost } from "./extensionHost/promptOneShotRuntime";
import {
  createDisabledOpenCodeSubagentMonitor,
  createOpenCodeSubagentRuntimePreparer,
} from "./extensionHost/openCodeSubagentRuntime";
import type { InteractiveTabRun } from "./extensionHost/promptExecutionShared";
import {
  createLoopOrchestrationHost,
  LOOP_DEBATE_DEFAULT_DEBATE_ROUND,
  LOOP_PARALLEL_SUBTASK_MAX,
  LOOP_SUBTASK_RETRY_MAX_RETRIES,
} from "./extensionHost/loopOrchestration";
import { createModelSettingsHost } from "./extensionHost/modelSettings";
import { createExtensionSessionTabsHost } from "./extensionHost/sessionTabs";
import { createGraphMessagesHost, type GraphRuntimeMessageKey } from "./extensionHost/graphMessages";
import {
  createGraphRuntimeHost,
  type GraphRuntimeHost,
  type PromptRunInput,
  type PromptRunTarget,
} from "./extensionHost/graphRuntime";
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
  isLoopAnswerConclusionMessageForTask,
  isLoopFinalSummaryMessageForTask,
  isLoopResumePrompt,
  isLoopTaskResumable,
  isLoopTaskSessionCompatible,
  normalizeLoopResumePrompt,
  waitForHiddenRetryDelay,
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
const latestOpenCodeTaskListByTabId = new Map<string, OpenCodeTaskListItem[]>();
let sessionTabsController: SessionTabsController;
let sessionLifecycleController: SessionLifecycleController;
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
const WORKSPACE_HARNESS_TERMINAL_NAME = "Workspace Harness Setup";
const CODEGRAPH_SETUP_COMMAND = getCodeGraphInstallCommand({ initializeWorkspace: true });
const ARCHITECTURE_INITIALIZATION_DISPLAY_PROMPT = "初始化当前工作区 ARCHITECTURE.md";
const UNNAMED_SESSION_LABELS = new Set([
  t("session.unnamed", undefined, "zh-CN"),
  t("session.unnamed", undefined, "en"),
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
  graphControlsHost.disposeGraphAutoWakeScheduler();
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
  if (message.type === "humanInteractionResponse") {
    resolveHumanInteractionResponse(message);
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
    getGlobalHumanInteractionEnabled,
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

function requestHumanInteraction(request: HumanInteractionRequest): Promise<HumanInteractionSubmission> {
  if (!viewProvider) {
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
    rememberPendingHumanInteraction({ request, resolve, reject });
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
    entry.reject(createHumanInteractionRejectedError());
  });
  viewProvider?.postMessage({
    type: "humanInteractionCancel",
    tabId,
    ...(statusText ? { statusText } : {}),
  });
}

const promptRunRuntimeHost = createPromptRunRuntimeHost({ getActiveWorkspaceKey: () => activeWorkspaceKey, getConversationTabById: (tabId) => getConversationTabById(tabId), getConversationTabs: () => ensureConversationTabs().tabs, createConversationTabId: () => createConversationTabId(), persistConversationTabsToWorkspaceSettings: () => persistConversationTabsToWorkspaceSettings(), postPanelState: () => postPanelState(), loadSessionMessages: (cli, sessionId) => loadSessionMessages(cli, sessionId), persistMessagesForTab: (cli, sessionId, tabId, messages) => persistMessagesForTab(cli, sessionId, tabId, messages), getPendingSessionDraft: (tabId, cli) => getPendingSessionDraft(tabId, cli), updatePendingSessionDraft: (tabId, patch, cli) => updatePendingSessionDraft(tabId, patch, cli), sendPanelMessage: (payload) => sendPanelMessage(payload), createMessageId: () => createMessageId(), readTaskStore: () => readTaskStore(), writeTaskStore: (store) => writeTaskStore(store), appendLoopMainSubChatMainDecision: (task, decision, subtasks) => appendLoopMainSubChatMainDecision(task, decision, subtasks), buildLoopDebateChatMessageAction: (taskId, round) => buildLoopDebateChatMessageAction(taskId, round), runLoopPrompt: (input, options) => runLoopPrompt(input, options), isTabRunActive: (tabId) => isTabRunActive(tabId), refreshOpenLoopGroupChatPanelForTask: (taskId) => refreshOpenLoopGroupChatPanelForTask(taskId), cancelLoopTaskAutoWake: (taskId) => cancelLoopTaskAutoWake(taskId), resolveConversationTabLoopContext: (tab) => resolveConversationTabLoopContext(tab), resolveLoopTaskSessionId: (target) => resolveLoopTaskSessionId(target), isLoopTaskBlockedByMainAiFailureLimit: (task) => isLoopTaskBlockedByMainAiFailureLimit(task), formatLoopAutoWakeAtForRecord: (value) => formatLoopAutoWakeAtForRecord(value), appendLoopMainSubChatSubtaskFinished: (task, subtask, runStatus, assistantContent) => appendLoopMainSubChatSubtaskFinished(task, subtask, runStatus, assistantContent), closeConversationTabAndRefreshPanel: (tabId) => closeConversationTabAndRefreshPanel(tabId) });
const { resolvePromptRunTarget, collectRecentLoopTaskIdsForTarget, isLoopTaskCompatibleWithTarget, findResumableLoopTaskForTarget, getLoopMessagesForTarget, resolveLoopSubtaskConversationContext, isLoopSubtaskConversationTarget, getLastLoopAssistantContent, parseLoopMainDecision, extractJsonObjectText, normalizeLoopMainDecision, normalizeLoopEstimatedRemainingRounds, normalizeLoopSubtaskDecisions, normalizeSingleLoopSubtaskDecision, normalizeLoopRoundSummaries, normalizeSingleLoopRoundSummary, normalizeLoopAcceptance, normalizeLoopAcceptanceChecks, buildLoopSubtaskId, applyLoopMainDecision, getLoopDecisionSubtasks, appendLoopMainDecisionSummary, buildLoopSubtaskDecisionMarkdown, upsertLoopSubtask, upsertLoopSubtasks, getActiveLoopSubtaskIds, markLoopSubtaskRunFinished, finalizeLoopSubtaskRun, buildLoopSubtaskCompletionSummary, appendLoopSubtaskCompletionAutoLog, markLoopTaskInterrupted, isLoopTaskExecutionInterrupted, markLoopTaskStopped, markLoopTaskStoppedByUser, markLoopTaskStoppedAfterRuntimeEnded, resolvePromptRunTargetFromConversationTab, resolveLoopMainPromptTarget, maybeWakeLoopMainAfterSubtaskContinuation, getLoopTargetSessionId, persistLoopMessagesForTarget, removeLoopMainDecisionMessage, replaceLoopMainDecisionMessageWithMarkdown, showLoopSubtaskDecisionMarkdown, showLoopAutoSleepMessage, buildLoopAutoSleepMessageMarkdown, hasCompleteLoopCompletionMessagesForTask, appendLoopAnswerConclusionMessage, appendLoopFinalSummaryMessage, appendSystemMessageForLoop, getLoopRoundRunStatus, getLatestLoopRoundRunRecord } = promptRunRuntimeHost;
const modelSettingsHost = createModelSettingsHost({ getCurrentCli: () => currentCli, setCurrentCli: (cli) => { currentCli = cli; }, getModelStore: () => modelStore, setModelStore: (store) => { modelStore = store; }, getWorkspaceSettings: () => workspaceSettings, setWorkspaceSettings: (settings) => { workspaceSettings = settings; }, getPromptHistoryStore: () => promptHistoryStore, setPromptHistoryStore: (store) => { promptHistoryStore = store; }, getModelSelectionStoreState: () => modelSelectionStoreState, getActiveWorkspaceKey: () => activeWorkspaceKey, getConfigHeartbeatSnapshot: () => configHeartbeatSnapshot, getOpenCodeThinkingState: () => openCodeThinkingState, setOpenCodeThinkingState: (state) => { openCodeThinkingState = state; }, getOpenCodeSmallThinkingState: () => openCodeSmallThinkingState, setOpenCodeSmallThinkingState: (state) => { openCodeSmallThinkingState = state; }, getOpenCodeModelsState: () => openCodeModelsState, setOpenCodeModelsState: (state) => { openCodeModelsState = state; }, getOpenCodeThinkingContextKey: () => openCodeThinkingContextKey, setOpenCodeThinkingContextKey: (value) => { openCodeThinkingContextKey = value; }, getOpenCodeThinkingConfigId: () => openCodeThinkingConfigId, setOpenCodeThinkingConfigId: (value) => { openCodeThinkingConfigId = value; }, getOpenCodeThinkingExactModels: () => openCodeThinkingExactModels, setOpenCodeThinkingExactModels: (value) => { openCodeThinkingExactModels = value; }, getOpenCodeThinkingRequestId: () => openCodeThinkingRequestId, setOpenCodeThinkingRequestId: (value) => { openCodeThinkingRequestId = value; }, getWorkspacePreferredConfigIdForCli: (cli) => getWorkspacePreferredConfigIdForCli(cli), resolveModelConfigIdForCli: (cli, configState) => resolveModelConfigIdForCli(cli, configState), postPanelState: () => postPanelState(), resolveWorkspaceCwd: () => resolveWorkspaceCwd(), getExtensionUri: () => extensionUri, updateStatusBar: () => updateStatusBar(), getActiveConversationTab: () => getActiveConversationTab(), getActiveConversationTabId: () => getActiveConversationTabId(), getConversationTabById: (tabId) => getConversationTabById(tabId), isTabRunActive: (tabId) => isTabRunActive(tabId), preloadUserMessageForPrompt: (input, target) => preloadUserMessageForPrompt(input, target), resolvePromptRunTarget: (tabId) => resolvePromptRunTarget(tabId), runPrompt: (input, options) => runPrompt(input, options), sanitizeConversationTabRecord: (value) => sanitizeConversationTabRecord(value), logError: (event, payload) => logError(event, payload) });
const { getOpenCodeThinkingStateForRole, setOpenCodeThinkingStateForRole, persistOpenCodeVariant, updateOpenCodeVariantForCurrentSelection, resolveOpenCodeRoleModelsForConfig, refreshOpenCodeThinkingState, getOpenCodeVariantForRun, resolvePromptRunTargetSessionId, resolveLoopTaskSessionId, isLoopTaskBlockedByMainAiFailureLimit, normalizeThinkingModeForCli, getWorkspaceThinkingMode, getCliModelThinkingKey, getStoredCliModelThinkingMode, setCliModelThinkingMode, getEffectiveThinkingMode, getWorkspaceInteractiveMode, setWorkspaceInteractiveModeForCli, getWorkspaceLoopExecutionMode, setWorkspaceLoopExecutionModeForCli, buildWorkspaceLoopExecutionModeByCli, getGlobalMultiAgentEnabled, getGlobalHumanInteractionEnabled, shouldRequireExplicitFinalAnswerForRun, buildLongTermMemoryRuntimeSettings, getLongTermMemoryDisabledReason, getEffectiveLongTermMemoryEnabled, getActiveWorkspaceMemoryPaths, ensureActiveWorkspaceHarnessScaffold, confirmAndInitializeWorkspaceHarness, startCodeGraphWorkspaceSetup, createCodeGraphTerminal, installCodeGraphForWorkspace, buildArchitectureInitializationModelPrompt, maybePromptInitializeArchitectureWithAi, getGlobalAutoCompactContextAfterRun, normalizeLoopMaxRounds, normalizeStoredLoopMaxRounds, parseLoopMaxRoundsValue, getGlobalLoopMaxRounds, getGlobalLoopSubtaskMaxThinkingMode, getModelStoreOptions, getWorkspaceSettingsStoreOptions, getPromptHistoryStoreOptions, errorToMessage, ensureCliModelStore, readModelStore, writeModelStore, loadModelStore, getActiveConfigIdForCli, getSelectedCliModel, getSelectedLoopCliModel, getSelectedLoopThinkingMode, getManagedModelOptionsForCli, getModelOptionsForCli, selectCliModel, selectCliLoopModel, setSelectedLoopThinkingMode, updateOpenCodeRoleModelForConfig, addCliModel, renameCliModel, deleteCliModel, moveCliModel, getEffectiveCliArgs, buildModelState, loadWorkspaceSettings, saveWorkspaceSettings, loadPromptHistoryStore, ensurePromptHistoryStore, buildPromptHistoryState, recordPromptHistory, clearPromptHistory, getPromptHistoryFilePath, readPromptHistoryFile, writePromptHistoryFile, deletePromptHistoryFile, cleanupPromptHistoryRetentionAcrossWorkspaces, collectWorkspaceKeysForPromptHistoryCleanup } = modelSettingsHost;
const sessionTabsHost = createExtensionSessionTabsHost({ getSessionTabsController: () => sessionTabsController, getSessionLifecycleController: () => sessionLifecycleController, getSessionStore: () => sessionStore, setSessionStore: (store) => { sessionStore = store; }, getCurrentCli: () => currentCli, setCurrentCli: (cli) => { currentCli = cli; }, getActiveWorkspaceKey: () => activeWorkspaceKey, getWorkspaceSettings: () => workspaceSettings, saveWorkspaceSettings: (settings) => saveWorkspaceSettings(settings), getLoopGroupChatTasks: () => loopDebateChatPanelCoordinator.listGroupChatTasks(), getGraphNodeRunTarget: (tabId) => graphNodeRunTargetsByTabId.get(tabId), deleteGraphNodeRunTarget: (tabId) => { graphNodeRunTargetsByTabId.delete(tabId); }, setGraphNodeRunTarget: (tabId, value) => { graphNodeRunTargetsByTabId.set(tabId, value); }, getPrimaryRunTabId: () => getPrimaryRunTabId(), getActiveTaskRun: () => activeTaskRun, getParallelGraphRunId: (tabId) => parallelRunsByTabId.get(tabId)?.graphRunId, getInteractiveGraphRunId: (tabId) => interactiveRunsByTabId.get(tabId)?.graphRunId, getLiveMessagesForTab: (tabId) => getLiveMessagesForTab(tabId), getPendingSessionDraft: (tabId, cli) => getPendingSessionDraft(tabId, cli), getActiveTabIdForRun: () => activeTabIdForRun, getActiveSessionId: () => activeSessionId, persistSessionStore: persistSessionStoreToStorage, getSessionStoreKey: (workspaceKey) => getSessionStoreKey(workspaceKey), loadSessionMessages: (cli, sessionId) => loadSessionMessages(cli, sessionId), saveSessionMessages: (cli, sessionId, messages) => saveSessionMessages(cli, sessionId, messages), buildSessionLabelFromPrompt: (prompt) => buildSessionLabelFromPrompt(prompt), shouldUseFallbackSessionLabel: (label) => shouldUseFallbackSessionLabel(label), isGraphRunBlockedForMainTab: (run) => isGraphRunBlockedForMainTab(run), isTabRunActive: (tabId) => isTabRunActive(tabId), isLoopMainTabCloseLocked: (tabId) => isLoopMainTabCloseLocked(tabId), postPanelState: () => postPanelState(), updateStatusBar: () => updateStatusBar(), maybePromptInstallOnCliGroupSwitch: (cli) => maybePromptInstallOnCliGroupSwitch(cli), sendSessionMessagesToPanel: (cli, sessionId, tabId) => sendSessionMessagesToPanel(cli, sessionId, tabId), getInteractiveSessionBindingsForTab: (tab) => getInteractiveSessionBindingsForTab(tab), disposeInteractiveRunnerIfUnused: (binding) => disposeInteractiveRunnerIfUnused(binding as InteractiveSessionBinding), setWorkspaceInteractiveModeForCli: (cli, mode) => setWorkspaceInteractiveModeForCli(cli, mode), extractSessionId: (cli, buffer) => extractSessionId(cli, buffer) ?? null, isLocalSessionId: (sessionId) => isLocalSessionId(sessionId), migrateLocalSessionToTargetSession: (cli, from, to, options) => migrateLocalSessionToTargetSession(cli, from, to, options), adoptSessionId: (cli, sessionId, tabId) => adoptSessionId(cli, sessionId, tabId), getActiveTaskRunMutable: () => activeTaskRun, logInfo: (event, payload) => { void logInfo(event, payload); }, activeData: { WORKSPACE_KEY_FALLBACK, LEGACY_SESSION_FILE, SESSION_DIR, SESSION_BUFFER_LIMIT } });
const { loadSessionStore, cleanupSessionRetentionAcrossWorkspaces, buildSessionState, resolveSessionFirstPrompt, normalizeChatGraphRunId, resolveGraphRunIdFromMessages, resolveSessionGraphRunIdFromMessages, resolveConversationTabGraphRunId, ensureLatestSessionForCli, getLatestSessionId, getCurrentSessionId, buildOpenConversationTabSessionMap, buildConversationTabsState, initializeConversationTabsFromWorkspaceSettings, sanitizeConversationTabRecord, ensureConversationTabs, persistConversationTabsToWorkspaceSettings, getConversationTabById, getActiveConversationTabId, getActiveConversationTab, getActiveConversationSessionId, findConversationTabIdBySession, updateActiveConversationTabSession, setActiveConversationTab, switchVisibleConversationTabForLoop, createLoopSubtaskRunTarget, createGraphNodeRunTarget, addConversationTab, closeConversationTab, closeConversationTabAndRefreshPanel, detachConversationTabsFromSession, syncCurrentSessionWithActiveTab, setCurrentSession, startNewSession, resetConversationTabSession, captureSessionFromBuffer, adoptDetectedSessionId, adoptFreshOpenCodeLoopRecoverySession, touchSession, updateSessionBuffer, createConversationTabId, getPendingSessionDraft, updatePendingSessionDraft, clearPendingSessionDraft, ensureLocalSession, preparePendingLabel, assignPendingLabel, persistActiveMessages } = sessionTabsHost;

loopOrchestrationHost = createLoopOrchestrationHost({
  LOOP_AUTO_WAKE_MAX_SECONDS,
  LOOP_AUTO_WAKE_MIN_SECONDS,
  LOOP_DEBATE_BLUE_TEAM_ROLE,
  LOOP_DEBATE_MAX_BATCH_SPEAKERS,
  LOOP_DEBATE_MAX_DIALOGUE_TURNS,
  LOOP_DEBATE_MAX_PARTICIPANTS,
  LOOP_DEBATE_MIN_PARTICIPANTS,
  LOOP_DEBATE_MODERATOR_ID,
  LOOP_DEBATE_PARTICIPANT_ROLES,
  LOOP_DEBATE_RED_TEAM_ROLE,
  appendLoopRound,
  appendMessageToStore,
  appendSystemMessageForLoop,
  applyLoopMainDecision,
  bindLoopTaskToSession,
  buildLoopAutoSleepProtocolLines,
  buildLoopCompletedConclusionAndSummaryMarkdown,
  buildLoopDebateBriefMarkdown,
  buildLoopDebateChatTurnMarkdown,
  buildLoopDebateConsensusReachedText,
  buildLoopDebateConsensusStartedText,
  buildLoopDebateDialogueClosedMarkdown,
  buildLoopDebateDialogueTurnChatEventMarkdown,
  buildLoopDebateDialogueTurnStartedText,
  buildLoopDebateFinalParticipantMarkdown,
  buildLoopDebateFinalStanceStartedText,
  buildLoopDebateInitialChatMarkdown,
  buildLoopDebateModeratorArtifactFile,
  buildLoopDebateModeratorFinishedText,
  buildLoopDebateModeratorStartedText,
  buildLoopDebateModeratorTurnMarkdown,
  buildLoopDebateNeedsReviewSummary,
  buildLoopDebateNeedsReviewText,
  buildLoopDebateParticipantArtifactFile,
  buildLoopDebateParticipantFinishedText,
  buildLoopDebateParticipantRosterChatMarkdown,
  buildLoopDebateParticipantRosterFailedText,
  buildLoopDebateParticipantRosterFinishedText,
  buildLoopDebateParticipantRosterStartedText,
  buildLoopDebateParticipantStartedText,
  buildLoopDebateParticipantsCollectedText,
  buildLoopDebatePaths,
  buildLoopDebateRerunText,
  buildLoopDebateReuseText,
  buildLoopDebateRuntimeForcedFinalizeMarkdown,
  buildLoopDebateStartedText,
  buildLoopMainSubChatTranscriptFile,
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
  extractJsonObjectText,
  finalizeLoopSubtaskRun,
  findLatestLoopDebateModeratorSessionId,
  findLatestLoopDebateParticipantSessionId,
  formatLoopEstimatedRemainingRounds,
  formatLoopGroupChatMemberName,
  getActiveLoopSubtaskIds,
  getLastLoopAssistantContent,
  getLoopCommunicationPaths,
  getLoopDecisionSubtasks,
  getLoopMainSubChatMainTitle,
  getLoopMessagesForTarget,
  getLoopRoundRunStatus,
  getLoopSubtaskDisplayTitle,
  isLoopDebateAdversarialParticipantRole,
  isLoopTaskExecutionInterrupted,
  logError,
  mapLoopRunStatusToSubagentStatus,
  markLoopSubtaskRunFinished,
  markLoopTaskInterrupted,
  normalizeLoopContinuePromptForPrompt,
  normalizeLoopDebateModeratorAction,
  normalizeLoopDebateParticipantStance,
  normalizeLoopDebateSessionId,
  normalizeLoopDebateSpeakerIds,
  normalizeLoopExecutionMode,
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
  runLoopDebateConsensusSummary,
  runLoopDebateModerator,
  runLoopDebateParticipantBatch,
  runLoopDebateParticipantRoster,
  runPrompt,
  selectDefaultLoopDebateOpeningSpeakerIds,
  sendPanelMessage,
  switchVisibleConversationTabForLoop,
  t,
  updateLoopTaskRecord,
  validateLoopDebateConsensus,
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
  getGlobalMultiAgentEnabled,
  getPendingSessionDraft,
  getSelectedCliModel,
  getWorkspaceInteractiveMode,
  getInteractiveRunnerManager: () => interactiveRunnerManager,
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
  clearActiveRun,
  createDisabledOpenCodeSubagentMonitor,
  createMessageId,
  flushTraceBuffer,
  getActiveRunId: () => activeRunId,
  getActiveTaskRun: () => activeTaskRun,
  getEffectiveThinkingMode,
  getPendingSessionDraft,
  killActiveProcess: () => {
    activeProcess?.kill();
  },
  loadSessionMessages,
  logCliStartup,
  maybeAutoCompactContextAfterPromptSuccess,
  maybePersistLongTermMemoryFromRun,
  persistActiveMessages,
  prepareOpenCodeRuntime,
  prepareOpenCodeSubagentRuntime,
  preparePendingLabel,
  resetActiveAssistantMessage: () => {
    activeAssistantMessageId = undefined;
    activeMessageIndex = null;
  },
  resetTraceState: () => {
    activeTraceBuffer = "";
    activeTraceSegmentLines = [];
    resetTraceLineFilterState(activeTraceLineFilterState);
    activeCompletionSent = false;
  },
  resolveCliSessionIdForResume,
  resolveWorkspaceCwd,
  sendOpenCodeTaskListUpdate,
  sendPanelMessage,
  sendRawStreamDelta,
  sendRunStatus,
  setActiveCliForRun: (cli) => {
    activeCliForRun = cli;
  },
  setActiveMessageTarget: (target) => {
    activeMessageTarget = target;
  },
  setActiveProcess: (process) => {
    activeProcess = process;
  },
  setActiveRunId: (runId) => {
    activeRunId = runId;
  },
  setActiveSessionId: (sessionId) => {
    activeSessionId = sessionId;
  },
  setActiveTabIdForRun: (tabId) => {
    activeTabIdForRun = tabId;
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

  const humanInteractionEnabled = getExplicitGlobalConfigValue<unknown>("humanInteractionEnabled");
  if (
    typeof current.humanInteractionEnabled !== "boolean"
    && typeof humanInteractionEnabled === "boolean"
  ) {
    next.humanInteractionEnabled = resolveGlobalHumanInteractionEnabled({ humanInteractionEnabled });
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


const graphMessagesHost = createGraphMessagesHost({
  resolveLocale,
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
  getActiveTaskRun: () => activeTaskRun,
  stopActiveRun,
  showInformationMessage: (message) => { void vscode.window.showInformationMessage(message); },
  showWarningMessage: (message) => { void vscode.window.showWarningMessage(message); },
  errorToMessage,
  messages: graphMessagesHost,
  runtime: {
    resolveGraphResumePromptModels: (run, cli, configId) => graphRuntimeHost.resolveGraphResumePromptModels(run, cli, configId),
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
  await loopDebateChatPanelCoordinator.open(arg);
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

function resolvePromptRunModelForRole(input: PromptRunInput, role: GraphModelRole): string | undefined {
  return graphRuntimeHost.resolvePromptRunModelForRole(input, role);
}

function resolvePromptRunThinkingModeForRole(
  input: PromptRunInput,
  cli: CliName,
  role: GraphModelRole,
  model: string | undefined,
  options: { applySubtaskCap?: boolean } = {},
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
  task = ensureLoopTaskMaxRoundsAtLeast(task, getGlobalLoopMaxRounds());
  onTaskOwnershipAcquired?.(task.id, target);
  await postPanelState();

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
    let decisionRunResult: Awaited<ReturnType<LoopOrchestrationHost["runClassicLoopMainDecision"]>>;
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

function formatLoopAutoWakeAtForRecord(...args: Parameters<LoopOrchestrationHost["formatLoopAutoWakeAtForRecord"]>): ReturnType<LoopOrchestrationHost["formatLoopAutoWakeAtForRecord"]> {
  return requireLoopOrchestrationHost().formatLoopAutoWakeAtForRecord(...args);
}

function readTextFileIfNonEmpty(...args: Parameters<LoopOrchestrationHost["readTextFileIfNonEmpty"]>): ReturnType<LoopOrchestrationHost["readTextFileIfNonEmpty"]> {
  return requireLoopOrchestrationHost().readTextFileIfNonEmpty(...args);
}

function runClassicLoopMainDecision(...args: Parameters<LoopOrchestrationHost["runClassicLoopMainDecision"]>): ReturnType<LoopOrchestrationHost["runClassicLoopMainDecision"]> {
  return requireLoopOrchestrationHost().runClassicLoopMainDecision(...args);
}

function runLoopDebateRound(...args: Parameters<LoopOrchestrationHost["runLoopDebateRound"]>): ReturnType<LoopOrchestrationHost["runLoopDebateRound"]> {
  return requireLoopOrchestrationHost().runLoopDebateRound(...args);
}

function runLoopSubtasksBatchWithRetry(...args: Parameters<LoopOrchestrationHost["runLoopSubtasksBatchWithRetry"]>): ReturnType<LoopOrchestrationHost["runLoopSubtasksBatchWithRetry"]> {
  return requireLoopOrchestrationHost().runLoopSubtasksBatchWithRetry(...args);
}

function shouldRunLoopPlanningDebate(...args: Parameters<LoopOrchestrationHost["shouldRunLoopPlanningDebate"]>): ReturnType<LoopOrchestrationHost["shouldRunLoopPlanningDebate"]> {
  return requireLoopOrchestrationHost().shouldRunLoopPlanningDebate(...args);
}

function writeTextFileEnsuringDir(...args: Parameters<LoopOrchestrationHost["writeTextFileEnsuringDir"]>): ReturnType<LoopOrchestrationHost["writeTextFileEnsuringDir"]> {
  return requireLoopOrchestrationHost().writeTextFileEnsuringDir(...args);
}

// Loop prompt run runtime helpers moved to extensionHost/promptRunRuntime.ts.

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
