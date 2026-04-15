import { ChatMessage } from "../webview/types";

export type SessionHistoryRecord = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  firstPrompt?: string;
};

const DEFAULT_LOCAL_PREFIX = "local_";
const DEFAULT_PROMOTION_WINDOW_MS = 10_000;

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function getFirstUserPrompt(messages: ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user" && String(message.content || "").trim());
  return first ? normalizeText(first.content) : "";
}

function buildMessageStableKey(message: ChatMessage, index: number): string {
  const id = typeof message.id === "string" ? message.id.trim() : "";
  if (id) {
    return `id:${id}`;
  }
  return [
    "fallback",
    message.role,
    String(message.createdAt ?? ""),
    String(message.sequence ?? ""),
    String(message.kind ?? ""),
    String(message.content ?? ""),
    String(index),
  ].join(":");
}

function getMessageCreatedAtRank(message: ChatMessage, index: number): number {
  return typeof message.createdAt === "number" && Number.isFinite(message.createdAt)
    ? message.createdAt
    : Number.MAX_SAFE_INTEGER - 10_000 + index;
}

function getMessageSequenceRank(message: ChatMessage, index: number): number {
  return typeof message.sequence === "number" && Number.isFinite(message.sequence)
    ? message.sequence
    : index;
}

export function isLocalSessionId(sessionId: string, prefix: string = DEFAULT_LOCAL_PREFIX): boolean {
  return normalizeText(sessionId).startsWith(prefix);
}

export function mergeSessionMessages(primary: ChatMessage[], secondary: ChatMessage[]): ChatMessage[] {
  const merged: Array<{ message: ChatMessage; createdAtRank: number; sequenceRank: number; order: number }> = [];
  const seen = new Set<string>();

  const pushMessages = (messages: ChatMessage[]): void => {
    messages.forEach((message, index) => {
      const key = buildMessageStableKey(message, index);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push({
        message: { ...message },
        createdAtRank: getMessageCreatedAtRank(message, index),
        sequenceRank: getMessageSequenceRank(message, index),
        order: merged.length,
      });
    });
  };

  pushMessages(primary);
  pushMessages(secondary);

  merged.sort((left, right) => {
    if (left.createdAtRank !== right.createdAtRank) {
      return left.createdAtRank - right.createdAtRank;
    }
    if (left.sequenceRank !== right.sequenceRank) {
      return left.sequenceRank - right.sequenceRank;
    }
    return left.order - right.order;
  });

  return merged.map((entry, index) => ({
    ...entry.message,
    sequence: index,
  }));
}

export function mergeSessionRecords(primary: SessionHistoryRecord, secondary: SessionHistoryRecord): SessionHistoryRecord {
  const nextFirstPrompt = normalizeText(primary.firstPrompt) || normalizeText(secondary.firstPrompt);
  return {
    ...primary,
    label: normalizeText(primary.label) || normalizeText(secondary.label),
    createdAt: Math.min(primary.createdAt, secondary.createdAt),
    lastUsedAt: Math.max(primary.lastUsedAt, secondary.lastUsedAt),
    ...(nextFirstPrompt ? { firstPrompt: nextFirstPrompt } : {}),
  };
}

export function findSupersedingSessionId(
  localRecord: SessionHistoryRecord,
  candidates: SessionHistoryRecord[],
  options: {
    getMessages: (sessionId: string) => ChatMessage[];
    localPrefix?: string;
    maxCreatedAtDiffMs?: number;
  }
): string | null {
  const localPrefix = options.localPrefix ?? DEFAULT_LOCAL_PREFIX;
  const maxCreatedAtDiffMs = options.maxCreatedAtDiffMs ?? DEFAULT_PROMOTION_WINDOW_MS;
  if (!isLocalSessionId(localRecord.id, localPrefix)) {
    return null;
  }

  const localMessages = options.getMessages(localRecord.id);
  const localPrompt = normalizeText(localRecord.firstPrompt) || getFirstUserPrompt(localMessages);
  const localLabel = normalizeText(localRecord.label);
  const localMessageIds = new Set(
    localMessages
      .map((message) => (typeof message.id === "string" ? message.id.trim() : ""))
      .filter(Boolean)
  );

  let bestId: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  candidates.forEach((candidate) => {
    if (candidate.id === localRecord.id || isLocalSessionId(candidate.id, localPrefix)) {
      return;
    }

    const candidateMessages = options.getMessages(candidate.id);
    const candidatePrompt = normalizeText(candidate.firstPrompt) || getFirstUserPrompt(candidateMessages);
    const overlapCount = candidateMessages.reduce((count, message) => {
      const id = typeof message.id === "string" ? message.id.trim() : "";
      return id && localMessageIds.has(id) ? count + 1 : count;
    }, 0);
    const createdAtDiff = Math.abs((candidate.createdAt ?? 0) - (localRecord.createdAt ?? 0));
    const samePrompt = Boolean(localPrompt && candidatePrompt && localPrompt === candidatePrompt);
    const sameLabel = Boolean(localLabel && normalizeText(candidate.label) === localLabel);
    const withinWindow = createdAtDiff <= maxCreatedAtDiffMs;

    if (!(overlapCount > 0 || (samePrompt && withinWindow))) {
      return;
    }

    const assistantCount = candidateMessages.reduce(
      (count, message) => (message.role === "assistant" ? count + 1 : count),
      0
    );
    const proximityScore = withinWindow ? (maxCreatedAtDiffMs - createdAtDiff) / maxCreatedAtDiffMs : 0;
    const score = (
      overlapCount * 1_000
      + (samePrompt ? 100 : 0)
      + (sameLabel ? 10 : 0)
      + Math.min(assistantCount, 20)
      + proximityScore
    );

    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.id;
    }
  });

  return bestId;
}
