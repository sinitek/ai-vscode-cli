import * as fs from "fs";
import * as path from "path";
import type { CliName } from "./cli/types";
import type { PromptHistoryItem } from "./webview/types";

export type PromptHistoryStore = {
  items: PromptHistoryItem[];
};

export type PromptHistoryStoreLogger = (event: string, payload?: unknown) => void;

export type PromptHistoryStoreOptions = {
  promptHistoryDir: string;
  legacyPromptHistoryFile: string;
  workspaceKey: string;
  workspaceKeyFallback: string;
  promptHistoryLimit: number;
  currentCli: CliName;
  isCliName: (value: string) => value is CliName;
  isTimestampWithinHistoryRetention: (timestamp: number, now?: number) => boolean;
  logInfo?: PromptHistoryStoreLogger;
  logError?: PromptHistoryStoreLogger;
};

export function loadPromptHistoryStore(options: PromptHistoryStoreOptions): PromptHistoryStore {
  const stored = readPromptHistoryFile(options);
  const normalized = ensurePromptHistoryStore(stored, options);
  writePromptHistoryFile(normalized, options);
  return normalized;
}

export function ensurePromptHistoryStore(
  store: PromptHistoryStore | undefined,
  options: Pick<
    PromptHistoryStoreOptions,
    "promptHistoryLimit" | "currentCli" | "isCliName" | "isTimestampWithinHistoryRetention"
  >
): PromptHistoryStore {
  const now = Date.now();
  const items = Array.isArray(store?.items) ? store?.items : [];
  const normalized = items
    .map((item) => normalizePromptHistoryItem(item, options))
    .filter((item): item is PromptHistoryItem => Boolean(item))
    .filter((item) => shouldRetainPromptHistoryItem(item, options, now));
  normalized.sort((a, b) => b.createdAt - a.createdAt);
  return { items: limitPromptHistoryItems(normalized, options.promptHistoryLimit) };
}

export function normalizePromptHistoryItem(
  item: unknown,
  options: Pick<PromptHistoryStoreOptions, "currentCli" | "isCliName">
): PromptHistoryItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const record = item as PromptHistoryItem;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt) {
    return null;
  }
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
  const cli = options.isCliName(record.cli) ? record.cli : options.currentCli;
  const id = typeof record.id === "string" && record.id.trim()
    ? record.id
    : createPromptHistoryId(createdAt);
  return {
    id,
    prompt,
    createdAt,
    cli,
    favorite: record.favorite === true,
  };
}

export function createPromptHistoryId(timestamp?: number): string {
  const base = typeof timestamp === "number" ? timestamp : Date.now();
  return `prompt_${base}_${Math.random().toString(16).slice(2)}`;
}

export function buildPromptHistoryState(store: PromptHistoryStore | undefined): PromptHistoryItem[] {
  return store?.items ? [...store.items] : [];
}

function shouldRetainPromptHistoryItem(
  item: PromptHistoryItem,
  options: Pick<PromptHistoryStoreOptions, "isTimestampWithinHistoryRetention">,
  now: number
): boolean {
  return item.favorite === true || options.isTimestampWithinHistoryRetention(item.createdAt, now);
}

function limitPromptHistoryItems(items: PromptHistoryItem[], promptHistoryLimit: number): PromptHistoryItem[] {
  const nonFavoriteLimit = Math.max(0, promptHistoryLimit);
  const keptNonFavorites = new Set(
    items
      .filter((item) => item.favorite !== true)
      .slice(0, nonFavoriteLimit)
  );
  return items.filter((item) => item.favorite === true || keptNonFavorites.has(item));
}

export function recordPromptHistoryInStore(
  store: PromptHistoryStore | undefined,
  prompt: string,
  cli: CliName,
  options: PromptHistoryStoreOptions
): PromptHistoryStore {
  const normalized = String(prompt ?? "").trim();
  if (!normalized) {
    return store ?? loadPromptHistoryStore(options);
  }
  const nextStore = store
    ? ensurePromptHistoryStore(store, options)
    : loadPromptHistoryStore(options);
  nextStore.items.unshift({
    id: createPromptHistoryId(),
    prompt: normalized,
    createdAt: Date.now(),
    cli,
    favorite: false,
  });
  nextStore.items = limitPromptHistoryItems(nextStore.items, options.promptHistoryLimit);
  writePromptHistoryFile(nextStore, options);
  return nextStore;
}

