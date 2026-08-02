import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import type { CliName } from "../cli/types";
import { GraphAutoWakeScheduler, resolveGraphRunAutoWakeAt, type GraphAutoWakeAttemptResult } from "../graph/graphAutoWake";
import { appendGraphEvent, readGraphEvents } from "../graph/graphEvents";
import {
  feedbackGraphNodeForRun,
  resumeGraphRunRecord,
  retryGraphNodeForRun,
  skipGraphNodeForRun,
  stopGraphRunRecord,
  type GraphRunControlResult,
  type GraphRunControlSource,
} from "../graph/graphRunControl";
import { findLatestGraphRun, listGraphRuns, readGraphRunRecord, updateGraphRunRecord } from "../graph/graphStore";
import type { GraphRunRecord } from "../graph/types";
import { createGraphRunPanelCoordinator } from "../panelDiagnostics";
import type { GraphRunPanel } from "../webview/graphRunPanel";
import type { ConversationTabRecord } from "../sessionTabs";
import type { GraphMessagesHost, GraphRuntimeMessageKey } from "./graphMessages";
import type { GraphRuntimeHost, PromptRunTarget } from "./graphRuntime";
import { logError } from "../logger";

type GraphRuntimeControlBridge = Pick<GraphRuntimeHost,
  | "resolveGraphResumePromptModels"
  | "hydrateOpenCodePromptRoleModels"
  | "tickGraphRunToPause"
  | "sendGraphMainRunTerminalStatus"
>;

type ActiveGraphRunProcess = {
  graphRunId?: string;
  stopped?: boolean;
  stop?: () => void;
};

export type GraphControlsHostDeps = {
  getExtensionUri: () => vscode.Uri;
  panelsByRunId: Map<string, GraphRunPanel>;
  getActiveWorkspaceKey: () => string;
  getCurrentCli: () => CliName;
  postPanelState: () => Promise<void>;
  resolvePromptRunTarget: (tabId: string | null) => PromptRunTarget | null;
  findConversationTabIdBySession: (cli: CliName, sessionId: string) => string | null;
  getActiveConversationTab: () => ConversationTabRecord | null;
  addConversationTab: (cli: CliName, sessionId: string | null) => string | null;
  switchVisibleConversationTabForLoop: (tabId: string) => Promise<{ cli: CliName; sessionId: string | null } | null>;
  isTabRunActive: (tabId: string | null) => boolean;
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  stopParallelRunForTab: (tabId: string, stopMessage?: string) => boolean;
  getParallelRunsByTabId: () => Map<string, ActiveGraphRunProcess>;
  getInteractiveRunsByTabId: () => Map<string, ActiveGraphRunProcess>;
  isPrimaryRunActive: () => boolean;
  getActiveTaskRun: () => { graphRunId?: string; graphNodeId?: string } | null;
  stopActiveRun: () => void;
  showInformationMessage: (message: string) => void;
  showWarningMessage: (message: string) => void;
  errorToMessage: (error: unknown) => string;
  messages: GraphMessagesHost;
  runtime: GraphRuntimeControlBridge;
  t: typeof import("../i18n").t;
};

export type GraphPanelControlResult = { ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null };

