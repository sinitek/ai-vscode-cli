import * as fs from "fs";
import * as path from "path";
import { CliName } from "./cli/types";
import { ChatMessage } from "./webview/types";

export type SessionRecord = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  firstPrompt?: string;
};

export type SessionStore = Record<CliName, { currentId: string | null; sessions: SessionRecord[] }>;

type LogError = (event: string, payload: Record<string, unknown>) => void;

type SessionPathOptions = {
  workspaceKeyFallback: string;
  legacySessionFile: string;
  sessionDir: string;
  logError?: LogError;
};

type MessagePathOptions = {
  workspaceKeyFallback: string;
  legacyMessageDir: string;
  messageDirRoot: string;
};

type MessageIoOptions = MessagePathOptions & {
  activeWorkspaceKey: string;
  buildErrorDetail?: (error: unknown) => string;
  loadErrors?: Map<string, string>;
  logError?: LogError;
};

export function ensureSessionStore(
  store: SessionStore | undefined,
  options: {
    cliList: readonly CliName[];
    unnamedLabel: string;
    isTimestampWithinHistoryRetention: (timestamp: number, now?: number) => boolean;
    buildSessionLabelFromPrompt: (prompt: string | null | undefined) => string | null;
    shouldUseFallbackSessionLabel: (label: string | null | undefined) => boolean;
  }
): SessionStore {
  const now = Date.now();
  const result = {
    codex: { currentId: null, sessions: [] },
    claude: { currentId: null, sessions: [] },
    opencode: { currentId: null, sessions: [] },
  } as SessionStore;

  if (!store) {
    return result;
  }

  for (const cli of options.cliList) {
    const current = store[cli];
    if (!current) {
      continue;
    }
    const sessions = Array.isArray(current.sessions)
      ? current.sessions
        .map((session) => {
          const firstPrompt = typeof session.firstPrompt === "string" && session.firstPrompt.trim()
            ? session.firstPrompt
            : undefined;
          const fallbackLabel = options.buildSessionLabelFromPrompt(firstPrompt);
          const normalizedLabel = typeof session.label === "string" ? session.label.trim() : "";
          const label = options.shouldUseFallbackSessionLabel(normalizedLabel)
            ? (fallbackLabel ?? options.unnamedLabel)
            : normalizedLabel;
          return {
            id: session.id,
            label,
            createdAt: session.createdAt ?? Date.now(),
            lastUsedAt: session.lastUsedAt ?? Date.now(),
            firstPrompt,
          };
        })
        .filter((session) => isSessionRecordWithinRetention(session, options.isTimestampWithinHistoryRetention, now))
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
  return result;
}

function isSessionRecordWithinRetention(
  session: SessionRecord,
  isTimestampWithinHistoryRetention: (timestamp: number, now?: number) => boolean,
  now: number = Date.now()
): boolean {
  const referenceTime = Number.isFinite(session.lastUsedAt) ? session.lastUsedAt : session.createdAt;
  return isTimestampWithinHistoryRetention(referenceTime, now);
}

export function getLatestSessionIdFromRecords(sessions: SessionRecord[]): string | null {
  if (sessions.length === 0) {
    return null;
  }
  const latest = sessions.reduce((prev, current) =>
    current.lastUsedAt > prev.lastUsedAt ? current : prev
  );
  return latest.id;
}

export function isSessionStoreEmpty(store: SessionStore, cliList: readonly CliName[]): boolean {
  return cliList.every((cli) => {
    const bucket = store[cli];
    return !bucket?.currentId && (!bucket?.sessions || bucket.sessions.length === 0);
  });
}

export function collectStaleSessionIds(
  sourceStore: SessionStore | undefined,
  retainedStore: SessionStore,
  cliList: readonly CliName[]
): Record<CliName, string[]> {
  const removed: Record<CliName, string[]> = {
    codex: [],
    claude: [],
    opencode: [],
  };

  if (!sourceStore) {
    return removed;
  }

  for (const cli of cliList) {
    const retainedIds = new Set((retainedStore[cli]?.sessions ?? []).map((session) => session.id));
    const sourceIds = Array.isArray(sourceStore[cli]?.sessions)
      ? sourceStore[cli].sessions.map((session) => session.id)
      : [];
    removed[cli] = sourceIds.filter((sessionId) => !retainedIds.has(sessionId));
  }

  return removed;
}

export function collectWorkspaceKeysForSessionCleanup(options: {
  cliList: readonly CliName[];
  legacySessionFile: string;
  messageDirRoot: string;
  sessionDir: string;
  sessionStoreKey: string;
  workspaceKeyFallback: string;
  globalStateKeys: readonly string[];
}): string[] {
  const workspaceKeys = new Set<string>();
  if (fs.existsSync(options.legacySessionFile)) {
    workspaceKeys.add(options.workspaceKeyFallback);
  }
  if (fs.existsSync(options.sessionDir)) {
    for (const entry of fs.readdirSync(options.sessionDir, { withFileTypes: true })) {
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
  if (fs.existsSync(options.messageDirRoot)) {
    for (const entry of fs.readdirSync(options.messageDirRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (options.cliList.includes(entry.name as CliName)) {
        workspaceKeys.add(options.workspaceKeyFallback);
        continue;
      }
      workspaceKeys.add(entry.name);
    }
  }
  const prefix = `${options.sessionStoreKey}:`;
  for (const key of options.globalStateKeys) {
    if (key.startsWith(prefix)) {
      workspaceKeys.add(key.slice(prefix.length));
    }
  }
  return Array.from(workspaceKeys);
}

export function cleanupWorkspaceMessageFiles(
  workspaceKey: string,
  retainedStore: SessionStore,
  options: MessagePathOptions & { cliList: readonly CliName[]; logError?: LogError }
): void {
  const messageDir = getMessageDir(workspaceKey, options);
  if (!fs.existsSync(messageDir)) {
    return;
  }
  for (const cli of options.cliList) {
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
        options.logError?.("session-message-orphan-delete-error", {
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
  if (workspaceKey !== options.workspaceKeyFallback && fs.existsSync(messageDir) && fs.readdirSync(messageDir).length === 0) {
    fs.rmSync(messageDir, { recursive: true, force: true });
  }
}

export function getSessionFilePath(workspaceKey: string, options: SessionPathOptions): string {
  if (workspaceKey === options.workspaceKeyFallback) {
    return options.legacySessionFile;
  }
  return path.join(options.sessionDir, `${workspaceKey}.json`);
}

export function readSessionFile(workspaceKey: string, options: SessionPathOptions): SessionStore | undefined {
  try {
    const sessionFile = getSessionFilePath(workspaceKey, options);
    if (!fs.existsSync(sessionFile)) {
      return undefined;
    }
    const raw = fs.readFileSync(sessionFile, "utf8");
    return JSON.parse(raw) as SessionStore;
  } catch (error) {
    options.logError?.("session-file-read-error", { error: String(error) });
    return undefined;
  }
}

export function writeSessionFile(store: SessionStore, workspaceKey: string, options: SessionPathOptions): void {
  try {
    const sessionFile = getSessionFilePath(workspaceKey, options);
    const dirPath = path.dirname(sessionFile);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(sessionFile, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    options.logError?.("session-file-write-error", { error: String(error) });
  }
}

export function deleteSessionFile(workspaceKey: string, options: SessionPathOptions): void {
  try {
    const sessionFile = getSessionFilePath(workspaceKey, options);
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  } catch (error) {
    options.logError?.("session-file-delete-error", {
      workspace: workspaceKey,
      error: String(error),
    });
  }
}

export function getMessageDir(workspaceKey: string, options: MessagePathOptions): string {
  if (workspaceKey === options.workspaceKeyFallback) {
    return options.legacyMessageDir;
  }
  return path.join(options.messageDirRoot, workspaceKey);
}

export function cleanupMessageStorage(options: MessagePathOptions & {
  activeWorkspaceKey: string;
  cliList: readonly CliName[];
}): void {
  const messageDir = getMessageDir(options.activeWorkspaceKey, options);
  if (options.activeWorkspaceKey === options.workspaceKeyFallback) {
    for (const cli of options.cliList) {
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

export function getSessionKey(workspaceKey: string, cli: CliName, sessionId: string): string {
  return `${workspaceKey}:${cli}:${sessionId}`;
}

export function getMessageFile(
  cli: CliName,
  sessionId: string,
  workspaceKey: string,
  options: MessagePathOptions
): string {
  return path.join(getMessageDir(workspaceKey, options), cli, `${sessionId}.json`);
}

export function readMessageFile(cli: CliName, sessionId: string, options: MessageIoOptions): ChatMessage[] {
  const key = getSessionKey(options.activeWorkspaceKey, cli, sessionId);
  options.loadErrors?.delete(key);
  try {
    const filePath = getMessageFile(cli, sessionId, options.activeWorkspaceKey, options);
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
      options.loadErrors?.set(key, detail);
      return [];
    }
    return parsed.messages as ChatMessage[];
  } catch (error) {
    const detail = options.buildErrorDetail ? options.buildErrorDetail(error) : String(error);
    options.loadErrors?.set(key, detail);
    options.logError?.("session-messages-read-error", {
      cli,
      sessionId,
      filePath: getMessageFile(cli, sessionId, options.activeWorkspaceKey, options),
      error: detail,
    });
    return [];
  }
}

export function writeMessageFile(
  cli: CliName,
  sessionId: string,
  messages: ChatMessage[],
  options: MessageIoOptions
): void {
  try {
    const cliDir = path.join(getMessageDir(options.activeWorkspaceKey, options), cli);
    if (!fs.existsSync(cliDir)) {
      fs.mkdirSync(cliDir, { recursive: true });
    }
    const filePath = getMessageFile(cli, sessionId, options.activeWorkspaceKey, options);
    fs.writeFileSync(filePath, JSON.stringify({ messages }, null, 2), "utf8");
  } catch (error) {
    options.logError?.("session-messages-write-error", { error: String(error) });
  }
}

export function sanitizeMessages(messages: ChatMessage[]): { messages: ChatMessage[]; changed: boolean } {
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

export function ensureMessageSequence(messages: ChatMessage[]): { messages: ChatMessage[]; changed: boolean } {
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
