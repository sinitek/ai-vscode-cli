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
  getThinkingPromptPrefix,
  getThinkingPromptSuffix,
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
import { applyModelArg, readModelArg } from "./cli/modelArgs";
import {
  finalizeGeminiStreamJsonRemainder,
  getGeminiEventDisplay,
  parseGeminiStreamJsonChunk,
  type GeminiStreamJsonEvent,
} from "./cli/geminiStreamJson";
import {
  buildGeminiThinkingRuntimeProfile,
  GEMINI_SYSTEM_SETTINGS_ENV_KEY,
} from "./cli/geminiThinking";
import {
  GEMINI_NATIVE_COMPACT_PROMPT,
  isGeminiNativeCompactUnsupportedErrorText,
} from "./cli/geminiCompaction";
import { CliName, CLI_LIST, InteractiveMode, MacTaskShell, ThinkingMode, ThinkingWorkspaceFile } from "./cli/types";
import { getCliDisplayName, getCliInstallCommand } from "./cli/installer";
import { getLocaleSetting, t } from "./i18n";
import { CliBridgeViewProvider } from "./webview/viewProvider";
import {
  ChatMessage,
  EditorContextState,
  PanelMessage,
  PanelState,
  PromptContextOptions,
  ConversationTabSummary,
  PromptHistoryItem,
  SessionSummary,
  UploadFilePayload,
  RunStreamExportRecordPayload,
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
  buildHiddenRetryErrorTraceContent,
  buildHiddenRetryFailureMessage,
  buildHiddenRetryProgressInfo,
  getHiddenRetryDelayMs,
  HIDDEN_RETRY_DELAY_SEQUENCE_MS,
  isSameHiddenRetryErrorTraceContent,
  resetHiddenRetryCountOnRecoveredReply,
} from "./hiddenRetry";
import { hasAssistantFinalConclusionAfterMessage } from "./finalConclusion";
import { ConfigManagerPanel } from "./webview/configPanel";
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
  getMappedThreadId,
  readSessionMeta,
  upsertMapping,
  writeSessionMeta,
} from "./interactive/metaStore";
import { HISTORY_RETENTION_DAYS, isTimestampWithinHistoryRetention } from "./historyRetention";
import {
  findSupersedingSessionId,
  isLocalSessionId,
  mergeSessionMessages,
  mergeSessionRecords,
} from "./interactive/sessionHistoryRepair";
import {
  buildLobsterSubtaskExecutionPlan,
  describeLobsterExecutionPlan,
  normalizeLobsterWriteFiles,
  type LobsterSubtaskExecutionPlan,
} from "./lobsterParallel";
import { readToolSettings, type ToolSettingsLocale, type ToolSettingsState, writeToolSettings } from "./toolSettings";

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
let skipUserBlock = false;
let skipCodexBlock = false;
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
let activeWorkspaceKey: string;
let pendingWorkspaceKey: string | null = null;
let lastResolvedWorkspaceCwd: string | undefined;
let updateCheckOverride: { autoCheckUpdates?: boolean; autoUpdate?: boolean } | null = null;
let configHeartbeatTimer: NodeJS.Timeout | null = null;
let configHeartbeatRunning = false;
let configHeartbeatSnapshot: ConfigHeartbeatSnapshot | null = null;
let lastModelStoreReadError: string | null = null;
let lastModelStoreWriteError: string | null = null;
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
const lobsterTaskStoreFileCache = new Map<string, string>();
const SESSION_STORE_KEY = "sessionStore";
const SESSION_BUFFER_LIMIT = 4000;
const SESSION_LABEL_LIMIT = 16;
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
const LOBSTER_TASK_STORE_DIR = path.join(DATA_DIR, "lobster-tasks");
const LOBSTER_TASK_STORE_FILENAME = "lobster-tasks.json";
const LOBSTER_TASK_STORE_LEGACY_FILE = path.join(DATA_DIR, LOBSTER_TASK_STORE_FILENAME);
const LOBSTER_COMMUNICATION_DIR = path.join(DATA_DIR, "lobster-communications");
const LOBSTER_DEFAULT_MAX_ROUNDS = 20;
const LOBSTER_MIN_MAX_ROUNDS = 1;
const LOBSTER_MAX_MAX_ROUNDS = 100;
const LOBSTER_PARALLEL_SUBTASK_MAX = 6;
const LOBSTER_SUBTASK_RETRY_MAX_RETRIES = 5;
const LOBSTER_SUBTASK_RETRY_DELAY_MS = 60 * 1000;
const LOBSTER_SUBTASK_PROMPT_MIN_LENGTH = 80;
const LOBSTER_RESUME_PROMPT_MAX_LENGTH = 48;
const LOBSTER_RESUME_PROMPT_PATTERNS: RegExp[] = [
  /^继续(?:执行|进行|下去|一下|一下子|任务|主任务|这个任务|当前任务|上一轮|上轮|吧)?$/u,
  /^接着(?:执行|做|继续|下去|往下)?$/u,
  /^续上$/u,
  /^continue(?:\s+(?:please|task|run|lobster|main|main\s+task))?$/i,
  /^resume(?:\s+(?:please|task|run|lobster|main|main\s+task))?$/i,
  /^go\s*on$/i,
  /^carry\s*on$/i,
  /^keep\s*going$/i,
  /^proceed$/i,
];
const TEMP_ROOT_DIR = path.join(os.homedir(), ".sinitek_cli");
const TEMP_DIR = path.join(TEMP_ROOT_DIR, "temp");
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const TEMP_CLEAN_INTERVAL_MS = 15 * 60 * 1000;
const HISTORY_RETENTION_CLEAN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CODEX_IMAGE_MIN_VERSION = "0.2.0";
const CODEX_IMAGE_SUPPORT_CACHE_MS = 5 * 60 * 1000;
const CODEX_IMAGE_SUPPORT_TIMEOUT_MS = 5000;
const CODEX_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg",
  ".heic",
  ".heif",
  ".avif",
]);
const RUN_STREAM_EXPORT_FILENAME_PREFIX = "sinitek-run-stream";
const CONFIG_HEARTBEAT_INTERVAL_MS = 5000;
const COMMON_COMMAND_LABELS: Record<"compactContext", string> = {
  compactContext: t("common.compactContext"),
};
const CLI_INSTALL_TERMINAL_PREFIX = "CLI Install";
const UNNAMED_SESSION_LABELS = new Set([
  t("session.unnamed", undefined, "zh-CN"),
  t("session.unnamed", undefined, "en"),
]);

function buildSessionLabelFromPrompt(prompt: string | null | undefined): string | null {
  const trimmed = String(prompt ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, SESSION_LABEL_LIMIT);
}

function shouldUseFallbackSessionLabel(label: string | null | undefined): boolean {
  if (typeof label !== "string") {
    return true;
  }
  const trimmed = label.trim();
  return !trimmed || UNNAMED_SESSION_LABELS.has(trimmed);
}
const PATH_PICKER_EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}";
const PATH_PICKER_MAX_RESULTS = 2000;
const TEMP_FILE_RANDOM_LENGTH = 8;
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
const HIDDEN_RETRY_MAX_RETRIES = HIDDEN_RETRY_DELAY_SEQUENCE_MS.length;

type SessionRecord = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  firstPrompt?: string;
};

type SessionStore = Record<CliName, { currentId: string | null; sessions: SessionRecord[] }>;

type PromptHistoryStore = {
  items: PromptHistoryItem[];
};

type TaskRunStatus = "end" | "error" | "stopped";
type RunActivity = "contextCompaction";
type LobsterTaskRole = "main" | "subtask";
type LobsterTaskStatus = "running" | "completed" | "needs-review" | "error" | "stopped";

type TaskRunDraft = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  prompt: string;
  startedAt: number;
  taskRole?: LobsterTaskRole;
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
};

type TaskRunRecord = TaskRunDraft & {
  endedAt: number;
  durationMs: number;
  status: TaskRunStatus;
};

type TaskStore = {
  runs: TaskRunRecord[];
};

type LobsterSubtaskRecord = {
  id: string;
  title: string;
  prompt?: string;
  conflictGroup?: string;
  writeFiles?: string[];
  status: "pending" | "running" | "completed" | "skipped" | "blocked";
  summary?: string;
  communicationFile?: string;
  updatedAt?: number;
};

type LobsterAcceptanceCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

type LobsterAcceptance = {
  passed: boolean;
  summary?: string;
  checks: LobsterAcceptanceCheck[];
};

type LobsterRoundSummary = {
  round: number;
  subtaskId?: string;
  title: string;
  summary: string;
};

type LobsterSubtaskDecision = {
  id?: string;
  title: string;
  prompt: string;
  conflictGroup?: string;
  writeFiles?: string[];
};

type LobsterMainDecision = {
  status: "completed" | "continue" | "blocked";
  finalSummary?: string;
  roundSummaries?: LobsterRoundSummary[];
  requirementCoverage?: LobsterAcceptanceCheck[];
  acceptance?: LobsterAcceptance;
  subtask?: LobsterSubtaskDecision;
  subtasks?: LobsterSubtaskDecision[];
  parallelReason?: string;
  estimatedRemainingRounds?: number;
};

type LobsterRoundRecord = {
  round: number;
  role: LobsterTaskRole;
  subtaskId?: string;
  status: TaskRunStatus;
  startedAt: number;
  endedAt: number;
  summary?: string;
};

type LobsterTaskRecord = {
  id: string;
  cli: CliName;
  workspaceKey: string;
  taskStoreFile: string;
  rootPrompt: string;
  status: LobsterTaskStatus;
  createdAt: number;
  updatedAt: number;
  maxRounds: number;
  currentRound: number;
  communicationDir: string;
  mainCommunicationFile: string;
  sessionId?: string | null;
  activeSubtaskId?: string | null;
  activeSubtaskIds?: string[];
  subTasks: LobsterSubtaskRecord[];
  rounds: LobsterRoundRecord[];
  finalSummary?: string;
  estimatedRemainingRounds?: number;
  completionRoundSummaries: LobsterRoundSummary[];
  completionRequirementCoverage: LobsterAcceptanceCheck[];
};

type LobsterTaskStore = {
  tasks: LobsterTaskRecord[];
};

type ConversationTabRecord = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  sessionIdByCli: Partial<Record<CliName, string>>;
  createdAt: number;
};

type ConversationTabsState = {
  activeTabId: string | null;
  tabs: ConversationTabRecord[];
};

type PendingSessionDraft = {
  label: string | null;
  firstPrompt: string | null;
  messages: ChatMessage[];
};

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

type WorkspaceSettings = {
  currentCli?: CliName;
  thinkingMode?: ThinkingMode;
  interactiveModeByCli?: Partial<Record<CliName, InteractiveMode>>;
  autoCompactContextAfterRun?: boolean;
  autoCompactContextBeforeRun?: boolean;
  codexMultiAgentEnabled?: boolean;
  lobsterMaxRounds?: number;
  lobsterAutoCloseSubtaskTabs?: boolean;
  activeConfigIdByCli?: Partial<Record<CliName, string>>;
  conversationTabs?: ConversationTabsState;
};

type CliModelStore = {
  selectedByConfigId: Record<string, string>;
  optionsByConfigId: Record<string, string[]>;
  thinkingByCliAndModel: Partial<Record<CliName, Record<string, ThinkingMode>>>;
  selectedLobsterByConfigId: Record<string, Partial<Record<LobsterTaskRole, string>>>;
  lobsterRolesByConfigId: Record<string, Record<string, { main: boolean; subtask: boolean }>>;
};

type ConfigHeartbeatSnapshot = {
  cli: CliName;
  activeConfigId: string | null;
  configIds: string[];
  modelSelected: string | null;
  managedModelOptions: string[];
  lobsterMainModelSelected: string | null;
  lobsterSubtaskModelSelected: string | null;
  lobsterRoleSignature: string;
};

type InspectModelManagerMessage = Extract<PanelMessage, { type: "inspectModelManager" }>;

type CliInstallStatus = {
  command: string;
  installed: boolean;
  checkedAt: number;
};

type CodexImageSupportStatus = {
  command: string;
  checkedAt: number;
  version: string | null;
  versionLabel: string | null;
  supportsImageFlag: boolean;
  supported: boolean;
  reason: "supported" | "version-too-low" | "flag-missing" | "probe-failed";
  probeError?: string;
};

type RunStreamExportRecord = {
  index: number;
  content: string;
  source: "stdout" | "stderr" | "event";
  createdAt: number;
};

type RunStreamExportResult = {
  path: string;
  fileName: string;
};

const cliInstallStatuses: Record<CliName, CliInstallStatus | null> = {
  codex: null,
  claude: null,
  gemini: null,
};
let codexImageSupportStatus: CodexImageSupportStatus | null = null;
const codexImageSupportWarningKeys = new Set<string>();
let historyArtifactRetentionCleanupPromise: Promise<void> | null = null;


