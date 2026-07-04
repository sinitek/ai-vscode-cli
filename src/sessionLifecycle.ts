import * as fs from "fs";
import { buildProcessLabel } from "./cli/commandRunner";
import { CliName, CLI_LIST } from "./cli/types";
import { buildErrorDetail } from "./errorDisplay";
import {
  getMappedThreadId,
  readSessionMeta,
  upsertMapping,
  writeSessionMeta,
} from "./interactive/metaStore";
import {
  findSupersedingSessionId,
  isLocalSessionId,
  mergeSessionMessages,
  mergeSessionRecords,
} from "./interactive/sessionHistoryRepair";
import {
  cleanupMessageStorage,
  cleanupWorkspaceMessageFiles,
  collectStaleSessionIds,
  collectWorkspaceKeysForSessionCleanup,
  deleteSessionFile,
  ensureSessionStore,
  getMessageFile,
  getSessionKey,
  isSessionStoreEmpty,
  readMessageFile,
  readSessionFile,
  sanitizeMessages,
  writeMessageFile,
  writeSessionFile,
  type SessionRecord,
  type SessionStore,
} from "./sessionStore";
import {
  getConversationTabSessionIdForCli,
  setConversationTabSessionIdForCli,
  switchConversationTabCli,
  type ConversationTabRecord,
  type PendingSessionDraft,
} from "./sessionTabs";
import { ChatMessage } from "./webview/types";

type RuntimeSessionReference = {
  cli: CliName;
  sessionId: string | null;
  messageTarget: ChatMessage[];
};

export type PrimaryRunSessionState = {
  cli: CliName | null;
  sessionId: string | null;
  tabId: string | null;
  messageTarget: ChatMessage[] | null;
};

export type ProcessTitleState = {
  activeRunId?: string;
  activeCliForRun: CliName | null;
  activeProcessTitleRunId: string | null;
  activeProcessTitleBase: string | null;
};

export type SessionLifecycleController = ReturnType<typeof createSessionLifecycleController>;

