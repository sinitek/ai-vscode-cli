import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

import type {
  ConversationTabRecordForPanel,
  PanelMessageHandlerDeps,
  PromptRunInputForPanel,
} from "../sessionMessageHandlers";
import type {
  CliName,
  InteractiveMode,
  LoopExecutionMode,
  MacTaskShell,
  ThinkingMode,
} from "../cli/types";
import type { ChatMessage, PanelMessage } from "../webview/types";
import type { WorkspaceSettings } from "../workspaceSettingsStore";

type PanelFileActionsMock = Pick<typeof import("../webview/panelFileActions"),
  "buildWorkspacePathItems"
  | "exportRunStreamRecordsToTxt"
  | "exportSessionHistoryMessagesToTxt"
  | "saveUploadedFiles"
>;

const fileActions = {
  historyExportError: null as Error | null,
  runStreamExportError: null as Error | null,
  historyExports: [] as Parameters<PanelFileActionsMock["exportSessionHistoryMessagesToTxt"]>[0][],
  runStreamExports: [] as Array<{
    records: Parameters<PanelFileActionsMock["exportRunStreamRecordsToTxt"]>[0];
    options: Parameters<PanelFileActionsMock["exportRunStreamRecordsToTxt"]>[1];
  }>,
  uploadedFiles: [] as Parameters<PanelFileActionsMock["saveUploadedFiles"]>[0][],
};

const panelFileActionsMock: PanelFileActionsMock = {
  buildWorkspacePathItems: async () => [{ label: "src", value: "src" }],
  exportRunStreamRecordsToTxt: async (records, options) => {
    fileActions.runStreamExports.push({ records, options });
    if (fileActions.runStreamExportError) {
      throw fileActions.runStreamExportError;
    }
    return { path: "/virtual/run-stream.txt", fileName: "run-stream.txt" };
  },
  exportSessionHistoryMessagesToTxt: async (options) => {
    fileActions.historyExports.push(options);
    if (fileActions.historyExportError) {
      throw fileActions.historyExportError;
    }
    return { path: "/virtual/history.txt", fileName: "history.txt" };
  },
  saveUploadedFiles: async (files) => {
    fileActions.uploadedFiles.push(files);
    return { paths: files.map((file) => `/virtual/${file.name}`) };
  },
};

type ModuleLoader = {
  _load: (this: unknown, request: string, parent?: { filename?: string }, isMain?: boolean) => unknown;
};

