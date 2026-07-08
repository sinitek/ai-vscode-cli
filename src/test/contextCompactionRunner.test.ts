import test = require("node:test");
import assert = require("node:assert/strict");

import type { ContextCompactionRunDeps } from "../contextCompactionRunner";
import type { CliName, InteractiveMode, ThinkingMode } from "../cli/types";

const Module = require("node:module") as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = Module._load;

Module._load = (request: string, parent: unknown, isMain: boolean): unknown => {
  if (request === "vscode") {
    return {
      env: { language: "en" },
      window: {
        createTerminal: () => ({ sendText: () => {} }),
      },
      workspace: {
        getConfiguration: () => ({ get: () => undefined }),
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

function createSilentCodexCompactionDeps() {
  let activeRunId: string | undefined;
  let activeStop: (() => void) | null = null;
  const calls = {
    sendRunStatus: 0,
    appendCompletionMessage: 0,
    persistActiveMessages: 0,
    clearActiveRun: 0,
    appendSystemMessage: 0,
  };

  const runner = {
    compactThread: async () => ({ compacted: true, threadId: "thread-after-compact" }),
    stopAndRebuild: () => {},
  };

  const deps: ContextCompactionRunDeps = {
    getCurrentCli: () => "codex",
    getActiveConversationTabId: () => "tab-1",
    isInteractiveSupported: () => true,
    appendSystemMessageForCli: () => {},
    getCurrentSessionId: () => "session-1",
    hasActiveProcessOrInteractiveStop: () => false,
    resolveInteractiveSessionForResume: async () => "session-1",
    resolveWorkspaceCwd: () => undefined,
    getSelectedCliModel: () => null,
    getEffectiveThinkingMode: () => "medium" as ThinkingMode,
    getWorkspaceInteractiveMode: () => "coding" as InteractiveMode,
    applyThinkingWorkspaceFiles: () => {},
    getEffectiveCliArgs: () => [],
    getCliCommand: () => "codex",
    resolveClaudeInteractiveEntrypoint: () => undefined,
    logCliStartup: () => {},
    loadSessionMessages: () => [],
    createMessageId: () => "run-1",
    beginActiveRunState: ({ runId }) => {
      activeRunId = runId;
    },
    getActiveRunId: () => activeRunId,
    setActiveInteractiveStop: (stop) => {
      activeStop = stop;
    },
    isActiveInteractiveStop: (stop) => activeStop === stop,
    appendStopMessageToStore: () => {},
    killActiveProcess: () => {},
    sendRunStatus: () => {
      calls.sendRunStatus += 1;
    },
    appendCompletionMessage: () => {
      calls.appendCompletionMessage += 1;
    },
    persistActiveMessages: () => {
      calls.persistActiveMessages += 1;
    },
    clearActiveRun: () => {
      calls.clearActiveRun += 1;
      activeRunId = undefined;
    },
    interactiveRunnerManager: {
      beginActiveRun: () => {},
      endActiveRun: () => {},
      getOrCreateCodexRunner: () => runner as never,
      getOrCreateClaudeRunner: () => {
        throw new Error("Claude runner should not be used in this test");
      },
      setRunner: () => {},
    },
    resolveInteractiveMappedId: (cli: CliName) => cli === "codex" ? "thread-before-compact" : null,
    appendSystemMessage: () => {
      calls.appendSystemMessage += 1;
    },
    getWorkspaceCodexMultiAgentEnabled: () => false,
    upsertInteractiveMapping: () => {},
    sendRawStreamDelta: () => {},
    sendPanelMessage: () => {},
    updateProcessTitle: () => {},
    appendTraceMessage: () => {},
    prepareGeminiRunProfile: (selectedModel) => ({ runtimeModel: selectedModel }),
    setActiveProcess: () => {},
    appendAssistantChunk: () => {},
    adoptSessionId: () => {},
  };

  return { deps, calls };
}

test("silent context compaction does not emit visible run timing messages", async () => {
  const { runContextCompactionWithDeps } = require("../contextCompactionRunner") as typeof import("../contextCompactionRunner");
  const { deps, calls } = createSilentCodexCompactionDeps();

  const compacted = await runContextCompactionWithDeps(deps, {
    silent: true,
    cli: "codex",
    tabId: "tab-1",
    sessionId: "session-1",
  });

  assert.equal(compacted, true);
  assert.equal(calls.sendRunStatus, 0);
  assert.equal(calls.appendCompletionMessage, 0);
  assert.equal(calls.persistActiveMessages, 1);
  assert.equal(calls.clearActiveRun, 1);
  assert.equal(calls.appendSystemMessage, 1);
});
