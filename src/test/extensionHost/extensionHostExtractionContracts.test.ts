import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import ts = require("typescript");

import { createLoopOrchestrationHost } from "../../extensionHost/loopOrchestration";
import {
  createDisabledOpenCodeSubagentMonitor,
  createOpenCodeSubagentRuntimePreparer,
  type OpenCodeSubagentRuntimeDeps,
} from "../../extensionHost/openCodeSubagentRuntime";
import { createPromptParallelRuntimeHost } from "../../extensionHost/promptParallelRuntime";
import type { OpenCodeRuntimePreparation } from "../../extensionHost/promptExecutionShared";
import { attachConversationTabLoopSchedulingMode } from "../../sessionTabs";
import type { ConversationTabSummary } from "../../webview/types";

function readSource(...relativePath: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...relativePath), "utf8");
}

function parseTypeScript(fileName: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function findFunctionByName(root: ts.Node, name: string): ts.FunctionDeclaration | undefined {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (declaration) {
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return declaration;
}

function requireFunction(root: ts.Node, name: string, label: string): ts.FunctionDeclaration {
  const declaration = findFunctionByName(root, name);
  if (!declaration) {
    assert.fail(`${label} is missing function ${name}`);
  }
  return declaration;
}

function isIdentifierCall(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === name;
}

function hasIdentifierCall(root: ts.Node, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (isIdentifierCall(node, name)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function hasMethodCallOnIdentifierCall(root: ts.Node, calleeName: string, methodName: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === methodName
      && isIdentifierCall(node.expression.expression, calleeName)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function isTaskCliAccess(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node)
    && node.name.text === "cli"
    && ts.isIdentifier(node.expression)
    && node.expression.text === "task";
}

function referencesInteractiveMode(expression: ts.Expression, mode: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      const leftIsMode = ts.isPropertyAccessExpression(node.left) && node.left.name.text === "interactiveMode";
      const rightIsMode = ts.isPropertyAccessExpression(node.right) && node.right.name.text === "interactiveMode";
      const leftIsLiteral = ts.isStringLiteral(node.left) && node.left.text === mode;
      const rightIsLiteral = ts.isStringLiteral(node.right) && node.right.text === mode;
      if ((leftIsMode && rightIsLiteral) || (rightIsMode && leftIsLiteral)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function assertScheduledTaskPrefersTaskConfig(executeScheduled: ts.FunctionDeclaration): void {
  let matched = false;
  const visit = (node: ts.Node): void => {
    if (matched || !isIdentifierCall(node, "resolveScheduledTaskExecutionConfigForTask")) {
      ts.forEachChild(node, visit);
      return;
    }
    const [taskArgument, interactiveArgument, loopModeArgument, ...rest] = node.arguments;
    matched = rest.length === 0
      && !!taskArgument
      && ts.isIdentifier(taskArgument)
      && taskArgument.text === "task"
      && !!interactiveArgument
      && isIdentifierCall(interactiveArgument, "getWorkspaceInteractiveMode")
      && interactiveArgument.arguments.length === 1
      && isTaskCliAccess(interactiveArgument.arguments[0])
      && !!loopModeArgument
      && isIdentifierCall(loopModeArgument, "getWorkspaceLoopExecutionMode")
      && loopModeArgument.arguments.length === 1
      && isTaskCliAccess(loopModeArgument.arguments[0]);
    if (!matched) {
      ts.forEachChild(node, visit);
    }
  };
  visit(executeScheduled);
  assert.equal(matched, true, "scheduled execution must resolve the task config before workspace fallbacks");
}

function assertScheduledModeDispatch(executeScheduled: ts.FunctionDeclaration): void {
  let loopBranch: ts.IfStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (loopBranch) {
      return;
    }
    if (
      ts.isIfStatement(node)
      && referencesInteractiveMode(node.expression, "loop")
      && referencesInteractiveMode(node.expression, "loop_plus")
    ) {
      loopBranch = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(executeScheduled);
  if (!loopBranch) {
    assert.fail("scheduled execution is missing the loop/loop_plus branch");
  }
  assert.equal(hasIdentifierCall(loopBranch.thenStatement, "schedulingModeForInteractiveMode"), true);
  assert.equal(hasIdentifierCall(loopBranch.thenStatement, "runLoopPrompt"), true);
  assert.equal(hasIdentifierCall(loopBranch.thenStatement, "runGraphPrompt"), false);
  const graphBranch = loopBranch.elseStatement;
  if (!graphBranch || !ts.isIfStatement(graphBranch)) {
    assert.fail("scheduled graph branch must stay on the loop else-if");
  }
  assert.equal(referencesInteractiveMode(graphBranch.expression, "graph"), true);
  assert.equal(hasIdentifierCall(graphBranch.thenStatement, "runGraphPrompt"), true);
  assert.equal(hasIdentifierCall(graphBranch.thenStatement, "runLoopPrompt"), false);
  if (!graphBranch.elseStatement) {
    assert.fail("scheduled non-loop/non-graph execution must keep the default prompt branch");
  }
  assert.equal(hasIdentifierCall(graphBranch.elseStatement, "runPrompt"), true);
}

function assertLoopPlusOrchestrationChain(extensionFile: ts.SourceFile, adapterFile: ts.SourceFile): void {
  const runtimeAdapter = requireFunction(extensionFile, "getLoopPlusRuntimeAdapter", "extension.ts");
  assert.equal(hasIdentifierCall(runtimeAdapter, "createLoopPlusRuntimeAdapter"), true);
  const orchestrationAccessor = requireFunction(extensionFile, "getLoopPlusOrchestrationHost", "extension.ts");
  assert.equal(
    hasMethodCallOnIdentifierCall(orchestrationAccessor, "getLoopPlusRuntimeAdapter", "host"),
    true,
  );
  const eventDrivenPrompt = requireFunction(extensionFile, "runEventDrivenLoopPrompt", "extension.ts");
  assert.equal(
    hasMethodCallOnIdentifierCall(eventDrivenPrompt, "getLoopPlusRuntimeAdapter", "runEventDriven"),
    true,
  );
  const loopOrchestration = requireFunction(extensionFile, "runLoopPromptOrchestration", "extension.ts");
  assert.equal(hasIdentifierCall(loopOrchestration, "runEventDrivenLoopPrompt"), true);

  const adapterFactory = requireFunction(adapterFile, "createLoopPlusRuntimeAdapter", "loopPlusRuntimeAdapter.ts");
  const adapterHost = requireFunction(adapterFactory, "host", "loopPlusRuntimeAdapter.ts");
  assert.equal(hasIdentifierCall(adapterHost, "createLoopPlusOrchestrationHost"), true);
  const adapterRun = requireFunction(adapterFactory, "runEventDriven", "loopPlusRuntimeAdapter.ts");
  assert.equal(hasMethodCallOnIdentifierCall(adapterRun, "host", "tryRun"), true);
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

test("scheduled tasks resolve their execution mode from the selected task config", () => {
  const extensionSource = readSource("src", "extension.ts");

  assert.match(
    extensionSource,
    /const executionConfig = resolveScheduledTaskExecutionConfigForTask\(\s*task,\s*getWorkspaceInteractiveMode\(task\.cli\),\s*getWorkspaceLoopExecutionMode\(task\.cli\),/,
  );
  assert.match(extensionSource, /const modelPrompt = executionConfig\.interactiveMode === "graph"/);
  assert.match(extensionSource, /if \(executionConfig\.interactiveMode === "loop" \|\| executionConfig\.interactiveMode === "loop_plus"\)/);
  assert.match(extensionSource, /else if \(executionConfig\.interactiveMode === "graph"\)/);
  assert.match(extensionSource, /runEventDrivenLoopPrompt/);
  const extensionFile = parseTypeScript("extension.ts", extensionSource);
  const adapterFile = parseTypeScript(
    "loopPlusRuntimeAdapter.ts",
    readSource("src", "extensionHost", "loopPlusRuntimeAdapter.ts"),
  );
  const executeScheduled = requireFunction(extensionFile, "executeScheduledTask", "extension.ts");
  assertScheduledTaskPrefersTaskConfig(executeScheduled);
  assertScheduledModeDispatch(executeScheduled);
  assertLoopPlusOrchestrationChain(extensionFile, adapterFile);
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
  assert.equal(killCount, 0);
  assert.equal(prepareOpenCodeSubagentRuntime.countAlive(), 1);

  prepareOpenCodeSubagentRuntime.dispose();
  assert.equal(killCount, 1);
  assert.equal(prepareOpenCodeSubagentRuntime.countAlive(), 0);
});

test("OpenCode long connection reuses one server and only closes it from the pool", async () => {
  let startCount = 0;
  let killCount = 0;
  const prepareOpenCodeSubagentRuntime = createOpenCodeSubagentRuntimePreparer(
    createOpenCodeSubagentRuntimeDeps({
      getOpenCodeCliArgs: () => ["serve"],
      resolveConnection: async () => ({
        serverUrl: "http://127.0.0.1:4101",
        serverPort: 4101,
      }),
      startServer: () => {
        startCount += 1;
        return {
          pid: 77,
          kill: () => {
            killCount += 1;
          },
        };
      },
    }),
  );

  const first = await prepareOpenCodeSubagentRuntime({
    cwd: "/tmp/opencode-workspace",
    runId: "run-1",
    runtime: createOpenCodeRuntimePreparation(),
  });
  first.dispose();
  const second = await prepareOpenCodeSubagentRuntime({
    cwd: "/tmp/opencode-workspace",
    runId: "run-2",
    runtime: createOpenCodeRuntimePreparation(),
  });

  assert.equal(startCount, 1);
  assert.equal(killCount, 0);
  assert.equal(second.connection?.serverUrl, "http://127.0.0.1:4101");
  assert.equal(prepareOpenCodeSubagentRuntime.countAlive(), 1);
  second.dispose();
  assert.equal(killCount, 0);

  const switched = await prepareOpenCodeSubagentRuntime({
    cwd: "/tmp/opencode-workspace",
    runId: "run-3",
    runtime: createOpenCodeRuntimePreparation({ effectiveModel: "provider/other" }),
  });
  assert.equal(startCount, 2);
  assert.equal(killCount, 1);
  switched.dispose();
  prepareOpenCodeSubagentRuntime.dispose();
  assert.equal(killCount, 2);
  assert.equal(prepareOpenCodeSubagentRuntime.countAlive(), 0);
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
  assert.match(interactiveRuntimeSource, /onTokenUsageUpdate: \(update\) => \{[\s\S]*type: "contextTokenUsage"/);
  assert.match(interactiveRuntimeSource, /onThreadId: \(threadId\) => \{[\s\S]*updateSessionForNewRun\(threadId/);
  assert.match(interactiveRuntimeSource, /onSessionId: \(newSessionId: string\) => \{[\s\S]*updateSessionForNewRun\(newSessionId\)/);
  assert.match(interactiveRuntimeSource, /return \{ runPromptInteractive \};/);
});

test("conversation tab summaries carry the persisted Loop scheduling mode", () => {
  const summary: ConversationTabSummary = attachConversationTabLoopSchedulingMode({
    id: "tab-1",
    cli: "codex",
    sessionId: null,
    createdAt: 1,
    loopTaskRole: "main",
    loopTaskId: "task-1",
  }, undefined);
  assert.equal(summary.loopSchedulingMode, "classic");
  const eventDriven: ConversationTabSummary = {
    ...summary,
    loopSchedulingMode: "event_driven",
  };
  assert.equal(eventDriven.loopSchedulingMode, "event_driven");
  const hostSource = readSource("src", "extensionHost", "sessionTabs.ts");
  assert.equal(hostSource.includes("readLoopTaskRecord(summary.loopTaskId)?.schedulingMode"), true);
  assert.equal(hostSource.includes("attachConversationTabLoopSchedulingMode("), true);
});
