import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  createSessionLifecycleController,
  extractSessionId,
  resolveCliSessionIdForResume,
} = require("../../sessionLifecycle") as typeof import("../../sessionLifecycle");

import type { CliName } from "../../cli/types";
import type { SessionMetaStore } from "../../interactive/metaStore";
import type { SessionRecord, SessionStore } from "../../sessionStore";
import type { ConversationTabRecord, PendingSessionDraft } from "../../sessionTabs";
import type { PrimaryRunSessionState, ProcessTitleState } from "../../sessionLifecycle";
import type { ChatMessage } from "../../webview/types";

type LifecycleDeps = Parameters<typeof createSessionLifecycleController>[0];

type LifecycleHarness = {
  controller: ReturnType<typeof createSessionLifecycleController>;
  state: {
    store: SessionStore;
    tabs: ConversationTabRecord[];
    activeTabId: string | null;
    drafts: Map<string, PendingSessionDraft>;
    globalState: Map<string, unknown>;
    meta: SessionMetaStore;
    primary: PrimaryRunSessionState;
    primaryRunTabId: string | null;
    runtimeRuns: Array<{ tabId: string; cli: CliName; sessionId: string | null; messageTarget: ChatMessage[] }>;
    liveMessages: Map<string, ChatMessage[]>;
    processTitle: ProcessTitleState;
    isTimestampWithinHistoryRetention: (timestamp: number) => boolean;
    recoveredClaudeMessages: (sessionId: string, messages: ChatMessage[]) => ChatMessage[] | null;
  };
  calls: {
    persistedStores: number;
    persistedTabs: number;
    panelStates: number;
    panelMessages: Record<string, unknown>[];
    surfacedLoadErrors: string[];
    logs: Array<{ level: "debug" | "info" | "error"; event: string; payload?: unknown }>;
  };
  paths: {
    root: string;
    messageDirRoot: string;
    workspaceKey: string;
  };
  cleanup: () => void;
};

function createEmptyStore(): SessionStore {
  return {
    codex: { currentId: null, sessions: [] },
    claude: { currentId: null, sessions: [] },
    opencode: { currentId: null, sessions: [] },
  };
}

function createMessage(id: string, role: ChatMessage["role"], content: string): ChatMessage {
  return { id, role, content, createdAt: 100 };
}