const moduleLoader = require("module") as ModuleLoader;
const originalLoad = moduleLoader._load;
moduleLoader._load = function mockedLoad(this: unknown, request: string, parent?: { filename?: string }, isMain?: boolean): unknown {
  if (request === "./webview/panelFileActions" && parent?.filename?.endsWith("sessionMessageHandlers.js")) {
    return panelFileActionsMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { handlePanelMessageWithDeps } = require("../sessionMessageHandlers") as typeof import("../sessionMessageHandlers");
const { isPanelMessageType } = require("../sessionMessageRouter") as typeof import("../sessionMessageRouter");
moduleLoader._load = originalLoad;

type Calls = {
  ensured: number;
  panelStates: number;
  sessionMessages: Array<{ cli: CliName; sessionId: string | null; tabId?: string | null }>;
  errors: Array<{ title: string; detail: unknown; detailTitle?: string }>;
  selectedModels: Array<{ cli: CliName; model: string | null; configId: string | null }>;
  modelMutations: string[];
  disposedUnused: number;
  disposedAll: number;
  disposedSessions: Array<{ cli: CliName; sessionId: string }>;
  deletedSessions: Array<{ cli: CliName; sessionId: string }>;
  detachedSessions: Array<{ cli: CliName; sessionId: string }>;
  webviewMessages: Record<string, unknown>[];
  clearedSessions: number;
  clearedPromptHistory: number;
  savedSettings: WorkspaceSettings[];
  statusUpdates: number;
  ruleWrites: Array<{ cli: CliName; scope: "global" | "project"; content: string }>;
  interactiveModes: Array<{ cli: CliName; mode: InteractiveMode }>;
  promptedInstalls: CliName[];
  codeGraphInstalls: number;
  openedGraphPanels: unknown[];
  promptRuns: PromptRunInputForPanel[];
  stoppedTabs: Array<string | null>;
};

type HandlerHarness = {
  deps: PanelMessageHandlerDeps;
  calls: Calls;
  state: {
    currentCli: CliName;
    workspaceSettings: WorkspaceSettings;
    tabs: Map<string, ConversationTabRecordForPanel>;
    activeTabId: string | null;
    warningAccepted: boolean;
    repairedSessionId: string;
    historyMessages: ChatMessage[];
    historyLoadError?: string;
    historyReadFailure: Error | null;
    applyConfigFailure: Error | null;
    readRulesFailure: Error | null;
    writeRulesFailure: Error | null;
    initializedHarness: boolean;
  };
  restore: () => void;
};

function resetFileActionState(): void {
  fileActions.historyExportError = null;
  fileActions.runStreamExportError = null;
  fileActions.historyExports.length = 0;
  fileActions.runStreamExports.length = 0;
  fileActions.uploadedFiles.length = 0;
}

function createHarness(): HandlerHarness {
  resetFileActionState();
  const vscode = require("vscode") as {
    window: { showWarningMessage: (...args: unknown[]) => Promise<unknown> };
    workspace: { workspaceFolders: unknown[] | undefined };
  };
  const originalWarningMessage = vscode.window.showWarningMessage;
  const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
  const calls: Calls = {
    ensured: 0,
    panelStates: 0,
    sessionMessages: [],
    errors: [],
    selectedModels: [],
    modelMutations: [],
    disposedUnused: 0,
    disposedAll: 0,
    disposedSessions: [],
    deletedSessions: [],
    detachedSessions: [],
    webviewMessages: [],
    clearedSessions: 0,
    clearedPromptHistory: 0,
    savedSettings: [],
    statusUpdates: 0,
    ruleWrites: [],
    interactiveModes: [],
    promptedInstalls: [],
    codeGraphInstalls: 0,
    openedGraphPanels: [],
    promptRuns: [],
    stoppedTabs: [],
  };
  const state: HandlerHarness["state"] = {
    currentCli: "codex",
    workspaceSettings: {},
    tabs: new Map(),
    activeTabId: "tab-codex",
    warningAccepted: false,
    repairedSessionId: "resolved-session",
    historyMessages: [{ id: "assistant-1", role: "assistant", content: "saved answer", createdAt: 1 }],
    historyReadFailure: null,
    applyConfigFailure: null,
    readRulesFailure: null,
    writeRulesFailure: null,
    initializedHarness: true,
  };
  state.tabs.set("tab-codex", {
    id: "tab-codex",
    cli: "codex",
    sessionId: "codex-session",
    sessionIdByCli: { codex: "codex-session" },
    createdAt: 1,
  });

  vscode.window.showWarningMessage = async (...args: unknown[]) => (
    state.warningAccepted ? args[2] : undefined
  );

  const isCliName = (value: string): value is CliName => (
    value === "codex" || value === "claude" || value === "opencode"
  );
  const isThinkingMode = (value: unknown): value is ThinkingMode => (
    value === "off" || value === "on" || value === "low" || value === "medium"
      || value === "high" || value === "xhigh" || value === "max" || value === "ultra"
  );
  const isInteractiveMode = (value: unknown): value is InteractiveMode => (
    value === "coding" || value === "plan" || value === "loop"
  );
  const isMacTaskShell = (value: unknown): value is MacTaskShell => value === "zsh" || value === "bash";

  const deps: PanelMessageHandlerDeps = {
    ensureWorkspaceSessionStore: () => { calls.ensured += 1; },
    postPanelState: async () => { calls.panelStates += 1; },
    sendSessionMessagesToPanel: (cli, sessionId, tabId) => { calls.sessionMessages.push({ cli, sessionId, tabId }); },
    getCurrentCli: () => state.currentCli,
    setCurrentCliValue: (cli) => { state.currentCli = cli; },
    getCurrentSessionId: (cli) => `${cli}-session`,
    showWebviewError: (title, detail, options) => {
      calls.errors.push({ title, detail, detailTitle: options?.detailTitle });
    },
    inspectModelManagerState: async () => undefined,
    getActiveConversationTabBinding: () => null,
    setCurrentCli: async (cli) => { state.currentCli = cli; },
    disposeInteractiveRunnerIfUnused: () => { calls.disposedUnused += 1; },
    syncCurrentSessionWithActiveTab: () => {
      const tab = state.activeTabId ? state.tabs.get(state.activeTabId) : undefined;
      return tab?.sessionId ?? null;
    },
    getActiveConfigIdForCli: (cli) => `config-${cli}`,
    selectCliModel: (cli, model, configId) => {
      calls.selectedModels.push({ cli, model, configId: configId ?? null });
    },
    updateOpenCodeRoleModel: async () => null,
    addCliModel: (_cli, model) => model,
    renameCliModel: (_cli, _previousModel, nextModel) => nextModel,
    deleteCliModel: () => { calls.modelMutations.push("delete"); },
    moveCliModel: () => "moved",
    repairSupersededLocalSession: () => state.repairedSessionId,
    findConversationTabIdBySession: (cli, sessionId) => {
      for (const tab of state.tabs.values()) {
        if (tab.cli === cli && tab.sessionId === sessionId) {
          return tab.id;
        }
      }
      return null;
    },
    setActiveConversationTab: (tabId) => {
      const tab = state.tabs.get(tabId);
      if (!tab) {
        return null;
      }
      state.activeTabId = tabId;
      return { cli: tab.cli, sessionId: tab.sessionId };
    },
    updateStatusBar: () => { calls.statusUpdates += 1; },
    getWorkspaceSettings: () => state.workspaceSettings,
    saveWorkspaceSettings: (settings) => {
      state.workspaceSettings = settings;
      calls.savedSettings.push({ ...settings });
    },
    addConversationTab: (cli, sessionId) => {
      const id = `tab-${cli}-${sessionId ?? "new"}`;
      state.tabs.set(id, { id, cli, sessionId, sessionIdByCli: sessionId ? { [cli]: sessionId } : {}, createdAt: 2 });
      state.activeTabId = id;
      return id;
    },
    startNewSession: (cli) => { calls.modelMutations.push(`new-${cli}`); },
    getConversationTabById: (tabId) => state.tabs.get(tabId) ?? null,
    hasAnyTaskRunning: () => false,
    disposeAllInteractiveRunners: () => { calls.disposedAll += 1; },
    maybePromptInstallOnCliGroupSwitch: async (cli) => { calls.promptedInstalls.push(cli); },
    closeConversationTabAndRefreshPanel: async () => undefined,
    confirm: async () => state.warningAccepted,
    disposeInteractiveRunnerSession: (cli, sessionId) => { calls.disposedSessions.push({ cli, sessionId }); },
    deleteSession: (cli, sessionId) => { calls.deletedSessions.push({ cli, sessionId }); },
    detachConversationTabsFromSession: (cli, sessionId) => { calls.detachedSessions.push({ cli, sessionId }); },
    loadSessionMessages: () => {
      if (state.historyReadFailure) {
        throw state.historyReadFailure;
      }
      return state.historyMessages;
    },
    getSessionLoadError: () => state.historyLoadError,
    postWebviewMessage: (payload) => { calls.webviewMessages.push(payload); },
    clearAllSessions: () => { calls.clearedSessions += 1; },
    clearPromptHistory: () => { calls.clearedPromptHistory += 1; },
    setWorkspaceInteractiveModeForCli: (cli, mode) => { calls.interactiveModes.push({ cli, mode }); },
    resetConversationTabSession: async () => undefined,
    getConfigManagerPanel: () => undefined,
    applyConfigById: async () => {
      if (state.applyConfigFailure) {
        throw state.applyConfigFailure;
      }
    },
    readCliRules: async () => {
      if (state.readRulesFailure) {
        throw state.readRulesFailure;
      }
      return "rule content";
    },
    writeCliRules: async (cli, scope, content) => {
      if (state.writeRulesFailure) {
        throw state.writeRulesFailure;
      }
      calls.ruleWrites.push({ cli, scope, content });
    },
    normalizeRuleTargets: (targets) => targets ?? [],
    isThinkingMode,
    normalizeThinkingModeForCli: (_cli, mode) => mode,
    setCliModelThinkingMode: () => undefined,
    getSelectedCliModel: () => null,
    isInteractiveMode,
    normalizeVisibleInteractiveMode: (mode) => mode,
    setWorkspaceLoopExecutionModeForCli: () => undefined,
    loadModelStore: () => undefined,
    normalizeLoopMaxRounds: () => 3,
    normalizeToolSettingsLocale: () => null,
    isCliName,
    updateStoredToolSettings: () => true,
    isMacTaskShell,
    confirmAndInitializeWorkspaceHarness: async () => state.initializedHarness,
    installCodeGraphForWorkspace: async () => { calls.codeGraphInstalls += 1; },
    appendUserMessageForCli: () => undefined,
    runContextCompactionCommand: async () => undefined,
    openLoopGroupChatPanel: async () => undefined,
    openGraphRunPanel: async (options) => { calls.openedGraphPanels.push(options); },
    getActiveConversationTabId: () => state.activeTabId,
    getActiveConversationTab: () => state.activeTabId ? state.tabs.get(state.activeTabId) ?? null : null,
    resolveLoopSubtaskConversationContext: () => null,
    getWorkspaceLoopExecutionMode: (): LoopExecutionMode => "main_sub_multi_agent",
    buildPromptWithAutoContext: (prompt) => ({ modelPrompt: prompt, contextTags: [] }),
    maybeInjectLongTermMemoryForPrompt: (_displayPrompt, modelPrompt) => modelPrompt,
    resolveCodexImagePathsForPrompt: async () => [],
    getLatestLoopRoundRunRecord: () => null,
    recordPromptHistory: () => undefined,
    resolvePromptRunTarget: (tabId) => {
      const tab = tabId ? state.tabs.get(tabId) : null;
      return tab ? { tabId: tab.id, cli: tab.cli, sessionId: tab.sessionId } : null;
    },
    preloadUserMessageForPrompt: (input) => input,
    runLoopPrompt: async () => undefined,
    runPrompt: async (input) => { calls.promptRuns.push(input); },
    maybeWakeLoopMainAfterSubtaskContinuation: async () => undefined,
    resolveLoopResumeTaskFromPrompt: () => null,
    isLoopResumePrompt: () => false,
    stopRunForTab: (tabId) => { calls.stoppedTabs.push(tabId); },
  };

  return {
    deps,
    calls,
    state,
    restore: () => {
      vscode.window.showWarningMessage = originalWarningMessage;
      vscode.workspace.workspaceFolders = originalWorkspaceFolders;
      resetFileActionState();
    },
  };
}

test("orchestrates state, runtime errors, CLI selection, and model changes", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);

  await handlePanelMessageWithDeps({ type: "requestState" }, harness.deps);
  await handlePanelMessageWithDeps({
    type: "webviewError",
    message: "render failed",
    reason: "bad payload",
    source: "panel.js",
    lineno: 8,
    colno: 3,
  }, harness.deps);
  await handlePanelMessageWithDeps({ type: "sessionLoadError", title: "History", detail: "cannot load" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "selectCli", cli: "claude" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "selectCliModel", cli: "claude", model: null, configId: "" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "deleteCliModel", cli: "claude", model: "old", configId: "custom" }, harness.deps);

  assert.equal(harness.calls.ensured, 6);
  assert.deepEqual(harness.calls.sessionMessages[0], { cli: "codex", sessionId: "codex-session", tabId: undefined });
  assert.equal(harness.state.currentCli, "claude");
  assert.equal(harness.calls.disposedUnused, 1);
  assert.deepEqual(harness.calls.selectedModels, [{ cli: "claude", model: null, configId: "config-claude" }]);
  assert.deepEqual(harness.calls.modelMutations, ["delete"]);
  assert.match(String(harness.calls.errors[0].detail), /reason: bad payload/);
  assert.equal(harness.calls.errors[1].detail, "cannot load");
});

