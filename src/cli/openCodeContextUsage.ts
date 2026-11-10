import { isPlainObject } from "../shared/jsonObject";
import { parseOpenCodeModelReference } from "./opencodeconfigmodels";

export type OpenCodeContextUsage = {
  sessionId: string;
  tokensInContextWindow: number;
};

function readTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readPartSession(record: Record<string, unknown>): string | null {
  if (!isPlainObject(record.part) || typeof record.sessionID !== "string" || !record.sessionID.trim()) {
    return null;
  }
  return record.part.sessionID === record.sessionID ? record.sessionID : null;
}

export function parseOpenCodeContextUsage(record: unknown): OpenCodeContextUsage | null {
  if (!isPlainObject(record) || record.type !== "step_finish" || !isPlainObject(record.part)) {
    return null;
  }
  const sessionId = readPartSession(record);
  const part = record.part;
  if (!sessionId || part.type !== "step-finish" || !isPlainObject(part.tokens)) {
    return null;
  }
  const tokens = part.tokens;
  if (!isPlainObject(tokens.cache)) {
    return null;
  }
  const counts = [tokens.input, tokens.output, tokens.reasoning, tokens.cache.read, tokens.cache.write]
    .map(readTokenCount);
  if (counts.some((count) => count === null)) {
    return null;
  }
  const tokensInContextWindow = counts.reduce<number>((total, count) => total + count!, 0);
  return Number.isSafeInteger(tokensInContextWindow) ? { sessionId, tokensInContextWindow } : null;
}

export function createOpenCodeContextUsageTracker(options: {
  sessionId: string | null;
  previousSessionId?: string | null;
  model: string;
}): {
  accept: (record: unknown) => OpenCodeContextUsage | null;
} {
  let sessionId = options.sessionId;
  const model = parseOpenCodeModelReference(options.model);
  return {
    accept(record) {
      if (!isPlainObject(record) || !isPlainObject(record.part)) {
        return null;
      }
      const incomingSessionId = readPartSession(record);
      if (!incomingSessionId || (model && (
        (record.providerID !== undefined && record.providerID !== model.providerId)
        || (record.modelID !== undefined && record.modelID !== model.modelId)
      ))) {
        return null;
      }
      if (!sessionId && record.type === "step_start" && record.part.type === "step-start"
        && incomingSessionId !== options.previousSessionId) {
        sessionId = incomingSessionId;
      }
      return incomingSessionId === sessionId ? parseOpenCodeContextUsage(record) : null;
    },
  };
}
