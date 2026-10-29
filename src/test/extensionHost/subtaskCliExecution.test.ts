import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("fs");
import os = require("os");
import path = require("path");

import type { CliName } from "../../cli/types";
import type { LoopTaskRecord } from "../../loopTaskStore";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import { installVscodeMock } from "../vscodeMock";
import { withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";
import { buildStructuredSvgSummaryPromptInstruction } from "../../finalAnswerProtocol";

installVscodeMock();

const { createLoopOrchestrationHost } = require("../../extensionHost/loopOrchestration") as typeof import("../../extensionHost/loopOrchestration");
const { createGraphRuntimeHost } = require("../../extensionHost/graphRuntime") as typeof import("../../extensionHost/graphRuntime");
const { createGraphMessagesHost } = require("../../extensionHost/graphMessages") as typeof import("../../extensionHost/graphMessages");
const {
  createLoopPlusRuntimeFixture,
  waitForLoopPlus,
} = require("./fixtures/loopPlusRuntimeFixture") as typeof import("./fixtures/loopPlusRuntimeFixture");

function loopTask(overrides: Partial<LoopTaskRecord> = {}): LoopTaskRecord {
  return {
    id: "task-1",
    cli: "codex",
    workspaceKey: "workspace",
    taskStoreFile: "/tmp/loop-tasks.json",
    rootPrompt: "ship it",
    executionMode: "main_sub_multi_agent",
    schedulingMode: "classic",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    maxRounds: 3,
    currentRound: 1,
    communicationDir: "/tmp/loop-comm",
    mainCommunicationFile: "/tmp/loop-comm/main.md",
    sessionId: "main-session",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
    ...overrides,
  };
}

test("classic Loop and its moderator keep optional SVG guidance in the finalSummary protocol", async () => {
  const task = loopTask();
  const prompts: string[] = [];
  const host = createLoopOrchestrationHost({
    getLoopCommunicationPaths: () => ({ dir: task.communicationDir, mainFile: task.mainCommunicationFile, subtasksDir: "/tmp/loop-comm/subtasks" }),
    normalizeLoopContinuePromptForPrompt: () => null,
    buildLoopSupplementalRequirementsLines: () => [],
    buildLoopMainSubChatTranscriptFile: () => "/tmp/loop-comm/chat.md",
    isLoopTaskExecutionInterrupted: () => false,
    readLoopTaskRecord: () => task,
    updateLoopTaskRecord: () => task,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolvePromptRunModelForRole: () => undefined,
    resolvePromptRunThinkingModeForRole: () => undefined,
    runPrompt: async (input: PromptRunInput) => { prompts.push(input.modelPrompt); },
    resolveLoopTaskSessionId: () => null,
    getLoopRoundRunStatus: () => "stopped",
    appendLoopRound: () => undefined,
    buildLoopRoundSummary: () => "已中断",
  } as never);

  for (const moderatorLed of [false, true]) {
    const result = await host.runClassicLoopMainDecision({
      input: { displayPrompt: task.rootPrompt, modelPrompt: task.rootPrompt, contextTags: [] },
      target: { tabId: "main-tab", cli: "codex", sessionId: null },
      task,
      round: 1,
      moderatorLed,
    });
    assert.equal(result.status, "interrupted");
    assert.equal(result.runStatus, "stopped");
  }
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) {
    assert.ok(prompt.includes(buildStructuredSvgSummaryPromptInstruction("finalSummary")));
    assert.doesNotMatch(prompt, /\[final_answer\]/u);
  }
});