export function createGraphControlsHost(deps: GraphControlsHostDeps) {
  let graphAutoWakeScheduler: GraphAutoWakeScheduler | null = null;

  const graphRunPanelCoordinator = createGraphRunPanelCoordinator({
    getExtensionUri: deps.getExtensionUri,
    panelsByRunId: deps.panelsByRunId,
    readRunRecord: (graphRunId) => readGraphRunRecord(graphRunId),
    findLatestRun: () => findLatestGraphRun({
      workspaceKey: deps.getActiveWorkspaceKey(),
      cli: deps.getCurrentCli(),
    }),
    readEvents: readGraphEvents,
    continueRun: (graphRunId) => continueGraphRunFromPanel(graphRunId),
    supplementRun: (graphRunId, prompt) => supplementGraphRunFromPanel(graphRunId, prompt),
    retryNode: (graphRunId, nodeId) => retryGraphNodeFromPanel(graphRunId, nodeId),
    feedbackNode: (graphRunId, nodeId) => feedbackGraphNodeFromPanel(graphRunId, nodeId),
    stopRun: (graphRunId) => stopGraphRunFromPanel(graphRunId),
    showInformationMessage: deps.showInformationMessage,
    showWarningMessage: deps.showWarningMessage,
    t: deps.t,
  });

function initializeGraphAutoWakeScheduler(context: vscode.ExtensionContext): void {
  graphAutoWakeScheduler?.dispose();
  graphAutoWakeScheduler = new GraphAutoWakeScheduler({
    readRun: (graphRunId) => readGraphRunRecord(graphRunId).run,
    onWake: attemptGraphRunAutoWake,
    onError: (graphRunId, error) => {
      void logError("graph-auto-wake-scheduler-error", {
        graphRunId,
        error: deps.errorToMessage(error),
      });
    },
  });
  context.subscriptions.push(graphAutoWakeScheduler);
  restoreGraphAutoWakeSchedules();
}

function restoreGraphAutoWakeSchedules(): void {
  if (!graphAutoWakeScheduler) {
    return;
  }
  const result = listGraphRuns({
    workspaceKey: deps.getActiveWorkspaceKey(),
    statuses: ["sleeping"],
  });
  if (result.errors.length > 0) {
    void logError("graph-auto-wake-restore-partial-read", {
      unreadableStoreFiles: result.diagnostics.unreadableStoreFiles,
      errors: result.errors.slice(0, 3),
    });
  }
  graphAutoWakeScheduler.restore(result.runs);
}

function scheduleGraphRunAutoWake(run: GraphRunRecord): void {
  if (run.status === "sleeping" && resolveGraphRunAutoWakeAt(run) !== null) {
    graphAutoWakeScheduler?.schedule(run);
  } else {
    graphAutoWakeScheduler?.cancel(run.id);
  }
  refreshOpenGraphRunPanelForRun(run.id);
}

function cancelGraphRunAutoWake(graphRunId: string): void {
  graphAutoWakeScheduler?.cancel(graphRunId);
}

function attemptGraphRunAutoWake(graphRunId: string): GraphAutoWakeAttemptResult {
  const lookup = readGraphRunRecord(graphRunId);
  const run = lookup.run;
  if (!run || run.status !== "sleeping") {
    return "discard";
  }
  if (run.workspaceKey !== deps.getActiveWorkspaceKey()) {
    return "discard";
  }
  const wakeAt = resolveGraphRunAutoWakeAt(run);
  if (wakeAt === null || wakeAt > Date.now()) {
    return "retry";
  }
  const target = resolveGraphRunExistingPromptTarget(run);
  if (target && deps.isTabRunActive(target.tabId)) {
    return "retry";
  }
  void continueGraphRunFromStore(graphRunId, {
    source: "auto_wake",
    reason: "Graph sleep wakeAt is due.",
    preferredTargetTabId: target?.tabId ?? null,
  }).then((result) => {
    if (!result.ok) {
      void logError("graph-auto-wake-failed", {
        graphRunId,
        message: result.message,
      });
    }
  });
  return "started";
}

async function continueGraphRunFromPanel(graphRunId: string): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  return continueGraphRunFromStore(graphRunId, {
    source: "panel",
    reason: "Panel requested Graph run continue.",
  });
}

async function supplementGraphRunFromPanel(
  graphRunId: string,
  prompt: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const supplementalRequirement = normalizeGraphSupplementalRequirement(prompt);
  if (!supplementalRequirement) {
    return {
      ok: false,
      changed: false,
      message: deps.messages.graphRuntimeMessage("controlRejected", { detail: deps.messages.graphRuntimeMessage("supplementEmpty") }),
      run: lookup.run,
    };
  }
  if (lookup.run.status === "completed" || lookup.run.status === "stopped") {
    return {
      ok: false,
      changed: false,
      message: deps.messages.graphRuntimeMessage("controlRejected", { detail: deps.messages.graphRuntimeMessage("supplementUnavailable") }),
      run: lookup.run,
    };
  }
  const nextRequirements = appendGraphSupplementalRequirement(
    lookup.run.supplementalRequirements,
    supplementalRequirement,
  );
  const timestamp = Date.now();
  const persisted = updateGraphRunRecord(lookup.run.id, {
    supplementalRequirements: nextRequirements,
    updatedAt: timestamp,
  }) ?? lookup.run;
  appendGraphSupplementalRequirementToCommunication(persisted, supplementalRequirement, timestamp);
  appendGraphEvent(persisted.eventsFile, {
    runId: persisted.id,
    type: "run.updated",
    timestamp,
    summary: "Graph supplemental requirement added from panel.",
    data: {
      source: "panel",
      supplementalRequirementCount: nextRequirements.length,
    },
  });
  refreshOpenGraphRunPanelForRun(persisted.id);
  await deps.postPanelState();
  return {
    ok: true,
    changed: true,
    message: deps.messages.graphRuntimeMessage("supplementAccepted"),
    run: persisted,
  };
}

