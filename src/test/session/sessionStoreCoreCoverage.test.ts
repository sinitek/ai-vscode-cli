import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  cleanupMessageStorage,
  cleanupWorkspaceMessageFiles,
  collectStaleSessionIds,
  collectWorkspaceKeysForSessionCleanup,
  deleteSessionFile,
  ensureMessageSequence,
  ensureSessionStore,
  getLatestSessionIdFromRecords,
  getMessageDir,
  getMessageFile,
  getSessionFilePath,
  getSessionKey,
  isSessionStoreEmpty,
  readMessageFile,
  readSessionFile,
  sanitizeMessages,
  writeMessageFile,
  writeSessionFile,
} from "../../sessionStore";
import type { SessionRecord, SessionStore } from "../../sessionStore";
import type { ChatMessage } from "../../webview/types";

const cliList = ["codex", "claude", "opencode"] as const;

type TemporaryPaths = {
  root: string;
  workspaceKeyFallback: string;
  legacySessionFile: string;
  sessionDir: string;
  legacyMessageDir: string;
  messageDirRoot: string;
};

function createTemporaryPaths(): TemporaryPaths {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-session-store-core-"));
  return {
    root,
    workspaceKeyFallback: "default-workspace",
    legacySessionFile: path.join(root, "legacy-sessions.json"),
    sessionDir: path.join(root, "session-stores"),
    legacyMessageDir: path.join(root, "legacy-messages"),
    messageDirRoot: path.join(root, "message-stores"),
  };
}

function removeTemporaryPaths(paths: TemporaryPaths): void {
  fs.rmSync(paths.root, { recursive: true, force: true });
}

function createStore(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    codex: { currentId: null, sessions: [] },
    claude: { currentId: null, sessions: [] },
    opencode: { currentId: null, sessions: [] },
    ...overrides,
  };
}

function createSession(id: string, lastUsedAt: number, extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    label: id,
    createdAt: lastUsedAt,
    lastUsedAt,
    ...extra,
  };
}

test("normalizes retained sessions, stale current IDs, and basic store helpers", () => {
  const options = {
    cliList,
    unnamedLabel: "Untitled",
    isTimestampWithinHistoryRetention: (timestamp: number) => timestamp >= 100,
    buildSessionLabelFromPrompt: (prompt: string | null | undefined) =>
      prompt ? `From: ${prompt.trim()}` : null,
    shouldUseFallbackSessionLabel: (label: string | null | undefined) => !label || label === "New conversation",
  };
  const source = {
    codex: {
      currentId: "removed-current",
      sessions: [
        createSession("expired", 30, { firstPrompt: "   " }),
        createSession("fallback", 120, { label: " New conversation ", firstPrompt: " Draft " }),
        createSession("latest", 300, { label: "  Saved label  " }),
      ],
    },
    claude: {
      currentId: "unknown",
      sessions: "not-an-array",
    },
  } as unknown as SessionStore;

  const retained = ensureSessionStore(source, options);

  assert.deepEqual(retained.codex, {
    currentId: "latest",
    sessions: [
      createSession("fallback", 120, { label: "From: Draft", firstPrompt: " Draft " }),
      createSession("latest", 300, { label: "Saved label", firstPrompt: undefined }),
    ],
  });
  assert.deepEqual(retained.claude, { currentId: null, sessions: [] });
  assert.deepEqual(retained.opencode, { currentId: null, sessions: [] });
  assert.deepEqual(ensureSessionStore(undefined, options), createStore());

  assert.equal(getLatestSessionIdFromRecords([]), null);
  assert.equal(
    getLatestSessionIdFromRecords([createSession("first", 9), createSession("same-time", 9)]),
    "first",
  );
  assert.equal(isSessionStoreEmpty(createStore(), cliList), true);
  assert.equal(isSessionStoreEmpty(retained, cliList), false);

  assert.deepEqual(collectStaleSessionIds(undefined, retained, cliList), {
    codex: [],
    claude: [],
    opencode: [],
  });
  assert.deepEqual(collectStaleSessionIds(source, retained, cliList), {
    codex: ["expired"],
    claude: [],
    opencode: [],
  });

  const fallbackOnly = ensureSessionStore({
    codex: {
      currentId: undefined,
      sessions: [
        { id: "missing-fields", label: null, createdAt: undefined, lastUsedAt: Number.NaN },
        { id: "missing-last-used", label: "Saved", createdAt: undefined, lastUsedAt: undefined },
      ],
    },
  } as unknown as SessionStore, {
    ...options,
    isTimestampWithinHistoryRetention: () => true,
  });
  assert.deepEqual(fallbackOnly.codex, {
    currentId: null,
    sessions: [
      {
        id: "missing-fields",
        label: "Untitled",
        createdAt: fallbackOnly.codex.sessions[0]?.createdAt,
        lastUsedAt: Number.NaN,
        firstPrompt: undefined,
      },
      {
        id: "missing-last-used",
        label: "Saved",
        createdAt: fallbackOnly.codex.sessions[1]?.createdAt,
        lastUsedAt: fallbackOnly.codex.sessions[1]?.lastUsedAt,
        firstPrompt: undefined,
      },
    ],
  });
  assert.ok(Number.isFinite(fallbackOnly.codex.sessions[0]?.createdAt));
  assert.ok(Number.isNaN(fallbackOnly.codex.sessions[0]?.lastUsedAt));
  assert.ok(Number.isFinite(fallbackOnly.codex.sessions[1]?.createdAt));
  assert.ok(Number.isFinite(fallbackOnly.codex.sessions[1]?.lastUsedAt));
  assert.deepEqual(
    collectStaleSessionIds(source, { codex: retained.codex } as SessionStore, cliList),
    { codex: ["expired"], claude: [], opencode: [] },
  );
});

