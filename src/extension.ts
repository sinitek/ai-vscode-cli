import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import {
  getAutoOpenPanel,
  getDefaultCli,
  getRememberSelectedCli,
  getDebugLogging,
  getCliCommand,
  getCliArgs,
  getInteractiveEnabled,
  isInteractiveSupported,
  getThinkingMode,
  getThinkingPromptPrefix,
  getThinkingPromptSuffix,
  getThinkingWorkspaceFiles,
} from "./cli/config";
import {
  buildCliArgs,
  buildProcessLabel,
  resolveCliCommand,
  runCli,
  runCliStream,
  type RunProcess,
} from "./cli/commandRunner";
import { CliName, CLI_LIST, ThinkingMode, ThinkingWorkspaceFile } from "./cli/types";
import { CliBridgeViewProvider } from "./webview/viewProvider";
import {
  ChatMessage,
  PanelMessage,
  PanelState,
  SessionSummary,
  UploadFilePayload,
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
  setDebugLogging,
} from "./logger";
import { ConfigManagerPanel } from "./webview/configPanel";
import * as configService from "./config/configService";
import { ConfigItem, ConfigPlatform, CurrentConfig } from "./config/types";
import { InteractiveRunnerManager } from "./interactive/manager";
import {
  getMappedThreadId,
  readSessionMeta,
  upsertMapping,
  writeSessionMeta,
} from "./interactive/metaStore";

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
let activeProcessTitleRunId: string | null = null;
let activeProcessTitleBase: string | null = null;
let extensionContext: vscode.ExtensionContext;
let sessionStore: SessionStore;
let configManagerPanel: ConfigManagerPanel | undefined;
let activeWorkspaceKey: string;
let pendingWorkspaceKey: string | null = null;
let updateCheckOverride: { autoCheckUpdates?: boolean; autoUpdate?: boolean } | null = null;
const pendingSessionLabels: Record<CliName, string | null> = {
  codex: null,
  claude: null,
  gemini: null,
};
const pendingSessionMessages: Record<CliName, ChatMessage[]> = {
  codex: [],
  claude: [],
  gemini: [],
};
const sessionMessageCache = new Map<string, ChatMessage[]>();
const SESSION_STORE_KEY = "sessionStore";
const SESSION_BUFFER_LIMIT = 4000;
const SESSION_LABEL_LIMIT = 16;
const LOCAL_SESSION_PREFIX = "local_";
const DATA_DIR = path.join(os.homedir(), ".sinitek_cli");
const SESSION_DIR = path.join(DATA_DIR, "sessions");
const MESSAGE_DIR_ROOT = path.join(DATA_DIR, "messages");
const WORKSPACE_KEY_FALLBACK = "no-workspace";
const WORKSPACE_KEY_HASH_LENGTH = 12;
const WORKSPACE_NAME_MAX_LENGTH = 32;
const LEGACY_SESSION_FILE = path.join(DATA_DIR, "sessions.json");
const LEGACY_MESSAGE_DIR = path.join(DATA_DIR, "messages");
const TASK_STORE_FILE = path.join(DATA_DIR, "tasks.json");
const TEMP_ROOT_DIR = path.join(os.homedir(), ".sinitek_cli");
const TEMP_DIR = path.join(TEMP_ROOT_DIR, "temp");
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const TEMP_CLEAN_INTERVAL_MS = 15 * 60 * 1000;
const PATH_PICKER_EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}";
const PATH_PICKER_MAX_RESULTS = 2000;
const TEMP_FILE_RANDOM_LENGTH = 8;
const GEMINI_THINKING_SETTINGS_PATH = ".gemini/settings.json";
const GEMINI_THINKING_LEVELS: Record<ThinkingMode, string | null> = {
  off: null,
  on: "high",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
};
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

const CONTEXT_COMPACT_TURN_THRESHOLD = 30;
const CONTEXT_COMPACT_CHAR_THRESHOLD = 24000;
const FROZEN_THREAD_LIMIT = 5;
const KEEP_RECENT_TURNS = 3;
const suppressCompactPrompt = new Set<string>();

type SessionRecord = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
};

type SessionStore = Record<CliName, { currentId: string | null; sessions: SessionRecord[] }>;

type TaskRunStatus = "end" | "error" | "stopped";

type TaskRunDraft = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  prompt: string;
  startedAt: number;
};

type TaskRunRecord = TaskRunDraft & {
  endedAt: number;
  durationMs: number;
  status: TaskRunStatus;
};

type TaskStore = {
  runs: TaskRunRecord[];
};

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  extensionUri = context.extensionUri;
  interactiveRunnerManager = new InteractiveRunnerManager();
  void maybeDisableMarketplaceUpdateCheckInDev(context);
  currentCli = getDefaultCli();
  activeWorkspaceKey = buildWorkspaceKey(resolveWorkspaceCwd());
  sessionStore = loadSessionStore();
  ensureLatestSessionForCli(currentCli);
  void initLogger();
  setDebugLogging(getDebugLogging());
  configManagerPanel = new ConfigManagerPanel(extensionUri, {
    onConfigChanged: () => {
      void postPanelState();
    },
  });
  startTempCleanup(context);

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
        placeHolder: "选择要使用的 CLI",
      });

      if (!selection || !isCliName(selection)) {
        return;
      }

      await setCurrentCli(selection);
      vscode.window.showInformationMessage(`当前 CLI：${currentCli}`);
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
        if (!activeProcess && !activeInteractiveStop) {
          interactiveRunnerManager?.disposeAll();
        }
        setDebugLogging(getDebugLogging());
        currentCli = getDefaultCli();
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
        description: "文件",
        value: relativePath,
      };
    });
  const dirItems = Array.from(dirSet)
    .sort((a, b) => a.localeCompare(b))
    .map((dirPath) => ({
      label: dirPath + "/",
      description: "目录",
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

  if (message.type === "selectCli" && message.cli) {
    await setCurrentCli(message.cli);
    interactiveRunnerManager?.disposeAll();
    const latestSessionId = getLatestSessionId(currentCli);
    if (latestSessionId) {
      setCurrentSession(currentCli, latestSessionId);
    } else {
      startNewSession(currentCli);
    }
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, latestSessionId ?? null);
    return;
  }

  if (message.type === "selectSession") {
    await setCurrentCli(message.cli);
    interactiveRunnerManager?.disposeAll();
    setCurrentSession(message.cli, message.sessionId);
    await postPanelState();
    sendSessionMessagesToPanel(message.cli, message.sessionId);
    return;
  }

  if (message.type === "deleteSession") {
    const confirmed = await vscode.window.showWarningMessage(
      "确认删除该会话历史？",
      { modal: true },
      "删除"
    );
    if (confirmed !== "删除") {
      return;
    }
    const wasCurrent = getCurrentSessionId(message.cli) === message.sessionId;
    interactiveRunnerManager?.disposeIfMatches(message.cli, message.sessionId);
    deleteSession(message.cli, message.sessionId);
    if (wasCurrent && currentCli === message.cli) {
      startNewSession(message.cli);
    }
    await postPanelState();
    if (currentCli === message.cli && getCurrentSessionId(message.cli) === null) {
      sendSessionMessagesToPanel(message.cli, null);
    }
    return;
  }

  if (message.type === "clearAllSessions") {
    const confirmed = await vscode.window.showWarningMessage(
      "确认清空所有 CLI 的历史会话？",
      { modal: true },
      "清空"
    );
    if (confirmed !== "清空") {
      return;
    }
    interactiveRunnerManager?.disposeAll();
    clearAllSessions();
    startNewSession(currentCli);
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, null);
    return;
  }

  if (message.type === "newSession") {
    interactiveRunnerManager?.disposeAll();
    startNewSession(currentCli);
    await postPanelState();
    sendSessionMessagesToPanel(currentCli, null);
    return;
  }

  if (message.type === "openConfig") {
    configManagerPanel?.show();
    configManagerPanel?.syncActiveConfig();
    return;
  }

  if (message.type === "applyConfig") {
    await applyConfigById(message.cli, message.configId);
    await postPanelState();
    configManagerPanel?.syncActiveConfig();
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
        error: "解析拖拽文件失败，请重试。",
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
        error: "当前没有打开的工作区，无法选择文件或目录。",
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
        placeHolder: "选择文件或目录，输入关键字过滤",
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
        error: "读取工作区路径失败，请重试。",
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
        error: noWorkspace ? "未找到工作区，无法加载项目规则。" : "加载规则失败，请重试。",
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
        error: "未选择有效的 CLI。",
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
        error: noWorkspace ? "未找到工作区，无法保存项目规则。" : "保存规则失败，请重试。",
      });
      logError("save rules failed", error);
    }
    return;
  }

  if (message.type === "updateSetting" && message.key) {
    const config = vscode.workspace.getConfiguration("sinitek-cli-tools");
    const target = message.key.startsWith("interactive.")
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update(message.key, message.value, target);
    await postPanelState();
    return;
  }

  if (message.type === "sendPrompt" && typeof message.prompt === "string") {
    await runPrompt(message.prompt.trim());
    return;
  }

  if (message.type === "stopRun") {
    stopActiveRun();
  }
}

