import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CliName } from "../cli/types";
import {
  cleanupPromptHistoryRetentionAcrossWorkspaces,
  clearPromptHistoryStore,
  ensurePromptHistoryStore,
  recordPromptHistoryInStore,
  setPromptHistoryFavoriteInStore,
  type PromptHistoryStore,
  type PromptHistoryStoreOptions,
} from "../promptHistoryStore";

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