function createLifecycleHarness(options: { messageDirIsFile?: boolean } = {}): LifecycleHarness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-lifecycle-core-"));
  const messageDirRoot = path.join(root, "messages");
  if (options.messageDirIsFile) {
    fs.writeFileSync(messageDirRoot, "blocked", "utf8");
  }

  const workspaceKey = "workspace-a";
  const state: LifecycleHarness["state"] = {
    store: createEmptyStore(),
    tabs: [{
      id: "tab-1",
      cli: "codex",
      sessionId: null,
      sessionIdByCli: {},
      createdAt: 1,
    }],
    activeTabId: "tab-1",
    drafts: new Map(),
    globalState: new Map(),
    meta: {},
    primary: { cli: null, sessionId: null, tabId: null, messageTarget: null },
    primaryRunTabId: null,
    runtimeRuns: [],
    liveMessages: new Map(),
    processTitle: {
      activeCliForRun: null,
      activeProcessTitleRunId: null,
      activeProcessTitleBase: null,
    },
    isTimestampWithinHistoryRetention: () => true,
    recoveredClaudeMessages: () => null,
  };
  const calls: LifecycleHarness["calls"] = {
    persistedStores: 0,
    persistedTabs: 0,
    panelStates: 0,
    panelMessages: [],
    surfacedLoadErrors: [],
    logs: [],
  };
  const draftKey = (tabId: string, cli: CliName = "codex"): string => `${tabId}:${cli}`;
  const getDraft = (tabId: string, cli: CliName = "codex"): PendingSessionDraft => {
    const key = draftKey(tabId, cli);
    const existing = state.drafts.get(key);
    if (existing) {
      return existing;
    }
    const draft: PendingSessionDraft = { label: null, firstPrompt: null, messages: [] };
    state.drafts.set(key, draft);
    return draft;
  };
  const log = (level: "debug" | "info" | "error") => (event: string, payload?: unknown): void => {
    calls.logs.push({ level, event, payload });
  };

  const deps: LifecycleDeps = {
    activeWorkspaceKey: () => workspaceKey,
    workspaceKeyFallback: "default-workspace",
    legacyMessageDir: path.join(root, "legacy-messages"),
    messageDirRoot,
    frozenThreadLimit: 2,
    historyRetentionDays: 30,
    legacySessionFile: path.join(root, "legacy-sessions.json"),
    localSessionPrefix: "local_",
    sessionDir: path.join(root, "sessions"),
    sessionStoreKey: "session-store",
    sessionStore: () => state.store,
    globalStateGet: <T>(key: string): T | undefined => state.globalState.get(key) as T | undefined,
    globalStateKeys: () => Array.from(state.globalState.keys()),
    globalStateUpdate: async (key: string, value: unknown): Promise<void> => {
      if (value === undefined) {
        state.globalState.delete(key);
      } else {
        state.globalState.set(key, value);
      }
    },
    sessionMessageCache: new Map(),
    sessionMessageLoadErrors: new Map(),
    readSessionMetaStore: () => state.meta,
    writeSessionMetaStore: (meta) => {
      state.meta = meta;
    },
    getSessionMetaFilePath: (key) => path.join(root, `${key ?? workspaceKey}.meta.json`),
    getSessionStoreKey: (key) => `session-store:${key ?? workspaceKey}`,
    getCurrentSessionId: (cli) => state.store[cli].currentId,
    setCurrentSession: (cli, sessionId) => {
      state.store[cli].currentId = sessionId;
    },
    persistSessionStore: (store) => {
      state.store = store;
      calls.persistedStores += 1;
    },
    postPanelState: () => {
      calls.panelStates += 1;
    },
    sendPanelMessage: (payload) => {
      calls.panelMessages.push(payload);
    },
    showSessionLoadError: (detail) => {
      calls.surfacedLoadErrors.push(detail);
    },
    getActiveConversationTabId: () => state.activeTabId,
    getConversationTabById: (tabId) => state.tabs.find((tab) => tab.id === tabId) ?? null,
    getConversationTabs: () => state.tabs,
    persistConversationTabsToWorkspaceSettings: () => {
      calls.persistedTabs += 1;
    },
    getPendingSessionDraft: (tabId, cli) => getDraft(tabId, cli),
    updatePendingSessionDraft: (tabId, patch, cli) => Object.assign(getDraft(tabId, cli), patch),
    clearPendingSessionDraft: (tabId, cli) => {
      state.drafts.delete(draftKey(tabId, cli));
    },
    clearAllPendingSessionDrafts: () => {
      state.drafts.clear();
    },
    getLiveMessagesForTab: (tabId) => state.liveMessages.get(tabId) ?? null,
    recoverClaudeMessagesFromTranscript: (sessionId, messages) => state.recoveredClaudeMessages(sessionId, messages),
    isTimestampWithinHistoryRetention: (timestamp) => state.isTimestampWithinHistoryRetention(timestamp),
    buildSessionLabelFromPrompt: (prompt) => prompt?.trim() || null,
    shouldUseFallbackSessionLabel: (label) => !label || label === "Unnamed",
    getPrimaryRunTabId: () => state.primaryRunTabId,
    getPrimaryRunSessionState: () => state.primary,
    setPrimaryRunSessionState: (patch) => {
      if (patch.sessionId !== undefined) {
        state.primary.sessionId = patch.sessionId;
      }
      if (patch.messageTarget !== undefined) {
        state.primary.messageTarget = patch.messageTarget;
      }
    },
    getRuntimeSessionReferences: (tabId) => state.runtimeRuns
      .filter((run) => !tabId || run.tabId === tabId),
    getProcessTitleState: () => state.processTitle,
    setProcessTitleState: (patch) => {
      state.processTitle = { ...state.processTitle, ...patch };
    },
    t: (key) => key === "session.loadFailedTitle" ? "Session load failed" : "Unnamed",
    logDebug: log("debug"),
    logInfo: log("info"),
    logError: log("error"),
  };

  return {
    controller: createSessionLifecycleController(deps),
    state,
    calls,
    paths: { root, messageDirRoot, workspaceKey },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function createRecord(id: string, label: string = "Unnamed"): SessionRecord {
  return { id, label, createdAt: 1, lastUsedAt: 2 };
}

test("parses CLI-specific session ids and rejects local OpenCode resume ids", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";

  assert.equal(extractSessionId("codex", `session id: ${uuid}`), uuid);
  assert.equal(extractSessionId("claude", '{"session_id":"claude-session"}'), "claude-session");
  assert.equal(extractSessionId("opencode", '{"sessionID":"opencode-session"}'), "opencode-session");
  assert.equal(extractSessionId("codex", "no session here"), undefined);

  assert.equal(resolveCliSessionIdForResume("opencode", " local_123_abc "), null);
  assert.equal(resolveCliSessionIdForResume("codex", " local_123_abc "), "local_123_abc");
  assert.equal(resolveCliSessionIdForResume("opencode", " remote-session "), "remote-session");
  assert.equal(resolveCliSessionIdForResume("claude", "   "), null);
});

test("restores and normalizes the persisted session store from workspace state", () => {
  const harness = createLifecycleHarness();
  try {
    harness.state.globalState.set("session-store:workspace-a", {
      codex: {
        currentId: "missing-id",
        sessions: [{ ...createRecord("codex-1", ""), firstPrompt: " First prompt " }],
      },
    } as SessionStore);

    const restored = harness.controller.loadSessionStore();

    assert.equal(restored.codex.currentId, "codex-1");
    assert.equal(restored.codex.sessions[0].label, "First prompt");
    assert.equal(restored.claude.sessions.length, 0);
    assert.equal(harness.state.store, restored);
    assert.equal(harness.calls.persistedStores, 1);
  } finally {
    harness.cleanup();
  }
});