test("classic Loop creates the subtask tab on the bound CLI and keeps the main target", async () => {
  const created: PromptRunTarget[] = [];
  const systemMessages: Array<{ tabId: string; content: string }> = [];
  const prompts: Array<{ input: PromptRunInput; targetTabId?: string }> = [];
  const parent: PromptRunTarget = { tabId: "main-tab", cli: "codex", sessionId: "main-session" };
  const task = loopTask({
    modelRouting: {
      main: { model: "gpt-main" },
      subtask: { cli: "claude", configId: "claude-config" },
    },
    originProfile: { configId: "codex-config", subtaskThinkingMode: "high" },
  });
  const host = createLoopOrchestrationHost({
    t: (key: string) => key,
    appendSystemMessageForLoop: (target: PromptRunTarget, content: string) => {
      systemMessages.push({ tabId: target.tabId, content });
    },
    createMessageId: () => "message-1",
    getLoopMessagesForTarget: () => [],
    appendMessageToStore: (messages: unknown[], message: unknown) => { (messages as unknown[]).push(message); },
    persistLoopMessagesForTarget: () => undefined,
    sendPanelMessage: () => undefined,
    buildSubagentProgressLabels: () => ({ title: "subtask", waiting: "waiting", completed: "done", failed: "failed", interrupted: "stopped" }),
    createSubagentProgressController: () => ({ getMessage: () => null, update: () => undefined }),
    createLoopSubtaskProgressMonitor: () => ({ start: () => undefined, sync: () => undefined, finish: () => undefined }),
    createLoopSubtaskRunTarget: (cli: CliName) => {
      const target = { tabId: `sub-${cli}`, cli, sessionId: null };
      created.push(target);
      return target;
    },
    prepareLoopSubtaskCommunicationFile: () => "/tmp/loop-comm/sub.md",
    buildLoopSubtaskStartedText: () => "started",
    appendLoopMainSubChatSubtaskStarted: () => undefined,
    getLoopSubtaskDisplayTitle: (_index: number, subtask: { title?: string }) => subtask.title ?? "subtask",
    formatLoopGroupChatMemberName: (title: string) => title,
    ensureLoopMainSubChatTranscript: () => "/tmp/loop-comm/main.md",
    appendTextFileEnsuringDir: () => undefined,
    getLastLoopAssistantContent: () => "done",
    mapLoopRunStatusToSubagentStatus: () => "completed",
    switchVisibleConversationTabForLoop: async () => undefined,
    isLoopTaskExecutionInterrupted: () => false,
    readLoopTaskRecord: () => task,
    getActiveLoopSubtaskIds: () => [],
    updateLoopTaskRecord: () => task,
    refreshOpenLoopGroupChatPanelForTask: () => undefined,
    resolvePromptRunModelForRole: (input: PromptRunInput) => input.loopSubtaskModel ?? input.model,
    resolvePromptRunThinkingModeForRole: (input: PromptRunInput) => input.loopSubtaskThinkingMode,
    runPrompt: async (input: PromptRunInput, options: { targetTabId?: string }) => {
      prompts.push({ input, targetTabId: options.targetTabId });
    },
    getLoopRoundRunStatus: () => "end",
    appendLoopRound: () => undefined,
    buildLoopRoundSummary: () => "summary",
    finalizeLoopSubtaskRun: async () => undefined,
    resolvePromptRunTargetSessionId: () => null,
  } as never);

  const status = await host.runLoopSubtasksBatchWithRetry({
    input: { displayPrompt: "ship it", modelPrompt: "ship it", contextTags: [] },
    target: parent,
    task,
    round: 1,
    subtasks: [{ id: "sub-1", title: "Implement", prompt: "do the work", status: "pending" }],
  });

  assert.equal(status[0]?.status, "end");
  assert.equal(parent.cli, "codex");
  assert.equal(parent.sessionId, "main-session");
  assert.equal(created.length, 1);
  assert.equal(created[0]?.cli, "claude");
  assert.equal(created[0]?.tabId, "sub-claude");
  assert.notEqual(prompts[0]?.targetTabId, parent.tabId);
  assert.equal(prompts[0]?.input.loopSubtaskCli, "claude");
  assert.equal(prompts[0]?.input.loopSubtaskConfigId, "claude-config");
  assert.equal(prompts[0]?.input.loopSubtaskModel, undefined);
  assert.equal(prompts[0]?.input.loopSubtaskThinkingMode, "high");
  assert.equal(prompts[0]?.input.taskRole, "subtask");
  assert.equal(prompts[0]?.input.loopSubtaskId, "sub-1");
  assert.ok(systemMessages.some((message) => message.tabId === parent.tabId && message.content === "started"));
  assert.equal(systemMessages.some((message) => message.tabId === created[0]?.tabId), false);
});

test("classic Loop refuses a missing cross-CLI config instead of running the main CLI", async () => {
  const created: CliName[] = [];
  const task = loopTask({
    modelRouting: {
      main: { model: "gpt-main" },
      subtask: { cli: "grok" },
    },
  });
  const messages: string[] = [];
  const host = createLoopOrchestrationHost({
    appendSystemMessageForLoop: (_target: PromptRunTarget, message: string) => { messages.push(message); },
    markLoopSubtaskRunFinished: () => undefined,
    createLoopSubtaskRunTarget: (cli: CliName) => {
      created.push(cli);
      return { tabId: "should-not-run", cli, sessionId: null };
    },
  } as never);
  const status = await host.runLoopSubtasksBatchWithRetry({
    input: { displayPrompt: "ship it", modelPrompt: "ship it", contextTags: [] },
    target: { tabId: "main-tab", cli: "codex", sessionId: "main-session" },
    task,
    round: 1,
    subtasks: [{ id: "sub-1", title: "Implement", prompt: "do the work", status: "pending" }],
  });
  assert.equal(status[0]?.status, "error");
  assert.deepEqual(created, []);
  assert.equal(messages.includes("目标 CLI 没有可用配置，不能派发子任务。"), true);
});

