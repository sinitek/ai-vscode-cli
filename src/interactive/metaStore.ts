import * as fs from "fs";
import * as path from "path";
import { CliName } from "../cli/types";
import { logError } from "../logger";

export type CodexSessionMeta = {
  threadId: string;
  frozenThreadIds: string[];
  updatedAt: number;
};

export type ClaudeSessionMeta = {
  sessionId: string;
  frozenSessionIds: string[];
  updatedAt: number;
};

export type SessionMetaStore = {
  byCli?: {
    codex?: Record<string, CodexSessionMeta>;
    claude?: Record<string, ClaudeSessionMeta>;
  };
};

export function readSessionMeta(filePath: string): SessionMetaStore {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as SessionMetaStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    void logError("session-meta-read-error", { error: String(error) });
    return {};
  }
}

export function writeSessionMeta(filePath: string, meta: SessionMetaStore): void {
  try {
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), "utf8");
  } catch (error) {
    void logError("session-meta-write-error", { error: String(error) });
  }
}

export function getMappedThreadId(meta: SessionMetaStore, cli: CliName, sessionId: string): string | null {
  if (cli === "codex") {
    return meta.byCli?.codex?.[sessionId]?.threadId ?? null;
  }
  if (cli === "claude") {
    return meta.byCli?.claude?.[sessionId]?.sessionId ?? null;
  }
  return null;
}

export function upsertMapping(
  meta: SessionMetaStore,
  cli: CliName,
  sessionId: string,
  mappedId: string,
  options: { freezePrevious?: string; maxFrozen?: number } = {}
): SessionMetaStore {
  const now = Date.now();
  const maxFrozen = options.maxFrozen ?? 5;
  const next: SessionMetaStore = meta && typeof meta === "object" ? meta : {};
  next.byCli = next.byCli ?? {};

  if (cli === "codex") {
    const existing: CodexSessionMeta = next.byCli.codex?.[sessionId] ?? {
      threadId: mappedId,
      frozenThreadIds: [],
      updatedAt: now,
    };
    const frozen = [...(existing.frozenThreadIds ?? [])];
    if (options.freezePrevious) {
      if (!frozen.includes(options.freezePrevious)) {
        frozen.push(options.freezePrevious);
      }
    }
    const trimmed = frozen.length > maxFrozen ? frozen.slice(frozen.length - maxFrozen) : frozen;
    next.byCli.codex = next.byCli.codex ?? {};
    next.byCli.codex[sessionId] = {
      threadId: mappedId,
      frozenThreadIds: trimmed,
      updatedAt: now,
    };
    return next;
  }

  if (cli === "claude") {
    const existing: ClaudeSessionMeta = next.byCli.claude?.[sessionId] ?? {
      sessionId: mappedId,
      frozenSessionIds: [],
      updatedAt: now,
    };
    const frozen = [...(existing.frozenSessionIds ?? [])];
    if (options.freezePrevious) {
      if (!frozen.includes(options.freezePrevious)) {
        frozen.push(options.freezePrevious);
      }
    }
    const trimmed = frozen.length > maxFrozen ? frozen.slice(frozen.length - maxFrozen) : frozen;
    next.byCli.claude = next.byCli.claude ?? {};
    next.byCli.claude[sessionId] = {
      sessionId: mappedId,
      frozenSessionIds: trimmed,
      updatedAt: now,
    };
    return next;
  }

  return next;
}

