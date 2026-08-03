import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";

import type { GraphNodeRecord, GraphRunRecord } from "../graph/types";
import type { GraphMessagesHost } from "../extensionHost/graphMessages";
import type {
  GraphRuntimeHostDeps,
  PromptRunInput,
  PromptRunTarget,
} from "../extensionHost/graphRuntime";
import type { ThinkingMode } from "../cli/types";
import type { ChatMessage, ChatMessageAction } from "../webview/types";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const { GRAPH_AI_PLANNER_NODE_ID } = require("../graph/graphPlanner") as typeof import("../graph/graphPlanner");
const { createGraphMessagesHost } = require("../extensionHost/graphMessages") as typeof import("../extensionHost/graphMessages");
const { createGraphRuntimeHost } = require("../extensionHost/graphRuntime") as typeof import("../extensionHost/graphRuntime");

const THINKING_MODES = new Set<ThinkingMode>([
  "off",
  "on",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultra",
  "max",
]);

function readSource(...relativePath: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...relativePath), "utf8");
}

function createGraphNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "node-1",
    title: "Implement node",
    kind: "implement",
    status: "pending",
    ownerRole: "subtask",
    maxAttempts: 1,
    attempts: 0,
    dependsOn: [],
    unlocks: [],
    ...overrides,
  };
}

function createGraphRun(overrides: Partial<GraphRunRecord> = {}): GraphRunRecord {
  return {
    id: "graph-1",
    workspaceKey: "workspace-1",
    cli: "codex",
    sessionId: "session-1",
    rootPrompt: "Do the work",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: 1,
    runStoreFile: "run.json",
    nodes: [createGraphNode()],
    edges: [],
    activeNodeIds: [],
    maxConcurrent: 5,
    eventsFile: "events.jsonl",
    communicationDir: "nodes",
    mainCommunicationFile: "main.md",
    graphFile: "graph.json",
    executionMode: "direct",
    directExecution: { cwd: process.cwd() },
    ...overrides,
  };
}

function createNoopGraphMessagesHost(): GraphMessagesHost {
  return createGraphMessagesHost({
    resolveLocale: () => "en",
    getGraphNodeRunTarget: () => undefined,
    getLoopMessagesForTarget: () => [],
    appendSystemMessageForLoop: () => undefined,
    appendMessageToStore: (messages, message) => { messages.push(message); },
    sendPanelMessage: () => undefined,
    persistLoopMessagesForTarget: () => undefined,
    createMessageId: () => "message-1",
  });
}

function createGraphRuntimeHarness(overrides: Partial<GraphRuntimeHostDeps> = {}) {
  const statuses: Array<{
    tabId: string;
    status: "start" | "end" | "error" | "stopped";
    options?: Parameters<GraphRuntimeHostDeps["sendRunStatusForTab"]>[2];
  }> = [];
  const deps: GraphRuntimeHostDeps = {
    getActiveWorkspaceKey: () => "workspace-1",
    getActiveConversationTabId: () => "tab-main",
    resolvePromptRunTarget: (tabId) => tabId ? { tabId, cli: "codex", sessionId: "session-1" } : null,
    resolveGraphRunSessionId: (target) => target.sessionId,
    getActiveConfigIdForCli: () => "config-1",
    getSelectedCliModel: () => "selected-model",
    getSelectedLoopCliModel: (_cli, role) => role === "main" ? "stored-main" : "stored-subtask",
    getSelectedLoopThinkingMode: () => null,
    normalizeThinkingModeForCli: (_cli, mode) => mode,
    getEffectiveThinkingMode: () => "ultra",
    getGlobalLoopSubtaskMaxThinkingMode: () => "xhigh",
    isThinkingMode: (value): value is ThinkingMode => THINKING_MODES.has(value as ThinkingMode),
    resolveOpenCodeRoleModelsForConfig: () => ({
      main: "opencode-main",
      subtask: "opencode-subtask",
      fallback: {},
    }),
    createMessageId: () => "message-1",
    resolveWorkspaceCwd: () => process.cwd(),
    postPanelState: async () => undefined,
    persistGraphRunTickState: (run) => run,
    scheduleGraphRunAutoWake: () => undefined,
    sendRunStatusForTab: (tabId, status, options) => {
      statuses.push({ tabId, status, options });
    },
    createGraphNodeRunTarget: (cli, graphRunId, graphNodeId) => ({
      tabId: `${graphRunId}-${graphNodeId}`,
      cli,
      sessionId: null,
    }),
    runPrompt: async () => undefined,
    closeConversationTabAndRefreshPanel: async () => undefined,
    errorToMessage: (error) => error instanceof Error ? error.message : String(error),
    messages: createNoopGraphMessagesHost(),
    ...overrides,
  };
  return {
    host: createGraphRuntimeHost(deps),
    statuses,
  };
}

