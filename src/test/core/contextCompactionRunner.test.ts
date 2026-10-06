import test = require("node:test");
import assert = require("node:assert/strict");

import type { ContextCompactionRunDeps } from "../../contextCompactionRunner";
import type { CliName, InteractiveMode, ThinkingMode } from "../../cli/types";

type SilentCodexCompactionOptions = {
  compactThread?: () => Promise<{ compacted: boolean; threadId: string }>;
};

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

function createSilentCodexCompactionDeps(options: SilentCodexCompactionOptions = {}) {
  let activeRunId: string | undefined;
  let activeStop: (() => void) | null = null;
  const calls = {
    sendRunStatuses: [] as Array<{ status: "start" | "end" | "error" | "stopped"; activity?: "contextCompaction" }>,
    appendCompletionMessage: 0,
    persistActiveMessages: 0,
    clearActiveRun: 0,
    appendSystemMessage: 0,
    appendStopMessageToStore: 0,
    killActiveProcess: 0,
    stopAndRebuild: 0,
  };

  const runner = {
    compactThread: options.compactThread ?? (async () => ({ compacted: true, threadId: "thread-after-compact" })),
    stopAndRebuild: () => {
      calls.stopAndRebuild += 1;
    },
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
    appendStopMessageToStore: () => {
      calls.appendStopMessageToStore += 1;
    },
    killActiveProcess: () => {
      calls.killActiveProcess += 1;
    },
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
  triggerStopBeforeError?: boolean;
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
      if (options.triggerStopBeforeError) {
        activeStop?.();
      }
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
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
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

test("silent Codex compaction stops and returns when native compact times out", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { deps, calls } = createSilentCodexCompactionDeps({
    compactThread: () => new Promise(() => {}),
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    silent: true,
    cli: "codex",
    tabId: "tab-1",
    sessionId: "session-1",
    timeoutMs: 10,
  });

  assert.equal(compacted, false);
  assert.deepEqual(calls.sendRunStatuses, [
    { status: "start", activity: "contextCompaction" },
    { status: "stopped", activity: undefined },
  ]);
  assert.equal(calls.appendCompletionMessage, 0);
  assert.equal(calls.persistActiveMessages, 0);
  assert.equal(calls.clearActiveRun, 1);
  assert.equal(calls.appendStopMessageToStore, 1);
  assert.equal(calls.killActiveProcess, 1);
  assert.equal(calls.stopAndRebuild, 1);
  assert.equal(calls.appendSystemMessage, 0);
});

test("OpenCode manual compaction runs native slash command with active session", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
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
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
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

test("OpenCode compaction ignores stale errors after manual stop", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const abortError = new Error("OpenCode run aborted");
  abortError.name = "AbortError";
  const { deps, calls } = createOpenCodeCompactionDeps({
    error: abortError,
    triggerStopBeforeError: true,
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "opencode",
    tabId: "tab-opencode",
    sessionId: "session-before",
  });

  assert.equal(compacted, false);
  assert.deepEqual(calls.sendRunStatuses, ["start", "stopped"]);
  assert.deepEqual(calls.appendCompletionStatuses, ["stopped"]);
  assert.deepEqual(calls.appendSystemMessages, []);
  assert.equal(calls.persistActiveMessages, 1);
  assert.equal(calls.clearActiveRun, 1);
});

test("OpenCode compaction does not run without a resumable session", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { deps, calls } = createOpenCodeCompactionDeps({ currentSessionId: null });

  const compacted = await runContextCompactionWithDeps(deps, { cli: "opencode" });

  assert.equal(compacted, false);
  assert.equal(calls.runStreamCalls.length, 0);
  assert.equal(calls.prepareProfiles.length, 0);
  assert.equal(calls.appendSystemMessagesForCli.length, 1);
});

