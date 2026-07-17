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
    sendRunStatuses: [] as Array<{ status: "start" | "end" | "error" | "stopped"; activity?: "contextCompaction" }>,
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
    getActiveConfigIdForCli: () => "config-codex",
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
    sendRunStatus: (status, _message, options) => {
      calls.sendRunStatuses.push({ status, activity: options?.activity });
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
    getGlobalMultiAgentEnabled: () => false,
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

type OpenCodeRunCall = {
  cli: CliName;
  prompt: string;
  cwd?: string;
  sessionId?: string | null;
  model?: string | null;
  openCodeSmallModel?: string | null;
  openCodeVariant?: string | null;
  openCodeConfigContent?: string | null;
  envOverrides?: Record<string, string>;
  processLabel?: string;
};

type OpenCodeCompactionFixtureOptions = {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: Error;
  currentSessionId?: string | null;
  resolvedSessionId?: string | null | undefined;
};

function createOpenCodeCompactionDeps(options: OpenCodeCompactionFixtureOptions = {}) {
  let activeRunId: string | undefined;
  let activeStop: (() => void) | null = null;
  const currentSessionId = Object.prototype.hasOwnProperty.call(options, "currentSessionId")
    ? options.currentSessionId ?? null
    : "session-before";
  const calls = {
    sendRunStatuses: [] as string[],
    appendCompletionStatuses: [] as string[],
    persistActiveMessages: 0,
    clearActiveRun: 0,
    appendSystemMessages: [] as string[],
    appendSystemMessagesForCli: [] as string[],
    runStreamCalls: [] as OpenCodeRunCall[],
    adoptedSessions: [] as Array<{ cli: CliName; sessionId: string; tabId: string | null }>,
    rawStreams: [] as Array<{ stream?: "stdout" | "stderr" | "event"; content: unknown }>,
    traceMessages: [] as string[],
    prepareProfiles: [] as Array<{ selectedModel: string | null; cwd?: string; cli?: CliName }>,
    activeProcessStates: [] as string[],
  };

  const runCliStreamImpl: NonNullable<ContextCompactionRunDeps["runCliStream"]> = (
    cli,
    prompt,
    handlers,
    runOptions = {}
  ) => {
    calls.runStreamCalls.push({
      cli,
      prompt,
      cwd: runOptions.cwd,
      sessionId: runOptions.sessionId,
      model: runOptions.model,
      openCodeSmallModel: runOptions.openCodeSmallModel,
      openCodeVariant: runOptions.openCodeVariant,
      openCodeConfigContent: runOptions.openCodeConfigContent,
      envOverrides: runOptions.envOverrides,
      processLabel: runOptions.processLabel,
    });
    queueMicrotask(() => {
      if (options.error) {
        handlers.onError(options.error);
        return;
      }
      if (options.stdout) {
        handlers.onStdout(options.stdout);
      }
      if (options.stderr) {
        handlers.onStderr(options.stderr);
      }
      handlers.onExit(Object.prototype.hasOwnProperty.call(options, "exitCode") ? options.exitCode ?? null : 0);
    });
    return {
      pid: 123,
      resolvedCommand: "opencode",
      kill: () => true,
    };
  };

  const deps: ContextCompactionRunDeps = {
    getCurrentCli: () => "opencode",
    getActiveConversationTabId: () => "tab-opencode",
    isInteractiveSupported: () => true,
    appendSystemMessageForCli: (_cli, _sessionId, content) => {
      calls.appendSystemMessagesForCli.push(content);
    },
    getCurrentSessionId: () => currentSessionId,
    hasActiveProcessOrInteractiveStop: () => false,
    resolveInteractiveSessionForResume: async () => Object.prototype.hasOwnProperty.call(options, "resolvedSessionId")
      ? options.resolvedSessionId
      : currentSessionId,
    resolveWorkspaceCwd: () => "/workspace",
    getActiveConfigIdForCli: () => "config-opencode",
    getSelectedCliModel: () => "stored/model",
    getEffectiveThinkingMode: () => "medium" as ThinkingMode,
    getWorkspaceInteractiveMode: () => "coding" as InteractiveMode,
    applyThinkingWorkspaceFiles: () => {},
    getEffectiveCliArgs: () => ["run"],
    getCliCommand: () => "opencode",
    resolveClaudeInteractiveEntrypoint: () => undefined,
    logCliStartup: () => {},
    loadSessionMessages: () => [],
    createMessageId: () => "run-opencode",
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
    sendRunStatus: (status) => {
      calls.sendRunStatuses.push(status);
    },
    appendCompletionMessage: (status) => {
      calls.appendCompletionStatuses.push(status);
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
      getOrCreateCodexRunner: () => {
        throw new Error("Codex runner should not be used in this test");
      },
      getOrCreateClaudeRunner: () => {
        throw new Error("Claude runner should not be used in this test");
      },
      setRunner: () => {},
    },
    resolveInteractiveMappedId: () => null,
    appendSystemMessage: (content) => {
      calls.appendSystemMessages.push(content);
    },
    getGlobalMultiAgentEnabled: () => false,
    upsertInteractiveMapping: () => {},
    sendRawStreamDelta: (content, streamOptions) => {
      calls.rawStreams.push({ stream: streamOptions?.stream, content });
    },
    sendPanelMessage: () => {},
    updateProcessTitle: () => {},
    appendTraceMessage: (content) => {
      calls.traceMessages.push(content);
    },
    prepareGeminiRunProfile: (selectedModel) => ({ runtimeModel: selectedModel }),
    prepareOpenCodeRunProfile: (selectedModel, cwd, cli) => {
      calls.prepareProfiles.push({ selectedModel, cwd, cli });
      return {
        openCodeVariant: "reasoning-high",
        model: "primary/model",
        openCodeSmallModel: "small/model",
        openCodeConfigContent: "{\"model\":\"primary/model\"}",
        envOverrides: { OPENCODE_CONFIG: "/tmp/opencode.json" },
      };
    },
    setActiveProcess: (process) => {
      calls.activeProcessStates.push(process ? "set" : "clear");
    },
    appendAssistantChunk: () => {},
    adoptSessionId: (cli, sessionId, tabId) => {
      calls.adoptedSessions.push({ cli, sessionId, tabId });
    },
    runCliStream: runCliStreamImpl,
    buildProcessLabel: (cli, sessionId) => `label:${cli}:${sessionId ?? "new"}`,
  };

  return { deps, calls };
}

test("silent context compaction emits status events for the active compaction indicator", async () => {
  const { runContextCompactionWithDeps } = require("../contextCompactionRunner") as typeof import("../contextCompactionRunner");
  const { deps, calls } = createSilentCodexCompactionDeps();

  const compacted = await runContextCompactionWithDeps(deps, {
    silent: true,
    cli: "codex",
    tabId: "tab-1",
    sessionId: "session-1",
  });

  assert.equal(compacted, true);
  assert.deepEqual(calls.sendRunStatuses, [
    { status: "start", activity: "contextCompaction" },
    { status: "end", activity: undefined },
  ]);
  assert.equal(calls.appendCompletionMessage, 0);
  assert.equal(calls.persistActiveMessages, 1);
  assert.equal(calls.clearActiveRun, 1);
  assert.equal(calls.appendSystemMessage, 1);
});

test("OpenCode manual compaction runs native slash command with active session", async () => {
  const { runContextCompactionWithDeps } = require("../contextCompactionRunner") as typeof import("../contextCompactionRunner");
  const { deps, calls } = createOpenCodeCompactionDeps({
    stdout: `${JSON.stringify({ type: "assistant", sessionID: "session-after", text: "Compacted current session" })}\n`,
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "opencode",
    tabId: "tab-opencode",
    sessionId: "session-before",
  });

  assert.equal(compacted, true);
  assert.deepEqual(calls.sendRunStatuses, ["start", "end"]);
  assert.deepEqual(calls.appendCompletionStatuses, ["end"]);
  assert.equal(calls.runStreamCalls.length, 1);
  assert.equal(calls.runStreamCalls[0]?.cli, "opencode");
  assert.equal(calls.runStreamCalls[0]?.prompt, "/compact");
  assert.equal(calls.runStreamCalls[0]?.sessionId, "session-before");
  assert.equal(calls.runStreamCalls[0]?.model, "primary/model");
  assert.equal(calls.runStreamCalls[0]?.openCodeSmallModel, "small/model");
  assert.equal(calls.runStreamCalls[0]?.openCodeVariant, "reasoning-high");
  assert.equal(calls.runStreamCalls[0]?.openCodeConfigContent, "{\"model\":\"primary/model\"}");
  assert.deepEqual(calls.runStreamCalls[0]?.envOverrides, { OPENCODE_CONFIG: "/tmp/opencode.json" });
  assert.equal(calls.runStreamCalls[0]?.processLabel, "label:opencode:session-before");
  assert.deepEqual(calls.adoptedSessions, [{ cli: "opencode", sessionId: "session-after", tabId: "tab-opencode" }]);
  assert.match(calls.appendSystemMessages[0] ?? "", /OpenCode context compaction completed/);
  assert.equal(calls.persistActiveMessages, 1);
  assert.equal(calls.clearActiveRun, 1);
});

test("OpenCode silent compaction keeps automatic after-run path quiet", async () => {
  const { runContextCompactionWithDeps } = require("../contextCompactionRunner") as typeof import("../contextCompactionRunner");
  const { deps, calls } = createOpenCodeCompactionDeps({
    stdout: `${JSON.stringify({ type: "assistant", sessionID: "auto-session", text: "Compacted current session" })}\n`,
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    silent: true,
    cli: "opencode",
    tabId: "tab-opencode",
    sessionId: "session-before",
  });

  assert.equal(compacted, true);
  assert.equal(calls.runStreamCalls.length, 1);
  assert.deepEqual(calls.sendRunStatuses, ["start", "end"]);
  assert.deepEqual(calls.appendCompletionStatuses, []);
  assert.deepEqual(calls.adoptedSessions, [{ cli: "opencode", sessionId: "auto-session", tabId: "tab-opencode" }]);
  assert.equal(calls.persistActiveMessages, 1);
  assert.equal(calls.clearActiveRun, 1);
});

test("OpenCode compaction does not run without a resumable session", async () => {
  const { runContextCompactionWithDeps } = require("../contextCompactionRunner") as typeof import("../contextCompactionRunner");
  const { deps, calls } = createOpenCodeCompactionDeps({ currentSessionId: null });

  const compacted = await runContextCompactionWithDeps(deps, { cli: "opencode" });

  assert.equal(compacted, false);
  assert.equal(calls.runStreamCalls.length, 0);
  assert.equal(calls.prepareProfiles.length, 0);
  assert.equal(calls.appendSystemMessagesForCli.length, 1);
});

test("OpenCode compaction reports unsupported slash command clearly", async () => {
  const { runContextCompactionWithDeps } = require("../contextCompactionRunner") as typeof import("../contextCompactionRunner");
  const { deps, calls } = createOpenCodeCompactionDeps({
    stdout: `${JSON.stringify({ type: "assistant", sessionID: "session-before", text: "Unknown command /compact" })}\n`,
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "opencode",
    tabId: "tab-opencode",
    sessionId: "session-before",
  });

  assert.equal(compacted, false);
  assert.equal(calls.runStreamCalls.length, 1);
  assert.match(calls.appendSystemMessages.at(-1) ?? "", /did not accept the native \/compact command/);
  assert.deepEqual(calls.sendRunStatuses, ["start", "error"]);
  assert.deepEqual(calls.appendCompletionStatuses, ["error"]);
  assert.deepEqual(calls.adoptedSessions, []);
});

test("OpenCode compaction reports provider failure details", async () => {
  const { runContextCompactionWithDeps } = require("../contextCompactionRunner") as typeof import("../contextCompactionRunner");
  const { deps, calls } = createOpenCodeCompactionDeps({
    exitCode: 1,
    stdout: `${JSON.stringify({ type: "error", error: { message: "provider failed", data: { statusCode: 500 } } })}\n`,
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "opencode",
    tabId: "tab-opencode",
    sessionId: "session-before",
  });

  assert.equal(compacted, false);
  assert.match(calls.appendSystemMessages.at(-1) ?? "", /provider failed/);
  assert.deepEqual(calls.sendRunStatuses, ["start", "error"]);
  assert.deepEqual(calls.appendCompletionStatuses, ["error"]);
});
