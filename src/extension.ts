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
  buildProcessLabel,
  captureCliOutput,
  resolveCliCommand,
  runCli,
  runCliStream,
  isCliCommandAvailable,
  type RunProcess,
} from "./cli/commandRunner";
import { readModelArg, supportsCliManagedModelSelection } from "./cli/modelArgs";
import {
  buildGeminiThinkingRuntimeProfile,
  GEMINI_SYSTEM_SETTINGS_ENV_KEY,
} from "./cli/geminiThinking";
import {
  isGeminiNativeCompactUnsupportedErrorText,
} from "./cli/geminiCompaction";
import {
  CliName,
  CLI_LIST,
  DEFAULT_LOBSTER_EXECUTION_MODE,
  InteractiveMode,
  LobsterExecutionMode,
  MacTaskShell,
  ThinkingMode,
  ThinkingWorkspaceFile,
  normalizeLobsterExecutionMode,
} from "./cli/types";
import { getCliDisplayName, getCliInstallCommand } from "./cli/installer";
import { getLocaleSetting, resolveLocale, t } from "./i18n";
import { CliBridgeViewProvider } from "./webview/viewProvider";
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
  LobsterGroupChatHistoryItem,
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
import {
  buildHiddenRetryFailureMessage,
  getHiddenRetryDelayMs,
  resetHiddenRetryCountOnRecoveredReply,
} from "./hiddenRetry";
import { hasAssistantFinalConclusionAfterMessage } from "./finalConclusion";
import {
  buildNextLobsterMainAiFailureState,
  buildResetLobsterMainAiFailureState,
  isLobsterMainAiFailureLimitReached,
  LOBSTER_MAIN_AI_FAILURE_LIMIT,
  normalizeLobsterMainAiFailureCount,
} from "./lobsterMainFailure";
import { ConfigManagerPanel } from "./webview/configPanel";
import {
  LobsterDebateChatPanel,
  type LobsterDebateChatPanelRound,
} from "./webview/lobsterDebatePanel";
import * as configService from "./config/configService";
import { ConfigItem, ConfigPlatform, CurrentConfig } from "./config/types";
import { stripCodexSkillsBlock } from "./config/codexSkills";
import { stripManagedClaudeSkillRules } from "./config/claudeSkills";
import { stripManagedGeminiSkillRules } from "./config/geminiSkills";
import { InteractiveRunnerManager } from "./interactive/manager";
import { isClaudeNativeCompactUnsupportedError } from "./interactive/claudeCompaction";
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
  buildLobsterSubtaskExecutionPlan,
  describeLobsterExecutionPlan,
  normalizeLobsterWriteFiles,
  type LobsterSubtaskExecutionPlan,
} from "./lobsterParallel";
import {
  buildLobsterAnswerConclusionMarkdown,
  buildLobsterDebateNeedsReviewSummary,
  buildLobsterDebateModeratorArtifactFile,
  buildLobsterFinalSummaryMarkdown,
  buildLobsterGroupChatFinalStatusSection,
  buildLobsterMainSubChatTranscriptFile,
  buildLobsterMainSubSubtaskTurnBody,
  buildLobsterDebateParticipantArtifactFile,
  buildLobsterDebateParticipantTurnArtifactFile,
  buildLobsterDebatePaths,
  formatLobsterGroupChatMemberName,
  findLatestLobsterDebateModeratorSessionId,
  findLatestLobsterDebateParticipantSessionId,
  LOBSTER_MAIN_SUB_CHAT_ROUND_KEY,
  LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
  LOBSTER_DEBATE_MAX_BATCH_SPEAKERS,
  LOBSTER_DEBATE_MODERATOR_ID,
  LOBSTER_DEBATE_MODERATOR_TITLE,
  LOBSTER_DEBATE_BLUE_TEAM_ROLE,
  LOBSTER_DEBATE_PARTICIPANT_ROLES,
  LOBSTER_DEBATE_RED_TEAM_ROLE,
  isLobsterDebateAdversarialParticipantRole,
  normalizeLobsterDebateSessionId,
  normalizeLobsterDebateModeratorAction,
  normalizeLobsterDebateSpeakerIds,
  normalizeLobsterDebateParticipantStance,
  parseLobsterDebateChatTranscript,
  resolveLobsterAnswerConclusion,
  resolveLobsterTaskRunControlState,
  selectDefaultLobsterDebateOpeningSpeakerIds,
  validateLobsterDebateConsensus,
  type LobsterDebateActiveSpeakerRecord,
  type LobsterDebateConsensusRecord,
  type LobsterDebateDisagreementRecord,
  type LobsterDebateModeratorDecisionRecord,
  type LobsterDebateParticipantRecord,
  type LobsterDebateParticipantRole,
  type LobsterDebateParticipantStance,
  type LobsterDebatePaths,
  type LobsterDebateRoundRecord,
  type LobsterDebateRoundStatus,
} from "./lobsterDebate";
import {
  LOBSTER_DEBATE_MAX_PARTICIPANTS,
  LOBSTER_DEBATE_MIN_PARTICIPANTS,
  buildLobsterDebateBriefMarkdown,
  buildLobsterDebateChatTurnMarkdown,
  buildLobsterDebateDialogueClosedMarkdown,
  buildLobsterDebateDialogueTurnChatEventMarkdown,
  buildLobsterDebateFinalParticipantMarkdown,
  buildLobsterDebateInitialChatMarkdown,
  buildLobsterDebateModeratorTurnMarkdown,
  buildLobsterDebateParticipantRosterChatMarkdown,
  buildLobsterDebateRuntimeForcedFinalizeMarkdown,
  type LobsterDebateParticipantDefinition,
} from "./lobsterPromptBuilders";
import {
  runLobsterDebateConsensusSummary,
  runLobsterDebateModerator,
  runLobsterDebateParticipantBatch,
  runLobsterDebateParticipantRoster,
  type LobsterDebateParticipantBatchRunItem,
  type LobsterDebateRunnerDeps,
  type LobsterDebateSessionState,
} from "./lobsterDebateRunner";
import {
  appendLobsterRound,
  bindLobsterTaskToSession,
  buildLobsterTaskStoreFile,
  buildLobsterSubtaskCommunicationFile,
  cleanupLobsterCommunicationRetention,
  cleanupLobsterTaskStoreRetention,
  ensureLobsterCommunicationFiles,
  getLobsterCommunicationPaths,
  getLobsterTaskStoreSessionFile,
  listLobsterTaskStoreFiles,
  prepareLobsterSubtaskCommunicationFile,
  readLobsterTaskRecord,
  readLobsterTaskStore,
  updateLobsterTaskRecord,
  writeLobsterTaskStore,
  type LobsterAcceptance,
  type LobsterAcceptanceCheck,
  type LobsterMainDecision,
  type LobsterRoundRecord,
  type LobsterRoundSummary,
  type LobsterSubtaskDecision,
  type LobsterSubtaskRecord,
  type LobsterTaskRecord,
  type LobsterTaskStore,
} from "./lobsterTaskStore";
import {
  readToolSettings,
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
  finalizeGeminiStreamJsonState,
  processGeminiStreamJsonChunk,
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
  getConversationTabSessionIdForCli,
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
  type ProcessTitleState,
  type SessionLifecycleController,
} from "./sessionLifecycle";
import {
  buildModelState as buildModelSelectionState,
  countStoreModels,
  createEmptyModelSelectionStoreState,
  deleteCliModelFromStore,
  ensureCliModelStore as ensureCliModelSelectionStore,
  getCliModelLobsterRoleFlagsFromStore,
  getEffectiveCliArgs as getEffectiveCliArgsFromStore,
  getLobsterModelOptionsForCliFromStore,
  getManagedModelOptionsForCliFromStore,
  getManagedModelOptionsForConfigFromStore,
  getModelOptionsForCliFromStore,
  getModelOptionsForConfigFromStore,
  getSelectedCliModelFromStore,
  getSelectedLobsterCliModelFromStore,
  isLobsterTaskRoleValue,
  loadModelStore as loadModelSelectionStore,
  mergeUniqueModelNames,
  moveCliModelInStore,
  normalizeCliModelName,
  normalizeLobsterModelRoleFlags,
  readModelStore as readModelSelectionStore,
  renameCliModelInStore,
  selectCliLobsterModelInStore,
  selectCliModelInStore,
  setCliModelLobsterRoleInStore,
  summarizeModelStoreByConfigId,
  writeModelStore as writeModelSelectionStore,
  type CliModelStore,
  type LobsterTaskRoleForModelSelection,
} from "./modelSelectionStore";
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
  buildLobsterMainResumeText,
  buildLobsterSubtaskBatchCompletedText,
  buildLobsterSubtaskBatchStartedText,
  buildLobsterSubtaskExecutionGroupStartedText,
  buildLobsterSubtaskRetryText as buildLobsterSubtaskRetryTextWithLimit,
  buildLobsterSubtaskStartedText,
  buildLobsterTaskCompletedText,
  buildLobsterTaskNeedsReviewText as buildLobsterTaskNeedsReviewTextWithLimit,
  buildLobsterTaskResumedText,
  buildLobsterTaskStartedText,
  buildPanelStateWithDeps,
  buildSessionLabelFromPrompt,
  buildUserChatMessage,
  ensureLobsterMainSubChatTranscriptWithDeps,
  formatLobsterEstimatedRemainingRounds,
  formatLobsterWriteFiles,
  buildPromptWithAutoContext as buildPromptWithAutoContextFromPanelStateBuilder,
  getLatestAssistantResponseForLongTermMemory,
  getLobsterMainSubChatMainTitle,
  getLobsterSubtaskDisplayTitle,
  isCliName,
  isLobsterDebateGroupChatTask,
  maybeInjectLongTermMemoryForPromptWithEditorContext,
  normalizeLobsterRound,
  normalizeLobsterSubtaskId,
  normalizeLobsterTaskId,
  resolveLobsterConversationTabContextFromMessages,
  resolveLobsterRunConversationTabContext,
  resolveLobsterSubtaskConversationContextFromMessages,
  shouldUseFallbackSessionLabel as shouldUseFallbackSessionLabelWithSet,
  type LobsterConversationTabContext,
  type LobsterSubtaskConversationContext,
} from "./panelStateBuilder";
import {
  appendHiddenRetryErrorTraceMessage,
  buildHiddenRetryLimitMessage,
  buildHiddenRetryQueuedMessage,
  buildHiddenRetryStartedMessage,
  collectRecentLobsterTaskIdsFromMessages,
  createHiddenRetryErrorTraceMessage,
  createLobsterDebateChatPanelCoordinator,
  createPanelDiagnosticsInspector,
  detectLobsterVerificationSignals,
  formatLobsterVerificationState,
  getAttemptFailureMessage,
  getErrorInfo,
  hasCompleteLobsterCompletionMessages,
  HIDDEN_RETRY_MAX_RETRIES,
  isAbortErrorInfo,
  isCompleteLobsterFinalSummaryContent,
  isHiddenRetryEligibleErrorInfo,
  isLobsterAnswerConclusionMessageForTask,
  isLobsterFinalSummaryMessageForTask,
  isLobsterResumePrompt,
  isLobsterTaskResumable,
  isLobsterTaskSessionCompatible,
  waitForHiddenRetryDelay,
  type ErrorInfo,
} from "./panelDiagnostics";
import {
  applyConfigOrder,
  buildCliCommandNotFoundMessage,
  buildCodexImageSupportWarningKey,
  buildLobsterCompletedConclusionAndSummaryMarkdown,
  buildLobsterDebateConsensusReachedText,
  buildLobsterDebateConsensusStartedText,
  buildLobsterDebateDialogueTurnStartedText,
  buildLobsterDebateFinalStanceStartedText,
  buildLobsterDebateModeratorFinishedText,
  buildLobsterDebateModeratorStartedText,
  buildLobsterDebateNeedsReviewText,
  buildLobsterDebateParticipantFinishedText,
  buildLobsterDebateParticipantRosterFailedText,
  buildLobsterDebateParticipantRosterFinishedText,
  buildLobsterDebateParticipantRosterStartedText,
  buildLobsterDebateParticipantStartedText,
  buildLobsterDebateParticipantsCollectedText,
  buildLobsterDebateRerunText,
  buildLobsterDebateReuseText,
  buildLobsterDebateStartedText,
  buildLobsterRoundSummary,
  buildLobsterSupplementalRequirementsLines,
  createConfigHeartbeatCoordinator,
  getWorkspacePreferredConfigIdForCli as getWorkspacePreferredConfigIdForCliFromSettings,
  loadConfigStateWithDeps,
  matchesActiveConfig,
  normalizeCliInstallStatus,
  normalizeJson,
  normalizeLobsterSupplementalRequirement,
  probeCodexImageSupportStatus,
  resolveLobsterResumeRound,
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
  isLobsterTaskRole,
  isMacTaskShell,
  isThinkingMode,
  isLobsterTaskBlockedByMainAiFailureLimit as isLobsterTaskBlockedByMainAiFailureLimitWithLimit,
  isLobsterTaskCompleted,
  normalizeVisibleInteractiveMode,
  normalizeRawStreamContent,
  readTaskStore as readTaskStoreWithDeps,
  resolveLobsterTaskSessionId as resolveLobsterTaskSessionIdWithDeps,
  resolvePromptRunTargetSessionId as resolvePromptRunTargetSessionIdWithDeps,
  sendPanelMessageWithActiveTab,
  writeTaskStore as writeTaskStoreWithDeps,
  type LobsterTaskRole,
  type LobsterTaskStatus,
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
const lobsterDebateChatPanelsByTaskId = new Map<string, LobsterDebateChatPanel>();
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
let sessionTabsController: SessionTabsController;
let sessionLifecycleController: SessionLifecycleController;
const SESSION_STORE_KEY = "sessionStore";
const SESSION_BUFFER_LIMIT = 4000;
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
const LOBSTER_DEFAULT_MAX_ROUNDS = 20;
const LOBSTER_MIN_MAX_ROUNDS = 1;
const LOBSTER_MAX_MAX_ROUNDS = 100;
const LOBSTER_PARALLEL_SUBTASK_MAX = 6;
const LOBSTER_SUBTASK_RETRY_MAX_RETRIES = 5;
const LOBSTER_SUBTASK_RETRY_DELAY_MS = 60 * 1000;
const LOBSTER_SUBTASK_PROMPT_MIN_LENGTH = 80;
const LOBSTER_DEBATE_DEFAULT_DEBATE_ROUND = 1;
const LOBSTER_DEBATE_ARTIFACT_SUMMARY_LIMIT = 1200;
const HISTORY_RETENTION_CLEAN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CODEX_IMAGE_MIN_VERSION = "0.2.0";
const CODEX_IMAGE_SUPPORT_CACHE_MS = 5 * 60 * 1000;
const CODEX_IMAGE_SUPPORT_TIMEOUT_MS = 5000;
const CONFIG_HEARTBEAT_INTERVAL_MS = 5000;
const COMMON_COMMAND_LABELS: Record<"compactContext", string> = {
  compactContext: t("common.compactContext"),
};
const CLI_INSTALL_TERMINAL_PREFIX = "CLI Install";
const WORKSPACE_HARNESS_TERMINAL_NAME = "Workspace Harness Setup";
const CODEGRAPH_SETUP_COMMAND = "codegraph install --target codex --location global && codegraph init";
const ARCHITECTURE_INITIALIZATION_DISPLAY_PROMPT = "初始化当前工作区 ARCHITECTURE.md";
const UNNAMED_SESSION_LABELS = new Set([
  t("session.unnamed", undefined, "zh-CN"),
  t("session.unnamed", undefined, "en"),
]);

function shouldUseFallbackSessionLabel(label: string | null | undefined): boolean {
  return shouldUseFallbackSessionLabelWithSet(label, UNNAMED_SESSION_LABELS);
}
const LEGACY_GEMINI_THINKING_SETTINGS_PATH = ".gemini/settings.json";
const CLI_RULE_PATHS_GLOBAL: Record<CliName, string> = {
  codex: path.join(os.homedir(), ".codex", "AGENTS.md"),
  claude: path.join(os.homedir(), ".claude", "CLAUDE.md"),
  gemini: path.join(os.homedir(), ".gemini", "GEMINI.md"),
};
const CLI_RULE_FILENAMES_PROJECT: Record<CliName, string> = {
  codex: "AGENTS.md",
  claude: "CLAUDE.md",
  gemini: "GEMINI.md",
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
  taskRole?: LobsterTaskRole;
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
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
  taskRole?: LobsterTaskRole;
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
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
  gemini: null,
};
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
    collectRunningLobsterTaskIds,
    resolveConversationTabLobsterContext,
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
  // Restore currentCli from workspace settings, or use default
  currentCli = workspaceSettings.currentCli || getDefaultCli();
  modelStore = loadModelStore();
  initializeConversationTabsFromWorkspaceSettings();
  repairSupersededLocalSessions({ notifyPanel: false });
  syncCurrentSessionWithActiveTab();
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
    openLobsterDebateChatPanel,
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

export function deactivate(): void {
  void restoreMarketplaceUpdateCheck();
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
    selectCliLobsterModel,
    setCliModelLobsterRole,
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
    isInteractiveMode,
    normalizeVisibleInteractiveMode,
    setWorkspaceLobsterExecutionModeForCli,
    loadModelStore: () => { modelStore = loadModelStore(); },
    normalizeLobsterMaxRounds,
    normalizeToolSettingsLocale,
    isCliName,
    updateStoredToolSettings,
    isMacTaskShell,
    confirmAndInitializeWorkspaceHarness,
    appendUserMessageForCli,
    runContextCompactionCommand,
    openLobsterDebateChatPanel,
    getActiveConversationTabId,
    getActiveConversationTab,
    resolveLobsterSubtaskConversationContext,
    getWorkspaceLobsterExecutionMode,
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
    getSelectedLobsterCliModel,
    getLatestLobsterRoundRunRecord,
    recordPromptHistory,
    resolvePromptRunTarget,
    preloadUserMessageForPrompt,
    runLobsterPrompt,
    runPrompt,
    maybeWakeLobsterMainAfterSubtaskContinuation,
    resolveLobsterResumeTaskFromPrompt,
    isLobsterResumePrompt,
    stopRunForTab,
  });
}

async function buildPanelState(): Promise<PanelState> {
  ensureWorkspaceSessionStore();
  const configState = await loadConfigState(currentCli);
  return buildPanelStateFromConfigState(configState);
}

async function buildPanelStateWithConfigState(
  configState: PanelState["configState"]
): Promise<PanelState> {
  ensureWorkspaceSessionStore();
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
    getWorkspaceAutoCompactContextAfterRun,
    getWorkspaceCodexMultiAgentEnabled,
    getGlobalLobsterMaxRounds,
    getGlobalLobsterAutoCloseSubtaskTabs,
    buildWorkspaceLobsterExecutionModeByCli,
    getDebugLogging,
    getLocaleSetting,
    getMacTaskShell,
    getEffectiveThinkingMode,
    getWorkspaceInteractiveMode,
    isInteractiveSupported,
    getProjectRulePaths,
    buildSessionState,
    buildConversationTabsState,
    buildPromptHistoryState,
    buildLobsterGroupChatHistoryState,
    buildModelState,
    buildEditorContextState,
    resolveModelConfigIdForCli,
    getSelectedCliModel,
  });
}