test("Loop+ attempt target uses the bound sub CLI while the main target stays unchanged", async () => {
  const fixture = createLoopPlusRuntimeFixture();
  try {
    fixture.queueMain(async (input, tabId) => {
      fixture.publish(input, tabId, {
        status: "end",
        content: JSON.stringify(withLoopPlusAcceptReviews({
          status: "dispatch",
          acceptance: { passed: false, checks: [] },
          subtasks: [{
            id: "A",
            title: "A",
            prompt: "Implement A without editing the parent task record or scheduler snapshot. Write scope: src/a.ts. Report only the attempt result.",
            writeFiles: ["src/a.ts"],
          }],
        })),
      });
    });
    const running = fixture.adapter.runEventDriven({
      displayPrompt: "ship it",
      modelPrompt: "ship it",
      contextTags: [],
      model: "main-model",
      loopMainModel: "main-model",
      loopSubtaskCli: "claude",
      loopSubtaskConfigId: "claude-config",
      loopSubtaskThinkingMode: "high",
    }, { schedulingMode: "event_driven" }, fixture.target);
    await waitForLoopPlus(() => fixture.createdSubtaskTargets.length === 1, "cross-cli attempt");
    assert.equal(fixture.target.cli, "codex");
    assert.equal(fixture.target.sessionId, "session");
    assert.equal(fixture.createdSubtaskTargets[0]?.cli, "claude");
    assert.notEqual(fixture.createdSubtaskTargets[0]?.tabId, fixture.target.tabId);
    const attempt = fixture.attemptCalls[0];
    assert.equal(attempt?.loopSubtaskCli, "claude");
    assert.equal(attempt?.loopSubtaskConfigId, "claude-config");
    assert.equal(attempt?.loopSubtaskModel, undefined);
    assert.equal(attempt?.taskRole, "subtask");
    assert.equal(fixture.mainCalls[0]?.taskRole, "main");
    assert.equal(fixture.mainCalls[0]?.loopSubtaskCli, "claude");
    running.catch(() => undefined);
  } finally {
    fixture.dispose();
  }
});

