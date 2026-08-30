import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");

import { createLoopOrchestrationHost } from "../../extensionHost/loopOrchestration";
import {
  createDisabledOpenCodeSubagentMonitor,
  createOpenCodeSubagentRuntimePreparer,
  type OpenCodeSubagentRuntimeDeps,
} from "../../extensionHost/openCodeSubagentRuntime";
import { createPromptParallelRuntimeHost } from "../../extensionHost/promptParallelRuntime";
import type { OpenCodeRuntimePreparation } from "../../extensionHost/promptExecutionShared";

function readSource(...relativePath: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...relativePath), "utf8");
}

function createOpenCodeRuntimePreparation(
  overrides: Partial<OpenCodeRuntimePreparation> = {},
): OpenCodeRuntimePreparation {
  return {
    envOverrides: {},
    configContent: "{}",
    role: "main",
    mainModel: "provider/main",
    subtaskModel: "provider/subtask",
    effectiveModel: "provider/main",
    mainVariant: "balanced",
    subtaskVariant: "fast",
    effectiveVariant: "balanced",
    modelFallback: "none",
    primaryModel: "provider/main",
    smallModel: "provider/subtask",
    primaryVariant: "balanced",
    smallVariant: "fast",
    ...overrides,
  };
}

function createOpenCodeSubagentRuntimeDeps(
  overrides: Partial<OpenCodeSubagentRuntimeDeps> = {},
): OpenCodeSubagentRuntimeDeps {
  return {
    getOpenCodeCliArgs: () => [],
    resolveConnection: async () => ({
      serverUrl: "http://127.0.0.1:4096",
    }),
    startServer: () => ({
      pid: 1,
      kill: () => undefined,
    }),
    waitForServerReady: async () => undefined,
    buildServerProcessLabel: (runId) => `opencode-${runId}-server`,
    getDefaultDirectory: () => process.cwd(),
    logDebug: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
    ...overrides,
  };
}