test("loads and exports historical messages without touching local files", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);
  harness.state.repairedSessionId = "repaired-id";
  harness.state.historyLoadError = "partial history";

  await handlePanelMessageWithDeps({ type: "loadHistorySessionMessages", cli: "codex", sessionId: "old-id" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "exportHistorySessionMessages", cli: "codex", sessionId: "old-id" }, harness.deps);
  fileActions.historyExportError = new Error("write blocked");
  await handlePanelMessageWithDeps({ type: "exportHistorySessionMessages", cli: "codex", sessionId: "old-id" }, harness.deps);
  harness.state.historyReadFailure = new Error("read blocked");
  await handlePanelMessageWithDeps({ type: "loadHistorySessionMessages", cli: "codex", sessionId: "old-id" }, harness.deps);

  assert.deepEqual(harness.calls.webviewMessages[0], {
    type: "historySessionMessages",
    cli: "codex",
    sessionId: "old-id",
    resolvedSessionId: "repaired-id",
    messages: harness.state.historyMessages,
    error: "partial history",
  });
  assert.deepEqual(fileActions.historyExports[0], {
    cli: "codex",
    sessionId: "repaired-id",
    messages: harness.state.historyMessages,
  });
  assert.deepEqual(harness.calls.webviewMessages[1], {
    type: "historySessionExportResult",
    cli: "codex",
    sessionId: "old-id",
    resolvedSessionId: "repaired-id",
    path: "/virtual/history.txt",
    fileName: "history.txt",
  });
  assert.equal(harness.calls.webviewMessages[2].error, "write blocked");
  assert.match(String(harness.calls.webviewMessages[3].error), /read blocked/);
});