test("Graph executor nodes use the sub CLI and plan nodes stay on the main CLI", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "graph-subtask-cli-"));
  const created: Array<{ cli: CliName; tabId: string }> = [];
  const prompts: PromptRunInput[] = [];
  const closed: string[] = [];
  const systemMessages: Array<{ tabId: string; content: string }> = [];
  try {
    const host = createGraphRuntimeHost({
      getActiveWorkspaceKey: () => "workspace",
      getActiveConversationTabId: () => "main-tab",
      resolvePromptRunTarget: () => ({ tabId: "main-tab", cli: "codex", sessionId: "main-session" }),
      resolveGraphRunSessionId: (target: { sessionId: string | null }) => target.sessionId,
      getActiveConfigIdForCli: (cli: string) => `${cli}-config`,
      getSelectedCliModel: () => "selected-model",
      getSelectedLoopCliModel: () => "stored-subtask",
      getSelectedLoopThinkingMode: () => "low",
      normalizeThinkingModeForCli: (_cli: string, mode: "low") => mode,
      getEffectiveThinkingMode: () => "medium",
      getGlobalLoopSubtaskMaxThinkingMode: () => "high",
      isThinkingMode: () => true,
      resolveOpenCodeRoleModelsForConfig: () => ({ main: null, subtask: null, fallback: {} }),
      createMessageId: () => "message-1",
      resolveWorkspaceCwd: () => root,
      postPanelState: async () => undefined,
      persistGraphRunTickState: (run: unknown) => run,
      scheduleGraphRunAutoWake: () => undefined,
      sendRunStatusForTab: () => undefined,
      createGraphNodeRunTarget: (cli: CliName, graphRunId: string, graphNodeId: string) => {
        const target = { tabId: `${graphRunId}:${graphNodeId}:${cli}`, cli, sessionId: null };
        created.push(target);
        return target;
      },
      runPrompt: async (input: PromptRunInput) => {
        prompts.push(input);
        if (!input.graphNodeId) {
          return;
        }
        const artifact = path.join(root, "nodes", "nodes", `${input.graphNodeId}.md`);
        fs.mkdirSync(path.dirname(artifact), { recursive: true });
        const artifactBody = [
          "## JSON",
          "```json",
          JSON.stringify({
            status: "passed",
            summary: `${input.graphNodeId} passed`,
          }),
          "```",
          "",
        ].join("\n");
        fs.writeFileSync(artifact, artifactBody);
      },
      closeConversationTabAndRefreshPanel: async (tabId: string) => {
        closed.push(tabId);
      },
      errorToMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
      messages: createGraphMessagesHost({
        getGraphNodeRunTarget: () => undefined,
        getLoopMessagesForTarget: () => [],
        appendSystemMessageForLoop: (target, content) => {
          systemMessages.push({ tabId: target.tabId, content });
        },
        appendMessageToStore: (messages, message) => { messages.push(message); },
        sendPanelMessage: () => undefined,
        persistLoopMessagesForTarget: () => undefined,
        createMessageId: () => "message-1",
      }),
    } as never);
    const baseRun = {
      id: `graph-subtask-cli-${process.pid}-executor`,
      workspaceKey: "workspace",
      cli: "codex" as const,
      sessionId: "main-session",
      rootPrompt: "Do the work",
      status: "running" as const,
      createdAt: 1,
      updatedAt: 1,
      graphVersion: 1,
      runStoreFile: path.join(root, "run.json"),
      nodes: [{
        id: "implement-1",
        title: "Implement",
        kind: "implement" as const,
        status: "pending" as const,
        ownerRole: "executor",
        maxAttempts: 1,
        attempts: 0,
        dependsOn: [],
        unlocks: [],
      }],
      edges: [],
      activeNodeIds: [],
      maxConcurrent: 1,
      eventsFile: path.join(root, "events.jsonl"),
      communicationDir: path.join(root, "nodes"),
      mainCommunicationFile: path.join(root, "main.md"),
      graphFile: path.join(root, "graph.json"),
      executionMode: "direct" as const,
      directExecution: { cwd: root },
      modelRouting: {
        planner: { model: "planner-model" },
        executor: { cli: "grok" as const, configId: "grok-config", model: "grok-executor" },
      },
    };
    const mainTarget = { tabId: "main-tab", cli: "codex" as const, sessionId: "main-session" };
    const executorOutcome = await host.tickGraphRunToPause(baseRun as never, {
      displayPrompt: "Do the work",
      modelPrompt: "Do the work",
      contextTags: [],
      loopMainModel: "planner-model",
      loopSubtaskCli: "grok",
      loopSubtaskConfigId: "grok-config",
      loopSubtaskModel: "grok-executor",
    }, mainTarget);
    assert.equal(mainTarget.cli, "codex");
    assert.equal(mainTarget.sessionId, "main-session");
    assert.equal(created.some((target) => target.cli === "grok" && target.tabId.includes("implement-1")), true);
    assert.equal(prompts.some((input) => input.graphNodeId === "implement-1" && input.loopSubtaskCli === "grok" && input.loopSubtaskConfigId === "grok-config" && input.model === "grok-executor"), true);
    assert.equal(closed.some((tabId) => tabId.includes("implement-1:grok")), true);
    assert.equal(executorOutcome.run.cli, "codex");
    assert.ok(systemMessages.some((message) => message.tabId === mainTarget.tabId && message.content.includes("implement-1")));
    assert.equal(systemMessages.some((message) => created.some((target) => target.tabId === message.tabId)), false);

    created.length = 0;
    prompts.length = 0;
    systemMessages.length = 0;
    const planRun = {
      ...baseRun,
      id: `graph-subtask-cli-${process.pid}-plan`,
      eventsFile: path.join(root, "plan-events.jsonl"),
      nodes: [{
        id: "plan-1",
        title: "Plan",
        kind: "plan" as const,
        status: "pending" as const,
        ownerRole: "planner",
        maxAttempts: 1,
        attempts: 0,
        dependsOn: [],
        unlocks: [],
      }],
    };
    await host.tickGraphRunToPause(planRun as never, {
      displayPrompt: "Plan",
      modelPrompt: "Plan",
      contextTags: [],
      loopSubtaskCli: "grok",
      loopSubtaskConfigId: "grok-config",
    }, mainTarget);
    assert.equal(created.some((target) => target.cli === "codex" && target.tabId.includes("plan-1")), true);
    assert.equal(created.some((target) => target.cli === "grok"), false);
    assert.equal(prompts.some((input) => input.graphNodeId === "plan-1" && input.loopSubtaskCli === "grok"), false);
    assert.ok(systemMessages.some((message) => message.tabId === mainTarget.tabId && message.content.includes("plan-1")));
    assert.equal(systemMessages.some((message) => created.some((target) => target.tabId === message.tabId)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
