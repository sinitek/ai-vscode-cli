import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createSessionMessageRepository } = require("../../sessionMessageRepository") as typeof import("../../sessionMessageRepository");
const { getMessageFile, getSessionKey, writeMessageFile } = require("../../sessionStore") as typeof import("../../sessionStore");
import type { CliName } from "../../cli/types";
import type { ChatMessage } from "../../webview/types";

function message(id: string, role: ChatMessage["role"] = "user", content = id): ChatMessage {
  return { id, role, content, createdAt: 100 };
}

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-message-repository-"));
  const state = {
    workspace: "workspace-a",
    recover: (_id: string, _messages: ChatMessage[]): ChatMessage[] | null => null,
    onHealth: (_cli: CliName, _id: string, _messages: ChatMessage[]): void => {},
  };
  const options = {
    workspaceKeyFallback: "default",
    legacyMessageDir: path.join(root, "legacy"),
    messageDirRoot: path.join(root, "messages"),
  };
  const cache = new Map<string, ChatMessage[]>();
  const errors = new Map<string, string>();
  const health: Array<{ cli: CliName; id: string; messages: ChatMessage[] }> = [];
  const logs: Array<{ event: string; payload?: unknown }> = [];
  const create = (sessionMessageCache = cache) => createSessionMessageRepository({
    ...options,
    activeWorkspaceKey: () => state.workspace,
    sessionMessageCache,
    sessionMessageLoadErrors: errors,
    recoverClaudeMessagesFromTranscript: (id, messages) => state.recover(id, messages),
    updateSessionHealth: (cli, id, messages) => {
      health.push({ cli, id, messages });
      state.onHealth(cli, id, messages);
    },
    logInfo: (event, payload) => { logs.push({ event, payload }); },
    logError: (event, payload) => { logs.push({ event, payload }); },
  });
  const file = (cli: CliName, id: string) => getMessageFile(cli, id, state.workspace, options);
  const seed = (cli: CliName, id: string, messages: ChatMessage[], retentionPruned = false) => {
    assert.equal(writeMessageFile(cli, id, messages, {
      ...options, activeWorkspaceKey: state.workspace, retentionPruned,
    }), true);
  };
  const read = (cli: CliName, id: string) => JSON.parse(fs.readFileSync(file(cli, id), "utf8")) as {
    messages: ChatMessage[]; retentionPruned?: boolean;
  };
  return {
    root, state, options, cache, errors, health, logs, create, repository: create(), file, seed, read,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("loads, sanitizes then recovers Claude messages and persists before caching and health", () => {
  const h = createHarness();
  try {
    h.seed("claude", "recover", [message("user"), message("empty", "assistant", "  ")]);
    const recovered = [message("user"), message("answer", "assistant")];
    h.state.recover = (id, messages) => {
      assert.equal(id, "recover");
      assert.deepEqual(messages.map((m) => [m.id, m.sequence]), [["user", 0]]);
      assert.equal(h.cache.size, 0);
      return recovered;
    };
    h.state.onHealth = (cli, id, messages) => {
      assert.equal(h.cache.get(getSessionKey(h.state.workspace, cli, id)), messages);
      assert.deepEqual(h.read(cli, id).messages, recovered);
    };
    assert.equal(h.repository.loadMessages("claude", "recover"), recovered);
    assert.deepEqual(h.logs, [{ event: "claude-session-recovered-from-transcript", payload: {
      sessionId: "recover", originalSize: 1, recoveredSize: 2,
    } }]);
  } finally { h.cleanup(); }
});

test("cache hits preserve the array and update health, with dynamic workspace and CLI isolation", () => {
  const h = createHarness();
  try {
    h.repository.saveMessages("codex", "same", [message("a")]);
    const a = h.repository.loadMessages("codex", "same");
    fs.writeFileSync(h.file("codex", "same"), "invalid JSON");
    const healthCount = h.health.length;
    assert.equal(h.repository.loadMessages("codex", "same"), a);
    assert.equal(h.health.length, healthCount + 1);
    assert.equal(h.health.at(-1)?.messages, a);
    assert.equal(h.repository.getLoadError("codex", "same"), undefined);
    h.repository.saveMessages("claude", "same", [message("claude")]);
    assert.equal(h.repository.loadMessages("claude", "same")[0].id, "claude");
    h.state.workspace = "workspace-b";
    assert.deepEqual(h.repository.loadMessages("codex", "same"), []);
    h.repository.saveMessages("codex", "same", [message("b")]);
    assert.equal(h.read("codex", "same").messages[0].id, "b");
    h.state.workspace = "workspace-a";
    assert.equal(h.repository.loadMessages("codex", "same"), a);
    assert.equal(h.cache.size, 3);
  } finally { h.cleanup(); }
});

test("Grok load sanitizes and collapses consecutive thinking using existing serialization", () => {
  const h = createHarness();
  try {
    h.seed("grok", "thinking", [message("user"),
      { ...message("first", "assistant", "<think>first</think>"), kind: "thinking" },
      { ...message("second", "assistant", "<think>second</think>"), kind: "thinking" },
    ]);
    const messages = h.repository.loadMessages("grok", "thinking");
    assert.deepEqual(messages.map((m) => [m.id, m.content]), [["user", "user"], ["first", "first\n\nsecond"]]);
    assert.deepEqual(h.read("grok", "thinking"), { messages });
  } finally { h.cleanup(); }
});

test("Claude recovery errors retain sanitized history and the original event and payload", () => {
  const h = createHarness();
  try {
    for (const error of [new Error("transcript unavailable"), "string failure"]) {
      const id = String(h.logs.length);
      h.seed("claude", id, [message("user")]);
      h.state.recover = () => { throw error; };
      assert.equal(h.repository.loadMessages("claude", id)[0].id, "user");
      assert.deepEqual(h.logs.at(-1), { event: "claude-session-recover-failed", payload: {
        sessionId: id, error: error instanceof Error ? error.message : error,
      } });
      assert.equal(h.repository.getLoadError("claude", id), undefined);
    }
  } finally { h.cleanup(); }
});

test("only eligible Claude histories invoke transcript recovery", () => {
  const h = createHarness();
  try {
    let recoveries = 0;
    h.state.recover = () => { recoveries++; return null; };
    const histories = [[], [message("blank", "user", " ")], [message("user"), message("answer", "assistant")],
      [message("user"), message("trace", "trace")]];
    histories.forEach((messages, index) => {
      h.seed("claude", String(index), messages);
      h.repository.loadMessages("claude", String(index));
    });
    h.seed("codex", "user", [message("user")]);
    h.repository.loadMessages("codex", "user");
    assert.equal(recoveries, 0);
    h.seed("claude", "eligible", [message("user")]);
    h.repository.loadMessages("claude", "eligible");
    assert.equal(recoveries, 1);
  } finally { h.cleanup(); }
});

test("save failure keeps sanitized cache and health, void return, original logs and loadErrors", () => {
  const h = createHarness();
  try {
    fs.writeFileSync(h.options.messageDirRoot, "blocked");
    const key = getSessionKey(h.state.workspace, "codex", "blocked");
    h.errors.set(key, "earlier read error");
    h.state.onHealth = () => assert.equal(h.cache.has(key), false);
    assert.equal(h.repository.saveMessages("codex", "blocked", [message("user"), message("empty", "trace", " ")]), undefined);
    h.state.onHealth = () => {};
    assert.deepEqual(h.repository.loadMessages("codex", "blocked").map((m) => m.id), ["user"]);
    assert.equal(h.repository.getLoadError("codex", "blocked"), "earlier read error");
    assert.equal(h.logs.at(-1)?.event, "session-messages-write-error");
    assert.equal(h.health[0].messages, h.cache.get(key));
  } finally { h.cleanup(); }
});

test("recovery write failure still returns and caches recovered messages without becoming a read error", () => {
  const h = createHarness();
  try {
    h.seed("claude", "recover", [message("user")]);
    const recovered = [message("answer", "assistant")];
    h.state.recover = () => {
      // Make the destination unwritable without mocking the actual serialization boundary.
      fs.unlinkSync(h.file("claude", "recover"));
      fs.mkdirSync(h.file("claude", "recover"));
      return recovered;
    };
    assert.equal(h.repository.loadMessages("claude", "recover"), recovered);
    assert.equal(h.repository.loadMessages("claude", "recover"), recovered);
    assert.equal(h.repository.getLoadError("claude", "recover"), undefined);
    assert.equal(h.logs.at(-1)?.event, "session-messages-write-error");
  } finally { h.cleanup(); }
});

test("malformed reads retain detailed loadErrors until an uncached successful read", () => {
  const h = createHarness();
  try {
    h.seed("codex", "bad", []);
    fs.writeFileSync(h.file("codex", "bad"), "{");
    const empty = h.repository.loadMessages("codex", "bad");
    assert.deepEqual(empty, []);
    assert.ok(h.repository.getLoadError("codex", "bad"));
    assert.equal(h.logs.at(-1)?.event, "session-messages-read-error");
    h.seed("codex", "bad", [message("fixed")]);
    assert.equal(h.repository.loadMessages("codex", "bad"), empty);
    h.repository.evictSession("codex", "bad");
    assert.ok(h.repository.getLoadError("codex", "bad"));
    assert.equal(h.repository.loadMessages("codex", "bad")[0].id, "fixed");
    assert.equal(h.repository.getLoadError("codex", "bad"), undefined);
  } finally { h.cleanup(); }
});

test("draft and merged array pruning provenance survives normalization, migration and restart", () => {
  const h = createHarness();
  try {
    const draft = [message("user")];
    h.repository.markPrunedArray(draft);
    const bound = [...draft, message("empty", "trace", " ")];
    h.repository.inheritPruning(bound, [], draft);
    h.repository.saveMessages("claude", "local", bound);
    assert.equal(h.read("claude", "local").retentionPruned, true);
    const local = h.repository.loadMessages("claude", "local");
    assert.notEqual(local, bound);
    const merged = [...local];
    h.repository.inheritPruning(merged, [], local);
    h.repository.saveMessages("claude", "native", merged);
    let recoveries = 0;
    h.state.recover = () => { recoveries++; return [message("revived", "assistant")]; };
    const restarted = h.create(new Map());
    const reopened = restarted.loadMessages("claude", "native");
    assert.deepEqual(reopened.map((m) => m.id), ["user"]);
    restarted.saveMessages("claude", "another", reopened);
    assert.equal(h.read("claude", "another").retentionPruned, true);
    assert.equal(recoveries, 0);
  } finally { h.cleanup(); }
});

test("prune persistence failure changes neither cache nor provenance; success can remember the live array", () => {
  const h = createHarness();
  try {
    h.repository.saveMessages("claude", "session", [message("user"), message("old", "trace")]);
    const original = h.repository.loadMessages("claude", "session");
    const remaining = [original[0]];
    const file = h.file("claude", "session");
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    assert.equal(h.repository.persistPrunedMessages("claude", "session", remaining), false);
    assert.equal(h.repository.loadMessages("claude", "session"), original);
    assert.equal(original.length, 2);
    h.repository.saveMessages("claude", "unmarked", remaining);
    assert.equal(h.read("claude", "unmarked").retentionPruned, undefined);
    fs.rmdirSync(file);
    assert.equal(h.repository.persistPrunedMessages("claude", "session", remaining), true);
    assert.equal(h.read("claude", "session").retentionPruned, true);
    original.splice(1);
    h.repository.markPrunedArray(original);
    h.repository.rememberPrunedSession("claude", "session", original);
    assert.equal(h.repository.loadMessages("claude", "session"), original);
    assert.deepEqual(h.create(new Map()).loadMessages("claude", "session").map((m) => m.id), ["user"]);
  } finally { h.cleanup(); }
});

test("session eviction respects explicit workspace and load-error scope; clear keeps array provenance", () => {
  const h = createHarness();
  try {
    const marked = [message("a")];
    h.repository.markPrunedArray(marked);
    h.repository.saveMessages("claude", "same", marked);
    const a = h.repository.loadMessages("claude", "same");
    h.errors.set(getSessionKey("workspace-a", "claude", "same"), "a error");
    h.state.workspace = "workspace-b";
    h.repository.saveMessages("claude", "same", [message("b")]);
    const b = h.repository.loadMessages("claude", "same");
    h.errors.set(getSessionKey("workspace-b", "claude", "same"), "b error");
    h.repository.evictSession("claude", "same", { workspaceKey: "workspace-a", clearLoadError: true });
    assert.equal(h.cache.has(getSessionKey("workspace-a", "claude", "same")), false);
    assert.equal(h.errors.has(getSessionKey("workspace-a", "claude", "same")), false);
    assert.equal(h.repository.loadMessages("claude", "same"), b);
    assert.equal(h.repository.getLoadError("claude", "same"), "b error");
    h.repository.clearCachedSessions();
    assert.equal(h.cache.size, 0);
    assert.equal(h.repository.getLoadError("claude", "same"), "b error");
    h.repository.saveMessages("claude", "inherited", a);
    assert.equal(h.read("claude", "inherited").retentionPruned, true);
    h.repository.saveMessages("claude", "same", [message("fresh")]);
    assert.equal(h.read("claude", "same").retentionPruned, undefined);
  } finally { h.cleanup(); }
});

test("repository instances keep independent pruning provenance", () => {
  const h = createHarness();
  try {
    const marked = [message("user")];
    h.repository.markPrunedArray(marked);
    const other = h.create(new Map());
    other.saveMessages("claude", "other", marked);
    assert.equal(h.read("claude", "other").retentionPruned, undefined);
    h.repository.saveMessages("claude", "owner", marked);
    assert.equal(h.read("claude", "owner").retentionPruned, true);
  } finally { h.cleanup(); }
});
