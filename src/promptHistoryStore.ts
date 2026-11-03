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

export function buildPromptHistoryState(
  store: PromptHistoryStore | undefined,
  options?: PromptHistoryStoreOptions
): PromptHistoryItem[] {
  const items = store?.items ? [...store.items] : [];
  if (!options) {
    return items;
  }
  const sharedItems = readGlobalPromptHistoryStore(options).items;
  const sharedPrompts = new Set(sharedItems.map((item) => item.prompt));
  return [...items.filter((item) => !sharedPrompts.has(item.prompt)), ...sharedItems]
    .sort((first, second) => second.createdAt - first.createdAt);
}

export function getGlobalPromptHistoryFilePath(
  options: Pick<PromptHistoryStoreOptions, "legacyPromptHistoryFile">
): string {
  return path.join(path.dirname(options.legacyPromptHistoryFile), "prompt-history-global.json");
}

function readGlobalPromptHistoryStore(options: PromptHistoryStoreOptions): PromptHistoryStore {
  const stored = readPromptHistoryStoreFile(getGlobalPromptHistoryFilePath(options), options);
  const normalized = ensurePromptHistoryStore(stored, options);
  return {
    items: normalized.items
      .filter((item) => item.favorite === true)
      .map((item) => ({ ...item, global: true })),
  };
}

function writeGlobalPromptHistoryStore(store: PromptHistoryStore, options: PromptHistoryStoreOptions): void {
  writePromptHistoryStoreFile(store, getGlobalPromptHistoryFilePath(options), options);
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
  const globalStore = readGlobalPromptHistoryStore(options);
  const sharedItem = globalStore.items.find((item) => item.prompt === normalized);
  const matchingItems = nextStore.items.filter((item) => item.prompt === normalized);
  nextStore.items = nextStore.items.filter((item) => item.prompt !== normalized);
  const nextItem: PromptHistoryItem = {
    id: sharedItem?.id ?? matchingItems[0]?.id ?? createPromptHistoryId(),
    prompt: normalized,
    createdAt: Date.now(),
    cli,
    favorite: Boolean(sharedItem) || matchingItems.some((item) => item.favorite === true),
  };
  nextStore.items.unshift(nextItem);
  if (sharedItem) {
    globalStore.items = globalStore.items.filter((item) => item.prompt !== normalized);
    globalStore.items.unshift({ ...nextItem, global: true });
    writeGlobalPromptHistoryStore(globalStore, options);
  }
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
  const globalStore = readGlobalPromptHistoryStore(options);
  const localItem = nextStore.items.find((entry) => entry.id === normalizedId);
  const sharedItem = globalStore.items.find((entry) => entry.id === normalizedId || entry.prompt === localItem?.prompt);
  const item = sharedItem ?? localItem;
  if (!item) {
    return nextStore;
  }
  const nextFavorite = typeof favorite === "boolean" ? favorite : !Boolean(item.favorite);
  if (Boolean(item.favorite) === nextFavorite) {
    return nextStore;
  }
  nextStore.items = nextStore.items.filter((entry) => entry.prompt !== item.prompt);
  nextStore.items.push({
    id: item.id,
    prompt: item.prompt,
    createdAt: item.createdAt,
    cli: item.cli,
    favorite: nextFavorite,
  });
  if (sharedItem && !nextFavorite) {
    globalStore.items = globalStore.items.filter((entry) => entry.prompt !== item.prompt);
    writeGlobalPromptHistoryStore(globalStore, options);
  }
  nextStore.items = ensurePromptHistoryStore(nextStore, options).items;
  writePromptHistoryFile(nextStore, options);
  options.logInfo?.("prompt-history-favorite-updated", {
    workspace: options.workspaceKey,
    id: normalizedId,
    favorite: nextFavorite,
  });
  return nextStore;
}

export function setPromptHistoryGlobalInStore(
  store: PromptHistoryStore | undefined,
  id: string,
  global: boolean | undefined,
  options: PromptHistoryStoreOptions
): PromptHistoryStore {
  const nextStore = store
    ? ensurePromptHistoryStore(store, options)
    : loadPromptHistoryStore(options);
  const normalizedId = String(id ?? "").trim();
  if (!normalizedId) {
    return nextStore;
  }
  const globalStore = readGlobalPromptHistoryStore(options);
  const localItem = nextStore.items.find((entry) => entry.id === normalizedId);
  const sharedItem = globalStore.items.find((entry) => entry.id === normalizedId || entry.prompt === localItem?.prompt);
  const item = sharedItem ?? localItem;
  if (!item || item.favorite !== true) {
    return nextStore;
  }
  const nextGlobal = typeof global === "boolean" ? global : !sharedItem;
  if (nextGlobal === Boolean(sharedItem)) {
    return nextStore;
  }
  globalStore.items = globalStore.items.filter((entry) => entry.prompt !== item.prompt);
  if (nextGlobal) {
    globalStore.items.unshift({ ...item, global: true });
  }
  writeGlobalPromptHistoryStore(globalStore, options);
  nextStore.items = nextStore.items.filter((entry) => entry.prompt !== item.prompt);
  nextStore.items.push({
    id: item.id,
    prompt: item.prompt,
    createdAt: item.createdAt,
    cli: item.cli,
    favorite: true,
  });
  nextStore.items.sort((first, second) => second.createdAt - first.createdAt);
  writePromptHistoryFile(nextStore, options);
  options.logInfo?.("prompt-history-global-updated", {
    workspace: options.workspaceKey,
    id: normalizedId,
    global: nextGlobal,
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
  return readPromptHistoryStoreFile(getPromptHistoryFilePath(options, workspaceKey), options);
}

function readPromptHistoryStoreFile(
  filePath: string,
  options: Pick<PromptHistoryStoreOptions, "logError">
): PromptHistoryStore | undefined {
  try {
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
  writePromptHistoryStoreFile(store, getPromptHistoryFilePath(options, workspaceKey), options);
}

function writePromptHistoryStoreFile(
  store: PromptHistoryStore,
  filePath: string,
  options: Pick<PromptHistoryStoreOptions, "logError">
): void {
  try {
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
