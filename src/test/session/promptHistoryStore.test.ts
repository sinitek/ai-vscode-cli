import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CliName } from "../../cli/types";
import {
  cleanupPromptHistoryRetentionAcrossWorkspaces,
  clearPromptHistoryStore,
  ensurePromptHistoryStore,
  loadPromptHistoryStore,
  recordPromptHistoryInStore,
  setPromptHistoryFavoriteInStore,
  type PromptHistoryStore,
  type PromptHistoryStoreOptions,
} from "../../promptHistoryStore";

function createOptions(
  rootDir: string,
  overrides: Partial<Pick<
    PromptHistoryStoreOptions,
    "isTimestampWithinHistoryRetention" | "promptHistoryLimit"
  >> = {}
): PromptHistoryStoreOptions {
  return {
    promptHistoryDir: path.join(rootDir, "prompt-history"),
    legacyPromptHistoryFile: path.join(rootDir, "prompt-history.json"),
    workspaceKey: "workspace",
    workspaceKeyFallback: "no-workspace",
    promptHistoryLimit: overrides.promptHistoryLimit ?? 20,
    currentCli: "codex",
    isCliName: (value): value is CliName => (
      value === "codex" || value === "claude" || value === "opencode"
    ),
    isTimestampWithinHistoryRetention: overrides.isTimestampWithinHistoryRetention ?? (() => true),
  };
}

