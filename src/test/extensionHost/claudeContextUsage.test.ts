import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import type { ClaudeStreamHandlers } from "../../interactive/claudeRunner";
import type { InteractiveTurnAttemptPort } from "../../extensionHost/interactiveTurnStrategy";

installVscodeMock();

const { createClaudeInteractiveTurnStrategy } = require("../../extensionHost/interactiveTurnClaude") as typeof import("../../extensionHost/interactiveTurnClaude");

function harness() {
  const messages: Record<string, unknown>[] = [];
  const callbacks: ClaudeStreamHandlers[] = [];
  let release: () => void = () => {};
  let active = true;
  let mappedSession = "cli-session";
  const tab = { cli: "claude", sessionId: "ui-session" };
  const runner = {
    getSessionId: () => mappedSession,
    stopAndRebuild: () => {},
    dispose: () => {},
    runStreamed: async (_prompt: string, handlers: ClaudeStreamHandlers) => {
      callbacks.push(handlers);
      await new Promise<void>((resolve) => { release = resolve; });
    },
  };
  const port = {
    cli: "claude", tabId: "tab-claude", runId: "run-1", uiSessionId: "ui-session", args: [],
    interactiveRunnerManager: { getOrCreateClaudeRunner: () => runner, setRunner: () => {} },
    resolveInteractiveMappedId: () => mappedSession,
    isCurrentRunActive: () => active,
    getConversationTabById: (tabId: string) => tabId === "tab-claude" ? tab : null,
    setStopCurrentTurn: () => {}, syncInteractiveRunEntry: () => {},
    sendPanelMessage: (message: Record<string, unknown>) => messages.push(message),
    settleInteractiveAttempt: async () => "return",
    updateProcessTitle: () => {}, updateSessionForNewRun: (id: string) => { mappedSession = id; },
    logInfo: () => {},
  } as unknown as InteractiveTurnAttemptPort;
  const emit = (index = callbacks.length - 1, sessionId = "cli-session") => callbacks[index].onTokenUsageUpdate?.({
    sessionId, tokensInContextWindow: 90, modelContextWindow: 123456, contextWindowSource: "claude-model-window",
  });
  return { messages, callbacks, port, tab, emit, release: () => release(), setActive: (value: boolean) => { active = value; } };
}

test("sends the established contextTokenUsage contract to its bound Claude tab", async () => {
  const fixture = harness();
  const running = createClaudeInteractiveTurnStrategy().runAttempt(fixture.port);
  fixture.emit();
  fixture.callbacks[0].onTokenUsageUpdate?.({ sessionId: "cli-session", tokensInContextWindow: 77, modelContextWindow: null });
  assert.deepEqual(fixture.messages, [
    { type: "contextTokenUsage", tabId: "tab-claude", tokensInContextWindow: 90, modelContextWindow: 123456, contextWindowSource: "claude-model-window" },
    { type: "contextTokenUsage", tabId: "tab-claude", tokensInContextWindow: 77, modelContextWindow: null },
  ]);
  fixture.release();
  await running;
  fixture.emit();
  assert.equal(fixture.messages.length, 2);
});

test("rejects foreign sessions, stopped runs, rebound sessions and changed CLI tabs", async () => {
  const fixture = harness();
  const running = createClaudeInteractiveTurnStrategy().runAttempt(fixture.port);
  fixture.emit(0, "child-session");
  fixture.setActive(false);
  fixture.emit();
  fixture.setActive(true);
  fixture.tab.sessionId = "other-session";
  fixture.emit();
  fixture.callbacks[0].onSessionId("late-session");
  assert.equal(fixture.port.resolveInteractiveMappedId("claude", "ui-session"), "cli-session");
  fixture.tab.sessionId = "ui-session";
  fixture.tab.cli = "codex";
  fixture.emit();
  assert.deepEqual(fixture.messages, []);
  fixture.release();
  await running;
});

test("an old callback cannot publish during a new run on the same session", async () => {
  const fixture = harness();
  const strategy = createClaudeInteractiveTurnStrategy();
  const first = strategy.runAttempt(fixture.port);
  fixture.release();
  await first;
  const second = strategy.runAttempt(fixture.port);
  fixture.emit(0);
  fixture.callbacks[0].onSessionId("stale-cli-session");
  assert.deepEqual(fixture.messages, []);
  fixture.emit(1);
  assert.equal(fixture.messages.length, 1);
  fixture.release();
  await second;
});

test("a verified CLI session replacement is accepted only while the original tab binding is live", async () => {
  const fixture = harness();
  const running = createClaudeInteractiveTurnStrategy().runAttempt(fixture.port);
  fixture.callbacks[0].onSessionId("reset-cli-session");
  fixture.emit(0, "reset-cli-session");
  assert.equal(fixture.messages.length, 1);
  Object.assign(fixture.port, { uiSessionId: "new-ui-session" });
  fixture.emit(0, "reset-cli-session");
  assert.equal(fixture.messages.length, 1);
  fixture.release();
  await running;
});