export function extractSessionId(cli: CliName, text: string): string | undefined {
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

export function createSessionLifecycleController(deps: {
  activeWorkspaceKey: () => string;
  workspaceKeyFallback: string;
  legacyMessageDir: string;
  messageDirRoot: string;
  frozenThreadLimit: number;
  historyRetentionDays: number;
  legacySessionFile: string;
  localSessionPrefix: string;
  sessionDir: string;
  sessionStoreKey: string;
  sessionStore: () => SessionStore;
  globalStateGet: <T>(key: string) => T | undefined;
  globalStateKeys: () => readonly string[];
  globalStateUpdate: (key: string, value: unknown) => Thenable<void>;
  sessionMessageCache: Map<string, ChatMessage[]>;
  sessionMessageLoadErrors: Map<string, string>;
  readSessionMetaStore: (workspaceKey?: string) => ReturnType<typeof readSessionMeta>;
  writeSessionMetaStore: (meta: ReturnType<typeof readSessionMeta>, workspaceKey?: string) => void;
  getSessionMetaFilePath: (workspaceKey?: string) => string;
  getSessionStoreKey: (workspaceKey?: string) => string;
  getCurrentSessionId: (cli: CliName) => string | null;
  setCurrentSession: (cli: CliName, sessionId: string | null, options?: { syncConversationTab?: boolean }) => void;
  persistSessionStore: (store: SessionStore) => void;
  postPanelState: () => void | Promise<void>;
  sendPanelMessage: (payload: Record<string, unknown>) => void;
  showSessionLoadError: (detail: string) => void;
  getActiveConversationTabId: () => string | null;
  getConversationTabById: (tabId: string) => ConversationTabRecord | null;
  getConversationTabs: () => ConversationTabRecord[];
  persistConversationTabsToWorkspaceSettings: () => void;
  getPendingSessionDraft: (tabId: string, cli?: CliName) => PendingSessionDraft;
  updatePendingSessionDraft: (tabId: string, patch: Partial<PendingSessionDraft>, cli?: CliName) => PendingSessionDraft;
  clearPendingSessionDraft: (tabId: string, cli?: CliName) => void;
  clearAllPendingSessionDrafts: () => void;
  getLiveMessagesForTab: (tabId: string) => ChatMessage[] | null;
  recoverClaudeMessagesFromTranscript: (sessionId: string, messages: ChatMessage[]) => ChatMessage[] | null;
  isTimestampWithinHistoryRetention: (timestamp: number, now?: number) => boolean;
  buildSessionLabelFromPrompt: (prompt: string | null | undefined) => string | null;
  shouldUseFallbackSessionLabel: (label: string | null | undefined) => boolean;
  getPrimaryRunTabId: () => string | null;
  getPrimaryRunSessionState: () => PrimaryRunSessionState;
  setPrimaryRunSessionState: (patch: Partial<Pick<PrimaryRunSessionState, "sessionId" | "messageTarget">> & { messageIndex?: number | null }) => void;
  getRuntimeSessionReferences: (tabId?: string | null) => RuntimeSessionReference[];
  getProcessTitleState: () => ProcessTitleState;
  setProcessTitleState: (patch: Partial<ProcessTitleState>) => void;
  t: (key: "session.loadFailedTitle" | "session.unnamed") => string;
  logDebug: (event: string, payload?: unknown) => void;
  logInfo: (event: string, payload?: unknown) => void;
  logError: (event: string, payload?: unknown) => void;
}): {
  adoptSessionId: (cli: CliName, sessionId: string, tabId?: string | null) => void;
  applyProcessTitle: (runId: string, cli: CliName, sessionId: string | null) => void;
  assignPendingLabel: (cli: CliName, tabId: string, sessionId: string) => void;
  attachPendingMessages: (cli: CliName, tabId: string, sessionId: string) => void;
  clearAllSessions: () => void;
  deleteInteractiveMapping: (cli: CliName, sessionId: string) => void;
  deleteSession: (cli: CliName, sessionId: string) => void;
  deleteSessionMessageArtifacts: (cli: CliName, sessionId: string) => void;
  findSupersedingLocalSessionTarget: (cli: CliName, sessionId: string) => string | null;
  ensureLocalSession: (cli: CliName, tabId: string) => void;
  loadSessionMessages: (cli: CliName, sessionId: string) => ChatMessage[];
  loadSessionStore: () => SessionStore;
  cleanupSessionRetentionAcrossWorkspaces: () => Promise<void>;
  migrateLocalSessionToTargetSession: (cli: CliName, localSessionId: string, targetSessionId: string, options?: { notifyPanel?: boolean }) => void;
  repairSupersededLocalSession: (cli: CliName, sessionId: string, options?: { notifyPanel?: boolean }) => string;
  repairSupersededLocalSessions: (options?: { notifyPanel?: boolean }) => void;
  persistActiveMessages: () => void;
  replaceConversationTabSessionReferences: (cli: CliName, fromSessionId: string, toSessionId: string) => void;
  resolveInteractiveMappedId: (cli: CliName, sessionId: string) => string | null;
  restoreProcessTitle: () => void;
  saveSessionMessages: (cli: CliName, sessionId: string, messages: ChatMessage[]) => void;
  sendSessionLoadErrorToPanel: (cli: CliName, sessionId: string | null, detail: string, tabId: string | null) => void;
  sendSessionMessagesToPanel: (cli: CliName, sessionId: string | null, tabId?: string | null) => void;
  syncPendingDraftMessagesForSessionAdoption: (cli: CliName, tabId: string | null) => void;
  updateProcessTitle: (cli: CliName, sessionId: string) => void;
  upsertInteractiveMapping: (cli: CliName, sessionId: string, mappedId: string, options?: { freezePrevious?: string }) => void;
} {
  const messagePathOptions = () => ({
    workspaceKeyFallback: deps.workspaceKeyFallback,
    legacyMessageDir: deps.legacyMessageDir,
    messageDirRoot: deps.messageDirRoot,
  });

  const createLocalSessionId = (): string => {
    return `${deps.localSessionPrefix}${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  const sessionPathOptions = () => ({
    workspaceKeyFallback: deps.workspaceKeyFallback,
    legacySessionFile: deps.legacySessionFile,
    sessionDir: deps.sessionDir,
    logError: (event: string, payload: Record<string, unknown>) => deps.logError(event, payload),
  });

  const normalizeSessionStore = (sourceStore: SessionStore | undefined): SessionStore => ensureSessionStore(sourceStore, {
    cliList: CLI_LIST,
    unnamedLabel: deps.t("session.unnamed"),
    isTimestampWithinHistoryRetention: deps.isTimestampWithinHistoryRetention,
    buildSessionLabelFromPrompt: deps.buildSessionLabelFromPrompt,
    shouldUseFallbackSessionLabel: deps.shouldUseFallbackSessionLabel,
  });

  const deleteSessionMetaStoreFile = (workspaceKey: string): void => {
    try {
      const filePath = deps.getSessionMetaFilePath(workspaceKey);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      deps.logError("session-meta-delete-error", {
        workspace: workspaceKey,
        error: String(error),
      });
    }
  };

  const isSessionMetaStoreEmpty = (meta: ReturnType<typeof readSessionMeta>): boolean => {
    return !meta.byCli || Object.keys(meta.byCli).length === 0;
  };

  const pruneStaleSessionMetaMappings = (
    meta: ReturnType<typeof readSessionMeta>,
    retainedStore: SessionStore
  ): boolean => {
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
  };

  const cleanupStaleSessionArtifacts = (
    sourceStore: SessionStore | undefined,
    retainedStore: SessionStore,
    workspaceKey: string = deps.activeWorkspaceKey()
  ): void => {
    const staleSessionIds = collectStaleSessionIds(sourceStore, retainedStore, CLI_LIST);

    for (const cli of CLI_LIST) {
      for (const sessionId of staleSessionIds[cli]) {
        const key = getSessionKey(workspaceKey, cli, sessionId);
        deps.sessionMessageCache.delete(key);
        deps.sessionMessageLoadErrors.delete(key);
        try {
          const filePath = getMessageFile(cli, sessionId, workspaceKey, messagePathOptions());
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          deps.logError("session-messages-retention-delete-error", {
            cli,
            sessionId,
            error: String(error),
          });
        }
      }
    }

    const meta = deps.readSessionMetaStore(workspaceKey);
    if (pruneStaleSessionMetaMappings(meta, retainedStore)) {
      if (isSessionMetaStoreEmpty(meta)) {
        deleteSessionMetaStoreFile(workspaceKey);
      } else {
        deps.writeSessionMetaStore(meta, workspaceKey);
      }
    }

    const removedCount = CLI_LIST.reduce((total, cli) => total + staleSessionIds[cli].length, 0);
    if (removedCount > 0) {
      deps.logInfo("session-history-retention-pruned", {
        workspace: workspaceKey,
        retentionDays: deps.historyRetentionDays,
        removedCount,
        removedByCli: staleSessionIds,
      });
    }
  };

  const loadMessages = (cli: CliName, sessionId: string): ChatMessage[] => {
    const key = getSessionKey(deps.activeWorkspaceKey(), cli, sessionId);
    const cached = deps.sessionMessageCache.get(key);
    if (cached) {
      return cached;
    }
    const messages = readMessageFile(cli, sessionId, {
      activeWorkspaceKey: deps.activeWorkspaceKey(),
      ...messagePathOptions(),
      buildErrorDetail,
      loadErrors: deps.sessionMessageLoadErrors,
      logError: (event, payload) => deps.logError(event, payload),
    });
    const sanitized = sanitizeMessages(messages);
    const recovered = maybeRecoverClaudeSessionMessages(cli, sessionId, sanitized.messages);
    const resolvedMessages = recovered ?? sanitized.messages;
    if (recovered || sanitized.changed) {
      writeMessageFile(cli, sessionId, resolvedMessages, {
        activeWorkspaceKey: deps.activeWorkspaceKey(),
        ...messagePathOptions(),
        logError: (event, payload) => deps.logError(event, payload),
      });
    }
    deps.sessionMessageCache.set(key, resolvedMessages);
    return resolvedMessages;
  };

  const maybeRecoverClaudeSessionMessages = (
    cli: CliName,
    sessionId: string,
    messages: ChatMessage[]
  ): ChatMessage[] | null => {
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
      const recovered = deps.recoverClaudeMessagesFromTranscript(sessionId, messages);
      if (recovered) {
        deps.logInfo("claude-session-recovered-from-transcript", {
          sessionId,
          originalSize: messages.length,
          recoveredSize: recovered.length,
        });
      }
      return recovered;
    } catch (error) {
      deps.logError("claude-session-recover-failed", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  const saveMessages = (cli: CliName, sessionId: string, messages: ChatMessage[]): void => {
    const key = getSessionKey(deps.activeWorkspaceKey(), cli, sessionId);
    const sanitized = sanitizeMessages(messages);
    deps.sessionMessageCache.set(key, sanitized.messages);
    writeMessageFile(cli, sessionId, sanitized.messages, {
      activeWorkspaceKey: deps.activeWorkspaceKey(),
      ...messagePathOptions(),
      logError: (event, payload) => deps.logError(event, payload),
    });
  };

  const sendLoadError = (
    cli: CliName,
    sessionId: string | null,
    detail: string,
    tabId: string | null
  ): void => {
    const targetTabId = tabId ?? deps.getActiveConversationTabId();
    deps.sendPanelMessage({
      type: "sessionLoadError",
      title: deps.t("session.loadFailedTitle"),
      detail,
      tabId: targetTabId,
      sessionId,
      cli,
    });
  };

  const deleteMapping = (cli: CliName, sessionId: string): void => {
    const meta = deps.readSessionMetaStore() as any;
    if (!meta?.byCli) {
      return;
    }
    if (cli === "codex" && meta.byCli.codex && meta.byCli.codex[sessionId]) {
      delete meta.byCli.codex[sessionId];
      deps.writeSessionMetaStore(meta);
      return;
    }
    if (cli === "claude" && meta.byCli.claude && meta.byCli.claude[sessionId]) {
      delete meta.byCli.claude[sessionId];
      deps.writeSessionMetaStore(meta);
    }
  };

  const deleteArtifacts = (cli: CliName, sessionId: string): void => {
    deps.sessionMessageCache.delete(getSessionKey(deps.activeWorkspaceKey(), cli, sessionId));
    const filePath = getMessageFile(cli, sessionId, deps.activeWorkspaceKey(), messagePathOptions());
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      deps.logError("session-messages-delete-error", {
        cli,
        sessionId,
        filePath,
        error: String(error),
      });
    }
    deleteMapping(cli, sessionId);
  };

  const replaceTabSessionReferences = (cli: CliName, fromSessionId: string, toSessionId: string): void => {
    let changed = false;
    deps.getConversationTabs().forEach((tab) => {
      if (getConversationTabSessionIdForCli(tab, cli) === fromSessionId) {
        changed = setConversationTabSessionIdForCli(tab, cli, toSessionId) || changed;
      }
    });
    if (changed) {
      deps.persistConversationTabsToWorkspaceSettings();
    }
  };

  const replaceRuntimeSessionReferences = (cli: CliName, fromSessionId: string, toSessionId: string): void => {
    const primary = deps.getPrimaryRunSessionState();
    if (primary.cli === cli && primary.sessionId === fromSessionId) {
      const messageTarget = loadMessages(cli, toSessionId);
      deps.setPrimaryRunSessionState({
        sessionId: toSessionId,
        messageTarget,
        messageIndex: messageTarget.length > 0 ? messageTarget.length - 1 : null,
      });
    }
    deps.getRuntimeSessionReferences().forEach((run) => {
      if (run.cli === cli && run.sessionId === fromSessionId) {
        run.sessionId = toSessionId;
        run.messageTarget = loadMessages(cli, toSessionId);
      }
    });
  };

  const attachPendingMessages = (cli: CliName, tabId: string, sessionId: string): void => {
    const draft = deps.getPendingSessionDraft(tabId, cli);
    const pending = draft.messages;
    if (!pending || pending.length === 0) {
      return;
    }
    const existing = loadMessages(cli, sessionId);
    const merged = [...existing, ...pending];
    draft.messages = [];
    saveMessages(cli, sessionId, merged);
    const primary = deps.getPrimaryRunSessionState();
    if (primary.cli === cli && primary.tabId === tabId && primary.sessionId === null) {
      deps.setPrimaryRunSessionState({
        sessionId,
        messageTarget: merged,
        messageIndex: merged.length - 1,
      });
    }
  };

  const assignPendingLabel = (cli: CliName, tabId: string, sessionId: string): void => {
    const draft = deps.getPendingSessionDraft(tabId, cli);
    const label = draft.label;
    const firstPrompt = draft.firstPrompt;
    if (!label) {
      if (firstPrompt) {
        const sessions = deps.sessionStore()[cli].sessions;
        const existing = sessions.find((item) => item.id === sessionId);
        if (existing && !existing.firstPrompt) {
          existing.firstPrompt = firstPrompt;
          deps.persistSessionStore(deps.sessionStore());
          void deps.postPanelState();
        }
      }
      draft.firstPrompt = null;
      return;
    }
    const sessions = deps.sessionStore()[cli].sessions;
    const existing = sessions.find((item) => item.id === sessionId);
    if (existing && deps.shouldUseFallbackSessionLabel(existing.label)) {
      existing.label = label;
    }
    if (existing && firstPrompt && !existing.firstPrompt) {
      existing.firstPrompt = firstPrompt;
    }
    draft.label = null;
    draft.firstPrompt = null;
    deps.persistSessionStore(deps.sessionStore());
    void deps.postPanelState();
  };

  const ensureLocalSession = (cli: CliName, tabId: string): void => {
    if (deps.getCurrentSessionId(cli)) {
      return;
    }
    const draft = deps.getPendingSessionDraft(tabId, cli);
    if (!draft.messages.length) {
      return;
    }
    lifecycle.adoptSessionId(cli, createLocalSessionId(), tabId);
  };

  const updateTitle = (cli: CliName, sessionId: string): void => {
    const titleState = deps.getProcessTitleState();
    if (!titleState.activeRunId || titleState.activeRunId !== titleState.activeProcessTitleRunId || titleState.activeCliForRun !== cli) {
      return;
    }
    process.title = buildProcessLabel(cli, sessionId);
  };

  const lifecycle: SessionLifecycleController = {
    adoptSessionId: (cli, sessionId, tabId = null) => {
      const targetTabId = tabId ?? deps.getActiveConversationTabId();
      const controller = createSessionLifecycleController(deps);
      controller.syncPendingDraftMessagesForSessionAdoption(cli, targetTabId);
      let changed = false;
      if (targetTabId) {
        const tab = deps.getConversationTabById(targetTabId);
        if (tab) {
          changed = switchConversationTabCli(tab, cli) || changed;
          changed = setConversationTabSessionIdForCli(tab, cli, sessionId) || changed;
        }
      }
      if (changed) {
        deps.persistConversationTabsToWorkspaceSettings();
      }
      const current = deps.getCurrentSessionId(cli);
      if (current !== sessionId) {
        deps.setCurrentSession(cli, sessionId, { syncConversationTab: false });
      }
      if (targetTabId) {
        assignPendingLabel(cli, targetTabId, sessionId);
        attachPendingMessages(cli, targetTabId, sessionId);
      }

      const primary = deps.getPrimaryRunSessionState();
      if (targetTabId && deps.getPrimaryRunTabId() === targetTabId && primary.cli === cli) {
        const messageTarget = loadMessages(cli, sessionId);
        deps.setPrimaryRunSessionState({
          sessionId,
          messageTarget,
          messageIndex: messageTarget.length > 0 ? messageTarget.length - 1 : null,
        });
      }

      deps.getRuntimeSessionReferences(targetTabId).forEach((run) => {
        if (run.cli === cli) {
          run.sessionId = sessionId;
          run.messageTarget = loadMessages(cli, sessionId);
        }
      });

      updateTitle(cli, sessionId);
      void deps.postPanelState();
      deps.logInfo("session-detected", { cli, sessionId, tabId: targetTabId });
    },
    applyProcessTitle: (runId, cli, sessionId) => {
      const titleState = deps.getProcessTitleState();
      if (!titleState.activeProcessTitleBase) {
        deps.setProcessTitleState({ activeProcessTitleBase: process.title });
      }
      const labelId = sessionId ?? runId;
      deps.setProcessTitleState({ activeProcessTitleRunId: runId });
      process.title = buildProcessLabel(cli, labelId);
    },
    assignPendingLabel,
    attachPendingMessages,
    clearAllSessions: () => {
      deps.sessionMessageCache.clear();
      const store = deps.sessionStore();
      for (const cli of CLI_LIST) {
        store[cli].currentId = null;
        store[cli].sessions = [];
      }
      deps.clearAllPendingSessionDrafts();
      deps.getConversationTabs().forEach((tab) => {
        tab.sessionId = null;
        tab.sessionIdByCli = {};
      });
      deps.persistConversationTabsToWorkspaceSettings();
      try {
        cleanupMessageStorage({
          activeWorkspaceKey: deps.activeWorkspaceKey(),
          workspaceKeyFallback: deps.workspaceKeyFallback,
          cliList: CLI_LIST,
          legacyMessageDir: deps.legacyMessageDir,
          messageDirRoot: deps.messageDirRoot,
        });
      } catch (error) {
        deps.logError("session-messages-clear-error", { error: String(error) });
      }
      try {
        const metaFile = deps.getSessionMetaFilePath();
        if (fs.existsSync(metaFile)) {
          fs.unlinkSync(metaFile);
        }
      } catch (error) {
        deps.logError("session-meta-clear-error", { error: String(error) });
      }
      deps.persistSessionStore(store);
      deps.logInfo("session-clear-all", {});
    },
    deleteInteractiveMapping: deleteMapping,
    deleteSession: (cli, sessionId) => {
      const store = deps.sessionStore();
      const sessions = store[cli].sessions;
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index === -1) {
        return;
      }
      sessions.splice(index, 1);
      deleteArtifacts(cli, sessionId);
      if (deps.getCurrentSessionId(cli) === sessionId) {
        deps.setCurrentSession(cli, null);
      }
      deps.persistSessionStore(store);
      deps.logInfo("session-deleted", { cli, sessionId });
    },
    deleteSessionMessageArtifacts: deleteArtifacts,
    ensureLocalSession,
    findSupersedingLocalSessionTarget: (cli, sessionId) => {
      if (!isLocalSessionId(sessionId)) {
        return null;
      }
      const meta = deps.readSessionMetaStore();
      const mappedId = getMappedThreadId(meta, cli, sessionId);
      if (mappedId && mappedId !== sessionId) {
        return mappedId;
      }
      const localRecord = deps.sessionStore()[cli]?.sessions.find((session) => session.id === sessionId) ?? null;
      if (!localRecord) {
        return null;
      }
      return findSupersedingSessionId(localRecord, deps.sessionStore()[cli]?.sessions ?? [], {
        getMessages: (candidateSessionId) => loadMessages(cli, candidateSessionId),
      });
    },
    loadSessionMessages: loadMessages,
    loadSessionStore: () => {
      const stored = readSessionFile(deps.activeWorkspaceKey(), sessionPathOptions())
        ?? deps.globalStateGet<SessionStore>(deps.getSessionStoreKey());
      const normalized = normalizeSessionStore(stored);
      cleanupStaleSessionArtifacts(stored, normalized);
      deps.persistSessionStore(normalized);
      return normalized;
    },
    cleanupSessionRetentionAcrossWorkspaces: async () => {
      const workspaceKeys = collectWorkspaceKeysForSessionCleanup({
        cliList: CLI_LIST,
        legacySessionFile: deps.legacySessionFile,
        messageDirRoot: deps.messageDirRoot,
        sessionDir: deps.sessionDir,
        sessionStoreKey: deps.sessionStoreKey,
        workspaceKeyFallback: deps.workspaceKeyFallback,
        globalStateKeys: deps.globalStateKeys(),
      });
      for (const workspaceKey of workspaceKeys) {
        const sourceStore = readSessionFile(workspaceKey, sessionPathOptions())
          ?? deps.globalStateGet<SessionStore>(deps.getSessionStoreKey(workspaceKey));
        const normalized = normalizeSessionStore(sourceStore);
        cleanupStaleSessionArtifacts(sourceStore, normalized, workspaceKey);
        cleanupWorkspaceMessageFiles(workspaceKey, normalized, {
          cliList: CLI_LIST,
          workspaceKeyFallback: deps.workspaceKeyFallback,
          legacyMessageDir: deps.legacyMessageDir,
          messageDirRoot: deps.messageDirRoot,
          logError: (event, payload) => deps.logError(event, payload),
        });
        if (isSessionStoreEmpty(normalized, CLI_LIST)) {
          deleteSessionFile(workspaceKey, sessionPathOptions());
          await deps.globalStateUpdate(deps.getSessionStoreKey(workspaceKey), undefined);
        } else {
          writeSessionFile(normalized, workspaceKey, sessionPathOptions());
          await deps.globalStateUpdate(deps.getSessionStoreKey(workspaceKey), normalized);
        }
      }
    },
    migrateLocalSessionToTargetSession: (cli, localSessionId, targetSessionId, options = {}) => {
      if (!localSessionId || !targetSessionId || localSessionId === targetSessionId) {
        return;
      }
      const store = deps.sessionStore();
      const sessions = store[cli]?.sessions ?? [];
      const localRecord = sessions.find((session) => session.id === localSessionId) ?? null;
      const targetRecord = sessions.find((session) => session.id === targetSessionId) ?? null;
      if (!localRecord && !targetRecord) {
        return;
      }

      const localMessages = loadMessages(cli, localSessionId);
      const targetMessages = loadMessages(cli, targetSessionId);
      const mergedMessages = mergeSessionMessages(targetMessages, localMessages);
      saveMessages(cli, targetSessionId, mergedMessages);

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

      if (deps.getCurrentSessionId(cli) === localSessionId) {
        deps.setCurrentSession(cli, targetSessionId, { syncConversationTab: false });
      }

      replaceTabSessionReferences(cli, localSessionId, targetSessionId);
      replaceRuntimeSessionReferences(cli, localSessionId, targetSessionId);
      deleteArtifacts(cli, localSessionId);
      deps.persistSessionStore(store);
      if (options.notifyPanel !== false) {
        void deps.postPanelState();
      }
      deps.logInfo("session-local-promoted", {
        cli,
        localSessionId,
        targetSessionId,
        mergedMessageCount: mergedMessages.length,
      });
    },
    repairSupersededLocalSession: (cli, sessionId, options = {}) => {
      const controller = createSessionLifecycleController(deps);
      const targetSessionId = controller.findSupersedingLocalSessionTarget(cli, sessionId);
      if (!targetSessionId || targetSessionId === sessionId) {
        return sessionId;
      }
      controller.migrateLocalSessionToTargetSession(cli, sessionId, targetSessionId, options);
      return targetSessionId;
    },
    repairSupersededLocalSessions: (options = {}) => {
      const controller = createSessionLifecycleController(deps);
      CLI_LIST.forEach((cli) => {
        const localSessionIds = (deps.sessionStore()[cli]?.sessions ?? [])
          .map((session: SessionRecord) => session.id)
          .filter((sessionId) => isLocalSessionId(sessionId));
        localSessionIds.forEach((sessionId) => {
          controller.repairSupersededLocalSession(cli, sessionId, options);
        });
      });
    },
    persistActiveMessages: () => {
      const primary = deps.getPrimaryRunSessionState();
      if (!primary.cli || !primary.messageTarget) {
        return;
      }
      if (!primary.sessionId) {
        if (!primary.tabId) {
          return;
        }
        deps.updatePendingSessionDraft(primary.tabId, { messages: primary.messageTarget }, primary.cli);
        ensureLocalSession(primary.cli, primary.tabId);
        return;
      }
      saveMessages(primary.cli, primary.sessionId, primary.messageTarget);
    },
    replaceConversationTabSessionReferences: replaceTabSessionReferences,
    resolveInteractiveMappedId: (cli, sessionId) => {
      const meta = deps.readSessionMetaStore();
      const mapped = getMappedThreadId(meta, cli, sessionId);
      if (mapped) {
        return mapped;
      }
      return isLocalSessionId(sessionId) ? null : sessionId;
    },
    restoreProcessTitle: () => {
      const titleState = deps.getProcessTitleState();
      if (!titleState.activeProcessTitleRunId) {
        return;
      }
      if (titleState.activeProcessTitleBase) {
        process.title = titleState.activeProcessTitleBase;
      }
      deps.setProcessTitleState({
        activeProcessTitleBase: null,
        activeProcessTitleRunId: null,
      });
    },
    saveSessionMessages: saveMessages,
    sendSessionLoadErrorToPanel: sendLoadError,
    sendSessionMessagesToPanel: (cli, sessionId, tabId = deps.getActiveConversationTabId()) => {
      const targetTabId = tabId ?? deps.getActiveConversationTabId();
      if (!targetTabId) {
        deps.sendPanelMessage({ type: "setMessages", messages: [], tabId: null });
        return;
      }

      const liveMessages = deps.getLiveMessagesForTab(targetTabId);
      if (liveMessages) {
        deps.sendPanelMessage({ type: "setMessages", messages: liveMessages, tabId: targetTabId });
        deps.logDebug("setMessages-live", {
          cli,
          sessionId,
          tabId: targetTabId,
          size: liveMessages.length,
          source: "active-run",
        });
        return;
      }

      if (!sessionId) {
        const draftMessages = deps.getPendingSessionDraft(targetTabId, cli).messages;
        deps.sendPanelMessage({ type: "setMessages", messages: draftMessages, tabId: targetTabId });
        deps.logDebug("setMessages-draft", {
          cli,
          sessionId,
          tabId: targetTabId,
          size: draftMessages.length,
          source: "draft",
        });
        return;
      }

      try {
        const sessionMessages = loadMessages(cli, sessionId);
        const counts = sessionMessages.reduce((acc, message) => {
          const role = typeof message?.role === "string" ? message.role : "unknown";
          acc[role] = (acc[role] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const loadError = deps.sessionMessageLoadErrors.get(getSessionKey(deps.activeWorkspaceKey(), cli, sessionId));
        deps.sendPanelMessage({
          type: "setMessages",
          messages: sessionMessages,
          tabId: targetTabId,
        });
        if (loadError) {
          sendLoadError(cli, sessionId, loadError, targetTabId);
          deps.showSessionLoadError(loadError);
          deps.logError("session-load-surface-error", {
            cli,
            sessionId,
            tabId: targetTabId,
            detail: loadError,
          });
        }
        deps.logDebug("setMessages-session", {
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
        deps.sendPanelMessage({ type: "setMessages", messages: [], tabId: targetTabId });
        sendLoadError(cli, sessionId, detail, targetTabId);
        deps.logError("setMessages-session-failed", {
          cli,
          sessionId,
          tabId: targetTabId,
          error: detail,
        });
        deps.showSessionLoadError(detail);
      }
    },
    syncPendingDraftMessagesForSessionAdoption: (cli, tabId) => {
      if (!tabId) {
        return;
      }

      const primary = deps.getPrimaryRunSessionState();
      const activeRunMatches = deps.getPrimaryRunTabId() === tabId
        && primary.cli === cli
        && primary.sessionId === null
        && Array.isArray(primary.messageTarget)
        && primary.messageTarget.length > 0;
      if (activeRunMatches && primary.messageTarget) {
        deps.updatePendingSessionDraft(tabId, { messages: primary.messageTarget }, cli);
      }

      deps.getRuntimeSessionReferences(tabId).forEach((run) => {
        if (run.cli === cli && run.sessionId === null && run.messageTarget.length > 0) {
          deps.updatePendingSessionDraft(tabId, { messages: run.messageTarget }, cli);
        }
      });
    },
    updateProcessTitle: updateTitle,
    upsertInteractiveMapping: (cli, sessionId, mappedId, options = {}) => {
      const meta = deps.readSessionMetaStore();
      const next = upsertMapping(meta, cli, sessionId, mappedId, {
        freezePrevious: options.freezePrevious,
        maxFrozen: deps.frozenThreadLimit,
      });
      deps.writeSessionMetaStore(next);
    },
  };
  return lifecycle;
}
