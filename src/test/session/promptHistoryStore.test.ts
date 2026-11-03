import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CliName } from "../../cli/types";
import {
  buildPromptHistoryState,
  cleanupPromptHistoryRetentionAcrossWorkspaces,
  clearPromptHistoryStore,
  ensurePromptHistoryStore,
  getGlobalPromptHistoryFilePath,
  loadPromptHistoryStore,
  recordPromptHistoryInStore,
  setPromptHistoryFavoriteInStore,
  setPromptHistoryGlobalInStore,
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

test("only favorite prompts can become global", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const options = createOptions(rootDir);
  let store = recordPromptHistoryInStore(undefined, "private prompt", "codex", options);
  for (const id of ["", "missing", store.items[0].id]) {
    store = setPromptHistoryGlobalInStore(store, id, true, options);
  }
  assert.equal(fs.existsSync(getGlobalPromptHistoryFilePath(options)), false);
  assert.equal(buildPromptHistoryState(store, options)[0].global, undefined);
});

test("shares global favorites across projects without exposing private history or duplicating prompts", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const options = createOptions(rootDir);
  const otherOptions = { ...options, workspaceKey: "other-project" };
  let source = recordPromptHistoryInStore(undefined, "shared prompt", "codex", options);
  const sharedId = source.items[0].id;
  source = setPromptHistoryFavoriteInStore(source, sharedId, true, options);
  source = setPromptHistoryGlobalInStore(source, sharedId, true, options);
  source = recordPromptHistoryInStore(source, "private prompt", "codex", options);
  const other = recordPromptHistoryInStore(undefined, "other private prompt", "claude", otherOptions);
  const sharedState = buildPromptHistoryState(other, otherOptions);
  const globalItem = sharedState.find((item) => item.global === true);
  assert.equal(globalItem?.id, sharedId);
  assert.equal(globalItem?.favorite, true);
  assert.equal(sharedState.some((item) => item.prompt === "private prompt"), false);
  assert.equal(loadPromptHistoryStore(otherOptions).items.length, 1);
  assert.equal(buildPromptHistoryState(source, options).filter((item) => item.prompt === "shared prompt").length, 1);
  const persisted = JSON.parse(fs.readFileSync(getGlobalPromptHistoryFilePath(options), "utf8")) as PromptHistoryStore;
  assert.equal(persisted.items[0].global, true);
  assert.equal(source.items.some((item) => item.global === true), false);
});

test("reuses a global favorite in another project and preserves its shared identity and favorite", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const options = createOptions(rootDir);
  const otherOptions = { ...options, workspaceKey: "other-project" };
  let other = recordPromptHistoryInStore(undefined, "shared prompt", "claude", otherOptions);
  let source = recordPromptHistoryInStore(undefined, "shared prompt", "codex", options);
  const sharedId = source.items[0].id;
  source = setPromptHistoryFavoriteInStore(source, sharedId, true, options);
  setPromptHistoryGlobalInStore(source, sharedId, true, options);
  context.mock.method(Date, "now", () => 1_900_000_000_000);
  other = recordPromptHistoryInStore(other, "  shared prompt\n", "opencode", otherOptions);
  const state = buildPromptHistoryState(other, otherOptions);
  assert.deepEqual(state, [{
    id: sharedId,
    prompt: "shared prompt",
    createdAt: 1_900_000_000_000,
    cli: "opencode",
    favorite: true,
    global: true,
  }]);
  assert.deepEqual(buildPromptHistoryState(source, options), state);
  assert.equal(loadPromptHistoryStore(otherOptions).items[0].global, undefined);
});