export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  extensionUri = context.extensionUri;
  interactiveRunnerManager = new InteractiveRunnerManager();
  void maybeDisableMarketplaceUpdateCheckInDev(context);
  activeWorkspaceKey = buildWorkspaceKey(resolveWorkspaceCwd());
  migrateLegacyToolSettingsFromVsCodeConfig();
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

  context.subscriptions.push(
    vscode.commands.registerCommand("sinitek-cli-tools.selectCli", async () => {
      const selection = await vscode.window.showQuickPick(CLI_LIST, {
        placeHolder: t("command.selectCliPlaceholder"),
      });

      if (!selection || !isCliName(selection)) {
        return;
      }

      await setCurrentCli(selection);
      vscode.window.showInformationMessage(
        t("command.currentCliInfo", { cli: currentCli })
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sinitek-cli-tools.runCli", async () => {
      await runCli(currentCli);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sinitek-cli-tools.runCliThinkingOn",
      async () => {
        await runCli(currentCli, { thinkingMode: "on" });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sinitek-cli-tools.runCliThinkingOff",
      async () => {
        await runCli(currentCli, { thinkingMode: "off" });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sinitek-cli-tools.openPanel", async () => {
      await revealPanelView();
      await postPanelState();
    })
  );

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

function collectDirectoryPaths(filePath: string, dirSet: Set<string>): void {
  const normalized = normalizeWorkspacePath(filePath);
  const parts = normalized.split("/");
  if (parts.length <= 1) {
    return;
  }
  for (let i = 1; i < parts.length; i += 1) {
    dirSet.add(parts.slice(0, i).join("/"));
  }
}

async function buildWorkspacePathItems(): Promise<Array<vscode.QuickPickItem & { value: string }>> {
  const files = await vscode.workspace.findFiles("**/*", PATH_PICKER_EXCLUDE, PATH_PICKER_MAX_RESULTS);
  const dirSet = new Set<string>();
  const fileItems = files
    .map((uri) => normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false)))
    .filter((relativePath) => relativePath)
    .map((relativePath) => {
      collectDirectoryPaths(relativePath, dirSet);
      return {
        label: relativePath,
        description: t("pathPicker.file"),
        value: relativePath,
      };
    });
  const dirItems = Array.from(dirSet)
    .sort((a, b) => a.localeCompare(b))
    .map((dirPath) => ({
      label: dirPath + "/",
      description: t("pathPicker.folder"),
      value: dirPath,
    }));
  const sortedFileItems = fileItems.sort((a, b) => a.label.localeCompare(b.label));
  return [...dirItems, ...sortedFileItems];
}

async function handlePanelMessage(message: PanelMessage): Promise<void> {
  ensureWorkspaceSessionStore();
  void logDebug("panel-message", message);
  if (message.type === "requestState") {
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, getCurrentSessionId(currentCli));
    return;
  }

  if (message.type === "webviewError") {
    void logError("webview-runtime-error", {
      message: message.message,
      source: message.source ?? null,
      line: message.lineno ?? null,
      column: message.colno ?? null,
      reason: message.reason ?? null,
      stack: message.stack ?? null,
    });
    const detail = [
      message.message,
      message.reason ? `reason: ${message.reason}` : "",
      message.source ? `source: ${message.source}` : "",
      typeof message.lineno === "number" ? `line: ${message.lineno}` : "",
      typeof message.colno === "number" ? `column: ${message.colno}` : "",
      message.stack ?? "",
    ].filter(Boolean).join("\n");
    void showErrorWithActions(t("panel.runtimeError"), detail || message.message);
    return;
  }

  if (message.type === "webviewDebug") {
    void logDebug("webview-debug", {
      event: message.event,
      payload: message.payload ?? null,
    });
    return;
  }

  if (message.type === "inspectModelManager") {
    await inspectModelManagerState(message);
    return;
  }

  if (message.type === "sessionLoadError") {
    void logError("webview-session-load-error", {
      title: message.title,
      detail: message.detail,
      tabId: message.tabId ?? null,
      sessionId: message.sessionId ?? null,
      cli: message.cli ?? null,
    });
    void showErrorWithActions(message.title, message.detail);
    return;
  }

  if (message.type === "selectCli" && message.cli) {
    const previousBinding = getActiveConversationTabBinding();
    await setCurrentCli(message.cli);
    disposeInteractiveRunnerIfUnused(previousBinding);
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, activeSessionId);
    return;
  }

  if (message.type === "selectCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId ? message.configId : getActiveConfigIdForCli(message.cli);
    selectCliModel(message.cli, message.model ?? null, configId);
    await postPanelState();
    return;
  }

  if (message.type === "selectCliLobsterModel" && message.cli && isLobsterTaskRoleValue(message.role)) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    selectCliLobsterModel(message.cli, message.role, message.model ?? null, configId);
    await postPanelState();
    return;
  }

  if (message.type === "setCliModelLobsterRole" && message.cli && isLobsterTaskRoleValue(message.role)) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    const updated = setCliModelLobsterRole(
      message.cli,
      message.model,
      message.role,
      message.enabled,
      configId
    );
    if (!updated) {
      return;
    }
    await postPanelState();
    return;
  }

  if (message.type === "addCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId ? message.configId : getActiveConfigIdForCli(message.cli);
    const addedModel = addCliModel(message.cli, message.model, configId);
    if (!addedModel) {
      return;
    }
    await postPanelState();
    return;
  }

  if (message.type === "renameCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    const renamedModel = renameCliModel(message.cli, message.previousModel, message.nextModel, configId);
    if (!renamedModel) {
      return;
    }
    await postPanelState();
    return;
  }

  if (message.type === "deleteCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    deleteCliModel(message.cli, message.model, configId);
    await postPanelState();
    return;
  }

  if (message.type === "moveCliModel" && message.cli) {
    const configId = typeof message.configId === "string" && message.configId
      ? message.configId
      : getActiveConfigIdForCli(message.cli);
    const movedModel = moveCliModel(message.cli, message.model, message.direction, configId);
    if (!movedModel) {
      return;
    }
    await postPanelState();
    return;
  }

  if (message.type === "selectSession") {
    const previousBinding = getActiveConversationTabBinding(message.cli);
    await setCurrentCli(message.cli, { syncActiveTab: false });
    const selectedSessionId = message.sessionId
      ? repairSupersededLocalSession(message.cli, message.sessionId)
      : null;
    if (selectedSessionId) {
      const existingTabId = findConversationTabIdBySession(message.cli, selectedSessionId);
      if (existingTabId) {
        const switched = setActiveConversationTab(existingTabId);
        if (switched && currentCli !== switched.cli) {
          currentCli = switched.cli;
          updateStatusBar();
          workspaceSettings.currentCli = currentCli;
          saveWorkspaceSettings(workspaceSettings);
        }
      } else {
        addConversationTab(message.cli, selectedSessionId);
      }
    } else {
      startNewSession(message.cli);
    }
    disposeInteractiveRunnerIfUnused(previousBinding);
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, activeSessionId);
    return;
  }

  if (message.type === "selectConversationTab") {
    if (!getConversationTabById(message.tabId)) {
      return;
    }
    const previousCli = currentCli;
    if (!hasAnyTaskRunning()) {
      interactiveRunnerManager?.disposeAll();
    }
    const switched = setActiveConversationTab(message.tabId);
    if (!switched) {
      return;
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
    sendSessionMessagesToPanel(switched.cli, switched.sessionId, message.tabId);
    return;
  }

  if (message.type === "closeConversationTab") {
    await closeConversationTabAndRefreshPanel(message.tabId);
    return;
  }

  if (message.type === "deleteSession") {
    const confirmLabel = t("common.delete");
    const confirmed = await vscode.window.showWarningMessage(
      t("session.confirmDelete"),
      { modal: true },
      confirmLabel
    );
    if (confirmed !== confirmLabel) {
      return;
    }
    interactiveRunnerManager?.disposeIfMatches(message.cli, message.sessionId);
    deleteSession(message.cli, message.sessionId);
    detachConversationTabsFromSession(message.cli, message.sessionId);
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, activeSessionId);
    return;
  }

  if (message.type === "clearAllSessions") {
    const confirmLabel = t("common.clear");
    const confirmed = await vscode.window.showWarningMessage(
      t("session.confirmClearAll"),
      { modal: true },
      confirmLabel
    );
    if (confirmed !== confirmLabel) {
      return;
    }
    interactiveRunnerManager?.disposeAll();
    clearAllSessions();
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, activeSessionId);
    return;
  }

  if (message.type === "clearPromptHistory") {
    const confirmLabel = t("common.clear");
    const confirmed = await vscode.window.showWarningMessage(
      t("session.confirmClearPromptHistory"),
      { modal: true },
      confirmLabel
    );
    if (confirmed !== confirmLabel) {
      return;
    }
    clearPromptHistory();
    await postPanelState();
    return;
  }

  if (message.type === "newSession") {
    const sessionId = addConversationTab(currentCli, null);
    setWorkspaceInteractiveModeForCli(currentCli, "coding");
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, sessionId);
    return;
  }

  if (message.type === "resetConversationTabSession") {
    const activeTab = getActiveConversationTab();
    if (activeTab && isTabRunActive(activeTab.id)) {
      return;
    }
    if (!activeTab) {
      return;
    }
    const previousSessionId = activeTab.sessionId;
    const targetCli = activeTab.cli;
    startNewSession(targetCli);
    disposeInteractiveRunnerIfUnused({ cli: targetCli, sessionId: previousSessionId });
    const activeSessionId = syncCurrentSessionWithActiveTab();
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, activeSessionId);
    return;
  }

  if (message.type === "openConfig") {
    configManagerPanel?.show();
    configManagerPanel?.syncActiveConfig();
    return;
  }

  if (message.type === "applyConfig") {
    try {
      await applyConfigById(message.cli, message.configId);
      await postPanelState();
      configManagerPanel?.syncActiveConfig();
    } catch (error) {
      const detail = buildErrorDetail(error);
      viewProvider?.postMessage({
        type: "configApplyError",
        error: detail,
        cli: message.cli,
        configId: message.configId,
      });
      void showErrorWithActions(
        t("config.applyFailedTitle"),
        error,
        { detailTitle: t("config.applyFailedTitle") }
      );
    }
    return;
  }

  if (message.type === "resolveDropPaths") {
    const uris = Array.isArray(message.uris) ? message.uris : [];
    if (!uris.length) {
      return;
    }
    try {
      const paths = uris
        .map((uri) => vscode.Uri.parse(uri))
        .map((uri) => vscode.workspace.asRelativePath(uri, false));
      viewProvider?.postMessage({
        type: "dropPathsResult",
        paths,
      });
    } catch (error) {
      viewProvider?.postMessage({
        type: "dropPathsResult",
        paths: [],
        error: t("pathPicker.dropParseError"),
      });
      logError("resolve drop paths failed", error);
    }
    return;
  }

  if (message.type === "pickWorkspacePath") {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      viewProvider?.postMessage({
        type: "pickWorkspacePathResult",
        paths: [],
        error: t("pathPicker.noWorkspace"),
        canceled: true,
      });
      return;
    }
    try {
      const items = await buildWorkspacePathItems();
      const selections = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        matchOnDescription: true,
        ignoreFocusOut: true,
        placeHolder: t("pathPicker.placeholder"),
      });
      if (!selections || selections.length === 0) {
        viewProvider?.postMessage({
          type: "pickWorkspacePathResult",
          paths: [],
          canceled: true,
        });
        return;
      }
      viewProvider?.postMessage({
        type: "pickWorkspacePathResult",
        paths: selections.map((item) => item.value),
      });
    } catch (error) {
      viewProvider?.postMessage({
        type: "pickWorkspacePathResult",
        paths: [],
        error: t("pathPicker.readError"),
        canceled: true,
      });
      logError("pick workspace path failed", error);
    }
    return;
  }

  if (message.type === "uploadFiles") {
    const result = await saveUploadedFiles(message.files);
    viewProvider?.postMessage({
      type: "uploadResult",
      paths: result.paths,
      error: result.error,
    });
    return;
  }

  if (message.type === "exportRunStream") {
    const targetTabId = typeof message.tabId === "string" && message.tabId
      ? message.tabId
      : getActiveConversationTabId();
    const targetCli = message.cli && isCliName(message.cli) ? message.cli : currentCli;
    try {
      const exportResult = await exportRunStreamRecordsToTxt(message.records, {
        cli: targetCli,
        tabId: targetTabId,
      });
      viewProvider?.postMessage({
        type: "runStreamExportResult",
        tabId: targetTabId,
        path: exportResult.path,
        fileName: exportResult.fileName,
      });
    } catch (error) {
      const messageText = error instanceof Error && error.message
        ? error.message
        : t("runStream.exportFailed");
      viewProvider?.postMessage({
        type: "runStreamExportResult",
        tabId: targetTabId,
        error: messageText,
      });
      logError("export run stream failed", error);
    }
    return;
  }

  if (message.type === "loadRules") {
    try {
      const content = await readCliRules(message.cli, message.scope);
      viewProvider?.postMessage({
        type: "rulesContent",
        cli: message.cli,
        content,
        scope: message.scope,
      });
    } catch (error) {
      const noWorkspace = error instanceof Error && error.message === "no-workspace";
      viewProvider?.postMessage({
        type: "rulesContent",
        cli: message.cli,
        scope: message.scope,
        error: noWorkspace ? t("rules.loadNoWorkspace") : t("rules.loadFailed"),
      });
      logError("load rules failed", error);
    }
    return;
  }

  if (message.type === "saveRules") {
    const targets = normalizeRuleTargets(message.targets);
    if (!targets.length) {
      viewProvider?.postMessage({
        type: "rulesSaved",
        error: t("rules.invalidCli"),
      });
      return;
    }
    try {
      await Promise.all(
        targets.map((cli) => writeCliRules(cli, message.scope, message.content ?? ""))
      );
      viewProvider?.postMessage({
        type: "rulesSaved",
        targets,
        scope: message.scope,
      });
    } catch (error) {
      const noWorkspace = error instanceof Error && error.message === "no-workspace";
      viewProvider?.postMessage({
        type: "rulesSaved",
        error: noWorkspace ? t("rules.saveNoWorkspace") : t("rules.saveFailed"),
      });
      logError("save rules failed", error);
    }
    return;
  }

  if (message.type === "updateSetting" && message.key) {
    if (message.key === "thinkingMode") {
      if (isThinkingMode(message.value)) {
        const normalizedThinkingMode = normalizeThinkingModeForCli(currentCli, message.value);
        workspaceSettings.thinkingMode = normalizedThinkingMode;
        saveWorkspaceSettings(workspaceSettings);
        setCliModelThinkingMode(currentCli, getSelectedCliModel(currentCli), normalizedThinkingMode);
      }
      await postPanelState();
      return;
    }
    if (message.key.startsWith("interactiveMode.")) {
      const cliValue = message.key.slice("interactiveMode.".length);
      if (isCliName(cliValue) && isInteractiveMode(message.value)) {
        setWorkspaceInteractiveModeForCli(cliValue, message.value);
      }
      await postPanelState();
      return;
    }
    if (message.key.startsWith("selectedModel.")) {
      const cliValue = message.key.slice("selectedModel.".length);
      if (isCliName(cliValue)) {
        const modelValue = typeof message.value === "string" ? message.value : null;
        selectCliModel(cliValue, modelValue, getActiveConfigIdForCli(cliValue));
        modelStore = loadModelStore();
      }
      await postPanelState();
      return;
    }
    if (message.key === "codexMultiAgentEnabled") {
      workspaceSettings.codexMultiAgentEnabled = Boolean(message.value);
      saveWorkspaceSettings(workspaceSettings);
      await postPanelState();
      return;
    }
    if (message.key === "autoCompactContextAfterRun" || message.key === "autoCompactContextBeforeRun") {
      workspaceSettings.autoCompactContextAfterRun = Boolean(message.value);
      delete workspaceSettings.autoCompactContextBeforeRun;
      saveWorkspaceSettings(workspaceSettings);
      await postPanelState();
      return;
    }
    if (message.key === "lobsterMaxRounds") {
      workspaceSettings.lobsterMaxRounds = normalizeLobsterMaxRounds(message.value);
      saveWorkspaceSettings(workspaceSettings);
      await postPanelState();
      return;
    }
    if (message.key === "lobsterAutoCloseSubtaskTabs") {
      workspaceSettings.lobsterAutoCloseSubtaskTabs = Boolean(message.value);
      saveWorkspaceSettings(workspaceSettings);
      await postPanelState();
      return;
    }
    if (message.key === "debug") {
      updateStoredToolSettings({ debug: Boolean(message.value) });
      setDebugLogging(getDebugLogging());
      await postPanelState();
      return;
    }
    if (message.key === "autoAddEditorContextTags") {
      updateStoredToolSettings({ autoAddEditorContextTags: Boolean(message.value) });
      await postPanelState();
      return;
    }
    if (message.key === "locale") {
      const resolved = normalizeToolSettingsLocale(message.value) ?? "auto";
      updateStoredToolSettings({ locale: resolved });
      updateStatusBar();
      viewProvider?.reload();
      configManagerPanel?.reload();
      return;
    }
    if (message.key === "macTaskShell") {
      if (process.platform === "darwin" && isMacTaskShell(message.value)) {
        updateStoredToolSettings({ macTaskShell: message.value });
      }
      await postPanelState();
      return;
    }
  }

  if (message.type === "runCommonCommand" && message.command === "compactContext") {
    const label = COMMON_COMMAND_LABELS[message.command] ?? message.command;
    appendUserMessageForCli(
      currentCli,
      getCurrentSessionId(currentCli),
      t("common.commonCommandPrefix", { label }),
      { merge: false }
    );
    await runContextCompactionCommand();
    return;
  }

  if (message.type === "sendPrompt" && typeof message.prompt === "string") {
    const trimmed = message.prompt.trim();
    if (!trimmed) {
      return;
    }

    const requestedTabId = typeof message.tabId === "string" && message.tabId
      ? message.tabId
      : null;
    const preserveActiveTab = Boolean(message.preserveActiveTab && requestedTabId);
    const requestedTab = requestedTabId ? getConversationTabById(requestedTabId) : null;

    if (requestedTabId && requestedTab && !preserveActiveTab) {
      const switched = setActiveConversationTab(requestedTabId);
      if (switched && currentCli !== switched.cli) {
        currentCli = switched.cli;
        updateStatusBar();
        workspaceSettings.currentCli = currentCli;
        saveWorkspaceSettings(workspaceSettings);
      }
    }

    const targetTab = requestedTab ?? getActiveConversationTab();
    const targetCli = targetTab?.cli
      ?? (isCliName(message.cli ?? "") ? message.cli : currentCli)
      ?? currentCli;

    if (!preserveActiveTab && currentCli !== targetCli) {
      currentCli = targetCli;
      updateStatusBar();
      workspaceSettings.currentCli = currentCli;
      saveWorkspaceSettings(workspaceSettings);
    }

    const promptTargetTabId = targetTab?.id ?? requestedTabId ?? getActiveConversationTabId();
    const lobsterSubtaskContext = resolveLobsterSubtaskConversationContext(targetCli, promptTargetTabId);
    const isLobsterSubtaskContinuation = Boolean(lobsterSubtaskContext);
    const requestedInteractiveMode = isInteractiveMode(message.interactiveMode) ? message.interactiveMode : undefined;
    const effectiveInteractiveMode = isLobsterSubtaskContinuation && requestedInteractiveMode === "lobster"
      ? "coding"
      : requestedInteractiveMode;

    if (isInteractiveMode(effectiveInteractiveMode)) {
      setWorkspaceInteractiveModeForCli(targetCli, effectiveInteractiveMode);
    }
    const contextBuild = buildPromptWithAutoContext(trimmed, message.contextOptions);
    const imagePaths = targetCli === "codex"
      ? await resolveCodexImagePathsForPrompt(trimmed)
      : [];
    const activeConfigId = getActiveConfigIdForCli(targetCli);
    const lobsterMainModel = typeof message.lobsterMainModel === "string" && message.lobsterMainModel.trim()
      ? message.lobsterMainModel.trim()
      : (getSelectedLobsterCliModel(targetCli, "main", activeConfigId) ?? undefined);
    const lobsterSubtaskModel = typeof message.lobsterSubtaskModel === "string" && message.lobsterSubtaskModel.trim()
      ? message.lobsterSubtaskModel.trim()
      : (getSelectedLobsterCliModel(targetCli, "subtask", activeConfigId) ?? undefined);
    const promptInput: PromptRunInput = {
      displayPrompt: trimmed,
      modelPrompt: contextBuild.modelPrompt,
      contextTags: contextBuild.contextTags,
      model: typeof message.model === "string" && message.model ? message.model : undefined,
      lobsterMainModel,
      lobsterSubtaskModel,
      imagePaths: imagePaths.length ? imagePaths : undefined,
    };
    if (lobsterSubtaskContext) {
      promptInput.taskRole = "subtask";
      promptInput.lobsterTaskId = lobsterSubtaskContext.taskId;
      promptInput.lobsterRound = lobsterSubtaskContext.round;
      promptInput.lobsterSubtaskId = lobsterSubtaskContext.subtaskId;
    }
    const shouldRunLobster = effectiveInteractiveMode === "lobster";
    const lobsterResumeTask = shouldRunLobster
      ? resolveLobsterResumeTaskFromPrompt(trimmed, promptTargetTabId)
      : null;
    const lobsterResumeRequested = shouldRunLobster && isLobsterResumePrompt(trimmed);
    const previousSubtaskRunEndedAt = lobsterSubtaskContext
      ? (getLatestLobsterRoundRunRecord(
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
    recordPromptHistory(trimmed, targetCli);
    await postPanelState();
    const promptRunTarget = resolvePromptRunTarget(promptTargetTabId);
    const preparedPromptInput = promptRunTarget
      ? preloadUserMessageForPrompt(promptInput, promptRunTarget)
      : promptInput;
    if (shouldRunLobster) {
      await runLobsterPrompt(preparedPromptInput, {
        targetTabId: promptTargetTabId,
        resumeTaskId: lobsterResumeTask?.id ?? null,
        resumeRequested: lobsterResumeRequested,
      });
    } else {
      await runPrompt(preparedPromptInput, { targetTabId: promptTargetTabId });
      if (lobsterSubtaskContext && promptTargetTabId) {
        await maybeWakeLobsterMainAfterSubtaskContinuation(lobsterSubtaskContext, {
          tabId: promptTargetTabId,
          previousRunEndedAt: previousSubtaskRunEndedAt,
          model: preparedPromptInput.model,
          lobsterMainModel: preparedPromptInput.lobsterMainModel,
          lobsterSubtaskModel: preparedPromptInput.lobsterSubtaskModel,
        });
      }
    }
    return;
  }

  if (message.type === "stopRun") {
    stopRunForTab(getActiveConversationTabId());
  }
}

async function buildPanelState(): Promise<PanelState> {
  ensureWorkspaceSessionStore();
  const config = vscode.workspace.getConfiguration("sinitek-cli-tools");
  const configState = await loadConfigState(currentCli);
  const modelConfigId = resolveModelConfigIdForCli(currentCli, configState);

  const activeConfigIdByCli: Partial<Record<CliName, string | null>> = {
    [currentCli]: modelConfigId,
  };
  const selectedModel = getSelectedCliModel(currentCli, modelConfigId);

  return {
    currentCli,
    autoOpenPanel: config.get<boolean>("autoOpenPanel", false),
    rememberSelectedCli: config.get<boolean>("rememberSelectedCli", true),
    autoAddEditorContextTags: getAutoAddEditorContextTags(),
    autoCompactContextAfterRun: getWorkspaceAutoCompactContextAfterRun(),
    codexMultiAgentEnabled: getWorkspaceCodexMultiAgentEnabled(),
    lobsterMaxRounds: getWorkspaceLobsterMaxRounds(),
    lobsterAutoCloseSubtaskTabs: getWorkspaceLobsterAutoCloseSubtaskTabs(),
    debug: getDebugLogging(),
    locale: getLocaleSetting(),
    isMac: process.platform === "darwin",
    macTaskShell: getMacTaskShell(),
    thinkingMode: getEffectiveThinkingMode(currentCli, selectedModel),
    interactiveMode: getWorkspaceInteractiveMode(currentCli),
    interactive: {
      supported: isInteractiveSupported(currentCli),
      enabled: isInteractiveSupported(currentCli),
    },
    rulePaths: {
      global: CLI_RULE_PATHS_GLOBAL,
      project: getProjectRulePaths(),
    },
    sessionState: buildSessionState(currentCli),
    conversationTabs: buildConversationTabsState(),
    promptHistory: buildPromptHistoryState(),
    configState,
    modelState: buildModelState(activeConfigIdByCli),
    editorContext: buildEditorContextState(),
  };
}

async function buildPanelStateWithConfigState(
  configState: PanelState["configState"]
): Promise<PanelState> {
  ensureWorkspaceSessionStore();
  const config = vscode.workspace.getConfiguration("sinitek-cli-tools");
  const modelConfigId = resolveModelConfigIdForCli(currentCli, configState);

  const activeConfigIdByCli: Partial<Record<CliName, string | null>> = {
    [currentCli]: modelConfigId,
  };
  const selectedModel = getSelectedCliModel(currentCli, modelConfigId);

  return {
    currentCli,
    autoOpenPanel: config.get<boolean>("autoOpenPanel", false),
    rememberSelectedCli: config.get<boolean>("rememberSelectedCli", true),
    autoAddEditorContextTags: getAutoAddEditorContextTags(),
    autoCompactContextAfterRun: getWorkspaceAutoCompactContextAfterRun(),
    codexMultiAgentEnabled: getWorkspaceCodexMultiAgentEnabled(),
    lobsterMaxRounds: getWorkspaceLobsterMaxRounds(),
    lobsterAutoCloseSubtaskTabs: getWorkspaceLobsterAutoCloseSubtaskTabs(),
    debug: getDebugLogging(),
    locale: getLocaleSetting(),
    isMac: process.platform === "darwin",
    macTaskShell: getMacTaskShell(),
    thinkingMode: getEffectiveThinkingMode(currentCli, selectedModel),
    interactiveMode: getWorkspaceInteractiveMode(currentCli),
    interactive: {
      supported: isInteractiveSupported(currentCli),
      enabled: isInteractiveSupported(currentCli),
    },
    rulePaths: {
      global: CLI_RULE_PATHS_GLOBAL,
      project: getProjectRulePaths(),
    },
    sessionState: buildSessionState(currentCli),
    conversationTabs: buildConversationTabsState(),
    promptHistory: buildPromptHistoryState(),
    configState,
    modelState: buildModelState(activeConfigIdByCli),
    editorContext: buildEditorContextState(),
  };
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

function areStringListsEqual(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let i = 0; i < previous.length; i += 1) {
    if (previous[i] !== next[i]) {
      return false;
    }
  }
  return true;
}

function readNormalizedModelStoreFromDisk(): CliModelStore {
  const diskStore = readModelStore();
  if (lastModelStoreReadError) {
    void logError("model-store-read-fallback-memory", {
      path: MODEL_STORE_FILE,
      error: lastModelStoreReadError,
    });
    return ensureCliModelStore(modelStore);
  }
  return ensureCliModelStore(diskStore);
}

function getModelOptionsForConfigFromStore(store: CliModelStore, configId: string | null): string[] {
  if (!configId) {
    return [];
  }
  const normalizedStore = ensureCliModelStore(store);
  const storedOptions = normalizedStore.optionsByConfigId[configId] ?? [];
  const selectedModel = normalizeCliModelName(normalizedStore.selectedByConfigId[configId]);
  return mergeUniqueModelNames(
    storedOptions,
    selectedModel ? [selectedModel] : []
  );
}

function getManagedModelOptionsForConfigFromStore(store: CliModelStore, configId: string | null): string[] {
  if (!configId) {
    return [];
  }
  const normalizedStore = ensureCliModelStore(store);
  return mergeUniqueModelNames(normalizedStore.optionsByConfigId[configId] ?? []);
}

function summarizeModelStoreByConfigId(store: CliModelStore): Record<string, number> {
  const normalizedStore = ensureCliModelStore(store);
  const configIds = new Set<string>([
    ...Object.keys(normalizedStore.optionsByConfigId),
    ...Object.keys(normalizedStore.selectedByConfigId),
  ]);
  const summary: Record<string, number> = {};
  Array.from(configIds)
    .sort((left, right) => left.localeCompare(right))
    .forEach((configId) => {
      summary[configId] = getModelOptionsForConfigFromStore(normalizedStore, configId).length;
    });
  return summary;
}

function countStoreModels(summary: Record<string, number>): number {
  return Object.values(summary).reduce((total, count) => total + count, 0);
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function buildModelManagerDiagnosticsDetail(payload: {
  cli: CliName;
  configId: string | null;
  webviewConfigId: string | null;
  activeConfigId: string | null;
  workspacePreferredConfigId: string | null;
  visibleModelCount: number;
  visibleManagedModelCount: number;
  selectedModel: string | null;
  memoryModels: string[];
  memoryManagedModels: string[];
  diskModels: string[];
  diskManagedModels: string[];
  diskModelCountsByConfigId: Record<string, number>;
  memoryModelCountsByConfigId: Record<string, number>;
  configIds: string[];
  modelStoreReadError: string | null;
  modelStoreWriteError: string | null;
  configStateLoadError: string | null;
  reasons: string[];
}): string {
  return [
    t("model.diagnostics.message"),
    "",
    `reasons: ${payload.reasons.join("; ")}`,
    `cli: ${payload.cli}`,
    `storagePath: ${MODEL_STORE_FILE}`,
    `logsDir: ${path.join(DATA_DIR, "logs")}`,
    `workspaceKey: ${activeWorkspaceKey}`,
    `configIdUsedForModels: ${payload.configId ?? "(none)"}`,
    `webviewConfigId: ${payload.webviewConfigId ?? "(none)"}`,
    `activeConfigId: ${payload.activeConfigId ?? "(none)"}`,
    `workspacePreferredConfigId: ${payload.workspacePreferredConfigId ?? "(none)"}`,
    `knownConfigIds: ${JSON.stringify(payload.configIds)}`,
    `selectedModel: ${payload.selectedModel ?? "(none)"}`,
    `visibleModelCount: ${payload.visibleModelCount}`,
    `visibleManagedModelCount: ${payload.visibleManagedModelCount}`,
    `memoryModelsForConfig: ${JSON.stringify(payload.memoryModels)}`,
    `memoryManagedModelsForConfig: ${JSON.stringify(payload.memoryManagedModels)}`,
    `diskModelsForConfig: ${JSON.stringify(payload.diskModels)}`,
    `diskManagedModelsForConfig: ${JSON.stringify(payload.diskManagedModels)}`,
    `memoryModelCountsByConfigId: ${JSON.stringify(payload.memoryModelCountsByConfigId)}`,
    `diskModelCountsByConfigId: ${JSON.stringify(payload.diskModelCountsByConfigId)}`,
    `lastModelStoreReadError: ${payload.modelStoreReadError ?? "(none)"}`,
    `lastModelStoreWriteError: ${payload.modelStoreWriteError ?? "(none)"}`,
    `lastConfigStateLoadError: ${payload.configStateLoadError ?? "(none)"}`,
  ].join("\n");
}

async function inspectModelManagerState(message: InspectModelManagerMessage): Promise<void> {
  try {
    const cli = message.cli;
    const webviewConfigId = typeof message.configId === "string" && message.configId.trim()
      ? message.configId.trim()
      : null;
    const activeConfigId = getActiveConfigIdForCli(cli);
    const workspacePreferredConfigId = workspaceSettings.activeConfigIdByCli?.[cli] ?? null;
    const configId = webviewConfigId || activeConfigId || workspacePreferredConfigId;
    const visibleModelCount = normalizeCount(message.visibleModelCount);
    const visibleManagedModelCount = normalizeCount(message.visibleManagedModelCount);
    const selectedModel = normalizeCliModelName(message.selectedModel);
    const previousModelStoreReadError = lastModelStoreReadError;
    const diskStore = ensureCliModelStore(readModelStore());
    const modelStoreReadError = lastModelStoreReadError ?? previousModelStoreReadError;
    const memoryStore = ensureCliModelStore(modelStore);
    let configIds: string[] = [];
    try {
      configIds = (await configService.getConfigList(cli)).map((config) => config.id);
    } catch (error) {
      lastConfigStateLoadErrorByCli[cli] = errorToMessage(error);
    }

    const memoryModels = getModelOptionsForConfigFromStore(memoryStore, configId);
    const memoryManagedModels = getManagedModelOptionsForConfigFromStore(memoryStore, configId);
    const diskModels = getModelOptionsForConfigFromStore(diskStore, configId);
    const diskManagedModels = getManagedModelOptionsForConfigFromStore(diskStore, configId);
    const memoryModelCountsByConfigId = summarizeModelStoreByConfigId(memoryStore);
    const diskModelCountsByConfigId = summarizeModelStoreByConfigId(diskStore);
    const reasons: string[] = [];
    const configStateLoadError = lastConfigStateLoadErrorByCli[cli] ?? null;

    if (modelStoreReadError) {
      reasons.push("model-store-read-error");
    }
    if (lastModelStoreWriteError) {
      reasons.push("model-store-write-error");
    }
    if (configStateLoadError) {
      reasons.push("config-state-load-error");
    }
    if (!configId && (countStoreModels(memoryModelCountsByConfigId) > 0 || countStoreModels(diskModelCountsByConfigId) > 0)) {
      reasons.push("missing-active-config-id");
    }
    if (configId && visibleModelCount === 0 && (memoryModels.length > 0 || diskModels.length > 0)) {
      reasons.push("webview-model-options-empty-but-store-has-models");
    }
    if (configId && visibleManagedModelCount === 0 && (memoryManagedModels.length > 0 || diskManagedModels.length > 0)) {
      reasons.push("webview-managed-models-empty-but-store-has-models");
    }
    if (webviewConfigId && activeConfigId && webviewConfigId !== activeConfigId && visibleManagedModelCount === 0) {
      reasons.push("webview-active-config-mismatch");
    }

    const payload = {
      cli,
      configId,
      webviewConfigId,
      activeConfigId,
      workspacePreferredConfigId,
      visibleModelCount,
      visibleManagedModelCount,
      selectedModel,
      memoryModels,
      memoryManagedModels,
      diskModels,
      diskManagedModels,
      diskModelCountsByConfigId,
      memoryModelCountsByConfigId,
      configIds,
      modelStoreReadError,
      modelStoreWriteError: lastModelStoreWriteError,
      configStateLoadError,
      reasons,
    };

    if (reasons.length === 0) {
      void logDebug("model-manager-state-ok", payload);
      return;
    }

    void logEssential("model-manager-state-inconsistent", payload);
    await showErrorWithActions(
      t("model.diagnostics.title"),
      t("model.diagnostics.message"),
      {
        detailTitle: t("model.diagnostics.title"),
        detail: buildModelManagerDiagnosticsDetail(payload),
      }
    );
  } catch (error) {
    void logError("model-manager-inspection-failed", {
      error: errorToMessage(error),
    });
    await showErrorWithActions(t("model.diagnostics.title"), error);
  }
}

function getConfigHeartbeatPayload(
  cli: CliName,
  configState: PanelState["configState"],
  store: CliModelStore = modelStore
): ConfigHeartbeatSnapshot {
  const activeConfigId = configState.activeConfigId;
  const modelConfigId = resolveModelConfigIdForCli(cli, configState);
  const normalizedStore = ensureCliModelStore(store);
  const modelSelected = modelConfigId
    ? normalizeCliModelName(normalizedStore.selectedByConfigId[modelConfigId])
    : null;
  const managedModelOptions = modelConfigId
    ? mergeUniqueModelNames(normalizedStore.optionsByConfigId[modelConfigId] ?? [])
    : [];
  const lobsterMainModelSelected = modelConfigId
    ? getSelectedLobsterCliModel(cli, "main", modelConfigId)
    : null;
  const lobsterSubtaskModelSelected = modelConfigId
    ? getSelectedLobsterCliModel(cli, "subtask", modelConfigId)
    : null;
  const lobsterRolesForConfig = modelConfigId
    ? (normalizedStore.lobsterRolesByConfigId[modelConfigId] ?? {})
    : {};
  const lobsterRoleSignature = JSON.stringify(
    Object.keys(lobsterRolesForConfig)
      .sort((left, right) => left.localeCompare(right))
      .map((modelName) => {
        const flags = normalizeLobsterModelRoleFlags(lobsterRolesForConfig[modelName]);
        return `${modelName}:${flags.main ? "1" : "0"}${flags.subtask ? "1" : "0"}`;
      })
  );
  return {
    cli,
    activeConfigId,
    configIds: configState.configs.map((config) => config.id),
    modelSelected,
    managedModelOptions,
    lobsterMainModelSelected,
    lobsterSubtaskModelSelected,
    lobsterRoleSignature,
  };
}

function shouldRefreshConfigState(
  cli: CliName,
  configState: PanelState["configState"],
  store: CliModelStore = modelStore
): boolean {
  const nextPayload = getConfigHeartbeatPayload(cli, configState, store);
  if (!configHeartbeatSnapshot || configHeartbeatSnapshot.cli !== cli) {
    return true;
  }
  if (configHeartbeatSnapshot.activeConfigId !== nextPayload.activeConfigId) {
    return true;
  }
  if (!areStringListsEqual(configHeartbeatSnapshot.configIds, nextPayload.configIds)) {
    return true;
  }
  if (configHeartbeatSnapshot.modelSelected !== nextPayload.modelSelected) {
    return true;
  }
  if (!areStringListsEqual(configHeartbeatSnapshot.managedModelOptions, nextPayload.managedModelOptions)) {
    return true;
  }
  if (configHeartbeatSnapshot.lobsterMainModelSelected !== nextPayload.lobsterMainModelSelected) {
    return true;
  }
  if (configHeartbeatSnapshot.lobsterSubtaskModelSelected !== nextPayload.lobsterSubtaskModelSelected) {
    return true;
  }
  if (configHeartbeatSnapshot.lobsterRoleSignature !== nextPayload.lobsterRoleSignature) {
    return true;
  }
  return false;
}

function updateConfigHeartbeatSnapshot(
  cli: CliName,
  configState: PanelState["configState"],
  store: CliModelStore = modelStore
): void {
  configHeartbeatSnapshot = getConfigHeartbeatPayload(cli, configState, store);
}

async function pollConfigHeartbeat(): Promise<void> {
  if (configHeartbeatRunning) {
    return;
  }
  configHeartbeatRunning = true;
  const targetCli = currentCli;
  const workspaceKey = activeWorkspaceKey;
  try {
    const configState = await loadConfigState(targetCli);
    const configStateLoadError = lastConfigStateLoadErrorByCli[targetCli];
    if (configStateLoadError && configHeartbeatSnapshot?.cli === targetCli) {
      void logError("config-heartbeat-skip-after-config-state-error", {
        workspaceKey,
        cli: targetCli,
        error: configStateLoadError,
      });
      return;
    }
    const latestModelStore = readNormalizedModelStoreFromDisk();
    modelStore = latestModelStore;
    if (targetCli !== currentCli) {
      return;
    }
    const nextPayload = getConfigHeartbeatPayload(targetCli, configState, latestModelStore);
    void logDebug("config-heartbeat-tick", {
      workspaceKey,
      cli: targetCli,
      snapshot: configHeartbeatSnapshot,
      next: nextPayload,
    });
    if (!shouldRefreshConfigState(targetCli, configState, latestModelStore)) {
      return;
    }
    updateConfigHeartbeatSnapshot(targetCli, configState, latestModelStore);
    void logEssential("config-heartbeat-change", {
      workspaceKey,
      cli: targetCli,
      state: nextPayload,
    });
    const state = await buildPanelStateWithConfigState(configState);
    viewProvider?.postState(state);
    configManagerPanel?.syncActiveConfig();
  } catch (error) {
    void logError("config-heartbeat-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    configHeartbeatRunning = false;
  }
}

function startConfigHeartbeat(context: vscode.ExtensionContext): void {
  if (configHeartbeatTimer) {
    clearInterval(configHeartbeatTimer);
    configHeartbeatTimer = null;
  }
  configHeartbeatTimer = setInterval(() => {
    void pollConfigHeartbeat();
  }, CONFIG_HEARTBEAT_INTERVAL_MS);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (configHeartbeatTimer) {
        clearInterval(configHeartbeatTimer);
        configHeartbeatTimer = null;
      }
    })
  );
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

function mergePromptSections(prefix: string, prompt: string, suffix: string): string {
  const sections: string[] = [];
  if (prefix.trim()) {
    sections.push(prefix.trimEnd());
  }
  sections.push(prompt);
  if (suffix.trim()) {
    sections.push(suffix.trimStart());
  }
  return sections.join("\n");
}

type ThinkingPromptOptions = {
  includePrefix?: boolean;
  includeSuffix?: boolean;
};

function buildThinkingPrompt(
  cli: CliName,
  mode: ThinkingMode,
  prompt: string,
  options: ThinkingPromptOptions = {}
): string {
  const includePrefix = options.includePrefix !== false;
  const includeSuffix = options.includeSuffix !== false;
  const prefix = includePrefix ? getThinkingPromptPrefix(cli, mode) : "";
  const suffix = includeSuffix ? getThinkingPromptSuffix(cli, mode) : "";
  if (!prefix.trim() && !suffix.trim()) {
    return prompt;
  }
  return mergePromptSections(prefix, prompt, suffix);
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

function normalizeJson(value: string | undefined, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!value.trim()) {
    return fallback;
  }
  try {
    return stableStringify(JSON.parse(value));
  } catch {
    return normalizeLineEndings(value);
  }
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function isDeepEqualSubset(expected: unknown, actual: unknown): boolean {
  if (expected === actual) {
    return true;
  }
  if (typeof expected !== typeof actual) {
    return false;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      return false;
    }
    return expected.every((item, index) => isDeepEqualSubset(item, actual[index]));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") {
      return false;
    }
    const actualRecord = actual as Record<string, unknown>;
    return Object.keys(expected as Record<string, unknown>).every((key) =>
      isDeepEqualSubset((expected as Record<string, unknown>)[key], actualRecord[key])
    );
  }
  return false;
}

function startTempCleanup(context: vscode.ExtensionContext): void {
  cleanupTempDir();
  const timer = setInterval(() => {
    cleanupTempDir();
  }, TEMP_CLEAN_INTERVAL_MS);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(timer)));
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

function ensureTempDir(): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanupTempDir(): void {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      return;
    }
    const now = Date.now();
    const entries = fs.readdirSync(TEMP_DIR);
    entries.forEach((entry) => {
      const fullPath = path.join(TEMP_DIR, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      } catch (error) {
        logError("temp-cleanup-entry-failed", error);
      }
    });
  } catch (error) {
    logError("temp-cleanup-failed", error);
  }
}

function buildTempFilePath(fileName: string): string {
  const baseName = path.basename(fileName || "file");
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const randomSuffix = Math.random()
    .toString(16)
    .slice(2, 2 + TEMP_FILE_RANDOM_LENGTH);
  const timestamp = Date.now();
  return path.join(TEMP_DIR, `${timestamp}_${randomSuffix}_${safeName || "file"}`);
}

function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:.*;base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return Buffer.from(match[1], "base64");
}

async function saveUploadedFiles(
  files: UploadFilePayload[]
): Promise<{ paths: string[]; error?: string }> {
  if (!Array.isArray(files) || files.length === 0) {
    return { paths: [] };
  }
  const savedPaths: string[] = [];
  try {
    ensureTempDir();
    cleanupTempDir();
    for (const file of files) {
      const buffer = decodeDataUrl(file.dataUrl);
      if (!buffer) {
        return { paths: savedPaths, error: t("upload.parseError") };
      }
      const targetPath = buildTempFilePath(file.name);
      fs.writeFileSync(targetPath, buffer);
      savedPaths.push(targetPath);
    }
    return { paths: savedPaths };
  } catch (error) {
    logError("save-uploaded-files-failed", error);
    return { paths: savedPaths, error: t("upload.saveError") };
  }
}

function extractFirstLine(value: string): string | null {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? null;
}

function extractSemverVersion(value: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(value);
  return match ? match[1] : null;
}

function parseSemverParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemverParts(left);
  const rightParts = parseSemverParts(right);
  if (!leftParts || !rightParts) {
    return left.localeCompare(right);
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  const leftStable = !left.includes("-");
  const rightStable = !right.includes("-");
  if (leftStable !== rightStable) {
    return leftStable ? 1 : -1;
  }
  return left.localeCompare(right);
}

function expandUserHomePath(targetPath: string): string {
  if (targetPath === "~") {
    return os.homedir();
  }
  if (targetPath.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return targetPath;
}

function resolvePromptReferencedPath(rawPath: string, cwd?: string | null): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  const expanded = expandUserHomePath(trimmed);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  if (cwd) {
    return path.resolve(cwd, expanded);
  }
  return path.resolve(expanded);
}

function isImageAttachmentPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (!CODEX_IMAGE_EXTENSIONS.has(extension)) {
    return false;
  }
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function collectCodexImagePathsFromPrompt(prompt: string, cwd?: string | null): string[] {
  if (!prompt.trim()) {
    return [];
  }
  const imagePaths: string[] = [];
  const seen = new Set<string>();
  const tokenPattern = /@(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  for (const match of prompt.matchAll(tokenPattern)) {
    const rawPath = match[1] ?? match[2] ?? match[3] ?? "";
    const resolvedPath = resolvePromptReferencedPath(rawPath, cwd);
    if (!resolvedPath || !isImageAttachmentPath(resolvedPath) || seen.has(resolvedPath)) {
      continue;
    }
    seen.add(resolvedPath);
    imagePaths.push(resolvedPath);
  }
  return imagePaths;
}

async function probeCodexImageSupportStatus(command: string): Promise<CodexImageSupportStatus> {
  let version: string | null = null;
  let versionLabel: string | null = null;
  let supportsImageFlag = false;
  const probeErrors: string[] = [];

  try {
    const versionResult = await captureCliOutput(command, ["--version"], {
      timeoutMs: CODEX_IMAGE_SUPPORT_TIMEOUT_MS,
    });
    const versionOutput = [versionResult.stdout, versionResult.stderr].filter(Boolean).join("\n").trim();
    versionLabel = extractFirstLine(versionOutput);
    version = extractSemverVersion(versionOutput);
  } catch (error) {
    probeErrors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const helpResult = await captureCliOutput(command, ["exec", "--help"], {
      timeoutMs: CODEX_IMAGE_SUPPORT_TIMEOUT_MS,
    });
    const helpOutput = [helpResult.stdout, helpResult.stderr].filter(Boolean).join("\n");
    supportsImageFlag = /(?:^|\s)(?:-i,\s*)?--image\b/m.test(helpOutput);
  } catch (error) {
    probeErrors.push(error instanceof Error ? error.message : String(error));
  }

  const versionTooLow = Boolean(version && compareSemver(version, CODEX_IMAGE_MIN_VERSION) < 0);
  const supported = supportsImageFlag && !versionTooLow;
  let reason: CodexImageSupportStatus["reason"] = "supported";
  if (versionTooLow) {
    reason = "version-too-low";
  } else if (!supportsImageFlag) {
    reason = probeErrors.length ? "probe-failed" : "flag-missing";
  }

  return {
    command,
    checkedAt: Date.now(),
    version,
    versionLabel,
    supportsImageFlag,
    supported,
    reason,
    probeError: probeErrors.length ? probeErrors.join("; ") : undefined,
  };
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
  const nextStatus = await probeCodexImageSupportStatus(command);
  codexImageSupportStatus = nextStatus;
  return nextStatus;
}

function buildCodexImageSupportWarningKey(status: CodexImageSupportStatus): string {
  return [
    status.command,
    status.version ?? status.versionLabel ?? "unknown",
    status.supportsImageFlag ? "image" : "no-image",
    status.reason,
  ].join("|");
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

function normalizeRunStreamExportSource(
  source: RunStreamExportRecordPayload["source"]
): "stdout" | "stderr" | "event" {
  if (source === "stderr") {
    return "stderr";
  }
  if (source === "event") {
    return "event";
  }
  return "stdout";
}

function normalizeRunStreamExportRecords(
  records: RunStreamExportRecordPayload[]
): RunStreamExportRecord[] {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }
  const normalized: RunStreamExportRecord[] = [];
  for (const rawRecord of records) {
    if (!rawRecord || typeof rawRecord !== "object") {
      continue;
    }
    const content = typeof rawRecord.content === "string" ? rawRecord.content : "";
    if (!content.trim()) {
      continue;
    }
    const createdAt = typeof rawRecord.createdAt === "number" && Number.isFinite(rawRecord.createdAt)
      ? rawRecord.createdAt
      : Date.now();
    normalized.push({
      index: normalized.length + 1,
      content,
      source: normalizeRunStreamExportSource(rawRecord.source),
      createdAt,
    });
  }
  return normalized;
}

function buildRunStreamExportFileName(timestamp: number): string {
  const iso = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  return `${RUN_STREAM_EXPORT_FILENAME_PREFIX}-${iso}.txt`;
}

function formatRunStreamExportContent(
  records: RunStreamExportRecord[],
  options: { cli: CliName; tabId: string | null; exportedAt: number }
): string {
  const lines: string[] = [
    "# Sinitek CLI Run Stream Export",
    `Exported At: ${new Date(options.exportedAt).toISOString()}`,
    `CLI: ${options.cli}`,
    `Tab ID: ${options.tabId ?? "-"}`,
    `Record Count: ${records.length}`,
    "",
  ];
  for (const record of records) {
    lines.push(
      `## Line ${record.index} | ${record.source} | ${new Date(record.createdAt).toISOString()}`
    );
    lines.push(record.content);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function resolveRunStreamExportDirectory(): Promise<string> {
  let targetDir = path.join(os.homedir(), "Downloads");
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
    return targetDir;
  } catch {
    targetDir = os.homedir();
    await fs.promises.mkdir(targetDir, { recursive: true });
    return targetDir;
  }
}

async function exportRunStreamRecordsToTxt(
  records: RunStreamExportRecordPayload[],
  options: { cli: CliName; tabId: string | null }
): Promise<RunStreamExportResult> {
  const normalizedRecords = normalizeRunStreamExportRecords(records);
  if (!normalizedRecords.length) {
    throw new Error(t("runStream.exportEmpty"));
  }
  const exportedAt = Date.now();
  const fileName = buildRunStreamExportFileName(exportedAt);
  const targetDir = await resolveRunStreamExportDirectory();
  const targetPath = path.join(targetDir, fileName);
  const content = formatRunStreamExportContent(normalizedRecords, {
    cli: options.cli,
    tabId: options.tabId,
    exportedAt,
  });
  await fs.promises.writeFile(targetPath, content, "utf8");
  void logEssential("run-stream-export", {
    path: targetPath,
    fileName,
    recordCount: normalizedRecords.length,
    cli: options.cli,
    tabId: options.tabId ?? null,
  });
  return {
    path: targetPath,
    fileName,
  };
}

function matchesActiveConfig(
  platform: ConfigPlatform,
  config: ConfigItem,
  current: CurrentConfig
): boolean {
  if (platform === "claude") {
    const normalizedConfigContent = stripManagedClaudeSkillRules(config.content, config.claudeSkills);
    const normalizedCurrentContent = stripManagedClaudeSkillRules(current.content, config.claudeSkills);
    const configContentObj = parseJsonObject(normalizedConfigContent);
    const currentContentObj = parseJsonObject(normalizedCurrentContent);
    const contentMatch = configContentObj && currentContentObj
      ? isDeepEqualSubset(configContentObj, currentContentObj)
      : normalizeJson(normalizedConfigContent, "{}") === normalizeJson(normalizedCurrentContent, "{}");

    const configMcp = parseJsonObject(config.mcpContent);
    const currentMcp = parseJsonObject(current.mcpContent);
    const mcpMatch = configMcp && currentMcp
      ? isDeepEqualSubset(configMcp, currentMcp)
      : normalizeJson(config.mcpContent, "{}") === normalizeJson(current.mcpContent, "{}");

    return contentMatch && mcpMatch;
  }
  if (platform === "gemini") {
    const normalizedConfigContent = stripManagedGeminiSkillRules(config.content, config.geminiSkills);
    const normalizedCurrentContent = stripManagedGeminiSkillRules(current.content, config.geminiSkills);
    const configContentObj = parseJsonObject(normalizedConfigContent);
    const currentContentObj = parseJsonObject(normalizedCurrentContent);
    const contentMatch = configContentObj && currentContentObj
      ? isDeepEqualSubset(configContentObj, currentContentObj)
      : normalizeJson(normalizedConfigContent, "{}") === normalizeJson(normalizedCurrentContent, "{}");
    return (
      contentMatch &&
      normalizeLineEndings(config.envContent) === normalizeLineEndings(current.envContent)
    );
  }
  return (
    areLinesSubset(
      normalizeConfigLines(config.configContent),
      normalizeConfigLines(current.configContent)
    ) &&
    normalizeJson(config.authContent, "{}") === normalizeJson(current.authContent, "{}")
  );
}

function normalizeConfigLines(value: string | undefined): string[] {
  const normalized = stripCodexSkillsBlock(normalizeLineEndings(value ?? ""));
  return normalized
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => normalizeTomlLine(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function areLinesSubset(required: string[], actual: string[]): boolean {
  if (required.length === 0) {
    return true;
  }
  if (actual.length < required.length) {
    return false;
  }
  const counts = new Map<string, number>();
  actual.forEach((line) => {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  });
  for (const line of required) {
    const count = counts.get(line) ?? 0;
    if (count <= 0) {
      return false;
    }
    counts.set(line, count - 1);
  }
  return true;
}

function normalizeTomlLine(line: string): string {
  if (!line) {
    return "";
  }
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inDouble) {
      escaped = true;
      continue;
    }
    if (char === "\"" && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === "=" && !inDouble && !inSingle) {
      const left = line.slice(0, i).trimEnd();
      const right = line.slice(i + 1).trimStart();
      return `${left} = ${right}`.trim();
    }
  }
  return line.trim();
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
  const configId = workspaceSettings.activeConfigIdByCli?.[cli];
  return typeof configId === "string" && configId ? configId : null;
}

function resolveModelConfigIdForCli(
  cli: CliName,
  configState?: PanelState["configState"]
): string | null {
  const activeConfigId = configState ? configState.activeConfigId : getActiveConfigIdForCli(cli);
  if (activeConfigId) {
    return activeConfigId;
  }
  const preferredConfigId = getWorkspacePreferredConfigIdForCli(cli);
  if (!preferredConfigId) {
    return null;
  }
  if (configState && Array.isArray(configState.configs) && configState.configs.length > 0) {
    return configState.configs.some((config) => config.id === preferredConfigId)
      ? preferredConfigId
      : null;
  }
  return preferredConfigId;
}

function applyConfigOrder(configs: ConfigItem[], orderIds: string[]): ConfigItem[] {
  if (!orderIds || orderIds.length === 0) {
    return configs;
  }
  const used = new Set<string>();
  const ordered: ConfigItem[] = [];
  for (const id of orderIds) {
    const match = configs.find((item) => item.id === id);
    if (match) {
      ordered.push(match);
      used.add(match.id);
    }
  }
  const remaining = configs.filter((item) => !used.has(item.id));
  return [...ordered, ...remaining];
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
  try {
    const configs = await configService.getConfigList(cli);
    if (configs.length === 0) {
      setWorkspaceActiveConfigId(cli, null);
      delete lastConfigStateLoadErrorByCli[cli];
      void logInfo("loadConfigState-empty", { cli, reason: "no-configs" });
      return { configs: [], activeConfigId: null };
    }
    let orderIds: string[] = [];
    try {
      const order = await configService.getConfigOrder(cli);
      orderIds = order[cli] ?? [];
    } catch (error) {
      void logInfo("loadConfigState-order-failed", {
        cli,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const orderedConfigs = applyConfigOrder(configs, orderIds);
    const current = await configService.getCurrentConfig(cli);
    const preferredActiveConfigId = workspaceSettings.activeConfigIdByCli?.[cli] ?? null;
    const preferredActive = preferredActiveConfigId
      ? orderedConfigs.find((config) => config.id === preferredActiveConfigId) ?? null
      : null;
    const matchedActive = preferredActive && matchesActiveConfig(cli, preferredActive, current)
      ? preferredActive
      : orderedConfigs.find((config) => matchesActiveConfig(cli, config, current));
    const active = matchedActive ?? preferredActive;
    const activeConfigId = active ? active.id : null;
    if (matchedActive && preferredActiveConfigId !== activeConfigId) {
      setWorkspaceActiveConfigId(cli, activeConfigId);
    } else if (!preferredActive && preferredActiveConfigId) {
      setWorkspaceActiveConfigId(cli, null);
    } else if (!matchedActive && preferredActive) {
      void logInfo("loadConfigState-preferred-fallback", {
        cli,
        configId: preferredActive.id,
        reason: "current-config-did-not-match-known-profile",
      });
    }
    delete lastConfigStateLoadErrorByCli[cli];
    return {
      configs: orderedConfigs.map((config) => ({
        id: config.id,
        name: config.name,
        platform: config.platform,
      })),
      activeConfigId,
    };
  } catch (error) {
    lastConfigStateLoadErrorByCli[cli] = errorToMessage(error);
    void logError("panel-config-state", {
      cli,
      error: lastConfigStateLoadErrorByCli[cli],
    });
    return { configs: [], activeConfigId: null };
  }
}

async function refreshCliInstallStatuses(): Promise<void> {
  await Promise.all(CLI_LIST.map(async (cli) => {
    await refreshCliInstallStatus(cli);
  }));
}

async function refreshCliInstallStatus(cli: CliName): Promise<CliInstallStatus> {
  const command = getCliCommand(cli);
  let installed = false;
  try {
    installed = await isCliCommandAvailable(command);
  } catch (error) {
    installed = false;
    void logError("cli-install-status-detect-failed", {
      cli,
      command,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const status: CliInstallStatus = {
    command,
    installed,
    checkedAt: Date.now(),
  };
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

function isCliName(value: string): value is CliName {
  return (CLI_LIST as readonly string[]).includes(value);
}

type PromptRunInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  model?: string;
  lobsterMainModel?: string;
  lobsterSubtaskModel?: string;
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

type LobsterSubtaskConversationContext = {
  taskId: string;
  subtaskId: string;
  round: number;
};

type PromptContextBuildResult = {
  modelPrompt: string;
  contextTags: string[];
};

type ErrorInfo = {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
};

type CliAttemptResult =
  | { type: "exit"; code: number | null }
  | { type: "error"; error: Error };

type RetryErrorTraceMessageOptions = {
  tabId?: string;
  taskRole?: LobsterTaskRole;
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
};

function getErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const code = typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: unknown }).code)
      : undefined;
    return {
      message: error.message,
      name: error.name,
      code,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; name?: unknown; code?: unknown; stack?: unknown };
    const message = typeof record.message === "string" ? record.message : String(error);
    const name = typeof record.name === "string" ? record.name : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    const stack = typeof record.stack === "string" ? record.stack : undefined;
    return { message, name, code, stack };
  }
  return { message: String(error) };
}

function getAttemptFailureMessage(attemptResult: CliAttemptResult, resultErrorText?: string | null): string {
  if (attemptResult.type === "error") {
    const info = getErrorInfo(attemptResult.error);
    return info.message || t("common.unknownError");
  }
  const normalizedResultError = typeof resultErrorText === "string" && resultErrorText.trim()
    ? resultErrorText.trim()
    : null;
  return normalizedResultError ?? t("run.exitCode", { code: attemptResult.code ?? "unknown" });
}

function createHiddenRetryErrorTraceMessage(
  lastFailureMessage: string,
  options: RetryErrorTraceMessageOptions = {},
): ChatMessage {
  const content = buildHiddenRetryErrorTraceContent(lastFailureMessage, t("common.unknownError"));
  return {
    id: createMessageId(),
    role: "trace",
    content,
    createdAt: Date.now(),
    kind: "normal",
    merge: false,
    taskRole: options.taskRole,
    lobsterTaskId: options.lobsterTaskId,
    lobsterRound: options.lobsterRound,
    lobsterSubtaskId: options.lobsterSubtaskId,
  };
}

function appendHiddenRetryErrorTraceMessage(
  target: ChatMessage[] | null | undefined,
  lastFailureMessage: string,
  options: RetryErrorTraceMessageOptions = {},
): void {
  if (!target) {
    return;
  }
  const last = target[target.length - 1];
  if (last?.role === "trace" && isSameHiddenRetryErrorTraceContent(last.content, lastFailureMessage, t("common.unknownError"))) {
    return;
  }
  const message = createHiddenRetryErrorTraceMessage(lastFailureMessage, options);
  appendMessageToStore(target, message);
  sendPanelMessage({
    type: "appendMessage",
    message,
    ...(options.tabId ? { tabId: options.tabId } : {}),
  });
}

function isAbortErrorInfo(info: ErrorInfo): boolean {
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message ?? ""}`.toLowerCase();
  return combined.includes("abort");
}

function isHiddenRetryEligibleErrorInfo(info: ErrorInfo): boolean {
  if (info.name === "AbortError" || info.code === "RUNNER_DISPOSED" || !info.message || isAbortErrorInfo(info)) {
    return false;
  }
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message}`.toLowerCase();
  if ((info.code ?? "").toUpperCase() === "ENOENT" || combined.includes("enoent")) {
    return false;
  }
  return true;
}

async function waitForHiddenRetryDelay(
  retryNumber: number,
  isRunActive: () => boolean
): Promise<boolean> {
  const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
  const deadline = Date.now() + retryDelayMs;
  while (Date.now() < deadline) {
    if (!isRunActive()) {
      return false;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
  }
  return isRunActive();
}

function buildHiddenRetryPrompt(cli: CliName, thinkingMode: ThinkingMode): string {
  return buildThinkingPrompt(cli, thinkingMode, t("run.hiddenContinuePrompt"), { includeSuffix: false });
}

function buildHiddenRetryLimitMessage(): string {
  return t("run.hiddenRetryLimitReached", {
    attempts: HIDDEN_RETRY_MAX_RETRIES,
    delays: HIDDEN_RETRY_DELAY_SEQUENCE_MS.map(formatHiddenRetryDelay).join(" / "),
  });
}

function buildHiddenRetryQueuedMessage(hiddenRetryCount: number): string {
  const retryNumber = hiddenRetryCount + 1;
  const retryDelayMs = getHiddenRetryDelayMs(retryNumber);
  const progress = buildHiddenRetryProgressInfo(
    hiddenRetryCount,
    HIDDEN_RETRY_MAX_RETRIES,
    retryDelayMs,
  );
  return t("run.hiddenRetryQueued", {
    attempt: progress.retryNumber,
    attempts: progress.maxRetries,
    seconds: progress.retryDelaySeconds,
    delay: formatHiddenRetryDelay(retryDelayMs),
  });
}

function formatHiddenRetryDelay(retryDelayMs: number): string {
  if (retryDelayMs >= 60 * 1000 && retryDelayMs % (60 * 1000) === 0) {
    return `${retryDelayMs / (60 * 1000)} ${t("duration.minutes")}`;
  }
  return `${Math.max(0, Math.ceil(retryDelayMs / 1000))} ${t("duration.seconds")}`;
}

function isClaudeSessionNotFoundErrorInfo(info: ErrorInfo): boolean {
  const combined = `${info.code ?? ""} ${info.message ?? ""}`.toLowerCase();
  return combined.includes("claude_session_not_found")
    || combined.includes("no conversation found with session id:");
}

function redactPromptArg(args: string[], prompt?: string): string[] {
  if (!prompt) {
    return args;
  }
  const redacted = [...args];
  for (let i = redacted.length - 1; i >= 0; i -= 1) {
    if (redacted[i] === prompt) {
      redacted[i] = `<prompt:${prompt.length}>`;
      break;
    }
  }
  return redacted;
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

type LobsterConversationTabContext = {
  taskRole: LobsterTaskRole | null;
  lobsterTaskId: string | null;
};

function normalizeLobsterTaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeLobsterSubtaskId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeLobsterRound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const round = Math.floor(value);
  return round > 0 ? round : null;
}

function resolveLobsterConversationTabContextFromMessages(messages: ChatMessage[]): LobsterConversationTabContext {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const taskRole = message?.taskRole;
    const lobsterTaskId = normalizeLobsterTaskId(message?.lobsterTaskId);
    if (!lobsterTaskId || (taskRole !== "main" && taskRole !== "subtask")) {
      if (message?.role === "user" && String(message.content || "").trim()) {
        // A newer non-lobster user turn means this tab switched back to normal mode.
        return {
          taskRole: null,
          lobsterTaskId: null,
        };
      }
      continue;
    }
    return {
      taskRole,
      lobsterTaskId,
    };
  }
  return {
    taskRole: null,
    lobsterTaskId: null,
  };
}

function resolveLobsterConversationTabContextFromParallelRun(
  run?: ParallelTabRun
): LobsterConversationTabContext {
  if (!run) {
    return { taskRole: null, lobsterTaskId: null };
  }
  const taskRole = run.taskRole === "main" || run.taskRole === "subtask"
    ? run.taskRole
    : null;
  const lobsterTaskId = normalizeLobsterTaskId(run.lobsterTaskId);
  if (taskRole && lobsterTaskId) {
    return { taskRole, lobsterTaskId };
  }
  return resolveLobsterConversationTabContextFromMessages(run.messageTarget);
}

function resolveLobsterConversationTabContextFromInteractiveRun(
  run?: InteractiveTabRun
): LobsterConversationTabContext {
  if (!run) {
    return { taskRole: null, lobsterTaskId: null };
  }
  const taskRole = run.taskRole === "main" || run.taskRole === "subtask"
    ? run.taskRole
    : null;
  const lobsterTaskId = normalizeLobsterTaskId(run.lobsterTaskId);
  if (taskRole && lobsterTaskId) {
    return { taskRole, lobsterTaskId };
  }
  return resolveLobsterConversationTabContextFromMessages(run.messageTarget);
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

function normalizeLobsterResumePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .replace(/[，,。.!！?？;；:：~～]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLobsterResumePrompt(prompt: string): boolean {
  const normalized = normalizeLobsterResumePrompt(prompt);
  if (!normalized || normalized.length > LOBSTER_RESUME_PROMPT_MAX_LENGTH) {
    return false;
  }
  return LOBSTER_RESUME_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isLobsterTaskResumable(task: LobsterTaskRecord): boolean {
  return task.status === "error" || task.status === "stopped" || task.status === "running";
}

function collectRecentLobsterTaskIdsForTarget(target: PromptRunTarget, limit = 12): string[] {
  const messages = getLobsterMessagesForTarget(target);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const taskId = typeof messages[index]?.lobsterTaskId === "string"
      ? messages[index]?.lobsterTaskId?.trim()
      : "";
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    ids.push(taskId);
    if (ids.length >= limit) {
      break;
    }
  }
  return ids;
}

function isLobsterTaskSessionCompatible(
  task: LobsterTaskRecord,
  targetSessionId: string | null,
  options: { allowMissingTaskSessionId?: boolean } = {}
): boolean {
  if (!targetSessionId) {
    return !task.sessionId;
  }
  if (task.sessionId === targetSessionId) {
    return true;
  }
  return options.allowMissingTaskSessionId === true && !task.sessionId;
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
      task.status === "completed" && !hasLobsterFinalSummaryMessageForTask(target, task.id)
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
          });
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
      });
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
    const shouldResumeCompletedWithoutFinalSummary = Boolean(
      existingTask
      && existingTask.status === "completed"
      && !hasLobsterFinalSummaryMessageForTask(target, existingTask.id)
    );
    if (
      existingTask
      && isLobsterTaskCompatibleWithTarget(existingTask, target, { allowMissingTaskSessionId: true })
      && (!isLobsterTaskCompleted(existingTask) || shouldResumeCompletedWithoutFinalSummary)
    ) {
      task = updateLobsterTaskRecord(existingTask.id, {
        status: "running",
        activeSubtaskId: null,
        activeSubtaskIds: [],
        updatedAt: Date.now(),
      }, { allowCompletedToRunning: shouldResumeCompletedWithoutFinalSummary }) ?? existingTask;
      round = resolveLobsterResumeRound(task);
      appendSystemMessageForLobster(target, buildLobsterTaskResumedText(task, round));
      void logInfo("lobster-task-resumed", {
        taskId: task.id,
        round,
        tabId: target.tabId,
        cli: target.cli,
        completedWithoutFinalSummary: shouldResumeCompletedWithoutFinalSummary,
      });
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
    });
    appendSystemMessageForLobster(target, buildLobsterTaskStartedText(task));
  }

  while (task && round <= task.maxRounds) {
    const latest: LobsterTaskRecord = readLobsterTaskRecord(task.id) ?? task;
    task = latest;
    if (isLobsterTaskCompleted(latest)) {
      if (hasLobsterFinalSummaryMessageForTask(target, latest.id)) {
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
      appendSystemMessageForLobster(target, buildLobsterTaskResumedText(resumed, round));
      void logInfo("lobster-task-completed-without-final-summary-resumed", {
        taskId: resumed.id,
        round,
        tabId: target.tabId,
        cli: target.cli,
      });
      continue;
    }

    const mainStatus = await runLobsterRound({
      input,
      target,
      task: latest,
      round,
      role: "main",
      displayPrompt: buildLobsterMainDisplayPrompt(latest.rootPrompt, round),
      modelPrompt: buildLobsterMainModelPrompt(input.modelPrompt || latest.rootPrompt, latest, round),
    });
    if (mainStatus === "error" || mainStatus === "stopped") {
      markLobsterTaskInterrupted(latest.id, mainStatus, target);
      return;
    }

    const mainContent = getLastLobsterAssistantContent(target, latest.id, round, "main");
    const decision = parseLobsterMainDecision(mainContent);
    if (!decision) {
      const failedRecord = updateLobsterTaskRecord(latest.id, {
        status: "needs-review",
        updatedAt: Date.now(),
        finalSummary: "Main task did not return a valid lobster decision JSON.",
      }) ?? latest;
      appendSystemMessageForLobster(target, buildLobsterTaskNeedsReviewText(failedRecord));
      return;
    }

    const decisionResult = applyLobsterMainDecision(latest.id, decision);
    if (decisionResult.status === "completed") {
      removeLobsterMainDecisionMessage(target, latest.id, round);
      appendSystemMessageForLobster(target, buildLobsterTaskCompletedText(decisionResult.task));
      appendLobsterFinalSummaryMessage(target, decisionResult.task, decision);
      return;
    }
    if (decisionResult.status === "blocked" || !decisionResult.subtasks?.length) {
      appendSystemMessageForLobster(target, buildLobsterTaskNeedsReviewText(decisionResult.task));
      return;
    }

    const subtasks = decisionResult.subtasks;
    showLobsterSubtaskDecisionMarkdown(target, decisionResult.task, round, subtasks, decision);
    const subtaskResults = await runLobsterSubtasksBatchWithRetry({
      input,
      target,
      task: decisionResult.task,
      round,
      subtasks,
    });
    const interrupted = subtaskResults.find((result) => result.status === "error" || result.status === "stopped");
    if (interrupted) {
      const interruptedStatus = interrupted.status === "stopped" ? "stopped" : "error";
      markLobsterTaskInterrupted(latest.id, interruptedStatus, target);
      return;
    }

    const nextMainRound = round + 1;
    if (nextMainRound <= latest.maxRounds) {
      appendSystemMessageForLobster(
        target,
        buildLobsterMainResumeText(latest.id, nextMainRound, subtasks)
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

function resolveLobsterResumeRound(task: LobsterTaskRecord): number {
  const recordedRound = typeof task.currentRound === "number" && Number.isFinite(task.currentRound)
    ? Math.floor(task.currentRound)
    : 0;
  const latestRoundFromHistory = task.rounds.reduce((maxValue, current) => {
    const round = typeof current.round === "number" && Number.isFinite(current.round)
      ? Math.floor(current.round)
      : 0;
    return Math.max(maxValue, round);
  }, 0);
  const resolved = Math.max(recordedRound, latestRoundFromHistory, 1);
  return Math.min(resolved, task.maxRounds);
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
    appendSystemMessageForLobster(target, buildLobsterSubtaskBatchCompletedText(task.id, round, subtasks));
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
      if (status === "end" && getWorkspaceLobsterAutoCloseSubtaskTabs()) {
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
      "🦞 龙虾主任务：请拆分目标，优先并发派发互不冲突的子任务，返回 JSON 决策，由程序启动子任务。",
    ].join("\n");
  }
  return [
    `🦞 龙虾主任务第 ${round} 轮复核。`,
    "上一批子任务已结束（可能成功或中断），请读取任务记录判断整体是否完成；未完成则返回下一批子任务 JSON。",
    "本轮必须预判 estimatedRemainingRounds，说明当前决策之后预计还剩多少轮。",
  ].join("\n");
}

function buildLobsterSubtaskDisplayPrompt(round: number, subtask: LobsterSubtaskRecord, retryCount = 0): string {
  const retryLine = retryCount > 0
    ? `第 ${retryCount} 次重试（最多 ${LOBSTER_SUBTASK_RETRY_MAX_RETRIES} 次）。`
    : "";
  return [
    `🦞 龙虾子任务第 ${round} 轮执行：${subtask.title}`,
    retryLine,
    subtask.prompt ?? subtask.title,
  ].filter(Boolean).join("\n");
}

function buildLobsterMainModelPrompt(rootPrompt: string, task: LobsterTaskRecord, round: number): string {
  const taskId = task.id;
  const taskFile = task.taskStoreFile;
  const communication = getLobsterCommunicationPaths(taskId);
  return [
    "你正在执行 VS Code 插件的龙虾模式主任务。",
    `龙虾任务 ID：${taskId}`,
    `当前轮次：${round}`,
    `任务记录文件：${taskFile}`,
    `沟通目录：${communication.dir}`,
    `主任务沟通文件：${communication.mainFile}`,
    `子任务沟通目录：${communication.subtasksDir}`,
    "",
    "龙虾模式原理（必须遵守）：",
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
    '{"status":"completed","estimatedRemainingRounds":0,"finalSummary":"整体完成说明","requirementCoverage":[{"name":"用户需求A","passed":true,"detail":"覆盖说明"}],"roundSummaries":[{"round":1,"subtaskId":"stable-id","title":"子任务标题","summary":"本轮完成内容摘要"}],"acceptance":{"passed":true,"summary":"验收通过说明","checks":[{"name":"目标覆盖","passed":true,"detail":"..."}]}}',
    '{"status":"continue","estimatedRemainingRounds":2,"acceptance":{"passed":false,"summary":"未通过原因","checks":[{"name":"缺口项","passed":false,"detail":"..."}]},"parallelReason":"这些子任务预计写入文件互不重叠、没有先后依赖，可以并发","subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src-a","writeFiles":["src/a.ts","src/a.test.ts"],"prompt":"给子任务A执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"},{"id":"stable-id-b","title":"子任务B标题","conflictGroup":"docs-b","writeFiles":["docs/b.md"],"prompt":"给子任务B执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"}]}',
    '{"status":"continue","estimatedRemainingRounds":1,"acceptance":{"passed":false,"summary":"存在同文件或依赖冲突，必须串行","checks":[{"name":"依赖关系","passed":false,"detail":"B 依赖 A 对 src/shared.ts 的修改结果"}]},"subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src/shared.ts","writeFiles":["src/shared.ts"],"prompt":"给子任务A执行的完整指令"}]}',
    '{"status":"blocked","estimatedRemainingRounds":0,"finalSummary":"阻塞原因"}',
    "",
    "字段要求：",
    "- status 只能是 completed、continue、blocked。",
    "- 每次返回都必须提供 estimatedRemainingRounds；含义是从当前决策之后预计还需要多少个主任务复核轮/子任务批次才能 completed，必须是非负整数。",
    "- status=completed 时必须提供 estimatedRemainingRounds=0、acceptance.passed=true、finalSummary、requirementCoverage 和 roundSummaries。",
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
    "- 返回 completed 前，同时更新任务记录文件 status=completed、estimatedRemainingRounds=0、finalSummary、roundSummaries，并保证 acceptance.checks 全部 passed=true。",
    "",
    "原始目标：",
    rootPrompt,
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
    "你正在执行 VS Code 插件的龙虾模式子任务。",
    "注意：这是单独新会话，不具备主任务对话上下文；只能依赖本提示词和任务记录文件。",
    "注意：同一轮可能存在其他子任务并发执行；必须严格限定在当前子任务授权范围内，发现写入范围冲突时先停止并在沟通文件中报告。",
    `龙虾任务 ID：${taskId}`,
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

function buildLobsterRoundSummary(round: number, role: LobsterTaskRole, subtaskId?: string): string {
  const subtaskSuffix = role === "subtask" && subtaskId ? ` (${subtaskId})` : "";
  return `${role === "main" ? "Main task" : "Subtask"}${subtaskSuffix} round ${round} finished from extension observation.`;
}

function getLobsterMessagesForTarget(target: PromptRunTarget): ChatMessage[] {
  const tab = getConversationTabById(target.tabId);
  const sessionId = tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
  return sessionId
    ? loadSessionMessages(target.cli, sessionId)
    : getPendingSessionDraft(target.tabId, target.cli).messages;
}

function resolveLobsterSubtaskConversationContextFromMessages(
  messages: ChatMessage[],
): LobsterSubtaskConversationContext | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const taskId = normalizeLobsterTaskId(message?.lobsterTaskId);
    const subtaskId = normalizeLobsterSubtaskId(message?.lobsterSubtaskId);
    const round = normalizeLobsterRound(message?.lobsterRound);
    if (message?.taskRole === "subtask" && taskId && subtaskId && round) {
      return {
        taskId,
        subtaskId,
        round,
      };
    }
    if (message?.role === "user" && String(message.content || "").trim()) {
      return null;
    }
  }
  return null;
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
      finalSummary: decision.finalSummary,
      estimatedRemainingRounds: 0,
      completionRoundSummaries: decision.roundSummaries ?? existing.completionRoundSummaries,
      completionRequirementCoverage: decision.requirementCoverage ?? existing.completionRequirementCoverage,
      updatedAt: Date.now(),
    }) ?? existing;
    appendLobsterMainDecisionSummary(task, decision);
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

function buildLobsterFinalSummaryMarkdown(task: LobsterTaskRecord, decision?: LobsterMainDecision | null): string {
  const roundSummaries = Array.isArray(decision?.roundSummaries)
    ? decision.roundSummaries.slice().sort((left, right) => left.round - right.round)
    : (Array.isArray(task.completionRoundSummaries)
      ? task.completionRoundSummaries.slice().sort((left, right) => left.round - right.round)
      : []);
  const requirementCoverage = Array.isArray(decision?.requirementCoverage)
    ? decision.requirementCoverage
    : (Array.isArray(task.completionRequirementCoverage) ? task.completionRequirementCoverage : []);
  const acceptanceChecks = Array.isArray(decision?.acceptance?.checks) ? decision.acceptance?.checks ?? [] : [];
  const finalSummary = decision?.finalSummary ?? task.finalSummary ?? "无";
  const lines: string[] = [
    "# 龙虾任务最终总结",
    "",
    `- 任务 ID：${task.id}`,
    `- 会话 ID：${task.sessionId ?? "unknown"}`,
    `- 生成时间：${new Date().toISOString()}`,
    `- 验收状态：${decision?.acceptance?.passed === false ? "未通过" : "通过"}`,
  ];

  lines.push("");
  lines.push("## 子任务完成摘要");
  if (roundSummaries.length === 0) {
    lines.push("- 无可用的子任务摘要。");
  } else {
    roundSummaries.forEach((item) => {
      const subtaskSuffix = item.subtaskId ? `（${item.subtaskId}）` : "";
      lines.push(`- 第 ${item.round} 轮 ${item.title}${subtaskSuffix}：${item.summary}`);
    });
  }

  lines.push("");
  lines.push("## 验收结果");
  if (decision?.acceptance?.summary) {
    lines.push(decision.acceptance.summary);
  }
  if (acceptanceChecks.length > 0) {
    lines.push("");
    acceptanceChecks.forEach((check) => {
      const detail = check.detail ? `（${check.detail}）` : "";
      lines.push(`- ${check.name}：${check.passed ? "通过" : "未通过"}${detail}`);
    });
  }

  lines.push("");
  lines.push("## 用户需求覆盖");
  if (requirementCoverage.length === 0) {
    lines.push("- 无可用的需求覆盖项。");
  } else {
    requirementCoverage.forEach((item) => {
      const detail = item.detail ? `（${item.detail}）` : "";
      lines.push(`- ${item.name}：${item.passed ? "已覆盖" : "未覆盖"}${detail}`);
    });
  }

  lines.push("");
  lines.push("## 最终修复说明");
  lines.push(finalSummary);
  return `${lines.join("\n")}\n`;
}

function buildLobsterSubtaskDecisionMarkdown(
  task: LobsterTaskRecord,
  round: number,
  subtasks: LobsterSubtaskRecord[],
  decision: LobsterMainDecision,
): string {
  const acceptanceChecks = Array.isArray(decision.acceptance?.checks) ? decision.acceptance?.checks ?? [] : [];
  const lines: string[] = [
    subtasks.length === 1 ? "## 龙虾子任务派发" : "## 龙虾并发子任务派发",
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

function formatLobsterWriteFiles(writeFiles?: string[]): string | null {
  if (!Array.isArray(writeFiles) || writeFiles.length === 0) {
    return null;
  }
  return writeFiles.join("、");
}

function formatLobsterEstimatedRemainingRounds(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return `${Math.max(0, Math.floor(value))} 轮`;
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
}

function buildLobsterSubtaskCompletionSummary(content: string | null): string | undefined {
  const normalized = String(content ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 1000 ? `${normalized.slice(0, 1000)}...` : normalized;
}

type LobsterVerificationState = "yes" | "no" | "unknown";

type LobsterVerificationSignals = {
  unitTest: LobsterVerificationState;
  build: LobsterVerificationState;
  unitTestEvidence?: string;
  buildEvidence?: string;
};

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

function formatLobsterVerificationState(state: LobsterVerificationState): string {
  if (state === "yes") {
    return "已完成";
  }
  if (state === "no") {
    return "未完成";
  }
  return "未明确";
}

function detectLobsterVerificationSignals(content: string): LobsterVerificationSignals {
  const unitTest = detectLobsterVerificationState(content, "unitTest");
  const build = detectLobsterVerificationState(content, "build");
  return {
    unitTest: unitTest.state,
    build: build.state,
    unitTestEvidence: unitTest.evidence,
    buildEvidence: build.evidence,
  };
}

function detectLobsterVerificationState(
  content: string,
  kind: "unitTest" | "build"
): { state: LobsterVerificationState; evidence?: string } {
  const normalized = String(content || "").trim();
  if (!normalized) {
    return { state: "unknown" };
  }

  const lineCandidates = normalized
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const negativePatterns = kind === "unitTest"
    ? [
        /(?:未|没有|暂未|未能)\S{0,10}(?:单测|单元测试|测试)/i,
        /(?:单测|单元测试|测试)\S{0,10}(?:未执行|未跑|未做|失败|fail)/i,
        /\b(skip|skipped)\b.{0,16}\btest/i,
      ]
    : [
        /(?:未|没有|暂未|未能)\S{0,10}(?:编译|构建|build)/i,
        /(?:编译|构建|build)\S{0,10}(?:未执行|失败|fail)/i,
      ];
  const positivePatterns = kind === "unitTest"
    ? [
        /(?:已|完成|执行|运行|跑)\S{0,10}(?:单测|单元测试)/i,
        /(?:单测|单元测试)\S{0,12}(?:通过|成功|pass|passed|ok)/i,
        /\b(?:npm|pnpm|yarn)\s+test\b/i,
        /\b(?:jest|vitest|mocha|pytest|go test)\b/i,
      ]
    : [
        /(?:已|完成|执行|运行|跑)\S{0,10}(?:编译|构建|build)/i,
        /(?:编译|构建|build)\S{0,12}(?:通过|成功|pass|passed|ok)/i,
        /\b(?:npm|pnpm|yarn)\s+run\s+build\b/i,
        /\btsc\b/i,
      ];

  const negativeEvidence = findFirstEvidenceLine(lineCandidates, negativePatterns);
  if (negativeEvidence) {
    return { state: "no", evidence: negativeEvidence };
  }
  const positiveEvidence = findFirstEvidenceLine(lineCandidates, positivePatterns);
  if (positiveEvidence) {
    return { state: "yes", evidence: positiveEvidence };
  }
  return { state: "unknown" };
}

function findFirstEvidenceLine(lines: string[], patterns: RegExp[]): string | undefined {
  for (const line of lines) {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        return line.length > 180 ? `${line.slice(0, 180)}...` : line;
      }
    }
  }
  return undefined;
}

function markLobsterTaskInterrupted(taskId: string, status: "error" | "stopped", target: PromptRunTarget): void {
  const record = updateLobsterTaskRecord(taskId, {
    status,
    updatedAt: Date.now(),
  }) ?? readLobsterTaskRecord(taskId);
  if (record) {
    appendSystemMessageForLobster(target, buildLobsterTaskNeedsReviewText(record));
  }
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
  if (!task.sessionId) {
    return null;
  }

  const newTab: ConversationTabRecord = {
    id: createConversationTabId(),
    cli: task.cli,
    sessionId: task.sessionId,
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, task.cli, task.sessionId),
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
  if (!latestTask || (latestTask.status !== "error" && latestTask.status !== "stopped")) {
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

function hasLobsterFinalSummaryMessageForTask(target: PromptRunTarget, taskId: string): boolean {
  const messages = getLobsterMessagesForTarget(target);
  return messages.some((message) => (
    message.role === "assistant"
    && message.taskRole === "main"
    && message.lobsterTaskId === taskId
    && message.lobsterFinalSummary === true
    && typeof message.content === "string"
    && message.content.trim().length > 0
  ));
}

function appendLobsterFinalSummaryMessage(
  target: PromptRunTarget,
  task: LobsterTaskRecord,
  decision?: LobsterMainDecision | null,
): void {
  const messages = getLobsterMessagesForTarget(target);
  if (hasLobsterFinalSummaryMessageForTask(target, task.id)) {
    return;
  }
  const message: ChatMessage = {
    id: createMessageId(),
    role: "assistant",
    content: buildLobsterFinalSummaryMarkdown(task, decision),
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

function appendSystemMessageForLobster(target: PromptRunTarget, content: string): void {
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

function buildLobsterTaskStartedText(task: LobsterTaskRecord): string {
  return `🦞 龙虾任务已启动：${task.id}\n记录文件：${task.taskStoreFile}`;
}

function buildLobsterTaskResumedText(task: LobsterTaskRecord, round: number): string {
  return t("run.lobsterResumed", { taskId: task.id, round, file: task.taskStoreFile });
}

function buildLobsterTaskCompletedText(task: LobsterTaskRecord): string {
  return [
    `🦞 龙虾任务已完成：${task.id}`,
    `记录文件：${task.taskStoreFile}`,
  ].join("\n");
}

function buildLobsterTaskNeedsReviewText(task: LobsterTaskRecord): string {
  return `🦞 龙虾任务需要人工复核：${task.id}\n记录文件：${task.taskStoreFile}`;
}

function buildLobsterMainResumeText(
  taskId: string,
  round: number,
  subtasks: LobsterSubtaskRecord[],
): string {
  const subtaskTitles = subtasks.map((subtask) => subtask.title).join("、");
  return [
    `🦞 正在唤醒主任务复核：第 ${round} 轮`,
    `龙虾任务：${taskId}`,
    `已完成子任务：${subtaskTitles || "无"}`,
  ].join("\n");
}

function buildLobsterSubtaskBatchStartedText(
  taskId: string,
  round: number,
  subtasks: LobsterSubtaskRecord[],
  executionPlan: LobsterSubtaskExecutionPlan<LobsterSubtaskRecord>,
): string {
  const isSingleParallelGroup = executionPlan.groups.length <= 1;
  const lines = [
    isSingleParallelGroup
      ? `🦞 并发子任务批次已启动：${subtasks.length} 个`
      : `🦞 子任务批次已规划：${subtasks.length} 个，将按 ${executionPlan.groups.length} 组执行（组内并发、组间串行）`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
  ];
  if (!isSingleParallelGroup) {
    lines.push(`执行计划：${describeLobsterExecutionPlan(executionPlan).join("；")}`);
  }
  if (executionPlan.conflicts.length > 0) {
    const conflictSummaries = executionPlan.conflicts.slice(0, 3).map((conflict) => {
      const reason = conflict.reason === "writeFiles" ? "写入文件" : "冲突组";
      return `${conflict.leftId} ↔ ${conflict.rightId}（${reason}: ${conflict.value}）`;
    });
    lines.push(`串行兜底：检测到 ${executionPlan.conflicts.length} 个声明冲突，${conflictSummaries.join("；")}`);
  }
  return lines.join("\n");
}

function buildLobsterSubtaskExecutionGroupStartedText(
  taskId: string,
  round: number,
  groupIndex: number,
  groupCount: number,
  subtasks: LobsterSubtaskRecord[],
): string {
  return [
    `🦞 子任务执行组已启动：第 ${groupIndex + 1}/${groupCount} 组，${subtasks.length} 个`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `组内子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
  ].join("\n");
}

function buildLobsterSubtaskBatchCompletedText(
  taskId: string,
  round: number,
  subtasks: LobsterSubtaskRecord[],
): string {
  return [
    `🦞 子任务批次已全部完成：${subtasks.length} 个`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `子任务：${subtasks.map((subtask) => subtask.title).join("、")}`,
  ].join("\n");
}

function buildLobsterSubtaskRetryText(taskId: string, subtaskId: string, retryCount: number): string {
  return [
    `🦞 子任务执行出错，1 分钟后自动重试（${retryCount}/${LOBSTER_SUBTASK_RETRY_MAX_RETRIES}）。`,
    `龙虾任务：${taskId}`,
    `子任务：${subtaskId}`,
  ].join("\n");
}

function buildLobsterSubtaskStartedText(
  taskId: string,
  subtask: LobsterSubtaskRecord,
  round: number,
  communicationFile: string,
  retryCount: number,
): string {
  const retryText = retryCount > 0 ? `（第 ${retryCount} 次重试）` : "";
  return [
    `🦞 子任务已启动${retryText}：${subtask.title}`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `沟通文件：${communicationFile}`,
  ].join("\n");
}

function isAutoContextCompactionCli(cli: CliName): cli is "codex" | "claude" | "gemini" {
  return cli === "codex" || cli === "claude" || cli === "gemini";
}

function buildUserChatMessage(input: PromptRunInput, createdAt: number, messageId: string): ChatMessage {
  return {
    id: messageId,
    role: "user",
    content: input.displayPrompt,
    createdAt,
    merge: false,
    contextTags: input.contextTags,
    taskRole: input.taskRole,
    lobsterTaskId: input.lobsterTaskId,
    lobsterRound: input.lobsterRound,
    lobsterSubtaskId: input.lobsterSubtaskId,
  };
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
  skipUserBlock = false;
  skipCodexBlock = false;
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
          });
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
      });
      appendSystemMessage(buildHiddenRetryQueuedMessage(hiddenRetryCount));
      hiddenRetryCount += 1;
      continue;
    }

    if (attemptResult.type === "error") {
      const error = attemptResult.error;
      const errnoError = error as NodeJS.ErrnoException;
      const isNotFound = errnoError?.code === "ENOENT";
      const rawUserMessage = isNotFound
        ? buildCliCommandNotFoundMessage(runCli, command)
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

function extractRecentTurns(messages: ChatMessage[], maxTurns: number): ChatMessage[] {
  // Keep the last N user turns (+ following assistant if present).
  const result: ChatMessage[] = [];
  let collected = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) {
      continue;
    }
    if (msg.role === "user") {
      // include assistant after this user message if it exists
      const assistant = messages[i + 1];
      if (assistant && assistant.role === "assistant") {
        result.push(assistant);
      }
      result.push(msg);
      collected += 1;
      if (collected >= maxTurns) {
        break;
      }
    }
  }
  return result.reverse();
}

function formatTurnsForBootstrap(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const content = (message.content ?? "").trimEnd();
    if (!content) {
      continue;
    }
    if (message.role === "user") {
      lines.push("USER:");
      lines.push(content);
      lines.push("");
    } else if (message.role === "assistant") {
      lines.push("ASSISTANT:");
      lines.push(content);
      lines.push("");
    }
  }
  return lines.join("\n").trim() + "\n";
}

function buildCompactionPrompt(): string {
  return [
    t("compact.systemPrompt"),
    t("compact.systemPrompt.reqTitle"),
    t("compact.systemPrompt.req1"),
    t("compact.systemPrompt.req2"),
    t("compact.systemPrompt.req3"),
    "",
    t("compact.systemPrompt.summaryTitle"),
    "FACTS:",
    "- ...",
    "TODOS:",
    "- [ ] ...",
    "DECISIONS:",
    "- ...",
    "CONSTRAINTS:",
    "- ...",
    "INDEX:",
    "- file: <path> - <note>",
    "- cmd: <command> - <note>",
    "- conclusion: <text> - <note>",
  ].join("\n");
}

type TraceMessageOptions = {
  merge?: boolean;
  persist?: boolean;
  forceTraceBubble?: boolean;
};

type TraceDisplayResult = {
  content: string;
  shouldPersist: boolean;
};

type TraceMessageKind = "thinking" | "normal" | "tool-use";

function isCommandExecutionTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  const trimmed = firstLine.trim();
  return trimmed.startsWith("exec") || trimmed.startsWith("【执行命令】");
}

function isFileUpdateTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return firstLine.trim().startsWith("file update");
}

function isToolUseTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:tool|调用工具)[:：]?\s*(.+)?$/i.test(firstLine.trim());
}

function isToolResultTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:tool\s*result|工具结果)\b/i.test(firstLine.trim());
}

function isWarningOrErrorTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:warning|警告|error|错误)\b/i.test(firstLine.trim());
}

function isWebSearchTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  return /^(?:web\s*search\b|【网络查询】)/i.test(firstLine.trim());
}

function isThinkingTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  const trimmed = firstLine.trim();
  return trimmed.startsWith("thinking") || trimmed.startsWith("思考");
}

function resolveTraceKind(content: string, kind: TraceMessageKind): TraceMessageKind {
  if (kind === "thinking" || isThinkingTrace(content)) {
    return "thinking";
  }
  if (isToolUseTrace(content)) {
    return "tool-use";
  }
  return "normal";
}

function normalizeTraceContentForDisplay(content: string, cli: CliName | null = activeCliForRun): TraceDisplayResult {
  const { content: execContent, shouldPersist: execShouldPersist } =
    formatCodexExecSegmentForDisplay(content, cli);
  const { content: displayContent, shouldPersist } = formatTraceSegmentForDisplay(execContent, cli);
  return { content: displayContent, shouldPersist: shouldPersist && execShouldPersist };
}

function resolveTraceMerge(content: string, merge?: boolean): boolean {
  if (merge !== undefined) {
    return merge;
  }
  // Structured trace events keep an independent bubble so tags, style and collapse state stay stable.
  return !(
    isCommandExecutionTrace(content)
    || isFileUpdateTrace(content)
    || isToolUseTrace(content)
    || isToolResultTrace(content)
    || isWarningOrErrorTrace(content)
    || isWebSearchTrace(content)
  );
}

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
  const { content: displayContent, shouldPersist } = normalizeTraceContentForDisplay(content);
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

async function runGeminiNativeContextCompaction(options: {
  sessionId: string;
  tabId?: string | null;
  selectedModel: string | null;
  cwd: string | null;
  thinkingMode: ThinkingMode;
  onTraceText?: (text: string) => void;
  onAssistantText?: (text: string) => void;
  onRawStream?: (chunk: string, stream: "stdout" | "stderr") => void;
}): Promise<{ compacted: boolean; sessionId: string; resultStatus: string | null; errorText: string | null }> {
  const runCli: CliName = "gemini";
  const geminiRunProfile = prepareGeminiRunProfile(options.selectedModel, options.thinkingMode, options.cwd ?? undefined);
  const runtimeModel = geminiRunProfile.runtimeModel ?? options.selectedModel;
  const runtimeEnvOverrides = geminiRunProfile.envOverrides;
  const geminiStreamState = { remainder: "", assistantText: "", resultStatus: null as string | null, errorText: null as string | null };
  let adoptedSessionId = options.sessionId;

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
      GEMINI_NATIVE_COMPACT_PROMPT,
      {
        onStdout: (chunk: string) => {
          options.onRawStream?.(chunk, "stdout");
          processGeminiStreamJsonChunk(geminiStreamState, chunk, {
            onAssistantText: (text) => {
              options.onAssistantText?.(text);
            },
            onTraceText: (text) => options.onTraceText?.(text),
            onSessionId: (nextSessionId) => {
              adoptedSessionId = nextSessionId;
            },
            onPlainText: (text) => {
              options.onAssistantText?.(text);
            },
          });
        },
        onStderr: (chunk: string) => {
          options.onRawStream?.(chunk, "stderr");
          if (chunk.trim()) {
            options.onTraceText?.(chunk.trimEnd());
          }
        },
        onExit: (code: number | null) => settle({ type: "exit", code }),
        onError: (error: Error) => settle({ type: "error", error }),
      },
      {
        cwd: options.cwd ?? undefined,
        sessionId: options.sessionId,
        thinkingMode: options.thinkingMode,
        model: runtimeModel,
        envOverrides: runtimeEnvOverrides,
        processLabel: buildProcessLabel(runCli, options.sessionId),
      }
    );

    activeProcess = process;
  });

  finalizeGeminiStreamJsonState(geminiStreamState, {
    onAssistantText: (text) => {
      options.onAssistantText?.(text);
    },
    onTraceText: (text) => options.onTraceText?.(text),
    onSessionId: (nextSessionId) => {
      adoptedSessionId = nextSessionId;
    },
    onPlainText: (text) => {
      options.onAssistantText?.(text);
    },
  });

  activeProcess = undefined;

  if (attemptResult.type === "error") {
    throw attemptResult.error;
  }

  if (attemptResult.code !== 0) {
    throw new Error(geminiStreamState.errorText || `Gemini compaction exited with code ${attemptResult.code ?? 1}`);
  }

  if (geminiStreamState.resultStatus && geminiStreamState.resultStatus !== "success") {
    throw new Error(geminiStreamState.errorText || `Gemini compaction result status: ${geminiStreamState.resultStatus}`);
  }

  return {
    compacted: true,
    sessionId: adoptedSessionId,
    resultStatus: geminiStreamState.resultStatus,
    errorText: geminiStreamState.errorText,
  };
}

type ContextCompactionOptions = {
  silent?: boolean;
  cli?: CliName;
  tabId?: string | null;
  sessionId?: string | null;
};

async function runContextCompaction(options: ContextCompactionOptions = {}): Promise<boolean> {
  const cli = options.cli ?? currentCli;
  const tabId = typeof options.tabId === "string" ? options.tabId : getActiveConversationTabId();
  const silent = options.silent === true;
  if (!isInteractiveSupported(cli)) {
    if (!silent) {
      appendSystemMessageForCli(cli, getCurrentSessionId(cli), t("rules.compactUnsupported"));
    }
    return false;
  }
  if (activeProcess || activeInteractiveStop) {
    if (!silent) {
      appendSystemMessageForCli(cli, getCurrentSessionId(cli), t("rules.compactRunning"));
    }
    return false;
  }
  const currentSessionId = options.sessionId ?? getCurrentSessionId(cli);
  if (!currentSessionId) {
    if (!silent) {
      appendSystemMessageForCli(cli, currentSessionId, t("rules.compactNoSession"));
    }
    return false;
  }
  const resolvedSessionId = await resolveInteractiveSessionForResume(cli, currentSessionId, tabId);
  if (resolvedSessionId === undefined || !resolvedSessionId) {
    return false;
  }
  const sessionId = resolvedSessionId;

  const cwd = resolveWorkspaceCwd();
  const selectedModel = getSelectedCliModel(cli);
  const thinkingMode = getEffectiveThinkingMode(cli, selectedModel);
  const interactiveMode = getWorkspaceInteractiveMode(cli);
  applyThinkingWorkspaceFiles(cli, thinkingMode, cwd);

  const args = getEffectiveCliArgs(cli, selectedModel);
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

  const messageTarget = loadSessionMessages(cli, sessionId);
  const runId = createMessageId();
  activeRunId = runId;
  applyProcessTitle(runId, cli, sessionId);
  startTaskRun(runId, cli, sessionId, t("common.compactContext"));
  activeMessageTarget = messageTarget;
  activeSessionId = sessionId;
  activeCliForRun = cli;
  activeTabIdForRun = tabId;

  sendRunStatus("start", undefined, { activity: "contextCompaction" });

  let stopCurrentTurn: (() => void) | null = null;
  const stopFn = (): void => {
    if (activeRunId !== runId) {
      return;
    }
    void logInfo("context-compact-stop-requested", { cli, sessionId, runId });
    if (activeInteractiveStop === stopFn) {
      activeInteractiveStop = null;
    }
    appendStopMessageToStore();
    try {
      activeProcess?.kill();
      stopCurrentTurn?.();
    } catch {
      // ignore
    }
    sendRunStatus("stopped", t("run.stoppedByUser"));
    appendCompletionMessage("stopped");
    persistActiveMessages();
    clearActiveRun();
  };
  activeInteractiveStop = stopFn;

  try {
    if (cli === "codex") {
      const mappedThreadId = resolveInteractiveMappedId(cli, sessionId);
      if (!mappedThreadId) {
        appendSystemMessage(t("rules.compactNoSession"));
        cleanupAfterRun("end");
        return false;
      }

      const runner = interactiveRunnerManager.getOrCreateCodexRunner({
        sessionId,
        threadId: mappedThreadId,
        command,
        args,
        cwd: cwd ?? undefined,
        thinkingMode,
        interactiveMode,
        model: selectedModel,
        multiAgentEnabled: getWorkspaceCodexMultiAgentEnabled(),
      });
      stopCurrentTurn = () => runner.stopAndRebuild();
      interactiveRunnerManager?.beginActiveRun(cli, sessionId);
      try {
        const result = await runner.compactThread();
        upsertInteractiveMapping(cli, sessionId, result.threadId, { freezePrevious: mappedThreadId });
        appendSystemMessage(
          t("compact.codexNativeCompressed", { threadId: result.threadId })
        );
        void logInfo("context-compact-codex-complete", {
          cli,
          sessionId,
          threadId: result.threadId,
          compacted: result.compacted,
        });
        interactiveRunnerManager.setRunner("codex", sessionId, runner, thinkingMode, interactiveMode, selectedModel, {
          multiAgentEnabled: getWorkspaceCodexMultiAgentEnabled(),
        });
      } finally {
        interactiveRunnerManager?.endActiveRun(cli, sessionId);
      }
      cleanupAfterRun("end");
      return true;
    }

    if (cli === "claude") {
      const mappedSessionId = resolveInteractiveMappedId(cli, sessionId);
      let runner = interactiveRunnerManager.getOrCreateClaudeRunner({
        sessionId,
        mappedSessionId,
        command: commandForRunner,
        args,
        cwd: cwd ?? undefined,
        thinkingMode,
        interactiveMode,
        model: selectedModel,
        entrypoint: claudeEntrypoint,
      });

      stopCurrentTurn = () => runner.stopAndRebuild();

      const runClaudeSummaryCompactionFallback = async (): Promise<void> => {
        const summaryResult = await (async () => {
          interactiveRunnerManager?.beginActiveRun(cli, sessionId);
          try {
            return await runner.runForText(buildCompactionPrompt());
          } finally {
            interactiveRunnerManager?.endActiveRun(cli, sessionId);
          }
        })();
        const compactionSummary = summaryResult.text.trim() ? summaryResult.text.trim() : null;
        const previousSessionId = summaryResult.sessionId ?? runner.getSessionId() ?? mappedSessionId;
        if (!compactionSummary || !previousSessionId) {
          appendSystemMessage(t("compact.failEmpty"));
          return;
        }

        const recent = extractRecentTurns(messageTarget, KEEP_RECENT_TURNS);
        const bootstrap = [
          t("compact.resumeNotice"),
          "",
          compactionSummary,
          "",
          t("compact.systemPrompt.recentTitle"),
          formatTurnsForBootstrap(recent),
        ].join("\n");

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
        interactiveRunnerManager?.beginActiveRun(cli, sessionId);
        try {
          await runner.runStreamed(bootstrap, {
            onAssistantDelta: () => {},
            onTrace: () => {},
            onEvent: (event) => {
              sendRawStreamDelta(event, { stream: "event", appendNewline: true });
            },
            onTaskListUpdate: (items) => {
              sendPanelMessage({ type: "taskListUpdate", items });
            },
            onSessionId: (newSessionId) => {
              updateProcessTitle(cli, newSessionId);
              upsertInteractiveMapping(cli, sessionId, newSessionId, { freezePrevious: previousSessionId });
              appendSystemMessage(
                t("compact.summaryCompressed", { from: previousSessionId, to: newSessionId })
              );
              appendTraceMessage(compactionSummary);
              void logInfo("context-compact-claude-complete", {
                cli,
                sessionId,
                newSessionId,
                previousSessionId,
                mode: "summary-fallback",
              });
              interactiveRunnerManager.setRunner("claude", sessionId, runner, thinkingMode, interactiveMode, selectedModel);
            },
          });
        } finally {
          interactiveRunnerManager?.endActiveRun(cli, sessionId);
        }
      };

      let nativeResult: Awaited<ReturnType<typeof runner.compactSession>> | null = null;
      try {
        interactiveRunnerManager?.beginActiveRun(cli, sessionId);
        try {
          nativeResult = await runner.compactSession();
        } finally {
          interactiveRunnerManager?.endActiveRun(cli, sessionId);
        }
      } catch (error) {
        if (!isClaudeNativeCompactUnsupportedError(error)) {
          throw error;
        }
        void logInfo("context-compact-claude-native-fallback", {
          cli,
          sessionId,
          previousSessionId: mappedSessionId,
          reason: "unsupported-native-compact",
          error: error instanceof Error ? error.message : String(error),
        });
        await runClaudeSummaryCompactionFallback();
        cleanupAfterRun("end");
        return true;
      }

      if (!nativeResult) {
        await runClaudeSummaryCompactionFallback();
        cleanupAfterRun("end");
        return true;
      }

      const previousSessionId = nativeResult.previousSessionId ?? mappedSessionId;
      const resolvedSessionId = nativeResult.sessionId ?? previousSessionId;
      if (!nativeResult.compacted || !resolvedSessionId) {
        void logInfo("context-compact-claude-native-fallback", {
          cli,
          sessionId,
          previousSessionId,
          nextSessionId: nativeResult.sessionId,
          reason: "missing-native-compact-signal",
        });
        await runClaudeSummaryCompactionFallback();
        cleanupAfterRun("end");
        return true;
      }

      updateProcessTitle(cli, resolvedSessionId);
      upsertInteractiveMapping(
        cli,
        sessionId,
        resolvedSessionId,
        previousSessionId && previousSessionId !== resolvedSessionId
          ? { freezePrevious: previousSessionId }
          : {}
      );
      appendSystemMessage(
        previousSessionId && previousSessionId !== resolvedSessionId
          ? t("compact.claudeNativeCompressedForked", { from: previousSessionId, to: resolvedSessionId })
          : t("compact.claudeNativeCompressed", { sessionId: resolvedSessionId })
      );
      void logInfo("context-compact-claude-native-complete", {
        cli,
        sessionId,
        previousSessionId,
        resolvedSessionId,
        compacted: nativeResult.compacted,
      });
      interactiveRunnerManager.setRunner("claude", sessionId, runner, thinkingMode, interactiveMode, selectedModel);
      cleanupAfterRun("end");
      return true;
    }

    if (cli === "gemini") {
      const result = await runGeminiNativeContextCompaction({
        sessionId,
        selectedModel,
        cwd: cwd ?? null,
        thinkingMode,
        onTraceText: (text) => appendTraceMessage(`${text}\n`),
        onAssistantText: (text) => {
          if (text.trim()) {
            appendAssistantChunk(text);
          }
        },
        onRawStream: (chunk, stream) => {
          sendRawStreamDelta(chunk, { stream });
        },
      });
      adoptSessionId(cli, result.sessionId, getActiveConversationTabId());
      appendSystemMessage(t("compact.geminiNativeCompressed", { sessionId: result.sessionId }));
      void logInfo("context-compact-gemini-native-complete", {
        cli,
        sessionId,
        resolvedSessionId: result.sessionId,
        resultStatus: result.resultStatus,
      });
      cleanupAfterRun("end");
      return true;
    }

    cleanupAfterRun("end");
    return true;
  } catch (error) {
    if (!silent) {
      appendSystemMessage(t("compact.failException"));
    }
    void logError("context-compact-command-failed", {
      cli,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
      silent,
    });
    cleanupAfterRun(silent ? "end" : "error");
    return false;
  } finally {
    if (activeInteractiveStop === stopFn) {
      activeInteractiveStop = null;
    }
  }

  function cleanupAfterRun(status: TaskRunStatus, userMessage?: string): void {
    if (activeRunId !== runId) {
      void logInfo("context-compact-command-stale-end-ignored", {
        cli,
        sessionId,
        runId,
        status,
      });
      return;
    }
    void logInfo("context-compact-command-end", {
      cli,
      sessionId,
      runId,
      status,
      message: userMessage ?? null,
    });
    sendRunStatus(status === "end" ? "end" : status, userMessage);
    appendCompletionMessage(status);
    persistActiveMessages();
    clearActiveRun();
  }
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
      }));
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
        }));
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
    buildCliCommandNotFoundMessage(cli, command),
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

function buildCliCommandNotFoundMessage(cli: CliName, command: string): string {
  const configKey = `sinitek-cli-tools.commands.${cli}`;
  if (process.platform === "win32") {
    return [
      t("cli.notFound.win.title", { command }),
      t("cli.notFound.win.hint1", { configKey, command }),
      t("cli.notFound.win.hint2", { command }),
      t("cli.notFound.win.hint3"),
    ].join("\n");
  }
  return [
    t("cli.notFound.unix.title", { command }),
    t("cli.notFound.unix.hint1", { configKey }),
    t("cli.notFound.unix.hint2", { command }),
  ].join("\n");
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
  skipUserBlock = false;
  skipCodexBlock = false;
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
  appendAssistantChunkToStore(chunk, kind);
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
    if (shouldIgnoreTraceLine(line, activeTraceSegmentLines.length > 0)) {
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
  if (line && !shouldIgnoreTraceLine(line, activeTraceSegmentLines.length > 0)) {
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
    formatCodexExecSegmentForDisplay(content);
  const { content: displayContent, shouldPersist } = formatTraceSegmentForDisplay(
    execDisplayContent
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

function formatCodexExecSegmentForDisplay(
  content: string,
  cli: CliName | null = activeCliForRun
): { content: string; shouldPersist: boolean } {
  if (cli !== "codex") {
    return { content, shouldPersist: true };
  }
  const lines = content.split("\n");
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex === -1) {
    return { content, shouldPersist: true };
  }
  const firstLine = lines[firstLineIndex].trim();
  if (!firstLine.startsWith("exec") && !firstLine.startsWith("【执行命令】")) {
    return { content, shouldPersist: true };
  }

  let commandLine = firstLine;
  let consumedLineIndex = firstLineIndex;
  if (firstLine === "exec" || firstLine === "exec:" || firstLine === "【执行命令】") {
    const nextLineIndex = lines.findIndex((line, index) => index > firstLineIndex && line.trim());
    if (nextLineIndex !== -1) {
      const normalized = lines[nextLineIndex].trim().replace(/^\$\s*/, "");
      commandLine = `exec ${normalized}`;
      consumedLineIndex = nextLineIndex;
    }
  } else if (firstLine.startsWith("exec:")) {
    const normalized = firstLine.slice("exec:".length).trim();
    if (normalized) {
      commandLine = `exec ${normalized}`;
    }
  } else if (firstLine.startsWith("【执行命令】")) {
    const normalized = firstLine.slice("【执行命令】".length).trim();
    if (normalized) {
      commandLine = `exec ${normalized}`;
    } else {
      commandLine = "exec";
    }
  }

  const trailingLines = lines.slice(consumedLineIndex + 1);
  const merged = [commandLine, ...trailingLines].join("\n").trimEnd();
  return { content: merged || commandLine, shouldPersist: true };
}

function isGeminiNoiseTraceLine(trimmed: string): boolean {
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized.includes(".npmrc") && normalized.includes("globalconfig")) {
    return true;
  }
  if (normalized.includes("yolo mode is enabled")) {
    return true;
  }
  if (normalized.includes("nvm use --delete-prefix") && normalized.includes("--silent")) {
    return true;
  }
  if (normalized.includes("failed to connect to ide companion extension")) {
    return true;
  }
  return false;
}

function normalizeGeminiTraceLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return line;
  }
  if (/^\[(?:error|err)\]\s*/i.test(trimmed)) {
    return `error ${trimmed.replace(/^\[(?:error|err)\]\s*/i, "").trim()}`;
  }
  if (/^\[(?:warn|warning)\]\s*/i.test(trimmed)) {
    return `warning ${trimmed.replace(/^\[(?:warn|warning)\]\s*/i, "").trim()}`;
  }
  if (/^(?:running|executing)\s+command(?:\s*[:：]|\s+)\s*/i.test(trimmed)) {
    return `exec ${trimmed.replace(/^(?:running|executing)\s+command(?:\s*[:：]|\s+)\s*/i, "").trim()}`;
  }
  if (/^(?:tool(?:\s+call)?|调用工具)\s*[:：]\s*/i.test(trimmed)) {
    return `tool: ${trimmed.replace(/^(?:tool(?:\s+call)?|调用工具)\s*[:：]\s*/i, "").trim()}`;
  }
  if (/^(?:tool\s*result|工具结果)\s*[:：]?\s*/i.test(trimmed)) {
    return `tool result ${trimmed.replace(/^(?:tool\s*result|工具结果)\s*[:：]?\s*/i, "").trim()}`.trim();
  }
  if (/^(?:thinking|thought|思考)\s*[:：]\s*/i.test(trimmed)) {
    return `thinking ${trimmed.replace(/^(?:thinking|thought|思考)\s*[:：]\s*/i, "").trim()}`;
  }
  if (/^web\s*search\s*[:：]\s*/i.test(trimmed)) {
    return `web search ${trimmed.replace(/^web\s*search\s*[:：]\s*/i, "").trim()}`;
  }
  return trimmed;
}

function formatGeminiTraceSegmentForDisplay(
  content: string,
  cli: CliName | null = activeCliForRun
): { content: string; shouldPersist: boolean } {
  if (cli !== "gemini") {
    return { content, shouldPersist: true };
  }
  const normalizedLines = content
    .split("\n")
    .map((line) => normalizeGeminiTraceLine(line));
  const normalizedContent = normalizedLines.join("\n").trimEnd();
  if (!normalizedContent.trim()) {
    return { content: "", shouldPersist: false };
  }
  return { content: normalizedContent, shouldPersist: true };
}

function formatTraceSegmentForDisplay(
  content: string,
  cli: CliName | null = activeCliForRun
): { content: string; shouldPersist: boolean } {
  if (cli === "gemini") {
    return formatGeminiTraceSegmentForDisplay(content, cli);
  }
  return { content, shouldPersist: true };
}

function shouldIgnoreTraceLine(line: string, hasSegment: boolean): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    if (skipUserBlock) {
      skipUserBlock = false;
    }
    if (skipCodexBlock) {
      skipCodexBlock = false;
    }
    return !hasSegment;
  }
  if (activeCliForRun === "gemini" && isGeminiNoiseTraceLine(trimmed)) {
    return true;
  }
  if (skipUserBlock) {
    if (isTraceSegmentStart(trimmed)) {
      skipUserBlock = false;
    }
    return true;
  }
  if (skipCodexBlock) {
    if (isTraceSegmentStart(trimmed) || trimmed.startsWith("tokens used")) {
      skipCodexBlock = false;
    }
    return true;
  }
  if (trimmed === "user") {
    skipUserBlock = true;
    return true;
  }
  if (trimmed === "codex") {
    skipCodexBlock = true;
    return true;
  }
  const ignoredPrefixes = [
    "OpenAI Codex",
    "--------",
    "workdir:",
    "model:",
    "provider:",
    "approval:",
    "sandbox:",
    "reasoning effort:",
    "reasoning summaries:",
    "session id:",
    "mcp startup:",
    "tokens used",
  ];
  if (ignoredPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return true;
  }
  return false;
}

function isTraceSegmentStart(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(
    trimmed.startsWith("thinking")
      || trimmed.startsWith("思考")
      || trimmed.startsWith("exec")
      || trimmed.startsWith("file update")
      || trimmed.startsWith("apply_patch")
      || trimmed.startsWith("warning")
      || trimmed.startsWith("error")
      || /^\[(?:error|err|warn|warning)\]/i.test(trimmed)
      || /^(?:tool(?:\s+call)?|调用工具)\s*[:：]/i.test(trimmed)
      || /^(?:tool\s*result|工具结果)/i.test(trimmed)
      || /^(?:running|executing)\s+command/i.test(trimmed)
      || /^(?:web\s*search|【网络查询】)/i.test(trimmed)
  );
}

function getTraceSegmentKind(content: string): "thinking" | "normal" {
  return isThinkingTrace(content) ? "thinking" : "normal";
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
  const hasDuration = typeof durationMs === "number" && Number.isFinite(durationMs);
  const durationText = hasDuration ? formatDuration(Math.max(0, durationMs)) : null;
  if (status === "error") {
    return durationText ? t("run.failedWithDuration", { duration: durationText }) : t("run.failed");
  }
  if (status === "stopped") {
    return durationText ? t("run.stoppedWithDuration", { duration: durationText }) : t("run.stopped");
  }
  return durationText ? t("run.completedWithDuration", { duration: durationText }) : t("run.completed");
}

function normalizeRawStreamContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
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
  const type = typeof payload.type === "string" ? payload.type : "";
  const shouldAttachTabId = Boolean(
    activeTabIdForRun
    && (
      type === "appendMessage"
      || type === "assistantDelta"
      || type === "traceSegment"
      || type === "rawStreamDelta"
      || type === "removeMessage"
      || type === "replaceMessage"
      || type === "runStatus"
      || type === "taskListUpdate"
    )
    && !Object.prototype.hasOwnProperty.call(payload, "tabId")
  );
  if (shouldAttachTabId) {
    viewProvider?.postMessage({
      ...payload,
      tabId: activeTabIdForRun,
    });
    return;
  }
  viewProvider?.postMessage(payload);
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

function normalizeTaskRunRecord(record: unknown): TaskRunRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<TaskRunRecord>;
  const cli = typeof raw.cli === "string" && isCliName(raw.cli) ? raw.cli : null;
  if (typeof raw.id !== "string" || !raw.id.trim() || !cli) {
    return null;
  }
  if (typeof raw.prompt !== "string" || typeof raw.startedAt !== "number") {
    return null;
  }
  if (typeof raw.endedAt !== "number" || typeof raw.durationMs !== "number") {
    return null;
  }
  if (raw.status !== "end" && raw.status !== "error" && raw.status !== "stopped") {
    return null;
  }
  return {
    id: raw.id,
    cli,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    prompt: raw.prompt,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    durationMs: raw.durationMs,
    status: raw.status,
    taskRole: isLobsterTaskRole(raw.taskRole) ? raw.taskRole : undefined,
    lobsterTaskId: typeof raw.lobsterTaskId === "string" ? raw.lobsterTaskId : undefined,
    lobsterRound: typeof raw.lobsterRound === "number" ? raw.lobsterRound : undefined,
    lobsterSubtaskId: typeof raw.lobsterSubtaskId === "string" ? raw.lobsterSubtaskId : undefined,
  };
}

function ensureTaskStore(store?: TaskStore): TaskStore {
  const now = Date.now();
  const runs = Array.isArray(store?.runs)
    ? store.runs
        .map((record) => normalizeTaskRunRecord(record))
        .filter((record): record is TaskRunRecord => Boolean(record))
        .filter((record) => isTimestampWithinHistoryRetention(record.endedAt, now))
    : [];
  return { runs };
}

function readTaskStore(): TaskStore {
  try {
    if (!fs.existsSync(TASK_STORE_FILE)) {
      return { runs: [] };
    }
    const raw = fs.readFileSync(TASK_STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.runs)) {
      return { runs: [] };
    }
    return ensureTaskStore({ runs: parsed.runs as TaskRunRecord[] });
  } catch (error) {
    void logError("task-store-read-error", { error: String(error) });
    return { runs: [] };
  }
}

function writeTaskStore(store: TaskStore): void {
  try {
    const dirPath = path.dirname(TASK_STORE_FILE);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(TASK_STORE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    void logError("task-store-write-error", { error: String(error) });
  }
}

function cleanupTaskStoreRetention(): void {
  try {
    if (!fs.existsSync(TASK_STORE_FILE)) {
      return;
    }
    const normalized = readTaskStore();
    if (normalized.runs.length > 0) {
      writeTaskStore(normalized);
      return;
    }
    fs.unlinkSync(TASK_STORE_FILE);
  } catch (error) {
    void logError("task-store-retention-cleanup-error", { error: String(error) });
  }
}

function sanitizeLobsterPathSegment(value: string, fallback: string): string {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return normalized || fallback;
}

function getLobsterTaskStoreSessionFile(workspaceKey: string, cli: CliName, sessionId: string): string {
  const workspaceSegment = sanitizeLobsterPathSegment(workspaceKey, WORKSPACE_KEY_FALLBACK);
  const sessionSegment = sanitizeLobsterPathSegment(sessionId, "session");
  return path.join(LOBSTER_TASK_STORE_DIR, workspaceSegment, cli, sessionSegment, LOBSTER_TASK_STORE_FILENAME);
}

function getLobsterTaskStorePendingFile(workspaceKey: string, cli: CliName, taskId: string): string {
  const workspaceSegment = sanitizeLobsterPathSegment(workspaceKey, WORKSPACE_KEY_FALLBACK);
  const taskSegment = sanitizeLobsterPathSegment(taskId, "task");
  return path.join(
    LOBSTER_TASK_STORE_DIR,
    workspaceSegment,
    cli,
    "__pending__",
    taskSegment,
    LOBSTER_TASK_STORE_FILENAME
  );
}

function buildLobsterTaskStoreFile(cli: CliName, workspaceKey: string, sessionId: string | null, taskId: string): string {
  if (sessionId && sessionId.trim()) {
    return getLobsterTaskStoreSessionFile(workspaceKey, cli, sessionId);
  }
  return getLobsterTaskStorePendingFile(workspaceKey, cli, taskId);
}

function collectLobsterTaskStoreFilesFromDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const collected: string[] = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      void logError("lobster-task-store-readdir-error", { dirPath: current, error: String(error) });
      continue;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        return;
      }
      if (entry.isFile() && entry.name === LOBSTER_TASK_STORE_FILENAME) {
        collected.push(fullPath);
      }
    });
  }
  return collected;
}

function listLobsterTaskStoreFiles(): string[] {
  const files = collectLobsterTaskStoreFilesFromDir(LOBSTER_TASK_STORE_DIR);
  if (fs.existsSync(LOBSTER_TASK_STORE_LEGACY_FILE)) {
    files.push(LOBSTER_TASK_STORE_LEGACY_FILE);
  }
  return Array.from(new Set(files));
}

function resolveLobsterTaskStoreFileForTask(taskId: string): string | null {
  const cached = lobsterTaskStoreFileCache.get(taskId);
  if (cached && fs.existsSync(cached)) {
    const cachedStore = readLobsterTaskStore(cached);
    if (cachedStore.tasks.some((task) => task.id === taskId)) {
      return cached;
    }
    lobsterTaskStoreFileCache.delete(taskId);
  }
  const candidateFiles = listLobsterTaskStoreFiles();
  for (const filePath of candidateFiles) {
    const store = readLobsterTaskStore(filePath);
    if (store.tasks.some((task) => task.id === taskId)) {
      lobsterTaskStoreFileCache.set(taskId, filePath);
      return filePath;
    }
  }
  return null;
}

function resolveLobsterTaskSessionId(target: PromptRunTarget): string | null {
  const tab = getConversationTabById(target.tabId);
  return tab ? getConversationTabSessionIdForCli(tab, target.cli) : target.sessionId;
}

type LobsterCommunicationPaths = {
  dir: string;
  mainFile: string;
  subtasksDir: string;
};

function getLobsterCommunicationPaths(taskId: string): LobsterCommunicationPaths {
  const dir = path.join(LOBSTER_COMMUNICATION_DIR, taskId);
  return {
    dir,
    mainFile: path.join(dir, "main-task.md"),
    subtasksDir: path.join(dir, "subtasks"),
  };
}

function ensureLobsterCommunicationFiles(taskId: string, rootPrompt: string): LobsterCommunicationPaths {
  const paths = getLobsterCommunicationPaths(taskId);
  try {
    fs.mkdirSync(paths.subtasksDir, { recursive: true });
    if (!fs.existsSync(paths.mainFile)) {
      fs.writeFileSync(paths.mainFile, [
        `# 龙虾任务沟通文件`,
        ``,
        `- 任务 ID：${taskId}`,
        `- 创建时间：${new Date().toISOString()}`,
        ``,
        `## 原始目标`,
        rootPrompt,
        ``,
        `## 主任务复核记录`,
      ].join("\n"), "utf8");
    }
  } catch (error) {
    void logError("lobster-communication-init-error", { taskId, error: String(error) });
  }
  return paths;
}

function buildLobsterSubtaskCommunicationFile(taskId: string, subtaskId: string, round: number, retryCount: number): string {
  const safeSubtaskId = subtaskId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const retrySuffix = retryCount > 0 ? `-retry-${retryCount}` : "";
  return path.join(getLobsterCommunicationPaths(taskId).subtasksDir, `round-${round}-${safeSubtaskId}${retrySuffix}.md`);
}

function prepareLobsterSubtaskCommunicationFile(
  task: LobsterTaskRecord,
  subtask: LobsterSubtaskRecord,
  round: number,
  retryCount: number
): string {
  const filePath = buildLobsterSubtaskCommunicationFile(task.id, subtask.id, round, retryCount);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, [
        `# 子任务沟通文件`,
        ``,
        `- 龙虾任务 ID：${task.id}`,
        `- 子任务 ID：${subtask.id}`,
        `- 子任务标题：${subtask.title}`,
        `- 授权写入文件/范围：${formatLobsterWriteFiles(subtask.writeFiles) ?? "未声明；以子任务指令为准"}`,
        `- 轮次：${round}`,
        `- 重试次数：${retryCount}`,
        `- 创建时间：${new Date().toISOString()}`,
        ``,
        `## 执行报告`,
        `请在本节写清：执行目标、实际修改/操作、涉及文件、验证命令与结果、遗留问题、给主任务的建议。`,
      ].join("\n"), "utf8");
    }
  } catch (error) {
    void logError("lobster-subtask-communication-init-error", { taskId: task.id, subtaskId: subtask.id, filePath, error: String(error) });
  }
  updateLobsterSubtaskCommunicationFile(task.id, subtask.id, filePath);
  return filePath;
}

function updateLobsterSubtaskCommunicationFile(taskId: string, subtaskId: string, filePath: string): void {
  const task = readLobsterTaskRecord(taskId);
  if (!task) {
    return;
  }
  const subTasks = task.subTasks.map((item) => item.id === subtaskId ? { ...item, communicationFile: filePath, updatedAt: Date.now() } : item);
  updateLobsterTaskRecord(taskId, { subTasks, updatedAt: Date.now() });
}

function createLobsterTaskRecord(
  cli: CliName,
  rootPrompt: string,
  options: { sessionId?: string | null } = {}
): LobsterTaskRecord {
  const now = Date.now();
  const id = createMessageId();
  const communication = getLobsterCommunicationPaths(id);
  const sessionId = typeof options.sessionId === "string" && options.sessionId.trim()
    ? options.sessionId
    : null;
  const taskStoreFile = buildLobsterTaskStoreFile(cli, activeWorkspaceKey, sessionId, id);
  ensureLobsterCommunicationFiles(id, rootPrompt);
  const record: LobsterTaskRecord = {
    id,
    cli,
    workspaceKey: activeWorkspaceKey,
    taskStoreFile,
    rootPrompt,
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: getWorkspaceLobsterMaxRounds(),
    currentRound: 0,
    communicationDir: communication.dir,
    mainCommunicationFile: communication.mainFile,
    sessionId,
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
  const store = readLobsterTaskStore(taskStoreFile);
  store.tasks.push(record);
  writeLobsterTaskStore(taskStoreFile, store);
  lobsterTaskStoreFileCache.set(id, taskStoreFile);
  return record;
}

function readLobsterTaskRecord(taskId: string): LobsterTaskRecord | null {
  const storeFile = resolveLobsterTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return null;
  }
  const task = readLobsterTaskStore(storeFile).tasks.find((item) => item.id === taskId) ?? null;
  if (!task) {
    return null;
  }
  if (task.taskStoreFile !== storeFile) {
    return { ...task, taskStoreFile: storeFile };
  }
  return task;
}

function updateLobsterTaskRecord(
  taskId: string,
  patch: Partial<LobsterTaskRecord>,
  options: { allowCompletedToRunning?: boolean } = {}
): LobsterTaskRecord | null {
  const storeFile = resolveLobsterTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return null;
  }
  const store = readLobsterTaskStore(storeFile);
  const index = store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    return null;
  }
  const existing = store.tasks[index];
  const nextStatus = existing.status === "completed" && patch.status === "running" && options.allowCompletedToRunning !== true
    ? existing.status
    : patch.status ?? existing.status;
  const next: LobsterTaskRecord = {
    ...existing,
    ...patch,
    taskStoreFile: typeof patch.taskStoreFile === "string" && patch.taskStoreFile.trim()
      ? patch.taskStoreFile
      : existing.taskStoreFile,
    status: nextStatus,
    subTasks: Array.isArray(patch.subTasks) ? patch.subTasks : existing.subTasks,
    rounds: Array.isArray(patch.rounds) ? patch.rounds : existing.rounds,
    completionRoundSummaries: Array.isArray(patch.completionRoundSummaries)
      ? patch.completionRoundSummaries
      : existing.completionRoundSummaries,
    completionRequirementCoverage: Array.isArray(patch.completionRequirementCoverage)
      ? patch.completionRequirementCoverage
      : existing.completionRequirementCoverage,
    updatedAt: patch.updatedAt ?? Date.now(),
  };
  const targetStoreFile = next.taskStoreFile;
  if (targetStoreFile !== storeFile) {
    store.tasks.splice(index, 1);
    if (store.tasks.length > 0) {
      writeLobsterTaskStore(storeFile, store);
    } else if (fs.existsSync(storeFile)) {
      try {
        fs.unlinkSync(storeFile);
      } catch (error) {
        void logError("lobster-task-store-delete-error", { filePath: storeFile, error: String(error) });
      }
    }
    const targetStore = readLobsterTaskStore(targetStoreFile);
    const targetIndex = targetStore.tasks.findIndex((task) => task.id === taskId);
    if (targetIndex >= 0) {
      targetStore.tasks[targetIndex] = next;
    } else {
      targetStore.tasks.push(next);
    }
    writeLobsterTaskStore(targetStoreFile, targetStore);
    lobsterTaskStoreFileCache.set(taskId, targetStoreFile);
    return next;
  }
  store.tasks[index] = next;
  writeLobsterTaskStore(storeFile, store);
  lobsterTaskStoreFileCache.set(taskId, storeFile);
  return next;
}

