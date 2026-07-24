import test = require("node:test");
import assert = require("node:assert/strict");

import {
  areCodexRunSelectionsEqual,
  decideCodexThreadForSelection,
  normalizeCodexRunSelection,
} from "../interactive/codexThreadSelection";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const { InteractiveRunnerManager } = require("../interactive/manager") as typeof import("../interactive/manager");

test("Codex thread selection reuses a mapped thread when config and model are unchanged", () => {
  const previous = normalizeCodexRunSelection({ configId: "config-a", model: "gpt-5.5" });
  const next = normalizeCodexRunSelection({ configId: " config-a ", model: " gpt-5.5 " });

  assert.equal(areCodexRunSelectionsEqual(previous, next), true);
  assert.deepEqual(
    decideCodexThreadForSelection({
      mappedThreadId: "thread-a",
      previousSelection: previous,
      nextSelection: next,
    }),
    {
      threadId: "thread-a",
      freezePrevious: null,
      startedFreshForSelectionChange: false,
    }
  );
});

test("Codex thread selection starts fresh when model or config changes", () => {
  const previous = normalizeCodexRunSelection({ configId: "config-a", model: "gpt-5.6-sol" });

  assert.deepEqual(
    decideCodexThreadForSelection({
      mappedThreadId: "thread-old",
      previousSelection: previous,
      nextSelection: normalizeCodexRunSelection({ configId: "config-a", model: "gpt-5.5" }),
    }),
    {
      threadId: null,
      freezePrevious: "thread-old",
      startedFreshForSelectionChange: true,
    }
  );
  assert.deepEqual(
    decideCodexThreadForSelection({
      mappedThreadId: "thread-old",
      previousSelection: previous,
      nextSelection: normalizeCodexRunSelection({ configId: "config-b", model: "gpt-5.6-sol" }),
    }),
    {
      threadId: null,
      freezePrevious: "thread-old",
      startedFreshForSelectionChange: true,
    }
  );
});

test("InteractiveRunnerManager tracks Codex config identity separately from model", () => {
  const manager = new InteractiveRunnerManager();
  try {
    const first = manager.getOrCreateCodexRunner({
      sessionId: "ui-session",
      threadId: "thread-a",
      command: "codex",
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: "gpt-5.5",
      configId: "config-a",
      multiAgentEnabled: false,
    });
    const second = manager.getOrCreateCodexRunner({
      sessionId: "ui-session",
      threadId: "thread-a",
      command: "codex",
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: "gpt-5.5",
      configId: "config-a",
      multiAgentEnabled: false,
    });
    const third = manager.getOrCreateCodexRunner({
      sessionId: "ui-session",
      threadId: null,
      command: "codex",
      args: [],
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: "gpt-5.5",
      configId: "config-b",
      multiAgentEnabled: false,
    });

    assert.equal(second, first);
    assert.notEqual(third, first);
    assert.deepEqual(manager.getCodexRunnerSelection("ui-session"), {
      configId: "config-b",
      model: "gpt-5.5",
    });
  } finally {
    manager.disposeAll();
  }
});

test("InteractiveRunnerManager does not reuse Codex runners across execution roots", () => {
  const manager = new InteractiveRunnerManager();
  try {
    const first = manager.getOrCreateCodexRunner({
      sessionId: "ui-session",
      threadId: "thread-a",
      command: "codex",
      args: ["app-server"],
      cwd: "/tmp/root-a",
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: "gpt-5.5",
      configId: "config-a",
      multiAgentEnabled: false,
    });
    const second = manager.getOrCreateCodexRunner({
      sessionId: "ui-session",
      threadId: "thread-a",
      command: "codex",
      args: ["app-server"],
      cwd: "/tmp/root-a",
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: "gpt-5.5",
      configId: "config-a",
      multiAgentEnabled: false,
    });
    const third = manager.getOrCreateCodexRunner({
      sessionId: "ui-session",
      threadId: "thread-a",
      command: "codex",
      args: ["app-server"],
      cwd: "/tmp/root-b",
      thinkingMode: "medium",
      interactiveMode: "coding",
      model: "gpt-5.5",
      configId: "config-a",
      multiAgentEnabled: false,
    });

    assert.equal(second, first);
    assert.notEqual(third, first);
  } finally {
    manager.disposeAll();
  }
});
