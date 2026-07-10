import test = require("node:test");
import assert = require("node:assert/strict");

import {
  collectInteractiveSessionKeys,
  collectReferencedInteractiveSessionKeys,
  shouldDisposeInteractiveSession,
} from "../interactive/runnerRetention";

test("keeps the previous codex runner when a tab switches to opencode but still retains the codex session binding", () => {
  const referencedSessionKeys = collectReferencedInteractiveSessionKeys([
    { codex: "codex-session-1", opencode: "opencode-session-1" },
  ]);

  const shouldDispose = shouldDisposeInteractiveSession(
    { cli: "codex", sessionId: "codex-session-1" },
    { referencedSessionKeys, activeSessionKeys: new Set<string>() },
  );

  assert.equal(shouldDispose, false);
});

test("keeps an opencode runner when the tab still references the opencode session binding", () => {
  const referencedSessionKeys = collectReferencedInteractiveSessionKeys([
    { opencode: "opencode-session-1" },
  ]);

  const shouldDispose = shouldDisposeInteractiveSession(
    { cli: "opencode", sessionId: "opencode-session-1" },
    { referencedSessionKeys, activeSessionKeys: new Set<string>() },
  );

  assert.equal(shouldDispose, false);
});

test("disposes an orphaned idle interactive runner after the tab switches to a different codex session", () => {
  const referencedSessionKeys = collectReferencedInteractiveSessionKeys([
    { codex: "codex-session-2" },
  ]);

  const shouldDispose = shouldDisposeInteractiveSession(
    { cli: "codex", sessionId: "codex-session-1" },
    { referencedSessionKeys, activeSessionKeys: new Set<string>() },
  );

  assert.equal(shouldDispose, true);
});

test("keeps an active interactive runner even when no tab currently references its session", () => {
  const activeSessionKeys = collectInteractiveSessionKeys([
    { cli: "claude", sessionId: "claude-session-1" },
  ]);

  const shouldDispose = shouldDisposeInteractiveSession(
    { cli: "claude", sessionId: "claude-session-1" },
    { referencedSessionKeys: new Set<string>(), activeSessionKeys },
  );

  assert.equal(shouldDispose, false);
});