test("revoking global sharing preserves project favorites and stale writers cannot restore sharing", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const options = createOptions(rootDir);
  const otherOptions = { ...options, workspaceKey: "other-project" };
  let source = recordPromptHistoryInStore(undefined, "shared prompt", "codex", options);
  const sharedId = source.items[0].id;
  source = setPromptHistoryFavoriteInStore(source, sharedId, true, options);
  source = setPromptHistoryGlobalInStore(source, sharedId, undefined, options);
  const other = setPromptHistoryGlobalInStore(undefined, sharedId, undefined, otherOptions);
  assert.equal(other.items[0].favorite, true);
  assert.equal(other.items[0].global, undefined);
  assert.equal(buildPromptHistoryState(source, options)[0].global, undefined);
  source = recordPromptHistoryInStore(source, "unrelated prompt", "codex", options);
  clearPromptHistoryStore(source, options);
  cleanupPromptHistoryRetentionAcrossWorkspaces(options);
  const emptyProject = { ...options, workspaceKey: "empty-project" };
  assert.deepEqual(buildPromptHistoryState(loadPromptHistoryStore(emptyProject), emptyProject), []);
  assert.equal(loadPromptHistoryStore(options).items[0].favorite, true);
  assert.equal(loadPromptHistoryStore(otherOptions).items[0].favorite, true);
});

test("unfavoriting a shared prompt removes global sharing and keeps ordinary history in the current project", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const options = createOptions(rootDir);
  const otherOptions = { ...options, workspaceKey: "other-project" };
  let source = recordPromptHistoryInStore(undefined, "shared prompt", "codex", options);
  const sharedId = source.items[0].id;
  source = setPromptHistoryFavoriteInStore(source, sharedId, true, options);
  setPromptHistoryGlobalInStore(source, sharedId, true, options);
  const other = setPromptHistoryFavoriteInStore(undefined, sharedId, false, otherOptions);
  assert.equal(other.items[0].favorite, false);
  assert.equal(buildPromptHistoryState(other, otherOptions)[0].global, undefined);
  assert.equal(buildPromptHistoryState(source, options)[0].global, undefined);
  assert.equal(buildPromptHistoryState(source, options)[0].favorite, true);
});

test("shared favorites survive cleanup and independent project changes merge the latest shared file", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const options = createOptions(rootDir, { promptHistoryLimit: 0 });
  const otherOptions = { ...options, workspaceKey: "other-project" };
  const source: PromptHistoryStore = { items: [{ id: "first", prompt: "first shared prompt", cli: "codex", createdAt: 1, favorite: true }] };
  const other: PromptHistoryStore = { items: [{ id: "second", prompt: "second shared prompt", cli: "claude", createdAt: 2, favorite: true }] };
  setPromptHistoryGlobalInStore(source, "first", true, options);
  setPromptHistoryGlobalInStore(other, "second", true, otherOptions);
  const expiredOptions = { ...options, isTimestampWithinHistoryRetention: () => false };
  cleanupPromptHistoryRetentionAcrossWorkspaces(expiredOptions);
  clearPromptHistoryStore(source, expiredOptions);
  const state = buildPromptHistoryState(undefined, expiredOptions);
  assert.deepEqual(state.map((item) => item.id), ["second", "first"]);
  assert.ok(state.every((item) => item.favorite && item.global));
});

test("ignores malformed or non-favorite shared data without changing project history", (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-prompt-history-"));
  context.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const errors: string[] = [];
  const options = { ...createOptions(rootDir), logError: (event: string) => errors.push(event) };
  const store = recordPromptHistoryInStore(undefined, "private prompt", "codex", options);
  const filePath = getGlobalPromptHistoryFilePath(options);
  fs.writeFileSync(filePath, "{invalid", "utf8");
  assert.deepEqual(buildPromptHistoryState(store, options), store.items);
  assert.deepEqual(errors, ["prompt-history-read-error"]);
  fs.writeFileSync(filePath, JSON.stringify({ items: [
    { id: "invalid", prompt: "not a favorite", cli: "codex", createdAt: 1, favorite: false, global: true },
  ] }), "utf8");
  assert.deepEqual(buildPromptHistoryState(store, options), store.items);
});