async function buildPanelState(): Promise<PanelState> {
  ensureWorkspaceSessionStore();
  const config = vscode.workspace.getConfiguration("sinitek-cli-tools");
  const configState = await loadConfigState(currentCli);

  return {
    currentCli,
    autoOpenPanel: config.get<boolean>("autoOpenPanel", false),
    rememberSelectedCli: config.get<boolean>("rememberSelectedCli", true),
    debug: getDebugLogging(),
    thinkingMode: getThinkingMode(currentCli),
    interactive: {
      supported: isInteractiveSupported(currentCli),
      enabled: getInteractiveEnabled(currentCli),
    },
    rulePaths: {
      global: CLI_RULE_PATHS_GLOBAL,
      project: getProjectRulePaths(),
    },
    sessionState: buildSessionState(currentCli),
    configState,
  };
}

async function postPanelState(): Promise<void> {
  const state = await buildPanelState();
  viewProvider?.postState(state);
}

function ensureWorkspaceSessionStore(): void {
  const workspaceKey = buildWorkspaceKey(resolveWorkspaceCwd());
  if (workspaceKey === activeWorkspaceKey) {
    return;
  }
  if (activeProcess || activeInteractiveStop) {
    pendingWorkspaceKey = workspaceKey;
    return;
  }
  applyWorkspaceSessionStore(workspaceKey);
}