function normalizeGraphSupplementalRequirement(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function appendGraphSupplementalRequirement(
  existing: readonly string[] | undefined,
  nextItem: string,
): string[] {
  const normalizedExisting = Array.isArray(existing)
    ? existing.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return [...normalizedExisting, nextItem];
}

function appendGraphSupplementalRequirementToCommunication(
  run: GraphRunRecord,
  requirement: string,
  timestamp: number,
): void {
  const body = [
    `- 时间：${new Date(timestamp).toISOString()}`,
    `- Graph 运行：${run.id}`,
    requirement,
  ].join("\n");
  try {
    fs.mkdirSync(path.dirname(run.mainCommunicationFile), { recursive: true });
    fs.appendFileSync(run.mainCommunicationFile, `\n## 补充需求\n${body}\n`, "utf8");
  } catch (error) {
    void logError("graph-supplemental-requirement-write-error", {
      graphRunId: run.id,
      filePath: run.mainCommunicationFile,
      error: String(error),
    });
  }
}

async function retryGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const control = await retryGraphNodeForRun(lookup.run, nodeId, {
    source: "panel",
    reason: "Panel requested Graph node retry.",
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "retry");
  }
  const persisted = persistGraphRunControlResult(control);
  scheduleGraphRunAutoWake(persisted);
  return tickGraphRunToPauseFromControl(persisted, {
    source: "panel",
    reason: "Panel requested Graph node retry.",
    preferredTargetTabId: null,
    successKey: "retryStarted",
  });
}

async function skipGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const control = await skipGraphNodeForRun(lookup.run, nodeId, {
    source: "panel",
    reason: "Panel requested Graph node skip and downstream continue.",
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "skip");
  }
  const persisted = persistGraphRunControlResult(control);
  scheduleGraphRunAutoWake(persisted);
  return tickGraphRunToPauseFromControl(persisted, {
    source: "panel",
    reason: "Panel requested Graph node skip and downstream continue.",
    preferredTargetTabId: null,
    successKey: "skipStarted",
  });
}

async function feedbackGraphNodeFromPanel(
  graphRunId: string,
  nodeId: string,
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const control = await feedbackGraphNodeForRun(lookup.run, nodeId, {
    source: "panel",
    reason: "Panel requested Graph upstream feedback rollback.",
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "feedback");
  }
  const persisted = persistGraphRunControlResult(control);
  scheduleGraphRunAutoWake(persisted);
  return tickGraphRunToPauseFromControl(persisted, {
    source: "panel",
    reason: "Panel requested Graph upstream feedback rollback.",
    preferredTargetTabId: null,
    successKey: "feedbackStarted",
  });
}

async function stopGraphRunFromPanel(graphRunId: string): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const target = resolveGraphRunExistingPromptTarget(lookup.run);
  const stoppedCliRuns = stopActiveCliRunsForGraphRun(graphRunId);
  const control = await stopGraphRunRecord(lookup.run, {
    source: "panel",
    reason: "Panel requested Graph run stop.",
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "stop");
  }
  const persisted = persistGraphRunControlResult(control);
  cancelGraphRunAutoWake(graphRunId);
  refreshOpenGraphRunPanelForRun(graphRunId);
  if (target) {
    deps.runtime.sendGraphMainRunTerminalStatus(target, persisted);
  }
  await deps.postPanelState();
  return {
    ok: true,
    changed: control.changed,
    message: deps.messages.graphRuntimeMessage(stoppedCliRuns > 0 ? "stopWithCli" : "stopStateOnly", {
      graphRunId,
      count: stoppedCliRuns,
    }),
    run: persisted,
  };
}

async function continueGraphRunFromStore(
  graphRunId: string,
  options: {
    source: GraphRunControlSource;
    reason: string;
    preferredTargetTabId?: string | null;
  },
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const lookup = readGraphRunRecord(graphRunId);
  if (!lookup.run) {
    return createGraphPanelMissingRunResult(graphRunId, lookup.errors);
  }
  const control = await resumeGraphRunRecord(lookup.run, {
    source: options.source,
    reason: options.reason,
    appendEvent: (run, event) => appendGraphEvent(run.eventsFile, event),
  });
  if (!control.ok) {
    return toGraphPanelControlResult(control, "continue");
  }
  const persisted = control.changed
    ? persistGraphRunControlResult(control)
    : control.run;
  cancelGraphRunAutoWake(persisted.id);
  return tickGraphRunToPauseFromControl(persisted, {
    source: options.source,
    reason: options.reason,
    preferredTargetTabId: options.preferredTargetTabId ?? null,
    successKey: "continueStarted",
  });
}