function appendLobsterRound(taskId: string, round: LobsterRoundRecord): void {
  const storeFile = resolveLobsterTaskStoreFileForTask(taskId);
  if (!storeFile) {
    return;
  }
  const store = readLobsterTaskStore(storeFile);
  const index = store.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    return;
  }
  const task = store.tasks[index];
  const existingRoundIndex = task.rounds.findIndex((item) => (
    item.round === round.round
    && item.role === round.role
    && (item.subtaskId ?? null) === (round.subtaskId ?? null)
  ));
  const rounds = [...task.rounds];
  if (existingRoundIndex >= 0) {
    rounds[existingRoundIndex] = { ...rounds[existingRoundIndex], ...round };
  } else {
    rounds.push(round);
  }
  store.tasks[index] = {
    ...task,
    rounds,
    currentRound: Math.max(task.currentRound, round.round),
    updatedAt: Date.now(),
  };
  writeLobsterTaskStore(storeFile, store);
}

function bindLobsterTaskToSession(taskId: string, sessionId: string): LobsterTaskRecord | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }
  const task = readLobsterTaskRecord(taskId);
  if (!task) {
    return null;
  }
  const targetStoreFile = getLobsterTaskStoreSessionFile(task.workspaceKey, task.cli, normalizedSessionId);
  if (task.sessionId === normalizedSessionId && task.taskStoreFile === targetStoreFile) {
    return task;
  }
  return updateLobsterTaskRecord(taskId, {
    sessionId: normalizedSessionId,
    taskStoreFile: targetStoreFile,
    updatedAt: Date.now(),
  });
}