function applyWorkspaceSessionStore(workspaceKey: string): void {
  activeWorkspaceKey = workspaceKey;
  sessionStore = loadSessionStore();
  sessionMessageCache.clear();
  interactiveRunnerManager?.disposeAll();
  suppressCompactPrompt.clear();
  for (const cli of CLI_LIST) {
    pendingSessionLabels[cli] = null;
    pendingSessionMessages[cli] = [];
  }
  ensureLatestSessionForCli(currentCli);
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
    if (cli === "gemini") {
      applyGeminiThinkingSettings(mode, cwd);
    }
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

function applyGeminiThinkingSettings(mode: ThinkingMode, cwd: string): void {
  const targetPath = resolveWorkspaceFilePath(cwd, GEMINI_THINKING_SETTINGS_PATH);
  const level = GEMINI_THINKING_LEVELS[mode];
  if (level === null) {
    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
        void logInfo("gemini-thinking-settings-removed", { mode, targetPath });
      } catch (error) {
        void logError("thinking-workspace-file-remove-failed", {
          cli: "gemini",
          targetPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return;
  }
  const next = buildGeminiThinkingSettings(mode, targetPath);
  if (!next) {
    void logInfo("gemini-thinking-settings-skip", { mode, targetPath });
    return;
  }
  try {
    const content = JSON.stringify(next, null, 2);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
    void logInfo("gemini-thinking-settings-written", { mode, targetPath });
  } catch (error) {
    void logError("thinking-workspace-file-write-failed", {
      cli: "gemini",
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildGeminiThinkingSettings(
  mode: ThinkingMode,
  targetPath: string
): Record<string, unknown> | null {
  const level = GEMINI_THINKING_LEVELS[mode];
  if (level === null) {
    return null;
  }
  const base = readGeminiSettingsFile(targetPath) ?? {};
  const modelConfigs = isPlainObject(base.modelConfigs) ? { ...base.modelConfigs } : {};
  const normalizedLevel = mode === "medium" ? "low" : level;
  const levelConfig = {
    generateContentConfig: { thinkingConfig: { thinkingLevel: normalizedLevel } },
  };
  modelConfigs["chat-base-3"] = {
    modelConfig: levelConfig,
  };
  modelConfigs["gemini-3-pro-preview"] = {
    extends: "chat-base-3",
    modelConfig: {
      model: "gemini-3-pro-preview",
    },
  };
  modelConfigs["gemini-3-flash-preview"] = {
    extends: "chat-base-3",
    modelConfig: {
      model: "gemini-3-flash-preview",
    },
  };
  const next = { ...base, modelConfigs } as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(next, "model")) {
    delete next.model;
  }
  return next;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
        return { paths: savedPaths, error: "文件内容解析失败，请重试。" };
      }
      const targetPath = buildTempFilePath(file.name);
      fs.writeFileSync(targetPath, buffer);
      savedPaths.push(targetPath);
    }
    return { paths: savedPaths };
  } catch (error) {
    logError("save-uploaded-files-failed", error);
    return { paths: savedPaths, error: "文件保存失败，请重试。" };
  }
}

function matchesActiveConfig(
  platform: ConfigPlatform,
  config: ConfigItem,
  current: CurrentConfig
): boolean {
  if (platform === "claude") {
    const configContentNormalized = normalizeJson(config.content, "{}");
    const currentContentNormalized = normalizeJson(current.content, "{}");
    const contentMatch = configContentNormalized === currentContentNormalized;

    const configMcp = parseJsonObject(config.mcpContent);
    const currentMcp = parseJsonObject(current.mcpContent);
    const mcpMatch = configMcp && currentMcp
      ? isDeepEqualSubset(configMcp, currentMcp)
      : normalizeJson(config.mcpContent, "{}") === normalizeJson(current.mcpContent, "{}");

    return contentMatch && mcpMatch;
  }
  if (platform === "gemini") {
    return (
      normalizeJson(config.content, "{}") === normalizeJson(current.content, "{}") &&
      normalizeLineEndings(config.envContent) === normalizeLineEndings(current.envContent)
    );
  }
  return (
    normalizeConfigText(config.configContent) === normalizeConfigText(current.configContent) &&
    normalizeJson(config.authContent, "{}") === normalizeJson(current.authContent, "{}")
  );
}

function normalizeConfigText(value: string | undefined): string {
  const normalized = normalizeLineEndings(value ?? "");
  return normalized
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .trim();
}

async function applyConfigById(cli: CliName, configId: string): Promise<void> {
  if (!configId) {
    return;
  }
  const config = await configService.getConfigById(cli, configId);
  if (!config) {
    void vscode.window.showWarningMessage("配置不存在或已删除");
    return;
  }
  try {
    await configService.applyConfig(cli, {
      content: config.content,
      mcpContent: config.mcpContent,
      envContent: config.envContent,
      configContent: config.configContent,
      authContent: config.authContent,
    });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `配置应用失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function loadConfigState(cli: CliName): Promise<PanelState["configState"]> {
  try {
    const configs = await configService.getConfigList(cli);
    if (configs.length === 0) {
      void logInfo("loadConfigState-empty", { cli, reason: "no-configs" });
      return { configs: [], activeConfigId: null };
    }
    const current = await configService.getCurrentConfig(cli);
    const active = configs.find((config) => matchesActiveConfig(cli, config, current));
    return {
      configs: configs.map((config) => ({
        id: config.id,
        name: config.name,
        platform: config.platform,
      })),
      activeConfigId: active ? active.id : null,
    };
  } catch (error) {
    void logError("panel-config-state", {
      cli,
      error: error instanceof Error ? error.message : String(error),
    });
    return { configs: [], activeConfigId: null };
  }
}

async function setCurrentCli(cli: CliName): Promise<void> {
  currentCli = cli;
  updateStatusBar();

  if (getRememberSelectedCli()) {
    const config = vscode.workspace.getConfiguration("sinitek-cli-tools");
    await config.update("defaultCli", cli, vscode.ConfigurationTarget.Global);
  }
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  statusBarItem.text = `携宁 CLI 配置: ${currentCli}`;
  statusBarItem.tooltip = "打开携宁 CLI 配置面板";
}

async function revealPanelView(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.sinitekCliBridgePanel");
  viewProvider?.reveal();
}

function isCliName(value: string): value is CliName {
  return (CLI_LIST as readonly string[]).includes(value);
}

type ErrorInfo = {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
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

function isAbortErrorInfo(info: ErrorInfo): boolean {
  const combined = `${info.name ?? ""} ${info.code ?? ""} ${info.message ?? ""}`.toLowerCase();
  return combined.includes("abort");
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

async function runPrompt(prompt: string): Promise<void> {
  if (!prompt) {
    return;
  }

  const interactiveEnabled = getInteractiveEnabled(currentCli);
  const shouldUseInteractive = interactiveEnabled && isInteractiveSupported(currentCli);

  if (shouldUseInteractive) {
    try {
      await runPromptInteractive(prompt);
      return;
    } catch (error) {
      const info = getErrorInfo(error);
      if (isAbortErrorInfo(info)) {
        void logInfo("runPrompt-interactive-abort-ignored", {
          cli: currentCli,
          error: info.message,
          errorName: info.name,
          errorCode: info.code,
          errorStack: info.stack,
        });
        return;
      }
      void logError("runPrompt-interactive-fallback", {
        cli: currentCli,
        error: info.message,
        errorName: info.name,
        errorCode: info.code,
        errorStack: info.stack,
      });
      sendPanelMessage({
        type: "appendMessage",
        message: {
          id: createMessageId(),
          role: "system",
          content: "交互模式初始化/运行失败，已自动降级为普通模式。",
          createdAt: Date.now(),
        },
      });
    }
  }

  await runPromptOneShot(prompt);
}

async function runPromptOneShot(prompt: string): Promise<void> {
  if (!prompt) {
    return;
  }
  if (activeProcess || activeInteractiveStop) {
    stopActiveRun();
    void logInfo("runPrompt-preempt", { cli: currentCli });
  }

  const cwd = resolveWorkspaceCwd();
  if (!cwd) {
    void logInfo("runPrompt-no-workspace", { cli: currentCli });
  }
  const thinkingMode = getThinkingMode(currentCli);
  applyThinkingWorkspaceFiles(currentCli, thinkingMode, cwd);
  preparePendingLabel(currentCli, prompt);
  const sessionId = getCurrentSessionId(currentCli);
  const thinkingPrompt = buildThinkingPrompt(currentCli, thinkingMode, prompt);
  const debugLogging = getDebugLogging();
  const logModelOutput = (content: string): void => {
    if (!debugLogging) {
      return;
    }
    if (currentCli !== "claude" && currentCli !== "codex") {
      return;
    }
    if (!content) {
      return;
    }
    void logCliInteractiveOutput(currentCli, activeSessionId, "stdout", content);
  };
  const messageTarget = sessionId
    ? loadSessionMessages(currentCli, sessionId)
    : pendingSessionMessages[currentCli];
  const args = buildCliArgs(currentCli, { sessionId, thinkingMode }, thinkingPrompt);
  const command = getCliCommand(currentCli);
  logCliStartup({
    cli: currentCli,
    cwd,
    command,
    args: redactPromptArg(args, thinkingPrompt),
    env: sanitizeEnv(process.env),
    mode: "one-shot",
  });
  void logInfo("runPrompt-start", {
    cli: currentCli,
    command: getCliCommand(currentCli),
    args,
    cwd,
    sessionId,
    thinkingMode,
  });
  const userMessageId = createMessageId();
  const runId = createMessageId();
  activeRunId = runId;
  const processLabel = buildProcessLabel(currentCli, sessionId ?? runId);
  applyProcessTitle(runId, currentCli, sessionId);
  startTaskRun(runId, currentCli, sessionId, prompt);
  activeMessageTarget = messageTarget;
  activeSessionId = sessionId;
  activeCliForRun = currentCli;
  appendMessageToStore(messageTarget, {
    id: userMessageId,
    role: "user",
    content: prompt,
    createdAt: Date.now(),
  });
  const shouldDeferAssistant = true;
  if (!shouldDeferAssistant) {
    const assistantId = createMessageId();
    activeAssistantMessageId = assistantId;
    appendMessageToStore(messageTarget, {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    });
    activeMessageIndex = messageTarget.length - 1;
  } else {
    activeAssistantMessageId = undefined;
    activeMessageIndex = null;
  }
  const shouldParseClaudeStream = currentCli === "claude";
  let sessionBuffer = "";
  let claudeBuffer = "";
  let claudeStreamRemainder = "";
  let claudeStreamHasText = false;
  const claudeToolUseIds = new Set<string>();
  const claudeToolResultIds = new Set<string>();
  const claudeToolUseNames = new Map<string, string>();
  let rawStdout = "";
  let rawStderr = "";
  sendRunStatus("start");
  if (!shouldDeferAssistant && activeAssistantMessageId) {
    sendPanelMessage({
      type: "appendMessage",
      message: { id: activeAssistantMessageId, role: "assistant", content: "" },
    });
  }
  startTraceMessage(currentCli);
  activeTraceBuffer = "";
  activeTraceSegmentLines = [];
  skipUserBlock = false;
  skipCodexBlock = false;
  activeCompletionSent = false;
  const appendClaudeTraceMessage = (content: string): void => {
    if (!activeMessageTarget) {
      return;
    }
    const message = {
      id: createMessageId(),
      role: "trace" as const,
      content,
      createdAt: Date.now(),
    };
    appendMessageToStore(activeMessageTarget, message);
    sendPanelMessage({ type: "appendMessage", message });
  };
  const handleClaudeToolEvents = (events: ClaudeToolEvent[]): void => {
    if (!events.length) {
      return;
    }
    events.forEach((event) => {
      if (event.kind === "tool_use") {
        if (event.id && claudeToolUseIds.has(event.id)) {
          return;
        }
        if (event.id) {
          claudeToolUseIds.add(event.id);
        }
        if (event.id && event.name) {
          claudeToolUseNames.set(event.id, event.name);
        }
        if (event.name === "TodoWrite") {
          const items = extractTodoWriteItems(event.input);
          if (items.length) {
            sendPanelMessage({ type: "taskListUpdate", items });
          }
        }
        appendClaudeTraceMessage(formatClaudeToolUseMessage(event));
        return;
      }
      if (event.toolUseId && claudeToolResultIds.has(event.toolUseId)) {
        return;
      }
      if (event.toolUseId) {
        claudeToolResultIds.add(event.toolUseId);
      }
      const toolName = event.toolUseId ? claudeToolUseNames.get(event.toolUseId) : undefined;
      if (toolName === "Edit") {
        return;
      }
      appendClaudeTraceMessage(formatClaudeToolResultMessage(event, toolName));
    });
  };

  activeProcess = runCliStream(
    currentCli,
    thinkingPrompt,
    {
      onStdout: (chunk) => {
        rawStdout += chunk;
        let formattedOutput = "";
        if (shouldParseClaudeStream) {
          claudeBuffer += chunk;
          const parsed = parseClaudeStreamChunk(claudeStreamRemainder, chunk);
          claudeStreamRemainder = parsed.remainder;
          if (parsed.text) {
            claudeStreamHasText = true;
            appendAssistantChunk(parsed.text);
            formattedOutput = parsed.text;
          }
          if (parsed.toolEvents.length) {
            handleClaudeToolEvents(parsed.toolEvents);
          }
          if (parsed.sessionId) {
            adoptSessionId(currentCli, parsed.sessionId);
          }
        } else {
          appendAssistantChunk(chunk);
          formattedOutput = chunk;
          sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
          captureSessionFromBuffer(currentCli, sessionBuffer);
        }
        if (debugLogging) {
          void logCliStream(currentCli, activeSessionId, "stdout", chunk);
        }
        if (formattedOutput) {
          logModelOutput(formattedOutput);
        }
      },
      onStderr: (chunk) => {
        rawStderr += chunk;
        let formattedOutput = "";
        if (currentCli === "codex" || currentCli === "gemini") {
          appendTraceLines(chunk);
        }
        if (shouldParseClaudeStream) {
          claudeBuffer += chunk;
          const parsed = parseClaudeStreamChunk(claudeStreamRemainder, chunk);
          claudeStreamRemainder = parsed.remainder;
          if (parsed.text) {
            claudeStreamHasText = true;
            appendAssistantChunk(parsed.text);
            formattedOutput = parsed.text;
          }
          if (parsed.toolEvents.length) {
            handleClaudeToolEvents(parsed.toolEvents);
          }
          if (parsed.sessionId) {
            adoptSessionId(currentCli, parsed.sessionId);
          }
        } else {
          sessionBuffer = updateSessionBuffer(sessionBuffer, chunk);
          captureSessionFromBuffer(currentCli, sessionBuffer);
        }
        if (debugLogging) {
          void logCliStream(currentCli, activeSessionId, "stderr", chunk);
        }
        if (formattedOutput) {
          logModelOutput(formattedOutput);
        }
      },
      onExit: (code) => {
        if (activeRunId !== runId) {
          return;
        }
        void logInfo("runPrompt-exit", { cli: currentCli, code });
        if (shouldParseClaudeStream) {
          const flushed = parseClaudeStreamChunk(claudeStreamRemainder, "\n");
          claudeStreamRemainder = flushed.remainder;
          if (flushed.text) {
            claudeStreamHasText = true;
            appendAssistantChunk(flushed.text);
            logModelOutput(flushed.text);
          }
          if (flushed.toolEvents.length) {
            handleClaudeToolEvents(flushed.toolEvents);
          }
          if (flushed.sessionId) {
            adoptSessionId(currentCli, flushed.sessionId);
          }
          if (!claudeStreamHasText) {
            const parsed = parseClaudeStreamOutput(claudeBuffer);
            if (parsed.text) {
              appendAssistantChunk(parsed.text);
              logModelOutput(parsed.text);
              claudeStreamHasText = true;
            }
            if (parsed.toolEvents.length) {
              handleClaudeToolEvents(parsed.toolEvents);
            }
            if (parsed.sessionId) {
              adoptSessionId(currentCli, parsed.sessionId);
            } else if (!parsed.text) {
              const fallback = parseClaudeJsonOutput(claudeBuffer);
              if (fallback.text) {
                appendAssistantChunk(fallback.text);
                logModelOutput(fallback.text);
              }
              if (fallback.toolEvents.length) {
                handleClaudeToolEvents(fallback.toolEvents);
              }
              if (fallback.sessionId) {
                adoptSessionId(currentCli, fallback.sessionId);
              }
            }
          }
        }
        if (debugLogging) {
          void logCliRaw(currentCli, activeSessionId, {
            command,
            args,
            cwd,
            exitCode: code,
            stdin: thinkingPrompt,
            stdout: rawStdout,
            raw: rawStdout,
            stderr: rawStderr,
          });
        }
        const status = code === 0 ? "end" : "error";
        sendRunStatus(status, code === 0 ? undefined : `CLI 退出码: ${code ?? "unknown"}`);
        if (currentCli === "codex" || currentCli === "gemini") {
          flushTraceBuffer();
        }
        appendCompletionMessage(status);
        persistActiveMessages();
        clearActiveRun();
      },
      onError: (error) => {
        if (activeRunId !== runId) {
          return;
        }
        const errnoError = error as NodeJS.ErrnoException;
        const isNotFound = errnoError?.code === "ENOENT";
        const userMessage = isNotFound
          ? buildCliCommandNotFoundMessage(currentCli, command)
          : error.message;
        if (isNotFound) {
          void vscode.window.showErrorMessage(userMessage, "打开设置").then((selection) => {
            if (selection === "打开设置") {
              void vscode.commands.executeCommand(
                "workbench.action.openSettings",
                `sinitek-cli-tools.commands.${currentCli}`
              );
            }
          });
        }
        void logError("runPrompt-error", {
          cli: currentCli,
          error: isNotFound ? `${error.message} (ENOENT)` : error.message,
        });
        if (debugLogging) {
          void logCliRaw(currentCli, activeSessionId, {
            command,
            args,
            cwd,
            error: error.message,
            stdin: thinkingPrompt,
            stdout: rawStdout,
            raw: rawStdout,
            stderr: rawStderr,
          });
        }
        sendRunStatus("error", userMessage);
        if (currentCli === "codex" || currentCli === "gemini") {
          flushTraceBuffer();
        }
        appendCompletionMessage("error");
        persistActiveMessages();
        clearActiveRun();
      },
    },
      { cwd, sessionId, processLabel }
    );
  void logInfo("runPrompt-spawned", {
    cli: currentCli,
    pid: activeProcess?.pid ?? null,
  });
}

function getCompactPromptKey(cli: CliName, sessionId: string): string {
  return `${activeWorkspaceKey}:${cli}:${sessionId}`;
}

function estimateSessionSize(messages: ChatMessage[]): { turns: number; chars: number } {
  const turns = messages.filter((message) => message.role === "user" && message.content.trim()).length;
  const chars = messages.reduce((sum, message) => sum + (message.content?.length ?? 0), 0);
  return { turns, chars };
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
    "请把当前会话压缩为结构化摘要，输出必须是纯文本（不要 Markdown）。",
    "要求：",
    "1) 保留关键信息，避免冗余。",
    "2) 每条尽量短，必要时引用关键文件路径/命令/结论。",
    "3) 严格按照以下模板输出，并保持标题不变：",
    "",
    "【会话摘要】",
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
};

function isCommandExecutionTrace(content: string): boolean {
  const firstLine = content.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return false;
  }
  const trimmed = firstLine.trim();
  return trimmed.startsWith("exec") || trimmed.startsWith("【执行命令】");
}

function resolveTraceMerge(content: string, merge?: boolean): boolean {
  if (merge !== undefined) {
    return merge;
  }
  return !isCommandExecutionTrace(content);
}

function appendTraceMessage(
  content: string,
  kind: "thinking" | "normal" = "normal",
  options: TraceMessageOptions = {}
): void {
  if (!activeMessageTarget) {
    return;
  }
  if (!content.trim()) {
    return;
  }
  const shouldMerge = resolveTraceMerge(content, options.merge);
  const mergePayload = shouldMerge ? {} : { merge: false };
  const message: ChatMessage = {
    id: createMessageId(),
    role: "trace",
    content,
    createdAt: Date.now(),
    kind,
    ...mergePayload,
  };
  appendMessageToStore(activeMessageTarget, message);
  sendPanelMessage({ type: "traceSegment", content, kind, ...mergePayload });
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

async function runPromptInteractive(prompt: string): Promise<void> {
  if (!prompt) {
    return;
  }
  if (activeProcess || activeInteractiveStop) {
    stopActiveRun();
    void logInfo("runPrompt-preempt", { cli: currentCli });
  }

  const cli = currentCli;
  const cwd = resolveWorkspaceCwd();
  void logInfo("resolve-workspace-cwd-debug", {
    cwd,
    cwdType: cwd === undefined ? "undefined" : typeof cwd,
    workspaceFolders: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [],
  });
  const thinkingMode = getThinkingMode(cli);
  applyThinkingWorkspaceFiles(cli, thinkingMode, cwd);
  preparePendingLabel(cli, prompt);

  const sessionId = getCurrentSessionId(cli);
  const thinkingPrompt = buildThinkingPrompt(cli, thinkingMode, prompt, { includeSuffix: false });
  const debugLogging = getDebugLogging();
  const args = getCliArgs(cli);
  const command = getCliCommand(cli);
  const resolvedCommand = cli === "claude" ? resolveCliCommand(command) : null;
  const commandForRunner = cli === "claude"
    ? (resolvedCommand?.command ?? "claude")
    : command;
  logCliStartup({
    cli,
    cwd,
    command: commandForRunner,
    args,
    env: sanitizeEnv(process.env),
    mode: "interactive",
  });
  const claudeEntrypoint = cli === "claude"
    ? resolveClaudeInteractiveEntrypoint(resolvedCommand?.command ?? commandForRunner)
    : undefined;
  const messageTarget = sessionId ? loadSessionMessages(cli, sessionId) : pendingSessionMessages[cli];
  void logInfo("runPrompt-interactive-start", {
    cli,
    sessionId,
    thinkingMode,
    cwd,
    promptLength: prompt.length,
  });

  let shouldCompact = false;
  if (sessionId && (cli === "codex" || cli === "claude")) {
    const key = getCompactPromptKey(cli, sessionId);
    if (!suppressCompactPrompt.has(key)) {
      const size = estimateSessionSize(messageTarget);
      if (
        size.turns >= CONTEXT_COMPACT_TURN_THRESHOLD
        || size.chars >= CONTEXT_COMPACT_CHAR_THRESHOLD
      ) {
        void logInfo("context-compact-suggested", {
          cli,
          sessionId,
          turns: size.turns,
          chars: size.chars,
        });
        const selection = await vscode.window.showInformationMessage(
          `当前会话较长（轮数 ${size.turns} / 字符 ${size.chars}），建议压缩上下文以提升性能。`,
          "现在压缩",
          "这次跳过",
          "本会话不再提示"
        );
        void logInfo("context-compact-selection", {
          cli,
          sessionId,
          selection: selection ?? "dismissed",
        });
        if (selection === "本会话不再提示") {
          suppressCompactPrompt.add(key);
        } else if (selection === "现在压缩") {
          shouldCompact = true;
        }
      }
    }
  }

  const userMessageId = createMessageId();
  const runId = createMessageId();
  activeRunId = runId;
  applyProcessTitle(runId, cli, sessionId);
  startTaskRun(runId, cli, sessionId, prompt);
  activeMessageTarget = messageTarget;
  activeSessionId = sessionId;
  activeCliForRun = cli;

  appendMessageToStore(messageTarget, {
    id: userMessageId,
    role: "user",
    content: prompt,
    createdAt: Date.now(),
  });
  activeAssistantMessageId = undefined;
  activeMessageIndex = null;
  activeCompletionSent = false;

  let interactiveInput = thinkingPrompt;
  let rawStdout = "";
  let rawStderr = "";
  let didLogInteractiveIo = false;
  let didLogInteractiveStart = false;
  const startInteractiveLog = (input: string): void => {
    if (!debugLogging || didLogInteractiveStart) {
      return;
    }
    didLogInteractiveStart = true;
    interactiveInput = input;
    rawStdout = "";
    rawStderr = "";
    const logCommand = cli === "claude" ? commandForRunner : command;
    void logCliInteractiveStart(cli, activeSessionId, {
      command: logCommand,
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
    void logCliInteractiveOutput(cli, activeSessionId, "stdout", chunk);
  };
  const appendTraceLog = (content: string): void => {
    if (!debugLogging) {
      return;
    }
    if (!content.trim()) {
      return;
    }
    const normalized = content.endsWith("\n") ? content : content + "\n";
    rawStderr += normalized;
    startInteractiveLog(interactiveInput);
    void logCliInteractiveOutput(cli, activeSessionId, "trace", normalized);
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
    void logCliInteractiveOutput(cli, activeSessionId, "event", text);
  };
  const logInteractiveIo = (status: TaskRunStatus, userMessage?: string): void => {
    if (!debugLogging || didLogInteractiveIo) {
      return;
    }
    didLogInteractiveIo = true;
    void logCliRaw(cli, activeSessionId, {
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

  sendRunStatus("start");

  const cleanupAfterRun = (status: TaskRunStatus, userMessage?: string): void => {
    void logInfo("runPrompt-interactive-end", {
      cli,
      sessionId,
      runId,
      status,
      message: userMessage ?? null,
    });
    logInteractiveIo(status, userMessage);
    sendRunStatus(status === "end" ? "end" : status, userMessage);
    appendCompletionMessage(status);
    persistActiveMessages();
    clearActiveRun();
  };

  let stopCurrentTurn: (() => void) | null = null;

  const stopFn = (): void => {
    if (activeRunId !== runId) {
      return;
    }
    void logInfo("runPrompt-interactive-stop-requested", { cli, sessionId, runId });
    // Prevent re-entry; also ensures later abort errors won't clobber UI state.
    if (activeInteractiveStop === stopFn) {
      activeInteractiveStop = null;
    }
    const removedPlaceholder = removeActiveAssistantPlaceholder();
    appendStopMessageToStore();
    try {
      stopCurrentTurn?.();
    } catch {
      // ignore
    }
    logInteractiveIo("stopped", "用户已终止");
    interactiveRunnerManager?.stopCurrentTurnAndRebuild();
    void logInfo("runPrompt-stopped", { cli });
    sendRunStatus("stopped", "用户已终止");
    appendCompletionMessage("stopped");
    if (removedPlaceholder && activeAssistantMessageId) {
      sendPanelMessage({ type: "removeMessage", id: activeAssistantMessageId });
    }
    persistActiveMessages();
    clearActiveRun();
  };
  activeInteractiveStop = stopFn;

  const ensureSessionIdForNewSession = (newId: string): void => {
    if (getCurrentSessionId(cli)) {
      return;
    }
    adoptSessionId(cli, newId);
    upsertInteractiveMapping(cli, newId, newId);
  };

  try {
    if (cli === "codex") {
      const mappedThreadId = sessionId ? resolveInteractiveMappedId(cli, sessionId) : null;
      let runner = sessionId
        ? interactiveRunnerManager.getOrCreateCodexRunner({
            sessionId,
            threadId: mappedThreadId,
            command,
            args,
            cwd: cwd ?? undefined,
            thinkingMode,
          })
        : new (await import("./interactive/codexRunner")).CodexInteractiveRunner({
            command,
            args,
            cwd: cwd ?? undefined,
            thinkingMode,
            threadId: null,
          });

      let compactionSummary: string | null = null;
      let oldThreadId: string | null = null;
      let freezeOldThreadId: string | null = null;

      if (shouldCompact && sessionId) {
        oldThreadId = mappedThreadId;
        try {
          stopCurrentTurn = () => runner.stopAndRebuild();
          const summaryResult = await runner.runForText(buildCompactionPrompt());
          compactionSummary = summaryResult.text.trim() ? summaryResult.text.trim() : null;
        } catch (error) {
          compactionSummary = null;
          appendSystemMessage("上下文压缩失败（摘要任务执行异常），已继续原始请求。");
          void logError("context-compact-summary-failed", {
            cli,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (compactionSummary && oldThreadId) {
          void logInfo("context-compact-summary", {
            cli,
            sessionId,
            oldThreadId,
            summaryLength: compactionSummary.length,
          });
          // Freeze happens when new thread starts (so we can record old->new).
          freezeOldThreadId = oldThreadId;
          const recent = extractRecentTurns(messageTarget, KEEP_RECENT_TURNS);
          const bootstrap = [
            "你正在继续一个已压缩上下文的会话。",
            "",
            compactionSummary,
            "",
            "【最近对话】",
            formatTurnsForBootstrap(recent),
            "【当前请求】",
            thinkingPrompt,
          ].join("\n");

          // Create a brand new thread for the real user prompt.
          runner.dispose();
          runner = new (await import("./interactive/codexRunner")).CodexInteractiveRunner({
            command,
            args,
            cwd: cwd ?? undefined,
            thinkingMode,
            threadId: null,
          });

          stopCurrentTurn = () => runner.stopAndRebuild();
          startInteractiveLog(bootstrap);
          await runner.runStreamed(bootstrap, {
            onAssistantDelta: (chunk) => {
              if (activeRunId !== runId) {
                return;
              }
              appendAssistantChunk(chunk);
              appendDebugStdout(chunk);
            },
            onTrace: (content, kind, meta) => {
              if (activeRunId !== runId) {
                return;
              }
              appendTraceMessage(content, kind === "thinking" ? "thinking" : "normal", meta);
              appendTraceLog(content);
            },
            onEvent: (event) => {
              if (activeRunId !== runId) {
                return;
              }
              appendDebugEvent(event);
            },
            onTaskListUpdate: (items) => {
              sendPanelMessage({ type: "taskListUpdate", items });
            },
            onThreadId: (threadId) => {
              updateProcessTitle(cli, threadId);
              if (!sessionId) {
                ensureSessionIdForNewSession(threadId);
                void logInfo("runPrompt-interactive-codex-thread", {
                  cli,
                  sessionId: threadId,
                  threadId,
                  originalSessionId: null,
                  mode: "compaction",
                });
                interactiveRunnerManager.setCurrentRunner("codex", threadId, runner, thinkingMode);
                return;
              }
              if (freezeOldThreadId) {
                upsertInteractiveMapping(cli, sessionId, threadId, { freezePrevious: freezeOldThreadId });
                appendSystemMessage(`【会话摘要】已压缩：${freezeOldThreadId} -> ${threadId}`);
                if (compactionSummary) {
                  appendTraceMessage(compactionSummary);
                }
                void logInfo("runPrompt-interactive-codex-thread-compacted", {
                  cli,
                  sessionId,
                  threadId,
                  previousThreadId: freezeOldThreadId,
                });
                interactiveRunnerManager.setCurrentRunner("codex", sessionId, runner, thinkingMode);
              }
            },
          });
          cleanupAfterRun("end");
          return;
        }
      }

      // Normal interactive run (no compaction)
      let uiSessionId: string | null = sessionId;
      stopCurrentTurn = () => runner.stopAndRebuild();
      startInteractiveLog(thinkingPrompt);
      await runner.runStreamed(thinkingPrompt, {
        onAssistantDelta: (chunk) => {
          if (activeRunId !== runId) {
            return;
          }
          appendAssistantChunk(chunk);
          appendDebugStdout(chunk);
        },
        onTrace: (content, kind, meta) => {
          if (activeRunId !== runId) {
            return;
          }
          appendTraceMessage(content, kind === "thinking" ? "thinking" : "normal", meta);
          appendTraceLog(content);
        },
        onEvent: (event) => {
          if (activeRunId !== runId) {
            return;
          }
          appendDebugEvent(event);
        },
        onTaskListUpdate: (items) => {
          sendPanelMessage({ type: "taskListUpdate", items });
        },
        onThreadId: (threadId) => {
          updateProcessTitle(cli, threadId);
          if (!uiSessionId) {
            ensureSessionIdForNewSession(threadId);
            uiSessionId = threadId;
          } else {
            upsertInteractiveMapping(cli, uiSessionId, threadId);
          }
          void logInfo("runPrompt-interactive-codex-thread", {
            cli,
            sessionId: uiSessionId,
            threadId,
            originalSessionId: sessionId,
            mode: "normal",
          });
          interactiveRunnerManager.setCurrentRunner("codex", uiSessionId, runner, thinkingMode);
        },
      });
      cleanupAfterRun("end");
      return;
    }

    if (cli === "claude") {
      const mappedSessionId = sessionId ? resolveInteractiveMappedId(cli, sessionId) : null;
      let runner = sessionId
        ? interactiveRunnerManager.getOrCreateClaudeRunner({
            sessionId,
            mappedSessionId,
            command: commandForRunner,
            args,
            cwd: cwd ?? undefined,
            thinkingMode,
          })
        : new (await import("./interactive/claudeRunner")).ClaudeInteractiveRunner({
            command: commandForRunner,
            args,
            cwd: cwd ?? undefined,
            thinkingMode,
            sessionId: null,
          });

      let compactionSummary: string | null = null;
      const oldId = mappedSessionId;

      if (shouldCompact && sessionId) {
        try {
          stopCurrentTurn = () => runner.stopAndRebuild();
          const summaryResult = await runner.runForText(buildCompactionPrompt());
          compactionSummary = summaryResult.text.trim() ? summaryResult.text.trim() : null;
        } catch (error) {
          compactionSummary = null;
          appendSystemMessage("上下文压缩失败（摘要任务执行异常），已继续原始请求。");
          void logError("context-compact-summary-failed", {
            cli,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (compactionSummary && oldId) {
          void logInfo("context-compact-summary", {
            cli,
            sessionId,
            oldThreadId: oldId,
            summaryLength: compactionSummary.length,
          });
          const recent = extractRecentTurns(messageTarget, KEEP_RECENT_TURNS);
          const bootstrap = [
            "你正在继续一个已压缩上下文的会话。",
            "",
            compactionSummary,
            "",
            "【最近对话】",
            formatTurnsForBootstrap(recent),
            "【当前请求】",
            thinkingPrompt,
          ].join("\n");

          runner.dispose();
          runner = new (await import("./interactive/claudeRunner")).ClaudeInteractiveRunner({
            command: commandForRunner,
            args,
            cwd: cwd ?? undefined,
            thinkingMode,
            sessionId: null,
          });

          stopCurrentTurn = () => runner.stopAndRebuild();
          startInteractiveLog(bootstrap);
          await runner.runStreamed(bootstrap, {
            onAssistantDelta: (chunk) => {
              if (activeRunId !== runId) {
                return;
              }
              appendAssistantChunk(chunk);
              appendDebugStdout(chunk);
            },
            onTrace: (content) => {
              if (activeRunId !== runId) {
                return;
              }
              appendTraceMessage(content);
              appendTraceLog(content);
            },
            onEvent: (event) => {
              if (activeRunId !== runId) {
                return;
              }
              appendDebugEvent(event);
            },
            onTaskListUpdate: (items) => {
              sendPanelMessage({ type: "taskListUpdate", items });
            },
            onSessionId: (newSessionId) => {
              updateProcessTitle(cli, newSessionId);
              upsertInteractiveMapping(cli, sessionId, newSessionId, { freezePrevious: oldId });
              appendSystemMessage(`【会话摘要】已压缩：${oldId} -> ${newSessionId}`);
              if (compactionSummary) {
                appendTraceMessage(compactionSummary);
              }
              void logInfo("runPrompt-interactive-claude-session-compacted", {
                cli,
                sessionId,
                newSessionId,
                previousSessionId: oldId,
              });
              interactiveRunnerManager.setCurrentRunner("claude", sessionId, runner, thinkingMode);
            },
          });
          cleanupAfterRun("end");
          return;
        }
      }

      let uiSessionId: string | null = sessionId;
      stopCurrentTurn = () => runner.stopAndRebuild();
      startInteractiveLog(thinkingPrompt);
      await runner.runStreamed(thinkingPrompt, {
        onAssistantDelta: (chunk) => {
          if (activeRunId !== runId) {
            return;
          }
          appendAssistantChunk(chunk);
          appendDebugStdout(chunk);
        },
        onTrace: (content) => {
          if (activeRunId !== runId) {
            return;
          }
          appendTraceMessage(content);
          appendTraceLog(content);
        },
        onEvent: (event) => {
          if (activeRunId !== runId) {
            return;
          }
          appendDebugEvent(event);
        },
        onTaskListUpdate: (items) => {
          sendPanelMessage({ type: "taskListUpdate", items });
        },
        onSessionId: (newSessionId) => {
          updateProcessTitle(cli, newSessionId);
          if (!uiSessionId) {
            ensureSessionIdForNewSession(newSessionId);
            uiSessionId = newSessionId;
          } else {
            upsertInteractiveMapping(cli, uiSessionId, newSessionId);
          }
          void logInfo("runPrompt-interactive-claude-session", {
            cli,
            sessionId: uiSessionId,
            newSessionId,
            originalSessionId: sessionId,
            mode: "normal",
          });
          interactiveRunnerManager.setCurrentRunner("claude", uiSessionId, runner, thinkingMode);
        },
      });
      cleanupAfterRun("end");
      return;
    }

    // Unsupported: fall back to one-shot.
    await runPromptOneShot(prompt);
  } catch (error) {
    if (activeRunId !== runId) {
      // This run was preempted/stopped; ignore errors from aborted streams.
      return;
    }
    const info = getErrorInfo(error);
    if (isAbortErrorInfo(info)) {
      void logInfo("runPrompt-interactive-aborted", {
        cli,
        error: info.message,
        errorName: info.name,
        errorCode: info.code,
        errorStack: info.stack,
      });
      cleanupAfterRun("stopped", "运行已终止");
      return;
    }
    void logError("runPrompt-interactive-error", {
      cli,
      error: info.message,
      errorName: info.name,
      errorCode: info.code,
      errorStack: info.stack,
    });
    cleanupAfterRun("error", error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    if (activeInteractiveStop === stopFn) {
      activeInteractiveStop = null;
    }
  }
}

function buildCliCommandNotFoundMessage(cli: CliName, command: string): string {
  const configKey = `sinitek-cli-tools.commands.${cli}`;
  if (process.platform === "win32") {
    return [
      `找不到 CLI 可执行文件：${command}`,
      `请确认已安装且 VS Code 可访问 PATH；或在设置中把 ${configKey} 配置为绝对路径（常见为 %APPDATA%\\\\npm\\\\${command}.cmd）。`,
      `在 PowerShell 运行：where ${command}`,
      "提示：安装/修改 PATH 后需重启 VS Code。",
    ].join("\n");
  }
  return [
    `找不到 CLI 可执行文件：${command}`,
    `请确认已安装且 PATH 可见；或在设置中把 ${configKey} 配置为绝对路径。`,
    `在终端运行：which ${command}`,
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
  sendRunStatus("stopped", "用户已终止");
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
  if (pendingWorkspaceKey) {
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
    content: "用户已终止",
    createdAt: Date.now(),
  });
}

function appendAssistantChunk(chunk: string): void {
  ensureAssistantMessage();
  if (!activeAssistantMessageId) {
    return;
  }
  void logDebug("assistant-chunk", {
    id: activeAssistantMessageId,
    size: chunk.length,
  });
  sendPanelMessage({
    type: "assistantDelta",
    id: activeAssistantMessageId,
    content: chunk,
  });
  appendAssistantChunkToStore(chunk);
}

function ensureAssistantMessage(): void {
  if (activeAssistantMessageId) {
    return;
  }
  if (!activeMessageTarget) {
    return;
  }
  const assistantId = createMessageId();
  activeAssistantMessageId = assistantId;
  appendMessageToStore(activeMessageTarget, {
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
  });
  activeMessageIndex = activeMessageTarget.length - 1;
  sendPanelMessage({
    type: "appendMessage",
    message: { id: assistantId, role: "assistant", content: "" },
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
  const shouldMerge = resolveTraceMerge(displayContent);
  const mergePayload = shouldMerge ? {} : { merge: false };
  activeTraceSegmentLines = [];
  if (activeCliForRun === "codex" && kind === "thinking") {
    appendAssistantChunk(`${displayContent}\n`);
    return;
  }
  if (activeMessageTarget && shouldPersist && execShouldPersist) {
    appendMessageToStore(activeMessageTarget, {
      id: createMessageId(),
      role: "trace",
      content: displayContent,
      createdAt: Date.now(),
      ...mergePayload,
    });
  }
  sendPanelMessage({
    type: "traceSegment",
    content: displayContent,
    kind,
    ...mergePayload,
  });
}

function formatCodexExecSegmentForDisplay(
  content: string
): { content: string; shouldPersist: boolean } {
  if (activeCliForRun !== "codex") {
    return { content, shouldPersist: true };
  }
  const lines = content.split("\n");
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex === -1) {
    return { content, shouldPersist: true };
  }
  const firstLine = lines[firstLineIndex].trim();
  if (!firstLine.startsWith("exec")) {
    return { content, shouldPersist: true };
  }
  let commandLine = firstLine;
  if (firstLine === "exec" || firstLine === "exec:") {
    const nextLine = lines
      .slice(firstLineIndex + 1)
      .map((line) => line.trim())
      .find((line) => line.length);
    if (nextLine) {
      const normalized = nextLine.replace(/^\$\s*/, "");
      commandLine = `exec ${normalized}`;
    }
  } else if (firstLine.startsWith("exec:")) {
    const normalized = firstLine.slice("exec:".length).trim();
    if (normalized) {
      commandLine = `exec ${normalized}`;
    }
  }
  return { content: commandLine, shouldPersist: true };
}

function formatTraceSegmentForDisplay(content: string): { content: string; shouldPersist: boolean } {
  const lines = content.split("\n");
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex === -1) {
    return { content, shouldPersist: true };
  }
  const firstLine = lines[firstLineIndex].trim();
  if (!firstLine.startsWith("file update")) {
    return { content, shouldPersist: true };
  }
  const nextLineIndex = lines.findIndex((line, index) => index > firstLineIndex && line.trim());
  if (nextLineIndex === -1) {
    return { content, shouldPersist: true };
  }
  const nextLine = lines[nextLineIndex].trim();
  if (!nextLine.startsWith("diff --git")) {
    return { content, shouldPersist: true };
  }
  return {
    content: [lines[firstLineIndex], lines[nextLineIndex]].join("\n"),
    shouldPersist: false,
  };
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
      || trimmed.startsWith("exec")
      || trimmed.startsWith("file update")
      || trimmed.startsWith("apply_patch")
      || trimmed.startsWith("warning")
      || trimmed.startsWith("error")
  );
}

function getTraceSegmentKind(content: string): "thinking" | "normal" {
  const firstLine = content.split("\n").find((line) => line.trim()) ?? "";
  return firstLine.trim().startsWith("thinking") ? "thinking" : "normal";
}

function startTaskRun(runId: string, cli: CliName, sessionId: string | null, prompt: string): void {
  activeTaskRun = {
    id: runId,
    cli,
    sessionId,
    prompt,
    startedAt: Date.now(),
  };
}

function appendCompletionMessage(status: TaskRunStatus): void {
  if (activeCompletionSent) {
    return;
  }
  const taskRecord = finalizeTaskRun(activeRunId, status);
  const durationText = taskRecord ? formatDuration(taskRecord.durationMs) : null;
  const message = {
    id: createMessageId(),
    role: "system" as const,
    content: durationText ? `任务已完成,执行 ${durationText}` : "任务已完成",
    createdAt: Date.now(),
  };
  activeCompletionSent = true;
  if (!activeMessageTarget) {
    return;
  }
  appendMessageToStore(activeMessageTarget, message);
  sendPanelMessage({ type: "appendMessage", message });
}

function sendRunStatus(status: "start" | "end" | "error" | "stopped", message?: string): void {
  sendPanelMessage({
    type: "runStatus",
    status,
    message,
  });
}

function sendPanelMessage(payload: Record<string, unknown>): void {
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
    return { runs: parsed.runs as TaskRunRecord[] };
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

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}

function loadSessionStore(): SessionStore {
  const stored = readSessionFile() ?? extensionContext.globalState.get<SessionStore>(getSessionStoreKey());
  const normalized = ensureSessionStore(stored);
  void persistSessionStore(normalized);
  return normalized;
}

function ensureSessionStore(store?: SessionStore): SessionStore {
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
      result[cli] = {
        currentId: current.currentId ?? null,
        sessions: Array.isArray(current.sessions)
          ? current.sessions.map((session) => ({
              id: session.id,
              label: session.label ?? "未命名会话",
              createdAt: session.createdAt ?? Date.now(),
              lastUsedAt: session.lastUsedAt ?? Date.now(),
            }))
          : [],
      };
    }
  }
  return result;
}

function buildSessionState(cli: CliName): { currentSessionId: string | null; sessions: SessionSummary[] } {
  const allSessions: SessionSummary[] = [];
  for (const item of CLI_LIST) {
    const records = sessionStore[item]?.sessions ?? [];
    records.forEach((record) => {
      allSessions.push({
        id: record.id,
        label: record.label,
        lastUsedAt: record.lastUsedAt,
        cli: item,
      });
    });
  }
  const sessions = allSessions.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return {
    currentSessionId: sessionStore[cli]?.currentId ?? null,
    sessions,
  };
}

function ensureLatestSessionForCli(cli: CliName): void {
  const latestSessionId = getLatestSessionId(cli);
  if (!latestSessionId) {
    return;
  }
  if (getCurrentSessionId(cli) === latestSessionId) {
    return;
  }
  setCurrentSession(cli, latestSessionId);
}

function getLatestSessionId(cli: CliName): string | null {
  const sessions = sessionStore[cli]?.sessions ?? [];
  if (sessions.length === 0) {
    return null;
  }
  const latest = sessions.reduce((prev, current) =>
    current.lastUsedAt > prev.lastUsedAt ? current : prev
  );
  return latest.id;
}

function getCurrentSessionId(cli: CliName): string | null {
  return sessionStore[cli]?.currentId ?? null;
}

function setCurrentSession(cli: CliName, sessionId: string | null): void {
  if (!sessionStore[cli]) {
    sessionStore[cli] = { currentId: null, sessions: [] };
  }
  sessionStore[cli].currentId = sessionId;
  if (sessionId) {
    touchSession(cli, sessionId);
  }
  void persistSessionStore(sessionStore);
  void logInfo("session-selected", { cli, sessionId });
}

function startNewSession(cli: CliName): void {
  pendingSessionLabels[cli] = null;
  pendingSessionMessages[cli] = [];
  setCurrentSession(cli, null);
  void logInfo("session-new", { cli });
}

function captureSessionFromBuffer(cli: CliName, buffer: string): void {
  const sessionId = extractSessionId(cli, buffer);
  if (!sessionId) {
    return;
  }
  adoptSessionId(cli, sessionId);
}

function touchSession(cli: CliName, sessionId: string): void {
  const now = Date.now();
  const sessions = sessionStore[cli].sessions;
  const existing = sessions.find((item) => item.id === sessionId);
  if (existing) {
    existing.lastUsedAt = now;
    return;
  }
  sessions.push({ id: sessionId, label: "未命名会话", createdAt: now, lastUsedAt: now });
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

function ensureLocalSession(cli: CliName): void {
  if (cli !== "gemini") {
    return;
  }
  if (getCurrentSessionId(cli)) {
    return;
  }
  const pending = pendingSessionMessages[cli];
  if (!pending || pending.length === 0) {
    return;
  }
  adoptSessionId(cli, createLocalSessionId());
}

function preparePendingLabel(cli: CliName, prompt: string): void {
  if (getCurrentSessionId(cli)) {
    return;
  }
  if (pendingSessionLabels[cli]) {
    return;
  }
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return;
  }
  pendingSessionLabels[cli] = trimmed.slice(0, SESSION_LABEL_LIMIT);
}

function assignPendingLabel(cli: CliName, sessionId: string): void {
  const label = pendingSessionLabels[cli];
  if (!label) {
    return;
  }
  const sessions = sessionStore[cli].sessions;
  const existing = sessions.find((item) => item.id === sessionId);
  if (existing && existing.label === "未命名会话") {
    existing.label = label;
  }
  pendingSessionLabels[cli] = null;
  void persistSessionStore(sessionStore);
  void postPanelState();
}

function appendMessageToStore(target: ChatMessage[], message: ChatMessage): void {
  target.push(message);
}

function appendAssistantChunkToStore(chunk: string): void {
  if (!activeMessageTarget || activeMessageIndex === null) {
    return;
  }
  const message = activeMessageTarget[activeMessageIndex];
  if (!message || message.role !== "assistant") {
    return;
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
    pendingSessionMessages[activeCliForRun] = activeMessageTarget;
    ensureLocalSession(activeCliForRun);
    return;
  }
  saveSessionMessages(activeCliForRun, activeSessionId, activeMessageTarget);
}

function attachPendingMessages(cli: CliName, sessionId: string): void {
  const pending = pendingSessionMessages[cli];
  if (!pending || pending.length === 0) {
    return;
  }
  const existing = loadSessionMessages(cli, sessionId);
  const merged = [...existing, ...pending];
  pendingSessionMessages[cli] = [];
  saveSessionMessages(cli, sessionId, merged);
  if (activeCliForRun === cli && activeSessionId === null) {
    activeSessionId = sessionId;
    activeMessageTarget = merged;
    activeMessageIndex = merged.length - 1;
  }
}

function getSessionStoreKey(): string {
  return `${SESSION_STORE_KEY}:${activeWorkspaceKey}`;
}

function getSessionFilePath(): string {
  if (activeWorkspaceKey === WORKSPACE_KEY_FALLBACK) {
    return LEGACY_SESSION_FILE;
  }
  return path.join(SESSION_DIR, `${activeWorkspaceKey}.json`);
}

function getSessionMetaFilePath(): string {
  if (activeWorkspaceKey === WORKSPACE_KEY_FALLBACK) {
    return path.join(DATA_DIR, "sessions.meta.json");
  }
  return path.join(SESSION_DIR, `${activeWorkspaceKey}.meta.json`);
}

function readSessionMetaStore(): ReturnType<typeof readSessionMeta> {
  return readSessionMeta(getSessionMetaFilePath());
}

function writeSessionMetaStore(meta: ReturnType<typeof readSessionMeta>): void {
  writeSessionMeta(getSessionMetaFilePath(), meta);
}

function resolveInteractiveMappedId(cli: CliName, sessionId: string): string {
  const meta = readSessionMetaStore();
  const mapped = getMappedThreadId(meta, cli, sessionId);
  return mapped ?? sessionId;
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

function getMessageDir(): string {
  if (activeWorkspaceKey === WORKSPACE_KEY_FALLBACK) {
    return LEGACY_MESSAGE_DIR;
  }
  return path.join(MESSAGE_DIR_ROOT, activeWorkspaceKey);
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

function getSessionKey(cli: CliName, sessionId: string): string {
  return `${activeWorkspaceKey}:${cli}:${sessionId}`;
}

function getMessageFile(cli: CliName, sessionId: string): string {
  return path.join(getMessageDir(), cli, `${sessionId}.json`);
}

function loadSessionMessages(cli: CliName, sessionId: string): ChatMessage[] {
  const key = getSessionKey(cli, sessionId);
  const cached = sessionMessageCache.get(key);
  if (cached) {
    return cached;
  }
  const messages = readMessageFile(cli, sessionId);
  const sanitized = sanitizeMessages(messages);
  if (sanitized.changed) {
    writeMessageFile(cli, sessionId, sanitized.messages);
  }
  sessionMessageCache.set(key, sanitized.messages);
  return sanitized.messages;
}

function saveSessionMessages(cli: CliName, sessionId: string, messages: ChatMessage[]): void {
  const key = getSessionKey(cli, sessionId);
  const sanitized = sanitizeMessages(messages);
  sessionMessageCache.set(key, sanitized.messages);
  writeMessageFile(cli, sessionId, sanitized.messages);
}

function readMessageFile(cli: CliName, sessionId: string): ChatMessage[] {
  try {
    const filePath = getMessageFile(cli, sessionId);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.messages)) {
      return [];
    }
    return parsed.messages as ChatMessage[];
  } catch (error) {
    void logError("session-messages-read-error", { error: String(error) });
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
    if (
      (message.role === "assistant" || message.role === "trace")
      && !message.content.trim()
    ) {
      if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === "user") {
        cleaned.pop();
        changed = true;
      }
      changed = true;
      continue;
    }
    cleaned.push(message);
  }
  return { messages: changed ? cleaned : messages, changed };
}

function sendSessionMessagesToPanel(cli: CliName, sessionId: string | null): void {
  if (!sessionId) {
    sendPanelMessage({ type: "setMessages", messages: [] });
    return;
  }
  const messages = loadSessionMessages(cli, sessionId);
  sendPanelMessage({
    type: "setMessages",
    messages,
  });
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

function readSessionFile(): SessionStore | undefined {
  try {
    const sessionFile = getSessionFilePath();
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

function writeSessionFile(store: SessionStore): void {
  try {
    const sessionFile = getSessionFilePath();
    const dirPath = path.dirname(sessionFile);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(sessionFile, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    void logError("session-file-write-error", { error: String(error) });
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

function adoptSessionId(cli: CliName, sessionId: string): void {
  const current = getCurrentSessionId(cli);
  if (current === sessionId) {
    return;
  }
  setCurrentSession(cli, sessionId);
  assignPendingLabel(cli, sessionId);
  attachPendingMessages(cli, sessionId);
  updateProcessTitle(cli, sessionId);
  void postPanelState();
  void logInfo("session-detected", { cli, sessionId });
}

type ClaudeToolEvent =
  | { kind: "tool_use"; id?: string; name?: string; input?: unknown }
  | { kind: "tool_result"; toolUseId?: string; content?: unknown };

type TaskListItem = {
  text: string;
  done: boolean;
};

type ClaudeJsonParseResult = {
  text: string;
  sessionId?: string;
  toolEvents: ClaudeToolEvent[];
};

type ClaudeStreamParseResult = {
  text: string;
  sessionId?: string;
  remainder: string;
  toolEvents: ClaudeToolEvent[];
};

function parseClaudeJsonOutput(raw: string): ClaudeJsonParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { text: "", toolEvents: [] };
  }
  const jsonText = extractJsonObject(trimmed);
  if (!jsonText) {
    return { text: trimmed, toolEvents: [] };
  }
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const text = extractClaudeText(parsed) ?? trimmed;
    const sessionId = extractClaudeSessionId(parsed);
    const toolEvents = extractClaudeToolEvents(parsed);
    return { text, sessionId, toolEvents };
  } catch (error) {
    void logError("claude-json-parse-error", { error: String(error) });
    return { text: trimmed, toolEvents: [] };
  }
}

function parseClaudeStreamChunk(remainder: string, chunk: string): ClaudeStreamParseResult {
  const combined = remainder + chunk;
  const lines = combined.split(/\r?\n/);
  const nextRemainder = lines.pop() ?? "";
  let text = "";
  let sessionId: string | undefined;
  const toolEvents: ClaudeToolEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("event:")) {
      continue;
    }
    if (trimmed.startsWith("data:")) {
      const dataValue = trimmed.slice(5).trim();
      if (!dataValue || dataValue === "[DONE]") {
        continue;
      }
      const parsed = parseClaudeStreamLine(dataValue);
      if (parsed.text) {
        text += parsed.text;
      }
      if (parsed.toolEvents.length) {
        toolEvents.push(...parsed.toolEvents);
      }
      if (!sessionId && parsed.sessionId) {
        sessionId = parsed.sessionId;
      }
      continue;
    }
    const parsed = parseClaudeStreamLine(trimmed);
    if (parsed.text) {
      text += parsed.text;
    }
    if (parsed.toolEvents.length) {
      toolEvents.push(...parsed.toolEvents);
    }
    if (!sessionId && parsed.sessionId) {
      sessionId = parsed.sessionId;
    }
  }
  return { text, sessionId, remainder: nextRemainder, toolEvents };
}

function parseClaudeStreamLine(
  value: string
): { text: string; sessionId?: string; toolEvents: ClaudeToolEvent[] } {
  let payload: Record<string, unknown> | undefined;
  try {
    payload = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { text: "", toolEvents: [] };
  }
  const delta = extractClaudeStreamText(payload) ?? extractClaudeText(payload);
  const sessionId = extractClaudeSessionId(payload);
  const toolEvents = extractClaudeToolEvents(payload);
  return { text: delta ?? "", sessionId, toolEvents };
}

function parseClaudeStreamOutput(raw: string): { text: string; sessionId?: string; toolEvents: ClaudeToolEvent[] } {
  const lines = raw.split(/\r?\n/);
  let text = "";
  let sessionId: string | undefined;
  const toolEvents: ClaudeToolEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("event:")) {
      continue;
    }
    if (trimmed.startsWith("data:")) {
      const dataValue = trimmed.slice(5).trim();
      if (!dataValue || dataValue === "[DONE]") {
        continue;
      }
      const parsed = parseClaudeStreamLine(dataValue);
      if (parsed.text) {
        text += parsed.text;
      }
      if (parsed.toolEvents.length) {
        toolEvents.push(...parsed.toolEvents);
      }
      if (!sessionId && parsed.sessionId) {
        sessionId = parsed.sessionId;
      }
      continue;
    }
    const parsed = parseClaudeStreamLine(trimmed);
    if (parsed.text) {
      text += parsed.text;
    }
    if (parsed.toolEvents.length) {
      toolEvents.push(...parsed.toolEvents);
    }
    if (!sessionId && parsed.sessionId) {
      sessionId = parsed.sessionId;
    }
  }
  return { text, sessionId, toolEvents };
}

function extractClaudeStreamText(payload: Record<string, unknown>): string | undefined {
  const delta = payload.delta;
  if (delta && typeof delta === "object") {
    const deltaRecord = delta as Record<string, unknown>;
    const deltaText = deltaRecord.text ?? deltaRecord.content;
    if (typeof deltaText === "string") {
      return deltaText;
    }
    const deltaContent = deltaRecord.delta;
    if (deltaContent && typeof deltaContent === "object") {
      const nested = deltaContent as Record<string, unknown>;
      const nestedText = nested.text ?? nested.content;
      if (typeof nestedText === "string") {
        return nestedText;
      }
    }
  }
  const contentBlock = payload.content_block ?? payload.contentBlock;
  if (contentBlock && typeof contentBlock === "object") {
    const blockRecord = contentBlock as Record<string, unknown>;
    const blockText = blockRecord.text ?? blockRecord.content;
    if (typeof blockText === "string") {
      return blockText;
    }
  }
  const outputText = payload.output_text;
  if (typeof outputText === "string") {
    return outputText;
  }
  return undefined;
}

function extractClaudeToolEvents(payload: Record<string, unknown>): ClaudeToolEvent[] {
  const events: ClaudeToolEvent[] = [];
  const message = payload.message;
  if (message && typeof message === "object") {
    events.push(...extractClaudeToolEventsFromMessage(message as Record<string, unknown>));
  }
  const event = payload.event;
  if (event && typeof event === "object") {
    const eventMessage = (event as Record<string, unknown>).message;
    if (eventMessage && typeof eventMessage === "object") {
      events.push(...extractClaudeToolEventsFromMessage(eventMessage as Record<string, unknown>));
    }
  }
  return events;
}

function extractClaudeToolEventsFromMessage(message: Record<string, unknown>): ClaudeToolEvent[] {
  const content = message.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const events: ClaudeToolEvent[] = [];
  content.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type === "tool_use") {
      const id = typeof record.id === "string" ? record.id : undefined;
      const name = typeof record.name === "string" ? record.name : undefined;
      events.push({ kind: "tool_use", id, name, input: record.input });
      return;
    }
    if (type === "tool_result") {
      const toolUseId =
        typeof record.tool_use_id === "string"
          ? record.tool_use_id
          : typeof record.toolUseId === "string"
            ? record.toolUseId
            : undefined;
      events.push({ kind: "tool_result", toolUseId, content: record.content });
    }
  });
  return events;
}

function extractTodoWriteItems(input: unknown): TaskListItem[] {
  if (typeof input === "string") {
    try {
      return extractTodoWriteItems(JSON.parse(input));
    } catch {
      return [];
    }
  }
  if (!input || typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  const todos = record.todos;
  if (!Array.isArray(todos)) {
    return [];
  }
  return todos
    .map((todo) => {
      if (!todo || typeof todo !== "object") {
        return null;
      }
      const todoRecord = todo as Record<string, unknown>;
      const text =
        typeof todoRecord.content === "string"
          ? todoRecord.content
          : typeof todoRecord.text === "string"
            ? todoRecord.text
            : "";
      if (!text.trim()) {
        return null;
      }
      const status = typeof todoRecord.status === "string" ? todoRecord.status.toLowerCase() : "";
      const done =
        typeof todoRecord.done === "boolean"
          ? todoRecord.done
          : typeof todoRecord.completed === "boolean"
            ? todoRecord.completed
            : status === "completed";
      return { text: text.trim(), done: Boolean(done) };
    })
    .filter((item): item is TaskListItem => Boolean(item));
}

function formatClaudeToolPayload(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatClaudeToolUseMessage(event: Extract<ClaudeToolEvent, { kind: "tool_use" }>): string {
  const header = event.name ? `调用工具: ${event.name}` : "调用工具";
  const input =
    event.name === "Edit"
      ? formatClaudeToolPayload(stripToolPayloadKeys(parseToolPayload(event.input), EDIT_TOOL_REDACT_KEYS))
      : formatClaudeToolPayload(event.input);
  if (!input) {
    return header;
  }
  return `${header}\n输入:\n${input}`;
}

function formatClaudeToolResultMessage(
  event: Extract<ClaudeToolEvent, { kind: "tool_result" }>,
  toolName?: string
): string {
  const header = toolName ? `工具结果: ${toolName}` : "工具结果";
  const output = formatClaudeToolPayload(event.content);
  if (!output) {
    return header;
  }
  return `${header}\n输出:\n${output}`;
}

const EDIT_TOOL_REDACT_KEYS = new Set(["old_string", "new_string"]);

function parseToolPayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stripToolPayloadKeys(value: unknown, keys: Set<string>): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripToolPayloadKeys(item, keys));
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  Object.entries(record).forEach(([key, itemValue]) => {
    if (keys.has(key)) {
      return;
    }
    next[key] = stripToolPayloadKeys(itemValue, keys);
  });
  return next;
}

function extractJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  return value.slice(start, end + 1);
}

function extractClaudeText(payload: Record<string, unknown>): string | undefined {
  const directText = extractClaudeTextFromPayload(payload);
  if (directText) {
    return directText;
  }
  const result = payload.result;
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result === "object") {
    return extractClaudeTextFromPayload(result as Record<string, unknown>);
  }
  return undefined;
}

function extractClaudeTextFromPayload(payload: Record<string, unknown>): string | undefined {
  const text = payload.text;
  if (typeof text === "string") {
    return text;
  }
  const message = payload.message;
  if (typeof message === "string") {
    return message;
  }
  if (message && typeof message === "object") {
    const nested = extractClaudeTextFromPayload(message as Record<string, unknown>);
    if (nested) {
      return nested;
    }
  }
  const content = payload.content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => extractClaudeTextFromBlock(item))
      .filter((item): item is string => Boolean(item));
    if (parts.length > 0) {
      return parts.join("");
    }
  }
  const outputText = payload.output_text;
  if (typeof outputText === "string") {
    return outputText;
  }
  return undefined;
}

function extractClaudeTextFromBlock(block: unknown): string | undefined {
  if (typeof block === "string") {
    return block;
  }
  if (!block || typeof block !== "object") {
    return undefined;
  }
  const record = block as Record<string, unknown>;
  const text = record.text;
  if (typeof text === "string") {
    return text;
  }
  const content = record.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => extractClaudeTextFromBlock(item))
      .filter((item): item is string => Boolean(item));
    if (parts.length > 0) {
      return parts.join("");
    }
  }
  return undefined;
}

function extractClaudeSessionId(payload: Record<string, unknown>): string | undefined {
  const sessionId = payload.session_id ?? payload.sessionId;
  if (typeof sessionId === "string") {
    return sessionId;
  }
  const message = payload.message;
  if (message && typeof message === "object") {
    const nested = extractClaudeSessionId(message as Record<string, unknown>);
    if (nested) {
      return nested;
    }
  }
  const result = payload.result;
  if (result && typeof result === "object") {
    const nested = extractClaudeSessionId(result as Record<string, unknown>);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function resolveWorkspaceCwd(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0].uri.fsPath;
}

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