function createPromptRunInput(overrides: Partial<PromptRunInput> = {}): PromptRunInput {
  return {
    displayPrompt: "Run graph",
    modelPrompt: "Run graph",
    contextTags: [],
    ...overrides,
  };
}

test("extension delegates Graph runtime wiring to extensionHost hosts", () => {
  const extensionSource = readSource("src", "extension.ts");

  assert.match(extensionSource, /from "\.\/extensionHost\/graphRuntime"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/graphControls"/);
  assert.match(extensionSource, /from "\.\/extensionHost\/graphMessages"/);
  assert.match(extensionSource, /graphRuntimeHost = createGraphRuntimeHost\(\{[\s\S]*persistGraphRunTickState:\s*graphControlsHost\.persistGraphRunTickState[\s\S]*scheduleGraphRunAutoWake:\s*graphControlsHost\.scheduleGraphRunAutoWake[\s\S]*messages:\s*graphMessagesHost/);
  assert.match(extensionSource, /async function runGraphPrompt\([\s\S]*return graphRuntimeHost\.runGraphPrompt\(input,\s*options\);/);
  assert.match(extensionSource, /async function runGraphPromptOrchestration\([\s\S]*return graphRuntimeHost\.runGraphPromptOrchestration\(input,\s*options\);/);
  assert.match(extensionSource, /function persistGraphRunTickState\(nextRun:\s*GraphRunRecord\):\s*GraphRunRecord\s*\{[\s\S]*return graphControlsHost\.persistGraphRunTickState\(nextRun\);/);
  assert.match(extensionSource, /function resolvePromptRunModelForRole\(input:\s*PromptRunInput,\s*role:\s*GraphModelRole\):\s*string \| undefined\s*\{[\s\S]*return graphRuntimeHost\.resolvePromptRunModelForRole\(input,\s*role\);/);
});

test("Graph runtime source contract lives in extensionHost/graphRuntime", () => {
  const graphRuntimeSource = readSource("src", "extensionHost", "graphRuntime.ts");

  assert.match(graphRuntimeSource, /const GRAPH_EXTENSION_INITIAL_PLANNER_MAX_CONCURRENT_NODES = 1/);
  assert.match(graphRuntimeSource, /const GRAPH_EXTENSION_EXECUTOR_MAX_CONCURRENT_NODES = GRAPH_DEFAULT_MAX_CONCURRENT_NODES/);
  assert.match(graphRuntimeSource, /async function runGraphPrompt\(/);
  assert.match(graphRuntimeSource, /async function runGraphPromptOrchestration\(/);
  assert.match(graphRuntimeSource, /createGraphRunRecord\(\{/);
  assert.match(graphRuntimeSource, /appendGraphEvent\(run\.eventsFile,\s*\{\s*[\s\S]*type:\s*"run\.created"/);
  assert.match(graphRuntimeSource, /tickGraphRun\(run,\s*\{[\s\S]*persistRun:\s*deps\.persistGraphRunTickState/);
  assert.match(graphRuntimeSource, /maxConcurrent:\s*GRAPH_EXTENSION_INITIAL_PLANNER_MAX_CONCURRENT_NODES/);
  assert.match(graphRuntimeSource, /maxConcurrent:\s*resolveGraphExtensionExecutorMaxConcurrent\(run\)/);
  assert.match(graphRuntimeSource, /directReworkGraphNodeForRun\(run,\s*nodeId/);
  assert.match(graphRuntimeSource, /function shouldAutoRequestGraphDirectRework\(node:\s*GraphNodeRecord \| undefined\):\s*node is GraphNodeRecord/);
  assert.match(graphRuntimeSource, /recovery\?\.action !== "direct_rework"/);
  assert.match(graphRuntimeSource, /node\.rework\?\.sourceNodeId === node\.id && node\.rework\.targetNodeId === recovery\.targetNodeId/);
  assert.match(graphRuntimeSource, /readGraphNodeExecutionResultArtifact\(resolveGraphNodeCommunicationFile\(run,\s*plannerNode\)\)/);
  assert.match(graphRuntimeSource, /materializeGraphPlan\(run,\s*artifact\.plannedGraph\)/);
  assert.match(graphRuntimeSource, /const graphNodeTarget\s*=\s*deps\.createGraphNodeRunTarget\(target\.cli,\s*request\.run\.id,\s*request\.node\.id\)/);
  assert.match(graphRuntimeSource, /deps\.runPrompt\(\{[\s\S]*displayPrompt:\s*request\.prompt[\s\S]*graphRunId:\s*request\.run\.id[\s\S]*graphNodeId:\s*request\.node\.id[\s\S]*throwOnError:\s*true[\s\S]*\},\s*\{\s*targetTabId:\s*graphNodeTarget\.tabId/);
  assert.match(graphRuntimeSource, /finally\s*\{\s*try\s*\{[\s\S]*await deps\.closeConversationTabAndRefreshPanel\(graphNodeTarget\.tabId\)[\s\S]*graph-node-tab-auto-closed/);
});

test("Graph messages and session tab source contracts moved to extensionHost modules", () => {
  const graphMessagesSource = readSource("src", "extensionHost", "graphMessages.ts");
  const sessionTabsSource = readSource("src", "extensionHost", "sessionTabs.ts");
  const webviewTypesSource = readSource("src", "webview", "types.ts");
  const messageRenderingSource = readSource("src", "webview", "viewContentScript", "messageRendering.ts");
  const traceRenderingSource = readSource("src", "webview", "viewContentScript", "traceRendering.ts");
  const coreRuntimeSource = readSource("src", "webview", "viewContentScript", "coreRuntimeState.ts");

  assert.match(graphMessagesSource, /function buildGraphRunNeedsAttentionText\(run:\s*GraphRunRecord/);
  assert.match(graphMessagesSource, /function formatGraphFailureClassificationForAttention\(node:\s*GraphNodeRecord\):\s*string \| null/);
  assert.match(graphMessagesSource, /\[\$\{failure\.category\}\/\$\{failure\.confidence\}\]/);
  assert.match(graphMessagesSource, /recommendedWriteFiles=\$\{formatGraphAttentionList\(recovery\.recommendedWriteFiles\)\}/);
  assert.match(graphMessagesSource, /function buildGraphRunIdleText\(run:\s*GraphRunRecord\):\s*string\s*\{/);
  assert.match(graphMessagesSource, /if\s*\(!attentionNodes\.some\(\(node\) => Boolean\(node\.failure\)\)\)\s*\{\s*return baseLines\.join\("\\n"\);/);
  assert.match(graphMessagesSource, /function buildGraphRunMessageAction\(/);
  assert.match(graphMessagesSource, /function isTargetedGraphMessageAction\(nodeId\?: string \| null,\s*actionLabel\?: string \| null\): boolean/);
  assert.match(graphMessagesSource, /function buildGraphFinalSummaryMarkdown\(run:\s*GraphRunRecord\):\s*string\s*\{/);
  assert.match(graphMessagesSource, /summary 节点 finalAnswer（主模型）/);
  assert.match(graphMessagesSource, /function appendGraphFinalSummaryMessage\(target:\s*PromptRunTarget,\s*run:\s*GraphRunRecord\):\s*void\s*\{/);
  assert.match(graphMessagesSource, /function isGraphFinalSummaryMessageForRun\(message:\s*ChatMessage,\s*graphRunId:\s*string\):\s*boolean\s*\{/);

  assert.match(sessionTabsSource, /function resolveGraphRunIdFromMessages\(messages:\s*readonly ChatMessage\[\]\):\s*string \| null\s*\{/);
  assert.match(sessionTabsSource, /function resolveConversationTabGraphRunId\(/);
  assert.match(sessionTabsSource, /function buildConversationTabsState\(\):\s*\{/);
  assert.match(sessionTabsSource, /graphRunStatus:\s*graphRun\?\.status/);
  assert.match(sessionTabsSource, /graphRunBlocked:\s*graphRun \? isGraphRunBlockedForMainTab\(graphRun\) : undefined/);
  assert.match(sessionTabsSource, /function createGraphNodeRunTarget\(/);
  assert.match(sessionTabsSource, /graphNodeRunTargetsByTabId\.set\(tab\.id,\s*\{ graphRunId,\s*graphNodeId \}\);/);

  assert.match(webviewTypesSource, /graphRunStatus\?:\s*GraphRunStatus;/);
  assert.match(webviewTypesSource, /graphRunBlocked\?:\s*boolean;/);
  assert.match(webviewTypesSource, /graphFinalSummary\?:\s*boolean;/);
  assert.match(messageRenderingSource, /function isGraphConversationTabErrored\(tab\)[\s\S]*tab\.graphRunStatus === "error"[\s\S]*tab\.graphRunBlocked === true/);
  assert.match(traceRenderingSource, /message\.graphFinalSummary !== true[\s\S]*last\.graphFinalSummary !== true/);
  assert.match(coreRuntimeSource, /current\.graphFinalSummary === true/);
});

test("Graph runtime host resolves role-specific models, fallbacks, and thinking caps", () => {
  const { host } = createGraphRuntimeHarness();

  assert.equal(
    host.resolvePromptRunModelForRole(createPromptRunInput({ model: "single-model" }), "main"),
    "single-model",
  );
  assert.equal(
    host.resolvePromptRunModelForRole(createPromptRunInput({ loopMainModel: "planner-model", loopSubtaskModel: "executor-model" }), "subtask"),
    "executor-model",
  );
  assert.equal(
    host.resolvePromptRunModelFallback(createPromptRunInput({ model: "single-model" }), "main"),
    "loop main model missing; using selected single model",
  );
  assert.equal(
    host.resolvePromptRunModelFallback(createPromptRunInput({ loopMainModel: "planner-model" }), "subtask"),
    "loop subtask model missing; using main model",
  );
  assert.equal(
    host.resolvePromptRunThinkingModeForRole(
      createPromptRunInput({ loopSubtaskThinkingMode: "ultra" }),
      "codex",
      "subtask",
      "executor-model",
      { applySubtaskCap: true },
    ),
    "xhigh",
  );
  assert.deepEqual(
    host.buildGraphRunModelRouting(createPromptRunInput({
      loopMainModel: "planner-model",
      loopSubtaskModel: "executor-model",
    })),
    {
      planner: { role: "main", model: "planner-model" },
      executor: { role: "subtask", model: "executor-model" },
    },
  );
});

test("Graph runtime host applies planner and executor routes to materialized nodes", () => {
  const { host } = createGraphRuntimeHarness();
  const run = createGraphRun({
    modelRouting: {
      planner: { role: "main", model: "planner-model", fallback: "planner fallback" },
      executor: { role: "subtask", model: "executor-model", fallback: "executor fallback" },
    },
    nodes: [
      createGraphNode({ id: GRAPH_AI_PLANNER_NODE_ID, kind: "plan", title: "Plan" }),
      createGraphNode({ id: "summarize", kind: "summary", title: "Summarize" }),
      createGraphNode({ id: "execute", kind: "implement", title: "Execute" }),
    ],
  });

  const routedRun = host.applyGraphRunModelRouting(run);

  assert.deepEqual(
    routedRun.nodes.map((node) => [node.id, node.modelRole, node.model, node.modelFallback]),
    [
      [GRAPH_AI_PLANNER_NODE_ID, "main", "planner-model", "planner fallback"],
      ["summarize", "main", "planner-model", "planner fallback"],
      ["execute", "subtask", "executor-model", "executor fallback"],
    ],
  );
  assert.deepEqual(
    host.resolveGraphResumePromptModels(run, "codex", "config-1"),
    {
      model: "planner-model",
      loopMainModel: "planner-model",
      loopSubtaskModel: "executor-model",
      loopMainModelFallback: "planner fallback",
      loopSubtaskModelFallback: "executor fallback",
    },
  );
});

test("Graph runtime host maps terminal main-tab status through host deps", () => {
  const { host, statuses } = createGraphRuntimeHarness();
  const target: PromptRunTarget = { tabId: "tab-main", cli: "codex", sessionId: "session-1" };

  host.sendGraphMainRunTerminalStatus(target, createGraphRun({ status: "completed" }));
  host.sendGraphMainRunTerminalStatus(target, createGraphRun({
    status: "needs-review",
    nodes: [createGraphNode({ id: "failed-node", status: "failed", completedAt: 3 })],
  }));
  host.sendGraphMainRunTerminalStatus(target, createGraphRun({ status: "sleeping" }));

  assert.deepEqual(statuses.map((item) => item.status), ["end", "error"]);
  assert.equal(host.isGraphRunBlockedForMainTab(createGraphRun({
    status: "needs-review",
    nodes: [createGraphNode({ id: "blocked-node", status: "blocked" })],
  })), true);
});

test("Graph messages host scopes open actions to the right Graph tab", () => {
  const storedMessages: ChatMessage[] = [];
  const emitted: Array<{ content: string; actions?: ChatMessageAction[] }> = [];
  const target: PromptRunTarget = { tabId: "tab-main", cli: "codex", sessionId: "session-1" };
  const host = createGraphMessagesHost({
    resolveLocale: () => "en",
    getGraphNodeRunTarget: () => undefined,
    getLoopMessagesForTarget: () => storedMessages,
    appendSystemMessageForLoop: (_target, content, options) => {
      emitted.push({ content, actions: options?.actions });
      storedMessages.push({
        id: `message-${storedMessages.length}`,
        role: "system",
        content,
        actions: options?.actions,
      });
    },
    appendMessageToStore: (messages, message) => { messages.push(message); },
    sendPanelMessage: () => undefined,
    persistLoopMessagesForTarget: () => undefined,
    createMessageId: () => "message-1",
  });

  host.appendSystemMessageForGraph(target, "created", "graph-1");
  host.appendSystemMessageForGraph(target, "still running", "graph-1");
  host.appendSystemMessageForGraph(target, "retry node", "graph-1", "node-1", "Retry");

  assert.deepEqual(emitted[0]?.actions, [{ type: "openGraphRun", graphRunId: "graph-1" }]);
  assert.equal(emitted[1]?.actions, undefined);
  assert.deepEqual(emitted[2]?.actions, [{
    type: "openGraphRun",
    graphRunId: "graph-1",
    nodeId: "node-1",
    label: "Retry",
  }]);
});

test("Graph runtime source keeps direct execution and merge-back contracts in host module", () => {
  const graphRuntimeSource = readSource("src", "extensionHost", "graphRuntime.ts");
  const graphMessagesSource = readSource("src", "extensionHost", "graphMessages.ts");

  assert.match(graphRuntimeSource, /createGraphRunExecutionSetup\(workspaceCwd,\s*graphRunId\)/);
  assert.match(graphRuntimeSource, /executionMode:\s*executionSetup\.executionMode/);
  assert.match(graphRuntimeSource, /directExecution:\s*executionSetup\.directExecution/);
  assert.match(graphRuntimeSource, /Graph run \$\{run\.id\} created in direct workspace mode/);
  assert.doesNotMatch(graphRuntimeSource, /direct workspace fallback mode/);
  assert.match(graphRuntimeSource, /function resolveGraphNodeExecutionContext\(run:\s*GraphRunRecord\):\s*GraphNodeExecutionContext \| null/);
  assert.match(graphRuntimeSource, /if\s*\(run\.directExecution\?\.cwd\)\s*\{\s*return\s*\{\s*mode:\s*"direct"/);
  assert.match(graphRuntimeSource, /executionCwd:\s*executionContext\.cwd/);
  assert.match(graphRuntimeSource, /if\s*\(executionContext\.mode === "worktree"\)\s*\{[\s\S]*commitGraphNodeCheckpoint/);
  assert.match(graphRuntimeSource, /if\s*\(run\.executionMode === "direct" && run\.directExecution\?\.cwd\)\s*\{/);
  assert.match(graphRuntimeSource, /Graph run completed in direct workspace mode without worktree merge-back/);
  assert.match(graphRuntimeSource, /cleanupGraphRunWorktree/);
  assert.match(graphRuntimeSource, /mergeGraphRunWorktreeToWorkspace/);
  assert.match(graphRuntimeSource, /function finalizeCompletedGraphRunWorktreeMergeBack\(run:\s*GraphRunRecord\):\s*GraphRunMergeBackOutcome/);
  assert.match(graphRuntimeSource, /status:\s*"needs-review"/);
  assert.match(graphRuntimeSource, /worktree:\s*undefined/);
  assert.match(graphRuntimeSource, /git merge --squash/);
  assert.match(graphMessagesSource, /Worktree: not used; changes are written directly to the current project workspace/);
  assert.match(graphMessagesSource, /buildGraphRunCompletedText\(run:\s*GraphRunRecord,\s*mergeBack\?:/);
  assert.match(graphMessagesSource, /buildGraphRunNeedsAttentionText\(run:\s*GraphRunRecord,\s*mergeBack\?:/);
});