test("OpenCode compaction reports unsupported slash command clearly", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
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
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
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

test("owned Loop main compaction continues while the primary run reservation is held", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const blocked = createSilentCodexCompactionDeps();
  blocked.deps.hasActiveProcessOrInteractiveStop = () => true;

  const skipped = await runContextCompactionWithDeps(blocked.deps, {
    silent: true,
    cli: "codex",
    tabId: "tab-1",
    sessionId: "session-1",
  });
  assert.equal(skipped, false);
  assert.deepEqual(blocked.calls.sendRunStatuses, []);

  const allowed = createSilentCodexCompactionDeps();
  allowed.deps.hasActiveProcessOrInteractiveStop = () => true;
  let stopReady = false;
  const compacted = await runContextCompactionWithDeps(allowed.deps, {
    silent: true,
    cli: "codex",
    tabId: "tab-1",
    sessionId: "session-1",
    allowActiveRun: true,
    onStopReady: () => {
      stopReady = true;
    },
  });

  assert.equal(compacted, true);
  assert.equal(stopReady, true);
  assert.deepEqual(allowed.calls.sendRunStatuses, [
    { status: "start", activity: "contextCompaction" },
    { status: "end", activity: undefined },
  ]);
});

type StrategySelectionOptions = {
  cli?: CliName;
  currentSessionId?: string | null;
  resolvedSessionId?: string | null | undefined;
  mappedId?: string | null;
  selectedModel?: string | null;
  configId?: string | null;
  compactThread?: () => Promise<{ compacted: boolean; threadId: string }>;
  compactSession?: () => Promise<{ compacted: boolean; sessionId: string | null; previousSessionId: string | null }>;
};

