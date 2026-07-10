import { CliName, CLI_LIST, InteractiveMode } from "./cli/types";
import { ConversationTabSummary, ChatMessage } from "./webview/types";
import { type SessionStore } from "./sessionStore";
import { type ConversationTabRecordForWorkspaceSettings, type WorkspaceSettings } from "./workspaceSettingsStore";

export type ConversationTabRecord = {
  id: string;
  cli: CliName;
  sessionId: string | null;
  sessionIdByCli: Partial<Record<CliName, string>>;
  createdAt: number;
};

export type ConversationTabsState = {
  activeTabId: string | null;
  tabs: ConversationTabRecord[];
};

export type PendingSessionDraft = {
  label: string | null;
  firstPrompt: string | null;
  messages: ChatMessage[];
};

export type ConversationTabSwitchResult = { cli: CliName; sessionId: string | null };

type LobsterConversationTabContext = {
  taskRole?: "main" | "subtask" | null;
  lobsterTaskId?: string | null;
};

export type SessionTabsController = ReturnType<typeof createSessionTabsController>;

export function buildConversationTabSessionLookupKey(cli: CliName, sessionId: string): string {
  return `${cli}:${sessionId}`;
}

export function getConversationTabSessionIdForCli(tab: ConversationTabRecord, cli: CliName): string | null {
  const sessionId = tab.sessionIdByCli?.[cli];
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

export function sanitizeConversationTabSessionIdMap(
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

export function setConversationTabSessionIdForCli(
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

export function switchConversationTabCli(tab: ConversationTabRecord, cli: CliName): boolean {
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

export function createConversationTabId(prefix: string): string {
  return `${prefix}${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createSessionTabsController(deps: {
  state: ConversationTabsState;
  pendingDrafts: Record<string, PendingSessionDraft>;
  conversationTabPrefix: string;
  getCurrentCli: () => CliName;
  setCurrentCli: (cli: CliName) => void;
  getDefaultCli: () => CliName;
  isCliName: (value: string) => value is CliName;
  getLatestSessionId: (cli: CliName) => string | null;
  getSessionStore: () => SessionStore | undefined;
  getWorkspaceSettings: () => WorkspaceSettings;
  saveWorkspaceSettings: (settings: WorkspaceSettings) => void;
  setCurrentSession: (cli: CliName, sessionId: string | null, options?: { syncConversationTab?: boolean }) => void;
  setWorkspaceInteractiveModeForCli: (cli: CliName, mode: InteractiveMode) => boolean;
  resolveAutoInteractiveModeForConversationTab: (tab: ConversationTabRecord | null) => InteractiveMode;
  collectRunningLobsterTaskIds: () => Set<string>;
  isLobsterTaskRunning: (taskId: string, runningTaskIds: ReadonlySet<string>) => boolean;
  resolveConversationTabLobsterContext: (tab: ConversationTabRecord) => LobsterConversationTabContext;
  buildSessionLabelFromPrompt: (prompt: string | null | undefined) => string | null;
}): {
  addConversationTab: (cli: CliName, sessionId: string | null, options?: { skipPersist?: boolean }) => string | null;
  buildConversationTabsState: () => { activeTabId: string | null; tabs: ConversationTabSummary[] };
  buildOpenConversationTabSessionMap: () => Map<string, string>;
  clearPendingSessionDraft: (tabId: string, cli?: CliName) => void;
  closeConversationTab: (tabId: string) => ConversationTabSwitchResult | null;
  createConversationTabId: () => string;
  detachConversationTabsFromSession: (cli: CliName, sessionId: string) => void;
  ensureConversationTabs: () => ConversationTabsState;
  findConversationTabIdBySession: (cli: CliName, sessionId: string) => string | null;
  getActiveConversationSessionId: (cli: CliName) => string | null;
  getActiveConversationTab: () => ConversationTabRecord | null;
  getActiveConversationTabId: () => string | null;
  getConversationTabById: (tabId: string) => ConversationTabRecord | null;
  getPendingSessionDraft: (tabId: string, cli?: CliName) => PendingSessionDraft;
  initializeConversationTabsFromWorkspaceSettings: () => void;
  normalizeConversationTabsState: (value?: ConversationTabsState) => ConversationTabsState;
  persistConversationTabsToWorkspaceSettings: () => void;
  preparePendingLabel: (cli: CliName, tabId: string, prompt: string) => void;
  sanitizeConversationTabRecord: (value: unknown) => ConversationTabRecord | null;
  setActiveConversationTab: (tabId: string) => ConversationTabSwitchResult | null;
  startNewSession: (cli: CliName) => void;
  syncCurrentSessionWithActiveTab: (preferredCli?: CliName) => string | null;
  updateActiveConversationTabSession: (cli: CliName, sessionId: string | null) => void;
  updatePendingSessionDraft: (tabId: string, patch: Partial<PendingSessionDraft>, cli?: CliName) => PendingSessionDraft;
} {
  const createTabId = (): string => createConversationTabId(deps.conversationTabPrefix);

  const hasSessionRecord = (cli: CliName, sessionId: string): boolean => {
    const sessionStore = deps.getSessionStore();
    if (!sessionStore) {
      return false;
    }
    return sessionStore[cli]?.sessions.some((session) => session.id === sessionId) ?? false;
  };

  const retainExistingSessionIdMap = (
    value: Partial<Record<CliName, string>>,
  ): Partial<Record<CliName, string>> => {
    if (!deps.getSessionStore()) {
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
  };

  const sanitizeRecord = (value: unknown): ConversationTabRecord | null => {
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as ConversationTabRecord;
    const id = typeof record.id === "string" && record.id.trim()
      ? record.id
      : createTabId();
    const fallbackCli = deps.isCliName(deps.getCurrentCli()) ? deps.getCurrentCli() : deps.getDefaultCli();
    const cli = deps.isCliName((record as { cli?: unknown }).cli as string)
      ? ((record as { cli: CliName }).cli)
      : fallbackCli;
    const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
    const sessionId = typeof record.sessionId === "string" && record.sessionId.trim()
      ? record.sessionId
      : null;
    const sessionIdByCli = retainExistingSessionIdMap(
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
  };

  const normalizeState = (value?: ConversationTabsState): ConversationTabsState => {
    const now = Date.now();
    const records = Array.isArray(value?.tabs)
      ? value.tabs
        .map((tab) => sanitizeRecord(tab))
        .filter((tab): tab is ConversationTabRecord => Boolean(tab))
      : [];
    const fallbackCli = deps.isCliName(deps.getCurrentCli()) ? deps.getCurrentCli() : deps.getDefaultCli();
    const tabs = records.length > 0
      ? records
      : [{
          id: createTabId(),
          cli: fallbackCli,
          sessionId: deps.getLatestSessionId(fallbackCli),
          sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, fallbackCli, deps.getLatestSessionId(fallbackCli)),
          createdAt: now,
        }];
    const tabIds = new Set(tabs.map((tab) => tab.id));
    const activeTabId = value?.activeTabId && tabIds.has(value.activeTabId)
      ? value.activeTabId
      : tabs[tabs.length - 1].id;
    return {
      activeTabId,
      tabs: tabs.map((tab) => {
        const sessionIdByCli = retainExistingSessionIdMap(
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
  };

  const persistTabs = (): void => {
    const state = ensureTabs();
    const workspaceSettings = deps.getWorkspaceSettings();
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
    deps.saveWorkspaceSettings(workspaceSettings);
  };

  const ensureTabs = (): ConversationTabsState => {
    if (Array.isArray(deps.state.tabs) && deps.state.tabs.length > 0) {
      if (
        !deps.state.activeTabId
        || !deps.state.tabs.some((tab) => tab.id === deps.state.activeTabId)
      ) {
        deps.state.activeTabId = deps.state.tabs[deps.state.tabs.length - 1].id;
        persistTabs();
      }
      return deps.state;
    }
    const fallbackCli = deps.isCliName(deps.getCurrentCli()) ? deps.getCurrentCli() : deps.getDefaultCli();
    const fallbackSessionId = deps.getLatestSessionId(fallbackCli);
    const fallbackTab: ConversationTabRecord = {
      id: createTabId(),
      cli: fallbackCli,
      sessionId: fallbackSessionId,
      sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, fallbackCli, fallbackSessionId),
      createdAt: Date.now(),
    };
    deps.state.tabs = [fallbackTab];
    deps.state.activeTabId = fallbackTab.id;
    persistTabs();
    return deps.state;
  };

  const getTabById = (tabId: string): ConversationTabRecord | null => {
    const state = ensureTabs();
    const tab = state.tabs.find((item) => item.id === tabId);
    return tab ?? null;
  };

  const getActiveTabId = (): string | null => {
    const state = ensureTabs();
    return state.activeTabId;
  };

  const getActiveTab = (): ConversationTabRecord | null => {
    const state = ensureTabs();
    if (!state.activeTabId) {
      return null;
    }
    return state.tabs.find((item) => item.id === state.activeTabId) ?? null;
  };

  const resolveDraftCli = (tabId: string, cli?: CliName): CliName => {
    if (cli) {
      return cli;
    }
    const tab = getTabById(tabId);
    if (tab) {
      return tab.cli;
    }
    return deps.getCurrentCli();
  };

  const getDraftKey = (tabId: string, cli: CliName): string => `${tabId}::${cli}`;

  const getDraft = (tabId: string, cli?: CliName): PendingSessionDraft => {
    const resolvedCli = resolveDraftCli(tabId, cli);
    const draftKey = getDraftKey(tabId, resolvedCli);
    if (!deps.pendingDrafts[draftKey]) {
      deps.pendingDrafts[draftKey] = {
        label: null,
        firstPrompt: null,
        messages: [],
      };
    }
    return deps.pendingDrafts[draftKey];
  };

  const updateDraft = (
    tabId: string,
    patch: Partial<PendingSessionDraft>,
    cli?: CliName,
  ): PendingSessionDraft => {
    const draft = getDraft(tabId, cli);
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
  };

  const clearDraft = (tabId: string, cli?: CliName): void => {
    if (cli) {
      delete deps.pendingDrafts[getDraftKey(tabId, cli)];
      return;
    }
    const prefix = `${tabId}::`;
    Object.keys(deps.pendingDrafts).forEach((key) => {
      if (key === tabId || key.startsWith(prefix)) {
        delete deps.pendingDrafts[key];
      }
    });
  };

  const buildOpenSessionMap = (): Map<string, string> => {
    const state = ensureTabs();
    const sessionMap = new Map<string, string>();
    state.tabs.forEach((tab) => {
      const sessionId = getConversationTabSessionIdForCli(tab, tab.cli);
      if (!sessionId) {
        return;
      }
      sessionMap.set(buildConversationTabSessionLookupKey(tab.cli, sessionId), tab.id);
    });
    return sessionMap;
  };

  const buildTabsState = (): { activeTabId: string | null; tabs: ConversationTabSummary[] } => {
    const state = ensureTabs();
    const runningLobsterTaskIds = deps.collectRunningLobsterTaskIds();
    return {
      activeTabId: state.activeTabId,
      tabs: state.tabs.map((tab) => {
        const lobsterContext = deps.resolveConversationTabLobsterContext(tab);
        const lobsterTaskId = lobsterContext.lobsterTaskId;
        const lobsterTaskRunning = (
          typeof lobsterTaskId === "string"
          && deps.isLobsterTaskRunning(lobsterTaskId, runningLobsterTaskIds)
        );
        const lobsterMainTabCloseLocked = (
          lobsterContext.taskRole === "main"
          && lobsterTaskRunning
        );
        return {
          id: tab.id,
          cli: tab.cli,
          sessionId: tab.sessionId,
          createdAt: tab.createdAt,
          lobsterTaskRole: lobsterContext.taskRole ?? undefined,
          lobsterTaskId: lobsterTaskId ?? undefined,
          lobsterTaskRunning,
          lobsterMainTabCloseLocked,
        };
      }),
    };
  };

  return {
    addConversationTab: (cli, sessionId, options = {}) => {
      const state = ensureTabs();
      const tab: ConversationTabRecord = {
        id: createTabId(),
        cli,
        sessionId,
        sessionIdByCli: sanitizeConversationTabSessionIdMap(undefined, cli, sessionId),
        createdAt: Date.now(),
      };
      state.tabs.push(tab);
      state.activeTabId = tab.id;
      if (!options.skipPersist) {
        persistTabs();
      }
      deps.setCurrentSession(cli, sessionId, { syncConversationTab: false });
      return sessionId;
    },
    buildConversationTabsState: buildTabsState,
    buildOpenConversationTabSessionMap: buildOpenSessionMap,
    clearPendingSessionDraft: clearDraft,
    closeConversationTab: (tabId) => {
      const state = ensureTabs();
      if (state.tabs.length <= 1) {
        const active = getActiveTab();
        return active ? { cli: active.cli, sessionId: active.sessionId } : null;
      }
      const index = state.tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) {
        const active = getActiveTab();
        return active ? { cli: active.cli, sessionId: active.sessionId } : null;
      }
      clearDraft(tabId);
      state.tabs.splice(index, 1);
      if (!state.activeTabId || state.activeTabId === tabId) {
        const fallbackIndex = index > 0 ? index - 1 : 0;
        state.activeTabId = state.tabs[fallbackIndex]?.id ?? state.tabs[0].id;
      }
      persistTabs();
      const activeTab = getActiveTab();
      if (!activeTab) {
        return null;
      }
      deps.setCurrentSession(activeTab.cli, activeTab.sessionId, { syncConversationTab: false });
      return {
        cli: activeTab.cli,
        sessionId: activeTab.sessionId,
      };
    },
    createConversationTabId: createTabId,
    detachConversationTabsFromSession: (cli, sessionId) => {
      const state = ensureTabs();
      let changed = false;
      state.tabs.forEach((tab) => {
        if (getConversationTabSessionIdForCli(tab, cli) === sessionId) {
          changed = setConversationTabSessionIdForCli(tab, cli, null) || changed;
          clearDraft(tab.id, cli);
        }
      });
      if (changed) {
        persistTabs();
      }
    },
    ensureConversationTabs: ensureTabs,
    findConversationTabIdBySession: (cli, sessionId) => {
      const state = ensureTabs();
      const matched = state.tabs.find((tab) => tab.cli === cli && tab.sessionId === sessionId);
      return matched ? matched.id : null;
    },
    getActiveConversationSessionId: (cli) => {
      const activeTab = getActiveTab();
      if (!activeTab) {
        return null;
      }
      return getConversationTabSessionIdForCli(activeTab, cli);
    },
    getActiveConversationTab: getActiveTab,
    getActiveConversationTabId: getActiveTabId,
    getConversationTabById: getTabById,
    getPendingSessionDraft: getDraft,
    initializeConversationTabsFromWorkspaceSettings: () => {
      const normalized = normalizeState(deps.getWorkspaceSettings().conversationTabs);
      deps.state.activeTabId = normalized.activeTabId;
      deps.state.tabs = normalized.tabs;
      persistTabs();
    },
    normalizeConversationTabsState: normalizeState,
    persistConversationTabsToWorkspaceSettings: persistTabs,
    preparePendingLabel: (cli, tabId, prompt) => {
      const draft = getDraft(tabId, cli);
      if (!draft.firstPrompt) {
        const normalizedPrompt = String(prompt ?? "").trim();
        if (normalizedPrompt) {
          draft.firstPrompt = normalizedPrompt;
        }
      }
      if (draft.label) {
        return;
      }
      const label = deps.buildSessionLabelFromPrompt(prompt);
      if (!label) {
        return;
      }
      draft.label = label;
    },
    sanitizeConversationTabRecord: sanitizeRecord,
    setActiveConversationTab: (tabId) => {
      const state = ensureTabs();
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
        persistTabs();
      }
      deps.setWorkspaceInteractiveModeForCli(tab.cli, deps.resolveAutoInteractiveModeForConversationTab(tab));
      deps.setCurrentSession(tab.cli, tabSessionId, { syncConversationTab: false });
      return {
        cli: tab.cli,
        sessionId: tabSessionId,
      };
    },
    startNewSession: (cli) => {
      const activeTab = getActiveTab();
      if (!activeTab) {
        return;
      }
      let changed = false;
      if (activeTab.cli !== cli) {
        changed = switchConversationTabCli(activeTab, cli) || changed;
      }
      changed = setConversationTabSessionIdForCli(activeTab, cli, null) || changed;
      if (changed) {
        persistTabs();
      }
      clearDraft(activeTab.id, cli);
      updateDraft(activeTab.id, { messages: [] }, cli);
      deps.setCurrentSession(cli, null);
    },
    syncCurrentSessionWithActiveTab: (preferredCli) => {
      const activeTab = getActiveTab();
      if (!activeTab) {
        const cli = preferredCli ?? deps.getCurrentCli();
        deps.setCurrentSession(cli, null, { syncConversationTab: false });
        return null;
      }
      if (deps.getCurrentCli() !== activeTab.cli) {
        deps.setCurrentCli(activeTab.cli);
        const workspaceSettings = deps.getWorkspaceSettings();
        workspaceSettings.currentCli = activeTab.cli;
        deps.saveWorkspaceSettings(workspaceSettings);
      }
      const sessionId = getConversationTabSessionIdForCli(activeTab, activeTab.cli);
      if (activeTab.sessionId !== sessionId) {
        activeTab.sessionId = sessionId;
      }
      deps.setCurrentSession(activeTab.cli, sessionId, { syncConversationTab: false });
      return sessionId;
    },
    updateActiveConversationTabSession: (cli, sessionId) => {
      const tab = getActiveTab();
      if (!tab) {
        return;
      }
      const changed = setConversationTabSessionIdForCli(tab, cli, sessionId);
      if (!changed) {
        return;
      }
      persistTabs();
    },
    updatePendingSessionDraft: updateDraft,
  };
}

export function sanitizeConversationTabRecordForWorkspaceSettings(
  controller: Pick<SessionTabsController, "sanitizeConversationTabRecord">,
  value: unknown,
): ConversationTabRecordForWorkspaceSettings | null {
  return controller.sanitizeConversationTabRecord(value);
}