test("extension delegates Loop, parallel, one-shot, and interactive prompt runtime wiring to extensionHost hosts", () => {
  const extensionSource = readSource("src", "extension.ts");

  assert.match(extensionSource, /from "\.\/extensionHost\/loopOrchestration"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/promptParallelRuntime"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/promptOneShotRuntime"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/promptInteractiveRuntime"/);
  assert.match(extensionSource, /loopOrchestrationHost = createLoopOrchestrationHost\(\{/);
  assert.match(extensionSource, /const \{ runPromptParallel \} = createPromptParallelRuntimeHost\(\{/);
  assert.match(extensionSource, /const \{ runPromptOneShot \} = createPromptOneShotRuntimeHost\(\{/);
  assert.match(extensionSource, /const \{ runPromptInteractive \} = createPromptInteractiveRuntimeHost\(\{/);
  assert.match(extensionSource, /function runClassicLoopMainDecision\([\s\S]*requireLoopOrchestrationHost\(\)\.runClassicLoopMainDecision/);
  assert.match(extensionSource, /function runLoopSubtasksBatchWithRetry\([\s\S]*requireLoopOrchestrationHost\(\)\.runLoopSubtasksBatchWithRetry/);
  assert.match(extensionSource, /await runPromptOneShot\(promptInput, target, executionOptions\);/);
  assert.match(extensionSource, /await runPromptInteractive\(promptInput, target, executionOptions\);/);
  assert.doesNotMatch(extensionSource, /async function runPromptInteractive\(/);
});

test("keeps a persisted running Loop main task stoppable without a direct runner", () => {
  const extensionSource = readSource("src", "extension.ts");

  assert.match(
    extensionSource,
    /const loopContext = tab \? resolveConversationTabLoopContext\(tab\) : null;[\s\S]*const loopTaskId = loopContext\?\.taskRole === "main"[\s\S]*readLoopTaskRecord\(loopTaskId\)\?\.status === "running"/,
  );
  assert.match(
    extensionSource,
    /if \(loopTaskId && readLoopTaskRecord\(loopTaskId\)\?\.status === "running"\) \{[\s\S]*stopLoopRunsForTask\(loopTaskId\);[\s\S]*markLoopTaskStoppedByUser\(loopTaskId\);[\s\S]*void postPanelState\(\);/,
  );
});

test("OpenCode subagent runtime keeps the host source canonical and the extension as composition root", () => {
  const extensionSource = readSource("src", "extension.ts");
  const runtimeSource = readSource("src", "extensionHost", "openCodeSubagentRuntime.ts");

  assert.match(extensionSource, /from "\.\/extensionHost\/openCodeSubagentRuntime"/);
  assert.match(extensionSource, /const prepareOpenCodeSubagentRuntime = createOpenCodeSubagentRuntimePreparer\(\{/);
  assert.match(extensionSource, /getOpenCodeCliArgs: \(\) => getCliArgs\("opencode"\)/);
  assert.match(extensionSource, /resolveConnection: resolveOpenCodeSubagentConnection/);
  assert.match(
    extensionSource,
    /startServer: \(port, handlers, options\) => startOpenCodeServer\(port, handlers, options\)/,
  );
  assert.match(extensionSource, /waitForServerReady: waitForOpenCodeServerReady/);
  assert.match(extensionSource, /createDisabledOpenCodeSubagentMonitor,/);
  assert.doesNotMatch(extensionSource, /async function prepareOpenCodeSubagentRuntime\(/);
  assert.doesNotMatch(extensionSource, /function createDisabledOpenCodeSubagentMonitor\(/);

  assert.match(
    runtimeSource,
    /export function createOpenCodeSubagentRuntimePreparer\(\s*deps: OpenCodeSubagentRuntimeDeps/,
  );
  assert.match(runtimeSource, /export function createDisabledOpenCodeSubagentMonitor\(\)/);
  assert.match(runtimeSource, /function applyBasicAuthEnvOverrides\(/);
  assert.match(runtimeSource, /const managedServerEnvOverrides = applyBasicAuthEnvOverrides\(/);
  assert.match(runtimeSource, /const serverLifecycleFailure = new Promise<never>/);
  assert.match(runtimeSource, /await Promise\.race\(\[/);
  assert.match(runtimeSource, /endpointSource: "configured-attach"/);
  assert.match(runtimeSource, /endpointSource: "managed-server"/);
  assert.match(runtimeSource, /endpointSource: "unavailable"/);
});

test("OpenCode subagent runtime preserves configured attach without starting a managed server", async () => {
  const connection = {
    serverUrl: "http://127.0.0.1:4096",
    authorization: "Basic dXNlcjpwYXNz",
  };
  let startServerCalls = 0;
  const prepareOpenCodeSubagentRuntime = createOpenCodeSubagentRuntimePreparer(
    createOpenCodeSubagentRuntimeDeps({
      resolveConnection: async () => connection,
      startServer: () => {
        startServerCalls += 1;
        return { pid: 1, kill: () => undefined };
      },
    }),
  );

  const result = await prepareOpenCodeSubagentRuntime({
    cwd: undefined,
    runId: "attach-run",
    runtime: createOpenCodeRuntimePreparation(),
  });

  assert.equal(result.connection, connection);
  assert.equal(result.endpointSource, "configured-attach");
  assert.equal(result.error, null);
  assert.equal(startServerCalls, 0);
  result.dispose();
});

test("disabled OpenCode subagent monitor keeps optional monitoring calls as no-ops", async () => {
  const monitor = createDisabledOpenCodeSubagentMonitor();

  assert.equal(monitor.setParentSessionId("parent-session"), undefined);
  await monitor.pollNow();
  assert.equal(monitor.finish("completed"), undefined);
  assert.equal(monitor.dispose(), undefined);
});

test("OpenCode subagent runtime starts, configures, and idempotently disposes a managed server", async () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const runtime = createOpenCodeRuntimePreparation({
    envOverrides: { EXISTING: "value" },
    configContent: "{\"model\":\"provider/main\"}",
  });
  let startedPort: number | null = null;
  let startedModel: string | null = null;
  let startedSmallModel: string | null = null;
  let startedProcessLabel: string | null = null;
  let startedEnvOverrides: Record<string, string> | null = null;
  let readyDirectory: string | null = null;
  let killCount = 0;

  const prepareOpenCodeSubagentRuntime = createOpenCodeSubagentRuntimePreparer(
    createOpenCodeSubagentRuntimeDeps({
      getOpenCodeCliArgs: () => ["run", "--port=4097"],
      resolveConnection: async () => ({
        serverUrl: "http://127.0.0.1:4097",
        serverPort: 4097,
        authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`,
      }),
      startServer: (port, _handlers, options) => {
        startedPort = port;
        startedModel = options.model ?? null;
        startedSmallModel = options.openCodeSmallModel ?? null;
        startedProcessLabel = options.processLabel ?? null;
        startedEnvOverrides = options.envOverrides ?? null;
        return {
          pid: 42,
          kill: () => {
            killCount += 1;
          },
        };
      },
      waitForServerReady: async (_connection, directory) => {
        readyDirectory = directory;
      },
      buildServerProcessLabel: (runId) => `server-for-${runId}`,
      logDebug: (event, payload) => logs.push({ event, payload }),
      logInfo: (event, payload) => logs.push({ event, payload }),
      logError: (event, payload) => logs.push({ event, payload }),
    }),
  );

  const result = await prepareOpenCodeSubagentRuntime({
    cwd: "/tmp/opencode-workspace",
    runId: "managed-run",
    runtime,
    isolateProjectInstructions: true,
  });

  assert.equal(result.endpointSource, "managed-server");
  assert.equal(result.error, null);
  assert.equal(startedPort, 4097);
  assert.equal(startedModel, "provider/main");
  assert.equal(startedSmallModel, "provider/subtask");
  assert.equal(startedProcessLabel, "server-for-managed-run");
  assert.deepEqual(startedEnvOverrides, {
    EXISTING: "value",
    OPENCODE_SERVER_USERNAME: "user",
    OPENCODE_SERVER_PASSWORD: "pass",
  });
  assert.equal(readyDirectory, "/tmp/opencode-workspace");
  assert.ok(logs.some(({ event }) => event === "opencode-subagent-server-ready"));

  result.dispose();
  result.dispose();
  assert.equal(killCount, 1);
});

test("OpenCode subagent runtime reports startup failures and kills the managed process", async () => {
  const startupError = new Error("server readiness failed");
  let killCount = 0;
  const prepareOpenCodeSubagentRuntime = createOpenCodeSubagentRuntimePreparer(
    createOpenCodeSubagentRuntimeDeps({
      resolveConnection: async () => ({
        serverUrl: "http://127.0.0.1:4098",
        serverPort: 4098,
      }),
      startServer: () => ({
        pid: 43,
        kill: () => {
          killCount += 1;
        },
      }),
      waitForServerReady: async () => {
        throw startupError;
      },
    }),
  );

  const result = await prepareOpenCodeSubagentRuntime({
    cwd: "/tmp/opencode-workspace",
    runId: "failed-run",
    runtime: createOpenCodeRuntimePreparation(),
  });

  assert.equal(result.connection, null);
  assert.equal(result.endpointSource, "unavailable");
  assert.equal(result.error, startupError);
  assert.equal(killCount, 1);
  result.dispose();
});

test("Loop orchestration source contract lives in extensionHost/loopOrchestration", () => {
  const loopOrchestrationSource = readSource("src", "extensionHost", "loopOrchestration.ts");

  assert.match(loopOrchestrationSource, /export function createLoopOrchestrationHost\(deps: LoopOrchestrationHostDeps\)/);
  assert.match(loopOrchestrationSource, /async function runClassicLoopMainDecision\(/);
  assert.match(loopOrchestrationSource, /async function runLoopDebateRound\(/);
  assert.match(loopOrchestrationSource, /async function runLoopSubtasksBatchWithRetry\(/);
  assert.match(loopOrchestrationSource, /async function runLoopSubtaskWithRetry\(/);
  assert.match(loopOrchestrationSource, /function buildLoopSubtaskModelPrompt\(/);
  assert.match(loopOrchestrationSource, /return \{[\s\S]*runClassicLoopMainDecision[\s\S]*runLoopDebateRound[\s\S]*runLoopSubtasksBatchWithRetry/);
});

test("Loop orchestration host exposes small helpers through the injected host boundary", () => {
  const errors: unknown[] = [];
  const host = createLoopOrchestrationHost({
    logError: (_event: string, payload: unknown) => {
      errors.push(payload);
    },
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-orchestration-host-"));
  const filePath = path.join(tempDir, "nested", "artifact.md");
  try {
    assert.deepEqual(host.appendLoopSupplementalRequirement([" keep ", "", "existing"], " next "), [
      "keep",
      "existing",
      " next ",
    ]);
    assert.equal(host.writeTextFileEnsuringDir(filePath, " first "), true);
    assert.equal(host.readTextFileIfNonEmpty(filePath), "first");
    assert.equal(host.appendTextFileEnsuringDir(filePath, "\nsecond"), true);
    assert.equal(host.readTextFileIfNonEmpty(filePath), "first \nsecond");
    assert.deepEqual(errors, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parallel prompt runtime host keeps unsupported and empty prompts inside its boundary", async () => {
  const { runPromptParallel } = createPromptParallelRuntimeHost({});

  await runPromptParallel(
    { displayPrompt: "", modelPrompt: "", contextTags: [] },
    { tabId: "tab-1", cli: "opencode", sessionId: null },
  );
  await assert.rejects(
    runPromptParallel(
      { displayPrompt: "run", modelPrompt: "run", contextTags: [] },
      { tabId: "tab-1", cli: "codex", sessionId: null },
    ),
    /parallel-run-unsupported:codex/,
  );
});

test("one-shot prompt runtime source contract lives in extensionHost/promptOneShotRuntime", () => {
  const oneShotRuntimeSource = readSource("src", "extensionHost", "promptOneShotRuntime.ts");

  assert.match(oneShotRuntimeSource, /export function createPromptOneShotRuntimeHost\(deps: PromptOneShotRuntimeHostDeps\)/);
  assert.match(oneShotRuntimeSource, /async function runPromptOneShot\(/);
  assert.match(oneShotRuntimeSource, /function appendOpenCodeJsonlEvents\(/);
  assert.match(oneShotRuntimeSource, /function flushOpenCodeJsonlBuffer\(/);
  assert.match(oneShotRuntimeSource, /function appendOpenCodeVisibleEvent\(/);
  assert.match(oneShotRuntimeSource, /buildOpenCodeOneShotStartupTimeoutMessage/);
  assert.match(oneShotRuntimeSource, /clearActiveRun:\s*clearPrimaryActiveRun/);
  assert.match(oneShotRuntimeSource, /const clearActiveRun = \(\): void => \{[\s\S]*clearPrimaryActiveRun\(\);/);
  assert.doesNotMatch(oneShotRuntimeSource, /clearActiveRun:\s*clearActiveRun/);
});

test("interactive prompt runtime source contract lives in extensionHost/promptInteractiveRuntime", () => {
  const interactiveRuntimeSource = readSource("src", "extensionHost", "promptInteractiveRuntime.ts");

  assert.match(interactiveRuntimeSource, /export function createPromptInteractiveRuntimeHost\(deps: PromptInteractiveRuntimeHostDeps\)/);
  assert.match(interactiveRuntimeSource, /async function runPromptInteractive\(/);
  assert.match(interactiveRuntimeSource, /rawStdout = appendBoundedUtf8Text\(rawStdout, chunk, AI_TASK_RAW_OUTPUT_MAX_BYTES\)\.text/);
  assert.match(interactiveRuntimeSource, /rawStderr = appendBoundedUtf8Text\(rawStderr, normalized, AI_TASK_RAW_OUTPUT_MAX_BYTES\)\.text/);
  assert.match(interactiveRuntimeSource, /const appendMessageForTab = \(message: ChatMessage\): void => \{[\s\S]*schedulePersistForInteractiveRun\(\);/);
  assert.match(interactiveRuntimeSource, /const flushPersistForInteractiveRun = \(\): void => \{[\s\S]*persistMessagesForInteractiveRun\(\);/);
  assert.match(interactiveRuntimeSource, /const stopFn = \(\): void => \{[\s\S]*sendRunStatusForTab\(tabId, "stopped"\)/);
  assert.match(interactiveRuntimeSource, /interactiveRunsByTabId\.set\(tabId, \{/);
  assert.match(interactiveRuntimeSource, /onAssistantDelta: \(chunk, meta\) => \{[\s\S]*codexFinalAnswer: meta\?\.codexFinalAnswer === true/);
  assert.match(interactiveRuntimeSource, /onTrace: \(content, kind, meta\) => \{[\s\S]*appendTraceMessageForTab\(content, kind === "thinking" \? "thinking" : "normal", meta\)/);
  assert.match(interactiveRuntimeSource, /onEvent: \(event\) => \{[\s\S]*type: "rawStreamDelta"[\s\S]*extractTaskListItemsFromForwardedCodexEvent/);
  assert.match(interactiveRuntimeSource, /onTaskListUpdate: \(items\) => \{[\s\S]*type: "taskListUpdate"/);
  assert.match(interactiveRuntimeSource, /onThreadId: \(threadId\) => \{[\s\S]*updateSessionForNewRun\(threadId/);
  assert.match(interactiveRuntimeSource, /onSessionId: \(newSessionId: string\) => \{[\s\S]*updateSessionForNewRun\(newSessionId\)/);
  assert.match(interactiveRuntimeSource, /return \{ runPromptInteractive \};/);
});