function createStrategySelectionDeps(options: StrategySelectionOptions = {}) {
  const cli = options.cli ?? "codex";
  let activeRunId: string | undefined;
  let activeStop: (() => void) | null = null;
  const currentSessionId = Object.prototype.hasOwnProperty.call(options, "currentSessionId")
    ? options.currentSessionId ?? null
    : "session-1";
  const mappedId = Object.prototype.hasOwnProperty.call(options, "mappedId")
    ? options.mappedId ?? null
    : "mapped-1";
  const selectedModel = Object.prototype.hasOwnProperty.call(options, "selectedModel")
    ? options.selectedModel ?? null
    : " gpt-5 ";
  const configId = Object.prototype.hasOwnProperty.call(options, "configId")
    ? options.configId ?? null
    : " config-codex ";
  const calls = {
    events: [] as string[],
    codexRunnerOptions: [] as Array<Parameters<ContextCompactionRunDeps["interactiveRunnerManager"]["getOrCreateCodexRunner"]>[0]>,
    claudeRunnerOptions: [] as Array<Parameters<ContextCompactionRunDeps["interactiveRunnerManager"]["getOrCreateClaudeRunner"]>[0]>,
    setRunnerCalls: [] as Array<{
      cli: CliName;
      sessionId: string;
      thinkingMode: ThinkingMode;
      interactiveMode: InteractiveMode;
      model: string | null;
      extra?: Parameters<ContextCompactionRunDeps["interactiveRunnerManager"]["setRunner"]>[6];
    }>,
    mappings: [] as Array<{
      cli: CliName;
      localSessionId: string;
      mappedSessionId: string;
      options?: Parameters<ContextCompactionRunDeps["upsertInteractiveMapping"]>[3];
    }>,
    systemMessages: [] as string[],
    systemMessagesForCli: [] as string[],
    processTitles: [] as string[],
    runStreamPrompts: [] as string[],
    sendRunStatuses: [] as Array<{ status: "start" | "end" | "error" | "stopped"; activity?: "contextCompaction" }>,
    appendCompletionStatuses: [] as string[],
    clearActiveRun: 0,
  };

  const deps: ContextCompactionRunDeps = {
    getCurrentCli: () => cli,
    getActiveConversationTabId: () => "tab-1",
    isInteractiveSupported: () => true,
    appendSystemMessageForCli: (_targetCli, _sessionId, content) => {
      calls.systemMessagesForCli.push(content);
    },
    getCurrentSessionId: () => currentSessionId,
    hasActiveProcessOrInteractiveStop: () => false,
    resolveInteractiveSessionForResume: async () => Object.prototype.hasOwnProperty.call(options, "resolvedSessionId")
      ? options.resolvedSessionId
      : currentSessionId,
    resolveWorkspaceCwd: () => "/workspace",
    getActiveConfigIdForCli: () => configId,
    getSelectedCliModel: () => selectedModel,
    getEffectiveThinkingMode: () => "medium" as ThinkingMode,
    getWorkspaceInteractiveMode: () => "coding" as InteractiveMode,
    applyThinkingWorkspaceFiles: () => {},
    getEffectiveCliArgs: () => [],
    getCliCommand: () => cli,
    resolveClaudeInteractiveEntrypoint: () => undefined,
    logCliStartup: () => {},
    loadSessionMessages: () => [],
    createMessageId: () => "run-strategy",
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
    sendRunStatus: (status, _message, statusOptions) => {
      calls.sendRunStatuses.push({ status, activity: statusOptions?.activity });
    },
    appendCompletionMessage: (status) => {
      calls.appendCompletionStatuses.push(status);
    },
    persistActiveMessages: () => {},
    clearActiveRun: () => {
      calls.clearActiveRun += 1;
      activeRunId = undefined;
    },
    interactiveRunnerManager: {
      beginActiveRun: (targetCli, sessionId) => {
        calls.events.push(`begin:${targetCli}:${sessionId}`);
      },
      endActiveRun: (targetCli, sessionId) => {
        calls.events.push(`end:${targetCli}:${sessionId}`);
      },
      getOrCreateCodexRunner: (runnerOptions) => {
        calls.codexRunnerOptions.push(runnerOptions);
        return {
          compactThread: async () => {
            calls.events.push("compact-thread");
            if (options.compactThread) {
              return options.compactThread();
            }
            return { compacted: true, threadId: "thread-after-compact" };
          },
          stopAndRebuild: () => {},
        } as never;
      },
      getOrCreateClaudeRunner: (runnerOptions) => {
        calls.claudeRunnerOptions.push(runnerOptions);
        return {
          compactSession: async () => {
            calls.events.push("compact-session");
            if (options.compactSession) {
              return options.compactSession();
            }
            return {
              compacted: true,
              sessionId: "claude-after",
              previousSessionId: "claude-before",
            };
          },
          stopAndRebuild: () => {},
          runForText: async () => ({ sessionId: mappedId, text: "summary" }),
          runStreamed: async () => {},
          getSessionId: () => mappedId,
          dispose: () => {},
        } as never;
      },
      setRunner: (targetCli, sessionId, _runner, thinkingMode, interactiveMode, model, extra) => {
        calls.events.push(`set-runner:${targetCli}:${sessionId}`);
        calls.setRunnerCalls.push({ cli: targetCli, sessionId, thinkingMode, interactiveMode, model, extra });
      },
    },
    resolveInteractiveMappedId: () => mappedId,
    appendSystemMessage: (content) => {
      calls.systemMessages.push(content);
    },
    getGlobalMultiAgentEnabled: () => false,
    upsertInteractiveMapping: (targetCli, localSessionId, mappedSessionId, mappingOptions) => {
      calls.events.push(`map:${targetCli}:${localSessionId}:${mappedSessionId}`);
      calls.mappings.push({ cli: targetCli, localSessionId, mappedSessionId, options: mappingOptions });
    },
    sendRawStreamDelta: () => {},
    sendPanelMessage: () => {},
    updateProcessTitle: (targetCli, sessionId) => {
      calls.processTitles.push(`${targetCli}:${sessionId}`);
    },
    appendTraceMessage: () => {},
    prepareGeminiRunProfile: (model) => ({ runtimeModel: model }),
    setActiveProcess: () => {},
    appendAssistantChunk: () => {},
    adoptSessionId: () => {},
    runCliStream: ((_targetCli, prompt) => {
      calls.runStreamPrompts.push(prompt);
      return { pid: 1, resolvedCommand: cli, kill: () => true };
    }) as NonNullable<ContextCompactionRunDeps["runCliStream"]>,
  };

  return { deps, calls };
}