async function postPanelState(): Promise<void> {
  const state = await buildPanelState();
  updateConfigHeartbeatSnapshot(state.currentCli, state.configState);
  viewProvider?.postState(state);
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
  getSelectedLobsterCliModel,
  normalizeLobsterModelRoleFlags,
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

function saveStoredToolSettings(next: ToolSettingsState): void {
  try {
    writeToolSettings(next);
  } catch (error) {
    void logError("tool-settings-write-error", { error: String(error) });
  }
}

function updateStoredToolSettings(patch: Partial<ToolSettingsState>): void {
  saveStoredToolSettings({
    ...readToolSettings(),
    ...patch,
  });
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
      gemini: null,
    };
  }
  return {
    codex: path.join(root, CLI_RULE_FILENAMES_PROJECT.codex),
    claude: path.join(root, CLI_RULE_FILENAMES_PROJECT.claude),
    gemini: path.join(root, CLI_RULE_FILENAMES_PROJECT.gemini),
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
  return targets.filter((target) => CLI_LIST.includes(target));
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

function readGeminiSettingsFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function buildLegacyManagedGeminiThinkingSettings(mode: "low" | "medium" | "high"): Record<string, unknown> {
  return {
    modelConfigs: {
      "chat-base-3": {
        modelConfig: {
          generateContentConfig: {
            thinkingConfig: {
              thinkingLevel: mode,
            },
          },
        },
      },
      "gemini-3-pro-preview": {
        extends: "chat-base-3",
        modelConfig: {
          model: "gemini-3-pro-preview",
        },
      },
      "gemini-3-flash-preview": {
        extends: "chat-base-3",
        modelConfig: {
          model: "gemini-3-flash-preview",
        },
      },
    },
  };
}

function isLegacyManagedGeminiThinkingSettings(settings: Record<string, unknown>): boolean {
  const normalized = stableStringify(settings);
  return (["low", "medium", "high"] as const).some((mode) => (
    normalized === stableStringify(buildLegacyManagedGeminiThinkingSettings(mode))
  ));
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

function cleanupLegacyGeminiThinkingSettings(cwd: string | undefined): void {
  if (!cwd) {
    return;
  }
  const targetPath = resolveWorkspaceFilePath(cwd, LEGACY_GEMINI_THINKING_SETTINGS_PATH);
  const parsed = readGeminiSettingsFile(targetPath);
  if (!parsed || !isLegacyManagedGeminiThinkingSettings(parsed)) {
    return;
  }
  try {
    fs.rmSync(targetPath, { force: true });
    void logInfo("gemini-legacy-thinking-settings-removed", { targetPath });
  } catch (error) {
    void logError("gemini-legacy-thinking-settings-remove-failed", {
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
      cleanupLobsterTaskStoreRetention();
      cleanupLobsterCommunicationRetention();
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
    envContent: config.envContent,
    configContent: config.configContent,
    authContent: config.authContent,
    codexSkills: config.codexSkills,
    claudeSkills: config.claudeSkills,
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

const lobsterDebateChatPanelCoordinator = createLobsterDebateChatPanelCoordinator({
  getExtensionUri: () => extensionUri,
  panelsByTaskId: lobsterDebateChatPanelsByTaskId,
  defaultDebateRound: LOBSTER_DEBATE_DEFAULT_DEBATE_ROUND,
  normalizeTaskId: normalizeLobsterTaskId,
  normalizeSupplementalRequirement: normalizeLobsterSupplementalRequirement,
  appendSupplementalRequirement: appendLobsterSupplementalRequirement,
  appendSupplementalRequirementToCommunication: appendLobsterSupplementalRequirementToCommunication,
  readTaskRecord: readLobsterTaskRecord,
  updateTaskRecord: updateLobsterTaskRecord,
  listTaskStoreFiles: listLobsterTaskStoreFiles,
  readTaskStoreTasks: (filePath) => readLobsterTaskStore(filePath).tasks,
  collectRunningTaskIds: collectRunningLobsterTaskIds,
  readTextFileIfNonEmpty,
  fileExists: (filePath) => fs.existsSync(filePath),
  writeTextFileEnsuringDir,
  getActiveSubtaskIds: getActiveLobsterSubtaskIds,
  buildCompletedConclusionAndSummaryMarkdown: buildLobsterCompletedConclusionAndSummaryMarkdown,
  resolveMainPromptTarget: resolveLobsterMainPromptTarget,
  revealPanelView,
  switchVisibleConversationTabForLobster: async (tabId) => {
    if (tabId) {
      await switchVisibleConversationTabForLobster(tabId);
    }
  },
  isTabRunActive,
  getActiveConfigIdForCli,
  getSelectedCliModel,
  getSelectedLobsterCliModel,
  runLobsterPrompt,
  stopRunsForTask: stopLobsterRunsForTask,
  markTaskStoppedByUser: markLobsterTaskStoppedByUser,
  postPanelState,
  getActiveConversationTaskId: () => (
    normalizeLobsterTaskId(activeTaskRun?.lobsterTaskId)
      ?? resolveActiveConversationLobsterTaskId()
  ),
  showInformationMessage: (message) => { void vscode.window.showInformationMessage(message); },
  showWarningMessage: (message) => { void vscode.window.showWarningMessage(message); },
  pickTask: pickLobsterDebateTask,
  t,
});

async function openLobsterDebateChatPanel(arg?: unknown): Promise<void> {
  await lobsterDebateChatPanelCoordinator.open(arg);
}

function normalizeLobsterContinuePrompt(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || t("run.hiddenContinuePrompt");
}

function normalizeLobsterContinuePromptForPrompt(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function refreshOpenLobsterDebateChatPanelForTask(taskId: string): void {
  lobsterDebateChatPanelCoordinator.refreshOpenPanelForTask(taskId);
}

function resolveActiveConversationLobsterTaskId(): string | null {
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    return null;
  }
  return resolveConversationTabLobsterContext(activeTab).lobsterTaskId;
}

async function pickLobsterDebateTask(tasks: LobsterTaskRecord[]): Promise<LobsterTaskRecord | null> {
  const items = tasks.map((task) => ({
    label: task.rootPrompt.split(/\r?\n/g)[0]?.slice(0, 80) || task.id,
    description: `${task.status} · ${task.cli} · ${task.id}`,
    detail: task.taskStoreFile,
    task,
  }));
  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: t("lobsterDebateChat.selectTask"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return selection?.task ?? null;
}

function listLobsterGroupChatTasks(): LobsterTaskRecord[] {
  return lobsterDebateChatPanelCoordinator.listGroupChatTasks();
}

function stopLobsterRunsForTask(taskId: string): void {
  const runningTaskIds = collectRunningLobsterTaskIds();
  if (!runningTaskIds.has(taskId)) {
    return;
  }

  const parallelTabIds = Array.from(parallelRunsByTabId.entries())
    .filter(([, run]) => resolveLobsterConversationTabContextFromParallelRun(run).lobsterTaskId === taskId)
    .map(([tabId]) => tabId);
  parallelTabIds.forEach((tabId) => {
    stopParallelRunForTab(tabId);
  });

  const interactiveTabIds = Array.from(interactiveRunsByTabId.entries())
    .filter(([, run]) => resolveLobsterConversationTabContextFromInteractiveRun(run).lobsterTaskId === taskId)
    .map(([tabId]) => tabId);
  interactiveTabIds.forEach((tabId) => {
    const run = interactiveRunsByTabId.get(tabId);
    run?.stop();
  });

  const primaryTaskId = resolvePrimaryLobsterTaskId();
  if (primaryTaskId === taskId) {
    stopActiveRun();
  }
}

function resolvePrimaryLobsterTaskId(): string | null {
  if (!isPrimaryRunActive()) {
    return null;
  }
  return normalizeLobsterTaskId(activeTaskRun?.lobsterTaskId)
    ?? (Array.isArray(activeMessageTarget)
      ? resolveLobsterConversationTabContextFromMessages(activeMessageTarget).lobsterTaskId
      : null);
}

function buildLobsterDebateChatMessageAction(taskId: string, round?: number): ChatMessageAction {
  return lobsterDebateChatPanelCoordinator.buildMessageAction(taskId, round);
}

function buildLobsterTaskNeedsReviewText(task: LobsterTaskRecord): string {
  return buildLobsterTaskNeedsReviewTextWithLimit(task, isLobsterTaskBlockedByMainAiFailureLimit);
}

function buildLobsterSubtaskRetryText(taskId: string, subtaskId: string, retryCount: number): string {
  return buildLobsterSubtaskRetryTextWithLimit(
    taskId,
    subtaskId,
    retryCount,
    LOBSTER_SUBTASK_RETRY_MAX_RETRIES,
  );
}

function ensureLobsterMainSubChatTranscript(task: LobsterTaskRecord): string {
  return ensureLobsterMainSubChatTranscriptWithDeps(task, {
    collectRunningLobsterTaskIds,
    readTextFileIfNonEmpty,
    fileExists: (filePath) => fs.existsSync(filePath),
    writeTextFileEnsuringDir,
    getActiveLobsterSubtaskIds,
    buildLobsterCompletedConclusionAndSummaryMarkdown,
    t,
  });
}

type PromptRunInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  model?: string;
  lobsterExecutionMode?: LobsterExecutionMode;
  lobsterMainModel?: string;
  lobsterSubtaskModel?: string;
  lobsterContinuePrompt?: string;
  imagePaths?: string[];
  taskRole?: LobsterTaskRole;
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
};

type PromptRunTarget = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};

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

function resolveLobsterConversationTabContextFromParallelRun(
  run?: ParallelTabRun
): LobsterConversationTabContext {
  return resolveLobsterRunConversationTabContext(run);
}

function resolveLobsterConversationTabContextFromInteractiveRun(
  run?: InteractiveTabRun
): LobsterConversationTabContext {
  return resolveLobsterRunConversationTabContext(run);
}

function resolveConversationTabLobsterContext(tab: ConversationTabRecord): LobsterConversationTabContext {
  const primaryTabId = getPrimaryRunTabId();
  if (primaryTabId === tab.id) {
    const taskRole = activeTaskRun?.taskRole;
    const lobsterTaskId = normalizeLobsterTaskId(activeTaskRun?.lobsterTaskId);
    if ((taskRole === "main" || taskRole === "subtask") && lobsterTaskId) {
      return {
        taskRole,
        lobsterTaskId,
      };
    }
  }

  const parallelContext = resolveLobsterConversationTabContextFromParallelRun(parallelRunsByTabId.get(tab.id));
  if (parallelContext.taskRole && parallelContext.lobsterTaskId) {
    return parallelContext;
  }

  const interactiveContext = resolveLobsterConversationTabContextFromInteractiveRun(interactiveRunsByTabId.get(tab.id));
  if (interactiveContext.taskRole && interactiveContext.lobsterTaskId) {
    return interactiveContext;
  }

  const liveMessages = getLiveMessagesForTab(tab.id);
  if (liveMessages) {
    const liveContext = resolveLobsterConversationTabContextFromMessages(liveMessages);
    if (liveContext.taskRole && liveContext.lobsterTaskId) {
      return liveContext;
    }
  }

  const sessionId = getConversationTabSessionIdForCli(tab, tab.cli);
  const messages = sessionId
    ? loadSessionMessages(tab.cli, sessionId)
    : getPendingSessionDraft(tab.id, tab.cli).messages;
  return resolveLobsterConversationTabContextFromMessages(messages);
}

function collectRunningLobsterTaskIds(): Set<string> {
  const runningTaskIds = new Set<string>();
  const addTaskId = (value: unknown): void => {
    const taskId = normalizeLobsterTaskId(value);
    if (taskId) {
      runningTaskIds.add(taskId);
    }
  };

  if (isPrimaryRunActive()) {
    const primaryTaskId = normalizeLobsterTaskId(activeTaskRun?.lobsterTaskId)
      ?? (Array.isArray(activeMessageTarget)
        ? resolveLobsterConversationTabContextFromMessages(activeMessageTarget).lobsterTaskId
        : null);
    addTaskId(primaryTaskId);
  }

  parallelRunsByTabId.forEach((run) => {
    const taskId = normalizeLobsterTaskId(run.lobsterTaskId)
      ?? resolveLobsterConversationTabContextFromMessages(run.messageTarget).lobsterTaskId;
    addTaskId(taskId);
  });

  interactiveRunsByTabId.forEach((run) => {
    const taskId = normalizeLobsterTaskId(run.lobsterTaskId)
      ?? resolveLobsterConversationTabContextFromMessages(run.messageTarget).lobsterTaskId;
    addTaskId(taskId);
  });

  return runningTaskIds;
}

function resolveAutoInteractiveModeForConversationTab(
  tab: ConversationTabRecord | null
): InteractiveMode {
  if (!tab) {
    return "coding";
  }
  const context = resolveConversationTabLobsterContext(tab);
  return context.taskRole === "main" || context.taskRole === "subtask"
    ? "lobster"
    : "coding";
}

function isLobsterMainTabCloseLocked(tabId: string | null): boolean {
  if (!tabId) {
    return false;
  }
  const tab = getConversationTabById(tabId);
  if (!tab) {
    return false;
  }
  const context = resolveConversationTabLobsterContext(tab);
  if (context.taskRole !== "main" || !context.lobsterTaskId) {
    return false;
  }
  const runningTaskIds = collectRunningLobsterTaskIds();
  return runningTaskIds.has(context.lobsterTaskId);
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

function collectRecentLobsterTaskIdsForTarget(target: PromptRunTarget, limit = 12): string[] {
  return collectRecentLobsterTaskIdsFromMessages(getLobsterMessagesForTarget(target), limit);
}

function isLobsterTaskCompatibleWithTarget(
  task: LobsterTaskRecord,
  target: PromptRunTarget,
  options: { allowMissingTaskSessionId?: boolean } = {}
): boolean {
  if (task.cli !== target.cli || task.workspaceKey !== activeWorkspaceKey) {
    return false;
  }
  const targetSessionId = resolveLobsterTaskSessionId(target);
  return isLobsterTaskSessionCompatible(task, targetSessionId, options);
}

function findResumableLobsterTaskForTarget(target: PromptRunTarget): LobsterTaskRecord | null {
  const candidates: LobsterTaskRecord[] = [];
  const seenTaskIds = new Set<string>();

  const appendCandidate = (
    task: LobsterTaskRecord | null | undefined,
    options: { allowMissingTaskSessionId?: boolean } = {}
  ): void => {
    if (
      !task
      || seenTaskIds.has(task.id)
      || !isLobsterTaskCompatibleWithTarget(task, target, {
        allowMissingTaskSessionId: options.allowMissingTaskSessionId,
      })
    ) {
      return;
    }
    seenTaskIds.add(task.id);
    candidates.push(task);
  };

  const recentTaskIds = collectRecentLobsterTaskIdsForTarget(target);
  recentTaskIds.forEach((taskId) => {
    appendCandidate(readLobsterTaskRecord(taskId), { allowMissingTaskSessionId: true });
  });

  const targetSessionId = resolveLobsterTaskSessionId(target);
  if (targetSessionId) {
    const sessionStoreFile = getLobsterTaskStoreSessionFile(activeWorkspaceKey, target.cli, targetSessionId);
    const sessionStore = readLobsterTaskStore(sessionStoreFile);
    sessionStore.tasks
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .forEach((task) => {
        appendCandidate(
          task.taskStoreFile === sessionStoreFile ? task : { ...task, taskStoreFile: sessionStoreFile }
        );
      });
  }

  const resumable = candidates
    .filter((task) => isLobsterTaskResumable(task) || (
      task.status === "completed" && !hasCompleteLobsterCompletionMessagesForTask(target, task.id)
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return resumable[0] ?? null;
}

function resolveLobsterResumeTaskFromPrompt(
  prompt: string,
  targetTabId: string | null | undefined
): LobsterTaskRecord | null {
  if (!isLobsterResumePrompt(prompt)) {
    return null;
  }
  const target = resolvePromptRunTarget(targetTabId ?? null);
  if (!target) {
    return null;
  }
  return findResumableLobsterTaskForTarget(target);
}

function sendRunStatusForTab(
  tabId: string,
  status: "start" | "end" | "error" | "stopped",
  options: { message?: string; prompt?: string; startedAt?: number } = {}
): void {
  sendPanelMessage({
    type: "runStatus",
    status,
    message: options.message,
    prompt: status === "start" ? options.prompt : undefined,
    startedAt: status === "start" ? options.startedAt : undefined,
    tabId,
  });
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
    lobsterTaskId: run.lobsterTaskId,
    lobsterRound: run.lobsterRound,
    lobsterSubtaskId: run.lobsterSubtaskId,
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
    stopActiveRun();
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

async function runPromptParallel(input: PromptRunInput, target: PromptRunTarget): Promise<void> {
  const prompt = input.displayPrompt;
  if (!prompt) {
    return;
  }
  const runCli = target.cli;
  if (runCli !== "gemini") {
    throw new Error(`parallel-run-unsupported:${runCli}`);
  }
  const modelPrompt = input.modelPrompt || prompt;
  const contextTags = Array.isArray(input.contextTags)
    ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  const cwd = resolveWorkspaceCwd();
  const selectedModel = input.model || getSelectedCliModel(runCli);
  const thinkingMode = getEffectiveThinkingMode(runCli, selectedModel);
  applyThinkingWorkspaceFiles(runCli, thinkingMode, cwd);
  const geminiRunProfile = prepareGeminiRunProfile(selectedModel, thinkingMode, cwd);
  const runtimeModel = geminiRunProfile.runtimeModel ?? selectedModel;
  const runtimeEnvOverrides = geminiRunProfile.envOverrides;
  const shouldAutoCompactAfterRun = shouldAutoCompactContextAfterRunForTarget(target);

  preparePendingLabel(runCli, target.tabId, prompt);
  let sessionId = target.sessionId;
  const thinkingPrompt = buildThinkingPrompt(runCli, thinkingMode, modelPrompt);
  const hiddenRetryPrompt = buildHiddenRetryPrompt(runCli, thinkingMode);
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
  sendRunStatusForTab(target.tabId, "start", { prompt, startedAt });

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
      lobsterTaskId: input.lobsterTaskId,
      lobsterRound: input.lobsterRound,
      lobsterSubtaskId: input.lobsterSubtaskId,
    });
  };

  while (true) {
    const attemptNumber = hiddenRetryCount + 1;
    const attemptPrompt = hiddenRetryCount === 0 ? thinkingPrompt : hiddenRetryPrompt;
    let attemptHadNormalReply = false;

    if (hiddenRetryCount > 0) {
      const retryNumber = hiddenRetryCount;
      const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
      const shouldContinue = await waitForHiddenRetryDelay(retryNumber, isParallelRunActive);
      if (!shouldContinue) {
        return;
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
      });
    }

    let rawStdout = "";
    let rawStderr = "";
    const geminiStreamState = { remainder: "", assistantText: "", resultStatus: null as string | null, errorText: null as string | null };
    const attemptResult = await new Promise<
      { type: "exit"; code: number | null }
      | { type: "error"; error: Error }
    >((resolve) => {
      let settled = false;
      const settle = (result: { type: "exit"; code: number | null } | { type: "error"; error: Error }): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };
      const process = runCliStream(
        runCli,
        attemptPrompt,
        {
          onStdout: (chunk: string) => {
            if (!isParallelRunActive()) {
              return;
            }
            rawStdout += chunk;
            sendPanelMessage({ type: "rawStreamDelta", content: chunk, stream: "stdout", tabId: target.tabId });
            processGeminiStreamJsonChunk(geminiStreamState, chunk, {
              onAssistantText: (text) => {
                if (text.trim().length > 0) {
                  attemptHadNormalReply = true;
                }
              },
              onPlainText: (text) => {
                if (text.trim().length > 0) {
                  attemptHadNormalReply = true;
                }
              },
              onSessionId: (nextSessionId) => {
                if (!sessionId) {
                  sessionId = nextSessionId;
                  adoptSessionId(runCli, nextSessionId, target.tabId);
                  messageTarget = loadSessionMessages(runCli, nextSessionId);
                  syncParallelRun(process);
                }
              },
            });
          },
          onStderr: (chunk: string) => {
            if (!isParallelRunActive()) {
              return;
            }
            rawStderr += chunk;
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
          sessionId,
          thinkingMode,
          model: runtimeModel,
          envOverrides: runtimeEnvOverrides,
          processLabel: buildProcessLabel(runCli, sessionId ?? runId),
        }
      );
      syncParallelRun(process);
    });

    if (!isParallelRunActive()) {
      return;
    }

    finalizeGeminiStreamJsonState(geminiStreamState, {
      onAssistantText: (text) => {
        if (text.trim().length > 0) {
          attemptHadNormalReply = true;
        }
      },
      onPlainText: (text) => {
        if (text.trim().length > 0) {
          attemptHadNormalReply = true;
        }
      },
      onSessionId: (nextSessionId) => {
        if (!sessionId) {
          sessionId = nextSessionId;
          adoptSessionId(runCli, nextSessionId, target.tabId);
          messageTarget = loadSessionMessages(runCli, nextSessionId);
        }
      },
    });
    const detectedSessionId = extractSessionId(runCli, `${rawStdout}
${rawStderr}`);
    if (!sessionId && detectedSessionId) {
      sessionId = detectedSessionId;
      adoptSessionId(runCli, detectedSessionId, target.tabId);
      messageTarget = loadSessionMessages(runCli, detectedSessionId);
    }

    if (attemptResult.type === "exit" && attemptResult.code === 0) {
      const currentMessageTarget = resolveParallelMessageTarget();
      const finalText = String(geminiStreamState.assistantText || "").trim();
      if (finalText) {
        const assistantMessage: ChatMessage = {
          id: createMessageId(),
          role: "assistant",
          content: finalText,
          createdAt: Date.now(),
          taskRole: input.taskRole,
          lobsterTaskId: input.lobsterTaskId,
          lobsterRound: input.lobsterRound,
          lobsterSubtaskId: input.lobsterSubtaskId,
        };
        appendMessageToStore(currentMessageTarget, assistantMessage);
        sendPanelMessage({ type: "appendMessage", message: assistantMessage, tabId: target.tabId });
      }
      if (!hasAssistantFinalConclusionAfterMessage(currentMessageTarget, userMessageId, {
        fallbackCreatedAt: userCreatedAt,
      })) {
        const missingConclusionMessage = t("run.missingFinalConclusionRetryReason");
        if (hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES) {
          appendHiddenRetryErrorTraceMessage(currentMessageTarget, missingConclusionMessage, {
            tabId: target.tabId,
            taskRole: input.taskRole,
            lobsterTaskId: input.lobsterTaskId,
            lobsterRound: input.lobsterRound,
            lobsterSubtaskId: input.lobsterSubtaskId,
          }, { createMessageId, sendPanelMessage });
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
          void logInfo("runPrompt-parallel-missing-final-conclusion-retry", {
            cli: runCli,
            tabId: target.tabId,
            runId,
            sessionId,
            retryCount: hiddenRetryCount,
            maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          });
          continue;
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
          status: "error",
          taskRole: input.taskRole,
          lobsterTaskId: input.lobsterTaskId,
          lobsterRound: input.lobsterRound,
          lobsterSubtaskId: input.lobsterSubtaskId,
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
        lobsterTaskId: input.lobsterTaskId,
        lobsterRound: input.lobsterRound,
        lobsterSubtaskId: input.lobsterSubtaskId,
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
        lobsterTaskId: input.lobsterTaskId,
        lobsterRound: input.lobsterRound,
        lobsterSubtaskId: input.lobsterSubtaskId,
      });
      if (shouldAutoCompactAfterRun) {
        await maybeAutoCompactContextAfterPromptSuccess(target, sessionId, taskRecord.durationMs);
      }
      return;
    }

    const retryableErrorInfo = attemptResult.type === "error"
      ? getErrorInfo(attemptResult.error)
      : null;
    const geminiResultFailed = attemptResult.type === "exit"
      && attemptResult.code === 0
      && geminiStreamState.resultStatus !== null
      && geminiStreamState.resultStatus !== "success";
    const lastFailureMessage = getAttemptFailureMessage(attemptResult, geminiStreamState.errorText);
    hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
    const shouldRetry = hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES && (
      geminiResultFailed
        || attemptResult.type === "exit"
        || isHiddenRetryEligibleErrorInfo(retryableErrorInfo ?? { message: "" })
    );
    const failureMessageTarget = resolveParallelMessageTarget();
    if (shouldRetry) {
      appendHiddenRetryErrorTraceMessage(failureMessageTarget, lastFailureMessage, {
        tabId: target.tabId,
        taskRole: input.taskRole,
        lobsterTaskId: input.lobsterTaskId,
        lobsterRound: input.lobsterRound,
        lobsterSubtaskId: input.lobsterSubtaskId,
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
    const finalText = String(geminiStreamState.assistantText || rawStdout || "").trim();
    if (finalText) {
      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: finalText,
        createdAt: Date.now(),
      };
      appendMessageToStore(failureMessageTarget, assistantMessage);
      sendPanelMessage({ type: "appendMessage", message: assistantMessage, tabId: target.tabId });
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
      lobsterTaskId: input.lobsterTaskId,
      lobsterRound: input.lobsterRound,
      lobsterSubtaskId: input.lobsterSubtaskId,
    };
    appendTaskRun(taskRecord);

    const userMessageText = buildHiddenRetryFailureMessage({
      hiddenRetryCount,
      maxRetries: HIDDEN_RETRY_MAX_RETRIES,
      retryLimitMessage: buildHiddenRetryLimitMessage(),
      fallbackMessage: lastFailureMessage,
      lastFailureMessage,
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

async function runLobsterPrompt(
  input: PromptRunInput,
  options: { targetTabId?: string | null; resumeTaskId?: string | null; resumeRequested?: boolean } = {}
): Promise<void> {
  const target = resolvePromptRunTarget(options.targetTabId ?? getActiveConversationTabId());
  if (!target || !input.displayPrompt.trim()) {
    return;
  }

  const resumeTaskId = typeof options.resumeTaskId === "string" && options.resumeTaskId.trim()
    ? options.resumeTaskId.trim()
    : null;
  const resumeRequested = options.resumeRequested === true;

  let task: LobsterTaskRecord | null = null;
  let round = 1;

  if (resumeTaskId) {
    const existingTask = readLobsterTaskRecord(resumeTaskId);
    if (existingTask && isLobsterTaskBlockedByMainAiFailureLimit(existingTask)) {
      appendSystemMessageForLobster(target, buildLobsterTaskNeedsReviewText(existingTask));
      return;
    }
    const shouldResumeCompletedWithoutCompletionMessages = Boolean(
      existingTask
      && existingTask.status === "completed"
      && !hasCompleteLobsterCompletionMessagesForTask(target, existingTask.id)
    );
    if (
      existingTask
      && isLobsterTaskCompatibleWithTarget(existingTask, target, { allowMissingTaskSessionId: true })
      && (!isLobsterTaskCompleted(existingTask) || shouldResumeCompletedWithoutCompletionMessages)
    ) {
      task = updateLobsterTaskRecord(existingTask.id, {
        status: "running",
        activeSubtaskId: null,
        activeSubtaskIds: [],
        updatedAt: Date.now(),
      }, { allowCompletedToRunning: shouldResumeCompletedWithoutCompletionMessages }) ?? existingTask;
      round = resolveLobsterResumeRound(task);
      appendSystemMessageForLobster(target, buildLobsterTaskResumedText(task, round), (
        {
          taskRole: "main",
          lobsterTaskId: task.id,
          lobsterRound: round,
          merge: false,
          actions: [buildLobsterDebateChatMessageAction(task.id, round)],
        }
      ));
      void logInfo("lobster-task-resumed", {
        taskId: task.id,
        round,
        tabId: target.tabId,
        cli: target.cli,
        completedWithoutCompletionMessages: shouldResumeCompletedWithoutCompletionMessages,
      });
      if (!input.lobsterContinuePrompt) {
        input = {
          ...input,
          lobsterContinuePrompt: normalizeLobsterContinuePrompt(input.displayPrompt || input.modelPrompt),
        };
      }
    }
  }

  if (!task) {
    if (resumeRequested) {
      appendSystemMessageForLobster(target, t("run.lobsterResumeUnavailableStartNew"));
      void logInfo("lobster-task-resume-not-found", {
        tabId: target.tabId,
        cli: target.cli,
      });
    }
    const initialSessionId = resolveLobsterTaskSessionId(target);
    task = createLobsterTaskRecord(target.cli, input.displayPrompt, {
      sessionId: initialSessionId,
      executionMode: input.lobsterExecutionMode,
    });
    if (!isLobsterDebateGroupChatTask(task)) {
      ensureLobsterMainSubChatTranscript(task);
    }
    appendSystemMessageForLobster(target, buildLobsterTaskStartedText(task), (
      {
        taskRole: "main",
        lobsterTaskId: task.id,
        merge: false,
        actions: [buildLobsterDebateChatMessageAction(task.id)],
      }
    ));
  }

  while (task && round <= task.maxRounds) {
    const latest: LobsterTaskRecord = readLobsterTaskRecord(task.id) ?? task;
    task = latest;
    if (isLobsterTaskBlockedByMainAiFailureLimit(latest)) {
      appendSystemMessageForLobster(target, buildLobsterTaskNeedsReviewText(latest));
      return;
    }
    if (isLobsterTaskCompleted(latest)) {
      if (hasCompleteLobsterCompletionMessagesForTask(target, latest.id)) {
        return;
      }
      const resumed = updateLobsterTaskRecord(latest.id, {
        status: "running",
        activeSubtaskId: null,
        activeSubtaskIds: [],
        updatedAt: Date.now(),
      }, { allowCompletedToRunning: true }) ?? latest;
      task = resumed;
      round = resolveLobsterResumeRound(resumed);
      appendSystemMessageForLobster(target, buildLobsterTaskResumedText(resumed, round), (
        {
          taskRole: "main",
          lobsterTaskId: resumed.id,
          lobsterRound: round,
          merge: false,
          actions: [buildLobsterDebateChatMessageAction(resumed.id, round)],
        }
      ));
      void logInfo("lobster-task-completed-without-final-summary-resumed", {
        taskId: resumed.id,
        round,
        tabId: target.tabId,
        cli: target.cli,
      });
      continue;
    }

    const executionMode = normalizeLobsterExecutionMode(latest.executionMode);
    const shouldRunPlanningDebate = executionMode === "debate_multi_agent"
      && shouldRunLobsterPlanningDebate(latest, round);
    let decisionRunResult: LobsterMainDecisionRunResult;
    try {
      decisionRunResult = shouldRunPlanningDebate
        ? await runLobsterDebateRound({ input, target, task: latest, round })
        : await runClassicLobsterMainDecision({
            input,
            target,
            task: latest,
            round,
            moderatorLed: executionMode === "debate_multi_agent",
          });
    } catch (error) {
      void logError("lobster-main-decision-run-error", {
        taskId: latest.id,
        round,
        executionMode,
        shouldRunPlanningDebate,
        error: errorToMessage(error),
      });
      markLobsterTaskInterrupted(latest.id, "error", target, {
        source: "main",
        failureMessage: errorToMessage(error),
      });
      return;
    }

    if (decisionRunResult.status === "interrupted") {
      markLobsterTaskInterrupted(decisionRunResult.task.id, decisionRunResult.runStatus, target, {
        source: "main",
      });
      return;
    }
    if (decisionRunResult.status === "completed") {
      removeLobsterMainDecisionMessage(target, decisionRunResult.task.id, round);
      appendSystemMessageForLobster(target, buildLobsterTaskCompletedText(decisionRunResult.task));
      appendLobsterAnswerConclusionMessage(target, decisionRunResult.task, decisionRunResult.decision);
      appendLobsterFinalSummaryMessage(target, decisionRunResult.task, decisionRunResult.decision);
      return;
    }
    if (decisionRunResult.status === "needs-review") {
      appendSystemMessageForLobster(target, buildLobsterTaskNeedsReviewText(decisionRunResult.task));
      return;
    }

    const subtasks = decisionRunResult.subtasks;
    showLobsterSubtaskDecisionMarkdown(target, decisionRunResult.task, round, subtasks, decisionRunResult.decision);
    const subtaskResults = await runLobsterSubtasksBatchWithRetry({
      input,
      target,
      task: decisionRunResult.task,
      round,
      subtasks,
    });
    const interrupted = subtaskResults.find((result) => result.status === "error" || result.status === "stopped");
    if (interrupted) {
      const interruptedStatus = interrupted.status === "stopped" ? "stopped" : "error";
      markLobsterTaskInterrupted(decisionRunResult.task.id, interruptedStatus, target, {
        source: "subtask",
      });
      return;
    }

    const nextMainRound = round + 1;
    if (nextMainRound <= decisionRunResult.task.maxRounds) {
      appendSystemMessageForLobster(
        target,
        buildLobsterMainResumeText(decisionRunResult.task.id, nextMainRound, subtasks)
      );
    }
    round = nextMainRound;
  }

  if (!task) {
    return;
  }
  const finalRecord = updateLobsterTaskRecord(task.id, {
    status: "needs-review",
    updatedAt: Date.now(),
    finalSummary: "Reached the maximum automatic lobster rounds. Manual review is required.",
  });
  appendSystemMessageForLobster(target, buildLobsterTaskNeedsReviewText(finalRecord ?? task));
}

async function runClassicLobsterMainDecision(options: {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LobsterTaskRecord;
  round: number;
  moderatorLed?: boolean;
}): Promise<LobsterMainDecisionRunResult> {
  const { input, target, task, round } = options;
  const moderatorLed = options.moderatorLed === true;
  let mainStatus: TaskRunStatus;
  try {
    mainStatus = await runLobsterRound({
      input,
      target,
      task,
      round,
      role: "main",
      displayPrompt: moderatorLed
        ? buildLobsterModeratorMainDisplayPrompt(task.rootPrompt, round)
        : buildLobsterMainDisplayPrompt(task.rootPrompt, round),
      modelPrompt: moderatorLed
        ? buildLobsterModeratorMainModelPrompt(
            input.lobsterContinuePrompt ? task.rootPrompt : (input.modelPrompt || task.rootPrompt),
            task,
            round,
            input.lobsterContinuePrompt,
          )
        : buildLobsterMainModelPrompt(
            input.lobsterContinuePrompt ? task.rootPrompt : (input.modelPrompt || task.rootPrompt),
            task,
            round,
            input.lobsterContinuePrompt,
          ),
    });
  } catch (error) {
    void logError("lobster-main-round-run-error", {
      taskId: task.id,
      round,
      error: errorToMessage(error),
    });
    markLobsterTaskInterrupted(task.id, "error", target, {
      source: "main",
      failureMessage: errorToMessage(error),
    });
    return { status: "interrupted", task: readLobsterTaskRecord(task.id) ?? task, runStatus: "error" };
  }
  if (mainStatus === "error" || mainStatus === "stopped") {
    return { status: "interrupted", task, runStatus: mainStatus };
  }

  const mainContent = getLastLobsterAssistantContent(target, task.id, round, "main");
  const decision = parseLobsterMainDecision(mainContent);
  if (!decision) {
    const failedRecord = updateLobsterTaskRecord(task.id, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      updatedAt: Date.now(),
      finalSummary: "Main task did not return a valid lobster decision JSON.",
    }) ?? task;
    return { status: "needs-review", task: failedRecord };
  }

  return applyLobsterMainDecisionForRun(task.id, decision);
}

function applyLobsterMainDecisionForRun(
  taskId: string,
  decision: LobsterMainDecision,
): LobsterMainDecisionRunResult {
  updateLobsterTaskRecord(taskId, {
    ...buildResetLobsterMainAiFailureState(),
    updatedAt: Date.now(),
  });
  const decisionResult = applyLobsterMainDecision(taskId, decision);
  if (decisionResult.status === "completed") {
    return { status: "completed", task: decisionResult.task, decision };
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

type LobsterDebateParticipantArtifactValidation = {
  valid: boolean;
  participants: LobsterDebateParticipantRecord[];
  reasons: string[];
};

type LobsterDebateReusableDecisionResult =
  | {
      status: "reusable";
      decision: LobsterMainDecision;
      consensus: LobsterDebateConsensusRecord<LobsterMainDecision>;
      participants: LobsterDebateParticipantRecord[];
    }
  | {
      status: "needs-review";
      reasons: string[];
      consensus?: LobsterDebateConsensusRecord<LobsterMainDecision>;
      participants: LobsterDebateParticipantRecord[];
    }
  | { status: "rerun"; reasons: string[] };

type LobsterDebateSpeakerBatch = {
  speakerIds: string[];
  speakers: LobsterDebateParticipantDefinition[];
};

function shouldRunLobsterPlanningDebate(task: LobsterTaskRecord, round: number): boolean {
  if (normalizeLobsterExecutionMode(task.executionMode) !== "debate_multi_agent") {
    return false;
  }
  void round;
  return !findReusableLobsterPlanningDebateRound(task);
}

function findReusableLobsterPlanningDebateRound(
  task: LobsterTaskRecord,
): LobsterDebateRoundRecord<LobsterMainDecision> | null {
  const rounds = Array.isArray(task.debateRounds) ? task.debateRounds : [];
  const sortedRounds = rounds
    .filter((round) => round.status === "consensus" && Boolean(round.consensus))
    .slice()
    .sort((left, right) => (
      left.lobsterRound - right.lobsterRound
      || left.debateRound - right.debateRound
      || left.startedAt - right.startedAt
    ));

  for (const round of sortedRounds) {
    const paths = buildLobsterDebatePaths(task.communicationDir, round.lobsterRound, round.debateRound);
    const participants = resolveExistingLobsterDebateParticipantRecords(
      task,
      round.lobsterRound,
      round.debateRound,
      paths,
      undefined,
      buildLobsterDebateSessionState(task, round.lobsterRound, round.debateRound),
    );
    const reusable = evaluateReusableLobsterDebateDecision(
      task,
      round.lobsterRound,
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

function readLobsterPlanningDebateDecision(
  task: LobsterTaskRecord,
  round: Pick<LobsterDebateRoundRecord<LobsterMainDecision>, "lobsterRound" | "debateRound">,
): LobsterMainDecision | null {
  const paths = buildLobsterDebatePaths(task.communicationDir, round.lobsterRound, round.debateRound);
  return parseLobsterMainDecision(readTextFileIfNonEmpty(paths.decisionFile));
}

async function runLobsterDebateRound(options: {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LobsterTaskRecord;
  round: number;
}): Promise<LobsterMainDecisionRunResult> {
  const { input, target, task, round } = options;
  const debateRound = LOBSTER_DEBATE_DEFAULT_DEBATE_ROUND;
  const paths = buildLobsterDebatePaths(task.communicationDir, round, debateRound);
  const model = resolveLobsterDebateModel(input);
  const debateSessions = buildLobsterDebateSessionState(task, round, debateRound);
  const reusableParticipants = resolveExistingLobsterDebateParticipantRecords(
    task,
    round,
    debateRound,
    paths,
    model,
    debateSessions
  );
  const reusable = evaluateReusableLobsterDebateDecision(task, round, debateRound, paths, reusableParticipants);
  if (reusable.status === "reusable") {
    upsertLobsterDebateRoundRecord(task.id, {
      lobsterRound: round,
      debateRound,
      status: "consensus",
      startedAt: getExistingLobsterDebateRoundStartedAt(task, round, debateRound) ?? Date.now(),
      completedAt: Date.now(),
      briefFile: paths.briefFile,
      chatFile: paths.chatFile,
      participantRosterFile: paths.participantRosterFile,
      participants: reusable.participants,
      consensus: reusable.consensus,
    });
    refreshOpenLobsterDebateChatPanelForTask(task.id);
    appendSystemMessageForLobster(target, buildLobsterDebateReuseText(task.id, round, paths));
    appendLobsterDebateMainCommunicationLog(task, round, paths, "复用红蓝对抗共识", [
      `decision.json：${paths.decisionFile}`,
      `consensus.md：${paths.consensusFile}`,
    ]);
    return applyLobsterMainDecisionForRun(task.id, reusable.decision);
  }
  if (reusable.status === "needs-review") {
    return markLobsterDebateNeedsReview({
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
    appendSystemMessageForLobster(target, buildLobsterDebateRerunText(task.id, round, reusable.reasons));
  }

  const startedAt = Date.now();
  const briefWritten = writeTextFileEnsuringDir(
    paths.briefFile,
    buildLobsterDebateBriefMarkdown(task, target, round, paths, input.lobsterContinuePrompt)
  );
  if (!briefWritten) {
    return markLobsterDebateNeedsReview({
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
  const chatWritten = writeTextFileEnsuringDir(paths.chatFile, buildLobsterDebateInitialChatMarkdown(task, target, round, paths));
  if (!chatWritten) {
    return markLobsterDebateNeedsReview({
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

  updateLobsterTaskRecord(task.id, {
    status: "running",
    currentRound: round,
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: startedAt,
  });
  upsertLobsterDebateRoundRecord(task.id, {
    lobsterRound: round,
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
  refreshOpenLobsterDebateChatPanelForTask(task.id);

  const runnerDeps = getLobsterDebateRunnerDeps();
  const debateTabIds: string[] = [];
  const rosterResult = await runLobsterDebateParticipantRoster({
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
  await closeCompletedLobsterDebateTabs([rosterResult.tabId]);
  if (!rosterResult.valid) {
    await closeCompletedLobsterDebateTabs(debateTabIds);
    return markLobsterDebateNeedsReview({
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
  const participantRecords = buildLobsterDebateParticipantRecords(
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
    buildLobsterDebateParticipantRosterChatMarkdown(
      participantDefinitions,
      rosterResult.summary,
      rosterResult.openingSpeakerIds,
    )
  );
  if (!rosterAppended) {
    await closeCompletedLobsterDebateTabs(debateTabIds);
    return markLobsterDebateNeedsReview({
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

  upsertLobsterDebateRoundRecord(task.id, {
    lobsterRound: round,
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
  refreshOpenLobsterDebateChatPanelForTask(task.id);
  appendSystemMessageForLobster(target, buildLobsterDebateStartedText(task.id, round, participantRecords, paths));

  let finalModeratorDecision: LobsterDebateModeratorDecisionRecord | null = null;
  let completedDialogueTurns = 0;
  let currentSpeakerBatch = buildLobsterDebateSpeakerBatch(participantDefinitions, rosterResult.openingSpeakerIds);
  if (currentSpeakerBatch.speakers.length === 0) {
    currentSpeakerBatch = buildLobsterDebateSpeakerBatch(
      participantDefinitions,
      selectDefaultLobsterDebateOpeningSpeakerIds(participantDefinitions),
    );
  }
  for (let dialogueTurn = 1; dialogueTurn <= LOBSTER_DEBATE_MAX_DIALOGUE_TURNS; dialogueTurn += 1) {
    completedDialogueTurns = dialogueTurn;
    if (currentSpeakerBatch.speakers.length === 0) {
      await closeCompletedLobsterDebateTabs(debateTabIds);
      return markLobsterDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`裁判主持人未为第 ${dialogueTurn} 个发言批次指定有效发言者。`],
        status: "error",
      });
    }
    appendSystemMessageForLobster(
      target,
      buildLobsterDebateDialogueTurnStartedText(
        task.id,
        round,
        dialogueTurn,
        LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
        currentSpeakerBatch.speakers,
        paths,
      )
    );
    const dialogueTurnEventAppended = appendTextFileEnsuringDir(
      paths.chatFile,
      buildLobsterDebateDialogueTurnChatEventMarkdown(
        round,
        dialogueTurn,
        LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
        finalModeratorDecision,
        currentSpeakerBatch.speakers,
      )
    );
    if (!dialogueTurnEventAppended) {
      await closeCompletedLobsterDebateTabs(debateTabIds);
      return markLobsterDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`无法追加辩论发言批次系统消息：${paths.chatFile}`],
        status: "error",
      });
    }
    refreshOpenLobsterDebateChatPanelForTask(task.id);
    const participantBatch = await runLobsterDebateParticipantBatch({
      deps: runnerDeps,
      input,
      mainTarget: target,
      task,
      round,
      debateRound,
      dialogueTurn,
      maxDialogueTurns: LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
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
    await closeCompletedLobsterDebateTabs(participantBatch.map((item) => item.result.tabId));
    const missingArtifacts = participantBatch.filter((item) => !item.artifactText);
    if (missingArtifacts.length > 0) {
      await closeCompletedLobsterDebateTabs(debateTabIds);
      return markLobsterDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: missingArtifacts.map((item) => (
          `红蓝对抗发言批次 ${dialogueTurn} 参与者 ${item.participant.id} 未写入发言 artifact：${item.artifactFile}`
        )),
        status: "error",
      });
    }
    for (const item of participantBatch) {
      const appended = appendTextFileEnsuringDir(
        paths.chatFile,
        buildLobsterDebateChatTurnMarkdown(
          dialogueTurn,
          item.participant.id,
          item.participant.title,
          item.artifactText ?? "",
        )
      );
	      if (!appended) {
	        await closeCompletedLobsterDebateTabs(debateTabIds);
	        return markLobsterDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`无法追加红蓝对抗群聊记录：${paths.chatFile}`],
          status: "error",
        });
      }
      refreshOpenLobsterDebateChatPanelForTask(task.id);
    }

    const moderatorResult = await runLobsterDebateModerator({
      deps: runnerDeps,
      input,
      mainTarget: target,
      task,
      round,
      debateRound,
      dialogueTurn,
      maxDialogueTurns: LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
      paths,
      sessionId: debateSessions.moderator,
      participants: participantDefinitions,
      startedAt,
    });
    debateTabIds.push(moderatorResult.tabId);
    if (moderatorResult.sessionId) {
      debateSessions.moderator = moderatorResult.sessionId;
    }
    await closeCompletedLobsterDebateTabs([moderatorResult.tabId]);
    const moderatorArtifactFile = buildLobsterDebateModeratorArtifactFile(paths, dialogueTurn);
    const moderatorText = readTextFileIfNonEmpty(moderatorArtifactFile);
    if (!moderatorText || !moderatorResult.decision) {
      await closeCompletedLobsterDebateTabs(debateTabIds);
      return markLobsterDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`裁判主持人第 ${dialogueTurn} 轮控场 artifact 缺失、为空或无法解析：${moderatorArtifactFile}`],
        status: "error",
      });
    }
    finalModeratorDecision = moderatorResult.decision;
    const nextSpeakerBatch = buildLobsterDebateSpeakerBatch(participantDefinitions, moderatorResult.decision.nextSpeakerIds);
    const moderatorAppended = appendTextFileEnsuringDir(
      paths.chatFile,
      buildLobsterDebateModeratorTurnMarkdown(dialogueTurn, moderatorText)
    );
	    if (!moderatorAppended) {
	      await closeCompletedLobsterDebateTabs(debateTabIds);
	      return markLobsterDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`无法追加裁判主持人控场记录：${paths.chatFile}`],
        status: "error",
      });
    }
    refreshOpenLobsterDebateChatPanelForTask(task.id);
    if (moderatorResult.decision.action === "continue" && nextSpeakerBatch.speakers.length === 0) {
      await closeCompletedLobsterDebateTabs(debateTabIds);
      return markLobsterDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`裁判主持人第 ${dialogueTurn} 轮选择 continue，但未指定有效的下一批发言者。`],
        status: "error",
      });
    }
    if (moderatorResult.decision.action !== "continue") {
      break;
    }
    currentSpeakerBatch = nextSpeakerBatch;
    if (dialogueTurn === LOBSTER_DEBATE_MAX_DIALOGUE_TURNS) {
      finalModeratorDecision = {
        ...moderatorResult.decision,
        action: "finalize",
        reason: `已达到运行时最大安全上限 ${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS} 个发言批次，强制进入最终立场收集。裁判主持人原始理由：${moderatorResult.decision.reason}`,
        nextSpeakerIds: [],
        updatedAt: Date.now(),
      };
      const capAppended = appendTextFileEnsuringDir(
        paths.chatFile,
        buildLobsterDebateRuntimeForcedFinalizeMarkdown(finalModeratorDecision)
      );
	      if (!capAppended) {
	        await closeCompletedLobsterDebateTabs(debateTabIds);
	        return markLobsterDebateNeedsReview({
          task,
          target,
          round,
          debateRound,
          paths,
          participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
          reasons: [`无法追加最大安全发言批次数收束记录：${paths.chatFile}`],
          status: "error",
        });
      }
      refreshOpenLobsterDebateChatPanelForTask(task.id);
      break;
    }
  }

  if (!finalModeratorDecision) {
    await closeCompletedLobsterDebateTabs(debateTabIds);
    return markLobsterDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
      reasons: ["裁判主持人未输出任何控场决策。"],
      status: "error",
    });
  }

  appendSystemMessageForLobster(
    target,
    buildLobsterDebateFinalStanceStartedText(task.id, round, finalModeratorDecision, paths)
  );
  const finalStanceBatch = await runLobsterDebateParticipantBatch({
    deps: runnerDeps,
    input,
    mainTarget: target,
    task,
    round,
    debateRound,
    dialogueTurn: completedDialogueTurns,
    maxDialogueTurns: LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
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
  await closeCompletedLobsterDebateTabs(finalStanceBatch.map((item) => item.result.tabId));
  const missingFinalArtifacts = finalStanceBatch.filter((item) => !item.artifactText);
  if (missingFinalArtifacts.length > 0) {
    await closeCompletedLobsterDebateTabs(debateTabIds);
    return markLobsterDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
      reasons: missingFinalArtifacts.map((item) => (
        `参与者 ${item.participant.id} 未写入最终立场 artifact：${item.artifactFile}`
      )),
      status: "error",
    });
  }
  for (const item of finalStanceBatch) {
    const appended = appendTextFileEnsuringDir(
      paths.chatFile,
      buildLobsterDebateFinalParticipantMarkdown(
        item.participant.id,
        item.participant.title,
        item.artifactText ?? "",
      )
    );
	    if (!appended) {
	      await closeCompletedLobsterDebateTabs(debateTabIds);
	      return markLobsterDebateNeedsReview({
        task,
        target,
        round,
        debateRound,
        paths,
        participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
        reasons: [`无法追加最终立场到红蓝对抗群聊记录：${paths.chatFile}`],
        status: "error",
      });
    }
    refreshOpenLobsterDebateChatPanelForTask(task.id);
  }
  const chatClosed = appendTextFileEnsuringDir(
    paths.chatFile,
    buildLobsterDebateDialogueClosedMarkdown(
      completedDialogueTurns,
      LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
      finalModeratorDecision
    )
  );
	  if (!chatClosed) {
	    await closeCompletedLobsterDebateTabs(debateTabIds);
	    return markLobsterDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions).participants,
      reasons: [`无法写入红蓝对抗群聊收束标记：${paths.chatFile}`],
      status: "error",
    });
  }
  refreshOpenLobsterDebateChatPanelForTask(task.id);
  await closeCompletedLobsterDebateTabs(debateTabIds);
  await switchVisibleConversationTabForLobster(target.tabId);

  const participantValidation = validateLobsterDebateParticipantArtifacts(paths, participantRecords, model, debateSessions);
  upsertLobsterDebateRoundRecord(task.id, {
    lobsterRound: round,
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
    return markLobsterDebateNeedsReview({
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

  appendSystemMessageForLobster(target, buildLobsterDebateParticipantsCollectedText(task.id, round, participantValidation.participants));

  if (finalModeratorDecision.action === "block") {
    return markLobsterDebateNeedsReview({
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

  const consensusRun = await runLobsterDebateConsensusSummary({
    deps: runnerDeps,
    input,
    target,
    task,
    round,
    debateRound,
    paths,
    participants: participantValidation.participants,
  });
  await closeCompletedLobsterDebateTabs([consensusRun.tabId]);
  await switchVisibleConversationTabForLobster(target.tabId);

  const crossReviewText = readTextFileIfNonEmpty(paths.crossReviewFile);
  if (!crossReviewText) {
    return markLobsterDebateNeedsReview({
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
  const decision = parseLobsterMainDecision(decisionText);
  if (!decision) {
    return markLobsterDebateNeedsReview({
      task,
      target,
      round,
      debateRound,
      paths,
      participants: participantValidation.participants,
      reasons: [`decision.json 缺失或不是合法 LobsterMainDecision JSON：${paths.decisionFile}`],
      status: "error",
    });
  }

  const consensus = readLobsterDebateConsensusRecord(paths.consensusFile, participantValidation.participants, decision);
  if (!consensus) {
    return markLobsterDebateNeedsReview({
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
  const mergedConsensus = mergeLobsterDebateConsensusWithParticipantArtifacts(consensus, participantValidation.participants, decision);
  const consensusValidation = validateLobsterDebateConsensus(mergedConsensus);
  if (!consensusValidation.canProceed) {
    return markLobsterDebateNeedsReview({
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

  upsertLobsterDebateRoundRecord(task.id, {
    lobsterRound: round,
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
  refreshOpenLobsterDebateChatPanelForTask(task.id);
  appendSystemMessageForLobster(
    target,
    buildLobsterDebateConsensusReachedText(
      task.id,
      round,
      decision,
      paths,
      getLobsterDecisionSubtasks,
      formatLobsterEstimatedRemainingRounds,
    )
  );
  appendLobsterDebateMainCommunicationLog(task, round, paths, "红蓝对抗共识已形成", [
    `共识摘要：${mergedConsensus.summary}`,
    `决策状态：${decision.status}`,
    `decision.json：${paths.decisionFile}`,
  ]);
  return applyLobsterMainDecisionForRun(task.id, decision);
}

function resolveLobsterDebateModel(input: PromptRunInput): string | undefined {
  return input.lobsterMainModel ?? input.model;
}

function getLobsterDebateRunnerDeps(): LobsterDebateRunnerDeps {
  return {
    appendSystemMessageForLobster,
    buildLobsterDebateConsensusStartedText,
    buildLobsterDebateModeratorFinishedText,
    buildLobsterDebateModeratorStartedText,
    buildLobsterDebateParticipantFinishedText,
    buildLobsterDebateParticipantRosterFailedText,
    buildLobsterDebateParticipantRosterFinishedText,
    buildLobsterDebateParticipantRosterStartedText,
    buildLobsterDebateParticipantStartedText,
    createLobsterSubtaskRunTarget,
    errorToMessage,
    getExistingLobsterDebateRoundStartedAt,
    logError: (event: string, payload?: unknown) => logError(event, payload),
    readLobsterDebateModeratorDecisionArtifact,
    readLobsterDebateParticipantArtifact,
    readLobsterDebateParticipantRosterArtifact,
    readLobsterDebateParticipantTurnArtifact,
    readTextFileIfNonEmpty,
    refreshOpenLobsterDebateChatPanelForTask,
    resolvePromptRunTargetSessionId,
    runPrompt,
    updateLobsterDebateActiveSpeakerRecord,
    updateLobsterDebateModeratorDecisionRecord,
    updateLobsterDebateParticipantRecord,
    updateLobsterDebateParticipantRosterSessionRecord,
  };
}

function buildLobsterDebateParticipantRecords(
  paths: LobsterDebatePaths,
  model: string | undefined,
  status: LobsterDebateParticipantRecord["status"],
  participants: readonly LobsterDebateParticipantDefinition[],
): LobsterDebateParticipantRecord[] {
  const now = Date.now();
  return participants.map((participant) => ({
    id: participant.id,
    role: participant.role,
    title: participant.title,
    model: model ?? null,
    status,
    artifactFile: buildLobsterDebateParticipantArtifactFile(paths, participant.id),
    updatedAt: now,
  }));
}

function buildLobsterDebateSessionState(
  task: LobsterTaskRecord,
  round: number,
  debateRound: number,
): LobsterDebateSessionState {
  const existingRound = task.debateRounds?.find((item) => (
    item.lobsterRound === round
    && item.debateRound === debateRound
  ));
  const participants: Partial<Record<string, string>> = {};
  (existingRound?.participants ?? []).forEach((participant) => {
    const sessionId = findLatestLobsterDebateParticipantSessionId(existingRound?.participants, participant.id);
    if (sessionId) {
      participants[participant.id] = sessionId;
    }
  });
  return {
    participants,
    moderator: findLatestLobsterDebateModeratorSessionId(existingRound?.moderatorDecisions)
      ?? normalizeLobsterDebateSessionId(existingRound?.participantRosterSessionId),
  };
}

function resolveExistingLobsterDebateParticipantRecords(
  task: LobsterTaskRecord,
  round: number,
  debateRound: number,
  paths: LobsterDebatePaths,
  model: string | undefined,
  sessionState?: LobsterDebateSessionState,
): LobsterDebateParticipantRecord[] {
  const existingRound = task.debateRounds?.find((item) => (
    item.lobsterRound === round
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
    artifactFile: participant.artifactFile || buildLobsterDebateParticipantArtifactFile(paths, participant.id),
    sessionId: sessionState?.participants[participant.id] ?? participant.sessionId ?? null,
    updatedAt: typeof participant.updatedAt === "number" ? participant.updatedAt : Date.now(),
  }));
}

function evaluateReusableLobsterDebateDecision(
  task: LobsterTaskRecord,
  round: number,
  debateRound: number,
  paths: LobsterDebatePaths,
  participantRecords: LobsterDebateParticipantRecord[],
): LobsterDebateReusableDecisionResult {
  const decisionText = readTextFileIfNonEmpty(paths.decisionFile);
  if (!decisionText) {
    return { status: "rerun", reasons: [] };
  }
  const chatText = readTextFileIfNonEmpty(paths.chatFile);
  if (!chatText || !isCompleteLobsterDebateChatTranscript(chatText)) {
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
  const participantValidation = validateLobsterDebateParticipantArtifacts(
    paths,
    participantRecords,
    participantRecords[0]?.model ?? undefined
  );
  if (!participantValidation.valid) {
    return { status: "rerun", reasons: participantValidation.reasons };
  }
  const decision = parseLobsterMainDecision(decisionText);
  if (!decision) {
    return { status: "rerun", reasons: [`已有 decision.json 非法，将重跑辩论：${paths.decisionFile}`] };
  }

  const fileConsensus = readLobsterDebateConsensusRecord(paths.consensusFile, participantValidation.participants, decision);
  if (!fileConsensus) {
    return { status: "rerun", reasons: [`已有 decision.json，但 consensus.md 不含合法共识 JSON：${paths.consensusFile}`] };
  }
  const consensus = mergeLobsterDebateConsensusWithParticipantArtifacts(fileConsensus, participantValidation.participants, decision);
  const consensusValidation = validateLobsterDebateConsensus(consensus);
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

function validateLobsterDebateParticipantArtifacts(
  paths: LobsterDebatePaths,
  participantRecords: readonly LobsterDebateParticipantRecord[],
  model: string | null | undefined,
  sessionState?: LobsterDebateSessionState,
): LobsterDebateParticipantArtifactValidation {
  const participants = participantRecords.map((participant) => (
    {
      ...readLobsterDebateParticipantArtifact(paths, {
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

function readLobsterDebateParticipantArtifact(
  paths: LobsterDebatePaths,
  participant: LobsterDebateParticipantDefinition,
  model: string | undefined,
): LobsterDebateParticipantRecord {
  const artifactFile = buildLobsterDebateParticipantArtifactFile(paths, participant.id);
  const content = readTextFileIfNonEmpty(artifactFile);
  const stance = content ? extractLobsterDebateParticipantStance(content) : null;
  const status: LobsterDebateParticipantRecord["status"] = content && stance ? "completed" : "error";
  return {
    id: participant.id,
    role: participant.role,
    title: participant.title,
    model: model ?? null,
    status,
    artifactFile,
    summary: content ? summarizeLobsterDebateArtifact(content) : undefined,
    stance: stance ?? undefined,
    blockingIssues: content ? extractLobsterDebateBlockingIssues(content, stance ?? undefined) : undefined,
    updatedAt: Date.now(),
  };
}

function readLobsterDebateParticipantTurnArtifact(
  participant: LobsterDebateParticipantDefinition,
  artifactFile: string,
  model: string | undefined,
): LobsterDebateParticipantRecord {
  const content = readTextFileIfNonEmpty(artifactFile);
  return {
    id: participant.id,
    role: participant.role,
    title: participant.title,
    model: model ?? null,
    status: content ? "completed" : "error",
    artifactFile,
    summary: content ? summarizeLobsterDebateArtifact(content) : undefined,
    updatedAt: Date.now(),
  };
}

function readLobsterDebateParticipantRosterArtifact(
  artifactFile: string,
): { valid: true; participants: LobsterDebateParticipantDefinition[]; summary: string; openingSpeakerIds: string[] } | { valid: false; reasons: string[] } {
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
    return normalizeLobsterDebateParticipantRosterObject(parsed, artifactFile);
  } catch (error) {
    return { valid: false, reasons: [`裁判主持人红蓝参与者清单 JSON 无法解析：${errorToMessage(error)}`] };
  }
}

function normalizeLobsterDebateParticipantRosterObject(
  value: unknown,
  artifactFile: string,
): { valid: true; participants: LobsterDebateParticipantDefinition[]; summary: string; openingSpeakerIds: string[] } | { valid: false; reasons: string[] } {
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
  if (raw.participants.length < LOBSTER_DEBATE_MIN_PARTICIPANTS || raw.participants.length > LOBSTER_DEBATE_MAX_PARTICIPANTS) {
    reasons.push(`裁判主持人红蓝参与者数量必须在 ${LOBSTER_DEBATE_MIN_PARTICIPANTS}-${LOBSTER_DEBATE_MAX_PARTICIPANTS} 个之间。`);
  }

  const ids = new Set<string>();
  const participants = raw.participants
    .map((item, index): LobsterDebateParticipantDefinition | null => {
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
      const role = normalizeLobsterDebateParticipantRole(participant.role);
      if (!id || !/^[a-z0-9][a-z0-9_.-]{1,48}$/u.test(id)) {
        reasons.push(`第 ${index + 1} 个参与者 id 非法：${id || "<empty>"}`);
      }
      if (id === LOBSTER_DEBATE_MODERATOR_ID || id === "consensus") {
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
      } else if (!isLobsterDebateAdversarialParticipantRole(role)) {
        reasons.push(`参与者 ${id || index + 1} role 必须是 ${LOBSTER_DEBATE_BLUE_TEAM_ROLE} 或 ${LOBSTER_DEBATE_RED_TEAM_ROLE}；${role} 仅用于兼容旧任务记录，不允许新辩论清单使用。`);
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
    .filter((participant): participant is LobsterDebateParticipantDefinition => Boolean(participant));

  if (participants.length < LOBSTER_DEBATE_MIN_PARTICIPANTS) {
    reasons.push(`可用参与者不足 ${LOBSTER_DEBATE_MIN_PARTICIPANTS} 个。`);
  }
  const hasBlueTeam = participants.some((participant) => participant.role === LOBSTER_DEBATE_BLUE_TEAM_ROLE);
  const hasRedTeam = participants.some((participant) => participant.role === LOBSTER_DEBATE_RED_TEAM_ROLE);
  if (!hasBlueTeam) {
    reasons.push(`裁判主持人红蓝参与者清单必须至少包含 1 个蓝队参与者（role=${LOBSTER_DEBATE_BLUE_TEAM_ROLE}）。`);
  }
  if (!hasRedTeam) {
    reasons.push(`裁判主持人红蓝参与者清单必须至少包含 1 个红队参与者（role=${LOBSTER_DEBATE_RED_TEAM_ROLE}）。`);
  }
  if (reasons.length > 0) {
    return { valid: false, reasons };
  }
  const openingSpeakerIds = normalizeLobsterDebateSpeakerIds(
    Array.isArray(raw.openingSpeakerIds) ? raw.openingSpeakerIds : raw.initialSpeakerIds,
    participants.map((participant) => participant.id),
    LOBSTER_DEBATE_MAX_BATCH_SPEAKERS,
  );
  return {
    valid: true,
    participants,
    summary,
    openingSpeakerIds: openingSpeakerIds.length > 0
      ? openingSpeakerIds
      : selectDefaultLobsterDebateOpeningSpeakerIds(participants),
  };
}

function normalizeLobsterDebateParticipantRole(value: unknown): LobsterDebateParticipantRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return LOBSTER_DEBATE_PARTICIPANT_ROLES.some((role) => role === normalized)
    ? normalized as LobsterDebateParticipantRole
    : null;
}

function readLobsterDebateModeratorDecisionArtifact(
  artifactFile: string,
  dialogueTurn: number,
  allowedSpeakerIds: readonly string[] = [],
): LobsterDebateModeratorDecisionRecord | null {
  const content = readTextFileIfNonEmpty(artifactFile);
  if (!content) {
    return null;
  }
  const jsonText = extractJsonObjectText(content);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      const decision = normalizeLobsterDebateModeratorDecisionObject(parsed, artifactFile, dialogueTurn, allowedSpeakerIds);
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
  const action = extractLobsterDebateModeratorAction(decisionSection);
  if (!action) {
    return null;
  }
  const reason = extractMarkdownSection(content, "理由")
    ?? extractMarkdownSection(content, "主持人理由")
    ?? extractMarkdownSection(content, "收束或继续理由")
    ?? summarizeLobsterDebateArtifact(content);
  return {
    artifactFile,
    dialogueTurn,
    action,
    reason: reason.trim() || "裁判主持人未提供理由。",
    nextSpeakerIds: extractLobsterDebateModeratorNextSpeakerIds(content, allowedSpeakerIds),
    nextFocus: extractLobsterDebateModeratorNextFocus(content),
    updatedAt: Date.now(),
  };
}

function normalizeLobsterDebateModeratorDecisionObject(
  value: unknown,
  artifactFile: string,
  dialogueTurn: number,
  allowedSpeakerIds: readonly string[] = [],
): LobsterDebateModeratorDecisionRecord | null {
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
  const action = extractLobsterDebateModeratorAction(raw.action);
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
  const nextSpeakerIds = normalizeLobsterDebateSpeakerIds(
    (value as { nextSpeakerIds?: unknown; nextSpeakers?: unknown; nextParticipants?: unknown }).nextSpeakerIds
      ?? (value as { nextSpeakers?: unknown }).nextSpeakers
      ?? (value as { nextParticipants?: unknown }).nextParticipants,
    allowedSpeakerIds,
    LOBSTER_DEBATE_MAX_BATCH_SPEAKERS,
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

function extractLobsterDebateModeratorAction(value: unknown): LobsterDebateModeratorDecisionRecord["action"] | null {
  if (typeof value !== "string") {
    return null;
  }
  const explicit = value.match(/\b(continue|finalize|block)\b/i)?.[1];
  if (explicit) {
    return normalizeLobsterDebateModeratorAction(explicit);
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

function extractLobsterDebateModeratorNextFocus(content: string): string[] {
  const section = extractMarkdownSection(content, "下一轮关注点")
    ?? extractMarkdownSection(content, "继续关注点")
    ?? "";
  return section
    .split(/\r?\n/g)
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function extractLobsterDebateModeratorNextSpeakerIds(
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
  return normalizeLobsterDebateSpeakerIds(items, allowedSpeakerIds, LOBSTER_DEBATE_MAX_BATCH_SPEAKERS);
}

function extractLobsterDebateParticipantStance(content: string): LobsterDebateParticipantStance | null {
  const stanceSection = extractMarkdownSection(content, "立场") ?? content.slice(0, 1200);
  const explicit = stanceSection.match(/\b(agree_with_reservations|agree|block)\b/i)?.[1];
  if (explicit) {
    return normalizeLobsterDebateParticipantStance(explicit);
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

function extractLobsterDebateBlockingIssues(
  content: string,
  stance: LobsterDebateParticipantStance | undefined,
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

function summarizeLobsterDebateArtifact(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ");
  return normalized.length > LOBSTER_DEBATE_ARTIFACT_SUMMARY_LIMIT
    ? `${normalized.slice(0, LOBSTER_DEBATE_ARTIFACT_SUMMARY_LIMIT)}...`
    : normalized;
}

function isCompleteLobsterDebateChatTranscript(content: string): boolean {
  return /##\s*群聊收束/u.test(content)
    && /##\s*参与者加入：/u.test(content)
    && /(?:【裁判主持人】|裁判主持人|主持人)最终动作：(?:continue|finalize|block)/u.test(content)
    && /##\s*(?:第\s+\d+\s+轮)?主持人控场/u.test(content);
}

function readLobsterDebateConsensusRecord(
  consensusFile: string,
  participants: LobsterDebateParticipantRecord[],
  decision: LobsterMainDecision,
): LobsterDebateConsensusRecord<LobsterMainDecision> | null {
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
    return normalizeLobsterDebateConsensusRecord(parsed, consensusFile, participants, decision);
  } catch {
    return null;
  }
}

function normalizeLobsterDebateConsensusRecord(
  value: unknown,
  artifactFile: string,
  participants: LobsterDebateParticipantRecord[],
  decision: LobsterMainDecision,
): LobsterDebateConsensusRecord<LobsterMainDecision> | null {
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
    || !hasValidLobsterDebateConsensusStanceRecords(raw.participantStances)
    || !hasValidLobsterDebateDisagreementRecords(raw.resolvedDisagreements)
    || !hasValidLobsterDebateDisagreementRecords(raw.openDisagreements)
  ) {
    return null;
  }
  return {
    artifactFile: raw.artifactFile.trim() || artifactFile,
    reached: raw.reached === true,
    summary,
    participantStances: normalizeLobsterDebateConsensusStances(raw.participantStances, participants),
    resolvedDisagreements: normalizeLobsterDebateDisagreements(raw.resolvedDisagreements),
    openDisagreements: normalizeLobsterDebateDisagreements(raw.openDisagreements),
    decision,
  };
}

function hasValidLobsterDebateConsensusStanceRecords(value: unknown): boolean {
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
      && Boolean(normalizeLobsterDebateParticipantStance(raw.stance))
    );
  });
}

function normalizeLobsterDebateConsensusStances(
  value: unknown,
  participants: LobsterDebateParticipantRecord[],
): LobsterDebateConsensusRecord<LobsterMainDecision>["participantStances"] {
  const stances = new Map<string, { participantId: string; stance: LobsterDebateParticipantStance; note?: string }>();
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return;
      }
      const raw = item as { participantId?: unknown; stance?: unknown; note?: unknown };
      const participantId = typeof raw.participantId === "string" && raw.participantId.trim()
        ? raw.participantId.trim()
        : "";
      const stance = normalizeLobsterDebateParticipantStance(raw.stance);
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

function hasValidLobsterDebateDisagreementRecords(value: unknown): boolean {
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

function normalizeLobsterDebateDisagreements(value: unknown): LobsterDebateDisagreementRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index): LobsterDebateDisagreementRecord | null => {
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
    .filter((item): item is LobsterDebateDisagreementRecord => Boolean(item));
}

function mergeLobsterDebateConsensusWithParticipantArtifacts(
  consensus: LobsterDebateConsensusRecord<LobsterMainDecision>,
  participants: LobsterDebateParticipantRecord[],
  decision: LobsterMainDecision,
): LobsterDebateConsensusRecord<LobsterMainDecision> {
  return {
    ...consensus,
    participantStances: normalizeLobsterDebateConsensusStances(consensus.participantStances, participants),
    decision,
  };
}

function markLobsterDebateNeedsReview(options: {
  task: LobsterTaskRecord;
  target: PromptRunTarget;
  round: number;
  debateRound: number;
  paths: LobsterDebatePaths;
  participants: LobsterDebateParticipantRecord[];
  reasons: string[];
  consensus?: LobsterDebateConsensusRecord<LobsterMainDecision>;
  status: Exclude<LobsterDebateRoundStatus, "running" | "consensus">;
}): LobsterMainDecisionRunResult {
  const { task, target, round, debateRound, paths, participants, reasons, consensus, status } = options;
  const reviewSummary = buildLobsterDebateNeedsReviewSummary({ reasons, consensus });
  const startedAt = getExistingLobsterDebateRoundStartedAt(task, round, debateRound) ?? Date.now();
  upsertLobsterDebateRoundRecord(task.id, {
    lobsterRound: round,
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
  const failedRecord = updateLobsterTaskRecord(task.id, {
    status: "needs-review",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: Date.now(),
    finalSummary: reviewSummary.finalSummary,
    ...(typeof reviewSummary.estimatedRemainingRounds === "number"
      ? { estimatedRemainingRounds: reviewSummary.estimatedRemainingRounds }
      : {}),
  }) ?? task;
  refreshOpenLobsterDebateChatPanelForTask(task.id);
  appendSystemMessageForLobster(target, buildLobsterDebateNeedsReviewText(task.id, round, reviewSummary, paths));
  appendLobsterDebateMainCommunicationLog(failedRecord, round, paths, reviewSummary.title, [
    ...reviewSummary.details,
    ...(consensus ? [`consensus.md：${paths.consensusFile}`] : []),
    ...(consensus?.decision ? [`decision.json：${paths.decisionFile}`] : []),
  ]);
  return { status: "needs-review", task: failedRecord };
}

function getExistingLobsterDebateRoundStartedAt(
  task: LobsterTaskRecord,
  round: number,
  debateRound: number,
): number | null {
  const record = task.debateRounds?.find((item) => item.lobsterRound === round && item.debateRound === debateRound);
  return typeof record?.startedAt === "number" ? record.startedAt : null;
}

function upsertLobsterDebateRoundRecord(
  taskId: string,
  roundRecord: LobsterDebateRoundRecord<LobsterMainDecision>,
): void {
  const latest = readLobsterTaskRecord(taskId);
  if (!latest) {
    return;
  }
  const debateRounds = Array.isArray(latest.debateRounds) ? [...latest.debateRounds] : [];
  const existingIndex = debateRounds.findIndex((item) => (
    item.lobsterRound === roundRecord.lobsterRound
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
  updateLobsterTaskRecord(taskId, {
    debateRounds,
    updatedAt: Date.now(),
  });
}

function updateLobsterDebateParticipantRecord(
  taskId: string,
  round: number,
  debateRound: number,
  participant: LobsterDebateParticipantRecord,
  startedAt: number,
  briefFile: string,
  chatFile: string,
  activeSpeaker?: LobsterDebateActiveSpeakerRecord,
): void {
  const latest = readLobsterTaskRecord(taskId);
  const existingRound = latest?.debateRounds?.find((item) => item.lobsterRound === round && item.debateRound === debateRound);
  const participants = existingRound?.participants?.length
    ? [...existingRound.participants]
    : [];
  const index = participants.findIndex((item) => item.id === participant.id);
  if (index >= 0) {
    participants[index] = { ...participants[index], ...participant };
  } else {
    participants.push(participant);
  }
	  upsertLobsterDebateRoundRecord(taskId, {
	    lobsterRound: round,
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

function updateLobsterDebateActiveSpeakerRecord(
  taskId: string,
  round: number,
  debateRound: number,
  startedAt: number,
  paths: LobsterDebatePaths,
  activeSpeaker: LobsterDebateActiveSpeakerRecord,
): void {
  const latest = readLobsterTaskRecord(taskId);
  const existingRound = latest?.debateRounds?.find((item) => item.lobsterRound === round && item.debateRound === debateRound);
  const participants = existingRound?.participants?.length
    ? [...existingRound.participants]
    : [];
  upsertLobsterDebateRoundRecord(taskId, {
    lobsterRound: round,
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
  refreshOpenLobsterDebateChatPanelForTask(taskId);
}

function updateLobsterDebateParticipantRosterSessionRecord(
  taskId: string,
  round: number,
  debateRound: number,
  sessionId: string | null,
  startedAt: number,
  paths: LobsterDebatePaths,
): void {
  const latest = readLobsterTaskRecord(taskId);
  const existingRound = latest?.debateRounds?.find((item) => item.lobsterRound === round && item.debateRound === debateRound);
  upsertLobsterDebateRoundRecord(taskId, {
    lobsterRound: round,
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

function updateLobsterDebateModeratorDecisionRecord(
  taskId: string,
  round: number,
  debateRound: number,
  decision: LobsterDebateModeratorDecisionRecord,
  startedAt: number,
  paths: LobsterDebatePaths,
): void {
  const latest = readLobsterTaskRecord(taskId);
  const existingRound = latest?.debateRounds?.find((item) => item.lobsterRound === round && item.debateRound === debateRound);
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
  upsertLobsterDebateRoundRecord(taskId, {
    lobsterRound: round,
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

function buildLobsterDebateSpeakerBatch(participants: readonly LobsterDebateParticipantDefinition[], speakerIds: readonly string[]): LobsterDebateSpeakerBatch {
  const participantById = new Map(participants.map((participant) => [participant.id, participant] as const));
  const normalizedSpeakerIds = speakerIds
    .filter((speakerId): speakerId is string => typeof speakerId === "string" && Boolean(speakerId.trim()))
    .map((speakerId) => speakerId.trim())
    .filter((speakerId, index, list) => list.indexOf(speakerId) === index)
    .slice(0, LOBSTER_DEBATE_MAX_BATCH_SPEAKERS)
    .filter((speakerId) => participantById.has(speakerId));
  const speakers = normalizedSpeakerIds
    .map((speakerId) => participantById.get(speakerId))
    .filter((participant): participant is LobsterDebateParticipantDefinition => Boolean(participant));
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

async function closeCompletedLobsterDebateTabs(tabIds: string[]): Promise<void> {
  if (!getGlobalLobsterAutoCloseSubtaskTabs()) {
    return;
  }
  for (const tabId of tabIds) {
    if (tabId) {
      await closeConversationTabAndRefreshPanel(tabId);
    }
  }
}

function appendLobsterDebateMainCommunicationLog(
  task: LobsterTaskRecord,
  round: number,
  paths: LobsterDebatePaths,
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
    void logError("lobster-debate-main-communication-write-error", {
      taskId: task.id,
      filePath: task.mainCommunicationFile,
      error: String(error),
    });
  }
}

function appendLobsterSupplementalRequirement(
  existing: readonly string[] | undefined,
  nextItem: string,
): string[] {
  const normalizedExisting = Array.isArray(existing)
    ? existing.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return [...normalizedExisting, nextItem];
}

function appendLobsterSupplementalRequirementToCommunication(
  task: LobsterTaskRecord,
  requirement: string,
): void {
  try {
    fs.mkdirSync(path.dirname(task.mainCommunicationFile), { recursive: true });
    const lines = [
      "",
      "## 补充需求",
      `- 时间：${new Date().toISOString()}`,
      `- 主任务轮次：${Math.max(1, task.currentRound || 1)}`,
      requirement,
    ];
    fs.appendFileSync(task.mainCommunicationFile, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    void logError("lobster-supplemental-requirement-write-error", {
      taskId: task.id,
      filePath: task.mainCommunicationFile,
      error: String(error),
    });
  }
}

function appendLobsterMainSubChatTaskEvent(task: LobsterTaskRecord, body: string): void {
  appendLobsterMainSubChatSection(task, "任务事件", body);
}

function appendLobsterMainSubChatMainDecision(
  task: LobsterTaskRecord,
  decision: LobsterMainDecision,
  subtasks: LobsterSubtaskRecord[] = [],
): void {
  const round = Math.max(1, task.currentRound || 1);
  const bodyLines = [
    `- 时间：${new Date().toISOString()}`,
    `- 决策状态：${decision.status}`,
  ];
  const remainingRounds = formatLobsterEstimatedRemainingRounds(decision.estimatedRemainingRounds);
  if (remainingRounds) {
    bodyLines.push(`- 预计剩余轮次：${remainingRounds}`);
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
      bodyLines.push(`- ${getLobsterSubtaskDisplayTitle(index, subtask)}（${subtask.id}）：${subtask.status}`);
    });
  }
  if (decision.status === "completed") {
    bodyLines.push("");
    bodyLines.push("### 问题回答结论");
    bodyLines.push(resolveLobsterAnswerConclusion(task, decision));
  }
  if (decision.finalSummary) {
    bodyLines.push("");
    bodyLines.push("### 总结");
    bodyLines.push(decision.finalSummary);
  }
  bodyLines.unshift(`- 成员 ID：main`);
  const mainTitle = getLobsterMainSubChatMainTitle(task);
  appendLobsterMainSubChatSection(
    task,
    `主任务发言：第 ${round} 轮${formatLobsterGroupChatMemberName(mainTitle)}`,
    bodyLines.join("\n"),
  );
  if (decision.status === "completed") {
    appendLobsterMainSubChatSection(task, "群聊收束", buildLobsterCompletedConclusionAndSummaryMarkdown(task, decision));
  }
}

function appendLobsterMainSubChatSubtaskStarted(
  task: LobsterTaskRecord,
  subtask: LobsterSubtaskRecord,
  round: number,
  communicationFile: string,
  retryCount: number,
): void {
  const latest = readLobsterTaskRecord(task.id) ?? task;
  const index = latest.subTasks.findIndex((item) => item.id === subtask.id);
  const title = getLobsterSubtaskDisplayTitle(index, subtask);
  const retryLine = retryCount > 0 ? `- 重试：第 ${retryCount} 次` : null;
  appendLobsterMainSubChatSection(latest, `子任务加入：${formatLobsterGroupChatMemberName(title)}`, [
    `- 成员 ID：${subtask.id}`,
    `- 时间：${new Date().toISOString()}`,
    `- 轮次：${round}`,
    retryLine,
    `- 状态：running`,
    `- 沟通文件：${communicationFile}`,
  ].filter((line): line is string => Boolean(line)).join("\n"));
}

function appendLobsterMainSubChatSubtaskFinished(
  task: LobsterTaskRecord,
  subtask: LobsterSubtaskRecord,
  runStatus: TaskRunStatus,
  assistantContent?: string | null,
): void {
  const latest = readLobsterTaskRecord(task.id) ?? task;
  const index = latest.subTasks.findIndex((item) => item.id === subtask.id);
  const latestSubtask = latest.subTasks[index] ?? subtask;
  const title = getLobsterSubtaskDisplayTitle(index, latestSubtask);
  appendLobsterMainSubChatSection(
    latest,
    `子任务发言：${formatLobsterGroupChatMemberName(title)}`,
    [
      `- 成员 ID：${latestSubtask.id}`,
      "",
      buildLobsterMainSubSubtaskTurnBody({
        runStatus,
        assistantContent,
        communicationFile: latestSubtask.communicationFile,
      }),
    ].join("\n"),
  );
}

function appendLobsterMainSubChatSection(
  task: LobsterTaskRecord,
  heading: string,
  body: string,
): void {
  const chatFile = ensureLobsterMainSubChatTranscript(task);
  appendTextFileEnsuringDir(chatFile, `\n## ${heading}\n${body.trim()}\n`);
  refreshOpenLobsterDebateChatPanelForTask(task.id);
}

type LobsterSubtaskRetryOptions = {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LobsterTaskRecord;
  round: number;
  subtask: LobsterSubtaskRecord;
  switchVisible?: boolean;
};

type LobsterSubtaskBatchOptions = {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LobsterTaskRecord;
  round: number;
  subtasks: LobsterSubtaskRecord[];
};

type LobsterSubtaskRunResult = {
  subtask: LobsterSubtaskRecord;
  status: TaskRunStatus;
};

type LobsterMainDecisionRunResult =
  | { status: "interrupted"; task: LobsterTaskRecord; runStatus: "error" | "stopped" }
  | { status: "needs-review"; task: LobsterTaskRecord; decision?: LobsterMainDecision | null }
  | { status: "completed"; task: LobsterTaskRecord; decision: LobsterMainDecision }
  | { status: "continue"; task: LobsterTaskRecord; decision: LobsterMainDecision; subtasks: LobsterSubtaskRecord[] };

async function runLobsterSubtasksBatchWithRetry(
  options: LobsterSubtaskBatchOptions
): Promise<LobsterSubtaskRunResult[]> {
  const { input, target, task, round, subtasks } = options;
  if (subtasks.length <= 1) {
    const subtask = subtasks[0];
    if (!subtask) {
      return [];
    }
    const status = await runLobsterSubtaskWithRetry({
      input,
      target,
      task,
      round,
      subtask,
      switchVisible: true,
    });
    return [{ subtask, status }];
  }

  const executionPlan = buildLobsterSubtaskExecutionPlan(subtasks);
  appendSystemMessageForLobster(target, buildLobsterSubtaskBatchStartedText(task.id, round, subtasks, executionPlan));
  const results: LobsterSubtaskRunResult[] = [];

  for (let groupIndex = 0; groupIndex < executionPlan.groups.length; groupIndex += 1) {
    const group = executionPlan.groups[groupIndex] ?? [];
    if (group.length === 0) {
      continue;
    }
    if (executionPlan.groups.length > 1) {
      appendSystemMessageForLobster(
        target,
        buildLobsterSubtaskExecutionGroupStartedText(task.id, round, groupIndex, executionPlan.groups.length, group)
      );
    }

    const groupResults = await Promise.all(group.map(async (subtask): Promise<LobsterSubtaskRunResult> => {
      try {
        const status = await runLobsterSubtaskWithRetry({
          input,
          target,
          task,
          round,
          subtask,
          switchVisible: false,
        });
        return { subtask, status };
      } catch (error) {
        void logError("lobster-subtask-batch-run-error", {
          taskId: task.id,
          round,
          subtaskId: subtask.id,
          error: error instanceof Error ? error.message : String(error),
        });
        markLobsterSubtaskRunFinished(task.id, subtask.id, "error", null);
        return { subtask, status: "error" };
      }
    }));

    results.push(...groupResults);
    if (groupResults.some((result) => result.status === "error" || result.status === "stopped")) {
      await switchVisibleConversationTabForLobster(target.tabId);
      return results;
    }
  }

  await switchVisibleConversationTabForLobster(target.tabId);
  if (results.every((result) => result.status === "end")) {
    updateLobsterTaskRecord(task.id, {
      activeSubtaskId: null,
      activeSubtaskIds: [],
      updatedAt: Date.now(),
    });
    refreshOpenLobsterDebateChatPanelForTask(task.id);
    appendSystemMessageForLobster(target, buildLobsterSubtaskBatchCompletedText(task.id, round, subtasks));
    const latest = readLobsterTaskRecord(task.id) ?? task;
    appendLobsterMainSubChatTaskEvent(
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

async function runLobsterSubtaskWithRetry(options: LobsterSubtaskRetryOptions): Promise<TaskRunStatus> {
  const { input, target, task, round, subtask } = options;
  const shouldSwitchVisible = options.switchVisible !== false;
  const mainTabId = target.tabId;
  let retryCount = 0;
  while (true) {
    const communicationFile = prepareLobsterSubtaskCommunicationFile(task, subtask, round, retryCount);
    const subtaskTarget = createLobsterSubtaskRunTarget(target.cli);
    appendSystemMessageForLobster(
      target,
      buildLobsterSubtaskStartedText(task.id, subtask, round, communicationFile, retryCount)
    );
    appendSystemMessageForLobster(
      subtaskTarget,
      buildLobsterSubtaskStartedText(task.id, subtask, round, communicationFile, retryCount)
    );
    appendLobsterMainSubChatSubtaskStarted(task, subtask, round, communicationFile, retryCount);
    if (shouldSwitchVisible) {
      await switchVisibleConversationTabForLobster(subtaskTarget.tabId);
    }

    let status: TaskRunStatus = "error";
    try {
      status = await runLobsterRound({
        input,
        target: subtaskTarget,
        task,
        round,
        role: "subtask",
        subtaskId: subtask.id,
        displayPrompt: buildLobsterSubtaskDisplayPrompt(round, subtask, retryCount),
        modelPrompt: buildLobsterSubtaskModelPrompt(
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
      void logError("lobster-subtask-run-error", {
        taskId: task.id,
        round,
        subtaskId: subtask.id,
        retryCount,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (shouldSwitchVisible) {
        await switchVisibleConversationTabForLobster(mainTabId);
      }
    }

    if (status !== "error") {
      const summary = getLastLobsterAssistantContent(subtaskTarget, task.id, round, "subtask");
      markLobsterSubtaskRunFinished(task.id, subtask.id, status, summary);
      if (status === "end" && getGlobalLobsterAutoCloseSubtaskTabs()) {
        await closeConversationTabAndRefreshPanel(subtaskTarget.tabId);
        void logInfo("lobster-subtask-tab-auto-closed", {
          taskId: task.id,
          round,
          subtaskId: subtask.id,
          tabId: subtaskTarget.tabId,
        });
      }
      return status;
    }
    if (retryCount >= LOBSTER_SUBTASK_RETRY_MAX_RETRIES) {
      const summary = getLastLobsterAssistantContent(subtaskTarget, task.id, round, "subtask");
      markLobsterSubtaskRunFinished(task.id, subtask.id, status, summary);
      return status;
    }

    retryCount += 1;
    appendSystemMessageForLobster(
      target,
      buildLobsterSubtaskRetryText(task.id, subtask.id, retryCount)
    );
    await waitForLobsterSubtaskRetryDelay();
  }
}

async function waitForLobsterSubtaskRetryDelay(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, LOBSTER_SUBTASK_RETRY_DELAY_MS));
}

type LobsterRoundRunOptions = {
  input: PromptRunInput;
  target: PromptRunTarget;
  task: LobsterTaskRecord;
  round: number;
  role: LobsterTaskRole;
  displayPrompt: string;
  modelPrompt: string;
  subtaskId?: string;
};

async function runLobsterRound(options: LobsterRoundRunOptions): Promise<TaskRunStatus> {
  const { input, target, task, round, role, displayPrompt, modelPrompt, subtaskId } = options;
  const roundStartedAt = Date.now();
  const runModel = role === "main"
    ? (input.lobsterMainModel ?? input.model)
    : (input.lobsterSubtaskModel ?? input.model);
  const activeSubtaskPatch = role === "main"
    ? { activeSubtaskId: null, activeSubtaskIds: [] }
    : buildLobsterActiveSubtaskPatch(task.id, subtaskId);
  updateLobsterTaskRecord(task.id, {
    status: "running",
    currentRound: round,
    ...activeSubtaskPatch,
    updatedAt: roundStartedAt,
  });
  refreshOpenLobsterDebateChatPanelForTask(task.id);

  await runPrompt({
    ...input,
    displayPrompt,
    modelPrompt,
    model: runModel,
    taskRole: role,
    lobsterTaskId: task.id,
    lobsterRound: round,
    lobsterSubtaskId: subtaskId,
  }, { targetTabId: target.tabId });

  if (role === "main") {
    const mainSessionId = resolveLobsterTaskSessionId(target);
    if (mainSessionId) {
      bindLobsterTaskToSession(task.id, mainSessionId);
    }
  }

  const roundEndedAt = Date.now();
  const roundStatus = getLobsterRoundRunStatus(task.id, round, role, subtaskId) ?? "end";
  appendLobsterRound(task.id, {
    round,
    role,
    subtaskId,
    status: roundStatus,
    startedAt: roundStartedAt,
    endedAt: roundEndedAt,
    summary: buildLobsterRoundSummary(round, role, subtaskId),
  });
  return roundStatus;
}

function buildLobsterActiveSubtaskPatch(
  taskId: string,
  subtaskId?: string,
): { activeSubtaskId?: string | null; activeSubtaskIds?: string[] } {
  if (!subtaskId) {
    return {};
  }
  const latest = readLobsterTaskRecord(taskId);
  const activeSubtaskIds = latest ? getActiveLobsterSubtaskIds(latest) : [];
  if (!activeSubtaskIds.includes(subtaskId)) {
    activeSubtaskIds.push(subtaskId);
  }
  return {
    activeSubtaskId: activeSubtaskIds[0] ?? subtaskId,
    activeSubtaskIds,
  };
}

function buildLobsterMainDisplayPrompt(rootPrompt: string, round: number): string {
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

function buildLobsterModeratorMainDisplayPrompt(rootPrompt: string, round: number): string {
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

function buildLobsterSubtaskDisplayPrompt(round: number, subtask: LobsterSubtaskRecord, retryCount = 0): string {
  const retryLine = retryCount > 0
    ? `第 ${retryCount} 次重试（最多 ${LOBSTER_SUBTASK_RETRY_MAX_RETRIES} 次）。`
    : "";
  return [
    `Loop 子任务第 ${round} 轮执行：${subtask.title}`,
    retryLine,
    subtask.prompt ?? subtask.title,
  ].filter(Boolean).join("\n");
}

function buildLobsterMainModelPrompt(
  rootPrompt: string,
  task: LobsterTaskRecord,
  round: number,
  continuePrompt?: string,
): string {
  const taskId = task.id;
  const taskFile = task.taskStoreFile;
  const communication = getLobsterCommunicationPaths(taskId);
  const normalizedContinuePrompt = normalizeLobsterContinuePromptForPrompt(continuePrompt);
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
    `2. 当你返回 status=continue 时，程序会按 subtasks 数组启动 1~${LOBSTER_PARALLEL_SUBTASK_MAX} 个子任务新会话。`,
    "3. 只有同一批次所有子任务都结束后，程序才会回到当前主任务会话并唤醒你继续复核。",
    "4. 你需要基于任务记录 + 沟通文件再次决策，循环直到你返回 status=completed。",
    "5. 任务不会因为子任务都显示 completed 自动结束，只有你返回 completed 才结束。",
    "",
    "主任务职责：",
    "1. 读取任务记录文件中当前任务的 status、activeSubtaskId、activeSubtaskIds、subTasks 和 rounds 概要。",
    "2. 必须读取主任务沟通文件和子任务沟通目录中的最新执行报告，再做审核验收和下一步决策。",
    "3. 第 1 轮先给出整体阶段计划（建议 3~6 个阶段）并写入主任务沟通文件，然后优先派发首批互不冲突的最小可执行子任务；不要默认只派发 1 个。",
    "4. 后续轮次按计划滚动更新：完成一个子任务或一批子任务后复核一次，不满足就继续派发下一批尽可能并发的子任务。",
    "5. 并发优先：只要能确定多个子任务预计写入文件/目录互不重叠、没有先后依赖、不会争抢同一验证环境，就必须放入同一个 subtasks 批次。",
    "6. 串行兜底：只有共享写入同一文件/同一配置、需要基于另一个子任务产物继续修改、或必须独占同一验证环境时，才只返回 1 个子任务。",
    `7. 每批最多 ${LOBSTER_PARALLEL_SUBTASK_MAX} 个子任务；如果可并发项超过上限，优先选择当前阶段最独立、收益最高的一组。`,
    "8. 先做审核和验收：对照原始目标、已完成子任务 summary、沟通文件、代码/文档状态和验证结果逐项检查。",
    "9. 若子任务沟通文件已提供可核验的单测/编译命令与结果，主任务无需重复执行这些验证；优先复核逻辑正确性、改动范围和结果一致性，仅在证据缺失或结果可疑时补充验证。",
    "10. 每次主任务复核都必须预判 estimatedRemainingRounds：从当前决策之后预计还需要多少个主任务复核轮/子任务批次才能 completed；completed 时必须为 0。",
    "11. 只有验收全部通过，才能返回 completed；只要有任何不满足，必须返回 continue 并给出下一批修复/补齐子任务。",
    "12. 主任务只负责复核整体进度、拆分/维护 subTasks、选择下一批最小子任务。",
    "13. 主任务不要直接执行具体代码/文件修改；返回 JSON 后由程序启动子任务。",
    "14. 输出必须是一个 JSON 对象，不要包裹 markdown，不要输出额外解释。",
    "",
    "JSON 协议：",
    '{"status":"completed","estimatedRemainingRounds":0,"answerConclusion":"直接回答用户原始问题的简短结论","finalSummary":"整体完成说明","requirementCoverage":[{"name":"用户需求A","passed":true,"detail":"覆盖说明"}],"roundSummaries":[{"round":1,"subtaskId":"stable-id","title":"子任务标题","summary":"本轮完成内容摘要"}],"acceptance":{"passed":true,"summary":"验收通过说明","checks":[{"name":"目标覆盖","passed":true,"detail":"..."}]}}',
    '{"status":"continue","estimatedRemainingRounds":2,"acceptance":{"passed":false,"summary":"未通过原因","checks":[{"name":"缺口项","passed":false,"detail":"..."}]},"parallelReason":"这些子任务预计写入文件互不重叠、没有先后依赖，可以并发","subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src-a","writeFiles":["src/a.ts","src/a.test.ts"],"prompt":"给子任务A执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"},{"id":"stable-id-b","title":"子任务B标题","conflictGroup":"docs-b","writeFiles":["docs/b.md"],"prompt":"给子任务B执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"}]}',
    '{"status":"continue","estimatedRemainingRounds":1,"acceptance":{"passed":false,"summary":"存在同文件或依赖冲突，必须串行","checks":[{"name":"依赖关系","passed":false,"detail":"B 依赖 A 对 src/shared.ts 的修改结果"}]},"subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src/shared.ts","writeFiles":["src/shared.ts"],"prompt":"给子任务A执行的完整指令"}]}',
    '{"status":"blocked","estimatedRemainingRounds":0,"finalSummary":"阻塞原因"}',
    "",
    "字段要求：",
    "- status 只能是 completed、continue、blocked。",
    "- 每次返回都必须提供 estimatedRemainingRounds；含义是从当前决策之后预计还需要多少个主任务复核轮/子任务批次才能 completed，必须是非负整数。",
    "- status=completed 时必须提供 estimatedRemainingRounds=0、acceptance.passed=true、answerConclusion、finalSummary、requirementCoverage 和 roundSummaries。",
    "- answerConclusion 用于直接回答用户原始问题，应尽量简短明确；finalSummary 用于整体完成说明和交付总结。",
    "- requirementCoverage 必须逐条覆盖用户原始需求，不可遗漏；所有项都必须 passed=true。",
    "- roundSummaries 需要按轮次汇总每轮子任务完成内容，至少包含 round、title、summary；如有 subtaskId 也应带上。",
    "- finalSummary 需要给出整体结果，并基于 roundSummaries 归纳所有轮次完成项与最终交付情况。",
    `- status=continue 时必须提供 acceptance.passed=false、subtasks 数组，数组长度 1~${LOBSTER_PARALLEL_SUBTASK_MAX}。`,
    "- subtasks 中每个对象都必须提供 title 和 prompt；prompt 必须自包含且足够详细，因为子任务每次都会在单独新会话中执行，看不到主任务对话上下文。",
    "- subtasks[*].prompt 至少包含：背景目标、具体范围、预计只读/写文件或目录、执行步骤、验收标准、必须更新任务记录文件和写入沟通文件的要求。",
    "- subtasks[*].id 应稳定可读；如果复用已有子任务，请使用已有 id。",
    "- subtasks[*].writeFiles 可选；但返回多个 subtasks 时，必须为每个会写文件的子任务列出预计写入文件或目录，用于证明文件不冲突；纯验证/调研子任务可省略并在 parallelReason 说明不会写文件。",
    "- subtasks[*].conflictGroup 可选，用于说明冲突域；同一批次内不应出现会互相覆盖的冲突域。",
    "- 返回多个 subtasks 前，必须确认它们的 writeFiles / conflictGroup 互不重叠；只要能确认文件不冲突，就优先并发，不要保守串行；无法判断写入范围的实现类子任务应串行。",
    "- 返回 continue 前，同时更新任务记录文件中的 subTasks、activeSubtaskId、activeSubtaskIds 和 estimatedRemainingRounds。",
    "- 返回 completed 前，同时更新任务记录文件 status=completed、estimatedRemainingRounds=0、answerConclusion、finalSummary、roundSummaries，并保证 acceptance.checks 全部 passed=true。",
    "",
    ...buildLobsterSupplementalRequirementsLines(task),
    ...(normalizedContinuePrompt ? [
      "本次继续指令：",
      normalizedContinuePrompt,
      "",
    ] : []),
    "原始目标：",
    rootPrompt,
  ].join("\n");
}

function buildLobsterModeratorMainModelPrompt(
  rootPrompt: string,
  task: LobsterTaskRecord,
  round: number,
  continuePrompt?: string,
): string {
  const planningDebate = findReusableLobsterPlanningDebateRound(task);
  const planningPaths = planningDebate
    ? buildLobsterDebatePaths(task.communicationDir, planningDebate.lobsterRound, planningDebate.debateRound)
    : null;
  const planningDecision = planningDebate?.consensus?.decision
    ?? (planningDebate ? readLobsterPlanningDebateDecision(task, planningDebate) : null);
  const planningConsensus = planningDebate?.consensus;
  const mainSubChatFile = buildLobsterMainSubChatTranscriptFile(task.communicationDir);
  const basePrompt = buildLobsterMainModelPrompt(rootPrompt, task, round, continuePrompt);
  const planningLines = planningDebate && planningPaths
    ? [
        `- 红蓝规划轮次：主任务第 ${planningDebate.lobsterRound} 轮 / 辩论第 ${planningDebate.debateRound} 轮`,
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
    "5. 你仍然不能直接修改工作区内容；只能输出一个符合 LobsterMainDecision 的 JSON，由程序派发子任务。",
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

function buildLobsterSubtaskModelPrompt(
  rootPrompt: string,
  task: LobsterTaskRecord,
  round: number,
  subtask: LobsterSubtaskRecord,
  retryCount = 0,
  communicationFile?: string
): string {
  const taskId = task.id;
  const taskFile = task.taskStoreFile;
  const communication = getLobsterCommunicationPaths(taskId);
  const reportFile = communicationFile ?? buildLobsterSubtaskCommunicationFile(taskId, subtask.id, round, retryCount);
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

function getLobsterMessagesForTarget(target: PromptRunTarget): ChatMessage[] {
  const tab = getConversationTabById(target.tabId);
  const sessionId = tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
  return sessionId
    ? loadSessionMessages(target.cli, sessionId)
    : getPendingSessionDraft(target.tabId, target.cli).messages;
}

function resolveLobsterSubtaskConversationContext(
  cli: CliName,
  tabId: string | null | undefined
): LobsterSubtaskConversationContext | null {
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
  return resolveLobsterSubtaskConversationContextFromMessages(messages);
}

function isLobsterSubtaskConversationTarget(cli: CliName, tabId: string | null | undefined): boolean {
  return Boolean(resolveLobsterSubtaskConversationContext(cli, tabId));
}

function getLastLobsterAssistantContent(
  target: PromptRunTarget,
  taskId: string,
  round: number,
  role: LobsterTaskRole
): string | null {
  const messages = getLobsterMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === role
      && message.lobsterTaskId === taskId
      && message.lobsterRound === round
      && message.content.trim()
    ) {
      return message.content;
    }
  }
  return null;
}

function parseLobsterMainDecision(content: string | null): LobsterMainDecision | null {
  if (!content) {
    return null;
  }
  const jsonText = extractJsonObjectText(content);
  if (!jsonText) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonText);
    return normalizeLobsterMainDecision(parsed);
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

function normalizeLobsterMainDecision(value: unknown): LobsterMainDecision | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<LobsterMainDecision>;
  const estimatedRemainingRounds = normalizeLobsterEstimatedRemainingRounds(
    (raw as { estimatedRemainingRounds?: unknown }).estimatedRemainingRounds
  );
  if (raw.status === "completed") {
    const acceptance = normalizeLobsterAcceptance((raw as { acceptance?: unknown }).acceptance);
    const requirementCoverage = normalizeLobsterAcceptanceChecks((raw as { requirementCoverage?: unknown }).requirementCoverage);
    const answerConclusion = typeof raw.answerConclusion === "string" && raw.answerConclusion.trim()
      ? raw.answerConclusion.trim()
      : undefined;
    const finalSummary = typeof raw.finalSummary === "string" && raw.finalSummary.trim()
      ? raw.finalSummary.trim()
      : "";
    const roundSummaries = normalizeLobsterRoundSummaries((raw as { roundSummaries?: unknown }).roundSummaries);
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
  const subtasks = normalizeLobsterSubtaskDecisions(raw);
  if (!subtasks || subtasks.length === 0) {
    return null;
  }
  const acceptance = normalizeLobsterAcceptance((raw as { acceptance?: unknown }).acceptance);
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

function normalizeLobsterEstimatedRemainingRounds(value: unknown): number | undefined {
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(numeric), 0), LOBSTER_MAX_MAX_ROUNDS);
}

function normalizeLobsterSubtaskDecisions(raw: Partial<LobsterMainDecision>): LobsterSubtaskDecision[] | null {
  const rawSubtasks = Array.isArray((raw as { subtasks?: unknown }).subtasks)
    ? (raw as { subtasks: unknown[] }).subtasks
    : (raw.subtask ? [raw.subtask] : []);
  if (rawSubtasks.length === 0 || rawSubtasks.length > LOBSTER_PARALLEL_SUBTASK_MAX) {
    return null;
  }
  const normalized = rawSubtasks
    .map((item): LobsterSubtaskDecision | null => normalizeSingleLobsterSubtaskDecision(item))
    .filter((item): item is LobsterSubtaskDecision => Boolean(item));
  if (normalized.length !== rawSubtasks.length) {
    return null;
  }
  const seenIds = new Set<string>();
  for (const subtask of normalized) {
    const id = subtask.id ?? buildLobsterSubtaskId(subtask.title);
    if (seenIds.has(id)) {
      return null;
    }
    seenIds.add(id);
  }
  return normalized;
}

function normalizeSingleLobsterSubtaskDecision(value: unknown): LobsterSubtaskDecision | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const subtask = value as {
    id?: unknown;
    title?: unknown;
    prompt?: unknown;
    conflictGroup?: unknown;
    writeFiles?: unknown;
  };
  const title = typeof subtask.title === "string" ? subtask.title.trim() : "";
  const prompt = typeof subtask.prompt === "string" ? subtask.prompt.trim() : "";
  if (!title || !prompt || prompt.length < LOBSTER_SUBTASK_PROMPT_MIN_LENGTH) {
    return null;
  }
  const id = typeof subtask.id === "string" && subtask.id.trim()
    ? subtask.id.trim()
    : buildLobsterSubtaskId(title);
  const conflictGroup = typeof subtask.conflictGroup === "string" && subtask.conflictGroup.trim()
    ? subtask.conflictGroup.trim()
    : undefined;
  const writeFiles = normalizeLobsterWriteFiles(subtask.writeFiles);
  return {
    id,
    title,
    prompt,
    conflictGroup,
    writeFiles: writeFiles.length > 0 ? writeFiles : undefined,
  };
}

function normalizeLobsterRoundSummaries(value: unknown): LobsterRoundSummary[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .map((item): LobsterRoundSummary | null => normalizeSingleLobsterRoundSummary(item))
    .filter((item): item is LobsterRoundSummary => Boolean(item));
}

function normalizeSingleLobsterRoundSummary(value: unknown): LobsterRoundSummary | null {
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

function normalizeLobsterAcceptance(value: unknown): LobsterAcceptance | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { passed?: unknown; summary?: unknown; checks?: unknown };
  const checks = normalizeLobsterAcceptanceChecks(raw.checks);
  return {
    passed: raw.passed === true,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    checks,
  };
}

function normalizeLobsterAcceptanceChecks(value: unknown): LobsterAcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): LobsterAcceptanceCheck | null => {
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
    .filter((item): item is LobsterAcceptanceCheck => Boolean(item));
}

function buildLobsterSubtaskId(title: string): string {
  return `subtask_${createHash("sha1").update(title).digest("hex").slice(0, 10)}`;
}

function applyLobsterMainDecision(
  taskId: string,
  decision: LobsterMainDecision
): { status: "completed" | "continue" | "blocked"; task: LobsterTaskRecord; subtasks?: LobsterSubtaskRecord[] } {
  const existing = readLobsterTaskRecord(taskId);
  if (!existing) {
    throw new Error(`lobster-task-missing:${taskId}`);
  }
  if (decision.status === "completed") {
    const task = updateLobsterTaskRecord(taskId, {
      status: "completed",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      answerConclusion: resolveLobsterAnswerConclusion(existing, decision),
      finalSummary: decision.finalSummary,
      estimatedRemainingRounds: 0,
      completionRoundSummaries: decision.roundSummaries ?? existing.completionRoundSummaries,
      completionRequirementCoverage: decision.requirementCoverage ?? existing.completionRequirementCoverage,
      updatedAt: Date.now(),
    }) ?? existing;
    appendLobsterMainDecisionSummary(task, decision);
    appendLobsterMainSubChatMainDecision(task, decision);
    return { status: "completed", task };
  }
  if (decision.status === "blocked") {
    const task = updateLobsterTaskRecord(taskId, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      finalSummary: decision.finalSummary ?? "Main task reported blocked.",
      ...(typeof decision.estimatedRemainingRounds === "number" ? { estimatedRemainingRounds: decision.estimatedRemainingRounds } : {}),
      updatedAt: Date.now(),
    }) ?? existing;
    appendLobsterMainDecisionSummary(task, decision);
    appendLobsterMainSubChatMainDecision(task, decision);
    return { status: "blocked", task };
  }

  const decisionSubtasks = getLobsterDecisionSubtasks(decision);
  if (decisionSubtasks.length === 0) {
    const task = updateLobsterTaskRecord(taskId, {
      status: "needs-review",
      activeSubtaskId: null,
      activeSubtaskIds: [],
      finalSummary: "Main task returned continue without subtasks.",
      updatedAt: Date.now(),
    }) ?? existing;
    return { status: "blocked", task };
  }

  const subtaskBatch = upsertLobsterSubtasks(existing, decisionSubtasks);
  const activeSubtaskIds = subtaskBatch.records.map((item) => item.id);
  const task = updateLobsterTaskRecord(taskId, {
    status: "running",
    activeSubtaskId: activeSubtaskIds[0] ?? null,
    activeSubtaskIds,
    subTasks: subtaskBatch.nextSubtasks,
    ...(typeof decision.estimatedRemainingRounds === "number" ? { estimatedRemainingRounds: decision.estimatedRemainingRounds } : {}),
    updatedAt: Date.now(),
  }) ?? existing;
  appendLobsterMainDecisionSummary(task, decision);
  appendLobsterMainSubChatMainDecision(task, decision, subtaskBatch.records);
  return { status: "continue", task, subtasks: subtaskBatch.records };
}

function getLobsterDecisionSubtasks(decision: LobsterMainDecision): LobsterSubtaskDecision[] {
  if (Array.isArray(decision.subtasks) && decision.subtasks.length > 0) {
    return decision.subtasks;
  }
  return decision.subtask ? [decision.subtask] : [];
}

function appendLobsterMainDecisionSummary(task: LobsterTaskRecord, decision: LobsterMainDecision): void {
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
    const remainingRounds = formatLobsterEstimatedRemainingRounds(decision.estimatedRemainingRounds);
    if (remainingRounds) {
      lines.push(`- 预计剩余轮次：${remainingRounds}`);
    }
    if (decision.status === "completed") {
      lines.push("");
      lines.push("### 问题回答结论");
      lines.push(resolveLobsterAnswerConclusion(task, decision));
    }
    if (decision.finalSummary) {
      lines.push("");
      lines.push("### 整体总结");
      lines.push(decision.finalSummary);
    }
    const decisionSubtasks = getLobsterDecisionSubtasks(decision);
    if (decisionSubtasks.length > 0) {
      lines.push("");
      lines.push(decisionSubtasks.length === 1 ? "### 下一步子任务" : "### 下一步并发子任务批次");
      if (decision.parallelReason) {
        lines.push(`- 并发判断：${decision.parallelReason}`);
      }
      decisionSubtasks.forEach((subtask, index) => {
        const prefix = decisionSubtasks.length === 1 ? "" : `${index + 1}. `;
        lines.push(`- ${prefix}子任务 ID：${subtask.id ?? buildLobsterSubtaskId(subtask.title)}`);
        lines.push(`- ${prefix}标题：${subtask.title}`);
        if (subtask.conflictGroup) {
          lines.push(`- ${prefix}冲突组：${subtask.conflictGroup}`);
        }
        const writeFiles = formatLobsterWriteFiles(subtask.writeFiles);
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
    void logError("lobster-main-summary-write-error", {
      taskId: task.id,
      filePath: task.mainCommunicationFile,
      error: String(error),
    });
  }
}

function buildLobsterSubtaskDecisionMarkdown(
  task: LobsterTaskRecord,
  round: number,
  subtasks: LobsterSubtaskRecord[],
  decision: LobsterMainDecision,
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
  const remainingRounds = formatLobsterEstimatedRemainingRounds(decision.estimatedRemainingRounds);
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
    const writeFiles = formatLobsterWriteFiles(subtasks[0].writeFiles);
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
      const writeFiles = formatLobsterWriteFiles(subtask.writeFiles);
      if (writeFiles) {
        lines.push(`- 预计写入：${writeFiles}`);
      }
    }
    lines.push(subtask.prompt ?? subtask.title);
  });

  return `${lines.join("\n")}\n`;
}

function upsertLobsterSubtask(
  task: LobsterTaskRecord,
  subtask: NonNullable<LobsterMainDecision["subtask"]>
): { record: LobsterSubtaskRecord; nextSubtasks: LobsterSubtaskRecord[] } {
  const now = Date.now();
  const id = subtask.id && subtask.id.trim() ? subtask.id.trim() : buildLobsterSubtaskId(subtask.title);
  const nextSubtasks = [...task.subTasks];
  const existingIndex = nextSubtasks.findIndex((item) => item.id === id);
  const record: LobsterSubtaskRecord = {
    id,
    title: subtask.title,
    prompt: subtask.prompt,
    conflictGroup: subtask.conflictGroup,
    writeFiles: subtask.writeFiles,
    status: "running",
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    nextSubtasks[existingIndex] = {
      ...nextSubtasks[existingIndex],
      ...record,
      status: nextSubtasks[existingIndex].status === "completed" ? "completed" : "running",
    };
    return { record: nextSubtasks[existingIndex], nextSubtasks };
  }
  nextSubtasks.push(record);
  return { record, nextSubtasks };
}

function upsertLobsterSubtasks(
  task: LobsterTaskRecord,
  subtasks: LobsterSubtaskDecision[],
): { records: LobsterSubtaskRecord[]; nextSubtasks: LobsterSubtaskRecord[] } {
  let nextSubtasks = [...task.subTasks];
  const records: LobsterSubtaskRecord[] = [];
  subtasks.forEach((subtask) => {
    const result = upsertLobsterSubtask({ ...task, subTasks: nextSubtasks }, subtask);
    nextSubtasks = result.nextSubtasks;
    records.push(result.record);
  });
  return { records, nextSubtasks };
}

function getActiveLobsterSubtaskIds(task: LobsterTaskRecord): string[] {
  const ids = Array.isArray(task.activeSubtaskIds) ? task.activeSubtaskIds : [];
  const normalized = ids.filter((id) => typeof id === "string" && id.trim());
  if (task.activeSubtaskId && !normalized.includes(task.activeSubtaskId)) {
    normalized.unshift(task.activeSubtaskId);
  }
  return Array.from(new Set(normalized));
}

function markLobsterSubtaskRunFinished(
  taskId: string,
  subtaskId: string,
  runStatus: TaskRunStatus,
  assistantContent: string | null,
): void {
  const task = readLobsterTaskRecord(taskId);
  if (!task) {
    return;
  }
  const subtaskRecord = task.subTasks.find((item) => item.id === subtaskId);
  const now = Date.now();
  const summary = buildLobsterSubtaskCompletionSummary(assistantContent);
  const nextStatus: LobsterSubtaskRecord["status"] = runStatus === "end" ? "completed" : "blocked";
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
  const activeSubtaskIds = getActiveLobsterSubtaskIds(task).filter((id) => id !== subtaskId);
  updateLobsterTaskRecord(taskId, {
    subTasks,
    activeSubtaskId: activeSubtaskIds[0] ?? null,
    activeSubtaskIds,
    updatedAt: now,
  });
  appendLobsterSubtaskCompletionAutoLog(task, subtaskRecord, runStatus, summary, assistantContent);
  if (subtaskRecord) {
    appendLobsterMainSubChatSubtaskFinished(task, subtaskRecord, runStatus, assistantContent);
  } else {
    refreshOpenLobsterDebateChatPanelForTask(taskId);
  }
}

function buildLobsterSubtaskCompletionSummary(content: string | null): string | undefined {
  const normalized = String(content ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 1000 ? `${normalized.slice(0, 1000)}...` : normalized;
}

function appendLobsterSubtaskCompletionAutoLog(
  task: LobsterTaskRecord,
  subtask: LobsterSubtaskRecord | undefined,
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
    void logError("lobster-subtask-communication-read-error", {
      taskId: task.id,
      subtaskId: subtask.id,
      filePath,
      error: String(error),
    });
  }

  const verification = detectLobsterVerificationSignals(`${existingContent}\n${assistantContent ?? ""}`);
  const lines = [
    "",
    `## 扩展自动记录（${new Date().toISOString()}）`,
    `- 子任务 ID：${subtask.id}`,
    `- 子任务标题：${subtask.title}`,
    `- 运行状态：${runStatus === "end" ? "completed" : runStatus}`,
    `- 单测状态：${formatLobsterVerificationState(verification.unitTest)}`,
    `- 编译状态：${formatLobsterVerificationState(verification.build)}`,
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
    void logError("lobster-subtask-communication-append-error", {
      taskId: task.id,
      subtaskId: subtask.id,
      filePath,
      error: String(error),
    });
  }
}

function markLobsterTaskInterrupted(
  taskId: string,
  status: "error" | "stopped",
  target: PromptRunTarget,
  options: { source: "main" | "subtask"; failureMessage?: string | null } = { source: "main" }
): void {
  const existing = readLobsterTaskRecord(taskId);
  const now = Date.now();
  const patch: Partial<LobsterTaskRecord> = {
    status,
    activeSubtaskId: null,
    activeSubtaskIds: [],
    updatedAt: now,
  };
  if (options.source === "main" && status === "error") {
    Object.assign(patch, buildNextLobsterMainAiFailureState(existing ?? {}, {
      now,
      failureMessage: options.failureMessage,
    }));
    if (isLobsterMainAiFailureLimitReached({
      mainAiFailureCount: patch.mainAiFailureCount,
      mainAiFailureLimitReached: patch.mainAiFailureLimitReached,
    })) {
      patch.status = "needs-review";
      patch.finalSummary = [
        `主任务 AI 调用已连续失败 ${patch.mainAiFailureCount}/${LOBSTER_MAIN_AI_FAILURE_LIMIT} 次，自动派发已停止。`,
        options.failureMessage ? `最近一次失败：${options.failureMessage}` : "",
      ].filter(Boolean).join("\n");
    }
  }
  const record = updateLobsterTaskRecord(taskId, patch) ?? existing;
  if (record) {
    appendSystemMessageForLobster(target, buildLobsterTaskNeedsReviewText(record));
  }
}

function markLobsterTaskStoppedByUser(taskId: string): LobsterTaskRecord | null {
  const task = readLobsterTaskRecord(taskId);
  if (!task || isLobsterTaskCompleted(task)) {
    return task;
  }

  const now = Date.now();
  const stopSummary = "用户已从 Loop 群聊中止任务。";
  const subtaskStopSummary = "用户已从 Loop 群聊中止该子任务。";
  const activeSubtaskIds = new Set(getActiveLobsterSubtaskIds(task));
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
      summary: subtask.summary || subtaskStopSummary,
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
        summary: participant.summary || "用户已从 Loop 群聊中止该参与者任务。",
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

  const record = updateLobsterTaskRecord(taskId, {
    status: "stopped",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks,
    ...(debateRounds ? { debateRounds } : {}),
    finalSummary: stopSummary,
    updatedAt: now,
  });
  refreshOpenLobsterDebateChatPanelForTask(taskId);
  return record;
}

function resolvePromptRunTargetFromConversationTab(tab: ConversationTabRecord): PromptRunTarget {
  return {
    tabId: tab.id,
    cli: tab.cli,
    sessionId: getConversationTabSessionIdForCli(tab, tab.cli),
  };
}

function resolveLobsterMainPromptTarget(task: LobsterTaskRecord): PromptRunTarget | null {
  const state = ensureConversationTabs();
  let sessionFallback: ConversationTabRecord | null = null;
  for (const tab of state.tabs) {
    if (tab.cli !== task.cli) {
      continue;
    }
    const context = resolveConversationTabLobsterContext(tab);
    if (context.taskRole === "main" && context.lobsterTaskId === task.id) {
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

async function maybeWakeLobsterMainAfterSubtaskContinuation(
  context: LobsterSubtaskConversationContext,
  options: {
    tabId: string;
    previousRunEndedAt: number;
    model?: string;
    lobsterMainModel?: string;
    lobsterSubtaskModel?: string;
  }
): Promise<void> {
  const latestRun = getLatestLobsterRoundRunRecord(
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
    ? getLastLobsterAssistantContent(subtaskTarget, context.taskId, context.round, "subtask")
    : null;
  markLobsterSubtaskRunFinished(context.taskId, context.subtaskId, "end", summary);

  const latestTask = readLobsterTaskRecord(context.taskId);
  if (
    !latestTask
    || isLobsterTaskBlockedByMainAiFailureLimit(latestTask)
    || (latestTask.status !== "error" && latestTask.status !== "stopped")
  ) {
    return;
  }

  const mainTarget = resolveLobsterMainPromptTarget(latestTask);
  if (!mainTarget || isTabRunActive(mainTarget.tabId)) {
    return;
  }

  const resumedSubtask = latestTask.subTasks.find((item) => item.id === context.subtaskId);
  appendSystemMessageForLobster(
    mainTarget,
    buildLobsterMainResumeText(latestTask.id, resolveLobsterResumeRound(latestTask), resumedSubtask ? [resumedSubtask] : [])
  );

  const resumePrompt = t("run.hiddenContinuePrompt");
  await runLobsterPrompt({
    displayPrompt: resumePrompt,
    modelPrompt: resumePrompt,
    contextTags: [],
    model: options.model,
    lobsterMainModel: options.lobsterMainModel,
    lobsterSubtaskModel: options.lobsterSubtaskModel,
  }, {
    targetTabId: mainTarget.tabId,
    resumeTaskId: latestTask.id,
    resumeRequested: true,
  });
}

function getLobsterTargetSessionId(target: PromptRunTarget): string | null {
  const tab = getConversationTabById(target.tabId);
  return tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
}

function persistLobsterMessagesForTarget(target: PromptRunTarget, messages: ChatMessage[]): void {
  const sessionId = getLobsterTargetSessionId(target);
  persistMessagesForTab(target.cli, sessionId, target.tabId, messages);
}

function removeLobsterMainDecisionMessage(
  target: PromptRunTarget,
  taskId: string,
  round: number,
): void {
  const messages = getLobsterMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === "main"
      && message.lobsterTaskId === taskId
      && message.lobsterRound === round
    ) {
      messages.splice(index, 1);
      persistLobsterMessagesForTarget(target, messages);
      sendPanelMessage({ type: "removeMessage", id: message.id, tabId: target.tabId });
      return;
    }
  }
}

function replaceLobsterMainDecisionMessageWithMarkdown(
  target: PromptRunTarget,
  taskId: string,
  round: number,
  content: string,
): boolean {
  const messages = getLobsterMessagesForTarget(target);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant"
      && message.taskRole === "main"
      && message.lobsterTaskId === taskId
      && message.lobsterRound === round
    ) {
      const nextMessage: ChatMessage = {
        ...message,
        content,
        merge: false,
      };
      messages[index] = nextMessage;
      persistLobsterMessagesForTarget(target, messages);
      sendPanelMessage({ type: "replaceMessage", message: nextMessage, tabId: target.tabId });
      return true;
    }
  }
  return false;
}

function showLobsterSubtaskDecisionMarkdown(
  target: PromptRunTarget,
  task: LobsterTaskRecord,
  round: number,
  subtasks: LobsterSubtaskRecord[],
  decision: LobsterMainDecision,
): void {
  const content = buildLobsterSubtaskDecisionMarkdown(task, round, subtasks, decision);
  if (replaceLobsterMainDecisionMessageWithMarkdown(target, task.id, round, content)) {
    return;
  }

  const messages = getLobsterMessagesForTarget(target);
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    lobsterTaskId: task.id,
    lobsterRound: round,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLobsterMessagesForTarget(target, messages);
}

function hasCompleteLobsterCompletionMessagesForTask(target: PromptRunTarget, taskId: string): boolean {
  return hasCompleteLobsterCompletionMessages(getLobsterMessagesForTarget(target), taskId);
}

function appendLobsterAnswerConclusionMessage(
  target: PromptRunTarget,
  task: LobsterTaskRecord,
  decision?: LobsterMainDecision | null,
): void {
  const messages = getLobsterMessagesForTarget(target);
  const content = buildLobsterAnswerConclusionMarkdown(task, decision);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!existing || !isLobsterAnswerConclusionMessageForTask(existing, task.id)) {
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
      lobsterTaskId: task.id,
      lobsterAnswerConclusion: true,
    };
    messages[index] = replacement;
    sendPanelMessage({ type: "replaceMessage", message: replacement, tabId: target.tabId });
    persistLobsterMessagesForTarget(target, messages);
    return;
  }
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    lobsterTaskId: task.id,
    lobsterAnswerConclusion: true,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLobsterMessagesForTarget(target, messages);
}

function appendLobsterFinalSummaryMessage(
  target: PromptRunTarget,
  task: LobsterTaskRecord,
  decision?: LobsterMainDecision | null,
): void {
  const messages = getLobsterMessagesForTarget(target);
  const content = buildLobsterFinalSummaryMarkdown(task, decision);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (!existing || !isLobsterFinalSummaryMessageForTask(existing, task.id)) {
      continue;
    }
    if (isCompleteLobsterFinalSummaryContent(existing.content)) {
      return;
    }
    const replacement: ChatMessage = {
      ...existing,
      content,
      merge: false,
      taskRole: "main",
      lobsterTaskId: task.id,
      lobsterFinalSummary: true,
    };
    messages[index] = replacement;
    sendPanelMessage({ type: "replaceMessage", message: replacement, tabId: target.tabId });
    persistLobsterMessagesForTarget(target, messages);
    return;
  }
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content,
    createdAt: Date.now(),
    merge: false,
    taskRole: "main",
    lobsterTaskId: task.id,
    lobsterFinalSummary: true,
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  persistLobsterMessagesForTarget(target, messages);
}

function appendSystemMessageForLobster(
  target: PromptRunTarget,
  content: string,
  options: {
    taskRole?: LobsterTaskRole;
    lobsterTaskId?: string;
    lobsterRound?: number;
    lobsterSubtaskId?: string;
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
    ...(options.lobsterTaskId ? { lobsterTaskId: options.lobsterTaskId } : {}),
    ...(typeof options.lobsterRound === "number" ? { lobsterRound: options.lobsterRound } : {}),
    ...(options.lobsterSubtaskId ? { lobsterSubtaskId: options.lobsterSubtaskId } : {}),
    ...(options.actions?.length ? { actions: options.actions } : {}),
  };
  appendMessageToStore(messages, message);
  sendPanelMessage({ type: "appendMessage", message, tabId: target.tabId });
  if (sessionId) {
    persistMessagesForTab(target.cli, sessionId, target.tabId, messages);
    return;
  }
  // Keep lobster pre-run system messages in draft only, so the first real turn can
  // start a fresh remote session instead of being blocked by a local-only session id.
  updatePendingSessionDraft(target.tabId, { messages }, target.cli);
}

function getLobsterRoundRunStatus(
  taskId: string,
  round: number,
  role: LobsterTaskRole,
  subtaskId?: string,
): TaskRunStatus | null {
  const record = getLatestLobsterRoundRunRecord(taskId, round, role, subtaskId);
  return record ? record.status : null;
}

function getLatestLobsterRoundRunRecord(
  taskId: string,
  round: number,
  role: LobsterTaskRole,
  subtaskId?: string,
): TaskRunRecord | null {
  const runs = readTaskStore().runs;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (
      run.lobsterTaskId === taskId
      && run.lobsterRound === round
      && run.taskRole === role
      && (role !== "subtask" || run.lobsterSubtaskId === subtaskId)
    ) {
      return run;
    }
  }
  return null;
}

function isAutoContextCompactionCli(cli: CliName): cli is "codex" | "claude" | "gemini" {
  return cli === "codex" || cli === "claude" || cli === "gemini";
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

function maybePersistLongTermMemoryFromRun(options: {
  status: TaskRunStatus;
  cli: CliName;
  prompt: string;
  messages: readonly ChatMessage[];
  taskRole?: LobsterTaskRole;
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
}): void {
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
      lobsterTaskId: options.lobsterTaskId,
      lobsterRound: options.lobsterRound,
      lobsterSubtaskId: options.lobsterSubtaskId,
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

  const shouldUseInteractive = isInteractiveSupported(target.cli);

  if (shouldUseInteractive) {
    try {
      await runPromptInteractive(input, target);
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
      return;
    }
  }

  if (hasOtherTabRun(target.tabId)) {
    await runPromptParallel(input, target);
    return;
  }

  await runPromptOneShot(input, target);
}

async function runPromptOneShot(input: PromptRunInput, target: PromptRunTarget): Promise<void> {
  const prompt = input.displayPrompt;
  const runCli = target.cli;
  if (runCli !== "gemini") {
    throw new Error(`one-shot-run-unsupported:${runCli}`);
  }
  const modelPrompt = input.modelPrompt || prompt;
  const contextTags = Array.isArray(input.contextTags)
    ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  if (!prompt) {
    return;
  }
  const cwd = resolveWorkspaceCwd();
  if (!cwd) {
    void logInfo("runPrompt-no-workspace", { cli: runCli });
  }
  const selectedModel = input.model || getSelectedCliModel(runCli);
  const thinkingMode = getEffectiveThinkingMode(runCli, selectedModel);
  applyThinkingWorkspaceFiles(runCli, thinkingMode, cwd);
  const geminiRunProfile = prepareGeminiRunProfile(selectedModel, thinkingMode, cwd);
  const runtimeModel = geminiRunProfile.runtimeModel ?? selectedModel;
  const runtimeEnvOverrides = geminiRunProfile.envOverrides;
  const activeTabId = target.tabId;
  const shouldAutoCompactAfterRun = shouldAutoCompactContextAfterRunForTarget(target);
  preparePendingLabel(runCli, activeTabId, prompt);
  const initialSessionId = target.sessionId;
  const thinkingPrompt = buildThinkingPrompt(runCli, thinkingMode, modelPrompt);
  const hiddenRetryPrompt = buildHiddenRetryPrompt(runCli, thinkingMode);
  const debugLogging = getDebugLogging();
  const messageTarget = initialSessionId
    ? loadSessionMessages(runCli, initialSessionId)
    : getPendingSessionDraft(activeTabId, runCli).messages;
  const args = buildCliArgs(
    runCli,
    { sessionId: initialSessionId, thinkingMode, model: runtimeModel, envOverrides: runtimeEnvOverrides },
    thinkingPrompt,
  );
  const command = getCliCommand(runCli);
  logCliStartup({
    cli: runCli,
    cwd,
    command,
    args: redactPromptArg(args, thinkingPrompt),
    env: sanitizeEnv({ ...process.env, ...(runtimeEnvOverrides ?? {}) }),
    mode: "one-shot",
  });
  void logInfo("runPrompt-start", {
    cli: runCli,
    command: getCliCommand(runCli),
    args,
    cwd,
    sessionId: initialSessionId,
    thinkingMode,
    model: runtimeModel,
  });

  const userMessageId = input.preloadedUserMessageId ?? createMessageId();
  const userCreatedAt = Date.now();
  const runId = createMessageId();
  activeRunId = runId;
  applyProcessTitle(runId, runCli, initialSessionId);
  startTaskRun(runId, runCli, initialSessionId, prompt, {
    taskRole: input.taskRole,
    lobsterTaskId: input.lobsterTaskId,
    lobsterRound: input.lobsterRound,
    lobsterSubtaskId: input.lobsterSubtaskId,
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

  const isCurrentOneShotRunActive = (): boolean => activeRunId === runId;

  while (true) {
    const attemptNumber = hiddenRetryCount + 1;
    const attemptPrompt = hiddenRetryCount === 0 ? thinkingPrompt : hiddenRetryPrompt;
    let attemptHadNormalReply = false;

    if (hiddenRetryCount > 0) {
      const retryNumber = hiddenRetryCount;
      const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
      const shouldContinue = await waitForHiddenRetryDelay(retryNumber, isCurrentOneShotRunActive);
      if (!shouldContinue) {
        return;
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
      });
    }

    let sessionBuffer = "";
    let rawStdout = "";
    let rawStderr = "";
    const geminiStreamState = { remainder: "", assistantText: "", resultStatus: null as string | null, errorText: null as string | null };
    const runtimeSessionId = activeSessionId;
    const attemptResult = await new Promise<
      { type: "exit"; code: number | null }
      | { type: "error"; error: Error }
    >((resolve) => {
      let settled = false;
      const settle = (result: { type: "exit"; code: number | null } | { type: "error"; error: Error }): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };
      activeProcess = runCliStream(
        runCli,
        attemptPrompt,
        {
          onStdout: (chunk: string) => {
            if (!isCurrentOneShotRunActive()) {
              return;
            }
            rawStdout += chunk;
            sendRawStreamDelta(chunk, { stream: "stdout" });
            sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
            captureSessionFromBuffer(runCli, sessionBuffer);
            processGeminiStreamJsonChunk(geminiStreamState, chunk, {
              onAssistantText: (text) => {
                if (text.trim().length > 0) {
                  attemptHadNormalReply = true;
                }
                appendAssistantChunk(text);
              },
              onTraceText: (text) => appendTraceLines(`${text}\n`),
              onSessionId: (nextSessionId) => adoptSessionId(runCli, nextSessionId, activeTabIdForRun),
              onPlainText: (text) => {
                if (text.trim().length > 0) {
                  attemptHadNormalReply = true;
                }
                appendAssistantChunk(text);
              },
            });
            if (debugLogging) {
              void logCliStream(runCli, activeSessionId, "stdout", chunk);
            }
          },
          onStderr: (chunk: string) => {
            if (!isCurrentOneShotRunActive()) {
              return;
            }
            rawStderr += chunk;
            sendRawStreamDelta(chunk, { stream: "stderr" });
            sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
            captureSessionFromBuffer(runCli, sessionBuffer);
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
          model: runtimeModel,
          envOverrides: runtimeEnvOverrides,
          processLabel: buildProcessLabel(runCli, runtimeSessionId ?? runId),
        }
      );
    });

    if (activeRunId !== runId) {
      return;
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

    finalizeGeminiStreamJsonState(geminiStreamState, {
      onAssistantText: (text) => {
        if (text.trim().length > 0) {
          attemptHadNormalReply = true;
        }
        appendAssistantChunk(text);
      },
      onTraceText: (text) => appendTraceLines(`${text}\n`),
      onSessionId: (nextSessionId) => adoptSessionId(runCli, nextSessionId, activeTabIdForRun),
      onPlainText: (text) => {
        if (text.trim().length > 0) {
          attemptHadNormalReply = true;
        }
        appendAssistantChunk(text);
      },
    });

    const geminiResultFailed = attemptResult.type === "exit"
      && attemptResult.code === 0
      && geminiStreamState.resultStatus !== null
      && geminiStreamState.resultStatus !== "success";

    if (attemptResult.type === "exit" && attemptResult.code === 0 && !geminiResultFailed) {
      const finalSessionId = activeSessionId;
      const durationMs = activeTaskRun?.id === runId
        ? Math.max(0, Date.now() - activeTaskRun.startedAt)
        : null;
      void logInfo("runPrompt-exit", { cli: runCli, code: attemptResult.code });
      flushTraceBuffer();
      const finalMessageTarget = activeMessageTarget ?? messageTarget;
      if (!hasAssistantFinalConclusionAfterMessage(finalMessageTarget, userMessageId, {
        fallbackCreatedAt: userCreatedAt,
      })) {
        const missingConclusionMessage = t("run.missingFinalConclusionRetryReason");
        if (hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES) {
          appendHiddenRetryErrorTraceMessage(activeMessageTarget, missingConclusionMessage, {
            taskRole: input.taskRole,
            lobsterTaskId: input.lobsterTaskId,
            lobsterRound: input.lobsterRound,
            lobsterSubtaskId: input.lobsterSubtaskId,
          }, { createMessageId, sendPanelMessage });
          appendSystemMessage(buildHiddenRetryQueuedMessage(hiddenRetryCount));
          hiddenRetryCount += 1;
          void logInfo("runPrompt-one-shot-missing-final-conclusion-retry", {
            cli: runCli,
            runId,
            tabId: activeTabId,
            sessionId: activeSessionId,
            retryCount: hiddenRetryCount,
            maxRetries: HIDDEN_RETRY_MAX_RETRIES,
          });
          continue;
        }
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
        lobsterTaskId: input.lobsterTaskId,
        lobsterRound: input.lobsterRound,
        lobsterSubtaskId: input.lobsterSubtaskId,
      });
      clearActiveRun();
      if (shouldAutoCompactAfterRun) {
        await maybeAutoCompactContextAfterPromptSuccess(target, finalSessionId, durationMs);
      }
      return;
    }

    hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
    const retryFailureMessage = getAttemptFailureMessage(attemptResult, geminiStreamState.errorText);
    const shouldRetry = hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES && (
      geminiResultFailed
        || attemptResult.type === "exit"
        || isHiddenRetryEligibleErrorInfo(getErrorInfo(attemptResult.error))
    );
    if (shouldRetry) {
      appendHiddenRetryErrorTraceMessage(activeMessageTarget, retryFailureMessage, {
        taskRole: input.taskRole,
        lobsterTaskId: input.lobsterTaskId,
        lobsterRound: input.lobsterRound,
        lobsterSubtaskId: input.lobsterSubtaskId,
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
    } else {
      void logInfo("runPrompt-exit", { cli: runCli, code: attemptResult.code });
      const lastFailureMessage = geminiStreamState.errorText
        ? geminiStreamState.errorText
        : t("run.exitCode", { code: attemptResult.code ?? "unknown" });
      sendRunStatus("error", buildHiddenRetryFailureMessage({
        hiddenRetryCount,
        maxRetries: HIDDEN_RETRY_MAX_RETRIES,
        retryLimitMessage: buildHiddenRetryLimitMessage(),
        fallbackMessage: lastFailureMessage,
        lastFailureMessage,
        lastFailurePrefix: t("run.hiddenRetryLastErrorPrefix"),
      }));
    }

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
    getWorkspaceCodexMultiAgentEnabled,
    upsertInteractiveMapping,
    sendRawStreamDelta,
    sendPanelMessage: (message) => sendPanelMessage(message),
    updateProcessTitle,
    appendTraceMessage,
    prepareGeminiRunProfile,
    setActiveProcess: (process) => {
      activeProcess = process;
    },
    appendAssistantChunk,
    adoptSessionId,
  }, options);
}

function shouldAutoCompactContextAfterRunForTarget(target: PromptRunTarget): boolean {
  if (!getWorkspaceAutoCompactContextAfterRun()) {
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

async function runPromptInteractive(input: PromptRunInput, target: PromptRunTarget): Promise<void> {
  const prompt = input.displayPrompt;
  const modelPrompt = input.modelPrompt || prompt;
  const contextTags = Array.isArray(input.contextTags)
    ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  if (!prompt) {
    return;
  }

  const cli = target.cli;
  const cwd = resolveWorkspaceCwd();
  const selectedModel = input.model || getSelectedCliModel(cli);
  const thinkingMode = getEffectiveThinkingMode(cli, selectedModel);
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

  const thinkingPrompt = buildThinkingPrompt(cli, thinkingMode, modelPrompt, { includeSuffix: false });
  const hiddenRetryPrompt = buildHiddenRetryPrompt(cli, thinkingMode);
  const debugLogging = getDebugLogging();
  const args = cli === "codex"
    ? buildCliArgs(cli, {
        thinkingMode,
        model: selectedModel,
        imagePaths: input.imagePaths,
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
    rawStdout += chunk;
    startInteractiveLog(interactiveInput);
    void logCliInteractiveOutput(cli, uiSessionId, "stdout", chunk);
  };

  const appendTraceLog = (content: string): void => {
    if (!debugLogging || !content.trim()) {
      return;
    }
    const normalized = content.endsWith("\n") ? content : content + "\n";
    rawStderr += normalized;
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
      lobsterTaskId: input.lobsterTaskId,
      lobsterRound: input.lobsterRound,
      lobsterSubtaskId: input.lobsterSubtaskId,
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
      lobsterTaskId: input.lobsterTaskId,
      lobsterRound: input.lobsterRound,
      lobsterSubtaskId: input.lobsterSubtaskId,
    };
    appendTaskRun(taskRecord);
    appendSystemMessageForTab(
      buildTaskRunCompletionText(status, taskRecord.durationMs)
    );
    return taskRecord;
  };

  const cleanupAfterRun = async (status: TaskRunStatus, userMessage?: string): Promise<void> => {
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
      lobsterTaskId: input.lobsterTaskId,
      lobsterRound: input.lobsterRound,
      lobsterSubtaskId: input.lobsterSubtaskId,
    });
    interactiveRunsByTabId.delete(tabId);
    if (status === "end" && shouldAutoCompactAfterRun) {
      await maybeAutoCompactContextAfterPromptSuccess(target, uiSessionId, taskRecord?.durationMs ?? null);
    }
  };

  const updateSessionForNewRun = (newId: string): void => {
    const localSessionIdToPromote = !uiSessionId
      ? (getConversationTabById(tabId)?.sessionId ?? null)
      : (isLocalSessionId(uiSessionId) ? uiSessionId : null);

    if (!uiSessionId || localSessionIdToPromote) {
      adoptSessionId(cli, newId, tabId);
      upsertInteractiveMapping(cli, newId, newId);
      if (localSessionIdToPromote && localSessionIdToPromote !== newId) {
        migrateLocalSessionToTargetSession(cli, localSessionIdToPromote, newId);
      }
      uiSessionId = newId;
      refreshMessageTargetFromSession();
      return;
    }
    upsertInteractiveMapping(cli, uiSessionId, newId);
  };

  const stopFn = (): void => {
    const entry = interactiveRunsByTabId.get(tabId);
    if (!entry || entry.runId !== runId || entry.stopped) {
      return;
    }
    entry.stopped = true;
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
      observedCodexFinalAnswer: source === "codex" && observedCodexFinalAnswer,
      fallbackCreatedAt: userCreatedAt,
      requireExplicitCodexFinalAnswer: source === "codex",
    })) {
      return { action: "ok" };
    }
    const missingConclusionMessage = t("run.missingFinalConclusionRetryReason");
    if (hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES) {
      appendMessageForTab(createHiddenRetryErrorTraceMessage(missingConclusionMessage, {
        taskRole: input.taskRole,
        lobsterTaskId: input.lobsterTaskId,
        lobsterRound: input.lobsterRound,
        lobsterSubtaskId: input.lobsterSubtaskId,
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
  sendRunStatusForTab(tabId, "start", { prompt, startedAt });

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
    lobsterTaskId: input.lobsterTaskId,
    lobsterRound: input.lobsterRound,
    lobsterSubtaskId: input.lobsterSubtaskId,
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
        const runner = uiSessionId
          ? interactiveRunnerManager.getOrCreateCodexRunner({
              sessionId: uiSessionId,
              threadId: mappedThreadId,
              command,
              args,
              cwd: cwd ?? undefined,
              thinkingMode,
              interactiveMode,
              model: selectedModel,
              multiAgentEnabled: getWorkspaceCodexMultiAgentEnabled(),
            })
          : new (await import("./interactive/codexRunner")).CodexInteractiveRunner({
              command,
              args,
              cwd: cwd ?? undefined,
              thinkingMode,
              interactiveMode,
              model: selectedModel,
              threadId: null,
              multiAgentEnabled: getWorkspaceCodexMultiAgentEnabled(),
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
          onTrace: (content, kind, meta) => {
            if (!isCurrentRunActive()) {
              return;
            }
            if (content.trim().length > 0 && kind !== "thinking") {
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
            appendDebugEvent(event);
          },
          onTaskListUpdate: (items) => {
            sendPanelMessage({ type: "taskListUpdate", items, tabId });
          },
          onThreadId: (threadId) => {
            updateProcessTitle(cli, threadId);
            updateSessionForNewRun(threadId);
            void logInfo("runPrompt-interactive-codex-thread", {
              cli,
              sessionId: uiSessionId,
              threadId,
              originalSessionId: target.sessionId,
              tabId,
            });
            if (uiSessionId) {
              interactiveRunnerManager.setRunner("codex", uiSessionId, runner, thinkingMode, interactiveMode, selectedModel, {
                multiAgentEnabled: getWorkspaceCodexMultiAgentEnabled(),
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

      const canContinueCurrentConversation = Boolean(uiSessionId);
      hiddenRetryCount = resetHiddenRetryCountOnRecoveredReply(hiddenRetryCount, attemptHadNormalReply);
      const shouldRetry = canContinueCurrentConversation
        && hiddenRetryCount < HIDDEN_RETRY_MAX_RETRIES
        && isHiddenRetryEligibleErrorInfo(info);
      if (shouldRetry) {
        const retryDelayMs = getHiddenRetryDelayMs(hiddenRetryCount + 1);
        appendMessageForTab(createHiddenRetryErrorTraceMessage(info.message, {
          taskRole: input.taskRole,
          lobsterTaskId: input.lobsterTaskId,
          lobsterRound: input.lobsterRound,
          lobsterSubtaskId: input.lobsterSubtaskId,
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
  if (currentCli === "codex" || currentCli === "gemini") {
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
    lobsterTaskId: activeTaskRun?.lobsterTaskId,
    lobsterRound: activeTaskRun?.lobsterRound,
    lobsterSubtaskId: activeTaskRun?.lobsterSubtaskId,
  };
  appendMessageToStore(activeMessageTarget, message);
  activeMessageIndex = activeMessageTarget.length - 1;
  sendPanelMessage({
    type: "appendMessage",
    message,
  });
}

function startTraceMessage(cli: CliName): void {
  if (cli !== "codex" && cli !== "gemini") {
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
  options: { taskRole?: LobsterTaskRole; lobsterTaskId?: string; lobsterRound?: number; lobsterSubtaskId?: string } = {}
): void {
  activeTaskRun = {
    id: runId,
    cli,
    sessionId,
    prompt,
    startedAt: Date.now(),
    taskRole: options.taskRole,
    lobsterTaskId: options.lobsterTaskId,
    lobsterRound: options.lobsterRound,
    lobsterSubtaskId: options.lobsterSubtaskId,
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
  sendPanelMessage({
    type: "runStatus",
    status,
    message,
    prompt: status === "start" ? activeTaskRun?.prompt : undefined,
    startedAt: status === "start" ? activeTaskRun?.startedAt : undefined,
    activity: status === "start" ? options.activity : undefined,
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
    isLobsterTaskRole,
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

function createLobsterTaskRecord(
  cli: CliName,
  rootPrompt: string,
  options: { sessionId?: string | null; executionMode?: LobsterExecutionMode } = {}
): LobsterTaskRecord {
  const now = Date.now();
  const id = createMessageId();
  const communication = getLobsterCommunicationPaths(id);
  const sessionId = typeof options.sessionId === "string" && options.sessionId.trim()
    ? options.sessionId
    : null;
  const executionMode = normalizeLobsterExecutionMode(options.executionMode);
  const taskStoreFile = buildLobsterTaskStoreFile(cli, activeWorkspaceKey, sessionId, id);
  ensureLobsterCommunicationFiles(id, rootPrompt);
  const record: LobsterTaskRecord = {
    id,
    cli,
    workspaceKey: activeWorkspaceKey,
    taskStoreFile,
    rootPrompt,
    executionMode,
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: getGlobalLobsterMaxRounds(),
    currentRound: 0,
    communicationDir: communication.dir,
    mainCommunicationFile: communication.mainFile,
    sessionId,
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    ...buildResetLobsterMainAiFailureState(),
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
  const store = readLobsterTaskStore(taskStoreFile);
  store.tasks.push(record);
  writeLobsterTaskStore(taskStoreFile, store);
  return record;
}

function resolvePromptRunTargetSessionId(target: PromptRunTarget): string | null {
  return resolvePromptRunTargetSessionIdWithDeps(target, (candidate) => {
    const tab = getConversationTabById(candidate.tabId);
    return tab ? getConversationTabSessionIdForCli(tab, candidate.cli) : null;
  });
}

function resolveLobsterTaskSessionId(target: PromptRunTarget): string | null {
  return resolveLobsterTaskSessionIdWithDeps(target, (candidate) => {
    const tab = getConversationTabById(candidate.tabId);
    return tab ? getConversationTabSessionIdForCli(tab, candidate.cli) : null;
  });
}

function isLobsterTaskBlockedByMainAiFailureLimit(task: Pick<LobsterTaskRecord, "mainAiFailureCount" | "mainAiFailureLimitReached">): boolean {
  return isLobsterTaskBlockedByMainAiFailureLimitWithLimit(task, LOBSTER_MAIN_AI_FAILURE_LIMIT);
}

function normalizeThinkingModeForCli(cli: CliName, mode: ThinkingMode): ThinkingMode {
  if (cli !== "claude" && mode === "max") {
    return cli === "codex" ? "xhigh" : "high";
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
  return getStoredCliModelThinkingMode(cli, model) ?? getWorkspaceThinkingMode(cli);
}

type PreparedGeminiRunProfile = {
  sourceModel: string | null;
  runtimeModel: string | null;
  envOverrides?: Record<string, string>;
};

function prepareGeminiRunProfile(
  selectedModel: string | null,
  thinkingMode: ThinkingMode,
  cwd?: string,
): PreparedGeminiRunProfile {
  cleanupLegacyGeminiThinkingSettings(cwd);
  const baseModel = normalizeCliModelName(selectedModel)
    ?? readModelArg("gemini", getCliArgs("gemini"));
  const runtimeProfile = buildGeminiThinkingRuntimeProfile(baseModel, thinkingMode);
  if (!runtimeProfile.systemSettings || !runtimeProfile.runtimeModel) {
    void logInfo("gemini-thinking-runtime-passthrough", {
      selectedModel: runtimeProfile.baseModel,
      requestedMode: runtimeProfile.requestedMode,
      effectiveMode: runtimeProfile.effectiveMode,
      strategy: runtimeProfile.strategy,
    });
    return {
      sourceModel: runtimeProfile.baseModel,
      runtimeModel: runtimeProfile.runtimeModel ?? runtimeProfile.baseModel,
    };
  }
  ensureTempDir();
  cleanupTempDir();
  const settingsPath = buildTempFilePath("gemini-system-settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(runtimeProfile.systemSettings, null, 2), "utf8");
  void logInfo("gemini-thinking-runtime-prepared", {
    selectedModel: runtimeProfile.baseModel,
    runtimeModel: runtimeProfile.runtimeModel,
    requestedMode: runtimeProfile.requestedMode,
    effectiveMode: runtimeProfile.effectiveMode,
    strategy: runtimeProfile.strategy,
    settingsPath,
  });
  return {
    sourceModel: runtimeProfile.baseModel,
    runtimeModel: runtimeProfile.runtimeModel,
    envOverrides: {
      [GEMINI_SYSTEM_SETTINGS_ENV_KEY]: settingsPath,
    },
  };
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

function getWorkspaceLobsterExecutionMode(cli: CliName): LobsterExecutionMode {
  const perCli = workspaceSettings.lobsterExecutionModeByCli;
  if (!perCli) {
    return DEFAULT_LOBSTER_EXECUTION_MODE;
  }
  return normalizeLobsterExecutionMode(perCli[cli]);
}

function setWorkspaceLobsterExecutionModeForCli(cli: CliName, mode: LobsterExecutionMode): boolean {
  const normalizedMode = normalizeLobsterExecutionMode(mode);
  if (!workspaceSettings.lobsterExecutionModeByCli) {
    workspaceSettings.lobsterExecutionModeByCli = {};
  }
  if (workspaceSettings.lobsterExecutionModeByCli[cli] === normalizedMode) {
    return false;
  }
  workspaceSettings.lobsterExecutionModeByCli[cli] = normalizedMode;
  saveWorkspaceSettings(workspaceSettings);
  return true;
}

function buildWorkspaceLobsterExecutionModeByCli(): Record<CliName, LobsterExecutionMode> {
  const result = {} as Record<CliName, LobsterExecutionMode>;
  CLI_LIST.forEach((cli) => {
    result[cli] = getWorkspaceLobsterExecutionMode(cli);
  });
  return result;
}

function getWorkspaceCodexMultiAgentEnabled(): boolean {
  return workspaceSettings.codexMultiAgentEnabled === true;
}

function buildLongTermMemoryRuntimeSettings(): MemoryRuntimeGateSettings {
  const toolSettings = readToolSettings();
  return {
    memoryEnabled: toolSettings.memoryEnabled,
    globalMemoryEnabled: toolSettings.globalMemoryEnabled,
    memoryAutoExtractAfterCompact: toolSettings.memoryAutoExtractAfterCompact,
    memoryAutoExtractAfterLobsterTask: toolSettings.memoryAutoExtractAfterLobsterTask,
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
  const terminal = vscode.window.createTerminal({
    name: WORKSPACE_HARNESS_TERMINAL_NAME,
    cwd: workspaceRoot,
  });
  terminal.show();
  terminal.sendText(CODEGRAPH_SETUP_COMMAND);
  void logInfo("workspace-harness-codegraph-setup-triggered", {
    workspace: workspaceRoot,
    command: CODEGRAPH_SETUP_COMMAND,
  });
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

function getWorkspaceAutoCompactContextAfterRun(): boolean {
  if (typeof workspaceSettings.autoCompactContextAfterRun === "boolean") {
    return workspaceSettings.autoCompactContextAfterRun;
  }
  if (typeof workspaceSettings.autoCompactContextBeforeRun === "boolean") {
    return workspaceSettings.autoCompactContextBeforeRun;
  }
  return true;
}

function normalizeLobsterMaxRounds(value: unknown): number {
  const rawValue = parseLobsterMaxRoundsValue(value);
  if (!Number.isFinite(rawValue)) {
    return LOBSTER_DEFAULT_MAX_ROUNDS;
  }
  const integerValue = Math.floor(rawValue);
  return Math.min(Math.max(integerValue, LOBSTER_MIN_MAX_ROUNDS), LOBSTER_MAX_MAX_ROUNDS);
}

function normalizeStoredLobsterMaxRounds(value: unknown): number {
  const rawValue = parseLobsterMaxRoundsValue(value);
  if (!Number.isFinite(rawValue)) {
    return LOBSTER_DEFAULT_MAX_ROUNDS;
  }
  return Math.max(Math.floor(rawValue), LOBSTER_MIN_MAX_ROUNDS);
}

function parseLobsterMaxRoundsValue(value: unknown): number {
  const rawValue = typeof value === "number"
    ? value
    : (typeof value === "string" && value.trim() ? Number(value) : Number.NaN);
  return rawValue;
}

function getGlobalLobsterMaxRounds(): number {
  const toolSettings = readToolSettings();
  if (typeof toolSettings.lobsterMaxRounds === "number") {
    return normalizeLobsterMaxRounds(toolSettings.lobsterMaxRounds);
  }
  return normalizeLobsterMaxRounds(workspaceSettings.lobsterMaxRounds);
}

function getGlobalLobsterAutoCloseSubtaskTabs(): boolean {
  const toolSettings = readToolSettings();
  if (typeof toolSettings.lobsterAutoCloseSubtaskTabs === "boolean") {
    return toolSettings.lobsterAutoCloseSubtaskTabs;
  }
  return workspaceSettings.lobsterAutoCloseSubtaskTabs !== false;
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
    normalizeLobsterMaxRounds,
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

function getManagedModelOptionsForCli(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string[] {
  return getManagedModelOptionsForCliFromStore(modelStore, cli, configId);
}

function getCliModelLobsterRoleFlags(
  cli: CliName,
  model: string,
  configId: string | null = getActiveConfigIdForCli(cli)
): { main: boolean; subtask: boolean } {
  return getCliModelLobsterRoleFlagsFromStore(modelStore, cli, model, configId);
}

function getLobsterModelOptionsForCli(
  cli: CliName,
  role: LobsterTaskRole,
  configId: string | null = getActiveConfigIdForCli(cli)
): string[] {
  return getLobsterModelOptionsForCliFromStore(modelStore, cli, role as LobsterTaskRoleForModelSelection, configId);
}

function getSelectedLobsterCliModel(
  cli: CliName,
  role: LobsterTaskRole,
  configId: string | null = getActiveConfigIdForCli(cli)
): string | null {
  return getSelectedLobsterCliModelFromStore(modelStore, cli, role as LobsterTaskRoleForModelSelection, configId);
}

function getModelOptionsForCli(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string[] {
  return getModelOptionsForCliFromStore(modelStore, cli, configId);
}

function selectCliModel(cli: CliName, model: string | null, configId: string | null = getActiveConfigIdForCli(cli)): void {
  modelStore = selectCliModelInStore(modelStore, cli, model, configId);
  writeModelStore(modelStore);
}

function selectCliLobsterModel(
  cli: CliName,
  role: LobsterTaskRole,
  model: string | null,
  configId: string | null = getActiveConfigIdForCli(cli)
): void {
  const nextStore = selectCliLobsterModelInStore(modelStore, cli, role as LobsterTaskRoleForModelSelection, model, configId);
  if (nextStore === modelStore) {
    return;
  }
  modelStore = nextStore;
  writeModelStore(modelStore);
}

function setCliModelLobsterRole(
  cli: CliName,
  model: string,
  role: LobsterTaskRole,
  enabled: boolean,
  configId: string | null = getActiveConfigIdForCli(cli)
): boolean {
  const result = setCliModelLobsterRoleInStore(modelStore, cli, model, role as LobsterTaskRoleForModelSelection, enabled, configId);
  if (!result.updated) {
    return false;
  }
  modelStore = result.store;
  writeModelStore(modelStore);
  return true;
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
      allSessions.push({
        id: record.id,
        label: record.label,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt,
        cli: item,
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

function buildLobsterGroupChatHistoryState(): LobsterGroupChatHistoryItem[] {
  return lobsterDebateChatPanelCoordinator.buildGroupChatHistoryState();
}

function resolveSessionFirstPrompt(cli: CliName, sessionId: string): string | null {
  const messages = loadSessionMessages(cli, sessionId);
  const first = messages.find((message) => message.role === "user" && message.content.trim());
  return first ? first.content : null;
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
  return sessionTabsController.buildConversationTabsState();
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

async function switchVisibleConversationTabForLobster(
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

function createLobsterSubtaskRunTarget(
  cli: CliName,
  options: { sessionId?: string | null } = {}
): PromptRunTarget {
  const sessionId = normalizeLobsterDebateSessionId(options.sessionId);
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
  void logInfo("lobster-subtask-session-created", { cli, tabId: tab.id });
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
  if (isTabRunActive(tabId) || isLobsterMainTabCloseLocked(tabId)) {
    return;
  }
  const closingTab = getConversationTabById(tabId);
  if (!closingTab) {
    return;
  }
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
  if (isTabRunActive(activeTab.id) || isLobsterMainTabCloseLocked(activeTab.id)) {
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
  adoptSessionId(cli, sessionId, activeTabIdForRun);
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

function upsertInteractiveMapping(
  cli: CliName,
  sessionId: string,
  mappedId: string,
  options: { freezePrevious?: string } = {}
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