test("persists a pending run by creating and adopting a local session", () => {
  const harness = createLifecycleHarness();
  try {
    const pending = createMessage("pending-1", "user", "Start an unsaved run");
    harness.state.primary = {
      cli: "codex",
      sessionId: null,
      tabId: "tab-1",
      messageTarget: [pending],
    };
    harness.state.primaryRunTabId = "tab-1";

    harness.controller.persistActiveMessages();

    const sessionId = harness.state.store.codex.currentId;
    assert.match(sessionId ?? "", /^local_/);
    assert.equal(harness.state.tabs[0].sessionId, sessionId);
    assert.equal(harness.state.tabs[0].sessionIdByCli.codex, sessionId);
    assert.deepEqual(harness.controller.loadSessionMessages("codex", sessionId!), [
      { ...pending, sequence: 0 },
    ]);
    assert.deepEqual(harness.state.drafts.get("tab-1:codex")?.messages, []);
  } finally {
    harness.cleanup();
  }
});

test("adopting a server session advances tabs, active runs, labels, and runtime references", () => {
  const harness = createLifecycleHarness();
  try {
    harness.state.store.codex.sessions.push(createRecord("remote-1"));
    harness.state.tabs[0] = {
      ...harness.state.tabs[0],
      cli: "claude",
      sessionId: "old-claude",
      sessionIdByCli: { claude: "old-claude" },
    };
    harness.state.primary = {
      cli: "codex",
      sessionId: null,
      tabId: "tab-1",
      messageTarget: [createMessage("active-1", "user", "Active prompt")],
    };
    harness.state.primaryRunTabId = "tab-1";
    harness.state.runtimeRuns.push({
      tabId: "tab-1",
      cli: "codex",
      sessionId: null,
      messageTarget: [createMessage("runtime-1", "assistant", "Runtime answer")],
    });
    harness.state.drafts.set("tab-1:codex", {
      label: "Useful label",
      firstPrompt: "First remote prompt",
      messages: [],
    });

    harness.controller.adoptSessionId("codex", "remote-1", "tab-1");

    assert.equal(harness.state.store.codex.currentId, "remote-1");
    assert.equal(harness.state.tabs[0].cli, "codex");
    assert.equal(harness.state.tabs[0].sessionId, "remote-1");
    assert.equal(harness.state.store.codex.sessions[0].label, "Useful label");
    assert.equal(harness.state.store.codex.sessions[0].firstPrompt, "First remote prompt");
    assert.equal(harness.state.primary.sessionId, "remote-1");
    assert.equal(harness.state.runtimeRuns[0].sessionId, "remote-1");
    assert.equal(harness.state.primary.messageTarget?.[0].id, "runtime-1");
    assert.equal(harness.calls.persistedTabs, 1);
  } finally {
    harness.cleanup();
  }
});

test("migrates a local session into its remote target without losing messages or bindings", () => {
  const harness = createLifecycleHarness();
  try {
    const localId = "local_100_abc";
    const targetId = "remote-1";
    harness.state.store.codex.sessions.push(createRecord(localId, "Local"), createRecord(targetId, "Remote"));
    harness.state.store.codex.currentId = localId;
    harness.state.tabs[0].sessionId = localId;
    harness.state.tabs[0].sessionIdByCli = { codex: localId };
    harness.state.primary = { cli: "codex", sessionId: localId, tabId: "tab-1", messageTarget: [] };
    harness.state.runtimeRuns.push({ tabId: "tab-1", cli: "codex", sessionId: localId, messageTarget: [] });
    harness.controller.saveSessionMessages("codex", localId, [createMessage("local-message", "user", "Local work")]);
    harness.controller.saveSessionMessages("codex", targetId, [createMessage("target-message", "assistant", "Remote work")]);

    harness.controller.migrateLocalSessionToTargetSession("codex", localId, targetId);

    assert.deepEqual(harness.state.store.codex.sessions.map((session) => session.id), [targetId]);
    assert.equal(harness.state.store.codex.currentId, targetId);
    assert.equal(harness.state.tabs[0].sessionId, targetId);
    assert.equal(harness.state.runtimeRuns[0].sessionId, targetId);
    assert.deepEqual(
      harness.controller.loadSessionMessages("codex", targetId).map((message) => message.id),
      ["target-message", "local-message"],
    );

    const persistedCount = harness.calls.persistedStores;
    harness.controller.migrateLocalSessionToTargetSession("codex", "", targetId);
    assert.equal(harness.calls.persistedStores, persistedCount);
  } finally {
    harness.cleanup();
  }
});