function isLobsterTaskCompleted(task: LobsterTaskRecord): boolean {
  return task.status === "completed";
}

function normalizeLobsterTaskRecord(record: unknown, sourceFile?: string): LobsterTaskRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LobsterTaskRecord>;
  const cli = typeof raw.cli === "string" && isCliName(raw.cli) ? raw.cli : null;
  if (typeof raw.id !== "string" || !raw.id.trim() || !cli || typeof raw.rootPrompt !== "string") {
    return null;
  }
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  const status = isLobsterTaskStatus(raw.status) ? raw.status : "running";
  const workspaceKey = typeof raw.workspaceKey === "string" ? raw.workspaceKey : WORKSPACE_KEY_FALLBACK;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : null;
  const taskStoreFile = typeof raw.taskStoreFile === "string" && raw.taskStoreFile.trim()
    ? raw.taskStoreFile
    : (sourceFile ?? buildLobsterTaskStoreFile(cli, workspaceKey, sessionId, raw.id));
  const subTasks = Array.isArray(raw.subTasks)
    ? raw.subTasks.map(normalizeLobsterSubtaskRecord).filter((item): item is LobsterSubtaskRecord => Boolean(item))
    : [];
  const rounds = Array.isArray(raw.rounds)
    ? raw.rounds.map(normalizeLobsterRoundRecord).filter((item): item is LobsterRoundRecord => Boolean(item))
    : [];
  const completionRoundSummaries = Array.isArray(raw.completionRoundSummaries)
    ? raw.completionRoundSummaries.map(normalizeSingleLobsterRoundSummary).filter((item): item is LobsterRoundSummary => Boolean(item))
    : [];
  const completionRequirementCoverage = normalizeLobsterAcceptanceChecks(
    (raw as { completionRequirementCoverage?: unknown }).completionRequirementCoverage
  );
  return {
    id: raw.id,
    cli,
    workspaceKey,
    taskStoreFile,
    rootPrompt: raw.rootPrompt,
    status,
    createdAt,
    updatedAt,
    maxRounds: normalizeStoredLobsterMaxRounds(raw.maxRounds),
    currentRound: typeof raw.currentRound === "number" ? raw.currentRound : 0,
    communicationDir: typeof raw.communicationDir === "string" ? raw.communicationDir : getLobsterCommunicationPaths(raw.id).dir,
    mainCommunicationFile: typeof raw.mainCommunicationFile === "string" ? raw.mainCommunicationFile : getLobsterCommunicationPaths(raw.id).mainFile,
    sessionId,
    activeSubtaskId: typeof raw.activeSubtaskId === "string" ? raw.activeSubtaskId : null,
    activeSubtaskIds: Array.isArray((raw as { activeSubtaskIds?: unknown }).activeSubtaskIds)
      ? (raw as { activeSubtaskIds: unknown[] }).activeSubtaskIds
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : (typeof raw.activeSubtaskId === "string" && raw.activeSubtaskId.trim() ? [raw.activeSubtaskId] : []),
    subTasks,
    rounds,
    finalSummary: typeof raw.finalSummary === "string" ? raw.finalSummary : undefined,
    estimatedRemainingRounds: normalizeLobsterEstimatedRemainingRounds(
      (raw as { estimatedRemainingRounds?: unknown }).estimatedRemainingRounds
    ),
    completionRoundSummaries,
    completionRequirementCoverage,
  };
}

function normalizeLobsterSubtaskRecord(record: unknown): LobsterSubtaskRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LobsterSubtaskRecord>;
  if (typeof raw.id !== "string" || !raw.id.trim() || typeof raw.title !== "string") {
    return null;
  }
  const status = raw.status === "pending" || raw.status === "running" || raw.status === "completed" || raw.status === "skipped" || raw.status === "blocked"
    ? raw.status
    : "pending";
  return {
    id: raw.id,
    title: raw.title,
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    conflictGroup: typeof raw.conflictGroup === "string" ? raw.conflictGroup : undefined,
    writeFiles: normalizeLobsterWriteFiles((raw as { writeFiles?: unknown }).writeFiles),
    status,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    communicationFile: typeof raw.communicationFile === "string" ? raw.communicationFile : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
  };
}

function normalizeLobsterRoundRecord(record: unknown): LobsterRoundRecord | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const raw = record as Partial<LobsterRoundRecord>;
  if (typeof raw.round !== "number" || !isLobsterTaskRole(raw.role)) {
    return null;
  }
  if (raw.status !== "end" && raw.status !== "error" && raw.status !== "stopped") {
    return null;
  }
  return {
    round: raw.round,
    role: raw.role,
    subtaskId: typeof raw.subtaskId === "string" ? raw.subtaskId : undefined,
    status: raw.status,
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    endedAt: typeof raw.endedAt === "number" ? raw.endedAt : Date.now(),
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
  };
}

function isLobsterTaskStatus(value: unknown): value is LobsterTaskStatus {
  return value === "running" || value === "completed" || value === "needs-review" || value === "error" || value === "stopped";
}

function ensureLobsterTaskStore(
  store?: LobsterTaskStore,
  options: { sourceFile?: string } = {}
): LobsterTaskStore {
  const now = Date.now();
  const tasks = Array.isArray(store?.tasks)
    ? store.tasks
      .map((record) => normalizeLobsterTaskRecord(record, options.sourceFile))
      .filter((record): record is LobsterTaskRecord => Boolean(record))
      .filter((record) => isTimestampWithinHistoryRetention(record.updatedAt, now))
    : [];
  return { tasks };
}

function readLobsterTaskStore(filePath: string): LobsterTaskStore {
  try {
    if (!fs.existsSync(filePath)) {
      return { tasks: [] };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return { tasks: [] };
    }
    return ensureLobsterTaskStore({ tasks: parsed.tasks as LobsterTaskRecord[] }, { sourceFile: filePath });
  } catch (error) {
    void logError("lobster-task-store-read-error", { filePath, error: String(error) });
    return { tasks: [] };
  }
}

function writeLobsterTaskStore(filePath: string, store: LobsterTaskStore): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(ensureLobsterTaskStore(store, { sourceFile: filePath }), null, 2),
      "utf8"
    );
  } catch (error) {
    void logError("lobster-task-store-write-error", { filePath, error: String(error) });
  }
}