test("honors cancellation and executes confirmed destructive session actions", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);

  await handlePanelMessageWithDeps({ type: "deleteSession", cli: "codex", sessionId: "session-1" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "clearAllSessions" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "clearPromptHistory" }, harness.deps);
  assert.equal(harness.calls.deletedSessions.length, 0);
  assert.equal(harness.calls.clearedSessions, 0);
  assert.equal(harness.calls.clearedPromptHistory, 0);

  harness.state.warningAccepted = true;
  await handlePanelMessageWithDeps({ type: "deleteSession", cli: "codex", sessionId: "session-1" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "clearAllSessions" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "clearPromptHistory" }, harness.deps);

  assert.deepEqual(harness.calls.disposedSessions, [{ cli: "codex", sessionId: "session-1" }]);
  assert.deepEqual(harness.calls.deletedSessions, [{ cli: "codex", sessionId: "session-1" }]);
  assert.deepEqual(harness.calls.detachedSessions, [{ cli: "codex", sessionId: "session-1" }]);
  assert.equal(harness.calls.disposedAll, 1);
  assert.equal(harness.calls.clearedSessions, 1);
  assert.equal(harness.calls.clearedPromptHistory, 1);
});

test("reports config and rules failures while preserving successful rule contracts", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);

  await handlePanelMessageWithDeps({ type: "loadRules", cli: "claude", scope: "global" }, harness.deps);
  await handlePanelMessageWithDeps({
    type: "saveRules",
    targets: ["codex", "claude"],
    scope: "project",
    content: "be concise",
  }, harness.deps);
  harness.state.readRulesFailure = new Error("no-workspace");
  harness.state.writeRulesFailure = new Error("cannot write");
  harness.state.applyConfigFailure = new Error("invalid config");
  await handlePanelMessageWithDeps({ type: "loadRules", cli: "claude", scope: "project" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "saveRules", targets: ["codex"], scope: "global", content: "x" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "saveRules", targets: [], scope: "global", content: "x" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "applyConfig", cli: "codex", configId: "bad-config" }, harness.deps);

  assert.deepEqual(harness.calls.ruleWrites, [
    { cli: "codex", scope: "project", content: "be concise" },
    { cli: "claude", scope: "project", content: "be concise" },
  ]);
  assert.equal(harness.calls.webviewMessages[0].type, "rulesContent");
  assert.equal(harness.calls.webviewMessages[1].type, "rulesSaved");
  assert.equal(harness.calls.webviewMessages[2].type, "rulesContent");
  assert.ok(harness.calls.webviewMessages[2].error);
  assert.equal(harness.calls.webviewMessages[3].type, "rulesSaved");
  assert.ok(harness.calls.webviewMessages[3].error);
  assert.equal(harness.calls.webviewMessages[4].type, "rulesSaved");
  assert.ok(harness.calls.webviewMessages[4].error);
  assert.equal(harness.calls.webviewMessages[5].type, "configApplyError");
  assert.equal(harness.calls.webviewMessages[5].cli, "codex");
  assert.equal(harness.calls.webviewMessages[5].configId, "bad-config");
  assert.match(String(harness.calls.webviewMessages[5].error), /invalid config/);
  assert.equal(harness.calls.errors.at(-1)?.detail, harness.state.applyConfigFailure);
});