test("keeps interactive mappings CLI-specific and recovers from Claude transcript errors", () => {
  const harness = createLifecycleHarness();
  try {
    harness.controller.upsertInteractiveMapping("codex", "local-codex", "thread-1", {
      freezePrevious: "thread-0",
      codexSelection: { configId: "config-a", model: "gpt-5.5" },
    });
    harness.controller.upsertInteractiveMapping("claude", "local-claude", "session-1");

    assert.equal(harness.controller.resolveInteractiveMappedId("codex", "local-codex"), "thread-1");
    assert.deepEqual(harness.controller.resolveCodexInteractiveSelection("local-codex"), {
      configId: "config-a",
      model: "gpt-5.5",
    });
    assert.equal(harness.controller.resolveInteractiveMappedId("claude", "local-claude"), "session-1");
    assert.equal(harness.controller.resolveCodexInteractiveSelection("local-claude"), null);
    assert.equal(harness.controller.resolveInteractiveMappedId("opencode", "local-opencode"), "local-opencode");

    const claudeDir = path.join(harness.paths.messageDirRoot, harness.paths.workspaceKey, "claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "claude-1.json"),
      JSON.stringify({ messages: [createMessage("question", "user", "Recover this")] }),
      "utf8",
    );
    harness.state.recoveredClaudeMessages = () => {
      throw new Error("transcript unavailable");
    };

    assert.equal(harness.controller.loadSessionMessages("claude", "claude-1")[0].id, "question");
    assert.ok(harness.calls.logs.some((entry) => entry.event === "claude-session-recover-failed"));

    fs.writeFileSync(
      path.join(claudeDir, "claude-2.json"),
      JSON.stringify({ messages: [createMessage("recoverable", "user", "Recover this successfully")] }),
      "utf8",
    );
    harness.state.recoveredClaudeMessages = () => [createMessage("recovered", "assistant", "Recovered answer")];
    assert.equal(harness.controller.loadSessionMessages("claude", "claude-2")[0].id, "recovered");
    assert.ok(harness.calls.logs.some((entry) => entry.event === "claude-session-recovered-from-transcript"));

    fs.writeFileSync(
      path.join(claudeDir, "claude-write-fails.json"),
      JSON.stringify({ messages: [createMessage("write-fails", "user", "Recover but fail to persist")] }),
      "utf8",
    );
    const fsModule = require("fs") as typeof import("fs");
    const originalWriteFileSync = fsModule.writeFileSync;
    fsModule.writeFileSync = ((target: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
      if (String(target).endsWith("claude-write-fails.json")) {
        throw new Error("mock recovered write failure");
      }
      return originalWriteFileSync(target, data, options);
    }) as typeof fs.writeFileSync;
    try {
      assert.equal(harness.controller.loadSessionMessages("claude", "claude-write-fails")[0].id, "recovered");
    } finally {
      fsModule.writeFileSync = originalWriteFileSync;
    }
    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-messages-write-error"));

    fs.writeFileSync(
      path.join(claudeDir, "claude-non-error.json"),
      JSON.stringify({ messages: [createMessage("non-error", "user", "Recover with non-error throw")] }),
      "utf8",
    );
    harness.state.recoveredClaudeMessages = () => {
      throw "string transcript failure";
    };
    assert.equal(harness.controller.loadSessionMessages("claude", "claude-non-error")[0].id, "non-error");

    fs.writeFileSync(
      path.join(claudeDir, "claude-assistant.json"),
      JSON.stringify({ messages: [createMessage("already-answer", "assistant", "Already answered")] }),
      "utf8",
    );
    assert.equal(harness.controller.loadSessionMessages("claude", "claude-assistant")[0].id, "already-answer");

    fs.writeFileSync(
      path.join(claudeDir, "claude-blank-user.json"),
      JSON.stringify({ messages: [createMessage("blank-user", "user", "   ")] }),
      "utf8",
    );
    assert.equal(harness.controller.loadSessionMessages("claude", "claude-blank-user")[0].id, "blank-user");

    harness.controller.deleteInteractiveMapping("claude", "local-claude");
    assert.equal(harness.state.meta.byCli?.claude?.["local-claude"], undefined);
  } finally {
    harness.cleanup();
  }
});

test("surfaces missing, live, draft, and failed session-message loads to the panel", () => {
  const harness = createLifecycleHarness();
  try {
    harness.state.activeTabId = null;
    harness.controller.sendSessionMessagesToPanel("codex", "ignored");
    assert.deepEqual(harness.calls.panelMessages.pop(), { type: "setMessages", messages: [], tabId: null });

    harness.state.activeTabId = "tab-1";
    const live = [createMessage("live-1", "assistant", "Still running")];
    harness.state.liveMessages.set("tab-1", live);
    harness.controller.sendSessionMessagesToPanel("codex", "session-1");
    assert.deepEqual(harness.calls.panelMessages.pop(), { type: "setMessages", messages: live, tabId: "tab-1" });

    harness.state.liveMessages.clear();
    harness.state.drafts.set("tab-1:codex", { label: null, firstPrompt: null, messages: [createMessage("draft-1", "user", "Draft")] });
    harness.controller.sendSessionMessagesToPanel("codex", null);
    assert.equal((harness.calls.panelMessages.pop()?.messages as ChatMessage[])[0].id, "draft-1");

    harness.controller.saveSessionMessages("codex", "normal-session", [
      createMessage("normal-1", "assistant", "Normal answer"),
      { id: "normal-2", content: "Recovered malformed role", createdAt: 100 } as ChatMessage,
    ]);
    harness.controller.sendSessionMessagesToPanel("codex", "normal-session");
    const sessionLog = harness.calls.logs.filter((entry) => entry.event === "setMessages-session").at(-1);
    assert.deepEqual((sessionLog?.payload as { counts?: Record<string, number> } | undefined)?.counts, {
      assistant: 1,
      unknown: 1,
    });

    const codexDir = path.join(harness.paths.messageDirRoot, harness.paths.workspaceKey, "codex");
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexDir, "from-disk.json"),
      JSON.stringify({ messages: [createMessage("from-disk", "assistant", "Loaded from disk")] }),
      "utf8",
    );
    harness.controller.sendSessionMessagesToPanel("codex", "from-disk");
    assert.equal((harness.calls.panelMessages.at(-1)?.messages as ChatMessage[])[0]?.id, "from-disk");

    fs.writeFileSync(path.join(codexDir, "broken.json"), "{not-json", "utf8");
    harness.controller.sendSessionMessagesToPanel("codex", "broken");

    const lastMessageIndex = harness.calls.panelMessages.length - 1;
    assert.equal((harness.calls.panelMessages[lastMessageIndex - 1]?.messages as ChatMessage[]).length, 0);
    assert.equal(harness.calls.panelMessages[lastMessageIndex]?.type, "sessionLoadError");
    assert.equal(harness.calls.surfacedLoadErrors.length, 1);
  } finally {
    harness.cleanup();
  }
});