function cleanupLobsterTaskStoreRetention(): void {
  try {
    const filePaths = listLobsterTaskStoreFiles();
    filePaths.forEach((filePath) => {
      const normalized = readLobsterTaskStore(filePath);
      if (normalized.tasks.length > 0) {
        writeLobsterTaskStore(filePath, normalized);
        normalized.tasks.forEach((task) => {
          lobsterTaskStoreFileCache.set(task.id, filePath);
        });
        return;
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    void logError("lobster-task-store-retention-cleanup-error", { error: String(error) });
  }
}

function collectRetainedLobsterTaskIds(): Set<string> {
  const retainedTaskIds = new Set<string>();
  const filePaths = listLobsterTaskStoreFiles();
  filePaths.forEach((filePath) => {
    const store = readLobsterTaskStore(filePath);
    store.tasks.forEach((task) => {
      retainedTaskIds.add(task.id);
    });
  });
  return retainedTaskIds;
}

function getLatestMtimeMsInTree(rootPath: string): number {
  let latestMtimeMs = 0;
  const stack = [rootPath];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) {
      continue;
    }
    let stats: fs.Stats;
    try {
      stats = fs.statSync(currentPath);
    } catch {
      continue;
    }
    if (Number.isFinite(stats.mtimeMs)) {
      latestMtimeMs = Math.max(latestMtimeMs, stats.mtimeMs);
    }
    if (!stats.isDirectory()) {
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.forEach((entry) => {
      stack.push(path.join(currentPath, entry.name));
    });
  }
  return latestMtimeMs;
}

function cleanupLobsterCommunicationRetention(): void {
  try {
    if (!fs.existsSync(LOBSTER_COMMUNICATION_DIR)) {
      return;
    }
    const now = Date.now();
    const retainedTaskIds = collectRetainedLobsterTaskIds();
    const entries = fs.readdirSync(LOBSTER_COMMUNICATION_DIR, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!entry.isDirectory()) {
        return;
      }
      const taskId = entry.name;
      if (retainedTaskIds.has(taskId)) {
        return;
      }
      const dirPath = path.join(LOBSTER_COMMUNICATION_DIR, taskId);
      const latestTouchedAt = getLatestMtimeMsInTree(dirPath);
      if (isTimestampWithinHistoryRetention(latestTouchedAt, now)) {
        return;
      }
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch (error) {
        void logError("lobster-communication-retention-delete-error", {
          taskId,
          dirPath,
          error: String(error),
        });
      }
    });
    if (fs.existsSync(LOBSTER_COMMUNICATION_DIR) && fs.readdirSync(LOBSTER_COMMUNICATION_DIR).length === 0) {
      fs.rmSync(LOBSTER_COMMUNICATION_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    void logError("lobster-communication-retention-cleanup-error", { error: String(error) });
  }
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}

function isThinkingMode(value: unknown): value is ThinkingMode {
  return value === "off"
    || value === "on"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    || value === "max";
}

function isInteractiveMode(value: unknown): value is InteractiveMode {
  return value === "coding" || value === "plan" || value === "lobster";
}

function isLobsterTaskRole(value: unknown): value is LobsterTaskRole {
  return value === "main" || value === "subtask";
}

function isMacTaskShell(value: unknown): value is MacTaskShell {
  return value === "zsh" || value === "bash";
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
  if (isInteractiveMode(mode)) {
    return mode;
  }
  return "coding";
}

function setWorkspaceInteractiveModeForCli(cli: CliName, mode: InteractiveMode): boolean {
  if (!workspaceSettings.interactiveModeByCli) {
    workspaceSettings.interactiveModeByCli = {};
  }
  if (workspaceSettings.interactiveModeByCli[cli] === mode) {
    return false;
  }
  workspaceSettings.interactiveModeByCli[cli] = mode;
  saveWorkspaceSettings(workspaceSettings);
  return true;
}

function getWorkspaceCodexMultiAgentEnabled(): boolean {
  return workspaceSettings.codexMultiAgentEnabled === true;
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

function getWorkspaceLobsterMaxRounds(): number {
  return normalizeLobsterMaxRounds(workspaceSettings.lobsterMaxRounds);
}

function getWorkspaceLobsterAutoCloseSubtaskTabs(): boolean {
  return workspaceSettings.lobsterAutoCloseSubtaskTabs !== false;
}

function normalizeCliModelName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function mergeUniqueModelNames(...groups: Array<readonly string[]>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      const normalized = normalizeCliModelName(item);
      if (!normalized) {
        continue;
      }
      const dedupeKey = normalized.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      result.push(normalized);
    }
  }
  return result;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? (error.message || String(error)) : String(error);
}

function normalizeLobsterModelRoleFlags(value: unknown): { main: boolean; subtask: boolean } {
  if (!value || typeof value !== "object") {
    return { main: true, subtask: true };
  }
  const raw = value as { main?: unknown; subtask?: unknown };
  const main = raw.main !== false;
  const subtask = raw.subtask !== false;
  if (!main && !subtask) {
    return { main: true, subtask: true };
  }
  return { main, subtask };
}

function isLobsterTaskRoleValue(value: unknown): value is LobsterTaskRole {
  return value === "main" || value === "subtask";
}

function ensureCliModelStore(store?: CliModelStore): CliModelStore {
  const normalized: CliModelStore = {
    selectedByConfigId: {},
    optionsByConfigId: {},
    thinkingByCliAndModel: {},
    selectedLobsterByConfigId: {},
    lobsterRolesByConfigId: {},
  };
  const storedOptionsByConfigId = store?.optionsByConfigId;
  if (storedOptionsByConfigId && typeof storedOptionsByConfigId === "object") {
    for (const [configId, rawOptions] of Object.entries(storedOptionsByConfigId)) {
      if (!configId || !Array.isArray(rawOptions)) {
        continue;
      }
      normalized.optionsByConfigId[configId] = mergeUniqueModelNames(rawOptions);
    }
  }
  const storedSelectedByConfigId = store?.selectedByConfigId;
  if (storedSelectedByConfigId && typeof storedSelectedByConfigId === "object") {
    for (const [configId, rawModel] of Object.entries(storedSelectedByConfigId)) {
      const normalizedModel = normalizeCliModelName(rawModel);
      if (configId && normalizedModel) {
        normalized.selectedByConfigId[configId] = normalizedModel;
      }
    }
  }
  const storedSelectedLobsterByConfigId = store?.selectedLobsterByConfigId;
  if (storedSelectedLobsterByConfigId && typeof storedSelectedLobsterByConfigId === "object") {
    for (const [configId, rawSelection] of Object.entries(storedSelectedLobsterByConfigId)) {
      if (!configId || !rawSelection || typeof rawSelection !== "object") {
        continue;
      }
      const nextSelection: Partial<Record<LobsterTaskRole, string>> = {};
      for (const [rawRole, rawModel] of Object.entries(rawSelection)) {
        if (!isLobsterTaskRoleValue(rawRole)) {
          continue;
        }
        const normalizedModel = normalizeCliModelName(rawModel);
        if (!normalizedModel) {
          continue;
        }
        nextSelection[rawRole] = normalizedModel;
      }
      if (Object.keys(nextSelection).length > 0) {
        normalized.selectedLobsterByConfigId[configId] = nextSelection;
      }
    }
  }
  const storedLobsterRolesByConfigId = store?.lobsterRolesByConfigId;
  if (storedLobsterRolesByConfigId && typeof storedLobsterRolesByConfigId === "object") {
    for (const [configId, rawRolesByModel] of Object.entries(storedLobsterRolesByConfigId)) {
      if (!configId || !rawRolesByModel || typeof rawRolesByModel !== "object") {
        continue;
      }
      const nextRolesByModel: Record<string, { main: boolean; subtask: boolean }> = {};
      for (const [rawModel, rawRoleFlags] of Object.entries(rawRolesByModel)) {
        const normalizedModel = normalizeCliModelName(rawModel);
        if (!normalizedModel) {
          continue;
        }
        nextRolesByModel[normalizedModel] = normalizeLobsterModelRoleFlags(rawRoleFlags);
      }
      if (Object.keys(nextRolesByModel).length > 0) {
        normalized.lobsterRolesByConfigId[configId] = nextRolesByModel;
      }
    }
  }
  for (const cli of CLI_LIST) {
    const storedThinkingByModel = store?.thinkingByCliAndModel?.[cli];
    if (storedThinkingByModel && typeof storedThinkingByModel === "object") {
      const normalizedThinkingByModel: Record<string, ThinkingMode> = {};
      for (const [rawModelKey, rawThinkingMode] of Object.entries(storedThinkingByModel)) {
        const normalizedModelKey = rawModelKey === DEFAULT_MODEL_STORE_KEY
          ? DEFAULT_MODEL_STORE_KEY
          : normalizeCliModelName(rawModelKey);
        if (!normalizedModelKey || !isThinkingMode(rawThinkingMode)) {
          continue;
        }
        normalizedThinkingByModel[normalizedModelKey] = normalizeThinkingModeForCli(cli, rawThinkingMode);
      }
      if (Object.keys(normalizedThinkingByModel).length > 0) {
        normalized.thinkingByCliAndModel[cli] = normalizedThinkingByModel;
      }
    }
  }
  return normalized;
}

function readModelStore(): CliModelStore | undefined {
  try {
    if (!fs.existsSync(MODEL_STORE_FILE)) {
      lastModelStoreReadError = null;
      return undefined;
    }
    const raw = fs.readFileSync(MODEL_STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as CliModelStore;
    lastModelStoreReadError = null;
    return parsed;
  } catch (error) {
    lastModelStoreReadError = errorToMessage(error);
    void logError("model-store-read-error", {
      path: MODEL_STORE_FILE,
      error: lastModelStoreReadError,
    });
    return undefined;
  }
}

function writeModelStore(store: CliModelStore): void {
  try {
    fs.mkdirSync(path.dirname(MODEL_STORE_FILE), { recursive: true });
    fs.writeFileSync(MODEL_STORE_FILE, JSON.stringify(store, null, 2), "utf8");
    lastModelStoreWriteError = null;
  } catch (error) {
    lastModelStoreWriteError = errorToMessage(error);
    void logError("model-store-write-error", {
      path: MODEL_STORE_FILE,
      error: lastModelStoreWriteError,
    });
  }
}

function loadModelStore(): CliModelStore {
  const stored = readModelStore();
  if (lastModelStoreReadError) {
    return ensureCliModelStore();
  }
  const normalized = ensureCliModelStore(stored);
  writeModelStore(normalized);
  return normalized;
}

function getActiveConfigIdForCli(cli: CliName): string | null {
  const snapshot = configHeartbeatSnapshot;
  if (snapshot && snapshot.cli === cli && snapshot.activeConfigId) {
    return snapshot.activeConfigId;
  }
  return getWorkspacePreferredConfigIdForCli(cli);
}

function getSelectedCliModel(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  if (!configId) {
    return null;
  }
  return normalizeCliModelName(modelStore?.selectedByConfigId?.[configId]);
}

function getManagedModelOptionsForCli(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string[] {
  if (!configId) {
    return [];
  }
  const storedOptions = Array.isArray(modelStore?.optionsByConfigId?.[configId])
    ? modelStore.optionsByConfigId[configId] ?? []
    : [];
  return mergeUniqueModelNames(storedOptions);
}

function getCliModelLobsterRoleFlags(
  cli: CliName,
  model: string,
  configId: string | null = getActiveConfigIdForCli(cli)
): { main: boolean; subtask: boolean } {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel) {
    return { main: true, subtask: true };
  }
  const rolesByModel = modelStore?.lobsterRolesByConfigId?.[configId];
  if (!rolesByModel || typeof rolesByModel !== "object") {
    return { main: true, subtask: true };
  }
  const matchedKey = Object.keys(rolesByModel).find((key) => key.toLowerCase() === normalizedModel.toLowerCase());
  if (!matchedKey) {
    return { main: true, subtask: true };
  }
  return normalizeLobsterModelRoleFlags(rolesByModel[matchedKey]);
}

function getLobsterModelOptionsForCli(
  cli: CliName,
  role: LobsterTaskRole,
  configId: string | null = getActiveConfigIdForCli(cli)
): string[] {
  if (!configId) {
    return [];
  }
  const options = getModelOptionsForCli(cli, configId);
  return options.filter((modelName) => {
    const roleFlags = getCliModelLobsterRoleFlags(cli, modelName, configId);
    return role === "main" ? roleFlags.main : roleFlags.subtask;
  });
}

function getSelectedLobsterCliModel(
  cli: CliName,
  role: LobsterTaskRole,
  configId: string | null = getActiveConfigIdForCli(cli)
): string | null {
  if (!configId) {
    return null;
  }
  const optionsForRole = getLobsterModelOptionsForCli(cli, role, configId);
  if (optionsForRole.length === 0) {
    return null;
  }
  const selectedByRole = modelStore?.selectedLobsterByConfigId?.[configId]?.[role];
  const normalizedSelectedByRole = normalizeCliModelName(selectedByRole);
  if (
    normalizedSelectedByRole
    && optionsForRole.some((modelName) => modelName.toLowerCase() === normalizedSelectedByRole.toLowerCase())
  ) {
    return normalizedSelectedByRole;
  }
  const selectedModel = getSelectedCliModel(cli, configId);
  if (
    selectedModel
    && optionsForRole.some((modelName) => modelName.toLowerCase() === selectedModel.toLowerCase())
  ) {
    return selectedModel;
  }
  return optionsForRole[0] ?? null;
}

function getModelOptionsForCli(cli: CliName, configId: string | null = getActiveConfigIdForCli(cli)): string[] {
  if (!configId) {
    return [];
  }
  const storedOptions = Array.isArray(modelStore?.optionsByConfigId?.[configId])
    ? modelStore.optionsByConfigId[configId] ?? []
    : [];
  const selectedModel = getSelectedCliModel(cli, configId);
  return mergeUniqueModelNames(
    storedOptions,
    selectedModel ? [selectedModel] : []
  );
}

function selectCliModel(cli: CliName, model: string | null, configId: string | null = getActiveConfigIdForCli(cli)): void {
  if (!configId) {
    return;
  }
  const normalized = normalizeCliModelName(model);
  const nextStore = ensureCliModelStore(modelStore);
  if (normalized) {
    nextStore.optionsByConfigId[configId] = mergeUniqueModelNames(nextStore.optionsByConfigId[configId] ?? [], [normalized]);
    nextStore.selectedByConfigId[configId] = normalized;
  } else {
    delete nextStore.selectedByConfigId[configId];
  }
  modelStore = ensureCliModelStore(nextStore);
  writeModelStore(modelStore);
}

function selectCliLobsterModel(
  cli: CliName,
  role: LobsterTaskRole,
  model: string | null,
  configId: string | null = getActiveConfigIdForCli(cli)
): void {
  if (!configId) {
    return;
  }
  const nextStore = ensureCliModelStore(modelStore);
  const existingSelection = nextStore.selectedLobsterByConfigId[configId] ?? {};
  const nextSelection: Partial<Record<LobsterTaskRole, string>> = { ...existingSelection };
  const normalizedModel = normalizeCliModelName(model);
  if (!normalizedModel) {
    delete nextSelection[role];
    if (Object.keys(nextSelection).length === 0) {
      delete nextStore.selectedLobsterByConfigId[configId];
    } else {
      nextStore.selectedLobsterByConfigId[configId] = nextSelection;
    }
    modelStore = ensureCliModelStore(nextStore);
    writeModelStore(modelStore);
    return;
  }
  const roleOptions = getLobsterModelOptionsForCli(cli, role, configId);
  const existsInRoleOptions = roleOptions.some((option) => option.toLowerCase() === normalizedModel.toLowerCase());
  if (!existsInRoleOptions) {
    return;
  }
  nextSelection[role] = normalizedModel;
  nextStore.selectedLobsterByConfigId[configId] = nextSelection;
  modelStore = ensureCliModelStore(nextStore);
  writeModelStore(modelStore);
}

function setCliModelLobsterRole(
  cli: CliName,
  model: string,
  role: LobsterTaskRole,
  enabled: boolean,
  configId: string | null = getActiveConfigIdForCli(cli)
): boolean {
  const normalizedModel = normalizeCliModelName(model);
  if (!configId || !normalizedModel) {
    return false;
  }
  const managedModels = getManagedModelOptionsForCli(cli, configId);
  const exists = managedModels.some((item) => item.toLowerCase() === normalizedModel.toLowerCase());
  if (!exists) {
    return false;
  }
  const nextStore = ensureCliModelStore(modelStore);
  const existingFlags = getCliModelLobsterRoleFlags(cli, normalizedModel, configId);
  const nextFlags = {
    main: existingFlags.main,
    subtask: existingFlags.subtask,
  };
  if (role === "main") {
    nextFlags.main = enabled;
  } else {
    nextFlags.subtask = enabled;
  }
  if (!nextFlags.main && !nextFlags.subtask) {
    return false;
  }
  const rolesByModel = {
    ...(nextStore.lobsterRolesByConfigId[configId] ?? {}),
  };
  rolesByModel[normalizedModel] = nextFlags;
  nextStore.lobsterRolesByConfigId[configId] = rolesByModel;

  const selectedByRole = nextStore.selectedLobsterByConfigId[configId];
  if (selectedByRole) {
    const selectedModel = selectedByRole[role];
    if (selectedModel && selectedModel.toLowerCase() === normalizedModel.toLowerCase() && !enabled) {
      delete selectedByRole[role];
      if (Object.keys(selectedByRole).length === 0) {
        delete nextStore.selectedLobsterByConfigId[configId];
      }
    }
  }

  modelStore = ensureCliModelStore(nextStore);
  writeModelStore(modelStore);
  return true;
}

function addCliModel(cli: CliName, model: string, configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  const normalized = normalizeCliModelName(model);
  if (!normalized || !configId) {
    return null;
  }
  selectCliModel(cli, normalized, configId);
  return normalized;
}

function renameCliModel(cli: CliName, previousModel: string, nextModel: string, configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  const previousNormalized = normalizeCliModelName(previousModel);
  const nextNormalized = normalizeCliModelName(nextModel);
  if (!previousNormalized || !nextNormalized || !configId) {
    return null;
  }
  const previousKey = previousNormalized.toLowerCase();
  const nextKey = nextNormalized.toLowerCase();
  const nextStore = ensureCliModelStore(modelStore);
  const currentOptions = nextStore.optionsByConfigId[configId] ?? [];
  const duplicateExists = currentOptions.some((modelName) => {
    const normalized = normalizeCliModelName(modelName);
    if (!normalized) {
      return false;
    }
    const currentKey = normalized.toLowerCase();
    return currentKey === nextKey && currentKey !== previousKey;
  });
  if (duplicateExists) {
    return null;
  }

  const renamedOptions = currentOptions.map((modelName) => {
    const normalized = normalizeCliModelName(modelName);
    return normalized && normalized.toLowerCase() === previousKey ? nextNormalized : modelName;
  });
  nextStore.optionsByConfigId[configId] = mergeUniqueModelNames(renamedOptions);

  if (normalizeCliModelName(nextStore.selectedByConfigId[configId])?.toLowerCase() === previousKey) {
    nextStore.selectedByConfigId[configId] = nextNormalized;
  }

  const cliThinking = nextStore.thinkingByCliAndModel?.[cli];
  if (cliThinking) {
    const matchedThinkingKey = Object.keys(cliThinking).find((key) => key.toLowerCase() === previousKey);
    if (matchedThinkingKey) {
      const nextThinking = { ...cliThinking };
      nextThinking[nextNormalized] = nextThinking[matchedThinkingKey];
      nextStore.thinkingByCliAndModel[cli] = nextThinking;
    }
  }

  const rolesByModel = nextStore.lobsterRolesByConfigId[configId];
  if (rolesByModel) {
    const matchedRoleKey = Object.keys(rolesByModel).find((key) => key.toLowerCase() === previousKey);
    if (matchedRoleKey) {
      const nextRolesByModel = { ...rolesByModel };
      nextRolesByModel[nextNormalized] = normalizeLobsterModelRoleFlags(nextRolesByModel[matchedRoleKey]);
      delete nextRolesByModel[matchedRoleKey];
      nextStore.lobsterRolesByConfigId[configId] = nextRolesByModel;
    }
  }
  const selectedByRole = nextStore.selectedLobsterByConfigId[configId];
  if (selectedByRole) {
    const nextSelectedByRole: Partial<Record<LobsterTaskRole, string>> = { ...selectedByRole };
    let changed = false;
    (["main", "subtask"] as LobsterTaskRole[]).forEach((role) => {
      const roleModel = normalizeCliModelName(nextSelectedByRole[role]);
      if (roleModel && roleModel.toLowerCase() === previousKey) {
        nextSelectedByRole[role] = nextNormalized;
        changed = true;
      }
    });
    if (changed) {
      nextStore.selectedLobsterByConfigId[configId] = nextSelectedByRole;
    }
  }

  modelStore = ensureCliModelStore(nextStore);
  writeModelStore(modelStore);
  return nextNormalized;
}

function deleteCliModel(cli: CliName, model: string, configId: string | null = getActiveConfigIdForCli(cli)): void {
  const normalized = normalizeCliModelName(model);
  if (!normalized || !configId) {
    return;
  }
  const targetKey = normalized.toLowerCase();
  const nextStore = ensureCliModelStore(modelStore);
  const currentOptions = nextStore.optionsByConfigId[configId] ?? [];
  nextStore.optionsByConfigId[configId] = currentOptions.filter((modelName) => {
    const currentNormalized = normalizeCliModelName(modelName);
    return !(currentNormalized && currentNormalized.toLowerCase() === targetKey);
  });

  if (normalizeCliModelName(nextStore.selectedByConfigId[configId])?.toLowerCase() === targetKey) {
    delete nextStore.selectedByConfigId[configId];
  }

  const rolesByModel = nextStore.lobsterRolesByConfigId[configId];
  if (rolesByModel) {
    const nextRolesByModel = { ...rolesByModel };
    Object.keys(nextRolesByModel).forEach((key) => {
      if (key.toLowerCase() === targetKey) {
        delete nextRolesByModel[key];
      }
    });
    if (Object.keys(nextRolesByModel).length > 0) {
      nextStore.lobsterRolesByConfigId[configId] = nextRolesByModel;
    } else {
      delete nextStore.lobsterRolesByConfigId[configId];
    }
  }
  const selectedByRole = nextStore.selectedLobsterByConfigId[configId];
  if (selectedByRole) {
    const nextSelectedByRole: Partial<Record<LobsterTaskRole, string>> = { ...selectedByRole };
    (["main", "subtask"] as LobsterTaskRole[]).forEach((role) => {
      const roleModel = normalizeCliModelName(nextSelectedByRole[role]);
      if (roleModel && roleModel.toLowerCase() === targetKey) {
        delete nextSelectedByRole[role];
      }
    });
    if (Object.keys(nextSelectedByRole).length > 0) {
      nextStore.selectedLobsterByConfigId[configId] = nextSelectedByRole;
    } else {
      delete nextStore.selectedLobsterByConfigId[configId];
    }
  }

  modelStore = ensureCliModelStore(nextStore);
  writeModelStore(modelStore);
}

function moveCliModel(cli: CliName, model: string, direction: "up" | "down", configId: string | null = getActiveConfigIdForCli(cli)): string | null {
  const normalized = normalizeCliModelName(model);
  if (!normalized || !configId) {
    return null;
  }
  const targetKey = normalized.toLowerCase();
  const nextStore = ensureCliModelStore(modelStore);
  const currentOptions = [...(nextStore.optionsByConfigId[configId] ?? [])];
  const currentIndex = currentOptions.findIndex((modelName) => {
    const currentNormalized = normalizeCliModelName(modelName);
    return Boolean(currentNormalized && currentNormalized.toLowerCase() === targetKey);
  });
  if (currentIndex < 0) {
    return null;
  }
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= currentOptions.length) {
    return normalized;
  }
  const swapped = currentOptions[currentIndex];
  currentOptions[currentIndex] = currentOptions[nextIndex];
  currentOptions[nextIndex] = swapped;
  nextStore.optionsByConfigId[configId] = mergeUniqueModelNames(currentOptions);
  modelStore = ensureCliModelStore(nextStore);
  writeModelStore(modelStore);
  return normalized;
}

function getEffectiveCliArgs(cli: CliName, model: string | null = getSelectedCliModel(cli)): string[] {
  return applyModelArg(cli, getCliArgs(cli), model);
}

function buildModelState(
  activeConfigIdByCli: Partial<Record<CliName, string | null>> = {}
): PanelState["modelState"] {
  const selectedByCli = {} as Record<CliName, string | null>;
  const optionsByCli = {} as Record<CliName, string[]>;
  const managedByCli = {} as Record<CliName, string[]>;
  const selectedLobsterByCli = {} as Record<CliName, { main: string | null; subtask: string | null }>;
  const lobsterOptionsByCli = {} as Record<CliName, { main: string[]; subtask: string[] }>;
  const managedLobsterRolesByCli = {} as Record<CliName, Record<string, { main: boolean; subtask: boolean }>>;
  for (const cli of CLI_LIST) {
    const activeConfigId = activeConfigIdByCli[cli] ?? getActiveConfigIdForCli(cli);
    const managedModels = getManagedModelOptionsForCli(cli, activeConfigId);
    selectedByCli[cli] = getSelectedCliModel(cli, activeConfigId);
    optionsByCli[cli] = getModelOptionsForCli(cli, activeConfigId);
    managedByCli[cli] = managedModels;
    lobsterOptionsByCli[cli] = {
      main: getLobsterModelOptionsForCli(cli, "main", activeConfigId),
      subtask: getLobsterModelOptionsForCli(cli, "subtask", activeConfigId),
    };
    selectedLobsterByCli[cli] = {
      main: getSelectedLobsterCliModel(cli, "main", activeConfigId),
      subtask: getSelectedLobsterCliModel(cli, "subtask", activeConfigId),
    };
    managedLobsterRolesByCli[cli] = {};
    managedModels.forEach((modelName) => {
      managedLobsterRolesByCli[cli][modelName] = getCliModelLobsterRoleFlags(cli, modelName, activeConfigId);
    });
  }
  return {
    selectedByCli,
    optionsByCli,
    managedByCli,
    selectedLobsterByCli,
    lobsterOptionsByCli,
    managedLobsterRolesByCli,
  };
}

function loadWorkspaceSettings(): WorkspaceSettings {
  const filePath = getWorkspaceSettingsFilePath();
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const result: WorkspaceSettings = {};
    const thinkingMode = (parsed as WorkspaceSettings).thinkingMode;
    if (isThinkingMode(thinkingMode)) {
      result.thinkingMode = thinkingMode;
    }
    const currentCli = (parsed as WorkspaceSettings).currentCli;
    if (currentCli && isCliName(currentCli)) {
      result.currentCli = currentCli;
    }
    const interactiveModeByCli = (parsed as WorkspaceSettings).interactiveModeByCli;
    if (interactiveModeByCli && typeof interactiveModeByCli === "object") {
      const normalized: Partial<Record<CliName, InteractiveMode>> = {};
      CLI_LIST.forEach((cli) => {
        const mode = (interactiveModeByCli as Record<string, unknown>)[cli];
        if (isInteractiveMode(mode)) {
          normalized[cli] = mode;
        }
      });
      if (Object.keys(normalized).length > 0) {
        result.interactiveModeByCli = normalized;
      }
    }
    const codexMultiAgentEnabled = (parsed as WorkspaceSettings).codexMultiAgentEnabled;
    if (typeof codexMultiAgentEnabled === "boolean") {
      result.codexMultiAgentEnabled = codexMultiAgentEnabled;
    }
    const autoCompactContextAfterRun = (parsed as WorkspaceSettings).autoCompactContextAfterRun;
    if (typeof autoCompactContextAfterRun === "boolean") {
      result.autoCompactContextAfterRun = autoCompactContextAfterRun;
    } else {
      const autoCompactContextBeforeRun = (parsed as WorkspaceSettings).autoCompactContextBeforeRun;
      if (typeof autoCompactContextBeforeRun === "boolean") {
        result.autoCompactContextAfterRun = autoCompactContextBeforeRun;
      }
    }
    const lobsterMaxRounds = (parsed as WorkspaceSettings).lobsterMaxRounds;
    if (typeof lobsterMaxRounds === "number" || typeof lobsterMaxRounds === "string") {
      result.lobsterMaxRounds = normalizeLobsterMaxRounds(lobsterMaxRounds);
    }
    const lobsterAutoCloseSubtaskTabs = (parsed as WorkspaceSettings).lobsterAutoCloseSubtaskTabs;
    if (typeof lobsterAutoCloseSubtaskTabs === "boolean") {
      result.lobsterAutoCloseSubtaskTabs = lobsterAutoCloseSubtaskTabs;
    }
    const activeConfigIdByCli = (parsed as WorkspaceSettings).activeConfigIdByCli;
    if (activeConfigIdByCli && typeof activeConfigIdByCli === "object") {
      const normalized: Partial<Record<CliName, string>> = {};
      CLI_LIST.forEach((cli) => {
        const activeConfigId = (activeConfigIdByCli as Record<string, unknown>)[cli];
        if (typeof activeConfigId === "string" && activeConfigId.trim()) {
          normalized[cli] = activeConfigId;
        }
      });
      if (Object.keys(normalized).length > 0) {
        result.activeConfigIdByCli = normalized;
      }
    }
    const conversationTabs = (parsed as WorkspaceSettings).conversationTabs;
    if (conversationTabs && typeof conversationTabs === "object") {
      const record = conversationTabs as ConversationTabsState;
      const tabs = Array.isArray(record.tabs)
        ? record.tabs
          .map((tab) => sanitizeConversationTabRecord(tab))
          .filter((tab): tab is ConversationTabRecord => Boolean(tab))
        : [];
      if (tabs.length > 0) {
        const activeTabId = typeof record.activeTabId === "string" && tabs.some((tab) => tab.id === record.activeTabId)
          ? record.activeTabId
          : tabs[tabs.length - 1].id;
        result.conversationTabs = {
          activeTabId,
          tabs,
        };
      }
    }
    return result;
  } catch (error) {
    void logError("workspace-settings-read-error", { error: String(error) });
    return {};
  }
}

function saveWorkspaceSettings(next: WorkspaceSettings): void {
  const filePath = getWorkspaceSettingsFilePath();
  if (!filePath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  } catch (error) {
    void logError("workspace-settings-write-error", { error: String(error) });
  }
}

function getWorkspaceSettingsFilePath(): string | null {
  if (!activeWorkspaceKey) {
    return null;
  }
  return path.join(WORKSPACE_SETTINGS_DIR, `${activeWorkspaceKey}.json`);
}

function loadPromptHistoryStore(): PromptHistoryStore {
  const stored = readPromptHistoryFile();
  const normalized = ensurePromptHistoryStore(stored);
  writePromptHistoryFile(normalized);
  return normalized;
}

function ensurePromptHistoryStore(store?: PromptHistoryStore): PromptHistoryStore {
  const now = Date.now();
  const items = Array.isArray(store?.items) ? store?.items : [];
  const normalized = items
    .map((item) => normalizePromptHistoryItem(item))
    .filter((item): item is PromptHistoryItem => Boolean(item))
    .filter((item) => isTimestampWithinHistoryRetention(item.createdAt, now));
  normalized.sort((a, b) => b.createdAt - a.createdAt);
  if (normalized.length > PROMPT_HISTORY_LIMIT) {
    normalized.length = PROMPT_HISTORY_LIMIT;
  }
  return { items: normalized };
}

function normalizePromptHistoryItem(item: unknown): PromptHistoryItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const record = item as PromptHistoryItem;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt) {
    return null;
  }
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
  const cli = isCliName(record.cli) ? record.cli : currentCli;
  const id = typeof record.id === "string" && record.id.trim()
    ? record.id
    : createPromptHistoryId(createdAt);
  return {
    id,
    prompt,
    createdAt,
    cli,
  };
}

function createPromptHistoryId(timestamp?: number): string {
  const base = typeof timestamp === "number" ? timestamp : Date.now();
  return `prompt_${base}_${Math.random().toString(16).slice(2)}`;
}

function buildPromptHistoryState(): PromptHistoryItem[] {
  return promptHistoryStore?.items ? [...promptHistoryStore.items] : [];
}

function recordPromptHistory(prompt: string, cli: CliName): void {
  const normalized = String(prompt ?? "").trim();
  if (!normalized) {
    return;
  }
  if (!promptHistoryStore) {
    promptHistoryStore = loadPromptHistoryStore();
  } else {
    promptHistoryStore = ensurePromptHistoryStore(promptHistoryStore);
  }
  promptHistoryStore.items.unshift({
    id: createPromptHistoryId(),
    prompt: normalized,
    createdAt: Date.now(),
    cli,
  });
  if (promptHistoryStore.items.length > PROMPT_HISTORY_LIMIT) {
    promptHistoryStore.items = promptHistoryStore.items.slice(0, PROMPT_HISTORY_LIMIT);
  }
  writePromptHistoryFile(promptHistoryStore);
}

function clearPromptHistory(): void {
  if (!promptHistoryStore) {
    promptHistoryStore = loadPromptHistoryStore();
  }
  promptHistoryStore.items = [];
  writePromptHistoryFile(promptHistoryStore);
  void logInfo("prompt-history-cleared", { workspace: activeWorkspaceKey });
}

function getPromptHistoryFilePath(workspaceKey: string = activeWorkspaceKey): string {
  if (workspaceKey === WORKSPACE_KEY_FALLBACK) {
    return LEGACY_PROMPT_HISTORY_FILE;
  }
  return path.join(PROMPT_HISTORY_DIR, `${workspaceKey}.json`);
}

