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
  assert.match(extensionSource, /taskRole:\s*"subtask"/);
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
	  assert.match(extensionSource, /feedbackGraphNodeForRun/);
	  assert.match(extensionSource, /approveGraphHumanGateForRun/);
	  assert.match(extensionSource, /stopGraphRunRecord/);
  assert.match(extensionSource, /GraphAutoWakeScheduler/);
  assert.match(extensionSource, /initializeGraphAutoWakeScheduler\(context\)/);
  assert.match(extensionSource, /restoreGraphAutoWakeSchedules\(\)/);
	  assert.match(extensionSource, /continueGraphRunFromStore\(graphRunId/);
	  assert.match(extensionSource, /feedbackGraphNodeFromPanel\(graphRunId,\s*nodeId\)/);
	  assert.match(extensionSource, /tickGraphRunToPauseFromControl\(persisted/);
  assert.match(extensionSource, /stopActiveCliRunsForGraphRun\(graphRunId\)/);
});

test("extension surfaces human gate approval entry and precise Stop boundaries", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /const humanGateNode = openGraphHumanGateApprovalPanelIfNeeded\(run\);/);
  assert.match(extensionSource, /openGraphRunPanel\(\{\s*[\s\S]*graphRunId:\s*run\.id,[\s\S]*nodeId:\s*humanGateNode\.id/);
  assert.match(extensionSource, /function resolveGraphPendingHumanGateNode\(run:\s*GraphRunRecord\):\s*GraphRunRecord\["nodes"\]\[number\] \| null/);
  assert.match(extensionSource, /node\.kind === "human_gate" && node\.status === "ready"/);
  assert.match(extensionSource, /graphHumanApprovalCtaText\(\)/);
  assert.match(extensionSource, /请你审批，点击这里/);
  assert.match(extensionSource, /buildGraphRunMessageAction\([\s\S]*nodeId\?: string \| null,[\s\S]*label\?: string \| null/);
  assert.match(extensionSource, /function isHumanGateGraphMessageAction\(nodeId\?: string \| null,\s*actionLabel\?: string \| null\): boolean/);
  assert.match(extensionSource, /if\s*\(isHumanGateGraphMessageAction\(nodeId,\s*actionLabel\)\)\s*\{\s*return \[buildGraphRunMessageAction\(graphRunId,\s*nodeId,\s*actionLabel\)\];\s*\}/);
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

test("extension keeps the Graph main tab running until the graph reaches a terminal status", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /type GraphRunStatus/);
  assert.match(extensionSource, /sendGraphMainRunStarted\(target,\s*run,\s*input\.displayPrompt\);/);
  assert.match(extensionSource, /function sendGraphMainRunStarted\([\s\S]*sendRunStatusForTab\(target\.tabId,\s*"start",\s*\{[\s\S]*graphRunId:\s*run\.id[\s\S]*\}\);/);
  assert.match(extensionSource, /function resolveGraphMainRunStatusEvent\(status:\s*GraphRunStatus\):\s*"end" \| "error" \| "stopped" \| null/);
  assert.match(extensionSource, /if\s*\(status === "completed"\)\s*\{\s*return "end";\s*\}/);
  assert.match(extensionSource, /if\s*\(status === "error"\)\s*\{\s*return "error";\s*\}/);
  assert.match(extensionSource, /if\s*\(status === "stopped"\)\s*\{\s*return "stopped";\s*\}/);
  assert.match(extensionSource, /return null;\s*\}\s*function sendGraphMainRunTerminalStatus/);
  assert.match(extensionSource, /if\s*\(run\.status === "needs-review" \|\| run\.status === "sleeping" \|\| run\.status === "error" \|\| run\.status === "stopped"\)\s*\{[\s\S]*sendGraphMainRunTerminalStatus\(target,\s*run\)/);
  assert.match(extensionSource, /const target = resolveGraphRunExistingPromptTarget\(lookup\.run\);[\s\S]*sendGraphMainRunTerminalStatus\(target,\s*persisted\);/);
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
  assert.match(extensionSource, /blockGraphPlannerRun\(run,\s*"Graph planner passed without a valid plannedGraph DAG artifact\."\)/);
  assert.doesNotMatch(extensionSource, /function buildMinimalGraphRunNodes/u);
});

test("extension continues the tick loop immediately after successful planner materialization", () => {
  const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

  assert.match(extensionSource, /if\s*\(\s*planMaterialization\.changed\s*&&\s*run\.status === "running"\s*\)\s*\{\s*[\s\S]*madeProgress = true;[\s\S]*scheduleGraphRunAutoWake\(run\);[\s\S]*continue;[\s\S]*\}[\s\S]*const progressed = tickResult\.startedNodeIds\.length > 0/);
  assert.match(extensionSource, /const progressed = tickResult\.startedNodeIds\.length > 0[\s\S]*\|\| planMaterialization\.changed;[\s\S]*if\s*\(!progressed\)\s*\{/);
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