test("context compaction strategy registry selects Codex and preserves selection lifecycle", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { deps, calls } = createStrategySelectionDeps({ cli: "codex" });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "codex",
    tabId: "tab-1",
    sessionId: "session-1",
  });

  assert.equal(compacted, true);
  assert.deepEqual(calls.events, [
    "begin:codex:session-1",
    "compact-thread",
    "map:codex:session-1:thread-after-compact",
    "set-runner:codex:session-1",
    "end:codex:session-1",
  ]);
  assert.equal(calls.claudeRunnerOptions.length, 0);
  assert.deepEqual(calls.runStreamPrompts, []);
  assert.deepEqual(calls.codexRunnerOptions, [{
    sessionId: "session-1",
    threadId: "mapped-1",
    command: "codex",
    args: [],
    cwd: "/workspace",
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: "gpt-5",
    configId: "config-codex",
    multiAgentEnabled: false,
  }]);
  assert.deepEqual(calls.mappings, [{
    cli: "codex",
    localSessionId: "session-1",
    mappedSessionId: "thread-after-compact",
    options: {
      freezePrevious: "mapped-1",
      codexSelection: { configId: "config-codex", model: "gpt-5" },
    },
  }]);
  assert.deepEqual(calls.setRunnerCalls, [{
    cli: "codex",
    sessionId: "session-1",
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: "gpt-5",
    extra: { multiAgentEnabled: false, configId: "config-codex" },
  }]);
  assert.deepEqual(calls.systemMessages, ["Codex 当前线程上下文压缩已完成：thread-after-compact"]);
  assert.deepEqual(calls.sendRunStatuses, [
    { status: "start", activity: "contextCompaction" },
    { status: "end", activity: undefined },
  ]);
  assert.deepEqual(calls.appendCompletionStatuses, ["end"]);
  assert.equal(calls.clearActiveRun, 1);
});

test("context compaction strategy registry selects Claude native compaction", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { deps, calls } = createStrategySelectionDeps({ cli: "claude" });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "claude",
    tabId: "tab-claude",
    sessionId: "session-1",
  });

  assert.equal(compacted, true);
  assert.deepEqual(calls.events, [
    "begin:claude:session-1",
    "compact-session",
    "end:claude:session-1",
    "map:claude:session-1:claude-after",
    "set-runner:claude:session-1",
  ]);
  assert.equal(calls.codexRunnerOptions.length, 0);
  assert.deepEqual(calls.runStreamPrompts, []);
  assert.equal(calls.claudeRunnerOptions.length, 1);
  assert.equal(calls.claudeRunnerOptions[0]?.sessionId, "session-1");
  assert.equal(calls.claudeRunnerOptions[0]?.mappedSessionId, "mapped-1");
  assert.equal(calls.claudeRunnerOptions[0]?.model, " gpt-5 ");
  assert.equal(calls.claudeRunnerOptions[0]?.entrypoint, undefined);
  assert.deepEqual(calls.mappings, [{
    cli: "claude",
    localSessionId: "session-1",
    mappedSessionId: "claude-after",
    options: { freezePrevious: "claude-before" },
  }]);
  assert.deepEqual(calls.setRunnerCalls, [{
    cli: "claude",
    sessionId: "session-1",
    thinkingMode: "medium",
    interactiveMode: "coding",
    model: " gpt-5 ",
    extra: undefined,
  }]);
  assert.deepEqual(calls.processTitles, ["claude:claude-after"]);
  assert.deepEqual(calls.systemMessages, ["Claude 上下文压缩已完成：claude-before -> claude-after"]);
  assert.deepEqual(calls.appendCompletionStatuses, ["end"]);
});