function readPromptHistoryFile(workspaceKey: string = activeWorkspaceKey): PromptHistoryStore | undefined {
  try {
    const filePath = getPromptHistoryFilePath(workspaceKey);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as PromptHistoryStore;
  } catch (error) {
    void logError("prompt-history-read-error", { error: String(error) });
    return undefined;
  }
}

function writePromptHistoryFile(store: PromptHistoryStore, workspaceKey: string = activeWorkspaceKey): void {
  try {
    const filePath = getPromptHistoryFilePath(workspaceKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    void logError("prompt-history-write-error", { error: String(error) });
  }
}

function deletePromptHistoryFile(workspaceKey: string): void {
  try {
    const filePath = getPromptHistoryFilePath(workspaceKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    void logError("prompt-history-delete-error", {
      workspace: workspaceKey,
      error: String(error),
    });
  }
}

function cleanupPromptHistoryRetentionAcrossWorkspaces(): void {
  const workspaceKeys = collectWorkspaceKeysForPromptHistoryCleanup();
  workspaceKeys.forEach((workspaceKey) => {
    const normalized = ensurePromptHistoryStore(readPromptHistoryFile(workspaceKey));
    if (normalized.items.length > 0) {
      writePromptHistoryFile(normalized, workspaceKey);
      return;
    }
    deletePromptHistoryFile(workspaceKey);
  });
}

function collectWorkspaceKeysForPromptHistoryCleanup(): string[] {
  const workspaceKeys = new Set<string>();
  if (fs.existsSync(LEGACY_PROMPT_HISTORY_FILE)) {
    workspaceKeys.add(WORKSPACE_KEY_FALLBACK);
  }
  if (fs.existsSync(PROMPT_HISTORY_DIR)) {
    for (const entry of fs.readdirSync(PROMPT_HISTORY_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      workspaceKeys.add(entry.name.slice(0, -".json".length));
    }
  }
  return Array.from(workspaceKeys);
}

function loadSessionStore(): SessionStore {
  const stored = readSessionFile() ?? extensionContext.globalState.get<SessionStore>(getSessionStoreKey());
  const normalized = ensureSessionStore(stored);
  cleanupStaleSessionArtifacts(stored, normalized);
  void persistSessionStore(normalized);
  return normalized;
}

function ensureSessionStore(store?: SessionStore): SessionStore {
  const now = Date.now();
  const result = {
    codex: { currentId: null, sessions: [] },
    claude: { currentId: null, sessions: [] },
    gemini: { currentId: null, sessions: [] },
  } as SessionStore;

  if (!store) {
    return result;
  }

  for (const cli of CLI_LIST) {
    const current = store[cli];
    if (current) {
      const sessions = Array.isArray(current.sessions)
        ? current.sessions
            .map((session) => {
              const firstPrompt = typeof session.firstPrompt === "string" && session.firstPrompt.trim()
                ? session.firstPrompt
                : undefined;
              const fallbackLabel = buildSessionLabelFromPrompt(firstPrompt);
              const normalizedLabel = typeof session.label === "string" ? session.label.trim() : "";
              const label = shouldUseFallbackSessionLabel(normalizedLabel)
                ? (fallbackLabel ?? t("session.unnamed"))
                : normalizedLabel;
              return {
                id: session.id,
                label,
                createdAt: session.createdAt ?? Date.now(),
                lastUsedAt: session.lastUsedAt ?? Date.now(),
                firstPrompt,
              };
            })
            .filter((session) => isSessionRecordWithinRetention(session, now))
        : [];
      result[cli] = {
        currentId: current.currentId ?? null,
        sessions,
      };
      if (
        result[cli].currentId
        && !sessions.some((session) => session.id === result[cli].currentId)
      ) {
        result[cli].currentId = getLatestSessionIdFromRecords(sessions);
      }
    }
  }
  return result;
}

function isSessionRecordWithinRetention(session: SessionRecord, now: number = Date.now()): boolean {
  const referenceTime = Number.isFinite(session.lastUsedAt) ? session.lastUsedAt : session.createdAt;
  return isTimestampWithinHistoryRetention(referenceTime, now);
}

function getLatestSessionIdFromRecords(sessions: SessionRecord[]): string | null {
  if (sessions.length === 0) {
    return null;
  }
  const latest = sessions.reduce((prev, current) =>
    current.lastUsedAt > prev.lastUsedAt ? current : prev
  );
  return latest.id;
}

function cleanupStaleSessionArtifacts(
  sourceStore: SessionStore | undefined,
  retainedStore: SessionStore,
  workspaceKey: string = activeWorkspaceKey
): void {
  const staleSessionIds = collectStaleSessionIds(sourceStore, retainedStore);

  for (const cli of CLI_LIST) {
    for (const sessionId of staleSessionIds[cli]) {
      const key = getSessionKey(cli, sessionId, workspaceKey);
      sessionMessageCache.delete(key);
      sessionMessageLoadErrors.delete(key);
      try {
        const filePath = getMessageFile(cli, sessionId, workspaceKey);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        void logError("session-messages-retention-delete-error", {
          cli,
          sessionId,
          error: String(error),
        });
      }
    }
  }

  const meta = readSessionMetaStore(workspaceKey);
  if (pruneStaleSessionMetaMappings(meta, retainedStore)) {
    if (isSessionMetaStoreEmpty(meta)) {
      deleteSessionMetaStoreFile(workspaceKey);
    } else {
      writeSessionMetaStore(meta, workspaceKey);
    }
  }

  const removedCount = CLI_LIST.reduce((total, cli) => total + staleSessionIds[cli].length, 0);
  if (removedCount > 0) {
    void logInfo("session-history-retention-pruned", {
      workspace: workspaceKey,
      retentionDays: HISTORY_RETENTION_DAYS,
      removedCount,
      removedByCli: staleSessionIds,
    });
  }
}

function isSessionMetaStoreEmpty(meta: ReturnType<typeof readSessionMeta>): boolean {
  return !meta.byCli || Object.keys(meta.byCli).length === 0;
}

function deleteSessionMetaStoreFile(workspaceKey: string): void {
  try {
    const filePath = getSessionMetaFilePath(workspaceKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    void logError("session-meta-delete-error", {
      workspace: workspaceKey,
      error: String(error),
    });
  }
}

function isSessionStoreEmpty(store: SessionStore): boolean {
  return CLI_LIST.every((cli) => {
    const bucket = store[cli];
    return !bucket?.currentId && (!bucket?.sessions || bucket.sessions.length === 0);
  });
}

function cleanupWorkspaceMessageFiles(workspaceKey: string, retainedStore: SessionStore): void {
  const messageDir = getMessageDir(workspaceKey);
  if (!fs.existsSync(messageDir)) {
    return;
  }
  for (const cli of CLI_LIST) {
    const cliDir = path.join(messageDir, cli);
    if (!fs.existsSync(cliDir)) {
      continue;
    }
    const retainedIds = new Set((retainedStore[cli]?.sessions ?? []).map((session) => session.id));
    for (const entry of fs.readdirSync(cliDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const sessionId = entry.name.slice(0, -".json".length);
      if (retainedIds.has(sessionId)) {
        continue;
      }
      try {
        fs.unlinkSync(path.join(cliDir, entry.name));
      } catch (error) {
        void logError("session-message-orphan-delete-error", {
          workspace: workspaceKey,
          cli,
          sessionId,
          error: String(error),
        });
      }
    }
    if (fs.existsSync(cliDir) && fs.readdirSync(cliDir).length === 0) {
      fs.rmSync(cliDir, { recursive: true, force: true });
    }
  }
  if (workspaceKey !== WORKSPACE_KEY_FALLBACK && fs.existsSync(messageDir) && fs.readdirSync(messageDir).length === 0) {
    fs.rmSync(messageDir, { recursive: true, force: true });
  }
}

async function cleanupSessionRetentionAcrossWorkspaces(): Promise<void> {
  const workspaceKeys = collectWorkspaceKeysForSessionCleanup();
  for (const workspaceKey of workspaceKeys) {
    const sourceStore = readSessionFile(workspaceKey)
      ?? extensionContext.globalState.get<SessionStore>(getSessionStoreKey(workspaceKey));
    const normalized = ensureSessionStore(sourceStore);
    cleanupStaleSessionArtifacts(sourceStore, normalized, workspaceKey);
    cleanupWorkspaceMessageFiles(workspaceKey, normalized);
    if (isSessionStoreEmpty(normalized)) {
      deleteSessionFile(workspaceKey);
      await extensionContext.globalState.update(getSessionStoreKey(workspaceKey), undefined);
    } else {
      writeSessionFile(normalized, workspaceKey);
      await extensionContext.globalState.update(getSessionStoreKey(workspaceKey), normalized);
    }
  }
}

function collectWorkspaceKeysForSessionCleanup(): string[] {
  const workspaceKeys = new Set<string>();
  if (fs.existsSync(LEGACY_SESSION_FILE)) {
    workspaceKeys.add(WORKSPACE_KEY_FALLBACK);
  }
  if (fs.existsSync(SESSION_DIR)) {
    for (const entry of fs.readdirSync(SESSION_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name.endsWith(".meta.json")) {
        workspaceKeys.add(entry.name.slice(0, -".meta.json".length));
        continue;
      }
      if (entry.name.endsWith(".json")) {
        workspaceKeys.add(entry.name.slice(0, -".json".length));
      }
    }
  }
  if (fs.existsSync(MESSAGE_DIR_ROOT)) {
    for (const entry of fs.readdirSync(MESSAGE_DIR_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (CLI_LIST.includes(entry.name as CliName)) {
        workspaceKeys.add(WORKSPACE_KEY_FALLBACK);
        continue;
      }
      workspaceKeys.add(entry.name);
    }
  }
  const prefix = `${SESSION_STORE_KEY}:`;
  for (const key of extensionContext.globalState.keys()) {
    if (key.startsWith(prefix)) {
      workspaceKeys.add(key.slice(prefix.length));
    }
  }
  return Array.from(workspaceKeys);
}

function collectStaleSessionIds(
  sourceStore: SessionStore | undefined,
  retainedStore: SessionStore
): Record<CliName, string[]> {
  const removed: Record<CliName, string[]> = {
    codex: [],
    claude: [],
    gemini: [],
  };

  if (!sourceStore) {
    return removed;
  }

  for (const cli of CLI_LIST) {
    const retainedIds = new Set((retainedStore[cli]?.sessions ?? []).map((session) => session.id));
    const sourceIds = Array.isArray(sourceStore[cli]?.sessions)
      ? sourceStore[cli].sessions.map((session) => session.id)
      : [];
    removed[cli] = sourceIds.filter((sessionId) => !retainedIds.has(sessionId));
  }

  return removed;
}

function pruneStaleSessionMetaMappings(
  meta: ReturnType<typeof readSessionMeta>,
  retainedStore: SessionStore
): boolean {
  let changed = false;
  const retainedIds = {
    codex: new Set((retainedStore.codex?.sessions ?? []).map((session) => session.id)),
    claude: new Set((retainedStore.claude?.sessions ?? []).map((session) => session.id)),
  };

  if (meta.byCli?.codex) {
    Object.keys(meta.byCli.codex).forEach((sessionId) => {
      if (!retainedIds.codex.has(sessionId)) {
        delete meta.byCli?.codex?.[sessionId];
        changed = true;
      }
    });
    if (Object.keys(meta.byCli.codex).length === 0) {
      delete meta.byCli.codex;
      changed = true;
    }
  }

  if (meta.byCli?.claude) {
    Object.keys(meta.byCli.claude).forEach((sessionId) => {
      if (!retainedIds.claude.has(sessionId)) {
        delete meta.byCli?.claude?.[sessionId];
        changed = true;
      }
    });
    if (Object.keys(meta.byCli.claude).length === 0) {
      delete meta.byCli.claude;
      changed = true;
    }
  }

  if (meta.byCli && Object.keys(meta.byCli).length === 0) {
    delete meta.byCli;
    changed = true;
  }

  return changed;
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

function buildConversationTabSessionLookupKey(cli: CliName, sessionId: string): string {
  return `${cli}:${sessionId}`;
}

function buildOpenConversationTabSessionMap(): Map<string, string> {
  const state = ensureConversationTabs();
  const sessionMap = new Map<string, string>();
  state.tabs.forEach((tab) => {
    const sessionId = getConversationTabSessionIdForCli(tab, tab.cli);
    if (!sessionId) {
      return;
    }
    sessionMap.set(buildConversationTabSessionLookupKey(tab.cli, sessionId), tab.id);
  });
  return sessionMap;
}

function buildConversationTabsState(): {
  activeTabId: string | null;
  tabs: ConversationTabSummary[];
} {
  const state = ensureConversationTabs();
  const runningLobsterTaskIds = collectRunningLobsterTaskIds();
  return {
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => {
      const lobsterContext = resolveConversationTabLobsterContext(tab);
      const lobsterTaskId = lobsterContext.lobsterTaskId;
      const lobsterMainTabCloseLocked = (
        lobsterContext.taskRole === "main"
        && typeof lobsterTaskId === "string"
        && runningLobsterTaskIds.has(lobsterTaskId)
      );
      return {
        id: tab.id,
        cli: tab.cli,
        sessionId: tab.sessionId,
        createdAt: tab.createdAt,
        lobsterTaskRole: lobsterContext.taskRole ?? undefined,
        lobsterTaskId: lobsterTaskId ?? undefined,
        lobsterMainTabCloseLocked,
      };
    }),
  };
}

function initializeConversationTabsFromWorkspaceSettings(): void {
  const normalized = normalizeConversationTabsState(workspaceSettings.conversationTabs);
  conversationTabStore.activeTabId = normalized.activeTabId;
  conversationTabStore.tabs = normalized.tabs;
  persistConversationTabsToWorkspaceSettings();
}

function normalizeConversationTabsState(
  value?: ConversationTabsState
): ConversationTabsState {
  const now = Date.now();
  const records = Array.isArray(value?.tabs)
    ? value.tabs
      .map((tab) => sanitizeConversationTabRecord(tab))
      .filter((tab): tab is ConversationTabRecord => Boolean(tab))
    : [];
  const fallbackCli = isCliName(currentCli) ? currentCli : getDefaultCli();
  const tabs = records.length > 0
    ? records
    : [{
        id: createConversationTabId(),
        cli: fallbackCli,
        sessionId: getLatestSessionId(fallbackCli),
        sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, fallbackCli, getLatestSessionId(fallbackCli)),
        createdAt: now,
      }];
  const tabIds = new Set(tabs.map((tab) => tab.id));
  const activeTabId = value?.activeTabId && tabIds.has(value.activeTabId)
    ? value.activeTabId
    : tabs[tabs.length - 1].id;
  return {
    activeTabId,
    tabs: tabs.map((tab) => {
      const sessionIdByCli = retainExistingConversationTabSessionIdMap(
        sanitizeConversationTabSessionIdMap(tab.sessionIdByCli, tab.cli, tab.sessionId)
      );
      return {
        id: tab.id,
        cli: tab.cli,
        sessionId: sessionIdByCli[tab.cli] ?? null,
        sessionIdByCli,
        createdAt: tab.createdAt,
      };
    }),
  };
}

function sanitizeConversationTabRecord(value: unknown): ConversationTabRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as ConversationTabRecord;
  const id = typeof record.id === "string" && record.id.trim()
    ? record.id
    : createConversationTabId();
  const fallbackCli = isCliName(currentCli) ? currentCli : getDefaultCli();
  const cli = isCliName((record as { cli?: unknown }).cli as string)
    ? ((record as { cli: CliName }).cli)
    : fallbackCli;
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
  const sessionId = typeof record.sessionId === "string" && record.sessionId.trim()
    ? record.sessionId
    : null;
  const sessionIdByCli = retainExistingConversationTabSessionIdMap(
    sanitizeConversationTabSessionIdMap(
      (record as { sessionIdByCli?: unknown }).sessionIdByCli,
      cli,
      sessionId,
    )
  );
  return {
    id,
    cli,
    sessionId: sessionIdByCli[cli] ?? null,
    sessionIdByCli,
    createdAt,
  };
}

function retainExistingConversationTabSessionIdMap(
  value: Partial<Record<CliName, string>>,
): Partial<Record<CliName, string>> {
  if (!sessionStore) {
    return { ...value };
  }
  const retained: Partial<Record<CliName, string>> = {};
  for (const cli of CLI_LIST) {
    const sessionId = value[cli];
    if (typeof sessionId === "string" && hasSessionRecord(cli, sessionId)) {
      retained[cli] = sessionId;
    }
  }
  return retained;
}

function sanitizeConversationTabSessionIdMap(
  value: unknown,
  cli: CliName,
  sessionId: string | null,
): Partial<Record<CliName, string>> {
  const normalized: Partial<Record<CliName, string>> = {};
  if (value && typeof value === "object") {
    for (const item of CLI_LIST) {
      const candidate = (value as Partial<Record<CliName, unknown>>)[item];
      if (typeof candidate === "string" && candidate.trim()) {
        normalized[item] = candidate;
      }
    }
  }
  if (sessionId) {
    normalized[cli] = sessionId;
  } else {
    delete normalized[cli];
  }
  return normalized;
}

function getConversationTabSessionIdForCli(tab: ConversationTabRecord, cli: CliName): string | null {
  const sessionId = tab.sessionIdByCli?.[cli];
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

function hasSessionRecord(cli: CliName, sessionId: string): boolean {
  if (!sessionStore) {
    return false;
  }
  return sessionStore[cli]?.sessions.some((session) => session.id === sessionId) ?? false;
}

function setConversationTabSessionIdForCli(
  tab: ConversationTabRecord,
  cli: CliName,
  sessionId: string | null,
): boolean {
  const normalizedSessionId = typeof sessionId === "string" && sessionId.trim()
    ? sessionId
    : null;
  const previousSessionId = getConversationTabSessionIdForCli(tab, cli);
  let changed = previousSessionId !== normalizedSessionId;
  if (normalizedSessionId) {
    tab.sessionIdByCli[cli] = normalizedSessionId;
  } else if (tab.sessionIdByCli[cli]) {
    delete tab.sessionIdByCli[cli];
  }
  if (tab.cli === cli && tab.sessionId !== normalizedSessionId) {
    tab.sessionId = normalizedSessionId;
    changed = true;
  }
  return changed;
}

function switchConversationTabCli(tab: ConversationTabRecord, cli: CliName): boolean {
  const nextSessionId = getConversationTabSessionIdForCli(tab, cli);
  const cliChanged = tab.cli !== cli;
  const sessionChanged = tab.sessionId !== nextSessionId;
  if (!cliChanged && !sessionChanged) {
    return false;
  }
  tab.cli = cli;
  tab.sessionId = nextSessionId;
  return true;
}

function ensureConversationTabs(): ConversationTabsState {
  if (Array.isArray(conversationTabStore.tabs) && conversationTabStore.tabs.length > 0) {
    if (
      !conversationTabStore.activeTabId
      || !conversationTabStore.tabs.some((tab) => tab.id === conversationTabStore.activeTabId)
    ) {
      conversationTabStore.activeTabId = conversationTabStore.tabs[conversationTabStore.tabs.length - 1].id;
      persistConversationTabsToWorkspaceSettings();
    }
    return conversationTabStore;
  }
  const fallbackCli = isCliName(currentCli) ? currentCli : getDefaultCli();
  const fallbackTab: ConversationTabRecord = {
    id: createConversationTabId(),
    cli: fallbackCli,
    sessionId: getLatestSessionId(fallbackCli),
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, fallbackCli, getLatestSessionId(fallbackCli)),
    createdAt: Date.now(),
  };
  conversationTabStore.tabs = [fallbackTab];
  conversationTabStore.activeTabId = fallbackTab.id;
  persistConversationTabsToWorkspaceSettings();
  return conversationTabStore;
}

function persistConversationTabsToWorkspaceSettings(): void {
  const state = ensureConversationTabs();
  workspaceSettings.conversationTabs = {
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      cli: tab.cli,
      sessionId: tab.sessionId,
      sessionIdByCli: sanitizeConversationTabSessionIdMap(tab.sessionIdByCli, tab.cli, tab.sessionId),
      createdAt: tab.createdAt,
    })),
  };
  saveWorkspaceSettings(workspaceSettings);
}

function getConversationTabById(tabId: string): ConversationTabRecord | null {
  const state = ensureConversationTabs();
  const tab = state.tabs.find((item) => item.id === tabId);
  return tab ?? null;
}

function getActiveConversationTabId(): string | null {
  const state = ensureConversationTabs();
  return state.activeTabId;
}

function getActiveConversationTab(): ConversationTabRecord | null {
  const state = ensureConversationTabs();
  if (!state.activeTabId) {
    return null;
  }
  return state.tabs.find((item) => item.id === state.activeTabId) ?? null;
}

function getActiveConversationSessionId(cli: CliName): string | null {
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    return null;
  }
  return getConversationTabSessionIdForCli(activeTab, cli);
}

function findConversationTabIdBySession(cli: CliName, sessionId: string): string | null {
  const state = ensureConversationTabs();
  const matched = state.tabs.find((tab) => tab.cli === cli && tab.sessionId === sessionId);
  return matched ? matched.id : null;
}

function updateActiveConversationTabSession(cli: CliName, sessionId: string | null): void {
  const tab = getActiveConversationTab();
  if (!tab) {
    return;
  }
  const changed = setConversationTabSessionIdForCli(tab, cli, sessionId);
  if (!changed) {
    return;
  }
  persistConversationTabsToWorkspaceSettings();
}

function setActiveConversationTab(tabId: string): { cli: CliName; sessionId: string | null } | null {
  const state = ensureConversationTabs();
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) {
    return null;
  }
  const tabSessionId = getConversationTabSessionIdForCli(tab, tab.cli);
  if (tab.sessionId !== tabSessionId) {
    tab.sessionId = tabSessionId;
  }
  if (state.activeTabId !== tabId) {
    state.activeTabId = tabId;
    persistConversationTabsToWorkspaceSettings();
  }
  setWorkspaceInteractiveModeForCli(tab.cli, resolveAutoInteractiveModeForConversationTab(tab));
  setCurrentSession(tab.cli, tabSessionId, { syncConversationTab: false });
  return {
    cli: tab.cli,
    sessionId: tabSessionId,
  };
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

function createLobsterSubtaskRunTarget(cli: CliName): PromptRunTarget {
  const state = ensureConversationTabs();
  const tab: ConversationTabRecord = {
    id: createConversationTabId(),
    cli,
    sessionId: null,
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, cli, null),
    createdAt: Date.now(),
  };
  state.tabs.push(tab);
  persistConversationTabsToWorkspaceSettings();
  void logInfo("lobster-subtask-session-created", { cli, tabId: tab.id });
  void postPanelState();
  return {
    tabId: tab.id,
    cli,
    sessionId: null,
  };
}

function addConversationTab(
  cli: CliName,
  sessionId: string | null,
  options: { skipPersist?: boolean } = {}
): string | null {
  const state = ensureConversationTabs();
  const tab: ConversationTabRecord = {
    id: createConversationTabId(),
    cli,
    sessionId,
    sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, cli, sessionId),
    createdAt: Date.now(),
  };
  state.tabs.push(tab);
  state.activeTabId = tab.id;
  if (!options.skipPersist) {
    persistConversationTabsToWorkspaceSettings();
  }
  setCurrentSession(cli, sessionId, { syncConversationTab: false });
  return sessionId;
}

function closeConversationTab(tabId: string): { cli: CliName; sessionId: string | null } | null {
  const state = ensureConversationTabs();
  if (state.tabs.length <= 1) {
    const active = getActiveConversationTab();
    return active ? { cli: active.cli, sessionId: active.sessionId } : null;
  }
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) {
    const active = getActiveConversationTab();
    return active ? { cli: active.cli, sessionId: active.sessionId } : null;
  }
  clearPendingSessionDraft(tabId);
  state.tabs.splice(index, 1);
  if (!state.activeTabId || state.activeTabId === tabId) {
    const fallbackIndex = index > 0 ? index - 1 : 0;
    state.activeTabId = state.tabs[fallbackIndex]?.id ?? state.tabs[0].id;
  }
  persistConversationTabsToWorkspaceSettings();
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    return null;
  }
  setCurrentSession(activeTab.cli, activeTab.sessionId, { syncConversationTab: false });
  return {
    cli: activeTab.cli,
    sessionId: activeTab.sessionId,
  };
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
  const state = ensureConversationTabs();
  let changed = false;
  state.tabs.forEach((tab) => {
    if (getConversationTabSessionIdForCli(tab, cli) === sessionId) {
      changed = setConversationTabSessionIdForCli(tab, cli, null) || changed;
      clearPendingSessionDraft(tab.id, cli);
    }
  });
  if (changed) {
    persistConversationTabsToWorkspaceSettings();
  }
}

function syncCurrentSessionWithActiveTab(preferredCli?: CliName): string | null {
  const activeTab = getActiveConversationTab();
  if (!activeTab) {
    const cli = preferredCli ?? currentCli;
    setCurrentSession(cli, null, { syncConversationTab: false });
    return null;
  }
  if (currentCli !== activeTab.cli) {
    currentCli = activeTab.cli;
    updateStatusBar();
    workspaceSettings.currentCli = currentCli;
    saveWorkspaceSettings(workspaceSettings);
  }
  const sessionId = getConversationTabSessionIdForCli(activeTab, activeTab.cli);
  if (activeTab.sessionId !== sessionId) {
    activeTab.sessionId = sessionId;
  }
  setCurrentSession(activeTab.cli, sessionId, { syncConversationTab: false });
  return sessionId;
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
  if (!activeTab) {
    return;
  }
  let changed = false;
  if (activeTab.cli !== cli) {
    changed = switchConversationTabCli(activeTab, cli) || changed;
  }
  changed = setConversationTabSessionIdForCli(activeTab, cli, null) || changed;
  if (changed) {
    persistConversationTabsToWorkspaceSettings();
  }
  clearPendingSessionDraft(activeTab.id, cli);
  updatePendingSessionDraft(activeTab.id, { messages: [] }, cli);
  setCurrentSession(cli, null);
  void logInfo("session-new", { cli, tabId: activeTab.id });
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
  writeSessionFile(nextStore);
}

function updateSessionBuffer(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  if (next.length <= SESSION_BUFFER_LIMIT) {
    return next;
  }
  return next.slice(next.length - SESSION_BUFFER_LIMIT);
}

