import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";

test("extension wires Graph prompt runtime to store, kernel, and existing runPrompt executor", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /async function runGraphPrompt\(/);
  assert.match(extensionSource, /async function runGraphPromptOrchestration\(/);
  assert.match(extensionSource, /createGraphRunRecord\(\{/);
  assert.match(extensionSource, /appendGraphEvent\(run\.eventsFile,\s*\{\s*[\s\S]*type:\s*"run\.created"/);
  assert.match(extensionSource, /tickGraphRun\(run,\s*\{/);
  assert.match(extensionSource, /persistRun:\s*persistGraphRunTickState/);
  assert.match(extensionSource, /function persistGraphRunTickState\(nextRun:\s*GraphRunRecord\):\s*GraphRunRecord\s*\{[\s\S]*updateGraphRunRecord\(nextRun\.id,\s*nextRun\)[\s\S]*refreshOpenGraphRunPanelForRun\(persisted\.id\)/);
  assert.match(extensionSource, /GRAPH_EXTENSION_INITIAL_PLANNER_MAX_CONCURRENT_NODES\s*=\s*1/);
  assert.match(extensionSource, /maxConcurrent:\s*GRAPH_EXTENSION_INITIAL_PLANNER_MAX_CONCURRENT_NODES/);
  assert.match(extensionSource, /maxConcurrent:\s*resolveGraphExtensionExecutorMaxConcurrent\(run\)/);
  assert.match(extensionSource, /GRAPH_EXTENSION_EXECUTOR_MAX_CONCURRENT_NODES\s*=\s*GRAPH_DEFAULT_MAX_CONCURRENT_NODES/);
  assert.match(extensionSource, /taskRole:\s*modelRole/);
  assert.match(extensionSource, /function createGraphNodeRunTarget\([\s\S]*graphRunId:\s*string,[\s\S]*graphNodeId:\s*string/);
  assert.match(extensionSource, /const graphNodeTarget\s*=\s*createGraphNodeRunTarget\(target\.cli,\s*request\.run\.id,\s*request\.node\.id\)/);
  assert.match(extensionSource, /runPrompt\(\{\s*[\s\S]*displayPrompt:\s*request\.prompt[\s\S]*graphRunId:\s*request\.run\.id[\s\S]*graphNodeId:\s*request\.node\.id[\s\S]*throwOnError:\s*true[\s\S]*\},\s*\{\s*targetTabId:\s*graphNodeTarget\.tabId/);
  assert.match(extensionSource, /finally\s*\{\s*try\s*\{[\s\S]*await closeConversationTabAndRefreshPanel\(graphNodeTarget\.tabId\)[\s\S]*graph-node-tab-auto-closed/);
  assert.match(extensionSource, /if\s*\(promptInput\.throwOnError\)\s*\{\s*throw error;\s*\}/);
});

test("extension wires Graph recovery controls, latest fallback, and auto wake", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /findLatestGraphRun/);
  assert.match(extensionSource, /readGraphRunRecord/);
  assert.match(extensionSource, /listGraphRuns/);
	  assert.match(extensionSource, /resumeGraphRunRecord/);
	  assert.match(extensionSource, /retryGraphNodeForRun/);
	  assert.match(extensionSource, /skipGraphNodeForRun/);
	  assert.match(extensionSource, /feedbackGraphNodeForRun/);
	  assert.match(extensionSource, /stopGraphRunRecord/);
  assert.match(extensionSource, /GraphAutoWakeScheduler/);
  assert.match(extensionSource, /initializeGraphAutoWakeScheduler\(context\)/);
  assert.match(extensionSource, /restoreGraphAutoWakeSchedules\(\)/);
	  assert.match(extensionSource, /continueGraphRunFromStore\(graphRunId/);
	  assert.match(extensionSource, /feedbackGraphNodeFromPanel\(graphRunId,\s*nodeId\)/);
	  assert.match(extensionSource, /async function skipGraphNodeFromPanel\(\s*graphRunId:\s*string,\s*nodeId:\s*string/);
	  assert.match(extensionSource, /tickGraphRunToPauseFromControl\(persisted/);
  assert.match(extensionSource, /stopActiveCliRunsForGraphRun\(graphRunId\)/);
});

test("extension treats Graph blocked runs as failed flow without modal prompts", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.doesNotMatch(extensionSource, /graphBlockedPromptKeys/);
  assert.doesNotMatch(extensionSource, /maybePromptForGraphBlockedRun/);
  assert.doesNotMatch(extensionSource, /buildGraphBlockedPromptMessage/);
  assert.doesNotMatch(extensionSource, /pickGraphBlockedDownstreamNode/);
  assert.doesNotMatch(extensionSource, /resolveGraphDownstreamNodes/);
  assert.doesNotMatch(extensionSource, /重跑当前节点/);
  assert.doesNotMatch(extensionSource, /跳过当前并选择下游继续/);
  assert.match(extensionSource, /function buildGraphRunNeedsAttentionText\(run:\s*GraphRunRecord[\s\S]*node\.status === "blocked" \|\| node\.status === "failed"/);
});

test("extension removes automatic human gate approval entry and keeps precise Stop boundaries", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.doesNotMatch(extensionSource, /openGraphHumanGateApprovalPanelIfNeeded/);
  assert.doesNotMatch(extensionSource, /resolveGraphPendingHumanGateNode/);
  assert.doesNotMatch(extensionSource, /graphHumanApprovalCtaText/);
  assert.doesNotMatch(extensionSource, /请你审批，点击这里/);
  assert.doesNotMatch(extensionSource, /approveGraphHumanGateForRun/);
  assert.match(extensionSource, /buildGraphRunMessageAction\([\s\S]*nodeId\?: string \| null,[\s\S]*label\?: string \| null/);
  assert.match(extensionSource, /function isTargetedGraphMessageAction\(nodeId\?: string \| null,\s*actionLabel\?: string \| null\): boolean/);
  assert.match(extensionSource, /if\s*\(isTargetedGraphMessageAction\(nodeId,\s*actionLabel\)\)\s*\{\s*return \[buildGraphRunMessageAction\(graphRunId,\s*nodeId,\s*actionLabel\)\];\s*\}/);
  assert.doesNotMatch(extensionSource, /isHumanGateGraphMessageAction/);
  assert.match(extensionSource, /const actions = resolveGraphSystemMessageActions\(target,\s*graphRunId,\s*nodeId,\s*actionLabel\);/);
  assert.match(extensionSource, /\.\.\.\(actions\.length \? \{ actions \} : \{\}\)/);
  assert.match(extensionSource, /no real CLI process stop was confirmed/);
  assert.match(extensionSource, /Sent stop requests to \$\{count\} mapped active CLI run\(s\); real process exit depends on the underlying CLI response/);
  assert.doesNotMatch(extensionSource, /Graph run stopped: \$\{graphRunId\}\. Requested stop/);
});

test("extension scopes the ordinary Graph run action to the main Graph tab once", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /const graphNodeRunTargetsByTabId = new Map<string,\s*\{ graphRunId: string; graphNodeId: string \}>\(\);/);
  assert.match(extensionSource, /graphNodeRunTargetsByTabId\.set\(tab\.id,\s*\{ graphRunId,\s*graphNodeId \}\);/);
  assert.match(extensionSource, /graphNodeRunTargetsByTabId\.delete\(tabId\);/);
  assert.match(extensionSource, /function isPlainGraphRunOpenAction\(action:\s*ChatMessageAction,\s*graphRunId:\s*string\):\s*boolean\s*\{[\s\S]*action\.type === "openGraphRun"[\s\S]*!action\.nodeId[\s\S]*!action\.label/);
  assert.match(extensionSource, /function isGraphNodeRunTarget\([\s\S]*messages:\s*readonly ChatMessage\[\],[\s\S]*nodeTarget\?\.graphRunId === graphRunId[\s\S]*message\.graphRunId === graphRunId[\s\S]*Boolean\(message\.graphNodeId\)/);
  assert.match(extensionSource, /function hasVisibleGraphRunOpenActionForTarget\([\s\S]*message\.actions\.some\(\(action\) => isPlainGraphRunOpenAction\(action,\s*graphRunId\)\)/);
  assert.match(extensionSource, /if\s*\(\s*isGraphNodeRunTarget\(target,\s*graphRunId,\s*messages\)\s*\|\|\s*hasVisibleGraphRunOpenActionForTarget\(messages,\s*graphRunId\)\s*\)\s*\{\s*return \[\];\s*\}/);
  assert.match(extensionSource, /return \[buildGraphRunMessageAction\(graphRunId\)\];/);
  assert.match(extensionSource, /appendSystemMessageForGraph\(\s*graphNodeTarget,\s*buildGraphNodeStartedText\(request\.run,\s*request\.node,\s*communicationFile\),\s*request\.run\.id,\s*\);/);
});

test("extension keeps Graph tab metadata on runStatus start while nodes are running", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /function sendRunStatusForTab\([\s\S]*graphRunId\?: string;[\s\S]*graphNodeId\?: string;/);
  assert.match(extensionSource, /sendPanelMessage\(\{\s*[\s\S]*type:\s*"runStatus"[\s\S]*graphRunId:\s*status === "start" \? options\.graphRunId : undefined[\s\S]*graphNodeId:\s*status === "start" \? options\.graphNodeId : undefined/);
  assert.match(extensionSource, /sendRunStatusForTab\(target\.tabId,\s*"start",\s*\{\s*[\s\S]*graphRunId:\s*input\.graphRunId[\s\S]*graphNodeId:\s*input\.graphNodeId[\s\S]*\}\);/);
  assert.match(extensionSource, /sendRunStatusForTab\(tabId,\s*"start",\s*\{\s*[\s\S]*graphRunId:\s*input\.graphRunId[\s\S]*graphNodeId:\s*input\.graphNodeId[\s\S]*\}\);/);
});

test("extension includes Graph run ids in conversation tab summaries", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /function resolveGraphRunIdFromMessages\(messages:\s*readonly ChatMessage\[\]\):\s*string \| null\s*\{[\s\S]*message\.graphRunId[\s\S]*action\.type !== "openGraphRun"[\s\S]*action\.graphRunId/);
  assert.match(extensionSource, /function resolveConversationTabGraphRunId\([\s\S]*tab:\s*ConversationTabRecord \| null,[\s\S]*graphNodeRunTargetsByTabId\.get\(tab\.id\)[\s\S]*parallelRunsByTabId\.get\(tab\.id\)\?\.graphRunId[\s\S]*interactiveRunsByTabId\.get\(tab\.id\)\?\.graphRunId[\s\S]*getLiveMessagesForTab\(tab\.id\)[\s\S]*getPendingSessionDraft\(tab\.id,\s*tab\.cli\)\.messages/);
  assert.match(extensionSource, /function buildConversationTabsState\(\):\s*\{[\s\S]*tabs:\s*ConversationTabSummary\[\];[\s\S]*const graphRuns = listGraphRuns\(\{ workspaceKey:\s*activeWorkspaceKey \}\)\.runs;[\s\S]*const graphRunsById = new Map\(graphRuns\.map\(\(run\) => \[run\.id,\s*run\]\)\);[\s\S]*graphRunIdsBySessionByCli = buildGraphRunIdsBySessionByCli\(\s*graphRuns,[\s\S]*resolveConversationTabGraphRunId\(tabsById\.get\(summary\.id\) \?\? null,\s*graphRunIdsBySessionByCli\)[\s\S]*graphRunStatus:\s*graphRun\?\.status,[\s\S]*graphRunBlocked:\s*graphRun \? isGraphRunBlockedForMainTab\(graphRun\) : undefined/);
  assert.match(extensionSource, /if\s*\(resolveConversationTabGraphRunId\(tab\)\)\s*\{\s*return "graph";\s*\}/);
});

test("extension marks blocked Graph main tabs as errored instead of running", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const webviewTypesSource = fs.readFileSync(path.join(process.cwd(), "src", "webview", "types.ts"), "utf8");
  const messageRenderingSource = fs.readFileSync(path.join(process.cwd(), "src", "webview", "viewContentScript", "messageRendering.ts"), "utf8");

  assert.match(extensionSource, /type GraphRunStatus/);
  assert.match(extensionSource, /sendGraphMainRunStarted\(target,\s*run,\s*input\.displayPrompt\);/);
  assert.match(extensionSource, /function sendGraphMainRunStarted\([\s\S]*sendRunStatusForTab\(target\.tabId,\s*"start",\s*\{[\s\S]*graphRunId:\s*run\.id[\s\S]*\}\);/);
  assert.match(extensionSource, /function isGraphRunBlockedForMainTab\(run:\s*GraphRunRecord\):\s*boolean\s*\{[\s\S]*run\.status === "needs-review"[\s\S]*selectGraphBlockedAttentionNode\(run\)/);
  assert.match(extensionSource, /function resolveGraphMainRunStatusEvent\(run:\s*GraphRunRecord\):\s*"end" \| "error" \| "stopped" \| null/);
  assert.match(extensionSource, /if\s*\(run\.status === "completed"\)\s*\{\s*return "end";\s*\}/);
  assert.match(extensionSource, /if\s*\(run\.status === "error" \|\| isGraphRunBlockedForMainTab\(run\)\)\s*\{\s*return "error";\s*\}/);
  assert.match(extensionSource, /if\s*\(run\.status === "stopped"\)\s*\{\s*return "stopped";\s*\}/);
  assert.match(extensionSource, /return null;\s*\}\s*function sendGraphMainRunTerminalStatus/);
  assert.match(extensionSource, /if\s*\(run\.status === "needs-review" \|\| run\.status === "sleeping" \|\| run\.status === "error" \|\| run\.status === "stopped"\)\s*\{[\s\S]*sendGraphMainRunTerminalStatus\(target,\s*run\)/);
  assert.match(extensionSource, /const target = resolveGraphRunExistingPromptTarget\(lookup\.run\);[\s\S]*sendGraphMainRunTerminalStatus\(target,\s*persisted\);/);
  assert.match(extensionSource, /const graphRuns = listGraphRuns\(\{ workspaceKey:\s*activeWorkspaceKey \}\)\.runs;[\s\S]*const graphRunsById = new Map\(graphRuns\.map\(\(run\) => \[run\.id,\s*run\]\)\);/);
  assert.match(extensionSource, /graphRunStatus:\s*graphRun\?\.status,[\s\S]*graphRunBlocked:\s*graphRun \? isGraphRunBlockedForMainTab\(graphRun\) : undefined/);
  assert.match(webviewTypesSource, /graphRunStatus\?:\s*GraphRunStatus;/);
  assert.match(webviewTypesSource, /graphRunBlocked\?:\s*boolean;/);
  assert.match(messageRenderingSource, /function isGraphConversationTabErrored\(tab\)[\s\S]*tab\.graphRunStatus === "error"[\s\S]*tab\.graphRunBlocked === true/);
  assert.match(messageRenderingSource, /if\s*\(isTabErrored\(tab\.id\) \|\| isGraphConversationTabErrored\(tab\)\)\s*\{\s*tabItem\.classList\.add\("errored"\);/);
});

test("extension stops Graph runs from the main conversation stop button and preserves stopped state", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /function stopGraphRunForConversationTab\(tabId:\s*string\):\s*boolean\s*\{[\s\S]*resolveConversationTabGraphRunId\(tab\)[\s\S]*readGraphRunRecord\(graphRunId\)[\s\S]*lookup\.run\.status === "completed" \|\| lookup\.run\.status === "stopped"[\s\S]*stopGraphRunFromConversationTab\(graphRunId,\s*tabId\)/);
  assert.match(extensionSource, /function stopRunForTab\(tabId:\s*string \| null\):\s*void\s*\{[\s\S]*if\s*\(stopParallelRunForTab\(tabId\)\)[\s\S]*if\s*\(getPrimaryRunTabId\(\) === tabId\)[\s\S]*stopActiveRun\(\);[\s\S]*stopGraphRunFromConversationTab\(graphRunId,\s*tabId\)[\s\S]*if\s*\(stopGraphRunForConversationTab\(tabId\)\)/);
  assert.match(extensionSource, /async function stopGraphRunFromConversationTab\(graphRunId:\s*string,\s*tabId:\s*string\):\s*Promise<void>\s*\{[\s\S]*stopGraphRunFromPanel\(graphRunId\)[\s\S]*graph-run-stopped-from-conversation-tab/);
  assert.match(extensionSource, /function persistGraphRunTickState\(nextRun:\s*GraphRunRecord\):\s*GraphRunRecord\s*\{[\s\S]*readGraphRunRecord\(nextRun\.id\)\.run[\s\S]*latest\?\.status === "stopped" && nextRun\.status !== "stopped"[\s\S]*return latest;[\s\S]*updateGraphRunRecord\(nextRun\.id,\s*nextRun\)/);
});

test("extension creates a planning-only graph and materializes the AI planned DAG", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /templateId:\s*GRAPH_AI_PLANNER_TEMPLATE_ID/);
  assert.match(extensionSource, /templateVersion:\s*GRAPH_AI_PLANNER_TEMPLATE_VERSION/);
  assert.match(extensionSource, /nodes:\s*buildGraphPlanningRunNodes\(graphRunId\)/);
  assert.match(extensionSource, /edges:\s*buildGraphPlanningRunEdges\(\)/);
  assert.match(extensionSource, /function maybeMaterializeGraphPlanAfterTick\(run:\s*GraphRunRecord\)/);
  assert.match(extensionSource, /readGraphNodeExecutionResultArtifact\(resolveGraphNodeCommunicationFile\(run,\s*plannerNode\)\)/);
  assert.match(extensionSource, /materializeGraphPlan\(run,\s*artifact\.plannedGraph\)/);
  assert.match(extensionSource, /failGraphPlannerRun\(run,\s*"Graph planner passed without a valid plannedGraph DAG artifact\."\)/);
  assert.match(extensionSource, /function failGraphPlannerRun\(run:\s*GraphRunRecord,\s*reason:\s*string\):\s*GraphRunRecord\s*\{[\s\S]*status:\s*"failed" as const[\s\S]*type:\s*"node\.failed"/);
  assert.doesNotMatch(extensionSource, /blockGraphPlannerRun/);
  assert.doesNotMatch(extensionSource, /function buildMinimalGraphRunNodes/u);
});

test("extension continues the tick loop immediately after successful planner materialization", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /if\s*\(\s*planMaterialization\.changed\s*&&\s*run\.status === "running"\s*\)\s*\{\s*[\s\S]*madeProgress = true;[\s\S]*scheduleGraphRunAutoWake\(run\);[\s\S]*continue;[\s\S]*\}[\s\S]*const progressed = tickResult\.startedNodeIds\.length > 0/);
  assert.match(extensionSource, /const progressed = tickResult\.startedNodeIds\.length > 0[\s\S]*\|\| planMaterialization\.changed;[\s\S]*if\s*\(!progressed\)\s*\{/);
});

test("extension routes Loop main and subtask runs through role-specific Codex models", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /function resolvePromptRunModelForRole\(input:\s*PromptRunInput,\s*role:\s*GraphModelRole\):\s*string \| undefined\s*\{[\s\S]*const mainModel = normalizePromptRunModel\(input\.loopMainModel\) \?\? normalizePromptRunModel\(input\.model\);/);
  assert.match(extensionSource, /const subtaskModel = normalizePromptRunModel\(input\.loopSubtaskModel\)[\s\S]*\?\? normalizePromptRunModel\(input\.model\)[\s\S]*\?\? mainModel;/);
  assert.match(extensionSource, /return role === "subtask"[\s\S]*\?\s*\(subtaskModel \?\? mainModel\)[\s\S]*:\s*\(mainModel \?\? subtaskModel\);/);
  assert.match(extensionSource, /const roleModel = resolvePromptRunModelForRole\(input,\s*role\);[\s\S]*await runPrompt\(\{[\s\S]*model:\s*roleModel,[\s\S]*taskRole:\s*role,[\s\S]*loopTaskId:\s*task\.id,[\s\S]*loopRound:\s*round,[\s\S]*loopSubtaskId:\s*subtaskId/);
  assert.match(extensionSource, /function resolvePromptRunThinkingModeForRole\([\s\S]*options:\s*\{ applySubtaskCap\?:\s*boolean \} = \{\}[\s\S]*return options\.applySubtaskCap && role === "subtask"[\s\S]*resolveLoopSubtaskThinkingMode\(/);
  assert.match(extensionSource, /const thinkingModeOverride = resolvePromptRunThinkingModeForRole\(input,\s*target\.cli,\s*role,\s*roleModel,\s*\{[\s\S]*applySubtaskCap:\s*true,[\s\S]*\}\);[\s\S]*thinkingModeOverride,/);
});

test("extension routes Graph planner, summary, and execution nodes through role-specific model records", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const graphKernelSource = fs.readFileSync(path.join(process.cwd(), "src", "graph", "graphKernel.ts"), "utf8");
  const graphStoreSource = fs.readFileSync(path.join(process.cwd(), "src", "graph", "graphStore.ts"), "utf8");
  const graphPromptSource = fs.readFileSync(path.join(process.cwd(), "src", "graph", "graphPromptBuilders.ts"), "utf8");

  assert.match(extensionSource, /function buildGraphRunModelRouting\(input:\s*PromptRunInput\):\s*GraphRunModelRoutingRecord\s*\{[\s\S]*planner:\s*\{[\s\S]*role:\s*"main"[\s\S]*executor:\s*\{[\s\S]*role:\s*"subtask"/);
  assert.match(extensionSource, /function resolvePromptRunModelFallback\(input:\s*PromptRunInput,\s*role:\s*GraphModelRole\):\s*string\s*\{[\s\S]*loop main model missing; using selected single model[\s\S]*loop subtask model missing; using selected single model[\s\S]*no explicit model selected; CLI default applies/);
  assert.match(extensionSource, /async function hydrateOpenCodePromptRoleModels\(input:\s*PromptRunInput,\s*cli:\s*CliName\):\s*Promise<PromptRunInput>\s*\{[\s\S]*const roles = resolveOpenCodeRoleModelsForConfig\(configId,\s*current\.content \?\? "\{\}"\);[\s\S]*const loopMainModel = explicitMain \?\? explicitSingle \?\? roles\.main \?\? undefined;[\s\S]*const loopSubtaskModel = explicitSubtask \?\? roles\.subtask \?\? explicitSingle \?\? loopMainModel \?\? undefined;[\s\S]*roles\.fallback\.subtask/);
  assert.match(extensionSource, /if\s*\(!configuredSubtask && main\)\s*\{[\s\S]*fallback\.subtask = "subtask model missing; using main model";/);
  assert.match(extensionSource, /nodes:\s*buildGraphPlanningRunNodes\(graphRunId\)[\s\S]*\.map\(\(node\) => applyGraphNodeModelRoute\(node,\s*modelRouting\.planner\)\)/);
  assert.match(extensionSource, /modelRouting,[\s\S]*appendGraphEvent\(run\.eventsFile,\s*\{[\s\S]*type:\s*"run\.created"[\s\S]*modelRouting:\s*run\.modelRouting/);
  assert.match(extensionSource, /const routedRun = applyGraphRunModelRouting\(materialized\.run\);/);
  assert.match(extensionSource, /function resolveGraphNodeModelRoute\([\s\S]*node\.id === GRAPH_AI_PLANNER_NODE_ID \|\| node\.kind === "summary"[\s\S]*\? routing\.planner[\s\S]*: routing\.executor/);
  assert.match(extensionSource, /const modelRole = request\.modelRole[\s\S]*\?\? \(request\.node\.id === GRAPH_AI_PLANNER_NODE_ID \|\| request\.node\.kind === "summary" \? "main" : "subtask"\);/);
  assert.match(extensionSource, /const selectedModel = request\.model \?\? resolvePromptRunModelForRole\(rootInput,\s*modelRole\);/);
  assert.match(extensionSource, /const modelFallback = request\.modelFallback \?\? resolvePromptRunModelFallback\(rootInput,\s*modelRole\);/);
  assert.match(extensionSource, /runPrompt\(\{[\s\S]*model:\s*selectedModel,[\s\S]*loopMainModel:\s*rootInput\.loopMainModel,[\s\S]*loopSubtaskModel:\s*rootInput\.loopSubtaskModel,[\s\S]*taskRole:\s*modelRole[\s\S]*graphRunId:\s*request\.run\.id[\s\S]*graphNodeId:\s*request\.node\.id/);

  assert.match(graphKernelSource, /modelRole\?:\s*GraphModelRole;[\s\S]*model\?:\s*string;[\s\S]*modelFallback\?:\s*string;/);
  assert.match(graphKernelSource, /executor\.execute\(\{[\s\S]*\.\.\.\(node\.modelRole \? \{ modelRole:\s*node\.modelRole \} : \{\}\),[\s\S]*\.\.\.\(node\.model \? \{ model:\s*node\.model \} : \{\}\),[\s\S]*\.\.\.\(node\.modelFallback \? \{ modelFallback:\s*node\.modelFallback \} : \{\}\),/);
  assert.match(graphStoreSource, /const modelRouting = normalizeGraphRunModelRouting\(raw\.modelRouting\);[\s\S]*\.\.\.\(modelRouting \? \{ modelRouting \} : \{\}\)/);
  assert.match(graphStoreSource, /\.\.\.\(isGraphModelRole\(raw\.modelRole\) \? \{ modelRole:\s*raw\.modelRole \} : \{\}\),[\s\S]*model:\s*raw\.model\.trim\(\)[\s\S]*modelFallback:\s*raw\.modelFallback\.trim\(\)/);
  assert.match(graphPromptSource, /Planner model role：\$\{formatValue\(planner\?\.role\)\}/);
  assert.match(graphPromptSource, /Execution node model role：\$\{formatValue\(executor\?\.role\)\}/);
  assert.match(graphPromptSource, /Model fallback：\$\{formatValue\(node\.modelFallback\)\}/);
});

test("extension appends a Graph final summary assistant message on completed main tabs", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
  const webviewTypesSource = fs.readFileSync(path.join(process.cwd(), "src", "webview", "types.ts"), "utf8");
  const traceRenderingSource = fs.readFileSync(path.join(process.cwd(), "src", "webview", "viewContentScript", "traceRendering.ts"), "utf8");
  const coreRuntimeSource = fs.readFileSync(path.join(process.cwd(), "src", "webview", "viewContentScript", "coreRuntimeState.ts"), "utf8");

  assert.match(extensionSource, /if\s*\(run\.status === "completed"\)\s*\{[\s\S]*appendSystemMessageForGraph\(target,\s*buildGraphRunCompletedText\(run,\s*mergeBack\),\s*run\.id\);[\s\S]*appendGraphFinalSummaryMessage\(target,\s*run\);/);
  assert.match(extensionSource, /function buildGraphFinalSummaryMarkdown\(run:\s*GraphRunRecord\):\s*string\s*\{/);
  assert.match(extensionSource, /summary 节点 finalAnswer（主模型）/);
  assert.match(extensionSource, /# Graph 任务最终总结/);
  assert.match(extensionSource, /## 问题回答结论/);
  assert.match(extensionSource, /## 任务总结/);
  assert.match(extensionSource, /## 验证证据/);
  assert.match(extensionSource, /## 未完成事项/);
  assert.match(extensionSource, /function appendGraphFinalSummaryMessage\(target:\s*PromptRunTarget,\s*run:\s*GraphRunRecord\):\s*void\s*\{[\s\S]*role:\s*"assistant"[\s\S]*taskRole:\s*"main"[\s\S]*graphRunId:\s*run\.id[\s\S]*graphFinalSummary:\s*true/);
  assert.match(extensionSource, /function isGraphFinalSummaryMessageForRun\(message:\s*ChatMessage,\s*graphRunId:\s*string\):\s*boolean\s*\{[\s\S]*message\.graphFinalSummary === true[\s\S]*message\.graphRunId === graphRunId/);
  assert.match(webviewTypesSource, /graphFinalSummary\?:\s*boolean;/);
  assert.match(traceRenderingSource, /message\.graphFinalSummary !== true[\s\S]*last\.graphFinalSummary !== true/);
  assert.match(coreRuntimeSource, /current\.graphFinalSummary === true/);
});

test("extension merges completed Graph worktrees back and cleans up residual worktrees", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /cleanupGraphRunWorktree/);
  assert.match(extensionSource, /mergeGraphRunWorktreeToWorkspace/);
  assert.match(extensionSource, /function finalizeCompletedGraphRunWorktreeMergeBack\(run:\s*GraphRunRecord\):\s*GraphRunMergeBackOutcome/);
  assert.match(extensionSource, /if\s*\(run\.status === "completed"\)\s*\{\s*const mergeBack = finalizeCompletedGraphRunWorktreeMergeBack\(run\)/);
  assert.match(extensionSource, /status:\s*"needs-review"/);
  assert.match(extensionSource, /cleanupGraphRunWorktree\(\{\s*workspaceCwd,\s*worktree:\s*run\.worktree\s*\}\)/);
  assert.match(extensionSource, /worktree:\s*undefined/);
  assert.match(extensionSource, /Graph worktree merged back into workspace and cleaned up without committing/);
  assert.match(extensionSource, /Graph worktree cleanup failed after merge-back/);
  assert.match(extensionSource, /Cleaned up worktree \$\{cleanup\.worktreeCwd\} and branch \$\{cleanup\.sourceBranch\}/);
  assert.match(extensionSource, /git merge --squash/);
  assert.match(extensionSource, /buildGraphRunCompletedText\(run,\s*mergeBack\)/);
  assert.match(extensionSource, /buildGraphRunNeedsAttentionText\(run,\s*mergeBack\)/);
});

test("extension defaults Graph execution to the direct project workspace", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /createGraphRunExecutionSetup\(workspaceCwd,\s*graphRunId\)/);
  assert.match(extensionSource, /executionMode:\s*executionSetup\.executionMode/);
  assert.match(extensionSource, /directExecution:\s*executionSetup\.directExecution/);
  assert.match(extensionSource, /Graph run .* created in direct workspace mode/);
  assert.doesNotMatch(extensionSource, /direct workspace fallback mode/);
  assert.match(extensionSource, /direct project workspace/);
  assert.match(extensionSource, /function resolveGraphNodeExecutionContext\(run:\s*GraphRunRecord\):\s*GraphNodeExecutionContext \| null/);
  assert.match(extensionSource, /if\s*\(run\.directExecution\?\.cwd\)\s*\{\s*return\s*\{\s*mode:\s*"direct"/);
  assert.match(extensionSource, /executionCwd:\s*executionContext\.cwd/);
  assert.match(extensionSource, /if\s*\(executionContext\.mode === "worktree"\)\s*\{[\s\S]*commitGraphNodeCheckpoint/);
  assert.match(extensionSource, /if\s*\(run\.executionMode === "direct" && run\.directExecution\?\.cwd\)\s*\{[\s\S]*no git worktree, checkpoint, merge-back, or cleanup was used/);
  assert.match(extensionSource, /Worktree: not used; changes are written directly to the current project workspace/);
});