test("keeps in-memory messages usable when isolated message persistence fails", () => {
  const harness = createLifecycleHarness({ messageDirIsFile: true });
  try {
    const message = createMessage("memory-only", "user", "Do not lose this");

    harness.controller.saveSessionMessages("opencode", "op-1", [message]);

    assert.deepEqual(harness.controller.loadSessionMessages("opencode", "op-1"), [
      { ...message, sequence: 0 },
    ]);
    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-messages-write-error"));
  } finally {
    harness.cleanup();
  }
});

test("manages session artifacts, draft adoption, retention, and process title through public lifecycle methods", async () => {
  const harness = createLifecycleHarness();
  const originalTitle = process.title;
  try {
    harness.state.store.codex.sessions.push(createRecord("session-1", "Unnamed"));
    harness.state.drafts.set("tab-1:codex", {
      label: null,
      firstPrompt: "First prompt",
      messages: [createMessage("pending-1", "user", "Pending")],
    });
    harness.controller.assignPendingLabel("codex", "tab-1", "session-1");
    assert.equal(harness.state.store.codex.sessions[0].firstPrompt, "First prompt");

    harness.state.drafts.set("tab-1:codex", {
      label: "Draft label",
      firstPrompt: "Second prompt",
      messages: [createMessage("pending-2", "assistant", "Pending answer")],
    });
    harness.controller.assignPendingLabel("codex", "tab-1", "session-1");
    harness.controller.attachPendingMessages("codex", "tab-1", "session-1");
    assert.equal(harness.state.store.codex.sessions[0].label, "Draft label");
    assert.equal(harness.controller.loadSessionMessages("codex", "session-1").length, 1);

    harness.state.tabs[0].sessionId = "session-1";
    harness.state.tabs[0].sessionIdByCli = { codex: "session-1" };
    harness.controller.replaceConversationTabSessionReferences("codex", "session-1", "session-2");
    assert.equal(harness.state.tabs[0].sessionId, "session-2");
    harness.controller.replaceConversationTabSessionReferences("codex", "session-2", "session-2");

    harness.controller.upsertInteractiveMapping("codex", "local_123_mapped", "remote-mapped");
    assert.equal(harness.controller.findSupersedingLocalSessionTarget("codex", "local_123_mapped"), "remote-mapped");
    assert.equal(harness.controller.findSupersedingLocalSessionTarget("codex", "remote-mapped"), null);
    assert.equal(harness.controller.repairSupersededLocalSession("codex", "local_123_mapped", { notifyPanel: false }), "remote-mapped");
    harness.state.store.codex.sessions.push(createRecord("local_321_batch", "Batch Local"), createRecord("remote-batch", "Batch Remote"));
    harness.controller.saveSessionMessages("codex", "local_321_batch", [createMessage("batch-local", "user", "Batch local")]);
    harness.controller.upsertInteractiveMapping("codex", "local_321_batch", "remote-batch");
    harness.controller.repairSupersededLocalSessions({ notifyPanel: false });
    assert.equal(harness.state.store.codex.sessions.some((session) => session.id === "local_321_batch"), false);

    harness.state.primary = {
      cli: "codex",
      sessionId: null,
      tabId: "tab-1",
      messageTarget: [createMessage("primary-pending", "user", "Primary")],
    };
    harness.state.primaryRunTabId = "tab-1";
    harness.state.runtimeRuns.push({
      tabId: "tab-1",
      cli: "codex",
      sessionId: null,
      messageTarget: [createMessage("runtime-pending", "assistant", "Runtime")],
    });
    harness.controller.syncPendingDraftMessagesForSessionAdoption("codex", null);
    harness.controller.syncPendingDraftMessagesForSessionAdoption("codex", "tab-1");
    assert.equal(harness.state.drafts.get("tab-1:codex")?.messages[0]?.id, "runtime-pending");

    harness.state.processTitle = {
      activeRunId: "run-1",
      activeCliForRun: "codex",
      activeProcessTitleRunId: "run-1",
      activeProcessTitleBase: null,
    };
    harness.controller.applyProcessTitle("run-1", "codex", "session-1");
    assert.match(process.title, /codex/i);
    harness.controller.updateProcessTitle("codex", "session-2");
    assert.match(process.title, /session-2/u);
    harness.controller.applyProcessTitle("run-null-session", "codex", null);
    assert.match(process.title, /run-null-session/u);
    harness.controller.restoreProcessTitle();
    assert.equal(process.title, originalTitle);

    harness.controller.sendSessionLoadErrorToPanel("codex", "session-1", "load failed", null);
    assert.equal(harness.calls.panelMessages.at(-1)?.type, "sessionLoadError");

    harness.controller.saveSessionMessages("codex", "delete-me", [createMessage("delete-message", "user", "Delete")]);
    harness.state.store.codex.sessions.push(createRecord("delete-me"));
    harness.controller.deleteSession("codex", "delete-me");
    harness.controller.deleteSession("codex", "missing");
    harness.controller.deleteInteractiveMapping("codex", "local_123_mapped");
    harness.controller.deleteSessionMessageArtifacts("codex", "missing-artifact");
    assert.equal(harness.state.store.codex.sessions.some((session) => session.id === "delete-me"), false);

    harness.state.globalState.set("session-store:cleanup-empty", createEmptyStore());
    await harness.controller.cleanupSessionRetentionAcrossWorkspaces();
    assert.equal(harness.state.globalState.has("session-store:cleanup-empty"), false);

    fs.writeFileSync(path.join(harness.paths.root, `${harness.paths.workspaceKey}.meta.json`), "{}", "utf8");
    harness.controller.clearAllSessions();
    assert.deepEqual(harness.state.store, createEmptyStore());
    assert.equal(harness.state.drafts.size, 0);
  } finally {
    process.title = originalTitle;
    harness.cleanup();
  }
});

