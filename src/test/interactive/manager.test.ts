import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { InteractiveRunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");

function claudeOptions(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-claude",
    mappedSessionId: null,
    command: "claude",
    args: ["--model", "sonnet"],
    cwd: "/workspace",
    thinkingMode: "medium" as const,
    interactiveMode: "coding" as const,
    model: "sonnet",
    entrypoint: "/usr/local/bin/claude",
    isolateProjectInstructions: false,
    ...overrides,
  };
}

test("Claude runners stay attached to one session until cwd, model, or CLI ownership changes", () => {
  const manager = new InteractiveRunnerManager();
  try {
    const first = manager.getOrCreateClaudeRunner(claudeOptions());
    const reused = manager.getOrCreateClaudeRunner(claudeOptions({ args: ["--model", "sonnet", "--verbose"] }));
    assert.equal(reused, first);
    assert.equal(manager.hasClaudeRunner("session-claude", first), true);

    const isolated = manager.getOrCreateClaudeRunner(claudeOptions({ isolateProjectInstructions: true }));
    const isolatedAgain = manager.getOrCreateClaudeRunner(claudeOptions({ isolateProjectInstructions: true }));
    assert.notEqual(isolated, first);
    assert.equal(first.isDisposed(), true);
    assert.equal(isolatedAgain, isolated);

    const moved = manager.getOrCreateClaudeRunner(claudeOptions({ cwd: "/other" }));
    assert.notEqual(moved, isolated);
    assert.equal(isolated.isDisposed(), true);

    manager.disposeIfMatches("claude", "session-claude");
    assert.equal(moved.isDisposed(), true);
    manager.disposeIfMatches("claude", "session-claude");
    manager.disposeForCli("opencode");
    manager.disposeAll();
    manager.disposeAll();
  } finally {
    manager.disposeAll();
  }
});

test("switching or disposing a CLI closes only that CLI runner", () => {
  const manager = new InteractiveRunnerManager();
  try {
    const claude = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "session-a" }));
    const other = manager.getOrCreateClaudeRunner(claudeOptions({ sessionId: "session-b", model: "haiku" }));
    manager.disposeForCli("claude");
    assert.equal(claude.isDisposed(), true);
    assert.equal(other.isDisposed(), true);
    manager.disposeForCli("codex");
    manager.disposeForCli("opencode");
    assert.equal(manager.hasClaudeRunner("session-a", claude), false);
  } finally {
    manager.disposeAll();
  }
});