async function tickGraphRunToPauseFromControl(
	  run: GraphRunRecord,
	  options: {
	    source: GraphRunControlSource;
	    reason: string;
	    preferredTargetTabId?: string | null;
	    successKey: "continueStarted" | "retryStarted" | "feedbackStarted" | "skipStarted";
	  },
): Promise<{ ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null }> {
  const target = await resolveGraphRunPromptTarget(run, options.preferredTargetTabId ?? null);
  if (!target) {
    return {
      ok: false,
      changed: false,
      message: deps.messages.graphRuntimeMessage("targetMissing", { graphRunId: run.id }),
      run,
    };
  }
  if (deps.isTabRunActive(target.tabId)) {
    return {
      ok: false,
      changed: false,
      message: deps.messages.graphRuntimeMessage("targetBusy", { graphRunId: run.id }),
      run,
    };
  }

  const activeConfigId = deps.getActiveConfigIdForCli(target.cli);
  const prompt = deps.messages.graphRuntimeMessage("resumePrompt", { graphRunId: run.id });
  const modelFields = deps.runtime.resolveGraphResumePromptModels(run, target.cli, activeConfigId);
  const promptInput = await deps.runtime.hydrateOpenCodePromptRoleModels({
    displayPrompt: prompt,
    modelPrompt: run.rootPrompt || prompt,
    contextTags: [],
    ...modelFields,
    graphRunId: run.id,
  }, target.cli);
  const outcome = await deps.runtime.tickGraphRunToPause(run, promptInput, target);
  return {
    ok: true,
    changed: true,
    message: outcome.progressed
      ? deps.messages.graphRuntimeMessage(options.successKey, { graphRunId: outcome.run.id })
      : deps.messages.graphRuntimeMessage("noRunnableNode", { graphRunId: outcome.run.id }),
    run: outcome.run,
  };
}

function persistGraphRunControlResult(result: GraphRunControlResult): GraphRunRecord {
  return updateGraphRunRecord(result.run.id, result.run) ?? result.run;
}

function persistGraphRunTickState(nextRun: GraphRunRecord): GraphRunRecord {
  const latest = readGraphRunRecord(nextRun.id).run;
  if (latest?.status === "stopped" && nextRun.status !== "stopped") {
    refreshOpenGraphRunPanelForRun(latest.id);
    return latest;
  }
  const persisted = updateGraphRunRecord(nextRun.id, nextRun) ?? nextRun;
  refreshOpenGraphRunPanelForRun(persisted.id);
  return persisted;
}

function createGraphPanelMissingRunResult(
  graphRunId: string,
  errors: readonly { storeFile: string; error: string }[] = [],
): { ok: false; changed: false; message: string; run: null } {
  return {
    ok: false,
    changed: false,
    message: errors.length
      ? deps.messages.graphRuntimeMessage("runReadFailed", { graphRunId, detail: errors.slice(0, 3).map((error) => `${error.storeFile}: ${error.error}`).join("\n") })
      : deps.messages.graphRuntimeMessage("runMissing", { graphRunId }),
    run: null,
  };
}

function toGraphPanelControlResult(
  result: GraphRunControlResult,
  action: "continue" | "retry" | "feedback" | "skip" | "stop",
): { ok: boolean; changed: boolean; message: string; run?: GraphRunRecord | null } {
  if (result.ok) {
    const acceptedMessageKey: Record<typeof action, GraphRuntimeMessageKey> = {
      continue: "continueAccepted",
      feedback: "feedbackAccepted",
      retry: "retryAccepted",
      skip: "skipAccepted",
      stop: "stopAccepted",
    };
    return {
      ok: true,
      changed: result.changed,
      message: deps.messages.graphRuntimeMessage(acceptedMessageKey[action]),
      run: result.run,
    };
  }
  return {
    ok: false,
    changed: false,
    message: deps.messages.graphRuntimeMessage("controlRejected", {
      detail: deps.messages.formatGraphControlBlockedReason(result.reason, result.message),
    }),
    run: result.run,
  };
}