test("cleans expired workspace artifacts and contains malformed session-message data", async () => {
  const harness = createLifecycleHarness();
  try {
    const expiredWorkspace = "expired-workspace";
    const staleId = "stale-session";
    const staleMetaFile = path.join(harness.paths.root, `${expiredWorkspace}.meta.json`);
    const staleMessageDir = path.join(harness.paths.messageDirRoot, expiredWorkspace, "codex");
    harness.state.isTimestampWithinHistoryRetention = () => false;
    harness.state.globalState.set(`session-store:${expiredWorkspace}`, {
      codex: { currentId: staleId, sessions: [{ ...createRecord(staleId), lastUsedAt: 1 }] },
      claude: { currentId: null, sessions: [] },
      opencode: { currentId: null, sessions: [] },
    } as SessionStore);
    harness.state.meta = {
      byCli: { codex: { [staleId]: { threadId: "thread-1", frozenThreadIds: [], updatedAt: 1 } } },
    } as SessionMetaStore;
    fs.mkdirSync(staleMessageDir, { recursive: true });
    const staleMessageFile = path.join(staleMessageDir, `${staleId}.json`);
    fs.writeFileSync(staleMessageFile, JSON.stringify({ messages: [] }), "utf8");
    fs.writeFileSync(staleMetaFile, "{}", "utf8");
    const fsModule = require("fs") as typeof import("fs");
    const originalUnlinkSync = fsModule.unlinkSync;
    fsModule.unlinkSync = ((target: fs.PathLike) => {
      if (String(target) === staleMessageFile) {
        throw new Error("mock stale message delete failure");
      }
      return originalUnlinkSync(target);
    }) as typeof fs.unlinkSync;

    await harness.controller.cleanupSessionRetentionAcrossWorkspaces();
    fsModule.unlinkSync = originalUnlinkSync;

    assert.equal(harness.state.globalState.has(`session-store:${expiredWorkspace}`), false);
    assert.equal(fs.existsSync(staleMessageFile), true);
    assert.equal(fs.existsSync(staleMetaFile), false);
    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-messages-retention-delete-error"));
    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-history-retention-pruned"));
    fs.rmSync(staleMessageFile, { force: true });
    fs.rmSync(path.join(harness.paths.messageDirRoot, expiredWorkspace), { recursive: true, force: true });


    harness.state.isTimestampWithinHistoryRetention = () => false;
    harness.state.globalState.set("session-store:claude-only-stale", {
      codex: { currentId: null, sessions: [] },
      claude: { currentId: "stale-claude", sessions: [{ ...createRecord("stale-claude"), lastUsedAt: 1 }] },
      opencode: { currentId: null, sessions: [] },
    } as SessionStore);
    harness.state.meta = {
      byCli: {
        claude: { "stale-claude": { sessionId: "stale-session", frozenSessionIds: [], updatedAt: 1 } },
      },
    } as SessionMetaStore;
    const claudeOnlyMetaFile = path.join(harness.paths.root, "claude-only-stale.meta.json");
    fs.writeFileSync(claudeOnlyMetaFile, "{}", "utf8");
    const fsModuleForMeta = require("fs") as typeof import("fs");
    const originalMetaUnlinkSync = fsModuleForMeta.unlinkSync;
    fsModuleForMeta.unlinkSync = ((target: fs.PathLike) => {
      if (String(target) === claudeOnlyMetaFile) {
        throw new Error("mock session meta delete failure");
      }
      return originalMetaUnlinkSync(target);
    }) as typeof fs.unlinkSync;
    await harness.controller.cleanupSessionRetentionAcrossWorkspaces();
    fsModuleForMeta.unlinkSync = originalMetaUnlinkSync;
    assert.equal(harness.state.meta.byCli, undefined);
    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-meta-delete-error"));
    harness.state.isTimestampWithinHistoryRetention = () => true;
    harness.state.primary = { cli: null, sessionId: null, tabId: null, messageTarget: null };
    harness.controller.persistActiveMessages();
    harness.state.primary = {
      cli: "codex",
      sessionId: null,
      tabId: null,
      messageTarget: [createMessage("no-tab", "user", "No active tab")],
    };
    harness.controller.persistActiveMessages();
    harness.controller.ensureLocalSession("codex", "tab-1");
    harness.controller.updateProcessTitle("codex", "ignored");
    harness.controller.restoreProcessTitle();

    const malformedDir = path.join(harness.paths.messageDirRoot, harness.paths.workspaceKey, "codex");
    fs.mkdirSync(malformedDir, { recursive: true });
    fs.writeFileSync(path.join(malformedDir, "malformed-items.json"), JSON.stringify({ messages: [null] }), "utf8");
    harness.controller.sendSessionMessagesToPanel("codex", "malformed-items", "tab-1");

    assert.equal(harness.calls.panelMessages.at(-1)?.type, "sessionLoadError");
    assert.equal(harness.calls.surfacedLoadErrors.length, 1);
  } finally {
    harness.cleanup();
  }
});


