import type { CliName } from "./cli/types";
import { buildErrorDetail } from "./errorDisplay";
import { collapseGrokConsecutiveThinkingMessages } from "./interactive/grokThinkingBubbles";
import { getSessionKey, readMessageFile, sanitizeMessages, writeMessageFile } from "./sessionStore";
import type { ChatMessage } from "./webview/types";

export type SessionMessageRepository = ReturnType<typeof createSessionMessageRepository>;

/** One lifecycle's message state; workspace identity is always resolved at operation time. */
export function createSessionMessageRepository(deps: {
  activeWorkspaceKey: () => string;
  workspaceKeyFallback: string;
  legacyMessageDir: string;
  messageDirRoot: string;
  sessionMessageCache: Map<string, ChatMessage[]>;
  sessionMessageLoadErrors: Map<string, string>;
  recoverClaudeMessagesFromTranscript: (sessionId: string, messages: ChatMessage[]) => ChatMessage[] | null;
  updateSessionHealth: (cli: CliName, sessionId: string, messages: ChatMessage[]) => void;
  logInfo: (event: string, payload?: unknown) => void;
  logError: (event: string, payload?: unknown) => void;
}) {
  const retentionPrunedSessions = new Set<string>();
  const retentionPrunedArrays = new WeakSet<ChatMessage[]>();
  const messagePathOptions = () => ({
    workspaceKeyFallback: deps.workspaceKeyFallback,
    legacyMessageDir: deps.legacyMessageDir,
    messageDirRoot: deps.messageDirRoot,
  });

  const loadMessages = (cli: CliName, sessionId: string): ChatMessage[] => {
    const key = getSessionKey(deps.activeWorkspaceKey(), cli, sessionId);
    const cached = deps.sessionMessageCache.get(key);
    if (cached) {
      deps.updateSessionHealth(cli, sessionId, cached);
      return cached;
    }
    const messages = readMessageFile(cli, sessionId, {
      activeWorkspaceKey: deps.activeWorkspaceKey(),
      ...messagePathOptions(),
      buildErrorDetail,
      loadErrors: deps.sessionMessageLoadErrors,
      logError: (event, payload) => deps.logError(event, payload),
      onRetentionPruned: () => retentionPrunedSessions.add(key),
    });
    const sanitized = sanitizeMessages(messages, cli);
    const recovered = retentionPrunedSessions.has(key)
      ? null
      : maybeRecoverClaudeSessionMessages(cli, sessionId, sanitized.messages);
    const resolvedMessages = recovered ?? sanitized.messages;
    const collapsed = cli === "grok"
      ? collapseGrokConsecutiveThinkingMessages(resolvedMessages)
      : { messages: resolvedMessages, changed: false };
    const storedMessages = collapsed.messages;
    if (recovered || sanitized.changed || collapsed.changed) {
      writeMessageFile(cli, sessionId, storedMessages, {
        activeWorkspaceKey: deps.activeWorkspaceKey(),
        ...messagePathOptions(),
        logError: (event, payload) => deps.logError(event, payload),
        retentionPruned: retentionPrunedSessions.has(key),
      });
    }
    if (retentionPrunedSessions.has(key)) {
      retentionPrunedArrays.add(storedMessages);
    }
    deps.sessionMessageCache.set(key, storedMessages);
    deps.updateSessionHealth(cli, sessionId, storedMessages);
    return storedMessages;
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
    if (retentionPrunedArrays.has(messages)) {
      retentionPrunedSessions.add(key);
    }
    const sanitized = sanitizeMessages(messages, cli);
    if (retentionPrunedSessions.has(key)) {
      retentionPrunedArrays.add(sanitized.messages);
    }
    deps.updateSessionHealth(cli, sessionId, sanitized.messages);
    deps.sessionMessageCache.set(key, sanitized.messages);
    writeMessageFile(cli, sessionId, sanitized.messages, {
      activeWorkspaceKey: deps.activeWorkspaceKey(),
      ...messagePathOptions(),
      logError: (event, payload) => deps.logError(event, payload),
      retentionPruned: retentionPrunedSessions.has(key),
    });
  };

  return {
    loadMessages,
    saveMessages,
    // Call only after lifecycle has authorized deletion; failure leaves all memory untouched.
    persistPrunedMessages: (cli: CliName, sessionId: string, messages: ChatMessage[]): boolean => writeMessageFile(cli, sessionId, messages, {
      activeWorkspaceKey: deps.activeWorkspaceKey(),
      ...messagePathOptions(),
      retentionPruned: true,
      logError: (event, payload) => deps.logError(event, payload),
    }),
    markPrunedArray: (messages: ChatMessage[]): void => {
      retentionPrunedArrays.add(messages);
    },
    inheritPruning: (messages: ChatMessage[], ...sources: ChatMessage[][]): void => {
      if (sources.some((source) => retentionPrunedArrays.has(source))) {
        retentionPrunedArrays.add(messages);
      }
    },
    rememberPrunedSession: (cli: CliName, sessionId: string, messages: ChatMessage[]): void => {
      const key = getSessionKey(deps.activeWorkspaceKey(), cli, sessionId);
      retentionPrunedSessions.add(key);
      deps.sessionMessageCache.set(key, messages);
    },
    getLoadError: (cli: CliName, sessionId: string): string | undefined => {
      return deps.sessionMessageLoadErrors.get(getSessionKey(deps.activeWorkspaceKey(), cli, sessionId));
    },
    evictSession: (cli: CliName, sessionId: string, options: { workspaceKey?: string; clearLoadError?: boolean } = {}): void => {
      const key = getSessionKey(options.workspaceKey ?? deps.activeWorkspaceKey(), cli, sessionId);
      deps.sessionMessageCache.delete(key);
      retentionPrunedSessions.delete(key);
      if (options.clearLoadError) {
        deps.sessionMessageLoadErrors.delete(key);
      }
    },
    // Preserve the original clear-all scope: array provenance and load errors survive.
    clearCachedSessions: (): void => {
      deps.sessionMessageCache.clear();
      retentionPrunedSessions.clear();
    },
  };
}