test("discovers workspace stores and removes only orphaned message files", () => {
  const paths = createTemporaryPaths();
  try {
    fs.writeFileSync(paths.legacySessionFile, "{}", "utf8");
    fs.mkdirSync(paths.sessionDir, { recursive: true });
    fs.writeFileSync(path.join(paths.sessionDir, "project-a.meta.json"), "{}", "utf8");
    fs.writeFileSync(path.join(paths.sessionDir, "project-b.json"), "{}", "utf8");
    fs.mkdirSync(path.join(paths.sessionDir, "ignored-directory"));
    fs.mkdirSync(path.join(paths.messageDirRoot, "codex"), { recursive: true });
    fs.mkdirSync(path.join(paths.messageDirRoot, "project-c"));
    fs.writeFileSync(path.join(paths.messageDirRoot, "ignored-file.txt"), "ignore", "utf8");

    const workspaceKeys = collectWorkspaceKeysForSessionCleanup({
      cliList,
      legacySessionFile: paths.legacySessionFile,
      messageDirRoot: paths.messageDirRoot,
      sessionDir: paths.sessionDir,
      sessionStoreKey: "session-store",
      workspaceKeyFallback: paths.workspaceKeyFallback,
      globalStateKeys: ["unrelated", "session-store:project-d"],
    });
    assert.deepEqual(workspaceKeys.sort(), [
      paths.workspaceKeyFallback,
      "project-a",
      "project-b",
      "project-c",
      "project-d",
    ].sort());

    const legacyCodexDir = path.join(paths.legacyMessageDir, "codex");
    fs.mkdirSync(legacyCodexDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCodexDir, "keep.json"), "{}", "utf8");
    fs.writeFileSync(path.join(legacyCodexDir, "orphan.json"), "{}", "utf8");
    fs.writeFileSync(path.join(legacyCodexDir, "note.txt"), "ignored", "utf8");
    const projectMessageDir = path.join(paths.messageDirRoot, "project-c", "claude");
    fs.mkdirSync(projectMessageDir, { recursive: true });
    fs.writeFileSync(path.join(projectMessageDir, "orphan.json"), "{}", "utf8");

    const retained = createStore({
      codex: { currentId: "keep", sessions: [createSession("keep", 1)] },
    });
    cleanupWorkspaceMessageFiles(paths.workspaceKeyFallback, retained, { ...paths, cliList });
    assert.equal(fs.existsSync(path.join(legacyCodexDir, "keep.json")), true);
    assert.equal(fs.existsSync(path.join(legacyCodexDir, "orphan.json")), false);
    assert.equal(fs.existsSync(path.join(legacyCodexDir, "note.txt")), true);

    cleanupWorkspaceMessageFiles("project-c", createStore(), { ...paths, cliList });
    assert.equal(fs.existsSync(path.join(paths.messageDirRoot, "project-c")), false);
  } finally {
    removeTemporaryPaths(paths);
  }
});