test("returns path and upload results through isolated file-action adapters", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);
  const vscode = require("vscode") as { workspace: { workspaceFolders: unknown[] | undefined } };
  vscode.workspace.workspaceFolders = [];

  await handlePanelMessageWithDeps({ type: "pickWorkspacePath" }, harness.deps);
  await handlePanelMessageWithDeps({
    type: "uploadFiles",
    files: [{ name: "note.txt", type: "text/plain", dataUrl: "data:text/plain;base64,bm90ZQ==" }],
  }, harness.deps);
  await handlePanelMessageWithDeps({
    type: "exportRunStream",
    cli: "claude",
    tabId: "tab-1",
    records: [{ id: "line-1", content: "output", source: "stdout", createdAt: 1 }],
  }, harness.deps);
  fileActions.runStreamExportError = new Error("export blocked");
  await handlePanelMessageWithDeps({ type: "exportRunStream", records: [] }, harness.deps);

  assert.deepEqual(harness.calls.webviewMessages[0], {
    type: "pickWorkspacePathResult",
    paths: [],
    error: harness.calls.webviewMessages[0].error,
    canceled: true,
  });
  assert.equal(harness.calls.webviewMessages[1].type, "uploadResult");
  assert.deepEqual(harness.calls.webviewMessages[1].paths, ["/virtual/note.txt"]);
  assert.deepEqual(fileActions.runStreamExports[0].options, { cli: "claude", tabId: "tab-1" });
  assert.equal(harness.calls.webviewMessages[2].path, "/virtual/run-stream.txt");
  assert.equal(harness.calls.webviewMessages[3].error, "export blocked");
});