test("Codex strategy returns false when the mapped thread is missing", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { deps, calls } = createStrategySelectionDeps({ cli: "codex", mappedId: null });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "codex",
    tabId: "tab-1",
    sessionId: "session-1",
  });

  assert.equal(compacted, false);
  assert.deepEqual(calls.events, []);
  assert.deepEqual(calls.codexRunnerOptions, []);
  assert.deepEqual(calls.systemMessages, ["当前会话尚未建立，无法压缩。"]);
  assert.deepEqual(calls.systemMessagesForCli, []);
  assert.deepEqual(calls.sendRunStatuses, [
    { status: "start", activity: "contextCompaction" },
    { status: "end", activity: undefined },
  ]);
  assert.deepEqual(calls.appendCompletionStatuses, ["end"]);
  assert.equal(calls.clearActiveRun, 1);
});

test("context compaction does not select a strategy without a recoverable session", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { deps, calls } = createStrategySelectionDeps({
    cli: "claude",
    resolvedSessionId: undefined,
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "claude",
    tabId: "tab-claude",
    sessionId: "session-1",
  });

  assert.equal(compacted, false);
  assert.deepEqual(calls.events, []);
  assert.deepEqual(calls.claudeRunnerOptions, []);
  assert.deepEqual(calls.codexRunnerOptions, []);
  assert.deepEqual(calls.runStreamPrompts, []);
  assert.deepEqual(calls.systemMessages, []);
  assert.deepEqual(calls.systemMessagesForCli, []);
  assert.deepEqual(calls.sendRunStatuses, []);
  assert.equal(calls.clearActiveRun, 0);
});

test("Codex strategy failure keeps orchestration error handling", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { deps, calls } = createStrategySelectionDeps({
    cli: "codex",
    compactThread: async () => {
      throw new Error("codex compact failed");
    },
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "codex",
    tabId: "tab-1",
    sessionId: "session-1",
  });

  assert.equal(compacted, false);
  assert.deepEqual(calls.events, [
    "begin:codex:session-1",
    "compact-thread",
    "end:codex:session-1",
  ]);
  assert.deepEqual(calls.mappings, []);
  assert.deepEqual(calls.setRunnerCalls, []);
  assert.deepEqual(calls.systemMessages, ["上下文压缩失败（执行异常），未进行会话切换。"]);
  assert.deepEqual(calls.sendRunStatuses, [
    { status: "start", activity: "contextCompaction" },
    { status: "error", activity: undefined },
  ]);
  assert.deepEqual(calls.appendCompletionStatuses, ["error"]);
  assert.equal(calls.clearActiveRun, 1);
});

test("OpenCode strategy selection still runs native compact without runner fallback", async () => {
  const { runContextCompactionWithDeps } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  const { deps, calls } = createOpenCodeCompactionDeps({
    stdout: `${JSON.stringify({ type: "assistant", sessionID: "session-after", text: "Compacted current session" })}\n`,
  });

  const compacted = await runContextCompactionWithDeps(deps, {
    cli: "opencode",
    tabId: "tab-opencode",
    sessionId: "session-before",
  });

  assert.equal(compacted, true);
  assert.equal(calls.runStreamCalls.length, 1);
  assert.equal(calls.runStreamCalls[0]?.prompt, "/compact");
  assert.equal(calls.runStreamCalls[0]?.sessionId, "session-before");
  assert.equal(calls.runStreamCalls[0]?.model, "primary/model");
  assert.deepEqual(calls.prepareProfiles, [{
    selectedModel: "stored/model",
    cwd: "/workspace",
    cli: "opencode",
  }]);
  assert.deepEqual(calls.adoptedSessions, [{ cli: "opencode", sessionId: "session-after", tabId: "tab-opencode" }]);
  assert.deepEqual(calls.appendSystemMessages, [
    "OpenCode context compaction completed for current session: session-after",
  ]);
  assert.deepEqual(calls.sendRunStatuses, ["start", "end"]);
  assert.deepEqual(calls.appendCompletionStatuses, ["end"]);
  assert.deepEqual(calls.activeProcessStates, ["set", "clear"]);
});