test("reads, writes, deletes, and reports session file failures without escaping the store", () => {
  const paths = createTemporaryPaths();
  const errors: string[] = [];
  const options = {
    ...paths,
    logError: (event: string) => errors.push(event),
  };
  const store = createStore({
    codex: { currentId: "session-1", sessions: [createSession("session-1", 1)] },
  });
  try {
    assert.equal(getSessionFilePath(paths.workspaceKeyFallback, options), paths.legacySessionFile);
    assert.equal(
      getSessionFilePath("project-a", options),
      path.join(paths.sessionDir, "project-a.json"),
    );
    assert.equal(readSessionFile("project-a", options), undefined);

    writeSessionFile(store, "project-a", options);
    assert.deepEqual(readSessionFile("project-a", options), store);
    writeSessionFile(store, paths.workspaceKeyFallback, options);
    assert.deepEqual(readSessionFile(paths.workspaceKeyFallback, options), store);
    deleteSessionFile("project-a", options);
    assert.equal(fs.existsSync(path.join(paths.sessionDir, "project-a.json")), false);
    deleteSessionFile("missing", options);

    const directoryInsteadOfSessionFile = path.join(paths.root, "directory-session-file");
    fs.mkdirSync(directoryInsteadOfSessionFile);
    assert.equal(readSessionFile(paths.workspaceKeyFallback, {
      ...options,
      legacySessionFile: directoryInsteadOfSessionFile,
    }), undefined);

    const fileInsteadOfSessionDirectory = path.join(paths.root, "session-directory-file");
    fs.writeFileSync(fileInsteadOfSessionDirectory, "not a directory", "utf8");
    writeSessionFile(store, "project-write-error", {
      ...options,
      sessionDir: fileInsteadOfSessionDirectory,
    });

    const deleteDirectory = path.join(paths.root, "delete-session-directory");
    fs.mkdirSync(deleteDirectory);
    fs.mkdirSync(path.join(deleteDirectory, "project-delete-error.json"));
    deleteSessionFile("project-delete-error", { ...options, sessionDir: deleteDirectory });

    assert.deepEqual(errors, [
      "session-file-read-error",
      "session-file-write-error",
      "session-file-delete-error",
    ]);
  } finally {
    removeTemporaryPaths(paths);
  }
});