function createLocalSessionId(): string {
  return `${LOCAL_SESSION_PREFIX}${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createConversationTabId(): string {
  return `${CONVERSATION_TAB_PREFIX}${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function resolvePendingSessionDraftCli(tabId: string, cli?: CliName): CliName {
  if (cli) {
    return cli;
  }
  const tab = getConversationTabById(tabId);
  if (tab) {
    return tab.cli;
  }
  return currentCli;
}

function getPendingSessionDraftKey(tabId: string, cli: CliName): string {
  return `${tabId}::${cli}`;
}

function getPendingSessionDraft(tabId: string, cli?: CliName): PendingSessionDraft {
  const resolvedCli = resolvePendingSessionDraftCli(tabId, cli);
  const draftKey = getPendingSessionDraftKey(tabId, resolvedCli);
  if (!pendingSessionDrafts[draftKey]) {
    pendingSessionDrafts[draftKey] = {
      label: null,
      firstPrompt: null,
      messages: [],
    };
  }
  return pendingSessionDrafts[draftKey];
}

function updatePendingSessionDraft(
  tabId: string,
  patch: Partial<PendingSessionDraft>,
  cli?: CliName,
): PendingSessionDraft {
  const draft = getPendingSessionDraft(tabId, cli);
  if (patch.label !== undefined) {
    draft.label = patch.label;
  }
  if (patch.firstPrompt !== undefined) {
    draft.firstPrompt = patch.firstPrompt;
  }
  if (patch.messages !== undefined) {
    draft.messages = patch.messages;
  }
  return draft;
}

function clearPendingSessionDraft(tabId: string, cli?: CliName): void {
  if (cli) {
    delete pendingSessionDrafts[getPendingSessionDraftKey(tabId, cli)];
    return;
  }
  const prefix = `${tabId}::`;
  Object.keys(pendingSessionDrafts).forEach((key) => {
    if (key === tabId || key.startsWith(prefix)) {
      delete pendingSessionDrafts[key];
    }
  });
}

function ensureLocalSession(cli: CliName, tabId: string): void {
  if (getCurrentSessionId(cli)) {
    return;
  }
  const draft = getPendingSessionDraft(tabId, cli);
  if (!draft.messages.length) {
    return;
  }
  adoptSessionId(cli, createLocalSessionId(), tabId);
}

function preparePendingLabel(cli: CliName, tabId: string, prompt: string): void {
  if (getCurrentSessionId(cli)) {
    return;
  }
  const draft = getPendingSessionDraft(tabId, cli);
  if (!draft.firstPrompt) {
    const normalizedPrompt = String(prompt ?? "").trim();
    if (normalizedPrompt) {
      draft.firstPrompt = normalizedPrompt;
    }
  }
  if (draft.label) {
    return;
  }
  const label = buildSessionLabelFromPrompt(prompt);
  if (!label) {
    return;
  }
  draft.label = label;
}

function assignPendingLabel(cli: CliName, tabId: string, sessionId: string): void {
  const draft = getPendingSessionDraft(tabId, cli);
  const label = draft.label;
  const firstPrompt = draft.firstPrompt;
  if (!label) {
    if (firstPrompt) {
      const sessions = sessionStore[cli].sessions;
      const existing = sessions.find((item) => item.id === sessionId);
      if (existing && !existing.firstPrompt) {
        existing.firstPrompt = firstPrompt;
        void persistSessionStore(sessionStore);
        void postPanelState();
      }
    }
    draft.firstPrompt = null;
    return;
  }
  const sessions = sessionStore[cli].sessions;
  const existing = sessions.find((item) => item.id === sessionId);
  if (existing && shouldUseFallbackSessionLabel(existing.label)) {
    existing.label = label;
  }
  if (existing && firstPrompt && !existing.firstPrompt) {
    existing.firstPrompt = firstPrompt;
  }
  draft.label = null;
  draft.firstPrompt = null;
  void persistSessionStore(sessionStore);
  void postPanelState();
}

function appendMessageToStore(target: ChatMessage[], message: ChatMessage): void {
  if (typeof message.sequence !== "number") {
    message.sequence = getNextMessageSequence(target);
  }
  target.push(message);
}

function getNextMessageSequence(messages: ChatMessage[]): number {
  if (!messages.length) {
    return 0;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const current = messages[i];
    if (typeof current.sequence === "number") {
      return current.sequence + 1;
    }
  }
  return messages.length;
}

function appendAssistantChunkToStore(chunk: string, kind?: ChatMessage["kind"]): void {
  if (!activeMessageTarget || activeMessageIndex === null) {
    return;
  }
  const message = activeMessageTarget[activeMessageIndex];
  if (!message || message.role !== "assistant") {
    return;
  }
  if (kind === "thinking") {
    message.kind = "thinking";
  }
  message.content += chunk;
}

function getActiveAssistantContent(): string | null {
  if (!activeMessageTarget || activeMessageIndex === null) {
    return null;
  }
  const message = activeMessageTarget[activeMessageIndex];
  if (!message || message.role !== "assistant") {
    return null;
  }
  const content = message.content ?? "";
  return content.trim() ? content : null;
}

function persistActiveMessages(): void {
  if (!activeCliForRun || !activeMessageTarget) {
    return;
  }
  if (!activeSessionId) {
    if (!activeTabIdForRun) {
      return;
    }
    updatePendingSessionDraft(activeTabIdForRun, { messages: activeMessageTarget }, activeCliForRun);
    ensureLocalSession(activeCliForRun, activeTabIdForRun);
    return;
  }
  saveSessionMessages(activeCliForRun, activeSessionId, activeMessageTarget);
}

function attachPendingMessages(cli: CliName, tabId: string, sessionId: string): void {
  const draft = getPendingSessionDraft(tabId, cli);
  const pending = draft.messages;
  if (!pending || pending.length === 0) {
    return;
  }
  const existing = loadSessionMessages(cli, sessionId);
  const merged = [...existing, ...pending];
  draft.messages = [];
  saveSessionMessages(cli, sessionId, merged);
  if (activeCliForRun === cli && activeTabIdForRun === tabId && activeSessionId === null) {
    activeSessionId = sessionId;
    activeMessageTarget = merged;
    activeMessageIndex = merged.length - 1;
  }
}

function getSessionStoreKey(workspaceKey: string = activeWorkspaceKey): string {
  return `${SESSION_STORE_KEY}:${workspaceKey}`;
}

function getSessionFilePath(workspaceKey: string = activeWorkspaceKey): string {
  if (workspaceKey === WORKSPACE_KEY_FALLBACK) {
    return LEGACY_SESSION_FILE;
  }
  return path.join(SESSION_DIR, `${workspaceKey}.json`);
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

function getSessionRecord(cli: CliName, sessionId: string): SessionRecord | null {
  const sessions = sessionStore[cli]?.sessions ?? [];
  return sessions.find((session) => session.id === sessionId) ?? null;
}

function replaceConversationTabSessionReferences(
  cli: CliName,
  fromSessionId: string,
  toSessionId: string,
): void {
  const state = ensureConversationTabs();
  let changed = false;
  state.tabs.forEach((tab) => {
    if (getConversationTabSessionIdForCli(tab, cli) === fromSessionId) {
      changed = setConversationTabSessionIdForCli(tab, cli, toSessionId) || changed;
    }
  });
  if (changed) {
    persistConversationTabsToWorkspaceSettings();
  }
}

function replaceRuntimeSessionReferences(cli: CliName, fromSessionId: string, toSessionId: string): void {
  if (activeCliForRun === cli && activeSessionId === fromSessionId) {
    activeSessionId = toSessionId;
    activeMessageTarget = loadSessionMessages(cli, toSessionId);
    activeMessageIndex = activeMessageTarget.length > 0 ? activeMessageTarget.length - 1 : null;
  }
  parallelRunsByTabId.forEach((run) => {
    if (run.cli === cli && run.sessionId === fromSessionId) {
      run.sessionId = toSessionId;
      run.messageTarget = loadSessionMessages(cli, toSessionId);
    }
  });
  interactiveRunsByTabId.forEach((run) => {
    if (run.cli === cli && run.sessionId === fromSessionId) {
      run.sessionId = toSessionId;
      run.messageTarget = loadSessionMessages(cli, toSessionId);
    }
  });
}

function deleteSessionMessageArtifacts(cli: CliName, sessionId: string): void {
  sessionMessageCache.delete(getSessionKey(cli, sessionId));
  const filePath = getMessageFile(cli, sessionId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    void logError("session-messages-delete-error", {
      cli,
      sessionId,
      filePath,
      error: String(error),
    });
  }
  deleteInteractiveMapping(cli, sessionId);
}

function migrateLocalSessionToTargetSession(
  cli: CliName,
  localSessionId: string,
  targetSessionId: string,
  options: { notifyPanel?: boolean } = {}
): void {
  if (!localSessionId || !targetSessionId || localSessionId === targetSessionId) {
    return;
  }
  const localRecord = getSessionRecord(cli, localSessionId);
  const targetRecord = getSessionRecord(cli, targetSessionId);
  if (!localRecord && !targetRecord) {
    return;
  }

  const localMessages = loadSessionMessages(cli, localSessionId);
  const targetMessages = loadSessionMessages(cli, targetSessionId);
  const mergedMessages = mergeSessionMessages(targetMessages, localMessages);
  saveSessionMessages(cli, targetSessionId, mergedMessages);

  const sessions = sessionStore[cli]?.sessions ?? [];
  const targetIndex = sessions.findIndex((session) => session.id === targetSessionId);

  if (localRecord && targetIndex >= 0 && targetRecord) {
    sessions[targetIndex] = mergeSessionRecords(targetRecord, localRecord);
  } else if (localRecord && targetIndex < 0) {
    sessions.push({ ...localRecord, id: targetSessionId });
  }

  const removableLocalIndex = sessions.findIndex((session) => session.id === localSessionId);
  if (removableLocalIndex >= 0) {
    sessions.splice(removableLocalIndex, 1);
  }

  if (getCurrentSessionId(cli) === localSessionId) {
    setCurrentSession(cli, targetSessionId, { syncConversationTab: false });
  }

  replaceConversationTabSessionReferences(cli, localSessionId, targetSessionId);
  replaceRuntimeSessionReferences(cli, localSessionId, targetSessionId);
  deleteSessionMessageArtifacts(cli, localSessionId);
  void persistSessionStore(sessionStore);
  if (options.notifyPanel !== false) {
    void postPanelState();
  }
  void logInfo("session-local-promoted", {
    cli,
    localSessionId,
    targetSessionId,
    mergedMessageCount: mergedMessages.length,
  });
}

function findSupersedingLocalSessionTarget(cli: CliName, sessionId: string): string | null {
  if (!isLocalSessionId(sessionId)) {
    return null;
  }
  const meta = readSessionMetaStore();
  const mappedId = getMappedThreadId(meta, cli, sessionId);
  if (mappedId && mappedId !== sessionId) {
    return mappedId;
  }
  const localRecord = getSessionRecord(cli, sessionId);
  if (!localRecord) {
    return null;
  }
  return findSupersedingSessionId(localRecord, sessionStore[cli]?.sessions ?? [], {
    getMessages: (candidateSessionId) => loadSessionMessages(cli, candidateSessionId),
  });
}

function repairSupersededLocalSession(cli: CliName, sessionId: string, options: { notifyPanel?: boolean } = {}): string {
  const targetSessionId = findSupersedingLocalSessionTarget(cli, sessionId);
  if (!targetSessionId || targetSessionId === sessionId) {
    return sessionId;
  }
  migrateLocalSessionToTargetSession(cli, sessionId, targetSessionId, options);
  return targetSessionId;
}

function repairSupersededLocalSessions(options: { notifyPanel?: boolean } = {}): void {
  CLI_LIST.forEach((cli) => {
    const localSessionIds = (sessionStore[cli]?.sessions ?? [])
      .map((session) => session.id)
      .filter((sessionId) => isLocalSessionId(sessionId));
    localSessionIds.forEach((sessionId) => {
      repairSupersededLocalSession(cli, sessionId, options);
    });
  });
}

function resolveInteractiveMappedId(cli: CliName, sessionId: string): string | null {
  const meta = readSessionMetaStore();
  const mapped = getMappedThreadId(meta, cli, sessionId);
  if (mapped) {
    return mapped;
  }
  return isLocalSessionId(sessionId) ? null : sessionId;
}

function upsertInteractiveMapping(
  cli: CliName,
  sessionId: string,
  mappedId: string,
  options: { freezePrevious?: string } = {}
): void {
  const meta = readSessionMetaStore();
  const next = upsertMapping(meta, cli, sessionId, mappedId, {
    freezePrevious: options.freezePrevious,
    maxFrozen: FROZEN_THREAD_LIMIT,
  });
  writeSessionMetaStore(next);
}

function deleteInteractiveMapping(cli: CliName, sessionId: string): void {
  const meta = readSessionMetaStore() as any;
  if (!meta?.byCli) {
    return;
  }
  if (cli === "codex" && meta.byCli.codex && meta.byCli.codex[sessionId]) {
    delete meta.byCli.codex[sessionId];
    writeSessionMetaStore(meta);
    return;
  }
  if (cli === "claude" && meta.byCli.claude && meta.byCli.claude[sessionId]) {
    delete meta.byCli.claude[sessionId];
    writeSessionMetaStore(meta);
    return;
  }
}

function getMessageDir(workspaceKey: string = activeWorkspaceKey): string {
  if (workspaceKey === WORKSPACE_KEY_FALLBACK) {
    return LEGACY_MESSAGE_DIR;
  }
  return path.join(MESSAGE_DIR_ROOT, workspaceKey);
}

function clearMessageStorage(): void {
  const messageDir = getMessageDir();
  if (activeWorkspaceKey === WORKSPACE_KEY_FALLBACK) {
    for (const cli of CLI_LIST) {
      const legacyCliDir = path.join(messageDir, cli);
      if (fs.existsSync(legacyCliDir)) {
        fs.rmSync(legacyCliDir, { recursive: true, force: true });
      }
    }
    return;
  }
  if (fs.existsSync(messageDir)) {
    fs.rmSync(messageDir, { recursive: true, force: true });
  }
}

function getSessionKey(cli: CliName, sessionId: string, workspaceKey: string = activeWorkspaceKey): string {
  return `${workspaceKey}:${cli}:${sessionId}`;
}

function getMessageFile(cli: CliName, sessionId: string, workspaceKey: string = activeWorkspaceKey): string {
  return path.join(getMessageDir(workspaceKey), cli, `${sessionId}.json`);
}

function loadSessionMessages(cli: CliName, sessionId: string): ChatMessage[] {
  const key = getSessionKey(cli, sessionId);
  const cached = sessionMessageCache.get(key);
  if (cached) {
    return cached;
  }
  const messages = readMessageFile(cli, sessionId);
  const sanitized = sanitizeMessages(messages);
  const recovered = maybeRecoverClaudeSessionMessages(cli, sessionId, sanitized.messages);
  const resolvedMessages = recovered ?? sanitized.messages;
  if (recovered || sanitized.changed) {
    writeMessageFile(cli, sessionId, resolvedMessages);
  }
  sessionMessageCache.set(key, resolvedMessages);
  return resolvedMessages;
}

function maybeRecoverClaudeSessionMessages(
  cli: CliName,
  sessionId: string,
  messages: ChatMessage[]
): ChatMessage[] | null {
  if (cli !== "claude") {
    return null;
  }
  const hasConversationContent = messages.some((message) => message.role === "assistant" || message.role === "trace");
  if (hasConversationContent) {
    return null;
  }
  const hasAnyUserMessage = messages.some((message) => message.role === "user" && message.content.trim());
  if (!hasAnyUserMessage) {
    return null;
  }
  try {
    const recovered = recoverClaudeMessagesFromTranscript(sessionId, messages);
    if (recovered) {
      void logInfo("claude-session-recovered-from-transcript", {
        sessionId,
        originalSize: messages.length,
        recoveredSize: recovered.length,
      });
    }
    return recovered;
  } catch (error) {
    void logError("claude-session-recover-failed", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function saveSessionMessages(cli: CliName, sessionId: string, messages: ChatMessage[]): void {
  const key = getSessionKey(cli, sessionId);
  const sanitized = sanitizeMessages(messages);
  sessionMessageCache.set(key, sanitized.messages);
  writeMessageFile(cli, sessionId, sanitized.messages);
}

function readMessageFile(cli: CliName, sessionId: string): ChatMessage[] {
  const key = getSessionKey(cli, sessionId);
  sessionMessageLoadErrors.delete(key);
  try {
    const filePath = getMessageFile(cli, sessionId);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.messages)) {
      const detail = [
        "session message file format invalid",
        `cli: ${cli}`,
        `sessionId: ${sessionId}`,
        `file: ${filePath}`,
      ].join("\n");
      sessionMessageLoadErrors.set(key, detail);
      return [];
    }
    return parsed.messages as ChatMessage[];
  } catch (error) {
    const detail = buildErrorDetail(error);
    sessionMessageLoadErrors.set(key, detail);
    void logError("session-messages-read-error", {
      cli,
      sessionId,
      filePath: getMessageFile(cli, sessionId),
      error: detail,
    });
    return [];
  }
}

function writeMessageFile(cli: CliName, sessionId: string, messages: ChatMessage[]): void {
  try {
    const cliDir = path.join(getMessageDir(), cli);
    if (!fs.existsSync(cliDir)) {
      fs.mkdirSync(cliDir, { recursive: true });
    }
    const filePath = getMessageFile(cli, sessionId);
    fs.writeFileSync(filePath, JSON.stringify({ messages }, null, 2), "utf8");
  } catch (error) {
    void logError("session-messages-write-error", { error: String(error) });
  }
}

function sanitizeMessages(messages: ChatMessage[]): { messages: ChatMessage[]; changed: boolean } {
  if (!messages.length) {
    return { messages, changed: false };
  }
  const cleaned: ChatMessage[] = [];
  let changed = false;
  for (const message of messages) {
    const content = typeof message.content === "string" ? message.content : "";
    if (
      (message.role === "assistant" || message.role === "trace")
      && !content.trim()
    ) {
      changed = true;
      continue;
    }
    cleaned.push(message);
  }
  const normalized = ensureMessageSequence(cleaned);
  return { messages: normalized.messages, changed: changed || normalized.changed };
}

function ensureMessageSequence(messages: ChatMessage[]): { messages: ChatMessage[]; changed: boolean } {
  if (messages.length === 0) {
    return { messages, changed: false };
  }
  let changed = false;
  let nextSequence = 0;
  for (const message of messages) {
    if (message.sequence !== nextSequence) {
      message.sequence = nextSequence;
      changed = true;
    }
    nextSequence += 1;
  }
  return { messages, changed };
}

function sendSessionLoadErrorToPanel(
  cli: CliName,
  sessionId: string | null,
  detail: string,
  tabId: string | null
): void {
  const targetTabId = tabId ?? getActiveConversationTabId();
  sendPanelMessage({
    type: "sessionLoadError",
    title: t("session.loadFailedTitle"),
    detail,
    tabId: targetTabId,
    sessionId,
    cli,
  });
}

function sendSessionMessagesToPanel(
  cli: CliName,
  sessionId: string | null,
  tabId: string | null = getActiveConversationTabId()
): void {
  const targetTabId = tabId ?? getActiveConversationTabId();
  if (!targetTabId) {
    sendPanelMessage({ type: "setMessages", messages: [], tabId: null });
    return;
  }

  const liveMessages = getLiveMessagesForTab(targetTabId);
  if (liveMessages) {
    sendPanelMessage({ type: "setMessages", messages: liveMessages, tabId: targetTabId });
    void logDebug("setMessages-live", {
      cli,
      sessionId,
      tabId: targetTabId,
      size: liveMessages.length,
      source: "active-run",
    });
    return;
  }

  if (!sessionId) {
    const draftMessages = getPendingSessionDraft(targetTabId, cli).messages;
    sendPanelMessage({ type: "setMessages", messages: draftMessages, tabId: targetTabId });
    void logDebug("setMessages-draft", {
      cli,
      sessionId,
      tabId: targetTabId,
      size: draftMessages.length,
      source: "draft",
    });
    return;
  }

  try {
    const sessionMessages = loadSessionMessages(cli, sessionId);
    const counts = sessionMessages.reduce((acc, message) => {
      const role = typeof message?.role === "string" ? message.role : "unknown";
      acc[role] = (acc[role] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const loadError = sessionMessageLoadErrors.get(getSessionKey(cli, sessionId));
    sendPanelMessage({
      type: "setMessages",
      messages: sessionMessages,
      tabId: targetTabId,
    });
    if (loadError) {
      sendSessionLoadErrorToPanel(cli, sessionId, loadError, targetTabId);
      void showErrorWithActions(t("session.loadFailedTitle"), loadError);
      void logError("session-load-surface-error", {
        cli,
        sessionId,
        tabId: targetTabId,
        detail: loadError,
      });
    }
    void logDebug("setMessages-session", {
      cli,
      sessionId,
      tabId: targetTabId,
      size: sessionMessages.length,
      counts,
      source: "session-store",
      loadError: loadError ?? null,
    });
  } catch (error) {
    const detail = buildErrorDetail(error);
    sendPanelMessage({ type: "setMessages", messages: [], tabId: targetTabId });
    sendSessionLoadErrorToPanel(cli, sessionId, detail, targetTabId);
    void logError("setMessages-session-failed", {
      cli,
      sessionId,
      tabId: targetTabId,
      error: detail,
    });
    void showErrorWithActions(t("session.loadFailedTitle"), detail);
  }
}

function deleteSession(cli: CliName, sessionId: string): void {
  const sessions = sessionStore[cli].sessions;
  const index = sessions.findIndex((item) => item.id === sessionId);
  if (index === -1) {
    return;
  }
  sessions.splice(index, 1);
  sessionMessageCache.delete(getSessionKey(cli, sessionId));
  deleteInteractiveMapping(cli, sessionId);
  const filePath = getMessageFile(cli, sessionId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    void logError("session-messages-delete-error", { error: String(error) });
  }
  if (getCurrentSessionId(cli) === sessionId) {
    setCurrentSession(cli, null);
  }
  void persistSessionStore(sessionStore);
  void logInfo("session-deleted", { cli, sessionId });
}

function clearAllSessions(): void {
  sessionMessageCache.clear();
  for (const cli of CLI_LIST) {
    sessionStore[cli].currentId = null;
    sessionStore[cli].sessions = [];
  }
  Object.keys(pendingSessionDrafts).forEach((tabId) => {
    delete pendingSessionDrafts[tabId];
  });
  const tabs = ensureConversationTabs();
  tabs.tabs.forEach((tab) => {
    tab.sessionId = null;
    tab.sessionIdByCli = {};
  });
  persistConversationTabsToWorkspaceSettings();
  try {
    clearMessageStorage();
  } catch (error) {
    void logError("session-messages-clear-error", { error: String(error) });
  }
  try {
    const metaFile = getSessionMetaFilePath();
    if (fs.existsSync(metaFile)) {
      fs.unlinkSync(metaFile);
    }
  } catch (error) {
    void logError("session-meta-clear-error", { error: String(error) });
  }
  void persistSessionStore(sessionStore);
  void logInfo("session-clear-all", {});
}

function readSessionFile(workspaceKey: string = activeWorkspaceKey): SessionStore | undefined {
  try {
    const sessionFile = getSessionFilePath(workspaceKey);
    if (!fs.existsSync(sessionFile)) {
      return undefined;
    }
    const raw = fs.readFileSync(sessionFile, "utf8");
    return JSON.parse(raw) as SessionStore;
  } catch (error) {
    void logError("session-file-read-error", { error: String(error) });
    return undefined;
  }
}

function writeSessionFile(store: SessionStore, workspaceKey: string = activeWorkspaceKey): void {
  try {
    const sessionFile = getSessionFilePath(workspaceKey);
    const dirPath = path.dirname(sessionFile);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(sessionFile, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    void logError("session-file-write-error", { error: String(error) });
  }
}

function deleteSessionFile(workspaceKey: string): void {
  try {
    const sessionFile = getSessionFilePath(workspaceKey);
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  } catch (error) {
    void logError("session-file-delete-error", {
      workspace: workspaceKey,
      error: String(error),
    });
  }
}

function formatGeminiPlainTextLines(lines: string[]): string {
  return lines.join("\n").trimEnd();
}

function collectGeminiEventDisplay(
  event: GeminiStreamJsonEvent,
  handlers: {
    onAssistantText?: (text: string) => void;
    onTraceText?: (text: string) => void;
    onSessionId?: (sessionId: string) => void;
  } = {}
): { assistantText: string; traceText: string; sessionId: string | null; resultStatus: string | null; errorText: string | null } {
  const display = getGeminiEventDisplay(event);
  if (display.sessionId) {
    handlers.onSessionId?.(display.sessionId);
  }
  if (display.assistantText) {
    handlers.onAssistantText?.(display.assistantText);
  }
  if (display.traceText) {
    handlers.onTraceText?.(display.traceText);
  }
  return display;
}

function processGeminiStreamJsonChunk(
  state: { remainder: string; assistantText: string; resultStatus: string | null; errorText: string | null },
  chunk: string,
  handlers: {
    onAssistantText?: (text: string) => void;
    onTraceText?: (text: string) => void;
    onSessionId?: (sessionId: string) => void;
    onPlainText?: (text: string) => void;
  } = {}
): void {
  const parsed = parseGeminiStreamJsonChunk(state.remainder, chunk);
  state.remainder = parsed.remainder;
  parsed.events.forEach((event) => {
    const display = collectGeminiEventDisplay(event, handlers);
    if (display.assistantText) {
      state.assistantText += display.assistantText;
    }
    if (display.resultStatus) {
      state.resultStatus = display.resultStatus;
    }
    if (display.errorText) {
      state.errorText = display.errorText;
    }
  });
  const plainText = formatGeminiPlainTextLines(parsed.textLines);
  if (plainText) {
    state.assistantText += plainText;
    handlers.onPlainText?.(plainText);
  }
}

function finalizeGeminiStreamJsonState(
  state: { remainder: string; assistantText: string; resultStatus: string | null; errorText: string | null },
  handlers: {
    onAssistantText?: (text: string) => void;
    onTraceText?: (text: string) => void;
    onSessionId?: (sessionId: string) => void;
    onPlainText?: (text: string) => void;
  } = {}
): void {
  const parsed = finalizeGeminiStreamJsonRemainder(state.remainder);
  state.remainder = "";
  if (!parsed) {
    return;
  }
  if (parsed.kind === "event") {
    const display = collectGeminiEventDisplay(parsed.event, handlers);
    if (display.assistantText) {
      state.assistantText += display.assistantText;
    }
    if (display.resultStatus) {
      state.resultStatus = display.resultStatus;
    }
    if (display.errorText) {
      state.errorText = display.errorText;
    }
    return;
  }
  const text = parsed.text.trimEnd();
  if (text) {
    state.assistantText += text;
    handlers.onPlainText?.(text);
  }
}

function extractSessionId(cli: CliName, text: string): string | undefined {
  const patterns = getSessionIdPatterns(cli);
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      return match[1];
    }
  }
  return undefined;
}

function getSessionIdPatterns(cli: CliName): RegExp[] {
  const uuid = "([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";
  const base = [
    new RegExp(`session\\s*id\\s*[:=]?\\s*${uuid}`, "i"),
    new RegExp(`conversation\\s*id\\s*[:=]?\\s*${uuid}`, "i"),
    new RegExp(`\"session_id\"\\s*:\\s*\"${uuid}\"`, "i"),
  ];
  if (cli === "claude") {
    return [
      ...base,
      /"session_id"\s*:\s*"([^"]+)"/i,
    ];
  }
  if (cli === "gemini") {
    return [
      ...base,
      /"session_id"\s*:\s*"([^"]+)"/i,
    ];
  }
  return base;
}

function applyProcessTitle(runId: string, cli: CliName, sessionId: string | null): void {
  if (!activeProcessTitleBase) {
    activeProcessTitleBase = process.title;
  }
  const labelId = sessionId ?? runId;
  activeProcessTitleRunId = runId;
  process.title = buildProcessLabel(cli, labelId);
}

function updateProcessTitle(cli: CliName, sessionId: string): void {
  if (!activeRunId || activeRunId !== activeProcessTitleRunId || activeCliForRun !== cli) {
    return;
  }
  process.title = buildProcessLabel(cli, sessionId);
}

function restoreProcessTitle(): void {
  if (!activeProcessTitleRunId) {
    return;
  }
  if (activeProcessTitleBase) {
    process.title = activeProcessTitleBase;
  }
  activeProcessTitleBase = null;
  activeProcessTitleRunId = null;
}

function syncPendingDraftMessagesForSessionAdoption(cli: CliName, tabId: string | null): void {
  if (!tabId) {
    return;
  }

  const activeRunMatches = getPrimaryRunTabId() === tabId
    && activeCliForRun === cli
    && activeSessionId === null
    && Array.isArray(activeMessageTarget)
    && activeMessageTarget.length > 0;
  if (activeRunMatches && activeMessageTarget) {
    updatePendingSessionDraft(tabId, { messages: activeMessageTarget }, cli);
  }

  const parallelRun = parallelRunsByTabId.get(tabId);
  if (parallelRun && parallelRun.cli === cli && parallelRun.sessionId === null && parallelRun.messageTarget.length > 0) {
    updatePendingSessionDraft(tabId, { messages: parallelRun.messageTarget }, cli);
  }

  const interactiveRun = interactiveRunsByTabId.get(tabId);
  if (interactiveRun && interactiveRun.cli === cli && interactiveRun.sessionId === null && interactiveRun.messageTarget.length > 0) {
    updatePendingSessionDraft(tabId, { messages: interactiveRun.messageTarget }, cli);
  }
}

function adoptSessionId(cli: CliName, sessionId: string, tabId: string | null = null): void {
  const targetTabId = tabId ?? getActiveConversationTabId();
  syncPendingDraftMessagesForSessionAdoption(cli, targetTabId);
  let changed = false;
  if (targetTabId) {
    const tab = getConversationTabById(targetTabId);
    if (tab) {
      changed = switchConversationTabCli(tab, cli) || changed;
      changed = setConversationTabSessionIdForCli(tab, cli, sessionId) || changed;
    }
  }
  if (changed) {
    persistConversationTabsToWorkspaceSettings();
  }
  const current = getCurrentSessionId(cli);
  if (current !== sessionId) {
    setCurrentSession(cli, sessionId, { syncConversationTab: false });
  }
  if (targetTabId) {
    assignPendingLabel(cli, targetTabId, sessionId);
    attachPendingMessages(cli, targetTabId, sessionId);
  }

  if (
    targetTabId
    && getPrimaryRunTabId() === targetTabId
    && activeCliForRun === cli
  ) {
    activeSessionId = sessionId;
    activeMessageTarget = loadSessionMessages(cli, sessionId);
    activeMessageIndex = activeMessageTarget.length > 0 ? activeMessageTarget.length - 1 : null;
  }

  const parallelRun = targetTabId ? parallelRunsByTabId.get(targetTabId) : undefined;
  if (parallelRun && parallelRun.cli === cli) {
    parallelRun.sessionId = sessionId;
    parallelRun.messageTarget = loadSessionMessages(cli, sessionId);
  }
  const interactiveRun = targetTabId ? interactiveRunsByTabId.get(targetTabId) : undefined;
  if (interactiveRun && interactiveRun.cli === cli) {
    interactiveRun.sessionId = sessionId;
    interactiveRun.messageTarget = loadSessionMessages(cli, sessionId);
  }

  updateProcessTitle(cli, sessionId);
  void postPanelState();
  void logInfo("session-detected", { cli, sessionId, tabId: targetTabId });
}

function normalizePromptContextOptions(
  options?: PromptContextOptions
): Required<PromptContextOptions> {
  return {
    includeCurrentFile: options?.includeCurrentFile !== false,
    includeSelection: options?.includeSelection !== false,
  };
}

function getEditorDisplayPath(document: vscode.TextDocument): string {
  const relativePath = vscode.workspace.asRelativePath(document.uri, false);
  if (relativePath) {
    return relativePath.replace(/\\/g, "/");
  }
  if (document.fileName) {
    return document.fileName.replace(/\\/g, "/");
  }
  return document.uri.toString(true);
}

function getPrimaryNonEmptySelection(editor: vscode.TextEditor): vscode.Selection | null {
  const selections = Array.isArray(editor.selections) && editor.selections.length
    ? editor.selections
    : [editor.selection];
  for (const selection of selections) {
    if (!selection.isEmpty) {
      return selection;
    }
  }
  return null;
}

function formatSelectionLabel(selection: vscode.Selection): string {
  const startLine = selection.start.line + 1;
  const startChar = selection.start.character + 1;
  const endLine = selection.end.line + 1;
  const endChar = selection.end.character + 1;
  if (startLine === endLine) {
    return `L${startLine}:${startChar}-${endChar}`;
  }
  return `L${startLine}:${startChar}-L${endLine}:${endChar}`;
}

function buildEditorContextState(): EditorContextState {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return {
      filePath: null,
      fileLabel: null,
      hasSelection: false,
      selectionLabel: null,
    };
  }
  const fileLabel = getEditorDisplayPath(editor.document);
  const selection = getPrimaryNonEmptySelection(editor);
  return {
    filePath: fileLabel,
    fileLabel,
    hasSelection: Boolean(selection),
    selectionLabel: selection ? formatSelectionLabel(selection) : null,
  };
}

type ActiveEditorPromptContext = {
  fileLabel: string;
  hasSelection: boolean;
  selectionLabel: string | null;
};

function formatContextTagLabel(context: ActiveEditorPromptContext): string {
  if (context.hasSelection && context.selectionLabel) {
    return t("common.currentFileWithRange", {
      file: context.fileLabel,
      range: context.selectionLabel,
    });
  }
  return `${t("common.currentFile")}: ${context.fileLabel}`;
}

function getActiveEditorPromptContext(): ActiveEditorPromptContext | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }
  const fileLabel = getEditorDisplayPath(editor.document);
  const selection = getPrimaryNonEmptySelection(editor);
  return {
    fileLabel,
    hasSelection: Boolean(selection),
    selectionLabel: selection ? formatSelectionLabel(selection) : null,
  };
}

function buildPromptWithAutoContext(
  prompt: string,
  options?: PromptContextOptions
): PromptContextBuildResult {
  if (!prompt) {
    return { modelPrompt: prompt, contextTags: [] };
  }
  if (!getAutoAddEditorContextTags()) {
    return { modelPrompt: prompt, contextTags: [] };
  }
  const normalized = normalizePromptContextOptions(options);
  if (!normalized.includeCurrentFile && !normalized.includeSelection) {
    return { modelPrompt: prompt, contextTags: [] };
  }
  const context = getActiveEditorPromptContext();
  if (!context) {
    return { modelPrompt: prompt, contextTags: [] };
  }

  const referenceLines: string[] = [];
  const contextTags: string[] = [];

  if (normalized.includeSelection && context.hasSelection) {
    contextTags.push(formatContextTagLabel(context));
    if (context.selectionLabel) {
      referenceLines.push(`Selected range in @${context.fileLabel}: ${context.selectionLabel}`);
    } else {
      referenceLines.push(`Selected range in @${context.fileLabel}`);
    }
  } else if (normalized.includeCurrentFile) {
    referenceLines.push(`@${context.fileLabel}`);
    contextTags.push(formatContextTagLabel(context));
  }

  if (!referenceLines.length) {
    return { modelPrompt: prompt, contextTags: [] };
  }

  return {
    modelPrompt: [prompt, "", "----", "Auto Context References:", ...referenceLines].join("\n"),
    contextTags,
  };
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