test("forwards settings and prompts to action handlers and leaves unknown messages as a no-op", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);

  await handlePanelMessageWithDeps({ type: "updateSetting", key: "interactiveMode.claude", value: "plan" }, harness.deps);
  await handlePanelMessageWithDeps({
    type: "sendPrompt",
    prompt: "summarize",
    cli: "codex",
    tabId: "tab-codex",
    interactiveMode: "coding",
  }, harness.deps);
  await handlePanelMessageWithDeps({ type: "stopRun" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "not-a-panel-message" } as unknown as PanelMessage, harness.deps);

  assert.deepEqual(harness.calls.interactiveModes, [
    { cli: "claude", mode: "plan" },
    { cli: "codex", mode: "coding" },
  ]);
  assert.equal(harness.calls.promptRuns.length, 1);
  assert.equal(harness.calls.promptRuns[0].displayPrompt, "summarize");
  assert.deepEqual(harness.calls.stoppedTabs, ["tab-codex"]);
  assert.equal(isPanelMessageType({ type: "stopRun" }, "sendPrompt"), false);
});

test("covers model, session, workspace, and command routing through isolated adapters", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);
  const vscode = require("vscode") as {
    Uri: { parse: (value: string) => unknown };
    window: { showQuickPick?: (items: Array<{ value: string }>) => Promise<Array<{ value: string }> | undefined> };
    workspace: { workspaceFolders: unknown[] | undefined; asRelativePath?: (uri: unknown, includeWorkspaceFolder?: boolean) => string };
  };
  const originalParse = vscode.Uri.parse;
  const originalQuickPick = vscode.window.showQuickPick;
  const originalRelativePath = vscode.workspace.asRelativePath;
  const originalBuildPathItems = panelFileActionsMock.buildWorkspacePathItems;
  let closedTabId: string | null = null;
  let compactRuns = 0;
  let openedLoopPanel: unknown = null;
  let configShows = 0;
  let configSyncs = 0;
  t.after(() => {
    vscode.Uri.parse = originalParse;
    vscode.window.showQuickPick = originalQuickPick;
    vscode.workspace.asRelativePath = originalRelativePath;
    panelFileActionsMock.buildWorkspacePathItems = originalBuildPathItems;
  });

  vscode.workspace.workspaceFolders = [{}];
  vscode.workspace.asRelativePath = (uri) => `relative:${String((uri as { toString: () => string }).toString())}`;
  vscode.window.showQuickPick = async (items) => [items[0]];
  panelFileActionsMock.buildWorkspacePathItems = async () => [{ label: "src", value: "src" }];
  harness.deps.closeConversationTabAndRefreshPanel = async (tabId) => { closedTabId = tabId; };
  harness.deps.runContextCompactionCommand = async () => { compactRuns += 1; };
  harness.deps.openLoopGroupChatPanel = async (options) => { openedLoopPanel = options; };
  harness.deps.getConfigManagerPanel = () => ({
    show: () => { configShows += 1; },
    syncActiveConfig: () => { configSyncs += 1; },
  } as unknown as ReturnType<PanelMessageHandlerDeps["getConfigManagerPanel"]>);

  await handlePanelMessageWithDeps({ type: "webviewDebug", event: "debug", payload: { source: "test" } }, harness.deps);
  await handlePanelMessageWithDeps({ type: "inspectModelManager", cli: "codex" }, harness.deps);
  harness.deps.updateOpenCodeRoleModel = async () => "role update failed";
  await handlePanelMessageWithDeps({ type: "updateOpenCodeRoleModel", role: "primary", value: "model" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "addCliModel", cli: "claude", model: "new", configId: "explicit" }, harness.deps);
  harness.deps.addCliModel = () => null;
  await handlePanelMessageWithDeps({ type: "addCliModel", cli: "claude", model: "ignored" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "renameCliModel", cli: "claude", previousModel: "new", nextModel: "renamed" }, harness.deps);
  harness.deps.renameCliModel = () => null;
  await handlePanelMessageWithDeps({ type: "renameCliModel", cli: "claude", previousModel: "renamed", nextModel: "ignored" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "moveCliModel", cli: "claude", model: "renamed", direction: "up" }, harness.deps);
  harness.deps.moveCliModel = () => null;
  await handlePanelMessageWithDeps({ type: "moveCliModel", cli: "claude", model: "renamed", direction: "down" }, harness.deps);

  harness.state.tabs.set("tab-claude", {
    id: "tab-claude",
    cli: "claude",
    sessionId: "resolved-session",
    sessionIdByCli: { claude: "resolved-session" },
    createdAt: 2,
  });
  await handlePanelMessageWithDeps({ type: "selectSession", cli: "claude", sessionId: "old-local" }, harness.deps);
  harness.state.tabs.delete("tab-claude");
  await handlePanelMessageWithDeps({ type: "selectSession", cli: "claude", sessionId: "another-local" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "selectSession", cli: "opencode", sessionId: null }, harness.deps);
  await handlePanelMessageWithDeps({ type: "selectConversationTab", cli: "codex", tabId: "missing-tab" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "selectConversationTab", cli: "codex", tabId: "tab-codex" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "closeConversationTab", cli: "codex", tabId: "tab-codex" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "newSession" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "resetConversationTabSession" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "openConfig" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "applyConfig", cli: "codex", configId: "good-config" }, harness.deps);

  await handlePanelMessageWithDeps({ type: "resolveDropPaths", uris: [] }, harness.deps);
  await handlePanelMessageWithDeps({ type: "resolveDropPaths", uris: ["file:///workspace/src"] }, harness.deps);
  vscode.Uri.parse = () => { throw new Error("bad URI"); };
  await handlePanelMessageWithDeps({ type: "resolveDropPaths", uris: ["bad"] }, harness.deps);
  vscode.Uri.parse = originalParse;

  await handlePanelMessageWithDeps({ type: "pickWorkspacePath" }, harness.deps);
  vscode.window.showQuickPick = async () => undefined;
  await handlePanelMessageWithDeps({ type: "pickWorkspacePath" }, harness.deps);
  panelFileActionsMock.buildWorkspacePathItems = async () => { throw new Error("read failed"); };
  await handlePanelMessageWithDeps({ type: "pickWorkspacePath" }, harness.deps);
  panelFileActionsMock.buildWorkspacePathItems = originalBuildPathItems;

  await handlePanelMessageWithDeps({ type: "initializeWorkspaceHarness", enabled: false }, harness.deps);
  await handlePanelMessageWithDeps({ type: "initializeWorkspaceHarness", enabled: true }, harness.deps);
  await handlePanelMessageWithDeps({ type: "installCodeGraph" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "runCommonCommand", command: "compactContext" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "openLoopGroupChat", taskId: "task-1", roundKey: "round-1" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "openGraphRun", graphRunId: "graph-1", nodeId: "test" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "openGraphRun" }, harness.deps);

  assert.equal(closedTabId, "tab-codex");
  assert.equal(compactRuns, 1);
  assert.equal(harness.calls.codeGraphInstalls, 1);
  assert.deepEqual(openedLoopPanel, { taskId: "task-1", roundKey: "round-1" });
  assert.deepEqual(harness.calls.openedGraphPanels, [
    { graphRunId: "graph-1", nodeId: "test" },
    { graphRunId: undefined, nodeId: undefined },
  ]);
  assert.ok(configShows >= 1);
  assert.ok(configSyncs >= 2);
  assert.ok(harness.calls.errors.some((entry) => entry.detail === "role update failed"));
  assert.ok(harness.calls.modelMutations.includes("new-opencode"));
  assert.ok(harness.calls.webviewMessages.some((message) => (
    message.type === "dropPathsResult"
    && (message.paths as unknown[] | undefined)?.[0] === "relative:file:///workspace/src"
  )));
  assert.ok(harness.calls.webviewMessages.some((message) => (
    message.type === "pickWorkspacePathResult"
    && (message.paths as unknown[] | undefined)?.[0] === "src"
  )));
  assert.ok(harness.calls.webviewMessages.some((message) => message.type === "pickWorkspacePathResult" && message.canceled === true));
});