test("persists message files, retains read diagnostics, and isolates workspace cleanup", () => {
  const paths = createTemporaryPaths();
  const errors: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const loadErrors = new Map<string, string>();
  const options = {
    ...paths,
    activeWorkspaceKey: "project-a",
    loadErrors,
    buildErrorDetail: (error: unknown) => `detail: ${String(error)}`,
    logError: (event: string, payload: Record<string, unknown>) => errors.push({ event, payload }),
  };
  const message = {
    id: "message-1",
    role: "user",
    content: "Persist this message",
    createdAt: 1,
  } as ChatMessage;
  try {
    assert.equal(getMessageDir(paths.workspaceKeyFallback, paths), paths.legacyMessageDir);
    assert.equal(getMessageDir("project-a", paths), path.join(paths.messageDirRoot, "project-a"));
    assert.equal(
      getMessageFile("codex", "session-1", "project-a", paths),
      path.join(paths.messageDirRoot, "project-a", "codex", "session-1.json"),
    );
    assert.equal(getSessionKey("project-a", "codex", "session-1"), "project-a:codex:session-1");

    const missingKey = getSessionKey("project-a", "codex", "missing");
    loadErrors.set(missingKey, "old failure");
    assert.deepEqual(readMessageFile("codex", "missing", options), []);
    assert.equal(loadErrors.has(missingKey), false);

    writeMessageFile("codex", "session-1", [message], options);
    assert.deepEqual(readMessageFile("codex", "session-1", options), [message]);

    const claudeDir = path.join(paths.messageDirRoot, "project-a", "claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "invalid.json"), JSON.stringify({ message: [] }), "utf8");
    assert.deepEqual(readMessageFile("claude", "invalid", options), []);
    assert.match(loadErrors.get(getSessionKey("project-a", "claude", "invalid")) ?? "", /format invalid/);

    const openCodeDir = path.join(paths.messageDirRoot, "project-a", "opencode");
    fs.mkdirSync(openCodeDir, { recursive: true });
    fs.writeFileSync(path.join(openCodeDir, "corrupt.json"), "{", "utf8");
    assert.deepEqual(readMessageFile("opencode", "corrupt", options), []);
    assert.match(loadErrors.get(getSessionKey("project-a", "opencode", "corrupt")) ?? "", /^detail:/);
    assert.equal(errors[0]?.event, "session-messages-read-error");
    assert.equal(errors[0]?.payload.cli, "opencode");

    const fileInsteadOfMessageRoot = path.join(paths.root, "message-root-file");
    fs.writeFileSync(fileInsteadOfMessageRoot, "not a directory", "utf8");
    writeMessageFile("codex", "write-error", [message], {
      ...options,
      messageDirRoot: fileInsteadOfMessageRoot,
    });
    assert.equal(errors[1]?.event, "session-messages-write-error");

    const fallbackCodexDir = path.join(paths.legacyMessageDir, "codex");
    const fallbackClaudeDir = path.join(paths.legacyMessageDir, "claude");
    fs.mkdirSync(fallbackCodexDir, { recursive: true });
    fs.mkdirSync(fallbackClaudeDir, { recursive: true });
    cleanupMessageStorage({ ...paths, activeWorkspaceKey: paths.workspaceKeyFallback, cliList });
    assert.equal(fs.existsSync(fallbackCodexDir), false);
    assert.equal(fs.existsSync(fallbackClaudeDir), false);

    const projectDir = path.join(paths.messageDirRoot, "project-a");
    assert.equal(fs.existsSync(projectDir), true);
    cleanupMessageStorage({ ...paths, activeWorkspaceKey: "project-a", cliList });
    assert.equal(fs.existsSync(projectDir), false);

    cleanupWorkspaceMessageFiles("missing-project", createStore(), { ...paths, cliList });

    fs.mkdirSync(openCodeDir, { recursive: true });
    fs.writeFileSync(path.join(openCodeDir, "corrupt-with-default-detail.json"), "{", "utf8");
    assert.deepEqual(readMessageFile("opencode", "corrupt-with-default-detail", {
      ...paths,
      activeWorkspaceKey: "project-a",
      loadErrors,
      logError: (event: string, payload: Record<string, unknown>) => errors.push({ event, payload }),
    }), []);
    assert.match(
      loadErrors.get(getSessionKey("project-a", "opencode", "corrupt-with-default-detail")) ?? "",
      /SyntaxError/,
    );
  } finally {
    removeTemporaryPaths(paths);
  }
});

test("reports orphan deletion errors and sanitizes persisted messages into a stable sequence", () => {
  const paths = createTemporaryPaths();
  const errors: string[] = [];
  try {
    const cliDir = path.join(paths.messageDirRoot, "project-a", "codex");
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(cliDir, "locked.json"), "{}", "utf8");
    fs.chmodSync(cliDir, 0o555);
    try {
      cleanupWorkspaceMessageFiles("project-a", createStore(), {
        ...paths,
        cliList,
        logError: (event: string) => errors.push(event),
      });
    } finally {
      fs.chmodSync(cliDir, 0o755);
    }
    assert.deepEqual(errors, ["session-message-orphan-delete-error"]);
    assert.equal(fs.existsSync(path.join(cliDir, "locked.json")), true);

    const sanitized = sanitizeMessages([
      {
        id: "invalid-user-content",
        role: "user",
        content: null,
        createdAt: 1,
        sequence: 4,
      } as unknown as ChatMessage,
      {
        id: "codex-thinking",
        role: "assistant",
        kind: "thinking",
        content: "<thinking>reasoning</thinking>",
        createdAt: 2,
        sequence: 8,
      } as ChatMessage,
      {
        id: "empty-trace",
        role: "trace",
        kind: "thinking",
        content: "<thinking>  </thinking>",
        createdAt: 3,
        sequence: 12,
      } as ChatMessage,
      {
        id: "normal-assistant",
        role: "assistant",
        content: "complete",
        createdAt: 4,
        sequence: 16,
      } as ChatMessage,
    ], "codex");
    assert.equal(sanitized.changed, true);
    assert.deepEqual(sanitized.messages.map((message) => ({
      id: message.id,
      content: message.content,
      sequence: message.sequence,
    })), [
      { id: "invalid-user-content", content: null, sequence: 0 },
      { id: "codex-thinking", content: "reasoning", sequence: 1 },
      { id: "normal-assistant", content: "complete", sequence: 2 },
    ]);

    assert.equal(
      sanitizeMessages([{
        id: "opencode-wrapper",
        role: "assistant",
        content: "<thinking>visible answer</thinking>",
        createdAt: 5,
      } as ChatMessage], "opencode").messages[0]?.content,
      "visible answer",
    );
    const alreadySequenced = [{
      id: "stable",
      role: "user",
      content: "unchanged",
      createdAt: 6,
      sequence: 0,
    } as ChatMessage];
    assert.deepEqual(ensureMessageSequence([]), { messages: [], changed: false });
    assert.deepEqual(ensureMessageSequence(alreadySequenced), {
      messages: alreadySequenced,
      changed: false,
    });
  } finally {
    removeTemporaryPaths(paths);
  }
});

test("cleans orphaned files even when a partial retained-store bucket is absent", () => {
  const paths = createTemporaryPaths();
  try {
    const cliDir = path.join(paths.messageDirRoot, "partial-store", "claude");
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(cliDir, "orphan.json"), "{}", "utf8");
    cleanupWorkspaceMessageFiles("partial-store", {} as SessionStore, { ...paths, cliList });
    assert.equal(fs.existsSync(path.join(cliDir, "orphan.json")), false);
  } finally {
    removeTemporaryPaths(paths);
  }
});
