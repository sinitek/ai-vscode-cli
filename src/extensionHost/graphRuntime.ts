import { scheduleLogRetentionCleanup, logError, logInfo } from "../logger";
import type { CliName, LoopExecutionMode, ThinkingMode } from "../cli/types";
import type { OpenCodeCanonicalModelRole } from "../cli/opencodeconfigmodels";
import type { LoopTaskRole } from "../promptRunState";
import * as configService from "../config/configService";
import { normalizeCliModelName } from "../modelSelectionStore";
import { resolveLoopSubtaskThinkingMode } from "../loopSubtaskThinking";
import { appendGraphEvent } from "../graph/graphEvents";
import { tickGraphRun, type GraphNodeExecutionRequest } from "../graph/graphKernel";
import { readGraphNodeExecutionResultArtifact } from "../graph/graphNodeArtifact";
import {
  appendGraphReplanningNode,
  buildGraphPlanningRunEdges,
  buildGraphPlanningRunNodes,
  GRAPH_AI_PLANNER_NODE_ID,
  GRAPH_AI_PLANNER_TEMPLATE_ID,
  GRAPH_AI_PLANNER_TEMPLATE_VERSION,
  isGraphAiReplannerNode,
  materializeGraphPlan,
} from "../graph/graphPlanner";
import { resolveGraphNodeCommunicationFile } from "../graph/graphPromptBuilders";
import { directReworkGraphNodeForRun } from "../graph/graphRunControl";
import { createGraphRunRecord, readGraphRunRecord, updateGraphRunRecord } from "../graph/graphStore";
import {
  cleanupGraphRunWorktree,
  commitGraphNodeCheckpoint,
  createGraphRunExecutionSetup,
  getGraphWorktreeHeadCommit,
  mergeGraphRunWorktreeToWorkspace,
  type GraphWorktreeCleanupResult,
  type GraphWorktreeMergeBackResult,
} from "../graph/graphWorktree";
import {
  GRAPH_DEFAULT_MAX_CONCURRENT_NODES,
  type GraphFinalAnswer,
  type GraphModelRole,
  type GraphNodeRecord,
  type GraphRunModelRoutingRecord,
  type GraphRunRecord,
} from "../graph/types";
import type { GraphMessagesHost } from "./graphMessages";

const GRAPH_EXTENSION_INITIAL_PLANNER_MAX_CONCURRENT_NODES = 1;
const GRAPH_EXTENSION_EXECUTOR_MAX_CONCURRENT_NODES = GRAPH_DEFAULT_MAX_CONCURRENT_NODES;
const GRAPH_EXTENSION_MAX_REPLANNING_NODES = 3;

export type PromptRunInput = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  model?: string;
  loopMainModel?: string;
  loopSubtaskModel?: string;
  loopMainThinkingMode?: ThinkingMode;
  loopSubtaskThinkingMode?: ThinkingMode;
  loopMainModelFallback?: string;
  loopSubtaskModelFallback?: string;
  loopExecutionMode?: LoopExecutionMode;
  loopContinuePrompt?: string;
  imagePaths?: string[];
  taskRole?: LoopTaskRole;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
  graphRunId?: string;
  graphNodeId?: string;
  executionCwd?: string;
  isolateProjectInstructions?: boolean;
  skipLongTermMemoryPersist?: boolean;
  thinkingModeOverride?: ThinkingMode;
  throwOnError?: boolean;
};

export type PromptRunTarget = {
  tabId: string;
  cli: CliName;
  sessionId: string | null;
};


export type ResolvedOpenCodeRoleModelsForGraph = {
  main: string | null;
  subtask: string | null;
  fallback: Partial<Record<OpenCodeCanonicalModelRole, string>>;
};

export type GraphRuntimeHostDeps = {
  getActiveWorkspaceKey: () => string;
  getActiveConversationTabId: () => string | null;
  resolvePromptRunTarget: (tabId: string | null) => PromptRunTarget | null;
  resolveGraphRunSessionId: (target: PromptRunTarget) => string | null;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  getSelectedLoopCliModel: (cli: CliName, role: "main" | "subtask", configId?: string | null) => string | null;
  getSelectedLoopThinkingMode: (cli: CliName, role: "main" | "subtask", model?: string | null, configId?: string | null) => ThinkingMode | null;
  normalizeThinkingModeForCli: (cli: CliName, mode: ThinkingMode) => ThinkingMode;
  getEffectiveThinkingMode: (cli: CliName, model?: string | null) => ThinkingMode;
  getGlobalLoopSubtaskMaxThinkingMode: () => ThinkingMode;
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  resolveOpenCodeRoleModelsForConfig: (configId: string | null, configContent: string) => ResolvedOpenCodeRoleModelsForGraph;
  createMessageId: () => string;
  resolveWorkspaceCwd: () => string | undefined;
  postPanelState: () => Promise<void>;
  persistGraphRunTickState: (run: GraphRunRecord) => GraphRunRecord;
  scheduleGraphRunAutoWake: (run: GraphRunRecord) => void;
  sendRunStatusForTab: (tabId: string, status: "start" | "end" | "error" | "stopped", options?: {
    message?: string;
    prompt?: string;
    startedAt?: number;
    graphRunId?: string;
    graphNodeId?: string;
  }) => void;
  createGraphNodeRunTarget: (cli: CliName, graphRunId: string, graphNodeId: string) => PromptRunTarget;
  runPrompt: (input: PromptRunInput, options?: { targetTabId?: string | null }) => Promise<void>;
  closeConversationTabAndRefreshPanel: (tabId: string) => Promise<void>;
  errorToMessage: (error: unknown) => string;
  messages: GraphMessagesHost;
};