test("updates the active CLI through session and tab selection fallbacks", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);
  harness.state.tabs.set("tab-claude", {
    id: "tab-claude",
    cli: "claude",
    sessionId: "resolved-session",
    sessionIdByCli: { claude: "resolved-session" },
    createdAt: 2,
  });
  harness.deps.setCurrentCli = async () => undefined;

  await handlePanelMessageWithDeps({ type: "selectSession", cli: "claude", sessionId: "old-local" }, harness.deps);

  harness.deps.setActiveConversationTab = () => null;
  await handlePanelMessageWithDeps({ type: "selectConversationTab", cli: "claude", tabId: "tab-claude" }, harness.deps);

  assert.equal(harness.state.currentCli, "claude");
  assert.equal(harness.calls.statusUpdates, 1);
  assert.deepEqual(harness.calls.savedSettings, [{ currentCli: "claude" }]);
});

test("routes optional panel fields through their empty and fallback contracts", async (t) => {
  const harness = createHarness();
  t.after(harness.restore);
  await handlePanelMessageWithDeps({ type: "webviewError", message: "minimal error" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "webviewError", message: "" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "webviewDebug", event: "debug-without-payload" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "selectCliModel", cli: "codex", model: "model", configId: "explicit" }, harness.deps);
  harness.deps.updateOpenCodeRoleModel = undefined;
  await handlePanelMessageWithDeps({ type: "updateOpenCodeRoleModel", role: "small", value: null }, harness.deps);
  await handlePanelMessageWithDeps({ type: "renameCliModel", cli: "codex", previousModel: "old", nextModel: "new", configId: "explicit" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "deleteCliModel", cli: "codex", model: "old" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "moveCliModel", cli: "codex", model: "old", direction: "down", configId: "explicit" }, harness.deps);

  harness.state.historyLoadError = undefined;
  await handlePanelMessageWithDeps({ type: "loadHistorySessionMessages", cli: "codex", sessionId: "old-id" }, harness.deps);
  fileActions.historyExportError = new Error("");
  await handlePanelMessageWithDeps({ type: "exportHistorySessionMessages", cli: "codex", sessionId: "old-id" }, harness.deps);
  fileActions.runStreamExportError = new Error("");
  await handlePanelMessageWithDeps({ type: "exportRunStream", records: [] }, harness.deps);
  await handlePanelMessageWithDeps({ type: "resolveDropPaths", uris: "invalid" } as unknown as PanelMessage, harness.deps);

  harness.state.readRulesFailure = new Error("other read failure");
  harness.state.writeRulesFailure = new Error("other write failure");
  await handlePanelMessageWithDeps({ type: "loadRules", cli: "codex", scope: "global" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "saveRules", targets: ["codex"], scope: "global" } as unknown as PanelMessage, harness.deps);
  harness.state.writeRulesFailure = new Error("no-workspace");
  await handlePanelMessageWithDeps({ type: "saveRules", targets: ["codex"], scope: "global", content: "x" }, harness.deps);
  await handlePanelMessageWithDeps({ type: "openLoopGroupChat", taskId: null as unknown as string, roundKey: 7 as unknown as string }, harness.deps);

  assert.match(String(harness.calls.errors[0]?.detail), /minimal error/);
  assert.deepEqual(harness.calls.selectedModels, [{ cli: "codex", model: "model", configId: "explicit" }]);
  assert.ok(harness.calls.webviewMessages.some((message) => message.type === "historySessionMessages" && message.error === undefined));
  assert.ok(harness.calls.webviewMessages.some((message) => message.type === "rulesContent" && message.error));
  assert.ok(harness.calls.webviewMessages.some((message) => message.type === "rulesSaved" && message.error));
});