function refreshOpenGraphRunPanelForRun(graphRunId: string): void {
  graphRunPanelCoordinator.refreshOpenPanelForRun(graphRunId);
}

function resolveGraphRunExistingPromptTarget(run: GraphRunRecord): PromptRunTarget | null {
  if (run.sessionId) {
    const existingTabId = deps.findConversationTabIdBySession(run.cli, run.sessionId);
    const existingTarget = resolveGraphRunPromptTargetByTabId(existingTabId, run.cli);
    if (existingTarget) {
      return existingTarget;
    }
  }
  const activeTab = deps.getActiveConversationTab();
  if (activeTab?.cli === run.cli) {
    return resolveGraphRunPromptTargetByTabId(activeTab.id, run.cli);
  }
  return null;
}

async function resolveGraphRunPromptTarget(
  run: GraphRunRecord,
  preferredTabId: string | null,
): Promise<PromptRunTarget | null> {
  const preferredTarget = resolveGraphRunPromptTargetByTabId(preferredTabId, run.cli);
  if (preferredTarget) {
    await deps.switchVisibleConversationTabForLoop(preferredTarget.tabId);
    return preferredTarget;
  }

  const existingTarget = resolveGraphRunExistingPromptTarget(run);
  if (existingTarget) {
    await deps.switchVisibleConversationTabForLoop(existingTarget.tabId);
    return existingTarget;
  }

  const tabId = deps.addConversationTab(run.cli, run.sessionId ?? null);
  if (!tabId) {
    return null;
  }
  await deps.switchVisibleConversationTabForLoop(tabId);
  return resolveGraphRunPromptTargetByTabId(tabId, run.cli);
}

function resolveGraphRunPromptTargetByTabId(tabId: string | null, cli: CliName): PromptRunTarget | null {
  const target = deps.resolvePromptRunTarget(tabId);
  return target?.cli === cli ? target : null;
}

function stopActiveCliRunsForGraphRun(graphRunId: string): number {
  let stoppedCount = 0;
  const parallelTabIds = Array.from(deps.getParallelRunsByTabId().entries())
    .filter(([, run]) => run.graphRunId === graphRunId)
    .map(([tabId]) => tabId);
  parallelTabIds.forEach((tabId) => {
    if (deps.stopParallelRunForTab(tabId, deps.messages.graphRuntimeMessage("stopRequested"))) {
      stoppedCount += 1;
    }
  });

  const interactiveTabIds = Array.from(deps.getInteractiveRunsByTabId().entries())
    .filter(([, run]) => run.graphRunId === graphRunId && !run.stopped)
    .map(([tabId]) => tabId);
  interactiveTabIds.forEach((tabId) => {
    const run = deps.getInteractiveRunsByTabId().get(tabId);
    if (run && !run.stopped && run.stop) {
      run.stop();
      stoppedCount += 1;
    }
  });

  if (deps.isPrimaryRunActive() && deps.getActiveTaskRun()?.graphRunId === graphRunId) {
    deps.stopActiveRun();
    stoppedCount += 1;
  }
  return stoppedCount;
}



  async function openGraphRunPanel(arg?: unknown): Promise<void> {
    await graphRunPanelCoordinator.open(arg);
  }

  function disposeGraphAutoWakeScheduler(): void {
    graphAutoWakeScheduler?.dispose();
    graphAutoWakeScheduler = null;
  }

  return {
    initializeGraphAutoWakeScheduler,
    restoreGraphAutoWakeSchedules,
    scheduleGraphRunAutoWake,
    cancelGraphRunAutoWake,
    attemptGraphRunAutoWake,
    continueGraphRunFromPanel,
    supplementGraphRunFromPanel,
    retryGraphNodeFromPanel,
    skipGraphNodeFromPanel,
    feedbackGraphNodeFromPanel,
    stopGraphRunFromPanel,
    continueGraphRunFromStore,
    tickGraphRunToPauseFromControl,
    persistGraphRunControlResult,
    persistGraphRunTickState,
    refreshOpenGraphRunPanelForRun,
    resolveGraphRunExistingPromptTarget,
    resolveGraphRunPromptTarget,
    resolveGraphRunPromptTargetByTabId,
    stopActiveCliRunsForGraphRun,
    openGraphRunPanel,
    disposeGraphAutoWakeScheduler,
  };
}

export type GraphControlsHost = ReturnType<typeof createGraphControlsHost>;