test("normalizes legacy prompt history items with favorite defaulting to false", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir);
  try {
    const normalized = ensurePromptHistoryStore({
      items: [
        { id: "old", prompt: "  legacy prompt  ", createdAt: 1, cli: "codex" },
        { id: "fav", prompt: "favorite prompt", createdAt: 2, cli: "claude", favorite: true },
      ],
    } as PromptHistoryStore, options);

    assert.deepEqual(
      normalized.items.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        cli: item.cli,
        favorite: item.favorite,
      })),
      [
        { id: "fav", prompt: "favorite prompt", cli: "claude", favorite: true },
        { id: "old", prompt: "legacy prompt", cli: "codex", favorite: false },
      ],
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("records prompts as non-favorites and persists favorite toggles", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir);
  try {
    let store = recordPromptHistoryInStore(undefined, "ship it", "opencode", options);
    assert.equal(store.items.length, 1);
    assert.equal(store.items[0].prompt, "ship it");
    assert.equal(store.items[0].favorite, false);

    const id = store.items[0].id;
    store = setPromptHistoryFavoriteInStore(store, id, true, options);
    assert.equal(store.items[0].favorite, true);

    const filePath = path.join(options.promptHistoryDir, "workspace.json");
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as PromptHistoryStore;
    assert.equal(persisted.items[0].favorite, true);

    store = setPromptHistoryFavoriteInStore(store, id, undefined, options);
    assert.equal(store.items[0].favorite, false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("refreshes duplicate prompts in place and moves them first without evicting other history", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir, { promptHistoryLimit: 2 });
  context.mock.method(Date, "now", () => 100);
  try {
    const store = recordPromptHistoryInStore({
      items: [
        { id: "newer", prompt: "another prompt", createdAt: 20, cli: "codex", favorite: false },
        { id: "reused", prompt: "ship it", createdAt: 10, cli: "codex", favorite: false },
      ],
    }, " \nship it\t ", "claude", options);

    assert.deepEqual(store.items, [
      { id: "reused", prompt: "ship it", createdAt: 100, cli: "claude", favorite: false },
      { id: "newer", prompt: "another prompt", createdAt: 20, cli: "codex", favorite: false },
    ]);
    const filePath = path.join(options.promptHistoryDir, "workspace.json");
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as PromptHistoryStore;
    assert.deepEqual(persisted, store);
    assert.deepEqual(loadPromptHistoryStore(options), store);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("merges existing copies of a reused prompt without losing its favorite state", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir);
  context.mock.method(Date, "now", () => 100);
  try {
    let store = recordPromptHistoryInStore({
      items: [
        { id: "other", prompt: "another prompt", createdAt: 30, cli: "codex", favorite: false },
        { id: "latest-copy", prompt: "ship it", createdAt: 20, cli: "claude", favorite: false },
        { id: "favorite-copy", prompt: " ship it ", createdAt: 10, cli: "codex", favorite: true },
      ],
    }, "ship it", "opencode", options);

    assert.deepEqual(store.items, [
      { id: "latest-copy", prompt: "ship it", createdAt: 100, cli: "opencode", favorite: true },
      { id: "other", prompt: "another prompt", createdAt: 30, cli: "codex", favorite: false },
    ]);
    store = recordPromptHistoryInStore(store, "ship it", "opencode", options);
    assert.equal(store.items.length, 2);
    assert.equal(store.items[0].id, "latest-copy");
    assert.equal(store.items[0].favorite, true);
    assert.deepEqual(loadPromptHistoryStore(options), store);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("deduplicates prompts loaded from disk before recording them", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir);
  context.mock.method(Date, "now", () => 100);
  try {
    fs.mkdirSync(options.promptHistoryDir, { recursive: true });
    fs.writeFileSync(path.join(options.promptHistoryDir, "workspace.json"), JSON.stringify({
      items: [{ id: "saved", prompt: "ship it", createdAt: 10, cli: "codex", favorite: true }],
    }), "utf8");

    const store = recordPromptHistoryInStore(undefined, "ship it", "claude", options);

    assert.deepEqual(store.items, [
      { id: "saved", prompt: "ship it", createdAt: 100, cli: "claude", favorite: true },
    ]);
    assert.deepEqual(loadPromptHistoryStore(options), store);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("keeps prompts with different casing or internal whitespace as separate records", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir);
  try {
    let store = recordPromptHistoryInStore(undefined, "ship it", "codex", options);
    store = recordPromptHistoryInStore(store, "Ship it", "codex", options);
    store = recordPromptHistoryInStore(store, "ship\nit", "codex", options);

    assert.deepEqual(store.items.map((item) => item.prompt), ["ship\nit", "Ship it", "ship it"]);
    assert.equal(new Set(store.items.map((item) => item.id)).size, 3);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("ignores whitespace-only prompts without refreshing existing history", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir);
  try {
    const store = recordPromptHistoryInStore(undefined, "ship it", "codex", options);
    const filePath = path.join(options.promptHistoryDir, "workspace.json");
    const persisted = fs.readFileSync(filePath, "utf8");

    assert.equal(recordPromptHistoryInStore(store, " \n\t ", "claude", options), store);
    assert.equal(fs.readFileSync(filePath, "utf8"), persisted);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("retention cleanup preserves favorite prompts while pruning expired non-favorites", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir, {
    isTimestampWithinHistoryRetention: (timestamp) => timestamp >= 100,
  });
  const filePath = path.join(options.promptHistoryDir, "workspace.json");
  try {
    fs.mkdirSync(options.promptHistoryDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      items: [
        { id: "old-favorite", prompt: "keep me", createdAt: 1, cli: "codex", favorite: true },
        { id: "old-plain", prompt: "remove me", createdAt: 2, cli: "codex", favorite: false },
        { id: "fresh-plain", prompt: "fresh", createdAt: 101, cli: "codex", favorite: false },
      ],
    }), "utf8");

    cleanupPromptHistoryRetentionAcrossWorkspaces(options);

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as PromptHistoryStore;
    assert.deepEqual(persisted.items.map((item) => item.id), ["fresh-plain", "old-favorite"]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("prompt history limit applies only to non-favorites", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir, { promptHistoryLimit: 1 });
  try {
    const normalized = ensurePromptHistoryStore({
      items: [
        { id: "new-plain", prompt: "new", createdAt: 3, cli: "codex", favorite: false },
        { id: "old-favorite", prompt: "favorite", createdAt: 2, cli: "codex", favorite: true },
        { id: "old-plain", prompt: "old", createdAt: 1, cli: "codex", favorite: false },
      ],
    } as PromptHistoryStore, options);

    assert.deepEqual(normalized.items.map((item) => item.id), ["new-plain", "old-favorite"]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("manual prompt history clearing preserves favorites", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  const options = createOptions(rootDir);
  try {
    const cleared = clearPromptHistoryStore({
      items: [
        { id: "favorite", prompt: "keep", createdAt: 2, cli: "codex", favorite: true },
        { id: "plain", prompt: "clear", createdAt: 1, cli: "codex", favorite: false },
      ],
    } as PromptHistoryStore, options);

    assert.deepEqual(cleared.items.map((item) => item.id), ["favorite"]);
    const filePath = path.join(options.promptHistoryDir, "workspace.json");
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as PromptHistoryStore;
    assert.deepEqual(persisted.items.map((item) => item.id), ["favorite"]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