test("writes pruned session metadata when retained mappings remain", async () => {
  const harness = createLifecycleHarness();
  try {
    const workspace = "mixed-retention-workspace";
    harness.state.isTimestampWithinHistoryRetention = (timestamp) => timestamp === 999;
    harness.state.globalState.set(`session-store:${workspace}`, {
      codex: { currentId: "stale-codex", sessions: [{ ...createRecord("stale-codex"), lastUsedAt: 1 }] },
      claude: { currentId: "kept-claude", sessions: [{ ...createRecord("kept-claude"), lastUsedAt: 999 }] },
      opencode: { currentId: null, sessions: [] },
    } as SessionStore);
    harness.state.meta = {
      byCli: {
        codex: { "stale-codex": { threadId: "thread-stale", frozenThreadIds: [], updatedAt: 1 } },
        claude: { "kept-claude": { sessionId: "session-kept", frozenSessionIds: [], updatedAt: 999 } },
      },
    } as SessionMetaStore;

    await harness.controller.cleanupSessionRetentionAcrossWorkspaces();

    assert.equal(harness.state.meta.byCli?.codex, undefined);
    assert.equal(harness.state.meta.byCli?.claude?.["kept-claude"]?.sessionId, "session-kept");
  } finally {
    harness.cleanup();
  }
});

test("contains session file write errors during retained workspace cleanup", async () => {
  const harness = createLifecycleHarness();
  try {
    fs.mkdirSync(path.join(harness.paths.root, "sessions", "blocked-write.json"), { recursive: true });
    harness.state.globalState.set("session-store:blocked-write", {
      codex: { currentId: "kept", sessions: [createRecord("kept")] },
      claude: { currentId: null, sessions: [] },
      opencode: { currentId: null, sessions: [] },
    } as SessionStore);

    await harness.controller.cleanupSessionRetentionAcrossWorkspaces();

    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-file-write-error"));
  } finally {
    harness.cleanup();
  }
});

test("contains clear-all message and metadata cleanup failures", () => {
  const harness = createLifecycleHarness();
  const fsModule = require("fs") as typeof import("fs");
  const originalRmSync = fsModule.rmSync;
  const originalUnlinkSync = fsModule.unlinkSync;
  const messageDir = path.join(harness.paths.messageDirRoot, harness.paths.workspaceKey);
  const metaFile = path.join(harness.paths.root, `${harness.paths.workspaceKey}.meta.json`);
  try {
    fs.mkdirSync(messageDir, { recursive: true });
    fs.writeFileSync(path.join(messageDir, "kept.tmp"), "message", "utf8");
    fs.writeFileSync(metaFile, "{}", "utf8");
    fsModule.rmSync = ((target: fs.PathLike, options?: fs.RmOptions) => {
      if (String(target) === messageDir) {
        throw new Error("mock message cleanup failure");
      }
      return originalRmSync(target, options);
    }) as typeof fs.rmSync;

    harness.controller.clearAllSessions();
    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-messages-clear-error"));
    assert.equal(fs.existsSync(metaFile), false);

    fs.writeFileSync(metaFile, "{}", "utf8");
    fsModule.unlinkSync = ((target: fs.PathLike) => {
      if (String(target) === metaFile) {
        throw new Error("mock metadata cleanup failure");
      }
      return originalUnlinkSync(target);
    }) as typeof fs.unlinkSync;

    harness.controller.clearAllSessions();
    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-meta-clear-error"));
  } finally {
    fsModule.rmSync = originalRmSync;
    fsModule.unlinkSync = originalUnlinkSync;
    harness.cleanup();
  }
});

test("contains session message artifact deletion failures", () => {
  const harness = createLifecycleHarness();
  const fsModule = require("fs") as typeof import("fs");
  const originalUnlinkSync = fsModule.unlinkSync;
  const sessionId = "delete-error";
  const messageFile = path.join(harness.paths.messageDirRoot, harness.paths.workspaceKey, "codex", `${sessionId}.json`);
  try {
    harness.controller.saveSessionMessages("codex", sessionId, [createMessage("delete-error-message", "user", "Delete me")]);
    harness.state.store.codex.sessions.push(createRecord(sessionId));
    fsModule.unlinkSync = ((target: fs.PathLike) => {
      if (String(target) === messageFile) {
        throw new Error("mock session message delete failure");
      }
      return originalUnlinkSync(target);
    }) as typeof fs.unlinkSync;

    harness.controller.deleteSession("codex", sessionId);
    assert.ok(harness.calls.logs.some((entry) => entry.event === "session-messages-delete-error"));
  } finally {
    fsModule.unlinkSync = originalUnlinkSync;
    harness.cleanup();
  }
});