export function createGraphRuntimeHost(deps: GraphRuntimeHostDeps) {
function normalizePromptRunModel(value: string | undefined): string | undefined {
  return normalizeCliModelName(value) ?? undefined;
}

function resolvePromptRunModelForRole(input: PromptRunInput, role: GraphModelRole): string | undefined {
  const mainModel = normalizePromptRunModel(input.loopMainModel) ?? normalizePromptRunModel(input.model);
  const subtaskModel = normalizePromptRunModel(input.loopSubtaskModel)
    ?? normalizePromptRunModel(input.model)
    ?? mainModel;
  return role === "subtask"
    ? (subtaskModel ?? mainModel)
    : (mainModel ?? subtaskModel);
}

function resolvePromptRunThinkingModeForRole(
  input: PromptRunInput,
  cli: CliName,
  role: GraphModelRole,
  model: string | undefined,
  options: { applySubtaskCap?: boolean } = {}
): ThinkingMode | undefined {
  const roleModel = normalizePromptRunModel(model)
    ?? resolvePromptRunModelForRole(input, role)
    ?? deps.getSelectedCliModel(cli)
    ?? undefined;
  const explicitThinkingMode = role === "subtask"
    ? input.loopSubtaskThinkingMode
    : input.loopMainThinkingMode;
  const roleThinkingMode = cli === "codex" && deps.isThinkingMode(explicitThinkingMode)
    ? deps.normalizeThinkingModeForCli(cli, explicitThinkingMode)
    : cli === "codex"
      ? deps.getSelectedLoopThinkingMode(cli, role, roleModel) ?? undefined
      : undefined;
  const resolvedThinkingMode = roleThinkingMode
    ?? (options.applySubtaskCap && role === "subtask"
      ? deps.getEffectiveThinkingMode(cli, roleModel ?? deps.getSelectedCliModel(cli))
      : undefined);
  if (!resolvedThinkingMode) {
    return undefined;
  }
  return options.applySubtaskCap && role === "subtask"
    ? resolveLoopSubtaskThinkingMode(resolvedThinkingMode, deps.getGlobalLoopSubtaskMaxThinkingMode())
    : resolvedThinkingMode;
}

function resolvePromptRunModelFallback(input: PromptRunInput, role: GraphModelRole): string {
  if (role === "main") {
    if (input.loopMainModelFallback) {
      return input.loopMainModelFallback;
    }
    if (normalizePromptRunModel(input.loopMainModel)) {
      return "none";
    }
    if (normalizePromptRunModel(input.model)) {
      return "loop main model missing; using selected single model";
    }
    if (normalizePromptRunModel(input.loopSubtaskModel)) {
      return "loop main model missing; using subtask model";
    }
    return "no explicit model selected; CLI default applies";
  }
  if (input.loopSubtaskModelFallback) {
    return input.loopSubtaskModelFallback;
  }
  if (normalizePromptRunModel(input.loopSubtaskModel)) {
    return "none";
  }
  if (normalizePromptRunModel(input.model)) {
    return "loop subtask model missing; using selected single model";
  }
  if (normalizePromptRunModel(input.loopMainModel)) {
    return "loop subtask model missing; using main model";
  }
  return "no explicit model selected; CLI default applies";
}

function buildGraphRunModelRouting(input: PromptRunInput): GraphRunModelRoutingRecord {
  const plannerModel = resolvePromptRunModelForRole(input, "main");
  const executorModel = resolvePromptRunModelForRole(input, "subtask");
  const plannerFallback = resolvePromptRunModelFallback(input, "main");
  const executorFallback = resolvePromptRunModelFallback(input, "subtask");
  return {
    planner: {
      role: "main",
      ...(plannerModel ? { model: plannerModel } : {}),
      ...(plannerFallback !== "none" ? { fallback: plannerFallback } : {}),
    },
    executor: {
      role: "subtask",
      ...(executorModel ? { model: executorModel } : {}),
      ...(executorFallback !== "none" ? { fallback: executorFallback } : {}),
    },
  };
}

function applyGraphNodeModelRoute(
  node: GraphNodeRecord,
  route: GraphRunModelRoutingRecord["planner"],
): GraphNodeRecord {
  const rest: GraphNodeRecord = { ...node };
  delete rest.modelRole;
  delete rest.model;
  delete rest.modelFallback;
  return {
    ...rest,
    modelRole: route.role,
    ...(route.model ? { model: route.model } : {}),
    ...(route.fallback ? { modelFallback: route.fallback } : {}),
  };
}

function applyGraphRunModelRouting(run: GraphRunRecord): GraphRunRecord {
  const routing = run.modelRouting;
  if (!routing) {
    return run;
  }
  return {
    ...run,
    nodes: run.nodes.map((node) => applyGraphNodeModelRoute(
      node,
      resolveGraphNodeModelRoute(node, routing),
    )),
  };
}

function resolveGraphNodeModelRoute(
  node: GraphNodeRecord,
  routing: GraphRunModelRoutingRecord,
): GraphRunModelRoutingRecord["planner"] {
  return node.kind === "plan" || node.kind === "summary"
    ? routing.planner
    : routing.executor;
}

function resolveGraphResumePromptModels(
  run: GraphRunRecord,
  cli: CliName,
  configId: string | null,
): Pick<PromptRunInput, "model" | "loopMainModel" | "loopSubtaskModel" | "loopMainModelFallback" | "loopSubtaskModelFallback"> {
  if (cli !== "codex" && cli !== "opencode") {
    const selectedModel = deps.getSelectedCliModel(cli, configId) ?? undefined;
    return selectedModel ? { model: selectedModel } : {};
  }
  const loopMainModel = run.modelRouting?.planner.model
    ?? deps.getSelectedLoopCliModel(cli, "main", configId)
    ?? deps.getSelectedCliModel(cli, configId)
    ?? undefined;
  const loopSubtaskModel = run.modelRouting?.executor.model
    ?? deps.getSelectedLoopCliModel(cli, "subtask", configId)
    ?? deps.getSelectedCliModel(cli, configId)
    ?? loopMainModel
    ?? undefined;
  return {
    ...(loopMainModel ? { model: loopMainModel, loopMainModel } : {}),
    ...(loopSubtaskModel ? { loopSubtaskModel } : {}),
    ...(run.modelRouting?.planner.fallback ? { loopMainModelFallback: run.modelRouting.planner.fallback } : {}),
    ...(run.modelRouting?.executor.fallback ? { loopSubtaskModelFallback: run.modelRouting.executor.fallback } : {}),
  };
}

async function hydrateOpenCodePromptRoleModels(input: PromptRunInput, cli: CliName): Promise<PromptRunInput> {
  if (cli !== "opencode") {
    return input;
  }
  const configId = deps.getActiveConfigIdForCli("opencode");
  const activeConfig = configId
    ? await configService.getConfigById("opencode", configId)
    : null;
  const current = activeConfig ?? await configService.getCurrentConfig("opencode");
  const roles = deps.resolveOpenCodeRoleModelsForConfig(configId, current.content ?? "{}");
  const explicitMain = normalizePromptRunModel(input.loopMainModel);
  const explicitSubtask = normalizePromptRunModel(input.loopSubtaskModel);
  const explicitSingle = normalizePromptRunModel(input.model);
  const loopMainModel = explicitMain ?? explicitSingle ?? roles.main ?? undefined;
  const loopSubtaskModel = explicitSubtask ?? roles.subtask ?? explicitSingle ?? loopMainModel ?? undefined;
  return {
    ...input,
    ...(loopMainModel ? { model: loopMainModel, loopMainModel } : {}),
    ...(loopSubtaskModel ? { loopSubtaskModel } : {}),
    ...(roles.fallback.main ? { loopMainModelFallback: roles.fallback.main } : {}),
    ...(roles.fallback.subtask ? { loopSubtaskModelFallback: roles.fallback.subtask } : {}),
  };
}


async function runGraphPrompt(
  input: PromptRunInput,
  options: { targetTabId?: string | null } = {}
): Promise<void> {
  const target = deps.resolvePromptRunTarget(options.targetTabId ?? deps.getActiveConversationTabId());
  if (!target || !input.displayPrompt.trim()) {
    return;
  }
  let run: GraphRunRecord | null = null;
  try {
    run = await runGraphPromptOrchestration(input, options);
  } catch (error) {
    const failureMessage = deps.errorToMessage(error);
    void logError("graph-orchestration-unhandled-error", {
      graphRunId: run?.id ?? null,
      tabId: target.tabId,
      cli: target.cli,
      error: failureMessage,
    });
    if (run) {
      run = updateGraphRunRecord(run.id, {
        status: "error",
        updatedAt: Date.now(),
      }) ?? run;
      appendGraphEvent(run.eventsFile, {
        runId: run.id,
        type: "run.error",
        summary: failureMessage,
        error: failureMessage,
      });
      sendGraphMainRunTerminalStatus(target, run);
    }
    deps.messages.appendSystemMessageForGraph(target, deps.messages.buildGraphRunErrorText(run?.id ?? null, failureMessage), run?.id);
  } finally {
    await deps.postPanelState();
  }
}

async function runGraphPromptOrchestration(
  input: PromptRunInput,
  options: { targetTabId?: string | null } = {}
): Promise<GraphRunRecord | null> {
  const target = deps.resolvePromptRunTarget(options.targetTabId ?? deps.getActiveConversationTabId());
  if (!target || !input.displayPrompt.trim()) {
    return null;
  }
  input = await hydrateOpenCodePromptRoleModels(input, target.cli);

  scheduleLogRetentionCleanup();
  const graphRunId = `graph_${deps.createMessageId()}`;
  const workspaceCwd = deps.resolveWorkspaceCwd();
  if (!workspaceCwd) {
    throw new Error("Graph mode requires an active workspace.");
  }
  const executionSetup = createGraphRunExecutionSetup(workspaceCwd, graphRunId);
  const modelRouting = buildGraphRunModelRouting(input);
  let run = createGraphRunRecord({
    id: graphRunId,
    workspaceKey: deps.getActiveWorkspaceKey(),
    cli: target.cli,
    sessionId: deps.resolveGraphRunSessionId(target),
    rootPrompt: input.displayPrompt,
    status: "running",
    templateId: GRAPH_AI_PLANNER_TEMPLATE_ID,
    templateVersion: GRAPH_AI_PLANNER_TEMPLATE_VERSION,
    nodes: buildGraphPlanningRunNodes(graphRunId)
      .map((node) => applyGraphNodeModelRoute(node, modelRouting.planner)),
    edges: buildGraphPlanningRunEdges(),
    maxConcurrent: GRAPH_EXTENSION_INITIAL_PLANNER_MAX_CONCURRENT_NODES,
    executionMode: executionSetup.executionMode,
    ...(executionSetup.directExecution ? { directExecution: executionSetup.directExecution } : {}),
    ...(executionSetup.worktree ? { worktree: executionSetup.worktree } : {}),
    modelRouting,
  });
  appendGraphEvent(run.eventsFile, {
    runId: run.id,
    type: "run.created",
    summary: `Graph run ${run.id} created in direct workspace mode with ${run.nodes.length} nodes.`,
    data: {
      nodeIds: run.nodes.map((node) => node.id),
      plannerNodeId: GRAPH_AI_PLANNER_NODE_ID,
      maxConcurrent: run.maxConcurrent,
      executionMode: executionSetup.executionMode,
      worktree: executionSetup.worktree,
      directExecution: executionSetup.directExecution,
      fallbackReason: executionSetup.fallbackReason,
      modelRouting: run.modelRouting,
    },
  });
  deps.messages.appendSystemMessageForGraph(target, deps.messages.buildGraphRunStartedText(run), run.id);
  await deps.postPanelState();

  const outcome = await tickGraphRunToPause(run, input, target);
  return outcome.run;
}

async function tickGraphRunToPause(
  initialRun: GraphRunRecord,
  input: PromptRunInput,
  target: PromptRunTarget,
): Promise<{ run: GraphRunRecord; progressed: boolean }> {
  let run = initialRun;
  sendGraphMainRunStarted(target, run, input.displayPrompt);
  const executor = {
    execute: async (request: GraphNodeExecutionRequest) => executeGraphNodeViaRunPrompt(request, input, target),
  };
  let madeProgress = false;
  let tickIndex = 0;
  while (tickIndex < Math.max(12, run.nodes.length * 6)) {
    tickIndex += 1;
    const tickResult = await tickGraphRun(run, {
      executor,
      appendEvent: (eventRun, event) => appendGraphEvent(eventRun.eventsFile, event),
      persistRun: deps.persistGraphRunTickState,
    }, {
      maxConcurrent: resolveGraphExtensionExecutorMaxConcurrent(run),
    });
    run = tickResult.run;
    const planMaterialization = maybeMaterializeGraphPlanAfterTick(run);
    run = planMaterialization.run;
    await deps.postPanelState();

    if (planMaterialization.changed && run.status === "running") {
      madeProgress = true;
      deps.scheduleGraphRunAutoWake(run);
      continue;
    }

    const directRework = await maybeRequestGraphDirectReworkAfterTick(run, tickResult.failedNodeIds);
    if (directRework.changed && directRework.run.status === "running") {
      run = directRework.run;
      madeProgress = true;
      await deps.postPanelState();
      deps.scheduleGraphRunAutoWake(run);
      continue;
    }

    const dynamicReplanTriggerNodeIds = [...tickResult.failedNodeIds, ...tickResult.blockedNodeIds];
    if (dynamicReplanTriggerNodeIds.length > 0) {
      const dynamicReplan = maybeAppendGraphReplanningNodeAfterTick(
        run,
        dynamicReplanTriggerNodeIds,
        "Graph node failed or blocked and needs main-model replanning.",
      );
      if (dynamicReplan.changed && dynamicReplan.run.status === "running") {
        run = dynamicReplan.run;
        madeProgress = true;
        await deps.postPanelState();
        deps.scheduleGraphRunAutoWake(run);
        continue;
      }
    }

    if (run.status === "completed") {
      const mergeBack = finalizeCompletedGraphRunWorktreeMergeBack(run);
      run = mergeBack.run;
      deps.scheduleGraphRunAutoWake(run);
      sendGraphMainRunTerminalStatus(target, run);
      if (run.status === "completed") {
        deps.messages.appendSystemMessageForGraph(target, deps.messages.buildGraphRunCompletedText(run, mergeBack), run.id);
        deps.messages.appendGraphFinalSummaryMessage(target, run);
      } else {
        deps.messages.appendSystemMessageForGraph(
          target,
          deps.messages.buildGraphRunNeedsAttentionText(run, mergeBack),
          run.id,
        );
      }
      return { run, progressed: true };
    }
    if (run.status === "needs-review" || run.status === "sleeping" || run.status === "error" || run.status === "stopped") {
      deps.scheduleGraphRunAutoWake(run);
      sendGraphMainRunTerminalStatus(target, run);
      deps.messages.appendSystemMessageForGraph(
        target,
        deps.messages.buildGraphRunNeedsAttentionText(run),
        run.id,
      );
      return { run, progressed: true };
    }
    const progressed = tickResult.startedNodeIds.length > 0
      || tickResult.completedNodeIds.length > 0
      || tickResult.failedNodeIds.length > 0
      || tickResult.blockedNodeIds.length > 0
      || tickResult.sleepingNodeIds.length > 0
      || tickResult.systemActions.length > 0
      || tickResult.pendingActions.length > 0
      || planMaterialization.changed;
    madeProgress = madeProgress || progressed;
    deps.scheduleGraphRunAutoWake(run);
    if (!progressed) {
      const idleReplan = maybeAppendGraphReplanningNodeAfterTick(
        run,
        [],
        "Graph run made no progress and needs main-model replanning.",
      );
      if (idleReplan.changed && idleReplan.run.status === "running") {
        run = idleReplan.run;
        madeProgress = true;
        await deps.postPanelState();
        deps.scheduleGraphRunAutoWake(run);
        continue;
      }
      run = updateGraphRunRecord(run.id, {
        status: "needs-review",
        updatedAt: Date.now(),
      }) ?? run;
      deps.scheduleGraphRunAutoWake(run);
      sendGraphMainRunTerminalStatus(target, run);
      deps.messages.appendSystemMessageForGraph(target, deps.messages.buildGraphRunIdleText(run), run.id);
      return { run, progressed: false };
    }
  }

  run = updateGraphRunRecord(run.id, {
    status: "error",
    updatedAt: Date.now(),
  }) ?? run;
  appendGraphEvent(run.eventsFile, {
    runId: run.id,
    type: "run.error",
    summary: `Graph run ${run.id} exceeded the extension runtime tick guard.`,
  });
  deps.scheduleGraphRunAutoWake(run);
  sendGraphMainRunTerminalStatus(target, run);
  deps.messages.appendSystemMessageForGraph(target, deps.messages.buildGraphRunErrorText(run.id, "Graph run exceeded the extension runtime tick guard."), run.id);
  return { run, progressed: madeProgress };
}

async function maybeRequestGraphDirectReworkAfterTick(
  run: GraphRunRecord,
  failedNodeIds: readonly string[],
): Promise<{ run: GraphRunRecord; changed: boolean }> {
  for (const nodeId of failedNodeIds) {
    const node = run.nodes.find((item) => item.id === nodeId);
    if (!shouldAutoRequestGraphDirectRework(node)) {
      continue;
    }
    const control = await directReworkGraphNodeForRun(run, nodeId, {
      source: "system",
      reason: node?.lastError,
      summary: `Graph node ${nodeId} failed and requested direct upstream rework.`,
      appendEvent: (eventRun, event) => appendGraphEvent(eventRun.eventsFile, event),
    });
    if (!control.ok || !control.changed) {
      continue;
    }
    return {
      run: deps.persistGraphRunTickState(control.run),
      changed: true,
    };
  }
  return { run, changed: false };
}

function shouldAutoRequestGraphDirectRework(node: GraphNodeRecord | undefined): node is GraphNodeRecord {
  if (!node || node.status !== "failed") {
    return false;
  }
  const recovery = node.failure?.recommendedRecovery;
  if (recovery?.action !== "direct_rework" || !recovery.targetNodeId) {
    return false;
  }
  return !(node.rework?.sourceNodeId === node.id && node.rework.targetNodeId === recovery.targetNodeId);
}

function maybeAppendGraphReplanningNodeAfterTick(
  run: GraphRunRecord,
  triggerNodeIds: readonly string[],
  reason: string,
): { run: GraphRunRecord; changed: boolean } {
  const selectedTriggerNodeIds = selectGraphReplanningTriggerNodeIds(run, triggerNodeIds);
  if (triggerNodeIds.length > 0 && selectedTriggerNodeIds.length === 0) {
    return { run, changed: false };
  }
  if (!shouldAppendGraphReplanningNode(run, selectedTriggerNodeIds)) {
    return { run, changed: false };
  }
  const appended = appendGraphReplanningNode(run, {
    triggerNodeIds: selectedTriggerNodeIds,
    reason,
  });
  if (!appended.changed) {
    return { run, changed: false };
  }
  const routedRun = applyGraphRunModelRouting(appended.run);
  const persisted = deps.persistGraphRunTickState(routedRun);
  appendGraphEvent(persisted.eventsFile, {
    runId: persisted.id,
    type: "run.updated",
    summary: `Graph run ${persisted.id} appended ${appended.nodeId} for main-model replanning.`,
    data: {
      replanningNodeId: appended.nodeId,
      triggerNodeIds: appended.triggerNodeIds,
      reason,
    },
  });
  return { run: persisted, changed: true };
}

function shouldAppendGraphReplanningNode(
  run: GraphRunRecord,
  triggerNodeIds: readonly string[],
): boolean {
  if (run.status !== "running") {
    return false;
  }
  const replanningNodes = run.nodes.filter(isGraphAiReplannerNode);
  if (replanningNodes.length >= GRAPH_EXTENSION_MAX_REPLANNING_NODES) {
    return false;
  }
  if (replanningNodes.some((node) => node.status === "pending" || node.status === "running" || node.status === "ready")) {
    return false;
  }
  if (triggerNodeIds.length === 0) {
    return replanningNodes.every((node) => node.status !== "failed" && node.status !== "blocked");
  }
  return true;
}

function selectGraphReplanningTriggerNodeIds(
  run: GraphRunRecord,
  triggerNodeIds: readonly string[],
): string[] {
  const uniqueNodeIds = Array.from(new Set(triggerNodeIds));
  return uniqueNodeIds.filter((nodeId) => {
    const node = run.nodes.find((item) => item.id === nodeId);
    if (!node || isGraphAiReplannerNode(node)) {
      return false;
    }
    if (node.status === "blocked") {
      return true;
    }
    if (node.status !== "failed") {
      return false;
    }
    return node.kind === "review"
      || node.attempts >= node.maxAttempts
      || node.failure?.recommendedRecovery?.action === "add_rework_node"
      || node.failure?.recommendedRecovery?.action === "add_write_scope"
      || node.failure?.recommendedRecovery?.action === "manual_review";
  });
}

function sendGraphMainRunStarted(target: PromptRunTarget, run: GraphRunRecord, prompt: string): void {
  deps.sendRunStatusForTab(target.tabId, "start", {
    prompt,
    startedAt: run.createdAt,
    graphRunId: run.id,
  });
}

function isGraphRunBlockedForMainTab(run: GraphRunRecord): boolean {
  return run.status === "needs-review" && Boolean(selectGraphBlockedAttentionNode(run));
}

function resolveGraphMainRunStatusEvent(run: GraphRunRecord): "end" | "error" | "stopped" | null {
  if (run.status === "completed") {
    return "end";
  }
  if (run.status === "error" || isGraphRunBlockedForMainTab(run)) {
    return "error";
  }
  if (run.status === "stopped") {
    return "stopped";
  }
  return null;
}

function sendGraphMainRunTerminalStatus(target: PromptRunTarget, run: GraphRunRecord): void {
  const status = resolveGraphMainRunStatusEvent(run);
  if (!status) {
    return;
  }
  deps.sendRunStatusForTab(target.tabId, status);
}

function selectGraphBlockedAttentionNode(run: GraphRunRecord): GraphNodeRecord | null {
  const blockedNodes = run.nodes
    .filter((node) => node.status === "blocked" || node.status === "failed")
    .sort((left, right) => {
      const leftTime = left.completedAt ?? left.startedAt ?? 0;
      const rightTime = right.completedAt ?? right.startedAt ?? 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return run.nodes.indexOf(right) - run.nodes.indexOf(left);
    });
  return blockedNodes[0] ?? null;
}

type GraphRunMergeBackOutcome = {
  run: GraphRunRecord;
  status: "merged" | "direct" | "failed";
  message: string;
  result?: GraphWorktreeMergeBackResult;
  cleanup?: GraphWorktreeCleanupResult;
  error?: string;
};

function finalizeCompletedGraphRunWorktreeMergeBack(run: GraphRunRecord): GraphRunMergeBackOutcome {
  const timestamp = Date.now();
  if (run.executionMode === "direct" && run.directExecution?.cwd) {
    const nextRun = updateGraphRunRecord(run.id, {
      updatedAt: timestamp,
    }) ?? { ...run, updatedAt: timestamp };
    appendGraphEvent(nextRun.eventsFile, {
      runId: nextRun.id,
      type: "run.updated",
      timestamp,
      summary: `Graph run completed in direct workspace mode without worktree merge-back: ${run.directExecution.cwd}`,
      data: {
        executionMode: "direct",
        directExecution: run.directExecution,
      },
    });
    return {
      run: nextRun,
      status: "direct",
      message: `- Direct workspace: executed directly in ${run.directExecution.cwd}; no git worktree, checkpoint, merge-back, or cleanup was used.`,
    };
  }
  const workspaceCwd = deps.resolveWorkspaceCwd();
  if (!workspaceCwd || !run.worktree) {
    const error = !workspaceCwd
      ? "Graph run completed but no active workspace was available for merge-back."
      : "Graph run completed but has no worktree metadata for merge-back.";
    const nextRun = updateGraphRunRecord(run.id, {
      status: "needs-review",
      updatedAt: timestamp,
    }) ?? { ...run, status: "needs-review" as const, updatedAt: timestamp };
    appendGraphEvent(nextRun.eventsFile, {
      runId: nextRun.id,
      type: "run.updated",
      timestamp,
      summary: `Graph worktree merge-back failed: ${error}`,
      error,
      data: { workspaceCwd, worktree: run.worktree },
    });
    return {
      run: nextRun,
      status: "failed",
      message: `- Merge-back: failed; ${error}`,
      error,
    };
  }

  try {
    const result = mergeGraphRunWorktreeToWorkspace({ workspaceCwd, worktree: run.worktree });
    let cleanup: GraphWorktreeCleanupResult;
    try {
      cleanup = cleanupGraphRunWorktree({ workspaceCwd, worktree: run.worktree });
    } catch (cleanupError) {
      const cleanupMessage = deps.errorToMessage(cleanupError);
      const nextRun = updateGraphRunRecord(run.id, {
        status: "needs-review",
        updatedAt: timestamp,
      }) ?? { ...run, status: "needs-review" as const, updatedAt: timestamp };
      appendGraphEvent(nextRun.eventsFile, {
        runId: nextRun.id,
        type: "run.updated",
        timestamp,
        summary: `Graph worktree cleanup failed after merge-back: ${cleanupMessage}`,
        error: cleanupMessage,
        data: {
          workspaceCwd,
          worktree: run.worktree,
          mergeBack: {
            repoRoot: result.repoRoot,
            worktreeCwd: result.worktreeCwd,
            sourceBranch: result.sourceBranch,
            sourceCommit: result.sourceCommit,
            statusAfter: result.statusAfter,
          },
        },
      });
      return {
        run: nextRun,
        status: "failed",
        message: `- Merge-back: applied Graph worktree changes to ${result.repoRoot} with git merge --squash; cleanup failed: ${cleanupMessage}`,
        result,
        error: cleanupMessage,
      };
    }
    const nextRun = updateGraphRunRecord(run.id, {
      updatedAt: timestamp,
      worktree: undefined,
    }) ?? { ...run, updatedAt: timestamp, worktree: undefined };
    appendGraphEvent(nextRun.eventsFile, {
      runId: nextRun.id,
      type: "run.updated",
      timestamp,
      summary: `Graph worktree merged back into workspace and cleaned up without committing: ${result.repoRoot}`,
      data: {
        workspaceCwd: result.workspaceCwd,
        repoRoot: result.repoRoot,
        worktreeCwd: result.worktreeCwd,
        sourceBranch: result.sourceBranch,
        sourceCommit: result.sourceCommit,
        targetHeadBefore: result.targetHeadBefore,
        targetHeadAfter: result.targetHeadAfter,
        statusAfter: result.statusAfter,
        mergeOutput: result.mergeOutput,
        cleanup,
      },
    });
    return {
      run: nextRun,
      status: "merged",
      message: `- Merge-back: applied Graph worktree changes to ${result.repoRoot} with git merge --squash; no commit was created. Cleaned up worktree ${cleanup.worktreeCwd} and branch ${cleanup.sourceBranch}.`,
      result,
      cleanup,
    };
  } catch (error) {
    const message = deps.errorToMessage(error);
    const nextRun = updateGraphRunRecord(run.id, {
      status: "needs-review",
      updatedAt: timestamp,
    }) ?? { ...run, status: "needs-review" as const, updatedAt: timestamp };
    appendGraphEvent(nextRun.eventsFile, {
      runId: nextRun.id,
      type: "run.updated",
      timestamp,
      summary: `Graph worktree merge-back failed: ${message}`,
      error: message,
      data: { workspaceCwd, worktree: run.worktree },
    });
    return {
      run: nextRun,
      status: "failed",
      message: `- Merge-back: failed; ${message}`,
      error: message,
    };
  }
}

function resolveGraphExtensionExecutorMaxConcurrent(run: Pick<GraphRunRecord, "maxConcurrent">): number {
  return Math.max(1, Math.min(run.maxConcurrent, GRAPH_EXTENSION_EXECUTOR_MAX_CONCURRENT_NODES));
}

function maybeMaterializeGraphPlanAfterTick(run: GraphRunRecord): { run: GraphRunRecord; changed: boolean } {
  if (run.templateId !== GRAPH_AI_PLANNER_TEMPLATE_ID) {
    return { run, changed: false };
  }
  const plannerNode = run.nodes.find((node) => isGraphPlannerNodeReadyForMaterialization(run, node));
  if (!plannerNode) {
    return { run, changed: false };
  }

  const artifact = readGraphNodeExecutionResultArtifact(resolveGraphNodeCommunicationFile(run, plannerNode));
  if (!artifact?.plannedGraph) {
    return {
      run: failGraphPlannerRun(run, plannerNode.id, "Graph planner passed without a valid plannedGraph DAG artifact."),
      changed: true,
    };
  }

  const appendMode = plannerNode.id !== GRAPH_AI_PLANNER_NODE_ID;
  const materialized = materializeGraphPlan(run, artifact.plannedGraph, {
    plannerNodeId: plannerNode.id,
    ...(appendMode ? { mode: "append" as const } : {}),
  });
  if (materialized.error) {
    return {
      run: failGraphPlannerRun(run, plannerNode.id, materialized.error),
      changed: true,
    };
  }
  if (!materialized.changed) {
    return { run, changed: false };
  }

  const routedRun = applyGraphRunModelRouting(materialized.run);
  const persisted = updateGraphRunRecord(routedRun.id, routedRun) ?? routedRun;
  appendGraphEvent(persisted.eventsFile, {
    runId: persisted.id,
    type: "run.updated",
    summary: `${appendMode ? "Graph replanner" : "Graph planner"} materialized ${materialized.plannedNodeIds.length} execution nodes.`,
    data: {
      plannerNodeId: plannerNode.id,
      appendMode,
      plannedNodeIds: materialized.plannedNodeIds,
      maxConcurrent: persisted.maxConcurrent,
      modelRouting: persisted.modelRouting,
    },
  });
  return { run: persisted, changed: true };
}

function isGraphPlannerNodeReadyForMaterialization(run: GraphRunRecord, node: GraphNodeRecord): boolean {
  if (node.status !== "passed") {
    return false;
  }
  if (node.id === GRAPH_AI_PLANNER_NODE_ID) {
    return !run.nodes.some((item) => item.id !== GRAPH_AI_PLANNER_NODE_ID);
  }
  return isGraphAiReplannerNode(node)
    && !run.edges.some((edge) => edge.active && edge.kind === "depends_on" && edge.from === node.id);
}

function failGraphPlannerRun(run: GraphRunRecord, plannerNodeId: string, reason: string): GraphRunRecord {
  const timestamp = Date.now();
  const nodes = run.nodes.map((node) => node.id === plannerNodeId
    ? {
      ...node,
      status: "failed" as const,
      completedAt: timestamp,
      lastError: reason,
    }
    : node);
  const nextRun = updateGraphRunRecord(run.id, {
    status: "running",
    updatedAt: timestamp,
    activeNodeIds: [],
    nodes,
  }) ?? {
    ...run,
    status: "running" as const,
    updatedAt: timestamp,
    activeNodeIds: [],
    nodes,
  };
  appendGraphEvent(nextRun.eventsFile, {
    runId: nextRun.id,
    type: "node.failed",
    timestamp,
    nodeId: plannerNodeId,
    attempt: nodes.find((node) => node.id === plannerNodeId)?.attempts,
    summary: reason,
    error: reason,
  });
  appendGraphEvent(nextRun.eventsFile, {
    runId: nextRun.id,
    type: "run.updated",
    timestamp,
    summary: `Graph run ${nextRun.id} paused because planner output could not be materialized.`,
    data: {
      plannerNodeId,
      reason,
    },
  });
  return nextRun;
}

type GraphNodeExecutionContext = {
  mode: "worktree";
  cwd: string;
  worktreeCwd: string;
} | {
  mode: "direct";
  cwd: string;
};

function resolveGraphNodeExecutionContext(run: GraphRunRecord): GraphNodeExecutionContext | null {
  if (run.directExecution?.cwd) {
    return {
      mode: "direct",
      cwd: run.directExecution.cwd,
    };
  }
  if (run.worktree?.cwd) {
    return {
      mode: "worktree",
      cwd: run.worktree.cwd,
      worktreeCwd: run.worktree.cwd,
    };
  }
  return null;
}

async function executeGraphNodeViaRunPrompt(
  request: GraphNodeExecutionRequest,
  rootInput: PromptRunInput,
  target: PromptRunTarget,
) {
  const executionContext = resolveGraphNodeExecutionContext(request.run);
  if (!executionContext) {
    return {
      status: "failed" as const,
      summary: `Graph node ${request.node.id} has no execution directory.`,
      error: "Graph run is missing both worktree and direct execution metadata.",
    };
  }

  let baseCommit: string | undefined;
  if (executionContext.mode === "worktree") {
    try {
      baseCommit = getGraphWorktreeHeadCommit(executionContext.worktreeCwd);
    } catch (error) {
      return {
        status: "failed" as const,
        summary: `Graph node ${request.node.id} could not read worktree HEAD.`,
        error: deps.errorToMessage(error),
        executionCwd: executionContext.cwd,
        worktreeCwd: executionContext.worktreeCwd,
      };
    }
  }

  const communicationFile = resolveGraphNodeCommunicationFile(request.run, request.node);
  const graphNodeTarget = deps.createGraphNodeRunTarget(target.cli, request.run.id, request.node.id);
  deps.messages.appendSystemMessageForGraph(
    target,
    deps.messages.buildGraphNodeDispatchedText(request.run, request.node, graphNodeTarget, communicationFile),
    request.run.id,
  );
  deps.messages.appendSystemMessageForGraph(
    graphNodeTarget,
    deps.messages.buildGraphNodeStartedText(request.run, request.node, communicationFile),
    request.run.id,
  );

  const modelRole = request.modelRole
    ?? request.node.modelRole
    ?? (request.node.kind === "plan" || request.node.kind === "summary" ? "main" : "subtask");
  const selectedModel = request.model ?? resolvePromptRunModelForRole(rootInput, modelRole);
  const modelFallback = request.modelFallback ?? resolvePromptRunModelFallback(rootInput, modelRole);
  const thinkingModeOverride = resolvePromptRunThinkingModeForRole(rootInput, target.cli, modelRole, selectedModel);
  appendGraphEvent(request.run.eventsFile, {
    runId: request.run.id,
    type: "run.updated",
    nodeId: request.node.id,
    attempt: request.attempt,
    summary: `Graph node ${request.node.id} dispatched with ${modelRole} model role.`,
    data: {
      nodeId: request.node.id,
      modelRole,
      model: selectedModel ?? null,
      modelFallback,
      thinkingMode: thinkingModeOverride ?? null,
      modelRouting: request.run.modelRouting,
    },
  });
  void logInfo("graph-node-model-routing", {
    graphRunId: request.run.id,
    nodeId: request.node.id,
    modelRole,
    model: selectedModel ?? null,
    modelFallback,
    thinkingMode: thinkingModeOverride ?? null,
  });

  let runPromptError: unknown;
  try {
    await deps.runPrompt({
      displayPrompt: request.prompt,
      modelPrompt: request.prompt,
      contextTags: rootInput.contextTags,
      model: selectedModel,
      loopMainModel: rootInput.loopMainModel,
      loopSubtaskModel: rootInput.loopSubtaskModel,
      imagePaths: rootInput.imagePaths,
      taskRole: modelRole,
      thinkingModeOverride,
      graphRunId: request.run.id,
      graphNodeId: request.node.id,
      executionCwd: executionContext.cwd,
      isolateProjectInstructions: true,
      skipLongTermMemoryPersist: true,
      throwOnError: true,
    }, {
      targetTabId: graphNodeTarget.tabId,
    });
  } catch (error) {
    runPromptError = error;
  } finally {
    try {
      await deps.closeConversationTabAndRefreshPanel(graphNodeTarget.tabId);
      void logInfo("graph-node-tab-auto-closed", {
        graphRunId: request.run.id,
        nodeId: request.node.id,
        tabId: graphNodeTarget.tabId,
      });
    } catch (error) {
      void logError("graph-node-tab-auto-close-error", {
        graphRunId: request.run.id,
        nodeId: request.node.id,
        tabId: graphNodeTarget.tabId,
        error: deps.errorToMessage(error),
      });
    }
  }

  const artifactResult = readGraphNodeExecutionResultArtifact(communicationFile);
  const executionResult = artifactResult ?? {
    status: "failed" as const,
    summary: runPromptError
      ? `Graph node ${request.node.id} runner failed before a parseable JSON artifact was produced.`
      : `Graph node ${request.node.id} did not produce a parseable ## JSON artifact.`,
    error: runPromptError ? deps.errorToMessage(runPromptError) : "Missing or invalid Graph node ## JSON artifact.",
    artifactRef: communicationFile,
  };
  const result = runPromptError && executionResult.status === "passed"
    ? {
      ...executionResult,
      status: "failed" as const,
      error: deps.errorToMessage(runPromptError),
      summary: `Graph node ${request.node.id} runner failed despite a passed artifact.`,
    }
    : executionResult;

  let commit: string | undefined;
  if (executionContext.mode === "worktree") {
    try {
      const checkpoint = commitGraphNodeCheckpoint({
        worktreeCwd: executionContext.worktreeCwd,
        graphRunId: request.run.id,
        nodeId: request.node.id,
        status: result.status,
        baseCommit: baseCommit as string,
        summary: result.summary,
      });
      commit = checkpoint.commit;
    } catch (error) {
      return {
        status: "failed" as const,
        summary: `Graph node ${request.node.id} could not create a local checkpoint commit.`,
        error: deps.errorToMessage(error),
        artifactRef: result.artifactRef ?? communicationFile,
        acceptance: result.acceptance,
        executionCwd: executionContext.cwd,
        worktreeCwd: executionContext.worktreeCwd,
        baseCommit,
      };
    }
  }

  const executionMetadata = {
    executionCwd: executionContext.cwd,
    ...(executionContext.mode === "worktree" ? { worktreeCwd: executionContext.worktreeCwd } : {}),
    ...(baseCommit ? { baseCommit } : {}),
    ...(commit ? { commit } : {}),
  };
  if (request.node.kind === "summary" && result.status === "passed" && !result.finalAnswer) {
    return {
      ...result,
      finalAnswer: deps.messages.buildGraphRunFinalAnswer(request.run),
      artifactRef: result.artifactRef ?? communicationFile,
      ...executionMetadata,
    };
  }
  return {
    ...result,
    artifactRef: result.artifactRef ?? communicationFile,
    ...executionMetadata,
  };
}



  return {
    runGraphPrompt,
    runGraphPromptOrchestration,
    tickGraphRunToPause,
    sendGraphMainRunTerminalStatus,
    isGraphRunBlockedForMainTab,
    selectGraphBlockedAttentionNode,
    resolvePromptRunModelForRole,
    resolvePromptRunThinkingModeForRole,
    resolvePromptRunModelFallback,
    buildGraphRunModelRouting,
    applyGraphNodeModelRoute,
    applyGraphRunModelRouting,
    resolveGraphResumePromptModels,
    hydrateOpenCodePromptRoleModels,
  };
}

export type GraphRuntimeHost = ReturnType<typeof createGraphRuntimeHost>;