export function setPromptHistoryFavoriteInStore(
  store: PromptHistoryStore | undefined,
  id: string,
  favorite: boolean | undefined,
  options: PromptHistoryStoreOptions
): PromptHistoryStore {
  const normalizedId = String(id ?? "").trim();
  const nextStore = store
    ? ensurePromptHistoryStore(store, options)
    : loadPromptHistoryStore(options);
  if (!normalizedId) {
    return nextStore;
  }
  const item = nextStore.items.find((entry) => entry.id === normalizedId);
  if (!item) {
    return nextStore;
  }
  const nextFavorite = typeof favorite === "boolean" ? favorite : !Boolean(item.favorite);
  if (Boolean(item.favorite) === nextFavorite) {
    return nextStore;
  }
  item.favorite = nextFavorite;
  writePromptHistoryFile(nextStore, options);
  options.logInfo?.("prompt-history-favorite-updated", {
    workspace: options.workspaceKey,
    id: normalizedId,
    favorite: nextFavorite,
  });
  return nextStore;
}

export function clearPromptHistoryStore(
  store: PromptHistoryStore | undefined,
  options: PromptHistoryStoreOptions
): PromptHistoryStore {
  const currentStore = store
    ? ensurePromptHistoryStore(store, options)
    : loadPromptHistoryStore(options);
  const nextStore: PromptHistoryStore = {
    items: currentStore.items.filter((item) => item.favorite === true),
  };
  writePromptHistoryFile(nextStore, options);
  options.logInfo?.("prompt-history-cleared", {
    workspace: options.workspaceKey,
    preservedFavoriteCount: nextStore.items.length,
  });
  return nextStore;
}

export function getPromptHistoryFilePath(
  options: Pick<PromptHistoryStoreOptions, "promptHistoryDir" | "legacyPromptHistoryFile" | "workspaceKeyFallback">,
  workspaceKey: string
): string {
  if (workspaceKey === options.workspaceKeyFallback) {
    return options.legacyPromptHistoryFile;
  }
  return path.join(options.promptHistoryDir, `${workspaceKey}.json`);
}

export function readPromptHistoryFile(
  options: PromptHistoryStoreOptions,
  workspaceKey: string = options.workspaceKey
): PromptHistoryStore | undefined {
  try {
    const filePath = getPromptHistoryFilePath(options, workspaceKey);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as PromptHistoryStore;
  } catch (error) {
    options.logError?.("prompt-history-read-error", { error: String(error) });
    return undefined;
  }
}

export function writePromptHistoryFile(
  store: PromptHistoryStore,
  options: PromptHistoryStoreOptions,
  workspaceKey: string = options.workspaceKey
): void {
  try {
    const filePath = getPromptHistoryFilePath(options, workspaceKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    options.logError?.("prompt-history-write-error", { error: String(error) });
  }
}

export function deletePromptHistoryFile(options: PromptHistoryStoreOptions, workspaceKey: string): void {
  try {
    const filePath = getPromptHistoryFilePath(options, workspaceKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    options.logError?.("prompt-history-delete-error", {
      workspace: workspaceKey,
      error: String(error),
    });
  }
}

export function cleanupPromptHistoryRetentionAcrossWorkspaces(options: PromptHistoryStoreOptions): void {
  const workspaceKeys = collectWorkspaceKeysForPromptHistoryCleanup(options);
  workspaceKeys.forEach((workspaceKey) => {
    const normalized = ensurePromptHistoryStore(readPromptHistoryFile(options, workspaceKey), options);
    if (normalized.items.length > 0) {
      writePromptHistoryFile(normalized, options, workspaceKey);
      return;
    }
    deletePromptHistoryFile(options, workspaceKey);
  });
}

export function collectWorkspaceKeysForPromptHistoryCleanup(
  options: Pick<PromptHistoryStoreOptions, "legacyPromptHistoryFile" | "promptHistoryDir" | "workspaceKeyFallback">
): string[] {
  const workspaceKeys = new Set<string>();
  if (fs.existsSync(options.legacyPromptHistoryFile)) {
    workspaceKeys.add(options.workspaceKeyFallback);
  }
  if (fs.existsSync(options.promptHistoryDir)) {
    for (const entry of fs.readdirSync(options.promptHistoryDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      workspaceKeys.add(entry.name.slice(0, -".json".length));
    }
  }
  return Array.from(workspaceKeys);
}