test("covers retained stores, deletion, no-op drafts, local promotion, and fallback session IDs", async () => {
  const harness = createLifecycleHarness();
  try {
    assert.equal(extractSessionId("opencode", 'notice: {"session_id":"pattern-fallback"}'), "pattern-fallback");
    assert.equal(resolveCliSessionIdForResume("codex", undefined), null);

    harness.controller.ensureLocalSession("codex", "tab-1");
    harness.state.store.codex.currentId = "existing";
    harness.state.drafts.set("tab-1:codex", { label: null, firstPrompt: null, messages: [createMessage("ignored", "user", "Ignored")] });
    harness.controller.ensureLocalSession("codex", "tab-1");
    harness.state.store.codex.currentId = null;
    harness.state.drafts.set("tab-1:codex", { label: null, firstPrompt: null, messages: [] });
    harness.controller.attachPendingMessages("codex", "tab-1", "missing-session");

    harness.state.store.codex.sessions.push(createRecord("delete-current"));
    harness.state.store.codex.currentId = "delete-current";
    harness.controller.deleteSession("codex", "delete-current");
    assert.equal(harness.state.store.codex.currentId, null);

    const localId = "local_200_local";
    harness.state.store.codex.sessions.push(createRecord(localId, "Local"));
    harness.state.store.codex.currentId = localId;
    harness.controller.saveSessionMessages("codex", localId, [createMessage("local", "user", "Local")]);
    harness.controller.migrateLocalSessionToTargetSession("codex", localId, "remote-created", { notifyPanel: false });
    assert.equal(harness.state.store.codex.sessions.some((session) => session.id === "remote-created"), true);
    assert.equal(harness.controller.repairSupersededLocalSession("codex", "local_404_missing", { notifyPanel: false }), "local_404_missing");
    assert.equal(harness.controller.resolveInteractiveMappedId("codex", "local_unmapped"), null);

    const inferredLocal = "local_300_infer";
    const inferredRemote = "remote-inferred";
    harness.state.store.codex.sessions.push(
      { ...createRecord(inferredLocal, "Infer"), createdAt: 10, lastUsedAt: 20, firstPrompt: "Same prompt" },
      { ...createRecord(inferredRemote, "Infer"), createdAt: 11, lastUsedAt: 30, firstPrompt: "Same prompt" },
    );
    harness.controller.saveSessionMessages("codex", inferredLocal, [createMessage("shared-message", "user", "Same prompt")]);
    harness.controller.saveSessionMessages("codex", inferredRemote, [
      createMessage("shared-message", "user", "Same prompt"),
      createMessage("remote-answer", "assistant", "Answer"),
    ]);
    assert.equal(harness.controller.findSupersedingLocalSessionTarget("codex", inferredLocal), inferredRemote);

    const emptyLocal = "local_400_empty";
    harness.state.store.codex.sessions.push(createRecord(emptyLocal, "Empty"));
    harness.state.primary = { cli: "codex", sessionId: emptyLocal, tabId: "tab-1", messageTarget: [] };
    harness.state.runtimeRuns.push({ tabId: "tab-1", cli: "codex", sessionId: emptyLocal, messageTarget: [] });
    harness.controller.migrateLocalSessionToTargetSession("codex", emptyLocal, "remote-empty", { notifyPanel: false });
    assert.equal(harness.state.primary.messageTarget?.length, 0);

    harness.state.store.codex.sessions.push(createRecord("adopt-empty"));
    harness.state.activeTabId = "tab-1";
    harness.state.tabs[0] = {
      ...harness.state.tabs[0],
      cli: "codex",
      sessionId: "adopt-empty",
      sessionIdByCli: { codex: "adopt-empty" },
    };
    harness.state.primary = { cli: "codex", sessionId: null, tabId: "tab-1", messageTarget: [] };
    harness.state.primaryRunTabId = "tab-1";
    harness.controller.adoptSessionId("codex", "adopt-empty");
    assert.equal(harness.state.primary.messageTarget?.length, 0);

    const persistedMessage = createMessage("persisted", "assistant", "Persisted");
    harness.state.primary = { cli: "codex", sessionId: "remote-created", tabId: "tab-1", messageTarget: [persistedMessage] };
    harness.controller.persistActiveMessages();
    assert.equal(harness.controller.loadSessionMessages("codex", "remote-created")[0]?.id, "persisted");

    harness.state.globalState.set("session-store:retained-workspace", {
      codex: { currentId: "kept", sessions: [createRecord("kept")] },
      claude: { currentId: null, sessions: [] },
      opencode: { currentId: null, sessions: [] },
    } as SessionStore);
    await harness.controller.cleanupSessionRetentionAcrossWorkspaces();
    assert.ok(harness.state.globalState.get("session-store:retained-workspace"));
  } finally {
    harness.cleanup();
  }
});
